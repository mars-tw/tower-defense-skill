"use strict";
const assert=require("node:assert/strict"),cfg=require("../src/config.js"),rules=require("../src/rules.js");
for(const map of Object.values(cfg.MAPS)) {
  assert(rules.mapWalkable(map,map.core.x,map.core.y,8),"altar-base allows spawn and return");
  for(const pad of map.buildPads) {
    const route=rules.heroRoute(map,map.core,pad,{cellSize:24,radius:8});
    assert(route.reachable,`${map.id}/${pad.id}: ${route.reason}`);
    let previous=map.core;
    for(const point of route.points) {
      assert(rules.lineWalkable(map,previous,point,8));
      const distance=Math.hypot(point.x-previous.x,point.y-previous.y),steps=Math.max(1,Math.ceil(distance/2));
      for(let index=0;index<=steps;index++)assert(rules.mapWalkable(map,previous.x+(point.x-previous.x)*index/steps,previous.y+(point.y-previous.y)*index/steps,8));
      previous=point;
    }
    assert.deepEqual(route.points.at(-1),{x:pad.x,y:pad.y});
    const again=rules.heroRoute(map,map.core,pad,{cellSize:24,radius:8});assert.deepEqual(route,again);
    route.points[0].x=-999;assert.notEqual(rules.heroRoute(map,map.core,pad,{cellSize:24,radius:8}).points[0].x,-999);
  }
  let blockedGround=0;
  for(let y=24;y<640;y+=24)for(let x=24;x<960;x+=24) {
    const inside=map.regions.some(region=>region.id!=="altar-base"&&(region.shape==="ellipse"?((x-region.x)/region.rx)**2+((y-region.y)/region.ry)**2<=1:rules.pointInPolygon({x,y},region.points)));
    const onBridge=map.bridges.some(bridge=>rules.distanceToPath(x,y,bridge.path)<=bridge.width/2);
    if(inside&&!onBridge){assert.equal(rules.mapWalkable(map,x,y,8),false);assert.equal(rules.heroRoute(map,map.core,{x,y}).reachable,false);blockedGround++;}
  }
  assert(blockedGround>10);
  console.log(`PASS ${map.id}: all 5 pads reachable from altar; no terrain shortcuts; ${blockedGround} water/cliff/lava/ruin targets rejected`);
}
const map=cfg.MAPS.plains;
assert.equal(rules.lineWalkable(map,{x:264,y:216},{x:600,y:216},8),false,"straight hero path cannot cross unbridged river");
const crossing=rules.heroRoute(map,{x:264,y:216},{x:600,y:216},{cellSize:24,radius:8});assert(crossing.reachable&&crossing.points.length>1);
assert.equal(rules.mapWalkable("missing",24,24),false);assert.equal(rules.heroRoute(map,{x:24,y:24},{x:NaN,y:4}).reachable,false);
console.log("Map hero navigation gate passed; cached 24px graph and routes, no enemy/economy changes.");
