實作者：Codex（GPT-5）

# CODEX_RESPONSE R76

2026-07-20。R76 已完成 PLAYTEST-R1 的兩項 P1 修正；TD-R1-03 平衡議題依指定只進 backlog，未改戰鬥數值。

## P1 修正與驗證

| ID | 修法 | 驗證結果 |
|---|---|---|
| TD-R1-01 | `syncR71ModalState()` 不再把 `#nextWaveCard .enemy-chip-row` 與 `#enemyInfo` 納入 advisor modal 的 inert 範圍；戰場、其他抽屜、詞綴卡與非互動塔種建議仍維持互鎖。詳情區補 `role=status / aria-live=polite`。 | 固定 `runSeed=4 / affixSeed=777`，390×844 與 844×390 分別真實 `touchscreen.tap` 史萊姆／哥布林／焰蝠。六次結果皆 `rowInert=false`、按鈕 active、詳情可見，且文字含血量／元素／特性／反制；顧問控制與背景 modal 互鎖守門同時全綠。 |
| TD-R1-02 | 結算新增 `#mainMenuBtn`。點擊後關閉結算、`TD.newGame()` 重置本局與英雄部署狀態，再開啟既有難度選擇；玩家可重新選難度與地圖。 | 844×390 控制守門把結算 EXPECTED CTA 數由 2 更新為 3，三顆皆可捲達且 `elementFromPoint` 命中。真實 click 後三種證據視口皆為 `overlay=false / diffOverlay=true / mapOverlay=false / wave=0 / over=false`；完整 td-e2e 的 1280×900、768×1024、390×844 亦全數通過。 |

## TD-R1-03 Backlog

正常難度第 3–5 波經濟與首 Boss 壓力未在本輪調整。`docs/OPTIM_PLAN_R76.md` 已記錄固定 seed 多局統計需求（清波金錢、塔總投資、漏怪、女神 HP、Boss 擊殺時間與失守率）；資料完整前不以單局觀感改係數。

## 閘門結果

- `npm test`：PASS，10 支單元／模擬／動畫契約鏈，exit 0。
- `npm run test:e2e`：PASS，R72 map loading → R66 控制／R76 真 tap → R68 map visibility → td-e2e 單次連跑，exit 0，599.2 秒。
- 控制守門：PASS。390×844 與 844×390 三徽章真 tap；844×390 三顆結算 CTA 與回主選單狀態；既有 R71/R75/R66 斷言全綠。
- R72 Fast 3G/4×：最終完整鏈 desktop 4908.5ms ≤ 5971.8ms，mobile 4930.9ms ≤ 5371.6ms。第一次全鏈取樣受 98–99% 全機負載與本輪孤兒 headless Chromium 污染而超標；清理可歸因程序後以原門檻重跑、再跑完整鏈均通過，沒有放寬守門。
- `npm run test:rwd`：PASS，9 視口×主畫面／設定共 18 組零違規、頁捲 0、水平溢出 0，exit 0。
- 版本鏈：`0.7.6 / td-r76-v1`。`package.json`、`package-lock.json`、README、HTML manifest/script query 與 PWA 常數、SW cache/app shell、UI fallback、版本守門一致；執行面 `0.7.5|td-r75-v1` grep 0。
- 秘密掃描：排除 `.git`、`node_modules`、使用者提供的 `docs/audit_openclose` 與 `docs/playtest`，`sk-proj / sk-40 / xai` 模式 0 命中。
- `git diff --check`：PASS。

## 證據

- `docs/evidence/r76/before/`：390×844、844×390 真 tap 均為 `rowInert=true / detailShown=false`；三種視口結算均無回主選單。
- `docs/evidence/r76/after/`：兩種手機尺寸三徽章各自詳情截圖與 `measurements.json`；390×844、844×390、1366×768 的結算 CTA 與返回難度選單截圖。
- `docs/evidence/r76/guard/`：R72、R66／R76 控制守門截圖與量測。歷史 evidence 未覆寫。

## 殘留

- TD-R1-03 仍為 P2 backlog，待固定 seed 多局平衡統計。
- 本機 `audiodg` 長期高 CPU 是既有環境噪音；本輪最終原門檻完整鏈已通過，未因此調整遊戲碼或門檻。
- 未新增獨立「換難度／換地圖」結算鈕；`回主選單` 已直接進入難度選擇，下一步即可換難度與地圖，因此不再增加重複 CTA。
