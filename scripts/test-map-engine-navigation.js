/* Actual shipped updateHero: route following, chase/home, guard rejection and
 * graph warmup. VM is logic evidence only; browser raster/input tested apart. */
"use strict";
const assert=require('node:assert/strict'),{productionHarness}=require('./lib/production-harness');
for(const id of ['plains','canyon','lava']){
 const {TD,rules,canvas}=productionHarness();TD.setMap(id);TD.newGame({runSeed:104729,affixSeed:130363});
 const tap=(x,y)=>canvas.listeners.click({clientX:x,clientY:y});
 const s=TD.state(),map=TD.getMap();assert(s.navigationReady);assert.equal(TD.debug.engineStats().navWarmups,1);
 const land=map.buildPads.filter(p=>p.zone==='front')[0];TD.deployHero('knight',{});const hero=s.heroes[0];assert(rules.mapWalkable(map,hero.x,hero.y,8));
 // Observed public guard API, actual click handler and production update loop.
 TD.selectHeroGuard(hero.uid);tap(land.x,land.y);assert.deepEqual(JSON.parse(JSON.stringify(hero.guardPoint)),{x:land.x,y:land.y});
 s.running=true;
 let samples=0;for(let i=0;i<3600&&Math.hypot(hero.x-land.x,hero.y-land.y)>2;i++){TD.debug.step(1/60);assert(rules.mapWalkable(map,hero.x,hero.y,8),`${id} sample ${i} crosses terrain`);samples++;}
 assert(Math.hypot(hero.x-land.x,hero.y-land.y)<2,`${id} guard reached after ${samples} ticks`);assert(hero.walkDist>=Math.hypot(land.x-map.core.x,land.y-map.core.y)-100);
 assert(TD.debug.engineStats().navQueries<=3,'static guard route must not replan every tick');
 const forbidden=map.regions.find(r=>r.shape==='ellipse'&&r.id!=='altar-base'&&!rules.mapWalkable(map,r.x,r.y,8));if(forbidden){const before={...hero.guardPoint};TD.selectHeroGuard(hero.uid);tap(forbidden.x,forbidden.y);assert.deepEqual(JSON.parse(JSON.stringify(hero.guardPoint)),before);assert.equal(s.pendingHero,hero.uid);}
 // A real stationary enemy across the terrain forces chase navigation, then
 // removing it forces return over the same bridges. No alternate physics.
 s.pendingHero=null;hero.guardPoint=null;hero.navigation=null;const end=map.core;
 const target=TD.debug.spawnEnemy('slime',{x:end.x,y:end.y,hp:1e9,maxHp:1e9,speed:0});s.spawnQueue.length=0;
 s.path=[{x:end.x-1,y:end.y},{x:end.x+1,y:end.y}];target.wp=1;
 for(let i=0;i<3600&&Math.hypot(hero.x-end.x,hero.y-end.y)>45;i++){TD.debug.step(1/60);assert(rules.mapWalkable(map,hero.x,hero.y,8),`${id} chase crosses terrain`);}
 assert(Math.hypot(hero.x-end.x,hero.y-end.y)<=45,`${id} chase reaches range`);
 target._dead=true;for(let i=0;i<300;i++){TD.debug.step(1/60);assert(rules.mapWalkable(map,hero.x,hero.y,8));}
 console.log(`PASS ${id}: guard/chase/return follow production bridge route, ${samples} walk samples; warm graph + bounded queries`);
}
