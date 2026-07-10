# 《無盡塔防》對抗式覆核報告 — Grok R3（td-r51-v1 內容擴充 P0）

| 項目 | 內容 |
|------|------|
| 文件代號 | `GROK_REVIEW_td_R3` |
| 範圍 | `docs/CONTENT_PLAN_td_R1.md` **P0** 落地：beacon／mortar、silencer／mirrorling／warden、eclipse／pilgrim、地圖 lore＋旁白 |
| 對照宣稱 | 內容計畫 P0 機制契約；既有決定性（`runSeed`／`affixSeed`／`waveRngSeed`）；預告=實波 |
| 審查者 | Grok（資深遊戲系統稽核／對抗性視角） |
| 日期 | 2026-07-10 |
| 原則 | **只審不改**；讀 `src/` 真實程式與 `scripts/` 守門；結論附**檔案:行號**與**最小重現** |

**結論標籤**

| 標籤 | 含義 |
|------|------|
| **PASS** | 契約落地，主路徑可驗證 |
| **BUG** | 可重現的邏輯／契約錯誤 |
| **RISK** | 非純錯，但有平衡／交互／決定性副作用，建議處理 |
| **NOTE** | 設計取捨、測試覆蓋缺口、文件用語差異 |

**優先級**

| 等級 | 含義 |
|------|------|
| **P0** | 正確性錯誤／情報不可信／破壞決定性主契約 |
| **P1** | 明顯機制漏洞、平衡尖刺、跨系統交互會傷體驗 |
| **P2** | 邊角、防禦性、文件／用語、低風險 debt |

---

## 0. 總評（先講人話）

| 區塊 | 結論 | 等級 |
|------|------|------|
| beacon 無傷害、與 frost 取高不疊乘 | **PASS** | — |
| mortar `minRange` 目標選擇主路徑 | **PASS**（唯一致敵入口） | — |
| silencer `towerMute` 決定性選塔 | **PASS** | — |
| mirrorling `reflectOnce` 僅 `source:"skill"` | **PASS** | — |
| warden `auraArmor` 多源取最強不疊乘 | **PASS** | — |
| 新敵進池吃 `runSeed`；預告=實波 | **PASS** | — |
| 事件波預告=實波（含 pilgrim special） | **PASS** | — |
| eclipse／pilgrim 事件類型 vs `runSeed` | **NOTE／RISK**：事件 **只吃 wave**，不吃 run salt（舊債延續） | P2 |
| silencer 與 aftershock 欄位 | **PASS（未共用）**；語意並行正確 | — |
| mirrorling × DoT／毒 | **PASS** 邊界符合「用毒拆鏡」 | — |
| warden × medic | **RISK** 保隊雙核偏硬，非錯 | P2 |
| mortar minRange × beacon 減速 | **RISK** 盲區滯留加重 | P1 |
| mortar `minRange` 隨升級吃 `rangeMul` | **RISK** 盲區隨等級膨脹 | P1 |

**一句話**：P0 新塔／新敵／事件／旁白**主契約大多落地且可測**；沒有找到「mortar 繞過 minRange 點名」或「reflect 反射塔傷／DoT」這類硬 bug。對抗性視角下最值得盯的是：**臼砲盲區隨升級膨脹**、**引魂減速把怪釘在盲區**，以及**事件波類型仍不吃 `runSeed`**（跨局事件表固定）。

**本輪未改任何程式。**

---

## 1. 落地與平衡覆核

### 1.1 `beacon`「引魂燈塔」— 無傷害、不疊 frost

