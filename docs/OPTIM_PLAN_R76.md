# OPTIM_PLAN R76（PLAYTEST-R1 P1 修正輪）

2026-07-20。輸入：`docs/playtest/PLAYTEST_R1.md` 與 `docs/playtest/shots/`；本輪不修改或納入上述真人試玩原始資料。

## 本輪實作

| ID | 問題 | 修法 | 驗收 |
|---|---|---|---|
| TD-R1-01 | 手機情報抽屜有塔陣顧問時，`.enemy-chip-row` 的祖先互鎖被設為 `inert`，真實 tap 無法觸發徽章 handler | 顧問 modal 仍鎖住戰場、其他抽屜、詞綴與非互動塔種建議；敵人徽章列及 `#enemyInfo` 留在可操作／可讀範圍，詳情區加 `role=status` 與 `aria-live=polite` | Playwright 固定 `runSeed=4 / affixSeed=777`，在 390×844、844×390 對史萊姆／哥布林／焰蝠各做真實 `touchscreen.tap`；每次斷言按鈕 active、詳情可見且含血量／元素／特性／反制 |
| TD-R1-02 | 失守結算只有抽英雄與同路線重開，無法回選關流程 | 新增 `#mainMenuBtn`；handler 關閉結算、重置本局與部署狀態，再開啟既有難度選擇，後續沿用難度→地圖→loading 流程 | Playwright 驗證 CTA 可見可點、結算關閉、狀態回到 `wave=0 / over=false`、難度選單三項可見；844×390 控制守門把結算 EXPECTED CTA 數更新為 3 |

## Backlog（本輪不做）

| ID | 優先級 | 待辦 | 進入條件 |
|---|---|---|---|
| TD-R1-03 | P2 | 正常難度第 3–5 波經濟與首 Boss 壓力調校 | 先建立固定 seed 多局統計：至少涵蓋清波金錢、塔總投資、漏怪、女神剩餘 HP、Boss 擊殺時間與失守率；比較多個塔陣策略後才保守調整波次收益或 Boss 係數，並以既有 `sim-balance`／E2E 做回歸。真人試玩單局資料不足以安全改數值，因此 R76 不動戰鬥平衡。 |

## 固定閘門

- `npm test`
- `npm run test:e2e`（r72 map loading → r66 控制／R76 真 tap → r68 map visibility → td-e2e）
- `npm run test:rwd`（9 視口）
- 版本鏈 `0.7.6 / td-r76-v1`：package、lockfile、README、HTML query/PWA 常數、SW cache/app shell、UI fallback、版本守門一致；執行面舊版號 grep 零。
- 秘密掃描排除 `.git`、`node_modules`、使用者提供的 `docs/audit_openclose` 與 `docs/playtest`，零命中。
- before/after 證據只寫入 `docs/evidence/r76/`；不覆寫歷史 evidence。
- main 分支、file-scoped commit、繁中訊息、指定共同作者；不 push。
