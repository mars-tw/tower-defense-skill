/* td R66 control reachability guard, extended by R71 modal/floating-layer exclusivity. */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = process.env.TD_EVIDENCE_DIR
  ? path.resolve(ROOT, process.env.TD_EVIDENCE_DIR)
  : path.join(ROOT, "docs", "evidence", "R71_menu");
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
const R71_VIEWPORTS = [
  { w: 1366, h: 600, name: "desktop-1366x600" },
  { w: 390, h: 844, name: "mobile-390x844", mobile: true },
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

function auditR71LayerInPage(layerId) {
  const modalIds = ["tutorial", "diffOverlay", "mapOverlay", "mapLoadingOverlay", "settingsOverlay"];
  const shell = document.getElementById("appShell");
  const layer = document.getElementById(layerId);
  const background = [
    document.getElementById("startBtn"), document.getElementById("speed1"),
    ...document.querySelectorAll("#towerList .tower-btn"),
  ].filter(Boolean).map((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      id: el.id || el.dataset.type,
      selfHit: hit === el || el.contains(hit),
      hit: hit ? (hit.id || hit.className || hit.tagName) : "none",
    };
  });
  const color = layer ? getComputedStyle(layer).backgroundColor : "";
  const rgba = color.match(/[\d.]+/g) || [];
  return {
    layerId,
    shown: modalIds.filter((id) => document.getElementById(id).classList.contains("show")),
    shellInert: !!shell && shell.inert,
    shellHidden: !!shell && shell.getAttribute("aria-hidden") === "true",
    background,
    backgroundColor: color,
    opaque: rgba.length < 4 || Number(rgba[3]) === 1,
  };
}

function auditAdvisorLayerInPage() {
  function rectFor(el) {
    const rect = el.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
  }
  function overlap(a, b) {
    return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
      Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  }
  const drawerEl = document.querySelector(".intel-drawer > .drawer-body");
  const advisorEl = document.querySelector(".advisor-row");
  const dockEl = document.getElementById("sceneControls");
  const drawer = rectFor(drawerEl), advisorRaw = rectFor(advisorEl), dock = rectFor(dockEl);
  // R75：drawer-body 是 overflow-y:auto 裁切容器；advisor-row 排版盒可能超出可視框，
  // 但被裁切的部分不可能攔截點擊——對 dock 的干擾量測取「與 drawer 可視框的交集」。
  const advisor = {
    left: Math.max(advisorRaw.left, drawer.left),
    top: Math.max(advisorRaw.top, drawer.top),
    right: Math.min(advisorRaw.right, drawer.right),
    bottom: Math.min(advisorRaw.bottom, drawer.bottom),
  };
  advisor.width = Math.max(0, advisor.right - advisor.left);
  advisor.height = Math.max(0, advisor.bottom - advisor.top);
  const background = [
    document.getElementById("startBtn"), document.getElementById("speed1"),
    ...document.querySelectorAll("#towerList .tower-btn"),
  ].map((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { id: el.id || el.dataset.type, selfHit: hit === el || el.contains(hit), hit: hit ? (hit.id || hit.className || hit.tagName) : "none" };
  });
  const advisorButtons = [...advisorEl.querySelectorAll("button")].map((el) => {
    const rect = el.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { label: el.textContent.trim(), hit: hit === el || el.contains(hit) };
  });
  return {
    drawer, advisor, advisorRaw, dock,
    drawerDockOverlap: overlap(drawer, dock),
    advisorDockOverlap: overlap(advisor, dock),
    mobileModal: document.body.classList.contains("r71-advisor-modal"),
    backdropVisible: getComputedStyle(document.getElementById("advisorBackdrop")).display !== "none",
    battlefieldInert: document.getElementById("battlefieldStage").inert,
    background,
    advisorButtons,
  };
}

const R76_ENEMY_CHIPS = [
  { id: "slime", name: "史萊姆" },
  { id: "goblin", name: "哥布林" },
  { id: "emberbat", name: "焰蝠" },
];

