// みんなでランキング：お題とルーム進行
const TOPICS = [
  // たべもの
  { title: 'コンビニおにぎりの具', items: ['ツナマヨ', 'さけ', 'うめ', 'こんぶ', '明太子', 'たまご', 'おかか'] },
  { title: 'アイスのフレーバー', items: ['バニラ', 'チョコ', 'ストロベリー', '抹茶', 'クッキー&クリーム', 'ソーダ', 'キャラメル'] },
  { title: 'おでんの具', items: ['たまご', '大根', 'もち巾着', 'ちくわ', 'こんにゃく', 'はんぺん', '牛すじ'] },
  { title: '最強の朝ごはん', items: ['たまごかけごはん', 'トースト', 'パンケーキ', 'おにぎり', 'シリアル', 'フレンチトースト', 'ヨーグルト'] },
  { title: 'パン屋さんのパン', items: ['メロンパン', 'クリームパン', 'カレーパン', 'あんパン', 'チョココロネ', '焼きそばパン', 'クロワッサン'] },
  { title: 'ラーメンの味', items: ['しょうゆ', 'みそ', 'とんこつ', 'しお', '担々麺', '鶏白湯'] },
  { title: 'おすしのネタ', items: ['サーモン', 'まぐろ', 'えび', 'いくら', 'たまご', 'はまち', 'ツナマヨ軍艦'] },
  { title: 'からあげのおとも', items: ['レモン', 'マヨネーズ', 'そのままがいい', 'しお', 'タルタルソース', 'ケチャップ'] },
  { title: 'お鍋の種類', items: ['すき焼き', 'しゃぶしゃぶ', 'キムチ鍋', '水炊き', 'もつ鍋', 'カレー鍋', 'チーズ鍋'] },
  { title: 'ジュース・ドリンク', items: ['オレンジジュース', 'りんごジュース', 'メロンソーダ', 'コーラ', 'カルピス', 'レモネード', 'ぶどうジュース'] },
  { title: 'お祭りの屋台グルメ', items: ['たこ焼き', 'かき氷', 'りんごあめ', '焼きそば', 'チョコバナナ', 'わたあめ', 'フランクフルト'] },
  { title: 'ピザのトッピング', items: ['チーズもりもり', 'てりやきチキン', 'コーン', 'ソーセージ', 'パイナップル', 'ベーコン', 'フレッシュトマト'] },
  { title: 'カレーに入れたい具', items: ['じゃがいも', 'にんじん', '玉ねぎ', 'ビーフ', 'チキン', 'チーズ', 'ゆでたまご'] },
  { title: 'ファミレスでたのみたいメニュー', items: ['ハンバーグ', 'オムライス', 'パフェ', 'ドリア', 'スパゲッティ', 'フライドポテト', 'ピザ'] },
  { title: 'おやつの定番', items: ['ポテトチップス', 'チョコレート', 'グミ', 'クッキー', 'せんべい', 'プリン', 'ドーナツ'] },
  { title: '和スイーツ', items: ['みたらしだんご', 'いちご大福', 'どらやき', 'たいやき', 'わらびもち', 'カステラ'] },
  { title: 'フルーツ', items: ['いちご', 'もも', 'ぶどう', 'りんご', 'みかん', 'スイカ', 'バナナ', 'マンゴー'] },
  { title: 'コンビニスイーツ', items: ['シュークリーム', 'プリン', 'ロールケーキ', 'チーズケーキ', 'エクレア', 'フルーツサンド', '大福'] },
  { title: '回転寿司のサイドメニュー', items: ['ラーメン', 'フライドポテト', 'プリン', 'ケーキ', '茶わんむし', 'うどん', 'からあげ'] },
  { title: 'たき火で焼いたらおいしそうなもの', items: ['マシュマロ', 'さつまいも', 'ソーセージ', 'とうもろこし', 'おもち', 'チーズ'] },
  { title: '自動販売機で売ってたらうれしいもの', items: ['ラーメン', 'ソフトクリーム', 'たこ焼き', 'ピザ', 'からあげ', 'ホットケーキ', 'おでん'] },
  { title: 'トーストにのせたいもの', items: ['バター', 'チーズ', 'はちみつ', 'ジャム', 'あんこ', 'ピザ風', 'チョコクリーム'] },

  // もしも・空想
  { title: 'ひみつ道具ほしい順', items: ['どこでもドア', 'タケコプター', 'タイムマシン', 'ほんやくコンニャク', 'スモールライト', 'もしもボックス', 'グルメテーブルかけ'] },
  { title: 'もしもの能力ほしい順', items: ['空を飛べる', 'とうめいになれる', '動物と話せる', '時間を止められる', '瞬間移動できる', '怪力になれる', '水中で息ができる'] },
  { title: 'ロボットにやってほしいこと', items: ['そうじ', '料理', '荷物もち', 'マッサージ', 'ゲームの対戦相手', 'おしゃべり相手', 'ペットの散歩'] },
  { title: '無人島に持っていくなら', items: ['ナイフ', 'ライター', 'なべ', 'つりざお', 'テント', '毛布', 'まんが全巻', 'ソーラー充電器'] },
  { title: 'タイムマシンで見に行きたい時代', items: ['恐竜時代', '原始時代', '江戸時代', '100年後の未来', '1000年後の未来', '恐竜がうまれる前の海'] },
  { title: 'じゃんけんに追加したら強そうな手', items: ['マグマ', '水', '竜巻', 'ロボット', 'ブラックホール', '忍者'] },
  { title: '飼ってみたい空想の生き物', items: ['ドラゴン', 'ユニコーン', 'フェニックス', 'ペガサス', 'マーメイド', '小さい妖精'] },
  { title: 'ポケットに入ってたらうれしいもの', items: ['あたりくじ', 'ラムネ', '四つ葉のクローバー', 'きれいな石', 'ひみつのメモ', '小さいぬいぐるみ'] },

  // ばしょ・のりもの
  { title: '行ってみたい場所', items: ['宇宙', '深海', '南極', 'ジャングル', '雲の上', '恐竜のいた島', '無人島'] },
  { title: '住んでみたい家', items: ['ツリーハウス', 'お城', '地下基地', '船の家', '山小屋', 'タワーの最上階', '洞窟ハウス'] },
  { title: '行ってみたい世界の場所', items: ['サバンナ', 'ピラミッド', 'さばくのオアシス', 'オーロラの北極圏', 'アマゾン', 'サンゴ礁の海', 'サンタクロースの村'] },
  { title: 'のってみたい乗り物', items: ['気球', '潜水艦', '寝台列車', 'ヘリコプター', '豪華客船', '犬ぞり', 'ロケット'] },
  { title: '遊園地のアトラクション', items: ['ジェットコースター', '観覧車', 'メリーゴーラウンド', 'コーヒーカップ', 'ゴーカート', '巨大迷路', '急流すべり'] },

  // いきもの
  { title: 'ペットにしてみたい生き物', items: ['柴犬', 'ねこ', 'ハムスター', 'インコ', 'カメ', 'ウーパールーパー', 'ハリネズミ', 'カピバラ'] },
  { title: '動物園の人気者（どうぶつ）', items: ['パンダ', 'ライオン', 'ゾウ', 'キリン', 'ペンギン', 'コアラ', 'レッサーパンダ'] },
  { title: '水族館の生き物', items: ['イルカ', 'ペンギン', 'ラッコ', 'クラゲ', 'チンアナゴ', 'ジンベエザメ', 'カワウソ'] },
  { title: '恐竜', items: ['ティラノサウルス', 'トリケラトプス', 'ブラキオサウルス', 'プテラノドン', 'ステゴサウルス', 'モササウルス'] },
  { title: 'もふもふしたい動物', items: ['アルパカ', '子犬', '長毛ねこ', 'うさぎ', 'ハムスター', 'レッサーパンダ'] },

  // きせつ・くらし
  { title: '冬のたのしみ', items: ['こたつ', '雪あそび', 'あったかい鍋', 'イルミネーション', '温泉', 'ホットココア', 'そり・スキー'] },
  { title: '夏のたのしみ', items: ['プール', 'かき氷', '花火', 'スイカ', '虫とり', '海', 'アイス食べ放題'] },
  { title: '雨の日のすごし方', items: ['ゲーム', '映画・アニメ', 'お菓子づくり', 'ごろごろ昼寝', 'まんが', '工作', '音楽'] },
  { title: 'ねむりの最強アイテム', items: ['ふかふかの枕', 'ぬいぐるみ', 'もふもふ毛布', '抱き枕', 'ハンモック', 'こたつ'] },
  { title: '雲の形で見つけたらうれしいもの', items: ['ドラゴン', 'ソフトクリーム', 'ねこ', 'ハート', 'くじら', '恐竜'] },
];

