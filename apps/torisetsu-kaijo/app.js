/* とりせつ解除班
   ・ルーム: Realtime Database。遊ぶ2〜6人のうち1人が「解除する人」、ほかは「説明書を読む人」
   ・爆弾は、解除する人の端末にだけ出す（番号 seed から、どの端末でも同じ爆弾を作れるが、読む人の画面には描かない）
   ・説明書は、読む人の端末にだけ出す。進行だけのホスト・みんなにみせる画面（?watch=）には、のこり時間・まちがいの数・解除できた数だけ
   ルール（しかけ・説明書・時間）は engine.js、絵は art.js。効果音は、はじめは切（各自が入にする。この端末だけ）。

   あそんでいる間の書き込み: しかけの操作と、時間で起きること（導火線・時間切れ）は、解除する人が game への transaction で書く。
   解除する人がいないときの時間切れだけ、ホストが3秒おくれて代わりに書く。ひとことは say/ に1件ずつ足す。 */
const E = window.KaijoEngine;
const A = window.KaijoArt;

const MIN_SEATS = E.MIN_PLAYERS;
const MAX_SEATS = E.MAX_PLAYERS;
const DEFAULT_SET = { hostPlays: false, level: 'normal', slow: false, split: true };
// ひとこと（決まった言葉。データには番号を置く）
const SAYS = ['もう一回言って', 'ちょっと待って', 'わかった', 'そのページ持ってるよ', '持ってないよ', '見つけた', '見つからない', 'ちがうかも', 'ナイス！'];
const SAY_GAP_MS = 5000;     // ひとり5秒に1回まで
const SAY_SHOW_MS = 10000;   // 出しておく時間
const BOOM_MS = 2400;
const STRIKE_GUARD_MS = 800;
const CALM = window.matchMedia('(prefers-reduced-motion: reduce)');

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'torisetsukaijo_rooms';
const SESSION_KEY = 'torisetsukaijo_session';
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
  ro: false,           // 自分が「読むだけ」か（在室を書きなおすときに使う）
  currentScreen: null,
  timerInterval: null,
  orphanTimer: null,
  orphanAt: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  watchTimer: null,
  clockTimer: null,
  // 端末の中だけで持つ状態
  bombKey: '',
  bomb: null,
  viewKey: '',         // いま組み立ててある画面（対決の番号:見え方）
  seen: null,          // 前に見た進み具合（まちがい・解除・おわりの変化を見つける）
  zoom: null,          // 近くで見ている所（'s0'〜's5'・'left'・'right'・'top'・'bottom'）
  zoomKey: '',
  zoomFresh: false,
  fuseKey: '',
  clockKey: '',        // さいごに音を鳴らした時計の表示（回の番号:表示）
  litKey: '',          // さいごに見た導火線の火（回の番号:何回目）
  lidOpen: false,
  slotKeys: {},
  chapter: null,       // 読む人がひらいているページ
  pageKey: '',
  strikeAt: 0,         // さいごに、まちがいが増えた時刻（この端末の時計）
  strikeKey: '',       // そのときの操作
  lastAct: '',
  tickBusy: false,
  sayAt: 0,
  setKey: null,
  sendFailAt: 0,
  flashTimer: null,
  boomTimer: null,
  zoomTimer: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.tk-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  const inApp = id === 'waiting' || id === 'game';
  $('appBar').hidden = !inApp;
  $('roomBar').hidden = !inApp || !state.roomRef;
  if (id !== 'game') setPlayingLook(false, false);
  window.scrollTo(0, 0);
}

