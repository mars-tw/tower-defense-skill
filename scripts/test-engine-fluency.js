#!/usr/bin/env node
"use strict";

// Drive the shipped scheduler and combat engine in a deterministic DOM stub.
// This tests clock/cadence correctness; browser raster/performance gates remain
// separate because a Canvas stub cannot establish visual quality or frame cost.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ROOT = path.resolve(__dirname, "..");

function harness() {
  const raf = [], listeners = {}, storage = new Map();
  const draw = new Proxy({
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: (value) => ({ width: String(value).length * 13 }),
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  const makeCanvas = () => ({ width: 960, height: 640, style: {},
    getContext: () => draw, addEventListener() {}, classList: { add() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }) });
  const canvas = makeCanvas();
  const document = { hidden: false, getElementById: (id) => id === "game" ? canvas : null,
    createElement: makeCanvas, documentElement: { classList: { toggle() {} } },
    addEventListener: (kind, callback) => { listeners[kind] = callback; }, querySelector: () => null };
  const context = { document, console, URLSearchParams, location: { search: "" },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: (callback) => { raf.push(callback); return raf.length; },
    setTimeout: () => 0, matchMedia: () => ({ matches: false }),
    Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } },
    performance: { now: () => 0 }, };
  context.window = context;
  vm.createContext(context);
  for (const file of ["config.js", "heroes.js", "rules.js", "enemy-animation.js", "hero-animation.js", "game.js"]) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, "src", file), "utf8"), context, { filename: file });
  }
  return { TD: context.TD, document, listeners, raf };
}

function setupBattle(h, speed) {
  h.TD.newGame({ runSeed: 104729, affixSeed: 130363 });
  h.TD.setReducedEffects(true);
  h.TD.state().towers.push({ type: "arrow", level: 1, cx: 3, cy: 3, x: 150, y: 100, cd: 0, order: 0 });
  assert.notEqual(h.TD.startWave(), false);
  h.TD.setSpeed(speed);
  const state = h.TD.state();
  state.affix = null; state.currentEvent = null; state.banner = null;
  state.spawnQueue.length = 0; state.betweenWaves = true;
  state.path = [{ x: 0, y: 150 }, { x: 10, y: 150 }, { x: 10, y: 200 }, { x: 1000, y: 200 }];
  state.pathSegmentLengths = [1, 10, 50, 990];
  const mover = h.TD.debug.spawnEnemy("slime", { x: 0, y: 150, speed: 22, hp: 99999, maxHp: 99999, ability: null });
  const victim = h.TD.debug.spawnEnemy("slime", { x: 150, y: 150, speed: 0, hp: 99999, maxHp: 99999, ability: null });
  h.TD.debug.advanceFrame(0);
  return { state, mover, victim };
}

