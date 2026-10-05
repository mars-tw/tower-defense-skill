/* Chromium 任務整合稽核：明確注入塔／波數／戰鬥紀錄與存檔失敗。
 * 這是 UI/規則契約驗證，並非真玩家通關或無注入的遊玩體驗。
 */
"use strict";
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const generation = (require("../package.json").pwaVersion.match(/^td-(r\d+)-/) || [])[1] || "r78";
const OUT = path.resolve(ROOT, process.env.TD_OPERATIONS_EVIDENCE_DIR || `docs/evidence/${generation.toUpperCase()}/operations-review`);
const trace = { method: "Real Chromium; deliberate TD state/telemetry and Storage failure injection; not a player completion run", injections: [], snapshots: [], findings: [], errors: [] };
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
  const target = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
  const relative = path.relative(ROOT, target);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) { response.writeHead(404); response.end(); return; }
  response.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(target).pipe(response);
});

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
  page.on("pageerror", (error) => trace.errors.push(error.message));
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => !!window.TD && !!window.__tdUI && !!window.TDOperations);
    if (await page.locator("#tutorial").evaluate((element) => element.classList.contains("show"))) await page.locator("#tutorialQuick").click();
    if (await page.locator("#diffOverlay").evaluate((element) => element.classList.contains("show"))) {
      await page.locator(".diff-opt").first().click();
      await page.locator('.map-opt[data-map-id="plains"]').click();
    }
    await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"));
    const runSeed = await page.evaluate(() => {
      for (let runSeed = 1; runSeed <= 1000; runSeed++) {
        const ctx = { runSeed, affixSeed: 611, mapId: "plains", difficultyId: "normal" };
        if (TDOperations.chapterFor({ ...ctx, clearedWave: 3 }).tactic.id === "anchor" && TDOperations.chapterFor({ ...ctx, clearedWave: 5 }).tactic.id === "spell") return runSeed;
      }
      throw new Error("No suitable fixture seed");
    });
    async function seedRun(seedValue) {
      trace.injections.push({ kind: "newRunAndMeta", runSeed: seedValue, affixSeed: 611, allBeginnerMissionsClaimed: true, allAchievementsClaimed: true });
      await page.evaluate((runSeed) => {
        const current = TDRules.migrateMeta(JSON.parse(localStorage.getItem("td_meta_v1") || "null"));
        current.beginnerMissions = Object.fromEntries(Object.keys(BEGINNER_MISSIONS).map((id) => [id, true]));
        current.achievements = Object.fromEntries(Object.keys(ACHIEVEMENTS).map((id) => [id, true]));
        localStorage.setItem("td_meta_v1", JSON.stringify(current));
        TD.newGame({ runSeed, affixSeed: 611 });
        TD.setPaused(true);
        __tdUI();
      }, seedValue);
    }
    async function patch(label, values) {
      trace.injections.push({ kind: "TD.stateAndTelemetry", label, values });
      await page.evaluate((values) => { Object.assign(TD.state(), values, { running: false, betweenWaves: true, paused: true }); __tdUI(); }, values);
    }
    async function snapshot(label) {
      const result = await page.evaluate(() => {
        const state = TD.state();
        return { wave: state.wave, clearedWave: state.clearedWave, gold: state.gold, over: state.over, runKey: state.operations.runKey,
          claimed: { ...state.operations.claimed }, skipped: { ...state.operations.skipped }, meta: JSON.parse(localStorage.getItem("td_meta_v1")),
          panel: document.getElementById("operationsPanel").innerText, brief: document.getElementById("briefTitle").textContent };
      });
      trace.snapshots.push({ label, ...result });
      console.log(`${label}: wave ${result.wave}, cleared ${result.clearedWave}, gold ${result.gold}, soul ${result.meta.soulCrystal}`);
      return result;
    }
    const fixtures = [{ type: "arrow", level: 1, x: 24, y: 24, cx: 0, cy: 0, cooldown: 0 }, { type: "frost", level: 1, x: 120, y: 24, cx: 2, cy: 0, cooldown: 0 }];
    await seedRun(runSeed);
    const initial = await snapshot("initial");
    await patch("chapter-1 mixed tactic", { towers: fixtures });
    const mixed = await snapshot("mixed-claimed");
    assert.equal(mixed.gold - initial.gold, 12);
    await page.evaluate(() => { for (let i = 0; i < 5; i++) __tdUI(); });
    assert.equal((await snapshot("mixed-repeat-refresh")).gold, mixed.gold);
    await patch("chapter-1 clear; not a simulated combat result", { wave: 3, clearedWave: 3 });
    const chapter2 = await snapshot("chapter-2-start");
    assert.equal(chapter2.gold - mixed.gold, 18);
    assert(chapter2.panel.includes("第 4–5 波"));
    await patch("chapter-2 upgraded main fixture", { towers: [{ ...fixtures[0], level: 2 }, fixtures[1]] });
    const anchor = await snapshot("chapter-2-anchor");
    assert.equal(anchor.gold - chapter2.gold, 16);
    await patch("chapter-2 clear; historical skill damage excluded", { wave: 5, clearedWave: 5, combatTelemetry: { waves: { 4: { endedAt: 5, leaks: 0, damageBySource: { skill: 999 } } } } });
    const chapter3 = await snapshot("chapter-3-start");
    assert.equal(chapter3.gold - anchor.gold, 24);
    assert(chapter3.panel.includes("第 6–10 波"));
    assert(chapter3.panel.includes("0/80傷害"));
    await patch("chapter-3 effective skill damage fixture", { wave: 6, combatTelemetry: { waves: { 6: { endedAt: null, leaks: 0, damageBySource: { skill: 80 } } } } });
    const spell = await snapshot("chapter-3-spell");
    assert.equal(spell.gold - chapter3.gold, 20);
    await patch("chapter-3 clear; remove towers to avoid preflight chapter-4 tactics", { wave: 10, clearedWave: 10, towers: [] });
    const through10 = await snapshot("chapter-3-clear");
    assert.equal(through10.gold - spell.gold, 34);
    assert.equal(through10.gold - initial.gold, 124);
    assert.equal(through10.meta.soulCrystal - initial.meta.soulCrystal, 3);
    await page.screenshot({ path: path.join(OUT, "three-chapters.png") });

    const code = await page.evaluate(() => __tdSaveManager.export());
    const imported = await page.evaluate((code) => __tdSaveManager.import(code, { skipReload: true }), code);
    assert(imported.ok);
    await seedRun(runSeed);
    await patch("replay same run identity after export/import", { wave: 6, clearedWave: 5, towers: [{ ...fixtures[0], level: 2 }, fixtures[1]], combatTelemetry: { waves: { 6: { endedAt: null, leaks: 0, damageBySource: { skill: 80 } } } } });
    const replay = await snapshot("same-seed-export-import-replay");
    assert.equal(replay.gold, initial.gold);
    assert.equal(replay.meta.soulCrystal, through10.meta.soulCrystal);
    await seedRun(runSeed + 10000);
    await patch("new identity starts independent tactic", { towers: fixtures });
    assert.equal((await snapshot("new-seed-independent")).gold, initial.gold + 12);

    await seedRun(runSeed + 20000);
    await patch("defeat before chapter-1 tactic refresh", { wave: 1, over: true, towers: fixtures });
    const defeated = await snapshot("defeat");
    assert.equal(defeated.gold, initial.gold);
    assert(defeated.panel.includes("已錯過"));
    assert(defeated.brief.includes("防線失守"));

    await seedRun(runSeed + 30000);
    trace.injections.push({ kind: "Storage failure", description: "Storage.prototype.setItem rejects td_meta_v1 writes until restored" });
    await page.evaluate(() => {
      window.__operationsOriginalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) { if (key === "td_meta_v1") throw new DOMException("Injected quota failure", "QuotaExceededError"); return __operationsOriginalSetItem.call(this, key, value); };
    });
    await patch("complete tactic while storage fails", { towers: fixtures });
    const failedSave = await snapshot("failed-save");
    assert.equal(failedSave.gold, initial.gold);
    if (failedSave.panel.includes("已領取")) trace.findings.push({ priority: "P2", id: "OP-SAVE-STATUS", issue: "Storage write failure leaves the operation marked claimed in the panel although gold and soul are not paid", reproduction: "Reject td_meta_v1 setItem, complete the mixed tactic, run __tdUI", actualGoldDelta: failedSave.gold - initial.gold });
    assert(failedSave.panel.includes("等待存檔"));
    assert(failedSave.brief.includes("等待存檔"));
    await page.screenshot({ path: path.join(OUT, "failed-save-status.png") });
    await page.evaluate(() => { Storage.prototype.setItem = __operationsOriginalSetItem; __tdUI(); });
    const restored = await snapshot("storage-restored-no-duplicate");
    assert.equal(restored.gold, initial.gold + 12);
    await page.evaluate(() => { for (let i = 0; i < 5; i++) __tdUI(); });
    assert.equal((await snapshot("storage-restored-repeat-refresh")).gold, restored.gold);

    trace.injections.push({ kind: "one-write Storage failure plus beginner reward", description: "One operation write fails; firstUpgrade beginner mission then saves in the same refresh. Testing that the pending operation claim is not accidentally committed without its reward." });
    const overlap = await page.evaluate((fixtures) => {
      let runSeed = 100001;
      while (TDOperations.chapterFor({ runSeed, affixSeed: 611, mapId: "plains", difficultyId: "normal", clearedWave: 3 }).tactic.id !== "anchor") runSeed++;
      const meta = TDRules.migrateMeta(JSON.parse(localStorage.getItem("td_meta_v1")));
      delete meta.beginnerMissions.firstUpgrade;
      localStorage.setItem("td_meta_v1", JSON.stringify(meta));
      TD.newGame({ runSeed, affixSeed: 611 });
      Object.assign(TD.state(), { wave: 3, clearedWave: 3, towers: fixtures, paused: true, running: false, betweenWaves: true });
      __tdUI();
      const before = TD.state().gold;
      const original = Storage.prototype.setItem;
      let writes = 0;
      Storage.prototype.setItem = function (key, value) { if (key === "td_meta_v1" && writes++ === 0) throw new DOMException("Injected one-write failure", "QuotaExceededError"); return original.call(this, key, value); };
      TD.state().towers[0].level = 2;
      __tdUI();
      const first = TD.state().gold;
      __tdUI();
      const after = TD.state().gold;
      Storage.prototype.setItem = original;
      const saved = JSON.parse(localStorage.getItem("td_meta_v1"));
      return { runSeed, before, first, after, expected: before + 16, pending: TD.state().operationPendingAwards, beginnerClaimed: saved.beginnerMissions.firstUpgrade, ledgerClaimed: saved.operationRuns[TD.state().operations.runKey].claimed["chapter-2-tactic"] };
    }, JSON.parse(JSON.stringify(fixtures)));
    trace.snapshots.push({ label: "pending-beginner-save-overlap", ...overlap });
    if (overlap.after !== overlap.expected) trace.findings.push({ priority: "P1", id: "OP-PENDING-OVERLAP", issue: "A beginner mission save in the same refresh commits the pending operation claim without its gold; next refresh filters out the pending award", ...overlap });
    console.log("pending-beginner-save-overlap", JSON.stringify(overlap));
    assert.equal(trace.errors.length, 0);
    assert.equal(trace.findings.length, 0, `Unresolved operation findings: ${trace.findings.map((item) => item.id).join(", ")}`);
    console.log("PASS: three chapters, 124 gold / 3 soul, repeat protection, export/import, new run, defeat and Storage recovery.");
  } finally {
    fs.writeFileSync(path.join(OUT, "trace.json"), JSON.stringify(trace, null, 2));
    await browser.close();
    server.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; server.close(); });
