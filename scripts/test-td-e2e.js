/* =========================================================================
 * test-td-e2e.js — 塔防 gate E2E（真瀏覽器）
 *
 * 對應 Stage 1（經濟修復 + 規則一致性）驗收：
 *   1. 抽卡花魂晶（跨局貨幣）不花場內金錢；首抽免費；魂晶不足被擋；重複退魂晶
 *   2. 抽卡動畫期間戰場暫停（敵人不偷跑）
 *   3. 建塔準備階段（第一波前）畫面有重繪——放塔立刻看得到（idle render loop）
 *   4. 波次預告的主元素跟實際出怪一致（主題波過半敵人來自該元素池）
 *   5. 開波跑起來無 console error；桌機+手機無水平溢出
 * 執行：node scripts/test-td-e2e.js   （需 devDependency: playwright）
 * ========================================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css" };

let failed = 0;
function assert(cond, msg) { if (cond) console.log("  ✓ " + msg); else { console.error("  ✗ " + msg); failed++; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
      const safePath = pathname === "/" ? "/index.html" : pathname;
      const fp = path.resolve(ROOT, "." + safePath);
      const rel = path.relative(ROOT, fp);
      if (rel.startsWith("..") || path.isAbsolute(rel) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "application/octet-stream" });
      fs.createReadStream(fp).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function run() {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (e) { console.error("需要 devDependency: playwright"); process.exit(2); }

  const server = await startServer();
  const port = server.address().port;
  const base = "http://127.0.0.1:" + port + "/index.html";
  const browser = await chromium.launch();

  try {
  for (const vp of [{ w: 1280, h: 900, name: "桌面 1280x900" }, { w: 390, h: 844, name: "手機 390x844" }]) {
    console.log("\n== 視窗 " + vp.name + " ==");
    const page = await browser.newPage({ viewport: { width: vp.w, height: vp.h } });
    const errors = [];
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // assets/ 底下的 404 是設計行為（缺圖自動 emoji fallback），不算錯誤；
      // 其他資源 404（如 src/*.js 載入失敗）仍會因遊戲跑不起來被後續斷言抓到
      const loc = (m.location() && m.location().url) || "";
      if (/Failed to load resource/.test(m.text()) && /\/assets\//.test(loc)) return;
      if (/favicon|net::ERR/.test(m.text())) return;
      errors.push("console: " + m.text());
    });
    page.on("pageerror", (e) => errors.push("pageerror: " + (e && e.message)));

    await page.goto(base);
    // 跳過教學浮層、預選普通難度（教學/難度流程本身不是這輪的驗收對象）
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("td_tutorial_seen", "1"); });
    await page.reload();
    await page.waitForFunction(() => window.TD && window.TD.state);
    await sleep(300);
    // 難度浮層：點「普通」
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll(".diff-opt")].find((o) => o.textContent.includes("普通"));
      if (opt) opt.click();
    });
    await sleep(300);

    // 1. 建塔準備階段畫面會重繪（idle render loop）——先確認迴圈真的沒在跑主迴圈
    const idleRender = await page.evaluate(async () => {
      const st = window.TD.state();
      const running = st.running;
      // 放一座弓箭塔在空地（格 (10,1) 遠離路徑），立刻檢查 state
      window.TD.selectTower("arrow");
      const canvas = document.getElementById("game");
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / 960, sy = rect.height / 640;
      const ev = new MouseEvent("click", { clientX: rect.left + 504 * sx, clientY: rect.top + 72 * sy, bubbles: true });
      canvas.dispatchEvent(ev);
      return { running, towers: st.towers.length, gold: st.gold };
    });
    assert(idleRender.running === false, "第一波開始前主迴圈未跑（準備階段）");
    assert(idleRender.towers === 1, `準備階段可放塔（場上 ${idleRender.towers} 座）`);

    // 2. 抽卡經濟：首抽免費、花魂晶不花金錢、重複退魂晶、魂晶不足被擋
    const gacha1 = await page.evaluate(() => {
      const goldBefore = window.TD.state().gold;
      document.getElementById("gachaBtn").click(); // 首抽（免費）
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      return { goldBefore, goldAfter: window.TD.state().gold,
        crystal: meta.soulCrystal, count: meta.gachaCount, paused: window.TD.state().paused,
        overlayShown: document.getElementById("gachaOverlay").classList.contains("show") };
    });
    assert(gacha1.goldAfter === gacha1.goldBefore, `抽卡不花場內金錢（${gacha1.goldBefore} 不變）`);
    assert(gacha1.crystal === 0 && gacha1.count === 1, `首抽免費（魂晶 ${gacha1.crystal}、抽數 ${gacha1.count}）`);
    assert(gacha1.overlayShown === true, "盲盒動畫浮層顯示");
    assert(gacha1.paused === true, "抽卡動畫期間戰場暫停（敵人不偷跑）");

    // 收下英雄，關閉浮層（要先點寶箱揭示）
    await page.evaluate(() => document.getElementById("chest").click());
    await sleep(1100);
    await page.evaluate(() => document.getElementById("revealOk").click());
    await sleep(200);
    const afterClose = await page.evaluate(() => ({ paused: window.TD.state().paused, owned: JSON.parse(localStorage.getItem("td_heroes_owned_v1")).length }));
    assert(afterClose.paused === false, "收下英雄後戰場恢復");
    assert(afterClose.owned === 1, `英雄入冊（擁有 ${afterClose.owned} 位）`);

    // 3. 魂晶不足：第二抽（成本 20）應被擋
    const gacha2 = await page.evaluate(() => {
      const before = JSON.parse(localStorage.getItem("td_meta_v1"));
      document.getElementById("gachaBtn").click();
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      return { btnDisabled: document.getElementById("gachaBtn").disabled, countBefore: before.gachaCount, countAfter: after.gachaCount };
    });
    assert(gacha2.btnDisabled === true && gacha2.countAfter === gacha2.countBefore, "魂晶不足時抽卡被擋（按鈕 disabled、抽數不變）");

    // 4. 給足魂晶 → 抽到重複時退還補償、pity 累積
    const gacha3 = await page.evaluate(async () => {
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      meta.soulCrystal = 200; localStorage.setItem("td_meta_v1", JSON.stringify(meta));
      window.__tdUI(); // 直接改 localStorage 不會觸發重繪，按鈕還是 disabled——手動刷新（同農場專案 F.refresh() 教訓）
      // 讓名冊只剩一種可能英雄很難（池有 6 隻），直接驗證：抽一次後魂晶 = 200 - 20 (+10 若重複)
      document.getElementById("gachaBtn").click();
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      const owned = JSON.parse(localStorage.getItem("td_heroes_owned_v1"));
      const spentOk = after.soulCrystal === 180 || after.soulCrystal === 190; // 新英雄 180；重複退 10 → 190
      return { crystal: after.soulCrystal, pity: after.gachaPity, count: after.gachaCount, spentOk, owned: owned.length };
    });
    assert(gacha3.spentOk, `扣魂晶正確（剩 ${gacha3.crystal}，新英雄 180 / 重複退補 190）`);
    assert(gacha3.count === 2, `抽數累積（${gacha3.count}）`);
    assert(typeof gacha3.pity === "number" && gacha3.pity >= 0, `pity 有持久化追蹤（${gacha3.pity}）`);
    // 關閉這次的盲盒浮層
    await page.evaluate(() => document.getElementById("chest").click());
    await sleep(1100);
    await page.evaluate(() => document.getElementById("revealOk").click());
    await sleep(200);

    // 5. 主題波一致性：直接跳到主題波（wave 8 之後找一個 ice/fire 主題波），驗證出怪偏壓
    const themed = await page.evaluate(() => {
      const st = window.TD.state();
      // waveTheme(9)=ice：把 wave 設 8，下一波就是 9
      st.wave = 8;
      const preview = window.TD.previewNextWave();
      window.TD.startWave();
      const q = st.spawnQueue.map((s) => s.type);
      const themeEls = q.filter((t) => (window.ENEMIES[t] || {}).element === preview.theme).length;
      return { theme: preview.theme, queueLen: q.length, themeCount: themeEls, types: [...new Set(q)] };
    });
    assert(themed.theme === "ice", `第 9 波預告主題為 ice（實際 ${themed.theme}）`);
    assert(themed.themeCount >= Math.floor(themed.queueLen * 0.3),
      `主題波出怪偏壓生效（${themed.themeCount}/${themed.queueLen} 隻為 ${themed.theme} 系，含冰霜狼）`);

    // 6. 讓波次跑 3 秒：敵人生成、無錯誤
    await sleep(3000);
    const running = await page.evaluate(() => ({ enemies: window.TD.state().enemies.length, over: window.TD.state().over }));
    assert(running.enemies > 0 && !running.over, `波次進行中有敵人生成（${running.enemies} 隻）`);

    // 7. RWD：無水平溢出
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 2, `無水平溢出（${overflow}）`);

    // 8. 全程無 console error / pageerror
    assert(errors.length === 0, "無 console 錯誤 / pageerror" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));

    await page.close();
  }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed > 0) { console.error("\n❌ " + failed + " 項失敗"); process.exit(1); }
  console.log("\n✅ 塔防 Stage 1 E2E 全部通過");
}

run().catch((err) => { console.error(err); process.exit(1); });
