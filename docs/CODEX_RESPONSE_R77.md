實作者：Codex（GPT-5）

# CODEX_RESPONSE R77

TD-R1-03 已完成：新增可重複的正式引擎無頭模擬，以 24 組固定 seeds 校準普通難度第 3–5 波經濟與首 Boss 壓力；採用只作用於普通難度第一隻 Boss 的最小調整，版本鏈更新為 `0.7.7 / td-r77-v1`。

## 模擬方法

`scripts/sim-economy-balance.mjs` 在 headless Chromium 載入正式遊戲，重用 `TDRules.generateWaveQueue()` 並以 60 Hz 固定步長驅動 `game.js` 的正式 `update()`。模擬沒有重寫戰鬥模型，只略過 Canvas render；出怪、尋敵、投射物、元素、狀態、技能、連殺、擊殺金、清波金與漏怪都由正式 runtime 結算。

範圍為普通／翠綠平原第 1–8 波、24 組固定 `runSeed + affixSeed`、四種塔陣：真人 316 金配置、同配置加買 Boss 保險、三塔不再投資、全箭塔偏科。每波輸出收入拆分、波前支出、波末支出空間、女神 HP、實際傷害、所需／可用吞吐與 Boss 威脅。完整方法見 `docs/evidence/r77/method.md`。

## 失衡根因

真人配置的 before 中位數：

| 波 | 擊殺金 | 清波金 | 其中 Boss 金 | 本波收入 | 波前支出 | 波末金 | 女神 HP |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 3 | 94 | 42 | 0 | 138 | 0 | 357 | 97 |
| 4 | 131 | 47 | 0 | 178 | 316 | 219 | 97 |
| 5 | 236 | 53 | 165 | 291 | 0 | 509 | 94 |

第 5 波收入中，擊殺金占 81.1%（236/291），Boss 單體經連殺後的 165 金占整波 56.7%；清波金只有 53。第 4 波高回收讓 316 金投資很快補回，而首 Boss 原本 95.8% seeds 被擊殺、95.8% 零漏，證明主因是「Boss 報酬＋實際威脅」，不是升級成本太貴，也不是 wave bonus 單獨失控。

## 最小調整

- `DIFFICULTIES.normal.firstBossSpeedMul = 1.40`：只縮短普通首 Boss 的防線曝險時間；HP 曲線不變。
- `DIFFICULTIES.normal.firstBossRewardMul = 0.70`：壓低首 Boss 連殺放大的金錢尖峰。
- 第 2 隻以後普通 Boss、嚴酷、無盡、所有第 1–4 波與第 6–50 波 queue 數值不變；塔造價與升級曲線不動。

## Before / After 證明

| 策略／第 5 波中位數 | 收入 | 波末金 | 女神 HP | 本波女神傷害 | Boss 擊殺率 | 零漏率 | 壓力比 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 真人配置 before | 291 | 509 | 94 | 0 | 95.8% | 95.8% | 0.19 |
| 真人配置 after，不加碼 | 141 | 382 | 65 | 32 | 37.5% | 37.5% | 0.24 |
| Boss-ready before，另花 198 | 297 | 348 | 97 | 0 | 100% | 100% | 0.17 |
| Boss-ready after，另花 198 | 238 | 299 | 94 | 0 | 79.2% | 79.2% | 0.22 |

不加碼已出現「保留現金但讓 Boss 穿線 32 傷」；把第 4 波資金拿去升 Lv2 電磁塔，則多數 seeds 可守住 Boss，但波末資金降至中位 299。這形成真實取捨，且首 Boss 傷害非必死。偏科全箭塔 after 第 5 波零漏率為 0%，三塔完全不再投資則第 8 波存活率為 0%，不能再把任意配置視為乾淨通關。

`comparison.json` 的規則級同 seed 比對：第 1–4 波 96 組零差異，第 5 波 24/24 有差異，第 6–50 波 1,080 組零差異。既有 `sim-balance` 仍通過：普通三地圖存活 22／24／24 波，嚴酷 15／10／12，無盡 19／18／18；後段曲線未被首 Boss 專屬係數改寫。

## Gate

- `npm test`：PASS，exit 0。
- `npm run test:e2e`：PASS，完整 R72 → R66/R76 控制 → R68 → TD E2E 單次連跑，exit 0，266.6 秒；R76 敵徽章真 tap 與失守回主選單均保留。
- `npm run test:rwd`：PASS，9 視口 × 2 頁，18 組零違規、零水平溢出。
- 版本鏈：`0.7.7 / td-r77-v1` 一致；執行面舊版號 grep 0。
- 秘密掃描：0 命中；`git diff --check`：PASS。

## 證據與殘留

- `docs/evidence/r77/before-stats.json`：完整 before 逐 seed／逐波資料。
- `docs/evidence/r77/after-stats.json`：完整 after 逐 seed／逐波資料。
- `docs/evidence/r77/comparison.json`：中位差異與 1–50 波曲線不變證明。
- `docs/evidence/r77/method.md`、`gate-summary.md`：方法、策略、指標與 gate 摘要。

殘留：這是確定性 headless 策略樣本，不取代下一次真人玩感複驗；部分詞綴在第 3 波本來就可能造成少量漏怪，本輪未擴張範圍去重調整它。沒有 push；commit hash 由最終回報提供。
