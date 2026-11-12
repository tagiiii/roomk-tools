/* ことばダッシュ！
   言葉が1つ、画面を一瞬で走りぬける。なんて書いてあったかを当てるルーム型の個人戦。
   ホストははじめるときに全部の問題（どの言葉が、どの高さで、いつ走るか）を決めてルームに書き、
   動きはそれぞれの画面で作る（画面共有や通信の遅れでカクつかないように）。流す時刻はサーバー時刻（RoomkRTDB.now）で合わせる。
   言葉・こたえは参加する人の端末にも届く（性善説。画面には流れおわるまで出さない）。 */

const WORDS = window.KOTOBA_DASH_WORDS;
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'kotobadash_rooms';
const SESSION_KEY = 'kotobadash_session';
// ルームコードの形（共通の generateRoomCode と同じ文字。参加用のリンクの検査に使う）
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const MAX_GUESTS = 12;
const STATUS = { WAITING: 'waiting', Q: 'q', RESULT: 'result' };

const COUNT_MS = 3500;     // 1問めの 3・2・1
const READY_MS = 1500;     // 2問めから・もう一回流すときの「よーい」
const REVEAL_LAG = 400;    // こたえが出てから、ゆっくり流しはじめるまで
const AUTO_GAP = 3000;     // ゆっくり流しおえてから、自動でつぎへ進むまで
const HINT_MAX = 3;        // ヒントの段（文字数 → 最初の文字 → 最後の文字）

// travel: 言葉が画面を走りぬける時間（ミリ秒）。2026-11-09「遅すぎる」「もう少し長くていい」を受けた値
const SPEEDS = {
  slow: { label: 'ゆっくり', note: '4〜5文字の言葉が、少しゆっくり走りぬける', pools: ['middle'], travel: 1400 },
  normal: { label: 'ふつう', note: '4文字から長めの言葉まで走りぬける', pools: ['middle', 'long'], travel: 900 },
  fast: { label: 'はやい', note: '6文字より長い言葉が、一瞬で走りぬける', pools: ['long'], travel: 550 },
};
const COUNTS = [5, 10];
const KIND_INFO = {
  plain: { label: 'ことば', note: '右から左へ走る言葉を入力' },
  dir: { label: '逆走・ななめ', note: '左から・下から・ななめから来る' },
  order: { label: 'どっちが先？', note: '2つ流れて、先に来たほうを選ぶ' },
  cat: { label: 'どのなかま？', note: '流れた言葉のなかまを選ぶ' },
  fake: { label: 'にせもの入り', note: '似た言葉3つのうち、★のついた言葉を選ぶ' },
  pieces: { label: 'かくれ文字', note: '1文字ずつバラバラに流れる' },
};
const KINDS = Object.keys(KIND_INFO);
const AUTOS = { on: '自動で進む', off: 'ホストが押す' };
const LIMITS = [0, 10, 20, 30];  // こたえる時間（秒）。0 は決めない
const LANES = [0.22, 0.5, 0.78];
const DEFAULT_SETTINGS = { hostPlays: true, speed: 'normal', count: 5, kinds: KINDS.slice(), limit: 20, auto: 'on' };

const $ = (id) => document.getElementById(id);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const len = (s) => Array.from(s).length;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const now = () => RoomkRTDB.now();

// ひらがな・カタカナ・全角半角のちがいを気にせずくらべる
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, '')
  .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60)).toLowerCase();

