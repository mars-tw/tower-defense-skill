# 素材來源與授權

本文件盤點遊戲執行時使用的素材與開發期第三方工具。R61 目前在 `assets/` 內共有 88 個檔案：82 個專案自有／專案製作素材，以及 6 個 Kenney CC0 粒子素材。

## 專案自有與 AI 輔助素材

除下方列出的 Kenney Particle Pack 六個檔案外，`assets/` 內的圖像均為本專案專用素材，未從其他遊戲或商業素材包抽取。

專案製作流程曾使用生成式 AI（包含 GPT 圖像生成）並由維護者進行裁切、去背、調色、縮圖、方向拆分與遊戲整合；以下目錄含 AI 產出或 AI 輔助圖像：

- `assets/heroes/`：英雄四方向圖與神話英雄立繪。
- `assets/enemies/`：敵人與 Boss 圖像。
- `assets/towers/`：R61 統一風格的十座塔。
- `assets/core/`、`assets/skills/`、`assets/cover.png`：女神、技能與宣傳圖。

`assets/icons/`、`assets/projectiles/` 與 `assets/tiles/` 為本專案製作或由專案素材衍生的介面／戰鬥素材；早期提交沒有逐檔保存生成方式，因此不對其作更細的 AI／手繪分類。R61 的生成與後製驗收細節見 [R61 素材報告](docs/CODEX_RESPONSE_td_R61.md)。

上述專案素材由 mars-tw 隨本專案依 [MIT License](LICENSE) 提供（以權利可授權的範圍為限）。神話人物名稱與傳說題材來自民間故事／古典文學；本專案未使用第三方遊戲角色圖或商標素材。

## Kenney Particle Pack

- 作者：Kenney Vleugels（Kenney.nl）
- 來源：[Kenney Particle Pack](https://kenney.nl/assets/particle-pack)
- 素材包版本：1.1
- 授權：[Creative Commons Zero 1.0 Universal（CC0 1.0）](https://creativecommons.org/publicdomain/zero/1.0/)

使用並重新命名的透明 PNG：

| 原始檔名 | 專案路徑 |
|---|---|
| `fire_01.png` | `assets/particles/kenney-fire.png` |
| `smoke_04.png` | `assets/particles/kenney-smoke.png` |
| `flare_01.png` | `assets/particles/kenney-flash.png` |
| `magic_03.png` | `assets/particles/kenney-magic.png` |
| `spark_06.png` | `assets/particles/kenney-spark.png` |
| `circle_02.png` | `assets/particles/kenney-ice-ring.png` |

遊戲會在 Canvas 執行時對這些紋理套色與合成。原始壓縮包、解壓內容與授權副本保留於 gitignored 的 `tools/` 目錄，不隨發行版提交。

## 第三方開發工具

- [Playwright](https://playwright.dev/) `^1.61.1`：僅供 E2E／RWD 測試使用，採 Apache License 2.0；不會打包進遊戲執行階段。

遊戲介面中的 Unicode emoji 由玩家作業系統／瀏覽器字型呈現，repo 未散布 emoji 字型檔。