| 檢查 | 結果 | 證據 |
|------|------|------|
| 資料：`damage:0`、`fireRate:0`、`support:true`、`slowAura:0.15` | PASS | `src/config.js:43-45` |
| 射擊迴圈跳過 support | PASS | `src/game.js:777-778`：`if (TOWERS[tw.type].support) continue` |
| 光環只寫減速／暴露，不呼叫 `applyDamage` | PASS | `src/game.js:647-665` `updateBeaconAuras` |
| 與 frost 取較強（factor 取 `Math.min`，不疊乘） | PASS | 移動：`src/game.js:757-759`；測試：`scripts/test-td-e2e.js:925-928,999-1000` |
| 多座 beacon 不疊成更強減速 | PASS | `beaconSlowFactor = Math.min(..., factor)`（`game.js:663`），同值 0.85 無加乘 |
| 噤聲／餘震會關光環 | PASS | `updateBeaconAuras` 走 `towerDisabled`（`game.js:656` → `643-644`） |
| 不觸發「寒冰協同 +25%」 | NOTE（合理） | `dealDamage` 只看 `slowUntil`／`frozenUntil`（`game.js:1151-1152`），**不含** `beaconSlowUntil` → beacon 純控場弱於 frost 樞紐 |

**最小重現（無傷害 + 取高不疊）**

1. 建 beacon，敵在 145px 內；`step` 一幀 → `beaconSlowFactor === 0.85`、`revealedUntil > clock`。
2. 再設 `slowUntil = clock+1`、`slowFactor = 0.5`（模擬 frost）→ 移動用 `Math.min(0.5, 0.85) = 0.5`，不是 `0.5*0.85`。
3. 確認無 bullet、`damage` 不經 beacon。

**平衡一句**：cost 115、slow 15%（frost 50%）、無 DPS、無 chilled 增傷 → 符合計畫「弱於 frost 控場、偏情報／輔助」。

---

### 1.2 `mortar`「墜星臼砲」— `minRange` 是否所有目標路徑都過濾

| 檢查 | 結果 | 證據 |
|------|------|------|
| 資料：`minRange:70`、`range:170`、`fireRate:0.32`、`splash:72`、`targetPriority:"midpath"` | PASS | `src/config.js:52-55` |
| **唯一**局內自動選敵：`acquireTarget` | PASS | 射擊：`game.js:782-783` 只呼叫 `acquireTarget` |
| `acquireTarget` 過濾 `d >= minRange && d <= range` | PASS | `game.js:1086-1108` |
| 強制目標／玩家點名塔敵 | **不存在** | 無 lock／forceTarget API；玩家只建塔／放技能 |
| 「最後一隻」在盲區 | PASS（應空轉） | 僅近距一隻時 `acquireTarget` → `null`（e2e：`test-td-e2e.js:936-937,1001-1002`） |
| `debug.fireTower` 可繞過 minRange | NOTE | `game.js:2100` 直接 `fire(tw,target)`——**僅測試／debug**，非玩法路徑 |
| splash 可波及 minRange 內友鄰 | NOTE（設計） | `hit` 以落點半徑判傷（`game.js:1127-1132`），**不**再套 minRange；主目標仍須外環 |

**最小重現**

1. mortar 於 (300,300)；敵 A 於距離 30px、敵 B 於距離 110px。
2. `acquireTarget(mortar) === B`；只留 A → `null`。
3. 實戰：塔 `cd` 就緒但無合法目標時不 `fire`。

#### R3-B1 — mortar `minRange` 隨升級吃 `rangeMul` 膨脹 — **RISK / P1**

| 項目 | 內容 |
|------|------|
| 位置 | `towerStat`：`key === "minRange"` 與 `range` 同樣 `* rangeMul^(lv-1) * affixMul(towerRangeMul)`（`game.js:1050`） |
| 行為 | L1 盲區 70；L10 ≈ **140**；外環 170→≈340。升級把「腳下不能打」一併放大 |
| 計畫意圖 | 計畫寫「最短射程外環」當定位代價，**未**要求盲區隨等級等比長大 |
| 影響 | 高階臼砲更難打貼身／轉角腳下；與 beacon 減速疊加時更糟（見 §3.4） |
| 最小重現 | `minRange(L) = 70 * 1.08^(L-1)`：L5≈95、L10≈140（Node 可重算） |

#### R3-B2 — 飛行中彈丸不因目標走入盲區取消 — **NOTE / P2**

