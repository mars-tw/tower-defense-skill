# 《無盡塔防》對抗式覆核報告 — Grok R5（td-r55-v1 slow-mo／粒子／reduced／WebAudio 修復驗證）

| 項目 | 內容 |
|------|------|
| 文件代號 | `GROK_REVIEW_td_R5` |
| 版本 | `td-r55-v1` / `0.5.5`（commit `b3be5cb`） |
| 範圍 | R4 要求的 P0/P1 修復：`fxTimeScale` 純表現、粒子硬上限、`reduced` 全覆蓋即時清除、WebAudio master gain＋cap＋節流 |
| 對照文件 | `docs/GROK_REVIEW_td_R4.md`、`docs/CODEX_RESPONSE_td_R4.md` |
| 審查者 | Grok（對抗覆核／只審不改） |
| 日期 | 2026-07-11 |
| 原則 | **只審不改**；以最新 commit diff 與現況原始碼為準；結論附**檔案:行號** |

**結論標籤**

| 標籤 | 含義 |
|------|------|
| **PASS** | 契約落地，主路徑可驗證 |
| **BUG** | 可重現的邏輯／契約錯誤 |
| **RISK** | 非純錯，但有平衡／交互／體驗／守門缺口副作用 |
| **NOTE** | 設計取捨、測試覆蓋缺口、文件用語差異 |

**優先級**

| 等級 | 含義 |
|------|------|
| **P0** | 正確性錯誤／破壞決定性主契約／邏輯時間軸被表現層污染 |
| **P1** | 高波 thrash、關鍵回饋被 cap 吃掉、reduced／audio 語意落差 |
| **P2** | 邊角、防禦性、測試覆蓋缺口、低風險 debt |

---

## 0. 總評（先講人話）

| 檢查項 | 結論 | 等級 |
|--------|------|------|
| (1) `fxTimeScale` 引用點掃描（邏輯路徑吃到＝未修好） | **PASS** — 僅粒子用 `fxDt`；出怪／CD／位移／`clock` 全吃原 `dt` | — |
| (2) 同 `runSeed` reduced 開／關 timeline 測試有效性 | **PASS（有效，範圍窄）** — 對「出怪時序」有效；不證明全戰鬥表現決定性 | NOTE |
| (3) 粒子 cap 邊界（滿了丟新或擠舊？關鍵警示？） | **RISK** — 全域 FIFO 擠舊；text／coin／ring **丟新**；關鍵字樣可被浮傷字海擠掉 | P1 |
| (4) 新引入 bug | **無新 P0**；有 cap 雙策略／slow-mo 粒子堆積／SFX 丟新 等殘餘風險 | P1–P2 |

**一句話**：R4 的 **P0（Boss slow-mo 縮放整段 `update(dt)`）已真正修好**——`fxTimeScale` 沒有洩進邏輯路徑。粒子硬上限與 reduced 擴大／即時清除、WebAudio running 判定與 voice cap 也大致落地。對抗性殘餘集中在：**cap 策略不一致導致「關鍵警示特效」可能被丟**，以及 e2e 只驗上限數字、不驗 eviction 語意。

**本輪未改任何程式。**

---

## 1. 宣稱對照（Codex R4 → 現況）

| Codex 宣稱（`docs/CODEX_RESPONSE_td_R4.md`） | 現況判定 | 證據 |
|---|---|---|
| `update` 不再改寫 logic `dt`；粒子用 `fxDt` | **PASS** | `src/game.js:843-855, 858-966` |
| `MAX_PARTICLES=220` 等硬上限，入口走 `pushParticle` | **PASS（有上限）／RISK（eviction）** | `src/game.js:79-82, 1462-1478`；全檔無殘留 `state.particles.push` 旁路 |
| reduced 覆蓋 burst／ring／傷害浮字／紅暈／slow-mo；切換即清 | **PASS** | `src/game.js:104-112, 1480-1538, 1018-1019, 1667` |
| WebAudio：`running` 才 unlocked；master gain；節流；active cap；ended disconnect | **PASS（主路徑）** | `src/game.js:133-201` |
| e2e：slow-mo 下 clock／walkDist；reduced timeline 一致；particles≤220 | **PASS（有測）／NOTE（深度不足）** | `scripts/test-td-e2e.js:1038-1178` |

