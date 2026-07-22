# R77 無頭經濟／戰鬥模擬方法

## 可重現指令

```powershell
npm run sim:r77 -- --profile=compare --seed-count=24 --out-dir=docs/evidence/r77
```

輸出：`before-stats.json`、`after-stats.json`、`comparison.json`。

## 模擬邊界

- 環境：Chromium headless、翠綠平原、普通難度、第 1–8 波、24 組固定 `runSeed`；`affixSeed` 也由同一固定清單作確定性排列。
- 引擎：頁面載入正式 `src/config.js`、`src/rules.js`、`src/game.js`；出怪使用 `TDRules.generateWaveQueue()`，戰鬥以 1/60 秒固定步長呼叫正式 `update()`。
- 沒有另寫簡化戰鬥：正式尋敵、投射物、元素倍率、緩速、DoT、技能、連殺金、漏怪、女神傷害與清波金都照遊戲執行。唯一略過的是每步 Canvas render。
- 技能節奏：重播真人試玩的波內等待節奏；第 1 波在 0.9 秒使用隕石，其餘波於記錄時間使用可用的冰封／雷暴／神罰／封魔陣，瞄準當下最大敵群，避免空放把操作誤差當成平衡壓力。
- 遙測：`combatTelemetry` 只記錄已發生的傷害、收入、Boss、漏怪與時鐘，不回饋戰鬥判定。

## 塔陣策略

| 策略 | 第 0 波 | 第 3 波後 | 第 4 波後 |
|---|---|---|---|
| `playtest` | 砲 100＋冰 70＋箭 50 | 電磁 130＋聖光 110＋箭升級 76（合計 316） | 不加碼 |
| `boss-ready` | 同 `playtest` | 同 `playtest` | 電磁升 Lv2（198） |
| `no-reinvest` | 砲＋冰＋箭 | 不投資 | 不投資 |
| `all-arrow` | 四座箭塔 | 集中升第一座並補箭塔 | 不投資 |

## 指標定義

- 收入：正式 runtime 實收 `killGold + waveGold`；`bossGold` 是擊殺金中的 Boss 子集合，包含當下連殺倍率。
- 支出空間：每波記錄波前支出、波末金、可負擔建造／升級動作數、最低下一筆成本與支付後餘額。
- 敵方壓力：實際生成 HP＋盾量除以最晚無控場抵達終點期限，得到 `requiredThroughputDps`。
- 防線吞吐：波前塔陣的單體名目 DPS，以及 runtime 實際造成的 `playerDamage`／來源拆分。
- Boss 威脅：Boss 耐久、受到傷害、擊殺率、潛在／實際女神傷害與壓力比。

`comparison.json` 另以相同 24 seeds 比對 1–50 波 queue：第 1–4 波 96 組零差異、第 5 波 24/24 有差異、第 6–50 波 1,080 組零差異。
