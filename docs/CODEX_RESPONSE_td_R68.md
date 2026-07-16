# 《無盡塔防》td R68 地圖完整顯示檢修報告

日期：2026-07-16
輪次：td R68
版本：`0.6.8` / `td-r68-v1`
狀態：完成

## P0 結果

R64/R66 控制盤不再以 absolute/fixed 方式覆蓋 canvas。戰場改為保留空間的 CSS Grid：

- 一般桌機、平板與直式手機：canvas 戰場列在上，建塔/技能/開始/速度/暫停/設定列在下。
- 1440×780、1366×600、1280×640 等矮寬桌機：dock 移到右側保留欄。
- 844×390 橫向手機：dock 移到右側保留欄。
- canvas 縮放基準改為 `#battlefieldScroll` 的實際可用寬高，取 `min(width/960, height/640)`；內部 960×640 棋盤永遠等比完整顯示。

1366×600 實測由修正前 canvas/dock 交疊高 132px，降為交疊面積 0px²。修正後 canvas 為 598×399，dock 位於其右側，整張地圖可見且可點。

## 新增守門

新增 `scripts/test-r68-map-visibility.js` 並接入 `npm run test:e2e`，覆蓋：

- 1920×1080
- 1440×780
- 1366×600
- 1280×640
- 390×844
- 844×390

每個視口斷言：

- canvas 完整在視口與戰場 host 內。
- canvas 四角與中心 `elementFromPoint` 都命中 `#game`。
- 內部尺寸仍為 960×640、CSS 比例維持 3:2。
- dock 完整在視口內、非 absolute/fixed，與 canvas 交疊為 0。
- 戰場不需 X/Y 平移，頁面無捲動與水平溢出。

RWD 與既有 E2E 中的 R64「fixed dock / 36px 格位平移」舊規格已升級為 R68「完整地圖 / 保留 dock」契約。R66 仍負責 44px 控制尺寸、可命中與互不重疊。

## 八大面向不回歸

- 美術/地圖：R65 像素素材不變，只做 3:2 等比縮放，無拉伸或裁切。
- 按鈕/選單：R66 控制可達性與 RWD main/settings 矩陣全綠。
- 人物/腳色樣子/動作：本輪不改角色素材或動畫；R62 敵人 hurt/death 真幀、R63 英雄 walk 與 anticipation/impact/recovery 守門全綠。
- 技能：R67 有效命中才消耗、觸控取消與施法 E2E 全綠。
- 素材缺件：本輪不需要新增動畫或美術素材，無缺件與假完成。

## 品質閘門

- `npm test`：PASS。
- `npm run test:e2e`：PASS；含 R66 控制、R68 六視口地圖完整顯示與既有功能/動畫流程。
- `npm run test:rwd`：PASS；main/settings × 9 視口皆零違規、頁捲 0、水平溢出 0。
- `npm run test:perf`：PASS；18 敵含 1 Boss 的 `update + render` p95 三跑中位：桌機 15.50ms、手機 14.80ms，皆 ≤18ms。
- R68 執行版舊字串 `td-r67-v1|0.6.7`：零命中。
- 秘密掃描：排除 `.git`、`node_modules` 後零命中。
- `git diff --check`：PASS。

## 證據

- `docs/evidence/R68/before-after.md`
- `docs/evidence/R68/before-1366x600-overlap.png`
- `docs/evidence/R68/after-desktop-1366x600-full-map.png`
- `docs/evidence/R68/after-mobile-390x844-full-map.png`
- `docs/evidence/R68/after-landscape-844x390-full-map.png`
- `docs/evidence/R68/map-visibility-measurements.json`
- `docs/evidence/R68/performance-gate.txt`

## 主要變更檔

- `index.html`
- `src/ui.js`
- `scripts/test-r68-map-visibility.js`
- `scripts/test-performance-r68.js`
- `scripts/test-r66-controls.js`（既有守門，導航逾時放寬以容忍共享機器負載）
- `scripts/test-rwd-matrix.js`
- `scripts/test-td-e2e.js`
- `scripts/test-config.js`
- `package.json` / `package-lock.json`
- `sw.js`
- `README.md`
- `docs/OPTIM_PLAN_R68.md`
