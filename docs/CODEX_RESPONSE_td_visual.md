# Codex 回應 — td-r57-v1 畫面強化

## 結論

已完成 Kenney CC0 粒子合成、塔升級辨識、三地圖氛圍/路紋、波間呼吸光、HUD 動態與 Boss 全屏警示；未改戰鬥數值、波次規則或 gameplay RNG。版本已全同步至 `0.5.7 / td-r57-v1`，舊版本 grep 為 0。未 commit / push。

## 落地項目

- Kenney Particle Pack 1.1 原包與授權留在 gitignored `tools/`；6 張透明 PNG 進 `assets/particles/`，來源與改名記錄見 `CREDITS.md`。
- Canvas 紋理合成：臼砲＝閃光/火/煙；一般死亡＝閃光/煙；Boss＝閃光/火/煙/魔法；毒/冰/雷命中各用魔法紋、冰環、雷花並做元素 tint。
- 離屏 tint cache 依「紋理＋顏色」重用；所有紋理層仍走既有 `pushParticle`、220 全域 cap 與 `criticalFx` 驅逐語意。
- low 檔每次紋理合成只保留 1 個主層、關閉額外呼吸/高階旋轉層；reduced 即時清粒子並關閉紋理、呼吸、HUD 跳動、震動與旋轉，必要 Boss 警示改靜態呈現。
- 塔 Lv1→Lv10 以底座尺寸、色階、多圈光環、塔頂寶石尺寸/亮度、`LV n` 徽記與滿級光點形成清楚級差。
- 地圖：平原清綠＋腳印；峽谷暖赭＋石板縫；熔岩紅褐＋裂紋。路紋預烘焙為低對比 cache；波間高檔有輕微呼吸光。
- HUD：金幣/生命增減跳動、波次漸層進度條與 ARIA 值；Boss 波使用 2.6 秒全屏警報、暗角、警戒條與高對比標題。
- PWA `APP_SHELL` 與 asset regex 已納入 6 張粒子素材。

## 視覺 guard

- 驗 6 素材載入、毒/冰/雷/臼砲專屬紋理、Boss texture `criticalFx`、tint cache 命中。
- 驗 low＝1 紋理層、reduced＝0 粒子/0 紋理層、220 cap 下 Boss/漏怪關鍵特效保留。
- 驗三地圖 tint/路紋配置互異、Lv1/Lv10 寶石/光環/色階成長、HUD 40% 進度與金幣跳動、Boss 全屏警示狀態。
- Browser 實機 Canvas QA：桌面平原、峽谷、熔岩均無 HUD/戰場遮擋；依畫面結果再加深峽谷與熔岩 tint。

## 驗證

- `npm test`：PASS。
- `npm run test:rwd`：PASS，9 視口、主頁/設定頁零違規、零頁捲、零水平溢出。
- `npm run test:e2e`：最終程式碼連跑 3 次 PASS；桌面/平板/手機/矮視窗皆無 pageerror。
- `node --check`：`game.js`、`ui.js`、`test-td-e2e.js`、`sw.js` PASS。
- `git diff --check`：PASS。
- 舊版版本字串全 repo grep：0。
