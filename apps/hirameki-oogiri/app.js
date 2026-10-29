// ひらめき大喜利：お題に、思いついた答えを何回でも出す大喜利。出た答えは1つずつ、だれのか伏せてみんなの画面に出し、
// 投票する人の何割か（ホストが決める）が「おもしろい！」を押したら「一本！」。順位はつけない。
// ルーム（Realtime Database）で進める。ルームの出入り・切断・再接続・みんなにみせる画面の作りはしるしでヒントにそろえている。
// 時間で進むこと（答えを出す・押せる時間の終わり・一本の表示・時間で区切る）は、ふだんはホストの端末が進める。
// ホストのタブが裏に回って遅れたとき（みんなにみせる画面を前に出して共有するときなど）は、参加者の端末が少し遅れて代わりに進める。
import { TOPICS } from './data.js?v=20261030b';

const CANDS = 3;           // ホストが選ぶお題の候補の数
const NUMS = ['①', '②', '③', '④', '⑤'];
const ANSWER_MAX = 40;
const AUTO_MS = 10 * 1000;  // 届いた答えは、ホストが「みんなに出す」を押し忘れても、この時間で順番待ちへ（2026-10-30 オーナー判断）
const MAX_WAITING = 2;     // 1人が確認待ち・順番待ちにできる答えの数（1人が出し続けて、ほかの人の答えが出なくならないように）
const MAX_GUESTS = 15;
const MAX_PROXIES = 4;     // 端末のない参加者（ホストが代わりに書く・押す）
const MIN_VOTERS = 2;
const SHOW_SECS = [10, 15, 20]; // 1つの答えを見る（押せる）時間
const MINUTES = [2, 3, 5];      // 「時間で」区切るときの時間
const IPPON_MS = 3500;     // 一本を大きく出しておく時間
const GAP_MS = 900;        // 次の答えまでの間
const STEP_MS = 200;       // 時間の進みを見る間隔
const GUEST_LAG_MS = 800;  // 参加者の端末は、ここまで遅れていたら代わりに進める（ふだんはホストが進める）
// 一本に必要な割合（投票する人のうち）
const RATIOS = {
  half: { label: '半分', note: '投票する人の半分以上が押したら一本', frac: 1 / 2 },
  two3: { label: '3分の2', note: '投票する人の3分の2以上が押したら一本', frac: 2 / 3 },
  all: { label: '全員', note: '投票する人の全員が押したら一本', frac: 1 },
};
const MODES = {
  both: { label: '答えも出す', note: '答えを書いて出せるし、ほかの人の答えに「おもしろい！」も押せるよ' },
  press: { label: '投票だけ', note: '答えは書かないで、出た答えを見て、おもしろかったら「おもしろい！」を押して投票するよ' },
  none: { label: '進行だけ', note: '答えも書かないし「おもしろい！」も押さないよ（投票する人にも数えない）' },
};
const CUTS = {
  ippon: { label: '一本が出たら', note: '一本が出たら、答えの受付はおしまい。残りの答えを出し終えたら、結果を見て次のお題へ' },
  time: { label: '時間で', note: '時間になったら答えを締め切る。そのあいだは何回でも一本が出せる' },
};
const DEFAULT_RULE = { ratio: 'half', showSec: 15, cut: 'ippon', minutes: 3 };

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'oogiri_rooms';
const SESSION_KEY = 'oogiri_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = {
  WAITING: 'waiting',
  PICK: 'pick',
  PLAY: 'play',
  RESULT: 'result',
  END: 'end',
};
const GAME_STATUSES = [STATUS.PICK, STATUS.PLAY, STATUS.RESULT, STATUS.END];
const DEFAULT_TITLE = document.title;

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'
  nickname: null,
  mode: 'both',        // 自分の参加のしかた（在室を書き戻すときに使う）
  roomCode: null,
  roomRef: null,
  room: null,
  joinedAt: null,
  currentScreen: null,
  timerInterval: null,
  stepTimer: null,
  orphanTimer: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  sending: false,      // 答えを出している途中
  stepping: false,     // ホストが時間の進みを書きこんでいる途中
  watchTimer: null,
  ipponShown: null,
  lastStatusKey: null,
  finished: new Set(),  // 利用回数の finish を数えたお題（ゲームとお題の番号）
  rafId: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.og-screen').forEach((node) => node.classList.remove('active'));
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
  // toString などは、ルームの名前の一覧を引くときにほかのものとぶつかる
  if (value in Object.prototype) return 'その名前は使えないよ。少し変えてみてね';
  return '';
}

function cleanAnswer(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, ANSWER_MAX);
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

function randomId() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function shuffled(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/* ── ルームの読み取り ── */
function asList(value) {
  if (Array.isArray(value)) return value.filter((x) => x != null);
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

function isTopicIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < TOPICS.length;
}

function topicText(index) {
  return isTopicIndex(index) ? TOPICS[index] : '';
}

function ruleOf(room) {
  const raw = room?.rule || {};
  return {
    ratio: RATIOS[raw.ratio] ? raw.ratio : DEFAULT_RULE.ratio,
    showSec: SHOW_SECS.includes(raw.showSec) ? raw.showSec : DEFAULT_RULE.showSec,
    cut: CUTS[raw.cut] ? raw.cut : DEFAULT_RULE.cut,
    minutes: MINUTES.includes(raw.minutes) ? raw.minutes : DEFAULT_RULE.minutes,
  };
}

function modeOf(player) {
  return MODES[player?.mode] ? player.mode : 'both';
}

// 端末のない参加者（ホストが代わりに書く・押す）。切断しない
function proxyNames(room) {
  return byJoined(Object.entries(room?.proxies || {}));
}

function isProxy(room, name) {
  return !!room?.proxies?.[name];
}

// 参加した人（いまいない人もふくむ）と端末のない参加者を、参加した順に
function everyone(room) {
  const entries = Object.entries(room?.roster || {}).concat(Object.entries(room?.proxies || {}));
  return byJoined(entries);
}

function guestCount(room) {
  return Object.values(room?.players || {}).filter((p) => p && !p.isHost).length;
}

// 答えを書いた人 by の答えに投票する人（いる人で、進行だけでない人。端末のない参加者は、いつもいる）
function votersFor(room, by) {
  const present = Object.entries(room?.players || {}).filter(([name, p]) => p && modeOf(p) !== 'none' && name !== by).map(([name]) => name);
  return present.concat(proxyNames(room).filter((name) => name !== by));
}

function allVoters(room) {
  return votersFor(room, null);
}

function needOf(n, ratio) {
  return n ? Math.max(1, Math.ceil(n * RATIOS[ratio].frac - 1e-9)) : Infinity;
}

function readAnswer(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || typeof raw.by !== 'string') return null;
  const text = cleanAnswer(raw.text);
  if (!text) return null;
  return { id: raw.id, by: raw.by, text, ippon: raw.ippon === true, at: Number(raw.at) || 0 };
}

