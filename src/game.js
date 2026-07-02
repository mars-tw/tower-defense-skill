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

  // 依目前地圖即時計算「禁止建塔」的格位（路徑經過的格）
  const blocked = new Set();
  function cellKey(cx, cy) { return cx + "," + cy; }
  function markPathCells(path) {
    blocked.clear();
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
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
  }

  // ===== 遊戲狀態 =====
  let state;
  let lastT = 0;
  let loopToken = 0;
  function newGame() {
    loopToken++; // 作廢任何正在跑的舊迴圈
    const mapDef = getMap();
    const path = mapDef.path;
    markPathCells(path);
    const end = path[path.length - 1];
    state = {
      gold: Math.round(GAME.startGold * (mapDef.goldMul || 1)), wave: 0, score: 0,
      // 守護女神：被保護的核心
      goddess: (() => { const gm = getDifficulty().goddessMul; const hp = Math.round(GODDESS.baseHp * gm); return { level: 1, hp, maxHp: hp, x: end.x, y: end.y, smiteCd: 0, hitFlash: 0 }; })(),
      towers: [], heroes: [], enemies: [], bullets: [], particles: [],
      spawnQueue: [], spawnTimer: 0, clock: 0, mouse: null,
      mapId: mapDef.id, mapDef, path,
      combo: 0, comboTimer: 0, kills: 0,  // D5 連殺系統
      running: false, over: false, betweenWaves: true,
      selectedTowerType: null,   // 準備建造的塔
      selectedTower: null,        // 已選中的塔（看升級）
      pendingSkill: null,         // 準備施放的技能
      skillCooldowns: {},         // 技能冷卻計時
      speed: 1,                    // 遊戲速度倍率
    };
    Object.keys(SKILLS).forEach((k) => (state.skillCooldowns[k] = 0));
    state.map = buildMapLayout(); // 亂數地圖佈局
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // 亂數地圖佈局：每格隨機草地變化 + 隨機裝飾物（避開路徑）
  function buildMapLayout() {
    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
    const grass = [];   // 每格用哪種草地圖 index（0~2）
    for (let cy = 0; cy < rows; cy++) {
      const row = [];
      for (let cx = 0; cx < cols; cx++) row.push(1 + Math.floor(Math.random() * 3)); // grass1~3
      grass.push(row);
    }
    // 裝飾物：在非路徑格隨機撒
    const decor = [];
    const kinds = ["rock", "bush", "tree"];
    for (let i = 0; i < 18; i++) {
      const cx = Math.floor(Math.random() * cols), cy = Math.floor(Math.random() * rows);
      if (blocked.has(cellKey(cx, cy))) continue; // 不放路徑上
      decor.push({ kind: kinds[Math.floor(Math.random() * kinds.length)],
        x: cx * CELL + CELL / 2 + (Math.random() * 16 - 8),
        y: cy * CELL + CELL / 2 + (Math.random() * 16 - 8),
        size: CELL * (0.5 + Math.random() * 0.4) });
    }
    return { cols, rows, grass, decor };
  }

  // 下一波預告（D4）：回傳下一波的敵人數、是否 Boss、主元素傾向。
  // theme 用 config 的共用 waveTheme()——startWave 出怪讀同一個來源，預告才不會是假的
  function previewNextWave() {
    const w = state.wave + 1;
    const plan = TDRules.generateWaveQueue(w, getDifficulty());
    return { wave: w, count: plan.count, isBoss: plan.isBoss, theme: plan.theme, event: plan.event };
  }

  // ===== 波次系統（無盡隨機遞增）=====
  function startWave() {
    if (state.over) return;
    state.wave++;
    state.betweenWaves = false;
    const w = state.wave;
    const plan = TDRules.generateWaveQueue(w, getDifficulty(), Math.random);
    const isBoss = plan.isBoss;
    const ev = plan.event;
    state.currentEvent = ev;

    state.spawnQueue = plan.queue;
    state.spawnTimer = 0;
    startLoop();
    if (ev) {
      log(`${ev.emoji} 第 ${w} 波【${ev.label}】${ev.desc}`);
      flashBanner(`${ev.emoji} ${ev.label}`, ev.color); // 畫面橫幅提示
    } else {
      log(`第 ${w} 波來襲！${isBoss ? "⚠️ Boss 出現！" : ""}`);
      if (isBoss) flashBanner("⚠️ BOSS 來襲", "#dc2626");
    }
    if (typeof window.__tdUI === "function") window.__tdUI();
  }
  // 事件波橫幅提示（畫面中央短暫顯示）
  function flashBanner(text, color) {
    state.banner = { text, color, life: 2.0 };
  }

  function spawnEnemy(spec) {
    const enemy = createEnemy(spec);
    state.enemies.push(enemy);
    return enemy;
  }

  function createEnemy(spec, overrides) {
    if (typeof spec === "string") spec = { type: spec, hpScale: 1 };
    spec = spec || { type: "slime", hpScale: 1 };
    const def = ENEMIES[spec.type];
    const ev = spec.event;
    const scale = spec.hpScale || 1;
    const maxHp = Math.round(def.hp * scale);
    const maxShield = def.shield ? Math.round(def.shield * scale) : 0;
    return Object.assign({
      ...def, x: state.path[0].x, y: state.path[0].y, wp: 1,
      speed: def.speed * (ev ? ev.speedMul : 1),         // 事件波速度
      reward: Math.round(def.reward * (ev ? ev.goldMul : 1)), // 事件波金錢
      hp: maxHp, maxHp, shield: maxShield, maxShield, slowUntil: 0, slowFactor: 1, frozenUntil: 0,
      poisonStacks: [], _poisonAcc: 0, _poisonFloatAt: 0, healCd: def.healInterval || 0,
      event: ev, color: ev && ev.id === "elite" ? "#a855f7" : def.color, // 精英波變色
      uid: "e" + (Math.random() * 1e9 | 0),
    }, overrides || {});
  }

  function applyDamage(e, amount, opts) {
    if (!e || e._dead || e._leaked) return 0;
    opts = opts || {};
    let dmg = Math.max(0, amount || 0);
    if (dmg <= 0) return 0;
    const hpBefore = e.hp;
    if (!opts.bypassShield && e.shield > 0) {
      const shieldHit = Math.min(e.shield, dmg);
      e.shield -= shieldHit;
      dmg -= shieldHit;
    }
    if (dmg > 0) e.hp -= dmg;
    return Math.max(0, hpBefore - Math.max(0, e.hp));
  }

  function applyPoison(e, poison) {
    if (!e || e._dead || !poison || !(poison.dps > 0) || !(poison.duration > 0)) return;
    const stacks = e.poisonStacks || (e.poisonStacks = []);
    const stack = { dps: poison.dps, until: state.clock + poison.duration };
    const maxStacks = Math.max(1, poison.maxStacks || 1);
    if (stacks.length < maxStacks) stacks.push(stack);
    else {
      let replaceAt = 0;
      for (let i = 1; i < stacks.length; i++) if (stacks[i].until < stacks[replaceAt].until) replaceAt = i;
      stacks[replaceAt] = stack;
    }
    ring(e.x, e.y, "#22c55e", 28);
  }

  function updateEnemyStatuses(dt) {
    for (const e of state.enemies) {
      if (e._dead || !e.poisonStacks || !e.poisonStacks.length) continue;
      e.poisonStacks = e.poisonStacks.filter((s) => s.until > state.clock && s.dps > 0);
      if (!e.poisonStacks.length) continue;
      const dps = e.poisonStacks.reduce((sum, s) => sum + s.dps, 0) * (e.boss ? 0.5 : 1);
      const dealt = applyDamage(e, dps * dt, { bypassShield: true });
      if (dealt > 0) {
        e._poisonAcc = (e._poisonAcc || 0) + dealt;
        const due = state.clock - (e._poisonFloatAt || 0) >= 1;
        const shown = Math.floor(e._poisonAcc);
        if (shown >= 1 || (due && e._poisonAcc >= 0.5)) {
          damageNumber(e.x, e.y - 10, shown >= 1 ? shown : Math.round(e._poisonAcc), 1);
          e._poisonAcc = 0;
          e._poisonFloatAt = state.clock;
        }
      }
      if (e.hp <= 0) killEnemy(e);
    }
  }

  function updateEnemyAbilities(dt) {
    for (const e of state.enemies) {
      if (e._dead || !e.healRadius || !e.healAmount || !e.healInterval) continue;
      e.healCd -= dt;
      if (e.healCd > 0) continue;
      e.healCd += e.healInterval;
      let healed = 0;
      for (const ally of state.enemies) {
        if (ally === e || ally._dead || ally.hp >= ally.maxHp) continue;
        if (Math.hypot(ally.x - e.x, ally.y - e.y) > e.healRadius) continue;
        const before = ally.hp;
        ally.hp = Math.min(ally.maxHp, ally.hp + e.healAmount);
        healed += ally.hp - before;
      }
      if (healed > 0) {
        ring(e.x, e.y, "#4ade80", e.healRadius);
        flashText(e.x, e.y - 18, "+" + Math.round(healed), { color: "#86efac", size: 13 });
      }
    }
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
      if (!state.paused) { dt *= state.speed; update(dt); } // 暫停時不更新邏輯
      render();
      if (state.paused) drawPauseOverlay();
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }
  // D10 暫停切換
  function togglePause() { state.paused = !state.paused; return state.paused; }
  function drawPauseOverlay() {
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(0, 0, W, H);
    ctx.font = '900 40px "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff"; ctx.fillText("⏸ 暫停中", W / 2, H / 2);
    ctx.font = '600 16px "Segoe UI", sans-serif'; ctx.fillStyle = "#9fb0a4";
    ctx.fillText("點 ⏸ 或按空白鍵繼續", W / 2, H / 2 + 36);
    ctx.restore();
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

    // D5 連殺計時：超時未擊殺則 combo 歸零
    if (state.comboTimer > 0) {
      state.comboTimer -= dt;
      if (state.comboTimer <= 0) state.combo = 0;
    }
    // D8 事件波橫幅倒數
    if (state.banner && state.banner.life > 0) state.banner.life -= dt;

    // 女神聖光反擊（2 級起解鎖）：定期攻擊終點附近的敵人
    const gd = state.goddess;
    if (gd.hitFlash > 0) gd.hitFlash = Math.max(0, gd.hitFlash - dt);
    if (gd.level >= GODDESS.smiteUnlockLevel) {
      gd.smiteCd -= dt;
      if (gd.smiteCd <= 0) {
        const targets = state.enemies.filter((e) => !e._dead && Math.hypot(e.x - gd.x, e.y - gd.y) <= GODDESS.smiteRange);
        if (targets.length) {
          const t = targets.sort((a, b) => b.wp - a.wp)[0]; // 打最接近終點的
          applyDamage(t, GODDESS.smiteDamage);
          state.bullets.push({ x: gd.x, y: gd.y, target: t, speed: 500, color: "#fde047", damage: 0, element: "physical", _holy: true });
          burst(t.x, t.y, "#fde047", 8);
          if (t.hp <= 0) killEnemy(t);
          gd.smiteCd = GODDESS.smiteInterval;
        }
      }
    }

    updateEnemyStatuses(dt);
    updateEnemyAbilities(dt);

    // 敵人移動
    for (const e of state.enemies) {
      if (e._dead) continue;
      const frozen = e.frozenUntil > state.clock;
      const slowed = e.slowUntil > state.clock;
      const spd = frozen ? 0 : e.speed * (slowed ? e.slowFactor : 1);
      const target = state.path[e.wp];
      if (!target) { leak(e); continue; }
      const dx = target.x - e.x, dy = target.y - e.y;
      const dist = Math.hypot(dx, dy);
      const step = spd * dt;
      if (step >= dist) { e.x = target.x; e.y = target.y; e.wp++; if (e.wp >= state.path.length) leak(e); }
      else { e.x += (dx / dist) * step; e.y += (dy / dist) * step; }
    }
    state.enemies = state.enemies.filter((e) => !e._dead && !e._leaked);

    // 塔射擊
    for (const tw of state.towers) {
      if (TOWERS[tw.type].support) continue;
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

    // 粒子（擴張環不移動；爆裂粒子受重力；文字往上飄不受重力）
    for (const p of state.particles) {
      p.life -= dt;
      if (!p.ring) { p.x += p.vx * dt; p.y += p.vy * dt; if (!p.text) p.vy += 220 * dt; }
    }
    state.particles = state.particles.filter((p) => p.life > 0);

    state.clock += dt;

    // 波次結束判定
    if (!state.betweenWaves && state.spawnQueue.length === 0 && state.enemies.length === 0) {
      state.betweenWaves = true;
      const bonus = Math.round(waveGoldBonus(state.wave) * ((state.mapDef && state.mapDef.goldMul) || 1)); // 指數成長獎勵（D2）
      state.gold += bonus;
      state.score += state.wave * 10;
      log(`第 ${state.wave} 波清空！+${bonus} 金`);
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
    const end = state.path[state.path.length - 1];
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

  const HERO_GUARD_RADIUS = 130; // 駐守英雄的防守範圍
  function updateHero(h, dt) {
    const def = HEROES[h.id];
    if (h.hitFlash > 0) h.hitFlash = Math.max(0, h.hitFlash - dt);
    // 待命/駐守點：有 guardPoint 用駐守點，否則女神身邊
    const home = h.guardPoint || { x: state.goddess.x - 50, y: state.goddess.y - 50 };
    // 尋找敵人；駐守模式只鎖定駐守範圍內的敵人
    let target = null, best = Infinity;
    for (const e of state.enemies) {
      if (e._dead) continue;
      const d = Math.hypot(e.x - h.x, e.y - h.y);
      // 駐守模式：只打駐守點半徑內的敵人（不追遠的）
      if (h.guardPoint) {
        const dh = Math.hypot(e.x - home.x, e.y - home.y);
        if (dh > HERO_GUARD_RADIUS + def.range) continue;
      }
      if (d < best) { best = d; target = e; }
    }
    h.cd -= dt;
    if (!target) {
      moveToward(h, home.x, home.y, def.speed, dt); // 無目標：回家/駐守點
      return;
    }
    const range = def.range;
    if (best > range) {
      moveToward(h, target.x, target.y, def.speed, dt); // 追敵
    } else {
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
        projectile: PROJECTILE_BY_ELEMENT[def.element] || "arrow",
        _heroOwner: h,
      });
    } else {
      // 近戰：直接造成傷害
      const mult = elementMultiplier(def.element, target.element);
      applyDamage(target, atk * mult);
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
    // D5 連殺：累積 combo，倍率提升金錢/分數
    state.combo++;
    state.comboTimer = 2.5; // 2.5 秒內再擊殺才接續
    state.kills++;
    const comboMul = 1 + Math.min(state.combo - 1, 20) * 0.05; // 每連殺 +5%，上限 +100%
    const reward = Math.round(e.reward * comboMul);
    state.gold += reward;
    state.score += reward;
    burst(e.x, e.y, e.color, e.boss ? 30 : 12);
    if (e.boss) { ring(e.x, e.y, "#fde047", 70); screenShake(); }
    // combo 達門檻時畫面跳大數字
    if (state.combo >= 3) flashText(e.x, e.y - 12, `COMBO x${state.combo}`, { color: "#fde047", size: 14 + Math.min(state.combo, 10), big: true });
    if (typeof window.__tdUI === "function") window.__tdUI();
  }

  // ===== 塔瞄準與射擊 =====
  function towerStat(tw, key) {
    const base = TOWERS[tw.type][key];
    if (key === "damage") return (base || 0) * Math.pow(UPGRADE.damageMul, tw.level - 1);
    if (key === "range") return base * Math.pow(UPGRADE.rangeMul, tw.level - 1);
    if (key === "buff") return (base || 0) + (tw.level - 1) * (TOWERS[tw.type].buffPerLevel || 0);
    return base;
  }
  function supportBuffFor(tw) {
    let best = 0;
    for (const support of state.towers) {
      if (support === tw || !TOWERS[support.type].support) continue;
      const range = towerStat(support, "range");
      if (Math.hypot(support.x - tw.x, support.y - tw.y) <= range) best = Math.max(best, towerStat(support, "buff"));
    }
    return best;
  }
  function effectiveTowerDamage(tw) {
    return towerStat(tw, "damage") * (1 + supportBuffFor(tw));
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
  // 塔/元素對應的投射物圖
  const PROJECTILE_BY_TOWER = { arrow: "arrow", cannon: "cannonball", frost: "iceshard", tesla: "lightning", poison: "arrow" };
  const PROJECTILE_BY_ELEMENT = { physical: "arrow", fire: "fireball", ice: "iceshard", thunder: "lightning" };

  function fire(tw, target) {
    const def = TOWERS[tw.type];
    state.bullets.push({
      x: tw.x, y: tw.y, target, speed: 320, color: def.color,
      damage: effectiveTowerDamage(tw), element: def.element,
      splash: def.splash || 0, slow: def.slow || 0, pierce: def.pierce || 0, type: tw.type,
      poison: def.poisonDps ? { dps: def.poisonDps, duration: def.poisonDuration, maxStacks: def.poisonMaxStacks } : null,
      projectile: PROJECTILE_BY_TOWER[tw.type] || PROJECTILE_BY_ELEMENT[def.element],
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
      // 穿透：主目標一定要吃到傷害，其餘依「距主目標的距離」排序取最近的——
      // 原本取 filter 後的前 N 個（＝生成順序），被瞄準的敵人可能反而完全沒受傷
      const near = state.enemies
        .filter((e) => !e._dead && Math.hypot(e.x - b.target.x, e.y - b.target.y) < 60)
        .sort((a, c) => Math.hypot(a.x - b.target.x, a.y - b.target.y) - Math.hypot(c.x - b.target.x, c.y - b.target.y));
      const hits = near.includes(b.target) ? near : [b.target, ...near];
      hits.slice(0, b.pierce).forEach((e) => dealDamage(e, b));
    } else {
      dealDamage(b.target, b);
      burst(b.target.x, b.target.y, b.color, 5); // 命中爆裂小特效
    }
  }
  function dealDamage(e, b) {
    if (e._dead) return;
    const mult = elementMultiplier(b.element, e.element);
    // D6 塔協同：被減速或冰凍的敵人受傷 +25%（救活寒冰塔 → 成為增傷樞紐）
    const chilled = (e.slowUntil > state.clock) || (e.frozenUntil > state.clock);
    const synergy = chilled ? 1.25 : 1;
    const dmg = b.damage * mult * synergy;
    applyDamage(e, dmg);
    damageNumber(e.x, e.y, dmg, mult * synergy); // V2：傷害浮字（克制/協同放大變紅）
    if (b.poison) applyPoison(e, b.poison);
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
        applyDamage(e, sk.damage * mult);
        if (sk.freezeDur) e.frozenUntil = state.clock + sk.freezeDur;
        if (e.hp <= 0) killEnemy(e);
      }
    }
    burst(x, y, sk.color, 40); ring(x, y, sk.color, sk.radius > 200 ? 180 : sk.radius + 30); // V2：技能擴張環
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
  // 粒子爆裂（V2：初速差異化 + 重力 + 大小隨機，更有打擊感）
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 50 + Math.random() * 160;
      state.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50,
        life: 0.35 + Math.random() * 0.35, color, r: 1.5 + Math.random() * 2 });
    }
  }
  // 擴張環特效（技能命中、Boss 死亡等）
  function ring(x, y, color, maxR) {
    state.particles.push({ x, y, vx: 0, vy: 0, life: 0.5, color, ring: true, maxR: maxR || 60, r0: 6 });
  }
  // 螢幕震動（Boss 擊殺、清場技等強回饋）— 對 canvas 加 CSS 震動 class
  function screenShake() {
    if (!canvas) return;
    canvas.classList.add("shake");
    setTimeout(() => canvas.classList.remove("shake"), 300);
  }
  // 浮動文字（升級/傷害數字）；opts: {color, size, big}
  function flashText(x, y, text, opts) {
    opts = opts || {};
    state.particles.push({ x, y, vx: (Math.random() - 0.5) * 20, vy: -55,
      life: opts.big ? 1.0 : 0.8, color: opts.color || "#fde047", text,
      size: opts.size || 13, big: opts.big });
  }
  // 傷害數字（克制時放大變紅 + 擴張環）
  function damageNumber(x, y, amount, mult) {
    const weak = mult > 1.2;     // 克制
    const resist = mult < 0.9;   // 被抗
    flashText(x, y - 6, (weak ? "" : "") + Math.round(amount) + (weak ? "!" : ""),
      { color: weak ? "#fca5a5" : resist ? "#9ca3af" : "#fde047", size: weak ? 17 : 13, big: weak });
  }

  function gameOver() {
    if (state.over) return; // 重入保護：同一幀多隻敵人 leak 會觸發多次，魂晶/場次會被重複結算
    state.over = true; state.running = false;
    log(`💀 遊戲結束！撐到第 ${state.wave} 波，得分 ${state.score}`, "bad");
    if (typeof window.__tdGameOver === "function") window.__tdGameOver(state.wave, state.score, { kills: state.kills, difficulty: getDifficulty() });
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
    drawGuardPoints();
    drawComboHud();
    drawBanner();
  }

  // D9 駐守點視覺（旗標 + 範圍圈）
  function drawGuardPoints() {
    for (const h of state.heroes) {
      if (!h.guardPoint) continue;
      const def = HEROES[h.id];
      ctx.strokeStyle = "rgba(74,222,128,.3)"; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.arc(h.guardPoint.x, h.guardPoint.y, HERO_GUARD_RADIUS, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = "18px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("🚩", h.guardPoint.x, h.guardPoint.y);
    }
    // 選中待設駐守的英雄：高亮
    if (state.pendingHero) {
      const h = state.heroes.find((x) => x.uid === state.pendingHero);
      if (h) { ctx.strokeStyle = "#facc15"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(h.x, h.y, CELL * 0.6, 0, Math.PI * 2); ctx.stroke(); }
    }
  }

  // D8 事件波橫幅（畫面中央，淡入淡出）
  function drawBanner() {
    if (!state.banner || state.banner.life <= 0) return;
    const b = state.banner;
    const t = b.life / 2.0;
    const alpha = t > 0.7 ? (1 - t) / 0.3 : t < 0.3 ? t / 0.3 : 1; // 淡入→持續→淡出
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    // 背景帶
    ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, H * 0.32, W, 56);
    ctx.fillStyle = b.color; ctx.fillRect(0, H * 0.32, W, 3);
    ctx.fillStyle = b.color; ctx.fillRect(0, H * 0.32 + 53, W, 3);
    // 文字
    ctx.font = '900 34px "Segoe UI", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 5; ctx.strokeText(b.text, W / 2, H * 0.32 + 28);
    ctx.fillStyle = b.color; ctx.fillText(b.text, W / 2, H * 0.32 + 28);
    ctx.restore();
  }

  // D5 連殺指示器（畫在 canvas 左上）
  function drawComboHud() {
    if (state.combo < 3) return;
    const x = 16, y = 28;
    const scale = 1 + Math.min(state.combo, 15) * 0.04;
    const t = state.comboTimer / 2.5; // 剩餘時間比例（漸隱）
    ctx.save();
    ctx.globalAlpha = Math.min(1, t * 2);
    ctx.font = `900 ${Math.round(26 * scale)}px "Segoe UI", sans-serif`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 4;
    ctx.strokeText(`${state.combo} 連殺!`, x, y);
    const grad = ctx.createLinearGradient(x, y, x, y + 30);
    grad.addColorStop(0, "#fde047"); grad.addColorStop(1, "#f59e0b");
    ctx.fillStyle = grad; ctx.fillText(`${state.combo} 連殺!`, x, y);
    // combo 倍率
    const mul = 1 + Math.min(state.combo - 1, 20) * 0.05;
    ctx.font = '700 13px "Segoe UI", sans-serif';
    ctx.fillStyle = "#4ade80"; ctx.fillText(`金錢 x${mul.toFixed(2)}`, x, y + 30 * scale);
    ctx.restore();
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
    // 血條（V3 圓角漸層）
    drawHealthBar(h.x - size / 2, h.y - size / 2 - 9, size, 5, Math.max(0, h.hp / h.maxHp));
    // 等級（描邊）
    ctx.font = "900 11px 'Segoe UI', sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3; ctx.strokeText("Lv" + h.level, h.x, h.y + size / 2 + 10);
    ctx.fillStyle = "#fde047"; ctx.fillText("Lv" + h.level, h.x, h.y + size / 2 + 10);
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
    const map = state.map;
    // 用草地磚塊亂數鋪滿（圖未載入時退回純色格）
    if (map) {
      for (let cy = 0; cy < map.rows; cy++) {
        for (let cx = 0; cx < map.cols; cx++) {
          const im = getImg(`assets/tiles/grass${map.grass[cy][cx]}.png`, true);
          if (im && im.complete && im.naturalWidth > 0) {
            ctx.drawImage(im, cx * CELL, cy * CELL, CELL, CELL);
          } else {
            ctx.fillStyle = (cx + cy) % 2 ? "#13241a" : "#15281d";
            ctx.fillRect(cx * CELL, cy * CELL, CELL, CELL);
          }
        }
      }
    }
    // V3 場景深度：暗角 vignette（中心透明 → 邊緣壓暗）
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
    vig.addColorStop(0, "rgba(0,0,0,0)"); vig.addColorStop(1, "rgba(0,0,0,.4)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  }
  function drawPath() {
    // 路徑：先畫底色路（保證可見），再用路徑磚平鋪沿線蓋上
    ctx.strokeStyle = "#3b2f1f"; ctx.lineWidth = CELL * 0.9; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const path = state.path || getMap().path;
    ctx.beginPath(); ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    // 路徑磚塊圖蓋在路徑格上
    const pathImg = getImg("assets/tiles/path.png", true);
    if (pathImg && pathImg.complete && pathImg.naturalWidth > 0 && state.map) {
      for (const key of blocked) {
        const [cx, cy] = key.split(",").map(Number);
        if (cx < 0 || cy < 0) continue;
        ctx.drawImage(pathImg, cx * CELL, cy * CELL, CELL, CELL);
      }
    }
    // 裝飾物（在非路徑格）
    if (state.map) {
      for (const d of state.map.decor) {
        drawSprite(`assets/tiles/${d.kind}.png`, "", d.x, d.y, d.size);
      }
    }
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
  // 圖片快取：載入後做「四角背景色去背」，讓素材的純色方塊背景（紫/白）變透明，
  // 融入草地。處理結果是一個帶 complete/naturalWidth 的 canvas（可直接 drawImage）。
  const imgCache = {};
  // noBg=true 時保留原圖不去背（地圖滿版磚塊用，否則整塊會被去透明）
  function getImg(path, noBg) {
    if (imgCache[path] === undefined) {
      imgCache[path] = null; // 預設 null（載入/去背完成前用佔位）
      const im = new Image();
      im.onload = () => { imgCache[path] = noBg ? im : removeBg(im); };
      im.onerror = () => { imgCache[path] = null; };
      im.src = path;
    }
    return imgCache[path];
  }
  // 去背：取四角平均色當背景色，把相近像素的 alpha 設 0
  function removeBg(im) {
    try {
      const c = document.createElement("canvas");
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const cx = c.getContext("2d");
      cx.drawImage(im, 0, 0);
      const W = c.width, H = c.height;
      const data = cx.getImageData(0, 0, W, H);
      const p = data.data;
      // 取四角顏色平均當背景參考色
      const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]];
      let br = 0, bg = 0, bb = 0;
      for (const [x, y] of corners) { const i = (y * W + x) * 4; br += p[i]; bg += p[i + 1]; bb += p[i + 2]; }
      br /= 4; bg /= 4; bb /= 4;
      const TOL = 60; // 容差：與背景色距離小於此值的像素去除
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.abs(p[i] - br) + Math.abs(p[i + 1] - bg) + Math.abs(p[i + 2] - bb);
        if (d < TOL) p[i + 3] = 0;
        else if (d < TOL * 1.8) p[i + 3] = Math.round(p[i + 3] * (d - TOL) / (TOL * 0.8)); // 邊緣半透明過渡
      }
      cx.putImageData(data, 0, 0);
      c.complete = true; c.naturalWidth = W; // 讓後續判斷相容 Image 介面
      return c;
    } catch { return im; } // 失敗則退回原圖
  }
  function drawSprite(path, emoji, x, y, size, color) {
    const im = getImg(path);
    if (im && im.complete && im.naturalWidth > 0) ctx.drawImage(im, x - size / 2, y - size / 2, size, size);
    else { ctx.font = size * 0.8 + "px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText(emoji, x, y); }
  }
  function drawTower(tw) {
    const def = TOWERS[tw.type];
    const lv = tw.level;
    // 升級視覺：塔依等級放大、底座顏色與光環隨等級變化
    const baseR = CELL * (0.42 + (lv - 1) * 0.03);      // 等級越高底座越大
    const spriteSize = CELL * (0.7 + (lv - 1) * 0.06);  // 塔身放大
    // 等級對應的底座色（白→藍→紫→金）
    const levelColors = ["rgba(0,0,0,.4)", "rgba(59,130,246,.35)", "rgba(168,85,247,.4)", "rgba(245,158,11,.45)", "rgba(239,68,68,.45)", "rgba(45,212,191,.5)"];
    const levelGlow = ["transparent", "#3b82f6", "#a855f7", "#facc15", "#ef4444", "#2dd4bf"];

    // 高等級的外圈發光
    if (lv >= 2) {
      ctx.save();
      ctx.shadowColor = levelGlow[lv - 1]; ctx.shadowBlur = 6 + lv * 3;
      ctx.strokeStyle = levelGlow[lv - 1]; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(tw.x, tw.y, baseR + 2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    // 底座
    ctx.fillStyle = levelColors[lv - 1] || levelColors[3];
    ctx.beginPath(); ctx.arc(tw.x, tw.y, baseR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 1 + lv * 0.5; ctx.stroke();

    // 滿級（4 級）：旋轉光點
    if (lv >= UPGRADE.maxLevel) {
      const t = state.clock * 2;
      for (let i = 0; i < 4; i++) {
        const a = t + i * Math.PI / 2;
        ctx.fillStyle = "#facc15";
        ctx.beginPath(); ctx.arc(tw.x + Math.cos(a) * baseR, tw.y + Math.sin(a) * baseR, 2, 0, Math.PI * 2); ctx.fill();
      }
    }

    drawSprite(`assets/towers/${tw.type}.png`, def.emoji, tw.x, tw.y, spriteSize);
    // 等級星
    if (lv > 1) {
      ctx.fillStyle = "#facc15"; ctx.font = "bold 10px sans-serif"; ctx.textAlign = "center";
      ctx.fillText("★".repeat(lv - 1), tw.x, tw.y + baseR + 4);
    }
  }
  function drawEnemy(e) {
    const size = e.boss ? CELL * 1.1 : CELL * 0.6;
    drawSprite(`assets/enemies/${e.id}.png`, e.emoji, e.x, e.y, size);
    // 血條（V3：圓角漸層）
    drawHealthBar(e.x - size / 2, e.y - size / 2 - 9, size, 5, Math.max(0, e.hp / e.maxHp));
    if (e.maxShield > 0) {
      drawShieldBar(e.x - size / 2, e.y - size / 2 - 15, size, 4, Math.max(0, e.shield / e.maxShield));
    }
    // 冰凍/減速標記
    if (e.frozenUntil > state.clock) { ctx.fillStyle = "rgba(56,189,248,.4)"; ctx.beginPath(); ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2); ctx.fill(); }
    else if (e.slowUntil > state.clock) { ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(e.x, e.y, size / 2, 0, Math.PI * 2); ctx.stroke(); }
    if (e.poisonStacks && e.poisonStacks.length) {
      ctx.strokeStyle = "#22c55e"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(e.x, e.y, size * 0.62, 0, Math.PI * 2); ctx.stroke();
    }
  }
  // 共用圓角漸層血條（V3 場景深度）
  function drawHealthBar(x, y, w, h, pct) {
    const r = h / 2;
    // 外框背景
    ctx.fillStyle = "rgba(0,0,0,.6)";
    roundRect(x - 1, y - 1, w + 2, h + 2, r + 1); ctx.fill();
    // 血量漸層
    if (pct > 0) {
      const c = pct > 0.5 ? ["#86efac", "#22c55e"] : pct > 0.25 ? ["#fde047", "#eab308"] : ["#fca5a5", "#dc2626"];
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, c[0]); g.addColorStop(1, c[1]);
      ctx.fillStyle = g;
      roundRect(x, y, w * pct, h, r); ctx.fill();
    }
  }
  function drawShieldBar(x, y, w, h, pct) {
    ctx.fillStyle = "rgba(15,23,42,.75)";
    roundRect(x - 1, y - 1, w + 2, h + 2, h / 2 + 1); ctx.fill();
    if (pct > 0) {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, "#bfdbfe"); g.addColorStop(1, "#60a5fa");
      ctx.fillStyle = g;
      roundRect(x, y, w * pct, h, h / 2); ctx.fill();
    }
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function drawBullet(b) {
    // 有投射物圖 → 畫圖並朝飛行方向旋轉；否則退回發光圓點
    const im = b.projectile ? getImg(`assets/projectiles/${b.projectile}.png`) : null;
    if (im && im.complete && im.naturalWidth > 0) {
      // 飛行方向角度（朝目標）
      let ang = 0;
      if (b.target && !b.target._dead) ang = Math.atan2(b.target.y - b.y, b.target.x - b.x);
      const sz = b.projectile === "cannonball" ? 22 : 26;
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(ang);
      ctx.shadowColor = b.color; ctx.shadowBlur = 6;
      ctx.drawImage(im, -sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    } else {
      ctx.fillStyle = b.color; ctx.shadowColor = b.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(b.x, b.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
    }
  }
  function drawParticle(p) {
    const a = Math.max(0, Math.min(1, p.life * 2));
    ctx.globalAlpha = a;
    if (p.ring) {
      // 擴張環：半徑隨時間放大、線漸細
      const prog = 1 - p.life / 0.5;
      const r = p.r0 + (p.maxR - p.r0) * prog;
      ctx.strokeStyle = p.color; ctx.lineWidth = 4 * (1 - prog) + 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke();
    } else if (p.text) {
      // 傷害/升級數字：剛出現時 scale-in
      const age = (p.big ? 1.0 : 0.8) - p.life;
      const scale = age < 0.1 ? 0.6 + age * 4 : 1;
      ctx.save(); ctx.translate(p.x, p.y); ctx.scale(scale, scale);
      ctx.font = `900 ${p.size}px "Segoe UI", sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.strokeStyle = "rgba(0,0,0,.8)"; ctx.lineWidth = 3.5; ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color; ctx.fillText(p.text, 0, 0);
      ctx.restore();
    } else {
      // glow 圓點：發光 + 大小隨機
      ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(p.x, p.y, (p.r || 2) * a, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
  }

  // ===== 輸入 =====
  function canvasPos(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left) * (W / r.width), y: (clientY - r.top) * (H / r.height) };
  }
  // 點擊/觸控的共用處理（座標已換算，RWD 縮放下也正確）
  function handleTap(p) {
    if (state.pendingSkill) { castSkill(state.pendingSkill, p.x, p.y); state.pendingSkill = null; canvas.style.cursor = "default"; return; }
    if (state.selectedTowerType) { tryBuildTower(p.x, p.y); return; }
    // D9 駐守：已選中英雄 → 點地圖設駐守點（點英雄自己=取消駐守）
    if (state.pendingHero) {
      const h = state.heroes.find((x) => x.uid === state.pendingHero);
      if (h) {
        const onSelf = Math.hypot(p.x - h.x, p.y - h.y) < CELL * 0.6;
        h.guardPoint = onSelf ? null : { x: p.x, y: p.y };
        log(onSelf ? `${HEROES[h.id].name} 解除駐守，自由作戰。` : `${HEROES[h.id].name} 駐守此地！`);
      }
      state.pendingHero = null; canvas.style.cursor = "default";
      if (typeof window.__tdUI === "function") window.__tdUI();
      return;
    }
    // 點到地圖上的英雄 → 選中它（準備設駐守點）
    const hero = state.heroes.find((x) => Math.hypot(p.x - x.x, p.y - x.y) < CELL * 0.5);
    if (hero) {
      state.pendingHero = hero.uid; canvas.style.cursor = "crosshair";
      log(`已選 ${HEROES[hero.id].name}，點地圖指定駐守點（點它自己取消駐守）。`);
      if (typeof window.__tdUI === "function") window.__tdUI();
      return;
    }
    const cx = Math.floor(p.x / CELL), cy = Math.floor(p.y / CELL);
    const tw = state.towers.find((t) => t.cx === cx && t.cy === cy);
    state.selectedTower = tw || null;
    if (typeof window.__tdUI === "function") window.__tdUI();
  }
  canvas.addEventListener("mousemove", (ev) => { state.mouse = canvasPos(ev.clientX, ev.clientY); });
  canvas.addEventListener("click", (ev) => { handleTap(canvasPos(ev.clientX, ev.clientY)); });
  // 觸控支援：tap 建塔/選塔/放技能
  canvas.addEventListener("touchstart", (ev) => {
    if (ev.touches.length) { const t = ev.touches[0]; state.mouse = canvasPos(t.clientX, t.clientY); }
  }, { passive: true });
  canvas.addEventListener("touchend", (ev) => {
    ev.preventDefault(); // 避免觸發後續的合成 click（重複觸發）
    const t = ev.changedTouches[0];
    if (t) handleTap(canvasPos(t.clientX, t.clientY));
  }, { passive: false });

  function log(msg, kind) { if (typeof window.__tdLog === "function") window.__tdLog(msg, kind); }

  // 初始化 clock
  function bootstrap() { newGame(); state.clock = 0; state.mouse = null; render(); }
  bootstrap();

  // 閒置渲染迴圈：主迴圈只在波次進行中跑（startLoop/state.running），
  // 第一波開始前的建塔準備階段與 gameOver 後畫面完全不會重繪——
  // 放了塔看不到、滑鼠 hover 的建塔預覽也不會動。這個迴圈只在主迴圈沒跑時輕量補渲染。
  (function idleLoop() {
    if (!state.running) render();
    requestAnimationFrame(idleLoop);
  })();

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
    upgradeCost, towerStat, getTowerBuff: supportBuffFor, effectiveTowerDamage,
    deployHero, rollHero,  // 英雄上場與抽卡
    rollHeroWithPity,      // 含保底的抽卡（Stage 1：pity 由 ui.js 的 meta 持久化）
    previewNextWave,       // 下一波預告（D4）
    setDifficulty, getDifficulty,  // 難度模式（鉤子）
    setMap, getMap,
    togglePause,                   // 暫停（D10）
    setPaused: (v) => { state.paused = !!v; }, // 強制暫停/恢復（抽卡動畫用，不能用 toggle）
    cancelSelect: () => { state.selectedTowerType = null; state.selectedTower = null; state.pendingSkill = null; canvas.style.cursor = "default"; if (typeof window.__tdUI === "function") window.__tdUI(); },
    setSpeed: (s) => { state.speed = s; },
    debug: {
      spawnEnemy: (type, overrides) => {
        const e = createEnemy({ type, hpScale: 1 }, overrides);
        state.enemies.push(e);
        return e;
      },
      step: (dt) => { update(dt || 0.016); render(); },
      fireTower: (tw, target) => fire(tw, target),
    },
    config: { TOWERS, ENEMIES, SKILLS, UPGRADE, GAME, GODDESS, HEROES, HERO_RARITY, GACHA, DIFFICULTIES, MAPS, ACHIEVEMENTS },
  };
})();
