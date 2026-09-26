// 気持ち当てゲーム：場面カードを見て、主役の気持ちがどの系かをみんなで予想する
// ルーム（Realtime Database）で進める。選んだ内容はそのラウンドの間だけルームに置き、
// 次のラウンドに進むときとルームを閉じたときに消える。点数・履歴・まとめは持たない。

// 場面カード（基準は AGENTS.md「場面カードの方針」）。
// ルームでは番号だけを共有するので、並べ替え・途中の削除はしない。追加は末尾だけ
const SCENES = [
  '朝起きたら、外が一面の雪だった',
  '出かけようとしたら、急に大雨が降ってきた',
  '窓を開けたら、ちょうどいい風が入ってきた',
  '夜、窓から遠くの花火が小さく見えた',
  '雷が、ゴロゴロ鳴りはじめた',
  '空に、大きな虹が出ていた',
  '展望台から、遠くまで景色を見わたした',
  'ねこが、ひざの上でねむってしまった',
  '初めて食べた料理が、思っていた味と全然ちがった',
  '好きなお菓子の、新しい味を見つけた',
  '海で、一日じゅう夢中になって遊んだ',
  'ホットケーキを焼いたら、きれいな焼き色がついた',
  'アイスを食べようとしたら、落としてしまった',
  'ゲームで、ずっと勝てなかったボスに、やっと勝った',
  '楽しみにしていたゲームの発売日が、延期になった',
  'ゲームのセーブデータが消えてしまった',
  'パズルの最後の1ピースが、どこにもない',
  'オンライン対戦で、ぎりぎり負けた',
  '新しいゲームを始めたけど、ルールがよくわからない',
  'くじ引きで、1等が当たった',
  '遊びに来ていた人たちが帰って、部屋が静かになった',
  'ドアを押さえて待っていたら、「ありがとう」と言われた',
  '急に予定がなくなって、時間があいた',
  '部屋の片づけが、やっと終わった',
  '長い間さがしていたものが、思わぬところから出てきた',
  '楽しかったお出かけから、家に帰ってきた',
  '長い映画を、最後まで見終わった',
  '髪を思いきって短く切った',
  '待っていた荷物が、予定より早く届いた',
  '大事にしていたコップに、ひびが入っていた',
  '1日かけて作ったプラモデルが完成した',
  '落とした物を、近くにいた人が拾ってくれた',
  '誕生日でもないのに、プレゼントをもらった',
  '散歩中の犬が、しっぽをふって近づいてきた',
  '部屋に、小さなクモがいた',
  '駅で、旅行中の人に道を聞かれた',
  '遊園地で、ジェットコースターの列に並んでいる',
  '目の前で、エレベーターのドアが閉まった',
  '旅行に出発する日の朝',
  '初めて行くお店に入ることになった',
];

// 気持ちの系とことば（旧 きもちのことばマップ から表記を変えずに移した。語彙リスト方針は AGENTS.md）。
// sample は系ボタンに出す代表4語（words の中から選ぶだけで、表記は変えない）
const GROUPS = [
  {
    key: 'niko',
    name: 'にこにこ系',
    sample: ['うれしい', 'わらっちゃう', 'わくわく', 'やったー'],
    words: [
      'うれしい', 'たのしい', 'わらっちゃう', 'にこにこ',
      'ごきげん', 'いいきぶん', 'うきうき', 'わくわく',
      'るんるん', 'はずんでる', 'やったー', 'ラッキー',
    ],
  },
  {
    key: 'poka',
    name: 'ぽかぽか系',
    sample: ['ほっとする', 'のんびり', 'ありがとうのきもち', 'くすぐったい'],
    words: [
      'ぽかぽか', 'あったかい', 'ほっとする', 'あんしん',
      'おちつく', 'のんびり', 'ゆったり', 'まったり',
      'ふんわり', 'やさしいきもち', 'ありがとうのきもち', 'くすぐったい',
    ],
  },
  {
    key: 'moya',
    name: 'もやもや系',
    sample: ['まよってる', 'こまった', 'はずかしい', 'ざんねん'],
    words: [
      'もやもや', 'なんとなくいや', 'ひっかかる', 'はっきりしない',
      'すっきりしない', 'うーんとなる', 'まよってる', 'こまった',
      'きまずい', 'はずかしい', 'ざんねん', 'ものたりない',
    ],
  },
  {
    key: 'zawa',
    name: 'ざわざわ系',
    sample: ['どきどき', 'びっくり', 'いらいら', 'くやしい'],
    words: [
      'ざわざわ', 'そわそわ', 'おちつかない', 'きんちょう',
      'どきどき', 'ふあん', 'しんぱい', 'びっくり',
      'いらいら', 'むかむか', 'ぷんぷん', 'くやしい',
    ],
  },
  {
    key: 'gutta',
    name: 'ぐったり系',
    sample: ['つかれた', 'ねむい', 'さみしい', 'ひとやすみしたい'],
    words: [
      'ぐったり', 'つかれた', 'だるい', 'ねむい',
      'げんきがでない', 'やるきがでない', 'しんどい', 'つらい',
      'おもたいかんじ', 'さみしい', 'ひとりになりたい', 'ひとやすみしたい',
    ],
  },
  {
    key: 'suki',
    name: 'すっきり系',
    sample: ['ふっきれた', 'やりきった', 'ほこらしい', 'やってみたい'],
    words: [
      'すっきり', 'さっぱり', 'かるいかんじ', 'スッとした',
      'ふっきれた', 'やりきった', 'できたかんじ', 'ほこらしい',
      'じしんがついた', 'まえむき', 'やってみたい', 'たのしみ',
    ],
  },
];

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'kimochiate_rooms';
const SESSION_KEY = 'kimochiate_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const MAX_GUESTS = 8;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = {
  WAITING: 'waiting',
  CASTING: 'casting',
  ANSWERING: 'answering',
  REVEAL: 'reveal',
};
const CHOICE_BOXES = ['starGroups', 'guessGroups', 'starWords', 'castChoices', 'watchGroups'];
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
  // 端末の中だけで持つ選び途中の状態。status・ラウンド・場面・主役が変わったら消す
  uiKey: null,
  castPick: null,
  starStep: 'group',
  starGroup: null,
  starWord: null,
  guessGroup: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.ka-screen').forEach((node) => node.classList.remove('active'));
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

