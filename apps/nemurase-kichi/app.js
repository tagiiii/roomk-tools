/* ねむらせ基地
   ・ルーム: Realtime Database（本体と別のプロジェクト roomk-nemurase。firebase-config.js）
   ・ゲームの状態（役・仕事・ねむった人・会議・票）は nemurase_rooms/{code}/r に置き、操作はそれぞれの端末が transaction で確かめて書く
   ・位置は nemurase_rooms/{code}/p（おきている人）と g（ねむった人）に、短い文字列で分けて置く。
     ルームの購読（r）とは別にして、位置が動くたびにルーム全体の処理が走らないようにする
   ・通信を抑える: 位置は動いている間だけ1秒に3回まで送る／止まったら最後の位置を1回／会議・結果・おしまいの間は送らない／
     おきている人は g を受け取らない／進行役・見学の人は位置を受け取らない／
     よく起きる操作（仕事の完了・投票）はゲーム全体を書き直さず、小さな場所に1つだけ書く（全員に配られる量を小さくする）
   ・練習用のロボットはホストの端末が動かす */
const E = window.NemuraseEngine;
const G = window.NemuraseGames;

const { authReady, db } = window.NemuraseFirebase.init(firebase);
const DB_PREFIX = 'nemurase_rooms';
const SESSION_KEY = 'nemurase_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play' };

const MAX_HUMANS = 20;          // ルームに入れる人（ゲームの途中から入って見学する人を含む）
const POS_MS = 333;             // 位置を送る間隔（動いている間だけ。1秒に3回まで）
const BOT_MS = 50;
const RESULT_MS = 5500;
const FIRST_COOLDOWN_S = 15;
const DARK_FIRST_S = 20;
const DARK_AGAIN_S = 40;
const LATE_MS = 3000;           // ホストの端末が遅れているとき、ほかの端末が進行を代わるまでの待ち
const LEFT_GRACE_MS = 30000;    // ゲーム中に在室が消えてから、抜けたとみなすまでの時間（読み込み直し・短い切断は抜けたことにしない）
const SKIP = '*skip';           // 投票のスキップ（名前に * は使えないので、だれの名前ともかぶらない）
const BOT_PREFIX = '*';         // ロボットの id（*1〜*9）
const BOT_NAME = /^ロボ[1-9]$/;
const TOAST_MS = 2200;

const SETTING_LABELS = {
  hostPlays: ['ホスト（あなた）', (v) => (v ? 'いっしょに遊ぶ' : '進行だけ')],
  sleepers: ['ねむらせ屋の数', (v) => (v === 2 ? '2人（7人以上のとき）' : '1人')],
  tasks: ['ひとりの仕事の数', (v) => v + 'つ'],
  cooldown: ['ねむらせてから次まで', (v) => v + '秒'],
  meeting: ['会議の時間', (v) => v + '秒'],
  buttons: ['会議ボタン（ひとり）', (v) => v + '回'],
};

