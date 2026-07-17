# td R71 menu gate summary

日期：2026-07-17（Asia/Taipei）

## 幾何與命中結果

| 視口 | 教學背景 | 背景控制 self-hit | modal 序列 | 顧問 drawer / dock 交疊 | 顧問 / dock 交疊 |
|---|---|---:|---|---:|---:|
| 1366×600 | `rgb(6, 16, 11)`，alpha 1 | 0 | tutorial → difficulty → map → settings | 0 px² | 0 px² |
| 390×844 | `rgb(6, 16, 11)`，alpha 1 | 0 | tutorial → difficulty → map → settings | 0 px² | 0 px² |

- 390×844 修正前診斷：顧問 drawer bottom 628px、dock top 599px，侵入 29px。
- 修正後顧問 drawer 依 dock 即時 top 保留 8px 安全距離，背景控制由 backdrop 與 inert 阻擋，顧問自身按鈕仍全部命中。
- 教學開啟時 `#appShell` 同時具 `inert` 與 `aria-hidden="true"`，背景 HUD／dock 的 `elementFromPoint` 不會命中自身。

完整量測見 `modal-interlock-measurements.json`。

## 閘門

- `npm test`：PASS
- `npm run test:e2e`：PASS（內含 R71/R66 控制守門、R68 地圖可見守門、三視口主 E2E）
- `npm run test:rwd`：PASS（主畫面／設定 × 9 視口，共 18 組）
- R71 控制守門：PASS（1366×600、390×844）
- R68 地圖可見守門：PASS（6 視口，canvas / dock 交疊 0）
- `git diff --check`：PASS
- 秘密掃描：ZERO MATCHES
