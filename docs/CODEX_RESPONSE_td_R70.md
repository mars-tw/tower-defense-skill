# td R70｜Wave 1 視覺量產報告

日期：2026-07-17
狀態：完成；本地提交、不 push

## 交付摘要

- 完成 15 位英雄 UI 肖像，全部接到英雄名單、部署卡與英雄詳情，正式移除 `heroAvatar()` 的 emoji／載入失敗文字 fallback。
- 完成 10 塔各三級外觀，共 30 張 RGBA PNG；遊戲依 Lv1–3、Lv4–6、Lv7+ 切換 tier 1／2／3，建塔 dock、就地輪盤、預覽、場上渲染與選中塔資訊都已接線。
- 版本更新為 `0.7.0`／`td-r70-v1`，45 張新 runtime 圖已納入 Service Worker 離線快取。
- `CREDITS.md` 已補記生成模型、參考來源、清稿管線與驗收證據。

## 資產製作與清稿

肖像以 `gpt-image-2`／內建 `image_gen` 產製，各自使用 `hero-animation-atlas.png` 的 idle 幀維持身份；雷震子沿用 Wave 0 已核准樣本。塔先以 R61 單塔與 R65 palette 為參考產出三欄 contact sheet，再切出三級外觀。每一級以高度、砲管／武裝、核心與旗幟／冠飾推進，不依賴 LV 文字。

後製沿用 `VISUAL_REFRESH_PILOT/tools_visual` 校準流程：generated source → opaque master → mask → 去色污染 RGBA master → R65 palette 量化 → 1px 深色輪廓 → 128×128 runtime PNG。完整 slug、production prompt、model slug、reference hash 與各階段 artifact hash 見 [asset manifest](evidence/R70_art/asset-manifest.json)；runtime 副本為 [`assets/art-manifest-r70.json`](../assets/art-manifest-r70.json)。可重跑管線收錄於 [`tools/r70_visual.py`](../tools/r70_visual.py)。

## 視覺與 runtime 證據

- [15 英雄 contact sheet](evidence/R70_art/hero-portrait-contact-sheet.png)
- [10 塔三級 contact sheet（含 36px 預覽）](evidence/R70_art/tower-tier-contact-sheet.png)
- [before / after](evidence/R70_art/before-after.png)
- [桌面 runtime 1366×768](evidence/R70_art/runtime-desktop-1366x768.png)
- [英雄詳情 runtime 1366×768](evidence/R70_art/runtime-hero-desktop-1366x768.png)
- [行動版 runtime 390×844](evidence/R70_art/runtime-mobile-390x844.png)
- [瀏覽器 console 紀錄](evidence/R70_art/browser-console.json)：`[]`

實機讀回確認 10 張 dock tier-1 圖與英雄肖像皆載入成功，natural size 均為 128×128；390×844 視口水平溢出為 0。

## 閘門結果

| 閘門 | 結果 |
| --- | --- |
| `python tools/r70_visual.py process` | PASS |
| Wave 0 alpha gate | 45 checked／45 passed／0 failed |
| 塔剪影遞進 gate | 10／10 PASS；三級高度嚴格遞增、面積與相鄰 alpha-mask 差量達標 |
| `npm test` | PASS；含 R70 prompt/reference/artifact hash 與 UI/runtime 契約 |
| `npm run test:e2e` | PASS；含 R66 controls、R68 map visibility、完整塔防 e2e |
| R66 controls | PASS；1920×1080、1440×780、1366×600、1280×640、390×844 |
| R68 map visibility | PASS；1920×1080、1440×780、1366×600、1280×640、390×844、844×390 |
| `npm run test:rwd` | PASS；主頁與設定頁各 9 視口，零違規、零頁捲、零水平溢出 |
| Browser console / page runtime | 0 error、0 warning |
| 秘密掃描 | ZERO MATCHES；見 [secret-scan.txt](evidence/R70_art/gates/secret-scan.txt) |

alpha 細項見 [summary.json](evidence/R70_art/gates/summary.json)，剪影量測見 [tower-silhouette.json](evidence/R70_art/gates/tower-silhouette.json)。

## 接線與回退

- 英雄戰鬥動畫仍使用 R63 真幀 atlas；本輪只更換 UI 肖像，沒有以單張位移／縮放冒充角色動畫。
- 塔仍保留既有等級環、核心與 LV 色錨作輔助資訊，但主體圖已按 1–3／4–6／7+ 實際更換，36px 剪影可辨識。
- 回退點為本報告所在的單一本地提交；未 push。需要回退時可針對該提交做一般 revert，R69 的原始塔圖與英雄動畫 atlas 仍保留於資產樹中。
