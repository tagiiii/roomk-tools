/* チェス
   ・1台の画面: このタブだけで指す（駒を動かすのは画面を動かす人。通信しない）
   ・ルーム: Realtime Database。対戦する2人がそれぞれの端末で指し、ほかの参加者は観戦する
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない
   ルールは engine.js（window.ChessEngine）。ルームには指した手の記録だけを置き、局面は各端末で作りなおす */
const E = window.ChessEngine;

const MAX_GUESTS = 20;
const MAX_PROXIES = 4;     // 端末なしの参加者（ホストが代わりに指す）
const KEYS = ['w', 'b'];   // ルームの席の名前（w＝白・b＝黒）。画面と engine では 0・1
const SIDE = ['白', '黒'];
// 駒の形（国際チェスの記号。字形は Noto Sans Symbols 2。白も黒も中の塗った形を使い、色は CSS で付ける）
const GLYPH = { K: '\u265A', Q: '\u265B', R: '\u265C', B: '\u265D', N: '\u265E', P: '\u265F' };
// 補助: who＝使う人（both | w | b | none）、spots＝動ける所、names＝駒の名前と動き方、hint＝おすすめの手
// （2026-11-18 オーナーが選んだ3つ。はじめは全部オン）
const DEFAULT_AID = { who: 'both', spots: true, names: true, hint: true };
// 持ち時間（分）と秒読み（秒）。0 はなし（2026-11-15 オーナー依頼「持ち時間・秒読み」）
const CLOCK_MAIN_OPTS = [0, 3, 5, 10, 20, 30];
const CLOCK_BYO_OPTS = [0, 10, 20, 30, 60];
const CLOCK_GRACE_MS = 1000;   // 端末どうしの時計のずれの分だけ待ってから時間切れにする
// ルームの席に CPU を置くときの値（名前には # を使えないので、人の名前とまざらない）
const CPU_SEAT = '#cpu:';
const LEVEL_NAMES = { weak: 'よわい', normal: 'ふつう', strong: 'つよい' };
const WHO_OPTS = [['both', 'ふたりとも'], ['w', '白だけ'], ['b', '黒だけ'], ['none', '使わない']];

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
// 時計の時刻（RoomkRTDB.now）は、サーバーとの時刻のずれが届いてから合う。届くまでは、時計を書く操作を待つ（最大3秒）
let timeSynced = false;
const timeSync = new Promise((resolve) => {
  const ref = db.ref('.info/serverTimeOffset');
  const onOffset = (snap) => {
    if (snap.val() == null) return;
    timeSynced = true;
    ref.off('value', onOffset);
    resolve();
  };
  ref.on('value', onOffset);
});
const waitTimeSync = () => (timeSynced ? null : Promise.race([timeSync, new Promise((r) => setTimeout(r, 3000))]));
const DB_PREFIX = 'chess_rooms';
const SESSION_KEY = 'chess_session';
const LOCAL_KEY = 'chess_local';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play' };
const DEFAULT_TITLE = document.title;

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'（みんなにみせる画面）| 'local'（1台の画面）
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  joinedAt: null,
  currentScreen: null,
  timerInterval: null,
  orphanTimer: null,
  orphanAt: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  moving: false,       // 指す途中（二度押しよけ。ほかの操作の busy とは分ける）
  watchTimer: null,
  // 端末の中だけで持つ状態
  local: null,         // 1台の画面の対局 { names, aid, moves, resign, ended }
  localAid: null,
  cpuTimer: null,      // CPU が指すまでの待ち
  cpuKey: null,        // CPU が同じ番で二度指さないための印
  localClock: null,    // 1台の画面の持ち時間の設定 { m, b }
  clockTimer: null,    // 持ち時間の表示を進める
  timeoutKey: null,    // 同じ局面で時間切れを二度書かないための印
  sel: null,           // 選んでいる駒 { from }
  hint: null,          // おすすめの手 { key, from, to }（その局面のあいだだけ出す）
  selKey: null,
  msg: '',
  flip: false,         // 盤の向きを変えた（この端末だけ）
  promo: null,         // ポーンが何になるかを聞いている手
  drawnKey: null,      // 盤に出している局面（1手すすんだときだけ動きを付ける）
  drawnRev: -1,
  drawnPly: -1,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.ch-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  const inApp = id === 'waiting' || id === 'game';
  $('appBar').hidden = !inApp;
  $('roomBar').hidden = !inApp || !state.roomRef;
}

function setError(id, message) {
  const node = $(id);
  node.textContent = message || '';
  node.hidden = !message;
  // まちがいのあいだは、つながった入力欄を「まちがい」として読ませる
  document.querySelectorAll('[aria-describedby="' + id + '"]').forEach((el) => (message ? el.setAttribute('aria-invalid', 'true') : el.removeAttribute('aria-invalid')));
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
  if (value && typeof value === 'object') return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
  return [];
}

/* ── 補助 ── */
function normAid(aid) {
  const a = aid && typeof aid === 'object' ? aid : {};
  return {
    who: WHO_OPTS.some(([v]) => v === a.who) ? a.who : DEFAULT_AID.who,
    spots: typeof a.spots === 'boolean' ? a.spots : DEFAULT_AID.spots,
    names: typeof a.names === 'boolean' ? a.names : DEFAULT_AID.names,
    hint: typeof a.hint === 'boolean' ? a.hint : DEFAULT_AID.hint,
  };
}

// その人（0 白・1 黒）に使う補助
function aidFor(aid, side) {
  const a = normAid(aid);
  const on = a.who === 'both' || a.who === KEYS[side];
  return { spots: on && a.spots, names: on && a.names, hint: on && a.hint };
}

function aidSummary(aid) {
  const a = normAid(aid);
  const parts = [];
  if (a.spots) parts.push('動ける所');
  if (a.names) parts.push('駒の名前と動き方');
  if (a.hint) parts.push('おすすめの手');
  if (a.who === 'none' || !parts.length) return '使わない';
  return WHO_OPTS.find(([v]) => v === a.who)[1] + '：' + parts.join('・');
}

// 補助の設定欄。変えるたびに onChange(新しい設定)
function aidEditor(root, aid, onChange) {
  const a = normAid(aid);
  const uid = root.id;
  root.replaceChildren();
  const fs = makeElement('fieldset', 'ch-fieldset');
  fs.append(makeElement('legend', 'ch-legend', '補助を使う人'));
  const seg = makeElement('div', 'ch-seg');
  WHO_OPTS.forEach(([v, label]) => {
    const lb = makeElement('label', 'ch-seg__opt');
    const r = makeElement('input');
    r.type = 'radio';
    r.name = uid + '-who';
    r.value = v;
    r.checked = a.who === v;
    r.addEventListener('change', () => { a.who = v; sync(); onChange({ ...a }); });
    lb.append(r, makeElement('span', '', label));
    seg.append(lb);
  });
  fs.append(seg);
  const checks = makeElement('div', 'ch-checks');
  const boxes = [];
  const mk = (key, label, sub) => {
    const lb = makeElement('label', 'ch-check');
    const c = makeElement('input');
    c.type = 'checkbox';
    c.checked = a[key];
    c.dataset.key = key;
    c.addEventListener('change', () => { a[key] = c.checked; sync(); onChange({ ...a }); });
    const txt = makeElement('span', 'ch-check__text');
    txt.append(makeElement('span', 'ch-check__label', label), makeElement('span', 'ch-check__sub', sub));
    lb.append(c, txt);
    checks.append(lb);
    boxes.push(c);
  };
  mk('spots', '動ける所を見せる', '駒を選ぶと、動ける所に点が出る（取れる所は輪）');
  mk('names', '駒の名前と動き方を出す', '盤の駒の下に名前が出る。駒を選ぶと、その駒の動き方が出る');
  mk('hint', 'おすすめの手を見られるようにする', '自分の番に「おすすめの手」を押すと、CPU が考えた手が光る');
  fs.append(checks);
  root.append(fs);
  function sync() {
    const off = a.who === 'none';
    boxes.forEach((c) => { c.disabled = off; });
    checks.classList.toggle('is-off', off);
  }
  sync();
}

/* ── 局面 ── */
// ルームに置く手の形 { f: 動かす前のます, t: 動かした先, q: ポーンがなった駒（'Q' など。なっていなければ置かない） }
const packMove = (m) => (m.promo ? { f: m.from, t: m.to, q: m.promo } : { f: m.from, t: m.to });
const unpackMove = (x) => ({ from: Number(x?.f), to: Number(x?.t), promo: E.PROMOS.includes(x?.q) ? x.q : '' });

// 指した手の記録から局面を作る。いちど作った局面は覚えておき、1手ずつ足す
const cache = { moves: [], G: null };
function engineOf(moves) {
  let G = null;
  let from = 0;
  if (cache.G && cache.moves.length <= moves.length && cache.moves.every((m, i) => E.sameMove(m, moves[i]))) {
    G = cache.G;
    from = cache.moves.length;
  } else {
    G = E.create();
  }
  for (let i = from; i < moves.length; i += 1) {
    const m = moves[i];
    // 読めない手（壊れた記録）があれば、そこまでの局面にする
    if (G.over || !E.legalMoves(G).some((x) => E.sameMove(x, m))) break;
    G = E.apply(G, m);
  }
  cache.moves = moves.slice(0, G.ply);
  cache.G = G;
  return G;
}

