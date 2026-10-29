import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.134.0/+esm";
import { createHUD } from "./hud.js";
import { drive } from "./drive.js";

/* =========================================================
   Settings & storage
   ========================================================= */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem("jarvis." + key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("jarvis." + key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
};

const DEFAULTS = {
  key: "", model: "claude-opus-5-5", effort: "low", web: true,
  name: "sir", speak: true, wake: false, voice: "", gclient: "",
};
let settings = { ...DEFAULTS, ...store.get("settings", {}) };
let engineeringMode = store.get("engMode", false);
let history = store.get("history", []);
let notes = store.get("notes", []);
let historyWarned = false;
let safeMode = store.get("safeModeV2", false);

const $ = (id) => document.getElementById(id);
const hud = createHUD($("hud"));

/* =========================================================
   UI state
   ========================================================= */
let busy = false;
function setState(s, sub) {
  document.body.dataset.state = s;
  hud.setState(s);
  $("coreSub").textContent = sub || {
    idle: "TAP TO SPEAK", listening: "LISTENING…", thinking: "PROCESSING…", speaking: "SPEAKING",
  }[s];
}

function refreshStatus() {
  const set = (id, text, cls) => { const el = $(id); el.textContent = text; el.className = cls || ""; };
  set("stAI", settings.key ? "ONLINE" : "NO API KEY", settings.key ? "ok" : "warn");
  set("stVoice", SR ? (settings.wake ? "WAKE WORD" : "READY") : "TEXT ONLY", SR ? "ok" : "warn");
  set("stDrive", drive.connected ? "CONNECTED" : "DISCONNECTED", drive.connected ? "ok" : "");
  set("stNet", navigator.onLine ? "ONLINE" : "OFFLINE", navigator.onLine ? "ok" : "warn");
  set("stMode", engineeringMode ? "ENGINEERING" : "STANDARD", engineeringMode ? "warn" : "");
  $("statusPill").textContent = navigator.onLine ? "ONLINE" : "OFFLINE";
  $("btnDrive").textContent = drive.connected ? "Disconnect" : "Connect Google Drive";
  $("btnEng").setAttribute("aria-pressed", String(engineeringMode));
}
addEventListener("online", refreshStatus);
addEventListener("offline", refreshStatus);

function tickClock() {
  const d = new Date();
  $("clock").textContent = d.toLocaleTimeString([], { hour12: false });
  $("date").textContent = d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}
setInterval(tickClock, 1000);
tickClock();

// Side panels as drawers on narrow screens.
function openPanel(side) {
  closePanels();
  $(side === "left" ? "panelLeft" : "panelRight").classList.add("open");
  $("scrim").hidden = false;
}
function closePanels() {
  $("panelLeft").classList.remove("open");
  $("panelRight").classList.remove("open");
  $("scrim").hidden = true;
}
$("btnLeft").onclick = () => openPanel("left");
$("btnRight").onclick = () => openPanel("right");
$("scrim").onclick = closePanels;

/* =========================================================
   Markdown + math rendering (small, safe: escapes all HTML first)
   ========================================================= */
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function renderMarkdown(src) {
  const stash = [];
  const keep = (html) => `\u0000${stash.push(html) - 1}\u0000`;
  let s = esc(src);
  s = s.replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => keep(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`));
  s = s.replace(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^\s$][^$\n]*?\$)/g, (m) => keep(m));
  s = s.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${c}</code>`));

  const inline = (t) => t
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  const out = [];
  const lines = s.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*$/.test(line)) continue;
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) { out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1] || "")) {
      const cells = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      let html = "<table><thead><tr>" + cells(line).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        html += "<tr>" + cells(lines[i]).map((c) => `<td>${c}</td>`).join("") + "</tr>"; i++;
      }
      i--; out.push(html + "</tbody></table>"); continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        items.push(`<li>${inline(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>`); i++;
      }
      i--; out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`); continue;
    }
    const para = [line];
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#{1,4}\s|\s*([-*•]|\d+[.)])\s|\s*\|)/.test(lines[i + 1])) para.push(lines[++i]);
    out.push(`<p>${inline(para.join("<br>"))}</p>`);
  }
  return out.join("").replace(/\u0000(\d+)\u0000/g, (_, n) => stash[n]);
}

function renderInto(el, md) {
  el.innerHTML = renderMarkdown(md);
  if (window.renderMathInElement) {
    try {
      renderMathInElement(el, {
        delimiters: [
          { left: "$$", right: "$$", display: true }, { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false }, { left: "$", right: "$", display: false },
        ],
        throwOnError: false,
      });
    } catch { /* leave raw TeX visible */ }
  }
}

/* =========================================================
   Transcript
   ========================================================= */
const log = $("log");
function addMsg(kind, text, { md = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "msg " + kind;
  const who = { user: (settings.name || "you").toUpperCase(), ai: "J.A.R.V.I.S.", sys: "SYSTEM", err: "ALERT" }[kind];
  wrap.innerHTML = `<div class="who">${esc(who)}</div><div class="tools"></div><div class="body"></div>`;
  const body = wrap.querySelector(".body");
  if (md) renderInto(body, text); else body.textContent = text;
  log.appendChild(wrap);
  log.scrollTop = log.scrollHeight;
  return wrap;
}

function restoreTranscript() {
  log.innerHTML = "";
  for (const m of history) {
    if (m.role === "user") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
      const t = blocks.filter((b) => b.type === "text" && !b.text.startsWith("[Context]")).map((b) => b.text).join("\n");
      if (t) addMsg("user", t);
    } else if (m.role === "assistant") {
      const t = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n\n");
      if (t) addMsg("ai", t, { md: true });
    }
  }
}

function greet() {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const n = settings.name ? `, ${settings.name}` : "";
  const msg = settings.key
    ? `${part}${n}. All systems are online. How may I assist you?`
    : `${part}${n}. My AI core is offline — open Settings (⚙) and add your Anthropic API key to bring me fully online. The calculator, clock and notes already work.`;
  addMsg("ai", msg);
}

function saveHistory() {
  if (!store.set("history", history) && !historyWarned) {
    historyWarned = true;
    addMsg("sys", "This conversation is too large to save on this device; it will be kept until you close the page. Start a new session to free space.");
  }
}

/* =========================================================
   Notes (persistent memory)
   ========================================================= */
function renderNotes() {
  const ul = $("notes");
  ul.innerHTML = "";
  if (!notes.length) { ul.innerHTML = `<li class="empty">Nothing saved yet. Say "Jarvis, remember that…"</li>`; return; }
  for (const n of notes) {
    const li = document.createElement("li");
    li.innerHTML = `<span>${esc(n.text)}</span><button aria-label="Delete note">✕</button>`;
    li.querySelector("button").onclick = () => { notes = notes.filter((x) => x.id !== n.id); store.set("notes", notes); renderNotes(); };
    ul.appendChild(li);
  }
}

/* =========================================================
   Engineering calculator (math.js, offline)
   ========================================================= */
const calcScope = {};
function evalMath(expr) {
  if (!window.math) throw new Error("Math engine still loading.");
  const r = math.evaluate(expr, calcScope);
  return typeof r === "function" ? "(function defined)" : math.format(r, { precision: 10 });
}
$("calcForm").onsubmit = (e) => {
  e.preventDefault();
  const expr = $("calcInput").value.trim();
  if (!expr) return;
  const div = document.createElement("div");
  try { div.textContent = `${expr} = ${evalMath(expr)}`; }
  catch (err) { div.textContent = `${expr} → ${err.message}`; div.className = "err"; }
  $("calcOut").prepend(div);
  $("calcInput").select();
};

/* =========================================================
   Voice output
   ========================================================= */
const synth = window.speechSynthesis;
let voices = [];
function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices();
  const sel = $("setVoice");
  sel.innerHTML = `<option value="">Auto (British male if available)</option>` +
    voices.filter((v) => v.lang.startsWith("en")).map((v) => `<option value="${esc(v.name)}">${esc(v.name)} — ${v.lang}</option>`).join("");
  sel.value = settings.voice;
}
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

function pickVoice() {
  if (settings.voice) return voices.find((v) => v.name === settings.voice);
  const pref = [/Ryan.*Online/i, /Thomas.*Online/i, /Google UK English Male/i, /Daniel/i, /George/i, /Arthur/i, /UK English Male/i];
  for (const re of pref) { const v = voices.find((x) => re.test(x.name)); if (v) return v; }
  return voices.find((v) => v.lang === "en-GB") || voices.find((v) => v.lang.startsWith("en"));
}

function speakable(md) {
  let t = md
    .replace(/```[\s\S]*?```/g, " (code shown on screen) ")
    .replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, " (equation on screen) ")
    .replace(/\$([^$\n]+)\$/g, "$1")
    .replace(/\|.*\|/g, "")
    .replace(/[#*_`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\n{2,}/g, ". ").replace(/\s+/g, " ").trim();
  if (t.length > 500) {
    const cut = t.slice(0, 450);
    t = cut.slice(0, Math.max(cut.lastIndexOf(". "), 200) + 1) + " The full details are on your screen.";
  }
  return t;
}