// 解除している間だけ: 暗い作業台の地にし、右下の丸ボタン（「？」とフィードバック）を出さない
function setPlayingLook(dark, hideFabs) {
  document.body.classList.toggle('tk-dark', dark);
  document.documentElement.classList.toggle('tk-dark-page', dark);
  document.documentElement.classList.toggle('tk-playing', hideFabs);
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

function btn(className, text, onClick) {
  const b = el('button', className, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

function icon(name, className) {
  const node = el('span', 'material-symbols-rounded' + (className ? ' ' + className : ''), name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

// art.js の決まった絵を入れる（利用者の入力は入らない）
function art(className, svg) {
  const node = el('span', className);
  node.innerHTML = svg;
  return node;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).sort((a, b) => a - b).map((k) => value[k]);
  return [];
}

/* ── 設定 ── */
function normSet(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    hostPlays: typeof s.hostPlays === 'boolean' ? s.hostPlays : DEFAULT_SET.hostPlays,
    level: E.LEVELS[s.level] ? s.level : DEFAULT_SET.level,
    slow: s.slow === true,
    split: typeof s.split === 'boolean' ? s.split : DEFAULT_SET.split,
  };
}
function levelNote(level, slow) {
  const L = E.LEVELS[level];
  const time = slow ? '時間をはからない' : Math.floor(L.sec / 60) + '分';
  return 'しかけ' + L.mods + 'つ・' + time + (L.fuse && !slow ? '・導火線あり' : '');
}
const settingSummary = (set) => 'むずかしさは「' + E.LEVELS[set.level].label + '」（' + levelNote(set.level, set.slow) + '）' + (set.split ? '・説明書は分けて配る' : '・説明書はみんなが全部読める');

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}
// 在室している人を参加順に（ホストもふくむ）
const memberNames = (room) => byJoined(Object.entries(room?.players || {}));
// 遊ぶ人に入れられる人（在室していて、匿名IDがある人）
const seatable = (room, name) => typeof name === 'string' && typeof room?.players?.[name]?.uid === 'string' && !!room.players[name].uid;
const isRo = (room, name) => room?.players?.[name]?.ro === true;

// 遊ぶ人（参加した順）。ホストは「ホストも遊ぶ」のときだけ
function seatList(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  return memberNames(room).filter((name) => hostPlays || name !== room.host).slice(0, MAX_SEATS);
}
// 遊ぶ人の名前（いる人。あそんでいる間は、通信が切れている人も数える）
function playerNames(room) {
  const hostPlays = normSet(room?.set).hostPlays;
  const names = new Set(Object.keys(room?.players || {}).filter((name) => hostPlays || name !== room.host));
  const game = room?.status === STATUS.PLAY ? gameOf(room) : null;
  if (game) game.seats.forEach((name) => names.add(name));
  return names;
}
const playerCount = (room) => playerNames(room).size;
const FULL_MESSAGE = 'このルームはいっぱいだよ（遊べるのは' + MAX_SEATS + '人まで）。見るだけなら、トップの「みんなにみせる画面をひらく」から見てね';

// いまの回を読む。こわれた値は読み飛ばす（null）
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const seats = asList(g.seats);
  const n = seats.length;
  if (n < MIN_SEATS || n > MAX_SEATS || !seats.every((x) => typeof x === 'string' && x) || new Set(seats).size !== n) return null;
  if (!Number.isInteger(g.def) || g.def < 0 || g.def >= n || !Number.isInteger(g.seed)) return null;
  const G = E.fromRoom(g);
  if (!G) return null;
  const id = Number(g.id) || 0;
  const level = E.LEVELS[g.level] ? g.level : 'normal';
  const slow = g.slow === true;
  if (slow) G.t = null;
  const key = id + ':' + g.seed + ':' + level + ':' + slow;
  if (state.bombKey !== key) {
    state.bombKey = key;
    state.bomb = E.makeBomb(g.seed, level, slow);
  }
  const uids = asList(g.uids);
  return { id, seed: g.seed, level, slow, split: g.split !== false, seats: seats.slice(), uids: seats.map((_, i) => (typeof uids[i] === 'string' ? uids[i] : '')), def: g.def, G, bomb: state.bomb };
}

/* ── 時間 ──
   のこり時間は、それぞれの端末が game/t から出す（1秒ごとの書き込みはしない）。
   ホストが切れている間は、切れた時刻で止める（戻ったときに、その分だけ時刻をずらす） */
function roomNow(room) {
  const now = RoomkRTDB.now();
  if (room && room.hostConnected === false) return RoomkRTDB.getHostDisconnectedAt(room) ?? now;
  return now;
}
function clockText(ms) {
  if (ms === null) return 'ゆっくり';
  const v = Math.max(0, ms);
  if (v < 10000) return '0:0' + (Math.floor(v / 100) / 10).toFixed(1);
  const s = Math.ceil(v / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// その席の人が、いまルームにいるか
function seatPresent(room, game, i) {
  const name = game.seats[i];
  const p = room?.players?.[name];
  return !!p && (!game.uids[i] || p.uid === game.uids[i]);
}
// この端末の人の席の番号（自分の端末で遊んでいる人だけ。なければ -1）
function selfSeat(game) {
  if (state.role !== 'host' && state.role !== 'guest') return -1;
  const uid = currentUid();
  return game.seats.findIndex((name, i) => name === state.nickname && game.uids[i] === uid);
}
const isHostHere = (room) => state.role === 'host' && room.hostUid === currentUid();
const readerSeats = (game) => game.seats.map((_, i) => i).filter((i) => i !== game.def);
// 席の名前。いまルームにいない人には印を付ける
const seatName = (room, game, i) => game.seats[i] + (seatPresent(room, game, i) ? '' : '（いまいない）');

// あそんでいる間は、遊んでいる人の名前を同じ人（匿名ID）だけが使える
function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAY) return false;
  return game.seats.some((x, i) => x === name && game.uids[i] && game.uids[i] !== uid);
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
    console.warn('[torisetsu-kaijo] expired room cleanup failed', error);
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
      ro: state.ro === true,
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
  ['cube', 'zoomBody', 'tabs', 'page', 'says', 'sayList', 'lobbyPeople', 'resultBox'].forEach((id) => $(id).replaceChildren());
  clearTimeout(state.flashTimer);
  clearTimeout(state.boomTimer);
  clearTimeout(state.zoomTimer);
  $('flash').hidden = true;
  $('boom').hidden = true;
  cube.stop();
  Object.assign(state, { bombKey: '', bomb: null, viewKey: '', seen: null, zoom: null, zoomKey: '', fuseKey: '', lidOpen: false, slotKeys: {}, chapter: null, pageKey: '', tickBusy: false, setKey: null, strikeAt: 0 });
  setPlayingLook(false, false);
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearInterval(state.clockTimer);
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
    ro: false,
    timerInterval: null,
    clockTimer: null,
    orphanTimer: null,
    orphanAt: null,
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
  $('hostOffText').textContent = '時間は止まっているよ。しばらく待っても戻らないときは退出してね。';
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
    console.warn('[torisetsu-kaijo] room listener failed', error);
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
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(tickClock, 100);
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
      // 手元の値で確かめてから、要る欄だけを書く（ルーム全体の transaction は、解除する人が書いている間は通りにくい）
      const room = state.room;
      if (room.hostUid === uid && !isExpired(room) && !(room.hostConnected === true && room.hostDisconnectedAt == null)) {
        const back = { hostConnected: true, hostDisconnectedAt: null };
        // 切れていた間は時計を止めていたので、その分だけ、はじめた時刻とのこり時間の時刻をずらす
        const game = room.status === STATUS.PLAY ? gameOf(room) : null;
        const at = room.hostConnected === false ? RoomkRTDB.getHostDisconnectedAt(room) : null;
        if (game && at != null && !game.G.out) {
          const gap = Math.max(0, RoomkRTDB.now() - at);
          back['game/startAt'] = game.G.startAt + gap;
          if (game.G.t) back['game/t/at'] = game.G.t.at + gap;
        }
        await ref.update(back);
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
        if (nickname === room.host || reservedByOther(room, nickname, uid)) taken = true;
        // 戻るときは参加したときの順番のまま。あそんでいる途中の、自分の席がある人は人数の上限を見ない
        else if (!seated && playerCount(room) >= MAX_SEATS) full = true;
        else {
          const mine = { isHost: false, uid, joinedAt };
          if (state.ro) mine.ro = true;
          const result = await ref.child('players/' + nickname).transaction((cur) => (cur ? undefined : mine));
          if (!result.committed && result.snapshot.val()?.uid !== uid) taken = true;
        }
      }
      if ((full || taken) && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(full ? FULL_MESSAGE : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
      }
    }
  } catch (error) {
    console.warn('[torisetsu-kaijo] presence recovery failed', error);
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
          turn: 0,
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
    console.warn('[torisetsu-kaijo] create failed', err);
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
    const fail = (message) => setError('joinError', message);
    const room = initial;
    const stale = room.players?.[nickname];
    // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
    const mine = !!stale && !stale.isHost && stale.uid === uid;
    if (nickname === room.host || (stale && !mine) || reservedByOther(room, nickname, uid)) {
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
    const record = { isHost: false, uid, joinedAt: rejoinAt || joinedAt };
    if (mine && stale.ro === true) record.ro = true;
    // 同じ名前の人が同時に入っていたら、先に書いた人のもの（同じ匿名IDなら、自分の入りなおし）
    const result = await transactRetry(ref.child('players/' + nickname), (cur) => (cur && cur.uid !== uid ? undefined : record));
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
    console.warn('[torisetsu-kaijo] join failed', err);
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
    if (saved.role === 'guest') state.ro = room.players?.[saved.nickname] ? room.players[saved.nickname].ro === true : saved.ro === true;
    return true;
  } catch (error) {
    console.warn('[torisetsu-kaijo] reconnect failed', error);
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
      // 自分の在室だけを消す。ほかの匿名IDの人がその名前で在室しているときは触らない
      await ref.child('players/' + nickname).transaction((cur) => (cur && cur.uid === uid ? null : undefined));
    }
  } catch (error) {
    console.warn('[torisetsu-kaijo] leave failed', error);
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
    console.warn('[torisetsu-kaijo] watch failed', error);
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
  state.clockTimer = setInterval(tickClock, 100);
  // 共有するタブ・ウィンドウを選ぶときに見分けられるよう、題名と見出しを変える
  document.title = 'みんなにみせる画面 | とりせつ解除班 | あそびのたな';
  document.body.classList.add('is-watch');
  $('watchBadge').hidden = false;
  state.roomCode = code;
  state.roomRef = ref;
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = 'トップへ戻る';
  $('btnOpenWatch').hidden = true;
  $('hostOffText').textContent = '時間は止まっているよ。しばらく待っても戻らないときは、トップへ戻ってね。';
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
    console.warn('[torisetsu-kaijo] watch listener failed', error);
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
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null, clockTimer: null });
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

/* ── ホストの操作（待合室の、ルーム全体への transaction。だれも遊んでいない間だけ） ── */
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
    console.warn('[torisetsu-kaijo] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

// 設定は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない（中で今の値から作りなおす）
async function saveSet(change) {
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== STATUS.WAITING) return;
    const cur = normSet(room.set);
    const next = normSet(change({ ...cur }));
    // ホストを遊ぶ人に入れるときは、6人をこえないか確かめる
    if (next.hostPlays && !cur.hostPlays && playerCount(room) >= MAX_SEATS) { reason = '遊べるのは' + MAX_SEATS + '人までだよ'; return; }
    return { ...room, set: next };
  }, '設定を変えられませんでした。もう一度ためしてね', false);
  if (ok === false && reason) toast(reason, false);
  if (!ok && state.room) {
    state.setKey = null;
    renderRoom(state.room);
  }
}

// 「読むだけ」の印を付け外しする（本人か、ホストが）。いなくなった人の所に印だけを作らないよう、いる人にだけ書く
async function setRo(name, on) {
  const ref = state.roomRef;
  if (!ref || state.room?.status !== STATUS.WAITING) return;
  if (name !== state.nickname && state.role !== 'host') return;
  try {
    await ref.child('players/' + name).transaction((cur) => {
      if (!cur) return;
      const next = { ...cur };
      if (on) next.ro = true;
      else delete next.ro;
      return next;
    });
  } catch (error) {
    console.warn('[torisetsu-kaijo] ro failed', error);
    toast('変えられませんでした。もう一度ためしてね');
    if (state.room) renderRoom(state.room);
  }
}

// いま遊ぶ人たちで新しい回を作る（人数がそろわない・解除する人がいなければ null）
function newGameFor(room, seats) {
  if (seats.length < MIN_SEATS || seats.length > MAX_SEATS || new Set(seats).size !== seats.length) return null;
  if (!seats.every((name) => seatable(room, name))) return null;
  const turn = Number(room.turn) || 0;
  const def = E.pickDefuser(seats.map((name) => isRo(room, name)), turn);
  if (def < 0) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const set = normSet(room.set);
  const now = RoomkRTDB.now();
  const game = {
    id, seed: Math.floor(Math.random() * 2147483647) + 1, level: set.level, slow: set.slow, split: set.split,
    seats: seats.slice(), uids: seats.map((name) => room.players[name].uid), def,
    ...E.toRoom(E.newState(set.level, set.slow, now)),
  };
  return { game, turn: turn + 1 };
}
function countStart(game) {
  window.RoomkStats?.count('start');
  window.RoomkStats?.count('players-' + game.seats.length);
  window.RoomkStats?.count('level-' + game.level);
  if (game.slow) window.RoomkStats?.count('slow');
}
const START_FAIL = '遊ぶ人が2人そろっていないか、みんなが「読むだけ」になっているよ';

