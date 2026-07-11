# 《無盡塔防》手機端體驗監工報告 — Grok（td-r55-v1）

| 項目 | 內容 |
|------|------|
| 文件代號 | `GROK_REVIEW_td_mobile` |
| 版本 | `td-r55-v1` / `0.5.5` |
| 範圍 | 手機玩家視角：(1) 觸控建塔／選塔／升級與目標尺寸；(2) 手機效能（R53–55 特效／粒子／高波次）；(3) HUD／面板可讀性與 safe-area；(4) PWA 安裝 |
| 審查者 | Grok（手機端體驗監工） |
| 日期 | 2026-07-11 |
| 原則 | **只審不改**；結論附**檔案:行號**；優先級 P0–P2 |

**結論標籤**

| 標籤 | 含義 |
|------|------|
| **PASS** | 已有合理手機主路徑 |
| **BUG** | 可重現的錯誤或明顯阻斷體驗 |
| **RISK** | 非純錯，但高機率誤觸／掉幀／可讀性崩壞 |
| **NOTE** | 設計取捨、測試缺口、平台差異 |

**優先級**

| 等級 | 含義 |
|------|------|
| **P0** | 主路徑不可玩／嚴重誤觸到無法精準操作／安裝後嚴重不可用 |
| **P1** | 高頻痛點：目標太小、升級流程折返、高波 thrash、notch 遮擋、PWA 安裝不可發現 |
| **P2** | 邊角、美規細節、測試覆蓋、低風險 debt |

---

## 0. 總評（先講人話）

| 檢查項 | 結論 | 最重等級 |
|--------|------|----------|
| (1) 觸控建塔／選塔／升級 | **RISK** — 雙點確認建塔有做；但**格位 CSS 約 17–20px**，遠低於 44px；升級面板埋在側欄底部需捲動 | P0–P1 |
| (2) 手機效能 | **RISK** — 有 auto 降級／粒子 cap／reduced；但每幀仍 960×640 全畫 + `shadowBlur` + 建塔格遍歷；高波可 thrash | P1 |
| (3) HUD／面板／safe-area | **RISK** — RWD app-shell 與 sticky 控制有做；**零 `safe-area-inset`**；選塔升級非 sticky | P1 |
| (4) PWA 安裝 | **RISK** — SW + manifest 齊；**無安裝 CTA**、無 iOS `apple-touch-icon`／`apple-mobile-web-app` 標籤 | P1 |

**一句話**：這是「桌機 Canvas 遊戲 + 不錯的窄視口殼」——**能在手機開、能雙點建塔、能離線更新**，但**戰場格位在直式手機只有約一枚小指甲蓋**，選塔升級要往下捲到技能區下方，**不像專為單手塔防設計**。PWA 可被瀏覽器辨識為可安裝，但**產品內沒有「加到主畫面」引導**。

**本輪未改任何程式。**

---

## 1. 塔格子在手機有多大？（關鍵數字）

| 來源 | 值 |
|------|-----|
| 邏輯格位 | `GAME.cellSize = 48` 畫素（canvas 內座標）— `src/config.js:150` |
| 畫布固定解析度 | `960×640` — `index.html:718`、`src/game.js:15-18` |
| CSS 縮放 | `canvasPos` 用 `getBoundingClientRect` 等比映射 — `src/game.js:2293-2296` |
| 手機畫布高上限 | `max-height: 46vh / 46dvh` — `index.html:624` |
| 橫向窄視口 | `max-width: min(62vw, calc(100vw - 208px))` — `index.html:677` |

### 1.1 推算：CSS 格位邊長（直式／橫向）

假設 `body` 左右 padding 6px（`index.html:621`），canvas 以 3:2 塞進可用寬與 `46dvh`：

| 視口 | 約略 CSS canvas | scale | **格位 CSS 邊長** | 英雄點選半徑（`CELL*0.5`） |
|------|-----------------|-------|-------------------|---------------------------|
| iPhone 390×844 | ~378×252 | 0.394 | **~18.9 px** | **~9.4 px** |
| Android 360×640 | ~348×232 | 0.362 | **~17.4 px** | **~8.7 px** |
| Android 412×915 | ~400×267 | 0.417 | **~20.0 px** | **~10.0 px** |
| iPad 820×1180（仍走 ≤900 手機殼） | ~808×539 | 0.842 | **~40.4 px** | **~20.2 px** |
| 橫向 844×390 | ~507×338 | 0.528 | **~25.3 px** | **~12.7 px** |

