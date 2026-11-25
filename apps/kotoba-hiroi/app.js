/* ことばひろい
   5〜7つのひらがなから文字をえらんで、決められた文字数の言葉をつくるルーム型のゲーム。
   協力（みんなでボードをうめる）と個人戦（早く見つけた人の言葉になる）を、ホストが待合室で選ぶ。
   問題ごとの答えの一覧（data.js）にある言葉はその場で正解。一覧にない言葉は「たしかめ中」になり、
   みんなで話してホストが「OK」を押すとボードのほかの言葉に入る。
   答えの一覧は参加する人の端末にも届く（性善説。画面には見つかるまで出さない）。 */

const PUZZLES = window.KOTOBA_HIROI_PUZZLES;
const PUZ = Object.fromEntries(PUZZLES.map((p) => [p.id, p]));
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'kotobahiroi_rooms';
const SESSION_KEY = 'kotobahiroi_session';
// ルームコードの形（共通の generateRoomCode と同じ文字。参加用のリンクの検査に使う）
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const MAX_GUESTS = 12;
const MAX_PROXIES = 4;
const STATUS = { WAITING: 'waiting', PLAY: 'play', RESULT: 'result' };

const MODES = {
  coop: { label: '協力', note: 'みんなでボードの言葉をうめよう。全部うまったらクリア' },
  race: { label: '個人戦', note: '早く見つけた人の言葉になるよ。最後に一人ずつの見つけた数が出るよ' },
};
const LEVELS = {
  easy: { label: 'やさしい', note: '5つの文字から、2文字の言葉をつくる' },
  normal: { label: 'ふつう', note: '6つの文字から、3文字の言葉をつくる' },
  hard: { label: 'むずかしい', note: '7つの文字から、3文字か4文字の言葉をつくる' },
  mix: { label: 'まぜる', note: 'やさしい・ふつう・むずかしいがまざって出る' },
};
const COUNTS = [3, 5];
const LIMITS = [0, 60, 120, 180];  // 1問ごとの制限時間（秒）。0 は決めない
const DEFAULT_SETTINGS = { hostPlays: true, mode: 'coop', level: 'normal', count: 3, limit: 0 };

const $ = (id) => document.getElementById(id);
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const now = () => RoomkRTDB.now();
const byKana = (a, b) => a.localeCompare(b, 'ja');

const settingsOf = (room) => ({ ...DEFAULT_SETTINGS, ...(room?.settings || {}) });
const poolOf = (level) => (level === 'mix' ? PUZZLES : PUZZLES.filter((p) => p.level === level));
const countOf = (s) => Math.min(s.count, poolOf(s.level).length);

// ══════════════════════════════════════════════
// 状態
// ══════════════════════════════════════════════
const state = {
  role: null,
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  currentScreen: null,
  timerInterval: null,
  orphanTimer: null,
  orphanAt: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  busy: false,
  // 自分の画面だけのもの（ほかの人には送らない）
  pkey: null,      // いまの問題（`${game}:${idx}`）
  order: [],       // 並べている文字の番号（「文字をまぜる」で変わる）
  compose: [],     // 押した文字の番号
  who: null,       // ホストが代わりに押すときの名前
  fb: '',          // 出した言葉への返事
  fbKind: '',
  sending: false,
};

function showScreen(id) {
  document.querySelectorAll('.khi-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
  document.querySelector('.khi-wrap').classList.toggle('is-top', id === 'top');
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
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '記号 . # $ [ ] / は使えないよ';
  return '';
}
const guestNames = (room) => Object.entries(room.players || {}).filter(([, p]) => !p.isHost).map(([n]) => n);
const proxyNames = (room) => Object.entries(room.proxies || {}).sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0)).map(([n]) => n);
const hostPlaysOf = (room) => settingsOf(room).hostPlays !== false;
// 遊ぶ人（進行だけのホストは含めない。端末なしの参加者は含める）。参加した順
function playerNames(room) {
  const plays = hostPlaysOf(room);
  const inRoom = Object.entries(room.players || {})
    .filter(([, p]) => !p.isHost || plays)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || byKana(a[0], b[0]))
    .map(([n]) => n);
  return inRoom.concat(proxyNames(room));
}
const iPlay = (room) => state.role === 'guest' || (state.role === 'host' && hostPlaysOf(room));
// この画面で言葉を出せる名前（ホストは自分が遊ぶときの自分と、端末なしの参加者）
function makersOf(room) {
  if (state.role === 'guest') return [state.nickname];
  if (state.role !== 'host') return [];
  return (hostPlaysOf(room) ? [state.nickname] : []).concat(proxyNames(room));
}

