/* 将棋
   ・1台の画面: このタブだけで指す（駒を動かすのは画面を動かす人。通信しない）
   ・ルーム: Realtime Database。対戦する2人がそれぞれの端末で指し、ほかの参加者は観戦する
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない
   ルールは engine.js（window.ShogiEngine）。ルームには指した手の記録だけを置き、局面は各端末で作りなおす */
const E = window.ShogiEngine;

const MAX_GUESTS = 20;
const MAX_PROXIES = 4;     // 端末なしの参加者（ホストが代わりに指す）
const KEYS = ['s', 'g'];   // ルームの席の名前（s＝先手・g＝後手）。画面と engine では 0・1
const SIDE = ['先手', '後手'];
const MARK = ['▲', '△'];
const VARIANT_OPTS = [
  ['mini', '5五将棋', '5×5 の小さい盤。駒は6種類で、5〜10分で終わる'],
  ['hon', '本将棋', '9×9 のふつうの将棋。30分以上かかることもある'],
];
const variantOf = (v) => (v === 'hon' ? 'hon' : 'mini');
const variantName = (v) => VARIANT_OPTS.find(([k]) => k === variantOf(v))[1];
// 補助: who＝使う人（both | s | g | none）、spots＝動ける所、arrows＝動ける向きの印、danger＝取られそうな駒
const DEFAULT_AID = { who: 'both', spots: true, arrows: false, danger: false };
const WHO_OPTS = [['both', 'ふたりとも'], ['s', '先手だけ'], ['g', '後手だけ'], ['none', '使わない']];

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'shogi_rooms';
const SESSION_KEY = 'shogi_session';
const LOCAL_KEY = 'shogi_local';
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
  local: null,         // 1台の画面の対局 { v, names, aid, moves, resign, declare, ended }
  localAid: null,
  localVariant: 'mini',
  cpuTimer: null,      // CPU が指すまでの待ち
  cpuKey: null,        // CPU が同じ番で二度指さないための印
  sel: null,           // 選んでいる駒 { from } か持ち駒 { drop }
  selKey: null,
  msg: '',
  flip: false,         // 盤の向きを変えた（この端末だけ）
  promo: null,         // 成る・成らないを聞いている手
  drawnKey: null,      // 盤に出している局面（1手すすんだときだけ動きを付ける）
  drawnRev: -1,
  drawnPly: -1,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.sh-screen').forEach((node) => node.classList.remove('active'));
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
  if (value && typeof value === 'object') return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((k) => value[k]);
  return [];
}

/* ── 補助 ── */
function normAid(aid) {
  const a = aid && typeof aid === 'object' ? aid : {};
  return {
    who: WHO_OPTS.some(([v]) => v === a.who) ? a.who : DEFAULT_AID.who,
    spots: typeof a.spots === 'boolean' ? a.spots : DEFAULT_AID.spots,
    arrows: typeof a.arrows === 'boolean' ? a.arrows : DEFAULT_AID.arrows,
    danger: typeof a.danger === 'boolean' ? a.danger : DEFAULT_AID.danger,
  };
}

// その人（0 先手・1 後手）に使う補助
function aidFor(aid, side) {
  const a = normAid(aid);
  const on = a.who === 'both' || a.who === KEYS[side];
  return { spots: on && a.spots, arrows: on && a.arrows, danger: on && a.danger };
}

function aidSummary(aid) {
  const a = normAid(aid);
  const parts = [];
  if (a.spots) parts.push('動ける所');
  if (a.arrows) parts.push('動ける向きの印');
  if (a.danger) parts.push('取られそうな駒');
  if (a.who === 'none' || !parts.length) return '使わない';
  return WHO_OPTS.find(([v]) => v === a.who)[1] + '：' + parts.join('・');
}