const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'minnaranking_rooms';
const SESSION_KEY = 'minnaranking_session';
const DRAFT_KEY = 'minnaranking_draft';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const GUIDE_MS = 3 * 60 * 1000;
const MAX_GUESTS = 4;
const STATUS = {
  WAITING: 'waiting',
  RANKING: 'ranking',
  GUESS: 'guess',
  REVEAL: 'reveal',
  DONE: 'done',
};
const state = {
  role: null,
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  currentScreen: null,
  timerInterval: null,
  orphanTimer: null,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  selectedTopic: TOPICS[0],
  lastTopicIndex: -1,
  draftRound: null,
  items: [],
  out: [],
  busy: false,
};
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.mr-screen').forEach((node) => node.classList.remove('active'));
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

function guestNames(room) {
  return Object.entries(room.players || {})
    .filter(([, player]) => !player.isHost)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

function isExpired(room) {
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}

async function removeExpired(ref, fallback) {
  try {
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    });
  } catch (error) {
    console.warn('[minna-ranking] expired room cleanup failed', error);
  }
}

async function waitAuth() {
  try {
    await authReady;
    return true;
  } catch {
    toast('接続できませんでした。ページを読み直してね');
    return false;
  }
}

function saveSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    role: state.role,
    nickname: state.nickname,
    roomCode: state.roomCode,
    uid: firebase.auth().currentUser?.uid,
  }));
}

