/* ちゃりんバトン
   ・ルーム: Realtime Database。対戦する2人がそれぞれの端末で答え、ほかの参加者は観戦する
   ・1台の画面: このタブだけで遊ぶ（答えた金額を入れるのは画面を動かす人。通信しない）
   ・いっしょに数える: 時間なし・勝ち負けなし（通信しない）
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない
   ルール（小銭の作り方・持ち時間・番の進め方）は engine.js。 */
const E = window.CharinEngine;

const MAX_GUESTS = 20;
const MAX_PROXIES = 4;       // 端末なしの参加者（ホストが代わりに金額を入れる）
const SEATS = ['a', 'b'];    // 1人目・2人目（対決のルールでは 0・1）
const SEAT_LABEL = ['1人目', '2人目'];
const TIMES = [30, 45, 60, 90];
const MAXES = [4, 5, 6, 8];
const ARRANGES = { scatter: 'ばらばら', sort: 'そろえる（大きい順）' };
const FIRSTS = { random: 'くじで決める', a: '1人目から', b: '2人目から' };
const KIND_LABEL = { all: 'ぜんぶ（6種類）', three: '1・10・100円だけ' };
const DEFAULT_SET = { time: { a: 45, b: 45 }, kinds: { a: 'all', b: 'all' }, maxCoins: 5, arrange: 'scatter', first: 'random' };
const PHASES = ['ready', 'play', 'reveal', 'pass', 'over'];
const LOW_MS = 10000;        // 番の人の残りが10秒を切ったら札を赤くする（音は鳴らさない）
const CLOCK_MS = 200;
const RETRY_MS = 700;        // 時間で進める書き込みが通らなかったときに、もう一度ためすまで
const NG_SHOW_MS = 1600;
const INPUT_MAX = 5;

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'charinbaton_rooms';
const SESSION_KEY = 'charinbaton_session';
const LOCAL_KEY = 'charinbaton_local';
const PAD_KEY = 'charinbaton_pad';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play' };
const DEFAULT_TITLE = document.title;
// マウスのある端末（PC）。キーボードで打てるので、画面の数字ボタンははじめは出さない
const PC_MQ = window.matchMedia('(hover: hover) and (pointer: fine)');

// 硬貨の見た目（本物の図柄は描かない。色・穴・大きさ・金額の数字だけ）
const LOOK = {
  1: { fill: '#E6E9EC', edge: '#8E98A1', ink: '#1A1A1A' },
  5: { fill: '#D8B24A', edge: '#94701A', ink: '#1A1A1A' },
  10: { fill: '#B86A3E', edge: '#73391A', ink: '#FFFFFF' },
  50: { fill: '#CFD5DA', edge: '#7D8790', ink: '#1A1A1A' },
  100: { fill: '#BFC6CD', edge: '#6F7983', ink: '#1A1A1A' },
  500: { fill: '#D9BC55', edge: '#8F6F16', ink: '#1A1A1A', rim: '#ECDDA6' },
};
const TRAY_BG = '#24506F';

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'（みんなにみせる画面）| 'local'（1台の画面）| 'count'（いっしょに数える）
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  joinedAt: null,
  currentScreen: null,
  timerInterval: null,
  orphanTimer: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  answering: false,    // 正解・パスを送っている途中（二度押しよけ。ほかの操作の busy とは分ける）
  watchTimer: null,
  // 端末の中だけで持つ状態
  local: null,         // 1台の画面の対決 { duel, savedAt }
  localSet: null,      // 1台の画面の準備中の設定
  localNames: ['', ''],
  input: '',           // 入れている途中の金額（ほかの端末には送らない）
  ngUntil: 0,
  renderSig: null,
  tickKey: null,       // 時間で進める書き込みを、同じ場面で二度送らないための印
  savedAt: 0,
  clockTimer: null,
  showPad: false,
  count: { n: 3, kinds: 'all', arrange: 'scatter', problem: null, shown: false },
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  // かくれる画面の入力欄にカーソルが残ると、数字キーがそちらに入ってしまうので外す
  const act = document.activeElement;
  if (act && act !== document.body && !act.closest('#screen-' + id)) act.blur();
  document.querySelectorAll('.cb-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  const inApp = id === 'waiting' || id === 'game';
  $('appBar').hidden = !inApp;
  $('roomBar').hidden = !inApp || !state.roomRef;
  window.scrollTo(0, 0);
}

function setError(id, message) {
  const node = $(id);
  node.textContent = message || '';
  node.hidden = !message;
}

function toast(message, error = true) {
  RoomkRTDB.showToast(message, error);
}

function validNickname(value) {
  if (!value) return '名前を入れてね';
  if (value.length > 8) return '名前は8文字までだよ';
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '名前に使えない文字があるよ';
  return '';
}

function currentUid() {
  return firebase.auth().currentUser?.uid || null;
}

function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

function makeElement(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}

