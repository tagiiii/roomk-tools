// 作戦会議チャット：話題ごとに会話が分かれるチャット（メンターと、参加する人2人まで）
// 会話と画像はルーム（Realtime Database）に置き、メンターが「終わる」を押すとすべて消える。履歴は持たない。
// 仕様・共通規約からの例外の正本は AGENTS.md。

const { authReady, db } = RoomkRTDB.initFirebase(firebase);

const ROOMS = 'sakusenchat_rooms';
const STATUS_OPEN = 'open';
const BASE_TITLE = '作戦会議チャット | room-K';
// 新着の音・通知音は鳴らさない（聴覚過敏への配慮。AGENTS.md「未読・入力中」）

// ルームのカギ。リンクを知っている人だけが読めるように、6文字のコードではなく長いカギを使う（AGENTS.md「ルームのカギ」）
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KEY_LENGTH = 20;
const KEY_RE = /^[A-HJ-NP-Z2-9]{20}$/;
// メンター用のリンク（?mentor=…）のカギの SHA-256。カギそのものはリポジトリに置かない
const MENTOR_KEY_HASH = 'eccb9f86a20618e1125343c0fdb38532d55cb52a688e1c43a5e53db0c0dd9cde';

const MAX_GUESTS = 2;
const NAME_MAX = 8;
const TITLE_MAX = 30;
const TEXT_MAX = 500;
const NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩',
  '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
const TOPIC_MAX = NUMBERS.length;
const IMG_MAX = 40;
const IMG_MAX_CHARS = 700 * 1000;
// 大きすぎるときは、順に小さくして作り直す（長い辺・JPEG の品質）
const IMG_STEPS = [[1280, 0.82], [1280, 0.7], [1024, 0.7], [800, 0.65], [640, 0.6]];
const IMG_SRC_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const THUMB_MAX = 260;

// メンターの接続が切れてから、ルームを期限切れとして消すまで。
// 共通の2分ではなく10分（会話の途中で消えないように。AGENTS.md「切断時の挙動」）
const ORPHAN_TTL_CHAT_MS = 10 * 60 * 1000;
const HOST_OFF_GRACE_MS = 4000;
const OFFLINE_NOTE_MS = 1500;
const PRESENCE_RETRY_MS = 5000;
const TX_RETRY_MAX = 3;
const TYPING_MS = 5000;
const TYPING_SEND_GAP_MS = 2500;
const NEAR_BOTTOM_PX = 80;
const MY_ROOMS_MAX = 12;
const MY_ROOMS_KEEP_MS = 14 * 24 * 60 * 60 * 1000;

const SESSION_KEY = 'sakusenchat_session';
const MID_KEY = 'sakusenchat_mid';
const MY_ROOMS_KEY = 'sakusenchat_my_rooms';
const NAME_KEY = 'sakusenchat_name';
const MENTOR_KEY = 'sakusenchat_mentor';

// ルームを作ったとき、最初から並ぶ話題
const FIRST_TOPICS = {
  a_checkin: { title: 'チェックイン', kind: 'free' },
  b_mood: { title: 'ジブンチェック', kind: 'mood' },
};
const MOOD_QUESTION = '今日の調子はどのへん？';
const MOODS = [
  { num: '⑤', text: '絶好調' },
  { num: '④', text: '調子がよさそう' },
  { num: '③', text: 'いつも通り' },
  { num: '②', text: '少し気持ちが落ち込んでいる' },
  { num: '①', text: 'とても気持ちが落ち込んでいる' },
];
const MOOD_PASS = '今日は答えない';

const JOIN_ERRORS = {
  gone: 'このルームは、もう終わっているよ。メンターに新しいリンクをもらってね。',
  full: 'このルームには、もう3人入っているよ。',
  dup: '同じ名前の人がいるよ。別の名前にしてね。',
};

const $ = (id) => document.getElementById(id);

// このページの読みこみ1回ごとの印（同じ人の id を持つ別のタブと区別する）
const TAB_ID = Math.random().toString(36).slice(2);
let midWasStored = false;

const state = {
  // ユーザー情報
  role: null,            // 'host'（メンター） | 'guest'
  nickname: null,
  roomCode: null,        // ルームのカギ
  roomRef: null,
  mid: loadMid(),        // このタブの人を表す id（同じブラウザの別タブは匿名認証の uid が同じなので、uid では区別しない）
  isMentor: false,

  // 画面管理
  currentScreen: 'top',
  joinKey: null,
  prevKey: null,

  // ルームの状態
  meta: null,
  isConnected: false,
  offlineAt: 0,
  leaving: false,
  busy: false,
  presenceAt: 0,
  subs: [],

  // 会話
  topics: [],
  topicsLoaded: false,
  firstJoin: true,
  byTopic: new Map(),    // 話題 id → メッセージの配列（id の順）
  msgIndex: new Map(),   // メッセージ id → メッセージ
  msgsLoaded: false,
  read: {},              // 話題 id → 読んだ最後のメッセージ id
  seen: new Set(),       // ひらいたことのある話題
  divider: {},           // 話題 id → 「ここから新しいメッセージ」の線を引くメッセージ id
  typing: {},            // 人の id → { t, name, at, until }
  typingKey: '',
  current: null,
  drafts: {},            // 話題 id → 書きかけ { text, img }
  pendingImg: null,      // { src, w, h }
  imgCache: new Map(),
  imgWait: new Map(),
  typingSentAt: 0,
  typingOn: false,

  // クリーンアップ用
  timerInterval: null,
  saveTimer: null,
};

let confirmAction = null;
const narrow = window.matchMedia('(max-width: 600px)');
const coarse = window.matchMedia('(pointer: coarse)');

/* ── こまかい部品 ── */

function showScreen(id) {
  document.querySelectorAll('.sc-screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  document.body.classList.toggle('sc-chatting', id === 'chat');
  state.currentScreen = id;
}

function setError(id, message) {
  RoomkRTDB.showFormError(id, message);
}

function toast(message, isError = true) {
  RoomkRTDB.showToast(message, isError);
}

function currentUid() {
  return firebase.auth().currentUser?.uid || null;
}

function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

function roomRefOf(key) {
  return db.ref(ROOMS + '/' + key);
}

function randomChars(length) {
  const a = new Uint32Array(length);
  crypto.getRandomValues(a);
  return Array.from(a, (n) => KEY_CHARS[n % KEY_CHARS.length]).join('');
}

function validName(value) {
  if (!value) return '名前を入れてね';
  if (Array.from(value).length > NAME_MAX) return '名前は' + NAME_MAX + '文字までだよ';
  return '';
}

function storeGet(store, key) {
  try { return store.getItem(key); } catch { return null; }
}

function storeSet(store, key, value) {
  try { store.setItem(key, value); } catch { /* 保存できないときは、その機能が使えないだけ */ }
}

function storeRemove(store, key) {
  try { store.removeItem(key); } catch { /* 何もしない */ }
}

function loadMid() {
  let mid = storeGet(sessionStorage, MID_KEY);
  if (!mid || !/^[A-Z2-9]{12}$/.test(mid)) mid = newMid();
  else midWasStored = true;
  return mid;
}

function newMid() {
  const mid = randomChars(12);
  storeSet(sessionStorage, MID_KEY, mid);
  return mid;
}

// 「タブを複製」すると sessionStorage ごと写るので、同じ人の id のタブが2つできる
// （片方を閉じると、もう片方の席まで消える）。ほかのタブが同じ id を使っていたら true を返す
function midIsTaken() {
  if (typeof BroadcastChannel !== 'function') return Promise.resolve(false);
  return new Promise((resolve) => {
    let taken = false;
    const channel = new BroadcastChannel('sakusenchat_tabs');
    channel.onmessage = (e) => {
      const d = e.data || {};
      if (d.type === 'hello' && d.mid === state.mid && d.tab !== TAB_ID) channel.postMessage({ type: 'taken', to: d.tab });
      else if (d.type === 'taken' && d.to === TAB_ID) taken = true;
    };
    if (!midWasStored) {
      resolve(false);
      return;
    }
    channel.postMessage({ type: 'hello', mid: state.mid, tab: TAB_ID });
    setTimeout(() => resolve(taken), 200);
  });
}

/* ── メンター用のリンク ── */

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function isMentorKey(value) {
  try {
    return (await sha256Hex(String(value).trim())) === MENTOR_KEY_HASH;
  } catch {
    return false;
  }
}

// ?mentor=… でひらいた端末を「メンターの端末」としておぼえる（つぎからはリンクなしでルームを作れる）
async function initMentor() {
  const params = new URLSearchParams(location.search);
  const given = params.get('mentor');
  let key = storeGet(localStorage, MENTOR_KEY);
  if (given !== null) {
    params.delete('mentor');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    if (await isMentorKey(given)) {
      key = given.trim();
      storeSet(localStorage, MENTOR_KEY, key);
    } else {
      toast('メンター用のリンクが正しくないよ');
    }
  }
  state.isMentor = !!key && await isMentorKey(key);
}

/* ── 再接続用の記録・この端末が入ったルームの記録（会話の中身は保存しない） ── */

function saveSession() {
  if (!state.roomCode) return;
  storeSet(sessionStorage, SESSION_KEY, JSON.stringify({
    key: state.roomCode,
    role: state.role,
    name: state.nickname,
    read: state.read,
    seen: Array.from(state.seen),
    current: state.current,
  }));
}

function scheduleSave() {
  if (state.saveTimer || !state.roomCode) return;
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    saveSession();
  }, 300);
}

