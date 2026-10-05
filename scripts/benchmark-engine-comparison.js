#!/usr/bin/env node
"use strict";

// Controlled before/after comparison: selected baseline vs a snapshot of the current
// engine, sharing the CURRENT config, CSS and exact same asset files. Combat
// stress is explicitly debug-injected; it is not a claim about natural waves.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "..");
const generation = (require("../package.json").pwaVersion.match(/^td-(r\d+)-/) || [])[1] || "r78";
const OUT = path.resolve(ROOT, process.env.TD_ENGINE_BENCH_DIR || `docs/evidence/${generation.toUpperCase()}/engine-comparison`);
const TEMP = path.join(ROOT, ".audit-tmp", "engine-comparison");
const BASE_REF = process.env.TD_ENGINE_BASELINE_REF || "HEAD";
const BASE_FILE = process.env.TD_ENGINE_BASELINE_FILE ? path.resolve(ROOT, process.env.TD_ENGINE_BASELINE_FILE) : null;
const RUNS = Math.max(1, Math.min(5, Number(process.env.TD_ENGINE_BENCH_RUNS) || 3));
const SAMPLES = Math.max(60, Math.min(600, Number(process.env.TD_ENGINE_BENCH_SAMPLES) || 120));
const DIAGNOSTIC = process.env.TD_ENGINE_DIAGNOSTIC === "1";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))];

