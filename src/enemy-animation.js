/* R62 敵人真幀動畫表：runtime 只載入一張 atlas，以 row/column 裁切。 */
const ENEMY_ANIMATION_ATLAS = Object.freeze({
  src: "assets/enemies/enemy-animation-atlas.png",
  cellSize: 128,
  columns: 9,
  rows: 18,
  deathStart: 6,
  deathFrames: 3,
  deathDuration: 0.28,
  normalFrameStride: 7,
  bossFrameStride: 11,
});

const ENEMY_ANIMATIONS = Object.freeze({
  slime:        Object.freeze({ row: 0,  walkFrames: 4 }),
  goblin:       Object.freeze({ row: 1,  walkFrames: 4 }),
  orc:          Object.freeze({ row: 2,  walkFrames: 4 }),
  bat:          Object.freeze({ row: 3,  walkFrames: 4 }),
  frostwolf:    Object.freeze({ row: 4,  walkFrames: 4 }),
  imp:          Object.freeze({ row: 5,  walkFrames: 4 }),
  shieldman:    Object.freeze({ row: 6,  walkFrames: 4 }),
  medic:        Object.freeze({ row: 7,  walkFrames: 4 }),
  frostwraith:  Object.freeze({ row: 8,  walkFrames: 4 }),
  lavagolem:    Object.freeze({ row: 9,  walkFrames: 4 }),
  emberbat:     Object.freeze({ row: 10, walkFrames: 4 }),
  thunderronin: Object.freeze({ row: 11, walkFrames: 4 }),
  abysshound:   Object.freeze({ row: 12, walkFrames: 4 }),
  silencer:     Object.freeze({ row: 13, walkFrames: 4 }),
  mirrorling:   Object.freeze({ row: 14, walkFrames: 4 }),
  warden:       Object.freeze({ row: 15, walkFrames: 4 }),
  yaksha:       Object.freeze({ row: 16, walkFrames: 6 }),
  boss:         Object.freeze({ row: 17, walkFrames: 6 }),
});
