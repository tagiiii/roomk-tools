// カギあわせ：数字のカギを小さい順に並べて持ち、仲間のカギの数字を推理して、
// 同じ数字どうしをあわせていく協力ゲーム。『ボムバスターズ』から着想した。ルーム（Realtime Database）で進める。
// 配ったカギはそのゲームの間だけルームに置き、「もう一回あそぶ」とルームを閉じたときに消える。

const COPIES = 4; // 同じ数字のカギは4本ずつ
const MAX_NUMS = [8, 12]; // カギの数字（1〜8 みじかめ／1〜12 ふつう）
const TRAP_COUNTS = [0, 1, 2]; // ワナのカギの数
const DEFAULT_MAX_NUM = 8;
const DEFAULT_TRAPS = 1;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;
const MAX_GUESTS = 5;
const LOG_LIMIT = 40;

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'kagiawase_rooms';
const SESSION_KEY = 'kagiawase_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = {
  WAITING: 'waiting',
  SETUP: 'setup',
  PLAY: 'play',
  END: 'end',
};
const GAME_STATUSES = [STATUS.SETUP, STATUS.PLAY, STATUS.END];
const RESULT = {
  CLEAR: 'clear',
  TRAP: 'trap',
  ALARM: 'alarm',
};
const DEFAULT_TITLE = document.title;