// 投了・時間切れもふくめた、対局のおわり（おわっていなければ null）
function overOf(rec, G) {
  if (rec.resign != null) return { winner: 1 - rec.resign, reason: 'resign' };
  if (rec.timeout != null) {
    // 時間が切れても、相手の駒がキングだけなら引き分け（FIDE の決まり。相手の駒でメイトにできる形がない）
    const opp = 1 - rec.timeout;
    const rest = G.board.some((p) => p && E.ownerOf(p) === opp && E.typeOf(p) !== 'K');
    return rest ? { winner: opp, reason: 'time' } : { winner: -1, reason: 'timedraw' };
  }
  return G.over;
}

// 補助の「白だけ・黒だけ」を入れかえる（白と黒の人が入れかわるとき、補助も人についていく）
function swapAid(aid) {
  const a = normAid(aid);
  return { ...a, who: a.who === 'w' ? 'b' : a.who === 'b' ? 'w' : a.who };
}

// 投了できる人。1台の画面は番の人。ルームは自分の席の人（相手の番でもよい）か、ホストが代わりに指している人
function resignSide(V) {
  if (V.over) return null;
  if (state.role === 'local') return V.cpu != null ? 1 - V.cpu : V.G.turn;
  if (V.mine(0) !== V.mine(1)) return V.mine(0) ? 0 : 1;
  if (V.mine(0) && V.mine(1)) return V.G.turn;
  return V.canPlay() ? V.G.turn : null;
}

/* ── 持ち時間・秒読み ──
   時計は { m: 持ち時間(分), b: 秒読み(秒), used: { s, g }: 使った持ち時間(ms), at: いまの番がはじまった時刻 }。
   指すたびに、指した人の used に使った時間を足し（持ち時間を超えた分は秒読みで、1手ごとにもとにもどる）、at を今にする。
   ルームの時刻は serverTimeOffset で合わせた RoomkRTDB.now()、1台の画面は Date.now() */
function normClockCfg(c) {
  const m = Number(c?.m);
  const b = Number(c?.b);
  return { m: CLOCK_MAIN_OPTS.includes(m) ? m : 0, b: CLOCK_BYO_OPTS.includes(b) ? b : 0 };
}
function newClock(cfg, now) {
  const c = normClockCfg(cfg);
  return c.m || c.b ? { m: c.m, b: c.b, used: { w: 0, b: 0 }, at: now } : null;
}
function readClock(x) {
  if (!x || typeof x !== 'object') return null;
  const c = normClockCfg(x);
  if (!c.m && !c.b) return null;
  const main = c.m * 60000;
  const u = (v) => Math.min(main, Math.max(0, Number(v) || 0));
  return { m: c.m, b: c.b, used: { w: u(x.used?.w), b: u(x.used?.b) }, at: Number(x.at) || 0 };
}
function clockSummary(cfg) {
  const c = normClockCfg(cfg);
  if (!c.m && !c.b) return 'なし';
  return (c.m ? c.m + '分' : '持ち時間なし') + (c.b ? '・秒読み ' + c.b + '秒' : '・秒読みなし');
}
// その人の残り。{ main: 持ち時間の残り(ms), byo: 秒読みの残り(ms。秒読みなしは null) }。turn が -1 なら、だれの番でもない
function clockLeft(c, side, turn, now) {
  const byo = c.b * 1000;
  const base = c.m * 60000 - c.used[KEYS[side]];
  if (side !== turn) return { main: base, byo: c.b ? byo : null };
  const e = Math.max(0, now - c.at);
  if (e <= base) return { main: base - e, byo: c.b ? byo : null };
  return { main: 0, byo: c.b ? Math.max(0, byo - (e - base)) : null };
}
const clockDeadline = (c, turn) => c.at + (c.m * 60000 - c.used[KEYS[turn]]) + c.b * 1000;
const clockLate = (c, turn, now) => now > clockDeadline(c, turn) + CLOCK_GRACE_MS;
function clockAfterMove(c, mover, now) {
  const k = KEYS[mover];
  const used = { ...c.used, [k]: Math.min(c.m * 60000, c.used[k] + Math.max(0, now - c.at)) };
  return { m: c.m, b: c.b, used, at: now };
}
// 1手もどしたあとは、使った時間はそのままで、番の人の時計を今から動かす
const clockRestart = (c, now) => ({ m: c.m, b: c.b, used: { ...c.used }, at: now });
// 指した・おわったときの時計。CPU の番は使った時間を足さない（CPU は時間を使わない）
const settleClock = (c, mover, now, cpu) => (cpu ? clockRestart(c, now) : clockAfterMove(c, mover, now));
function fmtClock(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
// 持ち時間をえらぶ2つの欄（持ち時間・秒読み）
function clockSelects(mainSel, byoSel, cfg) {
  const c = normClockCfg(cfg);
  mainSel.replaceChildren(...CLOCK_MAIN_OPTS.map((m) => {
    const o = makeElement('option', '', m ? m + '分' : 'なし');
    o.value = String(m);
    return o;
  }));
  byoSel.replaceChildren(...CLOCK_BYO_OPTS.map((b) => {
    const o = makeElement('option', '', b ? b + '秒' : 'なし');
    o.value = String(b);
    return o;
  }));
  mainSel.value = String(c.m);
  byoSel.value = String(c.b);
}
const clockFromSelects = (mainSel, byoSel) => normClockCfg({ m: mainSel.value, b: byoSel.value });

/* ── ルームの席の CPU ── */
const cpuLevelOfSeat = (name) => (typeof name === 'string' && name.startsWith(CPU_SEAT) ? levelOf(name.slice(CPU_SEAT.length)) : null);
const seatLabel = (name) => (cpuLevelOfSeat(name) ? 'CPU（' + LEVEL_NAMES[cpuLevelOfSeat(name)] + '）' : name);
// CPU の席（0・1）。CPU がいなければ null
function cpuSideOf(game) {
  const side = KEYS.findIndex((k) => cpuLevelOfSeat(game.seats[k]) != null);
  return side < 0 ? null : side;
}

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

function memberNames(room) {
  return byJoined(Object.entries(room?.players || {}));
}

function guestNames(room) {
  return memberNames(room).filter((name) => !room.players[name].isHost);
}

function proxyNames(room) {
  return byJoined(Object.entries(room?.proxies || {}));
}

function seatable(room, name) {
  return typeof name === 'string' && (!!room?.players?.[name] || !!room?.proxies?.[name] || cpuLevelOfSeat(name) != null);
}

function seatsOf(room) {
  const s = room?.seats || {};
  return { w: typeof s.w === 'string' ? s.w : null, b: typeof s.b === 'string' ? s.b : null };
}

const sideOfKey = (k) => (k === 'w' ? 0 : k === 'b' ? 1 : null);

// 対局を読む。壊れた値は読み飛ばす
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const seats = g.seats || {};
  const uids = g.uids || {};
  const proxy = g.proxy || {};
  const moves = [];
  for (const x of asList(g.moves)) {
    const m = unpackMove(x);
    if (!Number.isInteger(m.to) || !Number.isInteger(m.from)) break;
    moves.push(m);
  }
  return {
    id: Number(g.id) || 0,
    seats: { w: typeof seats.w === 'string' ? seats.w : null, b: typeof seats.b === 'string' ? seats.b : null },
    uids: { w: uids.w || null, b: uids.b || null },
    proxy: { w: proxy.w === true, b: proxy.b === true },
    moves,
    resign: sideOfKey(g.resign),
    timeout: sideOfKey(g.timeout),
    clock: readClock(g.clock),
    // 局面が変わるたびに増える番号（指す・投了・宣言・1手もどす）。古い操作の照合に使う
    rev: Number(g.rev) || 0,
    // 一度でもおわったか（もどしても消さない。finish を1対局に1回だけ数えるため）
    ended: g.ended === true,
  };
}

function seatPresent(room, game, side) {
  const k = KEYS[side];
  return game.proxy[k] || cpuLevelOfSeat(game.seats[k]) != null || !!room?.players?.[game.seats[k]];
}

// その人の番に、この端末が指してよいか。ホストは、端末なしの人と通信が切れた人の代わりに指せる
function mayMove(room, game, side, uid, nickname, role) {
  if (role !== 'host' && role !== 'guest') return false;
  const k = KEYS[side];
  const isHost = role === 'host' && room.hostUid === uid;
  // CPU の手は、ホストの端末が考えて書く
  if (game.proxy[k] || cpuLevelOfSeat(game.seats[k]) != null) return isHost;
  if (game.seats[k] === nickname && game.uids[k] === uid) return true;
  return isHost && !room.players?.[game.seats[k]];
}

