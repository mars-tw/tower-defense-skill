# 塔防資料模型與規則同步表

本文件是 `src/config.js`、`src/heroes.js`、`src/rules.js` 的數值索引。調整平衡或擴充單位時，請同步更新這份文件與對應測試。

## 砲塔 `TOWERS`

| id | 名稱 | 元素 | 射程 | 傷害 | 攻速 | 造價 | 特殊效果 |
|---|---|---|---:|---:|---:|---:|---|
| `arrow` | 弓箭塔 | `physical` | 110 | 10 | 2.0 | 50 | 單體高速 |
| `cannon` | 加農砲 | `fire` | 95 | 26 | 0.75 | 100 | `splash: 50` |
| `frost` | 寒冰塔 | `ice` | 105 | 11 | 1.3 | 80 | `slow: 0.5` |
| `tesla` | 電磁塔 | `thunder` | 95 | 14 | 1.4 | 130 | `pierce: 3` |

升級曲線 `UPGRADE`：

| 欄位 | 值 |
|---|---:|
| `damageMul` | 1.55 |
| `rangeMul` | 1.1 |
| `costMul` | 1.5 |
| `maxLevel` | 6 |

## 敵人 `ENEMIES`

| id | 名稱 | 元素 | HP | 速度 | 擊殺金 | 漏過係數 | 備註 |
|---|---|---|---:|---:|---:|---:|---|
| `slime` | 史萊姆 | `physical` | 40 | 45 | 8 | 1 | 一般敵人 |
| `goblin` | 哥布林 | `physical` | 28 | 80 | 10 | 1 | 快速物理 |
| `orc` | 獸人 | `physical` | 120 | 35 | 18 | 2 | 高血慢速 |
| `bat` | 蝙蝠群 | `thunder` | 22 | 95 | 7 | 1 | 快速雷系 |
| `frostwolf` | 冰霜狼 | `ice` | 60 | 65 | 12 | 1 | Stage 1 補冰系 |
| `imp` | 火焰小鬼 | `fire` | 45 | 70 | 10 | 1 | Stage 1 補火系 |
| `boss` | 魔王 | `fire` | 500 | 28 | 150 | 8 | `boss: true` |

漏過傷害在 `game.js` 計算：一般敵人 `leak * 3`，Boss `leak * 4`。

## 技能 `SKILLS`

| id | 名稱 | 元素 | 冷卻 | 傷害 | 半徑 | 特殊效果 |
|---|---|---|---:|---:|---:|---|
| `meteor` | 隕石術 | `fire` | 18 | 120 | 80 | 範圍火焰傷害 |
| `freeze` | 冰封術 | `ice` | 22 | 20 | 999 | `freezeDur: 3` |
| `thunder` | 雷暴術 | `thunder` | 15 | 60 | 999 | 全場雷電傷害 |

## 元素克制

`COUNTERS = { fire: "ice", ice: "thunder", thunder: "fire" }`

`elementMultiplier(atkEl, defEl)`：

| 關係 | 倍率 |
|---|---:|
| 攻擊方克制防禦方 | 1.5 |
| 攻擊方被防禦方反克 | 0.66 |
| 其他或物理 | 1 |

## 女神 `GODDESS`

| 欄位 | 值 | 說明 |
|---|---:|---|
| `baseHp` | 100 | 起始生命上限 |
| `hpPerLevel` | 60 | 每級增加生命並回滿 |
| `upgradeCostBase` | 150 | 女神升級基礎花費 |
| `upgradeCostMul` | 1.7 | 升級花費倍率 |
| `maxLevel` | 5 | 最高等級 |
| `smiteUnlockLevel` | 2 | 解鎖聖光反擊等級 |
| `smiteRange` | 130 | 聖光反擊範圍 |
| `smiteDamage` | 25 | 聖光反擊傷害 |
| `smiteInterval` | 1.2 | 聖光反擊間隔 |

## 全域遊戲參數 `GAME`

| 欄位 | 值 | 說明 |
|---|---:|---|
| `startGold` | 220 | 起始金錢 |
| `cellSize` | 48 | 地圖格大小 |
| `waveBonusBase` | 30 | 波次通關獎勵基數 |
| `waveBonusGrowth` | 1.12 | 波次通關獎勵成長 |
| `bossEveryWaves` | 5 | 普通模式基準 Boss 週期 |
| `hpGrowthEarly` | 0.15 | 第 1 到 10 波血量成長 |
| `hpGrowthLate` | 0.10 | 第 11 波後血量成長 |
| `bossHpMul` | 1.0 | Boss 額外血量倍率 |
| `spawnInterval` | 0.8 | 同波敵人生成間隔秒數 |

通關金錢：

```js
waveGoldBonus(wave) =
  round(GAME.waveBonusBase * GAME.waveBonusGrowth ** wave * difficulty.goldMul)
```

敵人血量倍率：

