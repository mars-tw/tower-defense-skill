# 《無盡塔防》對抗式覆核報告 — Grok R2（R1 修正驗收）

| 項目 | 內容 |
|------|------|
| 範圍 | 針對 r49（`td-r49-v1`）宣稱之 R1 修正：波次統一種子、敵人 `type` 解析、`poisonDpsMul` |
| 對照 | `docs/GROK_REVIEW_td_R1.md`、`docs/CODEX_RESPONSE_td_R1.md` |
| 審查者 | Grok（資深遊戲系統稽核／對抗性視角） |
| 日期 | 2026-07-09 |
| 原則 | **只審不改**；務實讀 `src/` 真實程式；結論附檔案:行號與最小重現；不動其他檔 |

**結論標籤**

| 標籤 | 含義 |
|------|------|
| **成立** | 宣稱已落地，主路徑可驗證正確 |
| **未修好** | R1 宣稱目標仍失敗或半套 |
| **新 bug／殘留** | 修補後仍在、或修補路徑新引入的可驗證問題 |
| **用語校正** | 需求敘述與實際實作不一致（非必為程式錯） |

**優先級**

| 等級 | 含義 |
|------|------|
| **P0** | 正確性錯誤／會誤導玩家情報或破壞 meta 學習閉環 |
| **P1** | 明顯殘留、決定性／平衡副作用、跨層不一致 |
| **P2** | 邊角、防禦性缺口、文件／用語、低風險 debt |

---

## 0. 總評（先講人話）

| R1 宣稱 | 覆核結論 | 等級 |
|---------|----------|------|
| 預告計畫與實際出怪同決定性種子 | **成立**（queue 組成路徑已統一，無 `Math.random` 洩漏） | — |
| 敵人 `type` 欄位解析，避免 `undefined` 屬性 | **成立**（主生成路徑 + leak fallback + e2e 守門） | — |
| 毒 DoT「隨波次」縮放（`poisonDpsMul`） | **用語校正 + 實作成立為「隨塔等級」**；非波次縮放 | — |
| 有無新引入決定性／平衡／存檔問題 | **有殘留／副作用**（見 §4），但無存檔破壞 | P1～P2 |

**一句話**：R1 兩項 P0（情報不可信、漏怪 byType 失效）**確實修到**；毒 DoT 也確實會隨升級成長。對抗性覆核下，最大「新債」是：為了預告=實波，把波次敵種組成做成**跨局永久固定**（缺 run-level salt），重玩多樣性被吃掉——這是修法選擇的副作用，不是預告又漂了。

---

## 1. 波次種子：預覽是否真的 = 實際？

### 1.1 資料流（現行）

```
previewNextWave()
  w = state.wave + 1
  seed = waveSeedFor(w)          // 快取於 state.waveSeeds[w]
  plan = wavePlanFor(w)          // generateWaveQueue(w, diff, seed, affix)

startWave()
  state.wave++
  w = state.wave                 // 等同先前 preview 的 w
  plan = wavePlanFor(w)          // 同一 seed、同一 diff、同一 affix
  state.spawnQueue = plan.queue
  spawnEnemy(spec) ← createEnemy(spec)  // 消費 queue，不再重抽種
```

關鍵程式：

| 步驟 | 位置 |
|------|------|
| 種子快取 | `src/game.js:285-292` `waveSeedFor` |
| 共用 plan | `src/game.js:294-296` `wavePlanFor` |
| 預告 | `src/game.js:297-313` `previewNextWave` |
| 實波 | `src/game.js:317-345` `startWave` |
| 純函式生成 | `src/rules.js:371-374` `waveRngSeed`、`383-391` `makeRng`、`423-458` `generateWaveQueue` |
| 事件波 unit seed | `src/rules.js:367-369` `eventWaveSeed` + `src/config.js:258-265` `getEventWave` |

### 1.2 結論：**成立**

