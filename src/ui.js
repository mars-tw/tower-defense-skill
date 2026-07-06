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
  let heroDetailWasPaused = false;
  let settingsWasPaused = false;
  let advisorCollapsed = false;
  let advisorHidden = false;
  let advisorMode = "control";
  let warningSerial = 0;
  let recoveryNoticeShown = false;
  const TOWER_HOTKEYS = { arrow: "1", cannon: "2", frost: "3", tesla: "4", poison: "5", support: "6" };
  const SKILL_HOTKEYS = { meteor: "Q", freeze: "W", thunder: "E" };
  const TOWER_BY_KEY = Object.fromEntries(Object.entries(TOWER_HOTKEYS).map(([id, key]) => [key, id]));
  const SKILL_BY_KEY = Object.fromEntries(Object.entries(SKILL_HOTKEYS).map(([id, key]) => [key.toLowerCase(), id]));
  const TEXT_SIZE_KEY = "td_text_size";
  const TEXT_SIZE_LABELS = { small: "小", medium: "中", large: "大" };
  let textSize = loadTextSize();

  function normalizeTextSize(value) {
    return hasOwn(TEXT_SIZE_LABELS, value) ? value : "medium";
  }

  function loadTextSize() {
    try { return normalizeTextSize(localStorage.getItem(TEXT_SIZE_KEY)); }
    catch { return "medium"; }
  }

  function applyTextSize(size) {
    const next = normalizeTextSize(size);
    document.body.classList.remove("text-size-small", "text-size-medium", "text-size-large");
    document.body.classList.add(`text-size-${next}`);
  }

  function setTextSize(size) {
    textSize = normalizeTextSize(size);
    try { localStorage.setItem(TEXT_SIZE_KEY, textSize); } catch {}
    applyTextSize(textSize);
    renderTextSizeSettings();
  }

  function focusSoon(el) {
    if (!el || typeof el.focus !== "function") return;
    setTimeout(() => {
      try { el.focus({ preventScroll: true }); }
      catch { el.focus(); }
    }, 0);
  }

  applyTextSize(textSize);

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
    return ["gachaOverlay", "progressOverlay", "heroDetailOverlay", "settingsOverlay", "overlay", "tutorial", "diffOverlay", "mapOverlay"].some(isShown);
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

  function showRecoveryNotice(message) {
    if (recoveryNoticeShown) return;
    recoveryNoticeShown = true;
    const box = document.createElement("div");
    box.className = "recovery-toast";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.textContent = message || "遊戲遇到錯誤，已保護存檔。重新整理即可繼續。";
    document.body.appendChild(box);
    pushLog("已啟動錯誤恢復：存檔保護完成。", "bad");
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
        focusSoon($("revealOk"));
        if (hero.rarity === "legendary" || hero.rarity === "epic") gachaConfetti();
      }, 900);
    };
    chest.onkeydown = (ev) => {
      if (ev.code === "Enter" || ev.code === "Space") {
        ev.preventDefault();
        chest.click();
      }
    };
    focusSoon(chest);
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

  function heroLongXpForLevel(level) {
    return RULES.heroLongXpForLevel ? RULES.heroLongXpForLevel(level) : (Math.max(1, Math.floor(Number(level) || 1)) - 1) * 24;
  }

  function nextBondNode(progress) {
    const p = progress || { xp: 0, level: 1 };
    const nodes = [5, 10, 15];
    const node = nodes.find((lv) => p.level < lv) || 15;
    const previous = nodes.filter((lv) => lv < node && p.level >= lv).pop() || 1;
    const startXp = heroLongXpForLevel(previous);
    const targetXp = heroLongXpForLevel(node);
    const span = Math.max(1, targetXp - startXp);
    const pct = node === 15 && p.level >= 15 ? 100 : Math.max(0, Math.min(100, Math.round(((p.xp - startXp) / span) * 100)));
    return {
      level: node,
      previous,
      startXp,
      targetXp,
      pct,
      maxed: p.level >= 15,
      totalBonus: Math.round(heroLongBonus({ xp: targetXp }) * 100),
    };
  }

  function heroRunSummary(id) {
    const hero = (TD.state().heroes || []).find((h) => h && h.id === id);
    if (!hero) return "本局尚未上場";
    const runXp = Math.max(0, Math.round(hero.runXp || 0));
    const gained = Math.max(0, Math.round(hero.levelsGained || 0));
    const hp = `${Math.max(0, Math.round(hero.hp || 0))}/${Math.max(1, Math.round(hero.maxHp || 1))}`;
    return `戰鬥 Lv.${hero.level || 1}｜本局 XP +${runXp}｜升級 +${gained}｜血量 ${hp}`;
  }

  function deployHeroFromRoster(id, progress) {
    if (TD.deployHero(id, progress)) {
      deployedThisGame.add(id);
      renderRoster();
      refreshUI();
      return true;
    }
    return false;
  }

  function closeHeroDetail() {
    const overlay = $("heroDetailOverlay");
    if (!overlay || !overlay.classList.contains("show")) return;
    overlay.classList.remove("show");
    if (!heroDetailWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
  }

  function openHeroDetail(id) {
    const hero = TD.config.HEROES[id];
    const overlay = $("heroDetailOverlay");
    const content = $("heroDetailContent");
    if (!hero || !overlay || !content) return;
    const meta = loadMeta();
    const progress = heroProgressFor(id, meta);
    const node = nextBondNode(progress);
    const deployed = deployedThisGame.has(id);
    const bonus = Math.round(heroLongBonus(progress) * 100);
    const nextText = node.maxed
      ? "羈絆節點已滿：永久 +15%攻血"
      : `下一節點 Lv.${node.level}：再 +5%攻血（總 +${node.totalBonus}%）`;
    if (!overlay.classList.contains("show")) {
      heroDetailWasPaused = !!TD.state().paused;
      TD.setPaused(true);
      syncPauseButton(true);
    }
    content.innerHTML = `
      <div class="hd-title">${heroAvatar(hero)} <span>英雄詳情｜${hero.name}</span></div>
      <div class="hd-sub">${hero.desc}</div>
      <div class="hd-grid">
        <div><b>戰鬥數值</b><span>${heroStatLine(hero, progress)}</span></div>
        <div><b>跨局羈絆</b><span>羈絆 Lv.${progress.level}｜${progress.xp}/${node.targetXp} XP｜永久 +${bonus}%攻血</span></div>
      </div>
      <div class="hd-progress-head"><span>羈絆進度</span><span>Lv.${node.previous} → Lv.${node.level}</span></div>
      <div class="hd-progress"><span style="width:${node.pct}%"></span></div>
      <div class="hd-node">${nextText}</div>
      <div class="hd-run"><b>本局表現摘要</b><span>${heroRunSummary(id)}</span></div>
      <div class="hd-actions">
        <button type="button" id="heroDetailDeploy" ${deployed ? "disabled" : ""}>${deployed ? "已上場" : "上場"}</button>
      </div>`;
    const deployBtn = $("heroDetailDeploy");
    if (deployBtn && !deployed) {
      deployBtn.setAttribute("aria-label", `部署 ${hero.name}`);
      deployBtn.onclick = () => {
        if (deployHeroFromRoster(id, progress)) openHeroDetail(id);
      };
    } else if (deployBtn) {
      deployBtn.setAttribute("aria-label", `${hero.name} 已上場`);
    }
    overlay.classList.add("show");
    focusSoon($("heroDetailClose"));
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
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      card.setAttribute("aria-label", `${h.name}英雄詳情，羈絆 Lv.${progress.level}，${deployed ? "已上場" : "可上場"}`);
      card.style.setProperty("--hr-color", r.color);
      card.style.setProperty("--hr-glow", r.glow);
      card.innerHTML = `
        <span class="hico">${heroAvatar(h)}</span>
        <span class="hinfo"><span class="hname">${h.name}</span> ${"★".repeat(r.stars)} <span class="hbond">羈絆 Lv.${progress.level}${longBonusPct ? ` +${longBonusPct}%攻血` : ""}</span><br><span class="hmeta">${h.desc}<br>${heroStatLine(h, progress)}<br>${heroLongMetaLine(id, meta)}</span></span>
        <button type="button" class="hdeploy">${deployed ? "詳情" : "上場▶"}</button>`;
      card.onclick = () => openHeroDetail(id);
      card.onkeydown = (ev) => {
        if (ev.code === "Enter" || ev.code === "Space") {
          ev.preventDefault();
          openHeroDetail(id);
        }
      };
      const deployBtn = card.querySelector(".hdeploy");
      deployBtn.setAttribute("aria-label", deployed ? `${h.name} 已上場，開啟詳情` : `部署 ${h.name}`);
      deployBtn.onclick = (ev) => {
        ev.stopPropagation();
        if (deployed) openHeroDetail(id);
        else deployHeroFromRoster(id, progress);
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
      btn.setAttribute("aria-label", `${def.name}上場英雄，生命 ${hpPct}%，${active ? "選擇駐守點中" : guarded ? "已設定駐守點" : "可設定駐守點"}`);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
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
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = `新手任務完成：+${total}💎`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1900);
    unlocked.forEach((m) => pushLog(`🎯 任務達成「${m.label}」已領 +${m.reward}💎`));
  }

  function showBondToast(entries) {
    const gained = (entries || []).filter((entry) => entry && entry.levelGained > 0);
    if (!gained.length) return;
    const first = gained[0];
    const hero = TD.config.HEROES[first.id] || {};
    const toast = document.createElement("div");
    toast.className = "bond-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = `羈絆升級：${hero.name || first.id} Lv.${first.newLevel}`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2100);
    gained.forEach((entry) => {
      const def = TD.config.HEROES[entry.id] || {};
      pushLog(`💫 ${def.name || entry.id} 羈絆升級 Lv.${entry.newLevel}，永久加成 ${Math.round((entry.bonus || 0) * 100)}%`);
    });
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
      <div class="enemy-trait">特性：${enemyTrait(e)}</div>
      <div class="enemy-counter">反制：${e.counterHint || "用克制元素塔集火，必要時補寒冰塔控場。"}</div>`;
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
    const p = TD.previewNextWave({ advisorMode });
    const theme = p.theme ? `${ELEM_ICON[p.theme] || ""}${ELEM_LABEL[p.theme] || p.theme}` : "混合";
    const event = p.event ? `${p.event.emoji}${p.event.label}：${p.event.desc}` : (p.isBoss ? "⚠️ Boss 波" : "標準波");
    const affixText = p.affix ? ` · 詞綴 ${p.affix.label}` : "";
    const enemyTypes = (p.enemyTypes || []).filter((item) => ENEMIES[item.type]);
    const recs = (p.recommendations || []).filter((item) => TOWERS[item.id]);
    const advisor = (p.advisor || []).filter((item) => item && item.kind);
    const advisorModes = RULES.ADVISOR_MODES || {
      control: { label: "控場優先" },
      aoe: { label: "範圍清怪" },
      boss: { label: "Boss 單點" },
    };
    const modeHtml = Object.entries(advisorModes).map(([id, item]) =>
      `<button type="button" data-advisor-mode="${id}" class="${advisorMode === id ? "active" : ""}">${item.label}</button>`
    ).join("");
    const advisorHtml = advisorHidden ? "" : `
      <div class="advisor-row ${advisorCollapsed ? "collapsed" : ""}">
        <div class="advisor-head">
          <span>塔陣顧問</span>
          <span class="advisor-tools">
            <button type="button" data-advisor-toggle>${advisorCollapsed ? "展開" : "收合"}</button>
            <button type="button" data-advisor-close>關閉</button>
          </span>
        </div>
        <div class="advisor-mode">${modeHtml}</div>
        <div class="advisor-actions">
          ${advisor.map((item, index) => {
            if (item.kind === "build") return `<button type="button" class="advisor-action" data-advisor-action="${index}"><b>補 ${item.emoji || ""}${item.towerName}</b><span>${item.zone}（${item.cx},${item.cy}）｜${item.reason}</span></button>`;
            if (item.kind === "upgrade") return `<button type="button" class="advisor-action" data-advisor-action="${index}"><b>升 ${item.emoji || ""}${item.towerName}</b><span>Lv.${item.level}→${item.nextLevel}｜${item.reason}</span></button>`;
            return `<button type="button" class="advisor-action" data-advisor-action="${index}"><b>存錢等 ${item.emoji || ""}${item.towerName}</b><span>${item.reason}</span></button>`;
          }).join("") || '<div class="advisor-action static"><b>維持陣型</b><span>目前沒有明顯補強缺口。</span></div>'}
        </div>
      </div>`;
    box.innerHTML = `
      <div class="nw-title">🧭 下一波情報：第 ${p.wave} 波</div>
      <div class="nw-meta">${event} · 主元素 ${theme} · 敵人 ${p.totalCount || p.count} 隻${affixText}</div>
      <div class="enemy-chip-row">
        ${enemyTypes.map((item) => {
          const e = ENEMIES[item.type];
          return `<button class="enemy-chip-btn" data-enemy="${item.type}" title="${enemySummary(item.type)}">${e.emoji || ""} ${e.name}×${item.count}</button>`;
        }).join("")}
      </div>
      <div class="tower-rec-row">
        <div class="tower-rec-title">建議塔種</div>
        <div class="tower-rec-list">
          ${recs.map((item) => {
            const t = TOWERS[item.id];
            return `<span class="tower-rec-chip" title="${item.reason}">${t.emoji} ${t.name}</span>`;
          }).join("") || '<span class="tower-rec-chip">依現有塔陣補強</span>'}
        </div>
        ${recs[0] ? `<div class="tower-rec-reason">${recs[0].reason}</div>` : ""}
      </div>
      ${advisorHtml}`;
    box.querySelectorAll(".enemy-chip-btn").forEach((btn) => {
      btn.onclick = () => openEnemyInfo(btn.dataset.enemy);
    });
    const toggle = box.querySelector("[data-advisor-toggle]");
    if (toggle) toggle.onclick = () => { advisorCollapsed = !advisorCollapsed; renderNextWaveCard(); };
    const close = box.querySelector("[data-advisor-close]");
    if (close) close.onclick = () => { advisorHidden = true; renderNextWaveCard(); };
    box.querySelectorAll("[data-advisor-mode]").forEach((btn) => {
      btn.onclick = () => {
        advisorMode = btn.dataset.advisorMode || "control";
        if (TD.setAdvisorMode) TD.setAdvisorMode(advisorMode);
        renderNextWaveCard();
      };
    });
    box.querySelectorAll("[data-advisor-action]").forEach((btn) => {
      btn.onclick = () => {
        const action = advisor[Number(btn.dataset.advisorAction)];
        if (TD.previewAdvisorAction && TD.previewAdvisorAction(action)) refreshUI();
      };
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
      <div class="affix-balance">預期：資源 ${pct(bal.goldDelta)} · 壓力 ${pct(bal.powerDelta)} · 淨值 ${pct(bal.netDelta)}</div>
      <div class="affix-impact">塔種影響：${affix.towerImpact || "依本局詞綴調整主力塔位置與升級順序。"}</div>`;
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
      const p = TD.previewNextWave({ advisorMode });
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
  function loadRawMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)); } catch { return null; }
  }
  function loadMeta() {
    return RULES.migrateMeta(loadRawMeta());
  }
  function saveMeta(m) {
    try {
      const result = RULES.protectMetaWrite
        ? RULES.protectMetaWrite(loadRawMeta(), m)
        : { ok: true, meta: RULES.migrateMeta(m) };
      localStorage.setItem(META_KEY, JSON.stringify(result.meta));
      if (!result.ok) showRecoveryNotice("存檔保護啟動：保留上一份有效資料。");
      return result.ok;
    } catch { return false; }
  }

  const SAVE_BACKUP_KEY = "td_meta_backup_v1";
  const SAVE_KIND = "td-save-v1";
  const META_IMPORT_KEYS = ["version", "soulCrystal", "bestWave", "bestByDiff", "board", "achievements", "beginnerMissions", "heroProgress", "games", "totalKills", "gachaCount"];

  function encodeTextBase64(text) {
    const bytes = new TextEncoder().encode(String(text || ""));
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function decodeTextBase64(code) {
    const binary = atob(String(code || "").trim());
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function buildSaveBundle() {
    return {
      kind: SAVE_KIND,
      exportedAt: Date.now(),
      meta: loadMeta(),
      heroes: [...ownedHeroes],
    };
  }

  function encodeSaveBundle(bundle) {
    return encodeTextBase64(JSON.stringify(bundle || buildSaveBundle()));
  }

  function decodeSaveCode(code) {
    const payload = JSON.parse(decodeTextBase64(code));
    const rawMeta = payload && payload.kind === SAVE_KIND ? payload.meta : payload;
    const heroes = payload && payload.kind === SAVE_KIND ? payload.heroes : null;
    return { payload, rawMeta, heroes };
  }

  function importableMetaShape(rawMeta) {
    if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) return false;
    return META_IMPORT_KEYS.some((key) => hasOwn(rawMeta, key));
  }

  function setSaveStatus(text, ok) {
    const box = $("saveStatus");
    if (!box) return;
    box.textContent = text || "";
    box.style.color = ok ? "#86efac" : "#fca5a5";
  }

  function exportSaveCode() {
    const code = encodeSaveBundle();
    const area = $("saveCode");
    if (area) area.value = code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code)
        .then(() => setSaveStatus("已匯出並複製 Base64 存檔碼。", true))
        .catch(() => setSaveStatus("已匯出，請手動複製存檔碼。", true));
    } else {
      setSaveStatus("已匯出，請手動複製存檔碼。", true);
    }
    return code;
  }

  function importSaveCode(code, options) {
    const opts = options || {};
    try {
      const parsed = decodeSaveCode(code);
      if (!importableMetaShape(parsed.rawMeta)) {
        setSaveStatus("匯入失敗：不是有效的無盡塔防存檔。", false);
        return { ok: false, reason: "invalid-shape" };
      }
      const result = RULES.protectMetaWrite
        ? RULES.protectMetaWrite(loadRawMeta(), parsed.rawMeta)
        : { ok: true, meta: RULES.migrateMeta(parsed.rawMeta) };
      if (!result.ok) {
        setSaveStatus("匯入失敗：存檔資料含壞值，已拒絕覆蓋。", false);
        return { ok: false, reason: result.reason || "invalid-meta" };
      }
      const currentHeroesRaw = localStorage.getItem(HERO_SAVE);
      let currentHeroes = [];
      try { currentHeroes = currentHeroesRaw ? JSON.parse(currentHeroesRaw) : []; } catch { currentHeroes = []; }
      const backup = { at: Date.now(), meta: loadRawMeta(), heroes: currentHeroes };
      localStorage.setItem(SAVE_BACKUP_KEY, JSON.stringify(backup));
      localStorage.setItem(META_KEY, JSON.stringify(result.meta));
      if (Array.isArray(parsed.heroes)) {
        const validHeroes = parsed.heroes.filter((id) => hasOwn(TD.config.HEROES, id));
        ownedHeroes = new Set(validHeroes);
        saveOwned();
      }
      setSaveStatus("匯入成功，已自動備份原存檔。", true);
      if (!opts.skipReload) setTimeout(() => location.reload(), 120);
      else { renderRoster(); renderPerformanceSettings(); }
      return { ok: true, meta: result.meta };
    } catch (err) {
      setSaveStatus("匯入失敗：Base64 或 JSON 格式錯誤。", false);
      return { ok: false, reason: "decode-failed" };
    }
  }

  function renderTextSizeSettings() {
    document.querySelectorAll("[data-text-size]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.textSize === textSize);
      btn.setAttribute("aria-label", `文字大小${TEXT_SIZE_LABELS[btn.dataset.textSize] || btn.dataset.textSize}`);
    });
    const box = $("textSizeStatus");
    if (box) box.textContent = `目前文字大小：${TEXT_SIZE_LABELS[textSize] || "中"}`;
  }

  function renderPwaSettings() {
    const pwa = window.__tdPwa;
    const version = $("pwaVersion");
    const status = $("updateStatus");
    if (version) version.textContent = `版本：${pwa && pwa.version ? pwa.version : "td-r37-v1"}`;
    if (status) status.textContent = pwa && pwa.status ? pwa.status : "離線更新尚未啟用";
    if (pwa) pwa.onStatus = renderPwaSettings;
  }

  async function checkPwaUpdate() {
    const btn = $("checkUpdateBtn");
    const pwa = window.__tdPwa;
    if (!pwa || typeof pwa.checkForUpdate !== "function") {
      const status = $("updateStatus");
      if (status) status.textContent = "此環境尚未提供離線更新";
      return;
    }
    if (btn) btn.disabled = true;
    try { await pwa.checkForUpdate(); }
    finally {
      if (btn) btn.disabled = false;
      renderPwaSettings();
    }
  }

  function renderPerformanceSettings() {
    const status = TD.getPerformanceStatus ? TD.getPerformanceStatus() : { mode: "auto", quality: "high", fps: 60 };
    document.querySelectorAll("[data-perf-mode]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.perfMode === status.mode);
    });
    const box = $("perfStatus");
    if (box) {
      const quality = status.quality === "low" ? "低特效" : "高特效";
      const reason = status.lastDowngradeLabel || status.reasonLabel || status.reason || "無";
      const particle = Math.round(((status.particleScale == null ? 1 : status.particleScale) * 100));
      const animation = Math.round(((status.animationScale == null ? 1 : status.animationScale) * 100));
      const history = (status.history || []).slice(0, 5)
        .map((item) => `${item.time || ""} ${item.type || ""}:${item.reasonLabel || item.reason || "未知"}`.trim())
        .join(" / ") || "無";
      box.textContent = `${status.modeLabel || "自動"}｜品質檔位 ${quality}｜即時 FPS ${status.fps || 60}｜最近降級原因 ${reason}｜粒子倍率 ${particle}%｜動畫倍率 ${animation}%｜最近5次 ${history}`;
    }
  }

  function openSettingsOverlay() {
    if ($("settingsOverlay").classList.contains("show")) return;
    settingsWasPaused = !!TD.state().paused;
    TD.setPaused(true);
    syncPauseButton(true);
    renderPerformanceSettings();
    renderTextSizeSettings();
    renderPwaSettings();
    setSaveStatus("", true);
    $("settingsOverlay").classList.add("show");
    focusSoon($("settingsClose"));
  }

  function closeSettingsOverlay() {
    $("settingsOverlay").classList.remove("show");
    if (!settingsWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
    focusSoon($("settingsBtn"));
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
    focusSoon($("progressClose"));
  }

  function closeProgressOverlay() {
    $("progressOverlay").classList.remove("show");
    if (!progressWasPaused && !TD.state().over) {
      TD.setPaused(false);
      syncPauseButton(false);
    }
    focusSoon($("boardBtn"));
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
    showBondToast(heroProgressResult.entries);
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
      const learning = RULES.analyzeRunReport
        ? RULES.analyzeRunReport({ wave, kills, leaks: run && run.leaks, towers: run && run.towers })
        : null;
      const learningLine = learning
        ? `<div class="run-review"><div class="rr-title">本局檢討</div><b>${learning.summary}</b>${learning.adjustments.map((item) => `<div>下一局：${item}</div>`).join("")}</div>`
        : "";
      metaLine.innerHTML = `
        <div class="diff-tag" style="color:${diff.color}">${diff.emoji} ${diff.label}難度</div>
        ${rankLine}
        ${isRecord ? '<div class="record">🎉 新紀錄！</div>' : `<div>此難度最高：第 ${meta.bestByDiff[diff.id]} 波</div>`}
        <div>💎 本局清波已獲得 +${earned}（目前 ${meta.soulCrystal}）</div>
        ${unlockLine}
        ${heroGrowthLine}
        ${learningLine}
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
    focusSoon($("deathCtaBtn"));
  }

  // ===== 綁定控制 =====
  $("startBtn").title = "Enter：開始下一波";
  $("speed2").title = "T：切換 1× / 2×";
  $("pauseBtn").title = "Space / P：暫停或繼續";
  $("gachaBtn").title = "H：抽英雄";
  function hideWaveWarning() {
    const box = $("waveWarning");
    if (box) box.classList.remove("show");
  }

  function showWaveWarning(warning) {
    const box = $("waveWarning");
    if (!box || !warning) return;
    const serial = ++warningSerial;
    box.textContent = `⚠️ ${warning.message}`;
    box.classList.add("show");
    setTimeout(() => {
      if (serial === warningSerial) box.classList.remove("show");
    }, 2600);
  }

  function startWaveWithAdvisor() {
    const p = TD.previewNextWave ? TD.previewNextWave({ advisorMode }) : null;
    if (p && p.counterWarning) showWaveWarning(p.counterWarning);
    else hideWaveWarning();
    TD.startWave();
    refreshUI();
  }

  $("startBtn").onclick = () => { startWaveWithAdvisor(); };
  $("goddessBtn").onclick = () => { TD.upgradeGoddess(); refreshUI(); };
  $("gachaBtn").onclick = () => { $("gachaBtn").blur(); doGacha(); };
  $("boardBtn").onclick = () => { openProgressOverlay(); };
  $("settingsBtn").onclick = () => { openSettingsOverlay(); };
  $("progressClose").onclick = () => { closeProgressOverlay(); };
  $("settingsClose").onclick = () => { closeSettingsOverlay(); };
  $("heroDetailClose").onclick = () => { closeHeroDetail(); };
  $("restartBtn").onclick = restartRun;
  $("upgBtn").onclick = () => { TD.upgradeSelected(); refreshUI(); };
  $("sellBtn").onclick = () => { TD.sellSelected(); refreshUI(); };
  $("exportSaveBtn").onclick = () => { exportSaveCode(); };
  $("importSaveBtn").onclick = () => { importSaveCode(($("saveCode") && $("saveCode").value) || ""); };
  document.querySelectorAll("[data-perf-mode]").forEach((btn) => {
    btn.onclick = () => {
      if (TD.setPerformanceMode) TD.setPerformanceMode(btn.dataset.perfMode);
      renderPerformanceSettings();
    };
  });
  document.querySelectorAll("[data-text-size]").forEach((btn) => {
    btn.onclick = () => setTextSize(btn.dataset.textSize);
  });
  if ($("checkUpdateBtn")) $("checkUpdateBtn").onclick = () => { checkPwaUpdate(); };
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
      e.code === "Enter" || e.code === "Space" ||
      e.code === "Escape" || key === "p" || key === "h" || key === "t");
  }
  document.addEventListener("keydown", (e) => {
    if (isTextEntryTarget(e.target)) return;
    if (isShown("heroDetailOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeHeroDetail(); }
      else if (e.code !== "Tab") e.preventDefault();
      return;
    }
    if (isShown("settingsOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeSettingsOverlay(); }
      else if (e.code !== "Tab") e.preventDefault();
      return;
    }
    if (isShown("progressOverlay")) {
      if (e.code === "Escape") { e.preventDefault(); closeProgressOverlay(); }
      else if (e.code !== "Tab") { e.preventDefault(); }
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
    } else if (lower === "t") {
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
  window.__tdStartWaveWithAdvisor = startWaveWithAdvisor;
  window.__tdSafeSaveMeta = saveMeta;
  window.__tdPerformanceChanged = renderPerformanceSettings;
  window.__tdSaveManager = {
    export: exportSaveCode,
    import: importSaveCode,
    encode: encodeSaveBundle,
    decode: decodeSaveCode,
    backupKey: SAVE_BACKUP_KEY,
  };
  window.__tdSettings = {
    setTextSize,
    getTextSize: () => textSize,
    renderPwaSettings,
  };

  function handleRuntimeFault() {
    saveMeta(loadMeta());
    showRecoveryNotice("遊戲遇到錯誤，已保護存檔。重新整理即可繼續。");
  }
  window.onerror = () => { handleRuntimeFault(); return false; };
  window.addEventListener("error", () => { handleRuntimeFault(); });
  window.addEventListener("unhandledrejection", () => { handleRuntimeFault(); });

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
        focusSoon(document.querySelector(".map-opt"));
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
      focusSoon($("tutorialQuick"));
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
        focusSoon(document.querySelector(".diff-opt"));
      };
    } else {
      // 看過引導：直接顯示難度選擇
      renderDifficulties(); $("diffOverlay").classList.add("show");
      focusSoon(document.querySelector(".diff-opt"));
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
