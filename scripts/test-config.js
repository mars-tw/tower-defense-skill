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

console.log("");
if (failed === 0) { console.log("✅ 全部測試通過"); process.exit(0); }
else { console.error(`❌ ${failed} 項失敗`); process.exit(1); }
