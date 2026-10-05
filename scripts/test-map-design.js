"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const cfg=require("../src/config.js"),rules=require("../src/rules.js");
const metrics=[];
for(const map of Object.values(cfg.MAPS)) {
  assert.equal(map.path[0].x,map.entry.x); assert.equal(map.path[0].y,map.entry.y);
  assert.deepEqual(map.path.at(-1),{x:900,y:556});
  assert.equal(map.defenseNodes.length,3);assert.deepEqual(map.defenseNodes.map(node=>node.id),["front","crossfire","rear"]);
  assert(map.path.every(p=>p.x>=0&&p.x<=960&&p.y>=0&&p.y<=640));
  assert(map.path.every((p,i)=>!i||Math.hypot(p.x-map.path[i-1].x,p.y-map.path[i-1].y)>0));
  assert(map.regions.length<=5&&map.bridges.length<=2);
  const blocked=rules.mapBlockedCells(map,48);
  for(let y=24;y<640;y+=48)for(let x=24;x<960;x+=48) {
    assert.equal(blocked.has(`${Math.floor(x/48)},${Math.floor(y/48)}`),rules.mapBuildRestriction(map,x,y,48).blocked);
  }
  for(const pad of map.buildPads) {
    assert.equal(rules.mapBuildRestriction(map,pad.x,pad.y,48).blocked,false,`${map.id}/${pad.id} legal complete tile`);
    const type=pad.id==="front-arrow"?"arrow":"frost";
    assert(rules.canReachPath(pad.x,pad.y,map.path,cfg.TOWERS[type].range*.9),`${map.id}/${pad.id} reachable even in fog`);
  }
  assert(cfg.TOWERS.arrow.cost+cfg.TOWERS.frost.cost<=Math.round(cfg.GAME.startGold*map.goldMul));
  for(const region of map.regions) {
    if(region.shape==="ellipse")assert(rules.mapBuildRestriction(map,region.x,region.y,48).blocked);
    else {
      const centroid=region.points.reduce((point,p)=>({x:point.x+p.x/region.points.length,y:point.y+p.y/region.points.length}),{x:0,y:0});
      assert(rules.mapBuildRestriction(map,centroid.x,centroid.y,48).blocked);
    }
  }
  for(const bridge of map.bridges)assert(rules.mapBuildRestriction(map,bridge.path[0].x,bridge.path[0].y,48).blocked);
  for(let distance=0;distance<=1;distance+=.004) {
    const point=rules.pointAtPathRatio(map.path,distance);
    for(const region of map.regions.filter(region=>region.type!=="ruin")) {
      const inside=region.shape==="ellipse"?((point.x-region.x)/region.rx)**2+((point.y-region.y)/region.ry)**2<=1:rules.pointInPolygon(point,region.points);
      if(inside)assert(map.bridges.some(bridge=>rules.distanceToPath(point.x,point.y,bridge.path)<=bridge.width/2),`${map.id} route crosses ${region.id} only on a bridge`);
    }
  }
  const result=rules.mapGeometryMetrics(map,130); metrics.push(result);
  assert(result.reachableCells>=40);assert(result.length>=1400&&result.length<=2300);
  assert(result.maxTowerCoverage.fraction<.29,"no one Lv1 130px tower covers one full third of the route");
  for(let wave=1;wave<=20;wave++) {
    const plan=rules.generateWaveQueue(wave,"normal",wave*1009);
    const candidates=rules.adviseTowerActions({mapId:map.id,mapDef:map,path:map.path,towers:[],gold:220,queue:plan.queue});
    for(const action of candidates)if(action.kind==="build")assert.equal(rules.mapBuildRestriction(map,action.x,action.y,48).blocked,false);
  }
  console.log(`PASS ${map.id}: length ${result.length.toFixed(1)}, legal/reachable ${result.legalCells}/${result.reachableCells}, maximum 130px tower coverage ${(result.maxTowerCoverage.fraction*100).toFixed(2)}%, all pads fog-safe`);
}
// A narrow shape crossing a tile is blocked even when its center is outside.
const synthetic={path:[{x:0,y:600},{x:960,y:600}],regions:[{id:"strip",label:"窄崖",type:"cliff",shape:"polygon",points:[{x:46,y:0},{x:50,y:0},{x:50,y:96},{x:46,y:96}]}]};
assert.equal(rules.mapBuildRestriction(synthetic,24,24,48).blocked,true);
assert.equal(rules.mapBuildRestriction(synthetic,72,24,48).blocked,true);
const ellipse={path:[{x:0,y:600},{x:960,y:600}],regions:[{id:"pool",type:"water",shape:"ellipse",x:100,y:100,rx:10,ry:10}]};
assert.equal(rules.mapBuildRestriction(ellipse,72,72,48).blocked,true);
assert.equal(rules.mapBuildRestriction(ellipse,24,24,48).blocked,false);
assert.equal(rules.mapBuildRestriction("plains",24,630,48).kind,"bounds");
assert.equal(rules.mapBuildRestriction("missing",24,24,48).blocked,true);
const cached=rules.mapBlockedCells(ellipse,48);cached.clear();assert(rules.mapBlockedCells(ellipse,48).size>0);
ellipse.regions=[];assert.equal(rules.mapBlockedCells(ellipse,48).has("1,1"),false);
const baseline={startGold:220,missions:38,pity:18};
assert.equal(cfg.GAME.startGold,baseline.startGold);assert.equal(Object.values(cfg.BEGINNER_MISSIONS).reduce((s,m)=>s+m.reward,0),baseline.missions);
assert.equal(require("../src/heroes.js").GACHA.pityLegendary,baseline.pity);
const out=path.resolve(__dirname,"../docs/evidence/R80/map-design");fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,"geometry-metrics.json"),JSON.stringify({method:"Exact poly/ellipse/full-tile collision; analytic line/circle route coverage; reachable cells at 130px; no renderer or AI-image claim",metrics},null,2));
console.log("Map design geometry, shared adviser and economy invariants passed.");