function loadSession() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); }
  catch { return null; }
}

function saveDraft() {
  if (state.role !== 'guest' || !state.roomCode || state.draftRound == null) return;
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({
    roomCode: state.roomCode,
    round: state.draftRound,
    items: state.items,
    out: state.out,
  }));
}

function initDraft(room) {
  if (state.draftRound === room.round) return;
  let saved = null;
  try { saved = JSON.parse(sessionStorage.getItem(DRAFT_KEY)); } catch { /* new draft */ }
  const base = Array.isArray(room.topic?.items) ? room.topic.items : [];
  const isValid = saved && saved.roomCode === state.roomCode && saved.round === room.round
    && Array.isArray(saved.items) && Array.isArray(saved.out)
    && saved.items.concat(saved.out).length === base.length
    && new Set(saved.items.map((item) => item.text).concat(saved.out)).size === base.length
    && saved.items.every((item) => base.includes(item.text))
    && saved.out.every((text) => base.includes(text));
  state.items = isValid ? saved.items.map((item) => ({ text: item.text, tied: !!item.tied })) : base.map((text) => ({ text, tied: false }));
  state.out = isValid ? saved.out.slice() : [];
  state.draftRound = room.round;
  saveDraft();
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  state.timerInterval = null;
  state.orphanTimer = null;
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  state.role = null;
  state.nickname = null;
  state.roomCode = null;
  state.roomRef = null;
  state.room = null;
  state.draftRound = null;
  state.items = [];
  state.out = [];
  state.connectedRef = null;
  state.connectedCallback = null;
  state.roomCallback = null;
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(DRAFT_KEY);
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
}

