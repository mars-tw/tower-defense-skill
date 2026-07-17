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
function towerTierSprites(id) {
  return Object.freeze([1, 2, 3].map((tier) => `assets/towers/tiers/${id}-tier${tier}.png`));
}
const TOWERS = {
  arrow:  { id: "arrow",  name: "弓箭塔", emoji: "🏹", element: "physical",
            range: 130, damage: 10, fireRate: 2.0, cost: 50, color: "#a3a3a3",
            sprites: towerTierSprites("arrow"), desc: "單體高射速，便宜萬用。" },
  cannon: { id: "cannon", name: "加農砲", emoji: "💣", element: "fire",
            range: 120, damage: 26, fireRate: 0.75, cost: 100, splash: 50, color: "#f97316",
            sprites: towerTierSprites("cannon"), desc: "範圍爆破，對成群敵人有效。" },
  frost:  { id: "frost",  name: "寒冰塔", emoji: "❄️", element: "ice",
            range: 125, damage: 11, fireRate: 1.45, cost: 70, slow: 0.5, color: "#38bdf8",
            sprites: towerTierSprites("frost"), desc: "便宜控場核心，減速敵人讓全隊多打幾輪。" },
  tesla:  { id: "tesla",  name: "電磁塔", emoji: "⚡", element: "thunder",
            range: 120, damage: 14, fireRate: 1.4, cost: 130, pierce: 3, color: "#facc15",
            sprites: towerTierSprites("tesla"), desc: "閃電連鎖，貫穿多個敵人。" },
  poison: { id: "poison", name: "毒霧塔", emoji: "☠️", element: "physical",
            range: 120, damage: 7, fireRate: 1.15, cost: 90, poisonDps: 6, poisonDuration: 4, poisonMaxStacks: 3, color: "#22c55e",
            sprites: towerTierSprites("poison"), desc: "命中附加可疊加毒素，持續咬血。" },
  support:{ id: "support",name: "聖光塔", emoji: "✨", element: "physical",
            range: 150, damage: 0, fireRate: 0, cost: 110, support: true, buff: 0.20, buffPerLevel: 0.04, color: "#fde047",
            sprites: towerTierSprites("support"), desc: "不攻擊，強化範圍內其他塔的傷害。" },
  beacon: { id: "beacon", name: "引魂燈塔", emoji: "🏮", element: "physical",
            range: 145, damage: 0, fireRate: 0, cost: 115, support: true, reveal: true, slowAura: 0.15, color: "#fb7185",
            sprites: towerTierSprites("beacon"), desc: "不攻擊，範圍內敵人暴露並小幅減速；與寒冰塔取較強減速。" },
  sniper: { id: "sniper", name: "狙擊塔", emoji: "🎯", element: "physical",
            range: 140, damage: 58, fireRate: 0.55, cost: 145, color: "#94a3b8",
            sprites: towerTierSprites("sniper"), desc: "長管弩炮鎖定遠距離目標，單發傷害極高。" },
  arcane: { id: "arcane", name: "奧術塔", emoji: "🔮", element: "physical",
            range: 130, damage: 15, fireRate: 1.4, cost: 105, vuln: { mult: 1.2, duration: 3 }, color: "#a855f7",
            sprites: towerTierSprites("arcane"), desc: "秘紋水晶標記敵人，使後續攻擊造成更多傷害。" },
  mortar: { id: "mortar", name: "墜星臼砲", emoji: "☄️", element: "fire",
            range: 170, minRange: 70, damage: 74, fireRate: 0.32, cost: 160, splash: 72, color: "#fb923c",
            targetPriority: "midpath", sprites: towerTierSprites("mortar"),
            desc: "超慢高爆火砲，最短射程內無法攻擊，適合炸中後段密集敵群。" },
};
// 升級：每級提升傷害與射程，造價遞增。Lv.10 給後期金錢出口，costMul 讓 7~10 級明顯昂貴但仍可追求。
// 毒素可疊 3 層，DoT 用獨立成長避免直接套 1.5 倍後壓過範圍/穿透塔定位。
const UPGRADE = { damageMul: 1.5, rangeMul: 1.08, poisonDpsMul: 1.32, costMul: 1.52, maxLevel: 10 };

