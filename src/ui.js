/* =========================================================================
 * ui.js — 塔防 UI/HUD（建塔選單、技能列、升級面板、遊戲結束）
 * 透過 window.TD 接口與 game.js 溝通；game.js 透過 window.__tdUI 等回呼通知 UI 更新。
 * ========================================================================= */

(() => {
  "use strict";
  const { TOWERS, SKILLS } = TD.config;
  const $ = (id) => document.getElementById(id);

  // ===== 建塔選單 =====
  const towerList = $("towerList");
  Object.values(TOWERS).forEach((t) => {
    const btn = document.createElement("button");
    btn.className = "tower-btn"; btn.dataset.type = t.id;
    btn.innerHTML = `
      <span class="ico">${t.emoji}</span>
      <span class="info"><span class="nm">${t.name}</span><br><span class="meta">${t.desc}</span></span>
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
    btn.innerHTML = `
      <span class="ico">${s.emoji}</span>
      <span class="info"><span class="nm">${s.name}</span><br><span class="meta">${s.desc}</span></span>
      <span class="cdtext" data-cd="${s.id}"></span>`;
    btn.onclick = () => { TD.selectSkill(s.id); refreshUI(); };
    skillList.appendChild(btn);
  });

  // ===== HUD 與整體刷新 =====
  function refreshUI() {
    const st = TD.state();
    $("gold").textContent = st.gold;
    $("goddessHp").textContent = Math.max(0, Math.round(st.goddess.hp));
    $("goddessMax").textContent = st.goddess.maxHp;
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

    // 開始按鈕：只有波間可按
    $("startBtn").disabled = !st.betweenWaves || st.over;

    // 選中塔的升級面板
    const sel = $("selPanel");
    if (st.selectedTower) {
      const tw = st.selectedTower, def = TOWERS[tw.type];
      const maxed = tw.level >= TD.config.UPGRADE.maxLevel;
      $("selInfo").innerHTML = `
        <b>${def.emoji} ${def.name}</b> Lv.${tw.level}<br>
        傷害 ${Math.round(TD.towerStat(tw, "damage"))} · 射程 ${Math.round(TD.towerStat(tw, "range"))}`;
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

  // ===== 遊戲結束 =====
  function onGameOver(wave, score) {
    $("finalWave").textContent = wave;
    $("finalScore").textContent = score;
    $("overlay").classList.add("show");
  }

  // ===== 綁定控制 =====
  $("startBtn").onclick = () => { TD.startWave(); refreshUI(); };
  $("goddessBtn").onclick = () => { TD.upgradeGoddess(); refreshUI(); };
  $("restartBtn").onclick = () => { $("overlay").classList.remove("show"); TD.newGame(); refreshUI(); };
  $("upgBtn").onclick = () => { TD.upgradeSelected(); refreshUI(); };
  $("sellBtn").onclick = () => { TD.sellSelected(); refreshUI(); };
  document.querySelectorAll(".speed").forEach((b) => {
    b.onclick = () => {
      TD.setSpeed(Number(b.dataset.s));
      document.querySelectorAll(".speed").forEach((x) => x.classList.toggle("on", x === b));
    };
  });

  // 把回呼掛給 game.js
  window.__tdUI = refreshUI;
  window.__tdLog = pushLog;
  window.__tdGameOver = onGameOver;

  refreshUI();
  pushLog("放置砲塔後點「開始下一波」。火克冰、冰克雷、雷克火！");
})();