function msIcon(name, className) {
  const node = makeElement('span', 'material-symbols-rounded' + (className ? ' ' + className : ''), name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

const yen = (n) => Number(n).toLocaleString('ja-JP') + '円';
const secs = (ms) => Math.ceil(ms / 1000);
const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/* ── 設定 ── */
function normSet(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const per = (obj, ok, fallback) => {
    const o = obj && typeof obj === 'object' ? obj : {};
    return { a: ok(o.a) ? o.a : fallback, b: ok(o.b) ? o.b : fallback };
  };
  return {
    time: per(s.time, (v) => TIMES.includes(v), DEFAULT_SET.time.a),
    kinds: per(s.kinds, (v) => !!E.KINDS[v], DEFAULT_SET.kinds.a),
    maxCoins: MAXES.includes(s.maxCoins) ? s.maxCoins : DEFAULT_SET.maxCoins,
    arrange: ARRANGES[s.arrange] ? s.arrange : DEFAULT_SET.arrange,
    first: FIRSTS[s.first] ? s.first : DEFAULT_SET.first,
  };
}

function settingSummary(set) {
  return '小銭は2枚から' + set.maxCoins + '枚まで増える・ならべ方は' + ARRANGES[set.arrange] + '・' + FIRSTS[set.first].replace('決める', '決めた人から');
}

// 対決のルールに渡す設定。first は 0（1人目から）か 1（2人目から）
function duelSettings(set, names, first) {
  return {
    players: SEATS.map((k, i) => ({ name: names[i], time: set.time[k], kinds: set.kinds[k] })),
    maxCoins: set.maxCoins,
    arrange: set.arrange,
    first: first === 1 ? 1 : 0,
  };
}
const firstOf = (set) => (set.first === 'random' ? (Math.random() < 0.5 ? 0 : 1) : set.first === 'b' ? 1 : 0);

function selectField(labelText, id, options, value, onChange) {
  const wrap = makeElement('div', 'cb-field');
  const lab = makeElement('label', 'form-label', labelText);
  lab.htmlFor = id;
  const sel = makeElement('select', 'form-input cb-select');
  sel.id = id;
  options.forEach(([v, t]) => {
    const op = makeElement('option', '', t);
    op.value = String(v);
    sel.append(op);
  });
  sel.value = String(value);
  if (onChange) sel.addEventListener('change', () => onChange(sel.value));
  wrap.append(lab, sel);
  return wrap;
}
const timeOpts = TIMES.map((t) => [t, t + '秒']);
const kindOpts = Object.keys(E.KINDS).map((k) => [k, KIND_LABEL[k]]);

// 対戦する人の札（1台の画面の準備・待合室）。head(i) が名前の欄（入力・選択・表示）を返す
function buildSeats(box, set, head, editable, onChange) {
  box.replaceChildren(...SEATS.map((k, i) => {
    const card = makeElement('fieldset', 'cb-seat');
    card.append(makeElement('legend', 'cb-seat__title', SEAT_LABEL[i]));
    card.append(head(i));
    if (editable) {
      card.append(selectField('持ち時間', box.id + '-time-' + k, timeOpts, set.time[k], (v) => { set.time[k] = Number(v); onChange(['time', k], Number(v)); }));
      card.append(selectField('小銭の種類', box.id + '-kinds-' + k, kindOpts, set.kinds[k], (v) => { set.kinds[k] = v; onChange(['kinds', k], v); }));
    } else {
      card.append(makeElement('p', 'cb-seat__sub', '持ち時間 ' + set.time[k] + '秒・小銭は' + KIND_LABEL[set.kinds[k]]));
    }
    return card;
  }));
}

function buildCommon(box, set, onChange) {
  const grid = makeElement('div', 'cb-common');
  grid.append(
    selectField('小銭の枚数', box.id + '-max', MAXES.map((m) => [m, m + '枚まで']), set.maxCoins, (v) => { set.maxCoins = Number(v); onChange(['maxCoins'], Number(v)); }),
    selectField('ならべ方', box.id + '-arrange', Object.keys(ARRANGES).map((k) => [k, ARRANGES[k]]), set.arrange, (v) => { set.arrange = v; onChange(['arrange'], v); }),
    selectField('先に答える人', box.id + '-first', Object.keys(FIRSTS).map((k) => [k, FIRSTS[k]]), set.first, (v) => { set.first = v; onChange(['first'], v); }),
  );
  box.replaceChildren(grid, makeElement('p', 'cb-note', '小銭は2枚からはじまり、正解2回ごとに1枚ずつ増える。持ち時間と小銭の種類は、人ごとに変えられる（ハンデ）。'));
}

/* ── 硬貨のトレー（SVG） ── */
const SVG_NS = $('svgNs').namespaceURI;
function svgEl(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.keys(attrs || {}).forEach((k) => node.setAttribute(k, attrs[k]));
  return node;
}

function drawTray(box, coins, hide) {
  const svg = svgEl('svg', { viewBox: '0 0 ' + E.TRAY.w + ' ' + E.TRAY.h, role: 'img', class: 'cb-tray__svg' });
  svg.append(svgEl('rect', { x: 0, y: 0, width: E.TRAY.w, height: E.TRAY.h, rx: 6, fill: TRAY_BG }));
  if (coins && !hide) {
    svg.setAttribute('aria-label', '小銭が' + coins.length + '枚');
    coins.forEach((c) => svg.append(drawCoin(c)));
  } else {
    svg.setAttribute('aria-label', '小銭はかくれています');
  }
  box.replaceChildren(svg);
}

function drawCoin(c) {
  const info = E.COINS[c.v];
  const look = LOOK[c.v];
  const r = info.d / 2;
  const g = svgEl('g', { transform: 'translate(' + c.x + ' ' + c.y + ') rotate(' + c.rot + ')' });
  g.append(svgEl('circle', { r, fill: look.fill, stroke: look.edge, 'stroke-width': 0.9 }));
  if (look.rim) g.append(svgEl('circle', { r: r * 0.74, fill: 'none', stroke: look.rim, 'stroke-width': r * 0.2 }));
  g.append(svgEl('circle', { r: r * 0.86, fill: 'none', stroke: look.edge, 'stroke-width': 0.4, opacity: 0.5 }));
  const label = String(c.v);
  let fs;
  let ty = 0;
  if (info.hole) {
    g.append(svgEl('circle', { r: r * 0.2, fill: TRAY_BG, stroke: look.edge, 'stroke-width': 0.5 }));
    fs = r * 0.62;
    ty = r * 0.56;
  } else {
    fs = label.length >= 3 ? r * 0.68 : r * 0.9;
  }
  const t = svgEl('text', { x: 0, y: ty, 'font-size': fs, 'font-weight': 700, fill: look.ink, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-family': '"Noto Sans JP", sans-serif' });
  t.textContent = label;
  g.append(t);
  return g;
}

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}
// 在室している人を参加順に（ホストもふくむ）
const memberNames = (room) => byJoined(Object.entries(room?.players || {}));
const guestNames = (room) => memberNames(room).filter((name) => !room.players[name].isHost);
// 端末なしの参加者（ホストが代わりに入れる）。切断しない
const proxyNames = (room) => byJoined(Object.entries(room?.proxies || {}));
// 待合室で席に選べる人（在室の人と、端末なしの参加者）
// 在室の人は匿名IDがあるときだけ（壊れた在室で対決を作らない）
const seatable = (room, name) => typeof name === 'string' && ((typeof room?.players?.[name]?.uid === 'string' && !!room.players[name].uid) || !!room?.proxies?.[name]);

function seatsOf(room) {
  const s = room?.seats || {};
  return { a: typeof s.a === 'string' ? s.a : null, b: typeof s.b === 'string' ? s.b : null };
}

function normCoins(list) {
  return asList(list)
    .filter((c) => c && E.COINS[c.v] && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)))
    .map((c) => ({ v: Number(c.v), x: Number(c.x), y: Number(c.y), rot: Number(c.rot) || 0 }));
}

// 対決の状態を読む。Realtime Database は空の配列と null を消すので、ここで埋めなおす。壊れた値は null
function normDuel(d) {
  if (!d || typeof d !== 'object') return null;
  const players = asList(d.settings?.players);
  const coins = normCoins(d.problem?.coins);
  if (players.length !== 2 || !coins.length) return null;
  // 進行に要る値が壊れていたら読み飛ばす（補って続けると、すぐ時間切れにして書き戻すことがあるため）
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  const rem = asList(d.rem);
  if (!PHASES.includes(d.phase) || (d.turn !== 0 && d.turn !== 1)) return null;
  if (rem.length !== 2 || !rem.every((v) => fin(v) && v >= 0)) return null;
  if (!fin(d.at) || !fin(d.phaseEnd) || !fin(d.rev) || d.rev < 0) return null;
  const pair = (v) => { const a = asList(v); return [num(a[0], 0), num(a[1], 0)]; };
  const values = coins.map((c) => c.v);
  return {
    settings: {
      players: players.map((p) => ({ name: String(p?.name || ''), time: TIMES.includes(p?.time) ? p.time : 45, kinds: E.KINDS[p?.kinds] ? p.kinds : 'all' })),
      maxCoins: MAXES.includes(d.settings.maxCoins) ? d.settings.maxCoins : 5,
      arrange: d.settings.arrange === 'sort' ? 'sort' : 'scatter',
      first: d.settings.first === 1 ? 1 : 0,
    },
    phase: d.phase,
    turn: d.turn,
    rem: [rem[0], rem[1]],
    at: num(d.at, 0),
    phaseEnd: num(d.phaseEnd, 0),
    correct: pair(d.correct),
    problem: { coins, key: E.keyOf(values), total: E.totalOf(values) },
    history: asList(d.history)
      .map((h) => ({ coins: normCoins(h?.coins), how: ['ok', 'pass', 'timeout'].includes(h?.how) ? h.how : 'ok' }))
      .filter((h) => h.coins.length)
      .map((h) => ({ coins: h.coins, total: E.totalOf(h.coins.map((c) => c.v)), how: h.how })),
    // 正解の帯の金額は、いまの小銭から計算しなおす
    last: d.last && typeof d.last === 'object' ? { total: E.totalOf(values), by: d.last.by === 1 ? 1 : 0 } : null,
    winner: d.winner === 0 || d.winner === 1 ? d.winner : null,
    rev: num(d.rev, 0),
    startedAt: num(d.startedAt, 0),
  };
}

// 対決を読む。壊れた値は読み飛ばす
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const duel = normDuel(g.duel);
  if (!duel) return null;
  const seats = g.seats || {};
  const uids = g.uids || {};
  const proxy = g.proxy || {};
  return {
    id: Number(g.id) || 0,
    seats: { a: typeof seats.a === 'string' ? seats.a : null, b: typeof seats.b === 'string' ? seats.b : null },
    uids: { a: uids.a || null, b: uids.b || null },
    proxy: { a: proxy.a === true, b: proxy.b === true },
    duel,
    // 一度でもおわったか（finish を1回の対決に1回だけ数えるため）
    ended: g.ended === true,
  };
}

// その席の人が、いまルームにいるか（端末なしの参加者はいつもいる）
function seatPresent(room, game, i) {
  const k = SEATS[i];
  return game.proxy[k] || !!room?.players?.[game.seats[k]];
}

// その席の番に、この端末が答えてよいか。ホストは、端末なしの人と通信が切れた人の代わりに入れられる
function mayAnswer(room, game, i, uid, nickname, role) {
  if (role !== 'host' && role !== 'guest') return false;
  const k = SEATS[i];
  const isHost = role === 'host' && room.hostUid === uid;
  if (game.proxy[k]) return isHost;
  if (game.seats[k] === nickname && game.uids[k] === uid) return true;
  return isHost && !room.players?.[game.seats[k]];
}

// 時間で進める書き込み（3・2・1 のおわり・正解の帯のおわり・パスのおわり・時間切れ）をしてよい端末
function mayAdvance(room, game, uid, nickname, role) {
  if (role === 'host') return room.hostUid === uid;
  if (role !== 'guest') return false;
  return SEATS.some((k) => !game.proxy[k] && game.seats[k] === nickname && game.uids[k] === uid);
}

// 対決の席の名前の持ち主（匿名ID）。対決の間は、その名前を同じ人だけが使える
function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAY) return false;
  return SEATS.some((k) => game.seats[k] === name && (game.proxy[k] || (game.uids[k] && game.uids[k] !== uid)));
}