**業界對照**：Apple HIG／Material 建議可點目標 **≥ 44×44 CSS px**（約 48dp）。  
→ **直式手機格位約 17–20px，僅達建議的 ~40%**。平板接近、仍略不足。

**判定**：**P0（直式手機精準建塔／選塔）** — 不是「手感差一點」，而是**手指蓋住多格**，靠雙點確認只能降低「建錯一次」的機率，**不能解決「點到隔壁格」**。

---

## 2. (1) 觸控建塔／選塔／升級流程

### 2.1 現況流程（PASS 的部分）

| 步驟 | 行為 | 證據 |
|------|------|------|
| 選塔種 | 側欄 `.tower-btn`，再點同鈕可取消 | `src/ui.js:116-120`；`src/game.js:2457-2458` |
| 觸控建塔 | **兩次點同一格**才 `tryBuildTower`；第一次 ghost +「再點一次確認」 | `src/game.js:2320-2335` |
| 桌機建塔 | 單 click 直接建 | `src/game.js:2320` |
| 防雙觸發 | `touchend` `preventDefault` 擋合成 click | `src/game.js:2371-2375` |
| 座標 RWD | `client → canvas` 用 rect 比例 | `src/game.js:2293-2296` |
| 防頁面手勢 | `touch-action: none` on canvas | `index.html:577` |
| 選既有塔 | 依 `floor(px/CELL)` 找 `cx,cy` | `src/game.js:2360-2363` |
| 升級／賣出 | DOM `#upgBtn` / `#sellBtn` | `src/ui.js:1031-1057, 1561-1562`；`index.html:757-761` |
| 技能 | 選技能 → 點地圖立即 `castSkill`（**無二次確認**） | `src/game.js:2338` |
| 英雄駐守 | 點英雄再點地圖；自體取消 | `src/game.js:2341-2358` |
| 顧問建造 | 亦為再點確認 | `src/game.js:2299-2318, 2406-2410` |

### 2.2 誤觸與目標尺寸問題清單

| ID | 等級 | 標籤 | 問題 | 證據 |
|----|------|------|------|------|
| **M-T1** | **P0** | RISK | **格位 CSS 17–20px**：一指同時覆蓋 2–4 格，雙點確認只能確認「同一邏輯格」，無法放大 hit area | `src/config.js:150`；`index.html:624`；§1 推算 |
| **M-T2** | **P1** | RISK | **選中塔升級面板在面板最底（order 21）**，手機主流程是：點 canvas 選塔 → 手指離開畫布 → **向下捲過女神／情報／英雄／技能** 才見升級／賣出；戰鬥中幾乎不可用 | `index.html:637-657`（`sel-panel` order 21）；`index.html:757-761` |
| **M-T3** | **P1** | RISK | **升級／賣出鈕 `min-height: 40px`**，低於 44px 與主操作鈕標準；且與相鄰賣出紅鈕並列，誤觸賣塔代價高 | `index.html:256-258` |
| **M-T4** | **P1** | RISK | **英雄選取半徑 `CELL * 0.5`（邏輯 24px → CSS ~9px）**，駐守幾乎靠運氣；`pendingHero` 與建塔模式互斥順序在 `handleTap` 靠前，誤點英雄會搶走建塔意圖 | `src/game.js:2341-2358, 2338-2339` |
| **M-T5** | **P1** | RISK | **技能單點施放無確認／無取消手勢**（僅 Esc 桌機）；誤觸地圖＝冷卻與效果直接扣 | `src/game.js:2338`；取消：`src/game.js:2479` + 鍵盤 `src/ui.js:1642-1644` |
| **M-T6** | **P2** | RISK | 建塔模式**成功後 `selectedTowerType` 仍維持**（可連續建），錯誤幽靈格會留下 `buildGhost`；無「點空白取消」手勢（需再點塔種或 Esc） | `src/game.js:1477-1479, 2322-2329, 2458` |
| **M-T7** | **P2** | NOTE | 橫向清單 `min-width: 120–150px` + 橫滑，與 `.panel` 直滑**巢狀捲動**，Android 易搶手勢 | `index.html:630-636, 689` |
| **M-T8** | **P2** | PASS/NOTE | 側欄主鈕多數 `min-height: 44px`（塔種／開始／英雄卡）— **DOM 控制達標，Canvas 格位未達標** | `index.html:80, 112, 219` |

