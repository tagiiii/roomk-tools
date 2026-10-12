// 好きなものビンゴ：テーマにそって好きなものを9個選んでカードを作り、アプリがひくのを見るビンゴ
// ルーム（Realtime Database）で進める。カードはそのゲームの間だけルームに置き、
// つぎのゲームに進むときとルームを閉じたときに消える。順位・履歴は持たない。

// テーマと語（基準は AGENTS.md「テーマと候補の方針」）。1テーマ24語で、ゲームごとにその中から16個を候補に出す。
// ルームではテーマの id と語の番号だけを共有するので、id は変えない・語の並べ替え・途中の削除・同じ位置の書きかえはしない
// （足すのは末尾だけ。語を入れかえるときは、テーマの id を新しくする）。
// t: 表示する語 / c: 色のテーマだけで使う見本の色
const THEMES = [
  {
    id: 'tabemono',
    name: '食べもの',
    items: [
      { t: 'カレー' }, { t: 'ラーメン' }, { t: 'おすし' }, { t: 'ハンバーグ' },
      { t: 'からあげ' }, { t: 'ピザ' }, { t: 'オムライス' }, { t: 'たこ焼き' },
      { t: 'うどん' }, { t: '焼きそば' }, { t: 'ぎょうざ' }, { t: 'おにぎり' },
      { t: 'パスタ' }, { t: '焼き肉' }, { t: 'フライドポテト' }, { t: 'グラタン' },
      { t: 'サンドイッチ' }, { t: 'お好み焼き' }, { t: 'チャーハン' }, { t: 'とんかつ' },
      { t: 'シチュー' }, { t: 'そば' }, { t: 'コロッケ' }, { t: '天ぷら' },
    ],
  },
  {
    id: 'oyatsu',
    name: 'おやつ',
    items: [
      { t: 'チョコレート' }, { t: 'アイス' }, { t: 'プリン' }, { t: 'ポテトチップス' },
      { t: 'グミ' }, { t: 'ドーナツ' }, { t: 'ケーキ' }, { t: 'せんべい' },
      { t: 'クッキー' }, { t: 'わたあめ' }, { t: 'かき氷' }, { t: 'ゼリー' },
      { t: 'たい焼き' }, { t: 'パンケーキ' }, { t: 'ポップコーン' }, { t: 'だんご' },
      { t: 'マシュマロ' }, { t: 'シュークリーム' }, { t: 'あめ' }, { t: '大福' },
      { t: 'ヨーグルト' }, { t: 'クレープ' }, { t: 'カステラ' }, { t: 'ラムネ' },
    ],
  },
  {
    id: 'ikimono',
    name: '生きもの',
    items: [
      { t: '犬' }, { t: '猫' }, { t: 'うさぎ' }, { t: 'ハムスター' },
      { t: 'パンダ' }, { t: 'ペンギン' }, { t: 'イルカ' }, { t: 'ライオン' },
      { t: 'キリン' }, { t: 'カワウソ' }, { t: 'フクロウ' }, { t: 'カメ' },
      { t: 'ゾウ' }, { t: 'リス' }, { t: '恐竜' }, { t: 'クラゲ' },
      { t: 'コアラ' }, { t: 'カピバラ' }, { t: 'キツネ' }, { t: 'ウマ' },
      { t: 'サメ' }, { t: 'インコ' }, { t: 'アザラシ' }, { t: 'レッサーパンダ' },
    ],
  },
  {
    id: 'sukinakoto',
    name: 'すること',
    items: [
      { t: 'ゲーム' }, { t: '動画を見る' }, { t: '絵をかく' }, { t: '音楽をきく' },
      { t: 'マンガを読む' }, { t: '工作' }, { t: 'おかし作り' }, { t: '散歩' },
      { t: '写真をとる' }, { t: 'カードゲーム' }, { t: 'パズル' }, { t: 'ダンス' },
      { t: '歌う' }, { t: '本を読む' }, { t: 'ブロック' }, { t: 'ごろごろする' },
      { t: '料理' }, { t: 'おしゃべり' }, { t: 'サイクリング' }, { t: '釣り' },
      { t: '楽器をひく' }, { t: 'ボードゲーム' }, { t: '映画を見る' }, { t: 'ぬり絵' },
    ],
  },
  {
    id: 'odekake',
    name: 'おでかけ・季節',
    items: [
      { t: '花火' }, { t: 'お祭り' }, { t: 'プール' }, { t: '海' },
      { t: '雪あそび' }, { t: 'キャンプ' }, { t: '水族館' }, { t: '動物園' },
      { t: '遊園地' }, { t: '温泉' }, { t: '公園' }, { t: '映画館' },
      { t: 'お花見' }, { t: '紅葉' }, { t: 'イルミネーション' }, { t: 'ピクニック' },
      { t: '山' }, { t: '川あそび' }, { t: '博物館' }, { t: 'プラネタリウム' },
      { t: '牧場' }, { t: '旅行' }, { t: '展望台' }, { t: '星空' },
    ],
  },
  {
    id: 'iro',
    name: '色',
    items: [
      { t: '赤', c: '#D64545' }, { t: '青', c: '#2F6FD0' }, { t: '黄色', c: '#F2C938' }, { t: '緑', c: '#3C9A4E' },
      { t: 'オレンジ', c: '#F08A2C' }, { t: 'ピンク', c: '#F29BB8' }, { t: '紫', c: '#8A5BC2' }, { t: '水色', c: '#7CCBEA' },
      { t: '白', c: '#FFFFFF' }, { t: '黒', c: '#222222' }, { t: '茶色', c: '#8A5A3A' }, { t: '金色', c: '#C9A227' },
      { t: '銀色', c: '#B4BAC2' }, { t: '黄緑', c: '#A6CF3F' }, { t: '紺', c: '#1F3566' }, { t: 'ベージュ', c: '#E5D3B3' },
      { t: 'グレー', c: '#8E949B' }, { t: 'クリーム色', c: '#F6E9B2' }, { t: 'ラベンダー', c: '#B9A5E0' }, { t: 'ワインレッド', c: '#8E2C3B' },
      { t: '青緑', c: '#1E8C93' }, { t: 'サーモンピンク', c: '#F4A28C' }, { t: 'オリーブ色', c: '#7C8A3A' }, { t: 'ミント色', c: '#A8E0C8' },
    ],
  },
];

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'sukibingo_rooms';
const SESSION_KEY = 'sukibingo_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const MAX_GUESTS = 9;
const MAX_CARDS = 10;
const MIN_CARDS = 2;
const CARD_CELLS = 9;
// 1ゲームで候補に出す数（テーマの24語から、ゲームごとにえらぶ）
const ITEM_COUNT = 16;
const DRAW_OPTIONS = [8, 10, 12];
const DEFAULT_DRAWS = 10;
// 3×3 のマス番号（左上が0）でのたて・よこ・ななめ
const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];
const ROLL_STEPS = 12;
const ROLL_INTERVAL_MS = 75;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = {
  WAITING: 'waiting',
  PICKING: 'picking',
  PLAYING: 'playing',
  RESULT: 'result',
};
const WIDE_SCREENS = ['playing', 'result'];
const DEFAULT_TITLE = document.title;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

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
  // 端末の中だけで持つ状態。status・ゲーム・テーマが変わったら消す
  uiKey: null,
  themePick: null,
  drawPick: DEFAULT_DRAWS,
  chosen: [],
  proxyMode: false,
  proxyChosen: [],
  openDetails: new Set(),
  // ひく演出（端末ごと）。shownCount は画面に出している「ひいた数」
  shownRound: null,
  shownCount: 0,
  rolling: false,
  rollTimer: null,
  // 画面の部品が入れかわった直後にフォーカスを移す先（セレクター）
  focusNext: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.sb-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
  $('wrapper').classList.toggle('is-wide', WIDE_SCREENS.includes(id));
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