| 檢查項 | 結果 | 證據 |
|--------|------|------|
| 預告與實波是否同一入口 | 是 | 兩者皆 `wavePlanFor` → `generateWaveQueue(..., waveSeedFor(w), state.affix)` |
| seed 是否決定性 | 是 | `waveRngSeed(w) = ((w * 1664525 + 1013904223) >>> 0) \|\| 1`（`rules.js:371-374`） |
| `makeRng` 是否接受數值 seed | 是 | 有限數 → LCG；`seed===0` 強制改 1（`rules.js:385-386`） |
| `generateWaveQueue` 內是否有 `Math.random` | 無 | `scripts/test-rules.js` 守門「rules.js 內沒有 Math.random」；Node 覆寫 `Math.random` 計數 = 0 |
| 事件類型是否與 queue 同源可重現 | 是 | 事件用 `eventWaveSeed(w)`（波次決定性），**不**走 `Math.random`；`getEventWave` 僅在 `rng == null` 才 fallback 真隨機（`config.js:263`），而 `generateWaveQueue` 永遠傳 `eventWaveSeed(w)`（`rules.js:430`） |
| 主題偏壓 | 是 | `waveTheme(w)` + `themeEnemyPool` 純函式（`config.js:270-277`） |
| 測試守門 | 有 | rules：同 seed queue 可重現、`null` seed ≡ `waveRngSeed(w)`（`test-rules.js:320-328`）；e2e：預告 queue ≡ 實波 queue，且刻意 stub `Math.random=0.1` 仍一致（`test-td-e2e.js:1136-1155`） |

**最小重現（Node，不需瀏覽器）**

```js
const cfg = require("./src/config.js");
const { generateWaveQueue, waveRngSeed } = require("./src/rules.js");
const w = 9, seed = waveRngSeed(w);
const a = generateWaveQueue(w, cfg.DIFFICULTIES.normal, seed, null);
const b = generateWaveQueue(w, cfg.DIFFICULTIES.normal, seed, null);
// JSON.stringify(a.queue) === JSON.stringify(b.queue)  → true
// 覆寫 Math.random 再呼叫一次仍相同 → 無洩漏
```

**最小重現（瀏覽器／e2e 語意）**

1. `newGame` 後建塔，`state.wave = 8`。
2. `const p = previewNextWave()`。
3. stub `Math.random = () => 0.1`，呼叫 `startWave()`。
4. assert `state.spawnQueue.map(s => s.type)` 與 `p.queue.map(s => s.type)` 全等。

### 1.3 殘留／副作用（非「預告又漂了」，但是修法代價）

#### R2-S1 — **跨局波次組成永久固定（缺 run-level salt）** — P1 平衡／內容多樣性

| 項目 | 內容 |
|------|------|
| 結論 | **新副作用（修 C-P0-2 引入）** |
| 位置 | `game.js:289-290`：`state.waveSeeds[key] = TDRules.waveRngSeed(w)`；種子**只**是波次的純函式，**未**混入 `affixSeed`／開局 run seed |
| 行為 | 同一難度下，第 N 波敵種序列在**每一局、每一位玩家、每一次重開**都相同。詞綴只改 `hpScale`／`affix` 欄位與戰鬥乘區，**不改 type 抽選**（`generateWaveQueue` 內 affix 僅乘 `enemyHpMul`，`rules.js:439-456`） |
| 驗證 | Node：`generateWaveQueue(12, normal, waveRngSeed(12))` 兩次 JSON 全等；組成固定為同一串 type |
| 對玩家 | 預告可信 ✔；「再來一局換口味」✖（事件種類也因 `eventWaveSeed(w)` 按波次鎖死，本來就固定） |
| 建議（僅記錄，本輪不改） | `waveSeed = hash(runSeed, w)` 或 `waveSeedFor` 混 `state.affixSeed`；開局寫死 `runSeed`，預告/實波仍共用 |
| 最小重現 | 連續 `newGame` 兩次，normal，清到第 8 波（事件 rush 波），比對 queue type 序列 → 應完全相同 |

#### R2-S2 — **戰鬥結果仍非決定性（scope 外，但易誤判為 seed 沒修好）** — P2

| 項目 | 內容 |
|------|------|
| 結論 | **殘留（非 R1 宣稱範圍失敗）** |
| 位置 | `createEnemy`：`animSeed` / `_dodgeRoll` / `uid` 仍用 `Math.random`（`game.js:407-410`） |
| 說明 | **出怪名單**決定性；**閃避骰、動畫相位、uid** 仍真隨機。哥布林 `dodgeFirst` 同 queue 下仍可能不同命中結果 |
| 最小重現 | 固定 queue 生成兩隻 goblin，比較 `_dodgeRoll` → 幾乎必不同 |

#### R2-S3 — **`getEventWave` 仍保留 `Math.random` fallback** — P2 防禦性

