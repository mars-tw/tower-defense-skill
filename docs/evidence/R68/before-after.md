# td R68 地圖完整顯示 Before / After

日期：2026-07-16

## P0 修正前

- 視口：1366×600，非觸控桌機。
- canvas：`266.2,104.9 → 852.2,495.9`，CSS 尺寸 `586×391`。
- R64/R66 dock：`69.2,354 → 1049.2,486`。
- canvas 與 dock 交疊：寬 `586px`、高 `132px`；canvas 下方格列被 UI 蓋住且無法命中。
- 截圖：[before-1366x600-overlap.png](before-1366x600-overlap.png)

## R68 修正後

- 1366×600 canvas：`101,105 → 699,504`，CSS 尺寸 `598×399`；內部尺寸仍為 `960×640`。
- dock 改為右側保留欄：`798,105 → 1110,504`，`position: relative`。
- canvas/dock 交疊面積：`0px²`。
- canvas 四角（各內縮 4–8px）與中心 `elementFromPoint`：5/5 全命中 `#game`。
- canvas、dock 均完整在視口內；戰場 host X/Y 內捲皆為 0。

## 六視口量測

| 視口 | canvas CSS 尺寸 | dock 位置 | 四角＋中心 | 交疊 | host 內捲 |
|---|---:|---|---:|---:|---:|
| 1920×1080 | 1099×733 | 下方保留列 | 5/5 | 0px² | 0×0 |
| 1440×780 | 851×567 | 右側保留欄 | 5/5 | 0px² | 0×0 |
| 1366×600 | 598×399 | 右側保留欄 | 5/5 | 0px² | 0×0 |
| 1280×640 | 658×439 | 右側保留欄 | 5/5 | 0px² | 0×0 |
| 390×844 | 378×252 | 下方保留列 | 5/5 | 0px² | 0×0 |
| 844×390 | 399×266 | 右側保留欄 | 5/5 | 0px² | 0×0 |

原始量測：[map-visibility-measurements.json](map-visibility-measurements.json)

## 三視口 After 截圖

- [after-desktop-1366x600-full-map.png](after-desktop-1366x600-full-map.png)
- [after-mobile-390x844-full-map.png](after-mobile-390x844-full-map.png)
- [after-landscape-844x390-full-map.png](after-landscape-844x390-full-map.png)

## 效能

代表性重負載為 18 隻同場敵人（含 1 Boss），先暖機 atlas/tint cache，再量每幀 `update + render` CPU 成本；每視口 3 跑、每跑 120 幀，取 p95 的中位數。

- 桌機 1440×780：16.90 / 15.20 / 15.50ms，中位 `15.50ms`。
- 手機 390×844：14.10 / 14.90 / 14.80ms，中位 `14.80ms`。
- 門檻：兩者皆 ≤18ms，PASS。

原始輸出：[performance-gate.txt](performance-gate.txt)