const state = {
  role: null,          // 'host' | 'guest'
  nickname: null,
  roomCode: null,
  rootRef: null,       // nemurase_rooms/{code}
  roomRef: null,       // nemurase_rooms/{code}/r（ゲームの状態）
  room: null,
  joinedAt: null,
  currentScreen: null,
  timerInterval: null,
  botTimer: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceDirty: false,  // つながったが、まだ切断時の予約を張れていない（ルームの最初の値を待っている）
  presenceAt: 0,
  leaving: false,
  busy: false,
  // 位置の購読
  subP: false,
  subG: false,
  // 端末の中だけの状態
  gameId: null,        // 画面に出しているゲーム
  spawnKey: '',
  wasAsleep: false,
  taskSpot: -1,
  votePick: null,
  bannerTimer: null,
  toastTimer: null,
  lastAdvanceTry: 0,
  taskGen: 0,          // ひらいた仕事の回（閉じたあとに残ったミニゲームのタイマーで、次の仕事がおわらないように）
  awaySince: {},       // ゲーム中に在室が消えた時刻（ホストの端末だけ使う）
  dueKey: null,        // 進められる状態（会議のしめきり・結果のあとなど）を最初に見た回
  dueSince: 0,
};
const ME = { x: 22, y: 12.5, face: 1, sentAt: 0, sentText: '', moving: false, ventAt: 0 };
const VENT_GAP_MS = 1200;       // 近道を使ったあと、続けて使えるまで（行ったり来たりを1回の押しまちがいでしないように）
const PA = {};   // おきている人の位置 {id: {x, y, tx, ty, face}}（p から）
const PG = {};   // ねむった人の位置（g から。自分がねむっているときだけ受け取る）
const BOTS = {}; // ホストが動かすロボット
const KEYS = new Set();
const PAD = { x: 0, y: 0, active: false };
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.nk-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  const was = state.currentScreen;
  state.currentScreen = id;
  document.body.classList.toggle('is-playing', id === 'game');
  if (id === 'game' && was !== 'game') resizeCanvas();
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
  if (/[.#$/[\]*\u0000-\u001f\u007f]/.test(value)) return '名前に使えない文字があるよ';
  if (BOT_NAME.test(value)) return 'その名前はロボットが使うよ。少し変えてみてね';
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

function msIcon(name) {
  const node = makeElement('span', 'material-symbols-rounded', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

const objOf = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const colorOf = (key) => E.COLORS.find((c) => c.key === key) || null;
const colorHex = (key) => (colorOf(key) || { hex: '#C4D2D8' }).hex;
const isBot = (id) => typeof id === 'string' && id.startsWith(BOT_PREFIX);
const spotOf = (id) => E.SPOTS[id];
// RTDB は undefined を受け付けないので、書く前に落とす
const plain = (value) => JSON.parse(JSON.stringify(value));

function chip(colorKey) {
  const node = makeElement('span', 'nk-chip');
  node.style.background = colorHex(colorKey);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function settingsOf(room) {
  const s = { ...E.DEFAULT_SETTINGS, ...objOf(room && room.settings) };
  Object.keys(E.SETTING_OPTS).forEach((k) => {
    if (!E.SETTING_OPTS[k].includes(Number(s[k]))) s[k] = E.DEFAULT_SETTINGS[k];
    else s[k] = Number(s[k]);
  });
  return s;
}

/* ── ルームの中身を読む ── */
function humansOf(room) {
  return Object.entries(objOf(room && room.players))
    .filter(([, p]) => p && typeof p === 'object')
    .sort((a, b) => (Number(a[1].joinedAt) || 0) - (Number(b[1].joinedAt) || 0))
    .map(([name, p]) => ({ id: name, name, color: p.color || null, isHost: !!p.isHost, uid: p.uid || null }));
}

function botsOf(room) {
  return Object.entries(objOf(room && room.bots))
    .filter(([id, b]) => isBot(id) && b && typeof b === 'object')
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, b]) => ({ id, name: String(b.name || id), color: b.color || null, bot: true }));
}

// 次のゲームで遊ぶ人（進行だけのホストは入らない）
function playersOf(room) {
  const s = settingsOf(room);
  return humansOf(room).filter((p) => !p.isHost || s.hostPlays !== 0).concat(botsOf(room));
}

function freeColor(room) {
  const used = new Set(humansOf(room).map((p) => p.color).concat(botsOf(room).map((b) => b.color)));
  const c = E.COLORS.find((x) => !used.has(x.key));
  return c ? c.key : null;
}

function gameOf(room) {
  const raw = room && room.game;
  if (!raw || typeof raw !== 'object') return null;
  const players = asList(raw.players).filter((x) => typeof x === 'string');
  if (!players.length) return null;
  const tasksRaw = objOf(raw.tasks);
  const rolesRaw = objOf(raw.roles);
  const g = {
    id: Number(raw.id) || 0,
    players,
    uids: { ...objOf(raw.uids) },
    names: { ...objOf(raw.names) },
    colors: { ...objOf(raw.colors) },
    roles: {},
    tasks: {},
    buttons: {},
    asleep: {},
    left: {},
    bodies: {},
    cooldown: {},
    dark: !!raw.dark,
    darkReadyAt: Number(raw.darkReadyAt) || 0,
    spawnSeq: Number(raw.spawnSeq) || 1,
    meetingSeq: Number(raw.meetingSeq) || 0,
    endsAt: Number(raw.endsAt) || 0,
    stage: ['play', 'meeting', 'result', 'end'].includes(raw.stage) ? raw.stage : 'play',
    meeting: null,
    result: null,
    winner: ['crew', 'sleeper', 'draw'].includes(raw.winner) ? raw.winner : null,
    winReason: typeof raw.winReason === 'string' ? raw.winReason : '',
    settings: settingsOf({ settings: raw.settings }),
    ended: !!raw.ended,
  };
  const buttons = objOf(raw.buttons);
  const asleep = objOf(raw.asleep);
  const leftRaw = objOf(raw.left);
  // 仕事の完了は game/done/{id}/{場所} にゲームの番号を書く（ゲーム全体を書き直さないため）。ちがう回の印は使わない
  const doneRaw = objOf(raw.done);
  const bodies = objOf(raw.bodies);
  const cooldown = objOf(raw.cooldown);
  players.forEach((id) => {
    g.roles[id] = rolesRaw[id] === 'sleeper' ? 'sleeper' : 'crew';
    // 場所の番号がキーなので、RTDB が配列にして返すことがある（配列でもオブジェクトでも番号で引ける）
    const doneMark = doneRaw[id] && typeof doneRaw[id] === 'object' ? doneRaw[id] : {};
    g.tasks[id] = asList(tasksRaw[id])
      .map((t) => ({ spot: Number(t && t.spot), done: !!(t && t.done) }))
      .filter((t) => Number.isInteger(t.spot) && E.SPOTS[t.spot])
      .map((t) => ({ spot: t.spot, done: t.done || Number(doneMark[t.spot]) === g.id }));
    g.buttons[id] = Number(buttons[id]) || 0;
    if (asleep[id] === 'slept' || asleep[id] === 'voted') g.asleep[id] = asleep[id];
    if (leftRaw[id] === true) g.left[id] = true;
    const b = bodies[id];
    if (b && Number.isFinite(Number(b.x)) && Number.isFinite(Number(b.y))) g.bodies[id] = { x: Number(b.x), y: Number(b.y) };
    if (Number(cooldown[id])) g.cooldown[id] = Number(cooldown[id]);
  });
  if (raw.meeting && typeof raw.meeting === 'object') {
    const m = raw.meeting;
    const seq = Number(m.seq) || 0;
    const votes = {};
    // 票は game/ballots/{会議の番号}/{id} に1つずつ書く（会議の番号がちがう、遅れて届いた票は使わない）。
    // r 全体の transaction のときは meeting.votes に取りこんで書く
    // 会議の番号がキーなので、RTDB が配列にして返すことがある（配列でもオブジェクトでも番号で引ける）
    const ballotsAll = raw.ballots && typeof raw.ballots === 'object' ? raw.ballots : {};
    const ballots = objOf(ballotsAll[seq]);
    Object.entries({ ...objOf(m.votes), ...ballots }).forEach(([k, v]) => {
      const ok = (id) => players.includes(id) && !g.asleep[id] && !g.left[id];
      if (ok(k) && (v === SKIP || ok(v))) votes[k] = v;
    });
    g.meeting = {
      seq,
      why: m.why === 'button' ? 'button' : 'body',
      caller: typeof m.caller === 'string' ? m.caller : '',
      found: typeof m.found === 'string' ? m.found : null,
      endsAt: Number(m.endsAt) || 0,
      votes,
    };
  }
  if (raw.result && typeof raw.result === 'object') {
    const r = raw.result;
    const counts = {};
    Object.entries(objOf(r.counts)).forEach(([k, v]) => { if (Number(v) > 0) counts[k] = Number(v); });
    g.result = {
      counts,
      target: typeof r.target === 'string' && players.includes(r.target) ? r.target : null,
      tie: !!r.tie,
      wasSleeper: !!r.wasSleeper,
      until: Number(r.until) || 0,
    };
  }
  if (g.stage === 'meeting' && !g.meeting) g.stage = 'play';
  if (g.stage === 'result' && !g.result) g.stage = 'play';
  return g;
}

const nameIn = (g, id) => (g && g.names[id]) || id;
// このゲームで遊んでいる（途中で抜けた人は、戻ってきても次の回まで見学）
const isPlaying = (g, id) => !!g && g.players.includes(id) && !E.hasLeft(g, id);

// 抜けた人の印をつける。遊んでいる間に勝ち負けが決まったら、おしまいにする（15分を過ぎていたら時間切れを先に）
function markLeft(g, ids, now) {
  let changed = false;
  ids.forEach((id) => {
    if (g.players.includes(id) && !g.left[id]) { g.left[id] = true; changed = true; }
  });
  if (changed && g.stage === 'play') {
    if (now >= g.endsAt) timeUp(g);
    else if (E.checkWin(g)) g.stage = 'end';
  }
  return changed;
}

function isExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}

async function removeExpired(rootRef, fallback) {
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    await rootRef.transaction((root) => {
      const current = root ? root.r : fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[nemurase] expired room cleanup failed', error);
  }
}

// r がないのに p・g だけ残っていたら消す（遅れて届いた位置の書き込みで、位置だけが作りなおされたもの）
async function removeLeftovers(rootRef) {
  try {
    await rootRef.transaction((root) => (root && !root.r ? null : undefined), undefined, false);
  } catch (error) {
    console.warn('[nemurase] leftover cleanup failed', error);
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

// ゲームの名前の持ち主（匿名ID）。ゲームの間は、その名前を同じ人だけが使える
function reservedByOther(room, name, uid) {
  const g = gameOf(room);
  if (!g || room.status !== STATUS.PLAY || !g.players.includes(name)) return false;
  return !!g.uids[name] && g.uids[name] !== uid;
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
function clearPositions() {
  [PA, PG, BOTS].forEach((m) => Object.keys(m).forEach((k) => delete m[k]));
  ME.sentText = '';
}

function unsubscribePositions() {
  if (state.rootRef) {
    if (state.subP) state.rootRef.child('p').off();
    if (state.subG) state.rootRef.child('g').off();
  }
  state.subP = false;
  state.subG = false;
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearInterval(state.botTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  unsubscribePositions();
  if (state.rootRef && state.role) RoomkRTDB.cancelRoomOnDisconnect(state.rootRef);
  closeOverlays();
  Object.assign(state, {
    role: null,
    nickname: null,
    roomCode: null,
    rootRef: null,
    roomRef: null,
    room: null,
    joinedAt: null,
    timerInterval: null,
    botTimer: null,
    connectedRef: null,
    connectedCallback: null,
    roomCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    awaySince: {},
    dueKey: null,
    gameId: null,
    spawnKey: '',
    wasAsleep: false,
  });
  clearPositions();
  clearSession();
  $('hostOffOverlay').hidden = true;
  if ($('menuDialog').open) $('menuDialog').close();
  document.body.classList.remove('is-watching');
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('top');
  if (message) toast(message, isError);
}

function connectToRoom(role, nickname, code, joinedAt) {
  if (state.roomRef) cleanupRoom();
  const rootRef = db.ref(DB_PREFIX + '/' + code);
  const ref = rootRef.child('r');
  state.role = role;
  state.nickname = nickname;
  state.roomCode = code;
  state.rootRef = rootRef;
  state.roomRef = ref;
  state.joinedAt = Number(joinedAt) || RoomkRTDB.now();
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  $('btnMenuLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  saveSession();
  // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  state.roomCallback = (snap) => {
    if (state.roomRef !== ref || state.leaving) return;
    if (!snap.exists()) {
      removeLeftovers(rootRef);
      leaveLocally('ルームが閉じられたよ', false);
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      removeExpired(rootRef, room);
      leaveLocally('このルームは終わったみたい');
      return;
    }
    state.room = room;
    handleRoom(room);
  };
  ref.on('value', state.roomCallback, (error) => {
    console.warn('[nemurase] room listener failed', error);
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
  if (role === 'host') state.botTimer = setInterval(botLoop, BOT_MS);
}

function tickRoom() {
  const room = state.room;
  if (!room) return;
  if (needsPresence(room)) ensurePresence();
  if (room.status === STATUS.PLAY) {
    tryAdvance(room);
    if (state.role === 'host') {
      botsVote(room);
      watchLeavers(room);
    }
  }
}

// ゲーム中に在室が消えたまま LEFT_GRACE_MS たった人（タブを閉じた人）を、抜けた人にする（ホストの端末が見る）
function watchLeavers(room) {
  const g = gameOf(room);
  if (!g || g.stage === 'end') { state.awaySince = {}; return; }
  const now = Date.now();
  const gone = [];
  g.players.forEach((id) => {
    if (isBot(id) || id === state.nickname || g.left[id]) { delete state.awaySince[id]; return; }
    if (room.players?.[id]) { delete state.awaySince[id]; return; }
    if (!state.awaySince[id]) state.awaySince[id] = now;
    else if (now - state.awaySince[id] >= LEFT_GRACE_MS) gone.push(id);
  });
  if (gone.length) {
    gone.forEach((id) => { delete state.awaySince[id]; });
    gameAct(mut.left(gone));
  }
}

// 接続中なのに、ルームの上では切断・不在になっている
function needsPresence(room) {
  if (state.role === 'host') return room.hostConnected === false;
  if (state.role === 'guest') return !room.players?.[state.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる
async function ensurePresence(force = false) {
  const ref = state.roomRef;
  const rootRef = state.rootRef;
  if (!ref || state.leaving || !state.isConnected || !state.room) return;
  if (!force && Date.now() - state.presenceAt < PRESENCE_RETRY_MS) return;
  state.presenceDirty = false;
  state.presenceAt = Date.now();
  const role = state.role;
  const nickname = state.nickname;
  const joinedAt = state.joinedAt;
  const uid = currentUid();
  try {
    // 自分の位置は、切れたら消す（おきている人の画面に止まったまま残さない）
    await rootRef.child('p/' + nickname).onDisconnect().remove();
    await rootRef.child('g/' + nickname).onDisconnect().remove();
    // 切れていた間に位置が消されているので、止まったままでも送り直す（次のフレームで送る）
    ME.sentText = '';
    Object.values(BOTS).forEach((b) => { b.sentText = ''; });
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
      let taken = false;
      await ref.transaction((room) => {
        full = false;
        taken = false;
        if (!room || isExpired(room)) return;
        const present = room.players?.[nickname];
        if (present) {
          // 同じ名前の在室が別の人（別の匿名ID）のものなら、張った切断予約を取り消して外れる
          if (present.uid !== uid) taken = true;
          return;
        }
        if (nickname === room.host || botsOf(room).some((b) => b.name === nickname) || reservedByOther(room, nickname, uid)) {
          taken = true;
          return;
        }
        const g = gameOf(room);
        const inGame = room.status === STATUS.PLAY && g && g.players.includes(nickname);
        if (!inGame && humansOf(room).length >= MAX_HUMANS) {
          full = true;
          return;
        }
        const color = inGame ? (g.colors[nickname] || null) : freeColor(room);
        return {
          ...room,
          players: { ...(room.players || {}), [nickname]: { isHost: false, uid, joinedAt, color } },
        };
      });
      if ((full || taken) && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(rootRef);
        leaveLocally(full ? 'このルームはいっぱいだよ' : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
      }
    }
  } catch (error) {
    console.warn('[nemurase] presence recovery failed', error);
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
      const ref = db.ref(DB_PREFIX + '/' + code + '/r');
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
          settings: { ...E.DEFAULT_SETTINGS },
          players: { [nickname]: { isHost: true, uid, joinedAt, color: E.COLORS[0].key } },
        };
      });
      if (result.committed) {
        window.RoomkStats?.count('room-create');
        connectToRoom('host', nickname, code, joinedAt);
        return;
      }
    }
    setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
  } catch (err) {
    console.warn('[nemurase] create failed', err);
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
    const rootRef = db.ref(DB_PREFIX + '/' + code);
    const ref = rootRef.child('r');
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const initial = warm.snap.val();
    if (!initial) {
      setError('joinError', 'ルームが見つからないよ。コードを確かめてね');
      return;
    }
    if (isExpired(initial)) {
      await removeExpired(rootRef, initial);
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
      // 自分の在室が残っていたら（タブが落ちた直後・送信後の切断のやり直し）入りなおしとして上書きする
      const stale = room.players?.[nickname];
      const mine = !!stale && !stale.isHost && stale.uid === uid;
      if (nickname === room.host || botsOf(room).some((b) => b.name === nickname) || (stale && !mine) || reservedByOther(room, nickname, uid)) {
        reason = '名前';
        return;
      }
      const g = gameOf(room);
      const inGame = room.status === STATUS.PLAY && g && g.players.includes(nickname);
      if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
      else if (!inGame) {
        if (humansOf(room).length >= MAX_HUMANS) { reason = '満員'; return; }
        // 待合室では、遊ぶ人が10人（ロボットを含む）までになるようにする
        if (room.status === STATUS.WAITING && playersOf(room).length >= E.MAX_PLAYERS) { reason = '満員'; return; }
      }
      const color = inGame ? (g.colors[nickname] || null) : (mine && stale.color) || freeColor(room);
      return {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt, color },
        },
      };
    });
    if (!result.committed) {
      const messages = {
        '見つからない': 'ルームが見つからないよ。コードを確かめてね',
        '終了': 'このルームは終わったみたい',
        '名前': 'その名前は使われているよ。少し変えてみてね',
        '満員': 'このルームはいっぱいだよ（遊ぶ人は10人まで）',
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[nemurase] join failed', err);
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
  const tops = ['btnGoCreate', 'btnGoJoin'];
  tops.forEach((id) => { $(id).disabled = true; });
  let release = null;
  try {
    if (!await waitAuth()) return false;
    const uid = currentUid();
    if (!uid || uid !== saved.uid) return false;
    const rootRef = db.ref(DB_PREFIX + '/' + saved.roomCode);
    const ref = rootRef.child('r');
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const room = warm.snap.val();
    if (!room) return false;
    if (isExpired(room)) {
      await removeExpired(rootRef, room);
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
    connectToRoom(saved.role, saved.nickname, saved.roomCode, joinedAt);
    return true;
  } catch (error) {
    console.warn('[nemurase] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    tops.forEach((id) => { $(id).disabled = false; });
  }
}

async function leaveRoom() {
  if (state.busy || !state.roomRef) return;
  const rootRef = state.rootRef;
  const ref = state.roomRef;
  const role = state.role;
  const nickname = state.nickname;
  const uid = currentUid();
  if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
  state.busy = true;
  state.leaving = true;
  // ロボットと位置の送信を先に止める（消したあとに位置だけが書かれて残らないように）
  clearInterval(state.botTimer);
  state.botTimer = null;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(rootRef);
    if (role === 'host') {
      await rootRef.remove();
      await removeLeftovers(rootRef);
    } else {
      let endedHere = false;
      const result = await ref.transaction((room) => {
        endedHere = false;
        if (!room) return;
        const mine = room.players?.[nickname];
        if (!mine || mine.uid !== uid) return;
        const players = { ...(room.players || {}) };
        delete players[nickname];
        const next = { ...room, players };
        // ゲームの途中で退出したら、抜けた人として勝ち負けの判定と、のこりの仕事の数から外す
        const g = room.status === STATUS.PLAY ? gameOf(room) : null;
        if (g && g.uids[nickname] === uid && markLeft(g, [nickname], RoomkRTDB.now())) {
          if (g.stage === 'end' && !g.ended) { g.ended = true; endedHere = true; }
          next.game = plain(g);
        }
        return next;
      });
      if (result.committed && endedHere) window.RoomkStats?.count('finish');
      await rootRef.child('p/' + nickname).remove();
      await rootRef.child('g/' + nickname).remove();
    }
  } catch (error) {
    console.warn('[nemurase] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.leaving = false;
    state.busy = false;
    if (role === 'host') state.botTimer = setInterval(botLoop, BOT_MS);
    ensurePresence(true);
    if (state.room) handleRoom(state.room);
    return;
  }
  state.busy = false;
  leaveLocally('');
}

/* ── ホストの操作（待合室） ── */
async function hostTransaction(update, failMessage) {
  if (state.role !== 'host' || !state.roomRef) return false;
  const uid = currentUid();
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      return update(room);
    });
    if (!result.committed && failMessage) toast(failMessage);
    return result.committed;
  } catch (error) {
    console.warn('[nemurase] host action failed', error);
    toast('うまく送れませんでした。もう一度ためしてね');
    return false;
  }
}

function setSetting(key, value) {
  const v = Number(value);
  if (!E.SETTING_OPTS[key] || !E.SETTING_OPTS[key].includes(v)) return;
  hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, settings: { ...settingsOf(room), [key]: v } };
  });
}

function addBot() {
  hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || playersOf(room).length >= E.MAX_PLAYERS) return;
    const bots = objOf(room.bots);
    let n = 1;
    while (bots[BOT_PREFIX + n] && n < 10) n++;
    if (n > 9) return;
    const name = 'ロボ' + n;
    if (room.players?.[name]) return;
    return { ...room, bots: { ...bots, [BOT_PREFIX + n]: { name, color: freeColor(room) } } };
  }, 'これ以上は入れられないよ（遊ぶ人は10人まで）');
}