// ===== 敵人定義 =====
// hp 基礎血量、speed 速度(px/s)、reward 擊殺金錢、leak 漏過扣的生命
const ENEMIES = {
  slime:  { id: "slime",  name: "史萊姆", emoji: "🟢", element: "physical", hp: 40,  speed: 45, reward: 8,  leak: 1, color: "#22c55e",
            counterHint: "弓箭塔便宜速射即可處理；混波時交給加農砲順清。" },
  goblin: { id: "goblin", name: "哥布林", emoji: "👺", element: "physical", hp: 28,  speed: 80, reward: 10, leak: 1, color: "#84cc16",
            counterHint: "寒冰塔先降速，首擊閃避後靠弓箭塔高攻速補刀。",
            ability: { id: "dodgeFirst", label: "狡詐閃避", desc: "35% 機率閃避第一次直接傷害。", chance: 0.35 } },
  orc:    { id: "orc",    name: "獸人",   emoji: "👹", element: "physical", hp: 120, speed: 35, reward: 18, leak: 2, color: "#b45309",
            counterHint: "毒霧塔持續咬血，殘血狂暴前用寒冰塔拖住。",
            ability: { id: "bloodrage", label: "殘血狂暴", desc: "生命低於 40% 時速度 +35%。", threshold: 0.4, speedMul: 1.35 } },
  bat:    { id: "bat",    name: "蝙蝠群", emoji: "🦇", element: "thunder",  hp: 22,  speed: 95, reward: 7,  leak: 1, color: "#7c3aed",
            counterHint: "寒冰塔克制雷系並降速，分裂後用加農砲或電磁塔清群。",
            ability: { id: "splitBat", label: "群翼分裂", desc: "死亡時分裂 1 隻小蝙蝠。", childHpMul: 0.45, childRewardMul: 0.35 } },
  // Stage 1 補元素克制閉環：原本沒有冰/火系普通敵人，「火克冰」在實戰永遠打不出來，
  // 加農砲（火）拿不到克制加成、教學跟實際對不上。現在每種元素塔都有明確克制目標：
  // 加農砲(火)→冰霜狼、寒冰塔(冰)→蝙蝠、電磁塔(雷)→火焰小鬼（無 PNG 時自動用 emoji 畫）
  frostwolf: { id: "frostwolf", name: "冰霜狼",   emoji: "🐺", element: "ice",  hp: 60, speed: 65, reward: 12, leak: 1, color: "#38bdf8",
               counterHint: "加農砲火系克制冰，配寒冰塔延長集火時間。" },
  imp:       { id: "imp",       name: "火焰小鬼", emoji: "👿", element: "fire", hp: 45, speed: 70, reward: 10, leak: 1, color: "#f97316",
               counterHint: "電磁塔雷系克制火，穿透可順清小鬼群。" },
  shieldman: { id: "shieldman", name: "盾兵",     emoji: "🛡️", element: "physical", hp: 85, shield: 65, speed: 42, reward: 16, leak: 2, color: "#64748b",
               counterHint: "毒霧塔穿盾直咬本體，電磁塔或加農砲補破盾。" },
  medic:     { id: "medic",     name: "醫官",     emoji: "💚", element: "physical", hp: 70, speed: 32, reward: 20, leak: 1,
               healRadius: 80, healAmount: 14, healInterval: 2, color: "#4ade80",
               counterHint: "優先電磁塔穿透或加農砲範圍擊殺，避免拖長治療。" },
  frostwraith: { id: "frostwraith", name: "冰魄妖", emoji: "👻", element: "ice", hp: 68, shield: 42, speed: 42, reward: 20, leak: 2, color: "#67e8f9",
                 ability: { id: "shieldRegen", label: "冰甲再生", desc: "脫離攻擊後冰甲會快速回復。", delay: 2.5, perSec: 20 },
                 counterHint: "雷系穿盾與持續壓制能阻止冰甲再生。" },
  lavagolem: { id: "lavagolem", name: "熔岩魔像", emoji: "🪨", element: "fire", hp: 120, shield: 65, speed: 30, reward: 25, leak: 3, color: "#f97316",
               ability: { id: "shieldRegen", label: "熔甲再生", desc: "脫離攻擊後熔岩護甲會回復。", delay: 2.8, perSec: 18 },
               counterHint: "電磁塔克制火系並持續壓盾，毒霧塔可咬本體。" },
  emberbat: { id: "emberbat", name: "焰蝠", emoji: "🦇", element: "fire", hp: 30, speed: 92, reward: 9, leak: 1, color: "#fb923c",
              ability: { id: "splitBat", childHpMul: 0.45, childRewardMul: 0.35, label: "餘燼分裂", desc: "死亡後分裂出一隻小蝙蝠。" },
              counterHint: "冰霜減速能攔住高速焰蝠分裂潮。" },
  thunderronin: { id: "thunderronin", name: "雷刃武士", emoji: "⚔️", element: "thunder", hp: 115, speed: 52, reward: 22, leak: 2, color: "#fde047",
                  ability: { id: "bloodrage", threshold: 0.4, speedMul: 1.3, label: "雷怒", desc: "生命低於 40% 時移動速度提高。" },
                  counterHint: "冰霜塔先手控速可壓住雷怒衝刺。" },
  abysshound: { id: "abysshound", name: "深淵獵犬", emoji: "🐺", element: "thunder", hp: 50, speed: 104, reward: 14, leak: 1, color: "#8b5cf6",
                ability: { id: "bloodrage", threshold: 0.45, speedMul: 1.25, label: "裂界疾奔", desc: "生命低於 45% 時速度提高。" },
                counterHint: "寒冰塔克制雷系並降速，路尾補弓箭塔收頭。" },
  silencer: { id: "silencer", name: "緘口妖僧", emoji: "🤐", element: "physical", hp: 92, speed: 48, reward: 24, leak: 2, color: "#c084fc",
              ability: { id: "towerMute", label: "噤聲咒", desc: "每 3 秒讓 115px 內最近一座塔停火 2 秒。", range: 115, interval: 3, duration: 2 },
              counterHint: "分散主力塔，先用狙擊塔或弓箭塔集火；引魂燈塔與寒冰塔可延後牠靠近核心塔。",
              loreLine: "牠們不殺塔，只偷走塔的聲音。" },
  mirrorling: { id: "mirrorling", name: "裂鏡童", emoji: "🪞", element: "physical", hp: 72, speed: 68, reward: 21, leak: 1, color: "#e879f9",
                ability: { id: "reflectOnce", label: "裂鏡反照", desc: "一生反射第一次技能傷害與附帶效果。" },
                counterHint: "不要把第一發隕石浪費在牠身上；用毒霧塔、電磁塔或普通塔火力拆掉反射。",
                loreLine: "鏡子裡的孩子只記得被雷劈的那一下。" },
  warden: { id: "warden", name: "裂界守門人", emoji: "🚪", element: "physical", hp: 150, speed: 30, reward: 30, leak: 3, color: "#f59e0b",
            ability: { id: "auraArmor", label: "守門光環", desc: "90px 內友軍受擊傷害 ×0.75。", radius: 90, damageMul: 0.75 },
            counterHint: "優先集火守門人；加農砲、墜星臼砲與毒霧塔能拆光環核心。",
            loreLine: "門還在，妖就還敢走。" },
  yaksha: { id: "yaksha", name: "夜叉王", emoji: "👿", element: "thunder", hp: 270, speed: 26, reward: 132, leak: 8, color: "#a855f7", boss: true,
            counterHint: "寒冰塔克制雷系並拖慢，毒霧塔與聖光支援可磨高血量。" },
  boss:   { id: "boss",   name: "魔王",   emoji: "😈", element: "fire",     hp: 500, speed: 28, reward: 150, leak: 8, color: "#dc2626", boss: true,
            counterHint: "電磁塔克制火，毒霧塔持續傷害，聖光塔支援主力塔。" },
};

