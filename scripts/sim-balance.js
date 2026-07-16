/* =========================================================================
 * sim-balance.js — 塔防平衡模擬器（CI/開發用，零依賴）
 *
 * Stage 4 起模擬兩張地圖 × 三難度，並把毒塔 DoT 折算進 DPS。
 * 聖光塔是 support 特例，不列入直接 DPS CP 比值；它的價值來自範圍內
 * 既有主力塔越多，+25% 以上的總輸出收益越高。
 * ========================================================================= */

const path = require("path");
const cfg = require(path.join(__dirname, "..", "src", "config.js"));
const rules = require(path.join(__dirname, "..", "src", "rules.js"));

const {
  TOWERS, UPGRADE, ENEMIES, GAME, GODDESS, MAPS, MAP_AFFIXES,
  waveGoldBonus, DIFFICULTIES, setDifficulty,
} = cfg;

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SEED_COUNT = 200;

function eventWaveSeed(wave) {
  return ((wave * 2654435761) % 1000) / 1000;
}

function baseWaveHpScale(wave) {
  return wave <= 10
    ? Math.pow(1 + GAME.hpGrowthEarly, wave - 1)
    : Math.pow(1 + GAME.hpGrowthEarly, 9) * Math.pow(1 + GAME.hpGrowthLate, wave - 10);
}

function oldPickDefaultEnemy(wave, roll) {
  if (wave < 3) return roll < 0.7 ? "slime" : "goblin";
  if (roll < 0.30) return "slime";
  if (roll < 0.48) return "goblin";
  if (roll < 0.62) return "bat";
  if (roll < 0.72) return "frostwolf";
  if (roll < 0.81) return "imp";
  if (roll < 0.90) return "shieldman";
  if (roll < 0.95) return "medic";
  return "orc";
}

function generateWaveQueueLegacy(wave, diff, rng) {
  const isBoss = wave % diff.bossEvery === 0;
  const hpScale = baseWaveHpScale(wave) * diff.hpMul;
  const event = cfg.getEventWave(wave, isBoss, eventWaveSeed(wave));
  const theme = cfg.waveTheme(wave);
  const themePool = theme ? cfg.themeEnemyPool(theme) : null;
  const rand = rng || makeRng(wave);
  let baseCount = 5 + Math.floor(wave * 1.2);
  if (isBoss) baseCount = Math.floor(baseCount * 0.5);
  if (event) baseCount = Math.max(2, Math.round(baseCount * event.countMul));
  const eventHpScale = hpScale * (event ? event.hpMul : 1);
  const queue = [];
  for (let i = 0; i < baseCount; i++) {
    let type;
    if (event && event.forceType) type = event.forceType;
    else if (themePool && themePool.length && rand() < 0.55) type = themePool[Math.floor(rand() * themePool.length)];
    else type = oldPickDefaultEnemy(wave, rand());
    queue.push({ type, hpScale: eventHpScale, event });
  }
  if (isBoss) queue.push({ type: "boss", hpScale: hpScale * (GAME.bossHpMul || 1.0) });
  return { wave, count: baseCount, isBoss, event, theme, hpScale, queue };
}

function pathLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

// ===== 1. 各塔 DPS 與 CP 值分析 =====
function towerDPS(t, level = 1) {
  if (t.support) return 0;
  const dmg = (t.damage || 0) * Math.pow(UPGRADE.damageMul, level - 1);
  let dps = dmg * (t.fireRate || 0);
  if (t.poisonDps) {
    const stacks = Math.min(t.poisonMaxStacks || 1, (t.fireRate || 0) * (t.poisonDuration || 0));
    dps += t.poisonDps * Math.pow(UPGRADE.poisonDpsMul || UPGRADE.damageMul || 1, level - 1) * stacks;
  }
  if (t.splash) dps *= 2.2;   // 範圍傷害對群體的等效加成
  if (t.pierce) dps *= (1 + (t.pierce - 1) * 0.6); // 穿透多目標加成
  return dps;
}

function towerCost(t, level = 1) {
  let c = t.cost;
  for (let i = 1; i < level; i++) c += Math.round(t.cost * Math.pow(UPGRADE.costMul, i));
  return c;
}