function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAY) return false;
  return KEYS.some((k) => game.seats[k] === name && (game.proxy[k] || (game.uids[k] && game.uids[k] !== uid)));
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
    console.warn('[chess] expired room cleanup failed', error);
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
  state.timeoutKey = null;
  $('board').replaceChildren();
  $('sideTop').replaceChildren();
  $('sideBottom').replaceChildren();
  $('lobbyAid')._key = null;
  state.sel = null;
  state.selKey = null;
  state.msg = '';
  state.flip = false;
  state.promo = null;
  state.drawnKey = null;
  state.drawnRev = -1;
  state.drawnPly = -1;
  if ($('aidDialog').open) $('aidDialog').close();
  if ($('lobbySetDialog').open) $('lobbySetDialog').close();
  if ($('promoDialog').open) $('promoDialog').close();
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  stopCpu();
  stopClock();
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
    orphanAt: null,
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
  setHostOff(false);
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
    console.warn('[chess] room listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });

  state.connectedRef = db.ref('.info/connected');
  state.connectedCallback = (snap) => {
    state.isConnected = snap.val() === true;
    if (state.isConnected && state.roomRef === ref) {
      state.presenceDirty = true;
      ensurePresence(true);
    }
    // ホストの通信が切れたら CPU を止め、もどったら CPU の番かを見なおす
    if (state.role === 'host' && state.roomRef === ref) {
      if (!state.isConnected) stopCpu();
      else if (state.room && state.currentScreen === 'game') renderGame();
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
  state.timerInterval = setInterval(tickRoom, 1000);
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
      await ref.transaction((room) => {
        if (!room || room.hostUid !== uid || isExpired(room)) return;
        if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
        return { ...room, hostConnected: true, hostDisconnectedAt: null };
      });
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
        // 戻るときは参加したときの順番のまま。対局中の席の人は人数の上限を見ない
        const game = gameOf(room);
        const seated = room.status === STATUS.PLAY && game && KEYS.some((k) => game.seats[k] === nickname);
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
    console.warn('[chess] presence recovery failed', error);
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
          aid: { ...DEFAULT_AID },
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
    console.warn('[chess] create failed', err);
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
      const seated = room.status === STATUS.PLAY && game && KEYS.some((k) => game.seats[k] === nickname);
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
        const k = KEYS.find((x) => !seats[x]);
        if (k && !KEYS.some((x) => seats[x] === nickname)) next.seats = { ...seats, [k]: nickname };
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
    console.warn('[chess] join failed', err);
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
  const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoLocal', 'btnGoWatch'];
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
    console.warn('[chess] reconnect failed', error);
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
      // 自分の在室だけを消す。待合室なら席も空ける（対局中の席は残し、ホストが代わりに指せる）
      await ref.transaction((room) => {
        if (!room) return;
        const mine = room.players?.[nickname];
        if (mine && mine.uid !== uid) return;
        const players = { ...(room.players || {}) };
        delete players[nickname];
        const next = { ...room, players };
        if (room.status === STATUS.WAITING) {
          const seats = seatsOf(room);
          KEYS.forEach((k) => { if (seats[k] === nickname) seats[k] = null; });
          next.seats = seats;
        }
        return next;
      });
    }
  } catch (error) {
    console.warn('[chess] leave failed', error);
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
    history.replaceState(null, '', location.pathname + '?watch=' + code);
    return true;
  } catch (error) {
    console.warn('[chess] watch failed', error);
    fail('接続できませんでした。もう一度ためしてね');
    return false;
  } finally {
    state.busy = false;
    $('btnWatchOpen').disabled = false;
  }
}

function connectWatch(code, ref) {
  state.role = 'spectator';
  document.title = 'みんなにみせる画面 | チェス | あそびのたな';
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
    console.warn('[chess] watch listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });
}

// ホストが切断している間はオーバーレイを出し、期限切れになったら終わりの表示にする（ルームは消さない）
function updateWatchOverlay(room) {
  const off = room.hostConnected === false;
  setHostOff(off);
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

function stopWatch() {
  clearTimeout(state.watchTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null });
  resetBoxes();
  setHostOff(false);
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
    console.warn('[chess] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

async function setSeat(k, name) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    if (name && !seatable(room, name)) return;
    const seats = seatsOf(room);
    const other = k === 'w' ? 'b' : 'w';
    if (name && seats[other] === name) seats[other] = seats[k]; // 反対の席にいた人なら入れかえる
    seats[k] = name || null;
    return { ...room, seats };
  }, '席を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) renderRoom(state.room);
}

async function swapSeats() {
  await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const s = seatsOf(room);
    return { ...room, seats: { w: s.b, b: s.w }, aid: swapAid(room.aid) };
  }, '入れかえられませんでした。もう一度ためしてね', false);
}

// 補助はいつでも変えられる（あそんでいる間も）。続けて変えても取りこぼさないよう、ロックを使わない
async function setAid(aid) {
  const ok = await hostTransaction((room) => ({ ...room, aid: normAid(aid) }), '補助を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) {
    $('lobbyAid')._key = null;
    renderRoom(state.room);
  }
}

async function setClock(cfg) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const c = normClockCfg(cfg);
    return { ...room, clock: c.m || c.b ? c : null };
  }, '持ち時間を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) {
    $('lobbyClock')._key = null;
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
    const seats = seatsOf(room);
    if (room.players?.[name] || room.proxies?.[name] || name === room.host || seats.w === name || seats.b === name) { reason = '「' + name + '」はもういるよ'; return; }
    if (proxyNames(room).length >= MAX_PROXIES) { reason = '端末なしの参加者は' + MAX_PROXIES + '人までだよ'; return; }
    const next = { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
    const k = KEYS.find((x) => !seats[x]);
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
    KEYS.forEach((k) => { if (seats[k] === name) seats[k] = null; });
    return { ...room, proxies: Object.keys(proxies).length ? proxies : null, seats };
  }, '外せませんでした。もう一度ためしてね');
}

// 席の2人で新しい対局を作る（そろっていなければ null）
function newGameFor(room, seats) {
  if (!seats.w || !seats.b || seats.w === seats.b) return null;
  if (!seatable(room, seats.w) || !seatable(room, seats.b)) return null;
  // CPU どうしにはしない
  if (cpuLevelOfSeat(seats.w) != null && cpuLevelOfSeat(seats.b) != null) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const proxy = {};
  const uids = {};
  KEYS.forEach((k) => {
    if (cpuLevelOfSeat(seats[k]) != null) return;
    if (room.proxies?.[seats[k]]) proxy[k] = true;
    else uids[k] = room.players[seats[k]].uid;
  });
  return { id, seats: { ...seats }, uids, proxy, rev: 0, clock: newClock(room.clock, RoomkRTDB.now()) };
}

function countStart(game) {
  window.RoomkStats?.count('start');
  if (game?.clock) window.RoomkStats?.count('clock');
  if (game && KEYS.some((k) => cpuLevelOfSeat(game.seats[k]) != null)) window.RoomkStats?.count('room-cpu');
  window.RoomkStats?.count('players-2');
}

async function startGame() {
  await waitTimeSync();
  let v = null;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const game = newGameFor(room, seatsOf(room));
    if (!game) return;
    v = game;
    return { ...room, status: STATUS.PLAY, lastGameId: game.id, game };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) countStart(v);
  else if (ok === false) toast('対戦する2人を選んでね');
}

async function undoMove() {
  await waitTimeSync();
  const before = gameOf(state.room);
  if (!before) return;
  const gid = before.id;
  const rev = before.rev;
  if (before.timeout != null) return;
  const cpuSide = cpuSideOf(before);
  const what = before.resign != null ? '投了を取り消すよ'
    : cpuSide != null ? 'CPU の手と、その前の手を取り消すよ' : '直前に指した手を取り消すよ';
  if (!window.confirm('1手もどす？（' + what + '）')) return;
  const ok = await hostTransaction((room) => {
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid || game.rev !== rev || game.timeout != null) return;
    const next = { ...room.game, rev: game.rev + 1, resign: null };
    const valid = game.moves.slice(0, engineOf(game.moves).ply);
    if (game.resign == null) {
      if (!valid.length) return;
      let moves = valid.slice(0, -1);
      // CPU と対戦しているときは、人の番までもどす（CPU の手と、その前の人の手をいっしょに）
      if (cpuSide != null && engineOf(moves).turn === cpuSide) {
        if (!moves.length) return;
        moves = moves.slice(0, -1);
      }
      next.moves = moves.map(packMove);
    } else {
      next.moves = valid.map(packMove);
    }
    if (game.clock) next.clock = clockRestart(game.clock, RoomkRTDB.now());
    return { ...room, game: next };
  }, 'もどせませんでした。もう一度ためしてね');
  if (ok === false) toast('盤が進んだので、もどさなかったよ。もう一度ためしてね', false);
}

// もう一回（白と黒を入れかえる）
async function playAgain() {
  await waitTimeSync();
  const gid = gameOf(state.room)?.id;
  let reason = '';
  let v = null;
  const ok = await hostTransaction((room) => {
    reason = '';
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid) return;
    if (!overOf(game, engineOf(game.moves))) return;
    const seats = { w: game.seats.b, b: game.seats.w };
    const next = newGameFor(room, seats);
    if (!next) { reason = 'そろっていない'; return; }
    v = next;
    return { ...room, seats, aid: swapAid(room.aid), lastGameId: next.id, game: next };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('again');
    countStart(v);
  } else if (ok === false && reason) {
    toast('対戦した2人がそろっていないよ。「対戦する人を選びなおす」から選んでね');
  }
}

// 待合室にもどる（「対戦する人を選びなおす」・「この対局をやめる」）
async function backToLobby() {
  const game = gameOf(state.room);
  const gid = game?.id;
  const wasOver = !!game && !!overOf(game, engineOf(game.moves));
  if (!wasOver && !window.confirm('この対局をやめて、待合室にもどる？')) return;
  const ok = await hostTransaction((room) => {
    const cur = gameOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== gid) return;
    return { ...room, status: STATUS.WAITING, game: null, seats: { ...cur.seats } };
  }, 'もどれませんでした。もう一度ためしてね');
  if (ok && wasOver) window.RoomkStats?.count('again');
}