// ゲームの中身。壊れた値は読み飛ばす（ないものは null か空の配列にする。transaction でそのまま書き戻せるように）
function gameOf(room) {
  const raw = room?.game;
  if (!raw || typeof raw !== 'object') return null;
  const answers = (value) => asList(value).map(readAnswer).filter(Boolean);
  let cur = null;
  if (raw.cur && typeof raw.cur === 'object') {
    const a = readAnswer(raw.cur.a);
    if (a) {
      const presses = {};
      Object.keys(raw.cur.presses || {}).forEach((name) => { if (raw.cur.presses[name] === true) presses[name] = true; });
      cur = {
        a,
        at: Number(raw.cur.at) || 0,
        endsAt: Number(raw.cur.endsAt) || 0,
        presses,
        state: raw.cur.state === 'ippon' ? 'ippon' : 'open',
        holdUntil: Number(raw.cur.holdUntil) || 0,
      };
    }
  }
  return {
    id: Number(raw.id) || 0,
    round: Number(raw.round) || 0,
    topic: isTopicIndex(raw.topic) ? raw.topic : null,
    cands: asList(raw.cands).filter(isTopicIndex),
    closing: raw.closing === true,
    endBy: ['ippon', 'time', 'host'].includes(raw.endBy) ? raw.endBy : null,
    roundEndsAt: Number(raw.roundEndsAt) || 0,
    gapUntil: Number(raw.gapUntil) || 0,
    cur,
    pending: answers(raw.pending),
    queue: answers(raw.queue),
    shown: answers(raw.shown),
    hidden: answers(raw.hidden),
    history: asList(raw.history).filter((h) => h && isTopicIndex(h.topic)).map((h) => ({
      topic: h.topic,
      ippons: asList(h.ippons).map(readAnswer).filter(Boolean),
    })),
  };
}

// 1人の、確認待ちと順番待ちの答えの数
function waitingOf(game, name) {
  return game.pending.filter((a) => a.by === name).length + game.queue.filter((a) => a.by === name).length;
}

function pressCount(room, game) {
  const c = game.cur;
  return votersFor(room, c.a.by).filter((name) => c.presses[name]).length;
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
    console.warn('[hirameki-oogiri] expired room cleanup failed', error);
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

/* ── ゲームの進み（transaction の中でも使う） ── */
// お題の候補。このルームでまだ出していないお題を先に出す。「ほかの候補」では、いま出ている候補を避ける
function drawCands(used, avoid = []) {
  const all = TOPICS.map((_, i) => i).filter((i) => !avoid.includes(i));
  const fresh = shuffled(all.filter((i) => !used.includes(i)));
  const again = shuffled(all.filter((i) => used.includes(i)));
  return fresh.concat(again).slice(0, CANDS);
}

function finishCur(game, ippon, now) {
  const a = game.cur.a;
  game.shown.unshift({ id: a.id, by: a.by, text: a.text, ippon });
  if (ippon && game.history.length) game.history[game.history.length - 1].ippons.push({ id: a.id, by: a.by, text: a.text });
  game.cur = null;
  game.gapUntil = now + GAP_MS;
}

// 一本になったか（押した数を、いまの投票する人で数えなおす）。一本で区切るときは、ここで締め切る
function checkIppon(room, game, now) {
  const c = game.cur;
  if (!c || c.state !== 'open') return false;
  if (pressCount(room, game) < needOf(votersFor(room, c.a.by).length, ruleOf(room).ratio)) return false;
  c.state = 'ippon';
  c.holdUntil = now + IPPON_MS;
  // 一本で区切るときは、新しい答えの受付だけを締め切る。順番待ちの答えは最後まで出す（投票もでき、一本が増えてもよい。
  // 書いた答えが出ないまま終わる子がいないように。2026-10-30 オーナー判断）
  if (ruleOf(room).cut === 'ippon' && !game.closing) {
    game.closing = true;
    game.endBy = 'ippon';
  }
  return true;
}

// 時間で進む。一本・押せる時間の終わり・次の答え・時間で締め切る・結果へ。変わったら true
function stepGame(room, game, now) {
  if (room.status !== STATUS.PLAY) return false;
  let changed = false;
  // ホストが「みんなに出す」を押し忘れても、届いてから AUTO_MS たった答えは順番待ちへ（届いた順に）
  const due = game.pending.filter((a) => now >= a.at + AUTO_MS);
  if (due.length) {
    game.pending = game.pending.filter((a) => !due.includes(a));
    game.queue = game.queue.concat(due);
    changed = true;
  }
  const c = game.cur;
  if (c && c.state === 'open') {
    if (checkIppon(room, game, now)) changed = true;
    else if (now >= c.endsAt) { finishCur(game, false, now); changed = true; }
  } else if (c && c.state === 'ippon' && now >= c.holdUntil) {
    finishCur(game, true, now);
    changed = true;
  }
  if (ruleOf(room).cut === 'time' && !game.closing && game.roundEndsAt && now >= game.roundEndsAt) {
    game.closing = true;
    game.endBy = 'time';
    changed = true;
  }
  if (!game.cur && now >= game.gapUntil && game.queue.length) {
    const a = game.queue.shift();
    game.cur = { a, at: now, endsAt: now + ruleOf(room).showSec * 1000, presses: {}, state: 'open', holdUntil: 0 };
    changed = true;
  }
  // 確認待ちの答えがあるあいだは結果へ進まない（確認していない答えを結果に出さないため）
  if (!game.cur && game.closing && !game.queue.length && !game.pending.length) {
    room.status = STATUS.RESULT;
    changed = true;
  }
  return changed;
}

function withGame(room, game) {
  return { ...room, game };
}

/* ── 再接続用の記録（答えは保存しない） ── */
function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      role: state.role,
      nickname: state.nickname,
      roomCode: state.roomCode,
      uid: currentUid(),
      joinedAt: state.joinedAt,
      mode: state.mode,
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
  ['lobbyPlayers', 'pickCands', 'mineList', 'checkList', 'queueList', 'shownList', 'proxyPressList', 'proxyAdminList', 'resultIppon', 'resultOthers', 'endCounts', 'endHistory'].forEach((id) => $(id).replaceChildren());
  ['answerInput', 'proxyInput', 'proxyName'].forEach((id) => { $(id).value = ''; });
  ['answerMsg', 'proxyMsg', 'proxyAddMsg'].forEach((id) => { $(id).textContent = ''; });
  $('proxyWho').replaceChildren();
  delete $('proxyWho').dataset.ids;
  $('proxyAdmin').open = false;
  $('ipponPop').hidden = true;
  $('ipponPop').classList.remove('is-on');
  state.ipponShown = null;
  state.lastStatusKey = null;
  state.finished.clear();
  $('modeHome').append($('modeCard'));
  $('modeCard').hidden = true;
  document.querySelector('main').append($('proxyAdmin'));
  $('proxyAdmin').hidden = true;
  $('hostCtl').hidden = true;
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearInterval(state.stepTimer);
  cancelAnimationFrame(state.rafId);
  clearTimeout(state.orphanTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef && state.role !== 'spectator') RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  clearTimeout(state.watchTimer);
  Object.assign(state, {
    role: null,
    nickname: null,
    mode: 'both',
    roomCode: null,
    roomRef: null,
    room: null,
    joinedAt: null,
    timerInterval: null,
    stepTimer: null,
    orphanTimer: null,
    connectedRef: null,
    connectedCallback: null,
    roomCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    sending: false,
    stepping: false,
    watchTimer: null,
  });
  clearSession();
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('btnOpenWatch').hidden = true;
  $('roomBar').hidden = true;
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('top');
  if (message) toast(message, isError);
}