### 2.3 建議方向（只列不實作）

1. **增大有效 hit**：觸控時選最近可建格／最近塔（snap），或顯示放大準星＋吸附。  
2. **選塔後升級列 sticky** 到 `hud-core` 旁或 canvas 下方固定條。  
3. 技能／賣出二次確認或滑動確認。  
4. 直式允許 canvas 佔更高比例（犧牲面板）或提供「 fortify 模式」放大局部。

---

## 3. (2) 手機效能（R53–55 特效／粒子／高波）

### 3.1 已落地的防護（PASS）

| 機制 | 行為 | 證據 |
|------|------|------|
| 粒子硬上限 | `MAX_PARTICLES=220`，text/coin/ring 分 cap | `src/game.js:79-82, 1547-1566` |
| 低品質縮量 | `burst` ×0.45；`particleScale` 0.45；ring 可能直接 skip | `src/game.js:406-408, 1568-1571, 1613-1615` |
| Auto 效能 | FPS&lt;45 → low；≥54 連續 3 秒 → high | `src/game.js:363-378` |
| reduced 特效 | 清粒子、關 slow-mo／vignette 等 | `src/game.js:107-114, 1568-1569` |
| 背景 bake | 草地／vignette 離屏快取 | `src/game.js:1880-1886`（及 bake 區） |
| 邏輯／表現分離 | 粒子用 `fxDt`，戰鬥用 `dt`（R55 修過） | `src/game.js:906-918, 1015-1027` |
| 設定 UI | 效能 auto/high/low、減少特效 | `index.html:817-838`；`src/ui.js:1565-1577` |
| dt clamp | `dt > 0.05` 截斷 | `src/game.js:884` |

### 3.2 高波次負載量級

敵人波次基數：`baseCount = 5 + floor(w * 1.2)`（Boss 波再 ×0.5 + boss 實體）— `src/rules.js:489-528`。

| 波次 | 約略同場生成數（無事件加成） |
|------|------------------------------|
| 1 | ~6 |
| 10（Boss） | ~9+ |
| 20 | ~15+ |
| 30 | ~21+ |
| 50 | ~33+ |

每隻敵人每幀：`drawEnemy` 含 shadow ellipse、transform、sprite、血條、狀態 — `src/game.js:2081-2138`。  
塔／子彈／粒子另疊：`render` 全量迴圈 — `src/game.js:1663-1673`。

2× 速度時邏輯步進加倍（`dt *= state.speed`）— `src/game.js:885`，手機更易掉幀。

### 3.3 效能風險清單

| ID | 等級 | 標籤 | 問題 | 證據 |
|----|------|------|------|------|
| **M-P1** | **P1** | RISK | **內部分辨率固定 960×640**，手機 CSS 只縮顯示不降內部繪製成本；中低階 GPU 每幀 fill 固定偏高 | `index.html:718`；`src/game.js:15-17` |
| **M-P2** | **P1** | RISK | **`shadowBlur` 大量使用**（塔等級光暈、子彈、粒子 glow、muzzle）— 行動瀏覽器昂貴 | `src/game.js:2049, 2225-2230, 2265, 2285-2287` |
| **M-P3** | **P1** | RISK | **建塔預覽每幀 `drawBuildableCells` 雙層 fill+stroke 全格**（約 20×14） | `src/game.js:1911-1934, 1667` |
| **M-P4** | **P1** | RISK | Boss 死亡 `burst(..., 72)` + 雙 ring，低品質才 ×0.45 仍可瞬間頂滿 cap，擠掉 warning／text | `src/game.js:1579-1584`；cap：`1547-1566` |
| **M-P5** | **P1** | RISK | Auto 降級：**單次 1 秒樣本 &lt;45 即 low**（`lowSamples >= 1`），易在開場／轉場誤判；恢復需 3 秒 ≥54 | `src/game.js:367-374` |
| **M-P6** | **P2** | RISK | `performanceLow` 時動畫／毒霧透明度有降，但**敵人逐隻 draw 路徑未 culling、未降血條複雜度** | `src/game.js:2089, 2144+` |
| **M-P7** | **P2** | NOTE | 路徑磚每幀對 `blocked` 集合 `drawImage`（背景已 bake 但 path 另畫） | `src/game.js:1888-1901` |
| **M-P8** | **P2** | PASS | 粒子更新吃 `fxDt`，slow-mo 不拖邏輯（R55）— 正確，但 slow-mo **拉長粒子存活 wall-time**，高波仍可能堆積至 cap | `src/game.js:855 區, 1015-1027`（見 `GROK_REVIEW_td_R5`） |

