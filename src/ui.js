/* =========================================================================
 * ui.js — 塔防 UI/HUD（建塔選單、技能列、升級面板、遊戲結束）
 * 透過 window.TD 接口與 game.js 溝通；game.js 透過 window.__tdUI 等回呼通知 UI 更新。
 * ========================================================================= */

(() => {
  "use strict";
  const { TOWERS, SKILLS, ENEMIES, BEGINNER_MISSIONS, MAP_AFFIXES } = TD.config;
  const $ = (id) => document.getElementById(id);
  const hasOwn = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  const RULES = window.TDRules;
  let selectedBoardDiff = TD.getDifficulty().id;
  let selectedBoardMap = (TD.getMap && TD.getMap().id) || "plains";
  let progressWasPaused = false;
  const TOWER_HOTKEYS = { arrow: "1", cannon: "2", frost: "3", tesla: "4", poison: "5", support: "6" };
  const SKILL_HOTKEYS = { meteor: "Q", freeze: "W", thunder: "E" };
  const TOWER_BY_KEY = Object.fromEntries(Object.entries(TOWER_HOTKEYS).map(([id, key]) => [key, id]));
  const SKILL_BY_KEY = Object.fromEntries(Object.entries(SKILL_HOTKEYS).map(([id, key]) => [key.toLowerCase(), id]));

  // 元素圖示與克制提示（D3 元素克制可見化）
  const ELEM_ICON = { physical: "⚔️", fire: "🔥", ice: "❄️", thunder: "⚡" };
  const ELEM_LABEL = { physical: "物理", fire: "火", ice: "冰", thunder: "雷" };
  const COUNTER_HINT = { fire: "克冰", ice: "克雷", thunder: "克火" };
  function elemChip(el) {
    const hint = COUNTER_HINT[el] ? `·${COUNTER_HINT[el]}` : "";
    return `<span class="elem-chip elem-${el}">${ELEM_ICON[el]}${ELEM_LABEL[el]}${hint}</span>`;
  }
  function enemyTrait(e) {
    if (!e) return "一般敵人";
    const parts = [];
    if (e.boss) parts.push("高血 Boss，漏過會重創女神");
    if (e.ability) parts.push(`${e.ability.label || "特殊能力"}：${e.ability.desc || ""}`);
    if (e.shield) parts.push(`護盾 ${e.shield}，需先破盾`);
    if (e.healRadius) parts.push(`每 ${e.healInterval} 秒治療附近敵人`);
    if (e.speed >= 85) parts.push("高速突進");
    if (e.hp >= 100 && !e.boss) parts.push("高血慢速");
    if (!parts.length) parts.push("標準路徑敵人");
    return parts.join("；");
  }
  function enemySummary(id) {
    const e = ENEMIES[id];
    if (!e) return "";
    return `${e.name}：${ELEM_LABEL[e.element]}系，${enemyTrait(e)}`;
  }

  // ===== 建塔選單（補關鍵數值與元素，D3 資訊透明）=====
  function towerMetaText(t) {
    if (t.support) return `範圍 ${t.range} · 增傷 +${Math.round(t.buff * 100)}%`;
    const extra = t.poisonDps ? ` · 毒 ${t.poisonDps}/秒` : "";
    const control = t.id === "frost" ? " · 控場減速" : "";
    return `傷 ${t.damage} · 程 ${t.range} · 速 ${t.fireRate}/秒${extra}${control}`;
  }
  const towerList = $("towerList");
  Object.values(TOWERS).forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "tower-btn"; btn.dataset.type = t.id;
    if (TOWER_HOTKEYS[t.id]) btn.dataset.hotkey = TOWER_HOTKEYS[t.id];
    const stats = towerMetaText(t);
    const shortcut = TOWER_HOTKEYS[t.id] ? `快捷鍵 ${TOWER_HOTKEYS[t.id]}。` : "";
    btn.title = shortcut + (t.desc || t.name);
    btn.setAttribute("aria-label", `${t.name}：${shortcut}${t.desc || stats}`);
    btn.innerHTML = `
      <span class="ico">${t.emoji}</span>
      <span class="info"><span class="nm">${t.name}</span> ${elemChip(t.element)}<br><span class="meta">${stats}</span></span>
      <span class="cost">${t.cost}</span>`;
    btn.onclick = () => {
      const st = TD.state();
      if (st.selectedTowerType === t.id) { TD.cancelBuild(); }
      else { TD.selectTower(t.id); }
      refreshUI();
    };
    towerList.appendChild(btn);
  });

  // ===== 技能列 =====
  const skillList = $("skillList");
  Object.values(SKILLS).forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "skill-btn"; btn.dataset.skill = s.id;
    if (SKILL_HOTKEYS[s.id]) btn.dataset.hotkey = SKILL_HOTKEYS[s.id];
    const shortcut = SKILL_HOTKEYS[s.id] ? `快捷鍵 ${SKILL_HOTKEYS[s.id]}。` : "";
    btn.title = shortcut + s.desc;
    btn.setAttribute("aria-label", `${s.name}：${shortcut}${s.desc}`);
    btn.innerHTML = `
      <span class="ico">${s.emoji}</span>
      <span class="info"><span class="nm">${s.name}</span><br><span class="meta">${s.desc}</span></span>
      <span class="cdtext" data-cd="${s.id}"></span>`;
    btn.onclick = () => { activateSkill(s.id); };
    skillList.appendChild(btn);
  });

  // ===== 英雄抽卡與名冊 =====
  const HERO_SAVE = "td_heroes_owned_v1";
  let ownedHeroes = loadOwned();            // 擁有的英雄 id 集合
  let deployedThisGame = new Set();          // 本局已上場的英雄

  function loadOwned() {
    try { return new Set(JSON.parse(localStorage.getItem(HERO_SAVE)) || []); } catch { return new Set(); }
  }
  function saveOwned() {
    try { localStorage.setItem(HERO_SAVE, JSON.stringify([...ownedHeroes])); } catch {}
  }

  function isShown(id) {
    const el = $(id);
    return !!el && el.classList.contains("show");
  }

  function isBlockingOverlayOpen() {
    return ["gachaOverlay", "progressOverlay", "overlay", "tutorial", "diffOverlay", "mapOverlay"].some(isShown);
  }

  function isTextEntryTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  function activateSkill(id) {
    const st = TD.state();
    const cd = (st.skillCooldowns && st.skillCooldowns[id]) || 0;
    if (cd > 0) {
      const sk = SKILLS[id];
      pushLog(`${sk ? sk.name : "技能"}冷卻中（${Math.ceil(cd)} 秒）`, "bad");
      refreshUI();
      return false;
    }
    TD.selectSkill(id);
    refreshUI();
    return true;
  }

  function syncPauseButton(paused) {
    $("pauseBtn").textContent = paused ? "▶" : "⏸";
    $("pauseBtn").classList.toggle("paused", paused);
  }

  function restartRun() {
    $("overlay").classList.remove("show");
    TD.newGame();
    deployedThisGame = new Set();
    renderRoster();
    refreshUI();
  }

  // 抽卡花「魂晶」（跨局永久貨幣），不是場內金錢——場內金錢每局重置，
  // 拿它買永久英雄等於重開新局就能無限白嫖。首抽免費讓新玩家先體驗盲盒。
  function gachaCostNow(meta) {
    return (TD.config.GACHA.firstFree && (meta.gachaCount || 0) === 0) ? 0 : TD.config.GACHA.cost;
  }
  function doGacha(options) {
    options = options || {};
    if ($("gachaOverlay").classList.contains("show") || $("progressOverlay").classList.contains("show")) return false;
    const meta = loadMeta();
    const cost = gachaCostNow(meta);
    if (meta.soulCrystal < cost) { pushLog(`魂晶不足（需 ${cost}💎，清波即可獲得）`, "bad"); return false; }
    meta.soulCrystal -= cost;
    const roll = TD.rollHeroWithPityPreferNew
      ? TD.rollHeroWithPityPreferNew(meta.gachaPity || 0, [...ownedHeroes])
      : TD.rollHeroWithPity(meta.gachaPity || 0);
    const { hero, pity } = roll;
    meta.gachaPity = pity;
    meta.gachaCount = (meta.gachaCount || 0) + 1;
    const isNew = !ownedHeroes.has(hero.id);
    let refund = 0;
    if (!isNew) { refund = TD.config.GACHA.dupRefund; meta.soulCrystal += refund; } // 重複補償
    saveMeta(meta);
    ownedHeroes.add(hero.id); saveOwned();
    refreshUI();
    playGachaAnimation(hero, isNew, refund, options);  // 盲盒動畫
    return true;
  }

  // 盲盒開箱動畫：寶箱 → 點擊開啟 → 稀有度光柱 → 英雄登場（動畫期間暫停戰場，敵人不會偷跑）
  function playGachaAnimation(hero, isNew, refund, options) {
    options = options || {};
    const ov = $("gachaOverlay"), chest = $("chest"), reveal = $("reveal");
    const r = TD.config.HERO_RARITY[hero.rarity];
    const wasPaused = TD.state().paused;
    TD.setPaused(true);
    // 重置
    chest.className = "chest"; reveal.className = "reveal";
    $("revealHero").innerHTML = "";
    $("revealName").textContent = "";
    $("revealRarity").textContent = "";
    $("revealOk").textContent = options.doneLabel || "收下";
    ov.classList.add("show");

    chest.onclick = () => {
      chest.classList.add("opening");
      setTimeout(() => {
        chest.classList.add("hidden");
        // 揭示英雄
        ov.style.setProperty("--rev-color", r.color);
        ov.style.setProperty("--rev-glow", r.glow);
        $("revealHero").innerHTML = heroAvatar(hero);
        $("revealName").textContent = hero.name + (isNew ? " ✨新英雄" : refund ? ` （重複 +${refund}💎）` : "");
        $("revealRarity").textContent = "★".repeat(r.stars) + " " + r.label;
        reveal.classList.add("show");
        if (hero.rarity === "legendary" || hero.rarity === "epic") gachaConfetti();
      }, 900);
    };
    $("revealOk").onclick = () => {
      ov.classList.remove("show");
      if (!wasPaused) TD.setPaused(false); // 收下英雄後恢復戰場（原本就手動暫停的除外）
      const r2 = TD.config.HERO_RARITY[hero.rarity];
      pushLog(`🎲 獲得 ${"★".repeat(r2.stars)} ${hero.name}${isNew ? "（新英雄！）" : `（重複，退還 ${refund}💎）`}`);
      renderRoster(); refreshUI();
      if (typeof options.onDone === "function") options.onDone();
    };
  }

  function gachaConfetti() {
    for (let i = 0; i < 30; i++) {
      const c = document.createElement("div");
      c.textContent = ["✨","⭐","💫","🌟","🎉"][i % 5];
      c.style.cssText = `position:fixed;left:50%;top:45%;font-size:26px;pointer-events:none;z-index:120;transition:all 1.3s ease-out;`;
      document.body.appendChild(c);
      requestAnimationFrame(() => {
        const a = (Math.PI*2*i)/30, d = 30+Math.random()*20;
        c.style.left = 50+Math.cos(a)*d+"%"; c.style.top = 45+Math.sin(a)*d+"%"; c.style.opacity = "0";
      });
      setTimeout(() => c.remove(), 1400);
    }
  }

  function heroAvatar(hero) {
    if (!hero.sprite) return hero.emoji;
    return `<img src="${hero.sprite}" alt="${hero.name}" onerror="this.replaceWith(document.createTextNode('${hero.emoji}'))">`;
  }

  function heroProgressFor(id, meta) {
    const progress = meta && meta.heroProgress && meta.heroProgress[id];
    if (!progress) return { xp: 0, level: 1 };
    const xp = Math.max(0, Math.floor(Number(progress.xp) || 0));
    const level = RULES.heroLongLevelFromXp ? RULES.heroLongLevelFromXp(xp) : Math.max(1, Math.floor(Number(progress.level) || 1));
    return { xp, level };
  }

  function heroLongBonus(progress) {
    return RULES.heroPermanentBonus ? RULES.heroPermanentBonus(progress) : 0;
  }

  function heroLongMetaLine(id, meta) {
    const progress = heroProgressFor(id, meta);
    const bonus = heroLongBonus(progress);
    const bonusText = bonus > 0 ? `｜永久 +${Math.round(bonus * 100)}%攻血` : "";
    return `羈絆 Lv.${progress.level}｜${progress.xp} XP${bonusText}`;
  }

  function heroStatLine(hero, progress) {
    const bonus = progress ? heroLongBonus(progress) : 0;
    const hp = bonus > 0 ? Math.round(hero.hp * (1 + bonus)) : hero.hp;
    const atk = bonus > 0 ? Math.round(hero.atk * (1 + bonus)) : hero.atk;
    const parts = [`生命 ${hp}`, `攻 ${atk}`, `射 ${hero.range}`, `速 ${hero.speed}`];
    if (hero.splash) parts.push(`濺射 ${hero.splash}`);
    if (hero.pierce) parts.push(`穿透 ${hero.pierce}`);
    if (hero.slow) parts.push("緩速");
    if (hero.healGoddess) parts.push(`治療 ${hero.healGoddess}`);
    if (bonus > 0) parts.push(`羈絆 +${Math.round(bonus * 100)}%攻血`);
    return parts.join(" · ");
  }

  function renderRoster() {
    const box = $("heroRoster"); box.innerHTML = "";
    const HEROES = TD.config.HEROES, HR = TD.config.HERO_RARITY;
    const meta = loadMeta();
    if (ownedHeroes.size === 0) {
      box.innerHTML = '<div style="font-size:11px;color:#8b98a8;padding:4px;">尚未抽到英雄</div>';
      return;
    }
    [...ownedHeroes].forEach((id) => {
      const h = HEROES[id]; if (!h) return;
      const r = HR[h.rarity];
      const deployed = deployedThisGame.has(id);
      const progress = heroProgressFor(id, meta);
      const longBonusPct = Math.round(heroLongBonus(progress) * 100);
      const card = document.createElement("div");
      card.className = "hero-card" + (deployed ? " deployed" : "");
      card.style.setProperty("--hr-color", r.color);
      card.style.setProperty("--hr-glow", r.glow);
      card.innerHTML = `
        <span class="hico">${heroAvatar(h)}</span>
        <span class="hinfo"><span class="hname">${h.name}</span> ${"★".repeat(r.stars)} <span class="hbond">羈絆 Lv.${progress.level}${longBonusPct ? ` +${longBonusPct}%攻血` : ""}</span><br><span class="hmeta">${h.desc}<br>${heroStatLine(h, progress)}<br>${heroLongMetaLine(id, meta)}</span></span>
        <span class="hdeploy">${deployed ? "已上場" : "上場▶"}</span>`;
      if (!deployed) card.onclick = () => {
        if (TD.deployHero(id, progress)) { deployedThisGame.add(id); renderRoster(); refreshUI(); }
      };
      box.appendChild(card);
    });
  }

  function renderDeployedHeroes() {
    const box = $("deployedHeroes");
    if (!box) return;
    const st = TD.state();
    const deployed = (st.heroes || []).filter((h) => h && hasOwn(TD.config.HEROES, h.id));
    if (!deployed.length) {
      box.innerHTML = '<div class="deployed-empty">已上場英雄會顯示在這裡</div>';
      return;
    }
    box.innerHTML = "";
    deployed.forEach((h) => {
      const def = TD.config.HEROES[h.id];
      const hpPct = Math.max(0, Math.min(100, Math.round(((h.hp || 0) / Math.max(1, h.maxHp || 1)) * 100)));
      const active = st.pendingHero === h.uid;
      const guarded = !!h.guardPoint;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `deployed-hero-slot${active ? " active" : ""}${guarded ? " guarded" : ""}`;
      btn.dataset.heroSlot = h.uid;
      btn.title = active ? "點地圖設定駐守點" : "點擊後在地圖設定駐守點";
      btn.innerHTML = `
        <span class="dh-avatar">${heroAvatar(def)}</span>
        <span class="dh-body">
          <span class="dh-top"><b>${def.name}</b><em>Lv.${h.level || 1} / 羈絆Lv.${h.longLevel || 1}</em></span>
          <span class="dh-hp"><span style="width:${hpPct}%"></span></span>
          <span class="dh-status">${active ? "選擇駐守點" : (guarded ? "駐守中" : "點我駐守")}</span>
        </span>`;
      btn.onclick = () => {
        if (TD.selectHeroGuard && TD.selectHeroGuard(h.uid)) renderDeployedHeroes();
      };
      box.appendChild(btn);
    });
  }

  function missionContext(meta) {
    const st = TD.state();
    const towers = st.towers || [];
    return {
      wave: st.wave || 0,
      clearedWave: st.clearedWave || (st.betweenWaves ? st.wave : Math.max(0, (st.wave || 1) - 1)),
      towerCount: towers.length,
      towersBuilt: st.towersBuilt || towers.length,
      maxTowerLevel: towers.reduce((max, tw) => Math.max(max, tw.level || 1), 1),
      towerUpgrades: st.towerUpgrades || 0,
      skillCasts: st.skillCasts || 0,
      bossKills: st.bossKills || 0,
      deployedHeroCount: (st.heroes || []).length,
      ownedHeroCount: ownedHeroes.size,
      totalHeroCount: Object.keys(TD.config.HEROES).length,
      gachaCount: meta.gachaCount || 0,
    };
  }

  function remainingMissionReward(meta) {
    const claimed = (meta && meta.beginnerMissions) || {};
    return Object.values(BEGINNER_MISSIONS || {}).reduce((sum, mission) => (
      claimed[mission.id] === true ? sum : sum + (mission.reward || 0)
    ), 0);
  }

  function showMissionToast(unlocked) {
    if (!unlocked || !unlocked.length) return;
    const total = unlocked.reduce((sum, m) => sum + (m.reward || 0), 0);
    const toast = document.createElement("div");
    toast.className = "mission-toast";
    toast.textContent = `新手任務完成：+${total}💎`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1900);
    unlocked.forEach((m) => pushLog(`🎯 任務達成「${m.label}」已領 +${m.reward}💎`));
  }

  function claimBeginnerMissions(baseMeta) {
    if (!RULES.evaluateBeginnerMissions) return baseMeta || loadMeta();
    const meta = baseMeta || loadMeta();
    const result = RULES.evaluateBeginnerMissions(meta, missionContext(meta));
    if (result.unlocked.length) {
      saveMeta(result.meta);
      const st = TD.state();
      st.runMissionSoulEarned = (st.runMissionSoulEarned || 0) + result.unlocked.reduce((sum, m) => sum + (m.reward || 0), 0);
      showMissionToast(result.unlocked);
      return result.meta;
    }
    return meta;
  }

  function renderBeginnerMissions(meta) {
    const box = $("beginnerMissions");
    if (!box) return;
    const missions = Object.values(BEGINNER_MISSIONS || {});
    if (!missions.length) { box.innerHTML = ""; return; }
    const claimed = meta.beginnerMissions || {};
    const claimedCount = missions.filter((m) => claimed[m.id] === true).length;
    const totalReward = missions.reduce((sum, m) => sum + (m.reward || 0), 0);
    const nextCost = TD.config.GACHA.cost;
    const progress = Math.min(nextCost, meta.soulCrystal || 0);
    const pathText = meta.gachaCount > 0 && ownedHeroes.size < 2
      ? `第二英雄進度 ${progress}/${nextCost}💎，剩餘任務可得 +${remainingMissionReward(meta)}💎`
      : `新手任務 ${claimedCount}/${missions.length}，總增發 ${totalReward}💎`;
    box.innerHTML = `
      <div class="mission-title">🎯 首 10 波目標</div>
      <div class="mission-progress">${pathText}</div>
      <div class="mission-list">
        ${missions.map((m) => {
          const done = claimed[m.id] === true;
          return `<div class="mission-row ${done ? "claimed" : ""}" data-mission="${m.id}">
            <div>${done ? "✅" : "▫️"}</div>
            <div><div class="m-name">${m.label}</div><div class="m-desc">${m.desc}</div></div>
            <div class="m-reward">${done ? "已領" : `+${m.reward}💎`}</div>
          </div>`;
        }).join("")}
      </div>`;
  }

  function openEnemyInfo(id) {
    const e = ENEMIES[id];
    const box = $("enemyInfo");
    if (!e || !box) return;
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="enemy-title">${e.emoji || ""} ${e.name}</div>
      <div class="enemy-stats">血量 ${e.hp}${e.shield ? ` + 護盾 ${e.shield}` : ""} · 速度 ${e.speed} · 元素 ${ELEM_ICON[e.element]}${ELEM_LABEL[e.element]}</div>
      <div class="enemy-trait">特性：${enemyTrait(e)}</div>`;
    document.querySelectorAll(".enemy-chip-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.enemy === id));
  }

  function renderNextWaveCard() {
    const box = $("nextWaveCard");
    if (!box || !TD.previewNextWave) return;
    const st = TD.state();
    if (!st.betweenWaves || st.over) {
      box.innerHTML = `<div class="nw-title">⚔ 防禦中</div><div class="nw-meta">敵人進攻時可點技能救場，波間會顯示下一波情報。</div>`;
      return;
    }
    const p = TD.previewNextWave();
    const theme = p.theme ? `${ELEM_ICON[p.theme] || ""}${ELEM_LABEL[p.theme] || p.theme}` : "混合";
    const event = p.event ? `${p.event.emoji}${p.event.label}：${p.event.desc}` : (p.isBoss ? "⚠️ Boss 波" : "標準波");
    const affixText = p.affix ? ` · 詞綴 ${p.affix.label}` : "";
    const enemyTypes = (p.enemyTypes || []).filter((item) => ENEMIES[item.type]);
    box.innerHTML = `
      <div class="nw-title">🧭 下一波情報：第 ${p.wave} 波</div>
      <div class="nw-meta">${event} · 主元素 ${theme} · 敵人 ${p.totalCount || p.count} 隻${affixText}</div>
      <div class="enemy-chip-row">
        ${enemyTypes.map((item) => {
          const e = ENEMIES[item.type];
          return `<button class="enemy-chip-btn" data-enemy="${item.type}" title="${enemySummary(item.type)}">${e.emoji || ""} ${e.name}×${item.count}</button>`;
        }).join("")}
      </div>`;
    box.querySelectorAll(".enemy-chip-btn").forEach((btn) => {
      btn.onclick = () => openEnemyInfo(btn.dataset.enemy);
    });
  }

  function renderAffixCard() {
    const box = $("affixCard");
    if (!box) return;
    const st = TD.state();
    const affix = st && st.affix;
    if (!affix) {
      box.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    const bal = RULES.affixExpectedBalance ? RULES.affixExpectedBalance(affix) : { goldDelta: 0, powerDelta: 0, netDelta: 0 };
    const pct = (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
    box.classList.remove("hidden");
    box.innerHTML = `
      <div class="affix-title">${affix.emoji || ""} 本局詞綴：${affix.label}</div>
      <div class="affix-desc">${affix.desc}</div>
      <div class="affix-balance">預期：資源 ${pct(bal.goldDelta)} · 壓力 ${pct(bal.powerDelta)} · 淨值 ${pct(bal.netDelta)}</div>`;
  }

  // ===== HUD 與整體刷新 =====
  function refreshUI() {
    const st = TD.state();
    $("gold").textContent = st.gold;
    $("goddessHp").textContent = Math.max(0, Math.round(st.goddess.hp));
    $("goddessMax").textContent = st.goddess.maxHp;
    // D11 女神低血告警：低於 30% 閃紅
    const livesStat = document.querySelector(".hud .lives");
    if (livesStat) livesStat.classList.toggle("danger", st.goddess.hp / st.goddess.maxHp < 0.3 && st.goddess.hp > 0);
    $("wave").textContent = st.wave;
    $("score").textContent = st.score;

    // 女神升級按鈕
    const gBtn = $("goddessBtn");
    const G = TD.config.GODDESS;
    if (st.goddess.level >= G.maxLevel) { gBtn.textContent = "👸 女神已滿級"; gBtn.disabled = true; }
    else {
      const cost = TD.goddessUpgradeCost();
      gBtn.textContent = `👸 升級女神 (${cost}💰) Lv.${st.goddess.level}`;
      gBtn.disabled = st.gold < cost;
    }

    // 抽卡按鈕（花魂晶，跨局貨幣；首抽免費）
    const meta = claimBeginnerMissions();
    const gcost = gachaCostNow(meta);
    const gBtn2 = $("gachaBtn");
    gBtn2.textContent = gcost === 0 ? "🎲 抽英雄（首抽免費！）" : `🎲 抽英雄 (${gcost}💎 持有 ${meta.soulCrystal})`;
    gBtn2.disabled = meta.soulCrystal < gcost;
    const gMeta = $("gachaMeta");
    if (gMeta) {
      const totalHeroes = Object.keys(TD.config.HEROES).length;
      const pityShown = Math.max(0, Math.min(meta.gachaPity || 0, TD.config.GACHA.pityLegendary));
      const secondLine = meta.gachaCount > 0 && ownedHeroes.size < 2
        ? `｜第二英雄 ${Math.min(TD.config.GACHA.cost, meta.soulCrystal)}/${TD.config.GACHA.cost}💎`
        : "";
      gMeta.textContent = `${meta.soulCrystal}💎｜保底 ${pityShown}/${TD.config.GACHA.pityLegendary}｜英雄 ${ownedHeroes.size}/${totalHeroes}${secondLine}`;
    }
    renderBeginnerMissions(meta);
    renderRoster();
    renderDeployedHeroes();

    // 建塔按鈕：金錢不足變灰、選中的高亮
    document.querySelectorAll(".tower-btn").forEach((b) => {
      const t = TOWERS[b.dataset.type];
      b.classList.toggle("cant", st.gold < t.cost);
      b.classList.toggle("active", st.selectedTowerType === t.id);
    });

    // 技能冷卻
    document.querySelectorAll(".skill-btn").forEach((b) => {
      const cd = st.skillCooldowns[b.dataset.skill] || 0;
      b.classList.toggle("cd", cd > 0);
      const span = b.querySelector(".cdtext");
      span.textContent = cd > 0 ? Math.ceil(cd) + "s" : "就緒";
    });

    // 開始按鈕：只有波間可按，並顯示下一波預告（D4）
    const startBtn = $("startBtn");
    startBtn.disabled = !st.betweenWaves || st.over;
    if (st.wave === 0 && st.towers.length === 0 && !st.over) {
      startBtn.disabled = true;
      startBtn.textContent = "先建一座塔！";
    } else if (st.betweenWaves && !st.over && TD.previewNextWave) {
      const p = TD.previewNextWave();
      if (p.event) {
        // 事件波預告（最醒目）
        startBtn.innerHTML = `▶ 第 ${p.wave} 波 ${p.event.emoji}${p.event.label}!`;
      } else {
        const themeLabel = p.theme && p.theme !== "physical" ? ` · 主${ELEM_ICON[p.theme]||""}` : "";
        startBtn.innerHTML = `▶ 第 ${p.wave} 波 (${p.count}隻${p.isBoss ? " ⚠️BOSS" : ""}${themeLabel})`;
      }
    } else {
      startBtn.textContent = "⚔ 防禦中…";
    }
    renderNextWaveCard();
    renderAffixCard();

    // 選中塔的升級面板
    const sel = $("selPanel");
    if (st.selectedTower) {
      const tw = st.selectedTower, def = TOWERS[tw.type];
      const maxed = tw.level >= TD.config.UPGRADE.maxLevel;
      let statLine;
      if (def.support) {
        const gain = TD.supportDpsGain ? TD.supportDpsGain(tw) : 0;
        statLine = `增傷 +${Math.round(TD.towerStat(tw, "buff") * 100)}% · 射程 ${Math.round(TD.towerStat(tw, "range"))}<br>目前加成 +${gain.toFixed(1)} DPS`;
      } else {
        const buff = TD.getTowerBuff ? TD.getTowerBuff(tw) : 0;
        const effective = TD.effectiveTowerDamage ? TD.effectiveTowerDamage(tw) : TD.towerStat(tw, "damage");
        const poison = def.poisonDps ? `<br>毒素 ${def.poisonDps}/秒 · ${def.poisonDuration} 秒 · 最多 ${def.poisonMaxStacks} 層` : "";
        statLine = `傷害 ${Math.round(effective)}${buff > 0 ? `（聖光 +${Math.round(buff * 100)}%）` : ""} · 射程 ${Math.round(TD.towerStat(tw, "range"))}${poison}`;
      }
      $("selInfo").innerHTML = `
        <b>${def.emoji} ${def.name}</b> Lv.${tw.level}<br>
        ${statLine}`;
      $("upgBtn").textContent = maxed ? "已滿級" : `升級 (${TD.upgradeCost(tw)}💰)`;
      $("upgBtn").disabled = maxed;
      sel.classList.remove("hidden");
    } else sel.classList.add("hidden");
  }

  // ===== 日誌 =====
  function pushLog(msg, kind) {
    const box = $("log");
    const d = document.createElement("div");
    d.className = kind || ""; d.textContent = msg;
    box.appendChild(d);
    while (box.children.length > 3) box.removeChild(box.firstChild);
  }

  // ===== Meta 進度系統（D1：最高紀錄 + 魂晶）=====
  // 讀檔一律交給 rules.js 補齊版本與欄位，避免舊存檔缺欄位時把 meta 打成 NaN。
  const META_KEY = "td_meta_v1";
  function loadMeta() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(META_KEY)); } catch {}
    return RULES.migrateMeta(raw);
  }
  function saveMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(RULES.migrateMeta(m))); } catch {}
  }

  function formatDate(ts) {
    try { return new Date(ts).toLocaleDateString("zh-TW"); }
    catch { return "未知日期"; }
  }

  function renderBoardTabs(meta) {
    const box = $("boardTabs"); box.innerHTML = "";
    Object.values(TD.config.DIFFICULTIES).forEach((d) => {
      const btn = document.createElement("button");
      btn.className = "progress-tab" + (selectedBoardDiff === d.id ? " active" : "");
      btn.textContent = `${d.emoji} ${d.label}`;
      btn.onclick = () => { selectedBoardDiff = d.id; renderProgressOverlay(loadMeta()); };
      box.appendChild(btn);
    });
    const mapBox = $("mapTabs");
    if (!mapBox) return;
    if (!hasOwn(TD.config.MAPS, selectedBoardMap)) selectedBoardMap = "plains";
    mapBox.innerHTML = "";
    Object.values(TD.config.MAPS).forEach((m) => {
      const btn = document.createElement("button");
      btn.className = "progress-tab" + (selectedBoardMap === m.id ? " active" : "");
      btn.textContent = `${m.emoji} ${m.label}`;
      btn.onclick = () => { selectedBoardMap = m.id; renderProgressOverlay(loadMeta()); };
      mapBox.appendChild(btn);
    });
  }

  function renderBoardList(meta) {
    const box = $("boardList"); box.innerHTML = "";
    if (!hasOwn(TD.config.MAPS, selectedBoardMap)) selectedBoardMap = "plains";
    const diffBoard = (meta.board && meta.board[selectedBoardDiff]) || {};
    const entries = diffBoard[selectedBoardMap] || [];
    if (!entries.length) {
      const map = TD.config.MAPS[selectedBoardMap];
      box.innerHTML = `<div class="empty-state">${map ? map.label : "此地圖"}尚無紀錄。完成一局後就會列入排行榜。</div>`;
      return;
    }
    entries.forEach((entry, idx) => {
      const row = document.createElement("div");
      row.className = "board-row";
      const map = hasOwn(TD.config.MAPS, entry.map) ? TD.config.MAPS[entry.map] : null;
      const mapText = map ? ` · ${map.label}` : "";
      row.innerHTML = `
        <div class="board-rank">#${idx + 1}</div>
        <div class="board-main"><b>第 ${entry.wave} 波</b> · ${entry.score} 分<br><span class="board-sub">擊殺 ${entry.kills} 名敵人${mapText}</span></div>
        <div class="board-date">${formatDate(entry.at)}</div>`;
      box.appendChild(row);
    });
  }

  function renderAchievements(meta) {
    const box = $("achievementList"); box.innerHTML = "";
    Object.values(TD.config.ACHIEVEMENTS).forEach((ach) => {
      const unlocked = meta.achievements && meta.achievements[ach.id] === true;
      const row = document.createElement("div");
      row.className = "achievement-row" + (unlocked ? "" : " locked");
      row.innerHTML = `
        <div class="achievement-icon">${unlocked ? "✅" : "🔒"}</div>
        <div>
          <div class="achievement-name">${ach.label}</div>
          <div class="achievement-desc">${ach.desc}</div>
        </div>
        <div class="achievement-reward">+${ach.reward}💎</div>`;
      box.appendChild(row);
    });
  }

  function nextMilestoneGap(wave) {
    const milestones = [10, 20, 30];
    const target = milestones.find((m) => wave < m) || Math.ceil((wave + 1) / 10) * 10;
    return { target, gap: Math.max(0, target - wave) };
  }

  function renderRunProgress(meta) {
    const box = $("runProgress");
    if (!box) return;
    const st = TD.state();
    const wave = st.wave || 0;
    const ms = nextMilestoneGap(wave);
    const runSoul = st.runSoulEarned || 0;
    const missionSoul = st.runMissionSoulEarned || 0;
    const nextCost = gachaCostNow(meta);
    const secondHeroLine = ownedHeroes.size < 2
      ? `第二英雄 ${Math.min(TD.config.GACHA.cost, meta.soulCrystal || 0)}/${TD.config.GACHA.cost}💎`
      : `英雄 ${ownedHeroes.size}/${Object.keys(TD.config.HEROES).length}`;
    box.innerHTML = `
      <div class="rp-card"><div class="rp-label">本局進度</div><div class="rp-value">第 ${wave} 波 · 距離第 ${ms.target} 波還差 ${ms.gap} 波</div></div>
      <div class="rp-card"><div class="rp-label">本局魂晶</div><div class="rp-value">清波 +${runSoul}💎 · 任務 +${missionSoul}💎</div></div>
      <div class="rp-card"><div class="rp-label">抽英雄路徑</div><div class="rp-value">${nextCost === 0 ? "首抽免費" : secondHeroLine}</div></div>`;
  }

  function renderProgressOverlay(meta) {
    const m = meta || loadMeta();
    renderBoardTabs(m);
    renderRunProgress(m);
    renderBoardList(m);
    renderAchievements(m);
  }

  function openProgressOverlay() {
    if ($("progressOverlay").classList.contains("show")) return;
    selectedBoardDiff = TD.getDifficulty().id;
    selectedBoardMap = (TD.getMap && TD.getMap().id) || "plains";
    progressWasPaused = !!TD.state().paused;
    TD.setPaused(true);
    syncPauseButton(true);
    renderProgressOverlay();
    $("progressOverlay").classList.add("show");
  }

  function closeProgressOverlay() {
    $("progressOverlay").classList.remove("show");
    if (!progressWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
  }

  function onWaveCleared(result) {
    const info = result || {};
    const reward = Math.max(0, Math.floor(Number(info.reward) || 0));
    if (reward <= 0) return;
    const meta = loadMeta();
    meta.soulCrystal += reward;
    saveMeta(meta);
    pushLog(`💎 清掉第 ${info.wave || "?"} 波，魂晶 +${reward}（持有 ${meta.soulCrystal}）`);
    refreshUI();
  }

  // ===== 遊戲結束（含 meta 結算 + 分享鉤子）=====
  function onGameOver(wave, score, run) {
    const diff = TD.getDifficulty();
    const kills = (run && run.kills) || 0;
    const settlement = RULES.settleRunRewards({
      meta: claimBeginnerMissions(),
      wave,
      score,
      kills,
      difficulty: (run && run.difficulty) || diff,
      soulEarned: (run && run.soulEarned) || 0,
    });
    const currentMap = TD.getMap ? TD.getMap() : null;
    const currentMapId = currentMap && currentMap.id;
    const boardResult = RULES.updateBoard(settlement.meta.board, diff.id, currentMapId, { wave, score, kills, at: Date.now() });
    const withBoard = Object.assign({}, settlement.meta, { board: boardResult.board });
    const heroGrowth = Array.isArray(run && run.heroGrowth) ? run.heroGrowth : [];
    const heroProgressResult = RULES.settleHeroProgress
      ? RULES.settleHeroProgress(withBoard, heroGrowth)
      : { meta: withBoard, entries: [] };
    const achievementResult = RULES.evaluateAchievements(heroProgressResult.meta, {
      wave,
      score,
      kills,
      difficultyId: diff.id,
      ownedHeroCount: ownedHeroes.size,
      totalHeroCount: Object.keys(TD.config.HEROES).length,
    });
    const meta = achievementResult.meta;
    const earned = settlement.earned;
    const isRecord = settlement.isRecord;
    saveMeta(meta);
    const ctaCost = gachaCostNow(meta);
    const ctaAffordable = meta.soulCrystal >= ctaCost;

    $("finalWave").textContent = wave;
    $("finalScore").textContent = score;
    const metaLine = $("metaResult");
    if (metaLine) {
      // 高波數或高難度 → 強化「分享攻略」鉤子
      const isHard = diff.id !== "normal";
      const repoUrl = "https://github.com/mars-tw/tower-defense-skill";
      const shareText = `我在「無盡塔防」${diff.label}難度撐到第 ${wave} 波！得分 ${score} 🏰`;
      const rankLine = boardResult.rank
        ? `<div class="rank-line">🏆 本場第 ${boardResult.rank} 名！</div>`
        : '<div class="meta-sub">這場未進榜，再調整塔陣挑戰前 10 名。</div>';
      const unlockLine = achievementResult.unlocked.length
        ? `<div class="unlock-list">${achievementResult.unlocked.map((ach) => `<div>🎖️ 解鎖「${ach.label}」 +${ach.reward}💎</div>`).join("")}</div>`
        : '<div class="meta-sub">本場沒有新成就。</div>';
      const progressById = Object.fromEntries((heroProgressResult.entries || []).map((entry) => [entry.id, entry]));
      const heroGrowthLine = heroGrowth.length
        ? `<div class="hero-growth"><div class="hg-title">本局英雄成長</div>${heroGrowth.map((item) => {
          const def = TD.config.HEROES[item.id] || {};
          const xp = Math.max(0, Math.round(item.xp || item.runXp || 0));
          const level = Math.max(1, Math.round(item.level || 1));
          const up = Math.max(0, Math.round(item.levelsGained || 0));
          const long = progressById[item.id];
          const longText = long ? `｜長線 +${long.savedXp} XP｜羈絆 Lv.${long.newLevel}${long.levelGained ? `（+${long.levelGained}）` : ""}` : "";
          const bonusText = long && long.bonus ? `｜攻血 +${Math.round(long.bonus * 100)}%` : "";
          return `<div>${def.name || item.id}：+${xp} XP，Lv.${level}${up ? `（升 ${up} 級）` : ""}${longText}${bonusText}</div>`;
        }).join("")}</div>`
        : "";
      metaLine.innerHTML = `
        <div class="diff-tag" style="color:${diff.color}">${diff.emoji} ${diff.label}難度</div>
        ${rankLine}
        ${isRecord ? '<div class="record">🎉 新紀錄！</div>' : `<div>此難度最高：第 ${meta.bestByDiff[diff.id]} 波</div>`}
        <div>💎 本局清波已獲得 +${earned}（目前 ${meta.soulCrystal}）</div>
        ${unlockLine}
        ${heroGrowthLine}
        <div class="hook">${isHard || wave >= 10 ? "覺得難？" : ""}<b>分享你的攻略</b>，讓大家膜拜你的塔陣！</div>
        <div class="share-row">
          <button class="share-btn" id="copyResult">📋 複製戰績</button>
          <a class="share-btn" href="${repoUrl}/discussions" target="_blank">💬 發攻略</a>
        </div>`;
      // 複製戰績
      setTimeout(() => {
        const cp = $("copyResult");
        if (cp) cp.onclick = () => {
          try { navigator.clipboard.writeText(shareText + " " + repoUrl); cp.textContent = "✓ 已複製！"; }
          catch { cp.textContent = "（請手動複製）"; }
        };
      }, 0);
    }
    const deathCta = $("deathCtaBtn");
    if (deathCta) {
      if (ctaAffordable) {
        deathCta.textContent = ctaCost === 0 ? "立即抽英雄（免費）" : "立即抽英雄";
        deathCta.onclick = () => {
          deathCta.blur();
          doGacha({
            doneLabel: "帶英雄再開局",
            onDone: restartRun,
          });
        };
      } else {
        deathCta.textContent = `清波賺魂晶再抽（差 ${ctaCost - meta.soulCrystal} 💎）`;
        deathCta.onclick = () => { deathCta.blur(); restartRun(); };
      }
    }
    $("overlay").classList.add("show");
  }

  // ===== 綁定控制 =====
  $("startBtn").title = "Enter：開始下一波";
  $("speed2").title = "Tab：切換 1× / 2×";
  $("pauseBtn").title = "Space / P：暫停或繼續";
  $("gachaBtn").title = "H：抽英雄";
  $("startBtn").onclick = () => { TD.startWave(); refreshUI(); };
  $("goddessBtn").onclick = () => { TD.upgradeGoddess(); refreshUI(); };
  $("gachaBtn").onclick = () => { $("gachaBtn").blur(); doGacha(); };
  $("boardBtn").onclick = () => { openProgressOverlay(); };
  $("progressClose").onclick = () => { closeProgressOverlay(); };
  $("restartBtn").onclick = restartRun;
  $("upgBtn").onclick = () => { TD.upgradeSelected(); refreshUI(); };
  $("sellBtn").onclick = () => { TD.sellSelected(); refreshUI(); };
  document.querySelectorAll(".speed").forEach((b) => {
    b.onclick = () => {
      TD.setSpeed(Number(b.dataset.s));
      document.querySelectorAll(".speed").forEach((x) => x.classList.toggle("on", x === b));
    };
  });
  // D10 暫停按鈕 + 鍵盤（空白鍵暫停、Esc 取消選取）。
  // 抽卡盲盒開著時忽略暫停熱鍵：動畫期間是強制暫停，玩家再按 P/空白鍵切換會讓
  // playGachaAnimation 記錄的 wasPaused 對不上，關閉浮層後戰場暫停狀態錯亂
  $("pauseBtn").onclick = () => {
    if (isBlockingOverlayOpen()) return;
    const paused = TD.togglePause();
    syncPauseButton(paused);
  };
  function clickIfReady(btn) {
    if (btn && !btn.disabled) btn.click();
  }
  function isShortcutKey(e) {
    const key = (e.key || "").toLowerCase();
    return !!(TOWER_BY_KEY[e.key] || SKILL_BY_KEY[key] ||
      e.code === "Enter" || e.code === "Tab" || e.code === "Space" ||
      e.code === "Escape" || key === "p" || key === "h");
  }
  document.addEventListener("keydown", (e) => {
    if (isTextEntryTarget(e.target)) return;
    if (isShown("progressOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeProgressOverlay(); }
      else { e.preventDefault(); }
      return;
    }
    if (isBlockingOverlayOpen()) {
      if (isShortcutKey(e)) e.preventDefault();
      return;
    }

    const key = e.key || "";
    const lower = key.toLowerCase();
    if (e.code === "Space" || lower === "p") {
      e.preventDefault();
      $("pauseBtn").click();
    } else if (e.code === "Escape") {
      e.preventDefault();
      TD.cancelSelect();
    } else if (TOWER_BY_KEY[key]) {
      e.preventDefault();
      clickIfReady(document.querySelector(`.tower-btn[data-type="${TOWER_BY_KEY[key]}"]`));
    } else if (SKILL_BY_KEY[lower]) {
      e.preventDefault();
      clickIfReady(document.querySelector(`.skill-btn[data-skill="${SKILL_BY_KEY[lower]}"]`));
    } else if (e.code === "Enter") {
      e.preventDefault();
      clickIfReady($("startBtn"));
    } else if (e.code === "Tab") {
      e.preventDefault();
      clickIfReady($(TD.state().speed === 2 ? "speed1" : "speed2"));
    } else if (lower === "h") {
      e.preventDefault();
      clickIfReady($("gachaBtn"));
    }
  });

  // 把回呼掛給 game.js
  window.__tdUI = refreshUI;
  window.__tdLog = pushLog;
  window.__tdWaveCleared = onWaveCleared;
  window.__tdGameOver = onGameOver;

  // 首次遊玩引導（D3）：只顯示一次，存 localStorage
  // 各難度的最高紀錄（meta 依難度分開存）
  function bestForDiff(diffId) {
    const m = loadMeta();
    return (m.bestByDiff && m.bestByDiff[diffId]) || 0;
  }
  function renderMaps() {
    const box = $("mapOptions"); if (!box) return;
    box.innerHTML = "";
    const meta = loadMeta();
    const lastMap = hasOwn(TD.config.MAPS, meta.lastMap) ? meta.lastMap : (TD.getMap && TD.getMap().id);
    Object.values(TD.config.MAPS).forEach((m) => {
      const opt = document.createElement("button");
      opt.className = "map-opt" + (m.id === lastMap ? " active" : "");
      const goldText = m.goldMul === 1 ? "標準資源" : `資源 ${Math.round(m.goldMul * 100)}%`;
      opt.innerHTML = `
        <span class="demoji">${m.emoji}</span>
        <span class="dinfo">
          <span class="dname">${m.label}</span>
          <span class="ddesc">${m.desc}</span>
          <span class="dbest">${goldText} · 路徑節點 ${m.path.length}</span>
        </span>`;
      opt.onclick = () => {
        TD.setMap(m.id);
        const nextMeta = loadMeta();
        nextMeta.lastMap = m.id;
        saveMeta(nextMeta);
        $("mapOverlay").classList.remove("show");
        TD.newGame();
        deployedThisGame = new Set(); renderRoster();
        const el = $("bestWave"); if (el) el.textContent = bestForDiff(TD.getDifficulty().id);
        refreshUI();
      };
      box.appendChild(opt);
    });
  }
  // 渲染難度選擇
  function renderDifficulties() {
    const box = $("diffOptions"); box.innerHTML = "";
    Object.values(TD.config.DIFFICULTIES).forEach((d) => {
      const best = bestForDiff(d.id);
      const opt = document.createElement("button");
      opt.className = "diff-opt"; opt.style.setProperty("--diff-c", d.color);
      opt.innerHTML = `
        <span class="demoji">${d.emoji}</span>
        <span class="dinfo">
          <span class="dname">${d.label}</span>
          <span class="ddesc">${d.desc}</span>
          ${best > 0 ? `<span class="dbest">🏆 你的最高：第 ${best} 波</span>` : ""}
        </span>`;
      opt.onclick = () => {
        TD.setDifficulty(d.id);
        try { localStorage.setItem("td_difficulty", d.id); } catch {}
        $("diffOverlay").classList.remove("show");
        renderMaps();
        $("mapOverlay").classList.add("show");
        const el = $("bestWave"); if (el) el.textContent = bestForDiff(d.id);
        refreshUI();
      };
      box.appendChild(opt);
    });
  }

  (function restorePrefs() {
    try {
      const savedDiff = localStorage.getItem("td_difficulty");
      if (savedDiff) TD.setDifficulty(savedDiff);
    } catch {}
    const meta = loadMeta();
    if (meta.lastMap && TD.setMap) TD.setMap(meta.lastMap);
    selectedBoardDiff = TD.getDifficulty().id;
  })();

  (function setupTutorial() {
    let seen = false;
    const currentMeta = loadMeta();
    const hasSave = (currentMeta.games || 0) > 0 || (currentMeta.bestWave || 0) > 0 || (currentMeta.gachaCount || 0) > 0 || (currentMeta.totalKills || 0) > 0 || (currentMeta.soulCrystal || 0) > 0;
    try { seen = localStorage.getItem("td_tutorial_seen") === "1"; } catch {}
    function markSeen() {
      try { localStorage.setItem("td_tutorial_seen", "1"); } catch {}
    }
    if (!seen && !hasSave) {
      $("tutorial").classList.add("show");
      $("tutorialQuick").onclick = () => {
        $("tutorial").classList.remove("show");
        markSeen();
        TD.setDifficulty("normal");
        TD.setMap("plains");
        try { localStorage.setItem("td_difficulty", "normal"); } catch {}
        const meta = loadMeta();
        meta.lastMap = "plains";
        saveMeta(meta);
        TD.newGame();
        refreshUI();
      };
      $("tutorialAdvanced").onclick = () => {
        $("tutorial").classList.remove("show");
        markSeen();
        renderDifficulties(); $("diffOverlay").classList.add("show");
      };
    } else {
      // 看過引導：直接顯示難度選擇
      renderDifficulties(); $("diffOverlay").classList.add("show");
    }
  })();

  // 顯示歷史最高波數（D1 meta）
  (function showBest() {
    const m = loadMeta();
    const el = $("bestWave"); if (el) el.textContent = m.bestWave;
  })();

  renderRoster();
  refreshUI();
  pushLog("放置砲塔、抽英雄上場守護女神！火克冰、冰克雷、雷克火。");
})();
