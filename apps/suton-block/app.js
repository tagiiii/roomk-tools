/* すとんブロック
   ・ひとりであそぶ: このタブだけで遊ぶ（通信しない）
   ・ルーム: Realtime Database。みんな同じ種（seed）でブロックが出る。時間内に消した段の数をくらべるか、対戦する。
     対戦は、よく知られた対戦の表で送るじゃまを決める。いっぱいになったら「ここまで」か「からにしてつづける」を選ぶ。
     盤は置くたびに boards/{名前} へ送り、ほかの人の画面に小さく出す。じゃまブロックは jama/{名前} へ送る
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない */
const E = window.SutonEngine;

const MAX_GUESTS = 8;
const SPEED = { slow: 1000, normal: 650, fast: 380 };
const SPEED_LABEL = { slow: 'ゆっくり', normal: 'ふつう', fast: 'はやい' };
const ROOM_TIMES = [120, 180, 300];
const NO_TIME_CAP_S = 30 * 60; // 対戦の「時間なし」も、ルームが残りつづけないよう30分で区切る（画面には時間を出さない）
const BATTLE_END_MS = 800;     // 対戦で1人になってから、最後の盤が届くのを待って結果を出す
const LOCK_MS = 500;        // 着地してから置かれるまで
const LOCK_RESETS = 15;     // 着地したまま動かして待ちを延ばせる回数
const COUNTDOWN_MS = 3500;  // 「はじめる」から落ちはじめるまで（3・2・1）
const FINISH_GRACE_MS = 1500;   // 時間のあと、最後の盤が届くのを待つ
const FINISH_BACKUP_MS = 4000;  // ホストのタブが裏に回っていても、あそぶ人の端末が結果を出す
// 「つぎ」に出す数の上限と、1つ目の高さ・2つ目からの高さと大きさ（ブロック1マスの4倍が箱の幅。高さはその何マスぶんか）
const NEXT_MAX = 5;
const NEXT_FIRST = 2.6;
const NEXT_SMALL = { slot: 1.6, k: 0.6 };
const NEXT_SMALL_NARROW = { slot: 1.35, k: 0.5 };
// 形ごとの色は、よく知られた色の組み合わせと重ならないように、このアプリで決めたもの
const COLORS = {
  I: '#D07198', O: '#3BA3B5', T: '#5DAE6B', S: '#E0B33A',
  Z: '#5B8FD6', L: '#9A7CC8', J: '#E08454',
  jama: '#7B8794',
};

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'sutonblock_rooms';
const SESSION_KEY = 'sutonblock_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAY: 'play', RESULT: 'result' };
const DEFAULT_TITLE = document.title;
// mode: 'lines' = 消した段の数をくらべる / 'battle' = 対戦。full（対戦だけ）: 'out' = その人はここまで / 'clear' = からにしてつづける
const DEFAULT_SETTINGS = { mode: 'lines', full: 'out', time: 180, speed: 'slow', jama: false };

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'（みんなにみせる画面）| 'solo'（ひとり）
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
  solo: { speed: 'slow', time: 0, onFull: 'clear' },
  game: null,          // いまの盤（engine）
  run: null,           // あそんでいる回（時計・着地の待ち・来るじゃま）
  playRound: null,     // ルームで、いまあそんでいる回の id
  playSeed: null,      // その回の種（変わったら作りなおす）
  jamaSeen: new Set(), // 受けとったじゃま（消す前に二重に数えない）
  finishing: false,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.sb-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  // ルームのバーは待合室と結果だけ（あそんでいる間は、盤を大きく出すため）
  const inRoom = !!state.roomRef && (id === 'waiting' || id === 'result');
  $('appBar').hidden = !inRoom;
  $('roomBar').hidden = !inRoom;
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

function msIcon(name) {
  const node = makeElement('span', 'material-symbols-rounded', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function clockText(ms) {
  const sec = Math.ceil(Math.max(0, ms) / 1000);
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// 時間「なし」（0）は、対戦で「ここまで」のときだけ選べる
function timeOf(value, mode, full) {
  const t = Number(value);
  return ROOM_TIMES.includes(t) || (t === 0 && mode === 'battle' && full === 'out') ? t : DEFAULT_SETTINGS.time;
}

function settingsOf(room) {
  const s = room?.settings || {};
  const mode = s.mode === 'battle' ? 'battle' : 'lines';
  const full = s.full === 'clear' ? 'clear' : 'out';
  return {
    mode,
    full,
    time: timeOf(s.time, mode, full),
    speed: SPEED[s.speed] ? s.speed : DEFAULT_SETTINGS.speed,
    jama: s.jama === true,
  };
}

function settingsText(s) {
  const time = s.time ? Math.round(s.time / 60) + '分' : '時間なし';
  if (s.mode === 'battle') return '対戦・' + (s.full === 'out' ? 'いっぱいでここまで' : 'からにしてつづける') + '・' + time + '・' + SPEED_LABEL[s.speed];
  return '段の数をくらべる・' + time + '・' + SPEED_LABEL[s.speed] + '・じゃま' + (s.jama ? 'あり' : 'なし');
}

function byJoined(entries) {
  return entries.sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0));
}

function memberNames(room) {
  return byJoined(Object.entries(room?.players || {})).map(([name]) => name);
}

function guestNames(room) {
  return memberNames(room).filter((name) => name !== room.host);
}

// その回（あそんでいる途中・結果）の人か。「もう一回」で回の記録を消すまでは、その回の人として扱う
function inRoundOf(room, name) {
  const R = room.status === STATUS.PLAY || room.status === STATUS.RESULT ? roundOf(room) : null;
  return !!R && R.players.includes(name);
}

// ゲストの人数。その回の人は、切れて在室から消えていても戻ってくるので数に入れる
function guestCount(room) {
  const names = new Set(guestNames(room));
  const R = room.status === STATUS.PLAY || room.status === STATUS.RESULT ? roundOf(room) : null;
  if (R) R.players.forEach((name) => { if (name !== room.host) names.add(name); });
  return names.size;
}

// あそんでいる回。壊れた値は null
function roundOf(room) {
  const r = room?.round;
  if (!r || typeof r !== 'object' || !Number(r.id) || !Number(r.startedAt)) return null;
  const players = Array.isArray(r.players) ? r.players.filter((x) => typeof x === 'string') : [];
  const mode = r.mode === 'battle' ? 'battle' : 'lines';
  const full = r.full === 'clear' ? 'clear' : 'out';
  return {
    id: Number(r.id),
    seed: Number(r.seed) >>> 0,
    startedAt: Number(r.startedAt),
    mode,
    full,
    time: timeOf(r.time, mode, full),
    speed: SPEED[r.speed] ? r.speed : DEFAULT_SETTINGS.speed,
    jama: r.jama === true || mode === 'battle',
    players,
    endedAt: Number(r.endedAt) || null,
  };
}

const isBattle = (R) => R?.mode === 'battle';
// 対戦で、いっぱいになったらその人はここまで（盤をからにしない）
const isOutMode = (R) => isBattle(R) && R.full === 'out';

function playStartOf(R) {
  return R.startedAt + COUNTDOWN_MS;
}

function endOf(R) {
  const end = playStartOf(R) + (R.time || NO_TIME_CAP_S) * 1000;
  return R.endedAt ? Math.min(end, R.endedAt) : end;
}

function boardOf(room, R, name) {
  const b = room?.boards?.[name];
  return b && Number(b.round) === R.id ? b : null;
}

function isOut(room, R, name) {
  return boardOf(room, R, name)?.out === true;
}

// 対戦の「ここまで」で、のこりが1人（ひとりであそぶ回は0人）になった時刻。まだなら null
function battleOverAt(room, R) {
  if (!isOutMode(R)) return null;
  const alive = R.players.filter((name) => !isOut(room, R, name)).length;
  if (alive > (R.players.length >= 2 ? 1 : 0)) return null;
  return Math.max(0, ...R.players.map((name) => Number(boardOf(room, R, name)?.outAt) || 0));
}

// ホストが切れたルームの期限。ふだんは切れてから2分。あそんでいる回は、時間で結果が出て2分たつまで、
// 結果は出てから2分たつまでのばす（ホストが切れていても、あそぶ人だけで回をおえて結果を見られるように）
function expiryAt(room) {
  const at = RoomkRTDB.getHostDisconnectedAt(room);
  if (room?.hostConnected !== false || at == null) return null;
  let until = at + ORPHAN_TTL_MS;
  const R = roundOf(room);
  if (room.status === STATUS.PLAY && R) until = Math.max(until, endOf(R) + FINISH_BACKUP_MS + ORPHAN_TTL_MS);
  if (room.status === STATUS.RESULT && Number(room.result?.at)) until = Math.max(until, Number(room.result.at) + ORPHAN_TTL_MS);
  return until;
}

function isExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  if (!!room && !room.status) return true;
  const until = expiryAt(room);
  return until != null && RoomkRTDB.now() >= until;
}

