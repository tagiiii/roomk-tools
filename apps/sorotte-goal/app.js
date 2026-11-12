/* そろってゴール
   ・ルーム: Realtime Database。遊ぶ2〜12人がそれぞれの端末で自分のコマを動かし、全員がゴールに入るとクリア
   ・端末なしの参加者・通信が切れた人のコマは、ホストが代わりに動かす
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない
   ルール（ステージの作り方・動き）は engine.js、絵は art.js。音は鳴らさない。

   動く部分（人・箱・カギ・星）は play/{対決の番号}/ に分けて置き、1歩で書くのは、ふつう自分のコマの場所だけ。
   全員ぶんを1つにまとめて書くと、同時に動いたときに書きなおしがぶつかって、人数が多いほど進めなくなる。
   同じ理由で、あそんでいる間に起きる書き込み（参加・戻る・退出・ステージの作りなおし）は、ルーム全体の transaction を使わない。 */
const E = window.SorotteEngine;
const ART = window.SorotteArt;

const MIN_SEATS = 2;         // 協力のしかけは2人から
const MAX_SEATS = E.MAX_PLAYERS;
const MAX_PROXIES = 4;       // 端末なしの参加者（ホストが代わりに動かす）
const MAX_STAGE = 9999;
const LEVELS = ['easy', 'normal', 'hard', 'expert'];
const LEVEL_NOTE = {
  easy: 'しかけは2つ。はじめてなら、ここから。',
  normal: 'しかけは3つ。重い箱や、番号の人だけ渡れる橋が出る。',
  hard: 'しかけは5つ。カギや星が、とびらの先にある。1人がスイッチをおさえて、もう1人がとりに行く。',
  expert: '部屋は6つ。どのしかけも、2人以上で力を合わせないと通れない。',
};
const DEFAULT_SET = { level: 'easy', stage: 1, hostPlays: true };
const KIND_NAME = { relay: 'とびら', relayJ: '橋の先のスイッチ', key: 'カギ', keyJ: '橋の先のカギ', keyDoor: 'とびらの先のカギ', box: '重い箱', boxBig: 'みんなで押す箱', pair: '同時におさえるスイッチ' };
const MARK_NAME = { a: 'まる', b: 'さんかく', c: 'しかく', d: 'ほし', e: 'ひしがた', f: 'プラス', h: 'ろっかく', i: 'つき' };
// ひとこと: 決まった言葉をえらんで、みんなに知らせる（声を出さなくても伝えられる）。自由に打つ欄は置かない。
// 言葉を足す・変えるときは、オーナーが決める（docs/development/ui.md「マイクを使わない子が参加できる手段」）
const SAYS = [
  'スイッチに乗るよ', 'スイッチに乗って',
  'そこで待ってて', 'いま通って',
  '箱を押そう', 'うしろから押して',
  'カギをとるよ', 'こっちに来て',
  'ちょっと待って', 'どうする？',
  'OK', 'ありがとう',
  'ナイス！', 'たすけて',
];
const SAY_EVERY_MS = 5000;   // ひとり5秒に1回まで
const SAY_SHOW_MS = 6000;    // 吹き出しを出しておく長さ
// マウスのある端末（PC）。矢印キーの案内は、PC にだけ出す
const PC_MQ = window.matchMedia('(hover: hover) and (pointer: fine)');
const NARROW_MQ = window.matchMedia('(max-width: 900px)');
const CONFETTI = ['#E0762B', '#2A93B4', '#F6CE4B', '#3FAE5A', '#8A5CC4', '#F28B9B'];
const NEAR_CELL = 54;        // 近くを映すときの、1マスの目安（px）
const SMALL_CELL = 40;       // これより小さいと、はじめから近くを映す

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'sorottegoal_rooms';
const SESSION_KEY = 'sorottegoal_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play' };
const DEFAULT_TITLE = document.title;

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'（みんなにみせる画面）
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
  picked: -1,          // いま動かすコマ（席の番号）。自分のコマか、ホストが代わりに動かすコマ
  near: null,          // 近くを映すか（null は、マスが小さいときだけ近くを映す）
  nearNow: false,      // いま近くを映しているか
  sayAt: 0,            // 最後にひとことを送った時刻（ひとり5秒に1回まで）
  saySeen: {},         // 席ごとの、最後に見たひとこと { v: 値, until: 出しておく時刻 }
  sayTimer: null,
  prev: null,          // 直前に出した状態（どこが変わったかを見て、動きを付ける）
  drawn: '',           // いま盤に出しているステージ（対決の番号＋ステージ）
  pieces: {},
  setKey: null,        // 待合室の設定の欄を、値が変わったときだけ作りなおすための印
  stepFailAt: 0,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  // かくれる画面の入力欄にカーソルが残ると、矢印キーがそちらに入ってしまうので外す
  const act = document.activeElement;
  if (act && act !== document.body && !act.closest('#screen-' + id)) act.blur();
  document.querySelectorAll('.sg-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  const inApp = id === 'waiting' || id === 'game';
  $('appBar').hidden = !inApp;
  $('roomBar').hidden = !inApp || !state.roomRef;
  window.scrollTo(0, 0);
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
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '名前に、記号 . # $ [ ] / は使えないよ';
  return '';
}

function currentUid() {
  return firebase.auth().currentUser?.uid || null;
}

function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}

function icon(name, className) {
  const node = el('span', 'material-symbols-rounded' + (className ? ' ' + className : ''), name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// art.js の決まった絵を入れる（利用者の入力は入らない）
function art(className, svg) {
  const node = el('div', className);
  node.innerHTML = svg;
  return node;
}

// 同じ動きを、もう一度はじめから
function replay(node, className) {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

const tint = (node, i) => { node.style.setProperty('--c', ART.COLORS[i % ART.COLORS.length]); return node; };

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

/* ── 設定 ── */
function normSet(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    level: LEVELS.includes(s.level) ? s.level : DEFAULT_SET.level,
    stage: Number.isInteger(s.stage) && s.stage >= 1 && s.stage <= MAX_STAGE ? s.stage : DEFAULT_SET.stage,
    hostPlays: typeof s.hostPlays === 'boolean' ? s.hostPlays : DEFAULT_SET.hostPlays,
  };
}
const levelLabel = (level) => E.LEVELS[level].label;
const settingSummary = (set) => 'むずかしさは「' + levelLabel(set.level) + '」・ステージ ' + set.stage;

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}
// 在室している人を参加順に（ホストもふくむ）
const memberNames = (room) => byJoined(Object.entries(room?.players || {}));
// 端末なしの参加者（ホストが代わりに動かす）。切断しない
const proxyNames = (room) => byJoined(Object.entries(room?.proxies || {}));
// 遊ぶ人に入れられる人（在室の人と、端末なしの参加者）。在室の人は匿名IDがあるときだけ
const seatable = (room, name) => typeof name === 'string' && ((typeof room?.players?.[name]?.uid === 'string' && !!room.players[name].uid) || !!room?.proxies?.[name]);

// 遊ぶ人（参加している人みんなと端末なしの参加者。参加した順に、コマの番号が決まる）。ホストは「ホストも遊ぶ」のときだけ
function seatList(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  const all = Object.entries(room?.players || {}).concat(Object.entries(room?.proxies || {}));
  return byJoined(all).filter((name) => hostPlays || name !== room.host).slice(0, MAX_SEATS);
}
// 遊ぶ人の名前（いる人と端末なしの参加者。ステージの途中は、通信が切れている人のコマも数える）
function playerNames(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  const names = new Set(Object.keys(room?.players || {}).concat(Object.keys(room?.proxies || {})).filter((name) => hostPlays || name !== room.host));
  const game = room?.status === STATUS.PLAY ? gameOf(room) : null;
  if (game) game.seats.forEach((name) => names.add(name));
  return names;
}
const playerCount = (room) => playerNames(room).size;
const FULL_MESSAGE = 'このルームはいっぱいだよ（遊べるのは' + MAX_SEATS + '人まで）。見るだけなら、トップの「みんなにみせる画面をひらく」から見てね';

// ステージを読む。こわれた値は読み飛ばす（null）
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const seats = asList(g.seats);
  const n = seats.length;
  if (n < MIN_SEATS || n > MAX_SEATS || !seats.every((x) => typeof x === 'string' && x)) return null;
  const spec = { kind: 'gen', level: g.spec?.level, n: Number(g.spec?.n), seed: Number(g.spec?.seed) };
  if (!E.validSpec(spec) || spec.n !== n) return null;
  const id = Number(g.id) || 0;
  // 動く部分は play/{id}。前のステージへの遅れた1歩が届いても、いまのステージには当たらない
  const S = E.fromRoom(room.play?.[id], spec);
  if (!S) return null;
  const uids = asList(g.uids);
  const proxy = asList(g.proxy);
  return {
    id,
    seats: seats.slice(),
    uids: seats.map((_, i) => (typeof uids[i] === 'string' ? uids[i] : '')),   // 端末なしの人は ''
    proxy: seats.map((_, i) => proxy[i] === true),
    spec,
    S,
  };
}

