"use strict";
// R83 bounded input gate: actual production closures in the shared VM harness.
// These are engine fixtures, not browser/player/performance/combat evidence.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { productionHarness, ROOT } = require("./lib/production-harness");
const OUT = path.join(ROOT, "docs/evidence/R83/engine");
const checks = [], observations = [];
let sources;
function gate(name, run) {
  try { run(); checks.push({ name, status: "PASS" }); console.log("PASS " + name); }
  catch (error) { checks.push({ name, status: "FAIL", error: error.stack }); console.error("FAIL " + name + ": " + error.message); }
}
function harness(map = "plains", width = 378) {
  const h = productionHarness(); sources = h.sources;
  const { TD, canvas, context } = h;
  let clock = 1000;
  context.performance.now = () => clock;
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30, width, height: width * 640 / 960 });
  TD.setMap(map); TD.setDifficulty("normal"); TD.newGame({ runSeed: 1, affixSeed: 1 });
  TD.state().affix = null; TD.selectTower("arrow");
  const emit = (name, data = {}) => canvas.listeners[name]({ cancelable: true, preventDefault() {}, touches: [], changedTouches: [], ...data });
  const finger = (p, identifier = 1) => ({ identifier, clientX: 20 + p.x * width / 960, clientY: 30 + p.y * width / 960 });
  const start = p => { const t = finger(p); emit("touchstart", { touches: [t] }); return t; };
  const end = t => emit("touchend", { changedTouches: [t] });
  const tap = p => end(start(p));
  const click = p => { clock += 1000; const t = finger(p); emit("click", t); };
  const money = () => ({ gold: TD.state().gold, towers: TD.state().towers.length, built: TD.state().towersBuilt });
  const pad = id => TD.getMap().buildPads.find(p => p.id === id);
  return { ...h, emit, finger, start, end, tap, click, money, pad, width };
}
function unchanged(h, before, reason) { assert.deepEqual(h.money(), before, reason); }
function near(p, q) { return Math.hypot(p.x - q.x, p.y - q.y); }
function occupies(h, p) { h.TD.state().towers.push({ type: "arrow", x: p.x, y: p.y, cx: Math.floor(p.x / 48), cy: Math.floor(p.y / 48), level: 1 }); }
function crossing(from, to, route) {
  // Parametric intersections are independent of production's orientation test.
  const dx = to.x - from.x, dy = to.y - from.y;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], sx = b.x - a.x, sy = b.y - a.y;
    const determinant = dx * sy - dy * sx;
    if (Math.abs(determinant) < 1e-8) continue;
    const t = ((a.x - from.x) * sy - (a.y - from.y) * sx) / determinant;
    const u = ((a.x - from.x) * dy - (a.y - from.y) * dx) / determinant;
    if (t >= -1e-8 && t <= 1 + 1e-8 && u >= -1e-8 && u <= 1 + 1e-8) return true;
  }
  return false;
}
gate("Role-specific suggestions are legal and never purchase on all three maps", () => {
  const role = { arrow: "front-arrow", frost: "front-control", beacon: "front-control", cannon: "crossfire", tesla: "crossfire", mortar: "crossfire", support: "crossfire", poison: "rear-main", sniper: "rear-main" };
  for (const map of ["plains", "canyon", "lava"]) {
    const h = harness(map), { TD } = h;
    for (const [type, idOrZone] of Object.entries(role)) {
      TD.selectTower(type); const before = h.money();
      assert.equal(TD.suggestBuildPlacement(), true, map + "/" + type);
      const p = TD.getBuildPlacement(), expected = idOrZone === "crossfire" ? TD.getMap().buildPads.find(p => p.zone === idOrZone) : h.pad(idOrZone);
      assert(p.requiresConfirmation && p.preview.ok && !p.active);
      assert.equal(p.source, "suggest"); assert.equal(p.preview.x, expected.x); assert.equal(p.preview.y, expected.y);
      unchanged(h, before, "Suggestion must not pay");
      observations.push({ kind: "role", map, type, pad: expected.id, x: p.preview.x, y: p.preview.y });
    }
    TD.cancelSelect(); assert.equal(TD.suggestBuildPlacement(), false); assert.equal(TD.getBuildPlacement(), null);
    TD.selectTower("arrow"); TD.state().gold = 49;
    const before = h.money(); assert.equal(TD.suggestBuildPlacement(), false); unchanged(h, before);
    TD.state().gold = 220; TD.state().mapDef = { ...TD.state().mapDef, buildPads: [] };
    const emptyBefore = h.money(); assert.equal(TD.suggestBuildPlacement(), false); unchanged(h, emptyBefore);
  }
});
gate("Occupied role pad falls back only to a legal nearby cell on the same bank", () => {
  for (const map of ["plains", "canyon", "lava"]) {
    const h = harness(map), { TD } = h, anchor = h.pad("front-arrow"); occupies(h, anchor);
    const before = h.money(); assert(TD.suggestBuildPlacement());
    const p = TD.getBuildPlacement().preview;
    assert(p.ok && near(anchor, p) > 0 && near(anchor, p) <= 72);
    assert(Math.abs(p.cx - Math.floor(anchor.x / 48)) <= 1 && Math.abs(p.cy - Math.floor(anchor.y / 48)) <= 1);
    assert(h.rules.lineWalkable(TD.getMap(), anchor, p, 0)); assert(!crossing(anchor, p, TD.getMap().path));
    unchanged(h, before);
    observations.push({ kind: "occupied-fallback", map, anchor, selected: { x: p.x, y: p.y } });
  }
});
gate("24 CSS px, 72 world px and adjacent-cell limits hold for touch snapping", () => {
  let snapCount = 0, shoreCount = 0, refusedTerrain = 0;
  for (const map of ["plains", "canyon", "lava"]) for (const width of [240, 378, 960]) {
    const h = harness(map, width), { TD } = h, before = h.money();
    for (const pad of TD.getMap().buildPads) for (let dy = -72; dy <= 72; dy += 12) for (let dx = -72; dx <= 72; dx += 12) {
      const input = { x: pad.x + dx, y: pad.y + dy };
      TD.selectTower("arrow"); const raw = TD.buildPreviewAt(input.x, input.y);
      if (raw.ok) continue;
      h.tap(input); const placement = TD.getBuildPlacement(); assert(placement);
      const p = placement.preview;
      if (placement.snapped) {
        snapCount++; assert(p.ok); assert(near(input, p) <= 72 + 1e-8); assert(near(input, p) * width / 960 <= 24 + 1e-8);
        assert(Math.abs(p.cx - Math.floor(input.x / 48)) <= 1 && Math.abs(p.cy - Math.floor(input.y / 48)) <= 1);
        assert(h.rules.lineWalkable(TD.getMap(), input, p, 0)); assert(!crossing(input, p, TD.getMap().path));
        for (const bridge of TD.getMap().bridges || []) assert(!crossing(input, p, bridge.path));
        if (["water", "cliff", "lava"].includes(raw.terrainKind)) {
          shoreCount++;
          if (!observations.some(o => o.kind === "shore" && o.map === map)) observations.push({ kind: "shore", map, width, input, snapped: { x: p.x, y: p.y }, terrain: raw.terrainKind });
        }
      } else if (!h.rules.mapWalkable(TD.getMap(), input.x, input.y, 0) && ["water", "cliff", "lava"].includes(raw.terrainKind)) {
        refusedTerrain++; assert(!p.ok, "Actual terrain point stays red rather than crossing the bank");
      }
      unchanged(h, before, "Snapping an invalid input cannot purchase");
    }
  }
  assert(snapCount > 0 && shoreCount > 0 && refusedTerrain > 0);
  observations.push({ kind: "snap-sample-counts", snapCount, shoreCount, refusedTerrain });
  const desktop = harness("plains", 960), small = harness("plains", 378);
  for (const h of [desktop, small]) { occupies(h, h.pad("front-arrow")); h.tap(h.pad("front-arrow")); }
  assert.equal(desktop.TD.getBuildPlacement().snapped, false, "48 world px exceeds 24 CSS px at 1:1 scale");
  assert.equal(small.TD.getBuildPlacement().snapped, true, "48 world px is inside 24 CSS px on the phone");
});
gate("Path center, river interior, out-of-bounds and incomplete bottom row never snap or pay", () => {
  for (const map of ["plains", "canyon", "lava"]) {
    const h = harness(map), { TD } = h, before = h.money();
    const road = TD.getMap().path[1];
    const inputs = [road, { x: -1, y: 72 }, { x: 960, y: 72 }, { x: 120, y: -1 }, { x: 120, y: 640 }, { x: 120, y: 630 }];
    for (const p of inputs) { TD.selectTower("arrow"); h.tap(p); const placement = TD.getBuildPlacement(); assert(!placement.snapped && !placement.preview.ok); assert.equal(TD.confirmBuildPreview(), false); unchanged(h, before); }
    for (const region of TD.getMap().regions.filter(r => ["water", "cliff", "lava"].includes(r.type))) {
      const center = region.shape === "ellipse" ? { x: region.x, y: region.y } : { x: region.points.reduce((s, p) => s + p.x, 0) / region.points.length, y: region.points.reduce((s, p) => s + p.y, 0) / region.points.length };
      if (h.rules.mapWalkable(TD.getMap(), center.x, center.y, 0)) continue;
      TD.selectTower("arrow"); h.tap(center); const placement = TD.getBuildPlacement(); assert(!placement.snapped && !placement.preview.ok); unchanged(h, before);
    }
  }
});
gate("Water-edge footprint may align to its own bank while actual river water remains red", () => {
  const h = harness("plains"), { TD } = h, before = h.money(), input = { x: 444, y: 36 };
  assert.equal(TD.buildPreviewAt(input.x, input.y).terrainKind, "water");
  assert(h.rules.mapWalkable(TD.getMap(), input.x, input.y, 0));
  h.tap(input); const p = TD.getBuildPlacement();
  assert(p.snapped && p.preview.ok); assert.equal(p.preview.x, 408); assert.equal(p.preview.y, 24);
  assert(h.rules.lineWalkable(TD.getMap(), input, p.preview, 0)); unchanged(h, before);
  observations.push({ kind: "shore", map: "plains", width: h.width, input, snapped: { x: p.preview.x, y: p.preview.y }, terrain: "water" });
  TD.selectTower("arrow"); h.tap({ x: 480, y: 36 });
  assert.equal(TD.getBuildPlacement().snapped, false); assert.equal(TD.getBuildPlacement().preview.ok, false); unchanged(h, before);
});
gate("Nudges stay in full cells, preserve invalid red previews and never auto-confirm", () => {
  const h = harness(), { TD } = h, before = h.money();
  assert.equal(TD.moveBuildPreview(1, 0), false);
  TD.suggestBuildPlacement();
  assert.equal(TD.moveBuildPreview(1, 1), false); assert.equal(TD.moveBuildPreview(NaN, 0), false); assert.equal(TD.moveBuildPreview(0, 0), false);
  for (const direction of [[-1, 0], [0, -1], [1, 0], [0, 1]]) for (let step = 0; step < 25; step++) {
    assert(TD.moveBuildPreview(...direction)); const p = TD.getBuildPlacement();
    assert(p.requiresConfirmation && p.source === "nudge");
    assert(p.preview.cx >= 0 && p.preview.cx <= 19 && p.preview.cy >= 0 && p.preview.cy <= 12);
    assert(p.preview.x - 24 >= 0 && p.preview.x + 24 <= 960 && p.preview.y - 24 >= 0 && p.preview.y + 24 <= 640);
    if (!p.preview.ok) { assert.equal(TD.confirmBuildPreview(), false); assert(TD.getBuildPlacement()); }
    unchanged(h, before);
  }
  assert.equal(TD.getBuildPlacement().preview.y, 600);
  const t = h.start(h.pad("front-arrow")); assert.equal(TD.moveBuildPreview(1, 0), false); assert.equal(TD.suggestBuildPlacement(), false); h.emit("touchcancel"); h.end(t); unchanged(h, before);
});
gate("Snap/repeated-invalid taps, dragging and coalesced drag remain unpaid until explicit confirmation", () => {
  const h = harness(), { TD } = h, pad = h.pad("front-arrow"); occupies(h, pad);
  const before = h.money(); h.tap(pad); assert(TD.getBuildPlacement().snapped); h.tap(pad); unchanged(h, before);
  assert(TD.getBuildPlacement().requiresConfirmation); TD.cancelSelect(); TD.selectTower("arrow");
  const p = h.pad("front-control"), t = h.start(p);
  assert(TD.getBuildPlacement().active); assert.equal(TD.confirmBuildPreview(), false);
  const dragged = { ...t, clientX: t.clientX - 24 };
  h.emit("touchmove", { touches: [dragged] }); assert(TD.getBuildPlacement().dragging); unchanged(h, before);
  h.end(dragged); assert(TD.getBuildPlacement().requiresConfirmation); assert.equal(TD.getBuildPlacement().source, "drag"); unchanged(h, before);
  TD.cancelSelect(); TD.selectTower("arrow"); h.tap(p); const coalesced = h.start(p); h.end({ ...coalesced, clientX: coalesced.clientX + 8 });
  assert.equal(TD.getBuildPlacement().source, "drag"); unchanged(h, before);
  TD.cancelSelect(); TD.selectTower("arrow"); h.tap(p); const cost = TD.getBuildPlacement().preview.cost;
  assert.equal(TD.confirmBuildPreview(), true); assert.equal(TD.state().gold, before.gold - cost); assert.equal(TD.state().towers.length, before.towers + 1);
  assert.equal(TD.confirmBuildPreview(), false); assert.equal(TD.state().selectedTowerType, null); assert.equal(TD.getBuildPlacement(), null);
  h.tap(p); assert.equal(TD.state().selectedTower, TD.state().towers.at(-1));
  assert.equal(TD.state().gold, before.gold - cost);
});
gate("Cancel and multi-finger interruptions disarm active and released previews", () => {
  for (const cancel of ["touchcancel", "multistart", "multimove", "wrongfinger", "end-with-other", "selection", "skill", "menu", "newgame"]) {
    const h = harness(), { TD } = h, before = h.money(), t = h.start(h.pad("front-arrow")), moved = { ...t, clientX: t.clientX + 14 };
    h.emit("touchmove", { touches: [moved] });
    const other = { ...moved, identifier: 2 };
    if (cancel === "touchcancel") h.emit("touchcancel");
    if (cancel === "multistart") h.emit("touchstart", { touches: [moved, other] });
    if (cancel === "multimove") h.emit("touchmove", { touches: [moved, other] });
    if (cancel === "wrongfinger") h.emit("touchmove", { touches: [other] });
    if (cancel === "end-with-other") h.emit("touchend", { touches: [other], changedTouches: [moved] });
    if (cancel === "selection") TD.selectTower("frost");
    if (cancel === "skill") TD.selectSkill("meteor");
    if (cancel === "menu") TD.closeSceneMenus();
    if (cancel === "newgame") { TD.newGame({ runSeed: 1, affixSeed: 1 }); TD.state().affix = null; }
    h.end(moved); assert.equal(TD.getBuildPlacement(), null, cancel); assert.equal(TD.confirmBuildPreview(), false, cancel); unchanged(h, before, cancel);
    assert.equal(TD.state().skillCasts, 0);
  }
  const h = harness(); h.tap(h.pad("front-arrow")); const before = h.money(); h.emit("touchcancel");
  assert.equal(h.TD.getBuildPlacement(), null); assert.equal(h.TD.confirmBuildPreview(), false); unchanged(h, before);
});
gate("Explicit payment revalidates affordability and touch second tap exits selection; desktop keeps consecutive builds", () => {
  const h = harness(), { TD } = h, p = h.pad("front-arrow");
  h.tap(p); TD.state().gold = 49; assert.equal(TD.confirmBuildPreview(), false); assert.equal(TD.state().gold, 49); assert.equal(TD.state().towers.length, 0);
  TD.state().gold = 50; assert.equal(TD.confirmBuildPreview(), true); assert.equal(TD.state().gold, 0); assert.equal(TD.state().selectedTowerType, null);
  const touch = harness(), a = touch.pad("front-arrow"); touch.tap(a); touch.tap(a);
  assert.equal(touch.TD.state().gold, 170); assert.equal(touch.TD.state().towers.length, 1); assert.equal(touch.TD.state().selectedTowerType, null);
  touch.tap(a); assert.equal(touch.TD.state().selectedTower, touch.TD.state().towers[0]);
  const desktop = harness("plains", 960); desktop.click(desktop.pad("front-arrow")); desktop.click(desktop.pad("front-control"));
  assert.equal(desktop.TD.state().towers.length, 2); assert.equal(desktop.TD.state().gold, 120); assert.equal(desktop.TD.state().selectedTowerType, "arrow");
  observations.push({ kind: "desktop", gold: desktop.TD.state().gold, towers: desktop.TD.state().towers.length, selectedType: desktop.TD.state().selectedTowerType });
});
fs.mkdirSync(OUT, { recursive: true });
const sourceHashes = Object.fromEntries(["src/game.js", "scripts/test-r83-build-engine.js", "scripts/lib/production-harness.js", "scripts/test-r79-engine.js"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.join(ROOT, file))).digest("hex")]));
const result = { status: checks.every(c => c.status === "PASS") ? "PASS" : "FAIL", method: "Shared production VM input fixtures; no browser, performance benchmark, campaign simulation or external model", sourceHashes, productionSources: sources, checks, observations };
fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log("R83 engine: " + result.status + "; evidence: " + path.relative(ROOT, OUT));
if (result.status !== "PASS") process.exitCode = 1;