function connectToRoom(role, nickname, code, ref) {
  state.role = role;
  state.nickname = nickname;
  state.roomCode = code;
  state.roomRef = ref;
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  saveSession();

  state.roomCallback = (snap) => {
    if (!snap.exists()) {
      cleanupRoom();
      showScreen('top');
      toast('ルームが閉じられたよ', false);
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      removeExpired(ref, room);
      cleanupRoom();
      showScreen('top');
      toast('このルームは終わったみたい');
      return;
    }
    state.room = room;
    handleRoom(room);
  };
  ref.on('value', state.roomCallback, () => toast('ルームの読み込みに失敗しました'));

  state.connectedRef = db.ref('.info/connected');
  state.connectedCallback = async (snap) => {
    if (!snap.val() || state.roomRef !== ref) return;
    try {
      if (role === 'host') {
        await ref.onDisconnect().update({
          hostConnected: false,
          hostDisconnectedAt: firebase.database.ServerValue.TIMESTAMP,
        });
        await ref.transaction((room) => {
          if (!room || room.hostUid !== firebase.auth().currentUser?.uid) return;
          return { ...room, hostConnected: true, hostDisconnectedAt: null };
        });
      } else {
        const playerRef = ref.child('players/' + nickname);
        await playerRef.onDisconnect().remove();
        await ref.transaction((room) => {
          if (!room || isExpired(room)) return;
          const current = room.players?.[nickname];
          const uid = firebase.auth().currentUser?.uid;
          if (current && current.uid !== uid) return;
          if (current) return;
          return {
            ...room,
            players: {
              ...(room.players || {}),
              [nickname]: { isHost: false, uid, joinedAt: RoomkRTDB.now() },
            },
          };
        });
      }
    } catch (error) {
      console.warn('[minna-ranking] presence recovery failed', error);
      toast('再接続に失敗しました。ページを読み直してね');
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
  state.timerInterval = setInterval(updateGuideTime, 1000);
}

function handleRoom(room) {
  if (state.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    if (!state.orphanTimer) {
      const at = RoomkRTDB.getHostDisconnectedAt(room);
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
      state.orphanTimer = setTimeout(() => {
        state.orphanTimer = null;
        if (state.roomRef && state.room) removeExpired(state.roomRef, state.room);
      }, delay);
    }
  } else {
    $('hostOffOverlay').hidden = true;
    clearTimeout(state.orphanTimer);
    state.orphanTimer = null;
  }
  switch (room.status) {
    case STATUS.WAITING: renderWaiting(room); break;
    case STATUS.RANKING: renderRanking(room); break;
    case STATUS.GUESS: renderGuess(room); break;
    case STATUS.REVEAL: renderReveal(room); break;
    case STATUS.DONE: renderDone(room); break;
    default: showScreen('waiting');
  }
}

async function createRoom() {
  if (state.busy) return;
  const nickname = $('hostName').value.trim();
  const error = validNickname(nickname);
  if (error) { setError('createError', error); return; }
  setError('createError', '');
  if (!await waitAuth()) return;
  state.busy = true;
  $('btnCreateRoom').disabled = true;
  try {
    const uid = firebase.auth().currentUser.uid;
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
          hostConnected: true,
          hostDisconnectedAt: null,
          round: 0,
          players: {
            [nickname]: { isHost: true, uid, joinedAt },
          },
        };
      });
      if (result.committed) {
        connectToRoom('host', nickname, code, ref);
        return;
      }
    }
    setError('createError', 'ルームをつくれませんでした。もう一度ためしてね');
  } catch (error) {
    console.warn('[minna-ranking] create failed', error);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

async function joinRoom() {
  if (state.busy) return;
  const nickname = $('guestName').value.trim();
  const code = $('joinCode').value.trim().toUpperCase();
  const error = validNickname(nickname);
  if (error) { setError('joinError', error); return; }
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
    setError('joinError', 'ルームコードは6文字で入れてね');
    return;
  }
  setError('joinError', '');
  if (!await waitAuth()) return;
  state.busy = true;
  $('btnJoinRoom').disabled = true;
  try {
    const ref = db.ref(DB_PREFIX + '/' + code);
    const snap = await ref.get();
    if (!snap.exists()) { setError('joinError', 'ルームが見つからないよ。コードを確かめてね'); return; }
    const initial = snap.val();
    if (isExpired(initial)) {
      await removeExpired(ref, initial);
      setError('joinError', 'このルームは終わったみたい');
      return;
    }
    const uid = firebase.auth().currentUser.uid;
    const joinedAt = RoomkRTDB.now();
    let reason = '';
    const result = await ref.transaction((room) => {
      const current = room || initial;
      reason = '';
      if (!current) { reason = '見つからない'; return; }
      if (isExpired(current)) { reason = '終了'; return; }
      if (current.status !== STATUS.WAITING) { reason = '開始済み'; return; }
      if (current.players?.[nickname]) { reason = '名前'; return; }
      if (guestNames(current).length >= MAX_GUESTS) { reason = '満員'; return; }
      return {
        ...current,
        players: {
          ...(current.players || {}),
          [nickname]: { isHost: false, uid, joinedAt },
        },
      };
    });
    if (!result.committed) {
      const messages = {
        '見つからない': 'ルームが見つからないよ。コードを確かめてね',
        '終了': 'このルームは終わったみたい',
        '開始済み': '今は参加できないよ。次のお題まで待ってね',
        '名前': 'その名前は使われているよ。少し変えてみてね',
        '満員': 'このルームはいっぱいだよ',
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, ref);
  } catch (error) {
    console.warn('[minna-ranking] join failed', error);
    setError('joinError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnJoinRoom').disabled = false;
  }
}

async function tryReconnect() {
  const saved = loadSession();
  if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
  if (!await waitAuth()) return false;
  const uid = firebase.auth().currentUser?.uid;
  if (!uid || uid !== saved.uid) return false;
  const ref = db.ref(DB_PREFIX + '/' + saved.roomCode);
  try {
    const snap = await ref.get();
    if (!snap.exists()) return false;
    const room = snap.val();
    if (isExpired(room)) {
      await removeExpired(ref, room);
      return false;
    }
    if (saved.role === 'host') {
      if (room.host !== saved.nickname || room.hostUid !== uid) return false;
    } else if (saved.role === 'guest') {
      const player = room.players?.[saved.nickname];
      if (player && (player.isHost || player.uid !== uid)) return false;
    } else {
      return false;
    }
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref);
    return true;
  } catch (error) {
    console.warn('[minna-ranking] reconnect failed', error);
    return false;
  }
}

function removeGuest(room, nickname) {
  const next = { ...room, players: { ...(room.players || {}) } };
  delete next.players[nickname];
  next.submissions = { ...(room.submissions || {}) };
  delete next.submissions[nickname];
  next.guesses = { ...(room.guesses || {}) };
  Object.keys(next.guesses).forEach((target) => {
    if (target === nickname) {
      delete next.guesses[target];
    } else {
      next.guesses[target] = { ...next.guesses[target] };
      delete next.guesses[target][nickname];
    }
  });
  next.scores = { ...(room.scores || {}) };
  delete next.scores[nickname];
  if (Array.isArray(room.targets)) {
    next.targets = room.targets.filter((name) => name !== nickname);
    const oldIndex = Number(room.targetIndex) || 0;
    const removedIndex = room.targets.indexOf(nickname);
    next.targetIndex = removedIndex >= 0 && removedIndex < oldIndex ? oldIndex - 1 : oldIndex;
    if (removedIndex === oldIndex && (room.status === STATUS.GUESS || room.status === STATUS.REVEAL)) {
      next.status = next.targets.length > next.targetIndex ? STATUS.GUESS : STATUS.DONE;
    }
  }
  return next;
}

