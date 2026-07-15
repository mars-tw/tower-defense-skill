# 《無盡塔防》td R66 控制可達性硬化報告

R66 已完成底部控制可達性硬化。版本提升為 `0.6.6`，PWA 快取版本為 `td-r66-v1`。

## 修復重點

- 窄寬裝置底部建塔 dock 改為 10 塔兩列常駐，不再依賴橫向捲動才能點到後段塔。
- 速度、暫停、設定與開始鈕命中尺寸補齊到至少 44px；技能鈕與建塔鈕維持 44px 以上。
- `.scene-controls` 提升至 `z-index: 90` 並保留 `pointer-events: auto`，確保 dock/技能盤在 canvas 與側欄之上可命中。
- 右側面板維持自身內捲；常用操作保留在底部控制盤，不依賴側欄捲動。
- 新增 `scripts/test-r66-controls.js`，並接入 `npm run test:e2e`，逐一檢查 1920x1080、1440x780、1366x600、1280x640、390x844。

## 守門範圍

R66 守門逐視口檢查：

- `diffOverlay` 難度選項中心在視口內，且 `elementFromPoint` 命中該按鈕。
- `mapOverlay` 地圖選項中心在視口內，且 `elementFromPoint` 命中該按鈕。
- 進遊戲後 10 顆建塔 dock 鈕、5 顆技能鈕、開始/速度/暫停/設定鈕皆為 44px 以上、中心在視口內、中心 hit-test 命中自身。
- 控制鈕互不重疊，且不需要頁面捲動或水平溢出。

## Evidence

- `docs/evidence/R66_controls/desktop-1366x600-controls.png`
- `docs/evidence/R66_controls/laptop-1280x640-controls.png`
- `docs/evidence/R66_controls/mobile-390x844-controls.png`

## 驗證

- `node scripts/test-r66-controls.js`：PASS
- `npm run test:rwd`：PASS
- `npm test`：PASS
- `npm run test:e2e`：PASS
- 秘密掃描：`grep -rniE --exclude-dir=.git --exclude-dir=node_modules "sk-proj-[A-Za-z0-9_-]{20}|sk-[a-z0-9]{40}" .` 零命中
