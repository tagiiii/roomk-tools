/* マンカラ
   ・1台の画面: このタブだけで遊ぶ（穴を選ぶのは画面を動かす人。通信しない）。CPU とも対戦できる
   ・ルーム: Realtime Database。対戦する2人がそれぞれの端末でまき、ほかの参加者は観戦する
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない
   作りはリバーシ（apps/reversi）と同じ。盤・ルール・補助・石をまく動きだけがちがう */
const E = window.MancalaEngine;

const MAX_GUESTS = 20;
const MAX_PROXIES = 4;     // 端末なしの参加者（ホストが代わりにまく）
const COLOR = { b: '先', w: '後' };   // 内部の名前は b（先）・w（後）
const COLORS = ['b', 'w'];
// 補助: who＝使う人（both | b | w | none）、confirm＝まく前にたしかめる、hint＝いい手に印を出す
const DEFAULT_AID = { who: 'both', confirm: true, hint: false };
const WHO_OPTS = [['both', 'ふたりとも'], ['b', '先の人だけ'], ['w', '後の人だけ'], ['none', '使わない']];
// 1手の制限時間（秒）。0 は時間制限なし（はじめの設定）。過ぎたら CPU が代わりにまく
const MOVE_TIMES = [0, 15, 30, 60];
const moveTimeOf = (value) => (MOVE_TIMES.includes(Number(value)) ? Number(value) : 0);
const moveTimeLabel = (sec) => (sec ? sec + '秒' : 'なし');
const CLOCK_MS = 250;
const LATE_MS = 500;        // 締め切りを確かめるときの余裕（端末どうしの時刻の差）
const HURRY_SEC = 5;        // 残りがこの秒数になったら、残り時間の色を変える（音は鳴らさない）

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'mancala_rooms';
const SESSION_KEY = 'mancala_session';
const LOCAL_KEY = 'mancala_local';
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
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  placing: false,      // まく途中（二度押しよけ。ほかの操作の busy とは分ける）
  animating: false,    // 石を1つずつ入れる動きの途中（その間は押せない）
  watchTimer: null,
  // 端末の中だけで持つ状態
  local: null,         // 1台の画面の対局
  localAid: null,      // 1台の画面の準備中の補助
  pick: -1,            // 「まく前にたしかめる」で選んでいる穴
  pickKey: null,
  clockTimer: null,    // 残り時間の表示と、時間切れの見はり
  autoKey: null,       // 時間切れの代わりの手を、同じ手番で二度送らないための印
  cpuTimer: null,      // 1台の画面で CPU と対戦するとき、CPU がまくまでの待ち
  cpuKey: null,        // CPU が同じ手番で二度まかないための印
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.mc-screen').forEach((node) => node.classList.remove('active'));
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

/* ── 補助 ── */
function normAid(aid) {
  const a = aid && typeof aid === 'object' ? aid : {};
  return {
    who: WHO_OPTS.some(([v]) => v === a.who) ? a.who : DEFAULT_AID.who,
    confirm: typeof a.confirm === 'boolean' ? a.confirm : DEFAULT_AID.confirm,
    hint: typeof a.hint === 'boolean' ? a.hint : DEFAULT_AID.hint,
  };
}

// その色の番に使う補助
function aidFor(aid, color) {
  const a = normAid(aid);
  const on = a.who === 'both' || a.who === color;
  return { confirm: on && a.confirm, hint: on && a.hint };
}

function aidSummary(aid) {
  const a = normAid(aid);
  const parts = [];
  if (a.confirm) parts.push('まく前にたしかめる');
  if (a.hint) parts.push('いい手に印を出す');
  if (a.who === 'none' || !parts.length) return '使わない';
  return WHO_OPTS.find(([v]) => v === a.who)[1] + '：' + parts.join('・');
}