async function removeExpired(ref, fallback) {
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[suton-block] expired room cleanup failed', error);
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
function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  stopRun();
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
    playRound: null,
    playSeed: null,
    finishing: false,
  });
  state.jamaSeen.clear();
  clearSession();
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
    console.warn('[suton-block] room listener failed', error);
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
  state.timerInterval = setInterval(tickRoom, 500);
}

function tickRoom() {
  const room = state.room;
  if (!room) return;
  if (needsPresence(room)) ensurePresence();
  maybeFinishRound(room);
  if (state.currentScreen === 'watch') updateWatchTimer();
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
        if (nickname === room.host) {
          taken = true;
          return;
        }
        // 戻るときは参加したときの順番のまま。その回の人は人数の上限を見ない
        if (!inRoundOf(room, nickname) && guestCount(room) >= MAX_GUESTS) {
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
      if ((full || taken) && state.roomRef === ref && !state.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally(full ? 'このルームはいっぱいだよ' : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
      }
    }
  } catch (error) {
    console.warn('[suton-block] presence recovery failed', error);
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
          lastRoundId: 0,
          hostPlays: true,
          settings: { ...DEFAULT_SETTINGS },
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
    console.warn('[suton-block] create failed', err);
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
      // 送信後の切断のやり直しで、この参加の書き込みがもう届いていたら、そのまま使う。
      // 同じ名前の在室が残っていれば、同じ匿名ID（同じブラウザの別のタブ）でも入れない（同じ盤を2つの画面で動かさない）
      const stale = room.players?.[nickname];
      const mine = !!stale && !stale.isHost && stale.uid === uid && Number(stale.joinedAt) === joinedAt;
      if (nickname === room.host || (stale && !mine)) {
        reason = '名前';
        return;
      }
      // その回（あそんでいる途中・結果）の人の名前は、その人（同じ匿名ID）が戻るときだけ使える
      const inRound = inRoundOf(room, nickname);
      if (inRound && !mine && room.roundUids?.[nickname] && room.roundUids[nickname] !== uid) {
        reason = '名前';
        return;
      }
      if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
      else if (!inRound && guestCount(room) >= MAX_GUESTS) { reason = '満員'; return; }
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
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[suton-block] join failed', err);
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
  const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoSolo', 'btnGoWatch'];
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
      if (room.roundUids?.[saved.nickname] && room.roundUids[saved.nickname] !== uid) return false;
      if (player) joinedAt = Number(player.joinedAt) || joinedAt;
    } else {
      return false;
    }
    if (state.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
    return true;
  } catch (error) {
    console.warn('[suton-block] reconnect failed', error);
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
  if (role === 'guest' && state.run && !state.run.done && !window.confirm('ルームから出ますか？')) return;
  state.busy = true;
  state.leaving = true;
  // 退出の間に盤を送って、退出で書いた「ここまで」を上書きしないよう、先に止める（失敗したら handleRoom で続きから）
  if (role === 'guest') stopRun();
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す。あそんでいる回の盤と段の数は残す（結果に出る）
      await ref.transaction((room) => {
        if (!room) return;
        const mine = room.players?.[nickname];
        // 切れて在室から消えていても、その回の人なら「ここまで」は書く
        if (mine ? mine.uid !== uid : room.roundUids?.[nickname] !== uid) return;
        const players = { ...(room.players || {}) };
        delete players[nickname];
        // 対戦の「ここまで」で回の途中に出たら、その人はここまでにする（のこりの人だけで決着がつくように）
        const R = room.status === STATUS.PLAY ? roundOf(room) : null;
        if (R && isOutMode(R) && R.players.includes(nickname) && !isOut(room, R, nickname)) {
          const b = boardOf(room, R, nickname) || { round: R.id, lines: 0 };
          return { ...room, players, boards: { ...(room.boards || {}), [nickname]: { ...b, out: true, outAt: RoomkRTDB.now() } } };
        }
        if (!mine) return;
        return { ...room, players };
      });
    }
  } catch (error) {
    console.warn('[suton-block] leave failed', error);
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
    console.warn('[suton-block] watch failed', error);
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
  document.title = 'みんなにみせる画面 | すとんブロック | room-K';
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
    console.warn('[suton-block] watch listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });
  state.timerInterval = setInterval(() => {
    if (state.currentScreen === 'watch') updateWatchTimer();
  }, 500);
}

// ホストが切断している間はオーバーレイを出し、期限切れになったら終わりの表示にする（ルームは消さない）
// あそんでいる間はオーバーレイで盤をかくさず、バーに出す（参加者の画面と同じ）
function updateWatchOverlay(room) {
  const off = room.hostConnected === false;
  const playing = room.status === STATUS.PLAY && !!roundOf(room);
  $('hostOffOverlay').hidden = !off || playing;
  $('watchHostOff').hidden = !off || !playing;
  clearTimeout(state.watchTimer);
  state.watchTimer = null;
  if (!off) return;
  const until = expiryAt(room);
  if (until == null) return;
  const ref = state.roomRef;
  const delay = Math.max(0, until - RoomkRTDB.now()) + 500;
  state.watchTimer = setTimeout(() => {
    state.watchTimer = null;
    if (state.roomRef === ref && state.room && isExpired(state.room)) endWatch('このルームは終わりました');
  }, delay);
}

// 購読とタイマーを止めて、アドレスから watch を外す（ルームには触らない）
function stopWatch() {
  clearTimeout(state.watchTimer);
  clearInterval(state.timerInterval);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null, timerInterval: null });
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
    console.warn('[suton-block] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (lock) state.busy = false;
  }
}