function connectToRoom(role, nickname, code, ref, joinedAt, mode) {
  // 念のため、前のルームの購読・タイマーが残っていたら片付けてからつなぐ
  if (state.roomRef) cleanupRoom();
  state.role = role;
  state.nickname = nickname;
  state.mode = MODES[mode] && (mode !== 'none' || role === 'host') ? mode : 'both';
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
    console.warn('[hirameki-oogiri] room listener failed', error);
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
  state.stepTimer = setInterval(stepTick, STEP_MS);
  startClock();
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

// 名前がほかの人のものか（ホスト・端末のない参加者・ほかの人が参加している名前）
function nameTaken(room, name, uid) {
  if (name === room.host || isProxy(room, name)) return true;
  const player = room.players?.[name];
  if (player && (player.isHost || player.uid !== uid)) return true;
  const member = room.roster?.[name];
  return !!member && member.uid !== uid;
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
  const mode = state.mode;
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
      // 名前がほかの人のものになっていたら、その人の在室に切断の予約を張らない
      if (nameTaken(state.room, nickname, uid)) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally('その名前はほかの人が使っているよ');
        return;
      }
      // 名前が自分に予約されている（roster が自分）ときだけ、先に切断の予約を張る（ほかの人がその名前を取れないので安全）。
      // 予約されていない（「もう一回あそぶ」で空いた）ときは、在室を書いてから張る（同じ名前で入った人の在室を消さないため）
      const owned = state.room.roster?.[nickname]?.uid === uid;
      if (owned) await ref.child('players/' + nickname).onDisconnect().remove();
      let lost = '';
      const result = await ref.transaction((room) => {
        lost = '';
        if (!room || isExpired(room) || room.players?.[nickname]) return;
        if (nameTaken(room, nickname, uid)) { lost = '名前'; return; }
        // 参加したことがある人は人数の上限を見ない（戻るときは参加したときの順番のまま）
        if (!room.roster?.[nickname] && guestCount(room) >= MAX_GUESTS) { lost = '満員'; return; }
        return {
          ...room,
          players: { ...(room.players || {}), [nickname]: { isHost: false, uid, joinedAt, mode } },
          roster: { ...(room.roster || {}), [nickname]: { uid, joinedAt } },
        };
      });
      if (!owned && result.committed && !lost) await ref.child('players/' + nickname).onDisconnect().remove();
      if (lost && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(lost === '満員' ? 'このルームはいっぱいだよ' : 'その名前はほかの人が使っているよ');
      }
    }
  } catch (error) {
    console.warn('[hirameki-oogiri] presence recovery failed', error);
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
          rule: { ...DEFAULT_RULE },
          players: { [nickname]: { isHost: true, uid, joinedAt, mode: 'both' } },
          roster: { [nickname]: { uid, joinedAt } },
        };
      });
      if (result.committed) {
        window.RoomkStats?.count('room-create');
        connectToRoom('host', nickname, code, ref, joinedAt, 'both');
        return;
      }
    }
    setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
  } catch (err) {
    console.warn('[hirameki-oogiri] create failed', err);
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
  const picked = document.querySelector('input[name="joinMode"]:checked');
  const mode = picked && picked.value === 'press' ? 'press' : 'both';
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
      if (nameTaken(room, nickname, uid)) { reason = '名前'; return; }
      // 前に参加していた人（タブが落ちた直後・送信後の切断のやり直しをふくむ）は、参加したときの順番のまま戻る
      const member = room.roster?.[nickname];
      if (member) rejoinAt = Number(member.joinedAt) || joinedAt;
      else if (guestCount(room) >= MAX_GUESTS) { reason = '満員'; return; }
      const at = rejoinAt || joinedAt;
      return {
        ...room,
        players: { ...(room.players || {}), [nickname]: { isHost: false, uid, joinedAt: at, mode } },
        roster: { ...(room.roster || {}), [nickname]: { uid, joinedAt: at } },
      };
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
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt, mode);
  } catch (err) {
    console.warn('[hirameki-oogiri] join failed', err);
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
  ['btnGoCreate', 'btnGoJoin', 'btnGoWatch'].forEach((id) => { $(id).disabled = true; });
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
    let mode = saved.mode;
    if (saved.role === 'host') {
      if (room.host !== saved.nickname || room.hostUid !== uid) return false;
      const me = room.players?.[saved.nickname];
      joinedAt = Number(me?.joinedAt) || joinedAt;
      mode = modeOf(me);
    } else if (saved.role === 'guest') {
      if (nameTaken(room, saved.nickname, uid)) return false;
      const member = room.roster?.[saved.nickname];
      if (member) joinedAt = Number(member.joinedAt) || joinedAt;
      const me = room.players?.[saved.nickname];
      if (me) mode = modeOf(me);
    } else {
      return false;
    }
    if (state.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt, mode);
    return true;
  } catch (error) {
    console.warn('[hirameki-oogiri] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    ['btnGoCreate', 'btnGoJoin', 'btnGoWatch'].forEach((id) => { $(id).disabled = false; });
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
      // 自分の在室を消す。待合室なら名前も空ける（遊んでいる途中は、一本の数のために名前を残す。同じ人は戻れる）
      await ref.transaction((room) => {
        if (!room) return;
        // 通信の瞬断で在室が消えている間でも、名前（roster）が自分のものなら退出できる
        if (room.players?.[nickname]?.uid !== uid && room.roster?.[nickname]?.uid !== uid) return;
        const players = { ...(room.players || {}) };
        delete players[nickname];
        const next = { ...room, players };
        if (room.status === STATUS.WAITING && room.roster?.[nickname]?.uid === uid) {
          const roster = { ...room.roster };
          delete roster[nickname];
          next.roster = roster;
        }
        // 抜けたことで一本になる数が変わる。いま出ている答えが一本になっていれば、ここで一本にする
        const game = gameOf(next);
        if (game && next.status === STATUS.PLAY && checkIppon(next, game, RoomkRTDB.now())) return withGame(next, game);
        return next;
      });
    }
  } catch (error) {
    console.warn('[hirameki-oogiri] leave failed', error);
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

/* ── 画面の更新 ── */
function handleRoom(room) {
  if (state.role === 'guest') {
    const me = room.players?.[state.nickname];
    if (me && me.uid !== currentUid()) {
      leaveLocally('同じ名前の人が参加したので、ルームから外れました');
      return;
    }
    if (me && modeOf(me) !== state.mode) {
      state.mode = modeOf(me);
      saveSession();
    }
  }
  if (state.role === 'host') {
    const me = room.players?.[state.nickname];
    if (me && modeOf(me) !== state.mode) {
      state.mode = modeOf(me);
      saveSession();
    }
  }
  if (state.presenceDirty) ensurePresence(true);
  else if (needsPresence(room)) ensurePresence();
  updateHostOverlay(room);
  countFinish(room);
  renderRoom(room);
}

// 利用回数: お題の結果に進んだ（ホストの端末で、お題ごとに1回）
function countFinish(room) {
  const game = gameOf(room);
  const key = room.status + ':' + (game?.id || 0) + ':' + (game?.round || 0);
  const round = (game?.id || 0) + ':' + (game?.round || 0);
  if (state.role === 'host' && state.lastStatusKey && state.lastStatusKey.startsWith(STATUS.PLAY + ':') && room.status === STATUS.RESULT && !state.finished.has(round)) {
    state.finished.add(round);
    window.RoomkStats?.count('finish');
  }
  state.lastStatusKey = key;
}

function phaseOf(room) {
  const game = gameOf(room);
  return GAME_STATUSES.includes(room.status) && game ? room.status : STATUS.WAITING;
}

function renderRoom(room) {
  const phase = phaseOf(room);
  const game = gameOf(room);
  document.body.classList.toggle('is-play', phase === STATUS.PLAY);
  switch (phase) {
    case STATUS.PICK: renderPick(room, game); break;
    case STATUS.PLAY: renderPlay(room, game); break;
    case STATUS.RESULT: renderResult(room, game); break;
    case STATUS.END: renderEnd(room, game); break;
    default: renderWaiting(room);
  }
  $('hostCtl').hidden = !(state.role === 'host' && phase === STATUS.PICK);
  renderMode(room, phase);
  renderProxyAdmin(room, phase);
  renderIppon(room, game, phase);
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

const isHost = () => state.role === 'host';
const isWatch = () => state.role === 'spectator';
// 自分の在室（みんなにみせる画面は null）
function meOf(room) {
  if (isWatch()) return null;
  return room.players?.[state.nickname] || null;
}

function segBtn(label, on, onClick) {
  const b = makeElement('button', 'og-seg__btn' + (on ? ' is-on' : ''), label);
  b.type = 'button';
  b.setAttribute('role', 'radio');
  b.setAttribute('aria-checked', on ? 'true' : 'false');
  b.addEventListener('click', () => { if (!on) onClick(); });
  return b;
}

// 自分の参加のしかた。ほかの人の画面には出さない
function renderMode(room, phase) {
  const me = meOf(room);
  const show = !!me && phase !== STATUS.END;
  $('modeCard').hidden = !show;
  if (!show) return;
  // 待合室ではルールの下、遊んでいる間は自分の答えの下に置く。ほかの画面は下に
  const slot = $('slot-mode-' + phase);
  if (slot && $('modeCard').parentNode !== slot) slot.append($('modeCard'));
  else if (!slot && $('modeCard').parentNode !== $('modeHome')) $('modeHome').append($('modeCard'));
  const mode = modeOf(me);
  const keys = isHost() ? ['both', 'press', 'none'] : ['both', 'press'];
  $('modeOpts').replaceChildren(...keys.map((k) => segBtn(MODES[k].label, mode === k, () => setMode(k))));
  $('modeNote').textContent = MODES[mode].note;
}

// 端末のない参加者を足す・外す（ホストにだけ。待合室と結果の画面）
function renderProxyAdmin(room, phase) {
  const slot = isHost() ? $('slot-proxy-' + phase) : null;
  $('proxyAdmin').hidden = !slot;
  if (!slot) return;
  if ($('proxyAdmin').parentNode !== slot) slot.append($('proxyAdmin'));
  const px = proxyNames(room);
  $('proxyAdminList').replaceChildren(...px.map((name) => {
    const li = row(name, '', 'person');
    if (phase === STATUS.WAITING) {
      const b = makeElement('button', 'btn btn-ghost btn-sm og-list__btn og-proxy-remove', '外す');
      b.type = 'button';
      b.addEventListener('click', () => removeProxy(name));
      li.append(b);
    }
    return li;
  }));
  $('proxyAdminList').hidden = !px.length;
  $('proxyAdd').hidden = px.length >= MAX_PROXIES;
  $('proxyAdminNote').textContent = px.length >= MAX_PROXIES ? MAX_PROXIES + '人まで足せるよ'
    : phase === STATUS.WAITING ? '名前を足すと、ホストの画面で代わりに答えを書いたり「おもしろい！」を押したりできるよ（' + MAX_PROXIES + '人まで）'
      : '次のお題から参加できるよ（外すのは、もう一回あそぶときの待合室で）';
}

function renderWaiting(room) {
  showScreen('waiting');
  const rule = ruleOf(room);
  const present = room.players || {};
  // 参加のしかたの印はつけない（答えない子が目立たないように）
  $('lobbyPlayers').replaceChildren(...everyone(room).map((name) => {
    const p = present[name];
    const proxy = isProxy(room, name);
    const away = !p && !proxy;
    const li = makeElement('li', 'og-player' + (away ? ' is-away' : ''));
    li.append(msIcon(name === room.host ? 'star' : 'person'), makeElement('span', '', name));
    if (name === room.host) li.append(makeElement('span', 'og-tag', 'ホスト'));
    if (name === state.nickname && !isWatch()) li.append(makeElement('span', 'og-tag og-tag--muted', 'あなた'));
    // 端末なしの印はホストの画面にだけ（子どもどうしの画面で区別しない）
    if (proxy && isHost()) li.append(makeElement('span', 'og-tag og-tag--muted', '端末なし'));
    if (away) li.append(makeElement('span', 'og-tag og-tag--muted', '通信が切れたみたい'));
    return li;
  }));
  $('howtoRatio').textContent = 'おもしろかったら「おもしろい！」で投票。' + RATIOS[rule.ratio].note.replace('一本', '「一本！」');
  $('howtoCut').textContent = rule.cut === 'time'
    ? rule.minutes + '分たったら答えを締め切って、結果を見る'
    : '一本が出たら答えの受付はおしまい。残りの答えを出し終えたら、結果を見て次のお題へ';
  $('lobbyGuide').hidden = !isHost();
  $('lobbyHost').hidden = !isHost();
  $('lobbyStart').hidden = !isHost();
  $('lobbyWait').hidden = isHost() || isWatch();
  if (!isHost()) return;
  $('ratioOpts').replaceChildren(...Object.keys(RATIOS).map((k) => segBtn(RATIOS[k].label, rule.ratio === k, () => setRule('ratio', k))));
  $('ratioNote').textContent = RATIOS[rule.ratio].note + '（投票する人は、答えを出した本人をのぞいた全員）';
  $('cutOpts').replaceChildren(...Object.keys(CUTS).map((k) => segBtn(CUTS[k].label, rule.cut === k, () => setRule('cut', k))));
  $('timeOpts').hidden = rule.cut !== 'time';
  $('timeOpts').replaceChildren(...MINUTES.map((n) => segBtn(n + '分', rule.minutes === n, () => setRule('minutes', n))));
  $('showOpts').replaceChildren(...SHOW_SECS.map((n) => segBtn(n + '秒', rule.showSec === n, () => setRule('showSec', n))));
  $('cutNote').textContent = CUTS[rule.cut].note + '。ホストはいつでも「答えを締め切る」で区切れるよ';
  const n = allVoters(room).length;
  $('btnStart').disabled = n < MIN_VOTERS;
  $('lobbyStartNote').textContent = n < MIN_VOTERS ? '投票する人が' + MIN_VOTERS + '人以上で始められるよ' : '投票する人 ' + n + '人';
}

function renderPick(room, game) {
  showScreen('pick');
  $('pickHost').hidden = !isHost();
  $('pickOther').hidden = isHost();
  if (!isHost()) return;
  $('pickCands').replaceChildren(...game.cands.map((t, i) => {
    const b = makeElement('button', 'og-cand');
    b.type = 'button';
    b.append(makeElement('span', 'og-cand__num', NUMS[i] || ''), makeElement('span', 'og-cand__text', topicText(t)));
    b.addEventListener('click', () => chooseTopic(t));
    return b;
  }));
}

function row(text, what, icon, cls) {
  const li = makeElement('li', 'og-list__item' + (cls ? ' ' + cls : ''));
  li.append(msIcon(icon), makeElement('span', 'og-list__text', text), makeElement('span', 'og-list__what', what));
  return li;
}

// 出た答え。名前は一本のときだけ出す
function shownRow(a) {
  if (a.ippon) return row(a.text, a.by + 'さん', 'workspace_premium', 'is-ippon');
  return row(a.text, !isWatch() && a.by === state.nickname ? 'あなた' : '', 'chat_bubble');
}

function renderPlay(room, game) {
  showScreen('play');
  const me = meOf(room);
  const mode = modeOf(me);
  const rule = ruleOf(room);
  const c = game.cur;
  $('playTopic').textContent = topicText(game.topic);
  $('playRule').hidden = rule.cut !== 'ippon' || game.closing;
  $('playLeft').hidden = rule.cut !== 'time' || game.closing;
  $('hostPanel').hidden = !isHost();

  // いま出ている答え（だれのかは出さない）
  $('stageOn').hidden = !c;
  $('stageEmpty').hidden = !!c;
  $('stage').classList.toggle('is-on', !!c);
  if (c) {
    $('stageText').textContent = c.a.text;
    const mine = !!me && c.a.by === state.nickname;
    const canPress = !!me && !mine && mode !== 'none';
    const pressed = !!c.presses[state.nickname];
    $('btnPress').hidden = !canPress;
    $('btnPress').disabled = pressed || c.state !== 'open';
    $('btnPress').classList.toggle('is-pressed', pressed);
    $('btnPressLabel').textContent = pressed ? '押したよ' : 'おもしろい！';
    $('stageMine').hidden = !mine;
    $('btnHideCur').hidden = !isHost();
    $('stageHint').textContent = c.state !== 'open' ? ''
      : isWatch() ? 'おもしろかったら、自分の画面で「おもしろい！」を押してね'
        : !canPress ? '' : pressed ? '投票したよ' : 'おもしろかったら押して投票してね';
  } else {
    $('stageEmpty').textContent = isHost() && game.pending.length ? '「届いた答え」で「みんなに出す」を押すと、ここに出るよ' : '答えが出るのを待っているよ';
  }

  // 答えを書く（「答えも出す」の人だけ）
  const canAnswer = !!me && mode === 'both' && !game.closing;
  $('answerForm').hidden = !canAnswer;
  $('playClosed').hidden = !game.closing;
  $('playClosed').textContent = (game.endBy === 'ippon' ? '一本が出たので、答えの受付はおしまい'
    : game.endBy === 'time' ? '時間になったよ' : '締め切ったよ') + '。残りの答えが出たら結果へ進むよ';
  if (canAnswer) {
    const waiting = waitingOf(game, state.nickname);
    $('btnAnswer').disabled = waiting >= MAX_WAITING || state.sending;
    if (waiting >= MAX_WAITING && !state.sending) {
      $('answerMsg').textContent = '出るのを待っている答えが' + MAX_WAITING + 'つあるよ。出たら、また出せるよ';
      $('answerMsg').classList.remove('is-error');
    }
  }
  // お題がかわったら、前のお題の知らせは消す
  if ($('answerMsg').dataset.round !== String(game.round)) {
    $('answerMsg').textContent = '';
    $('answerMsg').dataset.round = String(game.round);
  }

  // 自分の答え（自分の画面にだけ）
  const mineRows = [];
  if (me) {
    const my = (a) => a.by === state.nickname;
    game.pending.filter(my).forEach((a) => mineRows.push(row(a.text, 'ホストが確認中', 'hourglass_top')));
    game.queue.filter(my).forEach((a) => mineRows.push(row(a.text, '順番待ち', 'schedule')));
    if (c && my(c.a)) mineRows.push(row(c.a.text, 'いま出ているよ', 'campaign'));
    game.shown.filter(my).forEach((a) => mineRows.push(row(a.text, a.ippon ? '一本！' : '出たよ', a.ippon ? 'workspace_premium' : 'check', a.ippon ? 'is-ippon' : '')));
    game.hidden.filter(my).forEach((a) => mineRows.push(row(a.text, 'ホストがかくした', 'visibility_off', 'is-hidden')));
  }
  $('mineCard').hidden = !mineRows.length;
  $('mineList').replaceChildren(...mineRows);
  $('myCard').hidden = $('answerForm').hidden && !mineRows.length;

  renderProxyBox(room, game);

  // 届いた答え（ホストにだけ）
  $('checkCard').hidden = !isHost() || !game.pending.length;
  $('checkEmpty').hidden = !isHost() || !!game.pending.length || game.closing;
  $('checkCount').textContent = game.pending.length ? game.pending.length + 'つ' : '';
  if (isHost()) {
    $('checkList').replaceChildren(...game.pending.map((a) => {
      const li = row(a.text, a.by + 'さん', 'mark_chat_unread');
      // 押し忘れても、AUTO_MS で順番待ちへ。のこりの秒は時計（startClock）が書きかえる
      const auto = makeElement('span', 'og-auto');
      auto.dataset.at = String(a.at);
      li.querySelector('.og-list__what').append(auto);
      const btns = makeElement('div', 'og-list__btn og-list__btns');
      const ok = makeElement('button', 'btn btn-primary btn-sm og-approve', 'みんなに出す');
      ok.type = 'button';
      ok.addEventListener('click', () => approveAnswer(a.id));
      const ng = makeElement('button', 'btn btn-ghost btn-sm og-reject', 'かくす');
      ng.type = 'button';
      ng.addEventListener('click', () => hideAnswer(a.id));
      btns.append(ok, ng);
      li.append(btns);
      return li;
    }));
  }

  // このあと出る答え（ホストにだけ。まずい答えをかくせるように）
  $('queueCard').hidden = !isHost() || !game.queue.length;
  if (isHost()) {
    $('queueList').replaceChildren(...game.queue.map((a) => {
      const li = row(a.text, a.by + 'さん', 'schedule');
      const b = makeElement('button', 'btn btn-ghost btn-sm og-list__btn', 'かくす');
      b.type = 'button';
      b.addEventListener('click', () => hideAnswer(a.id));
      li.append(b);
      return li;
    }));
  }

  $('shownList').replaceChildren(...(game.shown.length ? game.shown.map(shownRow) : [makeElement('li', 'og-list__empty', 'まだないよ')]));
  $('btnClose').hidden = !isHost() || game.closing;
}

// 端末のない参加者のぶん（ホストにだけ）
function renderProxyBox(room, game) {
  const px = isHost() ? proxyNames(room) : [];
  $('proxyBox').hidden = !px.length;
  if (!px.length) return;
  const c = game.cur;
  $('proxyPressList').replaceChildren(...px.map((name) => {
    const li = makeElement('li', 'og-list__item og-proxy');
    li.append(msIcon('person'), makeElement('span', 'og-list__text', name + 'さん'));
    const own = !!c && c.a.by === name;
    const pressed = !!c && !!c.presses[name];
    const b = makeElement('button', 'btn btn-sm og-list__btn og-proxy-press' + (pressed ? ' is-pressed' : ''), own ? '本人の答え' : pressed ? '押したよ' : 'おもしろい！');
    b.type = 'button';
    b.disabled = !c || c.state !== 'open' || own || pressed;
    if (c) {
      const aid = c.a.id;
      b.addEventListener('click', () => pressAnswer(aid, name));
    }
    li.append(b);
    return li;
  }));
  $('proxyPressNote').textContent = c && c.state === 'open' ? '「いま出ている答え」に、本人のかわりに投票する' : '答えが出たら、本人のかわりに押せるよ';
  // 選んでいた名前は残す
  const sel = $('proxyWho');
  const keep = sel.value;
  const ids = px.join('\n');
  if (sel.dataset.ids !== ids) {
    sel.replaceChildren(...px.map((name) => { const o = makeElement('option', '', name + 'さん'); o.value = name; return o; }));
    sel.dataset.ids = ids;
    if (px.includes(keep)) sel.value = keep;
  }
  $('proxyAnswer').hidden = game.closing;
  if ($('proxyMsg').dataset.round !== String(game.round)) {
    $('proxyMsg').textContent = '';
    $('proxyMsg').dataset.round = String(game.round);
  }
}

function renderResult(room, game) {
  showScreen('result');
  $('resultTopic').textContent = topicText(game.topic);
  const ip = game.shown.filter((a) => a.ippon);
  const others = game.shown.filter((a) => !a.ippon);
  $('resultIppon').replaceChildren(...(ip.length ? ip.map(shownRow) : [makeElement('li', 'og-list__empty', 'このお題では一本は出なかったよ')]));
  $('resultOthers').replaceChildren(...(others.length ? others.map(shownRow) : [makeElement('li', 'og-list__empty', 'ないよ')]));
  $('resultHost').hidden = !isHost();
  $('resultWait').hidden = isHost() || isWatch();
}

// 人ごとの一本の数（1本以上の人だけ。順位はつけず、参加した順に並べる）と、お題ごとの一本
function renderEnd(room, game) {
  showScreen('end');
  const count = {};
  game.history.forEach((h) => h.ippons.forEach((a) => { count[a.by] = (count[a.by] || 0) + 1; }));
  const order = everyone(room);
  Object.keys(count).forEach((name) => { if (!order.includes(name)) order.push(name); });
  const who = order.filter((name) => count[name]);
  $('endCounts').replaceChildren(...(who.length ? who.map((name) => {
    const li = makeElement('li', 'og-counts__item');
    li.append(msIcon('workspace_premium'), makeElement('span', 'og-counts__name', name), makeElement('span', 'og-counts__n', count[name] + '本'));
    return li;
  }) : [makeElement('li', 'og-list__empty', '一本は出なかったよ')]));
  $('endHistory').replaceChildren(...game.history.map((h) => {
    const sec = makeElement('section', 'og-history__item');
    sec.append(makeElement('h3', 'og-history__topic', topicText(h.topic)));
    const ul = makeElement('ul', 'og-list');
    ul.replaceChildren(...(h.ippons.length
      ? h.ippons.map((a) => row(a.text, a.by + 'さん', 'workspace_premium', 'is-ippon'))
      : [makeElement('li', 'og-list__empty', '一本はなし')]));
    sec.append(ul);
    return sec;
  }));
  $('btnRestart').hidden = !isHost();
  $('endWait').hidden = isHost() || isWatch();
}

// 一本を大きく出す（音は鳴らさない）
function renderIppon(room, game, phase) {
  const c = phase === STATUS.PLAY && game?.cur;
  const on = !!(c && c.state === 'ippon');
  const box = $('ipponPop');
  if (on) {
    $('ipponText').textContent = c.a.text;
    $('ipponName').textContent = c.a.by + 'さん';
    if (state.ipponShown !== c.a.id) {
      state.ipponShown = c.a.id;
      box.hidden = false;
      box.classList.remove('is-on');
      void box.offsetWidth;
      box.classList.add('is-on');
    }
  } else {
    box.hidden = true;
    box.classList.remove('is-on');
  }
}

// 押せる時間の帯と、時間で区切るときののこり時間（数字は秒だけ。押した数は出さない）
function startClock() {
  cancelAnimationFrame(state.rafId);
  const tick = () => {
    state.rafId = requestAnimationFrame(tick);
    const room = state.room;
    if (!room || room.status !== STATUS.PLAY) return;
    const game = gameOf(room);
    if (!game) return;
    const now = RoomkRTDB.now();
    if (ruleOf(room).cut === 'time' && !game.closing && game.roundEndsAt) {
      const sec = Math.max(0, Math.ceil((game.roundEndsAt - now) / 1000));
      $('playLeft').textContent = 'のこり ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }
    document.querySelectorAll('#checkList .og-auto').forEach((node) => {
      const sec = Math.max(0, Math.ceil((Number(node.dataset.at) + AUTO_MS - now) / 1000));
      node.textContent = '・あと' + sec + '秒で出るよ';
    });
    const c = game.cur;
    if (c && c.state === 'open') {
      const left = Math.max(0, c.endsAt - now);
      const span = Math.max(1, c.endsAt - c.at);
      $('stageBar').style.width = Math.min(100, left / span * 100).toFixed(1) + '%';
      $('stageSec').textContent = 'あと ' + Math.ceil(left / 1000) + '秒';
    } else if (c) {
      $('stageBar').style.width = '0%';
      $('stageSec').textContent = '';
    }
  };
  state.rafId = requestAnimationFrame(tick);
}

/* ── みんなにみせる画面（見るだけ。ルームに書きこまない） ── */
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
    console.warn('[hirameki-oogiri] watch failed', error);
    fail('接続できませんでした。もう一度ためしてね');
    return false;
  } finally {
    state.busy = false;
    $('btnWatchOpen').disabled = false;
  }
}

function connectWatch(code, ref) {
  state.role = 'spectator';
  // 共有するタブ・ウィンドウを選ぶときに見分けられるよう、題名と見出しを変える
  document.title = 'みんなにみせる画面 | ひらめき大喜利 | room-K';
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
    console.warn('[hirameki-oogiri] watch listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });
  startClock();
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
  cancelAnimationFrame(state.rafId);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null });
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
  document.title = DEFAULT_TITLE;
  document.body.classList.remove('is-watch', 'is-play');
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

/* ── 操作 ── */
// ルーム全体の transaction。update が undefined を返したら何もしない。committed を返す（例外は null）
async function roomTransaction(update, failMessage) {
  if (!state.roomRef || (state.role !== 'host' && state.role !== 'guest')) return null;
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || isExpired(room)) return;
      return update(room);
    });
    return result.committed;
  } catch (error) {
    console.warn('[hirameki-oogiri] action failed', error);
    if (failMessage) toast(failMessage);
    return null;
  }
}