---

## 2. (1) `fxTimeScale` 引用點掃描

### 2.1 全專案寫入／讀取清單

| 位置 | 角色 | 是否邏輯路徑 |
|------|------|-------------|
| `src/game.js:111` | `setReducedEffects(true)` 強制 `fxTimeScale=1` | 設定，非模擬步進 |
| `src/game.js:410` | `newGame` 初值 `fxTimeScale: 1` | 初值 |
| `src/game.js:848` | slow-mo 期間寫入 `scale`（預設 0.35） | 設定 |
| `src/game.js:851, 853` | 結束／非 slow-mo 時重置 1 | 設定 |
| `src/game.js:855` | `fxDt = rawDt * (fxTimeScale \|\| 1)` | **僅供粒子** |
| `src/game.js:953-961` | 粒子 `life`／位移／重力吃 `fxDt` | **純表現** |
| `scripts/test-td-e2e.js:855, 1039, 1048, 1110, 1173` | 測試存取／斷言 | 測試 |

**結論**：`src/**` 內 **沒有** 任何出怪、冷卻、敵人移動、子彈、英雄、`state.clock` 讀取 `fxTimeScale`／`fxDt`。

### 2.2 與舊 P0 的對照（修復是否真的發生）

R53／R4 問題點是：

```js
// 舊：dt *= scale;  // 整段 update 邏輯變慢
```

R54 diff（`b3be5cb`）改為：

```843:855:src/game.js
  function update(dt) {
    const rawDt = dt;
    if (state.slowMoLeft > 0 && !reducedEffectsEnabled()) {
      const scale = Math.max(0.15, Math.min(1, state.slowMoScale || 0.35));
      state.slowMoLeft = Math.max(0, state.slowMoLeft - rawDt);
      state.fxTimeScale = scale;
    } else if (state.slowMoLeft > 0) {
      state.slowMoLeft = 0;
      state.fxTimeScale = 1;
    } else {
      state.fxTimeScale = 1;
    }
    const fxDt = rawDt * (state.fxTimeScale || 1);
```

邏輯步仍用參數 `dt`（= 呼叫端原始步進，loop 層已乘 `state.speed`）：

| 邏輯子系統 | 使用的時間量 | 行號 |
|-----------|-------------|------|
| 出怪 `spawnTimer` | `dt` | `858` |
| 技能冷卻 | `dt` | `867` |
| combo／banner | `dt` | `872, 876` |
| 女神 smite CD／hitFlash | `dt` | `880, 883` |
| 紅暈衰減 | `rawDt` | `881` |
| 敵人移動／`walkDist` | `dt` | `904-922` |
| 塔冷卻 | `dt` | `930` |
| 子彈 | `dt` | `944` |
| `state.clock` | `dt` | `966` |
| 粒子 | **`fxDt` only** | `952-961` |

`slowMoLeft` 本身用 `rawDt` 倒數（`847`），真實牆鐘約 0.2s 結束，**不再**把戰鬥時間軸拉長。

### 2.3 e2e 對 P0 的守門

```1038:1049:scripts/test-td-e2e.js
      st.clock = 0; st.slowMoLeft = 0.2; st.slowMoScale = 0.35; st.fxTimeScale = 1;
      const movingSlowMo = window.TD.debug.spawnEnemy("slime", {
        x: st.path[0].x, y: st.path[0].y, wp: 1, hp: 999, maxHp: 999, speed: 100, reward: 0,
      });
      window.TD.debug.step(0.05);
      const slowMoLogic = {
        clock: Number(st.clock.toFixed(3)),
        walkDist: Number((movingSlowMo.walkDist || 0).toFixed(3)),
        ...
      };
```

斷言（`1172-1174`）：`clock === 0.05`、`walkDist ≈ 5`（= `speed 100 * 0.05`，**不是** `* 0.35`）、`fxTimeScale < 1`、`slowMoLeft` 有倒數。

| 判定 | **PASS（P0 已修好）** |
|------|------------------------|
| 若邏輯仍乘 scale | `walkDist` 會 ≈ `1.75`，測試會紅 |
| 殘餘 NOTE | 「Boss slow-mo」現在**只慢粒子**，敵／塔／子彈視覺仍全速——屬規格取「純表現」後的手感變化，不是時間軸污染 |

