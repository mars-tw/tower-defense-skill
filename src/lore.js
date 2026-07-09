/* =========================================================================
 * lore.js — 《神魔誌》敘事資料層
 * 純資料與純函式；不碰 DOM、時間或隨機。UI 端負責注入 meta/state。
 * ========================================================================= */

const WORLD_LORE = {
  title: "神魔誌·序",
  body: [
    "天樞崩裂那一夜，群星像被斬斷的鎖鏈墜入裂界。諸方神魔失去原本的天命，有的化作妖潮，有的只剩殘名，在黑暗中尋找還能被記住的理由。",
    "最後一界將滅時，女神以最後神火點亮聖壇。妖魔逐波湧出，只為吞噬那一點火光；神火若滅，山河、魂魄與所有曾被守護之物，都將歸於虛無。",
    "女神以魂晶為引，召喚墜落神魔英靈締約。這不是命令，也不是赦免，而是讓他們重新選擇：在裂界之前，究竟還有什麼值得自己拔刀守護。"
  ],
};

const CAMPAIGN_CHAPTERS = [
  {
    id: "awakening-altar",
    title: "I〈覺醒之壇〉",
    epithet: "神火初燃",
    oracle: "醒來吧，我的英靈。天樞已裂，而你們，是我最後的祈禱。",
    body: "聖壇在荒草間亮起第一縷神火。那些曾被封神榜、史書與民間傳說撕裂的名字，被魂晶牽回同一條防線。",
    unlock: { type: "start", value: 0 },
  },
  {
    id: "first-rift",
    title: "II〈裂界初潮〉",
    epithet: "妖影聞火",
    oracle: "牠們不是為殺戮而來，而是為了讓世上再也沒有光。",
    body: "第一波妖影踏出裂縫時，連風都變得腥冷。女神明白，這不會是一場戰役，而是一段無盡守望的開端。",
    unlock: { type: "wave", value: 1 },
  },
  {
    id: "demon-gate",
    title: "III〈魔門啟封〉",
    epithet: "群魔識路",
    oracle: "守住第五道潮聲。若魔門記住聖壇的位置，黑夜便會學會回來。",
    body: "第五波後，裂界不再只是傷口，而像一扇被人從內側推開的門。群魔開始辨認塔陣、試探弱點，也試探英靈的心。",
    unlock: { type: "wave", value: 5 },
  },
  {
    id: "first-boss",
    title: "IV〈王影墜壇〉",
    epithet: "首尊魔王",
    oracle: "擊倒牠。讓深淵知道，神火不是無主之燭。",
    body: "第一尊魔王倒下時，聖壇四周短暫安靜。女神卻聽見更深處的回音：真正注視這裡的存在，才剛剛睜眼。",
    unlock: { type: "boss", value: 1 },
  },
  {
    id: "ashen-oath",
    title: "V〈灰誓之軍〉",
    epithet: "英靈成陣",
    oracle: "你們不是被過去審判的人。此刻，你們是彼此的盾。",
    body: "第十五波的灰雨落下，英靈們開始習慣並肩。妖狐的火不再只為復仇，魔將的刀也第一次為城牆以外的人而落。",
    unlock: { type: "wave", value: 15 },
  },
  {
    id: "starless-front",
    title: "VI〈無星前線〉",
    epithet: "天樞沉默",
    oracle: "若星空不再回答，就讓我們成為彼此的方向。",
    body: "第二十五波後，天上再無星象可循。每一座塔、每一次施法、每一名英靈的羈絆，都成了裂界中能被看見的路標。",
    unlock: { type: "wave", value: 25 },
  },
  {
    id: "last-flame",
    title: "VII〈最後神火〉",
    epithet: "裂界未終",
    oracle: "四十波只是門檻，不是終局。只要你仍願守，神火便仍稱得上世界。",
    body: "第四十波的盡頭，裂界沒有關閉，卻也沒有吞沒聖壇。女神終於明白，所謂最後一界，指的不是疆土，而是仍肯選擇守護的心。",
    unlock: { type: "wave", value: 40 },
  },
];