// 時計の「いま」。ホストが切れている間は、切れた時刻で止める（戻ると 3・2・1 からつづける）
function roomNow(room) {
  const now = RoomkRTDB.now();
  if (room && room.hostConnected === false) return RoomkRTDB.getHostDisconnectedAt(room) ?? now;
  return now;
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
    console.warn('[charin-baton] expired room cleanup failed', error);
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

async function waitAuth() {
  try {
    await authReady;
    return true;
  } catch {
    toast('うまくつながらなかったよ。ページを読み直してね');
    return false;
  }
}

/* ── 再接続の記録 ── */
function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      role: state.role,
      nickname: state.nickname,
      roomCode: state.roomCode,
      uid: currentUid(),
      joinedAt: state.joinedAt,
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
function resetBoxes() {
  ['tray', 'answerBox', 'resultBox', 'tools', 'card0', 'card1', 'lobbySeats', 'lobbyCommon'].forEach((id) => $(id).replaceChildren());
  $('lobbyCommon')._key = null;
  state.input = '';
  state.ngUntil = 0;
  state.renderSig = null;
  state.tickKey = null;
  if ($('zoom').open) $('zoom').close();
}

function startClock() {
  clearInterval(state.clockTimer);
  state.tickKey = null;
  state.clockTimer = setInterval(updateClock, CLOCK_MS);
}

function stopClock() {
  clearInterval(state.clockTimer);
  state.clockTimer = null;
  state.tickKey = null;
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  stopClock();
  clearTimeout(state.orphanTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef && (state.role === 'host' || state.role === 'guest')) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  clearTimeout(state.watchTimer);
  Object.assign(state, {
    role: null,
    nickname: null,
    roomCode: null,
    roomRef: null,
    room: null,
    joinedAt: null,
    timerInterval: null,
    orphanTimer: null,
    connectedRef: null,
    connectedCallback: null,
    roomCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    watchTimer: null,
  });
  clearSession();
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('btnOpenWatch').hidden = true;
  $('barMe').hidden = true;
  $('barMe').textContent = '';
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('top');
  if (message) toast(message, isError);
}

function connectToRoom(role, nickname, code, ref, joinedAt) {
  // 念のため、前のルームの購読・タイマーが残っていたら片付けてからつなぐ
  if (state.roomRef) cleanupRoom();
  state.role = role;
  state.nickname = nickname;
  state.roomCode = code;
  state.roomRef = ref;
  state.joinedAt = Number(joinedAt) || RoomkRTDB.now();
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  $('btnOpenWatch').hidden = role !== 'host';
  $('hostOffText').textContent = 'しばらく待っても戻らないときは退出してね。';
  $('btnOverlayLeave').textContent = '退出する';
  saveSession();
  // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  state.roomCallback = (snap) => {
    // 自分で退出・ルームを閉じている途中の変化は、退出処理の側で片付ける
    if (state.roomRef !== ref || state.leaving) return;
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
    state.room = room;
    handleRoom(room);
  };
  ref.on('value', state.roomCallback, (error) => {
    console.warn('[charin-baton] room listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });

  state.connectedRef = db.ref('.info/connected');
  state.connectedCallback = (snap) => {
    state.isConnected = snap.val() === true;
    if (state.isConnected && state.roomRef === ref) {
      state.presenceDirty = true;
      ensurePresence(true);
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
  state.timerInterval = setInterval(tickRoom, 1000);
  startClock();
}

function tickRoom() {
  if (state.room && needsPresence(state.room)) ensurePresence();
}

// 接続中なのに、ルームの上では切断・不在になっている
function needsPresence(room) {
  if (state.role === 'host') return room.hostConnected === false;
  if (state.role === 'guest') return !room.players?.[state.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
// 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
async function ensurePresence(force = false) {
  const ref = state.roomRef;
  if (!ref || state.leaving || !state.isConnected || !state.room) return;
  if (!force && Date.now() - state.presenceAt < PRESENCE_RETRY_MS) return;
  state.presenceDirty = false;
  state.presenceAt = Date.now();
  const role = state.role;
  const nickname = state.nickname;
  const joinedAt = state.joinedAt;
  const uid = currentUid();
  try {
    if (role === 'host') {
      await ref.onDisconnect().update({
        hostConnected: false,
        hostDisconnectedAt: serverTimestamp(),
      });
      let finished = false;
      const result = await ref.transaction((room) => {
        finished = false;
        if (!room || room.hostUid !== uid || isExpired(room)) return;
        if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
        const next = { ...room, hostConnected: true, hostDisconnectedAt: null };
        // ホストが切れている間は時計を止めていたので、止めた時刻の残りを残して 3・2・1 からつづける
        const game = gameOf(room);
        if (room.status === STATUS.PLAY && game && game.duel.phase !== 'over') {
          const now = RoomkRTDB.now();
          const frozenAt = room.hostConnected === false ? (RoomkRTDB.getHostDisconnectedAt(room) ?? now) : now;
          const duel = E.resume(game.duel, frozenAt, now, Math.random);
          finished = duel.phase === 'over' && !game.ended;
          next.game = { ...room.game, duel, ended: game.ended || duel.phase === 'over' };
        }
        return next;
      });
      if (result.committed && finished) window.RoomkStats?.count('finish');
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      let full = false;
      let taken = false;
      await ref.transaction((room) => {
        full = false;
        taken = false;
        if (!room || isExpired(room) || room.players?.[nickname]) return;
        if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) {
          taken = true;
          return;
        }
        // 戻るときは参加したときの順番のまま。対決中の席の人は人数の上限を見ない
        const game = gameOf(room);
        const seated = room.status === STATUS.PLAY && game && SEATS.some((k) => game.seats[k] === nickname);
        if (!seated && guestNames(room).length >= MAX_GUESTS) {
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
      if ((full || taken) && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(full ? 'このルームはいっぱいだよ' : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
      }
    }
  } catch (error) {
    console.warn('[charin-baton] presence recovery failed', error);
    // 定期的な確認の失敗は通知しない（接続し直したときだけ知らせる）
    if (force) toast('再接続に失敗しました。ページを読み直してね');
  }
}

async function createRoom() {
  if (state.busy || state.roomRef) return;
  const nickname = $('hostName').value.trim();
  const error = validNickname(nickname);
  if (error) {
    setError('createError', error);
    return;
  }
  setError('createError', '');
  // 認証待ちの間の二度押しでルームが2つできないよう、待つ前にロックする
  state.busy = true;
  $('btnCreateRoom').disabled = true;
  try {
    if (!await waitAuth()) return;
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = RoomkRTDB.generateRoomCode();
      const ref = db.ref(DB_PREFIX + '/' + code);
      const result = await transactRetry(ref, (room) => {
        // やり直しのとき、前の送信で自分が作ったルームが届いていたら、そのまま使う
        if (room) return room.hostUid === uid && room.players?.[nickname]?.joinedAt === joinedAt ? room : undefined;
        return {
          status: STATUS.WAITING,
          host: nickname,
          hostUid: uid,
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          lastGameId: 0,
          set: JSON.parse(JSON.stringify(DEFAULT_SET)),
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
    console.warn('[charin-baton] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
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
  if (state.busy || state.roomRef) return;
  const nickname = $('guestName').value.trim();
  const code = normalizeRoomCode($('joinCode').value);
  const error = validNickname(nickname);
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
  state.busy = true;
  $('btnJoinRoom').disabled = true;
  let release = null;
  try {
    if (!await waitAuth()) return;
    const ref = db.ref(DB_PREFIX + '/' + code);
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
      const game = gameOf(room);
      const seated = room.status === STATUS.PLAY && game && SEATS.some((k) => game.seats[k] === nickname);
      if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
      else if (!seated && guestNames(room).length >= MAX_GUESTS) { reason = '満員'; return; }
      const next = {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt },
        },
      };
      // 待合室では、空いている席に入った順で入る（ホストは自分で選んだときだけ席に入る）
      if (room.status === STATUS.WAITING && !mine) {
        const seats = seatsOf(room);
        const k = SEATS.find((s) => !seats[s]);
        if (k && !SEATS.some((s) => seats[s] === nickname)) next.seats = { ...seats, [k]: nickname };
      }
      return next;
    });
    if (!result.committed) {
      const messages = {
        '見つからない': 'ルームが見つからないよ。コードを確かめてね',
        '終了': 'このルームは終わったみたい',
        '名前': 'その名前は使われているよ。少し変えてみてね',
        '満員': 'このルームはいっぱいだよ',
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[charin-baton] join failed', err);
    setError('joinError', '接続できませんでした。もう一度ためしてね');
  } finally {
    release?.();
    state.busy = false;
    $('btnJoinRoom').disabled = false;
  }
}

async function tryReconnect() {
  const saved = loadSession();
  if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
  if (!ROOM_CODE_PATTERN.test(saved.roomCode) || validNickname(saved.nickname)) return false;
  if (state.busy || state.roomRef) return false;
  // 復帰の途中で「ルームを作る／参加する」が重ならないようにする
  state.busy = true;
  const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoLocal', 'btnGoCount', 'btnGoWatch'];
  tops.forEach((id) => { $(id).disabled = true; });
  let release = null;
  try {
    if (!await waitAuth()) return false;
    const uid = currentUid();
    if (!uid || uid !== saved.uid) return false;
    const ref = db.ref(DB_PREFIX + '/' + saved.roomCode);
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
    if (state.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
    return true;
  } catch (error) {
    console.warn('[charin-baton] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    tops.forEach((id) => { $(id).disabled = false; });
  }
}

async function leaveRoom() {
  if (state.role === 'spectator') {
    leaveWatch();
    return;
  }
  if (state.busy || !state.roomRef) return;
  const ref = state.roomRef;
  const role = state.role;
  const nickname = state.nickname;
  const uid = currentUid();
  if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
  state.busy = true;
  state.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す。待合室なら席も空ける（対決中の席は残し、ホストが代わりに入れられる）
      await ref.transaction((room) => {
        if (!room) return;
        const mine = room.players?.[nickname];
        // ほかの匿名IDの人がその名前で在室しているときは触らない（在室が一瞬消えている間の退出は、席だけ空ける）
        if (mine && mine.uid !== uid) return;
        const players = { ...(room.players || {}) };
        delete players[nickname];
        const next = { ...room, players };
        if (room.status === STATUS.WAITING) {
          const seats = seatsOf(room);
          SEATS.forEach((k) => { if (seats[k] === nickname) seats[k] = null; });
          next.seats = seats;
        }
        return next;
      });
    }
  } catch (error) {
    console.warn('[charin-baton] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.leaving = false;
    state.busy = false;
    // 退出の前に取り消した切断予約を張り直す
    ensurePresence(true);
    if (state.room) handleRoom(state.room);
    return;
  }
  state.busy = false;
  leaveLocally('');
}

/* ── みんなにみせる画面（見るだけ） ── */
async function enterWatch(code, fromForm = false) {
  // 再接続・ルーム作成・参加と同時に進めない（同じ busy で排他する）
  if (state.busy || state.roomRef) return false;
  const fail = (message) => (fromForm ? setError('watchError', message) : toast(message));
  state.busy = true;
  $('btnWatchOpen').disabled = true;
  try {
    if (!await waitAuth()) return false;
    const ref = db.ref(DB_PREFIX + '/' + code);
    const room = (await ref.get()).val();
    if (state.roomRef) return false;
    if (!room) {
      fail('ルームが見つからないよ。コードを確かめてね');
      return false;
    }
    if (isExpired(room)) {
      fail('このルームは終わったみたい');
      return false;
    }
    connectWatch(code, ref);
    // 読み直しても同じ画面に戻れるよう、アドレスに残す
    history.replaceState(null, '', location.pathname + '?watch=' + code);
    return true;
  } catch (error) {
    console.warn('[charin-baton] watch failed', error);
    fail('接続できませんでした。もう一度ためしてね');
    return false;
  } finally {
    state.busy = false;
    $('btnWatchOpen').disabled = false;
  }
}

function connectWatch(code, ref) {
  state.role = 'spectator';
  startClock();
  // 共有するタブ・ウィンドウを選ぶときに見分けられるよう、題名と見出しを変える
  document.title = 'みんなにみせる画面 | ちゃりんバトン | room-K';
  document.body.classList.add('is-watch');
  $('watchBadge').hidden = false;
  state.roomCode = code;
  state.roomRef = ref;
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = 'トップへ戻る';
  $('btnOpenWatch').hidden = true;
  $('hostOffText').textContent = 'しばらく待っても戻らないときは、トップへ戻ってね。';
  $('btnOverlayLeave').textContent = 'トップへ戻る';
  state.roomCallback = (snap) => {
    if (state.roomRef !== ref) return;
    if (!snap.exists()) {
      endWatch('このルームは閉じられました');
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      endWatch('このルームは終わりました');
      return;
    }
    state.room = room;
    updateWatchOverlay(room);
    renderRoom(room);
  };
  ref.on('value', state.roomCallback, (error) => {
    console.warn('[charin-baton] watch listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });
}

// ホストが切断している間はオーバーレイを出し、期限切れになったら終わりの表示にする（ルームは消さない）
function updateWatchOverlay(room) {
  const off = room.hostConnected === false;
  $('hostOffOverlay').hidden = !off;
  clearTimeout(state.watchTimer);
  state.watchTimer = null;
  if (!off) return;
  const at = RoomkRTDB.getHostDisconnectedAt(room);
  if (at == null) return;
  const ref = state.roomRef;
  const delay = Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now()) + 500;
  state.watchTimer = setTimeout(() => {
    state.watchTimer = null;
    if (state.roomRef === ref && state.room && isExpired(state.room)) endWatch('このルームは終わりました');
  }, delay);
}

// 購読とタイマーを止めて、アドレスから watch を外す（ルームには触らない）
function stopWatch() {
  clearTimeout(state.watchTimer);
  stopClock();
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null });
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  document.title = DEFAULT_TITLE;
  document.body.classList.remove('is-watch');
  $('watchBadge').hidden = true;
  history.replaceState(null, '', location.pathname);
}

function endWatch(title) {
  stopWatch();
  $('watchEndTitle').textContent = title;
  showScreen('watch-end');
}

function leaveWatch() {
  stopWatch();
  showScreen('top');
}

/* ── ホストの操作 ── */
async function hostTransaction(update, failMessage, lock = true) {
  // 処理中の二度押しは何もしない（失敗の通知も出さない）
  if (state.role !== 'host' || !state.roomRef || (lock && state.busy)) return null;
  if (lock) state.busy = true;
  const uid = currentUid();
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      return update(room);
    });
    return result.committed;
  } catch (error) {
    console.warn('[charin-baton] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

// 席・設定は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない（どれも中で今の値から作りなおす）
async function setSeat(k, name) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    if (name && !seatable(room, name)) return;
    const seats = seatsOf(room);
    const other = k === 'a' ? 'b' : 'a';
    if (name && seats[other] === name) seats[other] = seats[k]; // 反対の席にいた人なら入れかえる
    seats[k] = name || null;
    return { ...room, seats };
  }, '席を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) { state.renderSig = null; renderRoom(state.room); }
}

async function swapSeats() {
  await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const s = seatsOf(room);
    return { ...room, seats: { a: s.b, b: s.a } };
  }, '入れかえられませんでした。もう一度ためしてね', false);
}

// 変えた項目だけを、今の設定に重ねて書く（2か所を続けて変えても、先に変えた値をもどさない）
async function saveSet(path, value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const next = normSet(room.set);
    if (path.length === 2) next[path[0]] = { ...next[path[0]], [path[1]]: value };
    else next[path[0]] = value;
    return { ...room, set: normSet(next) };
  }, '設定を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) {
    $('lobbyCommon')._key = null;
    renderRoom(state.room);
  }
}

async function addProxy() {
  const name = $('proxyName').value.trim();
  const error = validNickname(name);
  if (error) {
    setError('proxyError', error);
    return;
  }
  setError('proxyError', '');
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING) { reason = 'はじめる前だけ足せるよ'; return; }
    // 席に名前が残っている人（一時的に切れている人）と同じ名前も断る
    const seats = seatsOf(room);
    if (room.players?.[name] || room.proxies?.[name] || name === room.host || seats.a === name || seats.b === name) { reason = '「' + name + '」はもういるよ'; return; }
    if (proxyNames(room).length >= MAX_PROXIES) { reason = '端末なしの参加者は' + MAX_PROXIES + '人までだよ'; return; }
    const next = { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
    const k = SEATS.find((s) => !seats[s]);
    if (k) next.seats = { ...seats, [k]: name };
    return next;
  }, '足せませんでした。もう一度ためしてね');
  if (ok) $('proxyName').value = '';
  else if (ok === false) setError('proxyError', reason || '足せませんでした。もう一度ためしてね');
}

async function removeProxy(name) {
  await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || !room.proxies?.[name]) return;
    const proxies = { ...room.proxies };
    delete proxies[name];
    const seats = seatsOf(room);
    SEATS.forEach((k) => { if (seats[k] === name) seats[k] = null; });
    return { ...room, proxies: Object.keys(proxies).length ? proxies : null, seats };
  }, '外せませんでした。もう一度ためしてね');
}

// 席の2人で新しい対決を作る（そろっていなければ null）。first は 0 か 1（null なら設定のとおり）
function newGameFor(room, seats, first) {
  if (!seats.a || !seats.b || seats.a === seats.b) return null;
  if (!seatable(room, seats.a) || !seatable(room, seats.b)) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const proxy = {};
  const uids = {};
  SEATS.forEach((k) => {
    if (room.proxies?.[seats[k]]) proxy[k] = true;
    else uids[k] = room.players[seats[k]].uid;
  });
  const set = normSet(room.set);
  const order = first == null ? firstOf(set) : first;
  const duel = E.createDuel(duelSettings(set, [seats.a, seats.b], order), RoomkRTDB.now(), Math.random);
  return { id, seats: { ...seats }, uids, proxy, duel, ended: false };
}

function countStart() {
  window.RoomkStats?.count('start');
  window.RoomkStats?.count('players-2');
}

async function startGame() {
  const ok = await hostTransaction((room) => {
    // 対決のデータが壊れて play のまま残ったときも、待合室の画面から始めなおせるようにする
    if (room.status !== STATUS.WAITING && !(room.status === STATUS.PLAY && !gameOf(room))) return;
    const game = newGameFor(room, seatsOf(room), null);
    if (!game) return;
    return { ...room, status: STATUS.PLAY, lastGameId: game.id, game };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) countStart();
  else if (ok === false) toast('対戦する2人を選んでね');
}

// もう一回（先に答える人を入れかえる）
async function playAgain() {
  const gid = gameOf(state.room)?.id;
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid || game.duel.phase !== 'over') return;
    const next = newGameFor(room, game.seats, 1 - game.duel.settings.first);
    if (!next) { reason = 'そろっていない'; return; }
    return { ...room, seats: { ...game.seats }, lastGameId: next.id, game: next };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('again');
    countStart();
  } else if (ok === false && reason) {
    toast('対戦した2人がそろっていないよ。「待合室へ（対戦する人を選びなおす）」から選んでね');
  }
}

// 待合室にもどる（「待合室へ（対戦する人を選びなおす）」・「この対決をやめる」）
async function backToLobby() {
  const game = gameOf(state.room);
  const gid = game?.id;
  const wasOver = game?.duel.phase === 'over';
  if (!wasOver && !window.confirm('この対決をやめて、待合室にもどる？')) return;
  const ok = await hostTransaction((room) => {
    const cur = gameOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== gid) return;
    return { ...room, status: STATUS.WAITING, game: null, seats: { ...cur.seats } };
  }, 'もどれませんでした。もう一度ためしてね');
  if (ok && wasOver) window.RoomkStats?.count('again');
}

/* ── 答える・パス・時間で進める（ルーム） ── */
// 押した時点の対決・場面（rev）と同じときだけ書く。古い操作で次の場面を変えない
async function duelTransaction(gid, rev, step, needSeat) {
  const uid = currentUid();
  const nickname = state.nickname;
  const role = state.role;
  let finished = false;
  const result = await state.roomRef.transaction((r) => {
    finished = false;
    // ホストが切れている間は書かない（参加者の画面はホストを待っていて押せない・時計も止まっている）
    if (!r || isExpired(r) || r.status !== STATUS.PLAY || r.hostConnected === false) return;
    const cur = gameOf(r);
    if (!cur || cur.id !== gid || cur.duel.rev !== rev) return;
    if (needSeat ? !mayAnswer(r, cur, cur.duel.turn, uid, nickname, role) : !mayAdvance(r, cur, uid, nickname, role)) return;
    const next = step(cur.duel, RoomkRTDB.now());
    if (!next || next === cur.duel) return;
    finished = next.phase === 'over' && !cur.ended;
    return { ...r, game: { ...r.game, duel: next, ended: cur.ended || next.phase === 'over' } };
  });
  if (result.committed && finished) window.RoomkStats?.count('finish');
  return result.committed;
}

async function answerRoom(value) {
  const V = viewModel();
  if (!V || !V.canAnswer() || state.answering) return;
  const D = V.duel;
  // まちがいはルームに書かない（この端末で知らせるだけ）。時計は止まらない
  if (value !== D.problem.total) { showNg(); return; }
  state.answering = true;
  try {
    await duelTransaction(V.game.id, D.rev, (duel, now) => E.answer(duel, duel.turn, value, now).state, true);
  } catch (error) {
    console.warn('[charin-baton] answer failed', error);
    toast('送れませんでした。もう一度ためしてね');
  } finally {
    state.answering = false;
  }
}

async function passRoom() {
  const V = viewModel();
  if (!V || !V.canAnswer() || state.answering) return;
  state.answering = true;
  try {
    await duelTransaction(V.game.id, V.duel.rev, (duel, now) => E.pass(duel, duel.turn, now), true);
  } catch (error) {
    console.warn('[charin-baton] pass failed', error);
    toast('パスできませんでした。もう一度ためしてね');
  } finally {
    state.answering = false;
  }
}

// 時間で進める。ホストと対戦する2人の端末がそれぞれためし、場面の番号（rev）の照合で1つだけ通る
function advanceRoom(V) {
  const key = V.key + ':' + V.duel.rev;
  if (state.tickKey === key) return;
  state.tickKey = key;
  duelTransaction(V.game.id, V.duel.rev, (duel, now) => (E.due(duel, now) ? E.tick(duel, now, Math.random) : null), false)
    .then((ok) => {
      // 端末どうしの時刻の差でまだと判定されたときは、少し待ってためしなおす
      if (!ok) setTimeout(() => { if (state.tickKey === key) state.tickKey = null; }, RETRY_MS);
    })
    .catch((error) => {
      console.warn('[charin-baton] advance failed', error);
      setTimeout(() => { if (state.tickKey === key) state.tickKey = null; }, RETRY_MS);
    });
}

/* ── 1台の画面 ── */
function saveLocal() {
  try {
    if (!state.local) return;
    state.savedAt = Date.now();
    sessionStorage.setItem(LOCAL_KEY, JSON.stringify({ duel: state.local.duel, savedAt: state.savedAt, set: state.localSet, names: state.localNames }));
  } catch {
    // 保存できないときは、再読み込みで続きから戻れないだけ
  }
}

function loadLocal() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LOCAL_KEY));
    if (!saved || typeof saved !== 'object') return null;
    const duel = normDuel(saved.duel);
    if (!duel || duel.phase === 'over') return null;
    if (saved.set) state.localSet = normSet(saved.set);
    if (Array.isArray(saved.names)) state.localNames = [String(saved.names[0] || '').slice(0, 8), String(saved.names[1] || '').slice(0, 8)];
    // 読み込み直したら、閉じていた間は数えずに 3・2・1 からつづける
    const now = Date.now();
    return { duel: E.resume(duel, num(saved.savedAt, now), now, Math.random) };
  } catch {
    return null;
  }
}