function removeBot() {
  hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const list = botsOf(room);
    if (!list.length) return;
    const bots = { ...objOf(room.bots) };
    delete bots[list[list.length - 1].id];
    return { ...room, bots };
  });
}

async function startGame() {
  const room = state.room;
  if (!room || room.status !== STATUS.WAITING) return;
  const n = playersOf(room).length;
  if (n < E.MIN_PLAYERS || n > E.MAX_PLAYERS) return;
  $('btnStart').disabled = true;
  // 前の回の位置を消してからはじめる（待合室では、だれも位置を書かない）
  try {
    await state.rootRef.child('p').remove();
    await state.rootRef.child('g').remove();
  } catch (error) {
    console.warn('[nemurase] position cleanup failed', error);
  }
  let count = 0;
  const ok = await hostTransaction((current) => {
    if (current.status !== STATUS.WAITING) return;
    const list = playersOf(current);
    if (list.length < E.MIN_PLAYERS || list.length > E.MAX_PLAYERS) return;
    const now = RoomkRTDB.now();
    const settings = settingsOf(current);
    const base = E.newGame(list.map((p) => p.id), settings);
    const g = {
      ...base,
      id: (Number(current.lastGameId) || 0) + 1,
      uids: {},
      names: {},
      colors: {},
      bodies: {},
      stage: 'play',
      endsAt: now + E.GAME_LIMIT_S * 1000,
      darkReadyAt: now + DARK_FIRST_S * 1000,
      ended: false,
    };
    list.forEach((p) => {
      g.names[p.id] = p.name;
      g.colors[p.id] = p.color || freeColor(current) || 'white';
      if (!p.bot) g.uids[p.id] = p.uid;
      if (g.roles[p.id] === 'sleeper') g.cooldown[p.id] = now + FIRST_COOLDOWN_S * 1000;
    });
    count = list.length;
    return { ...current, status: STATUS.PLAY, lastGameId: g.id, game: plain(g) };
  }, 'はじめられませんでした。もう一度ためしてね');
  $('btnStart').disabled = false;
  if (ok) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + count);
  }
}

async function backToLobby(fromEnd) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.PLAY) return;
    const g = gameOf(room);
    if (fromEnd && (!g || g.stage !== 'end')) return;
    return { ...room, status: STATUS.WAITING, game: null };
  });
  if (!ok) return;
  if (fromEnd) window.RoomkStats?.count('again');
  try {
    await state.rootRef.child('p').remove();
    await state.rootRef.child('g').remove();
  } catch (error) {
    console.warn('[nemurase] position cleanup failed', error);
  }
}

/* ── ゲームの操作（どの端末も transaction で確かめて書く） ── */
async function gameAct(mutate) {
  const ref = state.roomRef;
  if (!ref) return false;
  let endedHere = false;
  try {
    const result = await ref.transaction((room) => {
      endedHere = false;
      if (!room || room.status !== STATUS.PLAY || isExpired(room)) return;
      const g = gameOf(room);
      if (!g) return;
      if (!mutate(g, RoomkRTDB.now(), room)) return;
      if (g.stage === 'end' && !g.ended) {
        g.ended = true;
        endedHere = true;
      }
      return { ...room, game: plain(g) };
    });
    if (result.committed && endedHere) window.RoomkStats?.count('finish');
    return result.committed;
  } catch (error) {
    console.warn('[nemurase] game action failed', error);
    return false;
  }
}

function startMeeting(g, now, why, caller, found) {
  g.stage = 'meeting';
  g.meetingSeq += 1;
  g.meeting = { seq: g.meetingSeq, why, caller, found: found || null, endsAt: now + g.settings.meeting * 1000, votes: {} };
  g.bodies = {};
  g.dark = false;
}

// 投票できる人（おきていて、ルームにいる人。ロボットはいつもいる）がみんな入れたか
function everyoneVoted(g, room) {
  return E.awakeOf(g).every((id) => g.meeting.votes[id] || (!isBot(id) && !room.players?.[id]));
}

function endMeeting(g, now) {
  const t = E.tally(g.meeting.votes, SKIP);
  if (t.target) g.asleep[t.target] = 'voted';
  g.result = { counts: t.counts, target: t.target, tie: t.tie, wasSleeper: t.target ? g.roles[t.target] === 'sleeper' : false, until: now + RESULT_MS };
  g.meeting = null;
  E.checkWin(g);
  g.stage = 'result';
}

function timeUp(g) {
  g.winner = 'draw';
  g.winReason = 'timeup';
  g.stage = 'end';
}

const mut = {
  sleep: (actor, target, at) => (g, now) => {
    if (g.stage !== 'play' || g.roles[actor] !== 'sleeper' || (E.hasLeft(g, actor) || !E.isAwake(g, actor))) return false;
    if ((g.cooldown[actor] || 0) > now) return false;
    if (!E.awakeOf(g, 'crew').includes(target)) return false;
    g.asleep[target] = 'slept';
    g.bodies[target] = { x: Math.round(at.x * 10) / 10, y: Math.round(at.y * 10) / 10 };
    g.cooldown[actor] = now + g.settings.cooldown * 1000;
    if (E.checkWin(g)) g.stage = 'end';
    return true;
  },
  find: (actor, body) => (g, now) => {
    if (g.stage !== 'play' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || !g.bodies[body]) return false;
    startMeeting(g, now, 'body', actor, body);
    return true;
  },
  button: (actor) => (g, now) => {
    if (g.stage !== 'play' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || (g.buttons[actor] || 0) <= 0) return false;
    g.buttons[actor] -= 1;
    startMeeting(g, now, 'button', actor, null);
    return true;
  },
  dark: (actor) => (g, now) => {
    if (g.stage !== 'play' || g.roles[actor] !== 'sleeper' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || g.dark || g.darkReadyAt > now) return false;
    g.dark = true;
    return true;
  },
  fix: (actor) => (g, now) => {
    if (g.stage !== 'play' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || !g.dark) return false;
    g.dark = false;
    g.darkReadyAt = now + DARK_AGAIN_S * 1000;
    return true;
  },
  left: (ids) => (g, now) => markLeft(g, ids, now),
  closeVote: () => (g, now) => {
    if (g.stage !== 'meeting') return false;
    endMeeting(g, now);
    return true;
  },
  // 時間で進むところ（会議のしめきり・結果のあと・15分の時間切れ）。late はホスト以外の端末が代わるときの待ち
  advance: (late) => (g, now, room) => {
    if (g.stage === 'meeting' && (now >= g.meeting.endsAt + late || everyoneVoted(g, room))) {
      endMeeting(g, now);
      return true;
    }
    if (g.stage === 'result' && now >= g.result.until + late) {
      // 結果を出している間に抜けた人がいれば変わるので、ここで勝ち負けを確かめなおす。
      // 会議の結果で勝ち負けが決まっていれば、15分を過ぎていてもそちらを優先する
      g.winner = null;
      g.winReason = '';
      if (E.checkWin(g)) g.stage = 'end';
      else if (now >= g.endsAt) timeUp(g);
      else {
        g.stage = 'play';
        g.result = null;
        g.spawnSeq += 1;
        g.players.forEach((id) => { if (g.roles[id] === 'sleeper') g.cooldown[id] = now + g.settings.cooldown * 1000; });
        g.darkReadyAt = now + DARK_FIRST_S * 1000;
      }
      return true;
    }
    // 仕事の完了は小さな印で書くので、ぜんぶおわったかはここで確かめる
    if (g.stage === 'play' && E.checkWin(g)) {
      g.stage = 'end';
      return true;
    }
    if (g.stage === 'play' && now >= g.endsAt + late) {
      timeUp(g);
      return true;
    }
    return false;
  },
};

