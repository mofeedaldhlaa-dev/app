// App-shell service worker: keep the app openable without internet.
// - Precache app root ("/") and critical icons on install.
// - For navigations: try network, fall back to cached "/" so the UI still loads.
// - For static assets: cache-first with background refresh.
// - Auto-updates on new deploy via skipWaiting + clients.claim.
const CACHE = "jawad-v3";
const APP_SHELL = [
  "/",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-192-maskable.png",
  "/icons/icon-512-maskable.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // API: network-only (no offline stale API responses)
  if (url.pathname.startsWith("/api/")) return;

  // Navigations (HTML documents): network-first, fall back to cached "/"
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // cache a fresh copy of the shell whenever we get one online
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match("/"))
        )
    );
    return;
  }

  // Static assets: cache-first + background refresh
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
