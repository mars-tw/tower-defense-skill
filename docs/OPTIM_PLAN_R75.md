# OPTIM_PLAN R75（美術＋遊戲內容＋選單/裝置 P0 修正）

2026-07-19。實作：Claude subagent（Codex 額度封鎖至 7/24）。
輸入：menuscan/PLAN_DRAFT.md td 章節（17 畫面×2 視口掃描）、OPTIM_PLAN_R73 裁決、game-optimization-round 技能八大面向。
本輪約束：生成工具未連線——美術僅程序化精緻化與渲染打磨；D-01（放大鏡）為 Codex 佇列不碰。

## P0（選單/裝置，844×390 橫向重災）

| id | 問題（掃描實測） | 修法 | 驗收 |
|---|---|---|---|
| R75-1 | 結算 #overlay 橫向無捲動：標題切頂 94px、「再來一局」超底 94px 不可捲達（index.html .overlay 無 overflow） | .overlay 加 overflow-y:auto＋safe-area 邊距；以 ::before/::after margin:auto 置中技巧取代純 justify-content:center（溢出時從頂部開捲，不再雙向裁切） | Playwright 844×390 真呼叫 __tdGameOver 灌入完整結算內容：#restartBtn / #deathCtaBtn scrollIntoView 後 elementFromPoint 命中；overlay scrollTop 可 >0 |
| R75-2 | 三抽屜 .drawer-body 衝出視口頂 107-115px：--r71-drawer-safe-bottom 以直向控制盤（貼底）幾何計算，橫向控制盤在側欄時 innerHeight-dockRect.top 變成巨大值 | syncAdvisorGeometry 判斷控制盤是否真的貼底（dock 頂緣在視口下半），非貼底時 safe-bottom 退 8px；同時輸出 --r75-drawer-max-height=視口-safe-bottom-上邊距 夾住高度；resize/orientationchange 都重算 | Playwright 844×390 逐一開 intel/hero/utility 抽屜：drawer-body top ≥ 0 且 bottom ≤ 視口；關閉鈕可見可點且點擊後收合 |
| R75-3 | 軍師/塔陣顧問 收合/關閉 徽章 32×22 觸控黑洞 | .advisor-tools button 命中區 ≥44×44（min-width/min-height）；順手把 .advisor-mode 按鈕 min-height 拉到 36px（P1 減災，不列閘門） | Playwright 量測 .advisor-tools button rect ≥44×44 且 elementFromPoint 命中 |
| R75-4 | 既有守門無 844×390 橫向覆蓋 | test-r66-controls.js 新增 R75 段：844×390 視口跑上述三項斷言＋既有控制可達性斷言照跑 | node scripts/test-r66-controls.js exit 0，新斷言全綠 |

## 美術（程序化精緻化；生成工具未連線）

| id | 項目 | 修法 | 驗收 |
|---|---|---|---|
| R75-5 | 敵人/塔在 64px 縮圖剪影不清（sprite 直貼無描邊） | 載入後一次性離屏 bake：敵人 atlas 逐格、塔 tier sprite 逐張加 1px 深色剪影描邊（8 向偏移 silhouette＋原圖疊回），執行期改用 baked 版本——不增加每幀 draw call | 64px 縮圖擷取（evidence）剪影可辨；e2e/效能守門不退化 |
| R75-6 | 地圖磚扁平換色感 | bakeBackground 每格加確定性（cx,cy 雜湊）頂緣亮光＋底緣壓影＋弱色斑，僅烘焙一次 | before/after 地圖特寫對比入 evidence |
| R75-7 | HUD 字級間距不一致 | .hud .stat / .dock-label / .panel h3 / summary 字級與 letter-spacing 統一節奏 | 三視口截圖目測＋控制守門不退化 |

## 遊戲內容（R73 裁決相關、非 Codex 佇列）

