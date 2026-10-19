// しるしでヒント：伝える人がアイコン（しるし）を1つずつ出してお題を伝え、ほかの人が12個の候補から当てる個人戦。
// ルーム（Realtime Database）で進める。ルームの出入り・切断・再接続・みんなにみせる画面の作りはスタンプあてゲームにそろえている。
// お題とだれが何を選んだかはゲームの間だけルームに置き、「もう一回あそぶ」とルームを閉じたときに消える。
import { ICON_GROUPS, TOPICS, TOPIC_KINDS, BLOCKED } from './data.js?v=20261019b';

const CANDS = 3;           // 伝える人が選ぶお題の候補の数
const BOARD = 12;          // 当てる人に並べる候補の数（お題をふくむ）
const SAME_KIND = 6;       // そのうち、お題と同じなかまを入れる数（お題をふくむ）
const MAX_SIGNS = 6;       // 1問で出せるしるしの数
const POINTS = [3, 2, 1, 1, 1, 1]; // しるし何個目で当てたかの点（当てた人と、伝えた人の両方に入る）
const MISS = 1;            // はずれたら減る点（「このしるしでは選ばない」は減らない）。持ち点はマイナスになってもよい
const MIN_PLAYERS = 2;
const MAX_GUESTS = 8;
const MAX_PROXIES = 4;     // 端末なしの参加者（ホストが代わりに押す）
const KEYS = 'ABCDEFGHIJKL'; // 候補の記号（声やチャットで「C」のように言えるように）
const NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
const POP_MS = 2600;
const SIGN_TIMES = [0, 15, 30, 60]; // しるしごとに選ぶ時間（秒）。0 は時間制限なし（はじめの設定）
const signTimeOf = (value) => (SIGN_TIMES.includes(Number(value)) ? Number(value) : 0);
const JUDGE_GRACE_MS = 4000; // 抜けた人を待たずに答え合わせするまでの待ち（再読み込みの一瞬は待つ）       // しるしごとの結果を出しておく時間（音は鳴らさない）

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'shirushi_rooms';
const SESSION_KEY = 'shirushi_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = {
  WAITING: 'waiting',
  PICK: 'pick',
  HINT: 'hint',
  REVEAL: 'reveal',
  LAP: 'lap',
  END: 'end',
};
const GAME_STATUSES = [STATUS.PICK, STATUS.HINT, STATUS.REVEAL, STATUS.LAP, STATUS.END];
const DEFAULT_TITLE = document.title;

const ICONS = {};
ICON_GROUPS.forEach((group) => group.icons.forEach((icon) => { ICONS[icon.id] = { ...icon, group: group.id }; }));
// お題の番号 → なかま・出せないしるし
const KIND_OF = TOPICS.map((word) => Object.keys(TOPIC_KINDS).find((kind) => TOPIC_KINDS[kind].includes(word)) || null);
const BLOCKED_OF = TOPICS.map((word) => BLOCKED[word] || []);

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'
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
  watchTimer: null,
  // 端末の中だけで持つ状態
  sel: null,           // 伝える人が、次に出そうと選んでいるしるし
  selKey: null,
  pop: { key: null, judged: 0 },
  popTimer: null,
  judging: false,      // ホストがほかの人の代わりに答え合わせを進めている途中
  judgeTimer: null,
  judgeKey: null,
  timeTimer: null,     // ホストが、しるしの締め切りで答え合わせするタイマー
  timeKey: null,
  clockTimer: null,    // 残り時間の表示
  clockZero: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.sh-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
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

function fmtPts(n) {
  return (n < 0 ? '−' + (-n) : String(n)) + '点';
}

function fmtDelta(n) {
  return (n > 0 ? '+' : '') + fmtPts(n);
}

function ptsAt(n) {
  return POINTS[Math.min(n, POINTS.length) - 1] || 0;
}

function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

// transaction の中で使う乱数は、外で作った種から決める（同じ種なら何度呼ばれても同じ結果）
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(list, rng) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

// 在室している人を参加順に
function memberNames(room) {
  return byJoined(Object.entries(room?.players || {}));
}

function guestNames(room) {
  return memberNames(room).filter((name) => !room.players[name].isHost);
}

// 端末なしの参加者（ホストが代わりに押す）。切断しない
function proxyNames(room) {
  return byJoined(Object.entries(room?.proxies || {}));
}

// 遊ぶ人（ホストは「自分もプレイヤーとして参加する」のときだけ）。端末なしの参加者もふくめて参加順
function playingNames(room) {
  const entries = Object.entries(room?.players || {}).filter(([, p]) => !p.isHost || room.hostPlays)
    .concat(Object.entries(room?.proxies || {}));
  return byJoined(entries);
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function gameOf(room) {
  const game = room?.game;
  if (!game || typeof game !== 'object') return null;
  return game;
}

function orderOf(game) {
  return asList(game?.order).filter((name) => typeof name === 'string');
}

function isProxy(game, name) {
  return game?.proxy?.[name] === true;
}

// いまルームにいるか（端末なしの参加者はいつもいる）
function present(room, game, name) {
  return isProxy(game, name) || !!room?.players?.[name];
}

function isTopicIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < TOPICS.length;
}

function topicText(index) {
  return isTopicIndex(index) ? TOPICS[index] : '';
}

function scoreOf(game, name) {
  return Number(game?.scores?.[name]) || 0;
}

// いまの問。壊れた値は読み飛ばす
function questionOf(game) {
  const raw = game?.q;
  if (!raw || typeof raw !== 'object' || typeof raw.teller !== 'string') return null;
  const rawBoard = asList(raw.board);
  const topic = isTopicIndex(raw.topic) ? raw.topic : null;
  // 12個ちょうど・重複なし・お題をふくむ、でなければ、詰めずに候補なしとして扱う（位置がずれて、別の候補を採点しないように）
  const boardOk = rawBoard.length === BOARD && rawBoard.every(isTopicIndex) && new Set(rawBoard).size === BOARD
    && topic !== null && rawBoard.includes(topic);
  const board = boardOk ? rawBoard : [];
  const inBoard = (b) => Number.isInteger(b) && b >= 0 && b < board.length;
  const picks = {};
  Object.entries(raw.picks || {}).forEach(([name, b]) => { if (b === -1 || inBoard(b)) picks[name] = b; });
  const solved = {};
  Object.entries(raw.solved || {}).forEach(([name, n]) => { if (Number.isInteger(n) && n >= 1 && n <= MAX_SIGNS) solved[name] = n; });
  const misses = {};
  Object.entries(raw.misses || {}).forEach(([name, n]) => { if (Number.isInteger(n) && n > 0) misses[name] = n; });
  return {
    n: Number(raw.n) || 0,
    teller: raw.teller,
    cands: asList(raw.cands).filter(isTopicIndex),
    topic,
    board,
    signs: asList(raw.signs).filter((id) => typeof id === 'string' && ICONS[id]).slice(0, MAX_SIGNS),
    judged: Math.max(0, Number(raw.judged) || 0),
    picks,
    crossed: asList(raw.crossed).filter(inBoard),
    solved,
    misses,
    tellerPts: Number(raw.tellerPts) || 0,
    openedAt: Number(raw.openedAt) || 0,
    last: raw.last && typeof raw.last === 'object'
      ? { n: Number(raw.last.n) || 0, hit: asList(raw.last.hit).filter((x) => typeof x === 'string'), missed: asList(raw.last.missed).filter((x) => typeof x === 'string') }
      : null,
  };
}

// いまのしるしの締め切り（時間制限があって、しるしの答え合わせがまだのときだけ）
function deadlineOf(game, q) {
  const sec = signTimeOf(game?.signTime);
  if (!sec || !q || q.signs.length <= q.judged || !q.openedAt) return null;
  return q.openedAt + sec * 1000;
}

