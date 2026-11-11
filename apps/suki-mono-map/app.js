/* 好きなものマップ
   好きなジャンル（動物・ゲーム など）と、その中の好きなもの（犬・猫 など）を選んで、自分のマップを作る。
   マップの「＋」を押すとポップアップで選ぶ。× を押すと消える。できたら1人ずつ見せあう。
   ホストの操作はルームの transaction（hostUid を確かめる）。自分のマップも、参加する人がルームの transaction で書く。
   点数・順位・人どうしの比べっこ（同じものを選んだ人・人気のもの）は出さない。 */

const DATA = window.SUKI_MONO_MAP_DATA;
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'sukimonomap_rooms';
const SESSION_KEY = 'sukimonomap_session';
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const MAX_GUESTS = 12;
const STATUS = { WAITING: 'waiting', PICK: 'pick', SHOW: 'show' };

const FREE_MAX = 12;       // 「自分で書く」の文字数
const FREE_PER_GENRE = 3;  // 1つのジャンルに書き足せる数
const PROXY_MAX = 4;       // 端末なしの参加者を足せる数
const SEND_MS = 350;       // 選んだものをまとめて送るまでの間
const MAX_OPTS = [[3, '3つまで'], [5, '5つまで'], [0, 'いくつでも']];
const DEFAULT_SETTINGS = { hostPlays: true, maxGenres: 3 };

const $ = (id) => document.getElementById(id);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const pick1 = (a) => a[Math.floor(Math.random() * a.length)];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (name) => { const s = el('span', 'material-symbols-rounded', name); s.setAttribute('aria-hidden', 'true'); return s; };
const now = () => RoomkRTDB.now();
const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const genreOf = (id) => DATA.genres.find((g) => g.id === id);
const genreStyle = (g) => `--c:${g.color};--p:${g.pale};--i:${g.ink}`;
const settingsOf = (room) => ({ ...DEFAULT_SETTINGS, ...(room?.settings || {}) });
const hostPlaysOf = (room) => settingsOf(room).hostPlays !== false;
const maxOf = (room) => Number(settingsOf(room).maxGenres) || DATA.genres.length;
const emptyMap = () => ({ genres: [], items: {}, done: false, share: true });

// 届いたマップを、知っているジャンル・文字数の範囲に整える（RTDB は空の配列を持てないので、無い所は空として読む）
function cleanMap(m, max) {
  const out = emptyMap();
  if (!m || typeof m !== 'object') return out;
  const gs = arr(m.genres).filter((id, i, a) => genreOf(id) && a.indexOf(id) === i);
  out.genres = max ? gs.slice(0, max) : gs;
  out.genres.forEach((id) => {
    const g = genreOf(id);
    const seen = new Set();
    let free = 0;
    out.items[id] = arr(m.items && m.items[id]).map((t) => clean(t, FREE_MAX)).filter((t) => {
      if (!t || seen.has(t)) return false;
      if (!g.items.includes(t)) { free += 1; if (free > FREE_PER_GENRE) return false; }
      seen.add(t);
      return true;
    });
  });
  out.done = !!m.done;
  out.share = m.share !== false;
  return out;
}

// ══════════════════════════════════════════════
// 状態
// ══════════════════════════════════════════════
let lastStatus = null; // 前に描いた status（変わったらポップアップを閉じて上にもどす）
const state = {
  role: null,
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  currentScreen: null,
  timerInterval: null,
  orphanTimer: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  busy: false,
  // 作っている途中のマップ（この画面だけ。キーは「回:選ぶ時間の番号:名前」。ホストは端末なしの参加者の分も持つ）
  picks: {},
  sendTimers: {},   // 名前ごとの、送るまでのタイマー
  target: null,     // いま作っているのはだれの分か
  pop: null,        // ひらいているポップアップ（null・'add'＝ジャンルを足す・ジャンルのid＝その中身を選ぶ）
  freeOpen: false,  // 「自分で書く」を開いているか
  confirmDel: false, // ジャンルを消す前の確かめを出しているか
  shownKeys: {},    // マップの図ごとに、前に描いた点（新しく出た点だけ動かす）
};

function showScreen(id) {
  document.querySelectorAll('.sm-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
  document.querySelector('.sm-wrap').classList.toggle('is-top', id === 'top');
  if (id !== 'pick') syncPop(null);
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
const proxyNames = (room) => Object.entries(room.proxies || {}).sort((a, b) => (a[1].addedAt || 0) - (b[1].addedAt || 0)).map(([n]) => n);
// マップを作る人（進行だけのホストは含めない。端末なしの参加者は含める）。参加した順
function makerNames(room) {
  const plays = hostPlaysOf(room);
  const players = Object.entries(room.players || {})
    .filter(([, p]) => !p.isHost || plays)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([n]) => n);
  return players.concat(proxyNames(room));
}
// この回のマップ（前の回の残りは読まない）
const mapOf = (room, name) => { const m = room.maps?.[name]; return m && m.r === room.round ? m : null; };
const doneNames = (room) => makerNames(room).filter((n) => mapOf(room, n)?.done);

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
    console.warn('[suki-mono-map] expired room cleanup failed', error);
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

function resetDrafts() {
  Object.values(state.sendTimers).forEach((t) => clearTimeout(t));
  state.sendTimers = {};
  state.picks = {};
  state.target = null;
  state.pop = null;
  state.freeOpen = false;
  state.confirmDel = false;
  state.shownKeys = {};
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
  });
  resetDrafts();
  syncPop(null);
  lastStatus = null;
  sessionStorage.removeItem(SESSION_KEY);
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
}

