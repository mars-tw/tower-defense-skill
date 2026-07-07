/* =========================================================================
 * test-config.js — 塔防 config.js 健全性測試（CI 用，零依賴）
 * 執行：node scripts/test-config.js
 * ========================================================================= */

const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const cfg = require(path.join(__dirname, "..", "src", "config.js"));
const { TOWERS, ENEMIES, SKILLS, ELEMENTS, elementMultiplier, GAME, UPGRADE, MAPS, MAP_AFFIXES, ACHIEVEMENTS, BEGINNER_MISSIONS } = cfg;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { console.error("  ✗ " + msg); failed++; }
}

function normalizeResourcePath(value) {
  let v = String(value || "").trim().replace(/\\/g, "/");
  v = v.replace(/^\.?\//, "");
  v = v.replace(/[?#].*$/, "");
  return v;
}

function parseAppShell(swText) {
  const match = String(swText || "").match(/const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\];/);
  if (!match) return [];
  const entries = [];
  const re = /["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(match[1]))) entries.push(normalizeResourcePath(m[1]));
  return entries;
}

function collectLocalIndexResources(indexText) {
  const resources = new Set(["index.html"]);
  const attrRe = /\b(?:src|href)=["']([^"']+)["']/g;
  let m;
  while ((m = attrRe.exec(String(indexText || "")))) {
    const raw = m[1];
    if (!raw || /^(?:https?:|data:|mailto:|javascript:|#|\/\/)/i.test(raw)) continue;
    const rel = normalizeResourcePath(raw);
    if (rel) resources.add(rel === "" ? "index.html" : rel);
  }
  return resources;
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(fp));
    else out.push(fp);
  }
  return out;
}

function posixRel(fp) {
  return path.relative(ROOT, fp).replace(/\\/g, "/");
}

function detectTextQualityIssues(filename, text) {
  const commonMojibake = new Set([0x5697, 0x8763, 0x619b, 0x646e, 0x761c, 0x929d, 0x981d, 0x875a, 0x7485].map((c) => String.fromCharCode(c)));
  const issues = [];
  const source = String(text || "");
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\uFFFD") issues.push(`${filename}:U+FFFD@${i}`);
    else if (commonMojibake.has(ch)) issues.push(`${filename}:mojibake:${ch}@${i}`);
  }
  for (const m of source.matchAll(/\?{2,}/g)) issues.push(`${filename}:question-run@${m.index}`);
  return issues;
}

console.log("== 結構 ==");
assert(Object.keys(TOWERS).length >= 6, `砲塔 ≥6 種（${Object.keys(TOWERS).length}）`);
assert(Object.keys(ENEMIES).length >= 9, `敵人 ≥9 種（${Object.keys(ENEMIES).length}）`);
assert(Object.keys(SKILLS).length >= 3, `技能 ≥3 種（${Object.keys(SKILLS).length}）`);
assert(Object.values(ENEMIES).some((e) => e.boss), "至少有一個 Boss");

console.log("== R41：PWA/可近用性資產 ==");
{
  const root = ROOT;
  const manifestPath = path.join(root, "manifest.webmanifest");
  const swPath = process.env.TD_TEST_SW_PATH || path.join(root, "sw.js");
  const indexPath = process.env.TD_TEST_INDEX_PATH || path.join(root, "index.html");
  const offlinePath = path.join(root, "offline.html");
  const iconSize = (rel) => {
    const buf = fs.readFileSync(path.join(root, rel));
    const png = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
    return { png, width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const sw = fs.readFileSync(swPath, "utf8");
  const index = fs.readFileSync(indexPath, "utf8");
  const offline = fs.readFileSync(offlinePath, "utf8");
  const icon192 = iconSize("assets/icons/icon-192.png");
  const icon512 = iconSize("assets/icons/icon-512.png");
  const appShell = parseAppShell(sw);
  const shellSet = new Set(appShell);
  const localResources = collectLocalIndexResources(index);
  const manifestIcons = new Set((manifest.icons || []).map((i) => normalizeResourcePath(i.src)));
  const assetResources = new Set(
    walkFiles(path.join(root, "assets"))
      .filter((fp) => /\.png$/i.test(fp))
      .map(posixRel)
  );
  const requiredShell = new Set([
    "",
    "index.html",
    "offline.html",
    "manifest.webmanifest",
    "sw.js",
    ...localResources,
    ...manifestIcons,
    ...assetResources,
  ]);
  const missingShell = [...requiredShell].filter((rel) => !shellSet.has(rel));
  const missingFiles = [...shellSet].filter((rel) => rel && !fs.existsSync(path.join(root, rel)));
  assert(manifest.name === "無盡塔防" && manifest.short_name === "無盡塔防", "manifest 使用《無盡塔防》名稱");
  assert((manifest.icons || []).some((i) => i.src === "assets/icons/icon-192.png" && i.sizes === "192x192"), "manifest 指向 192 icon");
  assert((manifest.icons || []).some((i) => i.src === "assets/icons/icon-512.png" && i.sizes === "512x512"), "manifest 指向 512 icon");
  assert(icon192.png && icon192.width === 192 && icon192.height === 192, "192 icon 為有效 PNG");
  assert(icon512.png && icon512.width === 512 && icon512.height === 512, "512 icon 為有效 PNG");
  assert(sw.includes("CACHE_VERSION") && sw.includes("networkFirst") && sw.includes("cacheFirst"), "sw.js 有版本化快取與 network-first/cache-first 策略");
  assert(sw.includes("self.skipWaiting()") && sw.includes("self.clients.claim()") && sw.includes("caches.delete"), "sw.js 安裝即接管並清除舊快取");
  assert(sw.includes("offline.html") && fs.existsSync(offlinePath) && offline.includes("離線"), "sw.js 與離線 fallback 頁完整");
  assert(appShell.length >= requiredShell.size && missingShell.length === 0, `sw.js APP_SHELL 自動涵蓋 HTML/manifest/assets 本地資源（缺 ${missingShell.slice(0, 3).join(",") || "0"}）`);
  assert(missingFiles.length === 0, `sw.js APP_SHELL 清單檔案皆存在（缺 ${missingFiles.slice(0, 3).join(",") || "0"}）`);
  assert(sw.includes("assets|enemies") || (sw.includes("heroes") && sw.includes("enemies") && sw.includes("towers")), "sw.js 涵蓋 heroes/enemies/towers 圖像資產");
  assert(index.includes('rel="manifest"') && index.includes("navigator.webdriver") && index.includes("swtest"), "index 連結 manifest、webdriver 跳過 SW 註冊且提供 swtest");
  assert(index.includes("controllerchange") && index.includes("AUTO_RELOAD_WINDOW_MS") && index.includes("sessionStorage"), "index 具備 SW controllerchange 自動更新守衛");
  assert(index.includes("data-text-size") && index.includes(":focus-visible") && index.includes("checkUpdateBtn"), "index 有文字大小、focus-visible 與檢查更新 UI");

  // R45：URL 版本化守門 — 根治「新 HTML 配舊 JS」版本錯配
  const swVersion = (sw.match(/const\s+CACHE_VERSION\s*=\s*["']([^"']+)["']/) || [])[1] || "";
  const pwaVersion = (index.match(/const\s+PWA_VERSION\s*=\s*["']([^"']+)["']/) || [])[1] || "";
  assert(/^td-r\d+-v\d+$/.test(swVersion), `sw.js CACHE_VERSION 格式正確（${swVersion || "缺"}）`);
  assert(swVersion === pwaVersion, `index PWA_VERSION 與 sw CACHE_VERSION 一致（${pwaVersion || "缺"} / ${swVersion || "缺"}）`);
  const versionedRefs = [];
  const refRe = /\b(?:src|href)=["']([^"']+)["']/g;
  let refM;
  while ((refM = refRe.exec(index))) {
    const raw = refM[1];
    if (!raw || /^(?:https?:|data:|mailto:|javascript:|#|\/\/)/i.test(raw)) continue;
    if (/\.(?:js|webmanifest)(?:\?|$)/.test(raw)) versionedRefs.push(raw);
  }
  const badRefs = versionedRefs.filter((raw) => !raw.endsWith(`?v=${swVersion}`));
  assert(versionedRefs.length >= 6 && badRefs.length === 0,
    `index 本地 JS/manifest 皆帶 ?v=${swVersion}（共 ${versionedRefs.length}，異常 ${badRefs.slice(0, 3).join(",") || "0"}）`);
  const rawShellBody = (sw.match(/const\s+APP_SHELL\s*=\s*\[([\s\S]*?)\];/) || ["", ""])[1];
  const rawShellEntries = [...rawShellBody.matchAll(/["']([^"']+)["']/g)].map((m2) => m2[1]);
  const shellJs = rawShellEntries.filter((e) => /\.js(?:\?|$)/.test(e) && !/\/sw\.js$/.test(e));
  const badShellJs = shellJs.filter((e) => !e.endsWith(`?v=${swVersion}`));
  assert(shellJs.length >= 5 && badShellJs.length === 0,
    `sw.js APP_SHELL 的 JS 皆帶 ?v=${swVersion}（共 ${shellJs.length}，異常 ${badShellJs.slice(0, 3).join(",") || "0"}）`);
  const bootGuardAt = index.indexOf("getRegistration");
  const firstExternalJsAt = index.indexOf('src="src/config.js');
  assert(bootGuardAt !== -1 && firstExternalJsAt !== -1 && bootGuardAt < firstExternalJsAt,
    "index 具備早期 SW boot guard（外部 JS 載入前先 registration.update()）");
}

console.log("== R41：文案品質守門 ==");
{
  const sourceFiles = [
    process.env.TD_TEST_INDEX_PATH || path.join(ROOT, "index.html"),
    ...walkFiles(path.join(ROOT, "src")).filter((fp) => /\.js$/i.test(fp)),
  ];
  const issues = sourceFiles.flatMap((fp) => detectTextQualityIssues(posixRel(fp), fs.readFileSync(fp, "utf8")));
  const syntheticRed = detectTextQualityIssues("synthetic", `壞文案?? ${String.fromCharCode(0x5697)}`);
  assert(syntheticRed.length >= 2, "文案品質守門可偵測連續問號與 mojibake 壞樣本");
  assert(issues.length === 0, `index.html + src/*.js 無 U+FFFD/連續問號/mojibake（命中 ${issues.slice(0, 3).join(",") || "0"}）`);
}

console.log("== 砲塔欄位 ==");
let badT = 0;
for (const t of Object.values(TOWERS)) {
  if (!t.id || !t.name || t.range == null || t.damage == null || t.cost == null || !t.element) badT++;
  if (!ELEMENTS[t.element]) badT++;
}
assert(badT === 0, `砲塔欄位完整且元素合法（異常 ${badT}）`);
assert(TOWERS.poison && TOWERS.poison.poisonDps > 0 && TOWERS.poison.poisonDuration > 0 && TOWERS.poison.poisonMaxStacks === 3,
  "毒霧塔有 DoT 欄位（DPS/持續/最多 3 層）");
assert(TOWERS.support && TOWERS.support.support === true && TOWERS.support.buff > 0 && TOWERS.support.damage === 0 && TOWERS.support.fireRate === 0,
  "聖光塔為不攻擊支援塔，且有 buff 欄位");
assert(TOWERS.frost.cost === 70 && TOWERS.frost.fireRate === 1.45 && TOWERS.frost.slow === 0.5,
  "寒冰塔 Stage 5 定位：70 金、1.45 攻速、維持 50% 減速");
assert(TOWERS.support.cost === 110 && TOWERS.support.buff === 0.20 && TOWERS.support.buffPerLevel === 0.04,
  "聖光塔 Stage 5 定位：110 金、20% 基礎增傷、每級 +4%");

console.log("== 敵人欄位 ==");
let badE = 0;
for (const e of Object.values(ENEMIES)) {
  if (!e.id || e.hp == null || e.speed == null || e.reward == null || !e.element) badE++;
  if (!e.counterHint || typeof e.counterHint !== "string") badE++;
}
assert(badE === 0, `敵人欄位完整（異常 ${badE}）`);
assert(Object.values(ENEMIES).every((e) => e.counterHint && e.counterHint.length >= 8), "每種敵人都有反制提示");
assert(ENEMIES.shieldman && ENEMIES.shieldman.shield > 0 && ENEMIES.shieldman.element === "physical",
  "盾兵有護盾且歸物理系");
assert(ENEMIES.medic && ENEMIES.medic.healRadius === 80 && ENEMIES.medic.healAmount > 0 && ENEMIES.medic.healInterval === 2,
  "醫官有治療半徑、治療量與 2 秒間隔");
assert(ENEMIES.goblin.ability && ENEMIES.goblin.ability.id === "dodgeFirst" && ENEMIES.goblin.ability.chance > 0,
  "哥布林具備首擊閃避能力配置");
assert(ENEMIES.orc.ability && ENEMIES.orc.ability.id === "bloodrage" && ENEMIES.orc.ability.speedMul > 1,
  "獸人具備殘血狂暴加速配置");
assert(ENEMIES.bat.ability && ENEMIES.bat.ability.id === "splitBat" && ENEMIES.bat.ability.childHpMul > 0,
  "蝙蝠具備死亡分裂配置");

console.log("== Stage 4：地圖資料 ==");
let badMap = 0;
for (const m of Object.values(MAPS || {})) {
  if (!m.id || !m.label || !(m.goldMul > 0) || !Array.isArray(m.path) || m.path.length < 2) badMap++;
  if (Array.isArray(m.path) && m.path.some((p) => typeof p.x !== "number" || typeof p.y !== "number")) badMap++;
}
assert(Object.keys(MAPS || {}).length >= 2, `至少 2 張地圖（實際 ${Object.keys(MAPS || {}).length}）`);
assert(badMap === 0, `地圖欄位完整且 path 合法（異常 ${badMap}）`);
assert(MAPS.plains && MAPS.canyon && MAPS.canyon.path.length > MAPS.plains.path.length && MAPS.canyon.goldMul < MAPS.plains.goldMul,
  "迂迴峽谷路徑較曲折且資源較少");
for (const pollutedKey of ["__proto__", "toString", "constructor"]) {
  cfg.setMap("canyon");
  cfg.setMap(pollutedKey);
  assert(cfg.getMap().id === "canyon", `setMap 忽略原型鍵 ${pollutedKey}`);
}
cfg.setMap("plains");

console.log("== R17：地圖詞綴配置 ==");
{
  const affixes = Object.values(MAP_AFFIXES || {});
  let badAffix = 0;
  for (const a of affixes) {
    if (!a.id || !a.label || !a.desc) badAffix++;
    if (!a.towerImpact || typeof a.towerImpact !== "string") badAffix++;
    if (!(a.enemyHpMul > 0) || !(a.enemySpeedMul > 0) || !(a.towerRangeMul > 0) || !(a.towerDamageMul > 0)) badAffix++;
    if (!(a.waveGoldMul > 0) || !(a.killGoldMul > 0)) badAffix++;
    if (!Number.isFinite(a.expectedGoldDelta) || !Number.isFinite(a.expectedPowerDelta)) badAffix++;
  }
  assert(affixes.length >= 4 && affixes.length <= 6, `地圖詞綴 4~6 種（目前 ${affixes.length}）`);
  assert(badAffix === 0, `地圖詞綴欄位完整且倍率為正（缺陷 ${badAffix}）`);
  assert(affixes.every((a) => a.towerImpact.includes("塔") || a.towerImpact.includes("控場") || a.towerImpact.includes("升級")),
    "每個詞綴都有對塔種影響摘要");
}

console.log("== 元素克制 ==");
assert(elementMultiplier("fire", "ice") === 1.5, "火克冰 = 1.5");
assert(elementMultiplier("ice", "fire") === 0.66, "冰被火克 = 0.66");
assert(elementMultiplier("thunder", "fire") === 1.5, "雷克火 = 1.5");
assert(elementMultiplier("physical", "ice") === 1, "物理中性 = 1");

console.log("== 平衡參數 ==");
assert(GAME.startGold > 0, "起始金錢為正");
assert(GAME.hpGrowthEarly > 0 && GAME.hpGrowthLate > 0, "波次血量有成長（無盡遞增，分段）");
assert(UPGRADE.maxLevel >= 2, "砲塔可升級");
assert(UPGRADE.maxLevel === 10, "砲塔升級上限提高到 Lv.10");
assert(UPGRADE.damageMul > 1 && UPGRADE.rangeMul > 1 && UPGRADE.costMul > 1, "升級傷害、射程與造價皆隨等級遞增");
assert(UPGRADE.costMul >= 1.5 && UPGRADE.costMul <= 1.6, `Lv.10 造價曲線維持後期金錢出口（costMul=${UPGRADE.costMul}）`);
{
  const attackRanges = Object.values(TOWERS).filter((t) => !t.support).map((t) => t.range);
  assert(Math.min(...attackRanges) >= 120 && Math.max(...attackRanges) <= 140,
    `攻擊塔基礎射程小幅提高且未全圖化（${Math.min(...attackRanges)}~${Math.max(...attackRanges)}px）`);
  assert(TOWERS.support.range === 150, "聖光塔支援射程提高到 150px");
}

console.log("== 守護女神 ==");
const { GODDESS } = cfg;
assert(GODDESS && GODDESS.baseHp > 0, "女神有起始生命");
assert(GODDESS.maxLevel >= 2 && GODDESS.hpPerLevel > 0, "女神可升級加生命");
assert(GODDESS.maxLevel === 8, "女神升級上限提高到 Lv.8");
assert(GODDESS.smiteUnlockLevel >= 1, "女神有聖光反擊解鎖等級");

console.log("== Stage 1：元素克制閉環 ==");
const { COUNTERS, DIFFICULTIES, EVENT_WAVES, getEventWave, waveTheme, themeEnemyPool } = cfg;
// 每個元素塔的克制目標都要有實際存在的普通敵人——不然「火克冰」只是教學裡的空話
for (const [atk, def] of Object.entries(COUNTERS)) {
  const targets = Object.values(ENEMIES).filter((e) => !e.boss && e.element === def);
  assert(targets.length >= 1, `${atk} 克 ${def}：場上有 ${def} 系普通敵人可克制（${targets.map((e) => e.id).join(",") || "無"}）`);
}

console.log("== Stage 1：波次主題與敵人池一致 ==");
// 預告顯示的每個主題，themeEnemyPool 都要有敵人，出怪偏壓才有東西可抽
const themesSeen = new Set();
for (let w = 4; w <= 40; w++) { const t = waveTheme(w); if (t) themesSeen.add(t); }
assert(themesSeen.size >= 3, `波次主題輪替涵蓋多元素（${[...themesSeen].join(",")}）`);
for (const t of themesSeen) {
  assert(themeEnemyPool(t) !== null, `主題「${t}」有對應敵人池（${(themeEnemyPool(t) || []).join(",")}）`);
}
{
  const physicalPool = themeEnemyPool("physical") || [];
  assert(physicalPool.includes("shieldman"), "物理主題池包含盾兵");
  assert(physicalPool.includes("medic"), "物理主題池包含醫官");
}

console.log("== Stage 1：事件波在所有難度都會出現 ==");
// 修正前 wave%3===0 撞上無盡難度 bossEvery=3，事件波在該難度永遠不觸發
for (const d of Object.values(DIFFICULTIES)) {
  let count = 0;
  for (let w = 1; w <= 30; w++) {
    const isBoss = w % d.bossEvery === 0;
    if (getEventWave(w, isBoss, 0.5)) count++;
  }
  assert(count >= 5, `【${d.label}】前 30 波至少 5 次事件波（實際 ${count}）`);
}
// 事件波永不與 Boss 波重疊
{
  let overlap = 0;
  for (const d of Object.values(DIFFICULTIES)) {
    for (let w = 1; w <= 60; w++) {
      const isBoss = w % d.bossEvery === 0;
      if (isBoss && getEventWave(w, isBoss, 0.5)) overlap++;
    }
  }
  assert(overlap === 0, "事件波永不與 Boss 波重疊（isBoss 保護有效）");
}

console.log("== Stage 1：難度/事件波欄位健全 ==");
let badD = 0;
for (const d of Object.values(DIFFICULTIES)) {
  if (!(d.hpMul > 0) || !(d.goldMul > 0) || !(d.goddessMul > 0) || !(d.bossEvery >= 1)) badD++;
}
assert(badD === 0, `難度欄位完整且為正（異常 ${badD}）`);
let badEv = 0;
for (const e of Object.values(EVENT_WAVES)) {
  if (!(e.speedMul > 0) || !(e.hpMul > 0) || !(e.countMul > 0) || !(e.goldMul > 0)) badEv++;
  if (e.forceType && !ENEMIES[e.forceType]) badEv++;
  if (e.forceType === "medic") badEv++;
}
assert(badEv === 0, `事件波欄位完整、forceType 指向存在敵人且不強制醫官（異常 ${badEv}）`);

console.log("== Stage 3：成就目錄 ==");
let badAch = 0;
for (const a of Object.values(ACHIEVEMENTS || {})) {
  if (!a.id || !a.label || !a.desc || typeof a.check !== "function" || !(a.reward >= 0)) badAch++;
}
assert(Object.keys(ACHIEVEMENTS || {}).length >= 8, `成就至少 8 個（實際 ${Object.keys(ACHIEVEMENTS || {}).length}）`);
assert(badAch === 0, `成就欄位完整且 reward 合法（異常 ${badAch}）`);

console.log("== R7：首 10 波任務線 ==");
let badMission = 0;
let missionRewardTotal = 0;
for (const m of Object.values(BEGINNER_MISSIONS || {})) {
  if (!m.id || !m.label || !m.desc || typeof m.check !== "function" || !(m.reward > 0)) badMission++;
  missionRewardTotal += m.reward || 0;
}
assert(Object.keys(BEGINNER_MISSIONS || {}).length >= 5 && Object.keys(BEGINNER_MISSIONS || {}).length <= 8,
  `任務數量 5~8 個（實際 ${Object.keys(BEGINNER_MISSIONS || {}).length}）`);
assert(badMission === 0, `任務欄位完整且 reward 合法（異常 ${badMission}）`);
assert(missionRewardTotal <= 40, `任務線總增發 ≤40💎（實際 ${missionRewardTotal}💎）`);

console.log("");
if (failed === 0) { console.log("✅ 全部測試通過"); process.exit(0); }
else { console.error(`❌ ${failed} 項失敗`); process.exit(1); }
