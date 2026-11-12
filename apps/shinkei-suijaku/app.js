/* 神経衰弱
   1台の画面で遊ぶ（通信しない）。CPU と対戦／人どうし（2〜4人）。
   確かめる用: ?fast=1 でめくったあとの待ち時間を短くする */
(function () {
  'use strict';

  const D = window.SS_DATA;
  const FAST = new URLSearchParams(location.search).has('fast');
  const T = {
    back: FAST ? 250 : 1600,   // ちがったカードを見せておく時間
    got: FAST ? 150 : 800,     // そろったカードを見せておく時間
    cpu: FAST ? 120 : 900      // CPU が1枚めくる前の間
  };
  const SVG_NS = document.getElementById('ss-svg-ns').namespaceURI;   // SVG の名前空間（index.html の空の svg から取る）
  const sp = window.matchMedia('(max-width: 600px)');

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const shuffle = (arr) => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  /* ── 設定 ── */
  const setup = { opp: 'cpu', cpu: 'normal', count: 2, level: 'easy', names: ['', '', '', ''] };
  const OPPS = [{ id: 'cpu', label: 'CPU' }, { id: 'human', label: '人どうし' }];
  const COUNTS = [{ id: 2, label: '2人' }, { id: 3, label: '3人' }, { id: 4, label: '4人' }];

  function buildSeg(box, items, get, set) {
    box.textContent = '';
    items.forEach((it) => {
      const b = el('button', '', it.label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(get() === it.id));
      b.addEventListener('click', () => { set(it.id); renderSetup(); });
      box.appendChild(b);
    });
  }

  function keepNames() {
    document.querySelectorAll('#name-list input').forEach((inp) => {
      setup.names[Number(inp.dataset.i)] = inp.value;
    });
  }

  function renderSetup() {
    keepNames();
    buildSeg($('opp-opts'), OPPS, () => setup.opp, (v) => { setup.opp = v; });
    buildSeg($('cpu-opts'), D.cpuLevels, () => setup.cpu, (v) => { setup.cpu = v; });
    buildSeg($('count-opts'), COUNTS, () => setup.count, (v) => { setup.count = v; });
    buildSeg($('level-opts'), D.levels, () => setup.level, (v) => { setup.level = v; });
    $('cpu-field').hidden = setup.opp !== 'cpu';
    $('count-field').hidden = setup.opp !== 'human';
    $('level-note').textContent = D.levels.find((l) => l.id === setup.level).note;

    const list = $('name-list');
    list.textContent = '';
    const n = setup.opp === 'cpu' ? 1 : setup.count;
    for (let i = 0; i < n; i++) {
      const row = el('div', 'ss-names__row');
      const lab = el('label', '', setup.opp === 'cpu' ? 'あなた' : (i + 1) + '人目');
      lab.htmlFor = 'name-' + i;
      const inp = el('input', 'form-input');
      inp.id = 'name-' + i;
      inp.type = 'text';
      inp.maxLength = 10;
      inp.autocomplete = 'off';
      inp.dataset.i = String(i);
      inp.value = setup.names[i];
      inp.placeholder = setup.opp === 'cpu' ? 'あなた' : (i + 1) + '人目';
      row.append(lab, inp);
      list.appendChild(row);
    }
    if (setup.opp === 'cpu') {
      const row = el('div', 'ss-names__row');
      row.append(el('span', '', '相手'), el('span', 'ss-names__fixed', 'CPU'));
      list.appendChild(row);
    }
  }

  /* ── ゲーム ── */
  let game = null;
  let timers = [];
  const later = (fn, ms) => {
    const g = game;
    timers.push(setTimeout(() => { if (game === g) fn(); }, ms));
  };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  function makeDeck(level) {
    const pairs = level.cards / 2;
    let faces;
    if (level.kind === 'shape') {
      faces = [];
      D.shapes.forEach((s) => D.shapeCounts.forEach((n) => {
        faces.push({ key: s.id + n, kind: 'shape', shape: s, n: n, label: s.label + 'が' + n + 'つ' });
      }));
      faces = shuffle(faces).slice(0, pairs);
    } else {
      faces = shuffle(D.icons).slice(0, pairs).map((ic) => ({ key: ic.icon, kind: 'icon', icon: ic, label: ic.label }));
    }
    return shuffle(faces.concat(faces)).map((f) => ({ face: f, up: false, got: false }));
  }

  function startGame(first) {
    clearTimers();
    keepNames();
    const level = D.levels.find((l) => l.id === setup.level);
    let players;
    if (setup.opp === 'cpu') {
      players = [
        { name: setup.names[0].trim() || 'あなた', cpu: false, pairs: 0 },
        { name: 'CPU', cpu: true, pairs: 0 }
      ];
    } else {
      players = [];
      for (let i = 0; i < setup.count; i++) {
        players.push({ name: setup.names[i].trim() || (i + 1) + '人目', cpu: false, pairs: 0 });
      }
    }
    game = {
      level: level,
      cpu: D.cpuLevels.find((c) => c.id === setup.cpu),
      cards: makeDeck(level),
      players: players,
      first: first % players.length,
      turn: first % players.length,
      open: [],
      lock: false,
      memory: new Map(),   // CPU が覚えているカード（位置 → 絵）
      over: false,
      msg: ''
    };
    $('ss-front').hidden = true;
    $('ss-app').hidden = false;
    $('bar-level').textContent = level.label + '・' + level.cards + '枚';
    buildBoard();
    setTurnMsg();
    render();
    window.scrollTo(0, 0);
    // 利用回数（人数は CPU をのぞいた、遊ぶ人の数）
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + players.filter((p) => !p.cpu).length);
    if (cur().cpu) cpuTurn();
  }

  const cur = () => game.players[game.turn];

  function drawShape(svg, shape, cx, cy, scale) {
    let node;
    if (shape === 'circle') {
      node = document.createElementNS(SVG_NS, 'circle');
      node.setAttribute('r', '17');
    } else if (shape === 'square') {
      node = document.createElementNS(SVG_NS, 'rect');
      node.setAttribute('x', '-15'); node.setAttribute('y', '-15');
      node.setAttribute('width', '30'); node.setAttribute('height', '30'); node.setAttribute('rx', '3');
    } else if (shape === 'triangle') {
      node = document.createElementNS(SVG_NS, 'polygon');
      node.setAttribute('points', '0,-17 18,14 -18,14');
    } else if (shape === 'star') {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 19 : 8.5;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push((r * Math.cos(a)).toFixed(2) + ',' + (r * Math.sin(a)).toFixed(2));
      }
      node = document.createElementNS(SVG_NS, 'polygon');
      node.setAttribute('points', pts.join(' '));
    } else {
      node = document.createElementNS(SVG_NS, 'path');
      node.setAttribute('d', 'M0,16 C-24,0 -17,-19 0,-7 C17,-19 24,0 0,16 Z');
    }
    node.setAttribute('transform', 'translate(' + cx + ' ' + cy + ') scale(' + scale + ')');
    svg.appendChild(node);
  }

  const SHAPE_POS = {
    1: [[50, 50, 1.5]],
    2: [[28, 50, 1], [72, 50, 1]],
    3: [[50, 28, 1], [27, 72, 1], [73, 72, 1]],
    4: [[28, 28, 1], [72, 28, 1], [28, 72, 1], [72, 72, 1]]
  };

  function faceNode(face) {
    if (face.kind === 'icon') {
      const s = el('span', 'material-symbols-rounded', face.icon.icon);
      s.style.color = face.icon.color;
      return s;
    }
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('fill', face.shape.color);
    SHAPE_POS[face.n].forEach((p) => drawShape(svg, face.shape.id, p[0], p[1], p[2]));
    return svg;
  }

  function applyCols() {
    if (!game) return;
    const cols = sp.matches ? game.level.colsSp : game.level.cols;
    const wrap = $('board-wrap');
    wrap.style.setProperty('--cols', cols);
    wrap.style.setProperty('--rows', Math.ceil(game.level.cards / cols));
    wrap.style.setProperty('--maxw', game.level.maxw + 'px');
  }

  function buildBoard() {
    const board = $('board');
    board.textContent = '';
    applyCols();
    game.cards.forEach((c, i) => {
      const b = el('button', 'ss-card');
      b.type = 'button';
      b.dataset.i = String(i);
      const inner = el('span', 'ss-card__inner');
      inner.setAttribute('aria-hidden', 'true');
      const back = el('span', 'ss-card__back', String(i + 1));
      const front = el('span', 'ss-card__front');
      front.append(el('span', 'ss-card__front-num', String(i + 1)), faceNode(c.face));
      inner.append(back, front);
      b.appendChild(inner);
      board.appendChild(b);
    });
  }

  function render() {
    const ul = $('players');
    ul.textContent = '';
    game.players.forEach((p, i) => {
      const turn = !game.over && i === game.turn;
      const li = el('li', 'ss-player' + (turn ? ' is-turn' : ''));
      li.appendChild(el('span', 'ss-player__name', p.name));
      if (turn) li.appendChild(el('span', 'ss-player__turn', '番'));
      const n = el('span', 'ss-player__pairs', String(p.pairs));
      n.appendChild(el('span', 'ss-player__unit', 'ペア'));
      li.appendChild(n);
      ul.appendChild(li);
    });
    $('status').textContent = game.msg;
    $('status').hidden = game.over;
    $('board').classList.toggle('is-locked', game.lock || game.over || cur().cpu);
    document.querySelectorAll('#board .ss-card').forEach((b) => {
      const i = Number(b.dataset.i);
      const c = game.cards[i];
      b.classList.toggle('is-up', c.up || c.got);
      b.classList.toggle('is-got', c.got);
      const num = (i + 1) + '番のカード。';
      b.setAttribute('aria-label', c.got ? num + c.face.label + '（取ったカード）' : c.up ? num + c.face.label : num + 'うら');
      if (c.got) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    });
    $('result').hidden = !game.over;
  }

  function setTurnMsg() {
    const p = cur();
    game.msg = p.cpu ? 'CPU の番。考え中…' : p.name + 'の番。カードを2枚めくってね';
  }

  /* 1枚めくる（人も CPU もここを通る） */
  function flip(i) {
    const c = game.cards[i];
    if (game.over || game.lock || c.up || c.got) return;
    c.up = true;
    game.open.push(i);
    observe(i);

    if (game.open.length < 2) {
      if (!cur().cpu) game.msg = cur().name + 'の番。もう1枚めくってね';
      render();
      return;
    }

    const a = game.open[0];
    const b = game.open[1];
    game.lock = true;
    if (game.cards[a].face.key === game.cards[b].face.key) {
      game.msg = 'そろった！ ' + (cur().cpu ? 'CPU' : cur().name) + 'がもらうよ';
      render();
      later(() => {
        game.cards[a].got = true;
        game.cards[b].got = true;
        game.memory.delete(a);
        game.memory.delete(b);
        cur().pairs += 1;
        game.open = [];
        game.lock = false;
        if (game.cards.every((x) => x.got)) { finish(); return; }
        game.msg = cur().cpu ? 'CPU がもう1回めくるよ' : cur().name + 'がもう1回。2枚めくってね';
        render();
        if (cur().cpu) cpuTurn();
      }, T.got);
    } else {
      game.msg = 'ちがったね';
      render();
      later(() => {
        game.cards[a].up = false;
        game.cards[b].up = false;
        game.open = [];
        game.lock = false;
        game.turn = (game.turn + 1) % game.players.length;
        setTurnMsg();
        render();
        if (cur().cpu) cpuTurn();
      }, T.back);
    }
  }

  function finish() {
    game.over = true;
    window.RoomkStats?.count('finish');
    const max = Math.max.apply(null, game.players.map((p) => p.pairs));
    const tops = game.players.filter((p) => p.pairs === max);
    $('result-head').textContent = 'ぜんぶそろった！';
    $('result-body').textContent = tops.length === game.players.length
      ? 'みんな ' + max + 'ペア。引き分け'
      : tops.map((p) => p.name).join('・') + 'が ' + max + 'ペアで、いちばん多く取ったよ';
    render();
  }

  /* ── CPU ── */
  /* めくられたカードを、強さごとの割合で覚える */
  function observe(i) {
    if (!game.players.some((p) => p.cpu)) return;
    if (Math.random() < game.cpu.remember) game.memory.set(i, game.cards[i].face.key);
  }

  const hidden = () => game.cards.map((c, i) => i).filter((i) => !game.cards[i].up && !game.cards[i].got);

  function knownPair() {
    const seen = new Map();
    for (const [i, key] of game.memory) {
      if (game.cards[i].up || game.cards[i].got) continue;
      if (seen.has(key)) return [seen.get(key), i];
      seen.set(key, i);
    }
    return null;
  }

  function cpuTurn() {
    later(() => {
      const pair = Math.random() < game.cpu.usePair ? knownPair() : null;
      if (pair) {
        flip(pair[0]);
        later(() => flip(pair[1]), T.cpu);
        return;
      }
      // 知らないカードを1枚めくる。知っている相手がいれば取り、いなければもう1枚めくる
      const rest = hidden();
      const unknown = rest.filter((i) => !game.memory.has(i));
      const first = pick(unknown.length ? unknown : rest);
      const key = game.cards[first].face.key;
      flip(first);
      later(() => {
        let second = null;
        for (const [i, k] of game.memory) {
          if (i !== first && k === key && !game.cards[i].up && !game.cards[i].got) { second = i; break; }
        }
        if (second == null) {
          const rest2 = hidden();
          const unknown2 = rest2.filter((i) => !game.memory.has(i));
          second = pick(unknown2.length ? unknown2 : rest2);
        }
        flip(second);
      }, T.cpu);
    }, T.cpu);
  }

  /* ── 操作 ── */
  function toSetup() {
    clearTimers();
    game = null;
    $('ss-app').hidden = true;
    $('ss-front').hidden = false;
    renderSetup();
    window.scrollTo(0, 0);
  }

  $('board').addEventListener('click', (e) => {
    const b = e.target.closest('.ss-card');
    if (!b || !game || cur().cpu) return;
    flip(Number(b.dataset.i));
  });
  $('btn-start').addEventListener('click', () => startGame(0));
  $('btn-again').addEventListener('click', () => {
    window.RoomkStats?.count('again');
    startGame(game.first + 1);   // はじめの人を順に交代
  });
  $('btn-back').addEventListener('click', toSetup);
  $('btn-quit').addEventListener('click', () => {
    if (game && !game.over && game.players.some((p) => p.pairs > 0 || game.open.length)) {
      if (!window.confirm('この対戦をやめて、設定にもどる？')) return;
    }
    toSetup();
  });
  sp.addEventListener('change', applyCols);

  renderSetup();
})();