| 項目 | 內容 |
|------|------|
| 位置 | `fire` 鎖定後 `update` 子彈追 `b.target`（`game.js:790-795`），**無**二次 minRange |
| 說明 | 開火當下合法即可；不算繞過選敵，屬彈道常識 |

---

### 1.3 `silencer` — `towerMute` 決定性

| 檢查 | 結果 | 證據 |
|------|------|------|
| 資料：range 115、interval 3、duration 2 | PASS | `config.js:102-103` |
| 選塔純函式、無 `Math.random` | PASS | `rules.js:420-434` `selectTowerMuteTarget` |
| 最近距離；同距 `order` 較小（建造序較早） | PASS | `d < best - 1e-9` 或等距且 `order < best.order` |
| 局內寫入 `mutedUntil`（非亂數塔） | PASS | `game.js:608-618` |
| 停火與 aftershock 並讀 | PASS | `towerDisabled`：`stunnedUntil \|\| mutedUntil`（`game.js:643-644`） |
| 進池門檻 wave≥10 | PASS | `pickDefaultEnemy`／`enemyAvailableInWave`（`rules.js:451,466`） |

**最小重現**

1. 敵 (100,100)；塔 A order=2 於 (80,100)、塔 B order=1 於 (120,100)，皆距 20。
2. `selectTowerMuteTarget` → cannon／order 1（`test-rules.js:214-222`；e2e `test-td-e2e.js:940-945`）。
3. range=10 → `null`。

---

### 1.4 `mirrorling` — `reflectOnce` 僅技能

| 檢查 | 結果 | 證據 |
|------|------|------|
| 觸發條件 | PASS | `applyDamage`：`opts.source === "skill" && ability.id === "reflectOnce" && !reflectedSkill`（`game.js:513-518`） |
| 消耗 flag、回傳 0、跳過後續技能 CC／易傷 | PASS | `castSkill`：`if (e._reflectedLastHit) continue`（`game.js:1173-1177`） |
| 塔傷 `source:"tower"` 不反射 | PASS | `dealDamage` → `source: "tower"`（`game.js:1154`） |
| 英雄 `source:"hero"` 不反射 | PASS | 同上 |
| 第二次技能生效 | PASS | e2e：首發 meteor HP 不變，第二發 skill 扣血（`test-td-e2e.js:948-953,1005-1006`） |
| 女神 smite 無 `source:"skill"` | NOTE | `game.js:738` 未標記 skill → **不**吃反射（符合「主動技能」口徑） |

**最小重現**

1. spawn mirrorling HP100 → `castSkill("meteor", x, y)` → HP 仍 100、`reflectedSkill===true`。
2. `applyDamage(..., {source:"skill"})` 30 → HP 70。
3. `applyDamage(..., {source:"tower"})` 在反射前也可直接扣血。

---

### 1.5 `warden` — `auraArmor` 取最強不疊乘

| 檢查 | 結果 | 證據 |
|------|------|------|
| 掃描在場 `auraArmor`，距離 ≤ radius | PASS | `auraArmorMulFor`（`game.js:491-502`） |
| 多 warden：`mul = Math.min(mul, damageMul)` | PASS | 同函式；皆 0.75 時仍 0.75，**不** `0.75²` |
| 不對自己套光環 | PASS | `source === target` continue |
| 兩 warden 可互相減傷 | PASS（合理） | 互為對方 `source` |
| 減傷在 dodge／護盾結算前乘上 | PASS | `applyDamage` 順序：reflect → armor → dodge → shield（`game.js:513-540`） |
| e2e ×0.75 | PASS | 40 → 30（`test-td-e2e.js:956-961,1007-1008`） |

**最小重現**

1. ally 與 warden 距離 ≤90；`applyDamage(ally,40)` → 30、`_armoredLastHit`。
2. 移開 warden 再打 40 → 40。
3. 兩座 warden 同 rad：仍 ×0.75 一次。

---

