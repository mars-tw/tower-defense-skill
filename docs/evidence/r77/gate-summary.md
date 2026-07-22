# R77 Gate Summary

日期：2026-07-22（Asia/Taipei）

| Gate | 結果 | 摘要 |
|---|---|---|
| `npm run sim:r77 -- --profile=compare --seed-count=24 --out-dir=docs/evidence/r77 --quiet` | PASS | 24 seeds × 4 策略 × before/after × 8 波；65.1 秒；三份 JSON 重現成功 |
| `npm test` | PASS | exit 0；包含既有 `sim-balance` 50 波曲線、規則、動畫與資產守門；3.3 秒 |
| `npm run test:e2e` | PASS | 單次完整鏈：R72 → R66/R76 控制 → R68 → TD E2E；exit 0；266.6 秒 |
| `npm run test:rwd` | PASS | 9 視口 × 主頁／設定頁；18 組零違規、頁捲 0、水平溢出 0；48.7 秒 |
| 執行面舊版號 grep | PASS | `package/lock/README/index/manifest/offline/sw/src/scripts`：0 命中 |
| 秘密掃描 | PASS | 排除 `.git`、`node_modules` 與使用者既有未追蹤 playtest/audit 資料；常見 OpenAI/xAI/GitHub token 與 private-key pattern：0 命中 |
| `git diff --check` | PASS | exit 0 |

E2E 會覆寫歷史 evidence；本次執行後已把 R68/R71/R72 產物還原到 HEAD，只保留 `docs/evidence/r77/` 新證據。