function isExpired(room) {
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}
async function removeExpired(ref, fallback) {
  try {
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    });
  } catch (error) {
    console.warn('[kotoba-hiroi] expired room cleanup failed', error);
  }
}
// transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
function warmRoomCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => resolve({ snap, release: () => ref.off('value', callback) });
    ref.on('value', callback, reject);
  });
}
// 送信したあとに通信が切れると、transaction は Error('disconnect') で中止される（届いたかは分からない）。
// ルームの作成と参加は少しだけやり直す。update は、前の送信が届いていたら成功として扱うように書く
const TX_RETRY_MAX = 3;
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

function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    role: state.role, nickname: state.nickname, roomCode: state.roomCode, uid: firebase.auth().currentUser?.uid,
  }));
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  state.timerInterval = null;
  state.orphanTimer = null;
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  Object.assign(state, {
    role: null, nickname: null, roomCode: null, roomRef: null, room: null,
    connectedRef: null, connectedCallback: null, roomCallback: null,
    pkey: null, order: [], compose: [], who: null, fb: '', fbKind: '', sending: false,
  });
  sessionStorage.removeItem(SESSION_KEY);
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
}

function connectToRoom(role, nickname, code, ref) {
  clearInterval(state.timerInterval);
  state.timerInterval = null;
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  state.role = role;
  state.nickname = nickname;
  state.roomCode = code;
  state.roomRef = ref;
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  saveSession();
  // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  state.roomCallback = (snap) => {
    if (state.roomRef !== ref) return;
    if (!snap.exists()) {
      cleanupRoom();
      showScreen('top');
      toast('ルームが閉じられたよ', false);
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      removeExpired(ref, room);
      cleanupRoom();
      showScreen('top');
      toast('このルームは終わったみたい');
      return;
    }
    state.room = room;
    handleRoom(room);
  };
  ref.on('value', state.roomCallback, () => toast('ルームの読み込みに失敗しました'));

  state.connectedRef = db.ref('.info/connected');
  state.connectedCallback = async (snap) => {
    if (!snap.val() || state.roomRef !== ref) return;
    try {
      if (role === 'host') {
        await ref.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: firebase.database.ServerValue.TIMESTAMP });
        await ref.transaction((room) => {
          if (!room || room.hostUid !== firebase.auth().currentUser?.uid) return;
          return { ...room, hostConnected: true, hostDisconnectedAt: null };
        });
      } else {
        const playerRef = ref.child('players/' + nickname);
        await playerRef.onDisconnect().remove();
        await ref.transaction((room) => {
          if (!room || isExpired(room)) return;
          const current = room.players?.[nickname];
          const uid = firebase.auth().currentUser?.uid;
          if (current) return;
          // 通信が切れて在室が消えたあとに戻ったとき。遊んでいる途中でも、同じ名前のまま戻る
          return { ...room, players: { ...(room.players || {}), [nickname]: { isHost: false, uid, joinedAt: now() } } };
        });
      }
    } catch (error) {
      console.warn('[kotoba-hiroi] presence recovery failed', error);
      toast('再接続に失敗しました。ページを読み直してね');
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
  state.timerInterval = setInterval(tickTimer, 250);
}

function handleRoom(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす
    if (state.orphanTimer && state.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(state.orphanTimer); state.orphanTimer = null; }
    if (!state.orphanTimer) {
      const at = RoomkRTDB.getHostDisconnectedAt(room);
      state.orphanAt = at;
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - now());
      state.orphanTimer = setTimeout(() => {
        state.orphanTimer = null;
        if (state.roomRef && state.room) removeExpired(state.roomRef, state.room);
      }, delay);
    }
  } else {
    $('hostOffOverlay').hidden = true;
    clearTimeout(state.orphanTimer);
    state.orphanTimer = null;
  }
  render();
  if (state.role === 'host') maybeEnd(room);
}

