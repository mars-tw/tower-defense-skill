# 塔防資料模型與數值索引

本文件對齊 `src/config.js`、`src/heroes.js`、`src/rules.js` 與 R11 後的 meta v5。

## 塔 `TOWERS`

| id | 類型 | 元素 | 射程 | 傷害 | 射速 | 費用 | 特性 |
|---|---|---|---:|---:|---:|---:|---|
| `arrow` | 箭塔 | physical | 130 | 10 | 2.0 | 50 | 便宜單體 |
| `cannon` | 砲塔 | fire | 120 | 26 | 0.75 | 100 | splash 50 |
| `frost` | 冰塔 | ice | 125 | 11 | 1.45 | 70 | slow 0.5 |
| `tesla` | 電塔 | thunder | 120 | 14 | 1.4 | 130 | pierce 3 |
| `poison` | 毒塔 | physical | 120 | 7 | 1.15 | 90 | 6 DPS、4 秒、3 層 |
| `support` | 支援塔 | physical | 150 | 0 | 0 | 110 | 鄰近塔 +20%，每級 +4% |

升級：

```js
UPGRADE = { damageMul: 1.5, rangeMul: 1.08, costMul: 1.52, maxLevel: 10 };
```

## 敵人與技能

| id | 元素 | HP | 速度 | 獎勵 | 漏怪傷害 | 備註 |
|---|---|---:|---:|---:|---:|---|
| `slime` | physical | 40 | 45 | 8 | 1 | 基礎敵人 |
| `goblin` | physical | 28 | 80 | 10 | 1 | 快速 |
| `orc` | physical | 120 | 35 | 18 | 2 | 厚血 |
| `bat` | thunder | 22 | 95 | 7 | 1 | 高速 |
| `frostwolf` | ice | 60 | 65 | 12 | 1 | 冰系 |
| `imp` | fire | 45 | 70 | 10 | 1 | 火系 |
| `shieldman` | physical | 85 + shield 65 | 42 | 16 | 2 | 第 5 波後 |
| `medic` | physical | 70 | 32 | 20 | 1 | 第 7 波後，治療半徑 80 |
| `boss` | fire | 500 | 28 | 150 | 8 | Boss |

| 技能 | 元素 | 冷卻 | 傷害 | 範圍 | 特性 |
|---|---|---:|---:|---:|---|
| `meteor` | fire | 18 | 120 | 80 | 範圍火傷 |
| `freeze` | ice | 22 | 20 | 999 | 全場凍結 3 秒 |
| `thunder` | thunder | 15 | 60 | 999 | 全場雷擊 |

元素克制：

```js
COUNTERS = { fire: "ice", ice: "thunder", thunder: "fire" };
// 克制 1.5 倍，被克 0.66 倍，其餘 1 倍
```

## 地圖、難度與波次

地圖：

| id | 名稱 | `goldMul` | path 節點 |
|---|---|---:|---:|
| `plains` | 翠綠平原 | 1.00 | 10 |
| `canyon` | 迂迴峽谷 | 0.85 | 13 |

難度：

| id | HP | 金幣 | 女神 HP | Boss 間隔 |
|---|---:|---:|---:|---:|
| `normal` | 1.0 | 1.0 | 1.0 | 5 |
| `brutal` | 1.5 | 0.85 | 0.8 | 4 |
| `endless` | 1.3 | 0.9 | 0.7 | 3 |

波次：

```js
baseCount = 5 + Math.floor(wave * 1.2);
if (isBoss) baseCount = Math.floor(baseCount * 0.5);
if (event) baseCount = Math.max(2, Math.round(baseCount * event.countMul));
```

- 第 1-10 波 HP 成長 15%，第 11 波後 10%。
- 第 5 波後可出盾兵，第 7 波後可出醫者。
- 事件波從第 5 波起，非 Boss 且 `wave % 3 === 2` 時出現。

事件波：

| id | speed | HP | count | gold | 備註 |
|---|---:|---:|---:|---:|---|
| `rush` | 1.8 | 0.7 | 1.2 | 1.3 | 高速 |
| `elite` | 0.8 | 2.5 | 0.5 | 1.6 | 精英 |
| `swarm` | 1.3 | 0.6 | 2.0 | 1.1 | 強制蝙蝠 |
| `treasure` | 1.0 | 0.8 | 0.8 | 3.0 | 高金幣 |

## 女神

| 欄位 | 值 |
|---|---:|
| `baseHp` | 100 |
| `hpPerLevel` | 60 |
| `upgradeCostBase` | 150 |
| `upgradeCostMul` | 1.7 |
| `maxLevel` | 8 |
| `smiteUnlockLevel` | 2 |
| `smiteRange` | 130 |
| `smiteDamage` | 25 |
| `smiteInterval` | 1.2 |

## 英雄與抽卡

`HEROES` 目前 10 位：

