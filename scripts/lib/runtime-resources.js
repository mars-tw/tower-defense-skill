/* Runtime resources are derived from shipped references and data contracts.
 * Retained art originals, revisions and unused PNGs are not offline inputs.
 */
"use strict";
const fs=require("fs"),path=require("path");
function normalizeResourcePath(value){return String(value||"").trim().replace(/\\/g,"/").replace(/^\.?\//,"").replace(/[?#].*$/,"");}
function local(value){return value&&!/^(?:[a-z]+:|#|\/\/)/i.test(value);}
function collectLocalIndexResources(text){const set=new Set(["index.html"]);for(const m of String(text).matchAll(/\b(?:src|href)=["']([^"']+)["']/g))if(local(m[1]))set.add(normalizeResourcePath(m[1]));return set;}
function addAsset(set,value){if(typeof value==="string"&&/^assets\//.test(value))set.add(normalizeResourcePath(value));else if(Array.isArray(value))value.forEach(v=>addAsset(set,v));else if(value&&typeof value==="object")Object.values(value).forEach(v=>addAsset(set,v));}
function collectRuntimeResources(root,options={}){
  const index=options.indexText==null?fs.readFileSync(path.join(root,"index.html"),"utf8"):options.indexText;
  const set=collectLocalIndexResources(index),sources=[...set].filter(p=>/\.(?:js|css)$/.test(p));
  const cfg=require(path.join(root,"src/config.js")),heroes=require(path.join(root,"src/heroes.js"));
  for(const[group,defs]of[["towers",cfg.TOWERS],["enemies",cfg.ENEMIES],["skills",cfg.SKILLS]])for(const def of Object.values(defs)){
    // The renderer/UI have documented id-based fallback/icon families.
    set.add(`assets/${group}/${def.id}.png`);
    for(const key of["sprite","sprites","portrait","icon"])addAsset(set,def[key]);
  }
  for(const def of Object.values(heroes.HEROES))for(const key of["sprite","sprites","portrait","icon"])addAsset(set,def[key]);
  for(const filename of sources){
    const code=fs.readFileSync(path.join(root,filename),"utf8").replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"");
    // Literal FX, animation atlas, map-art and selector references.
    for(const m of code.matchAll(/["'`](assets\/[A-Za-z0-9_./-]+\.(?:png|webp|jpe?g|svg)(?:\?[^"'`]*)?)["'`]/g))addAsset(set,m[1]);
    // Projectile image paths are composed from these production dictionaries.
    for(const block of code.matchAll(/const\s+PROJECTILE_BY_(?:TOWER|ELEMENT)\s*=\s*\{([\s\S]*?)\};/g))for(const m of block[1].matchAll(/:\s*["']([A-Za-z0-9_-]+)["']/g))set.add(`assets/projectiles/${m[1]}.png`);
  }
  const manifest=JSON.parse(fs.readFileSync(path.join(root,"manifest.webmanifest"),"utf8"));
  for(const icon of manifest.icons||[])addAsset(set,icon.src);
  return{resources:[...set].sort(),sourceFiles:sources.sort()};
}
module.exports={normalizeResourcePath,collectLocalIndexResources,collectRuntimeResources};
