/* =========================================================================
 * test-td-e2e.js — 塔防 E2E gate（真瀏覽器）
 *
 * 覆蓋經濟、規則一致性、排行榜/成就、放塔防呆與 RWD：
 *   1. 抽卡花魂晶（跨局貨幣）不花場內金錢；首抽免費；魂晶不足被擋；重複退魂晶
 *   2. 抽卡動畫期間戰場暫停（敵人不偷跑）
 *   3. 建塔準備階段（第一波前）畫面有重繪——放塔立刻看得到（idle render loop）
 *   4. 波次預告的主元素跟實際出怪一致（主題波過半敵人來自該元素池）
 *   5. 排行榜/成就：結算寫榜、成就發獎、overlay 暫停恢復
 *   6. 首次快速開始、未建塔禁開波、手機二段式建塔與首屏排序
 *   7. 開波跑起來無 console error；桌機+手機無水平溢出
 * 執行：node scripts/test-td-e2e.js   （需 devDependency: playwright）
 * ========================================================================= */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html", ".js": "application/javascript", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".css": "text/css" };

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
  for (const vp of [{ w: 1280, h: 900, name: "桌面 1280x900" }, { w: 768, h: 1024, name: "平板 768x1024" }, { w: 390, h: 844, name: "手機 390x844" }]) {
    console.log("\n== 視窗 " + vp.name + " ==");
    const isMobileViewport = vp.w <= 560;
    const page = await browser.newPage({
      viewport: { width: vp.w, height: vp.h },
      hasTouch: isMobileViewport,
      isMobile: isMobileViewport,
    });
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
    // Stage 5：首次流程只有一個快速開始入口，進階選項另開難度/地圖選擇。
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.TD && window.TD.state);
    await sleep(300);
    const pwaR37 = await page.evaluate(async () => {
      const manifest = await fetch("/manifest.webmanifest").then((r) => ({ ok: r.ok, type: r.headers.get("content-type"), json: r.json() }));
      manifest.json = await manifest.json;
      const sw = await fetch("/sw.js").then((r) => r.text());
      const offline = await fetch("/offline.html").then(async (r) => ({ ok: r.ok, text: await r.text() }));
      const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
      const shellJs = ["src/config.js", "src/heroes.js", "src/rules.js", "src/game.js", "src/ui.js"];
      return {
        hasManifestLink: !!document.querySelector('link[rel="manifest"]'),
        manifestOk: manifest.ok,
        manifestType: manifest.type || "",
        name: manifest.json.name,
        iconSizes: (manifest.json.icons || []).map((i) => i.sizes).join(","),
        swHasVersion: sw.includes("CACHE_VERSION") && sw.includes("td-r37-v1"),
        swHasNetworkFirst: sw.includes("networkFirst"),
        swHasCacheFirst: sw.includes("cacheFirst"),
        swHasAssets: sw.includes("heroes") && sw.includes("enemies") && sw.includes("towers"),
        swHasOffline: sw.includes("offline.html") && offline.ok && offline.text.includes("離線"),
        swHasAllJs: shellJs.every((rel) => sw.includes(rel)),
        pwaVersion: window.__tdPwa && window.__tdPwa.version,
        swtestGate: document.documentElement.innerHTML.includes("swtest"),
        hasTextSize: !!document.querySelector('[data-text-size="large"]'),
        settingsRole: document.getElementById("settingsOverlay").getAttribute("role"),
        webdriver: navigator.webdriver === true,
        regCount: regs.length,
      };
    });
    assert(pwaR37.hasManifestLink && pwaR37.manifestOk && pwaR37.manifestType.includes("manifest") &&
      pwaR37.name === "無盡塔防" && pwaR37.iconSizes.includes("192x192") && pwaR37.iconSizes.includes("512x512") &&
      pwaR37.swHasVersion && pwaR37.swHasNetworkFirst && pwaR37.swHasCacheFirst && pwaR37.swHasAssets &&
      pwaR37.swHasOffline && pwaR37.swHasAllJs && pwaR37.pwaVersion === "td-r37-v1" && pwaR37.swtestGate &&
      pwaR37.hasTextSize && pwaR37.settingsRole === "dialog" && pwaR37.webdriver && pwaR37.regCount === 0,
      `R37 PWA manifest/SW/離線頁/設定可近用性正確，且一般 Playwright webdriver 跳過註冊（regs=${pwaR37.regCount}）`);

    if (vp.w === 1280) {
      const swContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const swPage = await swContext.newPage();
      let swOfflineR37 = null;
      try {
        await swPage.goto(base + "?swtest=1", { waitUntil: "domcontentloaded" });
        await swPage.evaluate(() => {
          localStorage.clear();
          localStorage.setItem("td_tutorial_seen", "1");
        });
        await swPage.reload({ waitUntil: "networkidle" });
        await swPage.waitForFunction(() => window.TD && window.__tdPwa && navigator.serviceWorker);
        await swPage.waitForFunction(async () => {
          const reg = await navigator.serviceWorker.getRegistration();
          return !!(reg && reg.active);
        }, null, { timeout: 12000 });
        await swPage.reload({ waitUntil: "networkidle" });
        await swPage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 12000 });
        await swPage.waitForFunction(async () => (await caches.keys()).some((key) => key.includes("td-r37")), null, { timeout: 12000 });
        await swContext.setOffline(true);
        await swPage.reload({ waitUntil: "domcontentloaded" });
        await swPage.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 12000 });
        swOfflineR37 = await swPage.evaluate(async () => {
          ["tutorial", "diffOverlay", "mapOverlay", "settingsOverlay", "progressOverlay"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) el.classList.remove("show");
          });
          localStorage.setItem("td_tutorial_seen", "1");
          window.TD.setDifficulty("normal");
          window.TD.setMap("plains");
          window.TD.newGame();
          window.TD.selectTower("arrow");
          const canvas = document.getElementById("game");
          const rect = canvas.getBoundingClientRect();
          const sx = rect.width / 960, sy = rect.height / 640;
          let target = null;
          for (let y = 24; y < 640 && !target; y += 48) {
            for (let x = 24; x < 960 && !target; x += 48) {
              const preview = window.TD.buildPreviewAt(x, y);
              if (preview && preview.ok) target = { x, y };
            }
          }
          if (target) {
            canvas.dispatchEvent(new MouseEvent("click", { clientX: rect.left + target.x * sx, clientY: rect.top + target.y * sy, bubbles: true }));
          }
          const keys = await caches.keys();
          return {
            loaded: !!(window.TD && window.TD.state),
            towerCount: window.TD.state().towers.length,
            target,
            controlled: !!navigator.serviceWorker.controller,
            cacheKeys: keys.filter((key) => key.includes("td-r37")).length,
          };
        });
      } finally {
        await swContext.setOffline(false).catch(() => {});
        await swPage.evaluate(async () => {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((reg) => reg.unregister()));
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }).catch(() => {});
        await swContext.close().catch(() => {});
      }
      assert(swOfflineR37 && swOfflineR37.loaded && swOfflineR37.controlled && swOfflineR37.cacheKeys > 0 && swOfflineR37.towerCount >= 1,
        `R37 真 SW 離線 reload 後仍可載入並建塔（towers=${swOfflineR37 && swOfflineR37.towerCount} target=${swOfflineR37 && JSON.stringify(swOfflineR37.target)} caches=${swOfflineR37 && swOfflineR37.cacheKeys}）`);
    }

    const perfR37 = await page.evaluate(async () => {
      document.getElementById("settingsBtn").click();
      await new Promise((r) => setTimeout(r, 30));
      const focusInSettings = document.getElementById("settingsOverlay").contains(document.activeElement);
      const initialHudSize = parseFloat(getComputedStyle(document.querySelector(".hud .stat")).fontSize);
      document.querySelector('[data-text-size="large"]').click();
      const largeHudSize = parseFloat(getComputedStyle(document.querySelector(".hud .stat")).fontSize);
      const textSizeSaved = localStorage.getItem("td_text_size");
      const bodyLarge = document.body.classList.contains("text-size-large");
      document.getElementById("checkUpdateBtn").click();
      await new Promise((r) => setTimeout(r, 80));
      const updateText = document.getElementById("updateStatus").textContent;
      document.querySelector('[data-perf-mode="low"]').click();
      const lockedLow = window.TD.getPerformanceStatus();
      document.querySelector('[data-perf-mode="auto"]').click();
      const autoStart = window.TD.getPerformanceStatus();
      const autoLow = window.TD.debug.forcePerformanceSample(38);
      window.TD.debug.forcePerformanceSample(60);
      window.TD.debug.forcePerformanceSample(60);
      const autoHigh = window.TD.debug.forcePerformanceSample(60);
      const text = document.getElementById("settingsOverlay").innerText;
      document.querySelector('[data-text-size="medium"]').click();
      document.getElementById("settingsClose").click();
      await new Promise((r) => setTimeout(r, 30));
      return {
        lockedLow, autoStart, autoLow, autoHigh, text,
        paused: window.TD.state().paused,
        focusInSettings,
        focusReturned: document.activeElement && document.activeElement.id === "settingsBtn",
        bodyLarge,
        largeHudSize,
        initialHudSize,
        textSizeSaved,
        updateText,
        startAria: document.getElementById("startBtn").getAttribute("aria-label"),
        towerAria: document.querySelector('.tower-btn[data-type="arrow"]').getAttribute("aria-label"),
        skillAria: document.querySelector('.skill-btn[data-skill="meteor"]').getAttribute("aria-label"),
      };
    });
    assert(perfR37.lockedLow.mode === "low" && perfR37.lockedLow.quality === "low" &&
      perfR37.autoStart.mode === "auto" && perfR37.autoLow.quality === "low" && perfR37.autoHigh.quality === "high" &&
      perfR37.text.includes("效能模式") && perfR37.text.includes("存檔管家") &&
      perfR37.text.includes("文字大小") && perfR37.text.includes("版本") &&
      perfR37.text.includes("即時 FPS") && perfR37.text.includes("品質檔位") &&
      perfR37.text.includes("最近降級原因") && perfR37.text.includes("粒子倍率") && perfR37.text.includes("動畫倍率") &&
      perfR37.bodyLarge && perfR37.largeHudSize > perfR37.initialHudSize && perfR37.textSizeSaved === "large" &&
      perfR37.focusInSettings && perfR37.focusReturned && perfR37.paused === false &&
      perfR37.updateText && (perfR37.updateText.includes("跳過") || perfR37.updateText.includes("未註冊") || perfR37.updateText.includes("尚未")) &&
      perfR37.startAria && perfR37.towerAria && perfR37.skillAria,
      `R37 設定含效能診斷/文字大小/更新狀態/焦點與 aria（${perfR37.lockedLow.quality}→${perfR37.autoLow.quality}→${perfR37.autoHigh.quality}，字級 ${perfR37.initialHudSize}→${perfR37.largeHudSize}）`);

    const saveManagerR33 = await page.evaluate(() => {
      const before = JSON.parse(localStorage.getItem("td_meta_v1") || "{}");
      const seed = Object.assign({}, before, { soulCrystal: 33, bestWave: 4, bestByDiff: { normal: 4 } });
      localStorage.setItem("td_meta_v1", JSON.stringify(seed));
      const code = window.__tdSaveManager.export();
      const decoded = window.__tdSaveManager.decode(code);
      const bad = window.__tdSaveManager.import(window.__tdSaveManager.encode({ kind: "td-save-v1", meta: { soulCrystal: "bad" } }), { skipReload: true });
      const afterBad = JSON.parse(localStorage.getItem("td_meta_v1"));
      const next = Object.assign({}, decoded.rawMeta, { soulCrystal: 88, bestWave: 8, bestByDiff: { normal: 8 } });
      const goodCode = window.__tdSaveManager.encode({ kind: "td-save-v1", meta: next, heroes: ["archer", "cleric", "__bad"] });
      const good = window.__tdSaveManager.import(goodCode, { skipReload: true });
      const afterGood = JSON.parse(localStorage.getItem("td_meta_v1"));
      const backup = JSON.parse(localStorage.getItem(window.__tdSaveManager.backupKey) || "{}");
      const heroes = JSON.parse(localStorage.getItem("td_heroes_owned_v1") || "[]");
      const area = document.getElementById("saveCode").value;
      if (before && Object.keys(before).length) localStorage.setItem("td_meta_v1", JSON.stringify(before));
      return { codeLen: code.length, decodedCrystal: decoded.rawMeta.soulCrystal, badOk: bad.ok, afterBadCrystal: afterBad.soulCrystal, goodOk: good.ok, afterGoodCrystal: afterGood.soulCrystal, backupCrystal: backup.meta && backup.meta.soulCrystal, heroes, areaLen: area.length };
    });
    assert(saveManagerR33.codeLen > 40 && saveManagerR33.areaLen > 40 && saveManagerR33.decodedCrystal === 33 &&
      saveManagerR33.badOk === false && saveManagerR33.afterBadCrystal === 33 &&
      saveManagerR33.goodOk === true && saveManagerR33.afterGoodCrystal === 88 && saveManagerR33.backupCrystal === 33 &&
      saveManagerR33.heroes.includes("archer") && saveManagerR33.heroes.includes("cleric") && !saveManagerR33.heroes.includes("__bad"),
      "R33 存檔管家可匯出 Base64、拒絕壞資料、成功匯入前自動備份並清洗英雄清單");
    const quickIntro = await page.evaluate(() => ({
      tutorialShown: document.getElementById("tutorial").classList.contains("show"),
      quickText: document.getElementById("tutorialQuick").textContent,
      advancedText: document.getElementById("tutorialAdvanced").textContent,
    }));
    assert(quickIntro.tutorialShown && quickIntro.quickText.includes("快速開始") && quickIntro.advancedText.includes("進階選項"),
      "首次進入顯示快速開始與進階選項");
    await page.click("#tutorialQuick");
    await sleep(200);
    const quickState = await page.evaluate(() => ({
      tutorialShown: document.getElementById("tutorial").classList.contains("show"),
      diffShown: document.getElementById("diffOverlay").classList.contains("show"),
      mapShown: document.getElementById("mapOverlay").classList.contains("show"),
      diff: window.TD.getDifficulty().id,
      map: window.TD.getMap().id,
    }));
    assert(!quickState.tutorialShown && !quickState.diffShown && !quickState.mapShown && quickState.diff === "normal" && quickState.map === "plains",
      `快速開始直接進普通＋翠綠平原（${quickState.diff}/${quickState.map}）`);

    // 主要測試流程仍跳過教學浮層、預選普通難度。
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem("td_tutorial_seen", "1"); });
    await page.reload();
    await page.waitForFunction(() => window.TD && window.TD.state);
    await sleep(300);
    // 難度浮層：點「普通」→ 地圖浮層：點「迂迴峽谷」
    await page.evaluate(() => {
      const opt = [...document.querySelectorAll(".diff-opt")].find((o) => o.textContent.includes("普通"));
      if (opt) opt.click();
    });
    await sleep(300);
    const mapSelect = await page.evaluate(() => {
      const opt = [...document.querySelectorAll(".map-opt")].find((o) => o.textContent.includes("迂迴峽谷"));
      if (opt) opt.click();
      const st = window.TD.state();
      return {
        mapId: st.mapId,
        pathLen: st.path.length,
        plainsLen: window.TD.config.MAPS.plains.path.length,
        gold: st.gold,
        expectedGold: Math.round(window.TD.config.GAME.startGold * window.TD.config.MAPS.canyon.goldMul),
      };
    });
    assert(mapSelect.mapId === "canyon" && mapSelect.pathLen !== mapSelect.plainsLen,
      `地圖選擇後開局路徑不同（${mapSelect.mapId}，節點 ${mapSelect.pathLen} vs ${mapSelect.plainsLen}）`);
    assert(mapSelect.gold === mapSelect.expectedGold,
      `迂迴峽谷套用資源倍率（${mapSelect.gold}/${mapSelect.expectedGold}）`);
    await sleep(200);

    const firstScreen = await page.evaluate(() => {
      const ids = ["towerList", "startBtn"];
      const rects = Object.fromEntries(ids.map((id) => {
        const r = document.getElementById(id).getBoundingClientRect();
        return [id, { top: r.top, bottom: r.bottom }];
      }));
      const title = document.querySelector(".tower-title").getBoundingClientRect();
      return {
        innerHeight: window.innerHeight,
        towerListTop: rects.towerList.top,
        towerTitleBottom: title.bottom,
        towerListBottom: rects.towerList.bottom,
        startTop: rects.startBtn.top,
        startBottom: rects.startBtn.bottom,
        towerHintDisplay: getComputedStyle(document.querySelector(".tower-scroll-hint")).display,
      };
    });
    assert(firstScreen.towerTitleBottom <= firstScreen.innerHeight && firstScreen.towerListBottom <= firstScreen.innerHeight && firstScreen.startBottom <= firstScreen.innerHeight,
      `首屏可見建塔入口與開始波（tower ${Math.round(firstScreen.towerListBottom)} / start ${Math.round(firstScreen.startBottom)} <= ${firstScreen.innerHeight}）`);
    if (vp.w <= 560) {
      assert(firstScreen.towerListTop < firstScreen.startTop && firstScreen.towerHintDisplay !== "none",
        "手機首屏建塔列排在開始波前，且顯示橫滑提示");
    }

    const nextWaveCardInitial = await page.evaluate(() => ({
      text: document.getElementById("nextWaveCard").innerText,
      enemyButtons: document.querySelectorAll("#nextWaveCard .enemy-chip-btn").length,
      affixText: document.getElementById("affixCard").innerText,
      affixId: window.TD.state().affix && window.TD.state().affix.id,
    }));
    assert(nextWaveCardInitial.text.includes("下一波情報") && nextWaveCardInitial.text.includes("主元素") && nextWaveCardInitial.text.includes("建議塔種") && nextWaveCardInitial.enemyButtons > 0,
      `下一波情報卡顯示元素、主要敵人與建議塔種（敵人按鈕 ${nextWaveCardInitial.enemyButtons} 個）`);
    assert(nextWaveCardInitial.affixId && nextWaveCardInitial.affixText.includes("本局詞綴") && nextWaveCardInitial.affixText.includes("預期") && nextWaveCardInitial.affixText.includes("塔種影響"),
      `本局詞綴卡顯示效果與期望值（${nextWaveCardInitial.affixText.replace(/\n/g, " / ")}）`);
    const advisorR25 = await page.evaluate(() => {
      const savedMeta = localStorage.getItem("td_meta_v1");
      const savedHeroes = localStorage.getItem("td_heroes_owned_v1");
      const st = window.TD.state();
      st.wave = 6; // 下一波第 7 波：雷系/蝙蝠高速壓力
      st.betweenWaves = true;
      st.running = false;
      st.over = false;
      st.gold = 100;
      st.towers = [{ type: "arrow", level: 1, x: 216, y: 72, cx: 4, cy: 1, cd: 0 }];
      window.__tdUI();
      const preview = window.TD.previewNextWave();
      const text = document.getElementById("nextWaveCard").innerText;
      const buttons = document.querySelectorAll("#nextWaveCard [data-advisor-toggle], #nextWaveCard [data-advisor-close]").length;
      window.TD.newGame();
      if (savedMeta === null) localStorage.removeItem("td_meta_v1");
      else localStorage.setItem("td_meta_v1", savedMeta);
      if (savedHeroes === null) localStorage.removeItem("td_heroes_owned_v1");
      else localStorage.setItem("td_heroes_owned_v1", savedHeroes);
      window.__tdUI();
      return { text, buttons, advisor: preview.advisor };
    });
    assert(advisorR25.text.includes("塔陣顧問") && advisorR25.text.includes("寒冰塔") &&
      advisorR25.advisor[0] && advisorR25.advisor[0].kind === "build" && advisorR25.advisor[0].towerId === "frost" && advisorR25.buttons === 2,
      `塔陣顧問在無冰塔＋高速敵情境建議補寒冰塔（${advisorR25.text.replace(/\n/g, " / ")}）`);

    const warningR25 = await page.evaluate(() => {
      const savedMeta = localStorage.getItem("td_meta_v1");
      const savedHeroes = localStorage.getItem("td_heroes_owned_v1");
      const restore = () => {
        window.TD.newGame();
        if (savedMeta === null) localStorage.removeItem("td_meta_v1");
        else localStorage.setItem("td_meta_v1", savedMeta);
        if (savedHeroes === null) localStorage.removeItem("td_heroes_owned_v1");
        else localStorage.setItem("td_heroes_owned_v1", savedHeroes);
        window.__tdUI();
      };
      const st = window.TD.state();
      st.wave = 8; // 下一波第 9 波：冰系主題
      st.betweenWaves = true;
      st.running = false;
      st.over = false;
      st.gold = 200;
      st.towers = [{ type: "arrow", level: 1, x: 216, y: 72, cx: 4, cy: 1, cd: 0 }];
      window.__tdUI();
      document.getElementById("startBtn").click();
      const warn = document.getElementById("waveWarning");
      const missing = { shown: warn.classList.contains("show"), text: warn.innerText, wave: st.wave, running: st.running };
      window.TD.newGame();
      const st2 = window.TD.state();
      st2.wave = 8;
      st2.betweenWaves = true;
      st2.running = false;
      st2.over = false;
      st2.gold = 200;
      st2.towers = [{ type: "cannon", level: 1, x: 216, y: 72, cx: 4, cy: 1, cd: 0 }];
      window.__tdUI();
      document.getElementById("startBtn").click();
      const ok = { shown: warn.classList.contains("show"), text: warn.innerText, wave: st2.wave, running: st2.running };
      restore();
      return { missing, ok };
    });
    assert(warningR25.missing.shown && warningR25.missing.text.includes("冰系") && warningR25.missing.text.includes("火系") &&
      warningR25.missing.wave === 9 && warningR25.missing.running,
      `缺克制塔時開波警告出現且不阻擋開波（${warningR25.missing.text}）`);
    assert(!warningR25.ok.shown && warningR25.ok.wave === 9 && warningR25.ok.running,
      "已有火系塔時開波克制警告不誤報");

    const advisorModesR29 = await page.evaluate(() => {
      const savedMeta = localStorage.getItem("td_meta_v1");
      const savedHeroes = localStorage.getItem("td_heroes_owned_v1");
      const restore = () => {
        window.TD.newGame();
        if (savedMeta === null) localStorage.removeItem("td_meta_v1");
        else localStorage.setItem("td_meta_v1", savedMeta);
        if (savedHeroes === null) localStorage.removeItem("td_heroes_owned_v1");
        else localStorage.setItem("td_heroes_owned_v1", savedHeroes);
        window.__tdUI();
      };
      const st = window.TD.state();
      st.wave = 6;
      st.betweenWaves = true;
      st.running = false;
      st.over = false;
      st.gold = 140;
      st.towers = [{ type: "arrow", level: 1, x: 216, y: 72, cx: 4, cy: 1, cd: 0 }];
      window.__tdUI();
      const ids = {};
      for (const mode of ["control", "aoe", "boss"]) {
        document.querySelector(`#nextWaveCard [data-advisor-mode="${mode}"]`).click();
        ids[mode] = window.TD.previewNextWave({ advisorMode: mode }).advisor[0].towerId;
      }
      const text = document.getElementById("nextWaveCard").innerText;
      restore();
      return { ids, text };
    });
    assert(new Set(Object.values(advisorModesR29.ids)).size >= 2 && advisorModesR29.text.includes("控場優先") && advisorModesR29.text.includes("範圍清怪") && advisorModesR29.text.includes("Boss 單點"),
      `策略預設切換會改變顧問建議（${Object.entries(advisorModesR29.ids).map(([k, v]) => `${k}:${v}`).join(" / ")}）`);

    const advisorBuildR29 = await page.evaluate(() => {
      const savedMeta = localStorage.getItem("td_meta_v1");
      const savedHeroes = localStorage.getItem("td_heroes_owned_v1");
      window.__r29Saved = { meta: savedMeta, heroes: savedHeroes };
      const st = window.TD.state();
      st.wave = 6;
      st.betweenWaves = true;
      st.running = false;
      st.over = false;
      st.gold = 100;
      st.towers = [{ type: "arrow", level: 1, x: 216, y: 72, cx: 4, cy: 1, cd: 0 }];
      window.__tdUI();
      document.querySelector('#nextWaveCard [data-advisor-mode="control"]').click();
      document.querySelector('#nextWaveCard [data-advisor-action="0"]').click();
      const ghost = st.buildGhost;
      const rect = document.getElementById("game").getBoundingClientRect();
      return {
        selected: st.selectedTowerType,
        confirm: st.advisorBuildConfirm,
        ghost,
        clientX: rect.left + ghost.x * (rect.width / 960),
        clientY: rect.top + ghost.y * (rect.height / 640),
      };
    });
    assert(advisorBuildR29.selected === "frost" && advisorBuildR29.confirm && advisorBuildR29.ghost,
      `顧問建塔建議一鍵顯示寒冰塔幽靈預覽（${advisorBuildR29.selected} @ ${advisorBuildR29.ghost && advisorBuildR29.ghost.cx},${advisorBuildR29.ghost && advisorBuildR29.ghost.cy}）`);
    if (vp.w <= 560) await page.touchscreen.tap(advisorBuildR29.clientX, advisorBuildR29.clientY);
    else await page.mouse.click(advisorBuildR29.clientX, advisorBuildR29.clientY);
    const advisorBuildConfirmR29 = await page.evaluate(() => {
      const st = window.TD.state();
      const result = {
        frostBuilt: st.towers.some((tw) => tw.type === "frost"),
        confirm: st.advisorBuildConfirm,
        towerCount: st.towers.length,
      };
      const saved = window.__r29Saved || {};
      window.TD.newGame();
      if (saved.meta === null) localStorage.removeItem("td_meta_v1");
      else if (saved.meta !== undefined) localStorage.setItem("td_meta_v1", saved.meta);
      if (saved.heroes === null) localStorage.removeItem("td_heroes_owned_v1");
      else if (saved.heroes !== undefined) localStorage.setItem("td_heroes_owned_v1", saved.heroes);
      window.__tdUI();
      return result;
    });
    assert(advisorBuildConfirmR29.frostBuilt && advisorBuildConfirmR29.towerCount === 2 && advisorBuildConfirmR29.confirm === false,
      "顧問幽靈塔再點確認後成功建造，且離開確認狀態");

    const advisorUpgradeR29 = await page.evaluate(() => {
      const savedMeta = localStorage.getItem("td_meta_v1");
      const savedHeroes = localStorage.getItem("td_heroes_owned_v1");
      const restore = () => {
        window.TD.newGame();
        if (savedMeta === null) localStorage.removeItem("td_meta_v1");
        else localStorage.setItem("td_meta_v1", savedMeta);
        if (savedHeroes === null) localStorage.removeItem("td_heroes_owned_v1");
        else localStorage.setItem("td_heroes_owned_v1", savedHeroes);
        window.__tdUI();
      };
      const st = window.TD.state();
      st.wave = 6;
      st.betweenWaves = true;
      st.running = false;
      st.over = false;
      st.gold = 90;
      st.towers = [{ type: "arrow", level: 1, x: 216, y: 72, cx: 4, cy: 1, cd: 0 }];
      window.__tdUI();
      document.querySelector('#nextWaveCard [data-advisor-mode="control"]').click();
      const actions = [...document.querySelectorAll("#nextWaveCard [data-advisor-action]")];
      actions[1].click();
      const text = document.getElementById("selPanel").innerText;
      const result = {
        selected: st.selectedTower === st.towers[0],
        highlighted: st.advisorUpgradeTarget === st.towers[0],
        panelShown: !document.getElementById("selPanel").classList.contains("hidden"),
        text,
      };
      restore();
      return result;
    });
    assert(advisorUpgradeR29.selected && advisorUpgradeR29.highlighted && advisorUpgradeR29.panelShown && advisorUpgradeR29.text.includes("Lv.1"),
      `顧問升級建議會選中目標塔並打開升級面板（${advisorUpgradeR29.text.replace(/\n/g, " / ")}）`);
    if (vp.w <= 560) {
      await page.evaluate(() => document.querySelector("#nextWaveCard .enemy-chip-btn").click());
      const enemyInfo = await page.evaluate(() => ({
        shown: !document.getElementById("enemyInfo").classList.contains("hidden"),
        text: document.getElementById("enemyInfo").innerText,
      }));
      assert(enemyInfo.shown && enemyInfo.text.includes("血量") && enemyInfo.text.includes("速度") && enemyInfo.text.includes("元素") && enemyInfo.text.includes("特性") && enemyInfo.text.includes("反制"),
        `手機可點敵人開小圖鑑（${enemyInfo.text.split("\n")[0]}）`);
      const abilityInfo = await page.evaluate(() => {
        const st = window.TD.state();
        const originalWave = st.wave;
        let text = "";
        for (let w = 0; w <= 4 && !text; w++) {
          st.wave = w;
          st.betweenWaves = true;
          window.__tdUI();
          const btn = [...document.querySelectorAll("#nextWaveCard .enemy-chip-btn")].find((el) => el.dataset.enemy === "goblin");
          if (btn) {
            btn.click();
            text = document.getElementById("enemyInfo").innerText;
          }
        }
        st.wave = originalWave;
        window.__tdUI();
        return text;
      });
      assert(abilityInfo.includes("狡詐閃避") && abilityInfo.includes("閃避") && abilityInfo.includes("反制"),
        `手機圖鑑同步顯示敵人能力（${abilityInfo.replace(/\n/g, " / ")}）`);
    }

    // 1. 建塔準備階段畫面會重繪（idle render loop），且未建任何塔時不能開第 1 波
    const noTowerStart = await page.evaluate(() => ({
      text: document.getElementById("startBtn").textContent,
      disabled: document.getElementById("startBtn").disabled,
      wave: window.TD.state().wave,
      towers: window.TD.state().towers.length,
    }));
    assert(noTowerStart.disabled && noTowerStart.text.includes("先建一座塔") && noTowerStart.wave === 0 && noTowerStart.towers === 0,
      "未建塔時開始第 1 波按鈕提示先建一座塔");

    if (vp.w === 1280) {
      const badges = await page.evaluate(() => ({
        arrow: document.querySelector('.tower-btn[data-type="arrow"]').dataset.hotkey,
        cannon: document.querySelector('.tower-btn[data-type="cannon"]').dataset.hotkey,
        meteor: document.querySelector('.skill-btn[data-skill="meteor"]').dataset.hotkey,
        freeze: document.querySelector('.skill-btn[data-skill="freeze"]').dataset.hotkey,
        start: document.getElementById("startBtn").dataset.hotkey,
        speed2: document.getElementById("speed2").dataset.hotkey,
        pause: document.getElementById("pauseBtn").dataset.hotkey,
        gacha: document.getElementById("gachaBtn").dataset.hotkey,
      }));
      assert(badges.arrow === "1" && badges.cannon === "2" && badges.meteor === "Q" && badges.freeze === "W" &&
        badges.start === "⏎" && badges.speed2 === "Tab" && badges.pause === "P" && badges.gacha === "H",
        "快捷鍵徽章標在塔、技能、下一波、加速、暫停與抽英雄按鈕");

      await page.keyboard.press("Digit1");
      const towerHotkey = await page.evaluate(() => ({
        selected: window.TD.state().selectedTowerType,
        active: document.querySelector('.tower-btn[data-type="arrow"]').classList.contains("active"),
      }));
      assert(towerHotkey.selected === "arrow" && towerHotkey.active, "按 1 進入弓箭塔放置模式");

      await page.keyboard.press("Escape");
      const escCancel = await page.evaluate(() => ({
        selectedTowerType: window.TD.state().selectedTowerType,
        pendingSkill: window.TD.state().pendingSkill,
      }));
      assert(!escCancel.selectedTowerType && !escCancel.pendingSkill, "Esc 取消選塔/待施放技能");

      await page.keyboard.press("KeyQ");
      const skillHotkey = await page.evaluate(() => ({
        pendingSkill: window.TD.state().pendingSkill,
        cursor: document.getElementById("game").style.cursor,
      }));
      assert(skillHotkey.pendingSkill === "meteor" && skillHotkey.cursor === "crosshair", "按 Q 進入隕石術施放模式");

      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        window.TD.state().skillCooldowns.meteor = 5;
        window.__tdUI();
      });
      await page.keyboard.press("KeyQ");
      const cooldownHotkey = await page.evaluate(() => ({
        pendingSkill: window.TD.state().pendingSkill,
        log: document.getElementById("log").innerText,
      }));
      assert(!cooldownHotkey.pendingSkill && cooldownHotkey.log.includes("冷卻中"), "技能冷卻中按 Q 不進入施放模式並提示");
      await page.evaluate(() => { window.TD.state().skillCooldowns.meteor = 0; window.__tdUI(); });

      await page.keyboard.press("Tab");
      const speed2Hotkey = await page.evaluate(() => ({
        speed: window.TD.state().speed,
        on: document.getElementById("speed2").classList.contains("on"),
      }));
      assert(speed2Hotkey.speed === 2 && speed2Hotkey.on, "Tab 切到 2× 速度且不跳焦點");
      await page.keyboard.press("Tab");
      const speed1Hotkey = await page.evaluate(() => ({
        speed: window.TD.state().speed,
        on: document.getElementById("speed1").classList.contains("on"),
      }));
      assert(speed1Hotkey.speed === 1 && speed1Hotkey.on, "Tab 再次切回 1× 速度");

      await page.evaluate(() => {
        window.TD.selectTower("arrow");
        const canvas = document.getElementById("game");
        const rect = canvas.getBoundingClientRect();
        const sx = rect.width / 960, sy = rect.height / 640;
        canvas.dispatchEvent(new MouseEvent("click", { clientX: rect.left + 504 * sx, clientY: rect.top + 72 * sy, bubbles: true }));
      });
      await page.keyboard.press("Enter");
      const enterHotkey = await page.evaluate(() => ({
        wave: window.TD.state().wave,
        betweenWaves: window.TD.state().betweenWaves,
        running: window.TD.state().running,
        spawnQueue: window.TD.state().spawnQueue.length,
      }));
      assert(enterHotkey.wave === 1 && enterHotkey.betweenWaves === false && enterHotkey.running && enterHotkey.spawnQueue > 0,
        "Enter 等同點下一波按鈕並開始第 1 波");

      await page.evaluate(() => {
        window.TD.newGame();
        document.getElementById("boardBtn").click();
      });
      await page.keyboard.press("Digit1");
      await page.keyboard.press("KeyH");
      await page.keyboard.press("Enter");
      const overlayGuard = await page.evaluate(() => ({
        progressShown: document.getElementById("progressOverlay").classList.contains("show"),
        gachaShown: document.getElementById("gachaOverlay").classList.contains("show"),
        selectedTowerType: window.TD.state().selectedTowerType,
        wave: window.TD.state().wave,
      }));
      assert(overlayGuard.progressShown && !overlayGuard.gachaShown && !overlayGuard.selectedTowerType && overlayGuard.wave === 0,
        "overlay 開啟時建塔、抽英雄與進波快捷鍵都被擋下");
      await page.keyboard.press("Escape");
      const overlayEsc = await page.evaluate(() => ({
        progressShown: document.getElementById("progressOverlay").classList.contains("show"),
      }));
      assert(!overlayEsc.progressShown, "progress overlay 開啟時 Esc 先關閉 overlay");
      await page.evaluate(() => { window.TD.newGame(); window.__tdUI(); });
    }

    const previewCheck = await page.evaluate(() => {
      window.TD.selectTower("arrow");
      const canvas = document.getElementById("game");
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / 960, sy = rect.height / 640;
      const blocked = window.TD.buildPreviewAt(100, 80);
      const open = window.TD.buildPreviewAt(504, 72);
      const far = window.TD.buildPreviewAt(936, 24);
      const beforeFarClick = window.TD.state().towers.length;
      canvas.dispatchEvent(new MouseEvent("click", { clientX: rect.left + 936 * sx, clientY: rect.top + 24 * sy, bubbles: true }));
      return {
        blockedOk: blocked.ok,
        blockedReason: blocked.reason,
        farOk: far.ok,
        farReason: far.reason,
        farPathDistance: far.pathDistance,
        farClickTowers: window.TD.state().towers.length,
        beforeFarClick,
        openOk: open.ok,
        openReason: open.reason,
        clientX: rect.left + 504 * sx,
        clientY: rect.top + 72 * sy,
      };
    });
    assert(previewCheck.blockedOk === false && previewCheck.blockedReason.includes("路徑") && previewCheck.openOk === true,
      `放塔預覽回報合法/非法格（非法原因：${previewCheck.blockedReason}，合法：${previewCheck.openReason || "可放置"}）`);
    assert(previewCheck.farOk === false && previewCheck.farReason.includes("太遠打不到路徑") && previewCheck.farClickTowers === previewCheck.beforeFarClick,
      `遠離路徑格不可建（距離 ${previewCheck.farPathDistance}px，原因：${previewCheck.farReason}）`);

    let idleRender;
    if (vp.w <= 560) {
      await page.touchscreen.tap(previewCheck.clientX, previewCheck.clientY);
      const firstTap = await page.evaluate(() => ({
        towers: window.TD.state().towers.length,
        hasGhost: !!window.TD.state().buildGhost,
      }));
      await page.touchscreen.tap(previewCheck.clientX, previewCheck.clientY);
      idleRender = await page.evaluate(() => ({
        running: window.TD.state().running,
        towers: window.TD.state().towers.length,
        gold: window.TD.state().gold,
      }));
      assert(firstTap.towers === 0 && firstTap.hasGhost === true, "手機第一下只顯示幽靈塔、不直接建造");
    } else {
      idleRender = await page.evaluate((pos) => {
        const st = window.TD.state();
        const running = st.running;
        const canvas = document.getElementById("game");
        const ev = new MouseEvent("click", { clientX: pos.x, clientY: pos.y, bubbles: true });
        canvas.dispatchEvent(ev);
        return { running, towers: st.towers.length, gold: st.gold };
      }, { x: previewCheck.clientX, y: previewCheck.clientY });
    }
    const duplicateBuild = await page.evaluate(() => {
      window.TD.selectTower("arrow");
      const preview = window.TD.buildPreviewAt(504, 72);
      return { ok: preview.ok, reason: preview.reason };
    });
    assert(idleRender.running === false, "第一波開始前主迴圈未跑（準備階段）");
    assert(idleRender.towers === 1, `準備階段可放塔（場上 ${idleRender.towers} 座）`);
    assert(duplicateBuild.ok === false && duplicateBuild.reason.includes("已有塔"), `已有塔格位會擋建造（${duplicateBuild.reason}）`);
    const missionAfterBuild = await page.evaluate(() => {
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      return {
        crystal: meta.soulCrystal,
        firstTower: meta.beginnerMissions && meta.beginnerMissions.firstTower === true,
        text: document.getElementById("beginnerMissions").innerHTML,
      };
    });
    assert(missionAfterBuild.firstTower && missionAfterBuild.crystal >= 4,
      `建塔後新手任務立即領獎（魂晶 ${missionAfterBuild.crystal}）`);

    // Stage 4：毒霧塔 DoT 與聖光塔 buff
    const stage4Combat = await page.evaluate(() => {
      const st = window.TD.state();
      const saved = {
        towers: st.towers,
        enemies: st.enemies,
        bullets: st.bullets,
        spawnQueue: st.spawnQueue,
        particles: st.particles,
      };
      st.towers = []; st.enemies = []; st.bullets = []; st.spawnQueue = []; st.particles = [];

      const e = window.TD.debug.spawnEnemy("slime", { x: 220, y: 220, wp: 1, hp: 200, maxHp: 200, speed: 0 });
      const poison = { type: "poison", level: 1, x: 220, y: 220, cx: 4, cy: 4, cd: 999 };
      st.towers.push(poison);
      window.TD.debug.fireTower(poison, e);
      window.TD.debug.step(0.2);
      const afterHit = e.hp;
      const stacks = e.poisonStacks.length;
      window.TD.debug.step(1.0);
      const afterDot = e.hp;

      const arrow = { type: "arrow", level: 1, x: 200, y: 200, cx: 4, cy: 4, cd: 0 };
      const support = { type: "support", level: 1, x: 230, y: 200, cx: 5, cy: 4, cd: 0 };
      st.towers = [arrow, support];
      const base = window.TD.towerStat(arrow, "damage");
      const buff = window.TD.getTowerBuff(arrow);
      const effective = window.TD.effectiveTowerDamage(arrow);
      const singleSupportGain = window.TD.supportDpsGain(support);

      const poisonSupport = { type: "support", level: 1, x: 250, y: 220, cx: 5, cy: 4, cd: 0 };
      st.towers = [poison, poisonSupport];
      const poisonGain = window.TD.supportDpsGain(poisonSupport);
      const poisonExpectedGain = window.TD.towerStat(poison, "damage") * window.TD.config.TOWERS.poison.fireRate * window.TD.towerStat(poisonSupport, "buff");

      const support2 = { type: "support", level: 1, x: 240, y: 200, cx: 5, cy: 4, cd: 0 };
      st.towers = [arrow, support, support2];
      const duplicateGainA = window.TD.supportDpsGain(support);
      const duplicateGainB = window.TD.supportDpsGain(support2);

      st.towers = []; st.enemies = []; st.bullets = []; st.spawnQueue = []; st.particles = [];
      const dodgeEnemy = window.TD.debug.spawnEnemy("goblin", { x: 300, y: 300, wp: 1, hp: 60, maxHp: 60, speed: 0, _dodgeRoll: 0 });
      const dodgeTower = { type: "arrow", level: 1, x: 300, y: 300, cx: 6, cy: 6, cd: 999 };
      st.towers = [dodgeTower];
      window.TD.debug.fireTower(dodgeTower, dodgeEnemy);
      window.TD.debug.step(0.05);
      const goblinDodged = dodgeEnemy._dodgeTried === true && dodgeEnemy.hp === 60;

      st.towers = []; st.enemies = []; st.bullets = [];
      const orc = window.TD.debug.spawnEnemy("orc", { x: 320, y: 320, wp: 1, hp: 30, maxHp: 100, speed: 10 });
      window.TD.debug.step(0.05);
      const orcRaged = orc._enraged === true && orc.speed > 10;

      st.towers = []; st.enemies = []; st.bullets = [];
      const splitBat = window.TD.debug.spawnEnemy("bat", { x: 340, y: 340, wp: 1, hp: 1, maxHp: 10, speed: 0 });
      const splitTower = { type: "arrow", level: 1, x: 340, y: 340, cx: 7, cy: 7, cd: 999 };
      st.towers = [splitTower];
      window.TD.debug.fireTower(splitTower, splitBat);
      window.TD.debug.step(0.05);
      const splitChildren = st.enemies.filter((enemy) => enemy._splitChild).length;

      st.towers = saved.towers;
      st.enemies = saved.enemies;
      st.bullets = saved.bullets;
      st.spawnQueue = saved.spawnQueue;
      st.particles = saved.particles;
      return { afterHit, afterDot, stacks, base, buff, effective, singleSupportGain, poisonGain, poisonExpectedGain, duplicateGainA, duplicateGainB, goblinDodged, orcRaged, splitChildren };
    });
    assert(stage4Combat.stacks > 0 && stage4Combat.afterDot < stage4Combat.afterHit,
      `毒霧塔 DoT 生效（命中後 ${stage4Combat.afterHit.toFixed(1)} → tick 後 ${stage4Combat.afterDot.toFixed(1)}，層數 ${stage4Combat.stacks}）`);
    assert(stage4Combat.buff >= 0.20 && stage4Combat.effective > stage4Combat.base,
      `聖光塔 buff 生效（base ${stage4Combat.base}，buff ${stage4Combat.buff}，effective ${stage4Combat.effective}）`);
    assert(Math.abs(stage4Combat.poisonGain - stage4Combat.poisonExpectedGain) < 0.05,
      `聖光塔 DPS 估算只計直擊、不把毒 DoT 乘 buff（${stage4Combat.poisonGain.toFixed(2)}）`);
    assert(stage4Combat.singleSupportGain > 0 && stage4Combat.duplicateGainA < 0.001 && stage4Combat.duplicateGainB < 0.001,
      "同等聖光塔重疊時，單座顯示邊際 DPS 為 0");
    assert(stage4Combat.goblinDodged && stage4Combat.orcRaged && stage4Combat.splitChildren === 1,
      "敵人能力觸發：哥布林首擊閃避、獸人殘血狂暴、蝙蝠死亡分裂");

    // 2. 抽卡經濟：首抽免費、花魂晶不花金錢、重複退魂晶、魂晶不足被擋
    const gachaMetaText = await page.textContent("#gachaMeta");
    const totalHeroesForMeta = await page.evaluate(() => Object.keys(window.TD.config.HEROES).length);
    assert(gachaMetaText.includes("保底 0/18") && gachaMetaText.includes(`英雄 0/${totalHeroesForMeta}`),
      `英雄區 meta 顯示魂晶、保底與收集進度（${gachaMetaText}）`);
    const pityClampText = await page.evaluate(() => {
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      meta.gachaPity = 25;
      localStorage.setItem("td_meta_v1", JSON.stringify(meta));
      window.__tdUI();
      const text = document.getElementById("gachaMeta").textContent;
      meta.gachaPity = 0;
      localStorage.setItem("td_meta_v1", JSON.stringify(meta));
      window.__tdUI();
      return text;
    });
    assert(pityClampText.includes("保底 18/18"), `舊存檔 pity 超過保底時顯示會 clamp（${pityClampText}）`);
    let gacha1;
    if (vp.w === 1280) {
      const goldBefore = await page.evaluate(() => window.TD.state().gold);
      await page.keyboard.press("KeyH");
      gacha1 = await page.evaluate((goldBeforeValue) => {
        const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
        return { goldBefore: goldBeforeValue, goldAfter: window.TD.state().gold,
          crystal: meta.soulCrystal, count: meta.gachaCount, paused: window.TD.state().paused,
          overlayShown: document.getElementById("gachaOverlay").classList.contains("show") };
      }, goldBefore);
    } else {
      gacha1 = await page.evaluate(() => {
        const goldBefore = window.TD.state().gold;
        document.getElementById("gachaBtn").click(); // 首抽（免費）
        const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
        return { goldBefore, goldAfter: window.TD.state().gold,
          crystal: meta.soulCrystal, count: meta.gachaCount, paused: window.TD.state().paused,
          overlayShown: document.getElementById("gachaOverlay").classList.contains("show") };
      });
    }
    assert(gacha1.goldAfter === gacha1.goldBefore, `抽卡不花場內金錢（${gacha1.goldBefore} 不變）`);
    assert(gacha1.crystal >= 4 && gacha1.count === 1, `首抽免費且保留任務魂晶（魂晶 ${gacha1.crystal}、抽數 ${gacha1.count}）`);
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
    const deployFirstHeroMission = await page.evaluate(() => {
      const card = document.querySelector("#heroRoster .hero-card");
      const btn = card && card.querySelector(".hdeploy");
      if (btn) btn.click();
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      return {
        crystal: meta.soulCrystal,
        deployHero: meta.beginnerMissions && meta.beginnerMissions.deployHero === true,
        deployed: window.TD.state().heroes.length,
        text: document.getElementById("beginnerMissions").textContent + "\n" + document.getElementById("gachaMeta").textContent,
      };
    });
    assert(deployFirstHeroMission.crystal >= 8 && deployFirstHeroMission.text.includes("第二英雄"),
      `首抽後顯示第二英雄進度與可取得路徑（魂晶 ${deployFirstHeroMission.crystal}）`);

    const waveSoul = await page.evaluate(() => {
      const before = JSON.parse(localStorage.getItem("td_meta_v1"));
      window.TD.startWave();
      const st = window.TD.state();
      st.spawnQueue = [];
      st.enemies = [];
      window.TD.debug.step(0.2);
      st.running = false;
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      const expected = window.TDRules.waveSoulReward(st.wave, window.TD.getDifficulty().id);
      return {
        wave: st.wave,
        before: before.soulCrystal,
        after: after.soulCrystal,
        delta: after.soulCrystal - before.soulCrystal,
        expected,
        runSoulEarned: st.runSoulEarned,
        metaText: document.getElementById("gachaMeta").textContent,
        logText: document.getElementById("log").innerText,
      };
    });
    const firstWaveMissionReward = 4;
    assert(waveSoul.delta === waveSoul.expected + firstWaveMissionReward && waveSoul.runSoulEarned === waveSoul.expected && waveSoul.metaText.includes(`${waveSoul.after}💎`) && waveSoul.logText.includes(`+${waveSoul.expected}`),
      `清掉第 ${waveSoul.wave} 波後魂晶即時入袋並領首波任務（${waveSoul.before} → ${waveSoul.after}，清波 +${waveSoul.expected}，任務 +${firstWaveMissionReward}）`);

    // 3. 魂晶不足：第二抽（成本 20）應被擋
    const gacha2 = await page.evaluate(() => {
      const before = JSON.parse(localStorage.getItem("td_meta_v1"));
      document.getElementById("gachaBtn").click();
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      return { btnDisabled: document.getElementById("gachaBtn").disabled, countBefore: before.gachaCount, countAfter: after.gachaCount };
    });
    assert(gacha2.btnDisabled === true && gacha2.countAfter === gacha2.countBefore, "魂晶不足時抽卡被擋（按鈕 disabled、抽數不變）");

    // 4. 不預置魂晶：靠建塔/首波/上場/升級/施法任務湊滿第二抽
    const missionPathToSecondDraw = await page.evaluate(() => {
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      const st = window.TD.state();
      st.gold = Math.max(st.gold, 200);
      st.selectedTower = st.towers[0];
      window.__tdUI();
      document.getElementById("upgBtn").click();
      window.TD.selectSkill("meteor");
      const canvas = document.getElementById("game");
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent("click", { clientX: rect.left + rect.width * 0.5, clientY: rect.top + rect.height * 0.5, bubbles: true }));
      window.__tdUI();
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      return {
        beforeCrystal: meta.soulCrystal,
        afterCrystal: after.soulCrystal,
        firstUpgrade: after.beginnerMissions && after.beginnerMissions.firstUpgrade === true,
        firstSkill: after.beginnerMissions && after.beginnerMissions.firstSkill === true,
        gachaDisabled: document.getElementById("gachaBtn").disabled,
        missionText: document.getElementById("beginnerMissions").innerText,
      };
    });
    assert(missionPathToSecondDraw.firstUpgrade && missionPathToSecondDraw.firstSkill && missionPathToSecondDraw.afterCrystal >= 20 && missionPathToSecondDraw.gachaDisabled === false,
      `任務線讓新帳號第 8 波前可達成第二抽（${missionPathToSecondDraw.beforeCrystal} → ${missionPathToSecondDraw.afterCrystal}💎）`);

    const gacha3 = await page.evaluate(async () => {
      window.__tdUI();
      const before = JSON.parse(localStorage.getItem("td_meta_v1"));
      const firstOwned = (JSON.parse(localStorage.getItem("td_heroes_owned_v1")) || [])[0];
      const duplicateSeq = {
        archer: [0.01, 0.01, 0.01],
        cleric: [0.01, 0.75, 0.01],
        knight: [0.60, 0.01, 0.01],
        iceMage: [0.60, 0.75, 0.01],
        mage: [0.90, 0.01, 0.01],
        valkyrie: [0.99, 0.01, 0.01],
        daji: [0.99, 0.30, 0.01],
        guanyu: [0.99, 0.55, 0.01],
        wukong: [0.99, 0.80, 0.01],
        nezha: [0.90, 0.75, 0.01],
      }[firstOwned] || [0.01, 0.01, 0.01];
      const originalRandom = Math.random;
      Math.random = () => duplicateSeq.length ? duplicateSeq.shift() : originalRandom();
      document.getElementById("gachaBtn").click();
      Math.random = originalRandom;
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      const owned = JSON.parse(localStorage.getItem("td_heroes_owned_v1"));
      return { beforeCrystal: before.soulCrystal, crystal: after.soulCrystal, pity: after.gachaPity, count: after.gachaCount, firstOwned, owned,
        secondHeroMission: after.beginnerMissions && after.beginnerMissions.secondHero === true };
    });
    const secondHeroMissionReward = 5;
    assert(gacha3.secondHeroMission && gacha3.crystal === gacha3.beforeCrystal - 20 + secondHeroMissionReward,
      `第二抽扣 20💎 並立即領第二英雄任務 +5💎（${gacha3.beforeCrystal} → ${gacha3.crystal}）`);
    assert(gacha3.count === 2, `抽數累積（${gacha3.count}）`);
    assert(typeof gacha3.pity === "number" && gacha3.pity >= 0, `pity 有持久化追蹤（${gacha3.pity}）`);
    assert(gacha3.owned.length === 2 && new Set(gacha3.owned).size === 2,
      `擁有 1 隻後，第二抽取得第 2 隻不同英雄（${gacha3.owned.join(",")}；原始撞 ${gacha3.firstOwned}）`);
    // 關閉這次的盲盒浮層
    await page.evaluate(() => document.getElementById("chest").click());
    await sleep(1100);
    await page.evaluate(() => document.getElementById("revealOk").click());
    await sleep(200);
    const heroLongUi = await page.evaluate(() => {
      const owned = JSON.parse(localStorage.getItem("td_heroes_owned_v1")) || [];
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      meta.heroProgress = meta.heroProgress || {};
      owned.forEach((id) => {
        meta.heroProgress[id] = { xp: 120, level: window.TDRules.heroLongLevelFromXp(120) };
      });
      localStorage.setItem("td_meta_v1", JSON.stringify(meta));
      window.__tdUI();
      const card = document.querySelector("#heroRoster .hero-card");
      if (card) card.click();
      const detailOverlay = document.getElementById("heroDetailOverlay");
      const detailText = detailOverlay.innerText;
      const detailShown = detailOverlay.classList.contains("show");
      const cardAria = card && card.getAttribute("aria-label");
      const deployAria = card && card.querySelector(".hdeploy") && card.querySelector(".hdeploy").getAttribute("aria-label");
      document.getElementById("heroDetailClose").click();
      return {
        owned,
        rosterText: document.getElementById("heroRoster").innerText,
        detailShown,
        detailText,
        cardAria,
        deployAria,
        pausedAfterClose: window.TD.state().paused,
      };
    });
    assert(heroLongUi.rosterText.includes("羈絆 Lv.6") && heroLongUi.rosterText.includes("+5%攻血"),
      `英雄卡顯示跨局羈絆等級與永久加成（${heroLongUi.rosterText.replace(/\n/g, " / ")}）`);
    assert(heroLongUi.detailShown && heroLongUi.detailText.includes("英雄詳情") && heroLongUi.detailText.includes("羈絆 Lv.6") &&
      heroLongUi.detailText.includes("下一節點 Lv.10") && heroLongUi.detailText.includes("本局表現摘要") && heroLongUi.pausedAfterClose === false,
      `英雄詳情顯示羈絆進度、節點預告與本局表現（${heroLongUi.detailText.replace(/\n/g, " / ")}）`);
    assert(heroLongUi.cardAria && heroLongUi.cardAria.includes("英雄詳情") && heroLongUi.deployAria,
      `英雄名單卡與部署按鈕有 aria-label（${heroLongUi.cardAria}）`);
    const secondHeroDeploy = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#heroRoster .hero-card")];
      cards.forEach((card) => {
        const btn = card.querySelector(".hdeploy");
        if (btn && btn.textContent.includes("上場")) btn.click();
      });
      return {
        rosterCount: cards.length,
        deployedIds: window.TD.state().heroes.map((h) => h.id),
        slotText: document.getElementById("deployedHeroes").innerText,
        slotAria: [...document.querySelectorAll("#deployedHeroes .deployed-hero-slot")].map((slot) => slot.getAttribute("aria-label")).join(" / "),
      };
    });
    assert(secondHeroDeploy.rosterCount === 2 && secondHeroDeploy.deployedIds.length === 2 && new Set(secondHeroDeploy.deployedIds).size === 2,
      `第 2 隻英雄可上場（${secondHeroDeploy.deployedIds.join(",")}）`);
    assert(secondHeroDeploy.slotText.includes("羈絆Lv.6"),
      `部署小卡顯示跨局羈絆等級（${secondHeroDeploy.slotText.replace(/\n/g, " / ")}）`);
    assert(secondHeroDeploy.slotAria.includes("上場英雄") && secondHeroDeploy.slotAria.includes("生命"),
      `部署小卡有 aria-label（${secondHeroDeploy.slotAria}）`);

    const heroCommand = await page.evaluate(() => {
      window.__tdUI();
      const slots = [...document.querySelectorAll("#deployedHeroes .deployed-hero-slot")];
      const slotTextBefore = document.getElementById("deployedHeroes").innerText;
      if (slots[0]) slots[0].click();
      const pendingAfterCard = !!window.TD.state().pendingHero;
      const activeAfterCard = !!document.querySelector("#deployedHeroes .deployed-hero-slot.active");
      const canvas = document.getElementById("game");
      const rect = canvas.getBoundingClientRect();
      canvas.dispatchEvent(new MouseEvent("click", {
        clientX: rect.left + rect.width * 0.55,
        clientY: rect.top + rect.height * 0.52,
        bubbles: true,
      }));
      window.__tdUI();
      const first = window.TD.state().heroes[0];
      return {
        slotCount: slots.length,
        hpBars: document.querySelectorAll("#deployedHeroes .dh-hp").length,
        slotTextBefore,
        pendingAfterCard,
        activeAfterCard,
        guardSet: !!(first && first.guardPoint),
        slotTextAfter: document.getElementById("deployedHeroes").innerText,
      };
    });
    assert(heroCommand.slotCount === 2 && heroCommand.hpBars === 2 && heroCommand.slotTextBefore.includes("Lv.") && heroCommand.slotTextBefore.includes("點我駐守"),
      `部署英雄小卡顯示頭像/血條/等級與入口（${heroCommand.slotTextBefore.replace(/\n/g, " / ")}）`);
    assert(heroCommand.pendingAfterCard && heroCommand.activeAfterCard && heroCommand.guardSet && heroCommand.slotTextAfter.includes("駐守中"),
      "點英雄小卡可進入駐守模式，點地圖後成功設定駐守點");

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
    const running = await page.evaluate(() => {
      const enemies = window.TD.state().enemies;
      const animated = enemies.some((e) => (e.walkDist || 0) > 0 && Number.isFinite(e.vx) && Number.isFinite(e.vy) && typeof e.flipX === "boolean");
      return { enemies: enemies.length, over: window.TD.state().over, animated };
    });
    assert(running.enemies > 0 && !running.over, `波次進行中有敵人生成（${running.enemies} 隻）`);
    assert(running.animated, "敵人移動動畫相位與朝向資料有更新");

    const liveProgressR7 = await page.evaluate(() => {
      const st = window.TD.state();
      st.wave = 8;
      st.clearedWave = 8;
      st.betweenWaves = true;
      st.running = false;
      st.over = false;
      st.paused = false;
      st.runSoulEarned = 14;
      window.__tdUI();
      document.getElementById("boardBtn").click();
      const shown = document.getElementById("progressOverlay").classList.contains("show");
      const pausedOpen = window.TD.state().paused;
      const text = document.getElementById("runProgress").innerText;
      document.getElementById("progressClose").click();
      return { shown, pausedOpen, pausedClose: window.TD.state().paused, text };
    });
    assert(liveProgressR7.shown && liveProgressR7.text.includes("本局進度") && liveProgressR7.text.includes("第 8 波") &&
      liveProgressR7.text.includes("距離第 10 波還差 2 波") && liveProgressR7.text.includes("本局魂晶") && liveProgressR7.text.includes("清波 +14"),
      `第 8 波未死亡 overlay 顯示本局進度與魂晶（${liveProgressR7.text.replace(/\n/g, " / ")}）`);
    assert(liveProgressR7.pausedOpen === true && liveProgressR7.pausedClose === false,
      "第 8 波局中進度 overlay 開啟暫停、關閉恢復");

    // 7. Stage 3：模擬結算 → 排行榜寫入、成就解鎖與魂晶獎勵
    const stage3Result = await page.evaluate(() => {
      const before = JSON.parse(localStorage.getItem("td_meta_v1"));
      const beforeCrystal = before.soulCrystal;
      const runSoulEarned = window.TD.state().runSoulEarned || 0;
      window.TD.state().heroes.forEach((h, idx) => {
        h.runXp = (h.runXp || 0) + 12 + idx;
        if (idx === 0) { h.level += 1; h.levelsGained = (h.levelsGained || 0) + 1; }
      });
      const heroGrowth = window.TD.state().heroes.map((h) => ({
        id: h.id,
        level: h.level,
        xp: h.runXp || 0,
        levelsGained: h.levelsGained || 0,
      }));
      const firstHeroId = heroGrowth[0] && heroGrowth[0].id;
      if (firstHeroId) {
        before.heroProgress = before.heroProgress || {};
        before.heroProgress[firstHeroId] = { xp: 94, level: window.TDRules.heroLongLevelFromXp(94) };
        localStorage.setItem("td_meta_v1", JSON.stringify(before));
      }
      window.__tdGameOver(10, 1234, {
        kills: 100,
        difficulty: window.TD.getDifficulty(),
        soulEarned: runSoulEarned,
        heroGrowth,
        leaks: { byWave: { 7: { count: 4, damage: 12, byType: { bat: 4 } } } },
        towers: [{ type: "arrow", level: 2, cx: 4, cy: 1, x: 216, y: 72 }],
      });
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      const expectedCrystal = beforeCrystal
        + window.ACHIEVEMENTS.wave10.reward
        + window.ACHIEVEMENTS.wave10First.reward
        + window.ACHIEVEMENTS.kills100.reward;
      const firstDeathCta = document.getElementById("deathCtaBtn").textContent;
      const firstMetaText = document.getElementById("metaResult").innerText;
      const bondToastText = (document.querySelector(".bond-toast") && document.querySelector(".bond-toast").textContent) || "";
      window.TD.setMap("plains");
      window.TD.newGame();
      window.__tdGameOver(6, 777, { kills: 12, difficulty: window.TD.getDifficulty(), soulEarned: 0, heroGrowth: [] });
      const afterBoth = JSON.parse(localStorage.getItem("td_meta_v1"));
      const canyonBoard = (afterBoth.board.normal && afterBoth.board.normal.canyon) || [];
      const plainsBoard = (afterBoth.board.normal && afterBoth.board.normal.plains) || [];
      const heroProgressValues = Object.values(afterBoth.heroProgress || {});
      return {
        beforeCrystal,
        runSoulEarned,
        crystal: afterBoth.soulCrystal,
        expectedCrystal,
        heroProgressCount: heroProgressValues.length,
        heroProgressMaxXp: heroProgressValues.reduce((max, item) => Math.max(max, item.xp || 0), 0),
        canyonLen: canyonBoard.length,
        canyonWave: canyonBoard[0] && canyonBoard[0].wave,
        canyonScore: canyonBoard[0] && canyonBoard[0].score,
        canyonKills: canyonBoard[0] && canyonBoard[0].kills,
        canyonMap: canyonBoard[0] && canyonBoard[0].map,
        plainsLen: plainsBoard.length,
        plainsWave: plainsBoard[0] && plainsBoard[0].wave,
        plainsScore: plainsBoard[0] && plainsBoard[0].score,
        plainsMap: plainsBoard[0] && plainsBoard[0].map,
        wave10: afterBoth.achievements.wave10 === true,
        wave10First: afterBoth.achievements.wave10First === true,
        kills100: afterBoth.achievements.kills100 === true,
        deathCta: firstDeathCta,
        metaText: firstMetaText,
        bondToastText,
      };
    });
    assert(stage3Result.canyonLen === 1 && stage3Result.canyonWave === 10 && stage3Result.canyonScore === 1234 && stage3Result.canyonKills === 100 && stage3Result.canyonMap === "canyon",
      `峽谷榜寫入本場紀錄（${stage3Result.canyonWave} 波 / ${stage3Result.canyonScore} 分 / ${stage3Result.canyonKills} 殺 / ${stage3Result.canyonMap}）`);
    assert(stage3Result.plainsLen === 1 && stage3Result.plainsWave === 6 && stage3Result.plainsScore === 777 && stage3Result.plainsMap === "plains",
      `平原榜獨立寫入且不混入峽谷榜（${stage3Result.plainsWave} 波 / ${stage3Result.plainsScore} 分 / ${stage3Result.plainsMap}）`);
    assert(stage3Result.wave10 && stage3Result.wave10First && stage3Result.kills100 && stage3Result.metaText.includes("解鎖") && stage3Result.metaText.includes("本場第 1 名") && stage3Result.metaText.includes(`+${stage3Result.runSoulEarned}`) && stage3Result.metaText.includes("本局英雄成長") && stage3Result.metaText.includes("XP") && stage3Result.metaText.includes("長線") && stage3Result.metaText.includes("羈絆") && stage3Result.metaText.includes("本局檢討") && stage3Result.metaText.includes("第 7 波漏 4 隻") && stage3Result.metaText.includes("寒冰塔"),
      "結算畫面顯示本場名次、新解鎖成就、本局魂晶與英雄成長");
    assert(stage3Result.heroProgressCount >= 2 && stage3Result.heroProgressMaxXp > 120,
      `戰後寫入英雄長線 XP（英雄數 ${stage3Result.heroProgressCount}，最高 XP ${stage3Result.heroProgressMaxXp}）`);
    assert(stage3Result.bondToastText.includes("羈絆升級"),
      `羈絆升級時顯示 toast（${stage3Result.bondToastText}）`);
    assert(stage3Result.crystal === stage3Result.expectedCrystal,
      `死亡不重複清波魂晶，成就正確增加（${stage3Result.beforeCrystal} → ${stage3Result.crystal}）`);
    assert(stage3Result.deathCta.includes("立即抽英雄"),
      `死亡結算主 CTA 在魂晶足夠時導向抽英雄（${stage3Result.deathCta}）`);
    const ctaBefore = await page.evaluate(() => {
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      return { crystal: meta.soulCrystal, count: meta.gachaCount };
    });
    await page.click("#deathCtaBtn");
    await sleep(150);
    const ctaAfterClick = await page.evaluate(() => {
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      return {
        crystal: meta.soulCrystal,
        count: meta.gachaCount,
        gachaShown: document.getElementById("gachaOverlay").classList.contains("show"),
      };
    });
    await page.keyboard.press("Enter");
    await sleep(150);
    const ctaAfterEnter = await page.evaluate(() => {
      const meta = JSON.parse(localStorage.getItem("td_meta_v1"));
      return { crystal: meta.soulCrystal, count: meta.gachaCount };
    });
    assert(ctaAfterClick.gachaShown && ctaAfterClick.count === ctaBefore.count + 1 && ctaAfterClick.crystal < ctaBefore.crystal,
      `死亡 CTA 第一次點擊只抽一次（${ctaBefore.crystal} → ${ctaAfterClick.crystal}，抽數 ${ctaBefore.count} → ${ctaAfterClick.count}）`);
    assert(ctaAfterEnter.crystal === ctaAfterClick.crystal && ctaAfterEnter.count === ctaAfterClick.count,
      "死亡 CTA 開啟抽卡 overlay 後按 Enter 不會重複扣魂晶");
    await page.evaluate(() => document.getElementById("chest").click());
    await sleep(1100);
    await page.evaluate(() => document.getElementById("revealOk").click());
    await sleep(250);

    // 8. Stage 3：排行榜/成就 overlay 顯示資料，開啟暫停、關閉恢復
    const progressOverlay = await page.evaluate(() => {
      document.getElementById("overlay").classList.remove("show");
      window.TD.setPaused(false);
      document.getElementById("boardBtn").click();
      const pausedOpen = window.TD.state().paused;
      const shown = document.getElementById("progressOverlay").classList.contains("show");
      const mapTabs = [...document.querySelectorAll("#mapTabs .progress-tab")];
      const canyonTab = mapTabs.find((btn) => btn.innerText.includes("迂迴峽谷"));
      if (canyonTab) canyonTab.click();
      const boardText = document.getElementById("boardList").innerText;
      const mapTabText = document.getElementById("mapTabs").innerText;
      const achText = document.getElementById("achievementList").innerText;
      document.getElementById("progressClose").click();
      return { shown, pausedOpen, pausedClose: window.TD.state().paused, boardText, mapTabText, achText };
    });
    assert(progressOverlay.shown && progressOverlay.mapTabText.includes("翠綠平原") && progressOverlay.mapTabText.includes("迂迴峽谷") &&
      progressOverlay.boardText.includes("第 10 波") && progressOverlay.boardText.includes("1234") && progressOverlay.boardText.includes("迂迴峽谷"),
      "排行榜 overlay 顯示地圖 tab，切到峽谷後只顯示該地圖紀錄");
    assert(progressOverlay.achText.includes("站穩防線") && progressOverlay.achText.includes("百人斬"),
      "成就 overlay 顯示已解鎖與未解鎖清單");
    assert(progressOverlay.pausedOpen === true && progressOverlay.pausedClose === false,
      "排行榜 overlay 開啟時暫停，關閉後恢復");

    // 9. Stage 3 回歸：overlay 開啟後 Enter 不得重入或觸發底下按鈕
    await page.click("#boardBtn");
    await page.keyboard.press("Enter");
    const progressEnter = await page.evaluate(() => ({
      progressShown: document.getElementById("progressOverlay").classList.contains("show"),
      gachaShown: document.getElementById("gachaOverlay").classList.contains("show"),
      pausedAfterEnter: window.TD.state().paused,
    }));
    await page.click("#progressClose");
    const progressAfterClose = await page.evaluate(() => ({
      paused: window.TD.state().paused,
      gachaShown: document.getElementById("gachaOverlay").classList.contains("show"),
    }));
    assert(progressEnter.progressShown && progressEnter.pausedAfterEnter === true && progressAfterClose.paused === false && progressEnter.gachaShown === false && progressAfterClose.gachaShown === false,
      "排行榜 overlay 開啟後按 Enter 不重入，關閉後恢復且不會同時開啟抽卡 overlay");

    const resilienceR25 = await page.evaluate(() => {
      const before = { soulCrystal: 77, games: 4, bestWave: 6, bestByDiff: { normal: 6 } };
      localStorage.setItem("td_meta_v1", JSON.stringify(before));
      window.dispatchEvent(new ErrorEvent("error", { message: "R25 synthetic fault" }));
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      const notice = document.querySelector(".recovery-toast");
      const text = notice ? notice.textContent : "";
      if (notice) notice.remove();
      return { after, text };
    });
    assert(resilienceR25.after.soulCrystal === 77 && resilienceR25.after.bestWave === 6 && resilienceR25.text.includes("已保護存檔"),
      `全域錯誤時安全存檔並顯示恢復提示（${resilienceR25.text}）`);

    // 10. RWD：無水平溢出
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 2, `無水平溢出（${overflow}）`);

    // 11. 全程無 console error / pageerror
    assert(errors.length === 0, "無 console 錯誤 / pageerror" + (errors.length ? "：" + errors.slice(0, 3).join(" | ") : ""));

    await page.close();
  }
  } finally {
    await browser.close();
    server.close();
  }
  if (failed > 0) { console.error("\n❌ " + failed + " 項失敗"); process.exit(1); }
  console.log("\n✅ 塔防 E2E 全部通過");
}

run().catch((err) => { console.error(err); process.exit(1); });