// 補助の設定欄。変えるたびに onChange(新しい設定)
function aidEditor(root, aid, onChange) {
  const a = normAid(aid);
  const uid = root.id;
  root.replaceChildren();
  const fs = makeElement('fieldset', 'mc-fieldset');
  fs.append(makeElement('legend', 'mc-legend', '補助を使う人'));
  const seg = makeElement('div', 'mc-seg');
  WHO_OPTS.forEach(([v, label]) => {
    const lb = makeElement('label', 'mc-seg__opt');
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
  const checks = makeElement('div', 'mc-checks');
  const mk = (key, label, sub) => {
    const lb = makeElement('label', 'mc-check');
    const c = makeElement('input');
    c.type = 'checkbox';
    c.checked = a[key];
    c.dataset.key = key;
    c.addEventListener('change', () => { a[key] = c.checked; sync(); onChange({ ...a }); });
    const txt = makeElement('span', 'mc-check__text');
    txt.append(makeElement('span', 'mc-check__label', label), makeElement('span', 'mc-check__sub', sub));
    lb.append(c, txt);
    checks.append(lb);
    return c;
  };
  const cConfirm = mk('confirm', 'まく前にたしかめる', '1回押すと、石が入る穴に印が出る。「ここからまく」か、同じ穴をもう1回押すとまく');
  const cHint = mk('hint', 'いい手に印を出す', '「もう1回」になる穴と「よこどり」できる穴に印が出る');
  fs.append(checks);
  root.append(fs);
  function sync() {
    const off = a.who === 'none';
    cConfirm.disabled = off;
    cHint.disabled = off;
    checks.classList.toggle('is-off', off);
  }
  sync();
}

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

// 在室している人を参加順に（ホストもふくむ）
function memberNames(room) {
  return byJoined(Object.entries(room?.players || {}));
}

function guestNames(room) {
  return memberNames(room).filter((name) => !room.players[name].isHost);
}

// 端末なしの参加者（ホストが代わりにまく）。切断しない
function proxyNames(room) {
  return byJoined(Object.entries(room?.proxies || {}));
}

// 待合室で席に選べる人（在室の人と、端末なしの参加者）
function seatable(room, name) {
  return typeof name === 'string' && (!!room?.players?.[name] || !!room?.proxies?.[name]);
}

function seatsOf(room) {
  const s = room?.seats || {};
  return { b: typeof s.b === 'string' ? s.b : null, w: typeof s.w === 'string' ? s.w : null };
}

// 1手もどす用の局面（まいた動きの情報は持たない）
function snapOf(g) {
  return { board: g.board, turn: g.turn, last: g.last, ply: g.ply, extra: g.extra };
}

function boardOf(value) {
  // 数でない値（文字列・null）は数に直さずに断る
  const b = asList(value);
  return E.validBoard(b) ? b.slice() : null;
}

function captureOf(c) {
  if (!c || typeof c !== 'object') return null;
  const from = Number(c.from);
  const opp = Number(c.opp);
  const count = Number(c.count);
  return E.isPit(from) && E.isPit(opp) && Number.isInteger(count) && count > 0 ? { from, opp, count } : null;
}

// 対局を読む。壊れた値は読み飛ばす
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const board = boardOf(g.board);
  if (!board) return null;
  const seats = g.seats || {};
  const uids = g.uids || {};
  const proxy = g.proxy || {};
  const hist = asList(g.hist).filter((h) => h && boardOf(h.board)).map((h) => ({
    board: boardOf(h.board),
    turn: h.turn === 'w' ? 'w' : 'b',
    last: Number.isInteger(h.last) ? h.last : -1,
    ply: Number(h.ply) || 0,
    extra: h.extra === true,
  }));
  return {
    id: Number(g.id) || 0,
    seats: { b: typeof seats.b === 'string' ? seats.b : null, w: typeof seats.w === 'string' ? seats.w : null },
    uids: { b: uids.b || null, w: uids.w || null },
    proxy: { b: proxy.b === true, w: proxy.w === true },
    board,
    turn: g.turn === 'w' ? 'w' : 'b',
    last: Number.isInteger(g.last) ? g.last : -1,
    // 直前の手で石を入れた穴の並び・もう1回・よこどり・おわりに残りの石を移したか（画面の動きとメッセージ用）
    path: asList(g.path).map(Number).filter((i) => Number.isInteger(i) && i >= 0 && i <= 13),
    extra: g.extra === true,
    capture: captureOf(g.capture),
    sweep: g.sweep === true,
    over: g.over === true,
    ply: Number(g.ply) || 0,
    hist,
    moveTime: moveTimeOf(g.moveTime),
    // いまの番が始まった時刻（サーバーの時刻）。書きこみが届く前は数でないので null
    turnAt: typeof g.turnAt === 'number' ? g.turnAt : null,
    auto: g.auto === 'b' || g.auto === 'w' ? g.auto : null,
    // 局面が変わるたびに増える番号（まく・時間切れの手・1手もどす）。手数はもどすと減るので、古い操作の照合はこちらで行う
    rev: Number(g.rev) || 0,
    // 一度でもおわったか（もどしても消さない。finish を1対局に1回だけ数えるため）
    ended: g.ended === true,
  };
}

// その色の席の人が、いまルームにいるか（端末なしの参加者はいつもいる）
function seatPresent(room, game, color) {
  return game.proxy[color] || !!room?.players?.[game.seats[color]];
}

// その色の番に、この端末がまいてよいか。ホストは、端末なしの人と通信が切れた人の代わりにまける
function mayMove(room, game, color, uid, nickname, role) {
  if (role !== 'host' && role !== 'guest') return false;
  const isHost = role === 'host' && room.hostUid === uid;
  if (game.proxy[color]) return isHost;
  if (game.seats[color] === nickname && game.uids[color] === uid) return true;
  return isHost && !room.players?.[game.seats[color]];
}

// 対局の名前の持ち主（匿名ID）。対局の間は、その名前を同じ人だけが使える
function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAY) return false;
  return COLORS.some((c) => game.seats[c] === name && (game.proxy[c] || (game.uids[c] && game.uids[c] !== uid)));
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
    console.warn('[mancala] expired room cleanup failed', error);
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
  $('board')._token = ($('board')._token || 0) + 1;
  $('board').replaceChildren();
  $('board')._holes = null;
  $('board')._drawn = {};
  state.animating = false;
  $('seatTop').replaceChildren();
  $('seatBottom').replaceChildren();
  $('lobbyAid')._key = null;
  state.pick = -1;
  state.pickKey = null;
  if ($('aidDialog').open) $('aidDialog').close();
}

function startClock() {
  clearInterval(state.clockTimer);
  state.autoKey = null;
  state.clockTimer = setInterval(updateClock, CLOCK_MS);
}

function stopClock() {
  clearInterval(state.clockTimer);
  state.clockTimer = null;
  state.autoKey = null;
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
    console.warn('[mancala] room listener failed', error);
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
      await ref.transaction((room) => {
        if (!room || room.hostUid !== uid || isExpired(room)) return;
        if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
        const next = { ...room, hostConnected: true, hostDisconnectedAt: null };
        // ホストが切れている間は時計を止めていたので、いまの番の時間を最初から数えなおす
        const game = gameOf(room);
        if (room.status === STATUS.PLAY && game && !game.over && game.moveTime) next.game = { ...room.game, turnAt: serverTimestamp() };
        return next;
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
        const seated = room.status === STATUS.PLAY && game && COLORS.some((c) => game.seats[c] === nickname);
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
    console.warn('[mancala] presence recovery failed', error);
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
          moveTime: 0,
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
    console.warn('[mancala] create failed', err);
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
      const seated = room.status === STATUS.PLAY && game && COLORS.some((c) => game.seats[c] === nickname);
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
        const color = COLORS.find((c) => !seats[c]);
        if (color && !COLORS.some((c) => seats[c] === nickname)) next.seats = { ...seats, [color]: nickname };
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
    console.warn('[mancala] join failed', err);
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
    console.warn('[mancala] reconnect failed', error);
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
      // 自分の在室だけを消す。待合室なら席も空ける（対局中の席は残し、ホストが代わりにまける）
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
          COLORS.forEach((c) => { if (seats[c] === nickname) seats[c] = null; });
          next.seats = seats;
        }
        return next;
      });
    }
  } catch (error) {
    console.warn('[mancala] leave failed', error);
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
    console.warn('[mancala] watch failed', error);
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
  document.title = 'みんなにみせる画面 | マンカラ | あそびのたな';
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
    console.warn('[mancala] watch listener failed', error);
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
    console.warn('[mancala] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

async function setSeat(color, name) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    if (name && !seatable(room, name)) return;
    const seats = seatsOf(room);
    const other = E.other(color);
    if (name && seats[other] === name) seats[other] = seats[color]; // 反対の席にいた人なら入れかえる
    seats[color] = name || null;
    return { ...room, seats };
  }, '席を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) renderRoom(state.room);
}

async function swapSeats() {
  await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const s = seatsOf(room);
    return { ...room, seats: { b: s.w, w: s.b } };
  }, '入れかえられませんでした。もう一度ためしてね', false);
}

async function setMoveTime(value) {
  const sec = moveTimeOf(value);
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, moveTime: sec };
  }, '設定を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) renderRoom(state.room);
}