// 仕事の完了: 自分の印を1つ書くだけ（全員に配られる量を小さくする）。ぜんぶおわったら勝ちの判定へ
async function doTask(actor, spot) {
  const g = gameOf(state.room);
  if (!g || g.stage !== 'play' || g.roles[actor] !== 'crew' || E.hasLeft(g, actor)) return false;
  const t = (g.tasks[actor] || []).find((x) => x.spot === spot && !x.done);
  if (!t) return false;
  try {
    await state.roomRef.child('game/done/' + actor + '/' + spot).set(g.id);
  } catch (error) {
    console.warn('[nemurase] task send failed', error);
    return false;
  }
  t.done = true;
  // ぜんぶおわったときの勝ちの判定はホストが進める（ホスト以外は tryAdvance が3秒待ってから代わる）
  if (state.role === 'host' && E.taskProgress(g).done >= E.taskProgress(g).total) gameAct(mut.advance(0));
  return true;
}

// 投票: 自分の票の欄だけに書く（まだ入れていないときだけ）。みんな入れたら結果へ
async function doVote(actor, target) {
  const room = state.room;
  const g = gameOf(room);
  if (!g || g.stage !== 'meeting' || !E.awakeOf(g).includes(actor) || g.meeting.votes[actor]) return false;
  if (target !== SKIP && !E.awakeOf(g).includes(target)) return false;
  try {
    const result = await state.roomRef.child('game/ballots/' + g.meeting.seq + '/' + actor).transaction((cur) => (cur ? undefined : target));
    if (!result.committed) return false;
  } catch (error) {
    console.warn('[nemurase] vote failed', error);
    return false;
  }
  g.meeting.votes[actor] = target;
  if (state.role === 'host' && everyoneVoted(g, room)) gameAct(mut.advance(0));
  return true;
}

// 時間で進むところは、ホストの端末が進める。ホストのタブが裏にあって遅れたら、ほかの端末が3秒あとに代わる
function tryAdvance(room) {
  const g = gameOf(room);
  if (!g || g.stage === 'end') return;
  const host = state.role === 'host';
  if (!host && room.hostConnected === false) return;
  const now = RoomkRTDB.now();
  const due = (g.stage === 'meeting' && (now >= g.meeting.endsAt || everyoneVoted(g, room)))
    || (g.stage === 'result' && now >= g.result.until)
    || (g.stage === 'play' && (now >= g.endsAt || E.checkWin(g)));
  if (!due) { state.dueKey = null; return; }
  // ホスト以外は、進められる状態になってから3秒たってもホストが進めないときだけ代わる
  const key = g.id + ':' + g.stage + ':' + g.spawnSeq + ':' + g.meetingSeq;
  if (state.dueKey !== key) { state.dueKey = key; state.dueSince = Date.now(); }
  if (!host && Date.now() - state.dueSince < LATE_MS) return;
  if (Date.now() - state.lastAdvanceTry < 900) return;
  state.lastAdvanceTry = Date.now();
  gameAct(mut.advance(0));
}

/* ── 練習用のロボット（ホストの端末だけで動く） ── */
function resetBots(g) {
  Object.keys(BOTS).forEach((k) => delete BOTS[k]);
  if (!g) return;
  g.players.forEach((id, i) => {
    if (!isBot(id)) return;
    const sp = E.spawnPoint(i, g.players.length);
    BOTS[id] = { id, x: sp.x, y: sp.y, face: 1, route: [], goal: null, waitUntil: Date.now() + 1500 + Math.random() * 2000, voteAt: 0, sentAt: 0, sentText: '', findAt: 0, busyUntil: 0 };
  });
}

function botsVote(room) {
  const g = gameOf(room);
  if (!g || g.stage !== 'meeting') {
    Object.values(BOTS).forEach((b) => { b.voteAt = 0; });
    return;
  }
  const now = Date.now();
  Object.values(BOTS).forEach((b) => {
    if (!E.isAwake(g, b.id) || g.meeting.votes[b.id]) return;
    if (!b.voteAt) { b.voteAt = now + 4000 + Math.random() * 8000; return; }
    if (now < b.voteAt) return;
    b.voteAt = 0;
    const others = E.awakeOf(g).filter((id) => id !== b.id && !(g.roles[b.id] === 'sleeper' && g.roles[id] === 'sleeper'));
    const target = Math.random() < 0.5 || !others.length ? SKIP : others[Math.floor(Math.random() * others.length)];
    doVote(b.id, target);
  });
}

function routeTo(b, x, y) {
  const r = E.path({ x: Math.floor(b.x), y: Math.floor(b.y) }, { x: Math.floor(x), y: Math.floor(y) });
  b.route = r ? r.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })) : [];
  if (b.route.length) b.route[b.route.length - 1] = { x, y };
}

function firstCrewBot(g) {
  return Object.keys(BOTS).find((id) => E.isAwake(g, id) && g.roles[id] === 'crew');
}

// ホストが知っている、その人の位置（ロボットはその場の位置）
function knownPos(id) {
  if (id === state.nickname) return ME;
  if (BOTS[id]) return BOTS[id];
  return PA[id] ? { x: PA[id].tx, y: PA[id].ty } : null;
}

function botStep(g, b, dt, now) {
  const awake = E.isAwake(g, b.id);
  const role = g.roles[b.id];
  if (now < b.busyUntil) return;
  // おきているロボット: ねむっている人が近くにいたら知らせる
  if (awake) {
    const body = Object.keys(g.bodies).find((id) => E.dist(g.bodies[id], b) <= E.FIND_RANGE && E.canSee(b, g.bodies[id]));
    if (body) {
      if (!b.findAt) b.findAt = now + 700;
      else if (now >= b.findAt) { b.findAt = 0; b.busyUntil = now + 1500; gameAct(mut.find(b.id, body)); return; }
    }
  }
  // ねむらせ屋: ほかに見ている人がいなければ、近くの隊員をねむらせる
  if (role === 'sleeper' && awake && (g.cooldown[b.id] || 0) <= RoomkRTDB.now()) {
    const crew = E.awakeOf(g, 'crew');
    const near = crew.filter((id) => { const p = knownPos(id); return p && E.dist(p, b) <= E.SLEEP_RANGE && E.canSee(b, p); });
    const watchers = crew.filter((id) => { const p = knownPos(id); return p && E.dist(p, b) <= 5 && E.canSee(p, b); });
    if (near.length === 1 && watchers.length === 1) {
      const at = knownPos(near[0]);
      b.busyUntil = now + 1500;
      gameAct(mut.sleep(b.id, near[0], { x: at.x, y: at.y }));
      return;
    }
  }
  if (now < b.waitUntil) return;
  if (!b.goal) {
    if (g.dark && awake && role === 'crew' && firstCrewBot(g) === b.id) {
      b.goal = { kind: 'fix' };
      routeTo(b, E.FIX_SPOT.x, E.FIX_SPOT.y + 0.6);
    } else {
      const todo = role === 'crew' ? g.tasks[b.id].filter((t) => !t.done) : [];
      const sp = todo.length ? spotOf(todo[0].spot) : E.SPOTS[Math.floor(Math.random() * E.SPOTS.length)];
      b.goal = todo.length ? { kind: 'task', spot: todo[0].spot } : { kind: 'walk' };
      routeTo(b, sp.x, sp.y + 0.6);
    }
  }
  if (b.route.length) {
    const w = b.route[0];
    const dx = w.x - b.x;
    const dy = w.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.12) { b.route.shift(); return; }
    const n = E.step(b, dx / d, dy / d, Math.min(dt, d / E.SPEED));
    if (Math.abs(dx) > 0.01) b.face = dx > 0 ? 1 : -1;
    if (n.x === b.x && n.y === b.y) { b.x = w.x; b.y = w.y; b.route.shift(); return; }
    b.x = n.x;
    b.y = n.y;
    return;
  }
  const goal = b.goal;
  b.goal = null;
  b.waitUntil = now + 2500 + Math.random() * 2500;
  if (goal.kind === 'task') {
    b.busyUntil = now + 2400;
    setTimeout(() => {
      const current = gameOf(state.room);
      if (current && current.id === g.id && current.stage === 'play') doTask(b.id, goal.spot);
    }, 2400);
  } else if (goal.kind === 'fix') {
    gameAct(mut.fix(b.id));
  }
}

let lastBotStep = Date.now();
function botLoop() {
  const now = Date.now();
  const dt = Math.min(1, (now - lastBotStep) / 1000);
  lastBotStep = now;
  const room = state.room;
  if (state.role !== 'host' || !room || room.status !== STATUS.PLAY) return;
  const g = gameOf(room);
  if (!g || g.stage !== 'play') return;
  // 裏のタブではタイマーが1秒おきになるので、細かく分けて進める
  for (let left = dt; left > 0; left -= 0.05) {
    Object.values(BOTS).forEach((b) => botStep(g, b, Math.min(0.05, left), now));
  }
  Object.values(BOTS).forEach((b) => sendPosFor(b.id, b, E.isAwake(g, b.id), false));
}

/* ── 位置を送る・受け取る ── */
// who の位置 pos を送る。動いている間は POS_MS おき、止まったら最後の1回、force はすぐ
function sendPosFor(id, pos, awake, force) {
  // 切れている間は送らない（SDK が書き込みをためて、ルームが消えたあとに位置だけを作りなおさないように）
  if (!state.rootRef || !state.isConnected || state.leaving) return;
  const text = E.encodePos(pos.x, pos.y, pos.face || 1);
  if (text === pos.sentText && !force) return;
  const now = Date.now();
  if (!force && now - (pos.sentAt || 0) < POS_MS) return;
  pos.sentAt = now;
  pos.sentText = text;
  state.rootRef.child((awake ? 'p/' : 'g/') + id).set(text).catch((error) => console.warn('[nemurase] position send failed', error));
}

