/* ヒット&ブロー
   ・1台の画面: このタブだけで遊ぶ（色をならべるのは画面を動かす人。通信しない）
   ・ルーム: Realtime Database。遊ぶ人がそれぞれの端末で予想を出し、ほかの参加者は見るだけ
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない
   ルールは engine.js。音は鳴らさない。 */
const E = window.HitBlowEngine;

const MAX_GUESTS = 20;
const MAX_PROXIES = 4;     // 端末なしの参加者（ホストが代わりに押す）

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'hitblow_rooms';
const SESSION_KEY = 'hitblow_session';
const LOCAL_KEY = 'hitblow_local';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play' };
const DEFAULT_TITLE = document.title;

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'（みんなにみせる画面）| 'local'（1台の画面）
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  joinedAt: null,
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
  sending: false,      // 予想・答えを送る途中（二度押しよけ。ほかの操作の busy とは分ける）
  watchTimer: null,
  // 端末の中だけで持つ状態
  local: null,         // 1台の画面のゲーム { S, set }
  localSet: { mode: 'duel', level: 'easy', n: 3 },
  pick: [],            // 組み立て中の予想
  secretPick: [],      // 組み立て中の答え（2人で対戦）
  pickKey: null,       // 番が変わったら組み立て中の予想を空にする
  logKey: null,        // 新しく増えた予想の行に動きを付ける
  statusKey: null,
  mineShownFor: null,  // ホストが「見る」で自分の答えを出しているゲーム（ゲームが変わると折りたたむ）
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.hbw-screen').forEach((node) => node.classList.remove('active'));
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
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '記号 . # $ [ ] / は名前に使えないよ';
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

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).sort((a, b) => a - b).map((k) => value[k]);
  return [];
}

const colorOf = (id) => E.COLORS.find((c) => c.id === id);
const modeOf = (v) => (E.MODES[v] ? v : 'duel');
const levelIdOf = (v) => (E.LEVELS[v] ? v : 'easy');
const levelText = (id) => {
  const L = E.levelOf(id);
  return L.name + '（' + L.colors + '色から' + L.slots + 'つ）';
};
const MODE_NOTE = {
  duel: 'おたがいに答えをかくして、相手の答えを交互に当てる。先に当てた人の勝ち（先の番の人が当てたら、後の人にもう1回だけ番がある）。',
  party: 'コンピューターがかくした答えを、順番に1つずつ予想する。みんなの予想とヒントは全員に見える。最初に当てた人の勝ち。',
};

/* ── 色の部品 ── */
function peg(id, tag) {
  const n = makeElement(tag || 'span', 'hbw-peg');
  const c = id && colorOf(id);
  if (c) {
    n.style.setProperty('--c', c.hex);
    if (c.dark) n.classList.add('is-dark');
    n.append(msIcon(c.icon));
    n.setAttribute('aria-label', c.name);
    if (!tag) n.setAttribute('role', 'img');
  } else {
    n.classList.add('hbw-peg--empty');
    if (!tag) n.setAttribute('aria-hidden', 'true');
  }
  return n;
}

function codeRow(code) {
  const r = makeElement('div', 'hbw-row hbw-row--pegs');
  code.forEach((id) => r.append(peg(id)));
  r.setAttribute('role', 'img');
  r.setAttribute('aria-label', code.map((id) => colorOf(id).name).join('・'));
  return r;
}

function seg(box, options, value, onPick, disabled = false) {
  box.replaceChildren(...options.map((o) => {
    const b = makeElement('button', 'hbw-seg__btn', o.label);
    b.type = 'button';
    b.disabled = disabled;
    b.setAttribute('aria-pressed', String(o.value === value));
    b.addEventListener('click', () => onPick(o.value));
    return b;
  }));
}

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

// 在室している人を参加順に（ホストもふくむ）
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

// 待合室にいる人（在室の人と端末なしの参加者を、入った順に）
function peopleOf(room) {
  return byJoined(Object.entries({ ...(room?.players || {}), ...(room?.proxies || {}) }));
}

function present(room, name) {
  return typeof name === 'string' && (!!room?.players?.[name] || !!room?.proxies?.[name]);
}

// 待合室で「遊ぶ」にしている人（入った順）
function seatedNames(room) {
  const seated = room?.seated || {};
  return peopleOf(room).filter((name) => seated[name] === true);
}

// ゲームを読む。壊れた値は読み飛ばす
function gameOf(room) {
  const g = room?.game;
  if (!g || typeof g !== 'object') return null;
  const S = E.normalize(g);
  if (!S) return null;
  const names = asList(g.names);
  if (names.length !== S.n || !names.every((x) => typeof x === 'string' && x)) return null;
  const uids = asList(g.uids);
  const proxy = asList(g.proxy);
  return {
    S,
    id: Number(g.id) || 0,
    names,
    uids: names.map((_, i) => (typeof uids[i] === 'string' ? uids[i] : '')),
    proxy: names.map((_, i) => proxy[i] === true),
    // ゲームが変わるたびに増える番号（予想・答え・番をとばす）。古い操作の照合に使う
    rev: Number(g.rev) || 0,
    // 一度でもおわったか（finish を1ゲームに1回だけ数える）
    ended: g.ended === true,
  };
}