function clearLocal() {
  try {
    sessionStorage.removeItem(LOCAL_KEY);
  } catch {
    // 何もしない
  }
}

function openLocalSetup() {
  state.localSet = normSet(state.localSet || DEFAULT_SET);
  const set = state.localSet;
  buildSeats($('localSeats'), set, (i) => {
    const wrap = makeElement('div', 'cb-field');
    const lab = makeElement('label', 'form-label', '名前（なくてもいい）');
    lab.htmlFor = 'localName' + i;
    const inp = makeElement('input', 'form-input');
    inp.id = 'localName' + i;
    inp.type = 'text';
    inp.maxLength = 8;
    inp.autocomplete = 'off';
    inp.placeholder = SEAT_LABEL[i];
    inp.value = state.localNames[i] || '';
    inp.addEventListener('input', () => { state.localNames[i] = inp.value; });
    submitOnEnter(inp, startLocal);
    wrap.append(lab, inp);
    return wrap;
  }, true, () => {});
  buildCommon($('localCommon'), set, () => {});
  showScreen('local');
}

function localNamesForDuel() {
  const names = [0, 1].map((i) => String(state.localNames[i] || '').trim().slice(0, 8) || SEAT_LABEL[i]);
  if (names[0] === names[1]) names[1] += '（2）';
  return names;
}

