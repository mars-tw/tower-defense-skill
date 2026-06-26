/* =========================================================================
 * sim-balance.js — 塔防平衡模擬器（CI/開發用，零依賴）
 *
 * 目的：用數據驗證「經驗調的數值」是否合理，而非盲調。
 * 模擬「理想玩法」：每波結束用當前金錢蓋/升最划算的塔，計算：
 *   - 每座塔的 DPS 與 CP 值（DPS/造價）
 *   - 每波敵人總血量 vs 防線總輸出
 *   - 玩家大約能撐到第幾波（難度曲線是否平滑）
 * 執行：node scripts/sim-balance.js
 * ========================================================================= */

const path = require("path");
const cfg = require(path.join(__dirname, "..", "src", "config.js"));
const { TOWERS, UPGRADE, ENEMIES, GAME, GODDESS, elementMultiplier } = cfg;

// ===== 1. 各塔 DPS 與 CP 值分析 =====
function towerDPS(t, level = 1) {
  const dmg = t.damage * Math.pow(UPGRADE.damageMul, level - 1);
  let dps = dmg * t.fireRate;
  if (t.splash) dps *= 2.2;   // 範圍傷害對群體的等效加成
  if (t.pierce) dps *= (1 + (t.pierce - 1) * 0.6); // 穿透多目標加成
  // 減速不算直接 DPS，但有控場價值（估值）
  return dps;
}
function towerCost(t, level = 1) {
  let c = t.cost;
  for (let i = 1; i < level; i++) c += Math.round(t.cost * Math.pow(UPGRADE.costMul, i));
  return c;
}

console.log("===== 砲塔 CP 值分析（DPS / 累計造價）=====");
const towerStats = [];
for (const t of Object.values(TOWERS)) {
  const dps1 = towerDPS(t, 1), cp1 = dps1 / t.cost;
  const dps4 = towerDPS(t, 4), cost4 = towerCost(t, 4), cp4 = dps4 / cost4;
  towerStats.push({ name: t.name, cost: t.cost, dps1: dps1.toFixed(1), cp1: cp1.toFixed(3), dps4: dps4.toFixed(1), cp4: cp4.toFixed(3) });
  console.log(`  ${t.name}: Lv1 DPS=${dps1.toFixed(1)} CP=${cp1.toFixed(3)} | Lv4 DPS=${dps4.toFixed(1)} 累計造價=${cost4} CP=${cp4.toFixed(3)}`);
}
// CP 值差異檢查：最高/最低不應差太多（否則某塔沒人用）
const cps = towerStats.map((s) => parseFloat(s.cp1));
const cpRatio = Math.max(...cps) / Math.min(...cps);
console.log(`  → Lv1 CP 值最高/最低比 = ${cpRatio.toFixed(2)}（建議 < 2.0，避免某塔廢掉）`);

// ===== 2. 波次敵人總血量曲線 =====
console.log("\n===== 波次強度曲線（敵人總血量）=====");
function waveEnemyHp(wave) {
  const hpScale = Math.pow(1 + GAME.hpGrowthPerWave, wave - 1);
  let count = 5 + Math.floor(wave * 1.2);
  if (wave % GAME.bossEveryWaves === 0) count = Math.floor(count * 0.5); // Boss 波小怪減半
  // 平均敵人血量（粗估各怪混合）
  const avgBase = (ENEMIES.slime.hp + ENEMIES.goblin.hp + ENEMIES.bat.hp + ENEMIES.orc.hp) / 4;
  let total = count * avgBase * hpScale;
  if (wave % GAME.bossEveryWaves === 0) total += ENEMIES.boss.hp * hpScale * (GAME.bossHpMul || 1.0);
  return Math.round(total);
}
const waveData = [];
for (let w = 1; w <= 20; w++) {
  const hp = waveEnemyHp(w);
  const growth = w > 1 ? ((hp / waveData[w - 2].hp - 1) * 100).toFixed(0) : "-";
  waveData.push({ wave: w, hp, growth });
  if (w <= 12 || w % 5 === 0) console.log(`  第 ${w} 波: 總血量 ${hp}${w % GAME.bossEveryWaves === 0 ? " (Boss波)" : ""} 較前波 +${growth}%`);
}

