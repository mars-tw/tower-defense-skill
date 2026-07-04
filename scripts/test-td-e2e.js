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
    }));
    assert(nextWaveCardInitial.text.includes("下一波情報") && nextWaveCardInitial.text.includes("主元素") && nextWaveCardInitial.enemyButtons > 0,
      `下一波情報卡顯示元素與主要敵人（敵人按鈕 ${nextWaveCardInitial.enemyButtons} 個）`);
    if (vp.w <= 560) {
      await page.evaluate(() => document.querySelector("#nextWaveCard .enemy-chip-btn").click());
      const enemyInfo = await page.evaluate(() => ({
        shown: !document.getElementById("enemyInfo").classList.contains("hidden"),
        text: document.getElementById("enemyInfo").innerText,
      }));
      assert(enemyInfo.shown && enemyInfo.text.includes("血量") && enemyInfo.text.includes("速度") && enemyInfo.text.includes("元素") && enemyInfo.text.includes("特性"),
        `手機可點敵人開小圖鑑（${enemyInfo.text.split("\n")[0]}）`);
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

      st.towers = saved.towers;
      st.enemies = saved.enemies;
      st.bullets = saved.bullets;
      st.spawnQueue = saved.spawnQueue;
      st.particles = saved.particles;
      return { afterHit, afterDot, stacks, base, buff, effective, singleSupportGain, poisonGain, poisonExpectedGain, duplicateGainA, duplicateGainB };
    });
    assert(stage4Combat.stacks > 0 && stage4Combat.afterDot < stage4Combat.afterHit,
      `毒霧塔 DoT 生效（命中後 ${stage4Combat.afterHit.toFixed(1)} → tick 後 ${stage4Combat.afterDot.toFixed(1)}，層數 ${stage4Combat.stacks}）`);
    assert(stage4Combat.buff >= 0.20 && stage4Combat.effective > stage4Combat.base,
      `聖光塔 buff 生效（base ${stage4Combat.base}，buff ${stage4Combat.buff}，effective ${stage4Combat.effective}）`);
    assert(Math.abs(stage4Combat.poisonGain - stage4Combat.poisonExpectedGain) < 0.05,
      `聖光塔 DPS 估算只計直擊、不把毒 DoT 乘 buff（${stage4Combat.poisonGain.toFixed(2)}）`);
    assert(stage4Combat.singleSupportGain > 0 && stage4Combat.duplicateGainA < 0.001 && stage4Combat.duplicateGainB < 0.001,
      "同等聖光塔重疊時，單座顯示邊際 DPS 為 0");

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
      if (card) card.click();
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
    const secondHeroDeploy = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#heroRoster .hero-card")];
      cards.forEach((card) => card.click());
      return {
        rosterCount: cards.length,
        deployedIds: window.TD.state().heroes.map((h) => h.id),
      };
    });
    assert(secondHeroDeploy.rosterCount === 2 && secondHeroDeploy.deployedIds.length === 2 && new Set(secondHeroDeploy.deployedIds).size === 2,
      `第 2 隻英雄可上場（${secondHeroDeploy.deployedIds.join(",")}）`);

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
      window.__tdGameOver(10, 1234, { kills: 100, difficulty: window.TD.getDifficulty(), soulEarned: runSoulEarned, heroGrowth });
      const after = JSON.parse(localStorage.getItem("td_meta_v1"));
      const expectedCrystal = beforeCrystal
        + window.ACHIEVEMENTS.wave10.reward
        + window.ACHIEVEMENTS.wave10First.reward
        + window.ACHIEVEMENTS.kills100.reward;
      const firstDeathCta = document.getElementById("deathCtaBtn").textContent;
      const firstMetaText = document.getElementById("metaResult").innerText;
      window.TD.setMap("plains");
      window.TD.newGame();
      window.__tdGameOver(6, 777, { kills: 12, difficulty: window.TD.getDifficulty(), soulEarned: 0, heroGrowth: [] });
      const afterBoth = JSON.parse(localStorage.getItem("td_meta_v1"));
      const canyonBoard = (afterBoth.board.normal && afterBoth.board.normal.canyon) || [];
      const plainsBoard = (afterBoth.board.normal && afterBoth.board.normal.plains) || [];
      return {
        beforeCrystal,
        runSoulEarned,
        crystal: afterBoth.soulCrystal,
        expectedCrystal,
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
      };
    });
    assert(stage3Result.canyonLen === 1 && stage3Result.canyonWave === 10 && stage3Result.canyonScore === 1234 && stage3Result.canyonKills === 100 && stage3Result.canyonMap === "canyon",
      `峽谷榜寫入本場紀錄（${stage3Result.canyonWave} 波 / ${stage3Result.canyonScore} 分 / ${stage3Result.canyonKills} 殺 / ${stage3Result.canyonMap}）`);
    assert(stage3Result.plainsLen === 1 && stage3Result.plainsWave === 6 && stage3Result.plainsScore === 777 && stage3Result.plainsMap === "plains",
      `平原榜獨立寫入且不混入峽谷榜（${stage3Result.plainsWave} 波 / ${stage3Result.plainsScore} 分 / ${stage3Result.plainsMap}）`);
    assert(stage3Result.wave10 && stage3Result.wave10First && stage3Result.kills100 && stage3Result.metaText.includes("解鎖") && stage3Result.metaText.includes("本場第 1 名") && stage3Result.metaText.includes(`+${stage3Result.runSoulEarned}`) && stage3Result.metaText.includes("本局英雄成長") && stage3Result.metaText.includes("XP"),
      "結算畫面顯示本場名次、新解鎖成就、本局魂晶與英雄成長");
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
