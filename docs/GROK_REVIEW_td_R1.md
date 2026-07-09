# 《無盡塔防》對抗式審查報告 — Grok R1

| 項目 | 內容 |
|------|------|
| 範圍 | `src/` 全模組：`config.js` / `rules.js` / `game.js` / `heroes.js` / `lore.js` / `ui.js` |
| 版本語境 | 現行 td-r48-v1 級成熟 vanilla JS/Canvas PWA；CI 全綠、含 sim-balance |
| 審查者 | Grok（資深遊戲工程／效能／正確性視角） |
| 日期 | 2026-07-09 |
| 原則 | 只列可驗證、有實質效益的項目；不改任何遊戲程式碼／測試／資源 |

**優先級定義**

| 等級 | 含義 |
|------|------|
| **P0** | 正確性錯誤或會誤導玩家／破壞 meta 分析的缺陷，建議盡快修 |
| **P1** | 明顯效能熱點或架構債務，會在高波／弱裝置／擴充時痛 |
| **P2** | 平衡失真、資料驅動不徹底、可維護性與體驗優化 |

**本報告未當成問題的既有優點（對照用）**

- `rules.js` 純函式 + `migrateMeta` / `protectMetaWrite` 存檔防護完整
- 主迴圈 `loopToken` 防多重 rAF 疊加、`dt` clamp、gameOver 重入保護
- 波次主題 `waveTheme` / 事件 seed 與預告共用來源（事件類型本身可重現）
- 毒穿盾、閃避、護盾再生、餘震停火等設計意圖清楚，且多有註解／測試守門

---

## 1. 正確性／潛在 Bug

### P0

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| C-P0-1 | **`game.js` `createEnemy` / `leak`：敵人實體沒有 `type`，漏怪統計寫入錯誤 key** — `createEnemy` 以 `Object.assign({ ...def, ... })` 展開 `ENEMIES` 條目（僅有 `id`，無 `type`）。`leak()` 卻寫 `waveEntry.byType[e.type]`，執行時 key 為字串 `"undefined"`。`analyzeRunReport` / 結算「本局檢討」依 `byType` 推因時，**永遠無法對上真實敵種**，shield／fast／counter 診斷全失效。 | 在 `createEnemy` 明確設 `type: spec.type`（或統一以 `e.id` 作鍵並全管線改用 `id`）。補 e2e／unit：`leak` 後 `runLeaks.byWave[w].byType.slime` 有值。 | 修一個欄位即可恢復整條「漏怪→學習」閉環；否則 R25 檢討文案是假的。 |
| C-P0-2 | **`game.js` `previewNextWave` vs `startWave`：預告 queue 與實波 queue 使用不同 RNG 源** — 預告：`generateWaveQueue(w, diff, null, affix)` → `makeRng(null, w)` 以波次決定性 LCG。實波：`generateWaveQueue(w, diff, Math.random, affix)` → 真隨機。事件類型靠 `eventWaveSeed(w)` 仍一致，但**敵種組成、chip 數量、顧問推薦所依的 counts 與實際出怪可大幅偏離**。玩家依「下一波情報／建議塔種」建塔會被誤導。 | 開局或 `startWave` 前固定 `waveSeed`（例如 `state.waveSeeds[w]`）；預告與 `startWave` 皆 `makeRng(seed)`。UI 只顯示確定 plan。測試改為「同 seed 預告 queue === 實波 queue」。 | 情報可信度是塔防核心 UX；同時讓 sim／回放／平衡可決定性對齊。 |

