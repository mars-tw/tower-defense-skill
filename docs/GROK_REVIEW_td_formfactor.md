# 《無盡塔防》Form Factor 偵測監工快掃 — Grok（td formfactor）

| 項目 | 內容 |
|------|------|
| 文件代號 | `GROK_REVIEW_td_formfactor` |
| 範圍 | 手機優化輪（**36px 格位**／**浮動升級面板**）是否存在「**偵測到觸控就套手機版面、不看視口**」bug；平板與觸控筆電是否誤套跑版 |
| 審查者 | Grok（form factor 監工） |
| 日期 | 2026-07-13 |
| 原則 | **只審不改**；結論附**檔案:行號**；優先級 P0–P2 |
| 驗收口令 | **純 CSS media query → PASS**（使用者指定） |

**結論標籤**

| 標籤 | 含義 |
|------|------|
| **PASS** | 版面切換不依觸控能力，僅依視口（或更安全條件） |
| **BUG** | 有觸控（或 UA／`maxTouchPoints` 等）就套手機版面，且未看視口 |
| **RISK** | 非該 bug，但視口門檻可能讓平板／窄窗桌機「看起來像手機殼」 |
| **NOTE** | 輸入路徑、測試基建、設計取捨 |

---

## 0. 總評（先講人話）

| 檢查項 | 結論 | 等級 |
|--------|------|------|
| 是否「有觸控 → 手機版面」且不看視口？ | **無此邏輯** | — |
| 36px 格位 fortify 如何觸發？ | **純 CSS** `@media (max-width: 560px) and (orientation: portrait)` | — |
| 浮動升級面板如何觸發？ | **純 CSS** `@media (max-width: 900px)` 內 `.sel-panel { position: fixed; … }` | — |
| 平板／觸控筆電會否因「能觸控」誤套？ | **否**；版面只看寬高／方向 | — |
| **本票驗收** | **PASS** | — |

**一句話**：近期手機優化輪的 **36px 格位**與**浮動升級面板**皆綁在 **CSS 視口 media query**，程式碼中**沒有** `maxTouchPoints`／`ontouchstart`／`pointer: coarse`／`isMobile` class 去切 layout。觸控只影響 **canvas 建塔是否二次確認**（輸入），不改版面。依口令 **純 CSS media query → PASS**。

**本輪未改任何程式。**

---

## 1. 偵測邏輯盤點

### 1.1 版面（form factor）— 純 CSS，依視口

來源：`index.html` RWD 區塊（約 597–744 行）。**無 JS 讀取觸控能力後 `classList` 切版面。**

| 斷點 | 條件 | 主要版面效果 | 與本輪優化關係 |
|------|------|--------------|----------------|
| 桌機側欄 | `(min-width: 901px)` | wrap 不折、側欄 216px、canvas 依剩餘寬縮；`.sel-panel` 在文件流 `order: 23` | 寬視口 **不** 套手機 fortify／浮動面板 |
| 窄殼（平板＋手機） | `(max-width: 900px)` | 直向 stack、canvas `max-height: 46dvh`、清單橫滑、**`.sel-panel` → `position: fixed` 底部浮動**、按鈕 `min-height: 48px`、`.hud-core` sticky | **浮動升級面板** |
| 手機直式 fortify | `(max-width: 560px) and (orientation: portrait)` | `#battlefieldScroll` 可雙軸捲；canvas **固定 CSS 寬 724px**（960 邏輯寬 ÷ 48 格 → 格邊 ≈ **36.2 CSS px**）、`touch-action: pan-x pan-y` | **≥36px 格位** |
| 矮橫向 | `(max-width: 900px) and (max-height: 520px)` | wrap 改 row、canvas 靠左限寬 | 橫向手機殼 |
| 極窄字級 | `(max-width: 560px)` | 隱藏 hotkey／meta、縮小字 | 排版緊湊（與 fortify 獨立，無 orientation） |

關鍵片段對照：

```702:710:index.html
  /* 手機直式 fortify 戰場：每格至少 36 CSS px，戰場視窗以手指平移。 */
  @media (max-width: 560px) and (orientation: portrait) {
    .battlefield-scroll { ... overflow: auto; ... }
    .battlefield-scroll canvas { width: 724px; min-width: 724px; max-width: none; max-height: none;
      align-self: flex-start; touch-action: pan-x pan-y; }
  }
```

```684:688:index.html
    .sel-panel { order: 22; position: fixed; left: max(8px, env(safe-area-inset-left));
      right: max(8px, env(safe-area-inset-right)); bottom: max(10px, env(safe-area-inset-bottom));
      z-index: 42; max-width: 520px; max-height: min(42dvh, 290px); margin: 0 auto;
      overflow-y: auto; ... }
    .sel-panel button { min-height: 48px; }
```

