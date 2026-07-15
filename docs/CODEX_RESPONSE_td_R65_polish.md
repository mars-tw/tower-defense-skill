# 《無盡塔防》td R65 像素精緻化報告

R65 已完成地圖磚、10 座塔與 UI 小圖示的像素精修。版本提升為 `0.6.5`，PWA 快取版本為 `td-r65-v1`。本輪只更新地圖／塔／技能與 UI 圖示呈現，未修改 R62 敵人 atlas、R63 英雄 atlas 或存檔資料結構。

## 精緻化落地

| 標準 | R65 落地結果 |
|---|---|
| 多階明度與色相偏移 | 塔、裝飾物、技能圖示經 Canvas 2D 後製，陰影偏冷紫／藍，亮部偏暖；地圖材質改為 3-4 階以上的草地、泥路、石材色階。 |
| 選擇性 dithering | 地圖磚使用 ordered dithering 與噪聲補紋理；塔與圖示以有限色盤量化後加入局部 dither，降低色帶。 |
| 1px 抗鋸齒／暗描邊 | 透明資產加入剪影暗描邊與半透明外緣 AA，並讓 `removeBg()` 對透明 PNG 跳過二次去背，避免深色描邊被誤刪。 |
| 邊緣高光 / rim | 依塔與技能元素加入暖色、冰色、雷色、毒色或紫色 rim，提升縮小到 44-48px 時的辨識度。 |
| 統一有限色盤 | `scripts/polish-r65-assets.js` 以共用有限 RGB palette 生成／量化；alpha 只用於外緣 AA 與透明去背。 |
| 大面積補紋理 | 草地、泥路重新生成可鋪排像素材質；塔基座補石縫、鉚釘與局部磨損；岩石、樹、灌木補冷陰影與暖高光。 |

## Before / After

- 地圖磚與岩石裝飾：`docs/evidence/R65_polish/map-before-after.png`
- 10 座塔：`docs/evidence/R65_polish/towers-before-after.png`
- 塔 dock／技能盤圖示：`docs/evidence/R65_polish/icons-before-after.png`
- 有限色盤參考：`docs/evidence/R65_polish/palette-strip.png`
- 資產尺寸與色彩量測：`docs/evidence/R65_polish/asset-metrics.json`

## 主要修改

- 新增 `scripts/polish-r65-assets.js`：以 Playwright + Canvas 2D 從既有 PNG 產出同尺寸、同命名的 R65 精修資產與 evidence。
- 更新 `assets/tiles/*`、`assets/towers/*`、`assets/skills/*`：保留檔名與 `1024x1024` 尺寸。
- 更新 `src/ui.js` 與 `index.html`：建塔 dock、技能盤、建塔輪盤改用精修 PNG 圖示，保留原本快捷鍵、ARIA 與按鈕結構。
- 更新 `src/game.js`：Canvas drawImage 關閉 image smoothing，並保護透明 PNG 的描邊不被去背流程移除。
- 更新 `package.json`、`package-lock.json`、`README.md`、`sw.js`、`index.html`：版本同步至 `0.6.5` / `td-r65-v1`。

## 驗收

- `npm test`：PASS。
- `npm run test:rwd`：PASS，九視口矩陣零違規、無頁面垂直捲動、無水平溢出。
- `npm run test:e2e`：PASS，桌機／平板／手機流程、PWA、R62/R63 動畫守門與 R65 UI 圖示接線皆通過。
- `grep -rniE --exclude-dir=.git --exclude-dir=node_modules "sk-proj-[A-Za-z0-9_-]{20}|sk-[a-z0-9]{40}" .`：零命中。
