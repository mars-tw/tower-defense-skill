/* R82 finite expeditions. Pure data/transitions; no DOM, storage, clock or RNG consumption. */
(function(root,factory){const exported=factory(typeof module!=="undefined"&&module.exports?require("./config.js"):root);if(typeof window!=="undefined")window.TDExpedition=exported;if(typeof module!=="undefined"&&module.exports)module.exports=exported;})(typeof globalThis!=="undefined"?globalThis:this,function(cfg){
 "use strict";
 const own=(object,key)=>!!object&&Object.prototype.hasOwnProperty.call(object,key);
 const number=(value,fallback=0)=>typeof value==="number"&&Number.isFinite(value)?value:fallback;
 const integer=value=>Math.max(0,Math.floor(number(value)));
 const clone=value=>Array.isArray(value)?value.map(clone):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).filter(([key])=>!["__proto__","constructor","prototype"].includes(key)).map(([key,item])=>[key,clone(item)])):value;
 const RELICS={
  physicalPierce:{id:"physicalPierce",label:"連矢刻印",role:"物理補刀",desc:"物理投射物多貫穿 1 個附近敵人；不影響近戰或範圍爆炸。",effect:{physicalPierceBonus:1}},
  cannonSplash:{id:"cannonSplash",label:"擴焰砲環",role:"成群清場",desc:"加農砲爆炸半徑 +20%。",effect:{cannonSplashMul:1.2}},
  frostDuration:{id:"frostDuration",label:"長霜符石",role:"控場接力",desc:"寒冰塔緩速與冰封術凍結時間 +30%；不影響英雄緩速或封魔陣。",effect:{frostDurationMul:1.3}},
  thunderVsSlow:{id:"thunderVsSlow",label:"引雷霜紋",role:"冰雷協同",desc:"雷系直接傷害對緩速或凍結敵人 +15%，含引魂燈的實際緩速。",effect:{thunderVsSlowMul:1.15}},
  poisonDps:{id:"poisonDps",label:"蝕盾毒芯",role:"厚甲消耗",desc:"毒霧塔持續毒傷 +20%。",effect:{poisonDpsMul:1.2}},
  skillCooldown:{id:"skillCooldown",label:"回響法頁",role:"主動施法",desc:"主動技能冷卻時間減少 15%；禁法合約中仍不能施法。",effect:{skillCooldownMul:.85}},
  upgradeCost:{id:"upgradeCost",label:"匠魂銅印",role:"集中升級",desc:"砲塔升級費用減少 10%，不折抵建塔或女神升級。",effect:{upgradeCostMul:.9}},
  killGold:{id:"killGold",label:"獵魂錢契",role:"擊殺經濟",desc:"每次真實擊殺額外 +1 金，在連殺倍率計算後加上。",effect:{killGoldBonus:1}},
  healBetween:{id:"healBetween",label:"續火聖燈",role:"波間修復",desc:"每次清波回復女神 5 生命，不能超過生命上限。",effect:{healBetween:5}},
  leakWard:{id:"leakWard",label:"守壇薄幕",role:"漏怪容錯",desc:"每波第一次漏怪的女神傷害減半；同波後續漏怪不減傷。",effect:{firstLeakWardPerWave:.5}},
  heroDamage:{id:"heroDamage",label:"英靈戰誓",role:"英雄輸出",desc:"本局英雄傷害 +12%，不增加永久羈絆。",effect:{heroDamageMul:1.12}},
  heroSpeed:{id:"heroSpeed",label:"逐橋風羽",role:"英雄機動",desc:"英雄沿合法地形移動速度 +20%，仍須走橋與可達路線。",effect:{heroSpeedMul:1.2}},
 };
 const CONTRACTS={
  rush:{id:"rush",label:"疾行追獵",desc:"這一波敵人速度 +20%；清波額外 +25 金。",gold:25,enemySpeedMul:1.2},
  reinforcements:{id:"reinforcements",label:"迎擊援軍",desc:"這一波增加 2 名援軍，第 7 波起增加 3 名；清波額外 +30 金。",gold:30},
  skillBan:{id:"skillBan",label:"禁法守陣",desc:"這一波不能使用主動技能；清波額外 +35 金。",gold:35,skillBan:true},
 };
 const wave=(label,groups)=>({label,groups});
 const MISSIONS={
  plains:{id:"plains",mapId:"plains",title:"溪橋守望",finalWave:12,brief:"先守林口，過橋後用元素接力，最後擋住逼向東岸石壇的夜叉。",finale:{type:"yaksha",name:"溪橋夜叉",hpMul:1.08},
   phases:[{from:1,to:3,title:"林口試探",tip:"先用便宜攻擊塔搭緩速，防線站穩後再升級。"},{from:4,to:6,title:"溪橋接力",tip:"蝙蝠怕冰，冰霜狼怕火，小鬼怕雷；讓兩岸接手。"},{from:7,to:9,title:"東岸厚甲",tip:"毒霧穿盾，塔火力先拆裂鏡，再補技能。"},{from:10,to:12,title:"石壇決戰",tip:"先處理護衛與醫官，再把主力設為 Boss 優先。"}],
   waves:[wave("林口小隊",[["slime",4],["goblin",2]]),wave("斥候探路",[["slime",4],["goblin",3]]),wave("群翼先鋒",[["goblin",4],["slime",3],["bat",1]]),wave("冰狼過橋",[["bat",4],["goblin",4],["frostwolf",2]]),wave("魔王試橋",[["bat",3],["slime",2],["frostwolf",2]]),wave("三系接力",[["bat",4],["frostwolf",3],["imp",3]]),wave("盾隊登岸",[["frostwolf",4],["shieldman",3],["bat",3]]),wave("醫官護行",[["shieldman",4],["medic",2],["goblin",5]]),wave("拆鏡留火",[["mirrorling",2],["shieldman",4],["frostwolf",4],["bat",2]]),wave("夜叉先陣",[["frostwraith",3],["shieldman",3],["bat",2]]),wave("尾線疾奔",[["abysshound",4],["frostwolf",4],["silencer",2],["goblin",3]]),wave("溪橋守望終戰",[["frostwolf",3],["shieldman",3],["medic",1],["abysshound",2]])]},
  canyon:{id:"canyon",mapId:"canyon",title:"裂谷封鎖",finalWave:12,brief:"西口迎盾，東岸拆醫官與噤聲，最後守住崖腳長尾線。",finale:{type:"boss",name:"裂谷魔王",hpMul:.58},
   phases:[{from:1,to:3,title:"西口迎盾",tip:"盾兵比經典模式早到，先留穿盾或範圍火力。"},{from:4,to:6,title:"醫官護隊",tip:"不要讓醫官拖長交戰；毒霧與穿透能拆護衛。"},{from:7,to:9,title:"東岸噤聲",tip:"分散主力，先拆噤聲與守門光環。"},{from:10,to:12,title:"封住裂谷",tip:"下橋後還有尾線，主力升級與 Boss 集火都要留。"}],
   waves:[wave("西口前哨",[["slime",4],["goblin",2]]),wave("重步上坡",[["slime",3],["orc",2],["goblin",2]]),wave("盾隊上橋",[["shieldman",2],["slime",3],["goblin",3]]),wave("護衛醫官",[["shieldman",2],["orc",2],["medic",1],["goblin",2]]),wave("魔王破口",[["shieldman",2],["orc",2],["medic",1]]),wave("厚甲接續",[["shieldman",3],["orc",2],["medic",2]]),wave("噤聲過橋",[["silencer",2],["shieldman",3],["goblin",3]]),wave("醫官噤聲陣",[["medic",2],["silencer",2],["shieldman",4]]),wave("守門護陣",[["warden",1],["shieldman",4],["orc",3]]),wave("夜叉壓橋",[["warden",1],["shieldman",3],["medic",1]]),wave("下橋封鎖",[["warden",1],["silencer",2],["shieldman",4],["goblin",4]]),wave("裂谷封鎖終戰",[["warden",1],["shieldman",3],["medic",1],["goblin",3]])]},
  lava:{id:"lava",mapId:"lava",title:"熔心封印",finalWave:12,brief:"從右上裂口開始迎火，島台換元素拆熔甲，最後封住南岸黑曜壇。",finale:{type:"boss",name:"熔核魔王",hpMul:.60},
   phases:[{from:1,to:3,title:"裂口迎火",tip:"小鬼與焰蝠提早到，雷系輸出與寒冰控速各有用處。"},{from:4,to:6,title:"島台熔甲",tip:"熔岩魔像會回盾，持續壓制或毒霧咬本體。"},{from:7,to:9,title:"冰火換陣",tip:"冰魄妖與火系混行，兩種克制火力要交替接手。"},{from:10,to:12,title:"熔心封印",tip:"先拆裂鏡與噤聲，再用技能和主力處理終戰。"}],
   waves:[wave("裂口斥候",[["goblin",3],["slime",3]]),wave("小鬼先行",[["imp",3],["slime",3],["goblin",1]]),wave("餘燼分裂",[["emberbat",3],["imp",3],["goblin",2]]),wave("火潮護盾",[["imp",4],["emberbat",3],["shieldman",1]]),wave("魔王探壇",[["imp",3],["emberbat",2],["shieldman",1]]),wave("熔甲登島",[["lavagolem",2],["imp",3],["emberbat",3]]),wave("冰火換陣",[["frostwraith",3],["lavagolem",2],["imp",3]]),wave("雷刃與焰翼",[["thunderronin",3],["emberbat",4],["imp",3]]),wave("熔鏡護衛",[["lavagolem",3],["thunderronin",3],["mirrorling",2],["imp",2]]),wave("夜叉踏火",[["lavagolem",2],["thunderronin",2],["emberbat",3]]),wave("拆鏡封聲",[["silencer",2],["mirrorling",3],["emberbat",4],["imp",3]]),wave("熔心封印終戰",[["lavagolem",2],["thunderronin",2],["mirrorling",2],["emberbat",3]])]},
 };
 function freezeData(value){if(value&&typeof value==="object"){Object.values(value).forEach(freezeData);Object.freeze(value);}return value;}
 freezeData(MISSIONS);freezeData(RELICS);freezeData(CONTRACTS);
 function getMission(mapId){return own(MISSIONS,mapId)?clone(MISSIONS[mapId]):null;}
 function getRelic(id){return own(RELICS,id)?clone(RELICS[id]):null;}
 function getContract(id){return own(CONTRACTS,id)?clone(CONTRACTS[id]):null;}
 function createRun(options){const input=options||{},mode=input.mode==="expedition"?"expedition":"classic",mapId=own(MISSIONS,input.mapId)?input.mapId:"plains";return {mode,missionId:mode==="expedition"?mapId:null,finalWave:mode==="expedition"?12:null,runSeed:(integer(input.runSeed)>>>0)||1,relics:[],draft:null,selectedContract:null,activeContract:null,contractClaims:{},completed:false,startedWave:0,clearedWave:0,finishedWaves:{},draftClaims:{}};}
 const expedition=run=>!!run&&run.mode==="expedition"&&own(MISSIONS,run.missionId);
 function copy(run){return clone(run||createRun());}
 function modifiers(run){
  const result={physicalPierceBonus:0,cannonSplashMul:1,frostDurationMul:1,thunderVsSlowMul:1,poisonDpsMul:1,skillCooldownMul:1,upgradeCostMul:1,killGoldBonus:0,healBetween:0,firstLeakWardPerWave:0,heroDamageMul:1,heroSpeedMul:1,skillBan:false};
  if(!expedition(run))return result;
  for(const id of new Set(Array.isArray(run.relics)?run.relics:[]))if(own(RELICS,id))Object.assign(result,RELICS[id].effect);
  result.skillBan=run.activeContract==="skillBan"&&!run.completed&&run.startedWave>run.clearedWave;
  return result;
 }
 function offerDraft(run,clearedWave){
  const next=copy(run),wave=integer(clearedWave);
  if(!expedition(next)||next.completed||next.draft||![3,6,9].includes(wave)||next.draftClaims&&next.draftClaims[wave])return next;
  const pool=Object.keys(RELICS).filter(id=>!(next.relics||[]).includes(id));
  let seed=((integer(next.runSeed)||1)^Math.imul(wave,2654435761))>>>0;
  const roll=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let index=pool.length-1;index>0;index--){const target=roll()%(index+1);[pool[index],pool[target]]=[pool[target],pool[index]];}
  const ids=pool.slice(0,3);next.draft={wave,ids:ids.slice(),cards:ids.slice(),offers:ids.map(id=>getRelic(id))};return next;
 }
 function validDraft(run){return expedition(run)&&!run.completed&&run.draft&&[3,6,9].includes(run.draft.wave)&&Array.isArray(run.draft.ids)&&run.draft.ids.length===3&&new Set(run.draft.ids).size===3&&run.draft.ids.every(id=>own(RELICS,id));}
 function chooseRelic(run,id){if(!validDraft(run)||!own(RELICS,id)||!run.draft.ids.includes(id)||!Array.isArray(run.relics)||run.relics.includes(id))return false;const next=copy(run);next.relics.push(id);next.draftClaims=next.draftClaims||{};next.draftClaims[next.draft.wave]=id;next.draft=null;return next;}
 function skipDraft(run){if(!validDraft(run))return false;const next=copy(run);next.draftClaims=next.draftClaims||{};next.draftClaims[next.draft.wave]="skip";next.draft=null;return next;}
 function selectContract(run,id){if(!expedition(run)||run.completed||run.startedWave>run.clearedWave||id!==null&&!own(CONTRACTS,id))return false;const next=copy(run);next.selectedContract=id;return next;}
 function beginWave(run,waveInput){const next=copy(run),wave=integer(waveInput);if(!expedition(next))return next;if(next.completed||next.draft||wave<1||wave>12||wave!==next.clearedWave+1||next.startedWave>next.clearedWave)return false;next.startedWave=wave;next.activeContract=own(CONTRACTS,next.selectedContract)?next.selectedContract:null;next.selectedContract=null;return next;}
 function finishWave(run,waveInput){
  let next=copy(run);const wave=integer(waveInput),result={run:next,goldBonus:0,heal:0};
  if(!expedition(next)||next.completed||wave<1||wave>12||wave!==next.startedWave||wave<=next.clearedWave||next.finishedWaves&&next.finishedWaves[wave])return result;
  next.finishedWaves=next.finishedWaves||{};next.finishedWaves[wave]=true;next.clearedWave=wave;
  const active=own(CONTRACTS,next.activeContract)?CONTRACTS[next.activeContract]:null;
  if(active){const key=`${wave}:${active.id}`;next.contractClaims=next.contractClaims||{};if(!next.contractClaims[key]){next.contractClaims[key]=true;result.goldBonus=active.gold;}}
  result.heal=modifiers(next).healBetween;next.activeContract=null;next.selectedContract=null;
  if(wave===12){next.completed=true;next.draft=null;}else next=offerDraft(next,wave);
  result.run=next;return result;
 }
 function planWave(basePlan,context){
  const input=context||{},run=input.run,base=clone(basePlan||{}),wave=integer(input.wave||base.wave);
  if(!expedition(run))return base;
  const mission=MISSIONS[run.missionId];
  if(run.completed||wave<1||wave>12)return Object.assign(base,{wave,count:0,totalCount:0,isBoss:false,event:null,queue:[],missionId:mission.id,expedition:true,finale:false,phase:null,waveLabel:"遠征已結束",contract:null});
  const normalScale=wave<=10?Math.pow(1+cfg.GAME.hpGrowthEarly,wave-1):Math.pow(1+cfg.GAME.hpGrowthEarly,9)*Math.pow(1+cfg.GAME.hpGrowthLate,wave-10);
  const suppliedScale=number(base.hpScale,normalScale);
  const authored=mission.waves[wave-1],phase=mission.phases.find(phase=>wave>=phase.from&&wave<=phase.to),scale=suppliedScale>0?suppliedScale:normalScale;
  const queue=[];for(const [type,count] of authored.groups)for(let index=0;index<count;index++)queue.push({type,hpScale:scale,event:null,affix:base.affix&&base.affix.id||null});
  const baseBosses=[5,10].includes(wave)?(Array.isArray(base.queue)?base.queue:[]).filter(spec=>own(cfg.ENEMIES,spec.type)&&cfg.ENEMIES[spec.type].boss).map(clone):[];
  // Expeditions keep their fixed 5/10 checkpoints even if the caller's base
  // difficulty uses a different Boss period. Supplied checkpoint specs win.
  if([5,10].includes(wave)&&!baseBosses.length)baseBosses.push({type:wave===5?"boss":"yaksha",hpScale:scale*cfg.GAME.bossHpMul*(wave===10?1.1:1),speedMul:wave===5?number(cfg.DIFFICULTIES.normal.firstBossSpeedMul,1):1,rewardMul:wave===5?number(cfg.DIFFICULTIES.normal.firstBossRewardMul,1):1,event:null,affix:base.affix&&base.affix.id||null});
  queue.push(...baseBosses);
  if(wave===12)queue.push({type:mission.finale.type,hpScale:scale*mission.finale.hpMul,nameOverride:mission.finale.name,role:"expedition-finale",event:null,affix:base.affix&&base.affix.id||null});
  const contractId=wave===run.startedWave?run.activeContract:run.selectedContract,contract=own(CONTRACTS,contractId)?CONTRACTS[contractId]:null;
  if(contract&&contract.id==="rush")for(const spec of queue)spec.speedMul=number(spec.speedMul,1)*1.2;
  if(contract&&contract.id==="reinforcements"){const count=wave<=6?2:3,pool=authored.groups.map(group=>group[0]);for(let index=0;index<count;index++)queue.unshift({type:pool[(wave+index)%pool.length],hpScale:scale,event:null,role:"expedition-reinforcement",affix:base.affix&&base.affix.id||null});}
  return Object.assign(base,{wave,count:queue.filter(spec=>!cfg.ENEMIES[spec.type].boss).length,totalCount:queue.length,isBoss:baseBosses.length>0||wave===12,event:null,theme:null,queue,missionId:mission.id,expedition:true,finale:wave===12,phase:clone(phase),waveLabel:authored.label,contract:contract?contract.id:null});
 }
 return {MISSIONS,RELICS,CONTRACTS,createRun,getMission,getRelic,getContract,planWave,offerDraft,chooseRelic,skipDraft,selectContract,chooseContract:selectContract,beginWave,finishWave,modifiers,getModifiers:modifiers,isDraftPending:run=>!!(expedition(run)&&run.draft)};
});
