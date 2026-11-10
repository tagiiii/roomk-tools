/* つなげてストーリー
   お題にそって「いつ・どこで・だれが・何をした」などを1人ずつうけもって書き、そろったら1片ずつ順に出して文にする。
   できた文に、だれでも「そのあと…」を3つまで足せる。
   ホストの操作はルームの transaction（hostUid を確かめる）。書いた言葉・続きは参加する人がルームの transaction で書く。
   だれが何を書いたかは画面に出さない（状態には入るが性善説。AGENTS.md「セキュリティ方針」）。 */

const WORDS = window.TSUNAGETE_STORY_WORDS;
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'tsunagetestory_rooms';
const SESSION_KEY = 'tsunagetestory_session';
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const MAX_GUESTS = 12;
const STATUS = { WAITING: 'waiting', THEME: 'theme', WRITE: 'write', READ: 'read', RESULT: 'result' };

const PIECE_MAX = 16;    // 1片の文字数
const LINE_MAX = 24;     // 「そのあと…」の文字数
const LINES_MAX = 3;     // 1つの文に足せる「そのあと…」の数
const PIECE_MS = 1300;   // 1片ずつ出す間
const LEAD_MS = 700;     // 読みはじめてから1片めが出るまで

// tail: 画面でうしろに足す文字。strip: 本人が書いたときに重なる助詞・句読点を取る
//   opt: ホストが待合室で足せる項目。文の中の順番はこの並びのとおり
const ALL_SLOTS = [
  { key: 'when', label: 'いつ', ask: 'いつのこと？', tail: '、', strip: /[、,，\s]+$/ },
  { key: 'where', label: 'どこで', ask: 'どこで？', tail: 'で、', strip: /(で)?[、,，\s]*$/ },
  { key: 'who', label: 'だれが', ask: 'だれが？', tail: 'が、', strip: /(が|は)?[、,，\s]*$/ },
  { key: 'with', label: 'だれと', ask: 'だれといっしょに？', tail: 'と、', strip: /(と|といっしょに)?[、,，\s]*$/, opt: true },
  { key: 'why', label: 'なぜ', ask: 'なぜ？（〜から）', tail: '、', strip: /[、,，\s]+$/, opt: true },
  { key: 'how', label: 'どのように', ask: 'どのように？', tail: '、', strip: /[、,，\s]+$/, opt: true },
  { key: 'what', label: '何をした', ask: '何をした？', tail: '。', strip: /[。．.!！?？\s]+$/ },
];
const OPT_KEYS = ALL_SLOTS.filter((x) => x.opt).map((x) => x.key);
const THEME_MODES = { on: 'あり', none: 'なし' };
const DEFAULT_SETTINGS = { hostPlays: true, themeMode: 'on', extra: ['how'] };

const $ = (id) => document.getElementById(id);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const icon = (name) => { const s = el('span', 'material-symbols-rounded', name); s.setAttribute('aria-hidden', 'true'); return s; };
const now = () => RoomkRTDB.now();
const slotOf = (key) => ALL_SLOTS.find((s) => s.key === key);
const slotKeysOf = (extra) => ALL_SLOTS.filter((x) => !x.opt || (extra || []).includes(x.key)).map((x) => x.key);
const fixPiece = (key, text) => clean(text, PIECE_MAX).replace(slotOf(key).strip, '').trim();
const pieceText = (key, text) => text + slotOf(key).tail;
const sentenceText = (parts, keys) => keys.map((k, i) => pieceText(k, parts[i])).join('');
const quoted = (key, text) => `「${pieceText(key, text).replace(/[、。]$/, '')}」`;
const pickSome = (pool, n, avoid = []) => shuffle(pool.filter((w) => !avoid.includes(w))).slice(0, n);
const themeById = (id) => WORDS.themes.find((t) => t.id === id) || null;
const themeOf = (room) => (room && room.theme ? themeById(room.theme) : null);
// だれと は「だれが」と同じ言葉から。なぜ・どのように はお題によらず共通
function poolOf(room, key) {
  if (key === 'why' || key === 'how') return WORDS[key];
  const src = key === 'with' ? 'who' : key;
  const t = themeOf(room);
  return t ? t[src] : WORDS[src];
}
const settingsOf = (room) => ({ ...DEFAULT_SETTINGS, ...(room?.settings || {}) });
const extraOf = (room) => (Array.isArray(settingsOf(room).extra) ? settingsOf(room).extra.filter((k) => OPT_KEYS.includes(k)) : []);
const slotsOf = (room) => (Array.isArray(room?.slots) && room.slots.length ? room.slots : slotKeysOf(extraOf(room)));
const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));

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
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  busy: false,
  // 書く画面の下書き（この画面だけ）
  draft: { key: null, picks: {}, free: {}, cands: {}, sent: false, sentText: '' },
  // 「そのあと…」の下書き（この画面だけ）
  line: { key: null, cands: [] },
};

