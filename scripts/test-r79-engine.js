#!/usr/bin/env node
"use strict";

// Production engine, mock Canvas/DOM: input lifecycle and targeting semantics.
// Browser pixels and genuine touch delivery are verified separately.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

function createHarness() {
  const handlers = {}, windowHandlers = {}, raf = [], storage = new Map();
  let now = 0;
  const ctx = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }), measureText: (s) => ({ width: String(s).length * 13 }) },
  { get: (target, name) => name in target ? target[name] : () => {} });
  const makeCanvas = () => ({ width: 960, height: 640, style: {}, getContext: () => ctx,
    addEventListener: (name, callback) => { handlers[name] = callback; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 378, height: 252 }),
    classList: { add() {}, remove() {} } });
  const canvas = makeCanvas();
  const context = { console, URLSearchParams, location: { search: "" }, performance: { now: () => now },
    addEventListener: (name, callback) => { windowHandlers[name] = callback; },
    document: { hidden: false, getElementById: (id) => id === "game" ? canvas : null, createElement: makeCanvas,
      addEventListener() {}, querySelector: () => null, documentElement: { classList: { toggle() {} } } },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: (callback) => raf.push(callback), setTimeout: () => 0,
    matchMedia: () => ({ matches: false }), Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } } };
  context.window = context; vm.createContext(context);
  for (const file of ["config.js", "heroes.js", "rules.js", "enemy-animation.js", "hero-animation.js", "game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src", file), "utf8"), context, { filename: file });
  }
  const TD = context.TD;
  const emit = (name, data = {}) => handlers[name]({ cancelable: true, preventDefault() {}, touches: [], changedTouches: [], ...data });
  const touch = (point, identifier = 1) => ({ identifier, clientX: point.x * 378 / 960, clientY: point.y * 252 / 640 });
  const start = (point) => { const t = touch(point); emit("touchstart", { touches: [t] }); return t; };
  const end = (t) => emit("touchend", { changedTouches: [t] });
  const pair = () => {
    TD.selectTower("arrow"); const cell = TD.config.GAME.cellSize;
    for (let y = cell / 2; y + cell < 640; y += cell) for (let x = cell / 2; x + cell < 960; x += cell) {
      if (TD.buildPreviewAt(x, y).ok && TD.buildPreviewAt(x + cell, y).ok) return { a: { x, y }, b: { x: x + cell, y }, cell };
    }
    throw new Error("no adjacent buildable cells");
  };
  return { TD, context, canvas, emit, touch, start, end, pair,
    emitWindow: (name) => windowHandlers[name](), advanceClock: (delta) => { now += delta; } };
}