console.log("===== 砲塔 CP 值分析（DPS / 累計造價）=====");
const attackTowers = Object.values(TOWERS).filter((t) => !t.support);
const towerStats = [];
for (const t of Object.values(TOWERS)) {
  if (t.support) {
    const supportText = t.slowAura
      ? `暴露 + 減速 ${Math.round(t.slowAura * 100)}%`
      : `增傷=+${Math.round((t.buff || 0) * 100)}%`;
    console.log(`  ${t.name}: 支援塔，Lv1 範圍=${t.range} ${supportText}，不列入直接 DPS CP`);
    continue;
  }
  const dps1 = towerDPS(t, 1), cp1 = dps1 / t.cost;
  const dps4 = towerDPS(t, 4), cost4 = towerCost(t, 4), cp4 = dps4 / cost4;
  towerStats.push({ name: t.name, cost: t.cost, dps1, cp1, dps4, cp4 });
  const dotNote = t.poisonDps ? "（含滿層 DoT 折算）" : "";
  console.log(`  ${t.name}: Lv1 DPS=${dps1.toFixed(1)} CP=${cp1.toFixed(3)} | Lv4 DPS=${dps4.toFixed(1)} 累計造價=${cost4} CP=${cp4.toFixed(3)} ${dotNote}`);
}
const cps = towerStats.map((s) => s.cp1);
const cpRatio = Math.max(...cps) / Math.min(...cps);
console.log(`  → Lv1 攻擊塔 CP 值最高/最低比 = ${cpRatio.toFixed(2)}（支援塔另以範圍增傷評估）`);
console.log(`  → 聖光塔價值：若範圍內主力塔總 DPS ≥ ${(TOWERS.support.cost / (TOWERS.support.buff || 0.25)).toFixed(0)} 的等價投資門檻，+${Math.round(TOWERS.support.buff * 100)}% 增傷開始優於單蓋低階塔。`);

// ===== 2. 波次敵人總血量曲線 =====
console.log("\n===== 波次強度曲線（普通難度，含護盾/治療/新敵人特性估值）=====");
function enemyEffectiveHp(spec) {
  const def = ENEMIES[spec.type];
  const base = (def.hp || 0) + (def.shield || 0);
  let hp = base * spec.hpScale;
  if (def.healAmount) hp *= 1.08; // 醫官能抬高整波有效血量，保守估 8%
  if (def.ability && def.ability.id === "dodgeFirst") hp *= 1 + (def.ability.chance || 0) * 0.16;
  if (def.ability && def.ability.id === "bloodrage") hp *= 1.05;
  if (def.ability && def.ability.id === "splitBat") hp *= 1 + (def.ability.childHpMul || 0.45) * 0.60;
  return hp;
}
const statsCache = new Map();
function percentile(sorted, pct) {
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * pct) - 1));
  return sorted[idx];
}
function waveEnemyHpStats(wave, diff, generator, affix) {
  const mode = generator === generateWaveQueueLegacy ? "legacy" : "current";
  const affixId = affix && affix.id ? affix.id : "none";
  const key = `${mode}:${diff.id}:${wave}:${affixId}`;
  if (statsCache.has(key)) return statsCache.get(key);
  const samplePlan = generator(wave, diff, makeRng((wave * 65537 + diff.bossEvery) >>> 0), affix);
  const values = [];
  for (let i = 0; i < SEED_COUNT; i++) {
    const seed = (wave * 1000003 + (i + 1) * 9176 + diff.bossEvery * 101) >>> 0;
    const plan = generator(wave, diff, makeRng(seed), affix);
    values.push(plan.queue.reduce((sum, spec) => sum + enemyEffectiveHp(spec), 0));
  }
  values.sort((a, b) => a - b);
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const stats = {
    wave,
    mean,
    min: values[0],
    max: values[values.length - 1],
    p95: percentile(values, 0.95),
    isBoss: samplePlan.isBoss,
    event: samplePlan.event ? samplePlan.event.id : null,
    theme: samplePlan.theme || null,
  };
  statsCache.set(key, stats);
  return stats;
}
function growthPct(curr, prev, key) {
  return ((curr[key] / prev[key] - 1) * 100);
}