// 補助の設定欄。変えるたびに onChange(新しい設定)
function aidEditor(root, aid, onChange) {
  const a = normAid(aid);
  const uid = root.id;
  root.replaceChildren();
  const fs = makeElement('fieldset', 'sh-fieldset');
  fs.append(makeElement('legend', 'sh-legend', '補助を使う人'));
  const seg = makeElement('div', 'sh-seg');
  WHO_OPTS.forEach(([v, label]) => {
    const lb = makeElement('label', 'sh-seg__opt');
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
  const checks = makeElement('div', 'sh-checks');
  const boxes = [];
  const mk = (key, label, sub) => {
    const lb = makeElement('label', 'sh-check');
    const c = makeElement('input');
    c.type = 'checkbox';
    c.checked = a[key];
    c.dataset.key = key;
    c.addEventListener('change', () => { a[key] = c.checked; sync(); onChange({ ...a }); });
    const txt = makeElement('span', 'sh-check__text');
    txt.append(makeElement('span', 'sh-check__label', label), makeElement('span', 'sh-check__sub', sub));
    lb.append(c, txt);
    checks.append(lb);
    boxes.push(c);
  };
  mk('spots', '動ける所を見せる', '駒を選ぶと、動ける所・打てる所に点が出る');
  mk('arrows', '駒に動ける向きを出す', '駒のふちに、動ける向きの印が出る（線は、どこまでも進める向き）');
  mk('danger', '取られそうな駒を知らせる', '相手の駒が利いている自分の駒に、点線の枠が出る');
  fs.append(checks);
  root.append(fs);
  function sync() {
    const off = a.who === 'none';
    boxes.forEach((c) => { c.disabled = off; });
    checks.classList.toggle('is-off', off);
  }
  sync();
}

// 盤（5五将棋・本将棋）をえらぶ欄
function variantPicker(root, value, onChange, disabled = false) {
  root.replaceChildren(...VARIANT_OPTS.map(([v, name, sub]) => {
    const lb = makeElement('label', 'sh-variant');
    const r = makeElement('input');
    r.type = 'radio';
    r.name = root.id + '-v';
    r.value = v;
    r.checked = variantOf(value) === v;
    r.disabled = disabled;
    r.addEventListener('change', () => onChange(v));
    const box = makeElement('span', 'sh-variant__box');
    box.append(makeElement('span', 'sh-variant__name', name), makeElement('span', 'sh-variant__sub', sub));
    lb.append(r, box);
    return lb;
  }));
}

/* ── 局面 ── */
// ルームに置く手の形 { f: 動かす前のます（打つときは -1）, t: 動かした先, d: 打った駒, p: 成ったか }
const packMove = (m) => (m.from < 0 ? { f: -1, t: m.to, d: m.drop, p: false } : { f: m.from, t: m.to, p: !!m.promote });
const unpackMove = (x) => ({ from: Number(x?.f), to: Number(x?.t), drop: typeof x?.d === 'string' ? x.d : '', promote: x?.p === true });

// 指した手の記録から局面を作る。いちど作った局面は覚えておき、1手ずつ足す
const cache = { v: null, moves: [], G: null };
function engineOf(v, moves) {
  const V = variantOf(v);
  let G = null;
  let from = 0;
  if (cache.G && cache.v === V && cache.moves.length <= moves.length && cache.moves.every((m, i) => E.sameMove(m, moves[i]))) {
    G = cache.G;
    from = cache.moves.length;
  } else {
    G = E.create(V);
  }
  for (let i = from; i < moves.length; i += 1) {
    const m = moves[i];
    // 読めない手（壊れた記録）があれば、そこまでの局面にする
    if (G.over || !E.legalMoves(G).some((x) => E.sameMove(x, m))) break;
    G = E.apply(G, m);
  }
  cache.v = V;
  cache.moves = moves.slice(0, G.ply);
  cache.G = G;
  return G;
}

// 投了・入玉宣言もふくめた、対局のおわり（おわっていなければ null）
function overOf(rec, G) {
  if (rec.resign != null) return { winner: 1 - rec.resign, reason: 'resign' };
  // 入玉宣言は、宣言した人の番で条件がそろっているときだけ有効（壊れた記録で勝ちにしない）
  if (rec.declare != null && rec.declare === G.turn && E.canDeclare(G)) return { winner: rec.declare, reason: 'declare' };
  return G.over;
}

// 補助の「先手だけ・後手だけ」を入れかえる（先手と後手の人が入れかわるとき、補助も人についていく）
function swapAid(aid) {
  const a = normAid(aid);
  return { ...a, who: a.who === 's' ? 'g' : a.who === 'g' ? 's' : a.who };
}

// 投了できる人。1台の画面は番の人。ルームは自分の席の人（相手の番でもよい）か、ホストが代わりに指している人
function resignSide(V) {
  if (V.over) return null;
  if (state.role === 'local') return V.cpu != null ? 1 - V.cpu : V.G.turn;
  if (V.mine(0) !== V.mine(1)) return V.mine(0) ? 0 : 1;
  if (V.mine(0) && V.mine(1)) return V.G.turn;
  return V.canPlay() ? V.G.turn : null;
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
  return typeof name === 'string' && (!!room?.players?.[name] || !!room?.proxies?.[name]);
}

function seatsOf(room) {
  const s = room?.seats || {};
  return { s: typeof s.s === 'string' ? s.s : null, g: typeof s.g === 'string' ? s.g : null };
}

const sideOfKey = (k) => (k === 's' ? 0 : k === 'g' ? 1 : null);

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
    v: variantOf(g.v),
    seats: { s: typeof seats.s === 'string' ? seats.s : null, g: typeof seats.g === 'string' ? seats.g : null },
    uids: { s: uids.s || null, g: uids.g || null },
    proxy: { s: proxy.s === true, g: proxy.g === true },
    moves,
    resign: sideOfKey(g.resign),
    declare: sideOfKey(g.declare),
    // 局面が変わるたびに増える番号（指す・投了・宣言・1手もどす）。古い操作の照合に使う
    rev: Number(g.rev) || 0,
    // 一度でもおわったか（もどしても消さない。finish を1対局に1回だけ数えるため）
    ended: g.ended === true,
  };
}

function seatPresent(room, game, side) {
  const k = KEYS[side];
  return game.proxy[k] || !!room?.players?.[game.seats[k]];
}

// その人の番に、この端末が指してよいか。ホストは、端末なしの人と通信が切れた人の代わりに指せる
function mayMove(room, game, side, uid, nickname, role) {
  if (role !== 'host' && role !== 'guest') return false;
  const k = KEYS[side];
  const isHost = role === 'host' && room.hostUid === uid;
  if (game.proxy[k]) return isHost;
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
    console.warn('[shogi] expired room cleanup failed', error);
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
  $('board').replaceChildren();
  $('sideTop').replaceChildren();
  $('sideBottom').replaceChildren();
  $('lobbyAid')._key = null;
  $('lobbyVariant')._key = null;
  state.sel = null;
  state.selKey = null;
  state.msg = '';
  state.flip = false;
  state.promo = null;
  state.drawnKey = null;
  state.drawnRev = -1;
  state.drawnPly = -1;
  if ($('aidDialog').open) $('aidDialog').close();
  if ($('promoDialog').open) $('promoDialog').close();
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
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
    console.warn('[shogi] room listener failed', error);
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
    console.warn('[shogi] presence recovery failed', error);
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
          v: 'mini',
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
    console.warn('[shogi] create failed', err);
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
    console.warn('[shogi] join failed', err);
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
    console.warn('[shogi] reconnect failed', error);
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
    console.warn('[shogi] leave failed', error);
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
    console.warn('[shogi] watch failed', error);
    fail('接続できませんでした。もう一度ためしてね');
    return false;
  } finally {
    state.busy = false;
    $('btnWatchOpen').disabled = false;
  }
}