// 補助はいつでも変えられる（あそんでいる間も）。
// 席・制限時間・補助は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない（どれも中で今の値から作りなおす）
async function setAid(aid) {
  const ok = await hostTransaction((room) => ({ ...room, aid: normAid(aid) }), '補助を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) {
    $('lobbyAid')._key = null;
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
    if (room.players?.[name] || room.proxies?.[name] || name === room.host || seats.b === name || seats.w === name) { reason = '「' + name + '」はもういるよ'; return; }
    if (proxyNames(room).length >= MAX_PROXIES) { reason = '端末なしの参加者は' + MAX_PROXIES + '人までだよ'; return; }
    const next = { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
    const color = COLORS.find((c) => !seats[c]);
    if (color) next.seats = { ...seats, [color]: name };
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
    COLORS.forEach((c) => { if (seats[c] === name) seats[c] = null; });
    return { ...room, proxies: Object.keys(proxies).length ? proxies : null, seats };
  }, '外せませんでした。もう一度ためしてね');
}

// 席の2人で新しい対局を作る（そろっていなければ null）
function newGameFor(room, seats) {
  if (!seats.b || !seats.w || seats.b === seats.w) return null;
  if (!seatable(room, seats.b) || !seatable(room, seats.w)) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const proxy = {};
  const uids = {};
  COLORS.forEach((c) => {
    if (room.proxies?.[seats[c]]) proxy[c] = true;
    else uids[c] = room.players[seats[c]].uid;
  });
  return { id, seats: { ...seats }, uids, proxy, ...E.newGame(), hist: [], moveTime: moveTimeOf(room.moveTime), turnAt: serverTimestamp(), rev: 0 };
}

function countStart() {
  window.RoomkStats?.count('start');
  window.RoomkStats?.count('players-2');
}

async function startGame() {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const game = newGameFor(room, seatsOf(room));
    if (!game) return;
    return { ...room, status: STATUS.PLAY, lastGameId: game.id, game };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) countStart();
  else if (ok === false) toast('対戦する2人を選んでね');
}

async function undoMove() {
  const before = gameOf(state.room);
  if (!before) return;
  // 押した時点の局面を捕まえる（確認の間にまかれた別の手を取り消さないように）
  const gid = before.id;
  const rev = before.rev;
  if (!window.confirm('1手もどす？（直前にまいた手を取り消すよ）')) return;
  const ok = await hostTransaction((room) => {
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid || game.rev !== rev || !game.hist.length) return;
    const hist = game.hist.slice();
    const prev = hist.pop();
    return { ...room, game: { ...room.game, ...prev, path: null, capture: null, sweep: null, over: false, hist, turnAt: serverTimestamp(), auto: null, rev: game.rev + 1 } };
  }, 'もどせませんでした。もう一度ためしてね');
  if (ok === false) toast('盤が進んだので、もどさなかったよ。もう一度ためしてね', false);
}

// もう一回（先と後を入れかえる）
async function playAgain() {
  const gid = gameOf(state.room)?.id;
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid || !game.over) return;
    const seats = { b: game.seats.w, w: game.seats.b };
    const next = newGameFor(room, seats);
    if (!next) { reason = 'そろっていない'; return; }
    return { ...room, seats, lastGameId: next.id, game: next };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('again');
    countStart();
  } else if (ok === false && reason) {
    toast('対戦した2人がそろっていないよ。「対戦する人を選びなおす」から選んでね');
  }
}

// 待合室にもどる（「対戦する人を選びなおす」・「この対局をやめる」）
async function backToLobby() {
  const game = gameOf(state.room);
  const gid = game?.id;
  const wasOver = !!game?.over;
  if (!wasOver && !window.confirm('この対局をやめて、待合室にもどる？')) return;
  const ok = await hostTransaction((room) => {
    const cur = gameOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== gid) return;
    return { ...room, status: STATUS.WAITING, game: null, seats: { ...cur.seats } };
  }, 'もどれませんでした。もう一度ためしてね');
  if (ok && wasOver) window.RoomkStats?.count('again');
}

/* ── まく ── */
// 穴 i からまく。auto のときは時間切れの代わりの手（i は使わず、CPU が選ぶ）
async function placeRoom(i, auto = false) {
  const room = state.room;
  const game = gameOf(room);
  if (!game || !state.roomRef || (!auto && state.placing)) return false;
  const gid = game.id;
  const rev = game.rev;
  const uid = currentUid();
  const nickname = state.nickname;
  const role = state.role;
  let finished = false;
  let committed = false;
  if (!auto) state.placing = true;
  try {
    const result = await state.roomRef.transaction((r) => {
      finished = false;
      if (!r || isExpired(r) || r.status !== STATUS.PLAY) return;
      const cur = gameOf(r);
      // 押した時点の対局・局面と同じときだけ（古い操作で次の手を変えない。1手もどしたあとも）
      if (!cur || cur.id !== gid || cur.rev !== rev || cur.over) return;
      let at = i;
      if (auto) {
        // ホストが切れている間は、時間切れの手をまかない（参加者の画面はホストを待っていて押せないため）
        if (r.hostConnected === false) return;
        // 時間切れは、ホストか、その番にまける端末が確かめる。締め切りを過ぎていなければ何もしない
        if (!(role === 'host' && r.hostUid === uid) && !mayMove(r, cur, cur.turn, uid, nickname, role)) return;
        if (!cur.moveTime || cur.turnAt == null || RoomkRTDB.now() < cur.turnAt + cur.moveTime * 1000 - LATE_MS) return;
        at = E.autoMove(cur.board, cur.turn);
      } else if (!mayMove(r, cur, cur.turn, uid, nickname, role)) {
        return;
      }
      const ng = E.play(cur, at);
      if (!ng) return;
      finished = ng.over && !cur.ended;
      return { ...r, game: { ...r.game, ...ng, hist: [...cur.hist, snapOf(cur)], turnAt: serverTimestamp(), auto: auto ? cur.turn : null, rev: cur.rev + 1, ended: cur.ended || ng.over } };
    });
    committed = result.committed;
    if (committed && finished) window.RoomkStats?.count('finish');
  } catch (error) {
    console.warn('[mancala] place failed', error);
    if (!auto) toast('まけませんでした。もう一度ためしてね');
  } finally {
    if (!auto) state.placing = false;
  }
  return committed;
}

/* ── 1手の制限時間 ── */
// いまの番の残り時間（ミリ秒）。時間制限なし・終わった対局は null
function remainingMs(V) {
  const g = V?.game;
  if (!g || g.over || !g.moveTime) return null;
  // ホストが切れている間は時計を止める（戻ると、その番の時間を最初から数えなおす）
  if (V.room && V.room.hostConnected === false) return null;
  // CPU と対戦するときの CPU の番は、時間を数えない
  if (V.cpu && g.turn === V.cpu) return null;
  const now = state.role === 'local' ? Date.now() : RoomkRTDB.now();
  const start = g.turnAt == null ? now : g.turnAt;
  return Math.max(0, start + g.moveTime * 1000 - now);
}

