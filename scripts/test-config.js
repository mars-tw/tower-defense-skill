/* =========================================================================
 * test-config.js — 塔防 config.js 健全性測試（CI 用，零依賴）
 * 執行：node scripts/test-config.js
 * ========================================================================= */

const path = require("path");
const cfg = require(path.join(__dirname, "..", "src", "config.js"));
const { TOWERS, ENEMIES, SKILLS, ELEMENTS, elementMultiplier, GAME, UPGRADE } = cfg;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { console.error("  ✗ " + msg); failed++; }
}

console.log("== 結構 ==");
assert(Object.keys(TOWERS).length >= 4, `砲塔 ≥4 種（${Object.keys(TOWERS).length}）`);
assert(Object.keys(ENEMIES).length >= 4, `敵人 ≥4 種（${Object.keys(ENEMIES).length}）`);
assert(Object.keys(SKILLS).length >= 3, `技能 ≥3 種（${Object.keys(SKILLS).length}）`);
assert(Object.values(ENEMIES).some((e) => e.boss), "至少有一個 Boss");

console.log("== 砲塔欄位 ==");
let badT = 0;
for (const t of Object.values(TOWERS)) {
  if (!t.id || !t.name || t.range == null || t.damage == null || t.cost == null || !t.element) badT++;
  if (!ELEMENTS[t.element]) badT++;
}
assert(badT === 0, `砲塔欄位完整且元素合法（異常 ${badT}）`);

console.log("== 敵人欄位 ==");
let badE = 0;
for (const e of Object.values(ENEMIES)) {
  if (!e.id || e.hp == null || e.speed == null || e.reward == null || !e.element) badE++;
}
assert(badE === 0, `敵人欄位完整（異常 ${badE}）`);

console.log("== 元素克制 ==");
assert(elementMultiplier("fire", "ice") === 1.5, "火克冰 = 1.5");
assert(elementMultiplier("ice", "fire") === 0.66, "冰被火克 = 0.66");
assert(elementMultiplier("thunder", "fire") === 1.5, "雷克火 = 1.5");
assert(elementMultiplier("physical", "ice") === 1, "物理中性 = 1");

console.log("== 平衡參數 ==");
assert(GAME.startGold > 0, "起始金錢為正");
assert(GAME.hpGrowthEarly > 0 && GAME.hpGrowthLate > 0, "波次血量有成長（無盡遞增，分段）");
assert(UPGRADE.maxLevel >= 2, "砲塔可升級");

console.log("== 守護女神 ==");
const { GODDESS } = cfg;
assert(GODDESS && GODDESS.baseHp > 0, "女神有起始生命");
assert(GODDESS.maxLevel >= 2 && GODDESS.hpPerLevel > 0, "女神可升級加生命");
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
}
assert(badEv === 0, `事件波欄位完整、forceType 指向存在的敵人（異常 ${badEv}）`);

console.log("");
if (failed === 0) { console.log("✅ 全部測試通過"); process.exit(0); }
else { console.error(`❌ ${failed} 項失敗`); process.exit(1); }
