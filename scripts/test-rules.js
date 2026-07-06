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
  waveSoulReward,
  runSoulRewardTotal,
  settleRunRewards,
  settleHeroProgress,
  heroLongLevelFromXp,
  heroLongXpForLevel,
  heroPermanentBonus,
  selectMapAffix,
  affixExpectedBalance,
  recommendTowersForWave,
  adviseTowerActions,
  counterWarningForWave,
  protectMetaWrite,
  evaluateBeginnerMissions,
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
  assert(missing.beginnerMissions && Object.keys(missing.beginnerMissions).length === 0, "缺 beginnerMissions 時補空物件");
  assert(missing.heroProgress && Object.keys(missing.heroProgress).length === 0, "缺 heroProgress 時補空物件");

  const bad = migrateMeta({
    version: NaN,
    bestWave: NaN,
    totalKills: "12",
    soulCrystal: Infinity,
    games: null,
    gachaPity: undefined,
    gachaCount: 5,
    bestByDiff: { normal: NaN, brutal: 8 },
    beginnerMissions: { firstTower: true, firstWave: false, bad: "yes" },
    heroProgress: { fox: { xp: 120 }, bad: { xp: NaN }, "__proto__": { xp: 999 } },
  });
  assert(bad.version === META_VERSION, "NaN version 會修成目前版本");
  assert(bad.bestWave === 0 && bad.totalKills === 0 && bad.soulCrystal === 0 && bad.games === 0 && bad.gachaPity === 0, "NaN/非數字欄位回預設值");
  assert(bad.gachaCount === 5 && bad.bestByDiff.brutal === 8 && bad.bestByDiff.normal == null, "有效數字保留，巢狀 NaN 紀錄丟棄");
  assert(bad.beginnerMissions.firstTower === true && bad.beginnerMissions.firstWave == null && bad.beginnerMissions.bad == null,
    "beginnerMissions 只保留 true 標記");
  assert(bad.heroProgress.fox && bad.heroProgress.fox.level === heroLongLevelFromXp(120) && bad.heroProgress.bad == null,
    "heroProgress 會清洗數字與危險 key");

  const mapMeta = migrateMeta({ lastMap: "canyon" });
  const badMapMeta = migrateMeta({ lastMap: "missing-map" });
  assert(mapMeta.lastMap === "canyon", "lastMap 合法值會保留");
  assert(badMapMeta.lastMap === "plains", "lastMap 非法值會回預設地圖");
  for (const pollutedKey of ["__proto__", "toString", "constructor"]) {
    const polluted = migrateMeta({ lastMap: pollutedKey });
    assert(polluted.lastMap === "plains", `lastMap 原型鍵 ${pollutedKey} 會回預設地圖`);
  }
}

console.log("\n== R7：新手任務一次性發獎 ==");
{
  const missionRewardTotal = Object.values(cfg.BEGINNER_MISSIONS).reduce((sum, m) => sum + m.reward, 0);
  const meta = migrateMeta({ soulCrystal: 0 });
  const result = evaluateBeginnerMissions(meta, {
    towersBuilt: 1,
    clearedWave: 3,
    deployedHeroCount: 1,
    maxTowerLevel: 2,
    towerUpgrades: 1,
    skillCasts: 1,
    bossKills: 1,
    ownedHeroCount: 2,
    gachaCount: 2,
  });
  const ids = result.unlocked.map((m) => m.id).sort();
  const expected = Object.keys(cfg.BEGINNER_MISSIONS).sort();
  assert(missionRewardTotal === 38 && missionRewardTotal <= 40, `任務總額 38💎 且低於上限（actual ${missionRewardTotal}）`);
  assert(JSON.stringify(ids) === JSON.stringify(expected), "所有新手任務可由 context 觸發");
  assert(result.meta.soulCrystal === missionRewardTotal, `任務獎勵正確入帳（+${missionRewardTotal}💎）`);
  assert(expected.every((id) => result.meta.beginnerMissions[id] === true), "任務領取標記會寫入 meta");
  assert(meta.soulCrystal === 0 && Object.keys(meta.beginnerMissions).length === 0, "evaluateBeginnerMissions 不改動原 meta");
  const second = evaluateBeginnerMissions(result.meta, {
    towersBuilt: 1,
    clearedWave: 3,
    deployedHeroCount: 1,
    maxTowerLevel: 2,
    towerUpgrades: 1,
    skillCasts: 1,
    bossKills: 1,
    ownedHeroCount: 2,
    gachaCount: 2,
  });
  assert(second.unlocked.length === 0 && second.meta.soulCrystal === missionRewardTotal, "已領任務不重複發獎");
}

