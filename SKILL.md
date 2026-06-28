---
name: tower-defense
description: 快速製作純原生（零依賴）Canvas 2D 無盡塔防遊戲。當使用者想做塔防、tower defense、守城、放置砲塔擋怪物的網頁遊戲時觸發。提供可直接執行的單頁遊戲，含多種砲塔升級、元素克制、主動技能、無盡隨機波次與 Boss 戰，並用統一設定檔串接 Grok CLI 生成美術。
when_to_use: 觸發語句包含「做一個塔防」「tower defense」「守城遊戲」「放砲塔擋怪」「無盡波次」「塔防遊戲技能」。
shell: powershell
---

# 無盡塔防遊戲快速製作 (tower-defense)

在幾分鐘內生出一個**可直接在瀏覽器執行**的 Canvas 2D 塔防遊戲。
技術路線**純原生**：HTML + CSS + 原生 JavaScript + Canvas 2D，零框架、零建置、零 npm。

## 何時用這個 skill

當使用者要做塔防類遊戲：怪物沿路徑前進、玩家放砲塔攔截、守護女神。本模板特色：

- **守護女神核心**：終點站著要守護的女神，怪物漏過攻擊她，可花金升級（加生命、解鎖聖光反擊）
- **無盡隨機波次**：一波波無限生成、難度遞增、Boss 波、比拼最高波數
- **多種砲塔 + 升級**：弓箭(單體)、加農砲(範圍)、寒冰塔(減速)、電磁塔(穿透)，可升 6 級，外觀隨等級變化
- **元素克制 + 塔協同**：火/冰/雷互克；被減速/冰凍的敵人受傷 +25%（救活寒冰塔）
- **可抽卡英雄**：抽英雄上場，地圖自走打怪、自我升級、四方向精靈圖，可指定駐守點
- **主動技能**：隕石、冰封、雷暴，有冷卻，緊急時手動施放
- **三難度模式**：普通(主流可過)/嚴酷/無盡煉獄，難度當社群鉤子（值得寫攻略）
- **特殊事件波**：狂奔/精英/蟲潮/寶藏波，打破單調、製造驚喜
- **Meta 進度**：最高紀錄、魂晶、連殺 combo、暫停、低血告警、死亡分享戰績

## 專案結構

```
tower-defense/
├── SKILL.md
├── art-config.json           # ★ 美術生成設定（砲塔/怪物/技能提示詞）
├── index.html                # 遊戲頁面 + HUD/UI 樣式
├── src/
│   ├── config.js             # ★ 資料層：塔/怪/技能/元素克制/平衡參數
│   ├── game.js               # 核心引擎：Canvas 渲染、遊戲迴圈、波次、戰鬥
│   └── ui.js                 # HUD、建塔選單、技能列、升級面板
├── assets/{towers,enemies,skills}/  # 美術圖（生成後放這）
├── scripts/gen-art.ps1       # 用 Grok 批次生成美術
└── references/data-model.md  # 加塔/加怪/調平衡說明
```

## 快速開始（玩現成的）

```bash
# 在 tower-defense 根目錄起 server
python -m http.server 8000
# 開 http://localhost:8000/index.html
```

玩法：選砲塔 → 點地圖空格建造（不能蓋路徑上）→ 點「開始下一波」→
塔自動攻擊怪物 → 賺金錢升級/蓋更多塔 → 撐越多波越高分。

> ⚠️ 用 HTTP server 開（不要 file://），server 開在 `tower-defense/` 根目錄。

## 核心設計原則（改動時請遵守）

1. **`config.js` 是資料層**：塔、怪、技能、元素克制、平衡都在這，改這裡即可調整。
2. **美術接點零侵入**：`game.js` 的 `drawSprite` 優先用 `assets/<group>/<id>.png`，
   沒有才用 emoji。接美術不需改邏輯。
