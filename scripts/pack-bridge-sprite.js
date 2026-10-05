/* Alpha-bound crop + resize/encode only. Preserve the generated PNG master. */
"use strict";
const fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..');
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),input='assets/maps/r80/stone-bridge-master.png';
 const result=await page.evaluate(async(data)=>{
  const image=new Image();image.src=data;await image.decode();const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;
  const ctx=source.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,source.width,source.height).data;
  let left=source.width,top=source.height,right=0,bottom=0;
  for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++)if(pixels[(y*source.width+x)*4+3]>12){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  if(right<=left||bottom<=top)throw new Error('No nontransparent sprite');
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=Math.round(512*(bottom-top+1)/(right-left+1));canvas.getContext('2d').drawImage(image,left,top,right-left+1,bottom-top+1,0,0,canvas.width,canvas.height);
  return{crop:{left,top,right,bottom},width:canvas.width,height:canvas.height,data:canvas.toDataURL('image/webp',.96).split(',')[1]};
 },'data:image/png;base64,'+fs.readFileSync(path.join(ROOT,input)).toString('base64'));
 fs.writeFileSync(path.join(ROOT,'assets/maps/r80/stone-bridge.webp'),Buffer.from(result.data,'base64'));delete result.data;fs.writeFileSync(path.join(ROOT,'docs/evidence/R80/art/bridge-packaging.json'),JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
