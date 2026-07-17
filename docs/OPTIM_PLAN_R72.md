# 無盡塔防 R72 地圖選擇／Loading 視覺計畫

輪次代號：td R72
日期：2026-07-17
依據：`C:/Users/digimkt/Desktop/遊戲/WAVE2_PROTOCOL.md`、`docs/AUDIT_full.md`、`AGENTS.md`

## 現況、範圍與禁止事項

- `src/config.js` 現有且只存在 `plains`、`canyon`、`lava` 三張地圖；本輪以這三圖為準。
- before 地圖選擇為 3 張 emoji＋文字卡，`.map-opt img` 為 0；沒有 loading overlay／loading 圖。
- 本輪為三張既有地圖各產出一張含 C2PA 的 imagegen master，再確定性裁成選擇 banner 與 loading 的 low／med／high runtime 圖。
- 不新增第四張地圖、不改路徑座標、`goldMul`、解鎖、難度、波次、關卡、塔、敵人或角色動畫資產。
- 生成背景只可出現在地圖選擇與 loading overlay，不可畫進 960×640 遊戲 Canvas；遊戲路徑磚原檔不換血。

## Wave 1 DoD 與殘留

- 2026-07-17 before `npm test`：PASS。
- R70 manifest：45 個唯一肖像／塔級資產皆有 production runtime hash；alpha gate 45/45 PASS、0 failed。
- production 主路徑缺圖／emoji fallback：0；本輪不得改任何角色 animation atlas 或 hurt/death 管線。
- Wave1 殘留清單：無阻塞項。R72 最終報告仍須再列一次並附最新測試結果。

## Before 基線與 After 固定上限

所有 Fast 3G／4×CPU 數值是在六線併發 Windows 機量到，標註「併發、不可信」；總稽核需淨機複測。產品斷言不因併發放寬。

| 閘門 | Before | After 契約 |
| --- | ---: | ---: |
| 地圖數／選擇圖／loading overlay | 3／0／0 | 3／3 張可見 banner／1 個互斥 loading overlay |
| 桌機首可互動，Fast 3G／4×CPU | 5428.9ms | ≤5971.8ms（before +10%） |
| 手機首可互動，Fast 3G／4×CPU | 4883.3ms | ≤5371.6ms（before +10%） |
| 地圖主視覺產品 mark | 無 | 每視口、每品質 ≤3000ms |
| 穩態 p95 桌機／手機 | 15.50／14.80ms | 三跑中位各 ≤18ms |
| 翠綠平原路徑帶亮度比 | 1.000 | ≥1.25，且不得低於 before |
| 迂迴峽谷路徑帶亮度比 | 1.077 | ≥1.25，且不得低於 before |
| 熔岩峽道路徑帶亮度比 | 1.092 | ≥1.25，且不得低於 before |
| 新場景文字對比 | 無新場景文字 | 每個量測區 ≥4.5:1 |
| 安全裁切 | emoji 卡，無圖 | 3 地圖 × 3 視口焦點 bbox 全在安全區 |
| 品質一致性 | 無 | low／med／high 均載入真素材、同源 master、hash 不同、非純色 |

before 證據：`docs/evidence/R72/before-performance-*.json`、`before-path-contrast.json`、`before-map-selector-*.png`。第一次三視口合併 probe 在 184 秒外層上限終止；沒有採用其未落盤數據，分拆後重跑成功，失敗紀錄須留在最終報告。

## 硬預算

每張 master 確定性輸出六張 runtime：loading 1024×576／768×432／512×288，banner 640×320／480×240／320×160。以下以 RGBA `寬×高×4 bytes` 計，不用壓縮檔大小取代貼圖記憶體。

| Runtime 檔位 | 每圖解壓 | 三圖解壓 |
| --- | ---: | ---: |
| loading high 1024×576 | 2.250MiB | 6.750MiB |
| loading med 768×432 | 1.266MiB | 3.797MiB |
| loading low 512×288 | 0.563MiB | 1.688MiB |
| banner high 640×320 | 0.781MiB | 2.344MiB |
| banner med 480×240 | 0.439MiB | 1.318MiB |
| banner low 320×160 | 0.195MiB | 0.586MiB |
| 全部 18 張最壞合計 | 5.494MiB／圖 | 16.482MiB |