let speakTimer = null;
function speak(md) {
  if (!settings.speak || !synth) return;
  const text = speakable(md);
  if (!text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) { u.voice = v; u.lang = v.lang; }
  u.rate = 1.03; u.pitch = 0.92;
  u.onstart = () => {
    setState("speaking");
    pauseWake();
    clearInterval(speakTimer);
    speakTimer = setInterval(() => hud.setLevel(0.25 + Math.random() * 0.55), 90);
  };
  u.onboundary = () => hud.setLevel(0.9);
  u.onend = u.onerror = () => {
    clearInterval(speakTimer); hud.setLevel(0);
    if (!busy) setState("idle");
    resumeWake();
  };
  synth.speak(u);
}
// iOS/Safari only allow speech after a user gesture: unlock it on first tap.
addEventListener("pointerdown", function unlock() {
  if (synth) { const u = new SpeechSynthesisUtterance(""); u.volume = 0; synth.speak(u); }
  removeEventListener("pointerdown", unlock);
}, { once: true });

/* =========================================================
   Voice input (Web Speech API) + mic level meter
   ========================================================= */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
let meter = null;

async function startMeter() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const an = ac.createAnalyser(); an.fftSize = 512;
    ac.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    let raf;
    const loop = () => {
      an.getByteTimeDomainData(buf);
      let sum = 0; for (const b of buf) { const x = (b - 128) / 128; sum += x * x; }
      hud.setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 5));
      raf = requestAnimationFrame(loop);
    };
    loop();
    meter = { stop() { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ac.close(); hud.setLevel(0); } };
  } catch { /* the meter is cosmetic; recognition still works */ }
}
function stopMeter() { meter?.stop(); meter = null; }