console.log("\n== R17：地圖詞綴與英雄長線養成 ==");
{
  const affixes = Object.values(cfg.MAP_AFFIXES || {});
  assert(affixes.length >= 4 && affixes.length <= 6, `地圖詞綴維持 4~6 種（目前 ${affixes.length}）`);
  const first = selectMapAffix("daily-2026-07-05");
  const second = selectMapAffix("daily-2026-07-05");
  assert(first && first.id === second.id, "selectMapAffix 對相同 seed 可重現");
  const balances = affixes.map((a) => affixExpectedBalance(a));
  assert(balances.every((b) => Number.isFinite(b.goldDelta) && Number.isFinite(b.powerDelta) && Math.abs(b.netDelta) <= 0.2),
    "詞綴期望淨值維持在 +/-20% 內");
  const harvest = cfg.MAP_AFFIXES.harvest;
  const base = generateWaveQueue(4, cfg.DIFFICULTIES.normal, makeRng(123));
  const withAffix = generateWaveQueue(4, cfg.DIFFICULTIES.normal, makeRng(123), harvest);
  assert(withAffix.affix.id === "harvest" && withAffix.hpScale > base.hpScale,
    "generateWaveQueue 會套用詞綴血量倍率並回傳 affix");

  const progress = settleHeroProgress(migrateMeta({ heroProgress: { fox: { xp: 20 } } }), [
    { id: "fox", runXp: 50 },
    { id: "nezha", xp: 120 },
  ]);
  assert(progress.meta.heroProgress.fox.xp === 30 && progress.entries.find((e) => e.id === "fox").savedXp === 10,
    "本局 XP 20% 轉入既有英雄長線 XP");
  assert(progress.meta.heroProgress.nezha.xp === 24 && progress.meta.heroProgress.nezha.level === 2,
    "新英雄長線 XP 會建立進度與等級");
  assert(heroPermanentBonus(1) === 0 && heroPermanentBonus(5) === 0.05 && heroPermanentBonus(15) === 0.15,
    "羈絆永久加成每 5 級 +5%，上限 +15%");
  assert(heroLongXpForLevel(5) === 96 && heroLongXpForLevel(10) === 216 && heroLongXpForLevel(15) === 336,
    "羈絆節點 XP 可由純函式查詢");
}

console.log("\n== R21：下一波建議塔種純函式 ==");
{
  const names = (queue) => recommendTowersForWave({ queue }).map((item) => item.id);
  const iceWave = names([{ type: "frostwolf" }, { type: "frostwolf" }, { type: "slime" }]);
  const batWave = names([{ type: "bat" }, { type: "bat" }, { type: "goblin" }]);
  const shieldWave = names([{ type: "shieldman" }, { type: "shieldman" }, { type: "orc" }]);
  const bossWave = recommendTowersForWave({ queue: [{ type: "boss" }, { type: "medic" }, { type: "imp" }] });
  assert(iceWave.includes("cannon"), `冰系敵人會推薦火系加農砲（${iceWave.join(",")}）`);
  assert(batWave.includes("frost"), `雷系/高速敵人會推薦寒冰塔（${batWave.join(",")}）`);
  assert(shieldWave.includes("poison"), `盾兵與高血敵會推薦毒霧塔（${shieldWave.join(",")}）`);
  assert(bossWave.length <= 3 && bossWave.some((item) => item.id === "tesla") && bossWave.every((item) => item.reason),
    `Boss/火系混波會推薦含理由的前三塔種（${bossWave.map((item) => `${item.id}:${item.reason}`).join(" / ")}）`);
}

