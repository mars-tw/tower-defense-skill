# CODEX_RESPONSE_td_R4

| 項目 | 回應 |
|---|---|
| 版本 | `td-r54-v1` / `0.5.4` |
| 結論 | 採納 Grok R4 的 P0/P1。Boss slow-mo 已改為純表現；粒子補硬上限；reduced 擴大到 burst/ring/傷害浮字/紅暈；WebAudio 改為確認 running 後才 unlocked，並加 master gain、同類音效節流、active voice cap、ended disconnect。 |

## 逐條回應

| Grok 項目 | 決議 | 修正 |
|---|---|---|
| P0 Boss slow-mo 縮放整段 `update(dt)` | 採納 | `update` 不再改寫 logic `dt`；`spawnTimer`、冷卻、敵人位移、`state.clock` 全吃原 dt。新增 `state.fxTimeScale`，只讓粒子 update 用 `fxDt`。 |
| 粒子缺全域硬上限 | 採納 | 新增 `MAX_PARTICLES=220`、`MAX_TEXT_PARTICLES=42`、`MAX_COIN_PARTICLES=8`、`MAX_RING_PARTICLES=14`，所有入口改走 `pushParticle`。 |
| reduced 只關新增特效子集 | 採納 | `burst`、`ring`、`flashText`/傷害浮字、red vignette、Boss slow-mo 全在 reduced 下關閉；切換 reduced 會立即清空既有粒子/紅暈/slow-mo。 |
| WebAudio unlocked 樂觀誤標、節點策略 | 採納 | `audioUnlocked` 只在 `AudioContext.state === "running"` 後為 true；使用 master gain；限制 active SFX 與同類觸發間隔；osc/gain 在 ended 後 disconnect。 |
| `effectSeed` 與波次 RNG | 維持 PASS | 未改波次 seed 路徑；新增 e2e 證明 reduced 開/關同 runSeed 出怪 timeline 完全一致。 |

## 回歸守門

- `scripts/test-td-e2e.js` 新增：
  - Boss slow-mo 下 `clock=0.05`、敵人 `walkDist≈5`，證明 logic dt 未縮放。
  - 同 `runSeed=111111` / `affixSeed=777`，reduced 開/關的 preview queue 與實際 spawn timeline 一致。
  - reduced 下 combat 粒子與紅暈歸零。
  - 粒子壓測後 `particles <= 220` 且 `rings <= 14`。
- 版本字串：舊版 PWA id grep 歸零，已同步 `index.html`、`sw.js`、`package.json`、docs。

## 驗證

- `npm test`：PASS
- `npm run test:e2e` x3：PASS / PASS / PASS
- 版本 grep：舊版 PWA id 與舊 semver 均無殘留