const state = {
  role: null,
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
  // みんなにみせる画面（見るだけ）
  watchTimer: null,
  // 端末の中だけで持つ選び途中。進行（status・ゲーム・手）が変わったら消す
  uiKey: null,
  pickShow: null, // さいしょに見せる自分のカギ
  pickMine: null, // 自分の番で選んだ自分のカギ
  pickTarget: null, // 自分の番で選んだ仲間のカギ { name, index }
  boardKey: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.kag-screen').forEach((node) => node.classList.remove('active'));
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

function iconElement(name, className) {
  const icon = makeElement('span', 'material-symbols-rounded' + (className ? ' ' + className : ''), name);
  icon.setAttribute('aria-hidden', 'true');
  return icon;
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
// 在室している人を参加順に
function memberNames(room) {
  return Object.entries(room?.players || {})
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

function guestNames(room) {
  return memberNames(room).filter((name) => !room.players[name].isHost);
}

// 遊ぶ人か（ホストは「自分もプレイヤーとして参加する」のときだけ）
function playsName(room, name) {
  const player = room?.players?.[name];
  if (!player) return false;
  return !player.isHost || !!room.hostPlays;
}

function playingNames(room) {
  return memberNames(room).filter((name) => playsName(room, name));
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function maxNumOf(value) {
  return MAX_NUMS.includes(Number(value)) ? Number(value) : DEFAULT_MAX_NUM;
}

function trapsOf(value) {
  return TRAP_COUNTS.includes(Number(value)) ? Number(value) : DEFAULT_TRAPS;
}

function gameOf(room) {
  const game = room?.game;
  if (!game || typeof game !== 'object') return null;
  return game;
}

function orderOf(game) {
  return asList(game?.order).filter((name) => typeof name === 'string');
}

// カギ: v 数字、t ワナ（v と v+1 の間に並ぶ）、o あいた、h 数字がみんなに見えている
function tileOf(raw) {
  return {
    v: Number(raw?.v) || 0,
    t: raw?.t === true,
    o: raw?.o === true,
    h: raw?.h === true,
  };
}

// 並べる順の値（ワナは v と v+1 の間）
function sortKey(tile) {
  return tile.v * 2 + (tile.t ? 1 : 0);
}

function handOf(game, name) {
  return asList(game?.hands?.[name]).map(tileOf);
}

function tileAt(game, name, index) {
  const hand = handOf(game, name);
  return Number.isInteger(index) && index >= 0 && index < hand.length ? hand[index] : null;
}

// まだあいていない数字のカギ（ワナは数えない）
function isOpenable(tile) {
  return !!tile && !tile.t && !tile.o;
}

function totalNumberTiles(game) {
  return orderOf(game).reduce((sum, name) => sum + handOf(game, name).filter((tile) => !tile.t).length, 0);
}

function openedCount(game) {
  return orderOf(game).reduce((sum, name) => sum + handOf(game, name).filter((tile) => !tile.t && tile.o).length, 0);
}

// まだあいていない、数字 v のカギの数（全員ぶん）
function remainingOf(game, v) {
  return orderOf(game).reduce((sum, name) => sum + handOf(game, name).filter((tile) => isOpenable(tile) && tile.v === v).length, 0);
}

function mineOf(game, name, v) {
  return handOf(game, name).filter((tile) => isOpenable(tile) && tile.v === v).length;
}

// のこりの数字 v のカギを、全部自分が持っている（ひとりであけられる）
function canSolo(game, name, v) {
  const mine = mineOf(game, name, v);
  return mine > 0 && mine === remainingOf(game, v);
}

function hasWork(game, name) {
  return handOf(game, name).some(isOpenable);
}

function allOpened(game) {
  return orderOf(game).every((name) => !hasWork(game, name));
}

// 次の番: from の次から順に、まだあけるカギがある人。from 自身も最後に見る
function nextTurn(game, from) {
  const order = orderOf(game);
  const start = order.indexOf(from);
  for (let step = 1; step <= order.length; step++) {
    const name = order[(start + step + order.length) % order.length];
    if (hasWork(game, name)) return name;
  }
  return null;
}

function lampsOf(game) {
  return Number(game?.lamps) || orderOf(game).length;
}

function missesOf(game) {
  return Number(game?.misses) || 0;
}

function logOf(game) {
  return asList(game?.log).filter((entry) => entry && typeof entry === 'object');
}

function lastLog(game) {
  const log = logOf(game);
  return log.length ? log[log.length - 1] : null;
}

// ゲームの名前の持ち主（匿名ID）。ゲームの間は、その名前を同じ人だけが使える
function ownsName(game, name, uid) {
  return !!game && game.uids?.[name] === uid;
}

function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status === STATUS.WAITING) return false;
  const owner = game.uids?.[name];
  return !!owner && owner !== uid;
}

// 自分がこのゲームで遊んでいる人か（同じ名前・同じ匿名ID）
function isGamePlayer(room, name, uid) {
  const game = gameOf(room);
  return !!game && orderOf(game).includes(name) && ownsName(game, name, uid);
}

function isMyTurn(room) {
  const game = gameOf(room);
  return room?.status === STATUS.PLAY && !!game && game.turn === state.nickname
    && isGamePlayer(room, state.nickname, currentUid());
}

function shownOf(game, name) {
  return game?.shown?.[name] === true;
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
    console.warn('[kagi-awase] expired room cleanup failed', error);
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

async function waitAuth() {
  try {
    await authReady;
    return true;
  } catch {
    toast('うまくつながらなかったよ。ページを読み直してね');
    return false;
  }
}

/* ── カギを配る（transaction の中で使う） ── */
// 数字 1〜maxNum を4本ずつ＋ワナを traps 本まぜて、順番に配る。各自の手元は小さい順に並べる
function dealHands(order, maxNum, traps, rng) {
  const tiles = [];
  for (let v = 1; v <= maxNum; v++) {
    for (let c = 0; c < COPIES; c++) tiles.push({ v });
  }
  // ワナは数字と数字の間（1と2の間〜 maxNum-1 と maxNum の間）に1本ずつ、重ならないように置く
  const gaps = shuffled(Array.from({ length: maxNum - 1 }, (_, i) => i + 1), rng).slice(0, traps);
  gaps.forEach((v) => tiles.push({ v, t: true }));
  const hands = Object.fromEntries(order.map((name) => [name, []]));
  shuffled(tiles, rng).forEach((tile, i) => hands[order[i % order.length]].push(tile));
  Object.values(hands).forEach((hand) => hand.sort((a, b) => sortKey(tileOf(a)) - sortKey(tileOf(b))));
  return hands;
}

function withLog(game, entry) {
  const seq = (Number(game.seq) || 0) + 1;
  return {
    ...game,
    seq,
    log: logOf(game).slice(-(LOG_LIMIT - 1)).concat({ ...entry, n: seq }),
  };
}

function setTile(game, name, index, patch) {
  const hand = asList(game.hands?.[name]).slice();
  hand[index] = { ...hand[index], ...patch };
  return { ...game, hands: { ...game.hands, [name]: hand } };
}

/* ── 再接続用の記録（カギの数字は保存しない） ── */
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
  ['board', 'lampBox', 'historyList', 'lastMove'].forEach((id) => {
    $(id).replaceChildren();
    delete $(id).dataset.key;
  });
  state.boardKey = null;
}

function clearPicks() {
  state.pickShow = null;
  state.pickMine = null;
  state.pickTarget = null;
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
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
    uiKey: null,
    watchTimer: null,
  });
  clearPicks();
  clearSession();
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('btnOpenWatch').hidden = true;
  $('roomBar').hidden = true;
  $('hostQuitRow').hidden = true;
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
  //（再読み込みで古いコードの参加画面に戻らず、保存した記録から同じルームへ戻れるように）
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
    console.warn('[kagi-awase] room listener failed', error);
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
        if (nickname === room.host || reservedByOther(room, nickname, uid)) return;
        // 戻るときは参加したときの順番のまま。遊んでいるゲームの人数の上限は見ないが、
        // ゲームに入っていない人（待合室・見るだけ）は、ほかの人で満員なら戻らない
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
    console.warn('[kagi-awase] presence recovery failed', error);
    // 定期的な確認の失敗は通知しない（接続し直したときだけ知らせる）
    if (force) toast('再接続に失敗しました。ページを読み直してね');
  }
}

