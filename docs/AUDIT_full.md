# 無盡塔防全面稽核報告

稽核日期：2026-07-16  
稽核對象：Endless Tower Defense（Canvas 2D）  
線上版本：<https://mars-tw.github.io/tower-defense-skill/>  
範圍限制：只稽核、只新增本報告，未修改任何遊戲程式、素材或測試檔。

## 稽核結論

- P0：0
- P1：5
- P2：16

整體狀態：核心系統已可玩，10 塔、15 英雄、女神、詞綴、地圖與 PWA 架構都已成形。R62 敵人真幀動畫與 R63 英雄攻擊三段在單元測試中通過，R65/R66 的視覺與控制硬化也已有文件與程式落點。不過目前最大的風險不是「不能開遊戲」，而是 QA 門禁在本機缺 Playwright browser 而無法跑完、塔陣顧問會在部分地圖推薦不可建造格、技能誤觸會直接消耗冷卻，以及首玩教學/難度曲線不足以支撐 10 塔與多系統的複雜度。

## Top 5 優先修正

1. P1-01：補齊 Playwright browser 或在測試腳本內給明確前置檢查，讓 npm run test:e2e 與 npm run test:rwd 可實際執行。
2. P1-02：讓 rules.js 顧問候選格與 game.js 實際 blocked path 規則共用同一套判定，避免峽谷/熔岩地圖推薦非法格。
3. P1-03：重整普通/嚴酷/無盡波次曲線，至少讓普通模式的主路徑能穩定到達設計目標波數，並降低 boss 後大幅掉落與 W12 暴衝。
4. P1-04：主動技能改成「有效命中或確認」才消耗冷卻，並提供觸控取消。
5. P1-05：把首玩教學從一段文字升級為可重訪的實戰引導，覆蓋建塔、元素、英雄、女神、詞綴與技能。

## 實際執行紀錄

已閱讀主要檔案：

- AGENTS.md
- README.md
- docs/CODEX_RESPONSE_td_R62.md
- docs/CODEX_RESPONSE_td_R63.md
- docs/CODEX_RESPONSE_td_R65_polish.md
- docs/CODEX_RESPONSE_td_R66_controls.md
- src/config.js
- src/rules.js
- src/heroes.js
- src/lore.js
- src/enemy-animation.js
- src/hero-animation.js
- src/ui.js
- src/game.js
- index.html
- sw.js
- scripts/test-config.js
- scripts/test-heroes.js
- scripts/test-rules.js
- scripts/test-board.js
- scripts/sim-balance.js
- scripts/test-enemy-animation.js
- scripts/test-hero-animation.js
- scripts/test-r66-controls.js
- scripts/test-td-e2e.js
- scripts/test-rwd-matrix.js

已執行測試：

- npm test：PASS。涵蓋 config、heroes、rules、board、balance sim、lore、R62 enemy animation、R63 hero animation。
- npm run test:e2e：FAIL。Playwright Chromium executable 不存在：C:\Users\digimkt\AppData\Local\ms-playwright\chromium_headless_shell-1228\chrome-headless-shell-win64\chrome-headless-shell.exe，stack 指到 scripts/test-r66-controls.js:135。
- npm run test:rwd：FAIL。同一個 Playwright Chromium executable 不存在，stack 指到 scripts/test-rwd-matrix.js:113。

線上頁面檢查：

- https://mars-tw.github.io/tower-defense-skill/ 可讀到主畫面、建塔/英雄/技能區、設定、排行榜、神魔誌、教學與難度/地圖選單文字。
- 線上文字層顯示教學只有「選一座塔蓋在路徑旁，再開始下一波。怪物漏到終點會攻擊女神；戰敗拿魂晶抽英雄，下局更強。」與快速/進階開始選項，對應本報告 P1-05。

## 1. 可玩性

### P0

無。

### P1-03 難度與波次曲線不穩，普通模式也容易在目標波數前崩潰

證據：

