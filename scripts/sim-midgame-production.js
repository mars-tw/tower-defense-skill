#!/usr/bin/env node
"use strict";
/* R79: actual production update in Node VM. Canvas/RAF are stubbed and cannot
 * prove raster cost or player experience. All enemies come from real startWave;
 * all purchases, hero deployment, skills, income and leaks use shipped functions.
 * Explicit profiles isolate operations and a free common Knight. No old R77
 * constants, fake gold, fake towers or enemy HP overrides are used.
 */
const fs = require("node:fs"), path = require("node:path");
const { productionHarness, ROOT } = require("./lib/production-harness.js");
const DT = 1 / 60;
const SEEDS = [104729, 130363, 155921, 181081, 206369, 232003];
const PROFILES = { "tower-only": { operations: false, knight: false }, "operations": { operations: true, knight: false }, "operations-knight": { operations: true, knight: true } };
const opts = { seedCount: 3, waves: 40, skills: true, difficulty: "normal", sourceDir: path.join(ROOT, "src"), out: path.join(ROOT, "docs/evidence/R79/midgame"), profiles: Object.keys(PROFILES), maps: ["plains", "canyon", "lava"] };
for (const arg of process.argv.slice(2)) {
  const [key, value] = arg.replace(/^--/, "").split("=");
  if (key === "seed-count") opts.seedCount = Math.max(1, Math.min(SEEDS.length, Number(value) || 1));
  else if (key === "waves") opts.waves = Math.max(10, Math.min(50, Number(value) || 40));
  else if (key === "profiles") opts.profiles = value.split(",");
  else if (key === "maps") opts.maps = value.split(",");
  else if (key === "skills") opts.skills = value !== "off";
  else if (key === "difficulty") opts.difficulty = value;
  else if (key === "source-dir") opts.sourceDir = path.resolve(ROOT, value);
  else if (key === "out") opts.out = path.resolve(ROOT, value);
  else throw new Error(`Unknown argument ${arg}`);
}
const harness = productionHarness(opts.sourceDir);
const { TD, rules, operations } = harness;
const cfg = TD.config;
if (!Object.prototype.hasOwnProperty.call(cfg.DIFFICULTIES, opts.difficulty)) throw new Error(`Invalid difficulty ${opts.difficulty}`);
const round = (value) => Math.round(value * 100) / 100;
const report = { method: "Production game.js via Node VM TD.debug.stepSimulation at 60 Hz; Canvas/RAF stubbed; no UI; real wave spawning, purchases, damage, income and leaks", sourceFiles: harness.sources,
  assumptions: { difficulty: opts.difficulty, reducedEffects: true, storage: "all operation writes succeed; storage fault coverage is separate", operationPollingSeconds: 8 / 60, hero: "operations-knight has exactly one free common knight; no meta bonus or purchased hero", skills: opts.skills ? "all profiles use the same cluster-targeted skill policy" : "all active skills disabled for this sensitivity profile", strategy: "adaptive path coverage plus reinvestment; reads public next-wave elemental queue; searches all legal cells using complete path coverage; ideal strategy, not a human-player difficulty gate" }, runs: [] };