// ══════════════════════════════════════════════
// 作成・参加・退出
// ══════════════════════════════════════════════
async function createRoom() {
  if (state.busy || state.roomRef) return;
  const nickname = $('hostName').value.trim();
  const error = validNickname(nickname);
  if (error) { setError('createError', error); return; }
  setError('createError', '');
  state.busy = true;
  $('btnCreateRoom').disabled = true;
  try {
    if (!await waitAuth()) return;
    const uid = firebase.auth().currentUser.uid;
    const joinedAt = now();
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
          game: 0,
          settings: { ...DEFAULT_SETTINGS },
          players: { [nickname]: { isHost: true, uid, joinedAt } },
        };
      });
      if (result.committed) {
        window.RoomkStats?.count('room-create');
        connectToRoom('host', nickname, code, ref);
        return;
      }
    }
    setError('createError', 'ルームをつくれませんでした。もう一度ためしてね');
  } catch (error) {
    console.warn('[kotoba-hiroi] create failed', error);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

// ルームコード: 日本語入力のまま打った全角の英数字は半角に、小文字は大文字にそろえて読む（打っている間は書き換えない）
const normalizeRoomCode = (raw) => String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
const roomCodeImeError = (code) => (/[^\x00-\x7F]/.test(code)
  ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）'
  : '');

async function joinRoom() {
  if (state.busy || state.roomRef) return;
  const nickname = $('guestName').value.trim();
  const code = normalizeRoomCode($('joinCode').value);
  const error = validNickname(nickname);
  if (error) { setError('joinError', error); return; }
  const imeError = roomCodeImeError(code);
  if (imeError) { setError('joinError', imeError); return; }
  if (!ROOM_CODE_PATTERN.test(code)) { setError('joinError', 'ルームコードは6文字で入れてね'); return; }
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
    if (!initial) { setError('joinError', 'ルームが見つからないよ。コードを確かめてね'); return; }
    if (isExpired(initial)) {
      await removeExpired(ref, initial);
      setError('joinError', 'このルームは終わったみたい');
      return;
    }
    const uid = firebase.auth().currentUser.uid;
    const joinedAt = now();
    let reason = '';
    const result = await transactRetry(ref, (current) => {
      reason = '';
      if (!current) { reason = '見つからない'; return; }
      if (isExpired(current)) { reason = '終了'; return; }
      // 自分の在室がもう入っている（前の送信が届いていた）ときは、そのまま参加とする
      const own = current.players?.[nickname];
      if (own && !own.isHost && own.uid === uid) return current;
      if (own || current.proxies?.[nickname]) { reason = '名前'; return; }
      if (guestNames(current).length >= MAX_GUESTS) { reason = '満員'; return; }
      // 遊んでいる途中でも入れる（すぐに言葉を出せる）
      return { ...current, players: { ...(current.players || {}), [nickname]: { isHost: false, uid, joinedAt } } };
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
    connectToRoom('guest', nickname, code, ref);
  } catch (error) {
    console.warn('[kotoba-hiroi] join failed', error);
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
  if (!await waitAuth()) return false;
  const uid = firebase.auth().currentUser?.uid;
  if (!uid || uid !== saved.uid) return false;
  const ref = db.ref(DB_PREFIX + '/' + saved.roomCode);
  try {
    const snap = await ref.get();
    if (!snap.exists()) return false;
    const room = snap.val();
    if (isExpired(room)) { await removeExpired(ref, room); return false; }
    if (saved.role === 'host') {
      if (room.host !== saved.nickname || room.hostUid !== uid) return false;
    } else if (saved.role === 'guest') {
      const player = room.players?.[saved.nickname];
      if (player && (player.isHost || player.uid !== uid)) return false;
    } else {
      return false;
    }
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref);
    return true;
  } catch (error) {
    console.warn('[kotoba-hiroi] reconnect failed', error);
    return false;
  }
}

async function leaveRoom() {
  if (state.busy || !state.roomRef) return;
  state.busy = true;
  const ref = state.roomRef;
  const role = state.role;
  const nickname = state.nickname;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 退出した人の見つけた言葉は、ボードと結果に残す
      await ref.transaction((room) => {
        if (!room) return undefined;
        const next = { ...room, players: { ...(room.players || {}) } };
        delete next.players[nickname];
        return next;
      });
    }
  } catch (error) {
    console.warn('[kotoba-hiroi] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.busy = false;
    return;
  }
  cleanupRoom();
  showScreen('top');
  state.busy = false;
}

// ══════════════════════════════════════════════
// ホストの操作
// ══════════════════════════════════════════════
const isMyRoom = (room) => room && room.hostUid === firebase.auth().currentUser?.uid;
async function hostTx(update, failMessage) {
  if (state.role !== 'host' || !state.roomRef) return null;
  try {
    return await state.roomRef.transaction((room) => (isMyRoom(room) ? update(room) : undefined));
  } catch (error) {
    console.warn('[kotoba-hiroi] host action failed', error);
    if (failMessage) toast(failMessage);
    return null;
  }
}
function setSetting(key, value) {
  hostTx((room) => {
    if (room.status !== STATUS.WAITING) return undefined;
    return { ...room, settings: { ...settingsOf(room), [key]: value } };
  }, '設定を変えられませんでした。もう一度ためしてね');
}
async function setHostPlays(checked) {
  const input = $('setHostPlays');
  input.disabled = true;
  await hostTx((room) => (room.status === STATUS.WAITING
    ? { ...room, settings: { ...settingsOf(room), hostPlays: !!checked } }
    : undefined), '設定を変えられませんでした。もう一度ためしてね');
  input.disabled = false;
  if (state.room) input.checked = hostPlaysOf(state.room);
}
async function addProxy() {
  const name = $('proxyName').value.trim();
  const error = validNickname(name);
  if (error) { setError('proxyError', error); return; }
  let reason = '';
  const result = await hostTx((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING) return undefined;
    if (room.players?.[name] || room.proxies?.[name]) { reason = 'その名前は使われているよ。少し変えてみてね'; return undefined; }
    if (proxyNames(room).length >= MAX_PROXIES) { reason = `端末なしの参加者は${MAX_PROXIES}人までだよ`; return undefined; }
    return { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: now() } } };
  }, '足せませんでした。もう一度ためしてね');
  if (result?.committed) {
    // 届くのを待つあいだに次の名前を打ちはじめていたら、消さない
    if ($('proxyName').value.trim() === name) $('proxyName').value = '';
    setError('proxyError', '');
  } else if (reason) {
    setError('proxyError', reason);
  }
}
function removeProxy(name) {
  hostTx((room) => {
    if (room.status !== STATUS.WAITING || !room.proxies?.[name]) return undefined;
    const proxies = { ...room.proxies };
    delete proxies[name];
    return { ...room, proxies };
  }, '外せませんでした。もう一度ためしてね');
}
function newQ(room, idx) {
  const p = PUZ[room.order[idx]];
  const limit = settingsOf(room).limit;
  const startAt = now();
  return { idx, tiles: shuffle(p.tiles), startAt, endAt: limit ? startAt + limit * 1000 : 0, ended: false };
}
async function startGame() {
  if (state.busy) return;
  state.busy = true;
  let count = 0;
  let mode = '';
  const result = await hostTx((room) => {
    if (room.status !== STATUS.WAITING) return undefined;
    const players = playerNames(room);
    if (!players.length) return undefined;
    count = players.length;
    const settings = settingsOf(room);
    mode = settings.mode;
    const order = shuffle(poolOf(settings.level)).slice(0, countOf(settings)).map((p) => p.id);
    const next = {
      ...room, status: STATUS.PLAY, game: (Number(room.game) || 0) + 1, settings, order,
      found: null, pending: null, extra: null, hints: null,
    };
    next.q = newQ(next, 0);
    return next;
  }, 'はじめられませんでした。もう一度ためしてね');
  state.busy = false;
  if (result?.committed) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + count);
    window.RoomkStats?.count('mode-' + mode);
  }
}
const foundOf = (room, idx) => (room.found && room.found[idx]) || {};
const extraOf = (room, idx) => (room.extra && room.extra[idx]) || {};
const pendingOf = (room, idx) => (room.pending && room.pending[idx]) || {};
const hintsOf = (room, idx) => (room.hints && room.hints[idx]) || {};
const puzzleOf = (room) => PUZ[room.order?.[room.q?.idx]];