// 残り時間を出し、時間切れなら、受け持つ端末が CPU の手をまく
function updateClock() {
  const V = (state.currentScreen === 'game') ? viewModel() : null;
  const ms = remainingMs(V);
  document.querySelectorAll('.mc-seat__clock').forEach((node) => {
    const show = ms != null && node.dataset.color === V.game.turn;
    node.hidden = !show;
    if (!show) return;
    const sec = Math.ceil(ms / 1000);
    node.textContent = 'のこり ' + sec + '秒';
    node.classList.toggle('is-hurry', sec <= HURRY_SEC);
  });
  // 石を入れる動きの途中は、時間切れの手を送らない（動きがおわってから）
  if (ms == null || ms > 0 || state.animating) return;
  // 1手もどしたあとに同じ手数へ来ても、番が始まった時刻が変わるので別の手番として扱う
  const key = V.key + ':' + V.game.ply + ':' + V.game.rev + ':' + V.game.turnAt;
  if (state.autoKey === key) return;
  if (state.role === 'local') {
    state.autoKey = key;
    placeLocal(-1, true);
  } else if (state.role === 'host' || state.role === 'guest') {
    const room = state.room;
    const responsible = (state.role === 'host' && room.hostUid === currentUid())
      || mayMove(room, V.game, V.game.turn, currentUid(), state.nickname, state.role);
    if (!responsible) return;
    // 締め切りの少しあとで1回だけ送る（ホストと番の人が同時に送っても、手数の照合で1つだけ通る）
    if (RoomkRTDB.now() < (V.game.turnAt ?? 0) + V.game.moveTime * 1000 + LATE_MS) return;
    state.autoKey = key;
    placeRoom(-1, true).then((ok) => {
      // 端末どうしの時刻の差で締め切り前と判定されたときは、少し待って送りなおす
      if (!ok) setTimeout(() => { if (state.autoKey === key) state.autoKey = null; }, 1000);
    });
  }
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
    const game = gameOf({ game: saved.game });
    if (!game || game.over) return null;
    return {
      names: { b: String(saved.names?.b || '').slice(0, 8), w: String(saved.names?.w || '').slice(0, 8) },
      aid: normAid(saved.aid),
      cpu: cpuOf(saved.cpu),
      level: levelOf(saved.level),
      // 読み込み直したら、いまの番の時間は最初から数えなおす
      game: { ...game, turnAt: Date.now(), bot: saved.game?.bot === 'b' || saved.game?.bot === 'w' ? saved.game.bot : null },
    };
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

/* ── CPU と対戦する（1台の画面だけ）──
   CPU の側を選ぶと、その側は CPU がまく（名前は「CPU」）。まき方は選んだ強さの cpuMove（「ふつう」は時間切れの手と同じ autoMove）。
   CPU の番は、石を入れる動きがおわってから CPU_MS 待ってまく。CPU の番は時間を数えない */
const CPU_NAME = 'CPU';
const CPU_MS = 900;
const cpuOf = (v) => (v === 'b' || v === 'w' ? v : null);
// CPU の強さ（よわい・ふつう・つよい）。はじめは「ふつう」（時間切れの手と同じまき方）
const levelOf = (v) => (v === 'weak' || v === 'strong' ? v : 'normal');
const cpuTurnKey = (L) => L.game.ply + ':' + L.game.hist.length + ':' + L.game.turnAt;
function stopCpu() {
  clearTimeout(state.cpuTimer);
  state.cpuTimer = null;
  state.cpuKey = null;
}
function scheduleCpu() {
  const L = state.local;
  // 石を入れる動きの途中は待つ（動きがおわると renderGame からもう一度呼ばれる）
  if (state.role !== 'local' || !L?.cpu || L.game.over || L.game.turn !== L.cpu || state.animating) return;
  const key = cpuTurnKey(L);
  if (state.cpuKey === key) return;
  clearTimeout(state.cpuTimer);
  state.cpuKey = key;
  state.cpuTimer = setTimeout(() => {
    state.cpuTimer = null;
    const cur = state.local;
    if (state.role !== 'local' || cur !== L || cur.game.over || cur.game.turn !== cur.cpu || cpuTurnKey(cur) !== key) return;
    if (state.animating) { state.cpuKey = null; return; }
    placeLocal(-1, false, true);
  }, CPU_MS);
}
const localVs = () => cpuOf(document.querySelector('input[name="localVs"]:checked')?.value);
const localLevel = () => levelOf(document.querySelector('input[name="localLevel"]:checked')?.value);
// CPU の色の名前の欄は、使わないので押せなくする
function syncLocalVs() {
  const cpu = localVs();
  ['b', 'w'].forEach((c) => {
    const input = $(c === 'b' ? 'localNameB' : 'localNameW');
    input.disabled = cpu === c;
    input.placeholder = cpu === c ? CPU_NAME : '';
    if (cpu === c) input.value = '';
  });
  $('btnLocalSwap').disabled = !!cpu;
  $('localLevelBox').hidden = !cpu;
}

function openLocalSetup(names, moveTime = 0, cpu = null, level = 'normal') {
  const radio = document.querySelector('input[name="localVs"][value="' + (cpuOf(cpu) || '') + '"]');
  if (radio) radio.checked = true;
  const lv = document.querySelector('input[name="localLevel"][value="' + levelOf(level) + '"]');
  if (lv) lv.checked = true;
  $('localNameB').value = cpu === 'b' ? '' : names?.b || '';
  $('localNameW').value = cpu === 'w' ? '' : names?.w || '';
  syncLocalVs();
  $('localMoveTime').value = String(moveTimeOf(moveTime));
  state.localAid = normAid(state.localAid);
  aidEditor($('localAid'), state.localAid, (a) => { state.localAid = a; });
  showScreen('local');
}

function newLocalGame(moveTime) {
  return { ...E.newGame(), hist: [], moveTime: moveTimeOf(moveTime), turnAt: Date.now(), auto: null };
}

function startLocal() {
  const cpu = localVs();
  const nameB = cpu === 'b' ? CPU_NAME : $('localNameB').value.trim().slice(0, 8);
  const nameW = cpu === 'w' ? CPU_NAME : $('localNameW').value.trim().slice(0, 8);
  state.role = 'local';
  stopCpu();
  state.local = { names: { b: nameB, w: nameW }, aid: normAid(state.localAid), cpu, level: localLevel(), game: newLocalGame($('localMoveTime').value) };
  saveLocal();
  window.RoomkStats?.count('local-start');
  showScreen('game');
  startClock();
  renderGame();
}

// 穴 i からまく。auto のときは時間切れの代わりの手、bot のときは対戦相手の CPU の手（どちらも CPU が選ぶ）
function placeLocal(i, auto = false, bot = false) {
  const L = state.local;
  // 時間切れの代わりの手はいつも「ふつう」。対戦相手の CPU は選んだ強さ
  const at = bot ? E.cpuMove(L.game.board, L.game.turn, levelOf(L.level)) : auto ? E.autoMove(L.game.board, L.game.turn) : i;
  const ng = E.play(L.game, at);
  if (!ng) return;
  const first = ng.over && !L.game.ended;
  L.game = { ...ng, hist: [...L.game.hist, snapOf(L.game)], moveTime: L.game.moveTime, turnAt: Date.now(), auto: auto ? L.game.turn : null, bot: bot ? L.game.turn : null, ended: L.game.ended || ng.over };
  state.pick = -1;
  if (first) window.RoomkStats?.count('local-finish');
  saveLocal();
  renderGame();
}

function quitLocal() {
  const g = state.local?.game;
  if (g && !g.over && g.ply && !window.confirm('おわりにして、トップへ戻る？')) return;
  clearLocal();
  state.local = null;
  state.role = null;
  stopClock();
  stopCpu();
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
    if ($('aidDialog').open) $('aidDialog').close();
    showScreen(next);
  }
  renderBar(room);
  if (playing) renderGame();
  else renderWaiting(room);
}