// lock: 処理中の二度押しは何もしない（失敗の通知も出さない）。届いた答えを続けて出す操作などは lock しない
async function hostTransaction(update, failMessage, lock = true) {
  if (state.role !== 'host' || !state.roomRef) return null;
  if (!lock) {
    const uid = currentUid();
    return roomTransaction((room) => (room.hostUid === uid ? update(room) : undefined), failMessage);
  }
  if (state.busy) return null;
  state.busy = true;
  const uid = currentUid();
  try {
    return await roomTransaction((room) => (room.hostUid === uid ? update(room) : undefined), failMessage);
  } finally {
    state.busy = false;
  }
}

async function setMode(mode) {
  if (!MODES[mode] || (mode === 'none' && !isHost())) return;
  const nickname = state.nickname;
  const uid = currentUid();
  const ok = await roomTransaction((room) => {
    const me = room.players?.[nickname];
    if (!me || me.uid !== uid) return;
    const next = { ...room, players: { ...room.players, [nickname]: { ...me, mode } } };
    // 投票する人の数が変わる。いま出ている答えが一本になっていれば、ここで一本にする
    const game = gameOf(next);
    if (game && next.status === STATUS.PLAY && checkIppon(next, game, RoomkRTDB.now())) return withGame(next, game);
    return next;
  }, '切りかえられませんでした。もう一度ためしてね');
  if (ok) {
    state.mode = mode;
    saveSession();
  }
}

