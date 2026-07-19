/* =========================================================================
 * test-lore.js — 《神魔誌》純資料與解鎖規則測試
 * ========================================================================= */

const path = require("path");
const fs = require("fs");
const lore = require(path.join(__dirname, "..", "src", "lore.js"));
const heroes = require(path.join(__dirname, "..", "src", "heroes.js"));

const {
  WORLD_LORE,
  CAMPAIGN_CHAPTERS,
  HERO_LEGENDS,
  DEPLOY_QUOTES,
  ORACLE_WHISPERS,
  MAP_LORE,
  WAVE_BEATS,
  EVENT_FLAVOR,
  BOSS_INTRO,
  legendStageFor,
  campaignUnlockState,
  evaluateCampaignUnlocks,
  oracleWhisper,
  mapLoreFor,
  deployQuoteFor,
  waveBeatFor,
  waveHeraldFor,
  gachaRevealFor,
  WAVE_HERALD_TEMPLATES,
  eventFlavorFor,
  bossIntroFor,
} = lore;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { console.error("  ✗ " + msg); failed++; }
}

console.log("== 純函式邊界 ==");
{
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "lore.js"), "utf8");
  assert(!source.includes("Math.random"), "lore.js 內沒有 Math.random");
  assert(!source.includes("Date.now"), "lore.js 內沒有 Date.now");
  assert(!/\bdocument\b/.test(source), "lore.js 內沒有 DOM document");
  assert(!/\blocalStorage\b/.test(source), "lore.js 內沒有 localStorage");
}

console.log("\n== 世界觀與神諭 ==");
assert(WORLD_LORE && WORLD_LORE.title === "神魔誌·序" && WORLD_LORE.body.length >= 3, "世界觀序章完整");
assert(WORLD_LORE.body.join("").includes("天樞崩裂") && WORLD_LORE.body.join("").includes("魂晶"),
  "世界觀包含天樞崩裂與魂晶召喚核心設定");
assert(ORACLE_WHISPERS.length >= 10, `神諭短語至少 10 句（${ORACLE_WHISPERS.length}）`);
assert(oracleWhisper(0) === ORACLE_WHISPERS[0] && oracleWhisper(ORACLE_WHISPERS.length) === ORACLE_WHISPERS[0],
  "oracleWhisper 依 index 輪替");
assert(oracleWhisper(-1) === ORACLE_WHISPERS[ORACLE_WHISPERS.length - 1], "oracleWhisper 支援負 index 正規化");
assert(MAP_LORE && ["plains", "canyon", "lava"].every((id) => MAP_LORE[id] && MAP_LORE[id].lines.length >= 2),
  "三張地圖都有至少兩句短地誌");
assert(mapLoreFor("canyon").title === "迂迴峽谷" && mapLoreFor("missing").title === "翠綠平原",
  "mapLoreFor 可查地圖 lore 並對未知值 fallback");
assert(WAVE_BEATS && [1, 5, 10, 15].every((w) => waveBeatFor(w) && waveBeatFor(w).title && waveBeatFor(w).line),
  "至少四個波次節點有標題與一行旁白");
assert(waveBeatFor(2) === null, "未設定的波次節點回傳 null");
assert(EVENT_FLAVOR.eclipse && EVENT_FLAVOR.pilgrim && eventFlavorFor("eclipse").length > 0 && eventFlavorFor("pilgrim").length > 0,
  "P0 新事件有事件波進場旁白");
assert(BOSS_INTRO.boss && BOSS_INTRO.yaksha && bossIntroFor("boss").length > 0 && bossIntroFor("yaksha").length > 0,
  "兩個 Boss 都有登場台詞");

console.log("\n== 戰役編年解鎖 ==");
{
  assert(CAMPAIGN_CHAPTERS.length >= 6 && CAMPAIGN_CHAPTERS.length <= 7,
    `戰役章節 6~7 章（${CAMPAIGN_CHAPTERS.length}）`);
  const waveValues = CAMPAIGN_CHAPTERS
    .filter((c) => c.unlock.type === "wave")
    .map((c) => c.unlock.value);
  const monotonic = waveValues.every((v, i) => i === 0 || v >= waveValues[i - 1]);
  assert(monotonic, `wave 門檻單調遞增（${waveValues.join(",")}）`);
  assert(CAMPAIGN_CHAPTERS[0].unlock.type === "start" && CAMPAIGN_CHAPTERS[0].oracle.includes("醒來吧"),
    "第一章為 start 解鎖且含指定神諭");
  const start = campaignUnlockState({ bestWave: 0, bossKills: 0, clearedWave: 0 });
  assert(start["awakening-altar"] && !start["first-rift"], "新局只解鎖序章");
  const wave5 = campaignUnlockState({ bestWave: 5, bossKills: 0, clearedWave: 0 });
  assert(wave5["first-rift"] && wave5["demon-gate"] && !wave5["first-boss"], "第 5 波解鎖到魔門但未解鎖 Boss 章");
  const boss = campaignUnlockState({ bestWave: 5, bossKills: 1, clearedWave: 0 });
  assert(boss["first-boss"], "首殺 Boss 解鎖王影章");
  const unseen = evaluateCampaignUnlocks(["awakening-altar"], { bestWave: 5, bossKills: 1, clearedWave: 0 });
  assert(JSON.stringify(unseen) === JSON.stringify(["first-rift", "demon-gate", "first-boss"]),
    `evaluateCampaignUnlocks 只回傳新解鎖 id（${unseen.join(",")}）`);
}

