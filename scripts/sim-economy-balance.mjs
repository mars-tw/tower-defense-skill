#!/usr/bin/env node

/**
 * R77 deterministic economy/combat simulation.
 *
 * This is not a parallel combat model. Chromium loads the shipped game and this
 * script advances TD.debug.stepSimulation(), which calls the production update
 * loop (spawning, targeting, projectiles, elements, statuses, kills, combo gold,
 * leaks and wave-clear rewards). The only added game hook skips rendering.
 */

import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const nodeConfig = require(join(ROOT, "src", "config.js"));
const nodeRules = require(join(ROOT, "src", "rules.js"));
const DEFAULT_OUT_DIR = join(ROOT, "docs", "evidence", "r77");
const FIXED_SEEDS = Object.freeze([
  104729, 130363, 155921, 181081, 206369, 232003,
  257371, 283051, 308713, 334363, 360007, 385621,
  411233, 436853, 462493, 488117, 513739, 539389,
  565019, 590641, 616289, 641909, 667531, 693173,
]);
const STRATEGIES = Object.freeze(["playtest", "boss-ready", "no-reinvest", "all-arrow"]);
const DT = 1 / 60;
const MAX_STEPS_PER_WAVE = 60 * 150;

// Both profiles are explicit so the committed script can always reproduce the
// R76 baseline after production constants move on. R77 values are updated here
// together with src/config.js once the baseline identifies the smallest change.
const PROFILES = Object.freeze({
  before: Object.freeze({
    label: "locked pre-R77 baseline",
    game: Object.freeze({ waveBonusBase: 30, waveBonusGrowth: 1.12, bossHpMul: 0.82 }),
    difficulties: Object.freeze({ normal: Object.freeze({ firstBossSpeedMul: 1.00, firstBossRewardMul: 1.00 }) }),
    enemies: Object.freeze({
      yaksha: Object.freeze({ reward: 132 }),
      boss: Object.freeze({ reward: 150 }),
    }),
  }),
  after: Object.freeze({
    label: "R77 0.7.7 candidate",
    game: Object.freeze({ waveBonusBase: 30, waveBonusGrowth: 1.12, bossHpMul: 0.82 }),
    difficulties: Object.freeze({ normal: Object.freeze({ firstBossSpeedMul: 1.40, firstBossRewardMul: 0.70 }) }),
    enemies: Object.freeze({
      yaksha: Object.freeze({ reward: 132 }),
      boss: Object.freeze({ reward: 150 }),
    }),
  }),
});

function parseArgs(argv) {
  const out = { profile: "compare", outDir: DEFAULT_OUT_DIR, strategies: [...STRATEGIES], seedCount: FIXED_SEEDS.length, quiet: false };
  for (const arg of argv) {
    if (arg.startsWith("--profile=")) out.profile = arg.slice("--profile=".length);
    else if (arg.startsWith("--out-dir=")) out.outDir = resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg.startsWith("--strategies=")) out.strategies = arg.slice("--strategies=".length).split(",").filter(Boolean);
    else if (arg.startsWith("--seed-count=")) out.seedCount = Number(arg.slice("--seed-count=".length));
    else if (arg === "--quiet") out.quiet = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["before", "after", "compare"].includes(out.profile)) throw new Error(`Unknown profile: ${out.profile}`);
  for (const strategy of out.strategies) {
    if (!STRATEGIES.includes(strategy)) throw new Error(`Unknown strategy: ${strategy}`);
  }
  if (!out.strategies.length) throw new Error("At least one strategy is required");
  if (!Number.isInteger(out.seedCount) || out.seedCount < 1 || out.seedCount > FIXED_SEEDS.length) throw new Error(`seed-count must be 1-${FIXED_SEEDS.length}`);
  return out;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const mul = 10 ** digits;
  return Math.round(value * mul) / mul;
}

function percentile(values, pct) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * pct) - 1));
  return sorted[index];
}

