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

  const META_VERSION = 3;
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
  };

  function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function safeNumber(value, fallback) {
    return isFiniteNumber(value) ? value : fallback;
  }

  function sanitizeBestByDiff(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [key, val] of Object.entries(value)) {
      if (isFiniteNumber(val)) result[key] = val;
    }
    return result;
  }

  function sanitizeBoardEntry(entry) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    if (!isFiniteNumber(entry.wave) || !isFiniteNumber(entry.score) || !isFiniteNumber(entry.kills) || !isFiniteNumber(entry.at)) return null;
    return {
      wave: Math.max(0, Math.floor(entry.wave)),
      score: Math.max(0, Math.floor(entry.score)),
      kills: Math.max(0, Math.floor(entry.kills)),
      at: entry.at,
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
    for (const [diffId, entries] of Object.entries(board)) {
      if (!Array.isArray(entries)) continue;
      const clean = entries.map(sanitizeBoardEntry).filter(Boolean).sort(compareBoardEntry).slice(0, limit);
      if (clean.length) result[diffId] = clean;
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
    return meta;
  }

  function normalizeDifficulty(difficulty) {
    if (typeof difficulty === "string" && cfg.DIFFICULTIES && cfg.DIFFICULTIES[difficulty]) return cfg.DIFFICULTIES[difficulty];
    if (difficulty && typeof difficulty === "object") return difficulty;
    return (cfg.DIFFICULTIES && cfg.DIFFICULTIES.normal) || { id: "normal", hpMul: 1, goldMul: 1, goddessMul: 1, bossEvery: 5 };
  }

  function difficultyValue(difficulty, key, fallback) {
    return isFiniteNumber(difficulty[key]) ? difficulty[key] : fallback;
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
    if (roll < 0.52) return "goblin";
    if (roll < 0.68) return "bat";
    if (roll < 0.80) return "frostwolf";
    if (roll < 0.90) return "imp";
    return "orc";
  }

  function generateWaveQueue(wave, difficulty, rng) {
    const w = Math.max(1, Math.floor(safeNumber(wave, 1)));
    const diff = normalizeDifficulty(difficulty);
    const bossEvery = difficultyValue(diff, "bossEvery", cfg.GAME.bossEveryWaves || 5);
    const isBoss = w % bossEvery === 0;
    const hpScale = applyDifficulty({ hpScale: baseWaveHpScale(w) }, diff).hpScale;
    const event = cfg.getEventWave(w, isBoss, eventWaveSeed(w));
    const theme = cfg.waveTheme(w);
    const themePool = theme ? cfg.themeEnemyPool(theme) : null;
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
      } else if (themePool && rand() < 0.55) {
        type = themePool[Math.floor(rand() * themePool.length)];
      } else {
        type = pickDefaultEnemy(w, rand());
      }
      queue.push({ type, hpScale: eventHpScale, event });
    }

    if (isBoss) queue.push({ type: "boss", hpScale: hpScale * (cfg.GAME.bossHpMul || 1.0) });
    return { wave: w, count: baseCount, totalCount: queue.length, isBoss, event, theme, hpScale, queue };
  }

  function updateBoard(board, diffId, entry, maxEntries) {
    const limit = Math.max(1, Math.floor(safeNumber(maxEntries, 10)));
    const id = typeof diffId === "string" && diffId ? diffId : "normal";
    const cleanBoard = sanitizeBoard(board, limit);
    const cleanEntry = sanitizeBoardEntry(entry);
    const nextBoard = Object.assign({}, cleanBoard);
    if (!cleanEntry) return { board: nextBoard, rank: null };

    const candidate = Object.assign({}, cleanEntry, { _candidate: true });
    const all = (cleanBoard[id] || []).map((item) => Object.assign({}, item)).concat(candidate);
    all.sort(compareBoardEntry);
    const candidateIndex = all.indexOf(candidate);
    const rank = candidateIndex >= 0 && candidateIndex < limit ? candidateIndex + 1 : null;
    nextBoard[id] = all.slice(0, limit).map((item) => ({
      wave: item.wave,
      score: item.score,
      kills: item.kills,
      at: item.at,
    }));
    return { board: nextBoard, rank };
  }

  function settleRunRewards(state) {
    const input = state || {};
    const meta = migrateMeta(input.meta);
    const difficulty = normalizeDifficulty(input.difficulty || input.difficultyId);
    const diffId = difficulty.id || input.difficultyId || "normal";
    const wave = Math.max(0, Math.floor(safeNumber(input.wave, 0)));
    const kills = Math.max(0, Math.floor(safeNumber(input.kills, 0)));
    const earned = Math.max(1, Math.round(wave * 1.5));
    const previousBest = meta.bestByDiff[diffId] || 0;
    const isRecord = wave > previousBest;

    const nextMeta = Object.assign({}, meta, { bestByDiff: Object.assign({}, meta.bestByDiff) });
    if (isRecord) nextMeta.bestByDiff[diffId] = wave;
    if (wave > (nextMeta.bestWave || 0)) nextMeta.bestWave = wave;
    nextMeta.soulCrystal += earned;
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

  return {
    META_VERSION,
    META_DEFAULT,
    migrateMeta,
    settleRunRewards,
    applyDifficulty,
    generateWaveQueue,
    updateBoard,
    evaluateAchievements,
  };
});
