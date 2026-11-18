/* あれください商店
   ・ルーム: Realtime Database。遊ぶ2〜12人が、それぞれの端末で自分のお店を持つ
   ・番の人だけがお客さんになり、ほしい物をヒント2つで聞く。お店の人は、決まった時間の中で「品物を出す・質問する・出さない」をえらぶ
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない。お客さんのほしい物は、結果が出るまで出さない
   ルール（品物・ポイント・注文の決め方）は engine.js、絵は art.js。音は鳴らさない。

   あそんでいる間の書き込みは小さく分ける。お客さんのヒント（r/h・r/at）、お店の人の決めたこと（r/d/{席}）・質問（r/q/{席}）は、
   それぞれの場所へ書く。1回の番を決める（品物を動かし、ポイントを足し、次のお客さんにする）のは、お客さん（いないときはホスト）が
   play/{対決の番号} への transaction で1回だけ。同じ番を2回決めないよう、番の番号（r/n）が同じときだけ書く。 */
const E = window.ArekuEngine;
const A = window.ArekuArt;

const MIN_SEATS = E.MIN_PLAYERS;
const MAX_SEATS = E.MAX_PLAYERS;
const TIMES = [5, 10, 15, 0];   // あそぶ時間（分）。0 はなし
const DEFAULT_SET = { hostPlays: true, time: 10, showAll: false, offer: 30, ask: 0 };
// お店の人が決める時間（秒。お客さんがヒントを送ってから、品物を出すか決めるまで）。ホストが待合室でえらぶ
// （2026-11-15 オーナー「商品を説明する時間がかかりすぎる人がいる。商品を出すまでの時間を設定できるように」）
const OFFERS = [0, 15, 20, 30, 45, 60];   // お店の人が決める時間（秒。0 はなし＝みんな決めるまで待つ）
const ASKS = [0, 20, 30, 45, 60];   // お客さんがヒントを決める時間（秒。0 はなし）
const RESULT_MS = 6000;         // 結果の札のあと、ヒントを決める時間を数えはじめるまで（札は「次へ」で閉じる）
const OPEN_MS = 900;            // 箱がゆれてから開くまで
// ちがう物が出てきたときの、お客さんのひとこと
const VOICES = [
  '「…これはこれで、いいかも」',
  '「思っていたのとちがうけど、おもしろい！」',
  '「まあ、使ってみよう」',
  '「えっ、これ？ でも気に入った」',
  '「たのんだ物よりいいかもしれない」',
  '「どこに置こうかな…」',
];
// 箱を出したお店の人が、お客さんに送るコメント（接客の言葉。品物の特徴は言わない。データには番号を置く）
const COMMENTS = ['どうぞ！', 'これだと思う！', 'たぶん、これかな', 'ちょっと自信ないけど…', 'ちがったらごめんね', 'おすすめです'];
const CALM = window.matchMedia('(prefers-reduced-motion: reduce)');

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'arekudasaishoten_rooms';
const SESSION_KEY = 'arekudasaishoten_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play' };
const DEFAULT_TITLE = document.title;

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'（みんなにみせる画面）
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
  watchTimer: null,
  clockTimer: null,
  // 端末の中だけで持つ状態
  round: '',           // いま出している番（対決の番号:番の番号）。変わったら、質問の欄をとじる
  asking: false,       // お店の人が「お客さんに質問する」をひらいているか
  offering: null,      // お店の人がえらんだ品物（「この品物を出す」を押す前）
  picks: [],           // お客さんがえらんでいるヒント（送る前）
  comment: null,       // お店の人がえらんでいるコメントの番号（送る前）
  lastSeen: null,      // 結果の札を出した番 { game, key }（はじめて開いたときは、前の結果を出さない）
  result: null,        // いま出している結果の札 { key, openUntil }（「次へ」で閉じる）
  cardClosed: null,    // 結果の札を閉じた番と時刻 { round, at }（お客さんのヒントを決める時間に使う）
  phaseKey: '',        // いま出している場面（時間が来て場面が変わったら、出しなおす）
  sending: false,      // ヒント・決めたこと・番を決める書き込みの途中
  setKey: null,
  best: null,          // この画面を開いている間の、自分のこれまでの一番（どこにも残さない）
  endShown: '',        // おわりの画面を出した対決（利用回数を1回だけ数える）
  sendFailAt: 0,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.ak-screen').forEach((node) => node.classList.remove('active'));
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
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '名前に、記号 . # $ [ ] / は使えないよ';
  return '';
}

function currentUid() {
  return firebase.auth().currentUser?.uid || null;
}

function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}

function btn(className, text, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function icon(name, className) {
  const node = el('span', 'material-symbols-rounded' + (className ? ' ' + className : ''), name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// art.js の決まった絵を入れる（利用者の入力は入らない）
function art(className, svg) {
  const node = el('span', className);
  node.innerHTML = svg;
  return node;
}

// ヒントの印と言葉
function tagLabel(node, t) {
  node.append(art('ak-ti', A.tag(t)), document.createTextNode(t));
  return node;
}

const tint = (node, i) => { node.style.setProperty('--c', A.COLORS[i % A.COLORS.length]); return node; };
const face = (i, className) => tint(art('ak-face' + (className ? ' ' + className : ''), A.face(i)), i);

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).sort((a, b) => a - b).map((k) => value[k]);
  return [];
}

/* ── 設定 ── */
function normSet(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    hostPlays: typeof s.hostPlays === 'boolean' ? s.hostPlays : DEFAULT_SET.hostPlays,
    time: TIMES.includes(s.time) ? s.time : DEFAULT_SET.time,
    showAll: s.showAll === true,
    offer: OFFERS.includes(s.offer) ? s.offer : DEFAULT_SET.offer,
    ask: ASKS.includes(s.ask) ? s.ask : DEFAULT_SET.ask,
  };
}
const timeLabel = (t) => (t ? t + '分' : 'なし');
const askLabel = (t) => (t ? t + '秒' : 'なし');
const offerLabel = askLabel;
const settingSummary = (set) => 'あそぶ時間は ' + timeLabel(set.time) + '・お客さんがヒントを決める時間は ' + askLabel(set.ask) + '・お店の人が決める時間は ' + offerLabel(set.offer) + (set.showAll ? '・みんなのポイントを見せる' : '');

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}
// 在室している人を参加順に（ホストもふくむ）
const memberNames = (room) => byJoined(Object.entries(room?.players || {}));
// 遊ぶ人に入れられる人（在室していて、匿名IDがある人）
const seatable = (room, name) => typeof name === 'string' && typeof room?.players?.[name]?.uid === 'string' && !!room.players[name].uid;

// 遊ぶ人（参加している人みんな。参加した順に、お店の番号が決まる）。ホストは「ホストも遊ぶ」のときだけ
function seatList(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  return memberNames(room).filter((name) => hostPlays || name !== room.host).slice(0, MAX_SEATS);
}
// 遊ぶ人の名前（いる人。対決の途中は、通信が切れている人のお店も数える）
function playerNames(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  const names = new Set(Object.keys(room?.players || {}).filter((name) => hostPlays || name !== room.host));
  const game = room?.status === STATUS.PLAY ? gameOf(room) : null;
  if (game) game.seats.forEach((name) => names.add(name));
  return names;
}
const playerCount = (room) => playerNames(room).size;
const FULL_MESSAGE = 'このルームはいっぱいだよ（遊べるのは' + MAX_SEATS + '人まで）。見るだけなら、トップの「みんなにみせる画面をひらく」から見てね';