| 項目 | 內容 |
|------|------|
| 結論 | **殘留 API 面**；現行 `generateWaveQueue` 主路徑**不會**踩到 |
| 位置 | `config.js:263`：`const r = rng == null ? Math.random() : rng` |
| 說明 | 外部若直接 `getEventWave(w, false)` 不傳 rng，事件類型仍真隨機。波次系統本身有傳 `eventWaveSeed` |
| 最小重現 | 瀏覽器 console：`getEventWave(8, false)` 連打多次可能換事件；`getEventWave(8, false, 0.1)` 固定 |

#### R2-S4 — **`waveSeeds` 快取對現行公式是冗餘的** — P2 可維護性

| 項目 | 內容 |
|------|------|
| 結論 | **無功能 bug**；快取值 ≡ 每次重算 `waveRngSeed(w)` |
| 位置 | `game.js:285-292` |
| 說明 | 若未來要「同波可改 seed（例如重 roll）」，快取會變成真相來源；現行則只是多一層 state。`newGame` 會清空（`game.js:239`），無存檔殘留問題（本專案本來就不序列化局內 `state`） |

### 1.4 本節總結

| 宣稱 | 結論 |
|------|------|
| 預覽 queue = 實際 spawn queue | **成立** |
| 波次生成路徑無 Math.random 洩漏 | **成立**（rules 純；config 事件 fallback 不在主路徑） |
| 跨局仍有波次組成隨機性 | **不成立／被修掉**（R2-S1） |

---

## 2. 敵人 `type` 解析：是否所有生成路徑都覆蓋？

### 2.1 生成路徑盤點

| 路徑 | 位置 | 是否經 `createEnemy` | type 來源 |
|------|------|----------------------|-----------|
| 波次 spawn | `game.js:385-388, 572` `spawnEnemy` ← `spawnQueue.shift()` | 是 | `spec.type`（plan 產出） |
| 分裂蝙蝠 | `game.js:859-879` `spawnSplitBat` | 是 | 硬編碼 `{ type: "bat", ... }` |
| debug | `game.js:1901-1904` | 是 | 呼叫端 `type` 參數 |
| 英雄／塔 | — | 否（非敵人） | — |

**沒有**第二套「直接 `enemies.push({...})` 卻忘了 type」的生產路徑（分裂也走 `createEnemy`）。

### 2.2 `createEnemy` 解析邏輯 — **成立**

```text
game.js:391-411
  spec 字串 → { type: spec, hpScale: 1 }
  type = ENEMIES[spec.type] ? spec.type : "slime"
  def  = ENEMIES[type]
  Object.assign({ ...def, type, ...runtime fields }, overrides)
```

| 檢查項 | 結果 |
|--------|------|
| 合法 type | 寫入 `e.type === spec.type`，且 `...def` 帶 `id` |
| 非法／undefined type | fallback `"slime"`，**不會**留下 `e.type === undefined` |
| 與 R1 C-P0-1 根因 | 舊碼只 spread `def`（有 `id` 無 `type`）；現碼顯式寫 `type` — **已修** |
| 漏怪統計 | `leak`：`ENEMIES[e.type] ? e.type : (ENEMIES[e.id] ? e.id : "slime")`（`game.js:709-710`）雙重保險 |
| 測試 | e2e：`leakEnemyType === "slime" && byType.slime === 1 && !"undefined" in byType`（`test-td-e2e.js:877-878`） |

**最小重現**

```js
// 概念等價 createEnemy 解析
const type = ENEMIES[undefined] ? undefined : "slime"; // → "slime"
// leak 後 byType 應為 { slime: 1 }，不得出現 key "undefined"
```

### 2.3 殘留邊角

#### R2-T1 — **`overrides` 可在 `Object.assign` 後覆寫掉已驗證的 `type`** — P2（debug／誤用）

| 項目 | 內容 |
|------|------|
| 位置 | `game.js:401-411`：先設 `type`，再 `Object.assign(..., overrides)` |
| 行為 | `createEnemy({ type: "orc" }, { type: undefined })` → 實體 `type` 變 `undefined`，但 `id` 仍為 `"orc"` |
| 影響 | 生產路徑 overrides 不傳 `type`；僅 debug 若亂塞會踩到。`leak` fallback 仍可靠 `e.id` 救回 `"orc"` |
| 最小重現 | debug `spawnEnemy`/`createEnemy` 傳 overrides `{ type: undefined }`，看 `e.type` |

#### R2-T2 — **plan 層不驗證 `forceType`** — P2 資料契約