function icon(name) {
  const node = makeElement('span', 'material-symbols-rounded', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function circledNum(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  return String(n);
}

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 中身（key）が変わったときだけ作り直す。ほかの人の操作で再描画されても、フォーカスと演出を保つ
function renderKeyed(node, key, build) {
  if (node.dataset.key === key) return false;
  node.replaceChildren();
  build(node);
  node.dataset.key = key;
  return true;
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

// カードを作る人か（ホストは「自分もプレイヤーとして参加する」のときだけ）
function playsName(room, name) {
  const player = room?.players?.[name];
  if (!player) return false;
  return !player.isHost || !!room.hostPlays;
}

function playingNames(room) {
  return memberNames(room).filter((name) => playsName(room, name));
}

// そのゲームで候補に出す語の番号（テーマの語から16個）。ルームには番号（items）だけを置く。
// カード（cells）とひいた記録（drawn）は、この16個の中の位置（0〜15）で持つ
function gameItems(room, theme) {
  const list = toList(room?.items);
  const valid = list.length === ITEM_COUNT && new Set(list).size === ITEM_COUNT
    && list.every((index) => Number.isInteger(index) && index >= 0 && index < theme.items.length);
  // items のないルーム（最初の版の画面が作ったもの）は、先頭の16個
  return valid ? list : Array.from({ length: ITEM_COUNT }, (_, i) => i);
}

// そのゲームのテーマ。items はそのゲームの候補16個（位置の順）、key は描画の作り直しの判定に使う
// （最初の版はテーマを theme に置いていた。そのルームも読めるようにする）
function themeOf(room) {
  const id = room?.themeId ?? room?.theme;
  const theme = THEMES.find((item) => item.id === id);
  if (!theme) return null;
  const picked = gameItems(room, theme);
  return {
    id: theme.id,
    name: theme.name,
    items: picked.map((index) => theme.items[index]),
    key: theme.id + ':' + picked.join('.'),
  };
}

function isItemIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < ITEM_COUNT;
}

// RTDB の配列は、配列でもオブジェクトでも返ってくることがある
function toList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    return Object.keys(value).sort((a, b) => Number(a) - Number(b)).map((key) => value[key]);
  }
  return [];
}

function drawnOf(room) {
  const seen = new Set();
  return toList(room?.drawn).filter((index) => {
    if (!isItemIndex(index) || seen.has(index)) return false;
    seen.add(index);
    return true;
  });
}

function drawTotalOf(room) {
  return DRAW_OPTIONS.includes(room?.drawTotal) ? room.drawTotal : DEFAULT_DRAWS;
}

function validCells(cells) {
  const list = toList(cells);
  if (list.length !== CARD_CELLS || !list.every(isItemIndex)) return null;
  return new Set(list).size === CARD_CELLS ? list.slice() : null;
}

// カードは cards/r{ゲームの番号} にだけ置く（ほかのゲームの分は持たない）
function roundCards(room) {
  return room?.cards?.['r' + room.round] || {};
}

function cardOf(room, name) {
  if (!name) return null;
  const card = roundCards(room)[name];
  if (!card || !card.uid) return null;
  const cells = validCells(card.cells);
  if (!cells) return null;
  return { cells, uid: card.uid, proxy: !!card.proxy, joinedAt: Number(card.joinedAt) || 0 };
}

