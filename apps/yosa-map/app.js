/* よさマップ
   「やさしい」「行動力がある」などのよさ（1段め）と、そのよさが出る具体的な場面（2段め）を選んで、マップを作る。
   マップの作り方は2つ（待合室でホストが選ぶ）:
     own … それぞれ自分のマップを作って、1人ずつ見せあう
     one … みんなで1人のマップを作る（本人が選んだ札と、ほかの人から見えた札がまざる）
   マップの「＋」を押すとポップアップで選ぶ。× を押すと消える（図とポップアップは apps/suki-mono-map と同じ形）。
   ホストの操作はルームの transaction（hostUid を確かめる）。マップの書きかえも、押した人がルームの transaction で書く
   （みんなで1人のマップは何人もが同じマップを書くので、1つの操作ごとに書く。作りかけを端末に持たない）。
   選んだ数・印の数・人どうしの比べっこは出さない。 */

const DATA = window.YOSA_MAP_DATA;
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'yosamap_rooms';
const SESSION_KEY = 'yosamap_session';
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const MAX_GUESTS = 12;
const STATUS = { WAITING: 'waiting', PICK: 'pick', SHOW: 'show' };

const FREE_MAX = 16;       // 「自分で書く」の文字数
const FREE_PER_YOSA = 3;   // 1つのよさに書き足せる数
const PROXY_MAX = 4;       // 端末なしの参加者を足せる数
const MODES = [['own', 'それぞれ自分のマップを作って、見せあう'], ['one', 'みんなで1人のマップを作る']];
const DEFAULT_SETTINGS = { hostPlays: true, mode: 'own' };

const $ = (id) => document.getElementById(id);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const pick1 = (a) => a[Math.floor(Math.random() * a.length)];
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (name) => { const s = el('span', 'material-symbols-rounded', name); s.setAttribute('aria-hidden', 'true'); return s; };
const now = () => RoomkRTDB.now();
const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const yosaOf = (id) => DATA.yosa.find((g) => g.id === id);
const yosaStyle = (g) => `--c:${g.color};--p:${g.pale};--i:${g.ink}`;
const settingsOf = (room) => ({ ...DEFAULT_SETTINGS, ...(room?.settings || {}) });
const hostPlaysOf = (room) => settingsOf(room).hostPlays !== false;
const modeOf = (room) => (settingsOf(room).mode === 'one' ? 'one' : 'own');
// マップ: { yosa: [よさのid], items: { よさのid: [札] }, done, share }。札: { t: 場面, self: 本人が選んだ・もらった, from: [見えたと付けた人の名前] }
const emptyMap = () => ({ yosa: [], items: {}, done: false, share: true });
const itemsOf = (mp, yid) => (mp && mp.items && mp.items[yid]) || [];
const findItem = (mp, yid, t) => itemsOf(mp, yid).find((x) => x.t === t);
const isOffer = (it) => !it.self && it.from.length > 0;   // ほかの人から見えた札（本人はまだもらっていない）
const hasFrom = (mp) => !!mp && mp.yosa.some((yid) => itemsOf(mp, yid).some((x) => x.from.length));
const fromText = (it) => `${it.from.join('さん・')}さん`;

// 届いたマップを、知っているよさ・文字数の範囲に整える（RTDB は空の配列を持てないので、無い所は空として読む）
function cleanMap(m) {
  const out = emptyMap();
  if (!m || typeof m !== 'object') return out;
  out.yosa = arr(m.yosa).filter((id, i, a) => yosaOf(id) && a.indexOf(id) === i);
  out.yosa.forEach((id) => {
    const g = yosaOf(id);
    const seen = new Set();
    let free = 0;
    out.items[id] = arr(m.items && m.items[id]).map((x) => ({
      t: clean(x && x.t, FREE_MAX),
      self: !!(x && x.self),
      from: arr(x && x.from).map((n) => clean(n, 8)).filter((n, i, a) => n && a.indexOf(n) === i),
    })).filter((x) => {
      if (!x.t || seen.has(x.t) || (!x.self && !x.from.length)) return false;
      if (!g.items.includes(x.t)) { free += 1; if (free > FREE_PER_YOSA) return false; }
      seen.add(x.t);
      return true;
    });
  });
  out.done = !!m.done;
  out.share = m.share !== false;
  return out;
}
// ルームに書く形にする（中身のない所は書かない）
function packMap(mp, round) {
  const items = {};
  mp.yosa.forEach((yid) => {
    const list = itemsOf(mp, yid).map((x) => (x.from.length ? { t: x.t, self: !!x.self, from: x.from.slice() } : { t: x.t, self: !!x.self }));
    if (list.length) items[yid] = list;
  });
  return { r: round, yosa: mp.yosa.slice(), items, done: !!mp.done, share: mp.share !== false };
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
  target: null,     // いま作っているのはだれの分か（それぞれのマップ。ホストは端末なしの参加者の分も作る）
  pop: null,        // ひらいているポップアップ（null | { k: 'add' } | { k: 'yosa', yid } | { k: 'offer', yid, t }）
  freeOpen: false,  // 「自分で書く」を開いているか
  confirmDel: false, // よさを消す前の確かめを出しているか
  by: null,         // ホストの足し方（みんなで1人のマップ）: 'self' 本人が選んだ | 'other' わたしから見えた。null は場面で決める
  shownKeys: {},    // マップの図ごとに、前に描いた点（新しく出た点だけ動かす）
};

