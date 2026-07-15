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
  assert(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "atlas 是有效 PNG");
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
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
  assert(bitDepth === 8 && colorType === 6 && interlace === 0, "atlas 使用非交錯 8-bit RGBA，守門可逐像素驗證");
  const channels = 4, stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * channels);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    const prior = row - stride;
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

console.log("== R62：敵人真幀 atlas 守門 ==");
const atlas = loadGlobal("src/enemy-animation.js", "ENEMY_ANIMATION_ATLAS", "__atlas");
const animations = loadGlobal("src/enemy-animation.js", "ENEMY_ANIMATIONS", "__animations");
const enemyIds = loadGlobal("src/config.js", "Object.keys(ENEMIES)", "__enemyIds");
const image = decodeRgbaPng(path.join(ROOT, atlas.src));

assert(image.width === atlas.cellSize * atlas.columns && image.height === atlas.cellSize * atlas.rows,
  `單一 atlas 尺寸與 ${atlas.columns}×${atlas.rows} 裁切表一致（${image.width}×${image.height}）`);
assert(enemyIds.length === 18 && Object.keys(animations).length === enemyIds.length && enemyIds.every((id) => animations[id]),
  "18 種 ENEMIES 全數有動畫列，無缺幀敵人");

let globalMinimum = Infinity;
for (const id of enemyIds) {
  const animation = animations[id];
  let minimum = Infinity;
  for (let a = 0; a < animation.walkFrames; a++) {
    for (let b = a + 1; b < animation.walkFrames; b++) minimum = Math.min(minimum, alphaDiff(image, atlas, animation.row, a, b));
  }
  globalMinimum = Math.min(globalMinimum, minimum);
  assert(minimum > 0.08, `${id} ${animation.walkFrames} 幀任兩幀 alpha mean abs diff > 0.08（min=${minimum.toFixed(6)}）`);
  const death01 = alphaDiff(image, atlas, animation.row, atlas.deathStart, atlas.deathStart + 1);
  const death12 = alphaDiff(image, atlas, animation.row, atlas.deathStart + 1, atlas.deathStart + 2);
  assert(death01 > 0.01 && death12 > 0.01, `${id} 有 3 個非重複碎裂死亡姿勢`);
}
console.log(`  INFO global min alpha mean abs diff = ${globalMinimum.toFixed(6)}`);

const game = fs.readFileSync(path.join(ROOT, "src/game.js"), "utf8");
const drawStart = game.indexOf("function drawEnemy(e)");
const drawEnd = game.indexOf("// 共用圓角漸層血條", drawStart);
const drawEnemy = game.slice(drawStart, drawEnd);
assert(drawStart >= 0 && drawEnd > drawStart, "找到 drawEnemy() 守門範圍");
for (const banned of ["bob", "waddle", "scaleX", "scaleY", "idlePhase", "lift01", "ctx.rotate(", "Math.sin("]) {
  assert(!drawEnemy.includes(banned), `drawEnemy() 不含假走路 token：${banned}`);
}
assert(drawEnemy.includes("drawEnemyAtlasFrame") && drawEnemy.includes("frameColumn") && game.includes("ctx.drawImage(atlas"),
  "drawEnemy() 由單一 atlas drawImage 裁切真幀");
assert(game.includes("(e.walkDist || 0) / stride") && game.includes("(e.animSeed || 0) * count"),
  "走路幀以 walkDist 相位選擇並由 animSeed 錯開個體");
assert(game.includes("if (lowQuality)") && game.includes("Math.floor(count / 2)"), "performanceLow 路徑降為兩幀交替，不退回晃動");
assert(game.includes("brightness(0) saturate(100%) invert(1)") && game.includes("deathStartedAt") && game.includes("if (e._dead) return;"),
  "受擊白閃與延遲移除的死亡播放管線存在");

if (failed) {
  console.error(`\nR62 enemy animation guard: ${failed} failed`);
  process.exit(1);
}
console.log("\nR62 enemy animation guard: PASS");