function takePos(map, id, text) {
  if (id === state.nickname || BOTS[id]) return;
  const p = E.decodePos(text);
  if (!p) { delete map[id]; return; }
  const cur = map[id];
  if (!cur || Math.hypot(cur.tx - p.x, cur.ty - p.y) > 3) map[id] = { x: p.x, y: p.y, tx: p.x, ty: p.y, face: p.face };
  else { cur.tx = p.x; cur.ty = p.y; cur.face = p.face; }
}

function subscribeChannel(key, map) {
  const ref = state.rootRef.child(key);
  ref.on('child_added', (snap) => takePos(map, snap.key, snap.val()));
  ref.on('child_changed', (snap) => takePos(map, snap.key, snap.val()));
  ref.on('child_removed', (snap) => { delete map[snap.key]; });
}

// 遊んでいる人だけが位置を受け取る。ねむった人だけが g（ねむった人の位置）を受け取る。
// ロボットのいるホストは、ロボットのねむらせ屋が隊員の位置を知るために p を受け取る（進行だけでも画面には出さない）
function updateSubscriptions(room) {
  const g = room.status === STATUS.PLAY ? gameOf(room) : null;
  const playing = isPlaying(g, state.nickname);
  const wantP = !!g && (playing || (state.role === 'host' && g.players.some(isBot)));
  const wantG = playing && !E.isAwake(g, state.nickname);
  if (wantP && !state.subP) { subscribeChannel('p', PA); state.subP = true; }
  if (!wantP && state.subP) { state.rootRef.child('p').off(); state.subP = false; Object.keys(PA).forEach((k) => delete PA[k]); }
  if (wantG && !state.subG) { subscribeChannel('g', PG); state.subG = true; }
  if (!wantG && state.subG) { state.rootRef.child('g').off(); state.subG = false; Object.keys(PG).forEach((k) => delete PG[k]); }
}

/* ── 画面 ── */
function handleRoom(room) {
  // つながった時点でルームの値がまだなかったときは、最初の値が届いたここで切断時の予約を張る
  if (state.presenceDirty) ensurePresence(true);
  updateHostOverlay(room);
  updateSubscriptions(room);
  if (room.status === STATUS.PLAY && gameOf(room)) {
    showScreen('game');
    renderGame(room);
  } else {
    if (state.gameId != null) {
      state.gameId = null;
      clearPositions();
      closeOverlays();
      if ($('menuDialog').open) $('menuDialog').close();
    }
    showScreen('waiting');
    renderWaiting(room);
  }
}

function updateHostOverlay(room) {
  const show = state.role === 'guest' && room.hostConnected === false;
  $('hostOffOverlay').hidden = !show;
}