// ===== 主動技能 =====
// cooldown 冷卻(秒)、damage 傷害、radius 範圍、effect 特效類型
const SKILLS = {
  meteor:  { id: "meteor",  name: "隕石術", emoji: "☄️", element: "fire",    cooldown: 18, damage: 120, radius: 80, color: "#f97316", desc: "對範圍內敵人造成大量火焰傷害。" },
  freeze:  { id: "freeze",  name: "冰封術", emoji: "🧊", element: "ice",     cooldown: 22, damage: 20, radius: 999, freezeDur: 3, color: "#38bdf8", desc: "凍結全場敵人 3 秒。" },
  thunder: { id: "thunder", name: "雷暴術", emoji: "🌩️", element: "thunder", cooldown: 15, damage: 60, radius: 999, color: "#facc15", desc: "對全場敵人造成雷電傷害。" },
  judgment:{ id: "judgment", name: "神聖裁決", emoji: "⚖️", element: "physical", cooldown: 20, damage: 45, radius: 120,
             vuln: { mult: 1.25, duration: 4 }, color: "#fde047", desc: "聖光審判範圍敵人並施加易傷。" },
  sealarray:{ id: "sealarray", name: "封魔陣", emoji: "🔯", element: "physical", cooldown: 24, damage: 35, radius: 130, rootDur: 2.4,
              color: "#c084fc", desc: "在指定範圍張開封魔陣，造成傷害並定身敵人 2.4 秒。" },
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
  hpGrowthLate: 0.085, // 第 11 波起血量成長率（R67：消除 W12 暴衝與後期斷崖）
  bossHpMul: 0.82,     // Boss 額外血量倍率（R67：降低 Boss 後大幅掉落）
  spawnInterval: 0.8,  // 同波敵人生成間隔(秒)
};