function listen() {
  if (!SR) { addMsg("sys", "Voice input isn't supported in this browser. Chrome, Edge and Safari support it — or just type."); return; }
  if (listening) { rec?.stop(); return; }
  synth?.cancel();
  pauseWake();
  rec = new SR();
  rec.lang = navigator.language || "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let finalText = "";
  rec.onstart = () => { listening = true; $("mic").classList.add("on"); setState("listening"); startMeter(); };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
    }
    $("input").value = (finalText + interim).trim();
    autoGrow();
  };
  rec.onerror = (e) => {
    if (e.error === "not-allowed" || e.error === "service-not-allowed") addMsg("err", "Microphone permission was denied. Allow it in your browser's site settings to talk to me.");
    else if (e.error !== "no-speech" && e.error !== "aborted") addMsg("err", `Voice input error: ${e.error}`);
  };
  rec.onend = () => {
    listening = false; $("mic").classList.remove("on"); stopMeter();
    if (!busy) setState("idle");
    const text = $("input").value.trim();
    if (finalText.trim() && text) submit(text);
    else resumeWake();
  };
  rec.start();
}

// Wake word: continuous background recognition listening for "Jarvis".
let wakeRec = null, wakePaused = false;
function startWake() {
  if (!SR || !settings.wake || wakeRec) return;
  wakeRec = new SR();
  wakeRec.lang = navigator.language || "en-US";
  wakeRec.continuous = true;
  wakeRec.interimResults = false;
  wakeRec.onresult = (e) => {
    const said = e.results[e.results.length - 1][0].transcript.trim();
    const m = said.match(/\bjarvis\b[,.!?]?\s*(.*)$/i);
    if (!m || busy) return;
    const cmd = m[1].trim();
    if (cmd.length > 2) submit(cmd);
    else { stopWake(); speak(`Yes${settings.name ? ", " + settings.name : ""}?`); setTimeout(listen, 900); }
  };
  wakeRec.onend = () => { wakeRec = null; if (settings.wake && !wakePaused) setTimeout(startWake, 400); };
  wakeRec.onerror = (e) => {
    if (e.error === "not-allowed") { settings.wake = false; store.set("settings", settings); refreshStatus(); }
  };
  try { wakeRec.start(); } catch { wakeRec = null; }
}
function stopWake() { const r = wakeRec; wakeRec = null; try { r?.abort(); } catch { /* already stopped */ } }
function pauseWake() { wakePaused = true; stopWake(); }
function resumeWake() { wakePaused = false; if (settings.wake && !listening && !busy && !synth?.speaking) startWake(); }

