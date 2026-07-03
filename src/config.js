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
            range: 130, damage: 10, fireRate: 2.0, cost: 50, color: "#a3a3a3",
            desc: "單體高射速，便宜萬用。" },
  cannon: { id: "cannon", name: "加農砲", emoji: "💣", element: "fire",
            range: 120, damage: 26, fireRate: 0.75, cost: 100, splash: 50, color: "#f97316",
            desc: "範圍爆破，對成群敵人有效。" },
  frost:  { id: "frost",  name: "寒冰塔", emoji: "❄️", element: "ice",
            range: 125, damage: 11, fireRate: 1.45, cost: 70, slow: 0.5, color: "#38bdf8",
            desc: "便宜控場核心，減速敵人讓全隊多打幾輪。" },
  tesla:  { id: "tesla",  name: "電磁塔", emoji: "⚡", element: "thunder",
            range: 120, damage: 14, fireRate: 1.4, cost: 130, pierce: 3, color: "#facc15",
            desc: "閃電連鎖，貫穿多個敵人。" },
  poison: { id: "poison", name: "毒霧塔", emoji: "☠️", element: "physical",
            range: 120, damage: 7, fireRate: 1.15, cost: 90, poisonDps: 6, poisonDuration: 4, poisonMaxStacks: 3, color: "#22c55e",
            desc: "命中附加可疊加毒素，持續咬血。" },
  support:{ id: "support",name: "聖光塔", emoji: "✨", element: "physical",
            range: 150, damage: 0, fireRate: 0, cost: 110, support: true, buff: 0.20, buffPerLevel: 0.04, color: "#fde047",
            desc: "不攻擊，強化範圍內其他塔的傷害。" },
};
// 升級：每級提升傷害與射程，造價遞增。Lv.10 給後期金錢出口，costMul 讓 7~10 級明顯昂貴但仍可追求。
const UPGRADE = { damageMul: 1.5, rangeMul: 1.08, costMul: 1.52, maxLevel: 10 };

// ===== 敵人定義 =====
// hp 基礎血量、speed 速度(px/s)、reward 擊殺金錢、leak 漏過扣的生命
const ENEMIES = {
  slime:  { id: "slime",  name: "史萊姆", emoji: "🟢", element: "physical", hp: 40,  speed: 45, reward: 8,  leak: 1, color: "#22c55e" },
  goblin: { id: "goblin", name: "哥布林", emoji: "👺", element: "physical", hp: 28,  speed: 80, reward: 10, leak: 1, color: "#84cc16" },
  orc:    { id: "orc",    name: "獸人",   emoji: "👹", element: "physical", hp: 120, speed: 35, reward: 18, leak: 2, color: "#b45309" },
  bat:    { id: "bat",    name: "蝙蝠群", emoji: "🦇", element: "thunder",  hp: 22,  speed: 95, reward: 7,  leak: 1, color: "#7c3aed" },
  // Stage 1 補元素克制閉環：原本沒有冰/火系普通敵人，「火克冰」在實戰永遠打不出來，
  // 加農砲（火）拿不到克制加成、教學跟實際對不上。現在每種元素塔都有明確克制目標：
  // 加農砲(火)→冰霜狼、寒冰塔(冰)→蝙蝠、電磁塔(雷)→火焰小鬼（無 PNG 時自動用 emoji 畫）
  frostwolf: { id: "frostwolf", name: "冰霜狼",   emoji: "🐺", element: "ice",  hp: 60, speed: 65, reward: 12, leak: 1, color: "#38bdf8" },
  imp:       { id: "imp",       name: "火焰小鬼", emoji: "👿", element: "fire", hp: 45, speed: 70, reward: 10, leak: 1, color: "#f97316" },
  shieldman: { id: "shieldman", name: "盾兵",     emoji: "🛡️", element: "physical", hp: 85, shield: 65, speed: 42, reward: 16, leak: 2, color: "#64748b" },
  medic:     { id: "medic",     name: "醫官",     emoji: "💚", element: "physical", hp: 70, speed: 32, reward: 20, leak: 1,
               healRadius: 80, healAmount: 14, healInterval: 2, color: "#4ade80" },
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
  maxLevel: 8,
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

// ===== 地圖 =====
// path 是 Canvas 像素座標；goldMul 影響起始金錢與通關波次獎勵。
const MAPS = {
  plains: {
    id: "plains", label: "翠綠平原", emoji: "🌿", goldMul: 1.0,
    desc: "標準蜿蜒路線，資源完整，適合熟悉塔陣。",
    path: [
      { x: 0,   y: 120 }, { x: 360, y: 120 }, { x: 360, y: 300 },
      { x: 120, y: 300 }, { x: 120, y: 460 }, { x: 600, y: 460 },
      { x: 600, y: 220 }, { x: 840, y: 220 }, { x: 840, y: 556 }, { x: 900, y: 556 },
    ],
  },
  canyon: {
    id: "canyon", label: "迂迴峽谷", emoji: "⛰️", goldMul: 0.85,
    desc: "更長更曲折，但補給較少，適合挑戰精密佈陣。",
    path: [
      { x: 0, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 220 },
      { x: 70, y: 220 }, { x: 70, y: 380 }, { x: 320, y: 380 },
      { x: 320, y: 150 }, { x: 520, y: 150 }, { x: 520, y: 500 },
      { x: 760, y: 500 }, { x: 760, y: 280 }, { x: 900, y: 280 }, { x: 900, y: 556 },
    ],
  },
};

let _map = "plains";
function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }
function setMap(id) { if (hasOwn(MAPS, id)) _map = id; }
function getMap() { return hasOwn(MAPS, _map) ? MAPS[_map] : MAPS.plains; }

