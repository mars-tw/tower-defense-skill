/* td R64 UX evidence: three real responsive viewports and real canvas clicks. */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "evidence", "R64_ux");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };

function server() {
  return new Promise((resolve) => {
    const instance = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
      const file = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
      const rel = path.relative(ROOT, file);
      if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    instance.listen(0, "127.0.0.1", () => resolve(instance));
  });
}

async function enterGame(page, base) {
  await page.addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("td_tutorial_seen", "1");
  });
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.TD && window.TD.state && window.__tdUI);
  await page.evaluate(() => {
    const normal = [...document.querySelectorAll(".diff-opt")].find((button) => button.textContent.includes("普通"));
    if (normal) normal.click();
    const plains = [...document.querySelectorAll(".map-opt")].find((button) => button.textContent.includes("翠綠平原"));
    if (plains) plains.click();
  });
  await page.waitForTimeout(2800);
}

async function buildablePoint(page) {
  return page.evaluate(() => {
    let best = null;
    for (let y = 24; y < 640; y += 48) {
      for (let x = 24; x < 960; x += 48) {
        const options = window.TD.buildOptionsAt(x, y);
        if (!options.includes("arrow")) continue;
        const score = Math.hypot(x - 480, y - 280);
        if (!best || score < best.score) best = { x, y, score };
      }
    }
    return best;
  });
}

async function clickWorld(page, point) {
  const rect = await page.locator("#game").boundingBox();
  await page.mouse.click(rect.x + point.x * rect.width / 960, rect.y + point.y * rect.height / 640);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await server();
  const base = `http://127.0.0.1:${app.address().port}/index.html`;
  const browser = await chromium.launch();
  try {
    const cases = [
      { name: "mobile-390x844-control-deck.png", viewport: { width: 390, height: 844 }, action: "mobile" },
      { name: "tablet-820x1180-build-wheel.png", viewport: { width: 820, height: 1180 }, action: "wheel" },
      { name: "desktop-1920x1080-tower-bubble.png", viewport: { width: 1920, height: 1080 }, action: "tower" },
    ];
    for (const item of cases) {
      const context = await browser.newContext({ viewport: item.viewport, hasTouch: item.action === "mobile", isMobile: item.action === "mobile" });
      const page = await context.newPage();
      await enterGame(page, base);
      if (item.action === "wheel" || item.action === "tower") {
        const point = await buildablePoint(page);
        await clickWorld(page, point);
        await page.waitForSelector('[data-testid="build-wheel"]:not(.hidden)');
        if (item.action === "tower") {
          await page.locator('.wheel-tower-btn[data-type="arrow"]').click();
          await clickWorld(page, point);
          await page.waitForSelector('[data-testid="tower-action-bubble"]:not(.hidden)');
          await page.waitForTimeout(2100);
        }
      }
      const metrics = await page.evaluate(() => {
        const canvas = document.getElementById("game").getBoundingClientRect();
        const deck = document.getElementById("sceneControls").getBoundingClientRect();
        return { canvas: [Math.round(canvas.width), Math.round(canvas.height)], deckBottom: Math.round(deck.bottom), viewport: [innerWidth, innerHeight] };
      });
      await page.screenshot({ path: path.join(OUT, item.name) });
      console.log(`${item.name}: ${JSON.stringify(metrics)}`);
      await context.close();
    }
  } finally {
    await browser.close();
    app.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