// ══════════════════════════════════════════════
// 問題を作る（ホストだけ）
//   sprites: 走るもの。t0・dur は travel を1とした長さ。path は走る向き、lane は高さ（または横の位置）
// ══════════════════════════════════════════════
// 形の似た本当にある言葉を選ぶ（選択肢が「言葉になっているかどうか」で見分けられないように）。
//   同じ文字の種類（ひらがな／カタカナ）で長さの近いものから、同じ位置に同じ文字・形の似た文字があるほど似ているとみなす
const scriptOf = (w) => (/[ァ-ヶ]/.test(w) && !/[ぁ-ゖ]/.test(w) ? 'kata' : (/^[ぁ-ゖー]+$/.test(w) ? 'hira' : 'other'));
const lookAlike = (a, b) => a === b || WORDS.similar.some((g) => g.includes(a) && g.includes(b));
function likeness(word, other) {
  const a = Array.from(word);
  const b = Array.from(other);
  let score = -2 * Math.abs(a.length - b.length);
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    if (a[i] === b[i]) score += 3;
    else if (lookAlike(a[i], b[i])) score += 2;
    if (a[a.length - 1 - i] === b[b.length - 1 - i]) score += 1; // 終わりがそろっている
  }
  const rest = b.slice();
  a.forEach((c) => { const k = rest.indexOf(c); if (k >= 0) { score += 1; rest.splice(k, 1); } });
  return score;
}
function similarWords(word, n, pool) {
  const sc = scriptOf(word);
  const seen = new Set([norm(word)]);
  const cands = [];
  pool.forEach((w) => {
    if (seen.has(norm(w))) return;
    seen.add(norm(w));
    if (sc !== 'other' && scriptOf(w) !== sc) return;
    if (Math.abs(len(w) - len(word)) > 2) return;
    cands.push([likeness(word, w) + Math.random() * 2, w]);
  });
  cands.sort((x, y) => y[0] - x[0]);
  // 上位から少し幅をもたせて選ぶ（毎回同じ組にならないように）
  const out = shuffle(cands.slice(0, n + 3).map((c) => c[1])).slice(0, n);
  if (out.length < n) shuffle(pool).forEach((w) => { if (out.length < n && !seen.has(norm(w)) && !out.includes(w)) out.push(w); });
  return out;
}

const one = (text, path = 'rtl', lane = 0.5, t0 = 0, extra = {}) => Object.assign({ text, path, lane, t0, dur: 1 }, extra);

const BUILD = {
  plain(word) {
    return { kind: 'plain', input: true, answer: word, reveal: word, hint: '', prompt: 'なんて書いてあった？', sprites: [one(word)] };
  },
  dir(word) {
    const path = pick(['ltr', 'up', 'diag']);
    return { kind: 'dir', input: true, answer: word, reveal: word, hint: 'どこから来るかな？', prompt: 'なんて書いてあった？', sprites: [one(word, path, path === 'up' ? pick(LANES) : 0.5)] };
  },
  order() {
    const cat = pick(Object.keys(WORDS.cats));
    const [a, b] = shuffle(WORDS.cats[cat]);
    return {
      kind: 'order', input: false, answer: a, reveal: `先に流れたのは「${a}」`, options: shuffle([a, b]),
      hint: '言葉が2つ流れるよ。順番をよく見てね', prompt: 'どっちが先に流れた？',
      sprites: [one(a, 'rtl', 0.5, 0), one(b, 'rtl', 0.5, 0.8)],
    };
  },
  cat() {
    const cats = Object.keys(WORDS.cats);
    const c = pick(cats);
    const word = pick(WORDS.cats[c]);
    const others = shuffle(cats.filter((x) => x !== c)).slice(0, 2);
    return {
      kind: 'cat', input: false, answer: c, reveal: `「${word}」は ${c} のなかま`, options: shuffle([c, ...others]),
      hint: '流れた言葉のなかまを当てるよ', prompt: '流れた言葉は、どのなかま？', sprites: [one(word)],
    };
  },
  fake(word, ctx) {
    const fakes = similarWords(word, 2, ctx.pool);
    if (fakes.length < 2) return null;
    const lanes = shuffle(LANES);
    const all = [word, ...fakes];
    return {
      kind: 'fake', input: false, answer: word, reveal: `★のついた言葉は「${word}」`, options: shuffle(all),
      hint: '★のついた言葉をよく見てね', prompt: '★のついた言葉はどれ？',
      sprites: all.map((t, i) => one(t, 'rtl', lanes[i], Math.random() * 0.35, { small: true, real: i === 0 })),
    };
  },
  pieces(word) {
    const chars = Array.from(word);
    if (chars.length < 3) return null;
    let last = -1;
    const sprites = chars.map((c, i) => {
      let k; do { k = Math.floor(Math.random() * 3); } while (k === last);
      last = k;
      return one(c, 'rtl', LANES[k], i * 0.22, { small: true });
    });
    return { kind: 'pieces', input: true, answer: word, reveal: word, hint: '文字がバラバラに流れるよ', prompt: 'なんて言葉だった？', sprites };
  },
};