function loadSession() {
  try {
    const s = JSON.parse(storeGet(sessionStorage, SESSION_KEY));
    if (!s || !KEY_RE.test(s.key) || (s.role !== 'host' && s.role !== 'guest') || validName(String(s.name || ''))) return null;
    return s;
  } catch {
    return null;
  }
}

function clearSession() {
  storeRemove(sessionStorage, SESSION_KEY);
}

function loadMyRooms() {
  try {
    const list = JSON.parse(storeGet(localStorage, MY_ROOMS_KEY));
    return Array.isArray(list) ? list.filter((x) => x && KEY_RE.test(x.key)) : [];
  } catch {
    return [];
  }
}

function saveMyRooms(list) {
  storeSet(localStorage, MY_ROOMS_KEY, JSON.stringify(list.slice(-MY_ROOMS_MAX)));
}

// 「終わる」を押さずに閉じたルームを、つぎにひらいたときに片付けられるようにおぼえておく
function rememberRoom(key, role) {
  const list = loadMyRooms().filter((x) => x.key !== key);
  list.push({ key, role, at: Date.now() });
  saveMyRooms(list);
}

function forgetRoom(key) {
  saveMyRooms(loadMyRooms().filter((x) => x.key !== key));
}

/* ── ルームの期限切れ ── */

function isExpired(meta) {
  // status を持たない meta は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(meta, ORPHAN_TTL_CHAT_MS) || (!!meta && !meta.status);
}

// 期限切れのルームを消す。会話と画像まで消せたときだけ true を返す
// （false のときは、この端末の記録に残しておき、つぎにひらいたときにもう一度ためす）
async function removeExpiredRoom(key, fallback) {
  const roomRef = roomRefOf(key);
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    const result = await roomRef.child('meta').transaction((meta) => {
      const current = meta || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
    if (!result.committed) return false;
    await roomRef.remove();
    return true;
  } catch (error) {
    console.warn('[sakusen-chat] expired room cleanup failed', error);
    return false;
  }
}

// 終わっているルーム（meta がない・期限切れ）の残りを消す。消せたら、この端末の記録からも外す
async function clearDeadRoom(key, meta) {
  let cleared = false;
  if (meta) {
    cleared = await removeExpiredRoom(key, meta);
  } else {
    cleared = await roomRefOf(key).remove().then(() => true, () => false);
  }
  if (cleared) forgetRoom(key);
  return cleared;
}

// transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
function warmCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => {
      resolve({ snap, release: () => ref.off('value', callback) });
    };
    ref.on('value', callback, reject);
  });
}

// 送信したあとに通信が切れると、transaction は Error('disconnect') で中止される（サーバーに届いたかは分からない）。
// 作成と参加は少しだけやり直す。update は、前の送信が届いていたら成功として扱うように書く
async function transactRetry(ref, update) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ref.transaction(update);
    } catch (error) {
      if (error?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
    }
  }
}

async function waitAuth(quiet = false) {
  try {
    await authReady;
    return true;
  } catch {
    if (!quiet) toast('うまくつながらなかったよ。ページを読み直してね');
    return false;
  }
}

/* ── ルームを作る・参加する・もどる ── */

