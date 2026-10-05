"use strict";
// Bounded production input fixtures. No browser, performance or campaign claims.
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), assert = require("node:assert/strict"), crypto = require("node:crypto");
const { productionHarness, ROOT } = require("./lib/production-harness");
const OUT = path.join(ROOT, "docs/evidence/R84/engine");
const checks = [], observations = [];
const gamePath = path.join(ROOT, "src/game.js"), gameSource = fs.readFileSync(gamePath, "utf8");
const sha = content => crypto.createHash("sha256").update(content).digest("hex");
const startHash = sha(gameSource);
let sources;
function gate(name, run) {
  try { run(); checks.push({ name, status: "PASS" }); console.log("PASS " + name); }
  catch (error) { checks.push({ name, status: "FAIL", error: error.stack }); console.error("FAIL " + name + ": " + error.message); }
}
function harness(width = 378, assisted = true) {
  const base = productionHarness(), windowHandlers = {};
  // Shared harness already loaded every production dependency. Reinstantiate the
  // exact production game closure after installing a window-event collector so
  // resize/orientation can be delivered; no source transformation is performed.
  base.context.addEventListener = (kind, callback) => { windowHandlers[kind] = callback; };
  vm.runInContext(gameSource, base.context, { filename: gamePath });
  const { context, canvas } = base, TD = context.TD;
  sources = base.sources;
  let clock = 1000;
  context.performance.now = () => clock;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30, width, height: width * 640 / 960 });
  TD.setMap("plains"); TD.setDifficulty("normal"); TD.newGame({ runSeed: 1, affixSeed: 1 }); TD.state().affix = null; TD.setTouchControlMode(assisted);
  const emit = (kind, data = {}) => canvas.listeners[kind]({ cancelable: true, preventDefault() {}, touches: [], changedTouches: [], ...data });
  const finger = (p, identifier = 1) => ({ identifier, clientX: 20 + p.x * width / 960, clientY: 30 + p.y * width / 960 });
  const start = p => { const t = finger(p); emit("touchstart", { touches: [t] }); return t; };
  const end = t => emit("touchend", { changedTouches: [t] });
  const tap = p => end(start(p));
  const click = p => { clock += 1000; emit("click", finger(p)); };
  const enemy = (p = { x: 300, y: 200 }, extra = {}) => TD.debug.spawnEnemy("slime", { ...p, hp: 1000, maxHp: 1000, speed: 0, ability: null, ...extra });
  const economy = () => ({ gold: TD.state().gold, towers: TD.state().towers.length });
  const combat = () => ({ casts: TD.state().skillCasts, cooldowns: { ...TD.state().skillCooldowns }, enemies: TD.state().enemies.map(e => ({ hp: e.hp, dead: !!e._dead })) });
  const emitWindow = kind => { assert(windowHandlers[kind]); windowHandlers[kind](); };
  return { ...base, TD, width, emit, finger, start, end, tap, click, enemy, economy, combat, emitWindow };
}
function noCast(h, before) { assert.deepEqual(h.combat(), before, "Aiming cannot damage, start cooldown or cast"); }
function assertDisarmed(h) { assert.equal(h.TD.state().skillGhost, null); assert.equal(h.TD.state().touchSkillPreview, null); assert.equal(h.TD.getSkillPlacement()?.requiresConfirmation || false, false); assert.equal(h.TD.confirmSkillPreview(), false); }
gate("Phone/tablet touch and assisted mouse aim first; default preview cannot cast", () => {
  for (const width of [378, 820, 1180]) for (const input of ["touch", "mouse"]) {
    const h = harness(width), { TD } = h, p = { x: 300, y: 200 }; h.enemy(p);
    const before = h.combat(), economy = h.economy(); assert(TD.selectSkill("meteor"));
    const initial = TD.getSkillPlacement(); assert.equal(initial.source, "default"); assert.equal(initial.requiresConfirmation, false); assert.equal(initial.preview.radius, 80); assert.equal(TD.confirmSkillPreview(), false);
    if (input === "touch") h.tap(p); else h.click(p);
    const aim = TD.getSkillPlacement(); assert(aim.preview.ok && aim.requiresConfirmation && !aim.active); assert.equal(aim.preview.targetCount, 1); noCast(h, before);
    if (input === "touch") h.tap(p); else h.click(p); noCast(h, before);
    assert(TD.confirmSkillPreview()); assert.equal(TD.state().skillCasts, 1); assert.equal(TD.state().enemies[0].hp, 880); assert.equal(TD.state().skillCooldowns.meteor, TD.skillStat("meteor", "cooldown"));
    assert.equal(TD.getSkillPlacement(), null); assert.equal(TD.confirmSkillPreview(), false); assert.deepEqual(h.economy(), economy);
    observations.push({ kind: "aim-confirm", width, input, targetCount: aim.preview.targetCount, casts: TD.state().skillCasts, hp: TD.state().enemies[0].hp });
  }
});
gate("Active, precision drag, coalesced drag and repeated release remain preview-only", () => {
  const h = harness(), { TD } = h, p = { x: 300, y: 200 }; h.enemy(p); TD.selectSkill("meteor"); const before = h.combat();
  const t = h.start(p); assert(TD.getSkillPlacement().active); assert.equal(TD.confirmSkillPreview(), false); assert.equal(TD.previewSkillAt(300, 200), false); assert.equal(TD.moveSkillPreview(1, 0), false);
  const moved = { ...t, clientX: t.clientX + 24 };
  h.emit("touchmove", { touches: [moved] }); const active = TD.getSkillPlacement(); assert(active.active && active.dragging);
  assert(Math.abs(active.preview.x - (p.x + 24 * 960 / h.width * 0.5)) < 1e-8); noCast(h, before);
  h.end(moved); const released = TD.getSkillPlacement(); assert(!released.active && released.requiresConfirmation && released.source === "drag"); noCast(h, before);
  h.emit("click", moved); noCast(h, before);
  h.tap(p); const coalesced = h.start(p); h.end({ ...coalesced, clientX: coalesced.clientX + 8 });
  assert.equal(TD.getSkillPlacement().source, "drag"); noCast(h, before); h.end(coalesced); noCast(h, before);
});
gate("Skill confirmation revalidates bounds, cooldown, expedition lock and living targets", () => {
  const h = harness(), { TD } = h, p = { x: 300, y: 200 }, target = h.enemy(p); TD.selectSkill("meteor"); const before = h.combat();
  assert.equal(TD.previewSkillAt(NaN, 200), false); assert.equal(TD.previewSkillAt("300", 200), false);
  for (const q of [{ x: -1, y: 200 }, { x: 960, y: 200 }, { x: 300, y: 640 }]) {
    assert(TD.previewSkillAt(q.x, q.y)); assert.equal(TD.getSkillPlacement().preview.reason, "超出戰場"); assert.equal(TD.confirmSkillPreview(), false); noCast(h, before);
  }
  TD.previewSkillAt(p.x, p.y); TD.state().skillCooldowns.meteor = 5;
  const cooled = h.combat(); assert.equal(TD.getSkillPlacement().preview.reason, "技能冷卻中"); assert.equal(TD.confirmSkillPreview(), false); noCast(h, cooled);
  TD.state().skillCooldowns.meteor = 0;
  TD.state().mode = "expedition"; TD.state().expedition = { completed: false, draft: null }; TD.state().betweenWaves = false; TD.state().expeditionModifiers = { ...TD.state().expeditionModifiers, skillBan: true };
  assert.equal(TD.getSkillPlacement().preview.reason, "目前無法使用技能"); assert.equal(TD.confirmSkillPreview(), false); noCast(h, before);
  TD.state().mode = "classic"; TD.state().betweenWaves = true;
  target.x = 600; assert.equal(TD.getSkillPlacement().preview.targetCount, 0); assert.equal(TD.confirmSkillPreview(), false); assert(TD.getSkillPlacement().requiresConfirmation);
  target.x = 300; target._dead = true; assert.equal(TD.getSkillPlacement().preview.targetCount, 0); assert.equal(TD.confirmSkillPreview(), false);
  target._dead = false; target._leaked = true; assert.equal(TD.getSkillPlacement().preview.targetCount, 0); assert.equal(TD.confirmSkillPreview(), false);
  target._leaked = false; target.hp = 0; assert.equal(TD.getSkillPlacement().preview.targetCount, 0); assert.equal(TD.confirmSkillPreview(), false);
  target.hp = 1000; assert.equal(TD.getSkillPlacement().preview.targetCount, 1); assert(TD.confirmSkillPreview()); assert.equal(TD.state().skillCasts, 1);
});
gate("Empty target stays adjustable; preset and cardinal nudges stay in bounds without casting", () => {
  const h = harness(), { TD } = h; const target = h.enemy({ x: 840, y: 520 }); TD.selectSkill("meteor"); const before = h.combat(), economy = h.economy();
  assert(TD.previewSkillAt(300, 200)); assert.equal(TD.getSkillPlacement().preview.targetCount, 0); assert.equal(TD.confirmSkillPreview(), false); assert(TD.getSkillPlacement().requiresConfirmation);
  assert.equal(TD.moveSkillPreview(1, 1), false); assert.equal(TD.moveSkillPreview(Infinity, 0), false); assert.equal(TD.moveSkillPreview(0, 0), false);
  for (const direction of [[-1, 0], [0, -1], [1, 0], [0, 1]]) for (let i = 0; i < 25; i++) {
    assert(TD.moveSkillPreview(...direction)); const p = TD.getSkillPlacement(); assert(p.requiresConfirmation && p.source === "nudge"); assert(p.preview.x >= 0 && p.preview.x < 960 && p.preview.y >= 0 && p.preview.y < 640); noCast(h, before);
  }
  assert(TD.previewSkillAt(target.x, target.y)); assert(TD.getSkillPlacement().preview.ok); noCast(h, before); assert.deepEqual(h.economy(), economy); assert(TD.confirmSkillPreview());
});
gate("Cancel, selection changes, multi-finger events and viewport changes disarm skill fingers", () => {
  for (const cancel of ["cancel", "touchcancel", "multistart", "multimove", "wrongfinger", "end-with-other", "tower", "skill", "menu", "hero", "inspect", "goddess", "resize", "orientationchange", "controlmode", "newgame"]) {
    const h = harness(), { TD } = h; TD.buildTowerAt("arrow", 120, 72); h.enemy(); TD.selectSkill("meteor");
    const before = h.combat(), economy = h.economy(), t = h.start({ x: 300, y: 200 }), other = { ...t, identifier: 2 };
    h.emit("touchmove", { touches: [{ ...t, clientX: t.clientX + 12 }] });
    if (cancel === "cancel") TD.cancelSelect();
    if (cancel === "touchcancel") h.emit("touchcancel");
    if (cancel === "multistart") h.emit("touchstart", { touches: [t, other] });
    if (cancel === "multimove") h.emit("touchmove", { touches: [t, other] });
    if (cancel === "wrongfinger") h.emit("touchmove", { touches: [other] });
    if (cancel === "end-with-other") h.emit("touchend", { touches: [other], changedTouches: [t] });
    if (cancel === "tower") TD.selectTower("frost");
    if (cancel === "skill") TD.selectSkill("freeze");
    if (cancel === "menu") TD.closeSceneMenus();
    if (cancel === "hero") { TD.deployHero("knight"); TD.selectHeroGuard(TD.state().heroes[0].uid); }
    if (cancel === "inspect") assert(TD.inspectTower(0));
    if (cancel === "goddess") assert(TD.selectGoddess());
    if (cancel === "resize" || cancel === "orientationchange") h.emitWindow(cancel);
    if (cancel === "controlmode") TD.setTouchControlMode(false);
    if (cancel === "newgame") TD.newGame({ runSeed: 1, affixSeed: 1 });
    h.end(t); assertDisarmed(h); assert.equal(TD.state().skillCasts, 0);
    if (cancel !== "newgame") { noCast(h, before); assert.deepEqual(h.economy(), economy); }
    else { assert.equal(TD.getTouchControlMode(), true); assert.equal(TD.state().touchControlMode, true); }
  }
  const h = harness(); h.enemy(); h.TD.selectSkill("meteor"); h.tap({ x: 300, y: 200 }); h.emitWindow("resize"); assertDisarmed(h);
});
gate("Tower's exact cell wins over overlapping hero; miss hit area is 24 CSS px with deterministic ties", () => {
  for (const width of [378, 820, 1180]) {
    const h = harness(width), { TD } = h; assert(TD.buildTowerAt("arrow", 120, 72)); TD.deployHero("knight");
    const hero = TD.state().heroes[0]; hero.x = 120; hero.y = 72; const economy = h.economy();
    h.tap({ x: 120, y: 72 }); assert.equal(TD.state().selectedTower, TD.state().towers[0]); assert.equal(TD.state().pendingHero, null);
    hero.x = 800; hero.y = 550; TD.cancelSelect(); h.tap({ x: 120 + 24 * 960 / width, y: 72 });
    assert.equal(TD.state().selectedTower, TD.state().towers[0], "Boundary of CSS hit tolerance is included");
    TD.cancelSelect(); h.tap({ x: 120 + 24.2 * 960 / width, y: 72 });
    // Large tablets may still hit the actual tower cell; that exact cell remains valid.
    if (Math.floor((120 + 24.2 * 960 / width) / 48) !== 2) assert.equal(TD.state().selectedTower, null);
    assert.deepEqual(h.economy(), economy);
  }
  const tie = harness(); assert(tie.TD.buildTowerAt("arrow", 120, 72)); assert(tie.TD.buildTowerAt("arrow", 168, 72));
  tie.tap({ x: 144, y: 120 }); assert.equal(tie.TD.state().selectedTower.order, 0);
});
gate("Inspect/list and goddess APIs safely clear conflicting actions; selection does not spend", () => {
  const h = harness(), { TD } = h; assert(TD.buildTowerAt("arrow", 120, 72)); TD.deployHero("knight"); h.enemy();
  TD.selectSkill("meteor"); TD.previewSkillAt(300, 200); const economy = h.economy(), before = h.combat();
  assert.equal(TD.inspectTower(null), false); assert.equal(TD.inspectTower(false), false); assert.equal(TD.inspectTower(""), false); assert.equal(TD.inspectTower("bad"), false); assert.equal(TD.inspectTower(999), false); assert(TD.getSkillPlacement().requiresConfirmation);
  assert(TD.inspectTower("0")); assert.equal(TD.state().selectedTower.order, 0); assert.equal(TD.state().pendingSkill, null); assert.equal(TD.state().pendingHero, null); assertDisarmed(h);
  TD.selectHeroGuard(TD.state().heroes[0].uid); assert(TD.inspectTower(0)); assert.equal(TD.state().pendingHero, null);
  TD.selectTower("arrow"); TD.suggestBuildPlacement(); assert(TD.inspectTower(0)); assert.equal(TD.getBuildPlacement(), null);
  TD.selectSkill("meteor"); TD.previewSkillAt(300, 200); assert(TD.selectGoddess()); assert.equal(TD.state().selectedGoddess, true); assert.equal(TD.state().selectedTower, null); assert.equal(TD.state().pendingSkill, null); assert.equal(TD.state().pendingHero, null); assertDisarmed(h);
  noCast(h, before); assert.deepEqual(h.economy(), economy);
});
gate("Nearby tower tolerance never interrupts build, skill or hero guard targeting", () => {
  const h = harness(), { TD } = h; TD.buildTowerAt("arrow", 120, 72); h.enemy({ x: 120, y: 72 }); const economy = h.economy();
  TD.selectTower("frost"); h.tap({ x: 120, y: 72 }); assert.equal(TD.state().selectedTower, null); assert(TD.getBuildPlacement()); assert.deepEqual(h.economy(), economy);
  TD.selectSkill("meteor"); const before = h.combat(); h.tap({ x: 120, y: 72 }); assert.equal(TD.state().selectedTower, null); assert(TD.getSkillPlacement().requiresConfirmation); noCast(h, before);
  TD.cancelSelect(); TD.deployHero("knight"); const hero = TD.state().heroes[0]; TD.selectHeroGuard(hero.uid); h.tap({ x: 120, y: 72 });
  assert.equal(TD.state().selectedTower, null); assert(hero.guardPoint && Math.abs(hero.guardPoint.x - 120) < 1e-8);
});
gate("Assisted click construction arms preview; pure desktop keeps direct cast and repeated builds", () => {
  const assisted = harness(1180); assisted.TD.selectTower("arrow"); const economy = assisted.economy(); assisted.click({ x: 120, y: 72 });
  assert(assisted.TD.getBuildPlacement().requiresConfirmation); assert.deepEqual(assisted.economy(), economy); assert(assisted.TD.confirmBuildPreview());
  const desktop = harness(960, false); desktop.TD.selectTower("arrow"); desktop.click({ x: 120, y: 72 }); desktop.click({ x: 264, y: 216 });
  assert.equal(desktop.TD.state().towers.length, 2); assert.equal(desktop.TD.state().gold, 120); assert.equal(desktop.TD.state().selectedTowerType, "arrow");
  desktop.enemy(); desktop.TD.selectSkill("meteor"); desktop.click({ x: 300, y: 200 }); assert.equal(desktop.TD.state().skillCasts, 1); assert.equal(desktop.TD.state().pendingSkill, null);
  const actualTouch = harness(1180, false); actualTouch.enemy(); actualTouch.TD.selectSkill("meteor"); const before = actualTouch.combat(); actualTouch.tap({ x: 300, y: 200 }); noCast(actualTouch, before); assert(actualTouch.TD.getSkillPlacement().requiresConfirmation);
});
gate("Skill draw path renders the true radius ring and crosshair at active aim", () => {
  const h = harness(), { TD } = h, arcs = [], lines = [], draw = h.canvas.getContext("2d");
  draw.arc = (...args) => arcs.push(args); draw.moveTo = (...args) => lines.push(args);
  TD.selectSkill("meteor"); h.start({ x: 333, y: 222 }); TD.debug.advanceFrame(0, true);
  assert(arcs.some(([x, y, radius]) => Math.abs(x - 333) < 1e-8 && Math.abs(y - 222) < 1e-8 && radius === 80));
  assert(arcs.some(([x, y, radius]) => Math.abs(x - 333) < 1e-8 && Math.abs(y - 222) < 1e-8 && radius === 13));
  assert(lines.some(([x, y]) => Math.abs(x - 311) < 1e-8 && Math.abs(y - 222) < 1e-8)); assert.equal(TD.state().skillCasts, 0);
});
gate("Game source remained frozen throughout this VM gate", () => assert.equal(sha(fs.readFileSync(gamePath)), startHash));
fs.mkdirSync(OUT, { recursive: true });
const sourceHashes = Object.fromEntries(["src/game.js", "scripts/test-r84-touch-engine.js", "scripts/lib/production-harness.js"].map(file => [file, sha(fs.readFileSync(path.join(ROOT, file)))]));
const result = { status: checks.every(c => c.status === "PASS") ? "PASS" : "FAIL", method: "Shared production VM, exact game closure re-instantiated solely to collect real resize handlers; fixture enemies and gestures, no browser/performance/campaign simulation", sourceHashes, productionSources: sources, checks, observations };
fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("R84 engine: " + result.status + "; " + checks.length + " groups");
if (result.status !== "PASS") process.exitCode = 1;
