# Codex 回應 — td R61 素材 P0 清償輪

## 結論

`GROK_ASSET_AUDIT.md` 的 P0-01～P0-07 共 **47 張**已全部交件：24 張基礎英雄四方向、9 張神話立繪、10 座塔、1 張無方向路徑磚、3 種缺檔敵人。遊戲定義與素材檔的塔／敵缺口皆歸零；46 張需合成的 sprite 全為 RGBA 且四角 A=0；`path.png` 為 audit 允許的不透明地板例外。

美術方向統一為 audit §8 指定的 **Eastern Dark Fantasy · Clean Game Sprite**：清楚深色描邊、中高飽和元素色、塔採 3/4 略俯視、戰場單位採全身 3/4、神話卡面採高密度全身英雄構圖。方向英雄是四個獨立朝向的靜態姿勢，**不是走路／攻擊／受擊動畫幀，亦未宣稱為動畫**；本輪沒有用整圖位移、縮放或上下晃動冒充角色動畫。

## P0 對照

| Audit ID | 交付 | 達成證據 |
|---|---|---|
| P0-01 | `knight`、`archer`、`mage`、`iceMage`、`valkyrie`、`cleric` × down/up/left/right，共 24 張 | 全部 512×512 RGBA；同角四色、體型、武器一致；四角 A=0；無白底；[四方向接觸表](evidence/R61/asset-hero-directions.png) |
| P0-02 | `daji`、`guanyu`、`wukong`、`nezha` 升規 | 全部 1024×1024 RGBA premium；狐尾、青龍偃月刀、金箍棒、風火輪皆保留；[九神話並排](evidence/R61/asset-myths.png) |
| P0-03 | `leizhenzi`、`niumowang`、`baisuzhen`、`erlangshen`、`zhongkui` 真透明化 | 保留 premium 主體，移除烤黑底；四角 A=0；無半透明黑底板；[九神話並排](evidence/R61/asset-myths.png) |
| P0-04 | 缺檔 `poison`、`support`、`beacon`、`mortar` | 毒囊霧爐／聖光立柱無槍口／引魂燈籠／高仰角粗短臼砲的剪影與色錨均完成；[十塔並排](evidence/R61/asset-towers.png) |
| P0-05 | 既有 `arrow`、`cannon`、`frost`、`tesla`、`sniper`、`arcane` 重繪 | 10 塔同批語言、同視角、真透明；箭塔無站台小人，cannon 平射、mortar 高仰角，frost 厚底，tesla 電弧內收；[十塔並排](evidence/R61/asset-towers.png) |
| P0-06 | `assets/tiles/path.png` | 1024×1024 無方向泥土 fill；左右與上下邊界逐通道差值 max=0、mean=0；[2×2 平鋪](evidence/R61/asset-path-2x2.png) |
| P0-07 | 缺檔 `silencer`、`mirrorling`、`warden` | 封口符僧、孩童碎鏡、巨型門盾守門人的剪影已完成；全部 512×512 RGBA；[三敵接觸表](evidence/R61/asset-new-enemies.png) |

缺檔存在性另由既有結構測試驗證：`TOWERS=10`、`ENEMIES=18`，Service Worker APP_SHELL 本地檔案缺失數為 **0**。

## Audit 同口徑技術量測

量測方法：

- 四角 alpha：Windows `System.Drawing.Bitmap.GetPixel`，與 audit §1.1 相同方法。結果為需透明 sprite **46/46 四角皆 A=0**、失敗 0。
- 白底殘留：以 Pillow/Numpy 掃描全圖；判定為外框 8px 內 `A≥250 且 RGB 各≥245` 的像素。這能抓到連到畫布邊界的實心白底，同時不把冰法師／牧師衣服內部的合法白色高光誤判。結果 **47/47 whiteBorderPx=0**。
- `A0% / partial%`：全像素的完全透明／半透明比例，用來證明不是把背景塗黑；`partial%` 是抗鋸齒邊緣，不是實心底。
- 檔案預算：audit §8.5 為「runtime 建議 <200KB、master 可較大」；本輪依 P0 尺寸交付 master，未以降解析或破壞透明邊緣換取假達標。audit 自身把全庫體積優化列為 P2-04，本輪不擴做 P2。方向英雄均在 200KB 內；其餘 master 的實際 bytes 如下，無隱藏。

### P0-01：24 張方向英雄