// いまの問で当てる人（伝える人・いない人をのぞく。ゲームに入っている人だけ）
function guessersOf(room, game, q) {
  return orderOf(game).filter((name) => name !== q.teller && present(room, game, name));
}

// ゲームの名前の持ち主（匿名ID）。ゲームの間は、その名前を同じ人だけが使える
function ownsName(game, name, uid) {
  return !!game && game.uids?.[name] === uid;
}

function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status === STATUS.WAITING) return false;
  if (isProxy(game, name)) return true;
  const owner = game.uids?.[name];
  return !!owner && owner !== uid;
}

function isHostSelf(room, uid) {
  return state.role === 'host' && room?.hostUid === uid;
}

// この画面が、いまの問の伝える人として操作するか（ホストは端末なしの子の番に代わりに操作する）
function actsAsTeller(room) {
  const game = gameOf(room);
  const q = questionOf(game);
  if (!q || state.role === 'spectator') return false;
  const uid = currentUid();
  if (q.teller === state.nickname && ownsName(game, state.nickname, uid)) return true;
  return isHostSelf(room, uid) && isProxy(game, q.teller);
}

// 自分が当てる人としてこの問に入っているか
function amGuesser(room) {
  const game = gameOf(room);
  const q = questionOf(game);
  if (!q || state.role === 'spectator' || q.teller === state.nickname) return false;
  return orderOf(game).includes(state.nickname) && ownsName(game, state.nickname, currentUid());
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
    console.warn('[shirushi-hint] expired room cleanup failed', error);
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

/* ── ゲームの組み立て（transaction の中で使う） ── */
// お題の候補3つ。ルームで使っていないお題を先に出す。avoid（いま出ている候補）は引かない
function drawCands(usedList, rng, avoid = []) {
  const used = new Set(asList(usedList).filter(isTopicIndex));
  const all = TOPICS.map((_, i) => i).filter((i) => !avoid.includes(i));
  const fresh = shuffled(all.filter((i) => !used.has(i)), rng);
  const again = shuffled(all.filter((i) => used.has(i)), rng);
  return fresh.concat(again).slice(0, CANDS);
}

// 当てる人に並べる候補。お題と同じなかまを SAME_KIND 個まで（お題をふくむ）そろえ、残りはほかのなかまから選ぶ
// （1つ目のしるしでなかまを出しても、まだ見分けがつかないように）
function boardFor(topic, rng) {
  const others = TOPICS.map((_, i) => i).filter((i) => i !== topic);
  const same = shuffled(others.filter((i) => KIND_OF[i] && KIND_OF[i] === KIND_OF[topic]), rng).slice(0, SAME_KIND - 1);
  const rest = shuffled(others.filter((i) => !same.includes(i) && KIND_OF[i] !== KIND_OF[topic]), rng).slice(0, BOARD - 1 - same.length);
  return shuffled([topic].concat(same, rest), rng);
}

// 順番の次の人の問へ。いない人はとばす。最後までいったら「一巡した」
function advance(room, game, seed) {
  const order = orderOf(game);
  const rng = seededRandom(seed);
  for (let i = (Number.isInteger(game.turn) ? game.turn : -1) + 1; i < order.length; i++) {
    if (!present(room, game, order[i])) continue;
    const n = (Number(game.qn) || 0) + 1;
    return {
      ...room,
      status: STATUS.PICK,
      game: {
        ...game,
        turn: i,
        qn: n,
        q: { n, teller: order[i], cands: drawCands(room.usedTopics, rng), judged: 0 },
      },
    };
  }
  return { ...room, status: STATUS.LAP, game: { ...game, turn: order.length, q: null } };
}

// いまのしるしの答え合わせ。当たった人に点、はずれた人は −1点、はずれた候補は消す
function judge(room, game, q) {
  const n = q.signs.length;
  const answer = q.board.indexOf(q.topic);
  const hit = [];
  const missed = [];
  const solved = { ...q.solved };
  const misses = { ...q.misses };
  const scores = { ...(game.scores || {}) };
  const crossed = q.crossed.slice();
  Object.entries(q.picks).forEach(([name, b]) => {
    if (b < 0) return; // 選ばない
    if (answer >= 0 && b === answer) {
      hit.push(name);
      solved[name] = n;
    } else {
      missed.push(name);
      misses[name] = (misses[name] || 0) + 1;
      scores[name] = (Number(scores[name]) || 0) - MISS;
      if (!crossed.includes(b)) crossed.push(b);
    }
  });
  const pts = ptsAt(n);
  hit.forEach((name) => { scores[name] = (Number(scores[name]) || 0) + pts; });
  let tellerPts = q.tellerPts;
  // 伝えた人は、最初に当たったしるしの点を1回だけもらう
  if (hit.length && !tellerPts) {
    tellerPts = pts;
    scores[q.teller] = (Number(scores[q.teller]) || 0) + pts;
  }
  const nextQ = {
    ...game.q,
    judged: n,
    picks: null,
    crossed,
    solved,
    misses,
    tellerPts,
    last: { n, hit: hit.length ? hit : null, missed: missed.length ? missed : null },
  };
  const nextGame = { ...game, scores, q: nextQ };
  // 終わりは、ゲームの当てる人がみんな当てたとき（いま抜けている人もふくめる。再読み込みの一瞬に答えへ進まないように）。
  // 抜けた人を待たずに終えるのは、退出とホストの見はり（judgeIfReady の settle）だけ
  const left = orderOf(game).filter((name) => name !== q.teller && !solved[name]);
  const done = !left.length || n >= MAX_SIGNS;
  return { ...room, status: done ? STATUS.REVEAL : STATUS.HINT, game: nextGame };
}

// まだ当てていない人（いる人）が全員選んだら、答え合わせする。
// settle: 抜けた人を待たずに問を終えてよいとき（退出・ホストの見はり）。いる当てる人がみんな当てていたら答えへ進める
function judgeIfReady(room, settle = false) {
  const game = gameOf(room);
  const q = questionOf(game);
  if (!q || room.status !== STATUS.HINT) return null;
  const guessers = guessersOf(room, game, q);
  const waiting = guessers.filter((name) => !q.solved[name]);
  const open = q.signs.length > q.judged;
  if (open && waiting.length && waiting.every((name) => name in q.picks)) {
    const judged = judge(room, game, q);
    if (!settle || judged.status !== STATUS.HINT) return judged;
    return judgeIfReady(judged, true) || judged;
  }
  if (settle && guessers.length && !waiting.length) {
    // 抜けた人が選んでいた分も答え合わせしてから終える
    const judged = open && Object.keys(q.picks).length ? judge(room, game, q) : room;
    return { ...judged, status: STATUS.REVEAL };
  }
  return null;
}

/* ── 再接続用の記録（お題や選んだ候補は保存しない） ── */
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
  ['pickCands', 'signsList', 'hintBoard', 'pickedList', 'proxyRows', 'palette', 'revealSigns', 'revealPoints', 'lapRank', 'endRank', 'orderList'].forEach((id) => $(id).replaceChildren());
  $('hintTopic').textContent = '';
  state.sel = null;
  state.selKey = null;
  state.pop = { key: null, judged: 0 };
  clearTimeout(state.popTimer);
  state.popTimer = null;
  $('popBanner').classList.remove('is-on');
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.judgeTimer);
  clearTimeout(state.timeTimer);
  clearInterval(state.clockTimer);
  clearTimeout(state.orphanTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef && state.role !== 'spectator') RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
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
    judging: false,
    judgeTimer: null,
    judgeKey: null,
    timeTimer: null,
    timeKey: null,
    clockTimer: null,
    clockZero: null,
  });
  clearSession();
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('btnOpenWatch').hidden = true;
  $('roomBar').hidden = true;
  $('hostGameRow').hidden = true;
  $('orderPanel').hidden = true;
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
    console.warn('[shirushi-hint] room listener failed', error);
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
  state.clockTimer = setInterval(updateClock, 250);
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
      await ref.transaction((room) => {
        full = false;
        if (!room || isExpired(room) || room.players?.[nickname]) return;
        if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) return;
        // 戻るときは参加したときの順番のまま。遊んでいるゲームの人は人数の上限を見ない
        const inGame = room.status !== STATUS.WAITING && ownsName(gameOf(room), nickname, uid);
        if (!inGame && guestNames(room).length >= MAX_GUESTS) {
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
      if (full && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally('このルームはいっぱいだよ');
      }
    }
  } catch (error) {
    console.warn('[shirushi-hint] presence recovery failed', error);
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
          hostPlays: false,
          signTime: 0,
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          lastGameId: 0,
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
    console.warn('[shirushi-hint] create failed', err);
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
      if (mine) {
        rejoinAt = Number(stale.joinedAt) || joinedAt;
      } else if (room.status !== STATUS.WAITING) {
        // 遊んでいる途中は、このゲームで遊んでいた人がタブを閉じたあとに入りなおすときだけ入れる
        if (!ownsName(game, nickname, uid)) { reason = '途中'; return; }
        rejoinAt = Number(game.joined?.[nickname]) || joinedAt;
      } else if (guestNames(room).length >= MAX_GUESTS) {
        reason = '満員';
        return;
      }
      return {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt },
        },
      };
    });
    if (!result.committed) {
      const messages = {
        '見つからない': 'ルームが見つからないよ。コードを確かめてね',
        '終了': 'このルームは終わったみたい',
        '名前': 'その名前は使われているよ。少し変えてみてね',
        '満員': 'このルームはいっぱいだよ',
        '途中': 'もうゲームが始まっているよ。終わって、ホストが「もう一回あそぶ」を押したら参加できるよ',
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[shirushi-hint] join failed', err);
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
  $('btnGoCreate').disabled = true;
  $('btnGoJoin').disabled = true;
  $('btnGoWatch').disabled = true;
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
    console.warn('[shirushi-hint] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    $('btnGoCreate').disabled = false;
    $('btnGoJoin').disabled = false;
    $('btnGoWatch').disabled = false;
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
  let finished = false;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す（点と名前はゲームが終わるまで残す。入りなおせるように）
      await ref.transaction((room) => {
        if (!room) return;
        if (room.players?.[nickname]?.uid !== uid) return;
        const players = { ...room.players };
        delete players[nickname];
        // 抜けた人を待たずに答え合わせできるなら、ここで進める
        const next = judgeIfReady({ ...room, players }, true);
        finished = !!next && room.status === STATUS.HINT && next.status === STATUS.REVEAL;
        return next || { ...room, players };
      });
    }
  } catch (error) {
    console.warn('[shirushi-hint] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.leaving = false;
    state.busy = false;
    // 退出の前に取り消した切断予約を張り直す
    ensurePresence(true);
    if (state.room) handleRoom(state.room);
    return;
  }
  state.busy = false;
  // 利用回数: この退出で答えの画面へ進んだ（抜けた人を待たずに終えた）
  if (finished) window.RoomkStats?.count('finish');
  leaveLocally('');
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
  if (state.role === 'host') {
    hostJudgeIfReady(room);
    hostWatchDeadline(room);
  }
}

function renderRoom(room) {
  const game = gameOf(room);
  const inGame = GAME_STATUSES.includes(room.status) && !!game;
  const status = inGame ? room.status : STATUS.WAITING;
  switch (status) {
    case STATUS.PICK: renderPick(room); break;
    case STATUS.HINT: renderHint(room); break;
    case STATUS.REVEAL: renderReveal(room); break;
    case STATUS.LAP: renderLap(room); break;
    case STATUS.END: renderEnd(room); break;
    default: renderWaiting(room);
  }
  const playing = [STATUS.PICK, STATUS.HINT, STATUS.REVEAL].includes(status);
  $('orderPanel').hidden = !playing;
  if (playing) renderOrder(room, game);
  // 遊んでいる途中（問の間）は、ホストだけ「この問を終えて次の人へ」「ここでおしまい」を出す
  const host = state.role === 'host';
  $('hostGameRow').hidden = !(host && inGame && status !== STATUS.END);
  $('btnSkipQuestion').hidden = !(status === STATUS.PICK || status === STATUS.HINT);
  checkPop(room);
}

function updateHostOverlay(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    if (!state.orphanTimer) {
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

function renderPeople(listId, names, labelFor, tagsFor, extraFor) {
  const list = $(listId);
  list.replaceChildren();
  names.forEach((name) => {
    const row = makeElement('li', 'sh-people__item');
    const who = makeElement('span', 'sh-people__name', name);
    (tagsFor ? tagsFor(name) : []).forEach((tag) => who.append(makeElement('span', 'sh-tag', tag)));
    row.append(who, makeElement('span', 'sh-people__status', labelFor(name)));
    const extra = extraFor ? extraFor(name) : null;
    if (extra) row.append(extra);
    list.append(row);
  });
}

function mineTag(name) {
  return name === state.nickname ? ['あなた'] : [];
}

function roundLabel(game) {
  const order = orderOf(game);
  const turn = Math.min((Number(game?.turn) || 0) + 1, order.length);
  return (Number(game?.lap) || 1) + '巡目　' + turn + '人目 / ' + order.length + '人';
}

function renderWaiting(room) {
  showScreen('waiting');
  const host = state.role === 'host';
  const spectator = state.role === 'spectator';
  $('waitingLead').textContent = host
    ? '参加する人がそろったら「はじめる」を押してね。'
    : (spectator
      ? 'ルームコード ' + state.roomCode + ' で参加できるよ。'
      : 'ホストが始めるまで待ってね。');
  const sec = signTimeOf(room.signTime);
  $('waitingTime').textContent = sec ? 'しるしごとに選ぶ時間: ' + sec + '秒' : '';
  const players = playingNames(room);
  const proxies = proxyNames(room);
  $('waitingCount').textContent = '参加者（遊ぶ人 ' + players.length + '人）';
  const names = memberNames(room).concat(proxies);
  renderPeople('waitingPlayers', names, (name) => {
    if (room.proxies?.[name]) return '参加中';
    if (!room.players[name].isHost) return '参加中';
    return room.hostPlays ? 'ホスト（遊ぶ）' : 'ホスト（進行）';
  }, (name) => {
    const tags = mineTag(name);
    // 「端末なし」はホストの画面にだけ出す
    if (host && room.proxies?.[name]) tags.push('端末なし');
    return tags;
  }, (name) => {
    if (!host || !room.proxies?.[name]) return null;
    const del = makeElement('button', 'sh-quiet-btn sh-people__del', '外す');
    del.type = 'button';
    del.setAttribute('aria-label', name + 'さんを外す');
    del.addEventListener('click', () => removeProxy(name));
    return del;
  });
  $('hostWaitingTools').hidden = !host;
  if (!host) return;
  const hasProxy = proxies.length > 0;
  $('hostPlays').checked = !!room.hostPlays;
  $('hostPlays').disabled = hasProxy;
  $('hostPlaysHint').textContent = hasProxy
    ? '端末なしの参加者がいるときは、ホストは進行だけになります（その子のお題や、選んだ候補を知るため）。'
    : '参加すると、ホストの画面にも自分のお題が出ます。そのときは「みんなにみせる画面」を共有してね。';
  $('btnAddProxy').disabled = proxies.length >= MAX_PROXIES;
  const current = signTimeOf(room.signTime);
  $('signTimeOpts').replaceChildren(...SIGN_TIMES.map((sec) => {
    const on = sec === current;
    const button = makeElement('button', 'sh-timeopt' + (on ? ' is-on' : ''), sec ? sec + '秒' : 'なし');
    button.type = 'button';
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    button.addEventListener('click', () => { if (!on) setSignTime(sec); });
    return button;
  }));
  const count = players.length;
  const ok = count >= MIN_PLAYERS;
  $('btnStartGame').disabled = !ok;
  $('startNote').textContent = ok
    ? '遊ぶ人がみんな入ったら始めてね。始まったあとは、新しく参加できないよ。'
    : '遊ぶ人が' + MIN_PLAYERS + '人以上になったら始められます（いま' + count + '人）。';
}

// 順番と点。点は参加した順のまま出す（順位は一巡したときに出す）
function renderOrder(room, game) {
  const order = orderOf(game);
  const q = questionOf(game);
  const list = $('orderList');
  list.replaceChildren(...order.map((name, i) => {
    const away = !present(room, game, name);
    const li = makeElement('li', 'sh-order__item' + (i === game.turn ? ' is-now' : '') + (away ? ' is-away' : ''));
    const who = makeElement('span', 'sh-order__name', name);
    if (name === state.nickname) who.append(makeElement('span', 'sh-tag', 'あなた'));
    if (q && q.teller === name && i === game.turn) who.append(makeElement('span', 'sh-tag sh-tag--now', '伝える人'));
    if (away) who.append(makeElement('span', 'sh-tag sh-tag--muted', '接続が切れています'));
    const score = scoreOf(game, name);
    li.append(who, makeElement('span', 'sh-order__pts' + (score < 0 ? ' is-minus' : ''), fmtPts(score)));
    return li;
  }));
}

/* ── お題を選ぶ ── */
function renderPick(room) {
  showScreen('pick');
  const game = gameOf(room);
  const q = questionOf(game);
  $('pickRound').textContent = roundLabel(game);
  const me = actsAsTeller(room);
  const forProxy = me && q.teller !== state.nickname;
  $('pickPanel').hidden = !me;
  if (me) {
    $('pickTitle').textContent = forProxy ? q.teller + 'さんが伝える番（代わりに選ぶ）' : 'あなたが伝える番だよ';
    $('pickLead').textContent = forProxy ? 'お題を1つ選んでね。' : 'お題を1つ選んでね。ほかの人には見えないよ。';
    $('pickCands').replaceChildren(...q.cands.map((t, i) => {
      const button = makeElement('button', 'sh-cand');
      button.type = 'button';
      button.append(makeElement('span', 'sh-cand__num', NUMS[i]), makeElement('span', 'sh-cand__text', TOPICS[t]));
      button.addEventListener('click', () => chooseTopic(t));
      return button;
    }));
  } else {
    $('pickTitle').textContent = q.teller + 'さんがお題を選んでいるよ';
    $('pickLead').textContent = '選んだら、しるしが出てくるよ。';
    $('pickCands').replaceChildren();
  }
}

/* ── しるしを出す・当てる ── */
function renderSigns(listId, signs, preview) {
  const items = signs.map((id, i) => signChip(id, i, false));
  if (preview && signs.length < MAX_SIGNS) items.push(signChip(preview, signs.length, true));
  if (!items.length) items.push(makeElement('li', 'sh-signs__empty', 'まだないよ'));
  $(listId).replaceChildren(...items);
}

function signChip(id, i, isPreview) {
  const li = makeElement('li', 'sh-sign' + (isPreview ? ' is-preview' : ''));
  li.append(makeElement('span', 'sh-sign__num', NUMS[i]), iconFace(ICONS[id]), makeElement('span', 'sh-sign__label', ICONS[id].label));
  if (isPreview) li.append(makeElement('span', 'sh-sign__note', 'まだ出していない'));
  return li;
}

function iconFace(icon) {
  if (icon.color) {
    const swatch = makeElement('span', 'sh-swatch');
    swatch.style.background = icon.color;
    swatch.setAttribute('aria-hidden', 'true');
    return swatch;
  }
  return msIcon(icon.icon, 'sh-sign__icon');
}

function renderHint(room) {
  showScreen('hint');
  const game = gameOf(room);
  const q = questionOf(game);
  const me = actsAsTeller(room);
  const forProxy = me && q.teller !== state.nickname;
  const step = q.signs.length;
  const open = step > q.judged;
  const guesser = amGuesser(room);
  const solved = guesser && q.solved[state.nickname];
  const picked = guesser && (state.nickname in q.picks);
  const myPick = picked ? q.picks[state.nickname] : null;
  const deadline = deadlineOf(game, q);
  const timeUpNow = !!deadline && RoomkRTDB.now() >= deadline;
  const canTap = guesser && !solved && !picked && open && !timeUpNow;
  $('hintRound').textContent = roundLabel(game);

  const away = !present(room, game, q.teller);
  $('tellerAwayNote').hidden = !away;
  $('tellerAwayNote').textContent = away
    ? (state.role === 'host'
      ? q.teller + 'さんの接続が切れています。戻るのを待つか、下の「この問を終えて次の人へ」で交代できます。'
      : q.teller + 'さんの接続が切れています。戻るのを待ってね。')
    : '';

  $('hintTopicBox').hidden = !me;
  if (me) {
    $('hintTopicLabel').textContent = forProxy ? q.teller + 'さんのお題' : 'あなたのお題';
    $('hintTopic').textContent = topicText(q.topic);
  } else {
    $('hintTopic').textContent = '';
  }
  // 伝える人が次に出そうとしているしるしは、問が変わったら消す
  const selKey = [game.id, q.n].join(':');
  if (state.selKey !== selKey) {
    state.selKey = selKey;
    state.sel = null;
  }
  if (state.sel && (!me || q.signs.includes(state.sel) || BLOCKED_OF[q.topic]?.includes(state.sel))) state.sel = null;
  $('signsTitle').textContent = q.teller + 'さんのしるし（' + step + ' / ' + MAX_SIGNS + '）';
  renderSigns('signsList', q.signs, me ? state.sel : null);

  let guide;
  if (me) {
    if (!step) guide = '1つ目のしるしを選んで「しるしを出す」を押してね';
    else if (step >= MAX_SIGNS) guide = open ? 'みんなが選ぶのを待っているよ（しるしは' + MAX_SIGNS + 'つまで。待てないときは「答えを見せる」）' : 'しるしは' + MAX_SIGNS + 'つまで';
    else if (open) guide = 'みんなが選ぶのを待っているよ。待たずに次のしるしを出してもいいよ';
    else guide = '次のしるしを選んでね';
  } else if (!guesser) {
    guide = !step ? q.teller + 'さんが1つ目のしるしを選んでいるよ' : (open ? 'みんなが候補から選んでいるよ' : '次のしるしを待っているよ');
  } else if (solved) {
    guide = NUMS[q.solved[state.nickname] - 1] + 'つ目で当てたよ！ ほかの人を待とう';
  } else if (!step) {
    guide = q.teller + 'さんが1つ目のしるしを選んでいるよ';
  } else if (picked) {
    guide = '選んだよ。みんなを待っているよ';
  } else if (!open && q.last && q.last.n === step && q.last.missed.includes(state.nickname)) {
    guide = 'はずれ（' + fmtDelta(-MISS) + '）。次のしるしを待っているよ';
  } else if (open) {
    guide = '候補から1つ選んでね（このしるしでは1回だけ）';
  } else {
    guide = '次のしるしを待っているよ';
  }
  $('hintGuide').textContent = guide;
  updateClock();

  // 候補（全員同じ並び。伝える人にだけお題の印）
  const answer = q.board.indexOf(q.topic);
  $('hintBoard').replaceChildren(...q.board.map((t, b) => {
    const crossed = q.crossed.includes(b);
    const showAnswer = (me || solved) && b === answer;
    const classes = ['sh-tile'];
    if (crossed) classes.push('is-crossed');
    if (showAnswer) classes.push('is-answer');
    if (b === myPick) classes.push('is-mine');
    const tappable = canTap && !crossed;
    const tile = makeElement(tappable ? 'button' : 'div', classes.join(' '));
    if (tappable) {
      tile.type = 'button';
      tile.addEventListener('click', () => guess(state.nickname, step, b));
    }
    tile.append(makeElement('span', 'sh-tile__key', KEYS[b]), makeElement('span', 'sh-tile__text', TOPICS[t]));
    if (crossed) tile.append(msIcon('close', 'sh-tile__mark'));
    else if (showAnswer) tile.append(makeElement('span', 'sh-tile__tag', me ? 'お題' : '当たり'));
    else if (b === myPick) tile.append(makeElement('span', 'sh-tile__tag', '選んだ'));
    return tile;
  }));
  $('btnSkipGuess').hidden = !canTap;

  // だれが選んだか（何を選んだかは出さない）
  const guessers = guessersOf(room, game, q);
  $('pickedList').hidden = !step;
  $('pickedList').replaceChildren(...guessers.map((name) => {
    let text = '考え中';
    let icon = 'more_horiz';
    if (q.solved[name]) { text = NUMS[q.solved[name] - 1] + 'で当てた'; icon = 'emoji_events'; }
    else if (!open) { text = '次のしるしを待っている'; icon = 'hourglass_top'; }
    else if (name in q.picks) { text = '選んだ'; icon = 'check_circle'; }
    const li = makeElement('li', 'sh-picked__item' + (q.solved[name] ? ' is-solved' : '') + (name in q.picks ? ' is-picked' : ''));
    li.append(msIcon(icon), makeElement('span', '', name), makeElement('span', 'sh-picked__state', text));
    return li;
  }));

  renderProxyPanel(room, game, q, open, step);
  $('tellerTools').hidden = !me;
  if (me) renderPalette(q);
}

// ホストが、端末なしの参加者の代わりに候補を選ぶ欄
function renderProxyPanel(room, game, q, open, step) {
  const host = isHostSelf(room, currentUid());
  const proxies = host ? orderOf(game).filter((name) => isProxy(game, name) && name !== q.teller) : [];
  $('proxyPanel').hidden = !proxies.length || !step;
  if (!proxies.length) {
    $('proxyRows').replaceChildren();
    return;
  }
  $('proxyRows').replaceChildren(...proxies.map((name) => {
    const row = makeElement('div', 'sh-proxy__row');
    const head = makeElement('p', 'sh-proxy__name');
    head.append(makeElement('strong', '', name));
    let text = '';
    const deadline = deadlineOf(game, q);
    const can = open && !q.solved[name] && !(name in q.picks) && !(deadline && RoomkRTDB.now() >= deadline);
    if (q.solved[name]) text = NUMS[q.solved[name] - 1] + 'つ目で当てた';
    else if (name in q.picks) text = q.picks[name] < 0 ? '選ばない' : '選んだ（' + KEYS[q.picks[name]] + '）';
    else if (!open) text = '次のしるしを待っている';
    if (text) head.append(makeElement('span', 'sh-proxy__state', text));
    row.append(head);
    if (can) {
      const keys = makeElement('div', 'sh-proxy__keys');
      q.board.forEach((t, b) => {
        const key = makeElement('button', 'sh-proxy__key', KEYS[b]);
        key.type = 'button';
        key.disabled = q.crossed.includes(b);
        key.setAttribute('aria-label', name + 'さんの代わりに ' + KEYS[b] + '（' + TOPICS[t] + '）を選ぶ');
        key.addEventListener('click', () => guess(name, step, b));
        keys.append(key);
      });
      const none = makeElement('button', 'btn btn-ghost btn-sm', '選ばない');
      none.type = 'button';
      none.addEventListener('click', () => guess(name, step, -1));
      keys.append(none);
      row.append(keys);
    }
    return row;
  }));
}

// 伝える人のアイコンの一覧。出したしるし・このお題では出せないしるしは押せない
function renderPalette(q) {
  const full = q.signs.length >= MAX_SIGNS;
  const blocked = BLOCKED_OF[q.topic] || [];
  $('btnSend').disabled = !state.sel || full;
  $('btnSend').textContent = full ? 'しるしは' + MAX_SIGNS + 'つまで' : NUMS[q.signs.length] + 'つ目のしるしを出す';
  $('sendPreview').textContent = state.sel ? '選んでいるしるし: ' + ICONS[state.sel].label : 'アイコンを1つ選んでね';
  $('palette').replaceChildren(...ICON_GROUPS.map((group) => {
    const section = makeElement('section', 'sh-pgroup');
    section.append(makeElement('h4', 'sh-pgroup__title', group.name));
    const grid = makeElement('div', 'sh-pgrid');
    group.icons.forEach((icon) => {
      const used = q.signs.includes(icon.id);
      const no = blocked.includes(icon.id);
      const on = state.sel === icon.id;
      const button = makeElement('button', 'sh-pbtn' + (on ? ' is-on' : '') + (used ? ' is-used' : '') + (no ? ' is-blocked' : ''));
      button.type = 'button';
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.disabled = used || full || no;
      button.append(iconFace(ICONS[icon.id]), makeElement('span', 'sh-pbtn__label', icon.label));
      if (on) button.append(msIcon('check_circle', 'sh-pbtn__mark'));
      if (used) {
        button.append(msIcon('done', 'sh-pbtn__mark sh-pbtn__mark--muted'));
        button.setAttribute('aria-label', icon.label + '（出した）');
      }
      if (no) {
        button.append(msIcon('block', 'sh-pbtn__mark sh-pbtn__mark--muted'));
        button.setAttribute('aria-label', icon.label + '（このお題では出せない）');
        button.title = 'このお題では出せない';
      }
      button.addEventListener('click', () => {
        state.sel = on ? null : icon.id;
        if (state.room) renderRoom(state.room);
      });
      grid.append(button);
    });
    section.append(grid);
    return section;
  }));
}

/* ── 答え・順位 ── */
function renderReveal(room) {
  showScreen('reveal');
  const game = gameOf(room);
  const q = questionOf(game);
  $('revealRound').textContent = roundLabel(game);
  $('revealTopic').textContent = topicText(q.topic);
  renderSigns('revealSigns', q.signs, null);
  const rows = [];
  const tellerRow = makeElement('li', 'sh-result__item');
  tellerRow.append(msIcon('campaign'), makeElement('span', 'sh-result__name', q.teller),
    makeElement('span', 'sh-result__what', '伝えた'), makeElement('span', 'sh-result__pts', fmtDelta(q.tellerPts)));
  rows.push(tellerRow);
  orderOf(game).filter((name) => name !== q.teller).forEach((name) => {
    const n = q.solved[name];
    const miss = q.misses[name] || 0;
    const delta = (n ? ptsAt(n) : 0) - miss * MISS;
    const what = (n ? NUMS[n - 1] + 'つ目で当てた' : '今回は当たらなかった') + (miss ? '・はずれ' + miss + '回' : '');
    const li = makeElement('li', 'sh-result__item' + (n ? ' is-solved' : ''));
    li.append(msIcon(n ? 'emoji_events' : 'person'), makeElement('span', 'sh-result__name', name),
      makeElement('span', 'sh-result__what', what), makeElement('span', 'sh-result__pts' + (delta < 0 ? ' is-minus' : ''), fmtDelta(delta)));
    rows.push(li);
  });
  $('revealPoints').replaceChildren(...rows);
  const host = state.role === 'host';
  const order = orderOf(game);
  const last = order.slice((Number(game.turn) || 0) + 1).every((name) => !present(room, game, name));
  $('hostRevealTools').hidden = !host;
  $('btnNext').textContent = last ? '順位を見る' : '次の人へ';
  $('revealWait').hidden = host || state.role === 'spectator';
}

// 順位（点の高い順。同じ点は同じ順位）
function renderRank(listId, game) {
  const list = orderOf(game).map((name) => ({ name, pts: scoreOf(game, name) })).sort((a, b) => b.pts - a.pts);
  let rank = 0;
  $(listId).replaceChildren(...list.map((row, i) => {
    if (i === 0 || row.pts !== list[i - 1].pts) rank = i + 1;
    const li = makeElement('li', 'sh-rank__item' + (rank === 1 ? ' is-top' : ''));
    li.append(rank === 1 ? msIcon('workspace_premium', 'sh-rank__crown') : makeElement('span', 'sh-rank__crown'),
      makeElement('span', 'sh-rank__no', rank + '位'), makeElement('span', 'sh-rank__name', row.name),
      makeElement('span', 'sh-rank__pts' + (row.pts < 0 ? ' is-minus' : ''), fmtPts(row.pts)));
    return li;
  }));
}

function renderLap(room) {
  showScreen('lap');
  const game = gameOf(room);
  $('lapTitle').textContent = 'みんな1回ずつ伝えたよ（' + (Number(game.lap) || 1) + '巡目）';
  renderRank('lapRank', game);
  const host = state.role === 'host';
  $('hostLapTools').hidden = !host;
  $('lapWait').hidden = host || state.role === 'spectator';
}

function renderEnd(room) {
  showScreen('end');
  renderRank('endRank', gameOf(room));
  const host = state.role === 'host';
  $('hostEndTools').hidden = !host;
  $('endWait').hidden = host || state.role === 'spectator';
}

// しるしごとの答え合わせの結果を、少しのあいだ大きく出す（音は鳴らさない）。答えの画面には重ねない
function checkPop(room) {
  const banner = $('popBanner');
  const game = gameOf(room);
  const q = questionOf(game);
  if (!q || room.status !== STATUS.HINT) {
    banner.classList.remove('is-on');
    if (q) state.pop = { key: game.id + ':' + q.n, judged: q.judged };
    return;
  }
  const key = game.id + ':' + q.n;
  if (state.pop.key !== key) {
    // 途中から見た人には出さない
    state.pop = { key, judged: q.judged };
    banner.classList.remove('is-on');
    return;
  }
  if (q.judged > state.pop.judged && q.last) {
    const hit = q.last.hit;
    banner.replaceChildren(msIcon(hit.length ? 'emoji_events' : 'help'),
      document.createTextNode(hit.length ? hit.join('さん・') + 'さんが当てた！' : 'このしるしでは、まだだれも当たらなかったよ'));
    banner.classList.toggle('is-hit', hit.length > 0);
    banner.classList.remove('is-on');
    void banner.offsetWidth;
    banner.classList.add('is-on');
    clearTimeout(state.popTimer);
    state.popTimer = setTimeout(() => { banner.classList.remove('is-on'); }, POP_MS);
  }
  state.pop.judged = q.judged;
}

/* ── みんなにみせる画面（画面共有用・見るだけ） ──
   ホストが別のタブで開いて共有する。ルームには入らず、RTDB には一切書き込まない
   （players にも入らない・切断予約をしない・期限切れのルームも消さない）。
   伝える人のお題・だれが何を選んだかは出さない。 */
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
    console.warn('[shirushi-hint] watch failed', error);
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
  state.clockTimer = setInterval(updateClock, 250);
  // 共有するタブ・ウィンドウを選ぶときに見分けられるよう、題名と見出しを変える
  document.title = 'みんなにみせる画面 | しるしでヒント | room-K';
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
    console.warn('[shirushi-hint] watch listener failed', error);
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
  state.clockTimer = null;
  state.clockZero = null;
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null });
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
  $('hostGameRow').hidden = true;
  $('orderPanel').hidden = true;
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

/* ── 問の中の操作 ── */
// いまの問を書きかえる。押した時点のゲームと問の番号を捕まえて、中で一致を確かめる（古い操作で次の問を変えない）
async function questionTransaction(mutate, failMessage) {
  if (state.role !== 'host' && state.role !== 'guest') return null;
  if (!state.roomRef || !state.room) return null;
  const game = gameOf(state.room);
  const q = questionOf(game);
  if (!game || !q) return null;
  const gameId = game.id;
  const qn = q.n;
  const uid = currentUid();
  const nickname = state.nickname;
  const role = state.role;
  let moved = false;
  try {
    const result = await state.roomRef.transaction((room) => {
      moved = false;
      if (!room || isExpired(room)) return;
      const current = gameOf(room);
      const cq = questionOf(current);
      if (!current || current.id !== gameId || !cq || cq.n !== qn) {
        moved = true;
        return;
      }
      const ctx = {
        room,
        game: current,
        q: cq,
        uid,
        nickname,
        isHost: role === 'host' && room.hostUid === uid,
      };
      // 伝える人本人か、端末なしの子の番のホスト
      ctx.teller = (cq.teller === nickname && ownsName(current, nickname, uid)) || (ctx.isHost && isProxy(current, cq.teller));
      return mutate(ctx);
    });
    if (!result.committed && !moved && failMessage) toast(failMessage);
    return result.committed ? result.snapshot.val() : null;
  } catch (error) {
    console.warn('[shirushi-hint] question action failed', error);
    if (failMessage) toast(failMessage);
    return null;
  }
}

function withQ(room, game, q) {
  return { ...room, game: { ...game, q } };
}

async function chooseTopic(t) {
  if (state.busy) return;
  const seed = randomSeed();
  state.busy = true;
  let players = 0;
  try {
    const after = await questionTransaction(({ room, game, q, teller }) => {
      if (!teller || room.status !== STATUS.PICK || !q.cands.includes(t)) return;
      players = orderOf(game).filter((name) => present(room, game, name)).length;
      const used = asList(room.usedTopics).filter(isTopicIndex);
      // 全部使ったら、使った記録を空にして最初から
      const usedTopics = used.length + 1 >= TOPICS.length ? [t] : used.filter((i) => i !== t).concat(t);
      return {
        ...room,
        status: STATUS.HINT,
        usedTopics,
        game: { ...game, q: { ...game.q, topic: t, board: boardFor(t, seededRandom(seed)), signs: null, judged: 0, picks: null, crossed: null, solved: null, misses: null, tellerPts: 0, last: null } },
      };
    }, 'お題を選べませんでした。画面を確かめてね');
    // 利用回数: 1問の始まり（お題が決まった）と、そのときの遊ぶ人の人数
    if (after) {
      window.RoomkStats?.count('start');
      window.RoomkStats?.count('players-' + players);
    }
  } finally {
    state.busy = false;
  }
}

async function rerollTopics() {
  if (state.busy) return;
  const seed = randomSeed();
  state.busy = true;
  try {
    await questionTransaction(({ room, game, q, teller }) => {
      if (!teller || room.status !== STATUS.PICK) return;
      return withQ(room, game, { ...game.q, cands: drawCands(room.usedTopics, seededRandom(seed), q.cands) });
    }, 'ほかの候補にできませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

async function passTurn() {
  if (state.busy) return;
  const seed = randomSeed();
  state.busy = true;
  try {
    await questionTransaction(({ room, game, teller }) => {
      if (!teller || room.status !== STATUS.PICK) return;
      return advance(room, game, seed);
    }, 'パスできませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

// しるしを出す。前のしるしの答え合わせがまだなら、ここで締める
async function sendSign() {
  const id = state.sel;
  if (!id || state.busy) return;
  state.busy = true;
  try {
    const after = await questionTransaction(({ room, game, q, teller }) => {
      if (!teller || room.status !== STATUS.HINT || !ICONS[id] || q.signs.includes(id) || q.signs.length >= MAX_SIGNS) return;
      if (BLOCKED_OF[q.topic]?.includes(id)) return; // このお題では出せないしるし
      let next = room;
      if (q.signs.length > q.judged) {
        next = judge(room, game, q);
        if (next.status !== STATUS.HINT) return next;
      }
      const g = gameOf(next);
      // 時間制限があるときの締め切りの起点は、サーバーが書きこんだ時刻（端末の時計のずれが入らないように）
      return withQ(next, g, { ...g.q, signs: q.signs.concat(id), picks: null, openedAt: signTimeOf(g.signTime) ? serverTimestamp() : null });
    }, 'しるしを出せませんでした。もう一度ためしてね');
    if (after) {
      state.sel = null;
      if (after.status === STATUS.REVEAL) window.RoomkStats?.count('finish');
    }
    if (state.room) renderRoom(state.room);
  } finally {
    state.busy = false;
  }
}

async function showAnswer() {
  if (state.busy) return;
  if (!window.confirm('答えを見せて、この問を終えますか？')) return;
  state.busy = true;
  try {
    const after = await questionTransaction(({ room, game, q, teller }) => {
      if (!teller || room.status !== STATUS.HINT) return;
      const next = q.signs.length > q.judged ? judge(room, game, q) : room;
      return { ...next, status: STATUS.REVEAL };
    }, '答えを見せられませんでした。もう一度ためしてね');
    if (after) window.RoomkStats?.count('finish');
  } finally {
    state.busy = false;
  }
}

// 当てる人が候補を選ぶ（b = -1 は「このしるしでは選ばない」）。ホストは端末なしの子の代わりに選べる
async function guess(name, step, b) {
  const after = await questionTransaction(({ room, game, q, nickname, uid, isHost }) => {
    if (room.status !== STATUS.HINT || step !== q.signs.length || q.signs.length <= q.judged) return;
    // 時間制限があるときは、締め切りのあとの選択は受けない（処理の順で結果が変わらないように）
    const deadline = deadlineOf(game, q);
    if (deadline && RoomkRTDB.now() > deadline) return;
    const self = name === nickname && ownsName(game, name, uid);
    const forProxy = isHost && isProxy(game, name);
    if (!self && !forProxy) return;
    if (!guessersOf(room, game, q).includes(name) || q.solved[name] || name in q.picks) return;
    if (b !== -1 && !(Number.isInteger(b) && b >= 0 && b < q.board.length && !q.crossed.includes(b))) return;
    const next = withQ(room, game, { ...game.q, picks: { ...q.picks, [name]: b } });
    return judgeIfReady(next) || next;
  }, '選べませんでした。画面を確かめてね');
  if (after?.status === STATUS.REVEAL) window.RoomkStats?.count('finish');
}

// 抜けた人がいて、残りの人が全員選んでいるときは、ホストが答え合わせを進める
// 抜けた人がいて、いる人が全員選んでいる（またはみんな当てている）ときは、ホストが答え合わせを進める。
// 再読み込みの一瞬かもしれないので、JUDGE_GRACE_MS 待ってから、まだそうなら進める
// 見はりの状況（同じ問・同じ答え合わせの段階・同じ顔ぶれ）。これが4秒変わらなかったときだけ進める
function judgeKey(room) {
  const game = gameOf(room);
  const q = questionOf(game);
  if (!q || !judgeIfReady(room, true)) return null;
  const who = guessersOf(room, game, q).map((name) => name + (q.solved[name] ? '!' : '') + (name in q.picks ? '*' : ''));
  return [game.id, q.n, q.judged, q.signs.length, who.join(',')].join('|');
}

function hostJudgeIfReady(room) {
  if (state.judging) return;
  const key = judgeKey(room);
  if (key === state.judgeKey) return;
  // 状況が変わったら、待ちなおす（前の問・前の状況のタイマーは取り消す）
  clearTimeout(state.judgeTimer);
  state.judgeTimer = null;
  state.judgeKey = key;
  if (!key) return;
  const ref = state.roomRef;
  state.judgeTimer = setTimeout(async () => {
    state.judgeTimer = null;
    state.judgeKey = null;
    if (state.roomRef !== ref || !state.room || judgeKey(state.room) !== key) return;
    state.judging = true;
    let finished = false;
    try {
      const after = await questionTransaction(({ room: current, isHost }) => {
        if (!isHost || judgeKey(current) !== key) return;
        const next = judgeIfReady(current, true);
        finished = !!next && next.status === STATUS.REVEAL;
        return next || undefined;
      }, null);
      if (after && finished) window.RoomkStats?.count('finish');
    } finally {
      state.judging = false;
    }
  }, JUDGE_GRACE_MS);
}

// 時間制限: しるしの締め切りになったら、ホストがそのしるしの答え合わせをする（選んでいない人は「選ばない」）
function hostWatchDeadline(room) {
  const game = gameOf(room);
  const q = questionOf(game);
  const deadline = room.status === STATUS.HINT ? deadlineOf(game, q) : null;
  const key = deadline ? [game.id, q.n, q.signs.length].join(':') : null;
  if (key === state.timeKey) return;
  clearTimeout(state.timeTimer);
  state.timeTimer = null;
  state.timeKey = key;
  if (!key) return;
  const ref = state.roomRef;
  state.timeTimer = setTimeout(() => {
    state.timeTimer = null;
    if (state.roomRef === ref) timeUp(key, deadline);
  }, Math.max(0, deadline - RoomkRTDB.now()) + 200);
}

async function timeUp(key, deadline) {
  let finished = false;
  const after = await questionTransaction(({ room, game, q, isHost }) => {
    finished = false;
    if (!isHost || room.status !== STATUS.HINT || q.signs.length <= q.judged) return;
    if ([game.id, q.n, q.signs.length].join(':') !== key || RoomkRTDB.now() < deadline - 500) return;
    const next = judge(room, game, q);
    finished = next.status === STATUS.REVEAL;
    return next;
  }, null);
  if (after && finished) window.RoomkStats?.count('finish');
  // まだ締まっていなければ（書き込みが通らなかったとき）見はりなおす
  state.timeKey = null;
  if (state.room && state.role === 'host') hostWatchDeadline(state.room);
}

// 残り時間の表示（しるしの答え合わせがまだで、時間制限があるときだけ）。音は鳴らさない
function updateClock() {
  const box = $('hintTimer');
  const room = state.room;
  const game = gameOf(room);
  const q = questionOf(game);
  const deadline = room && room.status === STATUS.HINT ? deadlineOf(game, q) : null;
  if (!deadline || state.currentScreen !== 'hint') {
    box.hidden = true;
    return;
  }
  const left = Math.max(0, Math.ceil((deadline - RoomkRTDB.now()) / 1000));
  // 0秒になったら、候補を押せないように描きなおす（1回だけ）
  const zeroKey = [state.roomCode, game.id, q.n, q.signs.length].join(':');
  if (left === 0 && state.clockZero !== zeroKey) {
    state.clockZero = zeroKey;
    renderRoom(room);
    return;
  }
  box.hidden = false;
  box.textContent = left > 0 ? 'のこり ' + left + '秒' : '時間です';
  box.classList.toggle('is-soon', left <= 5);
}

/* ── ホストの操作 ── */
async function hostTransaction(update, failMessage) {
  // 処理中の二度押しは何もしない（失敗の通知も出さない）
  if (state.role !== 'host' || state.busy || !state.roomRef) return null;
  state.busy = true;
  const uid = currentUid();
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      return update(room);
    });
    return result.committed;
  } catch (error) {
    console.warn('[shirushi-hint] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    state.busy = false;
  }
}

async function setSignTime(value) {
  const sec = signTimeOf(value);
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, signTime: sec };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && state.room) renderRoom(state.room);
}

async function setHostPlays(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    // 端末なしの参加者がいるときは、ホストは進行だけ
    if (value && proxyNames(room).length) return;
    return { ...room, hostPlays: value };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && state.room) renderRoom(state.room);
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
    if (room.players?.[name] || room.proxies?.[name] || name === room.host) { reason = '「' + name + '」はもういるよ'; return; }
    if (proxyNames(room).length >= MAX_PROXIES) { reason = '端末なしの参加者は' + MAX_PROXIES + '人までだよ'; return; }
    return {
      ...room,
      hostPlays: false,
      proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } },
    };
  }, '足せませんでした。もう一度ためしてね');
  if (ok) $('proxyName').value = '';
  else if (ok === false) setError('proxyError', reason || '足せませんでした。もう一度ためしてね');
}