function circledNum(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  return String(n);
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

// 主役・予想をする人か（ホストは「ホストも遊ぶ」のときだけ）
function playsName(room, name) {
  const player = room?.players?.[name];
  if (!player) return false;
  return !player.isHost || !!room.hostPlays;
}

function playingNames(room) {
  return memberNames(room).filter((name) => playsName(room, name));
}

// 主役の既定: 前の主役より後に参加した人へ順番に回す。最初はいちばん先に参加した人
function defaultStar(room) {
  const names = playingNames(room);
  if (!names.length) return null;
  const last = room.lastStar;
  if (!last) return names[0];
  const lastAt = Number(last.joinedAt) || 0;
  const next = names.find((name) => {
    const at = Number(room.players[name].joinedAt) || 0;
    return at > lastAt || (at === lastAt && name.localeCompare(last.name, 'ja') > 0);
  });
  return next || names[0];
}

function isGroupIndex(value) {
  return Number.isInteger(value) && value >= 0 && value < GROUPS.length;
}

function isWordIndex(group, value) {
  return isGroupIndex(group) && Number.isInteger(value) && value >= 0 && value < GROUPS[group].words.length;
}

function sceneText(room) {
  return SCENES[room?.scene] || '';
}

// 使っていない場面から1枚引く（いま出ている場面は避ける）。使い切ったら最初から
function pickScene(room) {
  const all = SCENES.map((_, index) => index);
  const current = Number.isInteger(room.scene) ? room.scene : null;
  const usedList = Object.values(room.usedScenes || {}).filter((index) => Number.isInteger(index));
  const used = new Set(usedList);
  let pool = all.filter((index) => !used.has(index) && index !== current);
  let nextUsed = usedList;
  if (!pool.length) {
    pool = all.filter((index) => index !== current);
    nextUsed = [];
  }
  if (!pool.length) pool = all;
  const scene = pool[Math.floor(Math.random() * pool.length)];
  return { scene, usedScenes: [...nextUsed, scene] };
}

// ラウンドの選択は picks/r{ラウンド} にだけ置く（ほかのラウンドの分は持たない）
function roundPicks(room) {
  return room?.picks?.['r' + room.round] || {};
}

// その名前の今の持ち主（匿名ID）が出した選択だけを返す。
// 主役は starUid と照合する。選んだあとで切断した人の選択は、名前の予約で守られているので数える
function pickOf(room, name) {
  if (!name) return null;
  const pick = roundPicks(room)[name];
  if (!pick || !pick.uid) return null;
  if (name === room.star) return pick.uid === room.starUid ? pick : null;
  const owner = room.players?.[name]?.uid ?? room.members?.[name]?.uid;
  return owner == null || owner === pick.uid ? pick : null;
}

// 切断中の人の名前を別の人が使って、その人の主役や選択を引き継がないようにする
// （このラウンドの参加者 members に残っている間は、同じ匿名IDの人だけが使える）
function reservedByOther(room, name, uid) {
  if (room.star === name && room.starUid && room.starUid !== uid) return true;
  const member = room.members?.[name];
  if (member && member.uid !== uid) return true;
  const pick = roundPicks(room)[name];
  return !!pick && pick.uid !== uid;
}

// このラウンドの参加者を参加順に（切断中の人・選んでから抜けた人も含める）
function roundOrder(room) {
  const order = new Map();
  Object.entries(room.members || {}).forEach(([name, member]) => order.set(name, Number(member?.joinedAt) || 0));
  playingNames(room).forEach((name) => {
    if (!order.has(name)) order.set(name, Number(room.players[name].joinedAt) || 0);
  });
  Object.keys(roundPicks(room)).forEach((name) => {
    if (!order.has(name)) order.set(name, Number.MAX_SAFE_INTEGER);
  });
  return [...order.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

function memberEntry(player) {
  return { uid: player.uid, joinedAt: Number(player.joinedAt) || 0 };
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
    console.warn('[kimochi-ate] expired room cleanup failed', error);
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

/* ── 再接続用の記録（選んだ内容は保存しない） ── */
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
function resetChoice() {
  state.starStep = 'group';
  state.starGroup = null;
  state.starWord = null;
  state.guessGroup = null;
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
    castPick: null,
    watchTimer: null,
  });
  resetChoice();
  clearSession();
  CHOICE_BOXES.forEach((id) => {
    const box = $(id);
    box.replaceChildren();
    delete box.dataset.key;
  });
  // 隠れているパネルに前のルームの選び途中を残さない
  $('starWordHead').textContent = '';
  $('starWordHead').className = 'ka-wordhead';
  $('starWords').className = 'ka-words';
  $('doneText').textContent = '';
  $('infoText').textContent = '';
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
    console.warn('[kimochi-ate] room listener failed', error);
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
    console.warn('[kimochi-ate] presence recovery failed', error);
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
  const hostPlays = $('hostPlays').checked;
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
          hostPlays,
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          round: 0,
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
    console.warn('[kimochi-ate] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

async function joinRoom() {
  if (state.busy || state.roomRef) return;
  const nickname = $('guestName').value.trim();
  const code = $('joinCode').value.trim().toUpperCase();
  const error = validNickname(nickname);
  if (error) {
    setError('joinError', error);
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
    // 途中参加もできる。参加順の最後に入り、次の判定から主役・予想に加わる
    const result = await ref.transaction((room) => {
      reason = '';
      if (!room) { reason = '見つからない'; return; }
      if (isExpired(room)) { reason = '終了'; return; }
      if (nickname === room.host || room.players?.[nickname] || reservedByOther(room, nickname, uid)) {
        reason = '名前';
        return;
      }
      if (guestNames(room).length >= MAX_GUESTS) { reason = '満員'; return; }
      const next = {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt },
        },
      };
      // 予想の途中に入った人は、今の場面から予想に加わる
      if (room.status === STATUS.ANSWERING) {
        next.members = { ...(room.members || {}), [nickname]: { uid, joinedAt } };
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
    connectToRoom('guest', nickname, code, ref, joinedAt);
  } catch (err) {
    console.warn('[kimochi-ate] join failed', err);
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
    console.warn('[kimochi-ate] reconnect failed', error);
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
      // 自分の在室と、公開前の自分の選択だけを消す（進行は書き換えない）
      await ref.transaction((room) => {
        if (!room) return;
        const next = { ...room, players: { ...(room.players || {}) } };
        if (next.players[nickname]?.uid === uid) delete next.players[nickname];
        const key = 'r' + room.round;
        if (room.status === STATUS.ANSWERING && room.picks?.[key]?.[nickname]?.uid === uid) {
          const picks = { ...room.picks[key] };
          delete picks[nickname];
          next.picks = { [key]: picks };
        }
        if (room.status === STATUS.ANSWERING && room.members?.[nickname]?.uid === uid) {
          next.members = { ...room.members };
          delete next.members[nickname];
        }
        return next;
      });
    }
  } catch (error) {
    console.warn('[kimochi-ate] leave failed', error);
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
  switch (room.status) {
    case STATUS.CASTING: renderCasting(room); break;
    case STATUS.ANSWERING: renderAnswering(room); break;
    case STATUS.REVEAL: renderReveal(room); break;
    default: renderWaiting(room);
  }
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
// ほかの人の提出で再描画されても、選び途中とフォーカスは残す
function syncUiKey(room) {
  // 場面はキーに入れない（casting 中の「別の場面にする」で、ホストが選んだ主役を消さないため）
  const key = [room.status, room.round, room.star].join(':');
  if (key === state.uiKey) return;
  state.uiKey = key;
  state.castPick = null;
  resetChoice();
}

function renderPeople(listId, names, labelFor, tagsFor) {
  const list = $(listId);
  list.replaceChildren();
  names.forEach((name) => {
    const row = makeElement('li', 'ka-people__item');
    const who = makeElement('span', 'ka-people__name', name);
    (tagsFor ? tagsFor(name) : []).forEach((tag) => who.append(makeElement('span', 'ka-tag', tag)));
    row.append(who, makeElement('span', 'ka-people__status', labelFor(name)));
    list.append(row);
  });
}

function mineTag(name) {
  return name === state.nickname ? ['あなた'] : [];
}

function renderWaiting(room) {
  showScreen('waiting');
  const host = state.role === 'host';
  $('waitingLead').textContent = host
    ? '参加する人がそろったら「はじめる」を押してね。'
    : (state.role === 'spectator'
      ? 'ルームコード ' + state.roomCode + ' で参加できるよ。ルームに入らない人も、この画面を見ながらチャットで予想できるよ。'
      : 'ホストが始めるまで待ってね。');
  renderPeople('waitingPlayers', memberNames(room), (name) => {
    if (!room.players[name].isHost) return '参加中';
    return room.hostPlays ? 'ホスト（遊ぶ）' : 'ホスト（進行）';
  }, mineTag);
  $('hostWaitingTools').hidden = !host;
  if (!host) return;
  const enough = playingNames(room).length >= 2;
  $('btnStartGame').disabled = !enough;
  $('startNote').textContent = enough
    ? 'あとから参加した人も、途中から遊べます。'
    : (room.hostPlays ? '参加する人が1人以上になったら始められます。' : '参加する人が2人以上になったら始められます。');
}

function renderCastChoices(candidates) {
  const box = $('castChoices');
  const key = candidates.join('\n');
  if (box.dataset.key !== key) {
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.name : null;
    box.replaceChildren();
    candidates.forEach((name, index) => {
      const button = makeElement('button', 'ka-castbtn');
      button.type = 'button';
      button.dataset.name = name;
      button.setAttribute('aria-label', (index + 1) + '番: ' + name);
      button.append(makeElement('span', 'ka-castbtn__num', circledNum(index + 1)), makeElement('span', '', name));
      if (name === state.nickname) button.append(makeElement('span', 'ka-tag', 'あなた'));
      button.addEventListener('click', () => {
        state.castPick = name;
        if (state.room) renderCasting(state.room);
      });
      box.append(button);
      if (name === focused) button.focus();
    });
    box.dataset.key = key;
  }
  box.querySelectorAll('.ka-castbtn').forEach((button) => {
    const on = button.dataset.name === state.castPick;
    button.classList.toggle('is-selected', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderCasting(room) {
  showScreen('casting');
  $('castingScene').textContent = sceneText(room);
  const host = state.role === 'host';
  $('castingLead').textContent = host
    ? 'この場面の主役を決めてね。やってみたい人がいたら、名前を選んでね。'
    : (state.role === 'spectator'
      ? '主役を決めています。'
      : '主役を決めています。やってみたい人は、声かチャットで教えてね。');
  $('hostCastingTools').hidden = !host;
  if (!host) return;
  const candidates = playingNames(room);
  if (!candidates.includes(state.castPick)) state.castPick = defaultStar(room);
  renderCastChoices(candidates);
  const enough = candidates.length >= 2;
  $('btnConfirmStar').disabled = !enough || !state.castPick;
  $('castNote').textContent = enough ? '' : '遊ぶ人が2人以上になったら始められるよ。';
}

// 系の番号・系名・代表語。代表語は語の途中で折り返さない（語ごとにまとめ、区切りの「・」で折り返す）
function appendGroupContent(node, group, index) {
  const body = makeElement('span', 'ka-groupbtn__body');
  const sample = makeElement('span', 'ka-groupbtn__sample');
  group.sample.forEach((word, i) => {
    if (i) sample.append('・');
    sample.append(makeElement('span', 'ka-nowrap', word));
  });
  body.append(makeElement('span', 'ka-groupbtn__name', group.name), sample);
  node.append(makeElement('span', 'ka-groupbtn__num', circledNum(index + 1)), body);
}

// 系ボタン（番号・系名・代表語）。一度作ったら作り直さず、選択の表示だけ変える（フォーカスを保つ）
function renderGroupChoices(boxId, selected, onPick) {
  const box = $(boxId);
  if (box.dataset.key !== 'groups') {
    box.replaceChildren();
    GROUPS.forEach((group, index) => {
      const button = makeElement('button', 'ka-groupbtn ka-group--' + group.key);
      button.type = 'button';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', (index + 1) + '番: ' + group.name + '（' + group.sample.join('、') + '）');
      appendGroupContent(button, group, index);
      button.addEventListener('click', () => onPick(index));
      box.append(button);
    });
    box.dataset.key = 'groups';
  }
  box.querySelectorAll('.ka-groupbtn').forEach((button) => {
    const on = Number(button.dataset.index) === selected;
    button.classList.toggle('is-selected', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function renderStarWords(groupIndex) {
  const group = GROUPS[groupIndex];
  const head = $('starWordHead');
  head.className = 'ka-wordhead ka-group--' + group.key;
  head.textContent = circledNum(groupIndex + 1) + ' ' + group.name;
  const box = $('starWords');
  const key = 'words:' + groupIndex;
  if (box.dataset.key !== key) {
    box.replaceChildren();
    box.className = 'ka-words ka-group--' + group.key;
    group.words.forEach((word, index) => {
      const button = makeElement('button', 'ka-word');
      button.type = 'button';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', (index + 1) + '番: ' + word);
      button.append(makeElement('span', 'ka-word__num', circledNum(index + 1)), makeElement('span', 'ka-word__text', word));
      button.addEventListener('click', () => {
        state.starWord = index;
        if (state.room) renderAnswering(state.room);
      });
      box.append(button);
    });
    box.dataset.key = key;
  }
  box.querySelectorAll('.ka-word').forEach((button) => {
    const on = Number(button.dataset.index) === state.starWord;
    button.classList.toggle('is-selected', on);
    button.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  $('btnSubmitStar').disabled = !isWordIndex(groupIndex, state.starWord);
}

function progressLabel(room, name) {
  const pick = pickOf(room, name);
  if (pick?.pass) return 'パス';
  // 予想しない人も「えらんだよ」と出す（何を選んだかは出さない）
  if (pick) return 'えらんだよ';
  if (!room.players?.[name]) return '接続が切れています';
  return 'まだ';
}

// 主役が選ぶ前に切断・退出したときの案内（ホストには操作を、ほかの人には待つことを伝える）
function updateStarAway(room, starPick, host) {
  const star = room.star;
  const away = $('starAwayNote');
  const starLeft = !room.members?.[star];
  away.hidden = !star || !!starPick || !!room.players?.[star];
  away.textContent = '主役の' + (star || '') + (starLeft ? 'さんが退出しました。' : 'さんの接続が切れています。')
    + (host
      ? (starLeft ? '「主役をえらびなおす」を押してね。' : '戻るのを待つか、「主役をえらびなおす」を押してね。')
      : (starLeft ? 'ホストが主役をえらびなおすまで待ってね。' : '戻るのを待つか、ホストが主役をえらびなおすまで待ってね。'));
}

function renderAnswering(room) {
  showScreen('answering');
  $('answeringScene').textContent = sceneText(room);
  const me = state.nickname;
  const uid = currentUid();
  const star = room.star;
  const isStar = star === me && room.starUid === uid;
  const starPick = pickOf(room, star);
  const passed = !!starPick?.pass;
  const guessing = !isStar && playsName(room, me) && room.players?.[me]?.uid === uid;
  const myPick = isStar ? starPick : pickOf(room, me);

  $('answeringTitle').textContent = isStar ? 'あなたが主役だよ' : (star || '') + 'さんが主役';
  $('answeringLead').textContent = isStar
    ? '選んだことは、公開するまでほかの人には見えないよ。'
    : (guessing ? '主役の気持ちがどの系か、予想してね。' : '主役とみんなが選んでいます。');
  const host = state.role === 'host';
  updateStarAway(room, starPick, host);
  const doneWait = host ? 'えらんだよ。公開するときは「公開する」を押してね。' : 'えらんだよ。公開を待ってね。';
  const passWait = host ? 'この場面はパスになったよ。「場面をかえる」を押してね。' : 'この場面はパスになったよ。ホストが場面をかえるまで待ってね。';

  $('watchAnswerPanel').hidden = true;
  const show = { starGroupPanel: false, starWordPanel: false, guessPanel: false, donePanel: false, infoPanel: false };
  if (isStar) {
    if (myPick) {
      show.donePanel = true;
      $('doneText').textContent = myPick.pass
        ? (host ? 'パスにしたよ。「場面をかえる」を押してね。' : 'パスにしたよ。ホストが場面をかえるまで待ってね。')
        : doneWait;
      $('btnWithdraw').textContent = myPick.pass ? 'パスをやめる' : 'えらびなおす';
    } else if (state.starStep === 'word' && isGroupIndex(state.starGroup)) {
      show.starWordPanel = true;
      renderStarWords(state.starGroup);
    } else {
      show.starGroupPanel = true;
      renderGroupChoices('starGroups', null, chooseStarGroup);
    }
  } else if (guessing && passed) {
    show.infoPanel = true;
    $('infoText').textContent = passWait;
  } else if (guessing && myPick) {
    show.donePanel = true;
    $('doneText').textContent = doneWait;
    $('btnWithdraw').textContent = 'えらびなおす';
  } else if (guessing) {
    show.guessPanel = true;
    $('guessQuestion').textContent = star + 'さんは、どの系の気持ちになりそう？';
    renderGroupChoices('guessGroups', state.guessGroup, chooseGuessGroup);
    $('btnSubmitGuess').disabled = !isGroupIndex(state.guessGroup);
  } else {
    show.infoPanel = true;
    $('infoText').textContent = passed ? passWait : '主役とみんなが選んでいます。';
  }
  Object.entries(show).forEach(([id, on]) => { $(id).hidden = !on; });

  $('hostAnswerTools').hidden = !host;
  if (!host) return;
  const names = [star].concat(roundOrder(room).filter((name) => name !== star));
  renderPeople('answerProgress', names.filter(Boolean), (name) => progressLabel(room, name),
    (name) => (name === star ? ['主役'] : []).concat(mineTag(name)));
  // ホストも遊んでいて、まだ自分が選んでいない間は「公開する」を副ボタンにする（主ボタンは1画面に1つ）
  const hostChoosing = playsName(room, me) && !pickOf(room, me) && !passed;
  $('btnReveal').hidden = passed;
  $('btnReveal').disabled = !starPick || passed;
  $('btnReveal').className = 'btn btn-full ' + (hostChoosing ? 'btn-secondary' : 'btn-primary');
  $('btnChangeScene').hidden = !passed;
}

function renderReveal(room) {
  showScreen('reveal');
  const star = room.star;
  const isStar = star === state.nickname && room.starUid === currentUid();
  $('revealTitle').textContent = isStar ? 'あなたの気持ち' : (star || '') + 'さんの気持ち';
  $('revealScene').textContent = sceneText(room);
  const pick = pickOf(room, star);
  const answer = $('revealAnswer');
  if (pick && isGroupIndex(pick.group)) {
    const group = GROUPS[pick.group];
    const hasWord = isWordIndex(pick.group, pick.word);
    answer.className = 'ka-answer ka-group--' + group.key + (hasWord ? '' : ' ka-answer--group-only');
    $('revealWord').textContent = hasWord ? group.words[pick.word] : circledNum(pick.group + 1) + ' ' + group.name;
    $('revealGroupNum').textContent = circledNum(pick.group + 1);
    $('revealGroupName').textContent = group.name;
    answer.hidden = false;
  } else {
    answer.hidden = true;
  }

  // 予想した人だけを参加順に並べる。数えたり並べ替えたりはしない
  const list = $('revealGuesses');
  list.replaceChildren();
  const names = roundOrder(room);
  let shown = 0;
  names.forEach((name) => {
    if (name === star) return;
    const guess = pickOf(room, name);
    if (!guess || !isGroupIndex(guess.group)) return;
    shown += 1;
    const group = GROUPS[guess.group];
    const row = makeElement('li', 'ka-guesses__item');
    const who = makeElement('span', 'ka-guesses__name', name);
    mineTag(name).forEach((tag) => who.append(makeElement('span', 'ka-tag', tag)));
    const chip = makeElement('span', 'ka-chip ka-group--' + group.key);
    chip.append(makeElement('span', 'ka-chip__num', circledNum(guess.group + 1)), makeElement('span', '', group.name));
    const mark = makeElement('span', 'ka-guesses__pick');
    mark.append(chip);
    if (pick && guess.group === pick.group) mark.append(makeElement('span', 'ka-same', '同じ'));
    row.append(who, mark);
    list.append(row);
  });
  $('revealEmpty').hidden = shown > 0;
  $('revealEmpty').textContent = state.role === 'spectator'
    ? 'ルームで予想した人はいなかったよ。'
    : '今回は予想した人はいなかったよ。';
  const host = state.role === 'host';
  $('hostRevealTools').hidden = !host;
  $('revealWait').hidden = host;
  $('revealChatNote').hidden = state.role !== 'spectator';
}

/* ── みんなにみせる画面（画面共有用・見るだけ） ──
   ホストが別のタブで開いて共有する。ルームには入らず、RTDB には一切書き込まない
   （players にも入らない・切断予約をしない・期限切れのルームも消さない）。
   見ている全員（主役を含む）が見てよい情報だけを出し、選んだ中身は公開まで出さない。
   チャットだけで参加する子は、この画面を見て系の番号をチャットで送る（アプリには記録しない）。 */
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
    console.warn('[kimochi-ate] watch failed', error);
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
  document.title = 'みんなにみせる画面 | 気持ち当てゲーム | room-K';
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
    console.warn('[kimochi-ate] watch listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });
}

function handleSpectator(room) {
  updateWatchOverlay(room);
  switch (room.status) {
    case STATUS.CASTING: renderCasting(room); break;
    case STATUS.ANSWERING: renderWatchAnswering(room); break;
    case STATUS.REVEAL: renderReveal(room); break;
    default: renderWaiting(room);
  }
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

// 選ぶ画面のみんなにみせる版: 場面・主役・番号つきの系（押せない一覧）・チャットの案内・誰が選び終わったか
function renderWatchAnswering(room) {
  showScreen('answering');
  $('answeringScene').textContent = sceneText(room);
  const star = room.star;
  const starPick = pickOf(room, star);
  const passed = !!starPick?.pass;
  $('answeringTitle').textContent = (star || '') + 'さんが主役';
  $('answeringLead').textContent = passed ? '' : 'ルームに入っている人は、自分の画面で選んでね。';
  updateStarAway(room, starPick, false);
  ['starGroupPanel', 'starWordPanel', 'guessPanel', 'donePanel', 'infoPanel', 'hostAnswerTools']
    .forEach((id) => { $(id).hidden = true; });
  $('watchAnswerPanel').hidden = false;
  $('watchQuestion').textContent = (star || '') + 'さんは、どの系の気持ちになりそう？';
  $('watchQuestion').hidden = passed;
  renderWatchGroups();
  $('watchGroups').hidden = passed;
  $('watchChatNote').textContent = passed
    ? 'この場面はパスになったよ。つぎの場面を待ってね。'
    : (starPick
      ? '主役が選び終わったよ。ルームに入っていない人は、系の番号（①〜⑥）をチャットで送ってね。'
      : '主役が選んでいます。ルームに入っていない人は、主役が選び終わってから系の番号をチャットで送ってね。');
  const names = [star].concat(roundOrder(room).filter((name) => name !== star));
  renderPeople('watchProgress', names.filter(Boolean), (name) => progressLabel(room, name),
    (name) => (name === star ? ['主役'] : []));
}

function renderWatchGroups() {
  const box = $('watchGroups');
  if (box.dataset.key === 'watch') return;
  box.replaceChildren();
  GROUPS.forEach((group, index) => {
    const item = makeElement('div', 'ka-groupbtn ka-groupbtn--static ka-group--' + group.key);
    appendGroupContent(item, group, index);
    box.append(item);
  });
  box.dataset.key = 'watch';
}

// 購読とタイマーを止めて、アドレスから watch を外す（ルームには触らない）
function stopWatch() {
  clearTimeout(state.watchTimer);
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null });
  const box = $('watchGroups');
  box.replaceChildren();
  delete box.dataset.key;
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

/* ── 主役・予想する人の操作 ── */
function chooseStarGroup(index) {
  state.starGroup = index;
  state.starStep = 'word';
  state.starWord = null;
  if (!state.room) return;
  renderAnswering(state.room);
  $('starWordHead').focus();
}

function chooseGuessGroup(index) {
  state.guessGroup = index;
  if (state.room) renderAnswering(state.room);
}

// 自分の選択を、今のラウンドの枠にだけ書く。進行が変わっていたら書かない
async function writePick(makePick, failMessage) {
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
      if (room.status !== STATUS.ANSWERING) { reason = 'moved'; return; }
      if (room.round !== round) { reason = 'changed'; return; }
      const pick = makePick(room, nickname, uid);
      if (!pick) return;
      const key = 'r' + room.round;
      const members = { ...(room.members || {}) };
      if (!members[nickname] && room.players?.[nickname]) members[nickname] = memberEntry(room.players[nickname]);
      return {
        ...room,
        picks: { [key]: { ...(room.picks?.[key] || {}), [nickname]: { ...pick, uid } } },
        members,
      };
    });
    if (!result.committed && reason !== 'moved') {
      toast(reason === 'changed' ? '画面が変わったので、もう一度えらんでね' : failMessage);
    }
    return result.committed;
  } catch (error) {
    console.warn('[kimochi-ate] pick failed', error);
    toast(failMessage);
    return false;
  } finally {
    state.busy = false;
  }
}

async function submitStar(choice) {
  const ok = await writePick((room, nickname, uid) => {
    if (room.star !== nickname || room.starUid !== uid) return null;
    if (choice.pass) return { pass: true };
    if (!isGroupIndex(choice.group)) return null;
    if (choice.word == null) return { group: choice.group };
    return isWordIndex(choice.group, choice.word) ? { group: choice.group, word: choice.word } : null;
  }, 'えらべませんでした。もう一度ためしてね');
  if (ok) afterPickChange('#btnWithdraw');
}

async function submitGuess(choice) {
  const ok = await writePick((room, nickname, uid) => {
    if (room.star === nickname || !playsName(room, nickname)) return null;
    if (room.players[nickname].uid !== uid || reservedByOther(room, nickname, uid)) return null;
    if (choice.skip) return { skip: true };
    return isGroupIndex(choice.group) ? { group: choice.group } : null;
  }, '予想を出せませんでした。もう一度ためしてね');
  if (ok) afterPickChange('#btnWithdraw');
}

// 選ぶ・取り消すでパネルが切り替わったあと、フォーカスが body に飛ばないよう次の操作へ移す
function afterPickChange(...selectors) {
  resetChoice();
  if (state.room) handleRoom(state.room);
  focusVisible(...selectors);
}

// 見えている要素のうち、最初に見つかったものへフォーカスする
function focusVisible(...selectors) {
  for (const selector of selectors) {
    const node = [...document.querySelectorAll(selector)].find((item) => !item.closest('[hidden]'));
    if (node) {
      node.focus();
      return;
    }
  }
}

async function withdrawPick() {
  if (state.role !== 'host' && state.role !== 'guest') return;
  if (state.busy || !state.roomRef || !state.room) return;
  const round = state.room.round;
  const nickname = state.nickname;
  const uid = currentUid();
  state.busy = true;
  let committed = false;
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.ANSWERING || room.round !== round) return;
      const key = 'r' + room.round;
      if (room.picks?.[key]?.[nickname]?.uid !== uid) return;
      const picks = { ...room.picks[key] };
      delete picks[nickname];
      return { ...room, picks: { [key]: picks } };
    });
    committed = result.committed;
    // 公開などで画面が先に変わったときは、知らせなくても画面でわかる（判定はサーバーの最新の値で）
    const latest = result.snapshot?.val();
    if (!committed && latest?.status === STATUS.ANSWERING && latest.round === round) {
      toast('えらびなおせませんでした。画面を確かめてね');
    }
  } catch (error) {
    console.warn('[kimochi-ate] withdraw failed', error);
    toast('えらびなおせませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
  if (committed) afterPickChange('#starGroups .ka-groupbtn', '#guessGroups .ka-groupbtn');
  else if (state.room) handleRoom(state.room);
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
    console.warn('[kimochi-ate] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    state.busy = false;
  }
}

// 場面えらびに戻る（主役と選択は消す。lastStar は残して、次の主役の既定に使う）
function toCasting(room, newScene) {
  return {
    ...room,
    ...(newScene ? pickScene(room) : {}),
    status: STATUS.CASTING,
    star: null,
    starUid: null,
    picks: null,
    members: null,
  };
}

async function startGame() {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || playingNames(room).length < 2) return;
    return {
      ...room,
      ...pickScene(room),
      status: STATUS.CASTING,
      star: null,
      starUid: null,
      lastStar: null,
      picks: null,
      members: null,
    };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok === false) toast('はじめられませんでした。参加している人を確かめてね');
}

async function rerollScene() {
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.CASTING) return;
    return { ...room, ...pickScene(room) };
  }, '場面をかえられませんでした。もう一度ためしてね');
  if (ok === false) toast('場面をかえられませんでした。画面を確かめてね');
}

async function confirmStar() {
  const name = state.castPick;
  if (!name) return;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.CASTING) return;
    if (!playsName(room, name) || playingNames(room).length < 2) return;
    const player = room.players[name];
    return {
      ...room,
      status: STATUS.ANSWERING,
      round: (Number(room.round) || 0) + 1,
      star: name,
      starUid: player.uid,
      lastStar: { name, joinedAt: Number(player.joinedAt) || 0 },
      picks: null,
      members: Object.fromEntries(playingNames(room).map((member) => [member, memberEntry(room.players[member])])),
    };
  }, '始められませんでした。もう一度ためしてね');
  if (ok === false) toast('その人は今いないみたい。主役を選びなおしてね');
}

async function revealRound() {
  const round = state.room?.round;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.ANSWERING || room.round !== round) return;
    const pick = pickOf(room, room.star);
    if (!pick || pick.pass || !isGroupIndex(pick.group)) return;
    return { ...room, status: STATUS.REVEAL };
  }, '公開できませんでした。もう一度ためしてね');
  if (ok === false) toast('公開できませんでした。画面を確かめてね');
}