- 桌機新增 runtime 最壞全解碼 16.482MiB ≤64MiB。
- 行動裝置實際只選 low：3 banner＋1 loading 約 1.148MiB ≤32MiB；即使錯誤全解碼仍為 16.482MiB ≤32MiB。
- low 不得換成純色或不同風格；只能同 master 降解析度，並保留路徑主題與色票。

## 實作與命令化驗收

1. 來源治理
   - 內建 imagegen／`gpt-image-2` 每地圖獨立呼叫一次。
   - 原始檔放 `docs/evidence/R72/masters/`，不得被 Pillow 後製覆寫。
   - 用官方 `c2pa-python` 的 `Reader` 驗證每張 master；active manifest 的 `softwareAgent` 必須匹配 `gpt-image 2.x`，原始 JSON／摘要進 `docs/evidence/R72/c2pa/`。驗不到即作廢重生。
   - `tools/r72_map_visual.py` 只做固定 center crop、Lanczos 重採樣、WebP 輸出、hash／記憶體表與量測，不得生成新畫面內容。

2. 地圖選擇與 loading
   - 既有三卡改為帶 2:1 banner 的戰術地圖牌；桌機與手機皆採圖文並列，手機／矮橫向壓縮留白以維持三卡同屏可達。
   - loading overlay 只顯示已選地圖、既有地圖名／描述、讀取狀態；不得添加鎖、關卡、獎勵或新玩法暗示。
   - performance marks：`r72-map-select-open`、`r72-map-visual-ready`、`r72-loading-open`、`r72-loading-visual-ready`、`r72-loading-close`。
   - overlay 納入 R71 blocking modal 互鎖；顯示時 app shell inert，結束後完整還原。

3. 路徑可讀性
   - 生圖絕不進 gameplay Canvas。
   - 既有 path PNG hash 鎖定；Canvas 只建立一次 map-specific tinted path tile 並沿用原 draw calls，不改 blocked cells／collider／路徑點。
   - `scripts/test-r72-map-loading.js` 逐圖取 Canvas 像素，以 WCAG relative luminance 量測中心路徑帶與鄰接地面；每圖 ratio ≥1.25。

4. P0 自動閘
   - 安全裁切：1366×768、390×844、844×390，三圖焦點 bbox 全在圖框安全區。
   - 文字對比：由瀏覽器截圖取樣 map name／desc／loading copy 的文字與實際背景，ratio ≥4.5:1，輸出 JSON。
   - 品質一致性：low／med／high 三檔並排證據；自然尺寸符合、像素變異非純色、同 master lineage、三檔皆成功載入。
   - 圖片引用皆加 `?v=<runtime sha256 前8碼>`；`td-r72-v1` 同步 `package.json`、`index.html`、`sw.js` 與離線清單。

## 全回歸與交付

- `npm test`
- `npm run test:e2e`：R66 控制、R71 modal 互鎖、R68 六視口地圖可視、既有完整 E2E 463 項。
- `npm run test:rwd`：主頁／設定頁 9 視口矩陣。
- `npm run test:perf`：桌機／手機三跑中位 p95 ≤18ms。
- 新增 R72 CI 同款 gate 並接入 `package.json` 與 `.github/workflows/ci.yml`。
- `git diff --check`、active runtime/version-bearing files 的舊版號 grep 歸零、秘密 `sk-proj|sk-|xai-` 排除 `.git/node_modules` 零命中；歷史 R71 報告保留當時版本字串。
- 最終輸出：style board、prompt、reference hash、source manifest、C2PA JSON、before/after、三視口、low/med/high、路徑／裁切／對比／效能 JSON、`docs/CODEX_RESPONSE_td_R72.md`。
- 本地繁中 commit，不 push。rollback：對 R72 單一提交執行一般 `git revert <commit>`。
