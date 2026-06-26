/* =========================================================================
 * config.js — 塔防遊戲設定與資料（塔、怪、技能、元素克制）
 * 純資料層，被 game.js 載入。改這裡即可調整平衡、加單位。
 * ========================================================================= */

// 元素：火 fire、冰 ice、雷 thunder、物理 physical
// 克制關係：火克冰、冰克雷、雷克火（物理對所有中性）。被克時受到 1.5 倍傷害。
const ELEMENTS = {
  physical: { label: "物理", color: "#cbd5e1" },
  fire:     { label: "火",   color: "#f97316" },
  ice:      { label: "冰",   color: "#38bdf8" },
  thunder:  { label: "雷",   color: "#facc15" },
};
const COUNTERS = { fire: "ice", ice: "thunder", thunder: "fire" }; // key 克 value
function elementMultiplier(atkEl, defEl) {
  if (COUNTERS[atkEl] === defEl) return 1.5; // 克制
  if (COUNTERS[defEl] === atkEl) return 0.66; // 被反克
  return 1;
}

// ===== 砲塔定義 =====
// range 射程(px)、damage 傷害、fireRate 每秒射擊數、cost 造價、splash 範圍傷害半徑
// slow 減速(0~1)、pierce 穿透數、element 元素
const TOWERS = {
  arrow:  { id: "arrow",  name: "弓箭塔", emoji: "🏹", element: "physical",
            range: 110, damage: 10, fireRate: 2.0, cost: 50, color: "#a3a3a3",
            desc: "單體高射速，便宜萬用。" },
  cannon: { id: "cannon", name: "加農砲", emoji: "💣", element: "fire",
            range: 95, damage: 26, fireRate: 0.75, cost: 100, splash: 50, color: "#f97316",
            desc: "範圍爆破，對成群敵人有效。" },
  frost:  { id: "frost",  name: "寒冰塔", emoji: "❄️", element: "ice",
            range: 105, damage: 11, fireRate: 1.3, cost: 80, slow: 0.5, color: "#38bdf8",
            desc: "減速敵人 + 穩定輸出，控場神器。" },
  tesla:  { id: "tesla",  name: "電磁塔", emoji: "⚡", element: "thunder",
            range: 95, damage: 14, fireRate: 1.4, cost: 130, pierce: 3, color: "#facc15",
            desc: "閃電連鎖，貫穿多個敵人。" },
};
// 升級：每級提升傷害與射程，造價遞增。maxLevel 6 + 傷害倍率提高，給後期金錢出口（D2 修碾壓）
const UPGRADE = { damageMul: 1.55, rangeMul: 1.1, costMul: 1.5, maxLevel: 6 };

// ===== 敵人定義 =====
// hp 基礎血量、speed 速度(px/s)、reward 擊殺金錢、leak 漏過扣的生命
const ENEMIES = {
  slime:  { id: "slime",  name: "史萊姆", emoji: "🟢", element: "physical", hp: 40,  speed: 45, reward: 8,  leak: 1, color: "#22c55e" },
  goblin: { id: "goblin", name: "哥布林", emoji: "👺", element: "physical", hp: 28,  speed: 80, reward: 10, leak: 1, color: "#84cc16" },
  orc:    { id: "orc",    name: "獸人",   emoji: "👹", element: "physical", hp: 120, speed: 35, reward: 18, leak: 2, color: "#b45309" },
  bat:    { id: "bat",    name: "蝙蝠群", emoji: "🦇", element: "thunder",  hp: 22,  speed: 95, reward: 7,  leak: 1, color: "#7c3aed" },
  boss:   { id: "boss",   name: "魔王",   emoji: "😈", element: "fire",     hp: 500, speed: 28, reward: 150, leak: 8, color: "#dc2626", boss: true },
};

// ===== 主動技能 =====
// cooldown 冷卻(秒)、damage 傷害、radius 範圍、effect 特效類型
const SKILLS = {
  meteor:  { id: "meteor",  name: "隕石術", emoji: "☄️", element: "fire",    cooldown: 18, damage: 120, radius: 80, color: "#f97316", desc: "對範圍內敵人造成大量火焰傷害。" },
  freeze:  { id: "freeze",  name: "冰封術", emoji: "🧊", element: "ice",     cooldown: 22, damage: 20, radius: 999, freezeDur: 3, color: "#38bdf8", desc: "凍結全場敵人 3 秒。" },
  thunder: { id: "thunder", name: "雷暴術", emoji: "🌩️", element: "thunder", cooldown: 15, damage: 60, radius: 999, color: "#facc15", desc: "對全場敵人造成雷電傷害。" },
};

// ===== 守護女神（被保護的核心）=====
// 怪物漏過路徑終點 = 攻擊女神扣生命；女神生命歸零 = 遊戲結束。
// 可花金升級：加生命上限、解鎖聖光反擊（自動攻擊靠近終點的敵人）。
const GODDESS = {
  name: "守護女神", emoji: "👸",
  baseHp: 100,            // 起始生命上限
  hpPerLevel: 60,         // 每升一級 +60 生命上限並回滿
  upgradeCostBase: 150,   // 升級造價（隨等級遞增）
  upgradeCostMul: 1.7,
  maxLevel: 5,
  // 反擊：2 級起解鎖，對終點附近敵人定期放聖光
  smiteUnlockLevel: 2,
  smiteRange: 130, smiteDamage: 25, smiteInterval: 1.2,
};

// ===== 全域遊戲參數 =====
const GAME = {
  startGold: 220,      // 起始金錢
  cellSize: 48,        // 格位大小
  waveBonusBase: 30,   // 波獎勵基數
  waveBonusGrowth: 1.12, // 波獎勵指數成長：bonus = base * growth^wave（提高，給金錢指數出口對抗血量指數）
  bossEveryWaves: 5,   // 每 5 波出 Boss
  hpGrowthEarly: 0.15, // 前 10 波血量成長率
  hpGrowthLate: 0.10,  // 第 11 波起血量成長率（降低，消除後期斷崖）
  bossHpMul: 1.0,      // Boss 額外血量倍率
  spawnInterval: 0.8,  // 同波敵人生成間隔(秒)
};
// 計算某波的金錢獎勵與血量倍率（D2 修碾壓的核心）
function waveGoldBonus(wave) { return Math.round(GAME.waveBonusBase * Math.pow(GAME.waveBonusGrowth, wave)); }
function waveHpScale(wave) {
  if (wave <= 10) return Math.pow(1 + GAME.hpGrowthEarly, wave - 1);
  return Math.pow(1 + GAME.hpGrowthEarly, 9) * Math.pow(1 + GAME.hpGrowthLate, wave - 10);
}

if (typeof window !== "undefined") {
  Object.assign(window, { ELEMENTS, COUNTERS, elementMultiplier, TOWERS, UPGRADE, ENEMIES, SKILLS, GAME, GODDESS, waveGoldBonus, waveHpScale });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ELEMENTS, COUNTERS, elementMultiplier, TOWERS, UPGRADE, ENEMIES, SKILLS, GAME, GODDESS, waveGoldBonus, waveHpScale };
}