function storeGame(game, S) {
  return { ...S, id: game.id, names: game.names, uids: game.uids, proxy: game.proxy, rev: game.rev + 1, ended: game.ended || S.phase === 'end' };
}

// その席の人が、いまルームにいるか（端末なしの参加者はいつもいる）
function seatPresent(room, game, i) {
  return game.proxy[i] || !!room?.players?.[game.names[i]];
}

// この端末が、その席の人として押してよいか。ホストは、端末なしの人と通信が切れた人の代わりに押せる
function mayAct(room, game, i, uid, nickname, role) {
  if (role !== 'host' && role !== 'guest') return false;
  const isHost = role === 'host' && room.hostUid === uid;
  if (game.proxy[i]) return isHost;
  if (game.names[i] === nickname && game.uids[i] === uid) return true;
  return isHost && !room.players?.[game.names[i]];
}

// その席の本人の端末か（答えを決めるのは本人だけ）
function isOwnSeat(game, i, uid, nickname) {
  return !game.proxy[i] && game.names[i] === nickname && game.uids[i] === uid;
}

// ゲームの名前の持ち主（匿名ID）。ゲームの間は、その名前を同じ人だけが使える
function reservedByOther(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAY) return false;
  return game.names.some((n, i) => n === name && (game.proxy[i] || (game.uids[i] && game.uids[i] !== uid)));
}

function seatedInGame(room, name) {
  const game = gameOf(room);
  return room.status === STATUS.PLAY && !!game && game.names.includes(name);
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
    console.warn('[hit-blow] expired room cleanup failed', error);
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
function resetBoxes() {
  state.pick = [];
  state.secretPick = [];
  state.pickKey = null;
  state.logKey = null;
  state.statusKey = null;
  $('boards').replaceChildren();
  $('seats').replaceChildren();
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
  resetBoxes();
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
    console.warn('[hit-blow] room listener failed', error);
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
      let taken = false;
      await ref.transaction((room) => {
        full = false;
        taken = false;
        if (!room || isExpired(room) || room.players?.[nickname]) return;
        if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) {
          taken = true;
          return;
        }
        // 戻るときは参加したときの順番のまま。ゲームの席の人は人数の上限を見ない
        if (!seatedInGame(room, nickname) && guestNames(room).length >= MAX_GUESTS) {
          full = true;
          return;
        }
        const next = {
          ...room,
          players: {
            ...(room.players || {}),
            [nickname]: { isHost: false, uid, joinedAt },
          },
        };
        // 待合室で切れている間に、ほかの人が「遊ぶ」の空きに入っていたら、戻った人は「見るだけ」にする（上限をこえないように）
        if (room.status === STATUS.WAITING && room.seated?.[nickname] && seatedNames(room).length >= E.MODES[modeOf(room.mode)].max) {
          const seated = { ...room.seated };
          delete seated[nickname];
          next.seated = seated;
        }
        return next;
      });
      if ((full || taken) && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(full ? 'このルームはいっぱいだよ' : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
      }
    }
  } catch (error) {
    console.warn('[hit-blow] presence recovery failed', error);
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
          mode: 'duel',
          level: 'easy',
          // ホストも遊ぶ（はじめの値）。待合室で「見る」に変えられる
          seated: { [nickname]: true },
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
    console.warn('[hit-blow] create failed', err);
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
      if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
      else if (!seatedInGame(room, nickname) && guestNames(room).length >= MAX_GUESTS) { reason = '満員'; return; }
      const next = {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt },
        },
      };
      // 待合室では、遊ぶ人の数に空きがあれば「遊ぶ」で入る（ゲームの途中に入った人は見るだけ）
      if (room.status === STATUS.WAITING && !mine && seatedNames(room).length < E.MODES[modeOf(room.mode)].max) {
        next.seated = { ...(room.seated || {}), [nickname]: true };
      }
      return next;
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
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[hit-blow] join failed', err);
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
  const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoLocal', 'btnGoWatch'];
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
    console.warn('[hit-blow] reconnect failed', error);
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
      // 自分の在室だけを消す。待合室なら「遊ぶ」も外す（ゲーム中の席は残し、ホストが代わりに押せる）
      await ref.transaction((room) => {
        if (!room) return;
        const mine = room.players?.[nickname];
        // ほかの匿名IDの人がその名前で在室しているときは触らない
        if (mine && mine.uid !== uid) return;
        const players = { ...(room.players || {}) };
        delete players[nickname];
        const next = { ...room, players };
        if (room.status === STATUS.WAITING && room.seated?.[nickname]) {
          const seated = { ...room.seated };
          delete seated[nickname];
          next.seated = seated;
        }
        return next;
      });
    }
  } catch (error) {
    console.warn('[hit-blow] leave failed', error);
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
    console.warn('[hit-blow] watch failed', error);
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
  document.title = 'みんなにみせる画面 | ヒット&ブロー | あそびのたな';
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
    console.warn('[hit-blow] watch listener failed', error);
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
  resetBoxes();
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

/* ── ホストの操作 ── */
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
    console.warn('[hit-blow] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

// あそびかた・むずかしさ・遊ぶ人は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない（中で今の値から作りなおす）
async function setRoomMode(mode) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || !E.MODES[mode]) return;
    return { ...room, mode };
  }, '変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) renderRoom(state.room);
}