$("mic").onclick = listen;
$("core").onclick = listen;

/* =========================================================
   AI core: Claude with tools
   ========================================================= */
let client = null;
function getClient() {
  if (!settings.key) return null;
  if (!client || client.apiKey !== settings.key) client = new Anthropic({ apiKey: settings.key, dangerouslyAllowBrowser: true });
  return client;
}

const SYSTEM = () => `You are J.A.R.V.I.S., a personal AI assistant in the spirit of Tony Stark's: calm, precise, quietly witty, unfailingly polite, with dry British understatement. Address the user as "${settings.name || "sir"}" now and then, not in every sentence.

The user talks to you by voice or text from a HUD on their phone or computer. Replies are shown on screen and the opening is read aloud, so:
- Everyday requests: lead with the answer in one to three sentences. No preamble, no filler.
- Engineering, maths, science and technical problems: work them properly. State givens and assumptions, write equations in LaTeX ($...$ inline, $$...$$ display), carry units throughout, use the evaluate_math tool for every numeric step instead of mental arithmetic, and end with a clearly labelled result and a sanity check (order of magnitude, units, limiting cases). If key givens are missing, ask for them first. For safety-critical designs (structures, pressure systems, electrical installations), note that the result needs review by a licensed professional engineer.
- Use Markdown (short headings, lists, tables) where it helps reading.

Tools:
- Google Drive tools search, read and create the user's documents. If Drive isn't connected, tell the user to tap "Connect Google Drive". Only create a document when the user asks for one.
- Notes are the user's persistent memory across sessions. Save something when asked to remember it; check notes when the user refers to something they told you before.
- Each user message starts with a [Context] line giving the local date and time.

Never invent file contents, numbers or tool results. If a tool fails, say plainly what failed.`;

const obj = (properties, required = Object.keys(properties)) =>
  ({ type: "object", properties, required, additionalProperties: false });

const CLIENT_TOOLS = [
  {
    name: "evaluate_math",
    description: "Evaluate a math expression exactly with math.js. Supports arithmetic, functions (sin, sqrt, log, etc.), matrices ([1,2;3,4], det, inv), complex numbers, statistics, and physical units with conversion (e.g. '12 kN * 3.5 m to lbf ft', '5 kg * 9.81 m/s^2', '100 psi to MPa'). Variables assigned (x = 3) persist between calls. Use for every numeric calculation.",
    input_schema: obj({ expression: { type: "string", description: "A single math.js expression." } }),
  },
  {
    name: "drive_search",
    description: "Search the user's Google Drive by file name and full text. Pass an empty query to list the most recently modified files. Returns ids, names, types, modified times and links.",
    input_schema: obj({ query: { type: "string" }, limit: { type: "integer", description: "1-50, default 10" } }),
  },
  {
    name: "drive_read",
    description: "Read the text content of a Google Drive file by id (Google Docs, Sheets as CSV, Slides, and plain-text files).",
    input_schema: obj({ file_id: { type: "string" } }),
  },
  {
    name: "drive_create_doc",
    description: "Create a new Google Doc in the user's Drive with plain-text content. Only use when the user asks to create, write or save a document. The user is asked to confirm first.",
    input_schema: obj({ title: { type: "string" }, content: { type: "string" } }),
  },
  { name: "save_note", description: "Save a note to the user's persistent memory.", input_schema: obj({ text: { type: "string" } }) },
  { name: "list_notes", description: "List all saved notes with their ids.", input_schema: obj({}) },
  { name: "delete_note", description: "Delete a saved note by id.", input_schema: obj({ id: { type: "string" } }) },
].map((t) => ({ ...t, strict: true, eager_input_streaming: true }));