// 対決を読む。こわれた値は読み飛ばす（null）
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const seats = asList(g.seats);
  const n = seats.length;
  if (n < MIN_SEATS || n > MAX_SEATS || !seats.every((x) => typeof x === 'string' && x) || new Set(seats).size !== n) return null;
  const id = Number(g.id) || 0;
  const raw = room.play?.[id];
  const S = E.fromRoom(raw, n);
  if (!S) return null;
  const uids = asList(g.uids);
  const r = raw.r && typeof raw.r === 'object' ? raw.r : {};
  const hints = typeof r.h === 'string' && r.h ? r.h.split(',').filter(E.isTag).slice(0, E.HINTS) : [];
  const d = {};
  Object.entries(r.d && typeof r.d === 'object' ? r.d : {}).forEach(([k, v]) => {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n || i === S.turn || typeof v !== 'string') return;
    if (v === '-') { d[i] = '-'; return; }
    // 出した品物（いまもそのお店にある物だけ。旧形式 "id:tag" は id だけ読む）
    const item = v.split(':')[0];
    if (S.players[i].hand.includes(item)) d[i] = { item };
  });
  const q = {};
  Object.entries(r.q && typeof r.q === 'object' ? r.q : {}).forEach(([k, v]) => {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n || typeof v !== 'string') return;
    q[i] = v.split(',').map((x) => x.split(':')).filter(([t]) => E.isTag(t)).slice(0, E.ASK_MAX).map(([t, y]) => ({ tag: t, yes: y === '1' }));
  });
  // おすすめ: 品物を出さなかったお店の人が、出された箱のどれかをすすめる { 席: 箱のお店の席 }
  const v = {};
  Object.entries(r.v && typeof r.v === 'object' ? r.v : {}).forEach(([k, val]) => {
    const i = Number(k);
    const to = Number(val);
    if (!Number.isInteger(i) || i < 0 || i >= n || i === S.turn) return;
    if (d[i] && d[i] !== '-') return;
    if (d[to] && d[to] !== '-') v[i] = to;
  });
  // コメント: 箱を出したお店の人が送った言葉の番号 { 席: 番号 }
  const m = {};
  Object.entries(r.m && typeof r.m === 'object' ? r.m : {}).forEach(([k, val]) => {
    const i = Number(k);
    if (d[i] && d[i] !== '-' && Number.isInteger(val) && val >= 0 && val < COMMENTS.length) m[i] = val;
  });
  const last = raw.last && typeof raw.last === 'object' && Number.isInteger(raw.last.n) ? raw.last : null;
  return {
    v,
    m,
    id,
    seats: seats.slice(),
    uids: seats.map((_, i) => (typeof uids[i] === 'string' ? uids[i] : '')),
    limit: TIMES.includes(g.limit) ? g.limit : 0,
    offerMs: (OFFERS.includes(g.offer) ? g.offer : DEFAULT_SET.offer) * 1000,
    askMs: (ASKS.includes(g.ask) ? g.ask : 0) * 1000,
    startAt: Number(g.startAt) || 0,
    endAt: Number(g.endAt) || 0,
    showAll: g.showAll === true,
    S,
    n: Number.isInteger(r.n) ? r.n : 0,
    hints,
    at: Number(r.at) || 0,
    askAt: Number(r.s) || 0,   // お客さんがヒントをえらびはじめる時刻（前の結果の札を出しおえるころ）
    d,
    q,
    last,
  };
}

/* ── 時間 ──
   のこり時間は、それぞれの端末が「はじめた時刻＋決めた時間」から出す（時間のための書き込みはしない）。
   ホストが切れている間は、切れた時刻で止める（戻ったときに、その分だけはじめた時刻をずらす） */
function roomNow(room) {
  const now = RoomkRTDB.now();
  if (room && room.hostConnected === false) return RoomkRTDB.getHostDisconnectedAt(room) ?? now;
  return now;
}
function timeLeft(room, game) {
  if (!game.limit || !game.startAt) return null;
  const end = game.startAt + game.limit * 60000;
  return end - (game.endAt ? Math.min(game.endAt, roomNow(room)) : roomNow(room));
}
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
// おわったか（品物がなくなった・ホストが「ここで終わる」・時間が0）
function isOver(room, game) {
  if (game.S.over || game.endAt) return true;
  const left = timeLeft(room, game);
  return left !== null && left <= 0;
}

// その席の人が、いまルームにいるか
function seatPresent(room, game, i) {
  const name = game.seats[i];
  const p = room?.players?.[name];
  return !!p && (!game.uids[i] || p.uid === game.uids[i]);
}
function awayMap(room, game) {
  const away = {};
  game.seats.forEach((_, i) => { if (!seatPresent(room, game, i)) away[i] = true; });
  return away;
}

// この端末の人の席の番号（自分の端末で遊んでいる人だけ。なければ -1）
function selfSeat(game) {
  if (state.role !== 'host' && state.role !== 'guest') return -1;
  const uid = currentUid();
  return game.seats.findIndex((name, i) => name === state.nickname && game.uids[i] === uid);
}
const isHostHere = (room) => state.role === 'host' && room.hostUid === currentUid();

// いまの場面: 'ask'（お客さんがヒントをえらぶ）・'offer'（お店の人が決める）・'pick'（お客さんが箱をえらぶ）・'end'
function phaseOf(room, game) {
  if (isOver(room, game)) return 'end';
  if (!game.hints.length) return 'ask';
  const shops = game.seats.map((_, i) => i).filter((i) => i !== game.S.turn && seatPresent(room, game, i));
  const all = shops.every((i) => game.d[i] != null);
  if (all || (game.offerMs && roomNow(room) >= game.at + game.offerMs)) return 'pick';
  return 'offer';
}
// お店の人が決める、のこり秒（時間をえらんでいないときは null）
const offerLeft = (room, game) => (game.offerMs ? Math.max(0, Math.ceil((game.at + game.offerMs - roomNow(room)) / 1000)) : null);
// お客さんがヒントを決める、のこり秒（時間をえらんでいないときは null。前の結果の札を出している間は数えない）
// お客さん本人の端末では、結果の札を「次へ」で閉じた時刻から数える（札を長く見ていても、ヒントを決める時間が減らない）
const askLeft = (room, game) => {
  if (!game.askMs || !game.askAt) return null;
  const closed = state.cardClosed && state.cardClosed.round === game.id + ':' + game.n && selfSeat(game) === game.S.turn ? state.cardClosed.at : 0;
  const from = Math.max(game.askAt, closed);
  return Math.max(0, Math.min(game.askMs / 1000, Math.ceil((from + game.askMs - roomNow(room)) / 1000)));
};

// 出された箱（お店の番号の順）
function offersOf(game) {
  return Object.keys(game.d).map(Number).sort((a, b) => a - b).filter((i) => game.d[i] !== '-').map((i) => ({ from: i, item: game.d[i].item }));
}
const shopName = (game, i) => game.seats[i] + 'のお店';