// ===== 地圖詞綴 =====
// 以「風險 / 報酬」成對設計；rules.js 只負責純函式抽選與數值套用。
const MAP_AFFIXES = {
  fog: {
    id: "fog", label: "濃霧", emoji: "🌫️",
    desc: "塔射程 -10%，擊殺金 +15%。",
    towerImpact: "長射程塔受影響最大；靠近路徑建塔，毒霧塔與寒冰塔補控場。",
    towerRangeMul: 0.90, killGoldMul: 1.15, waveGoldMul: 1.00, enemyHpMul: 1.00, enemySpeedMul: 1.00, towerDamageMul: 1.00,
    expectedGoldDelta: 0.10, expectedPowerDelta: -0.10,
  },
  aftershock: {
    id: "aftershock", label: "餘震", emoji: "🪨",
    desc: "每 3 波隨機一塔停火 2 秒，清波金 +12%。",
    towerImpact: "高單點塔停火最痛；分散主力塔並讓聖光塔覆蓋多點。",
    towerStunEvery: 3, towerStunDuration: 2, waveGoldMul: 1.12, killGoldMul: 1.00, enemyHpMul: 1.00, enemySpeedMul: 1.00, towerRangeMul: 1.00, towerDamageMul: 1.00,
    expectedGoldDelta: 0.07, expectedPowerDelta: -0.06,
  },
  harvest: {
    id: "harvest", label: "豐收", emoji: "🌾",
    desc: "清波金 +20%，敵人生命 +10%。",
    towerImpact: "敵血變厚；優先升級主力塔，波獎勵可提早補聖光塔。",
    waveGoldMul: 1.20, enemyHpMul: 1.10, killGoldMul: 1.00, enemySpeedMul: 1.00, towerRangeMul: 1.00, towerDamageMul: 1.00,
    expectedGoldDelta: 0.12, expectedPowerDelta: 0.10,
  },
  overcharge: {
    id: "overcharge", label: "超載", emoji: "⚡",
    desc: "塔傷害 +8%，敵人速度 +8%。",
    towerImpact: "所有攻擊塔受益；敵速也快，寒冰塔攔截價值提高。",
    towerDamageMul: 1.08, enemySpeedMul: 1.08, waveGoldMul: 1.00, killGoldMul: 1.00, enemyHpMul: 1.00, towerRangeMul: 1.00,
    expectedGoldDelta: 0.00, expectedPowerDelta: 0.00,
  },
  demontide: {
    id: "demontide", label: "魔潮", emoji: "🌀",
    desc: "敵人生命 +5%、速度 +5%，塔傷害 +2%，清波金 +4%，擊殺金 +10%。",
    towerImpact: "妖潮壓力上升；塔傷害略增但仍需控場塔拖住高速單位。",
    enemyHpMul: 1.05, enemySpeedMul: 1.05, towerDamageMul: 1.02, towerRangeMul: 1.00, waveGoldMul: 1.04, killGoldMul: 1.10,
    expectedGoldDelta: 0.08, expectedPowerDelta: 0.10,
  },
  bloodmoon: {
    id: "bloodmoon", label: "血月", emoji: "🌙",
    desc: "敵人生命 +10%，擊殺金 +18%。",
    towerImpact: "塔需要更穩定的集火與補刀節奏，擊殺金可支撐中期升級。",
    enemyHpMul: 1.10, killGoldMul: 1.18, waveGoldMul: 1.00, enemySpeedMul: 1.00, towerRangeMul: 1.00, towerDamageMul: 1.00,
    expectedGoldDelta: 0.10, expectedPowerDelta: 0.10,
  },
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
  lava: {
    id: "lava", label: "熔岩峽道", emoji: "🌋", goldMul: 0.95,
    desc: "熔岩裂谷路線曲折，金流略低但有足夠迴旋空間。",
    path: [
      { x: 0, y: 140 }, { x: 280, y: 140 }, { x: 280, y: 300 },
      { x: 120, y: 300 }, { x: 120, y: 480 }, { x: 500, y: 480 },
      { x: 500, y: 220 }, { x: 720, y: 220 }, { x: 720, y: 556 }, { x: 900, y: 556 },
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
            hpMul: 1.42, goldMul: 0.88, goddessMul: 0.8, bossEvery: 4,
            desc: "敵人更強、資源更緊、Boss 更頻繁。需要真正研究搭配才過得了——值得寫攻略！" },
  endless:{ id: "endless", label: "無盡煉獄", emoji: "💀", color: "#dc2626",
            hpMul: 1.22, goldMul: 0.94, goddessMul: 0.7, bossEvery: 3,
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
             desc: "大量快速小怪", speedMul: 1.3, hpMul: 0.8, countMul: 2.0, goldMul: 1.1, forceType: "bat" },
  treasure:{ id: "treasure",label: "寶藏波", emoji: "💰", color: "#facc15",
             desc: "擊殺獲得大量金錢", speedMul: 1.0, hpMul: 0.8, countMul: 0.8, goldMul: 3.0 },
  rift:    { id: "rift",    label: "裂界波", emoji: "🌀", color: "#c084fc",
             desc: "裂界妖魔混入戰線", speedMul: 1.05, hpMul: 1.18, countMul: 1.0, goldMul: 1.35 },
  eclipse: { id: "eclipse", label: "蝕火波", emoji: "🌑", color: "#fb7185",
             desc: "神火被遮，塔傷害降低但擊殺更肥", speedMul: 1.0, hpMul: 1.0, countMul: 1.0, goldMul: 1.4, towerDamageMul: 0.85 },
  pilgrim: { id: "pilgrim", label: "朝聖波", emoji: "🕯️", color: "#fbbf24",
             desc: "朝聖者與護衛穿越戰線，擊殺朝聖者有高額金錢", speedMul: 0.95, hpMul: 0.9, countMul: 0.85, goldMul: 1.1,
             special: { role: "pilgrim", type: "slime", hpMul: 1.5, speedMul: 0.7, rewardMul: 8, leak: 1, name: "朝聖者", emoji: "🧎", color: "#fef3c7" } },
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
  wave40: { id: "wave40", label: "四十波守望", desc: "單場推進到第 40 波", reward: 75,
            check: (meta, ctx = {}) => (ctx.wave || 0) >= 40 },
  kills100: { id: "kills100", label: "百人斬", desc: "累計擊殺 100 名敵人", reward: 15,
              check: (meta) => (meta.totalKills || 0) >= 100 },
  kills1000: { id: "kills1000", label: "千敵破陣", desc: "累計擊殺 1000 名敵人", reward: 50,
               check: (meta) => (meta.totalKills || 0) >= 1000 },
  kills5000: { id: "kills5000", label: "萬軍斬將", desc: "累計擊殺 5000 名敵人", reward: 100,
               check: (meta) => (meta.totalKills || 0) >= 5000 },
  games10: { id: "games10", label: "十戰磨練", desc: "累計完成 10 局", reward: 20,
             check: (meta) => (meta.games || 0) >= 10 },
  games50: { id: "games50", label: "百折不撓", desc: "累計完成 50 局", reward: 50,
             check: (meta) => (meta.games || 0) >= 50 },
  games100: { id: "games100", label: "百戰老將", desc: "累計遊玩 100 場", reward: 80,
              check: (meta) => (meta.games || 0) >= 100 },
  heroesAll: { id: "heroesAll", label: "英雄集結", desc: "收集全部英雄", reward: 40,
               check: (meta, ctx = {}) => (ctx.ownedHeroCount || 0) >= (ctx.totalHeroCount || 1) },
  bondMax: { id: "bondMax", label: "羈絆圓滿", desc: "任一英雄羈絆達 Lv.15", reward: 60,
             check: (meta) => Object.values((meta && meta.heroProgress) || {}).some((p) => (p.level || 1) >= 15) },
  chronicleComplete: { id: "chronicleComplete", label: "編年讀畢", desc: "解鎖全部戰役編年", reward: 80,
                       check: (meta, ctx = {}) => ctx.chronicleComplete === true },
};

// ===== 新手 10 波任務線（R7）=====
// 一次性小額魂晶，總增發 38💎：目標是讓新帳號在第 8 波前明確看到第二抽路徑，
// 但不取代成就與清波魂晶的長線節奏。
const BEGINNER_MISSIONS = {
  firstTower: { id: "firstTower", label: "立起第一座塔", desc: "建造任一座砲塔", reward: 4,
                check: (meta, ctx = {}) => (ctx.towersBuilt || ctx.towerCount || 0) >= 1 },
  firstWave: { id: "firstWave", label: "守住第一波", desc: "清掉第 1 波", reward: 4,
               check: (meta, ctx = {}) => (ctx.clearedWave || 0) >= 1 },
  deployHero: { id: "deployHero", label: "英雄上場", desc: "派出 1 位英雄協防", reward: 4,
                check: (meta, ctx = {}) => (ctx.deployedHeroCount || 0) >= 1 },
  firstUpgrade: { id: "firstUpgrade", label: "強化主力塔", desc: "升級任一座砲塔", reward: 6,
                  check: (meta, ctx = {}) => (ctx.towerUpgrades || 0) >= 1 || (ctx.maxTowerLevel || 1) >= 2 },
  firstSkill: { id: "firstSkill", label: "第一次施法", desc: "使用任一主動技能", reward: 5,
                check: (meta, ctx = {}) => (ctx.skillCasts || 0) >= 1 },
  wave3: { id: "wave3", label: "站穩前線", desc: "清掉第 3 波", reward: 6,
           check: (meta, ctx = {}) => (ctx.clearedWave || 0) >= 3 },
  firstBoss: { id: "firstBoss", label: "首殺魔王", desc: "擊倒第一隻 Boss", reward: 4,
               check: (meta, ctx = {}) => (ctx.bossKills || 0) >= 1 },
  secondHero: { id: "secondHero", label: "第二位英雄", desc: "抽到第 2 位英雄", reward: 5,
                check: (meta, ctx = {}) => (ctx.ownedHeroCount || 0) >= 2 || (ctx.gachaCount || 0) >= 2 },
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
  Object.assign(window, { ELEMENTS, COUNTERS, elementMultiplier, TOWERS, UPGRADE, ENEMIES, SKILLS, GAME, GODDESS, MAPS, MAP_AFFIXES, setMap, getMap, waveGoldBonus, waveHpScale, DIFFICULTIES, setDifficulty, getDifficulty, EVENT_WAVES, getEventWave, WAVE_THEMES, waveTheme, themeEnemyPool, ACHIEVEMENTS, BEGINNER_MISSIONS });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { ELEMENTS, COUNTERS, elementMultiplier, TOWERS, UPGRADE, ENEMIES, SKILLS, GAME, GODDESS, MAPS, MAP_AFFIXES, setMap, getMap, waveGoldBonus, waveHpScale, DIFFICULTIES, setDifficulty, getDifficulty, EVENT_WAVES, getEventWave, WAVE_THEMES, waveTheme, themeEnemyPool, ACHIEVEMENTS, BEGINNER_MISSIONS };
}