const TOOL_LABEL = {
  evaluate_math: "COMPUTING", drive_search: "SEARCHING DRIVE", drive_read: "READING DOCUMENT",
  drive_create_doc: "CREATING DOCUMENT", save_note: "SAVING TO MEMORY", list_notes: "RECALLING MEMORY",
  delete_note: "UPDATING MEMORY", web_search: "SEARCHING THE WEB", web_fetch: "READING WEB PAGE",
};

// Inputs can arrive truncated when streamed eagerly, so check them against the schema before running.
function validInput(tool, input) {
  if (!input || typeof input !== "object") return false;
  const { properties, required } = tool.input_schema;
  for (const k of required) if (!(k in input)) return false;
  for (const [k, v] of Object.entries(input)) {
    const type = properties[k]?.type;
    if (!type) return false;
    if (type === "string" && typeof v !== "string") return false;
    if (type === "integer" && !Number.isInteger(v)) return false;
  }
  return true;
}

async function runTool(name, input) {
  switch (name) {
    case "evaluate_math": return { expression: input.expression, result: evalMath(input.expression) };
    case "drive_search": {
      const files = await drive.search(input.query, input.limit || 10);
      showFiles(files);
      return { count: files.length, files };
    }
    case "drive_read": return drive.read(input.file_id);
    case "drive_create_doc": {
      if (!drive.connected) throw new Error("Google Drive is not connected.");
      if (!confirm(`JARVIS wants to create a Google Doc named:\n\n"${input.title}"\n\nAllow?`)) return { created: false, reason: "The user declined." };
      const doc = await drive.createDoc(input.title, input.content);
      return { created: true, ...doc };
    }
    case "save_note": {
      const n = { id: Math.random().toString(36).slice(2, 8), text: input.text, saved: new Date().toISOString() };
      notes.push(n); store.set("notes", notes); renderNotes();
      return { saved: true, id: n.id };
    }
    case "list_notes": return { notes };
    case "delete_note": {
      const before = notes.length;
      notes = notes.filter((n) => n.id !== input.id); store.set("notes", notes); renderNotes();
      return { deleted: notes.length < before };
    }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-fable-5-1", "claude-sonnet-5-5"]);

function pushUser(blocks) {
  // Merge into a trailing user turn (e.g. tool results left by an interrupted turn).
  const last = history[history.length - 1];
  if (last?.role === "user") last.content = [...(typeof last.content === "string" ? [{ type: "text", text: last.content }] : last.content), ...blocks];
  else history.push({ role: "user", content: blocks });
}

async function askClaude(text) {
  const c = getClient();
  const snapshot = JSON.stringify(history);
  const ctx = `[Context] Local time: ${new Date().toLocaleString([], { dateStyle: "full", timeStyle: "short" })}. Google Drive: ${drive.connected ? "connected" : "not connected"}.`;
  pushUser([{ type: "text", text: ctx }, { type: "text", text }]);

  const bubble = addMsg("ai", "");
  const body = bubble.querySelector(".body");
  const toolsEl = bubble.querySelector(".tools");
  body.classList.add("cursor");
  let turnText = "";
  let pending = false;
  const paint = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; renderInto(body, turnText); body.classList.add("cursor"); log.scrollTop = log.scrollHeight; });
  };
  const toolLine = (label) => {
    const d = document.createElement("div"); d.className = "tool-line"; d.textContent = "▸ " + label + "…";
    toolsEl.appendChild(d); log.scrollTop = log.scrollHeight;
  };

  // "Safe mode" drops optional extras if the API ever rejects them (set automatically on a 400).
  const tools = safeMode
    ? CLIENT_TOOLS.map(({ strict, eager_input_streaming, ...t }) => t)
    : [...CLIENT_TOOLS];
  if (settings.web) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: 5 });
  const params = {
    model: settings.model,
    max_tokens: engineeringMode ? 64000 : 16000,
    system: SYSTEM(),
    tools,
    messages: history,
    thinking: { type: "adaptive" },
    output_config: { effort: engineeringMode ? "xhigh" : settings.effort },
  };
  if (!safeMode) {
    params.cache_control = { type: "ephemeral" };
    if (FALLBACK_MODELS.has(settings.model)) { params.betas = ["server-side-fallback-2026-07-01"]; params.fallbacks = "default"; }
  }

  try {
    for (let step = 0; step < 15; step++) {
      const stream = c.beta.messages.stream({ ...params, messages: history });
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          if (b.type === "thinking") setState("thinking", "ANALYZING…");
          else if (b.type === "text") { setState("thinking", "RESPONDING…"); if (turnText && !turnText.endsWith("\n\n")) turnText += "\n\n"; }
          else if (b.type === "tool_use" || b.type === "server_tool_use") toolLine(TOOL_LABEL[b.name] || b.name.toUpperCase());
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          turnText += ev.delta.text; paint();
        }
      }
      const msg = await stream.finalMessage();

      if (msg.stop_reason === "refusal") {
        history = JSON.parse(snapshot);
        turnText = (turnText ? turnText + "\n\n" : "") + "_I'm unable to help with that particular request._";
        break;
      }
      history.push({ role: "assistant", content: msg.content });

      if (msg.stop_reason === "pause_turn") continue; // server tool (web search) wants to keep going
      const uses = msg.content.filter((b) => b.type === "tool_use");
      if (msg.stop_reason === "max_tokens") {
        if (uses.length) pushUser(uses.map((u) => ({ type: "tool_result", tool_use_id: u.id, is_error: true, content: "Not run: the response hit its length limit." })));
        turnText += "\n\n_(Response reached its length limit. Say \"continue\" for more.)_";
        break;
      }
      if (msg.stop_reason !== "tool_use" || !uses.length) break;

      const results = await Promise.all(uses.map(async (u) => {
        const def = CLIENT_TOOLS.find((t) => t.name === u.name);
        if (!def || !validInput(def, u.input)) {
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: "INVALID_JSON: tool input was incomplete or didn't match the schema. Please retry." };
        }
        try {
          return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input)) };
        } catch (err) {
          return { type: "tool_result", tool_use_id: u.id, is_error: true, content: String(err.message || err) };
        }
      }));
      pushUser(results);
      setState("thinking");
    }
  } catch (err) {
    history = JSON.parse(snapshot);
    // Account problems (e.g. no credit) aren't caused by the request, so don't switch features off for them.
    if (isAccountError(err)) { safeMode = false; store.set("safeModeV2", false); }
    else if (err instanceof Anthropic.BadRequestError && !safeMode && !turnText) {
      safeMode = true; store.set("safeModeV2", true);
      bubble.remove();
      return askClaude(text);
    }
    body.classList.remove("cursor");
    bubble.classList.replace("ai", "err");
    bubble.querySelector(".who").textContent = "ALERT";
    body.textContent = describeError(err);
    return null;
  } finally {
    saveHistory();
  }
  body.classList.remove("cursor");
  renderInto(body, turnText || "_(No response.)_");
  log.scrollTop = log.scrollHeight;
  return turnText;
}

