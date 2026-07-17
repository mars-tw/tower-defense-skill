# Wave 2 R72 交付報告：地圖選擇與 loading 視覺

## 結論

R72 完成並全綠。專案現有地圖數為 **3**：翠綠平原 `plains`、迂迴峽谷 `canyon`、熔岩峽道 `lava`；本輪只為這三張既有地圖補齊 banner、loading 與選擇框架，**沒有新增地圖、路徑、玩法、難度、波次、塔、敵人、角色或解鎖內容**。版本升為 `0.7.2`，PWA cache 升為 `td-r72-v1`。

## 現況、範圍與取捨

- Before：三地圖選擇只有 emoji／文字，地圖圖片 0、loading 圖 0；既有路徑、資源倍率與排行分頁已存在。
- After：每圖各有 2:1 banner 與 16:9 loading 的 low／med／high 真圖，共 18 個 runtime WebP；桌機與手機皆用「戰術地圖碑」圖文並列框架。
- 手機／844×390 矮橫向維持緊湊並列，不採大圖上下排，目的是讓三個既有選項同屏、中心 hit-test 可達且不需 modal 內捲動。
- loading 最短顯示 2.4 秒，讓圖與路徑確認狀態可被看清；期間它是 R71 唯一 blocking modal，背景 app shell 為 `inert`／`aria-hidden`。
- Fast 3G＋4×CPU 使用真正的 low WebP，不以純色或 CSS 假圖代替。初始只預載 3 張 low banner（約 39 KiB）與預設平原 low loading（約 40 KiB），high／med 仍依實際視窗載入。
- 路徑可讀性採一次性 48×48 map-specific tinted path tile；原 `assets/tiles/path.png`、路徑點、blocked cells 與 collider 不變，每幀 draw call 數不增加。

## Imagegen 與素材治理

三份 master 均由 Codex 內建 imagegen／`gpt-image-2` 生成；參考僅用於既有世界光線、palette 與路徑材質，不複製地圖玩法。完整 prompt、負面限制、reference hash 與 deterministic postprocess 位於：

- `docs/evidence/R72/prompt-template.md`
- `docs/evidence/R72/style-board.md`
- `docs/evidence/R72/source-manifest.json`
- `assets/maps/r72/manifest.json`
- `tools/r72_map_visual.py`

| 地圖 | C2PA master SHA-256 | softwareAgent | signature／data hash |
|---|---|---|---|
| 翠綠平原 | `d2ea42e6…9755cb` | `gpt-image 2.0` | validated／valid |
| 迂迴峽谷 | `ebd7abfc…66968c` | `gpt-image 2.0` | validated／valid |
| 熔岩峽道 | `764ea392…1a0cd` | `gpt-image 2.0` | validated／valid |