---

## 3. (2) 同 `runSeed` reduced 開／關 timeline 測試——有效性

### 3.1 測試在量什麼

```1060:1086:scripts/test-td-e2e.js
      const captureSpawnTimeline = (reduced) => {
        window.TD.setReducedEffects(reduced);
        st.towers = []; st.enemies = []; st.bullets = []; st.spawnQueue = []; st.particles = [];
        st.running = false; st.over = false; st.betweenWaves = true;
        st.clock = 0; st.wave = 8; st.runSeed = 111111; st.affixSeed = 777; st.waveSeeds = {};
        const preview = window.TD.previewNextWave();
        const expectedTypes = preview.queue.map((spec) => spec.type);
        window.TD.startWave();
        st.running = false;
        // step 0.05，記錄每次 spawnQueue 減少時的 clock + type
        ...
      };
      const normalTimeline = captureSpawnTimeline(false);
      const reducedTimeline = captureSpawnTimeline(true);
      const spawnTimelineStable = JSON.stringify(normalTimeline) === JSON.stringify(reducedTimeline);
```

斷言（`1177-1178`）：`spawnTimelineStable && timeline.length > 0`。

### 3.2 為什麼對「出怪時序」有效

| 檢查 | 結果 | 說明 |
|------|------|------|
| 固定 `runSeed`／`affixSeed`／清 `waveSeeds` | 有 | 波次 RNG 重算路徑乾淨（`waveSeedFor`：`460-469`） |
| preview 與 startWave 對齊 | 有 | `wave=8` → preview 看第 9 波；`startWave` 先 `wave++` 再 `wavePlanFor(9)`（`474-511`） |
| spawn 間隔與 clock | 邏輯用 `dt` | `858-861, 966`；reduced 不改 `dt` |
| reduced 是否碰波次 RNG | 否 | `effectSeed`／`effectRand`（`203-211`）只服務粒子隨機；`burst` 等在 reduced 下 early-return，**不**參與 `generateWaveQueue` |
| `startWave` → `startLoop` 後立刻 `running=false` | 可接受 | `evaluate` 同步區塊內 rAF 不會插隊；下一幀 loop 見 `!running` 即停（`809-815, 2400`） |

### 3.3 測試**不能**證明的事（有效性邊界）

| 缺口 | 嚴重度 | 說明 |
|------|--------|------|
| 只比 **previewTypes + spawn clock timeline** | NOTE | 不比擊殺、金幣、技能、DoT、漏怪 |
| 不重置 `effectSeed` | NOTE | 對出怪無關；若日後有人把 `effectRand` 接進機制會出事，但現況機制未吃它 |
| reduced 開／關後 **特效路徑** 的 `effectSeed` 演進會分叉 | NOTE | 非 reduced 會呼叫 `effectRand`；reduced 跳過——表現層種子分叉，**不是**戰鬥決定性契約破壞 |
| 未覆蓋「戰鬥中途切 reduced」對邏輯的影響 | NOTE | 邏輯本就不吃 juice；切換會清粒子／slow-mo／紅暈（`104-112`） |

| 判定 | **PASS：對 Codex 宣稱「同 runSeed 出怪 timeline 一致」有效** |
|------|------|
| 標籤 | **NOTE**：守門範圍＝出怪時序，不是「reduced 全遊戲決定性」 |

---

## 4. (3) 粒子 cap 邊界行為

### 4.1 常數與唯一入口

```79:82:src/game.js
  const MAX_PARTICLES = 220;
  const MAX_TEXT_PARTICLES = 42;
  const MAX_COIN_PARTICLES = 8;
  const MAX_RING_PARTICLES = 14;
```

