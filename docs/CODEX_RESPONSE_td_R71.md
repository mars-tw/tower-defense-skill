# 《無盡塔防》td R71 選單重疊檢修報告

## 結論

R71 已修正教學 overlay 的背景穿透、手機塔陣顧問浮層侵入 dock，以及 modal／浮層互斥守門缺口。版本已升至 `0.7.1`／`td-r71-v1`；完整單元、E2E、RWD、控制與地圖可見守門全綠，秘密掃描零命中。

## 1. 問題分類與修正

### 教學 overlay 與背景 HUD／dock

修正前的教學 overlay 雖能攔截點擊，但背景色為 `rgba(6,12,10,.9)`，因此仍有 10% 視覺穿透；依本輪定義屬真問題。1366×600 的 `startBtn`／`speed1` 與教學按鈕、390×844 的塔 dock 與 `tutorialAdvanced` 雖然 rect 相交，實際命中由 overlay 截走，但背景仍可被看見。

修正後：

- 背景遊戲內容包入 `#appShell`；任一 blocking overlay 開啟時同步設定 `inert` 與 `aria-hidden="true"`。
- 教學 overlay 改為不透明 `#06100b`，不再透出 HUD、dock 或地圖。
- blocking modal 開啟期間暫藏 mission／bond／oracle／recovery toast，避免高 z-index toast 疊入教學卡。
- 教學、難度、地圖、設定改走單一互斥開啟函式；從設定進教學時先正規關閉設定，不保留雙 modal。

### 塔陣顧問與手機 dock

390×844 修正前實測顧問 drawer bottom 為 628px、dock top 為 599px，面板侵入 dock 29px。根因是 drawer 仍依舊版固定 `--r64-control-height` 推算 bottom，但 R69 後 dock 已改為版面流內保留列。

修正後：

- 依 `#sceneControls.getBoundingClientRect().top` 即時計算 `--r71-drawer-safe-bottom`，保留額外 8px 安全距離。
- 手機顧問浮層開啟時顯示不透明 advisor backdrop，戰場、HUD、dock、其他抽屜及非顧問情報進入 inert。
- 顧問 drawer 與 dock、顧問本體與 dock 的交疊面積皆為 `0px²`；顧問按鈕中心仍全部命中自身。

## 2. R66 控制守門擴充

`scripts/test-r66-controls.js` 新增 R71 桌機 1366×600 與手機 390×844 流程：

- tutorial → difficulty → map → settings 每一步只允許一個 modal 顯示。
- 每一步驗證 `#appShell.inert === true`、`aria-hidden="true"`。
- 對 `startBtn`、`speed1` 與 10 座塔 dock 按鈕中心執行 `elementFromPoint`；背景元素 self-hit 必須為 0。
- 教學背景 alpha 必須為 1。
- 手機顧問另驗 backdrop、背景 inert、drawer/dock 零交疊與顧問控制可命中。
- 自動輸出桌機／手機截圖與 JSON 量測至 `docs/evidence/R71_menu/`。

RWD 自訂 R68 dock hit-test 也同步調整：測試暫藏 modal 時一併暫時解除測試用 inert，完成後完整還原，避免把 R71 正確阻擋誤判成 dock 不可達。

## 3. 閘門結果

| 閘門 | 結果 |
|---|---|
| `npm test` | PASS |
| `npm run test:e2e` | PASS |
| `npm run test:rwd` | PASS，18/18 頁面×視口零違規 |
| R71／R66 控制守門 | PASS |
| R68 地圖可見守門 | PASS，6 視口 canvas/dock 交疊 0 |
| `git diff --check` | PASS |
| 秘密掃描 | ZERO MATCHES |

高負載 Windows 環境的 Playwright 初始化與 Service Worker controller handoff 等待上限分別放寬至 60 秒／90 秒；產品斷言未刪除、未跳過。

## 4. 證據

- [量測 JSON](evidence/R71_menu/modal-interlock-measurements.json)
- [1366×600 教學](evidence/R71_menu/desktop-1366x600-tutorial.png)
- [390×844 教學](evidence/R71_menu/mobile-390x844-tutorial.png)
- [390×844 顧問](evidence/R71_menu/mobile-390x844-advisor.png)
- [閘門摘要](evidence/R71_menu/gate-summary.md)
- [秘密掃描](evidence/R71_menu/secret-scan.txt)

本輪只建立本地 commit，不 push。