// ボードの言葉が全部見つかったら、その問題をおしまいにする
function maybeEnd(room) {
  if (room.status !== STATUS.PLAY || room.q.ended) return;
  const p = puzzleOf(room);
  if (!p) return;
  const found = foundOf(room, room.q.idx);
  if (p.answers.every((w) => found[w])) endQ('all');
}
let ending = false;
async function endQ(by) {
  if (ending) return;
  ending = true;
  await hostTx((room) => (room.status === STATUS.PLAY && !room.q.ended
    ? { ...room, q: { ...room.q, ended: true, endedBy: by } }
    : undefined));
  ending = false;
}
function giveHint() {
  hostTx((room) => {
    if (room.status !== STATUS.PLAY || room.q.ended) return undefined;
    const idx = room.q.idx;
    const found = foundOf(room, idx);
    const hints = hintsOf(room, idx);
    const left = PUZ[room.order[idx]].answers.filter((w) => !found[w] && !hints[w]);
    if (!left.length) return undefined;
    const w = left[Math.floor(Math.random() * left.length)];
    return { ...room, hints: { ...(room.hints || {}), [idx]: { ...hints, [w]: true } } };
  });
}
// 一覧にない言葉をたしかめる。OK ならボードのほかの言葉に入れる。ちがうときは、だれの言葉かも出さずに消す
function judge(word, ok) {
  hostTx((room) => {
    if (room.status !== STATUS.PLAY) return undefined;
    const idx = room.q.idx;
    const pend = pendingOf(room, idx);
    if (!pend[word]) return undefined;
    const nextPend = { ...pend };
    delete nextPend[word];
    const next = { ...room, pending: { ...(room.pending || {}), [idx]: nextPend } };
    if (ok && !foundOf(room, idx)[word] && !extraOf(room, idx)[word]) {
      next.extra = { ...(room.extra || {}), [idx]: { ...extraOf(room, idx), [word]: { by: pend[word].by } } };
    }
    return next;
  }, 'うまくいきませんでした。もう一度ためしてね');
}
function nextQ() {
  return hostTx((room) => {
    if (room.status !== STATUS.PLAY || !room.q.ended) return undefined;
    // たしかめていない言葉は、その問題といっしょに流す（だれの言葉かは出さない）
    const pending = { ...(room.pending || {}) };
    delete pending[room.q.idx];
    if (room.q.idx + 1 >= room.order.length) return { ...room, status: STATUS.RESULT, pending };
    const next = { ...room, pending };
    next.q = newQ(next, room.q.idx + 1);
    return next;
  }, '進めませんでした。もう一度ためしてね');
}
async function backToLobby() {
  const result = await hostTx((room) => (room.status === STATUS.RESULT
    ? { ...room, status: STATUS.WAITING, order: null, q: null, found: null, pending: null, extra: null, hints: null }
    : undefined), '進めませんでした。もう一度ためしてね');
  if (result?.committed) window.RoomkStats?.count('again');
}