```1462:1478:src/game.js
  function pushParticle(p, allowReduced) {
    if (!state || (reducedEffectsEnabled() && !allowReduced)) return false;
    if (p.text) {
      const textCount = state.particles.filter((x) => x.text).length;
      if (textCount >= MAX_TEXT_PARTICLES) return false;
      if (p.toX != null) {
        const coinCount = state.particles.filter((x) => x.toX != null).length;
        if (coinCount >= MAX_COIN_PARTICLES) return false;
      }
    }
    if (p.ring) {
      const ringCount = state.particles.filter((x) => x.ring).length;
      if (ringCount >= MAX_RING_PARTICLES) return false;
    }
    while (state.particles.length >= MAX_PARTICLES) state.particles.shift();
    state.particles.push(p);
    return true;
  }
```

掃描：`burst`／`coinFloat`／`muzzleFlash`／`upgradeBeam`／`ring`／`flashText` 皆走 `pushParticle`；**無** `state.particles.push` 旁路。

### 4.2 滿 cap 時：丟新還是擠舊？

| 層級 | 滿時行為 | 實作 |
|------|----------|------|
| 全域 `MAX_PARTICLES` | **擠掉最舊（FIFO `shift`），保留新進** | `1476-1477` |
| text（含傷害字／COMBO／狀態字） | **丟棄新粒子**，保留既有 | `1465-1466` `return false` |
| coin（`toX != null` 的 text） | **丟棄新** | `1468-1469` |
| ring | **丟棄新** | `1473-1474` |
| muzzle／beam／一般 burst 碎片 | 無子類 cap；吃全域 FIFO | — |

**這是雙策略**：全域偏「新特效優先」，子類偏「舊特效優先」。文件／Codex 未寫清 eviction 語意。

### 4.3 會不會丟「關鍵警示」特效？

| 特效 | 類型 | 風險 |
|------|------|------|
| 漏怪紅暈 `redVignette` | **非粒子**（`1019, 881, 1667-1676`） | 不受粒子 cap；reduced 下直接關閉 |
| 波次橫幅 `banner` | **非粒子**（`537-538`） | 不受 cap |
| `flashText("反射")`／`"閃避"`／`"狂暴"`／`"噤聲"`／`"分裂"`／`"餘震停火"` | text 粒子 | **text≥42 時新字直接丟**（`653, 666, 743, 753, 1186, 584`） |
| 技能／Boss `ring` | ring 粒子 | **ring≥14 時新 ring 丟**；高波 skill spam 可擋住後續 Boss／能力 ring（`1363, 1210, 654`） |
| 死亡／命中 `burst` | 一般粒子 | 全域滿時 **擠舊**；可能擠掉畫面上較早的 text／ring（若它們正好是陣列前端） |
| 傷害浮字 `damageNumber` → `flashText` | text | 最容易先把 42 槽灌滿，進而讓狀態警示字上不了 |

**高波 thrash 情境（對抗）**：

1. 多塔 + 連殺 → 傷害字與 COMBO 佔滿 `MAX_TEXT_PARTICLES=42`。
2. 之後觸發哥布林 `"閃避"` 或裂鏡 `"反射"` → `pushParticle` 對 text `return false` → **玩家看不到關鍵機制回饋**（機制本身仍生效，屬 UX／可讀性損失，不是邏輯錯）。
3. 連續 `castSkill` 灌 ring 到 14 → Boss 擊殺金環／能力 ring 被拒。
4. Boss `deathBurst` 一次可丟大量 burst（`1492` boss 72 粒）→ 觸發全域 `shift`，可能掃掉仍在播的警示字。

### 4.4 e2e 對 cap 的覆蓋

```1051:1058:scripts/test-td-e2e.js
      for (let i = 0; i < 60; i++) {
        window.TD.debug.castSkill("meteor", 240, 240);
        st.skillCooldowns.meteor = 0;
      }
      const particleCap = st.particles.length;
      const ringCap = st.particles.filter((p) => p.ring).length;
```

斷言（`1175-1176`）：`particleCap <= 220 && ringCap <= 14`。

| 有測 | 未測 |
|------|------|
| 上限不被突破 | FIFO vs drop-new 語意 |
| ring 子 cap | text／coin 子 cap |
| | 關鍵字樣在 cap 滿時是否保留 |
| | slow-mo 期間粒子壽命變長是否更容易觸頂 |

| 判定 | **RISK P1（cap 有落地，但 eviction 不利關鍵警示；守門過淺）** |
|------|------|

---

## 5. reduced 全覆蓋與即時清除