| 檔案 | 尺寸/格式 | 四角 A | A0% / partial% | whiteBorderPx | bytes |
|---|---:|---:|---:|---:|---:|
| `knight/down.png` | 512² RGBA | 0/0/0/0 | 72.8188 / 2.5459 | 0 | 155,545 |
| `knight/up.png` | 512² RGBA | 0/0/0/0 | 72.8771 / 2.5764 | 0 | 148,664 |
| `knight/left.png` | 512² RGBA | 0/0/0/0 | 81.3587 / 1.7509 | 0 | 110,758 |
| `knight/right.png` | 512² RGBA | 0/0/0/0 | 81.2935 / 1.7376 | 0 | 111,970 |
| `archer/down.png` | 512² RGBA | 0/0/0/0 | 76.7494 / 2.8748 | 0 | 152,737 |
| `archer/up.png` | 512² RGBA | 0/0/0/0 | 76.6369 / 2.4361 | 0 | 143,563 |
| `archer/left.png` | 512² RGBA | 0/0/0/0 | 81.3732 / 2.3544 | 0 | 122,285 |
| `archer/right.png` | 512² RGBA | 0/0/0/0 | 81.2592 / 2.4807 | 0 | 122,599 |
| `mage/down.png` | 512² RGBA | 0/0/0/0 | 67.1875 / 3.1227 | 0 | 199,391 |
| `mage/up.png` | 512² RGBA | 0/0/0/0 | 68.0794 / 2.9404 | 0 | 185,153 |
| `mage/left.png` | 512² RGBA | 0/0/0/0 | 75.3902 / 2.9339 | 0 | 151,950 |
| `mage/right.png` | 512² RGBA | 0/0/0/0 | 76.0807 / 2.7954 | 0 | 146,531 |
| `iceMage/down.png` | 512² RGBA | 0/0/0/0 | 75.8575 / 2.1389 | 0 | 128,671 |
| `iceMage/up.png` | 512² RGBA | 0/0/0/0 | 77.2503 / 2.0302 | 0 | 118,072 |
| `iceMage/left.png` | 512² RGBA | 0/0/0/0 | 80.5000 / 2.0622 | 0 | 107,760 |
| `iceMage/right.png` | 512² RGBA | 0/0/0/0 | 80.8380 / 1.9405 | 0 | 105,637 |
| `valkyrie/down.png` | 512² RGBA | 0/0/0/0 | 76.3920 / 3.2318 | 0 | 147,522 |
| `valkyrie/up.png` | 512² RGBA | 0/0/0/0 | 76.6907 / 3.1940 | 0 | 139,185 |
| `valkyrie/left.png` | 512² RGBA | 0/0/0/0 | 80.5733 / 2.6825 | 0 | 122,469 |
| `valkyrie/right.png` | 512² RGBA | 0/0/0/0 | 80.5347 / 2.7012 | 0 | 122,221 |
| `cleric/down.png` | 512² RGBA | 0/0/0/0 | 71.8071 / 2.5215 | 0 | 184,468 |
| `cleric/up.png` | 512² RGBA | 0/0/0/0 | 71.9448 / 2.5223 | 0 | 171,943 |
| `cleric/left.png` | 512² RGBA | 0/0/0/0 | 77.7256 / 2.4590 | 0 | 143,056 |
| `cleric/right.png` | 512² RGBA | 0/0/0/0 | 77.8408 / 2.4658 | 0 | 140,665 |

### P0-02／P0-03：9 張神話立繪

| 檔案 | 尺寸/格式 | 四角 A | A0% / partial% | whiteBorderPx | bytes |
|---|---:|---:|---:|---:|---:|
| `daji.png` | 1024² RGBA | 0/0/0/0 | 47.2729 / 2.9644 | 0 | 1,476,467 |
| `guanyu.png` | 1024² RGBA | 0/0/0/0 | 47.2598 / 6.9313 | 0 | 1,460,803 |
| `wukong.png` | 1024² RGBA | 0/0/0/0 | 62.3074 / 5.6504 | 0 | 1,167,620 |
| `nezha.png` | 1024² RGBA | 0/0/0/0 | 52.9048 / 5.9374 | 0 | 1,373,561 |
| `leizhenzi.png` | 1024² RGBA | 0/0/0/0 | 62.0230 / 0.0000 | 0 | 643,909 |
| `niumowang.png` | 1024² RGBA | 0/0/0/0 | 74.4291 / 0.0000 | 0 | 540,502 |
| `baisuzhen.png` | 1024² RGBA | 0/0/0/0 | 62.8661 / 0.0000 | 0 | 690,550 |
| `erlangshen.png` | 1024² RGBA | 0/0/0/0 | 70.0792 / 0.0000 | 0 | 621,534 |
| `zhongkui.png` | 1024² RGBA | 0/0/0/0 | 42.0804 / 0.0000 | 0 | 572,100 |

五張原 premium 圖的 `partial%=0` 是高品質硬邊去背結果；背景區域為真 A=0，不是塗黑。四張升規新圖保留部分 alpha 抗鋸齒邊緣。

### P0-04／P0-05：10 座塔