async function setRoomLevel(level) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || !E.LEVELS[level]) return;
    return { ...room, level };
  }, '変えられませんでした。もう一度ためしてね', false);
  if (!ok && state.room) renderRoom(state.room);
}

async function setSeated(name, on) {
  let full = false;
  const ok = await hostTransaction((room) => {
    full = false;
    if (room.status !== STATUS.WAITING || !present(room, name)) return;
    const seated = { ...(room.seated || {}) };
    if (on) {
      if (seatedNames(room).length >= E.MODES[modeOf(room.mode)].max) { full = true; return; }
      seated[name] = true;
    } else {
      delete seated[name];
    }
    return { ...room, seated };
  }, '変えられませんでした。もう一度ためしてね', false);
  if (ok === false && full) toast('遊ぶ人はもういっぱいだよ。だれかを「見る」にしてね', false);
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
    if (room.players?.[name] || room.proxies?.[name] || name === room.host || room.seated?.[name]) { reason = '「' + name + '」はもういるよ'; return; }
    if (proxyNames(room).length >= MAX_PROXIES) { reason = '端末なしの参加者は' + MAX_PROXIES + '人までだよ'; return; }
    const next = { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
    if (seatedNames(room).length < E.MODES[modeOf(room.mode)].max) next.seated = { ...(room.seated || {}), [name]: true };
    return next;
  }, '足せませんでした。もう一度ためしてね');
  if (ok) $('proxyName').value = '';
  else if (ok === false) setError('proxyError', reason || '足せませんでした。もう一度ためしてね');
}

async function removeProxy(name) {
  await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || !room.proxies?.[name]) return;
    const proxies = { ...room.proxies };
    delete proxies[name];
    const seated = { ...(room.seated || {}) };
    delete seated[name];
    return { ...room, proxies: Object.keys(proxies).length ? proxies : null, seated };
  }, '外せませんでした。もう一度ためしてね');
}

// 遊ぶ人で新しいゲームを作る（そろっていなければ null）
function newGameFor(room, names, round) {
  const mode = modeOf(room.mode);
  const M = E.MODES[mode];
  if (names.length < M.min || names.length > M.max || new Set(names).size !== names.length) return null;
  if (!names.every((n) => present(room, n))) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const proxy = names.map((n) => !!room.proxies?.[n]);
  const uids = names.map((n, i) => (proxy[i] ? '' : room.players[n].uid || ''));
  const S = E.create({ mode, level: levelIdOf(room.level), n: names.length, round, autoSeats: proxy.map((p, i) => (p ? i : -1)).filter((i) => i >= 0) });
  return { ...S, id, names: names.slice(), uids, proxy, rev: 0 };
}

function countStart(n) {
  window.RoomkStats?.count('start');
  window.RoomkStats?.count('players-' + n);
}

async function startGame() {
  let n = 0;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const game = newGameFor(room, seatedNames(room), Number(room.lastGameId) || 0);
    if (!game) return;
    n = game.n;
    return { ...room, status: STATUS.PLAY, lastGameId: game.id, game };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) countStart(n);
  else if (ok === false) toast('遊ぶ人の数をたしかめてね');
}

// もう一回（同じ人で。先の番をずらす）
async function playAgain() {
  const gid = gameOf(state.room)?.id;
  let reason = '';
  let n = 0;
  const ok = await hostTransaction((room) => {
    reason = '';
    const game = gameOf(room);
    if (room.status !== STATUS.PLAY || !game || game.id !== gid || game.S.phase !== 'end') return;
    const next = newGameFor({ ...room, mode: game.S.mode, level: game.S.level }, game.names, game.S.round);
    if (!next) { reason = 'そろっていない'; return; }
    n = next.n;
    return { ...room, lastGameId: next.id, game: next };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('again');
    countStart(n);
  } else if (ok === false && reason) {
    toast('遊んだ人がそろっていないよ。「遊ぶ人・あそびかたを変える」から選んでね');
  }
}

// 待合室にもどる（「遊ぶ人・あそびかたを変える」・「このゲームをやめる」）
async function backToLobby() {
  const game = gameOf(state.room);
  const gid = game?.id;
  const wasOver = game?.S.phase === 'end';
  if (!wasOver && !window.confirm('このゲームをやめて、待合室にもどる？')) return;
  const ok = await hostTransaction((room) => {
    const cur = gameOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== gid) return;
    const seated = {};
    cur.names.forEach((n) => { if (present(room, n)) seated[n] = true; });
    return { ...room, status: STATUS.WAITING, game: null, seated, mode: cur.S.mode, level: cur.S.level };
  }, 'もどれませんでした。もう一度ためしてね');
  if (ok && wasOver) window.RoomkStats?.count('again');
}

// みんなで対戦: 抜けた人などの番をとばす
async function skipTurn() {
  const game = gameOf(state.room);
  if (!game) return;
  const gid = game.id;
  const rev = game.rev;
  const who = game.names[game.S.turn];
  if (!window.confirm(who + 'の番をとばす？')) return;
  const ok = await hostTransaction((room) => {
    const cur = gameOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== gid || cur.rev !== rev) return;
    const S = E.skip(cur.S);
    if (S === cur.S) return;
    return { ...room, game: storeGame(cur, S) };
  }, 'とばせませんでした。もう一度ためしてね');
  if (ok === false) toast('ゲームが進んだので、とばさなかったよ', false);
}