function isAccountError(err) {
  return err instanceof Anthropic.APIError && /credit balance|billing|spend limit|usage limit/i.test(err.message || "");
}

function describeError(err) {
  if (isAccountError(err)) return "My AI core has run out of credit, sir. Add credits at console.anthropic.com → Settings → Billing, then try again. (A Claude.ai Pro or Max subscription doesn't cover API usage.)";
  if (err instanceof Anthropic.AuthenticationError) return "My API key was rejected. Please check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key doesn't have access to the selected model. Try another model in Settings.";
  if (err instanceof Anthropic.NotFoundError) return "The selected model wasn't found. Choose another model in Settings.";
  if (err instanceof Anthropic.RateLimitError) return "I'm being rate-limited by the API. Give it a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The API rejected the request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "I can't reach the AI service. Check your internet connection.";
  if (err instanceof Anthropic.APIError) return `AI service error (${err.status ?? "?"}): ${err.message}`;
  return `Something went wrong: ${err.message || err}`;
}

// Offline / no-key fallback for simple commands.
function handleLocally(text) {
  const t = text.toLowerCase();
  if (/\btime\b/.test(t)) return `It's ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`;
  if (/\b(date|day is it|today)\b/.test(t)) return `Today is ${new Date().toLocaleDateString([], { dateStyle: "full" })}.`;
  if (/\bnotes?\b/.test(t)) return notes.length ? "Your notes:\n" + notes.map((n) => `- ${n.text}`).join("\n") : "You have no saved notes.";
  const expr = text.replace(/^(what('?s| is)|calculate|compute|convert|evaluate)\s+/i, "").replace(/\?$/, "");
  try { return `${expr} = **${evalMath(expr)}**`; } catch { /* not maths */ }
  return null;
}

/* =========================================================
   Submit
   ========================================================= */
async function submit(text) {
  text = text.trim();
  if (!text || busy) return;
  closePanels();
  $("input").value = ""; autoGrow();
  addMsg("user", text);
  busy = true; pauseWake();
  setState("thinking");
  let reply = null;
  try {
    if (!getClient() || !navigator.onLine) {
      reply = handleLocally(text) || (settings.key
        ? "I'm offline at the moment, so only the clock, calculator and notes are available."
        : "My AI core needs an Anthropic API key. Open Settings (⚙) to add one. Meanwhile I can tell the time, do calculations, and read your notes.");
      addMsg("ai", reply, { md: true });
    } else {
      reply = await askClaude(text);
    }
  } finally {
    busy = false;
    setState("idle");
  }
  if (reply) speak(reply); else resumeWake();
}

const input = $("input");
function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }
input.addEventListener("input", autoGrow);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input.value); }
});
$("composer").onsubmit = (e) => { e.preventDefault(); submit(input.value); };
document.querySelectorAll(".qbtn").forEach((b) => (b.onclick = () => submit(b.dataset.q)));

