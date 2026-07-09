# Codex Response — Grok R2

| 項目 | 結論 |
|------|------|
| 入版版本 | `td-r51-v1` / `0.5.1` |
| 必修 | 採納 R2-S1：新增 run-level salt，`waveSeed = hash(runSeed, affixSeed, wave)` |
| 保證 | 同局內 `previewNextWave()` 與 `startWave()` 仍共用同一 `waveSeed`，預告 queue = 實波 queue |
| 存檔 | `META_VERSION = 7`，舊 meta 無 `runSeed` 時補 deterministic 預設 `1`；匯出/匯入保留 `runSeed` |
| 不做 | 未 commit、未 push |

## 逐條回應

| Grok ID | 判定 | 本輪處理 |
|---------|------|----------|
| R2-S1 跨局波次組成永久固定 | 採納 | `src/game.js` 開局寫入 `state.runSeed`；`src/rules.js` 的 `waveRngSeed(w, runSeed, affixSeed)` 改為 hash salt。預告與實波仍透過同一 `waveSeedFor()`。 |
| R2-S2 戰鬥結果非全決定性 | 延後 | `_dodgeRoll`、動畫 seed、uid 屬戰鬥骰與視覺層，不影響「預告=實波」主路徑。本輪不做 full replay determinism。 |
| R2-S3 `getEventWave` null rng fallback | 延後 | 主路徑 `generateWaveQueue()` 仍固定傳 `eventWaveSeed(w)`，不踩 fallback。這是 API 面防禦性議題。 |
| R2-S4 `waveSeeds` 快取冗餘 | 部分處理 | 保留快取，但 key 改含 `runSeed:affixSeed:wave`，避免 salt 變更時命中舊 wave key。 |
| R2-T1 overrides 可覆寫 `type` | 延後 | debug/誤用邊角；生產路徑不傳 `type` override，`leak` 仍有 `id` fallback。 |
| R2-T2 `forceType` 未驗證 | 延後 | 現有 config 守門已驗證 `forceType` 指向合法敵種；資料契約可下輪加 assert。 |
| R2-T3 分裂蝙蝠 type/name | 駁回 bug | `type: "bat"`、`name: "小蝙蝠"` 是統計 key 與顯示名分離，非 undefined 回歸。 |
| R2-P1 `towerStat` level clamp | 延後 | 正常建塔/升級路徑皆有 `level >= 1`；屬防禦性一致化，未混入本輪 seed 修補。 |
| R2-P2 毒 DoT 不吃元素/寒冰協同 | 延後 | R1 已標部分採納；非 `poisonDpsMul` 接線回歸。 |
| R2-P3 毒不隨波次成長 | 駁回 bug | 實作目標是隨塔等級成長，不是隨 wave 成長；文件沿用此說法。 |

## 實作摘要

- `src/rules.js`：`META_VERSION 6 -> 7`，新增 `runSeed` meta 欄位、`normalizeRunSeed()`、salt hash 版 `waveRngSeed(w, runSeed, affixSeed)`；保留舊呼叫 `waveRngSeed(w)` 的相容行為。
- `src/game.js`：`newGame(options)` 產生/接受 `runSeed` 與 `affixSeed`；`state.runSeed` 存於本局 state；`waveSeedFor()` 用 `runSeed + affixSeed + wave` 算 seed，且預告與實波共用。
- `src/ui.js`：存檔匯入白名單加入 `runSeed`。
- `scripts/test-rules.js` / `scripts/test-td-e2e.js`：補同 runSeed 可重現、不同 runSeed 波次組成不同、runSeed 存檔往返穩定、預告 seed 等於 hash 結果、預告 queue = 實波 queue。
- `README.md` / `references/data-model.md`：meta schema 更新為 v7。

## 測試證明

| 要求 | 覆蓋 |
|------|------|
| 同 runSeed 下預覽=實波 | e2e：第 9 波 `preview.seed === waveRngSeed(9, state.runSeed, state.affixSeed)`，且 `preview.queue` 與 `state.spawnQueue` 完全一致。 |
| 不同 runSeed 下波次多樣 | rules：掃 wave 3..30 至少一波 type 序列不同；e2e：固定 affixSeed 下 `111111` 與 `222222` 第 9 波 type 序列不同。 |
| runSeed 存檔往返穩定 | rules：`migrateMeta` + `protectMetaWrite` 保留 `246813579`；e2e：Base64 存檔 export/import 後 `runSeed` 仍為 `246813579`。 |
| 舊檔安全遷移 | rules：無 version 舊 meta 升到 `META_VERSION = 7` 且 `runSeed === 1`；非法 `runSeed` 回 deterministic 預設。 |
| 純規則段無真隨機/時間/DOM | `npm test` 仍檢查 `rules.js` 無 `Math.random`、`Date.now`、DOM、`localStorage`。 |

## 版本與守門

- 版本同步：`package.json` / `package-lock.json` = `0.5.1`，`sw.js` / `index.html` = `td-r51-v1`，manifest 與 JS refs 皆 `?v=td-r51-v1`。
- repo 沒有 `version.js`；本輪同步現有版本來源。
- live 檔 grep：`td-r49-v1`、`0.4.9` 在 `package*`、`index.html`、`sw.js`、`manifest`、`src`、`scripts`、`README`、`references` 皆 0 matches。
- `npm test`：全綠。
- `npm run test:e2e`：最後版本連續 3 次全綠（1 次完整輸出 + 2 次 clean repeat）。
- headless 檢查：無 Playwright/Chromium headless 殘留行程。

## 與 Grok 建議不同處

- Grok 建議 `hash(runSeed, wave)` 或混 `affixSeed`；本輪採 `hash(runSeed, affixSeed, wave)`，讓同一 run 的詞綴 seed 也納入波表 salt。
- 為了不破壞既有 rules/sim 呼叫，`waveRngSeed(w)` 保持舊 deterministic fallback；遊戲主路徑才傳入 run salt。
- 測試中原本依賴「跨局固定波表」的警告/顧問案例，改用固定 `runSeed/affixSeed` 建立測試敵情，而不是放寬斷言。
