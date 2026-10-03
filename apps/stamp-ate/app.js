// スタンプあてゲーム：4つの形のスタンプでお題を表し、当てる人がどの絵がどのお題かを当てる協力ゲーム。
// 『インクdeリンク！』（原題 Ink It!）から着想した。ルーム（Realtime Database）で進める。
// 押した絵とお題はそのゲームの間だけルームに置き、「もう一回あそぶ」とルームを閉じたときに消える。

// お題（基準は AGENTS.md「お題の方針」）。ルームでは番号だけを共有するので、
// 並べ替え・途中の削除はしない。追加は末尾だけ。
// お題は押す人が1人で読むので、漢字は小学4年までに習う字にとどめる
const TOPICS = [
  // 食べもの
  'りんご', 'バナナ', 'すいか', 'ぶどう', 'いちご',
  'パイナップル', 'ピザ', 'ハンバーガー', 'おにぎり', 'ショートケーキ',
  'ドーナツ', 'ソフトクリーム', '目玉焼き', 'ホットドッグ', 'おでん',
  'おすし', 'たこ焼き', 'パンケーキ', 'かき氷', 'サンドイッチ',
  // 生きもの
  'ネコ', 'イヌ', 'ウサギ', 'パンダ', 'ペンギン',
  'キリン', 'ゾウ', 'カメ', 'カエル', 'クジラ',
  'タコ', 'カニ', 'てんとう虫', 'チョウ', 'ニワトリ',
  'フクロウ', 'ライオン', 'ワニ', '金魚', 'ヒヨコ',
  // のりもの・まち
  '電車', 'バス', '自転車', '飛行機', 'ロケット',
  '船', '信号機', 'しょうぼう車', 'パトカー', '気球',
  'ヘリコプター', 'ショベルカー', 'かんらん車', 'ビル', '家',
  '橋', '公園', '灯台', 'ふみきり', '駅',
  // 自然・天気・きせつ
  '太陽', '月', '星空', 'にじ', '雪だるま',
  '雨', 'かみなり', '台風', '火山', '島',
  '森', '海', '花火', 'ひまわり', 'チューリップ',
  'クリスマスツリー', 'お月見', 'こいのぼり', 'もみじ', '夕やけ',
  // あそび・できごと
  'サッカー', '野球', 'バスケットボール', 'テニス', 'プール',
  'なわとび', 'かくれんぼ', 'すべり台', 'ブランコ', 'シーソー',
  'たこあげ', '魚つり', 'キャンプ', 'たんじょう日', 'おまつり',
  '遊園地', 'ボウリング', 'トランプ', 'けん玉', 'ピクニック',
  // くらしのもの
  '時計', 'かさ', 'テレビ', 'れいぞうこ', 'せんたく機',
  'ベッド', '歯ブラシ', 'めがね', 'ぼうし', 'くつ',
  '手ぶくろ', 'マフラー', 'かぎ', '電球', 'プレゼント',
  '風船', 'ピアノ', 'ギター', 'カメラ', 'ろうそく',
  // ふしぎ・ものがたり
  'ロボット', 'にんじゃ', '王様', 'おひめさま', 'うちゅう人',
  'たから箱', 'ピラミッド', 'きょうりゅう', 'ドラゴン', '人魚',
  'サンタクロース', 'まほうつかい',
];

// スタンプは4種類。色は形ごとに決まっていて変えられない（原作どおり）。
// 形は紙（600×800）の上での大きさ。中心が押した位置になる
const STAMPS = [
  { key: 'circle', name: '赤い丸', color: '#E0483D' },
  { key: 'square', name: '青い四角', color: '#2F6BD0' },
  { key: 'bar', name: '黄色い長方形', color: '#F2B200' },
  { key: 'triangle', name: '緑の三角', color: '#2E9A57' },
];
const SHEET_W = 600;
const SHEET_H = 800;
const ROTATE_STEPS = 8; // スタンプの向きは45度ずつ
const ROUNDS = 5;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 9;
const MAX_GUESTS = 8;
const DECOY_COUNT = 2;
const SVG_NS = 'http://www.w3.org/2000/svg';

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'stampate_rooms';
const SESSION_KEY = 'stampate_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = {
  WAITING: 'waiting',
  STAMPING: 'stamping',
  GUESSING: 'guessing',
  REVEAL: 'reveal',
  END: 'end',
};
const GAME_STATUSES = [STATUS.STAMPING, STATUS.GUESSING, STATUS.REVEAL, STATUS.END];
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
  // 端末の中だけで持つ状態。進行（status・ゲーム・回）が変わったら当てる側の選び途中だけ消す
  uiKey: null,
  stampKind: 0,
  stampRot: 0,
  pickSlot: null,
  sheetKey: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.sa-screen').forEach((node) => node.classList.remove('active'));
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

function svgElement(tag, attrs) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs || {}).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function circledNum(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  return String(n);
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

function gameOf(room) {
  const game = room?.game;
  if (!game || typeof game !== 'object') return null;
  return game;
}

function orderOf(game) {
  return asList(game?.order).filter((name) => typeof name === 'string');
}

function paintersOf(game) {
  return orderOf(game).filter((name) => name !== game.captain);
}

// 押せる回数は、1回目が5回で、回ごとに1回ずつ減る
function stampLimit(round) {
  return Math.max(1, ROUNDS - (Number(round) || 1) + 1);
}

function isTopicIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < TOPICS.length;
}

function topicText(index) {
  return isTopicIndex(index) ? TOPICS[index] : '';
}

