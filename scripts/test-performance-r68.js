/* td R68 clean-browser frame cadence gate: desktop/mobile, three runs, median p95 <= 18ms. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = path.join(ROOT, "docs", "evidence", "R68");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css" };
const TARGETS = [
  { name: "desktop", w: 1440, h: 780, touch: false },
  { name: "mobile", w: 390, h: 844, touch: true },
];

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
      const filePath = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
      const relative = path.relative(ROOT, filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function percentile(values, ratio) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function run() {
  const { chromium } = require("playwright");
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch();
  const output = [];
  let failed = 0;
  try {
    for (const target of TARGETS) {
      const context = await browser.newContext({ viewport: { width: target.w, height: target.h }, hasTouch: target.touch, isMobile: target.touch });
      const page = await context.newPage();
      await page.addInitScript(() => { localStorage.setItem("td_tutorial_seen", "1"); });
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForFunction(() => window.TD && window.TD.debug && window.TD.state, null, { timeout: 15000 });
      await page.locator(".diff-opt").first().click();
      await page.locator(".map-opt").first().click();
      await page.evaluate(() => {
        const state = window.TD.state();
        state.running = true;
        state.enemies = [];
        for (let index = 0; index < 18; index++) {
          const enemy = window.TD.debug.spawnEnemy(index === 0 ? "boss" : "slime", {
            x: 40 + (index % 20) * 44, y: 80 + (index % 10) * 48, speed: 0, hp: 99999, maxHp: 99999, wp: 1,
          });
          enemy.speed = 0;
        }
      });
      await page.waitForTimeout(300);
      // Decode/atlas/tint cache warm-up is not part of steady-state frame cost.
      await page.evaluate(() => { for (let index = 0; index < 30; index++) window.TD.debug.step(1 / 60); });
      const p95Runs = [];
      for (let runIndex = 0; runIndex < 3; runIndex++) {
        const costs = await page.evaluate(() => new Promise((resolve) => {
          const values = [];
          function frame() {
            const start = performance.now();
            window.TD.debug.step(1 / 60);
            values.push(performance.now() - start);
            if (values.length >= 120) resolve(values);
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        }));
        p95Runs.push(percentile(costs, .95));
      }
      const median = [...p95Runs].sort((a, b) => a - b)[1];
      const line = `${target.name} ${target.w}x${target.h}: p95 runs ${p95Runs.map((value) => value.toFixed(2)).join(" / ")} ms; median ${median.toFixed(2)} ms`;
      console.log(line);
      output.push(line);
      if (median > 18) failed++;
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  fs.writeFileSync(path.join(EVIDENCE, "performance-gate.txt"), output.join("\n") + "\n");
  if (failed) { console.error(`R68 performance gate failed: ${failed}`); process.exit(1); }
  console.log("R68 performance gate passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
