#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const zlib = require("zlib");

const ROOT = path.resolve(__dirname, "..");
let failed = 0;
function assert(ok, message) {
  if (ok) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}`); failed++; }
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodeRgbaPng(filePath) {
  const png = fs.readFileSync(filePath);
  assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "英雄 atlas 是有效 PNG");
  let offset = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  assert(bitDepth === 8 && colorType === 6 && interlace === 0, "英雄 atlas 使用非交錯 8-bit RGBA");
  const channels = 4, stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++], row = y * stride, prior = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[src++];
      const left = x >= channels ? pixels[row + x - channels] : 0;
      const up = y > 0 ? pixels[prior + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[prior + x - channels] : 0;
      if (filter === 0) pixels[row + x] = value;
      else if (filter === 1) pixels[row + x] = (value + left) & 255;
      else if (filter === 2) pixels[row + x] = (value + up) & 255;
      else if (filter === 3) pixels[row + x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) pixels[row + x] = (value + paeth(left, up, upperLeft)) & 255;
      else throw new Error(`unsupported PNG filter ${filter}`);
    }
  }
  return { width, height, pixels };
}

function alphaDiff(image, atlas, row, leftColumn, rightColumn) {
  const cell = atlas.cellSize;
  let total = 0;
  for (let y = 0; y < cell; y++) {
    const ay = row * cell + y;
    for (let x = 0; x < cell; x++) {
      const left = ((ay * image.width + leftColumn * cell + x) * 4) + 3;
      const right = ((ay * image.width + rightColumn * cell + x) * 4) + 3;
      total += Math.abs(image.pixels[left] - image.pixels[right]);
    }
  }
  return total / (cell * cell * 255);
}

function loadGlobal(file, expression, name) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const context = {};
  vm.runInNewContext(`${source}\nglobalThis.${name} = ${expression};`, context, { filename: file });
  return context[name];
}

function functionBlock(source, name, nextName) {
  const start = source.indexOf(`function ${name}`);
  const end = source.indexOf(`function ${nextName}`, start + 1);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

console.log("== R63：英雄真幀 atlas 與攻擊時點守門 ==");
const atlas = loadGlobal("src/hero-animation.js", "HERO_ANIMATION_ATLAS", "__atlas");
const animations = loadGlobal("src/hero-animation.js", "HERO_ANIMATIONS", "__animations");
const heroIds = loadGlobal("src/heroes.js", "Object.keys(HEROES)", "__heroIds");
const image = decodeRgbaPng(path.join(ROOT, atlas.src));

assert(heroIds.length === 15 && Object.keys(animations).length === 15 && heroIds.every((id) => animations[id]),
  "15 位 HEROES 全數有 atlas 動畫描述");
assert(image.width === atlas.cellSize * atlas.columns && image.height === atlas.cellSize * atlas.rows,
  `單一英雄 atlas 尺寸符合 ${atlas.columns}×${atlas.rows} 裁切表（${image.width}×${image.height}）`);

let globalMinimum = Infinity;
for (const id of heroIds) {
  const animation = animations[id];
  const rows = [...new Set(Object.values(animation.rows))];
  for (const row of rows) {
    let minimum = Infinity;
    for (let a = 0; a < animation.walkFrames; a++) {
      for (let b = a + 1; b < animation.walkFrames; b++) minimum = Math.min(minimum, alphaDiff(image, atlas, row, a, b));
    }
    globalMinimum = Math.min(globalMinimum, minimum);
    assert(minimum > 0.08, `${id} row ${row} 任兩個 walk 真幀 alpha mean abs diff > 0.08（min=${minimum.toFixed(6)}）`);
    const anticipateImpact = alphaDiff(image, atlas, row, atlas.anticipationColumn, atlas.impactColumn);
    const impactRecovery = alphaDiff(image, atlas, row, atlas.impactColumn, atlas.recoveryColumn);
    assert(anticipateImpact > 0.01 && impactRecovery > 0.01, `${id} row ${row} 攻擊 anticipation / impact / recovery 姿勢相異`);
  }
}
console.log(`  INFO global min alpha mean abs diff = ${globalMinimum.toFixed(6)}`);

const game = fs.readFileSync(path.join(ROOT, "src/game.js"), "utf8");
const drawHero = functionBlock(game, "drawHero(h)", "drawGoddess()");
assert(drawHero && drawHero.includes("drawHeroAtlasFrame") && drawHero.includes("heroAnimationColumn"), "drawHero() 只由英雄 atlas 選列選幀");
for (const banned of ["def.sprite", "def.sprites", "drawSprite(", "ctx.scale(", "ctx.translate(", "drawSingleHeroSprite"]) {
  assert(!drawHero.includes(banned), `drawHero() 不含單張假走路 token：${banned}`);
}
assert(game.includes("h.walkDist = (h.walkDist || 0) + step") && game.includes("h.moving = step > 0"), "physics root 位移另行累積 walkDist 與 moving 狀態");
assert(game.includes("HERO_ANIMATION_ATLAS.lowWalkFrameStride") && game.includes("ctx.drawImage(atlas, column * cell"),
  "performanceLow 只降低英雄取樣幀率，仍以單 atlas drawImage 裁切");

const beginAttack = functionBlock(game, "heroAttack(h, target)", "updateHeroAttack(h, dt)");
assert(beginAttack.includes("HERO_ATTACK_PHASE.ANTICIPATION") && !beginAttack.includes("applyDamage(") &&
  !beginAttack.includes("killEnemy(") && !beginAttack.includes("state.bullets.push"),
  "heroAttack 輸入只進 anticipation，不立即傷害／擊殺／建立子彈");
const updateAttack = functionBlock(game, "updateHeroAttack(h, dt)", "resolveHeroAttackImpact(h)");
const resolveImpact = functionBlock(game, "resolveHeroAttackImpact(h)", "grantXp(h, enemy)");
assert(updateAttack.includes("resolveHeroAttackImpact(h)") && updateAttack.includes("HERO_ATTACK_PHASE.RECOVERY"),
  "狀態機依序進入 impact 並轉 recovery");
assert(resolveImpact.includes("applyDamage(") && resolveImpact.includes("state.bullets.push") && resolveImpact.includes("activeRange"),
  "近戰傷害與遠程 active hitbox 只在 impact resolver，且揮空先做範圍檢查");

const enemyFallback = functionBlock(game, "drawEnemyAtlasFrame(atlas, animation, column, e, size)", "drawEnemy(e)");
assert(enemyFallback.includes("ctx.arc(") && !enemyFallback.includes("assets/enemies/") && !enemyFallback.includes("drawSprite("),
  "Gen-2 atlas fallback 是乾淨 Canvas 暫代，不讀黑底 master PNG");

if (failed) {
  console.error(`\nR63 hero animation guard: ${failed} failed`);
  process.exit(1);
}
console.log("\nR63 hero animation guard: PASS");