setDifficulty("normal");
const curveByDiff = {};
for (const diff of Object.values(DIFFICULTIES)) {
  curveByDiff[diff.id] = [];
  for (let w = 1; w <= 20; w++) {
    const stats = waveEnemyHpStats(w, diff, rules.generateWaveQueue);
    const prev = curveByDiff[diff.id][w - 2];
    stats.meanGrowth = prev ? growthPct(stats, prev, "mean") : null;
    stats.p95Growth = prev ? growthPct(stats, prev, "p95") : null;
    stats.prevEvent = prev ? prev.event : null;
    stats.prevBoss = prev ? prev.isBoss : false;
    curveByDiff[diff.id].push(stats);
  }
}
const waveData = curveByDiff.normal;
for (const d of waveData) {
  const growth = d.meanGrowth == null ? "-" : d.meanGrowth.toFixed(0);
  if (d.wave <= 12 || d.wave % 5 === 0) {
    console.log(`  第 ${d.wave} 波: 平均有效血量 ${Math.round(d.mean)}，p95 ${Math.round(d.p95)}${d.isBoss ? " (Boss波)" : ""}，平均較前波 +${growth}%`);
  }
}

console.log("\n===== Stage 4 入池調整前後（普通，第 3~6 波平均有效血量）=====");
for (let w = 3; w <= 6; w++) {
  const before = waveEnemyHpStats(w, DIFFICULTIES.normal, generateWaveQueueLegacy);
  const after = waveEnemyHpStats(w, DIFFICULTIES.normal, rules.generateWaveQueue);
  console.log(`  第 ${w} 波: 調整前 ${Math.round(before.mean)}（${Math.round(before.min)}~${Math.round(before.max)}） → 調整後 ${Math.round(after.mean)}（${Math.round(after.min)}~${Math.round(after.max)}）`);
}

console.log("\n===== R17 地圖詞綴期望值（資源報酬 vs 壓力）=====");
const affixValues = Object.values(MAP_AFFIXES || {});
for (const affix of affixValues) {
  const bal = rules.affixExpectedBalance(affix);
  console.log(`  ${affix.label}: 資源 ${(bal.goldDelta * 100).toFixed(0)}% / 壓力 ${(bal.powerDelta * 100).toFixed(0)}% / 淨值 ${(bal.netDelta * 100).toFixed(0)}%`);
}

// ===== 3. 模擬：玩家防線輸出 vs 波次強度 =====
console.log("\n===== 撐波模擬（兩張圖 × 三難度）=====");
const plainsLen = pathLength(MAPS.plains.path);
const bestTower = attackTowers.sort((a, b) => towerDPS(b, 1) / b.cost - towerDPS(a, 1) / a.cost)[0];
console.log(`  主力塔: ${bestTower.name}`);

function simulate(map, diff, affix) {
  setDifficulty(diff.id);
  let gold = Math.round(GAME.startGold * (map.goldMul || 1));
  let goddessHp = GODDESS.baseHp * (diff.goddessMul || 1);
  const myTowers = [];
  const mapExposureMul = Math.sqrt(pathLength(map.path) / plainsLen);
  const affixRangeMul = affix && affix.towerRangeMul ? affix.towerRangeMul : 1;
  const affixDamageMul = affix && affix.towerDamageMul ? affix.towerDamageMul : 1;
  const affixSpeedMul = affix && affix.enemySpeedMul ? affix.enemySpeedMul : 1;
  const affixWaveGoldMul = affix && affix.waveGoldMul ? affix.waveGoldMul : 1;
  const affixKillGoldMul = affix && affix.killGoldMul ? affix.killGoldMul : 1;
  const affixLeakMul = affix && affix.leakDamageMul ? affix.leakDamageMul : 1;

  for (let w = 1; w <= 50; w++) {
    while (gold >= bestTower.cost && myTowers.length < 12) {
      gold -= bestTower.cost;
      myTowers.push({ t: bestTower, level: 1 });
    }
    let upgraded = true;
    while (upgraded) {
      upgraded = false;
      const low = myTowers.filter((m) => m.level < UPGRADE.maxLevel).sort((a, b) => a.level - b.level)[0];
      if (low) {
        const c = Math.round(low.t.cost * Math.pow(UPGRADE.costMul, low.level));
        if (gold >= c) { gold -= c; low.level++; upgraded = true; }
      }
    }

    let totalDPS = myTowers.reduce((s, m) => s + towerDPS(m.t, m.level), 0) * affixDamageMul;
    if (myTowers.length >= 6 && gold >= TOWERS.support.cost) {
      totalDPS *= 1 + TOWERS.support.buff; // 中後期一座聖光塔覆蓋核心火力區的近似值
    }
    if (affix && affix.towerStunEvery && w % affix.towerStunEvery === 0) totalDPS *= 0.96;
    const waveHp = waveEnemyHpStats(w, diff, rules.generateWaveQueue, affix).mean;
    const exposureTime = (8 + Math.min(8, myTowers.length * 0.7)) * mapExposureMul * Math.sqrt(affixRangeMul) / affixSpeedMul;
    const dealt = totalDPS * exposureTime;
    const leaked = Math.max(0, waveHp - dealt);
    const leakDmg = Math.round((leaked / 52) * affixLeakMul);
    goddessHp -= leakDmg;
    gold += Math.round(waveGoldBonus(w) * (map.goldMul || 1) * affixWaveGoldMul) + Math.round((waveHp / 85) * affixKillGoldMul);
    if (goddessHp <= 0) return { survivedWave: w, totalDPS: Math.round(totalDPS), towers: myTowers.length };
  }
  const totalDPS = myTowers.reduce((s, m) => s + towerDPS(m.t, m.level), 0) * affixDamageMul;
  return { survivedWave: 50, totalDPS: Math.round(totalDPS), towers: myTowers.length };
}

