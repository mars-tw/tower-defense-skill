# R72 Style board｜戰術地圖碑

## 主題與單一任務

- 主題：末日聖域軍議桌上的三塊「戰術地圖碑」。
- 對象：準備開局、需要快速分辨地形與資源差異的塔防玩家。
- 單一任務：在不暗示新關卡／解鎖的前提下，看一眼就分辨既有三圖並完成選擇。

## 視覺 token

- `Sanctum Black #06100B`：overlay 與不透明安全底。
- `War-table Umber #25180F`：卡框與路徑陰影。
- `Relic Brass #D8A34A`：選取框、刻度與 loading 進度。
- `Parchment Light #F2E4BE`：主要文字。
- `Plains Emerald #2E7D4F`：翠綠平原識別。
- `Canyon Cinnabar #A65A32`：迂迴峽谷識別。
- `Lava Ember #C6422C`：熔岩峽道識別。

字體角色：地圖名用 `Noto Serif TC / Microsoft JhengHei / serif` 的碑銘感；描述沿用 `Segoe UI / Microsoft JhengHei / sans-serif`；資源／節點資料用 `Consolas / SFMono-Regular / monospace`。不新增外部字型下載。

## 版面

桌機：

```text
┌────────────── 選擇戰場 ──────────────┐
│ [ 2:1 地圖碑／路徑焦點 ] [名稱／描述] │
│ [ 2:1 地圖碑／路徑焦點 ] [名稱／描述] │
│ [ 2:1 地圖碑／路徑焦點 ] [名稱／描述] │
└──────── 現有三圖提示／無解鎖 ────────┘
```

手機與矮橫向：卡片維持緊湊圖文並列，確保三張既有地圖同屏且命中區 ≥44px；loading 以同源 16:9 圖滿版，文字放在不透明漸層安全板上。

## Signature 與自我檢查

- Signature：每張圖都有一條從左至右、縮圖仍可讀的「刻印路徑帶」，選取時 brass route pulse 只沿卡框，不做散亂粒子。
- 刻意風險：把 selector 做成軍議桌的地圖碑，而非一般 thumbnail gallery；風險由克制的其餘 UI、現有世界觀色票與零新增內容控制。
- 已移除：額外徽章、鎖頭、星等、關卡編號與大面積光暈，避免誤導為新解鎖或搶走路徑焦點。