### 1.6 事件波／旁白／lore（P0-3／P0-4 抽樣）

| 項目 | 結果 | 位置 |
|------|------|------|
| `eclipse`：`towerDamageMul 0.85`、`goldMul 1.4` | PASS | `config.js:272-273`；傷：`towerStat`×`eventMul`（`game.js:1048,417-420`） |
| `pilgrim`：queue 頭插入 special | PASS | `rules.js:503-517`；測試 `test-rules.js:486-489` |
| 事件表 7 鍵、種子索引 | PASS | `Object.keys(EVENT_WAVES)` + `eventWaveSeed`（`config.js:282-288`，`rules.js:391-393,479`） |
| `MAP_LORE`／`WAVE_BEATS`／`EVENT_FLAVOR`／`BOSS_INTRO` | PASS | `lore.js:228-273`；投放 `game.js:239-254,385-402` |
| 新敵 `loreLine` | PASS | `config.js:105,109,113`；UI `ui.js:842` |

**固定波次事件樣本**（`eventWaveSeed(w)`，normal `bossEvery=5`，非 Boss 且 `w%3===2`）：

| wave | 事件 |
|------|------|
| 8 | rush |
| 11 | swarm |
| 14 | rift |
| 17 | **pilgrim** |
| 23 | treasure |
| 26 | **eclipse** |
| 38 | **pilgrim** |

（事件表由 5→7 後舊 seed 對應已變——計畫已接受；同 build 內仍決定性。）

---

## 2. 與 `runSeed`／決定性波次相容

### 2.1 資料流（現行，含 R2 修補後 salt）

```
newGame → state.runSeed, state.affixSeed
previewNextWave / startWave
  → waveSeedFor(w) = waveRngSeed(w, runSeed, affixSeed)   // 快取 key run:affix:wave
  → generateWaveQueue(w, diff, seed, affix)
       ├─ makeRng(seed) → pickDefaultEnemy / theme 抽選   // 新敵在此進池
       └─ getEventWave(w, isBoss, eventWaveSeed(w))     // 事件類型：只吃 wave
```

| 步驟 | 位置 |
|------|------|
| 開局 seed | `game.js:266-279` |
| `waveSeedFor` | `game.js:332-341` |
| 預告／實波共用 plan | `game.js:343-362,373-382` |
| `waveRngSeed(w, runSeed, affixSeed)` | `rules.js:395-400` |
| 新敵門檻與權重 | `rules.js:437-469` |
| 事件 unit seed | `rules.js:391-393,479` |

### 2.2 結論表

| 檢查項 | 結果 | 說明 |
|--------|------|------|
| 新敵進池是否吃 seed | **PASS** | `silencer`／`mirrorling`／`warden` 經 `makeRng(waveSeed)`；同 `runSeed+affixSeed+w` queue 全等；不同 `runSeed` 組成可異（`test-rules.js:358-367` 等） |
| 預告 queue = 實波 queue | **PASS** | 同 `wavePlanFor`；e2e 守門仍在 |
| pilgrim special 在預告可見 | **PASS** | `generateWaveQueue` 寫入 queue；`previewNextWave` 複製 queue |
| eclipse 乘區與預告一致 | **PASS** | plan.event 同源；實波 `state.currentEvent = ev`（`game.js:379`） |
| 事件**類型**是否吃 `runSeed` | **不吃（RISK／舊債）** | 見 R3-D1 |

#### R3-D1 — 事件波類型仍只由 `wave` 決定，不混 `runSeed` — **RISK / P2**

| 項目 | 內容 |
|------|------|
| 位置 | `eventWaveSeed(wave)`（`rules.js:391-393`）；`generateWaveQueue` 傳入（`:479`） |
| 行為 | 任意 run：第 17 波（條件符合時）**永遠** pilgrim、第 26 波 **永遠** eclipse（normal 節奏下） |
| 敵種組成 | 仍隨 `runSeed` 變；**事件標籤與 pilgrim 插入／eclipse 乘區**跨局鎖死 |
| 與計畫 | P0 寫「seed 決定是否本事件」多指事件表抽選決定性，**未強制** run salt；R2 已標跨局固定 |
| 最小重現 | `newGame({runSeed:A})` 與 `{runSeed:B}` 都打到 wave 17 非 Boss 事件 → 皆 `pilgrim`；queue 護衛組成可不同，但皆有 `role:"pilgrim"` |