async function setRule(key, value) {
  const valid = { ratio: !!RATIOS[value], showSec: SHOW_SECS.includes(value), cut: !!CUTS[value], minutes: MINUTES.includes(value) };
  if (!valid[key]) return;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, rule: { ...ruleOf(room), [key]: value } };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && state.room) renderRoom(state.room);
}

async function addProxy() {
  const name = $('proxyName').value.trim();
  const error = validNickname(name);
  if (error) {
    $('proxyAddMsg').textContent = error;
    return;
  }
  $('proxyAddMsg').textContent = '';
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING && room.status !== STATUS.RESULT) { reason = 'いまは足せないよ'; return; }
    if (proxyNames(room).length >= MAX_PROXIES) { reason = MAX_PROXIES + '人まで足せるよ'; return; }
    if (name === room.host || room.players?.[name] || room.roster?.[name] || room.proxies?.[name]) { reason = '同じ名前の人がいるよ'; return; }
    return { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
  }, '足せませんでした。もう一度ためしてね', false);
  // 書き込みを待つ間に次の名前を打ち始めていたら、消さない
  if (ok) { if ($('proxyName').value.trim() === name) $('proxyName').value = ''; }
  else if (ok === false) $('proxyAddMsg').textContent = reason || '足せませんでした。もう一度ためしてね';
}