三份原始 master 未做後製並保存在 `docs/evidence/R72/masters/`。驗證使用官方 [`c2pa-python`](https://github.com/contentauth/c2pa-python) Reader；完整 JSON 在 `docs/evidence/R72/c2pa/`。三份皆為 `validation_state=Valid`，claim signature 與 data hash 通過。`validation_status` 另保留 `signingCredential.untrusted`：這代表本機 C2PA trust store 未配置該簽發根，不等於 signature 或 data hash 失敗，因此沒有把警告隱藏成全信任。

Runtime 後製固定為中心裁切、Pillow Lanczos、WebP quality 82／method 6；每檔的完整 SHA-256、尺寸與參數均在 manifest。18 個變體全數相異且可重現。

## 協定 §2：效能與記憶體

| 守門 | 結果 | 門檻 | 狀態 |
|---|---:|---:|---|
| 全 18 圖 decoded RGBA | 16.482 MiB | mobile ≤32、desktop ≤64 MiB | PASS |
| desktop Fast 3G／4× first interaction | 5405.4 ms | ≤5971.8 ms（before +10%） | PASS |
| mobile Fast 3G／4× first interaction | 4596.6 ms | ≤5371.6 ms（before +10%） | PASS |
| desktop selector／loading main visual | 422.1／256.3 ms | 各 ≤3000 ms | PASS |
| mobile selector／loading main visual | 258.1／191.6 ms | 各 ≤3000 ms | PASS |
| desktop steady p95 三跑 | 2.30／2.10／2.60 ms；中位 2.30 | 中位 ≤18 ms | PASS |
| mobile steady p95 三跑 | 4.00／2.80／3.10 ms；中位 3.10 | 中位 ≤18 ms | PASS |

節流量測 JSON 保留 `concurrentUntrusted=true`，用來揭露本機曾有其他 Codex／Godot 工作，不作為放寬門檻的理由；最終所有原門檻仍實際通過。最早的三視窗合併 before probe 曾在 184 秒逾時，因此 baseline 改為單一視窗串行量測並保留 split JSON，沒有採信逾時結果。

## 協定 §3：RWD、safe-crop、文字與路徑可讀性

- Selector：1366×768 high、390×844 med、844×390 med；三者三卡皆完整在 viewport、中心 hit-test 命中、focal bbox 完整、水平溢出 0、頁捲 0。
- Loading：同三視窗 focal bbox 全完整；桌機為 cover、直式手機為 contain、矮橫向為 cover。
- Loading 文字最差對比為 **7.716:1**，高於 4.5:1。
- low／med／high 均為同 master 真圖，三 hash 相異、最大 channel variance >0.01，RGB mean spread 0.129 <0.24。

路徑量測固定使用 WCAG relative luminance：中心路徑帶距 polyline ≤16 px，鄰接地面 annulus 62–92 px。

| 地圖 | Before | After（final CI run） | 門檻 | 狀態 |
|---|---:|---:|---:|---|
| 翠綠平原 | 1.000 | 2.330 | ≥1.25 且不低於 before | PASS |
| 迂迴峽谷 | 1.077 | 2.243 | ≥1.25 且不低於 before | PASS |
| 熔岩峽道 | 1.092 | 2.074 | ≥1.25 且不低於 before | PASS |

原始 path PNG SHA-256 仍為 `aa1c795e…42c4f7`，R72 static gate 逐次斷言未變。

## 協定 §4：內容雜湊、PWA 與離線

- 18 個 runtime URL 全部使用各自 SHA-256 前 8 碼 `?v=` query；R72 gate 同時核對磁碟 hash、`src/ui.js` reference 與 `sw.js` offline list。
- `sw.js` 的 APP_SHELL 精確列出 18 個帶 hash query 的 WebP；asset runtime regex 已納入 `maps/*.webp`。
- PWA cache：`td-r72-v1`；active runtime／version-bearing files 的 `0.7.1|td-r71-v1` 掃描為 0。歷史 R71 報告保留當時版本字串。
- 真 Service Worker 測試在 offline reload 後仍能進遊戲並建塔：`towers=1`、`caches=2`。

## 完整回歸（CI 同款）

| 指令／守門 | 最終結果 |
|---|---|
| `npm test`（含 R70 art、R62 敵人、R63 英雄真幀／攻擊時點） | PASS |
| `npm run test:e2e` | PASS，exit 0 |
| 主 E2E | 369 `✓` |
| R66 控制＋R68 地圖可視＋R71 互鎖 | 94 `OK` |
| 使用者指定 E2E 合計 | **463／463，fail 0** |
| R72 額外守門 | 121 `PASS`，fail 0 |
| `npm run test:rwd` | 9 視口 × 2 頁＝18／18，頁捲 0、水平溢出 0 |
| `npm run test:perf` | desktop 中位 2.30 ms；mobile 中位 3.10 ms；PASS |

最終輸出：

- `docs/evidence/R72/regression/npm-test.log`
- `docs/evidence/R72/regression/npm-test-e2e.log`
- `docs/evidence/R72/regression/e2e-count.json`
- `docs/evidence/R72/regression/npm-test-rwd.log`
- `docs/evidence/R72/regression/npm-test-perf.log`
- `docs/evidence/R72/regression/r72-map-loading-measurements.json`
- `docs/evidence/R72/regression/modal-interlock-measurements.json`
- `docs/evidence/R72/regression/map-visibility-measurements.json`

第一次合併 E2E 因舊 1366×700 case 未等待新 loading 結束而失敗；修正為等待 `mapLoadingOverlay` 關閉後，完整套件重跑全綠。原失敗 log 保留於 `docs/evidence/R72/regression/npm-test-e2e-attempt-failed.log`，沒有刪除失敗證據。

## 視覺證據索引

- Before selector：`before-map-selector-{desktop-1366x768,mobile-390x844,landscape-844x390}.png`
- After selector：`after-map-selector-{desktop-1366x768,mobile-390x844,landscape-844x390}.png`
- 三地圖 loading：`after-loading-{plains,canyon,lava}-desktop.png`
- 路徑 before／after：`before-game-{plains,canyon,lava}.png`、`after-game-{plains,canyon,lava}.png`
- low／med／high：`quality-tiers-plains.png`

上述檔案均位於 `docs/evidence/R72/`；CI 同款副本位於 `docs/evidence/R72/regression/`。

## 回退與工作樹邊界

- 回退 UI：移除 `R72_MAP_VISUALS`、map loading overlay 與 R72 CSS／測試即可恢復 R71 選擇流程。
- 回退路徑視覺：移除 `r72PathTile()` 並改回直接繪製原 path PNG；資料與碰撞未遷移。
- 回退 PWA：刪除 18 個 R72 offline entries 並另升 cache version，避免舊 cache 混用。
- 使用者原先已修改的 `docs/evidence/R68/*.png` 與 `docs/evidence/R71_menu/*` 均保留、未納入 R72 commit；本輪透過 `TD_EVIDENCE_DIR` 把回歸輸出導到 R72。

## 最終判定

R72 scope、imagegen 鐵律、C2PA／hash／postprocess、§2／§3／§4、路徑對比、463 E2E、R66、R68、R71、RWD、p95、PWA 離線與角色動畫守門均通過，可交付。