async function createRoom() {
  if (state.busy || state.roomRef || !state.isMentor) return;
  const name = $('hostName').value.trim();
  const error = validName(name);
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
    const key = randomChars(KEY_LENGTH);
    const topics = {};
    Object.keys(FIRST_TOPICS).forEach((id) => {
      topics[id] = { ...FIRST_TOPICS[id], mid: state.mid, at: serverTimestamp() };
    });
    // 切断時の予約を張る前なので「切断中」として作り、つないだあとの在室確認で接続中にする
    const initial = {
      meta: {
        status: STATUS_OPEN,
        createdAt: serverTimestamp(),
        hostUid: uid,
        hostName: name,
        hostConnected: false,
        hostDisconnectedAt: serverTimestamp(),
      },
      topics,
    };
    // 作った直後のルームは空なので、ルーム全体の transaction で確保する（会話が入ってからは使わない）
    const result = await transactRetry(roomRefOf(key), (room) => {
      if (room) return room.meta?.hostUid === uid ? room : undefined;
      return initial;
    });
    if (!result.committed) {
      setError('createError', 'ルームを作れなかったよ。もう一度ためしてね');
      return;
    }
    rememberRoom(key, 'host');
    storeSet(localStorage, NAME_KEY, name);
    window.RoomkStats?.count('room-create');
    connectToRoom('host', name, key, null);
  } catch (error) {
    console.warn('[sakusen-chat] create failed', error);
    setError('createError', 'うまくつながらなかったよ。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

// 参加する人の席を取る。席は meta/guests/{このタブの id}。同じ id なら入りなおしとして通す
async function claimSeat(key, name) {
  const uid = currentUid();
  const mid = state.mid;
  const metaRef = roomRefOf(key).child('meta');
  const seatRef = metaRef.child('guests/' + mid);
  const warm = await warmCache(metaRef);
  try {
    const pre = warm.snap.val();
    if (!pre || isExpired(pre)) {
      // 終わっているルームのリンク。残りがあれば消す。消しきれなかったときのために、先にこの端末の記録に入れておく
      // （clearDeadRoom は、消せたら記録から外す）
      rememberRoom(key, 'guest');
      await clearDeadRoom(key, pre);
      return { ok: false, reason: 'gone' };
    }
    // 席のキーは自分の id なので、先に切断時の予約を張っても他の人の在室は消えない
    await seatRef.onDisconnect().remove();
    let reason = 'gone';
    const result = await transactRetry(metaRef, (meta) => {
      reason = 'gone';
      if (!meta || meta.status !== STATUS_OPEN || isExpired(meta)) return undefined;
      const guests = { ...(meta.guests || {}) };
      // 同じブラウザから同じ名前で入り直したときは、前の在室を引きつぐ
      Object.keys(guests).forEach((id) => {
        if (id !== mid && guests[id]?.uid === uid && guests[id]?.name === name) delete guests[id];
      });
      const others = Object.keys(guests).filter((id) => id !== mid);
      if (name === meta.hostName || others.some((id) => guests[id]?.name === name)) {
        reason = 'dup';
        return undefined;
      }
      if (others.length >= MAX_GUESTS) {
        reason = 'full';
        return undefined;
      }
      guests[mid] = { name, uid, joinedAt: guests[mid]?.joinedAt || RoomkRTDB.now() };
      return { ...meta, guests };
    });
    if (result.committed) return { ok: true };
    return { ok: false, reason };
  } finally {
    warm.release();
  }
}

// 席を取れなかった・失敗したときは、切断時の予約を残さない
async function enterAsGuest(key, name) {
  const seatRef = roomRefOf(key).child('meta/guests/' + state.mid);
  try {
    const result = await claimSeat(key, name);
    if (!result.ok) await seatRef.onDisconnect().cancel().catch(() => {});
    return result;
  } catch (error) {
    await seatRef.onDisconnect().cancel().catch(() => {});
    throw error;
  }
}

async function joinRoom() {
  if (state.busy || state.roomRef || !state.joinKey) return;
  const name = $('guestName').value.trim();
  const error = validName(name);
  if (error) {
    setError('joinError', error);
    return;
  }
  setError('joinError', '');
  state.busy = true;
  $('btnJoinRoom').disabled = true;
  const key = state.joinKey;
  try {
    if (!await waitAuth()) return;
    const result = await enterAsGuest(key, name);
    if (!result.ok) {
      setError('joinError', JOIN_ERRORS[result.reason] || JOIN_ERRORS.gone);
      return;
    }
    rememberRoom(key, 'guest');
    storeSet(localStorage, NAME_KEY, name);
    connectToRoom('guest', name, key, null);
  } catch (error) {
    console.warn('[sakusen-chat] join failed', error);
    setError('joinError', 'うまくつながらなかったよ。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnJoinRoom').disabled = false;
  }
}

// 再読み込みのあと、同じルームにもどる。もどれないときは、参加の画面に出すカギ（あれば）とメッセージを返す
async function tryReconnect(session) {
  if (!await waitAuth()) return { ok: false, joinKey: session.role === 'guest' ? session.key : null };
  const key = session.key;
  try {
    const meta = (await roomRefOf(key).child('meta').once('value')).val();
    if (!meta || !meta.status || isExpired(meta)) {
      clearSession();
      await clearDeadRoom(key, meta);
      toast('前のルームは、もう終わっていたよ', false);
      return { ok: false, joinKey: null };
    }
    if (session.role === 'host') {
      if (meta.hostUid !== currentUid()) {
        clearSession();
        return { ok: false, joinKey: null };
      }
      connectToRoom('host', String(meta.hostName), key, session);
      return { ok: true };
    }
    const result = await enterAsGuest(key, session.name);
    if (!result.ok) {
      clearSession();
      if (result.reason === 'gone') {
        toast('前のルームは、もう終わっていたよ', false);
        return { ok: false, joinKey: null };
      }
      return { ok: false, joinKey: key, message: JOIN_ERRORS[result.reason] };
    }
    connectToRoom('guest', session.name, key, session);
    return { ok: true };
  } catch (error) {
    console.warn('[sakusen-chat] reconnect failed', error);
    toast('うまくつながらなかったよ。ページを読み直してね');
    return { ok: false, joinKey: session.role === 'guest' ? key : null };
  }
}

// メンターが「終わる」を押さずに閉じた前のルームにもどる
async function resumePrev() {
  const key = state.prevKey;
  if (state.busy || state.roomRef || !key) return;
  state.busy = true;
  $('btnPrevResume').disabled = true;
  try {
    if (!await waitAuth()) return;
    const meta = (await roomRefOf(key).child('meta').once('value')).val();
    if (!meta || !meta.status || isExpired(meta) || meta.hostUid !== currentUid()) {
      if (!meta || isExpired(meta)) await clearDeadRoom(key, meta);
      else forgetRoom(key);
      state.prevKey = null;
      renderTop();
      toast('前のルームは、もう終わっていたよ', false);
      return;
    }
    state.prevKey = null;
    connectToRoom('host', String(meta.hostName), key, null);
  } catch (error) {
    console.warn('[sakusen-chat] resume failed', error);
    toast('うまくつながらなかったよ。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnPrevResume').disabled = false;
  }
}

async function deletePrev() {
  const key = state.prevKey;
  if (!key || state.busy) return;
  state.busy = true;
  try {
    if (!await waitAuth()) return;
    await roomRefOf(key).remove();
    forgetRoom(key);
    state.prevKey = null;
    renderTop();
    toast('前のルームを消したよ', false);
    sweepMyRooms();
  } catch (error) {
    console.warn('[sakusen-chat] delete previous room failed', error);
    toast('消せなかったよ。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

// この端末が前に入ったルームを見て、終わっているもの・期限切れのものを片付ける。
// メンターが作って残っているルームがあれば、はじめの画面で「もどる／消す」を選べるようにする
async function sweepMyRooms() {
  const list = loadMyRooms();
  if (!list.length || !await waitAuth(true)) return;
  const uid = currentUid();
  const gone = new Set();
  let prev = null;
  for (const item of list) {
    if (item.key === state.roomCode) continue;
    try {
      const meta = (await roomRefOf(item.key).child('meta').once('value')).val();
      if (!meta || isExpired(meta)) {
        // meta がなければルームは終わっている。残りかすがあっても消す。消せなかったら、つぎの機会にもう一度ためす
        await clearDeadRoom(item.key, meta);
      } else if (item.role === 'host' && meta.hostUid === uid) {
        if (!prev) prev = item.key;
      } else if (Date.now() - Number(item.at || 0) > MY_ROOMS_KEEP_MS) {
        gone.add(item.key);
      }
    } catch (error) {
      console.warn('[sakusen-chat] sweep failed', error);
    }
  }
  if (gone.size) saveMyRooms(loadMyRooms().filter((x) => !gone.has(x.key)));
  if (!state.roomRef) {
    state.prevKey = state.isMentor ? prev : null;
    renderTop();
  }
}

function subscribe(ref, event, callback) {
  const roomRef = state.roomRef;
  const guarded = (snap) => {
    if (state.roomRef !== roomRef) return;
    callback(snap);
  };
  ref.on(event, guarded, (error) => {
    console.warn('[sakusen-chat] listener failed', error);
    if (state.roomRef === roomRef && !state.leaving) toast('ルームの読み込みに失敗しました');
  });
  state.subs.push({ ref, event, callback: guarded });
}

function connectToRoom(role, name, key, restore) {
  // 念のため、前のルームの購読・タイマーが残っていたら片付けてからつなぐ
  if (state.roomRef) cleanupRoom();
  const roomRef = roomRefOf(key);
  state.role = role;
  state.nickname = name;
  state.roomCode = key;
  state.roomRef = roomRef;
  state.read = restore?.read && typeof restore.read === 'object' ? { ...restore.read } : {};
  state.seen = new Set(Array.isArray(restore?.seen) ? restore.seen : []);
  // 再読み込みのあとは、見ていた話題にもどる
  state.current = typeof restore?.current === 'string' ? restore.current : null;
  state.firstJoin = !restore;
  saveSession();
  // 参加用のリンク（?room=カギ）でひらいたときは、つないだあとにカギをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  const host = role === 'host';
  $('btnCopyLink').hidden = !host;
  if ($('btnShowQr')) $('btnShowQr').hidden = !host;
  $('btnFinish').hidden = !host;
  $('btnLeave').hidden = host;
  $('screen-chat').dataset.view = 'list';
  showScreen('chat');
  renderPeers();
  renderConnection();
  renderTalk();
  renderTopics();

  subscribe(roomRef.child('meta'), 'value', (snap) => handleMeta(snap.val()));
  subscribe(roomRef.child('topics'), 'value', (snap) => handleTopics(snap.val()));
  const msgsRef = roomRef.child('msgs');
  subscribe(msgsRef, 'child_added', (snap) => onMsgAdded(snap.key, snap.val()));
  subscribe(msgsRef, 'child_removed', (snap) => onMsgRemoved(snap.key));
  // child_added が今ある分を配り終えたあとに value が来る。そこまでを「最初の読みこみ」として、まとめて描く
  msgsRef.once('value').then(() => {
    if (state.roomRef !== roomRef) return;
    state.msgsLoaded = true;
    if (state.current && watching(state.current)) markRead(state.current);
    renderTalk();
    renderTopics();
  }).catch((error) => console.warn('[sakusen-chat] first load failed', error));
  subscribe(roomRef.child('typing'), 'value', (snap) => handleTyping(snap.val()));
  subscribe(db.ref('.info/connected'), 'value', (snap) => {
    state.isConnected = snap.val() === true;
    renderConnection();
    if (state.isConnected) ensurePresence(true);
  });
  state.timerInterval = setInterval(tickRoom, 1000);
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.saveTimer);
  state.subs.forEach((s) => s.ref.off(s.event, s.callback));
  if (state.roomRef) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  Object.assign(state, {
    role: null,
    nickname: null,
    roomCode: null,
    roomRef: null,
    meta: null,
    isConnected: false,
    offlineAt: 0,
    leaving: false,
    presenceAt: 0,
    subs: [],
    topics: [],
    topicsLoaded: false,
    firstJoin: true,
    byTopic: new Map(),
    msgIndex: new Map(),
    msgsLoaded: false,
    read: {},
    seen: new Set(),
    divider: {},
    typing: {},
    typingKey: '',
    current: null,
    drafts: {},
    pendingImg: null,
    imgCache: new Map(),
    imgWait: new Map(),
    typingSentAt: 0,
    typingOn: false,
    timerInterval: null,
    saveTimer: null,
  });
  clearSession();
  // 前のルームの中身を、隠れている画面に残さない
  $('msgList').replaceChildren();
  $('topicList').replaceChildren();
  $('talkTitle').textContent = '';
  $('textInput').value = '';
  growText();
  showPending(null);
  $('fileInput').value = '';
  closeAddForm();
  $('btnFinish').disabled = false;
  $('hostOffOverlay').hidden = true;
  $('offlineNote').hidden = true;
  $('typingNote').hidden = true;
  $('btnNewer').hidden = true;
  if ($('viewer').open) $('viewer').close();
  if ($('confirmDialog').open) $('confirmDialog').close();
  document.title = BASE_TITLE;
}

function showEnd(lead, withTop) {
  $('endLead').textContent = lead;
  $('btnEndTop').hidden = !withTop;
  showScreen('end');
}

// ルームがなくなった・期限が切れたのを知ったとき
function endLocally(expired) {
  const key = state.roomCode;
  const roomRef = state.roomRef;
  const host = state.role === 'host';
  // cleanupRoom が切断時の予約を取り消す。そのあとに、ルームの残りかすを消す
  // （終わる直前に自分が送った書き込みが、ルームの削除よりあとに届いていても、この削除はそのあとに届く）。
  // 消せたら、この端末の記録からも外す。期限切れのときは、呼んだ側が removeExpiredRoom の結果で外す
  cleanupRoom();
  if (!expired && roomRef) {
    roomRef.remove().then(() => forgetRoom(key)).catch((error) => {
      console.warn('[sakusen-chat] leftover cleanup failed', error);
    });
  }
  showEnd(expired
    ? 'メンターがもどらなかったので、ルームをとじたよ。会話と画像は、すべて消えたよ。'
    : '会話と画像は、すべて消えたよ。', host || state.isMentor);
}

async function finishRoom() {
  const roomRef = state.roomRef;
  const key = state.roomCode;
  if (!roomRef || state.leaving || state.role !== 'host') return;
  if (!state.isConnected) {
    toast('接続が切れているよ。つながってから、もう一度押してね');
    return;
  }
  state.leaving = true;
  $('btnFinish').disabled = true;
  try {
    // 削除の前に切断時の予約を取り消す（残っていると、消したあとの切断でルームのかけらが作り直される）。
    // 取り消しに失敗したら消さずにやめるので、失敗を握りつぶす共通の cancelRoomOnDisconnect は使わない。
    // 途中で打ち切らずに、消えるまで待つ（打ち切って会話にもどすと、あとから届いた削除で消える）
    await roomRef.onDisconnect().cancel();
    await roomRef.remove();
  } catch (error) {
    console.warn('[sakusen-chat] finish failed', error);
    state.leaving = false;
    $('btnFinish').disabled = false;
    ensurePresence(true);
    toast('終われなかったよ。もう一度ためしてね');
    return;
  }
  $('btnFinish').disabled = false;
  cleanupRoom();
  forgetRoom(key);
  showEnd('会話と画像は、すべて消えたよ。', true);
}

function leaveRoom() {
  const roomRef = state.roomRef;
  const key = state.roomCode;
  const mid = state.mid;
  if (!roomRef || state.leaving || state.role !== 'guest') return;
  state.leaving = true;
  // 切れている間は、サーバーが切断時の予約で席を消している。
  // つながっているときは、応答を待たずにその場で送る（送った順に届くので、このあと入り直した席を消さない）
  if (state.isConnected) {
    roomRef.child('typing/' + mid).remove().catch(() => {});
    roomRef.child('meta/guests/' + mid).remove().catch(() => {});
  }
  cleanupRoom();
  // まちがえて押したときに入り直せるよう、参加の画面にもどす
  openJoin(key, '');
}

// 自分の席がなくなっていて、もどれなかったとき
function kickedOut(reason) {
  const key = state.roomCode;
  cleanupRoom();
  openJoin(key, reason === 'full' ? JOIN_ERRORS.full : '同じ名前の人が入っているよ。別の名前で入り直してね。');
}

function openJoin(key, message) {
  state.joinKey = key;
  if (!new URLSearchParams(location.search).has('room')) {
    history.replaceState(null, '', location.pathname + '?room=' + key);
  }
  if (!$('guestName').value) $('guestName').value = storeGet(localStorage, NAME_KEY) || '';
  setError('joinError', message || '');
  showScreen('join');
  if (!coarse.matches) $('guestName').focus();
}

/* ── 在室 ── */

// 接続中なのに、ルームの上では切断・不在になっている
function needsPresence(meta) {
  if (state.role === 'host') return meta.hostConnected === false;
  if (state.role === 'guest') return !meta.guests?.[state.mid];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
// 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
async function ensurePresence(force = false) {
  const roomRef = state.roomRef;
  if (!roomRef || state.leaving || !state.isConnected) return;
  if (!force && Date.now() - state.presenceAt < PRESENCE_RETRY_MS) return;
  state.presenceAt = Date.now();
  const metaRef = roomRef.child('meta');
  const role = state.role;
  const name = state.nickname;
  const mid = state.mid;
  const uid = currentUid();
  try {
    await roomRef.child('typing/' + mid).onDisconnect().remove();
    if (role === 'host') {
      await metaRef.onDisconnect().update({
        hostConnected: false,
        hostDisconnectedAt: serverTimestamp(),
      });
      await metaRef.transaction((meta) => {
        if (!meta || !meta.status || meta.hostUid !== uid || isExpired(meta)) return undefined;
        if (meta.hostConnected === true && meta.hostDisconnectedAt == null) return undefined;
        return { ...meta, hostConnected: true, hostDisconnectedAt: null };
      });
    } else if (role === 'guest') {
      await metaRef.child('guests/' + mid).onDisconnect().remove();
      let lost = null;
      await metaRef.transaction((meta) => {
        lost = null;
        if (!meta || !meta.status || isExpired(meta)) return undefined;
        const guests = meta.guests || {};
        if (guests[mid]) return undefined;
        const others = Object.keys(guests);
        if (name === meta.hostName || others.some((id) => guests[id]?.name === name)) {
          lost = 'dup';
          return undefined;
        }
        if (others.length >= MAX_GUESTS) {
          lost = 'full';
          return undefined;
        }
        return { ...meta, guests: { ...guests, [mid]: { name, uid, joinedAt: RoomkRTDB.now() } } };
      });
      if (lost && state.roomRef === roomRef && !state.leaving) kickedOut(lost);
    }
  } catch (error) {
    console.warn('[sakusen-chat] presence recovery failed', error);
    // 定期的な確認の失敗は通知しない（接続し直したときだけ知らせる）
    if (force && state.roomRef === roomRef && !state.leaving) toast('再接続に失敗しました。ページを読み直してね');
  }
}

function tickRoom() {
  const meta = state.meta;
  if (!meta || state.leaving) return;
  if (isExpired(meta)) {
    handleMeta(meta);
    return;
  }
  renderHostOff();
  renderConnection();
  if (needsPresence(meta)) ensurePresence();
  const key = typingKeyNow();
  if (key !== state.typingKey) {
    renderTyping();
    renderTopics();
  }
}

function handleMeta(meta) {
  if (state.leaving) return;
  if (!meta || !meta.status) {
    endLocally(false);
    return;
  }
  if (isExpired(meta)) {
    const key = state.roomCode;
    removeExpiredRoom(key, meta).then((cleared) => { if (cleared) forgetRoom(key); });
    endLocally(true);
    return;
  }
  const before = state.meta;
  state.meta = meta;
  if (before) announceGuests(before, meta);
  renderPeers();
  renderHostOff();
  if (needsPresence(meta)) ensurePresence();
}

function announceGuests(before, after) {
  const a = before.guests || {};
  const b = after.guests || {};
  Object.keys(b).forEach((id) => {
    if (id !== state.mid && !a[id]) {
      toast(String(b[id]?.name || '').slice(0, NAME_MAX) + 'が入ったよ', false);
    }
  });
  Object.keys(a).forEach((id) => {
    if (id !== state.mid && !b[id]) toast(String(a[id]?.name || '').slice(0, NAME_MAX) + 'が出たよ', false);
  });
}

function renderPeers() {
  const meta = state.meta;
  const label = $('peerLabel');
  if (!meta) {
    label.textContent = '';
    return;
  }
  const names = [];
  if (state.role !== 'host' && meta.hostConnected !== false) names.push(String(meta.hostName || '').slice(0, NAME_MAX));
  Object.keys(meta.guests || {}).forEach((id) => {
    if (id !== state.mid) names.push(String(meta.guests[id]?.name || '').slice(0, NAME_MAX));
  });
  label.textContent = names.length ? 'いっしょにいる人: ' + names.join('、')
    : state.role === 'host' ? 'まだだれも来ていないよ' : '';
  label.classList.toggle('sc-bar__peer--here', names.length > 0);
}

function hostIsOff() {
  const meta = state.meta;
  if (!meta || state.role !== 'guest' || meta.hostConnected !== false) return false;
  const at = RoomkRTDB.getHostDisconnectedAt(meta);
  // メンターの再読み込みくらいの短い切断では出さない
  return at != null && RoomkRTDB.now() - at >= HOST_OFF_GRACE_MS;
}

function renderHostOff() {
  const off = hostIsOff();
  if ($('hostOffOverlay').hidden === !off) return;
  $('hostOffOverlay').hidden = !off;
  renderPeers();
}

// 「接続が切れているよ」は、つなぎはじめの一瞬では出さない
function renderConnection() {
  if (state.isConnected || !state.roomRef) state.offlineAt = 0;
  else if (!state.offlineAt) state.offlineAt = Date.now();
  $('offlineNote').hidden = !state.offlineAt || Date.now() - state.offlineAt < OFFLINE_NOTE_MS;
}

/* ── 未読 ── */

function talkShown() {
  return !narrow.matches || $('screen-chat').dataset.view === 'talk';
}

// その話題をいま見ているか（見ている間に届いたものは未読にしない）
function watching(topicId) {
  return !!state.roomRef && state.msgsLoaded && state.current === topicId && talkShown()
    && document.visibilityState === 'visible' && document.hasFocus();
}

function unreadOf(topicId) {
  const read = state.read[topicId] || '';
  return (state.byTopic.get(topicId) || []).filter((m) => m.id > read && m.mid !== state.mid);
}

function isFresh(topic) {
  return topic.mid !== state.mid && !state.seen.has(topic.id);
}

function totalUnread() {
  if (!state.msgsLoaded) return 0;
  let n = 0;
  state.topics.forEach((t) => { n += unreadOf(t.id).length + (isFresh(t) ? 1 : 0); });
  return n;
}

// 読んだことにする。未読があったときは、その1通目に線を引く
function markRead(topicId) {
  const list = state.byTopic.get(topicId) || [];
  const unread = unreadOf(topicId);
  if (unread.length) state.divider[topicId] = unread[0].id;
  if (list.length) {
    const last = list[list.length - 1].id;
    if (last > (state.read[topicId] || '')) state.read[topicId] = last;
  }
  state.seen.add(topicId);
  scheduleSave();
}

// 見ている状態になったら、その話題の未読を消す
function checkRead() {
  const id = state.current;
  if (!id || !watching(id)) return;
  const had = unreadOf(id).length > 0;
  const topic = currentTopic();
  if (!had && !(topic && isFresh(topic))) return;
  markRead(id);
  if (had) renderTalk();
  renderTopics();
}

function setView(view) {
  if (view === 'list' && state.current) delete state.divider[state.current];
  $('screen-chat').dataset.view = view;
  checkRead();
  renderTopics();
}

/* ── 話題 ── */

function currentTopic() {
  return state.topics.find((t) => t.id === state.current) || null;
}

function handleTopics(value) {
  const list = Object.keys(value || {}).map((id) => {
    const t = value[id] || {};
    return {
      id,
      title: String(t.title || '').slice(0, TITLE_MAX),
      kind: t.kind === 'mood' ? 'mood' : 'free',
      mid: String(t.mid || ''),
      at: Number(t.at) || 0,
    };
  }).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  const first = !state.topicsLoaded;
  state.topicsLoaded = true;
  if (first && state.firstJoin) {
    // 入ったときにもうあった話題は「新しい」にしない
    list.forEach((t) => state.seen.add(t.id));
  }
  state.topics = list;
  if (!currentTopic()) {
    state.current = list.length ? list[0].id : null;
    if (state.current && watching(state.current)) markRead(state.current);
    renderTalk();
  }
  renderTopics();
  scheduleSave();
}

function canWrite() {
  if (!state.roomRef || !state.meta || state.leaving) return false;
  if (!state.isConnected) {
    toast('接続が切れているよ。もどるまで少し待ってね');
    return false;
  }
  return true;
}

function submitTopic() {
  const title = $('addInput').value.trim().slice(0, TITLE_MAX);
  if (!title) {
    $('addInput').focus();
    return;
  }
  if (state.topics.length >= TOPIC_MAX) {
    toast('話題は' + TOPIC_MAX + 'こまでだよ');
    return;
  }
  if (!canWrite()) return;
  const ref = state.roomRef.child('topics').push();
  state.seen.add(ref.key);
  closeAddForm();
  ref.set({ title, kind: 'free', mid: state.mid, at: serverTimestamp() })
    .catch(() => toast('話題をふやせなかったよ。もう一度ためしてね'));
  // set の中で手元の一覧が先に更新されるので、そのままひらける
  if (state.topics.some((t) => t.id === ref.key)) openTopic(ref.key);
}

function closeAddForm() {
  $('addInput').value = '';
  $('addForm').hidden = true;
  $('btnAddOpen').hidden = false;
}

function openTopic(id) {
  if (state.current !== id) scheduleSave();
  if (state.current && state.current !== id) {
    delete state.divider[state.current];
    // 書きかけは話題ごとに取っておく
    state.drafts[state.current] = { text: $('textInput').value, img: state.pendingImg };
    sendTyping(false);
    const draft = state.drafts[id] || { text: '', img: null };
    $('textInput').value = draft.text;
    growText();
    showPending(draft.img);
  }
  state.current = id;
  // 会話を表に出してから描く（かくれている間はスクロール位置を決められない）
  if (narrow.matches) $('screen-chat').dataset.view = 'talk';
  if (watching(id)) markRead(id);
  renderTalk();
  renderTopics();
  if (!coarse.matches) $('textInput').focus();
}

function typingNames(topicId) {
  const now = Date.now();
  return Object.keys(state.typing)
    .filter((mid) => state.typing[mid].t === topicId && state.typing[mid].until > now)
    .map((mid) => state.typing[mid].name);
}

function previewText(topic) {
  const typing = typingNames(topic.id);
  if (typing.length) return typing.join('・') + 'が入力中…';
  const list = state.byTopic.get(topic.id) || [];
  if (!list.length) return 'まだメッセージはないよ';
  const m = list[list.length - 1];
  const who = (m.mid === state.mid ? 'あなた' : m.name) + ': ';
  return who + (m.kind === 'image' ? ('画像' + (m.text ? ' ' + m.text : '')) : m.text);
}

function renderTopics() {
  const list = $('topicList');
  list.replaceChildren();
  state.topics.forEach((t, i) => {
    const unread = state.msgsLoaded ? unreadOf(t.id).length : 0;
    const fresh = isFresh(t);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-topic';
    if (t.id === state.current && talkShown()) btn.setAttribute('aria-current', 'true');
    if (unread || fresh) btn.classList.add('sc-topic--unread');
    let label = (i + 1) + '番の話題: ' + t.title;
    if (unread) label += '、未読' + unread + '件';
    else if (fresh) label += '、新しい話題';
    btn.setAttribute('aria-label', label);

    const num = document.createElement('span');
    num.className = 'sc-topic__num';
    num.textContent = NUMBERS[i] || String(i + 1);
    const body = document.createElement('span');
    body.className = 'sc-topic__body';
    const title = document.createElement('span');
    title.className = 'sc-topic__title';
    title.textContent = t.title;
    const preview = document.createElement('span');
    preview.className = 'sc-topic__preview';
    preview.textContent = previewText(t);
    body.append(title, preview);
    btn.append(num, body);

    if (unread || fresh) {
      const count = document.createElement('span');
      count.className = 'sc-count';
      count.textContent = unread ? String(unread) : '新しい';
      btn.append(count);
    }
    btn.addEventListener('click', () => openTopic(t.id));
    li.append(btn);
    list.append(li);
  });
  $('btnAddOpen').disabled = state.topics.length >= TOPIC_MAX;

  const total = totalUnread();
  document.title = (total && state.roomRef ? '(' + total + ') ' : '') + BASE_TITLE;
  $('backBadge').hidden = !total;
  $('backBadge').textContent = String(total);
  state.typingKey = typingKeyNow();
}

/* ── メッセージ ── */

function nearBottom() {
  const box = $('msgList');
  return box.scrollHeight - box.scrollTop - box.clientHeight < NEAR_BOTTOM_PX;
}

function scrollBottom() {
  const box = $('msgList');
  box.scrollTop = box.scrollHeight;
  $('btnNewer').hidden = true;
}

function renderTalk() {
  const topic = currentTopic();
  const box = $('msgList');
  box.replaceChildren();
  $('btnNewer').hidden = true;
  $('talkTitle').textContent = topic ? topic.title : '';
  if (!topic) {
    renderTyping();
    return;
  }
  if (topic.kind === 'mood') box.append(moodCard());
  const list = state.msgsLoaded ? (state.byTopic.get(topic.id) || []) : [];
  let divider = null;
  list.forEach((m, i) => {
    // いちばん上のメッセージの前には線を引かない（ぜんぶ新しいので、線がなくても分かる）
    if (i > 0 && m.id === state.divider[topic.id]) {
      divider = document.createElement('p');
      divider.className = 'sc-talk__divider';
      divider.textContent = 'ここから新しいメッセージ';
      box.append(divider);
    }
    box.append(msgEl(m, divider && m.id === state.divider[topic.id] ? null : list[i - 1]));
  });
  if (!list.length && topic.kind !== 'mood') {
    const empty = document.createElement('p');
    empty.className = 'sc-talk__empty';
    empty.textContent = state.msgsLoaded ? 'まだメッセージはないよ' : '読みこみ中…';
    box.append(empty);
  }
  if (divider) box.scrollTop = Math.max(0, divider.offsetTop - 8);
  else scrollBottom();
  renderTyping();
}

function moodCard() {
  const card = document.createElement('div');
  card.className = 'sc-mood';
  const q = document.createElement('p');
  q.className = 'sc-mood__q';
  q.textContent = MOOD_QUESTION;
  card.append(q);
  MOODS.forEach((mood) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sc-choice';
    const num = document.createElement('span');
    num.className = 'sc-choice__num';
    num.textContent = mood.num;
    const text = document.createElement('span');
    text.className = 'sc-choice__text';
    text.textContent = mood.text;
    btn.append(num, text);
    btn.addEventListener('click', () => sendPlain('mood', mood.num + ' ' + mood.text));
    card.append(btn);
  });
  const pass = document.createElement('button');
  pass.type = 'button';
  pass.className = 'sc-choice sc-choice--pass';
  pass.textContent = MOOD_PASS;
  pass.addEventListener('click', () => sendPlain('mood', MOOD_PASS));
  card.append(pass);
  return card;
}

function timeText(at) {
  const d = new Date(at);
  return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
}

// prev: すぐ上のメッセージ。同じ人がつづけて書いたときは、名前をくり返さない
function msgEl(m, prev) {
  const mine = m.mid === state.mid;
  const wrap = document.createElement('div');
  wrap.className = 'sc-msg ' + (mine ? 'sc-msg--me' : 'sc-msg--peer');
  wrap.dataset.id = m.id;
  wrap.dataset.name = m.name;
  if (!mine && !(prev && prev.mid === m.mid)) {
    const name = document.createElement('p');
    name.className = 'sc-msg__name';
    name.textContent = m.name;
    wrap.append(name);
  }
  const bubble = document.createElement('div');
  bubble.className = 'sc-msg__bubble';
  if (m.kind === 'image') bubble.append(imageButton(m, mine));
  if (m.text) {
    const p = document.createElement('p');
    p.className = 'sc-msg__text';
    p.textContent = m.text;
    bubble.append(p);
  }
  const meta = document.createElement('div');
  meta.className = 'sc-msg__meta';
  const time = document.createElement('span');
  time.textContent = timeText(m.at);
  meta.append(time);
  if (mine) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'sc-msg__del';
    del.textContent = '消す';
    del.addEventListener('click', () => askDelete(m.id));
    meta.append(del);
  }
  wrap.append(bubble, meta);
  return wrap;
}

// 画像は msgs とは別の場所（imgs）に置いてあり、表示するときに読みこむ
function imageButton(m, mine) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sc-msg__imgbtn';
  btn.disabled = true;
  btn.setAttribute('aria-label', '画像を大きく見る');
  const w = m.w > 0 ? m.w : 4;
  const h = m.h > 0 ? m.h : 3;
  const scale = Math.min(THUMB_MAX / w, THUMB_MAX / h, 1);
  btn.style.width = Math.max(40, Math.round(w * scale)) + 'px';
  btn.style.aspectRatio = w + ' / ' + h;
  const fill = () => {
    btn.replaceChildren();
    btn.classList.remove('sc-msg__imgbtn--failed');
    btn.disabled = true;
    loadImage(m.id).then((src) => {
      const img = document.createElement('img');
      img.className = 'sc-msg__img';
      img.alt = mine ? 'あなたが送った画像' : m.name + 'が送った画像';
      img.src = src;
      btn.replaceChildren(img);
      btn.disabled = false;
      btn.onclick = () => openViewer(src);
    }, () => {
      // 読みこめなかったときは、押すともう一度ためす
      btn.classList.add('sc-msg__imgbtn--failed');
      btn.textContent = '画像を読みこめなかったよ（押すともう一度ためす）';
      btn.disabled = false;
      btn.onclick = fill;
    });
  };
  fill();
  return btn;
}

function loadImage(id) {
  if (state.imgCache.has(id)) return Promise.resolve(state.imgCache.get(id));
  if (state.imgWait.has(id)) return state.imgWait.get(id);
  const roomRef = state.roomRef;
  if (!roomRef) return Promise.reject(new Error('no room'));
  const wait = state.imgWait;
  const promise = roomRef.child('imgs/' + id).once('value').then((snap) => {
    const src = snap.val();
    if (typeof src !== 'string' || src.length > IMG_MAX_CHARS || !IMG_SRC_RE.test(src)) throw new Error('no image');
    if (state.roomRef === roomRef) state.imgCache.set(id, src);
    return src;
  }).finally(() => wait.delete(id));
  wait.set(id, promise);
  return promise;
}

// 画像の寸法として受け取る値（ほかの人が書いた値なので、ありえない値は使わない）
function imageSize(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= IMG_STEPS[0][0] ? Math.round(n) : 0;
}

function imageCount() {
  let n = 0;
  state.msgIndex.forEach((m) => { if (m.kind === 'image') n += 1; });
  return n;
}

function onMsgAdded(id, raw) {
  if (!raw || state.msgIndex.has(id)) return;
  const m = {
    id,
    t: String(raw.t || ''),
    mid: String(raw.mid || ''),
    name: String(raw.name || '').slice(0, NAME_MAX),
    kind: raw.kind === 'image' || raw.kind === 'mood' ? raw.kind : 'text',
    text: String(raw.text || '').slice(0, TEXT_MAX),
    at: Number(raw.at) || RoomkRTDB.now(),
    w: imageSize(raw.w),
    h: imageSize(raw.h),
  };
  state.msgIndex.set(id, m);
  const list = state.byTopic.get(m.t) || [];
  state.byTopic.set(m.t, list);
  // id は時刻順。届く順が前後しても、id の順に並べる
  let i = list.length;
  while (i > 0 && list[i - 1].id > id) i -= 1;
  list.splice(i, 0, m);
  // 最初の読みこみは、そろってからまとめて描く
  if (!state.msgsLoaded) return;

  const mine = m.mid === state.mid;
  const shown = state.current === m.t;
  const last = i === list.length - 1;
  const stick = shown && (mine || nearBottom());
  if (mine) {
    delete state.divider[m.t];
    if (id > (state.read[m.t] || '')) state.read[m.t] = id;
    scheduleSave();
  } else {
    delete state.typing[m.mid];
  }
  if (shown) {
    if (last) {
      $('msgList').querySelector('.sc-talk__empty')?.remove();
      // 自分が送ったあとは「ここから新しいメッセージ」の線を消す
      if (mine) $('msgList').querySelector('.sc-talk__divider')?.remove();
      $('msgList').append(msgEl(m, list[i - 1]));
    } else {
      // 間に入ったメッセージは並べ直す
      const keep = $('msgList').scrollTop;
      renderTalk();
      $('msgList').scrollTop = keep;
    }
  }
  if (mine) {
    if (shown) scrollBottom();
  } else if (watching(m.t)) {
    if (id > (state.read[m.t] || '')) state.read[m.t] = id;
    scheduleSave();
    if (stick) scrollBottom(); else $('btnNewer').hidden = false;
  } else {
    if (stick) scrollBottom();
  }
  renderTyping();
  renderTopics();
}

function onMsgRemoved(id) {
  const m = state.msgIndex.get(id);
  if (!m) return;
  state.msgIndex.delete(id);
  state.imgCache.delete(id);
  const list = state.byTopic.get(m.t) || [];
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) list.splice(idx, 1);
  if (state.divider[m.t] === id) {
    const next = list.slice(Math.max(idx, 0)).find((x) => x.mid !== state.mid);
    if (next) state.divider[m.t] = next.id; else delete state.divider[m.t];
  }
  if (!state.msgsLoaded) return;
  if (state.current === m.t) {
    const keep = $('msgList').scrollTop;
    renderTalk();
    $('msgList').scrollTop = keep;
  }
  renderTopics();
}

function sendPlain(kind, text) {
  const topic = currentTopic();
  if (!topic || !canWrite()) return false;
  state.roomRef.child('msgs').push().set({
    t: topic.id,
    mid: state.mid,
    name: state.nickname,
    kind,
    text,
    at: serverTimestamp(),
  }).catch(() => toast('送れなかったよ。もう一度ためしてね'));
  return true;
}

function submitText() {
  const topic = currentTopic();
  if (!topic) return;
  const text = $('textInput').value.trim().slice(0, TEXT_MAX);
  const img = state.pendingImg;
  if (!text && !img) {
    $('textInput').focus();
    return;
  }
  if (img) {
    if (imageCount() >= IMG_MAX) {
      toast('画像は' + IMG_MAX + '枚までだよ');
      return;
    }
    if (!canWrite()) return;
    const roomRef = state.roomRef;
    const id = roomRef.child('msgs').push().key;
    state.imgCache.set(id, img.src);
    // 画像とメッセージを1回の書き込みで置く（片方だけが残らない）。
    // update() が中止するのは書きかえた場所（imgs/…・msgs/…）とその上下の transaction だけで、meta の transaction は止めない
    roomRef.update({
      ['imgs/' + id]: img.src,
      ['msgs/' + id]: {
        t: topic.id,
        mid: state.mid,
        name: state.nickname,
        kind: 'image',
        text,
        w: img.w,
        h: img.h,
        at: serverTimestamp(),
      },
    }).catch((error) => {
      console.warn('[sakusen-chat] image send failed', error);
      if (state.roomRef === roomRef && !state.leaving) toast('画像を送れなかったよ。もう一度ためしてね');
    });
  } else if (!sendPlain('text', text)) {
    return;
  }
  $('textInput').value = '';
  growText();
  showPending(null);
  $('fileInput').value = '';
  sendTyping(false);
  $('textInput').focus();
}

function askDelete(id) {
  ask({
    title: 'このメッセージを消す？',
    body: 'ほかの人の画面からも消えるよ。',
    ok: '消す',
  }, () => {
    const m = state.msgIndex.get(id);
    // 消せるのは書いた本人だけ
    if (!m || m.mid !== state.mid || !canWrite()) return;
    // メッセージと画像を1回の書き込みで消す
    state.roomRef.update({ ['msgs/' + id]: null, ['imgs/' + id]: null })
      .catch(() => toast('消せなかったよ。もう一度ためしてね'));
  });
}

/* ── 入力中 ── */

function sendTyping(on) {
  const roomRef = state.roomRef;
  if (!roomRef || !state.meta || state.leaving || !state.isConnected) return;
  const ref = roomRef.child('typing/' + state.mid);
  if (on) {
    const now = Date.now();
    if (now - state.typingSentAt < TYPING_SEND_GAP_MS) return;
    state.typingSentAt = now;
    state.typingOn = true;
    ref.set({ t: state.current, name: state.nickname, at: serverTimestamp() }).catch(() => {});
  } else if (state.typingOn) {
    state.typingOn = false;
    state.typingSentAt = 0;
    ref.remove().catch(() => {});
  }
}

function handleTyping(value) {
  const next = {};
  Object.keys(value || {}).forEach((mid) => {
    const v = value[mid];
    if (mid === state.mid || !v) return;
    const at = Number(v.at) || 0;
    const prev = state.typing[mid];
    next[mid] = {
      t: String(v.t || ''),
      name: String(v.name || '').slice(0, NAME_MAX),
      at,
      // 同じ書きこみのままなら、消す時刻はのばさない
      until: prev && prev.at === at ? prev.until : Date.now() + TYPING_MS,
    };
  });
  state.typing = next;
  renderTyping();
  renderTopics();
}

// いま「入力中」と出すべき人の一覧（時間切れで変わったかを、1秒ごとの確認で見る）
function typingKeyNow() {
  const now = Date.now();
  return Object.keys(state.typing)
    .filter((mid) => state.typing[mid].until > now)
    .map((mid) => mid + '@' + state.typing[mid].t)
    .sort()
    .join(',');
}

function renderTyping() {
  const names = state.current ? typingNames(state.current) : [];
  $('typingNote').hidden = !names.length;
  $('typingNote').textContent = names.length ? names.join('・') + 'が入力中…' : '';
}

/* ── 画像 ── */

function loadFileImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      reject(new Error('not image'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load')); };
    img.src = url;
  });
}