// その席の人が、いまルームにいるか（端末なしの参加者はいつもいる）
function seatPresent(room, game, i) {
  return game.proxy[i] || !!room?.players?.[game.seats[i]];
}

// この端末の人の席の番号（自分の端末で遊んでいる人だけ。なければ -1）
function selfSeat(game) {
  if (state.role !== 'host' && state.role !== 'guest') return -1;
  const uid = currentUid();
  return game.seats.findIndex((name, i) => !game.proxy[i] && name === state.nickname && game.uids[i] === uid);
}

// この端末が動かしてよいコマ（席の番号）。自分のコマと、ホストなら端末なしの人・通信が切れた人のコマ
function movableSeats(room, game) {
  if (state.role !== 'host' && state.role !== 'guest') return [];
  const uid = currentUid();
  const isHost = state.role === 'host' && room.hostUid === uid;
  const mine = selfSeat(game);
  return game.seats.map((_, i) => i).filter((i) => i === mine || (isHost && (game.proxy[i] || !room.players?.[game.seats[i]])));
}

// ステージの途中は、遊んでいる人の名前を同じ人（匿名ID）だけが使える
function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAY) return false;
  return game.seats.some((x, i) => x === name && (game.proxy[i] || (game.uids[i] && game.uids[i] !== uid)));
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
    console.warn('[sorotte-goal] expired room cleanup failed', error);
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
function resetView() {
  ['board', 'pads', 'pick', 'roster', 'legend', 'lobbyPeople'].forEach((id) => $(id).replaceChildren());
  $('pads').dataset.sig = '';
  clearTimeout(state.sayTimer);
  Object.assign(state, { picked: -1, near: null, nearNow: false, prev: null, drawn: '', pieces: {}, setKey: null, saySeen: {}, sayTimer: null });
  $('sayPanel').hidden = true;
  $('clearBox').hidden = true;
  $('board').style.transform = '';
  showTip('');
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef && (state.role === 'host' || state.role === 'guest')) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
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
  });
  clearSession();
  resetView();
  $('hostOffOverlay').hidden = true;
  $('btnOpenWatch').hidden = true;
  $('barMe').hidden = true;
  $('barMe').textContent = '';
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
    console.warn('[sorotte-goal] room listener failed', error);
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
      // 手元の値で確かめてから、2つの欄だけを書く（ルーム全体の transaction は、みんなが動いている間は通りにくい）
      const room = state.room;
      if (room.hostUid === uid && !isExpired(room) && !(room.hostConnected === true && room.hostDisconnectedAt == null)) {
        await ref.update({ hostConnected: true, hostDisconnectedAt: null });
      }
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      let full = false;
      let taken = false;
      // ルームの様子は手元の値で確かめ、書くのは自分の在室だけ（ほかの人が入っていたら書かない）
      const room = state.room;
      if (!isExpired(room) && !room.players?.[nickname]) {
        const game = gameOf(room);
        const seated = room.status === STATUS.PLAY && game && game.seats.includes(nickname);
        if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) taken = true;
        // 戻るときは参加したときの順番のまま。ステージの途中の、自分のコマがある人は人数の上限を見ない
        else if (!seated && playerCount(room) >= MAX_SEATS) full = true;
        else {
          const result = await ref.child('players/' + nickname).transaction((cur) => (cur ? undefined : { isHost: false, uid, joinedAt }));
          if (!result.committed && result.snapshot.val()?.uid !== uid) taken = true;
        }
      }
      if ((full || taken) && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(full ? FULL_MESSAGE : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
      }
    }
  } catch (error) {
    console.warn('[sorotte-goal] presence recovery failed', error);
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
          set: { ...DEFAULT_SET },
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
    console.warn('[sorotte-goal] create failed', err);
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
    // ルームの様子（名前・人数）は、いま読んだ値で確かめる。書くのは自分の在室だけ
    // （ルーム全体の transaction にすると、みんなが動いている間は書きなおしがぶつかって入れない）
    const fail = (message) => setError('joinError', message);
    const room = initial;
    const stale = room.players?.[nickname];
    // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
    const mine = !!stale && !stale.isHost && stale.uid === uid;
    if (nickname === room.host || room.proxies?.[nickname] || (stale && !mine) || reservedByOther(room, nickname, uid)) {
      fail('その名前は使われているよ。少し変えてみてね');
      return;
    }
    const game = gameOf(room);
    const seated = room.status === STATUS.PLAY && game && game.seats.includes(nickname);
    if (!mine && !seated && playerCount(room) >= MAX_SEATS) {
      fail(FULL_MESSAGE);
      return;
    }
    const rejoinAt = mine ? Number(stale.joinedAt) || joinedAt : null;
    // 同じ名前の人が同時に入っていたら、先に書いた人のもの（同じ匿名IDなら、自分の入りなおし）
    const result = await transactRetry(ref.child('players/' + nickname), (cur) => (cur && cur.uid !== uid ? undefined : { isHost: false, uid, joinedAt: rejoinAt || joinedAt }));
    if (!result.committed) {
      fail('その名前は使われているよ。少し変えてみてね');
      return;
    }
    // 読んでから書くまでの間に、ホストがルームを閉じていたら、在室だけの残りを消してやめる
    const after = (await ref.get()).val();
    if (!after || !after.status) {
      await ref.child('players/' + nickname).remove();
      fail('このルームは終わったみたい');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[sorotte-goal] join failed', err);
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
  const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoWatch'];
  tops.forEach((id) => { $(id).disabled = true; });
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
    console.warn('[sorotte-goal] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    tops.forEach((id) => { $(id).disabled = false; });
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
      // 自分の在室だけを消す（ステージの途中のコマは残り、ホストが代わりに動かせる）。
      // ほかの匿名IDの人がその名前で在室しているときは触らない
      await ref.child('players/' + nickname).transaction((cur) => (cur && cur.uid === uid ? null : undefined));
    }
  } catch (error) {
    console.warn('[sorotte-goal] leave failed', error);
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

/* ── みんなにみせる画面（見るだけ） ── */
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
    console.warn('[sorotte-goal] watch failed', error);
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
  document.title = 'みんなにみせる画面 | そろってゴール | あそびのたな';
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
    console.warn('[sorotte-goal] watch listener failed', error);
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
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null });
  resetView();
  $('hostOffOverlay').hidden = true;
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