### 3.4 與 R53–55 的關係（手機視角）

| 特性 | 手機影響 |
|------|----------|
| 槍口焰／金幣飛字／升級光束／連殺 | 視覺爽度↑，draw call 與 text 粒子↑ |
| Boss slow-mo（僅 fx） | 邏輯 OK；粒子壽命變長 → 更易頂 cap |
| reduced / 鎖低 | **手機預設應引導開 reduced 或 auto**；目前藏在設定，新手不知 |

---

## 4. (3) HUD／面板可讀性與 safe-area

### 4.1 已做好的 RWD（PASS）

| 項目 | 證據 |
|------|------|
| `100dvh` + `overflow: hidden` app-shell | `index.html:42-46` |
| ≤900 直式：canvas 頂 + panel 內捲 | `index.html:619-626` |
| 橫向矮視口：canvas 左、panel 右 | `index.html:671-678` |
| ≤560：HUD 字 13px、藏 hotkey、藏塔 meta | `index.html:681-689` |
| sticky `.hud-core`（開始／速度／暫停／設定） | `index.html:660-668` |
| 文字大小 small/medium/large | `index.html:487-499, 826-831`；`src/ui.js:51-54` |
| RWD 矩陣守門（含 390×844、360×640、844×390） | `scripts/test-rwd-matrix.js:23-33` |
| 多數互動鈕 ≥44px | `index.html:80, 112, 219` |

### 4.2 可讀性／安全區問題

| ID | 等級 | 標籤 | 問題 | 證據 |
|----|------|------|------|------|
| **M-H1** | **P1** | RISK | **全專案無 `env(safe-area-inset-*)`**，亦無 `viewport-fit=cover`。PWA standalone／瀏海機：頂部 HUD、底部 sticky 控制、PWA toast 可能貼齊 Home Indicator 或被瀏海裁切 | viewport：`index.html:5`；body padding 固定 6–8px：`42-47, 621`；toast bottom 18px：`209-212` |
| **M-H2** | **P1** | RISK | **直式 canvas 僅 ~46dvh**，戰場小、資訊密度全擠在下方 panel；波次情報＋顧問 HTML 很長，**開始戰鬥前需大量捲動** | `index.html:624`；顧問：`src/ui.js:871-908` |
| **M-H3** | **P1** | RISK | 選塔 `sel-panel` **非 sticky** 且 order 在技能後 → 與 M-T2 同根 | `index.html:657` |
| **M-H4** | **P2** | RISK | ≤560 隱藏 `.tower-btn .meta`，只留名＋價；**新手不知射程／盲區**只能靠 title（長按不一） | `index.html:689` |
| **M-H5** | **P2** | RISK | 日誌 `#log` 手機 `min-height: 0`、最多 3 行，重要失敗提示（金錢不足、不可建）易被擠掉 | `index.html:627`；`src/ui.js:1061-1066` |
| **M-H6** | **P2** | RISK | 固定 toast（任務／羈絆／recovery／PWA）用 `top: 132/184` 或 `bottom: 18` **未跟 safe-area 與動態 HUD 高度** | `index.html:200-212` |
| **M-H7** | **P2** | NOTE | `user-scalable=no` + `maximum-scale=1.0`：防誤縮放合理，但**無障礙放大被關** | `index.html:5` |
| **M-H8** | **P2** | NOTE | 橫向 `h1` 12px、stat 12px，可讀但偏擠 | `index.html:672-675` |
| **M-H9** | **P2** | PASS/NOTE | RWD 測試驗「元素在可捲容器內」**不驗** 44px 觸控、不驗 canvas 格位、不驗 safe-area | `scripts/test-rwd-matrix.js:58-99` |