async function startGame() {
  let made = null;
  const ok = await hostTransaction((room) => {
    made = null;
    // データがこわれて play のまま残ったときも、待合室の画面から始めなおせるようにする
    if (room.status !== STATUS.WAITING && !(room.status === STATUS.PLAY && !gameOf(room))) return;
    made = newGameFor(room, seatList(room));
    if (!made) return;
    return { ...room, status: STATUS.PLAY, lastGameId: made.game.id, turn: made.turn, game: made.game, say: null };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok && made) countStart(made.game);
  else if (ok === false) toast(START_FAIL);
}

// もう一回: いま参加している人で遊ぶ人を決めなおし、解除する人を交代する
async function againGame() {
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  const room = state.room;
  const cur = gameOf(room);
  if (!cur || !cur.G.out || room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  const made = newGameFor(room, seatList(room));
  if (!made) {
    toast(START_FAIL + '。「待合室へ」で確かめてね');
    return;
  }
  state.busy = true;
  try {
    // ほかの人と取り合いにならない（回を作りなおせるのはホストだけ）ので、要る欄だけをまとめて書く
    await state.roomRef.update({ lastGameId: made.game.id, turn: made.turn, game: made.game, say: null });
    window.RoomkStats?.count('again');
    countStart(made.game);
  } catch (error) {
    console.warn('[torisetsu-kaijo] again failed', error);
    toast('はじめられませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

async function backToLobby() {
  const room = state.room;
  const game = gameOf(room);
  if (game && !game.G.out && !window.confirm('この回をやめて、待合室にもどる？')) return;
  if (state.busy || state.role !== 'host' || !state.roomRef) return;
  if (room.hostUid !== currentUid() || room.status !== STATUS.PLAY) return;
  state.busy = true;
  try {
    await state.roomRef.update({ status: STATUS.WAITING, game: null, say: null });
  } catch (error) {
    console.warn('[torisetsu-kaijo] back to lobby failed', error);
    toast('もどれませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

/* ── あそんでいる間の書き込み ── */
function writeFailed(error, message) {
  console.warn('[torisetsu-kaijo] write failed', error);
  // 続けて失敗しても、知らせるのは5秒に1回まで
  if (Date.now() - state.sendFailAt > 5000) {
    state.sendFailAt = Date.now();
    toast(message || '送れなかったよ。通信を確かめてね');
  }
}
// いまの回と、操作できるか（ホストが切れている間は、だれも書かない）
function liveGame() {
  const room = state.room;
  // 自分の通信が切れている間も書かない（切れている間の操作が、戻ったときにまとめて届かないように）
  if (!room || !state.roomRef || !state.isConnected || room.hostConnected === false || room.status !== STATUS.PLAY) return null;
  const game = gameOf(room);
  return game && !game.G.out ? { room, game } : null;
}
function countFinish(G) {
  window.RoomkStats?.count('finish');
  window.RoomkStats?.count(G.out === 'safe' ? 'safe' : 'boom-' + (G.why || 'strike'));
}

// 進み具合を書きかえる（change は engine の act か tick。同じ回・まだ終わっていないときだけ）
async function commitGame(game, change) {
  let done = null;
  const result = await state.roomRef.child('game').transaction((cur) => {
    done = null;
    if (!cur || Number(cur.id) !== game.id || cur.out) return;
    const G = E.fromRoom(cur);
    if (!G) return;
    if (game.slow) G.t = null;
    const res = change(G);
    if (!res) return;
    done = res.G;
    return Object.assign({}, cur, E.toRoom(res.G));
  });
  if (result.committed && done && done.out) countFinish(done);
}

// 解除する人の操作。続けて押しても順番どおりに書く
// 確定を待たずに順に始める（同じ場所への transaction は、SDK が順番どおりに、前の結果の上で計算する。待つと表示が1往復ずつ遅れる）
function act(a) {
  const live = liveGame();
  if (!live || selfSeat(live.game) !== live.game.def) return;
  // まちがいになった操作を、すぐにもう一度押しても受けない（二度押しで、まちがいが2回つかないように）
  const key = a.s + ':' + a.k + ':' + (a.v ?? '');
  if (key === state.strikeKey && Date.now() - state.strikeAt < STRIKE_GUARD_MS) return;
  state.lastAct = key;
  playSfx(a.k === 'cut' ? 'cut' : 'press');
  const now = roomNow(live.room);
  commitGame(live.game, (G) => E.act(live.game.bomb, G, a, now))
    .catch((error) => writeFailed(error, '押せなかったよ。もう一度ためしてね'));
}

// 時間で起きること（導火線がまにあわない・時間が0）。解除する人が書く。いないときは、ホストが3秒おくれて書く
function tickGame(room, game) {
  if (state.tickBusy || game.G.out || !state.isConnected || room.hostConnected === false) return;
  if (state.role !== 'host' && state.role !== 'guest') return;
  const mine = selfSeat(game) === game.def;
  const backup = !mine && isHostHere(room);
  if (!mine && !backup) return;
  const now = roomNow(room);
  const check = backup ? now - 3000 : now;
  if (!E.tick(game.bomb, game.G, check)) return;
  state.tickBusy = true;
  commitGame(game, (G) => (E.tick(game.bomb, G, check) ? E.tick(game.bomb, G, now) : null))
    .catch((error) => console.warn('[torisetsu-kaijo] tick failed', error))
    .finally(() => { state.tickBusy = false; });
}

// ひとこと（決まった言葉）と、説明書の1行を送る。ひとり5秒に1回まで
function sendSay(payload) {
  const live = liveGame();
  if (!live || selfSeat(live.game) < 0) return;
  const wait = SAY_GAP_MS - (Date.now() - state.sayAt);
  if (wait > 0) {
    toast('ひとことは5秒に1回までだよ（あと' + Math.ceil(wait / 1000) + '秒）', false);
    return;
  }
  state.sayAt = Date.now();
  state.roomRef.child('say').push({ f: state.nickname, g: live.game.id, at: serverTimestamp(), ...payload })
    .catch((error) => writeFailed(error));
}

/* ── 効果音（2026-11-27 オーナー依頼「音もつくってください」）──
   はじめは「切」。待合室と解除の画面の「効果音」で、各自が「入」にする（みんなにみせる画面でも入にできる。オーナー選択）。
   この端末だけで鳴り、設定は端末に残す（localStorage torisetsukaijo:sfx。ルームには書かない）。音は Web Audio の合成音だけ（ファイルは読まない）。
   まちがい・爆発でも鳴らす（オーナー選択。だれのまちがいかは、音でも出さない）。大きさは小さめで固定（SFX_GAIN） */
const SFX_KEY = 'torisetsukaijo:sfx';
const SFX_GAIN = 0.2;
const sfx = { on: false, ac: null, out: null, noise: null, log: [] };
try { sfx.on = localStorage.getItem(SFX_KEY) === '1'; } catch (e) { /* 使えなければ切のまま */ }

function ensureAudio() {
  if (!sfx.on) return;
  try {
    if (!sfx.ac) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      sfx.ac = new AC({ latencyHint: 'interactive' });
      sfx.out = sfx.ac.createGain();
      sfx.out.gain.value = SFX_GAIN;
      sfx.out.connect(sfx.ac.destination);
    }
    if (sfx.ac.state !== 'running') sfx.ac.resume().catch(() => {});
  } catch (e) { /* 鳴らせなくても遊べる */ }
}

// 短い音を1つ（when は今からの秒。to があれば、その高さへすべらせる）
function tone(freq, when, level, decay, type = 'sine', to = 0) {
  const ac = sfx.ac;
  const t = ac.currentTime + when;
  const o = ac.createOscillator();
  const gn = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + decay);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(level, t + 0.005);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  o.connect(gn).connect(sfx.out);
  o.start(t);
  o.stop(t + decay + 0.02);
}

// ざらっとした音を1つ（コードを切る・火・爆発。from から to へ、通す高さをすべらせる）
function hiss(when, level, decay, kind, from, to = 0) {
  const ac = sfx.ac;
  if (!sfx.noise) {
    sfx.noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = sfx.noise.getChannelData(0);
    for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  }
  const t = ac.currentTime + when;
  const src = ac.createBufferSource();
  const f = ac.createBiquadFilter();
  const gn = ac.createGain();
  src.buffer = sfx.noise;
  f.type = kind;
  f.frequency.setValueAtTime(from, t);
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + decay);
  gn.gain.setValueAtTime(0.0001, t);
  gn.gain.exponentialRampToValueAtTime(level, t + 0.008);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  src.connect(f).connect(gn).connect(sfx.out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + decay + 0.02);
}

const arp = (notes, gap, level, decay) => notes.forEach((f, i) => { tone(f, i * gap, level, decay); tone(f * 2, i * gap, level * 0.2, decay * 0.6, 'triangle'); });
// 音の名前ごとの合成音
const SYNTH = {
  tick: () => tone(1000, 0, 0.1, 0.03, 'triangle'),                                        // 時計（1秒ごと）
  hurry: () => { tone(1320, 0, 0.16, 0.04, 'triangle'); tone(1320, 0.12, 0.1, 0.03, 'triangle'); },  // のこり30秒から
  press: () => tone(520, 0, 0.16, 0.05, 'triangle', 420),                                  // スイッチ・ダイヤル・やじるし・たしかめる
  cut: () => { hiss(0, 0.4, 0.05, 'highpass', 3000); tone(300, 0, 0.14, 0.06, 'triangle', 180); },    // コードを切る
  solved: () => arp([659, 880, 1175], 0.07, 0.32, 0.25),                                   // しかけを解除
  fuse: () => { hiss(0, 0.3, 0.45, 'bandpass', 900, 4200); tone(880, 0.05, 0.2, 0.1, 'triangle'); tone(880, 0.22, 0.2, 0.1, 'triangle'); },  // 導火線に火がついた
  fuseok: () => { hiss(0, 0.3, 0.3, 'bandpass', 3800, 500); tone(660, 0.1, 0.2, 0.18); },  // 導火線を止めた
  strike: () => { tone(150, 0, 0.45, 0.24, 'triangle', 100); tone(150, 0, 0.1, 0.2, 'square', 100); },  // まちがい（低く短い）
  boom: () => { hiss(0, 0.5, 0.7, 'lowpass', 900, 120); tone(90, 0, 0.5, 0.6, 'sine', 42); },          // 爆発（やわらかい「ぼふん」）
  safe: () => { arp([523, 659, 784], 0.11, 0.34, 0.3); tone(1047, 0.33, 0.4, 0.6); tone(1568, 0.33, 0.12, 0.5, 'triangle'); },  // 解除成功
};

// 音を1つ鳴らす
function playSfx(name) {
  if (!sfx.on || !sfx.ac || sfx.ac.state !== 'running' || !SYNTH[name]) return;
  try {
    SYNTH[name]();
    sfx.log.push(name);
    if (sfx.log.length > 200) sfx.log.shift();
  } catch (e) { /* 鳴らせなくても遊べる */ }
}

function renderSfxSegs() {
  document.querySelectorAll('[data-sfx-seg]').forEach((box) => seg(box, [['off', '切'], ['on', '入']], sfx.on ? 'on' : 'off', (v) => setSfx(v === 'on')));
}

function setSfx(on) {
  if (sfx.on === on) return;
  sfx.on = on;
  try { localStorage.setItem(SFX_KEY, on ? '1' : '0'); } catch (e) { /* 残せなくてもよい */ }
  renderSfxSegs();
  if (on) {
    ensureAudio();
    // 入にしたら、どんな音か1回だけ聞かせる
    setTimeout(() => playSfx('solved'), 60);
  }
}

/* ── 画面の更新 ── */
function handleRoom(room) {
  if (state.role === 'guest') {
    const me = room.players?.[state.nickname];
    if (me && me.uid !== currentUid()) {
      leaveLocally('同じ名前の人が参加したので、ルームから外れました');
      return;
    }
    // 「読むだけ」は再読み込みでも残るよう、記録にも入れる（在室を書きなおすときに付けなおす）
    if (me && state.ro !== (me.ro === true)) { state.ro = me.ro === true; saveSession(); }
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
  else {
    state.viewKey = '';
    renderWaiting(room);
  }
}

function updateHostOverlay(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす
    if (state.orphanTimer && state.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(state.orphanTimer); state.orphanTimer = null; }
    if (!state.orphanTimer) {
      state.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
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
    const seat = game ? selfSeat(game) : seatList(room).indexOf(state.nickname);
    me = (state.role === 'host' ? 'ホスト' : state.nickname)
      + (seat >= 0 ? '' : state.role === 'host' ? '・進行だけ' : game ? '・この回は見る番' : '');
  }
  $('barMe').hidden = !me;
  $('barMe').textContent = me;
}

function seg(box, options, value, onPick) {
  box.replaceChildren(...options.map(([v, label]) => {
    const b = btn('tk-seg__btn' + (v === value ? ' is-on' : ''), label, () => onPick(v));
    b.setAttribute('aria-pressed', v === value ? 'true' : 'false');
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

  const others = memberNames(room).filter((name) => !seats.includes(name));
  const next = E.pickDefuser(seats.map((name) => isRo(room, name)), Number(room.turn) || 0);
  const ready = seats.length >= MIN_SEATS && next >= 0 && seats.every((name) => seatable(room, name));
  let note = '';
  if (host && seats.length < MIN_SEATS) note = '2人からはじめられるよ。だれかが入るのを待つか、2人で遊ぶときは「ホストも遊ぶ」をオンにしてね';
  else if (host && next < 0) note = 'みんなが「読むだけ」になっているよ。だれか1人は、解除する人になれるようにしてね';
  $('seatNote').textContent = note;
  $('seatNote').hidden = !note;
  const row = (name, si) => {
    const li = el('li', 'tk-person');
    li.append(icon(si >= 0 ? 'person' : 'visibility'));
    li.append(el('span', 'tk-person__name', name));
    if (name === room.host) li.append(el('span', 'tk-chip tk-chip--muted', si >= 0 ? 'ホスト' : 'ホスト（進行だけ）'));
    if (name === state.nickname && !watch) li.append(el('span', 'tk-chip tk-chip--you', 'あなた'));
    if (si >= 0 && si === next) li.append(el('span', 'tk-chip', 'つぎに解除する人'));
    if (si >= 0 && isRo(room, name)) li.append(el('span', 'tk-chip tk-chip--muted', '読むだけ'));
    if (host && si >= 0 && name !== state.nickname) {
      const on = isRo(room, name);
      const b = btn('btn btn-ghost btn-sm tk-person__act', on ? '読むだけをやめる' : '読むだけにする', () => setRo(name, !on));
      b.dataset.name = name;
      li.append(b);
    }
    return li;
  };
  $('lobbyPeople').replaceChildren(...seats.map((name, i) => row(name, i)), ...others.map((name) => row(name, -1)));
  $('peopleCount').textContent = seats.length + '人';
  const seated = !watch && seats.includes(state.nickname);
  $('roBox').hidden = !seated;
  if (seated) $('roSelf').checked = isRo(room, state.nickname);
  $('hostPlaysBox').hidden = !host;
  if (host) $('hostPlays').checked = set.hostPlays;

  $('lobbySet').hidden = !host;
  $('lobbySetView').hidden = host;
  if (host) {
    const key = set.level + ':' + set.slow + ':' + set.split;
    if (state.setKey !== key) {
      state.setKey = key;
      seg($('levelSeg'), E.LEVEL_KEYS.map((k) => [k, E.LEVELS[k].label]), set.level, (v) => saveSet((s) => ({ ...s, level: v })));
      $('levelNote').textContent = levelNote(set.level, set.slow);
      $('setSlow').checked = set.slow;
      $('setSplit').checked = set.split;
    }
  } else {
    $('lobbySetView').textContent = settingSummary(set);
  }

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

/* ── 解除の画面 ── */
const FACE_LABEL = { front: '表', back: '裏', left: '左の側面', right: '右の側面', top: '上の面', bottom: '底の面' };
const SLOT_POS = ['左', 'まん中', '右'];
const slotLabel = (i) => (i < 3 ? '表' : '裏') + 'の' + SLOT_POS[i % 3];
const colorName = (c) => E.COLOR[c];

function lamps(node, x) {
  node.replaceChildren();
  for (let i = 0; i < E.MAX_STRIKES; i++) node.append(el('span', 'tk-lampx' + (i < x ? ' is-on' : '')));
  node.setAttribute('aria-label', 'まちがい ' + x + '回（3回で爆発）');
}

function flash(text, good) {
  const node = $('flash');
  node.textContent = text;
  node.className = 'tk-flash' + (good ? ' is-good' : ' is-bad');
  node.hidden = false;
  clearTimeout(state.flashTimer);
  state.flashTimer = setTimeout(() => { node.hidden = true; }, 1400);
}

function showBoom() {
  const node = $('boom');
  if (!$('boomArt').firstChild) $('boomArt').innerHTML = A.burst();
  node.hidden = false;
  node.classList.toggle('is-calm', CALM.matches);
  clearTimeout(state.boomTimer);
  state.boomTimer = setTimeout(() => { node.hidden = true; }, BOOM_MS);
}

function renderGame() {
  const room = state.room;
  const game = gameOf(room);
  if (!room || !game) return;
  const me = selfSeat(game);
  const view = me < 0 ? 'board' : me === game.def ? 'def' : 'read';
  const solved = E.solvedCount(game.bomb, game.G);
  const key = game.id + ':' + view;
  if (state.viewKey !== key) {
    state.viewKey = key;
    Object.assign(state, { zoom: null, zoomKey: '', lidOpen: false, slotKeys: {}, chapter: null, pageKey: '' });
    $('viewDef').hidden = view !== 'def';
    $('viewRead').hidden = view !== 'read';
    $('viewBoard').hidden = view !== 'board';
    $('hud').hidden = view === 'board';
    $('boom').hidden = true;
    // 役が入れかわったら、前の役の画面の中身（爆弾・説明書）を残さない
    if (view !== 'def') { cube.stop(); cube.faces = {}; ['cube', 'zoomBody'].forEach((id) => $(id).replaceChildren()); }
    if (view !== 'read') ['tabs', 'page'].forEach((id) => $(id).replaceChildren());
    if (view === 'def') buildCube(game);
    buildSayBox(view);
    // はじめて開いたとき（読み込み直しなど）は、前の変化を出さない
    state.seen = { x: game.G.x, ok: solved, fz: game.G.fz, out: game.G.out };
  }

  // 変化を知らせる（まちがい・解除・導火線・おわり）
  const seen = state.seen;
  if (game.G.out && !seen.out) {
    if (game.G.out === 'boom') showBoom();
    else flash('解除成功！', true);
    playSfx(game.G.out === 'boom' ? 'boom' : 'safe');
  } else if (game.G.x > seen.x) {
    state.strikeAt = Date.now();
    state.strikeKey = state.lastAct;
    flash('まちがい！', false);
    playSfx('strike');
    if (!CALM.matches) {
      const target = view === 'board' ? $('viewBoard') : $('gameMain');
      target.classList.remove('is-shake');
      void target.offsetWidth;
      target.classList.add('is-shake');
    }
  } else if (solved > seen.ok) { flash('しかけを解除！', true); playSfx('solved'); }
  else if (game.G.fz > seen.fz) { flash('導火線を止めた', true); playSfx('fuseok'); }
  state.seen = { x: game.G.x, ok: solved, fz: game.G.fz, out: game.G.out };

  const total = E.regularSlots(game.bomb).length;
  if (view === 'board') {
    $('boardWho').textContent = '解除する人: ' + seatName(room, game, game.def);
    lamps($('boardLamps'), game.G.x);
    $('boardSolved').textContent = 'しかけ ' + solved + ' / ' + total + ' を解除';
    $('boardReaders').textContent = '説明書を読む人: ' + readerSeats(game).map((i) => seatName(room, game, i)).join('・');
  } else {
    $('hudRole').textContent = view === 'def' ? 'あなたは 解除する人' : 'あなたは 説明書を読む人（解除する人: ' + seatName(room, game, game.def) + '）';
    lamps($('hudLamps'), game.G.x);
    $('hudSolved').textContent = 'しかけ ' + solved + ' / ' + total;
  }
  if (view === 'def') updateDef(game);
  if (view === 'read') updateRead(game, me);
  setPlayingLook(view === 'def', view === 'def' && !game.G.out);
  $('sayBox').hidden = view === 'board' || !!game.G.out;
  renderResult(room, game, solved, total);
  const host = isHostHere(room);
  $('hostMenu').hidden = !host || !!game.G.out;
  if (game.G.out) $('hostMenu').open = false;
  tickClock();
}

// 時間で変わる所（のこり時間・導火線・ひとことの消える時刻）
function tickClock() {
  const room = state.room;
  if (!room || room.status !== STATUS.PLAY || state.currentScreen !== 'game') return;
  const game = gameOf(room);
  if (!game) return;
  const now = roomNow(room);
  const left = E.leftMs(game.G, now);
  const text = clockText(left);
  const hurry = left !== null && left <= 30000 && !game.G.out;
  // 時計の音（表示の秒が変わったとき。同じ回の中だけ・終わったら鳴らさない・ホストが切れて止まっている間は変わらないので鳴らない）
  const clockKey = game.id + ':' + text;
  if (state.clockKey !== clockKey) {
    const same = state.clockKey.startsWith(game.id + ':');
    state.clockKey = clockKey;
    if (same && left !== null && left > 0 && !game.G.out) playSfx(hurry ? 'hurry' : 'tick');
  }
  ['hudTime', 'boardTime', 'bombTime'].forEach((id) => {
    const node = $(id);
    if (!node) return;
    if (node.textContent !== text) node.textContent = text;
    node.classList.toggle('is-hurry', hurry);
    node.classList.toggle('is-slow', left === null);
  });
  const me = selfSeat(game);
  const f = E.fuseInfo(game.bomb, game.G, now);
  $('fuseBar').hidden = !f;
  // 導火線に火がついた音（ついてすぐのときだけ。途中でひらいた画面では鳴らさない）
  const litKey = f ? game.id + ':' + f.k : '';
  if (state.litKey !== litKey) {
    state.litKey = litKey;
    if (f && f.left > E.FUSE_WINDOW - 2500) playSfx('fuse');
  }
  if (f) {
    const secs = Math.ceil(f.left / 1000);
    const t = '導火線に火がついた！ あと' + secs + '秒';
    if ($('fuseText').textContent !== t) $('fuseText').textContent = t;
    $('btnFuseGo').hidden = me !== game.def || state.zoom === E.keyOf(game.bomb.fuse.slot);
  }
  if (me === game.def) {
    // 火がついた・消えたときは、導火線の絵を描きなおす
    const fk = f ? f.k + ':' + f.flame : '';
    if (state.fuseKey !== fk) { state.fuseKey = fk; updateDef(game); }
    document.querySelectorAll('[data-fuse-fill]').forEach((node) => { node.style.width = (f ? Math.max(0, f.left / E.FUSE_WINDOW) * 100 : 0) + '%'; });
  }
  renderSays(room, game);
  tickGame(room, game);
}

function renderResult(room, game, solved, total) {
  const box = $('resultBox');
  const G = game.G;
  box.hidden = !G.out;
  const key = game.id + ':' + G.out + ':' + isHostHere(room);
  if (!G.out) { box.dataset.key = ''; return; }
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  box.className = 'tk-result ' + (G.out === 'safe' ? 'is-safe' : 'is-boom');
  if (G.out === 'safe') {
    box.append(el('h2', 'tk-result__title', '解除成功！'));
    const left = E.leftMs(G, 0);
    box.append(el('p', 'tk-result__text', (left === null ? '' : 'のこり時間 ' + clockText(Math.ceil(left / 1000) * 1000) + '・') + 'まちがい ' + G.x + '回。みんなで止められた。'));
  } else {
    box.append(el('h2', 'tk-result__title', 'ドカーン！'));
    box.append(el('p', 'tk-result__text', (G.why === 'time' ? '時間が0になった。' : 'まちがいが3回になった。') + 'しかけは ' + solved + ' / ' + total + ' まで解除できていた。もう一回やってみよう。'));
  }
  if (isHostHere(room)) {
    const next = E.pickDefuser(seatList(room).map((name) => isRo(room, name)), Number(room.turn) || 0);
    const who = next >= 0 ? seatList(room)[next] : '';
    if (who) box.append(el('p', 'tk-result__next', 'つぎに解除する人: ' + who));
    const actions = el('div', 'tk-result__actions');
    actions.append(btn('btn btn-primary btn-lg btn-full', 'もう一回（解除する人を交代）', againGame));
    actions.append(btn('tk-quiet tk-quiet--center', '待合室へ（遊ぶ人・設定を選びなおす）', backToLobby));
    box.append(actions);
  } else if (state.role !== 'spectator') {
    box.append(el('p', 'tk-result__next', 'ホストが次を決めるのを待っているよ'));
  }
}

/* ── ひとこと ── */
function buildSayBox(view) {
  const list = $('sayList');
  list.replaceChildren();
  if (view === 'board') return;
  SAYS.forEach((text, k) => {
    const b = btn('tk-saybtn', text, () => sendSay({ k }));
    b.dataset.k = String(k);
    list.append(b);
  });
}

function renderSays(room, game) {
  const now = RoomkRTDB.now();
  const items = [];
  Object.entries(room.say && typeof room.say === 'object' ? room.say : {}).forEach(([id, v]) => {
    if (!v || typeof v !== 'object' || v.g !== game.id) return;
    const at = Number(v.at) || 0;
    const seat = game.seats.indexOf(v.f);
    if (seat < 0 || now - at > SAY_SHOW_MS) return;
    let text = '';
    if (Number.isInteger(v.k) && SAYS[v.k]) text = SAYS[v.k];
    else if (typeof v.c === 'string' && Number.isInteger(v.l) && seat !== game.def) {
      const line = E.lineText(v.c, v.l);
      if (line) text = '説明書「' + E.manual(v.c).title + '」 ' + line;
    }
    if (text) items.push({ id, at, from: v.f, text });
  });
  items.sort((a, b) => a.at - b.at);
  const show = items.slice(-3);
  const key = show.map((x) => x.id).join(',');
  const box = $('says');
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren(...show.map((x) => {
    const li = el('li', 'tk-say');
    li.append(el('span', 'tk-say__from', x.from), el('span', 'tk-say__text', x.text));
    return li;
  }));
}

/* ── 解除する人: 回せる爆弾 ──
   6つの面を箱に組み、箱ごと回す（CSS の 3D 変形）。向きは四元数で持つ。
   面の上のしかけ・手がかりはボタンで、押すと近くで見る欄がひらく。 */
const FACES = ['front', 'back', 'right', 'left', 'top', 'bottom'];
const NORMAL = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, -1, 0], bottom: [0, 1, 0] };
const qmul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qaxis = (x, y, z, ang) => { const s = Math.sin(ang / 2); return [Math.cos(ang / 2), x * s, y * s, z * s]; };
const qnorm = (q) => { const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1; return q.map((v) => v / n); };
function qmat(q) {
  const [w, x, y, z] = q;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}
function matq(m) {
  const tr = m[0][0] + m[1][1] + m[2][2];
  let q;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s];
  } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    q = [(m[2][1] - m[1][2]) / s, s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s];
  } else if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    q = [(m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s];
  } else {
    const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
    q = [(m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4];
  }
  return qnorm(q);
}
function slerp(a, b, t) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bb = b;
  if (dot < 0) { dot = -dot; bb = b.map((v) => -v); }
  if (dot > 0.9995) return qnorm(a.map((v, i) => v + (bb[i] - v) * t));
  const th = Math.acos(Math.min(1, dot));
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return a.map((v, i) => v * wa + bb[i] * wb);
}
// いちばん近い「まっすぐな向き」（軸に沿った24通りのどれか）
function snapQ(q) {
  const m = qmat(q);
  const out = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const rows = [0, 1, 2];
  const cols = [0, 1, 2];
  while (rows.length) {
    let best = null;
    rows.forEach((i) => cols.forEach((j) => { if (!best || Math.abs(m[i][j]) > Math.abs(m[best[0]][best[1]])) best = [i, j]; }));
    out[best[0]][best[1]] = m[best[0]][best[1]] < 0 ? -1 : 1;
    rows.splice(rows.indexOf(best[0]), 1);
    cols.splice(cols.indexOf(best[1]), 1);
  }
  // 鏡写しになったら（丸めのずれ）、1列を反転して回転にもどす
  const det = out[0][0] * (out[1][1] * out[2][2] - out[1][2] * out[2][1]) - out[0][1] * (out[1][0] * out[2][2] - out[1][2] * out[2][0]) + out[0][2] * (out[1][0] * out[2][1] - out[1][1] * out[2][0]);
  if (det < 0) for (let i = 0; i < 3; i++) out[i][2] = -out[i][2];
  return matq(out);
}
const FACE_Q = {
  front: [1, 0, 0, 0],
  back: qaxis(0, 1, 0, Math.PI),
  right: qaxis(0, 1, 0, -Math.PI / 2),
  left: qaxis(0, 1, 0, Math.PI / 2),
  top: qaxis(1, 0, 0, -Math.PI / 2),
  bottom: qaxis(1, 0, 0, Math.PI / 2),
};
// 正面に向けたときも、少しかたむけて立体に見せる
const TILT = qmul(qaxis(1, 0, 0, -0.16), qaxis(0, 1, 0, 0.2));
const START_Q = qmul(qaxis(1, 0, 0, -0.34), qaxis(0, 1, 0, 0.52));

const cube = {
  q: START_Q,
  base: [1, 0, 0, 0],   // かたむける前の、まっすぐな向き
  faces: {},
  scale: 1,
  raf: 0,
  anim: null,
  vel: [0, 0],
  drag: null,
  moved: false,
  apply() {
    const node = $('cube');
    const m = qmat(this.q);
    node.style.transform = 'scale(' + this.scale + ') matrix3d('
      + [m[0][0], m[1][0], m[2][0], 0, m[0][1], m[1][1], m[2][1], 0, m[0][2], m[1][2], m[2][2], 0, 0, 0, 0, 1].map((v) => v.toFixed(5)).join(',') + ')';
    FACES.forEach((f) => {
      const face = this.faces[f];
      if (!face) return;
      const n = NORMAL[f];
      const w = [0, 1, 2].map((i) => m[i][0] * n[0] + m[i][1] * n[1] + m[i][2] * n[2]);
      // 手元の明かり（左上の手前）からの光で、面の明るさを変える
      const light = Math.max(0, w[0] * -0.22 + w[1] * -0.32 + w[2] * 0.92);
      face.style.setProperty('--shade', (0.5 * (1 - light)).toFixed(3));
      // 見えていない面は、キーボードでも選べないようにする
      face.inert = w[2] < 0.25;
    });
  },
  resize() {
    const scene = $('scene');
    if (!scene || !scene.clientWidth) return;
    this.scale = Math.min(1, scene.clientWidth / 660);
    scene.style.height = Math.round(470 * this.scale) + 'px';
    this.apply();
  },
  stop() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.animTimer);
    this.raf = 0;
    this.anim = null;
    this.vel = [0, 0];
    this.drag = null;
  },
  rotateBy(dx, dy) {
    this.q = qnorm(qmul(qmul(qaxis(0, 1, 0, dx * 0.009), qaxis(1, 0, 0, -dy * 0.009)), this.q));
    this.apply();
  },
  // 決まった向きへ、なめらかに回す
  go(target) {
    this.stop();
    if (CALM.matches) { this.q = target; this.apply(); return; }
    const from = this.q;
    const t0 = performance.now();
    const D = 320;
    this.anim = { target };
    const step = (now) => {
      if (!this.anim) return;
      const t = Math.min(1, (now - t0) / D);
      const e = 1 - Math.pow(1 - t, 3);
      this.q = qnorm(slerp(from, target, e));
      this.apply();
      if (t < 1) this.raf = requestAnimationFrame(step);
      else this.anim = null;
    };
    this.raf = requestAnimationFrame(step);
    // 画面がうしろにあって動きが止まるときも、最後の向きにはする
    this.animTimer = setTimeout(() => { if (this.anim && this.anim.target === target) { this.stop(); this.q = target; this.apply(); } }, D + 200);
  },
  showFace(f) {
    this.base = FACE_Q[f];
    this.go(qmul(TILT, this.base));
  },
  // やじるしのボタン: いまの向きをまっすぐにしてから、90度回す
  turn(axis, sign) {
    const snapped = this.anim ? this.base : snapQ(this.q);
    this.base = qnorm(qmul(axis === 'y' ? qaxis(0, 1, 0, sign * Math.PI / 2) : qaxis(1, 0, 0, sign * Math.PI / 2), snapped));
    this.go(qmul(TILT, this.base));
  },
  coast() {
    cancelAnimationFrame(this.raf);
    const step = () => {
      if (this.drag || this.anim) return;
      this.vel = [this.vel[0] * 0.92, this.vel[1] * 0.92];
      if (Math.hypot(this.vel[0], this.vel[1]) < 0.15) return;
      this.rotateBy(this.vel[0], this.vel[1]);
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  },
};

function buildCube(game) {
  const node = $('cube');
  node.replaceChildren();
  cube.stop();
  cube.faces = {};
  cube.q = START_Q;
  cube.base = [1, 0, 0, 0];
  FACES.forEach((f) => {
    const face = el('div', 'tk-face tk-face--' + f);
    face.dataset.face = f;
    cube.faces[f] = face;
    node.append(face);
  });
  const slotBtn = (i) => {
    const b = btn('tk-slot', '', () => openZoom(E.keyOf(i)));
    b.dataset.slot = String(i);
    const mod = game.bomb.slots[i];
    b.setAttribute('aria-label', slotLabel(i) + (mod ? 'のしかけ（' + E.TYPE_NAME[mod.type] + '）を近くで見る' : '（しかけなし）'));
    if (!mod) b.disabled = true;
    return b;
  };
  // 表: のこり時間・まちがいのランプ・しかけ3つ
  const strip = el('div', 'tk-strip');
  const time = el('span', 'tk-strip__time');
  time.id = 'bombTime';
  const lp = el('span', 'tk-strip__lamps');
  lp.id = 'bombLamps';
  strip.append(time, lp);
  const frontRow = el('div', 'tk-slots');
  [0, 1, 2].forEach((i) => frontRow.append(slotBtn(i)));
  cube.faces.front.append(strip, frontRow);
  // 裏: しかけ3つ
  const backStrip = el('div', 'tk-strip tk-strip--plain');
  backStrip.append(el('span', 'tk-strip__label', 'うら'));
  const backRow = el('div', 'tk-slots');
  [3, 4, 5].forEach((i) => backRow.append(slotBtn(i)));
  cube.faces.back.append(backStrip, backRow);
  // 側面・上・底: 手がかり
  ['left', 'right', 'top', 'bottom'].forEach((f) => {
    const b = btn('tk-cluebtn', '', () => openZoom(f));
    b.dataset.clue = f;
    b.setAttribute('aria-label', FACE_LABEL[f] + 'を近くで見る');
    cube.faces[f].append(b);
  });
  state.slotKeys = {};
  requestAnimationFrame(() => cube.resize());
  cube.resize();
}

// しかけ1つぶんの、いまの様子の合言葉（変わったときだけ描きなおす）
function slotKey(game, i, f) {
  const mod = game.bomb.slots[i];
  if (!mod) return 'x';
  const k = E.keyOf(i);
  if (mod.type === 'fuse') return 'f:' + (f ? f.k + f.flame : '-') + ':' + !!game.G.out;
  return JSON.stringify(game.G.m[k] || 0) + ':' + !!game.G.ok[k] + ':' + !!game.G.out;
}

function updateDef(game) {
  lamps($('bombLamps'), game.G.x);
  const f = E.fuseInfo(game.bomb, game.G, roomNow(state.room));
  for (let i = 0; i < E.SLOTS; i++) {
    const key = slotKey(game, i, f);
    if (state.slotKeys[i] === key) continue;
    state.slotKeys[i] = key;
    const b = document.querySelector('.tk-slot[data-slot="' + i + '"]');
    if (b) b.replaceChildren(modView(game, i, false, f));
  }
  ['left', 'right', 'top', 'bottom'].forEach((c) => {
    const key = c + ':' + state.lidOpen;
    if (state.slotKeys[c] === key) return;
    state.slotKeys[c] = key;
    const b = document.querySelector('.tk-cluebtn[data-clue="' + c + '"]');
    if (b) b.replaceChildren(clueView(game, c, false));
  });
  renderZoom(game, f);
}

function openZoom(key) {
  if (cube.moved) return;   // 回したあとの指のはなれを、押したことにしない
  state.zoom = key;
  state.zoomKey = '';
  state.zoomFresh = true;
  clearTimeout(state.zoomTimer);
  const game = gameOf(state.room);
  if (game) renderZoom(game, E.fuseInfo(game.bomb, game.G, roomNow(state.room)));
  $('btnZoomBack').focus({ preventScroll: true });
}
function closeZoom() {
  const was = state.zoom;
  state.zoom = null;
  state.zoomKey = '';
  clearTimeout(state.zoomTimer);
  $('zoom').hidden = true;
  $('stage').hidden = false;
  cube.resize();
  // もとのしかけ・手がかりのボタンへフォーカスをもどす
  const sel = was && was[0] === 's' && was.length === 2 ? '.tk-slot[data-slot="' + was.slice(1) + '"]' : '.tk-cluebtn[data-clue="' + was + '"]';
  document.querySelector(sel)?.focus({ preventScroll: true });
}

function renderZoom(game, f) {
  const z = state.zoom;
  $('zoom').hidden = !z;
  $('stage').hidden = !!z;
  if (!z) return;
  const isSlot = z[0] === 's' && z.length === 2;
  const slot = isSlot ? Number(z.slice(1)) : -1;
  const key = z + '|' + (isSlot ? slotKey(game, slot, f) : state.lidOpen + ':' + !!game.G.out);
  if (state.zoomKey === key) return;
  state.zoomKey = key;
  $('zoomTitle').textContent = isSlot ? slotLabel(slot) + 'のしかけ' : FACE_LABEL[z];
  const view = isSlot ? modView(game, slot, true, f) : clueView(game, z, true);
  // 寄る動きは、ひらいたときだけ（押すたびに描きなおすので、そのたびには動かさない）
  if (state.zoomFresh && !CALM.matches) view.classList.add('is-enter');
  state.zoomFresh = false;
  $('zoomBody').replaceChildren(view);
  // 解除できたら、少しして全体にもどる
  if (isSlot && game.G.ok[E.keyOf(slot)] && !game.G.out) {
    clearTimeout(state.zoomTimer);
    state.zoomTimer = setTimeout(() => { if (state.zoom === z) closeZoom(); }, 1100);
  }
}

// しかけの絵。big は近くで見る欄（操作できる）。小さいほうは箱の面にのる絵だけ
function modView(game, slot, big, f) {
  const mod = game.bomb.slots[slot];
  const box = el('div', 'tk-mod tk-mod--' + (mod ? mod.type : 'empty') + (big ? ' tk-mod--big' : ''));
  if (!mod) return box;
  const key = E.keyOf(slot);
  const G = game.G;
  const st = G.m[key] || {};
  const done = !!G.ok[key];
  const locked = done || !!G.out;
  const head = el('div', 'tk-mod__head');
  head.append(el('span', 'tk-mod__name', E.TYPE_NAME[mod.type]));
  if (mod.type !== 'fuse') {
    const led = el('span', 'tk-led' + (done ? ' is-on' : ''));
    led.setAttribute('aria-label', done ? '解除できた' : 'まだ');
    head.append(led);
  }
  box.append(head);
  const body = el('div', 'tk-mod__body');
  box.append(body);
  const actBtn = (className, label, a, disabled) => {
    const b = btn(className, label, () => act({ s: slot, ...a }));
    b.disabled = locked || !!disabled;
    b.dataset.a = a.k + ':' + (a.v ?? '');
    return b;
  };

  if (mod.type === 'cord') {
    const cut = typeof st.c === 'string' && st.c ? st.c.split(',').map(Number) : [];
    body.append(art('tk-cord', A.cord(mod, cut, E.NUMS, E.LETTERS)));
    if (big) {
      const row = el('div', 'tk-cutrow');
      row.append(el('p', 'tk-mod__label', '切るコード（上の番号）'));
      mod.colors.forEach((c, i) => {
        const b = actBtn('tk-cut', '', { k: 'cut', v: i }, cut.includes(i));
        b.append(el('b', '', E.NUMS[i]), el('span', '', colorName(c)));
        b.setAttribute('aria-label', E.NUMS[i] + '（' + colorName(c) + '）のコードを切る');
        row.append(b);
      });
      body.append(row);
    }
  } else if (mod.type === 'glyph') {
    const bits = Number.isInteger(st.b) ? st.b : 0;
    const grid = el('div', 'tk-glyphs');
    mod.glyphs.forEach((g, i) => {
      const up = !!(bits & (1 << i));
      const cell = el('div', 'tk-glyph');
      cell.append(art('tk-glyph__pic', A.glyph(g)));
      if (big) {
        const b = actBtn('tk-switch' + (up ? ' is-up' : ''), '', { k: 'tog', v: i });
        b.append(el('i', 'tk-switch__knob'), el('span', 'tk-switch__text', up ? '上' : '下'));
        b.setAttribute('aria-label', (i + 1) + 'つめのスイッチ。いまは' + (up ? '上' : '下'));
        cell.append(b);
      } else {
        const s = el('span', 'tk-switch' + (up ? ' is-up' : ''));
        s.append(el('i', 'tk-switch__knob'));
        cell.append(s);
      }
      grid.append(cell);
    });
    body.append(grid);
    if (big) body.append(actBtn('btn btn-primary tk-check-btn', 'たしかめる', { k: 'chk' }));
  } else if (mod.type === 'dial') {
    const pos = Number.isInteger(st.p) && st.p >= 1 ? st.p : mod.start;
    const lampRow = el('div', 'tk-lamps');
    mod.lamps.forEach((c) => {
      const cell = el('span', 'tk-lampcell');
      const lamp = el('i', 'tk-lamp');
      lamp.style.background = A.HEX[c];
      cell.append(lamp);
      if (big) cell.append(el('span', 'tk-lampcell__name', colorName(c)));
      lampRow.append(cell);
    });
    lampRow.setAttribute('aria-label', 'ランプは左から ' + mod.lamps.map(colorName).join('・'));
    body.append(lampRow, art('tk-dial', A.dial(pos)));
    if (big) {
      body.append(el('p', 'tk-mod__label', 'いまは ' + pos));
      const row = el('div', 'tk-dialrow');
      const l = actBtn('btn btn-secondary', '', { k: 'turn', v: -1 });
      l.append(icon('rotate_left'), document.createTextNode('左へ'));
      const r = actBtn('btn btn-secondary', '', { k: 'turn', v: 1 });
      r.append(icon('rotate_right'), document.createTextNode('右へ'));
      row.append(l, r);
      body.append(row, actBtn('btn btn-primary tk-check-btn', 'たしかめる', { k: 'chk' }));
    }
  } else if (mod.type === 'arrow') {
    const p = Number.isInteger(st.p) ? st.p : 0;
    body.append(art('tk-token', A.shape(mod.shape, mod.color)));
    if (big) body.append(el('p', 'tk-mod__label', colorName(mod.color) + 'の ' + E.SHAPE_NAME[mod.shape]));
    const dots = el('div', 'tk-dots');
    for (let i = 0; i < 4; i++) dots.append(el('i', 'tk-dot' + (i < (done ? 4 : p) ? ' is-on' : '')));
    dots.setAttribute('aria-label', '4回のうち ' + (done ? 4 : p) + '回まで押した');
    body.append(dots);
    if (big) {
      const pad = el('div', 'tk-pad');
      [['U', 'arrow_upward'], ['L', 'arrow_back'], ['R', 'arrow_forward'], ['D', 'arrow_downward']].forEach(([d, ic]) => {
        const b = actBtn('tk-pad__btn tk-pad__btn--' + d, '', { k: 'dir', v: d });
        b.append(icon(ic));
        b.setAttribute('aria-label', E.DIR_NAME[d]);
        pad.append(b);
      });
      body.append(pad);
    }
  } else if (mod.type === 'fuse') {
    const rope = el('div', 'tk-rope');
    const fill = el('i', 'tk-rope__fill');
    fill.dataset.fuseFill = '1';
    fill.style.width = (f ? Math.max(0, f.left / E.FUSE_WINDOW) * 100 : 0) + '%';
    rope.append(fill);
    if (f) {
      body.append(art('tk-flame', A.flame(f.flame)));
      if (big) body.append(el('p', 'tk-mod__label', colorName(f.flame) + 'い火がついている'));
    } else {
      body.append(el('p', 'tk-mod__label tk-mod__label--calm', G.out ? '' : '火はついていない'));
    }
    body.append(rope);
    const knobs = el('div', 'tk-knobs');
    E.KNOBS.forEach((k, j) => {
      if (big) {
        const b = btn('tk-knob', k, () => act({ s: slot, k: 'knob', v: j }));
        b.disabled = !f || !!G.out;
        b.dataset.a = 'knob:' + j;
        b.setAttribute('aria-label', k + ' のつまみを押す');
        knobs.append(b);
      } else knobs.append(el('span', 'tk-knob', k));
    });
    body.append(knobs);
  }
  if (done) box.append(el('span', 'tk-mod__done', '解除'));
  return box;
}

// 手がかりの絵
function clueView(game, which, big) {
  const c = game.bomb.clues;
  const box = el('div', 'tk-clue tk-clue--' + which + (big ? ' tk-clue--big' : ''));
  if (which === 'left') {
    const seal = el('span', 'tk-seal');
    seal.style.background = A.HEX[c.seal];
    box.append(seal);
    if (big) box.append(el('p', 'tk-clue__text', colorName(c.seal) + 'いシール'));
  } else if (which === 'right') {
    box.append(el('span', 'tk-serial', 'No. ' + c.serial));
    if (big) box.append(el('p', 'tk-clue__text', '4けたの番号'));
  } else if (which === 'top') {
    const row = el('div', 'tk-screws');
    for (let i = 0; i < c.screws; i++) row.append(art('tk-screw', A.screw()));
    box.append(row);
    if (big) box.append(el('p', 'tk-clue__text', 'ねじは ' + c.screws + '本'));
  } else {
    const lid = el('div', 'tk-lid' + (state.lidOpen ? ' is-open' : ''));
    if (state.lidOpen) {
      lid.append(art('tk-lid__mark', A.mark(c.mark)));
      box.append(lid);
      if (big) box.append(el('p', 'tk-clue__text', 'ふたの中の印は「' + E.MARK_NAME[c.mark] + '」'));
    } else {
      lid.append(el('span', 'tk-lid__handle'));
      box.append(lid);
      if (big) box.append(btn('btn btn-primary', 'ふたを開ける', () => { state.lidOpen = true; const g = gameOf(state.room); if (g) updateDef(g); }));
    }
  }
  return box;
}

/* ── 説明書を読む人 ── */
function updateRead(game, me) {
  // 自分のページ＋いまいない読む人のページ（その人だけが持っていたページを、だれも読めなくならないように）
  const all = E.deal(game.seed, game.bomb, readerSeats(game), game.split);
  const order = E.bombChapters(game.bomb);
  const mine = new Set(all[me] || []);
  readerSeats(game).forEach((i) => { if (i !== me && !seatPresent(state.room, game, i)) (all[i] || []).forEach((id) => mine.add(id)); });
  const dealt = order.filter((id) => mine.has(id));
  const chapters = ['clues'].concat(dealt);
  if (!chapters.includes(state.chapter)) state.chapter = chapters[0];
  const key = game.id + ':' + chapters.join(',') + ':' + state.chapter + ':' + !!game.G.out;
  if (state.pageKey === key) return;
  state.pageKey = key;
  $('tabs').replaceChildren(...chapters.map((id) => {
    const b = btn('tk-tab' + (id === state.chapter ? ' is-on' : ''), E.manual(id).title, () => { state.chapter = id; const g = gameOf(state.room); if (g) updateRead(g, selfSeat(g)); });
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', id === state.chapter ? 'true' : 'false');
    b.dataset.ch = id;
    return b;
  }));
  const man = E.manual(state.chapter);
  const page = $('page');
  page.replaceChildren(el('h2', 'tk-page__title', '説明書 「' + man.title + '」'));
  const others = E.bombChapters(game.bomb).filter((id) => !dealt.includes(id));
  if (state.chapter === 'clues' && others.length) page.append(el('p', 'tk-page__note', 'あなたが持っていないページ: ' + others.map((id) => '「' + E.TYPE_NAME[id] + '」').join(' ') + '（ほかの読む人が持っている）'));
  const list = el('ul', 'tk-lines');
  man.lines.forEach((line, n) => {
    const li = el('li', 'tk-line tk-line--' + line.t);
    const main = el('div', 'tk-line__main');
    if (line.t === 'row') {
      if (line.g != null) main.append(art('tk-line__pic', A.glyph(line.g)));
      if (line.shape) main.append(art('tk-line__pic', A.shape(line.shape)));
      if (line.a) main.append(el('span', 'tk-line__a', line.a));
      main.append(el('span', 'tk-line__b', line.b));
    } else main.append(el('span', 'tk-line__text', line.text));
    li.append(main);
    if (!game.G.out && state.chapter !== 'clues') {
      const b = btn('tk-line__send', '', () => sendSay({ c: man.id, l: n }));
      b.append(icon('campaign'));
      b.setAttribute('aria-label', 'この行をみんなの画面に出す');
      b.title = 'この行をみんなの画面に出す';
      b.dataset.l = String(n);
      li.append(b);
    }
    list.append(li);
  });
  page.append(list);
}

/* ── 入力 ── */
// Enter で送る（日本語入力の変換を確定する Enter は除く。Safari は確定の Enter を keyCode 229 で届ける）
function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    handler();
  });
}

// 爆弾をドラッグで回す
(function bindScene() {
  const scene = $('scene');
  scene.addEventListener('pointerdown', (event) => {
    if (event.button > 0) return;
    cube.stop();
    cube.moved = false;
    cube.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, on: false };
  });
  scene.addEventListener('pointermove', (event) => {
    const d = cube.drag;
    if (!d || d.id !== event.pointerId) return;
    if (!d.on) {
      if (Math.hypot(event.clientX - d.sx, event.clientY - d.sy) < 7) return;
      d.on = true;
      cube.moved = true;
      try { scene.setPointerCapture(event.pointerId); } catch { /* つかめなくても回せる */ }
    }
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    d.x = event.clientX;
    d.y = event.clientY;
    cube.vel = [dx, dy];
    cube.rotateBy(dx, dy);
  });
  const end = (event) => {
    const d = cube.drag;
    if (!d || d.id !== event.pointerId) return;
    cube.drag = null;
    if (d.on) {
      if (!CALM.matches) cube.coast();
      // このあとに届く click を、押したことにしない
      setTimeout(() => { cube.moved = false; }, 0);
    }
  };
  scene.addEventListener('pointerup', end);
  scene.addEventListener('pointercancel', end);
  // 見えていない面を押したとき（ボタンでない所）は、その面を正面に向ける
  scene.addEventListener('click', (event) => {
    if (cube.moved) return;
    const face = event.target.closest?.('.tk-face');
    if (face && !event.target.closest('button')) cube.showFace(face.dataset.face);
  });
  window.addEventListener('resize', () => { if (!$('viewDef').hidden && !$('stage').hidden) cube.resize(); });
})();

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