function run(map, profile, runSeed, affixSeed) {
  const options = PROFILES[profile];
  if (!options || !Object.prototype.hasOwnProperty.call(cfg.MAPS, map)) throw new Error(`Invalid profile/map ${profile}/${map}`);
  harness.seed(runSeed ^ Math.imul(affixSeed, 2654435761));
  TD.setDifficulty(opts.difficulty); TD.setMap(map); TD.newGame({ runSeed, affixSeed });
  const st = TD.state();
  st.paused = true;
  const actions = [], awards = [], waves = [];
  let operationState = operations.createOperations({ ...st, difficultyId: opts.difficulty });
  let operationGold = 0, operationSoul = 0;
  function evaluateOperations() {
    if (!options.operations) return;
    const result = operations.evaluateOperations(operationState, { ...st, difficultyId: opts.difficulty });
    operationState = result.state;
    st.gold += result.gold; operationGold += result.gold; operationSoul += result.soul;
    for (const award of result.awards) awards.push({ atWave: st.wave, clock: round(st.clock), ...award });
  }
  const samples = [];
  for (let index = 1; index < st.path.length; index++) {
    const a = st.path[index - 1], b = st.path[index], distance = Math.hypot(b.x - a.x, b.y - a.y), count = Math.max(1, Math.ceil(distance / 75));
    for (let part = 0; part < count; part++) samples.push({ x: a.x + (b.x - a.x) * (part + .5) / count, y: a.y + (b.y - a.y) * (part + .5) / count });
  }
  function locationFor(type) {
    const support = cfg.TOWERS[type].support;
    const candidates = [];
    for (let cy = 0; cy * cfg.GAME.cellSize < 640; cy++) for (let cx = 0; cx * cfg.GAME.cellSize < 960; cx++) {
      const x = (cx + .5) * cfg.GAME.cellSize, y = (cy + .5) * cfg.GAME.cellSize;
      if (rules.mapBuildRestriction && rules.mapBuildRestriction(st.mapDef || cfg.MAPS[map],x,y,cfg.GAME.cellSize).blocked) continue;
      // Preview the selected type through the production predicate, including
      // path blocking, min-range, scene bounds, affix range and available gold.
      TD.selectTower(type);
      const checked = TD.buildPreviewAt(x, y);
      if (!checked.ok) continue;
      const range = cfg.TOWERS[type].range * (st.affix && st.affix.towerRangeMul || 1);
      let score = 0;
      if (support) {
        for (const tower of st.towers) if (!cfg.TOWERS[tower.type].support && Math.hypot(tower.x - x, tower.y - y) <= range) score += TD.effectiveTowerDamage(tower) * TD.towerStat(tower, "fireRate");
      } else {
        for (const point of samples) {
          const distance = Math.hypot(point.x - x, point.y - y);
          if (distance > range || distance < (cfg.TOWERS[type].minRange || 0)) continue;
          let current = 0;
          for (const tower of st.towers) if (!cfg.TOWERS[tower.type].support && Math.hypot(tower.x - point.x, tower.y - point.y) <= TD.towerStat(tower, "range")) current += TD.effectiveTowerDamage(tower) * TD.towerStat(tower, "fireRate");
          score += 1 / Math.pow(1 + current, .36);
        }
      }
      candidates.push({ x, y, score });
    }
    st.selectedTowerType = null;
    return candidates.sort((a, b) => b.score - a.score || a.y - b.y || a.x - b.x)[0];
  }
  function build(type, phase) {
    if (st.gold < cfg.TOWERS[type].cost) return false;
    const location = locationFor(type);
    if (!location) return false;
    const before = st.gold;
    const ok = TD.buildTowerAt(type, location.x, location.y);
    if (ok) { actions.push({ phase, kind: "build", type, spent: before - st.gold, x: location.x, y: location.y }); evaluateOperations(); }
    return ok;
  }
  for (const type of ["arrow", "frost", "cannon"]) build(type, "initial");
  if (options.knight) { TD.deployHero("knight"); actions.push({ phase: "initial", kind: "deploy", hero: "knight", cost: 0 }); }
  evaluateOperations();

  function reinvest(wave) {
    const healthRatio = st.goddess.hp / st.goddess.maxHp;
    if (healthRatio < .60 && st.goddess.level < cfg.GODDESS.maxLevel && st.gold >= TD.goddessUpgradeCost()) {
      const before = st.gold; TD.upgradeGoddess(); actions.push({ phase: wave, kind: "goddess", level: st.goddess.level, spent: before - st.gold });
    }
    const desired = wave < 5 ? ["arrow", "frost", "cannon"] : wave < 10 ? ["arrow", "frost", "cannon", "poison", "tesla"] : ["arrow", "frost", "cannon", "poison", "tesla", "mortar", "arcane", "sniper"];
    for (const type of desired) if (!st.towers.some((tower) => tower.type === type)) build(type, wave);
    if (wave >= 9 && !st.towers.some((tower) => tower.type === "support")) build("support", wave);
    const preview = TD.previewNextWave();
    const counts = {};
    for (const spec of preview.queue) counts[cfg.ENEMIES[spec.type].element] = (counts[cfg.ENEMIES[spec.type].element] || 0) + 1;
    const all = preview.queue.length || 1;
    for (let purchase = 0; purchase < 18; purchase++) {
      const upgrades = st.towers.filter((tower) => tower.level < cfg.UPGRADE.maxLevel && st.gold >= TD.upgradeCost(tower)).map((tower) => {
        const def = cfg.TOWERS[tower.type];
        const cost = TD.upgradeCost(tower);
        const effect = def.support ? TD.supportDpsGain(tower) * .15 : TD.effectiveTowerDamage(tower) * TD.towerStat(tower, "fireRate") * (cfg.UPGRADE.damageMul - 1);
        const counter = Object.entries(counts).reduce((sum, [element, count]) => sum + count * harness.context.elementMultiplier(def.element, element), 0) / all;
        const multi = def.splash ? 2.2 : def.pierce ? 1.9 : def.poisonDps ? 1.5 : def.slow ? 1.6 : 1;
        return { tower, cost, score: effect * multi * counter / cost };
      }).sort((a, b) => b.score - a.score);
      const selected = upgrades[0];
      if (!selected || selected.score <= 0) break;
      st.selectedTower = selected.tower; const before = st.gold; TD.upgradeSelected();
      if (before === st.gold) break;
      actions.push({ phase: wave, kind: "upgrade", type: selected.tower.type, level: selected.tower.level, spent: before - st.gold }); evaluateOperations();
    }
    st.selectedTower = null;
  }
  for (let wave = 1; wave <= opts.waves && !st.over; wave++) {
    reinvest(wave);
    const goldStart = st.gold, operationStart = operationGold;
    if (TD.startWave() === false) throw new Error(`Could not start ${map}/${profile}/${wave}`);
    // Paused only prevents native RAF; stepSimulation invokes production update.
    st.paused = true;
    let steps = 0, nextSkillAt = st.clock + 4;
    while (!st.betweenWaves && !st.over && steps < 60 * 180) {
      if (opts.skills && st.clock >= nextSkillAt) {
        const enemies = st.enemies.filter((enemy) => !enemy._dead && !enemy._leaked);
        if (enemies.length >= 4 || enemies.some((enemy) => enemy.boss)) {
          for (const skillId of ["freeze", "meteor", "thunder", "judgment", "sealarray"]) {
            if (st.skillCooldowns[skillId] > 0 || !enemies.length) continue;
            const radius = cfg.SKILLS[skillId].radius;
            let target = enemies[0], best = -1;
            for (const enemy of enemies) {
              let hits = 0; for (const other of enemies) if (Math.hypot(other.x - enemy.x, other.y - enemy.y) <= radius) hits++;
              if (hits > best) { best = hits; target = enemy; }
            }
            if (TD.debug.castSkill(skillId, target.x, target.y)) actions.push({ phase: wave, kind: "skill", skillId, clock: round(st.clock) });
            evaluateOperations();
          }
        }
        nextSkillAt = st.clock + 5;
      }
      TD.debug.stepSimulation(DT); steps++;
      if (steps % 8 === 0) evaluateOperations();
    }
    if (!st.betweenWaves && !st.over) throw new Error(`Wave timeout ${map}/${profile}/${wave}`);
    evaluateOperations();
    const data = st.combatTelemetry.waves[wave];
    const nextPlan = st.over ? null : TD.previewNextWave();
    const waveReport = rules.analyzeWaveReport ? rules.analyzeWaveReport({ ...st, nextPlan }) : null;
    waves.push({ wave, clear: !st.over, leaks: data.leaks, goddessDamage: data.goddessDamage, goddessHp: st.goddess.hp, goddessLevel: st.goddess.level,
      kills: data.kills, damage: round(data.playerDamage), damageBySource: data.damageBySource, duration: data.endedAt == null ? null : round(data.endedAt - data.startedAt),
      killGold: data.killGold, waveGold: data.waveGold, operationGold: operationGold - operationStart, goldStart, goldEnd: st.gold, towers: st.towers.map((tower) => ({ type: tower.type, level: tower.level })), waveReport });
  }
  const investments = Array.from({ length: st.wave }, (_, index) => ({ wave: index + 1, spent: actions.filter((action) => action.phase === index + 1 || index === 0 && action.phase === "initial").reduce((sum, action) => sum + (action.spent || 0), 0) }));
  const operationCounts = { towersBuilt: st.towersBuilt, towerUpgrades: st.towerUpgrades, skillCasts: st.skillCasts, goddessUpgrades: actions.filter((action) => action.kind === "goddess").length,
    totalInvestment: investments.reduce((sum, item) => sum + item.spent, 0), maxWaveInvestment: investments.reduce((max, item) => item.spent > max.spent ? item : max, { wave: 0, spent: 0 }) };
  return { map, difficulty: opts.difficulty, profile, runSeed, affixSeed, affix: st.affix && st.affix.id, clearedWave: st.clearedWave, reachedWave: st.wave, finalHp: st.goddess.hp, operationGold, operationSoul, operationCounts, investments, operationClaims: Object.keys(operationState.claimed), operationSkipped: Object.keys(operationState.skipped), actions, waves };
}