/* ── 指す・投了・宣言（ルーム） ── */
// kind: 'move'（m を指す）| 'resign'（投了）| 'timeout'（番の人の時間切れ）
// quiet: 書けなかったときに知らせを出さない（CPU の手・時間切れ）
async function actRoom(kind, m, side, quiet = false) {
  const game = gameOf(state.room);
  if (!game || !state.roomRef || state.moving) return false;
  const gid = game.id;
  const rev = game.rev;
  const uid = currentUid();
  const nickname = state.nickname;
  const role = state.role;
  let finished = false;
  let committed = false;
  state.moving = true;
  try {
    await waitTimeSync();
    const result = await state.roomRef.transaction((r) => {
      finished = false;
      if (!r || isExpired(r) || r.status !== STATUS.PLAY) return;
      const cur = gameOf(r);
      // 押した時点の対局・局面と同じときだけ（古い操作で次の手を変えない。1手もどしたあとも）
      if (!cur || cur.id !== gid || cur.rev !== rev) return;
      const G = engineOf(cur.moves);
      // 読めない手（壊れた記録）は落として、読める手までにそろえる
      const valid = cur.moves.slice(0, G.ply);
      if (overOf(cur, G)) return;
      const now = RoomkRTDB.now();
      const next = { ...r.game, rev: cur.rev + 1, moves: valid.map(packMove) };
      // 時間が切れたあとの手・宣言は、時間切れにする
      // CPU の番は時計を進めない（CPU は時間切れにならない）
      const cpuTurn = cpuSideOf(cur) === G.turn;
      let what = kind;
      if (kind === 'move' && cur.clock && !cpuTurn && clockLate(cur.clock, G.turn, now)) what = 'timeout';
      if (what === 'timeout') {
        if (!cur.clock || cpuTurn || !clockLate(cur.clock, G.turn, now)) return;
        // 時間切れを書けるのは、ホストと対局している人（見ている人は書かない）
        const seated = KEYS.some((k) => cur.seats[k] === nickname && cur.uids[k] === uid);
        if (!((role === 'host' && r.hostUid === uid) || (role === 'guest' && seated))) return;
        next.timeout = KEYS[G.turn];
        finished = true;
      // 投了は、自分の席なら相手の番でもできる。ほかは番の人だけ。CPU は投了しない
      } else if (!mayMove(r, cur, kind === 'resign' ? side : G.turn, uid, nickname, role)
        || (kind === 'resign' && cpuLevelOfSeat(cur.seats[KEYS[side]]) != null)) {
        return;
      } else if (kind === 'move') {
        if (!E.legalMoves(G).some((x) => E.sameMove(x, m))) return;
        next.moves = valid.concat([m]).map(packMove);
        if (cur.clock) next.clock = settleClock(cur.clock, G.turn, now, cpuTurn);
        finished = !!E.apply(G, m).over;
      } else if (kind === 'resign') {
        if (side !== 0 && side !== 1) return;
        next.resign = KEYS[side];
        finished = true;
      } else {
        return;
      }
      // 投了のときは、番の人の使った時間をそろえて止める（おわったあとに時計がもどって見えないように）
      if (cur.clock && kind === 'resign' && next.timeout == null) next.clock = settleClock(cur.clock, G.turn, now, cpuTurn);
      finished = finished && !cur.ended;
      next.ended = cur.ended || finished;
      return { ...r, game: next };
    });
    committed = result.committed;
    if (committed && finished) window.RoomkStats?.count('finish');
  } catch (error) {
    console.warn('[chess] move failed', error);
    toast('指せませんでした。もう一度ためしてね');
  } finally {
    state.moving = false;
  }
  if (!committed && kind === 'move' && !quiet) {
    state.msg = '盤が変わったので、指さなかったよ。もう一度選んでね。';
    if (state.room) renderGame();
  }
  return committed;
}

/* ── ルームで CPU が指す（2026-11-15 オーナー依頼）──
   待合室で席に「CPU（よわい・ふつう・つよい）」を選べる。CPU の番は、ホストの端末が CPU_MS 待ってから考えて書く。
   ホストの通信が切れている間は CPU も指さない（もどれば続きから） */
function scheduleRoomCpu(V) {
  if (state.role !== 'host' || !state.isConnected || !V || V.over || V.cpu == null || V.G.turn !== V.cpu) return;
  const level = cpuLevelOfSeat(V.rec.seats[KEYS[V.cpu]]);
  const key = V.key + ':' + V.rev;
  if (state.cpuKey === key) return;
  clearTimeout(state.cpuTimer);
  state.cpuKey = key;
  state.cpuTimer = setTimeout(async () => {
    state.cpuTimer = null;
    const W = viewModel();
    if (state.role !== 'host' || !W || W.over || W.key + ':' + W.rev !== key || W.G.turn !== W.cpu) return;
    // 待つ間に通信が切れたら指さない（もどったときに考えなおす）
    if (!state.isConnected) { state.cpuKey = null; return; }
    let ok = false;
    const m = E.cpuMove(W.G, level);
    // 考えている間に通信が切れたら書かない
    ok = m && state.isConnected ? await actRoom('move', m, null, true) : false;
    // 書けなかったとき（ほかの書きこみと重なったなど）は、少しあとで考えなおす
    if (!ok && state.cpuKey === key) {
      state.cpuKey = null;
      state.cpuTimer = setTimeout(() => { state.cpuTimer = null; if (state.role === 'host' && state.room) renderGame(); }, 1500);
    }
  }, CPU_MS);
}

/* ── 持ち時間の表示と時間切れ ── */
function stopClock() {
  clearInterval(state.clockTimer);
  state.clockTimer = null;
}
function syncClockTick(V) {
  const need = !!V && !!V.rec.clock && !V.over && state.currentScreen === 'game';
  if (need && !state.clockTimer) state.clockTimer = setInterval(updateClocks, 250);
  if (!need) stopClock();
}
function updateClocks() {
  const V = state.currentScreen === 'game' ? viewModel() : null;
  const c = V?.rec.clock;
  if (!c) { stopClock(); return; }
  const now = V.now();
  // CPU の番は、どちらの時計も止めて見せる
  const turn = V.over || V.G.turn === V.cpu ? -1 : V.G.turn;
  document.querySelectorAll('.ch-clock').forEach((node) => {
    const side = Number(node.dataset.side);
    let text;
    let low = false;
    if (V.over && V.over.reason === 'time' && V.over.winner !== side) {
      text = '時間切れ';
    } else {
      const left = clockLeft(c, side, turn, now);
      text = left.main > 0 || !c.b ? '残り ' + fmtClock(left.main) : '秒読み ' + Math.ceil(left.byo / 1000);
      low = side === turn && clockDeadline(c, turn) - now < 10000;
    }
    if (node.textContent !== text) node.textContent = text;
    node.classList.toggle('is-low', low);
  });
  if (turn >= 0 && clockLate(c, turn, now)) claimTimeout(V);
}
function claimTimeout(V) {
  const key = V.key + ':' + V.rev;
  if (state.timeoutKey === key) return;
  if (state.role === 'local') {
    state.timeoutKey = key;
    actLocal('timeout');
    return;
  }
  if (!(state.role === 'host' || V.mine(0) || V.mine(1))) return;
  state.timeoutKey = key;
  actRoom('timeout', null, null, true).then((ok) => {
    // 書けなかったら、1秒あとにもう一度ためす
    if (!ok) setTimeout(() => { if (state.timeoutKey === key) state.timeoutKey = null; }, 1000);
  });
}

/* ── 1台の画面 ── */
function saveLocal() {
  try {
    if (state.local) sessionStorage.setItem(LOCAL_KEY, JSON.stringify(state.local));
  } catch {
    // 保存できないときは、再読み込みで続きから戻れないだけ
  }
}

function loadLocal() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(LOCAL_KEY));
    if (!saved || typeof saved !== 'object') return null;
    const L = {
      names: [String(saved.names?.[0] || '').slice(0, 8), String(saved.names?.[1] || '').slice(0, 8)],
      aid: normAid(saved.aid),
      moves: asList(saved.moves).map((m) => ({ from: Number(m?.from), to: Number(m?.to), promo: E.PROMOS.includes(m?.promo) ? m.promo : '' }))
        .filter((m) => Number.isInteger(m.from) && Number.isInteger(m.to)),
      resign: saved.resign === 0 || saved.resign === 1 ? saved.resign : null,
      ended: saved.ended === true,
      rev: Number(saved.rev) || 0,
      cpu: cpuOf(saved.cpu),
      level: levelOf(saved.level),
      timeout: saved.timeout === 0 || saved.timeout === 1 ? saved.timeout : null,
      clock: readClock(saved.clock),
      cc: normClockCfg(saved.cc),
    };
    if (L.cpu != null) L.names[L.cpu] = CPU_NAME;
    // 読めない手は落とす
    L.moves = L.moves.slice(0, engineOf(L.moves).ply);
    return L;
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

/* ── CPU と対戦する（1台の画面だけ。2026-11-14 オーナー依頼「CPU と対戦できるようにして」）──
   CPU の側を選ぶと、その側は CPU が指す（名前は「CPU」）。指し手は engine.js の cpuMove（強さ よわい・ふつう・つよい）。
   CPU の番は CPU_MS 待ってから考えはじめる（どこに指したか見えるように）。ルームの CPU は scheduleRoomCpu（2026-11-15） */