/* ── ホストの操作（ルーム全体への transaction。たまにしか書かない） ── */
async function hostTransaction(update, failMessage, lock = true) {
  // 処理中の二度押しは何もしない（失敗の通知も出さない）
  if (state.role !== 'host' || !state.roomRef || (lock && state.busy)) return null;
  if (lock) state.busy = true;
  const uid = currentUid();
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      return update(room);
    });
    return result.committed;
  } catch (error) {
    console.warn('[sorotte-goal] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

// 設定は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない（中で今の値から作りなおす）
// change は、今の設定を受けて新しい設定を返す
async function saveSet(change) {
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING) return;
    const cur = normSet(room.set);
    const next = normSet(change({ ...cur }));
    // ホストを遊ぶ人に入れるときは、12人をこえないか確かめる
    if (next.hostPlays && !cur.hostPlays && playerCount(room) >= MAX_SEATS) { reason = '遊べるのは' + MAX_SEATS + '人までだよ'; return; }
    return { ...room, set: next };
  }, '設定を変えられませんでした。もう一度ためしてね', false);
  if (ok === false && reason) toast(reason, false);
  if (!ok && state.room) {
    state.setKey = null;
    renderRoom(state.room);
  }
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
    if (playerCount(room) >= MAX_SEATS) { reason = '遊べるのは' + MAX_SEATS + '人までだよ'; return; }
    return { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
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

// 遊ぶ人たちで新しいステージを作る（人数がそろわなければ null）
function newGameFor(room, seats, level, seed) {
  if (seats.length < MIN_SEATS || seats.length > MAX_SEATS || new Set(seats).size !== seats.length) return null;
  if (!seats.every((name) => seatable(room, name))) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const proxy = seats.map((name) => !!room.proxies?.[name]);
  const uids = seats.map((name, i) => (proxy[i] ? '' : room.players[name].uid));
  const spec = { kind: 'gen', level, n: seats.length, seed };
  // game はステージの決まり（だれが何番か・どのステージか）、play はそのステージの動く部分
  return { game: { id, seats: seats.slice(), uids, proxy, spec: { level, n: seats.length, seed } }, play: E.toRoom(E.create(spec)) };
}

async function startGame() {
  let n = 0;
  const ok = await hostTransaction((room) => {
    // ステージのデータがこわれて play のまま残ったときも、待合室の画面から始めなおせるようにする
    if (room.status !== STATUS.WAITING && !(room.status === STATUS.PLAY && !gameOf(room))) return;
    const set = normSet(room.set);
    const made = newGameFor(room, seatList(room), set.level, set.stage);
    if (!made) return;
    n = made.game.seats.length;
    return { ...room, status: STATUS.PLAY, lastGameId: made.game.id, game: made.game, play: { [made.game.id]: made.play } };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + n);
    window.RoomkStats?.count('level-' + normSet(state.room?.set).level);
  } else if (ok === false) {
    toast('遊ぶ人が2人そろっていないよ。だれかが入るのを待つか、「ホストも遊ぶ」をオンにしてね');
  }
}

// ステージを作りなおす。mode: 'next'（クリアのあと、次の番号へ）・'again'（同じ番号をもう一回）・'skip'（途中で、次の番号へ）
// 遊ぶ人は、いま参加している人で決めなおす（途中から入った人が入り、いなくなった人は外れる）
async function restartGame(mode) {
  const cur = gameOf(state.room);
  if (!cur) return;
  const gid = cur.id;
  const moving = cur.S.rev > 0 && !cur.S.cleared;
  if (mode === 'again' && moving && !window.confirm('このステージを、はじめからやりなおす？ みんなのコマが、はじめの場所にもどるよ。')) return;
  if (mode === 'skip' && moving && !window.confirm('ほかのステージにする？ このステージの進みは消えるよ。')) return;
  // 手元の値から次のステージを作り、要る欄だけをまとめて書く（ステージを作りなおせるのはホストだけなので、
  // ほかの端末と取り合いにならない。ルーム全体の transaction は、みんなが動いている間は通りにくい）
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  const room = state.room;
  if (room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  if (mode === 'next' && !cur.S.cleared) return;
  const seats = seatList(room);
  const seed = mode === 'again' ? cur.spec.seed : (cur.spec.seed % MAX_STAGE) + 1;
  const made = newGameFor(room, seats, cur.spec.level, seed);
  if (!made) {
    toast('遊ぶ人が2人そろっていないよ。「待合室へ」でだれかが入るのを待ってね');
    return;
  }
  const left = cur.seats.filter((name) => !seats.includes(name));
  state.busy = true;
  try {
    // play は、新しい番号のものだけにする（前のステージの分を消す）
    await state.roomRef.update({ lastGameId: made.game.id, 'set/stage': seed, game: made.game, play: { [made.game.id]: made.play } });
    window.RoomkStats?.count(mode);
    if (left.length) toast(left.join('・') + 'は、いないのでこのステージには入っていないよ', false);
  } catch (error) {
    console.warn('[sorotte-goal] restart failed', error);
    toast('ステージを作れませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

async function backToLobby() {
  const game = gameOf(state.room);
  if (game && game.S.rev > 0 && !game.S.cleared && !window.confirm('このステージをやめて、待合室にもどる？')) return;
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  const room = state.room;
  if (room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  state.busy = true;
  try {
    await state.roomRef.update({ status: STATUS.WAITING, game: null, play: null });
  } catch (error) {
    console.warn('[sorotte-goal] back to lobby failed', error);
    toast('もどれませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

/* ── 1歩 ──
   書くのは、さわった所だけ（ふつうは自分のコマの場所の1か所。箱を押したときは箱とうしろの人、
   カギ・星をとったときはそのカギ・星も、まとめて1回で書く）。手元の盤は、送る前に SDK が先に反映するので、すぐ動く。
   ほかの人と同じマスへ同時に入ったときは、2人が重なることがある（次の1歩で出られる。ルールの上で困らない）。
   書く先は play/{対決の番号}。ステージが作りなおされたあとに遅れて届いた1歩は、いまのステージに当たらない。 */
function sendStep(game, who, next) {
  const ref = state.roomRef;
  if (!ref) return;
  if (next.cleared && !game.S.cleared) window.RoomkStats?.count('finish');
  ref.child('play/' + game.id).update(E.patch(game.S, next, who)).catch((error) => {
    console.warn('[sorotte-goal] step failed', error);
    // 続けて失敗しても、知らせるのは5秒に1回まで
    if (Date.now() - state.stepFailAt > 5000) {
      state.stepFailAt = Date.now();
      toast('動かせなかったよ。通信を確かめてね');
    }
  });
}

function step(dir) {
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game || state.currentScreen !== 'game' || room.hostConnected === false || game.S.cleared) return;
  const who = state.picked;
  if (!movableSeats(room, game).includes(who)) return;
  const S = game.S;
  const next = E.move(S, who, dir);
  if (next !== S) {
    showTip('');
    sendStep(game, who, next);
    return;
  }
  // 進めなかった（書かない）: その向きへ体を当てる。重い箱はぐらつき、閉じたとびらはがたつく。理由を一言出す
  const me = state.pieces['player' + who];
  if (!me) return;
  const [dx, dy] = E.DIRS[dir];
  showTip(whyBlocked(game, who, dx, dy));
  aim(me, dir);
  replay(me, 'is-bump');
  const p = S.players[who];
  const bi = S.boxes.findIndex((b) => b[0] === p.x + dx && b[1] === p.y + dy);
  if (bi >= 0 && state.pieces['box' + bi]) replay(state.pieces['box' + bi], 'is-heavy');
  const cell = cellAt(p.x + dx, p.y + dy);
  if (cell && cell.classList.contains('sg-cell--door') && !cell.classList.contains('is-open')) replay(cell, 'is-rattle');
}

function pickSeat(i) {
  const room = state.room;
  const game = gameOf(room);
  if (!game || !movableSeats(room, game).includes(i)) return;
  state.picked = i;
  renderGame();
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
  const playing = room.status === STATUS.PLAY && !!gameOf(room);
  const next = playing ? 'game' : 'waiting';
  if (state.currentScreen !== next) showScreen(next);
  renderBar(room);
  if (playing) renderGame();
  else renderWaiting(room);
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

function renderBar(room) {
  let me = '';
  if (state.role === 'host' || state.role === 'guest') {
    const game = room.status === STATUS.PLAY ? gameOf(room) : null;
    const seats = game ? game.seats : seatList(room);
    const seat = seats.indexOf(state.nickname);
    me = (state.role === 'host' ? 'ホスト' : state.nickname)
      + (seat >= 0 ? '・' + (seat + 1) + 'のコマ' : state.role === 'host' ? '・進行だけ' : game ? '・この回は見る番' : '');
  }
  $('barMe').hidden = !me;
  $('barMe').textContent = me;
}

function seg(box, options, value, onPick) {
  box.replaceChildren(...options.map(([v, label]) => {
    const b = el('button', 'sg-seg__btn' + (v === value ? ' is-on' : ''), label);
    b.type = 'button';
    b.setAttribute('aria-pressed', v === value ? 'true' : 'false');
    b.addEventListener('click', () => onPick(v));
    return b;
  }));
}

function renderWaiting(room) {
  const host = state.role === 'host';
  const watch = state.role === 'spectator';
  const seats = seatList(room);
  const set = normSet(room.set);
  $('lobbyJoin').hidden = !watch;
  $('lobbyJoinCode').textContent = state.roomCode || '';

  // 遊ぶ人（参加している人みんな。参加した順に、コマの番号が決まる）
  const others = memberNames(room).concat(proxyNames(room)).filter((name) => !seats.includes(name));
  const ready = seats.length >= MIN_SEATS && seats.every((name) => seatable(room, name));
  let note = '';
  if (host) {
    note = seats.length < MIN_SEATS
      ? '2人からはじめられるよ。だれかが入るのを待つか、「ホストも遊ぶ」をオンにしてね'
      : '番号は、コマの番号。番号の付いた橋は、同じ番号の人だけ渡れるよ';
  }
  $('seatNote').textContent = note;
  $('seatNote').hidden = !note;
  const row = (name, si) => {
    const proxy = !!room.proxies?.[name];
    const li = el('li', 'sg-person');
    if (si >= 0) li.append(tint(el('span', 'sg-num', si + 1), si));
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    else li.append(icon(host && proxy ? 'person_off' : 'person'));
    li.append(el('span', 'sg-person__name', name));
    if (name === room.host) li.append(el('span', 'sg-chip sg-chip--muted', si >= 0 ? 'ホスト' : 'ホスト（進行だけ）'));
    if (host && proxy) li.append(el('span', 'sg-chip sg-chip--muted', '端末なし'));
    if (name === state.nickname && !watch) li.append(el('span', 'sg-chip sg-chip--you', 'あなた'));
    if (host && proxy) {
      const del = el('button', 'sg-quiet sg-person__del', '外す');
      del.type = 'button';
      del.addEventListener('click', () => removeProxy(name));
      li.append(del);
    }
    return li;
  };
  $('lobbyPeople').replaceChildren(...seats.map((name, i) => row(name, i)), ...others.map((name) => row(name, -1)));
  $('proxyMenu').hidden = !host;
  $('hostPlaysBox').hidden = !host;
  if (host) $('hostPlays').checked = set.hostPlays;

  // ステージの設定（ホストは選ぶ。値が変わったときだけ作りなおす）
  $('lobbySet').hidden = !host;
  $('lobbySetView').hidden = host;
  if (host) {
    const key = set.level + ':' + set.stage;
    if (state.setKey !== key) {
      state.setKey = key;
      seg($('levelSeg'), LEVELS.map((k) => [k, levelLabel(k)]), set.level, (v) => saveSet((s) => ({ ...s, level: v })));
      $('levelNote').textContent = LEVEL_NOTE[set.level];
      $('stageNum').textContent = String(set.stage);
    }
  } else {
    $('lobbySetView').textContent = settingSummary(set);
  }

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

/* ── 盤（動かない部分） ── */
const place = (node, x, y) => { node.style.setProperty('--x', x); node.style.setProperty('--y', y); };
const cellAt = (x, y) => $('board').querySelector('[data-pos="' + x + ',' + y + '"]');

function makeCell(S, T, t, x, y) {
  const wall = (dx, dy) => E.tileAt(S, x + dx, y + dy) === '#';
  const cell = el('div', 'sg-cell');
  cell.dataset.pos = x + ',' + y;
  place(cell, x, y);
  if (t === '#') {
    cell.classList.add('sg-cell--wall');
    if (!wall(0, 1)) cell.classList.add('has-face');
    return cell;
  }
  if ((x + y) % 2) cell.classList.add('is-alt');
  if (wall(0, -1)) cell.classList.add('is-shaded');
  if (t === 'G') {
    cell.classList.add('sg-cell--goal');
    cell.append(el('div', 'sg-goal__pad'), art('sg-goal__flag', ART.FLAG));
  } else if (E.SWITCHES.includes(t)) {
    cell.classList.add('sg-cell--sw', 'sg-cell--' + t);
    if (T.need[t] > 1) { cell.classList.add('is-pair'); cell.dataset.need = String(T.need[t]); }
    const sw = el('div', 'sg-sw');
    sw.append(el('div', 'sg-sw__base'), art('sg-sw__cap', ART.MARK[t]));
    cell.append(sw);
  } else if (E.SWITCH_OF[t] || t === 'L') {
    // 左右がゆかなら、戸は上下のかべの中へ開く。上下がゆかなら、左右へ開く
    cell.classList.add('sg-cell--door', 'sg-cell--' + t, wall(0, -1) && wall(0, 1) ? 'sg-door--h' : 'sg-door--v');
    if (T.need[E.SWITCH_OF[t]] > 1) { cell.classList.add('is-pair'); cell.dataset.need = String(T.need[E.SWITCH_OF[t]]); }
    cell.append(el('div', 'sg-door__p sg-door__p--1'), el('div', 'sg-door__p sg-door__p--2'),
      art('sg-door__mark', t === 'L' ? ART.LOCK : ART.MARK[E.SWITCH_OF[t]]));
  } else if (E.BRIDGE_OF[t] !== undefined) {
    cell.classList.add('sg-cell--bridge');
    tint(cell, E.BRIDGE_OF[t]);
    cell.append(el('div', 'sg-bridge__planks'), el('div', 'sg-bridge__num', String(E.BRIDGE_OF[t] + 1)));
  }
  return cell;
}

function drawStage(game) {
  const S = game.S;
  const T = E.staticOf(S.spec);
  const board = $('board');
  // 盤の大きさは、わくの側で決める（はば・画面の高さ・マスの上限のうち、いちばん小さいもの）
  const host = $('boardHost');
  host.style.setProperty('--w', T.w);
  host.style.setProperty('--h', T.h);
  host.style.setProperty('--bw', (T.w * 64) + 'px');
  board.style.setProperty('--w', T.w);
  board.style.setProperty('--h', T.h);
  board.replaceChildren();
  for (let y = 0; y < T.h; y += 1) {
    for (let x = 0; x < T.w; x += 1) board.append(makeCell(S, T, T.tiles[y * T.w + x], x, y));
  }
  state.pieces = {};
  state.prev = null;
  state.near = null;
  state.saySeen = {};
  state.drawn = game.id + ':' + E.specKey(S.spec);
  $('stageName').textContent = T.name + '・' + game.spec.n + '人　ステージ ' + game.spec.seed;
  replay($('stageName'), 'is-new');
  // このステージに出るしかけの名前をならべる（くわしい説明は、横の一覧と、進めなかったときの一言）
  $('stageHint').textContent = 'しかけ: ' + Array.from(new Set(T.kinds.map((k) => KIND_NAME[k]))).join('・') + '。星は、とってもとらなくてもいい。';
  $('clearBox').hidden = true;
  showTip('');
  buildLegend(T);
}

/* ── 動くもの（人・箱・カギ・星）: 同じ要素の場所だけを変える（すべるように動く） ── */
function piece(id, make) {
  let node = state.pieces[id];
  if (!node) {
    node = make();
    node.classList.add('is-new');
    state.pieces[id] = node;
    $('board').append(node);
  }
  return node;
}
function makePiece(className, svg, extra) {
  const node = el('div', 'sg-piece ' + className);
  const inner = art('sg-piece__in', svg);
  if (extra) inner.append(extra);
  node.append(el('div', 'sg-shadow'), inner);
  return node;
}
const dirOf = (dx, dy) => (dx > 0 ? 'right' : dx < 0 ? 'left' : dy < 0 ? 'up' : 'down');
function aim(node, dir) {
  const [dx, dy] = E.DIRS[dir];
  node.dataset.dir = dir;
  node.style.setProperty('--bx', dx);
  node.style.setProperty('--by', dy);
  node.style.setProperty('--sx', Math.abs(dx));
  node.style.setProperty('--sy', Math.abs(dy));
}

/* ── 演出 ── */
function fx(x, y, build) {
  const node = el('div', 'sg-fx');
  place(node, x, y);
  build(node);
  $('board').append(node);
  setTimeout(() => node.remove(), 800);
}
// 足もとの土けむり
function fxDust(x, y, dx, dy) {
  fx(x, y, (node) => {
    [[-90, -40], [0, -70], [90, -40]].forEach(([sx, sy]) => {
      const d = el('span', 'sg-fx__dot');
      d.style.setProperty('--dx', sx - dx * 120);
      d.style.setProperty('--dy', sy - dy * 80);
      node.append(d);
    });
  });
}
// きらきら（カギ・星を取った・かぎを開けた）
function fxSpark(x, y, color) {
  fx(x, y, (node) => {
    for (let i = 0; i < 8; i += 1) {
      const a = (Math.PI * 2 * i) / 8;
      const r = art('sg-fx__ray', ART.STAR);
      r.style.setProperty('--c', color);
      r.style.setProperty('--dx', Math.cos(a) * 320);
      r.style.setProperty('--dy', Math.sin(a) * 320);
      node.append(r);
    }
  });
}
// スイッチを押したときの輪
function fxRing(x, y, color) {
  fx(x, y, (node) => {
    const r = el('span', 'sg-fx__ring');
    r.style.setProperty('--c', color);
    node.append(r);
  });
}
function fxConfetti() {
  const board = $('board');
  const h = board.clientHeight;
  const w = board.clientWidth;
  for (let i = 0; i < 44; i += 1) {
    const c = el('span', 'sg-confetti');
    c.style.left = (Math.random() * 100) + '%';
    c.style.background = CONFETTI[i % CONFETTI.length];
    c.style.setProperty('--fall', (h * (0.9 + Math.random() * 0.3)) + 'px');
    c.style.setProperty('--sx', ((Math.random() - 0.5) * w * 0.25) + 'px');
    c.style.setProperty('--rot', (360 + Math.random() * 720) + 'deg');
    c.style.setProperty('--t', (1.2 + Math.random() * 0.9) + 's');
    c.style.setProperty('--d', (Math.random() * 0.5) + 's');
    board.append(c);
    setTimeout(() => c.remove(), 2800);
  }
}

function starRow(got, total) {
  const row = el('span', 'sg-hud__stars');
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', '星 ' + got + ' / ' + total);
  for (let i = 0; i < total; i += 1) row.append(art('sg-hud__star' + (i < got ? ' is-got' : ''), ART.GEM));
  return row;
}

/* ── ステージを描く ── */
function renderGame() {
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game) return;
  const S = game.S;
  if (state.drawn !== game.id + ':' + E.specKey(S.spec)) drawStage(game);
  const T = E.staticOf(S.spec);
  const P = state.prev;
  const board = $('board');
  const tile = (x, y) => T.tiles[y * T.w + x];
  const color = (t) => getComputedStyle(document.documentElement).getPropertyValue('--sg-' + t).trim();
  const host = state.role === 'host';
  const watch = state.role === 'spectator';

  // 動かすコマ: 自分のコマ。ホストは、端末なしの人・通信が切れた人のコマもえらべる
  const movable = movableSeats(room, game);
  const mine = selfSeat(game);
  if (!movable.includes(state.picked)) state.picked = movable.includes(mine) ? mine : (movable[0] ?? -1);

  // ひとこと: 席ごとに、いま出しておく言葉
  const says = currentSays(room, game);

  // とびらの開け閉め
  board.querySelectorAll('.sg-cell--door').forEach((cell) => {
    const [x, y] = cell.dataset.pos.split(',').map(Number);
    cell.classList.toggle('is-open', E.doorOpen(S, x, y));
  });
  // スイッチ: 乗っているとへこむ。とびらが開くだけおさえられている間は光る
  board.querySelectorAll('.sg-cell--sw').forEach((cell) => {
    const [x, y] = cell.dataset.pos.split(',').map(Number);
    const down = S.players.some((p) => p.x === x && p.y === y) || S.boxes.some((b) => b[0] === x && b[1] === y);
    if (down && !cell.classList.contains('is-down') && P) fxRing(x, y, color(tile(x, y)));
    cell.classList.toggle('is-down', down);
    cell.classList.toggle('is-on', E.held(S, tile(x, y)));
  });
  // ゴール: 人が入ると光る
  board.querySelectorAll('.sg-cell--goal').forEach((cell) => {
    const [x, y] = cell.dataset.pos.split(',').map(Number);
    cell.classList.toggle('is-in', S.players.some((p) => p.x === x && p.y === y));
  });

  const live = new Set();
  S.keys.forEach(([x, y]) => {
    const id = 'key' + x + '_' + y;
    live.add(id);
    place(piece(id, () => makePiece('sg-piece--key', ART.KEY, art('sg-twinkle', ART.STAR))), x, y);
  });
  S.stars.forEach(([x, y]) => {
    const id = 'star' + x + '_' + y;
    live.add(id);
    place(piece(id, () => makePiece('sg-piece--star', ART.GEM, art('sg-twinkle', ART.STAR))), x, y);
  });
  // とった星のあとに、きらきら
  if (P) P.stars.forEach(([x, y]) => { if (!S.stars.some((s) => s[0] === x && s[1] === y)) fxSpark(x, y, '#FFD23F'); });
  const pushed = [];   // 動いた箱の、動く前の場所（押した人に、押す動きを付ける）
  S.boxes.forEach(([x, y], i) => {
    const id = 'box' + i;
    live.add(id);
    // 箱の札の数字は、押すのに要る人数（たてにならぶ人数）
    const node = piece(id, () => { const n = makePiece('sg-piece--box', ART.BOX); n.append(el('span', 'sg-boxnum', T.team[i] || 2)); return n; });
    const was = P && P.boxes[i];
    if (was && (was[0] !== x || was[1] !== y)) { replay(node, 'is-slide'); pushed.push(was); }
    node.style.zIndex = String(100 + y * 2);
    place(node, x, y);
  });
  S.players.forEach((p, i) => {
    const id = 'player' + i;
    live.add(id);
    const node = piece(id, () => {
      const n = tint(makePiece('sg-piece--player', ART.char(i)), i);
      n.dataset.seat = String(i);
      // 番号の札と、自分の印
      const pin = el('div', 'sg-pin');
      pin.append(el('span', 'sg-pin__label', ''));
      n.append(el('span', 'sg-tag', String(i + 1)), pin);
      return n;
    });
    const was = P && P.players[i];
    if (was && (was.x !== p.x || was.y !== p.y)) {
      const dx = Math.sign(p.x - was.x);
      const dy = Math.sign(p.y - was.y);
      aim(node, dirOf(dx, dy));
      replay(node, 'is-hop');
      fxDust(was.x, was.y, dx, dy);
      // 箱のあった場所へ入った人は、箱を押した人
      if (pushed.some((b) => b[0] === p.x && b[1] === p.y)) replay(node, 'is-push');
    }
    node.classList.toggle('is-me', i === mine);
    node.classList.toggle('is-picked', i === state.picked && i !== mine);
    node.querySelector('.sg-pin__label').textContent = i === mine ? 'あなた' : '';
    node.classList.toggle('is-away', !seatPresent(room, game, i));
    node.classList.toggle('is-cheer', S.cleared);
    // 持っているカギ
    const inner = node.querySelector('.sg-piece__in');
    const carry = inner.querySelector('.sg-carry');
    if (p.key && !carry) inner.append(art('sg-carry', ART.KEY));
    if (!p.key && carry) carry.remove();
    if (was && p.key && !was.key) fxSpark(p.x, p.y, '#F6CE4B');
    if (was && !p.key && was.key) fxSpark(p.x, p.y, '#FFFFFF');
    // ひとことの吹き出し
    const said = says[i];
    let bubble = node.querySelector('.sg-say');
    if (said && (!bubble || bubble.textContent !== said)) {
      if (bubble) bubble.remove();
      bubble = el('div', 'sg-say', said);
      node.append(bubble);
    } else if (!said && bubble) {
      bubble.remove();
    }
    node.classList.toggle('has-say', !!said);
    // 下のマスにいるコマほど手前に出す
    node.style.zIndex = String(100 + p.y * 2 + 1);
    place(node, p.x, p.y);
  });
  Object.keys(state.pieces).forEach((id) => {
    if (!live.has(id)) { state.pieces[id].remove(); delete state.pieces[id]; }
  });
  board.classList.toggle('is-pickable', movable.length > 1);
  board.classList.toggle('is-calm', S.players.length > 4);

  // 星（歩数は、あそんでいる間は出さない。クリアのときに「ぜんぶで○歩」とだけ出す）
  $('hud').replaceChildren(starRow(S.got, T.stars.length));

  // 横: 自分の表示・動かすコマ・矢印・遊ぶ人の一覧
  const you = $('youLine');
  let line = '';
  if (mine >= 0) line = 'あなたは ' + (mine + 1) + ' のコマ';
  else if (state.role === 'guest') line = 'この回は見る番だよ。次のステージから入るよ';
  else if (host && !movable.length) line = 'ホストは進行だけ';
  you.hidden = !line;
  you.textContent = line;
  if (mine >= 0) tint(you, mine); else you.style.removeProperty('--c');
  renderPads(game, movable);
  renderSay(movable);
  $('roster').replaceChildren(...game.seats.map((name, i) => {
    const li = el('li');
    li.append(tint(el('span', 'sg-num', i + 1), i), el('span', '', name));
    if (i === mine) li.append(el('span', 'sg-chip sg-chip--you', 'あなた'));
    if (!seatPresent(room, game, i)) li.append(el('span', 'sg-chip sg-chip--warn', '通信が切れた'));
    if (says[i]) li.append(el('span', 'sg-roster__say', says[i]));
    // 「端末なし」の印はホストの画面にだけ出す
    if (host && game.proxy[i]) li.append(el('span', 'sg-chip sg-chip--muted', '端末なし'));
    return li;
  }));

  // 詰んだときの案内
  const stuck = E.stuck(S);
  $('stuckBox').hidden = !stuck || watch;
  if (stuck) {
    $('stuckText').textContent = host
      ? '箱が、スイッチまで運べない場所に入ったみたい。「そのほかの操作」の「このステージをやりなおす」で、はじめの場所にもどせるよ。'
      : '箱が、スイッチまで運べない場所に入ったみたい。ホストが「やりなおす」と、はじめの場所にもどせるよ。';
  }
  $('hostMenu').hidden = !host;

  // クリア
  if (S.cleared && $('clearBox').hidden && P) fxConfetti();
  $('clearBox').hidden = !S.cleared;
  if (S.cleared) {
    const sub = [el('span', '', 'ぜんぶで' + S.rev + '歩')];
    if (T.stars.length) sub.unshift(starRow(S.got, T.stars.length));
    $('clearSub').replaceChildren(...sub);
    $('clearBtns').hidden = !host;
    $('clearWait').hidden = host || watch;
  }
  state.prev = S;
  camera();
}

// 画面の矢印のボタンと、動かすコマをえらぶ一覧（ホストが、ほかの人のコマも動かせるとき）
function renderPads(game, movable) {
  const sig = game.id + ':' + movable.join(',') + ':' + state.picked;
  const pads = $('pads');
  if (pads.dataset.sig === sig && pads.childNodes.length === (movable.length ? 1 : 0)) return;
  pads.dataset.sig = sig;
  const pick = $('pick');
  pick.hidden = movable.length < 2;
  pick.replaceChildren(...(movable.length < 2 ? [] : movable.map((i) => {
    const b = tint(art('sg-pick__btn' + (i === state.picked ? ' is-on' : ''), ART.char(i)), i);
    b.setAttribute('role', 'button');
    b.tabIndex = 0;
    b.setAttribute('aria-label', game.seats[i] + 'のコマを動かす');
    b.setAttribute('aria-pressed', i === state.picked ? 'true' : 'false');
    b.addEventListener('click', () => pickSeat(i));
    b.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickSeat(i); } });
    return b;
  })));
  if (!movable.length) { pads.replaceChildren(); return; }
  const i = state.picked;
  const pad = tint(el('div', 'sg-pad'), i);
  pad.append(el('p', 'sg-pad__label', game.seats[i] + (PC_MQ.matches ? '（矢印キー・W A S D）' : '')));
  [['up', 'arrow_upward', '上へ'], ['left', 'arrow_back', '左へ'], ['down', 'arrow_downward', '下へ'], ['right', 'arrow_forward', '右へ']].forEach(([dir, name, label]) => {
    const b = el('button', 'sg-pad__btn sg-pad__btn--' + dir);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.append(icon(name));
    b.addEventListener('click', () => step(dir));
    pad.append(b);
  });
  pads.replaceChildren(pad);
}

/* ── 盤の大きさと、映す場所 ──
   盤のわくの高さを、画面に収まるように決める（スマホは、下に矢印のボタンが入る分をあける）。
   全体を映すとき: 盤をわくに収まるまで縮めて、まん中に置く。
   近くを映すとき: マスが小さい（人数が多い・画面がせまい）ときに、盤を大きくして、動かすコマをまん中にする。
   みんなにみせる画面・進行だけのホスト・見る番の人は、いつも全体。 */
function camera() {
  const game = gameOf(state.room);
  const host = $('boardHost');
  const board = $('board');
  const btn = $('btnView');
  if (!game) return;
  const T = E.staticOf(game.S.spec);
  const W = host.clientWidth;
  if (!W) return;
  const cell = W / T.w;
  const boardH = cell * T.h;
  const top = host.getBoundingClientRect().top + window.scrollY;
  // スマホは、盤の下に矢印のボタンが入り、右下の固定のボタン（？など）にかからない分をあける
  const avail = Math.max(160, window.innerHeight - top - (NARROW_MQ.matches ? 330 : 16));
  const fit = Math.min(1, avail / boardH);
  const who = state.picked;
  const can = who >= 0 && cell * fit < NEAR_CELL - 4;
  const near = can && (state.near == null ? cell * fit < SMALL_CELL : state.near);
  state.nearNow = near;
  btn.hidden = !can;
  if (can) btn.replaceChildren(icon(near ? 'zoom_out_map' : 'zoom_in'), document.createTextNode(near ? '全体を見る' : '近くを見る'));
  const scale = near ? Math.min(5, NEAR_CELL / cell) : fit;
  const bw = W * scale;
  const bh = boardH * scale;
  const H = near ? Math.min(avail, bh) : bh;
  host.style.height = H.toFixed(1) + 'px';
  // わくより小さい向きはまん中に。大きい向きは、動かすコマがまん中に来るように（はしは、はみ出さない）
  const p = near ? game.S.players[who] : null;
  const along = (size, view, at) => (size <= view ? (view - size) / 2 : Math.max(view - size, Math.min(0, view / 2 - at)));
  const tx = along(bw, W, p ? (p.x + 0.5) * cell * scale : 0);
  const ty = along(bh, H, p ? (p.y + 0.5) * cell * scale : 0);
  board.style.transform = 'translate(' + tx.toFixed(1) + 'px, ' + ty.toFixed(1) + 'px) scale(' + scale.toFixed(3) + ')';
}

/* ── ひとこと ──
   play/{対決の番号}/say/{席の番号} に「言葉の番号.何回目」を書く（同じ言葉を続けて送っても、変わったと分かるように回数を付ける）。
   送れるのは、コマを動かせる人（自分のコマ。ホストは、代わりに動かしているコマの分も）。ひとり5秒に1回まで。
   吹き出しは、届いてから6秒出す。音は鳴らさない。 */
function currentSays(room, game) {
  const raw = room.play?.[game.id]?.say;
  const now = Date.now();
  const out = {};
  let next = 0;
  game.seats.forEach((_, i) => {
    const v = raw && typeof raw === 'object' ? raw[i] : null;
    const seen = state.saySeen[i];
    if (typeof v === 'string' && (!seen || seen.v !== v)) {
      // はじめて見た値。ステージの画面を開いた時点でもう置いてあった言葉は出さない（いつ送られたか分からない）
      state.saySeen[i] = { v, until: state.prev ? now + SAY_SHOW_MS : 0 };
    }
    const cur = state.saySeen[i];
    if (!cur || cur.until <= now) return;
    const text = SAYS[Number(String(cur.v).split('.')[0])];
    if (!text) return;
    out[i] = text;
    next = next ? Math.min(next, cur.until) : cur.until;
  });
  // いちばん早く消える吹き出しの時刻に、描きなおす
  clearTimeout(state.sayTimer);
  if (next) state.sayTimer = setTimeout(() => { if (state.currentScreen === 'game') renderGame(); }, next - now + 30);
  return out;
}

function sendSay(index) {
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game || room.hostConnected === false) return;
  const who = state.picked;
  if (!movableSeats(room, game).includes(who)) return;
  const wait = state.sayAt + SAY_EVERY_MS - Date.now();
  if (wait > 0) {
    toast('ひとことは、5秒に1回までだよ（あと' + Math.ceil(wait / 1000) + '秒）', false);
    return;
  }
  state.sayAt = Date.now();
  $('sayPanel').hidden = true;
  $('btnSay').setAttribute('aria-expanded', 'false');
  const prev = String(room.play?.[game.id]?.say?.[who] || '');
  const count = (Number(prev.split('.')[1]) || 0) + 1;
  state.roomRef.child('play/' + game.id + '/say/' + who).set(index + '.' + count).catch((error) => {
    console.warn('[sorotte-goal] say failed', error);
    toast('送れなかったよ。通信を確かめてね');
  });
  window.RoomkStats?.count('say');
}

function renderSay(movable) {
  const btn = $('btnSay');
  const panel = $('sayPanel');
  btn.hidden = !movable.length;
  if (!movable.length) { panel.hidden = true; return; }
  if (!panel.childNodes.length) {
    panel.replaceChildren(...SAYS.map((text, i) => {
      const b = el('button', 'sg-saypanel__btn', text);
      b.type = 'button';
      b.addEventListener('click', () => sendSay(i));
      return b;
    }));
  }
}

// 説明の絵は、盤と同じ絵を小さく出す
function buildLegend(T) {
  const has = (ch) => T.tiles.includes(ch);
  // 説明の絵のスイッチ。同時におさえる数は、このステージの数を出す
  const sw = (pair) => {
    const node = art('sg-legend__ic sg-legend__ic--sw' + (pair ? ' sg-legend__ic--pair' : ''), ART.MARK.a);
    if (pair) node.dataset.need = String(Math.max(...Object.values(T.need)));
    return node;
  };
  const bridge = () => { const b = tint(el('span', 'sg-legend__ic sg-legend__ic--bridge'), 0); b.append(el('span', '', '1')); return b; };
  const items = [[art('sg-legend__ic', ART.FLAG), '全員が入るとクリア']];
  if (E.SWITCHES.some(has)) items.push([sw(false), 'スイッチ。乗っている間、同じしるしのとびらが開く']);
  if (Object.keys(T.need).length) items.push([sw(true), '数字の付いたスイッチは、その数だけ同時におさえる']);
  if (T.boxes.length) items.push([art('sg-legend__ic', ART.BOX), '重い箱。数字の人数が、たてにならんで押すと動く']);
  if (T.keys.length) items.push([art('sg-legend__ic', ART.KEY), 'カギ。持っていると、かぎつきのとびらを開けられる'], [art('sg-legend__ic', ART.LOCK), 'かぎつきのとびら']);
  if (E.BRIDGES.some(has)) items.push([bridge(), '橋。同じ番号の人だけ渡れる']);
  if (T.stars.length) items.push([art('sg-legend__ic', ART.GEM), '星。とった数がクリアのときに出る']);
  // すみのカギ・星の入口がとびらのとき（そのスイッチは、同じ部屋に1つだけある）
  if (E.SWITCHES.some((c) => !T.boxSw.includes(c) && T.tiles.filter((t) => t === c).length === 1)) items.push([sw(false), 'すみのカギや星は、1人がスイッチをおさえている間に、もう1人がとる']);
  $('legend').replaceChildren(...items.map(([pic, text]) => {
    const li = el('li');
    pic.setAttribute('aria-hidden', 'true');
    li.append(pic, document.createTextNode(text));
    return li;
  }));
}

// 進めなかったときの一言（なぜ進めないかを、その場で出す。自分の画面にだけ）
let tipTimer = 0;
function showTip(text) {
  const tip = $('tip');
  clearTimeout(tipTimer);
  if (!text) { tip.classList.remove('is-on'); return; }
  tip.textContent = text;
  tip.classList.add('is-on');
  tipTimer = setTimeout(() => tip.classList.remove('is-on'), 4500);
}
function whyBlocked(game, who, dx, dy) {
  const S = game.S;
  const T = E.staticOf(S.spec);
  const p = S.players[who];
  const tx = p.x + dx;
  const ty = p.y + dy;
  const t = E.tileAt(S, tx, ty);
  if (t === '#') return '';
  if (S.players.some((q, i) => i !== who && q.x === tx && q.y === ty)) return '';
  if (E.BRIDGE_OF[t] !== undefined) return 'この橋は、' + (E.BRIDGE_OF[t] + 1) + ' のコマ（' + game.seats[E.BRIDGE_OF[t]] + '）だけ渡れる。';
  if (E.SWITCH_OF[t]) {
    const c = E.SWITCH_OF[t];
    return T.need[c] > 1
      ? '「' + T.need[c] + '」のとびらは、同じしるし（' + MARK_NAME[c] + '）のスイッチを' + T.need[c] + 'つ同時におさえると開く。'
      : '同じしるし（' + MARK_NAME[c] + '）のスイッチに、だれかが乗ると開く。';
  }
  if (t === 'L') return 'カギを持っていると開けられる。';
  const bi = S.boxes.findIndex((b) => b[0] === tx && b[1] === ty);
  if (bi >= 0) {
    const team = T.team[bi] || 2;
    if (E.pushers(S, who, dx, dy, team)) return '箱の先がふさがっていて、押せない。';
    return team === 2 ? '重い箱は、うしろからもう1人が押すと動く。' : '「' + team + '」の箱は、' + team + '人がたてにならんで押すと動く。';
  }
  return '';
}

/* ── キーボード ── */
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
const WASD = { KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right' };
document.addEventListener('keydown', (event) => {
  if (state.currentScreen !== 'game' || !$('hostOffOverlay').hidden) return;
  if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
  // 文字を打つ欄・ボタンの上では、矢印キーをコマに使わない（ボタンは Enter・スペースで押せるように残す）
  const tag = event.target?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  const dir = ARROWS[event.key] || WASD[event.code];
  if (!dir) return;
  event.preventDefault();
  step(dir);
});

// Enter で送る（日本語入力の変換の確定は除く）
function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    handler();
  });
}

/* ── ボタン ── */
$('btnGoCreate').addEventListener('click', () => { setError('createError', ''); showScreen('create'); $('hostName').focus({ preventScroll: true }); });
$('btnGoJoin').addEventListener('click', () => { setError('joinError', ''); $('joinLinkHint').hidden = true; showScreen('join'); $('guestName').focus({ preventScroll: true }); });
$('btnGoWatch').addEventListener('click', () => { setError('watchError', ''); showScreen('watch-join'); $('watchCode').focus({ preventScroll: true }); });
['btnCreateBack', 'btnJoinBack', 'btnWatchBack', 'btnWatchEndTop'].forEach((id) => $(id).addEventListener('click', () => showScreen('top')));
$('btnCreateRoom').addEventListener('click', createRoom);
submitOnEnter($('hostName'), createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('guestName'), joinRoom);
submitOnEnter($('joinCode'), joinRoom);

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
$('btnOpenWatch').addEventListener('click', () => {
  if (state.role !== 'host' || !state.roomCode) return;
  // ポップアップブロックを避けるため、クリックの中で同期的に開く。noopener で元のタブと切り離す
  window.open(location.pathname + '?watch=' + state.roomCode, '_blank', 'noopener');
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);

$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('hostPlays').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, hostPlays: on })); });
$('btnStagePrev').addEventListener('click', () => saveSet((s) => ({ ...s, stage: s.stage <= 1 ? MAX_STAGE : s.stage - 1 })));
$('btnStageNext').addEventListener('click', () => saveSet((s) => ({ ...s, stage: (s.stage % MAX_STAGE) + 1 })));
$('btnStageRandom').addEventListener('click', () => { const n = 1 + Math.floor(Math.random() * MAX_STAGE); saveSet((s) => ({ ...s, stage: n })); });
$('btnStartGame').addEventListener('click', startGame);
$('btnNext').addEventListener('click', () => restartGame('next'));
$('btnAgain').addEventListener('click', () => restartGame('again'));
$('btnRetry').addEventListener('click', () => restartGame('again'));
$('btnSkip').addEventListener('click', () => restartGame('skip'));
$('btnLobby').addEventListener('click', backToLobby);
$('btnView').addEventListener('click', () => { state.near = !state.nearNow; camera(); });
$('btnSay').addEventListener('click', () => { const panel = $('sayPanel'); panel.hidden = !panel.hidden; $('btnSay').setAttribute('aria-expanded', panel.hidden ? 'false' : 'true'); });
PC_MQ.addEventListener?.('change', () => { $('pads').dataset.sig = ''; if (state.currentScreen === 'game') renderGame(); });
// 盤のコマを押して、動かすコマをえらぶ（ホストが、ほかの人のコマも動かせるとき）
$('board').addEventListener('click', (event) => {
  const node = event.target.closest('.sg-piece--player');
  if (node && node.dataset.seat != null) pickSeat(Number(node.dataset.seat));
});
window.addEventListener('resize', () => { if (state.currentScreen === 'game') camera(); });

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