- src/config.js:247-256 定義普通、嚴酷、無盡倍率：normal hp 1/gold 1，brutal hp 1.5/gold .85，endless hp 1.3/gold .9 且 bossEvery 3。
- npm test 的 scripts/sim-balance.js 輸出顯示 survival sim：Plains normal wave 19、brutal wave 10、endless wave 14；Canyon normal wave 19、brutal wave 10、endless wave 13；Lava normal wave 18、brutal wave 10、endless wave 13。
- 同一輸出顯示 effective HP 曲線大幅震盪：W5 +96%，W6 -34%，W12 +163%，W15 -32%，W20 -29%。

影響：

- 普通模式的新手主線體驗在第 18-19 波前後結束，若設計目標是看到第 20 波 boss，節奏偏硬。
- 嚴酷與無盡都集中在早期死亡，無盡的「撐更久、追分」身份不夠清楚。
- 大幅尖峰與 boss 後下滑會讓玩家感覺不是逐步變難，而是突然被數值牆打斷。

建議修法：

- 先定義每個難度的目標波數，例如 normal 20、brutal 12-15、endless 15+。
- 將每波 effective HP 變動限制在可控區間，例如一般波正負 25-35%，boss 波允許較高但 boss 後不要大幅掉落。
- 將 scripts/sim-balance.js 升級成 gate：每張地圖、每個難度、至少 3 種主塔策略都要落在目標區間。

### P2-01 輔助塔/信標偏後期，早期購買價值與顧問說服力不足

證據：

- src/config.js:24-56 10 塔包含 support 與 beacon 兩座非直接 DPS 塔。
- npm test balance sim 輸出：「support threshold: if covered main tower total DPS >= 550, +20% better than low-level tower」。

影響：

- 前中期若玩家依圖示直覺購買輔助塔，可能短期沒有感受到收益。
- 顧問若推薦輔助塔而沒有說明「周圍主塔總 DPS 足夠才划算」，容易造成錯誤學習。

建議修法：

- 在顧問建議內加入「目前覆蓋 DPS」與「預期增益」。
- 讓 support/beacon Lv1 提供較小但立即可見的收益，或降低入門成本。

### P2-02 女神升級在高難度的相對收益偏大

證據：

- src/game.js:487 開局女神生命受難度倍率影響。
- src/config.js:137-144 女神 baseHp: 100、hpPerLevel: 60、brutal/endless 分別有 goddess hp multiplier。
- src/game.js:1674-1676 升級時直接 maxHp += GAME.GODDESS.hpPerLevel，沒有再乘難度倍率。

影響：

- brutal/endless 開局血量較低，但升級同樣加 60，導致高難度升級女神的相對增幅比 normal 更大。
- 高難度最佳策略可能偏向早升女神，而不是更有趣的塔陣選擇。

建議修法：

- 女神升級生命也套用 difficulty goddess multiplier，或在 UI 明示高難度女神升級是刻意保留的救援機制。
- 加入 balance sim：比較「早升女神」與「早建塔」在三難度的存活波數。

## 2. 畫質

### P0

無。

### 通過項：敵人與英雄主要戰鬥動畫達到 R62/R63 要求

證據：

- AGENTS.md:4-12 要求不得用單張圖平移/旋轉/縮放假裝走路、攻擊、受傷或死亡。
- docs/CODEX_RESPONSE_td_R62.md:5-15 記錄敵人 atlas 真幀、死亡幀與無 fake bob。
- docs/CODEX_RESPONSE_td_R63.md:5、docs/CODEX_RESPONSE_td_R63.md:24-28 記錄英雄 atlas 與攻擊 anticipation/impact/recovery。
- npm test 中 R62 enemy animation guard 與 R63 hero animation guard 均 PASS。

結論：

- 未發現 P0/P1 等級的假動畫問題。
- 未在測試輸出中看到黑底 fallback 或缺 atlas 的失敗。

### P2-03 英雄名冊/神魔誌仍使用 emoji 或舊單圖，和戰鬥 atlas 視覺不一致

證據：

- src/heroes.js:35-52 基礎英雄定義有 sprites 方向圖，但沒有 sprite 單圖。
- src/ui.js:416-419 heroAvatar() 只檢查 hero.sprite，否則回傳 emoji。
- src/ui.js:766-807 名冊卡片使用 heroAvatar(hero)。