function connectWatch(code, ref) {
  state.role = 'spectator';
  document.title = 'みんなにみせる画面 | 将棋 | あそびのたな';
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
    console.warn('[shogi] watch listener failed', error);
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

function stopWatch() {
  clearTimeout(state.watchTimer);
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
    console.warn('[shogi] host action failed', error);
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
    const other = k === 's' ? 'g' : 's';
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
    return { ...room, seats: { s: s.g, g: s.s }, aid: swapAid(room.aid) };
  }, '入れかえられませんでした。もう一度ためしてね', false);
}

async function setVariant(v) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, v: variantOf(v) };
  }, '盤を変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) {
    $('lobbyVariant')._key = null;
    renderRoom(state.room);
  }
}

// 補助はいつでも変えられる（あそんでいる間も）。続けて変えても取りこぼさないよう、ロックを使わない
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
    const seats = seatsOf(room);
    if (room.players?.[name] || room.proxies?.[name] || name === room.host || seats.s === name || seats.g === name) { reason = '「' + name + '」はもういるよ'; return; }
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
  if (!seats.s || !seats.g || seats.s === seats.g) return null;
  if (!seatable(room, seats.s) || !seatable(room, seats.g)) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const proxy = {};
  const uids = {};
  KEYS.forEach((k) => {
    if (room.proxies?.[seats[k]]) proxy[k] = true;
    else uids[k] = room.players[seats[k]].uid;
  });
  return { id, v: variantOf(room.v), seats: { ...seats }, uids, proxy, rev: 0 };
}

function countStart(v) {
  window.RoomkStats?.count('start');
  window.RoomkStats?.count('players-2');
  window.RoomkStats?.count(variantOf(v) === 'hon' ? 'board-9' : 'board-5');
}

async function startGame() {
  let v = null;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const game = newGameFor(room, seatsOf(room));
    if (!game) return;
    v = game.v;
    return { ...room, status: STATUS.PLAY, lastGameId: game.id, game };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) countStart(v);
  else if (ok === false) toast('対戦する2人を選んでね');
}

async function undoMove() {
  const before = gameOf(state.room);
  if (!before) return;
  const gid = before.id;
  const rev = before.rev;
  const what = before.resign != null ? '投了を取り消すよ' : before.declare != null ? '入玉宣言を取り消すよ' : '直前に指した手を取り消すよ';
  if (!window.confirm('1手もどす？（' + what + '）')) return;
  const ok = await hostTransaction((room) => {
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid || game.rev !== rev) return;
    const next = { ...room.game, rev: game.rev + 1, resign: null, declare: null };
    const valid = game.moves.slice(0, engineOf(game.v, game.moves).ply);
    if (game.resign == null && game.declare == null) {
      if (!valid.length) return;
      next.moves = valid.slice(0, -1).map(packMove);
    } else {
      next.moves = valid.map(packMove);
    }
    return { ...room, game: next };
  }, 'もどせませんでした。もう一度ためしてね');
  if (ok === false) toast('盤が進んだので、もどさなかったよ。もう一度ためしてね', false);
}

// もう一回（先手と後手を入れかえる）
async function playAgain() {
  const gid = gameOf(state.room)?.id;
  let reason = '';
  let v = null;
  const ok = await hostTransaction((room) => {
    reason = '';
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid) return;
    if (!overOf(game, engineOf(game.v, game.moves))) return;
    const seats = { s: game.seats.g, g: game.seats.s };
    const next = newGameFor({ ...room, v: game.v }, seats);
    if (!next) { reason = 'そろっていない'; return; }
    v = next.v;
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
  const wasOver = !!game && !!overOf(game, engineOf(game.v, game.moves));
  if (!wasOver && !window.confirm('この対局をやめて、待合室にもどる？')) return;
  const ok = await hostTransaction((room) => {
    const cur = gameOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== gid) return;
    return { ...room, status: STATUS.WAITING, game: null, seats: { ...cur.seats } };
  }, 'もどれませんでした。もう一度ためしてね');
  if (ok && wasOver) window.RoomkStats?.count('again');
}