// 2人で対戦: 通信が切れていて答えを決められない人の答えを、コンピューターが決める（ホストにも見えない）
async function autoSecrets() {
  const game = gameOf(state.room);
  if (!game) return;
  const gid = game.id;
  await hostTransaction((room) => {
    const cur = gameOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== gid || cur.S.phase !== 'setup') return;
    let S = cur.S;
    cur.names.forEach((_, i) => {
      if (!S.secrets[i] && !seatPresent(room, cur, i)) S = E.setSecret(S, i, E.randomCode(S.level));
    });
    if (S === cur.S) return;
    return { ...room, game: storeGame(cur, S) };
  }, '決められませんでした。もう一度ためしてね');
}

/* ── 予想・答えを送る ── */
async function sendRoom(kind, idx, code) {
  const room = state.room;
  const game = gameOf(room);
  if (!game || !state.roomRef || state.sending) return false;
  const gid = game.id;
  const rev = game.rev;
  const uid = currentUid();
  const nickname = state.nickname;
  const role = state.role;
  let finished = false;
  state.sending = true;
  try {
    const result = await state.roomRef.transaction((cur) => {
      finished = false;
      if (!cur || isExpired(cur) || cur.status !== STATUS.PLAY) return;
      const g = gameOf(cur);
      // 押した時点のゲームと同じか（古い画面からの操作を通さない）
      // 答えは自分の欄だけを書き、setup の間しか通らないので、同じゲームなら番号（rev）は見ない
      // （2人がほぼ同時に「これにする」を押すと、後の人の rev が古くなって断られるため）
      if (!g || g.id !== gid || (kind !== 'secret' && g.rev !== rev)) return;
      let S;
      if (kind === 'secret') {
        if (!isOwnSeat(g, idx, uid, nickname)) return;
        S = E.setSecret(g.S, idx, code);
      } else {
        if (!mayAct(cur, g, idx, uid, nickname, role)) return;
        S = E.guess(g.S, idx, code);
      }
      if (S === g.S) return;
      finished = S.phase === 'end' && !g.ended;
      return { ...cur, game: storeGame(g, S) };
    });
    if (result.committed && finished) window.RoomkStats?.count('finish');
    if (!result.committed) toast('ゲームが進んでいたので、送れなかったよ。もう一度ためしてね', false);
    return result.committed;
  } catch (error) {
    console.warn('[hit-blow] send failed', error);
    toast('送れませんでした。もう一度ためしてね');
    return false;
  } finally {
    state.sending = false;
    // 送っている間は入力を押せなくしていたので、描きなおして戻す（ルームの変化は送っている間に届くことがある）
    rerender();
  }
}

/* ── 1台の画面 ── */
function saveLocal() {
  try {
    sessionStorage.setItem(LOCAL_KEY, JSON.stringify(state.local));
  } catch {
    // 保存できないときは、読み込み直すと続きから遊べないだけ
  }
}

function loadLocal() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(LOCAL_KEY));
    const S = raw && E.normalize(raw.S);
    if (!S) return null;
    return { S };
  } catch {
    return null;
  }
}

function clearLocal() {
  try {
    sessionStorage.removeItem(LOCAL_KEY);
  } catch {
    // 何もしない
  }
}

function localCount(set) {
  const M = E.MODES[set.mode];
  return Math.max(M.min, Math.min(M.max, set.n | 0));
}

function renderLocalSetup() {
  const set = state.localSet;
  seg($('localModeSeg'), Object.values(E.MODES).map((m) => ({ value: m.id, label: m.name })), set.mode, (v) => { set.mode = v; renderLocalSetup(); });
  $('localModeNote').textContent = MODE_NOTE[set.mode] + (set.mode === 'duel' ? '1台の画面では、2人の答えをコンピューターが決める（画面を見せ合うと、かくせないため）。' : '');
  seg($('localLevelSeg'), Object.values(E.LEVELS).map((l) => ({ value: l.id, label: l.name })), set.level, (v) => { set.level = v; renderLocalSetup(); });
  const L = E.levelOf(set.level);
  $('localLevelNote').textContent = L.colors + '色から' + L.slots + 'つを、同じ色を使わずにならべる。';
  const n = localCount(set);
  $('localCountField').hidden = set.mode === 'duel';
  $('localCountNum').textContent = n + '人';
  $('btnLocalCountPrev').disabled = n <= E.MODES[set.mode].min;
  $('btnLocalCountNext').disabled = n >= E.MODES[set.mode].max;
}

function openLocalSetup() {
  renderLocalSetup();
  showScreen('local');
}

function newLocal(S) {
  const set = S || state.localSet;
  return E.create({ mode: set.mode, level: set.level, n: S ? S.n : localCount(set), autoSecret: true, round: S ? S.round : 0 });
}

function startLocal() {
  state.role = 'local';
  state.local = { S: newLocal(null) };
  resetBoxes();
  saveLocal();
  window.RoomkStats?.count('local-start');
  showScreen('game');
  renderGame();
}

