/* =========================================================================
 * game.js — 塔防核心引擎（Canvas 2D，純原生，無盡波次）
 *
 * 架構：
 *   - 固定時間步的遊戲迴圈（requestAnimationFrame + dt）
 *   - 路徑用一串 waypoint，敵人沿路徑行進，漏過終點扣生命
 *   - 塔放在格位上，自動瞄準射程內敵人發射子彈
 *   - 無盡波次：每波難度遞增、隨機組成，每 N 波出 Boss
 *   - 主動技能：點技能 → 進入瞄準 → 點地圖施放
 * ========================================================================= */

(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const CELL = GAME.cellSize;

  // 路徑 waypoints（像素座標）— 一條蜿蜒路徑
  const PATH = [
    { x: 0,   y: 120 }, { x: 360, y: 120 }, { x: 360, y: 300 },
    { x: 120, y: 300 }, { x: 120, y: 460 }, { x: 600, y: 460 },
    { x: 600, y: 220 }, { x: 840, y: 220 }, { x: 840, y: 560 }, { x: 960, y: 560 },
  ];

  // 預先算出「禁止建塔」的格位（路徑經過的格）
  const blocked = new Set();
  function cellKey(cx, cy) { return cx + "," + cy; }
  (function markPathCells() {
    for (let i = 0; i < PATH.length - 1; i++) {
      const a = PATH[i], b = PATH[i + 1];
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 10);
      for (let s = 0; s <= steps; s++) {
        const x = a.x + (b.x - a.x) * (s / steps);
        const y = a.y + (b.y - a.y) * (s / steps);
        // 只禁路徑本身覆蓋到的格（含因路寬跨到的相鄰格），不擴整圈，
        // 讓玩家能緊貼路徑建塔、射程搆得到。
        blocked.add(cellKey(Math.floor(x / CELL), Math.floor(y / CELL)));
        blocked.add(cellKey(Math.floor((x - CELL * 0.4) / CELL), Math.floor(y / CELL)));
        blocked.add(cellKey(Math.floor((x + CELL * 0.4) / CELL), Math.floor(y / CELL)));
        blocked.add(cellKey(Math.floor(x / CELL), Math.floor((y - CELL * 0.4) / CELL)));
        blocked.add(cellKey(Math.floor(x / CELL), Math.floor((y + CELL * 0.4) / CELL)));
      }
    }
  })();

  // ===== 遊戲狀態 =====
  let state;
  let lastT = 0;
  let loopToken = 0;
  function newGame() {
    loopToken++; // 作廢任何正在跑的舊迴圈
    const end = PATH[PATH.length - 1];
    state = {
      gold: GAME.startGold, wave: 0, score: 0,
      // 守護女神：被保護的核心
      goddess: { level: 1, hp: GODDESS.baseHp, maxHp: GODDESS.baseHp, x: end.x, y: end.y, smiteCd: 0, hitFlash: 0 },
      towers: [], heroes: [], enemies: [], bullets: [], particles: [],
      spawnQueue: [], spawnTimer: 0, clock: 0, mouse: null,
      running: false, over: false, betweenWaves: true,
      selectedTowerType: null,   // 準備建造的塔
      selectedTower: null,        // 已選中的塔（看升級）
      pendingSkill: null,         // 準備施放的技能
      skillCooldowns: {},         // 技能冷卻計時
      speed: 1,                    // 遊戲速度倍率
    };
    Object.keys(SKILLS).forEach((k) => (state.skillCooldowns[k] = 0));
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // ===== 波次系統（無盡隨機遞增）=====
  function startWave() {
    if (state.over) return;
    state.wave++;
    state.betweenWaves = false;
    const w = state.wave;
    const isBoss = w % GAME.bossEveryWaves === 0;
    const hpScale = Math.pow(1 + GAME.hpGrowthPerWave, w - 1); // 血量隨波遞增

    const queue = [];
    const baseCount = 6 + Math.floor(w * 1.5); // 敵人數隨波增加
    const pool = ["slime", "goblin", "orc", "bat"];
    for (let i = 0; i < baseCount; i++) {
      // 隨機挑敵人，越後期越偏向強的
      let pick;
      const r = Math.random();
      if (w < 3) pick = r < 0.7 ? "slime" : "goblin";
      else if (r < 0.35) pick = "slime";
      else if (r < 0.6) pick = "goblin";
      else if (r < 0.8) pick = "bat";
      else pick = "orc";
      queue.push({ type: pick, hpScale });
    }
    if (isBoss) queue.push({ type: "boss", hpScale: hpScale * 1.2 }); // Boss 壓軸
    state.spawnQueue = queue;
    state.spawnTimer = 0;
    startLoop();
    log(`第 ${w} 波來襲！${isBoss ? "⚠️ Boss 出現！" : ""}`);
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  function spawnEnemy(spec) {
    const def = ENEMIES[spec.type];
    const maxHp = Math.round(def.hp * spec.hpScale);
    state.enemies.push({
      ...def, x: PATH[0].x, y: PATH[0].y, wp: 1,
      hp: maxHp, maxHp, slowUntil: 0, slowFactor: 1, frozenUntil: 0,
      uid: "e" + (Math.random() * 1e9 | 0),
    });
  }

  // ===== 主迴圈 =====
  // loopToken 確保同時只有一個迴圈在跑：每次 startLoop 換新 token，
  // 舊迴圈發現 token 變了就自行結束（避免 newGame/startWave 造成多重迴圈疊加，
  // 那會讓 update 每幀被呼叫多次、單位移動量爆增）。lastT/loopToken 已在上方宣告。
  function startLoop() {
    if (state.running) return; // 已在跑
    state.running = true;
    const myToken = ++loopToken;
    lastT = 0; // 重置時間基準，避免第一幀 dt 異常
    function loop(t) {
      if (myToken !== loopToken || !state.running || state.over) return; // 不是當前迴圈或已結束
      if (!t) t = 0;
      if (!lastT) lastT = t; // 第一幀對齊
      let dt = (t - lastT) / 1000;
      lastT = t;
      if (dt > 0.05) dt = 0.05; // 防止分頁切換造成大跳
      dt *= state.speed;
      update(dt);
      render();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  function update(dt) {
    // 生成本波敵人
    if (state.spawnQueue.length > 0) {
      state.spawnTimer -= dt;
      if (state.spawnTimer <= 0) {
        spawnEnemy(state.spawnQueue.shift());
        state.spawnTimer = GAME.spawnInterval;
      }
    }

    // 技能冷卻
    Object.keys(state.skillCooldowns).forEach((k) => {
      if (state.skillCooldowns[k] > 0) state.skillCooldowns[k] = Math.max(0, state.skillCooldowns[k] - dt);
    });

    // 女神聖光反擊（2 級起解鎖）：定期攻擊終點附近的敵人
    const gd = state.goddess;
    if (gd.hitFlash > 0) gd.hitFlash = Math.max(0, gd.hitFlash - dt);
    if (gd.level >= GODDESS.smiteUnlockLevel) {
      gd.smiteCd -= dt;
      if (gd.smiteCd <= 0) {
        const targets = state.enemies.filter((e) => !e._dead && Math.hypot(e.x - gd.x, e.y - gd.y) <= GODDESS.smiteRange);
        if (targets.length) {
          const t = targets.sort((a, b) => b.wp - a.wp)[0]; // 打最接近終點的
          t.hp -= GODDESS.smiteDamage;
          state.bullets.push({ x: gd.x, y: gd.y, target: t, speed: 500, color: "#fde047", damage: 0, element: "physical", _holy: true });
          burst(t.x, t.y, "#fde047", 8);
          if (t.hp <= 0) killEnemy(t);
          gd.smiteCd = GODDESS.smiteInterval;
        }
      }
    }

    // 敵人移動
    for (const e of state.enemies) {
      const frozen = e.frozenUntil > state.clock;
      const slowed = e.slowUntil > state.clock;
      const spd = frozen ? 0 : e.speed * (slowed ? e.slowFactor : 1);
      const target = PATH[e.wp];
      if (!target) { leak(e); continue; }
      const dx = target.x - e.x, dy = target.y - e.y;
      const dist = Math.hypot(dx, dy);
      const step = spd * dt;
      if (step >= dist) { e.x = target.x; e.y = target.y; e.wp++; if (e.wp >= PATH.length) leak(e); }
      else { e.x += (dx / dist) * step; e.y += (dy / dist) * step; }
    }
    state.enemies = state.enemies.filter((e) => !e._dead && !e._leaked);

    // 塔射擊
    for (const tw of state.towers) {
      tw.cd -= dt;
      if (tw.cd > 0) continue;
      const target = acquireTarget(tw);
      if (target) { fire(tw, target); tw.cd = 1 / towerStat(tw, "fireRate"); }
    }

    // 英雄：自主尋敵、移動、攻擊
    for (const h of state.heroes) updateHero(h, dt);

    // 子彈移動
    for (const b of state.bullets) {
      if (b.target && !b.target._dead) {
        const dx = b.target.x - b.x, dy = b.target.y - b.y;
        const d = Math.hypot(dx, dy);
        const step = b.speed * dt;
        if (step >= d) { hit(b); b._done = true; }
        else { b.x += (dx / d) * step; b.y += (dy / d) * step; }
      } else { b._done = true; }
    }
    state.bullets = state.bullets.filter((b) => !b._done);

    // 粒子
    for (const p of state.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 200 * dt; }
    state.particles = state.particles.filter((p) => p.life > 0);

    state.clock += dt;

    // 波次結束判定
    if (!state.betweenWaves && state.spawnQueue.length === 0 && state.enemies.length === 0) {
      state.betweenWaves = true;
      state.gold += GAME.waveBonus;
      state.score += state.wave * 10;
      log(`第 ${state.wave} 波清空！+${GAME.waveBonus} 金`);
      if (typeof window.__tdUI === "function") window.__tdUI();
    }
  }
  // 敵人漏過終點 = 攻擊守護女神
  function leak(e) {
    if (e._leaked || e._dead) return;
    e._leaked = true;
    const dmg = e.leak * (e.boss ? 4 : 3); // 漏過對女神造成的傷害
    state.goddess.hp -= dmg;
    state.goddess.hitFlash = 0.4;
    burst(state.goddess.x, state.goddess.y, "#ef4444", 14);
    log(`${e.name} 攻擊了${GODDESS.name}！-${dmg} 生命`, "bad");
    if (state.goddess.hp <= 0) { state.goddess.hp = 0; gameOver(); }
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // ===== 英雄系統 =====
  // 上場：在女神（終點）附近放一個英雄
  function deployHero(heroId) {
    const def = HEROES[heroId];
    if (!def) return false;
    const end = PATH[PATH.length - 1];
    const h = {
      id: heroId, level: 1, xp: 0,
      x: end.x - 60 + (Math.random() * 40 - 20), y: end.y - 60 + (Math.random() * 40 - 20),
      hp: heroStat({ id: heroId, level: 1 }, "hp"), maxHp: heroStat({ id: heroId, level: 1 }, "hp"),
      facing: "down", cd: 0, hitFlash: 0, uid: "h" + (Math.random() * 1e9 | 0),
    };
    state.heroes.push(h);
    log(`${def.name} 上場！`);
    if (typeof window.__tdUI === "function") window.__tdUI();
    return true;
  }

  function updateHero(h, dt) {
    const def = HEROES[h.id];
    if (h.hitFlash > 0) h.hitFlash = Math.max(0, h.hitFlash - dt);
    // 尋找最近的活著敵人
    let target = null, best = Infinity;
    for (const e of state.enemies) {
      if (e._dead) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      if (d < best) { best = d; target = e; }
    }
    h.cd -= dt;
    if (!target) {
      // 無敵人：回到女神身邊待命
      const home = { x: state.goddess.x - 50, y: state.goddess.y - 50 };
      moveToward(h, home.x, home.y, def.speed, dt);
      return;
    }
    const range = def.range;
    if (best > range) {
      // 追向敵人
      moveToward(h, target.x, target.y, def.speed, dt);
    } else {
      // 在攻擊範圍內：面向目標（即使不移動也轉向）
      faceToward(h, target.x, target.y);
      if (h.cd <= 0) { heroAttack(h, target); h.cd = 1 / def.atkRate; }
    }
  }

  // 設定朝向（四方向精靈圖切換用）
  function faceToward(h, tx, ty) {
    const dx = tx - h.x, dy = ty - h.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    if (Math.abs(dx) > Math.abs(dy)) h.facing = dx > 0 ? "right" : "left";
    else h.facing = dy > 0 ? "down" : "up";
  }

  function moveToward(h, tx, ty, speed, dt) {
    const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d < 2) return;
    faceToward(h, tx, ty); // 先定朝向，再移動
    const step = Math.min(d, speed * dt);
    h.x += (dx / d) * step; h.y += (dy / d) * step;
  }

  function heroAttack(h, target) {
    const def = HEROES[h.id];
    const atk = heroStat(h, "atk");
    if (def.role === "ranged") {
      // 遠程：發射子彈
      state.bullets.push({
        x: h.x, y: h.y, target, speed: 360, color: def.color,
        damage: atk, element: def.element, splash: def.splash || 0, slow: def.slow || 0,
        _heroOwner: h,
      });
    } else {
      // 近戰：直接造成傷害
      const mult = elementMultiplier(def.element, target.element);
      target.hp -= atk * mult;
      burst(target.x, target.y, def.color, 8);
      if (target.hp <= 0) { killEnemy(target); grantXp(h, target); }
    }
    // 牧師治療女神
    if (def.healGoddess) {
      state.goddess.hp = Math.min(state.goddess.maxHp, state.goddess.hp + def.healGoddess);
    }
  }

  // 英雄獲得經驗並升級
  function grantXp(h, enemy) {
    const def = HEROES[h.id];
    if (h.level >= HERO_LEVEL.maxLevel) return;
    h.xp += HERO_LEVEL.xpPerKill * (enemy.boss ? 5 : 1);
    while (h.level < HERO_LEVEL.maxLevel && h.xp >= xpForLevel(h.level)) {
      h.xp -= xpForLevel(h.level);
      h.level++;
      const newMax = heroStat(h, "hp");
      h.hp = newMax; h.maxHp = newMax; // 升級回滿
      burst(h.x, h.y, "#fde047", 20);
      flashText(h.x, h.y, "LV UP!");
      log(`${def.name} 升到 ${h.level} 級！`);
    }
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // 擊殺
  function killEnemy(e) {
    if (e._dead) return;
    e._dead = true;
    state.gold += e.reward;
    state.score += e.reward;
    burst(e.x, e.y, e.color, e.boss ? 30 : 10);
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // ===== 塔瞄準與射擊 =====
  function towerStat(tw, key) {
    const base = TOWERS[tw.type][key];
    if (key === "damage") return base * Math.pow(UPGRADE.damageMul, tw.level - 1);
    if (key === "range") return base * Math.pow(UPGRADE.rangeMul, tw.level - 1);
    return base;
  }
  function acquireTarget(tw) {
    const range = towerStat(tw, "range");
    let best = null, bestProg = -1;
    for (const e of state.enemies) {
      if (e._dead) continue;
      const d = Math.hypot(e.x - tw.x, e.y - tw.y);
      if (d <= range) {
        const prog = e.wp + (1 - 0); // 越前面越優先
        if (prog > bestProg) { bestProg = prog; best = e; }
      }
    }
    return best;
  }
  function fire(tw, target) {
    const def = TOWERS[tw.type];
    state.bullets.push({
      x: tw.x, y: tw.y, target, speed: 320, color: def.color,
      damage: towerStat(tw, "damage"), element: def.element,
      splash: def.splash || 0, slow: def.slow || 0, pierce: def.pierce || 0, type: tw.type,
    });
  }
  function hit(b) {
    if (b.splash) {
      // 範圍傷害
      for (const e of state.enemies) {
        if (e._dead) continue;
        if (Math.hypot(e.x - b.target.x, e.y - b.target.y) <= b.splash) dealDamage(e, b);
      }
      burst(b.target.x, b.target.y, b.color, 12);
    } else if (b.pierce) {
      // 穿透：打最近的 pierce 個
      const near = state.enemies.filter((e) => !e._dead && Math.hypot(e.x - b.target.x, e.y - b.target.y) < 60)
        .slice(0, b.pierce);
      (near.length ? near : [b.target]).forEach((e) => dealDamage(e, b));
    } else {
      dealDamage(b.target, b);
    }
  }
  function dealDamage(e, b) {
    if (e._dead) return;
    const mult = elementMultiplier(b.element, e.element);
    e.hp -= b.damage * mult;
    if (b.slow) { e.slowUntil = state.clock + 1.5; e.slowFactor = 1 - b.slow; }
    if (e.hp <= 0) { killEnemy(e); if (b._heroOwner && state.heroes.includes(b._heroOwner)) grantXp(b._heroOwner, e); }
  }

  // ===== 主動技能 =====
  function castSkill(skillId, x, y) {
    const sk = SKILLS[skillId];
    if (!sk || state.skillCooldowns[skillId] > 0) return false;
    state.skillCooldowns[skillId] = sk.cooldown;
    for (const e of state.enemies) {
      if (e._dead) continue;
      if (Math.hypot(e.x - x, e.y - y) <= sk.radius) {
        const mult = elementMultiplier(sk.element, e.element);
        e.hp -= sk.damage * mult;
        if (sk.freezeDur) e.frozenUntil = state.clock + sk.freezeDur;
        if (e.hp <= 0) killEnemy(e);
      }
    }
    burst(x, y, sk.color, 40);
    log(`施放 ${sk.name}！`);
    if (typeof window.__tdUI === "function") window.__tdUI();
    return true;
  }

  // ===== 建塔 / 升級 =====
  function tryBuildTower(px, py) {
    if (!state.selectedTowerType) return;
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    if (blocked.has(cellKey(cx, cy))) { log("不能蓋在路徑上！", "bad"); return; }
    if (state.towers.some((t) => t.cx === cx && t.cy === cy)) { log("這裡已有塔！", "bad"); return; }
    const def = TOWERS[state.selectedTowerType];
    if (state.gold < def.cost) { log("金錢不足！", "bad"); return; }
    state.gold -= def.cost;
    state.towers.push({
      type: state.selectedTowerType, cx, cy,
      x: cx * CELL + CELL / 2, y: cy * CELL + CELL / 2,
      level: 1, cd: 0,
    });
    log(`建造 ${def.name}！`);
    if (typeof window.__tdUI === "function") window.__tdUI();
  }
  function upgradeTower(tw) {
    if (tw.level >= UPGRADE.maxLevel) { log("已達最高等級！", "bad"); return; }
    const cost = Math.round(TOWERS[tw.type].cost * Math.pow(UPGRADE.costMul, tw.level));
    if (state.gold < cost) { log("金錢不足以升級！", "bad"); return; }
    state.gold -= cost;
    tw.level++;
    log(`${TOWERS[tw.type].name} 升到 ${tw.level} 級！`);
    if (typeof window.__tdUI === "function") window.__tdUI();
  }
  function upgradeCost(tw) { return Math.round(TOWERS[tw.type].cost * Math.pow(UPGRADE.costMul, tw.level)); }
  function sellTower(tw) {
    const refund = Math.round(TOWERS[tw.type].cost * 0.6 * tw.level);
    state.gold += refund;
    state.towers = state.towers.filter((t) => t !== tw);
    state.selectedTower = null;
    log(`賣出 ${TOWERS[tw.type].name}，回收 ${refund} 金。`);
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // ===== 守護女神升級 =====
  function goddessUpgradeCost() {
    return Math.round(GODDESS.upgradeCostBase * Math.pow(GODDESS.upgradeCostMul, state.goddess.level - 1));
  }
  function upgradeGoddess() {
    const gd = state.goddess;
    if (gd.level >= GODDESS.maxLevel) { log("女神已達最高等級！", "bad"); return; }
    const cost = goddessUpgradeCost();
    if (state.gold < cost) { log("金錢不足以升級女神！", "bad"); return; }
    state.gold -= cost;
    gd.level++;
    gd.maxHp += GODDESS.hpPerLevel;
    gd.hp = gd.maxHp; // 升級回滿
    burst(gd.x, gd.y, "#fde047", 30);
    const unlocked = gd.level === GODDESS.smiteUnlockLevel ? "（解鎖聖光反擊！）" : "";
    log(`${GODDESS.name} 升到 ${gd.level} 級！生命上限 +${GODDESS.hpPerLevel} ${unlocked}`);
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // ===== 粒子 =====
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 120;
      state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.4 + Math.random() * 0.3, color });
    }
  }
  // 浮動文字（升級提示）— 用 particle 帶 text 欄位實作
  function flashText(x, y, text) {
    state.particles.push({ x, y, vx: 0, vy: -40, life: 1.0, color: "#fde047", text });
  }

  function gameOver() {
    state.over = true; state.running = false;
    log(`💀 遊戲結束！撐到第 ${state.wave} 波，得分 ${state.score}`, "bad");
    if (typeof window.__tdGameOver === "function") window.__tdGameOver(state.wave, state.score);
  }

  // ===== 渲染 =====
  function render() {
    ctx.clearRect(0, 0, W, H);
    drawBackground();
    drawPath();
    if (state.selectedTowerType) drawBuildPreview();
    drawGoddess();
    for (const tw of state.towers) drawTower(tw);
    for (const h of state.heroes) drawHero(h);
    for (const e of state.enemies) drawEnemy(e);
    for (const b of state.bullets) drawBullet(b);
    for (const p of state.particles) drawParticle(p);
    if (state.selectedTower) drawTowerRange(state.selectedTower);
  }

  // 英雄繪製（四方向精靈圖：有 sprites 用對應方向圖，否則 emoji）
  function drawHero(h) {
    const def = HEROES[h.id];
    const size = CELL * 0.85;
    // 圓形光環底（區別於敵人）
    ctx.strokeStyle = def.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(h.x, h.y, size * 0.55, 0, Math.PI * 2); ctx.stroke();
    if (h.hitFlash > 0) { ctx.fillStyle = `rgba(239,68,68,${h.hitFlash})`; ctx.beginPath(); ctx.arc(h.x, h.y, size * 0.6, 0, Math.PI * 2); ctx.fill(); }
    // 美術接點：sprites 物件存在則用對應方向圖；否則 emoji
    const spritePath = def.sprites && def.sprites[h.facing];
    if (spritePath) {
      const im = getImg(spritePath);
      if (im && im.complete && im.naturalWidth > 0) {
        // left 方向用右圖水平翻轉（若只有 right），這裡假設四方向都有
        ctx.drawImage(im, h.x - size / 2, h.y - size / 2, size, size);
      } else drawSprite(spritePath, def.emoji, h.x, h.y, size);
    } else {
      ctx.font = size * 0.7 + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(def.emoji, h.x, h.y);
    }
    // 血條
    const w = size, pct = Math.max(0, h.hp / h.maxHp);
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(h.x - w / 2, h.y - size / 2 - 8, w, 4);
    ctx.fillStyle = pct > 0.5 ? "#4ade80" : pct > 0.25 ? "#facc15" : "#ef4444";
    ctx.fillRect(h.x - w / 2, h.y - size / 2 - 8, w * pct, 4);
    // 等級
    ctx.fillStyle = "#fde047"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Lv" + h.level, h.x, h.y + size / 2 + 8);
  }

  // 守護女神（終點核心）
  function drawGoddess() {
    const gd = state.goddess;
    // 聖光反擊範圍（解鎖後顯示淡圈）
    if (gd.level >= GODDESS.smiteUnlockLevel) {
      ctx.strokeStyle = "rgba(253,224,71,.25)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(gd.x, gd.y, GODDESS.smiteRange, 0, Math.PI * 2); ctx.stroke();
    }
    // 聖光底座
    const glow = ctx.createRadialGradient(gd.x, gd.y, 4, gd.x, gd.y, CELL);
    glow.addColorStop(0, "rgba(253,224,71,.5)"); glow.addColorStop(1, "transparent");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(gd.x, gd.y, CELL, 0, Math.PI * 2); ctx.fill();
    // 受擊閃紅
    if (gd.hitFlash > 0) { ctx.fillStyle = `rgba(239,68,68,${gd.hitFlash})`; ctx.beginPath(); ctx.arc(gd.x, gd.y, CELL * 0.9, 0, Math.PI * 2); ctx.fill(); }
    // 女神本體
    drawSprite("assets/core/goddess.png", GODDESS.emoji, gd.x, gd.y, CELL * 1.3);
    // 生命條
    const w = CELL * 1.4, pct = Math.max(0, gd.hp / gd.maxHp);
    ctx.fillStyle = "rgba(0,0,0,.7)"; ctx.fillRect(gd.x - w / 2, gd.y - CELL * 0.95, w, 6);
    ctx.fillStyle = pct > 0.5 ? "#4ade80" : pct > 0.25 ? "#facc15" : "#ef4444";
    ctx.fillRect(gd.x - w / 2, gd.y - CELL * 0.95, w * pct, 6);
    // 等級
    ctx.fillStyle = "#fde047"; ctx.font = "bold 11px sans-serif"; ctx.textAlign = "center";
    ctx.fillText("Lv." + gd.level, gd.x, gd.y + CELL * 0.85);
  }

  function drawBackground() {
    ctx.fillStyle = "#0e1a14"; ctx.fillRect(0, 0, W, H);
    // 草地格紋
    ctx.strokeStyle = "rgba(255,255,255,.03)";
    for (let x = 0; x < W; x += CELL) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += CELL) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }
  function drawPath() {
    ctx.strokeStyle = "#3b2f1f"; ctx.lineWidth = CELL * 0.85; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let i = 1; i < PATH.length; i++) ctx.lineTo(PATH[i].x, PATH[i].y);
    ctx.stroke();
    ctx.strokeStyle = "#5a4a32"; ctx.lineWidth = CELL * 0.7; ctx.stroke();
    // 終點由守護女神鎮守（drawGoddess 繪製）
  }
  function drawBuildPreview() {
    const m = state.mouse; if (!m) return;
    const cx = Math.floor(m.x / CELL), cy = Math.floor(m.y / CELL);
    const ok = !blocked.has(cellKey(cx, cy)) && !state.towers.some((t) => t.cx === cx && t.cy === cy);
    ctx.fillStyle = ok ? "rgba(74,222,128,.3)" : "rgba(239,68,68,.3)";
    ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
    const def = TOWERS[state.selectedTowerType];
    ctx.strokeStyle = ok ? "#4ade80" : "#ef4444"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx * CELL + CELL / 2, cy * CELL + CELL / 2, def.range, 0, Math.PI * 2); ctx.stroke();
  }
  function drawTowerRange(tw) {
    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(tw.x, tw.y, towerStat(tw, "range"), 0, Math.PI * 2); ctx.stroke();
  }
  const imgCache = {};
  function getImg(path) {
    if (imgCache[path] === undefined) {
      const im = new Image(); im.src = path; im.onerror = () => (imgCache[path] = null);
      imgCache[path] = im;
    }
    return imgCache[path];
  }
  function drawSprite(path, emoji, x, y, size, color) {
    const im = getImg(path);
    if (im && im.complete && im.naturalWidth > 0) ctx.drawImage(im, x - size / 2, y - size / 2, size, size);
    else { ctx.font = size * 0.8 + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(emoji, x, y); }
  }
  function drawTower(tw) {
    const def = TOWERS[tw.type];
    // 底座
    ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.beginPath(); ctx.arc(tw.x, tw.y, CELL * 0.42, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 2; ctx.stroke();
    drawSprite(`assets/towers/${tw.type}.png`, def.emoji, tw.x, tw.y, CELL * 0.7);
    // 等級星
    if (tw.level > 1) {
      ctx.fillStyle = "#facc15"; ctx.font = "10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("★".repeat(tw.level - 1), tw.x, tw.y + CELL * 0.42);
    }
  }
  function drawEnemy(e) {
    const size = e.boss ? CELL * 1.1 : CELL * 0.6;
    drawSprite(`assets/enemies/${e.id}.png`, e.emoji, e.x, e.y, size);
    // 血條
    const w = size, hpPct = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = "rgba(0,0,0,.6)"; ctx.fillRect(e.x - w / 2, e.y - size / 2 - 8, w, 4);
    ctx.fillStyle = hpPct > 0.5 ? "#4ade80" : hpPct > 0.25 ? "#facc15" : "#ef4444";
    ctx.fillRect(e.x - w / 2, e.y - size / 2 - 8, w * hpPct, 4);
    // 冰凍/減速標記
    if (e.frozenUntil > state.clock) { ctx.fillStyle = "rgba(56,189,248,.4)"; ctx.beginPath(); ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2); ctx.fill(); }
    else if (e.slowUntil > state.clock) { ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2); ctx.stroke(); }
  }
  function drawBullet(b) {
    ctx.fillStyle = b.color; ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = b.color; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
  }
  function drawParticle(p) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 2));
    if (p.text) {
      // 浮動文字（升級提示）
      ctx.fillStyle = p.color; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center";
      ctx.strokeStyle = "rgba(0,0,0,.7)"; ctx.lineWidth = 3; ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
    } else {
      ctx.fillStyle = p.color; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  // ===== 輸入 =====
  function canvasPos(ev) {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) };
  }
  canvas.addEventListener("mousemove", (ev) => { state.mouse = canvasPos(ev); });
  canvas.addEventListener("click", (ev) => {
    const p = canvasPos(ev);
    if (state.pendingSkill) { castSkill(state.pendingSkill, p.x, p.y); state.pendingSkill = null; canvas.style.cursor = "default"; return; }
    if (state.selectedTowerType) { tryBuildTower(p.x, p.y); return; }
    // 點既有塔 → 選中
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    const tw = state.towers.find((t) => t.cx === cx && t.cy === cy);
    state.selectedTower = tw || null;
    if (typeof window.__tdUI === "function") window.__tdUI();
  });

  function log(msg, kind) { if (typeof window.__tdLog === "function") window.__tdLog(msg, kind); }

  // 初始化 clock
  function bootstrap() { newGame(); state.clock = 0; state.mouse = null; render(); }
  bootstrap();

  // ===== 對外接口（給 UI 與測試）=====
  window.TD = {
    state: () => state,
    newGame: () => { newGame(); state.clock = 0; render(); },
    startWave,
    selectTower: (type) => { state.selectedTowerType = type; state.selectedTower = null; state.pendingSkill = null; },
    cancelBuild: () => { state.selectedTowerType = null; },
    selectSkill: (id) => { if (state.skillCooldowns[id] <= 0) { state.pendingSkill = id; canvas.style.cursor = "crosshair"; } },
    upgradeSelected: () => { if (state.selectedTower) upgradeTower(state.selectedTower); },
    sellSelected: () => { if (state.selectedTower) sellTower(state.selectedTower); },
    upgradeGoddess, goddessUpgradeCost,
    upgradeCost, towerStat,
    deployHero, rollHero,  // 英雄上場與抽卡
    setSpeed: (s) => { state.speed = s; },
    config: { TOWERS, ENEMIES, SKILLS, UPGRADE, GAME, GODDESS, HEROES, HERO_RARITY, GACHA },
  };
})();