// 外すのは待合室だけ（遊んでいる途中に外すと、一本の数が消えるため）
async function removeProxy(name) {
  await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || !room.proxies?.[name]) return;
    const proxies = { ...room.proxies };
    delete proxies[name];
    return { ...room, proxies };
  }, '外せませんでした。もう一度ためしてね', false);
}

async function startGame() {
  const used = asList(state.room?.usedTopics).filter(isTopicIndex);
  const cands = drawCands(used);
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || allVoters(room).length < MIN_VOTERS) return;
    const id = (Number(room.lastGameId) || 0) + 1;
    return { ...room, status: STATUS.PICK, lastGameId: id, game: { id, round: 0, cands, history: [] } };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok === false) toast('はじめられませんでした。参加している人を確かめてね');
}

async function rerollTopics() {
  const game = gameOf(state.room);
  if (!game) return;
  const used = asList(state.room?.usedTopics).filter(isTopicIndex);
  const cands = drawCands(used, game.cands);
  await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.PICK || current?.id !== game.id) return;
    return { ...room, game: { ...room.game, cands } };
  }, '候補を変えられませんでした。もう一度ためしてね');
}

async function chooseTopic(t) {
  const game = gameOf(state.room);
  if (!game) return;
  let voters = 0;
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.PICK || current?.id !== game.id || !current.cands.includes(t)) return;
    const rule = ruleOf(room);
    const now = RoomkRTDB.now();
    voters = allVoters(room).length;
    const used = asList(room.usedTopics).filter(isTopicIndex);
    if (!used.includes(t)) used.push(t);
    return {
      ...room,
      status: STATUS.PLAY,
      usedTopics: used,
      game: {
        ...current,
        round: current.round + 1,
        topic: t,
        cands: [],
        closing: false,
        endBy: null,
        roundEndsAt: rule.cut === 'time' ? now + rule.minutes * 60 * 1000 : 0,
        gapUntil: 0,
        cur: null,
        pending: [],
        queue: [],
        shown: [],
        hidden: [],
        history: current.history.concat([{ topic: t, ippons: [] }]),
      },
    };
  }, 'お題を選べませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + voters);
  }
}

