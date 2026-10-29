// Google Drive / Docs access straight from the browser using Google Identity Services.
// The user supplies their own OAuth Client ID (see README). Tokens live in memory only.

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly", // search + read your files
  "https://www.googleapis.com/auth/drive.file",     // create docs JARVIS writes
].join(" ");
const API = "https://www.googleapis.com/drive/v3";
const MAX_CHARS = 120_000;

let tokenClient = null;
let token = null;
let tokenExpiry = 0;

export const drive = {
  get connected() { return !!token && Date.now() < tokenExpiry; },

  // Must be called from a click (opens Google's consent popup).
  connect(clientId) {
    return new Promise((resolve, reject) => {
      if (!clientId) return reject(new Error("Add your Google OAuth Client ID in Settings first."));
      if (!window.google?.accounts?.oauth2) return reject(new Error("Google sign-in library hasn't loaded. Check your connection and reload."));
      if (!tokenClient || tokenClient._cid !== clientId) {
        tokenClient = google.accounts.oauth2.initTokenClient({ client_id: clientId, scope: SCOPES, callback: () => {} });
        tokenClient._cid = clientId;
      }
      tokenClient.callback = (resp) => {
        if (resp.error) return reject(new Error(resp.error_description || resp.error));
        token = resp.access_token;
        tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        resolve();
      };
      tokenClient.error_callback = (err) => reject(new Error(err?.message || "Google sign-in was closed."));
      tokenClient.requestAccessToken({ prompt: token ? "" : "consent" });
    });
  },

  disconnect() {
    if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
    token = null; tokenExpiry = 0;
  },

  async search(query, limit = 10) {
    const parts = ["trashed = false"];
    if (query && query.trim()) {
      const q = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
      parts.push(`(name contains '${q}' or fullText contains '${q}')`);
    }
    const params = new URLSearchParams({
      q: parts.join(" and "),
      pageSize: String(Math.min(Math.max(limit, 1), 50)),
      fields: "files(id,name,mimeType,modifiedTime,webViewLink,owners(displayName))",
      orderBy: query && query.trim() ? "" : "modifiedTime desc",
    });
    if (!params.get("orderBy")) params.delete("orderBy");
    const data = await call(`${API}/files?${params}`);
    return data.files.map((f) => ({
      id: f.id, name: f.name, type: friendlyType(f.mimeType), modified: f.modifiedTime, link: f.webViewLink,
    }));
  },

  async recent(limit = 8) { return this.search("", limit); },

  async read(fileId) {
    const meta = await call(`${API}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,size`);
    const exportAs = {
      "application/vnd.google-apps.document": "text/plain",
      "application/vnd.google-apps.spreadsheet": "text/csv",
      "application/vnd.google-apps.presentation": "text/plain",
    }[meta.mimeType];
    let text;
    if (exportAs) {
      text = await call(`${API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportAs)}`, { raw: true });
    } else if (/^text\/|json|xml|csv|javascript|x-python|markdown/.test(meta.mimeType)) {
      text = await call(`${API}/files/${encodeURIComponent(fileId)}?alt=media`, { raw: true });
    } else {
      return { name: meta.name, link: meta.webViewLink, error: `Can't read ${friendlyType(meta.mimeType)} files as text yet. Ask the user to convert it to a Google Doc.` };
    }
    const truncated = text.length > MAX_CHARS;
    return {
      name: meta.name, link: meta.webViewLink, type: friendlyType(meta.mimeType),
      content: truncated ? text.slice(0, MAX_CHARS) : text,
      note: truncated ? `Only the first ${MAX_CHARS} of ${text.length} characters are included.` : undefined,
    };
  },

  async createDoc(title, content) {
    const boundary = "jarvis" + Math.random().toString(36).slice(2);
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: title, mimeType: "application/vnd.google-apps.document" }) +
      `\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
    const f = await call("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
      method: "POST", body, headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    });
    return { id: f.id, name: f.name, link: f.webViewLink };
  },
};

async function call(url, { raw = false, ...init } = {}) {
  if (!drive.connected) throw new Error("Google Drive is not connected. Ask the user to tap 'Connect Google Drive'.");
  const res = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { token = null; throw new Error("Google session expired. Ask the user to reconnect Google Drive."); }
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).error?.message || msg; } catch { /* body wasn't JSON */ }
    throw new Error(`Google Drive error ${res.status}: ${msg}`);
  }
  return raw ? res.text() : res.json();
}

function friendlyType(m = "") {
  return ({
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.folder": "Folder",
    "application/pdf": "PDF",
  })[m] || m.split("/").pop();
}