console.log("\n== 英雄列傳 ==");
{
  const heroIds = Object.keys(heroes.HEROES).sort();
  const legendIds = Object.keys(HERO_LEGENDS).sort();
  assert(JSON.stringify(heroIds) === JSON.stringify(legendIds), "每位英雄都有列傳");
  const knownDetailed = new Set(["daji", "guanyu", "wukong", "erlangshen", "nezha", "niumowang", "baisuzhen", "leizhenzi", "zhongkui"]);
  for (const id of heroIds) {
    const legend = HERO_LEGENDS[id];
    const bonds = legend.stages.map((s) => s.bond);
    assert(JSON.stringify(bonds) === JSON.stringify([1, 5, 10, 15]), `${id} 列傳 bond 節點為 1/5/10/15`);
    for (const stage of legend.stages) {
      const minLen = knownDetailed.has(id) ? 40 : 20;
      assert(stage.title && stage.text && stage.text.length >= minLen,
        `${id} ${stage.title} 文本長度達標（${stage.text.length} >= ${minLen}）`);
    }
  }
  assert(legendStageFor("daji", 0) === null, "bond 0 未解鎖列傳");
  assert(legendStageFor("daji", 4).title.startsWith("序"), "bond 4 回傳序");
  assert(legendStageFor("daji", 5).title.startsWith("承"), "bond 5 回傳承");
  assert(legendStageFor("daji", 14).title.startsWith("轉"), "bond 14 回傳轉");
  assert(legendStageFor("daji", 15).title.startsWith("合"), "bond 15 回傳合");
  assert(legendStageFor("missing", 15) === null, "未知英雄回傳 null");
}

console.log("\n== 登場台詞（B-03）==");
{
  const heroIds = Object.keys(heroes.HEROES).sort();
  const quoteIds = Object.keys(DEPLOY_QUOTES).sort();
  assert(JSON.stringify(heroIds) === JSON.stringify(quoteIds),
    `每位英雄都有登場台詞（${quoteIds.length}/${heroIds.length}）`);
  for (const id of heroIds) {
    const quote = deployQuoteFor(id);
    assert(typeof quote === "string" && quote.length > 0, `${id} 登場台詞非空`);
    assert(quote.length <= 22, `${id} 登場台詞 ≤22 字（${quote.length}）`);
  }
  assert(deployQuoteFor("missing") === "", "未知英雄登場台詞回傳空字串");
  assert(deployQuoteFor(undefined) === "", "undefined 英雄 id 回傳空字串");
}

console.log("\n== 波次預告詞（R75 B-02 最小版）==");
{
  assert(Array.isArray(WAVE_HERALD_TEMPLATES) && WAVE_HERALD_TEMPLATES.length === 4,
    "確定性模板恰為 4 句");
  for (const tpl of WAVE_HERALD_TEMPLATES) {
    assert(tpl.includes("{wave}"), `模板含 {wave} 佔位（${tpl.slice(0, 10)}…）`);
  }
  // 確定性：同輸入永遠同輸出
  const a = waveHeraldFor(3, null, false);
  const b = waveHeraldFor(3, null, false);
  assert(JSON.stringify(a) === JSON.stringify(b), "同 (wave,event,boss) 輸出確定相同");
  assert(a.text.includes("3") && !a.text.includes("{wave}"), "模板波數已代入");
  // 模板以波數輪替（取非里程碑、非 Boss 波取樣）
  const t2 = waveHeraldFor(2, null, false).text;
  const t6 = waveHeraldFor(6, null, false).text;
  assert(waveHeraldFor(2, null, false).source === "template" && t2 !== t6,
    "非里程碑波使用模板且逐波輪替");
  // 里程碑波優先使用 WAVE_BEATS（即使同時是事件/Boss 波）
  for (const key of Object.keys(WAVE_BEATS)) {
    const beat = waveHeraldFor(Number(key), "rush", true);
    assert(beat.source === "beat" && beat.text.includes(WAVE_BEATS[key].title),
      `第 ${key} 波預告使用里程碑文本`);
  }
  // Boss 波（非里程碑）使用魔王開場
  const boss = waveHeraldFor(20, null, true);
  assert(boss.source === "boss" && boss.text === BOSS_INTRO.boss, "Boss 波預告使用魔王開場");
  // 事件波附掛事件風味
  const rush = waveHeraldFor(7, "rush", false);
  assert(rush.source === "event" && rush.text.includes(EVENT_FLAVOR.rush), "事件波附掛事件風味");
  // 40 波裁決：≤40 上 banner、>40 僅入 log
  assert(waveHeraldFor(40, null, true).channel === "banner", "第 40 波仍上 banner");
  assert(waveHeraldFor(41, null, false).channel === "log", "第 41 波僅入 log");
  assert(waveHeraldFor(88, "swarm", false).channel === "log", "高波數事件波亦僅入 log");
  assert(waveHeraldFor(0, null, false).wave === 1, "非法波數收斂為 1");
}

console.log("\n== 抽卡揭示回饋（R75）==");
{
  const heroIds = Object.keys(heroes.HEROES).sort();
  for (const id of heroIds) {
    const reveal = gachaRevealFor(id);
    assert(!!reveal.epithet && reveal.epithet.length >= 2, `${id} 揭示稱號非空（${reveal.epithet}）`);
    assert(!!reveal.quote && reveal.quote === deployQuoteFor(id), `${id} 揭示台詞與登場台詞一致`);
  }
  const missing = gachaRevealFor("missing");
  assert(missing.epithet === "" && missing.quote === "", "未知英雄揭示回饋回傳空字串");
}

console.log("");
if (failed === 0) { console.log("✅ 神魔誌測試全部通過"); process.exit(0); }
else { console.error(`❌ ${failed} 項失敗`); process.exit(1); }