// 処理中（busy）のあいだに描いた盤面ではカギを押せないので、busy を外したあとに描き直す
// （遊んでいる途中に読み込み直して戻ったとき、次にだれかが動くまで自分の番の操作ができなくなるため）
function redrawAfterBusy() {
  if (state.room && state.roomRef && state.role !== 'spectator') renderRoom(state.room);
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
      const result = await ref.transaction((room) => {
        if (room) return;
        return {
          status: STATUS.WAITING,
          host: nickname,
          hostUid: uid,
          hostPlays: false,
          maxNum: DEFAULT_MAX_NUM,
          traps: DEFAULT_TRAPS,
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
        connectToRoom('host', nickname, code, ref, joinedAt);
        return;
      }
    }
    setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
  } catch (err) {
    console.warn('[kagi-awase] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnCreateRoom').disabled = false;
    redrawAfterBusy();
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
    const result = await ref.transaction((room) => {
      reason = '';
      rejoinAt = null;
      if (!room) { reason = '見つからない'; return; }
      if (isExpired(room)) { reason = '終了'; return; }
      // タブが落ちた直後など、サーバーがまだ切断に気づいていない自分の在室は、入りなおしとして上書きする
      const stale = room.players?.[nickname];
      const mine = !!stale && !stale.isHost && stale.uid === uid;
      if (nickname === room.host || (stale && !mine) || reservedByOther(room, nickname, uid)) {
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
    console.warn('[kagi-awase] join failed', err);
    setError('joinError', '接続できませんでした。もう一度ためしてね');
  } finally {
    release?.();
    state.busy = false;
    $('btnJoinRoom').disabled = false;
    redrawAfterBusy();
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
    console.warn('[kagi-awase] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    $('btnGoCreate').disabled = false;
    $('btnGoJoin').disabled = false;
    $('btnGoWatch').disabled = false;
    redrawAfterBusy();
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
      // 自分の在室だけを消す（カギはゲームが終わるまで残す。入りなおせるように）
      await ref.transaction((room) => {
        if (!room) return;
        if (room.players?.[nickname]?.uid !== uid) return;
        const players = { ...room.players };
        delete players[nickname];
        return { ...room, players };
      });
    }
  } catch (error) {
    console.warn('[kagi-awase] leave failed', error);
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
  }
  if (state.presenceDirty) ensurePresence(true);
  else if (needsPresence(room)) ensurePresence();
  updateHostOverlay(room);
  renderRoom(room);
}

function renderRoom(room) {
  syncUiKey(room);
  const game = gameOf(room);
  const inGame = GAME_STATUSES.includes(room.status) && !!game;
  if (inGame) renderGame(room, game);
  else renderWaiting(room);
  // 遊んでいる途中（おしまいの画面を除く）は、ホストだけ「ゲームをやめる」を出す
  $('hostQuitRow').hidden = !(state.role === 'host' && inGame && room.status !== STATUS.END);
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

// 進行が変わったとき（だれかが手を打った・番が変わった）だけ、選び途中を消す
function syncUiKey(room) {
  const game = gameOf(room);
  const key = [room.status, game?.id, game?.seq, game?.turn].join(':');
  if (key === state.uiKey) return;
  state.uiKey = key;
  clearPicks();
}

function renderPeople(listId, names, labelFor, tagsFor) {
  const list = $(listId);
  list.replaceChildren();
  names.forEach((name) => {
    const row = makeElement('li', 'kag-people__item');
    const who = makeElement('span', 'kag-people__name', name);
    (tagsFor ? tagsFor(name) : []).forEach((tag) => who.append(makeElement('span', 'kag-tag', tag)));
    row.append(who, makeElement('span', 'kag-people__status', labelFor(name)));
    list.append(row);
  });
}

function mineTag(name) {
  return name === state.nickname ? ['あなた'] : [];
}

function rulesText(maxNum, traps, players) {
  return 'カギの数字は 1〜' + maxNum + '（同じ数字が' + COPIES + '本ずつ）・ワナのカギ '
    + (traps ? traps + 'つ' : 'なし')
    + '・まちがえてよいのは' + (players ? ' ' + players + '回（遊ぶ人の数）' : '遊ぶ人の数まで');
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
  const players = playingNames(room);
  $('waitingCount').textContent = '参加者（遊ぶ人 ' + players.length + '人）';
  renderPeople('waitingPlayers', memberNames(room), (name) => {
    if (!room.players[name].isHost) return '参加中';
    return room.hostPlays ? 'ホスト（遊ぶ）' : 'ホスト（進行）';
  }, mineTag);
  const maxNum = maxNumOf(room.maxNum);
  const traps = trapsOf(room.traps);
  const rules = $('waitingRules');
  rules.hidden = host;
  rules.replaceChildren(
    makeElement('h3', 'kag-panel__title', 'こんどのルール'),
    makeElement('p', '', rulesText(maxNum, traps, players.length)),
  );
  $('hostWaitingTools').hidden = !host;
  if (!host) return;
  $('hostPlays').checked = !!room.hostPlays;
  document.querySelectorAll('input[name="maxNum"]').forEach((input) => { input.checked = Number(input.value) === maxNum; });
  document.querySelectorAll('input[name="traps"]').forEach((input) => { input.checked = Number(input.value) === traps; });
  const count = players.length;
  const ok = count >= MIN_PLAYERS && count <= MAX_PLAYERS;
  $('btnStartGame').disabled = !ok;
  $('startNote').textContent = ok
    ? 'まちがえてよいのは ' + count + '回（遊ぶ人の数）。遊ぶ人がみんな入ったら始めてね。始まったあとは、新しく参加できないよ。'
    : (count > MAX_PLAYERS
      ? '遊ぶ人は' + MAX_PLAYERS + '人までだよ（いま' + count + '人）。'
      : '遊ぶ人が' + MIN_PLAYERS + '人以上になったら始められます（いま' + count + '人）。'
        + (room.hostPlays ? '' : 'ホストも遊ぶときは「自分もプレイヤーとして参加する」をオンにしてね。'));
}

/* ── ゲームの画面（さいしょに見せる・遊ぶ・おしまい） ── */
function placeText(name, index) {
  return name + 'さんの' + (index + 1) + '番目';
}

// 1つの手を文にする
function logText(entry) {
  const by = String(entry.by || '');
  const to = String(entry.to || '');
  const i = Number(entry.i) || 0;
  switch (entry.r) {
    case 'hit':
      return by + 'さんが ' + placeText(to, i) + 'のカギに「' + entry.v + '」をあわせた → あいた！';
    case 'miss':
      return by + 'さんが ' + placeText(to, i) + 'のカギに「' + entry.v + '」をあわせた → ちがった。本当は「' + entry.a + '」。ランプが1つついた';
    case 'trap':
      return by + 'さんが ' + placeText(to, i) + 'のカギに「' + entry.v + '」をあわせた → ワナのカギだった！';
    case 'solo':
      return by + 'さんが「' + entry.v + '」のカギ' + (Number(entry.c) || 0) + '本を、ひとりであけた';
    case 'skip':
      return by + 'さんの番をとばした';
    default:
      return '';
  }
}

function logIcon(entry) {
  switch (entry.r) {
    case 'hit':
    case 'solo': return 'lock_open';
    case 'miss': return 'lightbulb';
    case 'trap': return 'notifications_active';
    default: return 'skip_next';
  }
}

// いちばん新しい手で動いたカギ（目印をつける）
function recentSpots(game) {
  const entry = lastLog(game);
  const spots = new Set();
  if (!entry) return spots;
  if (['hit', 'miss', 'trap'].includes(entry.r) && Number.isInteger(entry.i)) spots.add(entry.to + '#' + entry.i);
  if (entry.r === 'hit' && Number.isInteger(entry.m)) spots.add(entry.by + '#' + entry.m);
  if (entry.r === 'solo') asList(entry.ix).forEach((index) => spots.add(entry.by + '#' + index));
  return spots;
}

function titleFor(room, game) {
  const me = state.nickname;
  const player = isGamePlayer(room, me, currentUid());
  if (room.status === STATUS.SETUP) {
    if (player && !shownOf(game, me)) {
      return ['さいしょに1つ見せよう', '自分のカギを1つ選んで「このカギを見せる」を押してね。その数字がみんなに見えるよ。'];
    }
    if (player) return ['見せたよ', 'みんなが見せるカギを選ぶのを待っています。'];
    return ['みんなが見せるカギを選んでいます', 'みんながそろったら、' + (orderOf(game)[0] || '') + 'さんの番から始まるよ。'];
  }
  if (room.status === STATUS.PLAY) {
    if (isMyTurn(room)) {
      return ['あなたの番だよ', '自分のカギを1つと、仲間のカギを1つ選んで「あわせる」を押してね。'];
    }
    return [game.turn + 'さんの番', game.turn + 'さんが考えています。カギは小さい順に並んでいるよ。'];
  }
  const opened = openedCount(game);
  const total = totalNumberTiles(game);
  if (game.result === RESULT.CLEAR) {
    return ['宝箱があいた！', '数字のカギを全部あけたよ。まちがえは ' + missesOf(game) + '回。みんなで推理できたね！'];
  }
  const entry = lastLog(game);
  if (game.result === RESULT.TRAP && entry) {
    return ['今回はここまで', placeText(entry.to, Number(entry.i) || 0) + 'はワナのカギだった。警報が鳴っちゃった。あけたカギは ' + opened + ' / ' + total + '本。全部のカギの数字を見てみよう。'];
  }
  return ['今回はここまで', 'ランプが全部ついたあとにまちがえて、警報が鳴っちゃった。あけたカギは ' + opened + ' / ' + total + '本。全部のカギの数字を見てみよう。'];
}

function renderGame(room, game) {
  showScreen('game');
  const [title, lead] = titleFor(room, game);
  $('gameTitle').textContent = title;
  $('gameLead').textContent = lead;
  renderStatus(game, room.status === STATUS.END);
  renderLastMove(game);
  renderAway(room, game);
  renderBoard(room, game);
  renderActions(room, game);
  renderHistory(room, game);
  const host = state.role === 'host';
  const ended = room.status === STATUS.END;
  $('hostGameTools').hidden = !host || ended;
  $('btnCloseSetup').hidden = room.status !== STATUS.SETUP;
  const turnAway = room.status === STATUS.PLAY && !!game.turn && !room.players?.[game.turn];
  $('btnSkipTurn').hidden = !turnAway;
  $('hostEndTools').hidden = !(host && ended);
  $('endWait').hidden = !ended || host;
}

function renderStatus(game, ended) {
  const lamps = lampsOf(game);
  const misses = missesOf(game);
  const box = $('lampBox');
  // aria-live の欄なので、中身が変わったときだけ書き換える（選ぶたびに読み上げないため）
  const key = [game.id, lamps, misses, ended].join(':');
  $('progressText').textContent = 'あいたカギ ' + openedCount(game) + ' / ' + totalNumberTiles(game) + '本';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  const row = makeElement('span', 'kag-lamps__row');
  row.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < lamps; i++) {
    const lit = i < misses;
    row.append(iconElement(lit ? 'circle' : 'radio_button_unchecked', 'kag-lamp' + (lit ? ' is-lit' : '')));
  }
  const left = lamps - misses;
  let text;
  if (ended) text = 'ランプ ' + Math.min(misses, lamps) + ' / ' + lamps;
  else if (left > 0) text = 'ランプ ' + misses + ' / ' + lamps + '　あと' + left + '回まちがえても大丈夫';
  else text = 'ランプが全部ついたよ。次にまちがえると警報が鳴るよ';
  box.append(makeElement('span', 'kag-lamps__label', '警報ランプ'), row, makeElement('span', 'kag-lamps__text', text));
}

function renderLastMove(game) {
  const entry = lastLog(game);
  const box = $('lastMove');
  box.hidden = !entry;
  const key = entry ? game.id + ':' + entry.n : '';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  if (!entry) {
    box.replaceChildren();
    return;
  }
  box.className = 'kag-last kag-last--' + entry.r;
  box.replaceChildren(iconElement(logIcon(entry), 'kag-last__icon'), makeElement('span', 'kag-last__text', logText(entry)));
}

function renderAway(room, game) {
  const note = $('awayNote');
  const host = state.role === 'host';
  let text = '';
  if (room.status === STATUS.SETUP) {
    const away = orderOf(game).filter((name) => !shownOf(game, name) && !room.players?.[name]);
    if (away.length) {
      text = away.join('さん、') + 'さんの接続が切れています。'
        + (host ? '戻るのを待つか、「しめきる」で、見せないまま始められます。' : '戻るのを待ってね。');
    }
  } else if (room.status === STATUS.PLAY && game.turn && !room.players?.[game.turn]) {
    text = game.turn + 'さんの接続が切れています。'
      + (host ? '戻るのを待つか、「この番をとばす」で次の人の番にできます。' : '戻るのを待ってね。');
  }
  note.hidden = !text;
  note.textContent = text;
}

// 見る人ごとのカギの見え方
function tileView(room, game, name, tile, index) {
  const me = state.nickname;
  const own = name === me && isGamePlayer(room, me, currentUid());
  const ended = room.status === STATUS.END;
  const visible = ended || own || tile.o || tile.h;
  return {
    visible,
    own,
    label: visible ? (tile.t ? 'ワナ' : String(tile.v)) : '',
    // 見る人の画面にだけ数字を書く（見えないカギは DOM にも数字を置かない）
    desc: tile.o
      ? (tile.t ? 'ワナ' : tile.v + '（あいた）')
      : (visible ? (tile.t ? 'ワナ' : tile.v + (tile.h ? '（みんなに見えている）' : '')) : 'まだ見えない'),
    index,
  };
}

// 押せるカギか（mine: 自分のカギ、target: 仲間のカギ、show: さいしょに見せるカギ）
function pickKind(room, game, name, tile) {
  const me = state.nickname;
  const player = isGamePlayer(room, me, currentUid());
  if (!player || state.busy) return null;
  if (room.status === STATUS.SETUP) {
    return name === me && !shownOf(game, me) && isOpenable(tile) ? 'show' : null;
  }
  if (!isMyTurn(room)) return null;
  if (name === me) return isOpenable(tile) ? 'mine' : null;
  return !tile.o && !(tile.h && tile.t) ? 'target' : null;
}

function isPicked(name, index, kind) {
  if (kind === 'show') return state.pickShow === index;
  if (kind === 'mine') return state.pickMine === index;
  if (kind === 'target') return state.pickTarget?.name === name && state.pickTarget?.index === index;
  return false;
}

function rowStatus(room, game, name) {
  const away = !room.players?.[name];
  if (room.status === STATUS.SETUP) {
    if (shownOf(game, name)) return '見せた';
    return away ? '接続が切れています' : '選んでいる';
  }
  if (room.status === STATUS.PLAY) {
    if (away) return '接続が切れています';
    if (game.turn === name) return name === state.nickname && isGamePlayer(room, name, currentUid()) ? 'あなたの番' : 'この人の番';
    if (!hasWork(game, name)) return '全部あけた';
  }
  return '';
}

function renderBoard(room, game) {
  const order = orderOf(game);
  const recent = recentSpots(game);
  const rows = order.map((name) => {
    const tiles = handOf(game, name).map((tile, index) => {
      const view = tileView(room, game, name, tile, index);
      const kind = pickKind(room, game, name, tile);
      return { tile, view, kind, picked: !!kind && isPicked(name, index, kind), recent: recent.has(name + '#' + index) };
    });
    return { name, tiles, status: rowStatus(room, game, name), turn: room.status === STATUS.PLAY && game.turn === name };
  });
  // 中身が変わったときだけ作り直す（ほかの人の在室の変化などで、選んでいるボタンのフォーカスを失わないため）
  const key = JSON.stringify([room.status, game.id, game.seq, rows.map((row) => [
    row.name, row.status, row.turn,
    row.tiles.map((t) => [t.view.label, t.view.visible, t.tile.o, t.tile.h, t.tile.t && t.view.visible, t.kind, t.picked, t.recent]),
  ])]);
  if (state.boardKey === key) return;
  state.boardKey = key;
  const board = $('board');
  board.replaceChildren();
  rows.forEach((row) => {
    const section = makeElement('section', 'kag-row' + (row.turn ? ' is-turn' : '') + (row.name === state.nickname ? ' is-me' : ''));
    const head = makeElement('div', 'kag-row__head');
    const who = makeElement('span', 'kag-row__name', row.name);
    if (row.name === state.nickname && isGamePlayer(room, state.nickname, currentUid())) who.append(makeElement('span', 'kag-tag', 'あなた'));
    head.append(who);
    if (row.status) head.append(makeElement('span', 'kag-row__status' + (row.turn ? ' is-turn' : ''), row.status));
    const list = makeElement('div', 'kag-row__tiles');
    row.tiles.forEach(({ tile, view, kind, picked, recent: isRecent }) => {
      const node = makeElement(kind ? 'button' : 'span', 'kag-tile');
      if (kind) {
        node.type = 'button';
        node.addEventListener('click', () => pickTile(row.name, view.index, kind));
        node.setAttribute('aria-pressed', picked ? 'true' : 'false');
      } else {
        node.setAttribute('role', 'img');
      }
      node.setAttribute('aria-label', placeText(row.name, view.index) + 'のカギ（' + view.desc + '）');
      if (tile.o) node.classList.add('is-open');
      else if (view.visible && tile.t) node.classList.add('is-trap');
      else if (tile.h) node.classList.add('is-hint');
      else if (view.visible) node.classList.add('is-own');
      else node.classList.add('is-hidden');
      if (picked) node.classList.add('is-picked');
      if (kind) node.classList.add('is-pickable');
      if (isRecent) node.classList.add('is-recent');
      const face = makeElement('span', 'kag-tile__face');
      if (!view.visible) face.append(iconElement('key', 'kag-tile__icon'));
      else if (tile.t) face.append(iconElement('notifications_active', 'kag-tile__icon'), makeElement('span', 'kag-tile__trap', 'ワナ'));
      else face.append(makeElement('span', 'kag-tile__num', view.label));
      const mark = tile.o ? 'lock_open' : (tile.h && !tile.t ? 'visibility' : '');
      if (mark) face.append(iconElement(mark, 'kag-tile__mark'));
      node.append(face, makeElement('span', 'kag-tile__pos', view.index + 1));
      list.append(node);
    });
    section.append(head, list);
    board.append(section);
  });
}

function renderActions(room, game) {
  const me = state.nickname;
  const player = isGamePlayer(room, me, currentUid());
  const setupOpen = room.status === STATUS.SETUP && player && !shownOf(game, me);
  $('setupActions').hidden = !setupOpen;
  if (setupOpen) {
    const tile = tileAt(game, me, state.pickShow);
    $('setupPick').textContent = isOpenable(tile)
      ? (state.pickShow + 1) + '番目の「' + tile.v + '」を見せるよ'
      : '見せるカギを、自分の列から1つ選んでね（ワナのカギは選べないよ）';
    $('btnShowKey').disabled = !isOpenable(tile) || state.busy;
  }

  const myTurn = isMyTurn(room);
  $('turnActions').hidden = !myTurn;
  if (!myTurn) return;
  const mine = tileAt(game, me, state.pickMine);
  const target = state.pickTarget ? tileAt(game, state.pickTarget.name, state.pickTarget.index) : null;
  const mineOk = isOpenable(mine);
  const targetOk = !!target && !target.o && state.pickTarget.name !== me;
  // みんなに見えている数字とちがうカギは、あわないとわかっているので選ばせない
  const knownMiss = mineOk && targetOk && target.h && (target.t || target.v !== mine.v);
  const parts = [];
  parts.push(mineOk ? '自分のカギ「' + mine.v + '」' : '自分のカギ：まだ');
  parts.push(targetOk ? placeText(state.pickTarget.name, state.pickTarget.index) + 'のカギ' : '仲間のカギ：まだ');
  $('turnPick').textContent = knownMiss
    ? 'そのカギは「' + target.v + '」だとみんなに見えているよ。ほかのカギを選んでね'
    : parts.join(' ／ ');
  const match = $('btnMatch');
  match.textContent = mineOk ? '「' + mine.v + '」であわせる' : 'あわせる';
  match.disabled = !mineOk || !targetOk || knownMiss || state.busy;
  const solo = $('btnSolo');
  const soloOk = mineOk && canSolo(game, me, mine.v);
  solo.hidden = !soloOk;
  if (soloOk) {
    solo.textContent = '「' + mine.v + '」のカギ' + mineOf(game, me, mine.v) + '本を、ひとりであける';
    solo.disabled = state.busy;
  }
}

function renderHistory(room, game) {
  const log = logOf(game).filter((entry) => logText(entry));
  const panel = $('historyPanel');
  panel.hidden = room.status === STATUS.SETUP || log.length < 2;
  const list = $('historyList');
  list.replaceChildren();
  log.slice().reverse().forEach((entry) => {
    const item = makeElement('li', 'kag-history__item kag-history__item--' + entry.r);
    item.append(iconElement(logIcon(entry), 'kag-history__icon'), makeElement('span', '', logText(entry)));
    list.append(item);
  });
}

function pickTile(name, index, kind) {
  if (kind === 'show') state.pickShow = state.pickShow === index ? null : index;
  else if (kind === 'mine') state.pickMine = state.pickMine === index ? null : index;
  else if (kind === 'target') {
    const same = state.pickTarget?.name === name && state.pickTarget?.index === index;
    state.pickTarget = same ? null : { name, index };
  }
  if (!state.room) return;
  renderRoom(state.room);
  // 盤面を作り直したので、押したカギにフォーカスを戻す（キーボードで続けて選べるように）
  const label = placeText(name, index) + 'のカギ';
  const again = [...document.querySelectorAll('#board button.kag-tile')].find((node) => node.getAttribute('aria-label')?.startsWith(label + '（'));
  again?.focus();
}

/* ── みんなにみせる画面（画面共有用・見るだけ） ──
   ホストが別のタブで開いて共有する。ルームには入らず、RTDB には一切書き込まない
   （players にも入らない・切断予約をしない・期限切れのルームも消さない）。
   見えていないカギの数字は出さない。 */
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
    console.warn('[kagi-awase] watch failed', error);
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
  document.title = 'みんなにみせる画面 | カギあわせ | room-K';
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
    console.warn('[kagi-awase] watch listener failed', error);
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
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null, uiKey: null });
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
  $('hostQuitRow').hidden = true;
  document.title = DEFAULT_TITLE;
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

/* ── 遊ぶ人の操作 ── */
// 自分の操作をルームに書く。押した時点のゲームと手（seq）を捕まえて、transaction の中で一致を確かめる
async function playerTransaction(update, failMessage) {
  if (state.role !== 'host' && state.role !== 'guest') return;
  if (state.busy || !state.roomRef || !state.room) return;
  const game = gameOf(state.room);
  if (!game) return;
  const gameId = game.id;
  const seq = Number(game.seq) || 0;
  const status = state.room.status;
  const nickname = state.nickname;
  const uid = currentUid();
  state.busy = true;
  if (state.room) renderRoom(state.room);
  let moved = false;
  try {
    const result = await state.roomRef.transaction((room) => {
      moved = false;
      if (!room || isExpired(room)) return;
      const current = gameOf(room);
      if (!current || current.id !== gameId || (Number(current.seq) || 0) !== seq || room.status !== status) {
        moved = true;
        return;
      }
      if (!isGamePlayer(room, nickname, uid)) return;
      return update(room, current, nickname);
    });
    if (!result.committed && !moved) toast(failMessage);
  } catch (error) {
    console.warn('[kagi-awase] player action failed', error);
    toast(failMessage);
  } finally {
    state.busy = false;
    if (state.room) renderRoom(state.room);
  }
}

function showKey() {
  const index = state.pickShow;
  if (!Number.isInteger(index)) return;
  playerTransaction((room, game, me) => {
    if (room.status !== STATUS.SETUP || shownOf(game, me)) return;
    if (!isOpenable(tileAt(game, me, index))) return;
    let next = setTile(game, me, index, { h: true });
    next = { ...next, shown: { ...(next.shown || {}), [me]: true } };
    // 全員が見せたら、最初の人の番から始める
    if (orderOf(next).every((name) => shownOf(next, name))) {
      return { ...room, status: STATUS.PLAY, game: { ...next, turn: orderOf(next).find((name) => hasWork(next, name)) || null } };
    }
    return { ...room, game: next };
  }, '見せられませんでした。もう一度ためしてね');
}

// 数字のカギを全部あけた人に残ったワナは、みんなに見せる（原作どおり。位置がわかるのに選べてしまわないように）
function revealLeftTraps(game) {
  let next = game;
  orderOf(game).forEach((name) => {
    if (hasWork(next, name)) return;
    handOf(next, name).forEach((tile, index) => {
      if (tile.t && !tile.h) next = setTile(next, name, index, { h: true });
    });
  });
  return next;
}

// 手を打ったあと: 全部あいたらクリア、そうでなければ次の人の番
function afterMove(room, game, me) {
  if (allOpened(game)) return { ...room, status: STATUS.END, game: { ...game, result: RESULT.CLEAR, turn: null } };
  const next = revealLeftTraps(game);
  return { ...room, game: { ...next, turn: nextTurn(next, me) } };
}

function matchKeys() {
  const mineIndex = state.pickMine;
  const target = state.pickTarget;
  if (!Number.isInteger(mineIndex) || !target) return;
  playerTransaction((room, game, me) => {
    if (room.status !== STATUS.PLAY || game.turn !== me) return;
    if (target.name === me || !orderOf(game).includes(target.name)) return;
    const mine = tileAt(game, me, mineIndex);
    const other = tileAt(game, target.name, target.index);
    if (!isOpenable(mine) || !other || other.o) return;
    const base = { by: me, to: target.name, i: target.index, v: mine.v };
    if (other.t) {
      // ワナ: その場で警報
      const next = withLog(setTile(game, target.name, target.index, { h: true }), { ...base, r: 'trap' });
      return { ...room, status: STATUS.END, game: { ...next, result: RESULT.TRAP, turn: null } };
    }
    if (other.v === mine.v) {
      let next = setTile(game, target.name, target.index, { o: true });
      next = setTile(next, me, mineIndex, { o: true });
      next = withLog(next, { ...base, r: 'hit', m: mineIndex });
      return afterMove(room, next, me);
    }
    // ちがった: ランプが1つつき、そのカギの本当の数字がみんなに見える
    const misses = missesOf(game) + 1;
    let next = setTile(game, target.name, target.index, { h: true });
    next = withLog({ ...next, misses }, { ...base, r: 'miss', a: other.v });
    if (misses > lampsOf(game)) return { ...room, status: STATUS.END, game: { ...next, result: RESULT.ALARM, turn: null } };
    return { ...room, game: { ...next, turn: nextTurn(next, me) } };
  }, 'あわせられませんでした。もう一度ためしてね');
}

function soloOpen() {
  const mineIndex = state.pickMine;
  if (!Number.isInteger(mineIndex)) return;
  playerTransaction((room, game, me) => {
    if (room.status !== STATUS.PLAY || game.turn !== me) return;
    const mine = tileAt(game, me, mineIndex);
    if (!isOpenable(mine) || !canSolo(game, me, mine.v)) return;
    let next = game;
    const opened = [];
    handOf(game, me).forEach((tile, index) => {
      if (isOpenable(tile) && tile.v === mine.v) {
        next = setTile(next, me, index, { o: true });
        opened.push(index);
      }
    });
    next = withLog(next, { by: me, r: 'solo', v: mine.v, c: opened.length, ix: opened });
    return afterMove(room, next, me);
  }, 'あけられませんでした。もう一度ためしてね');
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
    console.warn('[kagi-awase] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    state.busy = false;
    if (state.room) renderRoom(state.room);
  }
}

async function setOption(key, value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, [key]: value };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && state.room) renderRoom(state.room);
}