{
  const h = createHarness(), { TD } = h, st = TD.state();
  st.affix = null; st.path = [{ x: 0, y: 200 }, { x: 1000, y: 200 }]; st.pathSegmentLengths = [1, 1000]; st.pathTotalLength = 1000;
  const tower = { type: "arrow", level: 1, x: 300, y: 200, cd: .8 }; st.towers.push(tower);
  const spawn = (type, x, hp, overrides = {}) => TD.debug.spawnEnemy(type, { x, y: 200, hp, maxHp: hp, speed: 0, ability: null, ...overrides });
  const front = spawn("slime", 400, 20), boss = spawn("boss", 250, 200), shielded = spawn("slime", 320, 10, { shield: 500 });
  spawn("boss", 900, 9999); spawn("boss", 420, 9999, { _dead: true }); spawn("boss", 410, 9999, { _leaked: true });
  assert.equal(TD.getTowerPriority(tower), "auto"); assert.equal(TD.debug.acquireTarget(tower), front);
  assert(TD.setTowerPriority(tower, "first")); assert.equal(TD.debug.acquireTarget(tower), front);
  assert(TD.setTowerPriority(tower, "boss")); assert.equal(TD.debug.acquireTarget(tower), boss);
  assert(TD.setTowerPriority(tower, "strong")); assert.equal(TD.debug.acquireTarget(tower), shielded);
  const cooldown = tower.cd, hp = boss.hp;
  TD.debug.fireTower(tower, front);
  assert(TD.setTowerPriority(tower, "boss"));
  assert.equal(tower.cd, cooldown); assert.equal(boss.hp, hp); assert.equal(st.bullets[0].target, front);
  st.bullets.length = 0; tower.cd = 0;
  TD.debug.stepSimulation(1 / 60);
  assert.equal(st.bullets[0].target, boss); assert.equal(boss.hp, hp, "launching a targeted attack still waits for projectile impact");
  assert.equal(TD.setTowerPriority(tower, "unknown"), false);
  assert.equal(TD.setTowerPriority({ ...tower }, "first"), false);
  for (const type of ["support", "beacon"]) {
    const support = { type, level: 1, x: 300, y: 200 }; st.towers.push(support);
    assert.equal(TD.getTowerPriority(support), null); assert.equal(TD.setTowerPriority(support, "boss"), false);
    assert.equal(TD.debug.acquireTarget(support), null);
  }
  boss._dead = true;
  assert.equal(TD.debug.acquireTarget(tower), front, "boss mode falls back to the front when no live in-range boss exists");
  console.log("PASS four priorities, in-range live targets, shield durability, support rejection, unchanged cooldown/projectiles and impact-time damage");
}
{
  const h = createHarness(), { TD } = h, st = TD.state();
  st.affix = null; st.path = [{ x: 0, y: 200 }, { x: 1000, y: 200 }]; st.pathSegmentLengths = [1, 1000]; st.pathTotalLength = 1000;
  const mortar = { type: "mortar", level: 1, x: 400, y: 200, cd: 0 }; st.towers.push(mortar);
  const middle = TD.debug.spawnEnemy("slime", { x: 550, y: 200, walkDist: 550, hp: 100, maxHp: 100, speed: 0 });
  const front = TD.debug.spawnEnemy("slime", { x: 560, y: 200, walkDist: 780, hp: 90, maxHp: 90, speed: 0 });
  TD.debug.spawnEnemy("boss", { x: 405, y: 200, walkDist: 700, hp: 9999, maxHp: 9999, speed: 0 });
  assert.equal(TD.debug.acquireTarget(mortar), middle, "auto preserves the original mortar middle-path rule");
  TD.setTowerPriority(mortar, "first"); assert.equal(TD.debug.acquireTarget(mortar), front);
  TD.setTowerPriority(mortar, "boss"); assert.equal(TD.debug.acquireTarget(mortar), front, "boss inside mortar dead zone is ineligible");
  TD.setTowerPriority(mortar, "strong"); assert.equal(TD.debug.acquireTarget(mortar), middle, "strongest inside dead zone is also ineligible");
  console.log("PASS mortar default remains unchanged; all explicit priorities respect minimum range");
}
{
  const h = createHarness(), { TD } = h, { a, b, cell } = h.pair(), gold = TD.state().gold;
  const t = h.start(a);
  assert(TD.getBuildPlacement().active); assert.equal(TD.confirmBuildPreview(), false);
  const moved = { ...t, clientX: t.clientX + cell * 378 / 960 * 2 };
  h.emit("touchmove", { touches: [moved] });
  assert(TD.getBuildPlacement().dragging); assert.equal(TD.getBuildPlacement().preview.cx, Math.floor(b.x / cell));
  assert.equal(TD.confirmBuildPreview(), false); h.end(moved);
  const placement = TD.getBuildPlacement();
  assert(!placement.active && placement.requiresConfirmation && placement.source === "drag");
  assert.equal(TD.state().gold, gold); assert.equal(TD.state().towers.length, 0);
  h.end(h.start(b));
  assert.equal(TD.state().towers.length, 1); assert.equal(TD.state().gold, gold - TD.config.TOWERS.arrow.cost);
  assert.equal(TD.confirmBuildPreview(), false, "confirmation cannot spend twice");
  h.emit("click", { clientX: moved.clientX, clientY: moved.clientY });
  assert.equal(TD.state().towers.length, 1);
  console.log("PASS half-speed drag correction, drag release never spends, explicit second tap spends once, synthetic click suppressed");
}
{
  const h = createHarness(), { TD } = h, { a } = h.pair();
  h.end(h.start(a));
  const cost = TD.getBuildPlacement().preview.cost;
  TD.state().gold = cost - 1;
  assert.equal(TD.getBuildPlacement().preview.ok, false); assert.equal(TD.confirmBuildPreview(), false);
  assert.equal(TD.state().towers.length, 0); assert.equal(TD.state().gold, cost - 1);
  TD.state().gold = cost; assert.equal(TD.confirmBuildPreview(), true); assert.equal(TD.state().gold, 0);
  console.log("PASS explicit confirmation revalidates current affordability and cannot overspend stale previews");
}
{
  const h = createHarness(), { TD } = h, { a } = h.pair(), gold = TD.state().gold;
  h.end(h.start(a));
  const t = h.start(a);
  // No touchmove event: native Chromium may coalesce this short movement.
  h.end({ ...t, clientX: t.clientX + 8 });
  assert.equal(TD.state().towers.length, 0); assert.equal(TD.state().gold, gold);
  assert.equal(TD.getBuildPlacement().source, "drag");
  h.emitWindow("resize"); assert.equal(TD.getBuildPlacement(), null);
  assert.equal(TD.confirmBuildPreview(), false);
  console.log("PASS coalesced short drag cannot confirm an armed cell; resizing disarms a released preview too");
}
{
  for (const cancel of ["touchcancel", "multitouch", "newtower", "skill", "close", "newgame", "resize", "orientationchange"]) {
    const h = createHarness(), { TD } = h, { a, cell } = h.pair(), gold = TD.state().gold;
    const t = h.start(a), moved = { ...t, clientX: t.clientX + cell * 378 / 960 };
    h.emit("touchmove", { touches: [moved] });
    if (cancel === "touchcancel") h.emit("touchcancel");
    if (cancel === "multitouch") h.emit("touchstart", { touches: [moved, { ...moved, identifier: 2 }] });
    if (cancel === "newtower") TD.selectTower("cannon");
    if (cancel === "skill") TD.selectSkill("meteor");
    if (cancel === "close") TD.closeSceneMenus();
    if (cancel === "newgame") TD.newGame();
    if (cancel === "resize" || cancel === "orientationchange") h.emitWindow(cancel);
    h.end(moved);
    assert.equal(TD.getBuildPlacement(), null, cancel);
    assert.equal(TD.confirmBuildPreview(), false, cancel);
    assert.equal(TD.state().towers.length, 0, cancel);
    assert.equal(TD.state().gold, gold, cancel);
    assert.equal(TD.state().skillCasts, 0, "a cancelled build touch must not cast a newly selected skill");
  }
  console.log("PASS cancel, multi-touch, selection changes, skills, menus, restarting and rotation disarm pending fingers");
}

console.log("R79 input and targeting gate passed.");