/* ── 指す・投了・宣言（ルーム） ── */
// kind: 'move'（m を指す）| 'resign'（投了）| 'declare'（入玉宣言）
async function actRoom(kind, m, side) {
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
    const result = await state.roomRef.transaction((r) => {
      finished = false;
      if (!r || isExpired(r) || r.status !== STATUS.PLAY) return;
      const cur = gameOf(r);
      // 押した時点の対局・局面と同じときだけ（古い操作で次の手を変えない。1手もどしたあとも）
      if (!cur || cur.id !== gid || cur.rev !== rev) return;
      const G = engineOf(cur.v, cur.moves);
      // 読めない手（壊れた記録）は落として、読める手までにそろえる
      const valid = cur.moves.slice(0, G.ply);
      if (overOf(cur, G)) return;
      // 投了は、自分の席なら相手の番でもできる。ほかは番の人だけ
      if (!mayMove(r, cur, kind === 'resign' ? side : G.turn, uid, nickname, role)) return;
      const next = { ...r.game, rev: cur.rev + 1, moves: valid.map(packMove) };
      if (kind === 'move') {
        if (!E.legalMoves(G).some((x) => E.sameMove(x, m))) return;
        next.moves = valid.concat([m]).map(packMove);
        finished = !!E.apply(G, m).over;
      } else if (kind === 'resign') {
        if (side !== 0 && side !== 1) return;
        next.resign = KEYS[side];
        finished = true;
      } else if (kind === 'declare') {
        if (!E.canDeclare(G)) return;
        next.declare = KEYS[G.turn];
        finished = true;
      } else {
        return;
      }
      finished = finished && !cur.ended;
      next.ended = cur.ended || finished;
      return { ...r, game: next };
    });
    committed = result.committed;
    if (committed && finished) window.RoomkStats?.count('finish');
  } catch (error) {
    console.warn('[shogi] move failed', error);
    toast('指せませんでした。もう一度ためしてね');
  } finally {
    state.moving = false;
  }
  if (!committed && kind === 'move') {
    state.msg = '盤が変わったので、指さなかったよ。もう一度選んでね。';
    if (state.room) renderGame();
  }
  return committed;
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
      v: variantOf(saved.v),
      names: [String(saved.names?.[0] || '').slice(0, 8), String(saved.names?.[1] || '').slice(0, 8)],
      aid: normAid(saved.aid),
      moves: asList(saved.moves).map((m) => ({ from: Number(m?.from), to: Number(m?.to), drop: typeof m?.drop === 'string' ? m.drop : '', promote: m?.promote === true }))
        .filter((m) => Number.isInteger(m.from) && Number.isInteger(m.to)),
      resign: saved.resign === 0 || saved.resign === 1 ? saved.resign : null,
      declare: saved.declare === 0 || saved.declare === 1 ? saved.declare : null,
      ended: saved.ended === true,
      rev: Number(saved.rev) || 0,
      cpu: cpuOf(saved.cpu),
      level: levelOf(saved.level),
    };
    if (L.cpu != null) L.names[L.cpu] = CPU_NAME;
    // 読めない手は落とす
    L.moves = L.moves.slice(0, engineOf(L.v, L.moves).ply);
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
   CPU の番は CPU_MS 待ってから考えはじめる（どこに指したか見えるように）。ルームには入れない（リバーシと同じ） */
const CPU_NAME = 'CPU';
const CPU_MS = 700;
const cpuOf = (v) => (v === 0 || v === 1 ? v : v === '0' ? 0 : v === '1' ? 1 : null);
const levelOf = (v) => (v === 'weak' || v === 'strong' ? v : 'normal');
const localVs = () => cpuOf(document.querySelector('input[name="localVs"]:checked')?.value);
const localLevel = () => levelOf(document.querySelector('input[name="localLevel"]:checked')?.value);
const cpuTurnKey = (L) => L.v + ':' + L.rev + ':' + L.moves.length;
function stopCpu() {
  clearTimeout(state.cpuTimer);
  state.cpuTimer = null;
  state.cpuKey = null;
}
function cpuThinking() {
  const L = state.local;
  if (state.role !== 'local' || !L || L.cpu == null) return false;
  const G = engineOf(L.v, L.moves);
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
    const G = engineOf(cur.v, cur.moves);
    // 入玉宣言できるなら宣言する（本将棋）
    if (E.canDeclare(G)) { actLocal('declare'); return; }
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

function openLocalSetup(names, v, cpu = null, level = 'normal') {
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
  state.localVariant = variantOf(v || state.localVariant);
  variantPicker($('localVariant'), state.localVariant, (nv) => { state.localVariant = nv; });
  state.localAid = normAid(state.localAid);
  aidEditor($('localAid'), state.localAid, (a) => { state.localAid = a; });
  showScreen('local');
}

function newLocal(v, names, aid, cpu = null, level = 'normal') {
  const n = names.slice();
  if (cpu != null) n[cpu] = CPU_NAME;
  return { v: variantOf(v), names: n, aid: normAid(aid), moves: [], resign: null, declare: null, ended: false, rev: 0, cpu, level: levelOf(level) };
}

function startLocal() {
  state.role = 'local';
  resetBoxes();
  stopCpu();
  state.local = newLocal(state.localVariant, [$('localName0').value.trim().slice(0, 8), $('localName1').value.trim().slice(0, 8)], state.localAid, localVs(), localLevel());
  saveLocal();
  window.RoomkStats?.count('local-start');
  window.RoomkStats?.count(state.local.v === 'hon' ? 'board-9' : 'board-5');
  showScreen('game');
  renderGame();
}

function actLocal(kind, m, side) {
  const L = state.local;
  const G = engineOf(L.v, L.moves);
  if (overOf(L, G)) return;
  let finished = false;
  if (kind === 'move') {
    if (!E.legalMoves(G).some((x) => E.sameMove(x, m))) return;
    L.moves = L.moves.concat([m]);
    finished = !!E.apply(G, m).over;
  } else if (kind === 'resign') {
    // 投了したのは押した人（CPU と対戦するときは、CPU の番でも自分の側）
    const who = side === 0 || side === 1 ? side : G.turn;
    if (L.cpu != null && who === L.cpu) return;
    L.resign = who;
    finished = true;
  } else if (kind === 'declare') {
    if (!E.canDeclare(G)) return;
    L.declare = G.turn;
    finished = true;
  }
  L.rev += 1;
  if (finished && !L.ended) window.RoomkStats?.count('local-finish');
  L.ended = L.ended || finished;
  saveLocal();
  renderGame();
}

function undoLocal() {
  const L = state.local;
  if (L.resign != null || L.declare != null) {
    L.resign = null;
    L.declare = null;
  } else if (L.moves.length) {
    let moves = L.moves.slice(0, -1);
    // CPU と対戦するときは、自分の番までもどす（CPU の手と、その前の自分の手をいっしょに）
    if (L.cpu != null && engineOf(L.v, moves).turn === L.cpu) {
      if (!moves.length) return;
      moves = moves.slice(0, -1);
    }
    L.moves = moves;
  } else {
    return;
  }
  stopCpu();
  L.rev += 1;
  state.msg = '1手もどしたよ。';
  saveLocal();
  renderGame();
}

function quitLocal() {
  const L = state.local;
  if (L && !overOf(L, engineOf(L.v, L.moves)) && L.moves.length && !window.confirm('おわりにして、トップへ戻る？')) return;
  stopCpu();
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
    if ($('promoDialog').open) $('promoDialog').close();
    showScreen(next);
  }
  renderBar(room);
  if (playing) renderGame();
  else renderWaiting(room);
}

