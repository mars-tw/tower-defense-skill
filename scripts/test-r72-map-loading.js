/* td R72 map-selection/loading visual, governance, contrast, crop and performance gate. */
const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = process.env.TD_EVIDENCE_DIR
  ? path.resolve(ROOT, process.env.TD_EVIDENCE_DIR)
  : path.join(ROOT, "docs", "evidence", "R72");
const MANIFEST_PATH = path.join(ROOT, "assets", "maps", "r72", "manifest.json");
const EXPECTED_MAPS = ["plains", "canyon", "lava"];
const PATH_TILE_SHA256 = "aa1c795edda2a159ed32649528693f3bad57c2f74c87378b6dd7c4a58742c4f7";
const MIME = {
  ".html": "text/html", ".js": "application/javascript", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".png": "image/png", ".webp": "image/webp", ".css": "text/css",
};
const VIEWPORTS = [
  { name: "desktop-1366x768", w: 1366, h: 768, quality: "high", maps: EXPECTED_MAPS },
  { name: "mobile-390x844", w: 390, h: 844, quality: "med", touch: true, maps: ["plains"] },
  { name: "landscape-844x390", w: 844, h: 390, quality: "med", touch: true, maps: ["plains"] },
];
const PERF_TARGETS = [
  { name: "desktop", w: 1366, h: 768, touch: false, interactiveLimit: 5971.8 },
  { name: "mobile", w: 390, h: 844, touch: true, interactiveLimit: 5371.6 },
];

async function closeBrowserWithin(browser, timeoutMs = 8000) {
  const outcome = await Promise.race([
    browser.close().then(() => "closed").catch((error) => `error: ${error.message}`),
    new Promise((resolve) => setTimeout(() => resolve("timeout"), timeoutMs)),
  ]);
  console.log(`R72 browser close: ${outcome}`);
}

async function writeCanvasPng(page, outputPath) {
  const dataUrl = await page.locator("#game").evaluate((canvas) => canvas.toDataURL("image/png"));
  fs.writeFileSync(outputPath, Buffer.from(dataUrl.split(",")[1], "base64"));
}