function readRoomSettings() {
  const mode = document.querySelector('input[name="roomMode"]:checked').value === 'battle' ? 'battle' : 'lines';
  const full = document.querySelector('input[name="roomFull"]:checked').value === 'clear' ? 'clear' : 'out';
  return {
    mode,
    full,
    time: timeOf(document.querySelector('input[name="roomTime"]:checked').value, mode, full),
    speed: document.querySelector('input[name="roomSpeed"]:checked').value,
    jama: document.querySelector('input[name="roomJama"]:checked').value === 'on',
  };
}

// 対戦では「盤がいっぱいになったら」を出し、じゃまブロックの設定をかくす（いつもあり）。時間「なし」は「ここまで」のときだけ
function applyLobbyFields(s) {
  const battle = s.mode === 'battle';
  const noTime = battle && s.full === 'out';
  $('fsFull').hidden = !battle;
  $('fsJama').hidden = battle;
  $('modeNote').textContent = battle
    ? '2段いじょう消す・T を回し入れて消す・つづけて消すと、つぎの人の盤の下にじゃまが入る。来るじゃまは、送るぶんで先にへらせる。'
    : '時間内に消した段の数をくらべる。';
  $('timeNone').hidden = !noTime;
  $('timeSeg').classList.toggle('sb-seg--4', noTime);
  $('timeSeg').classList.toggle('sb-seg--3', !noTime);
  document.querySelector('input[name="roomTime"][value="' + s.time + '"]').checked = true;
}

// 設定は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない（中で今の値から作りなおす）
function saveSettings() {
  const settings = readRoomSettings();
  applyLobbyFields(settings);
  const hostPlays = $('hostPlays').checked;
  hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, settings, hostPlays };
  }, '設定を変えられませんでした', false);
}

function roundPlayers(room) {
  return memberNames(room).filter((name) => name !== room.host || room.hostPlays !== false);
}

async function startGame() {
  setError('startError', '');
  const room = state.room;
  if (!room || !roundPlayers(room).length) {
    setError('startError', 'あそぶ人がいないよ');
    return;
  }
  let players = [];
  // 種は transaction の外で1回だけ作る（やり直しのたびに変わると、先に始めた端末だけ別の順番になる）
  const seed = Math.floor(Math.random() * 2 ** 31);
  const ok = await hostTransaction((current) => {
    if (current.status !== STATUS.WAITING) return;
    players = roundPlayers(current);
    if (!players.length) return;
    const s = settingsOf(current);
    const id = (Number(current.lastRoundId) || 0) + 1;
    const uids = {};
    players.forEach((name) => { if (current.players?.[name]?.uid) uids[name] = current.players[name].uid; });
    return {
      ...current,
      status: STATUS.PLAY,
      lastRoundId: id,
      round: {
        id,
        seed,
        startedAt: serverTimestamp(),
        mode: s.mode,
        full: s.full,
        time: s.time,
        speed: s.speed,
        jama: s.mode === 'battle' || s.jama,
        players,
      },
      roundUids: uids,
      boards: null,
      jama: null,
      result: null,
    };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + players.length);
  }
}

async function endEarly() {
  if (state.role !== 'host') return;
  if (!window.confirm('みんなの回をここでおしまいにしますか？')) return;
  const R = roundOf(state.room);
  if (!R) return;
  await hostTransaction((room) => {
    const cur = roundOf(room);
    if (room.status !== STATUS.PLAY || !cur || cur.id !== R.id || cur.endedAt) return;
    return { ...room, round: { ...room.round, endedAt: serverTimestamp() } };
  }, 'おわれませんでした。もう一度ためしてね');
}

// 時間のあと（対戦の「ここまで」は、のこりが1人になったあと）、結果を出す。
// ホストの端末が出し、ホストのタブが裏に回っていても、あそぶ人の端末が少しあとに出す
function maybeFinishRound(room) {
  if (room.status !== STATUS.PLAY || state.finishing) return;
  const R = roundOf(room);
  if (!R) return;
  const mayFinish = state.role === 'host' || (state.role === 'guest' && R.players.includes(state.nickname));
  if (!mayFinish) return;
  const host = state.role === 'host';
  const now = RoomkRTDB.now();
  const overAt = battleOverAt(room, R);
  const timeUp = now >= endOf(R) + (host ? FINISH_GRACE_MS : FINISH_BACKUP_MS);
  const settled = overAt != null && now >= overAt + (host ? BATTLE_END_MS : FINISH_BACKUP_MS);
  if (!timeUp && !settled) return;
  state.finishing = true;
  const ref = state.roomRef;
  let finished = false;
  ref.transaction((current) => {
    finished = false;
    if (!current || isExpired(current) || current.status !== STATUS.PLAY) return;
    const cur = roundOf(current);
    if (!cur || cur.id !== R.id) return;
    const rows = cur.players.map((name) => {
      const b = boardOf(current, cur, name);
      const num = (v) => Math.max(0, Number(v) || 0);
      return {
        name,
        lines: num(b?.lines),
        sent: num(b?.sent),
        resets: num(b?.resets),
        out: b?.out === true,
        outAt: num(b?.outAt),
      };
    });
    finished = true;
    return { ...current, status: STATUS.RESULT, result: { id: cur.id, mode: cur.mode, full: cur.full, rows, at: serverTimestamp() }, jama: null };
  }).then(() => {
    if (finished) window.RoomkStats?.count('finish');
  }).catch((error) => {
    console.warn('[suton-block] finish failed', error);
  }).finally(() => {
    state.finishing = false;
  });
}

async function playAgain() {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.RESULT) return;
    return { ...room, status: STATUS.WAITING, round: null, roundUids: null, boards: null, jama: null, result: null };
  }, 'もどれませんでした。もう一度ためしてね');
  if (ok) window.RoomkStats?.count('again');
}

/* ── ルームの表示 ── */
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

function updateHostOverlay(room) {
  const off = state.role === 'guest' && room.hostConnected === false;
  // あそんでいる間（時間のあと結果を待つ間も）はオーバーレイで盤をかくさない（時間で結果が出るので、ホストがいなくても続けられる）
  const playing = room.status === STATUS.PLAY && !!state.run;
  $('hostOffOverlay').hidden = !off || playing;
  $('playHostOff').hidden = !off || !playing;
  if (off) {
    // 回が進むと期限が変わるので、そのたびに張りなおす
    clearTimeout(state.orphanTimer);
    const ref = state.roomRef;
    const until = expiryAt(room);
    const delay = until == null ? ORPHAN_TTL_MS : Math.max(0, until - RoomkRTDB.now()) + 500;
    state.orphanTimer = setTimeout(() => {
      state.orphanTimer = null;
      if (state.roomRef === ref && state.room) removeExpired(ref, state.room);
    }, delay);
  } else {
    clearTimeout(state.orphanTimer);
    state.orphanTimer = null;
  }
}

function renderRoom(room) {
  const R = roundOf(room);
  const playing = room.status === STATUS.PLAY && !!R;
  const isPlayer = playing && (state.role === 'host' || state.role === 'guest') && R.players.includes(state.nickname);
  if (room.status === STATUS.RESULT && room.result) {
    if (state.run) stopRun();
    if (state.currentScreen !== 'result') showScreen('result');
    renderRoomResult(room);
  } else if (isPlayer) {
    syncRun(room, R);
  } else if (playing && (state.role === 'spectator' || state.role === 'host')) {
    if (state.run) stopRun();
    if (state.currentScreen !== 'watch') showScreen('watch');
    $('btnWatchEnd').hidden = state.role !== 'host';
    $('btnWatchLeave').hidden = state.role !== 'spectator';
    renderWatch();
  } else {
    if (state.run) stopRun();
    if (state.currentScreen !== 'waiting') showScreen('waiting');
    renderWaiting(room, playing);
  }
  renderBar();
}

