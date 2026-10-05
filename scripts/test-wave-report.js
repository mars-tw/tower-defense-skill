"use strict";
const assert = require("node:assert/strict");
const cfg = require("../src/config.js");
const rules = require("../src/rules.js");
const row = () => ({ startedAt: 20, endedAt: 40, spawned: 12, kills: 10, leaks: 2, goddessDamage: 6, bossKills: 0, killGold: 100, waveGold: 42, playerDamage: 650, damageBySource: { tower: 500, skill: 150 } });
function context(extra = {}) { return Object.assign({ wave: 10, clearedWave: 10, gold: 60, towers: [{ type: "arrow", level: 2 }], combatTelemetry: { waves: { 10: row() } }, runLeaks: { byWave: { 10: { count: 2, damage: 6, byType: { bat: 2 } } } } }, extra); }
let tests = 0;
function test(name, fn) { fn(); tests++; console.log(`PASS ${name}`); }
test("缺戰況時數字保留未知，不捏造零漏怪或原因", () => {
  const result = rules.analyzeWaveReport({ wave: 3 });
  assert.equal(result.status, "no-data"); assert.equal(result.metrics.leaks, null);
  assert.equal(result.metrics.durationSeconds, null); assert.equal(result.cause, null);
  assert.deepEqual(result.recommendations, []);
});
test("endedAt=null不當成0，也不把開到目標波當清波", () => {
  const ctx = context({ clearedWave: 9 }); ctx.combatTelemetry.waves[10].endedAt = null;
  const result = rules.analyzeWaveReport(ctx);
  assert.equal(result.status, "in-progress"); assert.equal(result.metrics.durationSeconds, null);
  ctx.over = true;
  assert.equal(rules.analyzeWaveReport(ctx).status, "lost");
});
test("明示已清的舊紀錄缺少耗時／漏怪，仍保持未知數字", () => {
  const ctx = context(); ctx.combatTelemetry.waves[10] = { endedAt: null, startedAt: 20 };
  const result = rules.analyzeWaveReport(ctx);
  assert.equal(result.status, "clear"); assert.equal(result.label, "已守住，戰況缺記");
  assert.equal(result.metrics.durationSeconds, null); assert.equal(result.metrics.leaks, null);
});
test("真實紀錄區分收入來源，反射／其他缺記來源不補數值", () => {
  const ctx = context(); ctx.combatTelemetry.waves[10].damageBySource = { skill: 150, tower: 500, hero: NaN, mirror: null, summon: 0 };
  const before = JSON.stringify(ctx);
  const result = rules.analyzeWaveReport(ctx);
  assert.equal(result.status, "clear"); assert.equal(result.metrics.durationSeconds, 20);
  assert.equal(result.metrics.killGold, 100); assert.equal(result.metrics.waveGold, 42);
  assert.deepEqual(result.metrics.damageBySource, { skill: 150, tower: 500, summon: 0 });
  assert.equal(before, JSON.stringify(ctx));
});
test("漏高速敵且缺寒冰，提出有成本且能存錢完成的補強", () => {
  const result = rules.analyzeWaveReport(context());
  assert.equal(result.cause.id, "fast"); assert.equal(result.cause.inferred, true); assert.equal(result.cause.type, "bat");
  assert.equal(result.recommendations[0].towerId, "frost"); assert.equal(result.recommendations[0].kind, "save");
  assert.equal(result.recommendations[0].missingGold, 10); assert.equal(result.recommendations.length, 2);
});
test("漏怪種類缺記不推定罪魁；有記錄的噤聲敵提供分散建議", () => {
  const unknown = rules.analyzeWaveReport(context({ runLeaks: {} }));
  assert.equal(unknown.cause.id, "unresolved"); assert.equal(unknown.cause.inferred, false);
  const ctx = context({ runLeaks: { byWave: { 10: { count: 1, byType: { silencer: 1 } } } }, gold: 999 });
  const result = rules.analyzeWaveReport(ctx);
  assert.equal(result.cause.id, "mute"); assert.equal(result.recommendations[0].towerId, "sniper");
  assert(result.recommendations[1].title.includes("另一段"));
});
test("完整守波與Boss擊殺以紀錄呈現，不給新獎勵", () => {
  const ctx = context(); Object.assign(ctx.combatTelemetry.waves[10], { leaks: 0, goddessDamage: 0, bossKills: 1 });
  const result = rules.analyzeWaveReport(ctx);
  assert.equal(result.label, "完整守住"); assert.equal(result.cause, null); assert(result.summary.includes("擊倒 1 隻 Boss"));
  assert.equal(result.recommendations[0].kind, "save"); assert.equal(result.recommendations[0].intendedKind, "upgrade");
  assert.equal(result.recommendations[0].cost, Math.round(cfg.TOWERS.arrow.cost * Math.pow(cfg.UPGRADE.costMul, 2)));
  assert.equal(result.gold, undefined); assert.equal(result.soul, undefined);
});
test("舊戰報缺count時，所有敵種數量合計保留", () => {
  const report = rules.analyzeRunReport({ towers: [], runLeaks: null, leaks: { byWave: { 8: { byType: { slime: 3, bat: 2 } } } } });
  assert.equal(report.totalLeaks, 5);
});
console.log(`${tests} wave-report groups passed.`);
