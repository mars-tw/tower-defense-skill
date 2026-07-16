# td R69 清理輪簡報

日期：2026-07-16

## 完成項目

- `art-config.json` 已同步實際內容：10 塔、18 敵、15 英雄、3 地圖，並保留 skills/core/tiles 生成清單。
- 新增 `scripts/test-art-config.js`，納入 `npm test`，防止 art-config 再次與實際單位清單脫節。
- `scripts/gen-heroes.ps1` 生成提示已由白底改為透明背景。
- R69 版本同步：`0.6.9` / `td-r69-v1`，涵蓋 `package.json`、lockfile、README、index、SW、UI fallback。
- 快清 audit P2 小項：
  - 塔陣顧問關閉後可用「顯示顧問」恢復。
  - 戰鬥 log 預設維持短列，但保留最近 20 條並可點擊展開。
  - 手機建塔 dock 加入 1 字短名，不再只靠圖示與價格。
  - README 補齊 R63/R65/R66/R68/R69 最新功能摘要。

## 驗收

- `npm test`：PASS
- `npm run test:e2e`：PASS
- `npm run test:rwd`：PASS
- 秘鑰樣式掃描：0 命中

## 備註

- `npm run test:e2e` 會重跑 R68 map visibility evidence，因此本輪包含重新產生的 R68 截圖與量測 JSON。
- 本輪只做本地 commit，不 push。