影響：

- 戰鬥中英雄是 R63 atlas 真幀，但名冊/抽卡/神魔誌仍可能顯示 emoji 或舊單圖。
- 這會讓玩家覺得資產品質不一致，尤其是英雄養成與抽卡畫面。

建議修法：

- UI 卡片改用 hero atlas idle frame，或為 15 英雄補齊同一風格頭像。
- 若保留 emoji，應改成低效能/載入失敗 fallback，而不是正常 UI 主視覺。

### P2-04 神話英雄方向列較簡化，轉向辨識弱於基礎英雄

證據：

- src/hero-animation.js:18-34 基礎英雄有 down/left/right/up 對應列；多數神話英雄的 down/up/right 共用同列、left 另列，例如 daji、neza、matsu 等。

影響：

- 神話英雄稀有度最高，但上/下/右方向姿態變化反而比基礎英雄少。
- 大量敵人與特效同屏時，英雄面向與攻擊方向的讀取會變弱。

建議修法：

- 補齊神話英雄 4 方向 walk/attack row。
- 若工期有限，至少將攻擊方向用武器/施法特效偏移明確化。

### P2-05 塔升級視覺主要靠環、寶石與等級文字，塔體本身差異不夠

證據：

- src/game.js:2476-2555 drawTower() 使用同一 assets/towers/[towerType].png 作為塔體，再疊加 aura、ring、gem、等級文字。
- docs/CODEX_RESPONSE_td_R65_polish.md:7-14 已做塔與地圖像素精緻化，但未見每等級塔體變化的文件或程式資料。

影響：

- 升級爽感偏 UI 標記，而不是角色/塔體變強。
- 10 塔在後期疊滿後，視覺辨識依賴小型文字與光效，戰鬥讀取負擔增加。

建議修法：

- 每座塔至少做 3 段外觀：Lv1-3、Lv4-6、Lv7+。
- 避免只靠 LV 文字；改用塔身高度、砲管數、核心亮度等像素語彙。

## 3. 玩家適應性

### P0

無。

### P1-02 塔陣顧問會在峽谷/熔岩推薦不可建造格

證據：

- src/rules.js:754-779 buildCandidateForTower() 用 pathDist < cell * 0.58 排除路徑候選。
- src/game.js:59-75 markPathCells() 實際 blocked path 會把路徑點與鄰近偏移格一起加入 blocked set。
- src/game.js:1567-1571 buildPreviewFor() 只要 state.blocked.has(key) 就拒絕建塔。
- 以目前規則重算前 30 波顧問建議：Plains 0 個非法候選；Canyon 每個難度各 60 個非法候選，首個是 wave 1 建 frost/arrow 在 (3,3)，但該格被 game.js blocked；Lava 每個難度各 60 個非法候選，首個是 wave 1 建 frost/arrow 在 (4,3)，但該格被 game.js blocked。

可重現步驟：

1. 選擇「迂迴峽谷」或「熔岩峽道」。
2. 開局查看下一波卡片的「塔陣顧問」。
3. 點顧問推薦建塔格，再嘗試建造。
4. 該格被實際建造判定拒絕，玩家會看到路徑/不可建造相關失敗。

影響：

- 新手最需要顧問時，顧問會教錯位置。
- 這是信任破壞問題：玩家之後可能不再相信顧問，即使後續建議正確。

建議修法：

- 將 blocked cell 計算抽成共用純函式，rules.js 顧問與 game.js 建造都使用同一結果。
- 在 advisor action 產生後再跑一次 buildPreviewFor 等價驗證，非法候選直接降權或剔除。
- 加測試：每張地圖每個難度前 30 波，所有 advisor build action 都必須可建造。

### P1-05 首玩教學太短，無法支撐 10 塔/15 英雄/女神/詞綴複雜度

證據：