function renderWaiting(room) {
  const host = state.role === 'host';
  const s = settingsOf(room);
  $('codeButtons').hidden = !host;
  $('guestWaitNote').hidden = host;
  $('botButtons').hidden = !host;
  $('btnStart').hidden = !host;
  const list = $('lobbyPeople');
  list.replaceChildren();
  humansOf(room).concat(botsOf(room)).forEach((p) => {
    const li = makeElement('li', 'nk-person');
    li.append(chip(p.color), makeElement('span', 'nk-person__name', p.name));
    if (p.isHost) li.appendChild(makeElement('span', 'nk-tag', s.hostPlays === 0 ? 'ホスト・進行役' : 'ホスト'));
    if (p.id === state.nickname) li.appendChild(makeElement('span', 'nk-tag nk-tag--me', 'あなた'));
    if (p.bot) li.appendChild(makeElement('span', 'nk-tag', 'ロボット'));
    list.appendChild(li);
  });
  const n = playersOf(room).length;
  $('playerCount').textContent = n + '人';
  $('btnAddBot').disabled = n >= E.MAX_PLAYERS || botsOf(room).length >= 9;
  $('btnRemoveBot').disabled = !botsOf(room).length;

  const box = $('lobbySettings');
  const key = JSON.stringify(s) + host;
  if (box._key !== key) {
    box._key = key;
    box.replaceChildren();
    Object.keys(SETTING_LABELS).forEach((k) => {
      if (k === 'hostPlays' && !host) return;
      const [label, fmt] = SETTING_LABELS[k];
      const row = makeElement('div', 'nk-setting');
      const id = 'set-' + k;
      const lab = makeElement('label', 'nk-setting__label', label);
      lab.htmlFor = id;
      row.appendChild(lab);
      if (host) {
        const sel = makeElement('select', 'form-input nk-setting__select');
        sel.id = id;
        E.SETTING_OPTS[k].forEach((v) => {
          const o = makeElement('option', null, fmt(v));
          o.value = String(v);
          if (s[k] === v) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => setSetting(k, sel.value));
        row.appendChild(sel);
      } else {
        const v = makeElement('span', 'nk-setting__value', fmt(s[k]));
        v.id = id;
        row.appendChild(v);
      }
      box.appendChild(row);
    });
  }

  let note = '';
  if (n < E.MIN_PLAYERS) note = 'あと ' + (E.MIN_PLAYERS - n) + ' 人でスタートできます' + (host ? '（練習用のロボットでもいい）' : '');
  else if (n > E.MAX_PLAYERS) note = '遊ぶ人は10人までです';
  else if (s.sleepers === 2 && n < E.TWO_SLEEPERS_MIN) note = '7人より少ないので、ねむらせ屋は1人になります';
  $('lobbyNote').textContent = note;
  $('btnStart').disabled = n < E.MIN_PLAYERS || n > E.MAX_PLAYERS;
}

function closeOverlays() {
  ['ovRole', 'ovTask', 'ovMeeting', 'ovResult', 'ovEnd'].forEach((id) => { $(id).hidden = true; });
  state.taskSpot = -1;
  state.votePick = null;
  $('taskBox').replaceChildren();
}

function banner(text, ms) {
  const b = $('stageBanner');
  b.textContent = text;
  b.hidden = false;
  clearTimeout(state.bannerTimer);
  state.bannerTimer = setTimeout(() => { b.hidden = true; }, ms || 3500);
}

function smallToast(text) {
  toast(text, false);
}

function renderGame(room) {
  const g = gameOf(room);
  // 新しい回
  if (state.gameId !== g.id) {
    state.gameId = g.id;
    state.spawnKey = '';
    state.wasAsleep = false;
    state.votePick = null;
    clearPositions();
    closeOverlays();
    if (state.role === 'host') resetBots(g);
    if (isPlaying(g, state.nickname) && g.stage === 'play') showRole(g);
    // せまい画面では、やることの一覧をたたんでおく（マップの「!」でも場所がわかる）
    const narrow = window.matchMedia('(max-width: 760px)').matches;
    $('taskList').classList.toggle('is-closed', narrow);
    $('btnTasks').setAttribute('aria-expanded', String(!narrow));
  }
  const playing = isPlaying(g, state.nickname);
  document.body.classList.toggle('is-watching', !playing);
  // テーブルのまわりへもどる（はじめ・会議のあと）
  const sk = g.id + ':' + g.spawnSeq;
  if (state.spawnKey !== sk) {
    state.spawnKey = sk;
    if (state.role === 'host') resetBotsPosition(g);
    if (playing) {
      const sp = E.spawnPoint(g.players.indexOf(state.nickname), g.players.length);
      ME.x = sp.x;
      ME.y = sp.y;
      if (g.stage === 'play') sendPosFor(state.nickname, ME, E.isAwake(g, state.nickname), true);
    }
  }
  const asleep = playing && !E.isAwake(g, state.nickname);
  if (playing && asleep && !state.wasAsleep) {
    state.wasAsleep = true;
    // おきている人の画面に残らないよう、p の位置を消して、ここからは g に送る
    state.rootRef.child('p/' + state.nickname).remove().catch(() => {});
    sendPosFor(state.nickname, ME, false, true);
    if (g.stage === 'play') {
      banner(g.roles[state.nickname] === 'crew' ? 'ねむってしまった… でも、仕事はつづけられるよ。おきている人には見えないよ' : 'ねむってしまった。あとはみんなの様子を見ていてね', 6000);
    }
  }
  if (state.role === 'host') {
    // ねむったロボットの位置も、p から g へ移す
    Object.values(BOTS).forEach((b) => {
      if (!E.isAwake(g, b.id) && !b.ghost) {
        b.ghost = true;
        state.rootRef.child('p/' + b.id).remove().catch(() => {});
        sendPosFor(b.id, b, false, true);
      }
    });
  }

  renderHud(g, playing);
  if (playing) renderTasks(g);
  else renderWatchNote();
  if ((g.stage !== 'play' || !playing) && state.taskSpot >= 0) closeTask();
  if (g.stage !== 'play' || !playing) $('ovRole').hidden = true;
  renderMeeting(g, room);
  renderResult(g);
  renderEnd(g);
  $('btnMenuLobby').hidden = state.role !== 'host';
}

function resetBotsPosition(g) {
  g.players.forEach((id, i) => {
    const b = BOTS[id];
    if (!b) return;
    const sp = E.spawnPoint(i, g.players.length);
    Object.assign(b, { x: sp.x, y: sp.y, route: [], goal: null, waitUntil: Date.now() + 1500 + Math.random() * 2000 });
    if (g.stage === 'play') sendPosFor(id, b, E.isAwake(g, id), true);
  });
}

function renderHud(g, playing) {
  const me = state.nickname;
  $('hudName').textContent = playing ? nameIn(g, me) : me;
  $('hudChip').style.background = playing ? colorHex(g.colors[me]) : colorHex(state.room?.players?.[me]?.color);
  const role = $('hudRole');
  if (playing) {
    role.textContent = (g.roles[me] === 'sleeper' ? 'ねむらせ屋' : '隊員') + (E.isAwake(g, me) ? '' : '（ねむっている）');
    role.className = 'nk-role' + (g.roles[me] === 'sleeper' ? ' nk-role--sleeper' : '');
  } else {
    role.textContent = state.role === 'host' ? '進行役' : '見学（次の回から）';
    role.className = 'nk-role';
  }
  const tp = E.taskProgress(g);
  $('hudProgress').style.width = (tp.total ? Math.round((tp.done / tp.total) * 100) : 0) + '%';
  $('hudProgressNum').textContent = tp.done + ' / ' + tp.total;
  $('hudDark').hidden = !g.dark;
}

function renderWatchNote() {
  $('watchNote').textContent = state.role === 'host'
    ? 'みんなは基地の中で仕事をしているよ。会議がひらくまで待ってね'
    : 'いまはゲームの途中。次の回からいっしょに遊べるよ。会議の話し合いは聞いていてね';
}

function showRole(g) {
  const role = g.roles[state.nickname];
  $('roleName').textContent = role === 'sleeper' ? 'ねむらせ屋' : '隊員';
  $('roleName').className = 'nk-rolecard__name' + (role === 'sleeper' ? ' nk-rolecard__name--sleeper' : '');
  let desc;
  if (role === 'sleeper') {
    const mates = g.players.filter((id) => id !== state.nickname && g.roles[id] === 'sleeper').map((id) => nameIn(g, id));
    desc = '仲間のふりをして、こっそり隊員をねむらせよう。「停電」で、隊員の見える広さをせまくできるよ。仕事の場所に立てば、仕事をしているふりもできる。';
    if (mates.length) desc += ' もうひとりのねむらせ屋は ' + mates.join('、') + ' さん。';
  } else {
    desc = '基地の仕事を片づけよう。みんなの仕事がぜんぶおわったら勝ち。ねむっている人を見つけたら「見つけた！」で会議をひらこう。';
  }
  $('roleDesc').textContent = desc;
  $('ovRole').hidden = false;
}

function renderTasks(g) {
  const me = state.nickname;
  const role = g.roles[me];
  const asleep = !E.isAwake(g, me);
  const mine = g.tasks[me] || [];
  const doneN = mine.filter((t) => t.done).length;
  $('tasksTitle').textContent = role === 'sleeper' ? 'ふりをする場所' : 'やること（' + doneN + ' / ' + mine.length + '）';
  const ul = $('tasksItems');
  ul.replaceChildren();
  mine.forEach((t) => {
    const sp = spotOf(t.spot);
    const done = role === 'crew' && t.done;
    const li = makeElement('li', 'nk-task' + (done ? ' is-done' : ''));
    li.append(msIcon(done ? 'check_circle' : 'radio_button_unchecked'), makeElement('span', 'nk-task__room', E.roomName(sp.room)), makeElement('span', 'nk-task__label', sp.label));
    ul.appendChild(li);
  });
  let note = '';
  if (role === 'sleeper') note = asleep ? 'ねむってしまったので、見ているだけ' : '本当の仕事はできないよ。立って、仕事のふりをしよう';
  else if (asleep) note = 'ねむっていても、仕事はつづけられる';
  $('tasksNote').textContent = note;
}

function renderMeeting(g, room) {
  const box = $('ovMeeting');
  if (g.stage !== 'meeting') { box.hidden = true; state.votePick = null; return; }
  box.hidden = false;
  const m = g.meeting;
  $('meetingWhy').textContent = m.why === 'body'
    ? nameIn(g, m.caller) + ' さんが、ねむっている ' + nameIn(g, m.found) + ' さんを見つけた'
    : nameIn(g, m.caller) + ' さんが会議ボタンを押した';
  const me = state.nickname;
  const playing = isPlaying(g, me);
  const awake = playing && E.isAwake(g, me);
  const voted = m.votes[me];
  $('meetingHow').textContent = !playing
    ? (state.role === 'host' ? '進行役は投票しないよ' : '次の回から遊べるよ。話し合いを聞いていてね')
    : !awake ? 'ねむっている人は投票しないで、話を聞いていてね'
      : voted ? '投票しました。みんなが入れおわるのを待ってね'
        : '話し合って、ねむらせ屋だと思う人に投票しよう。わからなければスキップでもいい';
  const ul = $('meetingPeople');
  ul.replaceChildren();
  g.players.forEach((id) => {
    const gone = E.hasLeft(g, id);
    const up = E.isAwake(g, id) && !gone;
    const li = makeElement('li', 'nk-vote__row' + (up ? '' : ' is-asleep') + (state.votePick === id ? ' is-picked' : ''));
    const canPick = awake && !voted && up;
    const main = makeElement(canPick ? 'button' : 'div', 'nk-vote__main');
    if (canPick) {
      main.type = 'button';
      main.addEventListener('click', () => { state.votePick = state.votePick === id ? null : id; renderMeeting(g, room); });
    }
    main.append(chip(g.colors[id]), makeElement('span', 'nk-vote__name', nameIn(g, id)));
    if (id === me) main.appendChild(makeElement('span', 'nk-tag nk-tag--me', 'あなた'));
    if (gone) main.appendChild(makeElement('span', 'nk-tag', '抜けた'));
    else if (!up) main.appendChild(makeElement('span', 'nk-tag', 'ねむっている'));
    if (m.votes[id]) main.appendChild(makeElement('span', 'nk-tag nk-tag--done', '投票ずみ'));
    if (!gone && !isBot(id) && !room.players?.[id]) main.appendChild(makeElement('span', 'nk-tag nk-tag--away', '通信が切れた'));
    li.appendChild(main);
    if (canPick && state.votePick === id) {
      const b = makeElement('button', 'btn btn-primary btn-sm nk-vote__go', 'この人に投票');
      b.type = 'button';
      b.addEventListener('click', () => { state.votePick = null; doVote(me, id); });
      li.appendChild(b);
    }
    ul.appendChild(li);
  });
  $('btnVoteSkip').hidden = !awake || !!voted;
  $('meetingCount').textContent = '投票 ' + Object.keys(m.votes).length + ' / ' + E.awakeOf(g).length;
  $('btnCloseVote').hidden = state.role !== 'host';
  updateMeetingTimer(g);
}

function updateMeetingTimer(g) {
  if (!g || g.stage !== 'meeting') return;
  const left = Math.max(0, Math.ceil((g.meeting.endsAt - RoomkRTDB.now()) / 1000));
  setText('meetingTimer', 'のこり ' + left + ' 秒');
}

function renderResult(g) {
  const box = $('ovResult');
  if (g.stage !== 'result') { box.hidden = true; return; }
  box.hidden = false;
  const r = g.result;
  const parts = Object.keys(r.counts).sort((a, b) => r.counts[b] - r.counts[a]).map((k) => (k === SKIP ? 'スキップ' : nameIn(g, k)) + ' ' + r.counts[k] + '票');
  $('resultVotes').textContent = parts.length ? parts.join('　') : 'だれも投票しなかった';
  if (r.target) {
    $('resultMain').textContent = 'みんなの投票で、' + nameIn(g, r.target) + ' さんがねむることになった';
    let sub = nameIn(g, r.target) + ' さんは、ねむらせ屋' + (r.wasSleeper ? 'だった！' : 'じゃなかった…');
    if (!g.winner) sub += '（ねむらせ屋は、あと ' + E.awakeOf(g, 'sleeper').length + ' 人）';
    if (r.target === state.nickname && !r.wasSleeper) sub += ' ねむっても、仕事はつづけられるよ';
    $('resultSub').textContent = sub;
  } else {
    $('resultMain').textContent = 'だれもねむらなかった';
    $('resultSub').textContent = r.tie ? 'いちばん多い票が同じ数だった' : 'スキップがいちばん多かった';
  }
}

function renderEnd(g) {
  const box = $('ovEnd');
  if (g.stage !== 'end') { box.hidden = true; return; }
  box.hidden = false;
  $('endTitle').textContent = g.winner === 'draw' ? '時間切れ！ 引き分け' : g.winner === 'crew' ? '隊員の勝ち！' : 'ねむらせ屋の勝ち！';
  $('endTitle').className = 'nk-endcard__title' + (g.winner === 'sleeper' ? ' nk-endcard__title--sleeper' : '');
  $('endWhy').textContent = {
    tasks: 'みんなの仕事がぜんぶおわった',
    found: 'ねむらせ屋を全員見つけた',
    outnumber: 'おきている隊員が、ねむらせ屋と同じ数になった',
    left: 'ねむらせ屋がいなくなった',
    timeup: '15分たった',
  }[g.winReason] || '';
  const ul = $('endPeople');
  ul.replaceChildren();
  g.players.forEach((id) => {
    const li = makeElement('li', 'nk-person');
    const sl = g.roles[id] === 'sleeper';
    li.append(chip(g.colors[id]), makeElement('span', 'nk-person__name', nameIn(g, id)), makeElement('span', 'nk-tag' + (sl ? ' nk-tag--sleeper' : ''), sl ? 'ねむらせ屋' : '隊員'));
    if (E.hasLeft(g, id)) li.appendChild(makeElement('span', 'nk-tag', '途中で抜けた'));
    ul.appendChild(li);
  });
  $('btnAgain').hidden = state.role !== 'host';
  $('endWait').hidden = state.role === 'host';
}

/* ── 仕事 ── */
function openTask(spotId) {
  const sp = spotOf(spotId);
  const g = gameOf(state.room);
  if (!g) return;
  state.taskSpot = spotId;
  const gen = ++state.taskGen;
  $('taskTitle').textContent = E.roomName(sp.room) + '：' + sp.label;
  $('ovTask').hidden = false;
  KEYS.clear();
  G.open($('taskBox'), sp.kind, async () => {
    if (state.taskSpot !== spotId || state.taskGen !== gen) return;
    closeTask();
    if (await doTask(state.nickname, spotId)) smallToast('仕事ができた！');
  });
}

function closeTask() {
  state.taskSpot = -1;
  state.taskGen += 1;
  $('ovTask').hidden = true;
  $('taskBox').replaceChildren();
}

/* ── 動く・描く ── */
const canvas = $('map');
const ctx = canvas.getContext('2d');
const fog = document.createElement('canvas');
const fctx = fog.getContext('2d');
let TS = 36;
let CW = 0;
let CH = 0;

function resizeCanvas() {
  const r = $('stage').getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  CW = Math.max(1, Math.floor(r.width));
  CH = Math.max(1, Math.floor(r.height));
  canvas.width = CW * dpr;
  canvas.height = CH * dpr;
  canvas.style.width = CW + 'px';
  canvas.style.height = CH + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fog.width = canvas.width;
  fog.height = canvas.height;
  fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  TS = Math.round(Math.max(26, Math.min(46, Math.min(CW / 15, CH / 10))));
}

const blocked = () => !$('ovRole').hidden || !$('ovTask').hidden || !$('ovMeeting').hidden || !$('ovResult').hidden || !$('ovEnd').hidden
  || !$('hostOffOverlay').hidden || $('menuDialog').open;

function inputDir() {
  let x = 0;
  let y = 0;
  if (KEYS.has('ArrowLeft') || KEYS.has('KeyA')) x -= 1;
  if (KEYS.has('ArrowRight') || KEYS.has('KeyD')) x += 1;
  if (KEYS.has('ArrowUp') || KEYS.has('KeyW')) y -= 1;
  if (KEYS.has('ArrowDown') || KEYS.has('KeyS')) y += 1;
  if (PAD.active) { x = PAD.x; y = PAD.y; }
  return { x, y };
}

let lastFrame = performance.now();
function frame(t) {
  const dt = Math.min(0.1, (t - lastFrame) / 1000);
  lastFrame = t;
  const room = state.room;
  const g = room && room.status === STATUS.PLAY && state.currentScreen === 'game' ? gameOf(room) : null;
  if (g && isPlaying(g, state.nickname)) {
    const awake = E.isAwake(g, state.nickname);
    if (g.stage === 'play' && !blocked()) {
      const d = inputDir();
      if (d.x || d.y) {
        const n = E.step(ME, d.x, d.y, dt);
        if (d.x) ME.face = d.x > 0 ? 1 : -1;
        ME.x = n.x;
        ME.y = n.y;
      }
    }
    // 送るのは遊んでいる間だけ（会議・結果・おしまいの間は送らない）
    if (g.stage === 'play') sendPosFor(state.nickname, ME, awake, false);
    [PA, PG].forEach((map) => Object.values(map).forEach((p) => {
      const k = Math.min(1, dt * 8);
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }));
    draw(g);
    updateActions(g);
    updateClock(g);
    updateMeetingTimer(g);
  } else if (g) {
    drawOverview(g);
    updateClock(g);
    updateMeetingTimer(g);
  }
  requestAnimationFrame(frame);
}

function drawPos(g, id) {
  if (id === state.nickname) return ME;
  if (BOTS[id]) return BOTS[id];
  return E.isAwake(g, id) ? PA[id] || null : PG[id] || null;
}

function viewRadius(g) {
  const me = state.nickname;
  if (!E.isAwake(g, me)) return Infinity;
  if (g.roles[me] === 'sleeper') return E.VIEW.sleeper;
  return g.dark ? E.VIEW.dark : E.VIEW.crew;
}

function clampCam(v, max) {
  if (max <= 0) return max / 2;
  return Math.max(0, Math.min(max, v));
}
function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}