// カードを持っている人を参加順に（切断中の人・ホストが代わりに作った人も含める）
function cardNames(room) {
  return Object.keys(roundCards(room))
    .map((name) => [name, cardOf(room, name)])
    .filter(([, card]) => card)
    .sort((a, b) => a[1].joinedAt - b[1].joinedAt || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

// ほかの人のカードがある名前は使えない（切断中の人のカードや、ホストが代わりに作ったカードを引き継がないため）
function reservedByOther(room, name, uid) {
  const card = roundCards(room)[name];
  return !!card && (!!card.proxy || card.uid !== uid);
}

// 自分のカード。接続が切れている間にホストが自分の名前で代わりに作ったカードも、自分のカードとして見せる
// （その名前はホストのカードが予約しているので、そのゲームの間は在室に戻れない。カードは作りなおせない）
function myCardOf(room) {
  const card = cardOf(room, state.nickname);
  if (!card) return null;
  if (card.proxy) return state.role === 'guest' && !room.players?.[state.nickname] ? card : null;
  return card.uid === currentUid() ? card : null;
}

function statusOf(cells, drawnSet) {
  const open = cells.map((index) => drawnSet.has(index));
  const done = LINES.filter((line) => line.every((k) => open[k]));
  const reach = LINES.some((line) => line.filter((k) => open[k]).length === 2);
  return { open, lines: done.length, reach, lineCells: new Set(done.flat()) };
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
    console.warn('[suki-bingo] expired room cleanup failed', error);
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

// 送信したあとに通信が切れると、transaction は Error('disconnect') で中止される（サーバーに届いたかは分からない）。
// ルームの作成と参加は、少しだけやり直す。update は、前の送信が届いていたら成功として扱うように書く
// （届いていたのに失敗として戻ると、切断時の予約がないルーム・在室が残る）
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

/* ── 再接続用の記録（カードの中身は保存しない） ── */
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
function resetLocalUi() {
  state.uiKey = null;
  state.themePick = null;
  state.drawPick = DEFAULT_DRAWS;
  state.chosen = [];
  state.proxyMode = false;
  state.proxyChosen = [];
  state.openDetails.clear();
  stopRoll();
  state.shownRound = null;
  state.shownCount = 0;
  state.focusNext = null;
  // 前のルームの中身を、隠れている画面に残さない
  document.querySelectorAll('[data-key]').forEach((node) => {
    node.replaceChildren();
    delete node.dataset.key;
  });
  $('proxyName').value = '';
  setError('proxyError', '');
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  clearTimeout(state.watchTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef && state.role !== 'spectator') RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
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
  resetLocalUi();
  clearSession();
  $('hostOffOverlay').hidden = true;
  $('btnOpenWatch').hidden = true;
  $('roomBar').hidden = true;
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
    console.warn('[suki-bingo] room listener failed', error);
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
  // 自分の名前をホストのカードが予約している間は、在室に戻れないので試さない
  if (state.role === 'guest') return !room.players?.[state.nickname] && !reservedByOther(room, state.nickname, currentUid());
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
      await ref.transaction((room) => {
        if (!room || isExpired(room) || room.players?.[nickname]) return;
        if (nickname === room.host || reservedByOther(room, nickname, uid)) return;
        // 戻るときは参加したときの順番のまま（人数の上限は見ない）
        return {
          ...room,
          players: {
            ...(room.players || {}),
            [nickname]: { isHost: false, uid, joinedAt },
          },
        };
      });
    }
  } catch (error) {
    console.warn('[suki-bingo] presence recovery failed', error);
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
          hostPlays: true,
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          round: 0,
          drawTotal: DEFAULT_DRAWS,
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
    console.warn('[suki-bingo] create failed', err);
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
    // 途中参加もできる。カードを作る間に入ればそのゲームから、ひいている途中ならつぎのゲームから遊べる
    const result = await transactRetry(ref, (room) => {
      reason = '';
      rejoinAt = null;
      if (!room) { reason = '見つからない'; return; }
      if (isExpired(room)) { reason = '終了'; return; }
      // 自分の在室がもう入っている（前の送信が届いていた・タブが落ちた直後に入りなおした）ときは、そのまま参加とする
      const own = room.players?.[nickname];
      const mine = !!own && !own.isHost && own.uid === uid;
      if (nickname === room.host || (own && !mine) || reservedByOther(room, nickname, uid)) {
        reason = '名前';
        return;
      }
      if (mine) {
        rejoinAt = Number(own.joinedAt) || joinedAt;
        return room;
      }
      if (guestNames(room).length >= MAX_GUESTS) { reason = '満員'; return; }
      return {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt },
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
    console.warn('[suki-bingo] join failed', err);
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
    console.warn('[suki-bingo] reconnect failed', error);
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
      // 自分の在室と、ビンゴが始まる前の自分のカードだけを消す（進行は書き換えない）
      await ref.transaction((room) => {
        if (!room) return;
        const next = { ...room, players: { ...(room.players || {}) } };
        if (next.players[nickname]?.uid === uid) delete next.players[nickname];
        const key = 'r' + room.round;
        const mine = room.cards?.[key]?.[nickname];
        if (room.status === STATUS.PICKING && mine && !mine.proxy && mine.uid === uid) {
          const cards = { ...room.cards[key] };
          delete cards[nickname];
          next.cards = { [key]: cards };
        }
        return next;
      });
    }
  } catch (error) {
    console.warn('[suki-bingo] leave failed', error);
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
  syncUiKey(room);
  syncDraws(room);
  renderRoom(room);
}

function renderRoom(room) {
  if (room.status !== STATUS.WAITING && !themeOf(room)) {
    renderStale();
    return;
  }
  switch (room.status) {
    case STATUS.PICKING: renderPicking(room); break;
    case STATUS.PLAYING: renderPlaying(room); break;
    case STATUS.RESULT: renderResult(room); break;
    default: renderWaiting(room);
  }
  // 押したボタンが隠れてフォーカスが body に落ちないよう、入れかわった先へ移す
  if (state.focusNext && focusVisible(state.focusNext)) state.focusNext = null;
}

// 古い画面のままのタブが、知らないテーマのルームを開いたとき
function renderStale() {
  showScreen('waiting');
  $('waitingLead').textContent = '画面が古いみたい。ページを読み込みなおしてね。';
  $('waitingPlayers').replaceChildren();
  delete $('waitingPlayers').dataset.key;
  $('hostWaitingTools').hidden = true;
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

// 進行が変わったときだけ、端末の中の選び途中を消す。
// ほかの人の操作で再描画されても、選び途中とフォーカスは残す
function syncUiKey(room) {
  const key = [room.status, room.round, room.themeId || room.theme || '', toList(room.items).join('.')].join(':');
  if (key === state.uiKey) return;
  state.uiKey = key;
  state.focusNext = null;
  state.chosen = [];
  state.proxyMode = false;
  state.proxyChosen = [];
  state.openDetails.clear();
  $('proxyName').value = '';
  setError('proxyError', '');
  if (room.status === STATUS.WAITING) state.themePick = null;
  // ホストが代わりに作ったカードは、ホストの画面では最初から開いておく（画面共有でその子に見えるように）
  if (room.status === STATUS.PLAYING && state.role === 'host') {
    cardNames(room).forEach((name) => {
      if (cardOf(room, name).proxy) state.openDetails.add(name);
    });
  }
}

/* ── 部品 ── */
// 候補1つ分の中身（色のテーマは見本の色つき）
function itemInto(parent, theme, index) {
  const item = theme.items[index];
  if (!item) return;
  if (item.c) {
    const swatch = makeElement('span', 'sb-swatch');
    swatch.style.backgroundColor = item.c;
    swatch.setAttribute('aria-hidden', 'true');
    parent.append(swatch);
  }
  parent.append(makeElement('span', 'sb-item__text', item.t));
}

// 3×3 のカード。cells が9個に足りない分は空きマスにする（作っている途中の表示）
function cardInto(container, theme, cells, status, freshIndex) {
  container.replaceChildren();
  container.setAttribute('role', 'list');
  for (let k = 0; k < CARD_CELLS; k++) {
    const cell = makeElement('div', 'sb-cell');
    cell.setAttribute('role', 'listitem');
    const index = cells[k];
    if (!isItemIndex(index)) {
      cell.classList.add('is-empty');
      cell.setAttribute('aria-label', '空いているマス');
    } else {
      itemInto(cell, theme, index);
      const open = !!status && status.open[k];
      if (open) {
        cell.classList.add('is-open');
        const mark = icon('check_circle');
        mark.classList.add('sb-cell__mark');
        cell.append(mark);
      }
      if (status && status.lineCells.has(k)) cell.classList.add('is-line');
      if (open && index === freshIndex && !reduceMotion.matches) cell.classList.add('is-new');
      cell.setAttribute('aria-label', theme.items[index].t + (open ? '、ひかれた' : ''));
    }
    container.append(cell);
  }
}

function miniGrid(status) {
  const grid = makeElement('span', 'sb-mini');
  grid.setAttribute('aria-hidden', 'true');
  for (let k = 0; k < CARD_CELLS; k++) {
    const dot = makeElement('span', 'sb-mini__dot');
    if (status.open[k]) dot.classList.add('is-open');
    if (status.lineCells.has(k)) dot.classList.add('is-line');
    grid.append(dot);
  }
  return grid;
}

// ビンゴの本数か、リーチ（リーチは、まだひく回数が残っている間だけ）
function statusBadge(status, finished) {
  if (status.lines > 0) return makeElement('span', 'sb-badge sb-badge--bingo', 'ビンゴ ' + status.lines + '本');
  if (status.reach && !finished) return makeElement('span', 'sb-badge sb-badge--reach', 'リーチ');
  return null;
}

function nameWithTags(room, name) {
  const who = makeElement('span', 'sb-people__name', name);
  const card = cardOf(room, name);
  if (name === state.nickname && (!card?.proxy || myCardOf(room))) who.append(makeElement('span', 'sb-tag', 'あなた'));
  if (card?.proxy) who.append(makeElement('span', 'sb-tag sb-tag--muted', 'ホストが作成'));
  return who;
}

// 開いたままにしたカードは、作り直しても開いたままにする
function cardDetails(theme, name, cells, status) {
  const details = makeElement('details', 'sb-people__details');
  details.open = state.openDetails.has(name);
  details.addEventListener('toggle', () => {
    if (details.open) state.openDetails.add(name);
    else state.openDetails.delete(name);
  });
  details.append(makeElement('summary', 'sb-people__summary', 'カードを見る'));
  const card = makeElement('div', 'sb-card sb-card--small');
  cardInto(card, theme, cells, status, null);
  details.append(card);
  return details;
}

function mineTag(name) {
  return name === state.nickname ? ['あなた'] : [];
}

function renderPeople(listId, names, labelFor, tagsFor) {
  const key = JSON.stringify(names.map((name) => [name, labelFor(name), tagsFor(name)]));
  renderKeyed($(listId), key, (list) => {
    names.forEach((name) => {
      const row = makeElement('li', 'sb-people__item');
      const head = makeElement('div', 'sb-people__head');
      const who = makeElement('span', 'sb-people__name', name);
      tagsFor(name).forEach((tag) => who.append(makeElement('span', 'sb-tag', tag)));
      head.append(who, makeElement('span', 'sb-people__status', labelFor(name)));
      row.append(head);
      list.append(row);
    });
  });
}

/* ── 待機 ── */
function renderWaiting(room) {
  showScreen('waiting');
  const host = state.role === 'host';
  $('waitingLead').textContent = host
    ? 'テーマとひく回数を決めて、「このテーマでカードを作る」を押してね。'
    : (state.role === 'spectator'
      ? 'ルームコード ' + state.roomCode + ' で参加できるよ。ルームに入れない人の分は、ホストがカードを作れるよ。'
      : 'ホストがテーマを決めるまで待ってね。');
  renderPeople('waitingPlayers', memberNames(room), (name) => {
    if (!room.players[name].isHost) return '参加中';
    return room.hostPlays ? 'ホスト（遊ぶ）' : 'ホスト（進行）';
  }, mineTag);
  $('waitingCount').textContent = '参加者（遊ぶ人 ' + playingNames(room).length + '人）';
  $('hostWaitingTools').hidden = !host;
  if (!host) return;
  $('hostPlays').checked = !!room.hostPlays;

  renderKeyed($('themeChoices'), 'themes', (box) => {
    THEMES.forEach((theme, index) => {
      const button = makeElement('button', 'sb-theme');
      button.type = 'button';
      button.dataset.id = theme.id;
      button.setAttribute('aria-label', (index + 1) + '番のテーマ: ' + theme.name);
      const body = makeElement('span', 'sb-theme__body');
      body.append(
        makeElement('span', 'sb-theme__name', theme.name),
        makeElement('span', 'sb-theme__sample', theme.items.slice(0, 3).map((item) => item.t).join('・') + ' など'),
      );
      button.append(makeElement('span', 'sb-theme__num', circledNum(index + 1)), body);
      button.addEventListener('click', () => {
        state.themePick = theme.id;
        if (state.room) renderRoom(state.room);
      });
      box.append(button);
    });
  });
  $('themeChoices').querySelectorAll('.sb-theme').forEach((button) => {
    button.setAttribute('aria-pressed', button.dataset.id === state.themePick ? 'true' : 'false');
  });

  renderKeyed($('drawChoices'), 'draws', (box) => {
    DRAW_OPTIONS.forEach((value) => {
      const button = makeElement('button', 'sb-seg__btn', value + '回');
      button.type = 'button';
      button.dataset.value = String(value);
      button.addEventListener('click', () => {
        state.drawPick = value;
        if (state.room) renderRoom(state.room);
      });
      box.append(button);
    });
  });
  $('drawChoices').querySelectorAll('.sb-seg__btn').forEach((button) => {
    button.setAttribute('aria-pressed', Number(button.dataset.value) === state.drawPick ? 'true' : 'false');
  });

  $('btnStartPicking').disabled = !state.themePick;
  $('startNote').textContent = state.themePick ? 'あとから参加した人も、カードを作る間に入れば遊べるよ。' : 'テーマを1つ選んでね。';
}

/* ── カードを作る ── */
function activeChosen() {
  return state.proxyMode ? state.proxyChosen : state.chosen;
}

// カードを作った本人が、いまルームにいない（ホストが代わりに作ったカードは数えない）
function ownerAway(room, name) {
  const card = cardOf(room, name);
  return !!card && !card.proxy && !room.players?.[name];
}

function pickingLabel(room, name) {
  if (ownerAway(room, name)) return 'できた（接続が切れています）';
  if (cardOf(room, name)) return 'できた';
  return '作っているところ…';
}

// カードを作る人: 遊ぶ人（在室）と、もうカードがある人（切断中・ホストが代わりに作った人）を参加順に
function pickingNames(room) {
  const order = new Map();
  playingNames(room).forEach((name) => order.set(name, Number(room.players[name].joinedAt) || 0));
  cardNames(room).forEach((name) => {
    if (!order.has(name)) order.set(name, cardOf(room, name).joinedAt);
  });
  return [...order.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

function renderPicker(theme) {
  const chosen = activeChosen();
  const full = chosen.length >= CARD_CELLS;
  $('pickCount').textContent = full ? '9個そろったよ' : 'あと' + (CARD_CELLS - chosen.length) + '個';

  renderKeyed($('pickCands'), 'cands:' + theme.key, (box) => {
    theme.items.forEach((item, index) => {
      const button = makeElement('button', 'sb-cand');
      button.type = 'button';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', (index + 1) + '番: ' + item.t);
      const body = makeElement('span', 'sb-cand__text');
      itemInto(body, theme, index);
      button.append(makeElement('span', 'sb-cand__num', circledNum(index + 1)), body);
      button.addEventListener('click', () => toggleCandidate(index));
      box.append(button);
    });
  });
  $('pickCands').querySelectorAll('.sb-cand').forEach((button) => {
    const selected = chosen.includes(Number(button.dataset.index));
    button.setAttribute('aria-pressed', selected ? 'true' : 'false');
    // disabled にするとフォーカスが外れるので、押せないことは aria-disabled と見た目で伝える
    button.setAttribute('aria-disabled', full && !selected ? 'true' : 'false');
  });

  renderKeyed($('pickPreview'), 'preview:' + theme.key + ':' + chosen.join(','), (box) => {
    cardInto(box, theme, chosen, null, null);
  });
  $('btnSubmitCard').disabled = !full;
  $('btnAutoPick').disabled = full;
  $('btnClearPick').hidden = chosen.length === 0;
}

function renderPicking(room) {
  showScreen('picking');
  const theme = themeOf(room);
  const host = state.role === 'host';
  const spectator = state.role === 'spectator';
  const uid = currentUid();
  const me = state.nickname;
  const iPlay = !spectator && playsName(room, me) && room.players?.[me]?.uid === uid;
  const mine = myCardOf(room);
  const proxy = host && state.proxyMode;
  const choosing = proxy || (iPlay && !mine);

  $('pickingTheme').textContent = 'テーマ：' + theme.name;
  $('pickingTitle').textContent = proxy
    ? 'ルームに入れない人のカードを作る'
    : (choosing ? '好きなものを9個選ぼう' : 'みんなのカードを待っています');
  $('pickingLead').textContent = proxy
    ? 'チャットで教えてもらった番号を押すか、「おまかせで選ぶ」で作ってね。'
    : (choosing
      ? '選んだ順に、カードにならぶよ。深く考えなくてOK。'
      : (spectator ? 'ルームに入っている人は、自分の画面でカードを作ってね。' : ''));

  $('pickerPanel').hidden = !choosing;
  $('proxyNameWrap').hidden = !proxy;
  $('btnCancelProxy').hidden = !proxy;
  if (choosing) renderPicker(theme);

  $('pickDonePanel').hidden = choosing || !mine;
  if (mine && !choosing) {
    $('pickDoneText').textContent = mine.proxy
      ? 'ホストが、あなたのカードを作ってくれたよ。このゲームは、このカードで遊べるよ。'
      : (host
        ? 'カードができたよ。みんながそろったら「ビンゴをはじめる」を押してね。'
        : 'カードができたよ。ホストが始めるまで待ってね。');
    $('btnRedoCard').hidden = mine.proxy;
    renderKeyed($('pickMyCard'), 'mine:' + theme.key + ':' + mine.cells.join(','), (box) => {
      cardInto(box, theme, mine.cells, null, null);
    });
  }

  const showInfo = !choosing && !mine && !spectator;
  $('pickInfoPanel').hidden = !showInfo;
  if (showInfo) {
    $('pickInfoText').textContent = host
      ? 'みんながカードを作っています。そろったら「ビンゴをはじめる」を押してね。'
      : 'みんながカードを作っています。';
  }

  $('watchCandsPanel').hidden = !spectator;
  if (spectator) {
    renderKeyed($('watchCands'), 'watch:' + theme.key, (box) => {
      theme.items.forEach((item, index) => {
        const row = makeElement('div', 'sb-cand sb-cand--static');
        const body = makeElement('span', 'sb-cand__text');
        itemInto(body, theme, index);
        row.append(makeElement('span', 'sb-cand__num', circledNum(index + 1)), body);
        box.append(row);
      });
    });
  }

  renderPickingPeople(room, theme, host);

  $('hostPickingTools').hidden = !host || proxy;
  if (!host || proxy) return;
  const cards = cardNames(room).length;
  const enough = cards >= MIN_CARDS;
  $('btnStartPlaying').disabled = !enough;
  // ホストが自分のカードを選んでいる間は「ビンゴをはじめる」を副ボタンにする（主ボタンは1画面に1つ）
  $('btnStartPlaying').className = 'btn btn-full ' + (choosing ? 'btn-secondary sb-gap' : 'btn-primary');
  $('btnAddProxy').disabled = cards >= MAX_CARDS;
  $('pickingNote').textContent = enough ? '' : 'カードが2枚以上できたら始められるよ。';
}

function renderPickingPeople(room, theme, host) {
  const names = pickingNames(room);
  const key = JSON.stringify([theme.key, host, names.map((name) => {
    const card = cardOf(room, name);
    return [name, pickingLabel(room, name), card ? card.cells : null, !!card?.proxy, name === state.nickname];
  })]);
  renderKeyed($('pickingPeople'), key, (list) => {
    names.forEach((name) => {
      const card = cardOf(room, name);
      const row = makeElement('li', 'sb-people__item');
      const head = makeElement('div', 'sb-people__head');
      head.append(nameWithTags(room, name));
      const label = makeElement('span', 'sb-people__status', pickingLabel(room, name));
      if (!card) label.classList.add('is-wait');
      head.append(label);
      row.append(head);
      if (card) row.append(cardDetails(theme, name, card.cells, null));
      // ホストは、代わりに作ったカードと、いなくなった人のカードを取り消せる
      if (host && (card?.proxy || ownerAway(room, name))) {
        const remove = makeElement('button', 'sb-quiet-btn sb-quiet-btn--inline', 'このカードを取り消す');
        remove.type = 'button';
        remove.addEventListener('click', () => removeCardByHost(name));
        row.append(remove);
      }
      list.append(row);
    });
    if (names.length === 0) list.append(makeElement('li', 'sb-people__empty', 'カードを作る人がまだいないよ。'));
  });
}

function toggleCandidate(index) {
  const chosen = activeChosen();
  const at = chosen.indexOf(index);
  if (at >= 0) chosen.splice(at, 1);
  else if (chosen.length < CARD_CELLS) chosen.push(index);
  if (state.room) renderRoom(state.room);
}

function autoPick() {
  const chosen = activeChosen();
  const pool = shuffled(Array.from({ length: ITEM_COUNT }, (_, i) => i).filter((i) => !chosen.includes(i)));
  while (chosen.length < CARD_CELLS && pool.length) chosen.push(pool.pop());
  if (state.room) renderRoom(state.room);
  focusVisible('#btnSubmitCard');
}

function clearPick() {
  activeChosen().length = 0;
  if (state.room) renderRoom(state.room);
  focusVisible('#pickCands .sb-cand');
}

// 見えている要素のうち、最初に見つかったものへフォーカスする
function focusVisible(...selectors) {
  for (const selector of selectors) {
    const node = [...document.querySelectorAll(selector)].find((item) => !item.closest('[hidden]') && !item.disabled);
    if (node) {
      node.focus();
      return true;
    }
  }
  return false;
}

// 自分のカードを、今のゲームの枠にだけ書く・消す。進行が変わっていたら書かない
async function playerTransaction(update, failMessage) {
  if (state.role !== 'host' && state.role !== 'guest') return false;
  if (state.busy || !state.roomRef || !state.room) return false;
  const round = state.room.round;
  const nickname = state.nickname;
  const uid = currentUid();
  state.busy = true;
  try {
    let reason = '';
    const result = await state.roomRef.transaction((room) => {
      reason = '';
      if (!room || isExpired(room)) return;
      if (room.status !== STATUS.PICKING) { reason = 'moved'; return; }
      if (room.round !== round) { reason = 'changed'; return; }
      const key = 'r' + room.round;
      const cards = update(room, room.cards?.[key] || {}, nickname, uid, (why) => { reason = why; });
      if (!cards) return;
      return { ...room, cards: { [key]: cards } };
    });
    if (!result.committed && reason !== 'moved') {
      toast(reason === 'full' ? 'カードは' + MAX_CARDS + '枚までだよ' : failMessage);
    }
    return result.committed;
  } catch (error) {
    console.warn('[suki-bingo] card write failed', error);
    toast(failMessage);
    return false;
  } finally {
    state.busy = false;
  }
}

async function submitMyCard() {
  const cells = validCells(state.chosen);
  if (!cells || state.busy) return;
  state.focusNext = '#btnRedoCard';
  const ok = await playerTransaction((room, cards, nickname, uid, fail) => {
    const player = room.players?.[nickname];
    if (!player || player.uid !== uid || !playsName(room, nickname)) return null;
    if (reservedByOther(room, nickname, uid)) return null;
    if (!cards[nickname] && Object.keys(cards).length >= MAX_CARDS) { fail('full'); return null; }
    return { ...cards, [nickname]: { uid, joinedAt: Number(player.joinedAt) || 0, cells } };
  }, 'カードを決められませんでした。もう一度ためしてね');
  if (ok) state.chosen = [];
  else state.focusNext = null;
  if (state.room) renderRoom(state.room);
}

// 作りなおすときは、前に選んだものを入れた状態から選びなおせる
async function redoMyCard() {
  const before = state.room ? myCardOf(state.room) : null;
  if (!before || state.busy) return;
  // カードが消えた瞬間に選ぶ画面が出るので、先に入れておく
  state.chosen = before.cells.slice();
  state.focusNext = '#pickCands .sb-cand';
  const ok = await playerTransaction((room, cards, nickname, uid) => {
    const mine = cards[nickname];
    if (!mine || mine.proxy || mine.uid !== uid) return null;
    const next = { ...cards };
    delete next[nickname];
    return next;
  }, '作りなおせませんでした。もう一度ためしてね');
  if (!ok) {
    state.chosen = [];
    state.focusNext = null;
  }
  if (state.room) renderRoom(state.room);
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
    console.warn('[suki-bingo] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    state.busy = false;
  }
}

async function setHostPlays(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, hostPlays: !!value };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && state.room) renderRoom(state.room);
}

async function startPicking() {
  const themeId = state.themePick;
  const drawTotal = state.drawPick;
  const theme = THEMES.find((item) => item.id === themeId);
  if (!theme || !DRAW_OPTIONS.includes(drawTotal)) return;
  // このゲームで候補に出す16個は、transaction の外で1回だけ決める（ならびはテーマの語の順のまま）
  const items = shuffled(theme.items.map((_, index) => index)).slice(0, ITEM_COUNT).sort((a, b) => a - b);
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return {
      ...room,
      status: STATUS.PICKING,
      round: (Number(room.round) || 0) + 1,
      themeId,
      items,
      theme: null,
      drawTotal,
      cards: null,
      drawn: null,
    };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) window.RoomkStats?.count('theme-' + themeId);
  if (ok === false) toast('はじめられませんでした。画面を確かめてね');
}

function toWaiting(room) {
  return { ...room, status: STATUS.WAITING, themeId: null, items: null, theme: null, cards: null, drawn: null };
}

async function backToWaiting() {
  const round = state.room?.round;
  if (cardNames(state.room).length > 0
    && !window.confirm('テーマを選びなおすと、みんなが作ったカードは消えます。選びなおしますか？')) return;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.PICKING || room.round !== round) return;
    return toWaiting(room);
  }, 'もどれませんでした。もう一度ためしてね');
  if (ok === false) toast('もどれませんでした。画面を確かめてね');
}

