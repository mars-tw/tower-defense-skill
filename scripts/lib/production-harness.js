"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ROOT = path.resolve(__dirname, "../..");

// Load the actual production combat functions. Canvas, assets and RAF are stubs;
// no independent damage, targeting, enemy movement, economy or status model exists.
function productionHarness(sourceDir = path.join(ROOT, "src")) {
  const draw = new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), createRadialGradient: () => ({ addColorStop() {} }), measureText: (value) => ({ width: String(value).length * 13 }) }, { get: (object, key) => key in object ? object[key] : () => {} });
  const makeCanvas = () => ({ width: 960, height: 640, style: {}, listeners: {}, getContext: () => draw,
    addEventListener(kind, callback) { this.listeners[kind] = callback; }, classList: { add() {}, remove() {} }, getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 640 }) });
  const canvas = makeCanvas();
  const math = Object.create(Math);
  let randomSeed = 1;
  math.random = () => { randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0; return randomSeed / 4294967296; };
  const storage = new Map();
  const context = { Math: math, console, URLSearchParams, location: { search: "" }, performance: { now: () => 0 },
    document: { hidden: false, getElementById: (id) => id === "game" ? canvas : null, createElement: makeCanvas, documentElement: { classList: { toggle() {} } }, addEventListener() {}, querySelector: () => null },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame: () => 0, setTimeout: () => 0, matchMedia: () => ({ matches: false }), Image: class { constructor() { this.complete = false; this.naturalWidth = 0; } } };
  context.window = context;
  vm.createContext(context);
  const sources = {};
  const sourceFiles = ["config.js", "heroes.js", "rules.js", "operations.js"];
  // An old saved-source fixture must not silently load a newer expedition
  // module from ROOT. Only the selected source tree's own optional module loads.
  if (fs.existsSync(path.join(sourceDir, "expedition.js"))) sourceFiles.push("expedition.js");
  sourceFiles.push("enemy-animation.js", "hero-animation.js", "map-art.js", "game.js");
  for (const file of sourceFiles) {
    const selected = fs.existsSync(path.join(sourceDir, file)) ? path.join(sourceDir, file) : path.join(ROOT, "src", file);
    const source = fs.readFileSync(selected, "utf8");
    sources[file] = { path: selected, sha256: crypto.createHash("sha256").update(source).digest("hex") };
    vm.runInContext(source, context, { filename: selected });
  }
  context.TD.setReducedEffects(true);
  context.TD.setAudioMuted(true);
  return { context, canvas, TD: context.TD, rules: context.TDRules, operations: context.TDOperations, expedition: context.TDExpedition || null, sources,
    seed(value) { randomSeed = (value >>> 0) || 1; },
  };
}
module.exports = { productionHarness, ROOT };