| 項目 | 內容 |
|------|------|
| 位置 | `rules.js:444-445`：`type = event.forceType` 無 `ENEMIES` 檢查 |
| 現況 | 唯一 `forceType` 為 swarm → `"bat"`（`config.js:249`），合法；掃描 w=1..60 × 三難度 **0** 個非法 type |
| 風險 | 未來配錯 `forceType: "bats"` 時：queue/預告 counts 出現非法鍵；實體育成 slime（createEnemy fallback），**預告 chip 與實怪名可能不一致** |
| 最小重現 | （需改 config 才現）設 `forceType: "nope"` 後 preview 的 type 字串與場上 slime 不一致 |

#### R2-T3 — **分裂子代 `type: "bat"` 正確，但 `name` 改成「小蝙蝠」** — 非 bug

| 項目 | 內容 |
|------|------|
| 說明 | `byType` 會算進 `bat`，與母體焰蝠／蝙蝠群同一 key。屬產品選擇，不是 undefined |

### 2.4 本節總結

| 宣稱 | 結論 |
|------|------|
| 主路徑不再出現 `e.type === undefined` | **成立** |
| 所有生成路徑覆蓋 | **成立**（波次／分裂／debug 皆經 createEnemy） |
| 絕對無法 undefined | **未達絕對**（R2-T1 overrides 可覆寫）；生產路徑安全 |

---

## 3. 毒 DoT 縮放（`poisonDpsMul`）

### 3.1 用語校正（重要）

| 來源 | 說法 |
|------|------|
| 本任務口述 | 「毒 DoT **隨波次**縮放（poisonDpsMul）」 |
| R1 原文 B-P1-1 | 毒霧塔**升級不放大** `poisonDps` → 應隨**等級**成長 |
| Codex R1 回應 | `UPGRADE.poisonDpsMul = 1.32`，Lv 成長低於直擊 `damageMul` |
| **實際程式** | **隨塔 `level` 指數成長**；**不**隨 `state.wave` 成長 |

敵人血量另有 `baseWaveHpScale`／難度／詞綴／事件 `hpMul`（`rules.js:361-365, 429-440`）。毒 DPS 不跟波次走 → 後期若不升級毒塔，DoT 相對血量會變弱（合理的升級動機，不是漏做「波次倍率」）。

### 3.2 實作鏈 — **成立（等級縮放）**

| 層 | 位置 | 公式 |
|----|------|------|
| 常數 | `config.js:52` | `poisonDpsMul: 1.32`（`< damageMul 1.5`） |
| rules 純函式 | `rules.js:584-591` `towerPoisonDpsFor` | `poisonDps * poisonMul^(lv-1) * affix.towerDamageMul`；`lv = max(1, floor(level))` |
| runtime | `game.js:907` `towerStat(..., "poisonDps")` | 同上精神；**未** clamp level |
| 掛彈 | `game.js:965-972` `fire` | `poison: { dps: poisonDps, duration, maxStacks }` 用升級後 dps |
| 上毒 | `game.js:458-469` `applyPoison` | 寫入 stack.dps |
| tick | `game.js:472-490` | 疊加 dps；Boss ×0.5；`bypassShield: true` |
| UI | `ui.js:1038-1039` | 顯示 `towerStat` 後毒 DPS |
| sim | `sim-balance.js:86-88` | DoT 乘 `poisonDpsMul^(level-1)` |

**數值抽樣（無 affix，base 6）**

| Lv | 單層 DPS | 滿 3 層 |
|----|----------|---------|
| 1 | 6.00 | 18.00 |
| 4 | 13.80 | 41.40 |
| 10 | 73.00 | 219.00 |

Lv1→Lv4 約 ×2.3；直擊同跨度 `1.5^3 = 3.375` — 符合「獨立且較慢成長」設計。

### 3.3 溢位／負值／異常

| 風險 | 結論 | 說明 |
|------|------|------|
| 數值溢位（Infinity） | **不成立** | Lv10 滿層 ~219 DPS；float64 安全。無 `exp` 爆炸路徑 |
| 負 DPS | **正常資料下不成立** | `poisonDps>0`、`poisonDpsMul>1`；詞綴 `towerDamageMul` 皆 ≥1（`config.js:143-183`） |
| `applyPoison` 拒收 | 有守門 | `!(poison.dps > 0)` 直接 return（`game.js:459`） |
| NaN | **邊角可能**（見 R2-P1） | runtime `tw.level` 若 `undefined`：`Math.pow(1.32, NaN)` → NaN |

