/* =========================================================================
 * game.js — 塔防核心引擎（Canvas 2D，純原生，無盡波次）
 *
 * 架構：
 *   - 固定時間步的遊戲迴圈（requestAnimationFrame + dt）
 *   - 路徑用一串 waypoint，敵人沿路徑行進，漏過終點扣生命
 *   - 塔放在格位上，自動瞄準射程內敵人發射子彈
 *   - 無盡波次：每波難度遞增、隨機組成，每 N 波出 Boss
 *   - 主動技能：點技能 → 進入瞄準 → 點地圖施放
 * ========================================================================= */

(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const CELL = GAME.cellSize;
  function usePixelArt(drawCtx) {
    if (!drawCtx) return;
    drawCtx.imageSmoothingEnabled = false;
    drawCtx.webkitImageSmoothingEnabled = false;
    drawCtx.mozImageSmoothingEnabled = false;
  }
  usePixelArt(ctx);

  // 依目前地圖即時計算「禁止建塔」的格位（路徑經過的格）
  const blocked = new Set();
  function cellKey(cx, cy) { return cx + "," + cy; }
  function cellCenter(cx, cy) {
    return { x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2 };
  }
  function buildableReachData(range) {
    const cols = state && state.map ? state.map.cols : Math.ceil(W / CELL);
    const rows = state && state.map ? state.map.rows : Math.ceil(H / CELL);
    const safeRange = Math.max(0, Number(range) || 0);
    const key = `${state ? state.mapId : "map"}:${state && state.affix ? state.affix.id : "none"}:${cols}x${rows}:${Math.round(safeRange * 100)}`;
    if (state && state.buildableReachCache && state.buildableReachCache.key === key) return state.buildableReachCache;
    const cells = {};
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const p = cellCenter(cx, cy);
        const distance = TDRules.distanceToPath(p.x, p.y, state.path);
        cells[cellKey(cx, cy)] = { distance, reachable: distance <= safeRange + 1e-9 };
      }
    }
    const cache = { key, cells };
    if (state) state.buildableReachCache = cache;
    return cache;
  }
  function cellReachInfo(cx, cy, range) {
    if (!state || !state.path) return { distance: Infinity, reachable: false };
    const cache = buildableReachData(range);
    return cache.cells[cellKey(cx, cy)] || { distance: Infinity, reachable: false };
  }
  function canCellReachPath(cx, cy, range) {
    return cellReachInfo(cx, cy, range).reachable;
  }
  function markPathCells(path, mapDef) {
    blocked.clear();
    const shared = TDRules.mapBlockedCells ? TDRules.mapBlockedCells(mapDef || getMap(), CELL) :
      TDRules.pathBlockedCells ? TDRules.pathBlockedCells(path, CELL) : new Set();
    for (const key of shared) blocked.add(key);
  }

  // ===== 遊戲狀態 =====
  let state;
  // Control preference belongs to the device, rather than a particular run.
  let touchControlMode = false;
  // Physics always advances at 60 Hz; rendering follows the display refresh rate.
  // Only this scheduler owns RAF. Debug/manual simulations can still hold running
  // without starting the live scheduler (used by the existing balance harness).
  const FIXED_STEP = 1 / 60;
  const MAX_FRAME_DELTA = 0.1;
  const MAX_FRAME_STEPS = 18;
  let lastT = null;
  let frameAccumulator = 0;
  let liveLoopActive = false;
  let visualClock = 0;
  let sceneAssetVersion = 0;
  const engineMetrics = { frames: 0, steps: 0, lastSteps: 0, droppedSeconds: 0, backgroundBakes: 0, pathBakes: 0, guideBakes: 0, placementBakes: 0,
    navWarmups: 0, navWarmupMs: 0, navQueries: 0, navQueryMs: 0, navQueryMaxMs: 0, navQueryFailures: 0 };
  let uiRefreshScheduled = false;
  let reducedFlashCache;
  let forceEnemyAtlasFallback = false;
  let reducedEffectsCache;
  let audioMutedCache;
  let audioVolumeCache;
  const MAX_PARTICLES = 220;
  const MAX_TEXT_PARTICLES = 42;
  const MAX_COIN_PARTICLES = 8;
  const MAX_RING_PARTICLES = 14;
  const MAX_ACTIVE_SFX = 10;
  const SFX_MIN_GAP = { fire: 0.024, hit: 0.018, kill: 0.035, wave: 0.12, boss: 0.22, leak: 0.12, build: 0.06, skill: 0.10, ui: 0.04 };
  const SFX_PRIORITY = { fire: 0, hit: 0, kill: 0, build: 1, ui: 1, wave: 2, skill: 2, boss: 3, leak: 3 };
  const PARTICLE_PRIORITY = { decor: 0, text: 1, warning: 3 };
  const FX_TEXTURES = {
    fire: "assets/particles/kenney-fire.png",
    smoke: "assets/particles/kenney-smoke.png",
    flash: "assets/particles/kenney-flash.png",
    magic: "assets/particles/kenney-magic.png",
    spark: "assets/particles/kenney-spark.png",
    ice: "assets/particles/kenney-ice-ring.png",
  };
  const MAX_HIT_FRAME_CACHE = 96;
  const MAX_PROJECTILE_SPRITE_CACHE = 64;
  const hitFrameCache = new Map();
  const projectileSpriteCache = new Map();
  let buildMagnifierFrame = null; // One 3×3-cell crop, reused only while a finger is active.
  const TOWER_PRIORITIES = Object.freeze({ auto: "預設", first: "最前", boss: "Boss", strong: "高血量" });
  let pathGuideVisible = true;
  try { pathGuideVisible = localStorage.getItem("td_path_guide") !== "0"; } catch {}
  function getPathGuideVisible() { return pathGuideVisible; }
  function setPathGuideVisible(value) {
    pathGuideVisible = !!value;
    try { localStorage.setItem("td_path_guide", pathGuideVisible ? "1" : "0"); } catch {}
    if (state) { render(); notifyUI(true); }
    return pathGuideVisible;
  }
  const HERO_NAV_CELL = 24, HERO_NAV_RADIUS = 8;
  const MAP_VISUALS = {
    plains: { ground: "#53644a", tint: "transparent", breath: "transparent", detail: "illustrated-earth" },
    canyon: { ground: "#b5996b", tint: "transparent", breath: "transparent", detail: "illustrated-sandstone" },
    lava: { ground: "#47484d", tint: "transparent", breath: "transparent", detail: "illustrated-basalt" },
  };
  function reducedFlashEnabled() {
    if (reducedFlashCache !== undefined) return reducedFlashCache;
    try {
      reducedFlashCache = localStorage.getItem("td_reduced_flash") === "1" ||
        localStorage.getItem("td_reduced_effects") === "1" ||
        localStorage.getItem("td_reducedFlash") === "1" ||
        localStorage.getItem("reducedFlash") === "1" ||
        (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch { reducedFlashCache = false; }
    return reducedFlashCache;
  }
  function reducedEffectsEnabled() {
    if (reducedEffectsCache !== undefined) return reducedEffectsCache;
    try {
      reducedEffectsCache = localStorage.getItem("td_reduced_effects") === "1" ||
        (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch { reducedEffectsCache = false; }
    return reducedEffectsCache;
  }
  function setReducedEffects(v) {
    reducedEffectsCache = !!v;
    reducedFlashCache = !!v;
    if (v && state) {
      state.particles = [];
      state.redVignette = 0;
      state.slowMoLeft = 0;
      state.fxTimeScale = 1;
    }
    try {
      localStorage.setItem("td_reduced_effects", v ? "1" : "0");
      localStorage.setItem("td_reduced_flash", v ? "1" : "0");
    } catch {}
    document.documentElement.classList.toggle("reduced-effects", !!v);
    return getJuiceSettings();
  }
  function audioMuted() {
    if (audioMutedCache !== undefined) return audioMutedCache;
    try { audioMutedCache = localStorage.getItem("td_audio_muted") === "1"; }
    catch { audioMutedCache = false; }
    return audioMutedCache;
  }
  function setAudioMuted(v) {
    audioMutedCache = !!v;
    try { localStorage.setItem("td_audio_muted", v ? "1" : "0"); } catch {}
    return getJuiceSettings();
  }
  function audioVolume() {
    if (audioVolumeCache !== undefined) return audioVolumeCache;
    try {
      const raw = Number(localStorage.getItem("td_audio_volume"));
      audioVolumeCache = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.8;
    } catch { audioVolumeCache = 0.8; }
    return audioVolumeCache;
  }
  function setAudioVolume(v) {
    const next = Math.max(0, Math.min(1, Number(v)));
    audioVolumeCache = Number.isFinite(next) ? next : 0.8;
    try { localStorage.setItem("td_audio_volume", String(audioVolumeCache)); } catch {}
    if (audioState.master) {
      try { audioState.master.gain.value = audioVolumeCache; } catch {}
    }
    return getJuiceSettings();
  }
  function getJuiceSettings() {
    return { reducedEffects: reducedEffectsEnabled(), audioMuted: audioMuted(), audioUnlocked: !!audioState.unlocked, audioVolume: audioVolume() };
  }
  const audioState = { ctx: null, master: null, unlocked: false, active: 0, activeVoices: [], lastByKind: {} };
  function markAudioUnlockState() {
    audioState.unlocked = !!(audioState.ctx && audioState.ctx.state === "running");
    return audioState.unlocked;
  }
  function unlockAudio() {
    if (audioMuted()) return;
    if (markAudioUnlockState()) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audioState.ctx = audioState.ctx || new AC();
      const ctx2 = audioState.ctx;
      if (!audioState.master) {
        audioState.master = ctx2.createGain();
        audioState.master.gain.value = audioVolume();
        audioState.master.connect(ctx2.destination);
      }
      if (ctx2.state === "suspended" && ctx2.resume) {
        const resumed = ctx2.resume();
        if (resumed && typeof resumed.then === "function") resumed.then(markAudioUnlockState).catch(() => { audioState.unlocked = false; });
      }
      markAudioUnlockState();
    } catch {}
  }
  function sfxPriority(kind) {
    return SFX_PRIORITY[kind] == null ? 0 : SFX_PRIORITY[kind];
  }
  function cleanupSfxVoices() {
    audioState.activeVoices = (audioState.activeVoices || []).filter((voice) => voice && !voice.ended);
    audioState.active = audioState.activeVoices.length;
  }
  function releaseSfxVoice(voice) {
    if (!voice || voice.ended) return;
    voice.ended = true;
    try { if (voice.osc) voice.osc.disconnect(); } catch {}
    try { if (voice.gain) voice.gain.disconnect(); } catch {}
    cleanupSfxVoices();
  }
  function evictSfxVoice(voice) {
    if (!voice || voice.ended) return;
    try { if (voice.osc && voice.osc.stop) voice.osc.stop(audioState.ctx ? audioState.ctx.currentTime : 0); } catch {}
    releaseSfxVoice(voice);
  }
  function reserveSfxVoice(kind) {
    cleanupSfxVoices();
    if (audioState.activeVoices.length < MAX_ACTIVE_SFX) return { ok: true, evicted: null };
    const incomingPriority = sfxPriority(kind);
    let evictIndex = -1;
    let evictPriority = Infinity;
    for (let i = 0; i < audioState.activeVoices.length; i++) {
      const voice = audioState.activeVoices[i];
      const priority = voice.priority == null ? sfxPriority(voice.kind) : voice.priority;
      if (priority < incomingPriority && priority < evictPriority) {
        evictPriority = priority;
        evictIndex = i;
      }
    }
    if (evictIndex < 0) return { ok: false, evicted: null };
    const evicted = audioState.activeVoices[evictIndex];
    evictSfxVoice(evicted);
    return { ok: true, evicted: evicted.kind };
  }
  function simulateSfxEviction(activeKinds, incomingKind) {
    const savedVoices = audioState.activeVoices;
    const savedActive = audioState.active;
    audioState.activeVoices = (activeKinds || []).map((kind, i) => ({
      kind,
      priority: sfxPriority(kind),
      ended: false,
      fakeId: i,
    }));
    audioState.active = audioState.activeVoices.length;
    const result = reserveSfxVoice(incomingKind);
    if (result.ok) {
      audioState.activeVoices.push({ kind: incomingKind, priority: sfxPriority(incomingKind), ended: false, fakeId: "incoming" });
      cleanupSfxVoices();
    }
    const snapshot = {
      accepted: result.ok,
      evicted: result.evicted,
      kept: audioState.activeVoices.map((voice) => voice.kind),
    };
    audioState.activeVoices = savedVoices;
    audioState.active = savedActive;
    return snapshot;
  }
  ["pointerdown", "keydown", "touchstart"].forEach((ev) => {
    document.addEventListener(ev, unlockAudio, { once: true, passive: true });
  });
  function playSfx(kind) {
    if (audioMuted()) return;
    unlockAudio();
    const ac = audioState.ctx;
    if (!ac || !audioState.unlocked) return;
    const map = {
      fire: [520, 0.035, "square", 0.025],
      hit: [180, 0.045, "triangle", 0.03],
      kill: [420, 0.09, "sawtooth", 0.045],
      wave: [660, 0.16, "sine", 0.055],
      boss: [90, 0.34, "sawtooth", 0.075],
      leak: [140, 0.20, "square", 0.06],
      build: [740, 0.08, "triangle", 0.04],
      skill: [880, 0.18, "sawtooth", 0.05],
      ui: [520, 0.05, "sine", 0.025],
    };
    const spec = map[kind];
    if (!spec) return;
    try {
      const now = ac.currentTime;
      const minGap = SFX_MIN_GAP[kind] || 0.02;
      if (audioState.lastByKind[kind] && now - audioState.lastByKind[kind] < minGap) return;
      const reservation = reserveSfxVoice(kind);
      if (!reservation.ok) return;
      audioState.lastByKind[kind] = now;
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      const voice = { kind, priority: sfxPriority(kind), osc, gain, ended: false };
      osc.type = spec[2];
      osc.frequency.setValueAtTime(spec[0], now);
      if (kind === "boss") osc.frequency.exponentialRampToValueAtTime(38, now + spec[1]);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(40, spec[0] * 0.62), now + spec[1]);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(spec[3], now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + spec[1]);
      osc.connect(gain);
      gain.connect(audioState.master || ac.destination);
      audioState.activeVoices.push(voice);
      cleanupSfxVoices();
      osc.onended = () => releaseSfxVoice(voice);
      osc.start(now);
      osc.stop(now + spec[1] + 0.03);
    } catch {}
  }
  function effectRand() {
    if (!state) return 0.5;
    let x = (state.effectSeed || 1) >>> 0;
    x = (x + 0x6D2B79F5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    state.effectSeed = x || 1;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function flushUIRefresh() {
    uiRefreshScheduled = false;
    if (typeof window.__tdUI === "function") window.__tdUI();
  }
  function notifyUI(force) {
    if (typeof window.__tdUI !== "function") return;
    if (force || !state || state.betweenWaves || state.over || !state.running) {
      flushUIRefresh();
      return;
    }
    if (uiRefreshScheduled) return;
    uiRefreshScheduled = true;
    requestAnimationFrame(flushUIRefresh);
  }

  const PERF_MODE_KEY = "td_perf_mode";
  const PERF_MODES = { auto: "自動", high: "鎖高", low: "鎖低" };
  const perfState = {
    mode: readPerformanceMode(),
    quality: "high",
    fps: 60,
    sampleStart: 0,
    sampleFrames: 0,
    lowSamples: 0,
    highSamples: 0,
    reason: "init",
    lastDowngradeReason: "",
    history: [],
  };
  function readPerformanceMode() {
    try {
      const saved = localStorage.getItem(PERF_MODE_KEY);
      return PERF_MODES[saved] ? saved : "auto";
    } catch { return "auto"; }
  }
  function performanceLow() { return perfState.quality === "low"; }
  function notifyPerformanceChange() {
    if (typeof window.__tdPerformanceChanged === "function") window.__tdPerformanceChanged(getPerformanceStatus());
  }
  function performanceReasonLabel(reason) {
    const reasonLabel = {
      init: "初始化",
      manual: "手動設定",
      "auto-low-fps": "FPS 低於 45",
      "auto-recovered": "FPS 回穩",
    };
    return reasonLabel[reason] || reason || "未知";
  }
  function recordPerformanceEvent(quality, reason) {
    const type = quality === "low" ? "降級" : "恢復";
    let time = "";
    try { time = new Date().toLocaleTimeString("zh-TW", { hour12: false }); }
    catch { time = String(Date.now()); }
    perfState.history.unshift({
      at: Date.now(),
      time,
      type,
      quality,
      reason: reason || "manual",
      reasonLabel: performanceReasonLabel(reason || "manual"),
    });
    perfState.history = perfState.history.slice(0, 5);
  }
  function setPerformanceQuality(quality, reason) {
    const q = quality === "low" ? "low" : "high";
    if (perfState.quality === q && perfState.reason === reason) return;
    perfState.quality = q;
    perfState.reason = reason || "manual";
    if (q === "low") perfState.lastDowngradeReason = reason || "manual";
    recordPerformanceEvent(q, perfState.reason);
    if (state && reason && reason !== "init") {
      const label = q === "low" ? "低特效" : "高特效";
      log(`效能模式已切換為${label}`);
    }
    notifyPerformanceChange();
  }
  function setPerformanceMode(mode) {
    const next = PERF_MODES[mode] ? mode : "auto";
    perfState.mode = next;
    perfState.lowSamples = 0;
    perfState.highSamples = 0;
    try { localStorage.setItem(PERF_MODE_KEY, next); } catch {}
    if (next === "high") setPerformanceQuality("high", "manual");
    else if (next === "low") setPerformanceQuality("low", "manual");
    else notifyPerformanceChange();
    return getPerformanceStatus();
  }
  function handlePerformanceSample(fps) {
    const value = Math.max(1, Math.min(240, Number(fps) || 60));
    perfState.fps = value;
    if (perfState.mode !== "auto") return;
    if (value < 45) {
      perfState.lowSamples++;
      perfState.highSamples = 0;
      if (perfState.lowSamples >= 2) setPerformanceQuality("low", "auto-low-fps");
    } else if (value >= 54) {
      perfState.highSamples++;
      perfState.lowSamples = 0;
      if (perfState.highSamples >= 3) setPerformanceQuality("high", "auto-recovered");
    } else {
      perfState.lowSamples = 0;
      perfState.highSamples = 0;
    }
  }
  function updatePerformanceMonitor(t) {
    if (!t) return;
    if (!perfState.sampleStart) {
      perfState.sampleStart = t;
      perfState.sampleFrames = 0;
      return;
    }
    perfState.sampleFrames++;
    const elapsed = t - perfState.sampleStart;
    if (elapsed >= 1000) {
      handlePerformanceSample((perfState.sampleFrames * 1000) / elapsed);
      perfState.sampleStart = t;
      perfState.sampleFrames = 0;
    }
  }
  function getPerformanceStatus() {
    const low = performanceLow();
    return {
      mode: perfState.mode,
      modeLabel: PERF_MODES[perfState.mode] || PERF_MODES.auto,
      quality: perfState.quality,
      fps: Math.round(perfState.fps),
      reason: perfState.reason,
      reasonLabel: performanceReasonLabel(perfState.reason),
      lastDowngradeReason: perfState.lastDowngradeReason,
      lastDowngradeLabel: perfState.lastDowngradeReason ? performanceReasonLabel(perfState.lastDowngradeReason) : "無",
      particleScale: low ? 0.45 : 1,
      animationScale: low ? 0.42 : 1,
      poisonFogScale: low ? 0.55 : 1,
      history: perfState.history.slice(),
    };
  }
  setPerformanceMode(perfState.mode);
  function normalizedSeed(value, fallback) {
    if (TDRules.normalizeRunSeed) return TDRules.normalizeRunSeed(value, fallback);
    const fb = (Math.floor(Number(fallback) || 1) >>> 0) || 1;
    return (Math.floor(Number(value) || fb) >>> 0) || fb;
  }

  function randomRunSeed() {
    return Math.floor(Math.random() * 0x7fffffff) + 1;
  }
  function pathLength(path) {
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) total += Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    return Math.max(1, total);
  }
  function retainInPlace(items, predicate) {
    let write = 0;
    for (let read = 0; read < items.length; read++) {
      const item = items[read];
      if (predicate(item)) items[write++] = item;
    }
    items.length = write;
  }
  function updateParticles(dt) {
    for (const p of state.particles) {
      p.life -= dt;
      if (p.toX != null && p.toY != null) {
        const k = 1 - Math.exp(-dt * (p.flySpeed || 4.5));
        p.x += (p.toX - p.x) * k;
        p.y += (p.toY - p.y) * k;
      } else if (!p.ring && !p.beam) {
        p.x += (p.vx || 0) * dt;
        p.y += (p.vy || 0) * dt;
        if (p.texture) p.rotation = (p.rotation || 0) + (p.spin || 0) * dt;
        if (!p.text && !p.muzzle && !p.texture) p.vy = (p.vy || 0) + 220 * dt;
      }
    }
    retainInPlace(state.particles, (p) => p.life > 0);
  }
  function getLore() { return window.TD_LORE || {}; }
  function openingLoreLines(mapDef, affix) {
    const lore = getLore();
    const mapLore = lore.mapLoreFor ? lore.mapLoreFor(mapDef.id) : null;
    const lines = [];
    if (mapLore && Array.isArray(mapLore.lines)) {
      lines.push(`${mapDef.emoji || ""} ${mapLore.title}：${mapLore.lines[0]}`);
      if (mapLore.lines[1]) lines.push(mapLore.lines[1]);
    } else {
      lines.push(`${mapDef.emoji || ""} ${mapDef.label}：${mapDef.desc}`);
    }
    if (affix) {
      const whisper = lore.oracleWhisper ? lore.oracleWhisper((state && state.affixSeed) || 0) : "";
      lines.push(`${affix.emoji} 詞綴「${affix.label}」：${affix.desc}${whisper ? `｜${whisper}` : ""}`);
    }
    return lines;
  }
  function emitIntroLogs() {
    if (!state || !state.introLogs || !state.introLogs.length || typeof window.__tdLog !== "function") return;
    const items = state.introLogs.splice(0);
    items.forEach((msg) => log(msg));
  }

  const EXPEDITION_NEUTRAL = Object.freeze({
    physicalPierceBonus: 0, cannonSplashMul: 1, frostDurationMul: 1,
    thunderVsSlowMul: 1, poisonDpsMul: 1, skillCooldownMul: 1,
    upgradeCostMul: 1, killGoldBonus: 0, healBetween: 0,
    firstLeakWardPerWave: 0, heroDamageMul: 1, heroSpeedMul: 1, skillBan: false,
  });
  function isExpedition() { return !!(state && state.mode === "expedition" && state.expedition); }
  function refreshExpeditionModifiers() {
    state.expeditionModifiers = isExpedition()
      ? Object.assign({}, EXPEDITION_NEUTRAL, window.TDExpedition.modifiers(state.expedition))
      : EXPEDITION_NEUTRAL;
  }
  function expeditionModifier(key) {
    const value = isExpedition() && state.expeditionModifiers ? state.expeditionModifiers[key] : EXPEDITION_NEUTRAL[key];
    return Number.isFinite(value) ? value : EXPEDITION_NEUTRAL[key];
  }
  function canChooseExpedition() {
    return isExpedition() && state.betweenWaves && !state.over && !state.expedition.completed;
  }
  function chooseContract(id) {
    if (!canChooseExpedition() || state.expedition.draft) return false;
    const next = window.TDExpedition.selectContract(state.expedition, id);
    if (!next) return false;
    state.expedition = next; refreshExpeditionModifiers(); notifyUI(true); return true;
  }
  function chooseRelic(id) {
    if (!canChooseExpedition() || !state.expedition.draft) return false;
    const next = window.TDExpedition.chooseRelic(state.expedition, id);
    if (!next) return false;
    state.expedition = next; refreshExpeditionModifiers(); notifyUI(true); return true;
  }
  function skipRelic() {
    if (!canChooseExpedition() || !state.expedition.draft) return false;
    const next = window.TDExpedition.skipDraft(state.expedition);
    if (!next) return false;
    state.expedition = next; refreshExpeditionModifiers(); notifyUI(true); return true;
  }
  function isSkillLocked() {
    return isExpedition() && (state.over || state.expedition.completed || !!state.expedition.draft ||
      (!state.betweenWaves && !!state.expeditionModifiers.skillBan));
  }
  function skillStat(id, key) {
    const def = SKILLS[id];
    if (!def) return undefined;
    if (key === "cooldown") return def.cooldown * expeditionModifier("skillCooldownMul");
    if (key === "freezeDur" && id === "freeze") return def.freezeDur * expeditionModifier("frostDurationMul");
    return def[key];
  }
  function projectilePierce(element, base, splash) {
    const bonus = expeditionModifier("physicalPierceBonus");
    return element === "physical" && !splash && bonus > 0 ? (base || 1) + bonus : base;
  }
  function thunderSlowModifier(enemy, element) {
    if (element !== "thunder" || !enemy) return 1;
    const slowed = enemy.slowUntil > state.clock || enemy.frozenUntil > state.clock ||
      (enemy.beaconSlowUntil > state.clock && enemy.beaconSlowFactor < 1);
    return slowed ? expeditionModifier("thunderVsSlowMul") : 1;
  }

  function newGame(options) {
    const opts = options || {};
    const mode = opts.mode === "expedition" ? "expedition" : "classic";
    if (mode === "expedition" && (!window.TDExpedition || typeof window.TDExpedition.createRun !== "function")) {
      throw new Error("遠征內容模組尚未載入。");
    }
    cancelTouchPlacement(true);
    liveLoopActive = false;
    resetFrameTiming();
    visualClock = 0;
    engineMetrics.steps = engineMetrics.frames = engineMetrics.lastSteps = engineMetrics.droppedSeconds = 0;
    engineMetrics.backgroundBakes = engineMetrics.pathBakes = 0;
    engineMetrics.guideBakes = engineMetrics.placementBakes = 0;
    engineMetrics.navWarmups = engineMetrics.navWarmupMs = engineMetrics.navQueries = engineMetrics.navQueryMs = 0;
    engineMetrics.navQueryMaxMs = engineMetrics.navQueryFailures = 0;
    const mapDef = getMap();
    const path = mapDef.path;
    const hasRunSeed = Object.prototype.hasOwnProperty.call(opts, "runSeed");
    const hasAffixSeed = Object.prototype.hasOwnProperty.call(opts, "affixSeed");
    const runSeed = normalizedSeed(opts.runSeed, hasRunSeed ? 1 : randomRunSeed());
    const affixSeed = normalizedSeed(opts.affixSeed, hasAffixSeed ? 1 : randomRunSeed());
    const affix = TDRules.selectMapAffix ? TDRules.selectMapAffix(affixSeed) : null;
    markPathCells(path, mapDef);
    const end = path[path.length - 1];
    state = {
      gold: Math.round(GAME.startGold * (mapDef.goldMul || 1)), wave: 0, score: 0,
      // 守護女神：被保護的核心
      goddess: (() => { const gm = getDifficulty().goddessMul; const hp = Math.round(GODDESS.baseHp * gm); return { level: 1, hp, maxHp: hp, x: end.x, y: end.y, smiteCd: 0, hitFlash: 0 }; })(),
      towers: [], heroes: [], enemies: [], bullets: [], particles: [],
      spawnQueue: [], spawnTimer: 0, clock: 0, mouse: null,
      mapId: mapDef.id, mapDef, path, runSeed, affixSeed, affix, mode,
      expedition: window.TDExpedition ? window.TDExpedition.createRun({ mode, mapId: mapDef.id, runSeed }) : null,
      expeditionLeakWardUsed: false, victory: false,
      pathTotalLength: pathLength(path),
      pathSegmentLengths: path.map((p, i) => i ? Math.max(1, Math.hypot(p.x - path[i - 1].x, p.y - path[i - 1].y)) : 1),
      waveSeeds: {}, backgroundCache: null, pathDetailCache: null, buildableReachCache: null,
      performance: perfState,
      combo: 0, comboTimer: 0, kills: 0,  // D5 連殺系統
      cleanStreak: 0, waveLeaks: 0, redVignette: 0, slowMoLeft: 0, slowMoScale: 1, fxTimeScale: 1,
      effectSeed: ((runSeed ^ (affixSeed << 1) ^ 0x9e3779b9) >>> 0) || 1,
      runSoulEarned: 0, runMissionSoulEarned: 0, soulRewardedWaves: new Set(),
      runLeaks: { total: 0, byWave: {} },
      towersBuilt: 0, towerUpgrades: 0, skillCasts: 0, bossKills: 0, clearedWave: 0,
      // R77: deterministic headless balance runs read these counters after driving
      // the real update loop. They are observational only and never feed combat.
      combatTelemetry: { waves: {} },
      running: false, over: false, betweenWaves: true, waveTotal: 0, waveResolved: 0,
      paused: false,
      selectedTowerType: null,   // 準備建造的塔
      selectedTower: null,        // 已選中的塔（看升級）
      selectedGoddess: false,     // R64：直接點女神後顯示就地升級
      buildMenuTarget: null,      // R64：直接點空格後顯示就地建塔輪盤（不持久化）
      touchBuildPreview: null,    // R79：按住／拖曳精準定位；放開不會建塔
      buildPlacementFeedback: "",
      pendingSkill: null,         // 準備施放的技能
      touchSkillPreview: null,
      skillGhost: null,
      touchControlMode,
      skillCooldowns: {},         // 技能冷卻計時
      speed: 1,                    // 遊戲速度倍率
      towerSeq: 0,
      enemySeq: 0,
      advisorMode: "control",
      advisorBuildConfirm: false,
      advisorUpgradeTarget: null,
      debugIgnoreTerrain: false,
    };
    refreshExpeditionModifiers();
    state.introLogs = openingLoreLines(mapDef, affix);
    state.banner = { text: mapDef.label, color: "#fde047", life: 2.0 };
    Object.keys(SKILLS).forEach((k) => (state.skillCooldowns[k] = 0));
    state.map = buildMapLayout();
    getImg(terrainPlatePath(mapDef), true);
    if (window.TDMapArt) getImg(window.TDMapArt.BRIDGE_SPRITE, true);
    prewarmHeroNavigation();
    emitIntroLogs();
    notifyUI(true);
    const battlefield = document.getElementById("battlefieldScroll");
    if (battlefield) {
      // 手機放大戰場留少量左右點擊緩衝，避免首個半屏邊界格落在裁切線外。
      battlefield.scrollLeft = battlefield.scrollWidth > battlefield.clientWidth + 2 ? 8 : 0;
      battlefield.scrollTop = 0;
    }
  }

  // R80 layout: authored geography and legal building cells, no random tile/decor.
  function buildMapLayout() {
    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL), buildCells = [];
    for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
      if (!blocked.has(cellKey(cx, cy))) buildCells.push({ cx, cy, ...cellCenter(cx, cy) });
    }
    return { cols, rows, buildCells };
  }
  function prewarmHeroNavigation() {
    if (!TDRules.heroRoute || !state.mapDef || !(state.mapDef.buildPads || []).length) return;
    const started = performance.now();
    const start = state.mapDef.core || state.goddess, target = state.mapDef.buildPads[0];
    const route = TDRules.heroRoute(state.mapDef, start, target, { cellSize: HERO_NAV_CELL, radius: HERO_NAV_RADIUS });
    engineMetrics.navWarmups++; engineMetrics.navWarmupMs = performance.now() - started;
    state.navigationReady = route.reachable;
  }

  // 下一波預告（D4）：回傳下一波的敵人數、是否 Boss、主元素傾向。
  // theme 用 config 的共用 waveTheme()——startWave 出怪讀同一個來源，預告才不會是假的
  function waveSeedFor(wave) {
    const w = Math.max(1, Math.floor(Number(wave) || 1));
    const runSeed = normalizedSeed(state.runSeed, 1);
    const affixSeed = normalizedSeed(state.affixSeed, 1);
    const key = `${runSeed}:${affixSeed}:${w}`;
    if (!state.waveSeeds) state.waveSeeds = {};
    if (!Object.prototype.hasOwnProperty.call(state.waveSeeds, key)) {
      state.waveSeeds[key] = TDRules.waveRngSeed ? TDRules.waveRngSeed(w, runSeed, affixSeed) : (((w * 1664525 + 1013904223) >>> 0) || 1);
    }
    return state.waveSeeds[key];
  }
  function wavePlanFor(wave) {
    const base = TDRules.generateWaveQueue(wave, getDifficulty(), waveSeedFor(wave), state.affix);
    return isExpedition() ? window.TDExpedition.planWave(base, { run: state.expedition, wave }) : base;
  }
  function previewNextWave(options) {
    const opts = options || {};
    const advisorMode = opts.advisorMode || opts.mode || state.advisorMode || "control";
    const w = state.wave + 1;
    const seed = waveSeedFor(w);
    const plan = wavePlanFor(w);
    const counts = {};
    for (const item of plan.queue) counts[item.type] = (counts[item.type] || 0) + 1;
    const enemyTypes = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([type, count]) => ({ type, count }));
    const recommendations = TDRules.recommendTowersForWave ? TDRules.recommendTowersForWave(plan) : [];
    const advisorInput = { queue: plan.queue, towers: state.towers, gold: state.gold, path: state.path, mapDef: state.mapDef, mapId: state.mapId, affix: state.affix, width: W, height: H, advisorMode };
    const advisor = TDRules.adviseTowerActions ? TDRules.adviseTowerActions(advisorInput) : [];
    const counterWarning = TDRules.counterWarningForWave ? TDRules.counterWarningForWave(advisorInput) : null;
    return { wave: w, seed, count: plan.count, totalCount: plan.totalCount, isBoss: plan.isBoss, theme: plan.theme, event: plan.event, affix: plan.affix, queue: plan.queue.map((item) => Object.assign({}, item)), enemyTypes, recommendations, advisor, counterWarning, advisorMode,
      mode: state.mode, expedition: plan.expedition || false, finale: !!plan.finale, phase: plan.phase || null,
      waveLabel: plan.waveLabel || null, missionId: plan.missionId || null, contract: plan.contract || null,
      completed: !!(isExpedition() && state.expedition.completed) };
  }

  // ===== 波次系統（無盡隨機遞增）=====
  function canStartFirstWave() {
    return state.towers.some((tower) => {
      const def = TOWERS[tower.type];
      return def && !def.support && def.damage > 0;
    }) || state.heroes.some((hero) => HEROES[hero.id] && HEROES[hero.id].atk > 0);
  }
  function startWave() {
    if (state.over) return false;
    if (isExpedition() && (!state.betweenWaves || state.expedition.draft || state.expedition.completed)) return false;
    if (state.wave === 0 && !canStartFirstWave()) {
      flashText(W / 2, H * 0.28, "先建攻擊塔或派出英雄", { color: "#fde047", size: 22, big: true });
      log("先建攻擊塔或派出英雄，再開始第 1 波。", "bad");
      return false;
    }
    if (isExpedition()) {
      const next = window.TDExpedition.beginWave(state.expedition, state.wave + 1);
      if (!next) return false;
      state.expedition = next; refreshExpeditionModifiers();
      state.expeditionLeakWardUsed = false;
      if (state.expeditionModifiers.skillBan) {
        cancelTouchPlacement(true);
        state.pendingSkill = null; canvas.style.cursor = "default";
      }
    }
    state.wave++;
    state.betweenWaves = false;
    state.waveLeaks = 0;
    const w = state.wave;
    const plan = wavePlanFor(w);
    const isBoss = plan.isBoss;
    const ev = plan.event;
    state.currentEvent = ev;
    state.combatTelemetry = state.combatTelemetry || { waves: {} };
    state.combatTelemetry.waves[w] = {
      wave: w,
      startedAt: state.clock,
      endedAt: null,
      spawned: 0,
      spawnedDurability: 0,
      latestLeakDeadlineSeconds: 0,
      leakPotentialDamage: 0,
      bossSpawned: 0,
      bossDurability: 0,
      bossLeakPotentialDamage: 0,
      playerDamage: 0,
      damageBySource: {},
      bossDamage: 0,
      kills: 0,
      bossKills: 0,
      killGold: 0,
      bossGold: 0,
      waveGold: 0,
      leaks: 0,
      goddessDamage: 0,
    };
    applyAffixWaveStart(w);

    state.spawnQueue = plan.queue;
    state.waveTotal = plan.queue.length;
    state.waveResolved = 0;
    state.spawnTimer = 0;
    startLoop();
    const lore = getLore();
    const beat = lore.waveBeatFor ? lore.waveBeatFor(w) : null;
    if (beat) {
      log(`【${beat.title}】${beat.line}`);
      flashBanner(beat.title, "#facc15");
    }
    if (ev) {
      const flavor = lore.eventFlavorFor ? lore.eventFlavorFor(ev.id) : "";
      log(`${ev.emoji} 第 ${w} 波【${ev.label}】${ev.desc}${flavor ? `｜${flavor}` : ""}`);
      flashBanner(`${ev.emoji} ${ev.label}`, ev.color); // 畫面橫幅提示
    } else {
      log(`第 ${w} 波來襲！${isBoss ? "⚠️ Boss 出現！" : ""}`);
      if (isBoss) {
        const bossSpec = plan.queue.find((spec) => ENEMIES[spec.type] && ENEMIES[spec.type].boss);
        const bossLine = bossSpec && lore.bossIntroFor ? lore.bossIntroFor(bossSpec.type) : "";
        if (bossLine) log(bossLine, "bad");
        flashBanner("BOSS 來襲", "#ef4444", { boss: true, subtitle: "裂界警報 · 守住神火", duration: 2.6 });
      }
    }
    if (w === 1 && state.affix) log(`${state.affix.emoji} 本局詞綴：${state.affix.label}｜${state.affix.desc}`);
    notifyUI();
    return true;
  }
  // 事件波橫幅提示（畫面中央短暫顯示）
  function flashBanner(text, color, opts) {
    opts = opts || {};
    const duration = opts.duration || 2.0;
    state.banner = { text, color, life: duration, duration, boss: !!opts.boss, subtitle: opts.subtitle || "" };
  }
  function celebrateWaveClear(wave, bonus, clean) {
    playSfx("wave");
    if (reducedEffectsEnabled()) return;
    flashBanner(`WAVE ${wave} CLEAR`, clean && state.cleanStreak >= 2 ? "#4ade80" : "#fde047");
    flashText(W / 2, H * 0.30, `+${bonus}G`, { color: "#facc15", size: 24, big: true });
    if (clean) flashText(W / 2, H * 0.37, `NO LEAK x${state.cleanStreak}`, { color: "#4ade80", size: 18, big: true });
    ring(W / 2, H * 0.36, "#fde047", 120);
  }

  function affixMul(key) {
    const affix = state && state.affix;
    const val = affix && typeof affix[key] === "number" ? affix[key] : 1;
    return Number.isFinite(val) ? val : 1;
  }
  function eventMul(key) {
    const ev = state && state.currentEvent;
    const val = ev && typeof ev[key] === "number" ? ev[key] : 1;
    return Number.isFinite(val) ? val : 1;
  }

  function heroLongLevelFromProgress(progress) {
    const xp = progress && typeof progress.xp === "number" ? progress.xp : 0;
    return TDRules.heroLongLevelFromXp ? TDRules.heroLongLevelFromXp(xp) : 1;
  }

  function heroLongBonusFromProgress(progress) {
    const level = progress && typeof progress.level === "number" ? progress.level : heroLongLevelFromProgress(progress);
    return TDRules.heroPermanentBonus ? TDRules.heroPermanentBonus(level) : 0;
  }

  function heroBattleStat(hero, key) {
    if (typeof hero === "string") hero = { id: hero, level: 1, longBonus: 0 };
    if (!hero || !HEROES[hero.id]) return 0;
    const value = heroStat(hero, key);
    if (key === "speed") return value * expeditionModifier("heroSpeedMul");
    if (key !== "hp" && key !== "atk") return value;
    const bonus = hero && typeof hero.longBonus === "number" ? hero.longBonus : 0;
    const base = Math.round(value * (1 + bonus));
    return key === "atk" ? base * expeditionModifier("heroDamageMul") : base;
  }

  function applyAffixWaveStart(wave) {
    const affix = state.affix;
    if (!affix || !affix.towerStunEvery || wave % affix.towerStunEvery !== 0 || !state.towers.length) return;
    const idx = Math.abs(((state.affixSeed || 1) + wave * 2654435761) | 0) % state.towers.length;
    const tw = state.towers[idx];
    tw.stunnedUntil = Math.max(tw.stunnedUntil || 0, state.clock + (affix.towerStunDuration || 2));
    tw.cd = Math.max(tw.cd || 0, affix.towerStunDuration || 2);
    flashText(tw.x, tw.y - 20, "餘震停火", { color: "#facc15", size: 13 });
    log(`${affix.emoji} 餘震震停 ${TOWERS[tw.type].name} ${affix.towerStunDuration || 2} 秒。`, "bad");
  }

  function spawnEnemy(spec) {
    const enemy = createEnemy(spec);
    enemy._waveTracked = true;
    state.enemies.push(enemy);
    const telemetry = state.combatTelemetry && state.combatTelemetry.waves[state.wave];
    if (telemetry) {
      const durability = Math.max(0, enemy.maxHp || 0) + Math.max(0, enemy.maxShield || 0);
      const leakDamage = Math.round(enemy.leak * (enemy.boss ? 4 : 3) * affixMul("leakDamageMul"));
      telemetry.spawned += 1;
      telemetry.spawnedDurability += durability;
      telemetry.leakPotentialDamage += leakDamage;
      telemetry.latestLeakDeadlineSeconds = Math.max(
        telemetry.latestLeakDeadlineSeconds,
        Math.max(0, state.clock - telemetry.startedAt) + (state.pathTotalLength || 0) / Math.max(1, enemy.speed || 1),
      );
      if (enemy.boss) {
        telemetry.bossSpawned += 1;
        telemetry.bossDurability += durability;
        telemetry.bossLeakPotentialDamage += leakDamage;
      }
    }
    return enemy;
  }

  function createEnemy(spec, overrides) {
    if (typeof spec === "string") spec = { type: spec, hpScale: 1 };
    spec = spec || { type: "slime", hpScale: 1 };
    const type = ENEMIES[spec.type] ? spec.type : "slime";
    const def = ENEMIES[type];
    const ev = spec.event;
    const scale = spec.hpScale || 1;
    const affix = state.affix || null;
    const maxHp = Math.round(def.hp * scale);
    const maxShield = def.shield ? Math.round(def.shield * scale) : 0;
    const seq = state.enemySeq = (state.enemySeq || 0) + 1;
    return Object.assign({
      ...def, type, x: state.path[0].x, y: state.path[0].y, wp: 1,
      name: spec.nameOverride || def.name,
      emoji: spec.emojiOverride || def.emoji,
      speed: def.speed * (ev ? ev.speedMul : 1) * (spec.speedMul || 1) * (affix ? affixMul("enemySpeedMul") : 1), // 事件波/詞綴速度
      reward: Math.round(def.reward * (ev ? ev.goldMul : 1) * (spec.rewardMul || 1) * (affix ? affixMul("killGoldMul") : 1)), // 事件波/詞綴金錢
      leak: spec.leakOverride == null ? def.leak : spec.leakOverride,
      hp: maxHp, maxHp, shield: maxShield, maxShield, slowUntil: 0, slowFactor: 1, frozenUntil: 0,
      poisonStacks: [], _poisonAcc: 0, _poisonFloatAt: 0, healCd: def.healInterval || 0,
      walkDist: 0, animSeed: Math.random(), vx: 1, vy: 0, flipX: false, hitFlash: 0, hitKick: 0,
      event: ev, role: spec.role || null, color: spec.colorOverride || (ev && ev.id === "elite" ? "#a855f7" : def.color), // 精英波變色
      _dodgeRoll: Math.random(),
      uid: "e" + seq,
    }, overrides || {});
  }

  function markVulnerable(e, mult, duration) {
    if (!e || e._dead || !(mult > 1) || !(duration > 0)) return;
    e.vulnMult = Math.max(e.vulnMult || 1, mult);
    e.vulnUntil = Math.max(e.vulnUntil || 0, state.clock + duration);
    ring(e.x, e.y, "#a855f7", 34);
  }

  function auraArmorMulFor(target, opts) {
    if (!target || opts && opts.ignoreAuraArmor) return 1;
    let mul = 1;
    for (const source of state.enemies) {
      if (!source || source === target || source._dead) continue;
      const ability = source.ability;
      if (!ability || ability.id !== "auraArmor") continue;
      const radius = ability.radius || 0;
      if (radius <= 0 || Math.hypot(source.x - target.x, source.y - target.y) > radius) continue;
      mul = Math.min(mul, ability.damageMul || 0.75);
    }
    return mul;
  }

  function applyDamage(e, amount, opts) {
    if (!e || e._dead || e._leaked) return 0;
    opts = opts || {};
    let dmg = Math.max(0, amount || 0) * thunderSlowModifier(e, opts.element);
    if (dmg <= 0) return 0;
    e._dodgedLastHit = false;
    e._reflectedLastHit = false;
    e._armoredLastHit = false;
    if (opts.source === "skill" && e.ability && e.ability.id === "reflectOnce" && !e.reflectedSkill) {
      e.reflectedSkill = true;
      e._reflectedLastHit = true;
      flashText(e.x, e.y - 14, "反射", { color: "#f0abfc", size: 13 });
      ring(e.x, e.y, "#e879f9", 34);
      return 0;
    }
    const armorMul = auraArmorMulFor(e, opts);
    if (armorMul < 1) {
      dmg *= armorMul;
      e._armoredLastHit = true;
    }
    if (!opts.bypassShield && !opts.noDodge && e.ability && e.ability.id === "dodgeFirst" && !e._dodgeTried) {
      e._dodgeTried = true;
      if ((e._dodgeRoll || 0) < (e.ability.chance || 0)) {
        e._dodgedLastHit = true;
        flashText(e.x, e.y - 14, "閃避", { color: "#bef264", size: 13 });
        return 0;
      }
    }
    const hpBefore = e.hp;
    const shieldBefore = e.shield || 0;
    if (!opts.bypassShield && e.shield > 0) {
      const shieldHit = Math.min(e.shield, dmg);
      e.shield -= shieldHit;
      dmg -= shieldHit;
      if (shieldHit > 0) e._lastHitAt = state.clock;
    }
    if (dmg > 0) {
      if (!opts.noVuln && e.vulnUntil > state.clock && (e.vulnMult || 1) > 1) dmg *= e.vulnMult;
      e.hp -= dmg;
      if (!opts.noHitFlash && !reducedFlashEnabled()) {
        e.hitFlash = Math.max(e.hitFlash || 0, 0.14);
        e.hitKick = Math.max(e.hitKick || 0, 0.12);
        e.hitDirX = -(e.vx || 0);
        e.hitDirY = -(e.vy || 0);
      }
    }
    const hpDealt = Math.max(0, hpBefore - Math.max(0, e.hp));
    const shieldDealt = Math.max(0, shieldBefore - Math.max(0, e.shield || 0));
    const totalDealt = hpDealt + shieldDealt;
    const telemetry = state.combatTelemetry && state.combatTelemetry.waves[state.wave];
    if (telemetry && totalDealt > 0) {
      const source = typeof opts.source === "string" && opts.source ? opts.source : "other";
      telemetry.playerDamage += totalDealt;
      telemetry.damageBySource[source] = (telemetry.damageBySource[source] || 0) + totalDealt;
      if (e.boss) telemetry.bossDamage += totalDealt;
    }
    return totalDealt;
  }

  function applyPoison(e, poison) {
    if (!e || e._dead || !poison || !(poison.dps > 0) || !(poison.duration > 0)) return;
    const stacks = e.poisonStacks || (e.poisonStacks = []);
    const stack = { dps: poison.dps, until: state.clock + poison.duration };
    const maxStacks = Math.max(1, poison.maxStacks || 1);
    if (stacks.length < maxStacks) stacks.push(stack);
    else {
      let replaceAt = 0;
      for (let i = 1; i < stacks.length; i++) if (stacks[i].until < stacks[replaceAt].until) replaceAt = i;
      stacks[replaceAt] = stack;
    }
    ring(e.x, e.y, "#22c55e", 28);
  }

  function updateEnemyStatuses(dt) {
    for (const e of state.enemies) {
      if (e._dead || !e.poisonStacks || !e.poisonStacks.length) continue;
      e.poisonStacks = e.poisonStacks.filter((s) => s.until > state.clock && s.dps > 0);
      if (!e.poisonStacks.length) continue;
      const dps = e.poisonStacks.reduce((sum, s) => sum + s.dps, 0) * (e.boss ? 0.5 : 1);
      const dealt = applyDamage(e, dps * dt, { source: "poison", bypassShield: true, noHitFlash: true });
      if (dealt > 0) {
        e._poisonAcc = (e._poisonAcc || 0) + dealt;
        const due = state.clock - (e._poisonFloatAt || 0) >= 1;
        const shown = Math.floor(e._poisonAcc);
        if (shown >= 1 || (due && e._poisonAcc >= 0.5)) {
          damageNumber(e.x, e.y - 10, shown >= 1 ? shown : Math.round(e._poisonAcc), 1);
          e._poisonAcc = 0;
          e._poisonFloatAt = state.clock;
        }
      }
      if (e.hp <= 0) killEnemy(e);
    }
  }

  function updateEnemyAbilities(dt) {
    for (const e of state.enemies) {
      if (e._dead) continue;
      if (e.ability && e.ability.id === "shieldRegen" && e.maxShield > 0 && e.shield < e.maxShield) {
        const delay = e.ability.delay || 0;
        const perSec = e.ability.perSec || 0;
        const lastHit = e._lastHitAt == null ? -Infinity : e._lastHitAt;
        if (perSec > 0 && state.clock - lastHit >= delay) {
          e.shield = Math.min(e.maxShield, e.shield + perSec * dt);
        }
      }
      if (e.ability && e.ability.id === "bloodrage" && !e._enraged && e.hp > 0 && e.maxHp > 0 && e.hp / e.maxHp <= (e.ability.threshold || 0.4)) {
        e._enraged = true;
        e.speed *= e.ability.speedMul || 1.35;
        e.color = "#f97316";
        flashText(e.x, e.y - 14, "狂暴", { color: "#fb923c", size: 13 });
      }
      if (e.ability && e.ability.id === "towerMute") {
        e.muteCd = (e.muteCd || 0) - dt;
        if (e.muteCd <= 0) {
          const range = e.ability.range || 0;
          const target = TDRules.selectTowerMuteTarget ? TDRules.selectTowerMuteTarget(e, state.towers, range) : null;
          if (target && target.tower) {
            target.tower.mutedUntil = Math.max(target.tower.mutedUntil || 0, state.clock + (e.ability.duration || 2));
            target.tower.lastMutedBy = e.uid;
            flashText(target.tower.x, target.tower.y - 18, "噤聲", { color: "#f0abfc", size: 13 });
            ring(target.tower.x, target.tower.y, "#c084fc", 28);
            e.muteCd = e.ability.interval || 3;
          } else {
            e.muteCd = 0.25;
          }
        }
      }
      if (!e.healRadius || !e.healAmount || !e.healInterval) continue;
      e.healCd -= dt;
      if (e.healCd > 0) continue;
      e.healCd += e.healInterval;
      let healed = 0;
      for (const ally of state.enemies) {
        if (ally === e || ally._dead || ally.hp >= ally.maxHp) continue;
        if (Math.hypot(ally.x - e.x, ally.y - e.y) > e.healRadius) continue;
        const before = ally.hp;
        ally.hp = Math.min(ally.maxHp, ally.hp + e.healAmount);
        healed += ally.hp - before;
      }
      if (healed > 0) {
        ring(e.x, e.y, "#4ade80", e.healRadius);
        flashText(e.x, e.y - 18, "+" + Math.round(healed), { color: "#86efac", size: 13 });
      }
    }
  }

  function towerDisabled(tw) {
    return (tw.stunnedUntil || 0) > state.clock || (tw.mutedUntil || 0) > state.clock;
  }

  function updateBeaconAuras() {
    for (const e of state.enemies) {
      if (!e || e._dead) continue;
      e.beaconSlowUntil = 0;
      e.beaconSlowFactor = 1;
      e.revealedUntil = 0;
    }
    for (const tw of state.towers) {
      const def = TOWERS[tw.type];
      if (!def || !def.slowAura || towerDisabled(tw)) continue;
      const range = towerStat(tw, "range");
      const factor = 1 - def.slowAura;
      for (const e of state.enemies) {
        if (!e || e._dead || Math.hypot(e.x - tw.x, e.y - tw.y) > range) continue;
        e.revealedUntil = Math.max(e.revealedUntil || 0, state.clock + 0.2);
        e.beaconSlowUntil = Math.max(e.beaconSlowUntil || 0, state.clock + 0.2);
        e.beaconSlowFactor = Math.min(e.beaconSlowFactor || 1, factor);
      }
    }
  }

  // ===== 主迴圈 =====
  function resetFrameTiming() {
    lastT = null;
    frameAccumulator = 0;
    perfState.sampleStart = 0;
    perfState.sampleFrames = 0;
    perfState.lowSamples = perfState.highSamples = 0;
  }
  function startLoop() {
    if (state.running) return;
    state.running = true;
    liveLoopActive = true;
    resetFrameTiming();
  }
  function advanceFrame(t, shouldRender) {
    engineMetrics.lastSteps = 0;
    if (!state || document.hidden) { resetFrameTiming(); return 0; }
    const timestamp = Number.isFinite(t) ? t : 0;
    const elapsed = lastT == null ? 0 : Math.max(0, (timestamp - lastT) / 1000);
    lastT = timestamp;
    const wallDt = Math.min(MAX_FRAME_DELTA, elapsed);
    engineMetrics.frames++;
    updatePerformanceMonitor(timestamp);
    if (!state.paused && !state.over) visualClock += wallDt;
    if (state.running && liveLoopActive && !state.over && !state.paused) {
      const speed = Math.max(1, Math.min(3, Number(state.speed) || 1));
      frameAccumulator += wallDt * speed;
      engineMetrics.droppedSeconds += Math.max(0, elapsed - wallDt) * speed;
      while (frameAccumulator + 1e-9 >= FIXED_STEP && engineMetrics.lastSteps < MAX_FRAME_STEPS) {
        update(FIXED_STEP);
        frameAccumulator = Math.max(0, frameAccumulator - FIXED_STEP);
        engineMetrics.lastSteps++;
        engineMetrics.steps++;
        if (state.over || state.paused || !state.running) { frameAccumulator = 0; break; }
      }
      if (frameAccumulator >= FIXED_STEP) {
        const remainder = frameAccumulator % FIXED_STEP;
        engineMetrics.droppedSeconds += frameAccumulator - remainder;
        frameAccumulator = remainder;
      }
    } else {
      frameAccumulator = 0;
      if (!state.running && !state.paused && !state.over) {
        if (state.banner && state.banner.life > 0) state.banner.life -= wallDt;
        updateParticles(wallDt);
      }
    }
    if (shouldRender !== false && (!state.running || liveLoopActive)) {
      render(state.running && !state.paused && !state.over ? frameAccumulator / FIXED_STEP : 1);
      if (state.paused) drawPauseOverlay();
    }
    return engineMetrics.lastSteps;
  }
  // D10 暫停切換
  function setPaused(value) { state.paused = !!value; resetFrameTiming(); return state.paused; }
  function togglePause() { return setPaused(!state.paused); }
  document.addEventListener("visibilitychange", () => {
    // Hiding the tab freezes the clock without changing the player's pause choice.
    resetFrameTiming();
    if (document.hidden) {
      for (const voice of audioState.activeVoices.slice()) evictSfxVoice(voice);
    }
  });
  function drawPauseOverlay() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(0, 0, W, H);
    ctx.font = '900 40px "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff"; ctx.fillText("⏸ 暫停中", W / 2, H / 2);
    ctx.font = '600 16px "Segoe UI", sans-serif'; ctx.fillStyle = "#9fb0a4";
    ctx.fillText("點 ⏸ 或按空白鍵繼續", W / 2, H / 2 + 36);
    ctx.font = '700 15px "Segoe UI", sans-serif'; ctx.fillStyle = "#c4b5fd";
    ctx.fillText(`本局已獲得 +${state.runSoulEarned || 0}💎`, W / 2, H / 2 + 62);
    ctx.restore();
  }

  function update(dt) {
    if (!(dt > 0) || !Number.isFinite(dt) || state.over) return;
    for (const group of [state.enemies, state.heroes, state.bullets]) {
      for (const entity of group) { entity._renderPrevX = entity.x; entity._renderPrevY = entity.y; }
    }
    const rawDt = dt;
    if (state.slowMoLeft > 0 && !reducedEffectsEnabled()) {
      const scale = Math.max(0.15, Math.min(1, state.slowMoScale || 0.35));
      state.slowMoLeft = Math.max(0, state.slowMoLeft - rawDt);
      state.fxTimeScale = scale;
    } else if (state.slowMoLeft > 0) {
      state.slowMoLeft = 0;
      state.fxTimeScale = 1;
    } else {
      state.fxTimeScale = 1;
    }
    const fxDt = rawDt * (state.fxTimeScale || 1);
    // 生成本波敵人
    if (state.spawnQueue.length > 0) {
      state.spawnTimer -= dt;
      while (state.spawnTimer <= 0 && state.spawnQueue.length) {
        spawnEnemy(state.spawnQueue.shift());
        state.spawnTimer += Math.max(FIXED_STEP, GAME.spawnInterval);
      }
    }

    // 技能冷卻
    Object.keys(state.skillCooldowns).forEach((k) => {
      if (state.skillCooldowns[k] > 0) state.skillCooldowns[k] = Math.max(0, state.skillCooldowns[k] - dt);
    });

    // D5 連殺計時：超時未擊殺則 combo 歸零
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }
    // D8 事件波橫幅倒數
    if (state.banner && state.banner.life > 0) state.banner.life -= dt;

    // 女神聖光反擊（2 級起解鎖）：定期攻擊終點附近的敵人
    const gd = state.goddess;
    if (gd.hitFlash > 0) gd.hitFlash = Math.max(0, gd.hitFlash - dt);
    if (state.redVignette > 0) state.redVignette = Math.max(0, state.redVignette - rawDt * 1.7);
    if (gd.level >= GODDESS.smiteUnlockLevel) {
      gd.smiteCd -= dt;
      if (gd.smiteCd <= 0) {
        const targets = state.enemies.filter((e) => !e._dead && Math.hypot(e.x - gd.x, e.y - gd.y) <= GODDESS.smiteRange);
        if (targets.length) {
          const t = targets.sort((a, b) => b.wp - a.wp)[0]; // 打最接近終點的
          applyDamage(t, GODDESS.smiteDamage, { source: "goddess" });
          state.bullets.push({ x: gd.x, y: gd.y, target: t, speed: 500, color: "#fde047", damage: 0, element: "physical", _holy: true });
          burst(t.x, t.y, "#fde047", 8);
          if (t.hp <= 0) killEnemy(t);
          gd.smiteCd = GODDESS.smiteInterval;
        }
      }
    }

    updateEnemyStatuses(dt);
    updateEnemyAbilities(dt);
    updateBeaconAuras();

    // 敵人移動
    for (const e of state.enemies) {
      if (e.hitFlash > 0) e.hitFlash = Math.max(0, e.hitFlash - dt);
      if (e.hitKick > 0) e.hitKick = Math.max(0, e.hitKick - dt);
      if (e._dead) continue;
      const frozen = e.frozenUntil > state.clock;
      const frostFactor = e.slowUntil > state.clock ? e.slowFactor : 1;
      const beaconFactor = e.beaconSlowUntil > state.clock ? e.beaconSlowFactor : 1;
      const spd = frozen ? 0 : e.speed * Math.min(frostFactor, beaconFactor);
      let remaining = spd * dt;
      // Keep unspent distance at corners. This also handles zero-length waypoints.
      while (!e._leaked) {
        const target = state.path[e.wp];
        if (!target) { leak(e); break; }
        const dx = target.x - e.x, dy = target.y - e.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.001) {
          if (remaining <= 0) break;
          e.vx = dx / dist; e.vy = dy / dist;
          if (Math.abs(e.vx) > 0.08) e.flipX = e.vx < 0;
        }
        const step = Math.min(remaining, dist);
        e.walkDist += step;
        remaining -= step;
        if (remaining < 1e-9 && step < dist) {
          e.x += e.vx * step; e.y += e.vy * step; break;
        }
        if (step >= dist) { e.x = target.x; e.y = target.y; e.wp++; }
        else { e.x += e.vx * step; e.y += e.vy * step; break; }
        if (state.over) break;
      }
    }
    retainInPlace(state.enemies, (e) => {
      if (e._leaked) return false;
      if (!e._dead) return true;
      const startedAt = Number.isFinite(e.deathStartedAt) ? e.deathStartedAt : state.clock;
      const duration = e.deathDuration || ENEMY_ANIMATION_ATLAS.deathDuration;
      return state.clock - startedAt < duration;
    });

    // 塔射擊
    for (const tw of state.towers) {
      if (TOWERS[tw.type].support) continue;
      if (towerDisabled(tw)) continue;
      tw.cd = Math.max(-dt, tw.cd - dt);
      if (tw.cd > 0) continue;
      const target = acquireTarget(tw);
      if (target) { fire(tw, target); tw.cd += 1 / towerStat(tw, "fireRate"); }
    }

    // 英雄：自主尋敵、移動、攻擊
    for (const h of state.heroes) updateHero(h, dt);

    // 子彈移動
    for (const b of state.bullets) {
      if (b.target && !b.target._dead && !b.target._leaked) {
        const dx = b.target.x - b.x, dy = b.target.y - b.y;
        const d = Math.hypot(dx, dy);
        const step = b.speed * dt;
        if (step >= d) { hit(b); b._done = true; }
        else { b.x += (dx / d) * step; b.y += (dy / d) * step; }
      } else { b._done = true; }
    }
    retainInPlace(state.bullets, (b) => !b._done);

    // 粒子（擴張環不移動；爆裂粒子受重力；文字往上飄不受重力）
    updateParticles(fxDt);

    state.clock += dt;

    // 波次結束判定
    if ((!isExpedition() || !state.over) && !state.betweenWaves && state.spawnQueue.length === 0 && state.enemies.length === 0) {
      state.betweenWaves = true;
      state.clearedWave = Math.max(state.clearedWave || 0, state.wave);
      let expeditionGold = 0;
      if (isExpedition()) {
        const result = window.TDExpedition.finishWave(state.expedition, state.wave);
        state.expedition = result.run; refreshExpeditionModifiers();
        expeditionGold = result.goldBonus;
        state.goddess.hp = Math.min(state.goddess.maxHp, state.goddess.hp + result.heal);
        if (state.expedition.completed) state.victory = true;
      }
      const bonus = Math.round(waveGoldBonus(state.wave) * ((state.mapDef && state.mapDef.goldMul) || 1) * affixMul("waveGoldMul")) + expeditionGold; // 經典獎勵 + 當波一次性遠征獎勵
      state.gold += bonus;
      const telemetry = state.combatTelemetry && state.combatTelemetry.waves[state.wave];
      if (telemetry) {
        telemetry.waveGold = bonus;
        telemetry.endedAt = state.clock;
      }
      state.score += state.wave * 10;
      const clean = (state.waveLeaks || 0) === 0;
      state.cleanStreak = clean ? (state.cleanStreak || 0) + 1 : 0;
      let soulReward = 0;
      if (!state.soulRewardedWaves.has(state.wave)) {
        soulReward = TDRules.waveSoulReward(state.wave, getDifficulty().id);
        state.soulRewardedWaves.add(state.wave);
        state.runSoulEarned += soulReward;
      }
      if (soulReward > 0) {
        flashText(W / 2, H * 0.22, `+${soulReward}💎`, { color: "#c4b5fd", size: 22, big: true });
        log(`第 ${state.wave} 波清空！+${bonus} 金，+${soulReward} 魂晶`);
        if (typeof window.__tdWaveCleared === "function") {
          window.__tdWaveCleared({
            wave: state.wave,
            reward: soulReward,
            total: state.runSoulEarned,
            difficultyId: getDifficulty().id,
            ...(isExpedition() ? { mode: state.mode, missionId: state.expedition.missionId, victory: !!state.victory } : {}),
          });
        }
      } else {
        log(`第 ${state.wave} 波清空！+${bonus} 金`);
      }
      celebrateWaveClear(state.wave, bonus, clean);
      notifyUI();
      if (isExpedition() && state.expedition.completed) {
        state.victory = true;
        gameOver();
      }
    }
  }
  // 敵人漏過終點 = 攻擊守護女神
  function leak(e) {
    if (e._leaked || e._dead) return;
    e._leaked = true;
    if (e._waveTracked) {
      state.waveResolved = Math.min(state.waveTotal || Infinity, (state.waveResolved || 0) + 1);
      e._waveTracked = false;
    }
    let dmg = Math.round(e.leak * (e.boss ? 4 : 3) * affixMul("leakDamageMul")); // 漏過對女神造成的傷害
    const ward = expeditionModifier("firstLeakWardPerWave");
    if (ward > 0 && !state.betweenWaves && !state.expeditionLeakWardUsed) {
      dmg *= ward; state.expeditionLeakWardUsed = true;
    }
    const telemetry = state.combatTelemetry && state.combatTelemetry.waves[state.wave];
    if (telemetry) {
      telemetry.leaks += 1;
      telemetry.goddessDamage += dmg;
    }
    state.runLeaks = state.runLeaks || { total: 0, byWave: {} };
    const waveKey = String(Math.max(1, state.wave || 1));
    const waveEntry = state.runLeaks.byWave[waveKey] || { count: 0, damage: 0, byType: {} };
    waveEntry.count += 1;
    waveEntry.damage += dmg;
    const type = ENEMIES[e.type] ? e.type : (ENEMIES[e.id] ? e.id : "slime");
    waveEntry.byType[type] = (waveEntry.byType[type] || 0) + 1;
    state.runLeaks.byWave[waveKey] = waveEntry;
    state.runLeaks.total += 1;
    state.waveLeaks = (state.waveLeaks || 0) + 1;
    state.cleanStreak = 0;
    state.goddess.hp -= dmg;
    state.goddess.hitFlash = reducedEffectsEnabled() ? 0 : 0.4;
    state.redVignette = reducedEffectsEnabled() ? 0 : Math.max(state.redVignette || 0, 0.55);
    burst(state.goddess.x, state.goddess.y, "#ef4444", 14, { criticalFx: true, fxKind: "leak-warning" });
    playSfx("leak");
    log(`${e.name} 攻擊了${GODDESS.name}！-${dmg} 生命`, "bad");
    if (state.goddess.hp <= 0) { state.goddess.hp = 0; gameOver(); }
    notifyUI();
  }

  // ===== 英雄系統 =====
  // 上場：在女神（終點）附近放一個英雄
  function deployHero(heroId, progress) {
    const def = HEROES[heroId];
    if (!def) return false;
    const end = state.path[state.path.length - 1];
    const longLevel = progress && typeof progress.level === "number" ? progress.level : heroLongLevelFromProgress(progress);
    const longBonus = heroLongBonusFromProgress(progress);
    const baseHero = { id: heroId, level: 1, longBonus };
    const maxHp = heroBattleStat(baseHero, "hp");
    const h = {
      id: heroId, level: 1, xp: 0, startLevel: 1, startXp: 0, runXp: 0, levelsGained: 0, longLevel, longBonus,
      x: end.x - 60 + (Math.random() * 40 - 20), y: end.y - 60 + (Math.random() * 40 - 20),
      hp: maxHp, maxHp,
      facing: "down", cd: 0, hitFlash: 0, uid: "h" + (Math.random() * 1e9 | 0),
      walkDist: 0, animSeed: Math.random(), moving: false,
      attackPhase: "idle", attackTimer: 0, attackTarget: null, attackConnected: false,
    };
    // A sprite's full footprint must start on land, including the lava shoreline.
    if (TDRules.mapWalkable && !TDRules.mapWalkable(state.mapDef, h.x, h.y, HERO_NAV_RADIUS)) {
      const candidates = [{ x: end.x - 50, y: end.y - 50 }, end].concat(state.mapDef.buildPads || []);
      const safe = candidates.find((point) => TDRules.mapWalkable(state.mapDef, point.x, point.y, HERO_NAV_RADIUS));
      if (!safe) return false;
      h.x = safe.x; h.y = safe.y;
    }
    state.heroes.push(h);
    const loreData = getLore();
    const quote = typeof loreData.deployQuoteFor === "function" ? loreData.deployQuoteFor(heroId) : "";
    if (quote) {
      log(`${def.name}：「${quote}」`);
      flashText(h.x, h.y - 24, quote.slice(0, 8), { color: "#fde047", size: 13, big: true }); // flashText 內建尊重 reducedEffects
    } else {
      log(`${def.name} 上場！`);
    }
    notifyUI();
    return true;
  }

  function selectHeroGuard(uid) {
    const h = state.heroes.find((hero) => hero.uid === uid);
    if (!h) return false;
    cancelTouchPlacement(true);
    state.pendingHero = h.uid;
    state.selectedTowerType = null;
    state.selectedTower = null;
    state.pendingSkill = null;
    state.buildGhost = null;
    canvas.style.cursor = "crosshair";
    log(`已選 ${HEROES[h.id].name}，點地圖指定駐守點。`);
    notifyUI();
    return true;
  }

  const HERO_GUARD_RADIUS = 130; // 駐守英雄的防守範圍
  const HERO_ATTACK_PHASE = Object.freeze({
    IDLE: "idle", ANTICIPATION: "anticipation", IMPACT: "impact", RECOVERY: "recovery",
  });

  function heroAttackPhaseDuration(def, phase) {
    const interval = 1 / def.atkRate;
    if (phase === HERO_ATTACK_PHASE.ANTICIPATION) return Math.max(0.1, Math.min(0.24, interval * 0.28));
    if (phase === HERO_ATTACK_PHASE.IMPACT) return Math.max(0.055, Math.min(0.09, interval * 0.12));
    if (phase === HERO_ATTACK_PHASE.RECOVERY) return Math.max(0.12, Math.min(0.28, interval * 0.3));
    return 0;
  }

  function updateHero(h, dt) {
    const def = HEROES[h.id];
    h.moving = false;
    if (h.hitFlash > 0) h.hitFlash = Math.max(0, h.hitFlash - dt);
    h.cd = Math.max(0, (h.cd || 0) - dt);
    if (updateHeroAttack(h, dt)) return;
    // 待命/駐守點：有 guardPoint 用駐守點，否則女神身邊
    const homeX = h.guardPoint ? h.guardPoint.x : state.goddess.x - 50;
    const homeY = h.guardPoint ? h.guardPoint.y : state.goddess.y - 50;
    // 尋找敵人；駐守模式只鎖定駐守範圍內的敵人
    let target = null, best = Infinity;
    for (const e of state.enemies) {
      if (e._dead || e._leaked) continue;
      const d = (e.x - h.x) ** 2 + (e.y - h.y) ** 2;
      // 駐守模式：只打駐守點半徑內的敵人（不追遠的）
      if (h.guardPoint) {
        const dh = (e.x - homeX) ** 2 + (e.y - homeY) ** 2;
        if (dh > (HERO_GUARD_RADIUS + def.range) ** 2) continue;
      }
      if (d < best) { best = d; target = e; }
    }
    if (!target) {
      moveHeroAlongTerrain(h, homeX, homeY, heroBattleStat(h, "speed"), dt, "home");
      return;
    }
    const range = def.range;
    if (best > range * range) {
      moveHeroAlongTerrain(h, target.x, target.y, heroBattleStat(h, "speed"), dt, target.uid || target.seq || target.type);
    } else {
      faceToward(h, target.x, target.y);
      if (h.cd <= 0) heroAttack(h, target);
    }
  }

  // 設定朝向（四方向精靈圖切換用）
  function faceToward(h, tx, ty) {
    const dx = tx - h.x, dy = ty - h.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (Math.abs(dx) > Math.abs(dy)) h.facing = dx > 0 ? "right" : "left";
    else h.facing = dy > 0 ? "down" : "up";
  }

  function moveToward(h, tx, ty, speed, dt) {
    const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d < .001) return;
    faceToward(h, tx, ty); // 先定朝向，再移動
    const step = Math.min(d, speed * dt);
    h.x += (dx / d) * step; h.y += (dy / d) * step;
    h.walkDist = (h.walkDist || 0) + step;
    h.moving = step > 0;
  }

  function queryHeroRoute(start, goal) {
    const started = performance.now();
    const route = TDRules.heroRoute(state.mapDef, start, goal, { cellSize: HERO_NAV_CELL, radius: HERO_NAV_RADIUS });
    const elapsed = performance.now() - started;
    engineMetrics.navQueries++; engineMetrics.navQueryMs += elapsed;
    engineMetrics.navQueryMaxMs = Math.max(engineMetrics.navQueryMaxMs, elapsed);
    if (!route.reachable) engineMetrics.navQueryFailures++;
    return route;
  }

  function moveHeroAlongTerrain(h, tx, ty, speed, dt, intent) {
    if (state.debugIgnoreTerrain || !TDRules.heroRoute) { moveToward(h, tx, ty, speed, dt); return; }
    const goal = { x: Math.max(HERO_NAV_RADIUS, Math.min(W - HERO_NAV_RADIUS, tx)),
      y: Math.max(HERO_NAV_RADIUS, Math.min(H - HERO_NAV_RADIUS, ty)) };
    const key = `${intent}:${Math.floor(goal.x / HERO_NAV_CELL)},${Math.floor(goal.y / HERO_NAV_CELL)}`;
    let nav = h.navigation;
    const displaced = nav && nav.goal ? Math.hypot(goal.x - nav.goal.x, goal.y - nav.goal.y) : Infinity;
    // Follow an already safe corridor while a distant target moves a few
    // pixels. Replan on a material displacement, return/guard intent, failed
    // route, or end of the corridor; don't bunch eight A* calls at each cell.
    if (!nav || nav.key !== key && (!nav.reachable || intent === "home" || nav.intent === "home" ||
      displaced > HERO_NAV_CELL * 3 || nav.index >= nav.points.length)) {
      const route = queryHeroRoute(h, goal);
      nav = h.navigation = { key, intent, goal, points: route.points, index: 0, reachable: route.reachable };
    }
    if (!nav.reachable) return;
    // Changing target pixels inside one navigation cell only updates the final
    // leg after it is reached; never run A* once per hero per simulation tick.
    if (nav.index >= nav.points.length) {
      if (Math.hypot(goal.x - h.x, goal.y - h.y) < 2) return;
      if (!TDRules.lineWalkable(state.mapDef, h, goal, HERO_NAV_RADIUS)) {
        const route = queryHeroRoute(h, goal);
        nav = h.navigation = { key, intent, goal, points: route.points, index: 0, reachable: route.reachable };
        if (!nav.reachable) return;
      } else { nav.points = [goal]; nav.index = 0; }
    }
    let remaining = Math.max(0, speed * dt);
    while (remaining > 0 && nav.index < nav.points.length) {
      const point = nav.points[nav.index], distance = Math.hypot(point.x - h.x, point.y - h.y);
      if (distance < .001) { nav.index++; continue; }
      const step = Math.min(distance, remaining);
      moveToward(h, point.x, point.y, speed, step / speed);
      remaining -= step;
      if (step >= distance - .001) nav.index++;
    }
  }

  // 攻擊輸入只進入前搖；此函式不得造成傷害或建立子彈。
  function heroAttack(h, target) {
    const def = HEROES[h.id];
    if (!target || target._dead || target._leaked || (h.attackPhase && h.attackPhase !== HERO_ATTACK_PHASE.IDLE)) return false;
    faceToward(h, target.x, target.y);
    h.attackPhase = HERO_ATTACK_PHASE.ANTICIPATION;
    h.attackTimer = heroAttackPhaseDuration(def, HERO_ATTACK_PHASE.ANTICIPATION);
    h.attackTarget = target;
    h.attackConnected = false;
    h.cd = 1 / def.atkRate;
    return true;
  }

  function updateHeroAttack(h, dt) {
    if (!h.attackPhase || h.attackPhase === HERO_ATTACK_PHASE.IDLE) return false;
    const def = HEROES[h.id];
    let remaining = Math.max(0, dt);
    while (h.attackPhase !== HERO_ATTACK_PHASE.IDLE && remaining >= h.attackTimer) {
      remaining -= h.attackTimer;
      if (h.attackPhase === HERO_ATTACK_PHASE.ANTICIPATION) {
        h.attackPhase = HERO_ATTACK_PHASE.IMPACT;
        h.attackTimer = heroAttackPhaseDuration(def, HERO_ATTACK_PHASE.IMPACT);
        resolveHeroAttackImpact(h);
      } else if (h.attackPhase === HERO_ATTACK_PHASE.IMPACT) {
        h.attackPhase = HERO_ATTACK_PHASE.RECOVERY;
        h.attackTimer = heroAttackPhaseDuration(def, HERO_ATTACK_PHASE.RECOVERY);
      } else {
        h.attackPhase = HERO_ATTACK_PHASE.IDLE;
        h.attackTimer = 0;
        h.attackTarget = null;
      }
    }
    if (h.attackPhase !== HERO_ATTACK_PHASE.IDLE) h.attackTimer -= remaining;
    return true;
  }

  function resolveHeroAttackImpact(h) {
    const def = HEROES[h.id];
    const target = h.attackTarget;
    if (!target || target._dead || target._leaked) return false;
    const activeRange = def.range + (def.role === "ranged" ? 12 : 18);
    if (Math.hypot(target.x - h.x, target.y - h.y) > activeRange) return false; // 揮空：impact 無命中
    const atk = heroBattleStat(h, "atk");
    h.attackConnected = true;
    if (def.role === "ranged") {
      // 遠程 active hitbox 只在 impact 幀建立；實際傷害仍由子彈碰撞結算。
      state.bullets.push({
        x: h.x, y: h.y, target, speed: 360, color: def.color,
        damage: atk, element: def.element, splash: def.splash || 0, slow: def.slow || 0,
        pierce: projectilePierce(def.element, 0, def.splash) || 0,
        projectile: PROJECTILE_BY_ELEMENT[def.element] || "arrow",
        _heroOwner: h, activeHitbox: true, attackPhase: HERO_ATTACK_PHASE.IMPACT,
      });
    } else {
      // 近戰：直接造成傷害；有 pierce 時一次掃中多名貼近敵人（孫悟空的連打感）
      const targets = [target];
      if ((def.pierce || 1) > 1) {
        const extra = state.enemies
          .filter((e) => e !== target && !e._dead && Math.hypot(e.x - h.x, e.y - h.y) <= def.range + 18)
          .sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))
          .slice(0, (def.pierce || 1) - 1);
        targets.push(...extra);
      }
      for (const t of targets) {
        const mult = elementMultiplier(def.element, t.element);
        applyDamage(t, atk * mult, { source: "hero", element: def.element, attackPhase: HERO_ATTACK_PHASE.IMPACT });
        burst(t.x, t.y, def.color, 8);
        if (t.hp <= 0) { killEnemy(t); grantXp(h, t); }
      }
    }
    // 牧師治療女神
    if (def.healGoddess) {
      state.goddess.hp = Math.min(state.goddess.maxHp, state.goddess.hp + def.healGoddess);
    }
    return true;
  }

  // 英雄獲得經驗並升級
  function grantXp(h, enemy) {
    const def = HEROES[h.id];
    if (h.level >= HERO_LEVEL.maxLevel) return;
    const gained = HERO_LEVEL.xpPerKill * (enemy.boss ? 5 : 1);
    h.xp += gained;
    h.runXp = (h.runXp || 0) + gained;
    while (h.level < HERO_LEVEL.maxLevel && h.xp >= xpForLevel(h.level)) {
      h.xp -= xpForLevel(h.level);
      h.level++;
      h.levelsGained = (h.levelsGained || 0) + 1;
      const newMax = heroBattleStat(h, "hp");
      h.hp = newMax; h.maxHp = newMax; // 升級回滿
      burst(h.x, h.y, "#fde047", 20);
      flashText(h.x, h.y, "LV UP!");
      log(`${def.name} 升到 ${h.level} 級！`);
    }
    notifyUI();
  }

  function spawnSplitBat(parent) {
    if (!parent || parent._splitChild || !parent.ability || parent.ability.id !== "splitBat") return;
    const childHp = Math.max(1, Math.round((parent.maxHp || ENEMIES.bat.hp) * (parent.ability.childHpMul || 0.45)));
    const childReward = Math.max(1, Math.round((parent.reward || ENEMIES.bat.reward) * (parent.ability.childRewardMul || 0.35)));
    const child = createEnemy({ type: "bat", hpScale: 1 }, {
      x: parent.x,
      y: parent.y,
      wp: parent.wp,
      hp: childHp,
      maxHp: childHp,
      shield: 0,
      maxShield: 0,
      speed: (parent.speed || ENEMIES.bat.speed) * 1.08,
      reward: childReward,
      leak: 1,
      name: "小蝙蝠",
      ability: null,
      _splitChild: true,
      color: "#a78bfa",
    });
    state.enemies.push(child);
    flashText(parent.x, parent.y - 16, "分裂", { color: "#c4b5fd", size: 13 });
  }

  // 擊殺
  function killEnemy(e) {
    if (e._dead || e._leaked) return;
    e._dead = true;
    e.deathStartedAt = state.clock;
    e.deathDuration = ENEMY_ANIMATION_ATLAS.deathDuration;
    if (e._waveTracked) {
      state.waveResolved = Math.min(state.waveTotal || Infinity, (state.waveResolved || 0) + 1);
      e._waveTracked = false;
    }
    spawnSplitBat(e);
    // D5 連殺：累積 combo，倍率提升金錢/分數
    state.combo++;
    state.comboTimer = 2.5; // 2.5 秒內再擊殺才接續
    state.kills++;
    const comboMul = 1 + Math.min(state.combo - 1, 20) * 0.05; // 每連殺 +5%，上限 +100%
    const reward = Math.round(e.reward * comboMul) + expeditionModifier("killGoldBonus");
    state.gold += reward;
    const telemetry = state.combatTelemetry && state.combatTelemetry.waves[state.wave];
    if (telemetry) {
      telemetry.kills += 1;
      telemetry.killGold += reward;
      if (e.boss) {
        telemetry.bossKills += 1;
        telemetry.bossGold += reward;
      }
    }
    state.score += reward;
    burst(e.x, e.y, e.color, e.boss ? 30 : 12, e.boss ? { criticalFx: true, fxKind: "boss" } : null);
    deathBurst(e);
    coinFloat(e.x, e.y, reward);
    playSfx(e.boss ? "boss" : "kill");
    if (e.boss) {
      state.bossKills = (state.bossKills || 0) + 1;
      state.slowMoLeft = reducedEffectsEnabled() ? 0 : 0.2;
      state.slowMoScale = 0.35;
      ring(e.x, e.y, "#fde047", 70, { criticalFx: true, fxKind: "boss" });
      screenShake();
    }
    // combo 達門檻時畫面跳大數字
    if (state.combo >= 3 && !window.__tdBattleChrome) flashText(e.x, e.y - 12, `COMBO x${state.combo}`, { color: "#fde047", size: 14 + Math.min(state.combo, 10), big: true });
    notifyUI();
  }

  // ===== 塔瞄準與射擊 =====
  function towerStat(tw, key) {
    const base = TOWERS[tw.type][key];
    if (key === "damage") return (base || 0) * Math.pow(UPGRADE.damageMul, tw.level - 1) * affixMul("towerDamageMul") * eventMul("towerDamageMul");
    if (key === "poisonDps") return (base || 0) * Math.pow(UPGRADE.poisonDpsMul || UPGRADE.damageMul, tw.level - 1) * affixMul("towerDamageMul") * eventMul("towerDamageMul") * expeditionModifier("poisonDpsMul");
    if (key === "pierce") return projectilePierce(TOWERS[tw.type].element, base, TOWERS[tw.type].splash);
    if (key === "splash" && tw.type === "cannon") return base * expeditionModifier("cannonSplashMul");
    if (key === "slowDuration") return TOWERS[tw.type].slow ? 1.5 * (tw.type === "frost" ? expeditionModifier("frostDurationMul") : 1) : 0;
    if (key === "range") return base * Math.pow(UPGRADE.rangeMul, tw.level - 1) * affixMul("towerRangeMul");
    if (key === "minRange") return base || 0;
    if (key === "buff") return (base || 0) + (tw.level - 1) * (TOWERS[tw.type].buffPerLevel || 0);
    return base;
  }
  function supportBuffFor(tw, excludeSupport) {
    let best = 0;
    for (const support of state.towers) {
      if (support === tw || support === excludeSupport || !TOWERS[support.type].support) continue;
      const range = towerStat(support, "range");
      if (Math.hypot(support.x - tw.x, support.y - tw.y) <= range) best = Math.max(best, towerStat(support, "buff"));
    }
    return best;
  }
  function effectiveTowerDamage(tw) {
    return towerStat(tw, "damage") * (1 + supportBuffFor(tw));
  }
  function towerDpsEstimate(tw) {
    const def = TOWERS[tw.type];
    if (!def || def.support) return 0;
    let dps = towerStat(tw, "damage") * (def.fireRate || 0);
    if (towerStat(tw, "splash")) dps *= 2.2;
    const pierce = towerStat(tw, "pierce");
    if (pierce) dps *= (1 + (pierce - 1) * 0.6);
    return dps;
  }
  function supportDpsGain(support) {
    if (!support || !TOWERS[support.type] || !TOWERS[support.type].support) return 0;
    const range = towerStat(support, "range");
    const buff = towerStat(support, "buff");
    return state.towers.reduce((sum, tw) => {
      if (tw === support || TOWERS[tw.type].support) return sum;
      if (Math.hypot(tw.x - support.x, tw.y - support.y) > range) return sum;
      const otherBuff = supportBuffFor(tw, support);
      const marginalBuff = Math.max(0, buff - otherBuff);
      return sum + towerDpsEstimate(tw) * marginalBuff;
    }, 0);
  }
  function acquireTarget(tw) {
    const def = TOWERS[tw.type];
    if (!def || def.support) return null;
    const priority = getTowerPriority(tw) || "auto";
    const range = towerStat(tw, "range");
    const minRange = towerStat(tw, "minRange") || 0;
    let best = null, bestScore = -Infinity, bestProgress = -Infinity;
    for (const e of state.enemies) {
      if (e._dead || e._leaked || e.hp <= 0) continue;
      const d = (e.x - tw.x) ** 2 + (e.y - tw.y) ** 2;
      if (d <= range * range && d >= minRange * minRange) {
        const target = state.path[e.wp];
        const prev = state.path[Math.max(0, e.wp - 1)];
        const segLen = state.pathSegmentLengths[e.wp] || (target && prev ? Math.max(1, Math.hypot(target.x - prev.x, target.y - prev.y)) : 1);
        const distToWaypoint = target ? Math.hypot(target.x - e.x, target.y - e.y) : 0;
        const prog = e.wp - Math.min(1, distToWaypoint / segLen); // 越前面越優先
        let score = prog;
        if (priority === "auto" && def.targetPriority === "midpath") {
          const ratio = Math.max(0, Math.min(1, (e.walkDist || 0) / (state.pathTotalLength || 1)));
          score = 100 - Math.abs(ratio - 0.55) * 100 + prog * 0.001;
        }
        if (priority === "boss") score = e.boss ? 1 : 0;
        else if (priority === "strong") score = Math.max(0, Number(e.hp) || 0) + Math.max(0, Number(e.shield) || 0);
        if (score > bestScore || (priority !== "auto" && score === bestScore && prog > bestProgress)) {
          bestScore = score; bestProgress = prog; best = e;
        }
      }
    }
    return best;
  }
  function getTowerPriority(tower) {
    const tw = tower || state && state.selectedTower;
    const def = tw && TOWERS[tw.type];
    if (!def || def.support) return null;
    return Object.prototype.hasOwnProperty.call(TOWER_PRIORITIES, tw.targetMode) ? tw.targetMode : "auto";
  }
  function setTowerPriority(tower, priority) {
    if (!state || state.over || !tower || !state.towers.includes(tower) || getTowerPriority(tower) === null ||
      !Object.prototype.hasOwnProperty.call(TOWER_PRIORITIES, priority)) return false;
    // This is a targeting preference, not another attack input. Keep cooldown,
    // already-launched projectiles and impact-time damage exactly as they are.
    tower.targetMode = priority;
    notifyUI();
    return true;
  }
  // 塔/元素對應的投射物圖
  const PROJECTILE_BY_TOWER = { arrow: "arrow", cannon: "cannonball", frost: "iceshard", tesla: "lightning", poison: "arrow", sniper: "arrow", arcane: "lightning", mortar: "fireball" };
  const PROJECTILE_BY_ELEMENT = { physical: "arrow", fire: "fireball", ice: "iceshard", thunder: "lightning" };

  function fire(tw, target) {
    if (!target || target._dead || target._leaked) return false;
    const def = TOWERS[tw.type];
    const poisonDps = towerStat(tw, "poisonDps");
    muzzleFlash(tw, target);
    playSfx("fire");
    state.bullets.push({
      x: tw.x, y: tw.y, target, speed: def.id === "mortar" ? 250 : 320, color: def.color,
      damage: effectiveTowerDamage(tw), element: def.element,
      splash: towerStat(tw, "splash") || 0, slow: def.slow || 0, slowDuration: towerStat(tw, "slowDuration"),
      pierce: towerStat(tw, "pierce") || 0, type: tw.type,
      poison: poisonDps ? { dps: poisonDps, duration: def.poisonDuration, maxStacks: def.poisonMaxStacks } : null,
      vuln: def.vuln || null,
      projectile: PROJECTILE_BY_TOWER[tw.type] || PROJECTILE_BY_ELEMENT[def.element],
    });
  }
  function hit(b) {
    if (b.splash) {
      // 範圍傷害
      for (const e of state.enemies) {
        if (e._dead || e._leaked || e.hp <= 0) continue;
        if (Math.hypot(e.x - b.target.x, e.y - b.target.y) <= b.splash) dealDamage(e, b);
      }
      burst(b.target.x, b.target.y, b.color, 12);
      if (b.type === "cannon") {
        texturedImpact("fire", b.target.x, b.target.y, b.color || "#fb923c", { fxKind: "cannon-impact" });
      }
      if (b.type === "mortar") {
        burst(b.target.x, b.target.y, b.color, 28);
        texturedImpact("mortar", b.target.x, b.target.y, b.color, { fxKind: "mortar-impact" });
        ring(b.target.x, b.target.y, b.color, Math.max(58, b.splash + 20));
        impactShake(false);
      }
    } else if (b.pierce) {
      // 穿透：主目標一定要吃到傷害，其餘依「距主目標的距離」排序取最近的——
      // 原本取 filter 後的前 N 個（＝生成順序），被瞄準的敵人可能反而完全沒受傷
      const near = state.enemies
        .filter((e) => !e._dead && !e._leaked && e.hp > 0 && Math.hypot(e.x - b.target.x, e.y - b.target.y) < 60)
        .sort((a, c) => Math.hypot(a.x - b.target.x, a.y - b.target.y) - Math.hypot(c.x - b.target.x, c.y - b.target.y));
      const hits = near.includes(b.target) ? near : [b.target, ...near];
      hits.slice(0, b.pierce).forEach((e) => dealDamage(e, b));
    } else {
      dealDamage(b.target, b);
      burst(b.target.x, b.target.y, b.color, 5); // 命中爆裂小特效
    }
  }
  function dealDamage(e, b) {
    if (!e || e._dead || e._leaked) return;
    const mult = elementMultiplier(b.element, e.element);
    // D6 塔協同：被減速或冰凍的敵人受傷 +25%（救活寒冰塔 → 成為增傷樞紐）
    const chilled = (e.slowUntil > state.clock) || (e.frozenUntil > state.clock);
    const synergy = chilled ? 1.25 : 1;
    const dmg = b.damage * mult * synergy;
    const dealt = applyDamage(e, dmg, { source: b._heroOwner ? "hero" : "tower", element: b.element });
    if (e._dodgedLastHit) return;
    if (dealt > 0) playSfx("hit");
    damageNumber(e.x, e.y, dealt || dmg, mult * synergy); // V2：傷害浮字（克制/協同放大變紅）
    if (b.poison) applyPoison(e, b.poison);
    if (b.vuln) markVulnerable(e, b.vuln.mult, b.vuln.duration);
    if (b.slow) { e.slowUntil = state.clock + (Number.isFinite(b.slowDuration) ? b.slowDuration : 1.5); e.slowFactor = 1 - b.slow; }
    // Splash 紋理只在爆心合成一次，避免命中 N 隻怪時疊成同色霧牆。
    if (b.type !== "mortar" && !(b.type === "cannon" && b.splash)) {
      if (b.poison) texturedImpact("poison", e.x, e.y, "#4ade80", { fxKind: "poison-hit" });
      else if (b.element === "ice") texturedImpact("ice", e.x, e.y, "#7dd3fc", { fxKind: "ice-hit" });
      else if (b.element === "thunder") texturedImpact("thunder", e.x, e.y, "#fde047", { fxKind: "thunder-hit" });
      else if (b.element === "fire") texturedImpact("fire", e.x, e.y, b.color || "#fb923c", { fxKind: "fire-hit" });
    }
    if (e.hp <= 0) { killEnemy(e); if (b._heroOwner && state.heroes.includes(b._heroOwner)) grantXp(b._heroOwner, e); }
  }

  // ===== 主動技能 =====
  function castSkill(skillId, x, y) {
    const sk = SKILLS[skillId];
    if (!sk || state.skillCooldowns[skillId] > 0 || isSkillLocked()) return false;
    const impactX = Number.isFinite(x) ? x : W / 2;
    const impactY = Number.isFinite(y) ? y : H / 2;
    const targets = state.enemies.filter((e) => !e._dead && !e._leaked && Math.hypot(e.x - impactX, e.y - impactY) <= sk.radius);
    if (!targets.length) {
      flashText(impactX, impactY - 18, "沒有目標", { color: "#f87171", size: 14, big: true });
      ring(impactX, impactY, "#f87171", Math.min(70, Math.max(34, sk.radius * 0.35)));
      log(`${sk.name} 沒有命中目標，未進入冷卻。`, "bad");
      notifyUI();
      return false;
    }
    state.skillCooldowns[skillId] = skillStat(skillId, "cooldown");
    state.skillCasts = (state.skillCasts || 0) + 1;
    let appliedHits = 0;
    for (const e of targets) {
      const mult = elementMultiplier(sk.element, e.element);
      const dealt = applyDamage(e, sk.damage * mult, { source: "skill", element: sk.element });
      if (e._reflectedLastHit) continue;
      if (sk.freezeDur) e.frozenUntil = state.clock + skillStat(skillId, "freezeDur");
      if (sk.rootDur) e.frozenUntil = state.clock + sk.rootDur;
      if (sk.vuln) markVulnerable(e, sk.vuln.mult, sk.vuln.duration);
      if (appliedHits < 5) {
        burst(e.x, e.y, sk.color, 12);
        if (FX_PROFILES[sk.element]) texturedImpact(sk.element, e.x, e.y, sk.color, { fxKind: `skill-hit-${sk.element}` });
      }
      if (dealt > 0) damageNumber(e.x, e.y, dealt, mult);
      appliedHits++;
      if (e.hp <= 0) killEnemy(e);
    }
    playSfx("skill");
    if (FX_PROFILES[sk.element]) texturedImpact(sk.element, impactX, impactY, sk.color, { fxKind: `skill-${sk.element}` });
    burst(impactX, impactY, sk.color, 40); ring(impactX, impactY, sk.color, sk.radius > 200 ? 180 : sk.radius + 30); // V2：技能擴張環
    log(`施放 ${sk.name}，命中 ${targets.length} 個目標！`);
    notifyUI();
    return true;
  }

  // ===== 建塔 / 升級 =====
  function buildPreviewFor(type, px, py) {
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    const def = TOWERS[type];
    const center = cellCenter(cx, cy);
    const buildRange = def ? def.range * affixMul("towerRangeMul") : 0;
    const reach = def ? cellReachInfo(cx, cy, buildRange) : { distance: Infinity, reachable: false };
    const pathDistance = reach.distance;
    const terrain = TDRules.mapBuildRestriction ? TDRules.mapBuildRestriction(state.mapDef, px, py, CELL) : null;
    let reason = "";
    if (!def) reason = "尚未選塔";
    else if (px < 0 || py < 0 || px >= W || py >= H) reason = "超出戰場";
    else if (terrain && terrain.blocked) reason = terrain.reason;
    else if (blocked.has(cellKey(cx, cy))) reason = "路徑上不能放";
    else if (state.towers.some((t) => t.cx === cx && t.cy === cy)) reason = "已有塔";
    else if (!reach.reachable) reason = "太遠打不到路徑";
    else if (state.gold < def.cost) reason = "金錢不足";
    return {
      ok: reason === "",
      reason,
      cx,
      cy,
      x: center.x,
      y: center.y,
      range: buildRange,
      type: def ? def.id : null,
      typeId: def ? def.id : null,
      cost: def ? def.cost : 0,
      pathDistance: Number.isFinite(pathDistance) ? Math.round(pathDistance) : null,
      terrainKind: terrain && terrain.kind || null,
      regionId: terrain && terrain.regionId || null,
    };
  }

  function buildPreviewAt(px, py) {
    return buildPreviewFor(state.selectedTowerType, px, py);
  }

  function buildOptionsAt(px, py) {
    return Object.values(TOWERS)
      .filter((def) => state.gold >= def.cost && buildPreviewFor(def.id, px, py).ok)
      .map((def) => def.id);
  }

  function tryBuildTower(px, py) {
    if (!state.selectedTowerType) return;
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    const preview = buildPreviewAt(px, py);
    if (!preview.ok) {
      log(preview.reason + "！", "bad");
      flashText(preview.x, preview.y - 18, preview.reason, { color: "#f87171", size: 14, big: true });
      return false;
    }
    const def = TOWERS[state.selectedTowerType];
    state.gold -= def.cost;
    state.towers.push({
      type: state.selectedTowerType, cx, cy,
      x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2,
      level: 1, cd: 0, order: state.towerSeq++, targetMode: "auto",
    });
    state.towersBuilt = (state.towersBuilt || 0) + 1;
    state.buildGhost = null;
    state.buildPlacementFeedback = "";
    state.buildMenuTarget = null;
    state.mouse = null;
    playSfx("build");
    log(`建造 ${def.name}！`);
    notifyUI();
    return true;
  }
  function upgradeTower(tw) {
    if (tw.level >= UPGRADE.maxLevel) { log("已達最高等級！", "bad"); return; }
    const cost = upgradeCost(tw);
    if (state.gold < cost) { log("金錢不足以升級！", "bad"); return; }
    state.gold -= cost;
    tw.level++;
    state.towerUpgrades = (state.towerUpgrades || 0) + 1;
    upgradeBeam(tw.x, tw.y, (TOWERS[tw.type] && TOWERS[tw.type].color) || "#fde047");
    log(`${TOWERS[tw.type].name} 升到 ${tw.level} 級！`);
    notifyUI();
  }
  function upgradeCost(tw) { return Math.round(TOWERS[tw.type].cost * Math.pow(UPGRADE.costMul, tw.level) * expeditionModifier("upgradeCostMul")); }
  function sellTower(tw) {
    const refund = Math.round(TOWERS[tw.type].cost * 0.6 * tw.level);
    state.gold += refund;
    state.towers = state.towers.filter((t) => t !== tw);
    state.selectedTower = null;
    log(`賣出 ${TOWERS[tw.type].name}，回收 ${refund} 金。`);
    notifyUI();
  }

  function buildTowerAt(type, px, py) {
    if (!TOWERS[type] || !Number.isFinite(px) || !Number.isFinite(py)) return false;
    cancelTouchPlacement(true);
    state.selectedTowerType = type;
    state.selectedTower = null;
    state.selectedGoddess = false;
    state.pendingSkill = null;
    state.advisorBuildConfirm = false;
    const built = !!tryBuildTower(px, py);
    state.selectedTowerType = null;
    state.buildGhost = null;
    state.buildMenuTarget = null;
    canvas.style.cursor = "default";
    notifyUI(true);
    return built;
  }

  function closeSceneMenus() {
    cancelTouchPlacement(true);
    state.buildMenuTarget = null;
    state.selectedTower = null;
    state.selectedGoddess = false;
    state.advisorUpgradeTarget = null;
    notifyUI(true);
  }

  // ===== 守護女神升級 =====
  function goddessUpgradeCost() {
    return Math.round(GODDESS.upgradeCostBase * Math.pow(GODDESS.upgradeCostMul, state.goddess.level - 1));
  }
  function upgradeGoddess() {
    const gd = state.goddess;
    if (gd.level >= GODDESS.maxLevel) { log("女神已達最高等級！", "bad"); return; }
    const cost = goddessUpgradeCost();
    if (state.gold < cost) { log("金錢不足以升級女神！", "bad"); return; }
    state.gold -= cost;
    gd.level++;
    gd.maxHp += GODDESS.hpPerLevel;
    gd.hp = gd.maxHp; // 升級回滿
    burst(gd.x, gd.y, "#fde047", 30);
    const unlocked = gd.level === GODDESS.smiteUnlockLevel ? "（解鎖聖光反擊！）" : "";
    log(`${GODDESS.name} 升到 ${gd.level} 級！生命上限 +${GODDESS.hpPerLevel} ${unlocked}`);
    notifyUI();
  }

  // ===== 粒子 =====
  const fxTintCache = {};
  const FX_PROFILES = {
    mortar: [
      { texture: "flash", size: 92, life: 0.32, blend: "lighter", curve: "flash" },
      { texture: "fire", size: 118, life: 0.52, blend: "lighter", curve: "body" },
      { texture: "smoke", size: 126, life: 0.78, driftY: -22, curve: "smoke" },
    ],
    death: [
      { texture: "flash", size: 50, life: 0.28, blend: "lighter", curve: "flash" },
      { texture: "smoke", size: 60, life: 0.52, driftY: -16, curve: "smoke" },
    ],
    boss: [
      { texture: "flash", size: 210, life: 0.42, blend: "lighter", curve: "flash" },
      { texture: "fire", size: 176, life: 0.72, blend: "lighter", curve: "body" },
      { texture: "smoke", size: 230, life: 1.0, driftY: -30, curve: "smoke" },
      { texture: "magic", size: 190, life: 0.86, blend: "lighter", spin: 1.4, curve: "body" },
    ],
    poison: [
      { texture: "magic", size: 58, life: 0.48, blend: "lighter", spin: 1.8, curve: "body" },
      { texture: "smoke", size: 48, life: 0.58, driftY: -14, curve: "smoke" },
    ],
    ice: [
      { texture: "ice", size: 66, life: 0.46, blend: "lighter", spin: -1.1, curve: "body" },
      { texture: "flash", size: 48, life: 0.30, blend: "lighter", curve: "flash" },
    ],
    thunder: [
      { texture: "spark", size: 72, life: 0.38, blend: "lighter", spin: 2.4, curve: "body" },
      { texture: "flash", size: 44, life: 0.28, blend: "lighter", curve: "flash" },
    ],
    fire: [
      { texture: "fire", size: 64, life: 0.46, blend: "lighter", curve: "body" },
      { texture: "flash", size: 48, life: 0.28, blend: "lighter", curve: "flash" },
    ],
  };
  function tintedFxSprite(texture, color) {
    const path = FX_TEXTURES[texture];
    if (!path) return null;
    const im = getImg(path, true);
    if (!im || !im.complete || !(im.naturalWidth || im.width)) return null;
    const key = `${texture}:${color || "#ffffff"}`;
    if (fxTintCache[key]) return fxTintCache[key];
    const c = document.createElement("canvas");
    c.width = 192; c.height = 192;
    const cx = c.getContext("2d");
    cx.drawImage(im, 0, 0, c.width, c.height);
    cx.globalCompositeOperation = "source-in";
    cx.fillStyle = color || "#ffffff";
    cx.fillRect(0, 0, c.width, c.height);
    // 把原圖灰階亮暗重新乘回 tint，再輕量 screen 高光；保留 Kenney 的體積而非單色剪影。
    cx.globalCompositeOperation = "multiply";
    cx.drawImage(im, 0, 0, c.width, c.height);
    cx.globalCompositeOperation = "screen";
    cx.globalAlpha = 0.28;
    cx.drawImage(im, 0, 0, c.width, c.height);
    cx.globalAlpha = 1;
    cx.globalCompositeOperation = "source-over";
    fxTintCache[key] = c;
    return c;
  }
  function texturedImpact(kind, x, y, color, opts) {
    if (reducedEffectsEnabled()) return 0;
    opts = opts || {};
    const profile = FX_PROFILES[kind] || FX_PROFILES.death;
    const layers = performanceLow() ? profile.slice(0, 1) : profile;
    let added = 0;
    for (const layer of layers) {
      const scale = performanceLow() ? 0.78 : 1;
      const jitteredLife = layer.life * (0.92 + effectRand() * 0.16);
      const life = layer.curve === "flash" ? Math.max(0.28, jitteredLife) : jitteredLife;
      const accepted = pushParticle({
        x, y, vx: 0, vy: layer.driftY || 0, life, startLife: life,
        color: color || "#ffffff", texture: layer.texture, size: layer.size * scale,
        rotation: effectRand() * Math.PI * 2, spin: layer.spin || (effectRand() - 0.5) * 1.2,
        blend: layer.blend || "source-over", textureAlpha: layer.texture === "flash" ? 1 : layer.texture === "smoke" ? 0.66 : 0.9,
        impactCurve: layer.curve || "body",
        criticalFx: !!opts.criticalFx, fxKind: opts.fxKind || `texture-${kind}`,
      });
      if (accepted) added++;
    }
    return added;
  }
  function preloadFxTextures() {
    Object.values(FX_TEXTURES).forEach((path) => getImg(path, true));
  }
  function fxCacheStats() {
    return { tinted: Object.keys(fxTintCache).length, sources: Object.keys(FX_TEXTURES).length };
  }
  // 粒子爆裂（V2：初速差異化 + 重力 + 大小隨機，更有打擊感）
  function particlePriority(p) {
    if (!p) return PARTICLE_PRIORITY.decor;
    if (p.criticalFx) return PARTICLE_PRIORITY.warning;
    if (p.text && p.toX == null) return PARTICLE_PRIORITY.text;
    return PARTICLE_PRIORITY.decor;
  }
  function evictParticle(predicate, incomingPriority) {
    let evictIndex = -1;
    let evictPriority = Infinity;
    for (let i = 0; i < state.particles.length; i++) {
      const candidate = state.particles[i];
      if (!candidate || candidate.criticalFx || (predicate && !predicate(candidate))) continue;
      const priority = particlePriority(candidate);
      if (priority <= incomingPriority && priority < evictPriority) {
        evictPriority = priority;
        evictIndex = i;
      }
    }
    if (evictIndex < 0) return false;
    state.particles.splice(evictIndex, 1);
    return true;
  }
  function pushParticle(p, allowReduced) {
    if (!state || (reducedEffectsEnabled() && !allowReduced)) return false;
    const priority = particlePriority(p);
    if (p.text) {
      let textCount = 0, coinCount = 0;
      for (const existing of state.particles) {
        if (existing.text) textCount++;
        if (existing.toX != null) coinCount++;
      }
      if (textCount >= MAX_TEXT_PARTICLES && !(p.criticalFx && evictParticle((x) => x.text, priority))) return false;
      if (p.toX != null) {
        if (coinCount >= MAX_COIN_PARTICLES && !(p.criticalFx && evictParticle((x) => x.toX != null, priority))) return false;
      }
    }
    if (p.ring) {
      let ringCount = 0;
      for (const existing of state.particles) if (existing.ring) ringCount++;
      if (ringCount >= MAX_RING_PARTICLES && !(p.criticalFx && evictParticle((x) => x.ring, priority))) return false;
    }
    while (state.particles.length >= MAX_PARTICLES) {
      if (!evictParticle(null, priority)) return false;
    }
    state.particles.push(p);
    return true;
  }
  function burst(x, y, color, n, opts) {
    if (reducedEffectsEnabled()) return;
    opts = opts || {};
    const lowScale = opts.criticalFx ? 0.34 : 0.45;
    const count = performanceLow() ? Math.max(1, Math.round((n || 1) * lowScale)) : n;
    for (let i = 0; i < count; i++) {
      const a = effectRand() * Math.PI * 2, sp = 50 + effectRand() * 160;
      pushParticle({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50,
        life: 0.35 + effectRand() * 0.35, color, r: 1.5 + effectRand() * 2,
        criticalFx: !!opts.criticalFx, fxKind: opts.fxKind || null });
    }
  }
  function deathBurst(e) {
    if (!e || reducedEffectsEnabled()) return;
    const color = e.color || "#fde047";
    texturedImpact(e.boss ? "boss" : "death", e.x, e.y, color,
      e.boss ? { criticalFx: true, fxKind: "boss" } : { fxKind: "enemy-death" });
    burst(e.x, e.y, color, e.boss ? 72 : 22, e.boss ? { criticalFx: true, fxKind: "boss" } : null);
    ring(e.x, e.y, color, e.boss ? 135 : 42, e.boss ? { criticalFx: true, fxKind: "boss" } : null);
    if (e.boss) ring(e.x, e.y, "#fff7ed", 190, { criticalFx: true, fxKind: "boss" });
  }
  function coinFloat(x, y, amount) {
    if (reducedEffectsEnabled()) return;
    pushParticle({
      x, y: y - 16, vx: 0, vy: 0, life: 0.92, color: "#facc15", text: `+${amount}G`,
      size: 16, big: true, toX: 42, toY: 18, flySpeed: 3.8, fxKind: "coin",
    });
  }
  function muzzleFlash(tw, target) {
    if (!tw || reducedEffectsEnabled()) return;
    const a = target ? Math.atan2(target.y - tw.y, target.x - tw.x) : -Math.PI / 2;
    pushParticle({ x: tw.x + Math.cos(a) * 18, y: tw.y + Math.sin(a) * 18,
      vx: 0, vy: 0, life: 0.12, color: (TOWERS[tw.type] && TOWERS[tw.type].color) || "#fde047",
      muzzle: true, angle: a, r: tw.type === "mortar" ? 22 : 14, fxKind: "muzzle" });
  }
  function upgradeBeam(x, y, color) {
    if (reducedEffectsEnabled()) return;
    pushParticle({ x, y, vx: 0, vy: 0, life: 0.48, color: color || "#fde047", beam: true, maxR: 58, r0: 10, fxKind: "upgrade" });
    ring(x, y, color || "#fde047", 56);
  }
  function impactShake(strong) {
    if (reducedEffectsEnabled()) return;
    screenShake(strong ? 360 : 180);
  }
  // 擴張環特效（技能命中、Boss 死亡等）
  function ring(x, y, color, maxR, opts) {
    if (reducedEffectsEnabled()) return;
    opts = opts || {};
    if (performanceLow() && state.particles.length > 24 && !opts.criticalFx) return;
    pushParticle({ x, y, vx: 0, vy: 0, life: 0.5, color, ring: true, maxR: (maxR || 60) * (performanceLow() ? 0.78 : 1), r0: 6,
      criticalFx: !!opts.criticalFx, fxKind: opts.fxKind || null });
  }
  // 螢幕震動（Boss 擊殺、清場技等強回饋）— 對 canvas 加 CSS 震動 class
  function screenShake() {
    if (!canvas) return;
    if (reducedEffectsEnabled()) return;
    canvas.classList.add("shake");
    setTimeout(() => canvas.classList.remove("shake"), 300);
  }
  // 浮動文字（升級/傷害數字）；opts: {color, size, big}
  function flashText(x, y, text, opts) {
    opts = opts || {};
    if (reducedEffectsEnabled() && !opts.forceReducedText) return;
    pushParticle({ x, y, vx: (effectRand() - 0.5) * 20, vy: -55,
      life: opts.big ? 1.0 : 0.8, color: opts.color || "#fde047", text,
      size: opts.size || 13, big: opts.big, criticalFx: !!opts.criticalFx, fxKind: opts.fxKind || null }, !!opts.forceReducedText);
  }
  // 傷害數字（克制時放大變紅 + 擴張環）
  function damageNumber(x, y, amount, mult) {
    const weak = mult > 1.2;     // 克制
    const resist = mult < 0.9;   // 被抗
    flashText(x, y - 6, (weak ? "" : "") + Math.round(amount) + (weak ? "!" : ""),
      { color: weak ? "#fca5a5" : resist ? "#9ca3af" : "#fde047", size: weak ? 17 : 13, big: weak });
  }

  function gameOver() {
    if (state.over) return; // 重入保護：同一幀多隻敵人 leak 會觸發多次，魂晶/場次會被重複結算
    cancelTouchPlacement(true);
    state.over = true; state.running = false;
    log(state.victory ? `🏆 遠征完成！通過 ${state.wave} 波，得分 ${state.score}` : `💀 遊戲結束！撐到第 ${state.wave} 波，得分 ${state.score}`, state.victory ? undefined : "bad");
    if (typeof window.__tdGameOver === "function") {
      window.__tdGameOver(state.wave, state.score, {
        ...(isExpedition() ? { victory: !!state.victory, mode: state.mode, missionId: state.expedition.missionId } : {}),
        kills: state.kills,
        bossKills: state.bossKills || 0,
        difficulty: getDifficulty(),
        soulEarned: state.runSoulEarned || 0,
        leaks: state.runLeaks,
        towers: state.towers.map((tw) => ({ type: tw.type, level: tw.level, cx: tw.cx, cy: tw.cy, x: tw.x, y: tw.y })),
        heroGrowth: state.heroes.map((h) => ({
          id: h.id,
          level: h.level,
          startLevel: h.startLevel || 1,
          xp: h.runXp || 0,
          levelsGained: h.levelsGained || Math.max(0, (h.level || 1) - (h.startLevel || 1)),
        })),
      });
    }
  }

  // ===== 渲染 =====
  function drawInterpolatedEntity(draw, entity, alpha) {
    if (alpha >= 1 || !Number.isFinite(entity._renderPrevX) || !Number.isFinite(entity._renderPrevY)) {
      draw(entity); return;
    }
    // Visual interpolation never writes into the physics root or collider.
    ctx.save();
    ctx.translate((entity._renderPrevX - entity.x) * (1 - alpha), (entity._renderPrevY - entity.y) * (1 - alpha));
    draw(entity);
    ctx.restore();
  }
  function render(interpolation) {
    const alpha = Number.isFinite(interpolation) ? Math.max(0, Math.min(1, interpolation)) : 1;
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawPath();
    drawMapAtmosphere();
    if (state.selectedTowerType) drawBuildPreview();
    drawGoddess();
    const towerProfile = towerRenderProfile();
    for (let i = 0; i < state.towers.length; i++) drawTower(state.towers[i], i, state.towers.length, towerProfile);
    for (const h of state.heroes) drawInterpolatedEntity(drawHero, h, alpha);
    for (const e of state.enemies) drawInterpolatedEntity(drawEnemy, e, alpha);
    for (const b of state.bullets) drawInterpolatedEntity(drawBullet, b, alpha);
    if (state.touchBuildPreview) captureBuildMagnifierFrame();
    for (const p of state.particles) drawParticle(p);
    if (state.selectedTower) drawTowerRange(state.selectedTower);
    drawAdvisorHighlight();
    drawGuardPoints();
    if (state.pendingSkill) drawSkillPreview();
    drawComboHud();
    drawStreakHud();
    drawBanner();
    drawRedVignette();
    if (state.touchBuildPreview) drawBuildMagnifier();
  }

  // D9 駐守點視覺（旗標 + 範圍圈）
  function drawGuardPoints() {
    for (const h of state.heroes) {
      if (!h.guardPoint) continue;
      const def = HEROES[h.id];
      ctx.strokeStyle = "rgba(74,222,128,.3)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(h.guardPoint.x, h.guardPoint.y, HERO_GUARD_RADIUS, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "18px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🚩", h.guardPoint.x, h.guardPoint.y);
    }
    // 選中待設駐守的英雄：高亮
    if (state.pendingHero) {
      const h = state.heroes.find((x) => x.uid === state.pendingHero);
      if (h) { ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h.x, h.y, CELL * 0.6, 0, Math.PI * 2); ctx.stroke(); }
    }
  }

  // D8 事件波橫幅（畫面中央，淡入淡出）
  function drawBanner() {
    if (window.__tdBattleChrome) return; // The live HUD announces events outside the battlefield.
    if (!state.banner || state.banner.life <= 0) return;
    const b = state.banner;
    if (b.boss) {
      drawBossWarning(b);
      return;
    }
    const t = b.life / (b.duration || 2.0);
    const alpha = t > 0.7 ? (1 - t) / 0.3 : t < 0.3 ? t / 0.3 : 1; // 淡入→持續→淡出
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    // 背景帶
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, H * 0.32, W, 56);
    ctx.fillStyle = b.color; ctx.fillRect(0, H * 0.32, W, 3);
    ctx.fillStyle = b.color; ctx.fillRect(0, H * 0.32 + 53, W, 3);
    // 文字
    ctx.font = '900 34px "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 5; ctx.strokeText(b.text, W / 2, H * 0.32 + 28);
    ctx.fillStyle = b.color; ctx.fillText(b.text, W / 2, H * 0.32 + 28);
    ctx.restore();
  }

  function drawBossWarning(b) {
    const reduced = reducedEffectsEnabled();
    const low = performanceLow();
    const duration = b.duration || 2.6;
    const age = Math.max(0, duration - b.life);
    const fade = reduced ? 1 : Math.min(1, age / 0.18, b.life / 0.35);
    const pulse = reduced ? 1 : 1 + Math.sin(age * 13) * 0.018;
    ctx.save();
    ctx.globalAlpha = Math.max(0, fade);
    ctx.fillStyle = low ? "rgba(69,10,10,.68)" : "rgba(45,5,10,.72)";
    ctx.fillRect(0, 0, W, H);
    if (!low) {
      const vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.08, W / 2, H / 2, H * 0.72);
      vignette.addColorStop(0, "rgba(239,68,68,.04)");
      vignette.addColorStop(1, "rgba(127,29,29,.68)");
      ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
    }
    if (!reduced && !low) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.translate((age * 90) % 56, 0);
      ctx.strokeStyle = "#fecaca"; ctx.lineWidth = 14;
      for (let x = -H; x < W + H; x += 56) {
        ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke();
      }
      ctx.restore();
    }
    ctx.fillStyle = b.color || "#ef4444";
    ctx.fillRect(0, H * 0.27, W, 5);
    ctx.fillRect(0, H * 0.69, W, 5);
    ctx.translate(W / 2, H * 0.47);
    ctx.scale(pulse, pulse);
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = '1000 64px "Segoe UI", sans-serif';
    ctx.strokeStyle = "rgba(0,0,0,.92)"; ctx.lineWidth = 11;
    ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = "#fff1f2"; ctx.fillText(b.text, 0, 0);
    ctx.font = '900 17px "Segoe UI", sans-serif';
    ctx.letterSpacing = "3px";
    ctx.fillStyle = "#fecaca"; ctx.fillText(b.subtitle || "裂界警報", 0, 55);
    ctx.restore();
  }

  // D5 連殺指示器（畫在 canvas 左上）
  function drawComboHud() {
    if (window.__tdBattleChrome) return;
    if (state.combo < 3) return;
    const x = 16, y = 28;
    const scale = 1 + Math.min(state.combo, 15) * 0.04;
    const t = state.comboTimer / 2.5; // 剩餘時間比例（漸隱）
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2);
    ctx.font = `900 ${Math.round(26 * scale)}px "Segoe UI", sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 4;
    ctx.strokeText(`${state.combo} 連殺!`, x, y);
    const grad = ctx.createLinearGradient(x, y, x, y + 30);
    grad.addColorStop(0, "#fde047"); grad.addColorStop(1, "#f59e0b");
    ctx.fillStyle = grad; ctx.fillText(`${state.combo} 連殺!`, x, y);
    // combo 倍率
    const mul = 1 + Math.min(state.combo - 1, 20) * 0.05;
    ctx.font = '700 13px "Segoe UI", sans-serif';
    ctx.fillStyle = "#4ade80"; ctx.fillText(`金錢 x${mul.toFixed(2)}`, x, y + 30 * scale);
    ctx.restore();
  }
  function drawStreakHud() {
    if (window.__tdBattleChrome) return;
    if (!state.cleanStreak || state.cleanStreak < 2) return;
    const x = W - 18, y = 28;
    const pulse = 1 + Math.sin(state.clock * 7) * 0.04;
    ctx.save();
    ctx.textAlign = "right"; ctx.textBaseline = "top";
    ctx.font = `900 ${Math.round(21 * pulse)}px "Segoe UI", sans-serif`;
    ctx.strokeStyle = "rgba(0,0,0,.82)"; ctx.lineWidth = 4;
    const text = `NO LEAK x${state.cleanStreak}`;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = "#4ade80";
    ctx.fillText(text, x, y);
    ctx.font = '800 12px "Segoe UI", sans-serif';
    ctx.fillStyle = "#bbf7d0";
    ctx.fillText("STREAK", x, y + 25);
    ctx.restore();
  }
  function drawRedVignette() {
    if (reducedEffectsEnabled()) return;
    const a = Math.max(0, Math.min(1, state.redVignette || 0));
    if (a <= 0) return;
    ctx.save();
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.22, W / 2, H / 2, H * 0.75);
    g.addColorStop(0, "rgba(239,68,68,0)");
    g.addColorStop(1, `rgba(239,68,68,${0.42 * a})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  function drawHeroEmoji(def, h, size) {
    ctx.font = size * 0.7 + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(def.emoji, h.x, h.y);
  }

  function heroWalkFrame(h, animation, lowQuality) {
    const count = animation.walkFrames;
    if (!h.moving) return 0;
    const stride = lowQuality ? HERO_ANIMATION_ATLAS.lowWalkFrameStride : HERO_ANIMATION_ATLAS.walkFrameStride;
    const phase = (h.walkDist || 0) / stride + (h.animSeed || 0) * count;
    const frame = Math.floor(phase) % count;
    return frame < 0 ? frame + count : frame;
  }

  function heroAnimationColumn(h, animation, lowQuality) {
    if (h.attackPhase === HERO_ATTACK_PHASE.ANTICIPATION) return HERO_ANIMATION_ATLAS.anticipationColumn;
    if (h.attackPhase === HERO_ATTACK_PHASE.IMPACT) return HERO_ANIMATION_ATLAS.impactColumn;
    if (h.attackPhase === HERO_ATTACK_PHASE.RECOVERY) return HERO_ANIMATION_ATLAS.recoveryColumn;
    return heroWalkFrame(h, animation, lowQuality);
  }

  function drawHeroAtlasFrame(atlas, animation, column, h, size) {
    if (!atlas || !atlas.complete || atlas.naturalWidth <= 0) return false;
    const cell = HERO_ANIMATION_ATLAS.cellSize;
    const row = animation.rows[h.facing] == null ? animation.rows.down : animation.rows[h.facing];
    // R75：英雄同樣吃剪影描邊版 atlas（bake 完成前照畫原圖）。
    const source = r75OutlinedSprite(atlas, "hero-atlas", cell, cell, 3) || atlas;
    ctx.drawImage(source, column * cell, row * cell, cell, cell, h.x - size / 2, h.y - size / 2, size, size);
    return true;
  }

  // 英雄繪製：單一 atlas 裁切真幀；載入期間只退回 emoji，不讀舊單張圖。
  function drawHero(h) {
    const def = HEROES[h.id];
    const animation = HERO_ANIMATIONS[h.id] || HERO_ANIMATIONS.knight;
    const atlas = getImg(HERO_ANIMATION_ATLAS.src, true);
    const size = animation.walkFrames > 2 ? Math.min(56, CELL * 1.08) : CELL * 0.9;
    const frameColumn = heroAnimationColumn(h, animation, performanceLow());
    // 圓形光環底（區別於敵人）
    ctx.strokeStyle = def.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y, size * 0.55, 0, Math.PI * 2); ctx.stroke();
    if (h.hitFlash > 0) { ctx.fillStyle = `rgba(239,68,68,${h.hitFlash})`; ctx.beginPath(); ctx.arc(h.x, h.y, size * 0.6, 0, Math.PI * 2); ctx.fill(); }
    if (!drawHeroAtlasFrame(atlas, animation, frameColumn, h, size)) drawHeroEmoji(def, h, size);
    // 血條（V3 圓角漸層）
    drawHealthBar(h.x - size / 2, h.y - size / 2 - 9, size, 5, Math.max(0, h.hp / h.maxHp));
    // 等級（描邊）
    ctx.font = "900 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3; ctx.strokeText("Lv" + h.level, h.x, h.y + size / 2 + 10);
    ctx.fillStyle = "#fde047"; ctx.fillText("Lv" + h.level, h.x, h.y + size / 2 + 10);
  }

  // 守護女神（終點核心）
  function drawGoddess() {
    const gd = state.goddess;
    // 聖光反擊範圍（解鎖後顯示淡圈）
    if (gd.level >= GODDESS.smiteUnlockLevel) {
      ctx.strokeStyle = "rgba(253,224,71,.25)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gd.x, gd.y, GODDESS.smiteRange, 0, Math.PI * 2); ctx.stroke();
    }
    // 聖光底座
    const glow = ctx.createRadialGradient(gd.x, gd.y, 4, gd.x, gd.y, CELL);
    glow.addColorStop(0, "rgba(253,224,71,.5)"); glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(gd.x, gd.y, CELL, 0, Math.PI * 2); ctx.fill();
    // 受擊閃紅
    if (gd.hitFlash > 0) { ctx.fillStyle = `rgba(239,68,68,${gd.hitFlash})`; ctx.beginPath(); ctx.arc(gd.x, gd.y, CELL * 0.9, 0, Math.PI * 2); ctx.fill(); }
    // 女神本體（R75：同步剪影描邊，避免亮背景吃掉輪廓）
    drawSprite("assets/core/goddess.png", GODDESS.emoji, gd.x, gd.y, CELL * 1.3, undefined, 3);
    // 生命條
    const w = CELL * 1.4, pct = Math.max(0, gd.hp / gd.maxHp);
    ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(gd.x - w / 2, gd.y - CELL * 0.95, w, 6);
    ctx.fillStyle = pct > 0.5 ? "#4ade80" : pct > 0.25 ? "#facc15" : "#ef4444";
    ctx.fillRect(gd.x - w / 2, gd.y - CELL * 0.95, w * pct, 6);
    // 等級
    ctx.fillStyle = "#fde047"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Lv." + gd.level, gd.x, gd.y + CELL * 0.85);
  }

  function terrainPlatePath(mapDef) {
    const art = window.TDMapArt;
    return art && art.TERRAIN_PLATES[mapDef.id] || "assets/maps/r80/" + mapDef.id + "-terrain.webp";
  }
  function bakeBackground() {
    engineMetrics.backgroundBakes++; engineMetrics.pathBakes++;
    const layer = document.createElement("canvas"); layer.width = W; layer.height = H;
    const background = layer.getContext("2d"), art = window.TDMapArt;
    const platePath = terrainPlatePath(state.mapDef), plate = getImg(platePath, true);
    let info = { ready: false, terrainPlate: platePath, biome: state.mapDef.biome };
    if (art) info = art.paintBoard(background, state.mapDef, { width: W, height: H, plate, bridgeSprite: getImg(art.BRIDGE_SPRITE, true),
      isBuildable: (x, y) => !TDRules.mapBuildRestriction(state.mapDef, x, y, CELL).blocked });
    else {
      // Headless/asset-loading fallback. The live page loads map-art.js before game.js.
      background.fillStyle = (MAP_VISUALS[state.mapId] || MAP_VISUALS.plains).ground;
      background.fillRect(0, 0, W, H); background.strokeStyle = "#c3ad87";
      background.lineWidth = state.mapDef.roadWidth || 42; background.lineCap = "round"; background.lineJoin = "round";
      background.beginPath(); background.moveTo(state.path[0].x, state.path[0].y);
      for (let i = 1; i < state.path.length; i++) background.lineTo(state.path[i].x, state.path[i].y);
      background.stroke();
    }
    state.pathDetailCache = layer;
    return { canvas: layer, ready: info.ready, assetVersion: sceneAssetVersion, info };
  }
  function drawBackground() {
    if (!state.backgroundCache || state.backgroundCache.assetVersion !== sceneAssetVersion) state.backgroundCache = bakeBackground();
    ctx.drawImage(state.backgroundCache.canvas, 0, 0);
  }
  function drawMapAtmosphere() {
    // R80 lighting is authored into the raster plate. Do not wash it in a full
    // green tint or rebuild atmosphere gradients in the live rendering path.
  }
  function drawPath() {
    if (!getPathGuideVisible() || !window.TDMapArt) return;
    const scale = Math.max(.25, canvas.getBoundingClientRect().width / W);
    const showLabels = !state.selectedTowerType && !state.pendingSkill;
    const key = state.mapId + ":" + (state.mapDef.designVersion || 1) + ":" + Math.round(scale * 100) + ":" + showLabels;
    if (!state.pathRenderCache || state.pathRenderCache.key !== key) {
      const layer = document.createElement("canvas"); layer.width = W; layer.height = H;
      window.TDMapArt.paintGuide(layer.getContext("2d"), state.mapDef, { cssScale: scale, showLabels });
      state.pathRenderCache = { canvas: layer, key }; engineMetrics.guideBakes++;
    }
    ctx.drawImage(state.pathRenderCache.canvas, 0, 0);
  }
  function drawBuildableCells(def) {
    if (!def) return;
    const scale = Math.max(.25, canvas.getBoundingClientRect().width / W), range = def.range * affixMul("towerRangeMul");
    const key = state.mapId + ":" + def.id + ":" + Math.round(range * 100) + ":" + state.towerSeq + ":" + state.towers.length + ":" + Math.round(scale * 100);
    if (!state.placementCache || state.placementCache.key !== key) {
      const layer = document.createElement("canvas"); layer.width = W; layer.height = H;
      const points = layer.getContext("2d"), occupied = new Set(state.towers.map((t) => cellKey(t.cx, t.cy)));
      const radius = Math.min(8, Math.max(4, 2.2 / scale));
      for (const cell of state.map.buildCells || []) {
        if (occupied.has(cellKey(cell.cx, cell.cy)) || !canCellReachPath(cell.cx, cell.cy, range)) continue;
        points.fillStyle = "rgba(186,223,184,.20)"; points.beginPath(); points.arc(cell.x, cell.y, radius + 3, 0, Math.PI * 2); points.fill();
        points.fillStyle = "rgba(226,239,197,.60)"; points.beginPath(); points.arc(cell.x, cell.y, radius, 0, Math.PI * 2); points.fill();
      }
      if (!state.towers.length && state.wave === 0 && !def.support && !def.slowAura) {
        const first = (state.mapDef.buildPads || []).find(p => p.id === "front-arrow");
        if (first && buildPreviewAt(first.x, first.y).ok) {
          points.strokeStyle = "#f0d69d"; points.lineWidth = Math.max(2, 1.5 / scale);
          const half = CELL * .36, arm = CELL * .14;
          for (const sx of [-1,1]) for (const sy of [-1,1]) {
            points.beginPath();points.moveTo(first.x+sx*(half-arm),first.y+sy*half);
            points.lineTo(first.x+sx*half,first.y+sy*half);points.lineTo(first.x+sx*half,first.y+sy*(half-arm));points.stroke();
          }
        }
      }
      state.placementCache = { canvas: layer, key }; engineMetrics.placementBakes++;
    }
    ctx.drawImage(state.placementCache.canvas, 0, 0);
  }
  function drawBuildPreview() {
    const def = TOWERS[state.selectedTowerType];
    if (!def) return;
    drawBuildableCells(def);
    const m = state.touchBuildPreview || state.buildGhost || state.mouse; if (!m) return;
    const preview = buildPreviewAt(m.x, m.y);
    ctx.fillStyle = preview.ok ? "rgba(74,222,128,.3)" : "rgba(239,68,68,.32)";
    ctx.fillRect(preview.cx * CELL, preview.cy * CELL, CELL, CELL);
    ctx.fillStyle = preview.ok ? "rgba(74,222,128,.08)" : "rgba(239,68,68,.08)";
    ctx.beginPath(); ctx.arc(preview.x, preview.y, preview.range, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = preview.ok ? "#4ade80" : "#ef4444"; ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 6]);
    ctx.beginPath(); ctx.arc(preview.x, preview.y, preview.range, 0, Math.PI * 2); ctx.stroke();
    if (def.minRange) {
      ctx.strokeStyle = "rgba(248,113,113,.75)";
      ctx.beginPath(); ctx.arc(preview.x, preview.y, def.minRange, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawSprite(towerSpritePath(def, 1), "", preview.x, preview.y, CELL * 0.7);
    ctx.restore();
    const cssScale = Math.max(0.25, canvas.getBoundingClientRect().width / W);
    const touchPreview = !!(state.touchBuildPreview || state.buildGhost) && cssScale < 0.7;
    if (touchPreview) {
      const color = preview.ok ? "#b6e7c6" : "#fca5a5";
      ctx.save();
      ctx.strokeStyle = "rgba(5,12,15,.95)"; ctx.lineWidth = 5 / cssScale;
      ctx.strokeRect(preview.cx * CELL + 2, preview.cy * CELL + 2, CELL - 4, CELL - 4);
      ctx.strokeStyle = color; ctx.lineWidth = 2.2 / cssScale;
      ctx.strokeRect(preview.cx * CELL + 2, preview.cy * CELL + 2, CELL - 4, CELL - 4);
      ctx.beginPath();
      const gap = CELL * 0.58, arm = CELL * 1.25;
      for (const sign of [-1, 1]) {
        ctx.moveTo(preview.x + gap * sign, preview.y); ctx.lineTo(preview.x + arm * sign, preview.y);
        ctx.moveTo(preview.x, preview.y + gap * sign); ctx.lineTo(preview.x, preview.y + arm * sign);
      }
      ctx.stroke(); ctx.restore();
    }
    const label = state.touchBuildPreview ? "" : !preview.ok ? preview.reason : touchPreview ? "按確認建造" : "";
    if (label) {
      const fontSize = touchPreview ? 15 / cssScale : 13;
      ctx.font = `900 ${fontSize}px "Segoe UI", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const halfWidth = Math.min(W / 2 - 8, ctx.measureText(label).width / 2 + 10);
      const labelX = Math.max(halfWidth + 4, Math.min(W - halfWidth - 4, preview.x));
      const labelY = Math.max(fontSize, Math.min(H - fontSize, preview.y - CELL * (touchPreview ? 1.55 : 0.62)));
      ctx.strokeStyle = "rgba(0,0,0,.9)"; ctx.lineWidth = touchPreview ? 4 / cssScale : 3;
      ctx.strokeText(label, labelX, labelY);
      ctx.fillStyle = preview.ok ? "#dcfce7" : "#fecaca"; ctx.fillText(label, labelX, labelY);
    }
  }
  function captureBuildMagnifierFrame() {
    const placement = getBuildPlacement();
    if (!placement || !placement.active) return;
    const span = CELL * 3;
    if (!buildMagnifierFrame) {
      const layer = document.createElement("canvas"); layer.width = layer.height = span;
      buildMagnifierFrame = { canvas: layer, x: 0, y: 0 };
    }
    buildMagnifierFrame.x = Math.max(0, Math.min(W - span, (placement.preview.cx - 1) * CELL));
    buildMagnifierFrame.y = Math.max(0, Math.min(H - span, (placement.preview.cy - 1) * CELL));
    const frame = buildMagnifierFrame.canvas.getContext("2d"); usePixelArt(frame);
    frame.clearRect(0, 0, span, span);
    // Take the crop before particles and UI labels. Enlarging those annotations
    // would cover the cell with huge duplicate text instead of showing terrain.
    frame.drawImage(canvas, buildMagnifierFrame.x, buildMagnifierFrame.y, span, span, 0, 0, span, span);
  }
  function drawBuildMagnifier() {
    const placement = getBuildPlacement();
    if (!placement || !placement.active) return;
    const rect = canvas.getBoundingClientRect(), scale = Math.max(0.25, rect.width / W);
    const available = Math.min(rect.width - 14, rect.height - 35);
    if (available < 48) return;
    const size = Math.min(available, 180, Math.max(132, CELL * 3 * scale * 1.6)) / scale;
    const pad = 7 / scale, header = 21 / scale;
    const preview = placement.preview, span = CELL * 3;
    if (!buildMagnifierFrame) return;
    const sx = buildMagnifierFrame.x, sy = buildMagnifierFrame.y;
    // Put the temporary loupe diagonally away from the selected cell. It stays
    // inside Canvas, owns no DOM hit targets, and never covers external controls.
    const x = preview.x < W / 2 ? W - size - pad : pad;
    const y = preview.y < H / 2 ? H - size - header - pad : pad;
    const contentY = y + header, color = preview.ok ? "#a9d6bd" : "#fca5a5";
    ctx.save(); ctx.shadowBlur = 0; ctx.filter = "none"; ctx.globalAlpha = 1;
    ctx.fillStyle = "#11201b"; ctx.fillRect(x - 3 / scale, y - 3 / scale, size + 6 / scale, size + header + 6 / scale);
    ctx.strokeStyle = "rgba(169,214,189,.7)"; ctx.lineWidth = 1.5 / scale;
    ctx.strokeRect(x - 2 / scale, y - 2 / scale, size + 4 / scale, size + header + 4 / scale);
    ctx.beginPath(); ctx.rect(x, contentY, size, size); ctx.clip();
    usePixelArt(ctx);
    ctx.drawImage(buildMagnifierFrame.canvas, 0, 0, span, span, x, contentY, size, size);
    const factor = size / span;
    ctx.fillStyle = preview.ok ? "rgba(126,193,151,.20)" : "rgba(239,68,68,.20)";
    ctx.fillRect(x + (preview.cx * CELL - sx) * factor, contentY + (preview.cy * CELL - sy) * factor, CELL * factor, CELL * factor);
    ctx.strokeStyle = color; ctx.lineWidth = 2.3 / scale;
    ctx.strokeRect(x + (preview.cx * CELL - sx) * factor + 1 / scale,
      contentY + (preview.cy * CELL - sy) * factor + 1 / scale, CELL * factor - 2 / scale, CELL * factor - 2 / scale);
    ctx.restore();
    ctx.save(); ctx.shadowBlur = 0; ctx.fillStyle = "#d3e5d9";
    ctx.font = `700 ${11 / scale}px "Segoe UI", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(!preview.ok ? preview.reason : placement.dragging ? "精準定位 · 放開不會建造" : "按住拖曳 · 放大定位", x + size / 2, y + header / 2);
    ctx.restore();
  }
  function drawTowerRange(tw) {
    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(tw.x, tw.y, towerStat(tw, "range"), 0, Math.PI * 2); ctx.stroke();
    const minRange = towerStat(tw, "minRange") || 0;
    if (minRange > 0) {
      ctx.strokeStyle = "rgba(248,113,113,.45)";
      ctx.setLineDash([6, 5]);
      ctx.beginPath(); ctx.arc(tw.x, tw.y, minRange, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  function drawAdvisorHighlight() {
    const tw = state.advisorUpgradeTarget;
    if (!tw || state.selectedTower !== tw) return;
    const pulse = 1 + Math.sin(state.clock * 6) * 0.08;
    ctx.save();
    ctx.strokeStyle = "#facc15";
    ctx.lineWidth = 3;
    ctx.shadowColor = "#facc15";
    ctx.shadowBlur = performanceLow() ? 0 : 14;
    ctx.beginPath();
    ctx.arc(tw.x, tw.y, CELL * 0.58 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // 圖片快取：載入後做「四角背景色去背」，讓素材的純色方塊背景（紫/白）變透明，
  // 融入草地。處理結果是一個帶 complete/naturalWidth 的 canvas（可直接 drawImage）。
  const imgCache = {};
  // noBg=true 時保留原圖不去背（地圖滿版磚塊用，否則整塊會被去透明）
  function getImg(path, noBg) {
    if (imgCache[path] === undefined) {
      imgCache[path] = null; // 預設 null（載入/去背完成前用佔位）
      const im = new Image();
      im.onload = () => {
        imgCache[path] = noBg ? im : removeBg(im);
        if (path.startsWith("assets/maps/r80/")) sceneAssetVersion++;
      };
      im.onerror = () => { imgCache[path] = null; };
      im.src = path;
    }
    return imgCache[path];
  }
  // 去背：取四角平均色當背景色，把相近像素的 alpha 設 0
  function removeBg(im) {
    try {
      const c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const cx = c.getContext("2d");
      usePixelArt(cx);
      cx.drawImage(im, 0, 0);
      const W = c.width, H = c.height;
      const data = cx.getImageData(0, 0, W, H);
      const p = data.data;
      // 取四角顏色平均當背景參考色
      const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]];
      let br = 0, bg = 0, bb = 0, ba = 0;
      for (const [x, y] of corners) { const i = (y * W + x) * 4; br += p[i]; bg += p[i + 1]; bb += p[i + 2]; ba += p[i + 3]; }
      br /= 4; bg /= 4; bb /= 4; ba /= 4;
      if (ba < 16) {
        c.complete = true; c.naturalWidth = W;
        return c;
      }
      const TOL = 60; // 容差：與背景色距離小於此值的像素去除
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.abs(p[i] - br) + Math.abs(p[i + 1] - bg) + Math.abs(p[i + 2] - bb);
        if (d < TOL) p[i + 3] = 0;
        else if (d < TOL * 1.8) p[i + 3] = Math.round(p[i + 3] * (d - TOL) / (TOL * 0.8)); // 邊緣半透明過渡
      }
      cx.putImageData(data, 0, 0);
      c.complete = true; c.naturalWidth = W; // 讓後續判斷相容 Image 介面
      return c;
    } catch { return im; } // 失敗則退回原圖
  }
  // ===== R75 程序化精緻化：sprite/atlas 剪影描邊 =====
  // 64px 縮圖可辨性：單位貼圖離屏 bake 一份「深色 1px（螢幕等效）剪影描邊」版本。
  // bake 排進 idle（或 setTimeout 0），完成前照畫原圖——不搶戰鬥幀、每幀 draw call 數不變。
  const R75_OUTLINE_COLOR = "rgba(9,14,10,.92)";
  const r75OutlineCache = new Map(); // key -> { canvas: HTMLCanvasElement | null }
  function r75BakeOutline(image, cellW, cellH, thickness) {
    const w = image.naturalWidth || image.width, h = image.naturalHeight || image.height;
    const cw = cellW || w, ch = cellH || h;
    const cols = Math.max(1, Math.round(w / cw)), rows = Math.max(1, Math.round(h / ch));
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const octx = out.getContext("2d");
    usePixelArt(octx);
    const sil = document.createElement("canvas");
    sil.width = cw; sil.height = ch;
    const sctx = sil.getContext("2d");
    usePixelArt(sctx);
    const t = Math.max(1, Math.round(thickness || 1));
    const offsets = [[t, 0], [-t, 0], [0, t], [0, -t], [t, t], [t, -t], [-t, t], [-t, -t]];
    // 逐格 bake＋逐格 clip：atlas 格與格之間描邊不互滲。
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        sctx.globalCompositeOperation = "source-over";
        sctx.clearRect(0, 0, cw, ch);
        sctx.drawImage(image, col * cw, row * ch, cw, ch, 0, 0, cw, ch);
        sctx.globalCompositeOperation = "source-in";
        sctx.fillStyle = R75_OUTLINE_COLOR;
        sctx.fillRect(0, 0, cw, ch);
        octx.save();
        octx.beginPath(); octx.rect(col * cw, row * ch, cw, ch); octx.clip();
        for (const [dx, dy] of offsets) octx.drawImage(sil, col * cw + dx, row * ch + dy);
        octx.restore();
      }
    }
    octx.drawImage(image, 0, 0);
    return out;
  }
  function r75OutlinedSprite(image, key, cellW, cellH, thickness) {
    if (!image || !image.complete || !(image.naturalWidth > 0)) return null;
    const entry = r75OutlineCache.get(key);
    if (entry) return entry.canvas;
    r75OutlineCache.set(key, { canvas: null }); // 佔位避免重複排程
    const bake = () => {
      let canvas = null;
      try { canvas = r75BakeOutline(image, cellW, cellH, thickness); } catch { canvas = null; }
      r75OutlineCache.set(key, { canvas });
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(bake, { timeout: 900 });
    else setTimeout(bake, 0);
    return null;
  }
  function drawSprite(path, emoji, x, y, size, color, outlineThickness) {
    let im = getImg(path);
    if (im && im.complete && im.naturalWidth > 0) {
      if (outlineThickness) im = r75OutlinedSprite(im, "sprite:" + path, 0, 0, outlineThickness) || im;
      usePixelArt(ctx); ctx.drawImage(im, x - size / 2, y - size / 2, size, size);
    }
    else if (emoji) { ctx.font = size * 0.8 + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(emoji, x, y); }
  }
  function towerTierIndex(level) {
    const value = Math.max(1, Math.floor(Number(level) || 1));
    return value >= 7 ? 2 : value >= 4 ? 1 : 0;
  }
  function towerSpritePath(def, level) {
    const sprites = def && def.sprites;
    return sprites && sprites[towerTierIndex(level)] ? sprites[towerTierIndex(level)] : "";
  }
  function towerVisualStyle(level) {
    const lv = Math.max(1, Math.floor(Number(level) || 1));
    const max = Math.max(2, UPGRADE.maxLevel || 10);
    const progress = Math.max(0, Math.min(1, (lv - 1) / (max - 1)));
    const levelColors = ["#94a3b8", "#38bdf8", "#22d3ee", "#a78bfa", "#c084fc", "#facc15", "#fb923c", "#fb7185", "#f43f5e", "#fef3c7"];
    const index = Math.min(levelColors.length - 1, Math.max(0, lv - 1));
    const tier = lv >= max ? 5 : lv >= 8 ? 4 : lv >= 6 ? 3 : lv >= 4 ? 2 : lv >= 2 ? 1 : 0;
    const ringSteps = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5];
    const baseSides = [4, 6, 6, 8, 8, 10, 10, 12, 12, 14];
    return {
      level: lv, max, progress, tier, auraColor: levelColors[index],
      baseR: CELL * (0.41 + progress * 0.11),
      spriteSize: CELL * (0.70 + progress * 0.18),
      ringCount: ringSteps[index],
      ringDash: lv % 2 === 0 ? [] : [2.5 + tier * 0.5, 2.5],
      baseSides: baseSides[index],
      gemSize: 4 + index * 0.8,
      gemSides: lv >= max ? 5 : tier >= 3 ? 6 : 4,
    };
  }
  function towerRenderProfile(cellCssOverride) {
    const measuredCell = Number(cellCssOverride);
    const rect = Number.isFinite(measuredCell) ? null : canvas.getBoundingClientRect();
    const cellCss = Number.isFinite(measuredCell)
      ? measuredCell
      : rect.width / (canvas.width / CELL);
    const compact = cellCss > 0 && cellCss <= 40;
    return {
      compact,
      cellCss,
      maxRings: compact ? 2 : Infinity,
      showRivets: !compact,
      ringLineFloor: compact ? 2 : 1.35,
      levelFont: compact ? 12 : 10,
      levelStroke: compact ? 4 : 3,
    };
  }
  function towerGlowPolicy(towerCount, drawIndex, selected, level, maxLevel, low, reduced, compact) {
    const count = Math.max(0, Math.floor(Number(towerCount) || 0));
    const index = Math.max(0, Math.floor(Number(drawIndex) || 0));
    if (low || reduced) return { enabled: false, budget: 0, baseBlur: 0, gemBlur: 0 };
    if (compact) {
      // 手機等效格位只保留一層等級色焦點光；塔基 halo 在 CSS 縮放後容易糊成一團。
      const maxed = Number(level) >= Number(maxLevel);
      const enabled = !!selected || (maxed && index < 2);
      return { enabled, budget: 2, baseBlur: 0, gemBlur: enabled ? (selected ? 5 : 3) : 0 };
    }
    const budget = count >= 16 ? 4 : count >= 10 ? 6 : 8;
    // 固定使用繪製順序分配名額，不按 frame 輪替；選取塔可額外取得一個穩定焦點。
    const enabled = count <= budget || index < budget || !!selected;
    if (!enabled) return { enabled: false, budget, baseBlur: 0, gemBlur: 0 };
    const dense = count > 12;
    const maxed = Number(level) >= Number(maxLevel);
    return {
      enabled: true,
      budget,
      baseBlur: selected ? 8 : dense ? 3 : maxed ? 7 : 5,
      gemBlur: selected ? 10 : dense ? 4 : maxed ? 9 : 7,
    };
  }
  function towerMaterialStyle(type, element) {
    const profiles = {
      cannon: { mass: 1.08, rim: 3.4, rivets: 4, metal: true },
      mortar: { mass: 1.16, rim: 4.4, rivets: 6, metal: true },
      sniper: { mass: 1.02, rim: 3.0, rivets: 4, metal: true },
      arrow: { mass: 0.98, rim: 2.6, rivets: 4, metal: true },
      poison: { mass: 0.96, rim: 2.4, rivets: 3, metal: true },
    };
    if (profiles[type]) return profiles[type];
    if (element === "physical") return { mass: 0.94, rim: 2.2, rivets: 3, metal: true };
    return { mass: 0.91, rim: 1.8, rivets: 0, metal: false };
  }
  function polygonPath(drawCtx, radius, sides, rotation) {
    drawCtx.beginPath();
    for (let i = 0; i < sides; i++) {
      const angle = (rotation || 0) + i * Math.PI * 2 / sides;
      const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
      if (i === 0) drawCtx.moveTo(x, y); else drawCtx.lineTo(x, y);
    }
    drawCtx.closePath();
  }
  function drawTower(tw, drawIndex, towerCount, renderProfile) {
    const def = TOWERS[tw.type];
    const lv = tw.level;
    const { max, progress, tier, auraColor, baseR, spriteSize, ringCount, ringDash, baseSides, gemSize, gemSides } = towerVisualStyle(lv);
    const profile = renderProfile || towerRenderProfile();
    const animated = !reducedEffectsEnabled();
    const reduced = reducedEffectsEnabled();
    const glow = towerGlowPolicy(towerCount, drawIndex, state.selectedTower === tw, lv, max, performanceLow(), reduced, profile.compact);
    const material = towerMaterialStyle(tw.type, def.element);
    const pulse = animated ? 1 + Math.sin(state.clock * 3.2 + (tw.order || 0)) * (0.012 + progress * 0.025) : 1;
    ctx.save();
    ctx.translate(tw.x, tw.y);
    ctx.scale(pulse, pulse);
    // 元素色負責塔種辨識；升級彩虹只做外階刻度與寶石色錨。
    ctx.shadowColor = def.color;
    ctx.shadowBlur = glow.baseBlur;
    ctx.fillStyle = material.metal ? "rgba(15,23,42,.88)" : "rgba(2,6,23,.62)";
    ctx.strokeStyle = material.metal ? "rgba(203,213,225,.78)" : def.color;
    ctx.lineWidth = material.rim;
    polygonPath(ctx, baseR * material.mass, baseSides, -Math.PI / 2); ctx.fill(); ctx.stroke();
    if (material.rivets && profile.showRivets) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(226,232,240,.9)";
      for (let i = 0; i < material.rivets; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / material.rivets;
        ctx.beginPath(); ctx.arc(Math.cos(a) * baseR * material.mass * 0.78, Math.sin(a) * baseR * material.mass * 0.78, 1.25, 0, Math.PI * 2); ctx.fill();
      }
      ctx.shadowColor = def.color; ctx.shadowBlur = glow.baseBlur;
    }
    const visibleRingCount = Math.min(ringCount, profile.maxRings);
    for (let i = 0; i < visibleRingCount; i++) {
      ctx.globalAlpha = Math.max(0.18, 0.68 - i * 0.1);
      ctx.strokeStyle = i === visibleRingCount - 1 ? auraColor : def.color;
      ctx.lineWidth = Math.max(profile.ringLineFloor, 1.35 + progress * 1.45 - i * 0.1);
      ctx.setLineDash(!profile.compact && i === visibleRingCount - 1 ? ringDash : []);
      ctx.beginPath(); ctx.arc(0, 0, baseR + 2 + i * 3.1, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = def.color;
    ctx.globalAlpha = tier === 0 ? 0.16 : tier >= 3 ? 0.30 : 0.22;
    polygonPath(ctx, baseR, baseSides, -Math.PI / 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = def.color; ctx.lineWidth = 1.5 + progress * 3; ctx.stroke();
    ctx.restore();
    drawSprite(towerSpritePath(def, lv), "", tw.x, tw.y, spriteSize, undefined, 3); // R75：塔身剪影描邊

    // 塔頂能量寶石：尺寸、亮度與外框階數同步升級，遠看即可辨認塔級。
    const gemY = tw.y - spriteSize * 0.27;
    ctx.save();
    ctx.translate(tw.x, gemY);
    ctx.rotate(gemSides === 4 ? Math.PI / 4 : -Math.PI / 2);
    ctx.shadowColor = auraColor; ctx.shadowBlur = glow.gemBlur;
    ctx.fillStyle = lv === 1 ? "rgba(226,232,240,.72)" : auraColor;
    polygonPath(ctx, gemSize * 0.72, gemSides, 0); ctx.fill();
    if (tier >= 2) {
      ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1;
      polygonPath(ctx, gemSize, gemSides, 0); ctx.stroke();
    }
    ctx.restore();

    if (lv >= max && animated && !performanceLow()) {
      const t = state.clock * 2.1;
      for (let i = 0; i < 4; i++) {
        const a = t + i * Math.PI / 2;
        ctx.fillStyle = i % 2 ? "#fff7ed" : "#facc15";
        ctx.beginPath(); ctx.arc(tw.x + Math.cos(a) * (baseR + 5), tw.y + Math.sin(a) * (baseR + 5), 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    if ((tw.mutedUntil || 0) > state.clock || (tw.stunnedUntil || 0) > state.clock) {
      const label = (tw.mutedUntil || 0) > state.clock ? "🤐" : "✖";
      ctx.font = "18px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(label, tw.x, tw.y - baseR - 8);
    }
    // 等級徽記
    if (lv > 1) {
      ctx.font = `900 ${profile.levelFont}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,.88)"; ctx.lineWidth = profile.levelStroke;
      ctx.strokeText(`LV ${lv}`, tw.x, tw.y + baseR + 8);
      ctx.fillStyle = auraColor; ctx.fillText(`LV ${lv}`, tw.x, tw.y + baseR + 8);
    }
  }
  function enemyWalkFrame(e, animation, lowQuality) {
    const count = animation.walkFrames;
    const stride = e.boss ? ENEMY_ANIMATION_ATLAS.bossFrameStride : ENEMY_ANIMATION_ATLAS.normalFrameStride;
    const phase = (e.walkDist || 0) / stride + (e.animSeed || 0) * count;
    if (lowQuality) return (Math.floor(phase / 2) & 1) ? Math.floor(count / 2) : 0;
    const frame = Math.floor(phase) % count;
    return frame < 0 ? frame + count : frame;
  }

  function drawEnemyAtlasFrame(atlas, animation, column, e, size) {
    if (!forceEnemyAtlasFallback && atlas && atlas.complete && atlas.naturalWidth > 0) {
      const cell = ENEMY_ANIMATION_ATLAS.cellSize;
      // R75：改畫剪影描邊版 atlas（bake 完成前先畫原圖），64px 縮圖剪影可辨。
      const source = r75OutlinedSprite(atlas, "enemy-atlas", cell, cell, 4) || atlas;
      ctx.drawImage(source, column * cell, animation.row * cell, cell, cell, -size / 2, -size / 2, size, size);
      return;
    }
    // Gen-2 舊 master 有烤入黑底；atlas 載入期間改畫乾淨 Canvas 暫代。
    ctx.save();
    ctx.fillStyle = e.color || "#64748b";
    ctx.strokeStyle = "rgba(255,255,255,.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, size * 0.37, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = `${Math.max(14, size * 0.54)}px serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(e.emoji || "◆", 0, 1);
    ctx.restore();
  }

  function drawEnemyHitFrame(atlas, animation, column, e, size) {
    if (forceEnemyAtlasFallback || !atlas || !atlas.complete || !(atlas.naturalWidth > 0)) {
      drawEnemyAtlasFrame(atlas, animation, column, e, size); return;
    }
    const cell = ENEMY_ANIMATION_ATLAS.cellSize;
    const source = r75OutlinedSprite(atlas, "enemy-atlas", cell, cell, 4) || atlas;
    const key = `${animation.row}:${column}`;
    let entry = hitFrameCache.get(key);
    if (!entry || entry.source !== source) {
      // Crop the CURRENT true frame once, then make an alpha-preserving white
      // texture. A live Canvas filter on a full atlas can force expensive GPU
      // flushes when the following projectile asks for shadowBlur.
      const layer = document.createElement("canvas"); layer.width = cell; layer.height = cell;
      const flash = layer.getContext("2d"); usePixelArt(flash);
      flash.drawImage(source, column * cell, animation.row * cell, cell, cell, 0, 0, cell, cell);
      flash.globalCompositeOperation = "source-in";
      flash.fillStyle = "#fff"; flash.fillRect(0, 0, cell, cell);
      if (!hitFrameCache.has(key) && hitFrameCache.size >= MAX_HIT_FRAME_CACHE) hitFrameCache.delete(hitFrameCache.keys().next().value);
      entry = { source, canvas: layer }; hitFrameCache.set(key, entry);
    }
    ctx.drawImage(entry.canvas, -size / 2, -size / 2, size, size);
  }

  function drawEnemy(e) {
    const size = e.boss ? CELL * 1.1 : CELL * 0.6;
    const animation = ENEMY_ANIMATIONS[e.id] || ENEMY_ANIMATIONS.slime;
    const atlas = getImg(ENEMY_ANIMATION_ATLAS.src, true);
    const lowQuality = performanceLow();
    const reduced = reducedFlashEnabled();
    const kick01 = reduced ? 0 : Math.min(1, (e.hitKick || 0) / 0.12);
    const knock = kick01 * (e.boss ? 7.5 : 5.5);
    const drawX = e.x + (e.hitDirX || 0) * knock;
    const drawY = e.y + (e.hitDirY || 0) * knock * 0.45;
    let frameColumn = enemyWalkFrame(e, animation, lowQuality);
    let spriteAlpha = 1;
    if (e._dead) {
      const startedAt = Number.isFinite(e.deathStartedAt) ? e.deathStartedAt : state.clock;
      const duration = e.deathDuration || ENEMY_ANIMATION_ATLAS.deathDuration;
      const progress = Math.max(0, Math.min(0.999, (state.clock - startedAt) / duration));
      frameColumn = ENEMY_ANIMATION_ATLAS.deathStart + Math.min(ENEMY_ANIMATION_ATLAS.deathFrames - 1, Math.floor(progress * ENEMY_ANIMATION_ATLAS.deathFrames));
      if (progress > 0.68) spriteAlpha = Math.max(0, (1 - progress) / 0.32);
    }

    ctx.save();
    ctx.globalAlpha = spriteAlpha;
    ctx.fillStyle = e.boss ? "rgba(0,0,0,.34)" : "rgba(0,0,0,.26)";
    ctx.beginPath();
    ctx.ellipse(e.x, e.y + size * 0.38, size * (e.boss ? 0.48 : 0.43), size * (e.boss ? 0.17 : 0.14), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(drawX, drawY);
    ctx.scale(e.flipX ? -1 : 1, 1);
    ctx.globalAlpha = spriteAlpha;
    drawEnemyAtlasFrame(atlas, animation, frameColumn, e, size);
    const flash = reduced ? 0 : (e.hitFlash || 0);
    if (flash > 0 && !e._dead) {
      ctx.globalAlpha = Math.min(0.78, flash / 0.14 * 0.72);
      drawEnemyHitFrame(atlas, animation, frameColumn, e, size);
    }
    ctx.restore();

    // 死亡碎裂播完前保留在 state.enemies；屍體不畫血條或狀態環。
    if (e._dead) return;

    // 血條（V3：圓角漸層）
    drawHealthBar(drawX - size / 2, drawY - size / 2 - 9, size, 5, Math.max(0, e.hp / e.maxHp));
    if (e.maxShield > 0) {
      drawShieldBar(drawX - size / 2, drawY - size / 2 - 15, size, 4, Math.max(0, e.shield / e.maxShield));
    }
    // 冰凍/減速標記
    if (e.frozenUntil > state.clock) { ctx.fillStyle = "rgba(56,189,248,.4)"; ctx.beginPath(); ctx.arc(drawX, drawY, size / 2, 0, Math.PI * 2); ctx.fill(); }
    else if (e.slowUntil > state.clock) { ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(drawX, drawY, size / 2, 0, Math.PI * 2); ctx.stroke(); }
    if (e.vulnUntil > state.clock) {
      ctx.save();
      ctx.globalAlpha = performanceLow() ? 0.55 : 0.9;
      ctx.strokeStyle = "#c084fc"; ctx.lineWidth = performanceLow() ? 1 : 2;
      ctx.beginPath(); ctx.arc(drawX, drawY, size * 0.7, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (e.beaconSlowUntil > state.clock || e.revealedUntil > state.clock) {
      ctx.save();
      ctx.globalAlpha = performanceLow() ? 0.45 : 0.75;
      ctx.strokeStyle = "#fb7185"; ctx.lineWidth = performanceLow() ? 1 : 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.arc(drawX, drawY, size * 0.76, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }
    if (e.ability && e.ability.id === "auraArmor") {
      ctx.save();
      ctx.globalAlpha = performanceLow() ? 0.25 : 0.38;
      ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.ability.radius || 90, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (e.ability && e.ability.id === "reflectOnce" && !e.reflectedSkill) {
      ctx.save();
      ctx.globalAlpha = performanceLow() ? 0.4 : 0.7;
      ctx.strokeStyle = "#e879f9"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(drawX, drawY, size * 0.5, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (e.poisonStacks && e.poisonStacks.length) {
      ctx.save();
      ctx.globalAlpha = performanceLow() ? 0.55 : 1;
      ctx.strokeStyle = "#22c55e"; ctx.lineWidth = performanceLow() ? 1 : 2;
      ctx.beginPath(); ctx.arc(drawX, drawY, size * 0.62, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  // 共用圓角漸層血條（V3 場景深度）
  function drawHealthBar(x, y, w, h, pct) {
    const r = h / 2;
    // 外框背景
    ctx.fillStyle = "rgba(0,0,0,.6)";
    roundRect(x - 1, y - 1, w + 2, h + 2, r + 1); ctx.fill();
    // 血量漸層
    if (pct > 0) {
      const c = pct > 0.5 ? ["#86efac", "#22c55e"] : pct > 0.25 ? ["#fde047", "#eab308"] : ["#fca5a5", "#dc2626"];
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
      ctx.fillStyle = g;
      roundRect(x, y, w * pct, h, r); ctx.fill();
    }
  }
  function drawShieldBar(x, y, w, h, pct) {
    ctx.fillStyle = "rgba(15,23,42,.75)";
    roundRect(x - 1, y - 1, w + 2, h + 2, h / 2 + 1); ctx.fill();
    if (pct > 0) {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, "#bfdbfe"); g.addColorStop(1, "#60a5fa");
      ctx.fillStyle = g;
      roundRect(x, y, w * pct, h, h / 2); ctx.fill();
    }
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function projectileVisualSprite(image, projectile, color) {
    const key = `${projectile || "point"}:${color}`;
    let entry = projectileSpriteCache.get(key);
    if (entry && entry.source === image) return entry.canvas;
    const layer = document.createElement("canvas"); layer.width = layer.height = 64;
    const bullet = layer.getContext("2d"); usePixelArt(bullet);
    bullet.shadowColor = color; bullet.shadowBlur = image ? 6 : 8;
    if (image) {
      const size = projectile === "cannonball" ? 22 : 26;
      bullet.drawImage(image, 32 - size / 2, 32 - size / 2, size, size);
    } else {
      bullet.fillStyle = color;
      bullet.beginPath(); bullet.arc(32, 32, 4, 0, Math.PI * 2); bullet.fill();
    }
    if (!projectileSpriteCache.has(key) && projectileSpriteCache.size >= MAX_PROJECTILE_SPRITE_CACHE) projectileSpriteCache.delete(projectileSpriteCache.keys().next().value);
    entry = { source: image, canvas: layer }; projectileSpriteCache.set(key, entry);
    return layer;
  }
  function drawBullet(b) {
    // 有投射物圖 → 畫圖並朝飛行方向旋轉；否則退回發光圓點
    const im = b.projectile ? getImg(`assets/projectiles/${b.projectile}.png`) : null;
    if (im && im.complete && im.naturalWidth > 0) {
      // 飛行方向角度（朝目標）
      let ang = 0;
      if (b.target && !b.target._dead) ang = Math.atan2(b.target.y - b.y, b.target.x - b.x);
      const sz = b.projectile === "cannonball" ? 22 : 26;
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(ang);
      ctx.shadowBlur = 0;
      if (performanceLow()) ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz);
      else ctx.drawImage(projectileVisualSprite(im, b.projectile, b.color), -32, -32);
      ctx.restore();
    } else {
      ctx.shadowBlur = 0;
      if (performanceLow()) {
        ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
      } else ctx.drawImage(projectileVisualSprite(null, null, b.color), b.x - 32, b.y - 32);
    }
  }
  function drawParticle(p) {
    const a = Math.max(0, Math.min(1, p.life * 2));
    ctx.globalAlpha = a;
    if (p.texture) {
      const sprite = tintedFxSprite(p.texture, p.color);
      if (sprite) {
        const ratio = Math.max(0, Math.min(1, p.life / (p.startLife || p.life || 1)));
        const age = 1 - ratio;
        const curve = p.impactCurve || "body";
        const scaleFrom = curve === "flash" ? 1.15 : curve === "smoke" ? 0.82 : 0.94;
        const scaleTo = curve === "flash" ? 0.85 : curve === "smoke" ? 1.18 : 1.06;
        const scale = scaleFrom + (scaleTo - scaleFrom) * age;
        const hold = curve === "flash" ? 0.22 : curve === "smoke" ? 0.06 : 0.14;
        const textureFade = age <= hold ? 1 : Math.max(0, (1 - age) / (1 - hold));
        const size = (p.size || 64) * scale;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation || 0);
        ctx.globalCompositeOperation = p.blend || "source-over";
        ctx.globalAlpha = textureFade * (p.textureAlpha == null ? 0.9 : p.textureAlpha);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
    } else if (p.ring) {
      // 擴張環：半徑隨時間放大、線漸細
      const prog = 1 - p.life / 0.5;
      const r = p.r0 + (p.maxR - p.r0) * prog;
      ctx.strokeStyle = p.color; ctx.lineWidth = 4 * (1 - prog) + 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (p.beam) {
      const prog = 1 - p.life / 0.48;
      const h = 96 * (1 - Math.min(0.65, prog * 0.45));
      ctx.save();
      ctx.globalAlpha = Math.max(0, 0.8 - prog * 0.8);
      const g = ctx.createLinearGradient(p.x, p.y - h, p.x, p.y + 12);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.42, p.color);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(p.x - 7, p.y - h, 14, h + 18);
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r0 + (p.maxR - p.r0) * prog, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    } else if (p.muzzle) {
      const prog = 1 - p.life / 0.12;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle || 0);
      ctx.globalAlpha = Math.max(0, 0.9 - prog * 0.9);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = performanceLow() ? 0 : 14;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo((p.r || 14) * (1 - prog * 0.35), -6);
      ctx.lineTo((p.r || 14) * 0.72, 0);
      ctx.lineTo((p.r || 14) * (1 - prog * 0.35), 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.text) {
      // 傷害/升級數字：剛出現時 scale-in
      const age = (p.big ? 1.0 : 0.8) - p.life;
      const scale = age < 0.1 ? 0.6 + age * 4 : 1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(scale, scale);
      ctx.font = `900 ${p.size}px "Segoe UI", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3.5; ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
      ctx.restore();
    } else {
      // glow 圓點：發光 + 大小隨機
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = performanceLow() ? 0 : 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.r || 2) * a, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  // ===== 輸入 =====
  const TOUCH_DRAG_THRESHOLD = 6;
  const TOUCH_FINE_GAIN = 0.5;
  const TOUCH_SNAP_CSS_RADIUS = 24;
  const TOUCH_SNAP_WORLD_RADIUS = CELL * 1.5;
  let touchGesture = null;
  let suppressCanvasClickUntil = 0;
  function cancelTouchPlacement(clearGhost) {
    touchGesture = null;
    if (!state) return;
    state.touchBuildPreview = null;
    state.touchSkillPreview = null;
    if (clearGhost) { state.buildGhost = null; state.skillGhost = null; state.mouse = null; state.buildPlacementFeedback = ""; }
  }
  function setTouchControlMode(enabled) {
    const next = !!enabled;
    if (next === touchControlMode) return touchControlMode;
    cancelTouchPlacement(true);
    touchControlMode = next;
    if (state) state.touchControlMode = next;
    notifyUI();
    return touchControlMode;
  }
  function skillPreviewFor(skillId, x, y) {
    const sk = SKILLS[skillId], inBounds = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < W && y < H;
    const targetCount = sk && inBounds ? state.enemies.filter(e => !e._dead && !e._leaked && e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= sk.radius).length : 0;
    const reason = !sk ? "請先選擇技能" : state.over ? "本局已結束" : !inBounds ? "超出戰場" : isSkillLocked() ? "目前無法使用技能" :
      state.skillCooldowns[skillId] > 0 ? "技能冷卻中" : !targetCount ? "範圍內沒有目標" : "";
    return { skillId, x, y, radius: sk ? sk.radius : 0, targetCount, ok: !reason, reason };
  }
  function getSkillPlacement() {
    if (!state || state.over || !SKILLS[state.pendingSkill]) return null;
    const active = state.touchSkillPreview;
    const candidate = active || state.skillGhost || { x: W / 2, y: H / 2, source: "default", skillId: state.pendingSkill };
    if (candidate.skillId !== state.pendingSkill) return null;
    return { active: !!active, dragging: !!(active && active.dragging), requiresConfirmation: !active && !!state.skillGhost,
      source: candidate.source || (active ? "touch" : "tap"), preview: skillPreviewFor(state.pendingSkill, candidate.x, candidate.y) };
  }
  function armSkillPreview(x, y, source) {
    if (!SKILLS[state.pendingSkill] || state.over) return false;
    state.skillGhost = { x, y, skillId: state.pendingSkill, source: source || "tap" };
    state.mouse = { x, y };
    notifyUI();
    return true; // An empty or invalid aim remains adjustable and never casts.
  }
  function previewSkillAt(x, y) {
    if (!SKILLS[state.pendingSkill] || state.over || state.touchSkillPreview || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    return armSkillPreview(x, y, "preset");
  }
  function moveSkillPreview(dx, dy) {
    const placement = getSkillPlacement(), xStep = Math.sign(Number(dx)), yStep = Math.sign(Number(dy));
    if (!placement || placement.active || !Number.isFinite(Number(dx)) || !Number.isFinite(Number(dy)) || (!xStep && !yStep) || (xStep && yStep)) return false;
    const x = Math.max(0, Math.min(W - 1, placement.preview.x + xStep * CELL)), y = Math.max(0, Math.min(H - 1, placement.preview.y + yStep * CELL));
    return armSkillPreview(x, y, "nudge");
  }
  function confirmSkillPreview() {
    const placement = getSkillPlacement();
    if (!placement || placement.active || !placement.requiresConfirmation || !placement.preview.ok) { notifyUI(); return false; }
    const { skillId, x, y } = placement.preview;
    if (!castSkill(skillId, x, y)) return false;
    cancelTouchPlacement(true);
    state.pendingSkill = null;
    state.buildMenuTarget = null;
    state.selectedGoddess = false;
    canvas.style.cursor = "default";
    notifyUI();
    return true;
  }
  function drawSkillPreview() {
    const placement = getSkillPlacement();
    if (!placement) return;
    const p = placement.preview, sk = SKILLS[p.skillId];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
    ctx.save();
    ctx.strokeStyle = p.ok ? sk.color : "#f87171";
    ctx.fillStyle = p.ok ? sk.color : "#f87171";
    ctx.globalAlpha = 0.12;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.lineWidth = 2; ctx.setLineDash([8, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(p.x, p.y, 13, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(p.x - 22, p.y); ctx.lineTo(p.x + 22, p.y); ctx.moveTo(p.x, p.y - 22); ctx.lineTo(p.x, p.y + 22); ctx.stroke();
    ctx.restore();
  }
  function inspectTower(order) {
    if (!state || !["number", "string"].includes(typeof order) || typeof order === "string" && !order.trim()) return false;
    const id = Number(order), tower = Number.isInteger(id) ? state.towers.find(t => t.order === id) : null;
    if (!tower) return false;
    cancelTouchPlacement(true);
    state.selectedTowerType = null; state.pendingSkill = null; state.pendingHero = null;
    state.selectedTower = tower; state.selectedGoddess = false; state.buildMenuTarget = null;
    state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null;
    canvas.style.cursor = "default";
    revealCanvasPoint(tower.x, tower.y); notifyUI();
    return true;
  }
  function selectGoddess() {
    if (!state) return false;
    cancelTouchPlacement(true);
    state.selectedTowerType = null; state.pendingSkill = null; state.pendingHero = null;
    state.selectedTower = null; state.selectedGoddess = true; state.buildMenuTarget = null;
    state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null;
    canvas.style.cursor = "default";
    revealCanvasPoint(state.goddess.x, state.goddess.y); notifyUI();
    return true;
  }
  function nearbyTouchTower(point) {
    const rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0) || point.x < 0 || point.y < 0 || point.x >= W || point.y >= H) return null;
    const candidates = state.towers.map(tower => ({ tower, distance2: ((tower.x - point.x) * rect.width / W) ** 2 + ((tower.y - point.y) * rect.height / H) ** 2 }))
      .filter(item => item.distance2 <= TOUCH_SNAP_CSS_RADIUS ** 2 + 1e-8)
      .sort((a, b) => a.distance2 - b.distance2 || a.tower.order - b.tower.order);
    return candidates.length ? candidates[0].tower : null;
  }
  function getBuildPlacementFeedback() { return state && state.buildPlacementFeedback || ""; }
  function getBuildPlacement() {
    if (!state || state.over || !state.selectedTowerType) return null;
    const active = state.touchBuildPreview;
    const candidate = active || state.buildGhost;
    if (!candidate || candidate.typeId && candidate.typeId !== state.selectedTowerType) return null;
    const preview = buildPreviewAt(candidate.x, candidate.y);
    const source = candidate.source || (active ? "touch" : candidate.dragAdjusted ? "drag" : candidate.advisor ? "advisor" : "tap");
    const snapped = !!candidate.snapped;
    return { active: !!active, dragging: !!(active && active.dragging),
      requiresConfirmation: !active && !!state.buildGhost,
      source, snapped, feedback: getBuildPlacementFeedback(),
      inputPoint: Number.isFinite(candidate.inputX) && Number.isFinite(candidate.inputY) ? { x: candidate.inputX, y: candidate.inputY } : null,
      preview: { ...preview, source, snapped, typeId: state.selectedTowerType, cost: TOWERS[state.selectedTowerType].cost } };
  }
  function armBuildPreview(x, y, source, metadata) {
    if (!state.selectedTowerType) return false;
    const preview = buildPreviewAt(x, y);
    state.buildGhost = { x, y, cx: preview.cx, cy: preview.cy, typeId: state.selectedTowerType,
      source, dragAdjusted: source === "drag", snapped: !!(metadata && metadata.snapped),
      inputX: metadata && metadata.inputX, inputY: metadata && metadata.inputY };
    state.mouse = { x, y };
    state.buildPlacementFeedback = preview.ok ? "" : preview.reason;
    notifyUI();
    return preview.ok;
  }
  function buildSnapCrossesPath(from, to) {
    const cross = (a, b, p) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const on = (a, b, p) => Math.abs(cross(a, b, p)) <= 1e-8 && p.x >= Math.min(a.x, b.x) - 1e-8 &&
      p.x <= Math.max(a.x, b.x) + 1e-8 && p.y >= Math.min(a.y, b.y) - 1e-8 && p.y <= Math.max(a.y, b.y) + 1e-8;
    const paths = [state.mapDef.path || state.path].concat((state.mapDef.bridges || []).map(bridge => bridge.path));
    for (const path of paths) for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i], x1 = cross(from, to, a), x2 = cross(from, to, b), x3 = cross(a, b, from), x4 = cross(a, b, to);
      if (x1 * x2 < 0 && x3 * x4 < 0 || on(from, to, a) || on(from, to, b) || on(a, b, from) || on(a, b, to)) return true;
    }
    return false;
  }
  function safeBuildSnap(from, to) {
    // Walking LOS checks use existing geography, without A* or new collision data.
    // An actual water/cliff/lava point stays red; a land point whose tile footprint
    // touches the shore may align to a nearby cell on the same bank.
    return (!TDRules.lineWalkable || TDRules.lineWalkable(state.mapDef, from, to, 0)) && !buildSnapCrossesPath(from, to);
  }
  function nearbyBuildCandidate(point, cssRadius) {
    const cx = Math.floor(point.x / CELL), cy = Math.floor(point.y / CELL), rect = canvas.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    const scaleX = rect.width / W, scaleY = rect.height / H, candidates = [];
    const maxCx = Math.floor(W / CELL) - 1, maxCy = Math.floor(H / CELL) - 1;
    for (let row = Math.max(0, cy - 1); row <= Math.min(maxCy, cy + 1); row++) {
      for (let col = Math.max(0, cx - 1); col <= Math.min(maxCx, cx + 1); col++) {
        const center = cellCenter(col, row), dx = center.x - point.x, dy = center.y - point.y, distance2 = dx * dx + dy * dy;
        if (distance2 > TOUCH_SNAP_WORLD_RADIUS ** 2 + 1e-8) continue;
        if (Number.isFinite(cssRadius) && (dx * scaleX) ** 2 + (dy * scaleY) ** 2 > cssRadius ** 2 + 1e-8) continue;
        const preview = buildPreviewAt(center.x, center.y);
        if (!preview.ok || !safeBuildSnap(point, center)) continue;
        candidates.push({ ...preview, distance2 });
      }
    }
    candidates.sort((a, b) => Math.abs(a.distance2 - b.distance2) > 1e-8 ? a.distance2 - b.distance2 : a.cy - b.cy || a.cx - b.cx);
    return candidates[0] || null;
  }
  function resolveTouchBuildPoint(point) {
    const result = { x: point.x, y: point.y, inputX: point.x, inputY: point.y, snapped: false };
    const def = TOWERS[state.selectedTowerType], raw = buildPreviewAt(point.x, point.y);
    if (raw.ok || !def || state.gold < def.cost || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
      point.x < 0 || point.y < 0 || point.x >= W || point.y >= H || raw.terrainKind === "bounds") return result;
    const nearby = nearbyBuildCandidate(point, TOUCH_SNAP_CSS_RADIUS);
    return nearby ? { ...result, x: nearby.x, y: nearby.y, snapped: true } : result;
  }
  function suggestBuildPlacement() {
    const def = TOWERS[state.selectedTowerType];
    if (!def || state.over || state.touchBuildPreview) {
      state.buildPlacementFeedback = state.touchBuildPreview ? "放開手指後再選建議位" : "請先選擇砲塔";
      notifyUI(); return false;
    }
    if (state.gold < def.cost) { state.buildPlacementFeedback = "金錢不足"; notifyUI(); return false; }
    const preferredPad = def.id === "arrow" ? "front-arrow" : ["frost", "beacon"].includes(def.id) ? "front-control" :
      ["poison", "sniper"].includes(def.id) ? "rear-main" : null;
    const zones = ["poison", "sniper"].includes(def.id) ? ["rear", "crossfire", "front"] :
      ["cannon", "tesla", "mortar", "support"].includes(def.id) ? ["crossfire", "front", "rear"] : ["front", "rear", "crossfire"];
    const padRank = (pad) => pad.id === preferredPad ? -1 : zones.indexOf(pad.zone) < 0 ? 3 : zones.indexOf(pad.zone);
    const pads = (state.mapDef.buildPads || []).map((pad, index) => ({ pad, index }))
      .sort((a, b) => padRank(a.pad) - padRank(b.pad) || a.index - b.index);
    for (const { pad } of pads) {
      const exact = buildPreviewAt(pad.x, pad.y), chosen = exact.ok ? exact : nearbyBuildCandidate(pad, Infinity);
      if (!chosen) continue;
      cancelTouchPlacement(true); state.advisorBuildConfirm = false;
      return armBuildPreview(chosen.x, chosen.y, "suggest");
    }
    state.buildPlacementFeedback = "目前沒有適合此塔的合法建議位";
    notifyUI(); return false;
  }
  function moveBuildPreview(dx, dy) {
    const placement = getBuildPlacement(), xStep = Math.sign(Number(dx)), yStep = Math.sign(Number(dy));
    if (!placement || placement.active) { state.buildPlacementFeedback = placement && placement.active ? "放開手指後再微調" : "先點棋盤或選建議位"; notifyUI(); return false; }
    if (!Number.isFinite(xStep) || !Number.isFinite(yStep) || (!xStep && !yStep) || (xStep && yStep)) return false;
    const maxCx = Math.floor(W / CELL) - 1, maxCy = Math.floor(H / CELL) - 1;
    const cx = Math.max(0, Math.min(maxCx, placement.preview.cx + xStep)), cy = Math.max(0, Math.min(maxCy, placement.preview.cy + yStep));
    const center = cellCenter(cx, cy);
    cancelTouchPlacement(true); state.advisorBuildConfirm = false;
    armBuildPreview(center.x, center.y, "nudge");
    return true; // Movement succeeded; an invalid cell remains a red, unpaid preview.
  }
  function confirmBuildPreview() {
    const placement = getBuildPlacement();
    if (!placement || placement.active || !placement.requiresConfirmation) return false;
    const ghost = state.buildGhost;
    if (!placement.preview.ok) { state.buildPlacementFeedback = placement.preview.reason; notifyUI(); return false; }
    const built = !!tryBuildTower(ghost.x, ghost.y);
    if (built) {
      state.touchBuildPreview = null;
      state.advisorBuildConfirm = false;
      state.selectedTowerType = null; canvas.style.cursor = "default";
    }
    notifyUI();
    return built;
  }
  function canvasPos(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
  }
  function fineTouchPoint(gesture, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(W - 1, gesture.anchorX + (clientX - gesture.x) * W / rect.width * TOUCH_FINE_GAIN)),
      y: Math.max(0, Math.min(H - 1, gesture.anchorY + (clientY - gesture.y) * H / rect.height * TOUCH_FINE_GAIN)),
    };
  }
  function revealCanvasPoint(x, y) {
    const host = document.getElementById("battlefieldScroll");
    if (!host || host.scrollWidth <= host.clientWidth + 2) return;
    const scaleX = canvas.clientWidth / W;
    const scaleY = canvas.clientHeight / H;
    host.scrollLeft = Math.max(0, Math.min(host.scrollWidth - host.clientWidth, x * scaleX - host.clientWidth / 2));
    host.scrollTop = Math.max(0, Math.min(host.scrollHeight - host.clientHeight, y * scaleY - host.clientHeight / 2));
  }
  // 點擊/觸控的共用處理（座標已換算，RWD 縮放下也正確）
  function handleBuildTap(p, isTouch) {
    const assisted = isTouch || touchControlMode;
    if (state.advisorBuildConfirm && !assisted) {
      const preview = buildPreviewAt(p.x, p.y);
      const ghost = state.buildGhost;
      const same = preview.ok && ghost && preview.cx === ghost.cx && preview.cy === ghost.cy;
      if (same) {
        return confirmBuildPreview();
      }
      state.advisorBuildConfirm = false;
      state.selectedTowerType = null;
      state.buildGhost = null;
      canvas.style.cursor = "default";
      log("已取消顧問建造預覽。");
      notifyUI();
      return false;
    }
    if (!assisted) { tryBuildTower(p.x, p.y); return; }
    const raw = buildPreviewAt(p.x, p.y), point = resolveTouchBuildPoint(p), preview = buildPreviewAt(point.x, point.y);
    // A snapped invalid tap is never a second confirming tap, even if it aligns
    // back to the already armed cell. Only touching the actual legal cell buys.
    const same = raw.ok && !point.snapped && state.buildGhost && state.buildGhost.cx === raw.cx && state.buildGhost.cy === raw.cy &&
      (!state.buildGhost.typeId || state.buildGhost.typeId === state.selectedTowerType);
    if (same) { confirmBuildPreview(); return; }
    state.advisorBuildConfirm = false;
    armBuildPreview(point.x, point.y, "tap", point);
    if (!preview.ok) {
      flashText(preview.x, preview.y - 18, preview.reason, { color: "#f87171", size: 14, big: true });
      log(preview.reason + "！", "bad");
    }
  }

  function handleTap(p, isTouch) {
    const assisted = isTouch || touchControlMode;
    if (state.pendingSkill) {
      if (assisted) { armSkillPreview(p.x, p.y, "tap"); return; }
      const casted = castSkill(state.pendingSkill, p.x, p.y);
      if (casted) {
        cancelTouchPlacement(true);
        state.pendingSkill = null;
        state.buildMenuTarget = null;
        state.selectedGoddess = false;
        canvas.style.cursor = "default";
        notifyUI();
      }
      return;
    }
    if (state.selectedTowerType) { handleBuildTap(p, isTouch); return; }
    // D9 駐守：已選中英雄 → 點地圖設駐守點（點英雄自己=取消駐守）
    if (state.pendingHero) {
      const h = state.heroes.find((x) => x.uid === state.pendingHero);
      if (h) {
        const onSelf = Math.hypot(p.x - h.x, p.y - h.y) < CELL * 0.6;
        if (!onSelf && !state.debugIgnoreTerrain && TDRules.heroRoute) {
          const route = queryHeroRoute(h, p);
          if (!route.reachable) {
            log("這裡無法駐守，請選陸地或橋面。", "bad");
            flashText(p.x, p.y - 18, "請選可到達的陸地", { color: "#f87171", size: 13, big: true });
            notifyUI(); return;
          }
        }
        h.guardPoint = onSelf ? null : { x: p.x, y: p.y };
        h.navigation = null;
        log(onSelf ? `${HEROES[h.id].name} 解除駐守，自由作戰。` : `${HEROES[h.id].name} 駐守此地！`);
      }
      state.pendingHero = null; canvas.style.cursor = "default";
      state.buildMenuTarget = null;
      state.selectedGoddess = false;
      notifyUI();
      return;
    }
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    const exactTower = state.towers.find((t) => t.cx === cx && t.cy === cy);
    if (assisted && exactTower) { inspectTower(exactTower.order); return; }
    // Touching a tower's actual cell wins over a hero passing in front of it.
    // The existing mouse selection order stays unchanged on a pure desktop.
    // 點到地圖上的英雄 → 選中它（準備設駐守點）
    const hero = state.heroes.find((x) => Math.hypot(p.x - x.x, p.y - x.y) < CELL * 0.5);
    if (hero) {
      state.pendingHero = hero.uid; canvas.style.cursor = "crosshair";
      state.selectedTower = null;
      state.selectedGoddess = false;
      state.buildMenuTarget = null;
      log(`已選 ${HEROES[hero.id].name}，點地圖指定駐守點（點它自己取消駐守）。`);
      notifyUI();
      return;
    }
    const tw = exactTower || (assisted ? nearbyTouchTower(p) : null);
    const onGoddess = Math.hypot(p.x - state.goddess.x, p.y - state.goddess.y) <= CELL * 0.85;
    if (onGoddess) {
      state.selectedTower = null;
      state.selectedGoddess = true;
      state.buildMenuTarget = null;
      notifyUI();
      return;
    }
    if (tw) {
      if (assisted) { inspectTower(tw.order); return; }
      state.selectedTower = tw;
      state.selectedGoddess = false;
      state.buildMenuTarget = null;
      notifyUI();
      return;
    }
    state.selectedTower = null;
    state.selectedGoddess = false;
    const options = buildOptionsAt(p.x, p.y);
    const center = cellCenter(cx, cy);
    state.buildMenuTarget = options.length ? { x: center.x, y: center.y, cx, cy } : null;
    notifyUI();
  }
  canvas.addEventListener("mousemove", (ev) => { state.mouse = canvasPos(ev.clientX, ev.clientY); });
  canvas.addEventListener("click", (ev) => {
    if (state.touchBuildPreview || state.touchSkillPreview || performance.now() < suppressCanvasClickUntil || ev.sourceCapabilities && ev.sourceCapabilities.firesTouchEvents) return;
    handleTap(canvasPos(ev.clientX, ev.clientY), false);
  });
  // 觸控支援：tap 建塔/選塔/放技能
  canvas.addEventListener("touchstart", (ev) => {
    suppressCanvasClickUntil = performance.now() + 700;
    if (ev.touches.length !== 1) { cancelTouchPlacement(true); notifyUI(); return; }
    const t = ev.touches[0], point = canvasPos(t.clientX, t.clientY);
    const ghost = state.selectedTowerType ? state.buildGhost : state.pendingSkill ? state.skillGhost : null;
    const sameGhost = ghost && ghost.cx === Math.floor(point.x / CELL) && ghost.cy === Math.floor(point.y / CELL);
    touchGesture = { id: t.identifier, x: t.clientX, y: t.clientY, moved: false,
      typeId: state.selectedTowerType, skillId: state.pendingSkill, anchorX: sameGhost ? ghost.x : point.x, anchorY: sameGhost ? ghost.y : point.y };
    state.mouse = point;
    if (state.selectedTowerType) {
      const previewPoint = resolveTouchBuildPoint({ x: touchGesture.anchorX, y: touchGesture.anchorY });
      state.touchBuildPreview = { ...previewPoint, source: "touch", typeId: state.selectedTowerType, dragging: false };
      notifyUI();
    } else if (state.pendingSkill) {
      state.touchSkillPreview = { ...point, source: "touch", skillId: state.pendingSkill, dragging: false };
      notifyUI();
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (ev) => {
    if (!touchGesture) return;
    if (ev.touches.length !== 1) { cancelTouchPlacement(true); notifyUI(); return; }
    const t = Array.from(ev.touches).find((touch) => touch.identifier === touchGesture.id);
    if (!t) { cancelTouchPlacement(true); notifyUI(); return; }
    const dx = t.clientX - touchGesture.x, dy = t.clientY - touchGesture.y;
    if (Math.hypot(dx, dy) >= (touchGesture.typeId || touchGesture.skillId ? TOUCH_DRAG_THRESHOLD : 10)) touchGesture.moved = true;
    if (touchGesture.skillId) {
      if (touchGesture.skillId !== state.pendingSkill || state.over) { cancelTouchPlacement(true); notifyUI(); return; }
      if (ev.cancelable) ev.preventDefault();
      const point = fineTouchPoint(touchGesture, t.clientX, t.clientY);
      state.touchSkillPreview = { ...point, source: "touch", skillId: touchGesture.skillId, dragging: touchGesture.moved };
      notifyUI();
      return;
    }
    if (!touchGesture.typeId) return;
    if (touchGesture.typeId !== state.selectedTowerType || state.over) { cancelTouchPlacement(true); notifyUI(); return; }
    if (ev.cancelable) ev.preventDefault();
    const previous = state.touchBuildPreview;
    const previewPoint = resolveTouchBuildPoint(fineTouchPoint(touchGesture, t.clientX, t.clientY));
    const { x, y } = previewPoint;
    state.touchBuildPreview = { ...previewPoint, source: "touch", typeId: touchGesture.typeId, dragging: touchGesture.moved };
    state.buildPlacementFeedback = buildPreviewAt(x, y).ok ? "" : buildPreviewAt(x, y).reason;
    if (!previous || previous.dragging !== touchGesture.moved ||
      previous.snapped !== previewPoint.snapped || Math.floor(previous.x / CELL) !== Math.floor(x / CELL) || Math.floor(previous.y / CELL) !== Math.floor(y / CELL)) notifyUI();
  }, { passive: false });
  canvas.addEventListener("touchend", (ev) => {
    ev.preventDefault(); // 避免觸發後續的合成 click（重複觸發）
    suppressCanvasClickUntil = performance.now() + 700;
    if (!touchGesture) return;
    const gesture = touchGesture;
    const t = Array.from(ev.changedTouches).find((touch) => touch.identifier === gesture.id);
    touchGesture = null;
    state.touchBuildPreview = null;
    state.touchSkillPreview = null;
    if (!t || ev.touches.length || gesture.typeId && gesture.typeId !== state.selectedTowerType || gesture.skillId && gesture.skillId !== state.pendingSkill) { cancelTouchPlacement(true); notifyUI(); return; }
    // Chrome may coalesce a short drag and deliver no touchmove before touchend.
    // Check the release displacement too; an already armed cell must never make
    // that missing move event look like a confirming tap.
    const moved = gesture.moved || Math.hypot(t.clientX - gesture.x, t.clientY - gesture.y) >=
      (gesture.typeId || gesture.skillId ? TOUCH_DRAG_THRESHOLD : 10);
    if (gesture.skillId) {
      const point = moved ? fineTouchPoint(gesture, t.clientX, t.clientY) : canvasPos(t.clientX, t.clientY);
      armSkillPreview(point.x, point.y, moved ? "drag" : "tap");
      return;
    }
    if (gesture.typeId && moved) {
      const preview = resolveTouchBuildPoint(fineTouchPoint(gesture, t.clientX, t.clientY));
      state.advisorBuildConfirm = false;
      armBuildPreview(preview.x, preview.y, "drag", preview);
      return;
    }
    if (!moved) handleTap(canvasPos(t.clientX, t.clientY), true);
    notifyUI();
  }, { passive: false });
  canvas.addEventListener("touchcancel", () => {
    suppressCanvasClickUntil = performance.now() + 700;
    cancelTouchPlacement(true); notifyUI();
  }, { passive: true });
  function cancelPlacementAfterViewportChange() {
    if (!state || !(touchGesture || state.touchBuildPreview || state.buildGhost || state.touchSkillPreview || state.skillGhost)) return;
    suppressCanvasClickUntil = performance.now() + 700;
    cancelTouchPlacement(true);
    state.advisorBuildConfirm = false;
    notifyUI();
  }
  if (typeof window.addEventListener === "function") {
    window.addEventListener("resize", cancelPlacementAfterViewportChange);
    window.addEventListener("orientationchange", cancelPlacementAfterViewportChange);
  }

  function previewAdvisorAction(action) {
    if (!action || state.over) return false;
    if (action.kind === "build" && TOWERS[action.towerId]) {
      cancelTouchPlacement(true);
      const rawX = Number.isFinite(action.x) ? action.x : (Number.isFinite(action.cx) ? action.cx * CELL + CELL / 2 : W / 2);
      const rawY = Number.isFinite(action.y) ? action.y : (Number.isFinite(action.cy) ? action.cy * CELL + CELL / 2 : H / 2);
      state.selectedTowerType = action.towerId;
      state.selectedTower = null;
      state.selectedGoddess = false;
      state.buildMenuTarget = null;
      state.pendingSkill = null;
      state.pendingHero = null;
      state.advisorUpgradeTarget = null;
      let preview = buildPreviewAt(rawX, rawY);
      if (!preview.ok) {
        let best = null;
        for (let cy = 0; cy < Math.ceil(H / CELL); cy++) {
          for (let cx = 0; cx < Math.ceil(W / CELL); cx++) {
            const p = cellCenter(cx, cy);
            const candidate = buildPreviewAt(p.x, p.y);
            if (!candidate.ok) continue;
            const score = Math.hypot(candidate.x - rawX, candidate.y - rawY);
            if (!best || score < best.score) best = Object.assign({ score }, candidate);
          }
        }
        if (best) preview = best;
      }
      if (!preview.ok) {
        state.selectedTowerType = null;
        log(preview.reason || "顧問建議暫無合法落點", "bad");
        return false;
      }
      state.advisorBuildConfirm = true;
      state.buildGhost = { x: preview.x, y: preview.y, cx: preview.cx, cy: preview.cy, advisor: true, typeId: action.towerId };
      state.mouse = { x: preview.x, y: preview.y };
      revealCanvasPoint(preview.x, preview.y);
      canvas.style.cursor = "crosshair";
      flashText(preview.x, preview.y - 18, "再點一次確認建造", { color: "#fde047", size: 13, big: true });
      render();
      notifyUI();
      return true;
    }
    if (action.kind === "upgrade") {
      const index = Math.max(0, Math.floor(Number(action.towerIndex)));
      const tw = state.towers[index];
      if (!tw) return false;
      cancelTouchPlacement(true);
      state.selectedTower = tw;
      state.selectedTowerType = null;
      state.selectedGoddess = false;
      state.buildMenuTarget = null;
      state.pendingSkill = null;
      state.pendingHero = null;
      state.advisorBuildConfirm = false;
      state.buildGhost = null;
      state.advisorUpgradeTarget = tw;
      canvas.style.cursor = "default";
      flashText(tw.x, tw.y - 24, "建議升級", { color: "#facc15", size: 13, big: true });
      render();
      notifyUI();
      return true;
    }
    return false;
  }

  function log(msg, kind) { if (typeof window.__tdLog === "function") window.__tdLog(msg, kind); }

  // 初始化 clock
  function bootstrap() {
    newGame();
    state.clock = 0; state.mouse = null;
    document.documentElement.classList.toggle("reduced-effects", reducedEffectsEnabled());
    preloadFxTextures();
    render();
  }
  bootstrap();

  // One RAF drives both the preparation view and the live battle. Starting or
  // restarting a run changes state only and cannot add another RAF chain.
  (function frameLoop(t) {
    advanceFrame(t);
    requestAnimationFrame(frameLoop);
  })();

  // ===== 對外接口（給 UI 與測試）=====
  window.TD = {
    state: () => state,
    newGame: (options) => { newGame(options); state.clock = 0; render(); },
    startWave,
    canStartFirstWave,
    chooseContract, chooseRelic, skipRelic, skipDraft: skipRelic,
    isSkillLocked, skillStat, heroBattleStat,
    getExpeditionModifiers: () => Object.assign({}, state.expeditionModifiers),
    TOWER_PRIORITIES, getTowerPriority, setTowerPriority,
    getBuildPlacement, confirmBuildPreview, suggestBuildPlacement, moveBuildPreview, getBuildPlacementFeedback,
    setTouchControlMode, getTouchControlMode: () => touchControlMode,
    getSkillPlacement, previewSkillAt, moveSkillPreview, confirmSkillPreview,
    inspectTower, selectGoddess,
    selectTower: (type) => { cancelTouchPlacement(true); state.selectedTowerType = TOWERS[type] ? type : null; state.selectedTower = null; state.selectedGoddess = false; state.buildMenuTarget = null; state.pendingSkill = null; state.pendingHero = null; state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null; },
    cancelBuild: () => { cancelTouchPlacement(true); state.selectedTowerType = null; state.advisorBuildConfirm = false; notifyUI(); },
    selectSkill: (id) => { if (SKILLS[id] && state.skillCooldowns[id] <= 0 && !isSkillLocked()) { cancelTouchPlacement(true); state.selectedTowerType = null; state.pendingHero = null; state.pendingSkill = id; state.selectedTower = null; state.selectedGoddess = false; state.buildMenuTarget = null; state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null; canvas.style.cursor = "crosshair"; playSfx("ui"); return true; } return false; },
    upgradeSelected: () => { if (state.selectedTower) upgradeTower(state.selectedTower); },
    sellSelected: () => { if (state.selectedTower) sellTower(state.selectedTower); },
    upgradeGoddess, goddessUpgradeCost,
    upgradeCost, towerStat, getTowerBuff: supportBuffFor, effectiveTowerDamage, supportDpsGain,
    buildOptionsAt, buildTowerAt, closeSceneMenus,
    deployHero, selectHeroGuard, rollHero,  // 英雄上場、駐守與抽卡
    rollHeroWithPity,      // 含保底的抽卡（Stage 1：pity 由 ui.js 的 meta 持久化）
    rollHeroWithPityPreferNew, // 新手第二隻英雄避開重複
    previewNextWave,       // 下一波預告（D4）
    previewAdvisorAction,
    setDifficulty, getDifficulty,  // 難度模式（鉤子）
    setMap, getMap,
    setAdvisorMode: (mode) => { state.advisorMode = (TDRules.ADVISOR_MODES && TDRules.ADVISOR_MODES[mode]) ? mode : "control"; },
    setPerformanceMode,
    setPathGuideVisible, getPathGuideVisible,
    getPerformanceStatus,
    setReducedEffects,
    setAudioMuted,
    setAudioVolume,
    getJuiceSettings,
    playSfx,
    togglePause,                   // 暫停（D10）
    setPaused, // 強制暫停/恢復（抽卡動畫用，不能用 toggle）
    cancelSelect: () => { cancelTouchPlacement(true); state.selectedTowerType = null; state.selectedTower = null; state.selectedGoddess = false; state.buildMenuTarget = null; state.pendingSkill = null; state.pendingHero = null; state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null; canvas.style.cursor = "default"; notifyUI(); },
    setSpeed: (s) => { state.speed = Math.max(1, Math.min(3, Number(s) || 1)); },
    buildPreviewAt: (x, y) => buildPreviewAt(x, y),
    drainIntroLogs: () => {
      const items = state && Array.isArray(state.introLogs) ? state.introLogs.splice(0) : [];
      return items;
    },
    debug: {
      advanceFrame: (timestamp, shouldRender) => advanceFrame(timestamp, shouldRender === true),
      engineStats: () => ({ ...engineMetrics, fixedStepSeconds: FIXED_STEP, maxFrameSteps: MAX_FRAME_STEPS,
        accumulatorSeconds: frameAccumulator, backgroundFrozen: !!document.hidden, liveLoopActive,
        hitFrameEntries: hitFrameCache.size, maxHitFrameEntries: MAX_HIT_FRAME_CACHE,
        projectileSpriteEntries: projectileSpriteCache.size, maxProjectileSpriteEntries: MAX_PROJECTILE_SPRITE_CACHE,
        mapArtReady: !!window.TDMapArt, terrainPlateReady: !!(state.backgroundCache && state.backgroundCache.ready),
        navigationReady: !!state.navigationReady, terrainNavigationEnabled: !state.debugIgnoreTerrain }),
      spawnEnemy: (type, overrides) => {
        const e = createEnemy({ type, hpScale: 1 }, overrides);
        state.enemies.push(e);
        return e;
      },
      step: (dt) => { update(dt || 0.016); render(); },
      stepSimulation: (dt) => update(dt || 0.016),
      fireTower: (tw, target) => fire(tw, target),
      acquireTarget: (tw) => acquireTarget(tw),
      applyDamage: (enemy, amount, opts) => applyDamage(enemy, amount, opts),
      killEnemy: (enemy) => killEnemy(enemy),
      enemyAnimationColumn: (enemy, lowQuality) => {
        const animation = ENEMY_ANIMATIONS[enemy.id] || ENEMY_ANIMATIONS.slime;
        return enemy._dead ? ENEMY_ANIMATION_ATLAS.deathStart : enemyWalkFrame(enemy, animation, !!lowQuality);
      },
      heroAnimationColumn: (hero, lowQuality) => {
        const animation = HERO_ANIMATIONS[hero.id] || HERO_ANIMATIONS.knight;
        return heroAnimationColumn(hero, animation, !!lowQuality);
      },
      beginHeroAttack: (hero, target) => heroAttack(hero, target),
      heroAttackPhaseDuration: (hero, phase) => heroAttackPhaseDuration(HEROES[hero.id], phase),
      forceEnemyAtlasFallback: (enabled) => { forceEnemyAtlasFallback = !!enabled; render(); return forceEnemyAtlasFallback; },
      castSkill: (id, x, y) => castSkill(id, x, y),
      playSfx,
      pushParticle: (p, allowReduced) => pushParticle(p, allowReduced),
      texturedImpact: (kind, x, y, color, opts) => texturedImpact(kind, x, y, color, opts),
      fxCacheStats,
      towerVisualStyle,
      towerRenderProfile,
      towerGlowPolicy,
      towerMaterialStyle,
      visualSnapshot: () => ({
        mapId: state.mapId,
        themes: Object.fromEntries(Object.entries(MAP_VISUALS).map(([id, item]) => [id, { tint: item.tint, breath: item.breath, detail: item.detail }])),
        pathDetailReady: !!state.pathDetailCache,
        reduced: reducedEffectsEnabled(),
        performance: getPerformanceStatus().quality,
      }),
      simulateSfxEviction,
      celebrateWaveClear: (wave, bonus, clean) => celebrateWaveClear(wave || state.wave || 1, bonus || 0, !!clean),
      forcePerformanceSample: (fps) => { handlePerformanceSample(fps); return getPerformanceStatus(); },
    },
    config: { TOWERS, ENEMIES, SKILLS, UPGRADE, GAME, GODDESS, HEROES, HERO_RARITY, GACHA, DIFFICULTIES, MAPS, MAP_AFFIXES, EVENT_WAVES, ACHIEVEMENTS, BEGINNER_MISSIONS },
  };

  // R63 可重現的只讀驗收入口：由 URL 決定場景，瀏覽器不需注入或改寫頁面狀態。
  function applyR63EvidenceScenario(name) {
    if (!name || !["walk", "attack", "fallback"].includes(name)) return;
    newGame();
    document.documentElement.classList.add("r63-evidence");
    if (!document.getElementById("r63EvidenceStyle")) {
      const style = document.createElement("style");
      style.id = "r63EvidenceStyle";
      style.textContent = ".r63-evidence .mission-toast,.r63-evidence .bond-toast,.r63-evidence .recovery-toast,.r63-evidence .pwa-update-toast{display:none!important}";
      document.head.appendChild(style);
    }
    state.running = false;
    state.paused = false;
    state.heroes.length = 0;
    state.enemies.length = 0;
    state.towers.length = 0;
    state.bullets.length = 0;
    state.particles.length = 0;
    state.banner = null;
    forceEnemyAtlasFallback = name === "fallback";

    const labels = {
      walk: "R63 · TRUE-FRAME WALK · walkDist 驅動裁幀",
      attack: "R63 · ANTICIPATION → IMPACT → RECOVERY",
      fallback: "R63 · GEN-2 CLEAN FALLBACK · 無黑底方塊",
    };
    let banner = document.querySelector(".r63-evidence-banner");
    if (!banner) {
      banner = document.createElement("div");
      banner.className = "r63-evidence-banner";
      banner.style.cssText = "position:fixed;z-index:9999;top:10px;left:50%;transform:translateX(-50%);padding:8px 14px;border:1px solid #67e8f9;border-radius:999px;background:rgba(2,6,23,.9);color:#e0f2fe;font:700 12px/1.2 ui-monospace,monospace;letter-spacing:.04em;white-space:nowrap;pointer-events:none";
      document.body.appendChild(banner);
    }
    banner.textContent = labels[name];

    if (name === "walk") {
      const ids = ["knight", "archer", "mage", "valkyrie", "daji", "guanyu", "wukong", "nezha"];
      for (let index = 0; index < ids.length; index++) {
        deployHero(ids[index]);
        const h = state.heroes[state.heroes.length - 1];
        h.x = 115 + (index % 4) * 150;
        h.y = 135 + Math.floor(index / 4) * 235;
        h.guardPoint = { x: h.x + (index % 2 ? -90 : 90), y: h.y + (index < 4 ? 42 : -42) };
        h.walkDist = 10 + index * 13;
        h.animSeed = index / ids.length;
        h.cd = 99;
        updateHero(h, 0.12);
      }
    } else if (name === "attack") {
      const ids = ["guanyu", "nezha", "mage"];
      const phases = [HERO_ATTACK_PHASE.ANTICIPATION, HERO_ATTACK_PHASE.IMPACT, HERO_ATTACK_PHASE.RECOVERY];
      for (let index = 0; index < ids.length; index++) {
        deployHero(ids[index]);
        const h = state.heroes[state.heroes.length - 1];
        h.x = 175 + index * 190;
        h.y = 350;
        h.facing = "right";
        h.attackPhase = phases[index];
        h.attackTimer = 99;
        h.cd = 99;
      }
    } else {
      const ids = ["abysshound", "emberbat", "frostwraith", "lavagolem", "thunderronin", "yaksha"];
      for (let index = 0; index < ids.length; index++) {
        const e = createEnemy(ids[index], {
          x: 75 + (index % 3) * 120,
          y: 160 + Math.floor(index / 3) * 190,
          speed: 0,
          walkDist: index * 17,
        });
        state.enemies.push(e);
      }
    }
    render();
  }

  applyR63EvidenceScenario(new URLSearchParams(window.location.search).get("r63Evidence"));
})();
