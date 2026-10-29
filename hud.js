// Animated arc-reactor style HUD drawn on a canvas.
// State: idle | listening | thinking | speaking. `level` (0..1) makes the rings react to sound.

const CYAN = [63, 232, 255];
const rgba = (a) => `rgba(${CYAN[0]},${CYAN[1]},${CYAN[2]},${a})`;
const DEG = Math.PI / 180;

export function createHUD(canvas) {
  const ctx = canvas.getContext("2d");
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let state = "idle";
  let level = 0;        // target level from audio
  let smooth = 0;       // smoothed level
  let rot = [0, 0, 0, 0];
  let last = performance.now();
  let w = 0, h = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  const speeds = { idle: 1, listening: 1.6, thinking: 4.5, speaking: 2 };

  function arc(r, a0, a1, width, alpha, blur = 10) {
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.lineWidth = width;
    ctx.strokeStyle = rgba(alpha);
    ctx.shadowBlur = blur;
    ctx.shadowColor = rgba(0.9);
    ctx.stroke();
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const sp = reduceMotion ? 0.15 : speeds[state] || 1;
    rot[0] += dt * 0.12 * sp;
    rot[1] -= dt * 0.22 * sp;
    rot[2] += dt * 0.35 * sp;
    rot[3] -= dt * 0.08 * sp;

    // Idle "breathing" when there is no sound input.
    const breathe = state === "idle" ? 0.08 + 0.05 * Math.sin(now / 900) : 0;
    const target = Math.max(level, breathe, state === "thinking" ? 0.25 + 0.15 * Math.sin(now / 160) : 0);
    smooth += (target - smooth) * Math.min(1, dt * 10);

    ctx.clearRect(0, 0, w, h);
    const R = Math.min(w, h) * 0.47;
    if (R <= 10) return requestAnimationFrame(frame);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.lineCap = "butt";

    // Soft glow behind the core.
    const g = ctx.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 1.05);
    g.addColorStop(0, rgba(0.16 + smooth * 0.25));
    g.addColorStop(0.45, rgba(0.05));
    g.addColorStop(1, rgba(0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.05, 0, Math.PI * 2); ctx.fill();

    // 1. Outer hairline ring.
    arc(R, 0, Math.PI * 2, 1, 0.35, 4);

    // 2. Outer tick ring with gaps.
    ctx.save();
    ctx.rotate(rot[0]);
    ctx.shadowBlur = 6; ctx.shadowColor = rgba(0.8);
    for (let i = 0; i < 180; i++) {
      if (i % 45 > 37) continue;
      const a = i * 2 * DEG;
      const long = i % 5 === 0;
      const r0 = R * 0.925, r1 = R * (long ? 0.975 : 0.955);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.lineWidth = long ? 2 : 1;
      ctx.strokeStyle = rgba(long ? 0.85 : 0.45);
      ctx.stroke();
    }
    ctx.restore();

    // 3. Medium segmented arcs (counter-rotating).
    ctx.save();
    ctx.rotate(rot[1]);
    for (let k = 0; k < 4; k++) {
      const a0 = k * 90 * DEG;
      arc(R * 0.86, a0, a0 + 52 * DEG, 3, 0.55, 8);
      arc(R * 0.86, a0 + 58 * DEG, a0 + 64 * DEG, 3, 0.85, 8);
    }
    ctx.restore();

    // 4. Dotted ring.
    ctx.save();
    ctx.rotate(rot[3]);
    ctx.fillStyle = rgba(0.55);
    ctx.shadowBlur = 4;
    for (let i = 0; i < 90; i++) {
      const a = i * 4 * DEG;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78, i % 6 === 0 ? 2 : 1, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // 5. Bright thick arcs.
    ctx.save();
    ctx.rotate(rot[2]);
    const thick = 5 + smooth * 6;
    arc(R * 0.69, 0, 112 * DEG, thick, 0.9, 18);
    arc(R * 0.69, 140 * DEG, 205 * DEG, thick, 0.75, 18);
    arc(R * 0.69, 232 * DEG, 330 * DEG, thick, 0.9, 18);
    ctx.restore();
    arc(R * 0.635, 0, Math.PI * 2, 1, 0.3, 2);

    // 6. Audio-reactive radial bars.
    ctx.save();
    ctx.rotate(-rot[0] * 0.5);
    const bars = 72;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      const n = 0.5 + 0.5 * Math.sin(i * 1.7 + now / 220) * Math.cos(i * 0.6 - now / 410);
      const len = R * (0.03 + smooth * 0.11 * n + 0.012);
      const r0 = R * 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * (r0 + len), Math.sin(a) * (r0 + len));
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = rgba(0.35 + n * 0.5);
      ctx.shadowBlur = 8; ctx.shadowColor = rgba(0.9);
      ctx.stroke();
    }
    ctx.restore();

    // 7. Inner core rings.
    arc(R * 0.44, 0, Math.PI * 2, 2, 0.7 + smooth * 0.3, 16);
    ctx.save();
    ctx.rotate(-rot[2] * 0.7);
    arc(R * 0.405, 10 * DEG, 80 * DEG, 1.5, 0.6, 6);
    arc(R * 0.405, 190 * DEG, 260 * DEG, 1.5, 0.6, 6);
    ctx.restore();

    // State accent: listening adds a red-shifted ping ring.
    if (state === "listening") {
      const p = (now % 1400) / 1400;
      ctx.beginPath();
      ctx.arc(0, 0, R * (0.44 + p * 0.55), 0, Math.PI * 2);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = rgba(0.5 * (1 - p));
      ctx.shadowBlur = 0;
      ctx.stroke();
    }

    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setState(s) { state = s; },
    setLevel(v) { level = Math.max(0, Math.min(1, v)); },
  };
}