### 3.4 殘留

#### R2-P1 — **`towerStat` 未 clamp level，與 `towerPoisonDpsFor` 不一致** — P2

| 項目 | 內容 |
|------|------|
| 位置 | `game.js:907` vs `rules.js:590` |
| 行為 | rules：`level` 缺省／0 → 當 1；game：`level===undefined` → NaN；`level===0` → `6/1.32 ≈ 4.55` |
| 生產路徑 | `tryBuildTower` 固定 `level: 1`（`game.js:1079`），升級 `tw.level++` 有 `maxLevel` 上限（`game.js:1088-1093`）→ **正常遊玩不踩** |
| 最小重現 | `towerStat({ type:"poison", level: undefined }, "poisonDps")` → NaN |

#### R2-P2 — **毒 DoT 仍不吃元素克制／寒冰協同**（R1 C-P1-4 刻意延後）— 非本輪回歸

| 項目 | 內容 |
|------|------|
| 位置 | `updateEnemyStatuses` → `applyDamage(..., { bypassShield:true })`；不經 `dealDamage` 的 `elementMultiplier`／chill×1.25 |
| 說明 | Codex 已標「部分採納／延後」；**不是** poisonDpsMul 沒接上 |
| 易傷 | `applyDamage` 預設吃 vuln（未設 `noVuln`）→ DoT **有**吃易傷 |

#### R2-P3 — **毒不隨波次成長 → 後期相對效能依賴升塔** — 設計後果，非 bug

相對史萊姆血量粗估：`w20` 血量 scale 後 ~365；Lv1 滿層 18 DPS 需 ~20s 純毒磨死；Lv10 ~1.7s。與「請升級」動機一致。

### 3.5 本節總結

| 宣稱 | 結論 |
|------|------|
| `poisonDpsMul` 已接入 runtime／rules／sim／UI | **成立** |
| 隨**波次**縮放 | **未實作／用語有誤**；實際是隨**等級** |
| 溢位或負值 | **正常路徑不成立** |
| 與直擊成長脫鉤且較慢 | **成立**（1.32 vs 1.5） |

---

## 4. 新引入的決定性／平衡／存檔問題

### 4.1 決定性

| # | 結論 | 說明 |
|---|------|------|
| 預告 ↔ 實波 | **變好** | 情報閉環修復 |
| 跨局組成 | **變固定** | R2-S1：無 run salt |
| 戰鬥骰 | **仍隨機** | R2-S2：dodge 等 |
| 開局詞綴 | **仍隨機** | `newGame` `affixSeed = Math.random`（`game.js:228-229`）；影響乘區與餘震選塔，不影響敵種表 |

### 4.2 平衡

| # | 結論 | 說明 |
|---|------|------|
| 毒塔升級動機 | **變好** | B-P1-1 對症；滿層 Lv10 ~219 DPS，仍受 stack／命中率／Boss 0.5 約束 |
| sim-balance | Codex 稱守門仍過 | 本輪靜態覆核未重跑 CI；公式已對齊 `poisonDpsMul` |
| 波次可預測性上升 | **雙刃** | 攻略可背波表；重玩新意下降（R2-S1） |
| 敵種權重（orc 稀有等） | **未動** | R1 延後項，非回歸 |

### 4.3 存檔

| 檢查 | 結論 |
|------|------|
| `waveSeeds` 是否寫入 meta／localStorage | **否**；僅局內 `state`，`newGame` 重置 |
| meta 遷移／`protectMetaWrite` | 本輪毒／seed／type **未改** meta shape（C-P1-6 匯入 key 屬 ui 防禦，不影響局內 seed） |
| 舊存檔相容 | **無新增破壞面**；局內不續關 |

### 4.4 R1 其他已採納項（抽樣，非本任務核心）

下列非本任務三點，但 Codex 宣稱已修；覆核時瞥見實作存在，**未做完整 e2e 複驗**：

| 項 | 瞥見位置 |
|----|----------|
| acquireTarget 段內進度 | `game.js:951-955` 使用 `distToWaypoint/segLen` |
| applyDamage 回傳含盾 | `game.js:444-446` `hpDealt + shieldDealt` |
| notifyUI 節流 | `game.js:91+` |
| backgroundCache / buildableReachCache | `game.js:26-41, 1371-1377` |

若需 R3 可單開「效能與 C-P1 驗收」章節。

---

## 5. 逐條判決表（給修 bug 的人直接勾）

