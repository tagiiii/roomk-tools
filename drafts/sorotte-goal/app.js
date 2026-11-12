/* そろってゴール（試作）
   ・1台の画面: このタブだけで動かす。2人なら 1人目 W・A・S・D、2人目 矢印キー。
     3人以上は、動かすコマをえらんでから矢印キー（数字キー 1〜9 でもえらべる）
   ・ウィンドウごとに1人: 同じパソコンの中のウィンドウで、1人ずつ動かす（ルームのモック。通信しない）
     状態は localStorage に置き、ほかのウィンドウは storage のイベントで読みなおす。
     本体にするときは、1歩ごとにルームへ transaction で書く形になる
   ルール（ステージ・動き）は engine.js、絵は art.js。音は鳴らさない。 */
(function () {
  'use strict';
  const E = window.SorotteEngine;
  const ART = window.SorotteArt;
  const STORE_KEY = 'sorotte_draft_room';
  const SET_KEY = 'sorotte_draft_set';
  const CONFETTI = ['#E0762B', '#2A93B4', '#F6CE4B', '#3FAE5A', '#8A5CC4', '#F28B9B'];
  const MAX_STAGE = 9999;
  const MARK_NAME = { a: 'まる', b: 'さんかく', c: 'しかく', d: 'ほし', e: 'ひしがた' };
  const $ = (id) => document.getElementById(id);
  const nameOf = (i) => (i + 1) + '人目';

  const state = {
    mode: null,   // 'one'（1台の画面）／'two'（ウィンドウごとに1人）
    me: -1,       // ウィンドウごとに1人のときの自分の番号
    picked: 0,    // 1台の画面（3人以上）で、いま動かすコマ
    near: null,   // 近くを映すか（null は、マスが小さいときだけ近くを映す）
    S: null,
    prev: null,   // 直前に出した状態（どこが変わったかを見て、動きを付ける）
    drawn: '',    // いま盤に出しているステージ（E.specKey）
    pieces: {},
    set: { level: 'easy', n: 2, stage: 1 },  // トップの設定。level は 'practice'・'easy'・'normal'・'hard'
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  const icon = (name, className) => el('span', 'material-symbols-rounded' + (className ? ' ' + className : ''), name);
  // art.js の決まった絵を入れる（利用者の入力は入らない）
  function art(className, svg) {
    const node = el('div', className);
    node.innerHTML = svg;
    return node;
  }
  // 同じ動きを、もう一度はじめから
  function replay(node, className) {
    node.classList.remove(className);
    void node.offsetWidth;
    node.classList.add(className);
  }
  const tint = (node, i) => { node.style.setProperty('--c', ART.COLORS[i % ART.COLORS.length]); return node; };

  function show(id) {
    document.querySelectorAll('.sg-screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
  }

  /* ── 設定（トップ） ── */
  const LEVEL_LABEL = { practice: 'れんしゅう', easy: 'やさしい', normal: 'ふつう', hard: 'むずかしい' };
  function loadSet() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SET_KEY));
      if (s && LEVEL_LABEL[s.level] && Number.isInteger(s.n) && s.n >= E.MIN_PLAYERS && s.n <= E.MAX_PLAYERS && Number.isInteger(s.stage) && s.stage >= 1 && s.stage <= MAX_STAGE) state.set = s;
    } catch { /* はじめの設定のまま */ }
  }
  function saveSet() {
    try { sessionStorage.setItem(SET_KEY, JSON.stringify(state.set)); } catch { /* 何もしない */ }
  }
  // 設定から、ステージを指す spec を作る
  function specOf(set) {
    if (set.level === 'practice') return { kind: 'fixed', index: (set.stage - 1) % E.FIXED.length };
    return { kind: 'gen', level: set.level, n: set.n, seed: set.stage };
  }
  const playersOf = (set) => (set.level === 'practice' ? 2 : set.n);

  function seg(box, options, value, onPick) {
    box.replaceChildren(...options.map(([v, label, disabled]) => {
      const b = el('button', 'sg-seg__btn' + (v === value ? ' is-on' : ''), label);
      b.type = 'button';
      b.disabled = !!disabled;
      b.setAttribute('aria-pressed', v === value ? 'true' : 'false');
      b.addEventListener('click', () => onPick(v));
      return b;
    }));
  }

  function renderTop() {
    const set = state.set;
    const practice = set.level === 'practice';
    seg($('levelSeg'), Object.keys(LEVEL_LABEL).map((k) => [k, LEVEL_LABEL[k]]), set.level, (v) => {
      set.level = v;
      if (v === 'practice') set.stage = Math.min(set.stage, E.FIXED.length);
      saveSet(); renderTop();
    });
    const counts = [];
    for (let i = E.MIN_PLAYERS; i <= E.MAX_PLAYERS; i += 1) counts.push([i, String(i), practice && i !== 2]);
    seg($('countSeg'), counts, playersOf(set), (v) => { set.n = v; saveSet(); renderTop(); });
    $('stageNum').textContent = String(set.stage);
    $('btnStageRandom').hidden = practice;
    const n = playersOf(set);
    $('oneNote').textContent = n === 2
      ? '1つのキーボードを2人で使う。1人目は W・A・S・D、2人目は矢印キー。'
      : '動かすコマをえらんでから、矢印キーで動かす（数字キーでもえらべる）。1人で全員ぶんを動かして確かめるのにも使える。';
    const who = [];
    for (let i = 0; i < n; i += 1) who.push([i, String(i + 1)]);
    seg($('whoSeg'), who, -1, (v) => start('two', v));
    // かざりのキャラクター（人数ぶん。多いときは6人まで）
    $('duo').replaceChildren(...Array.from({ length: Math.min(n, 6) }, (_, i) => tint(art('sg-duo__one', ART.char(i)), i)));
  }
  function stepStage(d) {
    const max = state.set.level === 'practice' ? E.FIXED.length : MAX_STAGE;
    state.set.stage = ((state.set.stage - 1 + d + max) % max) + 1;
    saveSet();
    renderTop();
  }

  /* ── 状態の読み書き ── */
  function validState(S) {
    return !!S && E.validSpec(S.spec) && Array.isArray(S.players) && S.players.length === E.staticOf(S.spec).starts.length
      && Array.isArray(S.boxes) && Array.isArray(S.keys) && Array.isArray(S.stars) && Array.isArray(S.open);
  }
  function loadShared() {
    try {
      const S = JSON.parse(localStorage.getItem(STORE_KEY));
      return validState(S) ? S : null;
    } catch {
      return null;
    }
  }
  // ウィンドウごとに1人のときは、動かす直前に共有の状態を読みなおしてから書く（ほかの人の動きを取りこぼさない）
  // 返り値: 状態が変わったか
  function commit(change) {
    const base = state.mode === 'two' ? (loadShared() || state.S) : state.S;
    const next = change(base);
    state.S = next;
    if (next !== base && state.mode === 'two') {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* 保存できないときは、このウィンドウだけで進む */ }
    }
    render();
    return next !== base;
  }

  function start(mode, me) {
    state.mode = mode;
    state.me = me;
    state.picked = 0;
    state.drawn = '';
    state.prev = null;
    const fresh = () => E.create(specOf(state.set));
    if (mode === 'two') {
      // ほかのウィンドウが先に始めていて、自分の番号の席があれば、そのステージに入る
      const shared = loadShared();
      state.S = shared && me < shared.players.length ? shared : fresh();
      if (state.S !== shared) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(state.S)); } catch { /* 何もしない */ }
      }
    } else {
      state.S = fresh();
    }
    show('game');
    render();
  }

  // いまのステージの設定から、番号だけ変えた spec
  function specWithStage(spec, d) {
    if (spec.kind === 'fixed') return { kind: 'fixed', index: (spec.index + d + E.FIXED.length) % E.FIXED.length };
    return { kind: 'gen', level: spec.level, n: spec.n, seed: ((spec.seed - 1 + d + MAX_STAGE) % MAX_STAGE) + 1 };
  }
  function restart(spec) {
    state.drawn = ''; // 同じステージでも、盤を作りなおす（コマがはじめの場所に出なおす）
    commit(() => E.create(spec));
  }

  /* ── 盤（動かない部分） ── */
  const place = (node, x, y) => { node.style.setProperty('--x', x); node.style.setProperty('--y', y); };
  const cellAt = (x, y) => $('board').querySelector('[data-pos="' + x + ',' + y + '"]');

  function makeCell(S, T, t, x, y) {
    const wall = (dx, dy) => E.tileAt(S, x + dx, y + dy) === '#';
    const cell = el('div', 'sg-cell');
    cell.dataset.pos = x + ',' + y;
    place(cell, x, y);
    if (t === '#') {
      cell.classList.add('sg-cell--wall');
      if (!wall(0, 1)) cell.classList.add('has-face');
      return cell;
    }
    if ((x + y) % 2) cell.classList.add('is-alt');
    if (wall(0, -1)) cell.classList.add('is-shaded');
    if (t === 'G') {
      cell.classList.add('sg-cell--goal');
      cell.append(el('div', 'sg-goal__pad'));
      cell.insertAdjacentHTML('beforeend', ART.FLAG);
    } else if (E.SWITCHES.includes(t)) {
      cell.classList.add('sg-cell--sw', 'sg-cell--' + t);
      if (T.need[t] > 1) cell.classList.add('is-pair');
      const sw = el('div', 'sg-sw');
      sw.append(el('div', 'sg-sw__base'), art('sg-sw__cap', ART.MARK[t]));
      cell.append(sw);
    } else if (E.SWITCH_OF[t] || t === 'L') {
      // 左右がゆかなら、戸は上下のかべの中へ開く。上下がゆかなら、左右へ開く
      cell.classList.add('sg-cell--door', 'sg-cell--' + t, wall(0, -1) && wall(0, 1) ? 'sg-door--h' : 'sg-door--v');
      if (T.need[E.SWITCH_OF[t]] > 1) cell.classList.add('is-pair');
      cell.append(el('div', 'sg-door__p sg-door__p--1'), el('div', 'sg-door__p sg-door__p--2'),
        art('sg-door__mark', t === 'L' ? ART.LOCK : ART.MARK[E.SWITCH_OF[t]]));
    } else if (E.BRIDGE_OF[t] !== undefined) {
      cell.classList.add('sg-cell--bridge');
      tint(cell, E.BRIDGE_OF[t]);
      cell.append(el('div', 'sg-bridge__planks'), el('div', 'sg-bridge__num', String(E.BRIDGE_OF[t] + 1)));
    }
    return cell;
  }

  function drawStage(S) {
    const T = E.staticOf(S.spec);
    const board = $('board');
    // 盤の大きさは、わくの側で決める（はば・画面の高さ・マスの上限のうち、いちばん小さいもの）
    const host = $('boardHost');
    host.style.setProperty('--w', T.w);
    host.style.setProperty('--h', T.h);
    host.style.setProperty('--bw', (T.w * 64) + 'px');
    state.near = null;
    board.replaceChildren();
    for (let y = 0; y < T.h; y += 1) {
      for (let x = 0; x < T.w; x += 1) board.append(makeCell(S, T, T.tiles[y * T.w + x], x, y));
    }
    state.pieces = {};
    state.prev = null;
    state.drawn = E.specKey(S.spec);
    const spec = S.spec;
    $('stageName').textContent = spec.kind === 'fixed'
      ? 'れんしゅう' + (spec.index + 1) + '　' + T.name
      : T.name + '・' + spec.n + '人　ステージ ' + spec.seed;
    replay($('stageName'), 'is-new');
    $('stageHint').textContent = T.hint || '全員がゴールに入るとクリア。星は、とってもとらなくてもいい。';
    buildLegend(T);
    buildPads();
  }

  /* ── 動くもの（人・箱・カギ・星）: 同じ要素の場所だけを変える（すべるように動く） ── */
  function piece(id, make) {
    let node = state.pieces[id];
    if (!node) {
      node = make();
      node.classList.add('is-new');
      state.pieces[id] = node;
      $('board').append(node);
    }
    return node;
  }
  function makePiece(className, svg, extra) {
    const node = el('div', 'sg-piece ' + className);
    const inner = art('sg-piece__in', svg);
    if (extra) inner.append(extra);
    node.append(el('div', 'sg-shadow'), inner);
    return node;
  }
  const dirOf = (dx, dy) => (dx > 0 ? 'right' : dx < 0 ? 'left' : dy < 0 ? 'up' : 'down');
  function aim(node, dir) {
    const [dx, dy] = E.DIRS[dir];
    node.dataset.dir = dir;
    node.style.setProperty('--bx', dx);
    node.style.setProperty('--by', dy);
    node.style.setProperty('--sx', Math.abs(dx));
    node.style.setProperty('--sy', Math.abs(dy));
  }

  /* ── 演出 ── */
  function fx(x, y, build) {
    const node = el('div', 'sg-fx');
    place(node, x, y);
    build(node);
    $('board').append(node);
    setTimeout(() => node.remove(), 800);
  }
  // 足もとの土けむり
  function fxDust(x, y, dx, dy) {
    fx(x, y, (node) => {
      [[-90, -40], [0, -70], [90, -40]].forEach(([sx, sy]) => {
        const d = el('span', 'sg-fx__dot');
        d.style.setProperty('--dx', sx - dx * 120);
        d.style.setProperty('--dy', sy - dy * 80);
        node.append(d);
      });
    });
  }
  // きらきら（カギ・星を取った・かぎを開けた）
  function fxSpark(x, y, color) {
    fx(x, y, (node) => {
      for (let i = 0; i < 8; i += 1) {
        const a = (Math.PI * 2 * i) / 8;
        const r = art('sg-fx__ray', ART.STAR);
        r.style.setProperty('--c', color);
        r.style.setProperty('--dx', Math.cos(a) * 320);
        r.style.setProperty('--dy', Math.sin(a) * 320);
        node.append(r);
      }
    });
  }
  // スイッチを押したときの輪
  function fxRing(x, y, color) {
    fx(x, y, (node) => {
      const r = el('span', 'sg-fx__ring');
      r.style.setProperty('--c', color);
      node.append(r);
    });
  }
  function fxConfetti() {
    const board = $('board');
    const h = board.clientHeight;
    const w = board.clientWidth;
    for (let i = 0; i < 44; i += 1) {
      const c = el('span', 'sg-confetti');
      c.style.left = (Math.random() * 100) + '%';
      c.style.background = CONFETTI[i % CONFETTI.length];
      c.style.setProperty('--fall', (h * (0.9 + Math.random() * 0.3)) + 'px');
      c.style.setProperty('--sx', ((Math.random() - 0.5) * w * 0.25) + 'px');
      c.style.setProperty('--rot', (360 + Math.random() * 720) + 'deg');
      c.style.setProperty('--t', (1.2 + Math.random() * 0.9) + 's');
      c.style.setProperty('--d', (Math.random() * 0.5) + 's');
      board.append(c);
      setTimeout(() => c.remove(), 2800);
    }
  }

  function starRow(got, total) {
    const row = el('span', 'sg-hud__stars');
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', '星 ' + got + ' / ' + total);
    for (let i = 0; i < total; i += 1) row.append(art('sg-hud__star' + (i < got ? ' is-got' : ''), ART.GEM));
    return row;
  }

  /* ── 描く ── */
  function render() {
    const S = state.S;
    if (!S) return;
    if (state.drawn !== E.specKey(S.spec)) drawStage(S);
    const T = E.staticOf(S.spec);
    const P = state.prev;
    const board = $('board');
    const tile = (x, y) => T.tiles[y * T.w + x];
    const color = (t) => getComputedStyle(document.documentElement).getPropertyValue('--sg-' + t).trim();

    // とびらの開け閉め
    board.querySelectorAll('.sg-cell--door').forEach((cell) => {
      const [x, y] = cell.dataset.pos.split(',').map(Number);
      cell.classList.toggle('is-open', E.doorOpen(S, x, y));
    });
    // スイッチ: 乗っているとへこむ。とびらが開くだけおさえられている間は光る
    board.querySelectorAll('.sg-cell--sw').forEach((cell) => {
      const [x, y] = cell.dataset.pos.split(',').map(Number);
      const down = S.players.some((p) => p.x === x && p.y === y) || S.boxes.some((b) => b[0] === x && b[1] === y);
      if (down && !cell.classList.contains('is-down') && P) fxRing(x, y, color(tile(x, y)));
      cell.classList.toggle('is-down', down);
      cell.classList.toggle('is-on', E.held(S, tile(x, y)));
    });
    // ゴール: 人が入ると光る
    board.querySelectorAll('.sg-cell--goal').forEach((cell) => {
      const [x, y] = cell.dataset.pos.split(',').map(Number);
      cell.classList.toggle('is-in', S.players.some((p) => p.x === x && p.y === y));
    });

    const live = new Set();
    S.keys.forEach(([x, y]) => {
      const id = 'key' + x + '_' + y;
      live.add(id);
      place(piece(id, () => makePiece('sg-piece--key', ART.KEY, art('sg-twinkle', ART.STAR))), x, y);
    });
    S.stars.forEach(([x, y]) => {
      const id = 'star' + x + '_' + y;
      live.add(id);
      place(piece(id, () => makePiece('sg-piece--star', ART.GEM, art('sg-twinkle', ART.STAR))), x, y);
    });
    // とった星のあとに、きらきら
    if (P) P.stars.forEach(([x, y]) => { if (!S.stars.some((s) => s[0] === x && s[1] === y)) fxSpark(x, y, '#FFD23F'); });
    S.boxes.forEach(([x, y], i) => {
      const id = 'box' + i;
      live.add(id);
      const node = piece(id, () => makePiece('sg-piece--box', ART.BOX));
      const was = P && P.boxes[i];
      if (was && (was[0] !== x || was[1] !== y)) replay(node, 'is-slide');
      place(node, x, y);
    });
    S.players.forEach((p, i) => {
      const id = 'player' + i;
      live.add(id);
      const node = piece(id, () => {
        const n = tint(makePiece('sg-piece--player', ART.char(i)), i);
        // 番号の札と、自分の印
        const pin = el('div', 'sg-pin');
        pin.append(el('span', 'sg-pin__label', state.mode === 'two' && state.me === i ? 'あなた' : ''));
        n.append(el('span', 'sg-tag', String(i + 1)), pin);
        return n;
      });
      const was = P && P.players[i];
      if (was && (was.x !== p.x || was.y !== p.y)) {
        const dx = Math.sign(p.x - was.x);
        const dy = Math.sign(p.y - was.y);
        aim(node, dirOf(dx, dy));
        replay(node, 'is-hop');
        fxDust(was.x, was.y, dx, dy);
      }
      node.classList.toggle('is-me', state.mode === 'two' && state.me === i);
      node.classList.toggle('is-picked', state.mode === 'one' && S.players.length > 2 && state.picked === i);
      node.classList.toggle('is-cheer', S.cleared);
      // 持っているカギ
      const inner = node.querySelector('.sg-piece__in');
      const carry = inner.querySelector('.sg-carry');
      if (p.key && !carry) inner.append(art('sg-carry', ART.KEY));
      if (!p.key && carry) carry.remove();
      if (was && p.key && !was.key) fxSpark(p.x, p.y, '#F6CE4B');
      if (was && !p.key && was.key) fxSpark(p.x, p.y, '#FFFFFF');
      place(node, p.x, p.y);
    });
    Object.keys(state.pieces).forEach((id) => {
      if (!live.has(id)) { state.pieces[id].remove(); delete state.pieces[id]; }
    });

    // 星と歩数
    $('hud').replaceChildren(starRow(S.got, T.stars.length), el('span', '', S.rev + '歩'));
    $('hud').hidden = !T.stars.length && false;

    const you = $('youLine');
    you.hidden = state.mode !== 'two';
    if (state.mode === 'two') {
      tint(you, state.me);
      you.textContent = 'あなたは' + nameOf(state.me) + '（' + (state.me + 1) + 'のコマ）';
    }
    $('pick').querySelectorAll('.sg-pick__btn').forEach((b, i) => {
      b.classList.toggle('is-on', i === state.picked);
      b.setAttribute('aria-pressed', i === state.picked ? 'true' : 'false');
    });

    if (S.cleared && $('clearBox').hidden) fxConfetti();
    $('clearBox').hidden = !S.cleared;
    if (S.cleared) {
      $('clearText').textContent = 'クリア！';
      $('clearSub').replaceChildren(starRow(S.got, T.stars.length), el('span', '', S.rev + '歩'));
    }
    state.prev = S;
    camera();
  }

  /* ── 近くを映す ──
     マスが小さいとき（人数が多い・画面がせまい）は、盤を大きくして、動かすコマのまわりを映す。
     動かすコマ: ウィンドウごとに1人なら自分、1台の画面の3人以上ならえらんだコマ。 */
  const NEAR_CELL = 54;   // 近くを映すときの、1マスの目安（px）
  const SMALL_CELL = 40;  // これより小さいと、はじめから近くを映す
  function focusIndex() {
    const S = state.S;
    if (!S) return -1;
    if (state.mode === 'two') return state.me;
    return S.players.length > 2 ? state.picked : -1;
  }
  function camera() {
    const S = state.S;
    const host = $('boardHost');
    const board = $('board');
    const btn = $('btnView');
    if (!S) return;
    const T = E.staticOf(S.spec);
    const W = host.clientWidth;
    const H = host.clientHeight;
    const cell = W / T.w;
    const who = focusIndex();
    const can = who >= 0 && cell > 0 && cell < NEAR_CELL - 4;
    const near = can && (state.near == null ? cell < SMALL_CELL : state.near);
    btn.hidden = !can;
    if (can) {
      btn.replaceChildren(icon(near ? 'zoom_out_map' : 'zoom_in'), document.createTextNode(near ? '全体を見る' : '近くを見る'));
    }
    if (!near) { board.style.transform = ''; return; }
    const scale = Math.min(5, NEAR_CELL / cell);
    const p = S.players[who];
    const clamp = (v, lo) => Math.max(lo, Math.min(0, v));
    const tx = clamp(W / 2 - (p.x + 0.5) * cell * scale, W - W * scale);
    const ty = clamp(H / 2 - (p.y + 0.5) * cell * scale, H - H * scale);
    board.style.transform = 'translate(' + tx.toFixed(1) + 'px, ' + ty.toFixed(1) + 'px) scale(' + scale.toFixed(3) + ')';
  }

  function buildLegend(T) {
    const has = (ch) => T.tiles.includes(ch);
    const items = [['flag', '全員が入るとクリア']];
    if (E.SWITCHES.some(has)) items.push(['radio_button_checked', 'スイッチ（乗っている間、同じしるしのとびらが開く）']);
    if (Object.keys(T.need).length) items.push(['looks_two', '「2」の付いたスイッチは、2つ同時におさえる']);
    if (T.boxes.length) items.push(['package_2', '重い箱（うしろから押してもらうと動く）']);
    if (T.keys.length) items.push(['key', 'カギ'], ['lock', 'かぎつきのとびら']);
    if (E.BRIDGES.some(has)) items.push(['counter_1', '橋（同じ番号の人だけ渡れる）']);
    if (T.stars.length) items.push(['star', '星（とった数がクリアのときに出る）']);
    $('legend').replaceChildren(...items.map(([name, text]) => {
      const li = el('li');
      li.append(icon(name), document.createTextNode(text));
      return li;
    }));
  }

  /* ── 動かす ── */
  function step(who, dir) {
    if (!state.S || state.S.cleared || who < 0 || who >= state.S.players.length) return;
    const moved = commit((S) => E.move(S, who, dir));
    const S = state.S;
    const me = state.pieces['player' + who];
    if (!me) return;
    const [dx, dy] = E.DIRS[dir];
    const p = S.players[who];
    if (moved) {
      // 箱を押して進んだとき（箱が、自分の1つ先にある）
      if (S.boxes.some((b) => b[0] === p.x + dx && b[1] === p.y + dy)) replay(me, 'is-push');
      return;
    }
    // 進めなかった: その向きへ体を当てる。重い箱はぐらつき、閉じたとびらはがたつく
    aim(me, dir);
    replay(me, 'is-bump');
    const tx = p.x + dx;
    const ty = p.y + dy;
    const bi = S.boxes.findIndex((b) => b[0] === tx && b[1] === ty);
    if (bi >= 0 && state.pieces['box' + bi]) replay(state.pieces['box' + bi], 'is-heavy');
    const cell = cellAt(tx, ty);
    if (cell && cell.classList.contains('sg-cell--door') && !cell.classList.contains('is-open')) replay(cell, 'is-rattle');
  }

  function pickPlayer(i) {
    if (!state.S || i < 0 || i >= state.S.players.length) return;
    state.picked = i;
    buildPads();
    render();
  }

  // 画面のボタン。1台の画面の2人は2つ、3人以上はえらんだコマの1つ。ウィンドウごとに1人は自分の1つ
  function buildPads() {
    const S = state.S;
    if (!S) return;
    const n = S.players.length;
    const select = state.mode === 'one' && n > 2;
    const who = state.mode === 'two' ? [state.me] : select ? [state.picked] : [0, 1];
    const pick = $('pick');
    pick.hidden = !select;
    if (select) {
      pick.replaceChildren(...S.players.map((_, i) => {
        const b = tint(art('sg-pick__btn', ART.char(i)), i);
        b.setAttribute('role', 'button');
        b.tabIndex = 0;
        b.setAttribute('aria-label', nameOf(i) + 'を動かす');
        b.addEventListener('click', () => pickPlayer(i));
        b.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickPlayer(i); } });
        return b;
      }));
    }
    $('pads').replaceChildren(...who.map((i) => {
      const pad = tint(el('div', 'sg-pad'), i);
      const keys = state.mode === 'one' && !select ? (i === 0 ? 'W A S D' : '矢印キー') : '矢印キー・W A S D';
      pad.append(el('p', 'sg-pad__label', nameOf(i) + '（' + keys + '）'));
      [['up', 'arrow_upward', '上へ'], ['left', 'arrow_back', '左へ'], ['down', 'arrow_downward', '下へ'], ['right', 'arrow_forward', '右へ']].forEach(([dir, name, label]) => {
        const b = el('button', 'sg-pad__btn sg-pad__btn--' + dir);
        b.type = 'button';
        b.setAttribute('aria-label', nameOf(i) + 'を' + label);
        b.append(icon(name));
        b.addEventListener('click', () => step(i, dir));
        pad.append(b);
      });
      return pad;
    }));
  }

  const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
  const WASD = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
  document.addEventListener('keydown', (event) => {
    if (!state.mode || !state.S || !$('screen-game').classList.contains('active')) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey || $('askBox').open) return;
    const n = state.S.players.length;
    const select = state.mode === 'one' && n > 2;
    // 数字キーで、動かすコマをえらぶ（1〜9。0 は10人目）
    if (select && /^[0-9]$/.test(event.key)) {
      event.preventDefault();
      pickPlayer(event.key === '0' ? 9 : Number(event.key) - 1);
      return;
    }
    const arrow = ARROWS[event.key];
    const wasd = WASD[event.code];
    if (!arrow && !wasd) return;
    event.preventDefault();
    if (state.mode === 'two') step(state.me, arrow || wasd);
    else if (select) step(state.picked, arrow || wasd);
    else step(arrow ? 1 : 0, arrow || wasd);
  });

  // ほかのウィンドウが動かした
  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_KEY || state.mode !== 'two') return;
    const S = loadShared();
    if (!S) return;
    // やりなおし（歩数が0に戻った）は、盤を作りなおす。ステージがかわったときは render が作りなおす
    if (state.S && S.rev === 0 && state.S.rev !== 0) state.drawn = '';
    state.S = S;
    render();
  });

  loadSet();
  renderTop();

  $('btnStagePrev').addEventListener('click', () => stepStage(-1));
  $('btnStageNext').addEventListener('click', () => stepStage(1));
  $('btnStageRandom').addEventListener('click', () => { state.set.stage = 1 + Math.floor(Math.random() * MAX_STAGE); saveSet(); renderTop(); });
  $('btnOne').addEventListener('click', () => start('one', -1));
  $('btnTwo').addEventListener('click', () => { $('whoBox').hidden = !$('whoBox').hidden; });
  // みんなの進みが消える操作は、1歩でも進んでいたら、たしかめてから
  let askThen = null;
  function ask(text, yes, then) {
    if (!state.S || state.S.rev === 0 || state.S.cleared) { then(); return; }
    $('askText').textContent = text;
    $('btnAskYes').textContent = yes;
    askThen = then;
    $('askBox').showModal();
    $('btnAskNo').focus();
  }
  $('btnAskNo').addEventListener('click', () => { askThen = null; $('askBox').close(); });
  $('btnAskYes').addEventListener('click', () => { const then = askThen; askThen = null; $('askBox').close(); if (then) then(); });
  $('askBox').addEventListener('close', () => { askThen = null; });
  $('btnRetry').addEventListener('click', () => ask('このステージを、はじめからやりなおす？', 'やりなおす', () => restart(state.S.spec)));
  $('btnView').addEventListener('click', () => { state.near = !/scale/.test($('board').style.transform); camera(); });
  window.addEventListener('resize', camera);
  $('btnAgain').addEventListener('click', () => restart(state.S.spec));
  $('btnNext').addEventListener('click', () => { if (state.S.cleared) restart(specWithStage(state.S.spec, 1)); });
  $('btnSkip').addEventListener('click', () => ask('ほかのステージにする？', 'ほかのステージにする', () => restart(specWithStage(state.S.spec, 1))));
  $('btnTop').addEventListener('click', () => {
    // 次に始めるときは、いま遊んでいたステージの番号から
    const spec = state.S && state.S.spec;
    if (spec) state.set.stage = spec.kind === 'fixed' ? spec.index + 1 : spec.seed;
    saveSet();
    state.mode = null; state.S = null; state.prev = null;
    renderTop();
    show('top');
  });
})();
