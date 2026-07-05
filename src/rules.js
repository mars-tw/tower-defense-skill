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

  const META_VERSION = 6;
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
    heroProgress: {},
    lastMap: "plains",
  };
  const SOUL_REWARD_MUL_BY_DIFF = { normal: 1.8, brutal: 2.4, endless: 2.2 };
  const HERO_LONG_XP_RATE = 0.2;
  const HERO_LONG_XP_PER_LEVEL = 24;
  const HERO_LONG_MAX_LEVEL = 15;
  const HERO_LONG_BONUS_EVERY = 5;
  const HERO_LONG_BONUS_STEP = 0.05;
  const HERO_LONG_BONUS_CAP = 0.15;

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
    meta.heroProgress = sanitizeHeroProgress(meta.heroProgress);
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

  function generateWaveQueue(wave, difficulty, rng, affixInput) {
    const w = Math.max(1, Math.floor(safeNumber(wave, 1)));
    const diff = normalizeDifficulty(difficulty);
    const affix = normalizeAffix(affixInput);
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

    const affixHpMul = affix ? safeNumber(affix.enemyHpMul, 1) : 1;
    const eventHpScale = hpScale * (event ? event.hpMul : 1) * affixHpMul;
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
      queue.push({ type, hpScale: eventHpScale, event, affix: affix ? affix.id : null });
    }

    if (isBoss) queue.push({ type: "boss", hpScale: hpScale * (cfg.GAME.bossHpMul || 1.0) * affixHpMul, affix: affix ? affix.id : null });
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
    if (towerId === "support") return "主力塔成形後增傷，放在核心火力區。";
    return "便宜高攻速，適合補刀與觸發閃避後追擊。";
  }

  function recommendTowersForWave(input) {
    const counts = countWaveEnemies(input);
    const facts = { physical: 0, fire: 0, ice: 0, thunder: 0, shield: 0, healer: 0, fast: 0, highHp: 0, boss: 0, split: 0, total: 0 };
    for (const [type, count] of Object.entries(counts)) {
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
    }

    const recommendations = [];
    for (const tower of Object.values(cfg.TOWERS || {})) {
      if (!tower || !tower.id) continue;
      let score = tower.support ? 0 : 0.2;
      for (const [type, count] of Object.entries(counts)) {
        const enemy = cfg.ENEMIES[type];
        if (!enemy) continue;
        const n = Math.max(0, Math.floor(safeNumber(count, 0)));
        const mul = cfg.elementMultiplier ? cfg.elementMultiplier(tower.element, enemy.element) : 1;
        score += n * mul;
        if (cfg.COUNTERS && cfg.COUNTERS[tower.element] === enemy.element) score += n * 0.8;
        if (tower.id === "arrow" && (enemy.element === "physical" || (enemy.ability && enemy.ability.id === "dodgeFirst"))) score += n * 0.35;
        if (tower.id === "cannon" && (enemy.shield || enemy.healRadius || (enemy.ability && enemy.ability.id === "splitBat"))) score += n * 0.7;
        if (tower.id === "frost" && (enemy.speed >= 80 || (enemy.ability && enemy.ability.id === "bloodrage"))) score += n * 0.85;
        if (tower.id === "tesla" && (enemy.shield || enemy.healRadius || (enemy.ability && enemy.ability.id === "splitBat"))) score += n * 0.65;
        if (tower.id === "poison" && (enemy.shield || enemy.hp >= 100 || enemy.boss)) score += n * 1.05;
      }
      if (tower.id === "support") {
        score += facts.total >= 12 ? 4 : 0;
        score += facts.boss ? 3 : 0;
        score += facts.highHp >= 2 ? 1.5 : 0;
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
    settleHeroProgress,
    heroLongLevelFromXp,
    heroLongXpForLevel,
    heroPermanentBonus,
    selectMapAffix,
    affixExpectedBalance,
    recommendTowersForWave,
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