---

## 5. (4) PWA 安裝

### 5.1 現況盤點

| 項目 | 狀態 | 證據 |
|------|------|------|
| Web App Manifest | 有：`display: standalone`、icons 192/512、`lang: zh-Hant` | `manifest.webmanifest:1-26`；連結 `index.html:8` |
| Service Worker | 有：install precache、activate 清舊、HTML network-first、資產 cache-first、SKIP_WAITING | `sw.js:95-155` |
| 版本 | `CACHE_VERSION = td-r55-v1`，APP_SHELL 含 JS/圖 | `sw.js:1-16` |
| 更新 UX | toast「立即更新」+ 設定「檢查更新」+ 15s 內 auto-reload | `index.html:209-214, 934-1051`；`src/ui.js:1586` |
| 離線 fallback | `offline.html` | `offline.html`；`sw.js:124` |
| **安裝 CTA** | **無** `beforeinstallprompt`、無「加到主畫面」按鈕 | 全庫無 `beforeinstallprompt` |
| **iOS 主畫面** | **無** `apple-mobile-web-app-capable`、`apple-touch-icon` link | `index.html` head 僅 viewport/theme/manifest |
| Icons purpose | 單一 icon 標 `"any maskable"`（規範建議 **分開** any / maskable） | `manifest.webmanifest:17-24` |
| `start_url` | `./index.html` | `manifest.webmanifest:6` |
| `orientation` | `any`（利於橫向） | `manifest.webmanifest:11` |

### 5.2 PWA 問題清單

| ID | 等級 | 標籤 | 問題 | 證據 |
|----|------|------|------|------|
| **M-W1** | **P1** | RISK | **產品內零安裝引導**：Android Chrome 可能顯示瀏覽器選單安裝，多數玩家不知；iOS 必須「分享 → 加入主畫面」且完全無文案 | 無 `beforeinstallprompt` handler |
| **M-W2** | **P1** | RISK | **iOS 缺少 apple-touch-icon／web-app meta**：加到主畫面可能用縮圖截圖、啟動體驗差 | `index.html:1-20` vs 常見 PWA 模板 |
| **M-W3** | **P1** | RISK | standalone 啟動後 **safe-area 未處理**（與 M-H1 疊加）：劉海／底部橫條遮 HUD 與 sticky 控制 | 見 §4 |
| **M-W4** | **P2** | RISK | `install` 時 `skipWaiting()` 立即接管 + 客戶端 15s auto-reload：若玩家戰鬥中更新，可能**強制重整斷局**（非存檔崩潰，但是體驗事故） | `sw.js:100`；`index.html:966-1034` |
| **M-W5** | **P2** | NOTE | icon `purpose: "any maskable"` 合併：遮罩裁切可能切到圖示邊緣 | `manifest.webmanifest:17-24` |
| **M-W6** | **P2** | NOTE | 無 manifest `screenshots`／`categories`：商店式 install UI 資訊較貧 | `manifest.webmanifest` 全文 |
| **M-W7** | **P2** | PASS | 離線殼與更新檢查路徑完整，**可安裝性技術底線達標**（Chromium installability 大致 OK） | `sw.js` + `manifest.webmanifest` |

---

## 6. P0–P2 總表（執行優先序）

### P0（主路徑精準度）

| ID | 主題 | 摘要 | 主要錨點 |
|----|------|------|----------|
| **M-T1** | 觸控 | 直式手機格位 **~17–20 CSS px**，遠低於 44px；精準建塔／選塔不可靠 | `src/config.js:150`；`index.html:624`；`src/game.js:2293-2363` |

### P1（高頻手機痛點）