async function leaveRoom() {
  if (state.busy || !state.roomRef) return;
  state.busy = true;
  const ref = state.roomRef;
  const role = state.role;
  const nickname = state.nickname;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      await ref.transaction((room) => room ? removeGuest(room, nickname) : undefined);
    }
  } catch (error) {
    console.warn('[minna-ranking] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.busy = false;
    return;
  }
  cleanupRoom();
  showScreen('top');
  state.busy = false;
}

function circledNum(n) {
  if (n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
  if (n <= 35) return String.fromCharCode(0x3251 + n - 21);
  if (n <= 50) return String.fromCharCode(0x32b1 + n - 36);
  return String(n);
}

function makeElement(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value != null) node.textContent = String(value);
  return node;
}

function renderNames(listId, names, labelFor) {
  const list = $(listId);
  list.replaceChildren();
  names.forEach((name) => {
    const row = makeElement('li', 'mr-people__item');
    row.append(makeElement('span', '', name), makeElement('span', 'mr-people__status', labelFor(name)));
    list.append(row);
  });
}

function selectTopic(topic) {
  state.selectedTopic = { title: topic.title, items: topic.items.slice() };
  $('selectedTopic').textContent = topic.title;
  $('selectedItems').textContent = topic.items.join('、');
  $('topicListPanel').hidden = true;
  $('customTopicPanel').hidden = true;
}

function renderTopicList() {
  const list = $('topicList');
  list.replaceChildren();
  TOPICS.forEach((topic, index) => {
    const button = makeElement('button', 'mr-topic');
    button.type = 'button';
    button.setAttribute('aria-label', String(index + 1) + '番のお題: ' + topic.title);
    button.append(
      makeElement('span', 'mr-topic__num', circledNum(index + 1)),
      makeElement('span', 'mr-topic__text', topic.title),
    );
    button.addEventListener('click', () => {
      state.lastTopicIndex = index;
      selectTopic(topic);
    });
    list.append(button);
  });
}

function renderCustomInputs() {
  const box = $('createItems');
  box.replaceChildren();
  for (let i = 0; i < 8; i++) {
    const input = makeElement('input', 'mr-form__input mr-form__input--item');
    input.type = 'text';
    input.maxLength = 15;
    input.placeholder = 'アイテム' + (i + 1);
    box.append(input);
  }
}

function useCustomTopic() {
  const title = $('createTopic').value.trim();
  const items = [...document.querySelectorAll('.mr-form__input--item')]
    .map((node) => node.value.trim()).filter(Boolean);
  if (!title || title.length > 30) { toast('お題を30文字以内で入れてね'); return; }
  if (items.length < 2 || items.length > 8) { toast('アイテムを2〜8個入れてね'); return; }
  if (items.some((item) => item.length > 15) || new Set(items).size !== items.length) {
    toast('アイテムは15文字以内で、違うものを入れてね');
    return;
  }
  selectTopic({ title, items });
}

function renderWaiting(room) {
  showScreen('waiting');
  const host = state.role === 'host';
  $('hostTopicTools').hidden = !host;
  $('waitingLead').textContent = host
    ? 'お題を選んで、参加者がそろったら始めてね。'
    : 'ホストがお題を選んでいます。始まるまで待ってね。';
  const names = guestNames(room);
  renderNames('waitingPlayers', names, () => '参加中');
  if (host) {
    if (!state.selectedTopic) selectTopic(TOPICS[0]);
    $('selectedTopic').textContent = state.selectedTopic.title;
    $('selectedItems').textContent = state.selectedTopic.items.join('、');
    $('btnStartRound').disabled = names.length < 2;
  }
}