async function removeProxy(name) {
  await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || !room.proxies?.[name]) return;
    const proxies = { ...room.proxies };
    delete proxies[name];
    return { ...room, proxies: Object.keys(proxies).length ? proxies : null };
  }, '外せませんでした。もう一度ためしてね');
}

async function startGame() {
  const seed = randomSeed();
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const names = playingNames(room);
    if (names.length < MIN_PLAYERS) return;
    const id = (Number(room.lastGameId) || 0) + 1;
    const proxies = room.proxies || {};
    const real = names.filter((name) => !proxies[name]);
    const game = {
      id,
      order: names, // 参加した順（ホストが遊ぶときはホストが最初）
      uids: Object.fromEntries(real.map((name) => [name, room.players[name].uid])),
      joined: Object.fromEntries(real.map((name) => [name, Number(room.players[name].joinedAt) || 0])),
      proxy: Object.keys(proxies).length ? Object.fromEntries(Object.keys(proxies).map((name) => [name, true])) : null,
      scores: Object.fromEntries(names.map((name) => [name, 0])),
      signTime: signTimeOf(room.signTime), // 「はじめる」の時点の設定で固定
      lap: 1,
      turn: -1,
      qn: 0,
    };
    return advance({ ...room, lastGameId: id }, game, seed);
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok === false) toast('はじめられませんでした。参加している人を確かめてね');
}