function openProxy() {
  if (state.role !== 'host') return;
  state.proxyMode = true;
  state.proxyChosen = [];
  $('proxyName').value = '';
  setError('proxyError', '');
  if (state.room) renderRoom(state.room);
  $('proxyName').focus({ preventScroll: true });
  $('pickingTitle').scrollIntoView({ block: 'start' });
}

function closeProxy() {
  state.proxyMode = false;
  state.proxyChosen = [];
  setError('proxyError', '');
  if (state.room) renderRoom(state.room);
  focusVisible('#btnAddProxy', '#btnStartPlaying');
}

async function submitProxyCard() {
  const name = $('proxyName').value.trim();
  const error = validNickname(name);
  if (error) {
    setError('proxyError', error);
    $('proxyName').focus();
    return;
  }
  const cells = validCells(state.proxyChosen);
  if (!cells) return;
  setError('proxyError', '');
  const round = state.room?.round;
  const uid = currentUid();
  const joinedAt = RoomkRTDB.now();
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== STATUS.PICKING || room.round !== round) return;
    const key = 'r' + room.round;
    const cards = room.cards?.[key] || {};
    if (name === room.host || room.players?.[name] || cards[name]) { reason = 'name'; return; }
    if (Object.keys(cards).length >= MAX_CARDS) { reason = 'full'; return; }
    return { ...room, cards: { [key]: { ...cards, [name]: { uid, proxy: true, joinedAt, cells } } } };
  }, 'カードを足せませんでした。もう一度ためしてね');
  if (ok) {
    closeProxy();
  } else if (ok === false) {
    if (reason === 'name') setError('proxyError', 'その名前は使われているよ。少し変えてみてね');
    else toast(reason === 'full' ? 'カードは' + MAX_CARDS + '枚までだよ' : 'カードを足せませんでした。画面を確かめてね');
  }
}