$('hostPlays').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, hostPlays: on })); });
$('setSlow').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, slow: on })); });
$('setSplit').addEventListener('change', (event) => { const on = event.currentTarget.checked; saveSet((s) => ({ ...s, split: on })); });
$('roSelf').addEventListener('change', (event) => { if (state.nickname) setRo(state.nickname, event.currentTarget.checked); });
$('btnStartGame').addEventListener('click', startGame);
$('btnLobby').addEventListener('click', backToLobby);

$('btnZoomBack').addEventListener('click', closeZoom);
$('btnFuseGo').addEventListener('click', () => {
  const game = gameOf(state.room);
  if (!game || !game.bomb.fuse) return;
  cube.moved = false;
  cube.showFace(game.bomb.fuse.slot < 3 ? 'front' : 'back');
  openZoom(E.keyOf(game.bomb.fuse.slot));
});
$('btnTurnL').addEventListener('click', () => cube.turn('y', -1));
$('btnTurnR').addEventListener('click', () => cube.turn('y', 1));
$('btnTurnU').addEventListener('click', () => cube.turn('x', 1));
$('btnTurnD').addEventListener('click', () => cube.turn('x', -1));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.zoom && !$('viewDef').hidden) closeZoom();
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

// 効果音: 切りかえを描き、「入」のときは、はじめの操作で鳴らせるようにする（ブラウザの決まりで、押したあとでないと鳴らせない）
renderSfxSegs();
['pointerdown', 'keydown'].forEach((type) => document.addEventListener(type, ensureAudio, { capture: true, passive: true }));

// E2E・手元の確認用（本番でも害のない読み取りだけ）
window.__tk = { state, cube, gameOf, sfx };
