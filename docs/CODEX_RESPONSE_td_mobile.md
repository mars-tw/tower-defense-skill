# Codex 回應 — td-r57-v1 手機端

## 結論

| 項目 | 處理 |
|---|---|
| M-T1 P0 | 手機直式 Canvas 固定 724px 寬，48 邏輯 px 格位實測 **36.2 CSS px**；戰場視窗可雙軸平移。拖曳超過 10px 不觸發 tap，顧問幽靈格會自動捲入可視區，觸控仍維持二次確認。桌面/橫向規則不變。 |
| M-T2/T3 | `#selPanel` 在 ≤900px 改為底部 fixed 浮動面板；升級/賣出按鈕 **48px**。桌面仍在原側欄。 |
| 效能 P1 | auto 降級改為連續 2 個低 FPS 樣本；low 模式關閉高成本 `shadowBlur`、建塔格省略逐格 stroke、關鍵爆裂再縮量。未改固定 960×640 世界座標。 |
| safe-area | 加入 `viewport-fit=cover`；body、浮動升級面板與底部區域使用 `safe-area-inset-*`。 |
| PWA | 補 iOS web-app meta / apple touch icon、Android `beforeinstallprompt` 安裝入口、iOS「分享→加入主畫面」提示；maskable purpose 獨立。 |
| 版本 | `0.5.5` → `0.5.7`；PWA/SW/資產 query 已同步至 `td-r57-v1`。生產版本面 grep 舊版 **0**。 |

決定性、經濟、敵我數值、塔平衡與世界座標均未改。

## Guard / 驗證

- `npm test`：PASS（含 sim-balance）。
- `npm run test:rwd`：PASS，9 視口 × 主頁/設定；新增手機格位 ≥36px、戰場可捲、浮動升級與 44px 觸控 guard。
- `npm run test:e2e`：**3/3 PASS**；含手機二次建塔、顧問建造/升級、決定性、PWA/SW、無 console error。
- Browser 390×844：格位 36.2px、戰場 724×482.7、容器 378.4×388.2、頁級溢出 0。
- `git diff --check`：PASS；未 commit / push。

## 延後

- M-P1 手機動態降低 Canvas 內部解析度：會牽動世界座標映射與回放/決定性風險，本輪保留 960×640，以 low-mode 繪製降載代替。
- M-W4 戰鬥中更新策略、M-W6 manifest screenshots 與 P2 culling/path bake：不影響本輪 P0 主路徑，後續獨立處理。
