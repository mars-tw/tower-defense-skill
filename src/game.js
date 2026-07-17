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
  function markPathCells(path) {
    blocked.clear();
    const shared = TDRules.pathBlockedCells ? TDRules.pathBlockedCells(path, CELL) : new Set();
    for (const key of shared) blocked.add(key);
  }

  // ===== 遊戲狀態 =====
  let state;
  let lastT = 0;
  let loopToken = 0;
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
  const MAP_VISUALS = {
    plains: { ground: "#0e1a14", tint: "rgba(16,185,129,.12)", breath: "rgba(110,231,183,.12)", pathWash: "rgba(242,200,111,.62)", detail: "footprints" },
    canyon: { ground: "#221912", tint: "rgba(180,83,9,.24)", breath: "rgba(251,191,36,.11)", pathWash: "rgba(242,228,190,.58)", detail: "slabs" },
    lava: { ground: "#1d1014", tint: "rgba(153,27,27,.32)", breath: "rgba(251,113,133,.12)", pathWash: "rgba(205,220,228,.60)", detail: "cracks" },
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

  function newGame(options) {
    const opts = options || {};
    loopToken++; // 作廢任何正在跑的舊迴圈
    const mapDef = getMap();
    const path = mapDef.path;
    const hasRunSeed = Object.prototype.hasOwnProperty.call(opts, "runSeed");
    const hasAffixSeed = Object.prototype.hasOwnProperty.call(opts, "affixSeed");
    const runSeed = normalizedSeed(opts.runSeed, hasRunSeed ? 1 : randomRunSeed());
    const affixSeed = normalizedSeed(opts.affixSeed, hasAffixSeed ? 1 : randomRunSeed());
    const affix = TDRules.selectMapAffix ? TDRules.selectMapAffix(affixSeed) : null;
    markPathCells(path);
    const end = path[path.length - 1];
    state = {
      gold: Math.round(GAME.startGold * (mapDef.goldMul || 1)), wave: 0, score: 0,
      // 守護女神：被保護的核心
      goddess: (() => { const gm = getDifficulty().goddessMul; const hp = Math.round(GODDESS.baseHp * gm); return { level: 1, hp, maxHp: hp, x: end.x, y: end.y, smiteCd: 0, hitFlash: 0 }; })(),
      towers: [], heroes: [], enemies: [], bullets: [], particles: [],
      spawnQueue: [], spawnTimer: 0, clock: 0, mouse: null,
      mapId: mapDef.id, mapDef, path, runSeed, affixSeed, affix,
      pathTotalLength: pathLength(path),
      waveSeeds: {}, backgroundCache: null, pathDetailCache: null, buildableReachCache: null,
      performance: perfState,
      combo: 0, comboTimer: 0, kills: 0,  // D5 連殺系統
      cleanStreak: 0, waveLeaks: 0, redVignette: 0, slowMoLeft: 0, slowMoScale: 1, fxTimeScale: 1,
      effectSeed: ((runSeed ^ (affixSeed << 1) ^ 0x9e3779b9) >>> 0) || 1,
      runSoulEarned: 0, runMissionSoulEarned: 0, soulRewardedWaves: new Set(),
      runLeaks: { total: 0, byWave: {} },
      towersBuilt: 0, towerUpgrades: 0, skillCasts: 0, bossKills: 0, clearedWave: 0,
      running: false, over: false, betweenWaves: true, waveTotal: 0, waveResolved: 0,
      selectedTowerType: null,   // 準備建造的塔
      selectedTower: null,        // 已選中的塔（看升級）
      selectedGoddess: false,     // R64：直接點女神後顯示就地升級
      buildMenuTarget: null,      // R64：直接點空格後顯示就地建塔輪盤（不持久化）
      pendingSkill: null,         // 準備施放的技能
      skillCooldowns: {},         // 技能冷卻計時
      speed: 1,                    // 遊戲速度倍率
      towerSeq: 0,
      enemySeq: 0,
      advisorMode: "control",
      advisorBuildConfirm: false,
      advisorUpgradeTarget: null,
    };
    state.introLogs = openingLoreLines(mapDef, affix);
    state.banner = { text: mapDef.label, color: "#fde047", life: 2.0 };
    Object.keys(SKILLS).forEach((k) => (state.skillCooldowns[k] = 0));
    state.map = buildMapLayout(); // 亂數地圖佈局
    emitIntroLogs();
    notifyUI(true);
    const battlefield = document.getElementById("battlefieldScroll");
    if (battlefield) {
      // 手機放大戰場留少量左右點擊緩衝，避免首個半屏邊界格落在裁切線外。
      battlefield.scrollLeft = battlefield.scrollWidth > battlefield.clientWidth + 2 ? 8 : 0;
      battlefield.scrollTop = 0;
    }
  }

  // 亂數地圖佈局：每格隨機草地變化 + 隨機裝飾物（避開路徑）
  function buildMapLayout() {
    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
    const grass = [];   // 每格用哪種草地圖 index（0~2）
    for (let cy = 0; cy < rows; cy++) {
      const row = [];
      for (let cx = 0; cx < cols; cx++) row.push(1 + Math.floor(Math.random() * 3)); // grass1~3
      grass.push(row);
    }
    // 裝飾物：在非路徑格隨機撒
    const decor = [];
    const kinds = ["rock", "bush", "tree"];
    for (let i = 0; i < 18; i++) {
      const cx = Math.floor(Math.random() * cols), cy = Math.floor(Math.random() * rows);
      if (blocked.has(cellKey(cx, cy))) continue; // 不放路徑上
      decor.push({ kind: kinds[Math.floor(Math.random() * kinds.length)],
        x: cx * CELL + CELL / 2 + (Math.random() * 16 - 8),
        y: cy * CELL + CELL / 2 + (Math.random() * 16 - 8),
        size: CELL * (0.5 + Math.random() * 0.4) });
    }
    return { cols, rows, grass, decor };
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
    return TDRules.generateWaveQueue(wave, getDifficulty(), waveSeedFor(wave), state.affix);
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
    const advisorInput = { queue: plan.queue, towers: state.towers, gold: state.gold, path: state.path, affix: state.affix, width: W, height: H, advisorMode };
    const advisor = TDRules.adviseTowerActions ? TDRules.adviseTowerActions(advisorInput) : [];
    const counterWarning = TDRules.counterWarningForWave ? TDRules.counterWarningForWave(advisorInput) : null;
    return { wave: w, seed, count: plan.count, totalCount: plan.totalCount, isBoss: plan.isBoss, theme: plan.theme, event: plan.event, affix: plan.affix, queue: plan.queue.map((item) => Object.assign({}, item)), enemyTypes, recommendations, advisor, counterWarning, advisorMode };
  }

  // ===== 波次系統（無盡隨機遞增）=====
  function startWave() {
    if (state.over) return;
    if (state.wave === 0 && state.towers.length === 0) {
      flashText(W / 2, H * 0.28, "先建一座塔！", { color: "#fde047", size: 22, big: true });
      log("先建一座塔再開始第 1 波。", "bad");
      return false;
    }
    state.wave++;
    state.betweenWaves = false;
    state.waveLeaks = 0;
    const w = state.wave;
    const plan = wavePlanFor(w);
    const isBoss = plan.isBoss;
    const ev = plan.event;
    state.currentEvent = ev;
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
    const value = heroStat(hero, key);
    if (key !== "hp" && key !== "atk") return value;
    const bonus = hero && typeof hero.longBonus === "number" ? hero.longBonus : 0;
    return Math.round(value * (1 + bonus));
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
    let dmg = Math.max(0, amount || 0);
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
    return hpDealt + shieldDealt;
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
      const dealt = applyDamage(e, dps * dt, { bypassShield: true, noHitFlash: true });
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
  // loopToken 確保同時只有一個迴圈在跑：每次 startLoop 換新 token，
  // 舊迴圈發現 token 變了就自行結束（避免 newGame/startWave 造成多重迴圈疊加，
  // 那會讓 update 每幀被呼叫多次、單位移動量爆增）。lastT/loopToken 已在上方宣告。
  function startLoop() {
    if (state.running) return; // 已在跑
    state.running = true;
    const myToken = ++loopToken;
    lastT = 0; // 重置時間基準，避免第一幀 dt 異常
    function loop(t) {
      if (myToken !== loopToken || !state.running || state.over) return; // 不是當前迴圈或已結束
      updatePerformanceMonitor(t);
      if (!t) t = 0;
      if (!lastT) lastT = t; // 第一幀對齊
      let dt = (t - lastT) / 1000;
      lastT = t;
      if (dt > 0.05) dt = 0.05; // 防止分頁切換造成大跳
      if (!state.paused) { dt *= state.speed; update(dt); } // 暫停時不更新邏輯
      render();
      if (state.paused) drawPauseOverlay();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  // D10 暫停切換
  function togglePause() { state.paused = !state.paused; return state.paused; }
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
      if (state.spawnTimer <= 0) {
        spawnEnemy(state.spawnQueue.shift());
        state.spawnTimer = GAME.spawnInterval;
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
          applyDamage(t, GODDESS.smiteDamage);
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
      const target = state.path[e.wp];
      if (!target) { leak(e); continue; }
      const dx = target.x - e.x, dy = target.y - e.y;
      const dist = Math.hypot(dx, dy);
      const step = spd * dt;
      if (dist > 0.001) {
        e.vx = dx / dist;
        e.vy = dy / dist;
        if (Math.abs(e.vx) > 0.08) e.flipX = e.vx < 0;
      }
      if (step > 0) e.walkDist += Math.min(step, dist);
      if (step >= dist) { e.x = target.x; e.y = target.y; e.wp++; if (e.wp >= state.path.length) leak(e); }
      else { e.x += e.vx * step; e.y += e.vy * step; }
    }
    state.enemies = state.enemies.filter((e) => {
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
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      const target = acquireTarget(tw);
      if (target) { fire(tw, target); tw.cd = 1 / towerStat(tw, "fireRate"); }
    }

    // 英雄：自主尋敵、移動、攻擊
    for (const h of state.heroes) updateHero(h, dt);

    // 子彈移動
    for (const b of state.bullets) {
      if (b.target && !b.target._dead) {
        const dx = b.target.x - b.x, dy = b.target.y - b.y;
        const d = Math.hypot(dx, dy);
        const step = b.speed * dt;
        if (step >= d) { hit(b); b._done = true; }
        else { b.x += (dx / d) * step; b.y += (dy / d) * step; }
      } else { b._done = true; }
    }
    state.bullets = state.bullets.filter((b) => !b._done);

    // 粒子（擴張環不移動；爆裂粒子受重力；文字往上飄不受重力）
    for (const p of state.particles) {
      p.life -= fxDt;
      if (p.toX != null && p.toY != null) {
        const k = Math.min(1, fxDt * (p.flySpeed || 4.5));
        p.x += (p.toX - p.x) * k;
        p.y += (p.toY - p.y) * k;
      } else if (!p.ring && !p.beam) {
        p.x += p.vx * fxDt;
        p.y += p.vy * fxDt;
        if (p.texture) p.rotation = (p.rotation || 0) + (p.spin || 0) * fxDt;
        if (!p.text && !p.muzzle && !p.texture) p.vy += 220 * fxDt;
      }
    }
    state.particles = state.particles.filter((p) => p.life > 0);

    state.clock += dt;

    // 波次結束判定
    if (!state.betweenWaves && state.spawnQueue.length === 0 && state.enemies.length === 0) {
      state.betweenWaves = true;
      state.clearedWave = Math.max(state.clearedWave || 0, state.wave);
      const bonus = Math.round(waveGoldBonus(state.wave) * ((state.mapDef && state.mapDef.goldMul) || 1) * affixMul("waveGoldMul")); // 指數成長獎勵（D2）
      state.gold += bonus;
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
          });
        }
      } else {
        log(`第 ${state.wave} 波清空！+${bonus} 金`);
      }
      celebrateWaveClear(state.wave, bonus, clean);
      notifyUI();
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
    const dmg = Math.round(e.leak * (e.boss ? 4 : 3) * affixMul("leakDamageMul")); // 漏過對女神造成的傷害
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
    state.heroes.push(h);
    log(`${def.name} 上場！`);
    notifyUI();
    return true;
  }

  function selectHeroGuard(uid) {
    const h = state.heroes.find((hero) => hero.uid === uid);
    if (!h) return false;
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
      if (e._dead) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      // 駐守模式：只打駐守點半徑內的敵人（不追遠的）
      if (h.guardPoint) {
        const dh = Math.hypot(e.x - homeX, e.y - homeY);
        if (dh > HERO_GUARD_RADIUS + def.range) continue;
      }
      if (d < best) { best = d; target = e; }
    }
    if (!target) {
      moveToward(h, homeX, homeY, def.speed, dt); // 無目標：回家/駐守點
      return;
    }
    const range = def.range;
    if (best > range) {
      moveToward(h, target.x, target.y, def.speed, dt); // 追敵
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
    if (d < 2) return;
    faceToward(h, tx, ty); // 先定朝向，再移動
    const step = Math.min(d, speed * dt);
    h.x += (dx / d) * step; h.y += (dy / d) * step;
    h.walkDist = (h.walkDist || 0) + step;
    h.moving = step > 0;
  }

  // 攻擊輸入只進入前搖；此函式不得造成傷害或建立子彈。
  function heroAttack(h, target) {
    const def = HEROES[h.id];
    if (!target || target._dead || (h.attackPhase && h.attackPhase !== HERO_ATTACK_PHASE.IDLE)) return false;
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
    if (!target || target._dead) return false;
    const activeRange = def.range + (def.role === "ranged" ? 12 : 18);
    if (Math.hypot(target.x - h.x, target.y - h.y) > activeRange) return false; // 揮空：impact 無命中
    const atk = heroBattleStat(h, "atk");
    h.attackConnected = true;
    if (def.role === "ranged") {
      // 遠程 active hitbox 只在 impact 幀建立；實際傷害仍由子彈碰撞結算。
      state.bullets.push({
        x: h.x, y: h.y, target, speed: 360, color: def.color,
        damage: atk, element: def.element, splash: def.splash || 0, slow: def.slow || 0,
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
    if (e._dead) return;
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
    const reward = Math.round(e.reward * comboMul);
    state.gold += reward;
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
    if (state.combo >= 3) flashText(e.x, e.y - 12, `COMBO x${state.combo}`, { color: "#fde047", size: 14 + Math.min(state.combo, 10), big: true });
    notifyUI();
  }

  // ===== 塔瞄準與射擊 =====
  function towerStat(tw, key) {
    const base = TOWERS[tw.type][key];
    if (key === "damage") return (base || 0) * Math.pow(UPGRADE.damageMul, tw.level - 1) * affixMul("towerDamageMul") * eventMul("towerDamageMul");
    if (key === "poisonDps") return (base || 0) * Math.pow(UPGRADE.poisonDpsMul || UPGRADE.damageMul, tw.level - 1) * affixMul("towerDamageMul") * eventMul("towerDamageMul");
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
    if (def.splash) dps *= 2.2;
    if (def.pierce) dps *= (1 + (def.pierce - 1) * 0.6);
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
    const range = towerStat(tw, "range");
    const minRange = towerStat(tw, "minRange") || 0;
    let best = null, bestScore = -Infinity;
    for (const e of state.enemies) {
      if (e._dead) continue;
      const d = Math.hypot(e.x - tw.x, e.y - tw.y);
      if (d <= range && d >= minRange) {
        const target = state.path[e.wp];
        const prev = state.path[Math.max(0, e.wp - 1)];
        const segLen = target && prev ? Math.max(1, Math.hypot(target.x - prev.x, target.y - prev.y)) : 1;
        const distToWaypoint = target ? Math.hypot(target.x - e.x, target.y - e.y) : 0;
        const prog = e.wp - Math.min(1, distToWaypoint / segLen); // 越前面越優先
        let score = prog;
        if (def && def.targetPriority === "midpath") {
          const ratio = Math.max(0, Math.min(1, (e.walkDist || 0) / (state.pathTotalLength || 1)));
          score = 100 - Math.abs(ratio - 0.55) * 100 + prog * 0.001;
        }
        if (score > bestScore) { bestScore = score; best = e; }
      }
    }
    return best;
  }
  // 塔/元素對應的投射物圖
  const PROJECTILE_BY_TOWER = { arrow: "arrow", cannon: "cannonball", frost: "iceshard", tesla: "lightning", poison: "arrow", sniper: "arrow", arcane: "lightning", mortar: "fireball" };
  const PROJECTILE_BY_ELEMENT = { physical: "arrow", fire: "fireball", ice: "iceshard", thunder: "lightning" };

  function fire(tw, target) {
    const def = TOWERS[tw.type];
    const poisonDps = towerStat(tw, "poisonDps");
    muzzleFlash(tw, target);
    playSfx("fire");
    state.bullets.push({
      x: tw.x, y: tw.y, target, speed: def.id === "mortar" ? 250 : 320, color: def.color,
      damage: effectiveTowerDamage(tw), element: def.element,
      splash: def.splash || 0, slow: def.slow || 0, pierce: def.pierce || 0, type: tw.type,
      poison: poisonDps ? { dps: poisonDps, duration: def.poisonDuration, maxStacks: def.poisonMaxStacks } : null,
      vuln: def.vuln || null,
      projectile: PROJECTILE_BY_TOWER[tw.type] || PROJECTILE_BY_ELEMENT[def.element],
    });
  }
  function hit(b) {
    if (b.splash) {
      // 範圍傷害
      for (const e of state.enemies) {
        if (e._dead) continue;
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
        .filter((e) => !e._dead && Math.hypot(e.x - b.target.x, e.y - b.target.y) < 60)
        .sort((a, c) => Math.hypot(a.x - b.target.x, a.y - b.target.y) - Math.hypot(c.x - b.target.x, c.y - b.target.y));
      const hits = near.includes(b.target) ? near : [b.target, ...near];
      hits.slice(0, b.pierce).forEach((e) => dealDamage(e, b));
    } else {
      dealDamage(b.target, b);
      burst(b.target.x, b.target.y, b.color, 5); // 命中爆裂小特效
    }
  }
  function dealDamage(e, b) {
    if (e._dead) return;
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
    if (b.slow) { e.slowUntil = state.clock + 1.5; e.slowFactor = 1 - b.slow; }
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
    if (!sk || state.skillCooldowns[skillId] > 0) return false;
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
    state.skillCooldowns[skillId] = sk.cooldown;
    state.skillCasts = (state.skillCasts || 0) + 1;
    let appliedHits = 0;
    for (const e of targets) {
      const mult = elementMultiplier(sk.element, e.element);
      const dealt = applyDamage(e, sk.damage * mult, { source: "skill", element: sk.element });
      if (e._reflectedLastHit) continue;
      if (sk.freezeDur) e.frozenUntil = state.clock + sk.freezeDur;
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
    let reason = "";
    if (!def) reason = "尚未選塔";
    else if (px < 0 || py < 0 || px >= W || py >= H) reason = "超出戰場";
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
      pathDistance: Number.isFinite(pathDistance) ? Math.round(pathDistance) : null,
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
      level: 1, cd: 0, order: state.towerSeq++,
    });
    state.towersBuilt = (state.towersBuilt || 0) + 1;
    state.buildGhost = null;
    state.buildMenuTarget = null;
    state.mouse = null;
    playSfx("build");
    log(`建造 ${def.name}！`);
    notifyUI();
    return true;
  }
  function upgradeTower(tw) {
    if (tw.level >= UPGRADE.maxLevel) { log("已達最高等級！", "bad"); return; }
    const cost = Math.round(TOWERS[tw.type].cost * Math.pow(UPGRADE.costMul, tw.level));
    if (state.gold < cost) { log("金錢不足以升級！", "bad"); return; }
    state.gold -= cost;
    tw.level++;
    state.towerUpgrades = (state.towerUpgrades || 0) + 1;
    upgradeBeam(tw.x, tw.y, (TOWERS[tw.type] && TOWERS[tw.type].color) || "#fde047");
    log(`${TOWERS[tw.type].name} 升到 ${tw.level} 級！`);
    notifyUI();
  }
  function upgradeCost(tw) { return Math.round(TOWERS[tw.type].cost * Math.pow(UPGRADE.costMul, tw.level)); }
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
      const textCount = state.particles.filter((x) => x.text).length;
      if (textCount >= MAX_TEXT_PARTICLES && !(p.criticalFx && evictParticle((x) => x.text, priority))) return false;
      if (p.toX != null) {
        const coinCount = state.particles.filter((x) => x.toX != null).length;
        if (coinCount >= MAX_COIN_PARTICLES && !(p.criticalFx && evictParticle((x) => x.toX != null, priority))) return false;
      }
    }
    if (p.ring) {
      const ringCount = state.particles.filter((x) => x.ring).length;
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
    if (performanceLow() && state.particles.length > 24) return;
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
    state.over = true; state.running = false;
    log(`💀 遊戲結束！撐到第 ${state.wave} 波，得分 ${state.score}`, "bad");
    if (typeof window.__tdGameOver === "function") {
      window.__tdGameOver(state.wave, state.score, {
        kills: state.kills,
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
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawPath();
    drawMapAtmosphere();
    if (state.selectedTowerType) drawBuildPreview();
    drawGoddess();
    const towerProfile = towerRenderProfile();
    for (let i = 0; i < state.towers.length; i++) drawTower(state.towers[i], i, state.towers.length, towerProfile);
    for (const h of state.heroes) drawHero(h);
    for (const e of state.enemies) drawEnemy(e);
    for (const b of state.bullets) drawBullet(b);
    for (const p of state.particles) drawParticle(p);
    if (state.selectedTower) drawTowerRange(state.selectedTower);
    drawAdvisorHighlight();
    drawGuardPoints();
    drawComboHud();
    drawStreakHud();
    drawBanner();
    drawRedVignette();
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
    ctx.drawImage(atlas, column * cell, row * cell, cell, cell, h.x - size / 2, h.y - size / 2, size, size);
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
    // 女神本體
    drawSprite("assets/core/goddess.png", GODDESS.emoji, gd.x, gd.y, CELL * 1.3);
    // 生命條
    const w = CELL * 1.4, pct = Math.max(0, gd.hp / gd.maxHp);
    ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(gd.x - w / 2, gd.y - CELL * 0.95, w, 6);
    ctx.fillStyle = pct > 0.5 ? "#4ade80" : pct > 0.25 ? "#facc15" : "#ef4444";
    ctx.fillRect(gd.x - w / 2, gd.y - CELL * 0.95, w * pct, 6);
    // 等級
    ctx.fillStyle = "#fde047"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Lv." + gd.level, gd.x, gd.y + CELL * 0.85);
  }

  function bakeBackground() {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const bg = c.getContext("2d");
    usePixelArt(bg);
    let ready = true;
    const visual = MAP_VISUALS[state.mapId] || MAP_VISUALS.plains;
    bg.fillStyle = visual.ground; bg.fillRect(0, 0, W, H);
    const map = state.map;
    // 用草地磚塊亂數鋪滿（圖未載入時退回純色格）
    if (map) {
      for (let cy = 0; cy < map.rows; cy++) {
        for (let cx = 0; cx < map.cols; cx++) {
          const im = getImg(`assets/tiles/grass${map.grass[cy][cx]}.png`, true);
          if (im && im.complete && im.naturalWidth > 0) {
            bg.drawImage(im, cx * CELL, cy * CELL, CELL, CELL);
          } else {
            ready = false;
            bg.fillStyle = (cx + cy) % 2 ? "#13241a" : "#15281d";
            bg.fillRect(cx * CELL, cy * CELL, CELL, CELL);
          }
        }
      }
    }
    // V3 場景深度：暗角 vignette（中心透明 → 邊緣壓暗）
    const vig = bg.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,.4)");
    bg.fillStyle = vig; bg.fillRect(0, 0, W, H);
    return { canvas: c, ready };
  }
  function drawBackground() {
    if (!state.backgroundCache || !state.backgroundCache.ready) {
      const baked = bakeBackground();
      if (baked.ready) state.backgroundCache = baked;
      ctx.drawImage(baked.canvas, 0, 0);
      return;
    }
    ctx.drawImage(state.backgroundCache.canvas, 0, 0);
  }
  function drawMapAtmosphere() {
    const visual = MAP_VISUALS[state.mapId] || MAP_VISUALS.plains;
    ctx.save();
    ctx.fillStyle = visual.tint;
    ctx.fillRect(0, 0, W, H);
    if (!state.over && !reducedEffectsEnabled() && !performanceLow()) {
      const now = (window.performance && performance.now ? performance.now() : Date.now()) / 1000;
      // 波間呼吸仍是主光；戰鬥只留極弱 ambient，讓宣傳混戰畫面保有地圖氣氛。
      const strength = state.betweenWaves
        ? 0.48 + (Math.sin(now * 1.25) + 1) * 0.16
        : 0.20 + (Math.sin(now * 0.8) + 1) * 0.025;
      const glow = ctx.createRadialGradient(W * 0.52, H * 0.48, H * 0.08, W * 0.52, H * 0.48, H * 0.72);
      glow.addColorStop(0, visual.breath.replace(/\.[0-9]+\)$/, `${(0.16 * strength).toFixed(3)})`));
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }
  function buildPathDetailCache() {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const px = c.getContext("2d");
    const visual = MAP_VISUALS[state.mapId] || MAP_VISUALS.plains;
    const path = state.path || getMap().path;
    for (let s = 0; s < path.length - 1; s++) {
      const a = path[s], b = path[s + 1];
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.max(1, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      for (let d = 22; d < len; d += visual.detail === "slabs" ? 48 : 40) {
        const x = a.x + dx * (d / len), y = a.y + dy * (d / len);
        px.save(); px.translate(x, y); px.rotate(angle);
        if (visual.detail === "footprints") {
          px.fillStyle = "rgba(31,41,32,.32)";
          px.beginPath(); px.ellipse(-6, -7, 4.5, 8, -.18, 0, Math.PI * 2); px.fill();
          px.beginPath(); px.ellipse(8, 7, 4.5, 8, .18, 0, Math.PI * 2); px.fill();
        } else if (visual.detail === "slabs") {
          px.strokeStyle = "rgba(45,31,22,.36)"; px.lineWidth = 3;
          px.beginPath(); px.moveTo(0, -CELL * .34); px.lineTo(0, CELL * .34); px.stroke();
          px.strokeStyle = "rgba(255,237,213,.07)"; px.lineWidth = 1;
          px.strokeRect(-19, -CELL * .31, 38, CELL * .62);
        } else {
          px.strokeStyle = "rgba(46,16,24,.42)"; px.lineWidth = 3;
          px.beginPath(); px.moveTo(-13, -12); px.lineTo(-3, -3); px.lineTo(-9, 9); px.lineTo(13, 15); px.stroke();
          px.strokeStyle = "rgba(251,113,133,.09)"; px.lineWidth = 1; px.stroke();
        }
        px.restore();
      }
    }
    return c;
  }
  function drawPathDetails() {
    if (!state.pathDetailCache) state.pathDetailCache = buildPathDetailCache();
    ctx.drawImage(state.pathDetailCache, 0, 0);
  }
  function r72PathTile(pathImg) {
    if (state.pathTileVisualCache) return state.pathTileVisualCache;
    const c = document.createElement("canvas");
    c.width = CELL; c.height = CELL;
    const px = c.getContext("2d");
    const visual = MAP_VISUALS[state.mapId] || MAP_VISUALS.plains;
    px.drawImage(pathImg, 0, 0, CELL, CELL);
    px.fillStyle = visual.pathWash;
    px.fillRect(0, 0, CELL, CELL);
    state.pathTileVisualCache = c;
    return c;
  }
  function drawPath() {
    // 路徑：先畫底色路（保證可見），再用路徑磚平鋪沿線蓋上
    ctx.strokeStyle = "#3b2f1f"; ctx.lineWidth = CELL * 0.9; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const path = state.path || getMap().path;
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    // 路徑磚塊圖蓋在路徑格上
    const pathImg = getImg("assets/tiles/path.png", true);
    if (pathImg && pathImg.complete && pathImg.naturalWidth > 0 && state.map) {
      // R72：同一張原始 path PNG 一次性著色後沿用；不增加每幀 draw call 或改 blocked cells。
      const readablePathTile = r72PathTile(pathImg);
      for (const key of blocked) {
        const [cx, cy] = key.split(",").map(Number);
        if (cx < 0 || cy < 0) continue;
        ctx.drawImage(readablePathTile, cx * CELL, cy * CELL, CELL, CELL);
      }
    }
    // R72 玩法可讀性由 map-specific path tile wash 提供；原始素材與碰撞資料維持不變。
    drawPathDetails();
    // 裝飾物（在非路徑格）
    if (state.map) {
      for (const d of state.map.decor) {
        drawSprite(`assets/tiles/${d.kind}.png`, "", d.x, d.y, d.size);
      }
    }
    // 終點由守護女神鎮守（drawGoddess 繪製）
  }
  function drawBuildableCells(def) {
    if (!def) return;
    const cols = state.map ? state.map.cols : Math.ceil(W / CELL);
    const rows = state.map ? state.map.rows : Math.ceil(H / CELL);
    const occupied = new Set(state.towers.map((t) => cellKey(t.cx, t.cy)));
    const range = def.range * affixMul("towerRangeMul");
    ctx.save();
    ctx.lineWidth = 1;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const key = cellKey(cx, cy);
        if (blocked.has(key) || occupied.has(key)) continue;
        if (canCellReachPath(cx, cy, range)) {
          ctx.fillStyle = "rgba(74,222,128,.10)";
          ctx.strokeStyle = "rgba(74,222,128,.22)";
        } else {
          ctx.fillStyle = "rgba(15,23,42,.28)";
          ctx.strokeStyle = "rgba(148,163,184,.10)";
        }
        ctx.fillRect(cx * CELL + 1, cy * CELL + 1, CELL - 2, CELL - 2);
        if (!performanceLow()) ctx.strokeRect(cx * CELL + 4, cy * CELL + 4, CELL - 8, CELL - 8);
      }
    }
    ctx.restore();
  }
  function drawBuildPreview() {
    const def = TOWERS[state.selectedTowerType];
    if (!def) return;
    drawBuildableCells(def);
    const m = state.buildGhost || state.mouse; if (!m) return;
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
    if (!preview.ok && preview.reason) {
      const labelX = Math.max(78, Math.min(W - 78, preview.x));
      const labelY = Math.max(18, Math.min(H - 18, preview.y - CELL * 0.62));
      ctx.font = '900 13px "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.lineWidth = 3; ctx.strokeText(preview.reason, labelX, labelY);
      ctx.fillStyle = "#fecaca"; ctx.fillText(preview.reason, labelX, labelY);
    }
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
      im.onload = () => { imgCache[path] = noBg ? im : removeBg(im); };
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
  function drawSprite(path, emoji, x, y, size, color) {
    const im = getImg(path);
    if (im && im.complete && im.naturalWidth > 0) { usePixelArt(ctx); ctx.drawImage(im, x - size / 2, y - size / 2, size, size); }
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
    drawSprite(towerSpritePath(def, lv), "", tw.x, tw.y, spriteSize);

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
      ctx.drawImage(atlas, column * cell, animation.row * cell, cell, cell, -size / 2, -size / 2, size, size);
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
      ctx.filter = "brightness(0) saturate(100%) invert(1)";
      drawEnemyAtlasFrame(atlas, animation, frameColumn, e, size);
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
      ctx.shadowColor = b.color; ctx.shadowBlur = performanceLow() ? 0 : 6;
      ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    } else {
      ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = performanceLow() ? 0 : 8;
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
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
  function canvasPos(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
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
    if (state.advisorBuildConfirm) {
      const preview = buildPreviewAt(p.x, p.y);
      const ghost = state.buildGhost;
      const same = preview.ok && ghost && preview.cx === ghost.cx && preview.cy === ghost.cy;
      if (same) {
        const built = tryBuildTower(preview.x, preview.y);
        state.advisorBuildConfirm = false;
        state.selectedTowerType = null;
        state.buildGhost = null;
        canvas.style.cursor = "default";
        notifyUI();
        return built;
      }
      state.advisorBuildConfirm = false;
      state.selectedTowerType = null;
      state.buildGhost = null;
      canvas.style.cursor = "default";
      log("已取消顧問建造預覽。");
      notifyUI();
      return false;
    }
    if (!isTouch) { tryBuildTower(p.x, p.y); return; }
    const preview = buildPreviewAt(p.x, p.y);
    if (!preview.ok) {
      state.buildGhost = { x: p.x, y: p.y, cx: preview.cx, cy: preview.cy };
      flashText(preview.x, preview.y - 18, preview.reason, { color: "#f87171", size: 14, big: true });
      log(preview.reason + "！", "bad");
      return;
    }
    const same = state.buildGhost && state.buildGhost.cx === preview.cx && state.buildGhost.cy === preview.cy;
    state.buildGhost = { x: p.x, y: p.y, cx: preview.cx, cy: preview.cy };
    if (!same) {
      flashText(preview.x, preview.y - 18, "再點一次確認", { color: "#fde047", size: 13, big: true });
      return;
    }
    tryBuildTower(p.x, p.y);
  }

  function handleTap(p, isTouch) {
    if (state.pendingSkill) {
      const casted = castSkill(state.pendingSkill, p.x, p.y);
      if (casted) {
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
        h.guardPoint = onSelf ? null : { x: p.x, y: p.y };
        log(onSelf ? `${HEROES[h.id].name} 解除駐守，自由作戰。` : `${HEROES[h.id].name} 駐守此地！`);
      }
      state.pendingHero = null; canvas.style.cursor = "default";
      state.buildMenuTarget = null;
      state.selectedGoddess = false;
      notifyUI();
      return;
    }
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
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    const tw = state.towers.find((t) => t.cx === cx && t.cy === cy);
    const onGoddess = Math.hypot(p.x - state.goddess.x, p.y - state.goddess.y) <= CELL * 0.85;
    if (onGoddess) {
      state.selectedTower = null;
      state.selectedGoddess = true;
      state.buildMenuTarget = null;
      notifyUI();
      return;
    }
    if (tw) {
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
  canvas.addEventListener("click", (ev) => { handleTap(canvasPos(ev.clientX, ev.clientY), false); });
  // 觸控支援：tap 建塔/選塔/放技能
  let touchGesture = null;
  canvas.addEventListener("touchstart", (ev) => {
    if (ev.touches.length) {
      const t = ev.touches[0];
      touchGesture = { x: t.clientX, y: t.clientY, moved: false };
      state.mouse = canvasPos(t.clientX, t.clientY);
    }
  }, { passive: true });
  canvas.addEventListener("touchmove", (ev) => {
    if (!touchGesture || !ev.touches.length) return;
    const t = ev.touches[0];
    if (Math.hypot(t.clientX - touchGesture.x, t.clientY - touchGesture.y) > 10) touchGesture.moved = true;
  }, { passive: true });
  canvas.addEventListener("touchend", (ev) => {
    ev.preventDefault(); // 避免觸發後續的合成 click（重複觸發）
    const t = ev.changedTouches[0];
    const moved = touchGesture && touchGesture.moved;
    touchGesture = null;
    if (t && !moved) handleTap(canvasPos(t.clientX, t.clientY), true);
  }, { passive: false });
  canvas.addEventListener("touchcancel", () => { touchGesture = null; }, { passive: true });

  function previewAdvisorAction(action) {
    if (!action || state.over) return false;
    if (action.kind === "build" && TOWERS[action.towerId]) {
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
      state.buildGhost = { x: preview.x, y: preview.y, cx: preview.cx, cy: preview.cy, advisor: true };
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

  // 閒置渲染迴圈：主迴圈只在波次進行中跑（startLoop/state.running），
  // 第一波開始前的建塔準備階段與 gameOver 後畫面完全不會重繪——
  // 放了塔看不到、滑鼠 hover 的建塔預覽也不會動。這個迴圈只在主迴圈沒跑時輕量補渲染。
  (function idleLoop(t) {
    if (!state.running) {
      updatePerformanceMonitor(t);
      render();
    }
    requestAnimationFrame(idleLoop);
  })();

  // ===== 對外接口（給 UI 與測試）=====
  window.TD = {
    state: () => state,
    newGame: (options) => { newGame(options); state.clock = 0; render(); },
    startWave,
    selectTower: (type) => { state.selectedTowerType = type; state.selectedTower = null; state.selectedGoddess = false; state.buildMenuTarget = null; state.pendingSkill = null; state.buildGhost = null; state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null; },
    cancelBuild: () => { state.selectedTowerType = null; state.buildGhost = null; state.advisorBuildConfirm = false; },
    selectSkill: (id) => { if (state.skillCooldowns[id] <= 0) { state.pendingSkill = id; state.selectedTower = null; state.selectedGoddess = false; state.buildMenuTarget = null; state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null; canvas.style.cursor = "crosshair"; playSfx("ui"); } },
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
    getPerformanceStatus,
    setReducedEffects,
    setAudioMuted,
    setAudioVolume,
    getJuiceSettings,
    playSfx,
    togglePause,                   // 暫停（D10）
    setPaused: (v) => { state.paused = !!v; }, // 強制暫停/恢復（抽卡動畫用，不能用 toggle）
    cancelSelect: () => { state.selectedTowerType = null; state.selectedTower = null; state.selectedGoddess = false; state.buildMenuTarget = null; state.pendingSkill = null; state.buildGhost = null; state.advisorBuildConfirm = false; state.advisorUpgradeTarget = null; canvas.style.cursor = "default"; notifyUI(); },
    setSpeed: (s) => { state.speed = s; },
    buildPreviewAt: (x, y) => buildPreviewAt(x, y),
    drainIntroLogs: () => {
      const items = state && Array.isArray(state.introLogs) ? state.introLogs.splice(0) : [];
      return items;
    },
    debug: {
      spawnEnemy: (type, overrides) => {
        const e = createEnemy({ type, hpScale: 1 }, overrides);
        state.enemies.push(e);
        return e;
      },
      step: (dt) => { update(dt || 0.016); render(); },
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