// 答えの画面から次の人へ（最後の人のあとは一巡の順位へ）
async function nextQuestion() {
  const game = gameOf(state.room);
  const q = questionOf(game);
  if (!game || !q) return;
  const gameId = game.id;
  const qn = q.n;
  const seed = randomSeed();
  let toPick = false;
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.REVEAL || current?.id !== gameId || questionOf(current)?.n !== qn) return;
    const next = advance(room, current, seed);
    toPick = next.status === STATUS.PICK;
    return next;
  }, '進めませんでした。もう一度ためしてね');
  // 利用回数: 答えのあと、続けて次の問へ進んだ（一巡の順位へ進んだときは数えない）
  if (ok && toPick) window.RoomkStats?.count('again');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
}

async function skipQuestion() {
  const game = gameOf(state.room);
  const q = questionOf(game);
  if (!game || !q) return;
  if (!window.confirm('この問を終えて、次の人の番にしますか？（ここまでの点は残ります）')) return;
  const gameId = game.id;
  const qn = q.n;
  const seed = randomSeed();
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if ((room.status !== STATUS.PICK && room.status !== STATUS.HINT) || current?.id !== gameId || questionOf(current)?.n !== qn) return;
    return advance(room, current, seed);
  }, '進めませんでした。もう一度ためしてね');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
}

