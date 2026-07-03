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
  distanceToPath,
  canReachPath,
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

function sequenceRng(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
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

  const mapMeta = migrateMeta({ lastMap: "canyon" });
  const badMapMeta = migrateMeta({ lastMap: "missing-map" });
  assert(mapMeta.lastMap === "canyon", "lastMap 合法值會保留");
  assert(badMapMeta.lastMap === "plains", "lastMap 非法值會回預設地圖");
  for (const pollutedKey of ["__proto__", "toString", "constructor"]) {
    const polluted = migrateMeta({ lastMap: pollutedKey });
    assert(polluted.lastMap === "plains", `lastMap 原型鍵 ${pollutedKey} 會回預設地圖`);
  }
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
  assert(result.earned === 7, "普通魂晶公式為 max(1, round(wave * 1.8))");
  assert(result.isRecord === true && result.meta.bestByDiff.normal === 4 && result.meta.bestWave === 4, "最高波數與難度紀錄會更新");
  assert(result.meta.soulCrystal === 11 && result.meta.games === 3 && result.meta.totalKills === 13, "魂晶、場次與總擊殺累積正確");
  assert(meta.soulCrystal === 4 && meta.bestByDiff.normal === 3, "settleRunRewards 不改動傳入 meta");

  const brutal = settleRunRewards({ meta: migrateMeta({ soulCrystal: 0 }), wave: 10, kills: 0, difficulty: cfg.DIFFICULTIES.brutal });
  const endless = settleRunRewards({ meta: migrateMeta({ soulCrystal: 0 }), wave: 10, kills: 0, difficulty: cfg.DIFFICULTIES.endless });
  assert(brutal.earned === 24, "嚴酷魂晶公式為 round(wave * 2.4)");
  assert(endless.earned === 22, "無盡魂晶公式為 round(wave * 2.2)");
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

  const seen = new Set();
  for (let w = 3; w <= 50; w++) {
    generateWaveQueue(w, cfg.DIFFICULTIES.normal, makeRng(w * 17)).queue.forEach((spec) => seen.add(spec.type));
  }
  assert(seen.has("shieldman") && seen.has("medic"), `固定 rng 掃描可產出新敵人（${[...seen].join(",")}）`);

  const wave4Physical = generateWaveQueue(4, cfg.DIFFICULTIES.normal, sequenceRng([0.1, 0.99]));
  assert(!wave4Physical.queue.some((spec) => spec.type === "shieldman" || spec.type === "medic"),
    "第 4 波物理主題池尚未放入盾兵/醫官，避免前期跳變");
  const wave5Shield = generateWaveQueue(5, cfg.DIFFICULTIES.normal, sequenceRng([0.1, 0.8]));
  assert(wave5Shield.queue.some((spec) => spec.type === "shieldman"),
    "第 5 波起盾兵可進主題/預設池");
  const wave7Medic = generateWaveQueue(7, cfg.DIFFICULTIES.normal, sequenceRng([0.9, 0.92]));
  assert(wave7Medic.queue.some((spec) => spec.type === "medic"),
    "第 7 波起醫官可進預設池");
}

console.log("\n== 建塔格距離路徑判定 ==");
{
  const canyon = cfg.MAPS.canyon.path;
  const nearX = 504, nearY = 72;
  const farX = 936, farY = 24;
  const nearDist = distanceToPath(nearX, nearY, canyon);
  const farDist = distanceToPath(farX, farY, canyon);
  assert(nearDist <= cfg.TOWERS.arrow.range && canReachPath(nearX, nearY, canyon, cfg.TOWERS.arrow.range),
    `靠近路徑格可建（距離 ${Math.round(nearDist)} <= 射程 ${cfg.TOWERS.arrow.range}）`);
  assert(farDist > cfg.TOWERS.arrow.range && !canReachPath(farX, farY, canyon, cfg.TOWERS.arrow.range),
    `遠離路徑格不可建（距離 ${Math.round(farDist)} > 射程 ${cfg.TOWERS.arrow.range}）`);
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
