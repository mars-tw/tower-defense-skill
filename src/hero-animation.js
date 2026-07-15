/* R63 英雄真幀動畫表：runtime 只載入一張 atlas，以 row/column 裁切。 */
const HERO_ANIMATION_ATLAS = Object.freeze({
  src: "assets/heroes/hero-animation-atlas.png",
  cellSize: 128,
  columns: 7,
  rows: 42,
  walkFrameStride: 8,
  lowWalkFrameStride: 14,
  anticipationColumn: 4,
  impactColumn: 5,
  recoveryColumn: 6,
});

function heroAnimation(rows, walkFrames) {
  return Object.freeze({ rows: Object.freeze(rows), walkFrames });
}

const HERO_ANIMATIONS = Object.freeze({
  knight: heroAnimation({ down: 0, up: 1, left: 2, right: 3 }, 2),
  archer: heroAnimation({ down: 4, up: 5, left: 6, right: 7 }, 2),
  mage: heroAnimation({ down: 8, up: 9, left: 10, right: 11 }, 2),
  iceMage: heroAnimation({ down: 12, up: 13, left: 14, right: 15 }, 2),
  valkyrie: heroAnimation({ down: 16, up: 17, left: 18, right: 19 }, 2),
  cleric: heroAnimation({ down: 20, up: 21, left: 22, right: 23 }, 2),
  daji: heroAnimation({ down: 24, up: 24, right: 24, left: 25 }, 4),
  guanyu: heroAnimation({ down: 26, up: 26, right: 26, left: 27 }, 4),
  wukong: heroAnimation({ down: 28, up: 28, right: 28, left: 29 }, 4),
  nezha: heroAnimation({ down: 30, up: 30, right: 30, left: 31 }, 4),
  leizhenzi: heroAnimation({ down: 32, up: 32, right: 32, left: 33 }, 4),
  niumowang: heroAnimation({ down: 34, up: 34, right: 34, left: 35 }, 4),
  baisuzhen: heroAnimation({ down: 36, up: 36, right: 36, left: 37 }, 4),
  erlangshen: heroAnimation({ down: 38, up: 38, right: 38, left: 39 }, 4),
  zhongkui: heroAnimation({ down: 40, up: 40, right: 40, left: 41 }, 4),
});