### P1

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| C-P1-1 | **`game.js` `acquireTarget`：進度鍵寫死 `e.wp + (1 - 0)`** — 註解稱「越前面越優先」，但同 waypoint 上所有敵人 `prog` 相同，實際退回陣列順序。尾段擠在同一段路徑的殘血敵未必被集火，狙擊／弓箭「打最前」語意失真。 | 進度改 `e.wp - distToWaypoint/segLen`（或累積 `walkDist`／path ratio）。 | 低成本修正塔的目標選擇正確性，減少無意義漏怪。 |
| C-P1-2 | **`game.js` `applyDamage` 回傳值僅計 HP 扣減；`dealDamage` 用 `dealt \|\| dmg` 顯示浮字** — 純護盾吸收時 `dealt === 0`，浮字 fallback 成完整 `dmg`，**顯示打了 X 但其實只削盾**。半破盾時只顯示進血量部分。 | 回傳 `{ hp, shield, total }` 或至少 `totalAbsorbed`；浮字用實際吸收量，可標「盾」。 | 修正傷害回饋可信度；利於除錯平衡。 |
| C-P1-3 | **`game.js` `newGame` 起始金只乘 `mapDef.goldMul`，不乘 `difficulty.goldMul`** — `DIFFICULTIES.brutal/endless` 的 `goldMul` 只進 `waveGoldBonus`，**開局 220 金在嚴酷仍是滿額**。與文案「資源更緊」及 sim-balance（同樣只乘 map）一致地「偏軟」，但難度維度半套用。 | 明確產品決策：(A) `startGold * map.goldMul * diff.goldMul`；或 (B) 文件／UI 寫明「難度金僅影響清波獎」。 | 避免難度體感與數值說明不一致。 |
| C-P1-4 | **`game.js` 毒 DoT：`bypassShield: true` 且不經 `elementMultiplier`／寒冰協同** — 設計上 counterHint 寫「穿盾咬本體」屬意圖；但 **毒傷害不受元素克制、不受易傷？**（易傷有套用：`noVuln` 未設）。元素與 chill×1.25 完全繞過，毒塔對「該吃抗性」的冰／火敵與直傷塔規則不一致。 | 在設計表定案：若要穿盾保留，至少讓 DoT 乘 `elementMultiplier` 與／或易傷（已乘）一致寫進 desc；或 UI 註明「毒素無視元素／護盾」。 | 規則透明，避免玩家與 sim 對「有效 DPS」認知分裂。 |
| C-P1-5 | **`game.js` 分裂蝙蝠：`killEnemy` → `spawnSplitBat` 在 `for...of state.enemies` 中途 `push`** — 子代可能於**同一幀**進入移動／治療掃描；高密度分裂波行為與「死亡後下一 tick 生成」預期略差。 | 改 `pendingSpawns` 佇列，在 filter 後再合併。 | 消除幀序競態，利於決定性測試。 |
| C-P1-6 | **`ui.js` 匯入鍵 `META_IMPORT_KEYS` 未列 `gachaPity` / `lastMap`** — 形狀檢查只要求「任一 key」，不會擋匯入；但文件意圖易誤導維護者以為 pity 不進存檔。實際 `migrateMeta` 會保留 source 的 pity。 | 補進列表與註解，避免日後「白名單過濾」重構時弄丟 pity。 | 防未來 regression（非現況必現 bug）。 |

### P2

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| C-P2-1 | **`heroes.js` / `game.js`：英雄有 `hp`／血條但無受傷來源** — 血量永遠滿，升級才改 maxHp。UI／文案暗示存活壓力，實際為純輸出單位。 | 要麼實作敵對英雄／路徑傷害，要麼隱藏血條並改文案為「無損耗協防單位」。 | 避免半成品系統誤導。 |
| C-P2-2 | **`game.js` 子彈目標死亡：`b.target._dead` 則整發作廢** — 無 splash 的單體彈在目標剛死時浪費；塔 CD 已消耗。 | 可選 retarget（同射程次優）或小範圍 splash 補償。 | 高射速塔體感更公平。 |
| C-P2-3 | **`config.js` `elementMultiplier` 被克 0.66 非精確 2/3** — 微小，但與 1.5 不對偶。 | 改 `2/3` 或 `1/1.5`。 | 數值乾淨、測試期望好寫。 |
| C-P2-4 | **`ui.js` `setTimeout` 任務 toast／waveWarning／gacha** — 頁面卸載或連續開關 overlay 時少數 timer 不 cancel（影響小）。 | 存 timer id，close 時 clear。 | 長時間 PWA 更乾淨。 |

---

## 2. 效能

### P0

（無單一必現的「每幀必炸」級缺陷；下列 P1 在弱手機 + 高波 + 建塔預覽同時出現時會合成明顯掉幀。）

