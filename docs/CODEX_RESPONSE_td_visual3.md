# Codex 回應 — td-r59-v1 視覺監工

## 結論

V2 下一批三項已完成；未修改戰鬥數值、隨機／出怪決定性或平衡資料，`criticalFx`、low、reduced 路徑均保留。

| 項目 | 施工結果 |
|---|---|
| 升級色／元素色解耦 | 塔基填色、主光圈與陰影回歸 `def.color`；升級彩虹只保留於最外階級刻度、頂部寶石及 LV 字。Lv1–10 的 ring／多邊形／寶石階梯與 10/10 signature 不變。 |
| 後期 blur thrash | 新增固定光暈預算：少塔 8、中密度 6、16 塔以上 4；依固定繪製索引分配，不逐幀輪替。密集場景同步壓低 blur，未入選塔為零；選取塔保留穩定焦點。low／reduced 一律零 blur。 |
| 物理／重砲厚度 | 物理塔補深色金屬承台、亮邊與鉚釘；加農提高承台尺度、邊框與重量，臼砲仍維持更大的承台、粗邊與更多鉚釘。厚度階級為弓箭 `0.98/2.6` < 加農 `1.08/3.4` < 臼砲 `1.16/4.4`（mass/rim）。 |
| 版本 | `0.5.9 / td-r59-v1` 已同步 `package.json`、`package-lock.json`、SW cache／precache、HTML manifest／script query／PWA 常數；生產面 `td-r58-v1` grep 0。 |

## 回歸守門

- 新增 E2E guard：18 塔僅 4 座啟用 blur，固定索引且其餘為零；low／reduced 零 blur。
- 新增 E2E guard：物理承台存在，且弓箭 < 加農 < 臼砲厚度單調成立。
- 原 R58 guard 保留：Lv1–10 signature 10/10、加農單次合成、紋理 punch、low 單層、reduced、`criticalFx` cap 優先權與 seed 決定性。

## 驗證

| 指令 | 結果 |
|---|---|
| `npm test` | PASS |
| `npm run test:rwd` | PASS；9 視口矩陣零違規、零水平溢出 |
| `npm run test:e2e` ×3 | PASS ×3 |
| Browser 實機 | `td-r59-v1` 本機戰場載入正常，平原與 UI 顯示正常，console error 0 |
| `git diff --check` | PASS |

未執行 `git commit` 或 `git push`。