function showScreen(id) {
  document.querySelectorAll('.ts-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
  document.querySelector('.ts-wrap').classList.toggle('is-top', id === 'top');
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
const hostPlaysOf = (room) => settingsOf(room).hostPlays !== false;
// 書く人になれる人（進行だけのホストは含めない）。参加した順
function playerNames(room) {
  const plays = hostPlaysOf(room);
  return Object.entries(room.players || {})
    .filter(([, p]) => !p.isHost || plays)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([n]) => n);
}
const tasksOf = (room) => room.tasks || {};
const myTasks = (room) => arr(tasksOf(room)[state.nickname]).map((t) => arr(t));
const taskId = (t) => `${t[0]}-${t[1]}`;
const subOf = (room) => room.sub || {};
const writersOf = (room) => Object.keys(tasksOf(room));
// まだ送っていない書く人（退出した人は待たない）
const waitingOf = (room) => writersOf(room).filter((n) => room.players?.[n] && !subOf(room)[n]);
const shownOf = (room) => {
  const keys = slotsOf(room);
  if (!room.read) return 0;
  return Math.max(0, Math.min(keys.length, Math.floor((now() - room.read.at - LEAD_MS) / PIECE_MS) + 1));
};

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
    console.warn('[tsunagete-story] expired room cleanup failed', error);
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
  state.draft = { key: null, picks: {}, free: {}, cands: {}, sent: false, sentText: '' };
  state.line = { key: null, cands: [] };
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
  drawnRead = '';
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
          if (room.players?.[nickname]) return;
          const uid = firebase.auth().currentUser?.uid;
          // 通信が切れて在室が消えたあとに戻ったとき。遊んでいる途中でも、同じ名前のまま戻る（うけもちも名前で持っている）
          return { ...room, players: { ...(room.players || {}), [nickname]: { isHost: false, uid, joinedAt: now() } } };
        });
      }
    } catch (error) {
      console.warn('[tsunagete-story] presence recovery failed', error);
      toast('再接続に失敗しました。ページを読み直してね');
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
  // 1片ずつ出るので、読む画面は短い間隔で描きなおす
  state.timerInterval = setInterval(drawRead, 250);
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
  if (state.role === 'host') maybeRead(room);
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
          round: 0,
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
    console.warn('[tsunagete-story] create failed', error);
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
      if (own) { reason = '名前'; return; }
      if (guestNames(current).length >= MAX_GUESTS) { reason = '満員'; return; }
      // 遊んでいる途中でも入れる（つぎの回から書く）
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
    console.warn('[tsunagete-story] join failed', error);
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
    console.warn('[tsunagete-story] reconnect failed', error);
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
      // うけもちは残す（来なかった所は、読むときにおまかせで埋まる）
      await ref.child('players/' + nickname).remove();
    }
  } catch (error) {
    console.warn('[tsunagete-story] leave failed', error);
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
    console.warn('[tsunagete-story] host action failed', error);
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
function toggleExtra(k) {
  hostTx((room) => {
    if (room.status !== STATUS.WAITING || !OPT_KEYS.includes(k)) return undefined;
    const cur = extraOf(room);
    const next = cur.includes(k) ? cur.filter((x) => x !== k) : OPT_KEYS.filter((x) => x === k || cur.includes(x));
    return { ...room, settings: { ...settingsOf(room), extra: next } };
  });
}
async function setHostPlays(checked) {
  const input = $('setHostPlays');
  input.disabled = true;
  await hostTx((room) => (room.status === STATUS.WAITING ? { ...room, settings: { ...settingsOf(room), hostPlays: checked } } : undefined),
    '設定を変えられませんでした。もう一度ためしてね');
  input.disabled = false;
}

// お題の候補を3つ。この回までに遊んだお題と、いま出ている候補は出さない（足りなければ遊んだお題も使う）
function threeThemes(room, avoid) {
  const ids = WORDS.themes.map((t) => t.id);
  let used = arr(room.usedThemes);
  let pool = ids.filter((id) => !used.includes(id) && !avoid.includes(id));
  if (pool.length < 3) {
    used = [];
    pool = pool.concat(shuffle(ids.filter((id) => !pool.includes(id) && !avoid.includes(id))));
  }
  return { choices: shuffle(pool.slice(0, Math.max(pool.length, 3))).slice(0, 3), used };
}
// 回のはじめ（room を書きかえて返す）。お題ありなら、まずお題を決める画面へ。なしなら、すぐ書く
function prepRound(room, round) {
  const base = { ...room, round, tasks: null, sub: null, sents: null, read: null, slots: null, nSent: null };
  if (settingsOf(room).themeMode === 'on') {
    const { choices, used } = threeThemes(room, []);
    return { ...base, status: STATUS.THEME, theme: null, themeChoices: choices, usedThemes: used };
  }
  return assignRound({ ...base, theme: null, themeChoices: null });
}
// 書く人に「何文めの、どの片」を割り当てる。項目の数までは1つの文を分けて持つ（少ないときは2つ以上持つ人がいる）。
// 項目の数より多いときは文を増やす。回ごとに、うけもつ項目をずらす
function assignRound(room) {
  const keys = slotKeysOf(extraOf(room));
  const writers = shuffle(playerNames(room));
  if (!writers.length) return undefined;
  const n = writers.length;
  const k = keys.length;
  const tasks = {};
  let nSent = 1;
  if (n <= k) {
    keys.forEach((_, slot) => {
      const w = writers[(slot + (room.round || 0)) % n];
      (tasks[w] = tasks[w] || []).push([0, slot]);
    });
  } else {
    nSent = Math.ceil(n / k);
    writers.forEach((w, i) => { tasks[w] = [[Math.floor(i / k), (i + (room.round || 0)) % k]]; });
  }
  return { ...room, status: STATUS.WRITE, slots: keys, tasks, nSent, sub: null, sents: null, read: null };
}

async function startGame() {
  const result = await hostTx((room) => {
    if (room.status !== STATUS.WAITING || !playerNames(room).length) return undefined;
    return prepRound({ ...room, game: (room.game || 0) + 1, book: null }, 0);
  }, 'はじめられませんでした。もう一度ためしてね');
  if (result?.committed) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count(`players-${playerNames(result.snapshot.val()).length}`);
  }
}
function rerollTheme() {
  hostTx((room) => {
    if (room.status !== STATUS.THEME) return undefined;
    const { choices, used } = threeThemes(room, arr(room.themeChoices));
    return { ...room, themeChoices: choices, usedThemes: used, theme: null };
  });
}
function setTheme(id) {
  hostTx((room) => (room.status === STATUS.THEME && arr(room.themeChoices).includes(id) ? { ...room, theme: id } : undefined));
}
async function beginWrite() {
  const result = await hostTx((room) => {
    if (room.status !== STATUS.THEME || !room.theme) return undefined;
    const used = arr(room.usedThemes);
    return assignRound({ ...room, usedThemes: used.includes(room.theme) ? used : used.concat(room.theme) });
  }, '書きはじめられませんでした。もう一度ためしてね');
  if (result?.committed) window.RoomkStats?.count(`theme-${result.snapshot.val().theme}`);
}
// みんなが送ったら読む（ホストの画面が行う）
let reading = false;
function maybeRead(room) {
  if (reading || room.status !== STATUS.WRITE || !writersOf(room).length || waitingOf(room).length) return;
  toRead();
}
// まだの所は候補からおまかせで埋める
async function toRead() {
  reading = true;
  try {
    await hostTx((room) => {
      if (room.status !== STATUS.WRITE) return undefined;
      const keys = slotsOf(room);
      const sents = Array.from({ length: room.nSent || 1 }, () => keys.map(() => null));
      Object.entries(tasksOf(room)).forEach(([name, list]) => {
        arr(list).map((t) => arr(t)).forEach(([sent, slot]) => {
          const t = subOf(room)[name]?.[`${sent}-${slot}`];
          if (t && sents[sent]) sents[sent][slot] = t;
        });
      });
      keys.forEach((key, slot) => {
        const used = sents.map((x) => x[slot]).filter(Boolean);
        sents.forEach((x) => { if (!x[slot]) { x[slot] = pickSome(poolOf(room, key), 1, used)[0] || ''; used.push(x[slot]); } });
      });
      return { ...room, status: STATUS.READ, sents: sents.map((parts) => ({ parts, hidden: false })), read: { idx: 0, at: now() } };
    }, '読む画面にできませんでした。もう一度ためしてね');
  } finally {
    reading = false;
  }
}
function replay() {
  hostTx((room) => (room.status === STATUS.READ ? { ...room, read: { ...room.read, at: now() } } : undefined));
}
function hideSent() {
  hostTx((room) => {
    if (room.status !== STATUS.READ) return undefined;
    const sents = arr(room.sents).slice();
    const i = room.read.idx;
    sents[i] = { ...sents[i], hidden: true };
    return { ...room, sents };
  });
}
function nextSent() {
  hostTx((room) => (room.status === STATUS.READ && room.read.idx < arr(room.sents).length - 1
    ? { ...room, read: { idx: room.read.idx + 1, at: now() } } : undefined));
}
// とばさなかった文を、おしまいの一覧に入れる
function keepRound(room) {
  const t = themeOf(room);
  const keep = arr(room.sents).filter((s) => !s.hidden)
    .map((s) => ({ parts: arr(s.parts), slots: slotsOf(room), lines: arr(s.lines), theme: t ? t.title : '' }));
  return arr(room.book).concat(keep);
}
function nextRound() {
  hostTx((room) => {
    if (room.status !== STATUS.READ) return undefined;
    const next = prepRound({ ...room, book: keepRound(room) }, (room.round || 0) + 1);
    return next || { ...room, book: keepRound(room), status: STATUS.RESULT };
  }, 'つぎの回にできませんでした。もう一度ためしてね');
}
function endGame() {
  hostTx((room) => (room.status === STATUS.READ ? { ...room, book: keepRound(room), status: STATUS.RESULT } : undefined),
    'おしまいにできませんでした。もう一度ためしてね');
}
async function backToLobby() {
  const result = await hostTx((room) => (room.status === STATUS.RESULT
    ? { ...room, status: STATUS.WAITING, tasks: null, sub: null, sents: null, read: null, theme: null, themeChoices: null, slots: null }
    : undefined), '待合室にもどれませんでした。もう一度ためしてね');
  if (result?.committed) window.RoomkStats?.count('again');
}