const HERO_LEGENDS = {
  knight: {
    epithet: "誓盾聖騎",
    stages: [
      { bond: 1, title: "序·破盾", text: "他曾是某座小城最後的門閂。城破那日，他把盾插在橋頭，讓孩子們從他背後逃走。" },
      { bond: 5, title: "承·守誓", text: "聖壇的光讓他想起城門上的晨曦。這一次，他不只守一座城，而是守所有還能回家的路。" },
      { bond: 10, title: "轉·同行", text: "他學會把盾交給同伴，也學會在疲憊時接受治療。誓言不是一個人扛到底，而是不讓任何人孤身倒下。" },
      { bond: 15, title: "合·不退", text: "裂界前，他仍站在最前方。盔甲上滿是傷痕，卻沒有一道能讓他的腳步後退。" },
    ],
  },
  archer: {
    epithet: "逐風遊俠",
    stages: [
      { bond: 1, title: "序·離林", text: "遊俠離開森林時，只帶走一把舊弓。他說自己不屬於任何王旗，只屬於仍需要風聲預警的人。" },
      { bond: 5, title: "承·聽風", text: "他能在妖潮未現前聽見草葉倒伏。每一次放箭，都是替同伴爭回一口呼吸。" },
      { bond: 10, title: "轉·定弦", text: "聖壇讓他明白，自由不是永遠遠走，而是能選擇在哪裡停下，為誰拉滿弓弦。" },
      { bond: 15, title: "合·歸路", text: "當裂界風暴吹亂方向，他的箭仍指向回家的路。那是遊俠第一次承認，自己也有了歸處。" },
    ],
  },
  mage: {
    epithet: "燼頁大法師",
    stages: [
      { bond: 1, title: "序·焚書", text: "大法師曾為了阻止禁咒外流，親手燒掉半座圖書塔。火光中，他記住了知識也會傷人。" },
      { bond: 5, title: "承·控焰", text: "他在聖壇前重新翻開燼頁，把每一道火紋刻成守護的界線，而非炫耀力量的符號。" },
      { bond: 10, title: "轉·留白", text: "真正困難的咒語不是爆裂，而是克制。他開始在法陣中留下空白，讓同伴的節奏能一起呼吸。" },
      { bond: 15, title: "合·明燈", text: "如今他的火不再吞噬書頁，而照亮書頁。裂界越黑，他的咒文越像一盞不肯熄的燈。" },
    ],
  },
  iceMage: {
    epithet: "霜心法師",
    stages: [
      { bond: 1, title: "序·封河", text: "她曾冰封一整條河，只為阻止瘟疫渡岸。被救的人活了下來，卻再也不敢靠近她。" },
      { bond: 5, title: "承·慢息", text: "在聖壇，她第一次聽見有人感謝寒霜。減速妖潮的冰面，也讓受傷的同伴有時間站起。" },
      { bond: 10, title: "轉·融雪", text: "她明白冷不是拒絕，而是保留。每一片霜都在替世界爭取下一次春天。" },
      { bond: 15, title: "合·清晨", text: "她的法杖落下時，裂界風雪靜止。冰層下有光流動，那是她守到最後的清晨。" },
    ],
  },
  valkyrie: {
    epithet: "雷翼女武神",
    stages: [
      { bond: 1, title: "序·墜翼", text: "女武神墜落時，戰場早已沒有號角。她握著折斷的長槍，仍想把亡者帶回應許之地。" },
      { bond: 5, title: "承·再臨", text: "神火照亮她的羽翼殘痕。她不再只挑選勇者，而是為還沒準備好赴死的人擋下雷霆。" },
      { bond: 10, title: "轉·改命", text: "她曾相信命運寫在戰死之刻，如今卻看見命運也能寫在被救下的明天。" },
      { bond: 15, title: "合·鳴槍", text: "雷翼重展時，她不再尋找英魂歸處。她已把聖壇視為新的英靈殿。" },
    ],
  },
  cleric: {
    epithet: "微光牧師",
    stages: [
      { bond: 1, title: "序·殘燭", text: "牧師的神殿沒有奇蹟，只有一盞快滅的燭。他仍每天替陌生人祈禱，像世界會聽見一樣。" },
      { bond: 5, title: "承·回聲", text: "女神回應了他的祈禱，也讓他明白治療不是否認傷口，而是陪人撐過最痛的那一刻。" },
      { bond: 10, title: "轉·同禱", text: "他開始為妖潮中迷失的魂也低聲祈禱。聖光不替罪辯解，卻願意照見歸路。" },
      { bond: 15, title: "合·晨鐘", text: "戰火裡，他的鐘聲不大，卻足以讓前線知道自己還活著，也還值得被溫柔對待。" },
    ],
  },
  daji: {
    epithet: "九尾妖狐",
    stages: [
      { bond: 1, title: "序·九尾妖狐", text: "有蘇氏的女兒本無罪。是那雙從畫軸裡爬出的眼睛，先看上了她的皮囊。她記得最後一個屬於自己的清晨，露水還掛在窗紙上。" },
      { bond: 5, title: "承·焚心", text: "摘星樓的火燒了七日七夜。人們都說妖狐禍國，卻沒人問——是誰先把她鎖進了那座宮，逼她用笑吞下哭聲。" },
      { bond: 10, title: "轉·契約", text: "女神在灰燼裡撿起她。「妳的火，能燒宮闕，也能護一座壇。」妲己第一次，為自己選了要燒的東西。" },
      { bond: 15, title: "合·護焰", text: "如今妖焰只朝深淵綻放。她仍會笑，笑裡卻多了一分，連封神榜都沒寫進、也無人敢相信的溫柔。" },
    ],
  },
  guanyu: {
    epithet: "赤面魔關羽",
    stages: [
      { bond: 1, title: "序·赤刃", text: "他曾以忠義聞名，也曾在魔氣裡醒來。青龍刀仍認得他的手，卻不再認得他胸口翻湧的黑血。" },
      { bond: 5, title: "承·失義", text: "被稱作魔關羽後，最痛的不是世人懼他，而是他自己也怕有一天會忘記何謂義，忘記桃園風聲。" },
      { bond: 10, title: "轉·聖壇", text: "女神沒有替他洗去魔血，只問他刀要指向何處。他沉默良久，將刀鋒轉向裂界，像重立一次誓。" },
      { bond: 15, title: "合·義火", text: "赤刃落下，魔氣與忠魂同燃。他終於明白，義不是不曾墜落，而是墜落後仍願守約，仍肯回身護人。" },
    ],
  },
  wukong: {
    epithet: "鬥戰行者",
    stages: [
      { bond: 1, title: "序·金箍", text: "五行山碎後，他以為天地再無可壓之物。直到天樞崩裂，他才聽見萬界都在石縫裡喊痛，像當年的自己。" },
      { bond: 5, title: "承·不馴", text: "他仍討厭被稱作英雄。可每當妖潮逼近聖壇，那根金箍棒總比他的抱怨更早落下，也更誠實。" },
      { bond: 10, title: "轉·回首", text: "女神問他是否還想回花果山。他看著神火，想起滿山猴子，也想起自己曾經守不住的家，心口忽然發沉。" },
      { bond: 15, title: "合·齊天", text: "如今他再喊齊天，不是要與天爭高，而是告訴裂界：只要俺老孫在，這盞火就低不了頭，也不許孤單。" },
    ],
  },
  nezha: {
    epithet: "蓮火少年",
    stages: [
      { bond: 1, title: "序·剔骨", text: "哪吒早把命還過一次。蓮藕重塑的身體輕得像風，心裡卻藏著比海更重的歉意與少年倔強。" },
      { bond: 5, title: "承·風火", text: "風火輪在聖壇外劃出光痕。他衝得最快，因為他太懂晚一步會留下多少無法彌補，多少人再也喊不回。" },
      { bond: 10, title: "轉·不欠", text: "女神告訴他，守護不是贖罪的算盤。他第一次停下槍尖，學著把自己也算進被守護的人裡。" },
      { bond: 15, title: "合·蓮心", text: "火尖槍燃起時，蓮心不再疼痛。少年仍倔，卻終於能在勝利後笑得像個孩子，不必再急著證明清白。" },
    ],
  },
  leizhenzi: {
    epithet: "雷翼天將",
    stages: [
      { bond: 1, title: "序·雷翼", text: "雷震子生來便像一道天罰。人人仰望他的翼，卻少有人記得他也曾只是想回家的孩子，怕雷聲太近。" },
      { bond: 5, title: "承·震野", text: "裂界雲層壓低時，他振翼引雷。每一道電光，都替地上的人照見下一步，也替自己照見落腳處。" },
      { bond: 10, title: "轉·人聲", text: "他不再只聽天命，也開始聽見塔下士兵的喘息。那聲音比雷更能指引他落點，讓他懂得收力。" },
      { bond: 15, title: "合·破雲", text: "當他撕開黑雲，神火映上羽翼。雷聲不再像懲罰，而像遠方終於傳來的回信，說他可以留下。" },
    ],
  },
  niumowang: {
    epithet: "平天牛魔",
    stages: [
      { bond: 1, title: "序·平天", text: "牛魔王曾說要平天，說得山岳都發抖。可鐵扇遠去、兄弟離散後，王座只剩冷風與沒說出口的悔。" },
      { bond: 5, title: "承·怒斧", text: "他不擅長溫柔，只會把靠近聖壇的妖魔劈回深淵。女神卻看出，那怒火裡藏著怕再失去的心。" },
      { bond: 10, title: "轉·低首", text: "第一次向同伴低頭時，他比打敗魔王還不自在。可他也第一次發現，有人並不怕他的沉默。" },
      { bond: 15, title: "合·護山", text: "巨斧砸落，裂界震顫。他仍是牛魔王，只是如今他的山，不再只容得下一個孤獨的王，也容得下歸人。" },
    ],
  },
  baisuzhen: {
    epithet: "白蛇靈醫",
    stages: [
      { bond: 1, title: "序·斷橋", text: "白素貞記得斷橋雨聲，也記得塔影覆下時，世人把深情與妖名一起鎖進傳說，連辯解都嫌多餘。" },
      { bond: 5, title: "承·青霜", text: "她在聖壇前佈下青白寒陣。每一次霜落，都像替那些被誤解的愛，爭一點清白，也爭一口呼吸。" },
      { bond: 10, title: "轉·不悔", text: "女神問她是否後悔入世。她望向妖潮，輕聲說，若因愛受劫，便更懂為何要守住人間與脆弱心願。" },
      { bond: 15, title: "合·歸水", text: "霜蛇盤過神火而不熄。她終於不再等誰放她出塔，因為她已親手守出一條歸水之路，通往自由。" },
    ],
  },
  erlangshen: {
    epithet: "天眼真君",
    stages: [
      { bond: 1, title: "序·天眼", text: "二郎神的第三隻眼看穿妖魔，也看穿人心。看得太清，反而讓他多年不敢輕信任何溫度與靠近。" },
      { bond: 5, title: "承·哮影", text: "神犬的影子在裂界旁低伏。他一如往昔冷靜出刀，只是這次刀後有人替他守住背脊，不再獨承風雪。" },
      { bond: 10, title: "轉·閉目", text: "女神請他偶爾閉上天眼。不是要他放下警戒，而是讓他知道，信任也能成為一種看見，一種託付。" },
      { bond: 15, title: "合·破邪", text: "天眼開時，萬邪無所遁形；天眼闔時，他仍能聽見同伴的腳步。真君終於不再獨行，也不再只信自己。" },
    ],
  },
  zhongkui: {
    epithet: "封魔判官",
    stages: [
      { bond: 1, title: "序·落榜", text: "鍾馗曾在金榜之外折斷一生。人間只記得他的醜貌與怒目，少有人記得他也曾滿懷光明，想被公平看見。" },
      { bond: 5, title: "承·判筆", text: "他以判筆點名群魔，卻從不輕判凡魂。因為他比誰都懂，被一眼定罪的痛，也懂沉冤最怕無人聽。" },
      { bond: 10, title: "轉·封陣", text: "女神將封魔陣交給他時，他沒有問能否洗去舊恨，只問這一筆，能不能讓神火多亮一刻，讓冤魂少怕一夜。" },
      { bond: 15, title: "合·正名", text: "如今他立於聖壇前，鬼魅退避。鍾馗終於不再只是驅鬼之名，也是裂界中替冤魂守門的人。" },
    ],
  },
};

