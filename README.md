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
- **無盡隨機波次**：一波波無限生成、難度遞增，Boss 週期依難度為 5/4/3 波，比拼最高波數與分數
- **4 種砲塔 + 升級**：弓箭塔(單體高速)、加農砲(範圍爆破)、寒冰塔(減速控場)、電磁塔(穿透連鎖)
- **元素克制**：火🔥 / 冰❄️ / 雷⚡ 互克（火克冰、冰克雷、雷克火），放塔要考慮屬性搭配
- **主動技能**：隕石術、冰封術、雷暴術，有冷卻，緊急時手動施放
- **排行榜與成就**：各難度保留前 10 名紀錄，長期成就提供一次性魂晶獎勵
- **可擴充美術**：統一設定檔 `art-config.json` + Grok CLI 生成

## 🎯 玩法

1. 選一種砲塔 → 點地圖空格建造（不能蓋在路徑上）
2. 點「開始下一波」→ 怪物沿路徑前進，砲塔自動攻擊
3. 擊殺賺金錢 → 升級砲塔 / 蓋更多塔
4. 守住基地（生命歸零就結束）→ 撐越多波越高分！
5. 點「🏆 排行榜/成就」查看各難度前 10 名與長期目標

> 訣竅：把塔貼著路徑轉角放（覆蓋更多路段）、用元素克制（對冰怪用火塔）、
> 寒冰塔減速 + 加農砲範圍是經典組合。

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
| `src/config.js` | ★ 資料層：塔/怪/技能/元素克制/平衡 |
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
- 砲塔升級、賣出、主動技能 ✅

## 🛠️ 加塔 / 加怪 / 調平衡

改 `src/config.js` 即可，細節見 [references/data-model.md](references/data-model.md)。

## 🔥 難度與挑戰

三種難度，主流可過 + 高難挑戰：

- 🛡️ **普通**：輕鬆上手，享受塔防樂趣
- 🔥 **嚴酷**：敵人更強、資源更緊、Boss 更頻繁，需要真正研究塔陣搭配
- 💀 **無盡煉獄**：極限挑戰，比拼最高波數

各難度獨立記錄最高波數與前 10 名排行榜，死亡時可一鍵複製戰績分享。成就包含波數里程碑、累計擊殺、累計場次與英雄全收集。

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