const kindsOf = (settings) => {
  const k = (Array.isArray(settings?.kinds) ? settings.kinds : KINDS).filter((x) => BUILD[x]);
  return k.length ? k : ['plain'];
};
const settingsOf = (room) => ({ ...DEFAULT_SETTINGS, ...(room?.settings || {}) });

function buildQuestions(settings) {
  const kinds = kindsOf(settings);
  // たくさんの言葉の中からランダムに選ぶ
  const pool = shuffle(SPEEDS[settings.speed].pools.flatMap((k) => WORDS[k] || []));
  const ctx = { pool: WORDS.middle.concat(WORDS.long) };
  const qs = [];
  let prev = null;
  while (qs.length < settings.count) {
    let kind;
    if (qs.length === 0 && kinds.includes('plain')) kind = 'plain';
    else kind = pick(kinds.length > 1 ? kinds.filter((k) => k !== prev) : kinds);
    const word = pool.length ? pool.pop() : pick(WORDS.middle);
    // 作れない組み合わせ（短すぎる・にせものが作れない）は、ほかの種類に替える
    let q = BUILD[kind](word, ctx);
    if (!q) {
      for (const k of shuffle(kinds.filter((x) => x !== kind && x !== 'cat' && x !== 'order'))) { q = BUILD[k](word, ctx); if (q) break; }
    }
    if (!q) q = BUILD.plain(word);
    prev = q.kind;
    qs.push(q);
  }
  return qs;
}

// 答え合わせでゆっくり流すときの速さと長さ
const flowUnits = (q) => Math.max(...q.sprites.map((s) => s.t0 + s.dur));
const travelOf = (room) => SPEEDS[settingsOf(room).speed].travel;
const slowTravel = (room) => Math.max(travelOf(room) * 3, 2000);
// こたえる時間の終わり（言葉が流れおわってから数える）
function deadlineOf(room, idx, showAt) {
  const limit = settingsOf(room).limit;
  return limit ? showAt + flowUnits(room.qs[idx]) * travelOf(room) + limit * 1000 : 0;
}

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
  sentKey: null,               // 送ったこたえ（ルームに届くまでの間、二度送らない）
  hint: { key: null, n: 0 },   // 自分が見たヒントの段（この画面だけ。ほかの人には送らない）
};

