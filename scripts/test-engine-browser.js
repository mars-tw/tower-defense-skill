#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const generation = (require("../package.json").pwaVersion.match(/^td-(r\d+)-/) || [])[1] || "r78";
const OUT = path.resolve(ROOT, process.env.TD_ENGINE_EVIDENCE_DIR || `docs/evidence/${generation.toUpperCase()}/engine-regression`);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const file = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
    const relative = path.relative(ROOT, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png",
      ".json": "application/json", ".webp": "image/webp", ".webmanifest": "application/manifest+json" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  const evidence = { errors: [], maps: {}, touch: {}, performance: {} };
  try {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => evidence.errors.push(error.message));
    await page.addInitScript(() => { localStorage.setItem("td_tutorial_seen", "1"); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.TD && window.TD.debug.engineStats);
    await page.locator(".diff-opt").first().click();
    await page.locator(".map-opt").first().click();
    await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"));
    await page.waitForTimeout(600);
    for (const mapId of ["plains", "canyon", "lava"]) {
      await page.evaluate((id) => { TD.setMap(id); TD.newGame({ runSeed: 104729, affixSeed: 130363 }); TD.state().banner = null; }, mapId);
      await page.waitForTimeout(100);
      evidence.maps[mapId] = await page.evaluate(() => {
        const s = TD.state(), c = document.getElementById("game"), cx = c.getContext("2d");
        const rgba = cx.getImageData(0, 0, c.width, c.height).data;
        const linear = (n) => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
        const luma = (x, y) => { const i = (y * c.width + x) * 4; return .2126 * linear(rgba[i]) + .7152 * linear(rgba[i + 1]) + .0722 * linear(rgba[i + 2]); };
        const road = [], ground = [];
        for (let y = 24; y < c.height - 24; y += 8) for (let x = 24; x < c.width - 24; x += 8) {
          const distance = TDRules.distanceToPath(x, y, s.path);
          if (distance <= 16) road.push(luma(x, y));
          else if (distance >= 62 && distance <= 92) ground.push(luma(x, y));
        }
        const mean = (values) => values.reduce((sum, n) => sum + n, 0) / values.length;
        const roadLuma = mean(road), groundLuma = mean(ground);
        return { roadLuma, groundLuma, contrastRatio: (Math.max(roadLuma, groundLuma) + .05) / (Math.min(roadLuma, groundLuma) + .05), cache: TD.debug.engineStats() };
      });
      assert(evidence.maps[mapId].contrastRatio >= 1.25, `${mapId}: road must remain readable`);
      await page.locator("#game").screenshot({ path: path.join(OUT, `${mapId}-board.png`) });
    }
    await page.evaluate(() => {
      TD.setMap("plains"); TD.newGame(); TD.state().banner = null;
      TD.state().running = true; // hold automatic rendering while measuring the production debug.step path
      for (let index = 0; index < 18; index++) TD.debug.spawnEnemy(index ? "slime" : "boss", {
        x: 40 + index * 44, y: 100 + index % 8 * 48, speed: 0, hp: 99999, maxHp: 99999, wp: 1,
      });
      for (let frame = 0; frame < 30; frame++) TD.debug.step(1 / 60);
    });
    await page.waitForTimeout(500);
    evidence.performance = await page.evaluate(() => new Promise((resolve) => {
      const values = [], before = TD.debug.engineStats();
      function frame() {
        const start = performance.now(); TD.debug.step(1 / 60); values.push(performance.now() - start);
        if (values.length < 120) requestAnimationFrame(frame);
        else { values.sort((a, b) => a - b); resolve({ samples: values.length, medianMs: values[60], p95Ms: values[114],
          maxMs: values[119], before, after: TD.debug.engineStats() }); }
      }
      requestAnimationFrame(frame);
    }));
    assert.equal(evidence.performance.after.backgroundBakes, evidence.performance.before.backgroundBakes);
    assert.equal(evidence.performance.after.pathBakes, evidence.performance.before.pathBakes);
    assert(evidence.performance.p95Ms <= 18, `single-run p95 ${evidence.performance.p95Ms} ms exceeds existing frame budget`);
    evidence.hitFlash = await page.evaluate(() => {
      TD.newGame(); TD.state().banner = null; TD.state().running = true; TD.setPerformanceMode("high");
      const st = TD.state(), ctx = document.getElementById("game").getContext("2d"), drawImage = ctx.drawImage;
      const frames = [], seen = new Set();
      ctx.drawImage = function (...args) {
        const image = args[0];
        if (image instanceof HTMLCanvasElement && image.width === 128 && image.height === 128 && args.length === 5 && !seen.has(image)) {
          seen.add(image);
          const data = image.getContext("2d").getImageData(0, 0, 128, 128).data;
          let opaque = 0, transparent = 0, nonWhite = 0, hash = 2166136261;
          for (let i = 0; i < data.length; i += 4) {
            const alpha = data[i + 3]; hash = Math.imul(hash ^ alpha, 16777619) >>> 0;
            if (alpha) { opaque++; if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) nonWhite++; }
            else transparent++;
          }
          frames.push({ opaque, transparent, nonWhite, alphaHash: hash });
        }
        return drawImage.apply(this, args);
      };
      const enemy = TD.debug.spawnEnemy("slime", { x: 200, y: 200, speed: 0, hp: 99999, maxHp: 99999, hitFlash: .14, animSeed: 0 });
      TD.debug.step(.000001); enemy.walkDist = 7; TD.debug.step(.000001);
      ctx.drawImage = drawImage;
      // Exercise every atlas row/locomotion pose, then adversarial projectile
      // colors. These cache-pressure fixtures are explicit debug injections.
      for (const id of Object.keys(TD.config.ENEMIES)) for (let pose = 0; pose < 6; pose++) {
        st.enemies.length = 0;
        TD.debug.spawnEnemy(id, { x: 200, y: 200, speed: 0, hp: 99999, maxHp: 99999, hitFlash: .14,
          animSeed: 0, walkDist: pose * (TD.config.ENEMIES[id].boss ? 11 : 7) });
        TD.debug.step(.000001);
      }
      const target = st.enemies[0];
      for (let index = 0; index < 70; index++) st.bullets.push({ x: 100, y: 100, speed: 1, target,
        projectile: "arrow", color: `#${(0x334455 + index * 1733).toString(16).padStart(6, "0")}` });
      TD.debug.step(.000001);
      return { frames, cache: TD.debug.engineStats(), fixture: "all enemy poses + 70 synthetic projectile colors" };
    });
    assert.equal(evidence.hitFlash.frames.length, 2, "two walk poses have separate hit textures");
    assert(evidence.hitFlash.frames.every((frame) => frame.opaque > 0 && frame.transparent > 0 && frame.nonWhite === 0),
      "hit texture keeps a transparent silhouette and pure white pixels");
    assert.notEqual(evidence.hitFlash.frames[0].alphaHash, evidence.hitFlash.frames[1].alphaHash, "hurt overlay follows the changing true pose");
    assert(evidence.hitFlash.cache.hitFrameEntries <= evidence.hitFlash.cache.maxHitFrameEntries);
    assert.equal(evidence.hitFlash.cache.projectileSpriteEntries, evidence.hitFlash.cache.maxProjectileSpriteEntries,
      "adversarial colors exercise eviction without exceeding the projectile cache budget");
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const touchPage = await mobile.newPage();
    touchPage.on("pageerror", (error) => evidence.errors.push(error.message));
    await touchPage.addInitScript(() => { localStorage.setItem("td_tutorial_seen", "1"); });
    await touchPage.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
    await touchPage.waitForFunction(() => window.TD && window.TD.debug.engineStats);
    await touchPage.locator(".diff-opt").first().click(); await touchPage.locator(".map-opt").first().click();
    await touchPage.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"));
    const point = await touchPage.evaluate(() => {
      TD.newGame(); TD.state().banner = null; TD.selectTower("arrow");
      let legal;
      for (let y = 180; y < 640 && !legal; y += 40) for (let x = 340; x < 960; x += 40) {
        const preview = TD.buildPreviewAt(x, y); if (preview.ok) { legal = preview; break; }
      }
      const canvas = document.getElementById("game"), rect = canvas.getBoundingClientRect();
      const x = rect.left + legal.x * rect.width / canvas.width, y = rect.top + legal.y * rect.height / canvas.height;
      return { x, y, cell: [legal.cx, legal.cy], cellCss: rect.width / canvas.width * TD.config.GAME.cellSize, canvasCss: [rect.width, rect.height] };
    });
    await touchPage.touchscreen.tap(point.x, point.y);
    evidence.touch = await touchPage.evaluate((point) => ({ ...point,
      preview: { ghost: !!TD.state().buildGhost, towers: TD.state().towers.length, cell: point.cell } }), point);
    assert(evidence.touch.preview.ghost && evidence.touch.preview.towers === 0);
    await touchPage.waitForTimeout(100);
    await touchPage.screenshot({ path: path.join(OUT, "mobile-build-preview.png") });
    await touchPage.touchscreen.tap(point.x, point.y);
    assert.equal(await touchPage.evaluate(() => TD.state().towers.length), 1, "second touch confirms exactly one tower");
    assert.equal(evidence.errors.length, 0);
    fs.writeFileSync(path.join(OUT, "browser-engine-evidence.json"), JSON.stringify(evidence, null, 2) + "\n");
    console.log(JSON.stringify({ maps: Object.fromEntries(Object.entries(evidence.maps).map(([id, item]) => [id, item.contrastRatio])),
      performance: { p95Ms: evidence.performance.p95Ms, medianMs: evidence.performance.medianMs, maxMs: evidence.performance.maxMs },
      touch: evidence.touch, pageErrors: evidence.errors.length }, null, 2));
    await context.close();
    await mobile.close();
  } finally { await browser.close(); server.closeAllConnections?.(); server.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
