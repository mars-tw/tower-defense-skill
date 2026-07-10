# Codex Response td R3

| 項目 | 結論 |
|------|------|
| 回應對象 | `docs/GROK_REVIEW_td_R3.md` |
| 入版版本 | `td-r52-v1` / `0.5.2` |
| 必修 | 採納 R3-D1 事件波 runSeed salt；採納 R3-B1/3.4 臼砲盲區交互修正 |
| 決定性契約 | 預告與實波仍共用 `wavePlanFor()`；出怪 queue 與事件標籤同源；局中不引入 `Math.random` 決定出怪 |
| Git | 未 commit，未 push |

## 逐條回應

| R3 項目 | 處置 | 說明 |
|---------|------|------|
| R3-D1 事件波類型不吃 runSeed | 採納 | `src/rules.js` 的 `eventWaveSeed(wave, runSeed, affixSeed)` 支援 salt；`generateWaveQueue()` 將 numeric wave seed 傳入事件抽選。遊戲主路徑的 numeric seed 已由 `waveRngSeed(w, runSeed, affixSeed)` 產生，因此同局可重現、不同 run 可變。 |
| R3-B1 mortar `minRange` 隨升級膨脹 | 採納 | `src/game.js` 的 `towerStat(tw, "minRange")` 改為固定基礎盲區 70；射程仍隨升級與詞綴成長。Lv10 仍有實質盲區，但升級不再懲罰腳下防守。 |
| R3-3.4 mortar × beacon 盲區滯留 | 採納緩解 | 選擇最可讀的方案：保留 mortar 盲區代價，固定盲區避免高等臼砲被 beacon 放大死角；UI 補提示「不補臼砲盲區」、「腳下需由其他塔補位」。beacon 仍無傷害。 |
| R3-D2 `getEventWave` null fallback | 延後 | 主路徑一律傳入 seed，不踩 fallback；本輪只修會影響實際 run 分布的路徑。 |
| R3-D3 戰鬥結果非全決定性 | 延後 | 本輪契約聚焦出怪與預告；動畫 seed、閃避骰仍屬戰鬥表現層舊債。 |
| warden × medic 偏硬 | 記錄延後 | 屬意圖內保隊雙核；多 warden 不疊乘已封住最壞情況。 |
| mute × aftershock、reflect × DoT、beacon × frost | 不改 | R3 判定 PASS；既有測試維持。 |

## 實作摘要

- `src/rules.js`
  - `eventWaveSeed()` 新增 salt 參數。
  - `generateWaveQueue()` 將 numeric `rng` seed 作為事件 salt，讓事件表跟隨 run seed，但與 queue 仍同源。
- `src/game.js`
  - `minRange` 固定為塔基礎值，不再套 `rangeMul` 或 `towerRangeMul`。
  - 建塔預覽盲區圈改用固定 `def.minRange`。
- `src/ui.js`
  - beacon 與 mortar 資訊列補盲區交互提示。
- `scripts/test-rules.js`
  - 補同 runSeed 事件表可重現、不同 runSeed 事件分布不同。
- `scripts/test-td-e2e.js`
  - 補遊戲預告路徑的事件表 runSeed 差異測試。
  - 補 Lv10 mortar 只擴外圈、不放大盲區，且距離 100px 目標仍可被高等臼砲選取。
- 版本同步
  - `package.json` / `package-lock.json`：`0.5.2`
  - `index.html` / `sw.js`：`td-r52-v1`

## 驗證

| 守門 | 結果 |
|------|------|
| `npm test` | PASS |
| `npm run test:e2e` | PASS，連跑 3 次 |
| 版本守門 | PASS，PWA/SW/index 皆為 `td-r52-v1` |
| 文案守門 | PASS，無 mojibake / U+FFFD / 連續問號 |

## 版本 grep

Runtime 版本檔已無 `td-r51-v1` / `0.5.1`。歷史審查文件仍保留舊版號作審計脈絡，未改寫。
