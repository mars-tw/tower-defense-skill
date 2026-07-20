# CODEX_RESPONSE R75

實作：Claude subagent（Codex 額度封鎖至 7/24）。

2026-07-19。R75：美術＋遊戲內容＋選單/裝置 P0 修正（menuscan td 章節 844×390 橫向重災區清償）。計畫：docs/OPTIM_PLAN_R75.md。

## P0 修正（menuscan 三項全清）

| id | 修正 | 驗證 |
|---|---|---|
| R75-1 | 結算 #overlay 改可捲容器：overflow-y:auto＋safe-area 邊距＋::before/::after auto-margin 置中（溢出時從頂部開捲，不再上下雙向裁切）；z-index 50→70 蓋過固定抽屜（<gacha 100） | 新守門斷言：844×390 走真 __tdGameOver 灌入完整結算內容，#deathCtaBtn/#restartBtn scrollIntoView 後 elementFromPoint 命中、捲回頂端標題 top≥0；evidence after/844x390-overlay-*.png（before 標題切頂、按鈕超底） |
| R75-2 | --r71-drawer-safe-bottom 依實際視口/方向重算：控制盤非「貼底列」（橫向側欄化）時退 8px；新輸出 --r75-drawer-max-height=視口−safe-bottom−8 夾住抽屜高度；resize＋orientationchange（rAF 後量測）都重跑 syncAdvisorGeometry | 新守門斷言：844×390 三抽屜 drawer-body top≥0 且 bottom≤視口、關閉鈕 ≥44px 可點可收合；方向切換斷言 landscape safe-bottom ≤24px、portrait ≥100px；直向幾何不變（回歸全綠） |
| R75-3 | 塔陣顧問 收合/關閉 徽章 32×22 → min 44×44（.advisor-tools button）；顧問模式鈕 min-height 36px（P1 減災） | 新守門斷言：advisor-tools 每顆 rect ≥44×44 且 elementFromPoint 命中 |

守門擴充：scripts/test-r66-controls.js 新增「R75 landscape P0 844x390」段（上述斷言＋pageerror 零）；既有 R71/R66 各視口斷言照跑全綠。

配套量測修正（不弱化不變量、只修取樣時機——本機 audiodg 失控佔核 93% CPU 的污染簽名下原取樣常晚於覆層自動關閉而誤紅，baseline 對照重現）：
- test-r66-controls：advisor-row 對 dock 干擾量測改取「與 drawer-body 可視框交集」（overflow 裁切區吃不到點擊；44px 徽章使 advisor-row 排版盒變高後原始 rect 誤報）。
- test-r72-map-loading：loading interlock 改「show mutation 當下快照」（MutationObserver 錄制唯一 modal＋shell inert＋背景不可自點）。
- test-td-e2e：快速開始 loading 等待接受 r72VisualReady 持久標記；mission-toast（1.9s 自動移除）改建立當下錄制 aria-live。

## 美術（程序化精緻化；生成工具未連線，無新生成素材）

- R75-5 剪影描邊：敵人 atlas（128px 格，t=4）與英雄 atlas（t=3）逐格、塔 tier sprite 與女神（t=3）逐張，離屏 bake「深色 1px（螢幕等效）剪影描邊」版本；bake 排 requestIdleCallback、完成前照畫原圖——每幀 draw call 數不變。64px 縮圖剪影可辨（evidence after/1366x768-unit-close.png）。
- R75-6 地圖磚層次：bakeBackground 每格加確定性（cx,cy 雜湊）頂緣亮光＋底緣壓影＋稀疏色斑，只烘焙一次；磚面從平鋪換色感變成有浮雕層次（before/after battlefield 對比）。
- R75-7 HUD 字級間距一致化：.hud .stat 16px/.3px、.dock-label 12px/.4px、panel h3 與 summary .4px 統一節奏。
- 動畫契約守門同步：test-enemy/hero-animation 的「單 atlas 真幀裁切」token 斷言擴充接受描邊 bake 同源版（r75OutlinedSprite(atlas…)‖fallback 原 atlas）。

## 遊戲內容（R73 裁決相關，D-01 未動）

- R75-8 波次預告最小版（B-02，裁決緩議、本輪指定優先）：lore.js 新增 `waveHeraldFor(wave,eventId,isBoss)` 純函式——WAVE_BEATS 里程碑＞Boss 開場＞4 句確定性模板（波數輪替、無亂數）×事件 flavor；≤40 波顯示於下一波情報卡 `.nw-herald`，>40 波開波僅入戰報 log（裁決縮幅遵守）。
- R75-9 英雄抽取回饋：lore.js 新增 `gachaRevealFor(heroId)`（HERO_LEGENDS 稱號＋DEPLOY_QUOTES 台詞）；抽卡揭示畫面稀有度行加稱號、新增台詞行（實測：「★★★ 史詩 · 封魔判官」＋「判筆在手，群魔皆有名可點。」；evidence after/390x844-gacha-reveal.png）。
- test-lore.js 新增 50+ 斷言：模板恰 4 句含 {wave}、確定性、里程碑/Boss/事件優先序、40 波 banner/41+ 波 log、15 英雄稱號台詞齊備、未知 id 空字串。