async function startGame() {
  const seed = randomSeed();
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const names = playingNames(room);
    if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) return;
    const rng = seededRandom(seed);
    const order = shuffled(names, rng);
    const id = (Number(room.lastGameId) || 0) + 1;
    const maxNum = maxNumOf(room.maxNum);
    const traps = trapsOf(room.traps);
    return {
      ...room,
      status: STATUS.SETUP,
      lastGameId: id,
      game: {
        id,
        order,
        uids: Object.fromEntries(order.map((name) => [name, room.players[name].uid])),
        joined: Object.fromEntries(order.map((name) => [name, Number(room.players[name].joinedAt) || 0])),
        maxNum,
        traps,
        lamps: order.length,
        misses: 0,
        hands: dealHands(order, maxNum, traps, rng),
        shown: null,
        turn: null,
        seq: 0,
        log: null,
        result: null,
      },
    };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok === false) toast('はじめられませんでした。参加している人を確かめてね');
}

async function closeSetup() {
  const game = gameOf(state.room);
  if (!game) return;
  const notShown = orderOf(game).filter((name) => !shownOf(game, name));
  if (notShown.length && !window.confirm('まだ見せていない人がいます（' + notShown.join('、') + '）。見せないまま始めますか？')) return;
  const gameId = game.id;
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.SETUP || !current || current.id !== gameId) return;
    return { ...room, status: STATUS.PLAY, game: { ...current, turn: orderOf(current).find((name) => hasWork(current, name)) || null } };
  }, '進めませんでした。もう一度ためしてね');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
}

