/* そろってゴール（試作）
   ・1台の画面: このタブだけで2人が動かす（1人目 W・A・S・D、2人目 矢印キー）
   ・2つのウィンドウ: 同じパソコンの中の2つのウィンドウで、1人ずつ動かす（ルームのモック。通信しない）
     状態は localStorage に置き、もう一方のウィンドウは storage のイベントで読みなおす。
     本体にするときは、1歩ごとにルームへ transaction で書く形になる
   ルール（ステージ・動き）は engine.js、絵は art.js。音は鳴らさない。 */
(function () {
  'use strict';
  const E = window.SorotteEngine;
  const ART = window.SorotteArt;
  const STORE_KEY = 'sorotte_draft_room';
  const NAMES = ['1人目', '2人目'];
  const CONFETTI = ['#E0762B', '#2A93B4', '#F6CE4B', '#3FAE5A', '#8A5CC4', '#F28B9B'];
  const $ = (id) => document.getElementById(id);

  const state = {
    mode: null,   // 'one'（1台の画面）／'two'（2つのウィンドウ）
    me: -1,       // 2つのウィンドウのときの自分の番号
    S: null,
    prev: null,   // 直前に出した状態（どこが変わったかを見て、動きを付ける）
    drawn: -1,    // いま盤に出しているステージ
    pieces: {},
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

  function show(id) {
    document.querySelectorAll('.sg-screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
  }

  /* ── 状態の読み書き ── */
  function validState(S) {
    return !!S && Number.isInteger(S.stage) && S.stage >= 0 && S.stage < E.STAGES.length
      && Array.isArray(S.players) && S.players.length === E.PLAYERS && Array.isArray(S.boxes) && Array.isArray(S.keys) && Array.isArray(S.open);
  }
  function loadShared() {
    try {
      const S = JSON.parse(localStorage.getItem(STORE_KEY));
      return validState(S) ? S : null;
    } catch {
      return null;
    }
  }
  // 2つのウィンドウでは、動かす直前に共有の状態を読みなおしてから書く（もう一方の動きを取りこぼさない）
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
    state.drawn = -1;
    state.prev = null;
    state.S = mode === 'two' ? (loadShared() || E.createStage(0)) : E.createStage(0);
    if (mode === 'two' && !loadShared()) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state.S)); } catch { /* 何もしない */ }
    }
    buildPads();
    show('game');
    render();
  }

  /* ── 盤（動かない部分） ── */
  const place = (node, x, y) => { node.style.setProperty('--x', x); node.style.setProperty('--y', y); };
  const cellAt = (x, y) => $('board').querySelector('[data-pos="' + x + ',' + y + '"]');

  function makeCell(S, t, x, y) {
    const wall = (dx, dy) => E.tileAt(S.stage, x + dx, y + dy) === '#';
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
    } else if (t === 'a' || t === 'b') {
      cell.classList.add('sg-cell--sw', 'sg-cell--' + t);
      const sw = el('div', 'sg-sw');
      sw.append(el('div', 'sg-sw__base'), art('sg-sw__cap', ART.MARK[t]));
      cell.append(sw);
    } else if (t === 'A' || t === 'B' || t === 'L') {
      // 左右がゆかなら、戸は上下のかべの中へ開く。上下がゆかなら、左右へ開く
      cell.classList.add('sg-cell--door', 'sg-cell--' + t, wall(0, -1) && wall(0, 1) ? 'sg-door--h' : 'sg-door--v');
      cell.append(el('div', 'sg-door__p sg-door__p--1'), el('div', 'sg-door__p sg-door__p--2'),
        art('sg-door__mark', t === 'L' ? ART.LOCK : ART.MARK[E.SWITCH_OF[t]]));
    } else if (t === 'p' || t === 'q') {
      cell.classList.add('sg-cell--bridge', 'sg-cell--' + t);
      cell.append(el('div', 'sg-bridge__planks'), el('div', 'sg-bridge__num', String(E.BRIDGE_OF[t] + 1)));
    }
    return cell;
  }

  function drawStage(S) {
    const T = E.STATIC[S.stage];
    const board = $('board');
    board.style.setProperty('--w', T.w);
    board.style.setProperty('--h', T.h);
    board.replaceChildren();
    for (let y = 0; y < T.h; y += 1) {
      for (let x = 0; x < T.w; x += 1) board.append(makeCell(S, T.tiles[y * T.w + x], x, y));
    }
    state.pieces = {};
    state.prev = null;
    state.drawn = S.stage;
    $('stageName').textContent = 'ステージ' + (S.stage + 1) + '　' + E.STAGES[S.stage].name;
    replay($('stageName'), 'is-new');
    $('stageHint').textContent = E.STAGES[S.stage].hint;
    buildLegend(T);
    buildJump(S.stage);
  }

  /* ── 動くもの（人・箱・カギ）: 同じ要素の場所だけを変える（すべるように動く） ── */
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
  // きらきら（カギを取った・かぎを開けた）
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

  /* ── 描く ── */
  function render() {
    const S = state.S;
    if (!S) return;
    if (state.drawn !== S.stage) drawStage(S);
    const T = E.STATIC[S.stage];
    const P = state.prev;
    const board = $('board');
    const tile = (x, y) => T.tiles[y * T.w + x];
    const color = (t) => getComputedStyle(document.documentElement).getPropertyValue(t === 'a' ? '--sg-a' : '--sg-b').trim();

    // とびらの開け閉め
    board.querySelectorAll('.sg-cell--door').forEach((cell) => {
      const [x, y] = cell.dataset.pos.split(',').map(Number);
      cell.classList.toggle('is-open', E.doorOpen(S, x, y));
    });
    // スイッチ: 乗っているとへこむ。同じしるしのどれかが押されている間は光る
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
      const node = piece(id, () => makePiece('sg-piece--player sg-piece--p' + i, ART.CHARS[i]));
      const was = P && P.players[i];
      if (was && (was.x !== p.x || was.y !== p.y)) {
        const dx = Math.sign(p.x - was.x);
        const dy = Math.sign(p.y - was.y);
        aim(node, dirOf(dx, dy));
        replay(node, 'is-hop');
        fxDust(was.x, was.y, dx, dy);
      }
      node.classList.toggle('is-me', state.mode === 'two' && state.me === i);
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

    const you = $('youLine');
    you.hidden = state.mode !== 'two';
    if (state.mode === 'two') {
      you.className = 'sg-you sg-you--' + state.me;
      you.textContent = 'あなたは' + NAMES[state.me] + '（' + (state.me + 1) + 'のコマ）';
    }

    const last = S.stage === E.STAGES.length - 1;
    if (S.cleared && $('clearBox').hidden) fxConfetti();
    $('clearBox').hidden = !S.cleared;
    if (S.cleared) {
      $('clearText').textContent = last ? 'ぜんぶクリア！' : 'クリア！';
      $('btnNext').textContent = last ? 'はじめからあそぶ' : '次のステージへ';
    }
    state.prev = S;
  }

  function buildLegend(T) {
    const has = (ch) => T.tiles.includes(ch);
    const items = [['flag', '2人とも入るとクリア']];
    if (has('a') || has('b')) items.push(['radio_button_checked', 'スイッチ（乗っている間、同じしるしのとびらが開く）']);
    if (T.boxes.length) items.push(['package_2', '重い箱（うしろから押してもらうと動く）']);
    if (T.keys.length) items.push(['key', 'カギ'], ['lock', 'かぎつきのとびら']);
    if (has('p') || has('q')) items.push(['counter_1', '橋（同じ番号の人だけ渡れる）']);
    $('legend').replaceChildren(...items.map(([name, text]) => {
      const li = el('li');
      li.append(icon(name), document.createTextNode(text));
      return li;
    }));
  }

  // 試作用: ステージをえらんで始める
  function buildJump(cur) {
    $('jump').replaceChildren(...E.STAGES.map((st, i) => {
      const b = el('button', 'sg-quiet', 'ステージ' + (i + 1));
      b.type = 'button';
      if (i === cur) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => restart(i));
      return b;
    }));
  }
  function restart(stage) {
    state.drawn = -1; // 同じステージでも、盤を作りなおす（コマがはじめの場所に出なおす）
    commit(() => E.createStage(stage));
  }

  /* ── 動かす ── */
  function step(who, dir) {
    if (!state.S || state.S.cleared) return;
    const moved = commit((S) => E.move(S, who, dir));
    const S = state.S;
    const me = state.pieces['player' + who];
    if (!me) return;
    const [dx, dy] = E.DIRS[dir];
    const p = S.players[who];
    if (moved) {
      // 箱を押して進んだとき（箱が、自分の1つ先にある）
      if (S.boxes.some((b) => b[0] === p.x + dx && b[1] === p.y + dy) && state.pieces.box0) replay(me, 'is-push');
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

  function buildPads() {
    const who = state.mode === 'two' ? [state.me] : [0, 1];
    $('pads').replaceChildren(...who.map((i) => {
      const pad = el('div', 'sg-pad sg-pad--' + i);
      const keys = state.mode === 'two' ? '矢印キー・W A S D' : (i === 0 ? 'W A S D' : '矢印キー');
      pad.append(el('p', 'sg-pad__label', NAMES[i] + '（' + keys + '）'));
      [['up', 'arrow_upward', '上へ'], ['left', 'arrow_back', '左へ'], ['down', 'arrow_downward', '下へ'], ['right', 'arrow_forward', '右へ']].forEach(([dir, name, label]) => {
        const b = el('button', 'sg-pad__btn sg-pad__btn--' + dir);
        b.type = 'button';
        b.setAttribute('aria-label', NAMES[i] + 'を' + label);
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
    if (!state.mode || !$('screen-game').classList.contains('active')) return;
    if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const arrow = ARROWS[event.key];
    const wasd = WASD[event.code];
    if (!arrow && !wasd) return;
    event.preventDefault();
    if (state.mode === 'two') step(state.me, arrow || wasd);
    else step(arrow ? 1 : 0, arrow || wasd);
  });

  // もう一方のウィンドウが動かした
  window.addEventListener('storage', (event) => {
    if (event.key !== STORE_KEY || state.mode !== 'two') return;
    const S = loadShared();
    if (!S) return;
    // やりなおし・ステージ移動（歩数が0に戻った）は、盤を作りなおす
    if (state.S && S.rev === 0 && state.S.rev !== 0) state.drawn = -1;
    state.S = S;
    render();
  });

  // トップのイラスト
  $('duo').append(art('sg-duo__one', ART.CHARS[0]), art('sg-duo__one', ART.CHARS[1]));

  $('btnOne').addEventListener('click', () => start('one', -1));
  $('btnTwo1').addEventListener('click', () => start('two', 0));
  $('btnTwo2').addEventListener('click', () => start('two', 1));
  $('btnRetry').addEventListener('click', () => restart(state.S.stage));
  $('btnNext').addEventListener('click', () => { if (state.S.cleared) restart((state.S.stage + 1) % E.STAGES.length); });
  $('btnTop').addEventListener('click', () => { state.mode = null; state.S = null; state.prev = null; show('top'); });
})();