function renderBar() {
  let me = '';
  if (state.role === 'host') me = 'ホスト（' + state.nickname + '）';
  else if (state.role === 'guest') me = state.nickname;
  $('barMe').hidden = !me;
  $('barMe').textContent = me;
}

function renderWaiting(room, playing) {
  const host = state.role === 'host';
  const spectator = state.role === 'spectator';
  const s = settingsOf(room);
  $('lobbyJoin').hidden = !spectator;
  $('lobbyJoinCode').textContent = state.roomCode || '';
  const ul = $('lobbyPeople');
  ul.replaceChildren();
  memberNames(room).forEach((name) => {
    const li = document.createElement('li');
    li.append(msIcon(name === room.host ? 'star' : 'person'), makeElement('span', null, name + (name === state.nickname ? '（自分）' : '')));
    if (name === room.host && room.hostPlays === false) li.append(makeElement('span', 'sb-tag', 'あそぶ人の盤を見る'));
    ul.append(li);
  });
  $('lobbyLate').hidden = !playing;
  $('lobbyHost').hidden = !host || playing;
  $('btnStartGame').hidden = !host || playing;
  $('lobbyWait').hidden = host || spectator || playing;
  $('lobbySettings').hidden = host && !playing;
  $('lobbySettings').textContent = 'いまの設定: ' + settingsText(s);
  if (host && !playing) {
    // 自分で押しているときに上書きしない（値が同じなら触らない）
    document.querySelector('input[name="roomMode"][value="' + s.mode + '"]').checked = true;
    document.querySelector('input[name="roomFull"][value="' + s.full + '"]').checked = true;
    applyLobbyFields(s);
    document.querySelector('input[name="roomSpeed"][value="' + s.speed + '"]').checked = true;
    document.querySelector('input[name="roomJama"][value="' + (s.jama ? 'on' : 'off') + '"]').checked = true;
    $('hostPlays').checked = room.hostPlays !== false;
  }
}

function renderRoomResult(room) {
  const rows = Array.isArray(room.result?.rows) ? room.result.rows : [];
  const num = (v) => Math.max(0, Number(v) || 0);
  const mode = room.result?.mode === 'battle' ? 'battle' : 'lines';
  const full = room.result?.full === 'clear' ? 'clear' : 'out';
  showRanking(rows.map((r) => ({
    name: String(r?.name || ''),
    lines: num(r?.lines),
    sent: num(r?.sent),
    resets: num(r?.resets),
    out: r?.out === true,
    outAt: num(r?.outAt),
  })), mode, full);
  const host = state.role === 'host';
  $('btnAgain').hidden = !host;
  $('btnResultTop').hidden = true;
  $('resultWait').hidden = host || state.role === 'spectator';
}

// 順位のくらべ方。段の数をくらべる: 消した段の数 / 対戦（からにしてつづける）: 送ったじゃまの数 /
// 対戦（ここまで）: のこった人が上（その中は送ったじゃまの数）、ここまでになった人は、あとまでのこった人が上
function rankKey(r, mode, full) {
  if (mode !== 'battle') return [r.lines];
  if (full === 'clear') return [r.sent];
  return r.out ? [0, r.outAt] : [1, r.sent];
}

function showRanking(rows, mode = 'lines', full = 'out') {
  const keyed = rows.map((r) => ({ r, k: rankKey(r, mode, full) }));
  const cmp = (a, b) => {
    for (let i = 0; i < Math.max(a.k.length, b.k.length); i++) if ((b.k[i] || 0) !== (a.k[i] || 0)) return (b.k[i] || 0) - (a.k[i] || 0);
    return 0;
  };
  keyed.sort(cmp);
  const ol = makeElement('ol', 'sb-rank');
  let rank = 0;
  keyed.forEach((x, i) => {
    const r = x.r;
    if (i === 0 || cmp(keyed[i - 1], x) !== 0) rank = i + 1;
    const li = document.createElement('li');
    if (r.name === state.nickname) li.classList.add('is-me');
    const who = makeElement('span', 'sb-rank__who');
    const sub = [];
    if (mode === 'battle') {
      if (full === 'out') sub.push(r.out ? 'ここまで' : 'のこった');
      sub.push('消した段 ' + r.lines);
    }
    if (!(mode === 'battle' && full === 'out')) sub.push('からにした ' + r.resets + '回');
    who.append(makeElement('span', 'sb-rank__name', r.name), makeElement('span', 'sb-rank__sub', sub.join('・')));
    const main = mode === 'battle' ? '送った ' + r.sent + '段' : r.lines + '段';
    li.append(makeElement('span', 'sb-rank__no', rank + '位'), who, makeElement('span', 'sb-rank__lines', main));
    ol.append(li);
  });
  $('resultBody').replaceChildren(ol);
}

function showSoloResult(g) {
  const p = makeElement('p', 'sb-solo-result');
  p.append('消した段 ', makeElement('strong', null, g.lines), document.createElement('br'), '置いたブロック ' + g.pieces + 'こ');
  if (g.onFull === 'clear') p.append(document.createElement('br'), 'からにした ' + g.resets + '回');
  $('resultBody').replaceChildren(p);
  $('btnAgain').hidden = false;
  $('btnResultTop').hidden = false;
  $('resultWait').hidden = true;
  showScreen('result');
}

/* ── あそぶ（ひとり・ルーム共通） ── */
const nowOf = () => (state.role === 'solo' ? Date.now() : RoomkRTDB.now());

function startRun(o) {
  stopRun();
  state.game = o.saved ? E.restoreGame({ seed: o.seed, onFull: o.onFull }, o.saved) : E.createGame({ seed: o.seed, onFull: o.onFull });
  const now = nowOf();
  state.run = {
    speedMs: SPEED[o.speed] || SPEED.slow,
    lastFall: now, lockAt: null, resets: 0,
    startAt: o.startAt || 0, endAt: o.endAt || 0, showTimer: !!o.endAt && o.showTimer !== false,
    done: false, raf: 0, noteTimer: 0, paused: false,
    jama: !!o.jama, pending: Math.max(0, Math.min(E.H, Number(o.pending) || 0)),
    battle: !!o.battle,                    // 対戦（送るじゃまは表で決める）
    sent: Math.max(0, Number(o.sent) || 0), // 送ったじゃまの数
    outAt: Number(o.outAt) || null,         // 対戦の「ここまで」になった時刻
  };
  const room = state.role !== 'solo';
  $('playTimer').hidden = !state.run.showTimer;
  $('playLinesLabel').textContent = state.run.battle ? '送ったじゃま' : '消した段';
  $('playTimer').textContent = '';
  $('btnPlayEnd').textContent = state.role === 'host' ? '早めにおわる' : room ? '退出する' : 'おわる';
  $('btnPause').hidden = room;
  $('pauseCover').hidden = true;
  $('playLines').textContent = String(state.run.battle ? state.run.sent : state.game.lines);
  $('playNote').hidden = true;
  $('jamaBox').hidden = !state.run.jama;
  renderJama();
  showScreen('play');
  renderOthers(); // スマホのほかの人の一覧の高さを、layout で「つぎ」の数を決めるときに使う
  layout();
  state.run.raf = requestAnimationFrame(tick);
}

