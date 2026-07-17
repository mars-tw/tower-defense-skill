#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const { TOWERS } = require(path.join(ROOT, "src", "config.js"));
const { HEROES } = require(path.join(ROOT, "src", "heroes.js"));
const manifest = require(path.join(ROOT, "assets", "art-manifest-r70.json"));
const alphaSummary = require(path.join(ROOT, "docs", "evidence", "R70_art", "gates", "summary.json"));
const silhouette = require(path.join(ROOT, "docs", "evidence", "R70_art", "gates", "tower-silhouette.json"));

let failed = 0;
function assert(ok, message) {
  if (ok) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}`); failed++; }
}
function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function pngHeader(file) {
  const data = fs.readFileSync(file);
  const png = data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { png, width: data.readUInt32BE(16), height: data.readUInt32BE(20), bitDepth: data[24], colorType: data[25] };
}
function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

console.log("== R70 Wave 1 art contract ==");
const heroIds = Object.keys(HEROES);
assert(heroIds.length === 15, "15 hero definitions remain present");
for (const id of heroIds) {
  const expected = `assets/heroes/portraits/${id}.png`;
  const file = path.join(ROOT, expected);
  const header = pngHeader(file);
  assert(HEROES[id].portrait === expected && header.png && header.width === 128 && header.height === 128 && header.bitDepth === 8 && header.colorType === 6,
    `${id} has a checked-in 128x128 RGBA portrait`);
}

const towerIds = Object.keys(TOWERS);
assert(towerIds.length === 10, "10 tower definitions remain present");
for (const id of towerIds) {
  const expected = [1, 2, 3].map((tier) => `assets/towers/tiers/${id}-tier${tier}.png`);
  assert(JSON.stringify(TOWERS[id].sprites) === JSON.stringify(expected), `${id} exposes tier1/tier2/tier3 paths`);
  for (const fileName of expected) {
    const header = pngHeader(path.join(ROOT, fileName));
    assert(header.png && header.width === 128 && header.height === 128 && header.bitDepth === 8 && header.colorType === 6,
      `${fileName} is 128x128 RGBA PNG`);
  }
}

assert(manifest.schema_version === "td-r70-wave1-art.v1" && manifest.model_slug === "gpt-image-2" && manifest.interface === "built-in image_gen",
  "manifest records schema, model slug and generation interface");
assert(manifest.assets.length === 45 && new Set(manifest.assets.map((item) => item.slug)).size === 45,
  "manifest has 45 unique portrait/tower-tier slugs");
assert(manifest.assets.every((item) => item.prompt && item.prompt.includes("no text") && item.references.length >= 1),
  "every manifest asset records its production prompt and hashed references");

const checked = new Set();
for (const item of manifest.assets) {
  for (const artifact of Object.values(item.artifacts)) {
    if (checked.has(artifact.path)) continue;
    checked.add(artifact.path);
    const file = path.join(ROOT, artifact.path);
    assert(fs.existsSync(file) && sha256(file) === artifact.sha256, `${artifact.path} hash matches manifest`);
  }
  for (const reference of item.references) {
    if (checked.has(reference.path)) continue;
    checked.add(reference.path);
    const file = path.join(ROOT, reference.path);
    assert(fs.existsSync(file) && sha256(file) === reference.sha256, `${reference.path} reference hash matches`);
  }
}

assert(alphaSummary.checked === 45 && alphaSummary.passed === 45 && alphaSummary.failed.length === 0,
  "Wave 0 alpha gate passes all 45 runtime assets");
assert(silhouette.pass && silhouette.towers.length === 10 && silhouette.towers.every((item) => item.pass),
  "all 10 tower contact sheets pass height/area/alpha-mask silhouette progression");

const ui = fs.readFileSync(path.join(ROOT, "src", "ui.js"), "utf8");
const heroAvatar = functionBlock(ui, "heroAvatar(hero)", "heroProgressFor(id, meta)");
assert(heroAvatar.includes("hero.portrait") && !heroAvatar.includes("hero.emoji") && !heroAvatar.includes("onerror") && !heroAvatar.includes("replaceWith"),
  "heroAvatar uses portrait assets without emoji/error fallback");
assert(ui.includes("towerArt(t, 1, \"ico\")") && ui.includes("towerArt(def, tw.level, \"sel-tower-art\")"),
  "build dock and selected-tower UI use tier artwork");

const game = fs.readFileSync(path.join(ROOT, "src", "game.js"), "utf8");
const tierIndex = functionBlock(game, "towerTierIndex(level)", "towerSpritePath(def, level)");
assert(tierIndex.includes("value >= 7 ? 2") && tierIndex.includes("value >= 4 ? 1"),
  "runtime maps Lv1-3/Lv4-6/Lv7+ to three art tiers");
assert(game.includes("drawSprite(towerSpritePath(def, lv), \"\"") && game.includes("drawSprite(towerSpritePath(def, 1), \"\""),
  "tower renderer and build preview use tier assets without emoji fallback");

if (failed) {
  console.error(`\nR70 art guard: ${failed} failed`);
  process.exit(1);
}
console.log("\nR70 art guard: PASS");
