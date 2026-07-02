/* =========================================================================
 * test-rules.js — rules.js 純函式單元測試
 *
 * 執行：node scripts/test-rules.js
 * ========================================================================= */
const fs = require("fs");
const path = require("path");
const cfg = require(path.join(__dirname, "..", "src", "config.js"));
const rules = require(path.join(__dirname, "..", "src", "rules.js"));

const {
  META_VERSION,
  migrateMeta,
  settleRunRewards,
  generateWaveQueue,
  applyDifficulty,
} = rules;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { console.error("  ✗ " + msg); failed++; }
}

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function constantRng(value) {
  return () => value;
}

console.log("== 純函式邊界 ==");
{
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "rules.js"), "utf8");
  assert(!source.includes("Math.random"), "rules.js 內沒有 Math.random");
  assert(!source.includes("Date.now"), "rules.js 內沒有 Date.now");
  assert(!/\bdocument\b/.test(source), "rules.js 內沒有 DOM document");
  assert(!/\blocalStorage\b/.test(source), "rules.js 內沒有 localStorage");
}

console.log("\n== migrateMeta 版本化與舊存檔遷移 ==");
{
  const old = migrateMeta({
    bestWave: 7,
    totalKills: 12,
    soulCrystal: 9,
    games: 2,
    gachaPity: 3,
    gachaCount: 4,
    bestByDiff: { normal: 6 },
  });
  assert(old.version === META_VERSION, `無 version 舊存檔升級到 version ${META_VERSION}`);
  assert(old.bestWave === 7 && old.soulCrystal === 9 && old.bestByDiff.normal === 6, "舊存檔有效欄位無損保留");

  const missing = migrateMeta({ version: 1, bestWave: 2 });
  assert(missing.bestWave === 2 && missing.soulCrystal === 0 && missing.gachaCount === 0, "缺欄位以預設值補齊");
  assert(missing.bestByDiff && Object.keys(missing.bestByDiff).length === 0, "缺 bestByDiff 時補空物件");

  const bad = migrateMeta({
    version: NaN,
    bestWave: NaN,
    totalKills: "12",
    soulCrystal: Infinity,
    games: null,
    gachaPity: undefined,
    gachaCount: 5,
    bestByDiff: { normal: NaN, brutal: 8 },
  });
  assert(bad.version === META_VERSION, "NaN version 會修成目前版本");
  assert(bad.bestWave === 0 && bad.totalKills === 0 && bad.soulCrystal === 0 && bad.games === 0 && bad.gachaPity === 0, "NaN/非數字欄位回預設值");
  assert(bad.gachaCount === 5 && bad.bestByDiff.brutal === 8 && bad.bestByDiff.normal == null, "有效數字保留，巢狀 NaN 紀錄丟棄");
}

console.log("\n== settleRunRewards 死亡結算 ==");
{
  const meta = migrateMeta({
    bestWave: 3,
    totalKills: 7,
    soulCrystal: 4,
    games: 2,
    gachaPity: 5,
    gachaCount: 1,
    bestByDiff: { normal: 3 },
  });
  const result = settleRunRewards({ meta, wave: 4, score: 120, kills: 6, difficulty: cfg.DIFFICULTIES.normal });
  assert(result.earned === 6, "魂晶公式為 max(1, round(wave * 1.5))");
  assert(result.isRecord === true && result.meta.bestByDiff.normal === 4 && result.meta.bestWave === 4, "最高波數與難度紀錄會更新");
  assert(result.meta.soulCrystal === 10 && result.meta.games === 3 && result.meta.totalKills === 13, "魂晶、場次與總擊殺累積正確");
  assert(meta.soulCrystal === 4 && meta.bestByDiff.normal === 3, "settleRunRewards 不改動傳入 meta");
}

console.log("\n== applyDifficulty 難度係數 ==");
{
  const brutal = applyDifficulty({ hp: 100, hpScale: 2, gold: 100, goldBonus: 200, goddessHp: 100, other: 7 }, cfg.DIFFICULTIES.brutal);
  assert(brutal.hp === 150 && brutal.hpScale === 3, "嚴酷 hpMul 套用到 hp/hpScale");
  assert(brutal.gold === 85 && brutal.goldBonus === 170, "嚴酷 goldMul 套用到 gold/goldBonus");
  assert(brutal.goddessHp === 80 && brutal.other === 7, "嚴酷 goddessMul 套用且無關欄位保留");
  assert(applyDifficulty(100, cfg.DIFFICULTIES.endless) === 130, "數字 base 預設套用 hpMul");
}

console.log("\n== generateWaveQueue 可重現與主題偏置 ==");
{
  const a = generateWaveQueue(9, cfg.DIFFICULTIES.normal, makeRng(42));
  const b = generateWaveQueue(9, cfg.DIFFICULTIES.normal, makeRng(42));
  assert(JSON.stringify(a.queue) === JSON.stringify(b.queue), "固定 rng 下波次 queue 可重現");
  assert(a.theme === "ice" && a.event === null && !a.isBoss, "第 9 波為 ice 主題且非事件/非 Boss");

  const themed = generateWaveQueue(9, cfg.DIFFICULTIES.normal, constantRng(0.1));
  const themeCount = themed.queue.filter((spec) => cfg.ENEMIES[spec.type].element === themed.theme).length;
  assert(themeCount === themed.count && themed.count > 0, `主題偏置生效（${themeCount}/${themed.count} 為 ${themed.theme} 系）`);
}

console.log("\n== 事件波與 Boss 波互斥（三難度） ==");
{
  for (const diff of Object.values(cfg.DIFFICULTIES)) {
    let eventCount = 0;
    let overlap = 0;
    for (let w = 1; w <= 60; w++) {
      const plan = generateWaveQueue(w, diff, makeRng(w));
      const bossSpecs = plan.queue.filter((spec) => spec.type === "boss").length;
      if (plan.event) eventCount++;
      if (plan.event && plan.isBoss) overlap++;
      if (plan.isBoss && (plan.event || bossSpecs !== 1)) overlap++;
    }
    assert(eventCount >= 5, `${diff.label} 60 波內有事件波（${eventCount} 次）`);
    assert(overlap === 0, `${diff.label} 事件波與 Boss 波不互撞`);
  }
}

console.log("");
if (failed === 0) {
  console.log("✅ rules.js 單元測試全部通過");
  process.exit(0);
}
console.error(`❌ ${failed} 項失敗`);
process.exit(1);
