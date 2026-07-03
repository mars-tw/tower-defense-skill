/* =========================================================================
 * test-board.js — Stage 3 排行榜與成就規則測試
 *
 * 執行：node scripts/test-board.js
 * ========================================================================= */
const path = require("path");
const cfg = require(path.join(__dirname, "..", "src", "config.js"));
const heroes = require(path.join(__dirname, "..", "src", "heroes.js"));
const rules = require(path.join(__dirname, "..", "src", "rules.js"));

const {
  META_VERSION,
  migrateMeta,
  updateBoard,
  evaluateAchievements,
  settleRunRewards,
  waveSoulReward,
  runSoulRewardTotal,
} = rules;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { console.error("  ✗ " + msg); failed++; }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

console.log("== updateBoard 排序、截斷、名次、不 mutate ==");
{
  const board = {
    normal: [
      { wave: 12, score: 900, kills: 40, at: 1000 },
      { wave: 11, score: 2000, kills: 35, at: 1100 },
      { wave: 12, score: 700, kills: 38, at: 1200 },
    ],
  };
  const before = clone(board);
  const result = updateBoard(board, "normal", { wave: 12, score: 800, kills: 41, at: 1300, map: "canyon" }, 10);
  assert(result.rank === 2, `同 wave 依 score 排序，名次為 ${result.rank}`);
  assert(result.board.normal.map((e) => `${e.wave}/${e.score}`).join(",") === "12/900,12/800,12/700,11/2000", "排行榜依 wave 降冪、同 wave 依 score 降冪");
  assert(result.board.normal[1].map === "canyon", "排行榜 entry 會保留可選的 map id");
  assert(JSON.stringify(board) === JSON.stringify(before), "updateBoard 不改動原 board");

  const full = { brutal: [] };
  for (let i = 0; i < 10; i++) full.brutal.push({ wave: 20 - i, score: 1000 - i, kills: 50, at: 2000 + i });
  const low = updateBoard(full, "brutal", { wave: 1, score: 9999, kills: 1, at: 9999 }, 10);
  assert(low.rank === null && low.board.brutal.length === 10, "未進前 10 回傳 rank null 並維持 10 筆");
  const high = updateBoard(full, "brutal", { wave: 30, score: 1, kills: 1, at: 3000 }, 10);
  assert(high.rank === 1 && high.board.brutal.length === 10 && high.board.brutal[0].wave === 30, "新高分進榜第 1 名並截斷為 10 筆");
}

console.log("\n== evaluateAchievements 觸發、獎勵、一次性、不 mutate ==");
{
  const meta = migrateMeta({ soulCrystal: 5, totalKills: 1000, games: 50 });
  const before = clone(meta);
  const result = evaluateAchievements(meta, {
    wave: 30,
    ownedHeroCount: Object.keys(heroes.HEROES).length,
    totalHeroCount: Object.keys(heroes.HEROES).length,
  });
  const ids = result.unlocked.map((a) => a.id).sort();
  const expected = Object.keys(cfg.ACHIEVEMENTS).sort();
  const rewardSum = Object.values(cfg.ACHIEVEMENTS).reduce((sum, ach) => sum + ach.reward, 0);
  assert(JSON.stringify(ids) === JSON.stringify(expected), "波數、累殺、場次、英雄收集成就都會觸發");
  assert(result.meta.soulCrystal === 5 + rewardSum, `魂晶獎勵正確累加（+${rewardSum}）`);
  assert(expected.every((id) => result.meta.achievements[id] === true), "已解鎖表會標記所有新成就");
  assert(JSON.stringify(meta) === JSON.stringify(before), "evaluateAchievements 不改動原 meta");

  const second = evaluateAchievements(result.meta, {
    wave: 30,
    ownedHeroCount: Object.keys(heroes.HEROES).length,
    totalHeroCount: Object.keys(heroes.HEROES).length,
  });
  assert(second.unlocked.length === 0, "已解鎖成就不重複發獎");
  assert(second.meta.soulCrystal === result.meta.soulCrystal, "重跑 evaluateAchievements 不重複增加魂晶");
}

