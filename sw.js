const CACHE_VERSION = "td-r57-v1";
const HTML_CACHE = `${CACHE_VERSION}-html`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./offline.html",
  "./manifest.webmanifest?v=td-r57-v1",
  "./sw.js",
  "./src/config.js?v=td-r57-v1",
  "./src/heroes.js?v=td-r57-v1",
  "./src/rules.js?v=td-r57-v1",
  "./src/lore.js?v=td-r57-v1",
  "./src/game.js?v=td-r57-v1",
  "./src/ui.js?v=td-r57-v1",
  "./assets/core/goddess.png",
  "./assets/enemies/bat.png",
  "./assets/enemies/boss.png",
  "./assets/enemies/emberbat.png",
  "./assets/enemies/frostwolf.png",
  "./assets/enemies/frostwraith.png",
  "./assets/enemies/goblin.png",
  "./assets/enemies/imp.png",
  "./assets/enemies/lavagolem.png",
  "./assets/enemies/medic.png",
  "./assets/enemies/orc.png",
  "./assets/enemies/shieldman.png",
  "./assets/enemies/slime.png",
  "./assets/enemies/thunderronin.png",
  "./assets/enemies/abysshound.png",
  "./assets/enemies/yaksha.png",
  "./assets/heroes/archer/down.png",
  "./assets/heroes/archer/left.png",
  "./assets/heroes/archer/right.png",
  "./assets/heroes/archer/up.png",
  "./assets/heroes/cleric/down.png",
  "./assets/heroes/cleric/left.png",
  "./assets/heroes/cleric/right.png",
  "./assets/heroes/cleric/up.png",
  "./assets/heroes/daji.png",
  "./assets/heroes/erlangshen.png",
  "./assets/heroes/guanyu.png",
  "./assets/heroes/iceMage/down.png",
  "./assets/heroes/iceMage/left.png",
  "./assets/heroes/iceMage/right.png",
  "./assets/heroes/iceMage/up.png",
  "./assets/heroes/knight/down.png",
  "./assets/heroes/knight/left.png",
  "./assets/heroes/knight/right.png",
  "./assets/heroes/knight/up.png",
  "./assets/heroes/mage/down.png",
  "./assets/heroes/mage/left.png",
  "./assets/heroes/mage/right.png",
  "./assets/heroes/mage/up.png",
  "./assets/heroes/nezha.png",
  "./assets/heroes/niumowang.png",
  "./assets/heroes/valkyrie/down.png",
  "./assets/heroes/valkyrie/left.png",
  "./assets/heroes/valkyrie/right.png",
  "./assets/heroes/valkyrie/up.png",
  "./assets/heroes/wukong.png",
  "./assets/heroes/baisuzhen.png",
  "./assets/heroes/leizhenzi.png",
  "./assets/heroes/zhongkui.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/projectiles/arrow.png",
  "./assets/projectiles/cannonball.png",
  "./assets/projectiles/fireball.png",
  "./assets/projectiles/iceshard.png",
  "./assets/projectiles/lightning.png",
  "./assets/particles/kenney-fire.png",
  "./assets/particles/kenney-smoke.png",
  "./assets/particles/kenney-flash.png",
  "./assets/particles/kenney-magic.png",
  "./assets/particles/kenney-spark.png",
  "./assets/particles/kenney-ice-ring.png",
  "./assets/skills/freeze.png",
  "./assets/skills/judgment.png",
  "./assets/skills/meteor.png",
  "./assets/skills/sealarray.png",
  "./assets/skills/thunder.png",
  "./assets/tiles/bush.png",
  "./assets/tiles/grass1.png",
  "./assets/tiles/grass2.png",
  "./assets/tiles/grass3.png",
  "./assets/tiles/path.png",
  "./assets/tiles/rock.png",
  "./assets/tiles/tree.png",
  "./assets/towers/arrow.png",
  "./assets/towers/arcane.png",
  "./assets/towers/cannon.png",
  "./assets/towers/frost.png",
  "./assets/towers/sniper.png",
  "./assets/towers/tesla.png"
];

const ASSET_RE = /\/assets\/(?:heroes|enemies|towers|skills|projectiles|particles|tiles|core)\/.*\.png(?:\?|$)/;

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
