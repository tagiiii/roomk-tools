/* いろつなぎ（試作） — 画面と操作。ルールは engine.js。通信しない・音は鳴らさない */
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
  const SOFT_MS = 45;
  const LOCK_MS = 450;
  const MAX_RESETS = 10;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

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
  let anim = null;           // { snap, steps, i, t }
  let fullT = 0;
  let shownScore = 0;
  let last = 0;

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
    const padH = pad.offsetHeight ? pad.offsetHeight + 14 : 0;
    const sideH = narrow ? document.querySelector('.it-side').offsetHeight + 10 : 0;
    const availH = window.innerHeight - padH - sideH - (narrow ? 40 : 64);
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
    setupNext($('next1'));
    setupNext($('next2'));
    draw();
  }
  function setupNext(c) {
    const dpr = window.devicePixelRatio || 1;
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // つや
    c.beginPath();
    c.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,.45)';
    c.fill();
    // 中の形
    markPath(c, b.mark, x, y + r * 0.04, r * 0.42);
    c.fillStyle = 'rgba(255,255,255,.92)';
    c.fill();
    c.restore();
  }
  const cx = (x) => x * cell + cell / 2;
  const cy = (y) => topPx + y * cell + cell / 2;

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

    // ここがふさがると盤がいっぱい
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(185, 28, 28, .45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx(2), cy(0), cell * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

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
      const ease = 1 - (1 - p) * (1 - p);
      moving.forEach((m) => {
        const y = m.from + (m.to - m.from) * ease;
        ball(ctx, m.c, cx(m.x), cy(y), r);
      });
    }

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
      const w = c.getBoundingClientRect().width;
      const h = c.getBoundingClientRect().height;
      k.clearRect(0, 0, w, h);
      if (!pair) return;
      const r = Math.min(w * 0.42, h * 0.23);
      ball(k, pair[1], w / 2, h / 2 - r * 1.08, r);
      ball(k, pair[0], w / 2, h / 2 + r * 1.08, r);
    });
  }

  function hud() {
    $('score').textContent = String(shownScore);
    $('best').textContent = String(g ? g.bestChain : 0);
  }

  // ---------- 進める ----------
  function start() {
    opts = {
      colors: Number(radio('colors')) || 4,
      speed: SPEED[radio('speed')] || SPEED.slow,
      full: radio('full') === 'end' ? 'end' : 'clear',
    };
    g = E.newGame({ colors: opts.colors, seed: Date.now() });
    shownScore = 0;
    anim = null;
    paused = false;
    fallAcc = 0;
    lockWait = null;
    resets = 0;
    softHeld = false;
    hideOverlay();
    show('screen-play');
    fit();
    window.requestAnimationFrame(() => { fit(); drawNext(); });
    E.spawn(g);
    mode = 'play';
    drawNext();
    hud();
    draw();
  }

  function grounded() {
    return g.piece && !E.fits(g.board, Object.assign({}, g.piece, { y: g.piece.y + 1 }));
  }

  function act(name) {
    if (mode !== 'play' || paused || !g.piece) return;
    let ok = false;
    if (name === 'left') ok = E.move(g, -1);
    else if (name === 'right') ok = E.move(g, 1);
    else if (name === 'rotL') ok = E.rotate(g, -1);
    else if (name === 'rotR') ok = E.rotate(g, 1);
    else if (name === 'down') { ok = E.down(g); if (ok) { fallAcc = 0; lockWait = null; } }
    else if (name === 'drop') { E.hardDropRows(g); doLock(); return; }
    if (ok && lockWait !== null && name !== 'down' && resets < MAX_RESETS) {
      lockWait = grounded() ? 0 : null;
      resets++;
    }
    draw();
  }

  function doLock() {
    E.lock(g);
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
    anim = { snap, steps: res.steps, i: 0, t: 0 };
    mode = 'anim';
    beginStep();
  }

  function beginStep() {
    const st = anim.steps[anim.i];
    if (st.type === 'pop' && st.chain >= 2) chainText(st.chain + 'れんさ');
  }

  function endStep() {
    const st = anim.steps[anim.i];
    if (st.type === 'fall') {
      st.moved.forEach((m) => E.set(anim.snap, m.x, m.from, 0));
      st.moved.forEach((m) => E.set(anim.snap, m.x, m.to, m.c));
    } else {
      st.groups.forEach((gr) => gr.cells.forEach((q) => E.set(anim.snap, q.x, q.y, 0)));
      shownScore += st.points;
      hud();
    }
    anim.i++;
    anim.t = 0;
    if (anim.i >= anim.steps.length) { anim = null; afterSettle(); }
    else beginStep();
  }

  function afterSettle() {
    shownScore = g.score;
    hud();
    if (E.spawn(g)) { mode = 'play'; drawNext(); draw(); return; }
    if (opts.full === 'end') { finish(); return; }
    mode = 'full';
    fullT = 0;
    showOverlay('盤がいっぱい。\nからにしてつづけるよ', false);
    draw();
  }

  function tick(ts) {
    const dt = last ? Math.min(100, ts - last) : 0;
    last = ts;
    if (!paused && g) {
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
          if (lockWait >= (softHeld ? LOCK_MS / 2 : LOCK_MS)) doLock();
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
      }
    }
    window.requestAnimationFrame(tick);
  }

  let chainTimer = 0;
  function chainText(text) {
    const el = $('chainText');
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(chainTimer);
    chainTimer = setTimeout(() => el.classList.remove('show'), 900);
  }

  function showOverlay(text, resumable) {
    $('overlayText').textContent = text;
    $('btnResume').hidden = !resumable;
    $('overlay').hidden = false;
  }
  function hideOverlay() { $('overlay').hidden = true; }

  function setPaused(v) {
    if (mode === 'idle' || mode === 'end') return;
    if (mode === 'full') return;
    paused = v;
    softHeld = false;
    if (v) showOverlay('ひと休み中', true);
    else hideOverlay();
    $('btnPause').textContent = v ? 'つづける' : 'ひと休み';
  }

  function finish() {
    mode = 'end';
    paused = false;
    hideOverlay();
    $('endScore').textContent = String(g.score);
    $('endBest').textContent = String(g.bestChain);
    $('endPops').textContent = String(g.pops);
    show('screen-end');
  }

  // ---------- 操作 ----------
  document.addEventListener('keydown', (e) => {
    if (!$('screen-play').classList.contains('active')) return;
    const k = e.key;
    let handled = true;
    if (k === 'ArrowLeft') act('left');
    else if (k === 'ArrowRight') act('right');
    else if (k === 'ArrowUp' || k === 'x' || k === 'X') { if (!e.repeat) act('rotR'); }
    else if (k === 'z' || k === 'Z') { if (!e.repeat) act('rotL'); }
    else if (k === 'ArrowDown') softHeld = true;
    else if (k === ' ') { if (!e.repeat) act('drop'); }
    else if (k === 'Escape' || k === 'p' || k === 'P') { if (!e.repeat) setPaused(!paused); }
    else handled = false;
    if (handled) e.preventDefault();
  });
  document.addEventListener('keyup', (e) => { if (e.key === 'ArrowDown') softHeld = false; });

  // 操作ボタン（左右と下げるは押しつづけるとくりかえす）
  document.querySelectorAll('.it-pad__btn').forEach((btn) => {
    const name = btn.dataset.act;
    let rep = 0;
    let first = 0;
    const stop = () => {
      clearTimeout(first); clearInterval(rep);
      if (name === 'down') softHeld = false;
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (name === 'down') { softHeld = true; act('down'); return; }
      act(name);
      if (name === 'left' || name === 'right') {
        first = setTimeout(() => { rep = setInterval(() => act(name), 70); }, 180);
      }
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  $('btnStart').addEventListener('click', start);
  $('btnAgain').addEventListener('click', start);
  $('btnTop').addEventListener('click', () => { mode = 'idle'; g = null; show('screen-top'); });
  $('btnPause').addEventListener('click', () => setPaused(!paused));
  $('btnResume').addEventListener('click', () => setPaused(false));
  $('btnQuit').addEventListener('click', () => { if (g) finish(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && (mode === 'play' || mode === 'anim')) setPaused(true); });
  window.addEventListener('resize', () => { if ($('screen-play').classList.contains('active')) { fit(); drawNext(); } });

  window.requestAnimationFrame(tick);
})();
