/* =========================================================================
 * test-heroes.js — 英雄抽卡/保底/經濟設定測試（CI 用，零依賴）
 * Stage 1/5 驗收：rng 可注入（確定性測試）、18 抽保底傳說、傳說歸零 pity、
 *               抽卡經濟常數 shape（魂晶/首抽免費/重複補償）
 * 執行：node scripts/test-heroes.js
 * ========================================================================= */

const path = require("path");
const fs = require("fs");
const H = require(path.join(__dirname, "..", "src", "heroes.js"));
const { HEROES, HERO_RARITY, HERO_LEVEL, GACHA, rollHero, rollHeroWithPity, rollHeroWithPityPreferNew } = H;

let failed = 0;
function assert(cond, msg) { if (cond) console.log("  ✓ " + msg); else { console.error("  ✗ " + msg); failed++; } }
// 線性同餘 RNG：固定 seed 可重現
function makeRng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function sequenceRng(values) { let i = 0; return () => values[Math.min(i++, values.length - 1)]; }

console.log("== 1. 抽卡經濟設定 shape ==");
assert(typeof GACHA.cost === "number" && GACHA.cost > 0, `GACHA.cost 為正數（${GACHA.cost} 魂晶）`);
assert(GACHA.firstFree === true, "首抽免費（新玩家 30 秒內體驗盲盒）");
assert(typeof GACHA.pityLegendary === "number" && GACHA.pityLegendary > 0, `保底抽數設定存在（${GACHA.pityLegendary}）`);
assert(GACHA.pityLegendary === 18, "傳說保底為 18 抽");
assert(typeof GACHA.dupRefund === "number" && GACHA.dupRefund > 0 && GACHA.dupRefund < GACHA.cost,
  `重複補償為正且低於單抽成本（${GACHA.dupRefund} < ${GACHA.cost}）`);
assert(GACHA.dupRefund === 12, "重複補償為 12 魂晶");
assert(HERO_LEVEL.maxLevel === 10, "英雄等級上限維持 Lv.10");

console.log("\n== 1b. 英雄池擴充與新英雄資料 ==");
{
  const byRarity = (rarity) => Object.values(HEROES).filter((h) => h.rarity === rarity).map((h) => h.id);
  assert(Object.keys(HEROES).length === 15, `英雄總數為 15 位（${Object.keys(HEROES).length}）`);
  assert(JSON.stringify(byRarity("legendary").sort()) === JSON.stringify(["daji", "erlangshen", "guanyu", "valkyrie", "wukong"].sort()),
    `傳說池為 5 位（${byRarity("legendary").join(",")}）`);
  assert(JSON.stringify(byRarity("epic").sort()) === JSON.stringify(["baisuzhen", "mage", "nezha", "niumowang", "zhongkui"].sort()),
    `史詩池包含大法師、哪吒、牛魔王、白素貞與鍾馗（${byRarity("epic").join(",")}）`);
  assert(byRarity("rare").length === 3 && byRarity("rare").includes("leizhenzi") && byRarity("common").length === 2,
    "稀有池增至 3 位且普通池維持 2 位");

  const newHeroes = {
    daji: { rarity: "legendary", element: "fire", role: "ranged" },
    guanyu: { rarity: "legendary", element: "physical", role: "melee" },
    wukong: { rarity: "legendary", element: "thunder", role: "melee" },
    nezha: { rarity: "epic", element: "fire", role: "ranged" },
    leizhenzi: { rarity: "rare", element: "thunder", role: "ranged" },
    niumowang: { rarity: "epic", element: "fire", role: "melee" },
    baisuzhen: { rarity: "epic", element: "ice", role: "ranged" },
    erlangshen: { rarity: "legendary", element: "thunder", role: "melee" },
    zhongkui: { rarity: "epic", element: "physical", role: "ranged" },
  };
  for (const [id, expected] of Object.entries(newHeroes)) {
    const h = HEROES[id];
    const sprite = path.join(__dirname, "..", h.sprite || "");
    assert(!!h && h.rarity === expected.rarity && h.element === expected.element && h.role === expected.role,
      `${h.name} 稀有度/元素/定位正確`);
    assert(h.hp > 0 && h.atk > 0 && h.speed > 0 && h.range > 0 && h.atkRate > 0 && h.color && h.emoji && h.desc,
      `${h.name} 戰鬥數值、顏色、emoji fallback 與描述完整`);
    assert(h.sprite === `assets/heroes/${id}.png` && fs.existsSync(sprite), `${h.name} 使用單張 sprite 檔 ${h.sprite}`);
  }

  assert(HEROES.daji.atk > HEROES.mage.atk && HEROES.daji.speed < HEROES.mage.speed && HEROES.daji.range < HEROES.mage.range,
    "妲己高攻高濺射，但機動與射程低於大法師，未嚴格取代");
  assert(HEROES.guanyu.hp > HEROES.valkyrie.hp && HEROES.guanyu.atk > HEROES.valkyrie.atk && HEROES.guanyu.speed < HEROES.valkyrie.speed,
    "魔關羽血攻壓制但速度慢，未嚴格取代女武神");
  assert(HEROES.wukong.speed > HEROES.valkyrie.speed && HEROES.wukong.atkRate > HEROES.valkyrie.atkRate && HEROES.wukong.atk < HEROES.valkyrie.atk,
    "孫悟空高速連打但單下較低，未嚴格取代女武神");
  assert(HEROES.nezha.speed > HEROES.mage.speed && HEROES.nezha.range < HEROES.mage.range && HEROES.nezha.atk < HEROES.mage.atk,
    "哪吒機動高但爆發與射程低於大法師，未嚴格取代");
  assert(HEROES.zhongkui.splash > 0 && HEROES.zhongkui.atk < HEROES.daji.atk && HEROES.zhongkui.range <= HEROES.mage.range,
    "鍾馗有濺射判官定位，但輸出不取代傳說妲己與大法師");
}