// ══════════════════════════════════════════════
// 書く（参加する人・遊ぶホスト）
// ══════════════════════════════════════════════
const draftKey = (room) => `${room.game}-${room.round}-${room.theme || ''}`;

function buildWrite(room) {
  const D = state.draft;
  const tasks = myTasks(room);
  const keys = slotsOf(room);
  D.key = draftKey(room);
  D.picks = {};
  D.free = {};
  D.cands = {};
  D.sent = !!subOf(room)[state.nickname];
  D.sentText = D.sent ? tasks.map((t) => quoted(keys[t[1]], subOf(room)[state.nickname][taskId(t)] || '')).join(' ') : '';
  tasks.forEach((t) => { D.cands[taskId(t)] = pickSome(poolOf(room, keys[t[1]]), 3); });
  const box = $('wSlots');
  box.textContent = '';
  tasks.forEach((t) => {
    const id = taskId(t);
    const s = slotOf(keys[t[1]]);
    const card = el('div', 'card ts-slot');
    card.dataset.task = id;
    const head = el('h2', 'ts-slot__head');
    head.append(el('span', 'ts-slot__tag', s.label), el('span', null, s.ask));
    // はじめは自分で書く。思いつかないときは候補から選べる
    D.free[id] = true;
    const free = el('div', 'ts-free');
    const lab = el('label', 'ts-form__label', s.label);
    const inp = el('input', 'ts-form__input');
    inp.type = 'text';
    inp.maxLength = PIECE_MAX;
    inp.autocomplete = 'off';
    inp.placeholder = `例: ${D.cands[id][0] || ''}`; // お題があるときは、お題の言葉を例にする
    inp.id = `wIn-${id}`;
    inp.setAttribute('enterkeyhint', 'done');
    lab.htmlFor = inp.id;
    const tail = s.tail.replace(/[、。]/g, '');
    const frow = el('div', 'ts-free__row');
    frow.append(inp);
    if (tail) frow.append(el('span', 'ts-free__tail', `（うしろに「${tail}」がつくよ）`));
    free.append(lab, frow);
    const cands = el('div', 'ts-cands');
    cands.hidden = true;
    const row = el('div', 'ts-row');
    const freeBtn = el('button', 'btn btn-secondary ts-btn-sub');
    freeBtn.type = 'button';
    freeBtn.append(icon('list'), el('span', null, '候補から選ぶ'));
    const more = el('button', 'btn btn-secondary ts-btn-sub');
    more.type = 'button';
    more.hidden = true;
    more.append(icon('refresh'), el('span', null, 'ほかの候補'));
    row.append(freeBtn, more);
    more.addEventListener('click', () => {
      D.cands[id] = pickSome(poolOf(room, s.key), 3, D.cands[id]);
      if (!D.free[id]) delete D.picks[id];
      drawCands(id);
      drawWriteState();
    });
    freeBtn.addEventListener('click', () => {
      D.free[id] = !D.free[id];
      free.hidden = !D.free[id];
      more.hidden = D.free[id];
      freeBtn.firstChild.textContent = D.free[id] ? 'list' : 'edit';
      freeBtn.lastChild.textContent = D.free[id] ? '候補から選ぶ' : '自分で書く';
      if (D.free[id]) { D.picks[id] = fixPiece(s.key, inp.value); inp.focus(); } else delete D.picks[id];
      drawCands(id);
      drawWriteState();
    });
    inp.addEventListener('input', () => { D.picks[id] = fixPiece(s.key, inp.value); drawWriteState(); });
    card.append(head, free, cands, row);
    box.appendChild(card);
    drawCands(id);
  });
  drawWriteState();
  const first = box.querySelector('input');
  if (first && !D.sent) first.focus({ preventScroll: true });
}
function drawCands(id) {
  const D = state.draft;
  const card = $('wSlots').querySelector(`[data-task="${id}"]`);
  if (!card || !state.room) return;
  const box = card.querySelector('.ts-cands');
  box.textContent = '';
  box.hidden = !!D.free[id];
  const key = slotsOf(state.room)[Number(id.split('-')[1])];
  D.cands[id].forEach((w) => {
    const b = el('button', 'ts-cand', pieceText(key, w).replace(/[、。]$/, ''));
    b.type = 'button';
    b.setAttribute('aria-pressed', String(D.picks[id] === w));
    b.addEventListener('click', () => { D.picks[id] = w; drawCands(id); drawWriteState(); });
    box.appendChild(b);
  });
}
function drawTemplate(room, mine) {
  const box = $('wTemplate');
  box.textContent = '';
  slotsOf(room).forEach((k, slot) => {
    const t = el('span', 'ts-template__cell', slotOf(k).label);
    if (mine.includes(slot)) t.classList.add('is-mine');
    box.appendChild(t);
  });
}
function drawWriteState() {
  const room = state.room;
  if (!room) return;
  const tasks = myTasks(room);
  $('wSend').disabled = !(tasks.length > 0 && tasks.every((t) => state.draft.picks[taskId(t)]));
}
async function sendWrite() {
  const room = state.room;
  const D = state.draft;
  if (!room || room.status !== STATUS.WRITE || $('wSend').disabled) return;
  const tasks = myTasks(room);
  const keys = slotsOf(room);
  if (!tasks.length || !tasks.every((t) => D.picks[taskId(t)])) return;
  const parts = {};
  tasks.forEach((t) => { parts[taskId(t)] = D.picks[taskId(t)]; });
  const round = room.round;
  const game = room.game;
  $('wSend').disabled = true;
  try {
    const result = await state.roomRef.transaction((cur) => {
      if (!cur || cur.status !== STATUS.WRITE || cur.round !== round || cur.game !== game) return undefined;
      const mine = arr(cur.tasks?.[state.nickname]).map((t) => arr(t));
      if (!mine.length) return undefined;
      const got = {};
      for (const t of mine) {
        const v = fixPiece(slotsOf(cur)[t[1]], parts[taskId(t)]);
        if (!v) return undefined;
        got[taskId(t)] = v;
      }
      return { ...cur, sub: { ...(cur.sub || {}), [state.nickname]: got } };
    });
    if (!result.committed) { toast('送れませんでした。もう読みはじめているかもしれないよ'); drawWriteState(); return; }
    D.sent = true;
    D.sentText = tasks.map((t) => quoted(keys[t[1]], parts[taskId(t)])).join(' ');
    render();
  } catch (error) {
    console.warn('[tsunagete-story] send failed', error);
    toast('送れませんでした。もう一度ためしてね');
    drawWriteState();
  }
}