function guessLocal(code) {
  const L = state.local;
  const before = L.S;
  const S = E.guess(before, before.turn, code);
  if (S === before) return false;
  L.S = S;
  if (S.phase === 'end' && before.phase !== 'end') window.RoomkStats?.count('local-finish');
  saveLocal();
  renderGame();
  return true;
}

function quitLocal() {
  clearLocal();
  state.local = null;
  state.role = null;
  resetBoxes();
  showScreen('top');
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
    const game = gameOf(room);
    const playing = room.status === STATUS.PLAY && game;
    const seated = playing ? game.names.includes(state.nickname) : !!room.seated?.[state.nickname];
    me = (state.role === 'host' ? 'ホスト' : state.nickname) + (seated ? '・遊ぶ' : '・見るだけ');
  }
  $('barMe').hidden = !me;
  $('barMe').textContent = me;
}

function renderWaiting(room) {
  const host = state.role === 'host';
  const watch = state.role === 'spectator';
  const mode = modeOf(room.mode);
  const level = levelIdOf(room.level);
  const M = E.MODES[mode];
  $('lobbyJoin').hidden = !watch;
  $('lobbyJoinCode').textContent = state.roomCode || '';

  // あそびかた・むずかしさ
  $('lobbyModeEdit').hidden = !host;
  $('lobbyModeView').hidden = host;
  if (host) {
    seg($('lobbyModeSeg'), Object.values(E.MODES).map((m) => ({ value: m.id, label: m.name + '（' + m.min + (m.max > m.min ? '〜' + m.max : '') + '人）' })), mode, setRoomMode);
    seg($('lobbyLevelSeg'), Object.values(E.LEVELS).map((l) => ({ value: l.id, label: l.name })), level, setRoomLevel);
  } else {
    $('lobbyModeView').textContent = M.name + '・' + levelText(level);
  }
  $('lobbyModeNote').textContent = MODE_NOTE[mode] + (host ? ' むずかしさ: ' + levelText(level) + '。' : '');

  // 参加している人
  const people = peopleOf(room);
  const seated = seatedNames(room);
  const full = seated.length >= M.max;
  $('lobbyPeople').replaceChildren(...people.map((name) => {
    const proxy = !!room.proxies?.[name];
    const on = room.seated?.[name] === true;
    const li = makeElement('li', 'hbw-person');
    // 「端末なし」の印はホストの画面にだけ出す（子どもどうしの画面で区別しない）
    li.append(msIcon(host && proxy ? 'person_off' : 'person'), makeElement('span', 'hbw-person__name', name));
    if (name === room.host) li.append(makeElement('span', 'hbw-tag hbw-tag--muted', 'ホスト'));
    if (host && proxy) li.append(makeElement('span', 'hbw-tag hbw-tag--muted', '端末なし'));
    li.append(makeElement('span', on ? 'hbw-tag' : 'hbw-tag hbw-tag--watch', on ? '遊ぶ' : '見るだけ'));
    if (name === state.nickname && !watch) li.append(makeElement('span', 'hbw-tag hbw-tag--watch', 'あなた'));
    if (host) {
      const acts = makeElement('span', 'hbw-person__acts');
      const toggle = makeElement('button', 'hbw-quiet', on ? '見るだけにする' : '遊ぶにする');
      toggle.type = 'button';
      toggle.disabled = !on && full;
      toggle.addEventListener('click', () => setSeated(name, !on));
      acts.append(toggle);
      if (proxy) {
        const del = makeElement('button', 'hbw-quiet', '外す');
        del.type = 'button';
        del.addEventListener('click', () => removeProxy(name));
        acts.append(del);
      }
      li.append(acts);
    }
    return li;
  }));
  const ready = seated.length >= M.min && seated.length <= M.max;
  let note = '遊ぶ人 ' + seated.length + '人（' + M.name + 'は' + M.min + (M.max > M.min ? '〜' + M.max : '') + '人）。遊ばない人は、自分の画面で予想とヒントを見られるよ。';
  if (host && !ready) note += seated.length < M.min ? ' 遊ぶ人があと' + (M.min - seated.length) + '人いると、はじめられるよ。' : ' 遊ぶ人が多いので、だれかを「見るだけ」にしてね。';
  $('seatNote').textContent = note;
  $('proxyForm').hidden = !host;

  $('btnStartGame').hidden = !host;
  $('btnStartGame').disabled = !ready;
  $('lobbyWait').hidden = host || watch;
}

// 画面に出すための共通の形にそろえる（1台の画面とルーム）
function viewModel() {
  if (state.role === 'local') {
    const S = state.local.S;
    const names = Array.from({ length: S.n }, (_, i) => (i + 1) + '人目');
    return {
      S, names, gid: 'local:' + S.round,
      me: -1,                            // 自分の席（1台の画面にはない）
      can: (i) => S.phase === 'play' && S.turn === i,
      own: () => false,
      away: () => false,
      label: (i) => names[i],
      host: true,
    };
  }
  const room = state.room;
  const game = gameOf(room);
  const uid = currentUid();
  const S = game.S;
  const me = (state.role === 'host' || state.role === 'guest') ? game.names.findIndex((n, i) => isOwnSeat(game, i, uid, state.nickname)) : -1;
  return {
    S, names: game.names, gid: room.lastGameId + ':' + game.id, game,
    me,
    can: (i) => S.phase === 'play' && S.turn === i && mayAct(room, game, i, uid, state.nickname, state.role),
    own: (i) => isOwnSeat(game, i, uid, state.nickname),
    away: (i) => !seatPresent(room, game, i),
    label: (i) => (i === me ? 'あなた' : game.names[i]),
    host: state.role === 'host',
  };
}

