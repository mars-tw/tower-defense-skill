# 塔防資料結構說明 (data-model.md)

加塔、加怪、加技能、調平衡都只改 `src/config.js`。

## 砲塔 TOWERS

```js
arrow: {
  id: "arrow", name: "弓箭塔", emoji: "🏹", element: "physical",
  range: 110,      // 射程(px)
  damage: 10,      // 每發傷害
  fireRate: 2.0,   // 每秒射擊次數
  cost: 50,        // 造價
  color: "#a3a3a3",
  desc: "說明",
  // 選擇性特殊效果：
  // splash: 45,   // 範圍傷害半徑（加農砲）
  // slow: 0.45,   // 減速比例 0~1（寒冰塔）
  // pierce: 3,    // 穿透目標數（電磁塔）
}
```

加新塔：在 `TOWERS` 加一筆，id 對應 `assets/towers/<id>.png`。升級數值由 `UPGRADE` 控制
（每級傷害 ×1.5、射程 ×1.12、造價 ×1.6，最高 4 級）。

## 敵人 ENEMIES

```js
slime: {
  id: "slime", name: "史萊姆", emoji: "🟢", element: "physical",
  hp: 40,       // 基礎血量（會隨波次成長）
  speed: 45,    // 移動速度 px/s
  reward: 8,    // 擊殺金錢
  leak: 1,      // 漏過終點扣的生命
  color: "#22c55e",
  // boss: true, // 標記為 Boss（更大、血更多）
}
```

## 主動技能 SKILLS

```js
meteor: {
  id: "meteor", name: "隕石術", emoji: "☄️", element: "fire",
  cooldown: 18,   // 冷卻秒數
  damage: 120,    // 傷害
  radius: 80,     // 影響半徑（999 = 全場）
  // freezeDur: 3, // 凍結秒數（冰封術）
  color: "#f97316", desc: "說明",
}
```

## 元素克制

`COUNTERS = { fire: "ice", ice: "thunder", thunder: "fire" }`（key 克 value）。
`elementMultiplier(atk, def)`：克制回 1.5、被反克回 0.66、其餘 1。物理對所有中性。

## 無盡波次平衡（GAME）

```js
GAME = {
  startGold: 200,        // 起始金錢
  startLives: 20,        // 起始生命
  waveBonus: 25,         // 每波結束獎勵
  bossEveryWaves: 5,     // 每 5 波出 Boss
  hpGrowthPerWave: 0.18, // 每波敵人血量成長率（無盡遞增的關鍵）
  spawnInterval: 0.8,    // 同波敵人生成間隔(秒)
}
```

想要更難：調高 `hpGrowthPerWave`、調低 `startGold`、縮短 `bossEveryWaves`。
想要更簡單：反之。

## 守護女神 GODDESS（被保護的核心）

女神站在路徑終點，是玩家要守護的對象。怪物漏過終點 = 攻擊女神扣生命，
女神生命歸零 = 遊戲結束。可花金升級。

```js
const GODDESS = {
  baseHp: 100,           // 起始生命上限
  hpPerLevel: 60,        // 每升一級 +60 上限並回滿
  upgradeCostBase: 150,  // 升級造價（隨等級遞增 ×1.7）
  maxLevel: 5,
  smiteUnlockLevel: 2,   // 2 級起解鎖「聖光反擊」
  smiteRange: 130, smiteDamage: 25, smiteInterval: 1.2, // 自動攻擊終點附近敵人
};
```

調女神強度：改 `baseHp`/`hpPerLevel`（耐打度）、`smiteDamage`/`smiteRange`（反擊強度）。

## 路徑

路徑在 `game.js` 的 `PATH` 陣列（一串 {x,y} waypoint）。改路徑形狀就改這個陣列；
改完路徑會自動重算「禁止建塔」的格位。女神位置自動設在路徑終點。