- 線上頁面文字層的「如何遊玩」只有一段核心文字與快速/進階選項。
- index.html:1212-1220 tutorial overlay 也是同一套短文案。
- src/ui.js:1837-1948 教學流程只在首玩或無存檔時顯示，之後直接開難度/地圖選擇。
- src/ui.js:109-139 建塔 dock 主要顯示圖示與成本，完整塔名/功能多依賴 title/aria-label；手機沒有 hover。

影響：

- 玩家第一次進入就要理解建塔、波次、英雄部署、抽卡、女神升級、元素克制、詞綴、主動技能與地圖差異，負荷過高。
- 手機玩家看不到 hover tooltip，容易只靠圖示猜塔。

建議修法：

- 做 3-5 步可略過教學：建第一塔、開始波次、升級/賣塔、部署英雄、放技能。
- 教學入口常駐在設定或暫停選單，可重看。
- 手機 dock 增加短按/長按說明，或首次點塔先開資訊再確認建造。

### P2-06 色盲與高對比支援仍偏初階

證據：

- src/ui.js:83-90 元素 chip 有顏色與 icon/文字。
- src/ui.js:1361-1390 設定有效能、減少特效與靜音；index.html:1125-1173 有文字大小。
- 未見色盲模式、高對比模式或以形狀/紋理區分火冰雷等元素的設定。

影響：

- 元素與詞綴在高特效戰鬥中仍可能依賴顏色判讀。
- 文字大小能幫忙讀 UI，但不能解決 Canvas 內戰鬥語意。

建議修法：

- 增加色盲友善模式：元素用形狀、邊框樣式、短標籤同步表示。
- 對血條、盾、沉默、減速等狀態加入非顏色指標。

### P2-07 塔陣顧問關閉後沒有明顯方式恢復

證據：

- src/ui.js:21 advisorHidden 是模組內狀態。
- src/ui.js:986-1003 顧問 HTML 只有未隱藏時顯示。
- src/ui.js:1030 close advisor 設為 advisorHidden = true。
- 未找到設定或同頁按鈕可將 advisorHidden 設回 false。

影響：

- 玩家誤關後失去主要引導工具，尤其手機螢幕小更容易誤觸。

建議修法：

- 在下一波卡片保留「顯示顧問」小按鈕，或在設定加入重開顧問。
- 每次新局重置 advisorHidden。

## 4. BUG

### P0

無。

### P1-01 E2E 與 RWD 測試目前無法實際跑完

證據：

- npm run test:e2e 失敗：Playwright Chromium executable 不存在。
- npm run test:rwd 失敗：同一個 executable 不存在。
- scripts/test-r66-controls.js:135 直接 chromium.launch()。
- scripts/test-rwd-matrix.js:113 直接 chromium.launch()。
- README.md:69-76 說明首次跑 E2E 需 npx playwright install chromium。

影響：

- R66 控制硬化與 RWD matrix 在本次稽核環境中沒有真正驗證到。
- CI 之外的本機驗收很容易產生「以為有跑，其實卡在瀏覽器缺失」的假安全感。

建議修法：

- 在 E2E/RWD 腳本開頭檢查 browser 是否存在，失敗時印出單一明確指令與環境說明。
- 若 CI 已有 browser，README 要清楚區分「CI 會跑」與「本機首次需要安裝」。
- 可加 npm run test:e2e:setup 或 npm run doctor。

### P1-04 主動技能點空也會消耗冷卻與計數，觸控沒有明顯取消

證據：

- src/game.js:1533-1555 castSkill() 一開始就檢查 cooldown，接著立即設定 skill.cooldown = skill.baseCooldown 並 state.stats.skillCasts++，之後才掃描敵人。
- src/game.js:2860-2867 有 pendingSkill 時，點 canvas 就直接 castSkill()。
- src/ui.js:1782-1784 只有鍵盤 Escape 會 cancel selection；觸控 UI 未見等價取消。

可重現步驟：

1. 選一個可用主動技能。
2. 在沒有敵人的地方或錯誤位置點擊 canvas。
3. 技能進入冷卻，skillCasts 也增加，但玩家沒有得到有效命中。

影響：

