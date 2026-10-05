/* node scripts/test-operations.js — 每局任務、發獎與舊存檔相容性。 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("../src/config.js");
const rules = require("../src/rules.js");
const ops = require("../src/operations.js");
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`  ✓ ${name}`); }
function context(extra = {}) {
  return Object.assign({ runSeed: 718, affixSeed: 611, mapId: "plains", difficultyId: "normal", wave: 0, clearedWave: 0,
    towers: [], over: false, combatTelemetry: { waves: {} } }, extra);
}
function tower(type, level = 1, x = 100, y = 100) { return { type, level, x, y }; }
function seedFor(tactic, clearedWave) {
  for (let seed = 1; seed <= 1000; seed++) {
    const ctx = context({ runSeed: seed, clearedWave, wave: clearedWave + 1 });
    if (ops.chapterFor(ctx).tactic.id === tactic) return ctx;
  }
  throw new Error(`Missing selectable tactic ${tactic}`);
}

console.log("== 每局戰役與戰術任務 ==");
test("模組維持純函式邊界", () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/operations.js"), "utf8");
  assert(!/Math\.random|Date\.now|\blocalStorage\b|\bdocument\b/.test(source));
});
test("相同種子產生相同任務，而且種子有可玩的變化", () => {
  const ctx = context({ clearedWave: 5, wave: 6 });
  assert.deepEqual(ops.chapterFor(ctx), ops.chapterFor(JSON.parse(JSON.stringify(ctx))));
  const cards = new Set();
  for (let seed = 1; seed <= 100; seed++) cards.add(ops.chapterFor(context({ runSeed: seed, clearedWave: 5 })).tactic.id);
  assert(cards.size >= 3);
});
test("第一章只能靠兩種攻擊塔完成，支援塔不充數", () => {
  const ctx = context({ towers: [tower("arrow"), tower("support"), tower("beacon")] });
  const initial = ops.createOperations(ctx);
  const first = ops.evaluateOperations(initial, ctx);
  assert.equal(first.rows[1].progress, 1);
  assert.equal(first.gold, 0);
  assert.deepEqual(initial.claimed, {});
  const second = ops.evaluateOperations(first.state, Object.assign({}, ctx, { towers: [tower("arrow"), tower("frost")] }));
  assert.equal(second.awards.length, 1);
  assert.equal(second.gold, 12);
  assert.equal(second.rows[1].status, "claimed");
  assert.equal(ops.evaluateOperations(second.state, ctx).gold, 0);
});
test("只開到目標波不算通關，清波才領補給", () => {
  const ctx = context({ wave: 3, clearedWave: 2 });
  const before = ops.evaluateOperations(ops.createOperations(ctx), ctx);
  assert.equal(before.gold, 0);
  assert.equal(before.rows[0].progress, 2);
  const after = ops.evaluateOperations(before.state, Object.assign({}, ctx, { clearedWave: 3 }));
  assert.equal(after.gold, 18);
  assert.equal(after.chapter.startWave, 4);
  assert.equal(after.summary.completedChapters, 1);
  assert.equal(after.state.skipped["chapter-1-tactic"], true);
  assert.equal(ops.evaluateOperations(after.state, Object.assign({}, ctx, { clearedWave: 3 })).gold, 0);
});
test("錯過戰術不封鎖主線，也不能隔章建塔後倒領", () => {
  let ctx = context({ wave: 4, clearedWave: 3 });
  const state = ops.evaluateOperations(ops.createOperations(ctx), ctx).state;
  ctx = Object.assign({}, ctx, { wave: 5, clearedWave: 5, towers: [tower("arrow", 2), tower("frost")] });
  const next = ops.evaluateOperations(state, ctx);
  assert(!next.awards.some((item) => item.id === "chapter-1-tactic"));
  assert(next.awards.some((item) => item.id === "chapter-2-clear"));
  assert.equal(next.chapter.startWave, 6);
});
test("技能任務只計本章的實際傷害，不計空放次數或前章傷害", () => {
  const ctx = seedFor("spell", 3);
  ctx.skillCasts = 99;
  ctx.combatTelemetry.waves = { 1: { damageBySource: { skill: 999 } }, 4: { damageBySource: { skill: 79 } } };
  const state = ops.createOperations(ctx);
  const before = ops.evaluateOperations(state, ctx);
  assert.equal(before.rows[1].progress, 79);
  assert(!before.awards.some((item) => item.kind === "tactic"));
  ctx.combatTelemetry.waves[4].damageBySource.skill = 80;
  const after = ops.evaluateOperations(before.state, ctx);
  assert(after.awards.some((item) => item.id === "chapter-2-tactic"));
});
test("支援任務核對真實射程、升級與詞綴", () => {
  const ctx = seedFor("support", 5);
  const chapter = ops.chapterFor(ctx);
  ctx.towers = [tower("support", 1, 100, 100), tower("arrow", 1, 200, 100), tower("frost", 1, 249, 100)];
  assert.equal(ops.metricValue(chapter.tactic, ctx, chapter), 2);
  ctx.affix = { towerRangeMul: 0.9 };
  assert.equal(ops.metricValue(chapter.tactic, ctx, chapter), 1);
  ctx.towers[0].level = 3;
  assert.equal(ops.metricValue(chapter.tactic, ctx, chapter), 2);
  ctx.towers[0].x = NaN;
  assert.equal(ops.metricValue(chapter.tactic, ctx, chapter), 0);
});
test("元素與分散任務只看攻擊塔，不把低等或支援塔當主力", () => {
  const ctx = context({ clearedWave: 15 });
  const chapter = ops.chapterFor(ctx);
  ctx.towers = [tower("arrow", 2, 100, 100), tower("cannon", 2, 243, 100), tower("support", 5, 350, 100)];
  assert.equal(ops.metricValue(cfg.OPERATIONS.tactics.spread, ctx, chapter), 1);
  ctx.towers[1].x = 244;
  assert.equal(ops.metricValue(cfg.OPERATIONS.tactics.spread, ctx, chapter), 2);
  assert.equal(ops.metricValue(cfg.OPERATIONS.tactics.elements, ctx, chapter), 2);
  ctx.towers.push(tower("frost"));
  assert.equal(ops.metricValue(cfg.OPERATIONS.tactics.elements, ctx, chapter), 3);
});
test("無漏怪任務只計已完成且有實際戰鬥紀錄的本章波次", () => {
  const ctx = seedFor("clean", 5);
  const chapter = ops.chapterFor(ctx);
  ctx.wave = 9;
  ctx.clearedWave = 8;
  ctx.combatTelemetry.waves = { 5: { endedAt: 10, leaks: 0 }, 6: { endedAt: 20, leaks: 0 },
    7: { endedAt: 30, leaks: 1 }, 8: { endedAt: 40, leaks: 0 }, 9: { endedAt: null, leaks: 0 } };
  assert.equal(ops.metricValue(chapter.tactic, ctx, chapter), 2);
  assert(ops.evaluateOperations(ops.createOperations(ctx), ctx).awards.some((item) => item.id === "chapter-3-tactic"));
  ctx.combatTelemetry = {};
  assert.equal(ops.metricValue(chapter.tactic, ctx, chapter), 0);
});
test("存檔往返保留領取帳本，刷新不重領；別局種子隔離", () => {
  const ctx = context({ towers: [tower("arrow"), tower("frost")] });
  const first = ops.evaluateOperations(ops.createOperations(ctx), ctx);
  const key = first.state.runKey;
  const meta = rules.migrateMeta({ soulCrystal: 99, beginnerMissions: { firstTower: true }, operationRuns: { [key]: ops.serializeOperations(first.state) } });
  const disk = JSON.parse(JSON.stringify(meta));
  const protectedWrite = rules.protectMetaWrite(meta, disk);
  assert(protectedWrite.ok);
  const replay = ops.evaluateOperations(ops.createOperations(ctx, protectedWrite.meta.operationRuns[key]), ctx);
  assert.equal(replay.gold, 0);
  assert.equal(replay.awards.length, 0);
  assert.equal(meta.soulCrystal, 99);
  assert(meta.beginnerMissions.firstTower);
  const another = Object.assign({}, ctx, { runSeed: 719 });
  assert.equal(ops.evaluateOperations(ops.createOperations(another, disk.operationRuns[key]), another).gold, 12);
});
test("損壞存檔與危險鍵不污染任務或財富", () => {
  const ctx = context();
  const key = ops.runIdentity(ctx).runKey;
  const flags = JSON.parse('{"__proto__":true,"chapter-1-tactic":true,"chapter-2-clear":"yes"}');
  const saved = { version: 1, runKey: key, claimed: flags, skipped: [], observedWave: Infinity };
  const meta = rules.migrateMeta({ operationRuns: { [key]: saved, constructor: saved } });
  assert.equal(meta.operationRuns.constructor, Object.prototype.constructor);
  assert.deepEqual(meta.operationRuns[key].claimed, { "chapter-1-tactic": true });
  assert.equal(meta.operationRuns[key].observedWave, 0);
  assert(!rules.protectMetaWrite(meta, { operationRuns: [] }).ok);
  assert.doesNotThrow(() => ops.evaluateOperations(null, { towers: [null, { type: "constructor" }], combatTelemetry: [] }));
});
test("舊存檔自動補空帳本，48 局界線不讓儲存持續膨脹", () => {
  const old = rules.migrateMeta({ version: 7, soulCrystal: 50, bestWave: 20, gachaPity: 17 });
  assert.deepEqual(old.operationRuns, {});
  assert.equal(old.soulCrystal, 50);
  assert.equal(old.gachaPity, 17);
  const runs = {};
  for (let runSeed = 1; runSeed <= 60; runSeed++) {
    const state = ops.createOperations(context({ runSeed }));
    runs[state.runKey] = ops.serializeOperations(state);
  }
  assert.equal(Object.keys(rules.migrateMeta({ operationRuns: runs }).operationRuns).length, 48);
});
test("戰敗不補領臨時戰術，但保留已發補給；40波後仍有任務", () => {
  const ctx = context({ over: true, towers: [tower("arrow"), tower("frost")], wave: 1 });
  const ended = ops.evaluateOperations(ops.createOperations(ctx), ctx);
  assert.equal(ended.gold, 0);
  assert.equal(ended.rows[1].status, "missed");
  const late = ops.chapterFor(context({ clearedWave: 45, wave: 46 }));
  assert.equal(late.startWave, 46);
  assert.equal(late.endWave, 50);
  assert(late.gold > 0 && late.gold <= 600 && late.tacticGold <= 120);
});
test("任務不改初始經濟、舊新手獎勵或波次亂數", () => {
  assert.equal(cfg.GAME.startGold, 220);
  assert.equal(Object.values(cfg.BEGINNER_MISSIONS).reduce((sum, item) => sum + item.reward, 0), 38);
  const first = rules.generateWaveQueue(7, "normal", 617);
  ops.evaluateOperations(ops.createOperations(context()), context({ towers: [tower("arrow"), tower("frost")] }));
  assert.deepEqual(first, rules.generateWaveQueue(7, "normal", 617));
});
test("30／40波的戰術門檻有明確可達條件，所有卡片都能完成", () => {
  const all = new Set();
  for (const cleared of [25, 35]) for (let runSeed = 1; runSeed <= 128; runSeed++) {
    const ctx = context({ runSeed, clearedWave: cleared + 2, wave: cleared + 2,
      towers: [tower("arrow", 5, 100, 100), tower("cannon", 5, 245, 100), tower("frost", 5, 200, 100), tower("support", 5, 170, 100)] });
    ctx.combatTelemetry.waves[cleared + 1] = { endedAt: 10, leaks: 0, damageBySource: { skill: 500 } };
    ctx.combatTelemetry.waves[cleared + 2] = { endedAt: 20, leaks: 0, damageBySource: { skill: 500 } };
    const chapter = ops.chapterFor(ctx); all.add(chapter.tactic.id);
    const result = ops.evaluateOperations(ops.createOperations(ctx), ctx);
    assert(result.awards.some((award) => award.id === chapter.tacticClaimId));
    assert.equal(ops.evaluateOperations(result.state, ctx).gold, 0);
  }
  for (const card of ["anchor", "elements", "support", "spread", "clean"]) assert(all.has(card));
});
test("章切後完成旗標保留，待存獎不會由純規則再發一次", () => {
  const ctx = seedFor("spell", 5);
  ctx.wave = 10; ctx.clearedWave = 10;
  ctx.combatTelemetry.waves[10] = { endedAt: 50, leaks: 0, damageBySource: { skill: 80 } };
  const result = ops.evaluateOperations(ops.createOperations(ctx), ctx);
  assert(result.awards.some((award) => award.id === "chapter-3-tactic"));
  assert.equal(result.chapter.startWave, 11);
  const next = Object.assign({}, ctx, { wave: 11 });
  assert(!ops.evaluateOperations(result.state, next).awards.some((award) => award.id === "chapter-3-tactic"));
  const restored = ops.createOperations(next, JSON.parse(JSON.stringify(ops.serializeOperations(result.state))));
  assert(!ops.evaluateOperations(restored, next).awards.some((award) => award.id === "chapter-3-tactic"));
});
console.log(`\n${checks} 組任務測試通過。`);