function runCadence(fps, speed) {
  const h = harness(), { state, mover, victim } = setupBattle(h, speed);
  for (let frame = 1; frame <= fps * 2; frame++) h.TD.debug.advanceFrame(frame * 1000 / fps);
  return { clock: state.clock, x: mover.x, y: mover.y, walkDist: mover.walkDist,
    hp: victim.hp, moverHp: mover.hp, cd: state.towers[0].cd, steps: h.TD.debug.engineStats().steps };
}
function close(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} vs ${expected}`); }

for (const speed of [1, 3]) {
  const reference = runCadence(60, speed);
  for (const fps of [20, 30, 60, 120, 144]) {
    const result = runCadence(fps, speed);
    for (const key of Object.keys(reference)) close(result[key], reference[key], `${fps} FPS/${speed}x ${key}`);
    close(result.clock, 2 * speed, `${fps} FPS clock respects selected speed`);
    close(result.walkDist, 44 * speed, `${fps} FPS corners preserve movement budget`);
  }
  console.log(`PASS 20/30/60/120/144 FPS at ${speed}x: identical movement, damage, cooldown and clock`);
}

{
  const h = harness();
  h.TD.newGame();
  assert.equal(h.TD.canStartFirstWave(), false);
  assert.equal(h.TD.startWave(), false);
  h.TD.state().towers.push({ type: "support", level: 1, x: 100, y: 100, cd: 0 });
  assert.equal(h.TD.canStartFirstWave(), false);
  assert.equal(h.TD.startWave(), false);
  h.TD.state().towers.push({ type: "beacon", level: 1, x: 140, y: 100, cd: 0 });
  assert.equal(h.TD.canStartFirstWave(), false);
  assert.equal(h.TD.startWave(), false);
  h.TD.deployHero("knight");
  assert.equal(h.TD.canStartFirstWave(), true);
  assert.notEqual(h.TD.startWave(), false);
  h.TD.newGame();
  h.TD.state().wave = 1; h.TD.state().towers.push({ type: "support", level: 1, x: 100, y: 100, cd: 0 });
  assert.notEqual(h.TD.startWave(), false);
  console.log("PASS first-wave preparation requires damage; a battle hero qualifies; later support-only waves stay legal");
}

{
  const h = harness(), { state } = setupBattle(h, 3);
  h.TD.debug.advanceFrame(10000);
  assert.equal(h.TD.debug.engineStats().lastSteps, 18);
  close(state.clock, 0.3, "stall is bounded to 18 physics steps");
  assert(h.TD.debug.engineStats().droppedSeconds > 29);
  console.log("PASS long stalls have a bounded catch-up budget");
}
{
  const h = harness(), { state } = setupBattle(h, 1);
  h.TD.debug.advanceFrame(50);
  const before = state.clock;
  h.TD.setPaused(true); h.TD.debug.advanceFrame(50000);
  close(state.clock, before, "manual pause freezes battle");
  h.TD.setPaused(false); h.TD.debug.advanceFrame(51000); h.TD.debug.advanceFrame(51050);
  close(state.clock, before + 0.05, "unpause discards elapsed pause time");
  h.document.hidden = true; h.listeners.visibilitychange(); h.TD.debug.advanceFrame(100000);
  const hiddenClock = state.clock;
  h.document.hidden = false; h.listeners.visibilitychange(); h.TD.debug.advanceFrame(200000);
  close(state.clock, hiddenClock, "first visible frame has no hidden-time catch-up");
  h.TD.debug.advanceFrame(200050);
  close(state.clock, hiddenClock + 0.05, "visible battle resumes normally");
  h.TD.setPaused(true); h.document.hidden = true; h.listeners.visibilitychange();
  h.document.hidden = false; h.listeners.visibilitychange();
  assert.equal(state.paused, true);
  console.log("PASS pause and hidden tab freeze time and preserve the player's pause choice");
}
{
  const h = harness();
  const rafCount = h.raf.length;
  for (let run = 0; run < 5; run++) setupBattle(h, 1);
  assert.equal(h.raf.length, rafCount);
  const st = h.TD.state();
  st.enemies.length = 0;
  st.spawnQueue.length = 0; st.betweenWaves = true;
  const enemies = st.enemies, bullets = st.bullets, particles = st.particles;
  h.TD.debug.spawnEnemy("slime", { _leaked: true });
  h.TD.debug.stepSimulation(1 / 60);
  assert.equal(st.enemies, enemies); assert.equal(st.bullets, bullets); assert.equal(st.particles, particles);
  const leaked = h.TD.debug.spawnEnemy("slime", { x: 100, y: 100, speed: 0, _leaked: true });
  const tower = { type: "arrow", level: 1, x: 100, y: 100 };
  assert.equal(h.TD.debug.acquireTarget(tower), null);
  assert.equal(h.TD.debug.fireTower(tower, leaked), false);
  assert.equal(h.TD.debug.beginHeroAttack({ id: "knight", x: 100, y: 100 }, leaked), false);
  console.log("PASS restarting cannot add RAF chains; dead/leaked entities cannot be targeted; arrays compact in place");
}
{
  const h = harness();
  h.TD.newGame();
  for (let frame = 0; frame < 120; frame++) h.TD.debug.advanceFrame(frame * 1000 / 60, true);
  const stats = h.TD.debug.engineStats();
  assert.equal(stats.backgroundBakes, 1); assert.equal(stats.pathBakes, 1);
  h.TD.debug.pushParticle({ x: 10, y: 10, life: 0.1, vx: 0, vy: 0, r: 2 }, true);
  h.TD.debug.advanceFrame(2017, true); h.TD.debug.advanceFrame(2117, true);
  assert.equal(h.TD.state().particles.length, 0);
  assert(h.TD.state().clock === 0);
  console.log("PASS unloaded/optional map art is cached; preparation effects expire without advancing combat");
}
console.log("Engine fluency regression gate passed.");
