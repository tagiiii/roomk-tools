/* 将棋（試作）
   ・1台の画面: このタブだけで2人が交互に指す（メンターが操作する・向かい合って1台で指す）
   ・2つのウィンドウ: 同じパソコンの中の2つのウィンドウで、1人ずつ指す（ルームのモック。通信しない）
     状態は localStorage に置き、もう一方のウィンドウは storage のイベントで読みなおす。
     「先手になる」で開いたウィンドウがホストのかわり（盤を選ぶ・1手もどす・補助・もう一回）。
     本体にするときは、1手ごとにルームへ transaction で書く形になる（リバーシと同じ）
   ルールは engine.js。音は鳴らさない。 */
(function () {
  'use strict';
  const E = window.ShogiEngine;
  const SHARED_KEY = 'shogi_draft_room';
  const LOCAL_KEY = 'shogi_draft_local';
  const SIDE = ['先手', '後手'];
  const MARK = ['▲', '△'];
  const $ = (id) => document.getElementById(id);

  const DEFAULT_AID = { who: 'both', spots: true, arrows: false, danger: false };

  const state = {
    mode: null,     // 'one'（1台の画面）／'two'（2つのウィンドウ）
    me: 0,          // 2つのウィンドウのときのウィンドウの番号（0 はホストのかわり）
    S: null,        // { cfg: { v, names: [先手, 後手], aid, swap }, moves: [], rev }
    G: null,        // いまの局面（engine の局面）
    sel: null,      // { from } か { drop }
    flip: false,    // 1台の画面で盤の向きを変えた
    pendingPromo: null,
    hideResult: false,
    aidOpen: false,
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  const icon = (name) => el('span', 'material-symbols-rounded', name);
  function show(id) {
    document.querySelectorAll('.sh-screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
    window.scrollTo(0, 0);
  }

  /* ── 状態の読み書き ── */
  function validShared(S) {
    return !!S && S.cfg && E.VARIANTS[S.cfg.v] && Array.isArray(S.cfg.names) && Array.isArray(S.moves) && Number.isInteger(S.rev);
  }
  function readStore(store, key) {
    try {
      const S = JSON.parse(store.getItem(key));
      return validShared(S) ? S : null;
    } catch {
      return null;
    }
  }
  function writeStore(store, key, S) {
    try { store.setItem(key, JSON.stringify(S)); } catch { /* 保存できないときは、このウィンドウだけで進む */ }
  }
  const loadShared = () => readStore(localStorage, SHARED_KEY);

  // 局面を記録から作りなおす（読めない手があれば、そこまでで止める）
  function rebuild(S) {
    let G = E.create(S.cfg.v);
    const ok = [];
    for (const m of S.moves) {
      if (!E.legalMoves(G).some((mm) => E.sameMove(mm, m))) break;
      G = E.apply(G, m);
      ok.push(m);
    }
    S.moves = ok;
    return G;
  }
  function adopt(S) {
    const prev = state.S;
    state.S = S;
    const samePrefix = (k) => prev.moves.slice(0, k).every((m, i) => E.sameMove(m, S.moves[i]));
    // 手が同じなら、局面はそのまま（補助・名前だけ変わった）
    if (prev && state.G && prev.cfg.v === S.cfg.v && S.moves.length === prev.moves.length && samePrefix(S.moves.length)) return;
    // 1手増えただけなら、その1手だけ進める
    if (prev && state.G && prev.cfg.v === S.cfg.v && S.moves.length === prev.moves.length + 1
      && prev.moves.every((m, i) => E.sameMove(m, S.moves[i]))) {
      state.G = E.apply(state.G, S.moves[S.moves.length - 1]);
    } else {
      state.G = rebuild(S);
    }
  }
  // 書きかえる。2つのウィンドウでは、書く直前に共有の状態を読みなおす
  function commit(change) {
    const base = state.mode === 'two' ? (loadShared() || state.S) : state.S;
    if (state.mode === 'two' && base !== state.S) adopt(base);
    const next = change(JSON.parse(JSON.stringify(state.S)));
    if (!next) { render(); return false; }
    next.rev = state.S.rev + 1;
    adopt(next);
    if (state.mode === 'two') writeStore(localStorage, SHARED_KEY, state.S);
    else writeStore(sessionStorage, LOCAL_KEY, state.S);
    render();
    return true;
  }

  /* ── 立場 ── */
  const swap = () => (state.S && state.S.cfg.swap ? 1 : 0);
  const mySide = () => (state.mode === 'two' ? state.me ^ swap() : -1);
  const isHost = () => state.mode === 'one' || state.me === 0;
  const bottomSide = () => (state.mode === 'two' ? mySide() : (state.flip ? 1 : 0));
  function sideLabel(s) {
    const name = state.S.cfg.names[s];
    return MARK[s] + SIDE[s] + (name ? '（' + name + '）' : '');
  }
  function canAct() {
    const G = state.G;
    if (!G || G.over) return false;
    return state.mode === 'one' || G.turn === mySide();
  }
  function aidFor(side) {
    const w = state.S.cfg.aid.who;
    return w === 'both' || w === String(side);
  }

  /* ── 補助の設定 ── */
  function buildAid(box, aid, editable, onChange) {
    box.replaceChildren();
    const title = el('p', 'sh-legend', '補助（はじめての人向け）');
    box.append(title);
    const seg = el('div', 'sh-seg');
    [['both', 'ふたりとも'], ['0', '先手だけ'], ['1', '後手だけ'], ['none', '使わない']].forEach(([v, label]) => {
      const opt = el('label', 'sh-seg__opt');
      const input = el('input');
      input.type = 'radio';
      input.name = 'aidWho-' + box.id;
      input.value = v;
      input.checked = aid.who === v;
      input.disabled = !editable;
      input.addEventListener('change', () => onChange({ who: v }));
      opt.append(input, el('span', null, label));
      seg.append(opt);
    });
    box.append(el('p', 'sh-sub', '補助を使う人（その人の番のときだけ出る）'), seg);
    const checks = el('div', 'sh-checks' + (aid.who === 'none' ? ' is-off' : ''));
    [
      ['spots', '動ける所を見せる', '駒を選ぶと、動ける所・打てる所に点が出る'],
      ['arrows', '駒に動ける向きを出す', '駒のふちに、動ける向きの印が出る（線は、どこまでも進める向き）'],
      ['danger', '取られそうな駒を知らせる', '相手の駒が利いている自分の駒に、印が出る'],
    ].forEach(([key, label, sub]) => {
      const row = el('label', 'sh-check');
      const input = el('input');
      input.type = 'checkbox';
      input.checked = !!aid[key];
      input.disabled = !editable || aid.who === 'none';
      input.addEventListener('change', () => onChange({ [key]: input.checked }));
      const text = el('span', 'sh-check__text');
      text.append(el('span', 'sh-check__label', label), el('span', 'sh-check__sub', sub));
      row.append(input, text);
      checks.append(row);
    });
    box.append(checks);
    if (!editable) box.append(el('p', 'sh-sub', '補助は先手のウィンドウで変えられる。'));
  }

  /* ── 準備 ── */
  let setupAid = Object.assign({}, DEFAULT_AID);
  function openSetup() {
    const S = state.S;
    if (S) {
      document.querySelectorAll('input[name="variant"]').forEach((r) => { r.checked = r.value === S.cfg.v; });
      $('name0').value = S.cfg.names[0] || '';
      $('name1').value = S.cfg.names[1] || '';
      setupAid = Object.assign({}, S.cfg.aid);
    }
    const draw = () => buildAid($('aidSetup'), setupAid, true, (patch) => { Object.assign(setupAid, patch); draw(); });
    draw();
    show('setup');
  }
  function startGame() {
    const v = (document.querySelector('input[name="variant"]:checked') || {}).value || 'mini';
    const names = [$('name0').value.trim().slice(0, 10), $('name1').value.trim().slice(0, 10)];
    const S = { cfg: { v, names, aid: Object.assign({}, setupAid), swap: false }, moves: [], rev: (state.S ? state.S.rev : 0) + 1 };
    state.S = null;
    adopt(S);
    if (state.mode === 'two') writeStore(localStorage, SHARED_KEY, state.S);
    else writeStore(sessionStorage, LOCAL_KEY, state.S);
    enterGame();
  }
  function enterGame() {
    state.sel = null;
    state.hideResult = false;
    state.aidOpen = false;
    $('msg').textContent = '';
    show('game');
    render();
  }

  /* ── 駒の絵 ── */
  // 駒の形（五角形）と字。up: 盤を見ている人から見て上向き（自分の駒）
  function pieceNode(c, up, opts) {
    const o = opts || {};
    const node = el('span', 'sh-piece' + (up ? '' : ' is-down') + (E.isProm(c) ? ' is-prom' : ''));
    const name = E.pieceName(c);
    const face = el('span', 'sh-piece__face' + (name.length > 1 ? ' is-two' : ''), name);
    node.append(face);
    if (o.arrows) node.append(arrowsNode(c));
    return node;
  }
  // 動ける向きの印（駒の向きのまま描く。後手の駒は駒ごと回る）
  function arrowsNode(c) {
    const box = el('span', 'sh-arrows');
    box.setAttribute('aria-hidden', 'true');
    const sp = E.SPEC[E.kindOf(c)];
    const put = (node, x, y) => { node.style.left = x + '%'; node.style.top = y + '%'; };
    sp.steps.forEach(([dr, dc]) => {
      const dot = el('span', 'sh-arrows__dot');
      if (Math.abs(dr) === 2) {   // 桂: 上の角の外へ跳ぶ
        dot.classList.add('is-jump');
        put(dot, 50 + dc * 36, 2);
      } else {
        put(dot, 50 + dc * 44, 50 + dr * 44);
      }
      box.append(dot);
    });
    sp.slides.forEach(([dr, dc]) => {
      const bar = el('span', 'sh-arrows__bar');
      put(bar, 50 + dc * 42, 50 + dr * 42);
      bar.style.transform = 'translate(-50%, -50%) rotate(' + (Math.atan2(dr, dc) * 180 / Math.PI + 90) + 'deg)';
      box.append(bar);
    });
    return box;
  }

  /* ── 描画 ── */
  function targetsForSel() {
    if (!state.sel || !canAct()) return [];
    const ms = E.legalMoves(state.G);
    return ms.filter((m) => (state.sel.drop ? m.drop === state.sel.drop : m.from === state.sel.from));
  }

  function render() {
    if (!state.S || !state.G) return;
    const G = state.G;
    const n = G.n;
    const vb = bottomSide();
    const turn = G.turn;
    const aidOn = aidFor(turn) && canAct();
    const aid = state.S.cfg.aid;

    // 番・結果
    const status = $('status');
    status.replaceChildren();
    status.className = 'sh-status';
    if (G.over) {
      status.classList.add('is-over');
      status.textContent = overText(G);
    } else {
      let line;
      if (state.mode === 'two' && turn === mySide()) line = 'あなたの番（' + MARK[turn] + SIDE[turn] + '）';
      else if (state.mode === 'two') line = sideLabel(turn) + 'が考え中';
      else line = sideLabel(turn) + 'の番';
      status.append(el('span', null, line));
      if (G.check) status.append(el('span', 'sh-check-badge', '王手'));
    }

    // 盤
    const board = $('board');
    board.style.setProperty('--n', n);
    board.classList.toggle('is-mini', n === 5);
    board.replaceChildren();
    const targets = targetsForSel();
    const targetSet = new Set(targets.map((m) => m.to));
    const showSpots = aidOn && aid.spots;
    const threatened = aidOn && aid.danger ? new Set(E.threatened(G, turn)) : new Set();
    const checkKing = G.check ? E.kingSquare(G.board, turn) : -1;
    const flip = vb === 1;
    // 筋の数字（上）
    for (let vc = 0; vc < n; vc += 1) {
      const c = flip ? n - 1 - vc : vc;
      board.append(el('span', 'sh-coord sh-coord--file', String(n - c)));
    }
    board.append(el('span', 'sh-coord'));
    for (let vr = 0; vr < n; vr += 1) {
      const r = flip ? n - 1 - vr : vr;
      for (let vc = 0; vc < n; vc += 1) {
        const c = flip ? n - 1 - vc : vc;
        const i = r * n + c;
        const cell = el('button', 'sh-cell');
        cell.type = 'button';
        cell.dataset.i = String(i);
        if (vc === 0) cell.classList.add('is-edge-l');
        if (vr === 0) cell.classList.add('is-edge-t');
        const p = G.board[i];
        let label = E.squareName(n, i);
        if (G.last && G.last.to === i) cell.classList.add('is-last');
        if (G.last && G.last.from === i) cell.classList.add('is-lastfrom');
        if (state.sel && state.sel.from === i) cell.classList.add('is-sel');
        if (i === checkKing) cell.classList.add('is-check');
        if (threatened.has(i)) cell.classList.add('is-danger');
        if (p) {
          const owner = E.ownerOf(p);
          const arrows = aid.arrows && aidFor(owner) && aid.who !== 'none';
          cell.append(pieceNode(p, owner === vb, { arrows }));
          label += ' ' + MARK[owner] + E.pieceName(p);
        }
        if (targetSet.has(i)) {
          cell.classList.add('is-target');
          if (showSpots) cell.append(el('span', 'sh-spot' + (p ? ' sh-spot--take' : '')));
        }
        cell.setAttribute('aria-label', label);
        board.append(cell);
      }
      board.append(el('span', 'sh-coord sh-coord--rank', E.KANJI_NUM[r]));
    }

    // 持ち駒・名前
    renderSide($('sideTop'), 1 - vb, false);
    renderSide($('sideBottom'), vb, true);

    // 直前の手
    $('lastLine').textContent = G.last ? G.ply + '手目　' + G.last.text : '';

    // 結果
    const showResult = !!G.over && !state.hideResult;
    $('resultBox').hidden = !showResult;
    $('btnResultShow').hidden = !G.over || showResult;
    if (G.over) {
      $('resultText').textContent = overText(G);
      $('resultSub').textContent = G.ply + '手で終わり';
      $('btnAgain').hidden = !isHost();
    }

    // 操作
    $('btnUndo').hidden = !isHost();
    $('btnUndo').disabled = state.S.moves.length === 0;
    $('btnFlip').hidden = state.mode !== 'one';
    $('btnRestart').hidden = !isHost();
    $('btnAidToggle').setAttribute('aria-expanded', String(state.aidOpen));
    $('aidGame').hidden = !state.aidOpen;
    if (state.aidOpen) {
      buildAid($('aidGame'), aid, isHost(), (patch) => {
        commit((S) => { Object.assign(S.cfg.aid, patch); return S; });
      });
    }
  }

  function renderSide(box, side, isBottom) {
    const G = state.G;
    box.replaceChildren();
    box.classList.toggle('is-turn', !G.over && G.turn === side);
    const head = el('div', 'sh-side__head');
    head.append(el('span', 'sh-side__mark', MARK[side]));
    const name = state.S.cfg.names[side];
    head.append(el('span', 'sh-side__name', SIDE[side] + (name ? '　' + name : '')));
    if (state.mode === 'two' && side === mySide()) head.append(el('span', 'sh-side__you', 'あなた'));
    if (!G.over && G.turn === side) head.append(el('span', 'sh-side__turn', '番'));
    if (G.over && G.over.winner === side) head.append(el('span', 'sh-side__win', '勝ち'));
    box.append(head);

    const hand = el('div', 'sh-hand');
    const mine = canAct() && G.turn === side;
    let any = false;
    E.HAND_ORDER.forEach((t) => {
      const count = G.hands[side][t];
      if (!count) return;
      any = true;
      const btn = el('button', 'sh-handpiece');
      btn.type = 'button';
      btn.dataset.drop = t;
      btn.dataset.side = String(side);
      btn.disabled = !mine;
      if (state.sel && state.sel.drop === t && mine) btn.classList.add('is-sel');
      const p = side === 0 ? t : t.toLowerCase();
      btn.append(pieceNode(p, isBottom));
      if (count > 1) btn.append(el('span', 'sh-handpiece__count', '×' + count));
      btn.setAttribute('aria-label', '持ち駒の' + E.NAME[t] + ' ' + count + '枚');
      hand.append(btn);
    });
    if (!any) hand.append(el('span', 'sh-hand__none', '持ち駒なし'));
    box.append(hand);
  }

  function overText(G) {
    const o = G.over;
    if (o.reason === 'sennichite') return '同じ局面が4回出たので、千日手で引き分け';
    if (o.reason === 'perpetual') return '王手を続けた千日手なので、' + sideLabel(o.winner) + 'の勝ち！';
    if (o.reason === 'nomove') return sideLabel(1 - o.winner) + 'は指せる手がないので、' + sideLabel(o.winner) + 'の勝ち！';
    return '詰み。' + sideLabel(o.winner) + 'の勝ち！';
  }

  /* ── 指す ── */
  function onCell(i) {
    if (!canAct()) return;
    const G = state.G;
    $('msg').textContent = '';
    const p = G.board[i];
    if (state.sel) {
      const cand = targetsForSel().filter((m) => m.to === i);
      if (cand.length) {
        if (cand.length === 2) { openPromo(cand); return; }
        play(cand[0]);
        return;
      }
      if (p && E.ownerOf(p) === G.turn) {
        state.sel = state.sel.from === i ? null : { from: i };
        render();
        return;
      }
      $('msg').textContent = E.whyIllegal(G, state.sel.drop ? -1 : state.sel.from, i, state.sel.drop || '') || 'そこには指せないよ。';
      state.sel = null;
      render();
      return;
    }
    if (p && E.ownerOf(p) === G.turn) {
      state.sel = { from: i };
      if (!targetsForSel().length) $('msg').textContent = noMoveReason(i);
      render();
    }
  }
  function noMoveReason(i) {
    const G = state.G;
    const raw = E.targetsOf(G.board, G.n, i);
    if (!raw.length) return 'その駒は、いま動ける所がないよ。';
    return E.whyIllegal(G, i, raw[0], '') || 'その駒は、いま動ける所がないよ。';
  }
  function onHand(t, side) {
    if (!canAct() || state.G.turn !== side) return;
    $('msg').textContent = '';
    state.sel = state.sel && state.sel.drop === t ? null : { drop: t };
    if (state.sel && !targetsForSel().length) $('msg').textContent = 'その駒は、いま打てる所がないよ。';
    render();
  }
  function play(m) {
    const rev = state.S.rev;
    state.sel = null;
    state.pendingPromo = null;
    const ok = commit((S) => {
      if (S.rev !== rev) return null;   // ほかのウィンドウで局面が変わっていた
      if (state.G.over || !E.legalMoves(state.G).some((mm) => E.sameMove(mm, m))) return null;
      S.moves.push({ from: m.from, to: m.to, drop: m.drop || '', promote: !!m.promote });
      return S;
    });
    if (!ok) $('msg').textContent = '盤が変わったので、指さなかったよ。もう一度選んでね。';
  }

  /* ── 成る・成らない ── */
  function openPromo(cands) {
    state.pendingPromo = cands;
    const c = state.G.board[cands[0].from];
    const up = E.ownerOf(c) === bottomSide();
    const promoted = '+' + c;
    $('promoYesPiece').replaceChildren(pieceNode(promoted, up));
    $('promoNoPiece').replaceChildren(pieceNode(c, up));
    $('promoModal').hidden = false;
    $('btnPromoYes').focus();
  }
  function closePromo(choice) {
    const cands = state.pendingPromo;
    $('promoModal').hidden = true;
    if (!cands || choice == null) {
      state.pendingPromo = null;
      render();
      return;
    }
    play(cands.find((m) => m.promote === choice));
  }

  /* ── そのほかの操作 ── */
  function undo() {
    if (!isHost() || !state.S.moves.length) return;
    // CPU はいないので、1手だけもどす
    commit((S) => { S.moves.pop(); return S; });
    state.sel = null;
    state.hideResult = false;
    $('msg').textContent = '1手もどしたよ。';
    render();
  }
  function again() {
    if (!isHost()) return;
    commit((S) => {
      S.moves = [];
      S.cfg.names = [S.cfg.names[1], S.cfg.names[0]];
      if (state.mode === 'two') S.cfg.swap = !S.cfg.swap;
      return S;
    });
    state.sel = null;
    state.hideResult = false;
    $('msg').textContent = '';
    render();
  }
  function toTop() {
    if (state.mode === 'one') {
      try { sessionStorage.removeItem(LOCAL_KEY); } catch { /* 何もしない */ }
    }
    state.mode = null;
    state.S = null;
    state.G = null;
    $('promoModal').hidden = true;
    show('top');
  }

  /* ── 入口 ── */
  function startOne() {
    state.mode = 'one';
    state.me = 0;
    state.S = null;
    state.G = null;
    openSetup();
  }
  function startTwo(me) {
    state.mode = 'two';
    state.me = me;
    state.S = null;
    state.G = null;
    const S = loadShared();
    if (S) { adopt(S); enterGame(); return; }
    if (me === 0) openSetup();
    else show('wait');
  }

  window.addEventListener('storage', (ev) => {
    if (state.mode !== 'two' || ev.key !== SHARED_KEY) return;
    const S = loadShared();
    if (!S) {
      if (state.me === 1) { state.S = null; state.G = null; show('wait'); }
      return;
    }
    if (state.S && S.rev === state.S.rev) return;
    const wasOver = state.G && state.G.over;
    adopt(S);
    if (!document.getElementById('screen-game').classList.contains('active')) { enterGame(); return; }
    if (wasOver && !state.G.over) state.hideResult = false;
    if (state.sel && !targetsForSel().length) state.sel = null;
    if (state.pendingPromo && (!canAct() || state.G.board[state.pendingPromo[0].from] === '')) {
      state.pendingPromo = null;
      $('promoModal').hidden = true;
    }
    render();
  });

  $('btnOne').addEventListener('click', startOne);
  $('btnTwo0').addEventListener('click', () => startTwo(0));
  $('btnTwo1').addEventListener('click', () => startTwo(1));
  $('btnSetupBack').addEventListener('click', () => { if (state.G) enterGame(); else toTop(); });
  $('btnWaitBack').addEventListener('click', toTop);
  $('btnStart').addEventListener('click', startGame);
  $('board').addEventListener('click', (ev) => {
    const cell = ev.target.closest('.sh-cell');
    if (cell) onCell(Number(cell.dataset.i));
  });
  ['sideTop', 'sideBottom'].forEach((id) => $(id).addEventListener('click', (ev) => {
    const btn = ev.target.closest('.sh-handpiece');
    if (btn && !btn.disabled) onHand(btn.dataset.drop, Number(btn.dataset.side));
  }));
  $('btnPromoYes').addEventListener('click', () => closePromo(true));
  $('btnPromoNo').addEventListener('click', () => closePromo(false));
  $('btnPromoCancel').addEventListener('click', () => closePromo(null));
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('promoModal').hidden) closePromo(null);
  });
  $('btnUndo').addEventListener('click', undo);
  $('btnFlip').addEventListener('click', () => { state.flip = !state.flip; render(); });
  $('btnAidToggle').addEventListener('click', () => { state.aidOpen = !state.aidOpen; render(); });
  $('btnSeeBoard').addEventListener('click', () => { state.hideResult = true; render(); });
  $('btnResultShow').addEventListener('click', () => { state.hideResult = false; render(); });
  $('btnAgain').addEventListener('click', again);
  $('btnRestart').addEventListener('click', openSetup);
  $('btnTop').addEventListener('click', toTop);

  // 1台の画面は、読み込み直したら続きから
  const saved = readStore(sessionStorage, LOCAL_KEY);
  if (saved) {
    state.mode = 'one';
    adopt(saved);
    enterGame();
  }
})();