（以上位於 `@media (max-width: 900px)` 區塊內，`index.html:644-700`。）

### 1.2 已搜尋、**未用於版面**的觸控／裝置 API

全專案（`src/*`、`index.html`，排除 `node_modules`）針對常見「觸控→手機殼」指紋：

| API／模式 | 是否出現 | 用途 |
|-----------|----------|------|
| `navigator.maxTouchPoints` | **無** | — |
| `'ontouchstart' in window` | **無** | — |
| `matchMedia('(pointer: …)')` / `(hover: …)` / `(any-pointer: coarse)` | **無** | — |
| `isMobile` / `hasTouch` 寫入 DOM class | **無**（僅測試腳本 Playwright context） | — |
| `matchMedia('(prefers-reduced-motion: reduce)')` | 有 | 特效降級，**非** form factor — `src/game.js:107,115` |
| `matchMedia('(display-mode: standalone)')` | 有 | PWA 安裝鈕顯示 — `index.html:1004` |
| UA `/iphone\|ipad\|ipod/i` | 有 | **僅** iOS「加入主畫面」安裝入口顯示 — `index.html:1005-1006`；**不改 layout** |

### 1.3 觸控只影響「輸入確認」，不影響「版面殼」

| 路徑 | `isTouch` | 建塔行為 | 版面 |
|------|-----------|----------|------|
| `click` | `false` | 單次建塔 | 不變 |
| `touchend`（未拖 >10px） | `true` | **二次點同一格**才建 | 不變 |

證據：`src/game.js:2682`（`if (!isTouch) tryBuildTower…`）、`:2728`（click → false）、`:2743-2748`（touchend → true）。

因此：**觸控筆電用手指建塔會二次確認，但視口 ≥901px 時仍是桌機側欄版面**；用滑鼠／觸控板則單點建塔。這是輸入 UX 分岔，**不是**「有觸控就套 36px／浮動面板」。

---

## 2. 判斷條件一覽（決策樹）

```
視口寬度 W、高度 H、orientation
│
├─ W ≥ 901px
│    → 桌機殼：側欄 + 文件流 sel-panel
│    → 不套 36px fortify、不套浮動升級
│
├─ W ≤ 900px
│    → 窄殼：直向 stack + **浮動 fixed sel-panel** + sticky HUD
│    │
│    ├─ 且 H ≤ 520px → 橫向矮殼（canvas｜panel 並排）
│    │
│    └─ 且 W ≤ 560px
│         ├─ portrait → **724px canvas + 可捲戰場（≈36px 格）**
│         └─ landscape → 無 fortify（僅 ≤560 字級緊湊規則仍可能套用）
│
└─ 觸控能力（maxTouchPoints / touch 事件存在）
     → **不進入任何 layout 分支**
```

**格位 36px 算式（條件滿足時）**

| 量 | 值 |
|----|-----|
| 邏輯 canvas | 960×640（`index.html` canvas 屬性；`GAME` 世界座標） |
| 邏輯格 | 48 px（config `cellSize`） |
| fortify CSS 寬 | 724 px |
| CSS 格邊 | `724 / (960/48) = 724/20 = **36.2** px` |

---

## 3. 誤傷情境分析

### 3.1 本票 bug：「觸控就套手機版、不看視口」

| 裝置情境 | 觸控？ | 視口假設 | 是否套 36px fortify | 是否套浮動升級 | 是否本票 bug 誤傷 |
|----------|--------|----------|---------------------|----------------|-------------------|
| 桌機滑鼠 1920×1080 | 否 | 寬 | 否 | 否 | 否 |
| 觸控筆電全螢 1920×1080 | **是** | 寬 | **否** | **否** | **否（PASS）** |
| 觸控筆電半窗 500×900 portrait | 是 | 窄直 | **是** | 是 | 否 — **因視口**，非因觸控 |
| iPad 820×1180 | 是 | ≤900 且 >560 | **否** | **是**（窄殼） | 否 — 無 fortify；浮動面板依寬度 |
| iPad 768×1024 | 是 | 同上 | **否** | **是** | 同上 |
| iPhone 390×844 | 是 | ≤560 portrait | **是** | 是 | 預期行為 |
| 僅滑鼠的窄窗 400×700 | 否 | ≤560 portrait | **是** | 是 | 否 — 證明切殼**不需觸控** |

**結論**：找不到「有觸控才套、無觸控不套」的 layout 分岔；誤套若發生，必為 **視口斷點** 觸發，而非觸控偵測。

### 3.2 相關但非本票：視口門檻本身的「像手機」體感（NOTE／RISK 輕）