// ===== 難度模式（社群鉤子：主流可過 + 高難挑戰）=====
// hpMul 敵人血量倍率、goldMul 金錢倍率、goddessMul 女神血量倍率、bossEvery Boss 頻率
const DIFFICULTIES = {
  normal: { id: "normal", label: "普通", emoji: "🛡️", color: "#4ade80",
            hpMul: 1.0, goldMul: 1.0, goddessMul: 1.0, bossEvery: 5,
            desc: "主流玩家能過，輕鬆上手享受塔防樂趣。" },
  brutal: { id: "brutal", label: "嚴酷", emoji: "🔥", color: "#f97316",
            hpMul: 1.5, goldMul: 0.85, goddessMul: 0.8, bossEvery: 4,
            desc: "敵人更強、資源更緊、Boss 更頻繁。需要真正研究搭配才過得了——值得寫攻略！" },
  endless:{ id: "endless", label: "無盡煉獄", emoji: "💀", color: "#dc2626",
            hpMul: 1.3, goldMul: 0.9, goddessMul: 0.7, bossEvery: 3,
            desc: "極限挑戰，比拼最高波數。撐得越久越強，看你能撐到第幾波？" },
};

// ===== 特殊事件波（D8：詞綴波增加變化與驚喜）=====
// 非 Boss 波有機率變成事件波。每種有獨特規則與獎勵。
const EVENT_WAVES = {
  rush:    { id: "rush",    label: "狂奔波", emoji: "💨", color: "#38bdf8",
             desc: "敵人全速衝刺！", speedMul: 1.8, hpMul: 0.7, countMul: 1.2, goldMul: 1.3 },
  elite:   { id: "elite",   label: "精英波", emoji: "💪", color: "#a855f7",
             desc: "少量高血精英", speedMul: 0.8, hpMul: 2.5, countMul: 0.5, goldMul: 1.6 },
  swarm:   { id: "swarm",   label: "蟲潮波", emoji: "🦇", color: "#7c3aed",
             desc: "大量快速小怪", speedMul: 1.3, hpMul: 0.6, countMul: 2.0, goldMul: 1.1, forceType: "bat" },
  treasure:{ id: "treasure",label: "寶藏波", emoji: "💰", color: "#facc15",
             desc: "擊殺獲得大量金錢", speedMul: 1.0, hpMul: 0.8, countMul: 0.8, goldMul: 3.0 },
};
// 決定某波是否為事件波（避開 Boss 波、第 5 波後才有）。
// 條件用 wave % 3 === 2，不能用 % 3 === 0：無盡煉獄的 bossEvery=3 會讓所有
// 3 的倍數波都是 Boss 波，事件波在該難度永遠不會出現（狂奔/精英/蟲潮/寶藏全消失）。
// ≡2 mod 3（8,11,14,17…）跟任何 3 的倍數永不相撞，其他難度只有零星撞 Boss（該波跳過）。
function getEventWave(wave, isBoss, rng) {
  if (isBoss || wave < 5 || wave % 3 !== 2) return null;
  const keys = Object.keys(EVENT_WAVES);
  // rng 是 0~1 的 seed 數值：用 == null 判斷，不能用 ||——seed 剛好為 0 時
  // 會被當 falsy 改走真隨機，破壞「預告與實際出怪同 seed」的確定性
  const r = rng == null ? Math.random() : rng;
  return EVENT_WAVES[keys[Math.floor(r * keys.length)]];
}