async function changeSceneAfterPass() {
  const round = state.room?.round;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.ANSWERING || room.round !== round) return;
    if (!pickOf(room, room.star)?.pass) return;
    return toCasting(room, true);
  }, '場面をかえられませんでした。もう一度ためしてね');
  if (ok === false) toast('場面をかえられませんでした。画面を確かめてね');
}

async function recastStar() {
  const round = state.room?.round;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.ANSWERING || room.round !== round) return;
    return toCasting(room, false);
  }, '主役を選びなおせませんでした。もう一度ためしてね');
  if (ok === false) toast('主役を選びなおせませんでした。画面を確かめてね');
}

async function nextScene() {
  const round = state.room?.round;
  const ok = await hostTransaction((room) => {
    if (room.status !== STATUS.REVEAL || room.round !== round) return;
    return toCasting(room, true);
  }, '進めませんでした。もう一度ためしてね');
  if (ok === false) toast('進めませんでした。画面を確かめてね');
}

/* ── ボタン ── */
function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) handler();
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
  const code = $('watchCode').value.trim().toUpperCase();
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

$('btnStartGame').addEventListener('click', startGame);
$('btnRerollScene').addEventListener('click', rerollScene);
$('btnConfirmStar').addEventListener('click', confirmStar);
$('btnReveal').addEventListener('click', revealRound);
$('btnChangeScene').addEventListener('click', changeSceneAfterPass);
$('btnRecast').addEventListener('click', recastStar);
$('btnNextScene').addEventListener('click', nextScene);

$('btnPass').addEventListener('click', () => submitStar({ pass: true }));
$('btnBackToGroups').addEventListener('click', () => {
  state.starStep = 'group';
  state.starWord = null;
  if (state.room) renderAnswering(state.room);
  focusVisible('#starGroups .ka-groupbtn');
});
$('btnSubmitStar').addEventListener('click', () => {
  if (isWordIndex(state.starGroup, state.starWord)) submitStar({ group: state.starGroup, word: state.starWord });
});
$('btnGroupOnly').addEventListener('click', () => {
  if (isGroupIndex(state.starGroup)) submitStar({ group: state.starGroup });
});
$('btnSubmitGuess').addEventListener('click', () => {
  if (isGroupIndex(state.guessGroup)) submitGuess({ group: state.guessGroup });
});
$('btnSkipGuess').addEventListener('click', () => submitGuess({ skip: true }));
$('btnWithdraw').addEventListener('click', withdrawPick);

showScreen('top');
const watchParam = new URLSearchParams(location.search).get('watch');
if (watchParam !== null) {
  // みんなにみせる画面の入口。このタブでホスト・参加者として戻らないよう、再接続の記録は先に消す
  clearSession();
  const watchCode = watchParam.trim().toUpperCase();
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