async function lapAgain() {
  const gameId = gameOf(state.room)?.id;
  const seed = randomSeed();
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.LAP || current?.id !== gameId) return;
    if (orderOf(current).filter((name) => present(room, current, name)).length < MIN_PLAYERS) return;
    return advance(room, { ...current, lap: (Number(current.lap) || 1) + 1, turn: -1 }, seed);
  }, '進めませんでした。もう一度ためしてね');
  // 利用回数: 一巡の順位のあと、続けて次の問へ進んだ
  if (ok) window.RoomkStats?.count('again');
  if (ok === false) toast('いまいる人が' + MIN_PLAYERS + '人より少ないので、続けられません');
}

async function finishGame() {
  const game = gameOf(state.room);
  const gameId = game?.id;
  if (gameId == null) return;
  // 押した時点の進行（status と問の番号）を捕まえて、中で一致を確かめる（古い操作で次の問を終えない）
  const status = state.room.status;
  const qn = questionOf(game)?.n ?? null;
  if (!window.confirm('ここでおしまいにしますか？')) return;
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (!GAME_STATUSES.includes(room.status) || room.status === STATUS.END || current?.id !== gameId) return;
    if (room.status !== status || (questionOf(current)?.n ?? null) !== qn) return;
    return { ...room, status: STATUS.END, game: { ...current, q: null } };
  }, 'おしまいにできませんでした。もう一度ためしてね');
  if (ok === false) toast('おしまいにできませんでした。画面を確かめてね');
}

