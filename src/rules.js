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

  function hasInvalidMetaWriteShape(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return true;
    for (const key of META_NUMERIC_KEYS) {
      if (hasOwn(candidate, key) && !isFiniteNumber(candidate[key])) return true;
    }
    const objectKeys = ["bestByDiff", "board", "achievements", "beginnerMissions", "heroProgress"];
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
    if (roll < 0.91) return wave >= 6 ? "frostwraith" : "frostwolf";
    if (roll < 0.95) return wave >= 7 ? "medic" : "bat";
    if (roll < 0.98) return wave >= 8 ? "thunderronin" : "frostwolf";
    return "orc";
  }

  function enemyAvailableInWave(type, wave) {
    if (type === "shieldman") return wave >= 5;
    if (type === "frostwraith") return wave >= 6;
    if (type === "medic") return wave >= 7;
    if (type === "thunderronin") return wave >= 8;
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

  function waveFactsFromCounts(counts) {
    const facts = { physical: 0, fire: 0, ice: 0, thunder: 0, shield: 0, healer: 0, fast: 0, highHp: 0, boss: 0, split: 0, total: 0 };
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
    if (tower.poisonDps) dps += tower.poisonDps * Math.min(2.2, tower.poisonDuration || 1) * 0.7;
    return dps;
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
    let best = null;
    for (let cy = 0; cy < Math.ceil(height / cell); cy++) {
      for (let cx = 0; cx < Math.ceil(width / cell); cx++) {
        if (occupied.has(`${cx},${cy}`)) continue;
        const x = cx * cell + cell / 2;
        const y = cy * cell + cell / 2;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const pathDist = distanceToPath(x, y, path);
        if (pathDist < cell * 0.58 || pathDist > range) continue;
        const targetDist = Math.hypot(x - weak.point.x, y - weak.point.y);
        const score = targetDist + Math.abs(pathDist - range * 0.58) * 0.25;
        if (!best || score < best.score) {
          best = { cx, cy, x: Math.round(x), y: Math.round(y), zone: zoneLabel(weak.ratio), score, pathDistance: Math.round(pathDist) };
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
      for (const [type, nRaw] of Object.entries(rawTypes)) {
        if (!isSafeRecordKey(type) || !hasOwn(cfg.ENEMIES, type)) continue;
        const n = Math.max(0, Math.floor(safeNumber(nRaw, 0)));
        if (n <= 0) continue;
        byType[type] = n;
        if (!count) count += n;
      }
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
    ADVISOR_MODES,
    adviseTowerActions,
    counterWarningForWave,
    analyzeRunReport,
    protectMetaWrite,
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