function startLocal(first) {
  // 二度押しで対決を作りなおさない（はじまってすぐの 3・2・1 の間に、もう一度押されたら何もしない）
  const cur = state.local?.duel;
  if (state.role === 'local' && cur && cur.phase === 'ready' && Date.now() - cur.startedAt < 800) return;
  const set = normSet(state.localSet);
  const order = typeof first === 'number' ? first : firstOf(set);
  state.role = 'local';
  state.local = { duel: E.createDuel(duelSettings(set, localNamesForDuel(), order), Date.now(), Math.random) };
  state.input = '';
  state.renderSig = null;
  saveLocal();
  window.RoomkStats?.count('local-start');
  showScreen('game');
  startClock();
  renderGame();
}

function applyLocal(next) {
  const L = state.local;
  if (!L || next === L.duel) return;
  const first = next.phase === 'over' && L.duel.phase !== 'over';
  L.duel = next;
  if (first) {
    window.RoomkStats?.count('local-finish');
    clearLocal();
  } else {
    saveLocal();
  }
  renderGame();
}

function quitLocal() {
  const d = state.local?.duel;
  if (d && d.phase !== 'over') {
    const asked = Date.now();
    if (!window.confirm('この対決をやめて、トップへ戻る？')) {
      // 確認を出していた間は数えずに、3・2・1 からつづける
      applyLocal(E.resume(state.local.duel, asked, Date.now(), Math.random));
      return;
    }
  }
  clearLocal();
  state.local = null;
  state.role = null;
  stopClock();
  resetBoxes();
  showScreen('top');
}

/* ── 画面の更新 ── */
function handleRoom(room) {
  if (state.role === 'guest') {
    const me = room.players?.[state.nickname];
    if (me && me.uid !== currentUid()) {
      leaveLocally('同じ名前の人が参加したので、ルームから外れました');
      return;
    }
  }
  if (state.presenceDirty) ensurePresence(true);
  else if (needsPresence(room)) ensurePresence();
  updateHostOverlay(room);
  renderRoom(room);
}

function renderRoom(room) {
  const playing = room.status === STATUS.PLAY && !!gameOf(room);
  const next = playing ? 'game' : 'waiting';
  if (state.currentScreen !== next) {
    if ($('zoom').open) $('zoom').close();
    state.renderSig = null;
    state.input = '';
    showScreen(next);
  }
  renderBar(room);
  if (playing) renderGame();
  else renderWaiting(room);
}

function updateHostOverlay(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    if (!state.orphanTimer) {
      const ref = state.roomRef;
      const at = RoomkRTDB.getHostDisconnectedAt(room);
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
      state.orphanTimer = setTimeout(() => {
        state.orphanTimer = null;
        if (state.roomRef === ref && state.room) removeExpired(ref, state.room);
      }, delay);
    }
  } else {
    $('hostOffOverlay').hidden = true;
    clearTimeout(state.orphanTimer);
    state.orphanTimer = null;
  }
}

function mySeat(room) {
  const game = gameOf(room);
  const seats = room.status === STATUS.PLAY && game ? game.seats : seatsOf(room);
  const i = SEATS.findIndex((k) => seats[k] === state.nickname);
  return i;
}

function renderBar(room) {
  let me = '';
  if (state.role === 'host' || state.role === 'guest') {
    const seat = mySeat(room);
    me = (state.role === 'host' ? 'ホスト' : state.nickname) + (seat >= 0 ? '・あなたは' + SEAT_LABEL[seat] : state.role === 'guest' ? '・観戦中' : '');
  }
  $('barMe').hidden = !me;
  $('barMe').textContent = me;
}