function setStatus(text, cls, key) {
  const node = $('gameStatus');
  node.textContent = text;
  node.className = 'hbw-status' + (cls ? ' ' + cls : '');
  if (state.statusKey !== key) {
    state.statusKey = key;
    void node.offsetWidth;
    node.classList.add('is-new');
  }
}

function renderGame() {
  const V = viewModel();
  const S = V.S;
  const L = E.levelOf(S.level);
  const duel = S.mode === 'duel';
  const local = state.role === 'local';
  $('gameSub').textContent = E.MODES[S.mode].name + '・' + levelText(S.level);

  // 番が変わったら、組み立て中の予想を空にする
  const pickKey = V.gid + ':' + S.phase + ':' + S.turn + ':' + S.log.length;
  if (state.pickKey !== pickKey) {
    if (state.pickKey && state.pickKey.split(':').slice(0, 2).join(':') !== V.gid.split(':').slice(0, 2).join(':')) state.secretPick = [];
    state.pick = [];
    state.pickKey = pickKey;
  }

  // 遊ぶ人の札
  $('seats').replaceChildren(...V.names.map((name, i) => {
    const chip = makeElement('span', 'hbw-seat');
    if (S.phase === 'play' && S.turn === i) chip.classList.add('is-turn');
    if (V.away(i)) chip.classList.add('is-away');
    if (S.phase === 'end' && S.winners.includes(i)) chip.append(msIcon('emoji_events'));
    else if (duel && S.phase === 'setup' && S.secrets[i]) chip.append(msIcon('check_circle'));
    chip.append(makeElement('span', '', name + (i === V.me ? '（あなた）' : '')));
    if (V.away(i)) chip.append(makeElement('span', 'hbw-tag hbw-tag--warn', '通信が切れた'));
    return chip;
  }));

  // 番・結果
  const turnName = V.label(S.turn);
  if (S.phase === 'setup') {
    setStatus(V.me >= 0 && !S.secrets[V.me] ? '相手に当ててもらう答えを決めよう' : '答えを決めています', '', V.gid + ':setup');
  } else if (S.phase === 'play') {
    const mine = V.me === S.turn;
    setStatus(turnName + 'の番' + (S.lastChance === S.turn ? '（もう1回だけ）' : ''), mine ? 'is-mine' : '', pickKey);
  } else {
    let text = 'おしまい';
    if (S.draw) text = '引き分け！ 2人とも当てた';
    else if (S.winners.length) text = V.label(S.winners[0]) + 'が当てた！';
    setStatus(text, 'is-result', V.gid + ':end');
  }

  // 自分の答え（2人で対戦）
  // ホストの画面は画面共有されやすいので、ホストの答えははじめ折りたたみ、「見る」で出す（rtdb.md「ホストも遊ぶかを選ぶ」）
  const mine = duel && V.me >= 0 && S.secrets[V.me] && S.phase !== 'end';
  const fold = mine && state.role === 'host' && state.mineShownFor !== V.gid;
  $('mineBox').hidden = !mine;
  $('mineRow').hidden = !!fold;
  $('btnMineToggle').hidden = !(mine && state.role === 'host');
  $('btnMineToggle').textContent = fold ? '見る' : 'かくす';
  if (mine && !fold) $('mineRow').replaceChildren(...S.secrets[V.me].map((id) => peg(id)));
  else $('mineRow').replaceChildren();

  // 答えを決める
  const needSetup = duel && S.phase === 'setup' && V.me >= 0 && !S.secrets[V.me];
  $('setupBox').hidden = !needSetup;
  $('btnSetupBlind').hidden = !(needSetup && state.role === 'host');  if (needSetup) buildInput($('setupSlots'), $('setupPalette'), $('btnSetupOk'), 'secretPick', S, !state.sending);

  // 予想を出す
  const canGuess = V.can(S.turn);
  $('guessBox').hidden = !canGuess;
  if (canGuess) {
    let title = turnName + 'の予想をならべよう';
    if (!local && V.me !== S.turn) title = V.names[S.turn] + 'の番。代わりにならべてね';
    else if (V.me === S.turn) title = 'あなたの予想をならべよう';
    $('guessTitle').textContent = title;
    buildInput($('guessSlots'), $('guessPalette'), $('btnGuessOk'), 'pick', S, !state.sending);
  }

  // 待つ表示
  let wait = '';
  if (S.phase === 'setup' && !needSetup) wait = V.me >= 0 ? '相手が答えを決めるのを待っています' : '2人が答えを決めるのを待っています';
  else if (S.phase === 'play' && !canGuess) wait = V.names[S.turn] + 'が考えています';
  $('waitText').hidden = !wait;
  $('waitText').textContent = wait;

  // 結果
  const over = S.phase === 'end';
  $('resultBox').hidden = !over;
  if (over) {
    const answers = duel
      ? [0, 1].map((i) => [V.label(i) + 'の答え', S.secrets[i]])
      : [['かくれていた答え', S.secrets[0]]];
    $('resultAnswers').replaceChildren(...answers.map(([label, code]) => {
      const a = makeElement('div', 'hbw-result__answer');
      a.append(makeElement('p', null, label), codeRow(code));
      return a;
    }));
    $('resultHost').hidden = !V.host;
    $('resultWait').hidden = V.host || state.role === 'spectator';
    $('btnRelobby').textContent = local ? 'あそびかたを変える' : '遊ぶ人・あそびかたを変える';
  }

  renderBoards(V);

  // そのほかの操作
  const tools = V.host && !over;
  $('tools').hidden = !(tools || local);
  const absentUnset = !local && duel && S.phase === 'setup' && V.names.some((_, i) => !S.secrets[i] && V.away(i));
  $('btnAutoSecret').hidden = !(V.host && absentUnset);
  $('autoSecretLabel').textContent = '通信が切れた人の答えをおまかせで決める';
  $('btnSkip').hidden = !(tools && !duel && S.phase === 'play');
  $('btnReset').hidden = !tools && !local;
  $('btnReset').textContent = local ? '最初からやりなおす' : 'このゲームをやめる';
  $('btnQuit').hidden = !local;
}