console.log("\n== R25：塔陣顧問、克制警告與存檔保護 ==");
{
  const path = cfg.MAPS.plains.path;
  const fastWave = {
    queue: [{ type: "bat" }, { type: "bat" }, { type: "goblin" }],
    towers: [{ type: "arrow", level: 1, x: 216, y: 72, cx: 4, cy: 1 }],
    gold: 90,
    path,
  };
  const advice = adviseTowerActions(fastWave);
  assert(advice[0] && advice[0].kind === "build" && advice[0].towerId === "frost" && advice[0].zone,
    `無冰塔遇高速/雷系波會優先建議補寒冰塔（${advice.map((a) => `${a.kind}:${a.towerId}:${a.zone}`).join(",")}）`);
  assert(Number.isFinite(advice[0].x) && Number.isFinite(advice[0].y) && advice[0].reason.includes("覆蓋"),
    "顧問建塔建議包含可落點區域與理由");

  const iceWarning = counterWarningForWave({
    queue: [{ type: "frostwolf" }, { type: "frostwolf" }, { type: "frostwolf" }, { type: "slime" }],
    towers: [{ type: "arrow", level: 1, x: 216, y: 72, cx: 4, cy: 1 }],
  });
  assert(iceWarning && iceWarning.message.includes("冰系") && iceWarning.message.includes("火系"),
    `下波主冰且沒有火塔時產生克制警告（${iceWarning && iceWarning.message}）`);
  const noWarning = counterWarningForWave({
    queue: [{ type: "frostwolf" }, { type: "frostwolf" }, { type: "frostwolf" }, { type: "slime" }],
    towers: [{ type: "cannon", level: 1, x: 216, y: 72, cx: 4, cy: 1 }],
  });
  assert(noWarning === null, "已有克制塔時不誤報開波警告");

  const current = migrateMeta({
    soulCrystal: 99,
    games: 5,
    board: { normal: { plains: [{ wave: 9, score: 900, kills: 30, at: 1, map: "plains" }] } },
  });
  const badWrite = protectMetaWrite(current, { soulCrystal: NaN, games: 0, board: "bad" });
  assert(badWrite.ok === false && badWrite.meta.soulCrystal === 99 && badWrite.meta.games === 5,
    "壞 meta 寫入會被拒絕並保留上一份有效資料");
  const goodWrite = protectMetaWrite(current, Object.assign({}, current, { soulCrystal: 88 }));
  assert(goodWrite.ok === true && goodWrite.meta.soulCrystal === 88,
    "合法 meta 寫入可通過保護層");
}

console.log("\n== waveSoulReward 即時魂晶總量守恆 ==");
{
  const cases = [
    { id: "normal", wave: 10, expected: 18 },
    { id: "brutal", wave: 10, expected: 24 },
    { id: "endless", wave: 10, expected: 22 },
  ];
  for (const c of cases) {
    let sum = 0;
    for (let w = 1; w <= c.wave; w++) sum += waveSoulReward(w, c.id);
    assert(sum === c.expected, `${c.id} 第 ${c.wave} 波逐波總和 = ${c.expected}（actual ${sum}）`);
    assert(runSoulRewardTotal(c.wave, c.id) === c.expected, `${c.id} 累計公式等於舊 round(wave * multiplier)`);
    assert(sum === runSoulRewardTotal(c.wave, c.id), `${c.id} 逐波差分與累計總額一致`);
  }
  assert(waveSoulReward(0, "normal") === 0 && runSoulRewardTotal(0, "normal") === 0, "第 0 波不給魂晶");
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
  const result = settleRunRewards({ meta, wave: 4, score: 120, kills: 6, difficulty: cfg.DIFFICULTIES.normal, soulEarned: 7 });
  assert(result.earned === 7, "死亡結算只回報本局已即時入袋魂晶");
  assert(result.isRecord === true && result.meta.bestByDiff.normal === 4 && result.meta.bestWave === 4, "最高波數與難度紀錄會更新");
  assert(result.meta.soulCrystal === 4 && result.meta.games === 3 && result.meta.totalKills === 13, "死亡結算不再二次增加清波魂晶，場次與總擊殺仍累積");
  assert(meta.soulCrystal === 4 && meta.bestByDiff.normal === 3, "settleRunRewards 不改動傳入 meta");

  const brutal = settleRunRewards({ meta: migrateMeta({ soulCrystal: 10 }), wave: 10, kills: 0, difficulty: cfg.DIFFICULTIES.brutal });
  const endless = settleRunRewards({ meta: migrateMeta({ soulCrystal: 10 }), wave: 10, kills: 0, difficulty: cfg.DIFFICULTIES.endless });
  assert(brutal.earned === 0 && brutal.meta.soulCrystal === 10, "未傳 soulEarned 時嚴酷死亡不補發波數魂晶");
  assert(endless.earned === 0 && endless.meta.soulCrystal === 10, "未傳 soulEarned 時無盡死亡不補發波數魂晶");
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