function stats(values) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { mean: null, p10: null, p50: null, p90: null, min: null, max: null };
  return {
    mean: round(finite.reduce((sum, value) => sum + value, 0) / finite.length),
    p10: round(percentile(finite, 0.10)),
    p50: round(percentile(finite, 0.50)),
    p90: round(percentile(finite, 0.90)),
    min: round(Math.min(...finite)),
    max: round(Math.max(...finite)),
  };
}

function aggregate(profile, runs) {
  const byStrategy = {};
  for (const strategy of STRATEGIES.filter((item) => runs.some((run) => run.strategy === item))) {
    const strategyRuns = runs.filter((run) => run.strategy === strategy);
    const waves = [];
    for (let wave = 1; wave <= 8; wave++) {
      const rows = strategyRuns.map((run) => run.waves.find((item) => item.wave === wave)).filter(Boolean);
      waves.push({
        wave,
        samples: rows.length,
        survivalRate: round(rows.filter((row) => !row.gameOver).length / strategyRuns.length, 4),
        noLeakRate: round(rows.filter((row) => row.goddessDamage === 0).length / strategyRuns.length, 4),
        income: stats(rows.map((row) => row.income)),
        killGold: stats(rows.map((row) => row.killGold)),
        bossGold: stats(rows.map((row) => row.bossGold)),
        waveGold: stats(rows.map((row) => row.waveGold)),
        spendBeforeWave: stats(rows.map((row) => row.spendBeforeWave)),
        goldEnd: stats(rows.map((row) => row.goldEnd)),
        goddessHp: stats(rows.map((row) => row.goddessHp)),
        goddessDamage: stats(rows.map((row) => row.goddessDamage)),
        enemyDurability: stats(rows.map((row) => row.enemyDurability)),
        playerDamage: stats(rows.map((row) => row.playerDamage)),
        nominalDefenseDps: stats(rows.map((row) => row.nominalDefenseDps)),
        requiredThroughputDps: stats(rows.map((row) => row.requiredThroughputDps)),
        pressureRatio: stats(rows.map((row) => row.pressureRatio)),
        waveDurationSeconds: stats(rows.map((row) => row.waveDurationSeconds)),
        affordableActions: stats(rows.map((row) => row.spendSpace.affordableActions)),
        boss: rows.some((row) => row.isBoss) ? {
          spawnedRate: round(rows.filter((row) => row.bossSpawned > 0).length / rows.length, 4),
          killRate: round(rows.filter((row) => row.bossKills > 0).length / rows.length, 4),
          durability: stats(rows.map((row) => row.bossDurability)),
          damageTaken: stats(rows.map((row) => row.bossDamage)),
          leakPotentialDamage: stats(rows.map((row) => row.bossLeakPotentialDamage)),
        } : null,
      });
    }
    byStrategy[strategy] = {
      runs: strategyRuns.length,
      reachedWave8Rate: round(strategyRuns.filter((run) => run.reachedWave >= 8).length / strategyRuns.length, 4),
      finalGoddessHp: stats(strategyRuns.map((run) => run.finalGoddessHp)),
      waves,
    };
  }
  return { profile, profileConfig: PROFILES[profile], byStrategy };
}

function mimeFor(pathname) {
  return ({
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
  })[extname(pathname).toLowerCase()] || "application/octet-stream";
}

