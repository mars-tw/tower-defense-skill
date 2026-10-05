/* 每局戰役任務。輸入戰場快照，輸出進度與單次獎勵；不操作 UI 或存檔。 */
(function (root, factory) {
  const exported = factory(typeof module !== "undefined" && module.exports ? require("./config.js") : root);
  if (typeof window !== "undefined") window.TDOperations = exported;
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this, function (cfg) {
  "use strict";
  const VERSION = 1;
  const MAX_WAVE = 10000;
  const own = (value, key) => !!value && Object.prototype.hasOwnProperty.call(value, key);
  const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const finite = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const count = (value, max = MAX_WAVE) => Math.max(0, Math.min(max, Math.floor(finite(value))));
  const seed = (value) => (Math.floor(finite(value, 1)) >>> 0) || 1;
  const safeId = (value, choices, fallback) => typeof value === "string" && own(choices, value) ? value : fallback;

  function runIdentity(context) {
    const ctx = record(context);
    const difficulty = typeof ctx.difficulty === "string" ? ctx.difficulty : record(ctx.difficulty).id;
    const mapId = safeId(ctx.mapId, cfg.MAPS, "plains");
    const difficultyId = safeId(ctx.difficultyId || difficulty, cfg.DIFFICULTIES, "normal");
    return {
      runKey: `op1-${seed(ctx.runSeed)}-${seed(ctx.affixSeed)}-${mapId}-${difficultyId}`,
      runSeed: seed(ctx.runSeed), affixSeed: seed(ctx.affixSeed), mapId, difficultyId,
    };
  }

  function flags(value) {
    const clean = {};
    for (const [id, done] of Object.entries(record(value))) {
      if (/^chapter-[1-9][0-9]{0,3}-(clear|tactic)$/.test(id) && done === true) clean[id] = true;
    }
    return clean;
  }

  function createOperations(context, saved) {
    const identity = runIdentity(context);
    const previous = record(saved);
    const compatible = previous.version === VERSION && previous.runKey === identity.runKey;
    return Object.assign({}, identity, {
      version: VERSION,
      claimed: compatible ? flags(previous.claimed) : {},
      skipped: compatible ? flags(previous.skipped) : {},
      observedWave: compatible ? count(previous.observedWave) : 0,
    });
  }

  function serializeOperations(state) {
    const source = record(state);
    return {
      version: VERSION, runKey: source.runKey,
      claimed: flags(source.claimed), skipped: flags(source.skipped), observedWave: count(source.observedWave),
    };
  }

  function stageDefinition(index, identity) {
    const intro = cfg.OPERATIONS.chapters;
    const base = intro[index] || {
      endWave: 40 + (index - intro.length + 1) * 5,
      title: "無盡守望", goal: "", hint: "每 5 波接下一段守望。照下波情報調整，戰術沒完成也能繼續守。",
      gold: Math.min(600, Math.round(263 * Math.pow(1.4, Math.min(8, index - intro.length + 1)))),
      soul: 3, tactics: ["anchor", "elements", "support", "spread", "spell", "clean"],
    };
    const number = index + 1;
    const startWave = index === 0 ? 1 : (intro[index - 1] ? intro[index - 1].endWave : 40 + (index - intro.length) * 5) + 1;
    // 不消耗波次 RNG。相同戰場種子與章節永遠抽到同一張戰術卡。
    let roll = (identity.runSeed ^ Math.imul(identity.affixSeed, 2246822519) ^ Math.imul(number, 3266489917)) >>> 0;
    roll ^= roll >>> 16;
    roll = Math.imul(roll, 2246822519) >>> 0;
    roll ^= roll >>> 13;
    const tacticId = base.tactics[(roll >>> 0) % base.tactics.length];
    const tactic = Object.assign({ id: tacticId }, cfg.OPERATIONS.tactics[tacticId]);
    if (tacticId === "anchor") tactic.target = Math.min(cfg.UPGRADE.maxLevel, 2 + Math.floor(Math.max(0, base.endWave - 10) / 10));
    if (tacticId === "elements") tactic.target = base.endWave >= 20 ? 3 : 2;
    if (tacticId === "spell") tactic.target = Math.min(800, 80 + Math.floor(Math.max(0, base.endWave - 10) / 5) * 40);
    if (tacticId === "anchor") tactic.desc = `讓一座攻擊塔達到 Lv.${tactic.target}`;
    if (tacticId === "elements") tactic.desc = `同時保有 ${tactic.target} 種元素的攻擊塔`;
    if (tacticId === "spell") tactic.desc = `本章以技能打出 ${tactic.target} 點有效傷害`;
    return {
      number, startWave, endWave: base.endWave,
      title: base.title, goal: base.goal || `清掉第 ${base.endWave} 波`, hint: base.hint,
      gold: base.gold, soul: base.soul, tactic,
      tacticGold: Math.min(120, 12 + index * 4), tacticSoul: index >= 2 ? 1 : 0,
      mainId: `chapter-${number}-clear`, tacticClaimId: `chapter-${number}-tactic`,
    };
  }

  function chapterFor(context) {
    const cleared = count(record(context).clearedWave);
    const intro = cfg.OPERATIONS.chapters;
    const index = intro.findIndex((chapter) => cleared < chapter.endWave);
    const current = index >= 0 ? index : intro.length + Math.floor(Math.max(0, cleared - 40) / 5);
    return stageDefinition(current, runIdentity(context));
  }

  function combatRows(context, chapter) {
    const ctx = record(context);
    const waves = record(record(ctx.combatTelemetry).waves);
    const rows = [];
    for (let wave = chapter.startWave; wave <= Math.min(chapter.endWave, count(ctx.wave)); wave++) {
      if (own(waves, String(wave))) rows.push({ wave, row: record(waves[wave]) });
    }
    return rows;
  }

  function metricValue(tactic, context, chapter) {
    const ctx = record(context);
    const towers = (Array.isArray(ctx.towers) ? ctx.towers : []).filter((tower) => tower && own(cfg.TOWERS, tower.type));
    const attacks = towers.filter((tower) => !cfg.TOWERS[tower.type].support && finite(cfg.TOWERS[tower.type].damage) > 0);
    const level = (tower) => Math.max(1, count(tower.level, cfg.UPGRADE.maxLevel));
    switch (tactic.metric) {
      case "attackKinds": return new Set(attacks.map((tower) => tower.type)).size;
      case "highestAttackLevel": return attacks.reduce((highest, tower) => Math.max(highest, level(tower)), 0);
      case "attackElements": return new Set(attacks.map((tower) => cfg.TOWERS[tower.type].element)).size;
      case "skillDamage": return Math.floor(combatRows(ctx, chapter).reduce((sum, entry) => sum + Math.max(0, finite(record(entry.row.damageBySource).skill)), 0));
      case "cleanWaves": {
        const cleared = count(ctx.clearedWave);
        return combatRows(ctx, chapter).filter((entry) => entry.wave <= cleared && finite(entry.row.endedAt, -1) >= 0 && entry.row.leaks === 0).length;
      }
      case "supportedAttackTowers": {
        let most = 0;
        for (const support of towers.filter((tower) => tower.type === "support")) {
          if (!Number.isFinite(support.x) || !Number.isFinite(support.y)) continue;
          const range = cfg.TOWERS.support.range * Math.pow(cfg.UPGRADE.rangeMul, level(support) - 1) * Math.max(0, finite(record(ctx.affix).towerRangeMul, 1));
          const reached = attacks.filter((tower) => Number.isFinite(tower.x) && Number.isFinite(tower.y) && Math.hypot(tower.x - support.x, tower.y - support.y) <= range).length;
          most = Math.max(most, reached);
        }
        return most;
      }
      case "spreadUpgradedTowers": {
        const main = attacks.filter((tower) => level(tower) >= 2 && Number.isFinite(tower.x) && Number.isFinite(tower.y));
        for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) {
          if (Math.hypot(main[i].x - main[j].x, main[i].y - main[j].y) >= cfg.GAME.cellSize * 3) return 2;
        }
        return main.length > 0 ? 1 : 0;
      }
      default: return 0;
    }
  }

  function evaluateOperations(previous, context) {
    const ctx = record(context);
    const state = createOperations(ctx, previous);
    const cleared = count(ctx.clearedWave);
    const wave = count(ctx.wave);
    const current = chapterFor(ctx);
    const awards = [];
    const award = (id, label, gold, soul, chapter, kind) => {
      if (own(state.claimed, id)) return;
      state.claimed[id] = true;
      awards.push({ id, label, gold, soul, chapter: chapter.number, kind });
    };
    for (let index = 0; index < current.number; index++) {
      const chapter = stageDefinition(index, state);
      if (cleared >= chapter.endWave) award(chapter.mainId, `${chapter.title}完成`, chapter.gold, chapter.soul, chapter, "chapter");
      if (own(state.claimed, chapter.tacticClaimId) || own(state.skipped, chapter.tacticClaimId)) continue;
      if (cleared > chapter.endWave || state.observedWave > chapter.endWave || wave > chapter.endWave) {
        state.skipped[chapter.tacticClaimId] = true;
        continue;
      }
      const started = Math.max(wave, cleared + 1) >= chapter.startWave;
      if (started && !ctx.over && metricValue(chapter.tactic, ctx, chapter) >= chapter.tactic.target) {
        award(chapter.tacticClaimId, chapter.tactic.label, chapter.tacticGold, chapter.tacticSoul, chapter, "tactic");
      } else if (cleared >= chapter.endWave || ctx.over) {
        state.skipped[chapter.tacticClaimId] = true;
      }
    }
    state.observedWave = Math.max(state.observedWave, wave, cleared);
    const tacticProgress = Math.min(current.tactic.target, metricValue(current.tactic, ctx, current));
    const rows = [
      { id: current.mainId, kind: "chapter", label: current.title, desc: current.goal,
        progress: Math.max(0, Math.min(current.endWave - current.startWave + 1, cleared - current.startWave + 1)),
        target: current.endWave - current.startWave + 1, unit: "波", gold: current.gold, soul: current.soul,
        status: own(state.claimed, current.mainId) ? "claimed" : ctx.over ? "missed" : "active", hint: current.hint },
      { id: current.tacticClaimId, kind: "tactic", label: current.tactic.label, desc: current.tactic.desc,
        progress: own(state.claimed, current.tacticClaimId) ? current.tactic.target : tacticProgress,
        target: current.tactic.target, unit: current.tactic.unit, gold: current.tacticGold, soul: current.tacticSoul,
        status: own(state.claimed, current.tacticClaimId) ? "claimed" : own(state.skipped, current.tacticClaimId) ? "missed" : "active",
        hint: current.tactic.hint },
    ];
    return {
      state, awards, rows, chapter: current,
      summary: { claimed: Object.keys(state.claimed).length, skipped: Object.keys(state.skipped).length, completedChapters: Object.keys(state.claimed).filter((id) => id.endsWith("-clear")).length },
      gold: awards.reduce((sum, item) => sum + item.gold, 0), soul: awards.reduce((sum, item) => sum + item.soul, 0),
    };
  }

  return { VERSION, runIdentity, createOperations, serializeOperations, chapterFor, evaluateOperations, metricValue };
});