function stopRun() {
  if (!state.run) return;
  cancelAnimationFrame(state.run.raf);
  clearTimeout(state.run.noteTimer);
  state.run = null;
  stopRepeat();
  $('countdown').hidden = true;
  $('pauseCover').hidden = true;
}

// ひとりのときだけ、とめる・つづける（とめている間は落ちず、時間も進まない。ずらすのは tick）
function setPaused(on) {
  const R = state.run;
  if (state.role !== 'solo' || !R || R.done) return;
  R.paused = on;
  stopRepeat();
  $('pauseCover').hidden = !on;
  $('btnPause').hidden = on;
}

// ルームの値から、あそんでいる回を始める・時計を合わせる・じゃまを受けとる
function syncRun(room, R) {
  if (state.playRound !== R.id || state.playSeed !== R.seed || !state.run) {
    state.playRound = R.id;
    state.playSeed = R.seed;
    state.jamaSeen.clear();
    const mine = boardOf(room, R, state.nickname);
    startRun({
      seed: R.seed, speed: R.speed, jama: R.jama, onFull: isOutMode(R) ? 'end' : 'clear',
      startAt: playStartOf(R), endAt: endOf(R), showTimer: R.time > 0,
      battle: isBattle(R),
      saved: mine && (Number(mine.taken) || mine.out) ? mine : null,
      pending: mine ? Number(mine.pending) || 0 : 0,
      sent: mine ? Number(mine.sent) || 0 : 0,
      outAt: mine ? Number(mine.outAt) || null : null,
    });
    if (mine && (mine.done || mine.out)) finishRun();
  } else {
    // 手元で見積もった「はじめた時刻」は、サーバーの時刻が届いたら合わせる
    state.run.startAt = playStartOf(R);
    state.run.endAt = endOf(R);
  }
  receiveJama(room, R);
  renderOthers();
  updateHostOverlay(room);
}

function playing() {
  const R = state.run;
  return R && !R.done && !R.paused && nowOf() >= R.startAt;
}

function grounded() {
  const g = state.game, p = g.piece;
  return p && !E.fits(g.board, p, p.cells, p.x, p.y + 1);
}

// 動かせたあとの着地の待ち
function afterMove(moved) {
  const R = state.run;
  if (!moved) return;
  if (grounded()) {
    if (R.lockAt === null) R.lockAt = nowOf() + LOCK_MS;
    else if (R.resets < LOCK_RESETS) { R.resets++; R.lockAt = nowOf() + LOCK_MS; }
  } else R.lockAt = null;
  draw();
}

function afterLock(res) {
  const R = state.run, g = state.game;
  let outgoing = null;
  R.lockAt = null; R.resets = 0; R.lastFall = nowOf();
  const bump = (value) => {
    const el = $('playLines');
    el.textContent = String(value);
    el.classList.remove('sb-lines--up');
    void el.offsetWidth;
    el.classList.add('sb-lines--up');
  };
  if (res.lines && !R.battle) bump(g.lines);
  if (R.battle) {
    // 対戦: 送るじゃまは表で決める（attack）。来るじゃまがあれば先にへらし、のこりを送る
    let atk = res.attack || 0;
    const cancel = Math.min(R.pending, atk);
    R.pending -= cancel;
    atk -= cancel;
    // 送るじゃまは、盤（送った数・来るじゃま）と同じ1回の update で書く（片方だけ届くと、読み込み直したとき数がずれる）
    const to = atk > 0 ? jamaTarget() : null;
    if (to) {
      R.sent += atk;
      outgoing = { ['jama/' + to + '/' + state.roomRef.child('jama/' + to).push().key]: { round: state.playRound, rows: atk, from: state.nickname } };
      bump(R.sent);
    }
    attackNote(res, to ? atk : 0, cancel);
    if (!res.lines && R.pending > 0 && !g.over) {
      const rows = R.pending;
      R.pending = 0;
      const gr = E.addGarbage(g, rows, Math.floor(Math.random() * E.W));
      if (gr.cleared) res = { ...res, cleared: true };
    }
    renderJama();
  } else if (R.jama) {
    // 2段いじょういっしょに消したら、となりの人へ（消した段数−1）段。
    // 来るじゃまがあれば、消した段の数だけ先にへらし、へらしたぶん送る段も少なくなる
    let atk = Math.max(0, res.lines - 1);
    const cancel = Math.min(R.pending, res.lines);
    R.pending -= cancel;
    atk = Math.max(0, atk - cancel);
    if (atk > 0) sendJama(atk);
    if (!res.lines && R.pending > 0 && !g.over) {
      const rows = R.pending;
      R.pending = 0;
      const gr = E.addGarbage(g, rows, Math.floor(Math.random() * E.W));
      if (gr.cleared) res = { ...res, cleared: true };
    }
    renderJama();
  }
  if (res.cleared) note('盤がいっぱいになったので、からにしたよ。つづけよう', 1800);
  sendBoard(false, outgoing);
  if (g.over) { finishRun(); return; }
  draw();
}

// 対戦で、大技・れんぞくのときと、じゃまを送った・へらしたときに一言出す
function attackNote(res, sent, cancel) {
  const parts = [];
  if (res.allClear) parts.push('全部消えた！');
  else if (res.spin === 'spin') parts.push('回し入れ！');
  else if (res.spin === 'mini' && res.lines) parts.push('小さな回し入れ');
  if (res.b2b) parts.push('つづけて大技！');
  if (res.combo >= 1) parts.push((res.combo + 1) + 'れんぞく！');
  if (sent > 0) parts.push(sent + '段おくったよ');
  else if (cancel > 0) parts.push('来るじゃまを' + cancel + '段へらしたよ');
  if (parts.length) note(parts.join(' '), 1400);
}

