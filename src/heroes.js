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

// 產生英雄四方向精靈圖路徑（相對 index.html，在 repo 根）
// 由 GPT 生「2x2 四方向設定集」再裁切而來；圖載入失敗時 game 端用 emoji 佔位。
function heroSprites(id) {
  return { down: `assets/heroes/${id}/down.png`, up: `assets/heroes/${id}/up.png`,
           left: `assets/heroes/${id}/left.png`, right: `assets/heroes/${id}/right.png` };
}

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
             desc: "近戰肉盾，前線砍殺。", sprites: heroSprites("knight") },
  archer:  { id: "archer",  name: "遊俠",   emoji: "🏹", rarity: "common", element: "physical", role: "ranged",
             hp: 120, atk: 14, speed: 80, range: 120, atkRate: 1.6, color: "#84cc16",
             desc: "遠程速射，風箏走位。", sprites: heroSprites("archer") },
  mage:    { id: "mage",    name: "大法師", emoji: "🧙", rarity: "epic", element: "fire", role: "ranged",
             hp: 140, atk: 28, speed: 60, range: 110, atkRate: 0.9, color: "#f97316",
             desc: "火焰範圍輸出。", sprites: heroSprites("mage"), splash: 35 },
  iceMage: { id: "iceMage", name: "冰霜法師", emoji: "❄️", rarity: "rare", element: "ice", role: "ranged",
             hp: 130, atk: 16, speed: 60, range: 110, atkRate: 1.1, color: "#38bdf8",
             desc: "攻擊減速敵人。", sprites: heroSprites("iceMage"), slow: 0.4 },
  valkyrie:{ id: "valkyrie",name: "女武神", emoji: "⚔️", rarity: "legendary", element: "thunder", role: "melee",
             hp: 320, atk: 30, speed: 95, range: 50, atkRate: 1.5, color: "#facc15",
             desc: "傳說戰神，高速強攻。", sprites: heroSprites("valkyrie") },
  cleric:  { id: "cleric",  name: "牧師",   emoji: "✨", rarity: "common", element: "physical", role: "ranged",
             hp: 110, atk: 8, speed: 70, range: 90, atkRate: 1.0, color: "#a3e635",
             desc: "攻擊偏弱，但每次攻擊治療女神。", sprites: heroSprites("cleric"), healGoddess: 10 },
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

// 抽卡經濟：花「魂晶」（跨局永久貨幣，死亡結算獲得），不是每局重置的金錢——
// 之前用場內金錢買永久英雄，重開新局就能用起始金反覆白嫖，經濟完全穿底。
// 這同時給了魂晶第一個消耗口（原本只進不出）。
const GACHA = {
  cost: 20,            // 單抽花費（魂晶）
  firstFree: true,     // 首抽免費（新玩家 30 秒內就能體驗盲盒，跟卡包首包免費同一套家族慣例）
  pityLegendary: 18,   // 18 抽保底傳說
  dupRefund: 12,       // 抽到重複英雄退還魂晶（降低重複挫折）
};

// rng 可注入（不給就用 Math.random）——跟農場專案同一套慣例，Node 測試才能餵固定序列
function rollHero(rng) {
  const rand = rng || Math.random;
  const total = Object.values(HERO_RARITY).reduce((s, r) => s + r.weight, 0);
  let roll = rand() * total;
  let picked = "common";
  for (const [key, r] of Object.entries(HERO_RARITY)) {
    if (roll < r.weight) { picked = key; break; }
    roll -= r.weight;
  }
  const pool = Object.values(HEROES).filter((h) => h.rarity === picked);
  return pool[Math.floor(rand() * pool.length)];
}

// 含保底的抽卡：pityCount 是「距離上一次傳說已累積的抽數」。
// 這一抽若達到第 pityLegendary 抽仍沒出傳說 → 強制傳說；抽到傳說（自然或保底）歸零。
// 純函式（不碰 storage），呼叫端負責持久化回傳的 pity。
function rollHeroWithPity(pityCount, rng) {
  const rand = rng || Math.random;
  let hero = rollHero(rand);
  let pity = (pityCount || 0) + 1;
  if (hero.rarity !== "legendary" && pity >= GACHA.pityLegendary) {
    const pool = Object.values(HEROES).filter((h) => h.rarity === "legendary");
    hero = pool[Math.floor(rand() * pool.length)];
  }
  if (hero.rarity === "legendary") pity = 0;
  return { hero, pity };
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
  Object.assign(window, { HERO_RARITY, HEROES, HERO_LEVEL, GACHA, rollHero, rollHeroWithPity, xpForLevel, heroStat });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { HERO_RARITY, HEROES, HERO_LEVEL, GACHA, rollHero, rollHeroWithPity, xpForLevel, heroStat };
}