function updateHostOverlay(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす。
    // 古い時刻のまま動くと「まだ期限前」で消せず、待つ画面のまま残る（2026-11-13）
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
    $('hostOffOverlay').hidden = true;
    clearTimeout(state.orphanTimer);
    state.orphanTimer = null;
  }
}

function mySeat(room) {
  const game = gameOf(room);
  const seats = room.status === STATUS.PLAY && game ? game.seats : seatsOf(room);
  return COLORS.find((c) => seats[c] === state.nickname) || null;
}

function renderBar(room) {
  let me = '';
  if (state.role === 'host' || state.role === 'guest') {
    const seat = mySeat(room);
    me = (state.role === 'host' ? 'ホスト' : state.nickname) + (seat ? '・あなたは' + COLOR[seat] : state.role === 'guest' ? '・観戦中' : '');
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
    COLORS.forEach((c) => {
      const sel = $(c === 'b' ? 'seatB' : 'seatW');
      const empty = makeElement('option', '', '（えらんでね）');
      empty.value = '';
      const opts = [empty];
      people.forEach((name) => {
        const o = makeElement('option', '', name + (name === room.host ? '（自分）' : room.proxies?.[name] ? '（端末なし）' : ''));
        o.value = name;
        opts.push(o);
      });
      // 席の人がいまいないときも、そのまま見えるように残す
      if (seats[c] && !people.includes(seats[c])) {
        const o = makeElement('option', '', seats[c] + '（いない）');
        o.value = seats[c];
        opts.push(o);
      }
      sel.replaceChildren(...opts);
      sel.value = seats[c] || '';
    });
  } else {
    $('seatView').replaceChildren(...COLORS.map((c) => {
      const box = makeElement('div', 'mc-seatview');
      box.append(makeElement('span', 'mc-chip mc-chip--' + c), makeElement('span', 'mc-seatview__color', COLOR[c]));
      const name = seats[c];
      const label = name ? name + (name === state.nickname && !watch ? '（あなた）' : '') + (seatable(room, name) ? '' : '（いない）') : 'まだ決まっていない';
      box.append(makeElement('span', 'mc-seatview__name' + (name ? '' : ' is-empty'), label));
      return box;
    }));
  }
  const ready = !!seats.b && !!seats.w && seats.b !== seats.w && seatable(room, seats.b) && seatable(room, seats.w);
  let note = '';
  if (host) {
    if (people.length < 2) note = 'もう1人入ると、はじめられるよ。ホストも対戦するときは、自分を選んでね';
    else if (!ready) note = '先と後の人を選んでね。ホストも対戦できるよ';
    else note = '先の人からまくよ';
  }
  $('seatNote').textContent = note;
  $('seatNote').hidden = !note;

  // 参加している人
  $('lobbyPeople').replaceChildren(...people.map((name) => {
    const proxy = !!room.proxies?.[name];
    const li = makeElement('li', 'mc-person');
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    li.append(msIcon(host && proxy ? 'person_off' : 'person'), makeElement('span', 'mc-person__name', name));
    if (name === room.host) li.append(makeElement('span', 'mc-tag mc-tag--muted', 'ホスト'));
    if (host && proxy) li.append(makeElement('span', 'mc-tag mc-tag--muted', '端末なし'));
    if (seats.b === name) li.append(makeElement('span', 'mc-tag mc-tag--b', '先'));
    else if (seats.w === name) li.append(makeElement('span', 'mc-tag mc-tag--w', '後'));
    else li.append(makeElement('span', 'mc-tag mc-tag--watch', '観戦'));
    if (name === state.nickname && !watch) li.append(makeElement('span', 'mc-tag mc-tag--watch', 'あなた'));
    if (host && proxy) {
      const del = makeElement('button', 'mc-quiet mc-person__del', '外す');
      del.type = 'button';
      del.addEventListener('click', () => removeProxy(name));
      li.append(del);
    }
    return li;
  }));
  $('proxyForm').hidden = !host;

  // 補助
  $('lobbyAid').hidden = !host;
  $('lobbyAidView').hidden = host;
  if (host) {
    const key = JSON.stringify(normAid(room.aid));
    if ($('lobbyAid')._key !== key) {
      aidEditor($('lobbyAid'), room.aid, (a) => { $('lobbyAid')._key = JSON.stringify(a); setAid(a); });
      $('lobbyAid')._key = key;
    }
  } else {
    $('lobbyAidView').textContent = aidSummary(room.aid);
  }

  // 1手の制限時間
  $('moveTimeEdit').hidden = !host;
  $('moveTimeView').hidden = host;
  if (host) $('moveTime').value = String(moveTimeOf(room.moveTime));
  else $('moveTimeView').textContent = moveTimeOf(room.moveTime) ? moveTimeLabel(moveTimeOf(room.moveTime)) + '（過ぎたら CPU が代わりにまく）' : 'なし';

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

// 画面に出すための共通の形にそろえる（1台の画面とルーム）
function viewModel() {
  if (state.role === 'local') {
    const L = state.local;
    return {
      game: L.game,
      aid: L.aid,
      name: (c) => L.names[c],
      away: () => false,
      proxy: () => false,
      cpu: L.cpu,
      canPlay: () => !L.game.over && L.game.turn !== L.cpu,
      mine: (c) => !!L.cpu && c !== L.cpu,
      key: 'local',
    };
  }
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game) return null;
  const uid = currentUid();
  return {
    game,
    aid: room.aid,
    room,
    name: (c) => game.seats[c] || '',
    away: (c) => !seatPresent(room, game, c),
    proxy: (c) => game.proxy[c],
    canPlay: () => !game.over && mayMove(room, game, game.turn, uid, state.nickname, state.role),
    mine: (c) => (state.role === 'host' || state.role === 'guest') && game.seats[c] === state.nickname && game.uids[c] === uid,
    key: state.roomCode + ':' + game.id,
  };
}
const seatLabel = (V, c) => (V.name(c) ? COLOR[c] + '（' + V.name(c) + '）' : COLOR[c]);

