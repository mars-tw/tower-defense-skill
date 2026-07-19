/* R75 evidence capture: before/after screenshots for the three audit viewports.
 * Usage: node scripts/capture-r75-evidence.js <before|after>
 * Scenes: battlefield, game-over overlay (real __tdGameOver), landscape drawers, gacha reveal, 64px unit crops. */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PHASE = process.argv[2] === "after" ? "after" : "before";
const OUT = path.join(ROOT, "docs", "evidence", "r75", PHASE);
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".css": "text/css",
};

const VIEWPORTS = [
  { w: 390, h: 844, name: "390x844", mobile: true },
  { w: 844, h: 390, name: "844x390", mobile: true },
  { w: 1366, h: 768, name: "1366x768", mobile: false },
];

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
  await page.waitForTimeout(250);
  const tutorialShown = await page.evaluate(() => document.getElementById("tutorial").classList.contains("show"));
  if (tutorialShown) {
    await page.locator("#tutorialQuick").click({ noWaitAfter: true, timeout: 60000 });
  } else {
    const diffShown = await page.evaluate(() => document.getElementById("diffOverlay").classList.contains("show"));
    if (diffShown) {
      await page.locator(".diff-opt").first().click({ noWaitAfter: true, timeout: 60000 });
      await page.waitForTimeout(150);
      await page.locator(".map-opt").first().click({ noWaitAfter: true, timeout: 60000 });
    }
  }
  await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 8000 });
  await page.waitForTimeout(600);
}

async function run() {
  const { chromium } = require("playwright");
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  fs.mkdirSync(OUT, { recursive: true });
  try {
    for (const vp of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, hasTouch: vp.mobile, isMobile: vp.mobile,
      });
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.clear());
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
      await enterGame(page);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-battlefield.png`) });

      // 64px 縮圖可辨檢核：戰場中央放一座塔後取 canvas 特寫縮到 64px（僅桌機視口做一次）。
      if (!vp.mobile) {
        const crop = await page.evaluate(() => {
          const st = window.TD.state();
          const canvas = document.getElementById("game");
          const gd = st.goddess || { x: 480, y: 320 };
          const towerAt = (st.towers && st.towers[0]) || null;
          const focus = towerAt || gd;
          const scaleX = canvas.getBoundingClientRect().width / canvas.width;
          const scaleY = canvas.getBoundingClientRect().height / canvas.height;
          const rect = canvas.getBoundingClientRect();
          return {
            x: rect.x + (focus.x - 64) * scaleX, y: rect.y + (focus.y - 64) * scaleY,
            w: 128 * scaleX, h: 128 * scaleY,
          };
        });
        await page.screenshot({
          path: path.join(OUT, `${vp.name}-unit-close.png`),
          clip: { x: Math.max(0, crop.x), y: Math.max(0, crop.y), width: Math.max(16, crop.w), height: Math.max(16, crop.h) },
        });
      }

      // 抽屜（行動視口）：landscape 是 P0 現場。
      if (vp.mobile) {
        await page.locator("#intelDrawerToggle").click({ noWaitAfter: true, timeout: 60000 });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(OUT, `${vp.name}-drawer-intel.png`) });
        const closeBtn = page.locator(".intel-drawer .drawer-close-btn");
        if (await closeBtn.isVisible().catch(() => false)) {
          await closeBtn.click({ noWaitAfter: true, timeout: 60000 }).catch(() => {});
        } else {
          await page.evaluate(() => document.querySelector(".intel-drawer").removeAttribute("open"));
        }
        await page.waitForTimeout(200);
      }

      // 真實結算 overlay：走 onGameOver 實路徑灌內容。
      await page.evaluate(() => {
        window.__tdGameOver(12, 3400, {
          kills: 46, soulEarned: 24, leaks: 2,
          heroGrowth: [{ id: "knight", xp: 120, level: 3, levelsGained: 1 }],
          towers: [{ type: "arrow", level: 4 }],
        });
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-overlay-top.png`) });
      await page.evaluate(() => {
        const btn = document.getElementById("restartBtn");
        if (btn && btn.scrollIntoView) btn.scrollIntoView({ block: "center" });
      });
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(OUT, `${vp.name}-overlay-bottom.png`) });

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`R75 ${PHASE} evidence written to ${OUT}`);
}

run().catch((error) => { console.error(error); process.exit(1); });