const ORACLE_WHISPERS = [
  "神火不是不會熄滅，而是有人願意一次次替它添柴。",
  "裂界吞得下城牆，吞不下被守護過的名字。",
  "魂晶會記得每一個墜落者最後的選擇。",
  "妖潮來時，請先聽見同伴的呼吸。",
  "封印不是牢籠；有時，它是替明天留出的門。",
  "被傳說誤解的人，也能在神火前重新署名。",
  "若天命沉默，就用塔陣與刀光回答。",
  "每一道傷口都可能成為下一道光的邊界。",
  "不要只數撐過的波次，也記住誰陪你撐過。",
  "深淵最怕的不是勝利，而是不肯散去的羈絆。",
  "女神的祈禱沒有命令，只有等待你點頭的勇氣。",
  "最後一界仍在，是因為你還沒有放手。",
];

const MAP_LORE = {
  plains: {
    title: "翠綠平原",
    lines: [
      "荒草間仍有舊村落的石井，神火第一次在這裡記住守軍的名字。",
      "風很寬，妖潮也很早被看見；這片平原教會新塔陣如何呼吸。",
    ],
  },
  canyon: {
    title: "迂迴峽谷",
    lines: [
      "峽壁把號角聲切成回音，補給車常在最後一個彎道才抵達聖壇。",
      "路長而曲折，適合埋伏，也適合裂界在陰影裡試探耐心。",
    ],
  },
  lava: {
    title: "熔岩峽道",
    lines: [
      "熔岩不斷翻亮古老礦脈，墜星殘骸仍在谷底慢慢發紅。",
      "這裡的夜晚沒有黑暗，只有火光與妖影互相撕扯。",
    ],
  },
};