async function auditR76EnemyChipTaps(page, viewportLabel) {
  await page.evaluate(() => {
    window.TD.newGame({ runSeed: 4, affixSeed: 777 });
    const state = window.TD.state();
    state.wave = 0;
    state.betweenWaves = true;
    state.running = false;
    state.over = false;
    state.waveSeeds = {};
    window.__tdUI();
    document.querySelector(".intel-drawer").open = true;
  });
  await page.waitForTimeout(150);
  await page.waitForFunction((ids) => ids.every((id) =>
    document.querySelector(`#nextWaveCard .enemy-chip-btn[data-enemy="${id}"]`)),
  R76_ENEMY_CHIPS.map((item) => item.id));

  const results = [];
  for (const enemy of R76_ENEMY_CHIPS) {
    await page.evaluate(() => {
      const info = document.getElementById("enemyInfo");
      info.classList.add("hidden");
      info.innerHTML = "";
      document.querySelectorAll(".enemy-chip-btn").forEach((btn) => btn.classList.remove("active"));
    });
    const button = page.locator(`#nextWaveCard .enemy-chip-btn[data-enemy="${enemy.id}"]`);
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (!box) {
      results.push({ id: enemy.id, missing: true });
      continue;
    }
    const rowInert = await button.evaluate((el) => !!el.closest(".enemy-chip-row").inert);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(100);
    const detail = await page.evaluate((id) => {
      const buttonEl = document.querySelector(`#nextWaveCard .enemy-chip-btn[data-enemy="${id}"]`);
      const info = document.getElementById("enemyInfo");
      return {
        active: !!buttonEl && buttonEl.classList.contains("active"),
        shown: !!info && !info.classList.contains("hidden"),
        text: info ? info.textContent.replace(/\s+/g, " ").trim() : "",
      };
    }, enemy.id);
    results.push({ id: enemy.id, name: enemy.name, rowInert, ...detail });
  }
  await page.screenshot({ path: path.join(EVIDENCE, `${viewportLabel}-r76-enemy-detail.png`) });
  assert(results.length === 3 && results.every((item) => !item.missing && !item.rowInert && item.active && item.shown &&
    item.text.includes(item.name) && item.text.includes("血量") && item.text.includes("元素") &&
    item.text.includes("特性") && item.text.includes("反制")),
  `${viewportLabel} real touchscreen taps open all three enemy details (${results.map((item) => `${item.id}:${item.shown}/${item.active}/inert=${item.rowInert}`).join(", ")})`);
  return results;
}