function renderWaiting(room) {
  const host = state.role === 'host';
  const watch = state.role === 'spectator';
  const seats = seatsOf(room);
  const set = normSet(room.set);
  $('lobbyJoin').hidden = !watch;
  $('lobbyJoinCode').textContent = state.roomCode || '';

  // 対戦する人（ホストは選ぶ。ほかの人は見るだけ）
  const people = memberNames(room).concat(proxyNames(room));
  const work = JSON.parse(JSON.stringify(set));
  buildSeats($('lobbySeats'), work, (i) => {
    const k = SEATS[i];
    if (host) {
      const opts = [['', '（えらんでね）']].concat(people.map((name) => [name, name + (name === room.host ? '（自分）' : room.proxies?.[name] ? '（端末なし）' : '')]));
      // 席の人がいまいないときも、そのまま見えるように残す
      if (seats[k] && !people.includes(seats[k])) opts.push([seats[k], seats[k] + '（いない）']);
      return selectField('対戦する人', 'seat-' + k, opts, seats[k] || '', (v) => setSeat(k, v));
    }
    const name = seats[k];
    const label = name ? name + (name === state.nickname && !watch ? '（あなた）' : '') + (seatable(room, name) ? '' : '（いない）') : 'まだ決まっていない';
    return makeElement('p', 'cb-seat__view' + (name ? '' : ' is-empty'), label);
  }, host, saveSet);
  $('btnSeatSwap').hidden = !host;

  const ready = !!seats.a && !!seats.b && seats.a !== seats.b && seatable(room, seats.a) && seatable(room, seats.b);
  let note = '';
  if (host) {
    if (people.length < 2) note = 'もう1人入ると、はじめられるよ。ホストも対戦するときは、自分を選んでね';
    else if (!ready) note = '1人目と2人目を選んでね。ホストも対戦できるよ';
  }
  $('seatNote').textContent = note;
  $('seatNote').hidden = !note;

  // 参加している人
  $('lobbyPeople').replaceChildren(...people.map((name) => {
    const proxy = !!room.proxies?.[name];
    const li = makeElement('li', 'cb-person');
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    li.append(msIcon(host && proxy ? 'person_off' : 'person'), makeElement('span', 'cb-person__name', name));
    if (name === room.host) li.append(makeElement('span', 'cb-tag cb-tag--muted', 'ホスト'));
    if (host && proxy) li.append(makeElement('span', 'cb-tag cb-tag--muted', '端末なし'));
    const si = SEATS.findIndex((k) => seats[k] === name);
    if (si >= 0) li.append(makeElement('span', 'cb-tag', SEAT_LABEL[si]));
    else li.append(makeElement('span', 'cb-tag cb-tag--watch', '観戦'));
    if (name === state.nickname && !watch) li.append(makeElement('span', 'cb-tag cb-tag--watch', 'あなた'));
    if (host && proxy) {
      const del = makeElement('button', 'cb-quiet cb-person__del', '外す');
      del.type = 'button';
      del.addEventListener('click', () => removeProxy(name));
      li.append(del);
    }
    return li;
  }));
  $('proxyForm').hidden = !host;

  // 小銭の出し方（ホストは選ぶ。変えている途中の欄を作りなおさないよう、値が変わったときだけ作る）
  $('lobbyCommon').hidden = !host;
  $('lobbyCommonView').hidden = host;
  if (host) {
    const key = JSON.stringify(set);
    if ($('lobbyCommon')._key !== key) {
      const common = JSON.parse(JSON.stringify(set));
      buildCommon($('lobbyCommon'), common, (path, value) => { $('lobbyCommon')._key = JSON.stringify(normSet(common)); saveSet(path, value); });
      $('lobbyCommon')._key = key;
    }
  } else {
    $('lobbyCommonView').textContent = settingSummary(set);
  }

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

// 画面に出すための共通の形にそろえる（1台の画面とルーム）
function viewModel() {
  if (state.role === 'local') {
    const L = state.local;
    if (!L) return null;
    return {
      duel: L.duel,
      names: L.duel.settings.players.map((p) => p.name),
      now: Date.now(),
      away: () => false,
      proxy: () => false,
      mine: () => false,
      canAnswer: () => L.duel.phase === 'play',
      key: 'local:' + L.duel.startedAt,
      local: true,
    };
  }
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game) return null;
  const uid = currentUid();
  return {
    duel: game.duel,
    game,
    room,
    names: SEATS.map((k) => game.seats[k] || ''),
    now: roomNow(room),
    away: (i) => !seatPresent(room, game, i),
    proxy: (i) => game.proxy[SEATS[i]],
    mine: (i) => (state.role === 'host' || state.role === 'guest') && game.seats[SEATS[i]] === state.nickname && game.uids[SEATS[i]] === uid,
    canAnswer: () => game.duel.phase === 'play' && room.hostConnected !== false && mayAnswer(room, game, game.duel.turn, uid, state.nickname, state.role),
    mayAdvance: () => mayAdvance(room, game, uid, state.nickname, state.role),
    key: state.roomCode + ':' + game.id,
    local: false,
  };
}

const canInput = () => { const V = viewModel(); return !!V && V.canAnswer(); };

function renderGame() {
  const V = viewModel();
  if (!V) return;
  const D = V.duel;
  // 同じ場面なら作りなおさない（入れている途中の数字・数字ボタンをそのまま残す）
  const sig = [V.key, D.rev, V.canAnswer(), V.away(0), V.away(1), state.role, state.showPad, PC_MQ.matches].join('|');
  if (sig === state.renderSig) { updateClock(); return; }
  // 場面（rev）が変わったら、入れている途中の数字を消す（番・小銭・答える人が変わっているため）
  const prev = state.renderSig ? state.renderSig.split('|') : [];
  if (prev[0] !== V.key || prev[1] !== String(D.rev)) state.input = '';
  state.renderSig = sig;
  const live = D.phase !== 'over';
  // 結果の小銭を大きく見ている途中に次の対決が始まったら閉じる（トレーと数字キーをふさがない）
  if (live && $('zoom').open) $('zoom').close();
  const host = state.role === 'host';
  const names = V.names;

  [0, 1].forEach((i) => {
    const card = $('card' + i);
    card.className = 'cb-player' + (live && D.turn === i ? ' is-turn' : '') + (!live && D.winner === i ? ' is-win' : '');
    const head = makeElement('p', 'cb-player__name');
    if (live && D.turn === i) head.append(msIcon('play_arrow'));
    if (!live && D.winner === i) head.append(msIcon('emoji_events'));
    head.append(document.createTextNode(names[i] + (V.mine(i) ? '（あなた）' : '')));
    const clock = makeElement('p', 'cb-player__clock');
    clock.id = 'clock' + i;
    // 残り時間のバー（数字を読まなくても、どれくらい減ったかが見える）
    const bar = makeElement('div', 'cb-player__bar');
    const fill = makeElement('span', 'cb-player__fill');
    fill.id = 'bar' + i;
    bar.append(fill);
    const tags = makeElement('div', 'cb-player__tags');
    if (V.away(i)) tags.append(makeElement('span', 'cb-tag cb-tag--warn', '通信が切れた'));
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    if (host && V.proxy(i)) tags.append(makeElement('span', 'cb-tag cb-tag--muted', '端末なし'));
    card.replaceChildren(head, clock, bar, tags);
  });

  // いまの番を大きく出す（1台の画面で、メンターがだれの答えを入れるのか迷わないように）
  const turn = $('turnLine');
  turn.className = 'cb-turn';
  const nameOf = (i) => makeElement('span', 'cb-turn__name', V.mine(i) ? 'あなた' : names[i]);
  const text = (t) => document.createTextNode(t);
  if (D.phase === 'ready') turn.replaceChildren(nameOf(D.turn), text(' からはじまるよ'));
  else if (D.phase === 'play') turn.replaceChildren(nameOf(D.turn), text(' の番'));
  else if (D.phase === 'reveal') turn.replaceChildren(text('次は '), nameOf(1 - D.turn), text(' の番'));
  else if (D.phase === 'pass') turn.replaceChildren(nameOf(D.turn), text(' はパス'));
  else { turn.classList.add('is-over'); turn.replaceChildren(msIcon('emoji_events'), nameOf(D.winner), text(' の勝ち！')); }

  // 小銭は、はじまる前とパスの間だけかくす。正解と時間切れは小銭を見せたまま、下に金額と内訳を出す
  drawTray($('tray'), D.problem.coins, D.phase === 'pass' || D.phase === 'ready');
  const over = $('trayOver');
  over.hidden = !(D.phase === 'pass' || D.phase === 'ready');
  if (D.phase === 'ready') {
    const n = makeElement('p', 'cb-overlay__count');
    n.id = 'readyLeft';
    over.replaceChildren(n);
  } else if (D.phase === 'pass') {
    const left = makeElement('p', 'cb-overlay__small');
    left.id = 'passLeft';
    over.replaceChildren(makeElement('p', 'cb-overlay__big', 'パス'), left);
  } else {
    over.replaceChildren();
  }
  const band = $('trayBand');
  const lastH = D.history[D.history.length - 1];
  if (D.phase === 'reveal' && D.last) {
    band.hidden = false;
    band.className = 'cb-band cb-band--ok';
    band.replaceChildren(makeElement('p', 'cb-band__big', '正解！ ' + yen(D.last.total)), makeElement('p', 'cb-band__small', E.breakdown(D.problem.coins)));
  } else if (D.phase === 'over' && lastH && lastH.how === 'timeout') {
    band.hidden = false;
    band.className = 'cb-band';
    band.replaceChildren(makeElement('p', 'cb-band__big', 'この小銭は ' + yen(lastH.total)), makeElement('p', 'cb-band__small', '時間切れ・' + E.breakdown(lastH.coins)));
  } else {
    band.hidden = true;
    band.replaceChildren();
  }

  renderInput(V);
  renderResult(V);
  renderTools(V);
  updateClock();
}