3. **無盡波次核心**：`startWave()` 依波數算血量成長與敵人組成，`bossEveryWaves` 控 Boss 頻率。
4. **元素克制**：`elementMultiplier(atk, def)` 回傳傷害倍率（克制 1.5、被克 0.66）。
5. **零依賴**：純 Canvas 2D，不引入任何套件。

## ⭐ 視覺基線（生成新塔防時必套，否則會很醜）

這些是**預設要做的**，不是選配。greybox（純色塊）版本不可接受：

1. **設計系統色階**：CSS 變數定義 3 階 surface（`--surface-0/1/2`）+ 統一陰影
   （`inset 0 1px 0 rgba(255,255,255,.05), 0 4px 12px rgba(0,0,0,.35)`）+ 柔邊框
   （`rgba(255,255,255,.07)`）。強調色（綠/金）只用在 CTA，不當大面積背景。
2. **互動態**：所有按鈕 `:hover` 提亮 + `:active{transform:translateY(1px)}`，
   觸控目標 `min-height:44px`。
3. **打擊回饋**（爽感 CP 最高）：傷害浮動數字（克制時放大變紅），命中 glow 圓點粒子 +
   擴張環，粒子帶重力。子彈用投射物圖、朝飛行方向旋轉。
4. **Canvas 場景深度**：背景 radial vignette、路徑描邊分層、血條圓角漸層 + 外框、
   所有 canvas 文字先 `strokeText`（黑描邊）再 `fillText`。
5. **美術去背**：素材方塊背景用 `getImg` 的去背處理融入場景（地圖滿版磚塊用 `noBg`）。

## 🎮 爽感與深度必備（讓「玩一次」變「再玩一次」）

生成時這些是**預設機制**，缺了就不算「超好玩」：

1. **Meta 進度 loop**（最大留存）：結算面板顯示本局波數、`localStorage` 存 `bestWave`，
   破紀錄慶祝、每局產出魂晶（可規劃永久升級）。HUD 顯示歷史最高。
2. **輸出對抗碾壓**：波獎勵指數成長（`base * growth^wave`）給金錢出口，塔開放 6 級，
   血量分段成長（前期 0.15、後期 0.10）。**改完跑 `scripts/sim-balance.js` 驗證撐波 ≥20。**
3. **新手引導 + 資訊透明**：首次 3 步引導 overlay（存 localStorage）、塔/英雄按鈕補關鍵數值、
   元素 chip 顯示克制（🔥火 ❄️冰 ⚡雷 · 克X）。
4. **元素克制要「看得見」**：不只程式有，UI 要呈現（塔按鈕元素標、敵人元素提示）。
5. **連殺/回饋**：擊殺有粒子噴濺，可加 combo 連殺倍率（接打擊數字基礎設施）。

## 加塔 / 加怪 / 調平衡

改 `config.js` 即可，細節見 [references/data-model.md](references/data-model.md)：
- 加砲塔：在 `TOWERS` 加一筆（range/damage/fireRate/cost/element/特殊效果）
- 加怪物：在 `ENEMIES` 加一筆（hp/speed/reward/element）
- 調難度：改 `GAME.hpGrowthPerWave`（波血量成長）、`bossEveryWaves` 等

## 生成美術

```powershell
cd tower-defense
.\scripts\gen-art.ps1 -DryRun        # 預覽
.\scripts\gen-art.ps1                  # 生成全部
.\scripts\gen-art.ps1 -Group towers    # 只生砲塔
```
生完圖檔自動放到 `assets/<group>/<id>.png`，遊戲會自動載入。

## 驗證遊戲可玩

起 server → 開 index.html → 建幾座塔貼著路徑 → 開始波次 → 確認塔射擊、敵人扣血死亡、
金錢增加、波次循環。Console 只有 favicon/未生成圖的 404 屬正常（會 fallback 到 emoji）。

> 測試提示：`window.TD` 暴露 `state()`、`startWave()`、`selectTower()` 等接口可程式化驗證。
