/* のりあいロード
   ・ルーム: Realtime Database。遊ぶ2〜10人がそれぞれの端末で自分のキャラを動かし、全員がゴールのとびらに入るとクリア
   ・1台のパソコンで遊ぶ: 通信しない。1つのキーボードで人数ぶんを動かす
   ルール（ステージ・動き）は engine.js。音は鳴らさない。

   遅れに強くするための作り:
   ・自分のキャラは自分の端末で動かし、位置を live/{対決の番号}/p/{番号} に書く（変わったときだけ・1秒に10回まで）
   ・箱・動く床・とびら・カギ・ボールはホストの端末だけが動かし、live/{対決の番号}/w に書く（変わったときだけ・1秒に10回まで）
   ・ほかの人・ホストの書いたものは、届いた時刻から少し前に合わせて、なめらかにつないで描く
   ・人の上に乗っているときは「だれの上の、どこか」を書き、受けた側は下の人の描く位置に乗せる（遅れても下の人とずれない）
   ・投げる操作は live/{対決の番号}/ev に送り、ホストが投げる（ホストが受けとったら消す） */
const E = window.NoriaiEngine;

const MIN_SEATS = E.MIN_PLAYERS;
const MAX_SEATS = E.MAX_PLAYERS;
const STAGE_COUNT = E.STAGES.length;
const DEFAULT_SET = { stage: 0, hostPlays: true, timer: false };
// ひとこと: 決まった言葉をえらんで、みんなに知らせる（声を出さなくても伝えられる）。自由に打つ欄は置かない。
// 言葉を足す・変えるときは、オーナーが決める（docs/development/ui.md「マイクを使わない子が参加できる手段」）
const SAYS = ['待って', '行くよ', '乗って', '押して', 'ありがとう', 'いいね'];
const SAY_EVERY_MS = 5000;   // ひとり5秒に1回まで
const SAY_SHOW_MS = 4000;    // 吹き出しを出しておく長さ
// 位置・ワールドを書く間かく。人数が多いほど受けとる量がふえるので、間をあける
// （4人まで 1秒に10回・7人まで 約7回・10人まで 5回）
const sendMsFor = (n) => (n <= 4 ? 100 : n <= 7 ? 150 : 200);
let SEND_MS = 100;
let INTERP_MS = 140;         // ほかの人の位置を、どれだけ前の時刻に合わせて描くか（書く間かくの1.4倍）
const DT = 1 / 60;
const SEAT_COLORS = ['#E4572E', '#2E86DE', '#3B9B55', '#9B59B6', '#E39A1C', '#17A3A3', '#D9578E', '#8D6E4F', '#7F9A1E', '#5C6BC0'];
const SEAT_DARK = ['#A63A17', '#1D5F9E', '#276B3A', '#6C3A82', '#9A6408', '#0E6E6E', '#9C2F5E', '#5B4430', '#566A10', '#36438F'];
const LINK_COLORS = { A: '#C9A227', B: '#2B9C96', C: '#D0609A', D: '#6D7F8E', E: '#B5651D', F: '#5A8F29', G: '#C74B4B', H: '#4B6EC7' };
const LINK_SHAPES = { A: 'circle', B: 'triangle', C: 'square', D: 'diamond', E: 'star', F: 'circle', G: 'triangle', H: 'square' };
const STAGE_NOTE = [
  '人の頭に乗る・スイッチ・番号のかべ・カギ。はじめてなら、ここから。',
  '人数で押す重い箱、人数で動くリフトと床。',
  'シーソーと、投げてわたすボール。',
  'となりの番号の人と、ひもでつながる（5人からは組に分かれる）。',
  'これまでのしかけが全部出てくる。',
  '人の塔で上がる3マスの台と、箱の足場。',
  'ばねで、広い穴と高いかべをこえる。',
  '同時におさえるスイッチと、番号のスイッチ。',
  'ひもでつながったまま、高い台に上がる。',
  'ステージ6〜9のしかけが全部出てくる。',
  'ひもでつながったまま、長い道を進む。むずかしい。',
  'ほとんど全部のしかけが出てくる、いちばんむずかしい道。',
  'みんなで乗ると開くしかけブロックと、持ち運べるばね。',
  '決まった人数までしか乗れない細い橋。順番にわたる。',
];
// 1台のパソコンで遊ぶときのキー（1〜4番）
const KEYSETS = [
  { l: 'ArrowLeft', r: 'ArrowRight', j: 'ArrowUp', a: 'ArrowDown' },
  { l: 'KeyA', r: 'KeyD', j: 'KeyW', a: 'KeyS' },
  { l: 'KeyJ', r: 'KeyL', j: 'KeyI', a: 'KeyK' },
  { l: 'KeyF', r: 'KeyH', j: 'KeyT', a: 'KeyG' },
];
// ルームで自分のキャラを動かすキー
const SOLO_KEYS = { l: ['ArrowLeft', 'KeyA'], r: ['ArrowRight', 'KeyD'], j: ['ArrowUp', 'KeyW', 'Space'], a: ['ArrowDown', 'KeyS'] };
const PC_MQ = window.matchMedia('(hover: hover) and (pointer: fine)');

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'noriairoad_rooms';
const SESSION_KEY = 'noriairoad_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play' };

const state = {
  role: null,          // 'host' | 'guest'
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
  metaSig: '',
  // ステージ（端末の中だけで持つ）
  mode: null,          // 'room' | 'local'
  world: null,
  gameId: null,
  seat: 0,             // 自分のキャラの番号（1〜4）。見る番・進行だけは 0
  remote: {},          // 番号 → { buf: [{t, x, y, ...}], key }
  objBuf: [],          // ホストの書いたワールドの位置 [{t, b, p, i}]
  worldKey: '',
  evSeen: new Set(),
  lastSent: '',
  lastSentAt: 0,
  lastWorld: '',
  lastWorldAt: 0,
  finished: false,
  says: {},            // 番号 → { text, until }
  saySeen: {},
  sayAt: 0,
  sayCount: 0,
  stepFailAt: 0,
  // 入力
  keys: new Set(),
  latch: [{}, {}, {}, {}],
  pad: { l: false, r: false, j: false, a: false },
  padLatch: {},
  pick: 1,             // 1台のとき、画面のボタンで動かす人
  camX: 0,
  running: false,
  acc: 0,
  last: 0,
  clearShown: null,
  hintOpen: false,
  local: { stage: 0, n: 2, timer: false, timerRun: false, t0: 0, clearMs: null, best: {}, prevBest: null },
  frozenMs: null,      // タイムアタック: クリアが見えた時点の時間（ホストの書いた時間が届くまで）
  timeText: null,
  clearSent: null,
  prevBest: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  const act = document.activeElement;
  if (act && act !== document.body && !act.closest('#screen-' + id)) act.blur();
  document.querySelectorAll('.nr-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  const inRoom = (id === 'waiting' || id === 'game') && state.mode !== 'local';
  $('appBar').hidden = !inRoom;
  $('roomBar').hidden = !inRoom || !state.roomRef;
  window.scrollTo(0, 0);
  if (id === 'game') requestAnimationFrame(resize);
}

function setError(id, message) {
  const node = $(id);
  node.textContent = message || '';
  node.hidden = !message;
}
const toast = (message, error = true) => RoomkRTDB.showToast(message, error);

function validNickname(value) {
  if (!value) return '名前を入れてね';
  if (value.length > 8) return '名前は8文字までだよ';
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '名前に、記号 . # $ [ ] / は使えないよ';
  return '';
}
const currentUid = () => firebase.auth().currentUser?.uid || null;
const serverTimestamp = () => firebase.database.ServerValue.TIMESTAMP;

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}
function icon(name) {
  const node = el('span', 'material-symbols-rounded', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}
function numBadge(seat) {
  const node = el('span', 'nr-num', seat);
  node.style.setProperty('--c', SEAT_COLORS[(seat - 1) % SEAT_COLORS.length]);
  return node;
}
function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}
function seg(box, options, value, onPick) {
  box.replaceChildren(...options.map(([v, label, sub]) => {
    const b = el('button', 'nr-seg__btn' + (v === value ? ' is-on' : ''), label);
    if (sub) b.append(el('small', '', sub));
    b.type = 'button';
    b.setAttribute('aria-pressed', v === value ? 'true' : 'false');
    b.addEventListener('click', () => onPick(v));
    return b;
  }));
}
const stageLabel = (k) => (k + 1) + '. ' + E.STAGES[k].name;

/* ── 設定・ルームの読み取り ── */
function normSet(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    stage: Number.isInteger(s.stage) && s.stage >= 0 && s.stage < STAGE_COUNT ? s.stage : DEFAULT_SET.stage,
    hostPlays: typeof s.hostPlays === 'boolean' ? s.hostPlays : DEFAULT_SET.hostPlays,
    timer: typeof s.timer === 'boolean' ? s.timer : DEFAULT_SET.timer,
  };
}
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}
const memberNames = (room) => byJoined(Object.entries(room?.players || {}));
const seatable = (room, name) => typeof room?.players?.[name]?.uid === 'string' && !!room.players[name].uid;
// 遊ぶ人（参加した順に番号が決まる）。ホストは「ホストも遊ぶ」のときだけ
function seatList(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  return memberNames(room).filter((name) => hostPlays || name !== room.host).slice(0, MAX_SEATS);
}
// 遊ぶ人に数える人（ステージの途中は、通信が切れている人もふくむ）
function playerNames(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  const names = new Set(Object.keys(room?.players || {}).filter((name) => hostPlays || name !== room.host));
  const game = room?.status === STATUS.PLAY ? gameOf(room) : null;
  if (game) game.seats.forEach((name) => names.add(name));
  return names;
}
const playerCount = (room) => playerNames(room).size;
const FULL_MESSAGE = 'このルームはいっぱいだよ（遊べるのは' + MAX_SEATS + '人まで）';

