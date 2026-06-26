/* =========================================================================
 * heroes.js — 英雄資料層與抽卡系統（塔防英雄擴充）
 *
 * 英雄是「會在地圖上自主跑動打怪、自我升級」的單位，與固定砲塔不同。
 * 透過抽卡取得，可上場。
 *
 * 美術接點（待 GPT 三視圖生成後接回）：
 *   每個英雄預期有 assets/heroes/<id>/ 底下的方向圖 down/up/left/right.png
 *   （由一張「多角色三視圖」裁切而來）。沒有圖時 game 端用 emoji 佔位。
 *   sprites 欄位先留 null，生成後填入即可，不需改邏輯。
 * ========================================================================= */

// 英雄稀有度（抽卡權重；越稀有越強）
const HERO_RARITY = {
  common:    { label: "普通", stars: 1, weight: 55, color: "#9aa5b1", glow: "rgba(154,165,177,.5)" },
  rare:      { label: "稀有", stars: 2, weight: 30, color: "#3b82f6", glow: "rgba(59,130,246,.6)" },
  epic:      { label: "史詩", stars: 3, weight: 12, color: "#a855f7", glow: "rgba(168,85,247,.75)" },
  legendary: { label: "傳說", stars: 4, weight: 3,  color: "#f59e0b", glow: "rgba(245,158,11,.9)" },
};

/* 英雄定義
 *   element  火/冰/雷/物理（沿用塔的元素克制）
 *   hp/atk   基礎數值；speed 移動速度(px/s)；range 攻擊射程(px)；atkRate 每秒攻擊
 *   role     近戰 melee / 遠程 ranged（影響站位與射程）
 *   sprites  方向圖路徑物件，null = 用 emoji 佔位
 */
const HEROES = {
  knight:  { id: "knight",  name: "聖騎士", emoji: "🤺", rarity: "rare", element: "physical", role: "melee",
             hp: 220, atk: 18, speed: 70, range: 40, atkRate: 1.2, color: "#3b82f6",
             desc: "近戰肉盾，前線砍殺。", sprites: null },
  archer:  { id: "archer",  name: "遊俠",   emoji: "🏹", rarity: "common", element: "physical", role: "ranged",
             hp: 120, atk: 14, speed: 80, range: 120, atkRate: 1.6, color: "#84cc16",
             desc: "遠程速射，風箏走位。", sprites: null },
  mage:    { id: "mage",    name: "大法師", emoji: "🧙", rarity: "epic", element: "fire", role: "ranged",
             hp: 140, atk: 28, speed: 60, range: 110, atkRate: 0.9, color: "#f97316",
             desc: "火焰範圍輸出。", sprites: null, splash: 35 },
  iceMage: { id: "iceMage", name: "冰霜法師", emoji: "❄️", rarity: "rare", element: "ice", role: "ranged",
             hp: 130, atk: 16, speed: 60, range: 110, atkRate: 1.1, color: "#38bdf8",
             desc: "攻擊減速敵人。", sprites: null, slow: 0.4 },
  valkyrie:{ id: "valkyrie",name: "女武神", emoji: "⚔️", rarity: "legendary", element: "thunder", role: "melee",
             hp: 320, atk: 30, speed: 95, range: 50, atkRate: 1.5, color: "#facc15",
             desc: "傳說戰神，高速強攻。", sprites: null },
  cleric:  { id: "cleric",  name: "牧師",   emoji: "✨", rarity: "common", element: "physical", role: "ranged",
             hp: 110, atk: 8, speed: 70, range: 90, atkRate: 1.0, color: "#a3e635",
             desc: "攻擊偏弱，但會治療女神。", sprites: null, healGoddess: 6 },
};

// 英雄升級曲線：每級數值成長
const HERO_LEVEL = {
  maxLevel: 10,
  xpBase: 30,          // 升到 2 級所需經驗
  xpGrowth: 1.35,      // 每級所需經驗成長
  hpPerLevel: 0.12,    // 每級 +12% 基礎血量
  atkPerLevel: 0.10,   // 每級 +10% 基礎攻擊
  xpPerKill: 6,        // 每擊殺獲得經驗（乘敵人等級係數）
};

// 抽卡
const GACHA = {
  cost: 100,           // 單抽花費（金錢）
  pityLegendary: 30,   // 30 抽保底傳說（簡單保底）
};

function rollHero() {
  const total = Object.values(HERO_RARITY).reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  let picked = "common";
  for (const [key, r] of Object.entries(HERO_RARITY)) {
    if (roll < r.weight) { picked = key; break; }
    roll -= r.weight;
  }
  const pool = Object.values(HEROES).filter((h) => h.rarity === picked);
  return pool[Math.floor(Math.random() * pool.length)];
}

// 升級所需經驗
function xpForLevel(level) {
  return Math.round(HERO_LEVEL.xpBase * Math.pow(HERO_LEVEL.xpGrowth, level - 1));
}
// 等級調整後的數值
function heroStat(hero, key) {
  const base = HEROES[hero.id][key];
  if (key === "hp")  return Math.round(base * (1 + HERO_LEVEL.hpPerLevel * (hero.level - 1)));
  if (key === "atk") return Math.round(base * (1 + HERO_LEVEL.atkPerLevel * (hero.level - 1)));
  return base;
}

if (typeof window !== "undefined") {
  Object.assign(window, { HERO_RARITY, HEROES, HERO_LEVEL, GACHA, rollHero, xpForLevel, heroStat });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { HERO_RARITY, HEROES, HERO_LEVEL, GACHA, rollHero, xpForLevel, heroStat };
}