async function startStaticServer() {
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = normalize(join(ROOT, requested.replace(/^[/\\]+/, "")));
      if (relative(ROOT, file).startsWith("..") || !statSync(file).isFile()) throw new Error("not found");
      res.writeHead(200, { "content-type": mimeFor(file), "cache-control": "no-store" });
      res.end(readFileSync(file));
    } catch {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
    }
  });
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function simulateRun(page, profile, strategy, seed, affixSeed) {
  return page.evaluate(({ profileConfig, profileName, strategyName, seedValue, affixSeedValue, dt, maxSteps }) => {
    const round = (value, digits = 2) => {
      const mul = 10 ** digits;
      return Math.round(value * mul) / mul;
    };
    const cfg = window.TD.config;
    Object.assign(cfg.GAME, profileConfig.game);
    for (const [difficultyId, values] of Object.entries(profileConfig.difficulties)) Object.assign(cfg.DIFFICULTIES[difficultyId], values);
    for (const [enemyId, values] of Object.entries(profileConfig.enemies)) Object.assign(cfg.ENEMIES[enemyId], values);
    window.setDifficulty("normal");
    window.setMap("plains");
    window.__setBalanceRandomSeed((seedValue ^ (affixSeedValue * 2654435761)) >>> 0);
    window.TD.newGame({ runSeed: seedValue, affixSeed: affixSeedValue });
    window.TD.setReducedEffects(true);
    window.TD.setAudioMuted(true);

    const actionLog = [];
    // Reproduce the exact desktop playtest click grid (56 CSS px) and convert it
    // through the live canvas scale to internal game coordinates.
    const canvas = document.getElementById("game");
    const canvasRect = canvas.getBoundingClientRect();
    const point = (col, row) => [
      (col * 56 + 28) * canvas.width / canvasRect.width,
      (row * 56 + 28) * canvas.height / canvasRect.height,
    ];
    const build = (type, col, row, phase) => {
      const before = window.TD.state().gold;
      const ok = window.TD.buildTowerAt(type, ...point(col, row));
      const spent = before - window.TD.state().gold;
      actionLog.push({ phase, kind: "build", type, col, row, ok, spent });
      return spent;
    };
    const upgrade = (towerIndex, phase) => {
      const state = window.TD.state();
      const tower = state.towers[towerIndex];
      const before = state.gold;
      state.selectedTower = tower;
      window.TD.upgradeSelected();
      const spent = before - state.gold;
      actionLog.push({ phase, kind: "upgrade", type: tower && tower.type, towerIndex, ok: spent > 0, spent });
      return spent;
    };
    const spendForWave = Array(9).fill(0);

    if (strategyName === "all-arrow") {
      spendForWave[1] += build("arrow", 0, 0, "initial");
      spendForWave[1] += build("arrow", 3, 0, "initial");
      spendForWave[1] += build("arrow", 4, 0, "initial");
      spendForWave[1] += build("arrow", 2, 2, "initial");
    } else {
      spendForWave[1] += build("cannon", 0, 0, "initial");
      spendForWave[1] += build("frost", 3, 0, "initial");
      spendForWave[1] += build("arrow", 4, 0, "initial");
    }

    const purchaseAfterWave = (clearedWave) => {
      if (clearedWave === 3) {
        if (strategyName === "playtest" || strategyName === "boss-ready") {
          spendForWave[4] += build("tesla", 2, 2, "after-wave-3");
          spendForWave[4] += build("support", 1, 2, "after-wave-3");
          spendForWave[4] += upgrade(2, "after-wave-3");
        } else if (strategyName === "all-arrow") {
          spendForWave[4] += upgrade(0, "after-wave-3");
          spendForWave[4] += upgrade(0, "after-wave-3");
          spendForWave[4] += build("arrow", 1, 2, "after-wave-3");
          spendForWave[4] += build("arrow", 6, 0, "after-wave-3");
        }
      }
      if (clearedWave === 4 && strategyName === "boss-ready") {
        spendForWave[5] += upgrade(3, "after-wave-4");
      }
    };

    const nominalDefenseDps = () => window.TD.state().towers.reduce((sum, tower) => {
      const def = cfg.TOWERS[tower.type];
      if (!def || def.support) return sum;
      return sum + window.TD.effectiveTowerDamage(tower) * window.TD.towerStat(tower, "fireRate");
    }, 0);
    const spendSpace = () => {
      const state = window.TD.state();
      const costs = Object.values(cfg.TOWERS).map((tower) => tower.cost);
      for (const tower of state.towers) {
        if (tower.level < cfg.UPGRADE.maxLevel) costs.push(Math.round(cfg.TOWERS[tower.type].cost * (cfg.UPGRADE.costMul ** tower.level)));
      }
      const affordable = costs.filter((cost) => cost <= state.gold);
      const cheapest = costs.length ? Math.min(...costs) : null;
      return {
        gold: state.gold,
        affordableActions: affordable.length,
        cheapestNextCost: cheapest,
        goldAfterCheapest: cheapest == null ? null : state.gold - cheapest,
      };
    };

    const waves = [];
    for (let wave = 1; wave <= 8; wave++) {
      const state = window.TD.state();
      if (state.over || state.goddess.hp <= 0) break;
      const goldStart = state.gold;
      const defenseDps = nominalDefenseDps();
      const preview = window.TD.previewNextWave();
      if (window.TD.startWave() === false) throw new Error(`${strategyName}: wave ${wave} did not start`);
      window.TD.setPaused(true);
      let steps = 0;
      let skillPolicyApplied = false;
      const skillAt = wave === 1 ? 0.9 : (wave === 2 ? 0.8 : (wave === 5 ? 2.4 : 1.4));
      while (!state.betweenWaves && !state.over && steps < maxSteps) {
        // Replay the human test cadence and click locations: meteor at 0.9 s in
        // W1, then skill buttons 2-5 at the recorded pre-action delays.
        const waveElapsed = state.clock - state.combatTelemetry.waves[wave].startedAt;
        if (!skillPolicyApplied && waveElapsed >= skillAt) {
          skillPolicyApplied = true;
          const activeEnemies = state.enemies.filter((enemy) => !enemy._dead && !enemy._leaked);
          const bestTargetFor = (skillId) => {
            const radius = cfg.SKILLS[skillId].radius;
            return activeEnemies.reduce((best, enemy) => {
              const hits = activeEnemies.filter((other) => Math.hypot(other.x - enemy.x, other.y - enemy.y) <= radius).length;
              return !best || hits > best.hits ? { enemy, hits } : best;
            }, null)?.enemy;
          };
          if (wave === 1) {
            const target = bestTargetFor("meteor");
            if (target) window.TD.debug.castSkill("meteor", target.x, target.y);
          } else {
            for (const skillId of ["freeze", "thunder", "judgment", "sealarray"]) {
              const target = bestTargetFor(skillId);
              if (target && (state.skillCooldowns[skillId] || 0) <= 0) window.TD.debug.castSkill(skillId, target.x, target.y);
            }
          }
        }
        window.TD.debug.stepSimulation(dt);
        steps++;
      }
      if (!state.betweenWaves && !state.over) throw new Error(`${strategyName}: wave ${wave} exceeded ${maxSteps} steps`);
      const telemetry = state.combatTelemetry.waves[wave];
      const duration = Math.max(dt, (telemetry.endedAt == null ? state.clock : telemetry.endedAt) - telemetry.startedAt);
      const deadline = Math.max(dt, telemetry.latestLeakDeadlineSeconds);
      const requiredDps = telemetry.spawnedDurability / deadline;
      const goddessHp = state.goddess.hp;
      const income = telemetry.killGold + telemetry.waveGold;
      waves.push({
        wave,
        isBoss: !!preview.isBoss,
        event: preview.event ? preview.event.id : null,
        affix: state.affix ? state.affix.id : null,
        goldStart,
        spendBeforeWave: spendForWave[wave],
        killGold: telemetry.killGold,
        bossGold: telemetry.bossGold,
        waveGold: telemetry.waveGold,
        income,
        goldEnd: state.gold,
        spendSpace: spendSpace(),
        goddessHp,
        goddessMaxHp: state.goddess.maxHp,
        goddessDamage: telemetry.goddessDamage,
        leaks: telemetry.leaks,
        enemyDurability: round(telemetry.spawnedDurability),
        leakPotentialDamage: telemetry.leakPotentialDamage,
        playerDamage: round(telemetry.playerDamage),
        damageBySource: Object.fromEntries(Object.entries(telemetry.damageBySource).map(([key, value]) => [key, Math.round(value * 100) / 100])),
        waveDurationSeconds: round(duration),
        nominalDefenseDps: round(defenseDps),
        requiredThroughputDps: round(requiredDps),
        pressureRatio: round(requiredDps / Math.max(0.01, defenseDps), 4),
        bossSpawned: telemetry.bossSpawned,
        bossKills: telemetry.bossKills,
        bossDurability: round(telemetry.bossDurability),
        bossDamage: round(telemetry.bossDamage),
        bossLeakPotentialDamage: telemetry.bossLeakPotentialDamage,
        gameOver: !!state.over,
      });
      purchaseAfterWave(wave);
    }
    const finalState = window.TD.state();
    return {
      profile: profileName,
      strategy: strategyName,
      seed: seedValue,
      affixSeed: affixSeedValue,
      affix: finalState.affix ? finalState.affix.id : null,
      reachedWave: waves.length ? waves[waves.length - 1].wave : 0,
      finalGold: finalState.gold,
      finalGoddessHp: finalState.goddess.hp,
      actionLog,
      waves,
    };
  }, {
    profileConfig: PROFILES[profile],
    profileName: profile,
    strategyName: strategy,
    seedValue: seed,
    affixSeedValue: affixSeed,
    dt: DT,
    maxSteps: MAX_STEPS_PER_WAVE,
  });
}