// ステージの決まりを読む。こわれた値は null
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const seats = asList(g.seats);
  const n = seats.length;
  if (n < MIN_SEATS || n > MAX_SEATS || !seats.every((x) => typeof x === 'string' && x)) return null;
  const stage = Number(g.stage);
  if (!Number.isInteger(stage) || stage < 0 || stage >= STAGE_COUNT) return null;
  const uids = asList(g.uids);
  const ms = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null && v !== '' ? Number(v) : null);
  return {
    id: Number(g.id) || 0, seats: seats.slice(), uids: seats.map((_, i) => (typeof uids[i] === 'string' ? uids[i] : '')), stage, n,
    // タイムアタック: はじめた時刻（サーバーの時刻）と、クリアまでの時間（ホストが1回だけ書く）
    timer: g.timer === true, startedAt: ms(g.startedAt), clearMs: ms(g.clearMs),
  };
}
// このルームで、ステージごとのいちばん速いタイム（ルームを閉じると消える）
function bestOf(room, stage) {
  const v = Number(room?.best?.[stage]);
  return Number.isFinite(v) && v > 0 ? v : null;
}
function selfSeat(game) {
  if (state.role !== 'host' && state.role !== 'guest') return 0;
  const uid = currentUid();
  return game.seats.findIndex((name, i) => name === state.nickname && game.uids[i] === uid) + 1;
}
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
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[noriai-road] expired room cleanup failed', error);
  }
}
function warmRoomCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => resolve({ snap, release: () => ref.off('value', callback) });
    ref.on('value', callback, reject);
  });
}
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
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: state.role, nickname: state.nickname, roomCode: state.roomCode, uid: currentUid(), joinedAt: state.joinedAt }));
  } catch { /* 保存できないときは、読み込み直しで戻れないだけ */ }
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}
function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 何もしない */ }
}

/* ── ルームへの出入り ── */
function resetGame() {
  Object.assign(state, {
    world: null, gameId: null, seat: 0, remote: {}, objBuf: [], worldKey: '', evSeen: new Set(),
    lastSent: '', lastSentAt: 0, lastWorld: '', lastWorldAt: 0, finished: false, says: {}, saySeen: {}, clearShown: null,
    frozenMs: null, timeText: null, clearSent: null, prevBest: null,
  });
  $('timeLine').hidden = true;
  $('clearTime').hidden = true;
  $('clearBox').hidden = true;
  $('sayPanel').hidden = true;
  $('btnSay').setAttribute('aria-expanded', 'false');
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef && (state.role === 'host' || state.role === 'guest')) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  Object.assign(state, {
    role: null, nickname: null, roomCode: null, roomRef: null, room: null, joinedAt: null, timerInterval: null,
    orphanTimer: null, orphanAt: null, connectedRef: null, connectedCallback: null, roomCallback: null,
    isConnected: false, presenceDirty: false, presenceAt: 0, leaving: false, metaSig: '', mode: null,
  });
  clearSession();
  resetGame();
  $('hostOffOverlay').hidden = true;
  $('barMe').hidden = true;
  $('barMe').textContent = '';
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('top');
  if (message) toast(message, isError);
}

function connectToRoom(role, nickname, code, ref, joinedAt) {
  if (state.roomRef) cleanupRoom();
  stopLocal();
  state.mode = 'room';
  state.role = role;
  state.nickname = nickname;
  state.roomCode = code;
  state.roomRef = ref;
  state.joinedAt = Number(joinedAt) || RoomkRTDB.now();
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  saveSession();
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  state.roomCallback = (snap) => {
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
    console.warn('[noriai-road] room listener failed', error);
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
  startLoop();
}

function tickRoom() {
  if (state.room && needsPresence(state.room)) ensurePresence();
}
function needsPresence(room) {
  if (state.role === 'host') return room.hostConnected === false;
  if (state.role === 'guest') return !room.players?.[state.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる
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
      await ref.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: serverTimestamp() });
      // 手元の値で確かめてから、2つの欄だけを書く（ルーム全体の transaction は、みんなが動いている間は通りにくい）
      const room = state.room;
      if (room.hostUid === uid && !isExpired(room) && !(room.hostConnected === true && room.hostDisconnectedAt == null)) {
        await ref.update({ hostConnected: true, hostDisconnectedAt: null });
      }
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      let full = false;
      let taken = false;
      const room = state.room;
      if (!isExpired(room) && !room.players?.[nickname]) {
        const game = gameOf(room);
        const seated = room.status === STATUS.PLAY && game && game.seats.includes(nickname);
        if (nickname === room.host || reservedByOther(room, nickname, uid)) taken = true;
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
    console.warn('[noriai-road] presence recovery failed', error);
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
          players: { [nickname]: { isHost: true, uid, joinedAt } },
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
    console.warn('[noriai-road] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

function normalizeRoomCode(raw) {
  return String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}
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
    const room = warm.snap.val();
    if (!room) {
      setError('joinError', 'ルームが見つからないよ。コードを確かめてね');
      return;
    }
    if (isExpired(room)) {
      await removeExpired(ref, room);
      setError('joinError', 'このルームは終わったみたい');
      return;
    }
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    const fail = (message) => setError('joinError', message);
    const stale = room.players?.[nickname];
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
    // ルームの様子は、いま読んだ値で確かめる。書くのは自分の在室だけ
    const result = await transactRetry(ref.child('players/' + nickname), (cur) => (cur && cur.uid !== uid ? undefined : { isHost: false, uid, joinedAt: rejoinAt || joinedAt }));
    if (!result.committed) {
      fail('その名前は使われているよ。少し変えてみてね');
      return;
    }
    const after = (await ref.get()).val();
    if (!after || !after.status) {
      await ref.child('players/' + nickname).remove();
      fail('このルームは終わったみたい');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[noriai-road] join failed', err);
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
  state.busy = true;
  const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoLocal'];
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
    console.warn('[noriai-road] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    tops.forEach((id) => { $(id).disabled = false; });
  }
}

async function leaveRoom() {
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
    if (role === 'host') await ref.remove();
    else await ref.child('players/' + nickname).transaction((cur) => (cur && cur.uid === uid ? null : undefined));
  } catch (error) {
    console.warn('[noriai-road] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.leaving = false;
    state.busy = false;
    ensurePresence(true);
    if (state.room) handleRoom(state.room);
    return;
  }
  state.busy = false;
  leaveLocally('');
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
    console.warn('[noriai-road] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

async function saveSet(change) {
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING) return;
    const cur = normSet(room.set);
    const next = normSet(change({ ...cur }));
    if (next.hostPlays && !cur.hostPlays && playerCount(room) >= MAX_SEATS) { reason = '遊べるのは' + MAX_SEATS + '人までだよ'; return; }
    return { ...room, set: next };
  }, '設定を変えられませんでした。もう一度ためしてね', false);
  if (ok === false && reason) toast(reason, false);
  if (!ok && state.room) { state.metaSig = ''; handleRoom(state.room); }
}

// 遊ぶ人たちで新しいステージを作る（人数がそろわなければ null）
function newGameFor(room, seats, stage) {
  if (seats.length < MIN_SEATS || seats.length > MAX_SEATS || new Set(seats).size !== seats.length) return null;
  if (!seats.every((name) => seatable(room, name))) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const made = { id, seats: seats.slice(), uids: seats.map((name) => room.players[name].uid), stage, n: seats.length };
  if (normSet(room.set).timer) Object.assign(made, { timer: true, startedAt: serverTimestamp() });
  return made;
}

async function startGame() {
  let made = null;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING && !(room.status === STATUS.PLAY && !gameOf(room))) return;
    const set = normSet(room.set);
    made = newGameFor(room, seatList(room), set.stage);
    if (!made) return;
    return { ...room, status: STATUS.PLAY, lastGameId: made.id, game: made, live: null };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok && made) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + made.n);
    window.RoomkStats?.count('stage-' + (made.stage + 1));
    if (made.timer) window.RoomkStats?.count('timer');
  } else if (ok === false) {
    toast('遊ぶ人が2人そろっていないよ。だれかが入るのを待つか、「ホストも遊ぶ」をオンにしてね');
  }
}