// 画像をブラウザの中で小さくする（描き直すので、位置情報などの付属データもここで落ちる）
async function shrink(file) {
  const img = await loadFileImage(file);
  if (!img.naturalWidth || !img.naturalHeight) throw new Error('empty image');
  for (const [edge, quality] of IMG_STEPS) {
    const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const src = canvas.toDataURL('image/jpeg', quality);
    if (src.length <= IMG_MAX_CHARS && IMG_SRC_RE.test(src)) return { src, w, h };
  }
  throw new Error('too large');
}

function showPending(img) {
  state.pendingImg = img || null;
  if (img) $('pendingImg').src = img.src; else $('pendingImg').removeAttribute('src');
  $('pendingBox').hidden = !img;
}

function setPending(file) {
  const roomRef = state.roomRef;
  const topicId = state.current;
  shrink(file).then((img) => {
    if (state.roomRef !== roomRef || state.current !== topicId) return;
    showPending(img);
    $('textInput').focus();
  }, () => {
    toast('この画像は使えなかったよ。別の画像でためしてね');
  });
}

function firstImage(files) {
  return Array.from(files || []).find((f) => /^image\//.test(f.type)) || null;
}

function openViewer(src) {
  $('viewerImg').src = src;
  $('viewer').showModal();
}

/* ── たしかめる・書く欄 ── */

function ask(texts, action) {
  $('confirmTitle').textContent = texts.title;
  $('confirmBody').textContent = texts.body;
  $('btnConfirmOk').textContent = texts.ok;
  if ($('confirmDialog').open) $('confirmDialog').close();
  confirmAction = action;
  $('confirmDialog').showModal();
}

function growText() {
  const box = $('textInput');
  box.style.height = 'auto';
  box.style.height = Math.min(box.scrollHeight, 140) + 'px';
}

// スマホでキーボードが出ている間も、書く欄が画面の中に収まるようにする
function fitViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  document.documentElement.style.setProperty('--sc-vh', vv.height + 'px');
  if (state.currentScreen === 'chat') window.scrollTo(0, 0);
}