function comparison(before, after) {
  const result = { seedsIdentical: true, strategies: {} };
  for (const strategy of Object.keys(before.byStrategy)) {
    const left = before.byStrategy[strategy];
    const right = after.byStrategy[strategy];
    result.strategies[strategy] = {
      reachedWave8Rate: { before: left.reachedWave8Rate, after: right.reachedWave8Rate, delta: round(right.reachedWave8Rate - left.reachedWave8Rate, 4) },
      waves: left.waves.map((wave, index) => {
        const next = right.waves[index];
        return {
          wave: wave.wave,
          incomeP50: { before: wave.income.p50, after: next.income.p50, delta: round(next.income.p50 - wave.income.p50) },
          goldEndP50: { before: wave.goldEnd.p50, after: next.goldEnd.p50, delta: round(next.goldEnd.p50 - wave.goldEnd.p50) },
          goddessHpP50: { before: wave.goddessHp.p50, after: next.goddessHp.p50, delta: round(next.goddessHp.p50 - wave.goddessHp.p50) },
          noLeakRate: { before: wave.noLeakRate, after: next.noLeakRate, delta: round(next.noLeakRate - wave.noLeakRate, 4) },
          pressureRatioP50: { before: wave.pressureRatio.p50, after: next.pressureRatio.p50, delta: round(next.pressureRatio.p50 - wave.pressureRatio.p50, 4) },
        };
      }),
    };
  }
  return result;
}