function validateFinalResult(result) {
  assert.equal(result.profiles.length, 8, "both viewports/scenarios/revisions must complete");
  for (const comparison of result.comparisons) {
    const toleranceMs = Math.max(.5, comparison.beforeP95Ms * .15);
    assert(comparison.afterP95Ms <= 18, `${comparison.viewport}/${comparison.scenario}: final p95 must fit 18 ms`);
    assert(comparison.afterP95Ms <= comparison.beforeP95Ms + toleranceMs,
      `${comparison.viewport}/${comparison.scenario}: regression beyond ${toleranceMs.toFixed(2)} ms tolerance`);
  }
  for (const profile of result.profiles.filter((p) => p.revision === "after")) {
    assert.equal(profile.errors.length, 0);
    assert(profile.final.engine.hitFrameEntries <= profile.final.engine.maxHitFrameEntries);
    assert(profile.final.engine.projectileSpriteEntries <= profile.final.engine.maxProjectileSpriteEntries);
  }
  if (result.samplingPattern === "interleaved matched-clock AB/BA") {
    for (const after of result.profiles.filter((profile) => profile.revision === "after")) {
      const before = result.profiles.find((profile) => profile.revision === "before" && profile.viewport === after.viewport && profile.scenario === after.scenario);
      assert.equal(before.runs.length, after.runs.length);
      for (let run = 0; run < after.runs.length; run++) {
        assert.equal(before.runs[run].sampleFrames, result.samplesPerRun);
        assert.equal(after.runs[run].sampleFrames, result.samplesPerRun);
        assert(Math.abs(before.runs[run].simulationStartSeconds - after.runs[run].simulationStartSeconds) < 1e-9);
        assert(Math.abs(before.runs[run].simulationEndSeconds - after.runs[run].simulationEndSeconds) < 1e-9);
        assert.equal(before.runs[run].orderInRound, run % 2 ? 1 : 0);
        assert.equal(after.runs[run].orderInRound, run % 2 ? 0 : 1);
      }
    }
  }
  result.gate = "PASS: all final p95 <= 18 ms, no regression beyond max(0.5 ms, 15%), bounded caches";
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TEMP, { recursive: true });
  if (BASE_FILE && (path.relative(ROOT, BASE_FILE).startsWith("..") || path.isAbsolute(path.relative(ROOT, BASE_FILE)))) {
    throw new Error("Engine baseline file must remain inside this project.");
  }
  const sources = { before: BASE_FILE ? fs.readFileSync(BASE_FILE, "utf8") : execFileSync("git", ["show", `${BASE_REF}:src/game.js`], { cwd: ROOT, encoding: "utf8" }),
    after: fs.readFileSync(path.join(ROOT, "src", "game.js"), "utf8") };
  if (DIAGNOSTIC) {
    function block(source, name, next) {
      return source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));
    }
    sources["after-no-filter"] = sources.after.replace('ctx.filter = "brightness(0) saturate(100%) invert(1)";', 'ctx.filter = "none";');
    sources["after-old-ambient"] = sources.after.replace(block(sources.after, "drawMapAtmosphere", "buildPathDetailCache"),
      block(sources.before, "drawMapAtmosphere", "buildPathDetailCache"));
    sources["after-old-path"] = sources.after.replace(block(sources.after, "drawPath", "bakePath"),
      block(sources.before, "drawPath", "drawBuildableCells"));
    const functions = { update: "dt", render: "interpolation", drawBackground: "", drawPath: "", drawMapAtmosphere: "",
      drawTower: "tw, drawIndex, towerCount, renderProfile", drawEnemy: "e", drawBullet: "b", drawParticle: "p" };
    for (const revision of Object.keys(sources)) {
      let source = sources[revision], wrappers = "";
      for (const [name, args] of Object.entries(functions)) {
        source = source.replace(`function ${name}(`, `function __profileRaw_${name}(`);
        wrappers += `\nfunction ${name}(${args}) { const start = performance.now(); try { return __profileRaw_${name}(${args}); }
          finally { const ms = performance.now() - start; const row = window.__engineTimings['${name}'] || (window.__engineTimings['${name}'] = { count: 0, totalMs: 0, maxMs: 0 });
          row.count++; row.totalMs += ms; row.maxMs = Math.max(row.maxMs, ms);
          ${["drawBackground", "drawPath", "drawMapAtmosphere"].includes(name) ? "row.state = { filter: ctx.filter, shadowBlur: ctx.shadowBlur, composite: ctx.globalCompositeOperation, alpha: ctx.globalAlpha };" : ""} } }`;
      }
      const last = source.lastIndexOf("})();");
      sources[revision] = "window.__engineTimings = {};\n" + source.slice(0, last) + wrappers + source.slice(last);
    }
  }
  for (const [revision, source] of Object.entries(sources)) fs.writeFileSync(path.join(TEMP, `${revision}-game.js`), source);
  // Keep the shipped battlefield/layout and engine dependencies, while excluding
  // UI callbacks so new UI-only interfaces cannot break the old engine baseline.
  const keepScripts = /src\/(?:config|heroes|rules|operations|lore|enemy-animation|hero-animation|map-art|game)\.js/;
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,
    (tag) => keepScripts.test(tag) ? tag : "");
  const server = http.createServer((req, res) => {
    const request = new URL(req.url, "http://local");
    const revision = request.searchParams.get("revision");
    if (request.pathname === "/") { res.setHeader("Content-Type", "text/html"); res.end(html); return; }
    if (request.pathname === "/src/game.js") {
      const referer = new URL(req.headers.referer || "http://local/");
      const selected = referer.searchParams.get("revision") || "after";
      res.setHeader("Content-Type", "application/javascript"); res.end(sources[revision || selected]); return;
    }
    const file = path.resolve(ROOT, "." + decodeURIComponent(request.pathname));
    const relative = path.relative(ROOT, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader("Content-Type", ({ ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json",
      ".webp": "image/webp", ".webmanifest": "application/manifest+json" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch();
  const result = { startedAt: new Date().toISOString(), baselineRef: BASE_FILE ? path.relative(ROOT, BASE_FILE).replace(/\\/g, "/") : BASE_REF,
    baselineKind: BASE_FILE ? "verified local snapshot" : "git reference", scenarioType: "debug injected, production update + render",
    sources: Object.fromEntries(Object.entries(sources).map(([revision, source]) => [revision, sha256(source)])),
    runs: RUNS, samplesPerRun: SAMPLES, samplingPattern: DIAGNOSTIC ? "sequential diagnostic" : "interleaved matched-clock AB/BA", samplingOrder: [], profiles: [] };
  async function prepareProfile(viewport, scenario, revision) {
    const startedAt = new Date().toISOString();
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height },
      hasTouch: viewport.mobile, isMobile: viewport.mobile });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      let seed = 130363;
      Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?revision=${revision}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.TD && TD.debug.step);
    await page.evaluate((scenario) => {
      document.querySelectorAll("[role=dialog]").forEach((el) => el.remove());
      document.querySelectorAll(".panel-drawer").forEach((el) => { el.open = false; });
      document.body.classList.remove("r71-advisor-modal");
      TD.setMap("plains"); TD.newGame({ runSeed: 104729, affixSeed: 130363 });
      TD.setPerformanceMode("high"); TD.setReducedEffects(false); TD.setAudioMuted(true);
      const st = TD.state(); st.running = true; st.affix = null; st.currentEvent = null; st.banner = null;
      st.betweenWaves = true; st.gold = 999999;
      if (scenario !== "18-enemies") {
        const cells = [];
        const blocked = TDRules.pathBlockedCells(st.path, 40);
        for (let cy = 1; cy < 15; cy++) for (let cx = 1; cx < 23; cx++) {
          const x = cx * 40 + 20, y = cy * 40 + 20, distance = TDRules.distanceToPath(x, y, st.path);
          if (!blocked.has(`${cx},${cy}`) && distance < 110) cells.push({ cx, cy, x, y });
        }
        const types = Object.keys(TD.config.TOWERS);
        for (let index = 0; index < 30; index++) {
          const cell = cells[Math.floor(index * cells.length / 30)];
          st.towers.push({ ...cell, type: types[index % types.length], level: [1, 4, 8][index % 3], cd: 0, order: index });
        }
      }
      const count = scenario === "18-enemies" ? 18 : 80;
      const segments = [], total = st.path.reduce((sum, point, index) => {
        if (!index) return sum;
        const previous = st.path[index - 1], length = Math.hypot(point.x - previous.x, point.y - previous.y);
        segments.push({ previous, point, length, start: sum, wp: index }); return sum + length;
      }, 0);
      for (let index = 0; index < count; index++) {
        const distance = (index + .5) * total / count;
        const segment = segments.find((s) => s.start + s.length >= distance);
        const k = (distance - segment.start) / segment.length;
        TD.debug.spawnEnemy(index % 19 === 0 ? "boss" : index % 2 ? "slime" : "goblin", {
          x: segment.previous.x + (segment.point.x - segment.previous.x) * k,
          y: segment.previous.y + (segment.point.y - segment.previous.y) * k,
          wp: segment.wp, walkDist: distance, speed: 0, hp: 1e9, maxHp: 1e9, ability: null,
        });
      }
      for (let index = 0; index < 60; index++) TD.debug.step(1 / 60);
    }, scenario);
    await page.waitForTimeout(600);
    // Trigger outline/tint generation after the new atlas/projectiles have
    // decoded; let their idle work settle before sampling steady frames.
    await page.evaluate(() => { for (let frame = 0; frame < 60; frame++) TD.debug.step(1 / 60); });
    await page.waitForTimeout(250);
    if (DIAGNOSTIC) await page.evaluate(() => { window.__engineTimings = {}; });
    const warmupSimulationSeconds = await page.evaluate(() => TD.state().clock);
    return { viewport, scenario, revision, startedAt, context, page, errors, warmupSimulationSeconds, runs: [] };
  }
  async function sampleProfile(item, run, orderInRound) {
    const { page, runs, viewport, scenario, revision } = item;
    await page.bringToFront();
    const startedAt = new Date().toISOString();
    const simulationStartSeconds = await page.evaluate(() => TD.state().clock);
    const costs = await page.evaluate((samples) => new Promise((resolve) => {
      const values = [];
      function frame() {
        const start = performance.now(); TD.debug.step(1 / 60); values.push(performance.now() - start);
        if (values.length < samples) requestAnimationFrame(frame); else resolve(values);
      }
      requestAnimationFrame(frame);
    }), SAMPLES);
    const simulationEndSeconds = await page.evaluate(() => TD.state().clock);
    const endedAt = new Date().toISOString();
    assert.equal(costs.length, SAMPLES);
    assert(Math.abs(simulationEndSeconds - simulationStartSeconds - SAMPLES / 60) < 1e-7,
      "Each sample must advance exactly its declared fixed steps");
    const sequence = result.samplingOrder.length;
    runs.push({ run, orderInRound, sequence, startedAt, endedAt, sampleFrames: costs.length,
      simulationStartSeconds, simulationEndSeconds, p50Ms: percentile(costs, .5), p95Ms: percentile(costs, .95), maxMs: Math.max(...costs) });
    result.samplingOrder.push({ sequence, viewport: viewport.name, scenario, revision, run, orderInRound,
      startedAt, endedAt, simulationStartSeconds, simulationEndSeconds, sampleFrames: costs.length });
  }
  async function finishProfile(item) {
    const { page, context, errors, runs, viewport, scenario, revision, startedAt, warmupSimulationSeconds } = item;
    const final = await page.evaluate(() => { const st = TD.state(); return { towers: st.towers.length, enemies: st.enemies.length,
      particles: st.particles.length, bullets: st.bullets.length, damage: st.enemies.reduce((sum, e) => sum + e.maxHp - e.hp, 0),
      quality: TD.getPerformanceStatus().quality, clock: st.clock, canvasCssWidth: document.getElementById("game").getBoundingClientRect().width,
      engine: TD.debug.engineStats ? TD.debug.engineStats() : null, profileTimings: window.__engineTimings || null }; });
    const diagnostics = await page.evaluate(() => {
      const ctx = document.getElementById("game").getContext("2d"), drawImage = ctx.drawImage;
      const gradients = ctx.createLinearGradient;
      const counts = { drawCalls: 0, filteredDrawCalls: 0, gradients: 0, sourceSizes: {} };
      ctx.drawImage = function (...args) {
        counts.drawCalls++; if (this.filter !== "none") counts.filteredDrawCalls++;
        const source = args[0], key = `${source.width || source.naturalWidth}x${source.height || source.naturalHeight}/${args.length}`;
        counts.sourceSizes[key] = (counts.sourceSizes[key] || 0) + 1;
        return drawImage.apply(this, args);
      };
      ctx.createLinearGradient = function (...args) { counts.gradients++; return gradients.apply(this, args); };
      TD.debug.step(1 / 60);
      ctx.drawImage = drawImage; ctx.createLinearGradient = gradients;
      return counts;
    });
    const profile = { viewport: viewport.name, scenario, revision, runs, warmupSteps: 120, warmupSimulationSeconds,
      startedAt, endedAt: new Date().toISOString(), medianP95Ms: percentile(runs.map((run) => run.p95Ms), .5), final, diagnostics, errors };
    result.profiles.push(profile);
    console.log(`${viewport.name}/${scenario}/${revision}: p95 ${profile.medianP95Ms.toFixed(2)} ms; ${final.particles} particles; damage ${final.damage.toFixed(0)}; errors ${errors.length}`);
    await page.locator("#game").screenshot({ path: path.join(OUT, `${viewport.name}-${scenario}-${revision}.png`) });
    await context.close();
    if (errors.length) throw new Error(errors.join(" | "));
  }
  try {
    const viewports = [{ name: "desktop", width: 1440, height: 780, mobile: false },
      { name: "mobile", width: 390, height: 844, mobile: true }];
    for (const viewport of DIAGNOSTIC ? viewports.slice(0, 1) : viewports) {
      for (const scenario of DIAGNOSTIC ? ["30-towers-80-enemies"] : ["18-enemies", "30-towers-80-enemies"]) {
        if (DIAGNOSTIC) {
          // Keep the historical diagnostic variant order and isolated contexts.
          for (const revision of ["after", "after-no-filter", "after-old-ambient", "after-old-path"]) {
            const item = await prepareProfile(viewport, scenario, revision);
            for (let run = 0; run < RUNS; run++) await sampleProfile(item, run, 0);
            await finishProfile(item);
          }
          continue;
        }
        // Hold both warmed sources. Alternate AB -> BA -> AB, pairing each
        // 120-step segment at the same simulation clock without resetting combat.
        const before = await prepareProfile(viewport, scenario, "before");
        const after = await prepareProfile(viewport, scenario, "after");
        for (let run = 0; run < RUNS; run++) {
          const startClocks = await Promise.all([before.page.evaluate(() => TD.state().clock), after.page.evaluate(() => TD.state().clock)]);
          assert(Math.abs(startClocks[0] - startClocks[1]) < 1e-9, "Paired sources must start at the same simulation clock");
          const order = run % 2 ? [after, before] : [before, after];
          for (let index = 0; index < order.length; index++) await sampleProfile(order[index], run, index);
          const endClocks = await Promise.all([before.page.evaluate(() => TD.state().clock), after.page.evaluate(() => TD.state().clock)]);
          assert(Math.abs(endClocks[0] - endClocks[1]) < 1e-9, "Paired sources must end at the same simulation clock");
        }
        await finishProfile(before);
        await finishProfile(after);
      }
    }
    result.comparisons = result.profiles.filter((p) => p.revision === "after" && result.profiles.some((b) => b.revision === "before" && b.viewport === p.viewport && b.scenario === p.scenario)).map((after) => {
      const before = result.profiles.find((p) => p.viewport === after.viewport && p.scenario === after.scenario && p.revision === "before");
      return { viewport: after.viewport, scenario: after.scenario, beforeP95Ms: before.medianP95Ms, afterP95Ms: after.medianP95Ms,
        changePercent: (after.medianP95Ms / before.medianP95Ms - 1) * 100 };
    });
    if (!DIAGNOSTIC) {
      validateFinalResult(result);
    }
    console.log(JSON.stringify(result.comparisons, null, 2));
  } finally {
    result.endedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, "comparison.json"), JSON.stringify(result, null, 2) + "\n");
    await browser.close(); server.closeAllConnections?.(); server.close();
  }
}
if (process.argv.includes("--validate-only")) {
  const file = path.join(OUT, "comparison.json"), result = JSON.parse(fs.readFileSync(file, "utf8"));
  validateFinalResult(result); fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n"); console.log(result.gate);
} else main().catch((error) => { console.error(error); process.exitCode = 1; });