function showScreen(id) {
  document.querySelectorAll('.ym-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
  document.querySelector('.ym-wrap').classList.toggle('is-top', id === 'top');
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
// 参加している人ぜんぶ（進行だけのホストも含む。みんなで1人のマップで、だれのマップを作るかを選ぶときに使う）
function memberNames(room) {
  const players = Object.entries(room.players || {})
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
    console.warn('[yosa-map] expired room cleanup failed', error);
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
  state.target = null;
  state.by = null;
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
      console.warn('[yosa-map] presence recovery failed', error);
      toast('再接続に失敗しました。ページを読み直してね');
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
}

function handleRoom(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // ポップアップ（<dialog>）はいちばん手前に出るので、ひらいたままだと「ホストの戻りを待っています」が後ろに隠れる。閉じておく（選んだものは残る）
    state.pop = null;
    state.freeOpen = false;
    state.confirmDel = false;
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
    console.warn('[yosa-map] create failed', error);
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
    console.warn('[yosa-map] join failed', error);
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
    console.warn('[yosa-map] reconnect failed', error);
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
    console.warn('[yosa-map] leave failed', error);
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
    console.warn('[yosa-map] host action failed', error);
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
// みんなで1人のマップ: 待合室で選んでいる人（選んでいない・いなくなったときは、ホストでない最初の人）
function focusPick(room) {
  const members = memberNames(room);
  const f = settingsOf(room).focus;
  if (f && members.includes(f)) return f;
  return members.find((n) => n !== room.host) || null;
}
// 待合室 → 作る（新しい回。前のマップは消す）
async function startGame() {
  let n = 0;
  let mode = 'own';
  const result = await hostTx((room) => {
    if (room.status !== STATUS.WAITING) return undefined;
    mode = modeOf(room);
    const focus = mode === 'one' ? focusPick(room) : null;
    n = mode === 'one' ? memberNames(room).length : makerNames(room).length;
    if (mode === 'one' ? !focus : n < 1) return undefined;
    return { ...room, status: STATUS.PICK, round: (room.round || 0) + 1, seq: 0, focus, maps: null, show: null, shown: null };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (result?.committed) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count(`players-${n}`);
    window.RoomkStats?.count(`mode-${mode}`);
  }
}
// 見せあう順番（みんなに出すと選んだ人の、中身のあるマップだけ）
function showOrder(room) {
  return makerNames(room).filter((n) => { const m = mapOf(room, n); return m && m.share !== false && arr(m.yosa).length; });
}
function askFor(room, name) {
  const mp = cleanMap(mapOf(room, name));
  // 本人が選んだ・もらった札から選ぶ（無ければ、見えた札から）
  let all = [];
  mp.yosa.forEach((yid) => itemsOf(mp, yid).forEach((x) => { if (x.self) all.push([yid, x.t]); }));
  if (!all.length) mp.yosa.forEach((yid) => itemsOf(mp, yid).forEach((x) => all.push([yid, x.t])));
  // 場面を選んでいないときは、そのよさがどんなときに出るかをきく
  if (!all.length && mp.yosa.length) return `「${yosaOf(pick1(mp.yosa)).label}」が出るのは、どんなとき？`;
  if (!all.length) return '';
  const [yid, t] = pick1(all);
  return pick1(DATA.asks).replace('{x}', t).replace('{s}', yosaOf(yid).label);
}
async function startShow() {
  let first = false;
  const result = await hostTx((room) => {
    if (room.status !== STATUS.PICK || modeOf(room) !== 'own') return undefined;
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
// みんなで1人のマップ: 本人かホストが完成にする → みんなでながめる
async function finishOne() {
  const ref = state.roomRef;
  if (!ref) return;
  const uid = firebase.auth().currentUser?.uid;
  const nick = state.nickname;
  let first = false;
  try {
    const result = await ref.transaction((room) => {
      if (!room || room.status !== STATUS.PICK || modeOf(room) !== 'one' || !room.focus) return undefined;
      if (room.players?.[nick]?.uid !== uid) return undefined;
      if (room.hostUid !== uid && nick !== room.focus) return undefined;
      if (!arr(mapOf(room, room.focus)?.yosa).length) return undefined;
      first = !room.shown;
      return { ...room, status: STATUS.SHOW, shown: true, show: { order: [room.focus], idx: 0, ask: askFor(room, room.focus) } };
    });
    if (result?.committed && first) window.RoomkStats?.count('finish');
  } catch (error) {
    console.warn('[yosa-map] finish failed', error);
    toast('完成にできませんでした。もう一度ためしてね');
  }
}
// みんなで1人のマップ: つぎの人のマップへ（前の人のマップは残す）
function nextOne(name) {
  hostTx((room) => {
    if (room.status !== STATUS.SHOW || modeOf(room) !== 'one' || !memberNames(room).includes(name)) return undefined;
    return { ...room, status: STATUS.PICK, seq: (room.seq || 0) + 1, focus: name, show: null };
  }, '進められませんでした。もう一度ためしてね');
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
    return { ...room, status: STATUS.WAITING, focus: null, maps: null, show: null, shown: null };
  }, 'もどせませんでした。もう一度ためしてね');
  if (result?.committed) window.RoomkStats?.count('again');
}
// ══════════════════════════════════════════════
// マップの図（apps/suki-mono-map の drawMap と同じ形。札に「ほかの人から見えた」の印と「押したときの動き」を足した）
// ══════════════════════════════════════════════
// SVG の名前空間（通信はしない。draft-lint の外部 URL 検査に当たらないよう分けて書く）
const SVG_NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');
const svg = (tag, attrs, text) => {
  const e = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
  if (text != null) e.textContent = text;
  return e;
};
// 文字の幅のおおよそ（全角1文字＝1、半角＝0.6）
const textW = (t, size) => Array.from(t).reduce((w, c) => w + (/[\x20-\x7e]/.test(c) ? 0.6 : 1), 0) * size;

// name: 真ん中の名前。mp: マップ。box: 描く場所。keyId: 新しく出た点を見分けるための名前
// edit: 押して編集するとき { selected, onAdd, onYosa(sid), leafAct(item) → 'remove'（消す）| 'withdraw'（自分の印を外す）| 'offer'（もらうか選ぶ）| null, onLeaf(sid, item, act) }
function drawMap(box, name, mp, keyId, edit) {
  box.textContent = '';
  const scenes = mp ? mp.yosa : [];
  const nG = scenes.length;
  const canAdd = !!edit && nG < DATA.yosa.length;
  // せまい画面では、上から下へ枝をのばす形にして、文字を実寸で出す
  const tree = box.clientWidth > 0 && box.clientWidth < 520;
  const LF = tree ? 16 : 18; // よさの文字の大きさ
  const leafOf = (sid, sc, it, x, y) => {
    const a = edit ? edit.leafAct(it) : null;
    const from = it.from.length > 0;
    const hasX = a === 'remove' || a === 'withdraw';
    return { x, y, kind: 'leaf', label: it.t, key: `i:${sid}:${it.t}`, it, act: a, hasX, from, offer: isOffer(it), lw: textW(it.t, LF) + 28 + (hasX ? 24 : 0) + (from ? 24 : 0), g: sc, gid: sid };
  };
  const R1 = nG <= 1 ? 140 : nG <= 3 ? 180 : nG <= 6 ? 235 : 300;
  const nodes = [];
  const lines = [];
  const me = { x: 0, y: 0, kind: 'me', label: name, key: 'me' };
  const meW = Math.max(96, textW(name, 22) + 36);
  let treeSize = null;
  const addLabel = 'よさを足す';
  if (tree) {
    const W = box.clientWidth;
    const TRUNK = 26; const GX = 44; const SUB = 54; const LX = 66; const RIGHT = W - 4;
    me.x = 4 + meW / 2; me.y = 32;
    let y = 32 + 30 + 34;
    let trunkEnd = 62;
    scenes.forEach((sid) => {
      const g = yosaOf(sid);
      const gw = textW(g.label, 18) + 62;
      nodes.push({ x: GX + gw / 2, y, kind: 'genre', label: g.label, icon: g.icon, key: `g:${sid}`, g, gid: sid });
      lines.push({ x1: TRUNK, y1: y, x2: GX, y2: y, kind: 'genre', key: `lg:${sid}`, g });
      trunkEnd = y;
      const items = itemsOf(mp, sid).slice();
      if (edit) items.push(null); // さいごに「＋」を1つ並べる
      let cx = LX;
      let rowY = y + 24 + 12 + 19;
      const rows = [];
      items.forEach((it) => {
        const n = it === null
          ? { x: 0, y: rowY, kind: 'plus', label: `${g.label}に足す`, key: `plus:${sid}`, lw: 40, g, gid: sid }
          : leafOf(sid, g, it, 0, rowY);
        // 1行に入らない長い札は、入る大きさまで文字を小さくする（12px まで）
        if (it !== null && n.lw > RIGHT - LX) {
          const extra = n.lw - textW(it.t, LF);
          n.fs = Math.max(12, Math.floor((LF * (RIGHT - LX - extra)) / textW(it.t, LF) * 10) / 10);
          n.lw = Math.min(n.lw, RIGHT - LX);
        }
        if (cx > LX && cx + n.lw > RIGHT) { cx = LX; rowY += 46; }
        if (!rows.includes(rowY)) rows.push(rowY);
        n.x = cx + n.lw / 2; n.y = rowY;
        nodes.push(n);
        cx += n.lw + 8;
      });
      if (rows.length) {
        lines.push({ x1: SUB, y1: y + 24, x2: SUB, y2: rows[rows.length - 1], kind: 'leaf', key: `ls:${sid}`, g });
        rows.forEach((ry, i) => lines.push({ x1: SUB, y1: ry, x2: LX, y2: ry, kind: 'leaf', key: `lr:${sid}:${i}`, g }));
        y = rows[rows.length - 1] + 19 + 20 + 24;
      } else {
        y += 24 + 16 + 24;
      }
    });
    if (canAdd) {
      const aw = textW(addLabel, 17) + 58;
      nodes.push({ x: GX + aw / 2, y, kind: 'add', label: addLabel, key: 'add' });
      lines.push({ x1: TRUNK, y1: y, x2: GX, y2: y, kind: 'ghost', key: 'ladd', g: { color: 'currentColor' } });
      lines.push({ x1: TRUNK, y1: trunkEnd, x2: TRUNK, y2: y, kind: 'ghost', key: 'ladd2', g: { color: 'currentColor' } });
      y += 24 + 16 + 24;
    }
    if (nG) lines.unshift({ x1: TRUNK, y1: 62, x2: TRUNK, y2: trunkEnd, kind: 'trunk', key: 'trunk', g: { color: 'currentColor' } });
    treeSize = { W, H: Math.max(y - 24 - 16 + 8, 70) };
  }
  // 真ん中の名前と重ならない距離（横に並ぶときは幅のぶん遠くする）
  const reach = (a, w, h) => Math.max(R1, Math.min((meW / 2 + w / 2 + 34) / Math.max(0.001, Math.abs(Math.cos(a))), (30 + h / 2 + 34) / Math.max(0.001, Math.abs(Math.sin(a)))));
  nodes.unshift(me);
  const slots = nG + (canAdd ? 1 : 0); // 「＋」も枝の1つとして並べる
  const per = slots ? (Math.PI * 2) / slots : 0;
  const a0 = slots === 2 ? Math.PI : -Math.PI / 2; // 2つのときは左右に広げる
  if (!tree) scenes.forEach((sid, gi) => {
    const g = yosaOf(sid);
    const a = a0 + per * gi;
    const gr = reach(a, textW(g.label, 18) + 62, 48);
    const gn = { x: Math.cos(a) * gr, y: Math.sin(a) * gr, kind: 'genre', label: g.label, icon: g.icon, key: `g:${sid}`, g, gid: sid };
    nodes.push(gn);
    lines.push({ from: me, to: gn, kind: 'genre', key: `lg:${sid}`, g });
    const items = itemsOf(mp, sid).slice();
    if (edit) items.push(null);
    const k = items.length;
    // 札は、場面から外向きに扇形に広げる。文が長いので、たてに広がるよう半径を大きめにとる
    const spread = Math.min(nG >= 3 ? per * 1.15 : 2.6, 0.5 * (k - 1));
    items.forEach((it, i) => {
      const la = k === 1 ? a : a + spread * (i / (k - 1) - 0.5);
      const r = 150 + (i % 2 ? 56 : 0);
      const x = gn.x + Math.cos(la) * r; const y = gn.y + Math.sin(la) * r;
      const n = it === null
        ? { x: gn.x + Math.cos(la) * (r - 30), y: gn.y + Math.sin(la) * (r - 30), kind: 'plus', label: `${g.label}に足す`, key: `plus:${sid}`, g, gid: sid }
        : leafOf(sid, g, it, x, y);
      n.move = true;
      nodes.push(n);
      lines.push({ from: gn, to: n, kind: it === null ? 'plus' : 'leaf', key: `li:${sid}:${it ? it.t : ''}`, g });
    });
  });

  if (!tree && canAdd) {
    const a = a0 + per * nG;
    const ar = reach(a, textW(addLabel, 17) + 58, 48);
    const an = { x: Math.cos(a) * ar, y: Math.sin(a) * ar, kind: 'add', label: addLabel, key: 'add' };
    nodes.push(an);
    lines.push({ from: me, to: an, kind: 'ghost', key: 'ladd', g: { color: 'currentColor' } });
  }

  // 点の大きさ
  nodes.forEach((n) => {
    if (n.kind === 'me') { n.w = meW; n.h = 60; }
    else if (n.kind === 'genre') { n.w = textW(n.label, 18) + 62; n.h = 48; }
    else if (n.kind === 'add') { n.w = textW(n.label, 17) + 58; n.h = 48; }
    else if (n.kind === 'plus') { n.w = 44; n.h = 44; }
    else { n.w = n.lw; n.h = 38; }
  });
  // 重なった札を少しずつ押しのける（真ん中と場面は動かさない）
  const GAP = 10;
  for (let it = 0; it < (tree ? 0 : 240); it += 1) {
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

  let minX = 0; let maxX = 0; let minY = 0; let maxY = 0;
  nodes.forEach((n) => {
    minX = Math.min(minX, n.x - n.w / 2); maxX = Math.max(maxX, n.x + n.w / 2);
    minY = Math.min(minY, n.y - n.h / 2); maxY = Math.max(maxY, n.y + n.h / 2);
  });
  const pad = 16;
  const MIN_W = 640; const MIN_H = 360;
  if (maxX - minX < MIN_W) { const c = (minX + maxX) / 2; minX = c - MIN_W / 2; maxX = c + MIN_W / 2; }
  if (maxY - minY < MIN_H) { const c = (minY + maxY) / 2; minY = c - MIN_H / 2; maxY = c + MIN_H / 2; }
  const root = svg('svg', {
    viewBox: treeSize ? `0 0 ${treeSize.W} ${treeSize.H}` : `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`,
    class: treeSize ? 'mp--tree' : 'mp--radial',
    role: edit ? 'group' : 'img',
    'aria-label': `${name}のよさマップ`,
  });
  const prev = state.shownKeys[keyId] || new Set();
  const now = new Set();
  const isNew = (key) => { now.add(key); return prev.size > 0 && !prev.has(key); };

  const gLines = svg('g', { class: 'mp-lines' });
  lines.forEach((l) => {
    gLines.appendChild(svg('line', { x1: l.from ? l.from.x : l.x1, y1: l.from ? l.from.y : l.y1, x2: l.to ? l.to.x : l.x2, y2: l.to ? l.to.y : l.y2, class: `mp-line mp-line--${l.kind}${isNew(l.key) ? ' is-new' : ''}`, style: `--c:${l.g.color}` }));
  });
  root.appendChild(gLines);

  nodes.forEach((n) => {
    const g = svg('g', { class: `mp-node mp-node--${n.kind}${isNew(n.key) ? ' is-new' : ''}`, transform: `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})` });
    if (n.g) g.setAttribute('style', yosaStyle(n.g));
    let run = null;
    let label = null;
    if (n.kind === 'me') {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -30, width: n.w, height: 60, rx: 30, class: 'mp-me' }));
      g.appendChild(svg('text', { class: 'mp-me__text', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label));
    } else if (n.kind === 'genre') {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -24, width: n.w, height: 48, rx: 24, class: 'mp-genre' }));
      g.appendChild(svg('text', { class: 'mp-genre__icon', x: -n.w / 2 + 28, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.icon));
      g.appendChild(svg('text', { class: 'mp-genre__text', x: 15, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label));
      if (edit) { run = () => edit.onYosa(n.gid); label = `${n.label}の場面を選ぶ`; if (edit.selected === n.gid) g.classList.add('is-selected'); }
    } else if (n.kind === 'plus') {
      g.appendChild(svg('circle', { r: 20, class: 'mp-plus' }));
      g.appendChild(svg('text', { class: 'mp-plus__icon', 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'add'));
      run = () => edit.onYosa(n.gid); label = n.label;
    } else if (n.kind === 'add') {
      g.appendChild(svg('rect', { x: -n.w / 2, y: -24, width: n.w, height: 48, rx: 24, class: 'mp-add' }));
      g.appendChild(svg('text', { class: 'mp-add__icon', x: -n.w / 2 + 26, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'add_circle'));
      g.appendChild(svg('text', { class: 'mp-add__text', x: 14, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label));
      run = edit.onAdd; label = n.label;
      if (edit.selected === 'add') g.classList.add('is-selected');
    } else {
      if (n.offer) g.classList.add('is-offer');
      g.appendChild(svg('rect', { x: -n.w / 2, y: -19, width: n.w, height: 38, rx: 18, class: `mp-leaf${n.offer ? ' mp-leaf--offer' : n.from ? ' mp-leaf--kept' : ''}` }));
      if (n.from) g.appendChild(svg('text', { class: 'mp-leaf__from', x: -n.w / 2 + 19, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'visibility'));
      const tx = svg('text', { class: 'mp-leaf__text', x: (n.from ? 12 : 0) - (n.hasX ? 11 : 0), 'text-anchor': 'middle', 'dominant-baseline': 'central' }, n.label);
      if (n.fs) tx.style.fontSize = `${n.fs}px`;
      g.appendChild(tx);
      if (n.hasX) g.appendChild(svg('text', { class: 'mp-leaf__x', x: n.w / 2 - 17, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, 'close'));
      if (n.act) { run = () => edit.onLeaf(n.gid, n.it, n.act); label = n.act === 'remove' ? `${n.label}を消す` : n.act === 'withdraw' ? `${n.label}（自分が付けた印を外す）` : `${n.label}（見えた場面。押すと選べる）`; }
    }
    if (run) {
      g.classList.add('is-tap');
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
// だれの分を作るか（それぞれのマップ。ホストは端末なしの参加者の分も作る）
function pickTargets(room) {
  const list = [];
  if (state.role !== 'host' || hostPlaysOf(room)) list.push(state.nickname);
  if (state.role === 'host') proxyNames(room).forEach((n) => list.push(n));
  return list;
}
// いま作っているマップと、この画面の人の立場
//   name: だれのマップか
//   self: マップの上で本人として動かす（札を消す・見えた札をもらう）
//   by: ポップアップで札を足すときの足し方（'self' 本人が選んだ | 'other' 見えた）/ pickBy: ホストが足し方を切りかえられる
function editCtx(room) {
  const host = state.role === 'host';
  if (modeOf(room) === 'own') return { name: state.target, self: true, by: 'self', pickBy: false, host };
  const name = room.focus;
  if (state.nickname === name) return { name, self: true, by: 'self', pickBy: false, host };
  if (!host) return { name, self: false, by: 'other', pickBy: false, host };
  // ホスト: 本人が端末で入っているときは「わたしから見えた」、いないとき（端末なしの参加者・はなれた人）は本人の代わりに押す。
  // マップの上の動き（self）は本人がいるかどうかだけで決め、足し方の切りかえ（by）では変えない
  const solo = !room.players?.[name];
  return { name, self: solo, by: state.by || (solo ? 'self' : 'other'), pickBy: true, host };
}

// マップを書きかえる（ルームの transaction）。change(mp, who) はマップを直接書きかえ、変えないときは false を返す
//   who: { host, mine: 自分のマップか, one: みんなで1人のマップか, nick }
async function editMap(name, change) {
  const ref = state.roomRef;
  const room = state.room;
  if (!ref || !room || room.status !== STATUS.PICK || !name) return;
  const round = room.round;
  const seq = room.seq || 0;
  const nick = state.nickname;
  const uid = firebase.auth().currentUser?.uid;
  try {
    await ref.transaction((cur) => {
      if (!cur || cur.status !== STATUS.PICK || cur.round !== round || (cur.seq || 0) !== seq) return undefined;
      if (cur.players?.[nick]?.uid !== uid) return undefined;
      const host = cur.hostUid === uid;
      const one = modeOf(cur) === 'one';
      // 書けるマップ: みんなで1人のマップはその人の分だけ。それぞれのマップは自分の分（ホストは端末なしの参加者の分も）
      const ok = one ? name === cur.focus : ((name === nick && (!host || hostPlaysOf(cur))) || (host && !!cur.proxies?.[name]));
      if (!ok) return undefined;
      const mp = cleanMap(mapOf(cur, name));
      if (change(mp, { host, mine: name === nick, one, nick }) === false) return undefined;
      return { ...cur, maps: { ...(cur.maps || {}), [name]: packMap(mp, round) } };
    });
  } catch (error) {
    console.warn('[yosa-map] map edit failed', error);
    toast(error?.message === 'disconnect' ? '通信が切れたみたい。つながったら、もう一度押してね' : 'うまく送れなかったよ。もう一度押してみてね');
  }
}
// 本人として動かせるか（本人・それぞれのマップ・本人の代わりに押すホスト）
const asSelfOf = (who, by) => !who.one || who.mine || (who.host && by === 'self');

function addYosa(name, yid) {
  return editMap(name, (mp) => {
    if (!yosaOf(yid) || mp.yosa.includes(yid)) return false;
    mp.yosa.push(yid);
    mp.items[yid] = [];
    return true;
  });
}
function removeYosa(name, yid, by) {
  return editMap(name, (mp, who) => {
    const i = mp.yosa.indexOf(yid);
    if (i < 0 || !(asSelfOf(who, by) || who.host)) return false;
    mp.yosa.splice(i, 1);
    delete mp.items[yid];
    return true;
  });
}
// 札を押す。本人: 無ければ足す・見えた札ならもらう・自分の札なら外す。ほかの人: 「見えた」の印を付ける・外す
function toggleItem(name, yid, text, by) {
  const t = clean(text, FREE_MAX);
  return editMap(name, (mp, who) => {
    if (!t || !mp.yosa.includes(yid)) return false;
    const g = yosaOf(yid);
    const list = mp.items[yid] || (mp.items[yid] = []);
    const it = list.find((x) => x.t === t);
    const self = asSelfOf(who, by);
    if (!it) {
      const preset = g.items.includes(t);
      if (!preset && !(self || who.host)) return false; // 「自分で書く」は本人とホストだけ
      if (!preset && list.filter((x) => !g.items.includes(x.t)).length >= FREE_PER_YOSA) return false;
      list.push(self ? { t, self: true, from: [] } : { t, self: false, from: [who.nick] });
    } else if (self) {
      if (it.self) list.splice(list.indexOf(it), 1); else it.self = true;
    } else {
      const i = it.from.indexOf(who.nick);
      if (i >= 0) it.from.splice(i, 1); else it.from.push(who.nick);
      if (!it.self && !it.from.length) list.splice(list.indexOf(it), 1);
    }
    return true;
  });
}
function acceptItem(name, yid, t) {
  return editMap(name, (mp, who) => {
    const it = findItem(mp, yid, t);
    if (!it || !isOffer(it) || !asSelfOf(who, 'self')) return false;
    it.self = true;
    return true;
  });
}
// 札を消す。by 'self': 札ごと消す（本人・本人の代わりのホスト）。'other': 自分が付けた「見えた」の印だけ外す
function dropItem(name, yid, t, by) {
  return editMap(name, (mp, who) => {
    const list = mp.items[yid];
    const it = findItem(mp, yid, t);
    if (!it) return false;
    if (by === 'self' && asSelfOf(who, 'self')) {
      list.splice(list.indexOf(it), 1);
      return true;
    }
    const i = it.from.indexOf(who.nick);
    if (i < 0) return false;
    it.from.splice(i, 1);
    if (!it.self && !it.from.length) list.splice(list.indexOf(it), 1);
    return true;
  });
}
function setDone(done) {
  const room = state.room;
  if (!room || modeOf(room) !== 'own') return;
  editMap(state.target, (mp) => {
    if (done && !mp.yosa.length) return false;
    mp.done = done;
    return true;
  });
}

// ポップアップ
function openPop(pop) {
  state.pop = pop;
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
function syncPop(open, focusId) {
  const dlg = $('p-pop');
  if (open && !dlg.open) { dlg.showModal(); $(focusId).focus({ preventScroll: true }); }
  if (!open && dlg.open) dlg.close();
}
// いまのマップに合わないポップアップは閉じる（ほかの人がよさや札を消したとき）
function validPop(mp) {
  const p = state.pop;
  if (!p || !mp) return null;
  if (p.k === 'add') return p;
  if (!mp.yosa.includes(p.yid)) return null;
  if (p.k === 'yosa') return p;
  const it = findItem(mp, p.yid, p.t);
  return it && isOffer(it) ? p : null;
}

function renderPick(room) {
  if (state.currentScreen !== 'pick') showScreen('pick');
  const host = state.role === 'host';
  const own = modeOf(room) === 'own';
  const targets = own ? pickTargets(room) : [];
  if (own && !targets.includes(state.target)) state.target = targets.length ? targets[0] : null;
  const ctx = editCtx(room);
  const makes = own ? !!ctx.name : !!room.focus;   // この画面でマップを作るか（進行だけのホストは作らない）
  const mp = makes ? cleanMap(mapOf(room, ctx.name)) : null;
  const sent = own && makes && mp.done;

  // それぞれのマップ: ホストは「だれの分を作るか」を切りかえる（端末なしの参加者がいるとき）
  const sw = $('p-switch');
  sw.hidden = !(own && host && targets.length > 1);
  if (!sw.hidden) {
    sw.textContent = '';
    sw.appendChild(el('span', 'ym-switch__label', 'だれの分を作る？'));
    targets.forEach((n) => {
      const b = el('button', null, n === state.nickname ? `${n}（自分）` : n);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(n === state.target));
      if (mapOf(room, n)?.done) b.appendChild(icon('check_circle'));
      b.addEventListener('click', () => { state.target = n; state.pop = null; state.freeOpen = false; state.confirmDel = false; render(); });
      sw.appendChild(b);
    });
  }
  const title = $('p-maptitle');
  title.hidden = own;
  if (!own) title.textContent = `${room.focus}さんのよさマップ`;

  $('p-watch').hidden = makes;
  $('p-box').hidden = !makes || sent;
  $('p-sent').hidden = !sent;
  drawPickHost(room, !makes || sent);
  if (!makes) { syncPop(false); return; }
  if (sent) {
    syncPop(false);
    drawMap($('p-sent-map'), ctx.name, mp, `sent:${room.round}:${ctx.name}`);
    const rest = makerNames(room).filter((m) => !mapOf(room, m)?.done).length;
    $('p-sent-rest').textContent = rest > 0 ? `あと${rest}人が作っているよ。そのまま待ってね` : 'みんなできたよ。ホストが見せあいをはじめるよ';
    $('p-share').checked = mp.share !== false;
    return;
  }

  const n = mp.yosa.length;
  const pop = validPop(mp);
  state.pop = pop;
  // マップ（押して編集する）
  drawMap($('p-map'), ctx.name, mp, `pick:${room.round}:${room.seq || 0}:${ctx.name}`, {
    selected: pop ? (pop.k === 'add' ? 'add' : pop.yid) : null,
    onAdd: () => openPop({ k: 'add' }),
    onYosa: (yid) => openPop({ k: 'yosa', yid }),
    // 札を押したときの動き。本人: 自分の札は消す・見えた札は「もらう？」を出す。ほかの人: 自分が付けた印だけ外せる
    leafAct: (it) => {
      if (ctx.self) return isOffer(it) ? 'offer' : 'remove';
      return it.from.includes(state.nickname) ? 'withdraw' : null;
    },
    onLeaf: (yid, it, a) => (a === 'offer' ? openPop({ k: 'offer', yid, t: it.t }) : dropItem(ctx.name, yid, it.t, a === 'remove' ? 'self' : 'other')),
  });
  $('p-map-hint').textContent = n === 0
    ? '「＋」を押して、よさを足そう'
    : ctx.self ? '「＋」で足す・× で消す。よさを押すと場面を選びなおせるよ' : `「＋」を押して、${room.focus}さんのよさが見えた場面を足そう`;
  const lg = $('p-legend');
  lg.hidden = !hasFrom(mp);
  lg.lastChild.textContent = ctx.self ? '目の印の札は、ほかの人から見えた場面。点線の札を押すと、もらうか選べるよ' : '目の印の札は、ほかの人から見えた場面';
  // 完成のボタン: それぞれのマップは自分の分。みんなで1人のマップは、本人とホストだけ
  $('p-finish').hidden = !(own || host || state.nickname === room.focus);
  $('p-done').disabled = n === 0;

  // ポップアップ（ひらいているときだけ中身を作る）
  syncPop(!!pop, pop && pop.k === 'offer' ? 'p-offer-text' : 'p-panel-title');
  if (!pop) return;
  const offer = pop.k === 'offer';
  $('p-pickpane').hidden = offer;
  $('p-offer').hidden = !offer;
  $('p-foot').hidden = offer;
  if (offer) {
    const it = findItem(mp, pop.yid, pop.t);
    $('p-offer-from').textContent = `${fromText(it)}から見えた「${yosaOf(pop.yid).label}」`;
    $('p-offer-text').textContent = pop.t;
    $('p-offer-drop').hidden = !host; // 本人の代わりに押しているホストは、札ごと消せる
    return;
  }

  const gbox = $('p-genres');
  const ibox = $('p-items');
  const adding = pop.k === 'add';
  const addSelf = ctx.by === 'self'; // ポップアップの中は、足し方で文と札の印を決める
  const canDel = ctx.self || host;
  gbox.hidden = !adding;
  ibox.hidden = adding;
  $('p-del').hidden = adding || !canDel || state.confirmDel;
  $('p-del-confirm').hidden = adding || !state.confirmDel;
  const head = $('p-panel-icon');
  if (adding) {
    head.hidden = true;
    $('p-by').hidden = true;
    $('p-panel-title').textContent = addSelf ? 'どんなよさがありそう？' : `${room.focus}さんに、どんなよさがありそう？`;
    $('p-panel-note').textContent = '「ちょっとあるかも」くらいでいいよ';
    gbox.textContent = '';
    DATA.yosa.forEach((g) => {
      const on = mp.yosa.includes(g.id);
      const b = el('button', 'ym-genre');
      b.type = 'button';
      b.style.cssText = yosaStyle(g);
      if (on) b.classList.add('is-on');
      const ic = el('span', 'ym-genre__icon');
      ic.appendChild(icon(g.icon));
      b.append(ic, el('span', 'ym-genre__label', g.label));
      if (on) {
        const c = icon('check_circle');
        c.classList.add('ym-genre__check');
        b.appendChild(c);
        b.setAttribute('aria-label', `${g.label}（マップにあるよ。押すと場面を選べる）`);
      }
      b.addEventListener('click', () => {
        if (!on) addYosa(ctx.name, g.id);
        openPop({ k: 'yosa', yid: g.id }); // 足したら、そのまま場面を選ぶ
      });
      gbox.appendChild(b);
    });
    $('p-free').hidden = true;
    return;
  }

  const g = yosaOf(pop.yid);
  head.hidden = false;
  head.style.cssText = yosaStyle(g);
  head.textContent = '';
  head.appendChild(icon(g.icon));
  $('p-panel-title').textContent = addSelf
    ? `「${g.label}」が出るのは、どんなとき？`
    : `${room.focus}さんの「${g.label}」が見えたのは、どんなとき？`;
  $('p-panel-note').textContent = addSelf
    ? 'いくつ選んでもいいよ。もう一度押すと外れるよ'
    : '選ぶと、点線の札でマップに出るよ。もう一度押すと外れるよ';
  $('p-by').hidden = !ctx.pickBy;
  if (ctx.pickBy) segButtons($('p-by-seg'), [['self', `${room.focus}さんが選んだ`], ['other', 'わたしから見えた']], ctx.by, (v) => { state.by = v; render(); });
  ibox.style.cssText = yosaStyle(g);
  ibox.textContent = '';
  const picked = itemsOf(mp, pop.yid);
  const free = picked.filter((x) => !g.items.includes(x.t)).map((x) => x.t);
  g.items.concat(free).forEach((t) => {
    const it = picked.find((x) => x.t === t);
    const b = el('button', 'ym-item');
    b.type = 'button';
    const off = !!it && isOffer(it);
    const mineMark = !!it && it.from.includes(state.nickname);
    // 押してある印: 本人の側は「選んだ・もらった」、ほかの人の側は「自分が見えたと付けた」
    b.setAttribute('aria-pressed', String(addSelf ? !!(it && it.self) : mineMark));
    if (addSelf && off) b.classList.add('is-offer');
    if (it) b.appendChild(icon(it.from.length ? 'visibility' : 'check'));
    b.appendChild(el('span', null, t));
    if (addSelf && off) b.appendChild(el('span', 'ym-item__from', '押すともらえる'));
    if (!addSelf && it && it.self && !mineMark) b.appendChild(el('span', 'ym-item__from', '本人も選んでいるよ'));
    b.addEventListener('click', () => toggleItem(ctx.name, pop.yid, t, ctx.by));
    ibox.appendChild(b);
  });
  // 「自分で書く」は、本人とホストだけ
  const canFree = addSelf || host;
  const freeFull = free.length >= FREE_PER_YOSA;
  if (canFree && !freeFull) {
    const add = el('button', 'ym-item ym-item--add');
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
  $('p-free').hidden = !state.freeOpen || freeFull || !canFree;
  $('p-del').lastChild.textContent = `「${g.label}」をマップから消す`;
  $('p-del-q').textContent = picked.length ? `「${g.label}」と、選んだ${picked.length}こを消す？` : `「${g.label}」を消す？`;
}
// ホストの操作（それぞれのマップ: 見せあいをはじめる）。free: この画面にほかの主ボタンがないとき（自分の分ができた・進行だけ）
function drawPickHost(room, free) {
  const show = state.role === 'host' && modeOf(room) === 'own';
  $('p-host').hidden = !show;
  if (!show) return;
  const makers = makerNames(room);
  const done = doneNames(room).length;
  const all = makers.length > 0 && done >= makers.length;
  $('p-progress').textContent = `できた人　${done} / ${makers.length}`;
  $('p-host-note').textContent = all ? 'みんなできたよ' : 'まだの人がいても、はじめられるよ（そこまで選んだ分が出る）';
  $('btn-show').className = free && all ? 'btn btn-primary btn-lg' : 'btn btn-secondary';
}

// ══════════════════════════════════════════════
// 見せあう・ながめる
// ══════════════════════════════════════════════
function renderShow(room) {
  if (state.currentScreen !== 'show') showScreen('show');
  const host = state.role === 'host';
  const own = modeOf(room) === 'own';
  const order = arr(room.show?.order);
  const idx = room.show?.idx || 0;
  const people = $('s-people');
  people.textContent = '';
  order.forEach((n, i) => {
    const b = el('button', 'ym-person', own ? n : `${n}さんのよさマップ`);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === idx));
    b.disabled = !host || !own;
    if (host && own) b.addEventListener('click', () => jumpShow(i));
    people.appendChild(b);
  });
  const name = order[idx];
  const mp = name ? cleanMap(mapOf(room, name)) : null;
  $('s-empty').hidden = !!name;
  $('s-map').hidden = !name;
  if (name) drawMap($('s-map'), name, mp, `show:${room.round}:${name}`);
  $('s-legend').hidden = !hasFrom(mp);
  $('s-ask').hidden = !room.show?.ask;
  $('s-ask-text').textContent = room.show?.ask || '';
  $('btn-ask').hidden = !host;
  $('s-host').hidden = !host;
  $('s-wait').hidden = host;
  if (!host) return;
  const many = own && order.length > 1;
  const last = idx >= order.length - 1;
  $('s-nav').hidden = !many;
  $('s-count').textContent = order.length ? `${idx + 1} / ${order.length}人め` : '';
  // さいごの人まで見たら、主ボタンは置かない（はじめの人にもどるのは補助）
  const nb = $('btn-next');
  nb.className = last ? 'btn btn-secondary' : 'btn btn-primary btn-lg';
  nb.firstChild.textContent = last ? 'はじめの人へ' : 'つぎの人';
  nb.lastChild.textContent = last ? 'replay' : 'chevron_right';
  // みんなで1人のマップ: つぎの人を選ぶ（前の人のマップは残っている）
  const others = own ? [] : memberNames(room).filter((n) => n !== room.focus);
  $('s-nextone').hidden = !others.length;
  if (others.length) {
    const box = $('s-next-names');
    box.textContent = '';
    others.forEach((n) => {
      const b = el('button', null, arr(mapOf(room, n)?.yosa).length ? `${n}（つづき）` : n);
      b.type = 'button';
      b.addEventListener('click', () => nextOne(n));
      box.appendChild(b);
    });
  }
  $('btn-copy-result').disabled = !name;
}
// チャットに貼る用の文（絵文字なし）
function resultText(name, mp) {
  const out = [`よさマップ（${name}）`];
  mp.yosa.forEach((yid) => {
    out.push('', yosaOf(yid).label);
    itemsOf(mp, yid).forEach((it) => out.push(`・${it.t}${it.from.length ? `（${fromText(it)}から）` : ''}`));
  });
  return out.join('\n');
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
function ruleText(room) {
  if (modeOf(room) === 'own') return 'それぞれ自分のよさマップを作って、見せあうよ';
  const f = focusPick(room);
  return f ? `みんなで${f}さんのよさマップを作るよ` : 'みんなで1人のよさマップを作るよ';
}

function render() {
  const room = state.room;
  if (!room || !state.roomRef) return;
  // 画面が変わった・作るマップが変わったら、ポップアップを閉じて上にもどす
  const key = `${room.status}:${room.seq || 0}:${room.focus || ''}`;
  if (key !== lastStatus) {
    lastStatus = key;
    state.pop = null;
    state.freeOpen = false;
    state.confirmDel = false;
    state.by = null;
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
  const mode = modeOf(room);
  const plays = hostPlaysOf(room);
  const ul = $('lobbyPlayers');
  ul.textContent = '';
  const names = [room.host].filter((n) => room.players?.[n]).concat(guestNames(room).sort((a, b) => (room.players[a].joinedAt || 0) - (room.players[b].joinedAt || 0)));
  names.forEach((n) => {
    const li = el('li', null, n);
    if (n === room.host) li.append(el('small', null, mode === 'own' && !plays ? '進行役' : 'ホスト'));
    ul.append(li);
  });
  // 端末なしの参加者。印と「外す」はホストの画面にだけ出す
  proxyNames(room).forEach((n) => {
    const li = el('li', null, n);
    if (host) {
      li.append(el('small', null, '端末なし'));
      const x = el('button', 'ym-chip-x');
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
  segButtons($('mode-opts'), MODES, mode, (v) => setSetting('mode', v));
  $('modeNote').textContent = mode === 'own'
    ? 'それぞれの画面で自分のマップを作る。できたら、1人ずつ大きく出して見せあう'
    : '1人のマップをみんなの画面に出して、いっしょに作る。本人が選んだ札と、ほかの人から見えた札がまざる。2人で使うときもこちら';
  const focus = focusPick(room);
  $('focusField').hidden = mode !== 'one';
  if (mode === 'one') segButtons($('focus-opts'), memberNames(room).map((n) => [n, n]), focus, (v) => setSetting('focus', v));
  $('hostPlaysField').hidden = mode !== 'own';
  $('setHostPlays').checked = plays;
  const full = proxyNames(room).length >= PROXY_MAX;
  $('proxyName').disabled = full;
  $('btnAddProxy').disabled = full;
  if (mode === 'one') {
    $('btnStart').disabled = !focus;
    $('startNote').textContent = focus ? `${focus}さんのマップを作るよ` : '1台で使うときは、「くわしい設定」の「端末なしの参加者を足す」に名前を入れてね';
  } else {
    const count = makerNames(room).length;
    $('btnStart').disabled = count < 1;
    $('startNote').textContent = count < 1 ? 'マップを作る人がいないよ。「自分も作る」を入れるか、参加用のリンクを送ってね' : `マップを作る人は${count}人`;
  }
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
// いまひらいているポップアップの、マップの名前と足し方
function popCtx() {
  const room = state.room;
  if (!room || room.status !== STATUS.PICK || !state.pop) return null;
  const ctx = editCtx(room);
  return ctx.name ? ctx : null;
}
$('p-free').addEventListener('submit', (e) => {
  e.preventDefault();
  if (composing) return;
  const ctx = popCtx();
  const t = clean($('p-free-input').value, FREE_MAX);
  if (!ctx || state.pop.k !== 'yosa' || !t) return;
  const mp = cleanMap(mapOf(state.room, ctx.name));
  // もうある札は、押しなおし（外す）にならないよう足さない
  if (!findItem(mp, state.pop.yid, t)) toggleItem(ctx.name, state.pop.yid, t, ctx.by);
  $('p-free-input').value = '';
  state.freeOpen = false;
  render();
});
$('p-done').addEventListener('click', () => {
  const room = state.room;
  if (!room) return;
  if (modeOf(room) === 'own') setDone(true); else finishOne();
});
$('p-redo').addEventListener('click', () => setDone(false));
$('p-share').addEventListener('change', () => {
  const room = state.room;
  if (!room || !state.target || room.status !== STATUS.PICK || modeOf(room) !== 'own') return;
  const share = $('p-share').checked;
  editMap(state.target, (mp) => { mp.share = share; return true; });
});
$('p-del').addEventListener('click', () => {
  const ctx = popCtx();
  if (!ctx || state.pop.k !== 'yosa') return;
  const yid = state.pop.yid;
  // 場面を選んでいるときだけ、消す前に確かめる
  if (itemsOf(cleanMap(mapOf(state.room, ctx.name)), yid).length) { state.confirmDel = true; render(); $('p-del-yes').focus(); } else { removeYosa(ctx.name, yid, ctx.by); closePop(); }
});
$('p-del-yes').addEventListener('click', () => {
  const ctx = popCtx();
  if (ctx && state.pop.k === 'yosa') removeYosa(ctx.name, state.pop.yid, ctx.by);
  closePop();
});
$('p-del-no').addEventListener('click', () => { state.confirmDel = false; render(); });
$('p-offer-take').addEventListener('click', () => {
  const ctx = popCtx();
  if (ctx && state.pop.k === 'offer') acceptItem(ctx.name, state.pop.yid, state.pop.t);
  closePop();
});
$('p-offer-keep').addEventListener('click', closePop);
$('p-offer-drop').addEventListener('click', () => {
  const ctx = popCtx();
  if (ctx && state.pop.k === 'offer') dropItem(ctx.name, state.pop.yid, state.pop.t, 'self');
  closePop();
});
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
$('btn-copy-result').addEventListener('click', async (event) => {
  const room = state.room;
  const name = arr(room?.show?.order)[room?.show?.idx || 0];
  if (!name) return;
  const b = event.currentTarget;
  try {
    await navigator.clipboard.writeText(resultText(name, cleanMap(mapOf(room, name))));
    b.textContent = 'コピーしたよ';
    setTimeout(() => { b.textContent = 'このマップをコピー'; }, 2000);
  } catch {
    toast('コピーできませんでした');
  }
});

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

// 画面の幅が変わったら（スマホを横にしたときなど）、マップを描きなおす
let resizeTimer = null;
let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (window.innerWidth === lastWidth) return; // 高さだけの変化（キーボードが出た）は描きなおさない
  lastWidth = window.innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(render, 150);
});

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