| id | 項目 | 修法 | 驗收 |
|---|---|---|---|
| R75-8 | B-02 波次預告最小版（裁決緩議、本輪指定優先） | lore.js 新增 waveHeraldFor(wave,eventId,isBoss) 純函式：里程碑 WAVE_BEATS＞Boss 開場＞4 句確定性模板×事件 flavor；wave>40 channel=log 不上 banner。nextWaveCard 波間顯示預告行；>40 開波僅入 #log | test-lore.js 新斷言：確定性、模板循環、里程碑、>40 入 log；UI e2e 不紅 |
| R75-9 | 英雄抽取回饋（本輪指定優先） | lore.js 新增 gachaRevealFor(heroId) 純函式（HERO_LEGENDS 稱號＋DEPLOY_QUOTES 台詞）；抽卡揭示畫面加稱號與台詞行 | test-lore.js 斷言 15 英雄稱號/台詞齊備；抽卡截圖入 evidence |

## 固定閘門（全過才算完）

- npm test（10 支單元/模擬）＋ npm run test:e2e（r72-map-loading/r66-controls/r68-map-visibility/td-e2e）＋ npm run test:rwd 全綠。
- 版本 bump：package.json 0.7.5 / td-r75-v1；index.html ?v=、sw.js CACHE_VERSION/APP_SHELL、ui.js fallback、test-r72-map-loading 斷言同步；grep td-r72-v1（排除 .git/node_modules/docs）歸零。
- 秘密掃描 `grep -rniE "sk-proj-[A-Za-z0-9_-]{20}|sk-[a-z0-9]{40}|xai-[A-Za-z0-9]{20}"` 排除 .git/node_modules 零命中。
- 證據 before/after（390×844、844×390、1366×768）入 docs/evidence/r75/；歷史 evidence 不覆寫。
- 報告 docs/CODEX_RESPONSE_R75.md；main 分支繁中 commit，不 push。
- 本機效能僅參考（audiodg 污染前例 R72.2/R73）；功能閘必須綠。

## R75.1 硬化（Grok 對抗複審 NO_P0、六項回鍋，均已實作）

| id | 內容 | 落點 |
|---|---|---|
| R75-01 | td-e2e 快速開始補正向斷言：`dataset.r72VisualReady === "true"` 才可通過（僅 `!show` 不得矇混） | scripts/test-td-e2e.js |
| R75-02 | toast 斷言改過濾 `__tdToastRecord` 中「建立當下 firstTower 已領」快照為 true 的第一筆（不取最後一筆；toast 內文無任務 id，以 saveMeta→showMissionToast 順序保證快照對應） | scripts/test-td-e2e.js |
| R75-03 | 新增「.overlay 開啟時背景不可點」斷言（出波 CTA＋三把手 elementFromPoint 全不得自點命中） | scripts/test-r66-controls.js |
| R75-04 | `--r75-drawer-max-height` 開機即寫（init syncAdvisorGeometry 既有）＋補掛 visualViewport resize；守門斷言首開抽屜前兩變數皆為 px 值 | src/ui.js＋scripts/test-r66-controls.js |
| R75-05 | 844×390 補「advisor tools 不遮出波 CTA/抽屜把手」斷言（bbox 交集為零或 elementFromPoint 命中正確目標）＋抽屜收合後 CTA/把手恢復可自點 | scripts/test-r66-controls.js |
| R75-08 | overlay 每次開啟 scrollTop 歸零（onGameOver 一行）＋守門斷言開啟當下 scrollTop===0 | src/ui.js＋scripts/test-r66-controls.js |

## 殘留（記錄，未入本輪程式變更）

- R75-06（Grok）：r75 outline bake 記憶體上限與降級敘事——hero atlas bake 峰值約 18 MiB 離屏 canvas；bake 失敗已 fallback 原 atlas，但未寫入顯式記憶體預算/低階裝置跳過策略，待下輪補敘事與量測。
- R75-07（Grok）：版本鏈原子性——sw.js/index.html/package.json 的 0.7.5/td-r75-v1 已於同一 commit（bfd6752）落盤，僅記錄備查；後續輪維持「版本鏈單 commit」紀律。
- 生成產線未連線（Hyper3D/gpt-image-2）；menuscan P2 批次；本機 p95 需乾淨機況重測；D-01/A-01/A-02/A-03 Codex 佇列未動。