const CPU_NAME = 'CPU';
const CPU_MS = 700;
const cpuOf = (v) => (v === 0 || v === 1 ? v : v === '0' ? 0 : v === '1' ? 1 : null);
const levelOf = (v) => (v === 'weak' || v === 'strong' ? v : 'normal');
const localVs = () => cpuOf(document.querySelector('input[name="localVs"]:checked')?.value);
const localLevel = () => levelOf(document.querySelector('input[name="localLevel"]:checked')?.value);
const cpuTurnKey = (L) => L.rev + ':' + L.moves.length;
function stopCpu() {
  clearTimeout(state.cpuTimer);
  state.cpuTimer = null;
  state.cpuKey = null;
}
function cpuThinking() {
  const L = state.local;
  if (state.role !== 'local' || !L || L.cpu == null) return false;
  const G = engineOf(L.moves);
  return !overOf(L, G) && G.turn === L.cpu;
}
function scheduleCpu() {
  const L = state.local;
  if (!cpuThinking()) return;
  const key = cpuTurnKey(L);
  if (state.cpuKey === key) return;
  clearTimeout(state.cpuTimer);
  state.cpuKey = key;
  state.cpuTimer = setTimeout(() => {
    state.cpuTimer = null;
    const cur = state.local;
    if (cur !== L || !cpuThinking() || cpuTurnKey(cur) !== key) return;
    const G = engineOf(cur.moves);
    const m = E.cpuMove(G, cur.level);
    if (m) actLocal('move', m);
  }, CPU_MS);
}
// CPU の側の名前の欄は、使わないので押せなくする
function syncLocalVs() {
  const cpu = localVs();
  [0, 1].forEach((side) => {
    const input = $('localName' + side);
    // CPU の側にした名前は消さずに取っておき、人にもどしたら入れなおす
    if (cpu === side && !input.disabled) { input.dataset.saved = input.value; input.value = ''; }
    if (cpu !== side && input.disabled) { input.value = input.dataset.saved || ''; input.dataset.saved = ''; }
    input.disabled = cpu === side;
    input.placeholder = cpu === side ? CPU_NAME : '';
  });
  $('btnLocalSwap').disabled = cpu != null;
  $('localLevelBox').hidden = cpu == null;
}

function openLocalSetup(names, cpu = null, level = 'normal', cc = null) {
  if (cc) state.localClock = normClockCfg(cc);
  clockSelects($('localClockMain'), $('localClockByo'), state.localClock);
  const radio = document.querySelector('input[name="localVs"][value="' + (cpuOf(cpu) ?? '') + '"]');
  if (radio) radio.checked = true;
  const lv = document.querySelector('input[name="localLevel"][value="' + levelOf(level) + '"]');
  if (lv) lv.checked = true;
  // 前の対局の名前を入れる（CPU の側は空にして、人にもどしたときも空のまま）
  [0, 1].forEach((side) => {
    const input = $('localName' + side);
    input.value = cpu === side ? '' : names?.[side] || '';
    input.dataset.saved = '';
    input.disabled = false;
  });
  syncLocalVs();
  state.localAid = normAid(state.localAid);
  aidEditor($('localAid'), state.localAid, (a) => { state.localAid = a; });
  showScreen('local');
}

function newLocal(names, aid, cpu = null, level = 'normal', cc = null) {
  const n = names.slice();
  if (cpu != null) n[cpu] = CPU_NAME;
  const c = normClockCfg(cc);
  return { names: n, aid: normAid(aid), moves: [], resign: null, timeout: null, ended: false, rev: 0, cpu, level: levelOf(level), cc: c, clock: newClock(c, Date.now()) };
}

function startLocal() {
  state.role = 'local';
  resetBoxes();
  stopCpu();
  state.localClock = clockFromSelects($('localClockMain'), $('localClockByo'));
  state.local = newLocal([$('localName0').value.trim().slice(0, 8), $('localName1').value.trim().slice(0, 8)], state.localAid, localVs(), localLevel(), state.localClock);
  saveLocal();
  window.RoomkStats?.count('local-start');
  if (state.local.clock) window.RoomkStats?.count('clock');
  showScreen('game');
  renderGame();
}

function actLocal(kind, m, side) {
  const L = state.local;
  const G = engineOf(L.moves);
  if (overOf(L, G)) return;
  let finished = false;
  const now = Date.now();
  // 時間が切れたあとの手は、時間切れにする
  const cpuTurn = L.cpu != null && G.turn === L.cpu;
  if (kind === 'move' && L.clock && !cpuTurn && clockLate(L.clock, G.turn, now)) kind = 'timeout';
  if (kind === 'timeout') {
    if (!L.clock || cpuTurn || !clockLate(L.clock, G.turn, now)) return;
    L.timeout = G.turn;
    finished = true;
  } else if (kind === 'move') {
    if (!E.legalMoves(G).some((x) => E.sameMove(x, m))) return;
    L.moves = L.moves.concat([m]);
    if (L.clock) L.clock = settleClock(L.clock, G.turn, now, cpuTurn);
    finished = !!E.apply(G, m).over;
  } else if (kind === 'resign') {
    // 投了したのは押した人（CPU と対戦するときは、CPU の番でも自分の側）
    const who = side === 0 || side === 1 ? side : G.turn;
    if (L.cpu != null && who === L.cpu) return;
    L.resign = who;
    finished = true;
  }
  if (L.clock && kind === 'resign') L.clock = settleClock(L.clock, G.turn, now, cpuTurn);
  L.rev += 1;
  if (finished && !L.ended) window.RoomkStats?.count('local-finish');
  L.ended = L.ended || finished;
  saveLocal();
  renderGame();
}

function undoLocal() {
  const L = state.local;
  if (L.timeout != null) return;
  if (L.resign != null) {
    L.resign = null;
  } else if (L.moves.length) {
    let moves = L.moves.slice(0, -1);
    // CPU と対戦するときは、自分の番までもどす（CPU の手と、その前の自分の手をいっしょに）
    if (L.cpu != null && engineOf(moves).turn === L.cpu) {
      if (!moves.length) return;
      moves = moves.slice(0, -1);
    }
    L.moves = moves;
  } else {
    return;
  }
  stopCpu();
  if (L.clock) L.clock = clockRestart(L.clock, Date.now());
  L.rev += 1;
  state.msg = '1手もどしたよ。';
  saveLocal();
  renderGame();
}

function quitLocal() {
  const L = state.local;
  if (L && !overOf(L, engineOf(L.moves)) && L.moves.length && !window.confirm('おわりにして、トップへ戻る？')) return;
  stopCpu();
  stopClock();
  clearLocal();
  state.local = null;
  state.role = null;
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
  // 対局中なのに対局の記録が読めない（壊れた）ときは、ホストが待合室へもどして続けられるようにする
  if (state.role === 'host' && room.status === STATUS.PLAY && !gameOf(room) && !state.repairing) {
    state.repairing = true;
    hostTransaction((r) => (r.status === STATUS.PLAY && !gameOf(r) ? { ...r, status: STATUS.WAITING, game: null } : undefined), '待合室にもどせませんでした', false)
      .finally(() => { state.repairing = false; });
  }
  updateHostOverlay(room);
  renderRoom(room);
}

function renderRoom(room) {
  const playing = room.status === STATUS.PLAY && !!gameOf(room);
  const next = playing ? 'game' : 'waiting';
  if (state.currentScreen !== next) {
    if ($('aidDialog').open) $('aidDialog').close();
    if ($('lobbySetDialog').open) $('lobbySetDialog').close();
    if ($('promoDialog').open) $('promoDialog').close();
    showScreen(next);
  }
  renderBar(room);
  if (playing) renderGame();
  else {
    stopClock();
    renderWaiting(room);
  }
}

// ホストの戻りを待つ画面は、ダイアログとして読ませ、うしろの画面を押せない・読まないようにする
const hostOffInert = new Set();
function setHostOff(show) {
  const o = $('hostOffOverlay');
  if (o.hidden === !show) return;
  o.hidden = !show;
  if (show) {
    for (const el of document.body.children) {
      if (el === o || el.tagName === 'SCRIPT' || el.tagName === 'DIALOG' || el.inert) continue;
      el.inert = true;
      hostOffInert.add(el);
    }
    $('btnOverlayLeave').focus({ preventScroll: true });
  } else {
    hostOffInert.forEach((el) => { el.inert = false; });
    hostOffInert.clear();
  }
}

function updateHostOverlay(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    setHostOff(true);
    // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす
    if (state.orphanTimer && state.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(state.orphanTimer); state.orphanTimer = null; }
    if (!state.orphanTimer) {
      state.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
      const ref = state.roomRef;
      const at = RoomkRTDB.getHostDisconnectedAt(room);
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
      state.orphanTimer = setTimeout(() => {
        state.orphanTimer = null;
        if (state.roomRef === ref && state.room) removeExpired(ref, state.room);
      }, delay);
    }
  } else {
    setHostOff(false);
    clearTimeout(state.orphanTimer);
    state.orphanTimer = null;
  }
}

function mySeat(room) {
  const game = gameOf(room);
  const seats = room.status === STATUS.PLAY && game ? game.seats : seatsOf(room);
  const k = KEYS.find((x) => seats[x] === state.nickname);
  return k ? sideOfKey(k) : null;
}

function renderBar(room) {
  let me = '';
  if (state.role === 'host' || state.role === 'guest') {
    const seat = mySeat(room);
    me = (state.role === 'host' ? 'ホスト' : state.nickname) + (seat != null ? '・あなたは' + SIDE[seat] : state.role === 'guest' ? '・観戦中' : '');
  }
  $('barMe').hidden = !me;
  $('barMe').textContent = me;
}

