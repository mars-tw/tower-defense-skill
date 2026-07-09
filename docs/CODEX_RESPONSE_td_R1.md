# Codex Response td R1

| 項目 | 結論 |
|------|------|
| 複審日期 | 2026-07-09 |
| 入版版本 | `td-r49-v1` |
| 核心處理 | 採納 P0 兩項；採納毒 DoT 成長、戰鬥 UI 節流、背景 bake、可建格 cache；補數個低風險正確性修補 |
| 平衡結論 | 統一波次 seed 與毒 DoT 成長後，`sim-balance` 仍過守門；未放寬門檻，未修改 frozen baseline |

## 結論摘要

- **採納並已修**：C-P0-1、C-P0-2、C-P1-1、C-P1-2、C-P1-6、P-P1-1、P-P1-2、P-P1-3、B-P1-1、B-P2-5。
- **部分採納／本輪不改設計**：C-P1-4、A-P2-5。
- **延後**：C-P1-3、C-P1-5、C-P2-1、C-P2-2、C-P2-3、C-P2-4、P-P1-4、P-P1-5、P-P2-1、P-P2-2、A-P1-1、A-P1-2、A-P1-3、A-P2-2、A-P2-4、B-P1-2、B-P1-3、B-P1-4、B-P2-1、B-P2-2、B-P2-3、B-P2-4。
- **維持現狀**：P-P2-3、A-P2-1、A-P2-3。

## 正確性

| 編號 | 結論 | 回應與處理 |
|------|------|------------|
| C-P0-1 | 採納 | `createEnemy` 已寫入真實 `type`，`leak` 統計也加入安全 fallback，避免 `byType.undefined`。補 e2e 驗證漏怪後 `byType.slime === 1`。 |
| C-P0-2 | 採納 | 新增同波固定 seed 與共用 `wavePlanFor`。`previewNextWave` 與 `startWave` 現在使用同一份 deterministic queue，`rules.js` 以注入 seed/rng 維持純函式。補 rules 測試與 e2e 驗證預告 queue 完全等於實波 queue。 |
| C-P1-1 | 採納 | `acquireTarget` 的進度鍵改為依 waypoint 段內距離計算，避免同段敵人全同分而退回陣列順序。 |
| C-P1-2 | 採納 | `applyDamage` 回傳實際吸收總量，浮字不再把純削盾誤顯為完整 HP 傷害。 |
| C-P1-3 | 延後 | 目前產品規則與 sim 都把難度金錢倍率套在清波收益，不套開局金。直接改會重寫難度經濟曲線；本輪只處理 bug 與低風險修補。 |
| C-P1-4 | 部分採納 | 毒穿盾維持設計意圖；本輪採納「規則需一致可測」的部分，將毒 DoT 等級成長下沉到 rules/runtime/sim/UI。元素乘區是否套入 DoT 牽涉毒塔定位，延後成獨立平衡案。 |
| C-P1-5 | 延後 | 分裂蝙蝠 pending queue 屬幀序語意調整，需額外回放與高密度波測試。本輪不混入 P0 seed 修補。 |
| C-P1-6 | 採納 | `META_IMPORT_KEYS` 補 `gachaPity` 與 `lastMap`，降低未來白名單重構誤刪存檔欄位的風險。 |
| C-P2-1 | 延後 | 英雄血量目前是 UI/成長表現，不是敵方可攻擊系統。本輪不新增敵我交戰規則。 |
| C-P2-2 | 延後 | 子彈 retarget 會改變塔 DPS 體感與高攻速塔價值，需要獨立 sim 驗證。 |
| C-P2-3 | 延後 | `0.66` 屬既有平衡常數，改為精確倒數會造成微調；本輪未動。 |
| C-P2-4 | 延後 | timer 清理是長時間 PWA 整潔性議題，非本輪核心 bug。 |

## 效能

| 編號 | 結論 | 回應與處理 |
|------|------|------------|
| P-P1-1 | 採納 | 新增 `notifyUI` dirty 合併。戰鬥進行中透過 `requestAnimationFrame` 合併 `__tdUI`，波間與強制刷新仍立即更新。 |
| P-P1-2 | 採納 | 背景草皮與 vignette bake 到 offscreen canvas；每幀改為畫 cached background。圖片未完成載入時仍有 fallback。 |
| P-P1-3 | 採納 | 新增可建格 reach cache，建塔預覽與全圖掃描共用快取結果，避免每幀每格重算 path 距離。 |
| P-P1-4 | 延後 | idle loop 降頻會影響波間預覽、粒子與焦點回饋節奏；需要視覺驗證後獨立處理。 |
| P-P1-5 | 延後 | low-mode shadow/血條簡化屬渲染品質策略，需與設定 UI 和截圖回歸一起做。 |
| P-P2-1 | 延後 | 目前敵人/塔數量級未達必須空間雜湊；保留為無限波擴充項。 |
| P-P2-2 | 延後 | `removeBg` 仍是載入期一次性成本，本輪未新增圖集。 |
| P-P2-3 | 維持 | 同意不要把 deep clone 引入 UI 熱路徑；本輪維持現狀。 |