function connectToRoom(role, nickname, code, ref) {
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
          if (room.players?.[nickname]) return;
          const uid = firebase.auth().currentUser?.uid;
          // 通信が切れて在室が消えたあとに戻ったとき。同じ名前のまま戻る（マップは名前で持っている）
          return { ...room, players: { ...(room.players || {}), [nickname]: { isHost: false, uid, joinedAt: now() } } };
        });
      }
    } catch (error) {
      console.warn('[suki-mono-map] presence recovery failed', error);
      toast('再接続に失敗しました。ページを読み直してね');
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
}

function handleRoom(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    if (!state.orphanTimer) {
      const at = RoomkRTDB.getHostDisconnectedAt(room);
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
          round: 0,
          seq: 0,
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
    console.warn('[suki-mono-map] create failed', error);
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
      // 端末なしの参加者と同じ名前も使えない
      if (own || current.proxies?.[nickname]) { reason = '名前'; return; }
      if (guestNames(current).length >= MAX_GUESTS) { reason = '満員'; return; }
      // 作っている途中・見せあいの途中でも入れる
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
    console.warn('[suki-mono-map] join failed', error);
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
      if (!player && room.proxies?.[saved.nickname]) return false;
    } else {
      return false;
    }
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref);
    return true;
  } catch (error) {
    console.warn('[suki-mono-map] reconnect failed', error);
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
      // 作ったマップは残す（見せあいで出る）
      await ref.child('players/' + nickname).remove();
    }
  } catch (error) {
    console.warn('[suki-mono-map] leave failed', error);
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
    console.warn('[suki-mono-map] host action failed', error);
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
  await hostTx((room) => (room.status === STATUS.WAITING ? { ...room, settings: { ...settingsOf(room), hostPlays: checked } } : undefined),
    '設定を変えられませんでした。もう一度ためしてね');
  input.disabled = false;
}
// 端末なしの参加者（ホストが代わりに作る）
async function addProxy() {
  const name = $('proxyName').value.trim();
  const error = validNickname(name);
  if (error) { setError('proxyError', error); return; }
  let reason = '';
  const result = await hostTx((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING) return undefined;
    if (room.players?.[name] || room.proxies?.[name]) { reason = 'その名前は使われているよ。少し変えてみてね'; return undefined; }
    if (Object.keys(room.proxies || {}).length >= PROXY_MAX) { reason = `足せるのは${PROXY_MAX}人までだよ`; return undefined; }
    return { ...room, proxies: { ...(room.proxies || {}), [name]: { addedAt: now() } } };
  }, '足せませんでした。もう一度ためしてね');
  if (result?.committed) {
    // 確定を待つあいだに次の名前を打ちはじめていたら、消さない
    if ($('proxyName').value.trim() === name) $('proxyName').value = '';
    setError('proxyError', '');
  } else if (reason) setError('proxyError', reason);
}
function removeProxy(name) {
  hostTx((room) => {
    if (room.status !== STATUS.WAITING || !room.proxies?.[name]) return undefined;
    const proxies = { ...room.proxies };
    delete proxies[name];
    return { ...room, proxies };
  }, '外せませんでした。もう一度ためしてね');
}
// 待合室 → 作る（新しい回。前のマップは消す）
async function startGame() {
  let n = 0;
  const result = await hostTx((room) => {
    if (room.status !== STATUS.WAITING) return undefined;
    n = makerNames(room).length;
    if (n < 1) return undefined;
    return { ...room, status: STATUS.PICK, round: (room.round || 0) + 1, seq: 0, maps: null, show: null, shown: null };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (result?.committed) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count(`players-${n}`);
  }
}
// 見せあう順番（みんなに出すと選んだ人の、中身のあるマップだけ）
function showOrder(room) {
  return makerNames(room).filter((n) => { const m = mapOf(room, n); return m && m.share !== false && arr(m.genres).length; });
}
function askFor(room, name) {
  const mp = cleanMap(mapOf(room, name));
  const all = [];
  mp.genres.forEach((gid) => mp.items[gid].forEach((x) => all.push(x)));
  // くわしく選んでいないときは、ジャンルの中で何が好きかをきく
  if (!all.length && mp.genres.length) return `「${genreOf(pick1(mp.genres)).label}」だと、どんなのが好き？`;
  if (!all.length) return '';
  return pick1(DATA.asks).replace('{x}', `「${pick1(all)}」`);
}
async function startShow() {
  let first = false;
  const result = await hostTx((room) => {
    if (room.status !== STATUS.PICK) return undefined;
    first = !room.shown;
    const order = showOrder(room);
    return { ...room, status: STATUS.SHOW, shown: true, show: { order: order.length ? order : null, idx: 0, ask: order.length ? askFor(room, order[0]) : '' } };
  }, '見せあいをはじめられませんでした。もう一度ためしてね');
  if (result?.committed && first) window.RoomkStats?.count('finish');
}
function jumpShow(to) {
  hostTx((room) => {
    if (room.status !== STATUS.SHOW) return undefined;
    const order = arr(room.show?.order);
    if (!order.length) return undefined;
    const idx = typeof to === 'function' ? to(room.show.idx || 0, order.length) : to;
    if (!order[idx]) return undefined;
    return { ...room, show: { ...room.show, idx, ask: askFor(room, order[idx]) } };
  });
}
function rerollAsk() {
  hostTx((room) => {
    if (room.status !== STATUS.SHOW) return undefined;
    const order = arr(room.show?.order);
    const name = order[room.show?.idx || 0];
    if (!name) return undefined;
    let ask = room.show.ask;
    for (let i = 0; i < 6 && ask === room.show.ask; i += 1) ask = askFor(room, name);
    return { ...room, show: { ...room.show, ask } };
  });
}
// 見せあい → もう一度作る時間（マップは残して「できた」だけ外す）
function backToPick() {
  hostTx((room) => {
    if (room.status !== STATUS.SHOW) return undefined;
    const maps = {};
    Object.entries(room.maps || {}).forEach(([n, m]) => { maps[n] = { ...m, done: false }; });
    return { ...room, status: STATUS.PICK, seq: (room.seq || 0) + 1, maps, show: null };
  }, 'もどせませんでした。もう一度ためしてね');
}
// 見せあい → 待合室（マップは消す）
async function backToLobby() {
  const result = await hostTx((room) => {
    if (room.status !== STATUS.SHOW) return undefined;
    return { ...room, status: STATUS.WAITING, maps: null, show: null, shown: null };
  }, 'もどせませんでした。もう一度ためしてね');
  if (result?.committed) window.RoomkStats?.count('again');
}

// ══════════════════════════════════════════════
// マップの図（SVG）
// ══════════════════════════════════════════════
const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, text) => {
  const e = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
};
// 文字の幅のおおよそ（全角1文字＝1、半角＝0.6）
const textW = (t, size) => Array.from(t).reduce((w, c) => w + (/[\x20-\x7e]/.test(c) ? 0.6 : 1), 0) * size;