// 答えを出す。参加者の答えはホストの確認待ちへ、ホスト自身の答えと、ホストが代わりに書いた答えは順番待ちへ
async function sendAnswer(text, asName) {
  const game = gameOf(state.room);
  if (!game) return '';
  const round = game.round;
  const uid = currentUid();
  const nickname = state.nickname;
  const host = isHost();
  const aid = randomId();
  let reason = '';
  const ok = await roomTransaction((room) => {
    reason = '';
    const current = gameOf(room);
    if (room.status !== STATUS.PLAY || !current || current.round !== round) { reason = 'いまは出せないよ'; return; }
    if (current.closing) { reason = '締め切ったよ'; return; }
    let by = nickname;
    if (asName) {
      if (!host || room.hostUid !== uid || !isProxy(room, asName)) { reason = '出せなかったよ'; return; }
      by = asName;
    } else {
      const me = room.players?.[nickname];
      if (!me || me.uid !== uid) { reason = '出せなかったよ'; return; }
      if (modeOf(me) !== 'both') { reason = '「投票だけ」にしているよ'; return; }
    }
    if (waitingOf(current, by) >= MAX_WAITING) { reason = '出るのを待っている答えが' + MAX_WAITING + 'つあるよ。出るまで待ってね'; return; }
    const a = { id: aid, by, text, at: RoomkRTDB.now() };
    if (asName || (host && room.hostUid === uid)) current.queue.push(a);
    else current.pending.push(a);
    stepGame(room, current, RoomkRTDB.now());
    return withGame(room, current);
  }, '');
  if (ok) return '';
  return reason || '出せなかったよ。もう一度押してね';
}

async function submitAnswer() {
  if (state.sending) return;
  const text = cleanAnswer($('answerInput').value);
  const msg = $('answerMsg');
  if (!text) {
    msg.textContent = '答えを書いてね';
    msg.classList.add('is-error');
    return;
  }
  state.sending = true;
  $('btnAnswer').disabled = true;
  const err = await sendAnswer(text, null);
  state.sending = false;
  msg.textContent = err || (isHost() ? '出したよ。順番に出るよ' : '出したよ。ホストが確認したら（10秒ほどで）、順番に出るよ');
  msg.classList.toggle('is-error', !!err);
  if (!err && cleanAnswer($('answerInput').value) === text) $('answerInput').value = '';
  if (state.room) renderRoom(state.room);
}

async function submitProxyAnswer() {
  if (state.sending || !isHost()) return;
  const text = cleanAnswer($('proxyInput').value);
  const who = $('proxyWho').value;
  const msg = $('proxyMsg');
  let err = '';
  if (!who) err = '名前を選んでね';
  else if (!text) err = '答えを書いてね';
  else {
    state.sending = true;
    err = await sendAnswer(text, who);
    state.sending = false;
  }
  msg.textContent = err || who + 'さんの答えを出したよ。順番に出るよ';
  msg.classList.toggle('is-error', !!err);
  if (!err && cleanAnswer($('proxyInput').value) === text) $('proxyInput').value = '';
}

// 「おもしろい！」。asName は、ホストが端末のない参加者の代わりに押すとき。
// みんなが一斉に押してもぶつかりにくいよう、いま出ている答え（game/cur）だけを書きかえる。一本かどうかは時間の進み（stepGame）で見る
async function pressAnswer(aid, asName) {
  const room = state.room;
  if (!room || !state.roomRef) return;
  const uid = currentUid();
  let who = state.nickname;
  if (asName) {
    if (!isHost() || room.hostUid !== uid || !isProxy(room, asName)) return;
    who = asName;
  } else {
    const me = room.players?.[who];
    if (!me || me.uid !== uid || modeOf(me) === 'none') return;
  }
  try {
    const result = await state.roomRef.child('game/cur').transaction((cur) => {
      if (!cur || typeof cur !== 'object' || cur.a?.id !== aid || cur.state === 'ippon') return;
      if (cur.a.by === who || cur.presses?.[who] === true) return;
      // 押せる時間を過ぎたあとは受けない（締めるのを待っている間）
      if (RoomkRTDB.now() >= (Number(cur.endsAt) || 0) + 300) return;
      return { ...cur, presses: { ...(cur.presses || {}), [who]: true } };
    });
    // 押した端末が、すぐに一本かどうかを見る（ホストのタブが裏に回っていても待たせないため）
    if (result.committed) stepTick(true);
  } catch (error) {
    console.warn('[hirameki-oogiri] press failed', error);
    toast('押せませんでした。もう一度ためしてね');
  }
}