console.log("\n== 2. rollHero：rng 可注入、回傳合法英雄 ==");
{
  const rng = makeRng(42);
  const h1 = rollHero(rng);
  assert(!!h1 && !!HEROES[h1.id], `注入 rng 抽出合法英雄（${h1.id}）`);
  // 同 seed 重現同結果（確定性）
  const h2 = rollHero(makeRng(42));
  assert(h1.id === h2.id, "同 seed 抽出同英雄（確定性可測）");
  // 大量抽樣：每個稀有度都抽得到，且全部是合法 id
  const seen = new Set();
  const rng2 = makeRng(7);
  for (let i = 0; i < 5000; i++) { const h = rollHero(rng2); seen.add(h.rarity); assert2(!!HEROES[h.id]); }
  assert(seen.has("legendary") && seen.has("common"), `5000 抽涵蓋 common 到 legendary（${[...seen].join(",")}）`);
}
let _silentFail = 0;
function assert2(cond) { if (!cond) _silentFail++; }
assert(_silentFail === 0, "大量抽樣全部回傳合法英雄");

console.log("\n== 3. rollHeroWithPity：保底與歸零 ==");
{
  // 用「永遠抽 common」的 rng 驗證保底（權重表順序 common→legendary，roll 趨近 0 落在 common）：
  // 保底前都不是傳說時，保底那抽必須強制傳說
  const alwaysCommonRng = () => 0.01;
  let pity = 0;
  let sawForcedLegendary = false;
  for (let i = 1; i <= GACHA.pityLegendary; i++) {
    const r = rollHeroWithPity(pity, alwaysCommonRng);
    pity = r.pity;
    if (i < GACHA.pityLegendary) {
      assert2(r.hero.rarity !== "legendary"); // 保底前不應出傳說（這個 rng 抽不到）
      assert2(pity === i);                    // pity 逐抽累積
    } else {
      sawForcedLegendary = r.hero.rarity === "legendary";
    }
  }
  assert(_silentFail === 0, "保底前 pity 正確逐抽累積、未提前出傳說");
  assert(sawForcedLegendary, `第 ${GACHA.pityLegendary} 抽強制保底傳說`);
  assert(pity === 0, "保底觸發後 pity 歸零");

  // 自然抽到傳說也要歸零：用會抽中傳說的 rng（權重表第一個是 legendary 時 roll<weight）
  // 找一個必中傳說的 roll 值：直接掃 0~1 找到讓 rollHero 回傳 legendary 的固定值
  let legendRoll = null;
  for (let v = 0.001; v < 1; v += 0.001) {
    const h = rollHero(() => v);
    if (h.rarity === "legendary") { legendRoll = v; break; }
  }
  assert(legendRoll !== null, "權重表中傳說可被自然抽中");
  const rNat = rollHeroWithPity(10, () => legendRoll);
  assert(rNat.hero.rarity === "legendary" && rNat.pity === 0, "自然抽中傳說時 pity 也歸零");

  const forcedLegendaryIds = new Set([0.01, 0.21, 0.41, 0.61, 0.81].map((poolRoll) => {
    const r = rollHeroWithPity(GACHA.pityLegendary - 1, sequenceRng([0.01, 0.01, poolRoll]));
    return r.hero.id;
  }));
  assert(forcedLegendaryIds.size === 5 && [...forcedLegendaryIds].every((id) => HEROES[id].rarity === "legendary"),
    `保底傳說會從 5 位傳說池挑選（${[...forcedLegendaryIds].join(",")}）`);
}

console.log("\n== 4. rollHeroWithPityPreferNew：第二隻英雄避開重複 ==");
{
  const duplicateArcher = sequenceRng([0.01, 0.01, 0.01]);
  const r = rollHeroWithPityPreferNew(1, ["archer"], duplicateArcher);
  assert(r.hero.id === "cleric", `已擁有遊俠時，第二抽撞遊俠會改給未擁有同稀有度英雄（${r.hero.id}）`);
  assert(r.replacedDuplicate && r.replacedDuplicate.id === "archer", "回傳 replacedDuplicate 便於追蹤真正撞到的重複英雄");
  assert(r.pity === 2, "改給非傳說新英雄時 pity 仍正常累積");

  const afterTwoOwned = rollHeroWithPityPreferNew(2, ["archer", "cleric"], sequenceRng([0.01, 0.01]));
  assert(afterTwoOwned.hero.id === "archer" && !afterTwoOwned.replacedDuplicate,
    "收集到 2 隻後恢復一般抽卡，重複交給魂晶補償處理");
}

console.log("");
if (failed === 0) { console.log("✅ 英雄抽卡測試全部通過"); process.exit(0); }
else { console.error(`❌ ${failed} 項失敗`); process.exit(1); }