// ══════════════════════════════════════════════
// そのあと…（だれでも）
// ══════════════════════════════════════════════
function buildLine(room) {
  const L = state.line;
  L.key = `${room.game}-${room.round}-${room.read.idx}`;
  L.cands = pickSome(WORDS.next, 3);
  $('rFree').hidden = false; // はじめは自分で書く
  $('rFreeInput').value = '';
  $('rFreeOpen').firstChild.textContent = 'list';
  $('rFreeOpen').lastChild.textContent = '候補から選ぶ';
  $('rMore').hidden = true;
  drawLineCands();
}
function drawLineCands() {
  const box = $('rCands');
  box.textContent = '';
  box.hidden = !$('rFree').hidden;
  state.line.cands.forEach((w) => {
    const b = el('button', 'ts-cand ts-cand--line', w);
    b.type = 'button';
    b.addEventListener('click', () => sendLine(w));
    box.appendChild(b);
  });
}
async function sendLine(text) {
  const room = state.room;
  if (!room || room.status !== STATUS.READ) return;
  const t = clean(text, LINE_MAX);
  if (!t) return;
  const idx = room.read.idx;
  const at = room.read.at;
  try {
    const result = await state.roomRef.transaction((cur) => {
      if (!cur || cur.status !== STATUS.READ || cur.read?.idx !== idx || cur.read?.at !== at) return undefined;
      const sents = arr(cur.sents).slice();
      const s = sents[idx];
      if (!s || s.hidden || arr(s.lines).length >= LINES_MAX || shownOf(cur) < slotsOf(cur).length) return undefined;
      sents[idx] = { ...s, lines: arr(s.lines).concat(t) };
      return { ...cur, sents };
    });
    if (!result.committed) { toast('足せませんでした'); return; }
    state.line.cands = pickSome(WORDS.next, 3, state.line.cands.concat([t]));
    $('rFreeInput').value = '';
    drawLineCands();
  } catch (error) {
    console.warn('[tsunagete-story] line failed', error);
    toast('足せませんでした。もう一度ためしてね');
  }
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
const roundLabel = (room) => `${(room.round || 0) + 1}回め`;
function ruleText(room) {
  const keys = slotKeysOf(extraOf(room));
  return `文の項目: ${keys.map((k) => slotOf(k).label).join('・')}／お題: ${THEME_MODES[settingsOf(room).themeMode] || 'あり'}`;
}
function drawTheme(box, room) {
  const t = themeOf(room);
  box.hidden = !t;
  if (t && box.dataset.theme !== t.id) {
    box.dataset.theme = t.id;
    box.textContent = '';
    box.append(el('span', 'ts-theme__label', 'お題'), el('span', 'ts-theme__title', t.title));
  }
}

function render() {
  const room = state.room;
  if (!room || !state.roomRef) return;
  if (room.status === STATUS.WAITING) return renderLobby(room);
  if (room.status === STATUS.THEME) return renderTheme(room);
  if (room.status === STATUS.WRITE) return renderWrite(room);
  if (room.status === STATUS.READ) return renderRead(room);
  if (room.status === STATUS.RESULT) return renderResult(room);
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
  $('hostPlaysField').hidden = !host;
  $('lobbyWait').hidden = host;
  $('lobbyHost').hidden = !host;
  $('lobbyInfo').hidden = host;
  $('lobbyRule').textContent = ruleText(room);
  if (!host) return;
  $('setHostPlays').checked = plays;
  // 足す項目（いくつでも）
  const box = $('extraOpts');
  box.textContent = '';
  const extra = extraOf(room);
  OPT_KEYS.forEach((k) => {
    const on = extra.includes(k);
    const b = el('button', 'ts-toggle');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.append(icon(on ? 'check_circle' : 'add_circle'), el('span', null, slotOf(k).label));
    b.addEventListener('click', () => toggleExtra(k));
    box.appendChild(b);
  });
  const keys = slotKeysOf(extra);
  $('extraNote').textContent = `いまの文の形: ${keys.map((k) => slotOf(k).label).join('・')}（${keys.length}つ）。ふやすと、1つの文に入る人がふえるよ`;
  segButtons($('themeOpts'), Object.entries(THEME_MODES), s.themeMode, (v) => setSetting('themeMode', v));
  $('themeNote').textContent = s.themeMode === 'on'
    ? '回のはじめに、お題を3つ出すよ。ホストが1つ選んでから書く（候補もお題の言葉になる）'
    : 'お題を出さないよ。候補はいろいろな言葉から出る';
  const count = playerNames(room).length;
  const enough = names.length >= 2 && count >= 1;
  $('btnStart').disabled = !enough;
  $('startNote').textContent = !enough ? '2人からはじめられるよ。参加用のリンクを送ってね' : `書く人は${count}人`;
}

function renderTheme(room) {
  if (state.currentScreen !== 'theme') showScreen('theme');
  const host = state.role === 'host';
  $('tRound').textContent = roundLabel(room);
  // 3つのお題。ホストは押して選ぶ。参加する人は見るだけ（ホストが選んだカードに色がつく）
  const box = $('tChoices');
  box.textContent = '';
  arr(room.themeChoices).forEach((id) => {
    const t = themeById(id);
    if (!t) return;
    const c = el(host ? 'button' : 'div', 'ts-choice');
    if (host) {
      c.type = 'button';
      c.setAttribute('aria-pressed', String(room.theme === id));
      c.addEventListener('click', () => setTheme(id));
    }
    if (room.theme === id) c.classList.add('is-on');
    c.append(el('span', 'ts-choice__title', t.title), el('span', 'ts-choice__ex', `例: ${t.who.slice(0, 3).join('・')}`));
    box.appendChild(c);
  });
  $('tLead').textContent = host ? '3つのお題から1つ選んでね' : (room.theme ? 'お題が決まりそう！' : 'ホストがお題を選んでいるよ');
  $('tHost').hidden = !host;
  $('btnBegin').disabled = !room.theme;
  $('tWait').hidden = host;
}

function renderWrite(room) {
  if (state.currentScreen !== 'write') showScreen('write');
  const host = state.role === 'host';
  const tasks = myTasks(room);
  const nSent = room.nSent || 1;
  $('wRound').textContent = `${roundLabel(room)}${nSent > 1 ? `　文を${nSent}つ作るよ` : ''}`;
  drawTheme($('wTheme'), room);
  if (tasks.length && state.draft.key !== draftKey(room)) buildWrite(room);
  if (tasks.length) drawTemplate(room, tasks.map((t) => t[1]));
  const sentHere = tasks.length > 0 && state.draft.sent && !!subOf(room)[state.nickname];
  $('wFormBox').hidden = !tasks.length || sentHere;
  $('wSent').hidden = !sentHere;
  $('wWatch').hidden = !!tasks.length || host;
  if (sentHere) {
    $('wSentText').textContent = state.draft.sentText || '';
    const rest = waitingOf(room).length;
    $('wSentRest').textContent = rest ? `あと${rest}人を待っているよ` : '';
  }
  $('wHost').hidden = !host;
  if (host) {
    const writers = writersOf(room);
    $('wProgress').textContent = `送った人 ${writers.filter((n) => subOf(room)[n]).length} / ${writers.length}人`;
  }
}

function renderRead(room) {
  if (state.currentScreen !== 'read') showScreen('read');
  const host = state.role === 'host';
  const sents = arr(room.sents);
  const nRead = sents.length;
  drawTheme($('rTheme'), room);
  $('rRound').textContent = nRead > 1 ? `${roundLabel(room)}　${room.read.idx + 1}つめの文（${nRead}つのうち）` : roundLabel(room);
  if (state.line.key !== `${room.game}-${room.round}-${room.read.idx}`) buildLine(room);
  drawnRead = '';
  drawRead();
  const last = room.read.idx >= nRead - 1;
  $('rHost').hidden = !host;
  $('btnNext').hidden = last;
  $('btnRound').hidden = !last;
  $('btnEnd').hidden = !last;
  $('btnHide').disabled = !!sents[room.read.idx]?.hidden;
  $('rWait').hidden = host;
  $('rWait').textContent = last ? 'ホストが次にすすめるのを待っているよ' : 'ホストがつぎの文を出すのを待っているよ';
}

// 読む画面。1片ずつ出るので、250ミリ秒ごとにも呼ぶ
let drawnRead = '';
function drawRead() {
  const room = state.room;
  if (!room || room.status !== STATUS.READ || !room.read) return;
  const keys = slotsOf(room);
  const s = arr(room.sents)[room.read.idx];
  if (!s) return;
  const lines = arr(s.lines);
  const shown = s.hidden ? 0 : shownOf(room);
  const sig = `${room.game}-${room.round}-${room.read.idx}-${room.read.at}-${shown}-${!!s.hidden}-${lines.length}`;
  if (sig === drawnRead) return;
  drawnRead = sig;
  const box = $('rPieces');
  box.textContent = '';
  box.hidden = !!s.hidden;
  $('rHidden').hidden = !s.hidden;
  keys.forEach((k, i) => {
    const c = el('div', 'ts-piece');
    c.appendChild(el('span', 'ts-piece__label', slotOf(k).label));
    if (i < shown) {
      c.classList.add('is-open');
      if (i === shown - 1) c.classList.add('is-new');
      c.appendChild(el('span', 'ts-piece__text', pieceText(k, arr(s.parts)[i] || '')));
    } else {
      c.appendChild(el('span', 'ts-piece__text ts-piece__text--wait', '？'));
    }
    box.appendChild(c);
  });
  const ul = $('rLines');
  ul.textContent = '';
  if (!s.hidden) lines.forEach((l) => ul.appendChild(el('li', 'ts-line', l)));
  const done = shown >= keys.length && !s.hidden;
  const full = lines.length >= LINES_MAX;
  $('rNextBox').hidden = !done || full;
  $('rFull').hidden = !done || !full;
  $('btnReplay').disabled = !!s.hidden;
}

function renderResult(room) {
  if (state.currentScreen !== 'result') showScreen('result');
  const book = arr(room.book);
  const ol = $('endBook');
  ol.textContent = '';
  book.forEach((b, i) => {
    const li = el('li', 'ts-book__item');
    // お題は、かわったところにだけ出す
    if (b.theme && (i === 0 || book[i - 1].theme !== b.theme)) li.appendChild(el('p', 'ts-book__theme', `お題　${b.theme}`));
    li.appendChild(el('p', 'ts-book__main', sentenceText(arr(b.parts), arr(b.slots))));
    arr(b.lines).forEach((l) => li.appendChild(el('p', 'ts-book__line', l)));
    ol.appendChild(li);
  });
  $('endNone').hidden = book.length > 0;
  $('btnAgain').hidden = state.role !== 'host';
  $('endWait').hidden = state.role === 'host';
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
$('btnTheme').addEventListener('click', rerollTheme);
$('btnBegin').addEventListener('click', beginWrite);
$('btnReadNow').addEventListener('click', toRead);
$('btnReplay').addEventListener('click', replay);
$('btnHide').addEventListener('click', hideSent);
$('btnNext').addEventListener('click', nextSent);
$('btnRound').addEventListener('click', nextRound);
$('btnEnd').addEventListener('click', endGame);
$('btnAgain').addEventListener('click', backToLobby);

// 日本語の変換中に Enter を押しても、変換の確定だけにする
let composing = false;
document.addEventListener('compositionstart', () => { composing = true; });
document.addEventListener('compositionend', () => { setTimeout(() => { composing = false; }, 0); });
$('wSlots').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    e.preventDefault();
    if (!composing && !e.isComposing) sendWrite();
  }
});
$('wSend').addEventListener('click', sendWrite);
$('wRedo').addEventListener('click', () => {
  state.draft.sent = false;
  $('wFormBox').hidden = false;
  $('wSent').hidden = true;
  drawWriteState();
});
$('rMore').addEventListener('click', () => { state.line.cands = pickSome(WORDS.next, 3, state.line.cands); drawLineCands(); });
$('rFreeOpen').addEventListener('click', () => {
  const f = $('rFree');
  f.hidden = !f.hidden;
  $('rFreeOpen').firstChild.textContent = f.hidden ? 'edit' : 'list';
  $('rFreeOpen').lastChild.textContent = f.hidden ? '自分で書く' : '候補から選ぶ';
  $('rMore').hidden = !f.hidden;
  drawLineCands();
  if (!f.hidden) $('rFreeInput').focus();
});
$('rFree').addEventListener('submit', (e) => {
  e.preventDefault();
  if (composing) return;
  sendLine($('rFreeInput').value);
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