## 閘門結果

- `npm test`（10 支）：全綠（1009 PASS/✓、0 FAIL）。
- `npm run test:e2e`（r72-map-loading → r66-controls → r68-map-visibility → td-e2e）：單次連跑全綠（含新 R75 landscape 段）。
- `npm run test:rwd`：9 視口零違規、頁捲 0、水平溢出 0。
- 版本鏈：0.7.5 / td-r75-v1（package.json、index.html ?v=、sw.js CACHE_VERSION＋APP_SHELL、ui.js fallback、r72 gate 斷言同步）；`grep td-r72-v1`（排除 .git/node_modules/docs）歸零。
- 秘密掃描（sk-proj/sk-40/xai）排除 .git/node_modules：零命中。
- 效能附註：過程中本機 audiodg 累積 CPU 20.9 萬秒、全機負載 93%（R72.2/R73 已記錄的污染簽名），期間 r72 首互動預算曾見 6.5–12.4s 超標；最終連跑全綠，正式效能出貨閘依紀律以乾淨機況/CI 裁決。
- 歷史 evidence：R72 目錄曾被 gate 預設輸出覆寫，已 `git checkout --` 還原；本輪所有 gate 輸出改道 docs/evidence/r75/guard。

## 證據

- docs/evidence/r75/before/、docs/evidence/r75/after/：390×844、844×390、1366×768 × 戰場/結算 overlay 頂底/抽屜/64px 單位特寫/抽卡揭示。
- docs/evidence/r75/guard/：守門截圖（landscape-844x390-drawer-intel/overlay 等）＋量測 JSON。

## R75.1 硬化（Grok 對抗複審 NO_P0、六項裁定回鍋）

1. **R75-01** test-td-e2e：快速開始 loading 守門補正向斷言——兩段等待後再讀 `mapLoadingOverlay.dataset.r72VisualReady`，必須為 `"true"` 才通過；「覆層從未出現」不再能矇混快速路徑。
2. **R75-02** test-td-e2e：`__tdToastRecord` 每筆改同步快照「建立當下 meta.beginnerMissions.firstTower」（claimBeginnerMissions 先 saveMeta 再 showMissionToast，快照為 true 的第一筆即涵蓋 firstTower 領獎的 toast）；斷言 `find(firstTowerClaimed===true)` 過濾、不取最後一筆，鎖住建塔領獎因果。
3. **R75-03** test-r66-controls（844×390 段）：新增「#overlay 開啟時背景不可點」斷言——出波 CTA＋三個抽屜把手 elementFromPoint 全不得自點命中（overlay z-70 蓋抽屜 z-64 的實證守門）。
4. **R75-04** src/ui.js：補掛 `visualViewport.resize → syncAdvisorGeometry`（網址列收合/軟鍵盤不觸發 window resize 的情境）；開機寫入原已在 init `syncAdvisorGeometry()`。守門新增：首開抽屜前 `--r71-drawer-safe-bottom` 與 `--r75-drawer-max-height` 皆已為 px 值。
5. **R75-05** test-r66-controls（844×390 段）：intel 開啟時每顆 advisor tools 對出波 CTA/三把手「bbox 交集為零或 elementFromPoint 命中工具鈕本身」；另補「三抽屜全收合後 CTA/把手恢復可自點命中」斷言。
6. **R75-08** src/ui.js：onGameOver 開啟 overlay 後 `scrollTop = 0`（前局捲動位置不殘留）；守門新增開啟當下 `scrollTop===0` 斷言。

R75-06（bake 記憶體/降級敘事）與 R75-07（版本鏈原子性，已同 commit 落盤僅記錄）入 OPTIM_PLAN_R75 殘留節。

R75.1 重跑：npm test 全綠（0 FAIL）；npm run test:e2e（r72→r66→r68→td-e2e）單次連跑全綠（含六條新斷言）；npm run test:rwd 9 視口全綠；秘密掃描零命中。

## 殘留風險 / 缺件

- 美術僅程序化打磨；Hyper3D/gpt-image-2 生成產線未連線，塔/敵貼圖底仍為既有 atlas——待工具恢復再走 VISUAL_REFRESH_PLAN 生成輪。
- menuscan P2（tabs 35px、把手 38px 等 <44px 批次）未在本輪範圍，留待後續輪。
- 本機效能量測不可信（audiodg），p95 出貨閘需乾淨機況重測。
- D-01 手機放大鏡、A-01/A-02/A-03 仍屬 Codex 佇列未動。
- R75-06：outline bake 未寫顯式記憶體預算/低階裝置跳過策略（現況：bake 失敗 fallback 原 atlas），待下輪補。
