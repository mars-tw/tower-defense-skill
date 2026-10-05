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

  const META_VERSION = 8;
  const META_NUMERIC_KEYS = ["bestWave", "totalKills", "soulCrystal", "games", "gachaPity", "gachaCount", "runSeed"];
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
    operationRuns: {},
    heroProgress: {},
    runSeed: 1,
    lastMap: "plains",
  };
  const SOUL_REWARD_MUL_BY_DIFF = { normal: 1.8, brutal: 2.4, endless: 2.2 };
  const HERO_LONG_XP_RATE = 0.2;
  const HERO_LONG_XP_PER_LEVEL = 24;
  const HERO_LONG_MAX_LEVEL = 15;
  const HERO_LONG_BONUS_EVERY = 5;
  const HERO_LONG_BONUS_STEP = 0.05;
  const HERO_LONG_BONUS_CAP = 0.15;
  const ADVISOR_MODES = {
    control: {
      id: "control",
      label: "控場優先",
      tower: { frost: 6, support: 2, tesla: 1, poison: 1 },
      build: 1.12,
      upgrade: 0.94,
      fast: 4,
      crowd: 1,
      boss: -1,
    },
    aoe: {
      id: "aoe",
      label: "範圍清怪",
      tower: { cannon: 9, tesla: 11, poison: 4, frost: -6 },
      build: 1.08,
      upgrade: 1.02,
      fast: 0,
      crowd: 6,
      boss: 0,
    },
    boss: {
      id: "boss",
      label: "Boss 單點",
      tower: { poison: 11, cannon: 9, tesla: 8, support: 3, frost: -8 },
      build: 0.96,
      upgrade: 1.22,
      fast: -1,
      crowd: 0,
      boss: 6,
    },
  };

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

  function sanitizeOperationRuns(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    const limit = cfg.OPERATIONS && cfg.OPERATIONS.maxSavedRuns || 48;
    const cleanFlags = (raw) => {
      const flags = {};
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return flags;
      for (const [id, flag] of Object.entries(raw)) {
        if (/^chapter-[1-9][0-9]{0,3}-(clear|tactic)$/.test(id) && flag === true) flags[id] = true;
      }
      return flags;
    };
    for (const [key, ledger] of Object.entries(value).slice(-limit)) {
      if (!/^op1-[0-9]{1,10}-[0-9]{1,10}-[A-Za-z0-9_-]{1,32}$/.test(key) || !ledger || typeof ledger !== "object" || Array.isArray(ledger)) continue;
      if (ledger.version !== 1 || ledger.runKey !== key) continue;
      result[key] = {
        version: 1, runKey: key,
        claimed: cleanFlags(ledger.claimed), skipped: cleanFlags(ledger.skipped),
        observedWave: Math.max(0, Math.min(10000, Math.floor(safeNumber(ledger.observedWave, 0)))),
      };
    }
    return result;
  }

  function isSafeRecordKey(key) {
    return typeof key === "string" && /^[A-Za-z0-9_-]{1,48}$/.test(key) &&
      key !== "__proto__" && key !== "prototype" && key !== "constructor";
  }

  function heroLongLevelFromXp(xp) {
    const total = Math.max(0, Math.floor(safeNumber(xp, 0)));
    return Math.max(1, Math.min(HERO_LONG_MAX_LEVEL, 1 + Math.floor(total / HERO_LONG_XP_PER_LEVEL)));
  }

  function heroLongXpForLevel(level) {
    const lv = Math.max(1, Math.min(HERO_LONG_MAX_LEVEL, Math.floor(safeNumber(level, 1))));
    return (lv - 1) * HERO_LONG_XP_PER_LEVEL;
  }

  function heroPermanentBonus(levelOrProgress) {
    const level = typeof levelOrProgress === "object"
      ? heroLongLevelFromXp(levelOrProgress && levelOrProgress.xp)
      : Math.max(1, Math.floor(safeNumber(levelOrProgress, 1)));
    return Math.min(HERO_LONG_BONUS_CAP, Math.floor(level / HERO_LONG_BONUS_EVERY) * HERO_LONG_BONUS_STEP);
  }

  function sanitizeHeroProgress(value) {
    const result = {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return result;
    for (const [key, item] of Object.entries(value)) {
      if (!isSafeRecordKey(key) || !item || typeof item !== "object" || Array.isArray(item)) continue;
      const xp = Math.max(0, Math.floor(safeNumber(item.xp, 0)));
      if (xp <= 0) continue;
      result[key] = { xp, level: heroLongLevelFromXp(xp) };
    }
    return result;
  }

  function settleHeroProgress(meta, heroGrowth) {
    const baseMeta = migrateMeta(meta);
    const progress = Object.assign({}, baseMeta.heroProgress);
    const entries = [];
    const list = Array.isArray(heroGrowth) ? heroGrowth : [];
    for (const item of list) {
      if (!item || !isSafeRecordKey(item.id)) continue;
      const runXp = Math.max(0, Math.floor(safeNumber(item.xp || item.runXp, 0)));
      if (runXp <= 0) continue;
      const savedXp = Math.max(0, Math.round(runXp * HERO_LONG_XP_RATE));
      if (savedXp <= 0) continue;
      const before = progress[item.id] || { xp: 0, level: 1 };
      const oldXp = Math.max(0, Math.floor(safeNumber(before.xp, 0)));
      const oldLevel = heroLongLevelFromXp(oldXp);
      const newXp = oldXp + savedXp;
      const newLevel = heroLongLevelFromXp(newXp);
      progress[item.id] = { xp: newXp, level: newLevel };
      entries.push({
        id: item.id,
        runXp,
        savedXp,
        oldXp,
        newXp,
        oldLevel,
        newLevel,
        levelGained: Math.max(0, newLevel - oldLevel),
        bonus: heroPermanentBonus(newLevel),
      });
    }
    return { meta: Object.assign({}, baseMeta, { heroProgress: progress }), entries };
  }

  function seedToUnit(seed) {
    if (typeof seed === "string") {
      let h = 2166136261;
      for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      seed = h;
    }
    let s = (Math.floor(safeNumber(seed, 1)) >>> 0) || 1;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  }

  function normalizeSeedPart(value, fallback) {
    const fb = Math.floor(safeNumber(fallback, 1)) >>> 0;
    const n = Math.floor(safeNumber(value, fb)) >>> 0;
    return n || fb || 1;
  }

  function normalizeRunSeed(seed, fallback) {
    return normalizeSeedPart(seed, fallback == null ? META_DEFAULT.runSeed : fallback);
  }

  function mixSeedParts(parts) {
    let h = 2166136261;
    for (const part of parts) {
      let x = normalizeSeedPart(part, 0);
      for (let i = 0; i < 4; i++) {
        h ^= x & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
        x >>>= 8;
      }
    }
    return h || 1;
  }

  function normalizeAffix(affix) {
    const affixes = cfg.MAP_AFFIXES || {};
    if (typeof affix === "string" && hasOwn(affixes, affix)) return affixes[affix];
    if (affix && typeof affix === "object" && typeof affix.id === "string" && hasOwn(affixes, affix.id)) return affixes[affix.id];
    return null;
  }

  function selectMapAffix(seedOrRng) {
    const affixes = Object.values(cfg.MAP_AFFIXES || {});
    if (!affixes.length) return null;
    const unit = typeof seedOrRng === "function" ? normalizeUnit(seedOrRng()) : seedToUnit(seedOrRng);
    return affixes[Math.min(affixes.length - 1, Math.floor(unit * affixes.length))];
  }

  function affixExpectedBalance(affixInput) {
    const affix = normalizeAffix(affixInput);
    if (!affix) return { goldDelta: 0, powerDelta: 0, netDelta: 0 };
    const goldDelta = safeNumber(affix.expectedGoldDelta, ((safeNumber(affix.killGoldMul, 1) - 1) * 0.55) + ((safeNumber(affix.waveGoldMul, 1) - 1) * 0.45));
    const enemyDelta = (safeNumber(affix.enemyHpMul, 1) - 1) + (safeNumber(affix.enemySpeedMul, 1) - 1) * 0.75;
    const playerDelta = (safeNumber(affix.towerDamageMul, 1) - 1) + (safeNumber(affix.towerRangeMul, 1) - 1) * 0.8;
    const powerDelta = safeNumber(affix.expectedPowerDelta, enemyDelta - playerDelta);
    return { goldDelta, powerDelta, netDelta: goldDelta - powerDelta };
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
    meta.operationRuns = sanitizeOperationRuns(meta.operationRuns);
    meta.heroProgress = sanitizeHeroProgress(meta.heroProgress);
    meta.lastMap = sanitizeMapId(meta.lastMap);
    return meta;
  }

  function hasInvalidMetaWriteShape(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return true;
    for (const key of META_NUMERIC_KEYS) {
      if (hasOwn(candidate, key) && !isFiniteNumber(candidate[key])) return true;
    }
    const objectKeys = ["bestByDiff", "board", "achievements", "beginnerMissions", "operationRuns", "heroProgress"];
    for (const key of objectKeys) {
      if (hasOwn(candidate, key) && (!candidate[key] || typeof candidate[key] !== "object" || Array.isArray(candidate[key]))) return true;
    }
    return false;
  }

  function protectMetaWrite(currentRaw, candidateRaw) {
    const current = migrateMeta(currentRaw);
    if (hasInvalidMetaWriteShape(candidateRaw)) {
      return { ok: false, reason: "invalid-meta-write", meta: current };
    }
    return { ok: true, reason: "ok", meta: migrateMeta(candidateRaw) };
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

  function eventWaveSeed(wave, runSeed, affixSeed) {
    const w = Math.max(1, Math.floor(safeNumber(wave, 1)));
    if (runSeed != null || affixSeed != null) {
      return mixSeedParts([w, normalizeSeedPart(runSeed, 0), normalizeSeedPart(affixSeed, 0), 0x65766e74]) / 4294967296;
    }
    return ((w * 2654435761) % 1000) / 1000;
  }

  function waveRngSeed(wave, runSeed, affixSeed) {
    const w = Math.max(1, Math.floor(safeNumber(wave, 1)));
    if (runSeed != null || affixSeed != null) {
      return mixSeedParts([normalizeRunSeed(runSeed), normalizeSeedPart(affixSeed, 0), w]);
    }
    return ((w * 1664525 + 1013904223) >>> 0) || 1;
  }

  function normalizeUnit(value) {
    if (!isFiniteNumber(value)) return 0;
    if (value <= 0) return 0;
    if (value >= 1) return 0.999999999999;
    return value;
  }

  function makeRng(rng, wave) {
    if (typeof rng === "function") return () => normalizeUnit(rng());
    let seed = (isFiniteNumber(rng) ? Math.floor(rng) : waveRngSeed(wave)) >>> 0;
    if (!seed) seed = 1;
    return () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  }

  function selectTowerMuteTarget(enemy, towers, range) {
    if (!enemy || !Array.isArray(towers)) return null;
    const r = Math.max(0, safeNumber(range, 0));
    let best = null;
    for (let i = 0; i < towers.length; i++) {
      const tw = towers[i];
      if (!tw || !isFiniteNumber(tw.x) || !isFiniteNumber(tw.y)) continue;
      const d = Math.hypot(tw.x - safeNumber(enemy.x, 0), tw.y - safeNumber(enemy.y, 0));
      if (d > r) continue;
      const order = isFiniteNumber(tw.order) ? tw.order : i;
      if (!best || d < best.distance - 1e-9 || (Math.abs(d - best.distance) <= 1e-9 && order < best.order)) {
        best = { index: i, tower: tw, distance: d, order };
      }
    }
    return best;
  }

  function pickDefaultEnemy(wave, roll) {
    if (wave < 3) {
      if (roll < 0.62) return "slime";
      if (roll < 0.86) return "goblin";
      return "emberbat";
    }
    if (roll < 0.24) return "slime";
    if (roll < 0.40) return "goblin";
    if (roll < 0.52) return "bat";
    if (roll < 0.62) return "frostwolf";
    if (roll < 0.70) return "imp";
    if (roll < 0.78) return "emberbat";
    if (roll < 0.86) return wave >= 5 ? "shieldman" : "imp";
    if (roll < 0.90) return wave >= 7 ? "lavagolem" : (wave >= 6 ? "frostwraith" : "frostwolf");
    if (roll < 0.93) return wave >= 10 ? "silencer" : (wave >= 7 ? "medic" : "bat");
    if (roll < 0.95) return wave >= 11 ? "mirrorling" : (wave >= 9 ? "abysshound" : (wave >= 8 ? "thunderronin" : "frostwolf"));
    if (roll < 0.965) return wave >= 8 ? "thunderronin" : "orc";
    if (roll < 0.98) return wave >= 12 ? "warden" : (wave >= 9 ? "abysshound" : "orc");
    if (roll < 0.99) return wave >= 9 ? "abysshound" : (wave >= 8 ? "thunderronin" : "orc");
    return "orc";
  }

  function enemyAvailableInWave(type, wave) {
    if (type === "shieldman") return wave >= 5;
    if (type === "frostwraith") return wave >= 6;
    if (type === "lavagolem") return wave >= 7;
    if (type === "medic") return wave >= 7;
    if (type === "thunderronin") return wave >= 8;
    if (type === "abysshound") return wave >= 9;
    if (type === "silencer") return wave >= 10;
    if (type === "mirrorling") return wave >= 11;
    if (type === "warden") return wave >= 12;
    return true;
  }

  function themeEnemyWeight(type, wave) {
    const enemy = cfg.ENEMIES[type];
    if (!enemy) return 0;
    let weight = 1;
    if (enemy.shield) weight *= 0.72;
    if (enemy.hp >= 110) weight *= 0.62;
    if (enemy.hp >= 145) weight *= 0.44;
    if ((type === "lavagolem" || type === "warden") && wave < 16) weight *= 0.42;
    if (enemy.speed >= 90) weight *= 1.18;
    return Math.max(0.08, weight);
  }

  function pickWeightedEnemy(pool, wave, rand) {
    const weighted = pool.map((type) => ({ type, weight: themeEnemyWeight(type, wave) })).filter((item) => item.weight > 0);
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    if (total <= 0) return pool[Math.floor(rand() * pool.length)];
    let roll = rand() * total;
    for (const item of weighted) {
      roll -= item.weight;
      if (roll <= 0) return item.type;
    }
    return weighted[weighted.length - 1].type;
  }

  function bossWaveIndex(wave, bossEvery) {
    return Math.max(1, Math.floor(safeNumber(wave, 1) / Math.max(1, safeNumber(bossEvery, cfg.GAME.bossEveryWaves || 5))));
  }

  function bossWaveCountMul(wave, bossEvery) {
    const index = bossWaveIndex(wave, bossEvery);
    return Math.min(0.68, 0.50 + index * 0.04 + Math.max(0, index - 1) * 0.04);
  }

  function bossHpMultiplierForWave(wave, bossEvery) {
    const base = safeNumber(cfg.GAME.bossHpMul, 1);
    const index = bossWaveIndex(wave, bossEvery);
    return base * Math.min(1.32, 1 + (index - 1) * 0.10);
  }

  function generateWaveQueue(wave, difficulty, rng, affixInput) {
    const w = Math.max(1, Math.floor(safeNumber(wave, 1)));
    const diff = normalizeDifficulty(difficulty);
    const affix = normalizeAffix(affixInput);
    const bossEvery = difficultyValue(diff, "bossEvery", cfg.GAME.bossEveryWaves || 5);
    const isBoss = w % bossEvery === 0;
    const hpScale = applyDifficulty({ hpScale: baseWaveHpScale(w) }, diff).hpScale;
    const eventSalt = isFiniteNumber(rng) ? Math.floor(rng) : null;
    const event = cfg.getEventWave(w, isBoss, eventWaveSeed(w, eventSalt));
    const theme = cfg.waveTheme(w);
    const themePool = theme ? (cfg.themeEnemyPool(theme) || []).filter((type) => enemyAvailableInWave(type, w)) : null;
    const rand = makeRng(rng, w);

    let baseCount = 5 + Math.floor(w * 1.2);
    if (isBoss) baseCount = Math.floor(baseCount * bossWaveCountMul(w, bossEvery));
    if (event) baseCount = Math.max(2, Math.round(baseCount * event.countMul));

    const affixHpMul = affix ? safeNumber(affix.enemyHpMul, 1) : 1;
    const eventHpScale = hpScale * (event ? event.hpMul : 1) * affixHpMul;
    const queue = [];
    for (let i = 0; i < baseCount; i++) {
      let type;
      if (event && event.forceType) {
        type = event.forceType;
      } else if (themePool && themePool.length && rand() < 0.55) {
        type = pickWeightedEnemy(themePool, w, rand);
      } else {
        type = pickDefaultEnemy(w, rand());
      }
      queue.push({ type, hpScale: eventHpScale, event, affix: affix ? affix.id : null });
    }

    if (event && event.id === "pilgrim" && event.special && hasOwn(cfg.ENEMIES, event.special.type)) {
      const special = event.special;
      queue.unshift({
        type: special.type,
        hpScale: eventHpScale * safeNumber(special.hpMul, 1),
        speedMul: safeNumber(special.speedMul, 1),
        rewardMul: safeNumber(special.rewardMul, 1),
        leakOverride: isFiniteNumber(special.leak) ? special.leak : null,
        role: special.role || "pilgrim",
        nameOverride: special.name || null,
        emojiOverride: special.emoji || null,
        colorOverride: special.color || null,
        event,
        affix: affix ? affix.id : null,
      });
    }

    if (isBoss) {
      const bossType = (Math.floor(w / bossEvery) % 2 === 0) ? "yaksha" : "boss";
      const bossIndex = bossWaveIndex(w, bossEvery);
      const firstBossRewardMul = bossIndex === 1
        ? difficultyValue(diff, "firstBossRewardMul", 1)
        : 1;
      const firstBossSpeedMul = bossIndex === 1
        ? difficultyValue(diff, "firstBossSpeedMul", 1)
        : 1;
      queue.push({
        type: bossType,
        hpScale: hpScale * bossHpMultiplierForWave(w, bossEvery) * affixHpMul,
        speedMul: firstBossSpeedMul,
        rewardMul: firstBossRewardMul,
        affix: affix ? affix.id : null,
      });
    }
    return { wave: w, count: baseCount, totalCount: queue.length, isBoss, event, theme, hpScale: hpScale * affixHpMul, affix, queue };
  }

  function countWaveEnemies(input) {
    const list = Array.isArray(input)
      ? input
      : (input && Array.isArray(input.queue) ? input.queue : []);
    const counts = {};
    for (const item of list) {
      const type = typeof item === "string" ? item : item && item.type;
      if (!isSafeRecordKey(type) || !hasOwn(cfg.ENEMIES, type)) continue;
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }

  function towerReason(towerId, facts) {
    const f = facts || {};
    if (towerId === "cannon") {
      if (f.ice > 0) return "火系克制冰系敵人，範圍傷害也能清群。";
      if (f.healer > 0) return "範圍爆破可優先壓低醫官與周邊敵人。";
      return "範圍傷害適合處理密集敵群。";
    }
    if (towerId === "frost") {
      if (f.thunder > 0) return "冰系克制雷系敵人，緩速能拖住高速單位。";
      if (f.fast > 0) return "緩速讓高速敵人多吃幾輪火力。";
      return "控場穩定，適合延長主力塔輸出時間。";
    }
    if (towerId === "tesla") {
      if (f.fire > 0) return "雷系克制火系敵人，穿透適合成群小怪。";
      if (f.shield > 0) return "穿透與連鎖能補破盾並清後排。";
      return "穿透連鎖適合混波與多目標壓血。";
    }
    if (towerId === "poison") {
      if (f.shield > 0) return "持續傷害能穿盾消耗本體。";
      if (f.highHp > 0) return "持續傷害適合高血敵與 Boss。";
      return "穩定疊毒，適合慢速或耐久敵人。";
    }
    if (towerId === "beacon") {
      if (f.fast > 0) return "引魂燈塔用暴露與小幅減速拖住高速敵，不與寒冰減速疊乘。";
      if (f.mute > 0) return "緘口妖僧靠近前先被暴露拖速，主力塔較不易一起噤聲。";
      return "不做傷害，補支援與資訊控場位置。";
    }
    if (towerId === "mortar") {
      if (f.aura > 0) return "墜星臼砲可在最短射程外轟掉守門光環核心。";
      if (f.healer > 0) return "大範圍爆破能壓醫官與護衛群。";
      if (f.ice > 0) return "火系高爆克制冰系敵群，但需要留出最短射程。";
      return "高傷大爆破適合中後段密集敵群。";
    }
    if (towerId === "support") return "主力塔成形後增傷，放在核心火力區。";
    return "便宜高攻速，適合補刀與觸發閃避後追擊。";
  }

  function waveFactsFromCounts(counts) {
    const facts = { physical: 0, fire: 0, ice: 0, thunder: 0, shield: 0, healer: 0, fast: 0, highHp: 0, boss: 0, split: 0, mute: 0, reflect: 0, aura: 0, total: 0 };
    for (const [type, count] of Object.entries(counts || {})) {
      const enemy = cfg.ENEMIES[type];
      if (!enemy) continue;
      const n = Math.max(0, Math.floor(safeNumber(count, 0)));
      facts.total += n;
      if (hasOwn(facts, enemy.element)) facts[enemy.element] += n;
      if (enemy.shield) facts.shield += n;
      if (enemy.healRadius) facts.healer += n;
      if (enemy.speed >= 80) facts.fast += n;
      if (enemy.hp >= 100) facts.highHp += n;
      if (enemy.boss) facts.boss += n;
      if (enemy.ability && enemy.ability.id === "splitBat") facts.split += n;
      if (enemy.ability && enemy.ability.id === "towerMute") facts.mute += n;
      if (enemy.ability && enemy.ability.id === "reflectOnce") facts.reflect += n;
      if (enemy.ability && enemy.ability.id === "auraArmor") facts.aura += n;
    }
    return facts;
  }

  function recommendTowersForWave(input) {
    const counts = countWaveEnemies(input);
    const facts = waveFactsFromCounts(counts);

    const recommendations = [];
    for (const tower of Object.values(cfg.TOWERS || {})) {
      if (!tower || !tower.id) continue;
      let score = tower.support ? 0 : 0.2;
      for (const [type, count] of Object.entries(counts)) {
        const enemy = cfg.ENEMIES[type];
        if (!enemy) continue;
        const n = Math.max(0, Math.floor(safeNumber(count, 0)));
        if (!tower.support) {
          const mul = cfg.elementMultiplier ? cfg.elementMultiplier(tower.element, enemy.element) : 1;
          score += n * mul;
          if (cfg.COUNTERS && cfg.COUNTERS[tower.element] === enemy.element) score += n * 0.8;
          if (tower.id === "arrow" && (enemy.element === "physical" || (enemy.ability && enemy.ability.id === "dodgeFirst"))) score += n * 0.35;
          if (tower.id === "cannon" && (enemy.shield || enemy.healRadius || (enemy.ability && enemy.ability.id === "splitBat"))) score += n * 0.7;
          if (tower.id === "frost" && (enemy.speed >= 80 || (enemy.ability && enemy.ability.id === "bloodrage"))) score += n * 0.85;
          if (tower.id === "tesla" && (enemy.shield || enemy.healRadius || (enemy.ability && enemy.ability.id === "splitBat"))) score += n * 0.65;
          if (tower.id === "poison" && (enemy.shield || enemy.hp >= 100 || enemy.boss)) score += n * 1.05;
          if (tower.id === "mortar" && (enemy.healRadius || enemy.shield || enemy.hp >= 120 || (enemy.ability && enemy.ability.id === "auraArmor"))) score += n * 0.95;
        }
        if (tower.id === "beacon" && (enemy.speed >= 80 || (enemy.ability && enemy.ability.id === "towerMute"))) score += n * 1.05;
      }
      if (tower.id === "support") {
        score += facts.total >= 12 ? 4 : 0;
        score += facts.boss ? 3 : 0;
        score += facts.highHp >= 2 ? 1.5 : 0;
      }
      if (tower.id === "beacon") {
        score += facts.fast ? 2.5 : 0;
        score += facts.mute ? 2 : 0;
        score += facts.total >= 12 ? 1 : 0;
      }
      recommendations.push({
        id: tower.id,
        name: tower.name,
        emoji: tower.emoji,
        score: Math.round(score * 100) / 100,
        reason: towerReason(tower.id, facts),
      });
    }
    return recommendations
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 3);
  }

  function normalizeTowers(towers) {
    const list = Array.isArray(towers) ? towers : [];
    return list
      .filter((tw) => tw && hasOwn(cfg.TOWERS, tw.type))
      .map((tw) => ({
        type: tw.type,
        level: Math.max(1, Math.floor(safeNumber(tw.level, 1))),
        x: safeNumber(tw.x, NaN),
        y: safeNumber(tw.y, NaN),
        cx: isFiniteNumber(tw.cx) ? Math.floor(tw.cx) : null,
        cy: isFiniteNumber(tw.cy) ? Math.floor(tw.cy) : null,
      }));
  }

  function towerDpsFor(type, level, affixInput) {
    const tower = cfg.TOWERS[type];
    if (!tower || tower.support) return 0;
    const affix = normalizeAffix(affixInput);
    const damageMul = affix ? safeNumber(affix.towerDamageMul, 1) : 1;
    let dps = safeNumber(tower.damage, 0) * Math.pow(cfg.UPGRADE.damageMul || 1.5, Math.max(1, level) - 1) * damageMul * safeNumber(tower.fireRate, 0);
    if (tower.splash) dps *= 2.2;
    if (tower.pierce) dps *= 1 + (tower.pierce - 1) * 0.6;
    if (tower.poisonDps) dps += towerPoisonDpsFor(type, level, affixInput) * Math.min(2.2, tower.poisonDuration || 1) * 0.7;
    return dps;
  }

  function towerPoisonDpsFor(type, level, affixInput) {
    const tower = cfg.TOWERS[type];
    if (!tower || !tower.poisonDps) return 0;
    const affix = normalizeAffix(affixInput);
    const damageMul = affix ? safeNumber(affix.towerDamageMul, 1) : 1;
    const lv = Math.max(1, Math.floor(safeNumber(level, 1)));
    const poisonMul = cfg.UPGRADE.poisonDpsMul || cfg.UPGRADE.damageMul || 1;
    return safeNumber(tower.poisonDps, 0) * Math.pow(poisonMul, lv - 1) * damageMul;
  }

  function towerRangeFor(type, level, affixInput) {
    const tower = cfg.TOWERS[type];
    if (!tower) return 0;
    const affix = normalizeAffix(affixInput);
    const rangeMul = affix ? safeNumber(affix.towerRangeMul, 1) : 1;
    return safeNumber(tower.range, 0) * Math.pow(cfg.UPGRADE.rangeMul || 1.08, Math.max(1, level) - 1) * rangeMul;
  }

  function pathTotalLength(path) {
    if (!Array.isArray(path) || path.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (a && b && isFiniteNumber(a.x) && isFiniteNumber(a.y) && isFiniteNumber(b.x) && isFiniteNumber(b.y)) {
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
    }
    return total;
  }

  function pointAtPathRatio(path, ratio) {
    if (!Array.isArray(path) || !path.length) return { x: 0, y: 0 };
    if (path.length === 1) return { x: safeNumber(path[0].x, 0), y: safeNumber(path[0].y, 0) };
    const total = pathTotalLength(path);
    if (total <= 0) return { x: safeNumber(path[0].x, 0), y: safeNumber(path[0].y, 0) };
    let target = Math.max(0, Math.min(1, safeNumber(ratio, 0))) * total;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (target <= len || i === path.length - 2) {
        const t = len <= 0 ? 0 : target / len;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      target -= len;
    }
    const last = path[path.length - 1];
    return { x: safeNumber(last.x, 0), y: safeNumber(last.y, 0) };
  }

  function zoneLabel(ratio) {
    const r = Math.max(0, Math.min(1, safeNumber(ratio, 0.5)));
    if (r < 0.34) return "前段";
    if (r < 0.67) return "中段";
    return "後段";
  }

  function coverageSamples(towers, path, affixInput) {
    const ratios = [0.12, 0.28, 0.44, 0.60, 0.76, 0.90];
    return ratios.map((ratio) => {
      const p = pointAtPathRatio(path, ratio);
      let coverage = 0;
      for (const tw of towers) {
        const tower = cfg.TOWERS[tw.type];
        if (!tower || tower.support || !isFiniteNumber(tw.x) || !isFiniteNumber(tw.y)) continue;
        const range = towerRangeFor(tw.type, tw.level, affixInput);
        if (Math.hypot(tw.x - p.x, tw.y - p.y) <= range) coverage += towerDpsFor(tw.type, tw.level, affixInput);
      }
      return { ratio, point: p, coverage };
    });
  }

  function weakestCoverageSample(towers, path, affixInput) {
    const samples = coverageSamples(towers, path, affixInput);
    return samples.sort((a, b) => a.coverage - b.coverage || a.ratio - b.ratio)[0] || { ratio: 0.5, point: pointAtPathRatio(path, 0.5), coverage: 0 };
  }

  function buildCandidateForTower(type, towers, path, affixInput, options) {
    const tower = cfg.TOWERS[type];
    if (!tower || !Array.isArray(path) || path.length < 2) return null;
    const cell = Math.max(16, Math.floor(safeNumber(cfg.GAME.cellSize, 48)));
    const width = Math.max(cell, Math.floor(safeNumber(options && options.width, 960)));
    const height = Math.max(cell, Math.floor(safeNumber(options && options.height, 640)));
    const range = towerRangeFor(type, 1, affixInput);
    const weak = weakestCoverageSample(towers, path, affixInput);
    const occupied = new Set(towers.map((tw) => `${tw.cx},${tw.cy}`));
    const blocked = pathBlockedCells(path, cell);
    const mapDef = options && options.mapDef || (options && hasOwn(cfg.MAPS, options.mapId) ? cfg.MAPS[options.mapId] : Object.values(cfg.MAPS).find((map) => map.path === path));
    const terrainBlocked = mapDef ? mapBlockedCells(mapDef, cell) : null;
    let best = null;
    for (let cy = 0; cy < Math.ceil(height / cell); cy++) {
      for (let cx = 0; cx < Math.ceil(width / cell); cx++) {
        if (occupied.has(`${cx},${cy}`)) continue;
        if (blocked.has(`${cx},${cy}`)) continue;
        if (terrainBlocked && terrainBlocked.has(`${cx},${cy}`)) continue;
        const x = cx * cell + cell / 2;
        const y = cy * cell + cell / 2;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const pathDist = distanceToPath(x, y, path);
        if (pathDist < cell * 0.58 || pathDist > range) continue;
        const targetDist = Math.hypot(x - weak.point.x, y - weak.point.y);
        const score = targetDist + Math.abs(pathDist - range * 0.58) * 0.25;
        if (!best || score < best.score) {
          const zone = mapDef && mapDefenseZone(mapDef, weak.ratio);
          best = { cx, cy, x: Math.round(x), y: Math.round(y), zone: zone ? zone.label : zoneLabel(weak.ratio), score, pathDistance: Math.round(pathDist) };
        }
      }
    }
    return best;
  }

  function dominantCounterNeed(input) {
    const counts = countWaveEnemies(input);
    const byElement = { fire: 0, ice: 0, thunder: 0 };
    let total = 0;
    for (const [type, count] of Object.entries(counts)) {
      const enemy = cfg.ENEMIES[type];
      const n = Math.max(0, Math.floor(safeNumber(count, 0)));
      if (!enemy || n <= 0) continue;
      total += n;
      if (hasOwn(byElement, enemy.element)) byElement[enemy.element] += n;
    }
    const dominant = Object.entries(byElement).sort((a, b) => b[1] - a[1])[0];
    if (!dominant || dominant[1] <= 0) return null;
    if (dominant[1] < Math.max(2, total * 0.45)) return null;
    const enemyElement = dominant[0];
    const counterElement = Object.entries(cfg.COUNTERS || {}).find((entry) => entry[1] === enemyElement);
    if (!counterElement) return null;
    const tower = Object.values(cfg.TOWERS || {}).find((tw) => tw && tw.element === counterElement[0] && !tw.support);
    if (!tower) return null;
    return { enemyElement, count: dominant[1], total, counterElement: counterElement[0], towerId: tower.id };
  }

  function counterWarningForWave(input) {
    const need = dominantCounterNeed(input);
    if (!need) return null;
    const towers = normalizeTowers(input && input.towers);
    const hasCounter = towers.some((tw) => {
      const tower = cfg.TOWERS[tw.type];
      return tower && tower.element === need.counterElement && !tower.support;
    });
    if (hasCounter) return null;
    const enemyLabel = cfg.ELEMENTS && cfg.ELEMENTS[need.enemyElement] ? cfg.ELEMENTS[need.enemyElement].label : need.enemyElement;
    const counterLabel = cfg.ELEMENTS && cfg.ELEMENTS[need.counterElement] ? cfg.ELEMENTS[need.counterElement].label : need.counterElement;
    return {
      element: need.enemyElement,
      counterElement: need.counterElement,
      towerId: need.towerId,
      severity: "warning",
      message: `下波以${enemyLabel}系為主，你沒有${counterLabel}系塔。`,
    };
  }

  function towerFitScore(type, input) {
    const counts = countWaveEnemies(input);
    const rec = recommendTowersForWave(input).find((item) => item.id === type);
    const tower = cfg.TOWERS[type];
    if (!tower) return 0;
    let score = rec ? rec.score : 0;
    for (const [enemyType, count] of Object.entries(counts)) {
      const enemy = cfg.ENEMIES[enemyType];
      if (!enemy) continue;
      const n = Math.max(0, Math.floor(safeNumber(count, 0)));
      const mul = cfg.elementMultiplier ? cfg.elementMultiplier(tower.element, enemy.element) : 1;
      score += n * (mul - 1);
    }
    return score;
  }

  function normalizeAdvisorMode(mode) {
    return hasOwn(ADVISOR_MODES, mode) ? mode : "control";
  }

  function advisorModeBonus(type, facts, modeId, kind) {
    const mode = ADVISOR_MODES[normalizeAdvisorMode(modeId)];
    let bonus = safeNumber(mode.tower[type], 0);
    if (type === "frost" && facts.fast > 0) bonus += mode.fast;
    if ((type === "cannon" || type === "tesla" || type === "poison") && (facts.total >= 8 || facts.split > 0)) bonus += mode.crowd;
    if ((type === "poison" || type === "cannon" || type === "tesla" || type === "support") && (facts.boss > 0 || facts.highHp > 0)) bonus += mode.boss;
    return bonus * (kind === "upgrade" ? mode.upgrade : mode.build);
  }

  function adviseTowerActions(input) {
    const ctx = input || {};
    const towers = normalizeTowers(ctx.towers);
    const path = Array.isArray(ctx.path) ? ctx.path : [];
    const gold = Math.max(0, Math.floor(safeNumber(ctx.gold, 0)));
    const actions = [];
    const warning = counterWarningForWave(ctx);
    const recs = recommendTowersForWave(ctx);
    const modeId = normalizeAdvisorMode(ctx.advisorMode || ctx.mode);
    const mode = ADVISOR_MODES[modeId];
    const facts = waveFactsFromCounts(countWaveEnemies(ctx));
    const existingTypes = new Set(towers.map((tw) => tw.type));
    for (const rec of recs) {
      const tower = cfg.TOWERS[rec.id];
      if (!tower || tower.support || gold < tower.cost) continue;
      const candidate = buildCandidateForTower(rec.id, towers, path, ctx.affix, ctx);
      if (!candidate) continue;
      const needBonus = warning && warning.towerId === rec.id ? 10 : 0;
      const varietyBonus = existingTypes.has(rec.id) ? 0 : 2;
      const modeBonus = advisorModeBonus(rec.id, facts, modeId, "build");
      actions.push({
        kind: "build",
        mode: modeId,
        modeLabel: mode.label,
        towerId: rec.id,
        towerName: tower.name,
        emoji: tower.emoji,
        cost: tower.cost,
        cx: candidate.cx,
        cy: candidate.cy,
        x: candidate.x,
        y: candidate.y,
        zone: candidate.zone,
        score: Math.round((rec.score + needBonus + varietyBonus + modeBonus) * 100) / 100,
        reason: warning && warning.towerId === rec.id
          ? `補${tower.name}處理下波克制缺口，放在${candidate.zone}覆蓋低火力路段。`
          : `放在${candidate.zone}補覆蓋缺口；${rec.reason}`,
      });
    }

    for (let index = 0; index < towers.length; index++) {
      const tw = towers[index];
      const tower = cfg.TOWERS[tw.type];
      if (!tower || tower.support || tw.level >= cfg.UPGRADE.maxLevel) continue;
      const cost = Math.round(tower.cost * Math.pow(cfg.UPGRADE.costMul || 1.52, tw.level));
      if (gold < cost) continue;
      const before = towerDpsFor(tw.type, tw.level, ctx.affix);
      const after = towerDpsFor(tw.type, tw.level + 1, ctx.affix);
      const fit = Math.max(1, towerFitScore(tw.type, ctx));
      const modeBonus = advisorModeBonus(tw.type, facts, modeId, "upgrade");
      const baseScore = ((after - before) * fit) / Math.max(1, cost);
      actions.push({
        kind: "upgrade",
        mode: modeId,
        modeLabel: mode.label,
        towerId: tw.type,
        towerName: tower.name,
        emoji: tower.emoji,
        towerIndex: index,
        level: tw.level,
        nextLevel: tw.level + 1,
        cost,
        zone: isFiniteNumber(tw.x) && isFiniteNumber(tw.y) && path.length >= 2
          ? zoneLabel(weakestCoverageSample([tw], path, ctx.affix).ratio)
          : "現有火力區",
        score: Math.round((baseScore + modeBonus) * 1000) / 1000,
        reason: `升級${tower.name}到 Lv.${tw.level + 1}，本波傷害效率最高。`,
      });
    }

    if (!actions.length) {
      const next = recs.find((rec) => cfg.TOWERS[rec.id]) || null;
      if (next) {
        const tower = cfg.TOWERS[next.id];
        actions.push({
          kind: "save",
          mode: modeId,
          modeLabel: mode.label,
          towerId: next.id,
          towerName: tower.name,
          emoji: tower.emoji,
          cost: tower.cost,
          missingGold: Math.max(0, tower.cost - gold),
          zone: "波間",
          score: 0,
          reason: `先存 ${Math.max(0, tower.cost - gold)} 金，下一步補${tower.name}。`,
        });
      }
    }

    return actions
      .sort((a, b) => b.score - a.score || (a.kind === "build" ? -1 : 1))
      .slice(0, 2);
  }

  function towerTypeCounts(towers) {
    const counts = {};
    for (const tw of normalizeTowers(towers)) counts[tw.type] = (counts[tw.type] || 0) + 1;
    return counts;
  }

  function normalizeLeakStats(leaks) {
    const byWave = {};
    const raw = leaks && typeof leaks === "object" ? leaks.byWave || leaks : {};
    if (!raw || typeof raw !== "object") return { total: 0, byWave };
    let total = 0;
    for (const [waveKey, entry] of Object.entries(raw)) {
      const wave = Math.max(0, Math.floor(safeNumber(Number(waveKey), 0)));
      if (!wave || !entry || typeof entry !== "object") continue;
      const byType = {};
      const rawTypes = entry.byType && typeof entry.byType === "object" ? entry.byType : {};
      let count = Math.max(0, Math.floor(safeNumber(entry.count, 0)));
      let typeCount = 0;
      for (const [type, nRaw] of Object.entries(rawTypes)) {
        if (!isSafeRecordKey(type) || !hasOwn(cfg.ENEMIES, type)) continue;
        const n = Math.max(0, Math.floor(safeNumber(nRaw, 0)));
        if (n <= 0) continue;
        byType[type] = n;
        typeCount += n;
      }
      count = Math.max(count, typeCount);
      if (count <= 0) continue;
      const damage = Math.max(0, Math.floor(safeNumber(entry.damage, 0)));
      byWave[wave] = { wave, count, damage, byType };
      total += count;
    }
    return { total, byWave };
  }

  function topLeakEntry(leaks) {
    const entries = Object.values(leaks.byWave || {});
    return entries.sort((a, b) => b.count - a.count || b.damage - a.damage || a.wave - b.wave)[0] || null;
  }

  function topLeakEnemy(entry) {
    const types = Object.entries((entry && entry.byType) || {});
    const top = types.sort((a, b) => b[1] - a[1])[0];
    if (!top) return null;
    const enemy = cfg.ENEMIES[top[0]];
    return enemy ? { type: top[0], count: top[1], enemy } : null;
  }

  function inferLeakReason(entry, towers) {
    const top = topLeakEnemy(entry);
    const towerCounts = towerTypeCounts(towers);
    if (!top) return { cause: "coverage", text: "火力覆蓋不足" };
    const enemy = top.enemy;
    if (enemy.speed >= 80 && !towerCounts.frost) return { cause: "fast", text: `${enemy.name}未被減速` };
    if (enemy.ability && enemy.ability.id === "splitBat" && !towerCounts.frost) return { cause: "fast", text: `${enemy.name}分裂後缺少緩速攔截` };
    if (enemy.ability && enemy.ability.id === "towerMute") return { cause: "mute", text: `${enemy.name}讓核心塔噤聲，火力短暫中斷` };
    if (enemy.ability && enemy.ability.id === "reflectOnce") return { cause: "reflect", text: `${enemy.name}反射首次技能，爆發沒有打穿` };
    if (enemy.ability && enemy.ability.id === "auraArmor") return { cause: "aura", text: `${enemy.name}替附近敵人減傷，清場變慢` };
    if (enemy.shield && !towerCounts.poison) return { cause: "shield", text: `${enemy.name}護盾未被毒塔穿透` };
    if ((enemy.boss || enemy.hp >= 120) && !towerCounts.poison && !towerCounts.cannon) return { cause: "durable", text: `${enemy.name}血量高，單體火力不足` };
    const counterElement = Object.entries(cfg.COUNTERS || {}).find((item) => item[1] === enemy.element);
    if (counterElement) {
      const hasCounter = Object.values(cfg.TOWERS || {}).some((tower) => tower && tower.element === counterElement[0] && towerCounts[tower.id]);
      if (!hasCounter && enemy.element !== "physical") {
        const label = cfg.ELEMENTS && cfg.ELEMENTS[enemy.element] ? cfg.ELEMENTS[enemy.element].label : enemy.element;
        const counter = cfg.ELEMENTS && cfg.ELEMENTS[counterElement[0]] ? cfg.ELEMENTS[counterElement[0]].label : counterElement[0];
        return { cause: "counter", text: `${label}系敵人缺少${counter}系克制塔` };
      }
    }
    return { cause: "coverage", text: `${enemy.name}行進路段火力覆蓋不足` };
  }

  function runLearningAdjustments(reason, towers) {
    const towerCounts = towerTypeCounts(towers);
    if (reason.cause === "fast") {
      return [
        "下一局第 7 波前補寒冰塔，放在前段或中段低覆蓋路段。",
        "高速波前優先升級既有寒冰塔或加一座電磁塔補追擊。",
      ];
    }
    if (reason.cause === "shield") {
      return [
        "遇盾兵波前補毒霧塔，讓持續傷害穿盾咬本體。",
        "盾兵多時把毒霧塔放在路徑前段，後段用加農砲收尾。",
      ];
    }
    if (reason.cause === "durable") {
      return [
        "Boss 或高血波前升級主力加農砲，避免火力分散。",
        "補毒霧塔或聖光塔提高長時間輸出效率。",
      ];
    }
    if (reason.cause === "mute") {
      return [
        "把主力塔分散，不要讓緘口妖僧一次封住核心輸出。",
        "補引魂燈塔或寒冰塔拖慢牠靠近，再用弓箭塔與狙擊塔先點掉。",
      ];
    }
    if (reason.cause === "reflect") {
      return [
        "遇裂鏡童先用塔火力拆反射，不要把第一發隕石砸在牠身上。",
        "毒霧塔與電磁塔能用持續或多段輸出穩定破鏡。",
      ];
    }
    if (reason.cause === "aura") {
      return [
        "優先集火裂界守門人，解除周邊減傷光環。",
        "加農砲或墜星臼砲放在中段，利用範圍傷害連同護衛一起清掉。",
      ];
    }
    if (reason.cause === "counter") {
      return [
        "開波前先看克制警告，缺克制元素時優先補對應塔。",
        "把克制塔放在中段，讓敵人吃完整射程覆蓋。",
      ];
    }
    return [
      towerCounts.frost ? "下一局把主力塔往漏怪波段前一段集中，避免火力空窗。" : "下一局先補一座寒冰塔，讓尾段有時間收掉漏怪。",
      "波間使用塔陣顧問，優先處理覆蓋最低的路段或升級最高效率塔。",
    ];
  }

  function analyzeRunReport(input) {
    const ctx = input || {};
    const leaks = normalizeLeakStats(ctx.leaks || ctx.leakStats);
    const towers = Array.isArray(ctx.towers) ? ctx.towers : [];
    if (!leaks.total) {
      return {
        summary: "本局沒有明顯漏怪紀錄，主要瓶頸可能是總火力或女神血量。",
        adjustments: [
          "下一局維持前段輸出，波間優先升級最高效率塔。",
          "第 8 波後補一座控場塔，降低突發高速波風險。",
        ],
        totalLeaks: 0,
        topWave: null,
      };
    }
    const top = topLeakEntry(leaks);
    const reason = inferLeakReason(top, towers);
    return {
      summary: `第 ${top.wave} 波漏 ${top.count} 隻：${reason.text}。`,
      adjustments: runLearningAdjustments(reason, towers).slice(0, 2),
      totalLeaks: leaks.total,
      topWave: top.wave,
      reason: reason.cause,
    };
  }

  // 每波診斷只使用已記錄的戰況。漏怪原因是依敵種與現有塔陣推論，
  // 不把缺少的時間、傷害或敵人紀錄補成 0，也不假稱知道實際瞄準順序。
  function analyzeWaveReport(input) {
    const ctx = input && typeof input === "object" ? input : {};
    const wave = Math.max(0, Math.floor(safeNumber(ctx.wave, 0)));
    const telemetry = ctx.combatTelemetry && ctx.combatTelemetry.waves;
    const row = telemetry && hasOwn(telemetry, String(wave)) ? telemetry[wave] : null;
    const data = row && typeof row === "object" && !Array.isArray(row) ? row : null;
    const metric = (key) => data && isFiniteNumber(data[key]) && data[key] >= 0 ? data[key] : null;
    const damageBySource = {};
    for (const [key, value] of Object.entries(data && data.damageBySource && typeof data.damageBySource === "object" ? data.damageBySource : {})) {
      if (isSafeRecordKey(key) && isFiniteNumber(value) && value >= 0) damageBySource[key] = value;
    }
    const startedAt = data && data.startedAt;
    const endedAt = data && data.endedAt;
    const durationSeconds = isFiniteNumber(startedAt) && isFiniteNumber(endedAt) && endedAt >= startedAt ? endedAt - startedAt : null;
    const metrics = {
      kills: metric("kills"), leaks: metric("leaks"), goddessDamage: metric("goddessDamage"),
      durationSeconds, killGold: metric("killGold"), waveGold: metric("waveGold"),
      damageBySource, bossKills: metric("bossKills"), spawned: metric("spawned"), playerDamage: metric("playerDamage"),
    };
    const clear = data && safeNumber(ctx.clearedWave, 0) >= wave && wave > 0;
    const status = !data || !wave ? "no-data" : clear ? "clear" : ctx.over === true ? "lost" : "in-progress";
    const label = status === "no-data" ? "尚無戰況紀錄" : status === "lost" ? "防線失守" : status === "in-progress" ? "交戰中" : metrics.leaks === null ? "已守住，戰況缺記" : metrics.leaks === 0 ? "完整守住" : "已守住，需補漏口";
    const nextInput = Object.assign({}, ctx, { queue: ctx.nextPlan && ctx.nextPlan.queue || [] });
    const nextCounter = ctx.nextPlan && Array.isArray(ctx.nextPlan.queue) ? counterWarningForWave(nextInput) : null;
    const leaks = normalizeLeakStats(ctx.runLeaks || ctx.leaks || {});
    const leakEntry = leaks.byWave[wave];
    const topEnemy = leakEntry && topLeakEnemy(leakEntry);
    const towers = normalizeTowers(ctx.towers);
    const rawTowers = Array.isArray(ctx.towers) ? ctx.towers : [];
    let cause = null;
    if (metrics.leaks > 0 && topEnemy) {
      const inferred = inferLeakReason(leakEntry, rawTowers);
      cause = { id: inferred.cause, text: inferred.text, type: topEnemy.type, count: topEnemy.count, inferred: true };
    } else if (metrics.leaks > 0) {
      cause = { id: "unresolved", text: "漏怪種類未留紀錄，先檢查路徑尾段。", type: null, count: metrics.leaks, inferred: false };
    }
    const recommendations = [];
    const seen = new Set();
    const add = (suggestion) => {
      const key = `${suggestion.kind}:${suggestion.towerId || suggestion.title}`;
      if (!seen.has(key) && recommendations.length < 2) { seen.add(key); recommendations.push(suggestion); }
    };
    const towerAction = (towerId, detail) => {
      const def = cfg.TOWERS[towerId];
      if (!def) return;
      const existing = towers.filter((tower) => tower.type === towerId && tower.level < cfg.UPGRADE.maxLevel).sort((a, b) => b.level - a.level)[0];
      const kind = existing ? "upgrade" : "build";
      const cost = existing ? Math.round(def.cost * Math.pow(cfg.UPGRADE.costMul, existing.level)) : def.cost;
      const gold = isFiniteNumber(ctx.gold) ? Math.max(0, ctx.gold) : null;
      const missingGold = gold === null ? null : Math.max(0, Math.ceil(cost - gold));
      const title = existing ? `把${def.name}升到 Lv.${existing.level + 1}` : `補一座${def.name}`;
      add({ kind: missingGold > 0 ? "save" : kind, intendedKind: kind, towerId, title: missingGold > 0 ? `先存 ${missingGold} 金，再${title}` : title, detail, cost, missingGold, suggestSave: missingGold > 0 });
    };
    if (status !== "no-data") {
      if (cause) {
        const responseTower = { fast: "frost", shield: "poison", durable: "poison", mute: "sniper", reflect: "poison", aura: "mortar" }[cause.id];
        if (responseTower) towerAction(responseTower, cfg.ENEMIES[cause.type].counterHint);
        else if (cause.id === "counter") {
          const element = cfg.ENEMIES[cause.type].element;
          const counter = Object.keys(cfg.COUNTERS).find((key) => cfg.COUNTERS[key] === element);
          const type = Object.values(cfg.TOWERS).find((def) => def.element === counter && !def.support);
          if (type) towerAction(type.id, cfg.ENEMIES[cause.type].counterHint);
        }
        if (cause.id === "mute") add({ kind: "position", towerId: null, title: "把後續主力分到另一段", detail: "緘口妖僧只封住附近最近一座塔。下一座主力拉開位置，避免單點停火就留下空窗。", suggestSave: false });
        else add({ kind: "position", towerId: null, title: "檢查路尾的接力火力", detail: "點尾段的攻擊塔看射程圈；若敵人走過一段空白路，再補控場或收尾塔。", suggestSave: false });
      }
      if (nextCounter) towerAction(nextCounter.towerId, nextCounter.message);
      if (!recommendations.length) {
        const main = towers.filter((tower) => !cfg.TOWERS[tower.type].support && tower.level < cfg.UPGRADE.maxLevel)
          .sort((a, b) => towerDpsFor(b.type, b.level, ctx.affix) - towerDpsFor(a.type, a.level, ctx.affix))[0];
        if (main) towerAction(main.type, "先看下波敵人組成，再集中升級主力，避免把金幣散在太多低級塔。");
        else add({ kind: "focus", towerId: null, title: "先看下一波情報", detail: "依敵人元素、護盾與特殊能力選補強。沒有紀錄支持的漏怪原因，不直接下結論。", suggestSave: false });
      }
    }
    const summary = status === "no-data" ? "開戰後才會留下擊殺、收入與漏怪紀錄。"
      : status === "in-progress" ? `第 ${wave} 波仍在交戰，完成後再看防線是否需要補強。`
      : metrics.leaks === null ? `第 ${wave} 波的漏怪紀錄不完整，先保留目前塔陣。`
      : metrics.leaks === 0 ? `第 ${wave} 波沒有漏怪${metrics.bossKills > 0 ? `，擊倒 ${metrics.bossKills} 隻 Boss` : ""}。`
      : `第 ${wave} 波漏過 ${metrics.leaks} 隻${topEnemy ? `，其中${topEnemy.enemy.name} ${topEnemy.count} 隻` : ""}${metrics.goddessDamage === null ? "。" : `，女神受到 ${Math.round(metrics.goddessDamage)} 點傷害。`}`;
    return { wave, status, label, summary, metrics, cause, recommendations, nextCounter };
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

  function pointInPolygon(point, points) {
    if (!point || !Array.isArray(points) || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const a = points[j], b = points[i];
      if (distancePointToSegment(point.x, point.y, a, b) < 1e-8) return true;
      if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  function segmentsIntersect(a, b, c, d) {
    const cross = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const on = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-8 && r.x >= Math.min(p.x, q.x) - 1e-8 && r.x <= Math.max(p.x, q.x) + 1e-8 && r.y >= Math.min(p.y, q.y) - 1e-8 && r.y <= Math.max(p.y, q.y) + 1e-8;
    const v1 = cross(a, b, c), v2 = cross(a, b, d), v3 = cross(c, d, a), v4 = cross(c, d, b);
    return v1 * v2 < 0 && v3 * v4 < 0 || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
  }
  function rectCorners(rect) {
    return [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }];
  }
  function pointInRect(point, rect) { return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom; }
  function distancePointToRect(point, rect) { return Math.hypot(Math.max(rect.left - point.x, 0, point.x - rect.right), Math.max(rect.top - point.y, 0, point.y - rect.bottom)); }
  function distanceSegmentToRect(a, b, rect) {
    if (pointInRect(a, rect) || pointInRect(b, rect)) return 0;
    const corners = rectCorners(rect);
    let best = Math.min(distancePointToRect(a, rect), distancePointToRect(b, rect));
    for (let i = 0; i < 4; i++) {
      if (segmentsIntersect(a, b, corners[i], corners[(i + 1) % 4])) return 0;
      best = Math.min(best, distancePointToSegment(corners[i].x, corners[i].y, a, b));
    }
    return best;
  }
  function regionIntersectsRect(region, rect) {
    if (region.shape === "ellipse") {
      const rx = safeNumber(region.rx, 0), ry = safeNumber(region.ry, 0);
      if (!(rx > 0 && ry > 0)) return false;
      const x = Math.max(rect.left, Math.min(rect.right, region.x)), y = Math.max(rect.top, Math.min(rect.bottom, region.y));
      return ((x - region.x) / rx) ** 2 + ((y - region.y) / ry) ** 2 <= 1 + 1e-9;
    }
    const points = region.points;
    if (region.shape !== "polygon" || !Array.isArray(points) || points.length < 3) return false;
    // Most LOS samples are far from a region. Reject its bounding box before
    // the corner/edge tests; touching bounds still takes the exact old path.
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    for (const point of points) { left = Math.min(left,point.x); right = Math.max(right,point.x); top = Math.min(top,point.y); bottom = Math.max(bottom,point.y); }
    if (rect.right < left - 1e-8 || rect.left > right + 1e-8 || rect.bottom < top - 1e-8 || rect.top > bottom + 1e-8) return false;
    const corners = rectCorners(rect);
    if (corners.some((point) => pointInPolygon(point, points)) || points.some((point) => pointInRect(point, rect))) return true;
    for (let i = 0; i < points.length; i++) for (let j = 0; j < 4; j++) if (segmentsIntersect(points[i], points[(i + 1) % points.length], corners[j], corners[(j + 1) % 4])) return true;
    return false;
  }
  function corridorIntersectsRect(points, width, rect) {
    if (!Array.isArray(points)) return false;
    for (let i = 1; i < points.length; i++) if (distanceSegmentToRect(points[i - 1], points[i], rect) <= width / 2 + 1e-9) return true;
    return false;
  }
  function mapDefinition(input) {
    return typeof input === "string" ? hasOwn(cfg.MAPS, input) ? cfg.MAPS[input] : null : input && typeof input === "object" ? input : null;
  }
  function mapDefenseZone(mapInput, ratioInput) {
    const map = mapDefinition(mapInput), ratio = Math.max(0, Math.min(1, safeNumber(ratioInput, 0)));
    return map && (map.defenseNodes || []).find((node) => ratio >= node.from && (ratio < node.to || ratio === 1 && node.to === 1)) || null;
  }
  function mapWalkable(mapInput, x, y, radiusInput) {
    const map = mapDefinition(mapInput), radius = Math.max(0, safeNumber(radiusInput, 8));
    if (!map || !isFiniteNumber(x) || !isFiniteNumber(y) || x < radius || y < radius || x > 960 - radius || y > 640 - radius) return false;
    const footprint = { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius };
    let bridge;
    for (const region of map.regions || []) {
      if (region.id === "altar-base") continue;
      if (!regionIntersectsRect(region, footprint)) continue;
      if (region.type === "ruin") return false;
      if (bridge === undefined) bridge = (map.bridges || []).some((item) => distanceToPath(x,y,item.path) <= (item.width || 48) / 2 - radius * Math.SQRT2);
      if (!bridge) return false;
    }
    return true;
  }
  function lineWalkable(mapInput, from, to, radiusInput) {
    if (!from || !to || !isFiniteNumber(from.x) || !isFiniteNumber(from.y) || !isFiniteNumber(to.x) || !isFiniteNumber(to.y)) return false;
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 4));
    for (let index = 0; index <= steps; index++) {
      const k = index / steps;
      if (!mapWalkable(mapInput, from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, radiusInput)) return false;
    }
    return true;
  }
  const navigationCache = new WeakMap();
  function navigationHeap() {
    const items = [];
    const before = (a,b) => a.priority < b.priority || a.priority === b.priority && a.order < b.order;
    return {
      get length() { return items.length; },
      push(item) {
        let index = items.length; items.push(item);
        while (index > 0) { const parent = (index - 1) >> 1; if (!before(item,items[parent])) break; items[index] = items[parent]; index = parent; }
        items[index] = item;
      },
      pop() {
        const first = items[0], last = items.pop();
        if (items.length) {
          let index = 0;
          while (index * 2 + 1 < items.length) {
            let child = index * 2 + 1;
            if (child + 1 < items.length && before(items[child + 1],items[child])) child++;
            if (!before(items[child],last)) break;
            items[index] = items[child]; index = child;
          }
          items[index] = last;
        }
        return first;
      },
    };
  }
  function heroRoute(mapInput, start, goal, options) {
    const map = mapDefinition(mapInput), radius = Math.max(0, safeNumber(options && options.radius, 8)), cell = Math.max(12, Math.min(48, safeNumber(options && options.cellSize, 24)));
    const fail = (reason) => ({ reachable: false, points: [], reason });
    if (!map || !start || !goal || !mapWalkable(map, start.x, start.y, radius)) return fail("blocked-start");
    if (!mapWalkable(map, goal.x, goal.y, radius)) return fail("blocked-target");
    if (lineWalkable(map, start, goal, radius)) return { reachable: true, points: [{ x: goal.x, y: goal.y }], reason: null };
    const signature = JSON.stringify([map.path, map.regions, map.bridges, cell, radius]);
    let graph = navigationCache.get(map);
    if (!graph || graph.signature !== signature) {
      graph = { signature, nodes: [], byCell: new Map(), routes: new Map() };
      for (let cy = 0; cy * cell <= 640; cy++) for (let cx = 0; cx * cell <= 960; cx++) {
        const x = cx * cell, y = cy * cell;
        if (!mapWalkable(map, x, y, radius)) continue;
        const index = graph.nodes.length;
        graph.nodes.push({ x, y, cx, cy, index, edges: [] }); graph.byCell.set(`${cx},${cy}`, index);
      }
      for (const node of graph.nodes) for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]) {
        const index = graph.byCell.get(`${node.cx + dx},${node.cy + dy}`);
        if (index !== undefined && lineWalkable(map, node, graph.nodes[index], radius)) node.edges.push({ index, cost: cell * (dx && dy ? Math.SQRT2 : 1) });
      }
      navigationCache.set(map, graph);
    }
    const anchor = (point) => {
      const cx = Math.round(point.x / cell), cy = Math.round(point.y / cell), candidates = [];
      for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
        const index = graph.byCell.get(`${cx + dx},${cy + dy}`);
        if (index !== undefined) candidates.push(graph.nodes[index]);
      }
      candidates.sort((a,b) => (a.x-point.x)**2+(a.y-point.y)**2-(b.x-point.x)**2-(b.y-point.y)**2);
      return candidates.find((node) => lineWalkable(map,point,node,radius));
    };
    const first = anchor(start), last = anchor(goal);
    if (!first || !last) return fail("no-anchor");
    const key = `${first.index}:${last.index}`;
    let indices = graph.routes.get(key);
    if (!indices) {
      const open = navigationHeap(), scores = new Map([[first.index,0]]), previous = new Map(), closed = new Set(), orders = new Map([[first.index,0]]);
      let order = 1;
      const estimate = (index) => Math.hypot(graph.nodes[index].x-last.x,graph.nodes[index].y-last.y);
      const initialEstimate = estimate(first.index);
      open.push({ index: first.index, score: 0, priority: initialEstimate, order: 0 });
      let found = false;
      while (open.length) {
        const item = open.pop(), current = item.index;
        if (closed.has(current) || item.score !== scores.get(current)) continue;
        if (current === last.index) { found = true; break; }
        closed.add(current);
        for (const edge of graph.nodes[current].edges) {
          if (closed.has(edge.index)) continue;
          const score = scores.get(current) + edge.cost;
          if (!scores.has(edge.index) || score < scores.get(edge.index)) {
            scores.set(edge.index,score); previous.set(edge.index,current);
            if (!orders.has(edge.index)) orders.set(edge.index,order++);
            const heuristic = estimate(edge.index);
            open.push({ index: edge.index, score, priority: score + heuristic, order: orders.get(edge.index) });
          }
        }
      }
      if (!found) return fail("no-route");
      indices = [last.index];
      while (indices[0] !== first.index) indices.unshift(previous.get(indices[0]));
      if (graph.routes.size >= 512) graph.routes.delete(graph.routes.keys().next().value);
      graph.routes.set(key, indices);
    }
    const raw = indices.map((index) => ({ x: graph.nodes[index].x, y: graph.nodes[index].y })).concat({ x: goal.x, y: goal.y });
    const points = [];
    let current = start, next = 0;
    while (next < raw.length) {
      let furthest = next;
      // Test from the destination backwards and stop at the first visible
      // node; checking every already-visible prefix wasted long line samples.
      for (let index = raw.length - 1; index > next; index--) if (lineWalkable(map, current, raw[index], radius)) { furthest = index; break; }
      points.push(raw[furthest]); current = raw[furthest]; next = furthest + 1;
    }
    return { reachable: true, points, reason: null };
  }
  function mapBuildRestriction(mapInput, x, y, cellSize) {
    const map = mapDefinition(mapInput);
    const cell = Math.max(1, Math.floor(safeNumber(cellSize, cfg.GAME.cellSize)));
    if (!map || !isFiniteNumber(x) || !isFiniteNumber(y)) return { blocked: true, kind: "bounds", regionId: null, reason: "超出戰場" };
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    const rect = { left: cx * cell, right: (cx + 1) * cell, top: cy * cell, bottom: (cy + 1) * cell };
    if (rect.left < 0 || rect.top < 0 || rect.right > 960 || rect.bottom > 640) return { blocked: true, kind: "bounds", regionId: null, reason: "格位超出戰場" };
    for (const bridge of map.bridges || []) if (corridorIntersectsRect(bridge.path, bridge.width || 48, rect)) return { blocked: true, kind: "bridge", regionId: bridge.id, reason: `${bridge.label || "橋面"}不能建塔` };
    if (corridorIntersectsRect(map.path, map.roadWidth || cell * .8, rect)) return { blocked: true, kind: "path", regionId: null, reason: "敵人路線上不能建塔" };
    for (const region of map.regions || []) if (regionIntersectsRect(region, rect)) return { blocked: true, kind: region.type, regionId: region.id, reason: `${region.label || "地形"}不能建塔` };
    return { blocked: false, kind: null, regionId: null, reason: "" };
  }
  const mapBlockedCache = new WeakMap();
  function mapBlockedCells(mapInput, cellSize) {
    const cell = Math.max(1, Math.floor(safeNumber(cellSize, cfg.GAME.cellSize)));
    const map = mapDefinition(mapInput);
    const signature = map && JSON.stringify([cell, map.path, map.roadWidth, map.regions, map.bridges]);
    const cached = map && mapBlockedCache.get(map);
    if (cached && cached.signature === signature) return new Set(cached.cells);
    const blocked = new Set();
    for (let cy = 0; cy < Math.ceil(640 / cell); cy++) for (let cx = 0; cx < Math.ceil(960 / cell); cx++) if (mapBuildRestriction(mapInput, cx * cell + cell / 2, cy * cell + cell / 2, cell).blocked) blocked.add(`${cx},${cy}`);
    if (map) mapBlockedCache.set(map, { signature, cells: new Set(blocked) });
    return blocked;
  }
  function towerPathCoverage(mapInput, x, y, range) {
    const map = mapDefinition(mapInput);
    if (!map || !isFiniteNumber(x) || !isFiniteNumber(y) || !(range > 0)) return { length: 0, fraction: 0, segments: 0 };
    let covered = 0, segments = 0;
    for (let i = 1; i < map.path.length; i++) {
      const a = map.path[i - 1], b = map.path[i], dx = b.x - a.x, dy = b.y - a.y;
      const aa = dx * dx + dy * dy;
      if (aa <= 0) continue;
      const ox = a.x - x, oy = a.y - y, bb = 2 * (ox * dx + oy * dy), cc = ox * ox + oy * oy - range * range;
      const discriminant = bb * bb - 4 * aa * cc;
      if (discriminant < 0) continue;
      const start = Math.max(0, (-bb - Math.sqrt(discriminant)) / (2 * aa));
      const end = Math.min(1, (-bb + Math.sqrt(discriminant)) / (2 * aa));
      if (end > start) { covered += (end - start) * Math.sqrt(aa); segments++; }
    }
    return { length: covered, fraction: covered / Math.max(1, pathTotalLength(map.path)), segments };
  }
  function mapGeometryMetrics(mapInput, rangeInput) {
    const map = mapDefinition(mapInput), range = Math.max(0, safeNumber(rangeInput, 130)), cell = cfg.GAME.cellSize;
    if (!map) return null;
    let legalCells = 0, reachableCells = 0, max = { x: null, y: null, length: 0, fraction: 0, segments: 0 };
    for (let y = cell / 2; y < 640; y += cell) for (let x = cell / 2; x < 960; x += cell) {
      if (mapBuildRestriction(map, x, y, cell).blocked) continue;
      legalCells++;
      if (!canReachPath(x, y, map.path, range)) continue;
      reachableCells++;
      const coverage = towerPathCoverage(map, x, y, range);
      if (coverage.length > max.length) max = Object.assign({ x, y }, coverage);
    }
    return { mapId: map.id, length: pathTotalLength(map.path), range, legalCells, reachableCells, maxTowerCoverage: max,
      pads: (map.buildPads || []).map((pad) => ({ id: pad.id, x: pad.x, y: pad.y, blocked: mapBuildRestriction(map, pad.x, pad.y, cell).blocked, pathDistance: distanceToPath(pad.x, pad.y, map.path) })) };
  }

  function pathBlockedCells(path, cellSize, options) {
    const cell = Math.max(1, Math.floor(safeNumber(cellSize, cfg.GAME && cfg.GAME.cellSize || 48)));
    const step = Math.max(2, safeNumber(options && options.step, 10));
    const halfWidth = cell * safeNumber(options && options.pathHalfWidthCell, 0.4);
    const cells = new Set();
    if (!Array.isArray(path) || path.length < 2) return cells;
    const add = (x, y) => {
      cells.add(`${Math.floor(x / cell)},${Math.floor(y / cell)}`);
    };
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      if (!a || !b || !isFiniteNumber(a.x) || !isFiniteNumber(a.y) || !isFiniteNumber(b.x) || !isFiniteNumber(b.y)) continue;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
      for (let s = 0; s <= steps; s++) {
        const t = steps <= 0 ? 0 : s / steps;
        const x = a.x + (b.x - a.x) * t;
        const y = a.y + (b.y - a.y) * t;
        add(x, y);
        add(x - halfWidth, y);
        add(x + halfWidth, y);
        add(x, y - halfWidth);
        add(x, y + halfWidth);
      }
    }
    return cells;
  }

  return {
    META_VERSION,
    META_DEFAULT,
    migrateMeta,
    waveSoulReward,
    runSoulRewardTotal,
    settleRunRewards,
    settleHeroProgress,
    heroLongLevelFromXp,
    heroLongXpForLevel,
    heroPermanentBonus,
    selectMapAffix,
    normalizeRunSeed,
    affixExpectedBalance,
    recommendTowersForWave,
    ADVISOR_MODES,
    adviseTowerActions,
    counterWarningForWave,
    analyzeRunReport,
    analyzeWaveReport,
    protectMetaWrite,
    applyDifficulty,
    selectTowerMuteTarget,
    waveRngSeed,
    generateWaveQueue,
    towerPoisonDpsFor,
    updateBoard,
    evaluateAchievements,
    evaluateBeginnerMissions,
    distancePointToSegment,
    distanceToPath,
    canReachPath,
    mapBuildRestriction,
    mapBlockedCells,
    towerPathCoverage,
    mapGeometryMetrics,
    mapDefenseZone,
    mapWalkable,
    lineWalkable,
    heroRoute,
    pointInPolygon,
    regionIntersectsRect,
    pathTotalLength,
    pointAtPathRatio,
    pathBlockedCells,
  };
});