// ══════════════════════════════════════════════
// 言葉をつくる・出す（自分の画面）
// ══════════════════════════════════════════════
function setFeedback(text, kind = '') {
  state.fb = text;
  state.fbKind = kind;
}
function pressTile(i) {
  const room = state.room;
  const p = room && puzzleOf(room);
  if (!p || state.compose.includes(i) || state.compose.length >= p.len) return;
  state.compose.push(i);
  setFeedback('');
  render();
}
function backTile() { state.compose.pop(); setFeedback(''); render(); }
function clearTiles() { state.compose = []; setFeedback(''); render(); }
function mixTiles() { state.order = shuffle(state.order); render(); }

async function submitWord() {
  const room = state.room;
  if (!room || room.status !== STATUS.PLAY || room.q.ended || state.sending) return;
  const p = puzzleOf(room);
  if (!p || state.compose.length !== p.len) return;
  const who = state.who;
  if (!who || !makersOf(room).includes(who)) return;
  const idx = room.q.idx;
  const word = state.compose.map((i) => room.q.tiles[i]).join('');
  const race = settingsOf(room).mode === 'race';
  state.compose = [];
  const already = foundOf(room, idx)[word] || extraOf(room, idx)[word];
  if (p.ng.includes(word)) { setFeedback('ほかの言葉をさがしてみよう'); render(); return; }
  if (already) {
    setFeedback(!race ? `「${word}」は、もう見つかっている言葉だよ` : (already.by === who ? `「${word}」は、もう見つけた言葉だよ` : `「${word}」は、もうだれかが見つけた言葉だよ`));
    render();
    return;
  }
  if (pendingOf(room, idx)[word]) { setFeedback(`「${word}」は、いまたしかめ中だよ`); render(); return; }
  state.sending = true;
  render();
  const answer = p.answers.includes(word);
  const path = `${answer ? 'found' : 'pending'}/${idx}/${word}`;
  try {
    const result = await state.roomRef.child(path).transaction((cur) => (cur ? undefined : { by: who, at: now() }));
    if (answer) {
      if (result.committed) setFeedback(`見つけた！「${word}」`, 'hit');
      else setFeedback(race ? `「${word}」は、ひと足先にだれかが見つけたよ` : `「${word}」は、もう見つかっている言葉だよ`);
    } else {
      setFeedback(result.committed ? `「${word}」はボードにない言葉だよ。みんなでたしかめよう` : `「${word}」は、いまたしかめ中だよ`);
    }
  } catch (error) {
    console.warn('[kotoba-hiroi] submit failed', error);
    toast('送れませんでした。もう一度ためしてね');
  }
  state.sending = false;
  render();
}

// 制限時間の表示（みんな）と、時間切れでおしまいにする（ホスト）
function tickTimer() {
  const room = state.room;
  const Q = room && room.status === STATUS.PLAY ? room.q : null;
  const on = !!(Q && Q.endAt && !Q.ended);
  $('pTimer').hidden = !on;
  if (!on) return;
  const rest = Math.max(0, Q.endAt - now());
  const sec = Math.ceil(rest / 1000);
  $('pTimerText').textContent = sec >= 60 ? `のこり ${Math.floor(sec / 60)}分${sec % 60 ? `${sec % 60}秒` : ''}` : `のこり ${sec} 秒`;
  $('pTimerBar').style.width = `${Math.min(100, (rest / (settingsOf(room).limit * 1000)) * 100)}%`;
  if (state.role === 'host' && rest <= 0) endQ('time');
}