function updateHostOverlay(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
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
    $('hostOffOverlay').hidden = true;
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
      if (seats[k] && !people.includes(seats[k])) {
        const o = makeElement('option', '', seats[k] + '（いない）');
        o.value = seats[k];
        opts.push(o);
      }
      sel.replaceChildren(...opts);
      sel.value = seats[k] || '';
    });
  } else {
    $('seatView').replaceChildren(...KEYS.map((k, side) => {
      const box = makeElement('div', 'sh-seatview');
      box.append(makeElement('span', 'sh-seatview__color', MARK[side] + ' ' + SIDE[side]));
      const name = seats[k];
      const label = name ? name + (name === state.nickname && !watch ? '（あなた）' : '') + (seatable(room, name) ? '' : '（いない）') : 'まだ決まっていない';
      box.append(makeElement('span', 'sh-seatview__name' + (name ? '' : ' is-empty'), label));
      return box;
    }));
  }
  const ready = !!seats.s && !!seats.g && seats.s !== seats.g && seatable(room, seats.s) && seatable(room, seats.g);
  let note = '';
  if (host) {
    if (people.length < 2) note = 'もう1人入ると、はじめられるよ。ホストも対戦するときは、自分を選んでね';
    else if (!ready) note = '先手と後手の人を選んでね。ホストも対戦できるよ';
    else note = '先手の人から先に指すよ';
  }
  $('seatNote').textContent = note;
  $('seatNote').hidden = !note;

  // 参加している人
  $('lobbyPeople').replaceChildren(...people.map((name) => {
    const proxy = !!room.proxies?.[name];
    const li = makeElement('li', 'sh-person');
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    li.append(msIcon(host && proxy ? 'person_off' : 'person'), makeElement('span', 'sh-person__name', name));
    if (name === room.host) li.append(makeElement('span', 'sh-tag sh-tag--muted', 'ホスト'));
    if (host && proxy) li.append(makeElement('span', 'sh-tag sh-tag--muted', '端末なし'));
    if (seats.s === name) li.append(makeElement('span', 'sh-tag sh-tag--s', '先手'));
    else if (seats.g === name) li.append(makeElement('span', 'sh-tag sh-tag--g', '後手'));
    else li.append(makeElement('span', 'sh-tag sh-tag--watch', '観戦'));
    if (name === state.nickname && !watch) li.append(makeElement('span', 'sh-tag sh-tag--watch', 'あなた'));
    if (host && proxy) {
      const del = makeElement('button', 'sh-quiet sh-person__del', '外す');
      del.type = 'button';
      del.addEventListener('click', () => removeProxy(name));
      li.append(del);
    }
    return li;
  }));
  $('proxyForm').hidden = !host;

  // 盤
  $('lobbyVariant').hidden = !host;
  $('lobbyVariantView').hidden = host;
  if (host) {
    const key = variantOf(room.v);
    if ($('lobbyVariant')._key !== key) {
      variantPicker($('lobbyVariant'), key, (v) => { $('lobbyVariant')._key = v; setVariant(v); });
      $('lobbyVariant')._key = key;
    }
  } else {
    $('lobbyVariantView').textContent = variantName(room.v) + '（' + E.VARIANTS[variantOf(room.v)].size + '）';
  }

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

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

// 画面に出すための共通の形にそろえる（1台の画面とルーム）
function viewModel() {
  if (state.role === 'local') {
    const L = state.local;
    const G = engineOf(L.v, L.moves);
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
      key: 'local:' + L.v,
      rev: L.rev,
    };
  }
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game) return null;
  const uid = currentUid();
  const G = engineOf(game.v, game.moves);
  const over = overOf(game, G);
  return {
    rec: game,
    G,
    over,
    aid: room.aid,
    room,
    name: (side) => game.seats[KEYS[side]] || '',
    away: (side) => !seatPresent(room, game, side),
    proxy: (side) => game.proxy[KEYS[side]],
    canPlay: () => !over && mayMove(room, game, G.turn, uid, state.nickname, state.role),
    mine: (side) => (state.role === 'host' || state.role === 'guest') && game.seats[KEYS[side]] === state.nickname && game.uids[KEYS[side]] === uid,
    key: state.roomCode + ':' + game.id,
    rev: game.rev,
  };
}
const sideLabel = (V, side) => MARK[side] + SIDE[side] + (V.name(side) ? '（' + V.name(side) + '）' : '');