// name: まん中の名前。mp: マップ。box: 描く場所。keyId: 新しく出た点を見分けるための名前
// edit: 押して編集するとき { canAdd, selected, onAdd, onGenre(gid), onLeaf(gid, text) }。ジャンルごとの「＋」も onGenre を呼ぶ
function drawMap(box, name, mp, keyId, edit) {
  box.textContent = '';
  const genres = mp ? mp.genres : [];
  const nG = genres.length;
  // せまい画面では枝を短くして、そのぶん文字を大きく見せる
  const K = box.clientWidth > 0 && box.clientWidth < 520 ? 0.78 : 1;
  const R1 = (nG <= 1 ? 130 : nG <= 3 ? 165 : nG <= 6 ? 215 : 280) * K;
  const nodes = [];  // { x, y, kind, label, icon, key, hw, hh }
  const lines = [];  // { from, to, kind, key }（from・to は nodes の点）
  const me = { x: 0, y: 0, kind: 'me', label: name, key: 'me' };
  const meW = Math.max(96, textW(name, 22) + 36);
  // まん中の名前と重ならない距離（横に並ぶときは幅のぶん遠くする）
  const reach = (a, w, h) => Math.max(R1, Math.min((meW / 2 + w / 2 + 34) / Math.max(0.001, Math.abs(Math.cos(a))), (30 + h / 2 + 34) / Math.max(0.001, Math.abs(Math.sin(a)))));
  nodes.push(me);
  const slots = nG + (edit && edit.canAdd ? 1 : 0); // 「＋」も枝の1つとして並べる
  const per = slots ? (Math.PI * 2) / slots : 0;
  const a0 = slots === 2 ? Math.PI : -Math.PI / 2; // 2つのときは左右に広げる
  genres.forEach((gid, gi) => {
    const g = genreOf(gid);
    const a = a0 + per * gi;
    const gr = reach(a, textW(g.label, 18) + 62, 48);
    const gn = { x: Math.cos(a) * gr, y: Math.sin(a) * gr, kind: 'genre', label: g.label, icon: g.icon, key: `g:${gid}`, g, gid };
    nodes.push(gn);
    lines.push({ from: me, to: gn, kind: 'genre', key: `lg:${gid}`, g });
    const items = ((mp.items && mp.items[gid]) || []).slice();
    if (edit) items.push(null); // さいごに「＋」を1つ並べる
    const k = items.length;
    // 葉は、ジャンルから外向きに扇形に広げる。多いときは2列にする
    const spread = Math.min(nG >= 3 ? per * 1.15 : 2.6, 0.42 * (k - 1));
    const twoRows = k > 6;
    items.forEach((t, i) => {
      const la = k === 1 ? a : a + spread * (i / (k - 1) - 0.5);
      const r = (124 + (twoRows && i % 2 ? 64 : 0)) * (K < 1 ? 0.85 : 1);
      const ln = t === null
        ? { x: gn.x + Math.cos(la) * (r - 24), y: gn.y + Math.sin(la) * (r - 24), kind: 'plus', label: `${g.label}に足す`, key: `plus:${gid}`, move: true, g, gid }
        : { x: gn.x + Math.cos(la) * r, y: gn.y + Math.sin(la) * r, kind: 'leaf', label: t, key: `i:${gid}:${t}`, free: !g.items.includes(t), move: true, g, gid };
      nodes.push(ln);
      lines.push({ from: gn, to: ln, kind: t === null ? 'plus' : 'leaf', key: `li:${gid}:${t}`, g });
    });
  });

  // まだ何も選んでいないときは、広がる先をうすく見せる
  if (edit && edit.canAdd) {
    const a = a0 + per * nG;
    const al = nG ? 'ジャンルを足す' : '好きなジャンルを足す';
    const ar = reach(a, textW(al, 17) + 58, 48);
    const an = { x: Math.cos(a) * ar, y: Math.sin(a) * ar, kind: 'add', label: al, key: 'add' };
    nodes.push(an);
    lines.push({ from: me, to: an, kind: 'ghost', key: 'ladd', g: { color: 'currentColor' } });
  }
  if (!nG && !edit) {
    [-150, -30, 90].forEach((deg, i) => {
      const a = (deg * Math.PI) / 180;
      const gh = { x: Math.cos(a) * 130, y: Math.sin(a) * 130, kind: 'ghost', label: '', key: `ghost${i}` };
      nodes.push(gh);
      lines.push({ from: me, to: gh, kind: 'ghost', key: `lghost${i}`, g: { color: 'currentColor' } });
    });
  }

  // 点の大きさ（半分の幅・高さ）
  nodes.forEach((n) => {
    if (n.kind === 'me') { n.w = Math.max(96, textW(n.label, 22) + 36); n.h = 60; }
    else if (n.kind === 'genre') { n.w = textW(n.label, 18) + 62; n.h = 48; }
    else if (n.kind === 'ghost') { n.w = 84; n.h = 44; }
    else if (n.kind === 'add') { n.w = textW(n.label, 17) + 58; n.h = 48; }
    else if (n.kind === 'plus') { n.w = 44; n.h = 44; }
    else { n.w = textW(n.label, 19) + 28 + (edit ? 24 : 0); n.h = 38; }
  });
  // 重なった葉を少しずつ押しのける（まん中とジャンルは動かさない）
  const GAP = 10;
  for (let it = 0; it < 80; it += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const A = nodes[i]; const B = nodes[j];
        if (!A.move && !B.move) continue;
        const ox = (A.w + B.w) / 2 + GAP - Math.abs(A.x - B.x);
        const oy = (A.h + B.h) / 2 + GAP - Math.abs(A.y - B.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        const share = A.move && B.move ? 0.5 : 1;
        if (oy < ox) {
          const d = (A.y <= B.y ? -1 : 1) * oy * share;
          if (A.move) A.y += d;
          if (B.move) B.y -= d;
        } else {
          const d = (A.x <= B.x ? -1 : 1) * ox * share;
          if (A.move) A.x += d;
          if (B.move) B.x -= d;
        }
      }
    }
    if (!moved) break;
  }

  // 図の大きさは、点がぜんぶ入るように決める
  let minX = 0; let maxX = 0; let minY = 0; let maxY = 0;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x - n.w / 2); maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2); maxY = Math.max(maxY, n.y + n.h / 2);
  });
  const pad = 16;
  // 点が少ないうちに大きくなりすぎないよう、図の広さに下限を置く
  const MIN_W = K < 1 ? 400 : 600; const MIN_H = K < 1 ? 300 : 340;
  if (maxX - minX < MIN_W) { const c = (minX + maxX) / 2; minX = c - MIN_W / 2; maxX = c + MIN_W / 2; }
  if (maxY - minY < MIN_H) { const c = (minY + maxY) / 2; minY = c - MIN_H / 2; maxY = c + MIN_H / 2; }
  const root = svg('svg', {
    viewBox: `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    role: edit ? 'group' : 'img',
    'aria-label': `${name}の好きなものマップ`,
  });
  const prev = state.shownKeys[keyId] || new Set();
  const now = new Set();
  const isNew = (key) => { now.add(key); return prev.size > 0 && !prev.has(key); };

  const gLines = svg('g', { class: 'mp-lines' });
  lines.forEach((l) => {
    gLines.appendChild(svg('line', { x1: l.from.x, y1: l.from.y, x2: l.to.x, y2: l.to.y, class: `mp-line mp-line--${l.kind}${isNew(l.key) ? ' is-new' : ''}`, style: `--c:${l.g.color}` }));
  });
  root.appendChild(gLines);

  nodes.forEach((n) => {
    const g = svg('g', { class: `mp-node mp-node--${n.kind}${isNew(n.key) ? ' is-new' : ''}`, transform: `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})` });
    if (n.g) g.setAttribute('style', `--c:${n.g.color};--p:${n.g.pale};--i:${n.g.ink}`);
    if (n.kind === 'me') {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -30, width: n.w, height: 60, rx: 30, class: 'mp-me' }));
      g.appendChild(svg('text', { class: 'mp-me__text', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label));
    } else if (n.kind === 'genre') {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -24, width: n.w, height: 48, rx: 24, class: 'mp-genre' }));
      g.appendChild(svg('text', { class: 'mp-genre__icon', x: -n.w / 2 + 28, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.icon));
      g.appendChild(svg('text', { class: 'mp-genre__text', x: 15, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label));
    } else if (n.kind === 'ghost') {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -22, width: n.w, height: 44, rx: 22, class: 'mp-ghost' }));
    } else if (n.kind === 'plus') {
      g.appendChild(svg('circle', { r: 20, class: 'mp-plus' }));
      g.appendChild(svg('text', { class: 'mp-plus__icon', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'add'));
    } else if (n.kind === 'add') {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -24, width: n.w, height: 48, rx: 24, class: 'mp-add' }));
      g.appendChild(svg('text', { class: 'mp-add__icon', x: -n.w / 2 + 26, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'add_circle'));
      g.appendChild(svg('text', { class: 'mp-add__text', x: 14, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label));
    } else {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -19, width: n.w, height: 38, rx: 18, class: `mp-leaf${n.free ? ' mp-leaf--free' : ''}` }));
      g.appendChild(svg('text', { class: 'mp-leaf__text', x: edit ? -11 : 0, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label));
      if (edit) g.appendChild(svg('text', { class: 'mp-leaf__x', x: n.w / 2 - 17, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'close'));
    }
    // 押して編集する
    if (edit && n.kind !== 'me' && n.kind !== 'ghost') {
      const run = n.kind === 'add' ? edit.onAdd : (n.kind === 'genre' || n.kind === 'plus') ? () => edit.onGenre(n.gid) : () => edit.onLeaf(n.gid, n.label);
      const label = n.kind === 'add' || n.kind === 'plus' ? n.label : n.kind === 'genre' ? `${n.label}の中身を選ぶ` : `${n.label}を消す`;
      g.classList.add('is-tap');
      if ((n.kind === 'add' || n.kind === 'genre') && edit.selected === (n.kind === 'add' ? 'add' : n.gid)) g.classList.add('is-selected');
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', label);
      g.addEventListener('click', run);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); run(); } });
    }
    root.appendChild(g);
  });
  state.shownKeys[keyId] = now;
  box.appendChild(root);
}

// ══════════════════════════════════════════════
// 作る（マップを直接押して作る。＋でポップアップ・× で消す）
// ══════════════════════════════════════════════
// だれの分を作るか（ホストは端末なしの参加者の分も作る）
function pickTargets(room) {
  const list = [];
  if (state.role !== 'host' || hostPlaysOf(room)) list.push(state.nickname);
  if (state.role === 'host') proxyNames(room).forEach((n) => list.push(n));
  return list;
}
// 作っている途中のマップ。はじめてのとき・ホストが「もう一度作る時間」にしたときは、ルームにある分から作る
function draftOf(room, name) {
  const key = `${room.round}:${room.seq || 0}:${name}`;
  if (!state.picks[key]) state.picks[key] = cleanMap(mapOf(room, name), settingsOf(room).maxGenres);
  return state.picks[key];
}
// 自分（か、ホストが代わりに作る人）のマップをルームに書く
async function pushMap(name) {
  clearTimeout(state.sendTimers[name]);
  delete state.sendTimers[name];
  const ref = state.roomRef;
  const room = state.room;
  if (!ref || !room || room.status !== STATUS.PICK) return;
  const round = room.round;
  const seq = room.seq || 0;
  const d = state.picks[`${round}:${seq}:${name}`];
  if (!d) return;
  const items = {};
  d.genres.forEach((gid) => { if ((d.items[gid] || []).length) items[gid] = d.items[gid].slice(); });
  const payload = { r: round, genres: d.genres.slice(), items, done: !!d.done, share: d.share !== false };
  const uid = firebase.auth().currentUser?.uid;
  const mine = name === state.nickname;
  try {
    await ref.transaction((cur) => {
      if (!cur || cur.status !== STATUS.PICK || cur.round !== round || (cur.seq || 0) !== seq) return undefined;
      const ok = mine ? cur.players?.[name]?.uid === uid : (cur.hostUid === uid && !!cur.proxies?.[name]);
      if (!ok) return undefined;
      return { ...cur, maps: { ...(cur.maps || {}), [name]: payload } };
    });
  } catch (error) {
    console.warn('[suki-mono-map] map send failed', error);
    toast('うまく送れなかったよ。もう一度押してみてね');
  }
}
// 選ぶたびに送ると多いので、少しまとめて送る
function sendDraft(name, nowFlag) {
  clearTimeout(state.sendTimers[name]);
  if (nowFlag) { pushMap(name); return; }
  state.sendTimers[name] = setTimeout(() => pushMap(name), SEND_MS);
}

// ひらいているポップアップ（消えたジャンルを指していたら閉じる）
function popOf(d) {
  if (state.pop === 'add') return 'add';
  return state.pop && d.genres.includes(state.pop) ? state.pop : null;
}
function openPop(what) {
  state.pop = what;
  state.freeOpen = false;
  state.confirmDel = false;
  render();
  $('p-pop').scrollTop = 0;
}
function closePop() {
  state.pop = null;
  state.freeOpen = false;
  state.confirmDel = false;
  render();
}
// ポップアップをひらく・閉じる（状態に合わせる）
function syncPop(what) {
  const dlg = $('p-pop');
  if (what && !dlg.open) { dlg.showModal(); $('p-panel-title').focus({ preventScroll: true }); }
  if (!what && dlg.open) dlg.close();
}

function addGenre(gid) {
  const room = state.room;
  const name = state.target;
  const d = draftOf(room, name);
  if (!d.genres.includes(gid)) {
    if (d.genres.length >= maxOf(room)) return;
    d.genres.push(gid);
    d.items[gid] = [];
    sendDraft(name);
  }
  openPop(gid); // 足したら、そのまま中身を選ぶ
}
function removeGenre(gid) {
  const room = state.room;
  const name = state.target;
  const d = draftOf(room, name);
  const i = d.genres.indexOf(gid);
  if (i < 0) return;
  d.genres.splice(i, 1);
  delete d.items[gid];
  sendDraft(name);
  closePop();
}
function toggleItem(gid, t) {
  const room = state.room;
  const name = state.target;
  const d = draftOf(room, name);
  const list = d.items[gid] || (d.items[gid] = []);
  const i = list.indexOf(t);
  if (i >= 0) list.splice(i, 1); else list.push(t);
  sendDraft(name);
  render();
}
function addFree(text) {
  const room = state.room;
  const name = state.target;
  const d = draftOf(room, name);
  const gid = popOf(d);
  const t = clean(text, FREE_MAX);
  if (!gid || gid === 'add' || !t) return false;
  const g = genreOf(gid);
  const list = d.items[gid] || (d.items[gid] = []);
  if (list.includes(t)) return true;
  if (!g.items.includes(t) && list.filter((x) => !g.items.includes(x)).length >= FREE_PER_GENRE) return false;
  list.push(t);
  sendDraft(name);
  render();
  return true;
}
function setDone(done) {
  const room = state.room;
  const name = state.target;
  if (!room || !name) return;
  const d = draftOf(room, name);
  if (done && !d.genres.length) return;
  d.done = done;
  sendDraft(name, true);
  render();
}

function renderPick(room) {
  if (state.currentScreen !== 'pick') showScreen('pick');
  const targets = pickTargets(room);
  const host = state.role === 'host';
  const watching = !targets.length;
  $('p-watch').hidden = !watching;
  if (!targets.includes(state.target)) state.target = targets.length ? targets[0] : null;

  // ホストは「だれの分を作るか」を切りかえる（端末なしの参加者がいるとき）
  const sw = $('p-switch');
  sw.hidden = !(host && targets.length > 1);
  if (!sw.hidden) {
    sw.textContent = '';
    sw.appendChild(el('span', 'sm-switch__label', 'だれの分を作る？'));
    targets.forEach((n) => {
      const b = el('button', null, n === state.nickname ? `${n}（自分）` : n);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(n === state.target));
      if (draftOf(room, n).done) b.appendChild(icon('check_circle'));
      b.addEventListener('click', () => { state.target = n; state.pop = null; state.freeOpen = false; state.confirmDel = false; render(); });
      sw.appendChild(b);
    });
  }

  if (watching) { $('p-box').hidden = true; $('p-sent').hidden = true; syncPop(null); drawPickHost(room, true); return; }
  const name = state.target;
  const d = draftOf(room, name);
  const sent = d.done;
  const n = d.genres.length;
  const max = maxOf(room);

  $('p-box').hidden = sent;
  $('p-sent').hidden = !sent;
  if (sent) {
    syncPop(null);
    drawMap($('p-sent-map'), name, d, `sent:${room.round}:${name}`);
    // 自分の分は「できた」をすぐ数える（送った分が届くまでの間も）
    const rest = makerNames(room).filter((m) => m !== name && !mapOf(room, m)?.done && !(targets.includes(m) && draftOf(room, m).done)).length;
    $('p-sent-rest').textContent = rest > 0 ? `あと${rest}人が作っているよ。そのまま待ってね` : 'みんなできたよ。ホストが見せあいをはじめるよ';
    $('p-share').checked = d.share !== false;
    drawPickHost(room, true);
    return;
  }

  const panel = popOf(d);
  state.pop = panel;

  // マップ（押して編集する）
  drawMap($('p-map'), name, d, `pick:${room.round}:${name}`, {
    canAdd: n < max,
    selected: panel,
    onAdd: () => openPop('add'),
    onGenre: (gid) => openPop(gid),
    onLeaf: (gid, t) => toggleItem(gid, t),
  });
  $('p-map-hint').textContent = n === 0
    ? '「＋」を押して、好きなジャンルを足そう'
    : '「＋」で足す・× で消す。ジャンルを押すと選びなおせるよ';
  $('p-done').disabled = n === 0;
  drawPickHost(room, false);

  // ポップアップ（ひらいているときだけ中身を作る）
  syncPop(panel);
  if (!panel) return;
  const gbox = $('p-genres');
  const ibox = $('p-items');
  gbox.hidden = panel !== 'add';
  ibox.hidden = panel === 'add';
  $('p-del').hidden = panel === 'add' || state.confirmDel;
  $('p-del-confirm').hidden = panel === 'add' || !state.confirmDel;
  const head = $('p-panel-icon');
  if (panel === 'add') {
    head.hidden = true;
    $('p-panel-title').textContent = n === 0 ? '好きなジャンルは？' : 'ジャンルを足す';
    $('p-panel-note').textContent = settingsOf(room).maxGenres ? `${max}つまで足せるよ（いま ${n} / ${max}）` : 'いくつ足してもいいよ';
    gbox.textContent = '';
    DATA.genres.forEach((g) => {
      const on = d.genres.includes(g.id);
      const b = el('button', 'sm-genre');
      b.type = 'button';
      b.style.cssText = genreStyle(g);
      if (on) b.classList.add('is-on');
      const ic = el('span', 'sm-genre__icon');
      ic.appendChild(icon(g.icon));
      b.append(ic, el('span', 'sm-genre__label', g.label));
      if (on) {
        const c = icon('check_circle');
        c.classList.add('sm-genre__check');
        b.appendChild(c);
        b.setAttribute('aria-label', `${g.label}（マップにあるよ。押すと中身を選べる）`);
      }
      b.addEventListener('click', () => addGenre(g.id));
      gbox.appendChild(b);
    });
    $('p-free').hidden = true;
  } else {
    const g = genreOf(panel);
    head.hidden = false;
    head.style.cssText = genreStyle(g);
    head.textContent = '';
    head.appendChild(icon(g.icon));
    $('p-panel-title').textContent = g.ask;
    $('p-panel-note').textContent = 'いくつ選んでもいいよ。もう一度押すと外れるよ';
    ibox.style.cssText = genreStyle(g);
    ibox.textContent = '';
    const picked = d.items[panel] || [];
    const free = picked.filter((t) => !g.items.includes(t));
    g.items.concat(free).forEach((t) => {
      const on = picked.includes(t);
      const b = el('button', 'sm-item');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(on));
      if (on) b.appendChild(icon('check'));
      b.appendChild(el('span', null, t));
      b.addEventListener('click', () => toggleItem(panel, t));
      ibox.appendChild(b);
    });
    // 選択肢にないものは、自分で書く
    const freeFull = free.length >= FREE_PER_GENRE;
    if (!freeFull) {
      const add = el('button', 'sm-item sm-item--add');
      add.type = 'button';
      add.setAttribute('aria-expanded', String(!!state.freeOpen));
      add.append(icon('edit'), el('span', null, '自分で書く'));
      add.addEventListener('click', () => {
        state.freeOpen = !state.freeOpen;
        render();
        if (state.freeOpen) $('p-free-input').focus();
      });
      ibox.appendChild(add);
    }
    $('p-free').hidden = !state.freeOpen || freeFull;
    $('p-del').lastChild.textContent = `「${g.label}」をマップから消す`;
    $('p-del-q').textContent = picked.length ? `「${g.label}」と、選んだ${picked.length}こを消す？` : `「${g.label}」を消す？`;
  }
}
// free: この画面にほかの主ボタンがないとき（自分の分ができた・進行だけ）
function drawPickHost(room, free) {
  const host = state.role === 'host';
  $('p-host').hidden = !host;
  if (!host) return;
  const makers = makerNames(room);
  const done = doneNames(room).length;
  const all = makers.length > 0 && done >= makers.length;
  $('p-progress').textContent = `できた人　${done} / ${makers.length}`;
  $('p-host-note').textContent = all ? 'みんなできたよ' : 'まだの人がいても、はじめられるよ（そこまで選んだ分が出る）';
  $('btn-show').className = free && all ? 'btn btn-primary btn-lg' : 'btn btn-secondary';
}

// ══════════════════════════════════════════════
// 見せあう
// ══════════════════════════════════════════════
function renderShow(room) {
  if (state.currentScreen !== 'show') showScreen('show');
  const host = state.role === 'host';
  const order = arr(room.show?.order);
  const idx = room.show?.idx || 0;
  const people = $('s-people');
  people.textContent = '';
  order.forEach((n, i) => {
    const b = el('button', 'sm-person', n);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === idx));
    b.disabled = !host;
    if (host) b.addEventListener('click', () => jumpShow(i));
    people.appendChild(b);
  });
  const name = order[idx];
  $('s-empty').hidden = !!name;
  $('s-map').hidden = !name;
  if (name) drawMap($('s-map'), name, cleanMap(mapOf(room, name)), `show:${room.round}:${name}`);
  $('s-ask').hidden = !room.show?.ask;
  $('s-ask-text').textContent = room.show?.ask || '';
  $('btn-ask').hidden = !host;
  $('s-host').hidden = !host;
  $('s-wait').hidden = host;
  if (!host) return;
  const many = order.length > 1;
  const last = idx >= order.length - 1;
  $('btn-prev').hidden = !many;
  $('btn-next').hidden = !many;
  $('s-count').textContent = order.length ? `${idx + 1} / ${order.length}人め` : '';
  // さいごの人まで見たら、主ボタンは置かない（はじめの人にもどるのは補助）
  const nb = $('btn-next');
  nb.className = last ? 'btn btn-secondary' : 'btn btn-primary btn-lg';
  nb.firstChild.textContent = last ? 'はじめの人へ' : 'つぎの人';
  nb.lastChild.textContent = last ? 'replay' : 'chevron_right';
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
const ruleText = (room) => `選べるジャンル: ${(MAX_OPTS.find(([v]) => v === Number(settingsOf(room).maxGenres)) || MAX_OPTS[0])[1]}`;

function render() {
  const room = state.room;
  if (!room || !state.roomRef) return;
  if (room.status !== lastStatus) {
    lastStatus = room.status;
    state.pop = null;
    state.freeOpen = false;
    state.confirmDel = false;
    window.scrollTo(0, 0);
  }
  if (room.status === STATUS.WAITING) return renderLobby(room);
  if (room.status === STATUS.PICK) return renderPick(room);
  if (room.status === STATUS.SHOW) return renderShow(room);
  return undefined;
}

function renderLobby(room) {
  if (state.currentScreen !== 'lobby') showScreen('lobby');
  resetDrafts();
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
      const x = el('button', 'sm-chip-x');
      x.type = 'button';
      x.setAttribute('aria-label', `${n}を外す`);
      x.appendChild(icon('close'));
      x.addEventListener('click', () => removeProxy(n));
      li.appendChild(x);
    }
    ul.append(li);
  });
  $('lobbyWait').hidden = host;
  $('lobbyHost').hidden = !host;
  $('lobbyInfo').hidden = host;
  $('lobbyRule').textContent = ruleText(room);
  if (!host) return;
  $('setHostPlays').checked = plays;
  segButtons($('max-opts'), MAX_OPTS, Number(s.maxGenres) || 0, (v) => setSetting('maxGenres', v));
  const full = proxyNames(room).length >= PROXY_MAX;
  $('proxyName').disabled = full;
  $('btnAddProxy').disabled = full;
  const count = makerNames(room).length;
  $('btnStart').disabled = count < 1;
  $('startNote').textContent = count < 1 ? 'マップを作る人がいないよ。「自分も作る」を入れるか、参加用のリンクを送ってね' : `マップを作る人は${count}人`;
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
$('btnStart').addEventListener('click', startGame);

// 日本語の変換中に Enter を押しても、変換の確定だけにする
let composing = false;
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { setTimeout(() => { composing = false; }, 0); });

$('proxyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if (composing) return;
  addProxy();
});
$('p-free').addEventListener('submit', (e) => {
  e.preventDefault();
  if (composing) return;
  if (addFree($('p-free-input').value)) {
    $('p-free-input').value = '';
    state.freeOpen = false;
    render();
  }
});
$('p-done').addEventListener('click', () => setDone(true));
$('p-redo').addEventListener('click', () => setDone(false));
$('p-share').addEventListener('change', () => {
  const room = state.room;
  if (!room || !state.target || room.status !== STATUS.PICK) return;
  draftOf(room, state.target).share = $('p-share').checked;
  sendDraft(state.target, true);
});
$('p-del').addEventListener('click', () => {
  const room = state.room;
  if (!room || !state.target) return;
  const d = draftOf(room, state.target);
  const gid = popOf(d);
  if (!gid || gid === 'add') return;
  // 中身を選んでいるときだけ、消す前に確かめる
  if ((d.items[gid] || []).length) { state.confirmDel = true; render(); $('p-del-yes').focus(); } else removeGenre(gid);
});
$('p-del-yes').addEventListener('click', () => {
  const room = state.room;
  if (!room || !state.target) return;
  const gid = popOf(draftOf(room, state.target));
  if (gid && gid !== 'add') removeGenre(gid);
});
$('p-del-no').addEventListener('click', () => { state.confirmDel = false; render(); });
$('p-pop-close').addEventListener('click', closePop);
// Esc・外側を押したときも閉じる
$('p-pop').addEventListener('close', () => { if (state.pop) closePop(); });
$('p-pop').addEventListener('click', (e) => { if (e.target === $('p-pop')) closePop(); });

$('btn-show').addEventListener('click', startShow);
$('btn-prev').addEventListener('click', () => jumpShow((i, n) => (i - 1 + n) % n));
$('btn-next').addEventListener('click', () => jumpShow((i, n) => (i + 1) % n));
$('btn-ask').addEventListener('click', rerollAsk);
$('btn-back-pick').addEventListener('click', backToPick);
$('btn-end').addEventListener('click', backToLobby);

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