#### R3-D2 — `getEventWave` null rng 仍可能 `Math.random` — **NOTE / P2**

| 項目 | 內容 |
|------|------|
| 位置 | `config.js:287` |
| 主路徑 | `generateWaveQueue` **永遠**傳 `eventWaveSeed(w)`，不踩 |
| 殘留 | 與 R2-S3 相同 API 防禦面 |

#### R3-D3 — 戰鬥結果仍非全決定性 — **NOTE / P2**

| 項目 | 內容 |
|------|------|
| 位置 | `createEnemy`：`animSeed`、`_dodgeRoll` 用 `Math.random`（`game.js:477-479` 一帶） |
| 說明 | **出怪名單**決定性；閃避骰仍真隨機。與新敵無直接衝突，但 silencer／warden 波的「可重現戰鬥」仍不可期待 |

### 2.3 新敵池副作用（平衡 NOTE）

| 項目 | 內容 |
|------|------|
| 位置 | `pickDefaultEnemy`：`roll < 0.93` 在 wave≥10 改回傳 `silencer`，不再回 `medic`（`rules.js:451`） |
| 影響 | medic **非**從遊戲消失（physical `themeEnemyPool` 仍含 medic，`config` theme + `rules` 55% 偏壓），但 **default 帶被 silencer 佔用** |
| 標籤 | **NOTE / P2** 池權重重分配；非決定性 bug |
| 抽樣 | 多 run 掃描 wave 10–20 仍可見 medic，但路徑改走主題池 |

---

## 3. 交互 bug 覆核

### 3.1 silencer 噤聲 vs aftershock stun「欄位共用」

| 檢查 | 結果 |
|------|------|
| 計畫原文 | 「可與 aftershock stun **共用欄位語意**」（`CONTENT_PLAN_td_R1.md` silencer 節） |
| **實作** | **未共用**：aftershock → `stunnedUntil`（`game.js:445-446`）；silencer → `mutedUntil`（`game.js:614`） |
| 停火 | `towerDisabled` OR 兩者（`game.js:643-644`） |
| 延長 | 各自 `Math.max(until, clock+dur)`，**無互蓋** |
| UI | 同時存在時優先顯示噤聲 🤐（`game.js:1712-1715`） |
| 不對稱 | aftershock 另強制 `tw.cd`；mute **不**改 cd → 噤聲結束後若 cd 已好可立刻開火 |

**結論：無「共用欄位覆寫」類 bug。** 分離欄位是正確防衝突做法。

**最小重現（並行）**

1. 詞綴 aftershock 震停塔 A（`stunnedUntil`）。
2. silencer 對同塔再 mute（`mutedUntil`）。
3. 兩者 timer 獨立；`towerDisabled` 直到較晚者結束。

**標籤：PASS**（若文件仍寫「共用欄位」→ **用語校正 NOTE**）。

---

### 3.2 mirrorling 反射 vs DoT／毒邊界

| 情境 | 是否反射 | 證據 |
|------|----------|------|
| 主動技能直擊 | 是（一生一次） | `source:"skill"` |
| 技能附帶 freeze／root／vuln | 反射當下跳過 | `castSkill` continue |
| 毒霧**直擊** | 否 | `source:"tower"` |
| 毒 **DoT tick** | 否 | `updateEnemyStatuses` → `applyDamage` 無 skill（`game.js:576`） |
| 塔 splash／pierce | 否 | tower source |
| 已 `reflectedSkill` 後的技能 | 正常受傷 | flag 已 true |