console.log("\n== 即時魂晶入袋後死亡不重複結算 ==");
{
  let immediate = 0;
  for (let w = 1; w <= 10; w++) immediate += waveSoulReward(w, "normal");
  assert(immediate === 18 && runSoulRewardTotal(10, "normal") === 18, "普通第 10 波逐波魂晶總和等於舊公式 18");

  const meta = migrateMeta({ soulCrystal: immediate });
  const result = settleRunRewards({
    meta,
    wave: 10,
    score: 500,
    kills: 25,
    difficulty: cfg.DIFFICULTIES.normal,
    soulEarned: immediate,
  });
  assert(result.earned === immediate, "死亡畫面可顯示本局已獲得魂晶");
  assert(result.meta.soulCrystal === immediate, "死亡結算不二次加清波魂晶");

  const second = settleRunRewards({
    meta: result.meta,
    wave: 10,
    score: 500,
    kills: 25,
    difficulty: cfg.DIFFICULTIES.normal,
    soulEarned: immediate,
  });
  assert(second.meta.soulCrystal === immediate, "重跑死亡結算也不會重複入帳魂晶");
}

console.log("\n== migrateMeta v1/v2 → v3 與污染清洗 ==");
{
  const v1 = migrateMeta({ bestWave: 8, soulCrystal: 12, bestByDiff: { normal: 8 } });
  assert(v1.version === META_VERSION && META_VERSION === 3, "v1 無 version 存檔升級到 version 3");
  assert(v1.bestWave === 8 && v1.soulCrystal === 12 && v1.bestByDiff.normal === 8, "v1 有效欄位無損保留");
  assert(v1.board && Object.keys(v1.board).length === 0 && v1.achievements && Object.keys(v1.achievements).length === 0, "v1 補齊 board/achievements");

  const v2 = migrateMeta({
    version: 2,
    bestWave: 14,
    totalKills: 120,
    soulCrystal: 20,
    games: 9,
    gachaPity: 4,
    gachaCount: 6,
    bestByDiff: { normal: 14 },
  });
  assert(v2.version === 3 && v2.totalKills === 120 && v2.gachaCount === 6, "v2 存檔無損升級到 version 3");
  const mapMeta = migrateMeta({ lastMap: "canyon" });
  const badMapMeta = migrateMeta({ lastMap: "unknown" });
  assert(mapMeta.lastMap === "canyon" && badMapMeta.lastMap === "plains", "lastMap 合法保留、非法回預設");
  for (const pollutedKey of ["__proto__", "toString", "constructor"]) {
    assert(migrateMeta({ lastMap: pollutedKey }).lastMap === "plains", `lastMap 原型鍵 ${pollutedKey} 會回預設`);
  }

  const polluted = migrateMeta({
    version: 3,
    board: {
      normal: [
        { wave: 5, score: 100, kills: 10, at: 1000 },
        { wave: "bad", score: 999, kills: 10, at: 1001 },
        { wave: 6, score: 80, kills: NaN, at: 1002 },
        { wave: 7, score: 200, kills: 12, at: 1003 },
      ],
      brutal: "bad",
    },
    achievements: { wave10: true, wave20: false, bad: "yes" },
  });
  assert(polluted.board.normal.length === 2 && polluted.board.normal[0].wave === 7 && polluted.board.brutal == null, "board 只保留合法項並排序，非法難度資料丟棄");
  assert(polluted.achievements.wave10 === true && polluted.achievements.wave20 == null && polluted.achievements.bad == null, "achievements 只保留 true 標記");

  const badAch = migrateMeta({ achievements: "污染", board: [{ wave: 1 }] });
  assert(Object.keys(badAch.achievements).length === 0 && Object.keys(badAch.board).length === 0, "achievements 非物件、board 非物件時重置");
}

console.log("");
if (failed === 0) {
  console.log("✅ 排行榜與成就測試全部通過");
  process.exit(0);
}
console.error(`❌ ${failed} 項失敗`);
process.exit(1);