function overText(V, o) {
  if (o.reason === 'resign') return sideLabel(V, 1 - o.winner) + 'が投了。' + sideLabel(V, o.winner) + 'の勝ち！';
  if (o.reason === 'declare') return '入玉宣言。' + sideLabel(V, o.winner) + 'の勝ち！';
  if (o.reason === 'sennichite') return o.winner < 0 ? '同じ形が4回出たので、千日手で引き分け' : '同じ形が4回出た千日手なので、' + sideLabel(V, o.winner) + 'の勝ち！';
  if (o.reason === 'perpetual') return '王手を続けた千日手なので、' + sideLabel(V, o.winner) + 'の勝ち！';
  if (o.reason === 'nomove') return sideLabel(V, 1 - o.winner) + 'は指せる手がないので、' + sideLabel(V, o.winner) + 'の勝ち！';
  return '詰み。' + sideLabel(V, o.winner) + 'の勝ち！';
}

function renderGame() {
  const V = viewModel();
  if (!V) return;
  const G = V.G;
  const local = state.role === 'local';
  const host = state.role === 'host';
  const can = V.canPlay();
  const selKey = V.key + ':' + V.rev;
  if (state.selKey !== selKey) {
    // 局面が変わったら、選んでいる駒と知らせを消す（自分で「1手もどす」を押したときの知らせは残す）
    state.sel = null;
    if (state.selKey && state.msg !== '1手もどしたよ。') state.msg = '';
    state.selKey = selKey;
    if (state.promo && $('promoDialog').open) $('promoDialog').close();
    state.promo = null;
  }
  if (!can) {
    state.sel = null;
    // 成るかを聞いている間に指せなくなったら（代わりに指していた人が戻ったなど）、聞くのをやめる
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
    st.textContent = overText(V, V.over);
  } else {
    let line;
    if (local && V.cpu != null && G.turn === V.cpu) line = sideLabel(V, G.turn) + 'が考え中';
    else if (local && V.cpu != null) line = 'あなたの番（' + MARK[G.turn] + SIDE[G.turn] + '）';
    else if (local) line = sideLabel(V, G.turn) + 'の番';
    else if (V.mine(G.turn)) line = 'あなたの番（' + MARK[G.turn] + SIDE[G.turn] + '）';
    else if (can) line = sideLabel(V, G.turn) + 'の番。代わりに指してね';
    else line = sideLabel(V, G.turn) + 'が考え中';
    st.append(makeElement('span', '', line));
    if (G.check) st.append(makeElement('span', 'sh-check-badge', '王手'));
  }

  // 盤の向き: 後手の席の人は後手を手前に。「盤の向きを変える」で逆に
  const bottom = (V.mine(1) && !V.mine(0) ? 1 : 0) ^ (state.flip ? 1 : 0);
  renderBoard(V, bottom, can);
  renderSide($('sideTop'), V, 1 - bottom, false, can);
  renderSide($('sideBottom'), V, bottom, true, can);

  $('gameMsg').textContent = state.msg;
  $('lastLine').textContent = G.last ? G.ply + '手目　' + G.last.text : '';

  // 入玉宣言
  $('declareBox').hidden = !(can && !V.over && E.canDeclare(G));

  // 結果のあとのボタン
  $('resultBox').hidden = !V.over || state.role === 'spectator';
  if (V.over) {
    $('resultHost').hidden = !(host || local);
    $('resultWait').hidden = host || local;
    $('btnAgain').textContent = local && !V.name(0) && !V.name(1) ? 'もう一回あそぶ' : 'もう一回（先手と後手を入れかえる）';
    $('btnRelobby').textContent = local ? '盤と補助を変える' : '対戦する人を選びなおす';
  }

  // そのほかの操作
  const rec = V.rec;
  $('btnUndo').hidden = !(host || local);
  // CPU と対戦するときは、自分がまだ指していなければもどせない（CPU が先手で1手目のあと）
  const ownMoves = local && V.cpu != null ? rec.moves.filter((m, i) => i % 2 !== V.cpu).length : rec.moves.length;
  $('btnUndo').disabled = !ownMoves && rec.resign == null && rec.declare == null;
  $('btnAid').hidden = !(host || local);
  $('btnResign').hidden = resignSide(V) == null;
  $('btnReset').hidden = !(host || local);
  $('btnReset').textContent = local ? '最初からやりなおす' : 'この対局をやめる';
  if (local) scheduleCpu();
  $('btnQuit').hidden = !local;
}

