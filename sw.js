// Offline support: cache the app shell, always go to the network for APIs.
const CACHE = "jarvis-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "hud.js", "drive.js", "icon.svg", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const CDN = /^https:\/\/(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com)\//;

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !CDN.test(req.url)) return; // Anthropic, Google APIs: network only

  // Network first (so updates show up), falling back to cache when offline.
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error())))
  );
});