這些**不是**「偵測觸控」bug，但監工一併標出，避免與跑版投訴混淆：

| ID | 等級 | 標籤 | 情境 | 說明 |
|----|------|------|------|------|
| **FF-V1** | P2 | NOTE | iPad／小筆電瀏覽器寬 **≤900** | 會得**浮動升級面板**與橫滑清單，屬窄殼設計；**不會**固定 724px 戰場（需 ≤560 portrait） |
| **FF-V2** | P2 | NOTE | 桌機／觸控筆電視窗拖到 **≤560 且直式** | 會得 36px fortify 與平移戰場；使用者可能覺得「突然變手機」，但條件是視口，**符合 RWD 預期** |
| **FF-V3** | P2 | NOTE | `orientation: portrait` 在部分平板旋轉／分割畫面 | fortify 進出依賴 orientation + 560；旋轉後取消 724 固定寬屬預期 |
| **FF-I1** | P2 | NOTE | 觸控筆電用**手指**建塔 | 走 `touchend` → 二次確認；版面仍依寬度。可能被誤報成「進了手機模式」，實為**輸入**差異 |
| **FF-T1** | P2 | NOTE | `scripts/test-rwd-matrix.js:115-119` | Playwright 對 mobile／landscape 設 `hasTouch`/`isMobile`；**僅測試模擬**，不進產品 runtime |

### 3.3 與 UA 的界線

`index.html:1005-1006` 用 iOS UA 顯示安裝鈕：可能把 **iPadOS 桌面模式 UA** 與真實 iPhone 混在「顯示安裝提示」上，但**不切 form factor**。本票不記為 layout bug。

---

## 4. 修法（若日後要防呆／收斂斷點）

本票 **無需修**（PASS）。下列僅供後續產品取捨，**非本輪必做**：

| 目標 | 建議 | 備註 |
|------|------|------|
| 維持現狀 | 繼續只用 CSS `@media` 寬高／方向 | 已符合「不看觸控看視口」 |
| 平板想保留側欄、不要浮動面板 | 將浮動 `.sel-panel` 再收窄，例如 `(max-width: 600px)`，或 `(max-width: 900px) and (hover: none) and (pointer: coarse)` **並仍以寬度為主** | 若加 pointer media，**必須**與寬度 AND，避免「筆電觸控＝手機」；單用 coarse **會重踩本票 bug** |
| 36px 僅真·手機 | 維持 `560 + portrait` 已相當保守；可再加 `max-height` 若擔心超高窄窗 | 勿改成 touch 偵測 |
| 輸入與版面語意分離 | 文件化：「二次確認＝觸控事件，≠手機殼」 | 減少客服／測試誤判 |
| 測試補強 | RWD 矩陣可加一列：`hasTouch: true` + viewport 1920×1080，assert **無** 724px canvas、**無** fixed sel-panel | 回歸鎖住本票 |

**反模式（禁止當「修法」）**

```text
if (navigator.maxTouchPoints > 0) document.body.classList.add('mobile');
// 或 matchMedia('(pointer: coarse)') 單獨切 36px / 浮動面板
```

以上會讓 Surface／觸控筆電全螢桌機誤套手機版——**正是本票要排除的 bug**。

---

## 5. 與測試／文件對照

| 來源 | 內容 | 與本審關係 |
|------|------|------------|
| `docs/CODEX_RESPONSE_td_mobile.md` | 直式 724px → 36.2 CSS px；≤900 fixed 升級；桌面／橫向規則不變 | 實作與文件一致；斷點為**視口** |
| `scripts/test-config.js:138-139` | 靜態 assert 含 `724px`、`battlefield-scroll`、`pan-x pan-y` | 鎖 CSS 存在，不驗「非觸控觸發」 |
| `scripts/test-rwd-matrix.js:130-152` | 僅在 `vp.kind === "mobile"` 驗格位≥36、可捲、浮動升級 | 手機路徑有 guard；**未**反向證明桌機+touch 不觸發 |

---

## 6. 終裁

| 問題 | 答案 |
|------|------|
| 有沒有「偵測到觸控就套手機版面不看視口」？ | **沒有。** |
| 36px 格位／浮動升級靠什麼？ | **純 CSS media query（視口寬高＋portrait）。** |
| 平板／觸控筆電會因「能觸控」誤套跑版？ | **不會因觸控誤套。** 僅在視口落入 ≤900／≤560 時套對應殼。 |
| 驗收 | **PASS**（符合「純 CSS media query 就 PASS」） |
| 程式變更 | **無**（只審不改） |

**優先級彙總**：本票 **0 個 P0/P1 layout-formfactor bug**；僅 P2 NOTE（視口體感、輸入二次確認語意、測試可加反向 guard）。