- 手機誤觸成本很高，尤其技能冷卻長。
- 成就/統計的技能施放次數可能包含無效施放。

建議修法：

- 地面目標技能先顯示範圍預覽，第二次確認才施放。
- 若範圍內沒有任何有效目標，提示「沒有目標」且不消耗 cooldown。
- 增加觸控可見的取消按鈕。

### P2-08 PWA 設定頁 fallback 版本字串過舊

證據：

- src/ui.js:1336-1359 PWA 設定面板會讀 window.__tdPwa。
- src/ui.js:1339-1341 fallback 字串仍是 td-r37-v1。
- index.html:1253 與 sw.js:1 目前版本是 td-r66-v1。

影響：

- 如果 window.__tdPwa 尚未初始化或被阻擋，設定頁會顯示很舊的版本，干擾玩家或 QA 判斷。

建議修法：

- 將版本常數集中在單一來源，例如從 APP_VERSION 或 build-time token 注入 UI 與 SW。
- 增加一個單元測試，確認 UI fallback、index.html、sw.js cache version 一致。

### P2-09 部分隨機仍走 Math.random()，不利重播與精準 QA

證據：

- src/game.js:690-716 createEnemy 內有 Math.random() 用於 animSeed 與 _dodgeRoll。
- src/config.js:287 event wave 在沒有傳入 rng 時會 fallback 到 Math.random()。

影響：

- 若未來要做 replay、seeded challenge 或戰鬥 bug 重現，會被非注入 RNG 干擾。

建議修法：

- 所有戰鬥相關亂數都從 state.rng 或注入 rng 取得。
- 僅純視覺裝飾可保留非決定性亂數，並在程式命名上標清楚。

## 5. 說明

### P0

無。

### P1-05 首玩說明不足

此項已列於「玩家適應性」，不重複計數。它同時也是說明面最大 P1。

補充證據：

- 線上頁面文字層 L89-L93 顯示「如何遊玩」只涵蓋建塔、下一波、漏怪攻擊女神與戰敗抽英雄。
- src/ui.js:947-959 敵人資訊有 trait/counter，表示機制資料已存在，但首玩流程沒有系統性帶到。
- src/ui.js:1046-1064 詞綴卡有影響說明，但玩家未必知道詞綴如何改變塔陣決策。

建議修法：

- 把現有 enemy info、affix card、tower recommendations 串成可重訪的「百科/教學」。
- 每個塔 tooltip 加入「克制誰/怕誰/何時買」三段短句。

### P2-10 README 最新功能摘要落後於 R63/R65/R66

證據：

- README.md:24-31 最新功能列出 R61、R62、英雄/女神、詞綴、排行榜、PWA、3 地圖 3 難度。
- 已有 docs/CODEX_RESPONSE_td_R63.md、docs/CODEX_RESPONSE_td_R65_polish.md、docs/CODEX_RESPONSE_td_R66_controls.md 記錄後續英雄動畫、像素精緻化與控制硬化。

影響：

- README 對外展示與實際版本重點不一致。
- 新進維護者可能不知道 R63/R65/R66 是已完成需求，不利回歸測試。

建議修法：

- 更新 README latest features，加入 R63 英雄真幀攻擊、R65 地圖/塔像素 polish、R66 mobile controls。
- 加「驗收腳本」段落，明確列出 npm test、npm run test:e2e、npm run test:rwd 前置條件。

### P2-11 戰鬥 log 只保留三行，重要機制提示容易被洗掉

證據：

- src/ui.js:1200-1206 addLog() 每次新增後，超過 3 行就移除最後一行。

影響：

- 詞綴、事件波、顧問、技能失敗、PWA 更新等訊息可能快速消失。
- 新手無法回看剛剛發生什麼。

建議修法：

- 畫面維持 3 行，但點擊展開最近 20 條。
- 對關鍵訊息分級，例如錯誤/更新/教學提示保留較久。

## 6. 選單

### P0

無。

### P2-12 建塔 dock 在手機主要靠圖示與價格，缺少可見短名

證據：

