/* td R66 control reachability guard. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".css": "text/css",
};

const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1440, h: 780 },
  { w: 1366, h: 600 },
  { w: 1280, h: 640 },
  { w: 390, h: 844 },
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
      const fp = path.resolve(ROOT, "." + safePath);
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

function auditControlsInPage() {
  function visible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && Number(cs.opacity) !== 0;
  }
  function nameFor(el, index) {
    return el.id || el.dataset.type || el.dataset.skill || el.getAttribute("aria-label") || `${el.tagName.toLowerCase()}-${index}`;
  }
  function checkElements(selector, group) {
    return [...document.querySelectorAll(selector)].filter(visible).map((el, index) => {
      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      return {
        group,
        name: nameFor(el, index),
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        centerInViewport: cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight,
        hit: !!hit && (hit === el || el.contains(hit)),
        hitName: hit ? nameFor(hit, index) : "none",
      };
    });
  }
  function overlapFailures(items) {
    const failures = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        if (x * y > 1) failures.push(`${a.group}:${a.name}<->${b.group}:${b.name}`);
      }
    }
    return failures;
  }
  const controls = [
    ...checkElements("#towerList .tower-btn", "tower"),
    ...checkElements("#skillList .skill-btn", "skill"),
    ...checkElements("#startBtn,#speed1,#speed2,#pauseBtn,#settingsBtn", "action"),
  ];
  return {
    viewport: { w: innerWidth, h: innerHeight },
    counts: {
      towers: document.querySelectorAll("#towerList .tower-btn").length,
      skills: document.querySelectorAll("#skillList .skill-btn").length,
    },
    bad: controls.filter((item) => item.width < 44 || item.height < 44 || !item.centerInViewport || !item.hit),
    overlaps: overlapFailures(controls),
    pageScrollY: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  };
}

function auditModalInPage(selector) {
  const buttons = [...document.querySelectorAll(selector)];
  return buttons.map((el, index) => {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      index,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      bottom: rect.bottom,
      centerInViewport: cx >= 0 && cx <= innerWidth && cy >= 0 && cy <= innerHeight,
      hit: !!hit && (hit === el || el.contains(hit)),
      hitClass: hit ? (hit.id || hit.className || hit.tagName) : "none",
    };
  });
}

async function run() {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (error) { console.error("Missing devDependency: playwright"); process.exit(2); }

  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/index.html`;
  const browser = await chromium.launch();
  try {
    for (const vp of VIEWPORTS) {
      console.log(`\n== R66 controls ${vp.w}x${vp.h} ==`);
      const isMobile = vp.w <= 560;
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        hasTouch: isMobile,
        isMobile,
      });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("td_tutorial_seen", "1");
      });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 15000 });
      await page.waitForTimeout(250);

      const diffShown = await page.evaluate(() => document.getElementById("diffOverlay").classList.contains("show"));
      assert(diffShown, `${vp.w}x${vp.h} difficulty modal opens`);
      const diff = await page.evaluate(auditModalInPage, "#diffOverlay .diff-opt");
      assert(diff.length > 0 && diff.every((item) => item.width >= 44 && item.height >= 44 && item.centerInViewport && item.hit),
        `${vp.w}x${vp.h} difficulty options are reachable`);

      await page.locator(".diff-opt").first().click();
      await page.waitForTimeout(150);
      const mapShown = await page.evaluate(() => document.getElementById("mapOverlay").classList.contains("show"));
      assert(mapShown, `${vp.w}x${vp.h} map modal opens`);
      const map = await page.evaluate(auditModalInPage, "#mapOverlay .map-opt");
      assert(map.length > 0 && map.every((item) => item.width >= 44 && item.height >= 44 && item.centerInViewport && item.hit),
        `${vp.w}x${vp.h} map options are reachable`);

      await page.locator(".map-opt").first().click();
      await page.waitForTimeout(250);
      const controls = await page.evaluate(auditControlsInPage);
      const detail = controls.bad.map((item) =>
        `${item.group}:${item.name} ${Math.round(item.width)}x${Math.round(item.height)} top=${Math.round(item.top)} bottom=${Math.round(item.bottom)} hit=${item.hitName}`
      ).join("; ");
      assert(controls.counts.towers === 10 && controls.counts.skills === 5,
        `${vp.w}x${vp.h} has 10 tower buttons and 5 skill buttons`);
      assert(controls.bad.length === 0,
        `${vp.w}x${vp.h} control centers are in viewport and hit-test clean${detail ? " - " + detail : ""}`);
      assert(controls.overlaps.length === 0,
        `${vp.w}x${vp.h} control buttons do not overlap${controls.overlaps.length ? " - " + controls.overlaps.slice(0, 4).join(", ") : ""}`);
      assert(controls.pageScrollY <= 8 && controls.overflowX <= 2,
        `${vp.w}x${vp.h} no page scroll is needed for controls`);

      await context.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed > 0) { console.error(`\nR66 control guard failed: ${failed}`); process.exit(1); }
  console.log("\nR66 control guard passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