// 対決の途中は、遊んでいる人の名前を同じ人（匿名ID）だけが使える
function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAY) return false;
  return game.seats.some((x, i) => x === name && game.uids[i] && game.uids[i] !== uid);
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
    console.warn('[arekudasai-shoten] expired room cleanup failed', error);
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
function resetView() {
  ['town', 'stage', 'shelf', 'lobbyPeople'].forEach((id) => $(id).replaceChildren());
  Object.assign(state, { round: '', asking: false, offering: null, picks: [], comment: null, lastSeen: null, result: null, phaseKey: '', sending: false, setKey: null, endShown: '' });
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearInterval(state.clockTimer);
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
    clockTimer: null,
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
  resetView();
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
    console.warn('[arekudasai-shoten] room listener failed', error);
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
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClock, 500);
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
      // 手元の値で確かめてから、要る欄だけを書く（ルーム全体の transaction は、みんなが動いている間は通りにくい）
      const room = state.room;
      if (room.hostUid === uid && !isExpired(room) && !(room.hostConnected === true && room.hostDisconnectedAt == null)) {
        const back = { hostConnected: true, hostDisconnectedAt: null };
        // 切れていた間は時計を止めていたので、その分だけ、はじめた時刻とお店の人の決める時間をずらす
        const game = room.status === STATUS.PLAY ? gameOf(room) : null;
        const at = room.hostConnected === false ? RoomkRTDB.getHostDisconnectedAt(room) : null;
        if (game && at != null && !isOver(room, game)) {
          const gap = Math.max(0, RoomkRTDB.now() - at);
          if (game.limit && game.startAt) back['game/startAt'] = game.startAt + gap;
          if (game.at) back['play/' + game.id + '/r/at'] = game.at + gap;
          else if (game.askAt) back['play/' + game.id + '/r/s'] = game.askAt + gap;
        }
        await ref.update(back);
      }
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      let full = false;
      let taken = false;
      // ルームの様子は手元の値で確かめ、書くのは自分の在室だけ（ほかの人が入っていたら書かない）
      const room = state.room;
      if (!isExpired(room) && !room.players?.[nickname]) {
        const game = gameOf(room);
        const seated = room.status === STATUS.PLAY && game && game.seats.includes(nickname);
        if (nickname === room.host || reservedByOther(room, nickname, uid)) taken = true;
        // 戻るときは参加したときの順番のまま。対決の途中の、自分のお店がある人は人数の上限を見ない
        else if (!seated && playerCount(room) >= MAX_SEATS) full = true;
        else {
          const result = await ref.child('players/' + nickname).transaction((cur) => (cur ? undefined : { isHost: false, uid, joinedAt }));
          if (!result.committed && result.snapshot.val()?.uid !== uid) taken = true;
        }
      }
      if ((full || taken) && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(full ? FULL_MESSAGE : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
      }
    }
  } catch (error) {
    console.warn('[arekudasai-shoten] presence recovery failed', error);
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
          set: { ...DEFAULT_SET },
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
    console.warn('[arekudasai-shoten] create failed', err);
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
    // ルームの様子（名前・人数）は、いま読んだ値で確かめる。書くのは自分の在室だけ
    const fail = (message) => setError('joinError', message);
    const room = initial;
    const stale = room.players?.[nickname];
    // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
    const mine = !!stale && !stale.isHost && stale.uid === uid;
    if (nickname === room.host || (stale && !mine) || reservedByOther(room, nickname, uid)) {
      fail('その名前は使われているよ。少し変えてみてね');
      return;
    }
    const game = gameOf(room);
    const seated = room.status === STATUS.PLAY && game && game.seats.includes(nickname);
    if (!mine && !seated && playerCount(room) >= MAX_SEATS) {
      fail(FULL_MESSAGE);
      return;
    }
    const rejoinAt = mine ? Number(stale.joinedAt) || joinedAt : null;
    // 同じ名前の人が同時に入っていたら、先に書いた人のもの（同じ匿名IDなら、自分の入りなおし）
    const result = await transactRetry(ref.child('players/' + nickname), (cur) => (cur && cur.uid !== uid ? undefined : { isHost: false, uid, joinedAt: rejoinAt || joinedAt }));
    if (!result.committed) {
      fail('その名前は使われているよ。少し変えてみてね');
      return;
    }
    // 読んでから書くまでの間に、ホストがルームを閉じていたら、在室だけの残りを消してやめる
    const after = (await ref.get()).val();
    if (!after || !after.status) {
      await ref.child('players/' + nickname).remove();
      fail('このルームは終わったみたい');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[arekudasai-shoten] join failed', err);
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
  const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoWatch'];
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
      if (saved.nickname === room.host) return false;
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
    console.warn('[arekudasai-shoten] reconnect failed', error);
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
      // 自分の在室だけを消す（対決の途中のお店は残る。番が来たら、ホストが飛ばせる）。
      // ほかの匿名IDの人がその名前で在室しているときは触らない
      await ref.child('players/' + nickname).transaction((cur) => (cur && cur.uid === uid ? null : undefined));
    }
  } catch (error) {
    console.warn('[arekudasai-shoten] leave failed', error);
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
    console.warn('[arekudasai-shoten] watch failed', error);
    fail('接続できませんでした。もう一度ためしてね');
    return false;
  } finally {
    state.busy = false;
    $('btnWatchOpen').disabled = false;
  }
}

function connectWatch(code, ref) {
  state.role = 'spectator';
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClock, 500);
  // 共有するタブ・ウィンドウを選ぶときに見分けられるよう、題名と見出しを変える
  document.title = 'みんなにみせる画面 | あれください商店 | あそびのたな';
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
    console.warn('[arekudasai-shoten] watch listener failed', error);
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
  clearInterval(state.clockTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null, clockTimer: null });
  resetView();
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

/* ── ホストの操作（待合室の、ルーム全体への transaction。だれも遊んでいない間だけ） ── */
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
    console.warn('[arekudasai-shoten] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

// 設定は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない（中で今の値から作りなおす）
async function saveSet(change) {
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING) return;
    const cur = normSet(room.set);
    const next = normSet(change({ ...cur }));
    // ホストを遊ぶ人に入れるときは、12人をこえないか確かめる
    if (next.hostPlays && !cur.hostPlays && playerCount(room) >= MAX_SEATS) { reason = '遊べるのは' + MAX_SEATS + '人までだよ'; return; }
    return { ...room, set: next };
  }, '設定を変えられませんでした。もう一度ためしてね', false);
  if (ok === false && reason) toast(reason, false);
  if (!ok && state.room) {
    state.setKey = null;
    renderRoom(state.room);
  }
}

// 遊ぶ人たちで新しい対決を作る（人数がそろわなければ null）
function newGameFor(room, seats) {
  if (seats.length < MIN_SEATS || seats.length > MAX_SEATS || new Set(seats).size !== seats.length) return null;
  if (!seats.every((name) => seatable(room, name))) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const set = normSet(room.set);
  const play = E.toRoom(E.newGame(seats.length));
  play.r = { n: 1, s: RoomkRTDB.now() };
  return {
    game: { id, seats: seats.slice(), uids: seats.map((name) => room.players[name].uid), limit: set.time, showAll: set.showAll, offer: set.offer, ask: set.ask, startAt: RoomkRTDB.now() },
    play,
  };
}

async function startGame() {
  let n = 0;
  const ok = await hostTransaction((room) => {
    // 対決のデータがこわれて play のまま残ったときも、待合室の画面から始めなおせるようにする
    if (room.status !== STATUS.WAITING && !(room.status === STATUS.PLAY && !gameOf(room))) return;
    const made = newGameFor(room, seatList(room));
    if (!made) return;
    n = made.game.seats.length;
    return { ...room, status: STATUS.PLAY, lastGameId: made.game.id, game: made.game, play: { [made.game.id]: made.play } };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + n);
    const used = normSet(state.room?.set);
    window.RoomkStats?.count('time-' + (used.time || 'none'));
    window.RoomkStats?.count('offer-' + used.offer);
    window.RoomkStats?.count('ask-' + (used.ask || 'none'));
    if (used.showAll) window.RoomkStats?.count('show-all');
  } else if (ok === false) {
    toast('遊ぶ人が2人そろっていないよ。だれかが入るのを待つか、「ホストも遊ぶ」をオンにしてね');
  }
}