$("btnEng").onclick = () => {
  engineeringMode = !engineeringMode; store.set("engMode", engineeringMode); refreshStatus();
  addMsg("sys", engineeringMode ? "Engineering mode engaged: deeper reasoning, full working and units. Replies take longer." : "Standard mode: quick, concise replies.");
};
$("btnNew").onclick = () => {
  if (history.length && !confirm("Start a new session? The current transcript will be cleared (notes are kept).")) return;
  history = []; saveHistory(); historyWarned = false; log.innerHTML = ""; greet();
};

/* =========================================================
   Google Drive panel
   ========================================================= */
function showFiles(files) {
  const box = $("driveFiles");
  box.innerHTML = "";
  for (const f of files.slice(0, 8)) {
    const a = document.createElement("a");
    a.href = f.link; a.target = "_blank"; a.rel = "noopener";
    a.textContent = f.name; a.title = `${f.type} · ${new Date(f.modified).toLocaleString()}`;
    box.appendChild(a);
  }
}
$("btnDrive").onclick = async () => {
  if (drive.connected) { drive.disconnect(); $("driveFiles").innerHTML = ""; refreshStatus(); return; }
  try {
    await drive.connect(settings.gclient);
    refreshStatus();
    $("driveHint").textContent = "Connected. Recent files:";
    showFiles(await drive.recent(8));
  } catch (err) {
    addMsg("err", err.message);
    if (!settings.gclient) openSettings();
  }
};

/* =========================================================
   Settings dialog
   ========================================================= */
const dlg = $("settings");
function openSettings() {
  closePanels();
  $("setKey").value = settings.key; $("setModel").value = settings.model; $("setEffort").value = settings.effort;
  $("setWeb").checked = settings.web; $("setName").value = settings.name; $("setSpeak").checked = settings.speak;
  $("setWake").checked = settings.wake; $("setVoice").value = settings.voice; $("setGClient").value = settings.gclient;
  $("setWake").disabled = !SR;
  dlg.showModal();
}
$("btnSettings").onclick = openSettings;
dlg.addEventListener("close", () => {
  if (dlg.returnValue !== "save") return;
  const wasWake = settings.wake;
  settings = {
    key: $("setKey").value.trim(), model: $("setModel").value, effort: $("setEffort").value, web: $("setWeb").checked,
    name: $("setName").value.trim(), speak: $("setSpeak").checked, wake: $("setWake").checked,
    voice: $("setVoice").value, gclient: $("setGClient").value.trim(),
  };
  store.set("settings", settings);
  safeMode = false; store.set("safeModeV2", false);
  refreshStatus();
  if (settings.wake && !wasWake) { addMsg("sys", 'Wake word active. Say "Jarvis" followed by your request.'); resumeWake(); }
  if (!settings.wake && wasWake) stopWake();
});

/* =========================================================
   Boot
   ========================================================= */
renderNotes();
refreshStatus();
setState("idle");
if (history.length) { restoreTranscript(); addMsg("sys", "Previous session restored."); } else greet();
resumeWake();

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* app still works without offline cache */ });
}
