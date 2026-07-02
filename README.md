# 🏰 tower-defense — 無盡塔防遊戲的 Claude Code Skill

[![CI & Deploy Pages](https://github.com/mars-tw/tower-defense-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/mars-tw/tower-defense-skill/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Play Online](https://img.shields.io/badge/🎮_線上試玩-Pages-brightgreen)](https://mars-tw.github.io/tower-defense-skill/)

一個 [Claude Code](https://claude.com/claude-code) **Skill**，幾分鐘內生出**純原生（零依賴）**的
Canvas 2D 無盡塔防遊戲。只用 HTML + CSS + 原生 JavaScript + Canvas 2D——零框架、零 npm、零建置。

> 作者：**阿軒** ([@mars-tw](https://github.com/mars-tw)) · 授權：MIT

### 🎮 線上直接玩（不用安裝）

**👉 https://mars-tw.github.io/tower-defense-skill/**

---

## ✨ 功能特色

- **👸 守護女神核心**：終點站著要守護的女神，怪物漏過會攻擊她。可花金升級加生命上限、解鎖「聖光反擊」（自動攻擊靠近終點的敵人）
- **快速開始與放塔預覽**：首次遊玩可一鍵用普通＋翠綠平原進場；選塔後即時顯示幽靈塔、射程圈與不可放原因，手機採二段式確認
- **無盡隨機波次**：一波波無限生成、難度遞增，Boss 週期依難度為 5/4/3 波，比拼最高波數與分數
- **6 種砲塔 + 升級**：弓箭塔、加農砲、寒冰塔、電磁塔、毒霧塔(疊毒 DoT)、聖光塔(範圍增傷支援)
- **9 種敵人**：史萊姆、哥布林、獸人、蝙蝠群、冰霜狼、火焰小鬼、盾兵、醫官與 Boss。盾兵有護盾，醫官會治療周圍敵人
- **雙地圖選擇**：翠綠平原是標準資源路線；迂迴峽谷路徑更長但資源較少，適合挑戰
- **元素克制**：火🔥 / 冰❄️ / 雷⚡ 互克（火克冰、冰克雷、雷克火），放塔要考慮屬性搭配
- **主動技能**：隕石術、冰封術、雷暴術，有冷卻，緊急時手動施放
- **排行榜與成就**：各難度保留前 10 名紀錄，長期成就提供一次性魂晶獎勵
- **抽英雄節奏**：首抽免費、20💎 單抽、18 抽保底傳說、重複英雄退 12💎；死亡結算與十波首通獎勵能推動下一局成長
- **可擴充美術**：統一設定檔 `art-config.json` + Grok CLI 生成

## 🎯 玩法

1. 首次遊玩點「快速開始（普通＋翠綠平原）」；老玩家可照常選難度與地圖
2. 選一種砲塔 → 看幽靈塔與射程圈 → 點地圖空格建造（不能蓋在路徑上）
3. 至少蓋一座塔後點「開始下一波」→ 怪物沿路徑前進，砲塔自動攻擊
4. 擊殺賺金錢 → 升級砲塔 / 蓋更多塔
5. 戰敗結算拿魂晶；魂晶足夠可直接「立即抽英雄」並帶英雄再開局
6. 點「🏆 排行榜/成就」查看各難度前 10 名與長期目標

> 訣竅：把塔貼著路徑轉角放（覆蓋更多路段）、用元素克制（對冰怪用火塔）、
> 寒冰塔現在更便宜、控場更早成形；後期把聖光塔放在主力塔群中心，毒霧塔用來處理高血目標。

## 🚀 本地執行

```bash
# 在 tower-defense 根目錄起 server
python -m http.server 8000
# 開 http://localhost:8000/index.html
```

> ⚠️ 用 HTTP server 開（不要 file://），server 開在 repo 根目錄。

## 📁 結構

| 路徑 | 說明 |
|------|------|
| `SKILL.md` | Skill 主檔 |
| `src/config.js` | ★ 資料層：塔/怪/技能/地圖/元素克制/平衡 |
| `src/rules.js` | 純規則函式：波次組隊、難度係數、meta 遷移、死亡結算、排行榜、成就 |
| `src/game.js` | 核心引擎：Canvas 渲染、遊戲迴圈、波次、戰鬥 |
| `src/ui.js` | HUD、建塔選單、技能列、升級面板 |
| `art-config.json` | 美術生成設定 |
| `scripts/gen-art.ps1` | 用 Grok 生成美術 |
| `references/data-model.md` | 加塔/加怪/調平衡說明 |

## 🎨 生成美術

未生圖時用 Emoji 佔位，遊戲完整可玩。要生美術：

```powershell
cd tower-defense
.\scripts\gen-art.ps1 -Group towers   # 砲塔
.\scripts\gen-art.ps1                   # 全部
```

## ✅ 已驗證（Playwright + Node）

- 核心循環：建塔、開波、塔自動射擊、元素傷害、擊殺得金、波次循環 ✅
- 無盡波次：難度隨波遞增、Boss 週期依難度 5/4/3 波 ✅
- 元素克制：火克冰 1.5×、冰被火克 0.66× ✅（Node 測）
- 排行榜/成就：進榜、解鎖、一次性魂晶獎勵、overlay 暫停恢復 ✅
- 砲塔升級、賣出、主動技能、雙地圖選擇、毒素 DoT、聖光塔 buff、放塔預覽、手機二段式建塔 ✅

## 🛠️ 加塔 / 加怪 / 調平衡

改 `src/config.js` 即可，細節見 [references/data-model.md](references/data-model.md)。

## 🔥 難度與挑戰

三種難度，主流可過 + 高難挑戰：

- 🛡️ **普通**：輕鬆上手，享受塔防樂趣
- 🔥 **嚴酷**：敵人更強、資源更緊、Boss 更頻繁，需要真正研究塔陣搭配
- 💀 **無盡煉獄**：極限挑戰，比拼最高波數

各難度獨立記錄最高波數與前 10 名排行榜，死亡時可一鍵複製戰績分享。成就包含波數里程碑、十波首通、累計擊殺、累計場次與英雄全收集。死亡魂晶依難度為普通 `wave × 1.8`、嚴酷 `wave × 2.4`、無盡 `wave × 2.2`，第 10 波首通另給 20💎。

## 📢 徵集你的攻略！

撐到高波數了嗎？**嚴酷/無盡難度怎麼過？** 歡迎到
[Discussions](https://github.com/mars-tw/tower-defense-skill/discussions)
分享你的塔陣搭配、英雄組合、過關攻略，讓大家膜拜你的戰術！

> 💡 攻略提示：善用元素克制（火克冰、冰克雷、雷克火）、寒冰塔減速 + 其他塔增傷的協同、
> 連殺累積金錢、把塔放在路徑轉角覆蓋更多路段。

## 🤝 貢獻

歡迎 issue 與 PR！

## 📄 授權

[MIT](LICENSE) © 2026 阿軒 ([@mars-tw](https://github.com/mars-tw))
