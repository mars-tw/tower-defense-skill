/* =========================================================================
 * test-config.js — 塔防 config.js 健全性測試（CI 用，零依賴）
 * 執行：node scripts/test-config.js
 * ========================================================================= */

const path = require("path");
const cfg = require(path.join(__dirname, "..", "src", "config.js"));
const { TOWERS, ENEMIES, SKILLS, ELEMENTS, elementMultiplier, GAME, UPGRADE, MAPS, ACHIEVEMENTS, BEGINNER_MISSIONS } = cfg;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { console.error("  ✗ " + msg); failed++; }
}

console.log("== 結構 ==");
assert(Object.keys(TOWERS).length >= 6, `砲塔 ≥6 種（${Object.keys(TOWERS).length}）`);
assert(Object.keys(ENEMIES).length >= 9, `敵人 ≥9 種（${Object.keys(ENEMIES).length}）`);
assert(Object.keys(SKILLS).length >= 3, `技能 ≥3 種（${Object.keys(SKILLS).length}）`);
assert(Object.values(ENEMIES).some((e) => e.boss), "至少有一個 Boss");

console.log("== 砲塔欄位 ==");
let badT = 0;
for (const t of Object.values(TOWERS)) {
  if (!t.id || !t.name || t.range == null || t.damage == null || t.cost == null || !t.element) badT++;
  if (!ELEMENTS[t.element]) badT++;
}
assert(badT === 0, `砲塔欄位完整且元素合法（異常 ${badT}）`);
assert(TOWERS.poison && TOWERS.poison.poisonDps > 0 && TOWERS.poison.poisonDuration > 0 && TOWERS.poison.poisonMaxStacks === 3,
  "毒霧塔有 DoT 欄位（DPS/持續/最多 3 層）");
assert(TOWERS.support && TOWERS.support.support === true && TOWERS.support.buff > 0 && TOWERS.support.damage === 0 && TOWERS.support.fireRate === 0,
  "聖光塔為不攻擊支援塔，且有 buff 欄位");
assert(TOWERS.frost.cost === 70 && TOWERS.frost.fireRate === 1.45 && TOWERS.frost.slow === 0.5,
  "寒冰塔 Stage 5 定位：70 金、1.45 攻速、維持 50% 減速");
assert(TOWERS.support.cost === 110 && TOWERS.support.buff === 0.20 && TOWERS.support.buffPerLevel === 0.04,
  "聖光塔 Stage 5 定位：110 金、20% 基礎增傷、每級 +4%");

console.log("== 敵人欄位 ==");
let badE = 0;
for (const e of Object.values(ENEMIES)) {
  if (!e.id || e.hp == null || e.speed == null || e.reward == null || !e.element) badE++;
}
assert(badE === 0, `敵人欄位完整（異常 ${badE}）`);
assert(ENEMIES.shieldman && ENEMIES.shieldman.shield > 0 && ENEMIES.shieldman.element === "physical",
  "盾兵有護盾且歸物理系");
assert(ENEMIES.medic && ENEMIES.medic.healRadius === 80 && ENEMIES.medic.healAmount > 0 && ENEMIES.medic.healInterval === 2,
  "醫官有治療半徑、治療量與 2 秒間隔");

console.log("== Stage 4：地圖資料 ==");
let badMap = 0;
for (const m of Object.values(MAPS || {})) {
  if (!m.id || !m.label || !(m.goldMul > 0) || !Array.isArray(m.path) || m.path.length < 2) badMap++;
  if (Array.isArray(m.path) && m.path.some((p) => typeof p.x !== "number" || typeof p.y !== "number")) badMap++;
}
assert(Object.keys(MAPS || {}).length >= 2, `至少 2 張地圖（實際 ${Object.keys(MAPS || {}).length}）`);
assert(badMap === 0, `地圖欄位完整且 path 合法（異常 ${badMap}）`);
assert(MAPS.plains && MAPS.canyon && MAPS.canyon.path.length > MAPS.plains.path.length && MAPS.canyon.goldMul < MAPS.plains.goldMul,
  "迂迴峽谷路徑較曲折且資源較少");
for (const pollutedKey of ["__proto__", "toString", "constructor"]) {
  cfg.setMap("canyon");
  cfg.setMap(pollutedKey);
  assert(cfg.getMap().id === "canyon", `setMap 忽略原型鍵 ${pollutedKey}`);
}
cfg.setMap("plains");

console.log("== 元素克制 ==");
assert(elementMultiplier("fire", "ice") === 1.5, "火克冰 = 1.5");
assert(elementMultiplier("ice", "fire") === 0.66, "冰被火克 = 0.66");
assert(elementMultiplier("thunder", "fire") === 1.5, "雷克火 = 1.5");
assert(elementMultiplier("physical", "ice") === 1, "物理中性 = 1");

console.log("== 平衡參數 ==");
assert(GAME.startGold > 0, "起始金錢為正");
assert(GAME.hpGrowthEarly > 0 && GAME.hpGrowthLate > 0, "波次血量有成長（無盡遞增，分段）");
assert(UPGRADE.maxLevel >= 2, "砲塔可升級");
assert(UPGRADE.maxLevel === 10, "砲塔升級上限提高到 Lv.10");
assert(UPGRADE.damageMul > 1 && UPGRADE.rangeMul > 1 && UPGRADE.costMul > 1, "升級傷害、射程與造價皆隨等級遞增");
assert(UPGRADE.costMul >= 1.5 && UPGRADE.costMul <= 1.6, `Lv.10 造價曲線維持後期金錢出口（costMul=${UPGRADE.costMul}）`);
{
  const attackRanges = Object.values(TOWERS).filter((t) => !t.support).map((t) => t.range);
  assert(Math.min(...attackRanges) >= 120 && Math.max(...attackRanges) <= 140,
    `攻擊塔基礎射程小幅提高且未全圖化（${Math.min(...attackRanges)}~${Math.max(...attackRanges)}px）`);
  assert(TOWERS.support.range === 150, "聖光塔支援射程提高到 150px");
}