function draw(g) {
  const camX = clampCam(ME.x * TS - CW / 2, E.W * TS - CW);
  const camY = clampCam(ME.y * TS - CH / 2, E.H * TS - CH);
  const sx = (x) => x * TS - camX;
  const sy = (y) => y * TS - camY;
  ctx.fillStyle = '#2D3642';
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = E.HALL_FILL;
  E.HALLS.forEach((h) => ctx.fillRect(sx(h[0]), sy(h[1]), h[2] * TS, h[3] * TS));
  E.ROOMS.forEach((r) => {
    ctx.fillStyle = r.fill;
    ctx.fillRect(sx(r.x), sy(r.y), r.w * TS, r.h * TS);
  });
  ctx.strokeStyle = 'rgba(0,0,0,0.05)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(camX / TS); x <= Math.ceil((camX + CW) / TS); x++) { ctx.moveTo(sx(x) + 0.5, 0); ctx.lineTo(sx(x) + 0.5, CH); }
  for (let y = Math.floor(camY / TS); y <= Math.ceil((camY + CH) / TS); y++) { ctx.moveTo(0, sy(y) + 0.5); ctx.lineTo(CW, sy(y) + 0.5); }
  ctx.stroke();
  ctx.font = '700 ' + Math.round(TS * 0.42) + 'px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(28,63,94,0.55)';
  E.ROOMS.forEach((r) => ctx.fillText(r.name, sx(r.x) + TS * 0.25, sy(r.y) + TS * 0.2));

  // テーブルと会議ボタン
  ctx.fillStyle = '#B98A5E';
  circle(sx(E.TABLE.x), sy(E.TABLE.y), E.TABLE.r * TS);
  ctx.fillStyle = '#C9302C';
  circle(sx(E.TABLE.x), sy(E.TABLE.y), TS * 0.38);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 ' + Math.round(TS * 0.3) + 'px "Noto Sans JP", sans-serif';
  ctx.fillText('会議', sx(E.TABLE.x), sy(E.TABLE.y));

  // 停電のスイッチ
  const fx = sx(E.FIX_SPOT.x);
  const fy = sy(E.FIX_SPOT.y);
  ctx.fillStyle = g.dark ? '#F5C518' : '#9AA3AD';
  roundRect(fx - TS * 0.35, fy - TS * 0.35, TS * 0.7, TS * 0.7, 6);
  ctx.fillStyle = '#1A1A1A';
  ctx.font = Math.round(TS * 0.55) + 'px "Material Symbols Rounded"';
  ctx.fillText('bolt', fx, fy);

  // 近道（だれにでも見える。使えるのはねむらせ屋だけ）
  E.VENTS.forEach((v) => drawVent(sx(v.x), sy(v.y), TS));

  // 仕事の場所
  const me = state.nickname;
  const role = g.roles[me];
  const mine = {};
  (g.tasks[me] || []).forEach((t) => { mine[t.spot] = role === 'crew' ? (t.done ? 'done' : 'todo') : 'fake'; });
  E.SPOTS.forEach((sp) => {
    const x = sx(sp.x);
    const y = sy(sp.y);
    ctx.fillStyle = '#7B8794';
    roundRect(x - TS * 0.32, y - TS * 0.32, TS * 0.64, TS * 0.64, 5);
    ctx.fillStyle = '#C8D3DC';
    roundRect(x - TS * 0.22, y - TS * 0.22, TS * 0.44, TS * 0.3, 3);
    const st = mine[sp.id];
    if (st === 'todo' || st === 'fake') {
      ctx.strokeStyle = st === 'todo' ? '#F5B700' : 'rgba(245,183,0,0.5)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - TS * 0.42, y - TS * 0.42, TS * 0.84, TS * 0.84);
      if (st === 'todo') {
        ctx.fillStyle = '#F5B700';
        ctx.font = '900 ' + Math.round(TS * 0.5) + 'px "Noto Sans JP", sans-serif';
        ctx.fillText('!', x, y - TS * 0.75);
      }
    } else if (st === 'done') {
      ctx.strokeStyle = '#2E9A4A';
      ctx.lineWidth = 3;
      ctx.strokeRect(x - TS * 0.42, y - TS * 0.42, TS * 0.84, TS * 0.84);
    }
  });

  const meAwake = E.isAwake(g, me);
  const vr = viewRadius(g);
  // 見える広さの中でも、間にかべがあれば描かない（ねむった人は vr が Infinity で、ぜんぶ見える）
  const inView = (p) => vr === Infinity || (E.dist(p, ME) <= vr && E.canSee(ME, p));

  Object.keys(g.bodies).forEach((id) => {
    const b = g.bodies[id];
    if (inView(b)) drawBody(sx(b.x), sy(b.y), colorHex(g.colors[id]));
  });

  const order = g.players.slice().sort((a, b) => ((drawPos(g, a) || {}).y || 0) - ((drawPos(g, b) || {}).y || 0));
  order.forEach((id) => {
    const pos = drawPos(g, id);
    if (!pos) return;
    const up = E.isAwake(g, id);
    if (!up && meAwake) return;          // おきている人には、ねむった人は見えない
    if (id !== me && !inView(pos)) return;
    const mate = role === 'sleeper' && g.roles[id] === 'sleeper';
    drawPerson(sx(pos.x), sy(pos.y), colorHex(g.colors[id]), pos.face || 1, up ? 1 : 0.45, nameIn(g, id), mate);
  });

  if (vr !== Infinity) {
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, CW, CH);
    fctx.fillStyle = 'rgba(12,16,24,0.9)';
    fctx.fillRect(0, 0, CW, CH);
    fctx.globalCompositeOperation = 'destination-out';
    const cx = sx(ME.x);
    const cy = sy(ME.y);
    const rr = vr * TS;
    const grad = fctx.createRadialGradient(cx, cy, rr * 0.7, cx, cy, rr);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = grad;
    // 丸でなく、自分から見える範囲（かべで止めた光線の多角形）だけを明るくする
    const poly = E.viewPolygon(ME, vr);
    fctx.beginPath();
    poly.forEach((p, i) => { if (i) fctx.lineTo(sx(p.x), sy(p.y)); else fctx.moveTo(sx(p.x), sy(p.y)); });
    fctx.closePath();
    fctx.fill();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fog, 0, 0);
    ctx.restore();
  }
}

// 遊んでいない人（進行役・見学）の画面: 地図ぜんたいだけ（人・ねむっている姿は描かない。画面共有しても動きが見えないように）
function drawOverview(g) {
  const pad = 16;
  const below = 110; // 下のお知らせの分をあける
  const s = Math.min((CW - pad * 2) / E.W, (CH - pad - below) / E.H);
  const ox = (CW - E.W * s) / 2;
  const oy = pad + (CH - pad - below - E.H * s) / 2;
  const sx = (x) => ox + x * s;
  const sy = (y) => oy + y * s;
  ctx.fillStyle = '#2D3642';
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = E.HALL_FILL;
  E.HALLS.forEach((h) => ctx.fillRect(sx(h[0]), sy(h[1]), h[2] * s, h[3] * s));
  E.ROOMS.forEach((r) => { ctx.fillStyle = r.fill; ctx.fillRect(sx(r.x), sy(r.y), r.w * s, r.h * s); });
  ctx.fillStyle = '#B98A5E';
  circle(sx(E.TABLE.x), sy(E.TABLE.y), E.TABLE.r * s);
  ctx.fillStyle = g.dark ? '#F5C518' : '#9AA3AD';
  roundRect(sx(E.FIX_SPOT.x) - s * 0.35, sy(E.FIX_SPOT.y) - s * 0.35, s * 0.7, s * 0.7, 4);
  E.SPOTS.forEach((sp) => { ctx.fillStyle = '#7B8794'; roundRect(sx(sp.x) - s * 0.32, sy(sp.y) - s * 0.32, s * 0.64, s * 0.64, 3); });
  E.VENTS.forEach((v) => drawVent(sx(v.x), sy(v.y), s));
  ctx.font = '700 ' + Math.max(12, Math.round(s * 0.6)) + 'px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(28,63,94,0.8)';
  E.ROOMS.forEach((r) => ctx.fillText(r.name, sx(r.x + r.w / 2), sy(r.y + r.h / 2) + (r.key === 'plaza' ? s * 3 : 0)));
  if (g.dark) { ctx.fillStyle = 'rgba(12,16,24,0.45)'; ctx.fillRect(0, 0, CW, CH); }
}

