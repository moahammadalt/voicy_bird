/*!
 * Voicy Bird — game logic, rendering and UI glue.
 * Depends on js/audio.js (VB.MicMeter, VB.Sfx) and js/speech.js (VB.VoiceCommands).
 */
(function () {
  'use strict';

  const VB = window.VB;
  if (!VB || !VB.MicMeter || !VB.VoiceCommands) {
    throw new Error('Voicy Bird: js/audio.js and js/speech.js must be loaded before js/game.js');
  }
  const MIN_DB = VB.MicMeter.MIN_DB;

  /* ==================================================================
   * Tuning — the world is 480 units tall; width adapts to the screen.
   * ================================================================== */
  const H = 480;
  const GROUND_H = 56;
  const SKY_H = H - GROUND_H;
  const BIRD_W = 40;
  const BIRD_H = 30;
  const PIPE_W = 70;
  const CAP_H = 26;
  const CAP_OVER = 5;

  const FALL_SPEED = 180;      // px/s when the room is quiet
  const RISE_SPEED = 250;      // px/s at full lift
  const VEL_TAU = 0.13;        // s — how quickly the bird follows the mic
  const START_SPEED = 165;     // px/s scroll speed at score 0
  const MAX_SPEED = 260;       // px/s scroll speed at score 40+
  const START_GAP = 180;
  const MIN_GAP = 128;
  const PIPE_SPACING = 310;
  const MAX_SHIFT_SLOW = 170;  // max vertical distance between consecutive gaps…
  const MAX_SHIFT_FAST = 115;  // …shrinks with speed so every gap stays reachable
  const STEP = 1 / 120;        // fixed physics step
  const DEATH_GRAVITY = 1400;
  const READY_GRACE = 0.6;     // s before noise can launch the bird
  const START_LIFT = 0.4;      // lift needed to take off from "ready"

  const FONT = '"Fredoka", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';

  /* ==================================================================
   * Helpers
   * ================================================================== */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const mod = (n, m) => ((n % m) + m) % m;
  const $ = (id) => document.getElementById(id);

  const store = {
    get(key, def) {
      try {
        const v = localStorage.getItem('voicy_bird.' + key);
        return v === null ? def : JSON.parse(v);
      } catch (e) { return def; }
    },
    set(key, val) {
      try { localStorage.setItem('voicy_bird.' + key, JSON.stringify(val)); } catch (e) { /* private mode */ }
    }
  };

  /** The 2018 version kept the best score in a cookie (sometimes as 3.5…). */
  function legacyCookieBest() {
    const m = document.cookie.match(/(?:^|;\s*)score=([^;]*)/);
    if (!m) return 0;
    const n = Math.floor(parseFloat(m[1]));
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function rrect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* ==================================================================
   * State
   * ================================================================== */
  const game = {
    state: 'title',            // title | ready | playing | paused | dying | over
    W: 800,
    score: 0,
    best: Math.max(store.get('best', 0) | 0, legacyCookieBest()),
    isNewBest: false,
    speed: START_SPEED,
    scroll: 0,
    time: 0,
    bird: { x: 160, y: SKY_H * 0.45, vy: 0, angle: 0, wing: 0 },
    pipes: [],
    particles: [],
    floaters: [],
    lift: 0,                   // 0..1 — combined voice + manual lift
    voiceLift: 0,
    manualLift: 0,
    held: false,               // keyboard
    pointerHeld: false,        // mouse / touch
    readyTimer: 0,
    dyingTimer: 0,
    overAt: 0,
    flash: 0,
    shake: 0,
    db: MIN_DB,
    thresholds: { lowDb: -30, highDb: -8 },
    ambientDb: MIN_DB,
    calibrating: null,
    settings: {
      sensitivity: clamp(Number(store.get('sensitivity', 0.55)) || 0.55, 0, 1),
      sfx: store.get('sfx', true) !== false,
      voice: store.get('voice', true) !== false
    }
  };
  store.set('best', game.best);

  const mic = new VB.MicMeter();
  const sfx = new VB.Sfx();
  sfx.enabled = game.settings.sfx;

  /* ==================================================================
   * DOM
   * ================================================================== */
  const canvas = $('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const stage = $('stage');
  const wrap = $('stage-wrap');
  const ui = {
    pill: $('voice-pill'),
    btnPause: $('btn-pause'),
    ovTitle: $('ov-title'),
    ovReady: $('ov-ready'),
    ovPause: $('ov-pause'),
    ovOver: $('ov-over'),
    readyHint: $('ready-hint'),
    toast: $('toast'),
    bestTitle: $('best-title'),
    btnStartMic: $('btn-start-mic'),
    startLabel: $('start-label'),
    btnStartKb: $('btn-start-kb'),
    btnResume: $('btn-resume'),
    btnRestart: $('btn-restart'),
    btnMenu: $('btn-menu'),
    btnAgain: $('btn-again'),
    btnMenu2: $('btn-menu2'),
    overScore: $('over-score'),
    overBest: $('over-best'),
    overMedal: $('over-medal'),
    overRibbon: $('over-ribbon'),
    btnMic: $('btn-mic'),
    micLabel: $('mic-label'),
    btnCal: $('btn-cal'),
    meterZone: $('meter-zone'),
    meterFill: $('meter-fill'),
    sens: $('sensitivity'),
    sensVal: $('sens-val'),
    optSfx: $('opt-sfx'),
    optVoice: $('opt-voice'),
    optVoiceLabel: $('opt-voice-label'),
    chips: Array.prototype.slice.call(document.querySelectorAll('.chip[data-cmd]'))
  };

  let toastTimer = 0;
  function toast(msg, ms) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms || 2200);
  }

  function show(el, on) { el.hidden = !on; }

  function setOverlays(which) {
    show(ui.ovTitle, which === 'title');
    show(ui.ovReady, which === 'ready');
    show(ui.ovPause, which === 'paused');
    show(ui.ovOver, which === 'over');
    show(ui.btnPause, which === 'playing');
  }

  /* ==================================================================
   * Layout — fixed world height, width follows the screen (1:1 … 2:1)
   * ================================================================== */
  function birdX() { return clamp(game.W * 0.25, 120, 200); }

  function layout() {
    const aw = wrap.clientWidth;
    const ah = wrap.clientHeight;
    if (!aw || !ah) return;
    const aspect = clamp(aw / ah, 0.75, 2);
    const cssW = Math.floor(Math.min(aw, ah * aspect));
    const cssH = Math.floor(cssW / aspect);
    stage.style.width = cssW + 'px';
    stage.style.height = cssH + 'px';
    game.W = Math.round(H * aspect);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(cssW * dpr));
    canvas.height = Math.max(1, Math.round(cssH * dpr));
    game.bird.x = birdX();
  }

  if (window.ResizeObserver) {
    new ResizeObserver(layout).observe(wrap);
  } else {
    window.addEventListener('resize', layout);
  }
  layout();

  /* ==================================================================
   * Game flow
   * ================================================================== */
  function resetScene() {
    game.pipes = [];
    game.particles = [];
    game.floaters = [];
    game.score = 0;
    game.isNewBest = false;
    game.speed = START_SPEED;
    game.manualLift = 0;
    game.held = false;
    game.pointerHeld = false;
    game.flash = 0;
    game.shake = 0;
    const b = game.bird;
    b.x = birdX();
    b.y = SKY_H * 0.45;
    b.vy = 0;
    b.angle = 0;
  }

  function goTitle() {
    resetScene();
    if (game.W >= 640) game.bird.y = 62;
    game.state = 'title';
    ui.bestTitle.textContent = game.best;
    ui.startLabel.textContent = mic.enabled ? 'Play' : 'Play with your voice';
    show(ui.btnStartKb, !mic.enabled);
    setOverlays('title');
  }

  function dropFocus() {
    const el = document.activeElement;
    if (el && el !== document.body && typeof el.blur === 'function') el.blur();
  }

  function beginReady() {
    dropFocus();
    resetScene();
    game.state = 'ready';
    game.readyTimer = 0;
    ui.readyHint.innerHTML = mic.enabled
      ? 'Make some noise to take off!<br><small>Louder = higher · quiet = sink</small>'
      : 'Hold <kbd>Space</kbd> or tap &amp; hold to fly<br><small>Press to take off</small>';
    setOverlays('ready');
  }

  function startPlaying() {
    if (game.state !== 'ready') return;
    game.state = 'playing';
    game.bird.vy = -140;
    setOverlays('playing');
    sfx.start();
  }

  function pause() {
    if (game.state !== 'playing') return;
    game.state = 'paused';
    game.held = false;
    game.pointerHeld = false;
    setOverlays('paused');
  }

  function resume() {
    if (game.state !== 'paused') return;
    dropFocus();
    game.state = 'playing';
    setOverlays('playing');
  }

  function togglePause() {
    if (game.state === 'playing') pause();
    else if (game.state === 'paused') resume();
  }

  function restart() {
    if (game.state === 'dying') return; // let the crash animation finish
    beginReady();
  }

  function die() {
    const b = game.bird;
    game.state = 'dying';
    game.dyingTimer = 0;
    b.vy = -220;
    game.flash = 1;
    game.shake = 10;
    setOverlays('dying');
    sfx.hit();
    burst(b.x, b.y, 16, ['#ffd93b', '#f5a623', '#fff1b8']);
  }

  function medalFor(score) {
    if (score >= 40) return 'platinum';
    if (score >= 25) return 'gold';
    if (score >= 12) return 'silver';
    if (score >= 5) return 'bronze';
    return '';
  }

  function gameOver() {
    game.state = 'over';
    game.overAt = game.time;
    if (game.score > game.best) {
      game.best = game.score;
      game.isNewBest = true;
      store.set('best', game.best);
      sfx.best();
    }
    ui.overScore.textContent = game.score;
    ui.overBest.textContent = game.best;
    const medal = medalFor(game.score);
    ui.overMedal.className = 'medal' + (medal ? ' ' + medal : '');
    ui.overMedal.setAttribute('aria-label', medal ? medal + ' medal' : '');
    show(ui.overMedal, !!medal);
    show(ui.overRibbon, game.isNewBest);
    setOverlays('over');
  }

  function addScore() {
    game.score += 1;
    sfx.score();
    const b = game.bird;
    game.floaters.push({ x: b.x, y: b.y - 26, life: 0.9, text: '+1' });
    burst(b.x + 6, b.y, 8, ['#ffffff', '#a3e635', '#fde047']);
  }

  /* ==================================================================
   * Simulation
   * ================================================================== */
  function difficulty(score) {
    const t = clamp(score / 40, 0, 1);
    return {
      speed: lerp(START_SPEED, MAX_SPEED, t),
      gap: lerp(START_GAP, MIN_GAP, t),
      shift: lerp(MAX_SHIFT_SLOW, MAX_SHIFT_FAST, t)
    };
  }

  function spawnPipe(x, diff) {
    const gapH = diff.gap;
    const minC = 46 + gapH / 2;
    const maxC = SKY_H - 46 - gapH / 2;
    const prev = game.pipes.length ? game.pipes[game.pipes.length - 1].gapY : SKY_H / 2;
    const lo = Math.max(minC, prev - diff.shift);
    const hi = Math.min(maxC, prev + diff.shift);
    game.pipes.push({ x, gapY: rand(lo, hi), gapH, scored: false });
  }

  function birdBox() {
    const b = game.bird;
    return { x: b.x - BIRD_W / 2 + 6, y: b.y - BIRD_H / 2 + 5, w: BIRD_W - 12, h: BIRD_H - 10 };
  }

  function idle(dt, wingRate, baseY) {
    const b = game.bird;
    const target = baseY + Math.sin(game.time * 3) * 7;
    b.y += (target - b.y) * Math.min(1, dt * 6);
    b.angle = Math.sin(game.time * 3 + 1) * 0.08;
    b.wing += dt * wingRate;
    b.vy = 0;
  }

  function stepPlaying(dt) {
    const b = game.bird;
    const diff = difficulty(game.score);
    game.speed += (diff.speed - game.speed) * Math.min(1, dt * 2);
    game.scroll += game.speed * dt;

    const targetVy = lerp(FALL_SPEED, -RISE_SPEED, game.lift);
    b.vy += (targetVy - b.vy) * (1 - Math.exp(-dt / VEL_TAU));
    b.y += b.vy * dt;
    if (b.y < BIRD_H / 2) { b.y = BIRD_H / 2; if (b.vy < 0) b.vy = 0; }
    b.wing += dt * (7 + 22 * game.lift);
    const targetAngle = clamp(b.vy / 350, -1, 1) * 0.55;
    b.angle += (targetAngle - b.angle) * Math.min(1, dt * 8);

    for (const p of game.pipes) p.x -= game.speed * dt;
    while (game.pipes.length && game.pipes[0].x + PIPE_W + CAP_OVER < -10) game.pipes.shift();
    let lastX = game.pipes.length ? game.pipes[game.pipes.length - 1].x : game.W + 160 - PIPE_SPACING;
    while (lastX < game.W + 40) {
      lastX += PIPE_SPACING;
      spawnPipe(lastX, diff);
    }

    const hb = birdBox();
    for (const p of game.pipes) {
      if (!p.scored && p.x + PIPE_W < b.x) { p.scored = true; addScore(); }
      if (hb.x < p.x + PIPE_W && hb.x + hb.w > p.x) {
        const top = p.gapY - p.gapH / 2;
        const bot = p.gapY + p.gapH / 2;
        if (hb.y < top || hb.y + hb.h > bot) { die(); return; }
      }
    }
    if (b.y + BIRD_H / 2 >= SKY_H) { b.y = SKY_H - BIRD_H / 2; die(); }
  }

  function stepDying(dt) {
    const b = game.bird;
    game.dyingTimer += dt;
    b.vy += DEATH_GRAVITY * dt;
    b.y += b.vy * dt;
    b.angle += (1.45 - b.angle) * Math.min(1, dt * 5);
    b.wing += dt * 3;
    if (b.y + BIRD_H / 2 >= SKY_H) { b.y = SKY_H - BIRD_H / 2; b.vy = 0; }
    if (game.dyingTimer > 0.9) gameOver();
  }

  function stepParticles(dt) {
    const ps = game.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    const fs = game.floaters;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      f.life -= dt;
      f.y -= 45 * dt;
      if (f.life <= 0) fs.splice(i, 1);
    }
  }

  function burst(x, y, n, colors) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(60, 220);
      game.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 80,
        life: rand(0.4, 0.9),
        size: rand(2, 5),
        color: colors[i % colors.length]
      });
    }
  }

  function update(dt) {
    switch (game.state) {
      case 'title':
        game.scroll += 30 * dt;
        idle(dt, 8, game.W >= 640 ? 62 : SKY_H * 0.45);
        break;
      case 'ready':
        game.scroll += 60 * dt;
        game.readyTimer += dt;
        idle(dt, 8 + 14 * game.lift, SKY_H * 0.45);
        if (game.readyTimer > READY_GRACE && game.lift > START_LIFT) startPlaying();
        break;
      case 'playing':
        stepPlaying(dt);
        break;
      case 'dying':
        stepDying(dt);
        break;
      default:
        break;
    }
    stepParticles(dt);
    if (game.flash > 0) game.flash = Math.max(0, game.flash - dt * 3);
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 30);
  }

  /* ==================================================================
   * Rendering
   * ================================================================== */
  function makeHillTile(w, h, color, waves) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 4) {
      let y = h * 0.5;
      for (const wv of waves) y -= wv.a * Math.sin((x / w) * Math.PI * 2 * wv.n + wv.p);
      g.lineTo(x, y);
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    return c;
  }

  function makeGroundTile() {
    const w = 64;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = GROUND_H;
    const g = c.getContext('2d');
    g.fillStyle = '#e0c98b';
    g.fillRect(0, 0, w, GROUND_H);
    g.fillStyle = '#d2b876';
    for (let x = -32; x <= 96; x += 32) {
      g.beginPath();
      g.moveTo(x, 20);
      g.lineTo(x + 18, 20);
      g.lineTo(x + 18 - 36, GROUND_H);
      g.lineTo(x - 36, GROUND_H);
      g.closePath();
      g.fill();
    }
    g.fillStyle = '#6cc04a';
    g.fillRect(0, 0, w, 16);
    g.fillStyle = '#95dc6e';
    g.fillRect(0, 0, w, 5);
    g.fillStyle = '#4e9e30';
    g.fillRect(0, 16, w, 4);
    return c;
  }

  const tiles = {
    far: makeHillTile(720, 120, '#b7e2d8', [{ a: 26, n: 2, p: 0.5 }, { a: 10, n: 5, p: 2.1 }]),
    near: makeHillTile(540, 80, '#86d18e', [{ a: 16, n: 2, p: 1.7 }, { a: 8, n: 6, p: 0.3 }]),
    ground: makeGroundTile()
  };

  const clouds = [];
  const CLOUD_SPAN = 2000;
  for (let i = 0; i < 11; i++) {
    clouds.push({ x: i * (CLOUD_SPAN / 11) + rand(-40, 40), y: rand(30, 210), s: rand(0.55, 1.25) });
  }

  const pipeGrad = ctx.createLinearGradient(0, 0, PIPE_W, 0);
  pipeGrad.addColorStop(0, '#3f8f2a');
  pipeGrad.addColorStop(0.18, '#6cc04a');
  pipeGrad.addColorStop(0.42, '#a8e47f');
  pipeGrad.addColorStop(0.7, '#6cc04a');
  pipeGrad.addColorStop(1, '#3a8526');
  const capGrad = ctx.createLinearGradient(0, 0, PIPE_W + CAP_OVER * 2, 0);
  capGrad.addColorStop(0, '#3f8f2a');
  capGrad.addColorStop(0.18, '#72c650');
  capGrad.addColorStop(0.42, '#b3ea8b');
  capGrad.addColorStop(0.7, '#72c650');
  capGrad.addColorStop(1, '#3a8526');

  const skyGrad = ctx.createLinearGradient(0, 0, 0, SKY_H);
  skyGrad.addColorStop(0, '#3ea6f0');
  skyGrad.addColorStop(0.55, '#7fd3f7');
  skyGrad.addColorStop(1, '#d6f3fb');
  const sunGlow = ctx.createRadialGradient(0, 0, 20, 0, 0, 110);
  sunGlow.addColorStop(0, 'rgba(255,240,180,0.55)');
  sunGlow.addColorStop(1, 'rgba(255,240,180,0)');

  function drawSky() {
    const W = game.W;
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, W, H);
    // sun
    ctx.save();
    ctx.translate(W - 96, 78);
    ctx.fillStyle = sunGlow;
    ctx.fillRect(-110, -110, 220, 220);
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCloud(x, y, s) {
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, Math.PI * 2);
    ctx.arc(x + 24 * s, y - 12 * s, 28 * s, 0, Math.PI * 2);
    ctx.arc(x + 54 * s, y - 2 * s, 22 * s, 0, Math.PI * 2);
    ctx.arc(x + 28 * s, y + 8 * s, 20 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawClouds() {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const off = game.scroll * 0.18;
    for (const c of clouds) {
      const x = mod(c.x - off, CLOUD_SPAN + 200) - 120;
      if (x > game.W + 100) continue;
      drawCloud(x, c.y, c.s);
    }
  }

  function drawTiled(tile, factor, y) {
    const w = tile.width;
    const start = -mod(game.scroll * factor, w);
    for (let x = start; x < game.W; x += w) ctx.drawImage(tile, x, y);
  }

  function drawPipes() {
    ctx.strokeStyle = '#245a17';
    ctx.lineWidth = 2;
    for (const p of game.pipes) {
      if (p.x > game.W + 20 || p.x + PIPE_W + CAP_OVER < -10) continue;
      const top = p.gapY - p.gapH / 2;
      const bot = p.gapY + p.gapH / 2;
      // top pipe
      ctx.save();
      ctx.translate(p.x, 0);
      ctx.fillStyle = pipeGrad;
      ctx.fillRect(0, -6, PIPE_W, top - CAP_H + 6);
      ctx.strokeRect(0, -6, PIPE_W, top - CAP_H + 6);
      ctx.translate(-CAP_OVER, top - CAP_H);
      ctx.fillStyle = capGrad;
      rrect(ctx, 0, 0, PIPE_W + CAP_OVER * 2, CAP_H, 5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // bottom pipe
      ctx.save();
      ctx.translate(p.x, bot + CAP_H);
      ctx.fillStyle = pipeGrad;
      ctx.fillRect(0, 0, PIPE_W, SKY_H - bot - CAP_H + 6);
      ctx.strokeRect(0, 0, PIPE_W, SKY_H - bot - CAP_H + 6);
      ctx.translate(-CAP_OVER, -CAP_H);
      ctx.fillStyle = capGrad;
      rrect(ctx, 0, 0, PIPE_W + CAP_OVER * 2, CAP_H, 5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawGround() {
    drawTiled(tiles.ground, 1, SKY_H);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, SKY_H, game.W, 2);
  }

  function drawParticles() {
    for (const p of game.particles) {
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawFloaters() {
    ctx.save();
    ctx.font = '700 22px ' + FONT;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    for (const f of game.floaters) {
      ctx.globalAlpha = clamp(f.life * 1.5, 0, 1);
      ctx.strokeStyle = 'rgba(27,36,55,.8)';
      ctx.fillStyle = '#fff';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  function drawBird() {
    const b = game.bird;
    const scream = (game.state === 'playing' || game.state === 'ready') ? game.lift : 0;
    const open = scream > 0.35 ? ((scream - 0.35) / 0.65) * 6 : 0;

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#4a3200';
    ctx.lineJoin = 'round';

    // tail
    ctx.fillStyle = '#f2b52a';
    ctx.beginPath();
    ctx.moveTo(-14, -2);
    ctx.lineTo(-27, -10);
    ctx.lineTo(-24, 6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // body
    ctx.fillStyle = '#ffd93b';
    ctx.beginPath();
    ctx.ellipse(0, 0, 19, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // belly
    ctx.fillStyle = '#fff1b8';
    ctx.beginPath();
    ctx.ellipse(2, 5, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    // wing
    const flap = Math.sin(b.wing) * (0.35 + 0.5 * scream);
    ctx.save();
    ctx.translate(-2, -1);
    ctx.rotate(flap);
    ctx.fillStyle = '#f5a623';
    ctx.beginPath();
    ctx.ellipse(-6, 3, 11, 6, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // eye
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(8, -5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1b2437';
    ctx.beginPath();
    ctx.arc(10, -5, 2.8, 0, Math.PI * 2);
    ctx.fill();

    // beak — opens when the player is loud
    ctx.fillStyle = '#ff7a1a';
    ctx.beginPath();
    ctx.moveTo(14, -1 - open);
    ctx.lineTo(28, 1 - open * 0.6);
    ctx.lineTo(14, 3 - open * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e8650d';
    ctx.beginPath();
    ctx.moveTo(14, 2 + open * 0.2);
    ctx.lineTo(27, 4 + open * 0.6);
    ctx.lineTo(14, 7 + open);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // sound waves
    if (scream > 0.5) {
      const a = (scream - 0.5) * 2;
      ctx.save();
      ctx.translate(b.x + 32, b.y + 2);
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.8 * a).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      const phase = (game.time * 40) % 9;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(0, 0, 8 + i * 9 + phase, -0.6, 0.6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawHud() {
    if (game.state === 'title') return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '700 52px ' + FONT;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(27,36,55,0.9)';
    ctx.fillStyle = '#fff';
    const s = String(game.score);
    ctx.strokeText(s, game.W / 2, 14);
    ctx.fillText(s, game.W / 2, 14);
    ctx.restore();
  }

  function render() {
    const W = game.W;
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.save();
    if (game.shake > 0) ctx.translate(rand(-1, 1) * game.shake * 0.5, rand(-1, 1) * game.shake * 0.5);
    drawSky();
    drawClouds();
    drawTiled(tiles.far, 0.3, SKY_H - tiles.far.height + 4);
    drawTiled(tiles.near, 0.5, SKY_H - tiles.near.height + 4);
    drawPipes();
    drawGround();
    drawParticles();
    drawBird();
    drawFloaters();
    ctx.restore();
    drawHud();
    if (game.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (game.flash * 0.7).toFixed(3) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* ==================================================================
   * Microphone, meter & calibration
   * ================================================================== */
  function refreshThresholds() {
    game.thresholds = VB.MicMeter.thresholds(game.settings.sensitivity, game.ambientDb);
    const pct = (db) => clamp((db + 60) / 60, 0, 1) * 100;
    ui.meterZone.style.left = pct(game.thresholds.lowDb) + '%';
    ui.meterZone.style.width = (pct(game.thresholds.highDb) - pct(game.thresholds.lowDb)) + '%';
  }

  function updateMeter() {
    const p = mic.enabled ? clamp((game.db + 60) / 60, 0, 1) : 0;
    ui.meterFill.style.transform = 'scaleX(' + p.toFixed(3) + ')';
    const cls = !mic.enabled || game.voiceLift <= 0 ? '' : (game.voiceLift >= 1 ? 'max' : 'lift');
    if (ui.meterFill.dataset.cls !== cls) {
      ui.meterFill.dataset.cls = cls;
      ui.meterFill.className = 'meter-fill' + (cls ? ' ' + cls : '');
    }
  }

  function calibrate() {
    if (!mic.enabled) return;
    game.calibrating = { samples: [], until: game.time + 1.1 };
    toast('Calibrating — stay quiet for a second…', 1300);
  }

  function finishCalibration() {
    const s = game.calibrating.samples.slice().sort((a, b) => a - b);
    game.calibrating = null;
    if (!s.length) return;
    game.ambientDb = s[Math.floor(s.length * 0.25)];
    refreshThresholds();
    toast('Microphone calibrated. Now make some noise!');
  }

  function micError(err) {
    const name = err && err.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
      return 'Microphone blocked. Allow it from the lock icon in the address bar — or play with the keyboard.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone found. You can still play with the keyboard.';
    if (name === 'NotReadableError' || name === 'TrackStartError') return 'Your microphone is busy in another app.';
    if (name === 'NotSupportedError') {
      return window.isSecureContext === false
        ? 'The microphone only works on a secure page — open the game over https:// or localhost.'
        : 'This browser cannot access the microphone. Try Chrome.';
    }
    return 'Could not start the microphone: ' + (err && err.message ? err.message : err);
  }

  function micUi() {
    ui.micLabel.textContent = mic.enabled ? 'Microphone on' : 'Enable microphone';
    ui.btnMic.title = mic.enabled ? 'Turn the microphone off' : 'Allow microphone access to fly with your voice';
    ui.btnMic.classList.toggle('on', mic.enabled);
    ui.btnMic.disabled = false;
    show(ui.btnCal, mic.enabled);
    if (game.state === 'title') goTitle();
  }

  function disableMic() {
    mic.onEnded = null;
    mic.stop();
    voice.stop();
    game.ambientDb = MIN_DB;
    refreshThresholds();
    micUi();
    toast('Microphone off — keyboard and touch controls still work.');
  }

  async function enableMic() {
    if (mic.enabled) return true;
    ui.btnMic.disabled = true;
    ui.micLabel.textContent = 'Requesting…';
    try {
      await mic.start();
    } catch (err) {
      micUi();
      toast(micError(err), 4500);
      return false;
    }
    mic.onEnded = () => { micUi(); toast('Microphone disconnected — keyboard controls still work.', 3500); };
    micUi();
    calibrate();
    if (game.settings.voice) voice.start();
    return true;
  }

  /* ==================================================================
   * Voice commands
   * ================================================================== */
  const PILL = {
    idle: ['Voice off', ''],
    starting: ['Voice: connecting…', 'warn'],
    listening: ['Listening', 'listening'],
    offline: ['Voice: offline', 'warn'],
    denied: ['Voice blocked', 'bad'],
    unsupported: ['Voice: needs Chrome', 'bad'],
    error: ['Voice: hiccup', 'warn']
  };

  function setPill(status) {
    const p = PILL[status] || PILL.idle;
    ui.pill.textContent = p[0];
    ui.pill.className = 'pill' + (p[1] ? ' ' + p[1] : '');
  }

  const WORD = { play: 'play', pause: 'stop', resume: 'continue', restart: 'restart' };

  function onVoiceCommand(cmd, transcript) {
    const chip = ui.chips.find((c) => c.dataset.cmd === cmd);
    if (chip) {
      chip.classList.add('hit');
      setTimeout(() => chip.classList.remove('hit'), 700);
    }
    toast('Heard “' + (WORD[cmd] || cmd) + '”', 1400);
    if (transcript && window.console) console.debug('[voice]', transcript, '→', cmd);

    switch (game.state) {
      case 'title':
        if (cmd === 'play' || cmd === 'restart' || cmd === 'resume') beginReady();
        break;
      case 'ready':
        if (cmd === 'play' || cmd === 'resume') { game.readyTimer = READY_GRACE + 1; startPlaying(); }
        break;
      case 'playing':
        if (cmd === 'pause') pause();
        else if (cmd === 'restart') restart();
        break;
      case 'paused':
        if (cmd === 'resume' || cmd === 'play') resume();
        else if (cmd === 'restart') restart();
        break;
      case 'over':
        if (cmd === 'play' || cmd === 'restart' || cmd === 'resume') beginReady();
        break;
      default:
        break;
    }
  }

  let lastVoiceStatus = null;
  const voice = new VB.VoiceCommands({
    lang: 'en-US',
    onCommand: onVoiceCommand,
    onStatus: (status, detail) => {
      setPill(status);
      if (status !== lastVoiceStatus) {
        if (status === 'denied') toast('Voice commands were blocked by the browser. Buttons and keys still work.', 4000);
        if (status === 'offline') toast('Voice recognition is offline (it needs an internet connection).', 3000);
      }
      lastVoiceStatus = status;
      if (detail && window.console) console.debug('[voice] status', status, detail);
    }
  });
  setPill(VB.VoiceCommands.supported ? 'idle' : 'unsupported');

  /* ==================================================================
   * Input
   * ================================================================== */
  function primaryAction() {
    switch (game.state) {
      case 'title': beginReady(); break;
      case 'ready': game.readyTimer = READY_GRACE + 1; startPlaying(); break;
      case 'paused': resume(); break;
      case 'over': if (game.time - game.overAt > 0.5) beginReady(); break;
      default: break;
    }
  }

  const inFlight = () => game.state === 'playing' || game.state === 'ready';

  /**
   * True when the focused form control should keep this key for itself.
   * While flying, Space always belongs to the bird — a checkbox or button that
   * kept focus after a mouse click must not swallow it.
   */
  function keyBelongsToTarget(e) {
    const t = e.target;
    if (!t || t === document.body || t === document.documentElement) return false;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') {
      const type = (t.type || 'text').toLowerCase();
      if (type === 'range') return /^(Arrow|Page|Home|End)/.test(e.code);
      if (type === 'checkbox' || type === 'radio') return e.code === 'Space' && !inFlight();
      return true;
    }
    if (tag === 'BUTTON' || tag === 'A') return e.code === 'Enter' || (e.code === 'Space' && !inFlight());
    return false;
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' && keyBelongsToTarget(e)) return;
    switch (e.code) {
      case 'Space':
      case 'ArrowUp':
      case 'KeyW':
        e.preventDefault();
        if (e.repeat) return;
        VB.getAudioContext(); // a key press is a user gesture: lets sound effects play for keyboard-only players
        if (game.state === 'playing') game.held = true;
        else if (game.state === 'ready') { game.held = true; primaryAction(); }
        else primaryAction();
        break;
      case 'Enter':
        e.preventDefault();
        VB.getAudioContext();
        primaryAction();
        break;
      case 'KeyP':
      case 'Escape':
        togglePause();
        break;
      case 'KeyR':
        if (game.state !== 'title') restart();
        break;
      default:
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') game.held = false;
  });

  window.addEventListener('blur', () => { game.held = false; game.pointerHeld = false; });

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dropFocus();
    VB.getAudioContext();
    if (game.state === 'playing') game.pointerHeld = true;
    else if (game.state === 'ready') { game.pointerHeld = true; primaryAction(); }
    else if (game.state === 'paused') resume();
  });
  window.addEventListener('pointerup', () => { game.pointerHeld = false; });
  window.addEventListener('pointercancel', () => { game.pointerHeld = false; });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.state === 'playing') pause();
  });

  /* ---- buttons ---- */
  ui.btnStartMic.addEventListener('click', async () => {
    if (!mic.enabled) await enableMic();
    beginReady();
  });
  ui.btnStartKb.addEventListener('click', () => { VB.getAudioContext(); beginReady(); });
  ui.btnPause.addEventListener('click', pause);
  ui.btnResume.addEventListener('click', resume);
  ui.btnRestart.addEventListener('click', restart);
  ui.btnMenu.addEventListener('click', goTitle);
  ui.btnAgain.addEventListener('click', beginReady);
  ui.btnMenu2.addEventListener('click', goTitle);
  ui.btnMic.addEventListener('click', () => { if (mic.enabled) disableMic(); else enableMic(); });
  ui.btnCal.addEventListener('click', calibrate);

  /* ---- settings ---- */
  ui.sens.value = Math.round(game.settings.sensitivity * 100);
  function sensLabel() {
    const s = game.settings.sensitivity;
    ui.sensVal.textContent = s < 0.3 ? 'shout' : s < 0.7 ? 'talk' : 'whisper';
  }
  sensLabel();
  ui.sens.addEventListener('input', () => {
    game.settings.sensitivity = clamp(ui.sens.value / 100, 0, 1);
    store.set('sensitivity', game.settings.sensitivity);
    sensLabel();
    refreshThresholds();
  });

  ui.optSfx.checked = game.settings.sfx;
  ui.optSfx.addEventListener('change', () => {
    game.settings.sfx = sfx.enabled = ui.optSfx.checked;
    store.set('sfx', game.settings.sfx);
    if (sfx.enabled) { VB.getAudioContext(); sfx.score(); }
  });

  ui.optVoice.checked = game.settings.voice;
  if (!VB.VoiceCommands.supported) {
    ui.optVoice.checked = false;
    ui.optVoice.disabled = true;
    ui.optVoiceLabel.classList.add('disabled');
    ui.optVoiceLabel.title = 'Speech recognition is not available in this browser (try Chrome)';
  }
  ui.optVoice.addEventListener('change', () => {
    game.settings.voice = ui.optVoice.checked;
    store.set('voice', game.settings.voice);
    if (game.settings.voice) {
      if (mic.enabled) voice.start();
      else toast('Voice commands start once the microphone is enabled.');
    } else {
      voice.stop();
    }
  });

  /* ==================================================================
   * Main loop
   * ================================================================== */
  let last = performance.now();
  let acc = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1;
    game.time += dt;

    // microphone → lift
    game.db = mic.enabled ? mic.update(dt) : MIN_DB;
    if (game.calibrating) {
      game.calibrating.samples.push(mic.rawDb);
      if (game.time >= game.calibrating.until) finishCalibration();
    }
    const th = game.thresholds;
    game.voiceLift = (mic.enabled && !game.calibrating)
      ? clamp((game.db - th.lowDb) / (th.highDb - th.lowDb), 0, 1)
      : 0;
    const manualTarget = (game.held || game.pointerHeld) ? 1 : 0;
    game.manualLift += (manualTarget - game.manualLift) * (1 - Math.exp(-dt / (manualTarget ? 0.15 : 0.1)));
    if (game.manualLift < 0.001) game.manualLift = 0;
    game.lift = Math.max(game.voiceLift, game.manualLift);

    // fixed-step simulation
    acc += dt;
    let steps = 0;
    while (acc >= STEP && steps < 16) {
      update(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === 16) acc = 0;

    updateMeter();
    render();
  }

  if (document.fonts && document.fonts.load) {
    document.fonts.load('700 52px "Fredoka"').catch(() => {});
  }
  refreshThresholds();
  micUi();
  goTitle();
  requestAnimationFrame(frame);

  /* Small debugging / testing surface. */
  VB.game = {
    state: () => game.state,
    score: () => game.score,
    best: () => game.best,
    data: game,
    mic,
    voice,
    beginReady,
    startPlaying,
    pause,
    resume,
    restart,
    goTitle,
    enableMic,
    disableMic,
    onVoiceCommand
  };
})();
