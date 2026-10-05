/* Explicitly injected regression fixture, not a player completion run.
 * Production emberbat splitting must not disappear from the remaining count. */
"use strict";
const fs = require("node:fs"), path = require("node:path"), http = require("node:http"), assert = require("node:assert/strict");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const generation = (require("../package.json").pwaVersion.match(/^td-(r\d+)-/) || [])[1] || "r79";
const OUT = path.join(ROOT, `docs/evidence/${generation.toUpperCase()}/ui-review`);
(async () => {
  const server = http.createServer((req, res) => {
    const file = path.resolve(ROOT, "." + (new URL(req.url, "http://local").pathname === "/" ? "/index.html" : decodeURIComponent(new URL(req.url, "http://local").pathname)));
    if (path.relative(ROOT, file).startsWith("..") || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(() => localStorage.setItem("td_tutorial_seen", "1"));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => !!window.TD);
    await page.locator(".diff-opt").first().click(); await page.locator(".map-opt").first().click();
    await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"));
    const evidence = await page.evaluate(() => {
      TD.newGame({ runSeed: 104729, affixSeed: 130363 });
      const st = TD.state(); st.running = true; st.paused = false; st.wave = 1; st.waveTotal = 1; st.waveResolved = 0; st.betweenWaves = false;
      const parent = TD.debug.spawnEnemy("emberbat", { speed: 0 }); parent._waveTracked = true;
      TD.debug.killEnemy(parent); window.__tdUI();
      const first = { remaining: st.enemies.filter(e => !e._dead && !e._leaked && e.hp > 0).length,
        title: document.getElementById("briefTitle").textContent, meter: document.getElementById("waveMeterText").textContent,
        pct: Number(document.getElementById("waveMeter").getAttribute("aria-valuenow")) };
      st.spawnQueue = [{ type: "slime", hpScale: 1 }]; window.__tdUI();
      const queued = document.getElementById("briefTitle").textContent;
      st.spawnQueue = []; st.enemies.filter(e => !e._dead).forEach(e => TD.debug.killEnemy(e));
      // Production keeps death sprites until their reaction finishes.
      for (let tick = 0; tick < 60 && !st.betweenWaves; tick++) TD.debug.stepSimulation(1 / 60);
      window.__tdUI();
      return { method: "Injected wave counters/held scheduler; genuine production emberbat kill/split and wave clear", first, queued,
        clear: { betweenWaves: st.betweenWaves, text: document.getElementById("waveMeterText").textContent } };
    });
    assert.equal(evidence.first.remaining, 1); assert(evidence.first.title.includes("尚餘 1 隻"));
    assert(evidence.first.pct < 100 && evidence.first.meter.includes("分裂 1"));
    assert(evidence.queued.includes("尚餘 2 隻")); assert(evidence.clear.betweenWaves && evidence.clear.text === "CLEAR");
    fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, "split-progress.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log("PASS live split enemy and queued enemy remain visible; 100% reserved for actual clear");
  } finally { await browser.close(); server.closeAllConnections?.(); server.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