- src/ui.js:109-139 tower button 主要內容是圖示與 cost，完整名稱在 title 與 aria-label。
- 線上頁面文字層可見「左右滑動查看更多塔」，但塔名不一定直接顯示在 dock 主按鈕上。

影響：

- 桌機 hover 可以看 title，手機玩家沒有 hover。
- 10 塔時，純圖示學習成本高。

建議修法：

- 手機 dock 顯示 2-3 字短名，例如箭塔、砲塔、冰塔。
- 長按或首次點擊開塔資訊，第二次才進入建造模式。

### P2-13 排行榜/分享文案容易讓玩家期待線上競榜

證據：

- 線上頁面文字層有「排行榜 / 成就」與「分享你的攻略 讓大家膜拜」。
- src/ui.js:1420-1533 leaderboard/progress 讀寫本機資料與 UI。

影響：

- 玩家可能以為排行榜是全站或好友榜，但目前看起來是本機紀錄。

建議修法：

- 若維持本機榜，標題改成「本機紀錄 / 成就」。
- 若要線上榜，需補提交、防作弊與隱私說明。

### P2-07 顧問關閉後無恢復入口

此項已列於「玩家適應性」，同時影響選單導覽，不重複計數。

## 7. 全平台 UX

### P0

無。

### P1-01 RWD/觸控自動化驗證未完成

此項已列於「BUG」，不重複計數。由於 npm run test:rwd 在 browser launch 前即失敗，本次無法用既有矩陣驗證桌機/平板/手機控制可達性。

### P2-14 手機 canvas 格子約 36px，仍低於常見 44px 觸控目標

證據：

- index.html:726-729 portrait mobile 將 #game 寬設為 724px。
- src/config.js:148-158 cellSize: 48，內部 canvas board 寬是 20 格，也就是 960px。
- 724/960*48 約等於 36.2 CSS px。

影響：

- R66 已把控制列變大，但 canvas 內點格建塔仍可能比 44px 小。
- 雙擊確認能降低誤建，但也增加手機操作步驟。

建議修法：

- 手機建塔時放大目標格周圍熱區，或提供格子吸附/放大鏡。
- RWD 測試應明確區分「UI button 44px」與「canvas grid 操作熱區」。

### P2-15 Canvas 內英雄點選半徑偏小，但已有列表替代入口

證據：

- src/game.js:2884-2886 hero selection hit radius 是 CELL * 0.5，即 24 internal px；在 724px 手機 canvas 約 18px CSS radius。
- src/ui.js:809-843 已有 deployed hero list，可從 UI 按鈕選英雄守點。

影響：

- 直接點 canvas 英雄在手機上不穩，但列表入口降低嚴重度。

建議修法：

- 手機模式把英雄 hit radius 提高到至少 32 internal px，或用最近英雄選取。
- 在英雄列表加明顯「守點」狀態與取消守點入口。

### P2-16 PWA 更新流程有提示，但需要納入 E2E 覆蓋

證據：

- index.html:1318-1339 有 update toast。
- index.html:1341-1349 applyUpdate() postMessage SKIP_WAITING。
- index.html:1366-1375 controllerchange 在首 15 秒自動 reload，之後顯示更新提示。
- sw.js:121-128 activate 時清舊 cache。

影響：

- 程式結構看起來完整，但本次 E2E 因 Playwright browser 缺失沒有實機驗到 install/update/refresh 流程。

建議修法：

- 補 PWA update E2E：舊 SW -> 新 SW -> toast -> apply -> reload -> version match。
- 測試失敗時輸出目前 controller/cache version。

## 綜合建議

- 先修 P1-01，否則後續任何 RWD/控制改動都缺少自動化保障。
- P1-02 建議用共用 blocked path 判定一次解掉，這是低成本高信任度修正。
- P1-03 應先靠 sim 對齊目標曲線，再進人工試玩；目前數值震盪比個別塔強弱更值得優先處理。
- P1-04 與 P1-05 都是手機與新手留存問題，修完會直接改善首局體感。
- P2 項目多數是精緻化與一致性，不需要一次全做，但可以併入下一輪 R67/R68 polishing。