for (const map of opts.maps) for (const profile of opts.profiles) for (let index = 0; index < opts.seedCount; index++) {
  const result = run(map, profile, SEEDS[index], SEEDS[(index * 2 + 3) % SEEDS.length]);
  report.runs.push(result);
  console.log(`${map}/${profile}/seed${result.runSeed}: cleared ${result.clearedWave}, reached ${result.reachedWave}, hp ${result.finalHp}, op ${result.operationGold} gold / ${result.operationSoul} soul`);
}
report.summary = [];
for (const map of opts.maps) for (const profile of opts.profiles) {
  const runs = report.runs.filter((run) => run.map === map && run.profile === profile);
  report.summary.push({ map, profile, runs: runs.length, minCleared: Math.min(...runs.map((run) => run.clearedWave)), maxCleared: Math.max(...runs.map((run) => run.clearedWave)),
    clear20: runs.filter((run) => run.clearedWave >= 20).length, clear30: runs.filter((run) => run.clearedWave >= 30).length, clear40: runs.filter((run) => run.clearedWave >= 40).length,
    averageOperationGold: round(runs.reduce((sum, run) => sum + run.operationGold, 0) / runs.length), averageOperationSoul: round(runs.reduce((sum, run) => sum + run.operationSoul, 0) / runs.length) });
}
fs.mkdirSync(opts.out, { recursive: true });
fs.writeFileSync(path.join(opts.out, "production-midgame.json"), JSON.stringify(report, null, 2));
console.table(report.summary);