async function approveAnswer(aid) {
  await hostTransaction((room) => {
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game) return;
    const a = game.pending.find((x) => x.id === aid);
    if (!a) return;
    game.pending = game.pending.filter((x) => x.id !== aid);
    game.queue.push(a);
    stepGame(room, game, RoomkRTDB.now());
    return withGame(room, game);
  }, 'うまくいきませんでした。もう一度ためしてね', false);
}

// まずい答えが出たとき用。確認待ちの答えも、順番待ちの答えも、いま出ている答えもかくせる
async function hideAnswer(aid) {
  if (!window.confirm('この答えをかくす？（書いた人の画面にだけ「ホストがかくした」と出るよ）')) return;
  const ok = await hostTransaction((room) => {
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game) return;
    const now = RoomkRTDB.now();
    const pa = game.pending.find((a) => a.id === aid);
    const qa = game.queue.find((a) => a.id === aid);
    if (pa) {
      game.pending = game.pending.filter((a) => a.id !== aid);
      game.hidden.push(pa);
    } else if (qa) {
      game.queue = game.queue.filter((a) => a.id !== aid);
      game.hidden.push(qa);
    } else if (game.cur && game.cur.a.id === aid) {
      // 一本を出している途中でもかくせる（お題ごとの一本には入れない）
      game.hidden.push(game.cur.a);
      game.cur = null;
      game.gapUntil = now + GAP_MS;
    } else return;
    stepGame(room, game, now);
    return withGame(room, game);
  }, 'かくせませんでした。もう一度ためしてね', false);
  // 確かめている間に、出し終わっていたとき
  if (ok === false) toast('もう出し終わった答えなので、かくせなかったよ');
}

async function closeAnswers() {
  // 押した時点のお題を捕まえて、中で一致を確かめる（確認の間にほかのタブで次のお題へ進んでいたら、何もしない）
  const at = gameOf(state.room);
  if (!at) return;
  if (!window.confirm('答えを締め切る？（順番を待っている答えが出たら、結果へ進むよ）')) return;
  await hostTransaction((room) => {
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.closing || game.id !== at.id || game.round !== at.round) return;
    game.closing = true;
    game.endBy = 'host';
    stepGame(room, game, RoomkRTDB.now());
    return withGame(room, game);
  }, '締め切れませんでした。もう一度ためしてね');
}

async function nextTopic() {
  const game = gameOf(state.room);
  if (!game) return;
  const used = asList(state.room?.usedTopics).filter(isTopicIndex);
  const cands = drawCands(used);
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.RESULT || current?.id !== game.id || current.round !== game.round) return;
    return { ...room, status: STATUS.PICK, game: { ...room.game, cands } };
  }, '進めませんでした。もう一度ためしてね');
  if (ok) window.RoomkStats?.count('again');
}

async function finishGame() {
  const game = gameOf(state.room);
  if (!game) return;
  // 押した時点の画面（status とお題の番号）を捕まえて、中で一致を確かめる
  const status = state.room.status;
  // まだ出ていない答えがあれば知らせる（書いた答えが出ないまま終わる子に気づけるように）
  const unshown = status === STATUS.PLAY ? game.pending.length + game.queue.length : 0;
  const ask = unshown ? 'まだ出ていない答えが' + unshown + 'つあるよ。ここでおしまいにする？（出ていない答えは出ないまま終わるよ）' : 'ここでおしまいにする？';
  if (!window.confirm(ask)) return;
  await hostTransaction((room) => {
    const current = gameOf(room);
    if (![STATUS.PICK, STATUS.PLAY, STATUS.RESULT].includes(room.status) || current?.id !== game.id) return;
    if (room.status !== status || current.round !== game.round) return;
    // 一本を大きく出している途中なら、その一本はお題ごとの一本に入れる
    if (room.status === STATUS.PLAY && current.cur?.state === 'ippon') finishCur(current, true, RoomkRTDB.now());
    // 出ていない答えは捨てる（おしまいの画面は一本だけ）
    return { ...room, status: STATUS.END, game: { ...current, cur: null, pending: [], queue: [], cands: [] } };
  }, 'おしまいにできませんでした。もう一度ためしてね');
}

async function playAgain() {
  const game = gameOf(state.room);
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.END || gameOf(room)?.id !== game?.id) return;
    // いない人の名前は空ける（端末のない参加者は残す）
    const roster = {};
    Object.entries(room.roster || {}).forEach(([name, m]) => { if (room.players?.[name]) roster[name] = m; });
    return { ...room, status: STATUS.WAITING, game: null, roster };
  }, '戻れませんでした。もう一度ためしてね');
  if (ok) window.RoomkStats?.count('again');
}

// 時間で進むこと。ふだんはホストの端末が進め、参加者の端末は GUEST_LAG_MS 遅れていたときだけ代わりに進める
// （ホストのタブが裏に回るとタイマーが遅れるため）。force は「おもしろい！」を押した直後（一本かどうかをすぐ見る）。
// 進めることがあるときだけ書きこむ。中で同じ進みを確かめるので、だれが進めても結果は同じ
async function stepTick(force = false) {
  if ((state.role !== 'host' && state.role !== 'guest') || state.stepping || state.leaving) return;
  if (!state.roomRef || !state.room || state.room.status !== STATUS.PLAY) return;
  const lag = isHost() || force ? 0 : GUEST_LAG_MS;
  const probe = gameOf(state.room);
  if (!probe || !stepGame({ ...state.room }, probe, RoomkRTDB.now() - lag)) return;
  state.stepping = true;
  try {
    await state.roomRef.transaction((room) => {
      if (!room || isExpired(room)) return;
      const game = gameOf(room);
      if (!game || !stepGame(room, game, RoomkRTDB.now())) return;
      return withGame(room, game);
    });
  } catch (error) {
    console.warn('[hirameki-oogiri] step failed', error);
  } finally {
    state.stepping = false;
  }
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
// 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
$('btnShowQr').addEventListener('click', () => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkQR.show(state.roomCode);
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
['btnOpenWatch', 'btnWatchGuide'].forEach((id) => $(id).addEventListener('click', () => {
  if (state.role !== 'host' || !state.roomCode) return;
  // ポップアップブロックを避けるため、クリックの中で同期的に開く。noopener で元のタブと切り離す
  window.open(location.pathname + '?watch=' + state.roomCode, '_blank', 'noopener');
}));
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);

$('btnStart').addEventListener('click', startGame);
$('btnReroll').addEventListener('click', rerollTopics);
$('btnAnswer').addEventListener('click', submitAnswer);
submitOnEnter($('answerInput'), submitAnswer);
$('btnPress').addEventListener('click', () => {
  const c = gameOf(state.room)?.cur;
  if (c) pressAnswer(c.a.id, null);
});
$('btnHideCur').addEventListener('click', () => {
  const c = gameOf(state.room)?.cur;
  if (c) hideAnswer(c.a.id);
});
$('btnClose').addEventListener('click', closeAnswers);
$('btnProxyAnswer').addEventListener('click', submitProxyAnswer);
submitOnEnter($('proxyInput'), submitProxyAnswer);
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnNext').addEventListener('click', nextTopic);
['btnFinish', 'btnEnd', 'btnEndPick'].forEach((id) => $(id).addEventListener('click', finishGame));
$('btnRestart').addEventListener('click', playAgain);

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