function validStamp(stamp) {
  return !!stamp
    && Number.isInteger(stamp.k) && stamp.k >= 0 && stamp.k < STAMPS.length
    && Number.isInteger(stamp.x) && stamp.x >= 0 && stamp.x <= SHEET_W
    && Number.isInteger(stamp.y) && stamp.y >= 0 && stamp.y <= SHEET_H
    && Number.isInteger(stamp.r) && stamp.r >= 0 && stamp.r < ROTATE_STEPS;
}

// 絵（紙の向き・押したスタンプ・完了）。壊れた値は読み飛ばす
function sheetOf(game, name) {
  const raw = game?.sheets?.[name] || {};
  const limit = stampLimit(game?.round);
  const o = Number.isInteger(raw.o) && raw.o >= 0 && raw.o < 4 ? raw.o : 0;
  return { o, s: asList(raw.s).filter(validStamp).slice(0, limit), done: raw.done === true };
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

// 自分がこの回にスタンプを押す人か
function isPainter(room, name, uid) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.STAMPING) return false;
  return paintersOf(game).includes(name) && ownsName(game, name, uid);
}

function isCaptain(room, name, uid) {
  const game = gameOf(room);
  return !!game && game.captain === name && ownsName(game, name, uid);
}

// 当てる人の代わりにホストも選べる（当てる人の通信が切れたとき・口で答えてもらうとき）
function canGuess(room) {
  if (room.status !== STATUS.GUESSING) return false;
  if (isCaptain(room, state.nickname, currentUid())) return true;
  return state.role === 'host' && room.hostUid === currentUid();
}

function slotsOf(game) {
  return asList(game?.slots).filter((name) => typeof name === 'string');
}

function choicesOf(game) {
  return asList(game?.choices).filter(isTopicIndex);
}