function renderBoards(V) {
  const S = V.S;
  const duel = S.mode === 'duel';
  const logKey = V.gid;
  const prev = state.logKey && state.logKey.startsWith(logKey + '#') ? Number(state.logKey.split('#')[1]) : S.log.length;
  state.logKey = logKey + '#' + S.log.length;
  const boards = $('boards');
  const lists = [];
  const make = (title, entries, active, withWho) => {
    const b = makeElement('section', 'hbw-board');
    if (active) b.classList.add('is-active');
    b.append(makeElement('h2', 'hbw-board__title', title));
    const list = makeElement('div', 'hbw-board__list');
    if (!entries.length) list.append(makeElement('p', 'hbw-board__empty', 'まだ予想はありません'));
    entries.forEach(({ t, k }, n) => list.append(tryRow(t, n + 1, k >= prev, withWho ? V.label(t.by) : null)));
    b.append(list);
    lists.push(list);
    return b;
  };
  const all = S.log.map((t, k) => ({ t, k }));
  const nodes = [];
  if (duel) {
    const order = V.me >= 0 ? [V.me, 1 - V.me] : [0, 1];
    order.forEach((g) => {
      const title = V.me >= 0
        ? (g === V.me ? 'あなたが当てる（' + V.names[1 - g] + 'の答え）' : V.names[g] + 'が当てる（あなたの答え）')
        : V.names[g] + 'が当てる（' + V.names[1 - g] + 'の答え）';
      nodes.push(make(title, all.filter((x) => x.t.by === g), S.phase === 'play' && S.turn === g, false));
    });
  } else {
    nodes.push(make('みんなの予想', all, S.phase === 'play', true));
  }
  boards.classList.toggle('is-duel', duel);
  boards.replaceChildren(...nodes);
  lists.forEach((l) => { l.scrollTop = l.scrollHeight; });
}

function tryRow(t, no, isNew, who) {
  const r = makeElement('div', 'hbw-try');
  if (isNew) r.classList.add('is-new');
  if (t.hit === t.guess.length) r.classList.add('is-solved');
  const head = makeElement('div', 'hbw-try__no', no + '回め');
  if (who) head.prepend(makeElement('span', 'hbw-try__who', who));
  r.append(head, codeRow(t.guess));
  const res = makeElement('div', 'hbw-try__res');
  const dots = makeElement('div', 'hbw-try__dots');
  dots.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < t.guess.length; i += 1) {
    dots.append(makeElement('span', 'hbw-dot ' + (i < t.hit ? 'is-hit' : i < t.hit + t.blow ? 'is-blow' : 'is-none')));
  }
  res.append(dots, makeElement('span', 'hbw-try__text', t.hit === t.guess.length ? 'ぜんぶヒット' : 'ヒット' + t.hit + '・ブロー' + t.blow));
  r.append(res);
  return r;
}

/* ── 色をならべる入力 ── */
function buildInput(slotsBox, palBox, okBtn, key, S, enabled) {
  const L = E.levelOf(S.level);
  const pick = state[key].slice(0, L.slots);
  while (pick.length < L.slots) pick.push(null);
  const nextIdx = pick.findIndex((x) => !x);
  slotsBox.replaceChildren(...pick.map((id, i) => {
    const b = peg(id, 'button');
    b.type = 'button';
    if (id) {
      b.setAttribute('aria-label', (i + 1) + 'つめ ' + colorOf(id).name + '（押すとけす）');
      b.disabled = !enabled;
      b.addEventListener('click', () => {
        const p = state[key].slice();
        p[i] = null;
        state[key] = p;
        rerender();
      });
    } else {
      b.disabled = true;
      b.setAttribute('aria-label', (i + 1) + 'つめ まだ');
      if (i === nextIdx) b.classList.add('is-next');
    }
    return b;
  }));
  const filled = pick.filter(Boolean).length;
  palBox.replaceChildren(...E.palette(S.level).map((c) => {
    const b = peg(c.id, 'button');
    b.type = 'button';
    b.disabled = !enabled || pick.includes(c.id) || filled >= L.slots;
    b.addEventListener('click', () => {
      const p = state[key].slice(0, L.slots);
      while (p.length < L.slots) p.push(null);
      const at = p.findIndex((x) => !x);
      if (at < 0 || p.includes(c.id)) return;
      p[at] = c.id;
      state[key] = p;
      rerender();
      slotsBox.children[at]?.classList.add('is-new');
    });
    return b;
  }));
  okBtn.disabled = !enabled || filled < L.slots;
}