function renderInput(V) {
  const D = V.duel;
  const box = $('answerBox');
  box.replaceChildren();
  $('duel').classList.remove('is-nopad');
  if (D.phase === 'over' || state.role === 'spectator') { box.hidden = true; return; }
  box.hidden = false;
  const local = V.local;
  const seatTurnMine = V.mine(D.turn);
  // ルームで、この端末が答える番でないとき
  if (!local && !(seatTurnMine || (state.role === 'host' && (V.proxy(D.turn) || V.away(D.turn))))) {
    const who = V.names[D.turn];
    const next = V.names[1 - D.turn];
    const nextMine = V.mine(1 - D.turn);
    let note;
    if (D.phase === 'ready') note = 'もうすぐはじまるよ';
    else if (D.phase === 'reveal') note = nextMine ? '次はあなたの番だよ' : '次は' + next + 'の番';
    else if (D.phase === 'pass') note = who + 'はパス。もうすぐ次の小銭が出るよ';
    else note = who + 'が数えているよ' + (nextMine ? '。次はあなたの番' : '');
    box.append(makeElement('p', 'cb-waitnote', note));
    return;
  }
  const active = V.canAnswer();
  // 正解の帯の間は、金額の欄の場所に帯が出る（下のボタンは押せないまま残す）
  const revealing = D.phase === 'reveal';
  if (!local && state.role === 'host' && !seatTurnMine && !revealing) {
    box.append(makeElement('p', 'cb-proxynote', V.names[D.turn] + 'の番。代わりに入れてね'));
  }
  // 金額の欄。文字を打つ入力欄に見えるように、点滅するカーソルと「数字キーで入力」の案内を出す
  // （本物の入力欄にはしない。日本語入力の変換で数字がずれるのを避けるため）
  const disp = makeElement('div', 'cb-display' + (active ? ' is-active' : '') + (state.input ? '' : ' is-empty') + (Date.now() < state.ngUntil ? ' is-ng' : ''));
  disp.id = 'display';
  const kb = msIcon('keyboard', 'cb-display__kb cb-pc-only');
  const numNode = makeElement('span', 'cb-display__num', state.input);
  numNode.id = 'displayNum';
  const caret = makeElement('span', 'cb-display__caret');
  caret.setAttribute('aria-hidden', 'true');
  disp.append(kb, numNode, caret,
    makeElement('span', 'cb-display__ph cb-pc-only', '数字キーで入力'),
    makeElement('span', 'cb-display__ph cb-touch-only', '下のボタンで入力'),
    makeElement('span', 'cb-display__unit', '円'));
  const msg = makeElement('p', 'cb-ngmsg', Date.now() < state.ngUntil ? 'ちがうみたい。もう一回数えてみよう' : '');
  msg.id = 'ngMsg';
  msg.setAttribute('aria-live', 'polite');
  if (!revealing) box.append(disp, makeElement('p', 'cb-keyhint cb-pc-only', 'Enter で答える・Backspace で1つ消す'), msg);

  // 画面の数字ボタン。PC（マウスのある端末）はキーボードで打てるので、はじめは出さない。リンクで出せる
  const pc = PC_MQ.matches;
  const padOn = !pc || state.showPad;
  $('duel').classList.toggle('is-nopad', !padOn);
  if (padOn) {
    const pad = makeElement('div', 'cb-pad');
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'del', '0', 'ok'].forEach((k) => {
      let b;
      if (k === 'del') {
        b = makeElement('button', 'cb-key cb-key--sub');
        b.append(msIcon('backspace'));
        b.setAttribute('aria-label', '1つ消す');
      } else if (k === 'ok') {
        b = makeElement('button', 'btn btn-primary cb-okkey', 'こたえる');
      } else {
        b = makeElement('button', 'cb-key', k);
      }
      b.type = 'button';
      b.disabled = !active;
      b.addEventListener('click', () => press(k));
      pad.append(b);
    });
    box.append(pad);
  }
  // パスはゲームの大事な操作なので、リンクでなく枠のボタンにする（主ボタンは「こたえる」）
  const acts = makeElement('div', 'cb-acts' + (padOn ? ' cb-acts--pad' : ''));
  const passBtn = makeElement('button', 'btn btn-secondary cb-passbtn');
  passBtn.type = 'button';
  passBtn.disabled = !active;
  passBtn.append(makeElement('span', '', 'パス'), makeElement('small', 'cb-passbtn__note', '3秒まって次へ'));
  passBtn.addEventListener('click', doPass);
  acts.append(passBtn);
  if (!padOn) {
    const ok = makeElement('button', 'btn btn-primary cb-answer', 'こたえる');
    ok.type = 'button';
    ok.disabled = !active;
    ok.addEventListener('click', () => press('ok'));
    acts.append(ok);
  }
  box.append(acts);
  if (pc) {
    const tog = makeElement('button', 'cb-quiet cb-padtoggle', padOn ? '画面の数字ボタンをかくす' : '画面の数字ボタンを出す');
    tog.type = 'button';
    tog.addEventListener('click', () => {
      state.showPad = !state.showPad;
      try { sessionStorage.setItem(PAD_KEY, state.showPad ? '1' : '0'); } catch { /* 何もしない */ }
      state.renderSig = null;
      renderGame();
    });
    box.append(tog);
  }
}

function refreshDisplay() {
  const n = $('displayNum');
  if (n) n.textContent = state.input;
  const d = $('display');
  if (d) d.classList.toggle('is-empty', !state.input);
}

function press(k) {
  if (!canInput()) return;
  if (k === 'del') { state.input = state.input.slice(0, -1); refreshDisplay(); return; }
  if (k === 'ok') { submitAnswer(); return; }
  if (state.input.length >= INPUT_MAX) return;
  if (state.input === '0') state.input = '';
  state.input += k;
  refreshDisplay();
}

function submitAnswer() {
  if (!state.input) return;
  const value = Number(state.input);
  state.input = '';
  refreshDisplay();
  if (state.role === 'local') {
    const L = state.local;
    const r = E.answer(L.duel, L.duel.turn, value, Date.now());
    if (r.result === 'ng') showNg();
    applyLocal(r.state);
  } else {
    answerRoom(value);
  }
}

function doPass() {
  if (!canInput()) return;
  state.input = '';
  refreshDisplay();
  if (state.role === 'local') applyLocal(E.pass(state.local.duel, state.local.duel.turn, Date.now()));
  else passRoom();
}

function showNg() {
  state.ngUntil = Date.now() + NG_SHOW_MS;
  const disp = $('display');
  if (disp) {
    disp.classList.remove('is-ng');
    void disp.offsetWidth; // ゆれをもう一度
    disp.classList.add('is-ng');
  }
  const msg = $('ngMsg');
  if (msg) msg.textContent = 'ちがうみたい。もう一回数えてみよう';
  refreshDisplay();
}

// 結果: 勝った人と、出た小銭の一覧（だれが解いたかは出さない。記録も残さない）
function renderResult(V) {
  const D = V.duel;
  const box = $('resultBox');
  box.replaceChildren();
  if (D.phase !== 'over') { box.hidden = true; return; }
  box.hidden = false;
  const acts = makeElement('div', 'cb-stack');
  if (V.local || state.role === 'host') {
    const again = makeElement('button', 'btn btn-primary btn-full', 'もう一回（先に答える人を入れかえる）');
    again.type = 'button';
    again.addEventListener('click', () => {
      if (V.local) startLocal(1 - D.settings.first);
      else playAgain();
    });
    const change = makeElement('button', 'btn btn-secondary btn-full', V.local ? '名前や設定を変える' : '待合室へ（対戦する人を選びなおす）');
    change.type = 'button';
    change.addEventListener('click', () => {
      if (V.local) {
        clearLocal();
        state.local = null;
        state.role = null;
        stopClock();
        resetBoxes();
        openLocalSetup();
      } else {
        backToLobby();
      }
    });
    acts.append(again, change);
  } else if (state.role === 'guest') {
    acts.append(makeElement('p', 'cb-wait', 'ホストが次を決めるのを待っているよ'));
  }
  if (acts.childNodes.length) box.append(acts);
  const list = D.history;
  if (!list.length) return;
  box.append(makeElement('h2', 'cb-h2 mt-md', 'この対決で出た小銭（' + list.length + '回）'));
  box.append(makeElement('p', 'cb-note', '押すと大きく出て、何円玉が何枚かも見られるよ'));
  const grid = makeElement('div', 'cb-history');
  list.forEach((h, k) => {
    const b = makeElement('button', 'cb-hist');
    b.type = 'button';
    const tray = makeElement('div', 'cb-tray cb-tray--mini');
    drawTray(tray, h.coins, false);
    b.append(tray, makeElement('span', 'cb-hist__total', yen(h.total)));
    b.setAttribute('aria-label', (k + 1) + '回目 ' + yen(h.total));
    b.addEventListener('click', () => openZoom(h));
    grid.append(b);
  });
  box.append(grid);
}

function renderTools(V) {
  const box = $('tools');
  box.replaceChildren();
  if (V.local) {
    const b = makeElement('button', 'cb-quiet', V.duel.phase === 'over' ? 'トップへ戻る' : 'この対決をやめる');
    b.type = 'button';
    b.addEventListener('click', quitLocal);
    box.append(b);
  } else if (state.role === 'host' && V.duel.phase !== 'over') {
    const b = makeElement('button', 'cb-quiet', 'この対決をやめる（待合室へ）');
    b.type = 'button';
    b.addEventListener('click', backToLobby);
    box.append(b);
  }
}

function openZoom(h) {
  drawTray($('zoomTray'), h.coins, false);
  $('zoomTotal').textContent = 'ぜんぶで ' + yen(h.total);
  $('zoomBreak').textContent = E.breakdown(h.coins);
  $('zoom').showModal();
}

// 残り時間・3・2・1・パスの残りを出し、時間で進めるところがあれば進める
function updateClock() {
  if (state.currentScreen !== 'game') return;
  const V = viewModel();
  if (!V) return;
  const D = V.duel;
  const now = V.now;
  [0, 1].forEach((i) => {
    const c = $('clock' + i);
    if (!c) return;
    const ms = E.remaining(D, i, now);
    const full = D.settings.players[i].time * 1000;
    const fill = $('bar' + i);
    if (fill) fill.style.width = Math.max(0, Math.min(100, (ms / full) * 100)) + '%';
    $('card' + i).classList.toggle('is-low', ms <= LOW_MS && D.phase !== 'over' && D.turn === i);
    c.replaceChildren(makeElement('span', 'cb-player__sec', secs(ms)), makeElement('span', 'cb-player__unit', '秒'));
    c.setAttribute('aria-label', 'のこり ' + secs(ms) + '秒');
  });
  const ready = $('readyLeft');
  if (ready && D.phase === 'ready') ready.textContent = String(Math.max(1, secs(D.phaseEnd - now)));
  const left = $('passLeft');
  if (left && D.phase === 'pass') left.textContent = 'あと ' + Math.max(1, secs(D.phaseEnd - now)) + '秒';
  if (state.ngUntil && Date.now() >= state.ngUntil) {
    state.ngUntil = 0;
    const msg = $('ngMsg');
    if (msg) msg.textContent = '';
    const disp = $('display');
    if (disp) disp.classList.remove('is-ng');
  }
  if (!E.due(D, now)) {
    // 1台の画面は、読み込み直しても続きから戻れるよう1秒ごとに残り時間をおぼえる
    if (V.local && Date.now() - state.savedAt > 1000) saveLocal();
    return;
  }
  if (V.local) applyLocal(E.tick(D, now, Math.random));
  else if (V.room.hostConnected !== false && V.mayAdvance()) advanceRoom(V);
}