let failed = 0;
function assert(condition, message) {
  if (condition) console.log("  PASS " + message);
  else { failed++; console.error("  FAIL " + message); }
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

async function waitForMemory() {
  const threshold = 2 * 1024 * 1024 * 1024;
  for (let attempt = 1; attempt <= 10; attempt++) {
    const free = os.freemem();
    console.log(`R72 browser memory preflight ${attempt}/10: ${(free / 1024 / 1024).toFixed(0)} MiB free`);
    if (free >= threshold) return;
    if (attempt < 10) await new Promise((resolve) => setTimeout(resolve, 60000));
  }
  throw new Error("R72 browser preflight still has <2 GiB free after 10 retries");
}

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const pathname = decodeURIComponent(new URL(req.url, "http://local").pathname);
      const filePath = path.resolve(ROOT, "." + (pathname === "/" ? "/index.html" : pathname));
      const relative = path.relative(ROOT, filePath);
      if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function staticGovernance() {
  console.log("\n== R72 source/runtime governance ==");
  const manifest = readJson(MANIFEST_PATH);
  const c2paSummary = readJson(path.join(ROOT, "docs", "evidence", "R72", "c2pa", "summary.json"));
  const uiSource = fs.readFileSync(path.join(ROOT, "src", "ui.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const swSource = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
  const packageInfo = readJson(path.join(ROOT, "package.json"));
  assert(manifest.model_slug === "gpt-image-2" && manifest.generation_interface === "Codex built-in imagegen",
    "manifest records built-in imagegen and gpt-image-2");
  assert(JSON.stringify(manifest.maps) === JSON.stringify(EXPECTED_MAPS),
    "manifest scope remains exactly the existing plains/canyon/lava maps");
  assert(manifest.runtime_assets.length === 18, "three maps expose banner/loading low/med/high (18 runtime assets)");
  assert(manifest.decoded_rgba_mib_all_variants <= 32,
    `all runtime variants decode to ${manifest.decoded_rgba_mib_all_variants} MiB <= mobile 32 MiB (desktop <=64 MiB)`);
  assert(sha256(path.join(ROOT, "assets", "tiles", "path.png")) === PATH_TILE_SHA256,
    "gameplay path tile hash is unchanged by R72 imagegen backgrounds");
  assert(packageInfo.version === "0.7.2" && packageInfo.pwaVersion === "td-r72-v1" &&
    indexSource.includes("td-r72-v1") && swSource.includes('CACHE_VERSION = "td-r72-v1"'),
  "package, HTML and service worker expose the R72 version/cache bump");
  for (const mapId of EXPECTED_MAPS) {
    const item = c2paSummary[mapId];
    assert(item && item.software_agent_is_gpt_image_2_x && item.claim_signature_validated && item.data_hash_valid,
      `${mapId} master C2PA is gpt-image 2.x with valid claim signature/data hash`);
  }
  for (const asset of manifest.runtime_assets) {
    const filePath = path.join(ROOT, asset.path);
    const hash = fs.existsSync(filePath) ? sha256(filePath) : "missing";
    assert(hash === asset.sha256, `${asset.path} hash matches manifest`);
    assert(uiSource.includes(`${asset.path}?v=${asset.sha256.slice(0, 8)}`), `${asset.variant}/${asset.map_id} runtime reference has hash query`);
    assert(swSource.includes(`./${asset.path}?v=${asset.sha256.slice(0, 8)}`), `${asset.variant}/${asset.map_id} is in the PWA offline list with its hash query`);
  }
  return manifest;
}

async function openSelector(page, base) {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.TD && window.__tdR72MapVisual && document.querySelectorAll(".diff-opt").length === 3,
    null, { timeout: 60000 });
  await page.locator(".diff-opt").first().click({ noWaitAfter: true, timeout: 90000 });
  await page.waitForFunction(() => document.getElementById("mapOverlay").classList.contains("show") &&
    document.getElementById("mapOptions").dataset.r72VisualReady === "true", null, { timeout: 15000 });
}

function auditSelectorInPage(expectedQuality) {
  function focalFits(image, holder, normalized, fit) {
    const ir = image.getBoundingClientRect(), hr = holder.getBoundingClientRect();
    const scale = fit === "contain"
      ? Math.min(ir.width / image.naturalWidth, ir.height / image.naturalHeight)
      : Math.max(ir.width / image.naturalWidth, ir.height / image.naturalHeight);
    const renderedWidth = image.naturalWidth * scale, renderedHeight = image.naturalHeight * scale;
    const offsetX = (ir.width - renderedWidth) / 2, offsetY = (ir.height - renderedHeight) / 2;
    const focal = {
      left: offsetX + normalized[0] * renderedWidth,
      top: offsetY + normalized[1] * renderedHeight,
      right: offsetX + (normalized[0] + normalized[2]) * renderedWidth,
      bottom: offsetY + (normalized[1] + normalized[3]) * renderedHeight,
    };
    return { focal, holder: { width: hr.width, height: hr.height }, complete:
      focal.left >= -1 && focal.top >= -1 && focal.right <= hr.width + 1 && focal.bottom <= hr.height + 1 };
  }
  const options = [...document.querySelectorAll(".map-opt")].map((button) => {
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const image = button.querySelector("img");
    const holder = button.querySelector(".map-visual");
    return {
      mapId: button.dataset.mapId,
      quality: image.dataset.quality,
      natural: { width: image.naturalWidth, height: image.naturalHeight },
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
      inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1,
      hit: hit === button || button.contains(hit),
      focal: focalFits(image, holder, [0.10, 0.27, 0.80, 0.46], getComputedStyle(image).objectFit),
    };
  });
  return {
    expectedQuality,
    options,
    pageScroll: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  };
}

function auditLoadingInPage() {
  function parseColor(value) {
    const parts = (value.match(/[\d.]+/g) || []).map(Number);
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  }
  function linear(value) {
    value /= 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  }
  function luminance(rgb) { return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]); }
  function contrast(a, b) { return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); }
  const overlay = document.getElementById("mapLoadingOverlay");
  const image = document.getElementById("mapLoadingImage");
  const panel = document.getElementById("mapLoadingPanel");
  const modalIds = ["tutorial", "diffOverlay", "mapOverlay", "mapLoadingOverlay", "settingsOverlay"];
  const shown = modalIds.filter((id) => document.getElementById(id).classList.contains("show"));
  const shell = document.getElementById("appShell");
  const background = [document.getElementById("startBtn"), ...document.querySelectorAll("#towerList .tower-btn")].map((el) => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { id: el.id || el.dataset.type, selfHit: hit === el || el.contains(hit) };
  });

  const source = document.createElement("canvas");
  source.width = image.naturalWidth; source.height = image.naturalHeight;
  const sourceCtx = source.getContext("2d", { willReadFrequently: true });
  sourceCtx.drawImage(image, 0, 0);
  const data = sourceCtx.getImageData(0, 0, source.width, source.height).data;
  const panelColor = parseColor(getComputedStyle(panel).backgroundColor);
  const backgrounds = [];
  const stepX = Math.max(1, Math.floor(source.width / 32)), stepY = Math.max(1, Math.floor(source.height / 18));
  for (let y = 0; y < source.height; y += stepY) {
    for (let x = 0; x < source.width; x += stepX) {
      const index = (y * source.width + x) * 4;
      const under = [data[index], data[index + 1], data[index + 2]];
      backgrounds.push(panelColor.rgb.map((channel, i) => channel * panelColor.alpha + under[i] * (1 - panelColor.alpha)));
    }
  }
  const text = ["mapLoadingTitle", "mapLoadingDesc", "mapLoadingStatus"].map((id) => {
    const el = document.getElementById(id), textColor = parseColor(getComputedStyle(el).color);
    const textLum = luminance(textColor.rgb);
    const ratios = backgrounds.map((bg) => contrast(textLum, luminance(bg)));
    return { id, color: textColor.rgb, minimumContrast: Math.min(...ratios) };
  });

  const ir = image.getBoundingClientRect();
  const fit = getComputedStyle(image).objectFit;
  const scale = fit === "contain"
    ? Math.min(ir.width / image.naturalWidth, ir.height / image.naturalHeight)
    : Math.max(ir.width / image.naturalWidth, ir.height / image.naturalHeight);
  const renderedWidth = image.naturalWidth * scale, renderedHeight = image.naturalHeight * scale;
  const offsetX = (ir.width - renderedWidth) / 2, offsetY = (ir.height - renderedHeight) / 2;
  const focal = {
    left: offsetX + renderedWidth * 0.10, top: offsetY + renderedHeight * 0.27,
    right: offsetX + renderedWidth * 0.90, bottom: offsetY + renderedHeight * 0.73,
  };
  return {
    shown, shellInert: shell.inert, shellHidden: shell.getAttribute("aria-hidden") === "true", background,
    mapId: overlay.dataset.mapId, quality: overlay.dataset.quality, visualReady: overlay.dataset.r72VisualReady,
    source: image.currentSrc, natural: { width: image.naturalWidth, height: image.naturalHeight },
    textContrast: text,
    focal: { fit, ...focal, viewport: { width: ir.width, height: ir.height }, complete:
      focal.left >= -1 && focal.top >= -1 && focal.right <= ir.width + 1 && focal.bottom <= ir.height + 1 },
  };
}