async function removeCardByHost(name) {
  const round = state.room?.round;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.PICKING || room.round !== round) return;
    const key = 'r' + room.round;
    const cards = room.cards?.[key] || {};
    // 在室している人のカードは、本人だけが作りなおせる
    if (!cards[name] || (!cards[name].proxy && room.players?.[name])) return;
    const next = { ...cards };
    delete next[name];
    return { ...room, cards: { [key]: next } };
  }, '取り消せませんでした。もう一度ためしてね');
  if (ok === false) toast('取り消せませんでした。画面を確かめてね');
  if (ok) focusVisible('#btnAddProxy');
}

async function startPlaying() {
  const room = state.room;
  if (!room) return;
  const round = room.round;
  const making = playingNames(room).filter((name) => !cardOf(room, name));
  if (making.length > 0
    && !window.confirm('まだカードを作っている人がいます。はじめると、その人は今回は見ているだけになります。はじめますか？')) return;
  const ok = await hostTransaction((current) => {
    if (current.status !== STATUS.PICKING || current.round !== round) return;
    if (cardNames(current).length < MIN_CARDS) return;
    return { ...current, status: STATUS.PLAYING, drawn: null };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok === false) toast('はじめられませんでした。カードの数を確かめてね');
}

async function drawNext() {
  if (state.rolling || !state.room) return;
  const round = state.room.round;
  const before = drawnOf(state.room);
  const count = before.length;
  // ひく候補は transaction の外で1回だけ決める（再実行されても、ホストの画面に出した候補が入れかわらない）
  const rest = Array.from({ length: ITEM_COUNT }, (_, i) => i).filter((i) => !before.includes(i));
  if (!rest.length) return;
  const picked = rest[Math.floor(Math.random() * rest.length)];
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.PLAYING || room.round !== round) return;
    const drawn = drawnOf(room);
    if (drawn.length !== count || drawn.length >= drawTotalOf(room) || drawn.includes(picked)) return;
    return { ...room, drawn: [...drawn, picked] };
  }, 'ひけませんでした。もう一度ためしてね');
  if (ok === false) toast('ひけませんでした。画面を確かめてね');
}