function renderWaiting(room) {
  const host = state.role === 'host';
  const watch = state.role === 'spectator';
  const seats = seatsOf(room);
  $('lobbyJoin').hidden = !watch;
  $('lobbyJoinCode').textContent = state.roomCode || '';

  // 席
  $('seatEdit').hidden = !host;
  $('seatView').hidden = host;
  const people = memberNames(room).concat(proxyNames(room));
  if (host) {
    KEYS.forEach((k, side) => {
      const sel = $('seat' + side);
      const empty = makeElement('option', '', '（えらんでね）');
      empty.value = '';
      const opts = [empty];
      people.forEach((name) => {
        const o = makeElement('option', '', name + (name === room.host ? '（自分）' : room.proxies?.[name] ? '（端末なし）' : ''));
        o.value = name;
        opts.push(o);
      });
      Object.keys(LEVEL_NAMES).forEach((lv) => {
        const o = makeElement('option', '', seatLabel(CPU_SEAT + lv));
        o.value = CPU_SEAT + lv;
        opts.push(o);
      });
      if (seats[k] && !people.includes(seats[k]) && cpuLevelOfSeat(seats[k]) == null) {
        const o = makeElement('option', '', seats[k] + '（いない）');
        o.value = seats[k];
        opts.push(o);
      }
      sel.replaceChildren(...opts);
      sel.value = seats[k] || '';
    });
  } else {
    $('seatView').replaceChildren(...KEYS.map((k, side) => {
      const box = makeElement('div', 'ch-seatview');
      box.append(makeElement('span', 'ch-seatview__color', SIDE[side] + (side === 0 ? '（先に指す）' : '')));
      const name = seats[k];
      const label = name ? seatLabel(name) + (name === state.nickname && !watch ? '（あなた）' : '') + (seatable(room, name) ? '' : '（いない）') : 'まだ決まっていない';
      box.append(makeElement('span', 'ch-seatview__name' + (name ? '' : ' is-empty'), label));
      return box;
    }));
  }
  const bothCpu = cpuLevelOfSeat(seats.w) != null && cpuLevelOfSeat(seats.b) != null;
  const ready = !!seats.w && !!seats.b && seats.w !== seats.b && seatable(room, seats.w) && seatable(room, seats.b) && !bothCpu;
  let note = '';
  if (host) {
    if (bothCpu) note = 'CPU どうしにはできないよ。片方は人を選んでね';
    else if (!ready && people.length < 2 && !seats.w && !seats.b) note = 'もう1人入ると、はじめられるよ。CPU と対戦するときは、片方の席で「CPU」を選んでね';
    else if (!ready) note = '白と黒を選んでね。ホストも対戦できるよ。席で「CPU」を選ぶと、CPU と対戦できる';
    else note = '白の人から先に指すよ';
  }
  $('seatNote').textContent = note;
  $('seatNote').hidden = !note;

  // 参加している人
  $('lobbyPeople').replaceChildren(...people.map((name) => {
    const proxy = !!room.proxies?.[name];
    const li = makeElement('li', 'ch-person');
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    li.append(msIcon(host && proxy ? 'person_off' : 'person'), makeElement('span', 'ch-person__name', name));
    if (name === room.host) li.append(makeElement('span', 'ch-tag ch-tag--muted', 'ホスト'));
    if (host && proxy) li.append(makeElement('span', 'ch-tag ch-tag--muted', '端末なし'));
    if (seats.w === name) li.append(makeElement('span', 'ch-tag ch-tag--w', '白'));
    else if (seats.b === name) li.append(makeElement('span', 'ch-tag ch-tag--b', '黒'));
    else li.append(makeElement('span', 'ch-tag ch-tag--watch', '観戦'));
    if (name === state.nickname && !watch) li.append(makeElement('span', 'ch-tag ch-tag--watch', 'あなた'));
    if (host && proxy) {
      const del = makeElement('button', 'ch-quiet ch-person__del', '外す');
      del.type = 'button';
      del.addEventListener('click', () => removeProxy(name));
      li.append(del);
    }
    return li;
  }));
  $('proxyForm').hidden = !host;

  // 設定（盤・持ち時間・補助）は、みんなには1行ずつのまとめで見せ、ホストは「設定を変える」のダイアログで変える
  $('sumClock').textContent = clockSummary(room.clock);
  $('sumAid').textContent = aidSummary(room.aid);
  $('btnLobbySet').hidden = !host;
  if (host) {
    const cKey = JSON.stringify(normClockCfg(room.clock));
    if ($('lobbyClock')._key !== cKey) {
      clockSelects($('clockMain'), $('clockByo'), room.clock);
      $('lobbyClock')._key = cKey;
    }
    const aKey = JSON.stringify(normAid(room.aid));
    if ($('lobbyAid')._key !== aKey) {
      aidEditor($('lobbyAid'), room.aid, (a) => { $('lobbyAid')._key = JSON.stringify(a); setAid(a); });
      $('lobbyAid')._key = aKey;
    }
  } else if ($('lobbySetDialog').open) {
    $('lobbySetDialog').close();
  }

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

// 画面に出すための共通の形にそろえる（1台の画面とルーム）
function viewModel() {
  if (state.role === 'local') {
    const L = state.local;
    const G = engineOf(L.moves);
    return {
      rec: L,
      G,
      over: overOf(L, G),
      aid: L.aid,
      name: (side) => L.names[side],
      away: () => false,
      proxy: () => false,
      cpu: L.cpu,
      canPlay: () => !overOf(L, G) && G.turn !== L.cpu,
      mine: (side) => L.cpu != null && side !== L.cpu,
      key: 'local',
      rev: L.rev,
      now: () => Date.now(),
    };
  }
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game) return null;
  const uid = currentUid();
  const G = engineOf(game.moves);
  const over = overOf(game, G);
  const cpu = cpuSideOf(game);
  return {
    rec: game,
    G,
    over,
    aid: room.aid,
    room,
    name: (side) => (side === cpu ? CPU_NAME : game.seats[KEYS[side]] || ''),
    away: (side) => !seatPresent(room, game, side),
    proxy: (side) => game.proxy[KEYS[side]],
    cpu,
    now: () => RoomkRTDB.now(),
    // CPU の番は、ホストの端末が自分で指す（人は押せない）
    canPlay: () => !over && G.turn !== cpu && mayMove(room, game, G.turn, uid, state.nickname, state.role),
    mine: (side) => (state.role === 'host' || state.role === 'guest') && game.seats[KEYS[side]] === state.nickname && game.uids[KEYS[side]] === uid,
    key: state.roomCode + ':' + game.id,
    rev: game.rev,
  };
}
const sideLabel = (V, side) => SIDE[side] + (V.name(side) ? '（' + V.name(side) + '）' : '');

// 結果の文は「白（名前）」のところで折り返さないよう、部品に分けて返す（名前の部分は { label }）
function overParts(V, o) {
  const L = (side) => ({ label: sideLabel(V, side) });
  if (o.reason === 'resign') return [L(1 - o.winner), 'が投了。', L(o.winner), 'の勝ち！'];
  if (o.reason === 'time') return [L(1 - o.winner), 'の時間が切れた。', L(o.winner), 'の勝ち！'];
  if (o.reason === 'timedraw') return ['時間が切れたけれど、相手の駒がキングだけなので引き分け'];
  if (o.reason === 'stalemate') return ['ステイルメイト（動かせる手がないけれど、チェックされていない）で引き分け'];
  if (o.reason === 'repetition') return ['同じ形が3回出たので引き分け'];
  if (o.reason === 'fifty') return ['50手のあいだ、ポーンが動かず駒も取られなかったので引き分け'];
  if (o.reason === 'material') return ['どちらも駒が足りなくてチェックメイトにできないので引き分け'];
  return ['チェックメイト。', L(o.winner), 'の勝ち！'];
}

// 補助の「駒の名前」を盤に出すか（だれか1人でも使うなら、全部の駒に出す）
function namesShown(aid) {
  const a = normAid(aid);
  return a.who !== 'none' && a.names;
}

// 見ている人から見て下にいる側（後ろの席の黒の人は黒を手前に。「盤の向きを変える」で逆に）
const bottomOf = (V) => (V.mine(1) && !V.mine(0) ? 1 : 0) ^ (state.flip ? 1 : 0);