// 近道: 床のふた（しま模様の丸）
function drawVent(x, y, size) {
  const r = size * 0.38;
  ctx.save();
  ctx.fillStyle = '#5B6470';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#A7B0BA';
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.beginPath();
  for (let i = -1; i <= 1; i++) {
    ctx.moveTo(x - r * 0.7, y + i * r * 0.42);
    ctx.lineTo(x + r * 0.7, y + i * r * 0.42);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPerson(x, y, hex, face, alpha, name, mate) {
  const r = E.RADIUS * TS * 1.25;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.9, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = hex;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const ex = x + face * r * 0.28;
  ctx.fillStyle = '#fff';
  circle(ex - r * 0.28, y - r * 0.18, r * 0.24);
  circle(ex + r * 0.28, y - r * 0.18, r * 0.24);
  ctx.fillStyle = '#1A1A1A';
  circle(ex - r * 0.28 + face * r * 0.07, y - r * 0.16, r * 0.11);
  circle(ex + r * 0.28 + face * r * 0.07, y - r * 0.16, r * 0.11);
  ctx.font = '700 ' + Math.round(TS * 0.34) + 'px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.strokeText(name, x, y - r - 3);
  ctx.fillStyle = mate ? '#B91C1C' : '#1A1A1A';
  ctx.fillText(name, x, y - r - 3);
  ctx.restore();
}

function drawBody(x, y, hex) {
  const r = E.RADIUS * TS * 1.25;
  ctx.save();
  ctx.fillStyle = hex;
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.3, r * 1.2, r * 0.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#1A1A1A';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y + r * 0.1, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.moveTo(x + r * 0.53, y + r * 0.1);
  ctx.arc(x + r * 0.35, y + r * 0.1, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.fillStyle = '#1C3F5E';
  ctx.font = '700 ' + Math.round(TS * 0.36) + 'px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Zzz', x + r * 0.7, y - r * 0.3);
  ctx.restore();
}

/* ── いまできること（ボタン） ── */
const ACT = { use: null, find: null, sleep: null };
function updateActions(g) {
  const now = RoomkRTDB.now();
  const me = state.nickname;
  const role = g.roles[me];
  const awake = E.isAwake(g, me);
  const play = g.stage === 'play' && !blocked();

  let use = null;
  if (play) {
    // 近道（ねむらせ屋だけ）
    if (role === 'sleeper' && awake && Date.now() - ME.ventAt >= VENT_GAP_MS) {
      const v = E.VENTS.find((x) => E.dist(x, ME) <= E.USE_RANGE);
      if (v) use = { kind: 'vent', vent: v.id, label: '近道を使う' };
    }
    if (!use && role === 'crew') {
      const t = (g.tasks[me] || []).find((x) => !x.done && E.dist(spotOf(x.spot), ME) <= E.USE_RANGE);
      if (t) use = { kind: 'task', spot: t.spot, label: '仕事をする' };
    }
    if (!use && awake && g.dark && E.dist(E.FIX_SPOT, ME) <= E.USE_RANGE) use = { kind: 'fix', label: '電気をなおす' };
    if (!use && awake && E.dist(E.TABLE, ME) <= E.TABLE.r + E.USE_RANGE) {
      const left = g.buttons[me] || 0;
      use = { kind: 'button', label: '会議ボタン（あと' + left + '回）', off: left <= 0 };
    }
  }
  ACT.use = use;
  $('actUse').disabled = !use || !!use.off;
  setText('actUseLabel', use ? use.label : 'つかう');

  let find = null;
  if (play && awake) find = Object.keys(g.bodies).find((id) => E.dist(g.bodies[id], ME) <= E.FIND_RANGE && E.canSee(ME, g.bodies[id])) || null;
  ACT.find = find;
  $('actFind').hidden = !find;

  const isSl = role === 'sleeper' && awake;
  $('actSleep').hidden = !isSl;
  $('actDark').hidden = !isSl;
  if (isSl) {
    const cd = Math.max(0, Math.ceil(((g.cooldown[me] || 0) - now) / 1000));
    let target = null;
    let best = Infinity;
    E.awakeOf(g, 'crew').forEach((id) => {
      const p = drawPos(g, id);
      if (!p) return;
      const d = E.dist(p, ME);
      if (d <= E.SLEEP_RANGE && d < best && E.canSee(ME, p)) { best = d; target = id; }
    });
    ACT.sleep = play && cd === 0 ? target : null;
    $('actSleep').disabled = !ACT.sleep;
    setText('actSleepCd', cd > 0 ? String(cd) : '');
    const dcd = Math.max(0, Math.ceil((g.darkReadyAt - now) / 1000));
    $('actDark').disabled = !play || g.dark || dcd > 0;
    setText('actDarkCd', !g.dark && dcd > 0 ? String(dcd) : '');
  }
}

function updateClock(g) {
  const left = Math.max(0, Math.ceil(((g.endsAt || 0) - RoomkRTDB.now()) / 1000));
  setText('hudTime', 'のこり ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0'));
  $('hudTime').classList.toggle('is-soon', left <= 60);
}

function setText(id, text) {
  const node = $(id);
  if (node.textContent !== text) node.textContent = text;
}

function doUse() {
  const u = ACT.use;
  if (!u || u.off) return;
  if (u.kind === 'vent') {
    const to = E.VENTS[E.VENTS[u.vent].to];
    ME.x = to.x;
    ME.y = to.y;
    ME.ventAt = Date.now();
    const g = gameOf(state.room);
    if (g) sendPosFor(state.nickname, ME, E.isAwake(g, state.nickname), true);
    return;
  }
  if (u.kind === 'task') openTask(u.spot);
  else if (u.kind === 'fix') gameAct(mut.fix(state.nickname)).then((ok) => { if (ok) smallToast('電気がついた！'); });
  else if (u.kind === 'button') gameAct(mut.button(state.nickname));
}
function doFind() { if (ACT.find) gameAct(mut.find(state.nickname, ACT.find)); }
function doSleep() {
  const t = ACT.sleep;
  if (!t) return;
  const g = gameOf(state.room);
  const at = g && drawPos(g, t);
  if (at) gameAct(mut.sleep(state.nickname, t, { x: at.x, y: at.y }));
}
function doDark() {
  if ($('actDark').hidden || $('actDark').disabled) return;
  gameAct(mut.dark(state.nickname));
}

/* ── 操作のつなぎ ── */
function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    handler();
  });
}

function openJoinFromLink(code) {
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  setError('joinError', '');
  showScreen('join');
  $('guestName').focus();
}

function bind() {
  $('btnGoCreate').addEventListener('click', () => { setError('createError', ''); showScreen('create'); $('hostName').focus(); });
  $('btnGoJoin').addEventListener('click', () => { $('joinLinkHint').hidden = true; setError('joinError', ''); showScreen('join'); $('guestName').focus(); });
  $('btnCreateBack').addEventListener('click', () => showScreen('top'));
  $('btnJoinBack').addEventListener('click', () => showScreen('top'));
  $('btnCreateRoom').addEventListener('click', createRoom);
  $('btnJoinRoom').addEventListener('click', joinRoom);
  submitOnEnter($('hostName'), createRoom);
  submitOnEnter($('guestName'), () => $('joinCode').focus());
  submitOnEnter($('joinCode'), joinRoom);
  $('btnCopyCode').addEventListener('click', (e) => RoomkRTDB.copyRoomCode(state.roomCode, e.currentTarget));
  $('btnCopyLink').addEventListener('click', (e) => { if (state.roomCode) RoomkRTDB.copyRoomLink(state.roomCode, e.currentTarget); });
  $('btnShowQr').addEventListener('click', () => { if (state.roomCode) RoomkQR.show(state.roomCode); });
  $('btnAddBot').addEventListener('click', addBot);
  $('btnRemoveBot').addEventListener('click', removeBot);
  $('btnStart').addEventListener('click', startGame);
  $('btnLeave').addEventListener('click', leaveRoom);
  $('btnOverlayLeave').addEventListener('click', leaveRoom);
  $('btnRoleOk').addEventListener('click', () => { $('ovRole').hidden = true; });
  $('btnTaskClose').addEventListener('click', closeTask);
  $('btnVoteSkip').addEventListener('click', () => { state.votePick = null; doVote(state.nickname, SKIP); });
  $('btnCloseVote').addEventListener('click', () => {
    if (window.confirm('まだ投票していない人がいても、しめきりますか？')) gameAct(mut.closeVote());
  });
  $('btnAgain').addEventListener('click', () => backToLobby(true));
  $('btnMenu').addEventListener('click', () => {
    $('menuCode').textContent = 'ルームコード ' + (state.roomCode || '');
    $('menuDialog').showModal();
  });
  $('btnMenuClose').addEventListener('click', () => $('menuDialog').close());
  $('btnMenuLeave').addEventListener('click', () => { $('menuDialog').close(); leaveRoom(); });
  $('btnMenuLobby').addEventListener('click', () => {
    $('menuDialog').close();
    if (window.confirm('このゲームをやめて、みんなを待合室にもどしますか？')) backToLobby(false);
  });
  $('actUse').addEventListener('click', doUse);
  $('actFind').addEventListener('click', doFind);
  $('actSleep').addEventListener('click', doSleep);
  $('actDark').addEventListener('click', doDark);
  $('btnTasks').addEventListener('click', () => {
    const closed = $('taskList').classList.toggle('is-closed');
    $('btnTasks').setAttribute('aria-expanded', String(!closed));
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (state.currentScreen !== 'game') return;
    if (e.code === 'Escape' && !$('ovTask').hidden) { closeTask(); return; }
    if (blocked()) return;
    if (/^(Arrow|Key[WASD]$)/.test(e.code)) { KEYS.add(e.code); e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); doUse(); }
    else if (e.code === 'KeyR') doFind();
    else if (e.code === 'KeyQ') doSleep();
    else if (e.code === 'KeyF') doDark();
  });
  window.addEventListener('keyup', (e) => KEYS.delete(e.code));
  window.addEventListener('blur', () => KEYS.clear());
  window.addEventListener('resize', () => { if (state.currentScreen === 'game') resizeCanvas(); });

  // 画面の上のスティック
  const pad = $('pad');
  const knob = $('padKnob');
  const padMove = (e) => {
    const r = pad.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    PAD.x = Math.abs(dx) < 0.15 ? 0 : dx;
    PAD.y = Math.abs(dy) < 0.15 ? 0 : dy;
    knob.style.transform = 'translate(' + dx * r.width * 0.3 + 'px,' + dy * r.height * 0.3 + 'px)';
  };
  pad.addEventListener('pointerdown', (e) => { PAD.active = true; pad.setPointerCapture(e.pointerId); padMove(e); e.preventDefault(); });
  pad.addEventListener('pointermove', (e) => { if (PAD.active) padMove(e); });
  const padEnd = () => { PAD.active = false; PAD.x = 0; PAD.y = 0; knob.style.transform = ''; };
  pad.addEventListener('pointerup', padEnd);
  pad.addEventListener('pointercancel', padEnd);
}

async function init() {
  bind();
  requestAnimationFrame(frame);
  const params = new URLSearchParams(location.search);
  const roomParam = params.get('room');
  let linkCode = null;
  if (roomParam != null) {
    const code = normalizeRoomCode(roomParam);
    if (ROOM_CODE_PATTERN.test(code)) linkCode = code;
    else {
      toast('ルームコードが正しくないよ');
      history.replaceState(null, '', location.pathname);
    }
  }
  const saved = loadSession();
  if (saved && linkCode && saved.roomCode !== linkCode) clearSession();
  if (loadSession()) {
    if (await tryReconnect()) return;
    clearSession();
  }
  if (linkCode) openJoinFromLink(linkCode);
  else showScreen('top');
}

init();