const WAVE_BEATS = {
  1: { title: "神火初燃", line: "荒草間，聖壇第一次記住你的名字。" },
  5: { title: "魔門試探", line: "第五道潮聲逼近，裂界學會了回來的路。" },
  10: { title: "灰雨前線", line: "雨裡全是未竟的魂，別讓牠們靠近火。" },
  15: { title: "灰誓成陣", line: "塔影與英靈並肩，聖壇終於不再只靠祈禱。" },
  25: { title: "無星前線", line: "星空沉默時，每座塔都必須成為方向。" },
  40: { title: "最後神火", line: "四十波只是門檻，不是終局；守住，世界才仍有名字。" },
};

const EVENT_FLAVOR = {
  rush: "連風都在逃。",
  elite: "裂界派來少數硬骨頭，專門拖慢你的節奏。",
  swarm: "影子碎成翅聲，成群壓過路面。",
  treasure: "金光混在妖潮裡，貪心與判斷都會被考驗。",
  rift: "裂縫短暫張大，陌生的腳步混入戰線。",
  eclipse: "神火被陰影壓低，請用更長的火線換回報酬。",
  pilgrim: "有人提燈穿過妖潮，護衛不強，金袋卻沉。",
};

const BOSS_INTRO = {
  boss: "魔王低聲笑了：火會熄，名字也會。",
  yaksha: "夜叉王舉刃踏出雷影：讓神火跪下。",
};