/* ── 盤と持ち駒 ── */
// 駒の形（五角形）と字。up: 見ている人から見て上向き
function pieceNode(c, up, arrows) {
  const node = makeElement('span', 'sh-piece' + (up ? '' : ' is-down') + (E.isProm(c) ? ' is-prom' : ''));
  const name = E.pieceName(c);
  node.append(makeElement('span', 'sh-piece__face' + (name.length > 1 ? ' is-two' : ''), name));
  if (arrows) node.append(arrowsNode(c));
  return node;
}
// 動ける向きの印（駒の向きのまま描く。相手の駒は駒ごと回る）
function arrowsNode(c) {
  const box = makeElement('span', 'sh-arrows');
  box.setAttribute('aria-hidden', 'true');
  const sp = E.SPEC[E.kindOf(c)];
  const put = (node, x, y) => { node.style.left = x + '%'; node.style.top = y + '%'; };
  sp.steps.forEach(([dr, dc]) => {
    const dot = makeElement('span', 'sh-arrows__dot');
    if (Math.abs(dr) === 2) {   // 桂: 上の角の外へ跳ぶ
      dot.classList.add('is-jump');
      put(dot, 50 + dc * 36, 2);
    } else {
      put(dot, 50 + dc * 44, 50 + dr * 44);
    }
    box.append(dot);
  });
  sp.slides.forEach(([dr, dc]) => {
    const bar = makeElement('span', 'sh-arrows__bar');
    put(bar, 50 + dc * 42, 50 + dr * 42);
    bar.style.transform = 'translate(-50%, -50%) rotate(' + (Math.atan2(dr, dc) * 180 / Math.PI + 90) + 'deg)';
    box.append(bar);
  });
  return box;
}

function selTargets(G) {
  if (!state.sel) return [];
  return E.legalMoves(G).filter((m) => (state.sel.drop ? m.drop === state.sel.drop : m.from === state.sel.from));
}

function renderBoard(V, bottom, can) {
  const G = V.G;
  const n = G.n;
  const root = $('board');
  const turnAid = aidFor(V.aid, G.turn);
  const showAid = can && !V.over;
  const targets = can ? selTargets(G) : [];
  const targetSet = new Set(targets.map((m) => m.to));
  const danger = showAid && turnAid.danger ? new Set(E.threatened(G, G.turn)) : new Set();
  const checkKing = G.check && !V.over ? E.kingSquare(G.board, G.turn) : -1;
  // 同じ対局で1手すすんだときだけ、置いた駒に動きを付ける
  const animate = state.drawnKey === V.key && V.rev === state.drawnRev + 1 && G.ply === state.drawnPly + 1 && !!G.last;
  const flip = bottom === 1;
  const board = makeElement('div', 'sh-board' + (n === 5 ? ' is-mini' : ''));
  board.style.setProperty('--n', n);
  board.setAttribute('role', 'grid');
  board.setAttribute('aria-label', '盤');
  for (let vc = 0; vc < n; vc += 1) {
    const c = flip ? n - 1 - vc : vc;
    board.append(makeElement('span', 'sh-coord', E.WIDE_NUM[n - c - 1]));
  }
  board.append(makeElement('span', 'sh-coord'));
  for (let vr = 0; vr < n; vr += 1) {
    const r = flip ? n - 1 - vr : vr;
    for (let vc = 0; vc < n; vc += 1) {
      const c = flip ? n - 1 - vc : vc;
      const i = r * n + c;
      const cell = makeElement('button', 'sh-cell');
      cell.type = 'button';
      cell.dataset.i = String(i);
      cell.setAttribute('role', 'gridcell');
      if (vc === 0) cell.classList.add('is-edge-l');
      if (vr === 0) cell.classList.add('is-edge-t');
      const p = G.board[i];
      let label = E.squareName(n, i);
      if (G.last && G.last.to === i) cell.classList.add('is-last');
      if (G.last && G.last.from === i) cell.classList.add('is-lastfrom');
      if (state.sel && state.sel.from === i) cell.classList.add('is-sel');
      if (i === checkKing) cell.classList.add('is-check');
      if (danger.has(i)) cell.classList.add('is-danger');
      if (p) {
        const owner = E.ownerOf(p);
        const piece = pieceNode(p, owner === bottom, aidFor(V.aid, owner).arrows);
        if (animate && G.last.to === i) piece.classList.add('is-new');
        cell.append(piece);
        label += ' ' + MARK[owner] + E.pieceName(p);
      } else {
        label += ' 空き';
      }
      if (targetSet.has(i)) {
        if (turnAid.spots) cell.append(makeElement('span', 'sh-spot' + (p ? ' sh-spot--take' : '')));
      }
      cell.classList.toggle('is-playable', can && (targetSet.has(i) || (!!p && E.ownerOf(p) === G.turn)));
      cell.disabled = !can;
      cell.setAttribute('aria-label', label);
      cell.addEventListener('click', () => onCell(i));
      board.append(cell);
    }
    board.append(makeElement('span', 'sh-coord', E.KANJI_NUM[r]));
  }
  root.replaceChildren(board);
  state.drawnKey = V.key;
  state.drawnRev = V.rev;
  state.drawnPly = G.ply;
}