```js
waveHpScale(wave) =
  wave <= 10
    ? (1 + hpGrowthEarly) ** (wave - 1) * difficulty.hpMul
    : (1 + hpGrowthEarly) ** 9 * (1 + hpGrowthLate) ** (wave - 10) * difficulty.hpMul
```

## 難度 `DIFFICULTIES`

| id | 名稱 | `hpMul` | `goldMul` | `goddessMul` | `bossEvery` |
|---|---|---:|---:|---:|---:|
| `normal` | 普通 | 1.0 | 1.0 | 1.0 | 5 |
| `brutal` | 嚴酷 | 1.5 | 0.85 | 0.8 | 4 |
| `endless` | 無盡煉獄 | 1.3 | 0.9 | 0.7 | 3 |

`rules.js` 的 `applyDifficulty(base, difficulty)` 會依欄位套用倍率：

- `hp`、`hpScale` 乘 `hpMul`
- `gold`、`goldBonus` 乘 `goldMul`
- `goddessHp` 乘 `goddessMul`
- 傳入數字時預設視為血量係數，乘 `hpMul`

## 事件波 `EVENT_WAVES`

事件波只會在非 Boss、波數至少 5、且 `wave % 3 === 2` 時出現。事件類型由波數 seed 決定，因此預告與實際出怪一致。

| id | 名稱 | `speedMul` | `hpMul` | `countMul` | `goldMul` | 特殊 |
|---|---|---:|---:|---:|---:|---|
| `rush` | 狂奔波 | 1.8 | 0.7 | 1.2 | 1.3 | 快速低血 |
| `elite` | 精英波 | 0.8 | 2.5 | 0.5 | 1.6 | 少量高血 |
| `swarm` | 蟲潮波 | 1.3 | 0.5 | 2.0 | 1.1 | `forceType: "bat"` |
| `treasure` | 寶藏波 | 1.0 | 0.8 | 0.8 | 3.0 | 高金錢 |

## 主題波

`WAVE_THEMES = [null, "physical", "thunder", "ice", "fire"]`

```js
waveTheme(wave) =
  wave >= 4 ? WAVE_THEMES[Math.floor(wave / 3) % WAVE_THEMES.length] : null
```

`generateWaveQueue(wave, difficulty, rng)` 會在有主題池時，以 55% 機率從 `themeEnemyPool(theme)` 選敵人。事件波若有 `forceType`，會優先強制該敵人。

## 波次組隊 `generateWaveQueue`

簽名：

```js
generateWaveQueue(wave, difficulty, rng)
```

回傳：

```js
{
  wave,
  count,      // 不含 Boss 的一般敵人數
  totalCount, // 含 Boss 的 queue 長度
  isBoss,
  event,
  theme,
  hpScale,
  queue       // [{ type, hpScale, event }]
}
```

一般敵人基礎數量：

```js
baseCount = 5 + Math.floor(wave * 1.2)
if (isBoss) baseCount = Math.floor(baseCount * 0.5)
if (event) baseCount = Math.max(2, Math.round(baseCount * event.countMul))
```

一般敵人池分布（沒有主題命中、沒有事件強制時）：

| 條件 | 敵人 |
|---|---|
| `wave < 3` 且 `roll < 0.7` | `slime` |
| `wave < 3` 且其他 | `goblin` |
| `roll < 0.30` | `slime` |
| `roll < 0.52` | `goblin` |
| `roll < 0.68` | `bat` |
| `roll < 0.80` | `frostwolf` |
| `roll < 0.90` | `imp` |
| 其他 | `orc` |

Boss 波會在 queue 尾端追加 `{ type: "boss", hpScale: hpScale * GAME.bossHpMul }`，事件波與 Boss 波互斥。

## 英雄與抽卡

### 英雄 `HEROES`

| id | 名稱 | 稀有度 | 元素 | 角色 | HP | 攻擊 | 速度 | 射程 | 攻速 | 特殊 |
|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| `knight` | 聖騎士 | `rare` | `physical` | `melee` | 220 | 18 | 70 | 40 | 1.2 | 近戰 |
| `archer` | 遊俠 | `common` | `physical` | `ranged` | 120 | 14 | 80 | 120 | 1.6 | 遠程 |
| `mage` | 大法師 | `epic` | `fire` | `ranged` | 140 | 28 | 60 | 110 | 0.9 | `splash: 35` |
| `iceMage` | 冰霜法師 | `rare` | `ice` | `ranged` | 130 | 16 | 60 | 110 | 1.1 | `slow: 0.4` |
| `valkyrie` | 女武神 | `legendary` | `thunder` | `melee` | 320 | 30 | 95 | 50 | 1.5 | 傳說近戰 |
| `cleric` | 牧師 | `common` | `physical` | `ranged` | 110 | 8 | 70 | 90 | 1.0 | `healGoddess: 10` |

### 英雄稀有度 `HERO_RARITY`

| 稀有度 | 星數 | 權重 |
|---|---:|---:|
| `common` | 1 | 55 |
| `rare` | 2 | 30 |
| `epic` | 3 | 12 |
| `legendary` | 4 | 3 |