**結論：邊界正確**，對齊計畫「用毒／多段塔拆鏡、別首發隕石」。

**潛在 NOTE**：毒直擊在 `dealDamage` 若被 **dodge** 會 early return 而不上毒（`game.js:1155-1157`）——舊行為，與 mirrorling 無關。

**標籤：PASS**

---

### 3.3 warden 光環 × medic 回血

| 項目 | 內容 |
|------|------|
| 機制正交 | 光環乘**傷害**；醫官直接 `ally.hp += heal`（`game.js:624-635`），**不受** armor mul |
| 疊加體感 | 鄰近單位有效生命 ≈ ×(1/0.75) 且持續回血；優先殺核變難 |
| 計畫 | 明確「與 medic 對位成保隊雙核」——**意圖內** |
| 進池 | warden wave≥12；medic≥7；中後期可能同波 |
| 緩解已存在 | splash／mortar 顧問加分（`rules.js:619`）；counterHint 要求集火 warden |

**結論：非邏輯 bug，屬平衡尖刺。** 多 warden 不疊乘減傷已封最壞指數。

**最小重現（手感）**

1. 並排放 medic + warden + 高血 orc，三者互在 80–90px 內。
2. 用等 DPS 箭塔打 orc：有效扣血 75%，且每 2s 被醫 14。
3. 先殺 warden 後同 DPS 明顯加快。

**標籤：RISK / P2**（建議 sim 或後期波次監控，非必修）

---

### 3.4 mortar minRange × beacon 減速死角 — **RISK / P1**

| 項目 | 內容 |
|------|------|
| 機制 | beacon 使敵速 ×0.85 → **在 mortar 盲區內停留更久**；期間 mortar 無法將其選為主目標 |
| 位置 | 減速：`game.js:757-759`；選敵：`1089-1094` |
| 計畫 | mortar「無法守護腳下」本即定位；beacon **未**在計畫中與盲區聯動評估 |
| 緩解 | `midpath` 優先打路徑中段；splash 可從外環落點濺進盲區；他塔可補腳下 |
| 惡化 | 與 R3-B1（升級脹盲區）疊加時，高階 mortar + 腳下 beacon 可能長時間空轉 |
| 非 bug 點 | 沒有「beacon 讓 mortar 忽略 minRange」的反向錯誤 |

**最小重現**

1. mortar 建於路徑旁；**僅**一隻敵沿路徑進入距離 < minRange，並置於 beacon 光環內。
2. 觀測：敵緩速爬過盲區；mortar `acquireTarget === null` 直至敵走出 minRange。
3. 對照：無 beacon 時盲區通過時間更短（同 path 速度差 15%）。

**標籤：RISK / P1**（交互體驗／佈陣陷阱；建議後續要嘛文案提示，要嘛 minRange 不吃 upgrade 或 beacon 不延長「對 mortar 無效段」的體感）

---

### 3.5 其他交互速記

| 交互 | 結論 |
|------|------|
| silencer mute **support／beacon** | 會選中；beacon 光環停 → 控場可被點名拆掉（合理） |
| eclipse × 全塔傷 | `towerStat` damage／poisonDps 皆乘（`game.js:1048-1049`）；support buff 基值不乘傷（合理） |
| pilgrim 朝聖者 | 以 slime 為底 + mul；**無**特殊能力 id，非新機制 bug |
| 寒冰 chilled 與 beacon | 不同時觸發 1.25 協同（見 §1.1）— 避免 beacon 變相 DPS |

---

## 4. 測試與覆蓋缺口

| 已有守門 | 位置 |
|----------|------|
| 塔／敵／事件 config 煙測 | `scripts/test-config.js` |
| mute 純函式、新敵進池、事件含 eclipse／pilgrim、pilgrim special | `scripts/test-rules.js` |
| beacon／mortar／三敵 e2e 戰鬥片段 | `scripts/test-td-e2e.js` stage4 |
| lore 事件 flavor | `scripts/test-lore.js` |