| ID | 主題 | 摘要 | 主要錨點 |
|----|------|------|----------|
| **M-T2** | 升級流 | 選塔後升級／賣出埋在 panel 底部，戰鬥中折返成本極高 | `index.html:657, 757-761`；`src/ui.js:1031-1057` |
| **M-T3** | 誤觸 | 升級／賣出 40px；賣出誤觸代價高 | `index.html:256-258` |
| **M-T4** | 英雄 | 點選半徑 CSS ~9px；易誤觸／難駐守 | `src/game.js:2353-2358` |
| **M-T5** | 技能 | 單點施放無確認 | `src/game.js:2338` |
| **M-P1** | 效能 | 固定 960×640 內部繪製 | `index.html:718`；`src/game.js:15-17` |
| **M-P2** | 效能 | `shadowBlur` 粒子／子彈／塔光 | `src/game.js:2049, 2225-2287` |
| **M-P3** | 效能 | 建塔全格 highlight 每幀 | `src/game.js:1911-1934` |
| **M-P4** | 效能 | Boss 大爆裂頂 cap | `src/game.js:1579-1584, 79-82` |
| **M-P5** | 效能 | auto 降級過敏（1 秒樣本） | `src/game.js:367-374` |
| **M-H1** | HUD | 無 safe-area | `index.html:5, 42-47, 209-212, 660-668` |
| **M-H2** | 版面 | canvas 46dvh 戰場過小、panel 資訊過長 | `index.html:624`；`src/ui.js:889-908` |
| **M-H3** | HUD | sel-panel 非 sticky | `index.html:657` |
| **M-W1** | PWA | 無安裝 CTA／教學 | （缺碼） |
| **M-W2** | PWA | 無 iOS apple 標籤／touch icon | `index.html` head |
| **M-W3** | PWA | standalone + 無 safe-area | 同 M-H1 |

### P2（邊角與 debt）

| ID | 主題 | 摘要 | 主要錨點 |
|----|------|------|----------|
| **M-T6** | 建塔 | 無點空白取消；ghost 殘留 | `src/game.js:2322-2329, 2458` |
| **M-T7** | 手勢 | 橫滑清單 × 直滑 panel | `index.html:630-636` |
| **M-P6–P8** | 效能 | 無 culling、path 重畫、slow-mo 粒子堆積 | `src/game.js:1663-1673, 1888-1901` |
| **M-H4–H9** | UI | 藏 meta、log 過扁、toast 位置、禁止縮放、RWD 測試未覆蓋觸控尺寸 | 見 §4.2 |
| **M-W4–W6** | PWA | 戰鬥中 auto-reload、icon purpose、manifest 貧 | `sw.js:100`；`index.html:966-1034`；`manifest.webmanifest` |

---

## 7. 建議修復順序（給後續實作輪，非本輪）

1. **P0 觸控吸附／放大 hit**（不先改數值平衡也能大提升可玩性）。  
2. **選塔工具列 sticky**（升級／賣出／取消）貼齊 `hud-core`。  
3. **`viewport-fit=cover` + safe-area padding**（body、hud-core、pwa-update-toast）。  
4. **手機預設或首次引導：效能 auto + 減少特效**；low 模式關閉 shadowBlur。  
5. **PWA 安裝區塊**（Android `beforeinstallprompt` + iOS 步驟說明 + apple-touch-icon）。  
6. 可選：手機降內部解析度（例如短邊 640 邏輯寬）或降低建塔 preview 成本。

---

## 8. 測試缺口（監工備註）

| 現有 | 未覆蓋 |
|------|--------|
| `scripts/test-rwd-matrix.js` 9 視口：不溢出、頁不捲 | 格位 CSS 尺寸、44px 規則、雙點建塔、選塔後升級可見性 |
| `scripts/test-td-e2e.js` 粒子 cap／reduced／touch 部分流程 | 真實裝置 FPS、Boss 波 thrash、standalone safe-area、beforeinstallprompt |
| 無 | iOS Safari 主畫面啟動、橫向單手、拇指熱區熱圖 |

建議新增守門（概念）：在 390×844 斷言 `cellCssSize = 48 * canvas.clientWidth/960 >= 28`（或業務自訂門檻），以及「選塔後 `#selPanel` 與 viewport 相交或 sticky」。

---

## 9. 結語

td-r55-v1 在 **PWA 技術殼、RWD app-shell、觸控雙點建塔、效能 auto／粒子 cap** 上已有桌機移植級的底子；以**手機玩家每天滑手遊的標準**審，最大斷點是：

1. **戰場格位只有 ~18px**（P0），  
2. **升級流不在拇指熱區**（P1），  
3. **notch／Home 條與安裝引導未當一等公民**（P1）。

**本文件只審不改。** 實作請另開 Codex／修復輪，並用本表 ID 對帳。