function renderGame() {
  const V = viewModel();
  if (!V) return;
  const G = V.G;
  const local = state.role === 'local';
  const host = state.role === 'host';
  const can = V.canPlay();
  const selKey = V.key + ':' + V.rev;
  if (state.selKey !== selKey) {
    // 局面が変わったら、選んでいる駒・おすすめの手・知らせを消す（自分で「1手もどす」を押したときの知らせは残す）
    state.sel = null;
    state.hint = null;
    if (state.selKey && state.msg !== '1手もどしたよ。') state.msg = '';
    state.selKey = selKey;
    if (state.promo && $('promoDialog').open) $('promoDialog').close();
    state.promo = null;
  }
  if (!can) {
    state.sel = null;
    state.hint = null;
    // 何になるかを聞いている間に指せなくなったら（代わりに指していた人が戻ったなど）、聞くのをやめる
    if (state.promo) {
      state.promo = null;
      if ($('promoDialog').open) $('promoDialog').close();
    }
  }

  // いまの番・結果
  const st = $('gameStatus');
  st.replaceChildren();
  st.classList.toggle('is-result', !!V.over);
  st.classList.toggle('is-mine', can && !local && !V.over);
  if (V.over) {
    const line = makeElement('span', 'ch-result');
    for (const p of overParts(V, V.over)) line.append(typeof p === 'string' ? p : makeElement('span', 'ch-nowrap', p.label));
    st.append(line);
  } else {
    let line;
    if (local && V.cpu != null && G.turn === V.cpu) line = sideLabel(V, G.turn) + 'が考え中';
    else if (local && V.cpu != null) line = 'あなたの番（' + SIDE[G.turn] + '）';
    else if (local) line = sideLabel(V, G.turn) + 'の番';
    else if (V.mine(G.turn)) line = 'あなたの番（' + SIDE[G.turn] + '）';
    else if (can) line = sideLabel(V, G.turn) + 'の番。代わりに指してね';
    else line = sideLabel(V, G.turn) + 'が考え中';
    st.append(makeElement('span', '', line));
    if (G.check) st.append(makeElement('span', 'ch-check-badge', 'チェック'));
  }

  const bottom = bottomOf(V);
  renderBoard(V, bottom, can);
  renderSide($('sideTop'), V, 1 - bottom);
  renderSide($('sideBottom'), V, bottom);
  renderInfo(V, can);

  $('gameMsg').textContent = state.msg;
  $('lastLine').textContent = G.last ? G.ply + '手目　' + SIDE[1 - G.turn] + '：' + G.last.text + '（' + G.last.san + '）' : '';

  // おすすめの手
  const hintOn = can && !V.over && aidFor(V.aid, G.turn).hint;
  $('hintBox').hidden = !hintOn;
  $('btnHint').disabled = false;
  $('btnHint').textContent = 'おすすめの手を見る';
  if (!state.hint) $('hintText').textContent = '';

  // 結果のあとのボタン
  $('resultBox').hidden = !V.over || state.role === 'spectator';
  if (V.over) {
    $('resultHost').hidden = !(host || local);
    $('resultWait').hidden = host || local;
    $('btnAgain').textContent = local && !V.name(0) && !V.name(1) ? 'もう一回あそぶ' : 'もう一回（白と黒を入れかえる）';
    $('btnRelobby').textContent = local ? '相手と補助を変える' : '対戦する人を選びなおす';
  }

  // そのほかの操作
  const rec = V.rec;
  $('btnUndo').hidden = !(host || local);
  // CPU と対戦するときは、人がまだ指していなければもどせない（CPU が白で1手目のあと）。時間切れはもどせない
  const ownMoves = V.cpu != null ? rec.moves.filter((m, i) => i % 2 !== V.cpu).length : rec.moves.length;
  $('btnUndo').disabled = rec.timeout != null || (!ownMoves && rec.resign == null);
  $('btnAid').hidden = !(host || local);
  $('btnResign').hidden = resignSide(V) == null;
  $('btnReset').hidden = !(host || local);
  $('btnReset').textContent = local ? '最初からやりなおす' : 'この対局をやめる';
  if (local) scheduleCpu();
  else scheduleRoomCpu(V);
  $('btnQuit').hidden = !local;
  updateClocks();
  syncClockTick(V);
}

/* ── 盤と駒 ── */
// 駒の形（記号）と、補助の名前。白の駒は白く、黒の駒は黒く塗る
function pieceNode(c, withName) {
  const t = E.typeOf(c);
  const node = makeElement('span', 'ch-piece ' + (E.ownerOf(c) === 0 ? 'is-white' : 'is-black'));
  node.append(makeElement('span', 'ch-piece__glyph', GLYPH[t] + '︎'));
  if (withName) node.append(makeElement('span', 'ch-piece__name', E.NAME[t]));
  return node;
}

function selTargets(G) {
  if (!state.sel) return [];
  return E.legalMoves(G).filter((m) => m.from === state.sel.from);
}

function renderBoard(V, bottom, can) {
  const G = V.G;
  const root = $('board');
  const turnAid = aidFor(V.aid, G.turn);
  const targets = can ? selTargets(G) : [];
  const targetSet = new Set(targets.map((m) => m.to));
  const checkKing = G.check && (!V.over || V.over.reason === 'mate') ? E.kingSquare(G.board, G.turn) : -1;
  const names = namesShown(V.aid);
  const hint = can && state.hint ? state.hint : null;
  // 同じ対局で1手すすんだときだけ、動かした駒に動きを付ける
  const animate = state.drawnKey === V.key && V.rev === state.drawnRev + 1 && G.ply === state.drawnPly + 1 && !!G.last;
  const flip = bottom === 1;
  const board = makeElement('div', 'ch-board' + (names ? ' has-names' : ''));
  board.setAttribute('role', 'grid');
  board.setAttribute('aria-label', '盤');
  for (let vr = 0; vr < 8; vr += 1) {
    const r = flip ? 7 - vr : vr;
    board.append(makeElement('span', 'ch-coord ch-coord--rank', String(8 - r)));
    for (let vc = 0; vc < 8; vc += 1) {
      const c = flip ? 7 - vc : vc;
      const i = r * 8 + c;
      const cell = makeElement('button', 'ch-cell ' + ((r + c) % 2 ? 'is-dark' : 'is-light'));
      cell.type = 'button';
      cell.dataset.i = String(i);
      cell.setAttribute('role', 'gridcell');
      const p = G.board[i];
      let label = E.squareName(i);
      if (G.last && G.last.to === i) cell.classList.add('is-last');
      if (G.last && G.last.from === i) cell.classList.add('is-lastfrom');
      if (state.sel && state.sel.from === i) cell.classList.add('is-sel');
      if (i === checkKing) cell.classList.add('is-check');
      if (hint && (hint.from === i || hint.to === i)) cell.classList.add('is-hint');
      if (p) {
        const piece = pieceNode(p, names);
        if (animate && G.last.to === i) piece.classList.add('is-new');
        cell.append(piece);
        label += ' ' + SIDE[E.ownerOf(p)] + 'の' + E.pieceName(p);
      } else {
        label += ' 空き';
      }
      if (targetSet.has(i) && turnAid.spots) {
        const take = !!p || targets.some((m) => m.to === i && E.isEnPassant(G, m));
        cell.append(makeElement('span', 'ch-spot' + (take ? ' ch-spot--take' : '')));
      }
      cell.classList.toggle('is-playable', can && (targetSet.has(i) || (!!p && E.ownerOf(p) === G.turn)));
      cell.disabled = !can;
      cell.setAttribute('aria-label', label);
      cell.addEventListener('click', () => onCell(i));
      board.append(cell);
    }
  }
  board.append(makeElement('span', 'ch-coord'));
  for (let vc = 0; vc < 8; vc += 1) {
    const c = flip ? 7 - vc : vc;
    board.append(makeElement('span', 'ch-coord ch-coord--file', E.FILES[c]));
  }
  // 盤は描くたびに作りなおすので、キーボードで選んでいたますにもどす
  const focusedCell = root.contains(document.activeElement) ? document.activeElement.dataset.i : null;
  root.replaceChildren(board);
  if (focusedCell != null) board.querySelector('.ch-cell[data-i="' + focusedCell + '"]')?.focus({ preventScroll: true });
  state.drawnKey = V.key;
  state.drawnRev = V.rev;
  state.drawnPly = G.ply;
}

function renderSide(box, V, side) {
  const G = V.G;
  const turn = !V.over && G.turn === side;
  box.replaceChildren();
  box.classList.toggle('is-turn', turn);
  const head = makeElement('div', 'ch-side__head');
  head.append(makeElement('span', 'ch-side__dot ' + (side === 0 ? 'is-white' : 'is-black')), makeElement('span', 'ch-side__label', SIDE[side] + (V.mine(side) ? '（あなた）' : '')));
  if (V.name(side)) head.append(makeElement('span', 'ch-side__name', V.name(side)));
  if (turn) head.append(makeElement('span', 'ch-tag ch-tag--turn', 'の番'));
  // 持ち時間（中身は updateClocks が入れる）
  if (V.rec.clock) {
    const clock = makeElement('span', 'ch-clock');
    clock.dataset.side = String(side);
    head.append(clock);
  }
  if (V.over && V.over.winner === side) head.append(makeElement('span', 'ch-tag ch-tag--win', '勝ち'));
  if (V.away(side)) head.append(makeElement('span', 'ch-tag ch-tag--warn', '通信が切れた'));
  // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
  if (state.role === 'host' && V.proxy(side)) head.append(makeElement('span', 'ch-tag ch-tag--muted', '端末なし'));
  box.append(head);

  // 取った駒（相手の色で、高い駒から）
  const caps = E.capturedLists(G.board)[side];
  const row = makeElement('div', 'ch-caps');
  row.setAttribute('aria-label', SIDE[side] + 'が取った駒');
  if (!caps.length) row.append(makeElement('span', 'ch-caps__none', '取った駒なし'));
  caps.forEach((t) => {
    const c = side === 0 ? t.toLowerCase() : t;
    const node = pieceNode(c, false);
    node.setAttribute('aria-label', E.NAME[t]);
    node.setAttribute('role', 'img');
    row.append(node);
  });
  box.append(row);
}

// 補助の「駒の名前と動き方」: 選んだ駒の動き方。キャスリング・アンパッサン・成る手があれば、そのことも書く
function renderInfo(V, can) {
  const box = $('pieceInfo');
  const G = V.G;
  const on = can && !V.over && aidFor(V.aid, G.turn).names;
  box.hidden = !on;
  if (!on) return;
  box.replaceChildren();
  const p = state.sel ? G.board[state.sel.from] : '';
  if (!p) {
    box.append(makeElement('p', 'ch-info__empty', '自分の駒を押すと、名前と動き方が出るよ。'));
    return;
  }
  const t = E.typeOf(p);
  const head = makeElement('p', 'ch-info__head');
  head.append(pieceNode(p, false), makeElement('span', 'ch-info__name', E.NAME[t]));
  box.append(head, makeElement('p', 'ch-info__how', E.HOW[t]));
  const moves = selTargets(G);
  const extra = [];
  if (moves.some((m) => E.isCastle(G, m))) extra.push('キャスリングができるよ。キングを横に2マス動かすと、ルークがキングの反対側へとびこえてくる（キングもルークも、まだ一度も動いていないときだけ）');
  if (moves.some((m) => E.isEnPassant(G, m))) extra.push('アンパッサンができるよ。となりの相手のポーンが2マス進んできたすぐあとだけ、1マス進んだとみなして、ななめ前へ動いて取れる');
  if (moves.some((m) => m.promo)) extra.push('いちばん奥まで進むと、クイーン・ルーク・ビショップ・ナイトのどれかになれる');
  extra.forEach((x) => box.append(makeElement('p', 'ch-info__extra', x)));
}

