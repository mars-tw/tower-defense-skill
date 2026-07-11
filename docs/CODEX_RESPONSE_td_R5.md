# Codex Response td R5

| 項目 | 結論 |
|---|---|
| 覆核來源 | `docs/GROK_REVIEW_td_R5.md` |
| 入版版本 | `td-r55-v1` / `0.5.5` |
| 主要處置 | 採納 R5 P1：粒子與 SFX cap 滿時改為保留關鍵警示，優先擠掉裝飾性效果。 |

## 處置摘要

| R5 項目 | 處置 | 說明 |
|---|---|---|
| N1 / P1 粒子 cap eviction 語意不足 | 已修 | `pushParticle` 改為優先級 eviction。`criticalFx` 粒子不可被後續裝飾粒子擠掉；cap 滿時新警示/Boss 粒子會優先移除砲口閃、一般爆散等非關鍵粒子。 |
| Boss / 漏怪警示特效可能被裝飾效果淹沒 | 已修 | 漏怪女神受擊 burst 標記 `fxKind: "leak-warning"`；Boss 擊殺 burst/ring 標記 `fxKind: "boss"`，皆為 `criticalFx`。 |
| N4 / P2 SFX cap 滿時警告音可能被丟棄 | 已修 | SFX 新增優先級：`boss/leak > wave > fire/hit/kill`。cap 滿時警告音可擠掉擊殺/命中/開火音；低優先級音不能擠掉警告音。 |
| e2e 只驗 cap 數量、不驗語意 | 已修 | e2e 新增 cap 滿場景：裝飾粒子填滿後，漏怪警示與 Boss 關鍵特效仍會出現並維持 `<= 220`；SFX 模擬驗證警告音優先於擊殺音。 |
| N2 / P2 slow-mo 粒子壽命縮放 | 維持 | R5 判定主邏輯 dt 已修。粒子壽命使用 `fxDt` 是視覺 slow-mo 契約，未改動決定性邏輯。 |
| N5 / P2 filter 計數 O(n) | 延後 | cap 僅 220，現階段成本可控；本輪聚焦 eviction 語意，避免引入額外狀態同步風險。 |

## 驗收

- 版本已同步到 `td-r55-v1` / `0.5.5`。
- 舊版 PWA 與 npm 版本字串 grep 歸零。
- 決定性路徑未改：波次 seed、spawn timeline、logic `dt` 均未調整。
- 測試：`npm test` 與 `npm run test:e2e` 連跑 3 次。
