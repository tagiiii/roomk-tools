/* 神経衰弱
   遊び方は2つ: 1台の画面（CPU と対戦／人どうし2〜4人。通信しない）と、ルーム（各自の端末・2〜6人・Realtime Database）。
   ルームの決まりは logic.js（window.SS_LOGIC）。カードの絵は「絵のキー」で共有する（ふつうの絵は Material Symbols の名前、激ムズは「形-数」）。
   確かめる用: ?fast=1 でめくったあとの待ち時間を短くする */
(function () {
  'use strict';

  const D = window.SS_DATA;
  const L = window.SS_LOGIC;
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
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const toast = (message, isError = true) => RoomkRTDB.showToast(message, isError);

  /* ── 絵（キー → 絵の中身） ── */
  const FACES = new Map();
  D.icons.forEach((ic) => FACES.set(ic.icon, { key: ic.icon, kind: 'icon', icon: ic, label: ic.label }));
  D.shapes.forEach((s) => D.shapeCounts.forEach((n) => {
    const key = s.id + '-' + n;
    FACES.set(key, { key: key, kind: 'shape', shape: s, n: n, label: s.label + 'が' + n + 'つ' });
  }));
  const ICON_KEYS = D.icons.map((ic) => ic.icon);
  const SHAPE_KEYS = [];
  D.shapes.forEach((s) => D.shapeCounts.forEach((n) => SHAPE_KEYS.push(s.id + '-' + n)));
  const keysFor = (level) => (level.kind === 'shape' ? SHAPE_KEYS : ICON_KEYS);
  const levelOf = (id) => D.levels.find((l) => l.id === id) || D.levels[0];

  /* ── 画面 ── */
  const SCREENS = ['screen-top', 'screen-local', 'screen-create', 'screen-join', 'screen-waiting', 'ss-app'];
  function showScreen(id) {
    const changed = $(id).hidden;
    SCREENS.forEach((s) => { $(s).hidden = s !== id; });
    if (changed) window.scrollTo(0, 0);
  }

  /* ── 盤と名前の札（1台の画面・ルーム共通） ── */
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

  const board = { key: null, level: null, faces: [] };

  function applyCols() {
    const level = board.level;
    if (!level) return;
    const cols = sp.matches ? level.colsSp : level.cols;
    const wrap = $('board-wrap');
    wrap.style.setProperty('--cols', cols);
    wrap.style.setProperty('--rows', Math.ceil(level.cards / cols));
    wrap.style.setProperty('--maxw', level.maxw + 'px');
  }

  // 盤を作る（同じ対戦のあいだは作りなおさない。キーボードで選んでいたカードが消えないように）
  function buildBoard(key, level, faces) {
    if (board.key === key) return;
    board.key = key;
    board.level = level;
    board.faces = faces;
    const box = $('board');
    box.textContent = '';
    applyCols();
    faces.forEach((face, i) => {
      const b = el('button', 'ss-card');
      b.type = 'button';
      b.dataset.i = String(i);
      const inner = el('span', 'ss-card__inner');
      inner.setAttribute('aria-hidden', 'true');
      const back = el('span', 'ss-card__back', String(i + 1));
      const front = el('span', 'ss-card__front');
      front.append(el('span', 'ss-card__front-num', String(i + 1)), faceNode(face));
      inner.append(back, front);
      b.appendChild(inner);
      box.appendChild(b);
    });
  }

  // up: 表にするか / got: 取ったカード（薄く出す）/ locked: いま押せないか
  function paintBoard(up, got, locked) {
    $('board').classList.toggle('is-locked', locked);
    document.querySelectorAll('#board .ss-card').forEach((b) => {
      const i = Number(b.dataset.i);
      const face = board.faces[i];
      b.classList.toggle('is-up', !!(up[i] || got[i]));
      b.classList.toggle('is-got', !!got[i]);
      const num = (i + 1) + '番のカード。';
      b.setAttribute('aria-label', got[i] ? num + face.label + '（取ったカード）' : up[i] ? num + face.label : num + 'うら');
      if (got[i]) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    });
  }

  // items: [{ name, pairs, turn, tags }]
  function paintPlayers(items) {
    const ul = $('players');
    ul.textContent = '';
    items.forEach((p) => {
      const li = el('li', 'ss-player' + (p.turn ? ' is-turn' : ''));
      li.appendChild(el('span', 'ss-player__name', p.name));
      (p.tags || []).forEach((tag) => li.appendChild(el('span', 'ss-player__tag', tag)));
      if (p.turn) li.appendChild(el('span', 'ss-player__turn', '番'));
      const n = el('span', 'ss-player__pairs', String(p.pairs));
      n.appendChild(el('span', 'ss-player__unit', 'ペア'));
      li.appendChild(n);
      ul.appendChild(li);
    });
  }

  function resultText(names, pairs) {
    const max = Math.max.apply(null, pairs.concat([0]));
    const tops = names.filter((_, i) => pairs[i] === max);
    return tops.length === names.length
      ? 'みんな ' + max + 'ペア。引き分け'
      : tops.join('・') + 'が ' + max + 'ペアで、いちばん多く取ったよ';
  }

  /* ════════════ 1台の画面（通信しない） ════════════ */

  const setup = { opp: 'cpu', cpu: 'normal', count: 2, level: 'easy', names: ['', '', '', ''] };
  const OPPS = [{ id: 'cpu', label: 'CPU' }, { id: 'human', label: '人どうし' }];
  const COUNTS = [{ id: 2, label: '2人' }, { id: 3, label: '3人' }, { id: 4, label: '4人' }];

  function buildSeg(box, items, get, set) {
    box.textContent = '';
    items.forEach((it) => {
      const b = el('button', '', it.label);
      b.type = 'button';
      b.dataset.value = String(it.id);
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(get() === it.id));
      b.addEventListener('click', () => set(it.id));
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
    const set = (key) => (v) => { setup[key] = v; renderSetup(); };
    buildSeg($('opp-opts'), OPPS, () => setup.opp, set('opp'));
    buildSeg($('cpu-opts'), D.cpuLevels, () => setup.cpu, set('cpu'));
    buildSeg($('count-opts'), COUNTS, () => setup.count, set('count'));
    buildSeg($('level-opts'), D.levels, () => setup.level, set('level'));
    $('cpu-field').hidden = setup.opp !== 'cpu';
    $('count-field').hidden = setup.opp !== 'human';
    $('level-note').textContent = levelOf(setup.level).note;

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

  let game = null;
  let timers = [];
  const later = (fn, ms) => {
    const g = game;
    timers.push(setTimeout(() => { if (game === g) fn(); }, ms));
  };
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  let localNo = 0;
  function startGame(first) {
    clearTimers();
    keepNames();
    const level = levelOf(setup.level);
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
    const deck = L.makeDeck(level, keysFor(level), L.randomSeed());
    game = {
      level: level,
      cpu: D.cpuLevels.find((c) => c.id === setup.cpu),
      cards: deck.map((key) => ({ face: FACES.get(key), up: false, got: false })),
      players: players,
      first: first % players.length,
      turn: first % players.length,
      open: [],
      lock: false,
      memory: new Map(),   // CPU が覚えているカード（位置 → 絵）
      over: false,
      msg: ''
    };
    showScreen('ss-app');
    window.scrollTo(0, 0);
    $('bar-level').textContent = level.label + '・' + level.cards + '枚';
    $('btn-quit').hidden = false;
    $('btn-quit').textContent = '設定にもどる';
    $('btn-again').hidden = false;
    $('btn-back').hidden = false;
    $('btn-back').textContent = '設定にもどる';
    $('result-wait').hidden = true;
    buildBoard('local:' + (++localNo), level, game.cards.map((c) => c.face));
    setTurnMsg();
    render();
    // 利用回数（人数は CPU をのぞいた、遊ぶ人の数）
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + players.filter((p) => !p.cpu).length);
    if (cur().cpu) cpuTurn();
  }

  const cur = () => game.players[game.turn];

  function render() {
    paintPlayers(game.players.map((p, i) => ({ name: p.name, pairs: p.pairs, turn: !game.over && i === game.turn })));
    $('status').textContent = game.msg;
    $('status').hidden = game.over;
    paintBoard(game.cards.map((c) => c.up), game.cards.map((c) => c.got), game.lock || game.over || cur().cpu);
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
    $('result-head').textContent = 'ぜんぶそろった！';
    $('result-body').textContent = resultText(game.players.map((p) => p.name), game.players.map((p) => p.pairs));
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

  function toSetup() {
    clearTimers();
    game = null;
    board.key = null;
    showScreen('screen-local');
    renderSetup();
    window.scrollTo(0, 0);
  }

  /* ════════════ ルーム（各自の端末。Realtime Database） ════════════ */

  const DB_PREFIX = 'shinkeisuijaku_rooms';
  const SESSION_KEY = 'shinkeisuijaku_session';
  const ORPHAN_TTL_MS = 2 * 60 * 1000;
  const PRESENCE_RETRY_MS = 3000;
  const TX_RETRY_MAX = 3;
  const ABSENT_GRACE_MS = 4000; // めくる番の人がいないとき、とばすまでの待ち（再読み込みの一瞬は待つ）
  const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
  const S = L.STATUS;

  const net = {
    role: null,          // 'host' | 'guest'
    nickname: null,
    roomCode: null,
    roomRef: null,
    room: null,          // 最新のルーム
    joinedAt: null,
    roomCallback: null,
    connectedRef: null,
    connectedCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    busy: false,
    pending: null,       // 処理中に押したカード（終わったらめくる）
    timerInterval: null,
    orphanTimer: null,
    orphanAt: null,
    skipTimer: null,
    skipKey: null,
    seen: null,          // 見た対戦の id と2枚めくった回数（新しくめくられたら、しばらく表で見せる）
    anim: null,          // { r: reveal, until }
    animTimer: null,
  };

  // 通信はルームを作る・参加する・ルームにもどるときだけ準備する（1台の画面ではつながない）
  let fb = null;
  function firebaseReady() {
    if (!fb) fb = RoomkRTDB.initFirebase(firebase);
    return fb;
  }

  function currentUid() {
    return fb ? firebase.auth().currentUser?.uid || null : null;
  }

  function serverTimestamp() {
    return firebase.database.ServerValue.TIMESTAMP;
  }

  async function waitAuth() {
    try {
      await firebaseReady().authReady;
      return true;
    } catch {
      toast('うまくつながらなかったよ。ページを読み直してね');
      return false;
    }
  }

  function isExpired(room) {
    // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
    return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
  }

  async function removeExpired(ref, fallback) {
    try {
      // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
      await ref.transaction((room) => {
        const current = room || fallback;
        return current && isExpired(current) ? null : undefined;
      }, undefined, false);
    } catch (error) {
      console.warn('[shinkei-suijaku] expired room cleanup failed', error);
    }
  }

  // transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
  function warmRoomCache(ref) {
    return new Promise((resolve, reject) => {
      const callback = (snap) => {
        resolve({ snap, release: () => ref.off('value', callback) });
      };
      ref.on('value', callback, reject);
    });
  }

  // 送信後に通信が切れて中止された transaction は、やり直す（届いていたかは中で確かめる）
  async function transactRetry(ref, update) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await ref.transaction(update);
      } catch (error) {
        if (error?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
      }
    }
  }

  // 遊んでいる途中・おわりの画面のあいだ、その名前がこのゲームのほかの端末（か端末なしの参加者）のものか
  function reservedByOther(room, name, uid) {
    const g = L.gameOf(room);
    if (!g || room.status === S.WAITING) return false;
    if (L.isProxy(g, name)) return true;
    const owner = g.uids?.[name];
    return !!owner && owner !== uid;
  }

  function setError(id, message) {
    const box = $(id);
    box.textContent = message;
    box.hidden = !message;
    const inputs = { createError: ['hostName'], joinError: ['guestName', 'joinCode'], proxyError: ['proxyName'] }[id] || [];
    inputs.forEach((inputId) => {
      if (message) $(inputId).setAttribute('aria-invalid', 'true');
      else $(inputId).removeAttribute('aria-invalid');
    });
  }

  /* ── 再接続用の記録（名前とルームコードだけ） ── */
  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({
        role: net.role,
        nickname: net.nickname,
        roomCode: net.roomCode,
        uid: currentUid(),
        joinedAt: net.joinedAt,
      }));
    } catch {
      // 保存できないときは、再読み込みで戻れないだけ
    }
  }

  function loadSession() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY));
    } catch {
      return null;
    }
  }

  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // 何もしない
    }
  }

  /* ── ルームへの出入り ── */
  function stopAnim() {
    clearTimeout(net.animTimer);
    net.animTimer = null;
    net.anim = null;
  }

  function cleanupRoom() {
    clearInterval(net.timerInterval);
    clearTimeout(net.orphanTimer);
    clearTimeout(net.skipTimer);
    stopAnim();
    if (net.roomRef && net.roomCallback) net.roomRef.off('value', net.roomCallback);
    if (net.connectedRef && net.connectedCallback) net.connectedRef.off('value', net.connectedCallback);
    if (net.roomRef) RoomkRTDB.cancelRoomOnDisconnect(net.roomRef);
    Object.assign(net, {
      role: null,
      nickname: null,
      roomCode: null,
      roomRef: null,
      room: null,
      joinedAt: null,
      roomCallback: null,
      connectedRef: null,
      connectedCallback: null,
      isConnected: false,
      presenceDirty: false,
      presenceAt: 0,
      leaving: false,
      pending: null,
      timerInterval: null,
      orphanTimer: null,
      orphanAt: null,
      skipTimer: null,
      skipKey: null,
      seen: null,
    });
    clearSession();
    board.key = null;
    $('hostOffOverlay').hidden = true;
    $('roomBar').hidden = true;
  }

  function leaveLocally(message, isError = true) {
    cleanupRoom();
    showScreen('screen-top');
    if (message) toast(message, isError);
  }

  function connectToRoom(role, nickname, code, ref, joinedAt) {
    // 念のため、前のルームの購読・タイマーが残っていたら片付けてからつなぐ
    if (net.roomRef) cleanupRoom();
    net.role = role;
    net.nickname = nickname;
    net.roomCode = code;
    net.roomRef = ref;
    net.joinedAt = Number(joinedAt) || RoomkRTDB.now();
    $('roomCodeLabel').textContent = code;
    $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
    $('roomBar').hidden = false;
    saveSession();
    // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname + (FAST ? '?fast=1' : ''));

    net.roomCallback = (snap) => {
      // 自分で退出・ルームを閉じている途中の変化は、退出処理の側で片付ける
      if (net.roomRef !== ref || net.leaving) return;
      if (!snap.exists()) {
        leaveLocally('ルームが閉じられたよ', false);
        return;
      }
      const room = snap.val();
      if (isExpired(room)) {
        removeExpired(ref, room);
        leaveLocally('このルームは終わったみたい');
        return;
      }
      net.room = room;
      handleRoom(room);
    };
    ref.on('value', net.roomCallback, (error) => {
      console.warn('[shinkei-suijaku] room listener failed', error);
      toast('ルームの読み込みに失敗しました');
    });

    net.connectedRef = firebaseReady().db.ref('.info/connected');
    net.connectedCallback = (snap) => {
      net.isConnected = snap.val() === true;
      if (net.isConnected && net.roomRef === ref) {
        net.presenceDirty = true;
        ensurePresence(true);
      }
    };
    net.connectedRef.on('value', net.connectedCallback);
    net.timerInterval = setInterval(tickRoom, 1000);
  }

  function tickRoom() {
    if (net.room && needsPresence(net.room)) ensurePresence();
  }

  // 接続中なのに、ルームの上では切断・不在になっている
  function needsPresence(room) {
    if (net.role === 'host') return room.hostConnected === false;
    if (net.role === 'guest') return !room.players?.[net.nickname];
    return false;
  }

  // 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
  // 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
  async function ensurePresence(force = false) {
    const ref = net.roomRef;
    if (!ref || net.leaving || !net.isConnected || !net.room) return;
    if (!force && Date.now() - net.presenceAt < PRESENCE_RETRY_MS) return;
    net.presenceDirty = false;
    net.presenceAt = Date.now();
    const role = net.role;
    const nickname = net.nickname;
    const joinedAt = net.joinedAt;
    const uid = currentUid();
    // 退出・ルームを閉じる途中になったら、在室を書き戻さない（transaction の中でも見る。
    // 退出の transaction のあとに書き戻すと、抜けた人が在室のまま残るため）
    const stale = () => net.leaving || net.roomRef !== ref;
    try {
      if (role === 'host') {
        await ref.onDisconnect().update({
          hostConnected: false,
          hostDisconnectedAt: serverTimestamp(),
        });
        if (stale()) return;
        await ref.transaction((room) => {
          if (stale() || !room || room.hostUid !== uid || isExpired(room)) return;
          if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
          return { ...room, hostConnected: true, hostDisconnectedAt: null };
        });
      } else if (role === 'guest') {
        await ref.child('players/' + nickname).onDisconnect().remove();
        if (stale()) return;
        let full = false;
        await ref.transaction((room) => {
          full = false;
          if (stale() || !room || isExpired(room) || room.players?.[nickname]) return;
          if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) return;
          // 遊んでいるゲームの人は人数の上限を見ない
          const inGame = room.status === S.PLAYING && L.ownsName(L.gameOf(room), nickname, uid);
          if (!inGame && room.status === S.PLAYING) return;
          if (!inGame && L.playingNames(room).length >= L.MAX_PLAYERS) {
            full = true;
            return;
          }
          return {
            ...room,
            players: {
              ...(room.players || {}),
              [nickname]: { isHost: false, uid, joinedAt },
            },
          };
        });
        if (full && net.roomRef === ref && !net.leaving) {
          await RoomkRTDB.cancelRoomOnDisconnect(ref);
          leaveLocally('このルームはいっぱいだよ');
        }
      }
    } catch (error) {
      console.warn('[shinkei-suijaku] presence recovery failed', error);
      // 定期的な確認の失敗は通知しない（接続し直したときだけ知らせる）
      if (force) toast('再接続に失敗しました。ページを読み直してね');
    }
  }

  async function createRoom() {
    if (net.busy || net.roomRef) return;
    const nickname = $('hostName').value.trim();
    const error = L.validNickname(nickname);
    if (error) {
      setError('createError', error);
      return;
    }
    setError('createError', '');
    // 認証待ちの間の二度押しでルームが2つできないよう、待つ前にロックする
    net.busy = true;
    $('btnCreateRoom').disabled = true;
    try {
      if (!await waitAuth()) return;
      const uid = currentUid();
      const joinedAt = RoomkRTDB.now();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = RoomkRTDB.generateRoomCode();
        const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
        const result = await transactRetry(ref, (room) => {
          // やり直しのとき、前の送信で自分が作ったルームが届いていたら、そのまま使う
          if (room) return room.hostUid === uid && room.players?.[nickname]?.joinedAt === joinedAt ? room : undefined;
          return {
            status: S.WAITING,
            host: nickname,
            hostUid: uid,
            hostPlays: true,
            level: D.levels[0].id,
            hostConnected: true,
            hostDisconnectedAt: null,
            createdAt: serverTimestamp(),
            lastGameId: 0,
            players: {
              [nickname]: { isHost: true, uid, joinedAt },
            },
          };
        });
        if (result.committed) {
          window.RoomkStats?.count('room-create');
          connectToRoom('host', nickname, code, ref, joinedAt);
          return;
        }
      }
      setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
    } catch (err) {
      console.warn('[shinkei-suijaku] create failed', err);
      setError('createError', '接続できませんでした。もう一度ためしてね');
    } finally {
      net.busy = false;
      $('btnCreateRoom').disabled = false;
    }
  }

  // ルームコード: 日本語入力のまま打った全角の英数字は半角に、小文字は大文字にそろえて読む。
  // 入力欄は打っている間に書き換えない（変換中に書き換えると文字が重なり、ローマ字が入らなくなる）
  function normalizeRoomCode(raw) {
    return String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  }
  // ひらがななど半角にできない文字が残ったら、日本語入力の切り替え方を案内する
  function roomCodeImeError(code) {
    return /[^\x00-\x7F]/.test(code)
      ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）'
      : '';
  }

  async function joinRoom() {
    if (net.busy || net.roomRef) return;
    const nickname = $('guestName').value.trim();
    const code = normalizeRoomCode($('joinCode').value);
    const error = L.validNickname(nickname);
    if (error) {
      setError('joinError', error);
      return;
    }
    const imeError = roomCodeImeError(code);
    if (imeError) {
      setError('joinError', imeError);
      return;
    }
    if (!ROOM_CODE_PATTERN.test(code)) {
      setError('joinError', 'ルームコードは6文字で入れてね');
      return;
    }
    setError('joinError', '');
    net.busy = true;
    $('btnJoinRoom').disabled = true;
    let release = null;
    try {
      if (!await waitAuth()) return;
      const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
      const warm = await warmRoomCache(ref);
      release = warm.release;
      const initial = warm.snap.val();
      if (!initial) {
        setError('joinError', 'ルームが見つからないよ。コードを確かめてね');
        return;
      }
      if (isExpired(initial)) {
        await removeExpired(ref, initial);
        setError('joinError', 'このルームは終わったみたい');
        return;
      }
      const uid = currentUid();
      const joinedAt = RoomkRTDB.now();
      let reason = '';
      let rejoinAt = null;
      const result = await transactRetry(ref, (room) => {
        reason = '';
        rejoinAt = null;
        if (!room) { reason = '見つからない'; return; }
        if (isExpired(room)) { reason = '終了'; return; }
        // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
        const stale = room.players?.[nickname];
        const mine = !!stale && !stale.isHost && stale.uid === uid;
        if (nickname === room.host || room.proxies?.[nickname] || (stale && !mine) || reservedByOther(room, nickname, uid)) {
          reason = '名前';
          return;
        }
        const g = L.gameOf(room);
        if (mine) {
          rejoinAt = Number(stale.joinedAt) || joinedAt;
        } else if (room.status === S.PLAYING) {
          // 遊んでいる途中は、このゲームで遊んでいた人がタブを閉じたあとに入りなおすときだけ入れる
          if (!L.ownsName(g, nickname, uid)) { reason = '途中'; return; }
          rejoinAt = Number(g.joined?.[nickname]) || joinedAt;
        } else if (L.playingNames(room).length >= L.MAX_PLAYERS) {
          reason = '満員';
          return;
        }
        return {
          ...room,
          players: {
            ...(room.players || {}),
            [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt },
          },
        };
      });
      if (!result.committed) {
        const messages = {
          '見つからない': 'ルームが見つからないよ。コードを確かめてね',
          '終了': 'このルームは終わったみたい',
          '名前': 'その名前は使われているよ。少し変えてみてね',
          '満員': 'このルームはいっぱいだよ（遊べるのは' + L.MAX_PLAYERS + '人まで）',
          '途中': 'もうゲームが始まっているよ。カードがぜんぶなくなったら参加できるよ',
        };
        setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
        return;
      }
      connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
    } catch (err) {
      console.warn('[shinkei-suijaku] join failed', err);
      setError('joinError', '接続できませんでした。もう一度ためしてね');
    } finally {
      release?.();
      net.busy = false;
      $('btnJoinRoom').disabled = false;
    }
  }

  async function tryReconnect() {
    const saved = loadSession();
    if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
    if (!ROOM_CODE_PATTERN.test(saved.roomCode) || L.validNickname(saved.nickname)) return false;
    if (net.busy || net.roomRef) return false;
    // 復帰の途中で「ルームを作る／参加する」が重ならないようにする
    net.busy = true;
    const entry = ['btnGoCreate', 'btnGoJoin', 'btnGoLocal'];
    entry.forEach((id) => { $(id).disabled = true; });
    let release = null;
    try {
      if (!await waitAuth()) return false;
      const uid = currentUid();
      if (!uid || uid !== saved.uid) return false;
      const ref = firebaseReady().db.ref(DB_PREFIX + '/' + saved.roomCode);
      const warm = await warmRoomCache(ref);
      release = warm.release;
      const room = warm.snap.val();
      if (!room) return false;
      if (isExpired(room)) {
        await removeExpired(ref, room);
        return false;
      }
      let joinedAt = Number(saved.joinedAt) || null;
      if (saved.role === 'host') {
        if (room.host !== saved.nickname || room.hostUid !== uid) return false;
        joinedAt = Number(room.players?.[saved.nickname]?.joinedAt) || joinedAt;
      } else if (saved.role === 'guest') {
        if (saved.nickname === room.host || room.proxies?.[saved.nickname]) return false;
        const player = room.players?.[saved.nickname];
        if (player && (player.isHost || player.uid !== uid)) return false;
        if (reservedByOther(room, saved.nickname, uid)) return false;
        if (player) joinedAt = Number(player.joinedAt) || joinedAt;
      } else {
        return false;
      }
      if (net.roomRef) return false;
      connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
      return true;
    } catch (error) {
      console.warn('[shinkei-suijaku] reconnect failed', error);
      return false;
    } finally {
      release?.();
      net.busy = false;
      entry.forEach((id) => { $(id).disabled = false; });
    }
  }

  async function leaveRoom() {
    if (net.busy || !net.roomRef) return;
    const ref = net.roomRef;
    const role = net.role;
    const nickname = net.nickname;
    const uid = currentUid();
    if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
    net.busy = true;
    net.leaving = true;
    try {
      await RoomkRTDB.cancelRoomOnDisconnect(ref);
      if (role === 'host') {
        await ref.remove();
      } else {
        // 自分の在室だけを消す（名前とペアの数はゲームが終わるまで残す。入りなおせるように）
        await ref.transaction((room) => {
          if (!room) return;
          if (room.players?.[nickname]?.uid !== uid) return;
          const players = { ...room.players };
          delete players[nickname];
          const left = { ...room, players };
          // 自分の番だったら、めくりかけを裏にもどして次の人へ
          const g = L.gameOf(left);
          if (g && left.status === S.PLAYING && L.actorOf(g) === nickname) return L.passTurn(left) || left;
          return left;
        });
      }
    } catch (error) {
      console.warn('[shinkei-suijaku] leave failed', error);
      toast('退出できませんでした。もう一度ためしてね');
      net.leaving = false;
      net.busy = false;
      // 退出の前に取り消した切断予約を張り直す
      ensurePresence(true);
      if (net.room) handleRoom(net.room);
      return;
    }
    net.busy = false;
    leaveLocally('');
  }

  /* ── 画面の更新 ── */
  function handleRoom(room) {
    if (net.role === 'guest') {
      const me = room.players?.[net.nickname];
      if (me && me.uid !== currentUid()) {
        leaveLocally('同じ名前の人が参加したので、ルームから外れました');
        return;
      }
    }
    if (net.presenceDirty) ensurePresence(true);
    else if (needsPresence(room)) ensurePresence();
    updateHostOverlay(room);
    trackReveal(room);
    renderRoom(room);
    if (net.role === 'host') hostWatchAbsent(room);
  }

  function updateHostOverlay(room) {
    if (net.role === 'guest' && room.hostConnected === false) {
      $('hostOffOverlay').hidden = false;
      // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす。
      // 古い時刻のまま動くと「まだ期限前」で消せず、待つ画面のまま残る
      if (net.orphanTimer && net.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(net.orphanTimer); net.orphanTimer = null; }
      if (!net.orphanTimer) {
        net.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
        const ref = net.roomRef;
        const at = net.orphanAt;
        const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
        net.orphanTimer = setTimeout(() => {
          net.orphanTimer = null;
          if (net.roomRef === ref && net.room) removeExpired(ref, net.room);
        }, delay);
      }
    } else {
      $('hostOffOverlay').hidden = true;
      clearTimeout(net.orphanTimer);
      net.orphanTimer = null;
    }
  }

  // 新しく2枚めくられたのを見たら、その2枚をしばらく表で見せる（そろったら取ったカードとして薄くする・ちがったら裏にもどす）。
  // 開いた直後・再読み込みのあとは見せずに、いまの形を出す
  function trackReveal(room) {
    const g = L.gameOf(room);
    if (!g || room.status === S.WAITING) {
      net.seen = null;
      stopAnim();
      return;
    }
    const r = L.revealOf(g);
    const n = r ? r.n : 0;
    const seen = net.seen;
    // 同時に押したとき、手元の仮の結果で見せはじめたあとに、確定したちがう2枚が同じ n で届くことがある。そのときは見せなおす
    const replaced = !!(net.anim && seen && seen.id === g.id && r && n === seen.n && (r.a !== seen.a || r.b !== seen.b));
    if (seen && seen.id === g.id && r && (n === seen.n + 1 || replaced)) {
      stopAnim();
      const ms = r.match ? T.got : T.back;
      net.anim = { r: r };
      net.animTimer = setTimeout(() => {
        net.anim = null;
        net.animTimer = null;
        if (net.room) renderRoom(net.room);
        flushPending();
      }, ms);
    } else if (!seen || seen.id !== g.id || n !== seen.n) {
      stopAnim();
    }
    net.seen = { id: g.id, n: n, a: r ? r.a : -1, b: r ? r.b : -1 };
  }

  function renderRoom(room) {
    const g = L.gameOf(room);
    if (g && (room.status === S.PLAYING || room.status === S.OVER) && L.deckOf(g)) {
      renderRoomGame(room, g);
    } else {
      renderWaiting(room);
    }
  }

  function renderWaiting(room) {
    net.pending = null;
    showScreen('screen-waiting');
    const host = net.role === 'host';
    const playing = L.playingNames(room);
    const level = levelOf(room.level);
    $('waitingCount').textContent = '遊ぶ人 ' + playing.length + '人（' + L.MIN_PLAYERS + '〜' + L.MAX_PLAYERS + '人）';

    const list = $('waitingPlayers');
    list.replaceChildren();
    const addRow = (name, tags, onRemove) => {
      const li = el('li', 'ss-people__item');
      li.appendChild(el('span', 'ss-people__name', name));
      tags.forEach((tag) => li.appendChild(el('span', 'ss-player__tag', tag)));
      if (onRemove) {
        const btn = el('button', 'ss-quiet', '外す');
        btn.type = 'button';
        btn.dataset.name = name;
        btn.setAttribute('aria-label', name + 'を外す');
        btn.addEventListener('click', onRemove);
        li.appendChild(btn);
      }
      list.appendChild(li);
    };
    L.memberNames(room).forEach((name) => {
      const p = room.players[name];
      const tags = [];
      if (p.isHost) tags.push(room.hostPlays !== false ? 'ホスト' : '進行役');
      if (name === net.nickname) tags.push('あなた');
      addRow(name, tags);
    });
    // 「端末なし」の印は、ホストの画面にだけ出す（子どもどうしの画面で区別しない）
    L.proxyNames(room).forEach((name) => {
      addRow(name, host ? ['端末なし'] : [], host ? () => removeProxy(name) : null);
    });
    $('waitingOrder').textContent = playing.length >= 2 ? 'めくる順番：' + playing.join(' → ') : '';
    $('waitingSettings').textContent = 'むずかしさ ' + level.label + '（' + level.note + '）';

    $('hostWaitingTools').hidden = !host;
    $('guestWaitingNote').hidden = host;
    if (host) {
      const full = playing.length >= L.MAX_PLAYERS;
      const box = $('hostPlays');
      box.checked = room.hostPlays !== false;
      box.disabled = room.hostPlays === false && full;
      buildSeg($('roomLevel'), D.levels, () => level.id, setLevel);
      $('roomLevelNote').textContent = level.note;
      $('btnShuffleOrder').disabled = playing.length < 2;
      $('btnAddProxy').disabled = full || L.proxyNames(room).length >= L.MAX_PROXIES;
      $('btnStartGame').disabled = playing.length < L.MIN_PLAYERS;
      $('startNote').textContent = playing.length < L.MIN_PLAYERS
        ? '遊ぶ人が' + L.MIN_PLAYERS + '人そろうと、はじめられます'
        : full ? '遊べるのは' + L.MAX_PLAYERS + '人までです' : '';
    }
  }

  function isMe(name) {
    return name === net.nickname;
  }

  function playerTags(room, g, name) {
    const tags = [];
    if (isMe(name)) tags.push('あなた');
    if (net.role === 'host' && L.isProxy(g, name)) tags.push('端末なし');
    else if (!L.present(room, g, name)) tags.push('つながっていない');
    return tags;
  }

  function renderRoomGame(room, g) {
    // 待合室で出ていた入力のまちがいは、待合室にもどったときに残さない
    if (!$('proxyError').hidden) setError('proxyError', '');
    showScreen('ss-app');
    const level = levelOf(g.level);
    const deck = L.deckOf(g);
    buildBoard('room:' + net.roomCode + ':' + g.id, level, deck.map((key) => FACES.get(key) || FACES.get(ICON_KEYS[0])));
    $('bar-level').textContent = level.label + '・' + level.cards + '枚';

    const order = L.orderOf(g);
    const got = L.gotOf(g);
    const open = L.openOf(g);
    const anim = net.anim;
    const r = anim ? anim.r : null;
    const pairs = L.pairsOf(g);
    const shownGot = got.slice();
    const up = got.map(() => false);
    if (open >= 0) up[open] = true;
    if (r) {
      up[r.a] = true;
      up[r.b] = true;
      // そろったカードは、見せている間は薄くしない。ペアの数も見せおわってから増やす
      if (r.match) {
        shownGot[r.a] = false;
        shownGot[r.b] = false;
        if (pairs[r.turn] > 0) pairs[r.turn] -= 1;
      }
    }
    const over = room.status === S.OVER && !r;
    const turn = r ? r.turn : L.turnOf(g);
    paintPlayers(order.map((name, i) => ({ name: name, pairs: pairs[i], turn: !over && i === turn, tags: playerTags(room, g, name) })));

    const act = L.canAct(room, currentUid(), net.nickname, net.role);
    const actor = L.actorOf(g);
    const mine = isMe(actor);
    paintBoard(up, shownGot, !act || !!r || over);

    // ひとことの案内
    let msg = '';
    if (r) {
      msg = r.match ? 'そろった！ ' + order[r.turn] + 'がもらうよ' : 'ちがったね';
    } else if (!over) {
      if (mine) msg = open >= 0 ? 'あなたの番。もう1枚めくってね' : 'あなたの番。カードを2枚めくってね';
      else if (act) msg = actor + 'の番。代わりにめくれます' + (L.present(room, g, actor) ? '' : '（つながっていません）');
      else msg = open >= 0 ? actor + 'がめくっているよ' : actor + 'の番';
    }
    $('status').textContent = msg;
    $('status').hidden = over;

    const host = net.role === 'host';
    $('btn-quit').hidden = !host || over;
    $('btn-quit').textContent = '待合室にもどる';
    $('result').hidden = !over;
    if (over) {
      $('result-head').textContent = 'ぜんぶそろった！';
      $('result-body').textContent = resultText(order, L.pairsOf(g));
      $('btn-again').hidden = !host;
      $('btn-back').hidden = !host;
      $('btn-back').textContent = '待合室にもどる';
      $('result-wait').hidden = host;
    }
  }

  /* ── カードをめくる（番の人とホスト） ── */
  async function roomAct(mutate, failMessage) {
    if (net.busy || !net.roomRef) return null;
    net.busy = true;
    const uid = currentUid();
    const nickname = net.nickname;
    const role = net.role;
    try {
      const result = await net.roomRef.transaction((room) => {
        if (!room || isExpired(room) || !L.canAct(room, uid, nickname, role)) return;
        return mutate(room) || undefined;
      });
      return result.committed;
    } catch (error) {
      console.warn('[shinkei-suijaku] action failed', error);
      toast(failMessage);
      return null;
    } finally {
      net.busy = false;
      if (net.room && net.roomRef) renderRoom(net.room);
    }
  }

  // expect: 保留していたカードをめくるときの { id, turn }（押した時点の対戦と番）
  async function roomFlip(i, expect) {
    const g = L.gameOf(net.room);
    if (!g || net.room.status !== S.PLAYING) return;
    // 前の2枚を見せている間・処理中に押したカードは、終わってからめくる（すばやく2枚押したとき）
    if (net.busy || net.anim) {
      // 押した時点の対戦と番を覚えておく（ホストは番に関係なくめくれるので、番が変わったら捨てる）。
      // ちがった2枚を見せている間に押したカードは、番が替わる所なので覚えない（盤も押せない見た目にしている）。
      // 覚えるのは、はじめに押した1枚だけ（続けて押したカードで上書きすると、2枚めのつもりのカードが消える）
      const r = net.anim ? net.anim.r : null;
      if (r && !r.match) return;
      if (!net.pending) net.pending = { i: i, id: g.id, turn: r ? r.turn : L.turnOf(g) };
      return;
    }
    const id = g.id;
    const flipNo = L.flipNoOf(g);
    let over = false;
    const ok = await roomAct((room) => {
      let no = flipNo;
      if (expect) {
        // 保留のカードは、手元の値がまだ前の1枚の前のことがあるので、書き込みの中の最新の回数を使う。
        // そのかわり、押した時点と同じ対戦・同じ番のときだけめくる
        const cur = L.gameOf(room);
        if (!cur || cur.id !== expect.id || L.turnOf(cur) !== expect.turn) return null;
        no = L.flipNoOf(cur);
      }
      const next = L.flip(room, id, no, i);
      over = next?.status === S.OVER;
      return next;
    }, 'めくれませんでした。もう一度ためしてね');
    // 利用回数: ぜんぶそろった（最後の2枚を確定させた端末だけ）
    if (ok && over) window.RoomkStats?.count('room-finish');
    flushPending();
  }

  function flushPending() {
    if (net.pending == null || net.busy || net.anim) return;
    const p = net.pending;
    net.pending = null;
    const g = L.gameOf(net.room);
    if (!g || net.room.status !== S.PLAYING || g.id !== p.id) return;
    if (!L.canAct(net.room, currentUid(), net.nickname, net.role)) return;
    // 番が同じかは、書き込みの中で確かめる（roomFlip の expect）
    roomFlip(p.i, { id: p.id, turn: p.turn });
  }

  /* ── ホストの操作 ── */
  async function hostTransaction(update, failMessage) {
    // 処理中の二度押しは何もしない（失敗の通知も出さない）
    if (net.role !== 'host' || net.busy || !net.roomRef) return null;
    net.busy = true;
    const uid = currentUid();
    try {
      const result = await net.roomRef.transaction((room) => {
        if (!room || room.hostUid !== uid || isExpired(room)) return;
        return update(room) || undefined;
      });
      return result.committed;
    } catch (error) {
      console.warn('[shinkei-suijaku] host action failed', error);
      if (failMessage) toast(failMessage);
      return null;
    } finally {
      net.busy = false;
      if (net.room && net.roomRef) renderRoom(net.room);
      flushPending();
    }
  }

  // めくる番の人がいない（退出・切断）まま少し待っても戻らなければ、次の人へとばす
  function hostWatchAbsent(room) {
    const g = L.gameOf(room);
    const actor = g && room.status === S.PLAYING ? L.actorOf(g) : null;
    const key = actor != null && !L.present(room, g, actor) ? g.id + ':' + L.flipNoOf(g) + ':' + L.turnOf(g) : null;
    if (key === net.skipKey) return;
    clearTimeout(net.skipTimer);
    net.skipTimer = null;
    net.skipKey = key;
    if (!key) return;
    net.skipTimer = setTimeout(async () => {
      net.skipTimer = null;
      if (net.skipKey !== key) return;
      const ok = await hostTransaction((rm) => {
        const gg = L.gameOf(rm);
        if (!gg || gg.id + ':' + L.flipNoOf(gg) + ':' + L.turnOf(gg) !== key) return;
        return L.skipAbsent(rm);
      }, '');
      // 進めなかったら（処理中など）、少し待ってもう一度見る（ルームが変わらなくても止まらないように）
      if (!ok && net.skipKey === key) {
        net.skipKey = null;
        clearTimeout(net.skipTimer);
        net.skipTimer = setTimeout(() => { net.skipTimer = null; if (net.room && net.role === 'host') hostWatchAbsent(net.room); }, 1000);
      }
    }, ABSENT_GRACE_MS);
  }

  async function setHostPlays(value) {
    const ok = await hostTransaction((room) => {
      if (room.status === S.PLAYING) return;
      if (value && room.hostPlays === false && L.playingNames(room).length >= L.MAX_PLAYERS) return;
      return { ...room, hostPlays: value };
    }, '設定を変えられませんでした。もう一度ためしてね');
    if (!ok && net.room) renderRoom(net.room);
  }

  async function setLevel(value) {
    const ok = await hostTransaction((room) => {
      if (room.status === S.PLAYING) return;
      return { ...room, level: levelOf(value).id };
    }, '設定を変えられませんでした。もう一度ためしてね');
    if (!ok && net.room) renderRoom(net.room);
  }

  async function shuffleOrder() {
    const seed = L.randomSeed();
    await hostTransaction((room) => L.shuffleSeats(room, seed) || undefined, '順番を変えられませんでした。もう一度ためしてね');
  }

  async function addProxy() {
    const name = $('proxyName').value.trim();
    const error = L.validNickname(name);
    if (error) {
      setError('proxyError', error);
      return;
    }
    setError('proxyError', '');
    let reason = '';
    const ok = await hostTransaction((room) => {
      reason = '';
      if (room.status === S.PLAYING) { reason = 'はじめる前だけ足せるよ'; return; }
      if (room.players?.[name] || room.proxies?.[name] || name === room.host) { reason = '「' + name + '」はもういるよ'; return; }
      if (L.playingNames(room).length >= L.MAX_PLAYERS) { reason = '遊べるのは' + L.MAX_PLAYERS + '人までだよ'; return; }
      if (L.proxyNames(room).length >= L.MAX_PROXIES) { reason = '端末のない人は' + L.MAX_PROXIES + '人まで足せるよ'; return; }
      return { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
    }, '足せませんでした。もう一度ためしてね');
    // 待っている間に次の名前を打ちはじめていたら、消さない
    if (ok && $('proxyName').value.trim() === name) $('proxyName').value = '';
    else if (ok === false) setError('proxyError', reason || '足せませんでした。もう一度ためしてね');
  }

  async function removeProxy(name) {
    await hostTransaction((room) => {
      if (room.status === S.PLAYING || !room.proxies?.[name]) return;
      const proxies = { ...room.proxies };
      delete proxies[name];
      return { ...room, proxies: Object.keys(proxies).length ? proxies : null };
    }, '外せませんでした。もう一度ためしてね');
  }

  // はじめる（待合室から）・もう一回（おわりのあと。はじめの人を順に交代）
  async function startRoomGame(again) {
    const seed = L.randomSeed();
    let players = 0;
    const ok = await hostTransaction((room) => {
      if (room.status !== (again ? S.OVER : S.WAITING)) return;
      const level = levelOf(room.level);
      const prev = L.gameOf(room);
      const first = again && prev ? (Number(prev.first) || 0) + 1 : 0;
      const next = L.startGame(room, level, keysFor(level), seed, first);
      players = next ? L.orderOf(next.game).length : 0;
      return next;
    }, 'はじめられませんでした。もう一度ためしてね');
    if (ok) {
      if (again) window.RoomkStats?.count('room-again');
      window.RoomkStats?.count('room-start');
      window.RoomkStats?.count('room-players-' + players);
    } else if (ok === false) {
      toast(again ? '始められませんでした。遊ぶ人が' + L.MIN_PLAYERS + '人いるか確かめてね' : 'はじめられませんでした。参加している人を確かめてね');
    }
  }

  async function backToWaiting(fromOver) {
    const gameId = L.gameOf(net.room)?.id;
    if (gameId == null) return;
    if (!fromOver && !window.confirm('このゲームをやめて、待合室にもどりますか？')) return;
    await hostTransaction((room) => {
      if (fromOver && room.status !== S.OVER) return;
      return L.backToWaiting(room, gameId);
    }, 'もどれませんでした。もう一度ためしてね');
  }

  /* ════════════ ボタンと入口 ════════════ */
  const inRoom = () => !!net.roomRef;

  function submitOnEnter(input, handler) {
    input.addEventListener('keydown', (event) => {
      // 日本語入力の確定の Enter では送らない（Safari は確定の Enter を isComposing=false・keyCode 229 で届ける）
      if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) handler();
    });
  }

  $('board').addEventListener('click', (e) => {
    const b = e.target.closest('.ss-card');
    if (!b) return;
    const i = Number(b.dataset.i);
    if (inRoom()) {
      if (L.canAct(net.room, currentUid(), net.nickname, net.role)) roomFlip(i);
      return;
    }
    if (!game || cur().cpu) return;
    flip(i);
  });
  $('btn-start').addEventListener('click', () => startGame(0));
  $('btn-again').addEventListener('click', () => {
    if (inRoom()) { startRoomGame(true); return; }
    window.RoomkStats?.count('again');
    startGame(game.first + 1);   // はじめの人を順に交代
  });
  $('btn-back').addEventListener('click', () => (inRoom() ? backToWaiting(true) : toSetup()));
  $('btn-quit').addEventListener('click', () => {
    if (inRoom()) { backToWaiting(false); return; }
    if (game && !game.over && game.players.some((p) => p.pairs > 0 || game.open.length)) {
      if (!window.confirm('この対戦をやめて、設定にもどる？')) return;
    }
    toSetup();
  });
  sp.addEventListener('change', applyCols);

  $('btnGoLocal').addEventListener('click', () => { showScreen('screen-local'); renderSetup(); });
  $('btnLocalBack').addEventListener('click', () => showScreen('screen-top'));
  $('btnGoCreate').addEventListener('click', () => {
    setError('createError', '');
    showScreen('screen-create');
    $('hostName').focus({ preventScroll: true });
  });
  $('btnGoJoin').addEventListener('click', () => {
    setError('joinError', '');
    $('joinLinkHint').hidden = true;
    showScreen('screen-join');
  });
  $('btnCreateBack').addEventListener('click', () => showScreen('screen-top'));
  $('btnJoinBack').addEventListener('click', () => showScreen('screen-top'));
  $('btnCreateRoom').addEventListener('click', createRoom);
  $('btnJoinRoom').addEventListener('click', joinRoom);
  submitOnEnter($('hostName'), createRoom);
  submitOnEnter($('guestName'), joinRoom);
  submitOnEnter($('joinCode'), joinRoom);
  $('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(net.roomCode, event.currentTarget));
  $('btnCopyLink').addEventListener('click', (event) => {
    if (!net.roomCode || !ROOM_CODE_PATTERN.test(net.roomCode)) {
      toast('ルームコードがありません');
      return;
    }
    RoomkRTDB.copyRoomLink(net.roomCode, event.currentTarget);
  });
  // 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
  $('btnShowQr').addEventListener('click', () => {
    if (!net.roomCode || !ROOM_CODE_PATTERN.test(net.roomCode)) {
      toast('ルームコードがありません');
      return;
    }
    RoomkQR.show(net.roomCode);
  });
  $('btnLeave').addEventListener('click', leaveRoom);
  $('btnOverlayLeave').addEventListener('click', leaveRoom);
  $('hostPlays').addEventListener('change', (event) => setHostPlays(event.currentTarget.checked));
  $('btnShuffleOrder').addEventListener('click', shuffleOrder);
  $('btnAddProxy').addEventListener('click', addProxy);
  submitOnEnter($('proxyName'), addProxy);
  $('btnStartGame').addEventListener('click', () => startRoomGame(false));

  // 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう（コード欄は直せるように残す）
  function openJoinFromLink(code) {
    setError('joinError', '');
    $('joinCode').value = code;
    $('joinLinkHint').hidden = false;
    showScreen('screen-join');
    $('guestName').focus({ preventScroll: true });
  }

  // 再読み込みなどで、保存した記録から同じルームへ戻る
  function resumeFromSession() {
    if (!loadSession()) return;
    tryReconnect().then((reconnected) => {
      if (!reconnected && !net.roomRef) clearSession();
    });
  }

  renderSetup();
  showScreen('screen-top');
  const roomParam = new URLSearchParams(location.search).get('room');
  if (roomParam !== null) {
    // 参加用のリンク（?room=コード）の入口。コードはつないだときにアドレスから外す（connectToRoom）
    const linkCode = normalizeRoomCode(roomParam);
    const saved = loadSession();
    if (!ROOM_CODE_PATTERN.test(linkCode)) {
      toast('ルームコードが正しくないよ');
      history.replaceState(null, '', location.pathname);
      resumeFromSession();
    } else if (saved && saved.roomCode === linkCode) {
      // 同じルームの記録が残っていれば、名前を入れなおさずに戻る。戻れなければ参加画面へ
      tryReconnect().then((reconnected) => {
        if (reconnected || net.roomRef) return;
        clearSession();
        openJoinFromLink(linkCode);
      });
    } else {
      // 別のルームの記録が残っていても、ひらいたリンクのルームを優先する
      if (saved) clearSession();
      openJoinFromLink(linkCode);
    }
  } else {
    resumeFromSession();
  }
})();
