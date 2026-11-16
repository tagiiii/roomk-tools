/* のりあいロード（試作）— 画面・操作・ウィンドウの間の同期
 * 外へは通信しない。ウィンドウごとに1人のときは、同じパソコンの中の BroadcastChannel だけを使う
 */
(function () {
  'use strict';
  const E = window.NoriaiEngine;
  const $ = (id) => document.getElementById(id);
  const DT = 1 / 60;

  const SEAT_COLORS = ['#E4572E', '#2E86DE', '#3B9B55', '#9B59B6'];
  const SEAT_DARK = ['#A63A17', '#1D5F9E', '#276B3A', '#6C3A82'];
  const LINK_COLORS = { A: '#C9A227', B: '#2B9C96', C: '#D0609A', D: '#6D7F8E', E: '#B5651D', F: '#5A8F29', G: '#C74B4B', H: '#4B6EC7' };
  const LINK_SHAPES = { A: 'circle', B: 'triangle', C: 'square', D: 'diamond', E: 'star', F: 'circle', G: 'triangle', H: 'square' };
  const SAYS = ['待って', '行くよ', '乗って', '押して', 'ありがとう', 'いいね'];
  const KEYSETS = [
    { l: 'ArrowLeft', r: 'ArrowRight', j: 'ArrowUp', a: 'ArrowDown' },
    { l: 'KeyA', r: 'KeyD', j: 'KeyW', a: 'KeyS' },
    { l: 'KeyJ', r: 'KeyL', j: 'KeyI', a: 'KeyK' },
    { l: 'KeyF', r: 'KeyH', j: 'KeyT', a: 'KeyG' },
  ];
  const SOLO_KEYS = { l: ['ArrowLeft', 'KeyA'], r: ['ArrowRight', 'KeyD'], j: ['ArrowUp', 'KeyW', 'Space'], a: ['ArrowDown', 'KeyS', 'ShiftLeft', 'ShiftRight'] };
  const LAGS = [0, 100, 200, 300];
  const RATES = [5, 10, 20];
  const STORE = 'noriai-road:set';
  const CHANNEL = 'noriai-road';

  const set = loadSet();
  const state = {
    mode: null,          // 'one' | 'net'
    world: null,
    seat: 1,             // ウィンドウごとのときの自分の番号
    pick: 1,             // 1台のとき、画面のボタンで動かす人
    keys: new Set(),
    latch: [{}, {}, {}, {}],
    pad: { l: false, r: false, j: false, a: false },
    padLatch: {},
    prevJump: [false, false, false, false],
    camX: 0,
    says: {},            // seat → { text, until }
    running: false,
    acc: 0,
    last: 0,
    hintOpen: true,
  };

  function loadSet() {
    const d = { stage: 0, n: 2, seat: 1, lag: 100, rate: 10 };
    try { return { ...d, ...JSON.parse(localStorage.getItem(STORE) || '{}') }; } catch { return d; }
  }
  function saveSet() { try { localStorage.setItem(STORE, JSON.stringify(set)); } catch { /* 保存できなくても動く */ } }

  /* ── トップ ── */
  function seg(box, options, value, onPick) {
    box.textContent = '';
    for (const o of options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.label;
      b.setAttribute('aria-pressed', String(o.value === value));
      b.addEventListener('click', () => onPick(o.value));
      box.appendChild(b);
    }
  }
  function renderTop() {
    seg($('stageSeg'), E.STAGES.map((s, i) => ({ label: (i + 1) + '. ' + s.name, value: i })), set.stage, (v) => { set.stage = v; saveSet(); renderTop(); });
    $('stageNote').textContent = E.STAGES[set.stage].hint;
    seg($('countSeg'), [2, 3, 4].map((n) => ({ label: n + '人', value: n })), set.n, (v) => { set.n = v; saveSet(); renderTop(); });
    seg($('seatSeg'), [1, 2, 3, 4].map((n) => ({ label: n + '番', value: n })), set.seat, (v) => { set.seat = v; saveSet(); renderTop(); });
    seg($('lagSeg'), LAGS.map((v) => ({ label: v ? (v / 1000) + '秒' : 'なし', value: v })), set.lag, (v) => { set.lag = v; saveSet(); renderTop(); });
    seg($('rateSeg'), RATES.map((v) => ({ label: v + '回', value: v })), set.rate, (v) => { set.rate = v; saveSet(); renderTop(); });
  }
  function show(id) {
    for (const s of document.querySelectorAll('.nr-screen')) s.classList.toggle('active', s.id === 'screen-' + id);
  }

  /* ── 始める ── */
  function startOne() {
    stopNet();
    state.mode = 'one';
    state.pick = 1;
    newWorld(set.stage, set.n);
    enterGame();
  }
  function startNet() {
    state.mode = 'net';
    state.seat = set.seat;
    openNet();
    if (state.seat === 1) {
      net.epoch = Date.now();
      newWorld(set.stage, set.n);
      sendStage();
    } else {
      state.world = null;
      send({ k: 'hello', s: state.seat });
    }
    enterGame();
  }
  function newWorld(stage, n) {
    state.world = E.createWorld(stage, n);
    state.camX = E.camLeft(state.world, state.world.players) || 0;
    state.says = {};
    if (state.mode === 'net') { net.remote = {}; net.objBuf = []; }
  }
  function enterGame() {
    show('game');
    buildPick();
    buildSay();
    $('meter').hidden = state.mode !== 'net';
    updateHead();
    resize();
    if (!state.running) {
      state.running = true;
      state.last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  function updateHead() {
    const w = state.world;
    const st = w ? E.STAGES[w.stage] : null;
    $('stageName').textContent = st ? (w.stage + 1) + '. ' + st.name : 'のりあいロード';
    $('hintText').textContent = st ? st.hint : '';
    $('hintText').hidden = !state.hintOpen;
    $('btnHint').setAttribute('aria-expanded', String(state.hintOpen));
    const you = $('youLine');
    if (state.mode === 'net') {
      you.hidden = false;
      you.textContent = 'あなたは' + state.seat + '番';
      you.style.background = SEAT_DARK[state.seat - 1];
    } else you.hidden = true;
    const last = w && w.stage === E.STAGES.length - 1;
    $('btnSkip').textContent = last ? 'はじめのステージにする' : '次のステージにする';
  }
  function buildPick() {
    const box = $('pickBox');
    box.hidden = state.mode !== 'one';
    if (state.mode !== 'one') return;
    seg($('pickSeg'), state.world.players.map((p) => ({ label: p.seat + '番', value: p.seat })), state.pick, (v) => { state.pick = v; buildPick(); });
  }
  function buildSay() {
    const box = $('sayBox');
    box.textContent = '';
    SAYS.forEach((t, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t;
      b.addEventListener('click', () => say(i));
      box.appendChild(b);
    });
  }
  function say(i) {
    const seat = state.mode === 'net' ? state.seat : state.pick;
    state.says[seat] = { text: SAYS[i], until: performance.now() + 2500 };
    if (state.mode === 'net') send({ k: 'say', s: seat, t: i });
  }

  /* ── 入力 ── */
  const GAME_CODES = new Set([...KEYSETS.flatMap((k) => Object.values(k)), ...Object.values(SOLO_KEYS).flat()]);
  document.addEventListener('keydown', (ev) => {
    if (!$('screen-game').classList.contains('active') || $('askBox').open) return;
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
    if (!GAME_CODES.has(ev.code)) return;
    ev.preventDefault();
    if (ev.repeat) return;
    state.keys.add(ev.code);
    latchFromCode(ev.code);
  });
  document.addEventListener('keyup', (ev) => { state.keys.delete(ev.code); });
  window.addEventListener('blur', () => { state.keys.clear(); for (const k of Object.keys(state.pad)) state.pad[k] = false; });

  function latchFromCode(code) {
    if (state.mode === 'net') {
      if (SOLO_KEYS.j.includes(code)) state.latch[0].j = true;
      if (SOLO_KEYS.a.includes(code)) state.latch[0].a = true;
      return;
    }
    KEYSETS.forEach((k, i) => {
      if (code === k.j) state.latch[i].j = true;
      if (code === k.a) state.latch[i].a = true;
    });
  }
  for (const b of document.querySelectorAll('.nr-pad')) {
    const key = b.dataset.key;
    const down = (ev) => { ev.preventDefault(); state.pad[key] = true; state.padLatch[key] = true; b.classList.add('is-down'); try { b.setPointerCapture(ev.pointerId); } catch { /* なくてもよい */ } };
    const up = () => { state.pad[key] = false; b.classList.remove('is-down'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
  const has = (codes) => codes.some((c) => state.keys.has(c));

  // 人ごとの入力。jumpPressed・actPressed は、押した瞬間を1こまだけ
  function readInputs() {
    const out = [];
    const n = state.world ? state.world.n : 0;
    for (let i = 0; i < 4; i++) {
      let l, r, j, ja, aa;
      if (state.mode === 'net') {
        if (i !== 0) { out.push({}); continue; }
        l = has(SOLO_KEYS.l); r = has(SOLO_KEYS.r); j = has(SOLO_KEYS.j);
        ja = !!state.latch[0].j; aa = !!state.latch[0].a;
      } else {
        const k = KEYSETS[i];
        l = state.keys.has(k.l); r = state.keys.has(k.r); j = state.keys.has(k.j);
        ja = !!state.latch[i].j; aa = !!state.latch[i].a;
      }
      const usePad = state.mode === 'net' ? i === 0 : i === state.pick - 1;
      if (usePad) {
        l = l || state.pad.l; r = r || state.pad.r; j = j || state.pad.j;
        ja = ja || !!state.padLatch.j; aa = aa || !!state.padLatch.a;
      }
      out.push({ l, r, jump: j, jumpPressed: ja, actPressed: aa });
      if (i >= n) out[i] = {};
    }
    state.latch = [{}, {}, {}, {}];
    state.padLatch = {};
    return out;
  }

  /* ── ウィンドウの間の同期 ── */
  const net = {
    bc: null, epoch: 0, remote: {}, objBuf: [], hostAt: 0,
    sent: 0, recv: 0, meterAt: 0, lastSend: 0, lastWorld: 0, lastWorldJson: '', lastStageAt: 0,
  };
  const INTERP_MS = () => 1000 / set.rate + 30;

  function openNet() {
    stopNet();
    if (typeof BroadcastChannel === 'undefined') return;
    net.bc = new BroadcastChannel(CHANNEL);
    net.bc.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      net.recv += ev.data.length;
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      onNet(m);
    };
    net.sent = 0; net.recv = 0; net.meterAt = performance.now();
    window.addEventListener('pagehide', sayBye);
  }
  function stopNet() {
    if (net.bc) { sayBye(); net.bc.close(); net.bc = null; }
    window.removeEventListener('pagehide', sayBye);
  }
  function sayBye() { if (net.bc) net.bc.postMessage(JSON.stringify({ k: 'bye', s: state.seat })); }
  function send(m) {
    if (!net.bc) return;
    const s = JSON.stringify(m);
    net.sent += s.length;
    const bc = net.bc;
    if (set.lag) setTimeout(() => { try { bc.postMessage(s); } catch { /* 閉じたあと */ } }, set.lag);
    else bc.postMessage(s);
  }
  const r2 = (v) => Math.round(v * 100) / 100;

  function sendStage() {
    const w = state.world;
    send({ k: 'stage', st: w.stage, n: w.n, ep: net.epoch });
  }
  function onNet(m) {
    const now = performance.now();
    if (state.seat === 1) {
      if (m.k === 'hello') sendStage();
      else if (m.k === 'req') hostRequest(m);
      else if (m.k === 'ev' && m.ep === net.epoch && m.a === 'throw') E.throwItem(state.world, m.s, m.f, m.x, m.y);
    } else if (m.k === 'stage') {
      net.hostAt = now;
      if (m.ep !== net.epoch || !state.world) {
        net.epoch = m.ep;
        newWorld(m.st, m.n);
        updateHead();
        buildPick();
      }
    } else if (m.k === 'w' && m.ep === net.epoch && state.world) {
      net.hostAt = now;
      applyWorld(m, now);
    }
    if (m.k === 'p' && m.ep === net.epoch && state.world && m.s !== state.seat) {
      const r = net.remote[m.s] || (net.remote[m.s] = { buf: [] });
      r.buf.push({ t: now, x: m.x, y: m.y, f: m.f, g: m.g, rx: m.rx, d: m.d, e: m.e });
      if (r.buf.length > 30) r.buf.shift();
    }
    if (m.k === 'say' && m.s !== state.seat) state.says[m.s] = { text: SAYS[m.t], until: now + 2500 };
    if (m.k === 'bye' && m.s !== state.seat) delete net.remote[m.s];
  }
  function hostRequest(m) {
    if (m.a === 'restart') restartHost(state.world.stage);
    else if (m.a === 'go') restartHost(m.st);
  }
  function restartHost(stage) {
    net.epoch = Date.now();
    newWorld(stage, state.world.n);
    updateHead();
    sendStage();
  }

  // 1番のウィンドウ: 箱・床・とびら・カギ・ボールを送る（変わったときと、1秒に1回）
  function hostSendWorld(now) {
    const w = state.world;
    const m = {
      k: 'w', ep: net.epoch,
      b: w.boxes.map((b) => [r2(b.x), r2(b.y)]),
      p: w.plats.map((p) => [r2(p.x), r2(p.y), p.riders]),
      i: w.items.map((it) => [r2(it.x), r2(it.y), it.holder, it.hooped ? 1 : 0, it.gone ? 1 : 0]),
      g: w.gates.map((g) => (g.open ? 1 : 0)).join(''),
      s: w.switches.map((s) => (s.on ? 1 : 0)).join(''),
      h: w.hoops.map((h) => (h.done ? 1 : 0)).join(''),
      d: w.door && w.door.locked ? 1 : 0,
      c: w.clear ? 1 : 0,
    };
    const body = JSON.stringify([m.b, m.p, m.i, m.g, m.s, m.h, m.d, m.c]);
    if (body === net.lastWorldJson && now - net.lastWorld < 1000) return;
    net.lastWorldJson = body;
    net.lastWorld = now;
    send(m);
  }
  function applyWorld(m, now) {
    const w = state.world;
    net.objBuf.push({ t: now, b: m.b, p: m.p, i: m.i });
    if (net.objBuf.length > 20) net.objBuf.shift();
    w.gates.forEach((g, k) => { g.open = m.g[k] === '1'; });
    w.switches.forEach((s, k) => { s.on = m.s[k] === '1'; });
    w.hoops.forEach((h, k) => { h.done = m.h[k] === '1'; });
    if (w.door) w.door.locked = m.d === 1;
    w.clear = m.c === 1;
    w.items.forEach((it, k) => { const v = m.i[k]; if (v) { it.holder = v[2]; it.hooped = v[3] === 1; it.gone = v[4] === 1; } });
    w.plats.forEach((p, k) => { const v = m.p[k]; if (v) p.riders = v[2]; });
  }
  function bracket(buf, rt) {
    if (!buf.length) return null;
    if (rt <= buf[0].t) return [buf[0], buf[0], 0];
    for (let k = buf.length - 1; k >= 0; k--) {
      if (buf[k].t <= rt) {
        const a = buf[k];
        const b = buf[k + 1] || a;
        const u = b.t > a.t ? Math.min(1, (rt - a.t) / (b.t - a.t)) : 0;
        return [a, b, u];
      }
    }
    return [buf[0], buf[0], 0];
  }
  const lerp = (a, b, u) => a + (b - a) * u;

  // ほかの人の描く位置（少し前の時刻に合わせて、なめらかにつなぐ）。乗っている人は下の人に乗せる
  function updateRemotes(now) {
    const w = state.world;
    const rt = now - INTERP_MS();
    const done = new Set([state.seat]);
    const todo = [];
    for (const p of w.players) {
      if (p.seat === state.seat) continue;
      const r = net.remote[p.seat];
      const bk = r ? bracket(r.buf, rt) : null;
      p.px = p.x; p.py = p.y;
      if (!bk) { p.away = true; p.entered = true; p.dx = 0; p.dy = 0; done.add(p.seat); continue; }
      p.away = false;
      const [a, b, u] = bk;
      p.face = b.f; p.ground = b.g || null; p.inDir = b.d; p.entered = !!b.e;
      p.hx = lerp(a.x, b.x, u); p.hy = lerp(a.y, b.y, u); p.hrx = b.rx || 0;
      todo.push(p);
    }
    for (let pass = 0; pass < 5 && todo.length; pass++) {
      for (let k = todo.length - 1; k >= 0; k--) {
        const p = todo[k];
        const g = p.ground;
        if (g && g[0] === 's') {
          const s = +g.slice(1);
          if (!done.has(s)) continue;
          const q = w.players[s - 1];
          if (q && !q.entered) { p.x = q.x + p.hrx; p.y = q.y - E.PH; }
          else { p.x = p.hx; p.y = p.hy; }
        } else { p.x = p.hx; p.y = p.hy; }
        done.add(p.seat);
        todo.splice(k, 1);
      }
    }
    for (const p of todo) { p.x = p.hx; p.y = p.hy; }
    for (const p of w.players) {
      if (p.seat === state.seat || p.away) continue;
      p.dx = p.x - p.px; p.dy = p.y - p.py;
    }
  }
  // 2番から先のウィンドウ: 箱・床・カギ・ボールを、少し前の時刻でつなぐ
  function updateObjects(now, dt) {
    const w = state.world;
    const bk = bracket(net.objBuf, now - INTERP_MS());
    if (bk) {
      const [a, b, u] = bk;
      w.boxes.forEach((o, k) => {
        const ox = o.x, oy = o.y;
        if (a.b[k] && b.b[k]) { o.x = lerp(a.b[k][0], b.b[k][0], u); o.y = lerp(a.b[k][1], b.b[k][1], u); }
        o.dx = o.x - ox; o.dy = o.y - oy;
      });
      w.plats.forEach((o, k) => {
        const ox = o.x, oy = o.y;
        if (a.p[k] && b.p[k]) { o.x = lerp(a.p[k][0], b.p[k][0], u); o.y = lerp(a.p[k][1], b.p[k][1], u); }
        o.dx = o.x - ox; o.dy = o.y - oy;
      });
      w.items.forEach((o, k) => {
        if (a.i[k] && b.i[k]) { o.x = lerp(a.i[k][0], b.i[k][0], u); o.y = lerp(a.i[k][1], b.i[k][1], u); }
      });
    }
    // 持っているものは、持っている人の描く位置に合わせる
    for (const it of w.items) {
      if (it.gone || !it.holder) continue;
      const q = w.players[it.holder - 1];
      if (q) { it.x = q.x + E.PW / 2 - E.ITEM / 2; it.y = q.y - E.ITEM - 0.02; }
    }
    for (const g of w.gates) { g.anim = Math.max(0, Math.min(1, g.anim + (g.open ? 1 : -1) * dt * 5)); }
  }

  /* ── 1こま ── */
  function frame(t) {
    if (!state.running) return;
    const elapsed = Math.min(0.1, (t - state.last) / 1000);
    state.last = t;
    state.acc += elapsed;
    let steps = 0;
    while (state.acc >= DT && steps < 6) {
      step(performance.now());
      state.acc -= DT;
      steps++;
    }
    if (steps >= 6) state.acc = 0;
    draw();
    updateMeter(performance.now());
    requestAnimationFrame(frame);
  }

  function step(now) {
    const w = state.world;
    if (!w) return;
    const inputs = readInputs();
    if (state.mode === 'one') {
      E.stepLocal(w, inputs, DT);
      return;
    }
    // ウィンドウごとに1人
    const me = w.players[state.seat - 1];
    if (!me) return;
    updateRemotes(now);
    if (state.seat === 1) E.stepObjects(w, DT, w.players);
    else updateObjects(now, DT);
    const l = E.camLeft(w, w.players);
    const ctx = {
      gates: w.gates, boxes: w.boxes, plats: w.plats, players: w.players,
      cam: l == null ? null : { l, r: l + E.VIEW }, door: w.door, holding: (s) => E.holdingOf(w, s),
    };
    const o = E.stepPlayer(w, me, inputs[0], DT, ctx);
    if (o.throw) {
      if (state.seat === 1) E.throwItem(w, me.seat, me.face, me.x, me.y);
      else send({ k: 'ev', ep: net.epoch, s: me.seat, a: 'throw', f: me.face, x: r2(me.x), y: r2(me.y) });
    }
    if (now - net.lastSend >= 1000 / set.rate) {
      net.lastSend = now;
      const m = { k: 'p', ep: net.epoch, s: me.seat, x: r2(me.x), y: r2(me.y), f: me.face, g: me.ground || 0, d: me.inDir, e: me.entered ? 1 : 0 };
      if (me.ground && me.ground[0] === 's') m.rx = r2(me.rx);
      send(m);
    }
    if (state.seat === 1 && now - net.lastWorld >= 1000 / set.rate) hostSendWorld(now);
    if (state.seat === 1 && now - net.lastStageAt > 2000) { net.lastStageAt = now; sendStage(); }
  }

  function updateMeter(now) {
    if (state.mode !== 'net' || now - net.meterAt < 1000) return;
    const sec = (now - net.meterAt) / 1000;
    const up = net.sent / sec / 1024;
    const down = net.recv / sec / 1024;
    net.sent = 0; net.recv = 0; net.meterAt = now;
    const tenMin = down * 600 / 1024;
    $('meterLine').textContent = '送る ' + up.toFixed(1) + ' KB/秒・受けとる ' + down.toFixed(1) + ' KB/秒（このウィンドウ）。10分あそぶと、受けとる量はおよそ ' + tenMin.toFixed(1) + ' MB。遅れ ' + (set.lag / 1000) + '秒・1秒に' + set.rate + '回。';
  }

  /* ── 描く ── */
  const canvas = $('canvas');
  const g = canvas.getContext('2d');
  let tile = 32;
  function resize() {
    const box = $('stageBox');
    const rect = box.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    tile = canvas.width / E.VIEW;
  }
  window.addEventListener('resize', resize);

  function draw() {
    const w = state.world;
    const W = canvas.width;
    const Hc = canvas.height;
    g.setTransform(1, 0, 0, 1, 0, 0);
    // 空
    const sky = g.createLinearGradient(0, 0, 0, Hc);
    sky.addColorStop(0, '#FBEFD9');
    sky.addColorStop(1, '#F3DDB8');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, Hc);
    overlayState();
    if (!w) return;

    const target = E.camLeft(w, w.players);
    if (target != null) state.camX += (target - state.camX) * 0.15;
    const cam = state.camX;
    tile = W / E.VIEW;
    const T = tile;
    // 遠くの丘
    g.fillStyle = '#EBD3AC';
    g.beginPath();
    g.moveTo(0, Hc);
    for (let x = 0; x <= W; x += 8) g.lineTo(x, Hc * 0.62 + Math.sin((x / T + cam * 0.4) * 0.35) * T * 0.8);
    g.lineTo(W, Hc);
    g.fill();

    g.save();
    g.translate(-cam * T, 0);
    const x0 = Math.max(0, Math.floor(cam) - 1);
    const x1 = Math.min(w.W - 1, Math.ceil(cam + E.VIEW) + 1);
    drawTiles(w, x0, x1, T);
    drawCheckpoints(w, T);
    drawSwitches(w, T);
    drawGates(w, T);
    drawDoor(w, T);
    drawHoops(w, T);
    drawPlats(w, T);
    drawBoxes(w, T);
    drawRopes(w, T);
    drawPlayers(w, T);
    drawItems(w, T);
    drawSays(w, T);
    g.restore();
  }

  function overlayState() {
    const w = state.world;
    const box = $('overBox');
    let text = '';
    let sub = '';
    let btns = false;
    if (state.mode === 'net' && state.seat !== 1) {
      if (!w || performance.now() - net.hostAt > 3500) { text = '1番のウィンドウを待っています'; sub = '1番のウィンドウで「はじめる」を押してね。'; }
      else if (state.seat > w.n) { text = 'この番号の席はありません'; sub = '1番のウィンドウの人数は' + w.n + '人。トップに戻って番号を選びなおしてね。'; }
    }
    if (!text && w && w.clear) {
      text = 'クリア！';
      sub = 'みんなでとびらに入れたね。';
      btns = true;
    }
    box.hidden = !text;
    if (text) {
      if ($('overText').textContent !== text) $('overText').textContent = text;
      if ($('overSub').textContent !== sub) $('overSub').textContent = sub;
      $('overBtns').hidden = !btns;
      $('btnNext').textContent = w && w.stage === E.STAGES.length - 1 ? 'はじめのステージへ' : '次のステージへ';
    }
  }

  function rr(x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  function shape(kind, cx, cy, s, color) {
    g.fillStyle = color;
    g.beginPath();
    if (kind === 'circle') g.arc(cx, cy, s, 0, Math.PI * 2);
    else if (kind === 'triangle') { g.moveTo(cx, cy - s); g.lineTo(cx + s, cy + s * 0.8); g.lineTo(cx - s, cy + s * 0.8); }
    else if (kind === 'square') g.rect(cx - s * 0.85, cy - s * 0.85, s * 1.7, s * 1.7);
    else if (kind === 'diamond') { g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); }
    else {
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + k * Math.PI / 5;
        const rad = k % 2 ? s * 0.45 : s;
        g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
      }
    }
    g.closePath();
    g.fill();
  }
  function label(text, cx, cy, size, color, weight) {
    g.fillStyle = color;
    g.font = (weight || 700) + ' ' + Math.round(size) + 'px "Noto Sans JP", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, cx, cy);
  }

  function drawTiles(w, x0, x1, T) {
    for (let x = x0; x <= x1; x++) {
      const col = w.cols[x];
      for (let y = 0; y < E.H; y++) {
        const c = col[y];
        if (c === '#') {
          g.fillStyle = '#9A7652';
          g.fillRect(x * T, y * T, T + 0.5, T + 0.5);
          const above = y > 0 ? col[y - 1] : '.';
          if (above !== '#') {
            g.fillStyle = '#7FAE5C';
            g.fillRect(x * T, y * T, T + 0.5, T * 0.22);
          } else {
            g.fillStyle = 'rgba(0,0,0,0.05)';
            g.fillRect(x * T + T * 0.2, y * T + T * 0.45, T * 0.18, T * 0.12);
          }
        } else if (c >= '1' && c <= '4') {
          const seat = E.mapSeat(+c, w.n);
          g.fillStyle = SEAT_COLORS[seat - 1] + '55';
          g.fillRect(x * T, y * T, T, T);
          g.strokeStyle = SEAT_COLORS[seat - 1];
          g.lineWidth = Math.max(2, T * 0.06);
          g.strokeRect(x * T + 1, y * T + 1, T - 2, T - 2);
          label(String(seat), x * T + T / 2, y * T + T / 2, T * 0.42, SEAT_DARK[seat - 1]);
        }
      }
    }
  }
  function drawCheckpoints(w, T) {
    w.checkpoints.forEach((cx, k) => {
      if (k === 0) return;
      const y = E.surfaceY(w, cx - E.PW / 2 + 0.3);
      const x = (cx - 0.3) * T;
      g.strokeStyle = '#8C7357';
      g.lineWidth = Math.max(1.5, T * 0.05);
      g.beginPath(); g.moveTo(x, y * T); g.lineTo(x, (y - 0.9) * T); g.stroke();
      g.fillStyle = '#E8B04A';
      g.beginPath(); g.moveTo(x, (y - 0.9) * T); g.lineTo(x + T * 0.4, (y - 0.75) * T); g.lineTo(x, (y - 0.6) * T); g.fill();
    });
  }
  function drawSwitches(w, T) {
    for (const s of w.switches) {
      const c = LINK_COLORS[s.letter];
      const h = s.on ? 0.08 : 0.2;
      g.fillStyle = '#6E5A45';
      g.fillRect((s.x + 0.08) * T, (s.y + 1 - 0.08) * T, T * 0.84, T * 0.08);
      g.fillStyle = c;
      rr((s.x + 0.15) * T, (s.y + 1 - 0.08 - h) * T, T * 0.7, h * T, T * 0.05);
      g.fill();
      shape(LINK_SHAPES[s.letter], (s.x + 0.5) * T, (s.y + 1 - 0.45) * T, T * 0.14, s.on ? c : c + 'AA');
    }
  }
  function drawGates(w, T) {
    for (const gt of w.gates) {
      const c = gt.seatN ? SEAT_COLORS[gt.seatN - 1] : LINK_COLORS[gt.letter];
      const full = (gt.y1 - gt.y0 + 1);
      const h = full * (1 - gt.anim);
      const x = gt.x * T;
      const y = gt.y0 * T;
      g.save();
      g.beginPath();
      g.rect(x, y, T, full * T);
      g.clip();
      if (h > 0.02) {
        g.fillStyle = c + (gt.seatN ? '66' : '33');
        g.fillRect(x, y, T, h * T);
        g.strokeStyle = c;
        g.lineWidth = Math.max(2, T * 0.08);
        for (let k = 0; k < 3; k++) {
          const bx = x + T * (0.2 + k * 0.3);
          g.beginPath(); g.moveTo(bx, y); g.lineTo(bx, y + h * T); g.stroke();
        }
        g.fillStyle = c;
        g.fillRect(x, y + h * T - T * 0.12, T, T * 0.12);
        shape(LINK_SHAPES[gt.letter], x + T / 2, y + h * T - T * 0.45, T * 0.2, '#FFFFFF');
        shape(LINK_SHAPES[gt.letter], x + T / 2, y + h * T - T * 0.45, T * 0.13, c);
        if (gt.seatN) {
          g.fillStyle = '#FFFFFF';
          g.beginPath(); g.arc(x + T / 2, y + h * T - T * 1.05, T * 0.26, 0, Math.PI * 2); g.fill();
          label(String(gt.seatN), x + T / 2, y + h * T - T * 1.05, T * 0.34, SEAT_DARK[gt.seatN - 1]);
        }
      }
      g.restore();
    }
  }
  function drawDoor(w, T) {
    const d = w.door;
    if (!d) return;
    const x = d.x * T, y = d.y * T, dw = d.w * T, dh = d.h * T;
    g.fillStyle = d.locked ? '#8A5A33' : '#3F2E22';
    rr(x, y, dw, dh, T * 0.4);
    g.fill();
    g.strokeStyle = '#5E3D22';
    g.lineWidth = Math.max(2, T * 0.08);
    g.stroke();
    if (d.locked) {
      g.fillStyle = '#E2B53E';
      g.beginPath(); g.arc(x + dw / 2, y + dh * 0.5, T * 0.16, 0, Math.PI * 2); g.fill();
      g.fillRect(x + dw / 2 - T * 0.06, y + dh * 0.5, T * 0.12, T * 0.28);
    } else {
      const inside = w.players.filter((p) => p.entered && !p.away).length;
      label(inside + '/' + w.n, x + dw / 2, y + dh * 0.45, T * 0.4, '#FBEFD9');
    }
    label('ゴール', x + dw / 2, y - T * 0.3, T * 0.32, '#5E3D22');
  }
  function drawHoops(w, T) {
    for (const h of w.hoops) {
      const x = h.x * T, y = h.y * T, hw = h.w * T;
      const ground = E.surfaceY(w, h.x + h.w / 2 - E.PW / 2);
      g.strokeStyle = '#8C7357';
      g.lineWidth = Math.max(2, T * 0.08);
      g.beginPath(); g.moveTo(x + hw / 2, y + h.h * T); g.lineTo(x + hw / 2, ground * T); g.stroke();
      // かご
      g.fillStyle = 'rgba(255,255,255,0.75)';
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x + hw, y); g.lineTo(x + hw * 0.82, y + h.h * T); g.lineTo(x + hw * 0.18, y + h.h * T);
      g.closePath(); g.fill();
      g.strokeStyle = LINK_COLORS[h.letter];
      g.lineWidth = Math.max(2, T * 0.07);
      g.stroke();
      g.strokeStyle = '#D9534F';
      g.lineWidth = Math.max(3, T * 0.1);
      g.beginPath(); g.moveTo(x - T * 0.05, y); g.lineTo(x + hw + T * 0.05, y); g.stroke();
      shape(LINK_SHAPES[h.letter], x + hw / 2, y + h.h * T * 0.55, T * 0.14, LINK_COLORS[h.letter]);
    }
  }
  function drawPlats(w, T) {
    for (const s of w.seesaws) {
      const L = w.plats[s.left], R = w.plats[s.right];
      const lx = (L.x + L.w / 2) * T, ly = (L.y + 0.3) * T;
      const rx = (R.x + R.w / 2) * T, ry = (R.y + 0.3) * T;
      g.strokeStyle = '#6E5A45';
      g.lineWidth = Math.max(3, T * 0.12);
      g.beginPath(); g.moveTo(lx, ly); g.lineTo(rx, ry); g.stroke();
      const cx = (lx + rx) / 2, cy = (ly + ry) / 2;
      g.fillStyle = '#6E5A45';
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + T * 0.5, cy + T * 1.6); g.lineTo(cx - T * 0.5, cy + T * 1.6); g.fill();
    }
    w.plats.forEach((p) => {
      const x = p.x * T, y = p.y * T, pw = p.w * T, ph = p.h * T;
      g.fillStyle = p.seesaw >= 0 ? '#C79A62' : '#B9834C';
      rr(x, y, pw, ph, T * 0.08);
      g.fill();
      g.strokeStyle = '#7A5530';
      g.lineWidth = Math.max(1.5, T * 0.05);
      g.stroke();
      if (p.seesaw < 0) {
        // 要る人数と、いま乗っている人数
        const tx = x + pw / 2, ty = y + ph + T * 0.32;
        g.fillStyle = 'rgba(255,255,255,0.9)';
        rr(tx - T * 0.55, ty - T * 0.22, T * 1.1, T * 0.44, T * 0.2);
        g.fill();
        label(p.riders + '/' + p.need + '人', tx, ty, T * 0.3, p.riders >= p.need ? '#1F6E3C' : '#5C5146');
      } else {
        label('重さ ' + p.riders, x + pw / 2, y + ph + T * 0.3, T * 0.26, '#5C5146', 500);
      }
    });
  }
  function drawBoxes(w, T) {
    for (const b of w.boxes) {
      const x = b.x * T, y = b.y * T, s = T;
      g.fillStyle = '#C8955A';
      rr(x + 1, y + 1, s - 2, s - 2, T * 0.08);
      g.fill();
      g.strokeStyle = '#80582F';
      g.lineWidth = Math.max(2, T * 0.07);
      g.stroke();
      g.beginPath(); g.moveTo(x + s * 0.15, y + s * 0.15); g.lineTo(x + s * 0.85, y + s * 0.85); g.stroke();
      g.fillStyle = '#FFF7EA';
      g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.3, 0, Math.PI * 2); g.fill();
      label(String(b.need), x + s / 2, y + s / 2, s * 0.42, '#5E3D22');
      if (state.mode === 'one' || state.seat === 1) {
        if (b.pushers && b.pushers < b.need) label(b.pushers + '/' + b.need, x + s / 2, y - T * 0.25, T * 0.28, '#5C5146');
      }
    }
  }
  function drawRopes(w, T) {
    if (!w.rope) return;
    g.strokeStyle = '#8C6A3F';
    g.lineWidth = Math.max(2, T * 0.06);
    for (let s = 1; s < w.n; s++) {
      const a = w.players[s - 1], b = w.players[s];
      if (a.entered || b.entered) continue;
      const ax = (a.x + E.PW / 2) * T, ay = (a.y + E.PH * 0.55) * T;
      const bx = (b.x + E.PW / 2) * T, by = (b.y + E.PH * 0.55) * T;
      const d = Math.hypot(bx - ax, by - ay) / T;
      const sag = Math.max(0, E.ROPE_LEN - d) * 0.35 * T;
      g.beginPath();
      g.moveTo(ax, ay);
      g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag, bx, by);
      g.stroke();
    }
  }
  function drawPlayers(w, T) {
    const now = performance.now();
    for (const p of w.players) {
      if (p.entered || p.away) continue;
      if (p.blink && Math.floor(now / 90) % 2 === 0) continue;
      const x = p.x * T, y = p.y * T, pw = E.PW * T, ph = E.PH * T;
      const k = p.seat - 1;
      g.fillStyle = 'rgba(0,0,0,0.12)';
      g.beginPath(); g.ellipse(x + pw / 2, y + ph, pw * 0.45, T * 0.06, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = SEAT_COLORS[k];
      rr(x, y, pw, ph, pw * 0.38);
      g.fill();
      g.strokeStyle = SEAT_DARK[k];
      g.lineWidth = Math.max(2, T * 0.06);
      g.stroke();
      // 目
      const ex = x + pw / 2 + p.face * pw * 0.14;
      const ey = y + ph * 0.36;
      for (const s of [-1, 1]) {
        g.fillStyle = '#FFFFFF';
        g.beginPath(); g.ellipse(ex + s * pw * 0.17, ey, pw * 0.12, ph * 0.13, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3F362D';
        g.beginPath(); g.arc(ex + s * pw * 0.17 + p.face * pw * 0.04, ey + ph * 0.02, pw * 0.06, 0, Math.PI * 2); g.fill();
      }
      // 番号
      g.fillStyle = 'rgba(255,255,255,0.92)';
      g.beginPath(); g.arc(x + pw / 2, y + ph * 0.7, pw * 0.22, 0, Math.PI * 2); g.fill();
      label(String(p.seat), x + pw / 2, y + ph * 0.71, pw * 0.34, SEAT_DARK[k]);
      // 自分の印（ウィンドウごとのとき）
      if (state.mode === 'net' && p.seat === state.seat) {
        g.fillStyle = SEAT_DARK[k];
        g.beginPath(); g.moveTo(x + pw / 2, y - T * 0.12); g.lineTo(x + pw / 2 - T * 0.14, y - T * 0.32); g.lineTo(x + pw / 2 + T * 0.14, y - T * 0.32); g.fill();
      }
    }
  }
  function drawItems(w, T) {
    for (const it of w.items) {
      if (it.gone) continue;
      if (it.holder) {
        const q = w.players[it.holder - 1];
        if (!q || q.entered || q.away) continue;
      }
      const x = it.x * T, y = it.y * T, s = E.ITEM * T;
      if (it.kind === 'ball') {
        g.fillStyle = '#F08A24';
        g.beginPath(); g.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#A6520E';
        g.lineWidth = Math.max(1.5, T * 0.05);
        g.stroke();
        g.beginPath(); g.moveTo(x, y + s / 2); g.quadraticCurveTo(x + s / 2, y + s * 0.2, x + s, y + s / 2); g.stroke();
      } else {
        g.fillStyle = '#E2B53E';
        g.strokeStyle = '#9C7417';
        g.lineWidth = Math.max(1.5, T * 0.05);
        g.beginPath(); g.arc(x + s * 0.3, y + s / 2, s * 0.25, 0, Math.PI * 2); g.fill(); g.stroke();
        g.fillRect(x + s * 0.5, y + s * 0.42, s * 0.48, s * 0.16);
        g.fillRect(x + s * 0.78, y + s * 0.5, s * 0.1, s * 0.22);
      }
    }
  }
  function drawSays(w, T) {
    const now = performance.now();
    for (const p of w.players) {
      const s = state.says[p.seat];
      if (!s || s.until < now || p.entered || p.away) continue;
      g.font = '700 ' + Math.round(T * 0.38) + 'px "Noto Sans JP", sans-serif';
      const tw = g.measureText(s.text).width + T * 0.5;
      const cx = (p.x + E.PW / 2) * T;
      const by = (p.y - 0.55) * T;
      g.fillStyle = '#FFFFFF';
      g.strokeStyle = SEAT_DARK[p.seat - 1];
      g.lineWidth = Math.max(2, T * 0.05);
      rr(cx - tw / 2, by - T * 0.6, tw, T * 0.6, T * 0.2);
      g.fill(); g.stroke();
      label(s.text, cx, by - T * 0.3, T * 0.38, '#3F362D');
    }
  }

  /* ── ボタン ── */
  function ask(text, yes, then) {
    $('askText').textContent = text;
    $('btnAskYes').textContent = yes;
    const box = $('askBox');
    const done = (ok) => { box.close(); $('btnAskYes').onclick = null; $('btnAskNo').onclick = null; if (ok) then(); };
    $('btnAskYes').onclick = () => done(true);
    $('btnAskNo').onclick = () => done(false);
    box.showModal();
  }
  function goStage(stage) {
    if (state.mode === 'one') { newWorld(stage, state.world.n); updateHead(); buildPick(); return; }
    if (state.seat === 1) restartHost(stage);
    else send({ k: 'req', a: 'go', st: stage });
  }
  const nextStage = () => (state.world ? (state.world.stage + 1) % E.STAGES.length : 0);
  $('btnRetry').addEventListener('click', () => ask('このステージをやりなおす？', 'やりなおす', () => goStage(state.world ? state.world.stage : set.stage)));
  $('btnSkip').addEventListener('click', () => ask('次のステージにする？', '次へ', () => goStage(nextStage())));
  $('btnNext').addEventListener('click', () => goStage(nextStage()));
  $('btnAgain').addEventListener('click', () => goStage(state.world.stage));
  $('btnTop').addEventListener('click', () => {
    state.running = false;
    stopNet();
    state.world = null;
    show('top');
    renderTop();
  });
  $('btnHint').addEventListener('click', () => { state.hintOpen = !state.hintOpen; updateHead(); requestAnimationFrame(resize); });
  $('btnOne').addEventListener('click', startOne);
  $('btnTwo').addEventListener('click', () => { $('whoBox').hidden = !$('whoBox').hidden; });
  $('btnTwoGo').addEventListener('click', startNet);

  renderTop();
  // テスト用（試作のみ）
  window.__noriai = { state, net };
})();
