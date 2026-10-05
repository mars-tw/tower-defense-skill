#!/usr/bin/env node
"use strict";

// Native Chromium touch delivery through CDP, with the real shipped engine/UI.
// No long performance sampling is done here.
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(ROOT, process.env.TD_R79_ENGINE_EVIDENCE_DIR || "docs/evidence/R79/engine");

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
    const file = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
    const relative = path.relative(ROOT, file);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "application/javascript", ".css": "text/css",
      ".png": "image/png", ".json": "application/json", ".webp": "image/webp", ".webmanifest": "application/manifest+json" })[path.extname(file)] || "application/octet-stream");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch(), results = [];
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => { localStorage.setItem("td_tutorial_seen", "1"); localStorage.setItem("td_audio_muted", "1"); });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.TD && TD.getBuildPlacement);
      await page.locator(".diff-opt").first().click(); await page.locator(".map-opt").first().click();
      await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"));
      const client = await context.newCDPSession(page);
      const send = (type, points) => client.send("Input.dispatchTouchEvent", { type, touchPoints: points });
      const setup = () => page.evaluate(() => {
        TD.newGame(); TD.state().banner = null; TD.selectTower("arrow");
        const cell = TD.config.GAME.cellSize, canvas = document.getElementById("game"), rect = canvas.getBoundingClientRect();
        let pair;
        for (let y = cell * 3.5; y + cell < 640 && !pair; y += cell) for (let x = cell * 5.5; x + cell < 960; x += cell) {
          if (TD.buildPreviewAt(x, y).ok && TD.buildPreviewAt(x + cell, y).ok) { pair = { a: { x, y }, b: { x: x + cell, y } }; break; }
        }
        if (!pair) throw new Error("no adjacent legal placement cells");
        const css = (p) => ({ id: 1, x: rect.left + p.x * rect.width / canvas.width,
          y: rect.top + p.y * rect.height / canvas.height, radiusX: 8, radiusY: 8, force: 1 });
        const ctx = canvas.getContext("2d"), draw = ctx.drawImage;
        if (!window.__r79LoupeProbeInstalled) {
          ctx.drawImage = function (...args) {
            if (args[0] instanceof HTMLCanvasElement && args[0].width === cell * 3 && args[0].height === cell * 3 && args.length === 9)
              window.__r79LoupeRect = { x: args[5], y: args[6], width: args[7], height: args[8] };
            return draw.apply(this, args);
          };
          window.__r79LoupeProbeInstalled = true;
        }
        window.__r79LoupeRect = null;
        return { a: css(pair.a), b: css(pair.b), cell, cellCss: rect.width / canvas.width * cell,
          gold: TD.state().gold, cost: TD.config.TOWERS.arrow.cost,
          targetCell: [Math.floor(pair.b.x / cell), Math.floor(pair.b.y / cell)],
          canvas: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom } };
      });
      const snapshot = () => page.evaluate(() => ({ placement: TD.getBuildPlacement(), gold: TD.state().gold,
        towers: TD.state().towers.map((t) => ({ type: t.type, cx: t.cx, cy: t.cy })), lens: window.__r79LoupeRect,
        confirmDisabled: document.getElementById("confirmBuildBtn") ? document.getElementById("confirmBuildBtn").disabled : null }));
      const points = await setup();
      assert(points.canvas.x >= 0 && points.canvas.y >= 0 && points.canvas.right <= viewport.width + 1 && points.canvas.bottom <= viewport.height + 1);
      await send("touchStart", [points.a]); await send("touchEnd", []);
      await page.waitForTimeout(60);
      const armed = await snapshot(); assert(armed.placement.requiresConfirmation); assert.equal(armed.towers.length, 0);
      await page.mouse.click(points.a.x, points.a.y);
      assert.equal((await snapshot()).towers.length, 0, "synthetic click after a preview must not pay");
      // A small adjustment remains in the same armed cell. Releasing the drag
      // must not be mistaken for the confirming second tap.
      await send("touchStart", [points.a]);
      await send("touchMove", [{ ...points.a, x: points.a.x + 8 }]); await send("touchEnd", []);
      assert.equal((await snapshot()).towers.length, 0, "same-cell drag release must not confirm");
      await send("touchStart", [points.a]);
      const corrected = { ...points.a, x: points.a.x + points.cellCss * 2 };
      await send("touchMove", [corrected]); await page.waitForTimeout(80);
      const dragging = await snapshot();
      assert(dragging.placement.active && dragging.placement.dragging);
      assert(dragging.lens && dragging.lens.x >= 0 && dragging.lens.y >= 0 &&
        dragging.lens.x + dragging.lens.width <= 960 && dragging.lens.y + dragging.lens.height <= 640, "loupe stays inside the battlefield");
      assert.equal(await page.evaluate(() => TD.confirmBuildPreview()), false, "cannot confirm an active finger");
      await page.screenshot({ path: path.join(OUT, `${viewport.width}x${viewport.height}-dragging.png`) });
      await send("touchEnd", []);
      const released = await snapshot();
      assert(released.placement.requiresConfirmation && !released.placement.active); assert.equal(released.gold, points.gold);
      assert.equal(released.towers.length, 0); assert.equal(released.placement.preview.cx, points.targetCell[0]);
      assert.equal(released.placement.preview.cy, points.targetCell[1]);
      await page.screenshot({ path: path.join(OUT, `${viewport.width}x${viewport.height}-armed.png`) });
      await send("touchStart", [points.b]); await send("touchEnd", []);
      const confirmed = await snapshot();
      assert.equal(confirmed.towers.length, 1); assert.equal(confirmed.gold, points.gold - points.cost);
      assert.deepEqual([confirmed.towers[0].cx, confirmed.towers[0].cy], points.targetCell);
      assert.equal(await page.evaluate(() => TD.confirmBuildPreview()), false);
      const cancelPoints = await setup();
      await send("touchStart", [cancelPoints.a]); await send("touchMove", [{ ...cancelPoints.a, x: cancelPoints.a.x + 12 }]);
      await send("touchCancel", []);
      assert.equal((await snapshot()).placement, null);
      await send("touchStart", [cancelPoints.a]);
      await send("touchStart", [cancelPoints.a, { ...cancelPoints.a, id: 2, x: cancelPoints.a.x + 30 }]);
      await send("touchEnd", []);
      const cancelled = await snapshot(); assert.equal(cancelled.placement, null); assert.equal(cancelled.towers.length, 0);
      assert.equal(cancelled.gold, cancelPoints.gold);
      let rotated = null;
      if (viewport.width === 390) {
        const rotationPoints = await setup();
        await send("touchStart", [rotationPoints.a]);
        await send("touchMove", [{ ...rotationPoints.a, x: rotationPoints.a.x + rotationPoints.cellCss * 2 }]);
        await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(100);
        await send("touchEnd", []);
        rotated = await snapshot();
        assert.equal(rotated.placement, null, "rotating during a held finger must disarm preview and candidate");
        assert.equal(rotated.towers.length, 0); assert.equal(rotated.gold, rotationPoints.gold);
        assert.equal(await page.evaluate(() => TD.confirmBuildPreview()), false);
        await page.setViewportSize(viewport);
      }
      assert.equal(errors.length, 0);
      results.push({ viewport, points, armed, dragging, released, confirmed, cancelled, rotated, errors });
      console.log(`PASS ${viewport.width}x${viewport.height}: ${points.cellCss.toFixed(2)} px cells; loupe inside; drag never pays; confirmation once; cancel/multi-touch safe`);
      await context.close();
    }
  } finally {
    fs.writeFileSync(path.join(OUT, "native-touch-evidence.json"), JSON.stringify(results, null, 2) + "\n");
    await browser.close(); server.closeAllConnections?.(); server.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
