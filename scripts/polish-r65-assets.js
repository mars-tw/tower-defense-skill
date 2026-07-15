/* td R65 asset polish pipeline.
 * Uses Playwright + Canvas 2D so the output is deterministic and rerunnable.
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "evidence", "R65_polish");

const TOWERS = ["arrow", "cannon", "frost", "tesla", "poison", "support", "sniper", "arcane", "beacon", "mortar"];
const TILES = ["grass1", "grass2", "grass3", "path", "rock", "bush", "tree"];
const SKILLS = ["meteor", "freeze", "thunder", "judgment", "sealarray"];

const TARGETS = [
  ...TILES.map((id) => ({ group: "tiles", id, file: `assets/tiles/${id}.png`, kind: ["grass1", "grass2", "grass3", "path"].includes(id) ? "tile" : "decor" })),
  ...TOWERS.map((id) => ({ group: "towers", id, file: `assets/towers/${id}.png`, kind: "tower" })),
  ...SKILLS.map((id) => ({ group: "skills", id, file: `assets/skills/${id}.png`, kind: "skill" })),
];

const RIM = {
  arrow: "#ddb472", cannon: "#fb923c", frost: "#7dd3fc", tesla: "#fde68a", poison: "#86efac",
  support: "#fff7ad", sniper: "#cbd5e1", arcane: "#e9d5ff", beacon: "#fecdd3", mortar: "#fed7aa",
  meteor: "#fed7aa", freeze: "#d9fafe", thunder: "#fff7ad", judgment: "#fff7ad", sealarray: "#e9d5ff",
  rock: "#cbd5e1", bush: "#86efac", tree: "#9db66a",
};

function readDataUrl(rel) {
  let data;
  try {
    data = execFileSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });
  } catch {
    const fp = path.join(ROOT, rel);
    data = fs.readFileSync(fp);
  }
  return `data:image/png;base64,${data.toString("base64")}`;
}

function writeDataUrl(rel, dataUrl) {
  const fp = path.join(ROOT, rel);
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(fp, Buffer.from(b64, "base64"));
}

function writeEvidence(name, dataUrl) {
  const fp = path.join(OUT_DIR, name);
  const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(fp, Buffer.from(b64, "base64"));
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const before = Object.fromEntries(TARGETS.map((t) => [t.file, readDataUrl(t.file)]));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.setContent("<!doctype html><html><body></body></html>");
  const after = {};
  const metrics = [];

  try {
    for (const target of TARGETS) {
      const result = await page.evaluate(async ({ target, src, rim }) => {
        const PALETTE = [
          "#07120d", "#0d1b16", "#14231e", "#172a1e", "#204229", "#2f6f38", "#5d8d45", "#9db66a",
          "#2b1d25", "#3d2b24", "#61412d", "#896040", "#b9824e", "#ddb472",
          "#1f2433", "#30364a", "#46556e", "#64748b", "#94a3b8", "#cbd5e1", "#f1f5f9",
          "#5b3627", "#8a5434", "#c0844d", "#f0b36a",
          "#2b314a", "#1e5b78", "#38bdf8", "#7dd3fc", "#d9fafe",
          "#3b255e", "#7c3aed", "#a855f7", "#e9d5ff",
          "#3b2612", "#a16207", "#facc15", "#fde68a", "#fff7ad",
          "#431407", "#b45309", "#f97316", "#fb923c", "#fed7aa",
          "#3a1023", "#9f1239", "#fb7185", "#fecdd3",
          "#11402d", "#16a34a", "#22c55e", "#86efac",
          "#111827", "#182033", "#241703", "#2a2130"
        ];
        const RGB = PALETTE.map((hex) => {
          const n = parseInt(hex.slice(1), 16);
          return { hex, r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
        });
        const BAYER = [
          [0, 8, 2, 10],
          [12, 4, 14, 6],
          [3, 11, 1, 9],
          [15, 7, 13, 5],
        ];
        const MATERIAL = {
          grass1: ["#172a1e", "#204229", "#2f6f38", "#5d8d45", "#9db66a"],
          grass2: ["#172a1e", "#204229", "#2f6f38", "#5d8d45", "#9db66a", "#fecdd3", "#fde68a"],
          grass3: ["#0d1b16", "#172a1e", "#204229", "#3d2b24", "#61412d", "#896040", "#5d8d45"],
          path: ["#2a2130", "#3d2b24", "#61412d", "#896040", "#b9824e", "#ddb472"],
        };

        function loadImage(url) {
          return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
          });
        }
        function clamp(v, min = 0, max = 255) { return Math.max(min, Math.min(max, v)); }
        function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
        function dist(a, r, g, b) {
          const dl = (lum(a.r, a.g, a.b) - lum(r, g, b)) * 1.15;
          const dr = a.r - r, dg = a.g - g, db = a.b - b;
          return dr * dr + dg * dg + db * db + dl * dl;
        }
        function nearest(r, g, b, palette = RGB) {
          let best = palette[0], bestD = Infinity;
          for (const c of palette) {
            const d = dist(c, r, g, b);
            if (d < bestD) { bestD = d; best = c; }
          }
          return best;
        }
        function hash(x, y, seed) {
          let n = (x * 374761393 + y * 668265263 + seed * 1442695041) >>> 0;
          n = (n ^ (n >> 13)) >>> 0;
          n = Math.imul(n, 1274126177) >>> 0;
          return ((n ^ (n >> 16)) >>> 0) / 4294967295;
        }
        function periodicNoise(x, y, seed) {
          const a = hash(x & 63, y & 63, seed);
          const b = hash((x >> 2) & 31, (y >> 2) & 31, seed + 19);
          const c = hash((x >> 4) & 15, (y >> 4) & 15, seed + 71);
          return a * 0.34 + b * 0.36 + c * 0.30;
        }
        function setPx(data, w, x, y, hex, a = 255) {
          if (x < 0 || y < 0 || x >= w || y >= data.height) return;
          const n = parseInt(hex.slice(1), 16);
          const i = (y * w + x) * 4;
          data.data[i] = (n >> 16) & 255;
          data.data[i + 1] = (n >> 8) & 255;
          data.data[i + 2] = n & 255;
          data.data[i + 3] = a;
        }
        function upscale(work, outW, outH) {
          const out = document.createElement("canvas");
          out.width = outW; out.height = outH;
          const ox = out.getContext("2d");
          ox.imageSmoothingEnabled = false;
          ox.clearRect(0, 0, outW, outH);
          ox.drawImage(work, 0, 0, outW, outH);
          return out;
        }
        function removeFloodBackground(imageData, w, h) {
          const p = imageData.data;
          const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
          let br = 0, bg = 0, bb = 0, ba = 0;
          for (const [x, y] of corners) {
            const i = (y * w + x) * 4;
            br += p[i]; bg += p[i + 1]; bb += p[i + 2]; ba += p[i + 3];
          }
          br /= 4; bg /= 4; bb /= 4; ba /= 4;
          const visited = new Uint8Array(w * h);
          const qx = [], qy = [];
          function similar(x, y) {
            const i = (y * w + x) * 4;
            if (p[i + 3] < 12) return true;
            const d = Math.abs(p[i] - br) + Math.abs(p[i + 1] - bg) + Math.abs(p[i + 2] - bb);
            const dark = p[i] + p[i + 1] + p[i + 2] < 92;
            return dark && d < 86 && ba > 120;
          }
          function push(x, y) {
            const k = y * w + x;
            if (!visited[k] && similar(x, y)) {
              visited[k] = 1; qx.push(x); qy.push(y);
            }
          }
          for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
          for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
          for (let qi = 0; qi < qx.length; qi++) {
            const x = qx[qi], y = qy[qi];
            if (x > 0) push(x - 1, y);
            if (x < w - 1) push(x + 1, y);
            if (y > 0) push(x, y - 1);
            if (y < h - 1) push(x, y + 1);
          }
          for (let k = 0; k < visited.length; k++) {
            if (visited[k]) p[k * 4 + 3] = 0;
          }
        }
        function alphaAt(p, w, h, x, y) {
          if (x < 0 || y < 0 || x >= w || y >= h) return 0;
          return p[(y * w + x) * 4 + 3];
        }
        function maskAt(mask, w, h, x, y) {
          if (x < 0 || y < 0 || x >= w || y >= h) return 0;
          return mask[y * w + x];
        }
        function processSource(img, spec) {
          const w = 256, h = 256;
          const work = document.createElement("canvas");
          work.width = w; work.height = h;
          const cx = work.getContext("2d");
          cx.imageSmoothingEnabled = true;
          cx.clearRect(0, 0, w, h);
          cx.drawImage(img, 0, 0, w, h);
          const imageData = cx.getImageData(0, 0, w, h);
          const p = imageData.data;
          if (spec.transparent) removeFloodBackground(imageData, w, h);
          const baseAlpha = new Uint8ClampedArray(w * h);
          for (let i = 0; i < baseAlpha.length; i++) baseAlpha[i] = p[i * 4 + 3];

          const out = new ImageData(w, h);
          const op = out.data;
          const seed = spec.seed;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const a = p[i + 3];
              if (a < 12) continue;
              let r = p[i], g = p[i + 1], b = p[i + 2];
              const l = lum(r, g, b) / 255;
              const cold = Math.pow(1 - l, 1.35);
              const warm = Math.pow(l, 1.55);
              const ordered = (BAYER[y & 3][x & 3] - 7.5) * (spec.dither || 1.0);
              r = clamp((r - 128) * 1.09 + 128 + warm * 15 - cold * 10 + ordered);
              g = clamp((g - 128) * 1.06 + 128 + warm * 7 - cold * 5 + ordered * 0.45);
              b = clamp((b - 128) * 1.10 + 128 - warm * 10 + cold * 18 - ordered * 0.35);
              if (spec.kind === "tower" && y > h * 0.43 && hash(x >> 2, y >> 2, seed) > 0.82) {
                r = clamp(r - 20); g = clamp(g - 17); b = clamp(b + 10);
              }
              const q = nearest(r, g, b);
              op[i] = q.r; op[i + 1] = q.g; op[i + 2] = q.b; op[i + 3] = a;
            }
          }

          const rim = nearest(...hexToRgb(spec.rim || "#ddb472"));
          const outline = nearest(17, 24, 39);
          const aa = nearest(24, 32, 51);
          const copy = new Uint8ClampedArray(op);
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const k = y * w + x;
              const i = k * 4;
              const a = baseAlpha[k];
              const n0 = maskAt(baseAlpha, w, h, x + 1, y);
              const n1 = maskAt(baseAlpha, w, h, x - 1, y);
              const n2 = maskAt(baseAlpha, w, h, x, y + 1);
              const n3 = maskAt(baseAlpha, w, h, x, y - 1);
              const anyNeighbor = n0 > 20 || n1 > 20 || n2 > 20 || n3 > 20;
              const nearVoid = a > 20 && (n0 < 20 || n1 < 20 || n2 < 20 || n3 < 20);
              if (a < 12 && anyNeighbor) {
                copy[i] = outline.r; copy[i + 1] = outline.g; copy[i + 2] = outline.b; copy[i + 3] = 230;
              } else if (a < 12) {
                const diag = maskAt(baseAlpha, w, h, x + 1, y + 1) > 20 || maskAt(baseAlpha, w, h, x - 1, y - 1) > 20 ||
                  maskAt(baseAlpha, w, h, x + 1, y - 1) > 20 || maskAt(baseAlpha, w, h, x - 1, y + 1) > 20;
                if (diag) { copy[i] = aa.r; copy[i + 1] = aa.g; copy[i + 2] = aa.b; copy[i + 3] = 110; }
              } else if (nearVoid) {
                const rimSide = x > w * 0.54 || y < h * 0.38;
                copy[i] = rimSide ? rim.r : outline.r;
                copy[i + 1] = rimSide ? rim.g : outline.g;
                copy[i + 2] = rimSide ? rim.b : outline.b;
                copy[i + 3] = Math.max(copy[i + 3], 220);
              }
            }
          }

          if (spec.kind === "tower") {
            for (let y = Math.floor(h * 0.48); y < Math.floor(h * 0.86); y++) {
              for (let x = Math.floor(w * 0.18); x < Math.floor(w * 0.82); x++) {
                const k = y * w + x, i = k * 4;
                if (copy[i + 3] < 180) continue;
                const grout = ((x + seed) % 17 === 0 && hash(x, y >> 2, seed) > 0.48) ||
                  ((y + seed) % 13 === 0 && hash(x >> 2, y, seed) > 0.64);
                if (grout) {
                  const q = nearest(31, 36, 51);
                  copy[i] = q.r; copy[i + 1] = q.g; copy[i + 2] = q.b;
                } else if (hash(x, y, seed) > 0.994) {
                  const q = nearest(203, 213, 225);
                  copy[i] = q.r; copy[i + 1] = q.g; copy[i + 2] = q.b;
                }
              }
            }
          }

          out.data.set(copy);
          cx.putImageData(out, 0, 0);
          const finalCanvas = upscale(work, img.naturalWidth || 1024, img.naturalHeight || 1024);
          return {
            dataUrl: finalCanvas.toDataURL("image/png"),
            colors: countColors(out),
            size: `${finalCanvas.width}x${finalCanvas.height}`,
          };
        }
        function hexToRgb(hex) {
          const n = parseInt(hex.slice(1), 16);
          return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }
        function countColors(imageData) {
          const set = new Set();
          const p = imageData.data;
          for (let i = 0; i < p.length; i += 4) {
            if (p[i + 3] > 0) set.add(`${p[i]},${p[i + 1]},${p[i + 2]},${p[i + 3]}`);
          }
          return set.size;
        }
        function generateTile(id, outW, outH) {
          const w = 256, h = 256;
          const work = document.createElement("canvas");
          work.width = w; work.height = h;
          const cx = work.getContext("2d");
          cx.imageSmoothingEnabled = false;
          const imageData = cx.createImageData(w, h);
          imageData.height = h;
          const p = imageData.data;
          const seed = [...id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
          const mats = MATERIAL[id].map((hex) => RGB.find((c) => c.hex === hex));
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              const n = periodicNoise(x, y, seed);
              const o = (BAYER[y & 3][x & 3] - 7.5) / 32;
              const bias = id === "grass1" ? 0.16 : id === "grass2" ? 0.14 : id === "grass3" ? 0.07 : id === "path" ? 0.10 : 0;
              let level = Math.max(0, Math.min(mats.length - 1, Math.floor((n + o + bias) * mats.length)));
              if (id.startsWith("grass") && hash(x >> 3, y >> 3, seed + 5) > 0.72) level = Math.min(mats.length - 1, level + 1);
              if (id === "path" && (Math.abs(((y + Math.sin(x / 11) * 8) % 48) - 24) < 3)) level = Math.max(0, level - 2);
              const c = mats[level];
              const i = (y * w + x) * 4;
              p[i] = c.r; p[i + 1] = c.g; p[i + 2] = c.b; p[i + 3] = 255;
            }
          }
          imageData.data.set(p);
          cx.putImageData(imageData, 0, 0);

          const d = cx.getImageData(0, 0, w, h);
          d.height = h;
          if (id.startsWith("grass")) {
            for (let i = 0; i < 520; i++) {
              const x = Math.floor(hash(i, seed, 31) * w);
              const y = Math.floor(hash(seed, i, 43) * h);
              const blade = hash(x, y, seed + 88) > 0.42 ? "#5d8d45" : "#204229";
              setPx(d, w, x, y, blade);
              if (hash(x, y, seed + 9) > 0.56) setPx(d, w, (x + 1) & 255, y, "#9db66a");
            }
            if (id === "grass2") {
              for (let i = 0; i < 70; i++) {
                const x = Math.floor(hash(i, seed, 91) * w);
                const y = Math.floor(hash(seed, i, 101) * h);
                const flower = hash(x, y, seed) > 0.5 ? "#fecdd3" : "#fde68a";
                setPx(d, w, x, y, flower);
                setPx(d, w, (x + 1) & 255, y, "#f1f5f9", 230);
              }
            }
            if (id === "grass3") {
              for (let i = 0; i < 110; i++) {
                const x = Math.floor(hash(i, seed, 111) * w);
                const y = Math.floor(hash(seed, i, 121) * h);
                setPx(d, w, x, y, "#61412d");
                setPx(d, w, (x + 1) & 255, y, "#3d2b24");
                if (hash(x, y, seed + 22) > 0.5) setPx(d, w, x, (y + 1) & 255, "#896040");
              }
            }
          } else if (id === "path") {
            for (let i = 0; i < 210; i++) {
              const x = Math.floor(hash(i, seed, 131) * w);
              const y = Math.floor(hash(seed, i, 141) * h);
              const pebble = hash(x, y, seed) > 0.52 ? "#ddb472" : "#2a2130";
              setPx(d, w, x, y, pebble);
              if (hash(x, y, seed + 4) > 0.55) setPx(d, w, (x + 1) & 255, y, "#896040");
            }
            for (let i = 0; i < 34; i++) {
              const x = Math.floor(hash(i, seed, 151) * w);
              const y = Math.floor(hash(seed, i, 161) * h);
              for (let s = 0; s < 10; s++) {
                setPx(d, w, (x + s) & 255, (y + Math.floor(s * 0.45)) & 255, s % 3 === 0 ? "#2a2130" : "#3d2b24");
              }
            }
          }
          cx.putImageData(d, 0, 0);
          const finalCanvas = upscale(work, outW || 1024, outH || 1024);
          return {
            dataUrl: finalCanvas.toDataURL("image/png"),
            colors: countColors(d),
            size: `${finalCanvas.width}x${finalCanvas.height}`,
          };
        }

        const img = await loadImage(src);
        if (target.kind === "tile") {
          return generateTile(target.id, img.naturalWidth || 1024, img.naturalHeight || 1024);
        }
        return processSource(img, {
          kind: target.kind,
          transparent: true,
          rim: rim[target.id],
          dither: target.kind === "skill" ? 1.25 : 1.0,
          seed: [...target.id].reduce((sum, ch) => sum + ch.charCodeAt(0), 0),
        });
      }, { target, src: before[target.file], rim: RIM });
      after[target.file] = result.dataUrl;
      writeDataUrl(target.file, result.dataUrl);
      metrics.push({ file: target.file, colors: result.colors, size: result.size });
      console.log(`R65 polished ${target.file} (${result.size}, ${result.colors} colors)`);
    }

    const sheets = await page.evaluate(async ({ before, after, targets, towers, tiles, skills }) => {
      function loadImage(url) {
        return new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = url;
        });
      }
      function checker(ctx, x, y, w, h) {
        ctx.fillStyle = "#1f2937"; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = "#374151";
        for (let yy = y; yy < y + h; yy += 12) {
          for (let xx = x; xx < x + w; xx += 12) {
            if (((xx + yy) / 12) & 1) ctx.fillRect(xx, yy, 12, 12);
          }
        }
      }
      function label(ctx, text, x, y, size = 18) {
        ctx.font = `700 ${size}px Segoe UI, sans-serif`;
        ctx.textBaseline = "top";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,.75)";
        ctx.strokeText(text, x, y);
        ctx.fillStyle = "#f8fafc";
        ctx.fillText(text, x, y);
      }
      async function drawAsset(ctx, src, x, y, size, transparent) {
        if (transparent) checker(ctx, x, y, size, size);
        const img = await loadImage(src);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, size, size);
      }
      async function mapSheet() {
        const c = document.createElement("canvas");
        c.width = 1280; c.height = 720;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0b1410"; ctx.fillRect(0, 0, c.width, c.height);
        label(ctx, "td R65 map tiles before / after", 28, 24, 26);
        label(ctx, "before", 226, 70, 18); label(ctx, "after", 454, 70, 18);
        const mapTargets = targets.filter((t) => t.group === "tiles");
        for (let i = 0; i < mapTargets.length; i++) {
          const t = mapTargets[i];
          const y = 100 + i * 78;
          label(ctx, t.id, 28, y + 18, 16);
          const transparent = t.kind !== "tile";
          await drawAsset(ctx, before[t.file], 210, y, 64, transparent);
          await drawAsset(ctx, after[t.file], 438, y, 64, transparent);
          await drawAsset(ctx, before[t.file], 296, y - 8, 80, transparent);
          await drawAsset(ctx, after[t.file], 524, y - 8, 80, transparent);
        }
        const grass = ["grass1", "grass2", "grass3", "path"];
        for (let gy = 0; gy < 4; gy++) {
          for (let gx = 0; gx < 5; gx++) {
            const id = grass[(gx + gy) % grass.length];
            const file = `assets/tiles/${id}.png`;
            await drawAsset(ctx, after[file], 760 + gx * 72, 126 + gy * 72, 72, false);
          }
        }
        label(ctx, "after tile patch: varied materials, no flat fills", 742, 440, 17);
        return c.toDataURL("image/png");
      }
      async function towerSheet() {
        const c = document.createElement("canvas");
        c.width = 1600; c.height = 900;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0b1118"; ctx.fillRect(0, 0, c.width, c.height);
        label(ctx, "td R65 tower polish before / after", 30, 24, 28);
        for (let i = 0; i < towers.length; i++) {
          const id = towers[i];
          const x = 32 + (i % 5) * 306;
          const y = 92 + Math.floor(i / 5) * 382;
          label(ctx, id, x, y - 24, 18);
          label(ctx, "before", x, y + 244, 14);
          label(ctx, "after", x + 150, y + 244, 14);
          await drawAsset(ctx, before[`assets/towers/${id}.png`], x, y, 132, true);
          await drawAsset(ctx, after[`assets/towers/${id}.png`], x + 150, y, 132, true);
          await drawAsset(ctx, before[`assets/towers/${id}.png`], x + 8, y + 154, 88, true);
          await drawAsset(ctx, after[`assets/towers/${id}.png`], x + 158, y + 154, 88, true);
        }
        return c.toDataURL("image/png");
      }
      async function iconSheet() {
        const c = document.createElement("canvas");
        c.width = 1320; c.height = 720;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0a120d"; ctx.fillRect(0, 0, c.width, c.height);
        label(ctx, "td R65 UI icon polish before / after", 28, 24, 27);
        function buttonFrame(x, y, w, h, round, color) {
          ctx.fillStyle = "#111f17"; ctx.strokeStyle = color || "rgba(255,255,255,.18)"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.roundRect(x, y, w, h, round); ctx.fill(); ctx.stroke();
        }
        const all = [
          ...towers.map((id) => ({ id, file: `assets/towers/${id}.png`, size: 44, round: 10, color: "#facc15" })),
          ...skills.map((id) => ({ id, file: `assets/skills/${id}.png`, size: 50, round: 25, color: "#38bdf8" })),
        ];
        for (let i = 0; i < all.length; i++) {
          const item = all[i];
          const col = i % 5;
          const row = Math.floor(i / 5);
          const x = 42 + col * 250;
          const y = 96 + row * 184;
          label(ctx, item.id, x, y - 26, 16);
          buttonFrame(x, y, 58, 58, item.round, "rgba(255,255,255,.18)");
          buttonFrame(x + 96, y, 58, 58, item.round, item.color);
          await drawAsset(ctx, before[item.file], x + 7, y + 7, item.size, true);
          await drawAsset(ctx, after[item.file], x + 103, y + 7, item.size, true);
          label(ctx, "B", x + 20, y + 66, 12);
          label(ctx, "A", x + 116, y + 66, 12);
        }
        label(ctx, "after icons use the same polished PNGs now wired into dock and wheel UI", 40, 650, 17);
        return c.toDataURL("image/png");
      }
      async function paletteSheet() {
        const c = document.createElement("canvas");
        c.width = 920; c.height = 160;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#0b1118"; ctx.fillRect(0, 0, c.width, c.height);
        label(ctx, "td R65 unified limited palette", 24, 18, 22);
        const colors = ["#07120d", "#0d1b16", "#14231e", "#204229", "#2f6f38", "#5d8d45", "#9db66a",
          "#2a2130", "#3d2b24", "#61412d", "#896040", "#b9824e", "#ddb472",
          "#1f2433", "#30364a", "#46556e", "#64748b", "#94a3b8", "#cbd5e1", "#f1f5f9",
          "#1e5b78", "#38bdf8", "#7dd3fc", "#d9fafe", "#7c3aed", "#a855f7", "#e9d5ff",
          "#a16207", "#facc15", "#fde68a", "#fff7ad", "#b45309", "#f97316", "#fb923c", "#fed7aa",
          "#9f1239", "#fb7185", "#fecdd3", "#16a34a", "#22c55e", "#86efac", "#111827", "#182033"];
        colors.forEach((color, i) => {
          ctx.fillStyle = color;
          ctx.fillRect(24 + (i % 22) * 39, 62 + Math.floor(i / 22) * 39, 31, 31);
        });
        return c.toDataURL("image/png");
      }
      return {
        map: await mapSheet(),
        towers: await towerSheet(),
        icons: await iconSheet(),
        palette: await paletteSheet(),
      };
    }, { before, after, targets: TARGETS, towers: TOWERS, tiles: TILES, skills: SKILLS });

    writeEvidence("map-before-after.png", sheets.map);
    writeEvidence("towers-before-after.png", sheets.towers);
    writeEvidence("icons-before-after.png", sheets.icons);
    writeEvidence("palette-strip.png", sheets.palette);
    fs.writeFileSync(path.join(OUT_DIR, "asset-metrics.json"), JSON.stringify(metrics, null, 2) + "\n");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