function pathContrastInPage(mapId) {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const route = window.TD.config.MAPS[mapId].path;
  function linear(value) { value /= 255; return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4); }
  function luminance(x, y) {
    x = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
    y = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
    const index = (y * canvas.width + x) * 4;
    return 0.2126 * linear(pixels[index]) + 0.7152 * linear(pixels[index + 1]) + 0.0722 * linear(pixels[index + 2]);
  }
  function segmentDistance(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, denominator = dx * dx + dy * dy;
    if (!denominator) return Math.hypot(px - a.x, py - a.y);
    const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / denominator));
    return Math.hypot(px - a.x - t * dx, py - a.y - t * dy);
  }
  function distanceToPath(x, y) {
    let best = Infinity;
    for (let index = 0; index < route.length - 1; index++) best = Math.min(best, segmentDistance(x, y, route[index], route[index + 1]));
    return best;
  }
  const band = [], ground = [];
  for (let y = 4; y < canvas.height; y += 8) {
    for (let x = 4; x < canvas.width; x += 8) {
      const distance = distanceToPath(x, y);
      if (distance <= 16) band.push(luminance(x, y));
      else if (distance >= 62 && distance <= 92) ground.push(luminance(x, y));
    }
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const pathLuminance = mean(band), groundLuminance = mean(ground);
  const ratio = (Math.max(pathLuminance, groundLuminance) + 0.05) / (Math.min(pathLuminance, groundLuminance) + 0.05);
  return { mapId, pathSamples: band.length, groundSamples: ground.length,
    pathLuminance, groundLuminance, contrastRatio: ratio };
}

