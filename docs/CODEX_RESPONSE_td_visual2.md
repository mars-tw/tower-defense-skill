# Codex 回應 — td-r58-v1 視覺監工

已依 `GROK_REVIEW_td_V1` 完工；未改平衡、玩法 RNG 或決定性邏輯，未 commit／push。

| 項目 | 結果 |
|---|---|
| 塔 Lv1–10 | 改為 10 色細分、逐級增大寶石、1→5 環、奇偶實／虛線；段位底座 4→14 邊、寶石 4／6／5 邊。Lv1 現在確實畫出 `ringCount=1`；每級 signature 唯一。 |
| 命中曲線 | flash 實際 `startLife ≥ 0.28s`，出生前段滿亮並 `1.15→0.85` 收縮；body `0.94→1.06`，smoke `0.82→1.18`。tint 回乘原圖灰階並補 screen 高光，保留材質體積。 |
| 加農 | splash 從每怪 fire 雙層改為爆心一次 `cannon-impact`；臼砲中心三層維持。 |
| 地圖 | plains tint `0.035→0.12`；腳印／石板對比提高；高特效戰鬥中加入極弱 ambient，波間呼吸仍較強。 |
| 保護 | `criticalFx`、low 單層、reduced 全關紋理／呼吸皆保留。 |
| 版本 | `0.5.8 / td-r58-v1` 已同步 package、SW cache／precache、HTML manifest／script query／PWA 常數；生產版本面舊字串 grep 0。 |

驗證：Browser 實機目視 Lv1 灰虛線環、Lv2 藍實線／六角底座與平原 tint，console error 0。新增 E2E 守門：10 級 signature 唯一、Lv1 環、flash 曲線／壽命、加農爆心單次、plains tint。

`npm test`、`npm run test:rwd`、`npm run test:e2e` 依序跑 3 輪，9/9 PASS；`git diff --check` PASS。