async function showResult(early) {
  const round = state.room?.round;
  if (early && !window.confirm('ここで終わりにして、結果を見ますか？')) return;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.PLAYING || room.round !== round) return;
    return { ...room, status: STATUS.RESULT };
  }, '進めませんでした。もう一度ためしてね');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
}

async function playAgain() {
  const round = state.room?.round;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.RESULT || room.round !== round) return;
    return toWaiting(room);
  }, '進めませんでした。もう一度ためしてね');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
}

/* ── ビンゴ ── */
function stopRoll() {
  clearTimeout(state.rollTimer);
  state.rollTimer = null;
  state.rolling = false;
}

// 新しく1つひかれたら、候補がぱらぱら切り替わる演出をはさんでから出す（端末ごと）。
// 途中から入った・読み込みなおした・画面を隠していたときは、演出なしで今の状態を出す
function syncDraws(room) {
  const count = drawnOf(room).length;
  if (room.status !== STATUS.PLAYING || state.shownRound !== room.round) {
    stopRoll();
    state.shownRound = room.round;
    state.shownCount = count;
    return;
  }
  if (state.rolling || count === state.shownCount) return;
  if (count === state.shownCount + 1 && !reduceMotion.matches && !document.hidden) startRoll();
  else state.shownCount = count;
}