function curveInvariance(seedCount) {
  const signatures = { before: {}, after: {} };
  for (const profile of ["before", "after"]) {
    const difficulty = Object.assign({}, nodeConfig.DIFFICULTIES.normal, PROFILES[profile].difficulties.normal);
    for (let index = 0; index < seedCount; index++) {
      const runSeed = FIXED_SEEDS[index];
      const affixSeed = FIXED_SEEDS[(index * 7 + 5) % FIXED_SEEDS.length];
      const affix = nodeRules.selectMapAffix(affixSeed);
      for (let wave = 1; wave <= 50; wave++) {
        const plan = nodeRules.generateWaveQueue(wave, difficulty, nodeRules.waveRngSeed(wave, runSeed, affixSeed), affix);
        signatures[profile][`${index}:${wave}`] = JSON.stringify(plan.queue.map((spec) => ({
          type: spec.type,
          hpScale: spec.hpScale,
          speedMul: spec.speedMul || 1,
          rewardMul: spec.rewardMul || 1,
          leakOverride: spec.leakOverride == null ? null : spec.leakOverride,
          event: spec.event ? spec.event.id : null,
        })));
      }
    }
  }
  const countDifferences = (from, to) => {
    let differences = 0;
    for (let index = 0; index < seedCount; index++) {
      for (let wave = from; wave <= to; wave++) {
        if (signatures.before[`${index}:${wave}`] !== signatures.after[`${index}:${wave}`]) differences++;
      }
    }
    return differences;
  };
  return {
    seeds: seedCount,
    earlyWaves1To4: { comparisons: seedCount * 4, differences: countDifferences(1, 4) },
    firstBossWave5: { comparisons: seedCount, differences: countDifferences(5, 5) },
    laterWaves6To50: { comparisons: seedCount * 45, differences: countDifferences(6, 50) },
  };
}