async function playAgain() {
  const gameId = gameOf(state.room)?.id;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.END || gameOf(room)?.id !== gameId) return;
    return { ...room, status: STATUS.WAITING, game: null };
  }, '戻れませんでした。もう一度ためしてね');
  if (ok) window.RoomkStats?.count('again');
  if (ok === false) toast('戻れませんでした。画面を確かめてね');
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
$('btnCreateBack').addEventListener('click', () => showScreen('top'));
$('btnJoinBack').addEventListener('click', () => showScreen('top'));
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('hostName'), createRoom);
submitOnEnter($('guestName'), joinRoom);
submitOnEnter($('joinCode'), joinRoom);
$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
$('btnCopyLink').addEventListener('click', (event) => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkRTDB.copyRoomLink(state.roomCode, event.currentTarget);
});

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
$('btnGoWatch').addEventListener('click', () => {
  setError('watchError', '');
  showScreen('watch-join');
});
$('btnWatchBack').addEventListener('click', () => showScreen('top'));
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
$('btnWatchEndTop').addEventListener('click', () => showScreen('top'));
$('btnOpenWatch').addEventListener('click', () => {
  if (state.role !== 'host' || !state.roomCode) return;
  // ポップアップブロックを避けるため、クリックの中で同期的に開く。noopener で元のタブと切り離す
  window.open(location.pathname + '?watch=' + state.roomCode, '_blank', 'noopener');
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);

$('hostPlays').addEventListener('change', (event) => setHostPlays(event.currentTarget.checked));
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnStartGame').addEventListener('click', startGame);
$('btnReroll').addEventListener('click', rerollTopics);
$('btnPass').addEventListener('click', passTurn);
$('btnSend').addEventListener('click', sendSign);
$('btnShow').addEventListener('click', showAnswer);
$('btnSkipGuess').addEventListener('click', () => {
  const q = questionOf(gameOf(state.room));
  if (q) guess(state.nickname, q.signs.length, -1);
});
$('btnNext').addEventListener('click', nextQuestion);
$('btnLapAgain').addEventListener('click', lapAgain);
$('btnSkipQuestion').addEventListener('click', skipQuestion);
$('btnFinish').addEventListener('click', finishGame);
$('btnPlayAgain').addEventListener('click', playAgain);

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