console.log("== 守護女神 ==");
const { GODDESS } = cfg;
assert(GODDESS && GODDESS.baseHp > 0, "女神有起始生命");
assert(GODDESS.maxLevel >= 2 && GODDESS.hpPerLevel > 0, "女神可升級加生命");
assert(GODDESS.maxLevel === 8, "女神升級上限提高到 Lv.8");
assert(GODDESS.smiteUnlockLevel >= 1, "女神有聖光反擊解鎖等級");

console.log("== Stage 1：元素克制閉環 ==");
const { COUNTERS, DIFFICULTIES, EVENT_WAVES, getEventWave, waveTheme, themeEnemyPool } = cfg;
// 每個元素塔的克制目標都要有實際存在的普通敵人——不然「火克冰」只是教學裡的空話
for (const [atk, def] of Object.entries(COUNTERS)) {
  const targets = Object.values(ENEMIES).filter((e) => !e.boss && e.element === def);
  assert(targets.length >= 1, `${atk} 克 ${def}：場上有 ${def} 系普通敵人可克制（${targets.map((e) => e.id).join(",") || "無"}）`);
}

console.log("== Stage 1：波次主題與敵人池一致 ==");
// 預告顯示的每個主題，themeEnemyPool 都要有敵人，出怪偏壓才有東西可抽
const themesSeen = new Set();
for (let w = 4; w <= 40; w++) { const t = waveTheme(w); if (t) themesSeen.add(t); }
assert(themesSeen.size >= 3, `波次主題輪替涵蓋多元素（${[...themesSeen].join(",")}）`);
for (const t of themesSeen) {
  assert(themeEnemyPool(t) !== null, `主題「${t}」有對應敵人池（${(themeEnemyPool(t) || []).join(",")}）`);
}
{
  const physicalPool = themeEnemyPool("physical") || [];
  assert(physicalPool.includes("shieldman"), "物理主題池包含盾兵");
  assert(physicalPool.includes("medic"), "物理主題池包含醫官");
}

console.log("== Stage 1：事件波在所有難度都會出現 ==");
// 修正前 wave%3===0 撞上無盡難度 bossEvery=3，事件波在該難度永遠不觸發
for (const d of Object.values(DIFFICULTIES)) {
  let count = 0;
  for (let w = 1; w <= 30; w++) {
    const isBoss = w % d.bossEvery === 0;
    if (getEventWave(w, isBoss, 0.5)) count++;
  }
  assert(count >= 5, `【${d.label}】前 30 波至少 5 次事件波（實際 ${count}）`);
}
// 事件波永不與 Boss 波重疊
{
  let overlap = 0;
  for (const d of Object.values(DIFFICULTIES)) {
    for (let w = 1; w <= 60; w++) {
      const isBoss = w % d.bossEvery === 0;
      if (isBoss && getEventWave(w, isBoss, 0.5)) overlap++;
    }
  }
  assert(overlap === 0, "事件波永不與 Boss 波重疊（isBoss 保護有效）");
}

console.log("== Stage 1：難度/事件波欄位健全 ==");
let badD = 0;
for (const d of Object.values(DIFFICULTIES)) {
  if (!(d.hpMul > 0) || !(d.goldMul > 0) || !(d.goddessMul > 0) || !(d.bossEvery >= 1)) badD++;
}
assert(badD === 0, `難度欄位完整且為正（異常 ${badD}）`);
let badEv = 0;
for (const e of Object.values(EVENT_WAVES)) {
  if (!(e.speedMul > 0) || !(e.hpMul > 0) || !(e.countMul > 0) || !(e.goldMul > 0)) badEv++;
  if (e.forceType && !ENEMIES[e.forceType]) badEv++;
  if (e.forceType === "medic") badEv++;
}
assert(badEv === 0, `事件波欄位完整、forceType 指向存在敵人且不強制醫官（異常 ${badEv}）`);

console.log("== Stage 3：成就目錄 ==");
let badAch = 0;
for (const a of Object.values(ACHIEVEMENTS || {})) {
  if (!a.id || !a.label || !a.desc || typeof a.check !== "function" || !(a.reward >= 0)) badAch++;
}
assert(Object.keys(ACHIEVEMENTS || {}).length >= 8, `成就至少 8 個（實際 ${Object.keys(ACHIEVEMENTS || {}).length}）`);
assert(badAch === 0, `成就欄位完整且 reward 合法（異常 ${badAch}）`);

console.log("== R7：首 10 波任務線 ==");
let badMission = 0;
let missionRewardTotal = 0;
for (const m of Object.values(BEGINNER_MISSIONS || {})) {
  if (!m.id || !m.label || !m.desc || typeof m.check !== "function" || !(m.reward > 0)) badMission++;
  missionRewardTotal += m.reward || 0;
}
assert(Object.keys(BEGINNER_MISSIONS || {}).length >= 5 && Object.keys(BEGINNER_MISSIONS || {}).length <= 8,
  `任務數量 5~8 個（實際 ${Object.keys(BEGINNER_MISSIONS || {}).length}）`);
assert(badMission === 0, `任務欄位完整且 reward 合法（異常 ${badMission}）`);
assert(missionRewardTotal <= 40, `任務線總增發 ≤40💎（實際 ${missionRewardTotal}💎）`);

console.log("");
if (failed === 0) { console.log("✅ 全部測試通過"); process.exit(0); }
else { console.error(`❌ ${failed} 項失敗`); process.exit(1); }