### P1

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| P-P1-1 | **`game.js` `killEnemy` / 多處熱路徑呼叫 `window.__tdUI()`（= `refreshUI`）** — 每次擊殺重建名冊、innerHTML 情報卡、任務列、抽卡文案等 DOM。蟲潮／連殺時每幀可觸發十數次完整 UI 刷新，**主執行緒與 GC 壓力常大於 Canvas 本身**。 | 戰鬥中只更新 HUD 數字（gold/score/wave）；`requestAnimationFrame` 合併 dirty flag；完整 `refreshUI` 限波間／選取變更。 | 高波與 2× 速度最有感的優化；常比減粒子更有效。 |
| P-P1-2 | **`game.js` `drawBackground` 每幀全圖 `drawImage` 草皮磚（約 cols×rows）+ vignette 漸層** — 地圖靜態卻每幀重鋪。 | 開局／換圖時 bake 到 offscreen canvas，每幀一次 `drawImage(cache)`。 | 降固定成本數百次 draw call → 1 次。 |
| P-P1-3 | **`game.js` `drawBuildableCells`：建塔模式下每幀對每格 `canCellReachPath`（內含整段 path 距離）** — O(格數 × path 段數)。顧問預覽失敗時還有全圖掃描落點。 | 選塔時 cache 可建格 bitmask；path／詞綴射程變才重算。 | 手機點塔準備時的卡頓主因之一。 |
| P-P1-4 | **雙 rAF：`startLoop` + 永久 `idleLoop`** — 波間 idle 仍 60fps 全畫面 render（建塔預覽需要，但無操作時仍全速）。 | 波間：僅 mousemove／state dirty 時 render；或 15–30fps 上限。 | 省電、降熱，PWA 行動體驗。 |
| P-P1-5 | **Canvas 狀態成本：`shadowBlur`（塔 Lv、子彈、粒子）、每敵 `save/restore`+ellipse 影、每幀血條 `createLinearGradient`** — 粒子在 Boss／技能時爆發。已有 `performanceLow` 縮粒子，但 **shadowBlur 未隨 low 關閉**。 | low 模式：`shadowBlur=0`、簡化血條單色、限制 particles 上限硬 cap。 | 低階 GPU 上 shadow 往往比 fill 貴一個數量級。 |

### P2

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| P-P2-1 | **`supportBuffFor` / 英雄尋敵 / 女神 smite 每 tick O(n) 或 O(n log n)** — 單位量級現況可接受（數十敵、十數塔）。 | 單位 >80 時再考慮 grid／空間雜湊；現階段不優先。 | 預留後期無限波。 |
| P-P2-2 | **`removeBg` 用 `getImageData` 同步去背** — 僅載入時一次，可接受；大量新圖時首幀卡。 | 預先產透明 PNG 或 worker。 | 擴圖集時再做。 |
| P-P2-3 | **無 deepClone 熱路徑** — 狀態多為就地 mutate，這點良好。勿在 `refreshUI` 引入 `JSON.parse(JSON.stringify(state))`。 | 維持現狀。 | — |

---

## 3. 架構可維護性

### P1

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| A-P1-1 | **`game.js` ~1760 行「上帝模組」** — 狀態、波次、戰鬥、英雄 AI、技能、建塔、粒子、輸入、渲染、效能監控、對外 `TD` API 全捆一 IIFE。單一檔變更衝突率高，單元測試只能經 e2e／debug hook。 | 按邊界拆：`combat.js`（applyDamage/hit/fire）、`wave.js`、`render/*`、`input.js`，`game.js` 只組裝；純邏輯能進 `rules.js` 的繼續下沉（目標選擇、漏怪統計結構）。 | 降 PR 衝突與回歸面；新塔／新能力不必讀完整引擎。 |
| A-P1-2 | **`ui.js` ~1760 行對等肥大** — meta、抽卡動畫、圖鑑、設定、顧問卡、鍵盤、結算全在一起。 | 拆 `ui-meta.js` / `ui-overlays.js` / `ui-hud.js`；或至少把 save／gacha／codex 分檔。 | 與 game 對等，便於平行開發。 |
| A-P1-3 | **資料驅動不徹底：行為仍散落 switch／hardcode** — 新敵能力要在 `updateEnemyAbilities`、`dealDamage`、`spawnSplitBat`、`pickDefaultEnemy`、advisor `towerReason` 多處加碼；新塔特殊（毒、易傷、支援）靠 `if (def.poisonDps)` 欄位探測，尚可，但 **pierce 距離 60、寒冰協同 1.25、連殺公式** 寫死在引擎。 | 能力用 `ability.id` → handler map；塔 onHit 效果陣列（`effects: [{type:'slow',...}]`）；常數進 `config.GAME` 或 `TOWERS.*`。 | 加塔／敵／技能接近「只改 config + 一張圖」。 |

