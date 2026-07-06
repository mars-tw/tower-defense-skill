const CACHE_VERSION = "td-r37-v1";
const HTML_CACHE = `${CACHE_VERSION}-html`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./sw.js",
  "./src/config.js",
  "./src/heroes.js",
  "./src/rules.js",
  "./src/game.js",
  "./src/ui.js",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png"
];

const ASSET_RE = /\/assets\/(?:heroes|enemies|towers|skills|projectiles|tiles|core)\/.*\.png(?:\?|$)/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(ASSET_CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("td-") && !key.startsWith(CACHE_VERSION))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(HTML_CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const shell = await caches.match("./index.html");
    if (shell) return shell;
    return caches.match("./offline.html");
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok) cache.put(request, fresh.clone());
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate" || url.pathname.endsWith(".html") || url.pathname === "/") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (ASSET_RE.test(url.pathname) || /\.(?:js|css|webmanifest|png)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