function renderGame() {
  const V = viewModel();
  if (!V) return;
  const g = V.game;
  const local = state.role === 'local';
  const host = state.role === 'host';
  const n = E.score(g.board);
  const pickKey = V.key + ':' + g.ply + ':' + g.rev;
  if (state.pickKey !== pickKey) { state.pick = -1; state.pickKey = pickKey; }
  const bottom = bottomSide(V);

  // 対戦する2人（盤の上が相手の側、下が自分の側）
  const seatBox = (c) => {
    const turn = !g.over && g.turn === c;
    const box = makeElement('div', 'mc-seat mc-seat--' + c + (turn ? ' is-turn' : ''));
    const tag = makeElement('span', 'mc-seat__side', COLOR[c]);
    tag.setAttribute('aria-hidden', 'true');
    const who = makeElement('div', 'mc-seat__who');
    const top = makeElement('div', 'mc-seat__line');
    top.append(makeElement('span', 'mc-seat__name', V.name(c) || COLOR[c] + 'の人'));
    if (V.mine(c)) top.append(makeElement('span', 'mc-seat__you', '（あなた）'));
    who.append(top);
    const tags = makeElement('div', 'mc-seat__tags');
    if (turn) tags.append(makeElement('span', 'mc-tag mc-tag--turn', 'いまの番'));
    if (g.over && E.winner(g.board) === c) tags.append(makeElement('span', 'mc-tag mc-tag--win', '勝ち'));
    if (V.away(c)) tags.append(makeElement('span', 'mc-tag mc-tag--warn', '通信が切れた'));
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    if (host && V.proxy(c)) tags.append(makeElement('span', 'mc-tag mc-tag--muted', '端末なし'));
    who.append(tags);
    const clock = makeElement('span', 'mc-seat__clock');
    clock.dataset.color = c;
    clock.hidden = true;
    who.append(clock);
    const goal = makeElement('div', 'mc-seat__goal');
    goal.append(makeElement('span', 'mc-seat__goallabel', 'ゴール'));
    const num = makeElement('span', 'mc-seat__count', n[c]);
    num.dataset.color = c;
    goal.append(num, makeElement('span', 'mc-seat__unit', 'こ'));
    box.append(tag, who, goal);
    return box;
  };
  $('seatTop').replaceChildren(seatBox(E.other(bottom)));
  $('seatBottom').replaceChildren(seatBox(bottom));

  // いまの番・直前の手・結果
  const can = V.canPlay() && !state.animating;
  const ad = aidFor(V.aid, g.turn);
  const mover = g.hist.length ? g.hist[g.hist.length - 1].turn : null;
  let note = '';
  if (g.auto && E.isPit(g.last)) note = '時間切れ。CPU が' + COLOR[g.auto] + 'の代わりに ' + E.pitNumber(g.last) + '番めの穴からまいたよ。';
  else if (local && V.cpu && g.bot === V.cpu && E.isPit(g.last)) note = 'CPU は ' + E.pitNumber(g.last) + '番めの穴からまいたよ。';
  if (g.capture && mover) note += seatLabel(V, mover) + 'は向かいの' + (g.capture.count - 1) + 'こをよこどり。';
  if (g.extra && !g.over) note += 'もう1回！ ';
  let status = '';
  if (g.over) {
    const w = E.winner(g.board);
    status = note + (w === 'draw' ? '引き分け！' : seatLabel(V, w) + 'の勝ち！') + '　先 ' + n.b + ' ー 後 ' + n.w;
  } else if (local && !V.cpu) status = note + seatLabel(V, g.turn) + 'の番。' + (g.turn === bottom ? '下' : '上') + 'の側の穴を選んでね';
  else if (V.mine(g.turn)) status = note + 'あなたの番だよ。下の側の穴を選んでね';
  else if (V.canPlay()) status = note + seatLabel(V, g.turn) + 'の番。代わりにまいてね';
  else status = note + seatLabel(V, g.turn) + 'が考え中';
  const st = $('gameStatus');
  if (!state.animating) st.textContent = status;
  st.classList.toggle('is-mine', can && (!local || !!V.cpu) && !g.over);
  st.classList.toggle('is-result', g.over && !state.animating);

  renderBoard($('board'), g, { canPlay: can, aid: ad, pick: state.pick, key: V.key, bottom, V });
  // 新しい手が届いた描画では、ここで動きが始まる。動きの間は「自分の番」の色と結果の大きい文字を出さない
  if (state.animating) st.classList.remove('is-mine', 'is-result');

  // たしかめる
  const picking = can && ad.confirm && state.pick >= 0;
  $('confirmBox').hidden = !picking;
  if (picking) {
    const r = E.sow(g.board, g.turn, state.pick);
    let text = 'この穴の石 ' + g.board[state.pick] + 'こを、印の穴に1こずつ入れるよ';
    if (r?.extra) text = '最後の石がゴールに入って、もう1回できるよ';
    else if (r?.capture) text = '最後の石が空の穴に入って、向かいの' + (r.capture.count - 1) + 'こをよこどりできるよ';
    $('confirmText').textContent = text;
  }

  updateClock();

  // 結果のあとのボタン（結果そのものは盤の上の一行と、勝った人の札に出す）
  $('resultBox').hidden = !g.over || state.role === 'spectator' || state.animating;
  if (g.over) {
    $('resultHost').hidden = !(host || local);
    $('resultWait').hidden = host || local;
    if (local) {
      $('btnAgain').textContent = V.name('b') || V.name('w') ? 'もう一回（先と後を入れかえる）' : 'もう一回あそぶ';
      $('btnRelobby').textContent = '名前と補助を変える';
    } else {
      $('btnAgain').textContent = 'もう一回（先と後を入れかえる）';
      $('btnRelobby').textContent = '対戦する人を選びなおす';
    }
  }

  // そのほかの操作（1台の画面・ホスト）
  $('tools').hidden = !(host || local);
  // CPU と対戦するときは、自分の手までもどす（自分がまだまいていなければ押せない）
  $('btnUndo').disabled = state.animating || !g.hist.length || (local && !!V.cpu && !g.hist.some((h) => h.turn !== V.cpu));
  $('btnReset').textContent = local ? '最初からやりなおす' : 'この対局をやめる';
  $('btnQuit').hidden = !local;
  if (local) scheduleCpu();
}