### 5.1 切換即清

```104:112:src/game.js
  function setReducedEffects(v) {
    reducedEffectsCache = !!v;
    reducedFlashCache = !!v;
    if (v && state) {
      state.particles = [];
      state.redVignette = 0;
      state.slowMoLeft = 0;
      state.fxTimeScale = 1;
    }
```

e2e：`st.redVignette = 0.55` 後再 `setReducedEffects(true)` → 期望 `0`（`1032-1034, 1169-1171`）。

### 5.2 產生端 gate（相對 R4 缺口）

| API | reduced 行為 | 行號 |
|-----|-------------|------|
| `burst` | 直接 return | `1481` |
| `deathBurst` | return | `1490` |
| `coinFloat` | return | `1497` |
| `muzzleFlash` | return | `1504` |
| `upgradeBeam` | return | `1511` |
| `impactShake`／`screenShake` | return | `1516, 1528` |
| `ring` | return | `1521` |
| `flashText` | return（除非 `forceReducedText`） | `1535` |
| Boss slow-mo 寫入 | `slowMoLeft = 0` | `1208` |
| 漏怪紅暈／女神 hitFlash | 寫 0 | `1018-1019` |
| `drawRedVignette` | return | `1667` |
| `pushParticle` 雙重保險 | reduced 且非 allow → false | `1463` |

R4 點名的 **burst／ring／flashText／紅暈** 漏洞：**已補**。

### 5.3 殘餘 NOTE

| 項目 | 說明 | 等級 |
|------|------|------|
| `forceReducedText` 參數存在但全專案無呼叫點 | 建造確認等 UI 字（`2232, 2239, 2318` 等）在 reduced 下一律消失 | P2 NOTE |
| `flashBanner` 不吃 reduced | 波次／事件橫幅仍在（`537-538`）— 對 a11y 通常合理 | NOTE |
| `playSfx` 不吃 reduced | 音效仍可播（`celebrateWaveClear` 先 `playSfx` 再 return，`541-542`） | NOTE |
| `prefers-reduced-motion` 與 cache | 首次讀取後 cache；toggle 以 API／localStorage 為準 | 舊債 NOTE |

| 判定 | **PASS（相對 R4「完整關閉 juice」主契約）** |
|------|------|

---

## 6. WebAudio cap／解鎖

### 6.1 修復落地

| 項目 | 實作 | 行號 |
|------|------|------|
| master gain 0.8 | `createGain` → destination | `146-150` |
| unlocked 僅 `state === "running"` | `markAudioUnlockState` | `134-136, 155` |
| resume Promise 後再標 unlocked | `152-153` | |
| active voice cap | `MAX_ACTIVE_SFX = 10`，滿則 **return（丟新）** | `83, 178` |
| 同類節流 | `SFX_MIN_GAP` | `84, 179-181` |
| ended 後 disconnect + active-- | `194-198` | |

相對 R4「樂觀 `unlocked=true`、無節點上限」：**主風險已收斂**。

### 6.2 殘餘風險（非回歸 P0）

| 風險 | 說明 | 等級 |
|------|------|------|
| cap 滿 **丟新、無優先級** | 高頻 `fire`／`hit` 佔滿 10 聲時，`boss`／`leak` 可能被靜音 | P2 RISK |
| 手勢 listener 仍 `once: true` | 若首次手勢時 `audioMuted()`，之後 unmute 需另一次手勢才可能建 context（`158-160, 139`） | P2 NOTE（舊模式殘留） |
| `active` 依賴 `onended` | 異常中斷理論上可能卡住 counter（實務少見） | P2 |

| 判定 | **PASS（主路徑）+ RISK P2（丟新無優先）** |
|------|------|

---

## 7. (4) 新引入／伴隨副作用