function renderSide(box, V, side, isBottom, can) {
  const G = V.G;
  const turn = !V.over && G.turn === side;
  box.replaceChildren();
  box.classList.toggle('is-turn', turn);
  const head = makeElement('div', 'sh-side__head');
  head.append(makeElement('span', 'sh-side__mark', MARK[side]), makeElement('span', 'sh-side__label', SIDE[side] + (V.mine(side) ? '（あなた）' : '')));
  if (V.name(side)) head.append(makeElement('span', 'sh-side__name', V.name(side)));
  if (turn) head.append(makeElement('span', 'sh-tag sh-tag--turn', 'の番'));
  if (V.over && V.over.winner === side) head.append(makeElement('span', 'sh-tag sh-tag--win', '勝ち'));
  if (V.away(side)) head.append(makeElement('span', 'sh-tag sh-tag--warn', '通信が切れた'));
  // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
  if (state.role === 'host' && V.proxy(side)) head.append(makeElement('span', 'sh-tag sh-tag--muted', '端末なし'));
  box.append(head);

  const hand = makeElement('div', 'sh-hand');
  hand.setAttribute('aria-label', SIDE[side] + 'の持ち駒');
  const mine = can && turn;
  let any = false;
  E.HAND_ORDER.forEach((t) => {
    const count = G.hands[side][t];
    if (!count) return;
    any = true;
    const btn = makeElement('button', 'sh-handpiece');
    btn.type = 'button';
    btn.disabled = !mine;
    btn.classList.toggle('is-playable', mine);
    if (mine && state.sel && state.sel.drop === t) btn.classList.add('is-sel');
    btn.append(pieceNode(side === 0 ? t : t.toLowerCase(), isBottom, false));
    if (count > 1) btn.append(makeElement('span', 'sh-handpiece__count', '×' + count));
    btn.setAttribute('aria-label', '持ち駒の' + E.NAME[t] + ' ' + count + '枚');
    btn.addEventListener('click', () => onHand(t, side));
    hand.append(btn);
  });
  if (!any) hand.append(makeElement('span', 'sh-hand__none', '持ち駒なし'));
  box.append(hand);
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
    if (cand.length === 2) { openPromo(cand, V); return; }
    if (cand.length === 1) { play(cand[0]); return; }
    if (p && E.ownerOf(p) === G.turn) {
      state.sel = state.sel.from === i ? null : { from: i };
      if (state.sel && !selTargets(G).length) state.msg = noMoveReason(G, i);
      renderGame();
      return;
    }
    state.msg = E.whyIllegal(G, state.sel.drop ? -1 : state.sel.from, i, state.sel.drop || '') || 'そこには指せないよ。';
    state.sel = null;
    renderGame();
    return;
  }
  if (p && E.ownerOf(p) === G.turn) {
    state.sel = { from: i };
    if (!selTargets(G).length) state.msg = noMoveReason(G, i);
    renderGame();
  }
}

function noMoveReason(G, i) {
  const raw = E.targetsOf(G.board, G.n, i);
  if (!raw.length) return 'その駒は、いま動ける所がないよ。';
  return E.whyIllegal(G, i, raw[0], '') || 'その駒は、いま動ける所がないよ。';
}

function onHand(t, side) {
  const V = viewModel();
  if (!V || !V.canPlay() || V.G.turn !== side) return;
  state.msg = '';
  state.sel = state.sel && state.sel.drop === t ? null : { drop: t };
  if (state.sel && !selTargets(V.G).length) state.msg = 'その駒は、いま打てる所がないよ。';
  renderGame();
}

function play(m) {
  state.sel = null;
  state.promo = null;
  if (state.role === 'local') actLocal('move', m);
  else actRoom('move', m);
}

function openPromo(cands, V) {
  state.promo = cands;
  const c = V.G.board[cands[0].from];
  const bottom = (V.mine(1) && !V.mine(0) ? 1 : 0) ^ (state.flip ? 1 : 0);
  const up = E.ownerOf(c) === bottom;
  $('promoYesPiece').replaceChildren(pieceNode('+' + c, up, false));
  $('promoNoPiece').replaceChildren(pieceNode(c, up, false));
  $('promoDialog').showModal();
  $('btnPromoYes').focus();
}

function closePromo(choice) {
  const cands = state.promo;
  if ($('promoDialog').open) $('promoDialog').close();
  state.promo = null;
  if (!cands || choice == null) {
    renderGame();
    return;
  }
  play(cands.find((m) => m.promote === choice));
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

function declare() {
  const V = viewModel();
  if (!V || !V.canPlay() || !E.canDeclare(V.G)) return;
  if (!window.confirm('入玉宣言をして、勝ちにする？')) return;
  if (state.role === 'local') actLocal('declare');
  else actRoom('declare');
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

$('seat0').addEventListener('change', (event) => setSeat('s', event.currentTarget.value));
$('seat1').addEventListener('change', (event) => setSeat('g', event.currentTarget.value));
$('btnSeatSwap').addEventListener('click', swapSeats);
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnStartGame').addEventListener('click', startGame);

$('btnLocalSwap').addEventListener('click', () => {
  const a = $('localName0').value;
  $('localName0').value = $('localName1').value;
  $('localName1').value = a;
});
$('btnLocalStart').addEventListener('click', startLocal);
document.querySelectorAll('input[name="localVs"]').forEach((r) => r.addEventListener('change', syncLocalVs));

$('btnPromoYes').addEventListener('click', () => closePromo(true));
$('btnPromoNo').addEventListener('click', () => closePromo(false));
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
$('btnResign').addEventListener('click', resign);
$('btnDeclare').addEventListener('click', declare);
$('btnReset').addEventListener('click', () => {
  if (state.role === 'local') {
    const L = state.local;
    if (!overOf(L, engineOf(L.v, L.moves)) && L.moves.length && !window.confirm('最初からやりなおす？')) return;
    stopCpu();
    state.local = newLocal(L.v, L.names, L.aid, L.cpu, L.level);
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
    // 先手と後手を入れかえる（CPU の側も入れかわる。CPU が先手になると、CPU から指す）
    stopCpu();
    state.local = newLocal(L.v, [L.names[1], L.names[0]], swapAid(L.aid), L.cpu == null ? null : 1 - L.cpu, L.level);
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
    openLocalSetup(L.names, L.v, L.cpu, L.level);
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
