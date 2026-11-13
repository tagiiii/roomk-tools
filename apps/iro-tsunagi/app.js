/* いろつなぎ — 画面と操作。ルールは engine.js。通信しない（効果音のファイルを読むときだけ同じサイトから読む） */
(function () {
  'use strict';

  const E = window.IroEngine;
  const $ = (id) => document.getElementById(id);

  // 色ごとに中の形を変えて、色だけにたよらず見分けられるようにする
  const BALL = {
    1: { fill: '#E0706A', edge: '#A8463F', mark: 'circle' },
    2: { fill: '#4F86C6', edge: '#2F5F98', mark: 'triangle' },
    3: { fill: '#5BAA6A', edge: '#3A7A48', mark: 'square' },
    4: { fill: '#F2C14E', edge: '#B88A1C', mark: 'star' },
    5: { fill: '#9B72C4', edge: '#6C4B92', mark: 'diamond' },
  };
  const SPEED = { slow: 900, normal: 600, fast: 350 };
  const SOFT_MS = 80;        // 下の押しっぱなし: 押したときに1マス、そのあと同じ速さで1マスずつ（途中で速くしない）
  const DAS_MS = 130;        // 左右の押しっぱなし: はじめに1マス、この時間待って
  const ARR_MS = 30;         // そのあとはこの間かくで1マスずつ
  const LOCK_MS = 450;       // 着地してから置かれるまで
  const MAX_RESETS = 10;     // 着地したまま動かして待ち時間をのばせる回数
  const FLIP_MS = 350;       // 回せなかったあと、この時間のうちにもう一度回すと上下を入れかえる
  const MSG_MS = 1400;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(window.location.search);   // seed（玉の順番を決める）・test（テストから状態を読む）

  const boardC = $('board');
  const ctx = boardC.getContext('2d');
  let cell = 40;
  let topPx = 20;

  let g = null;
  let opts = null;
  let mode = 'idle';         // idle / play / anim / full / end
  let paused = false;
  let fallAcc = 0;
  let lockWait = null;       // 着地してからの時間（ms）。浮いているときは null
  let resets = 0;
  let softHeld = false;
  let anim = null;           // { snap, steps, i, t, allClear }
  let fullT = 0;
  let shownScore = 0;
  let timeLeft = 0;          // ms。時間なしは 0
  let lastRotFail = -1e9;
  let parts = [];            // 消えたときの粒 { x, y, vx, vy, c, t }
  let trail = null;          // 一気に落としたときの跡 { cells, t }
  let last = 0;

  // ---------- 効果音（はじめは切。入にした端末だけファイルを読む） ----------
  const SFX_KEY = 'irotsunagi:sfx';
  const SFX_VER = '20261113a';
  const SFX_GAIN = 0.25;
  // 音のファイルは「すとんブロック」と同じもの（ElevenLabs で作った）
  const SFX_FILES = { move: 0.35, rotate: 0.5, place: 0.6, drop: 0.8, ding: 0.8, allclear: 0.7, finish: 0.8 };
  const sfx = { on: false, ac: null, out: null, buf: {}, loading: false };
  try { sfx.on = localStorage.getItem(SFX_KEY) === '1'; } catch (e) { /* 使えなければ切のまま */ }
  (function syncSfx() {
    const el = document.querySelector('input[name="sfx"][value="' + (sfx.on ? 'on' : 'off') + '"]');
    if (el) el.checked = true;
  })();
  function ensureAudio() {
    if (!sfx.on) return;
    try {
      if (!sfx.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        sfx.ac = new AC({ latencyHint: 'interactive' });
        sfx.out = sfx.ac.createGain();
        sfx.out.gain.value = SFX_GAIN;
        sfx.out.connect(sfx.ac.destination);
      }
      if (sfx.ac.state !== 'running') sfx.ac.resume().catch(() => {});
      if (!sfx.loading) {
        sfx.loading = true;
        Object.keys(SFX_FILES).forEach((name) => {
          fetch('sfx/' + name + '.mp3?v=' + SFX_VER)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            .then((data) => sfx.ac.decodeAudioData(data))
            .then((buf) => { sfx.buf[name] = buf; })
            .catch(() => { /* 読めなければ鳴らさない */ });
        });
      }
    } catch (e) { /* 音が使えなくても遊べる */ }
  }
  function play(name, rate, when) {
    if (!sfx.on || !sfx.ac || sfx.ac.state !== 'running' || !sfx.buf[name]) return;
    const src = sfx.ac.createBufferSource();
    const gn = sfx.ac.createGain();
    src.buffer = sfx.buf[name];
    src.playbackRate.value = rate || 1;
    gn.gain.value = SFX_FILES[name] || 1;
    src.connect(gn).connect(sfx.out);
    src.start(sfx.ac.currentTime + (when || 0));
  }
  // れんさの音: れんさが1つ増えるごとに2音（全音）高く。1オクターブまで
  function playChain(chain) {
    const rate = Math.pow(2, Math.min(12, (chain - 1) * 2) / 12);
    play('ding', rate);
    if (chain >= 2) play('ding', rate * 1.26, 0.07);
    if (chain >= 3) play('ding', rate * 1.498, 0.14);
  }

  // ---------- 画面の切りかえ ----------
  function show(id) {
    document.querySelectorAll('.it-screen').forEach((s) => s.classList.toggle('active', s.id === id));
    window.scrollTo(0, 0);
  }
  function radio(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  // ---------- 大きさ ----------
  function fit() {
    const narrow = window.innerWidth <= 700;
    const pad = document.querySelector('.it-pad');
    // 操作ボタンが出るときは、その下に右下の丸ボタン（「？」・フィードバック）の分（80px）をあけ、重ならないようにする
    const padH = pad.offsetHeight ? pad.offsetHeight + 14 + 80 : 0;
    const sideH = narrow ? document.querySelector('.it-side').offsetHeight + 10 : 0;
    const msgH = narrow ? 30 : 0;
    const availH = window.innerHeight - padH - sideH - msgH - (narrow ? 24 : 64);
    const availW = narrow ? window.innerWidth - 40 : 600;
    cell = Math.max(22, Math.min(52, Math.floor(availH / (E.H + 0.5)), Math.floor(availW / E.W)));
    topPx = Math.round(cell * 0.5);
    const dpr = window.devicePixelRatio || 1;
    const w = cell * E.W;
    const h = topPx + cell * E.H;
    boardC.style.width = w + 'px';
    boardC.style.height = h + 'px';
    boardC.width = Math.round(w * dpr);
    boardC.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    [$('next1'), $('next2')].forEach((c) => {
      const r = c.getBoundingClientRect();
      if (!r.width) return;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    draw();
    drawNext();
  }

  // ---------- 描く ----------
  function markPath(c, kind, x, y, s) {
    c.beginPath();
    if (kind === 'circle') {
      c.arc(x, y, s * 0.8, 0, Math.PI * 2);
    } else if (kind === 'triangle') {
      c.moveTo(x, y - s); c.lineTo(x + s * 0.95, y + s * 0.7); c.lineTo(x - s * 0.95, y + s * 0.7); c.closePath();
    } else if (kind === 'square') {
      c.rect(x - s * 0.72, y - s * 0.72, s * 1.44, s * 1.44);
    } else if (kind === 'diamond') {
      c.moveTo(x, y - s); c.lineTo(x + s * 0.8, y); c.lineTo(x, y + s); c.lineTo(x - s * 0.8, y); c.closePath();
    } else {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? s * 0.45 : s * 1.05;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath();
    }
  }
  function ball(c, color, x, y, r, alpha) {
    const b = BALL[color];
    if (!b) return;
    c.save();
    c.globalAlpha = alpha === undefined ? 1 : alpha;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = b.fill;
    c.fill();
    c.lineWidth = Math.max(1.5, r * 0.08);
    c.strokeStyle = b.edge;
    c.stroke();
    c.beginPath();
    c.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,.45)';
    c.fill();
    markPath(c, b.mark, x, y + r * 0.04, r * 0.42);
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.fill();
    c.restore();
  }
  const cx = (x) => x * cell + cell / 2;
  const cy = (y) => topPx + y * cell + cell / 2;

  // 同じ色がとなり合うと、玉どうしをつないで見せる
  function bridges(board, skip) {
    const t = cell * 0.5;
    for (let y = 0; y < E.H; y++) {
      for (let x = 0; x < E.W; x++) {
        const v = E.get(board, x, y);
        if (!v || skip[x + ',' + y]) continue;
        ctx.fillStyle = BALL[v].fill;
        if (x + 1 < E.W && E.get(board, x + 1, y) === v && !skip[(x + 1) + ',' + y]) {
          ctx.fillRect(cx(x), cy(y) - t / 2, cell, t);
        }
        if (y + 1 < E.H && E.get(board, x, y + 1) === v && !skip[x + ',' + (y + 1)]) {
          ctx.fillRect(cx(x) - t / 2, cy(y), t, cell);
        }
      }
    }
  }

  function draw() {
    const w = cell * E.W;
    const h = topPx + cell * E.H;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#FFF8EC';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(106, 79, 53, .10)';
    ctx.fillRect(0, 0, w, topPx);
    ctx.strokeStyle = '#EFE2CC';
    ctx.lineWidth = 1;
    for (let x = 1; x < E.W; x++) { ctx.beginPath(); ctx.moveTo(x * cell + 0.5, topPx); ctx.lineTo(x * cell + 0.5, h); ctx.stroke(); }
    for (let y = 1; y < E.H; y++) { ctx.beginPath(); ctx.moveTo(0, topPx + y * cell + 0.5); ctx.lineTo(w, topPx + y * cell + 0.5); ctx.stroke(); }
    if (!g) return;

    // 玉が出る所。ここがふさがると盤がいっぱい（いっぱいのときは赤くぬる）
    ctx.save();
    if (mode === 'full') {
      ctx.fillStyle = 'rgba(185, 28, 28, .35)';
      ctx.fillRect(2 * cell, topPx, cell, cell);
    }
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(185, 28, 28, .5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx(2), cy(0), cell * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 一気に落とした跡
    if (trail && !reduce.matches) {
      const a = Math.max(0, 1 - trail.t / 220) * 0.35;
      trail.cells.forEach((q) => {
        ctx.fillStyle = BALL[q.c].fill;
        ctx.globalAlpha = a;
        ctx.fillRect(q.x * cell + cell * 0.2, topPx + q.from * cell + cell / 2, cell * 0.6, (q.to - q.from) * cell);
        ctx.globalAlpha = 1;
      });
    }

    const r = cell * 0.44;
    const board = anim ? anim.snap : g.board;
    const skip = {};
    let moving = null;
    let popping = null;
    let p = 0;
    if (anim) {
      const st = anim.steps[anim.i];
      p = st.dur ? Math.min(1, anim.t / st.dur) : 1;
      if (st.type === 'fall') {
        moving = st.moved;
        moving.forEach((m) => { skip[m.x + ',' + m.from] = true; });
      } else {
        popping = {};
        st.groups.forEach((gr) => gr.cells.forEach((q) => { popping[q.x + ',' + q.y] = true; }));
      }
    }

    bridges(board, skip);
    for (let y = E.TOP; y < E.H; y++) {
      for (let x = 0; x < E.W; x++) {
        const v = E.get(board, x, y);
        if (!v || skip[x + ',' + y]) continue;
        if (popping && popping[x + ',' + y]) {
          if (reduce.matches) {
            ball(ctx, v, cx(x), cy(y), r);
            ctx.save();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(cx(x), cy(y), r + 1, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          } else {
            const grow = 1 + 0.18 * Math.sin(Math.min(1, p * 1.6) * Math.PI);
            const fade = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
            ball(ctx, v, cx(x), cy(y), r * grow, Math.max(0, fade));
          }
        } else {
          ball(ctx, v, cx(x), cy(y), r);
        }
      }
    }
    if (moving) {
      const ease = p * p;   // 落ちるので、だんだん速く
      moving.forEach((m) => {
        const y = m.from + (m.to - m.from) * ease;
        ball(ctx, m.c, cx(m.x), cy(y), r);
      });
    }

    // 消えたときの粒
    parts.forEach((q) => {
      ctx.globalAlpha = Math.max(0, 1 - q.t / 520);
      ctx.fillStyle = BALL[q.c].fill;
      ctx.beginPath();
      ctx.arc(q.x * cell, topPx + q.y * cell, cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    if (g.piece && !anim) {
      const gh = E.ghost(g);
      if (gh) {
        gh.forEach((q) => {
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = BALL[q.c].edge;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx(q.x), cy(q.y), r * 0.8, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        });
      }
      E.cells(g.piece).forEach((q) => ball(ctx, q.c, cx(q.x), cy(q.y), r));
    }
  }

  function drawNext() {
    [$('next1'), $('next2')].forEach((c, i) => {
      const pair = g && g.queue[i];
      const k = c.getContext('2d');
      const rect = c.getBoundingClientRect();
      k.clearRect(0, 0, rect.width, rect.height);
      if (!pair) return;
      const rr = Math.min(rect.width * 0.42, rect.height * 0.23);
      ball(k, pair[1], rect.width / 2, rect.height / 2 - rr * 1.08, rr);
      ball(k, pair[0], rect.width / 2, rect.height / 2 + rr * 1.08, rr);
    });
  }

  function fmtTime(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function hud() {
    $('score').textContent = String(shownScore);
    $('best').textContent = String(g ? g.bestChain : 0);
    if (opts && opts.time) $('timer').textContent = fmtTime(timeLeft);
  }

  let msgTimer = 0;
  function message(text) {
    const el = $('chainText');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), MSG_MS);
  }

  // ---------- 進める ----------
  function start() {
    sfx.on = radio('sfx') === 'on';
    try { localStorage.setItem(SFX_KEY, sfx.on ? '1' : '0'); } catch (e) { /* 残せなくても遊べる */ }
    ensureAudio();
    opts = {
      colors: Number(radio('colors')) || 4,
      speed: SPEED[radio('speed')] || SPEED.slow,
      full: radio('full') === 'end' ? 'end' : 'clear',
      time: Number(radio('time')) || 0,
    };
    g = E.newGame({ colors: opts.colors, seed: Number(params.get('seed')) || Date.now() });
    shownScore = 0;
    timeLeft = opts.time * 1000;
    anim = null;
    parts = [];
    trail = null;
    paused = false;
    fallAcc = 0;
    lockWait = null;
    resets = 0;
    softHeld = false;
    stopRepeat();
    hideOverlay();
    $('chainText').classList.remove('show');
    $('timerBox').hidden = !opts.time;
    $('btnPause').textContent = 'とめる';
    show('screen-play');
    E.spawn(g);
    mode = 'play';
    fit();
    window.requestAnimationFrame(fit);
    hud();
    if (window.RoomkStats) window.RoomkStats.count('start');
  }

  function grounded() {
    return g.piece && !E.fits(g.board, Object.assign({}, g.piece, { y: g.piece.y + 1 }));
  }

  function act(name) {
    if (mode !== 'play' || paused || !g.piece) return false;
    let ok = false;
    if (name === 'left' || name === 'right') {
      ok = E.move(g, name === 'left' ? -1 : 1);
      if (ok) play('move');
    } else if (name === 'rotL' || name === 'rotR') {
      const now = performance.now();
      ok = E.rotate(g, name === 'rotL' ? -1 : 1, now - lastRotFail < FLIP_MS);
      if (ok) { play('rotate'); lastRotFail = -1e9; } else lastRotFail = now;
    } else if (name === 'down') {
      ok = E.down(g);
      if (ok) { fallAcc = 0; lockWait = null; }
    } else if (name === 'drop') {
      const before = E.cells(g.piece);
      E.hardDropRows(g);
      const after = E.cells(g.piece);
      trail = { cells: before.map((q, i) => ({ x: q.x, from: q.y, to: after[i].y, c: q.c })), t: 0 };
      play('drop');
      doLock(true);
      return true;
    }
    if (ok && lockWait !== null && name !== 'down' && resets < MAX_RESETS) {
      lockWait = grounded() ? 0 : null;
      resets++;
    }
    draw();
    return ok;
  }

  function doLock(dropped) {
    E.lock(g);
    if (!dropped) play('place');
    const snap = g.board.map((row) => row.slice());   // 置いた直後の盤。ここから順に落とす・消すを見せる
    const res = E.settle(g);
    lockWait = null;
    resets = 0;
    fallAcc = 0;
    if (!res.steps.length) { afterSettle(); return; }
    res.steps.forEach((st) => {
      if (st.type === 'fall') {
        const dist = st.moved.reduce((m, q) => Math.max(m, q.to - q.from), 0);
        st.dur = reduce.matches ? 0 : Math.min(280, 70 + dist * 35);
      } else {
        st.dur = reduce.matches ? 380 : 440;
      }
    });
    anim = { snap, steps: res.steps, i: 0, t: 0, allClear: res.allClear };
    mode = 'anim';
    beginStep();
  }

  function beginStep() {
    const st = anim.steps[anim.i];
    if (st.type !== 'pop') return;
    playChain(st.chain);
    if (st.chain >= 2) message(st.chain + 'れんさ！');
  }

  function burst(groups) {
    if (reduce.matches) return;
    groups.forEach((gr) => gr.cells.forEach((q) => {
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 3;
        parts.push({ x: q.x + 0.5, y: q.y + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, c: gr.c, t: 0 });
      }
    }));
  }

  function endStep() {
    const st = anim.steps[anim.i];
    if (st.type === 'fall') {
      st.moved.forEach((m) => E.set(anim.snap, m.x, m.from, 0));
      st.moved.forEach((m) => E.set(anim.snap, m.x, m.to, m.c));
    } else {
      st.groups.forEach((gr) => gr.cells.forEach((q) => E.set(anim.snap, q.x, q.y, 0)));
      burst(st.groups);
      shownScore += st.points;
      hud();
    }
    anim.i++;
    anim.t = 0;
    if (anim.i < anim.steps.length) { beginStep(); return; }
    const allClear = anim.allClear;
    anim = null;
    if (allClear) { message('全部消えた！'); play('allclear', 1, 0.15); }
    afterSettle();
  }

  function afterSettle() {
    shownScore = g.score;
    hud();
    if (E.spawn(g)) { mode = 'play'; drawNext(); draw(); return; }
    if (opts.full === 'end') { finish('おしまい'); return; }
    mode = 'full';
    fullT = 0;
    softHeld = false;
    stopRepeat();
    showOverlay('盤がいっぱい。\nからにしてつづけるよ', false);
    draw();
  }

  function tick(ts) {
    const dt = last ? Math.min(100, ts - last) : 0;
    last = ts;
    if (!paused && (mode === 'play' || mode === 'anim') && modalOpen()) setPaused(true);
    if (!paused && g && mode !== 'end' && mode !== 'idle') {
      if (opts.time && timeLeft > 0) {
        const before = Math.ceil(timeLeft / 1000);
        timeLeft = Math.max(0, timeLeft - dt);
        if (Math.ceil(timeLeft / 1000) !== before) hud();
        if (timeLeft === 0) { finish('時間になったよ'); window.requestAnimationFrame(tick); return; }
      }
      if (trail) { trail.t += dt; if (trail.t > 220) trail = null; }
      if (parts.length) {
        const k = dt / 1000;
        parts.forEach((q) => { q.t += dt; q.x += q.vx * k; q.y += q.vy * k; q.vy += 9 * k; });
        parts = parts.filter((q) => q.t < 520);
      }
      if (mode === 'play' && g.piece) {
        fallAcc += dt;
        const interval = softHeld ? SOFT_MS : opts.speed;
        while (fallAcc >= interval) {
          fallAcc -= interval;
          if (E.down(g)) lockWait = null;
          else { fallAcc = 0; break; }
        }
        if (grounded()) {
          lockWait = (lockWait === null ? 0 : lockWait + dt);
          if (lockWait >= LOCK_MS) doLock(false);
        } else {
          lockWait = null;
        }
        draw();
      } else if (mode === 'anim' && anim) {
        anim.t += dt;
        if (anim.t >= anim.steps[anim.i].dur) endStep();
        draw();
      } else if (mode === 'full') {
        fullT += dt;
        if (fullT >= 1300) {
          E.clearBoard(g);
          hideOverlay();
          E.spawn(g);
          mode = 'play';
          drawNext();
          draw();
        }
      } else if (parts.length || trail) {
        draw();
      }
    }
    window.requestAnimationFrame(tick);
  }

  function showOverlay(text, resumable) {
    $('overlayText').textContent = text;
    $('btnResume').hidden = !resumable;
    $('overlay').hidden = false;
  }
  function hideOverlay() { $('overlay').hidden = true; }

  function setPaused(v) {
    if (mode !== 'play' && mode !== 'anim') return;
    paused = v;
    softHeld = false;
    stopRepeat();
    if (v) showOverlay('とめています', true);
    else hideOverlay();
    $('btnPause').textContent = v ? 'つづける' : 'とめる';
  }

  function finish(title) {
    mode = 'end';
    paused = false;
    softHeld = false;
    stopRepeat();
    hideOverlay();
    play('finish');
    $('endTitle').textContent = title;
    $('endScore').textContent = String(g.score);
    $('endBest').textContent = String(g.bestChain);
    $('endPops').textContent = String(g.pops);
    $('endAll').textContent = g.allClears + '回';
    $('endClears').textContent = g.clears + '回';
    $('endClearsRow').hidden = opts.full !== 'clear';
    show('screen-end');
  }

  // ---------- 押しっぱなし（左右）: はじめに1マス、DAS_MS 待って、ARR_MS ごとに1マス ----------
  let repDir = null;
  let repWait = 0;
  let repInt = 0;
  function startRepeat(name) {
    stopRepeat();
    repDir = name;
    act(name);
    repWait = setTimeout(() => { repInt = setInterval(() => act(name), ARR_MS); }, DAS_MS);
  }
  function stopRepeat(name) {
    if (name && repDir !== name) return;
    clearTimeout(repWait);
    clearInterval(repInt);
    repDir = null;
  }

  // ---------- キーボード ----------
  const KEYS = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowUp: 'rotR', w: 'rotR', W: 'rotR', x: 'rotR', X: 'rotR',
    z: 'rotL', Z: 'rotL',
    ' ': 'drop',
    p: 'pause', P: 'pause', Escape: 'pause',
  };
  // 「あそびかた」などが開いているあいだは、キーで動かさない（開いたらとめる）
  const modalOpen = () => !!document.querySelector('.howto-modal.show, .howto-slides.show, [aria-modal="true"].show');
  function playing() {
    return $('screen-play').classList.contains('active') && !modalOpen();
  }
  document.addEventListener('keydown', (e) => {
    const name = KEYS[e.key];
    if (!name || !playing()) return;
    e.preventDefault();
    if (e.repeat) return;   // くり返しは自分で数える（OS のくり返しの速さにたよらない）
    if (name === 'left' || name === 'right') startRepeat(name);
    else if (name === 'down') { softHeld = true; act('down'); }
    else if (name === 'pause') setPaused(!paused);
    else act(name);
  });
  document.addEventListener('keyup', (e) => {
    const name = KEYS[e.key];
    if (name === 'left' || name === 'right') stopRepeat(name);
    else if (name === 'down') softHeld = false;
  });
  window.addEventListener('blur', () => { stopRepeat(); softHeld = false; });

  // ---------- 操作ボタン ----------
  document.querySelectorAll('.it-pad__btn').forEach((btn) => {
    const name = btn.dataset.act;
    const stop = () => {
      if (name === 'left' || name === 'right') stopRepeat(name);
      if (name === 'down') softHeld = false;
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (name === 'left' || name === 'right') startRepeat(name);
      else if (name === 'down') { softHeld = true; act('down'); }
      else act(name);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  $('btnStart').addEventListener('click', start);
  $('btnAgain').addEventListener('click', start);
  $('btnTop').addEventListener('click', () => { mode = 'idle'; g = null; show('screen-top'); });
  $('btnPause').addEventListener('click', () => setPaused(!paused));
  $('btnResume').addEventListener('click', () => setPaused(false));
  $('btnQuit').addEventListener('click', () => { if (g && mode !== 'end') finish('おしまい'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', () => { if ($('screen-play').classList.contains('active')) fit(); });

  // テスト用（?test=1 のときだけ）。画面からは使わない
  if (params.has('test')) {
    window.__iro = {
      state: () => ({
        mode, paused, piece: g && g.piece && Object.assign({}, g.piece), board: g && g.board.map((r) => r.slice()),
        score: g && g.score, bestChain: g && g.bestChain, clears: g && g.clears, allClears: g && g.allClears,
        timeLeft, sfxLoaded: Object.keys(sfx.buf),
      }),
      setTimeLeft: (ms) => { timeLeft = ms; },
    };
  }

  window.requestAnimationFrame(tick);
})();