const simByMapDiff = {};
for (const map of Object.values(MAPS)) {
  simByMapDiff[map.id] = {};
  console.log(`  【${map.label}】路徑長 ${Math.round(pathLength(map.path))}px，資源 ${Math.round(map.goldMul * 100)}%`);
  for (const diff of Object.values(DIFFICULTIES)) {
    simByMapDiff[map.id][diff.id] = simulate(map, diff);
    console.log(`    ${diff.emoji} ${diff.label}: 第 ${simByMapDiff[map.id][diff.id].survivedWave} 波（DPS ${simByMapDiff[map.id][diff.id].totalDPS}，塔 ${simByMapDiff[map.id][diff.id].towers}）`);
  }
}

console.log("\n===== R17 詞綴包絡模擬（最差/最好存活波）=====");
const affixEnvelopeByMapDiff = {};
for (const map of Object.values(MAPS)) {
  affixEnvelopeByMapDiff[map.id] = {};
  for (const diff of Object.values(DIFFICULTIES)) {
    const sims = affixValues.map((affix) => ({ affix, result: simulate(map, diff, affix) }));
    sims.sort((a, b) => a.result.survivedWave - b.result.survivedWave);
    const worst = sims[0];
    const best = sims[sims.length - 1];
    affixEnvelopeByMapDiff[map.id][diff.id] = { worst, best };
    console.log(`  ${map.label}/${diff.label}: 最差 ${worst.affix.label} 第 ${worst.result.survivedWave} 波，最好 ${best.affix.label} 第 ${best.result.survivedWave} 波`);
  }
}
setDifficulty("normal");

// ===== 4. 健全性斷言 =====
console.log("\n===== 平衡健全性檢查 =====");
let warns = 0;
function check(cond, msg) { if (cond) console.log("  ✓ " + msg); else { console.log("  ⚠ " + msg); warns++; } }