/* ── 押したとき ── */
function onCell(i) {
  const V = viewModel();
  if (!V || !V.canPlay()) return;
  const G = V.G;
  const p = G.board[i];
  state.msg = '';
  if (state.sel) {
    const cand = selTargets(G).filter((m) => m.to === i);
    if (cand.length > 1) { openPromo(cand); return; }
    if (cand.length === 1) { play(cand[0]); return; }
    if (p && E.ownerOf(p) === G.turn) {
      state.sel = state.sel.from === i ? null : { from: i };
      if (state.sel && !selTargets(G).length) state.msg = noMoveReason(G, i);
      renderGame();
      return;
    }
    state.msg = E.whyIllegal(G, state.sel.from, i) || 'そこには指せないよ。';
    state.sel = null;
    renderGame();
    return;
  }
  if (p && E.ownerOf(p) === G.turn) {
    state.sel = { from: i };
    if (!selTargets(G).length) state.msg = noMoveReason(G, i);
    renderGame();
  } else if (p) {
    state.msg = 'それは相手の駒だよ。自分の' + SIDE[G.turn] + 'の駒を押してね。';
    renderGame();
  }
}

function noMoveReason(G, i) {
  const raw = E.pseudoMoves(G).filter((m) => m.from === i);
  if (!raw.length) return 'その駒は、いま動ける所がないよ。';
  return E.whyIllegal(G, i, raw[0].to) || 'その駒は、いま動ける所がないよ。';
}

function play(m) {
  state.sel = null;
  state.promo = null;
  state.hint = null;
  if (state.role === 'local') actLocal('move', m);
  else actRoom('move', m);
}

// おすすめの手（その局面で CPU が考えた手を光らせ、その駒を選んだ形にする。ルームには書かない）
function showHint() {
  const V = viewModel();
  if (!V || !V.canPlay() || V.over || !aidFor(V.aid, V.G.turn).hint) return;
  const key = V.key + ':' + V.rev;
  $('btnHint').disabled = true;
  $('btnHint').textContent = '考えているよ…';
  // ボタンの字が変わってから考えはじめる
  setTimeout(() => {
    const W = viewModel();
    if (!W || W.key + ':' + W.rev !== key || !W.canPlay()) return;
    const m = E.cpuMove(W.G, 'hint');
    if (!m) return;
    state.hint = { from: m.from, to: m.to };
    state.sel = { from: m.from };
    state.msg = '';
    window.RoomkStats?.count('hint');
    renderGame();
    const p = W.G.board[m.from];
    const what = E.isCastle(W.G, m) ? 'キャスリング（キングを ' + E.squareName(m.from) + ' から ' + E.squareName(m.to) + ' へ）'
      : E.pieceName(p) + 'を ' + E.squareName(m.from) + ' から ' + E.squareName(m.to) + ' へ' + (m.promo ? '（' + E.NAME[m.promo] + 'になる）' : '');
    $('hintText').textContent = 'おすすめ：' + what + '。光っているマスを押すと指せるよ。';
  }, 30);
}

function openPromo(cands) {
  state.promo = cands;
  const me = state.role === 'local' ? engineOf(state.local.moves).turn : viewModel().G.turn;
  $('promoChoices').replaceChildren(...E.PROMOS.map((q) => {
    const b = makeElement('button', 'ch-choice');
    b.type = 'button';
    const pc = makeElement('span', 'ch-choice__piece');
    pc.append(pieceNode(me === 0 ? q : q.toLowerCase(), false));
    b.append(pc, makeElement('span', '', E.NAME[q]));
    b.addEventListener('click', () => closePromo(q));
    return b;
  }));
  $('promoDialog').showModal();
  $('promoChoices').firstChild.focus();
}

function closePromo(choice) {
  const cands = state.promo;
  if ($('promoDialog').open) $('promoDialog').close();
  state.promo = null;
  if (!cands || choice == null) {
    // やめたときは、選んでいたポーンも選ばないにもどす
    state.sel = null;
    renderGame();
    return;
  }
  play(cands.find((m) => m.promo === choice));
}

function resign() {
  const V = viewModel();
  const side = V ? resignSide(V) : null;
  if (side == null) return;
  const who = state.role === 'local' || !V.mine(side) ? sideLabel(V, side) + 'が' : '';
  if (!window.confirm(who + '投了する？（負けを認めて、この対局を終わりにするよ）')) return;
  if (state.role === 'local') actLocal('resign', null, side);
  else actRoom('resign', null, side);
}

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
$('btnGoLocal').addEventListener('click', () => openLocalSetup(null));
$('btnGoWatch').addEventListener('click', () => {
  setError('watchError', '');
  showScreen('watch-join');
});
['btnCreateBack', 'btnJoinBack', 'btnWatchBack', 'btnLocalBack', 'btnWatchEndTop'].forEach((id) => {
  $(id).addEventListener('click', () => showScreen('top'));
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

$('seat0').addEventListener('change', (event) => setSeat('w', event.currentTarget.value));
$('seat1').addEventListener('change', (event) => setSeat('b', event.currentTarget.value));
$('btnSeatSwap').addEventListener('click', swapSeats);
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnStartGame').addEventListener('click', startGame);
['clockMain', 'clockByo'].forEach((id) => $(id).addEventListener('change', () => setClock(clockFromSelects($('clockMain'), $('clockByo')))));

$('btnLocalSwap').addEventListener('click', () => {
  const a = $('localName0').value;
  $('localName0').value = $('localName1').value;
  $('localName1').value = a;
});
$('btnLocalStart').addEventListener('click', startLocal);
document.querySelectorAll('input[name="localVs"]').forEach((r) => r.addEventListener('change', syncLocalVs));

$('btnHint').addEventListener('click', showHint);
$('btnPromoCancel').addEventListener('click', () => closePromo(null));
// Esc で閉じたときも、選んだ手を取り消す
$('promoDialog').addEventListener('cancel', (event) => { event.preventDefault(); closePromo(null); });

$('btnUndo').addEventListener('click', () => {
  if (state.role === 'local') undoLocal();
  else if (state.role === 'host') undoMove();
});
$('btnFlip').addEventListener('click', () => {
  state.flip = !state.flip;
  renderGame();
});
$('btnAid').addEventListener('click', () => {
  const cur = state.role === 'local' ? state.local.aid : state.room?.aid;
  aidEditor($('dialogAid'), cur, (a) => {
    if (state.role === 'local') {
      state.local.aid = a;
      saveLocal();
      renderGame();
    } else {
      setAid(a);
    }
  });
  $('aidDialog').showModal();
});
$('btnAidClose').addEventListener('click', () => $('aidDialog').close());
$('btnLobbySet').addEventListener('click', () => {
  const d = $('lobbySetDialog');
  d.showModal();
  // 開いたときは見出しから見せる（はじめに選べる欄へ飛んで、見出しが隠れないように）
  $('lobbySetTitle').focus({ preventScroll: true });
  d.scrollTop = 0;
});
$('btnLobbySetClose').addEventListener('click', () => $('lobbySetDialog').close());
$('btnResign').addEventListener('click', resign);
$('btnReset').addEventListener('click', () => {
  if (state.role === 'local') {
    const L = state.local;
    if (!overOf(L, engineOf(L.moves)) && L.moves.length && !window.confirm('最初からやりなおす？')) return;
    stopCpu();
    state.timeoutKey = null;
    state.local = newLocal(L.names, L.aid, L.cpu, L.level, L.cc);
    state.local.rev = L.rev + 1;
    saveLocal();
    window.RoomkStats?.count('local-start');
    renderGame();
  } else if (state.role === 'host') {
    backToLobby();
  }
});
$('btnQuit').addEventListener('click', quitLocal);
$('btnAgain').addEventListener('click', () => {
  if (state.role === 'local') {
    const L = state.local;
    // 白と黒を入れかえる（CPU の側も入れかわる。CPU が白になると、CPU から指す）
    stopCpu();
    state.timeoutKey = null;
    state.local = newLocal([L.names[1], L.names[0]], swapAid(L.aid), L.cpu == null ? null : 1 - L.cpu, L.level, L.cc);
    state.local.rev = L.rev + 1;
    saveLocal();
    window.RoomkStats?.count('local-start');
    renderGame();
  } else if (state.role === 'host') {
    playAgain();
  }
});
$('btnRelobby').addEventListener('click', () => {
  if (state.role === 'local') {
    const L = state.local;
    state.localAid = L.aid;
    stopCpu();
    clearLocal();
    state.local = null;
    state.role = null;
    resetBoxes();
    stopClock();
    openLocalSetup(L.names, L.cpu, L.level, L.cc);
  } else if (state.role === 'host') {
    backToLobby();
  }
});

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
  showScreen('game');
  renderGame();
}

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
  const linkCode = normalizeRoomCode(roomParam);
  const saved = loadSession();
  if (!ROOM_CODE_PATTERN.test(linkCode)) {
    toast('ルームコードが正しくないよ');
    history.replaceState(null, '', location.pathname);
    resumeFromSession();
  } else if (saved && saved.roomCode === linkCode) {
    tryReconnect().then((reconnected) => {
      if (reconnected || state.roomRef) return;
      clearSession();
      openJoinFromLink(linkCode);
    });
  } else {
    if (saved) clearSession();
    openJoinFromLink(linkCode);
  }
} else {
  resumeFromSession();
}