// 当てる人の選択: 絵の番号 → お題の一覧の番号
function guessOf(game) {
  const slots = slotsOf(game);
  const choices = choicesOf(game);
  const map = {};
  Object.entries(game?.guess || {}).forEach(([key, value]) => {
    const slot = Number(String(key).slice(1));
    if (!/^p\d+$/.test(key) || slot >= slots.length) return;
    if (Number.isInteger(value) && value >= 0 && value < choices.length) map[slot] = value;
  });
  return map;
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
    console.warn('[stamp-ate] expired room cleanup failed', error);
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

/* ── ゲームの組み立て（transaction の中で使う） ── */
// 使っていないお題から count 個を引く。ルームで使ったお題は次のゲームでもなるべく避ける。
// exclude（いま配っているお題）は、使い切って最初からにするときも引かず、使った記録にも残す
function drawTopics(usedList, count, rng, exclude = []) {
  const used = new Set(asList(usedList).filter(isTopicIndex));
  const out = new Set(exclude.filter(isTopicIndex));
  const all = TOPICS.map((_, index) => index).filter((index) => !out.has(index));
  let pool = all.filter((index) => !used.has(index));
  let nextUsed = [...used];
  if (pool.length < count) {
    pool = all;
    nextUsed = [...out];
  }
  const picked = shuffled(pool, rng).slice(0, count);
  return { picked, usedTopics: [...nextUsed, ...picked] };
}

// 回の始まり: 当てる人を順番に回し、押す人にお題を配る
function dealRound(room, game, round, seed) {
  const rng = seededRandom(seed);
  const order = orderOf(game);
  const captain = order[(round - 1) % order.length];
  const painters = order.filter((name) => name !== captain);
  const decoys = game.extra ? DECOY_COUNT : 0;
  const { picked, usedTopics } = drawTopics(room.usedTopics, painters.length + decoys, rng);
  return {
    ...room,
    status: STATUS.STAMPING,
    usedTopics,
    game: {
      ...game,
      round,
      captain,
      topics: Object.fromEntries(painters.map((name, i) => [name, picked[i]])),
      decoys: decoys ? picked.slice(painters.length) : null,
      sheets: null,
      slots: null,
      choices: null,
      guess: null,
      result: null,
    },
  };
}

// 当てる番へ: スタンプを1つ以上押した絵だけを、まぜて並べる。お題の一覧もまぜる
function toGuessing(room, seed) {
  const game = gameOf(room);
  const rng = seededRandom(seed);
  const slots = shuffled(paintersOf(game).filter((name) => sheetOf(game, name).s.length > 0), rng);
  if (!slots.length) return null;
  const topics = slots.map((name) => game.topics?.[name]).filter(isTopicIndex);
  if (topics.length !== slots.length) return null;
  const choices = shuffled(topics.concat(asList(game.decoys).filter(isTopicIndex)), rng);
  return {
    ...room,
    status: STATUS.GUESSING,
    game: { ...game, slots, choices, guess: null, result: null },
  };
}

/* ── 再接続用の記録（お題や絵は保存しない） ── */
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
  ['guessPictures', 'guessChoices', 'revealPictures', 'endRounds', 'stampPalette', 'sheetBox'].forEach((id) => {
    const box = $(id);
    box.replaceChildren();
    delete box.dataset.key;
  });
  state.sheetKey = null;
  $('myTopic').textContent = '';
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
    pickSlot: null,
    watchTimer: null,
  });
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
    console.warn('[stamp-ate] room listener failed', error);
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
    console.warn('[stamp-ate] presence recovery failed', error);
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
      const result = await ref.transaction((room) => {
        if (room) return;
        return {
          status: STATUS.WAITING,
          host: nickname,
          hostUid: uid,
          hostPlays: false,
          extraTopics: false,
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
    console.warn('[stamp-ate] create failed', err);
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
    console.warn('[stamp-ate] join failed', err);
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
    console.warn('[stamp-ate] reconnect failed', error);
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
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す（押した絵とお題はゲームが終わるまで残す。入りなおせるように）
      await ref.transaction((room) => {
        if (!room) return;
        if (room.players?.[nickname]?.uid !== uid) return;
        const players = { ...room.players };
        delete players[nickname];
        return { ...room, players };
      });
    }
  } catch (error) {
    console.warn('[stamp-ate] leave failed', error);
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

/* ── 絵の描画（SVG） ── */
function stampShape(kind) {
  const color = STAMPS[kind].color;
  switch (STAMPS[kind].key) {
    case 'circle': return svgElement('circle', { cx: 0, cy: 0, r: 62, fill: color });
    case 'square': return svgElement('rect', { x: -60, y: -60, width: 120, height: 120, fill: color });
    case 'bar': return svgElement('rect', { x: -115, y: -28, width: 230, height: 56, fill: color });
    default: return svgElement('polygon', { points: '0,-84 76,48 -76,48', fill: color });
  }
}

function stampNode(stamp, extraClass) {
  const group = svgElement('g', {
    class: 'sa-stamp' + (extraClass ? ' ' + extraClass : ''),
    transform: 'translate(' + stamp.x + ' ' + stamp.y + ') rotate(' + stamp.r * (360 / ROTATE_STEPS) + ')',
  });
  group.append(stampShape(stamp.k));
  return group;
}

// 紙の向き o（0〜3、90度ずつ）を、見る人の画面での回転にする
function sheetTransform(o) {
  switch (o) {
    case 1: return 'translate(' + SHEET_H + ' 0) rotate(90)';
    case 2: return 'translate(' + SHEET_W + ' ' + SHEET_H + ') rotate(180)';
    case 3: return 'translate(0 ' + SHEET_W + ') rotate(270)';
    default: return '';
  }
}

// 1枚の絵。inner は紙の座標（600×800）の入れ物で、紙からはみ出た部分は見せない
function buildSheet(sheet, label) {
  const wide = sheet.o % 2 === 1;
  const svg = svgElement('svg', {
    class: 'sa-sheet' + (wide ? ' sa-sheet--wide' : ''),
    viewBox: '0 0 ' + (wide ? SHEET_H + ' ' + SHEET_W : SHEET_W + ' ' + SHEET_H),
    role: 'img',
    'aria-label': label,
  });
  const turn = svgElement('g', { transform: sheetTransform(sheet.o) });
  const inner = svgElement('svg', { x: 0, y: 0, width: SHEET_W, height: SHEET_H, overflow: 'hidden', class: 'sa-sheet__paper' });
  inner.append(svgElement('rect', { x: 0, y: 0, width: SHEET_W, height: SHEET_H, class: 'sa-sheet__bg' }));
  const ink = svgElement('g', { class: 'sa-sheet__ink' });
  sheet.s.forEach((stamp) => ink.append(stampNode(stamp)));
  inner.append(ink);
  turn.append(inner);
  svg.append(turn);
  return { svg, inner, ink };
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
  switch (inGame ? room.status : STATUS.WAITING) {
    case STATUS.STAMPING: renderStamping(room); break;
    case STATUS.GUESSING: renderGuessing(room); break;
    case STATUS.REVEAL: renderReveal(room); break;
    case STATUS.END: renderEnd(room); break;
    default: renderWaiting(room);
  }
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

// 進行が変わったときだけ、当てる側の選び途中を消す。
// ほかの人の操作で再描画されても、選び途中とフォーカスは残す
function syncUiKey(room) {
  const game = gameOf(room);
  const key = [room.status, game?.id, game?.round].join(':');
  if (key === state.uiKey) return;
  state.uiKey = key;
  state.pickSlot = null;
}

function renderPeople(listId, names, labelFor, tagsFor) {
  const list = $(listId);
  list.replaceChildren();
  names.forEach((name) => {
    const row = makeElement('li', 'sa-people__item');
    const who = makeElement('span', 'sa-people__name', name);
    (tagsFor ? tagsFor(name) : []).forEach((tag) => who.append(makeElement('span', 'sa-tag', tag)));
    row.append(who, makeElement('span', 'sa-people__status', labelFor(name)));
    list.append(row);
  });
}

function mineTag(name) {
  return name === state.nickname ? ['あなた'] : [];
}

function roundLabel(game) {
  return (Number(game?.round) || 1) + '回目 / 全' + ROUNDS + '回　押せるのは' + stampLimit(game?.round) + '回まで';
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
  $('hostWaitingTools').hidden = !host;
  if (!host) return;
  $('hostPlays').checked = !!room.hostPlays;
  $('extraTopics').checked = !!room.extraTopics;
  const count = players.length;
  const ok = count >= MIN_PLAYERS && count <= MAX_PLAYERS;
  $('btnStartGame').disabled = !ok;
  $('startNote').textContent = ok
    ? '遊ぶ人がみんな入ったら始めてね。始まったあとは、新しく参加できないよ。'
    : (count > MAX_PLAYERS
      ? '遊ぶ人は' + MAX_PLAYERS + '人までだよ。'
      : '遊ぶ人が' + MIN_PLAYERS + '人以上になったら始められます（いま' + count + '人）。');
}

/* ── スタンプを押す回 ── */
function stampLabel(room, game, name) {
  const sheet = sheetOf(game, name);
  if (sheet.done) return '完了';
  if (!room.players?.[name]) return '接続が切れています';
  if (sheet.s.length) return '押している（' + sheet.s.length + '/' + stampLimit(game.round) + '）';
  return 'まだ';
}

function renderStamping(room) {
  showScreen('stamping');
  const game = gameOf(room);
  const me = state.nickname;
  const uid = currentUid();
  const painter = isPainter(room, me, uid);
  const captainMe = isCaptain(room, me, uid);
  const host = state.role === 'host';
  $('stampRound').textContent = roundLabel(game);

  if (painter) {
    $('stampTitle').textContent = 'スタンプでお題を表そう';
    $('stampLead').textContent = game.captain + 'さんが当てる番。お題は、ほかの人には見えないよ。';
  } else if (captainMe) {
    $('stampTitle').textContent = 'あなたが当てる番だよ';
    $('stampLead').textContent = 'みんながスタンプでお題を表しています。そろったら、どの絵がどのお題かを当ててね。';
  } else {
    $('stampTitle').textContent = 'みんながスタンプを押しています';
    $('stampLead').textContent = '当てるのは ' + game.captain + 'さん。そろったら、当てる番になるよ。';
  }

  $('painterPanel').hidden = !painter;
  if (painter) renderPainter(room, game);
  else state.sheetKey = null;

  const painters = paintersOf(game);
  renderPeople('stampProgress', painters, (name) => stampLabel(room, game, name), mineTag);

  $('hostStampTools').hidden = !host;
  if (!host) return;
  const away = painters.filter((name) => !room.players?.[name] && !sheetOf(game, name).done);
  $('stampAwayNote').hidden = !away.length;
  $('stampAwayNote').textContent = away.length
    ? away.join('さん、') + 'さんの接続が切れています。戻るのを待つか、「しめきる」で今ある絵のまま当てる番に進めます。'
    : '';
  const anyStamp = painters.some((name) => sheetOf(game, name).s.length > 0);
  $('btnCloseStamping').disabled = !anyStamp;
}

function renderPainter(room, game) {
  const me = state.nickname;
  const sheet = sheetOf(game, me);
  const limit = stampLimit(game.round);
  const left = limit - sheet.s.length;
  $('myTopic').textContent = topicText(game.topics?.[me]);
  $('changeTopicRow').hidden = sheet.s.length > 0 || sheet.done;
  $('stampCount').textContent = sheet.done
    ? ''
    : (left > 0 ? 'あと ' + left + '回 押せるよ' : 'もう押せないよ。よければ「完了」を押してね');
  renderPalette();
  renderEditableSheet(sheet, game, left > 0 && !sheet.done);
  $('btnUndo').disabled = sheet.done || !sheet.s.length;
  $('btnRotateSheet').disabled = sheet.done;
  $('btnRotateStamp').disabled = sheet.done;
  $('btnDone').hidden = sheet.done;
  $('btnDone').disabled = !sheet.s.length;
  $('painterDone').hidden = !sheet.done;
  document.querySelectorAll('#stampPalette .sa-pal').forEach((button) => { button.disabled = sheet.done; });
}

// スタンプの選び方（4つの形）。一度作ったら作り直さず、選択と向きの表示だけ変える
function renderPalette() {
  const box = $('stampPalette');
  if (box.dataset.key !== 'palette') {
    box.replaceChildren();
    STAMPS.forEach((stamp, index) => {
      const button = makeElement('button', 'sa-pal');
      button.type = 'button';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', stamp.name);
      const icon = svgElement('svg', { viewBox: '-130 -130 260 260', class: 'sa-pal__icon', 'aria-hidden': 'true' });
      button.append(icon, makeElement('span', 'sa-pal__name', stamp.name));
      button.addEventListener('click', () => {
        state.stampKind = index;
        renderPalette();
        updateGhostShape();
      });
      box.append(button);
    });
    box.dataset.key = 'palette';
  }
  box.querySelectorAll('.sa-pal').forEach((button) => {
    const index = Number(button.dataset.index);
    const on = index === state.stampKind;
    button.classList.toggle('is-selected', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
    const icon = button.querySelector('.sa-pal__icon');
    icon.replaceChildren(stampNode({ k: index, x: 0, y: 0, r: state.stampRot }));
  });
}

// 自分の紙。タップした位置にスタンプを押す。マウスのときは押す前に薄く形を見せる
function renderEditableSheet(sheet, game, canStamp) {
  const box = $('sheetBox');
  const key = [game.id, game.round, sheet.o, sheet.s.map((s) => [s.k, s.x, s.y, s.r].join(',')).join(';'), canStamp].join('|');
  if (state.sheetKey === key) return;
  state.sheetKey = key;
  const { svg, inner, ink } = buildSheet(sheet, 'あなたの絵（スタンプ ' + sheet.s.length + '個）');
  svg.classList.add('sa-sheet--edit');
  svg.classList.toggle('is-full', !canStamp);
  const ghost = svgElement('g', { class: 'sa-ghost', visibility: 'hidden' });
  inner.append(ghost);
  const toSheet = (event) => {
    const matrix = inner.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return {
      x: Math.min(SHEET_W, Math.max(0, Math.round(point.x))),
      y: Math.min(SHEET_H, Math.max(0, Math.round(point.y))),
    };
  };
  if (canStamp) {
    svg.addEventListener('click', (event) => {
      const point = toSheet(event);
      if (point) placeStamp(point);
    });
    svg.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse') return;
      const point = toSheet(event);
      if (!point) return;
      ghost.setAttribute('transform', 'translate(' + point.x + ' ' + point.y + ') rotate(' + state.stampRot * (360 / ROTATE_STEPS) + ')');
      ghost.setAttribute('visibility', 'visible');
    });
    svg.addEventListener('pointerleave', () => ghost.setAttribute('visibility', 'hidden'));
  }
  box.replaceChildren(svg);
  ghost.dataset.role = 'ghost';
  ink.dataset.role = 'ink';
  updateGhostShape();
}

function updateGhostShape() {
  const ghost = document.querySelector('#sheetBox .sa-ghost');
  if (!ghost) return;
  ghost.replaceChildren(stampShape(state.stampKind));
  const transform = ghost.getAttribute('transform');
  if (transform) {
    ghost.setAttribute('transform', transform.replace(/rotate\([^)]*\)/, 'rotate(' + state.stampRot * (360 / ROTATE_STEPS) + ')'));
  }
}

/* ── 当てる回 ── */
function guessCaption(room, game) {
  if (isCaptain(room, state.nickname, currentUid())) return 'あなたが当てる番だよ';
  return game.captain + 'さんが当てる番';
}

function renderGuessing(room) {
  showScreen('guessing');
  const game = gameOf(room);
  const slots = slotsOf(game);
  const choices = choicesOf(game);
  const guess = guessOf(game);
  const operator = canGuess(room);
  const captainMe = isCaptain(room, state.nickname, currentUid());
  $('guessRound').textContent = roundLabel(game);
  $('guessTitle').textContent = guessCaption(room, game);
  if (captainMe) {
    $('guessLead').textContent = '絵を選んでから、その絵のお題を選んでね。全部の絵に決めたら「これで決める」を押してね。';
  } else if (operator) {
    $('guessLead').textContent = game.captain + 'さんが答えたお題を、ホストが代わりに選ぶこともできます。当てる人が考えている間は、ヒントを言わないでね。';
  } else {
    $('guessLead').textContent = '当てる人が考えている間は、ヒントを言わないでね。';
  }
  const captainAway = !room.players?.[game.captain];
  $('captainAwayNote').hidden = !captainAway;
  $('captainAwayNote').textContent = captainAway
    ? (state.role === 'host'
      ? '当てる人の' + game.captain + 'さんの接続が切れています。戻るのを待つか、声やチャットで答えを聞いて代わりに選んでね。'
      : '当てる人の' + game.captain + 'さんの接続が切れています。戻るのを待ってね。')
    : '';

  // 選び途中の絵: まだ決めていない最初の絵を選んでおく
  if (operator) {
    if (!Number.isInteger(state.pickSlot) || state.pickSlot >= slots.length) {
      const open = slots.findIndex((_, i) => guess[i] == null);
      state.pickSlot = open >= 0 ? open : 0;
    }
  }
  renderGuessPictures(game, slots, choices, guess, operator);
  renderChoices(game, slots, choices, guess, operator);
  $('choicesTitle').textContent = operator
    ? circledNum(state.pickSlot + 1) + 'の絵のお題は？'
    : 'お題' + (game.decoys ? '（どの絵のものでもないお題が' + asList(game.decoys).length + 'つまざっているよ）' : '');
  const complete = slots.length > 0 && slots.every((_, i) => guess[i] != null);
  $('btnDecide').hidden = !operator;
  $('btnDecide').disabled = !complete;
}

function renderGuessPictures(game, slots, choices, guess, operator) {
  const box = $('guessPictures');
  const key = [game.id, game.round, slots.join('\n'), operator].join('|');
  if (box.dataset.key !== key) {
    box.replaceChildren();
    slots.forEach((name, index) => {
      const card = makeElement(operator ? 'button' : 'div', 'sa-pic');
      if (operator) {
        card.type = 'button';
        card.addEventListener('click', () => {
          state.pickSlot = index;
          if (state.room) renderRoom(state.room);
        });
      }
      card.dataset.index = String(index);
      const head = makeElement('span', 'sa-pic__head');
      head.append(makeElement('span', 'sa-pic__num', circledNum(index + 1)));
      if (name === state.nickname) head.append(makeElement('span', 'sa-tag', 'あなたの絵'));
      const frame = makeElement('span', 'sa-pic__frame');
      frame.append(buildSheet(sheetOf(game, name), circledNum(index + 1) + 'の絵').svg);
      card.append(head, frame, makeElement('span', 'sa-pic__answer'));
      box.append(card);
    });
    box.dataset.key = key;
  }
  box.querySelectorAll('.sa-pic').forEach((card) => {
    const index = Number(card.dataset.index);
    const chosen = guess[index];
    const answer = card.querySelector('.sa-pic__answer');
    answer.textContent = chosen != null ? topicText(choices[chosen]) : '？';
    answer.classList.toggle('is-empty', chosen == null);
    const on = operator && index === state.pickSlot;
    card.classList.toggle('is-selected', on);
    if (operator) {
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
      card.setAttribute('aria-label', circledNum(index + 1) + 'の絵' + (chosen != null ? '（' + topicText(choices[chosen]) + '）' : '（まだ決めていない）'));
    }
  });
}

function renderChoices(game, slots, choices, guess, operator) {
  const box = $('guessChoices');
  const key = [game.id, game.round, choices.join(','), operator].join('|');
  if (box.dataset.key !== key) {
    box.replaceChildren();
    choices.forEach((topic, index) => {
      const item = makeElement(operator ? 'button' : 'span', 'sa-choice');
      if (operator) {
        item.type = 'button';
        item.addEventListener('click', () => chooseTopic(index));
      }
      item.dataset.index = String(index);
      item.append(makeElement('span', 'sa-choice__text', topicText(topic)), makeElement('span', 'sa-choice__where'));
      box.append(item);
    });
    box.dataset.key = key;
  }
  const where = {};
  Object.entries(guess).forEach(([slot, choice]) => { where[choice] = Number(slot); });
  box.querySelectorAll('.sa-choice').forEach((item) => {
    const index = Number(item.dataset.index);
    const slot = where[index];
    const placed = slot != null;
    item.querySelector('.sa-choice__where').textContent = placed ? circledNum(slot + 1) : '';
    item.classList.toggle('is-placed', placed);
    const on = operator && placed && slot === state.pickSlot;
    item.classList.toggle('is-selected', on);
    if (operator) {
      item.setAttribute('aria-pressed', on ? 'true' : 'false');
      item.setAttribute('aria-label', topicText(choices[index]) + (placed ? '（' + circledNum(slot + 1) + 'の絵に決めた）' : ''));
    }
  });
}

/* ── 答え合わせ・おしまい ── */
function resultOf(game) {
  const ok = Number(game?.result?.ok) || 0;
  const total = Number(game?.result?.total) || 0;
  return { ok, total };
}

function renderReveal(room) {
  showScreen('reveal');
  const game = gameOf(room);
  const slots = slotsOf(game);
  const choices = choicesOf(game);
  const guess = guessOf(game);
  const { ok, total } = resultOf(game);
  const team = orderOf(game).length;
  const misses = Number(game.misses) || 0;
  $('revealRound').textContent = roundLabel(game);
  $('revealMain').textContent = total + '枚のうち ' + ok + '枚 伝わったよ';
  $('revealMisses').textContent = 'ここまでのちがった数 ' + misses + '（チームの人数の ' + team + ' までならクリア）';

  const box = $('revealPictures');
  const key = [game.id, game.round].join('|');
  if (box.dataset.key !== key) {
    box.replaceChildren();
    slots.forEach((name, index) => {
      const topic = game.topics?.[name];
      const chosen = choices[guess[index]];
      const hit = isTopicIndex(topic) && chosen === topic;
      const card = makeElement('div', 'sa-pic sa-pic--reveal' + (hit ? ' is-hit' : ' is-miss'));
      const head = makeElement('span', 'sa-pic__head');
      head.append(makeElement('span', 'sa-pic__num', circledNum(index + 1)), makeElement('span', 'sa-pic__painter', name));
      if (name === state.nickname) head.append(makeElement('span', 'sa-tag', 'あなた'));
      const frame = makeElement('span', 'sa-pic__frame');
      frame.append(buildSheet(sheetOf(game, name), circledNum(index + 1) + 'の絵（' + name + 'さん）').svg);
      const truth = makeElement('span', 'sa-pic__truth');
      truth.append(makeElement('span', 'sa-pic__truthlabel', 'お題'), makeElement('span', 'sa-pic__truthtext', topicText(topic)));
      const mark = makeElement('span', 'sa-pic__mark');
      const icon = makeElement('span', 'material-symbols-rounded', hit ? 'check_circle' : 'help');
      icon.setAttribute('aria-hidden', 'true');
      mark.append(icon, makeElement('span', '', hit ? '伝わった' : '当てた答え: ' + (isTopicIndex(chosen) ? topicText(chosen) : 'なし')));
      card.append(head, frame, truth, mark);
      box.append(card);
    });
    box.dataset.key = key;
  }
  const resting = paintersOf(game).filter((name) => !slots.includes(name));
  $('revealResting').hidden = !resting.length;
  $('revealResting').textContent = resting.length ? '今回は ' + resting.join('さん、') + 'さんの絵はなかったよ。' : '';
  const host = state.role === 'host';
  $('hostRevealTools').hidden = !host;
  $('btnNextRound').textContent = Number(game.round) >= ROUNDS ? '結果を見る' : 'つぎの回へ';
  $('revealWait').hidden = host;
}

function renderEnd(room) {
  showScreen('end');
  const game = gameOf(room);
  const team = orderOf(game).length;
  const misses = Number(game.misses) || 0;
  const cleared = misses <= team;
  $('endTitle').textContent = cleared ? 'クリア！' : '今回はここまで';
  $('endLead').textContent = cleared
    ? 'ちがった数は合計 ' + misses + '。チームの人数（' + team + '）までに収まったよ。みんなで伝え合えたね！'
    : 'ちがった数は合計 ' + misses + '。チームの人数（' + team + '）をこえちゃった。また挑戦してみてね！';
  const list = $('endRounds');
  const key = String(game.id);
  if (list.dataset.key !== key) {
    list.replaceChildren();
    for (let round = 1; round <= ROUNDS; round++) {
      const item = game.history?.['r' + round];
      if (!item) continue;
      const row = makeElement('li', 'sa-rounds__item');
      row.append(
        makeElement('span', 'sa-rounds__label', round + '回目（' + stampLimit(round) + '回まで）'),
        makeElement('span', 'sa-rounds__who', '当てる人 ' + (item.captain || '')),
        makeElement('span', 'sa-rounds__score', (Number(item.ok) || 0) + ' / ' + (Number(item.total) || 0) + '枚 伝わった'),
      );
      list.append(row);
    }
    list.dataset.key = key;
  }
  const host = state.role === 'host';
  $('hostEndTools').hidden = !host;
  $('endWait').hidden = host;
}

/* ── みんなにみせる画面（画面共有用・見るだけ） ──
   ホストが別のタブで開いて共有する。ルームには入らず、RTDB には一切書き込まない
   （players にも入らない・切断予約をしない・期限切れのルームも消さない）。
   押す人のお題と、押している途中の絵は出さない。 */
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
    console.warn('[stamp-ate] watch failed', error);
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
  document.title = 'みんなにみせる画面 | スタンプあてゲーム | room-K';
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
    console.warn('[stamp-ate] watch listener failed', error);
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

/* ── 押す人の操作 ── */
// 自分の絵を書きかえる。今の回で、自分が押す人のときだけ書く（回が進んだあとに届いた操作は弾く）
async function editSheet(mutate, failMessage) {
  if (state.role !== 'host' && state.role !== 'guest') return false;
  if (!state.roomRef || !state.room) return false;
  const game = gameOf(state.room);
  if (!game) return false;
  const gameId = game.id;
  const round = game.round;
  const nickname = state.nickname;
  const uid = currentUid();
  let reason = '';
  try {
    const result = await state.roomRef.transaction((room) => {
      reason = '';
      if (!room || isExpired(room)) return;
      const current = gameOf(room);
      if (room.status !== STATUS.STAMPING || !current || current.id !== gameId || current.round !== round) {
        reason = 'moved';
        return;
      }
      if (!isPainter(room, nickname, uid)) return;
      const next = mutate(sheetOf(current, nickname), room, current);
      if (!next) return;
      const sheets = { ...(current.sheets || {}), [nickname]: { o: next.o, s: next.s, done: next.done } };
      let nextRoom = { ...room, game: { ...current, sheets } };
      // 押す人が全員「完了」したら、そのまま当てる番へ進む
      if (next.done) {
        const allDone = paintersOf(current).every((name) => sheetOf(nextRoom.game, name).done);
        if (allDone) nextRoom = toGuessing(nextRoom, next.seed) || nextRoom;
      }
      return nextRoom;
    });
    if (!result.committed && reason !== 'moved' && failMessage) toast(failMessage);
    return result.committed;
  } catch (error) {
    console.warn('[stamp-ate] sheet edit failed', error);
    if (failMessage) toast(failMessage);
    return false;
  }
}

function placeStamp(point) {
  const kind = state.stampKind;
  const rot = state.stampRot;
  editSheet((sheet, room, game) => {
    if (sheet.done || sheet.s.length >= stampLimit(game.round)) return null;
    return { ...sheet, s: sheet.s.concat({ k: kind, x: point.x, y: point.y, r: rot }) };
  }, 'スタンプを押せませんでした。もう一度ためしてね');
}

function undoStamp() {
  editSheet((sheet) => {
    if (sheet.done || !sheet.s.length) return null;
    return { ...sheet, s: sheet.s.slice(0, -1) };
  }, '戻せませんでした。もう一度ためしてね');
}

function rotateSheet() {
  editSheet((sheet) => {
    if (sheet.done) return null;
    return { ...sheet, o: (sheet.o + 1) % 4 };
  }, '紙を回せませんでした。もう一度ためしてね');
}

function finishSheet() {
  const seed = randomSeed();
  editSheet((sheet) => {
    if (sheet.done || !sheet.s.length) return null;
    return { ...sheet, done: true, seed };
  }, '完了できませんでした。もう一度ためしてね');
}

function reopenSheet() {
  editSheet((sheet) => {
    if (!sheet.done) return null;
    return { ...sheet, done: false };
  }, 'なおせませんでした。画面を確かめてね');
}

// まだ1つも押していないときだけ、お題を引きなおせる（ほかの人のお題・よけいなお題とは重ならない）
async function changeTopic() {
  if (state.busy || !state.roomRef || !state.room) return;
  const game = gameOf(state.room);
  if (!game) return;
  const gameId = game.id;
  const round = game.round;
  const nickname = state.nickname;
  const uid = currentUid();
  const seed = randomSeed();
  state.busy = true;
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || isExpired(room)) return;
      const current = gameOf(room);
      if (room.status !== STATUS.STAMPING || !current || current.id !== gameId || current.round !== round) return;
      if (!isPainter(room, nickname, uid)) return;
      const sheet = sheetOf(current, nickname);
      if (sheet.s.length || sheet.done) return;
      const taken = Object.values(current.topics || {}).concat(asList(current.decoys)).filter(isTopicIndex);
      const { picked, usedTopics } = drawTopics(room.usedTopics, 1, seededRandom(seed), taken);
      if (!picked.length || taken.includes(picked[0])) return;
      return {
        ...room,
        usedTopics,
        game: { ...current, topics: { ...current.topics, [nickname]: picked[0] } },
      };
    });
    if (!result.committed) toast('お題を変えられませんでした。画面を確かめてね');
  } catch (error) {
    console.warn('[stamp-ate] change topic failed', error);
    toast('お題を変えられませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

/* ── 当てる人の操作 ── */
// 選んでいる絵に、このお題を置く。ほかの絵に置いてあったら、そこから外して移す。
// 同じ絵に置いてあるお題をもう一度押したら外す
async function chooseTopic(choiceIndex) {
  const room = state.room;
  if (!room || !canGuess(room) || !state.roomRef) return;
  const game = gameOf(room);
  const slot = state.pickSlot;
  if (!Number.isInteger(slot)) return;
  const gameId = game.id;
  const round = game.round;
  const uid = currentUid();
  const nickname = state.nickname;
  const role = state.role;
  // 次に選ぶ絵は、押した時点の手元の選択から決める（応答を待つと、続けて押したお題が同じ絵に入るため）
  const local = guessOf(game);
  if (local[slot] === choiceIndex) {
    delete local[slot];
  } else {
    Object.keys(local).forEach((key) => { if (local[key] === choiceIndex) delete local[key]; });
    local[slot] = choiceIndex;
    const slots = slotsOf(game);
    const next = slots.findIndex((_, i) => i > slot && local[i] == null);
    const first = slots.findIndex((_, i) => local[i] == null);
    if (next >= 0) state.pickSlot = next;
    else if (first >= 0) state.pickSlot = first;
  }
  try {
    const result = await state.roomRef.transaction((current) => {
      if (!current || isExpired(current) || current.status !== STATUS.GUESSING) return;
      const g = gameOf(current);
      if (!g || g.id !== gameId || g.round !== round) return;
      const allowed = isCaptain(current, nickname, uid) || (role === 'host' && current.hostUid === uid);
      if (!allowed) return;
      const slots = slotsOf(g);
      const choices = choicesOf(g);
      if (slot >= slots.length || choiceIndex >= choices.length) return;
      const map = guessOf(g);
      if (map[slot] === choiceIndex) {
        delete map[slot];
      } else {
        Object.keys(map).forEach((key) => { if (map[key] === choiceIndex) delete map[key]; });
        map[slot] = choiceIndex;
      }
      const stored = {};
      Object.entries(map).forEach(([key, value]) => { stored['p' + key] = value; });
      return { ...current, game: { ...g, guess: Object.keys(stored).length ? stored : null } };
    });
    // 決まって答え合わせに進んだあとなどは、画面でわかるので知らせない
    const latest = gameOf(result.snapshot?.val());
    if (!result.committed && result.snapshot?.val()?.status === STATUS.GUESSING && latest?.id === gameId && latest?.round === round) {
      toast('選べませんでした。画面を確かめてね');
    }
    if (state.room) renderRoom(state.room);
  } catch (error) {
    console.warn('[stamp-ate] guess failed', error);
    toast('選べませんでした。もう一度ためしてね');
  }
}

async function decideGuess() {
  const room = state.room;
  if (!room || !canGuess(room) || state.busy || !state.roomRef) return;
  const game = gameOf(room);
  const gameId = game.id;
  const round = game.round;
  const uid = currentUid();
  const nickname = state.nickname;
  const role = state.role;
  state.busy = true;
  try {
    const result = await state.roomRef.transaction((current) => {
      if (!current || isExpired(current) || current.status !== STATUS.GUESSING) return;
      const g = gameOf(current);
      if (!g || g.id !== gameId || g.round !== round) return;
      const allowed = isCaptain(current, nickname, uid) || (role === 'host' && current.hostUid === uid);
      if (!allowed) return;
      const slots = slotsOf(g);
      const choices = choicesOf(g);
      const map = guessOf(g);
      if (!slots.length || !slots.every((_, i) => map[i] != null)) return;
      const ok = slots.filter((name, i) => choices[map[i]] === g.topics?.[name]).length;
      const total = slots.length;
      return {
        ...current,
        status: STATUS.REVEAL,
        game: {
          ...g,
          result: { ok, total },
          misses: (Number(g.misses) || 0) + (total - ok),
          history: { ...(g.history || {}), ['r' + g.round]: { captain: g.captain, ok, total } },
        },
      };
    });
    if (!result.committed) toast('決められませんでした。画面を確かめてね');
  } catch (error) {
    console.warn('[stamp-ate] decide failed', error);
    toast('決められませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
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
    console.warn('[stamp-ate] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    state.busy = false;
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
    const game = {
      id,
      order,
      uids: Object.fromEntries(order.map((name) => [name, room.players[name].uid])),
      joined: Object.fromEntries(order.map((name) => [name, Number(room.players[name].joinedAt) || 0])),
      extra: !!room.extraTopics,
      misses: 0,
      history: null,
    };
    return dealRound({ ...room, lastGameId: id }, game, 1, Math.floor(rng() * 0x7fffffff));
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok === false) toast('はじめられませんでした。参加している人を確かめてね');
}

async function closeStamping() {
  const game = gameOf(state.room);
  if (!game) return;
  const painters = paintersOf(game);
  const notDone = painters.filter((name) => !sheetOf(game, name).done);
  if (notDone.length && !window.confirm('まだ完了していない人がいます（' + notDone.join('、') + '）。今ある絵のまま、当てる番に進みますか？')) return;
  const gameId = game.id;
  const round = game.round;
  const seed = randomSeed();
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.STAMPING || !current || current.id !== gameId || current.round !== round) return;
    return toGuessing(room, seed) || undefined;
  }, '進めませんでした。もう一度ためしてね');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
}

async function nextRound() {
  const game = gameOf(state.room);
  if (!game) return;
  const gameId = game.id;
  const round = game.round;
  const seed = randomSeed();
  const ok = await hostTransaction((room) => {
    const current = gameOf(room);
    if (room.status !== STATUS.REVEAL || !current || current.id !== gameId || current.round !== round) return;
    if (round >= ROUNDS) return { ...room, status: STATUS.END };
    return dealRound(room, current, round + 1, seed);
  }, '進めませんでした。もう一度ためしてね');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
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
  if (!window.confirm('ゲームをやめて、待合室に戻りますか？ 押した絵は消えます。')) return;
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
$('extraTopics').addEventListener('change', (event) => setOption('extraTopics', event.currentTarget.checked));
$('btnStartGame').addEventListener('click', startGame);
$('btnCloseStamping').addEventListener('click', closeStamping);
$('btnNextRound').addEventListener('click', nextRound);
$('btnPlayAgain').addEventListener('click', playAgain);
$('btnQuitGame').addEventListener('click', quitGame);

$('btnRotateStamp').addEventListener('click', () => {
  state.stampRot = (state.stampRot + 1) % ROTATE_STEPS;
  renderPalette();
  updateGhostShape();
});
$('btnRotateSheet').addEventListener('click', rotateSheet);
$('btnUndo').addEventListener('click', undoStamp);
$('btnDone').addEventListener('click', finishSheet);
$('btnUndone').addEventListener('click', reopenSheet);
$('btnChangeTopic').addEventListener('click', changeTopic);
$('btnDecide').addEventListener('click', decideGuess);

showScreen('top');
const watchParam = new URLSearchParams(location.search).get('watch');
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
} else if (loadSession()) {
  // ルームにいる途中で再読み込みしたときは、同じルームに戻る
  tryReconnect().then((reconnected) => {
    if (!reconnected && !state.roomRef) clearSession();
  });
}