// もう一回: いま参加している人で遊ぶ人を決めなおす（途中から入った人が入り、いなくなった人は外れる）
async function againGame() {
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  const room = state.room;
  const cur = gameOf(room);
  if (!cur || room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  const seats = seatList(room);
  const made = newGameFor(room, seats);
  if (!made) {
    toast('遊ぶ人が2人そろっていないよ。「待合室へ」でだれかが入るのを待ってね');
    return;
  }
  const left = cur.seats.filter((name) => !seats.includes(name));
  state.busy = true;
  try {
    // ほかの人と取り合いにならない（対決を作りなおせるのはホストだけ）ので、要る欄だけをまとめて書く
    await state.roomRef.update({ lastGameId: made.game.id, game: made.game, play: { [made.game.id]: made.play } });
    window.RoomkStats?.count('again');
    window.RoomkStats?.count('players-' + seats.length);
    if (left.length) toast(left.join('・') + 'は、いないのでこの回には入っていないよ', false);
  } catch (error) {
    console.warn('[arekudasai-shoten] again failed', error);
    toast('はじめられませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

async function backToLobby() {
  const room = state.room;
  const game = gameOf(room);
  if (game && !isOver(room, game) && !window.confirm('この回をやめて、待合室にもどる？')) return;
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  if (room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  state.busy = true;
  try {
    await state.roomRef.update({ status: STATUS.WAITING, game: null, play: null });
  } catch (error) {
    console.warn('[arekudasai-shoten] back to lobby failed', error);
    toast('もどれませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

async function endNow() {
  const room = state.room;
  const game = gameOf(room);
  if (!game || state.role !== 'host' || !state.roomRef || isOver(room, game)) return;
  if (!window.confirm('ここで終わりにする？ おわりの画面に進むよ。')) return;
  try {
    await state.roomRef.child('game/endAt').set(serverTimestamp());
  } catch (error) {
    console.warn('[arekudasai-shoten] end failed', error);
    toast('終われませんでした。もう一度ためしてね');
  }
}

/* ── あそんでいる間の書き込み ── */
function writeFailed(error, message) {
  console.warn('[arekudasai-shoten] write failed', error);
  // 続けて失敗しても、知らせるのは5秒に1回まで
  if (Date.now() - state.sendFailAt > 5000) {
    state.sendFailAt = Date.now();
    toast(message || '送れなかったよ。通信を確かめてね');
  }
}
const playRef = (game) => state.roomRef.child('play/' + game.id);
// いまの対決と、操作できるか（ホストが切れている間は、だれも書かない）
function liveGame() {
  const room = state.room;
  if (!room || !state.roomRef || room.hostConnected === false || room.status !== STATUS.PLAY) return null;
  const game = gameOf(room);
  return game && !isOver(room, game) ? { room, game } : null;
}

// お客さん: ヒントを送る
// auto: 決める時間が来た（えらんだヒントで送る。1つもえらんでいなければ、ほしい物に合うヒントを1つ）
function sendHints(auto = false) {
  const live = liveGame();
  if (!live || state.sending) return;
  const { room, game } = live;
  if (selfSeat(game) !== game.S.turn || game.hints.length || phaseOf(room, game) !== 'ask') return;
  let picks = state.picks.filter(E.isTag).slice(0, E.HINTS);
  if (!picks.length && auto === true) {
    const tags = E.item(game.S.players[game.S.turn].order).tags;
    picks = [tags[Math.floor(Math.random() * tags.length)]];
  }
  if (!picks.length) return;
  state.sending = true;
  playRef(game).child('r').update({ h: picks.join(','), at: serverTimestamp() })
    .catch((error) => writeFailed(error))
    .finally(() => { state.sending = false; });
}

// お店の人: 品物を出す（id）か、出さない（'-'）
function decide(id) {
  const live = liveGame();
  if (!live) return;
  const { room, game } = live;
  const me = selfSeat(game);
  if (me < 0 || me === game.S.turn || game.d[me] != null || phaseOf(room, game) !== 'offer') return;
  if (id !== '-' && !game.S.players[me].hand.includes(id)) return;
  state.asking = false;
  state.offering = null;
  playRef(game).child('r/d/' + me).set(id).catch((error) => writeFailed(error));
}

// 品物を出さなかったお店の人: お客さんが箱をえらぶ前に、ぴったりだと思う箱をおすすめする（何度でも変えられる）
function recommend(from) {
  const live = liveGame();
  if (!live) return;
  const { room, game } = live;
  const me = selfSeat(game);
  if (me < 0 || me === game.S.turn || (game.d[me] && game.d[me] !== '-') || phaseOf(room, game) !== 'pick') return;
  if (!game.d[from] || game.d[from] === '-' || game.v[me] === from) return;
  playRef(game).child('r/v/' + me).set(from).catch((error) => writeFailed(error));
}

// 箱を出したお店の人: お客さんにコメントを送る（お客さんが箱をえらぶまで、送りなおせる）
function sendComment() {
  const live = liveGame();
  if (!live) return;
  const { room, game } = live;
  const me = selfSeat(game);
  const idx = state.comment;
  const phase = phaseOf(room, game);
  if (me < 0 || !game.d[me] || game.d[me] === '-' || (phase !== 'offer' && phase !== 'pick')) return;
  if (!Number.isInteger(idx) || idx < 0 || idx >= COMMENTS.length || game.m[me] === idx) return;
  playRef(game).child('r/m/' + me).set(idx).catch((error) => writeFailed(error));
}
// コメントをえらんで送る欄
function commentPanel(game, me) {
  const box = el('div', 'ak-comment');
  const sent = game.m[me];
  const pick = state.comment != null ? state.comment : sent;
  box.append(el('p', 'ak-choices__title', sent != null ? '「' + COMMENTS[sent] + '」と送ったよ' : 'お客さんにコメントを送ろう'));
  const chipsBox = el('div', 'ak-chips');
  COMMENTS.forEach((text, i) => {
    const b = btn('ak-chip-btn', text, () => { state.comment = i; renderGame(); });
    b.setAttribute('aria-pressed', pick === i ? 'true' : 'false');
    chipsBox.append(b);
  });
  box.append(chipsBox);
  const go = btn('btn btn-primary', sent != null ? '送りなおす' : '送る', sendComment);
  go.disabled = state.comment == null || state.comment === sent;
  box.append(go);
  return box;
}

// お店の人: お客さんに質問する（答えは、お客さんのほしい物から、その場で決まる）
function askTag(tag) {
  const live = liveGame();
  if (!live) return;
  const { room, game } = live;
  const me = selfSeat(game);
  if (me < 0 || me === game.S.turn || game.d[me] != null || phaseOf(room, game) !== 'offer') return;
  const asked = game.q[me] || [];
  if (asked.length >= E.ASK_MAX || asked.some((a) => a.tag === tag) || game.hints.includes(tag) || !E.isTag(tag)) return;
  const next = asked.concat([{ tag, yes: E.answer(game.S, tag) }]);
  state.asking = false;
  playRef(game).child('r/q/' + me).set(next.map((a) => a.tag + ':' + (a.yes ? 1 : 0)).join(',')).catch((error) => writeFailed(error));
}

// 1回の番を決める。from: えらんだ箱のお店の番号。-1 は「べつの物にする」・この番を飛ばす
async function settle(from, skip = false) {
  const live = liveGame();
  if (!live || state.sending) return;
  const { room, game } = live;
  const me = selfSeat(game);
  const host = isHostHere(room);
  const n = game.n;
  if (skip ? !host : me !== game.S.turn) return;
  if (!skip && phaseOf(room, game) !== 'pick') return;
  if (skip && !window.confirm(game.seats[game.S.turn] + 'の番を飛ばして、次のお客さんにする？')) return;
  const away = awayMap(room, game);
  const voice = VOICES[Math.floor(Math.random() * VOICES.length)];
  state.sending = true;
  let res = null;
  try {
    const result = await playRef(game).transaction((cur) => {
      res = null;
      if (!cur || cur.r?.n !== n) return;   // もう決まっている（ほかの端末が先に決めた）
      const S = E.fromRoom(cur, game.seats.length);
      if (!S) return;
      // 出された物・質問の数は、いま届いている値から作りなおす
      const g = gameOf({ ...room, play: { [game.id]: cur }, game: room.game });
      if (!g) return;
      const offers = skip ? [] : offersOf(g);
      const chosen = skip ? -1 : offers.findIndex((o) => o.from === from);
      const asked = {};
      Object.entries(g.q).forEach(([k, v]) => { asked[k] = v.length; });
      // 「出さない」をえらんだお店（正しく断れたかは、ルールの側でお店の品物から決める）
      const declined = skip ? [] : Object.keys(g.d).map(Number).filter((i) => g.d[i] === '-');
      res = E.resolve(S, offers, chosen, g.hints, asked, Math.random, away, declined, skip ? {} : g.v);
      const out = E.toRoom(S);
      out.r = { n: n + 1, s: RoomkRTDB.now() + RESULT_MS };   // 結果の札を出しおえてから、ヒントを決める時間を数える
      out.last = {
        n, c: res.c, none: res.none, w: res.wanted || '-', h: g.hints.join(','), v: voice, skip: skip === true,
        // 席ごとに増えた（減った）ポイント "席:数,…"・正しく断れたお店 "席,…"
        dl: Object.entries(res.delta).map(([k, v]) => k + ':' + v).join(','), no: res.no.join(','), vt: res.vote.join(','),
        ...(res.none ? {} : { hit: res.hit, g: res.got, f: res.from, fit: res.fit.join(',') }),
      };
      return out;
    });
    if (result.committed && res) {
      if (skip) window.RoomkStats?.count('skip');
      else window.RoomkStats?.count(res.none ? 'none' : res.hit ? 'hit' : 'odd');
    }
  } catch (error) {
    writeFailed(error, '決められなかったよ。もう一度押してね');
  } finally {
    state.sending = false;
    if (state.room) renderRoom(state.room);
  }
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
  if (state.currentScreen !== next) showScreen(next);
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

function renderBar(room) {
  let me = '';
  if (state.role === 'host' || state.role === 'guest') {
    const game = room.status === STATUS.PLAY ? gameOf(room) : null;
    const seat = game ? selfSeat(game) : seatList(room).indexOf(state.nickname);
    me = (state.role === 'host' ? 'ホスト' : state.nickname)
      + (seat >= 0 ? '' : state.role === 'host' ? '・進行だけ' : game ? '・この回は見る番' : '');
  }
  $('barMe').hidden = !me;
  $('barMe').textContent = me;
}

function seg(box, options, value, onPick) {
  box.replaceChildren(...options.map(([v, label]) => {
    const b = btn('ak-seg__btn' + (v === value ? ' is-on' : ''), label, () => onPick(v));
    b.setAttribute('aria-pressed', v === value ? 'true' : 'false');
    return b;
  }));
}

function renderWaiting(room) {
  const host = state.role === 'host';
  const watch = state.role === 'spectator';
  const seats = seatList(room);
  const set = normSet(room.set);
  $('lobbyJoin').hidden = !watch;
  $('lobbyJoinCode').textContent = state.roomCode || '';

  // 遊ぶ人（参加している人みんな。参加した順に、お店の番号が決まる）
  const others = memberNames(room).filter((name) => !seats.includes(name));
  const ready = seats.length >= MIN_SEATS && seats.every((name) => seatable(room, name));
  const note = host && seats.length < MIN_SEATS ? '2人からはじめられるよ。だれかが入るのを待つか、「ホストも遊ぶ」をオンにしてね' : '';
  $('seatNote').textContent = note;
  $('seatNote').hidden = !note;
  const row = (name, si) => {
    const li = el('li', 'ak-person');
    if (si >= 0) li.append(face(si, 'ak-face--sm'));
    else li.append(icon('person'));
    li.append(el('span', 'ak-person__name', name));
    if (name === room.host) li.append(el('span', 'ak-chip ak-chip--muted', si >= 0 ? 'ホスト' : 'ホスト（進行だけ）'));
    if (name === state.nickname && !watch) li.append(el('span', 'ak-chip ak-chip--you', 'あなた'));
    return li;
  };
  $('lobbyPeople').replaceChildren(...seats.map((name, i) => row(name, i)), ...others.map((name) => row(name, -1)));
  $('peopleCount').textContent = seats.length + '人';
  $('hostPlaysBox').hidden = !host;
  if (host) $('hostPlays').checked = set.hostPlays;

  $('lobbySet').hidden = !host;
  $('lobbySetView').hidden = host;
  if (host) {
    const key = set.time + ':' + set.showAll + ':' + set.offer + ':' + set.ask;
    if (state.setKey !== key) {
      state.setKey = key;
      seg($('timeSeg'), TIMES.map((t) => [t, timeLabel(t)]), set.time, (v) => saveSet((s) => ({ ...s, time: v })));
      seg($('askSeg'), ASKS.map((t) => [t, askLabel(t)]), set.ask, (v) => saveSet((s) => ({ ...s, ask: v })));
      seg($('offerSeg'), OFFERS.map((t) => [t, offerLabel(t)]), set.offer, (v) => saveSet((s) => ({ ...s, offer: v })));
      $('showAll').checked = set.showAll;
    }
  } else {
    $('lobbySetView').textContent = settingSummary(set);
  }

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

/* ── 対決の画面 ── */
function renderGame() {
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game) return;
  const me = selfSeat(game);
  const host = isHostHere(room);
  const phase = phaseOf(room, game);
  const c = game.S.turn;
  const roundKey = game.id + ':' + game.n;
  if (state.round !== roundKey) {
    state.round = roundKey;
    state.asking = false;
    state.offering = null;
    state.picks = [];
    state.comment = null;
  }
  state.phaseKey = roundKey + ':' + phase;

  // 結果の札（新しい結果が届いたら出す。はじめて開いたときは、前の結果を出さない）
  const lastKey = game.last ? game.id + ':' + game.last.n : '';
  if (state.lastSeen === null || state.lastSeen.game !== game.id) state.lastSeen = { game: game.id, key: lastKey };
  else if (lastKey && lastKey !== state.lastSeen.key) {
    state.lastSeen.key = lastKey;
    const now = Date.now();
    state.result = { key: lastKey, openUntil: CALM.matches ? 0 : now + OPEN_MS };
  }
  if (state.result && state.result.key !== lastKey) state.result = null;

  // 上の帯: のこり時間・自分のポイント
  renderClock(room, game);
  $('myPointsBox').hidden = me < 0;
  if (me >= 0) $('myPoints').textContent = game.S.players[me].points;

  renderTown(room, game, phase);
  const stage = $('stage');
  stage.replaceChildren();
  stage.classList.toggle('is-end', phase === 'end');
  if (phase === 'end') renderEnd(room, game, me, host);
  else if (state.result) {
    renderResult(room, game, me);
    if (!(state.result.openUntil && Date.now() < state.result.openUntil)) resultNext(game, me, phase);
  }
  else if (phase === 'ask') renderAsk(room, game, me, host);
  else if (phase === 'offer') renderOffer(room, game, me);
  else renderPick(room, game, me, host);
  renderShelf(room, game, me, phase);

  // ホストのたまに使う操作
  $('hostMenu').hidden = !host || phase === 'end';
}

function renderClock(room, game) {
  const left = timeLeft(room, game);
  $('clock').hidden = left === null;
  $('timebar').hidden = left === null;
  if (left === null) return;
  $('clockText').textContent = mmss(left);
  $('timefill').style.width = Math.max(0, Math.min(100, left / (game.limit * 60000) * 100)) + '%';
  $('clock').classList.toggle('is-low', left <= 30000);
}

function renderTown(room, game, phase) {
  const c = game.S.turn;
  const me = selfSeat(game);
  const showAll = game.showAll;
  const town = $('town');
  town.classList.toggle('is-many', game.seats.length > 6);
  town.replaceChildren(...game.seats.map((name, i) => {
    const customer = i === c && phase !== 'end';
    const li = tint(el('li', 'ak-house' + (customer ? ' is-turn' : '') + (seatPresent(room, game, i) ? '' : ' is-away')), i);
    li.append(face(i));
    li.append(el('span', 'ak-house__name', customer ? name : name + 'のお店'));
    if (i === me) li.append(el('span', 'ak-house__you', 'あなた'));
    if (phase !== 'end') li.append(el('span', 'ak-house__role' + (customer ? ' is-ask' : ''), customer ? 'お客さん' : 'お店の人'));
    let sub = customer ? 'お店はお休み' : '品物 ' + game.S.players[i].hand.length + 'こ';
    if (!seatPresent(room, game, i)) sub = '通信が切れた';
    else if (!customer && phase === 'offer') sub = game.d[i] != null ? '決めた' : '考え中…';
    li.append(el('span', 'ak-house__sub', sub));
    if (showAll) li.append(el('span', 'ak-house__sub', game.S.players[i].points + 'ポイント'));
    return li;
  }));
}

function roleLine(kind) {
  const p = el('p', 'ak-role ak-role--' + kind);
  p.append(el('span', '', '今のあなた'), el('b', '', kind === 'ask' ? 'お客さん' : 'お店の人'));
  return p;
}
// 品物の特徴（3つ）。結果の札の答え合わせで出す
function tagRow(id, label) {
  const p = el('p', 'ak-answer');
  if (label) p.append(el('span', 'ak-answer__label', label));
  (E.item(id)?.tags || []).forEach((t) => p.append(tagLabel(el('span', 'ak-tag'), t)));
  return p;
}
function saidLine(hints) {
  const p = el('p', 'ak-said-row');
  hints.forEach((h) => p.append(tagLabel(el('span', 'ak-said'), h)));
  return p;
}
function chips(onClick, pressed, disabledFn, suffix) {
  const box = el('div', 'ak-chips');
  E.TAGS.forEach((t) => {
    const b = tagLabel(btn('ak-chip-btn', '', () => onClick(t)), t);
    if (suffix) b.append(document.createTextNode(suffix));
    if (pressed) b.setAttribute('aria-pressed', pressed.includes(t) ? 'true' : 'false');
    if (disabledFn && disabledFn(t)) b.disabled = true;
    box.append(b);
  });
  return box;
}
// 質問と答え（お店の人の質問は、みんなの画面に出る）
function askedList(game, only) {
  const ul = el('ul', 'ak-asked');
  Object.keys(game.q).map(Number).sort((a, b) => a - b).forEach((i) => {
    if (only != null && i !== only) return;
    game.q[i].forEach((a) => ul.append(el('li', '', shopName(game, i) + '「それは、' + a.tag + '？」→ ' + game.seats[game.S.turn] + '「' + (a.yes ? 'はい' : 'いいえ') + '」')));
  });
  return ul.children.length ? ul : null;
}

function askCount(left) {
  const p = el('p', 'ak-count', 'のこり ' + left + '秒');
  p.id = 'askCount';
  return p;
}
function renderAsk(room, game, me, host) {
  const st = $('stage');
  const c = game.S.turn;
  if (me === c) {
    const want = game.S.players[c].order;
    st.append(roleLine('ask'), el('h2', '', 'あなたのほしい物'));
    st.append(art('ak-art ak-art--mid ak-art--live', A.item(want)), el('p', 'ak-order', E.item(want).name));
    st.append(el('p', 'ak-small', '商店街の、どこかのお店にある。'));
    st.append(el('p', '', '名前を思い出せない。絵をよく見て、ヒントを' + E.HINTS + 'つえらんで、お店の人たちに聞こう。'));
    const left = askLeft(room, game);
    if (left !== null) st.append(askCount(left), el('p', 'ak-small', '時間が来たら、えらんだヒントで送るよ。'));
    st.append(chips((t) => {
      const i = state.picks.indexOf(t);
      if (i >= 0) state.picks.splice(i, 1);
      else if (state.picks.length < E.HINTS) state.picks.push(t);
      renderGame();
    }, state.picks, (t) => state.picks.length >= E.HINTS && !state.picks.includes(t)));
    const go = btn('btn btn-primary btn-lg', 'これください！', () => sendHints());
    go.disabled = state.picks.length === 0 || state.sending;
    st.append(go);
    return;
  }
  st.append(face(c, 'ak-face--big'), el('h2', '', 'お客さんの' + game.seats[c] + 'が、ヒントをえらんでいるよ'));
  const left = askLeft(room, game);
  if (left !== null) st.append(askCount(left));
  st.append(el('p', 'ak-small', me >= 0 ? 'ヒントが届いたら、あなたのお店から「これかな？」と思う物を出そう。' : 'ヒントが届くのを待っているよ。'));
  if (host && !seatPresent(room, game, c)) {
    st.append(el('p', 'ak-alert', game.seats[c] + 'の通信が切れているよ。'), btn('btn btn-secondary', 'この番を飛ばす', () => settle(-1, true)));
  }
}

function renderOffer(room, game, me) {
  const st = $('stage');
  const c = game.S.turn;
  const left = offerLeft(room, game);
  const shops = game.seats.map((_, i) => i).filter((i) => i !== c && seatPresent(room, game, i));
  const done = shops.filter((i) => game.d[i] != null).length;
  const countdown = el('p', 'ak-count', left === null ? 'みんな決めるまで待つよ' : 'のこり ' + left + '秒');
  countdown.id = 'offerCount';

  if (me === c || me < 0) {
    if (me === c) st.append(roleLine('ask'));
    st.append(el('h2', '', me === c ? 'お店の人が考えているよ' : 'お客さんの' + game.seats[c] + 'がほしい物'), saidLine(game.hints));
    st.append(countdown, el('p', 'ak-small', '決めたお店 ' + done + ' / ' + shops.length));
    const q = askedList(game);
    if (q) st.append(q);
    return;
  }

  st.append(roleLine('give'), el('h2', '', 'お客さんの' + game.seats[c] + 'がほしい物'), saidLine(game.hints));
  const mine = askedList(game, me);
  if (mine) st.append(mine);
  st.append(countdown);
  const decided = game.d[me];
  if (decided != null) {
    if (decided === '-') {
      st.append(el('p', 'ak-done', '出さないことにした。ほかのお店を待っているよ。'));
      return;
    }
    // 出したことが、ひと目でわかるように
    const sent = el('div', 'ak-sent');
    sent.append(art('ak-art ak-art--card', A.box()), art('ak-art ak-art--card', A.item(decided.item)));
    const txt = el('div', 'ak-sent__text');
    txt.append(el('b', '', '「' + E.item(decided.item).name + '」を箱に入れて出したよ'), el('span', '', 'ほかのお店を待っているよ。'));
    sent.append(txt);
    st.append(sent, commentPanel(game, me));
    return;
  }
  if (state.asking) {
    st.append(el('p', '', 'お客さんに、何を質問する？ 「はい」か「いいえ」で答えてくれる。'));
    const used = game.hints.concat((game.q[me] || []).map((a) => a.tag));
    st.append(chips(askTag, null, (t) => used.includes(t), '？'));
    st.append(btn('btn btn-secondary', '質問をやめる', () => { state.asking = false; renderGame(); }));
    return;
  }
  if (state.offering) {
    const it = E.item(state.offering);
    const pick1 = el('div', 'ak-sent ak-sent--ask');
    pick1.append(art('ak-art ak-art--card', A.item(state.offering)));
    const txt = el('div', 'ak-sent__text');
    txt.append(el('b', '', '「' + (it ? it.name : '') + '」を出す？'), el('span', '', 'ちがう物がえらばれると1ポイント減るよ。'));
    pick1.append(txt);
    st.append(pick1);
    const row = el('div', 'ak-row');
    row.append(btn('btn btn-primary btn-lg', 'この品物を出す', () => decide(state.offering)), btn('btn btn-secondary', 'えらびなおす', () => { state.offering = null; renderGame(); }));
    st.append(row);
    return;
  }
  if (!game.S.players[me].hand.length) {
    st.append(el('p', '', 'あなたのお店は空なので、今回は見ていよう。'), btn('btn btn-primary btn-lg', 'つぎへ', () => decide('-')));
    return;
  }
  // できることを3つ、することと言葉をそえて並べる
  st.append(el('p', 'ak-choices__title', 'どうする？'));
  const row = el('div', 'ak-choices');
  const give = el('div', 'ak-choice ak-choice--point');
  give.append(el('b', '', '品物を出す'), el('span', '', '「これかな？」と思う物を、下の「あなたのお店」から押して、「この品物を出す」で決める。ちがう物がえらばれると1ポイント減る'));
  row.append(give);
  const rest = E.ASK_MAX - (game.q[me] || []).length;
  const ask = btn('ak-choice', '', () => { state.asking = true; renderGame(); });
  ask.append(el('b', '', 'お客さんに質問する'), el('span', '', rest > 0 ? 'まよったとき。「それは、まるい？」のように聞ける（あと' + rest + '回）' : 'もう' + E.ASK_MAX + '回質問した'));
  ask.disabled = rest <= 0;
  row.append(ask);
  const no = btn('ak-choice', '', () => decide('-'));
  no.append(el('b', '', '出さない'), el('span', '', '合う物がないとき。「うちにはないです、ごめんね」と伝える。本当になくて、ぴったりが届いたら1ポイント'));
  row.append(no);
  st.append(row);
}

function renderPick(room, game, me, host) {
  const st = $('stage');
  const c = game.S.turn;
  const offers = offersOf(game);
  const mineTurn = me === c;
  if (mineTurn) st.append(roleLine('ask'));
  st.append(el('h2', '', mineTurn ? 'どの箱を受け取る？' : 'お客さんの' + game.seats[c] + 'が、箱をえらんでいるよ'), saidLine(game.hints));
  // 品物を出さなかったお店の人は、ぴったりだと思う箱をおすすめできる
  const canVote = me >= 0 && !mineTurn && !(game.d[me] && game.d[me] !== '-') && offers.length > 0;
  const count = {};
  Object.values(game.v).forEach((to) => { count[to] = (count[to] || 0) + 1; });
  // 品物を出したお店の人には、出したことをもう一度出す
  const mineBox = me >= 0 && game.d[me] && game.d[me] !== '-' ? game.d[me] : null;
  if (offers.length) {
    if (mineTurn) st.append(el('p', 'ak-small', 'おすすめを見てからえらぼう。えらぶのは、あなた。'));
    if (canVote) st.append(el('p', 'ak-choices__title', 'ぴったりだと思う箱を、お客さんにおすすめしよう（当たったら' + E.PT_VOTE + 'ポイント）'));
    if (mineBox) {
      const it = E.item(mineBox.item);
      st.append(el('p', 'ak-small', '「' + (it ? it.name : '') + '」を箱に入れて出したよ。お客さんがえらぶのを待とう'), commentPanel(game, me));
    }
    const box = el('div', 'ak-offers');
    offers.forEach((o) => {
      let card;
      if (mineTurn) card = btn('ak-offer', '', () => settle(o.from));
      else if (canVote) card = btn('ak-offer ak-offer--vote', '', () => recommend(o.from));
      else card = el('div', 'ak-offer');
      if (mineTurn && state.sending) card.disabled = true;
      if (canVote) card.setAttribute('aria-pressed', game.v[me] === o.from ? 'true' : 'false');
      card.append(art('ak-offer__box', A.box()), el('b', '', o.from === me ? 'あなたの箱' : shopName(game, o.from)));
      if (game.m[o.from] != null) card.append(el('span', 'ak-boxcomment', '「' + COMMENTS[game.m[o.from]] + '」'));
      card.append(el('span', 'ak-votes' + (count[o.from] ? '' : ' is-zero'), 'おすすめ ' + (count[o.from] || 0)));
      if (canVote && game.v[me] === o.from) card.append(el('span', 'ak-myvote', 'あなたのおすすめ'));
      box.append(card);
    });
    st.append(box);
  } else {
    st.append(el('p', '', 'どのお店にも、それらしい物がないみたい。'));
    if (mineTurn) {
      const b = btn('btn btn-secondary', 'べつの物にする', () => settle(-1));
      b.disabled = state.sending;
      st.append(b);
    }
  }
  const no = Object.keys(game.d).map(Number).filter((i) => game.d[i] === '-').sort((a, b) => a - b);
  if (no.length) st.append(el('p', 'ak-refuse', no.map((i) => shopName(game, i)).join('・') + '「うちにはないです、ごめんね」'));
  const q = askedList(game);
  if (q) st.append(q);
  if (host && !mineTurn && !seatPresent(room, game, c)) {
    st.append(el('p', 'ak-alert', game.seats[c] + 'の通信が切れているよ。'), btn('btn btn-secondary', 'この番を飛ばす', () => settle(-1, true)));
  }
}

// 結果の札の「次へ」。札は自分で閉じるまで出しておく（ほかの人の画面とは関係なく、自分の画面だけ閉じる）
function resultNext(game, me, phase) {
  const st = $('stage');
  const c = game.S.turn;
  if (me === c && phase === 'ask') st.append(el('p', 'ak-small', 'つぎは、あなたがお客さん。'));
  else if (me >= 0 && me !== c && phase !== 'ask') st.append(el('p', 'ak-small', 'お客さんの' + game.seats[c] + 'から、ヒントが届いているよ。'));
  const row = el('div', 'ak-endbtns');
  row.append(btn('btn btn-primary btn-lg', '次へ', () => {
    state.result = null;
    state.cardClosed = { round: game.id + ':' + game.n, at: RoomkRTDB.now() };
    renderGame();
  }));
  st.append(row);
}

// 結果の札。お客さんのほしい物は、ここではじめてみんなの画面に出る
function renderResult(room, game, me) {
  const st = $('stage');
  const L = game.last;
  const rq = game.seats[L.c] || '';
  if (L.none) {
    st.append(el('h2', '', L.skip ? rq + 'の番を飛ばした' : 'だれも出さなかった'));
    st.append(el('p', '', rq + 'は、べつの物をさがすことにする。'));
    resultPoints(st, game, me, L);
    return;
  }
  const fr = game.seats[L.f] || '';
  if (state.result.openUntil && Date.now() < state.result.openUntil) {
    st.append(el('h2', '', fr + 'のお店の箱を開ける…'), art('ak-art ak-art--big ak-art--shake', A.box()));
    return;
  }
  const wanted = E.item(L.w);
  const got = E.item(L.g);
  if (!got) return;
  st.append(el('p', 'ak-result' + (L.hit ? ' ak-result--hit' : ''), L.hit ? 'ぴったり！' : 'あれ？ ちがう物！'));
  st.append(art('ak-art ak-art--big ak-art--live ak-art--pop', A.item(L.g)), el('p', 'ak-got', got.name));
  if (L.hit) {
    st.append(el('p', '', rq + 'のほしい物が、' + fr + 'のお店にあった。'));
    st.append(tagRow(L.g, '答え合わせ'));
  } else {
    st.append(el('p', '', rq + 'がほしかったのは「' + (wanted ? wanted.name : '') + '」。' + fr + 'のお店から出てきたのは、これ。'));
    if (typeof L.v === 'string') st.append(el('p', 'ak-voice', rq + L.v));
    st.append(tagRow(L.g, '出てきた物'));
    if (wanted) st.append(tagRow(L.w, 'ほしかった物'));
  }
  st.append(el('p', 'ak-small', L.hit ? 'お客さんの' + rq + 'と、お店の' + fr + 'に' + E.PT_HIT + 'ポイントずつ' : 'お客さんの' + rq + 'に' + E.PT_ODD + 'ポイント'));
  const fit = seatList_(game, L.fit);
  if (fit.length) st.append(el('p', 'ak-small', 'ヒントに合う物を出した ' + fit.map((i) => shopName(game, i)).join('・') + 'にも' + E.PT_FIT + 'ポイント'));
  resultPoints(st, game, me, L);
}
const seatList_ = (game, str) => (typeof str === 'string' && str ? str.split(',').map(Number).filter((i) => Number.isInteger(i) && game.seats[i]) : []);
// 正しく断れたお店（みんなに出す）と、自分のポイントの増減（自分の画面にだけ出す。減ったことは、ほかの人に出さない）
function resultPoints(st, game, me, L) {
  const no = seatList_(game, L.no);
  if (no.length) st.append(el('p', 'ak-small', '合う物がないと伝えた ' + no.map((i) => shopName(game, i)).join('・') + 'に' + E.PT_NO + 'ポイント'));
  const vt = seatList_(game, L.vt);
  if (vt.length) st.append(el('p', 'ak-small', 'ぴったりの箱をおすすめした ' + vt.map((i) => game.seats[i]).join('・') + 'に' + E.PT_VOTE + 'ポイント'));
  if (me < 0) return;
  let mine = 0;
  String(L.dl || '').split(',').forEach((x) => { const [k, v] = x.split(':'); if (Number(k) === me) mine = Number(v) || 0; });
  if (mine > 0) st.append(el('p', 'ak-gain', 'あなた +' + mine + 'ポイント'));
  else if (mine < 0) st.append(el('p', 'ak-loss', 'ちがう物がえらばれたので、あなたは ' + mine + 'ポイント'));
}

function renderShelf(room, game, me, phase) {
  const box = $('shelfBox');
  const show = me >= 0 && me !== game.S.turn && phase !== 'end';
  box.hidden = !show;
  if (!show) return;
  const offer = phase === 'offer' && !state.result;
  const can = offer && !state.asking && game.d[me] == null && seatPresent(room, game, me);
  box.className = 'ak-shelfbox ' + (offer ? 'is-give' : 'is-rest');
  const sent = game.d[me] && game.d[me] !== '-' ? game.d[me].item : null;
  $('shelfNote').textContent = can ? (state.offering ? '「この品物を出す」を押してね' : 'ここから1つえらぶ') : (sent ? '出した品物に印が付いているよ' : '');
  const shelf = $('shelf');
  // 札には絵と名前だけを出す（特徴の言葉は出さない。絵を見て考える）
  shelf.replaceChildren(...game.S.players[me].hand.map((id) => {
    const it = E.item(id);
    const card = can ? btn('ak-card', '', () => { state.offering = id; renderGame(); }) : el('div', 'ak-card');
    if (sent === id || (can && state.offering === id)) card.classList.add('is-sent');
    if (sent === id) card.append(el('span', 'ak-card__sent', '出した'));
    if (can) card.setAttribute('aria-pressed', state.offering === id ? 'true' : 'false');
    card.append(art('ak-art ak-art--card', A.item(id)), el('b', '', it.name));
    return card;
  }));
  if (!game.S.players[me].hand.length) shelf.append(el('p', 'ak-small', 'お店は空。'));
}

function renderEnd(room, game, me, host) {
  const st = $('stage');
  const S = game.S;
  st.append(el('h2', 'ak-endtitle', 'おしまい'));
  if (me >= 0) {
    const mine = S.players[me].points;
    st.append(el('p', 'ak-endlabel', 'あなたのポイント'), el('p', 'ak-endbig', mine));
    const key = game.id + ':' + me;
    if (state.endShown !== key) {
      state.endShown = key;
      state.endBest = state.best === null ? '' : (mine > state.best ? 'あなたのこれまでの一番 ' + state.best + 'ポイント をこえた！' : 'あなたのこれまでの一番は ' + state.best + 'ポイント。');
      state.best = state.best === null ? mine : Math.max(state.best, mine);
      if (host) window.RoomkStats?.count('finish');
    }
    if (state.endBest) st.append(el('p', 'ak-small', state.endBest));
  } else if (host && state.endShown !== game.id + ':h') {
    state.endShown = game.id + ':h';
    window.RoomkStats?.count('finish');
  }
  st.append(el('p', '', 'ぴったり ' + S.hits + 'こ・思いがけない物 ' + S.odds + 'こ がお客さんにわたった。'));
  const ul = el('ul', 'ak-titles');
  E.titles(S).forEach((t, i) => {
    const li = el('li');
    li.append(face(i, 'ak-face--sm'), el('span', '', game.seats[i] + ' … '), el('b', '', t.name), el('span', '', '（' + t.text + '）' + (game.showAll ? ' ' + S.players[i].points + 'ポイント' : '')));
    ul.append(li);
  });
  st.append(ul);
  if (host) {
    const row = el('div', 'ak-endbtns');
    row.append(btn('btn btn-primary btn-lg', 'もう一回', againGame), btn('btn btn-secondary', '待合室へ', backToLobby));
    st.append(row);
  } else {
    st.append(el('p', 'ak-small', 'ホストが、もう一回あそぶかを決めるよ。'));
  }
}

// 0.5秒ごと: 時計とのこり秒を出しなおし、時間で場面が変わったら（決める時間が終わった・あそぶ時間が0）画面ごと出しなおす
function tickClock() {
  if (state.currentScreen !== 'game' || !state.room) return;
  const room = state.room;
  const game = gameOf(room);
  if (!game) return;
  const phase = phaseOf(room, game);
  const key = game.id + ':' + game.n + ':' + phase;
  const resultDone = state.result && state.result.openUntil && Date.now() >= state.result.openUntil && !state.result.opened;
  if (state.result && state.result.openUntil && Date.now() >= state.result.openUntil) state.result.opened = true;
  if (key !== state.phaseKey || resultDone) {
    renderGame();
    return;
  }
  renderClock(room, game);
  const count = $('offerCount');
  const oLeft = offerLeft(room, game);
  if (count && phase === 'offer' && oLeft !== null) count.textContent = 'のこり ' + oLeft + '秒';
  if (phase === 'ask' && !state.result) {
    const left = askLeft(room, game);
    const ac = $('askCount');
    if (ac && left !== null) ac.textContent = 'のこり ' + left + '秒';
    // 決める時間が来たら、お客さんの端末が送る
    if (left === 0 && selfSeat(game) === game.S.turn && !state.sending) sendHints(true);
  }
}

// Enter で送る（日本語入力の変換の確定は除く）
function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    handler();
  });
}

/* ── ボタン ── */
$('btnGoCreate').addEventListener('click', () => { setError('createError', ''); showScreen('create'); $('hostName').focus({ preventScroll: true }); });
$('btnGoJoin').addEventListener('click', () => { setError('joinError', ''); $('joinLinkHint').hidden = true; showScreen('join'); $('guestName').focus({ preventScroll: true }); });
$('btnGoWatch').addEventListener('click', () => { setError('watchError', ''); showScreen('watch-join'); $('watchCode').focus({ preventScroll: true }); });
['btnCreateBack', 'btnJoinBack', 'btnWatchBack', 'btnWatchEndTop'].forEach((id) => $(id).addEventListener('click', () => showScreen('top')));
$('btnCreateRoom').addEventListener('click', createRoom);
submitOnEnter($('hostName'), createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
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

$('hostPlays').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, hostPlays: on })); });
$('showAll').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, showAll: on })); });
$('btnStartGame').addEventListener('click', startGame);
$('btnSkip').addEventListener('click', () => settle(-1, true));
$('btnEndNow').addEventListener('click', endNow);
$('btnLobby').addEventListener('click', backToLobby);

// 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう（コード欄は直せるように残す）
function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}

// 再読み込みなどで、保存した記録から同じルームへ戻る
function resumeFromSession() {
  if (!loadSession()) return;
  tryReconnect().then((reconnected) => {
    if (!reconnected && !state.roomRef) clearSession();
  });
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