function showScreen(id) {
  document.querySelectorAll('.kd-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
  document.querySelector('.kd-wrap').classList.toggle('is-top', id === 'top');
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
// 遊ぶ人（進行だけのホストは含めない）。参加した順
function playerNames(room) {
  const plays = hostPlaysOf(room);
  return Object.entries(room.players || {})
    .filter(([, p]) => !p.isHost || plays)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([n]) => n);
}
// いまの問題にこたえる人（遊ぶ人のうち、この問題に入っている人）
const answerers = (room) => playerNames(room).filter((n) => room.inRound?.[n]);
const answersOf = (room, idx) => (room.answers && room.answers[idx]) || {};
const iPlay = (room) => state.role === 'guest' || (state.role === 'host' && hostPlaysOf(room));

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
    console.warn('[kotoba-dash] expired room cleanup failed', error);
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
  stopFlow();
  E.key = null;
  state.timerInterval = null;
  state.orphanTimer = null;
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  Object.assign(state, {
    role: null, nickname: null, roomCode: null, roomRef: null, room: null,
    connectedRef: null, connectedCallback: null, roomCallback: null, sentKey: null, hint: { key: null, n: 0 },
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
      console.warn('[kotoba-dash] presence recovery failed', error);
      toast('再接続に失敗しました。ページを読み直してね');
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
  state.timerInterval = setInterval(tickLimit, 250);
}

function handleRoom(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす。
    // 古い時刻のまま動くと「まだ期限前」で消せず、待つ画面のまま残る（2026-11-13）
    if (state.orphanTimer && state.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(state.orphanTimer); state.orphanTimer = null; }
    if (!state.orphanTimer) {
      state.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
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
  if (state.role === 'host') maybeReveal(room);
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
    console.warn('[kotoba-dash] create failed', error);
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
      // 遊んでいる途中でも入れる（つぎの問題から参加）
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
    console.warn('[kotoba-dash] join failed', error);
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
    console.warn('[kotoba-dash] reconnect failed', error);
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
      // 退出した人の当てた数は、結果に残す
      await ref.transaction((room) => {
        if (!room) return undefined;
        const next = { ...room, players: { ...(room.players || {}) } };
        delete next.players[nickname];
        if (room.inRound) { next.inRound = { ...room.inRound }; delete next.inRound[nickname]; }
        return next;
      });
    }
  } catch (error) {
    console.warn('[kotoba-dash] leave failed', error);
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
    console.warn('[kotoba-dash] host action failed', error);
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
function toggleKind(k) {
  hostTx((room) => {
    if (room.status !== STATUS.WAITING) return undefined;
    const kinds = kindsOf(room.settings);
    const has = kinds.includes(k);
    if (has && kinds.length === 1) return undefined; // 1つは残す
    const next = has ? kinds.filter((x) => x !== k) : KINDS.filter((x) => x === k || kinds.includes(x));
    return { ...room, settings: { ...settingsOf(room), kinds: next } };
  });
}
function newQ(room, idx, lead) {
  const showAt = now() + (lead === 'count' ? COUNT_MS : READY_MS);
  return { idx, lead, showAt, deadline: deadlineOf(room, idx, showAt), revealed: false };
}
async function startGame() {
  if (state.busy) return;
  state.busy = true;
  let count = 0;
  const result = await hostTx((room) => {
    if (room.status !== STATUS.WAITING) return undefined;
    const players = playerNames(room);
    if (!players.length) return undefined;
    count = players.length;
    const settings = settingsOf(room);
    const next = {
      ...room,
      status: STATUS.Q,
      game: (Number(room.game) || 0) + 1,
      settings,
      qs: buildQuestions(settings),
      inRound: Object.fromEntries(players.map((n) => [n, true])),
      answers: null,
      hits: null,
    };
    next.q = newQ(next, 0, 'count');
    return next;
  }, 'はじめられませんでした。もう一度ためしてね');
  state.busy = false;
  if (result?.committed) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + count);
  }
}
function replay() {
  hostTx((room) => {
    if (room.status !== STATUS.Q || room.q.revealed) return undefined;
    const showAt = now() + READY_MS;
    return { ...room, q: { ...room.q, lead: 'ready', showAt, deadline: deadlineOf(room, room.q.idx, showAt) } };
  });
}
// みんながこたえたら、こたえを出す
function maybeReveal(room) {
  if (room.status !== STATUS.Q || room.q.revealed) return;
  const list = answerers(room);
  const ans = answersOf(room, room.q.idx);
  if (list.length && list.every((n) => ans[n])) reveal();
}
let revealing = false;
async function reveal() {
  if (revealing) return;
  revealing = true;
  await hostTx((room) => {
    if (room.status !== STATUS.Q || room.q.revealed) return undefined;
    const revealAt = now() + REVEAL_LAG;
    const q = { ...room.q, revealed: true, revealAt, hold: false };
    q.nextAt = settingsOf(room).auto === 'on' ? revealAt + flowUnits(room.qs[room.q.idx]) * slowTravel(room) + AUTO_GAP : 0;
    const hits = { ...(room.hits || {}) };
    Object.entries(answersOf(room, room.q.idx)).forEach(([n, a]) => { if (a && a.ok) hits[n] = (hits[n] || 0) + 1; });
    return { ...room, q, hits };
  });
  revealing = false;
}
// 自動でつぎへ: ホストの画面が見回り（tickLimit）で、進む時刻を過ぎたかを確かめる。
//   setTimeout に頼ると、transaction のやり直しで古い値の通知が先に届いたときに予約が消える（2026-11-09 E2E で再現）
let advancing = false;
async function autoNext(room) {
  if (advancing || room.status !== STATUS.Q || !room.q.revealed || !room.q.nextAt || room.q.hold || now() < room.q.nextAt) return;
  advancing = true;
  await next();
  advancing = false;
}
function hold() {
  hostTx((room) => (room.status === STATUS.Q && room.q.revealed ? { ...room, q: { ...room.q, hold: true } } : undefined));
}
function next() {
  return hostTx((room) => {
    if (room.status !== STATUS.Q || !room.q.revealed) return undefined;
    if (room.q.idx + 1 >= room.qs.length) return { ...room, status: STATUS.RESULT };
    // 途中で入った人も、この問題から
    const inRound = { ...(room.inRound || {}) };
    playerNames(room).forEach((n) => { inRound[n] = true; });
    const nextRoom = { ...room, inRound };
    nextRoom.q = newQ(nextRoom, room.q.idx + 1, 'ready');
    return nextRoom;
  }, '進めませんでした。もう一度ためしてね');
}
async function backToLobby() {
  const result = await hostTx((room) => (room.status === STATUS.RESULT
    ? { ...room, status: STATUS.WAITING, qs: null, q: null, inRound: null, answers: null, hits: null }
    : undefined), '進めませんでした。もう一度ためしてね');
  if (result?.committed) window.RoomkStats?.count('again');
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

// ══════════════════════════════════════════════
// 走る言葉（それぞれの画面で動かす）
//   mode 'q': 問題として流す（3・2・1 か「よーい」のあと）／'slow': 答え合わせでゆっくりもう一度
// ══════════════════════════════════════════════
const E = { key: null, mode: 'q', lead: null, showAt: 0, travel: 0, end: 0, raf: 0, items: [], done: false, doneTimer: 0, composing: false };

function startFlow(key, q, showAt, travel, mode, lead) {
  stopFlow();
  Object.assign(E, { key, mode, lead, showAt, travel, done: false });
  const stage = $('qField');
  stage.querySelectorAll('.kd-word').forEach((w) => w.remove());
  E.items = q.sprites.map((s) => {
    const node = el('span', 'kd-word' + (s.small ? ' is-small' : '') + (s.real ? ' is-real' : ''), s.text);
    if (s.real) node.prepend(el('span', 'kd-word__star', '★'));
    node.style.visibility = 'hidden';
    stage.appendChild(node);
    return { s, node };
  });
  E.end = flowUnits(q) * travel;
  E.raf = requestAnimationFrame(tick);
  // 画面が隠れて描画が止まっても、走りおわる時刻にはこたえられるようにする
  E.doneTimer = setTimeout(finishFlow, Math.max(0, showAt + E.end - now()));
  render();
}
function stopFlow() {
  cancelAnimationFrame(E.raf);
  clearTimeout(E.doneTimer);
  E.raf = 0;
}
function finishFlow() {
  if (E.done) return;
  stopFlow();
  E.done = true;
  E.items.forEach((it) => it.node.remove());
  E.items = [];
  $('qCount').hidden = true;
  render();
}
// 画面が裏に回ってタイマーが遅れても、走りおわる時刻を過ぎていれば終わったことにする
function catchUpFlow() {
  if (E.key && !E.done && now() >= E.showAt + E.end) finishFlow();
}
// p（0〜1）のときの位置
function placeOf(s, p, W, H, w, h) {
  const laneY = Math.min(Math.max(s.lane * H - h / 2, 0), H - h);
  switch (s.path) {
    case 'ltr': return [-w + (W + w) * p, laneY];
    case 'up': return [Math.min(Math.max(s.lane * W - w / 2, 0), W - w), H - (H + h) * p];
    case 'diag': return [W - (W + w) * p, H - (H + h) * p];
    default: return [W - (W + w) * p, laneY];
  }
}
function tick() {
  E.raf = requestAnimationFrame(tick);
  const stage = $('qField');
  const at = now() - E.showAt;
  const count = $('qCount');
  if (at < 0) {
    count.hidden = !E.lead;
    count.classList.toggle('is-ready', E.lead === 'ready');
    count.textContent = E.lead === 'count' ? String(Math.ceil(-at / 1000)) : 'よーい…';
    return;
  }
  count.hidden = true;
  if (at >= E.end) { finishFlow(); return; }
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  E.items.forEach(({ s, node }) => {
    const p = (at - s.t0 * E.travel) / (s.dur * E.travel);
    if (p < 0 || p > 1) { node.style.visibility = 'hidden'; return; }
    const [x, y] = placeOf(s, p, W, H, node.offsetWidth, node.offsetHeight);
    node.style.transform = `translate(${x}px, ${y}px)`;
    node.style.visibility = 'visible';
  });
}

// ══════════════════════════════════════════════
// こたえる
// ══════════════════════════════════════════════
const myAnswer = (room) => answersOf(room, room.q.idx)[state.nickname] || null;
async function sendAnswer({ pass = false, choice = null } = {}) {
  catchUpFlow();
  const room = state.room;
  if (!room || room.status !== STATUS.Q || room.q.revealed || !E.done || E.mode !== 'q' || E.composing) return;
  if (!iPlay(room) || !room.inRound?.[state.nickname] || myAnswer(room)) return;
  const idx = room.q.idx;
  const key = `${room.game}:${idx}`;
  if (state.sentKey === key) return;
  const q = room.qs[idx];
  let ok = false;
  if (!pass) {
    if (q.input) {
      const text = clean($('qInput').value, 20);
      if (!text) { $('qInput').focus(); return; }
      ok = norm(text) === norm(q.answer);
    } else {
      if (choice == null) return;
      ok = choice === q.answer;
    }
  }
  state.sentKey = key;
  $('qInput').value = '';
  render();
  try {
    await state.roomRef.child(`answers/${idx}/${state.nickname}`).transaction((cur) => (cur ? undefined : { ok, pass }));
  } catch (error) {
    console.warn('[kotoba-dash] answer failed', error);
    state.sentKey = null;
    toast('こたえを送れませんでした。もう一度ためしてね');
    render();
  }
}
// ヒント（入力の問題だけ）。1段め: 何文字か、2段め: 最初の文字、3段め: 最後の文字。
//   ヒントを見ても当たりの数は同じ。見たかどうかはほかの人に送らない
function hintCells(word, n) {
  const chars = Array.from(word);
  return chars.map((c, i) => ((n >= 2 && i === 0) || (n >= 3 && i === chars.length - 1) ? c : ''));
}
function moreHint() {
  if (state.hint.n < HINT_MAX) state.hint.n += 1;
  render();
  $('qInput').focus();
}

// こたえる時間の表示（みんな）と、時間切れでこたえを出す（ホスト）
function tickLimit() {
  catchUpFlow();
  const room = state.room;
  if (state.role === 'host' && room) autoNext(room);
  const box = $('qTimer');
  const Q = room && room.status === STATUS.Q ? room.q : null;
  const on = !!(Q && Q.deadline && !Q.revealed && E.done && E.mode === 'q');
  box.hidden = !on;
  if (!on) return;
  const rest = Math.max(0, Q.deadline - now());
  $('qTimerText').textContent = `のこり ${Math.ceil(rest / 1000)} 秒`;
  $('qTimerBar').style.width = `${Math.min(100, (rest / (settingsOf(room).limit * 1000)) * 100)}%`;
  if (state.role === 'host' && rest <= 0) reveal();
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
function kindButtons(box, kinds) {
  box.textContent = '';
  KINDS.forEach((k) => {
    const on = kinds.includes(k);
    const b = el('button', 'kd-kind');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    const icon = el('span', 'material-symbols-rounded kd-kind__check', on ? 'check_circle' : 'radio_button_unchecked');
    icon.setAttribute('aria-hidden', 'true');
    const t = el('span', 'kd-kind__text');
    t.append(el('b', null, KIND_INFO[k].label), el('small', null, KIND_INFO[k].note));
    b.append(icon, t);
    b.addEventListener('click', () => toggleKind(k));
    box.appendChild(b);
  });
}
function ruleText(room) {
  const s = settingsOf(room);
  const kinds = kindsOf(s).map((k) => KIND_INFO[k].label).join('・');
  const limit = s.limit ? `こたえる時間: ${s.limit}秒` : 'こたえる時間: 決めない';
  return `はやさ: ${SPEEDS[s.speed].label}／${s.count}問／${limit}／問題の種類: ${kinds}`;
}

function render() {
  const room = state.room;
  if (!room || !state.roomRef) return;
  if (room.status === STATUS.WAITING) return renderLobby(room);
  if (room.status === STATUS.Q) return renderQuestion(room);
  if (room.status === STATUS.RESULT) return renderResult(room);
  return undefined;
}

function renderLobby(room) {
  stopFlow();
  E.key = null;
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
  $('hostPlaysField').hidden = !host;
  $('lobbyWait').hidden = host;
  $('lobbyHost').hidden = !host;
  $('lobbyInfo').hidden = host;
  $('lobbyRule').textContent = ruleText(room);
  if (!host) return;
  $('setHostPlays').checked = plays;
  segButtons($('speedOpts'), Object.entries(SPEEDS).map(([k, v]) => [k, v.label]), s.speed, (v) => setSetting('speed', v));
  $('speedNote').textContent = SPEEDS[s.speed].note;
  segButtons($('countOpts'), COUNTS.map((n) => [n, `${n}問`]), s.count, (v) => setSetting('count', v));
  kindButtons($('kindOpts'), kindsOf(s));
  segButtons($('limitOpts'), LIMITS.map((n) => [n, n ? `${n}秒` : '決めない']), s.limit, (v) => setSetting('limit', v));
  $('limitNote').textContent = s.limit ? `言葉が流れおわってから${s.limit}秒たつと、こたえが出るよ` : 'みんながこたえるか、ホストが「待たずにこたえを出す」を押すまで待つよ';
  segButtons($('autoOpts'), Object.entries(AUTOS), s.auto, (v) => setSetting('auto', v));
  $('autoNote').textContent = s.auto === 'on' ? 'こたえが出て少ししたら、つぎの問題へ進むよ。とめることもできるよ' : 'ホストが「つぎの問題へ」を押して進めるよ';
  const count = playerNames(room).length;
  $('btnStart').disabled = count < 1;
  $('startNote').textContent = count < 1 ? '遊ぶ人が入るのを待ってね（ホストが遊ぶときは「自分も遊ぶ」）' : `遊ぶ人は${count}人`;
}

function renderQuestion(room) {
  if (state.currentScreen !== 'q') showScreen('q');
  const Q = room.q;
  const q = room.qs[Q.idx];
  const host = state.role === 'host';
  const plays = iPlay(room);
  const inRound = plays && !!room.inRound?.[state.nickname];
  $('qNo').textContent = `${Q.idx + 1} / ${room.qs.length} 問め`;
  $('qMeBox').hidden = !plays;
  $('qMe').textContent = String((room.hits || {})[state.nickname] || 0);
  $('qWait').hidden = !plays || inRound;

  // 流す（問題が変わった・もう一回流した・こたえが出た）
  const key = `${room.game}:${Q.idx}:${Q.showAt}`;
  if (!Q.revealed && E.key !== key) { startFlow(key, q, Q.showAt, travelOf(room), 'q', Q.lead); return; }
  if (Q.revealed && E.key !== `${key}:slow`) { startFlow(`${key}:slow`, q, Q.revealAt, slowTravel(room), 'slow', null); return; }

  const mine = inRound ? myAnswer(room) : null;
  const sent = !!mine || state.sentKey === `${room.game}:${Q.idx}`;
  const flowing = !Q.revealed && !E.done;
  const slowing = Q.revealed && !E.done;
  $('qHint').hidden = !q.hint || Q.revealed;
  $('qHint').textContent = q.hint;
  $('qMark').hidden = flowing || Q.revealed;
  $('qSlow').hidden = !slowing;
  const ans = $('qAnswer');
  ans.hidden = !(Q.revealed && E.done);
  ans.textContent = q.reveal;
  ans.classList.toggle('is-long', len(q.reveal) > 8);
  // こたえるあいだは流れる場所をたたんで、入力欄とヒントを上に寄せる
  $('qField').classList.toggle('is-folded', !Q.revealed && !flowing);

  const canAnswer = inRound && !Q.revealed && !flowing && !sent;
  const form = $('qForm');
  const wasHidden = form.hidden;
  form.hidden = !canAnswer;
  $('qLabel').textContent = q.prompt;
  $('qInputRow').hidden = !q.input;
  const box = $('qChoices');
  box.hidden = !!q.input;
  if (!q.input && box.dataset.key !== key) {
    box.dataset.key = key;
    box.textContent = '';
    (q.options || []).forEach((o) => {
      const b = el('button', 'btn btn-secondary kd-choice', o);
      b.type = 'button';
      b.addEventListener('click', () => sendAnswer({ choice: o }));
      box.appendChild(b);
    });
  }
  if (canAnswer && wasHidden && q.input) $('qInput').focus();

  // ヒント（入力の問題だけ）。もう一回流しても、見たヒントは消えない
  const hintKey = `${room.game}:${Q.idx}`;
  if (state.hint.key !== hintKey) state.hint = { key: hintKey, n: 0 };
  const hb = $('qHintBar');
  hb.hidden = !(canAnswer && q.input);
  if (!hb.hidden) {
    const cells = $('qCells');
    cells.textContent = '';
    cells.hidden = state.hint.n === 0;
    if (state.hint.n) {
      hintCells(q.answer, state.hint.n).forEach((c) => cells.append(el('span', 'kd-cell' + (c ? ' is-open' : ''), c)));
      cells.setAttribute('aria-label', `${len(q.answer)}文字`);
    }
    const hbtn = $('qHintBtn');
    hbtn.hidden = state.hint.n >= HINT_MAX;
    hbtn.lastChild.textContent = ['ヒントを見る', '最初の文字を見る', '最後の文字を見る'][state.hint.n] || '';
    $('qCellsNote').textContent = state.hint.n ? `${len(q.answer)}文字の言葉だよ` : '';
  }

  const sentEl = $('qSent');
  sentEl.hidden = !(inRound && sent && !Q.revealed);
  const left = answerers(room).filter((n) => !answersOf(room, Q.idx)[n] && n !== state.nickname).length;
  sentEl.textContent = `${mine && mine.pass ? 'パスしたよ' : 'こたえたよ'}。${left ? `あと${left}人を待っているよ` : 'こたえが出るよ'}`;

  const mineEl = $('qMine');
  const hit = !!(mine && mine.ok);
  mineEl.hidden = !(inRound && Q.revealed);
  mineEl.className = 'kd-mine' + (hit ? ' is-hit' : '');
  mineEl.textContent = hit ? 'あたり！' : (slowing ? 'ゆっくり見てみよう' : 'こたえはこれだったよ');

  $('qHost').hidden = !host;
  if (host) {
    const list = answerers(room);
    const n = list.filter((x) => answersOf(room, Q.idx)[x]).length;
    const waitingAuto = Q.revealed && Q.nextAt && !Q.hold;
    $('qProgress').textContent = !Q.revealed ? `${list.length}人のうち ${n}人がこたえたよ`
      : (waitingAuto ? '少ししたら、自動でつぎへ進むよ' : (Q.hold ? '自動で進むのをとめたよ' : ''));
    $('btnReplay').hidden = Q.revealed;
    $('btnReplay').disabled = flowing;
    $('btnReveal').hidden = Q.revealed;
    $('btnReveal').disabled = flowing;
    $('btnHold').hidden = !waitingAuto;
    $('btnNext').hidden = !Q.revealed;
    $('btnNext').textContent = Q.idx + 1 >= room.qs.length ? '結果を見る' : 'つぎの問題へ';
  }
}

function renderResult(room) {
  stopFlow();
  E.key = null;
  if (state.currentScreen !== 'result') showScreen('result');
  const me = state.nickname;
  const hits = room.hits || {};
  const myHits = hits[me] || 0;
  // 0 のときは出さない
  $('resMe').textContent = iPlay(room) && myHits ? `あなたは ${myHits} こ 当てたよ` : '';
  const ul = $('resWords');
  ul.textContent = '';
  (room.qs || []).forEach((q, i) => {
    const shown = q.kind === 'cat' || q.kind === 'order' ? q.sprites.map((s) => s.text).join('・') : q.answer;
    ul.appendChild(el('li', answersOf(room, i)[me]?.ok ? 'is-hit' : null, shown));
  });
  // 個人戦（2026-11-09 オーナー）。当てた数の多い順に並べる（順位の数字はつけない）。1こも当たらなかった人は並べない
  const people = Object.entries(hits).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  $('resPeopleBox').hidden = !people.length;
  $('resNone').hidden = !!people.length;
  const pl = $('resPeople');
  pl.textContent = '';
  people.forEach(([name, v]) => {
    const li = el('li', name === me ? 'is-me' : null);
    li.append(el('span', 'kd-people__name', name), el('span', 'kd-people__n', `${v} こ`));
    pl.append(li);
  });
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
$('btnStart').addEventListener('click', startGame);
$('btnReplay').addEventListener('click', replay);
$('btnReveal').addEventListener('click', reveal);
$('btnHold').addEventListener('click', hold);
$('btnNext').addEventListener('click', next);
$('btnAgain').addEventListener('click', backToLobby);

// 入力欄。日本語の変換中に Enter を押しても、変換の確定だけにする
const input = $('qInput');
input.addEventListener('compositionstart', () => { E.composing = true; });
input.addEventListener('compositionend', () => { setTimeout(() => { E.composing = false; }, 0); });
$('qForm').addEventListener('submit', (e) => { e.preventDefault(); sendAnswer(); });
$('qPass').addEventListener('click', () => sendAnswer({ pass: true }));
$('qHintBtn').addEventListener('click', moreHint);

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