function startRoll() {
  const room = state.room;
  const theme = themeOf(room);
  const shown = drawnOf(room).slice(0, state.shownCount);
  const order = shuffled(Array.from({ length: ITEM_COUNT }, (_, i) => i).filter((i) => !shown.includes(i)));
  state.rolling = true;
  let step = 0;
  const tick = () => {
    if (!state.rolling) return;
    if (step >= ROLL_STEPS || !theme || order.length === 0) {
      finishRoll();
      return;
    }
    const word = $('drawWord');
    word.replaceChildren();
    delete word.dataset.key;
    word.className = 'sb-draw__word is-rolling';
    itemInto(word, theme, order[step % order.length]);
    step += 1;
    state.rollTimer = setTimeout(tick, ROLL_INTERVAL_MS);
  };
  tick();
}

function finishRoll() {
  stopRoll();
  const room = state.room;
  if (!room || room.status !== STATUS.PLAYING) return;
  state.shownCount = drawnOf(room).length;
  renderRoom(room);
  const word = $('drawWord');
  word.classList.remove('pop-in');
  void word.offsetWidth; // アニメーションをやり直す
  word.classList.add('pop-in');
}

// 演出の途中でタブを隠すと、タイマーが間引かれて古い表示が残る。隠れたらすぐ今の状態を出す
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.rolling) finishRoll();
});

// 直前の1回で起きたこと（選んでいた人・新しくビンゴ・新しくリーチ）
function lastDrawEvents(room, visible) {
  if (visible.length === 0) return null;
  const index = visible[visible.length - 1];
  const before = new Set(visible.slice(0, -1));
  const after = new Set(visible);
  const holders = [];
  const newBingo = [];
  const newReach = [];
  cardNames(room).forEach((name) => {
    const cells = cardOf(room, name).cells;
    if (!cells.includes(index)) return;
    holders.push(name);
    const was = statusOf(cells, before);
    const now = statusOf(cells, after);
    if (now.lines > was.lines) newBingo.push(name);
    else if (now.reach && !was.reach && now.lines === 0) newReach.push(name);
  });
  return { index, holders, newBingo, newReach };
}

function isMe(room, name) {
  return name === state.nickname && !!myCardOf(room);
}

function renderWho(room, visible, finished) {
  const events = state.rolling ? null : lastDrawEvents(room, visible);
  const key = JSON.stringify([state.rolling, events, finished, state.nickname]);
  renderKeyed($('whoBox'), key, (box) => {
    if (!events) return;
    box.append(makeElement('p', 'sb-who__label', '選んでいた人'));
    if (events.holders.length === 0) {
      box.append(makeElement('p', 'sb-who__none', '選んでいた人はいなかったよ'));
    } else {
      const chips = makeElement('ul', 'sb-who__chips');
      events.holders.forEach((name) => {
        chips.append(makeElement('li', 'sb-who__chip' + (isMe(room, name) ? ' is-self' : ''), name));
      });
      box.append(chips);
    }
    events.newBingo.forEach((name) => {
      const line = makeElement('p', 'sb-who__news sb-who__news--bingo');
      line.append(icon('celebration'), isMe(room, name) ? 'あなたがビンゴ！' : name + 'さんがビンゴ！');
      box.append(line);
    });
    if (events.newReach.length > 0 && !finished) {
      const names = events.newReach.map((name) => (isMe(room, name) ? 'あなた' : name + 'さん')).join('、');
      box.append(makeElement('p', 'sb-who__news', names + 'がリーチ'));
    }
  });
}

function renderPlaying(room) {
  showScreen('playing');
  const theme = themeOf(room);
  const host = state.role === 'host';
  const spectator = state.role === 'spectator';
  const total = drawTotalOf(room);
  const visible = drawnOf(room).slice(0, state.shownCount);
  const finished = visible.length >= total;
  const last = visible.length ? visible[visible.length - 1] : null;
  const drawnSet = new Set(visible);

  $('playingTheme').textContent = 'テーマ：' + theme.name;
  $('playingProgress').textContent = visible.length + ' / ' + total + ' 回';

  if (!state.rolling) {
    renderKeyed($('drawWord'), 'word:' + room.round + ':' + theme.key + ':' + last, (word) => {
      word.className = 'sb-draw__word' + (last === null ? ' is-empty' : '');
      if (last === null) word.textContent = host ? '「ひく」を押すと、はじまるよ' : 'ホストがひくと、ここに出るよ';
      else itemInto(word, theme, last);
    });
  }
  renderWho(room, visible, finished);

  $('hostPlayingTools').hidden = !host;
  if (host) {
    const label = finished ? '結果を見る' : (visible.length === 0 ? 'ひく' : 'つぎをひく');
    renderKeyed($('btnDraw'), 'draw:' + label, (button) => {
      button.append(icon(finished ? 'flag' : 'casino'), label);
    });
    $('btnDraw').disabled = state.rolling;
    $('btnEndEarly').hidden = finished;
  }
  $('playingWait').hidden = host || spectator;
  $('playingWait').textContent = finished ? 'ホストが結果を出すまで待ってね。' : 'ホストがひくのを待ってね。';

  renderKeyed($('drawHistory'), 'history:' + theme.key + ':' + visible.join(','), (list) => {
    if (visible.length === 0) list.append(makeElement('li', 'sb-history__empty', 'まだないよ'));
    visible.forEach((index) => {
      const item = makeElement('li', 'sb-history__item');
      itemInto(item, theme, index);
      list.append(item);
    });
  });

  const mine = spectator ? null : myCardOf(room);
  $('myCardBlock').hidden = !mine;
  if (mine) {
    const status = statusOf(mine.cells, drawnSet);
    renderKeyed($('myCard'), 'my:' + theme.key + ':' + mine.cells.join(',') + ':' + visible.join(','), (box) => {
      cardInto(box, theme, mine.cells, status, last);
    });
    $('myStatus').textContent = status.lines > 0
      ? 'ビンゴ ' + status.lines + '本'
      : (status.reach && !finished ? 'リーチ。あと1つでビンゴ' : '');
  }
  // 途中から入った人・カードを作り終わる前に始まった人
  const watching = !mine && !spectator && (state.role === 'guest' || playsName(room, state.nickname));
  $('noCardNote').hidden = !watching;

  // 自分のカードがない画面（みんなにみせる画面・進行だけのホストなど）は、全員のカードを開いて出す
  const expanded = !mine;
  const names = cardNames(room).filter((name) => !(mine && name === state.nickname));
  $('othersLabel').hidden = names.length === 0;
  $('playingPeople').hidden = expanded || names.length === 0;
  $('playingCards').hidden = !expanded;
  const peopleKey = JSON.stringify([theme.key, expanded, finished, visible, names.map((name) => [name, cardOf(room, name).cells, cardOf(room, name).proxy])]);
  if (expanded) {
    renderKeyed($('playingCards'), peopleKey, (box) => {
      names.forEach((name) => box.append(resultCard(room, theme, name, drawnSet, finished, last)));
    });
  } else {
    renderKeyed($('playingPeople'), peopleKey, (list) => {
      names.forEach((name) => {
        const card = cardOf(room, name);
        const status = statusOf(card.cells, drawnSet);
        const row = makeElement('li', 'sb-people__item');
        const head = makeElement('div', 'sb-people__head');
        const right = makeElement('span', 'sb-people__marks');
        right.append(miniGrid(status));
        const badge = statusBadge(status, finished);
        if (badge) right.append(badge);
        head.append(nameWithTags(room, name), right);
        row.append(head, cardDetails(theme, name, card.cells, status));
        list.append(row);
      });
    });
  }
}

