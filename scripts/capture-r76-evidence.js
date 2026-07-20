/* R76 evidence capture: real mobile taps for the three enemy chips plus defeat navigation CTA.
 * Usage: node scripts/capture-r76-evidence.js <before|after>
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PHASE = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(ROOT, "docs", "evidence", "r76", PHASE);
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".css": "text/css",
};
const VIEWPORTS = [
  { w: 390, h: 844, name: "390x844", mobile: true },
  { w: 844, h: 390, name: "844x390", mobile: true },
  { w: 1366, h: 768, name: "1366x768", mobile: false },
];
const ENEMY_IDS = ["slime", "goblin", "emberbat"];

async function closeWithin(closePromise, ms = 3000) {
  await Promise.race([
    closePromise.catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, ms)),
  ]);
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
      const fp = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
      const rel = path.relative(ROOT, fp);
      if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
      fs.createReadStream(fp).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function enterGame(page) {
  await page.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 60000 });
  await page.waitForTimeout(200);
  const diff = page.locator(".diff-opt").filter({ hasText: "普通" }).first();
  if (await diff.isVisible().catch(() => false)) await diff.click({ timeout: 60000 });
  await page.waitForTimeout(150);
  const map = page.locator('.map-opt[data-map-id="plains"]');
  if (await map.isVisible().catch(() => false)) await map.click({ timeout: 60000 });
  await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 8000 });
  await page.waitForTimeout(250);
}

async function prepareThreeEnemyPreview(page) {
  await page.evaluate(() => {
    window.TD.newGame({ runSeed: 4, affixSeed: 777 });
    const state = window.TD.state();
    state.wave = 0;
    state.betweenWaves = true;
    state.running = false;
    state.over = false;
    state.waveSeeds = {};
    window.__tdUI();
    const drawer = document.querySelector(".intel-drawer");
    if (drawer) drawer.setAttribute("open", "");
  });
  await page.waitForTimeout(250);
  await page.waitForFunction((ids) => ids.every((id) => document.querySelector(`#nextWaveCard .enemy-chip-btn[data-enemy="${id}"]`)), ENEMY_IDS);
}

async function tapEnemy(page, id) {
  await page.evaluate(() => {
    const info = document.getElementById("enemyInfo");
    info.classList.add("hidden");
    info.innerHTML = "";
    document.querySelectorAll(".enemy-chip-btn").forEach((btn) => btn.classList.remove("active"));
  });
  const button = page.locator(`#nextWaveCard .enemy-chip-btn[data-enemy="${id}"]`);
  await button.scrollIntoViewIfNeeded();
  const box = await button.boundingBox();
  if (!box) throw new Error(`enemy chip ${id} has no bounding box`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  const result = await page.evaluate((enemyId) => {
    const buttonEl = document.querySelector(`#nextWaveCard .enemy-chip-btn[data-enemy="${enemyId}"]`);
    const info = document.getElementById("enemyInfo");
    const row = buttonEl && buttonEl.closest(".enemy-chip-row");
    return {
      enemyId,
      rowInert: !!(row && row.inert),
      active: !!(buttonEl && buttonEl.classList.contains("active")),
      detailShown: !!info && !info.classList.contains("hidden"),
      detailText: info ? info.textContent.replace(/\s+/g, " ").trim() : "",
    };
  }, id);
  if (result.detailShown) {
    await page.locator("#enemyInfo").scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await page.screenshot({ path: path.join(OUT, `${page.viewportSize().width}x${page.viewportSize().height}-enemy-${id}-tap.png`) });
  return result;
}

async function run() {
  const { chromium } = require("playwright");
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const measurements = { phase: PHASE, generatedAt: new Date().toISOString(), viewports: [] };
  fs.mkdirSync(OUT, { recursive: true });
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, hasTouch: vp.mobile, isMobile: vp.mobile,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("td_tutorial_seen", "1");
      });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
      await enterGame(page);
      const viewportResult = { viewport: `${vp.w}x${vp.h}`, enemyTaps: [] };

      if (vp.mobile) {
        await prepareThreeEnemyPreview(page);
        for (const id of ENEMY_IDS) viewportResult.enemyTaps.push(await tapEnemy(page, id));
      }

      await page.evaluate(() => {
        window.__tdGameOver(12, 3400, {
          kills: 46, soulEarned: 24, leaks: 2,
          heroGrowth: [{ id: "knight", xp: 120, level: 3, levelsGained: 1 }],
          towers: [{ type: "arrow", level: 4 }],
        });
      });
      await page.waitForTimeout(200);
      const menuButton = page.locator("#mainMenuBtn");
      if (await menuButton.count()) await menuButton.scrollIntoViewIfNeeded();
      else await page.locator("#restartBtn").scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      viewportResult.defeat = await page.evaluate(() => {
        const button = document.getElementById("mainMenuBtn");
        const overlay = document.getElementById("overlay");
        return {
          overlayShown: overlay.classList.contains("show"),
          mainMenuPresent: !!button,
          mainMenuVisible: !!button && button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0,
        };
      });
      await page.screenshot({ path: path.join(OUT, `${vp.name}-defeat-actions.png`) });
      if (viewportResult.defeat.mainMenuPresent) {
        await menuButton.click({ noWaitAfter: true, timeout: 60000 });
        await page.waitForTimeout(150);
        viewportResult.defeat.returned = await page.evaluate(() => ({
          overlayShown: document.getElementById("overlay").classList.contains("show"),
          difficultyShown: document.getElementById("diffOverlay").classList.contains("show"),
          mapShown: document.getElementById("mapOverlay").classList.contains("show"),
          wave: window.TD.state().wave,
          over: window.TD.state().over,
        }));
        await page.screenshot({ path: path.join(OUT, `${vp.name}-main-menu-return.png`) });
      }
      measurements.viewports.push(viewportResult);
      await page.evaluate(async () => {
        if (!navigator.serviceWorker) return;
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }).catch(() => {});
      await page.goto("about:blank").catch(() => {});
      await closeWithin(context.close());
    }
  } finally {
    await closeWithin(browser.close());
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  }
  fs.writeFileSync(path.join(OUT, "measurements.json"), JSON.stringify(measurements, null, 2) + "\n");
  console.log(`R76 ${PHASE} evidence written to ${OUT}`);
}

run().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
