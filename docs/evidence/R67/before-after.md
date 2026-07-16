# R67 Before / After Evidence

輪次：td R67  
日期：2026-07-16

## 審計基線 Before

- P1-02 顧問非法格：Plains 0；Canyon 每難度各 60 個非法候選，首例 wave 1 frost/arrow at `(3,3)`；Lava 每難度各 60 個非法候選，首例 wave 1 frost/arrow at `(4,3)`。
- P1-03 生存模擬：Plains normal 19 / brutal 10 / endless 14；Canyon normal 19 / brutal 10 / endless 13；Lava normal 18 / brutal 10 / endless 13。
- P1-03 effective HP 震盪：W5 +96%、W6 -34%、W12 +163%、W15 -32%、W20 -29%。
- P1-04 技能空放：`castSkill()` 先扣 cooldown 與 `skillCasts`，再掃描敵人；觸控沒有等價取消。
- P1-05 教學：只有一段首玩說明，不能重訪，未覆蓋英雄、女神、詞綴與技能流程。

## R67 After

- 顧問非法格：`scripts/test-rules.js` 新增 R67 guard，三地圖、三難度、前 30 波 build action 全部避開 shared blocked cells，非法 0。
- 技能施放：`scripts/test-td-e2e.js` 驗證空放不扣 cooldown、不增加 `skillCasts`；有效命中才扣 cooldown，並產生命中特效。
- 觸控取消：E2E 驗證 `#skillCancelBtn` 顯示、點擊後解除 `pendingSkill` 且 cursor 回 default。
- 波次 after：`docs/evidence/R67/sim-balance-after.txt` 顯示 W12 +43%，Boss 谷底最低 -16%，Boss 後掉落最低 -24%。
- 生存 after：normal Plains 22 / Canyon 24 / Lava 24；brutal Plains 15 / Canyon 10 / Lava 12；endless Plains 19 / Canyon 18 / Lava 18。
- 教學 after：首玩與設定/工具入口皆可開啟六步實戰引導，覆蓋建塔、元素、女神/支援、英雄、詞綴與主動技能。
- 音效 after：WebAudio 程序化音效覆蓋建塔、命中、技能、UI、漏怪、波次與 Boss，設定可調音量。

## 截圖證據

- `docs/evidence/R67/after-desktop-tutorial.png`
- `docs/evidence/R67/after-tablet-settings-audio.png`
- `docs/evidence/R67/after-mobile-skill-cancel.png`

## Gate 輸出

- 平衡 after：`docs/evidence/R67/sim-balance-after.txt`
