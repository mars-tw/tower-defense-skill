# td R67 優化輪報告

日期：2026-07-16  
輪次：td R67  
狀態：完成，待本地 commit

## 本輪完成

1. 主動技能
   - 技能改為「有效命中才消耗 cooldown 與 `skillCasts`」。
   - 空放會顯示提示、保留瞄準狀態，不扣資源。
   - 新增觸控取消按鈕，Escape 與按鈕都可解除 pending skill。
   - 技能有效命中新增多點 impact 粒子、傷害數字與程序化技能音效。

2. 地圖模型
   - `rules.js` 新增 shared `pathBlockedCells()`。
   - `game.js` 實際 blocked path 與塔陣顧問候選格共用同一套 blocked 判定。
   - 新增 R67 規則測試，三地圖、三難度、前 30 波顧問 build action 非法格為 0。

3. 波次曲線
   - 調整普通、嚴酷、無盡的 HP / gold 曲線與 Boss smoothing。
   - 主題敵人選擇改成加權，降低中期突然抽到高壓敵人的尖峰。
   - R67 平衡 gate 固化 W12、Boss 谷底、Boss 後掉落與 survival 目標。

4. 教學與選單
   - 首玩教學升級為 6 步可重訪實戰引導。
   - 覆蓋建塔、元素克制、女神/支援、英雄、詞綴/地圖、主動技能。
   - 設定與工具抽屜都可重新開啟教學；首玩教學不再污染 `paused` 狀態。

5. 音效與設定
   - 新增輕量 WebAudio 程序化音效：建塔、命中、技能、UI、漏怪、清波、Boss。
   - 設定加入音量滑桿與狀態文字。

6. 不回歸項
   - R66 控制守門全綠。
   - R62 敵人真幀動畫、R63 英雄真幀與 attack timing 守門全綠。
   - RWD 9 視口矩陣全綠。

## Before / After

- 顧問非法格：審計基線 Canyon/Lava 每難度各 60 個非法候選；R67 after 為 0。
- W12 尖峰：審計基線 +163%；R67 after +43%。
- Boss 谷底：R67 after 最低 -16%，通過 > -20% gate。
- Boss 後掉落：R67 after 最低 -24%，通過 > -30% gate。
- 生存目標：normal Plains 22 / Canyon 24 / Lava 24，皆達成 >=20；endless Plains 19 / Canyon 18 / Lava 18，皆達成 >=15。

詳細證據：`docs/evidence/R67/before-after.md`

## 驗收結果

- `npm test`：PASS
- `npm run test:e2e`：PASS
  - 內含 R66 controls：1920x1080、1440x780、1366x600、1280x640、390x844 全綠
  - 內含 R67 技能空放/命中/cancel 驗證
- `npm run test:rwd`：PASS
  - 9 視口 main/settings，零違規、頁捲 0、水平溢出 0
- 舊版號 grep：零命中
- 秘密掃描：零命中
- 版本：`package.json` / `package-lock.json` 為 `0.6.7`，PWA cache 為 `td-r67-v1`

## 證據檔

- `docs/evidence/R67/before-after.md`
- `docs/evidence/R67/sim-balance-after.txt`
- `docs/evidence/R67/after-desktop-tutorial.png`
- `docs/evidence/R67/after-tablet-settings-audio.png`
- `docs/evidence/R67/after-mobile-skill-cancel.png`

## 主要變更檔

- `src/game.js`
- `src/rules.js`
- `src/ui.js`
- `src/config.js`
- `index.html`
- `scripts/test-rules.js`
- `scripts/test-td-e2e.js`
- `scripts/sim-balance.js`
- `README.md`
- `package.json`
- `package-lock.json`
- `sw.js`
- `docs/OPTIM_PLAN_R67.md`