function normalizeBondLevel(bondLevel) {
  const n = Math.floor(Number(bondLevel) || 0);
  return n > 0 ? n : 0;
}

function legendStageFor(heroId, bondLevel) {
  const legend = HERO_LEGENDS[heroId];
  if (!legend || !Array.isArray(legend.stages)) return null;
  const level = normalizeBondLevel(bondLevel);
  let unlocked = null;
  for (const stage of legend.stages) {
    if (level >= stage.bond) unlocked = stage;
  }
  return unlocked;
}

function unlockSatisfied(unlock, ctx) {
  const c = ctx || {};
  const wave = Math.max(0, Math.floor(Number(c.bestWave) || 0), Math.floor(Number(c.clearedWave) || 0));
  const bossKills = Math.max(0, Math.floor(Number(c.bossKills) || 0));
  if (!unlock || unlock.type === "start") return true;
  if (unlock.type === "wave") return wave >= Math.max(0, Math.floor(Number(unlock.value) || 0));
  if (unlock.type === "boss") return bossKills >= Math.max(1, Math.floor(Number(unlock.value) || 1));
  return false;
}

function campaignUnlockState(ctx) {
  const out = {};
  for (const chapter of CAMPAIGN_CHAPTERS) out[chapter.id] = unlockSatisfied(chapter.unlock, ctx);
  return out;
}

function normalizeSeenIds(seenIds) {
  if (seenIds instanceof Set) return seenIds;
  if (Array.isArray(seenIds)) return new Set(seenIds);
  if (seenIds && typeof seenIds === "object") return new Set(Object.keys(seenIds).filter((id) => seenIds[id]));
  return new Set();
}

function evaluateCampaignUnlocks(seenIds, ctx) {
  const seen = normalizeSeenIds(seenIds);
  const state = campaignUnlockState(ctx);
  return CAMPAIGN_CHAPTERS
    .filter((chapter) => state[chapter.id] && !seen.has(chapter.id))
    .map((chapter) => chapter.id);
}

function oracleWhisper(index) {
  const len = ORACLE_WHISPERS.length;
  const n = Math.floor(Number(index) || 0);
  return ORACLE_WHISPERS[((n % len) + len) % len];
}

function mapLoreFor(mapId) {
  return MAP_LORE[mapId] || MAP_LORE.plains;
}

function waveBeatFor(wave) {
  const key = Math.max(0, Math.floor(Number(wave) || 0));
  return WAVE_BEATS[key] || null;
}

function eventFlavorFor(eventId) {
  return EVENT_FLAVOR[eventId] || "";
}

function bossIntroFor(type) {
  return BOSS_INTRO[type] || "";
}

const TD_LORE = {
  WORLD_LORE,
  CAMPAIGN_CHAPTERS,
  HERO_LEGENDS,
  ORACLE_WHISPERS,
  MAP_LORE,
  WAVE_BEATS,
  EVENT_FLAVOR,
  BOSS_INTRO,
  legendStageFor,
  campaignUnlockState,
  evaluateCampaignUnlocks,
  oracleWhisper,
  mapLoreFor,
  waveBeatFor,
  eventFlavorFor,
  bossIntroFor,
};

if (typeof window !== "undefined") {
  Object.assign(window, TD_LORE, { TD_LORE });
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = TD_LORE;
}