// ===== 波次主元素傾向（D4 預告 + Stage 1 讓預告真的生效）=====
// 之前 previewNextWave 顯示的「主🔥/❄️/⚡」是假的——startWave 出怪完全沒用它。
// 抽成共用純函式讓預告與實際出怪讀同一個來源，並提供該主題的敵人池給出怪偏壓。
const WAVE_THEMES = [null, "physical", "thunder", "ice", "fire"];
function waveTheme(wave) {
  return wave >= 4 ? WAVE_THEMES[Math.floor(wave / 3) % WAVE_THEMES.length] : null;
}
function themeEnemyPool(theme) {
  const pool = Object.values(ENEMIES).filter((e) => !e.boss && e.element === theme).map((e) => e.id);
  return pool.length ? pool : null;
}

// ===== 長期目標成就（Stage 3）=====
// check(meta, context) 必須保持純判斷；獎勵發放由 rules.js 的 evaluateAchievements() 處理。
const ACHIEVEMENTS = {
  wave10: { id: "wave10", label: "站穩防線", desc: "單場撐到第 10 波", reward: 10,
            check: (meta, ctx = {}) => (ctx.wave || 0) >= 10 },
  wave10First: { id: "wave10First", label: "十波首通", desc: "首次撐到第 10 波的額外獎勵", reward: 20,
                 check: (meta, ctx = {}) => (ctx.wave || 0) >= 10 },
  wave20: { id: "wave20", label: "老練指揮官", desc: "單場撐到第 20 波", reward: 25,
            check: (meta, ctx = {}) => (ctx.wave || 0) >= 20 },
  wave30: { id: "wave30", label: "無盡守護者", desc: "單場撐到第 30 波", reward: 50,
            check: (meta, ctx = {}) => (ctx.wave || 0) >= 30 },
  kills100: { id: "kills100", label: "百人斬", desc: "累計擊殺 100 名敵人", reward: 15,
              check: (meta) => (meta.totalKills || 0) >= 100 },
  kills1000: { id: "kills1000", label: "千敵破陣", desc: "累計擊殺 1000 名敵人", reward: 50,
               check: (meta) => (meta.totalKills || 0) >= 1000 },
  games10: { id: "games10", label: "十戰磨練", desc: "累計完成 10 局", reward: 20,
             check: (meta) => (meta.games || 0) >= 10 },
  games50: { id: "games50", label: "百折不撓", desc: "累計完成 50 局", reward: 50,
             check: (meta) => (meta.games || 0) >= 50 },
  heroesAll: { id: "heroesAll", label: "英雄集結", desc: "收集全部英雄", reward: 40,
               check: (meta, ctx = {}) => (ctx.ownedHeroCount || 0) >= (ctx.totalHeroCount || 1) },
};

let _difficulty = "normal";
function setDifficulty(id) { if (DIFFICULTIES[id]) _difficulty = id; }
function getDifficulty() { return DIFFICULTIES[_difficulty] || DIFFICULTIES.normal; }

// 計算某波的金錢獎勵與血量倍率（D2 修碾壓 + 難度修正）
function waveGoldBonus(wave) { return Math.round(GAME.waveBonusBase * Math.pow(GAME.waveBonusGrowth, wave) * getDifficulty().goldMul); }
function waveHpScale(wave) {
  const base = wave <= 10
    ? Math.pow(1 + GAME.hpGrowthEarly, wave - 1)
    : Math.pow(1 + GAME.hpGrowthEarly, 9) * Math.pow(1 + GAME.hpGrowthLate, wave - 10);
  return base * getDifficulty().hpMul;
}

if (typeof window !== "undefined") {
  Object.assign(window, { ELEMENTS, COUNTERS, elementMultiplier, TOWERS, UPGRADE, ENEMIES, SKILLS, GAME, GODDESS, MAPS, setMap, getMap, waveGoldBonus, waveHpScale, DIFFICULTIES, setDifficulty, getDifficulty, EVENT_WAVES, getEventWave, WAVE_THEMES, waveTheme, themeEnemyPool, ACHIEVEMENTS });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ELEMENTS, COUNTERS, elementMultiplier, TOWERS, UPGRADE, ENEMIES, SKILLS, GAME, GODDESS, MAPS, setMap, getMap, waveGoldBonus, waveHpScale, DIFFICULTIES, setDifficulty, getDifficulty, EVENT_WAVES, getEventWave, WAVE_THEMES, waveTheme, themeEnemyPool, ACHIEVEMENTS };
}
