const path = require("path");
const art = require(path.join(__dirname, "..", "art-config.json"));
const config = require(path.join(__dirname, "..", "src", "config.js"));
const heroes = require(path.join(__dirname, "..", "src", "heroes.js"));

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("  OK " + msg);
  else { console.error("  FAIL " + msg); failed++; }
}

function ids(group) {
  return ((art.groups && art.groups[group]) || []).map((item) => item.id).sort();
}

function same(actual, expected, label) {
  const a = actual.slice().sort();
  const e = expected.slice().sort();
  assert(JSON.stringify(a) === JSON.stringify(e), `${label}: ${a.length}/${e.length} ids match`);
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    console.error("    actual:   " + a.join(", "));
    console.error("    expected: " + e.join(", "));
  }
}

console.log("== art-config sync ==");
assert(art.outputDir === "assets", "outputDir targets assets");
assert(String(art.styleSuffix || "").toLowerCase().includes("transparent background"), "styleSuffix requests transparent background");
same(ids("towers"), Object.keys(config.TOWERS), "towers");
same(ids("enemies"), Object.keys(config.ENEMIES), "enemies");
same(ids("heroes"), Object.keys(heroes.HEROES), "heroes");
same(ids("maps"), Object.keys(config.MAPS), "maps");
assert(ids("towers").length === 10, "10 tower prompts");
assert(ids("enemies").length === 18, "18 enemy prompts");
assert(ids("heroes").length === 15, "15 hero prompts");
assert(ids("maps").length === 3, "3 map prompts");

if (failed) {
  console.error(`${failed} art-config sync checks failed`);
  process.exit(1);
}
console.log("art-config sync OK");
