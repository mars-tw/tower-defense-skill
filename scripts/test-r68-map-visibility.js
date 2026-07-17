/* td R68 full-map visibility and zero-overlay guard. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = path.join(ROOT, "docs", "evidence", "R68");
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css",
};
const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1440, h: 780 },
  { w: 1366, h: 600, shot: "after-desktop-1366x600-full-map.png" },
  { w: 1280, h: 640 },
  { w: 390, h: 844, touch: true, shot: "after-mobile-390x844-full-map.png" },
  { w: 844, h: 390, touch: true, shot: "after-landscape-844x390-full-map.png" },
];

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  OK " + msg);
  else { console.error("  FAIL " + msg); failed++; }
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
      const safePath = pathname === "/" ? "/index.html" : pathname;
      const filePath = path.resolve(ROOT, "." + safePath);
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

function auditMapInPage() {
  const canvas = document.getElementById("game");
  const host = document.getElementById("battlefieldScroll");
  const dock = document.getElementById("sceneControls");
  const canvasRect = canvas.getBoundingClientRect();
  const hostRect = host.getBoundingClientRect();
  const dockRect = dock.getBoundingClientRect();
  const inset = Math.max(4, Math.min(8, Math.floor(Math.min(canvasRect.width, canvasRect.height) * .025)));
  const points = [
    [canvasRect.left + inset, canvasRect.top + inset, "top-left"],
    [canvasRect.right - inset, canvasRect.top + inset, "top-right"],
    [canvasRect.left + inset, canvasRect.bottom - inset, "bottom-left"],
    [canvasRect.right - inset, canvasRect.bottom - inset, "bottom-right"],
    [canvasRect.left + canvasRect.width / 2, canvasRect.top + canvasRect.height / 2, "center"],
  ].map(([x, y, label]) => {
    const hit = document.elementFromPoint(x, y);
    return { label, hit: hit === canvas, hitName: hit ? (hit.id || hit.className || hit.tagName) : "none" };
  });
  const overlapWidth = Math.max(0, Math.min(canvasRect.right, dockRect.right) - Math.max(canvasRect.left, dockRect.left));
  const overlapHeight = Math.max(0, Math.min(canvasRect.bottom, dockRect.bottom) - Math.max(canvasRect.top, dockRect.top));
  const dockStyle = getComputedStyle(dock);
  const tol = 1;
  return {
    canvas: {
      left: canvasRect.left, top: canvasRect.top, right: canvasRect.right, bottom: canvasRect.bottom,
      width: canvasRect.width, height: canvasRect.height,
    },
    host: { left: hostRect.left, top: hostRect.top, right: hostRect.right, bottom: hostRect.bottom },
    dock: { left: dockRect.left, top: dockRect.top, right: dockRect.right, bottom: dockRect.bottom, position: dockStyle.position },
    points,
    canvasInViewport: canvasRect.left >= -tol && canvasRect.top >= -tol &&
      canvasRect.right <= innerWidth + tol && canvasRect.bottom <= innerHeight + tol,
    canvasInHost: canvasRect.left >= hostRect.left - tol && canvasRect.top >= hostRect.top - tol &&
      canvasRect.right <= hostRect.right + tol && canvasRect.bottom <= hostRect.bottom + tol,
    dockInViewport: dockRect.left >= -tol && dockRect.top >= -tol &&
      dockRect.right <= innerWidth + tol && dockRect.bottom <= innerHeight + tol,
    reservedDock: dockStyle.position !== "absolute" && dockStyle.position !== "fixed" && overlapWidth * overlapHeight <= tol,
    overlapArea: overlapWidth * overlapHeight,
    ratio: canvasRect.width / canvasRect.height,
    intrinsic: { width: canvas.width, height: canvas.height },
    hostScroll: { x: Math.max(0, host.scrollWidth - host.clientWidth), y: Math.max(0, host.scrollHeight - host.clientHeight) },
    pageScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  };
}

async function run() {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (error) { console.error("Missing devDependency: playwright"); process.exit(2); }

  fs.mkdirSync(EVIDENCE, { recursive: true });
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch();
  const measurements = [];
  try {
    for (const viewport of VIEWPORTS) {
      console.log(`\n== R68 full map ${viewport.w}x${viewport.h} ==`);
      const context = await browser.newContext({
        viewport: { width: viewport.w, height: viewport.h },
        hasTouch: !!viewport.touch,
        isMobile: !!viewport.touch,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("td_tutorial_seen", "1");
      });
      await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 60000 });
      await page.locator(".diff-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.locator(".map-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(250);
      const result = await page.evaluate(auditMapInPage);
      measurements.push({ viewport: `${viewport.w}x${viewport.h}`, ...result });

      const hitDetail = result.points.filter((point) => !point.hit).map((point) => `${point.label}:${point.hitName}`).join(", ");
      assert(result.canvasInViewport && result.canvasInHost,
        `${viewport.w}x${viewport.h} whole canvas is inside viewport and battlefield host (${Math.round(result.canvas.width)}x${Math.round(result.canvas.height)})`);
      assert(result.points.every((point) => point.hit),
        `${viewport.w}x${viewport.h} canvas four corners and center hit canvas${hitDetail ? " - " + hitDetail : ""}`);
      assert(result.dockInViewport && result.reservedDock,
        `${viewport.w}x${viewport.h} dock stays in viewport and reserves its own layout area (overlap ${result.overlapArea.toFixed(1)}px², ${result.dock.position})`);
      assert(result.intrinsic.width === 960 && result.intrinsic.height === 640 && Math.abs(result.ratio - 1.5) < .015,
        `${viewport.w}x${viewport.h} full 960x640 map keeps 3:2 ratio (${result.ratio.toFixed(4)})`);
      assert(result.hostScroll.x <= 2 && result.hostScroll.y <= 2 && result.pageScroll <= 8 && result.overflowX <= 2,
        `${viewport.w}x${viewport.h} map needs no panning/page scroll (host ${result.hostScroll.x}x${result.hostScroll.y}, page ${result.pageScroll}, overflow ${result.overflowX})`);
      assert(errors.length === 0, `${viewport.w}x${viewport.h} has no pageerror${errors.length ? " - " + errors.join(" | ") : ""}`);

      if (viewport.shot) {
        await page.waitForTimeout(2700);
        await page.screenshot({ path: path.join(EVIDENCE, viewport.shot) });
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }

  fs.writeFileSync(path.join(EVIDENCE, "map-visibility-measurements.json"), JSON.stringify(measurements, null, 2) + "\n");
  if (failed > 0) { console.error(`\nR68 map visibility guard failed: ${failed}`); process.exit(1); }
  console.log("\nR68 map visibility guard passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