// ステージを作りなおす。mode: 'next'（クリアのあと）・'again'（同じステージ）・'skip'（途中で次へ）
// 遊ぶ人は、いま参加している人で決めなおす（途中から入った人が入り、いなくなった人は外れる）
async function restartGame(mode) {
  const room = state.room;
  const cur = gameOf(room);
  if (!cur || state.busy || state.role !== 'host' || !state.roomRef) return;
  const cleared = !!state.world?.clear;
  if (mode === 'again' && !cleared && !window.confirm('このステージを、はじめからやりなおす？ みんな、はじめの場所にもどるよ。')) return;
  if (mode === 'skip' && !cleared && !window.confirm('次のステージにする？ このステージの進みは消えるよ。')) return;
  if (room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  const seats = seatList(room);
  const stage = mode === 'again' ? cur.stage : (cur.stage + 1) % STAGE_COUNT;
  const made = newGameFor(room, seats, stage);
  if (!made) {
    toast('遊ぶ人が2人そろっていないよ。「待合室へ」でだれかが入るのを待ってね');
    return;
  }
  const left = cur.seats.filter((name) => !seats.includes(name));
  state.busy = true;
  try {
    // live は、前のステージの分を消す（新しい番号のものは、これから書く）
    await state.roomRef.update({ lastGameId: made.id, 'set/stage': stage, game: made, live: null });
    window.RoomkStats?.count(mode);
    window.RoomkStats?.count('stage-' + (stage + 1));
    if (left.length) toast(left.join('・') + 'は、いないのでこのステージには入っていないよ', false);
  } catch (error) {
    console.warn('[noriai-road] restart failed', error);
    toast('ステージを作れませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

async function backToLobby() {
  if (state.world && !state.world.clear && !window.confirm('このステージをやめて、待合室にもどる？')) return;
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  const room = state.room;
  if (room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  state.busy = true;
  try {
    await state.roomRef.update({ status: STATUS.WAITING, game: null, live: null });
  } catch (error) {
    console.warn('[noriai-road] back to lobby failed', error);
    toast('もどれませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

/* ── ルームの変化 ── */
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
  // 位置・ワールド（live）は1秒に何十回も変わる。画面の文字やボタンは、ほかが変わったときだけ作りなおす
  const meta = { ...room };
  delete meta.live;
  const sig = JSON.stringify(meta);
  const game = room.status === STATUS.PLAY ? gameOf(room) : null;
  if (game) syncGame(room, game, performance.now());
  else if (state.world) resetGame();
  if (sig !== state.metaSig) {
    state.metaSig = sig;
    renderRoom(room);
  }
}

function updateHostOverlay(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // 切れたままのあいだに切れた時刻だけが新しくなったら、期限のタイマーを仕掛けなおす
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

function renderRoom(room) {
  const game = room.status === STATUS.PLAY ? gameOf(room) : null;
  const next = game ? 'game' : 'waiting';
  if (state.currentScreen !== next) showScreen(next);
  renderBar(room, game);
  if (game) renderGameUI(room, game);
  else renderWaiting(room);
}

function renderBar(room, game) {
  const seats = game ? game.seats : seatList(room);
  const seat = seats.indexOf(state.nickname);
  const me = (state.role === 'host' ? 'ホスト' : state.nickname)
    + (seat >= 0 ? '・' + (seat + 1) + '番' : state.role === 'host' ? '・進行だけ' : game ? '・この回は見る番' : '');
  $('barMe').hidden = false;
  $('barMe').textContent = me;
}

function renderWaiting(room) {
  const host = state.role === 'host';
  const seats = seatList(room);
  const set = normSet(room.set);
  const others = memberNames(room).filter((name) => !seats.includes(name));
  const ready = seats.length >= MIN_SEATS && seats.every((name) => seatable(room, name));
  $('seatNote').textContent = host && seats.length < MIN_SEATS ? '2人からはじめられるよ。だれかが入るのを待つか、「ホストも遊ぶ」をオンにしてね' : '';
  $('seatNote').hidden = !$('seatNote').textContent;
  const row = (name, si) => {
    const li = el('li', 'nr-person');
    li.append(si >= 0 ? numBadge(si + 1) : icon('person'));
    li.append(el('span', 'nr-person__name', name));
    if (name === room.host) li.append(el('span', 'nr-chip nr-chip--muted', si >= 0 ? 'ホスト' : 'ホスト（進行だけ）'));
    if (name === state.nickname) li.append(el('span', 'nr-chip nr-chip--you', 'あなた'));
    return li;
  };
  $('lobbyPeople').replaceChildren(...seats.map((name, i) => row(name, i)), ...others.map((name) => row(name, -1)));
  $('hostPlaysBox').hidden = !host;
  if (host) $('hostPlays').checked = set.hostPlays;
  $('timerBox').hidden = !host;
  if (host) $('timerOn').checked = set.timer;
  $('lobbyTimerNote').hidden = host || !set.timer;
  $('lobbySet').hidden = !host;
  if (host) seg($('lobbySet'), E.STAGES.map((s, k) => [k, stageLabel(k), STAGE_NOTE[k]]), set.stage, (v) => saveSet((s) => ({ ...s, stage: v })));
  $('lobbySetNote').textContent = host ? 'クリアすると、次のステージへ進める。' : 'ステージ: ' + stageLabel(set.stage) + '（' + STAGE_NOTE[set.stage] + '）';
  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host;
}

// ステージの画面の文字・ボタン（位置が変わるたびではなく、ルームの決まりが変わったときに作りなおす）
function renderGameUI(room, game) {
  const host = state.role === 'host';
  const seat = selfSeat(game);
  const st = E.STAGES[game.stage];
  $('stageName').textContent = stageLabel(game.stage);
  $('hintText').textContent = st.hint;
  $('hintText').hidden = !state.hintOpen;
  $('btnHint').hidden = false;
  $('btnLocalTop').hidden = true;
  $('btnHint').setAttribute('aria-expanded', String(state.hintOpen));
  const you = $('youLine');
  you.hidden = !seat;
  if (seat) {
    you.textContent = 'あなたは' + seat + '番';
    you.style.background = SEAT_DARK[seat - 1];
  }
  $('watchLine').hidden = !!seat;
  $('watchLine').textContent = host ? '進行だけ。みんなの様子を見ているよ' : 'この回は見る番。次のステージから入れるよ';
  $('pickBox').hidden = true;
  $('pads').hidden = !seat;
  $('keyHint').hidden = !seat || !PC_MQ.matches;
  $('sayRow').hidden = !seat;
  renderSayPanel();
  // 遊ぶ人の一覧（通信が切れた人は、そう出す）
  $('roster').replaceChildren(...game.seats.map((name, i) => {
    const li = el('li');
    const off = !room.players?.[name];
    li.append(numBadge(i + 1), el('span', off ? 'is-off' : '', name + (off ? '（通信が切れた）' : '')));
    return li;
  }));
  $('hostMenu').hidden = !host;
  $('btnLobby').hidden = false;
  const absent = game.seats.some((name) => !room.players?.[name]);
  $('btnRetry').title = absent ? 'いま参加している人で、はじめからやりなおす' : '';
  $('btnSkip').textContent = game.stage === STAGE_COUNT - 1 ? 'はじめのステージにする' : '次のステージにする';
  $('btnNext').textContent = game.stage === STAGE_COUNT - 1 ? 'はじめのステージへ' : '次のステージへ';
  $('timeLine').hidden = !game.timer;
  state.timeText = null;
  renderClearTime();
}

/* ── タイムアタック ── */
// 時間の書き方（1:05.3）。まだ進んでいる間は、1秒ごと（1:05）
function fmtTime(ms, tenths) {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const sec = Math.floor((t % 60000) / 1000);
  return m + ':' + String(sec).padStart(2, '0') + (tenths ? '.' + Math.floor((t % 1000) / 100) : '');
}
// いまの時間の情報 { on, ms, done, best }。はかっていなければ on: false
function timeInfo() {
  if (state.mode === 'local') {
    const L = state.local;
    if (!L.timerRun || !state.world) return { on: false };
    const done = L.clearMs != null;
    return { on: true, ms: done ? L.clearMs : performance.now() - L.t0, done, best: L.best[state.world.stage] ?? null, prev: L.prevBest };
  }
  const game = gameOf(state.room);
  if (!game || !game.timer || game.startedAt == null) return { on: false };
  const done = game.clearMs != null;
  const ms = done ? game.clearMs : (state.world?.clear ? state.frozenMs ?? RoomkRTDB.now() - game.startedAt : RoomkRTDB.now() - game.startedAt);
  return { on: true, ms, done, best: bestOf(state.room, game.stage), prev: state.prevBest };
}
// ステージの上の時間（1こまごとに呼ぶ。文字が変わったときだけ書きかえる）
function updateTimeLine() {
  const t = timeInfo();
  if (!t.on) return;
  if (state.world?.clear && !t.done && state.frozenMs == null) state.frozenMs = t.ms;
  const text = 'タイム ' + fmtTime(t.ms, t.done);
  if (text === state.timeText) return;
  state.timeText = text;
  $('timeLine').textContent = text;
}
// クリアの札のタイム
function renderClearTime() {
  const t = timeInfo();
  const box = $('clearTime');
  if (!t.on || !t.done) { box.hidden = true; return; }
  const lines = ['クリアまでのタイム ' + fmtTime(t.ms, true)];
  // いちばん速いタイムは、このルーム（1台のときは、この画面を開いている間）の、同じステージで
  if (t.best != null && t.ms <= t.best && t.prev != null) lines.push('このステージで、いちばん速いタイム！（前は ' + fmtTime(t.prev, true) + '）');
  else if (t.best != null && t.ms > t.best) lines.push('このステージのいちばん速いタイム ' + fmtTime(t.best, true));
  box.replaceChildren(...lines.map((x, i) => el(i ? 'span' : 'strong', '', x)));
  box.hidden = false;
}
// ホスト: クリアしたら、クリアまでの時間と、いちばん速いタイムを1回だけ書く
function recordClearTime(game) {
  if (state.role !== 'host' || !game.timer || game.startedAt == null || game.clearMs != null || state.clearSent === game.id) return;
  state.clearSent = game.id;
  const ms = Math.max(0, Math.round(state.frozenMs ?? RoomkRTDB.now() - game.startedAt));
  const best = bestOf(state.room, game.stage);
  state.prevBest = best;
  const up = { 'game/clearMs': ms };
  if (best == null || ms < best) up['best/' + game.stage] = ms;
  state.roomRef.update(up).catch((error) => {
    console.warn('[noriai-road] clear time failed', error);
    state.clearSent = null;
  });
}

/* ── ステージの同期 ── */
function startWorld(room, game) {
  resetGame();
  const w = E.createWorld(game.stage, game.n);
  state.world = w;
  SEND_MS = sendMsFor(game.n);
  INTERP_MS = Math.round(SEND_MS * 1.4);
  state.gameId = game.id;
  state.seat = selfSeat(game);
  const live = room.live?.[game.id] || {};
  // 読み込み直したときは、自分の書いた位置から続ける
  const me = state.seat ? w.players[state.seat - 1] : null;
  const saved = me ? E.decodePlayer(live.p?.[state.seat]) : null;
  if (me && saved) Object.assign(me, { x: saved.x, y: saved.y, face: saved.face, entered: saved.entered, ground: null });
  // ホストが読み込み直したときは、書いておいたワールドから続ける
  if (state.role === 'host' && live.w) E.applySnapshot(w, live.w, true);
  // 前から出ていたひとことは、出しなおさない
  for (const [s, v] of Object.entries(live.say || {})) state.saySeen[s] = v;
  for (const p of w.players) if (p.seat !== state.seat) { p.away = true; p.entered = true; }
  state.camX = E.camLeft(w, w.players) || 0;
  state.hintOpen = game.stage === 0 || state.hintOpen;
}

function syncGame(room, game, now) {
  if (state.gameId !== game.id || !state.world) startWorld(room, game);
  const w = state.world;
  // クリアの前のいちばん速いタイムを覚えておく（クリアで書きかわったとき「前は」を出す）
  if (game.clearMs == null && state.role !== 'host') state.prevBest = bestOf(room, game.stage);
  const live = room.live?.[game.id] || {};
  // ほかの人の位置
  const pmap = live.p || {};
  for (let s = 1; s <= game.n; s++) {
    if (s === state.seat) continue;
    const raw = pmap[s];
    if (!raw) continue;
    const key = JSON.stringify(raw);
    const r = state.remote[s] || (state.remote[s] = { buf: [], key: '' });
    if (r.key === key) continue;
    r.key = key;
    const d = E.decodePlayer(raw);
    if (!d) continue;
    const last = r.buf[r.buf.length - 1];
    // しばらく止まっていた人が動きだしたときは、止まっていた位置から動きはじめるように描く
    if (last && now - last.t > SEND_MS * 2) r.buf.push({ ...last, t: now - SEND_MS });
    r.buf.push({ ...d, t: now });
    if (r.buf.length > 30) r.buf.splice(0, r.buf.length - 30);
  }
  // ルームからいなくなった人（クリアの数に入れない）
  game.seats.forEach((name, i) => { w.players[i].absent = !room.players?.[name]; });
  // ホストの書いたワールド
  if (state.role !== 'host' && live.w) {
    const key = JSON.stringify(live.w);
    if (key !== state.worldKey) {
      state.worldKey = key;
      E.applySnapshot(w, live.w, false);
      state.objBuf.push({ t: now, b: asList(live.w.b), p: asList(live.w.p), i: asList(live.w.i) });
      if (state.objBuf.length > 20) state.objBuf.shift();
    }
  }
  // 投げる（ホストが投げて、受けとった印を消す）
  if (state.role === 'host' && live.ev) {
    for (const [key, ev] of Object.entries(live.ev)) {
      if (state.evSeen.has(key)) continue;
      state.evSeen.add(key);
      const s = Number(ev?.s);
      // k: 'p' は「ひろう」（持ち運べるばね）。ないときは投げる・置く
      if (Number.isInteger(s) && s >= 1 && s <= game.n) {
        if (ev.k === 'p') E.pickItem(w, s, Number(ev.x) || 0, Number(ev.y) || 0);
        else E.throwItem(w, s, ev.f < 0 ? -1 : 1, Number(ev.x) || 0, Number(ev.y) || 0);
      }
      state.roomRef.child('live/' + game.id + '/ev/' + key).remove().catch(() => {});
    }
  }
  // ひとこと
  for (const [s, v] of Object.entries(live.say || {})) {
    if (state.saySeen[s] === v) continue;
    state.saySeen[s] = v;
    const k = Number(String(v).split('.')[0]);
    if (SAYS[k]) state.says[s] = { text: SAYS[k], until: performance.now() + SAY_SHOW_MS };
  }
}

function bracket(buf, rt) {
  if (!buf.length) return null;
  if (rt <= buf[0].t) return [buf[0], buf[0], 0];
  for (let k = buf.length - 1; k >= 0; k--) {
    if (buf[k].t <= rt) {
      const a = buf[k];
      const b = buf[k + 1] || a;
      return [a, b, b.t > a.t ? Math.min(1, (rt - a.t) / (b.t - a.t)) : 0];
    }
  }
  return [buf[0], buf[0], 0];
}
const lerp = (a, b, u) => a + (b - a) * u;

// ほかの人の描く位置。乗っている人は、下の人の描く位置に乗せる
function updateRemotes(now) {
  const w = state.world;
  const rt = now - INTERP_MS;
  const done = new Set([state.seat]);
  const todo = [];
  for (const p of w.players) {
    if (p.seat === state.seat) continue;
    const r = state.remote[p.seat];
    const bk = r ? bracket(r.buf, rt) : null;
    const px = p.x, py = p.y;
    p.px = px; p.py = py;
    if (!bk || p.absent) { p.away = !bk; p.entered = true; p.dx = 0; p.dy = 0; done.add(p.seat); continue; }
    p.away = false;
    const [a, b, u] = bk;
    p.face = b.face; p.ground = b.ground; p.inDir = b.inDir; p.entered = b.entered;
    p.hx = lerp(a.x, b.x, u); p.hy = lerp(a.y, b.y, u); p.hrx = b.rx || 0;
    todo.push(p);
  }
  for (let pass = 0; pass < 5 && todo.length; pass++) {
    for (let k = todo.length - 1; k >= 0; k--) {
      const p = todo[k];
      const g = p.ground;
      if (g && g[0] === 's') {
        const s = +g.slice(1);
        if (!done.has(s)) continue;
        const q = w.players[s - 1];
        if (q && !q.entered) { p.x = q.x + p.hrx; p.y = q.y - E.PH; } else { p.x = p.hx; p.y = p.hy; }
      } else if (g && (g[0] === 'p' || g[0] === 'b')) {
        // 動く床・箱の上: この端末で描いている床・箱の上に乗せる（書く間かくをあけても、床からずれて見えない）
        const c = (g[0] === 'p' ? w.plats : w.boxes)[+g.slice(1)];
        if (c) { p.x = c.x + p.hrx; p.y = c.y - E.PH; } else { p.x = p.hx; p.y = p.hy; }
      } else { p.x = p.hx; p.y = p.hy; }
      done.add(p.seat);
      todo.splice(k, 1);
    }
  }
  for (const p of todo) { p.x = p.hx; p.y = p.hy; }
  for (const p of w.players) {
    if (p.seat === state.seat || p.px == null) continue;
    p.dx = p.x - p.px; p.dy = p.y - p.py;
  }
}

// ホストでない端末: 箱・床・カギ・ボールを、少し前の時刻でつなぐ
function updateObjects(now) {
  const w = state.world;
  const bk = bracket(state.objBuf, now - INTERP_MS);
  if (bk) {
    const [a, b, u] = bk;
    const at = (list, k) => asList(list[k]);
    w.boxes.forEach((o, k) => {
      const ox = o.x, oy = o.y;
      const va = at(a.b, k), vb = at(b.b, k);
      if (va.length >= 2 && vb.length >= 2) { o.x = lerp(+va[0], +vb[0], u); o.y = lerp(+va[1], +vb[1], u); }
      o.dx = o.x - ox; o.dy = o.y - oy;
    });
    w.plats.forEach((o, k) => {
      const ox = o.x, oy = o.y;
      const va = at(a.p, k), vb = at(b.p, k);
      if (va.length >= 2 && vb.length >= 2) { o.x = lerp(+va[0], +vb[0], u); o.y = lerp(+va[1], +vb[1], u); }
      o.dx = o.x - ox; o.dy = o.y - oy;
    });
    w.items.forEach((o, k) => {
      const va = at(a.i, k), vb = at(b.i, k);
      if (va.length >= 2 && vb.length >= 2) { o.x = lerp(+va[0], +vb[0], u); o.y = lerp(+va[1], +vb[1], u); }
    });
  }
  for (const it of w.items) {
    if (it.gone || !it.holder) continue;
    const q = w.players[it.holder - 1];
    if (q) { it.x = q.x + E.PW / 2 - E.ITEM / 2; it.y = q.y - E.ITEM - 0.02; }
  }
  for (const g of w.gates) g.anim = Math.max(0, Math.min(1, g.anim + (g.open ? 1 : -1) * DT * 5));
}

function writeFail(error) {
  console.warn('[noriai-road] write failed', error);
  if (Date.now() - state.stepFailAt > 5000) {
    state.stepFailAt = Date.now();
    toast('うまく送れなかったよ。通信を確かめてね');
  }
}

function stepRoom(now, inputs) {
  const w = state.world;
  const room = state.room;
  if (!w || !room || state.leaving) return;
  // ホストが切れている間は、動かさず・書かない
  if (state.role !== 'host' && room.hostConnected === false) return;
  const id = state.gameId;
  updateRemotes(now);
  if (state.role === 'host') E.stepObjects(w, DT, w.players);
  else updateObjects(now);
  if (state.seat) {
    const me = w.players[state.seat - 1];
    const l = E.camLeft(w, w.players);
    const ctx = {
      gates: w.gates, boxes: w.boxes, plats: w.plats, players: w.players,
      cam: l == null ? null : { l, r: l + E.VIEW }, door: w.door, holding: (s) => E.holdingOf(w, s),
    };
    const o = E.stepPlayer(w, me, inputs[0] || {}, DT, ctx);
    if (o.throw) {
      if (state.role === 'host') E.throwItem(w, me.seat, me.face, me.x, me.y);
      else state.roomRef.child('live/' + id + '/ev').push({ s: me.seat, f: me.face, x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100 }).catch(writeFail);
    }
    if (o.pick) {
      if (state.role === 'host') E.pickItem(w, me.seat, me.x, me.y);
      else state.roomRef.child('live/' + id + '/ev').push({ s: me.seat, k: 'p', f: me.face, x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100 }).catch(writeFail);
    }
    // 自分の位置: 変わったときだけ・1秒に10回まで（はじめの1回は、止まっていても書く）
    const enc = E.encodePlayer(me);
    const key = JSON.stringify(enc);
    if (key !== state.lastSent && now - state.lastSentAt >= SEND_MS) {
      state.lastSent = key;
      state.lastSentAt = now;
      state.roomRef.child('live/' + id + '/p/' + state.seat).set(enc).catch(writeFail);
    }
  }
  if (state.role === 'host') {
    const snap = E.snapshot(w);
    const key = JSON.stringify(snap);
    if (key !== state.lastWorld && now - state.lastWorldAt >= SEND_MS) {
      state.lastWorld = key;
      state.lastWorldAt = now;
      state.roomRef.child('live/' + id + '/w').set(snap).catch(writeFail);
    }
    if (w.clear && !state.finished) {
      state.finished = true;
      window.RoomkStats?.count('finish');
    }
    if (w.clear) {
      const game = gameOf(room);
      if (game && game.id === id) recordClearTime(game);
    }
  }
}

/* ── ひとこと ── */
function renderSayPanel() {
  const panel = $('sayPanel');
  if (panel.childElementCount) return;
  panel.replaceChildren(...SAYS.map((t, k) => {
    const b = el('button', '', t);
    b.type = 'button';
    b.addEventListener('click', () => sendSay(k));
    return b;
  }));
}
function sendSay(k) {
  if (state.mode === 'local') return;
  const game = gameOf(state.room);
  if (!game || !state.seat || !state.roomRef || state.room.hostConnected === false) return;
  const now = Date.now();
  if (now - state.sayAt < SAY_EVERY_MS) {
    toast('ひとことは、5秒に1回まで送れるよ', false);
    return;
  }
  state.sayAt = now;
  state.sayCount = (state.sayCount + 1) % 1000;
  const v = k + '.' + state.sayCount;
  state.saySeen[state.seat] = v;
  state.says[state.seat] = { text: SAYS[k], until: performance.now() + SAY_SHOW_MS };
  state.roomRef.child('live/' + game.id + '/say/' + state.seat).set(v).catch(writeFail);
  window.RoomkStats?.count('say');
  $('sayPanel').hidden = true;
  $('btnSay').setAttribute('aria-expanded', 'false');
}

/* ── 1台のパソコンで遊ぶ ── */
function renderLocalSet() {
  seg($('localCountSeg'), [2, 3, 4].map((n) => [n, n + '人']), state.local.n, (v) => { state.local.n = v; renderLocalSet(); });
  seg($('localStageSeg'), E.STAGES.map((s, k) => [k, stageLabel(k), STAGE_NOTE[k]]), state.local.stage, (v) => { state.local.stage = v; renderLocalSet(); });
  $('localTimer').checked = state.local.timer;
}
function startLocal(stage) {
  state.mode = 'local';
  resetGame();
  state.world = E.createWorld(stage, state.local.n);
  state.local.stage = stage;
  // タイムアタック（はかるときだけ）。いちばん速いタイムは、この画面を開いている間だけ覚える
  Object.assign(state.local, { timerRun: state.local.timer, t0: performance.now(), clearMs: null, prevBest: null });
  state.camX = E.camLeft(state.world, state.world.players) || 0;
  state.pick = Math.min(state.pick, state.local.n);
  state.hintOpen = stage === 0 || state.hintOpen;
  showScreen('game');
  renderLocalUI();
  startLoop();
}
function renderLocalUI() {
  const w = state.world;
  $('stageName').textContent = stageLabel(w.stage);
  $('hintText').textContent = E.STAGES[w.stage].hint;
  $('hintText').hidden = !state.hintOpen;
  $('btnHint').setAttribute('aria-expanded', String(state.hintOpen));
  $('btnLocalTop').hidden = false;
  $('youLine').hidden = true;
  $('watchLine').hidden = true;
  $('pickBox').hidden = false;
  seg($('pickSeg'), w.players.map((p) => [p.seat, p.seat + '番']), state.pick, (v) => { state.pick = v; renderLocalUI(); });
  $('pads').hidden = false;
  $('keyHint').hidden = true;
  $('sayRow').hidden = true;
  $('roster').replaceChildren();
  $('hostMenu').hidden = false;
  $('btnLobby').hidden = true;
  $('timeLine').hidden = !state.local.timerRun;
  state.timeText = null;
  const last = w.stage === STAGE_COUNT - 1;
  $('btnSkip').textContent = last ? 'はじめのステージにする' : '次のステージにする';
  $('btnNext').textContent = last ? 'はじめのステージへ' : '次のステージへ';
}
function stopLocal() {
  if (state.mode !== 'local') return;
  state.mode = null;
  resetGame();
}

/* ── 入力 ── */
const GAME_CODES = new Set([...KEYSETS.flatMap((k) => Object.values(k)), ...Object.values(SOLO_KEYS).flat()]);
document.addEventListener('keydown', (ev) => {
  if (state.currentScreen !== 'game' || !state.world) return;
  const t = ev.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  if (!GAME_CODES.has(ev.code) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  // スペースでボタンを押す操作は、ボタンにフォーカスがあるときはそのまま
  if (ev.code === 'Space' && t && (t.tagName === 'BUTTON' || t.tagName === 'SUMMARY')) return;
  ev.preventDefault();
  if (ev.repeat) return;
  state.keys.add(ev.code);
  if (state.mode === 'local') {
    KEYSETS.forEach((k, i) => {
      if (ev.code === k.j) state.latch[i].j = true;
      if (ev.code === k.a) state.latch[i].a = true;
    });
  } else {
    if (SOLO_KEYS.j.includes(ev.code)) state.latch[0].j = true;
    if (SOLO_KEYS.a.includes(ev.code)) state.latch[0].a = true;
  }
});
document.addEventListener('keyup', (ev) => { state.keys.delete(ev.code); });
window.addEventListener('blur', () => { state.keys.clear(); for (const k of Object.keys(state.pad)) state.pad[k] = false; });
for (const b of document.querySelectorAll('.nr-pad')) {
  const key = b.dataset.key;
  const down = (ev) => {
    ev.preventDefault();
    state.pad[key] = true;
    state.padLatch[key] = true;
    b.classList.add('is-down');
    try { b.setPointerCapture(ev.pointerId); } catch { /* なくてもよい */ }
  };
  const up = () => { state.pad[key] = false; b.classList.remove('is-down'); };
  b.addEventListener('pointerdown', down);
  b.addEventListener('pointerup', up);
  b.addEventListener('pointercancel', up);
  b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', (ev) => ev.preventDefault());
}
const has = (codes) => codes.some((c) => state.keys.has(c));

// 人ごとの入力。jumpPressed・actPressed は、押したあとの1こまだけ
function readInputs() {
  const out = [];
  for (let i = 0; i < 4; i++) {
    let l, r, j, ja, aa;
    if (state.mode === 'local') {
      const k = KEYSETS[i];
      l = state.keys.has(k.l); r = state.keys.has(k.r); j = state.keys.has(k.j);
      ja = !!state.latch[i].j; aa = !!state.latch[i].a;
    } else if (i === 0) {
      l = has(SOLO_KEYS.l); r = has(SOLO_KEYS.r); j = has(SOLO_KEYS.j);
      ja = !!state.latch[0].j; aa = !!state.latch[0].a;
    } else { out.push({}); continue; }
    const usePad = state.mode === 'local' ? i === state.pick - 1 : true;
    if (usePad) {
      l = l || state.pad.l; r = r || state.pad.r; j = j || state.pad.j;
      ja = ja || !!state.padLatch.j; aa = aa || !!state.padLatch.a;
    }
    out.push({ l, r, jump: j, jumpPressed: ja, actPressed: aa });
  }
  state.latch = [{}, {}, {}, {}];
  state.padLatch = {};
  return out;
}

/* ── 1こま ── */
function startLoop() {
  if (state.running) return;
  state.running = true;
  state.last = performance.now();
  state.acc = 0;
  requestAnimationFrame(frame);
}
function frame(t) {
  if (!state.mode) { state.running = false; return; }
  const elapsed = Math.min(0.1, Math.max(0, (t - state.last) / 1000));
  state.last = t;
  if (state.world && state.currentScreen === 'game') {
    state.acc += elapsed;
    let steps = 0;
    while (state.acc >= DT && steps < 6) {
      const now = performance.now();
      const inputs = readInputs();
      if (state.mode === 'local') E.stepLocal(state.world, inputs, DT);
      else stepRoom(now, inputs);
      state.acc -= DT;
      steps++;
    }
    if (steps >= 6) state.acc = 0;
    draw();
    updateActLabel();
    updateClear();
    updateTimeLine();
  }
  requestAnimationFrame(frame);
}

// とびらに入っている間は、「投げる」のボタンを「出る」に（スマホの幅でも1行に収まる長さ）、キーの案内を出かたにする
function updateActLabel() {
  const w = state.world;
  const seat = state.mode === 'local' ? state.pick : state.seat;
  const me = seat ? w.players[seat - 1] : null;
  const inside = !!(me && me.entered && !me.away);
  // 持ち運べるばね: 持っていれば「置く」、近くにあれば「ひろう」
  const hold = me && !inside ? E.holdingOf(w, me.seat) : null;
  const mode = inside ? 'in' : hold === 'spring' ? 'put' : !hold && me && E.pickable(w, me) ? 'pick' : '';
  if (state.actMode === mode) return;
  state.actMode = mode;
  const LABELS = {
    in: ['出る', 'とびらから出る', 'とびらの中にいるよ。下の矢印キー（S でも）で、とびらから出られる'],
    put: ['置く', 'ばねを目の前に置く', 'ばねを持っているよ。下の矢印キー（S でも）で、目の前に置ける'],
    pick: ['ひろう', 'ばねをひろう', '近くにばねがあるよ。下の矢印キー（S でも）で、ひろえる'],
    '': ['投げる', '', 'キーボード: 左右で動く・上かスペースでジャンプ・下で投げる'],
  };
  const [text, aria, hint] = LABELS[mode];
  const pad = document.querySelector('.nr-pad[data-key="a"]');
  if (pad) {
    pad.textContent = text;
    if (aria) pad.setAttribute('aria-label', aria); else pad.removeAttribute('aria-label');
  }
  $('keyHint').textContent = hint;
}

function updateClear() {
  const w = state.world;
  const clear = !!w?.clear;
  if (state.clearShown === clear) return;
  state.clearShown = clear;
  if (clear && state.mode === 'local' && state.local.timerRun && state.local.clearMs == null) {
    const L = state.local;
    L.clearMs = Math.round(performance.now() - L.t0);
    L.prevBest = L.best[w.stage] ?? null;
    if (L.prevBest == null || L.clearMs < L.prevBest) L.best[w.stage] = L.clearMs;
  }
  renderClearTime();
  $('clearBox').hidden = !clear;
  const canPick = state.mode === 'local' || state.role === 'host';
  $('clearBtns').hidden = !canPick;
  $('clearWait').hidden = canPick;
  if (clear && canPick) $('btnNext').focus({ preventScroll: true });
}

/* ── 描く ── */
const canvas = $('canvas');
const g = canvas.getContext('2d');
function resize() {
  const rect = $('stageBox').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
}
window.addEventListener('resize', () => { if (state.currentScreen === 'game') resize(); });

function draw() {
  const w = state.world;
  const W = canvas.width;
  const Hc = canvas.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  const sky = g.createLinearGradient(0, 0, 0, Hc);
  sky.addColorStop(0, '#FBEFD9');
  sky.addColorStop(1, '#F3DDB8');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, Hc);
  if (!w) return;
  const target = E.camLeft(w, w.players);
  if (target != null) state.camX += (target - state.camX) * 0.15;
  const cam = state.camX;
  const T = W / E.VIEW;
  g.fillStyle = '#EBD3AC';
  g.beginPath();
  g.moveTo(0, Hc);
  for (let x = 0; x <= W; x += 8) g.lineTo(x, Hc * 0.62 + Math.sin((x / T + cam * 0.4) * 0.35) * T * 0.8);
  g.lineTo(W, Hc);
  g.fill();
  g.save();
  g.translate(-cam * T, 0);
  const x0 = Math.max(0, Math.floor(cam) - 1);
  const x1 = Math.min(w.W - 1, Math.ceil(cam + E.VIEW) + 1);
  drawTiles(w, x0, x1, T);
  drawBlocks(w, T);
  drawCheckpoints(w, T);
  drawSprings(w, T);
  drawSwitches(w, T);
  drawGates(w, T);
  drawDoor(w, T);
  drawHoops(w, T);
  drawPlats(w, T);
  drawBoxes(w, T);
  drawRopes(w, T);
  drawPlayers(w, T);
  drawItems(w, T);
  drawSays(w, T);
  g.restore();
}

function rr(x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function shape(kind, cx, cy, s, color) {
  g.fillStyle = color;
  g.beginPath();
  if (kind === 'circle') g.arc(cx, cy, s, 0, Math.PI * 2);
  else if (kind === 'triangle') { g.moveTo(cx, cy - s); g.lineTo(cx + s, cy + s * 0.8); g.lineTo(cx - s, cy + s * 0.8); }
  else if (kind === 'square') g.rect(cx - s * 0.85, cy - s * 0.85, s * 1.7, s * 1.7);
  else if (kind === 'diamond') { g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); }
  else {
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + k * Math.PI / 5;
      const rad = k % 2 ? s * 0.45 : s;
      g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
  }
  g.closePath();
  g.fill();
}
function label(text, cx, cy, size, color, weight) {
  g.fillStyle = color;
  g.font = (weight || 700) + ' ' + Math.round(size) + 'px "Noto Sans JP", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, cx, cy);
}
const visible = (p) => !p.entered && !p.away && !p.absent;

function drawTiles(w, x0, x1, T) {
  for (let x = x0; x <= x1; x++) {
    const col = w.cols[x];
    for (let y = 0; y < E.H; y++) {
      const c = col[y];
      if (c === '#') {
        g.fillStyle = '#9A7652';
        g.fillRect(x * T, y * T, T + 0.5, T + 0.5);
        const above = y > 0 ? col[y - 1] : '.';
        if (above !== '#') {
          g.fillStyle = '#7FAE5C';
          g.fillRect(x * T, y * T, T + 0.5, T * 0.22);
        } else {
          g.fillStyle = 'rgba(0,0,0,0.05)';
          g.fillRect(x * T + T * 0.2, y * T + T * 0.45, T * 0.18, T * 0.12);
        }
      } else if (c >= '1' && c <= '4') {
        const seat = E.mapSeat(+c, w.n);
        g.fillStyle = SEAT_COLORS[seat - 1] + '55';
        g.fillRect(x * T, y * T, T, T);
        g.strokeStyle = SEAT_COLORS[seat - 1];
        g.lineWidth = Math.max(2, T * 0.06);
        g.strokeRect(x * T + 1, y * T + 1, T - 2, T - 2);
        label(String(seat), x * T + T / 2, y * T + T / 2, T * 0.42, SEAT_DARK[seat - 1]);
      }
    }
  }
}
// しかけブロック: 開く前は、乗っている人数/要る人数。開いたあとは、空になった印
function drawBlocks(w, T) {
  for (const k of w.blocks || []) {
    const x = k.x * T, y = k.y * T, bw = k.w * T;
    g.fillStyle = k.open ? '#B8A68E' : '#E9B949';
    rr(x + 1, y + 1, bw - 2, T - 2, T * 0.12);
    g.fill();
    g.strokeStyle = k.open ? '#7D6B55' : '#9C7417';
    g.lineWidth = Math.max(2, T * 0.07);
    g.stroke();
    if (k.open) {
      g.fillStyle = '#7D6B55';
      for (const dx of [0.3, 0.7]) { g.beginPath(); g.arc(x + bw * dx, y + T / 2, T * 0.08, 0, Math.PI * 2); g.fill(); }
      continue;
    }
    // ばねの絵（中から出てくるもの）
    g.strokeStyle = '#8A5A12';
    g.lineWidth = Math.max(1.5, T * 0.05);
    g.beginPath();
    for (let j = 0; j <= 4; j++) g.lineTo(x + T * (j % 2 ? 0.55 : 0.25), y + T * (0.8 - j * 0.14));
    g.stroke();
    label(k.riders + '/' + k.need + '人', x + bw * 0.62, y + T / 2, T * 0.32, k.riders >= k.need ? '#1F6E3C' : '#5E3D22');
  }
}
function drawCheckpoints(w, T) {
  w.checkpoints.forEach((cx, k) => {
    if (k === 0) return;
    const y = E.surfaceY(w, cx - E.PW / 2 + 0.3);
    const x = (cx - 0.3) * T;
    g.strokeStyle = '#8C7357';
    g.lineWidth = Math.max(1.5, T * 0.05);
    g.beginPath(); g.moveTo(x, y * T); g.lineTo(x, (y - 0.9) * T); g.stroke();
    g.fillStyle = '#E8B04A';
    g.beginPath(); g.moveTo(x, (y - 0.9) * T); g.lineTo(x + T * 0.4, (y - 0.75) * T); g.lineTo(x, (y - 0.6) * T); g.fill();
  });
}
function drawSwitches(w, T) {
  for (const s of w.switches) {
    const c = LINK_COLORS[s.letter];
    const h = s.on ? 0.08 : 0.2;
    g.fillStyle = '#6E5A45';
    g.fillRect((s.x + 0.08) * T, (s.y + 1 - 0.08) * T, T * 0.84, T * 0.08);
    g.fillStyle = c;
    rr((s.x + 0.15) * T, (s.y + 1 - 0.08 - h) * T, T * 0.7, h * T, T * 0.05);
    g.fill();
    shape(LINK_SHAPES[s.letter], (s.x + 0.5) * T, (s.y + 1 - 0.45) * T, T * 0.14, s.on ? c : c + 'AA');
    // 番号のスイッチ: その番号の人の色と番号
    if (s.seatN) {
      const cx = (s.x + 0.5) * T, cy = (s.y + 1 - 0.85) * T;
      g.fillStyle = SEAT_COLORS[s.seatN - 1];
      g.beginPath(); g.arc(cx, cy, T * 0.24, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.arc(cx, cy, T * 0.17, 0, Math.PI * 2); g.fill();
      label(String(s.seatN), cx, cy, T * 0.24, SEAT_DARK[s.seatN - 1]);
    }
  }
}
// ばね: 床の上のばね。乗ると高く跳ぶ
function drawSprings(w, T) {
  for (const sp of w.springs) {
    const x = (sp.x + 0.12) * T, wd = T * 0.76, base = sp.y * T;
    g.fillStyle = '#6E5A45';
    g.fillRect(x, base - T * 0.08, wd, T * 0.08);
    g.strokeStyle = '#6E5A45';
    g.lineWidth = Math.max(2, T * 0.06);
    g.beginPath();
    const top = base - T * 0.42;
    for (let k = 0; k <= 4; k++) {
      const yy = base - T * 0.08 - (k / 4) * (base - T * 0.08 - top);
      g.lineTo(k % 2 ? x + wd * 0.8 : x + wd * 0.2, yy);
    }
    g.stroke();
    g.fillStyle = '#D9572E';
    rr(x - T * 0.04, top - T * 0.1, wd + T * 0.08, T * 0.14, T * 0.05);
    g.fill();
    g.fillStyle = '#FFFFFF';
    g.beginPath(); g.moveTo(x + wd / 2, top - T * 0.42); g.lineTo(x + wd / 2 - T * 0.13, top - T * 0.24); g.lineTo(x + wd / 2 + T * 0.13, top - T * 0.24); g.fill();
    g.fillStyle = '#D9572E';
    g.beginPath(); g.moveTo(x + wd / 2, top - T * 0.38); g.lineTo(x + wd / 2 - T * 0.09, top - T * 0.26); g.lineTo(x + wd / 2 + T * 0.09, top - T * 0.26); g.fill();
  }
}
function drawGates(w, T) {
  for (const gt of w.gates) {
    const c = gt.seatN ? SEAT_COLORS[gt.seatN - 1] : LINK_COLORS[gt.letter];
    const full = gt.y1 - gt.y0 + 1;
    const h = full * (1 - gt.anim);
    const x = gt.x * T;
    const y = gt.y0 * T;
    if (h <= 0.02) continue;
    g.save();
    g.beginPath();
    g.rect(x, y, T, full * T);
    g.clip();
    g.fillStyle = c + (gt.seatN ? '66' : '33');
    g.fillRect(x, y, T, h * T);
    g.strokeStyle = c;
    g.lineWidth = Math.max(2, T * 0.08);
    for (let k = 0; k < 3; k++) {
      const bx = x + T * (0.2 + k * 0.3);
      g.beginPath(); g.moveTo(bx, y); g.lineTo(bx, y + h * T); g.stroke();
    }
    g.fillStyle = c;
    g.fillRect(x, y + h * T - T * 0.12, T, T * 0.12);
    shape(LINK_SHAPES[gt.letter], x + T / 2, y + h * T - T * 0.45, T * 0.2, '#FFFFFF');
    shape(LINK_SHAPES[gt.letter], x + T / 2, y + h * T - T * 0.45, T * 0.13, c);
    // 同時におさえるとびら: おさえているスイッチの数
    if (gt.all) {
      const sw = w.switches.filter((s) => s.letter === gt.letter);
      const on = sw.filter((s) => s.on).length;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      rr(x + T * 0.04, y + h * T - T * 1.55, T * 0.92, T * 0.5, T * 0.18);
      g.fill();
      label(on + '/' + sw.length, x + T / 2, y + h * T - T * 1.3, T * 0.32, '#5C5146');
    }
    if (gt.seatN) {
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.arc(x + T / 2, y + h * T - T * 1.05, T * 0.26, 0, Math.PI * 2); g.fill();
      label(String(gt.seatN), x + T / 2, y + h * T - T * 1.05, T * 0.34, SEAT_DARK[gt.seatN - 1]);
    }
    g.restore();
  }
}
function drawDoor(w, T) {
  const d = w.door;
  if (!d) return;
  const x = d.x * T, y = d.y * T, dw = d.w * T, dh = d.h * T;
  g.fillStyle = d.locked ? '#8A5A33' : '#3F2E22';
  rr(x, y, dw, dh, T * 0.4);
  g.fill();
  g.strokeStyle = '#5E3D22';
  g.lineWidth = Math.max(2, T * 0.08);
  g.stroke();
  if (d.locked) {
    g.fillStyle = '#E2B53E';
    g.beginPath(); g.arc(x + dw / 2, y + dh * 0.5, T * 0.16, 0, Math.PI * 2); g.fill();
    g.fillRect(x + dw / 2 - T * 0.06, y + dh * 0.5, T * 0.12, T * 0.28);
  } else {
    const live = w.players.filter((p) => !p.absent);
    const inside = live.filter((p) => p.entered && !p.away).length;
    label(inside + '/' + live.length, x + dw / 2, y + dh * 0.45, T * 0.4, '#FBEFD9');
  }
  label('ゴール', x + dw / 2, y - T * 0.3, T * 0.32, '#5E3D22');
}
function drawHoops(w, T) {
  for (const h of w.hoops) {
    const x = h.x * T, y = h.y * T, hw = h.w * T;
    const ground = E.surfaceY(w, h.x + h.w / 2 - E.PW / 2);
    g.strokeStyle = '#8C7357';
    g.lineWidth = Math.max(2, T * 0.08);
    g.beginPath(); g.moveTo(x + hw / 2, y + h.h * T); g.lineTo(x + hw / 2, ground * T); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.beginPath();
    g.moveTo(x, y); g.lineTo(x + hw, y); g.lineTo(x + hw * 0.82, y + h.h * T); g.lineTo(x + hw * 0.18, y + h.h * T);
    g.closePath(); g.fill();
    g.strokeStyle = LINK_COLORS[h.letter];
    g.lineWidth = Math.max(2, T * 0.07);
    g.stroke();
    g.strokeStyle = '#D9534F';
    g.lineWidth = Math.max(3, T * 0.1);
    g.beginPath(); g.moveTo(x - T * 0.05, y); g.lineTo(x + hw + T * 0.05, y); g.stroke();
    shape(LINK_SHAPES[h.letter], x + hw / 2, y + h.h * T * 0.55, T * 0.14, LINK_COLORS[h.letter]);
  }
}
function drawPlats(w, T) {
  for (const s of w.seesaws) {
    const L = w.plats[s.left], R = w.plats[s.right];
    const lx = (L.x + L.w / 2) * T, ly = (L.y + 0.3) * T;
    const rx = (R.x + R.w / 2) * T, ry = (R.y + 0.3) * T;
    g.strokeStyle = '#6E5A45';
    g.lineWidth = Math.max(3, T * 0.12);
    g.beginPath(); g.moveTo(lx, ly); g.lineTo(rx, ry); g.stroke();
    const cx = (lx + rx) / 2, cy = (ly + ry) / 2;
    g.fillStyle = '#6E5A45';
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + T * 0.5, cy + T * 1.6); g.lineTo(cx - T * 0.5, cy + T * 1.6); g.fill();
  }
  w.plats.forEach((p) => {
    const x = p.x * T, y = p.y * T, pw = p.w * T, ph = p.h * T;
    if (p.cap) {
      // 細い橋: 板を並べた形。人数をこえると赤い字
      const over = p.riders > p.cap;
      g.fillStyle = '#D8B07A';
      rr(x, y, pw, ph, T * 0.05);
      g.fill();
      g.strokeStyle = '#8A6238';
      g.lineWidth = Math.max(1, T * 0.035);
      for (let k = 1; k < p.w * 2; k++) { g.beginPath(); g.moveTo(x + k * T * 0.5, y); g.lineTo(x + k * T * 0.5, y + ph); g.stroke(); }
      g.lineWidth = Math.max(1.5, T * 0.05);
      rr(x, y, pw, ph, T * 0.05);
      g.stroke();
      const tx = x + pw / 2, ty = y + ph + T * 0.34;
      g.fillStyle = 'rgba(255,255,255,0.92)';
      rr(tx - T * 1.5, ty - T * 0.22, T * 3.0, T * 0.44, T * 0.2);
      g.fill();
      label(p.cap + '人まで・いま' + p.riders + '人', tx, ty, T * 0.3, over ? '#B3261E' : '#5C5146');
      return;
    }
    g.fillStyle = p.seesaw >= 0 ? '#C79A62' : '#B9834C';
    rr(x, y, pw, ph, T * 0.08);
    g.fill();
    g.strokeStyle = '#7A5530';
    g.lineWidth = Math.max(1.5, T * 0.05);
    g.stroke();
    if (p.seesaw < 0) {
      const tx = x + pw / 2, ty = y + ph + T * 0.32;
      g.fillStyle = 'rgba(255,255,255,0.9)';
      rr(tx - T * 0.55, ty - T * 0.22, T * 1.1, T * 0.44, T * 0.2);
      g.fill();
      const need = E.platNeed(p, w.players);
      label(p.riders + '/' + need + '人', tx, ty, T * 0.3, p.riders >= need ? '#1F6E3C' : '#5C5146');
    } else {
      label('重さ ' + p.riders, x + pw / 2, y + ph + T * 0.3, T * 0.26, '#5C5146', 500);
    }
  });
}
function drawBoxes(w, T) {
  for (const b of w.boxes) {
    const x = b.x * T, y = b.y * T, s = T;
    g.fillStyle = '#C8955A';
    rr(x + 1, y + 1, s - 2, s - 2, T * 0.08);
    g.fill();
    g.strokeStyle = '#80582F';
    g.lineWidth = Math.max(2, T * 0.07);
    g.stroke();
    g.fillStyle = '#FFF7EA';
    g.beginPath(); g.arc(x + s / 2, y + s / 2, s * 0.3, 0, Math.PI * 2); g.fill();
    label(String(b.need), x + s / 2, y + s / 2, s * 0.42, '#5E3D22');
    if ((state.mode === 'local' || state.role === 'host') && b.pushers && b.pushers < b.need) label(b.pushers + '/' + b.need, x + s / 2, y - T * 0.25, T * 0.28, '#5C5146');
  }
}
function drawRopes(w, T) {
  if (!w.rope) return;
  g.strokeStyle = '#8C6A3F';
  g.lineWidth = Math.max(2, T * 0.06);
  for (let s = 1; s < w.n; s++) {
    if (!E.ropeLinked(w.n, s, s + 1)) continue;
    const a = w.players[s - 1], b = w.players[s];
    if (!visible(a) || !visible(b)) continue;
    const ax = (a.x + E.PW / 2) * T, ay = (a.y + E.PH * 0.55) * T;
    const bx = (b.x + E.PW / 2) * T, by = (b.y + E.PH * 0.55) * T;
    const d = Math.hypot(bx - ax, by - ay) / T;
    const sag = Math.max(0, E.ROPE_LEN - d) * 0.35 * T;
    g.beginPath();
    g.moveTo(ax, ay);
    g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + sag, bx, by);
    g.stroke();
  }
}
function drawPlayers(w, T) {
  const now = performance.now();
  for (const p of w.players) {
    if (!visible(p)) continue;
    if (p.blink && Math.floor(now / 90) % 2 === 0) continue;
    const x = p.x * T, y = p.y * T, pw = E.PW * T, ph = E.PH * T;
    const k = p.seat - 1;
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.beginPath(); g.ellipse(x + pw / 2, y + ph, pw * 0.45, T * 0.06, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = SEAT_COLORS[k];
    rr(x, y, pw, ph, pw * 0.38);
    g.fill();
    g.strokeStyle = SEAT_DARK[k];
    g.lineWidth = Math.max(2, T * 0.06);
    g.stroke();
    const ex = x + pw / 2 + p.face * pw * 0.14;
    const ey = y + ph * 0.36;
    for (const s of [-1, 1]) {
      g.fillStyle = '#FFFFFF';
      g.beginPath(); g.ellipse(ex + s * pw * 0.17, ey, pw * 0.12, ph * 0.13, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#3F362D';
      g.beginPath(); g.arc(ex + s * pw * 0.17 + p.face * pw * 0.04, ey + ph * 0.02, pw * 0.06, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = 'rgba(255,255,255,0.92)';
    g.beginPath(); g.arc(x + pw / 2, y + ph * 0.7, pw * 0.22, 0, Math.PI * 2); g.fill();
    label(String(p.seat), x + pw / 2, y + ph * 0.71, pw * 0.34, SEAT_DARK[k]);
    // 自分の印
    if (state.mode === 'room' && p.seat === state.seat) {
      g.fillStyle = SEAT_DARK[k];
      g.beginPath(); g.moveTo(x + pw / 2, y - T * 0.12); g.lineTo(x + pw / 2 - T * 0.14, y - T * 0.32); g.lineTo(x + pw / 2 + T * 0.14, y - T * 0.32); g.fill();
    }
  }
}
function drawItems(w, T) {
  for (const it of w.items) {
    if (it.gone) continue;
    if (it.holder) {
      const q = w.players[it.holder - 1];
      if (!q || !visible(q)) continue;
    }
    if (it.hidden) continue;
    const x = it.x * T, y = it.y * T, s = E.ITEM * T;
    if (it.kind === 'spring') {
      // 持ち運べるばね: 床のばねと同じ形を小さく
      const base = y + s;
      g.fillStyle = '#6E5A45';
      g.fillRect(x, base - s * 0.14, s, s * 0.14);
      g.strokeStyle = '#6E5A45';
      g.lineWidth = Math.max(1.5, T * 0.05);
      g.beginPath();
      for (let j = 0; j <= 4; j++) g.lineTo(x + s * (j % 2 ? 0.8 : 0.2), base - s * 0.14 - j * s * 0.15);
      g.stroke();
      g.fillStyle = '#D9572E';
      rr(x - s * 0.05, base - s * 0.92, s * 1.1, s * 0.2, s * 0.08);
      g.fill();
    } else if (it.kind === 'ball') {
      g.fillStyle = '#F08A24';
      g.beginPath(); g.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#A6520E';
      g.lineWidth = Math.max(1.5, T * 0.05);
      g.stroke();
      g.beginPath(); g.moveTo(x, y + s / 2); g.quadraticCurveTo(x + s / 2, y + s * 0.2, x + s, y + s / 2); g.stroke();
    } else {
      g.fillStyle = '#E2B53E';
      g.strokeStyle = '#9C7417';
      g.lineWidth = Math.max(1.5, T * 0.05);
      g.beginPath(); g.arc(x + s * 0.3, y + s / 2, s * 0.25, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillRect(x + s * 0.5, y + s * 0.42, s * 0.48, s * 0.16);
      g.fillRect(x + s * 0.78, y + s * 0.5, s * 0.1, s * 0.22);
    }
  }
}
function drawSays(w, T) {
  const now = performance.now();
  for (const p of w.players) {
    const s = state.says[p.seat];
    if (!s || s.until < now || !visible(p)) continue;
    g.font = '700 ' + Math.round(T * 0.38) + 'px "Noto Sans JP", sans-serif';
    const tw = g.measureText(s.text).width + T * 0.5;
    const cx = (p.x + E.PW / 2) * T;
    const by = (p.y - 0.55) * T;
    g.fillStyle = '#FFFFFF';
    g.strokeStyle = SEAT_DARK[p.seat - 1];
    g.lineWidth = Math.max(2, T * 0.05);
    rr(cx - tw / 2, by - T * 0.6, tw, T * 0.6, T * 0.2);
    g.fill(); g.stroke();
    label(s.text, cx, by - T * 0.3, T * 0.38, '#3F362D');
  }
}

/* ── ボタン ── */
function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    handler();
  });
}
function localGo(mode) {
  const w = state.world;
  if (!w) return;
  if ((mode === 'again' || mode === 'skip') && !w.clear && !window.confirm(mode === 'again' ? 'このステージを、はじめからやりなおす？' : '次のステージにする？')) return;
  startLocal(mode === 'again' ? w.stage : (w.stage + 1) % STAGE_COUNT);
}
$('btnGoCreate').addEventListener('click', () => { setError('createError', ''); showScreen('create'); $('hostName').focus({ preventScroll: true }); });
$('btnGoJoin').addEventListener('click', () => { setError('joinError', ''); $('joinLinkHint').hidden = true; showScreen('join'); $('guestName').focus({ preventScroll: true }); });
$('btnGoLocal').addEventListener('click', () => { renderLocalSet(); showScreen('local'); });
['btnCreateBack', 'btnJoinBack', 'btnLocalBack'].forEach((id) => $(id).addEventListener('click', () => showScreen('top')));
$('btnCreateRoom').addEventListener('click', createRoom);
submitOnEnter($('hostName'), createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('guestName'), joinRoom);
submitOnEnter($('joinCode'), joinRoom);
$('btnLocalStart').addEventListener('click', () => {
  window.RoomkStats?.count('local-start');
  if (state.local.timer) window.RoomkStats?.count('timer');
  startLocal(state.local.stage);
});
$('btnLocalTop').addEventListener('click', () => { stopLocal(); showScreen('top'); });

$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
$('btnCopyLink').addEventListener('click', (event) => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkRTDB.copyRoomLink(state.roomCode, event.currentTarget);
});
$('btnShowQr').addEventListener('click', () => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkQR.show(state.roomCode);
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);
$('hostPlays').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, hostPlays: on })); });
$('timerOn').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, timer: on })); });
$('localTimer').addEventListener('change', (event) => { state.local.timer = event.currentTarget.checked; });
$('btnStartGame').addEventListener('click', startGame);
$('btnNext').addEventListener('click', () => (state.mode === 'local' ? localGo('next') : restartGame('next')));
$('btnAgain').addEventListener('click', () => (state.mode === 'local' ? localGo('again') : restartGame('again')));
$('btnRetry').addEventListener('click', () => (state.mode === 'local' ? localGo('again') : restartGame('again')));
$('btnSkip').addEventListener('click', () => (state.mode === 'local' ? localGo('skip') : restartGame('skip')));
$('btnLobby').addEventListener('click', backToLobby);
$('btnHint').addEventListener('click', () => {
  state.hintOpen = !state.hintOpen;
  $('hintText').hidden = !state.hintOpen;
  $('btnHint').setAttribute('aria-expanded', String(state.hintOpen));
  requestAnimationFrame(resize);
});
$('btnSay').addEventListener('click', () => {
  const panel = $('sayPanel');
  panel.hidden = !panel.hidden;
  $('btnSay').setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
});
PC_MQ.addEventListener?.('change', () => { if (state.room) { state.metaSig = ''; handleRoom(state.room); } });

function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}
function resumeFromSession() {
  if (!loadSession()) return;
  tryReconnect().then((reconnected) => {
    if (!reconnected && !state.roomRef) clearSession();
  });
}

showScreen('top');
const startParams = new URLSearchParams(location.search);
const roomParam = startParams.get('room');
if (roomParam !== null) {
  // 参加用のリンク（?room=コード）の入口。コードはつないだときにアドレスから外す（connectToRoom）
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

// 隔離エミュレーターでの検証用（tests/noriai-road。本番の画面では作らない）
if (window.__EMU__) window.__noriaiTest = { state, E };