// 盤の下に来る側（自分の側）。1台の画面は先（CPU と対戦するときは自分）、対戦する人は自分、ほかは先
function bottomSide(V) {
  if (state.role === 'local') return V.cpu ? E.other(V.cpu) : 'b';
  return COLORS.find((c) => V.mine(c)) || 'b';
}

/* ── 盤 ──
   左右のはしがゴール。下の段が下の側の穴（左から右へ）、上の段が上の側の穴（右から左へ）。
   石は反時計まわりに入っていく */
const SEED_COLORS = ['#F4D35E', '#7CC6FE', '#F49CBB', '#9BE29B', '#F6A85A', '#C9A7EB', '#FFFFFF'];
const STEP_MS = 230;        // 石を1つ入れる間（長い手は短く）
const STEP_FAST_MS = 150;
const CAPTURE_MS = 900;     // よこどりを見せる間
const SWEEP_MS = 1000;      // おわりに残りの石をゴールへ移す前の間
const reduceMotion = !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function boardLayout(bottom) {
  return bottom === 'b'
    ? { left: 13, top: [12, 11, 10, 9, 8, 7], low: [0, 1, 2, 3, 4, 5], right: 6 }
    : { left: 6, top: [5, 4, 3, 2, 1, 0], low: [7, 8, 9, 10, 11, 12], right: 13 };
}

function buildBoard(root, bottom) {
  const L = boardLayout(bottom);
  const grid = makeElement('div', 'mc-board');
  grid.setAttribute('aria-label', '盤');
  const holes = {};
  const make = (i, col, row) => {
    const store = E.isStore(i);
    const node = makeElement('button', 'mc-hole' + (store ? ' mc-store' : ''));
    node.type = 'button';
    node.dataset.i = String(i);
    node.style.gridColumn = String(col);
    node.style.gridRow = store ? '1 / span 2' : String(row);
    const seeds = makeElement('span', 'mc-seeds');
    seeds.setAttribute('aria-hidden', 'true');
    const count = makeElement('span', 'mc-count');
    count.setAttribute('aria-hidden', 'true');
    const hint = makeElement('span', 'mc-hint');
    hint.setAttribute('aria-hidden', 'true');
    node.append(seeds, count, hint);
    if (store) node.disabled = true;
    else node.addEventListener('click', () => onHole(i));
    holes[i] = node;
    grid.append(node);
  };
  make(L.left, 1, 1);
  L.top.forEach((i, k) => make(i, k + 2, 1));
  L.low.forEach((i, k) => make(i, k + 2, 2));
  make(L.right, 8, 1);
  root.replaceChildren(grid);
  root._holes = holes;
  root._bottom = bottom;
  root._drawn = {};
}

// 穴ごとに決まった並び（描きなおしても石が跳ねないように）
function seedPos(hole, k, store) {
  let s = (hole + 1) * 7919 + (k + 1) * 104729;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const a = rnd() * Math.PI * 2;
  const rr = Math.sqrt(rnd()) * 0.4;
  if (store) return { x: 50 + Math.cos(a) * rr * 70, y: 10 + rnd() * 72 };
  return { x: 50 + Math.cos(a) * rr * 100, y: 46 + Math.sin(a) * rr * 100 };
}

function drawSeeds(node, hole, n, store) {
  const box = node.firstChild;
  const max = Math.min(n, store ? 40 : 16);
  if (box.childElementCount === max) return;
  const dots = [];
  for (let k = 0; k < max; k += 1) {
    const p = seedPos(hole, k, store);
    const d = makeElement('span', 'mc-seed');
    d.style.left = p.x + '%';
    d.style.top = p.y + '%';
    d.style.background = SEED_COLORS[(hole * 3 + k) % SEED_COLORS.length];
    dots.push(d);
  }
  box.replaceChildren(...dots);
}

// 盤の見た目を、board（数の並び）と印で描く
function paintBoard(root, board, marks) {
  const holes = root._holes;
  const bottom = root._bottom;
  for (let i = 0; i < 14; i += 1) {
    const node = holes[i];
    const store = E.isStore(i);
    drawSeeds(node, i, board[i], store);
    node.children[1].textContent = String(board[i]);
    const playable = !store && marks.playable?.has(i);
    node.disabled = !playable;
    node.classList.toggle('is-playable', !!playable);
    node.classList.toggle('is-pick', marks.pick === i);
    node.classList.toggle('is-path', !!marks.path?.has(i));
    node.classList.toggle('is-end', marks.end === i);
    node.classList.toggle('is-last', marks.last === i);
    node.classList.toggle('is-hand', marks.hand === i);
    node.classList.toggle('is-capture', !!marks.capture?.includes(i));
    const hint = node.children[2];
    const h = marks.hints?.[i] || '';
    hint.hidden = !h;
    hint.replaceChildren(...(h ? [msIcon(h === 'extra' ? 'replay' : 'back_hand')] : []));
    const side = E.ownerOf(i) === bottom ? '下の側' : '上の側';
    let label = store ? side + 'のゴール 石' + board[i] + 'こ' : side + 'の' + E.pitNumber(i) + '番めの穴 石' + board[i] + 'こ';
    if (h) label += h === 'extra' ? '（もう1回になる）' : '（よこどりできる）';
    node.setAttribute('aria-label', label);
  }
  // 札のゴールの数も、動きに合わせる
  paintSeatGoals(board);
  root._animBoard = state.animating ? board.slice() : null;
}

function paintSeatGoals(board) {
  document.querySelectorAll('.mc-seat__count').forEach((num) => {
    num.textContent = String(board[E.STORE[num.dataset.color]]);
  });
}

function renderBoard(root, g, opt) {
  if (!root._holes || root._bottom !== opt.bottom) {
    root._token = (root._token || 0) + 1;
    state.animating = false;
    buildBoard(root, opt.bottom);
  }
  // 局面の番号だけでなく、盤とまいた穴も入れる（同じ番号で別の手が確定したとき＝時間切れの手と人の手が重なったときに見分ける）
  const drawnKey = opt.key + ':' + g.ply + ':' + g.rev + ':' + g.last + ':' + g.board.join(',');
  // 動きの途中で、同じ局面のまま描きなおすとき（補助の変更・在室の変化など）は、動きを続ける（札のゴールの数は途中の盤に合わせなおす）
  if (state.animating && root._animKey === drawnKey) {
    if (root._animBoard) paintSeatGoals(root._animBoard);
    return;
  }
  const prev = root._drawn;
  // 同じ対局で1手すすんだときだけ動かす（もどす・新しい対局・読み込み直しでは動かさない）。
  // 動きのはじめの盤は、その手の前の局面（hist の最後）。その手をなぞって今の盤にならなければ動かさない
  const start = g.hist.length ? g.hist[g.hist.length - 1] : null;
  const replay = start && E.isPit(g.last) ? E.sow(start.board, start.turn, g.last) : null;
  const animate = !reduceMotion && prev.key === opt.key && g.ply === prev.ply + 1 && g.path.length > 0
    && !!replay && replay.board.join(',') === g.board.join(',');
  root._drawn = { key: opt.key, ply: g.ply, board: g.board };
  root._token = (root._token || 0) + 1;
  if (animate) {
    sowAnimation(root, start.board, g, opt, drawnKey);
    return;
  }
  state.animating = false;
  paintBoard(root, g.board, staticMarks(g, opt));
}

