/* =========================================================================
 * ui.js — 塔防 UI/HUD（建塔選單、技能列、升級面板、遊戲結束）
 * 透過 window.TD 接口與 game.js 溝通；game.js 透過 window.__tdUI 等回呼通知 UI 更新。
 * ========================================================================= */

(() => {
  "use strict";
  const { TOWERS, SKILLS, ENEMIES, BEGINNER_MISSIONS, MAP_AFFIXES } = TD.config;
  const LORE = window.TD_LORE || {};
  const $ = (id) => document.getElementById(id);
  const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  const RULES = window.TDRules;
  const R72_MAP_VISUALS = {
    plains: {
      accent: "#2e7d4f",
      banner: {
        high: "assets/maps/r72/plains-banner-high.webp?v=63b03393",
        med: "assets/maps/r72/plains-banner-med.webp?v=b4db6829",
        low: "assets/maps/r72/plains-banner-low.webp?v=d040c3b6",
      },
      loading: {
        high: "assets/maps/r72/plains-loading-high.webp?v=7a8d1753",
        med: "assets/maps/r72/plains-loading-med.webp?v=32307665",
        low: "assets/maps/r72/plains-loading-low.webp?v=822eb164",
      },
    },
    canyon: {
      accent: "#a65a32",
      banner: {
        high: "assets/maps/r72/canyon-banner-high.webp?v=14cbcf2e",
        med: "assets/maps/r72/canyon-banner-med.webp?v=961ad962",
        low: "assets/maps/r72/canyon-banner-low.webp?v=41fcb341",
      },
      loading: {
        high: "assets/maps/r72/canyon-loading-high.webp?v=acb28553",
        med: "assets/maps/r72/canyon-loading-med.webp?v=3781e3a5",
        low: "assets/maps/r72/canyon-loading-low.webp?v=dcf8ce5b",
      },
    },
    lava: {
      accent: "#c6422c",
      banner: {
        high: "assets/maps/r72/lava-banner-high.webp?v=90e4ef27",
        med: "assets/maps/r72/lava-banner-med.webp?v=001ec422",
        low: "assets/maps/r72/lava-banner-low.webp?v=5f51a4a5",
      },
      loading: {
        high: "assets/maps/r72/lava-loading-high.webp?v=5239fc3e",
        med: "assets/maps/r72/lava-loading-med.webp?v=19175c9e",
        low: "assets/maps/r72/lava-loading-low.webp?v=25918535",
      },
    },
  };
  let selectedBoardDiff = TD.getDifficulty().id;
  let selectedBoardMap = (TD.getMap && TD.getMap().id) || "plains";
  let progressWasPaused = false;
  let heroDetailWasPaused = false;
  let codexWasPaused = false;
  let codexTab = "world";
  let settingsWasPaused = false;
  let tutorialWasPaused = false;
  let tutorialFirstRun = false;
  let tutorialStepIndex = 0;
  let advisorCollapsed = false;
  let advisorHidden = false;
  let advisorMode = "control";
  let warningSerial = 0;
  let r72SelectorSerial = 0;
  let r72LoadingSerial = 0;
  let recoveryNoticeShown = false;
  const TOWER_HOTKEYS = { arrow: "1", cannon: "2", frost: "3", tesla: "4", poison: "5", support: "6", sniper: "7", arcane: "8", beacon: "9", mortar: "0" };
  const TOWER_SHORT_NAMES = { arrow: "箭", cannon: "砲", frost: "冰", tesla: "電", poison: "毒", support: "輔", sniper: "狙", arcane: "奧", beacon: "標", mortar: "臼" };
  const SKILL_HOTKEYS = { meteor: "Q", freeze: "W", thunder: "E", judgment: "R", sealarray: "A" };
  const TOWER_BY_KEY = Object.fromEntries(Object.entries(TOWER_HOTKEYS).map(([id, key]) => [key, id]));
  const SKILL_BY_KEY = Object.fromEntries(Object.entries(SKILL_HOTKEYS).map(([id, key]) => [key.toLowerCase(), id]));
  const TEXT_SIZE_KEY = "td_text_size";
  const CODEX_SEEN_KEY = "td_codex_seen_v1";
  const TEXT_SIZE_LABELS = { small: "小", medium: "中", large: "大" };
  const notifiedCodexKeys = new Set();
  let textSize = loadTextSize();
  let drainedIntroCount = 0;
  const hudLast = { gold: null, goddessHp: null };
  const TUTORIAL_STEPS = [
    {
      title: "建塔與開波",
      body: "先選下方建塔列的攻擊塔，再點路徑旁的合法格。手機會先顯示幽靈預覽，再點同一格確認。",
      tip: "第一波前至少要有一座塔；顧問建議會避開路徑格並指向可建造位置。",
    },
    {
      title: "元素克制",
      body: "火克冰、冰克雷、雷克火。下一波卡片會顯示主元素與敵人資訊，缺克制塔時會出現警告。",
      tip: "冰系敵人優先補火塔，雷系或高速敵人優先補寒冰塔，火系敵人交給電磁塔。",
    },
    {
      title: "升級、支援與女神",
      body: "點已建造的塔可升級或賣出；聖光塔、引魂燈塔是支援塔，主力成形後再放。點終點女神可升級生命與反擊。",
      tip: "女神漏怪會扣血，升級會回滿生命；不要把所有金錢都花在支援塔上。",
    },
    {
      title: "英雄與魂晶",
      body: "抽英雄消耗跨局魂晶，英雄上場後會自動作戰，也能從英雄列表指定守點。",
      tip: "戰敗仍會保留魂晶與英雄進度；第二位英雄通常比單塔升級更能穩住中期。",
    },
    {
      title: "詞綴與地圖",
      body: "每局有地圖詞綴，會改變射程、敵血、金錢或塔傷。難度與地圖會影響起始資源、Boss 頻率與排行榜紀錄。",
      tip: "濃霧要靠近路徑建塔；餘震要分散主力；豐收可提前升級主塔。",
    },
    {
      title: "主動技能",
      body: "選技能後點戰場施放；只有命中有效目標才消耗冷卻與統計。瞄準中可按 Esc 或下方 × 取消。",
      tip: "隕石適合砸密集點；冰封和雷暴要等敵人上場後再確認，空場不會進冷卻。",
    },
  ];

  function updateHudNumber(id, value) {
    const el = $(id);
    if (!el) return;
    const numeric = Number(value) || 0;
    const previous = hudLast[id];
    el.textContent = value;
    if (previous != null && numeric !== previous && !(TD.getJuiceSettings && TD.getJuiceSettings().reducedEffects)) {
      el.classList.remove("hud-gain", "hud-loss");
      void el.offsetWidth;
      el.classList.add(numeric > previous ? "hud-gain" : "hud-loss");
    }
    hudLast[id] = numeric;
  }

  function normalizeTextSize(value) {
    return hasOwn(TEXT_SIZE_LABELS, value) ? value : "medium";
  }

  function loadTextSize() {
    try { return normalizeTextSize(localStorage.getItem(TEXT_SIZE_KEY)); }
    catch { return "medium"; }
  }

  function applyTextSize(size) {
    const next = normalizeTextSize(size);
    document.body.classList.remove("text-size-small", "text-size-medium", "text-size-large");
    document.body.classList.add(`text-size-${next}`);
  }

  function setTextSize(size) {
    textSize = normalizeTextSize(size);
    try { localStorage.setItem(TEXT_SIZE_KEY, textSize); } catch {}
    applyTextSize(textSize);
    renderTextSizeSettings();
  }

  function focusSoon(el) {
    if (!el || typeof el.focus !== "function") return;
    setTimeout(() => {
      try { el.focus({ preventScroll: true }); }
      catch { el.focus(); }
    }, 0);
  }

  applyTextSize(textSize);

  // 元素圖示與克制提示（D3 元素克制可見化）
  const ELEM_ICON = { physical: "⚔️", fire: "🔥", ice: "❄️", thunder: "⚡" };
  const ELEM_LABEL = { physical: "物理", fire: "火", ice: "冰", thunder: "雷" };
  const COUNTER_HINT = { fire: "克冰", ice: "克雷", thunder: "克火" };
  function elemChip(el) {
    const hint = COUNTER_HINT[el] ? `·${COUNTER_HINT[el]}` : "";
    return `<span class="elem-chip elem-${el}">${ELEM_ICON[el]}${ELEM_LABEL[el]}${hint}</span>`;
  }
  function enemyTrait(e) {
    if (!e) return "一般敵人";
    const parts = [];
    if (e.boss) parts.push("高血 Boss，漏過會重創女神");
    if (e.ability) parts.push(`${e.ability.label || "特殊能力"}：${e.ability.desc || ""}`);
    if (e.shield) parts.push(`護盾 ${e.shield}，需先破盾`);
    if (e.healRadius) parts.push(`每 ${e.healInterval} 秒治療附近敵人`);
    if (e.speed >= 85) parts.push("高速突進");
    if (e.hp >= 100 && !e.boss) parts.push("高血慢速");
    if (!parts.length) parts.push("標準路徑敵人");
    return parts.join("；");
  }
  function enemySummary(id) {
    const e = ENEMIES[id];
    if (!e) return "";
    return `${e.name}：${ELEM_LABEL[e.element]}系，${enemyTrait(e)}`;
  }

  // ===== R64 畫面下緣建塔 dock =====
  function towerMetaText(t) {
    if (t.slowAura) return `範圍 ${t.range} · 暴露 · 減速 ${Math.round(t.slowAura * 100)}% · 不補盲區`;
    if (t.support) return `範圍 ${t.range} · 增傷 +${Math.round(t.buff * 100)}%`;
    const extra = t.poisonDps ? ` · 毒 ${t.poisonDps}/秒` : "";
    const control = t.id === "frost" ? " · 控場減速" : "";
    const minRange = t.minRange ? ` · 盲區 ${t.minRange}` : "";
    return `傷 ${t.damage} · 程 ${t.range}${minRange} · 速 ${t.fireRate}/秒${extra}${control}`;
  }
  function assetIcon(group, id, klass, source) {
    return `<span class="${klass} asset-ico" aria-hidden="true"><img src="${source || `assets/${group}/${id}.png`}" alt="" loading="lazy" draggable="false"></span>`;
  }
  function towerTierIndex(level) {
    const value = Math.max(1, Math.floor(Number(level) || 1));
    return value >= 7 ? 2 : value >= 4 ? 1 : 0;
  }
  function towerArt(tower, level, klass) {
    const sprites = tower && tower.sprites;
    const source = sprites && sprites[towerTierIndex(level)];
    return assetIcon("towers", tower.id, klass, source);
  }
  const towerList = $("towerList");
  Object.values(TOWERS).forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "tower-btn"; btn.dataset.type = t.id;
    if (TOWER_HOTKEYS[t.id]) btn.dataset.hotkey = TOWER_HOTKEYS[t.id];
    const stats = towerMetaText(t);
    const shortcut = TOWER_HOTKEYS[t.id] ? `快捷鍵 ${TOWER_HOTKEYS[t.id]}。` : "";
    btn.title = shortcut + (t.desc || t.name);
    btn.setAttribute("aria-label", `${t.name}：${shortcut}${t.desc || stats}`);
    btn.style.setProperty("--tower-color", t.color || "#4ade80");
    btn.innerHTML = `${towerArt(t, 1, "ico")}<span class="tshort">${TOWER_SHORT_NAMES[t.id] || t.name.slice(0, 1)}</span><span class="cost">${t.cost}</span>`;
    btn.onclick = () => {
      const st = TD.state();
      if (st.selectedTowerType === t.id) { TD.cancelBuild(); }
      else { TD.selectTower(t.id); }
      refreshUI();
    };
    towerList.appendChild(btn);
  });

  // ===== R64 常駐技能控制盤（圓形圖示＋冷卻環） =====
  const skillList = $("skillList");
  Object.values(SKILLS).forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "skill-btn"; btn.dataset.skill = s.id;
    if (SKILL_HOTKEYS[s.id]) btn.dataset.hotkey = SKILL_HOTKEYS[s.id];
    const shortcut = SKILL_HOTKEYS[s.id] ? `快捷鍵 ${SKILL_HOTKEYS[s.id]}。` : "";
    btn.title = shortcut + s.desc;
    btn.setAttribute("aria-label", `${s.name}：${shortcut}${s.desc}`);
    btn.style.setProperty("--skill-color", s.color || "#4ade80");
    btn.innerHTML = `${assetIcon("skills", s.id, "ico")}<span class="cdtext" data-cd="${s.id}"></span>`;
    btn.onclick = () => { activateSkill(s.id); };
    skillList.appendChild(btn);
  });

  // ===== 英雄抽卡與名冊 =====
  const HERO_SAVE = "td_heroes_owned_v1";
  let ownedHeroes = loadOwned();            // 擁有的英雄 id 集合
  let deployedThisGame = new Set();          // 本局已上場的英雄

  function loadOwned() {
    try { return new Set(JSON.parse(localStorage.getItem(HERO_SAVE)) || []); } catch { return new Set(); }
  }
  function saveOwned() {
    try { localStorage.setItem(HERO_SAVE, JSON.stringify([...ownedHeroes])); } catch {}
  }

  function isShown(id) {
    const el = $(id);
    return !!el && el.classList.contains("show");
  }

  const R71_MODAL_IDS = ["tutorial", "diffOverlay", "mapOverlay", "mapLoadingOverlay", "settingsOverlay"];

  function setR71Inert(el, enabled) {
    if (!el) return;
    if (enabled) {
      el.inert = true;
      el.dataset.r71Inert = "1";
    } else if (el.dataset.r71Inert === "1") {
      el.inert = false;
      delete el.dataset.r71Inert;
    }
  }

  function syncAdvisorGeometry() {
    const dock = $("sceneControls");
    const doc = document.documentElement;
    if (!dock || !window.matchMedia("(max-width: 900px)").matches) {
      doc.style.removeProperty("--r71-drawer-safe-bottom");
      doc.style.removeProperty("--r75-drawer-max-height");
      return;
    }
    // R75：橫向矮視口時控制盤移到戰場右側（頂緣貼近視口頂），沿用直向公式
    // innerHeight - dockRect.top 會得到巨大 safe-bottom，把固定抽屜整個頂出畫面頂（menuscan P0）。
    // 只有控制盤真的是「貼底列」（頂緣在視口下半且底緣接近視口底）才需要避讓；否則抽屜貼底 8px。
    const viewH = window.innerHeight;
    const dockRect = dock.getBoundingClientRect();
    const dockIsBottomBar = dockRect.top > viewH * 0.5 && dockRect.bottom > viewH - 120;
    const safeBottom = dockIsBottomBar ? Math.max(8, viewH - dockRect.top + 8) : 8;
    doc.style.setProperty("--r71-drawer-safe-bottom", `${Math.ceil(safeBottom)}px`);
    // 依實際視口重算抽屜可用高度（頂緣至少留 8px 在畫面內），resize/orientationchange 都會重跑。
    const maxHeight = Math.max(120, viewH - safeBottom - 8);
    doc.style.setProperty("--r75-drawer-max-height", `${Math.floor(maxHeight)}px`);
  }

  function syncR71ModalState() {
    const blocking = isBlockingOverlayOpen();
    document.body.classList.toggle("r71-modal-open", blocking);
    const shell = $("appShell");
    if (shell) {
      shell.inert = blocking;
      if (blocking) shell.setAttribute("aria-hidden", "true");
      else shell.removeAttribute("aria-hidden");
    }

    const intelDrawer = document.querySelector(".intel-drawer");
    const advisorModal = !blocking && window.matchMedia("(max-width: 900px)").matches &&
      !!intelDrawer && intelDrawer.open && !!intelDrawer.querySelector(".advisor-row");
    document.body.classList.toggle("r71-advisor-modal", advisorModal);
    [
      $("hud"), $("battlefieldStage"), document.querySelector("h1"), $("log"),
      document.querySelector(".hero-drawer"), document.querySelector(".utility-drawer"),
      document.querySelector(".series-footer"), intelDrawer && intelDrawer.querySelector("summary"),
      // R76：敵人徽章與其詳情是情報抽屜內的同層必要操作；顧問浮層開啟時仍須可點／可讀。
      // 只鎖住詞綴、塔種建議等非互動背景，不再讓祖先 inert 吃掉徽章 tap。
      $("affixCard"),
      document.querySelector("#nextWaveCard .tower-rec-row"),
    ].forEach((el) => setR71Inert(el, advisorModal));
  }

  function showExclusiveR71Modal(id) {
    R71_MODAL_IDS.forEach((otherId) => {
      if (otherId !== id) $(otherId).classList.remove("show");
    });
    $(id).classList.add("show");
    syncR71ModalState();
  }

  function hideR71Modal(id) {
    $(id).classList.remove("show");
    syncR71ModalState();
  }

  function isBlockingOverlayOpen() {
    return ["gachaOverlay", "progressOverlay", "heroDetailOverlay", "codexOverlay", "settingsOverlay", "overlay", "tutorial", "diffOverlay", "mapOverlay", "mapLoadingOverlay"].some(isShown);
  }

  const r71OverlayObserver = new MutationObserver(() => syncR71ModalState());
  ["gachaOverlay", "progressOverlay", "heroDetailOverlay", "codexOverlay", "settingsOverlay", "overlay", "tutorial", "diffOverlay", "mapOverlay", "mapLoadingOverlay"]
    .map($).filter(Boolean).forEach((overlay) => r71OverlayObserver.observe(overlay, { attributes: true, attributeFilter: ["class"] }));

  function r72Mark(name) {
    if (!window.performance || typeof performance.mark !== "function") return;
    try { performance.clearMarks(name); performance.mark(name); } catch {}
  }

  function r72Measure(name, start, end) {
    if (!window.performance || typeof performance.measure !== "function") return;
    try { performance.clearMeasures(name); performance.measure(name, start, end); } catch {}
  }

  function r72QualityTier() {
    const perf = TD.getPerformanceStatus ? TD.getPerformanceStatus() : null;
    if (perf && perf.quality === "low") return "low";
    return window.matchMedia("(max-width: 900px)").matches ? "med" : "high";
  }

  function r72AssetFor(mapId, kind, quality) {
    const visual = R72_MAP_VISUALS[mapId] || R72_MAP_VISUALS.plains;
    const group = visual[kind] || visual.banner;
    return group[quality] || group.med || group.high;
  }

  function r72ImageReady(image) {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve(image);
    return new Promise((resolve, reject) => {
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", () => reject(new Error(`R72 image failed: ${image.currentSrc || image.src}`)), { once: true });
    });
  }

  function watchR72SelectorImages(box, serial) {
    const images = [...box.querySelectorAll(".map-visual img")];
    Promise.all(images.map(r72ImageReady)).then(() => {
      if (serial !== r72SelectorSerial) return;
      box.dataset.r72VisualReady = "true";
      r72Mark("r72-map-visual-ready");
      r72Measure("r72-map-visual-duration", "r72-map-select-open", "r72-map-visual-ready");
    }).catch((error) => {
      box.dataset.r72VisualReady = "false";
      box.dataset.r72VisualError = error.message;
    });
  }

  function isTextEntryTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function activateSkill(id) {
    const st = TD.state();
    const cd = (st.skillCooldowns && st.skillCooldowns[id]) || 0;
    if (cd > 0) {
      const sk = SKILLS[id];
      pushLog(`${sk ? sk.name : "技能"}冷卻中（${Math.ceil(cd)} 秒）`, "bad");
      refreshUI();
      return false;
    }
    TD.selectSkill(id);
    refreshUI();
    return true;
  }

  // ===== R64 場景內選單定位 =====
  function positionSceneElement(el, worldX, worldY, kind) {
    const stage = $("battlefieldStage");
    const canvas = $("game");
    if (!el || !stage || !canvas || el.classList.contains("hidden")) return;
    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const rawX = canvasRect.left - stageRect.left + worldX * canvasRect.width / canvas.width;
    const rawY = canvasRect.top - stageRect.top + worldY * canvasRect.height / canvas.height;
    if (kind === "wheel") {
      const halfW = Math.min(124, stageRect.width / 2);
      const halfH = Math.min(124, stageRect.height / 2);
      const minX = halfW + 2, maxX = Math.max(minX, stageRect.width - halfW - 2);
      const minY = halfH + 2, maxY = Math.max(minY, stageRect.height - halfH - 2);
      el.style.left = `${Math.max(minX, Math.min(maxX, rawX))}px`;
      el.style.top = `${Math.max(minY, Math.min(maxY, rawY))}px`;
      return;
    }
    const width = Math.max(180, el.offsetWidth || 244);
    const half = Math.min(width / 2, stageRect.width / 2 - 4);
    el.style.left = `${Math.max(half + 4, Math.min(stageRect.width - half - 4, rawX))}px`;
    el.style.top = `${Math.max(4, Math.min(stageRect.height - 4, rawY))}px`;
    const needsBelow = rawY < (el.offsetHeight || 130) + 24;
    el.style.transform = needsBelow ? "translate(-50%, 16px)" : "translate(-50%, calc(-100% - 16px))";
  }

  function closeBuildWheel() {
    if (TD.closeSceneMenus) TD.closeSceneMenus();
    refreshUI();
  }

  function renderBuildWheel(st) {
    const wheel = $("buildWheel");
    const target = st.buildMenuTarget;
    if (!wheel || !target || isBlockingOverlayOpen()) {
      if (wheel) wheel.classList.add("hidden");
      return;
    }
    const ids = TD.buildOptionsAt ? TD.buildOptionsAt(target.x, target.y) : [];
    if (!ids.length) {
      wheel.classList.add("hidden");
      return;
    }
    wheel.innerHTML = "";
    const close = document.createElement("button");
    close.className = "wheel-close";
    close.type = "button";
    close.setAttribute("aria-label", "關閉建塔輪盤");
    close.innerHTML = "✕<br>建塔";
    close.onclick = (ev) => { ev.stopPropagation(); closeBuildWheel(); };
    wheel.appendChild(close);
    const radius = ids.length >= 8 ? 102 : ids.length >= 5 ? 92 : 78;
    ids.forEach((id, index) => {
      const t = TOWERS[id];
      if (!t) return;
      const angle = -Math.PI / 2 + index * Math.PI * 2 / ids.length;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "wheel-tower-btn";
      btn.dataset.type = t.id;
      btn.style.left = `${124 + Math.cos(angle) * radius}px`;
      btn.style.top = `${124 + Math.sin(angle) * radius}px`;
      btn.style.setProperty("--wheel-color", t.color || "#facc15");
      btn.title = `${t.name} · ${t.cost} 金幣`;
      btn.setAttribute("aria-label", `在此建造${t.name}，花費 ${t.cost} 金幣`);
      btn.innerHTML = `${towerArt(t, 1, "wheel-ico")}<span class="wheel-cost">${t.cost}</span>`;
      btn.onclick = (ev) => {
        ev.stopPropagation();
        if (TD.buildTowerAt) TD.buildTowerAt(t.id, target.x, target.y);
        refreshUI();
      };
      wheel.appendChild(btn);
    });
    wheel.classList.remove("hidden");
    positionSceneElement(wheel, target.x, target.y, "wheel");
  }

  function refreshScenePositions() {
    const st = TD.state();
    if (st.selectedTower) positionSceneElement($("selPanel"), st.selectedTower.x, st.selectedTower.y, "bubble");
    if (st.selectedGoddess) positionSceneElement($("goddessPanel"), st.goddess.x, st.goddess.y, "bubble");
    if (st.buildMenuTarget) positionSceneElement($("buildWheel"), st.buildMenuTarget.x, st.buildMenuTarget.y, "wheel");
  }

  function fitCanvasToStage() {
    const stage = $("battlefieldStage");
    const host = $("battlefieldScroll");
    if (!stage || !host) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const scale = Math.max(.01, Math.min(width / 960, height / 640));
    stage.style.removeProperty("--r64-canvas-width");
    stage.style.removeProperty("--r64-canvas-height");
    stage.style.setProperty("--r68-canvas-width", `${Math.max(1, Math.floor(960 * scale))}px`);
    stage.style.setProperty("--r68-canvas-height", `${Math.max(1, Math.floor(640 * scale))}px`);
    requestAnimationFrame(() => {
      refreshScenePositions();
      syncAdvisorGeometry();
    });
  }

  function syncPauseButton(paused) {
    $("pauseBtn").textContent = paused ? "▶" : "⏸";
    $("pauseBtn").classList.toggle("paused", paused);
  }

  function showRecoveryNotice(message) {
    if (recoveryNoticeShown) return;
    recoveryNoticeShown = true;
    const box = document.createElement("div");
    box.className = "recovery-toast";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.textContent = message || "遊戲遇到錯誤，已保護存檔。重新整理即可繼續。";
    document.body.appendChild(box);
    pushLog("已啟動錯誤恢復：存檔保護完成。", "bad");
  }

  function restartRun() {
    $("overlay").classList.remove("show");
    TD.newGame();
    deployedThisGame = new Set();
    renderRoster();
    refreshUI();
  }

  function returnToMainMenu() {
    $("overlay").classList.remove("show");
    TD.newGame();
    deployedThisGame = new Set();
    renderRoster();
    refreshUI();
    renderDifficulties();
    showExclusiveR71Modal("diffOverlay");
    focusSoon(document.querySelector(".diff-opt"));
  }

  // 抽卡花「魂晶」（跨局永久貨幣），不是場內金錢——場內金錢每局重置，
  // 拿它買永久英雄等於重開新局就能無限白嫖。首抽免費讓新玩家先體驗盲盒。
  function gachaCostNow(meta) {
    return (TD.config.GACHA.firstFree && (meta.gachaCount || 0) === 0) ? 0 : TD.config.GACHA.cost;
  }
  function doGacha(options) {
    options = options || {};
    if ($("gachaOverlay").classList.contains("show") || $("progressOverlay").classList.contains("show")) return false;
    const meta = loadMeta();
    const cost = gachaCostNow(meta);
    if (meta.soulCrystal < cost) { pushLog(`魂晶不足（需 ${cost}💎，清波即可獲得）`, "bad"); return false; }
    meta.soulCrystal -= cost;
    const roll = TD.rollHeroWithPityPreferNew
      ? TD.rollHeroWithPityPreferNew(meta.gachaPity || 0, [...ownedHeroes])
      : TD.rollHeroWithPity(meta.gachaPity || 0);
    const { hero, pity } = roll;
    meta.gachaPity = pity;
    meta.gachaCount = (meta.gachaCount || 0) + 1;
    const isNew = !ownedHeroes.has(hero.id);
    let refund = 0;
    if (!isNew) { refund = TD.config.GACHA.dupRefund; meta.soulCrystal += refund; } // 重複補償
    saveMeta(meta);
    ownedHeroes.add(hero.id); saveOwned();
    refreshUI();
    if (!isNew && refund) {
      const gMeta = $("gachaMeta");
      if (gMeta) gMeta.textContent = `重複英雄即時退還 +${refund}💎｜目前 ${meta.soulCrystal}💎`;
    }
    playGachaAnimation(hero, isNew, refund, options);  // 盲盒動畫
    return true;
  }

  // 盲盒開箱動畫：寶箱 → 點擊開啟 → 稀有度光柱 → 英雄登場（動畫期間暫停戰場，敵人不會偷跑）
  function playGachaAnimation(hero, isNew, refund, options) {
    options = options || {};
    const ov = $("gachaOverlay"), chest = $("chest"), reveal = $("reveal");
    const r = TD.config.HERO_RARITY[hero.rarity];
    const wasPaused = TD.state().paused;
    TD.setPaused(true);
    // 重置
    chest.className = "chest"; reveal.className = "reveal";
    $("revealHero").innerHTML = "";
    $("revealName").textContent = "";
    $("revealRarity").textContent = "";
    if ($("revealQuote")) $("revealQuote").textContent = "";
    $("revealOk").textContent = options.doneLabel || "收下";
    ov.classList.add("show");

    chest.onclick = () => {
      chest.classList.add("opening");
      setTimeout(() => {
        chest.classList.add("hidden");
        // 揭示英雄
        ov.style.setProperty("--rev-color", r.color);
        ov.style.setProperty("--rev-glow", r.glow);
        $("revealHero").innerHTML = heroAvatar(hero);
        $("revealName").textContent = hero.name + (isNew ? " ✨新英雄" : refund ? ` （重複 +${refund}💎）` : "");
        // R75：抽卡回饋——稱號＋台詞（HERO_LEGENDS/DEPLOY_QUOTES 純資料，缺料時安靜退回原樣）。
        const revealLore = LORE.gachaRevealFor ? LORE.gachaRevealFor(hero.id) : { epithet: "", quote: "" };
        $("revealRarity").textContent = "★".repeat(r.stars) + " " + r.label + (revealLore.epithet ? " · " + revealLore.epithet : "");
        if ($("revealQuote")) $("revealQuote").textContent = revealLore.quote ? `「${revealLore.quote}」` : "";
        reveal.classList.add("show");
        focusSoon($("revealOk"));
        if (hero.rarity === "legendary" || hero.rarity === "epic") gachaConfetti();
      }, 900);
    };
    chest.onkeydown = (ev) => {
      if (ev.code === "Enter" || ev.code === "Space") {
        ev.preventDefault();
        chest.click();
      }
    };
    focusSoon(chest);
    $("revealOk").onclick = () => {
      ov.classList.remove("show");
      if (!wasPaused) TD.setPaused(false); // 收下英雄後恢復戰場（原本就手動暫停的除外）
      const r2 = TD.config.HERO_RARITY[hero.rarity];
      pushLog(`🎲 獲得 ${"★".repeat(r2.stars)} ${hero.name}${isNew ? "（新英雄！）" : `（重複，退還 ${refund}💎）`}`);
      renderRoster(); refreshUI();
      if (typeof options.onDone === "function") options.onDone();
    };
  }

  function gachaConfetti() {
    for (let i = 0; i < 30; i++) {
      const c = document.createElement("div");
      c.textContent = ["✨","⭐","💫","🌟","🎉"][i % 5];
      c.style.cssText = `position:fixed;left:50%;top:45%;font-size:26px;pointer-events:none;z-index:120;transition:all 1.3s ease-out;`;
      document.body.appendChild(c);
      requestAnimationFrame(() => {
        const a = (Math.PI*2*i)/30, d = 30+Math.random()*20;
        c.style.left = 50+Math.cos(a)*d+"%"; c.style.top = 45+Math.sin(a)*d+"%"; c.style.opacity = "0";
      });
      setTimeout(() => c.remove(), 1400);
    }
  }

  function heroAvatar(hero) {
    return `<img src="${hero.portrait}" alt="${hero.name}" loading="lazy" draggable="false">`;
  }

  function heroProgressFor(id, meta) {
    const progress = meta && meta.heroProgress && meta.heroProgress[id];
    if (!progress) return { xp: 0, level: 1 };
    const xp = Math.max(0, Math.floor(Number(progress.xp) || 0));
    const level = RULES.heroLongLevelFromXp ? RULES.heroLongLevelFromXp(xp) : Math.max(1, Math.floor(Number(progress.level) || 1));
    return { xp, level };
  }

  function heroLongBonus(progress) {
    return RULES.heroPermanentBonus ? RULES.heroPermanentBonus(progress) : 0;
  }

  function heroLongMetaLine(id, meta) {
    const progress = heroProgressFor(id, meta);
    const bonus = heroLongBonus(progress);
    const bonusText = bonus > 0 ? `｜永久 +${Math.round(bonus * 100)}%攻血` : "";
    return `羈絆 Lv.${progress.level}｜${progress.xp} XP${bonusText}`;
  }

  function heroStatLine(hero, progress) {
    const bonus = progress ? heroLongBonus(progress) : 0;
    const hp = bonus > 0 ? Math.round(hero.hp * (1 + bonus)) : hero.hp;
    const atk = bonus > 0 ? Math.round(hero.atk * (1 + bonus)) : hero.atk;
    const parts = [`生命 ${hp}`, `攻 ${atk}`, `射 ${hero.range}`, `速 ${hero.speed}`];
    if (hero.splash) parts.push(`濺射 ${hero.splash}`);
    if (hero.pierce) parts.push(`穿透 ${hero.pierce}`);
    if (hero.slow) parts.push("緩速");
    if (hero.healGoddess) parts.push(`治療 ${hero.healGoddess}`);
    if (bonus > 0) parts.push(`羈絆 +${Math.round(bonus * 100)}%攻血`);
    return parts.join(" · ");
  }

  function heroLongXpForLevel(level) {
    return RULES.heroLongXpForLevel ? RULES.heroLongXpForLevel(level) : (Math.max(1, Math.floor(Number(level) || 1)) - 1) * 24;
  }

  function nextBondNode(progress) {
    const p = progress || { xp: 0, level: 1 };
    const nodes = [5, 10, 15];
    const node = nodes.find((lv) => p.level < lv) || 15;
    const previous = nodes.filter((lv) => lv < node && p.level >= lv).pop() || 1;
    const startXp = heroLongXpForLevel(previous);
    const targetXp = heroLongXpForLevel(node);
    const span = Math.max(1, targetXp - startXp);
    const pct = node === 15 && p.level >= 15 ? 100 : Math.max(0, Math.min(100, Math.round(((p.xp - startXp) / span) * 100)));
    return {
      level: node,
      previous,
      startXp,
      targetXp,
      pct,
      maxed: p.level >= 15,
      totalBonus: Math.round(heroLongBonus({ xp: targetXp }) * 100),
    };
  }

  function heroRunSummary(id) {
    const hero = (TD.state().heroes || []).find((h) => h && h.id === id);
    if (!hero) return "本局尚未上場";
    const runXp = Math.max(0, Math.round(hero.runXp || 0));
    const gained = Math.max(0, Math.round(hero.levelsGained || 0));
    const hp = `${Math.max(0, Math.round(hero.hp || 0))}/${Math.max(1, Math.round(hero.maxHp || 1))}`;
    return `戰鬥 Lv.${hero.level || 1}｜本局 XP +${runXp}｜升級 +${gained}｜血量 ${hp}`;
  }

  function loadCodexSeen() {
    try {
      const raw = JSON.parse(localStorage.getItem(CODEX_SEEN_KEY));
      return {
        campaign: raw && raw.campaign && typeof raw.campaign === "object" ? raw.campaign : {},
        heroes: raw && raw.heroes && typeof raw.heroes === "object" ? raw.heroes : {},
      };
    } catch { return { campaign: {}, heroes: {} }; }
  }

  function saveCodexSeen(seen) {
    try { localStorage.setItem(CODEX_SEEN_KEY, JSON.stringify(seen || { campaign: {}, heroes: {} })); } catch {}
  }

  function codexContext(meta) {
    const st = TD.state();
    return {
      bestWave: Math.max(meta.bestWave || 0, st.wave || 0, st.clearedWave || 0),
      clearedWave: Math.max(st.clearedWave || 0, st.betweenWaves ? (st.wave || 0) : Math.max(0, (st.wave || 1) - 1)),
      bossKills: Math.max(st.bossKills || 0, meta.bossKills || 0),
    };
  }

  function campaignSeenIds(seen) {
    return Object.keys((seen && seen.campaign) || {}).filter((id) => seen.campaign[id] === true);
  }

  function heroStageSeen(seen, heroId, bond) {
    return !!(seen && seen.heroes && seen.heroes[heroId] && seen.heroes[heroId][bond]);
  }

  function unlockedHeroStages(heroId, meta) {
    const legend = LORE.HERO_LEGENDS && LORE.HERO_LEGENDS[heroId];
    if (!legend || !Array.isArray(legend.stages)) return [];
    const progress = heroProgressFor(heroId, meta);
    const owned = ownedHeroes.has(heroId) || progress.xp > 0;
    if (!owned) return [];
    return legend.stages.filter((stage) => progress.level >= stage.bond);
  }

  function collectNewCodexKeys(meta) {
    if (!LORE.evaluateCampaignUnlocks) return [];
    const seen = loadCodexSeen();
    const ctx = codexContext(meta);
    const keys = LORE.evaluateCampaignUnlocks(campaignSeenIds(seen), ctx).map((id) => `campaign:${id}`);
    for (const id of Object.keys(TD.config.HEROES || {})) {
      for (const stage of unlockedHeroStages(id, meta)) {
        if (!heroStageSeen(seen, id, stage.bond)) keys.push(`hero:${id}:${stage.bond}`);
      }
    }
    return keys;
  }

  function markUnlockedCodexSeen(meta) {
    if (!LORE.campaignUnlockState) return;
    const seen = loadCodexSeen();
    const state = LORE.campaignUnlockState(codexContext(meta));
    seen.campaign = seen.campaign || {};
    Object.keys(state).forEach((id) => { if (state[id]) seen.campaign[id] = true; });
    seen.heroes = seen.heroes || {};
    for (const id of Object.keys(TD.config.HEROES || {})) {
      const stages = unlockedHeroStages(id, meta);
      if (!stages.length) continue;
      seen.heroes[id] = seen.heroes[id] || {};
      stages.forEach((stage) => { seen.heroes[id][stage.bond] = true; });
    }
    saveCodexSeen(seen);
  }

  function refreshCodexBadge(meta) {
    const btn = $("codexBtn");
    if (!btn) return;
    const hasNew = collectNewCodexKeys(meta || loadMeta()).length > 0;
    btn.classList.toggle("has-new", hasNew);
    btn.setAttribute("aria-label", hasNew ? "開啟神魔誌，有新內容" : "開啟神魔誌");
  }

  function showCodexOracle(meta) {
    const keys = collectNewCodexKeys(meta || loadMeta()).filter((key) => key.startsWith("campaign:") && !notifiedCodexKeys.has(key));
    if (!keys.length) return;
    const first = keys[0];
    notifiedCodexKeys.add(first);
    const id = first.split(":")[1];
    const chapter = (LORE.CAMPAIGN_CHAPTERS || []).find((item) => item.id === id);
    if (!chapter) return;
    const toast = document.createElement("div");
    toast.className = "bond-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = `神諭：${chapter.oracle}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2600);
    pushLog(`📜 神魔誌解鎖「${chapter.title}」`);
  }

  function unlockText(unlock) {
    if (!unlock || unlock.type === "start") return "初始解鎖";
    if (unlock.type === "wave") return `抵達第 ${unlock.value} 波`;
    if (unlock.type === "boss") return `擊敗 Boss ${unlock.value} 次`;
    return "完成指定條件";
  }

  function renderCodexOverlay(meta) {
    const content = $("codexContent");
    const tabs = $("codexTabs");
    if (!content || !tabs || !LORE.WORLD_LORE) return;
    const m = meta || loadMeta();
    const seen = loadCodexSeen();
    const ctx = codexContext(m);
    const campaignState = LORE.campaignUnlockState ? LORE.campaignUnlockState(ctx) : {};
    const tabsDef = [
      ["world", "世界觀"],
      ["campaign", "戰役編年"],
      ["heroes", "英雄列傳"],
    ];
    tabs.innerHTML = tabsDef.map(([id, label]) =>
      `<button type="button" class="codex-tab ${codexTab === id ? "active" : ""}" data-codex-tab="${id}">${label}</button>`
    ).join("");
    tabs.querySelectorAll("[data-codex-tab]").forEach((btn) => {
      btn.onclick = () => { codexTab = btn.dataset.codexTab || "world"; renderCodexOverlay(loadMeta()); };
    });
    if (codexTab === "campaign") {
      content.innerHTML = `
        <div class="codex-list">
          ${(LORE.CAMPAIGN_CHAPTERS || []).map((chapter) => {
            const unlocked = !!campaignState[chapter.id];
            const isNew = unlocked && !seen.campaign[chapter.id];
            return `<article class="codex-entry ${unlocked ? "" : "locked"}">
              <div class="codex-entry-head">
                <span class="codex-mark">${unlocked ? "📖" : "◆"}</span>
                <div><h3>${unlocked ? chapter.title : "未解鎖章節"}</h3><p>${unlocked ? chapter.epithet : unlockText(chapter.unlock)}</p></div>
                ${isNew ? '<b class="new-dot">NEW!</b>' : ""}
              </div>
              ${unlocked ? `<blockquote>${chapter.oracle}</blockquote><p>${chapter.body}</p>` : `<p class="codex-locked">條件：${unlockText(chapter.unlock)}</p>`}
            </article>`;
          }).join("")}
        </div>`;
    } else if (codexTab === "heroes") {
      content.innerHTML = `
        <div class="codex-hero-grid">
          ${Object.values(TD.config.HEROES || {}).map((hero) => {
            const progress = heroProgressFor(hero.id, m);
            const owned = ownedHeroes.has(hero.id) || progress.xp > 0;
            const legend = LORE.HERO_LEGENDS && LORE.HERO_LEGENDS[hero.id];
            const stage = LORE.legendStageFor ? LORE.legendStageFor(hero.id, progress.level) : null;
            const next = legend && legend.stages.find((item) => progress.level < item.bond);
            const stages = legend ? legend.stages.map((item) => {
              const unlocked = owned && progress.level >= item.bond;
              const isNew = unlocked && !heroStageSeen(seen, hero.id, item.bond);
              return `<div class="codex-stage ${unlocked ? "" : "locked"}">
                <b>${unlocked ? item.title : `羈絆 Lv.${item.bond}`}</b>${isNew ? '<em>NEW!</em>' : ""}
                <span>${unlocked ? item.text : `羈絆 Lv.${item.bond} 解鎖列傳`}</span>
              </div>`;
            }).join("") : "";
            return `<article class="codex-hero ${owned ? "" : "locked"}">
              <div class="codex-hero-head">
                <span class="codex-avatar">${owned ? heroAvatar(hero) : "◆"}</span>
                <div><h3>${owned ? hero.name : "未知英靈"}</h3><p>${owned ? `${legend ? legend.epithet : hero.desc}｜羈絆 Lv.${progress.level}` : "抽到英雄後解鎖序章"}</p></div>
              </div>
              ${owned && stage ? `<div class="codex-current"><b>當前列傳：${stage.title}</b><span>${stage.text}</span></div>` : ""}
              ${owned && next ? `<div class="codex-next">下一節點：羈絆 Lv.${next.bond} 解鎖「${next.title}」</div>` : ""}
              <div class="codex-stage-list">${stages}</div>
            </article>`;
          }).join("")}
        </div>`;
    } else {
      content.innerHTML = `
        <section class="codex-world">
          <h3>${LORE.WORLD_LORE.title}</h3>
          ${LORE.WORLD_LORE.body.map((p) => `<p>${p}</p>`).join("")}
          ${(LORE.MAP_LORE ? Object.values(LORE.MAP_LORE).map((m) => `<p><b>${m.title}</b>：${(m.lines || []).join(" ")}</p>`).join("") : "")}
          <div class="oracle-card"><b>神諭低語</b><span>${LORE.oracleWhisper ? LORE.oracleWhisper((m.bestWave || 0) + (TD.state().wave || 0)) : ""}</span></div>
        </section>`;
    }
  }

  function openCodexOverlay() {
    const overlay = $("codexOverlay");
    if (!overlay || overlay.classList.contains("show")) return;
    codexWasPaused = !!TD.state().paused;
    TD.setPaused(true);
    syncPauseButton(true);
    const meta = loadMeta();
    renderCodexOverlay(meta);
    overlay.classList.add("show");
    markUnlockedCodexSeen(meta);
    refreshCodexBadge(meta);
    focusSoon($("codexClose"));
  }

  function closeCodexOverlay() {
    const overlay = $("codexOverlay");
    if (!overlay) return;
    overlay.classList.remove("show");
    if (!codexWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
    focusSoon($("codexBtn"));
  }

  function currentHeroLegendHtml(id, progress) {
    if (!LORE.legendStageFor || !LORE.HERO_LEGENDS) return "";
    const stage = LORE.legendStageFor(id, progress.level);
    const legend = LORE.HERO_LEGENDS[id];
    if (!legend) return "";
    const next = legend.stages.find((item) => progress.level < item.bond);
    const body = stage
      ? `<b>${legend.epithet}｜${stage.title}</b><span>${stage.text}</span>`
      : `<b>${legend.epithet}</b><span>羈絆 Lv.1 解鎖列傳序章。</span>`;
    const nextText = next ? `下一節點解鎖列傳：羈絆 Lv.${next.bond}「${next.title}」` : "列傳已全部解鎖";
    return `<div class="hd-lore">${body}<em>${nextText}</em></div>`;
  }

  function deployHeroFromRoster(id, progress) {
    if (TD.deployHero(id, progress)) {
      deployedThisGame.add(id);
      renderRoster();
      refreshUI();
      return true;
    }
    return false;
  }

  function closeHeroDetail() {
    const overlay = $("heroDetailOverlay");
    if (!overlay || !overlay.classList.contains("show")) return;
    overlay.classList.remove("show");
    if (!heroDetailWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
  }

  function openHeroDetail(id) {
    const hero = TD.config.HEROES[id];
    const overlay = $("heroDetailOverlay");
    const content = $("heroDetailContent");
    if (!hero || !overlay || !content) return;
    const meta = loadMeta();
    const progress = heroProgressFor(id, meta);
    const node = nextBondNode(progress);
    const deployed = deployedThisGame.has(id);
    const bonus = Math.round(heroLongBonus(progress) * 100);
    const nextText = node.maxed
      ? "羈絆節點已滿：永久 +15%攻血"
      : `下一節點 Lv.${node.level}：再 +5%攻血（總 +${node.totalBonus}%）`;
    if (!overlay.classList.contains("show")) {
      heroDetailWasPaused = !!TD.state().paused;
      TD.setPaused(true);
      syncPauseButton(true);
    }
    content.innerHTML = `
      <div class="hd-title">${heroAvatar(hero)} <span>英雄詳情｜${hero.name}</span></div>
      <div class="hd-sub">${hero.desc}</div>
      <div class="hd-grid">
        <div><b>戰鬥數值</b><span>${heroStatLine(hero, progress)}</span></div>
        <div><b>跨局羈絆</b><span>羈絆 Lv.${progress.level}｜${progress.xp}/${node.targetXp} XP｜永久 +${bonus}%攻血</span></div>
      </div>
      <div class="hd-progress-head"><span>羈絆進度</span><span>Lv.${node.previous} → Lv.${node.level}</span></div>
      <div class="hd-progress"><span style="width:${node.pct}%"></span></div>
      <div class="hd-node">${nextText}</div>
      ${currentHeroLegendHtml(id, progress)}
      <div class="hd-run"><b>本局表現摘要</b><span>${heroRunSummary(id)}</span></div>
      <div class="hd-actions">
        <button type="button" id="heroDetailDeploy" ${deployed ? "disabled" : ""}>${deployed ? "已上場" : "上場"}</button>
      </div>`;
    const deployBtn = $("heroDetailDeploy");
    if (deployBtn && !deployed) {
      deployBtn.setAttribute("aria-label", `部署 ${hero.name}`);
      deployBtn.onclick = () => {
        if (deployHeroFromRoster(id, progress)) openHeroDetail(id);
      };
    } else if (deployBtn) {
      deployBtn.setAttribute("aria-label", `${hero.name} 已上場`);
    }
    overlay.classList.add("show");
    focusSoon($("heroDetailClose"));
  }

  function renderRoster() {
    const box = $("heroRoster"); box.innerHTML = "";
    const HEROES = TD.config.HEROES, HR = TD.config.HERO_RARITY;
    const meta = loadMeta();
    if (ownedHeroes.size === 0) {
      box.innerHTML = '<div style="font-size:11px;color:#8b98a8;padding:4px;">尚未抽到英雄</div>';
      return;
    }
    [...ownedHeroes].forEach((id) => {
      const h = HEROES[id]; if (!h) return;
      const r = HR[h.rarity];
      const deployed = deployedThisGame.has(id);
      const progress = heroProgressFor(id, meta);
      const longBonusPct = Math.round(heroLongBonus(progress) * 100);
      const card = document.createElement("div");
      card.className = "hero-card" + (deployed ? " deployed" : "");
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.setAttribute("aria-label", `${h.name}英雄詳情，羈絆 Lv.${progress.level}，${deployed ? "已上場" : "可上場"}`);
      card.style.setProperty("--hr-color", r.color);
      card.style.setProperty("--hr-glow", r.glow);
      card.innerHTML = `
        <span class="hico">${heroAvatar(h)}</span>
        <span class="hinfo"><span class="hname">${h.name}</span> ${"★".repeat(r.stars)} <span class="hbond">羈絆 Lv.${progress.level}${longBonusPct ? ` +${longBonusPct}%攻血` : ""}</span><br><span class="hmeta">${h.desc}<br>${heroStatLine(h, progress)}<br>${heroLongMetaLine(id, meta)}</span></span>
        <button type="button" class="hdeploy">${deployed ? "詳情" : "上場▶"}</button>`;
      card.onclick = () => openHeroDetail(id);
      card.onkeydown = (ev) => {
        if (ev.code === "Enter" || ev.code === "Space") {
          ev.preventDefault();
          openHeroDetail(id);
        }
      };
      const deployBtn = card.querySelector(".hdeploy");
      deployBtn.setAttribute("aria-label", deployed ? `${h.name} 已上場，開啟詳情` : `部署 ${h.name}`);
      deployBtn.onclick = (ev) => {
        ev.stopPropagation();
        if (deployed) openHeroDetail(id);
        else deployHeroFromRoster(id, progress);
      };
      box.appendChild(card);
    });
  }

  function renderDeployedHeroes() {
    const box = $("deployedHeroes");
    if (!box) return;
    const st = TD.state();
    const deployed = (st.heroes || []).filter((h) => h && hasOwn(TD.config.HEROES, h.id));
    if (!deployed.length) {
      box.innerHTML = '<div class="deployed-empty">已上場英雄會顯示在這裡</div>';
      return;
    }
    box.innerHTML = "";
    const meta = loadMeta();
    deployed.forEach((h) => {
      const def = TD.config.HEROES[h.id];
      const progress = heroProgressFor(h.id, meta);
      const bondLevel = Math.max(h.longLevel || 1, progress.level || 1);
      const hpPct = Math.max(0, Math.min(100, Math.round(((h.hp || 0) / Math.max(1, h.maxHp || 1)) * 100)));
      const active = st.pendingHero === h.uid;
      const guarded = !!h.guardPoint;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `deployed-hero-slot${active ? " active" : ""}${guarded ? " guarded" : ""}`;
      btn.dataset.heroSlot = h.uid;
      btn.setAttribute("aria-label", `${def.name}上場英雄，生命 ${hpPct}%，${active ? "選擇駐守點中" : guarded ? "已設定駐守點" : "可設定駐守點"}`);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.title = active ? "點地圖設定駐守點" : "點擊後在地圖設定駐守點";
      btn.innerHTML = `
        <span class="dh-avatar">${heroAvatar(def)}</span>
        <span class="dh-body">
          <span class="dh-top"><b>${def.name}</b><em>戰鬥Lv.${h.level || 1}｜羈絆Lv.${bondLevel}</em></span>
          <span class="dh-hp"><span style="width:${hpPct}%"></span></span>
          <span class="dh-status">${active ? "選擇駐守點" : (guarded ? "駐守中" : "點我駐守")}</span>
        </span>`;
      btn.onclick = () => {
        if (TD.selectHeroGuard && TD.selectHeroGuard(h.uid)) renderDeployedHeroes();
      };
      box.appendChild(btn);
    });
  }

  function missionContext(meta) {
    const st = TD.state();
    const towers = st.towers || [];
    return {
      wave: st.wave || 0,
      clearedWave: st.clearedWave || (st.betweenWaves ? st.wave : Math.max(0, (st.wave || 1) - 1)),
      towerCount: towers.length,
      towersBuilt: st.towersBuilt || towers.length,
      maxTowerLevel: towers.reduce((max, tw) => Math.max(max, tw.level || 1), 1),
      towerUpgrades: st.towerUpgrades || 0,
      skillCasts: st.skillCasts || 0,
      bossKills: st.bossKills || 0,
      deployedHeroCount: (st.heroes || []).length,
      ownedHeroCount: ownedHeroes.size,
      totalHeroCount: Object.keys(TD.config.HEROES).length,
      gachaCount: meta.gachaCount || 0,
    };
  }

  function remainingMissionReward(meta) {
    const claimed = (meta && meta.beginnerMissions) || {};
    return Object.values(BEGINNER_MISSIONS || {}).reduce((sum, mission) => (
      claimed[mission.id] === true ? sum : sum + (mission.reward || 0)
    ), 0);
  }

  function showMissionToast(unlocked) {
    if (!unlocked || !unlocked.length) return;
    const total = unlocked.reduce((sum, m) => sum + (m.reward || 0), 0);
    const toast = document.createElement("div");
    toast.className = "mission-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = `新手任務完成：+${total}💎`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1900);
    unlocked.forEach((m) => pushLog(`🎯 任務達成「${m.label}」已領 +${m.reward}💎`));
  }

  function showBondToast(entries) {
    const gained = (entries || []).filter((entry) => entry && entry.levelGained > 0);
    if (!gained.length) return;
    const first = gained[0];
    const hero = TD.config.HEROES[first.id] || {};
    const toast = document.createElement("div");
    toast.className = "bond-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = `羈絆升級：${hero.name || first.id} Lv.${first.newLevel}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2100);
    gained.forEach((entry) => {
      const def = TD.config.HEROES[entry.id] || {};
      pushLog(`💫 ${def.name || entry.id} 羈絆升級 Lv.${entry.newLevel}，永久加成 ${Math.round((entry.bonus || 0) * 100)}%`);
    });
  }

  function claimBeginnerMissions(baseMeta) {
    if (!RULES.evaluateBeginnerMissions) return baseMeta || loadMeta();
    const meta = baseMeta || loadMeta();
    const result = RULES.evaluateBeginnerMissions(meta, missionContext(meta));
    if (result.unlocked.length) {
      saveMeta(result.meta);
      const st = TD.state();
      st.runMissionSoulEarned = (st.runMissionSoulEarned || 0) + result.unlocked.reduce((sum, m) => sum + (m.reward || 0), 0);
      showMissionToast(result.unlocked);
      return result.meta;
    }
    return meta;
  }

  function renderBeginnerMissions(meta) {
    const box = $("beginnerMissions");
    if (!box) return;
    const missions = Object.values(BEGINNER_MISSIONS || {});
    if (!missions.length) { box.innerHTML = ""; return; }
    const claimed = meta.beginnerMissions || {};
    const claimedCount = missions.filter((m) => claimed[m.id] === true).length;
    const totalReward = missions.reduce((sum, m) => sum + (m.reward || 0), 0);
    const nextCost = TD.config.GACHA.cost;
    const progress = Math.min(nextCost, meta.soulCrystal || 0);
    const pathText = meta.gachaCount > 0 && ownedHeroes.size < 2
      ? `第二英雄進度 ${progress}/${nextCost}💎，剩餘任務可得 +${remainingMissionReward(meta)}💎`
      : `新手任務 ${claimedCount}/${missions.length}，總增發 ${totalReward}💎`;
    box.innerHTML = `
      <div class="mission-title">🎯 首 10 波目標</div>
      <div class="mission-progress">${pathText}</div>
      <div class="mission-list">
        ${missions.map((m) => {
          const done = claimed[m.id] === true;
          return `<div class="mission-row ${done ? "claimed" : ""}" data-mission="${m.id}">
            <div>${done ? "✅" : "▫️"}</div>
            <div><div class="m-name">${m.label}</div><div class="m-desc">${m.desc}</div></div>
            <div class="m-reward">${done ? "已領" : `+${m.reward}💎`}</div>
          </div>`;
        }).join("")}
      </div>`;
  }

  function openEnemyInfo(id) {
    const e = ENEMIES[id];
    const box = $("enemyInfo");
    if (!e || !box) return;
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="enemy-title">${e.emoji || ""} ${e.name}</div>
      <div class="enemy-stats">血量 ${e.hp}${e.shield ? ` + 護盾 ${e.shield}` : ""} · 速度 ${e.speed} · 元素 ${ELEM_ICON[e.element]}${ELEM_LABEL[e.element]}</div>
      <div class="enemy-trait">特性：${enemyTrait(e)}</div>
      <div class="enemy-counter">反制：${e.counterHint || "用克制元素塔集火，必要時補寒冰塔控場。"}</div>
      ${e.loreLine ? `<div class="enemy-counter">裂界註記：${e.loreLine}</div>` : ""}`;
    document.querySelectorAll(".enemy-chip-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.enemy === id));
  }

  function renderNextWaveCard() {
    const box = $("nextWaveCard");
    if (!box || !TD.previewNextWave) return;
    const st = TD.state();
    if (!st.betweenWaves || st.over) {
      box.innerHTML = `<div class="nw-title">⚔ 防禦中</div><div class="nw-meta">敵人進攻時可點技能救場，波間會顯示下一波情報。</div>`;
      return;
    }
    const p = TD.previewNextWave({ advisorMode });
    const theme = p.theme ? `${ELEM_ICON[p.theme] || ""}${ELEM_LABEL[p.theme] || p.theme}` : "混合";
    const event = p.event
      ? `<span class="event-badge" style="--event-color:${p.event.color || "#facc15"}">${p.event.emoji}${p.event.label}</span> ${p.event.desc}`
      : (p.isBoss ? '<span class="event-badge boss">⚠️ Boss 波</span>' : "標準波");
    const affixText = p.affix ? ` · 詞綴 ${p.affix.label}` : "";
    const enemyTypes = (p.enemyTypes || []).filter((item) => ENEMIES[item.type]);
    const recs = (p.recommendations || []).filter((item) => TOWERS[item.id]);
    const advisor = (p.advisor || []).filter((item) => item && item.kind);
    const advisorModes = RULES.ADVISOR_MODES || {
      control: { label: "控場優先" },
      aoe: { label: "範圍清怪" },
      boss: { label: "Boss 單點" },
    };
    const modeHtml = Object.entries(advisorModes).map(([id, item]) =>
      `<button type="button" data-advisor-mode="${id}" class="${advisorMode === id ? "active" : ""}">${item.label}</button>`
    ).join("");
    const advisorRestoreHtml = advisorHidden
      ? '<button type="button" class="advisor-restore" data-advisor-show>顯示顧問</button>'
      : "";
    // R75 B-02 最小版：確定性波次預告詞；channel=banner（≤40 波）才上情報卡。
    const herald = LORE.waveHeraldFor ? LORE.waveHeraldFor(p.wave, p.event && p.event.id, p.isBoss) : null;
    const heraldHtml = herald && herald.channel === "banner"
      ? `<div class="nw-herald">📯 ${herald.text}</div>`
      : "";
    const advisorHtml = advisorHidden ? "" : `
      <div class="advisor-row ${advisorCollapsed ? "collapsed" : ""}">
        <div class="advisor-head">
          <span>塔陣顧問</span>
          <span class="advisor-tools">
            <button type="button" data-advisor-toggle>${advisorCollapsed ? "展開" : "收合"}</button>
            <button type="button" data-advisor-close>關閉</button>
          </span>
        </div>
        <div class="advisor-mode">${modeHtml}</div>
        <div class="advisor-actions">
          ${advisor.map((item, index) => {
            if (item.kind === "build") return `<button type="button" class="advisor-action" data-advisor-action="${index}" data-advisor-kind="build"><b>補 ${item.emoji || ""}${item.towerName}</b><span>${item.zone}（${item.cx},${item.cy}）｜${item.reason}</span></button>`;
            if (item.kind === "upgrade") return `<button type="button" class="advisor-action" data-advisor-action="${index}" data-advisor-kind="upgrade"><b>升 ${item.emoji || ""}${item.towerName}</b><span>Lv.${item.level}→${item.nextLevel}｜${item.reason}</span></button>`;
            return `<button type="button" class="advisor-action" data-advisor-action="${index}" data-advisor-kind="save"><b>存錢等 ${item.emoji || ""}${item.towerName}</b><span>${item.reason}</span></button>`;
          }).join("") || '<div class="advisor-action static"><b>維持陣型</b><span>目前沒有明顯補強缺口。</span></div>'}
        </div>
      </div>`;
    box.innerHTML = `
      <div class="nw-title">🧭 下一波情報：第 ${p.wave} 波</div>
      <div class="nw-meta">${event} · 主元素 ${theme} · 敵人 ${p.totalCount || p.count} 隻${affixText}</div>
      ${heraldHtml}
      <div class="enemy-chip-row">
        ${enemyTypes.map((item) => {
          const e = ENEMIES[item.type];
          return `<button class="enemy-chip-btn" data-enemy="${item.type}" title="${enemySummary(item.type)}">${e.emoji || ""} ${e.name}×${item.count}</button>`;
        }).join("")}
      </div>
      <div class="tower-rec-row">
        <div class="tower-rec-title">建議塔種</div>
        <div class="tower-rec-list">
          ${recs.map((item) => {
            const t = TOWERS[item.id];
            return `<span class="tower-rec-chip" title="${item.reason}">${t.emoji} ${t.name}</span>`;
          }).join("") || '<span class="tower-rec-chip">依現有塔陣補強</span>'}
        </div>
        ${recs[0] ? `<div class="tower-rec-reason">${recs[0].reason}</div>` : ""}
      </div>
      ${advisorRestoreHtml}
      ${advisorHtml}`;
    box.querySelectorAll(".enemy-chip-btn").forEach((btn) => {
      btn.onclick = () => openEnemyInfo(btn.dataset.enemy);
    });
    const toggle = box.querySelector("[data-advisor-toggle]");
    if (toggle) toggle.onclick = () => { advisorCollapsed = !advisorCollapsed; renderNextWaveCard(); };
    const close = box.querySelector("[data-advisor-close]");
    if (close) close.onclick = () => { advisorHidden = true; renderNextWaveCard(); };
    const showAdvisor = box.querySelector("[data-advisor-show]");
    if (showAdvisor) showAdvisor.onclick = () => { advisorHidden = false; advisorCollapsed = false; renderNextWaveCard(); };
    box.querySelectorAll("[data-advisor-mode]").forEach((btn) => {
      btn.onclick = () => {
        advisorMode = btn.dataset.advisorMode || "control";
        if (TD.setAdvisorMode) TD.setAdvisorMode(advisorMode);
        renderNextWaveCard();
      };
    });
    box.querySelectorAll("[data-advisor-action]").forEach((btn) => {
      btn.onclick = () => {
        const action = advisor[Number(btn.dataset.advisorAction)];
        if (TD.previewAdvisorAction && TD.previewAdvisorAction(action)) refreshUI();
      };
    });
    syncR71ModalState();
  }

  function renderAffixCard() {
    const box = $("affixCard");
    if (!box) return;
    const st = TD.state();
    const affix = st && st.affix;
    if (!affix) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const bal = RULES.affixExpectedBalance ? RULES.affixExpectedBalance(affix) : { goldDelta: 0, powerDelta: 0, netDelta: 0 };
    const pct = (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="affix-title">${affix.emoji || ""} 本局詞綴：${affix.label}</div>
      <div class="affix-desc">${affix.desc}</div>
      <div class="affix-balance">預期：資源 ${pct(bal.goldDelta)} · 壓力 ${pct(bal.powerDelta)} · 淨值 ${pct(bal.netDelta)}</div>
      <div class="affix-impact">塔種影響：${affix.towerImpact || "依本局詞綴調整主力塔位置與升級順序。"}</div>`;
  }

  // ===== HUD 與整體刷新 =====
  function refreshUI() {
    const st = TD.state();
    const juice = TD.getJuiceSettings ? TD.getJuiceSettings() : { reducedEffects: false };
    document.documentElement.classList.toggle("reduced-effects", !!juice.reducedEffects);
    updateHudNumber("gold", st.gold);
    updateHudNumber("goddessHp", Math.max(0, Math.round(st.goddess.hp)));
    $("goddessMax").textContent = st.goddess.maxHp;
    // D11 女神低血告警：低於 30% 閃紅
    const livesStat = document.querySelector(".hud .lives");
    if (livesStat) livesStat.classList.toggle("danger", st.goddess.hp / st.goddess.maxHp < 0.3 && st.goddess.hp > 0);
    $("wave").textContent = st.wave;
    $("score").textContent = st.score;
    const waveTotal = Math.max(0, Number(st.waveTotal) || 0);
    const waveResolved = Math.max(0, Math.min(waveTotal, Number(st.waveResolved) || 0));
    const wavePct = st.wave <= 0 ? 0 : st.betweenWaves ? 100 : waveTotal ? Math.round(waveResolved / waveTotal * 100) : 0;
    const waveFill = $("waveMeterFill");
    const waveMeter = $("waveMeter");
    const waveText = $("waveMeterText");
    if (waveFill) waveFill.style.width = `${wavePct}%`;
    if (waveMeter) waveMeter.setAttribute("aria-valuenow", String(wavePct));
    if (waveText) waveText.textContent = st.betweenWaves ? (st.wave > 0 ? "CLEAR" : "就緒") : `${waveResolved}/${waveTotal}`;

    // 女神升級只在直接點戰場女神後就地顯示
    const gBtn = $("goddessBtn");
    const gPanel = $("goddessPanel");
    const G = TD.config.GODDESS;
    if (st.goddess.level >= G.maxLevel) { gBtn.textContent = "👸 女神已滿級"; gBtn.disabled = true; }
    else {
      const cost = TD.goddessUpgradeCost();
      gBtn.textContent = `👸 升級女神 (${cost}💰) Lv.${st.goddess.level}`;
      gBtn.disabled = st.gold < cost;
    }
    if (st.selectedGoddess) {
      $("goddessInfo").innerHTML = `<b>👸 ${G.name}</b> Lv.${st.goddess.level}<br>生命 ${Math.max(0, Math.round(st.goddess.hp))}/${st.goddess.maxHp}${st.goddess.level >= G.smiteUnlockLevel ? " · 聖光反擊已啟動" : " · Lv.2 解鎖聖光反擊"}`;
      gPanel.classList.remove("hidden");
      positionSceneElement(gPanel, st.goddess.x, st.goddess.y, "bubble");
    } else gPanel.classList.add("hidden");

    // 抽卡按鈕（花魂晶，跨局貨幣；首抽免費）
    const meta = claimBeginnerMissions();
    const gcost = gachaCostNow(meta);
    const gBtn2 = $("gachaBtn");
    gBtn2.textContent = gcost === 0 ? "🎲 抽英雄（首抽免費！）" : `🎲 抽英雄 (${gcost}💎 持有 ${meta.soulCrystal})`;
    gBtn2.disabled = meta.soulCrystal < gcost;
    const gMeta = $("gachaMeta");
    if (gMeta) {
      const totalHeroes = Object.keys(TD.config.HEROES).length;
      const pityShown = Math.max(0, Math.min(meta.gachaPity || 0, TD.config.GACHA.pityLegendary));
      const secondLine = meta.gachaCount > 0 && ownedHeroes.size < 2
        ? `｜第二英雄 ${Math.min(TD.config.GACHA.cost, meta.soulCrystal)}/${TD.config.GACHA.cost}💎`
        : "";
      gMeta.textContent = `${meta.soulCrystal}💎｜保底 ${pityShown}/${TD.config.GACHA.pityLegendary}｜英雄 ${ownedHeroes.size}/${totalHeroes}${secondLine}`;
    }
    renderBeginnerMissions(meta);
    showCodexOracle(meta);
    refreshCodexBadge(meta);
    if (isShown("codexOverlay")) renderCodexOverlay(meta);
    renderRoster();
    renderDeployedHeroes();

    // 建塔按鈕：金錢不足變灰、選中的高亮
    document.querySelectorAll(".tower-btn").forEach((b) => {
      const t = TOWERS[b.dataset.type];
      b.classList.toggle("cant", st.gold < t.cost);
      b.classList.toggle("active", st.selectedTowerType === t.id);
      b.setAttribute("aria-disabled", st.gold < t.cost ? "true" : "false");
    });

    // 技能冷卻
    document.querySelectorAll(".skill-btn").forEach((b) => {
      const cd = st.skillCooldowns[b.dataset.skill] || 0;
      const sk = SKILLS[b.dataset.skill];
      b.classList.toggle("cd", cd > 0);
      b.classList.toggle("active", st.pendingSkill === b.dataset.skill);
      b.style.setProperty("--cd-angle", `${Math.round(Math.min(1, cd / Math.max(.01, sk.cooldown)) * 360)}deg`);
      const span = b.querySelector(".cdtext");
      span.textContent = cd > 0 ? Math.ceil(cd) + "s" : "就緒";
    });
    const skillCancel = $("skillCancelBtn");
    if (skillCancel) skillCancel.hidden = !st.pendingSkill;

    // 開始按鈕：只有波間可按，並顯示下一波預告（D4）
    const startBtn = $("startBtn");
    startBtn.disabled = !st.betweenWaves || st.over;
    if (st.wave === 0 && st.towers.length === 0 && !st.over) {
      startBtn.disabled = true;
      startBtn.textContent = "先建一座塔！";
    } else if (st.betweenWaves && !st.over && TD.previewNextWave) {
      const p = TD.previewNextWave({ advisorMode });
      if (p.event) {
        // 事件波預告（最醒目）
        startBtn.innerHTML = `▶ 第 ${p.wave} 波 ${p.event.emoji}${p.event.label}!`;
      } else {
        const themeLabel = p.theme && p.theme !== "physical" ? ` · 主${ELEM_ICON[p.theme]||""}` : "";
        startBtn.innerHTML = `▶ 第 ${p.wave} 波 (${p.count}隻${p.isBoss ? " ⚠️BOSS" : ""}${themeLabel})`;
      }
    } else {
      startBtn.textContent = "⚔ 防禦中…";
    }
    renderNextWaveCard();
    renderAffixCard();

    // 選中塔的升級面板
    const sel = $("selPanel");
    if (st.selectedTower) {
      const tw = st.selectedTower, def = TOWERS[tw.type];
      const maxed = tw.level >= TD.config.UPGRADE.maxLevel;
      let statLine;
      if (def.slowAura) {
        statLine = `暴露敵人 · 減速 ${Math.round(def.slowAura * 100)}% · 射程 ${Math.round(TD.towerStat(tw, "range"))}<br>與寒冰塔取較強減速，不造成傷害；不補臼砲盲區`;
      } else if (def.support) {
        const gain = TD.supportDpsGain ? TD.supportDpsGain(tw) : 0;
        statLine = `增傷 +${Math.round(TD.towerStat(tw, "buff") * 100)}% · 射程 ${Math.round(TD.towerStat(tw, "range"))}<br>目前加成 +${gain.toFixed(1)} DPS`;
      } else {
        const buff = TD.getTowerBuff ? TD.getTowerBuff(tw) : 0;
        const effective = TD.effectiveTowerDamage ? TD.effectiveTowerDamage(tw) : TD.towerStat(tw, "damage");
        const poisonDps = def.poisonDps && TD.towerStat ? TD.towerStat(tw, "poisonDps") : def.poisonDps;
        const poison = def.poisonDps ? `<br>毒素 ${poisonDps.toFixed(1)}/秒 · ${def.poisonDuration} 秒 · 最多 ${def.poisonMaxStacks} 層` : "";
        const blind = def.minRange ? ` · 固定盲區 ${Math.round(TD.towerStat(tw, "minRange"))}` : "";
        const blindNote = def.minRange ? "<br>腳下需由其他塔補位，引魂燈不會替臼砲補盲區" : "";
        statLine = `傷害 ${Math.round(effective)}${buff > 0 ? `（聖光 +${Math.round(buff * 100)}%）` : ""} · 射程 ${Math.round(TD.towerStat(tw, "range"))}${blind}${poison}${blindNote}`;
      }
      $("selInfo").innerHTML = `
        <b class="sel-tower-title">${towerArt(def, tw.level, "sel-tower-art")}<span>${def.name} Lv.${tw.level}</span></b><br>
        ${statLine}`;
      const cost = TD.upgradeCost(tw);
      $("upgBtn").textContent = maxed ? "已滿級" : `升級 (${cost}💰)`;
      $("upgBtn").disabled = maxed || st.gold < cost;
      sel.classList.remove("hidden");
      positionSceneElement(sel, tw.x, tw.y, "bubble");
    } else sel.classList.add("hidden");
    renderBuildWheel(st);
  }

  // ===== 日誌 =====
  function pushLog(msg, kind) {
    const box = $("log");
    if (!box.dataset.expandBound) {
      box.dataset.expandBound = "1";
      box.title = "點擊展開最近 20 條訊息";
      box.onclick = () => box.classList.toggle("expanded");
    }
    const d = document.createElement("div");
    d.className = kind || ""; d.textContent = msg;
    box.appendChild(d);
    while (box.children.length > 20) box.removeChild(box.firstChild);
  }

  // ===== Meta 進度系統（D1：最高紀錄 + 魂晶）=====
  // 讀檔一律交給 rules.js 補齊版本與欄位，避免舊存檔缺欄位時把 meta 打成 NaN。
  const META_KEY = "td_meta_v1";
  function loadRawMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)); } catch { return null; }
  }
  function loadMeta() {
    return RULES.migrateMeta(loadRawMeta());
  }
  function saveMeta(m) {
    try {
      const result = RULES.protectMetaWrite
        ? RULES.protectMetaWrite(loadRawMeta(), m)
        : { ok: true, meta: RULES.migrateMeta(m) };
      localStorage.setItem(META_KEY, JSON.stringify(result.meta));
      if (!result.ok) showRecoveryNotice("存檔保護啟動：保留上一份有效資料。");
      return result.ok;
    } catch { return false; }
  }

  const SAVE_BACKUP_KEY = "td_meta_backup_v1";
  const SAVE_KIND = "td-save-v1";
  const META_IMPORT_KEYS = ["version", "soulCrystal", "bestWave", "bestByDiff", "board", "achievements", "beginnerMissions", "heroProgress", "games", "totalKills", "gachaPity", "gachaCount", "runSeed", "lastMap"];

  function encodeTextBase64(text) {
    const bytes = new TextEncoder().encode(String(text || ""));
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function decodeTextBase64(code) {
    const binary = atob(String(code || "").trim());
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function buildSaveBundle() {
    return {
      kind: SAVE_KIND,
      exportedAt: Date.now(),
      meta: loadMeta(),
      heroes: [...ownedHeroes],
    };
  }

  function encodeSaveBundle(bundle) {
    return encodeTextBase64(JSON.stringify(bundle || buildSaveBundle()));
  }

  function decodeSaveCode(code) {
    const payload = JSON.parse(decodeTextBase64(code));
    const rawMeta = payload && payload.kind === SAVE_KIND ? payload.meta : payload;
    const heroes = payload && payload.kind === SAVE_KIND ? payload.heroes : null;
    return { payload, rawMeta, heroes };
  }

  function importableMetaShape(rawMeta) {
    if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) return false;
    return META_IMPORT_KEYS.some((key) => hasOwn(rawMeta, key));
  }

  function setSaveStatus(text, ok) {
    const box = $("saveStatus");
    if (!box) return;
    box.textContent = text || "";
    box.style.color = ok ? "#86efac" : "#fca5a5";
  }

  function exportSaveCode() {
    const code = encodeSaveBundle();
    const area = $("saveCode");
    if (area) area.value = code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code)
        .then(() => setSaveStatus("已匯出並複製 Base64 存檔碼。", true))
        .catch(() => setSaveStatus("已匯出，請手動複製存檔碼。", true));
    } else {
      setSaveStatus("已匯出，請手動複製存檔碼。", true);
    }
    return code;
  }

  function importSaveCode(code, options) {
    const opts = options || {};
    try {
      const parsed = decodeSaveCode(code);
      if (!importableMetaShape(parsed.rawMeta)) {
        setSaveStatus("匯入失敗：不是有效的無盡塔防存檔。", false);
        return { ok: false, reason: "invalid-shape" };
      }
      const result = RULES.protectMetaWrite
        ? RULES.protectMetaWrite(loadRawMeta(), parsed.rawMeta)
        : { ok: true, meta: RULES.migrateMeta(parsed.rawMeta) };
      if (!result.ok) {
        setSaveStatus("匯入失敗：存檔資料含壞值，已拒絕覆蓋。", false);
        return { ok: false, reason: result.reason || "invalid-meta" };
      }
      const currentHeroesRaw = localStorage.getItem(HERO_SAVE);
      let currentHeroes = [];
      try { currentHeroes = currentHeroesRaw ? JSON.parse(currentHeroesRaw) : []; } catch { currentHeroes = []; }
      const backup = { at: Date.now(), meta: loadRawMeta(), heroes: currentHeroes };
      localStorage.setItem(SAVE_BACKUP_KEY, JSON.stringify(backup));
      localStorage.setItem(META_KEY, JSON.stringify(result.meta));
      if (Array.isArray(parsed.heroes)) {
        const validHeroes = parsed.heroes.filter((id) => hasOwn(TD.config.HEROES, id));
        ownedHeroes = new Set(validHeroes);
        saveOwned();
      }
      setSaveStatus("匯入成功，已自動備份原存檔。", true);
      if (!opts.skipReload) setTimeout(() => location.reload(), 120);
      else { renderRoster(); renderPerformanceSettings(); }
      return { ok: true, meta: result.meta };
    } catch (err) {
      setSaveStatus("匯入失敗：Base64 或 JSON 格式錯誤。", false);
      return { ok: false, reason: "decode-failed" };
    }
  }

  function renderTextSizeSettings() {
    document.querySelectorAll("[data-text-size]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.textSize === textSize);
      btn.setAttribute("aria-label", `文字大小${TEXT_SIZE_LABELS[btn.dataset.textSize] || btn.dataset.textSize}`);
    });
    const box = $("textSizeStatus");
    if (box) box.textContent = `目前文字大小：${TEXT_SIZE_LABELS[textSize] || "中"}`;
  }

  function renderPwaSettings() {
    const pwa = window.__tdPwa;
    const version = $("pwaVersion");
    const status = $("updateStatus");
    if (version) version.textContent = `版本：${pwa && pwa.version ? pwa.version : "td-r76-v1"}`;
    if (status) status.textContent = pwa && pwa.status ? pwa.status : "離線更新尚未啟用";
    if (pwa) pwa.onStatus = renderPwaSettings;
  }

  async function checkPwaUpdate() {
    const btn = $("checkUpdateBtn");
    const pwa = window.__tdPwa;
    if (!pwa || typeof pwa.checkForUpdate !== "function") {
      const status = $("updateStatus");
      if (status) status.textContent = "此環境尚未提供離線更新";
      return;
    }
    if (btn) btn.disabled = true;
    try { await pwa.checkForUpdate(); }
    finally {
      if (btn) btn.disabled = false;
      renderPwaSettings();
    }
  }

  function renderPerformanceSettings() {
    const status = TD.getPerformanceStatus ? TD.getPerformanceStatus() : { mode: "auto", quality: "high", fps: 60 };
    document.querySelectorAll("[data-perf-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.perfMode === status.mode);
    });
    const box = $("perfStatus");
    if (box) {
      const quality = status.quality === "low" ? "低特效" : "高特效";
      const reason = status.lastDowngradeLabel || status.reasonLabel || status.reason || "無";
      const particle = Math.round(((status.particleScale == null ? 1 : status.particleScale) * 100));
      const animation = Math.round(((status.animationScale == null ? 1 : status.animationScale) * 100));
      const history = (status.history || []).slice(0, 5)
        .map((item) => `${item.time || ""} ${item.type || ""}:${item.reasonLabel || item.reason || "未知"}`.trim())
        .join(" / ") || "無";
      box.textContent = `${status.modeLabel || "自動"}｜品質檔位 ${quality}｜即時 FPS ${status.fps || 60}｜最近降級原因 ${reason}｜粒子倍率 ${particle}%｜動畫倍率 ${animation}%｜最近5次 ${history}`;
    }
  }

  function renderJuiceSettings() {
    const status = TD.getJuiceSettings ? TD.getJuiceSettings() : { reducedEffects: false, audioMuted: false, audioUnlocked: false };
    const reduced = $("reducedEffectsToggle");
    const mute = $("audioMuteToggle");
    const volume = $("audioVolumeRange");
    document.documentElement.classList.toggle("reduced-effects", !!status.reducedEffects);
    if (reduced) reduced.checked = !!status.reducedEffects;
    if (mute) mute.checked = !!status.audioMuted;
    if (volume) volume.value = String(Math.round((status.audioVolume == null ? 0.8 : status.audioVolume) * 100));
    const box = $("juiceStatus");
    if (box) {
      const volumeText = Math.round((status.audioVolume == null ? 0.8 : status.audioVolume) * 100);
      box.textContent = `特效 ${status.reducedEffects ? "減量" : "完整"}，音效 ${status.audioMuted ? "靜音" : (status.audioUnlocked ? "已解鎖" : "首次操作後啟用")}，音量 ${volumeText}%`;
    }
  }

  function openSettingsOverlay() {
    if ($("settingsOverlay").classList.contains("show")) return;
    settingsWasPaused = !!TD.state().paused;
    TD.setPaused(true);
    syncPauseButton(true);
    renderPerformanceSettings();
    renderTextSizeSettings();
    renderJuiceSettings();
    renderPwaSettings();
    setSaveStatus("", true);
    showExclusiveR71Modal("settingsOverlay");
    focusSoon($("settingsClose"));
  }

  function closeSettingsOverlay() {
    hideR71Modal("settingsOverlay");
    if (!settingsWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
    focusSoon($("settingsBtn"));
  }

  function formatDate(ts) {
    try { return new Date(ts).toLocaleDateString("zh-TW"); }
    catch { return "未知日期"; }
  }

  function renderBoardTabs(meta) {
    const box = $("boardTabs"); box.innerHTML = "";
    Object.values(TD.config.DIFFICULTIES).forEach((d) => {
      const btn = document.createElement("button");
      btn.className = "progress-tab" + (selectedBoardDiff === d.id ? " active" : "");
      btn.textContent = `${d.emoji} ${d.label}`;
      btn.onclick = () => { selectedBoardDiff = d.id; renderProgressOverlay(loadMeta()); };
      box.appendChild(btn);
    });
    const mapBox = $("mapTabs");
    if (!mapBox) return;
    if (!hasOwn(TD.config.MAPS, selectedBoardMap)) selectedBoardMap = "plains";
    mapBox.innerHTML = "";
    Object.values(TD.config.MAPS).forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "progress-tab" + (selectedBoardMap === m.id ? " active" : "");
      btn.textContent = `${m.emoji} ${m.label}`;
      btn.onclick = () => { selectedBoardMap = m.id; renderProgressOverlay(loadMeta()); };
      mapBox.appendChild(btn);
    });
  }

  function renderBoardList(meta) {
    const box = $("boardList"); box.innerHTML = "";
    if (!hasOwn(TD.config.MAPS, selectedBoardMap)) selectedBoardMap = "plains";
    const diffBoard = (meta.board && meta.board[selectedBoardDiff]) || {};
    const entries = diffBoard[selectedBoardMap] || [];
    if (!entries.length) {
      const map = TD.config.MAPS[selectedBoardMap];
      box.innerHTML = `<div class="empty-state">${map ? map.label : "此地圖"}尚無紀錄。完成一局後就會列入排行榜。</div>`;
      return;
    }
    entries.forEach((entry, idx) => {
      const row = document.createElement("div");
      row.className = "board-row";
      const map = hasOwn(TD.config.MAPS, entry.map) ? TD.config.MAPS[entry.map] : null;
      const mapText = map ? ` · ${map.label}` : "";
      row.innerHTML = `
        <div class="board-rank">#${idx + 1}</div>
        <div class="board-main"><b>第 ${entry.wave} 波</b> · ${entry.score} 分<br><span class="board-sub">擊殺 ${entry.kills} 名敵人${mapText}</span></div>
        <div class="board-date">${formatDate(entry.at)}</div>`;
      box.appendChild(row);
    });
  }

  function renderAchievements(meta) {
    const box = $("achievementList"); box.innerHTML = "";
    Object.values(TD.config.ACHIEVEMENTS).forEach((ach) => {
      const unlocked = meta.achievements && meta.achievements[ach.id] === true;
      const row = document.createElement("div");
      row.className = "achievement-row" + (unlocked ? "" : " locked");
      row.innerHTML = `
        <div class="achievement-icon">${unlocked ? "✅" : "🔒"}</div>
        <div>
          <div class="achievement-name">${ach.label}</div>
          <div class="achievement-desc">${ach.desc}</div>
        </div>
        <div class="achievement-reward">+${ach.reward}💎</div>`;
      box.appendChild(row);
    });
  }

  function nextMilestoneGap(wave) {
    const milestones = [10, 20, 30];
    const target = milestones.find((m) => wave < m) || Math.ceil((wave + 1) / 10) * 10;
    return { target, gap: Math.max(0, target - wave) };
  }

  function renderRunProgress(meta) {
    const box = $("runProgress");
    if (!box) return;
    const st = TD.state();
    const wave = st.wave || 0;
    const ms = nextMilestoneGap(wave);
    const runSoul = st.runSoulEarned || 0;
    const missionSoul = st.runMissionSoulEarned || 0;
    const nextCost = gachaCostNow(meta);
    const secondHeroLine = ownedHeroes.size < 2
      ? `第二英雄 ${Math.min(TD.config.GACHA.cost, meta.soulCrystal || 0)}/${TD.config.GACHA.cost}💎`
      : `英雄 ${ownedHeroes.size}/${Object.keys(TD.config.HEROES).length}`;
    box.innerHTML = `
      <div class="rp-card"><div class="rp-label">本局進度</div><div class="rp-value">第 ${wave} 波 · 距離第 ${ms.target} 波還差 ${ms.gap} 波</div></div>
      <div class="rp-card"><div class="rp-label">本局魂晶</div><div class="rp-value">清波 +${runSoul}💎 · 任務 +${missionSoul}💎</div></div>
      <div class="rp-card"><div class="rp-label">抽英雄路徑</div><div class="rp-value">${nextCost === 0 ? "首抽免費" : secondHeroLine}</div></div>`;
  }

  function renderProgressOverlay(meta) {
    const m = meta || loadMeta();
    renderBoardTabs(m);
    renderRunProgress(m);
    renderBoardList(m);
    renderAchievements(m);
  }

  function openProgressOverlay() {
    if ($("progressOverlay").classList.contains("show")) return;
    selectedBoardDiff = TD.getDifficulty().id;
    selectedBoardMap = (TD.getMap && TD.getMap().id) || "plains";
    progressWasPaused = !!TD.state().paused;
    TD.setPaused(true);
    syncPauseButton(true);
    renderProgressOverlay();
    $("progressOverlay").classList.add("show");
    focusSoon($("progressClose"));
  }

  function closeProgressOverlay() {
    $("progressOverlay").classList.remove("show");
    if (!progressWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
    focusSoon($("boardBtn"));
  }

  function onWaveCleared(result) {
    const info = result || {};
    const reward = Math.max(0, Math.floor(Number(info.reward) || 0));
    if (reward <= 0) return;
    const meta = loadMeta();
    meta.soulCrystal += reward;
    saveMeta(meta);
    pushLog(`💎 清掉第 ${info.wave || "?"} 波，魂晶 +${reward}（持有 ${meta.soulCrystal}）`);
    refreshUI();
  }

  // ===== 遊戲結束（含 meta 結算 + 分享鉤子）=====
  function onGameOver(wave, score, run) {
    const diff = TD.getDifficulty();
    const kills = (run && run.kills) || 0;
    const settlement = RULES.settleRunRewards({
      meta: claimBeginnerMissions(),
      wave,
      score,
      kills,
      difficulty: (run && run.difficulty) || diff,
      soulEarned: (run && run.soulEarned) || 0,
    });
    const currentMap = TD.getMap ? TD.getMap() : null;
    const currentMapId = currentMap && currentMap.id;
    const boardResult = RULES.updateBoard(settlement.meta.board, diff.id, currentMapId, { wave, score, kills, at: Date.now() });
    const withBoard = Object.assign({}, settlement.meta, { board: boardResult.board });
    const heroGrowth = Array.isArray(run && run.heroGrowth) ? run.heroGrowth : [];
    const heroProgressResult = RULES.settleHeroProgress
      ? RULES.settleHeroProgress(withBoard, heroGrowth)
      : { meta: withBoard, entries: [] };
    const chronicleComplete = LORE.campaignUnlockState
      ? Object.values(LORE.campaignUnlockState({ bestWave: Math.max(wave, withBoard.bestWave || 0), clearedWave: wave, bossKills: (run && run.bossKills) || TD.state().bossKills || 0 })).every(Boolean)
      : false;
    const achievementResult = RULES.evaluateAchievements(heroProgressResult.meta, {
      wave,
      score,
      kills,
      difficultyId: diff.id,
      ownedHeroCount: ownedHeroes.size,
      totalHeroCount: Object.keys(TD.config.HEROES).length,
      chronicleComplete,
    });
    const meta = achievementResult.meta;
    const earned = settlement.earned;
    const isRecord = settlement.isRecord;
    saveMeta(meta);
    showBondToast(heroProgressResult.entries);
    const ctaCost = gachaCostNow(meta);
    const ctaAffordable = meta.soulCrystal >= ctaCost;

    $("finalWave").textContent = wave;
    $("finalScore").textContent = score;
    const metaLine = $("metaResult");
    if (metaLine) {
      // 高波數或高難度 → 強化「分享攻略」鉤子
      const isHard = diff.id !== "normal";
      const repoUrl = "https://github.com/mars-tw/tower-defense-skill";
      const shareText = `我在「無盡塔防」${diff.label}難度撐到第 ${wave} 波！得分 ${score} 🏰`;
      const rankLine = boardResult.rank
        ? `<div class="rank-line">🏆 本場第 ${boardResult.rank} 名！</div>`
        : '<div class="meta-sub">這場未進榜，再調整塔陣挑戰前 10 名。</div>';
      const unlockLine = achievementResult.unlocked.length
        ? `<div class="unlock-list">${achievementResult.unlocked.map((ach) => `<div>🎖️ 解鎖「${ach.label}」 +${ach.reward}💎</div>`).join("")}</div>`
        : '<div class="meta-sub">本場沒有新成就。</div>';
      const progressById = Object.fromEntries((heroProgressResult.entries || []).map((entry) => [entry.id, entry]));
      const heroGrowthLine = heroGrowth.length
        ? `<div class="hero-growth"><div class="hg-title">本局英雄成長</div>${heroGrowth.map((item) => {
          const def = TD.config.HEROES[item.id] || {};
          const xp = Math.max(0, Math.round(item.xp || item.runXp || 0));
          const level = Math.max(1, Math.round(item.level || 1));
          const up = Math.max(0, Math.round(item.levelsGained || 0));
          const long = progressById[item.id];
          const longText = long ? `｜長線 +${long.savedXp} XP｜羈絆 Lv.${long.newLevel}${long.levelGained ? `（+${long.levelGained}）` : ""}` : "";
          const bonusText = long && long.bonus ? `｜攻血 +${Math.round(long.bonus * 100)}%` : "";
          return `<div>${def.name || item.id}：+${xp} XP，Lv.${level}${up ? `（升 ${up} 級）` : ""}${longText}${bonusText}</div>`;
        }).join("")}</div>`
        : "";
      const learning = RULES.analyzeRunReport
        ? RULES.analyzeRunReport({ wave, kills, leaks: run && run.leaks, towers: run && run.towers })
        : null;
      const learningLine = learning
        ? `<div class="run-review"><div class="rr-title">本局檢討</div><b>${learning.summary}</b>${learning.adjustments.map((item) => `<div>下一局：${item}</div>`).join("")}</div>`
        : "";
      metaLine.innerHTML = `
        <div class="diff-tag" style="color:${diff.color}">${diff.emoji} ${diff.label}難度</div>
        ${rankLine}
        ${isRecord ? '<div class="record">🎉 新紀錄！</div>' : `<div>此難度最高：第 ${meta.bestByDiff[diff.id]} 波</div>`}
        <div>💎 本局清波已獲得 +${earned}（目前 ${meta.soulCrystal}）</div>
        ${unlockLine}
        ${heroGrowthLine}
        ${learningLine}
        <div class="hook">${isHard || wave >= 10 ? "覺得難？" : ""}<b>分享你的攻略</b>，讓大家膜拜你的塔陣！</div>
        <div class="share-row">
          <button class="share-btn" id="copyResult">📋 複製戰績</button>
          <a class="share-btn" href="${repoUrl}/discussions" target="_blank">💬 發攻略</a>
        </div>`;
      // 複製戰績
      setTimeout(() => {
        const cp = $("copyResult");
        if (cp) cp.onclick = () => {
          try { navigator.clipboard.writeText(shareText + " " + repoUrl); cp.textContent = "✓ 已複製！"; }
          catch { cp.textContent = "（請手動複製）"; }
        };
      }, 0);
    }
    const deathCta = $("deathCtaBtn");
    if (deathCta) {
      if (ctaAffordable) {
        deathCta.textContent = ctaCost === 0 ? "立即抽英雄（免費）" : "立即抽英雄";
        deathCta.onclick = () => {
          deathCta.blur();
          doGacha({
            doneLabel: "帶英雄再開局",
            onDone: restartRun,
          });
        };
      } else {
        deathCta.textContent = `清波賺魂晶再抽（差 ${ctaCost - meta.soulCrystal} 💎）`;
        deathCta.onclick = () => { deathCta.blur(); restartRun(); };
      }
    }
    $("overlay").classList.add("show");
    $("overlay").scrollTop = 0; // R75.1（Grok R75-08）：每次開啟結算都從頂部開始，前次捲動位置不殘留
    focusSoon($("deathCtaBtn"));
  }

  // ===== 綁定控制 =====
  $("startBtn").title = "Enter：開始下一波";
  $("speed2").title = "T：切換 1× / 2×";
  $("pauseBtn").title = "Space / P：暫停或繼續";
  $("gachaBtn").title = "H：抽英雄";
  function hideWaveWarning() {
    const box = $("waveWarning");
    if (box) box.classList.remove("show");
  }

  function showWaveWarning(warning) {
    const box = $("waveWarning");
    if (!box || !warning) return;
    const serial = ++warningSerial;
    box.textContent = `⚠️ ${warning.message}`;
    box.classList.add("show");
    setTimeout(() => {
      if (serial === warningSerial) box.classList.remove("show");
    }, 2600);
  }

  function startWaveWithAdvisor() {
    const p = TD.previewNextWave ? TD.previewNextWave({ advisorMode }) : null;
    if (p && p.counterWarning) showWaveWarning(p.counterWarning);
    else hideWaveWarning();
    // R75 B-02：>40 波預告詞只進戰報 log，不佔 banner/情報卡（裁決縮幅版）。
    if (p && LORE.waveHeraldFor) {
      const herald = LORE.waveHeraldFor(p.wave, p.event && p.event.id, p.isBoss);
      if (herald && herald.channel === "log") pushLog(`📯 ${herald.text}`);
    }
    TD.startWave();
    refreshUI();
  }

  $("startBtn").onclick = () => { startWaveWithAdvisor(); };
  $("goddessBtn").onclick = () => { TD.upgradeGoddess(); refreshUI(); };
  $("gachaBtn").onclick = () => { $("gachaBtn").blur(); doGacha(); };
  $("boardBtn").onclick = () => { openProgressOverlay(); };
  $("codexBtn").onclick = () => { openCodexOverlay(); };
  $("settingsBtn").onclick = () => { openSettingsOverlay(); };
  $("progressClose").onclick = () => { closeProgressOverlay(); };
  $("codexClose").onclick = () => { closeCodexOverlay(); };
  $("settingsClose").onclick = () => { closeSettingsOverlay(); };
  if ($("skillCancelBtn")) {
    $("skillCancelBtn").onclick = () => {
      TD.cancelSelect();
      if (TD.playSfx) TD.playSfx("ui");
      refreshUI();
    };
  }
  $("heroDetailClose").onclick = () => { closeHeroDetail(); };
  $("restartBtn").onclick = restartRun;
  $("mainMenuBtn").onclick = returnToMainMenu;
  $("upgBtn").onclick = () => { TD.upgradeSelected(); refreshUI(); };
  // R73：高價塔（Lv≥3 或回收 ≥90G）賣出改按鈕內二段確認，低價塔直賣不拖節奏
  let sellConfirmTimer = null;
  $("sellBtn").onclick = () => {
    const btn = $("sellBtn");
    const st = TD.state();
    const tw = st && st.selectedTower;
    if (!tw) return;
    const refund = Math.round(TD.config.TOWERS[tw.type].cost * 0.6 * tw.level);
    const needsConfirm = tw.level >= 3 || refund >= 90;
    if (needsConfirm && btn.dataset.confirming !== "1") {
      btn.dataset.confirming = "1";
      btn.dataset.origText = btn.textContent;
      btn.textContent = `確認賣出 +${refund}G`;
      clearTimeout(sellConfirmTimer);
      sellConfirmTimer = setTimeout(() => {
        delete btn.dataset.confirming;
        btn.textContent = btn.dataset.origText || "賣出";
      }, 2500);
      return;
    }
    clearTimeout(sellConfirmTimer);
    if (btn.dataset.confirming === "1") { delete btn.dataset.confirming; btn.textContent = btn.dataset.origText || "賣出"; }
    TD.sellSelected(); refreshUI();
  };
  $("exportSaveBtn").onclick = () => { exportSaveCode(); };
  $("importSaveBtn").onclick = () => { importSaveCode(($("saveCode") && $("saveCode").value) || ""); };
  document.querySelectorAll("[data-perf-mode]").forEach((btn) => {
    btn.onclick = () => {
      if (TD.setPerformanceMode) TD.setPerformanceMode(btn.dataset.perfMode);
      renderPerformanceSettings();
    };
  });
  document.querySelectorAll("[data-text-size]").forEach((btn) => {
    btn.onclick = () => setTextSize(btn.dataset.textSize);
  });
  if ($("reducedEffectsToggle")) {
    $("reducedEffectsToggle").onchange = (ev) => {
      if (TD.setReducedEffects) TD.setReducedEffects(!!ev.target.checked);
      renderJuiceSettings();
    };
  }
  if ($("audioMuteToggle")) {
    $("audioMuteToggle").onchange = (ev) => {
      if (TD.setAudioMuted) TD.setAudioMuted(!!ev.target.checked);
      renderJuiceSettings();
    };
  }
  if ($("audioVolumeRange")) {
    $("audioVolumeRange").oninput = (ev) => {
      if (TD.setAudioVolume) TD.setAudioVolume(Number(ev.target.value) / 100);
      renderJuiceSettings();
    };
  }
  if ($("checkUpdateBtn")) $("checkUpdateBtn").onclick = () => { checkPwaUpdate(); };
  document.querySelectorAll(".speed").forEach((b) => {
    b.onclick = () => {
      TD.setSpeed(Number(b.dataset.s));
      document.querySelectorAll(".speed").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  // D10 暫停按鈕 + 鍵盤（空白鍵暫停、Esc 取消選取）。
  // 抽卡盲盒開著時忽略暫停熱鍵：動畫期間是強制暫停，玩家再按 P/空白鍵切換會讓
  // playGachaAnimation 記錄的 wasPaused 對不上，關閉浮層後戰場暫停狀態錯亂
  $("pauseBtn").onclick = () => {
    if (isBlockingOverlayOpen()) return;
    const paused = TD.togglePause();
    syncPauseButton(paused);
  };
  function clickIfReady(btn) {
    if (btn && !btn.disabled) btn.click();
  }
  function isShortcutKey(e) {
    const key = (e.key || "").toLowerCase();
    return !!(TOWER_BY_KEY[e.key] || SKILL_BY_KEY[key] ||
      e.code === "Enter" || e.code === "Space" ||
      e.code === "Escape" || key === "p" || key === "h" || key === "t");
  }
  document.addEventListener("keydown", (e) => {
    if (isTextEntryTarget(e.target)) return;
    if (isShown("heroDetailOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeHeroDetail(); }
      else if (e.code !== "Tab") e.preventDefault();
      return;
    }
    if (isShown("tutorial")) {
      if (e.code === "Escape") { e.preventDefault(); closeTutorialOverlay({ markSeen: true, showDifficulty: tutorialFirstRun }); }
      else if (e.code !== "Tab") { e.preventDefault(); }
      return;
    }
    if (isShown("settingsOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeSettingsOverlay(); }
      else if (e.code !== "Tab") e.preventDefault();
      return;
    }
    if (isShown("progressOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeProgressOverlay(); }
      else if (e.code !== "Tab") { e.preventDefault(); }
      return;
    }
    if (isShown("codexOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeCodexOverlay(); }
      else if (e.code !== "Tab") { e.preventDefault(); }
      return;
    }
    if (isBlockingOverlayOpen()) {
      if (isShortcutKey(e)) e.preventDefault();
      return;
    }

    const key = e.key || "";
    const lower = key.toLowerCase();
    if (e.code === "Space" || lower === "p") {
      e.preventDefault();
      $("pauseBtn").click();
    } else if (e.code === "Escape") {
      e.preventDefault();
      TD.cancelSelect();
    } else if (TOWER_BY_KEY[key]) {
      e.preventDefault();
      clickIfReady(document.querySelector(`.tower-btn[data-type="${TOWER_BY_KEY[key]}"]`));
    } else if (SKILL_BY_KEY[lower]) {
      e.preventDefault();
      clickIfReady(document.querySelector(`.skill-btn[data-skill="${SKILL_BY_KEY[lower]}"]`));
    } else if (e.code === "Enter") {
      e.preventDefault();
      clickIfReady($("startBtn"));
    } else if (lower === "t") {
      e.preventDefault();
      clickIfReady($(TD.state().speed === 2 ? "speed1" : "speed2"));
    } else if (lower === "h") {
      e.preventDefault();
      clickIfReady($("gachaBtn"));
    }
  });

  // 把回呼掛給 game.js
  window.__tdUI = refreshUI;
  window.__tdLog = pushLog;
  window.__tdWaveCleared = onWaveCleared;
  window.__tdGameOver = onGameOver;
  window.__tdStartWaveWithAdvisor = startWaveWithAdvisor;
  window.__tdSafeSaveMeta = saveMeta;
  window.__tdPerformanceChanged = renderPerformanceSettings;
  window.__tdSaveManager = {
    export: exportSaveCode,
    import: importSaveCode,
    encode: encodeSaveBundle,
    decode: decodeSaveCode,
    backupKey: SAVE_BACKUP_KEY,
  };
  window.__tdSettings = {
    setTextSize,
    getTextSize: () => textSize,
    renderPwaSettings,
  };
  if (TD.drainIntroLogs) {
    const intro = TD.drainIntroLogs();
    drainedIntroCount = intro.length;
    intro.forEach((msg) => pushLog(msg));
  }

  function handleRuntimeFault() {
    saveMeta(loadMeta());
    showRecoveryNotice("遊戲遇到錯誤，已保護存檔。重新整理即可繼續。");
  }
  window.onerror = () => { handleRuntimeFault(); return false; };
  window.addEventListener("error", () => { handleRuntimeFault(); });
  window.addEventListener("unhandledrejection", () => { handleRuntimeFault(); });

  // 首次遊玩引導（D3）：只顯示一次，存 localStorage
  // 各難度的最高紀錄（meta 依難度分開存）
  function bestForDiff(diffId) {
    const m = loadMeta();
    return (m.bestByDiff && m.bestByDiff[diffId]) || 0;
  }

  function finishR72MapLoading(serial) {
    if (serial !== r72LoadingSerial) return;
    const overlay = $("mapLoadingOverlay");
    if (!overlay || !overlay.classList.contains("show")) return;
    overlay.setAttribute("aria-busy", "false");
    r72Mark("r72-loading-close");
    hideR71Modal("mapLoadingOverlay");
    focusSoon($("startBtn"));
  }

  function beginR72MapRun(mapDef) {
    const m = mapDef && hasOwn(TD.config.MAPS, mapDef.id) ? mapDef : TD.config.MAPS.plains;
    const serial = ++r72LoadingSerial;
    const quality = r72QualityTier();
    const overlay = $("mapLoadingOverlay");
    const image = $("mapLoadingImage");
    const title = $("mapLoadingTitle");
    const desc = $("mapLoadingDesc");
    const status = $("mapLoadingStatus");
    const source = r72AssetFor(m.id, "loading", quality);

    TD.setMap(m.id);
    const nextMeta = loadMeta();
    nextMeta.lastMap = m.id;
    saveMeta(nextMeta);

    title.textContent = m.label;
    desc.textContent = m.desc;
    status.textContent = "正在展開既有戰場圖資…";
    overlay.dataset.mapId = m.id;
    overlay.dataset.quality = quality;
    overlay.dataset.r72VisualReady = "false";
    overlay.removeAttribute("data-r72-visual-error");
    overlay.setAttribute("aria-busy", "true");
    image.dataset.mapId = m.id;
    image.dataset.quality = quality;
    image.alt = `${m.label}戰場圖`;
    image.removeAttribute("src");

    r72Mark("r72-loading-open");
    showExclusiveR71Modal("mapLoadingOverlay");
    image.src = source;

    // 遊戲狀態同步初始化，loading 只負責視覺轉場，不改玩法或數值時序。
    TD.newGame();
    deployedThisGame = new Set();
    renderRoster();
    const best = $("bestWave"); if (best) best.textContent = bestForDiff(TD.getDifficulty().id);
    refreshUI();

    const minimumDisplay = new Promise((resolve) => setTimeout(resolve, 2400));
    const visualReady = r72ImageReady(image).then(() => {
      if (serial !== r72LoadingSerial) return;
      overlay.dataset.r72VisualReady = "true";
      status.textContent = "路徑確認完成";
      r72Mark("r72-loading-visual-ready");
      r72Measure("r72-loading-visual-duration", "r72-loading-open", "r72-loading-visual-ready");
    });
    Promise.all([minimumDisplay, visualReady]).then(() => finishR72MapLoading(serial)).catch((error) => {
      if (serial !== r72LoadingSerial) return;
      overlay.dataset.r72VisualReady = "false";
      overlay.dataset.r72VisualError = error.message;
      status.textContent = "圖資載入失敗，已保留遊戲狀態";
      minimumDisplay.then(() => finishR72MapLoading(serial));
    });
    // 3 秒是硬閘；超時只解除 UI 鎖，測試仍會因 visualReady=false 失敗。
    setTimeout(() => finishR72MapLoading(serial), 2950);
  }

  // R73：抽屜開閉記憶——依斷點桶與 PWA 版本記憶；矮視口首次預設收合戰況情報
  function setupDrawerMemory() {
    const drawers = document.querySelectorAll(".panel-drawer");
    if (!drawers.length) return;
    const bucket = (window.innerWidth <= 900 ? "m" : "d") + (window.innerHeight <= 640 ? "-short" : "");
    const key = `td_drawers:${bucket}:${typeof PWA_CACHE_VERSION !== "undefined" ? PWA_CACHE_VERSION : "v"}`;
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { saved = null; }
    drawers.forEach((d) => {
      const id = d.className.match(/(intel|hero|utility)-drawer/);
      const name = id ? id[1] : "";
      if (!name) return;
      if (saved && typeof saved[name] === "boolean") d.toggleAttribute("open", saved[name]);
      else if (name === "intel" && window.innerHeight <= 640 && window.innerWidth > 900) d.removeAttribute("open");
      d.addEventListener("toggle", () => {
        const state = {};
        document.querySelectorAll(".panel-drawer").forEach((x) => {
          const mm = x.className.match(/(intel|hero|utility)-drawer/);
          if (mm) state[mm[1]] = x.hasAttribute("open");
        });
        try { localStorage.setItem(key, JSON.stringify(state)); } catch (e) {}
      });
    });
  }
  setupDrawerMemory();

  function renderMaps() {
    const box = $("mapOptions"); if (!box) return;
    box.innerHTML = "";
    box.dataset.r72VisualReady = "false";
    delete box.dataset.r72VisualError;
    const meta = loadMeta();
    const lastMap = hasOwn(TD.config.MAPS, meta.lastMap) ? meta.lastMap : (TD.getMap && TD.getMap().id);
    const quality = r72QualityTier();
    Object.values(TD.config.MAPS).forEach((m) => {
      const opt = document.createElement("button");
      opt.className = "map-opt" + (m.id === lastMap ? " active" : "");
      opt.dataset.mapId = m.id;
      opt.dataset.quality = quality;
      opt.style.setProperty("--map-accent", (R72_MAP_VISUALS[m.id] || R72_MAP_VISUALS.plains).accent);
      const goldText = m.goldMul === 1 ? "標準資源" : `資源 ${Math.round(m.goldMul * 100)}%`;
      const mapLore = LORE.mapLoreFor ? LORE.mapLoreFor(m.id) : null;
      const loreText = mapLore && Array.isArray(mapLore.lines) ? mapLore.lines.slice(0, 2).join(" ") : "";
      opt.innerHTML = `
        <span class="map-visual" data-focal-box="0.10,0.27,0.80,0.46">
          <img src="${r72AssetFor(m.id, "banner", quality)}" alt="${m.label}既有地圖路徑預覽" width="640" height="320" loading="eager" fetchpriority="high" draggable="false" data-map-id="${m.id}" data-quality="${quality}">
          <span class="map-route-tag">${m.id.toUpperCase()} · ${quality.toUpperCase()}</span>
        </span>
        <span class="dinfo">
          <span class="dname">${m.label}</span>
          <span class="ddesc">${m.desc}</span>
          ${loreText ? `<span class="ddesc">${loreText}</span>` : ""}
          <span class="dbest">${goldText} · 路徑節點 ${m.path.length}</span>
        </span>`;
      opt.onclick = () => beginR72MapRun(m);
      // R73（P2 清償）：底部風味文案跟隨聚焦/懸停的地圖
      const hintEl = $("mapHint");
      if (hintEl) {
        const loreLine = mapLore && Array.isArray(mapLore.lines) && mapLore.lines[0] ? `${m.label}——${mapLore.lines[0]}` : "";
        const showLore = () => { if (loreLine) hintEl.textContent = loreLine; };
        const reset = () => { hintEl.textContent = hintEl.dataset.default || hintEl.textContent; };
        opt.addEventListener("mouseenter", showLore);
        opt.addEventListener("focus", showLore);
        opt.addEventListener("mouseleave", reset);
        opt.addEventListener("blur", reset);
      }
      box.appendChild(opt);
    });
    const serial = ++r72SelectorSerial;
    watchR72SelectorImages(box, serial);
  }
  // 渲染難度選擇
  function renderDifficulties() {
    const box = $("diffOptions"); box.innerHTML = "";
    Object.values(TD.config.DIFFICULTIES).forEach((d) => {
      const best = bestForDiff(d.id);
      const opt = document.createElement("button");
      opt.className = "diff-opt"; opt.style.setProperty("--diff-c", d.color);
      opt.innerHTML = `
        <span class="demoji">${d.emoji}</span>
        <span class="dinfo">
          <span class="dname">${d.label}</span>
          <span class="ddesc">${d.desc}</span>
          ${best > 0 ? `<span class="dbest">🏆 你的最高：第 ${best} 波</span>` : ""}
        </span>`;
      opt.onclick = () => {
        TD.setDifficulty(d.id);
        try { localStorage.setItem("td_difficulty", d.id); } catch {}
        hideR71Modal("diffOverlay");
        r72Mark("r72-map-select-open");
        renderMaps();
        showExclusiveR71Modal("mapOverlay");
        focusSoon(document.querySelector(".map-opt"));
        const el = $("bestWave"); if (el) el.textContent = bestForDiff(d.id);
        refreshUI();
      };
      box.appendChild(opt);
    });
  }

  (function restorePrefs() {
    try {
      const savedDiff = localStorage.getItem("td_difficulty");
      if (savedDiff) TD.setDifficulty(savedDiff);
    } catch {}
    const meta = loadMeta();
    if (meta.lastMap && TD.setMap) TD.setMap(meta.lastMap);
    selectedBoardDiff = TD.getDifficulty().id;
  })();

  function markTutorialSeen() {
    try { localStorage.setItem("td_tutorial_seen", "1"); } catch {}
  }

  function renderTutorialStep() {
    const step = TUTORIAL_STEPS[Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, tutorialStepIndex))];
    const title = $("tutorialTitle");
    const progress = $("tutorialProgress");
    const content = $("tutorialStep");
    const tip = $("tutorialTip");
    if (title) title.textContent = `🏰 ${step.title}`;
    if (progress) progress.textContent = `${tutorialStepIndex + 1} / ${TUTORIAL_STEPS.length}`;
    if (content) {
      content.innerHTML = `
        <div class="tutorial-step-title">${step.title}</div>
        <div class="tutorial-step-body">${step.body}</div>`;
    }
    if (tip) tip.textContent = step.tip;
    const prev = $("tutorialPrev");
    const next = $("tutorialNext");
    if (prev) prev.disabled = tutorialStepIndex <= 0;
    if (next) next.textContent = tutorialStepIndex >= TUTORIAL_STEPS.length - 1 ? "完成" : "下一步";
  }

  function openTutorialOverlay(options) {
    const opts = options || {};
    tutorialFirstRun = !!opts.firstRun;
    tutorialStepIndex = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, Number(opts.step) || 0));
    const st = TD.state();
    const shouldPauseRun = !tutorialFirstRun && (st.running || st.wave > 0 || st.enemies.length > 0 || st.spawnQueue.length > 0);
    tutorialWasPaused = !!st.paused;
    if (shouldPauseRun) {
      TD.setPaused(true);
      syncPauseButton(true);
    }
    renderTutorialStep();
    showExclusiveR71Modal("tutorial");
    focusSoon($("tutorialNext"));
  }

  function closeTutorialOverlay(opts) {
    const options = opts || {};
    hideR71Modal("tutorial");
    if (options.markSeen) markTutorialSeen();
    if (!tutorialWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
    if (tutorialFirstRun && options.showDifficulty) {
      renderDifficulties();
      showExclusiveR71Modal("diffOverlay");
      focusSoon(document.querySelector(".diff-opt"));
    } else {
      focusSoon($("tutorialBtn") || $("settingsBtn"));
    }
    tutorialFirstRun = false;
  }

  function startQuickTutorialRun() {
    closeTutorialOverlay({ markSeen: true });
    TD.setDifficulty("normal");
    try { localStorage.setItem("td_difficulty", "normal"); } catch {}
    beginR72MapRun(TD.config.MAPS.plains);
  }

  function openAdvancedAfterTutorial() {
    closeTutorialOverlay({ markSeen: true });
    renderDifficulties();
    showExclusiveR71Modal("diffOverlay");
    focusSoon(document.querySelector(".diff-opt"));
  }

  function bindTutorialControls() {
    $("tutorialPrev").onclick = () => {
      tutorialStepIndex = Math.max(0, tutorialStepIndex - 1);
      renderTutorialStep();
    };
    $("tutorialNext").onclick = () => {
      if (tutorialStepIndex >= TUTORIAL_STEPS.length - 1) {
        if (tutorialFirstRun) closeTutorialOverlay({ markSeen: true, showDifficulty: true });
        else closeTutorialOverlay({ markSeen: true });
        return;
      }
      tutorialStepIndex++;
      renderTutorialStep();
    };
    $("tutorialClose").onclick = () => closeTutorialOverlay({ markSeen: true, showDifficulty: tutorialFirstRun });
    $("tutorialQuick").onclick = startQuickTutorialRun;
    $("tutorialAdvanced").onclick = openAdvancedAfterTutorial;
    if ($("tutorialBtn")) $("tutorialBtn").onclick = () => openTutorialOverlay({ firstRun: false });
    if ($("tutorialSettingsBtn")) $("tutorialSettingsBtn").onclick = () => {
      closeSettingsOverlay();
      openTutorialOverlay({ firstRun: false });
    };
  }

  (function setupTutorial() {
    bindTutorialControls();
    let seen = false;
    const currentMeta = loadMeta();
    const hasSave = (currentMeta.games || 0) > 0 || (currentMeta.bestWave || 0) > 0 || (currentMeta.gachaCount || 0) > 0 || (currentMeta.totalKills || 0) > 0 || (currentMeta.soulCrystal || 0) > 0;
    try { seen = localStorage.getItem("td_tutorial_seen") === "1"; } catch {}
    if (!seen && !hasSave) {
      openTutorialOverlay({ firstRun: true });
    } else {
      // 看過引導：直接顯示難度選擇
      renderDifficulties(); showExclusiveR71Modal("diffOverlay");
      focusSoon(document.querySelector(".diff-opt"));
    }
  })();

  // 顯示歷史最高波數（D1 meta）
  (function showBest() {
    const m = loadMeta();
    const el = $("bestWave"); if (el) el.textContent = m.bestWave;
  })();

  // R63 自動化驗收場景只呈現戰場，避免首次進入流程遮住動畫證據。
  if (new URLSearchParams(window.location.search).get("r63Evidence")) {
    ["tutorial", "diffOverlay", "mapOverlay", "mapLoadingOverlay"].forEach((id) => {
      const overlay = $(id);
      if (overlay) overlay.classList.remove("show");
    });
  }

  // R64：手機只保留抽屜入口；展開一個抽屜時自動收起其他抽屜。
  const panelDrawers = [...document.querySelectorAll(".panel-drawer")];
  if (window.matchMedia("(max-width: 900px)").matches) panelDrawers.forEach((drawer) => { drawer.open = false; });
  panelDrawers.forEach((drawer) => {
    drawer.addEventListener("toggle", () => {
      if (drawer.open && window.matchMedia("(max-width: 900px)").matches) {
        panelDrawers.forEach((other) => { if (other !== drawer) other.open = false; });
      }
      requestAnimationFrame(() => {
        syncAdvisorGeometry();
        syncR71ModalState();
      });
    });
  });

  const stage = $("battlefieldStage");
  if (stage && typeof ResizeObserver === "function") {
    const canvasFitObserver = new ResizeObserver(() => fitCanvasToStage());
    canvasFitObserver.observe(stage);
    const host = $("battlefieldScroll");
    if (host) canvasFitObserver.observe(host);
  }
  window.addEventListener("resize", () => {
    fitCanvasToStage();
    syncAdvisorGeometry(); // R75：視口/方向變更即重算抽屜 safe-bottom 與可用高度
    syncR71ModalState();
  }, { passive: true });
  window.addEventListener("orientationchange", () => {
    // R75：部分瀏覽器 orientationchange 當下 innerHeight 尚未更新，下一幀再量。
    requestAnimationFrame(() => {
      fitCanvasToStage();
      syncAdvisorGeometry();
      syncR71ModalState();
    });
  }, { passive: true });
  // R75.1（Grok R75-04）：行動瀏覽器網址列收合/軟鍵盤常只觸發 visualViewport resize、
  // 不觸發 window resize——補掛，抽屜幾何跟實際可視視口走；開機寫入見 init 段 syncAdvisorGeometry()。
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      syncAdvisorGeometry();
    }, { passive: true });
  }
  const battlefieldScroll = $("battlefieldScroll");
  if (battlefieldScroll) battlefieldScroll.addEventListener("scroll", refreshScenePositions, { passive: true });
  fitCanvasToStage();

  renderRoster();
  refreshUI();
  window.__tdR72MapVisual = {
    assets: R72_MAP_VISUALS,
    qualityTier: r72QualityTier,
    beginMapRun: beginR72MapRun,
  };
  syncAdvisorGeometry();
  syncR71ModalState();
  if (!drainedIntroCount) pushLog("放置砲塔、抽英雄上場守護女神！火克冰、冰克雷、雷克火。");
})();