### 英雄升級 `HERO_LEVEL`

| 欄位 | 值 |
|---|---:|
| `maxLevel` | 10 |
| `xpBase` | 30 |
| `xpGrowth` | 1.35 |
| `hpPerLevel` | 0.12 |
| `atkPerLevel` | 0.10 |
| `xpPerKill` | 6 |

### 抽卡 `GACHA`

| 欄位 | 值 | 說明 |
|---|---:|---|
| `cost` | 20 | 單抽魂晶花費 |
| `firstFree` | `true` | 首抽免費 |
| `pityLegendary` | 30 | 30 抽保底傳說 |
| `dupRefund` | 10 | 重複英雄退還魂晶 |

`rollHero(rng)` 與 `rollHeroWithPity(pityCount, rng)` 都是純函式；呼叫端負責扣魂晶、保存 `gachaPity` 與 `gachaCount`。

## 成就目錄 `ACHIEVEMENTS`

成就目錄放在 `src/config.js`，`check(meta, context)` 只做純判斷；一次性標記與魂晶獎勵由 `rules.js` 的 `evaluateAchievements(meta, context)` 處理。

| id | 名稱 | 條件 | 獎勵 |
|---|---|---|---:|
| `wave10` | 站穩防線 | 單場撐到第 10 波 | 10💎 |
| `wave20` | 老練指揮官 | 單場撐到第 20 波 | 25💎 |
| `wave30` | 無盡守護者 | 單場撐到第 30 波 | 50💎 |
| `kills100` | 百人斬 | 累計擊殺 100 名敵人 | 15💎 |
| `kills1000` | 千敵破陣 | 累計擊殺 1000 名敵人 | 50💎 |
| `games10` | 十戰磨練 | 累計完成 10 局 | 20💎 |
| `games50` | 百折不撓 | 累計完成 50 局 | 50💎 |
| `heroesAll` | 英雄集結 | 收集全部英雄 | 40💎 |

獎勵設計落在 10～50 魂晶：早期成就給小額回饋，中後期里程碑與全收集給較高獎勵，但不高於 3 抽以避免抽卡經濟失衡。

## Meta 存檔與死亡結算

localStorage key 仍為 `td_meta_v1`，資料本體由 `rules.js` 加入 `version` 欄位。

目前 `META_VERSION = 3`，`META_DEFAULT`：

```js
{
  version: 3,
  bestWave: 0,
  totalKills: 0,
  soulCrystal: 0,
  games: 0,
  gachaPity: 0,
  gachaCount: 0,
  bestByDiff: {},
  board: {},
  achievements: {}
}
```

`migrateMeta(raw)` 會用 `DEFAULT + Object.assign` 補欄位，並把非數字、`NaN`、`Infinity` 的數值欄位修回預設值；`bestByDiff` 只保留有限數字。v1（無 version）與 v2 存檔會無損升級到 v3。

新增巢狀欄位：

```js
board: {
  [diffId]: [{ wave, score, kills, at }]
},
achievements: {
  [achId]: true
}
```

`board` 每個難度只保留合法陣列項，非法項會丟棄；`achievements` 非物件會重置，只保留值為 `true` 的解鎖標記。

`settleRunRewards(state)` 簽名：

```js
settleRunRewards({
  meta,
  wave,
  score,
  kills,
  difficulty
})
```

死亡結算：

```js
earnedSoulCrystal = Math.max(1, Math.round(wave * 1.5))
```

同時更新：

- `bestByDiff[difficulty.id]`
- `bestWave`
- `soulCrystal`
- `games`
- `totalKills`

函式不改動傳入的 `meta`，而是回傳 `{ meta, earned, isRecord, previousBest, difficultyId, wave, kills }`。

`updateBoard(board, diffId, entry, maxEntries = 10)`：

- 回傳 `{ board, rank }`
- 不改動傳入的 `board`
- 依 `wave` 降冪排序，同 `wave` 依 `score` 降冪
- 每個難度最多保留前 10 名
- 新紀錄未進榜時 `rank` 為 `null`

`evaluateAchievements(meta, context)`：

- 回傳 `{ unlocked, meta }`
- 不改動傳入的 `meta`
- 只發放尚未解鎖的成就獎勵
- 會把新成就寫入 `meta.achievements`，並把一次性魂晶獎勵加到 `meta.soulCrystal`

## 測試入口

| 測試 | 覆蓋 |
|---|---|
| `node scripts/test-config.js` | 設定 shape、元素克制、事件波與難度基本健全性 |
| `node scripts/test-heroes.js` | 抽卡、權重、保底 |
| `node scripts/test-rules.js` | meta 遷移、死亡結算、波次組隊、難度係數 |
| `node scripts/test-board.js` | 排行榜排序/截斷/名次、成就獎勵、v3 遷移污染清洗 |
| `node scripts/sim-balance.js` | 三難度平衡煙霧測試 |
| `node scripts/test-td-e2e.js` | 真瀏覽器流程、抽卡經濟、主題波、排行榜/成就 overlay、RWD |
