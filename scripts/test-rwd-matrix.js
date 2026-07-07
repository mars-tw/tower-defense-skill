/* =========================================================================
 * test-rwd-matrix.js — RWD 9 視口矩陣守門（R46）
 *
 * 驗收標準（每個 頁面×視口 都必須成立，否則 exit 1）：
 *   1. 所有可互動元素（button/select/input/textarea/a[href]/[role=button]）
 *      必須「完整在視口內」，或位於一個自身完整可見、overflow-y 可捲的容器內。
 *   2. 頁級捲動歸零：documentElement.scrollHeight <= innerHeight + 8
 *      （app-shell：body 不捲、面板區域內捲）。
 *   3. 水平溢出 <= 2px。
 *
 * 前置：教學 overlay 以 localStorage td_tutorial_seen=1 先行關閉；
 *       難度選擇 overlay 屬正常開局畫面，保持開啟一併稽核。
 * 執行：node scripts/test-rwd-matrix.js   （需 devDependency: playwright）
 * ========================================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css" };

const VIEWPORTS = [
  { w: 1920, h: 1080, kind: "desktop" },
  { w: 1366, h: 700, kind: "desktop" },
  { w: 1280, h: 720, kind: "desktop" },
  { w: 1024, h: 768, kind: "desktop" },
  { w: 820, h: 1180, kind: "tablet" },
  { w: 768, h: 1024, kind: "tablet" },
  { w: 390, h: 844, kind: "mobile" },
  { w: 360, h: 640, kind: "mobile" },
  { w: 844, h: 390, kind: "landscape" },
];

const PAGES = [
  { name: "td-main", setup: null },
  { name: "td-settings", setup: () => { const b = document.getElementById("settingsBtn"); if (b) b.click(); } },
];

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

/* 在頁面內量測：回傳違規清單、頁捲量、水平溢出量 */
function auditInPage() {
  const tol = 2;
  const iw = window.innerWidth, ih = window.innerHeight;
  const els = [...document.querySelectorAll('button, select, input, textarea, a[href], [role="button"], [onclick]')];
  const results = [];
  const seen = new Set();
  for (const el of els) {
    if (seen.has(el)) continue; seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (+cs.opacity === 0) continue;
    let anc = el.parentElement, hidden = false, scrollHost = null;
    while (anc && anc !== document.body) {
      const acs = getComputedStyle(anc);
      if (acs.display === "none" || acs.visibility === "hidden" || +acs.opacity === 0) { hidden = true; break; }
      if (!scrollHost && /(auto|scroll)/.test(acs.overflowY) && anc.scrollHeight > anc.clientHeight + 4) scrollHost = anc;
      anc = anc.parentElement;
    }
    if (hidden) continue;
    const inVp = r.top >= -tol && r.left >= -tol && r.bottom <= ih + tol && r.right <= iw + tol;
    const label = (el.id ? "#" + el.id : "") ||
      (el.getAttribute("aria-label") || el.textContent || el.className || el.tagName).toString().trim().slice(0, 28);
    let status;
    if (inVp) status = "OK";
    else if (scrollHost) {
      const hr = scrollHost.getBoundingClientRect();
      const hostVisible = hr.top >= -tol && hr.bottom <= ih + tol && hr.left >= -tol && hr.right <= iw + tol;
      status = hostVisible ? "SCROLLABLE_OK" : "PAGE_SCROLL";
    } else status = (r.top >= ih || r.bottom <= 0) ? "PAGE_SCROLL" : "CLIPPED";
    if (status !== "OK" && status !== "SCROLLABLE_OK") {
      results.push({ label, status, top: Math.round(r.top), bottom: Math.round(r.bottom),
        left: Math.round(r.left), right: Math.round(r.right) });
    }
  }
  return {
    violations: results,
    pageScrollY: Math.max(0, document.documentElement.scrollHeight - ih),
    overflowX: Math.max(0, document.documentElement.scrollWidth - iw),
    total: seen.size,
  };
}

async function run() {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (e) { console.error("需要 devDependency: playwright"); process.exit(2); }

  let failed = 0;
  const server = await startServer();
  const port = server.address().port;
  const browser = await chromium.launch();
  try {
    for (const pg of PAGES) {
      console.log(`\n== 頁面 ${pg.name} ==`);
      for (const vp of VIEWPORTS) {
        const isTouch = vp.kind === "mobile" || vp.kind === "landscape";
        const ctx = await browser.newContext({
          viewport: { width: vp.w, height: vp.h },
          hasTouch: isTouch,
          isMobile: isTouch,
        });
        const page = await ctx.newPage();
        // 前置：教學 overlay 先行關閉（首次導覽不擋稽核）
        await page.addInitScript(() => { localStorage.setItem("td_tutorial_seen", "1"); });
        await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
        await page.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(600);
        if (pg.setup) await page.evaluate(pg.setup).catch((e) => console.error("  setup err:", e.message));
        await page.waitForTimeout(200);
        const res = await page.evaluate(auditInPage);
        const scrollBad = res.pageScrollY > 8;
        const overflowBad = res.overflowX > 2;
        const bad = res.violations.length > 0 || scrollBad || overflowBad;
        if (bad) {
          failed++;
          console.error(`  ✗ ${vp.w}x${vp.h}（${vp.kind}）違規 ${res.violations.length}、頁捲 ${res.pageScrollY}px、水平溢出 ${res.overflowX}px（元素 ${res.total}）`);
          for (const v of res.violations.slice(0, 6)) {
            console.error(`      - [${v.status}] ${v.label} top=${v.top} bottom=${v.bottom} left=${v.left} right=${v.right}`);
          }
        } else {
          console.log(`  ✓ ${vp.w}x${vp.h}（${vp.kind}）零違規、頁捲 ${res.pageScrollY}px、水平溢出 ${res.overflowX}px（元素 ${res.total}）`);
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed > 0) { console.error(`\n❌ RWD 矩陣守門失敗：${failed} 個 頁面×視口 有違規`); process.exit(1); }
  console.log("\n✅ RWD 9 視口矩陣守門全數通過（零違規、頁捲歸零、無水平溢出）");
}

run().catch((err) => { console.error(err); process.exit(1); });