check(cpRatio < 2.8, `攻擊塔 CP 值平衡（比值 ${cpRatio.toFixed(2)} < 2.8；寒冰塔有減速、毒塔含 DoT）`);
const allCurves = Object.values(curveByDiff).flat().filter((d) => d.meanGrowth != null);
const mainlineNonBoss = allCurves.filter((d) => !d.isBoss && !d.event && !d.prevEvent && !d.prevBoss);
const nonBossExpectedMax = Math.max(...mainlineNonBoss.map((d) => d.meanGrowth));
const bossExpectedMax = Math.max(...allCurves.filter((d) => d.isBoss && d.wave >= 5).map((d) => d.meanGrowth));
const firstBossExpectedMax = Math.max(...allCurves.filter((d) => d.isBoss && d.wave < 5).map((d) => d.meanGrowth));
const p95AdjacentMax = Math.max(...allCurves.map((d) => d.p95Growth));
const normalW12 = curveByDiff.normal.find((d) => d.wave === 12);
const bossValleyMin = Math.min(...allCurves.filter((d) => d.isBoss && d.wave >= 5).map((d) => d.meanGrowth));
const postBossDropMin = Math.min(...allCurves.filter((d) => d.prevBoss && !d.isBoss).map((d) => d.meanGrowth));
check(nonBossExpectedMax < 75, `R67 主線非 Boss 波平均成長受控（最大 +${nonBossExpectedMax.toFixed(0)}% < 75%，排除事件轉場，${SEED_COUNT} seeds 平均）`);
check(bossExpectedMax < 110, `R67 第 5 波後 Boss 波平均成長受控（最大 +${bossExpectedMax.toFixed(0)}% < 110%，${SEED_COUNT} seeds 平均）`);
check(firstBossExpectedMax < 190, `R67 首個早期 Boss 平均成長受控（最大 +${firstBossExpectedMax.toFixed(0)}% < 190%，無盡早期 Boss 特例）`);
check(p95AdjacentMax < 190, `R67 壞 seed p95 相鄰波成長受控（最大 +${p95AdjacentMax.toFixed(0)}% < 190%，${SEED_COUNT} seeds p95）`);
check(normalW12 && normalW12.meanGrowth < 80, `R67 普通 W12 暴衝已壓低（+${normalW12 ? normalW12.meanGrowth.toFixed(0) : "?"}% < 80%）`);
check(bossValleyMin > -20, `R67 Boss 波不再低於前波形成谷底（最低 ${bossValleyMin.toFixed(0)}% > -20%）`);
check(postBossDropMin > -30, `R67 Boss 後掉落受控（最低 ${postBossDropMin.toFixed(0)}% > -30%）`);
check(GODDESS.baseHp >= 80, `女神起始血量足夠新手（${GODDESS.baseHp}）`);
const maxAffixNet = Math.max(...affixValues.map((affix) => Math.abs(rules.affixExpectedBalance(affix).netDelta)));
check(maxAffixNet <= 0.2, `詞綴期望淨值對稱（最大偏移 ${(maxAffixNet * 100).toFixed(0)}% <= 20%）`);

for (const map of Object.values(MAPS)) {
  const normal = simByMapDiff[map.id].normal.survivedWave;
  const brutal = simByMapDiff[map.id].brutal.survivedWave;
  const endless = simByMapDiff[map.id].endless.survivedWave;
  const normalTarget = 20;
  check(normal >= normalTarget, `【${map.label} / 普通】R67 主路徑撐波數達標（${normal}，目標 ≥${normalTarget}）`);
  check(brutal >= 10, `【${map.label} / 嚴酷】可玩到有感（${brutal}，目標 ≥10）`);
  check(endless >= 15, `【${map.label} / 無盡】追分節奏達標（${endless}，目標 ≥15）`);
  check(brutal <= normal, `【${map.label}】嚴酷不比普通輕鬆（${brutal} ≤ ${normal}）`);
  const normalWorst = affixEnvelopeByMapDiff[map.id].normal.worst.result.survivedWave;
  const brutalWorst = affixEnvelopeByMapDiff[map.id].brutal.worst.result.survivedWave;
  const endlessWorst = affixEnvelopeByMapDiff[map.id].endless.worst.result.survivedWave;
  check(normalWorst >= normalTarget - 2, `【${map.label} / 普通】最差詞綴仍接近主線門檻（${normalWorst} ≥ ${normalTarget - 2}）`);
  check(brutalWorst >= 8, `【${map.label} / 嚴酷】最差詞綴仍有前期策略空間（${brutalWorst} ≥ 8）`);
  check(endlessWorst >= 8, `【${map.label} / 無盡】最差詞綴仍有前期策略空間（${endlessWorst} ≥ 8）`);
}
check(simByMapDiff.canyon.normal.survivedWave <= simByMapDiff.plains.normal.survivedWave + 3,
  `迂迴峽谷因資源較少仍維持挑戰性（普通 ${simByMapDiff.canyon.normal.survivedWave} vs 平原 ${simByMapDiff.plains.normal.survivedWave}）`);

console.log(warns === 0 ? "\n✅ 平衡檢查全部通過" : `\n⚠ ${warns} 項需注意`);
process.exit(warns === 0 ? 0 : 1);