| ID | 標籤 | 等級 | 說明 | 位置 |
|----|------|------|------|------|
| N1 | **RISK** | P1 | 粒子 **雙 eviction 策略**：全域擠舊、text／ring 丟新 → 關鍵機制字樣／後續 ring 可消失 | `1462-1477`；觸發點 `653+` |
| N2 | **RISK** | P2 | slow-mo 期間粒子用 `fxDt` 變慢 → **壽命牆鐘變長**，戰鬥仍全速噴粒子 → Boss 擊殺窗更容易觸頂 cap | `855, 952-961` + `1208-1209` |
| N3 | **NOTE** | P2 | 「slow-mo」品牌從「世界變慢」變成「只有粒子慢」— 手感可能變淡，但符合純表現契約 | `843-961` |
| N4 | **RISK** | P2 | SFX cap 丟新、無 boss／leak 優先 | `178` |
| N5 | **NOTE** | P2 | 每次 `pushParticle` 對 text／ring 做 `filter` 計數 → O(n)；高波 220 粒時額外成本 | `1465-1474` |
| N6 | **NOTE** | — | e2e 未斷言粒子在 slow-mo 下位移／life 有被縮放（只斷邏輯未縮） | `1038-1174` |

**未發現**：

- 邏輯時間軸再被 slow-mo 污染（P0 級）
- reduced 開／關改變出怪 seed／時序（在現有 e2e 契約下）
- 粒子陣列無上限失控（R4 P1 主訴）

---

## 8. 分項簽署表

### (1) `fxTimeScale` 掃描

| 結論 | **PASS — 邏輯路徑未吃到** |
|------|---------------------------|
| 關鍵行 | 寫入 `111, 410, 848-853`；唯一消費 `855 → 953-961` |
| 邏輯對照 | `858-966` 全 `dt`／`rawDt` |
| 標籤 | **PASS** |

### (2) reduced timeline 測試有效性

| 結論 | **PASS（有效）— 範圍＝出怪 preview + clock timeline** |
|------|------|
| 關鍵行 | `scripts/test-td-e2e.js:1060-1086, 1177-1178`；波次 seed `src/game.js:460-511` |
| 標籤 | **PASS + NOTE（非全戰鬥決定性）** |

### (3) 粒子 cap 邊界

| 結論 | **RISK — 有硬上限；滿載語意分裂；關鍵警示可被丟** |
|------|------|
| 關鍵行 | `79-82, 1462-1478`；e2e `1051-1058, 1175-1176` |
| 標籤 | **RISK P1** |

### (4) 新引入 bug

| 結論 | **無新 P0 BUG**；殘餘 N1–N5 如上 |
|------|------|
| 標籤 | **PASS（P0）／RISK（P1–P2 體驗）** |

---

## 9. 建議修復優先序（給實作者，本輪不改）

| 優先 | 建議 | 對應 |
|------|------|------|
| P1 | 為「機制警示」text（反射／閃避／狂暴／噤聲／分裂／餘震）設 **優先通道**：子 cap 滿時擠掉一般傷害字，或獨立 reserved slots | §4.3 N1 |
| P1 | 統一或文件化 eviction：全域 FIFO vs 子類 drop-new；e2e 補「text cap 滿後仍能塞入警示字」或「ring cap 滿後 Boss ring 策略」 | §4.2–4.4 |
| P2 | SFX：`boss`／`leak` 滿 cap 時可搶佔最低優先 voice，或獨立 reserved slot | §6.2 |
| P2 | e2e：slow-mo 下斷言粒子 `life` 減少量 ≈ `0.05 * scale`（表現側回歸） | §2.3 N6 |
| P2 | `pushParticle` 計數改增量 counter，避免每次 `filter` | N5 |

---

## 10. 總簽署

| 項目 | 內容 |
|------|------|
| 審查模式 | **只審不改** |
| 主讀檔案 | `src/game.js`、`scripts/test-td-e2e.js`、`docs/CODEX_RESPONSE_td_R4.md`、commit `b3be5cb` |
| 輸出 | `docs/GROK_REVIEW_td_R5.md` |
| **對 td-r55-v1 宣稱的總判決** | **P0 slow-mo／dt 污染：修好（PASS）**。粒子 cap、reduced 全覆蓋、WebAudio cap：**主契約 PASS**，但粒子／SFX 的「滿了丟誰」仍有 **P1/P2 RISK**，且 e2e 對 eviction 與關鍵警示覆蓋不足。 |
| 下一步給實作者 | 不必重開 P0 slow-mo 戰線；若要再修，優先 **警示特效 cap 優先級** 與對應守門測試。 |