function note(text, ms) {
  const el = $('playNote');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(state.run.noteTimer);
  if (ms) state.run.noteTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// 置くたびに、自分の盤と続きに要るもの（読み込み直し用）を送る。extra（対戦で送るじゃま）があれば同じ update に入れる
function sendBoard(done = false, extra = null) {
  if (state.role === 'solo' || !state.roomRef || !state.playRound || state.leaving) return;
  const g = state.game;
  const board = {
    round: state.playRound,
    b: E.packBoard(g.board),
    lines: g.lines,
    pieces: g.pieces,
    resets: g.resets,
    taken: g.taken,
    hold: g.hold || null,
    holdUsed: !!g.holdUsed,
    b2b: !!g.b2b,
    combo: g.combo,
    sent: state.run ? state.run.sent : 0,
    pending: state.run ? state.run.pending : 0,
    done: done || !!(state.run && state.run.done),
    // 対戦の「ここまで」（いっぱいで止まった）。時刻は1回だけ決める（順位に使う）
    out: !!g.over,
    outAt: g.over && state.run ? (state.run.outAt = state.run.outAt || RoomkRTDB.now()) : null,
  };
  state.roomRef.update({ ['boards/' + state.nickname]: board, ...(extra || {}) })
    .catch((error) => console.warn('[suton-block] board send failed', error));
}

// 並びで name のつぎの、のこっている人（対戦で「ここまで」になった人はとばす）。いなければ null
function nextAlive(room, R, name) {
  const i = R.players.indexOf(name);
  if (i < 0) return null;
  for (let k = 1; k < R.players.length; k++) {
    const to = R.players[(i + k) % R.players.length];
    if (!isOut(room, R, to)) return to;
  }
  return null;
}

// 対戦でじゃまを送る相手
function jamaTarget() {
  const R = roundOf(state.room);
  if (!R || !state.roomRef || R.players.length < 2) return null;
  return nextAlive(state.room, R, state.nickname);
}

// じゃまを送る相手は、あそぶ人の並びで自分のつぎの人（段の数をくらべるときのじゃまブロック）
function sendJama(rows) {
  const R = roundOf(state.room);
  if (!R || !state.roomRef) return;
  const i = R.players.indexOf(state.nickname);
  if (i < 0 || R.players.length < 2) return;
  const to = R.players[(i + 1) % R.players.length];
  state.roomRef.child('jama/' + to).push({ round: R.id, rows, from: state.nickname })
    .catch((error) => console.warn('[suton-block] jama send failed', error));
}

function receiveJama(room, R) {
  const run = state.run;
  if (!run || !run.jama || run.done) return;
  // 自分あてのほか、対戦で「ここまで」になった人あてに届いたじゃまのうち、その人のつぎののこっている人が自分のものも受けとる
  // （ここまでになったのを相手が知る前に送ったじゃまが、なくならないように）
  const owners = [state.nickname];
  if (isOutMode(R)) R.players.forEach((name) => { if (name !== state.nickname && isOut(room, R, name) && nextAlive(room, R, name) === state.nickname) owners.push(name); });
  let added = 0;
  const done = {};
  owners.forEach((owner) => {
    const box = room.jama?.[owner];
    if (!box || typeof box !== 'object') return;
    Object.entries(box).forEach(([key, v]) => {
      if (state.jamaSeen.has(key)) return;
      state.jamaSeen.add(key);
      if (Number(v?.round) === R.id) added += Math.max(0, Math.min(E.H, Number(v.rows) || 0));
      done['jama/' + owner + '/' + key] = null;
    });
  });
  if (!Object.keys(done).length) return;
  run.pending = Math.min(run.pending + added, E.H);
  // 来るじゃまの数を自分の盤の記録に書くのと、受けとったじゃまを消すのを同じ1回の update にする
  // （先に消すと、つぎに置く前に読み込み直したとき、来るじゃまがなくなる）
  done['boards/' + state.nickname + '/pending'] = run.pending;
  done['boards/' + state.nickname + '/round'] = R.id;
  const keys = Object.keys(done).filter((k) => k.startsWith('jama/')).map((k) => k.split('/').pop());
  state.roomRef.update(done).catch((error) => {
    // 書けなかったら、数えたぶんをもどし、つぎのルームの更新でやりなおす
    console.warn('[suton-block] jama receive failed', error);
    keys.forEach((k) => state.jamaSeen.delete(k));
    if (state.run === run) {
      run.pending = Math.max(0, run.pending - added);
      renderJama();
    }
  });
  renderJama();
}

function renderJama() {
  const R = state.run;
  if (!R || !R.jama) return;
  const el = $('playJama');
  el.textContent = R.pending + '段';
  el.classList.toggle('is-coming', R.pending > 0);
}

function tick() {
  const R = state.run;
  if (!R) return;
  const now = nowOf();
  // ひとりのときは「とめる」の間と「あそびかた」を開いている間（あそぶ画面が inert）は止め、つづけたら止めていたぶんだけずらす
  if (state.role === 'solo') {
    if (R.paused || $('screen-play').inert) {
      if (!R.pausedAt) R.pausedAt = now;
      R.raf = requestAnimationFrame(tick);
      return;
    }
    if (R.pausedAt) {
      const d = now - R.pausedAt;
      R.pausedAt = 0;
      R.lastFall += d;
      if (R.lockAt !== null) R.lockAt += d;
      if (R.endAt) R.endAt += d;
    }
  }
  const cd = $('countdown');
  if (now < R.startAt) {
    cd.hidden = false;
    cd.textContent = String(Math.min(3, Math.ceil((R.startAt - now) / 1000)));
    R.lastFall = now;
    draw();
    R.raf = requestAnimationFrame(tick);
    return;
  }
  cd.hidden = true;
  if (R.endAt) {
    if (R.showTimer) {
      const t = $('playTimer');
      t.textContent = clockText(R.endAt - now);
      t.classList.toggle('sb-timer--low', R.endAt - now <= 10000);
    }
    if (!R.done && now >= R.endAt) { finishRun(); if (!state.run) return; }
  }
  if (!R.done) {
    const g = state.game;
    if (now - R.lastFall >= R.speedMs) {
      R.lastFall = now;
      if (E.move(g, 0, 1)) { if (!grounded()) R.lockAt = null; else if (R.lockAt === null) R.lockAt = now + LOCK_MS; }
      else if (R.lockAt === null) R.lockAt = now + LOCK_MS;
    }
    if (R.lockAt !== null && now >= R.lockAt) {
      if (grounded()) { afterLock(E.lock(g)); if (!state.run) return; }
      else R.lockAt = null;
    }
    draw();
  }
  R.raf = requestAnimationFrame(tick);
}

function finishRun() {
  const R = state.run;
  if (!R || R.done) return;
  R.done = true;
  stopRepeat();
  draw();
  if (state.role === 'solo') {
    const g = state.game;
    stopRun();
    window.RoomkStats?.count('solo-finish');
    showSoloResult(g);
    return;
  }
  sendBoard(true);
  if (state.game.over) {
    note('ここまで！ ほかの人がおわるのを待ってね', 0);
    return;
  }
  if (R.showTimer) $('playTimer').textContent = '0:00';
  note('時間になったよ。結果を待ってね', 0);
}

// ── 操作 ──
function act(name) {
  if (!playing()) return;
  const g = state.game;
  switch (name) {
    case 'left': afterMove(E.move(g, -1, 0)); break;
    case 'right': afterMove(E.move(g, 1, 0)); break;
    case 'down':
      if (E.move(g, 0, 1)) { state.run.lastFall = nowOf(); afterMove(true); }
      else if (state.run.lockAt === null) state.run.lockAt = nowOf() + LOCK_MS;
      break;
    case 'drop': afterLock(E.hardDrop(g)); break;
    case 'rotr': afterMove(E.rotate(g, 1)); break;
    case 'rotl': afterMove(E.rotate(g, -1)); break;
    case 'hold': {
      const res = E.hold(g);
      if (!res) break;
      const R = state.run;
      R.lockAt = null; R.resets = 0; R.lastFall = nowOf();
      if (res.cleared) note('盤がいっぱいになったので、からにしたよ。つづけよう', 1800);
      if (g.over) { finishRun(); break; }
      draw();
      break;
    }
    default:
  }
}

const KEYMAP = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'down', ArrowUp: 'rotr',
  ' ': 'drop', x: 'rotr', X: 'rotr', z: 'rotl', Z: 'rotl',
  c: 'hold', C: 'hold', Shift: 'hold',
};
const REPEATABLE = { left: true, right: true, down: true };
document.addEventListener('keydown', (e) => {
  // 「あそびかた」を開いている間は、あそぶ画面が inert になるので動かさない
  if (state.currentScreen !== 'play' || $('screen-play').inert || e.ctrlKey || e.metaKey || e.altKey) return;
  // ひとりのときは P でとめる・つづける
  if ((e.key === 'p' || e.key === 'P') && state.role === 'solo' && state.run) {
    e.preventDefault();
    if (!e.repeat) setPaused(!state.run.paused);
    return;
  }
  const a = KEYMAP[e.key];
  if (!a) return;
  e.preventDefault();
  if (e.repeat && !REPEATABLE[a]) return;
  act(a);
});