## 架構

| 編號 | 結論 | 回應與處理 |
|------|------|------------|
| A-P1-1 | 延後 | `game.js` 拆分是合理方向，但不是本輪總稽核要求的 bug 修。為降低風險，本輪只在原邊界內補 helper。 |
| A-P1-2 | 延後 | `ui.js` 拆分同上；本輪僅做最小欄位與顯示同步。 |
| A-P1-3 | 延後 | ability/effects handler map 會改多個行為入口，需獨立架構 PR 與更完整測試。 |
| A-P2-1 | 維持 | 無 bundler PWA 下維持全域注入 + CommonJS 雙出口。 |
| A-P2-2 | 延後 | 英雄資產 schema 統一不是本輪 bug。 |
| A-P2-3 | 維持 | `lore.js` 純資料/純函式邊界良好，本輪未動。 |
| A-P2-4 | 延後 | 地圖工具化屬製作流程改善，不混入 runtime 修補。 |
| A-P2-5 | 部分採納 | 尚未抽成單一純函式，但 runtime 已導入 buildable reach cache，降低顧問預覽 fallback 與建塔預覽重算成本。 |

## 玩法與平衡

| 編號 | 結論 | 回應與處理 |
|------|------|------------|
| B-P1-1 | 採納 | 新增 `UPGRADE.poisonDpsMul = 1.32`，並同步 rules、runtime `towerStat`/彈體、UI 顯示與 sim-balance。Lv1 毒 DPS 維持 6，Lv4 約 13.8，低於直擊成長以避免毒塔過度取代單點塔。 |
| B-P1-2 | 延後 | 未修改 `pickDefaultEnemy` 或 frozen `oldPickDefaultEnemy`。敵種權重重配會改整體波次曲線，需另開平衡案。 |
| B-P1-3 | 延後 | 狙擊塔定位牽涉造價、射程、優先目標與 boss 對策，本輪未調。 |
| B-P1-4 | 延後 | 裂界波 flavor 可改善，但 force pool/countMul 會改波次壓力，不混入 seed 修補。 |
| B-P2-1 | 延後 | 連殺金經濟曲線需長程 sim；本輪未動。 |
| B-P2-2 | 延後 | 賣塔公式屬重佈陣策略調整，非 bug。 |
| B-P2-3 | 延後 | 女神 smite 成長需與英雄/技能價值一起評估。 |
| B-P2-4 | 延後 | 傳說英雄長線差距需要 telemetry 或專門 sim；本輪不調。 |
| B-P2-5 | 採納 | 與 C-P0-2 同修：預告與實波 queue 一致，平衡樣本與玩家決策回到同一基準。 |

## 本次修補清單

- `rules.js`：新增 `waveRngSeed`、seed/rng 決定性注入、`towerPoisonDpsFor`；維持無 DOM、無 Date、無 Math.random。
- `game.js`：統一預告/實波 wave plan；補 enemy `type`；修漏怪 byType；修目標進度；修盾傷害浮字；毒 DoT 隨等級；戰鬥 UI 節流；背景 bake；建塔 reach cache。
- `ui.js`：毒塔面板顯示升級後毒 DPS；補匯入 key。
- `config.js` / `sim-balance.js`：加入並使用 `poisonDpsMul`。
- 測試：補預告=實波、漏怪 byType、毒 DoT 等級成長、rules seed 決定性與 config 守門。
- 版本：`index.html`、`sw.js`、`package.json` 已同步到 `td-r49-v1` / `0.4.9`。

## 平衡回歸

- 波次 seed 統一後，實戰 queue 改為使用預告同源 deterministic plan；情報、顧問、sim/debug 樣本可對齊。
- 毒 DoT 採獨立成長倍率 `1.32`，刻意低於直擊 `damageMul`，讓升級毒塔有後期價值但不吃掉弓箭/狙擊/聖光的定位。
- `sim-balance` 結果維持通過，無需調整 CP 門檻或存活門檻；本輪未改 `oldPickDefaultEnemy` 等 frozen baseline。

## 驗證

- `npm test`：通過，含 config/heroes/rules/board/sim-balance/lore。
- `npm run test:e2e`：修補後連續三輪通過，含桌面、平板、手機與 R45 矮視窗。
- 版本字串：app/test/package 範圍掃描無上一版 PWA 字串殘留；歷史審查文件保留原始版本語境。

## 與 Grok 不同之處

- Grok 將毒元素乘區列為規則不一致；本輪只採納 DoT 成長與顯示/sim 對齊，毒穿盾與不吃元素克制暫視為塔種特色，需另開設計決策。
- Grok 建議難度金可套開局金；本輪判定這是產品經濟規則，不是當前 bug，避免把 seed 修補與難度曲線重寫混在一起。
- Grok 建議拆 `game.js`/`ui.js`；本輪認同方向但不做架構大拆，保持入版風險小且守門可驗。