### P2

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| A-P2-1 | **全域 `window` 注入 + CommonJS 雙出口** — 對無 bundler PWA 合理，但符號污染、載入順序脆弱（`ui` 依賴 `TD` 已 bootstrap）。 | 維持亦可；若有 build 步驟再改 ES module。 | 現況可接受。 |
| A-P2-2 | **英雄雙資產模型**（`sprites` 四向 vs 單張 `sprite`）— `drawHero` 分支已處理，但新英雄要記得填對欄位。 | 統一 schema：`spriteMode: 'sheet4' \| 'single'`。 | 降接圖錯誤。 |
| A-P2-3 | **`lore.js` 純淨良好** — 無 DOM／隨機；擴章節成本低。 | 維持；解鎖條件已資料化。 | 典範層。 |
| A-P2-4 | **地圖擴充** — path 像素座標手刻 + `markPathCells` 啟發式封鎖，新地圖需試錯「可建格是否貼路」。 | 小工具：path → blocked preview；或格子地圖編輯器匯出。 | 降地圖製作成本。 |
| A-P2-5 | **顧問／推薦演算法在 `rules.js` 已可測** — 優點；但 `buildCandidateForTower` 全格掃描在 Node 與瀏覽器各跑一份邏輯，與 `buildPreviewAt` 規則需保持同步（已有 advisor 失敗時 fallback 全圖搜）。 | 單一「合法建塔格」純函式供 game/UI/rules 共用。 | 避免顧問點位與真實建造規則漂移。 |

**擴充成本速查**

| 擴充物 | 現況成本 | 瓶頸 |
|--------|----------|------|
| 新塔（純數值+既有效果欄位） | 低 | `config.TOWERS` + 圖 + hotkey |
| 新塔（新機制） | 中高 | `fire`/`hit`/`towerStat`/`ui` meta 文案 |
| 新敵（既有 ability id） | 低～中 | `ENEMIES` + `pickDefaultEnemy` 權重 + 解鎖波 |
| 新 ability | 高 | game 能力更新 + 顧問推理 + sim-balance |
| 新英雄 | 中 | `HEROES` + 圖 + lore stages |
| 新地圖 | 中 | 手調 path、blocked、goldMul |
| 新難度 | 低 | `DIFFICULTIES` |

---

## 4. 玩法／平衡（工程可驗證）

### P1

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| B-P1-1 | **毒霧塔升級不放大 `poisonDps`** — `fire()` 把 `def.poisonDps` 原樣掛彈；`towerStat` 只放縮 `damage`/`range`/`buff`。Lv1→Lv5 直擊 DPS 約 8→41，**毒層上限 DPS 固定 18**。sim-balance 的 `towerDPS` 同樣未乘等級於 DoT，CP 曲線低估「升級毒塔」的真實動機問題。 | `poisonDps *= damageMul^(lv-1)` 或獨立 `poisonMul`；UI 顯示升級後毒傷；sim 同步。 | 毒塔中後期不至於變成「只升直傷的劣質弓」；與「磨盾／磨 Boss」定位對齊。 |
| B-P1-2 | **`pickDefaultEnemy` 權重使 `orc` 後期僅約 1%** — 新增大量特化敵後，原始高血慢坦（orc）幾乎不下場；血量曲線與「高血」教學（counterHint、顧問 highHp）部分架空。 | 重配權重表（資料驅動 weight 表）或波段保底 1 坦。 | 陣容多樣性與顧問「高血」分支有意義。 |
| B-P1-3 | **狙擊塔定位弱於文案** — `sniper` range 140 vs arrow 130（+7.7%），DPS≈31.9 vs arrow 20、造價 145 vs 50。單發高但射程「長管」名不副實；對高速敵無特殊（無 stun／優先 boss）。 | 射程 180–220 或 `preferBoss`／對盾加傷；或降價。用 sim 看同金 DPS 覆蓋。 | 8 種塔各有生態位，避免 sniper 永久冷板凳。 |
| B-P1-4 | **事件「裂界波」`rift` 無 `forceType`／無特殊敵池** — 僅 hp/speed/gold 微調，與文案「裂界妖魔混入」不符；玩家難感知差異。 | force 池（abysshound/frostwraith 等）或 countMul。 | 事件波辨識度。 |