function printSummary(summary) {
  for (const [strategy, data] of Object.entries(summary.byStrategy)) {
    console.log(`\n${summary.profile} / ${strategy} (${data.runs} seeds, W8=${Math.round(data.reachedWave8Rate * 100)}%)`);
    console.log("wave income(p50) kill wave boss spend goldEnd goddess noLeak pressure");
    for (const row of data.waves) {
      console.log([
        String(row.wave).padStart(4),
        String(row.income.p50 ?? "-").padStart(11),
        String(row.killGold.p50 ?? "-").padStart(4),
        String(row.waveGold.p50 ?? "-").padStart(4),
        String(row.bossGold.p50 ?? "-").padStart(4),
        String(row.spendBeforeWave.p50 ?? "-").padStart(5),
        String(row.goldEnd.p50 ?? "-").padStart(7),
        String(row.goddessHp.p50 ?? "-").padStart(7),
        `${Math.round(row.noLeakRate * 100)}%`.padStart(6),
        String(row.pressureRatio.p50 ?? "-").padStart(8),
      ].join(" "));
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const profiles = args.profile === "compare" ? ["before", "after"] : [args.profile];
  const { server, url } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  await page.addInitScript(() => {
    window.__setBalanceRandomSeed = (seed) => {
      let state = (Number(seed) >>> 0) || 1;
      Math.random = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
    };
  });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: "load", timeout: 30000 });
  await page.waitForFunction(() => window.TD && window.TD.debug && window.TD.debug.stepSimulation, null, { timeout: 15000 });

  const outputs = {};
  try {
    for (const profile of profiles) {
      const runs = [];
      for (const strategy of args.strategies) {
        for (let index = 0; index < args.seedCount; index++) {
          const seed = FIXED_SEEDS[index];
          const affixSeed = FIXED_SEEDS[(index * 7 + 5) % FIXED_SEEDS.length];
          runs.push(await simulateRun(page, profile, strategy, seed, affixSeed));
        }
      }
      const summary = aggregate(profile, runs);
      outputs[profile] = {
        schemaVersion: 1,
        method: {
          engine: "production Chromium game loop via TD.debug.stepSimulation",
          fixedStepSeconds: DT,
          difficulty: "normal",
          map: "plains",
          waves: [1, 2, 3, 4, 5, 6, 7, 8],
          seeds: FIXED_SEEDS.slice(0, args.seedCount),
          affixSeedRule: "FIXED_SEEDS[(index * 7 + 5) % 24]",
          strategies: [...args.strategies],
          renderingSkipped: true,
          combatRulesSkipped: false,
        },
        profile: PROFILES[profile],
        summary,
        runs,
      };
      if (!args.quiet) printSummary(summary);
    }
  } finally {
    await browser.close();
    await new Promise((resolveClose) => server.close(resolveClose));
  }
  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(" | ")}`);

  mkdirSync(args.outDir, { recursive: true });
  for (const profile of profiles) {
    const path = join(args.outDir, `${profile}-stats.json`);
    writeFileSync(path, `${JSON.stringify(outputs[profile], null, 2)}\n`, "utf8");
    console.log(`wrote ${relative(ROOT, path)}`);
  }
  if (profiles.length === 2) {
    const path = join(args.outDir, "comparison.json");
    const body = {
      schemaVersion: 1,
      method: outputs.before.method,
      beforeProfile: PROFILES.before,
      afterProfile: PROFILES.after,
      curveInvariance: curveInvariance(args.seedCount),
      comparison: comparison(outputs.before.summary, outputs.after.summary),
    };
    writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    console.log(`wrote ${relative(ROOT, path)}`);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