// マウス: 盤の上で左右に動かすと、ブロックがその列へ動く。左クリックですとん、右クリックで右に回す、
// ホイールで回す（上で左回り・下で右回り）。タッチ・ペンは画面のボタンを使う
function moveToColumn(col) {
  const g = state.game;
  for (let guard = 0; guard < E.W && g.piece; guard++) {
    const xs = g.piece.cells.map(([x]) => g.piece.x + x);
    const cur = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    if (cur === col) return;
    const moved = E.move(g, cur < col ? 1 : -1, 0);
    afterMove(moved);
    if (!moved) return;
  }
}
const boardCanvas = $('board');
boardCanvas.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' || !playing()) return;
  const rect = boardCanvas.getBoundingClientRect();
  const col = Math.max(0, Math.min(E.W - 1, Math.floor((e.clientX - rect.left) / (rect.width / E.W))));
  moveToColumn(col);
});
boardCanvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') return;
  e.preventDefault();
  if (e.button === 0) act('drop');
  else if (e.button === 2) act('rotr');
});
boardCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
let wheelAt = 0;
boardCanvas.addEventListener('wheel', (e) => {
  if (state.currentScreen !== 'play') return;
  e.preventDefault();
  // トラックパッドの細かいスクロールで回りすぎないよう、0.15秒に1回まで
  const now = Date.now();
  if (!e.deltaY || now - wheelAt < 150) return;
  wheelAt = now;
  act(e.deltaY < 0 ? 'rotl' : 'rotr');
}, { passive: false });

// 画面のボタン。左右と下は押しっぱなしでくり返す
let rep = null;
function stopRepeat() {
  if (!rep) return;
  clearTimeout(rep.t);
  clearInterval(rep.i);
  rep = null;
}
document.querySelectorAll('.sb-padbtn').forEach((btn) => {
  const a = btn.dataset.act;
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stopRepeat();
    act(a);
    if (REPEATABLE[a]) {
      rep = { t: setTimeout(() => { if (rep) rep.i = setInterval(() => act(a), 55); }, 180), i: 0 };
    }
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => btn.addEventListener(ev, stopRepeat));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
});

/* ── 描く ── */
let CELL = 24;
let nextShow = { count: NEXT_MAX, small: NEXT_SMALL };
function isRoomPlayer() {
  const R = roundOf(state.room);
  return !!R && (state.role === 'host' || state.role === 'guest') && R.players.includes(state.nickname);
}
function otherPlayers() {
  const R = roundOf(state.room);
  return R && isRoomPlayer() ? R.players.filter((name) => name !== state.nickname) : [];
}

function layout() {
  // スマホでは、はみ出しがあると innerWidth も広がるので clientWidth で測る
  const cw = document.documentElement.clientWidth || window.innerWidth;
  const vw = Math.min(cw, 960);
  const narrow = cw <= 480;
  const side = narrow ? 92 : 112;
  // ルームで広い画面なら、ほかの人の盤を右にもう1列ならべる
  const othersCol = !narrow && otherPlayers().length ? 164 + 16 : 0;
  const byW = Math.floor((vw - 34 - 16 - side - othersCol) / E.W);
  const byH = Math.floor((window.innerHeight - 56 - 134 - (narrow ? 16 : 66)) / E.H); // バー・ボタン2段・キーとマウスの説明
  CELL = Math.max(14, Math.min(30, byW, byH));
  sizeCanvas($('board'), CELL * E.W, CELL * E.H);
  const nc = Math.floor((side - 18) / 4);
  sizeCanvas($('hold'), nc * 4, Math.round(nc * 2.4));
  // 「つぎ」は5つまで。横の列（とっておく・来るじゃま・ほかの人の一覧など）が盤より長くならない数だけ出す（2つより減らさない）
  const small = narrow ? NEXT_SMALL_NARROW : NEXT_SMALL;
  const nextBox = $('next').parentElement;
  const sideGap = parseFloat(getComputedStyle(nextBox.parentElement).rowGap) || 0;
  const rest = [...nextBox.parentElement.children]
    .filter((el) => el !== nextBox && el.offsetHeight > 0)
    .reduce((sum, el) => sum + el.offsetHeight + sideGap, 0);
  const space = CELL * E.H - rest - (nextBox.offsetHeight - $('next').offsetHeight);
  let count = NEXT_MAX;
  while (count > 2 && nc * (NEXT_FIRST + (count - 1) * small.slot) > space) count--;
  nextShow = { count, small };
  sizeCanvas($('next'), nc * 4, Math.round(nc * (NEXT_FIRST + (count - 1) * small.slot)));
  draw();
}

function sizeCanvas(cv, w, h) {
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = w + 'px';
  cv.style.height = h + 'px';
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', () => {
  if (state.currentScreen === 'play') { renderOthers(); layout(); }
  if (state.currentScreen === 'watch') renderWatch();
});

function cellRect(ctx, x, y, s, color, ghost) {
  if (ghost) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 2, y + 2, s - 4, s - 4);
    return;
  }
  ctx.fillStyle = color;
  ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  if (s >= 12) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(x + 1, y + 1, s - 2, Math.max(2, Math.floor(s / 6)));
  }
}

function drawWell(ctx, board, s) {
  const w = s * E.W, h = s * E.H;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1F2A36';
  ctx.fillRect(0, 0, w, h);
  if (s >= 12) {
    ctx.strokeStyle = '#2C3A48';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < E.W; x++) { ctx.moveTo(x * s + 0.5, 0); ctx.lineTo(x * s + 0.5, h); }
    for (let y = 1; y < E.H; y++) { ctx.moveTo(0, y * s + 0.5); ctx.lineTo(w, y * s + 0.5); }
    ctx.stroke();
  }
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) {
    const c = board[y][x];
    if (c) cellRect(ctx, x * s, y * s, s, COLORS[c]);
  }
}

function draw() {
  const g = state.game;
  if (!g || state.currentScreen !== 'play') return;
  const ctx = $('board').getContext('2d');
  drawWell(ctx, g.board, CELL);
  const p = g.piece;
  if (p) {
    const gy = E.dropY(g);
    p.cells.forEach(([cx, cy]) => { if (gy + cy >= 0) cellRect(ctx, (p.x + cx) * CELL, (gy + cy) * CELL, CELL, COLORS[p.kind], true); });
    p.cells.forEach(([cx, cy]) => { if (p.y + cy >= 0) cellRect(ctx, (p.x + cx) * CELL, (p.y + cy) * CELL, CELL, COLORS[p.kind]); });
  }
  drawNext();
  drawHold();
}