function fullPick(p, S) {
  const n = E.levelOf(S.level).slots;
  return p.length >= n && p.slice(0, n).every(Boolean) ? p.slice(0, n) : null;
}

function rerender() {
  if (state.role === 'local') renderGame();
  else if (state.room) renderRoom(state.room);
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
$('btnGoLocal').addEventListener('click', openLocalSetup);
$('btnGoWatch').addEventListener('click', () => {
  setError('watchError', '');
  showScreen('watch-join');
});
['btnCreateBack', 'btnJoinBack', 'btnWatchBack', 'btnLocalBack', 'btnWatchEndTop'].forEach((id) => {
  $(id).addEventListener('click', () => showScreen('top'));
});
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('hostName'), createRoom);
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
$('btnStartGame').addEventListener('click', startGame);

$('btnLocalCountPrev').addEventListener('click', () => { state.localSet.n = localCount(state.localSet) - 1; renderLocalSetup(); });
$('btnLocalCountNext').addEventListener('click', () => { state.localSet.n = localCount(state.localSet) + 1; renderLocalSetup(); });
$('btnLocalStart').addEventListener('click', startLocal);

// ホストが答えを画面に出さずに決める（画面共有していても見えないように）
$('btnSetupBlind').addEventListener('click', async () => {
  const V = viewModel();
  if (state.role !== 'host' || V.me < 0) return;
  await sendRoom('secret', V.me, E.randomCode(V.S.level));
});
$('btnMineToggle').addEventListener('click', () => {
  const V = viewModel();
  state.mineShownFor = state.mineShownFor === V.gid ? null : V.gid;
  rerender();
});
$('btnSetupRandom').addEventListener('click', () => {
  const V = viewModel();
  state.secretPick = E.randomCode(V.S.level);
  rerender();
});
$('btnSetupOk').addEventListener('click', async () => {
  if (state.role === 'local') return;
  const V = viewModel();
  const code = fullPick(state.secretPick, V.S);
  if (!code || V.me < 0) return;
  await sendRoom('secret', V.me, code);
});
$('btnGuessClear').addEventListener('click', () => { state.pick = []; rerender(); });
$('btnGuessOk').addEventListener('click', async () => {
  const V = viewModel();
  const code = fullPick(state.pick, V.S);
  if (!code) return;
  if (state.role === 'local') {
    guessLocal(code);
    return;
  }
  await sendRoom('guess', V.S.turn, code);
});
$('btnSkip').addEventListener('click', () => {
  if (state.role !== 'local') {
    skipTurn();
    return;
  }
  const S = state.local.S;
  if (!window.confirm((S.turn + 1) + '人目の番をとばす？')) return;
  state.local.S = E.skip(S);
  saveLocal();
  renderGame();
});
$('btnAutoSecret').addEventListener('click', autoSecrets);
$('btnReset').addEventListener('click', () => {
  if (state.role === 'local') {
    const S = state.local.S;
    if (S.phase !== 'end' && S.log.length && !window.confirm('最初からやりなおす？')) return;
    state.local.S = E.create({ mode: S.mode, level: S.level, n: S.n, autoSecret: true, round: S.round - 1 });
    resetBoxes();
    saveLocal();
    window.RoomkStats?.count('local-start');
    renderGame();
  } else if (state.role === 'host') {
    backToLobby();
  }
});
$('btnQuit').addEventListener('click', quitLocal);
$('btnAgain').addEventListener('click', () => {
  if (state.role === 'local') {
    state.local.S = newLocal(state.local.S);
    resetBoxes();
    saveLocal();
    window.RoomkStats?.count('local-start');
    renderGame();
  } else if (state.role === 'host') {
    playAgain();
  }
});
$('btnRelobby').addEventListener('click', () => {
  if (state.role === 'local') {
    const S = state.local.S;
    // 人数は、みんなで対戦で遊んでいたときだけ引き継ぐ（2人で対戦のあとに切りかえても、前の人数のまま）
    state.localSet = { mode: S.mode, level: S.level, n: S.mode === 'party' ? S.n : state.localSet.n };
    clearLocal();
    state.local = null;
    state.role = null;
    resetBoxes();
    openLocalSetup();
  } else if (state.role === 'host') {
    backToLobby();
  }
});

// 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう（コード欄は直せるように残す）
function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}

// 再読み込みなどで、保存した記録から同じルームへ戻る。なければ、1台の画面の続き
function resumeFromSession() {
  if (!loadSession()) {
    resumeLocal();
    return;
  }
  tryReconnect().then((reconnected) => {
    if (!reconnected && !state.roomRef) clearSession();
  });
}

function resumeLocal() {
  const saved = loadLocal();
  if (!saved) return;
  state.role = 'local';
  state.local = saved;
  showScreen('game');
  renderGame();
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
