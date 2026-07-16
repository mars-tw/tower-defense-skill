# 無盡塔防 R67 全面優化計畫

輪次代號：td R67  
日期：2026-07-16  
依據：`C:\Users\digimkt\.claude\skills\game-optimization-round\SKILL.md`、`docs/AUDIT_full.md`、`AGENTS.md`

## 八大面向對照與本輪驗收

1. 美術
   - 現況：R65 已完成塔與地圖像素精緻化，本輪不重畫核心素材。
   - 本輪項目：新增技能命中特效與輕量程序化音效，避免技能空放沒有回饋。
   - 驗收：技能有效命中時有粒子/閃光與音效；建塔、命中、技能、波次、Boss、UI 有 WebAudio 程序化音效入口。

2. 按鈕
   - 現況：R66 控制守門已存在，審計要求本輪驗不回歸。
   - 本輪項目：技能瞄準中提供觸控可見取消按鈕；音量設定使用可點控制。
   - 驗收：`npm run test:e2e` 內的 R66 控制守門綠；`npm run test:rwd` 綠；技能取消按鈕不遮擋主控列。

3. 選單
   - 現況：首玩教學過短，複雜系統缺少可重訪引導。
   - 本輪項目：把首玩教學升級成可重訪實戰引導，覆蓋建塔、元素克制、英雄、女神、詞綴、技能。
   - 驗收：設定/教學入口可重新開啟；引導可略過、可下一步、可關閉；新手流程不形成 modal 死路。

4. 人物
   - 現況：R62/R63 已有敵人與英雄真幀動畫守門；本輪只守不回歸。
   - 本輪項目：不新增人物假動畫，不用單圖平移/縮放冒充動作。
   - 驗收：`npm test` 中 `test-enemy-animation` 與 `test-hero-animation` 綠。

5. 地圖模型
   - 現況：`rules.js` 顧問候選格與 `game.js` blocked path 判定不同，峽谷/熔岩會推薦非法格。
   - 本輪項目：抽出共用 blocked path 純函式，顧問與實際建造使用同一套判定。
   - 驗收：每張地圖、每個難度前 30 波顧問 build action 都不可落在 blocked cell；新增/更新測試覆蓋 Canyon/Lava。

6. 技能
   - 現況：主動技能點空也會立刻消耗冷卻與統計；觸控缺取消；回饋不足。
   - 本輪項目：技能改成有效命中或確認才消耗冷卻；無目標不消耗；觸控可取消；命中特效/音效強化。
   - 驗收：單元/腳本測到空放不扣 cooldown、不加 skillCasts；有效施放才扣；Escape 與觸控取消都可解除 pendingSkill。

7. 腳色樣子
   - 現況：審計未列 P1，新一輪只驗收不回歸。
   - 本輪項目：不改角色色票與 atlas；若缺素材不假宣稱完成。
   - 驗收：既有角色/英雄動畫測試綠；報告列明本輪未新增角色素材。

8. 動作流暢度
   - 現況：R62/R63 已達核心要求；波次節奏有 W12 暴衝與 Boss 後掉落。
   - 本輪項目：重整普通/嚴酷/無盡波次曲線，降低 W12 尖峰與 Boss 後大幅下滑；普通主路徑穩定到達設計目標波數。
   - 驗收：`scripts/sim-balance.js` 升級為 gate，normal 達 20 波目標、brutal/endless 落入設定範圍，effective HP 尖峰受控。

## 固定品質閘門

- `npm test`
- `npm run test:e2e`
- `npm run test:rwd`
- R66 控制守門全綠
- 版本 bump：`package.json`、`package-lock.json`、`index.html`、`sw.js`、UI fallback 統一到 R67
- 舊版號 grep 歸零
- 秘密掃描零命中：排除 `.git` 與 `node_modules`
- before/after 證據入 `docs/evidence/`
- 產出 `docs/CODEX_RESPONSE_td_R67.md`
- 本地 commit，不 push