function staticMarks(g, opt) {
  const legal = opt.canPlay ? E.legalMoves(g.board, g.turn) : [];
  const marks = { playable: new Set(legal), last: g.last, pick: -1, hints: {} };
  if (opt.canPlay && opt.aid.hint) {
    legal.forEach((i) => {
      const r = E.sow(g.board, g.turn, i);
      if (r.extra) marks.hints[i] = 'extra';
      else if (r.capture) marks.hints[i] = 'capture';
    });
  }
  if (opt.canPlay && opt.pick >= 0) {
    const r = E.sow(g.board, g.turn, opt.pick);
    if (r) {
      marks.pick = opt.pick;
      marks.path = new Set(r.path);
      marks.end = r.last;
    }
  }
  return marks;
}

// 直前の手を、石を1つずつ入れる動きで見せる
async function sowAnimation(root, before, g, opt, drawnKey) {
  const token = root._token;
  const alive = () => root._token === token;
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const mover = g.hist.length ? g.hist[g.hist.length - 1].turn : g.turn;
  const who = seatLabel(opt.V, mover);
  const b = before.slice();
  state.animating = true;
  root._animKey = drawnKey;
  const st = $('gameStatus');
  st.classList.remove('is-mine', 'is-result');
  st.textContent = g.auto
    ? '時間切れ。CPU が' + COLOR[g.auto] + 'の代わりに ' + E.pitNumber(g.last) + '番めの穴からまいているよ'
    : who + 'が ' + E.pitNumber(g.last) + '番めの穴からまいているよ';
  b[g.last] = 0;
  paintBoard(root, b, { hand: g.last, last: g.last });
  const step = g.path.length > 12 ? STEP_FAST_MS : STEP_MS;
  await wait(200);
  for (const i of g.path) {
    if (!alive()) return;
    b[i] += 1;
    paintBoard(root, b, { hand: i, last: g.last });
    await wait(step);
  }
  if (!alive()) return;
  if (g.capture) {
    st.textContent = 'よこどり！ ' + who + 'は向かいの' + (g.capture.count - 1) + 'こをもらうよ';
    paintBoard(root, b, { capture: [g.capture.from, g.capture.opp], last: g.last });
    await wait(CAPTURE_MS);
    if (!alive()) return;
    b[E.STORE[mover]] += b[g.capture.from] + b[g.capture.opp];
    b[g.capture.from] = 0;
    b[g.capture.opp] = 0;
    paintBoard(root, b, { last: g.last });
    await wait(250);
  }
  if (!alive()) return;
  if (g.sweep) {
    st.textContent = 'おわり。のこりの石は、それぞれのゴールへ';
    await wait(SWEEP_MS);
    if (!alive()) return;
  }
  state.animating = false;
  root._animKey = null;
  renderGame();
}

function onHole(i) {
  const V = viewModel();
  if (!V || !V.canPlay() || state.animating) return;
  const g = V.game;
  if (E.ownerOf(i) !== g.turn || !(g.board[i] > 0)) return;
  if (aidFor(V.aid, g.turn).confirm && state.pick !== i) {
    state.pick = i;
    renderGame();
    return;
  }
  place(i);
}

function place(i) {
  const V = viewModel();
  if (!V || !V.canPlay() || state.animating) return;
  state.pick = -1;
  if (state.role === 'local') placeLocal(i);
  else placeRoom(i);
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

$('seatB').addEventListener('change', (event) => setSeat('b', event.currentTarget.value));
$('seatW').addEventListener('change', (event) => setSeat('w', event.currentTarget.value));
$('btnSeatSwap').addEventListener('click', swapSeats);
$('moveTime').addEventListener('change', (event) => setMoveTime(event.currentTarget.value));
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnStartGame').addEventListener('click', startGame);

$('btnLocalSwap').addEventListener('click', () => {
  const b = $('localNameB').value;
  $('localNameB').value = $('localNameW').value;
  $('localNameW').value = b;
});
$('btnLocalStart').addEventListener('click', startLocal);
document.querySelectorAll('input[name="localVs"]').forEach((r) => r.addEventListener('change', syncLocalVs));

$('btnPlace').addEventListener('click', () => { if (state.pick >= 0) place(state.pick); });
$('btnUnpick').addEventListener('click', () => { state.pick = -1; renderGame(); });
$('btnUndo').addEventListener('click', () => {
  if (state.role === 'local') {
    const L = state.local;
    if (!L.game.hist.length) return;
    const hist = L.game.hist.slice();
    let prev = hist.pop();
    // CPU と対戦するときは、自分の番までもどす（CPU の手と、その前の自分の手をいっしょに）
    while (L.cpu && prev.turn === L.cpu && hist.length) prev = hist.pop();
    if (L.cpu && prev.turn === L.cpu) return;
    stopCpu();
    L.game = { ...prev, path: [], capture: null, sweep: false, over: false, hist, moveTime: L.game.moveTime, turnAt: Date.now(), auto: null, bot: null, ended: L.game.ended };
    state.pick = -1;
    saveLocal();
    renderGame();
  } else if (state.role === 'host') {
    undoMove();
  }
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
$('btnReset').addEventListener('click', () => {
  if (state.role === 'local') {
    const g = state.local.game;
    if (!g.over && g.ply && !window.confirm('最初からやりなおす？')) return;
    stopCpu();
    state.local.game = newLocalGame(state.local.game.moveTime);
    state.pick = -1;
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
    L.names = { b: L.names.w, w: L.names.b };
    if (L.cpu) L.cpu = E.other(L.cpu);
    stopCpu();
    L.game = newLocalGame(L.game.moveTime);
    state.pick = -1;
    saveLocal();
    window.RoomkStats?.count('local-start');
    renderGame();
  } else if (state.role === 'host') {
    playAgain();
  }
});
$('btnRelobby').addEventListener('click', () => {
  if (state.role === 'local') {
    const names = state.local.names;
    const moveTime = state.local.game.moveTime;
    const cpu = state.local.cpu;
    const level = state.local.level;
    state.localAid = state.local.aid;
    clearLocal();
    state.local = null;
    state.role = null;
    stopClock();
    stopCpu();
    resetBoxes();
    openLocalSetup(names, moveTime, cpu, level);
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
  startClock();
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