async function startRound() {
  if (state.role !== 'host' || state.busy || !state.roomRef) return;
  const topic = state.selectedTopic;
  if (!topic || !topic.title || topic.items.length < 2) return;
  state.busy = true;
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.WAITING || room.hostUid !== firebase.auth().currentUser?.uid) return;
      if (guestNames(room).length < 2) return;
      return {
        ...room,
        status: STATUS.RANKING,
        round: (Number(room.round) || 0) + 1,
        roundOrder: guestNames(room),
        topic: { title: topic.title, items: topic.items.slice() },
        phaseStartedAt: firebase.database.ServerValue.TIMESTAMP,
        submissions: null,
        targets: null,
        targetIndex: 0,
        guesses: null,
        scores: null,
      };
    });
    if (!result.committed) toast('始められませんでした。参加者を確かめてね');
  } catch (error) {
    console.warn('[minna-ranking] start failed', error);
    toast('始められませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

function updateGuideTime() {
  if (state.currentScreen !== 'ranking' || !state.room) return;
  const started = Number(state.room.phaseStartedAt);
  if (!Number.isFinite(started)) return;
  const left = GUIDE_MS - Math.max(0, RoomkRTDB.now() - started);
  $('rankTime').textContent = left > 0
    ? '目安まで ' + Math.ceil(left / 60_000) + '分'
    : '目安の3分を過ぎました。ホストが好きなときに進められます。';
}

function computeRanks(items) {
  const ranks = [];
  items.forEach((item, index) => {
    ranks.push(index > 0 && item.tied ? ranks[index - 1] : index + 1);
  });
  return ranks;
}

function moveItem(from, to) {
  if (to < 0 || to >= state.items.length || from === to) return;
  const [item] = state.items.splice(from, 1);
  item.tied = false;
  state.items.splice(to, 0, item);
  saveDraft();
  renderRankEditor();
}

function rankAction(action, index) {
  if (action === 'up' || action === 'down') {
    moveItem(index, index + (action === 'up' ? -1 : 1));
  } else if (action === 'tie' && index > 0) {
    state.items[index].tied = !state.items[index].tied;
    saveDraft();
    renderRankEditor();
  } else if (action === 'out' && state.items.length > 1) {
    const [item] = state.items.splice(index, 1);
    state.out.push(item.text);
    saveDraft();
    renderRankEditor();
  }
}

function rankButton(label, action, index, disabled, className) {
  const button = makeElement('button', className, label);
  button.type = 'button';
  button.disabled = !!disabled;
  button.setAttribute('aria-label', state.items[index].text + 'を' + label);
  button.addEventListener('click', () => rankAction(action, index));
  return button;
}

function renderRankEditor() {
  if (state.items.length && state.items[0].tied) state.items[0].tied = false;
  const ranks = computeRanks(state.items);
  const list = $('rankList');
  list.replaceChildren();
  state.items.forEach((item, index) => {
    const row = makeElement('li', 'mr-item' + (item.tied ? ' mr-item--tied' : ''));
    row.draggable = true;
    row.append(
      makeElement('span', 'mr-item__rank', ranks[index] + '位'),
      makeElement('span', 'mr-item__text', item.text),
    );
    const controls = makeElement('span', 'mr-item__ctrl');
    controls.append(
      rankButton('上へ', 'up', index, index === 0, 'mr-item__move'),
      rankButton('下へ', 'down', index, index === state.items.length - 1, 'mr-item__move'),
      rankButton(item.tied ? 'タイをやめる' : '上とタイ', 'tie', index, index === 0, 'mr-item__mini'),
      rankButton('ランク外へ', 'out', index, state.items.length === 1, 'mr-item__mini'),
    );
    row.append(controls);
    row.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData('text/plain', String(index));
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('mr-item--dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('mr-item--dragging'));
    row.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('mr-item--over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('mr-item--over'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      const from = Number(event.dataTransfer.getData('text/plain'));
      if (Number.isInteger(from)) moveItem(from, index);
    });
    list.append(row);
  });
  const outList = $('outList');
  outList.replaceChildren();
  state.out.forEach((text, index) => {
    const row = makeElement('li', 'mr-out__item');
    row.append(makeElement('span', 'mr-out__text', text));
    const button = makeElement('button', 'mr-item__mini', '戻す');
    button.type = 'button';
    button.setAttribute('aria-label', text + 'をランキングに戻す');
    button.addEventListener('click', () => {
      state.items.push({ text: state.out.splice(index, 1)[0], tied: false });
      saveDraft();
      renderRankEditor();
    });
    row.append(button);
    outList.append(row);
  });
  $('outEmpty').hidden = state.out.length > 0;
}

function renderRanking(room) {
  showScreen('ranking');
  $('rankTopic').textContent = room.topic?.title || '';
  updateGuideTime();
  const host = state.role === 'host';
  $('hostRankTools').hidden = !host;
  $('guestRankEditor').hidden = host || !!room.submissions?.[state.nickname];
  $('guestRankSubmitted').hidden = host || !room.submissions?.[state.nickname];
  if (host) {
    renderNames('rankProgress', guestNames(room), (name) => room.submissions?.[name] ? '提出済み' : '作成中');
    $('btnGoGuess').textContent = Object.keys(room.submissions || {}).length
      ? '提出済みの人で予想へ進む'
      : 'このお題をスキップ';
  } else if (!room.submissions?.[state.nickname]) {
    initDraft(room);
    renderRankEditor();
  }
}

function isValidSubmission(room, items, out) {
  const base = room.topic?.items || [];
  return Array.isArray(items) && Array.isArray(out) && items.length >= 1
    && items.concat(out).length === base.length
    && new Set(items.map((item) => item.text).concat(out)).size === base.length
    && items.every((item) => base.includes(item.text) && typeof item.tied === 'boolean')
    && out.every((text) => base.includes(text));
}

async function submitRank() {
  if (state.role !== 'guest' || state.busy || !state.roomRef) return;
  const round = state.room?.round;
  const items = state.items.map((item) => ({ text: item.text, tied: !!item.tied }));
  const out = state.out.slice();
  state.busy = true;
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.RANKING || room.round !== round) return;
      if (!room.players?.[state.nickname] || room.submissions?.[state.nickname]) return;
      if (!isValidSubmission(room, items, out)) return;
      return {
        ...room,
        submissions: {
          ...(room.submissions || {}),
          [state.nickname]: { items, out },
        },
      };
    });
    if (!result.committed) toast('提出できませんでした。画面を確かめてね');
  } catch (error) {
    console.warn('[minna-ranking] submission failed', error);
    toast('提出できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

async function goGuess() {
  if (state.role !== 'host' || state.busy || !state.roomRef) return;
  state.busy = true;
  try {
    await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.RANKING || room.hostUid !== firebase.auth().currentUser?.uid) return;
      const order = room.roundOrder || guestNames(room);
      const targets = order.filter((name) => room.submissions?.[name]);
      return {
        ...room,
        targets,
        targetIndex: 0,
        scores: Object.fromEntries(order.map((name) => [name, 0])),
        status: targets.length ? STATUS.GUESS : STATUS.DONE,
        phaseStartedAt: firebase.database.ServerValue.TIMESTAMP,
      };
    });
  } catch (error) {
    console.warn('[minna-ranking] advance failed', error);
    toast('進めませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

function currentTarget(room) {
  return room.targets?.[Number(room.targetIndex) || 0] || null;
}

function renderGuess(room) {
  showScreen('guess');
  const target = currentTarget(room);
  $('guessTopic').textContent = 'お題：' + (room.topic?.title || '');
  $('guessLead').textContent = target
    ? target + 'さんの1位はどれだと思う？'
    : 'ホストが進めるのを待ってね。';
  const host = state.role === 'host';
  const isTarget = state.nickname === target;
  const guessed = room.guesses?.[target]?.[state.nickname];
  $('hostGuessTools').hidden = !host;
  $('guestGuessTools').hidden = host || isTarget || !!guessed || !target;
  $('guestGuessWait').hidden = host || (!isTarget && !guessed);
  if (!host) {
    $('guestGuessWait').textContent = isTarget
      ? 'みんながあなたの1位を予想しています。公開まで待ってね。'
      : '予想を出しました。結果の公開を待ってね。';
    if (!isTarget && !guessed && target) {
      const list = $('guessChoices');
      list.replaceChildren();
      (room.topic?.items || []).forEach((item, index) => {
        const button = makeElement('button', 'mr-choice');
        button.type = 'button';
        button.setAttribute('aria-label', String(index + 1) + '番: ' + item);
        button.append(makeElement('span', 'mr-choice__num', circledNum(index + 1)), makeElement('span', 'mr-choice__text', item));
        button.addEventListener('click', () => submitGuess(target, item));
        list.append(button);
      });
      $('guessNote').textContent = '予想は1つ選べるよ。';
    }
  } else {
    renderNames('guessProgress', guestNames(room).filter((name) => name !== target),
      (name) => room.guesses?.[target]?.[name] ? '予想済み' : '予想中');
  }
}

async function submitGuess(target, item) {
  if (state.role !== 'guest' || state.busy || !state.roomRef) return;
  state.busy = true;
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.GUESS || currentTarget(room) !== target) return;
      if (!room.players?.[state.nickname] || state.nickname === target) return;
      if (!room.topic?.items?.includes(item) || room.guesses?.[target]?.[state.nickname]) return;
      return {
        ...room,
        guesses: {
          ...(room.guesses || {}),
          [target]: {
            ...(room.guesses?.[target] || {}),
            [state.nickname]: item,
          },
        },
      };
    });
    if (!result.committed) toast('予想を出せませんでした。画面を確かめてね');
  } catch (error) {
    console.warn('[minna-ranking] guess failed', error);
    toast('予想を出せませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

function firstChoices(submission) {
  if (!submission?.items?.length) return [];
  const first = [submission.items[0].text];
  for (let i = 1; i < submission.items.length && submission.items[i].tied; i++) {
    first.push(submission.items[i].text);
  }
  return first;
}

async function reveal() {
  if (state.role !== 'host' || state.busy || !state.roomRef) return;
  state.busy = true;
  try {
    await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.GUESS || room.hostUid !== firebase.auth().currentUser?.uid) return;
      const target = currentTarget(room);
      if (!target || !room.submissions?.[target]) return;
      const firsts = firstChoices(room.submissions[target]);
      const scores = { ...(room.scores || {}) };
      Object.entries(room.guesses?.[target] || {}).forEach(([name, choice]) => {
        if (firsts.includes(choice)) scores[name] = (Number(scores[name]) || 0) + 1;
      });
      return { ...room, status: STATUS.REVEAL, scores };
    });
  } catch (error) {
    console.warn('[minna-ranking] reveal failed', error);
    toast('公開できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

function renderReveal(room) {
  showScreen('reveal');
  const target = currentTarget(room);
  const submission = room.submissions?.[target];
  $('revealTitle').textContent = target ? target + 'さんのランキング' : 'ランキング';
  $('revealTopic').textContent = 'お題：' + (room.topic?.title || '');
  const list = $('revealRanking');
  list.replaceChildren();
  if (submission?.items) {
    const ranks = computeRanks(submission.items);
    submission.items.forEach((item, index) => {
      const row = makeElement('li', 'mr-result-list__item');
      row.append(makeElement('strong', 'mr-result-list__rank', ranks[index] + '位'), makeElement('span', '', item.text));
      list.append(row);
    });
  }
  $('revealOut').textContent = submission?.out?.length ? 'ランク外：' + submission.out.join('、') : '';
  const firsts = firstChoices(submission);
  const names = (room.roundOrder || guestNames(room)).filter((name) =>
    name !== target && (room.players?.[name] || room.guesses?.[target]?.[name] || room.scores?.[name] != null));
  renderNames('revealGuesses', names, (name) => {
    const choice = room.guesses?.[target]?.[name];
    if (!choice) return 'パス';
    return choice + (firsts.includes(choice) ? '　当たり！ +1' : '　おしい！');
  });
  $('hostRevealTools').hidden = state.role !== 'host';
  $('btnNextReveal').textContent = (Number(room.targetIndex) || 0) + 1 < (room.targets?.length || 0)
    ? '次の人へ'
    : 'このお題の結果へ';
}

async function nextReveal() {
  if (state.role !== 'host' || state.busy || !state.roomRef) return;
  state.busy = true;
  try {
    await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.REVEAL || room.hostUid !== firebase.auth().currentUser?.uid) return;
      const nextIndex = (Number(room.targetIndex) || 0) + 1;
      if (nextIndex >= (room.targets?.length || 0)) return { ...room, status: STATUS.DONE };
      return {
        ...room,
        status: STATUS.GUESS,
        targetIndex: nextIndex,
        phaseStartedAt: firebase.database.ServerValue.TIMESTAMP,
      };
    });
  } catch (error) {
    console.warn('[minna-ranking] next reveal failed', error);
    toast('進めませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

function renderDone(room) {
  showScreen('done');
  const names = (room.roundOrder || guestNames(room)).filter((name) =>
    room.players?.[name] || room.submissions?.[name] || room.scores?.[name] != null);
  if (!room.targets?.length) {
    $('scoreList').replaceChildren(makeElement('li', 'mr-people__item', '提出済みのランキングはありませんでした。'));
  } else {
    renderNames('scoreList', names, (name) => String(Number(room.scores?.[name]) || 0) + 'ポイント');
  }
  $('btnNextTopic').hidden = state.role !== 'host';
}

async function nextTopic() {
  if (state.role !== 'host' || state.busy || !state.roomRef) return;
  state.busy = true;
  try {
    await state.roomRef.transaction((room) => {
      if (!room || room.status !== STATUS.DONE || room.hostUid !== firebase.auth().currentUser?.uid) return;
      return {
        ...room,
        status: STATUS.WAITING,
        roundOrder: null,
        topic: null,
        phaseStartedAt: null,
        submissions: null,
        targets: null,
        targetIndex: 0,
        guesses: null,
        scores: null,
      };
    });
  } catch (error) {
    console.warn('[minna-ranking] next topic failed', error);
    toast('進めませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
  }
}

$('btnGoCreate').addEventListener('click', () => showScreen('create'));
$('btnGoJoin').addEventListener('click', () => showScreen('join'));
$('btnCreateBack').addEventListener('click', () => showScreen('top'));
$('btnJoinBack').addEventListener('click', () => showScreen('top'));
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);
$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
$('btnGacha').addEventListener('click', () => {
  let index = Math.floor(Math.random() * TOPICS.length);
  if (TOPICS.length > 1 && index === state.lastTopicIndex) index = (index + 1) % TOPICS.length;
  state.lastTopicIndex = index;
  selectTopic(TOPICS[index]);
});
$('btnTopicList').addEventListener('click', () => {
  $('topicListPanel').hidden = !$('topicListPanel').hidden;
  $('customTopicPanel').hidden = true;
});
$('btnCustomTopic').addEventListener('click', () => {
  $('customTopicPanel').hidden = !$('customTopicPanel').hidden;
  $('topicListPanel').hidden = true;
});
$('btnUseCustomTopic').addEventListener('click', useCustomTopic);
$('btnStartRound').addEventListener('click', startRound);
$('btnSubmitRank').addEventListener('click', submitRank);
$('btnGoGuess').addEventListener('click', goGuess);
$('btnReveal').addEventListener('click', reveal);
$('btnNextReveal').addEventListener('click', nextReveal);
$('btnNextTopic').addEventListener('click', nextTopic);

renderTopicList();
renderCustomInputs();
selectTopic(TOPICS[0]);
tryReconnect().then((reconnected) => {
  if (!reconnected) {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    showScreen('top');
  }
});