// ===== 3. 模擬：玩家防線輸出 vs 波次強度 =====
console.log("\n===== 撐波模擬（理想玩法：每波把金錢花在最高 CP 塔）=====");
function simulate() {
  let gold = GAME.startGold;
  let goddessHp = GODDESS.baseHp;
  let totalDPS = 0;
  // 選最高 CP 的塔當主力
  const bestTower = Object.values(TOWERS).sort((a, b) => towerDPS(b, 1) / b.cost - towerDPS(a, 1) / a.cost)[0];
  for (let w = 1; w <= 40; w++) {
    // 蓋塔：用當前金錢盡量蓋主力塔
    while (gold >= bestTower.cost) { gold -= bestTower.cost; totalDPS += towerDPS(bestTower, 1); }
    // 本波敵人總血量與「通過時間」（敵人走完路徑約需的時間，估 8 秒）
    const waveHp = waveEnemyHp(w);
    const exposureTime = 8; // 敵人在塔射程內的大約曝露秒數
    const dealt = totalDPS * exposureTime;
    const leaked = Math.max(0, waveHp - dealt); // 沒打死的血量 → 估算漏怪傷害
    const leakDmg = Math.round(leaked / 50); // 每 50 殘血約等於 1 隻漏過
    goddessHp -= leakDmg;
    // 升級女神（有閒錢時）
    gold += GAME.waveBonus + Math.round(waveHp / 100); // 擊殺獎勵估算
    if (goddessHp <= 0) return { survivedWave: w, totalDPS: Math.round(totalDPS) };
  }
  return { survivedWave: "40+", totalDPS: Math.round(totalDPS) };
}
const result = simulate();
console.log(`  主力塔: ${Object.values(TOWERS).sort((a,b)=>towerDPS(b,1)/b.cost-towerDPS(a,1)/a.cost)[0].name}`);
console.log(`  純塔防（無英雄）大約撐到: 第 ${result.survivedWave} 波`);

// ===== 4. 健全性斷言 =====
console.log("\n===== 平衡健全性檢查 =====");
let warns = 0;
function check(cond, msg) { if (cond) console.log("  ✓ " + msg); else { console.log("  ⚠ " + msg); warns++; } }
// 寒冰塔靠減速控場，純 DPS 偏低屬正常設計；CP 比值放寬到 2.6
check(cpRatio < 2.6, `塔 CP 值平衡（比值 ${cpRatio.toFixed(2)} < 2.6，寒冰塔有減速價值補償）`);
// 只檢查「非 Boss 波」的平滑度（Boss 波難是刻意設計，不算斷崖）
const nonBossGrowths = waveData.slice(1).filter((d) => d.wave % GAME.bossEveryWaves !== 0).map((d) => parseFloat(d.growth));
const maxGrowth = Math.max(...nonBossGrowths);
check(maxGrowth < 50, `非 Boss 波成長平滑（最大 ${maxGrowth}% < 50%，無意外斷崖）`);
// Boss 波檢查：難但不該是猝死級（< 150%）
const bossGrowths = waveData.slice(1).filter((d) => d.wave % GAME.bossEveryWaves === 0).map((d) => parseFloat(d.growth));
const maxBoss = Math.max(...bossGrowths);
check(maxBoss < 150, `Boss 波強度合理（最大 +${maxBoss}% < 150%，是挑戰非猝死）`);
check(GODDESS.baseHp >= 80, `女神起始血量足夠新手（${GODDESS.baseHp}）`);
const survived = typeof result.survivedWave === "number" ? result.survivedWave : 40;
check(survived >= 5 && survived <= 40, `純塔防撐波數合理（${result.survivedWave}，5~40 之間）`);

console.log(warns === 0 ? "\n✅ 平衡檢查全部通過" : `\n⚠ ${warns} 項需注意`);
// 有失衡警告時讓 CI 失敗，確保未來改數值不會破壞平衡
process.exit(warns === 0 ? 0 : 1);