// ══════════════════════════════════════════════
// 画面
// ══════════════════════════════════════════════
function segButtons(box, entries, current, onPick) {
  box.textContent = '';
  entries.forEach(([value, label]) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === current));
    b.addEventListener('click', () => onPick(value));
    box.appendChild(b);
  });
}
const limitLabel = (n) => (n ? `${n / 60}分` : '決めない');
function ruleText(room) {
  const s = settingsOf(room);
  return `遊び方: ${MODES[s.mode].label}／むずかしさ: ${LEVELS[s.level].label}／${countOf(s)}問／制限時間: ${limitLabel(s.limit)}`;
}
function render() {
  const room = state.room;
  if (!room || !state.roomRef) return;
  if (room.status === STATUS.WAITING) return renderLobby(room);
  if (room.status === STATUS.PLAY) return renderPlay(room);
  if (room.status === STATUS.RESULT) return renderResult(room);
  return undefined;
}
function renderLobby(room) {
  state.pkey = null;
  if (state.currentScreen !== 'lobby') showScreen('lobby');
  const host = state.role === 'host';
  const s = settingsOf(room);
  const plays = hostPlaysOf(room);
  const ul = $('lobbyPlayers');
  ul.textContent = '';
  const names = [room.host].filter((n) => room.players?.[n]).concat(guestNames(room).sort((a, b) => (room.players[a].joinedAt || 0) - (room.players[b].joinedAt || 0)));
  names.forEach((n) => {
    const li = el('li', null, n);
    if (n === room.host) li.append(el('small', null, plays ? 'ホスト' : '進行役'));
    ul.append(li);
  });
  // 端末なしの参加者。印と「外す」はホストの画面にだけ出す
  proxyNames(room).forEach((n) => {
    const li = el('li', null, n);
    if (host) {
      li.append(el('small', null, '端末なし'));
      const b = el('button', 'khi-players__remove', '外す');
      b.type = 'button';
      b.setAttribute('aria-label', `${n}を外す`);
      b.addEventListener('click', () => removeProxy(n));
      li.append(b);
    }
    ul.append(li);
  });
  $('hostPlaysField').hidden = !host;
  $('proxyBox').hidden = !host;
  $('lobbyWait').hidden = host;
  $('lobbyHost').hidden = !host;
  $('lobbyInfo').hidden = host;
  $('lobbyRule').textContent = ruleText(room);
  if (!host) return;
  $('setHostPlays').checked = plays;
  segButtons($('modeOpts'), Object.entries(MODES).map(([k, v]) => [k, v.label]), s.mode, (v) => setSetting('mode', v));
  $('modeNote').textContent = MODES[s.mode].note;
  segButtons($('levelOpts'), Object.entries(LEVELS).map(([k, v]) => [k, v.label]), s.level, (v) => setSetting('level', v));
  $('levelNote').textContent = LEVELS[s.level].note;
  segButtons($('countOpts'), COUNTS.map((n) => [n, `${n}問`]), s.count, (v) => setSetting('count', v));
  $('countNote').textContent = countOf(s) < s.count ? `${LEVELS[s.level].label}の問題は${countOf(s)}問だよ` : '';
  segButtons($('limitOpts'), LIMITS.map((n) => [n, limitLabel(n)]), s.limit, (v) => setSetting('limit', v));
  $('limitNote').textContent = s.limit ? `${limitLabel(s.limit)}たつと、のこりのこたえが出るよ` : 'ボードが全部うまるか、ホストが「のこりのこたえを出す」を押すまで続くよ';
  const count = playerNames(room).length;
  $('btnStart').disabled = count < 1;
  $('startNote').textContent = count < 1 ? '遊ぶ人が入るのを待ってね（ホストが遊ぶときは「自分も遊ぶ」）' : `遊ぶ人は${count}人`;
}
// 個人戦で、名前ごとの見つけた数（ボードの言葉と、OK になったほかの言葉）
function countsOf(room) {
  const counts = {};
  (room.order || []).forEach((_, i) => {
    [foundOf(room, i), extraOf(room, i)].forEach((m) => Object.values(m).forEach((v) => { if (v && v.by) counts[v.by] = (counts[v.by] || 0) + 1; }));
  });
  return counts;
}
function slotItem(word, cls, shown, hintFirst) {
  const li = el('li', 'khi-slot' + (cls ? ' ' + cls : ''));
  if (shown) {
    li.append(el('span', 'khi-slot__word', word));
  } else {
    const chars = Array.from(word);
    chars.forEach((c, i) => li.append(el('span', 'khi-cell' + (hintFirst && i === 0 ? ' is-hint' : ''), hintFirst && i === 0 ? c : '')));
    li.setAttribute('aria-label', hintFirst ? `${chars[0]}ではじまる${chars.length}文字の言葉` : `まだ見つかっていない${chars.length}文字の言葉`);
  }
  return li;
}
function renderPlay(room) {
  if (state.currentScreen !== 'play') showScreen('play');
  const Q = room.q;
  const idx = Q.idx;
  const p = puzzleOf(room);
  if (!p) return;
  const host = state.role === 'host';
  const s = settingsOf(room);
  const race = s.mode === 'race';
  const found = foundOf(room, idx);
  const extra = extraOf(room, idx);
  const pend = pendingOf(room, idx);
  const hints = hintsOf(room, idx);
  // 問題が変わったら、自分の画面のものを最初にもどす
  const pkey = `${room.game}:${idx}`;
  if (state.pkey !== pkey) {
    state.pkey = pkey;
    state.order = Q.tiles.map((_, i) => i);
    state.compose = [];
    setFeedback('');
  }
  const makers = makersOf(room);
  if (!makers.includes(state.who)) state.who = makers[0] || null;

  $('pNo').textContent = `${idx + 1} / ${room.order.length} 問め`;
  $('pMode').textContent = MODES[s.mode].label;
  const counts = countsOf(room);
  $('pMeBox').hidden = !(race && iPlay(room));
  $('pMe').textContent = String(counts[state.nickname] || 0);

  // ボード
  const nFound = p.answers.filter((w) => found[w]).length;
  $('pBoardHead').textContent = `${p.len}文字の言葉　${nFound} / ${p.answers.length} こ見つかった`;
  const slots = $('pSlots');
  slots.textContent = '';
  p.answers.slice().sort(byKana).forEach((w) => {
    const f = found[w];
    if (f) slots.append(slotItem(w, race && f.by === state.nickname ? 'is-found is-mine' : 'is-found', true));
    else if (Q.ended) slots.append(slotItem(w, 'is-open', true));
    else slots.append(slotItem(w, '', false, !!hints[w]));
  });
  const extras = Object.keys(extra).sort(byKana);
  $('pExtraBox').hidden = !extras.length;
  const ex = $('pExtra');
  ex.textContent = '';
  extras.forEach((w) => ex.append(el('li', race && extra[w].by === state.nickname ? 'is-mine' : null, w)));
  // たしかめ中の言葉は、だれの言葉かを出さない
  const pends = Object.keys(pend).sort(byKana);
  $('pPendBox').hidden = !pends.length;
  const pe = $('pPend');
  pe.textContent = '';
  pends.forEach((w) => pe.append(el('li', null, w)));
  const done = $('pDone');
  done.hidden = !Q.ended;
  done.className = 'khi-done' + (Q.endedBy === 'all' ? ' is-clear' : '');
  done.textContent = Q.endedBy === 'all' ? (race ? '全部見つかったよ！' : '全部うまった！ クリア！') : (Q.endedBy === 'time' ? '時間になったよ。のこりのこたえはこれ' : 'のこりのこたえはこれだったよ');

  // 言葉をつくる
  const canMake = makers.length > 0 && !Q.ended;
  $('pMaker').hidden = !canMake;
  if (canMake) {
    const whoBox = $('pWhoBox');
    whoBox.hidden = !(host && proxyNames(room).length);
    if (!whoBox.hidden) {
      segButtons($('pWho'), makers.map((n) => [n, n === state.nickname ? `${n}（自分）` : n]), state.who, (v) => { state.who = v; clearTiles(); });
    }
    $('pAsk').textContent = host && state.who !== state.nickname ? `${state.who}の言葉をつくろう（${p.len}文字）` : `${p.len}文字の言葉をつくろう`;
    const comp = $('pCompose');
    comp.textContent = '';
    for (let i = 0; i < p.len; i += 1) {
      const t = state.compose[i];
      comp.append(el('span', 'khi-cell khi-cell--big' + (t != null ? ' is-filled' : ''), t != null ? Q.tiles[t] : ''));
    }
    comp.setAttribute('aria-label', state.compose.length ? `つくっている言葉: ${state.compose.map((i) => Q.tiles[i]).join('')}` : `${p.len}文字の言葉をつくる場所`);
    const tiles = $('pTiles');
    tiles.textContent = '';
    state.order.forEach((i) => {
      const used = state.compose.includes(i);
      const b = el('button', 'khi-tile' + (used ? ' is-used' : ''), Q.tiles[i]);
      b.type = 'button';
      b.disabled = used || state.compose.length >= p.len;
      b.addEventListener('click', () => pressTile(i));
      tiles.append(b);
    });
    $('btnBack').disabled = !state.compose.length;
    $('btnClear').disabled = !state.compose.length;
    $('btnSubmit').disabled = state.compose.length !== p.len || state.sending;
    const fb = $('pFeedback');
    fb.textContent = state.fb;
    fb.className = 'khi-feedback' + (state.fbKind === 'hit' ? ' is-hit' : '');
  }

  // ホスト
  $('pHost').hidden = !host;
  const wait = $('pWait');
  wait.hidden = host || !Q.ended;
  wait.textContent = 'ホストがつぎへ進むのを待っているよ';
  if (host) {
    $('pCheckBox').hidden = !pends.length;
    const ck = $('pCheck');
    ck.textContent = '';
    pends.forEach((w) => {
      const li = el('li', 'khi-judge__item');
      li.append(el('span', 'khi-judge__word', w));
      const okb = el('button', 'btn btn-secondary khi-btn-sub', 'OK');
      okb.type = 'button';
      okb.setAttribute('aria-label', `「${w}」をOKにする`);
      okb.addEventListener('click', () => judge(w, true));
      const ngb = el('button', 'btn btn-ghost khi-btn-sub', 'ちがうみたい');
      ngb.type = 'button';
      ngb.setAttribute('aria-label', `「${w}」をちがうことにする`);
      ngb.addEventListener('click', () => judge(w, false));
      li.append(okb, ngb);
      ck.append(li);
    });
    const leftNoHint = p.answers.filter((w) => !found[w] && !hints[w]).length;
    $('btnHint').hidden = Q.ended;
    $('btnHint').disabled = !leftNoHint;
    $('btnOpen').hidden = Q.ended;
    $('btnNext').hidden = !Q.ended;
    $('btnNext').textContent = idx + 1 >= room.order.length ? '結果を見る' : 'つぎの問題へ';
    $('pHostNote').textContent = Q.ended ? '' : 'ヒントは、まだのマスの最初の文字を1つ出すよ';
  }
}
function renderResult(room) {
  state.pkey = null;
  if (state.currentScreen !== 'result') showScreen('result');
  const race = settingsOf(room).mode === 'race';
  const me = state.nickname;
  const counts = countsOf(room);
  const list = $('resList');
  list.textContent = '';
  let total = 0;
  (room.order || []).forEach((id, i) => {
    const p = PUZ[id];
    if (!p) return;
    const found = foundOf(room, i);
    const extra = extraOf(room, i);
    const box = el('div', 'khi-res');
    box.append(el('p', 'khi-res__tiles', p.tiles.join(' ')));
    const ul = el('ul', 'khi-chips');
    p.answers.slice().sort(byKana).forEach((w) => {
      const f = found[w];
      if (f) total += 1;
      ul.append(el('li', f ? (race && f.by === me ? 'is-mine' : 'is-hit') : 'is-miss', w));
    });
    Object.keys(extra).sort(byKana).forEach((w) => {
      total += 1;
      ul.append(el('li', race && extra[w].by === me ? 'is-mine' : 'is-hit', w));
    });
    box.append(ul);
    list.append(box);
  });
  const main = $('resMain');
  const peopleBox = $('resPeopleBox');
  if (!race) {
    main.textContent = total ? `みんなで ${total} こ 見つけたよ` : '';
    peopleBox.hidden = true;
  } else {
    // 個人戦（2026-11-25 オーナー「取った数を並べる」）。多い順に並べる。順位の数字はつけず、0この人は並べない
    const mine = counts[me] || 0;
    main.textContent = iPlay(room) && mine ? `あなたは ${mine} こ 見つけたよ` : '';
    const people = Object.entries(counts).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    peopleBox.hidden = !people.length;
    const pl = $('resPeople');
    pl.textContent = '';
    people.forEach(([name, v]) => {
      const li = el('li', name === me ? 'is-me' : null);
      li.append(el('span', 'khi-people__name', name), el('span', 'khi-people__n', `${v} こ`));
      pl.append(li);
    });
  }
  $('btnAgain').hidden = state.role !== 'host';
  $('resWait').hidden = state.role === 'host';
}