/* ── いっしょに数える ── */
function openCount() {
  state.role = 'count';
  window.RoomkStats?.count('count-start');
  newCount();
  showScreen('count');
}

function newCount() {
  const C = state.count;
  C.problem = E.makeProblem(Math.random, { count: C.n, kinds: C.kinds, arrange: C.arrange, prevKey: C.problem ? C.problem.key : null });
  C.shown = false;
  renderCount();
}

function segmented(labelText, options, value, onPick) {
  const wrap = makeElement('div', 'cb-seg');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', labelText);
  wrap.append(makeElement('span', 'cb-seg__label', labelText));
  options.forEach(([v, t]) => {
    const b = makeElement('button', 'cb-seg__btn' + (v === value ? ' is-on' : ''), t);
    b.type = 'button';
    b.setAttribute('aria-pressed', v === value ? 'true' : 'false');
    b.addEventListener('click', () => onPick(v));
    wrap.append(b);
  });
  return wrap;
}

function renderCount() {
  const C = state.count;
  const step = makeElement('div', 'cb-seg');
  step.append(makeElement('span', 'cb-seg__label', '枚数'));
  const minus = makeElement('button', 'cb-seg__btn');
  minus.type = 'button';
  minus.append(msIcon('remove'));
  minus.setAttribute('aria-label', '1枚へらす');
  minus.disabled = C.n <= 2;
  minus.addEventListener('click', () => { C.n -= 1; newCount(); });
  const plus = makeElement('button', 'cb-seg__btn');
  plus.type = 'button';
  plus.append(msIcon('add'));
  plus.setAttribute('aria-label', '1枚ふやす');
  plus.disabled = C.n >= 8;
  plus.addEventListener('click', () => { C.n += 1; newCount(); });
  step.append(minus, makeElement('span', 'cb-seg__num', C.n + '枚'), plus);
  $('countOpts').replaceChildren(
    step,
    segmented('種類', [['all', 'ぜんぶ'], ['three', '1・10・100円だけ']], C.kinds, (v) => { C.kinds = v; newCount(); }),
    segmented('ならべ方', [['scatter', 'ばらばら'], ['sort', 'そろえる']], C.arrange, (v) => { C.arrange = v; newCount(); }),
  );
  drawTray($('countTray'), C.problem.coins, false);
  const ans = $('countAnswer');
  if (C.shown) ans.replaceChildren(makeElement('p', 'cb-countans__total', 'ぜんぶで ' + yen(C.problem.total)), makeElement('p', 'cb-countans__break', E.breakdown(C.problem.coins)));
  else ans.replaceChildren();
  $('btnCountGo').textContent = C.shown ? '次の小銭' : '答えを見る';
}

/* ── キーボード ── */
// 数字キー・テンキーで入れられる（全角の数字も受け付ける）
function keyDigit(event) {
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (/^[０-９]$/.test(event.key)) return String(event.key.charCodeAt(0) - 0xff10);
  const m = /^Numpad([0-9])$/.exec(event.code || '');
  return m ? m[1] : null;
}

document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey || $('zoom').open || !$('hostOffOverlay').hidden) return;
  const t = event.target;
  if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.closest('.cb-screen.active')) return;
  if (state.currentScreen === 'game') {
    const d = keyDigit(event);
    if (d != null) { press(d); event.preventDefault(); }
    else if (event.key === 'Backspace' || event.key === 'Delete') { press('del'); event.preventDefault(); }
    else if (event.key === 'Enter' && canInput()) { press('ok'); event.preventDefault(); }
  } else if (state.currentScreen === 'count') {
    // いっしょに数える: Enter・スペースでも「答えを見る」「次の小銭」
    if (t && t.tagName === 'BUTTON') return;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('btnCountGo').click(); }
  }
});

/* ── ボタン ── */
function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    // 日本語入力の確定の Enter では送らない（Safari は確定の Enter を isComposing=false・keyCode 229 で届ける）
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) handler();
  });
}

$('btnGoCreate').addEventListener('click', () => {
  setError('createError', '');
  showScreen('create');
});
$('btnGoJoin').addEventListener('click', () => {
  setError('joinError', '');
  $('joinLinkHint').hidden = true;
  showScreen('join');
});
$('btnGoLocal').addEventListener('click', openLocalSetup);
$('btnGoCount').addEventListener('click', openCount);
$('btnGoWatch').addEventListener('click', () => {
  setError('watchError', '');
  showScreen('watch-join');
});
['btnCreateBack', 'btnJoinBack', 'btnWatchBack', 'btnLocalBack', 'btnWatchEndTop'].forEach((id) => {
  $(id).addEventListener('click', () => showScreen('top'));
});
$('btnCountBack').addEventListener('click', () => {
  state.role = null;
  showScreen('top');
});
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('hostName'), createRoom);
submitOnEnter($('guestName'), joinRoom);
submitOnEnter($('joinCode'), joinRoom);

function openWatchFromForm() {
  const code = normalizeRoomCode($('watchCode').value);
  const imeError = roomCodeImeError(code);
  if (imeError) {
    setError('watchError', imeError);
    return;
  }
  if (!ROOM_CODE_PATTERN.test(code)) {
    setError('watchError', 'ルームコードは6文字で入れてね');
    return;
  }
  setError('watchError', '');
  enterWatch(code, true);
}
$('btnWatchOpen').addEventListener('click', openWatchFromForm);
submitOnEnter($('watchCode'), openWatchFromForm);

$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
$('btnCopyLink').addEventListener('click', (event) => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkRTDB.copyRoomLink(state.roomCode, event.currentTarget);
});
// 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
$('btnShowQr').addEventListener('click', () => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkQR.show(state.roomCode);
});
$('btnOpenWatch').addEventListener('click', () => {
  if (state.role !== 'host' || !state.roomCode) return;
  // ポップアップブロックを避けるため、クリックの中で同期的に開く。noopener で元のタブと切り離す
  window.open(location.pathname + '?watch=' + state.roomCode, '_blank', 'noopener');
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);

$('btnSeatSwap').addEventListener('click', swapSeats);
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnStartGame').addEventListener('click', startGame);
$('btnLocalStart').addEventListener('click', () => startLocal());
$('btnZoomClose').addEventListener('click', () => $('zoom').close());
$('btnCountGo').addEventListener('click', () => {
  if (state.count.shown) newCount();
  else { state.count.shown = true; renderCount(); }
});
// 窓の幅が変わって PC 向け・タッチ向けの出し分けが変わったら、入力の部分を作りなおす
PC_MQ.addEventListener?.('change', () => { state.renderSig = null; if (state.currentScreen === 'game') renderGame(); });

// 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう（コード欄は直せるように残す）
function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}

// 再読み込みなどで、保存した記録から同じルームへ戻る。なければ、1台の画面の続き
function resumeFromSession() {
  if (!loadSession()) {
    resumeLocal();
    return;
  }
  tryReconnect().then((reconnected) => {
    if (!reconnected && !state.roomRef) clearSession();
  });
}

function resumeLocal() {
  const saved = loadLocal();
  if (!saved) return;
  state.role = 'local';
  state.local = saved;
  // 閉じる前に時計が0になっていたら、そこで負けとして数える
  if (saved.duel.phase === 'over') {
    window.RoomkStats?.count('local-finish');
    clearLocal();
  } else {
    saveLocal();
  }
  showScreen('game');
  startClock();
  renderGame();
}

try { state.showPad = sessionStorage.getItem(PAD_KEY) === '1'; } catch { state.showPad = false; }
showScreen('top');
const startParams = new URLSearchParams(location.search);
const watchParam = startParams.get('watch');
const roomParam = startParams.get('room');
if (watchParam !== null) {
  // みんなにみせる画面の入口。このタブでホスト・参加者として戻らないよう、再接続の記録は先に消す
  clearSession();
  const watchCode = normalizeRoomCode(watchParam);
  if (ROOM_CODE_PATTERN.test(watchCode)) {
    enterWatch(watchCode).then((ok) => {
      if (!ok) history.replaceState(null, '', location.pathname);
    });
  } else {
    toast('ルームコードが正しくないよ');
    history.replaceState(null, '', location.pathname);
  }
} else if (roomParam !== null) {
  // 参加用のリンク（?room=コード）の入口。コードを入れた状態で参加画面を開く。コードはつないだときにアドレスから外す（connectToRoom）
  const linkCode = normalizeRoomCode(roomParam);
  const saved = loadSession();
  if (!ROOM_CODE_PATTERN.test(linkCode)) {
    toast('ルームコードが正しくないよ');
    history.replaceState(null, '', location.pathname);
    resumeFromSession();
  } else if (saved && saved.roomCode === linkCode) {
    // 同じルームの記録が残っていれば、名前を入れなおさずに戻る。戻れなければ参加画面へ
    tryReconnect().then((reconnected) => {
      if (reconnected || state.roomRef) return;
      clearSession();
      openJoinFromLink(linkCode);
    });
  } else {
    // 別のルームの記録が残っていても、ひらいたリンクのルームを優先する
    if (saved) clearSession();
    openJoinFromLink(linkCode);
  }
} else {
  // ルームにいる途中で再読み込みしたときは、同じルームに戻る
  resumeFromSession();
}