function renderTop() {
  $('mentorTools').hidden = !state.isMentor;
  $('guestNote').hidden = state.isMentor;
  $('prevRoom').hidden = !state.prevKey;
  $('createForm').hidden = !!state.prevKey;
  if (!$('hostName').value) $('hostName').value = storeGet(localStorage, NAME_KEY) || '';
}

function goTop() {
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
  renderTop();
  showScreen('top');
  sweepMyRooms();
}

/* ── 操作 ── */

function blockComposingEnter(input) {
  // 変換を確定する Enter では送らない（Safari は確定の Enter を keyCode 229 で届ける）
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault();
  });
}

function bindEvents() {
  $('createForm').addEventListener('submit', (e) => { e.preventDefault(); createRoom(); });
  $('joinForm').addEventListener('submit', (e) => { e.preventDefault(); joinRoom(); });
  blockComposingEnter($('hostName'));
  blockComposingEnter($('guestName'));
  blockComposingEnter($('addInput'));
  $('btnPrevResume').addEventListener('click', resumePrev);
  $('btnPrevDelete').addEventListener('click', () => {
    ask({
      title: '前のルームを消す？',
      body: '前のルームの会話と画像をすべて消すよ。もとにはもどせない。',
      ok: '消す',
    }, deletePrev);
  });
  $('btnEndTop').addEventListener('click', goTop);

  $('btnCopyLink').addEventListener('click', () => {
    if (!state.roomCode) return;
    RoomkRTDB.copyText(
      location.origin + location.pathname + '?room=' + state.roomCode,
      $('btnCopyLink'),
      '参加用のリンクをコピーしました',
      'コピーできませんでした。もう一度ためしてね',
    );
  });
  // 別の端末（スマホ・タブレット）で入る人向けに、「リンクをコピー」と同じ参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
  $('btnShowQr')?.addEventListener('click', () => {
    if (!state.roomCode) return;
    // カギ（20文字）は画面に出さないので、QR の下にも出さない
    RoomkQR.show(state.roomCode, location.origin + location.pathname + '?room=' + state.roomCode, { showCode: false });
  });
  $('btnFinish').addEventListener('click', () => {
    ask({
      title: '作戦会議チャットを終わる？',
      body: '会話と画像をすべて消して、ルームをとじるよ。もとにはもどせない。',
      ok: '終わる',
    }, finishRoom);
  });
  $('btnLeave').addEventListener('click', leaveRoom);
  $('btnOverlayLeave').addEventListener('click', leaveRoom);

  $('btnAddOpen').addEventListener('click', () => {
    $('btnAddOpen').hidden = true;
    $('addForm').hidden = false;
    $('addInput').focus();
  });
  $('btnAddCancel').addEventListener('click', closeAddForm);
  $('addForm').addEventListener('submit', (e) => { e.preventDefault(); submitTopic(); });
  $('btnBack').addEventListener('click', () => setView('list'));

  $('composeForm').addEventListener('submit', (e) => { e.preventDefault(); submitText(); });
  $('textInput').addEventListener('keydown', (e) => {
    // スマホの Enter は改行。送るのはボタンで
    if (e.key !== 'Enter' || e.shiftKey || coarse.matches) return;
    if (e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    submitText();
  });
  $('textInput').addEventListener('input', () => {
    growText();
    sendTyping($('textInput').value.trim().length > 0);
  });
  $('textInput').addEventListener('paste', (e) => {
    const file = firstImage(e.clipboardData?.files);
    if (!file) return;
    e.preventDefault();
    setPending(file);
  });
  $('btnPick').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', () => {
    const file = firstImage($('fileInput').files);
    if (file) setPending(file);
    else if ($('fileInput').files.length) toast('この画像は使えなかったよ。別の画像でためしてね');
  });
  $('btnPendingRemove').addEventListener('click', () => {
    showPending(null);
    $('fileInput').value = '';
  });
  $('talk').addEventListener('dragover', (e) => e.preventDefault());
  $('talk').addEventListener('drop', (e) => {
    e.preventDefault();
    const file = firstImage(e.dataTransfer?.files);
    if (file) setPending(file);
  });

  $('msgList').addEventListener('scroll', () => { if (nearBottom()) $('btnNewer').hidden = true; });
  $('btnNewer').addEventListener('click', scrollBottom);

  $('btnConfirmOk').addEventListener('click', () => {
    const action = confirmAction;
    confirmAction = null;
    $('confirmDialog').close();
    if (action) action();
  });
  $('btnConfirmCancel').addEventListener('click', () => $('confirmDialog').close());
  $('confirmDialog').addEventListener('close', () => { confirmAction = null; });
  $('btnViewerClose').addEventListener('click', () => $('viewer').close());
  $('viewer').addEventListener('click', (e) => { if (e.target === $('viewer')) $('viewer').close(); });
  $('viewer').addEventListener('close', () => $('viewerImg').removeAttribute('src'));

  window.addEventListener('focus', checkRead);
  document.addEventListener('visibilitychange', checkRead);
  narrow.addEventListener('change', () => {
    if (!state.roomRef) return;
    renderTalk();
    checkRead();
    renderTopics();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    fitViewport();
  }

  // メンターが「終わる」を押さずに閉じると、会話が残ったままになるので確かめる
  window.addEventListener('beforeunload', (e) => {
    if (state.roomRef && state.role === 'host' && !state.leaving) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  // 再読み込みの直前の状態（読んだところ・見ていた話題）を書き残す
  window.addEventListener('pagehide', () => { if (state.roomRef && !state.leaving) saveSession(); });
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
}

/* ── 起動 ── */

function readLinkKey() {
  const raw = new URLSearchParams(location.search).get('room');
  if (raw === null) return { key: null, bad: false };
  const key = raw.normalize('NFKC').replace(/\s/g, '').toUpperCase();
  return KEY_RE.test(key) ? { key, bad: false } : { key: null, bad: true };
}

async function boot() {
  bindEvents();
  if (await midIsTaken()) {
    // 複製されたタブ。別の人として入り直す（もとのタブの席・再接続の記録は使わない）
    state.mid = newMid();
    clearSession();
  }
  await initMentor();
  renderTop();
  const link = readLinkKey();
  if (link.bad) {
    history.replaceState(null, '', location.pathname);
    toast('リンクが正しくないよ');
  }
  let session = loadSession();
  // 別のルームのリンクでひらいたときは、リンクのルームを優先する
  if (session && link.key && link.key !== session.key) {
    clearSession();
    session = null;
  }
  let joinKey = link.key;
  let joinMessage = '';
  if (session) {
    const result = await tryReconnect(session);
    if (result.ok) {
      sweepMyRooms();
      return;
    }
    joinKey = result.joinKey;
    joinMessage = result.message || '';
    if (!joinKey && link.key) history.replaceState(null, '', location.pathname);
  }
  if (joinKey) openJoin(joinKey, joinMessage);
  else showScreen('top');
  sweepMyRooms();
}

boot();
