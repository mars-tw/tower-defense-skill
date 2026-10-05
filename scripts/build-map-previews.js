/* R80 previews are snapshots of the shipped painter and shared MAPS geometry. */
"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto");
const {chromium}=require("playwright");
const ROOT=path.resolve(__dirname,".."), {MAPS}=require("../src/config");
(async()=>{
 const browser=await chromium.launch();
 try {
  const page=await browser.newPage({viewport:{width:960,height:640}});
  await page.setContent('<html><body style="margin:0"><canvas id="board" width="960" height="640"></canvas></body></html>');
  for(const file of ["config.js","rules.js","map-art.js"]) await page.addScriptTag({content:fs.readFileSync(path.join(ROOT,"src",file),"utf8")});
  const manifest={method:"Native Canvas snapshot of TDMapArt.paintBoard + shared rules + MAPS; no units/debug counters",runtimeAssets:[]};
  for(const map of Object.values(MAPS)) {
   const input=`assets/maps/r80/${map.id}-terrain.webp`, output=`assets/maps/r80/${map.id}-preview.webp`;
   const result=await page.evaluate(async({map,data,bridgeData})=>{
    const image=new Image();image.src=data;await image.decode();
    const bridgeSprite=new Image();bridgeSprite.src=bridgeData;await bridgeSprite.decode();
    const canvas=document.getElementById('board'),ctx=canvas.getContext('2d');ctx.clearRect(0,0,960,640);
    TDMapArt.paintBoard(ctx,map,{plate:image,bridgeSprite,width:960,height:640,isBuildable:(x,y)=>!TDRules.mapBuildRestriction(map,x,y,48).blocked});
    TDMapArt.paintGuide(ctx,map,{cssScale:1});
    return {png:canvas.toDataURL('image/png').split(',')[1],webp:canvas.toDataURL('image/webp',.94).split(',')[1]};
   },{map,data:'data:image/webp;base64,'+fs.readFileSync(path.join(ROOT,input)).toString('base64'),bridgeData:'data:image/webp;base64,'+fs.readFileSync(path.join(ROOT,'assets/maps/r80/stone-bridge.webp')).toString('base64')});
   fs.writeFileSync(path.join(ROOT,output),Buffer.from(result.webp,'base64'));
   fs.writeFileSync(path.join(ROOT,`docs/evidence/R80/${map.id}-composed.png`),Buffer.from(result.png,'base64'));
   const bytes=fs.readFileSync(path.join(ROOT,output)),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
   manifest.runtimeAssets.push({mapId:map.id,input,path:output,width:960,height:640,bytes:bytes.length,sha256});
   console.log(`${map.id}: ${bytes.length} bytes ${sha256.slice(0,8)}`);
  }
  fs.writeFileSync(path.join(ROOT,'docs/evidence/R80/preview-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
