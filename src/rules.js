/* =========================================================================
 * rules.js — 可測試的遊戲規則純函式
 *
 * 這裡只放不碰 DOM、Storage、時間與真隨機的規則。瀏覽器端掛到 window，
 * Node 端用 module.exports，讓 CI 可以直接驗證波次與 meta 遷移。
 * ========================================================================= */
(function (root, factory) {
  const exported = factory(root);
  if (typeof window !== "undefined") Object.assign(window, exported, { TDRules: exported });
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const cfg = (typeof module !== "undefined" && module.exports)
    ? require("./config.js")
    : root;

  const META_VERSION = 5;
  const META_NUMERIC_KEYS = ["bestWave", "totalKills", "soulCrystal", "games", "gachaPity", "gachaCount"];
  const META_DEFAULT = {
    version: META_VERSION,
    bestWave: 0,
    totalKills: 0,
    soulCrystal: 0,
    games: 0,
    gachaPity: 0,
    gachaCount: 0,
    bestByDiff: {},
    board: {},
    achievements: {},
    beginnerMissions: {},
    lastMap: "plains",
  };
  const SOUL_REWARD_MUL_BY_DIFF = { normal: 1.8, brutal: 2.4, endless: 2.2 };

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function safeNumber(value, fallback) {
    return isFiniteNumber(value) ? value : fallback;
  }

  function hasOwn(obj, key) {
    return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  }

  function sanitizeMapId(mapId) {
    return typeof mapId === "string" && hasOwn(cfg.MAPS, mapId) ? mapId : META_DEFAULT.lastMap;
  }

  function sanitizeDiffId(diffId) {
    return typeof diffId === "string" && hasOwn(cfg.DIFFICULTIES, diffId) ? diffId : "normal";
  }

  function sanitizeBestByDiff(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [key, val] of Object.entries(value)) {
      if (isFiniteNumber(val)) result[key] = val;
    }
    return result;
  }

  function sanitizeBoardEntry(entry, fallbackMap) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (!isFiniteNumber(entry.wave) || !isFiniteNumber(entry.score) || !isFiniteNumber(entry.kills) || !isFiniteNumber(entry.at)) return null;
    return {
      wave: Math.max(0, Math.floor(entry.wave)),
      score: Math.max(0, Math.floor(entry.score)),
      kills: Math.max(0, Math.floor(entry.kills)),
      at: entry.at,
      map: sanitizeMapId(typeof entry.map === "string" ? entry.map : fallbackMap),
    };
  }

  function compareBoardEntry(a, b) {
    if (b.wave !== a.wave) return b.wave - a.wave;
    if (b.score !== a.score) return b.score - a.score;
    return b.at - a.at;
  }

  function sanitizeBoard(board, maxEntries) {
    const limit = Math.max(1, Math.floor(safeNumber(maxEntries, 10)));
    const result = {};
    if (!board || typeof board !== "object" || Array.isArray(board)) return result;
    const addEntries = (diffId, entries, fallbackMap) => {
      if (!Array.isArray(entries)) return;
      for (const entry of entries) {
        const clean = sanitizeBoardEntry(entry, fallbackMap);
        if (!clean) continue;
        const mapId = sanitizeMapId(clean.map);
        if (!result[diffId]) result[diffId] = {};
        if (!result[diffId][mapId]) result[diffId][mapId] = [];
        result[diffId][mapId].push(clean);
      }
    };

    for (const [rawDiffId, value] of Object.entries(board)) {
      if (!hasOwn(cfg.DIFFICULTIES, rawDiffId)) continue;
      const diffId = rawDiffId;
      if (Array.isArray(value)) {
        addEntries(diffId, value, META_DEFAULT.lastMap);
      } else if (value && typeof value === "object") {
        for (const [rawMapId, entries] of Object.entries(value)) {
          if (!hasOwn(cfg.MAPS, rawMapId)) continue;
          addEntries(diffId, entries, rawMapId);
        }
      }
    }
    for (const maps of Object.values(result)) {
      for (const [mapId, entries] of Object.entries(maps)) {
        const clean = entries.sort(compareBoardEntry).slice(0, limit);
        if (clean.length) maps[mapId] = clean;
        else delete maps[mapId];
      }
    }
    return result;
  }

  function sanitizeAchievements(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [key, unlocked] of Object.entries(value)) {
      if (unlocked === true) result[key] = true;
    }
    return result;
  }

  function sanitizeBeginnerMissions(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [key, claimed] of Object.entries(value)) {
      if (claimed === true) result[key] = true;
    }
    return result;
  }

  function migrateMeta(raw) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    const meta = Object.assign({}, META_DEFAULT, source);
    for (const key of META_NUMERIC_KEYS) {
      if (!isFiniteNumber(meta[key])) meta[key] = META_DEFAULT[key];
    }
    meta.version = META_VERSION;
    meta.bestByDiff = sanitizeBestByDiff(meta.bestByDiff);
    meta.board = sanitizeBoard(meta.board);
    meta.achievements = sanitizeAchievements(meta.achievements);
    meta.beginnerMissions = sanitizeBeginnerMissions(meta.beginnerMissions);
    meta.lastMap = sanitizeMapId(meta.lastMap);
    return meta;
  }

  function normalizeDifficulty(difficulty) {
    if (typeof difficulty === "string" && hasOwn(cfg.DIFFICULTIES, difficulty)) return cfg.DIFFICULTIES[difficulty];
    if (difficulty && typeof difficulty === "object") return difficulty;
    return (cfg.DIFFICULTIES && cfg.DIFFICULTIES.normal) || { id: "normal", hpMul: 1, goldMul: 1, goddessMul: 1, bossEvery: 5 };
  }

  function difficultyValue(difficulty, key, fallback) {
    return isFiniteNumber(difficulty[key]) ? difficulty[key] : fallback;
  }

  function soulRewardMultiplier(difficulty) {
    const diff = normalizeDifficulty(difficulty);
    return SOUL_REWARD_MUL_BY_DIFF[diff.id] || SOUL_REWARD_MUL_BY_DIFF.normal;
  }

  function runSoulRewardTotal(wave, difficulty) {
    const w = Math.max(0, Math.floor(safeNumber(wave, 0)));
    if (w <= 0) return 0;
    return Math.max(1, Math.round(w * soulRewardMultiplier(difficulty)));
  }

  function waveSoulReward(wave, difficulty) {
    const w = Math.max(0, Math.floor(safeNumber(wave, 0)));
    if (w <= 0) return 0;
    return runSoulRewardTotal(w, difficulty) - runSoulRewardTotal(w - 1, difficulty);
  }

  function applyDifficulty(base, difficulty) {
    const diff = normalizeDifficulty(difficulty);
    const hpMul = difficultyValue(diff, "hpMul", 1);
    const goldMul = difficultyValue(diff, "goldMul", 1);
    const goddessMul = difficultyValue(diff, "goddessMul", 1);

    if (typeof base === "number") return base * hpMul;
    const result = Object.assign({}, base || {});
    if (isFiniteNumber(result.hp)) result.hp *= hpMul;
    if (isFiniteNumber(result.hpScale)) result.hpScale *= hpMul;
    if (isFiniteNumber(result.gold)) result.gold *= goldMul;
    if (isFiniteNumber(result.goldBonus)) result.goldBonus *= goldMul;
    if (isFiniteNumber(result.goddessHp)) result.goddessHp *= goddessMul;
    return result;
  }

  function baseWaveHpScale(wave) {
    const w = Math.max(1, Math.floor(safeNumber(wave, 1)));
    if (w <= 10) return Math.pow(1 + cfg.GAME.hpGrowthEarly, w - 1);
    return Math.pow(1 + cfg.GAME.hpGrowthEarly, 9) * Math.pow(1 + cfg.GAME.hpGrowthLate, w - 10);
  }

  function eventWaveSeed(wave) {
    return ((wave * 2654435761) % 1000) / 1000;
  }

  function normalizeUnit(value) {
    if (!isFiniteNumber(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 0.999999999999;
    return value;
  }

  function makeRng(rng, wave) {
    if (typeof rng === "function") return () => normalizeUnit(rng());
    let seed = ((Math.max(1, Math.floor(safeNumber(wave, 1))) * 1664525 + 1013904223) >>> 0);
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function pickDefaultEnemy(wave, roll) {
    if (wave < 3) return roll < 0.7 ? "slime" : "goblin";
    if (roll < 0.30) return "slime";
    if (roll < 0.48) return "goblin";
    if (roll < 0.62) return "bat";
    if (roll < 0.72) return "frostwolf";
    if (roll < 0.81) return "imp";
    if (wave >= 5 && roll < 0.90) return "shieldman";
    if (wave >= 7 && roll < 0.95) return "medic";
    return "orc";
  }

  function enemyAvailableInWave(type, wave) {
    if (type === "shieldman") return wave >= 5;
    if (type === "medic") return wave >= 7;
    return true;
  }

  function generateWaveQueue(wave, difficulty, rng) {
    const w = Math.max(1, Math.floor(safeNumber(wave, 1)));
    const diff = normalizeDifficulty(difficulty);
    const bossEvery = difficultyValue(diff, "bossEvery", cfg.GAME.bossEveryWaves || 5);
    const isBoss = w % bossEvery === 0;
    const hpScale = applyDifficulty({ hpScale: baseWaveHpScale(w) }, diff).hpScale;
    const event = cfg.getEventWave(w, isBoss, eventWaveSeed(w));
    const theme = cfg.waveTheme(w);
    const themePool = theme ? (cfg.themeEnemyPool(theme) || []).filter((type) => enemyAvailableInWave(type, w)) : null;
    const rand = makeRng(rng, w);

    let baseCount = 5 + Math.floor(w * 1.2);
    if (isBoss) baseCount = Math.floor(baseCount * 0.5);
    if (event) baseCount = Math.max(2, Math.round(baseCount * event.countMul));

    const eventHpScale = hpScale * (event ? event.hpMul : 1);
    const queue = [];
    for (let i = 0; i < baseCount; i++) {
      let type;
      if (event && event.forceType) {
        type = event.forceType;
      } else if (themePool && themePool.length && rand() < 0.55) {
        type = themePool[Math.floor(rand() * themePool.length)];
      } else {
        type = pickDefaultEnemy(w, rand());
      }
      queue.push({ type, hpScale: eventHpScale, event });
    }

    if (isBoss) queue.push({ type: "boss", hpScale: hpScale * (cfg.GAME.bossHpMul || 1.0) });
    return { wave: w, count: baseCount, totalCount: queue.length, isBoss, event, theme, hpScale, queue };
  }

  function updateBoard(board, diffId, mapIdOrEntry, entryOrMaxEntries, maybeMaxEntries) {
    const legacySignature = mapIdOrEntry && typeof mapIdOrEntry === "object" && !Array.isArray(mapIdOrEntry);
    const entry = legacySignature ? mapIdOrEntry : entryOrMaxEntries;
    const maxEntries = legacySignature ? entryOrMaxEntries : maybeMaxEntries;
    const limit = Math.max(1, Math.floor(safeNumber(maxEntries, 10)));
    const id = sanitizeDiffId(diffId);
    const mapId = sanitizeMapId(legacySignature ? (entry && entry.map) : mapIdOrEntry);
    const cleanBoard = sanitizeBoard(board, limit);
    const cleanEntry = sanitizeBoardEntry(Object.assign({}, entry, { map: mapId }), mapId);
    const nextBoard = Object.assign({}, cleanBoard);
    if (!cleanEntry) return { board: nextBoard, rank: null };

    const candidate = Object.assign({}, cleanEntry, { _candidate: true });
    const currentDiff = cleanBoard[id] || {};
    const all = (currentDiff[mapId] || []).map((item) => Object.assign({}, item)).concat(candidate);
    all.sort(compareBoardEntry);
    const candidateIndex = all.indexOf(candidate);
    const rank = candidateIndex >= 0 && candidateIndex < limit ? candidateIndex + 1 : null;
    const nextDiff = Object.assign({}, currentDiff);
    nextDiff[mapId] = all.slice(0, limit).map((item) => ({
      wave: item.wave,
      score: item.score,
      kills: item.kills,
      at: item.at,
      map: mapId,
    }));
    nextBoard[id] = nextDiff;
    return { board: nextBoard, rank };
  }

  function settleRunRewards(state) {
    const input = state || {};
    const meta = migrateMeta(input.meta);
    const difficulty = normalizeDifficulty(input.difficulty || input.difficultyId);
    const diffId = difficulty.id || input.difficultyId || "normal";
    const wave = Math.max(0, Math.floor(safeNumber(input.wave, 0)));
    const kills = Math.max(0, Math.floor(safeNumber(input.kills, 0)));
    const earned = Math.max(0, Math.floor(safeNumber(input.soulEarned, 0)));
    const previousBest = meta.bestByDiff[diffId] || 0;
    const isRecord = wave > previousBest;

    const nextMeta = Object.assign({}, meta, { bestByDiff: Object.assign({}, meta.bestByDiff) });
    if (isRecord) nextMeta.bestByDiff[diffId] = wave;
    if (wave > (nextMeta.bestWave || 0)) nextMeta.bestWave = wave;
    nextMeta.games += 1;
    nextMeta.totalKills += kills;

    return { meta: nextMeta, earned, isRecord, previousBest, difficultyId: diffId, wave, kills };
  }

  function evaluateAchievements(meta, context) {
    const baseMeta = migrateMeta(meta);
    const ctx = Object.assign({}, context || {});
    const nextMeta = Object.assign({}, baseMeta, { achievements: Object.assign({}, baseMeta.achievements) });
    const unlocked = [];
    const achievements = cfg.ACHIEVEMENTS || {};

    for (const ach of Object.values(achievements)) {
      if (!ach || !ach.id || nextMeta.achievements[ach.id] === true || typeof ach.check !== "function") continue;
      let passed = false;
      try { passed = ach.check(nextMeta, ctx) === true; } catch { passed = false; }
      if (!passed) continue;
      const reward = isFiniteNumber(ach.reward) ? ach.reward : 0;
      nextMeta.achievements[ach.id] = true;
      nextMeta.soulCrystal += reward;
      unlocked.push({ id: ach.id, label: ach.label, desc: ach.desc, reward });
    }

    return { unlocked, meta: nextMeta };
  }

  function evaluateBeginnerMissions(meta, context) {
    const baseMeta = migrateMeta(meta);
    const ctx = Object.assign({}, context || {});
    const nextMeta = Object.assign({}, baseMeta, { beginnerMissions: Object.assign({}, baseMeta.beginnerMissions) });
    const unlocked = [];
    const missions = cfg.BEGINNER_MISSIONS || {};

    for (const mission of Object.values(missions)) {
      if (!mission || !mission.id || nextMeta.beginnerMissions[mission.id] === true || typeof mission.check !== "function") continue;
      let passed = false;
      try { passed = mission.check(nextMeta, ctx) === true; } catch { passed = false; }
      if (!passed) continue;
      const reward = isFiniteNumber(mission.reward) ? mission.reward : 0;
      nextMeta.beginnerMissions[mission.id] = true;
      nextMeta.soulCrystal += reward;
      unlocked.push({ id: mission.id, label: mission.label, desc: mission.desc, reward });
    }

    return { unlocked, meta: nextMeta };
  }

  function distancePointToSegment(px, py, a, b) {
    if (!isFiniteNumber(px) || !isFiniteNumber(py) || !a || !b) return Infinity;
    if (!isFiniteNumber(a.x) || !isFiniteNumber(a.y) || !isFiniteNumber(b.x) || !isFiniteNumber(b.y)) return Infinity;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const lenSq = vx * vx + vy * vy;
    if (lenSq <= 0) return Math.hypot(px - a.x, py - a.y);
    const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / lenSq));
    const x = a.x + vx * t;
    const y = a.y + vy * t;
    return Math.hypot(px - x, py - y);
  }

  function distanceToPath(px, py, path) {
    if (!Array.isArray(path) || path.length < 2) return Infinity;
    let best = Infinity;
    for (let i = 0; i < path.length - 1; i++) {
      best = Math.min(best, distancePointToSegment(px, py, path[i], path[i + 1]));
    }
    return best;
  }

  function canReachPath(px, py, path, range) {
    return distanceToPath(px, py, path) <= Math.max(0, safeNumber(range, 0)) + 1e-9;
  }

  return {
    META_VERSION,
    META_DEFAULT,
    migrateMeta,
    waveSoulReward,
    runSoulRewardTotal,
    settleRunRewards,
    applyDifficulty,
    generateWaveQueue,
    updateBoard,
    evaluateAchievements,
    evaluateBeginnerMissions,
    distancePointToSegment,
    distanceToPath,
    canReachPath,
  };
});