| 檔案 | 尺寸/格式 | 四角 A | A0% / partial% | whiteBorderPx | bytes |
|---|---:|---:|---:|---:|---:|
| `arrow.png` | 1024² RGBA | 0/0/0/0 | 64.9862 / 1.4501 | 0 | 966,820 |
| `cannon.png` | 1024² RGBA | 0/0/0/0 | 60.6858 / 0.8789 | 0 | 1,094,263 |
| `frost.png` | 1024² RGBA | 0/0/0/0 | 67.8706 / 1.1010 | 0 | 922,851 |
| `tesla.png` | 1024² RGBA | 0/0/0/0 | 61.3571 / 1.6596 | 0 | 1,065,300 |
| `poison.png` | 1024² RGBA | 0/0/0/0 | 65.3175 / 1.5609 | 0 | 959,405 |
| `support.png` | 1024² RGBA | 0/0/0/0 | 62.6054 / 1.5027 | 0 | 1,078,862 |
| `beacon.png` | 1024² RGBA | 0/0/0/0 | 69.5034 / 1.9558 | 0 | 863,483 |
| `sniper.png` | 1024² RGBA | 0/0/0/0 | 73.7073 / 1.2794 | 0 | 804,786 |
| `arcane.png` | 1024² RGBA | 0/0/0/0 | 69.9619 / 1.2419 | 0 | 853,063 |
| `mortar.png` | 1024² RGBA | 0/0/0/0 | 60.7362 / 0.9121 | 0 | 1,092,143 |

### P0-06：路徑磚

| 檔案 | 尺寸/格式 | 四角 A | whiteBorderPx | bytes | 平鋪邊界差 |
|---|---:|---:|---:|---:|---:|
| `path.png` | 1024² RGB | 255/255/255/255（地板例外） | 0 | 1,053,811 | LR max=0, mean=0；TB max=0, mean=0 |

### P0-07：3 種缺檔敵人

| 檔案 | 尺寸/格式 | 四角 A | A0% / partial% | whiteBorderPx | bytes |
|---|---:|---:|---:|---:|---:|
| `silencer.png` | 512² RGBA | 0/0/0/0 | 61.1481 / 6.9378 | 0 | 296,867 |
| `mirrorling.png` | 512² RGBA | 0/0/0/0 | 64.6744 / 6.2267 | 0 | 283,512 |
| `warden.png` | 512² RGBA | 0/0/0/0 | 48.0499 / 4.1294 | 0 | 360,640 |

## 宣傳／首局肉眼驗收

本輪先以接觸表驗證同類風格，再以實際遊戲流程選普通難度、翠綠平原，建造弓箭／寒冰／毒霧三塔並啟動第 1 波。不是 mock canvas，也沒有用測試注入直接改遊戲狀態。

| 視口 | 首局畫面 | 塔防戰鬥 |
|---|---|---|
| 桌機 1440×900 | [desktop-first.png](evidence/R61/desktop-first.png) | [desktop-battle.png](evidence/R61/desktop-battle.png) |
| 平板 820×1180 | [tablet-first.png](evidence/R61/tablet-first.png) | [tablet-battle.png](evidence/R61/tablet-battle.png) |
| 手機 390×844 | [mobile-first.png](evidence/R61/mobile-first.png) | [mobile-battle.png](evidence/R61/mobile-battle.png) |

三視口戰鬥圖可直接肉眼確認：塔、英雄、敵人都不再帶白／黑／紫色方形底板；新路徑磚在直線與轉角使用同一無方向 dirt fill；十塔與首波英雄採同一清晰深描邊、中高飽和的遊戲 sprite 語言。audit §11 將 `cover／goddess／icons` 明列為 P2-07，因此依「本輪只做 P0」未更動 cover。

## 版本、離線與測試

| 驗收 | 結果 |
|---|---|
| npm / PWA 版本 | `0.6.1` / `td-r61-v1` |
| 舊版號掃描 | 兩個上一版精確 token 全庫掃描（排除 `.git`）：0 命中 |
| `npm test` | PASS；結構、設定、英雄、規則、排行榜／成就、平衡、世界觀全綠；APP_SHELL 缺檔 0 |
| `npm run test:e2e` | PASS；桌機、平板、手機、1366×700 矮桌機全綠；console error / pageerror 0 |
| `npm run test:rwd` | PASS；2 頁 × 9 視口全數零違規、頁捲 0、水平溢出 0 |
| `git diff --check` | PASS |
| 秘密掃描 | 交件前以使用者指定 regex 排除 `.git` 執行；0 命中 |

依需求未做任何 wall-time／效能結論；上表只記錄功能、素材品質與測試 pass/fail。

## 交件範圍

- 版本與離線快取已更新；7 張新缺檔素材加入 Service Worker APP_SHELL。
- `docs/evidence/R61/` 共 11 張證據：5 張接觸／平鋪圖、3 個視口的首局與戰鬥共 6 張。
- 產圖流程採用單色 key 背景後建立 alpha mask；成品是 RGBA 真透明，未把白底改成黑底。
- 本輪只修改 P0 素材、R61 版本／離線清單、驗收證據與報告；沒有 push。