async function run() {
  let chromium;
  try { ({ chromium } = require("playwright")); }
  catch (error) { console.error("Missing devDependency: playwright"); process.exit(2); }

  const server = await startServer();
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}/index.html`;
  const browser = await chromium.launch();
  const r71Measurements = [];
  try {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    for (const vp of R71_VIEWPORTS) {
      console.log(`\n== R71 modal exclusivity ${vp.w}x${vp.h} ==`);
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h },
        hasTouch: !!vp.mobile,
        isMobile: !!vp.mobile,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.clear());
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 60000 });
      await page.waitForTimeout(250);

      const tutorial = await page.evaluate(auditR71LayerInPage, "tutorial");
      assert(tutorial.shown.length === 1 && tutorial.shown[0] === "tutorial" && tutorial.shellInert && tutorial.shellHidden,
        `${vp.w}x${vp.h} tutorial is the sole modal and background shell is inert`);
      assert(tutorial.background.every((item) => !item.selfHit),
        `${vp.w}x${vp.h} tutorial blocks background HUD/dock elementFromPoint self hits`);
      assert(tutorial.opaque, `${vp.w}x${vp.h} tutorial backdrop is visually opaque (${tutorial.backgroundColor})`);
      await page.screenshot({ path: path.join(EVIDENCE, `${vp.name}-tutorial.png`) });

      await page.locator("#tutorialAdvanced").click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(100);
      const difficulty = await page.evaluate(auditR71LayerInPage, "diffOverlay");
      assert(difficulty.shown.length === 1 && difficulty.shown[0] === "diffOverlay" && difficulty.shellInert &&
        difficulty.background.every((item) => !item.selfHit), `${vp.w}x${vp.h} difficulty modal is exclusive and blocks background self hits`);

      await page.locator(".diff-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(100);
      const map = await page.evaluate(auditR71LayerInPage, "mapOverlay");
      assert(map.shown.length === 1 && map.shown[0] === "mapOverlay" && map.shellInert &&
        map.background.every((item) => !item.selfHit), `${vp.w}x${vp.h} map modal is exclusive and blocks background self hits`);

      await page.locator(".map-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForFunction(() => document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 5000 });
      await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 5000 });
      await page.locator("#settingsBtn").click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(100);
      const settings = await page.evaluate(auditR71LayerInPage, "settingsOverlay");
      assert(settings.shown.length === 1 && settings.shown[0] === "settingsOverlay" && settings.shellInert &&
        settings.background.every((item) => !item.selfHit), `${vp.w}x${vp.h} settings modal is exclusive and blocks background self hits`);
      await page.locator("#settingsClose").click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(100);

      let advisor;
      if (vp.mobile) {
        await page.locator("#intelDrawerToggle").click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(150);
        advisor = await page.evaluate(auditAdvisorLayerInPage);
        assert(advisor.mobileModal && advisor.backdropVisible && advisor.battlefieldInert &&
          advisor.background.every((item) => !item.selfHit), `${vp.w}x${vp.h} advisor floating layer blocks background HUD/dock self hits`);
        assert(advisor.drawerDockOverlap <= 1 && advisor.advisorDockOverlap <= 1,
          `${vp.w}x${vp.h} advisor panel reserves dock click area (drawer ${advisor.drawerDockOverlap.toFixed(1)}px² / advisor ${advisor.advisorDockOverlap.toFixed(1)}px²)`);
        assert(advisor.advisorButtons.length > 0 && advisor.advisorButtons.every((item) => item.hit),
          `${vp.w}x${vp.h} advisor controls remain hit-test reachable`);
        advisor.enemyChipTaps = await auditR76EnemyChipTaps(page, `${vp.w}x${vp.h}`);
        await page.screenshot({ path: path.join(EVIDENCE, `${vp.name}-advisor.png`) });

        // R72.1：手機抽屜必須有可見可點的關閉鈕（老闆回報：英雄抽屜蓋住畫面找不到關閉）
        // 先用 intel 抽屜自己的關閉鈕收合（同時驗證該鈕在 backdrop 之上可點）
        await page.locator(".intel-drawer .drawer-close-btn").click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(150);
        const intelClosed = await page.evaluate(() => !document.querySelector(".intel-drawer").hasAttribute("open"));
        assert(intelClosed, `${vp.w}x${vp.h} intel drawer closes via its close button (above backdrop)`);
        await page.locator("#heroDrawerToggle").click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(150);
        const heroClose = await page.evaluate(() => {
          const drawer = document.querySelector(".hero-drawer");
          const btn = drawer ? drawer.querySelector(".drawer-close-btn") : null;
          if (!drawer || !btn) return { ok: false, why: "missing" };
          const r = btn.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { ok: true, open: drawer.hasAttribute("open"), w: r.width, h: r.height,
            inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0,
            hit: btn === at || btn.contains(at) };
        });
        assert(heroClose.ok && heroClose.open && heroClose.inView && heroClose.hit &&
          heroClose.w >= 44 && heroClose.h >= 44,
          `${vp.w}x${vp.h} hero drawer close button visible/hittable >=44px (w=${Math.round(heroClose.w || 0)} h=${Math.round(heroClose.h || 0)})`);
        await page.locator(".hero-drawer .drawer-close-btn").click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(120);
        const heroClosed = await page.evaluate(() => !document.querySelector(".hero-drawer").hasAttribute("open"));
        assert(heroClosed, `${vp.w}x${vp.h} hero drawer closes via close button`);
      } else {
        advisor = await page.evaluate(auditAdvisorLayerInPage);
        assert(advisor.drawerDockOverlap <= 1 && advisor.advisorDockOverlap <= 1,
          `${vp.w}x${vp.h} desktop advisor stays outside dock click area`);

        // R72.2：矮視口桌機側欄必須可內部捲動、抽英雄鈕捲入後可命中（老闆回報：矮筆電按不到）
        await page.locator("#heroDrawerToggle").click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(150);
        const sidebarReach = await page.evaluate(() => {
          const panel = document.querySelector(".wrap > .panel");
          const btn = document.getElementById("gachaBtn");
          if (!panel || !btn) return { ok: false };
          const scrollable = panel.scrollHeight <= panel.clientHeight + 1 ||
            getComputedStyle(panel).overflowY === "auto";
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { ok: true, scrollable, inView: r.top >= 0 && r.bottom <= innerHeight,
            hit: btn === at || btn.contains(at) };
        });
        assert(sidebarReach.ok && sidebarReach.scrollable && sidebarReach.inView && sidebarReach.hit,
          `${vp.w}x${vp.h} sidebar gacha button reachable via panel scroll`);
        await page.locator("#heroDrawerToggle").click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(120);
      }
      assert(errors.length === 0, `${vp.w}x${vp.h} R71 modal flow has no pageerror${errors.length ? " - " + errors.join(" | ") : ""}`);
      r71Measurements.push({ viewport: `${vp.w}x${vp.h}`, tutorial, difficulty, map, settings, advisor, errors });
      await context.close();
    }

    // ===== R75：844×390 橫向 P0 守門（menuscan：#overlay 不可捲、抽屜衝出視口頂、顧問徽章觸控黑洞）=====
    {
      const vp = { w: 844, h: 390, name: "landscape-844x390" };
      console.log(`\n== R75 landscape P0 ${vp.w}x${vp.h} ==`);
      const context = await browser.newContext({
        viewport: { width: vp.w, height: vp.h }, hasTouch: true, isMobile: true,
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("td_tutorial_seen", "1");
      });
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 60000 });
      await page.waitForTimeout(250);
      await page.locator(".diff-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(150);
      await page.locator(".map-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 8000 });
      await page.waitForTimeout(250);

      // R75.1（Grok R75-04）：抽屜幾何變數必須「開機即寫入」——首開抽屜前就要存在，
      // 不能等 resize/orientationchange 才補；缺變數時首開抽屜會用錯誤 fallback 幾何。
      const bootVars = await page.evaluate(() => ({
        safeBottom: getComputedStyle(document.documentElement).getPropertyValue("--r71-drawer-safe-bottom").trim(),
        maxHeight: getComputedStyle(document.documentElement).getPropertyValue("--r75-drawer-max-height").trim(),
        visualViewportHooked: !!window.visualViewport,
      }));
      assert(/^\d+(\.\d+)?px$/.test(bootVars.safeBottom) && /^\d+(\.\d+)?px$/.test(bootVars.maxHeight),
        `${vp.name} drawer geometry vars set at boot before first drawer open (safeBottom=${bootVars.safeBottom || "missing"} maxHeight=${bootVars.maxHeight || "missing"})`);

      // R75-2/R75-3：三抽屜逐一開啟——drawer-body 必須整體留在視口內、關閉鈕可點、顧問徽章 ≥44px。
      const drawers = [
        { toggle: "#intelDrawerToggle", selector: ".intel-drawer", label: "intel" },
        { toggle: "#heroDrawerToggle", selector: ".hero-drawer", label: "hero" },
        { toggle: "#utilityDrawerToggle", selector: ".utility-drawer", label: "utility" },
      ];
      for (const spec of drawers) {
        await page.locator(spec.toggle).click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(200);
        const audit = await page.evaluate((selector) => {
          const drawer = document.querySelector(`${selector} > .drawer-body`);
          if (!drawer) return { ok: false };
          const rect = drawer.getBoundingClientRect();
          const close = drawer.querySelector(".drawer-close-btn");
          const closeRect = close ? close.getBoundingClientRect() : null;
          const closeHit = closeRect
            ? (() => {
              const at = document.elementFromPoint(closeRect.left + closeRect.width / 2, closeRect.top + closeRect.height / 2);
              return close === at || close.contains(at);
            })()
            : false;
          const advisorTools = [...drawer.querySelectorAll(".advisor-tools button")].map((btn) => {
            const r = btn.getBoundingClientRect();
            const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { label: btn.textContent.trim(), w: r.width, h: r.height, hit: btn === at || btn.contains(at) };
          });
          return {
            ok: true,
            top: rect.top, bottom: rect.bottom, height: rect.height,
            inViewport: rect.top >= 0 && rect.bottom <= innerHeight + 1,
            close: closeRect ? { w: closeRect.width, h: closeRect.height, inView: closeRect.top >= 0 && closeRect.bottom <= innerHeight, hit: closeHit } : null,
            advisorTools,
          };
        }, spec.selector);
        assert(audit.ok && audit.inViewport,
          `${vp.name} ${spec.label} drawer body stays inside viewport (top=${Math.round(audit.top || 0)} bottom=${Math.round(audit.bottom || 0)} vs h=${vp.h})`);
        assert(audit.close && audit.close.inView && audit.close.hit && audit.close.w >= 44 && audit.close.h >= 44,
          `${vp.name} ${spec.label} drawer close button visible/hittable >=44px`);
        if (spec.label === "intel") {
          assert(audit.advisorTools.length >= 2 && audit.advisorTools.every((item) => item.w >= 44 && item.h >= 44 && item.hit),
            `${vp.name} advisor 收合/關閉 hit area >=44px (${audit.advisorTools.map((item) => `${item.label}:${Math.round(item.w)}x${Math.round(item.h)}`).join(", ")})`);
          // R75.1（Grok R75-05）：advisor tools 不得遮蔽出波 CTA 與抽屜把手——
          // 每顆工具鈕對 startBtn/summary 的 bbox 交集必須為零，或工具鈕中心 elementFromPoint
          // 命中工具鈕本身（層疊順序正確：浮層在上是刻意設計，點擊落在正確目標）。
          const advisorOcclusion = await page.evaluate(() => {
            function overlapArea(a, b) {
              return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
                Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            }
            const targets = [document.getElementById("startBtn"), ...document.querySelectorAll(".panel-drawer summary")]
              .filter(Boolean);
            return [...document.querySelectorAll(".advisor-tools button")].map((tool) => {
              const rect = tool.getBoundingClientRect();
              const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
              return {
                label: tool.textContent.trim(),
                selfHit: at === tool || tool.contains(at),
                maxOverlap: Math.max(...targets.map((t) => overlapArea(rect, t.getBoundingClientRect())), 0),
              };
            });
          });
          assert(advisorOcclusion.length >= 2 && advisorOcclusion.every((tool) => tool.maxOverlap <= 1 || tool.selfHit),
            `${vp.name} advisor tools do not shadow wave CTA/drawer handles (${advisorOcclusion.map((t) => `${t.label}:ov=${Math.round(t.maxOverlap)}/self=${t.selfHit}`).join(", ")})`);
          await auditR76EnemyChipTaps(page, vp.name);
          await page.screenshot({ path: path.join(EVIDENCE, `${vp.name}-drawer-intel.png`) });
        }
        await page.locator(`${spec.selector} .drawer-close-btn`).click({ noWaitAfter: true, timeout: 90000 });
        await page.waitForTimeout(150);
        const closed = await page.evaluate((selector) => !document.querySelector(selector).hasAttribute("open"), spec.selector);
        assert(closed, `${vp.name} ${spec.label} drawer closes via close button`);
      }

      // R75.1（Grok R75-05 補強）：抽屜全數收合後，出波 CTA 與三個抽屜把手必須恢復可自點命中。
      const restoredTargets = await page.evaluate(() => {
        return [document.getElementById("startBtn"), ...document.querySelectorAll(".panel-drawer summary")]
          .filter(Boolean)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { id: el.id || el.textContent.trim().slice(0, 6), hit: at === el || el.contains(at) };
          });
      });
      assert(restoredTargets.length >= 4 && restoredTargets.every((item) => item.hit),
        `${vp.name} wave CTA and drawer handles hittable again after drawers closed (${restoredTargets.map((t) => `${t.id}:${t.hit}`).join(", ")})`);

      // R75-2：方向切換即重算 safe-bottom（直向=避讓貼底控制盤、橫向=貼底 8px）。
      const landscapeSafe = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--r71-drawer-safe-bottom")) || 0);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(250);
      const portraitSafe = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--r71-drawer-safe-bottom")) || 0);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(250);
      const landscapeSafe2 = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--r71-drawer-safe-bottom")) || 0);
      assert(landscapeSafe <= 24 && landscapeSafe2 <= 24 && portraitSafe >= 100,
        `${vp.name} safe-bottom re-computed per orientation (landscape=${landscapeSafe}/${landscapeSafe2}px, portrait=${portraitSafe}px)`);

      // R75-1：結算 #overlay 走真實 onGameOver 內容——橫向必須可捲、CTA 可捲達可點。
      await page.evaluate(() => {
        window.__tdGameOver(12, 3400, {
          kills: 46, soulEarned: 24, leaks: 2,
          heroGrowth: [{ id: "knight", xp: 120, level: 3, levelsGained: 1 }],
          towers: [{ type: "arrow", level: 4 }],
        });
      });
      await page.waitForTimeout(250);
      const overlayAudit = await page.evaluate(() => {
        const overlay = document.getElementById("overlay");
        const style = getComputedStyle(overlay);
        const scrollTopOnOpen = overlay.scrollTop; // R75.1（Grok R75-08）：開啟當下必須已歸零
        // R75.1（Grok R75-03）：overlay 開啟時，背景抽屜把手/出波 CTA 不得被 elementFromPoint 自點命中。
        const blockedBackground = [document.getElementById("startBtn"), ...document.querySelectorAll(".panel-drawer summary")]
          .filter(Boolean)
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const at = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
            return { id: el.id || el.textContent.trim().slice(0, 6), selfHit: at === el || el.contains(at) };
          });
        const buttons = ["deathCtaBtn", "restartBtn", "mainMenuBtn"].map((id) => {
          const btn = document.getElementById(id);
          btn.scrollIntoView({ block: "center" });
          const r = btn.getBoundingClientRect();
          const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { id, inView: r.top >= 0 && r.bottom <= innerHeight, hit: btn === at || btn.contains(at) };
        });
        overlay.scrollTop = 0;
        const title = overlay.querySelector("h2").getBoundingClientRect();
        return {
          shown: overlay.classList.contains("show"),
          overflowY: style.overflowY,
          scrollable: overlay.scrollHeight > overlay.clientHeight,
          scrollTopOnOpen,
          blockedBackground,
          titleTop: title.top,
          buttons,
        };
      });
      assert(overlayAudit.shown && overlayAudit.overflowY === "auto",
        `${vp.name} #overlay is a scroll container (overflow-y=${overlayAudit.overflowY})`);
      assert(overlayAudit.scrollTopOnOpen === 0,
        `${vp.name} #overlay opens scrolled to top (scrollTop=${overlayAudit.scrollTopOnOpen})`);
      assert(overlayAudit.blockedBackground.length >= 4 && overlayAudit.blockedBackground.every((item) => !item.selfHit),
        `${vp.name} #overlay open blocks background CTA/drawer handles (${overlayAudit.blockedBackground.map((t) => `${t.id}:${t.selfHit}`).join(", ")})`);
      assert(overlayAudit.buttons.length === 3 && overlayAudit.buttons.every((item) => item.inView && item.hit),
        `${vp.name} #overlay expected 3 CTA buttons reachable via scroll (${overlayAudit.buttons.map((item) => `${item.id}:${item.inView}/${item.hit}`).join(", ")})`);
      assert(overlayAudit.titleTop >= -1,
        `${vp.name} #overlay title not clipped above viewport when scrolled to top (top=${Math.round(overlayAudit.titleTop)})`);
      await page.screenshot({ path: path.join(EVIDENCE, `${vp.name}-overlay.png`) });
      await page.locator("#mainMenuBtn").scrollIntoViewIfNeeded();
      await page.locator("#mainMenuBtn").click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(150);
      const menuReturn = await page.evaluate(() => {
        const state = window.TD.state();
        return {
          overlayShown: document.getElementById("overlay").classList.contains("show"),
          difficultyShown: document.getElementById("diffOverlay").classList.contains("show"),
          mapShown: document.getElementById("mapOverlay").classList.contains("show"),
          difficultyCount: document.querySelectorAll(".diff-opt").length,
          shellInert: document.getElementById("appShell").inert,
          wave: state.wave,
          over: state.over,
        };
      });
      assert(!menuReturn.overlayShown && menuReturn.difficultyShown && !menuReturn.mapShown &&
        menuReturn.difficultyCount === 3 && menuReturn.shellInert && menuReturn.wave === 0 && !menuReturn.over,
      `${vp.name} defeat 回主選單 resets run and opens difficulty selection`);
      assert(errors.length === 0, `${vp.name} R75 landscape flow has no pageerror${errors.length ? " - " + errors.join(" | ") : ""}`);
      await context.close();
    }

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
      await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForFunction(() => window.TD && window.TD.state, null, { timeout: 60000 });
      await page.waitForTimeout(250);

      const diffShown = await page.evaluate(() => document.getElementById("diffOverlay").classList.contains("show"));
      assert(diffShown, `${vp.w}x${vp.h} difficulty modal opens`);
      const diff = await page.evaluate(auditModalInPage, "#diffOverlay .diff-opt");
      assert(diff.length > 0 && diff.every((item) => item.width >= 44 && item.height >= 44 && item.centerInViewport && item.hit),
        `${vp.w}x${vp.h} difficulty options are reachable`);

      await page.locator(".diff-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForTimeout(150);
      const mapShown = await page.evaluate(() => document.getElementById("mapOverlay").classList.contains("show"));
      assert(mapShown, `${vp.w}x${vp.h} map modal opens`);
      const map = await page.evaluate(auditModalInPage, "#mapOverlay .map-opt");
      assert(map.length > 0 && map.every((item) => item.width >= 44 && item.height >= 44 && item.centerInViewport && item.hit),
        `${vp.w}x${vp.h} map options are reachable`);

      await page.locator(".map-opt").first().click({ noWaitAfter: true, timeout: 90000 });
      await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 5000 });
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
  fs.writeFileSync(path.join(EVIDENCE, "modal-interlock-measurements.json"), JSON.stringify(r71Measurements, null, 2) + "\n");
  if (failed > 0) { console.error(`\nR66 control guard failed: ${failed}`); process.exit(1); }
  console.log("\nR66 control guard passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