async function skipTurn() {
  const game = gameOf(state.room);
  if (!game || !game.turn) return;
  const gameId = game.id;
  const turn = game.turn;
  if (!window.confirm(turn + 'さんの番をとばして、次の人の番にしますか？')) return;
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.PLAY || !current || current.id !== gameId || current.turn !== turn) return;
    // 確認している間に戻ってきた人の番はとばさない
    if (room.players?.[turn]) return;
    const next = withLog(current, { by: turn, r: 'skip' });
    return { ...room, game: { ...next, turn: nextTurn(next, turn) } };
  }, 'とばせませんでした。もう一度ためしてね');
  if (ok === false) toast('とばせませんでした。画面を確かめてね');
}

async function playAgain() {
  const gameId = gameOf(state.room)?.id;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.END || gameOf(room)?.id !== gameId) return;
    return { ...room, status: STATUS.WAITING, game: null };
  }, '戻れませんでした。もう一度ためしてね');
  if (ok === false) toast('戻れませんでした。画面を確かめてね');
}

async function quitGame() {
  const gameId = gameOf(state.room)?.id;
  if (gameId == null) return;
  if (!window.confirm('ゲームをやめて、待合室に戻りますか？ 配ったカギは消えます。')) return;
  const ok = await hostTransaction((room) => {
    if (room.status === STATUS.WAITING || gameOf(room)?.id !== gameId) return;
    return { ...room, status: STATUS.WAITING, game: null };
  }, '戻れませんでした。もう一度ためしてね');
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
  if ($('joinLinkHint')) $('joinLinkHint').hidden = true;
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

// 参加用のリンク: このページのアドレスの末尾に ?room=ルームコード。チャットに貼ると、参加する人はリンクをひらいて名前を入れるだけで参加できる。
// 「コードをコピー」はコード単体のまま（口頭や画面共有で伝える用）。コピーは共通の RoomkRTDB.copyRoomLink（rtdb-utils.js）

$('btnCopyLink')?.addEventListener('click', (event) => {
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
  if ($('joinLinkHint')) $('joinLinkHint').hidden = false;
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

$('hostPlays').addEventListener('change', (event) => setOption('hostPlays', event.currentTarget.checked));
document.querySelectorAll('input[name="maxNum"]').forEach((input) => {
  input.addEventListener('change', () => setOption('maxNum', maxNumOf(input.value)));
});
document.querySelectorAll('input[name="traps"]').forEach((input) => {
  input.addEventListener('change', () => setOption('traps', trapsOf(input.value)));
});
$('btnStartGame').addEventListener('click', startGame);
$('btnShowKey').addEventListener('click', showKey);
$('btnMatch').addEventListener('click', matchKeys);
$('btnSolo').addEventListener('click', soloOpen);
$('btnCloseSetup').addEventListener('click', closeSetup);
$('btnSkipTurn').addEventListener('click', skipTurn);
$('btnPlayAgain').addEventListener('click', playAgain);
$('btnQuitGame').addEventListener('click', quitGame);

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