/* ── おわり ── */
function resultCard(room, theme, name, drawnSet, finished, freshIndex) {
  const card = cardOf(room, name);
  const status = statusOf(card.cells, drawnSet);
  const box = makeElement('div', 'sb-result-card');
  const head = makeElement('div', 'sb-result-card__head');
  head.append(nameWithTags(room, name));
  const badge = statusBadge(status, finished);
  if (badge) head.append(badge);
  const grid = makeElement('div', 'sb-card sb-card--small');
  cardInto(grid, theme, card.cells, status, freshIndex);
  box.append(head, grid);
  return box;
}

function overlapRow(theme, index, holders, total, showCount) {
  const row = makeElement('li', 'sb-overlap__row');
  const item = makeElement('span', 'sb-overlap__item');
  itemInto(item, theme, index);
  row.append(item);
  if (showCount) {
    row.append(makeElement('span', 'sb-overlap__count', holders.length === total ? '全員' : holders.length + '人'));
  }
  row.append(makeElement('span', 'sb-overlap__names', holders.join('、')));
  return row;
}

function renderResult(room) {
  showScreen('result');
  const theme = themeOf(room);
  const host = state.role === 'host';
  const names = cardNames(room);
  const drawn = drawnOf(room);
  const drawnSet = new Set(drawn);
  $('resultTheme').textContent = 'テーマ：' + theme.name;

  const key = JSON.stringify([theme.key, drawn, state.nickname, names.map((name) => [name, cardOf(room, name).cells, cardOf(room, name).proxy])]);
  const rows = theme.items.map((_, index) => ({
    index,
    holders: names.filter((name) => cardOf(room, name).cells.includes(index)),
  }));
  // 人を並べ替えたり数えたりはしない。出すのは「どの候補を、だれが選んでいたか」だけ
  renderKeyed($('resultMany'), 'many:' + key, (list) => {
    // 多い順に3つ。3つ目と同じ人数のものは、切らずに全部出す
    const ranked = rows.filter((row) => row.holders.length >= 2)
      .sort((a, b) => b.holders.length - a.holders.length || a.index - b.index);
    const cut = ranked.length > 3 ? ranked[2].holders.length : 0;
    const top = ranked.filter((row) => row.holders.length >= cut);
    if (top.length === 0) list.append(makeElement('li', 'sb-overlap__empty', '今回はなかったよ'));
    top.forEach((row) => list.append(overlapRow(theme, row.index, row.holders, names.length, true)));
  });
  renderKeyed($('resultSolo'), 'solo:' + key, (list) => {
    const only = rows.filter((row) => row.holders.length === 1);
    if (only.length === 0) list.append(makeElement('li', 'sb-overlap__empty', '今回はなかったよ'));
    only.forEach((row) => list.append(overlapRow(theme, row.index, row.holders, names.length, false)));
  });
  renderKeyed($('resultCards'), 'cards:' + key, (box) => {
    names.forEach((name) => box.append(resultCard(room, theme, name, drawnSet, true, null)));
  });

  $('hostResultTools').hidden = !host;
  $('resultWait').hidden = host || state.role === 'spectator';
}

/* ── みんなにみせる画面（画面共有用・見るだけ） ──
   ホストが別のタブで開いて共有する。ルームには入らず、RTDB には一切書き込まない
   （players にも入らない・切断予約をしない・期限切れのルームも消さない）。
   ルームに入れない人は、この画面で候補の番号と自分のカードを見る。 */
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
    console.warn('[suki-bingo] watch failed', error);
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
  document.title = 'みんなにみせる画面 | 好きなものビンゴ | room-K';
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
    handleSpectator(room);
  };
  ref.on('value', state.roomCallback, (error) => {
    console.warn('[suki-bingo] watch listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });
}

function handleSpectator(room) {
  updateWatchOverlay(room);
  syncUiKey(room);
  syncDraws(room);
  renderRoom(room);
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
  resetLocalUi();
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
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

// 参加用のリンク: このページのアドレスの末尾に ?room=ルームコード。チャットに貼ると、参加する人はリンクをひらいて名前を入れるだけで参加できる。
// 「コードをコピー」はコード単体のまま（口頭や画面共有で伝える用）。コピーは共通の RoomkRTDB.copyRoomLink（rtdb-utils.js）
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
$('btnStartPicking').addEventListener('click', startPicking);
$('btnBackToWaiting').addEventListener('click', backToWaiting);
$('btnAutoPick').addEventListener('click', autoPick);
$('btnClearPick').addEventListener('click', clearPick);
$('btnSubmitCard').addEventListener('click', () => {
  if (state.proxyMode) submitProxyCard();
  else submitMyCard();
});
$('btnRedoCard').addEventListener('click', redoMyCard);
$('btnAddProxy').addEventListener('click', openProxy);
$('btnCancelProxy').addEventListener('click', closeProxy);
$('btnStartPlaying').addEventListener('click', startPlaying);
$('btnDraw').addEventListener('click', () => {
  if (!state.room || state.rolling) return;
  if (drawnOf(state.room).length >= drawTotalOf(state.room)) showResult(false);
  else drawNext();
});
$('btnEndEarly').addEventListener('click', () => showResult(true));
$('btnAgain').addEventListener('click', playAgain);

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