// 箱の中のまん中に、ブロックを1つ描く
function drawSpecIn(ctx, spec, w, top, height, ss) {
  const p = E.newPiece(spec);
  const xs = p.cells.map((c) => c[0]), ys = p.cells.map((c) => c[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const ox = (w - (maxX - minX + 1) * ss) / 2;
  const oy = top + (height - (maxY - minY + 1) * ss) / 2;
  p.cells.forEach(([cx, cy]) => cellRect(ctx, ox + (cx - minX) * ss, oy + (cy - minY) * ss, ss, COLORS[p.kind]));
}

function drawNext() {
  const cv = $('next');
  const ctx = cv.getContext('2d');
  const w = parseFloat(cv.style.width), h = parseFloat(cv.style.height);
  const s = w / 4;
  ctx.clearRect(0, 0, w, h);
  // 1つ目は大きく、2つ目からは小さく（スマホではもう少し小さく）
  const { count, small } = nextShow;
  state.game.queue.slice(0, count).forEach((spec, i) => {
    const top = i ? NEXT_FIRST + (i - 1) * small.slot : 0;
    drawSpecIn(ctx, spec, w, top * s, (i ? small.slot : NEXT_FIRST) * s, s * (i ? small.k : 1));
  });
}

function drawHold() {
  const cv = $('hold');
  const ctx = cv.getContext('2d');
  const w = parseFloat(cv.style.width), h = parseFloat(cv.style.height);
  ctx.clearRect(0, 0, w, h);
  const g = state.game;
  cv.classList.toggle('is-used', !!g.holdUsed);
  if (g.hold) drawSpecIn(ctx, g.hold, w, 0, h, w / 4.4);
}

function miniCard(name, s) {
  const room = state.room;
  const R = roundOf(room);
  const b = R ? boardOf(room, R, name) : null;
  const box = makeElement('div', 'sb-mini');
  // ホストは切れても在室に残るので、hostConnected で見る。退出した人と切れた人は区別できないので「いない」とだけ出す
  const away = name === room?.host ? room.hostConnected === false : !room?.players?.[name];
  const out = b?.out === true;
  if (away || out) box.classList.add('is-off');
  const cv = document.createElement('canvas');
  sizeCanvas(cv, s * E.W, s * E.H);
  drawWell(cv.getContext('2d'), E.unpackBoard(b?.b), s);
  box.append(
    makeElement('div', 'sb-mini__name', name),
    // 小さな盤（右の列）はせまいので、数だけか「ここまで」だけ。ならべて見る画面の大きな盤はくわしく
    makeElement('div', 'sb-mini__lines', (s >= 12 ? statText(R, b) + (out ? '・ここまで' : '') : out ? 'ここまで' : statText(R, b, true)) + (away ? '・いまはいない' : '')),
    cv,
  );
  return box;
}

// ほかの人の盤に出す数。段の数をくらべるときは消した段、対戦は送ったじゃま（short はせまい欄むけに数だけ）
function statText(R, b, short = false) {
  if (!isBattle(R)) return (b ? Number(b.lines) || 0 : 0) + '段';
  return (short ? '' : '送った') + (b ? Number(b.sent) || 0 : 0) + '段';
}

// ほかの人: 広い画面は小さな盤を右の列に、スマホは名前と段の数だけを横の欄に
function renderOthers() {
  if (state.currentScreen !== 'play') return;
  const wrap = $('others');
  const list = $('othersList');
  wrap.replaceChildren();
  list.replaceChildren();
  const names = otherPlayers();
  const narrow = (document.documentElement.clientWidth || window.innerWidth) <= 480;
  wrap.hidden = narrow || !names.length;
  list.hidden = !narrow || !names.length;
  if (!names.length) return;
  const room = state.room;
  const R = roundOf(room);
  if (narrow) {
    names.slice(0, 4).forEach((name) => {
      const b = boardOf(room, R, name);
      const li = document.createElement('li');
      if (b?.out === true) li.classList.add('is-out');
      li.append(makeElement('span', 'sb-otherlist__name', name), makeElement('span', 'sb-otherlist__lines', b?.out === true ? 'ここまで' : statText(R, b, true)));
      list.append(li);
    });
    return;
  }
  const s = names.length > 4 ? 5 : 6;
  names.slice(0, 6).forEach((name) => wrap.append(miniCard(name, s)));
}

// あそぶ人の盤をならべて見る画面
function renderWatch() {
  const R = roundOf(state.room);
  const grid = $('watchGrid');
  grid.replaceChildren();
  if (!R) return;
  const n = Math.max(1, R.players.length);
  const avail = Math.min((document.documentElement.clientWidth || window.innerWidth) - 32, 1100);
  const perRow = Math.min(n, avail < 600 ? 2 : 4);
  const byW = Math.floor((avail - 16 * perRow) / perRow / E.W) - 2;
  const byH = Math.floor((window.innerHeight - 160) / (E.H * Math.ceil(n / perRow)));
  const s = Math.max(6, Math.min(22, byW, byH));
  R.players.forEach((name) => grid.append(miniCard(name, s)));
  updateWatchTimer();
}

function updateWatchTimer() {
  const R = roundOf(state.room);
  if (!R) return;
  const now = RoomkRTDB.now();
  const t = $('watchTimer');
  if (now < playStartOf(R)) { t.textContent = 'まもなく'; return; }
  if (!R.time && !R.endedAt) { t.textContent = '時間なし'; return; }
  t.textContent = clockText(endOf(R) - now);
  t.classList.toggle('sb-timer--low', endOf(R) - now <= 10000);
}

/* ── ひとりであそぶ ── */
function startSolo() {
  state.role = 'solo';
  const s = state.solo;
  s.speed = document.querySelector('input[name="soloSpeed"]:checked').value;
  s.time = Number(document.querySelector('input[name="soloTime"]:checked').value);
  s.onFull = document.querySelector('input[name="soloFull"]:checked').value;
  window.RoomkStats?.count('solo-start');
  startRun({ seed: Math.floor(Math.random() * 2 ** 31), speed: s.speed, onFull: s.onFull, endAt: s.time ? Date.now() + s.time * 1000 : 0 });
}

function quitSolo() {
  stopRun();
  state.role = null;
  state.game = null;
  showScreen('top');
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
$('btnGoSolo').addEventListener('click', () => showScreen('solo'));
$('btnGoWatch').addEventListener('click', () => {
  setError('watchError', '');
  showScreen('watch-join');
});
['btnCreateBack', 'btnJoinBack', 'btnWatchBack', 'btnSoloBack', 'btnWatchEndTop'].forEach((id) => {
  $(id).addEventListener('click', () => showScreen('top'));
});
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('hostName'), createRoom);
submitOnEnter($('guestName'), joinRoom);
submitOnEnter($('joinCode'), joinRoom);
$('btnSoloStart').addEventListener('click', startSolo);

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

$('lobbyHost').addEventListener('change', saveSettings);
$('btnStartGame').addEventListener('click', startGame);
$('btnWatchEnd').addEventListener('click', endEarly);
$('btnWatchLeave').addEventListener('click', leaveWatch);
$('btnPlayEnd').addEventListener('click', () => {
  if (state.role === 'host') endEarly();
  else if (state.role === 'guest') leaveRoom();
  else if (state.role === 'solo' && state.run && !state.run.done) {
    const g = state.game;
    stopRun();
    window.RoomkStats?.count('solo-finish');
    showSoloResult(g);
  }
});
$('btnPause').addEventListener('click', () => setPaused(true));
$('btnResume').addEventListener('click', () => setPaused(false));
$('btnAgain').addEventListener('click', () => {
  if (state.role === 'solo') startSolo();
  else if (state.role === 'host') playAgain();
});
$('btnResultTop').addEventListener('click', quitSolo);

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