// ══════════════════════════════════════════════
// はじめる
// ══════════════════════════════════════════════
$('btnGoCreate').addEventListener('click', () => { showScreen('create'); $('hostName').focus(); });
$('btnGoJoin').addEventListener('click', () => { $('joinLinkHint').hidden = true; showScreen('join'); $('guestName').focus(); });
$('btnCreateBack').addEventListener('click', () => showScreen('top'));
$('btnJoinBack').addEventListener('click', () => showScreen('top'));
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);
$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
$('btnCopyLink').addEventListener('click', (event) => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) { toast('ルームコードがありません'); return; }
  RoomkRTDB.copyRoomLink(state.roomCode, event.currentTarget);
});
$('btnShowQr').addEventListener('click', () => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) { toast('ルームコードがありません'); return; }
  RoomkQR.show(state.roomCode);
});
$('setHostPlays').addEventListener('change', (event) => setHostPlays(event.currentTarget.checked));
$('btnAddProxy').addEventListener('click', addProxy);
$('proxyName').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) addProxy(); });
$('btnStart').addEventListener('click', startGame);
$('btnBack').addEventListener('click', backTile);
$('btnClear').addEventListener('click', clearTiles);
$('btnMix').addEventListener('click', mixTiles);
$('btnSubmit').addEventListener('click', submitWord);
$('btnHint').addEventListener('click', giveHint);
$('btnOpen').addEventListener('click', () => endQ('host'));
$('btnNext').addEventListener('click', nextQ);
$('btnAgain').addEventListener('click', backToLobby);

// 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう
function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}
function resumeFromSession() {
  tryReconnect().then((reconnected) => {
    if (!reconnected) {
      sessionStorage.removeItem(SESSION_KEY);
      showScreen('top');
    }
  });
}
showScreen('top');
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam !== null) {
  const linkCode = normalizeRoomCode(roomParam);
  const saved = loadSession();
  if (!ROOM_CODE_PATTERN.test(linkCode)) {
    toast('ルームコードが正しくないよ');
    history.replaceState(null, '', location.pathname);
    resumeFromSession();
  } else if (saved && saved.roomCode === linkCode) {
    tryReconnect().then((reconnected) => {
      if (reconnected || state.roomRef) return;
      sessionStorage.removeItem(SESSION_KEY);
      openJoinFromLink(linkCode);
    });
  } else {
    if (saved) sessionStorage.removeItem(SESSION_KEY);
    openJoinFromLink(linkCode);
  }
} else {
  resumeFromSession();
}