| 缺口 | 建議（只記錄不實作） |
|------|----------------------|
| mortar L10 minRange 回歸 | 斷言 minRange 成長策略（固定 70 vs 吃 rangeMul） |
| mute+stun 雙 timer | e2e 同塔並行 |
| 毒 DoT 不消耗／不觸發 reflect | 顯式 assert |
| 雙 warden 不疊乘 | unit：兩 source 仍 0.75 |
| beacon 不觸發 chilled 1.25 | 防回歸 |
| 預告 pilgrim `role` 與 startWave spawn 一致 | 已有 queue 相等可涵蓋；可標註 special 欄位 |

---

## 5. 逐條總表（任務對照）

### (1) 落地與平衡

| # | 條款 | 結論 | 優先 |
|---|------|------|------|
| 1.1 | beacon 真無傷害 | **PASS** | — |
| 1.2 | beacon 不疊 frost（取高） | **PASS** | — |
| 1.3 | mortar minRange 所有**玩法**選敵路徑 | **PASS**（唯 `acquireTarget`） | — |
| 1.4 | 強制目標／最後一隻 | **PASS**（無強制；盲區內最後一隻 → 不射） | — |
| 1.5 | silencer 同距 tie-break | **PASS**（order 較早） | — |
| 1.6 | reflectOnce 只反射 skill | **PASS** | — |
| 1.7 | auraArmor 多 warden 取最強不疊 | **PASS** | — |
| 1.8 | mortar 盲區隨升級膨脹 | **RISK** R3-B1 | P1 |

### (2) runSeed／預告契約

| # | 條款 | 結論 | 優先 |
|---|------|------|------|
| 2.1 | 新敵進池吃 seed | **PASS** | — |
| 2.2 | 預告 = 實波（含新敵／事件 queue） | **PASS** | — |
| 2.3 | 事件類型 × runSeed | **不混 salt** R3-D1 | P2 |
| 2.4 | pilgrim／eclipse 契約 | **PASS**（同 seed 可重現） | — |

### (3) 交互

| # | 條款 | 結論 | 優先 |
|---|------|------|------|
| 3.1 | mute 與 aftershock 欄位衝突 | **無共用、無覆寫** PASS | — |
| 3.2 | reflect × DoT／毒 | **PASS**（不反射） | — |
| 3.3 | warden × medic | **RISK** 意圖內偏硬 | P2 |
| 3.4 | mortar minRange × beacon | **RISK** 盲區滯留 | P1 |

---

## 6. 優先修復建議（只建議，本輪不改）

| 序 | ID | 建議 |
|----|-----|------|
| 1 | R3-B1 | `minRange` **不要**套 `rangeMul`（或獨立 `minRangeMul=1`），避免升級懲罰腳下 |
| 2 | R3-B1+3.4 | 建塔／圖鑑註記：「臼砲盲區內需他塔；引魂燈會延長敵在盲區時間」 |
| 3 | R3-D1 | 若要跨局事件多樣：`eventWaveSeed(w, runSeed)` 或混 salt；**必須**保持預告=實波同一函式 |
| 4 | 3.3 | sim-balance 加「medic+warden 同框」壓力列；必要時降 heal 或 aura 二選一微調 |
| 5 | 測試 | 補雙 warden、毒 vs reflect、mute+stun、minRange 升級契約 |

---

## 7. 審查結論

> **td-r51-v1 的 P0 內容擴充在「機制是否照契約運作」上整體合格：beacon／mortar／三新敵／兩事件／旁白皆有真實接線，決定性出怪與預告契約未被新內容拆掉。**  
> 對抗性覆核未發現「反射塔傷」「mute 蓋掉 stun 欄位」「mortar 自動點名盲區」等硬錯誤。  
> 真正的債在**數值與佈陣交互**：臼砲盲區隨升級長大、與引魂減速的死角共振，以及事件波類型仍跨局鎖死在 wave 上。

**簽核：R3 只審不改 — 報告完成於 `docs/GROK_REVIEW_td_R3.md`。**