async function runViewport(browser, base, viewport, measurements) {
  console.log(`\n== R72 viewport ${viewport.name} ==`);
  const context = await browser.newContext({
    viewport: { width: viewport.w, height: viewport.h }, hasTouch: !!viewport.touch, isMobile: !!viewport.touch,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.clear(); localStorage.setItem("td_tutorial_seen", "1"); localStorage.setItem("td_perf_mode", "high");
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let selectorAudit;
  const loadingAudits = [];
  for (let index = 0; index < viewport.maps.length; index++) {
    const mapId = viewport.maps[index];
    await openSelector(page, base);
    if (index === 0) {
      selectorAudit = await page.evaluate(auditSelectorInPage, viewport.quality);
      assert(selectorAudit.options.length === 3 && selectorAudit.options.map((item) => item.mapId).join(",") === EXPECTED_MAPS.join(","),
        `${viewport.name} selector exposes exactly the existing three maps`);
      assert(selectorAudit.options.every((item) => item.quality === viewport.quality && item.natural.width > 0 && item.natural.height > 0),
        `${viewport.name} selector loads real ${viewport.quality} banner assets`);
      assert(selectorAudit.options.every((item) => item.inViewport && item.hit && item.focal.complete),
        `${viewport.name} map cards are reachable and focal bboxes stay inside safe crops`);
      assert(selectorAudit.overflowX <= 2, `${viewport.name} selector has no horizontal overflow`);
      await page.screenshot({ path: path.join(EVIDENCE, `after-map-selector-${viewport.name}.png`), fullPage: true });
    }
    await page.locator(`.map-opt[data-map-id="${mapId}"]`).click({ noWaitAfter: true, timeout: 90000 });
    await page.waitForFunction(() => document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 5000 });
    const interlock = await page.evaluate(() => {
      const ids = ["tutorial", "diffOverlay", "mapOverlay", "mapLoadingOverlay", "settingsOverlay"];
      const shell = document.getElementById("appShell");
      return { shown: ids.filter((id) => document.getElementById(id).classList.contains("show")), inert: shell.inert,
        hidden: shell.getAttribute("aria-hidden") === "true" };
    });
    assert(interlock.shown.length === 1 && interlock.shown[0] === "mapLoadingOverlay" && interlock.inert && interlock.hidden,
      `${viewport.name}/${mapId} loading is the sole R71 blocking modal and app shell is inert`);
    await page.waitForFunction(() => document.getElementById("mapLoadingOverlay").dataset.r72VisualReady === "true", null, { timeout: 3000 });
    const audit = await page.evaluate(auditLoadingInPage);
    loadingAudits.push(audit);
    assert(audit.quality === viewport.quality && audit.natural.width > 0 && audit.natural.height > 0,
      `${viewport.name}/${mapId} loading uses real ${viewport.quality} image`);
    assert(audit.shown.length === 1 && audit.shellInert && audit.background.every((item) => !item.selfHit),
      `${viewport.name}/${mapId} loading blocks background controls`);
    assert(audit.textContrast.every((item) => item.minimumContrast >= 4.5),
      `${viewport.name}/${mapId} loading text contrast is >=4.5:1`);
    assert(audit.focal.complete, `${viewport.name}/${mapId} loading focal bbox stays inside viewport (${audit.focal.fit})`);
    if (viewport.name === "desktop-1366x768") {
      await page.screenshot({ path: path.join(EVIDENCE, `after-loading-${mapId}-desktop.png`) });
    }
    await page.waitForFunction(() => !document.getElementById("mapLoadingOverlay").classList.contains("show"), null, { timeout: 5000 });
  }

  const pathResults = [];
  if (viewport.name === "desktop-1366x768") {
    for (const mapId of EXPECTED_MAPS) {
      await page.evaluate((id) => {
        window.TD.setMap(id); window.TD.newGame({ runSeed: 4242 }); window.TD.state().banner = null;
      }, mapId);
      await page.waitForTimeout(1500);
      const result = await page.evaluate(pathContrastInPage, mapId);
      pathResults.push(result);
      assert(result.contrastRatio >= 1.25, `${mapId} gameplay path-band contrast ${result.contrastRatio.toFixed(3)} >=1.25`);
      await writeCanvasPng(page, path.join(EVIDENCE, `after-game-${mapId}.png`));
    }
  }
  assert(errors.length === 0, `${viewport.name} has no pageerror${errors.length ? " - " + errors.join(" | ") : ""}`);
  measurements.viewports.push({ viewport: viewport.name, selector: selectorAudit, loading: loadingAudits, pathContrast: pathResults, errors });
  await context.close();
}

async function imageStats(page, url) {
  return page.evaluate(async (source) => {
    const image = new Image(); image.crossOrigin = "anonymous"; image.src = source; await image.decode();
    const canvas = document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(image, 0, 0, 160, 90);
    const data = ctx.getImageData(0, 0, 160, 90).data;
    const sums = [0, 0, 0], squares = [0, 0, 0], count = 160 * 90;
    for (let index = 0; index < data.length; index += 4) {
      for (let channel = 0; channel < 3; channel++) { const value = data[index + channel] / 255; sums[channel] += value; squares[channel] += value * value; }
    }
    const mean = sums.map((value) => value / count);
    const variance = squares.map((value, channel) => value / count - mean[channel] * mean[channel]);
    return { natural: { width: image.naturalWidth, height: image.naturalHeight }, mean, variance, source: image.src };
  }, url);
}

async function runQualityEvidence(browser, base, manifest, measurements) {
  console.log("\n== R72 low/med/high lineage ==");
  const context = await browser.newContext({ viewport: { width: 1080, height: 420 } });
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
  const variants = ["low", "med", "high"];
  const records = [];
  for (const quality of variants) {
    const asset = manifest.runtime_assets.find((item) => item.map_id === "plains" && item.variant === `loading-${quality}`);
    records.push({ quality, asset, stats: await imageStats(page, `${base.replace(/\/index\.html$/, "")}/${asset.path}?v=${asset.sha256.slice(0, 8)}`) });
  }
  assert(records.every((record) => Math.max(...record.stats.variance) > 0.01), "low/med/high are non-solid true image assets");
  assert(new Set(records.map((record) => record.asset.sha256)).size === 3, "low/med/high runtime hashes are distinct");
  const meanSpread = Math.max(...records.flatMap((record) => record.stats.mean)) - Math.min(...records.flatMap((record) => record.stats.mean));
  assert(meanSpread < 0.24, `low/med/high retain one visual language (RGB mean spread ${meanSpread.toFixed(3)} <0.24)`);
  await page.setContent(`<!doctype html><style>body{margin:0;background:#06100b;color:#f2e4be;font:700 16px Segoe UI;display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:18px}figure{margin:0;border:1px solid #d8a34a;padding:8px}img{display:block;width:100%;aspect-ratio:16/9;object-fit:cover}figcaption{padding-top:7px;text-align:center}</style>${records.map((record) => `<figure><img src="${record.stats.source}"><figcaption>${record.quality.toUpperCase()} · ${record.stats.natural.width}×${record.stats.natural.height}</figcaption></figure>`).join("")}`);
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  await page.screenshot({ path: path.join(EVIDENCE, "quality-tiers-plains.png"), timeout: 90000 });
  measurements.quality = { records, meanSpread };
  await context.close();
}

async function applyThrottle(page) {
  const client = await page.context().newCDPSession(page);
  await client.send("Network.enable");
  await client.send("Network.emulateNetworkConditions", {
    offline: false, latency: 150, downloadThroughput: 200000, uploadThroughput: 93750, connectionType: "cellular3g",
  });
  await client.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

async function runPerformance(browser, base, target, measurements) {
  console.log(`\n== R72 Fast 3G/4x ${target.name} ==`);
  const context = await browser.newContext({ viewport: { width: target.w, height: target.h }, hasTouch: target.touch, isMobile: target.touch });
  const page = await context.newPage();
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem("td_tutorial_seen", "1"); localStorage.setItem("td_perf_mode", "low"); });
  await applyThrottle(page);
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => window.TD && document.querySelectorAll(".diff-opt").length === 3, null, { timeout: 60000 });
  const constrainedQuality = await page.evaluate(() => window.__tdR72MapVisual.qualityTier());
  assert(constrainedQuality === "low", `${target.name} Fast 3G/4x run selects a true low image tier`);
  const interactiveMs = await page.evaluate(() => performance.now());
  assert(interactiveMs <= target.interactiveLimit,
    `${target.name} first interaction ${interactiveMs.toFixed(1)}ms <= before+10% ${target.interactiveLimit.toFixed(1)}ms`);
  await page.locator(".diff-opt").first().click({ noWaitAfter: true, timeout: 90000 });
  await page.waitForFunction(() => document.getElementById("mapOptions").dataset.r72VisualReady === "true", null, { timeout: 15000 });
  assert(await page.locator(".map-visual img").evaluateAll((images) => images.every((image) => image.dataset.quality === "low" && image.naturalWidth > 0)),
    `${target.name} constrained selector decodes real low banner images`);
  const selectorVisualMs = await page.evaluate(() => (performance.getEntriesByName("r72-map-visual-duration").slice(-1)[0] || {}).duration);
  assert(selectorVisualMs <= 3000, `${target.name} selector main visual mark ${selectorVisualMs.toFixed(1)}ms <=3000ms`);
  await page.locator(".map-opt").first().click({ noWaitAfter: true, timeout: 90000 });
  await page.waitForFunction(() => document.getElementById("mapLoadingOverlay").dataset.r72VisualReady === "true", null, { timeout: 3000 });
  assert(await page.locator("#mapLoadingImage").evaluate((image) => image.dataset.quality === "low" && image.naturalWidth > 0),
    `${target.name} constrained loading decodes a real low image`);
  const loadingVisualMs = await page.evaluate(() => (performance.getEntriesByName("r72-loading-visual-duration").slice(-1)[0] || {}).duration);
  assert(loadingVisualMs <= 3000, `${target.name} loading main visual mark ${loadingVisualMs.toFixed(1)}ms <=3000ms`);
  measurements.performance.push({ target: target.name, concurrentUntrusted: true, interactiveMs, interactiveLimitMs: target.interactiveLimit,
    selectorVisualMs, loadingVisualMs, quality: constrainedQuality,
    throttle: { network: "Fast 3G", latencyMs: 150, cpuRate: 4 } });
  await context.close();
}

async function run() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const manifest = staticGovernance();
  await waitForMemory();
  const { chromium } = require("playwright");
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const browser = await chromium.launch();
  const measurements = { generatedAt: new Date().toISOString(), viewports: [], quality: null, performance: [] };
  try {
    for (const viewport of VIEWPORTS) await runViewport(browser, base, viewport, measurements);
    await runQualityEvidence(browser, base, manifest, measurements);
    for (const target of PERF_TARGETS) await runPerformance(browser, base, target, measurements);
  } finally {
    fs.writeFileSync(path.join(EVIDENCE, "r72-map-loading-measurements.json"), JSON.stringify(measurements, null, 2) + "\n");
    server.close();
    await closeBrowserWithin(browser);
  }
  if (failed) { console.error(`\nR72 map/loading gate failed: ${failed}`); process.exit(1); }
  console.log("\nR72 map/loading gate passed.");
}

run().catch((error) => { console.error(error); process.exit(1); });