### P2

| # | 檔案:問題 | 建議 | 效益 |
|---|-----------|------|------|
| B-P2-1 | **連殺金 `comboMul` 上限 +100%** — 清小兵可顯著抬經濟，加速雪球；與指數波獎疊加。 | 納入 sim 經濟曲線；必要時 cap 降至 +50% 或排除 split 子代。 | 防無限波前期崩盤或過肥。 |
| B-P2-2 | **賣塔 `0.6 * cost * level`** — 非依累計投資比例，高等級略懲罰（通常可接受）。 | 改 50–60% 累計造價。 | 重佈陣更公平。 |
| B-P2-3 | **女神 smite 固定 25 傷、不吃難度／詞綴／元素** — 後期裝飾性高。 | 隨 level 成長或吃 towerDamageMul。 | 女神升級路線更有感。 |
| B-P2-4 | **英雄永久羈絆 cap +15% 攻血** — 長線合理；傳說英雄底座已很高，疊加後與塔的定位可能搶戲。 | 用 sim 或 telemetrics 看「有無傳說」波次分位差。 | 控制 pay-for-power 體感（此處為抽卡）。 |
| B-P2-5 | **預告不可信（見 C-P0-2）直接傷害平衡體驗** — 玩家依錯誤組成選塔，體感「推薦不準」會歸因平衡而非 bug。 | 先修決定性 seed。 | 平衡調參才有穩定樣本。 |

---

## 5. 建議修復順序（工程價值排序）

1. **C-P0-2** 波次 seed 統一（預告 = 實波）  
2. **C-P0-1** 敵人 `type` 欄位／漏怪 byType  
3. **P-P1-1** 戰鬥中 `__tdUI` 節流  
4. **B-P1-1** 毒 DoT 隨等級（+ sim 同步）  
5. **P-P1-2 + P-P1-3** 背景 bake + 可建格 cache  
6. **C-P1-1** acquireTarget 真實進度  
7. **A-P1-1** game.js 拆分（可與功能 PR 交錯）  
8. **B-P1-2 / B-P1-3** 權重表與狙擊定位  

---

## 6. 風險與測試缺口（審查附註）

| 缺口 | 說明 |
|------|------|
| 預告 vs 實波 | e2e 只驗證主題偏壓與事件，**未 assert queue 一致** |
| 漏怪 byType | 無測試覆蓋 `e.type`；分析函式有測但餵的是正確 shape |
| 毒升級 | sim 與 runtime 一致地「忘了」等級放大 DoT |
| 英雄血量 | 無受傷測試（功能本身缺失） |
| 效能 | 無 FPS 基準測試；`perf_mode` 僅行為開關 |

---

## 7. 總結

《無盡塔防》在 **規則純函式化、存檔遷移、迴圈重入、主題／事件 seed、CI 守門** 上已是成熟專案水位。本輪對抗式審查的最大實質債不是「再砍一次 O(n²)」，而是：

1. **情報系統與實波 RNG 分叉**（玩家信任問題）  
2. **漏怪 meta 鍵名錯誤**（學習／檢討閉環斷裂）  
3. **擊殺觸發全量 DOM 刷新**（真效能熱點）  
4. **毒塔升級與狙擊／獸人權重** 等可算的平衡失真  
5. **game.js / ui.js 雙巨石** 限制後續資料驅動擴充  

以上皆可在不重寫引擎的前提下以小 PR 推進；建議優先 P0 兩項，再動 UI 節流與毒升級，效益／風險比最高。

---

*本文件為靜態審查產出，未修改任何 `src/`、`scripts/`、`assets/` 檔案。*