| ID | 主題 | 判決 | 嚴重度 | 檔案:行號 | 最小重現 |
|----|------|------|--------|-----------|----------|
| C-P0-2 / 種子 | 預告 = 實波 | **成立** | — | `game.js:285-333`；`rules.js:371-458` | §1.2 Node／e2e |
| — | 波次路徑 Math.random 洩漏 | **成立（無洩漏）** | — | `rules.js` 全檔；`config.js:258-265` 僅 null fallback | stub Math.random 後 queue 不變 |
| R2-S1 | 跨局組成鎖死 | **新副作用** | P1 | `game.js:289-290` | 兩局同難度比對第 8／12 波 type 序列 |
| R2-S2 | 戰鬥非全決定性 | **殘留** | P2 | `game.js:407-410` | 同 queue 兩 goblin 的 `_dodgeRoll` |
| R2-S3 | getEventWave null rng | **殘留 API** | P2 | `config.js:263` | 不傳 rng 連抽事件 |
| C-P0-1 / type | 實體 type 欄位 | **成立** | — | `game.js:394-402, 709-710` | leak 後 `byType.slime===1` |
| R2-T1 | overrides 覆寫 type | **殘留邊角** | P2 | `game.js:401-411` | overrides `{type:undefined}` |
| R2-T2 | forceType 未驗證 | **殘留契約** | P2 | `rules.js:444-445` | 需錯誤 forceType 才現 |
| B-P1-1 / 毒 | 等級成長 | **成立** | — | `config.js:52`；`game.js:907,965-972`；`rules.js:584-591` | Lv1 vs Lv4 `towerStat`／e2e |
| 口述「隨波次」 | 波次倍率 | **未做（用語誤）** | — | — | 改 wave 不改毒 dps；改 level 才變 |
| 毒溢位／負值 | — | **正常路徑不成立** | — | 同上 | Lv1..10 表 §3.2 |
| R2-P1 | level clamp 不一致 | **殘留** | P2 | `game.js:907` vs `rules.js:590` | `level: undefined` → NaN |
| 存檔 | waveSeeds／meta | **無新破壞** | — | `game.js:239`；meta 未存 waveSeeds | 重開局 seeds 空物件 |

---

## 6. 建議下輪優先序（只建議不實作）

1. **若在意重玩性**：`waveSeedFor` 混入 `runSeed`／`affixSeed`（保預告=實波，恢復跨局變奏）— 對應 R2-S1。  
2. **資料契約**：`generateWaveQueue` 對 `forceType` 做 `ENEMIES` 校驗，失敗 fallback + 開發 assert — R2-T2。  
3. **防禦**：`towerStat` 與 rules 同樣 `max(1, floor(level))`；`createEnemy` 在 overrides 後再強制合法 `type` — R2-P1／R2-T1。  
4. **文件**：對內對外改稱「毒 DoT **隨塔等級**（poisonDpsMul）」，避免下一輪稽核再被「波次」誤導。  
5. **不做也可**：全戰鬥決定性 replay（dodge seed 化）— 工作量大，非情報 bug。

---

## 7. 審查方法與限制

| 項目 | 說明 |
|------|------|
| 已讀 | `src/rules.js`（seed／queue／poison 純函式）、`src/game.js`（waveSeed／preview／startWave／createEnemy／leak／poison／fire）、`src/config.js`（UPGRADE／EVENT／getEventWave）、相關 `ui.js` 片段、R1 報告與 Codex 回應、測試與 sim 對應段 |
| 已用 Node 抽樣 | 同 seed 可重現、`Math.random` 呼叫計數 0、全波非法 type 掃描 0、毒 Lv 表、跨難度組成差異 |
| 未做 | 完整 `npm test`／`test:e2e` 重跑（以靜態+單元語意驗證為主）；未改任何檔案除本報告 |
| 產出 | **僅** `docs/GROK_REVIEW_td_R2.md` |

---

## 8. 一句結語

> **r49 對 R1 兩項 P0 與毒升級動機的修補在主路徑上站得住**；預告可以信、漏怪 byType 可以學、毒塔升級有感。對抗性角度要盯的不是「又漂了」，而是 **seed 綁死波次導致跨局內容凍結（R2-S1）**，以及毒成長是 **等級不是波次** 的表述落差。

---

*本文件為靜態對抗覆核產出；未修改任何 `src/`、`scripts/`、`assets/`、測試或版本號。*
