/* R80: cached board artwork. Geometry comes exclusively from MAPS/rules. */
(function (root, factory) {
  const art = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = art;
  if (root) root.TDMapArt = art;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TERRAIN_PLATES = Object.freeze({
    plains: "assets/maps/r80/plains-terrain.webp?v=d3cda75c",
    canyon: "assets/maps/r80/canyon-terrain.webp?v=493a84f1",
    lava: "assets/maps/r80/lava-terrain.webp?v=04307fb8",
  });
  const BRIDGE_SPRITE = "assets/maps/r80/stone-bridge.webp?v=d69267c8";
  const PALETTES = Object.freeze({
    plains: { ground: "#53644a", road: "#c3ad87", rim: "#655d45", dust: "#e1d0a7", stone: "#adb8a6", stoneDark: "#6c796c", accent: "#bcd5bc" },
    canyon: { ground: "#b5996b", road: "#dac7a4", rim: "#806447", dust: "#f2e0bd", stone: "#cbbba1", stoneDark: "#83715f", accent: "#ead4a6" },
    lava: { ground: "#47484d", road: "#a6a6a4", rim: "#4b4e53", dust: "#cccac3", stone: "#818b93", stoneDark: "#444b52", accent: "#bdd2db" },
  });
  function palette(map) { return PALETTES[map.id] || PALETTES.plains; }
  function shape(ctx, region) {
    ctx.beginPath();
    if (region.shape === "ellipse") { ctx.ellipse(region.x, region.y, region.rx, region.ry, 0, 0, Math.PI * 2); return; }
    const points = region.points || [];
    if (!points.length) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }
  function pathStroke(ctx, points, width, color) {
    if (!points || points.length < 2) return;
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = width; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  function hash(value) { let h = 2166136261; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0; return h; }
  function roundBox(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function fallbackTerrain(ctx, map, w, h) {
    const p = palette(map);
    ctx.fillStyle = p.ground; ctx.fillRect(0, 0, w, h);
    // Loading-only fallback preserves all forbidden footprints. This is not a
    // substitute for the generated raster plate used by the completed board.
    for (const region of map.regions || []) {
      ctx.fillStyle = region.type === "water" ? "#267984" : region.type === "lava" ? "#c74f22" : region.type === "cliff" ? "#343237" : "#7d8077";
      shape(ctx, region); ctx.fill();
    }
  }
  function road(ctx, map) {
    const p = palette(map), width = map.roadWidth || 42;
    // Transparent soil and a ragged verge let the illustrated ground show
    // through. All marks are baked once, never generated during live frames.
    ctx.save(); ctx.globalAlpha = .15; pathStroke(ctx, map.path, width + 8, p.rim);
    ctx.globalAlpha = .60; pathStroke(ctx, map.path, width - 2, p.road);
    ctx.globalAlpha = .18; pathStroke(ctx, map.path, width - 14, p.dust); ctx.restore();
    for (let segment = 1; segment < map.path.length; segment++) {
      const a = map.path[segment - 1], b = map.path[segment], dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
      ctx.save(); ctx.translate(a.x,a.y); ctx.rotate(angle);
      for (let d = 0; d < length; d += 3) {
        const seed = hash(`${map.id}:${segment}:${Math.floor(d)}`);
        for (let side = -1; side <= 1; side += 2) {
          const edge = side * (width / 2 - 1 + (seed % 9 - 4) * .55);
          ctx.fillStyle = seed % 3 ? p.road : p.rim; ctx.globalAlpha = .10 + seed % 5 * .025;
          ctx.beginPath(); ctx.ellipse(d, edge, 2 + seed % 5, 1.8 + seed % 4 * .5, 0, 0, Math.PI * 2); ctx.fill();
        }
        for (let j = 0; j < 5; j++) {
          const n = hash(`${seed}:${j}`), y = (n % 1000 / 1000 - .5) * (width - 5);
          ctx.fillStyle = n % 2 ? p.rim : p.dust; ctx.globalAlpha = .13 + n % 5 * .03;
          ctx.beginPath(); ctx.ellipse(d + n % 3, y, .45 + n % 4 * .3, .35 + n % 3 * .25, .3, 0, Math.PI * 2); ctx.fill();
        }
        // Small broken ruts, with no continuous technical outline.
        if (seed % 5 < 2) {
          ctx.strokeStyle = p.rim; ctx.globalAlpha = .12; ctx.lineWidth = .7;
          ctx.beginPath(); ctx.moveTo(d, -7); ctx.lineTo(Math.min(length,d+7),-6.5); ctx.moveTo(d,7); ctx.lineTo(Math.min(length,d+6),7.5);ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
  function bridge(ctx, map, data, sprite) {
    const p = palette(map), width = data.width || 48;
    for (let segment = 1; segment < data.path.length; segment++) {
      const a = data.path[segment - 1], b = data.path[segment], dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
      if (sprite && sprite.complete && sprite.naturalWidth > 0) {
        ctx.save(); ctx.translate(a.x,a.y);ctx.rotate(angle);
        if (map.id === "lava") ctx.filter = "brightness(.65) saturate(.45)";
        ctx.drawImage(sprite, -10, -width/2-4, length+20, width+12);
        ctx.restore(); continue;
      }
      ctx.save(); ctx.translate(2,8); ctx.translate(a.x,a.y);ctx.rotate(angle);
      ctx.fillStyle = "rgba(12,17,19,.38)"; ctx.fillRect(-7,-width/2-4,length+14,width+8); ctx.restore();
      ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(angle);
      // Grounded square abutments and a visible south-facing masonry wall.
      ctx.fillStyle = p.stoneDark; ctx.fillRect(-9,-width/2-6,20,width+12);ctx.fillRect(length-11,-width/2-6,20,width+12);
      ctx.fillRect(-4,-width/2,length+8,width+5);
      ctx.fillStyle = p.stone; ctx.fillRect(-4,-width/2,length+8,width);
      const light = ctx.createLinearGradient(0,-width/2,0,width/2);
      light.addColorStop(0,"rgba(255,245,221,.23)"); light.addColorStop(.55,"rgba(255,245,221,.02)");light.addColorStop(1,"rgba(20,27,31,.21)");
      ctx.fillStyle = light;ctx.fillRect(-4,-width/2,length+8,width);
      for (let row=0;row<4;row++) for (let d=-4-(row%2)*11;d<length+4;d+=23) {
        const left=Math.max(-4,d),right=Math.min(length+4,d+22), seed=hash(`${map.id}:${data.id}:${row}:${d}`);
        if(right<=left)continue;
        const y=-width/2+row*12;
        ctx.globalAlpha=.09+seed%5*.022;ctx.fillStyle=seed%2?p.stoneDark:p.dust;ctx.fillRect(left+.7,y+.5,right-left-1.3,11);
        ctx.globalAlpha=1;ctx.strokeStyle="rgba(34,37,38,.27)";ctx.lineWidth=.7;ctx.strokeRect(left+.4,y+.2,right-left-.8,11.8);
        ctx.fillStyle="rgba(245,232,210,.22)";ctx.fillRect(left+1,y+.8,right-left-2,.6);
        for(let k=0;k<5;k++){const n=hash(`${seed}:${k}`);ctx.fillStyle=n%2?"rgba(36,40,42,.14)":"rgba(255,246,219,.15)";ctx.fillRect(left+(n%900/900)*(right-left),y+2+n%8,.8,.65);}
      }
      for(const sign of [-1,1])for(let d=-6;d<length+6;d+=17){
        const w=Math.min(16,length+6-d),y=sign<0?-width/2-3:width/2-4;
        ctx.fillStyle=p.stoneDark;ctx.fillRect(d,y,w,6);ctx.fillStyle=p.stone;ctx.fillRect(d,y-1,w,4);
        ctx.fillStyle="rgba(255,244,214,.31)";ctx.fillRect(d+1,y-1,w-2,1);
      }
      // Moss / ash accumulates at shore joints, without widening walkable deck.
      ctx.globalAlpha=.24;ctx.fillStyle=map.id==="plains"?"#48664c":p.ground;
      for(const x of [0,length])for(let k=0;k<12;k++){const n=hash(`${data.id}:${x}:${k}`);ctx.fillRect(x+(n%12-6),-width/2+ n%48,1+n%4,1+n%3);}
      ctx.restore();
    }
  }
  function pad(ctx, map, point) {
    const p = palette(map);
    // Five authored low-profile footing hints; these never imply exclusivity.
    ctx.save(); ctx.translate(point.x, point.y); ctx.globalAlpha = .33;
    ctx.fillStyle = p.stoneDark; ctx.beginPath(); ctx.ellipse(0, 2, 17, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = p.accent; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(0, 0, 15, 12, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function entry(ctx, map) {
    const point = map.entry || map.path[0], inward = point.direction === "west" ? -1 : 1;
    const x = Math.max(17, Math.min(943, point.x + inward * 19));
    ctx.save(); ctx.translate(x, point.y); ctx.scale(inward, 1);
    ctx.fillStyle = "rgba(18,34,29,.76)"; ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e4d8b8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(7, 0); ctx.lineTo(1, -5); ctx.moveTo(7, 0); ctx.lineTo(1, 5); ctx.stroke(); ctx.restore();
  }
  function altarAccent(ctx, map) {
    const point = map.core || map.path[map.path.length - 1];
    ctx.save(); ctx.globalAlpha = .36; ctx.strokeStyle = palette(map).accent; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(point.x, point.y + 2, 35, 27, 0, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
  }
  function paintBoard(ctx, map, options) {
    const opts = options || {}, w = opts.width || 960, h = opts.height || 640, image = opts.plate;
    const ready = !!(image && image.complete && (image.naturalWidth || image.width) > 0);
    ctx.save(); ctx.shadowBlur = 0; ctx.filter = "none"; ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
    if (ready) {
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
      ctx.drawImage(image, 0, 0, w, h);
    } else fallbackTerrain(ctx, map, w, h);
    // The path still ends at the core for gameplay, but soil must not paint
    // across the baked altar carving. The road meets its outside stone rim.
    const altar = (map.regions || []).find(region => region.id === "altar-base" && region.shape === "ellipse");
    ctx.save();
    if (altar) { ctx.beginPath();ctx.rect(0,0,w,h);ctx.ellipse(altar.x,altar.y,altar.rx,altar.ry,0,0,Math.PI*2);ctx.clip("evenodd"); }
    road(ctx, map);ctx.restore();
    for (const data of map.bridges || []) bridge(ctx, map, data, opts.bridgeSprite);
    for (const point of map.buildPads || []) if (!opts.isBuildable || opts.isBuildable(point.x, point.y)) pad(ctx, map, point);
    entry(ctx, map); altarAccent(ctx, map);
    ctx.restore();
    return { ready: ready && !!(opts.bridgeSprite && opts.bridgeSprite.complete && opts.bridgeSprite.naturalWidth > 0), roadWidth: map.roadWidth || 42, bridgeCount: (map.bridges || []).length, regionCount: (map.regions || []).length,
      biome: map.biome || map.id, terrainPlate: TERRAIN_PLATES[map.id] };
  }
  function paintGuide(ctx, map, options) {
    const scale = Math.max(.25, Number(options && options.cssScale) || 1), p = palette(map);
    ctx.save(); ctx.shadowBlur = 0; ctx.filter = "none";
    for (let i = 1; i < map.path.length; i++) {
      const a = map.path[i - 1], b = map.path[i], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy), angle = Math.atan2(dy, dx);
      for (let d = 46; d < length - 16; d += 104) {
        ctx.save(); ctx.translate(a.x + dx * d / length, a.y + dy * d / length); ctx.rotate(angle);
        ctx.strokeStyle = "rgba(41,55,45,.72)"; ctx.lineWidth = 1.9 / scale;
        ctx.beginPath(); ctx.moveTo(-3 / scale, -3 / scale); ctx.lineTo(1.5 / scale, 0); ctx.lineTo(-3 / scale, 3 / scale); ctx.stroke(); ctx.restore();
      }
    }
    const labelsVisible = !(options && options.showLabels === false);
    const nodes = labelsVisible ? map.defenseNodes || [] : [];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index], font = 11 / scale, height = (scale < .65 ? 18 : 24) / scale;
      ctx.font = `700 ${font}px "Segoe UI", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const label = `${index + 1} ${node.label}`, width = ctx.measureText(label).width + 16 / scale;
      const anchorX = Number.isFinite(node.labelX) ? node.labelX : node.x;
      const anchorY = Number.isFinite(node.labelY) ? node.labelY : node.y;
      const x = Math.max(5 / scale, Math.min(960 - width - 5 / scale, anchorX - width / 2));
      const y = Math.max(5 / scale, Math.min(640 - height - 5 / scale, anchorY - height / 2));
      ctx.fillStyle = "rgba(18,30,28,.83)"; roundBox(ctx, x, y, width, height, 7 / scale); ctx.fill();
      ctx.strokeStyle = "rgba(219,216,186,.46)"; ctx.lineWidth = 1 / scale; ctx.stroke();
      ctx.fillStyle = p.accent; ctx.fillText(label, x + width / 2, y + height / 2);
    }
    const first = map.entry || map.path[0], last = map.core || map.path[map.path.length - 1];
    ctx.font = `700 ${10 / scale}px "Segoe UI", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const data of labelsVisible ? [{ point: first, label: "入口" }, { point: last, label: "守護石壇" }] : []) {
      const x = Math.max(28 / scale, Math.min(960 - 28 / scale, data.point.x));
      const y = Math.max(13 / scale, Math.min(640 - 13 / scale, data.point.y - 34));
      ctx.strokeStyle = "rgba(10,18,18,.9)"; ctx.lineWidth = 3 / scale; ctx.strokeText(data.label, x, y);
      ctx.fillStyle = "#eee1be"; ctx.fillText(data.label, x, y);
    }
    ctx.restore();
  }
  return { TERRAIN_PLATES, BRIDGE_SPRITE, PALETTES, paintBoard, paintGuide, shape };
});