| id | 稀有度 | 元素 | 角色 | 備註 |
|---|---|---|---|---|
| `knight` | rare | physical | melee | 坦克 |
| `archer` | common | physical | ranged | 速射 |
| `mage` | epic | fire | ranged | splash 35 |
| `iceMage` | rare | ice | ranged | slow 0.4 |
| `valkyrie` | legendary | thunder | melee | 高速強攻 |
| `cleric` | common | physical | ranged | 每次攻擊治療女神 10 |
| `daji` | legendary | fire | ranged | splash 55 |
| `guanyu` | legendary | physical | melee | 高血高攻 |
| `wukong` | legendary | thunder | melee | pierce 3 |
| `nezha` | epic | fire | ranged | splash 20 |

英雄升級：

```js
HERO_LEVEL = {
  maxLevel: 10,
  xpBase: 30,
  xpGrowth: 1.35,
  hpPerLevel: 0.12,
  atkPerLevel: 0.10,
  xpPerKill: 6
};
```

抽卡：

```js
GACHA = { cost: 20, firstFree: true, pityLegendary: 18, dupRefund: 12 };
```

R11 英雄指揮：

- `state.heroes[]` 保存本局部署英雄，含 `uid`、`level`、`xp`、`runXp`、`levelsGained`。
- 點部署小卡會設定 `state.pendingHero`，下一次點地圖會寫入 `hero.guardPoint`。
- 駐守半徑 `HERO_GUARD_RADIUS = 130`，駐守英雄只攻擊半徑內敵人。
- 結算會把 `heroGrowth` 帶進 game over UI，顯示 XP 與升級摘要。

## R7 首 10 波任務線

| id | 條件 | 獎勵 |
|---|---|---:|
| `firstTower` | 建造 1 座塔 | 4 |
| `firstWave` | 清第 1 波 | 4 |
| `deployHero` | 部署 1 位英雄 | 4 |
| `firstUpgrade` | 升級 1 次塔 | 6 |
| `firstSkill` | 施放 1 次技能 | 5 |
| `wave3` | 清第 3 波 | 6 |
| `firstBoss` | 擊倒 1 隻 Boss | 4 |
| `secondHero` | 擁有/抽到第 2 位英雄 | 5 |

總獎勵 38 魂晶，保存於 `meta.beginnerMissions`，不可重複領取。

## Meta v5

localStorage key 為 `td_meta_v1`。

```js
META_DEFAULT = {
  version: 5,
  bestWave: 0,
  totalKills: 0,
  soulCrystal: 0,
  games: 0,
  gachaPity: 0,
  gachaCount: 0,
  bestByDiff: {},
  board: {},
  achievements: {},
  beginnerMissions: {},
  lastMap: "plains"
};
```

地圖分榜：

```js
board = {
  [diffId]: {
    [mapId]: [
      { wave, score, kills, at, map }
    ]
  }
};
```

- `updateBoard(board, diffId, mapId, entry, maxEntries = 10)` 不 mutate 原 board。
- 排序：wave 降冪，同 wave 以 score 降冪，再以時間排序。
- v3/v4 舊 flat board 會依 `entry.map` 分流；無 map 時歸 `plains`。
- 非法 diff/map key、NaN、Infinity 與污染 key 會被丟棄。

逐波魂晶：

```js
SOUL_REWARD_MUL_BY_DIFF = { normal: 1.8, brutal: 2.4, endless: 2.2 };
runSoulRewardTotal(wave, difficulty) = round(wave * multiplier);
waveSoulReward(wave, difficulty) = total(wave) - total(wave - 1);
```

清波時即時加到 meta；`settleRunRewards()` 只更新場次、擊殺、最高波與紀錄，不再二次增加清波魂晶。

## 成就

| id | 條件 | 獎勵 |
|---|---|---:|
| `wave10` | 單場達第 10 波 | 10 |
| `wave10First` | 首次達第 10 波 | 20 |
| `wave20` | 單場達第 20 波 | 25 |
| `wave30` | 單場達第 30 波 | 50 |
| `kills100` | 累計 100 擊殺 | 15 |
| `kills1000` | 累計 1000 擊殺 | 50 |
| `games10` | 累計 10 場 | 20 |
| `games50` | 累計 50 場 | 50 |
| `heroesAll` | 收集全部英雄 | 40 |

## 測試契約

| 指令 | 覆蓋 |
|---|---|
| `node scripts/test-config.js` | 資料 shape、元素、地圖、R7 任務 |
| `node scripts/test-heroes.js` | 英雄抽卡、保底、前 2 位未擁有偏好 |
| `node scripts/test-rules.js` | meta v5、波次、逐波魂晶、結算 |
| `node scripts/test-board.js` | 地圖分榜、成就、v5 遷移 |
| `node scripts/sim-balance.js` | 各地圖/難度平衡模擬 |
