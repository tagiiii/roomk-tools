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
const POS_KEY = 'nemurase_pos';          // 読み込み直したときに元の場所へ戻るための、自分の位置（同じ回・同じ spawnSeq のときだけ使う）
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
const FIX_TASK = -2;            // state.taskSpot: 停電をなおすミニゲームをひらいている（仕事の場所の番号とかぶらない）
const AIR_TASK_A = -3;          // state.taskSpot: 空気のパネル a・b をなおすミニゲームをひらいている
const AIR_TASK_B = -4;
const BOT_FIX_MS = 5500;        // ロボットが停電・空気をなおすのにかける時間（人のミニゲームと同じくらい）
const BOT_PAIR_HOLD_MS = 12000; // ロボットがふたりの仕事を手伝うとき、スイッチをおしつづける時間
const PAIR_LINGER_MS = 1500;    // ふたりの仕事がそろったあと、はなすまで（相手の画面がそろったのを見られるように）
const LATE_MS = 3000;           // ホストの端末が遅れているとき、ほかの端末が進行を代わるまでの待ち
const LEFT_GRACE_MS = 60000;    // ゲーム中に在室が消えてから、抜けたとみなすまでの時間（読み込み直し・アプリの切り替え・短い切断は抜けたことにしない）
const OFFLINE_SHOW_MS = 2000;   // 通信が切れてから、本人の画面に「切れています」を出すまで（一瞬の切れでちらつかないように）
const SKIP = '*skip';           // 投票のスキップ（名前に * は使えないので、だれの名前ともかぶらない）
const BOT_PREFIX = '*';         // ロボットの id（*1〜*9）
const BOT_NAME = /^ロボ[1-9]$/;
const TOAST_MS = 2200;

const SETTING_LABELS = {
  hostPlays: ['ホスト（あなた）', (v) => (v ? 'いっしょに遊ぶ' : '進行だけ')],
  map: ['マップ', (v) => E.MAP_NAMES[E.MAP_KEYS[v]] || E.MAP_NAMES.kichi],   // 2026-10-29 パークを足した
  sleepers: ['ねむらせ屋の数', (v) => (v === 2 ? '2人（7人以上のとき）' : '1人')],
  pick: ['ねむらせ屋の決め方', (v) => (v === 1 ? 'ホストが選ぶ' : 'ランダム')],
  tasks: ['ひとりの仕事の数', (v) => v + 'つ'],
  pair: ['ふたりの仕事', (v) => (v ? 'あり（隊員はひとり1つ）' : 'なし')],
  cooldown: ['ねむらせてから次まで', (v) => v + '秒'],
  meeting: ['会議の時間', (v) => v + '秒'],
  buttons: ['会議ボタン（ひとり）', (v) => v + '回'],
  gauge: ['みんなの仕事のバー', (v) => (v === 2 ? '出す' : v === 1 ? '進行役の画面だけ' : '出さない')],
  // 役職（2026-10-29）。入れると、人のうち1人がなる（ロボットはならない）
  engineer: ['整備係（隊員・近道を使える）', (v) => (v ? '入れる' : '入れない')],
  watcher: ['見守り係（隊員・ねむりチェッカー）', (v) => (v ? '入れる' : '入れない')],
  angel: ['まもり星（隊員・バリアをはる）', (v) => (v ? '入れる' : '入れない')],
  shifter: ['へんしん屋（ねむらせ屋）', (v) => (v ? '入れる' : '入れない')],
};

const state = {
  role: null,          // 'host' | 'guest'
  picks: [],           // ホストが待合室で選んだねむらせ屋（id）。ホストの端末だけが持ち、はじめると空にする
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
  placedKey: '',       // 自分を置いた回と spawnSeq（抜けた人から戻ったときに置きなおすため spawnKey と分ける）
  savedPos: null,      // 読み込み直しで端末から読んだ位置（置くまで持っておく）
  wasWatching: false,  // この回で見学だった（抜けた人の印が外れたら「もどってきたね」）
  backNote: false,     // 「もどってきたね」をまだ出していない（会議・結果の間に戻ったら、遊ぶ時間になってから出す）
  wasAsleep: false,
  offlineTimer: null,
  wakeLock: null,
  wakeWant: false,     // 画面を消さないでほしい（遊んでいる間）。裏から戻ったときに取りなおす
  wakePending: false,  // 画面を消さない約束を取りに行っている途中（重ねて取らない）
  wakeRetry: false,    // 取りに行っている途中に、また要ると言われた（終わってから取りなおす）
  taskSpot: -1,
  votePick: null,
  // ひとこと（ボタンで知らせる）。端末の中だけの状態
  sayHeard: {},        // {id: 受け取った最後の番号 n}
  sayLog: [],          // 受け取った順 [{id, text, m}]（m は会議の番号。遊んでいる間は 0）
  sayAt: 0,            // 自分が最後に送った時刻（5秒に1回まで）
  sayPending: null,    // 名前の入る言葉を押して、「だれ？」で人を選んでいる途中の言葉（会議中・遊んでいる間）
  sayOpen: false,      // 遊んでいる間の「ひとこと」の一覧をひらいている
  camOpen: false,      // 監視カメラを見ている（game/cam/{自分} に true を書く。とじたら消す）
  sabOpen: false,      // ねむらせ屋の「しかけ」（停電・空気・ドア）の一覧をひらいている
  sabDoor: false,      // 「ドアをしめる」を押して、部屋を選んでいる途中
  mapOpen: false,      // 地図（自分の位置だけ）をひらいている
  pairHold: null,      // ふたりの仕事のスイッチをおしている {pid, end, beatAt}（はなれるとやめる）
  // 役職（2026-10-29）
  engVentAt: 0,        // 整備係が最後に近道を使った時刻（端末の時計。ENGINEER_GAP_S 秒は使えない）
  battery: E.WATCH_BATTERY_S,   // 見守り係のチェッカーの電池（秒）
  vitalsOpen: false,   // 見守り係がチェッカーを見ている
  shiftOpen: false,    // へんしん屋が「だれになる？」を選んでいる
  blockedSeen: null,   // 知らせた「バリアでねむらせられなかった」の時刻（null＝この回はまだ見ていない）
  bannerTimer: null,
  toastTimer: null,
  lastAdvanceTry: 0,
  taskGen: 0,          // ひらいた仕事の回（閉じたあとに残ったミニゲームのタイマーで、次の仕事がおわらないように）
  awaySince: {},       // ゲーム中に在室が消えた時刻（ホストの端末だけ使う）
  dueKey: null,        // 進められる状態（会議のしめきり・結果のあとなど）を最初に見た回
  dueSince: 0,
};
const ME = { x: E.TABLE.x, y: E.TABLE.y + 2.9, face: 1, sentAt: 0, sentText: '', moving: false, ventAt: 0, climb: null, vent: null };   // vent: 近道の中 {id, until}（2026-10-29）   // climb: はしごを使っている途中 {until, to, label}
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
const spotOf = (id) => E.spotInfo(id);
// 仕事の場所の部屋の名前（ふたりの仕事は「電気室と畑」のように2つ）
const spotRoom = (sp) => sp.roomLabel || E.roomName(sp.room);
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
    air: Number(raw.air) || 0,
    airFixed: {},
    doors: {},
    doorReadyAt: Number(raw.doorReadyAt) || 0,
    buttonReadyAt: Number(raw.buttonReadyAt) || 0,
    pair: {},
    sleptBy: {},
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
    say: {},          // ひとこと {id: {k, t, r, n, at, m}}（ひとり1枠。最新の1件だけ）
    cam: {},          // 監視カメラを見ている人 {id: true}（game/cam/{id}。見おわったら消す。会議で空にする）
    // 役職（2026-10-29）
    jobs: {},
    angelReadyAt: Number(raw.angelReadyAt) || 0,
    shield: {},
    shape: {},
    shiftReadyAt: {},
    blocked: null,
  };
  const jobsRaw = objOf(raw.jobs);
  const shieldRaw = objOf(raw.shield);
  const shapeRaw = objOf(raw.shape);
  const shiftRaw = objOf(raw.shiftReadyAt);
  players.forEach((id) => {
    if (['engineer', 'watcher', 'shifter', 'angel'].includes(jobsRaw[id])) g.jobs[id] = jobsRaw[id];
    if (Number(shieldRaw[id]) > 0) g.shield[id] = Number(shieldRaw[id]);
    const sh = objOf(shapeRaw[id]);
    if (typeof sh.as === 'string' && players.includes(sh.as) && Number(sh.until) > 0) g.shape[id] = { as: sh.as, until: Number(sh.until) };
    if (Number(shiftRaw[id]) > 0) g.shiftReadyAt[id] = Number(shiftRaw[id]);
  });
  const bl = objOf(raw.blocked);
  if (typeof bl.by === 'string' && typeof bl.t === 'string' && Number(bl.at) > 0) g.blocked = { by: bl.by, t: bl.t, at: Number(bl.at) };
  const buttons = objOf(raw.buttons);
  // ひとことは game/say/{id} にひとり1枠で書く。言葉の種類・相手・部屋は確かめて取りこむ（r 全体の transaction でもそのまま書き戻す）
  const sayRaw = objOf(raw.say);
  players.forEach((id) => {
    const v = sayRaw[id];
    if (!v || typeof v !== 'object' || !E.sayPhrase(v.k)) return;
    g.say[id] = {
      k: String(v.k),
      t: typeof v.t === 'string' && players.includes(v.t) ? v.t : '',
      r: typeof v.r === 'string' && E.roomName(v.r) ? v.r : '',
      n: Number(v.n) || 0,
      at: Number(v.at) || 0,
      m: Number(v.m) || 0,
      // 送った人の位置（遊んでいる間のひとことは、近くの人にだけ届く「ささやき」。2026-10-28）
      x: Number.isFinite(Number(v.x)) ? Number(v.x) : null,
      y: Number.isFinite(Number(v.y)) ? Number(v.y) : null,
      a: typeof v.a === 'string' && players.includes(v.a) ? v.a : id,   // 見た目のだれか（へんしん中に送ったとき）
    };
  });
  const camRaw = objOf(raw.cam);
  players.forEach((id) => { if (camRaw[id] === true) g.cam[id] = true; });
  // 空気のパネル・ドア・ふたりの仕事のスイッチ（2026-10-28）
  const airFixedRaw = objOf(raw.airFixed);
  E.AIR_PANELS.forEach((p) => { if (airFixedRaw[p.id] === true) g.airFixed[p.id] = true; });
  const doorsRaw = objOf(raw.doors);
  E.DOOR_ROOMS.forEach((key) => { if (Number(doorsRaw[key]) > 0) g.doors[key] = Number(doorsRaw[key]); });
  const pairRaw = objOf(raw.pair);
  E.PAIRS.forEach((p) => {
    const v = objOf(pairRaw[p.id]);
    const ends = {};
    ['a', 'b'].forEach((end) => {
      const h = objOf(v[end]);
      if (typeof h.id === 'string' && players.includes(h.id) && Number(h.at) > 0) ends[end] = { id: h.id, at: Number(h.at) };
    });
    if (Object.keys(ends).length) g.pair[p.id] = ends;
  });
  const sleptByRaw = objOf(raw.sleptBy);
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
      .filter((t) => Number.isInteger(t.spot) && E.spotInfo(t.spot))
      .map((t) => ({ spot: t.spot, done: t.done || Number(doneMark[t.spot]) === g.id }));
    g.buttons[id] = Number(buttons[id]) || 0;
    if (asleep[id] === 'slept' || asleep[id] === 'voted') g.asleep[id] = asleep[id];
    if (typeof sleptByRaw[id] === 'string' && players.includes(sleptByRaw[id])) g.sleptBy[id] = sleptByRaw[id];
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
  E.useMap(g.settings.map);   // このゲームのマップ（ひみつ基地／パーク）に合わせる
  if (g.stage === 'meeting' && !g.meeting) g.stage = 'play';
  if (g.stage === 'result' && !g.result) g.stage = 'play';
  return g;
}

const nameIn = (g, id) => (g && g.names[id]) || id;
// このゲームで遊んでいる（途中で抜けた人は、戻ってくるまで見学。戻ればホストの端末が印を外す）
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
    placedKey: '',
    savedPos: null,
    wasWatching: false,
    backNote: false,
    wasAsleep: false,
  });
  clearTimeout(state.offlineTimer);
  state.offlineTimer = null;
  $('hudOffline').hidden = true;
  releaseWakeLock();
  clearPositions();
  clearSession();
  clearPos();
  state.pairHold = null;
  state.sabOpen = false;
  state.sabDoor = false;
  state.mapOpen = false;
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
  state.picks = [];
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
    showOffline(!state.isConnected);
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

// ゲーム中に在室が消えたまま LEFT_GRACE_MS たった人（タブを閉じた人）を、抜けた人にする。
// 抜けた人が同じ名前で戻ってきたら（在室がある）、続きから遊べるように戻す（ホストの端末が見る）
function watchLeavers(room) {
  const g = gameOf(room);
  if (!g || g.stage === 'end') { state.awaySince = {}; return; }
  const back = g.players.filter((id) => !isBot(id) && g.left[id] && room.players?.[id]);
  if (back.length) gameAct(mut.back(back));
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

// ホストが選んだねむらせ屋のうち、次のゲームで遊ぶ人にいる分
function validPicks(room) {
  const ids = playersOf(room).map((p) => p.id);
  return state.picks.filter((id, i, a) => ids.includes(id) && a.indexOf(id) === i);
}

// 「ホストが選ぶ」のとき、選んだ人数と必要な人数の差（0 なら合っている。正は足りない、負は多い）。ランダムのときは 0
function pickShortage(room) {
  const s = settingsOf(room);
  if (s.pick !== 1) return 0;
  return E.sleeperCount(s, playersOf(room).length) - validPicks(room).length;
}

function togglePick(id) {
  if (state.role !== 'host' || !state.room) return;
  state.picks = state.picks.includes(id) ? state.picks.filter((x) => x !== id) : state.picks.concat(id);
  renderWaiting(state.room);
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
  if (pickShortage(room) !== 0) return;
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
    const picks = settings.pick === 1 ? validPicks(current) : [];
    if (settings.pick === 1 && picks.length !== E.sleeperCount(settings, list.length)) return;
    const base = E.newGame(list.map((p) => p.id), settings, null, picks);
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
      buttonReadyAt: now + E.BUTTON_WAIT_S * 1000,
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
    state.picks = [];
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
  // 会議がひらいたら、空気の妨害・ドア・おしているスイッチは片づく
  g.air = 0;
  g.airFixed = {};
  g.doors = {};
  g.pair = {};
  g.cam = {};
  g.shield = {};
  g.shape = {};
}

// 投票できる人（おきていて、ルームにいる人。ロボットはいつもいる）がみんな入れたか
function everyoneVoted(g, room) {
  return E.awakeOf(g).every((id) => g.meeting.votes[id] || (!isBot(id) && !room.players?.[id]));
}

// timeout: しめきり（時間切れ・ホストのしめきり）で終わった会議。まだ入れていない人はスキップとして数える（2026-10-28 子どもの要望「時間切れは投票スキップ」）
function endMeeting(g, now, timeout) {
  if (timeout) E.awakeOf(g).forEach((id) => { if (!g.meeting.votes[id]) g.meeting.votes[id] = SKIP; });
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
    // まもり星のバリア: ねむらせられない。バリアは消え、待ち時間ははじめから（本人とまもり星にだけ知らせる）
    if (E.shielded(g, target, now)) {
      delete g.shield[target];
      g.cooldown[actor] = now + g.settings.cooldown * 1000;
      g.blocked = { by: actor, t: target, at: now };
      return true;
    }
    g.asleep[target] = 'slept';
    g.sleptBy[target] = actor;   // ねむらされた本人の画面にだけ出す（ほかの人には言わない約束）
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
  // 会議ボタン: はじめと会議のあと BUTTON_WAIT_S 秒は押せない。空気が止まっている間も押せない（なおすのが先）
  button: (actor) => (g, now) => {
    if (g.stage !== 'play' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || (g.buttons[actor] || 0) <= 0) return false;
    if (g.buttonReadyAt > now || g.air) return false;
    g.buttons[actor] -= 1;
    startMeeting(g, now, 'button', actor, null);
    return true;
  },
  // 停電と空気は同じ待ち時間を使い、同時には起こせない
  dark: (actor) => (g, now) => {
    if (g.stage !== 'play' || g.roles[actor] !== 'sleeper' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || g.dark || g.air || g.darkReadyAt > now) return false;
    g.dark = true;
    return true;
  },
  fix: (actor) => (g, now) => {
    if (g.stage !== 'play' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || !g.dark) return false;
    g.dark = false;
    g.darkReadyAt = now + DARK_AGAIN_S * 1000;
    return true;
  },
  // 空気を止める（ねむらせ屋）: AIR_LIMIT_S 秒のうちに2つのパネルを両方なおさないと、ねむらせ屋の勝ち
  air: (actor) => (g, now) => {
    if (g.stage !== 'play' || g.roles[actor] !== 'sleeper' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || g.dark || g.air || g.darkReadyAt > now) return false;
    g.air = now + E.AIR_LIMIT_S * 1000;
    g.airFixed = {};
    return true;
  },
  // 空気のパネルをなおす（おきている人。パネルの前のミニゲームのあと）。2つなおったら空気はもどる。時間がきていたら、なおせない
  airFix: (actor, panel) => (g, now) => {
    if (g.stage !== 'play' || (E.hasLeft(g, actor) || !E.isAwake(g, actor)) || !g.air || g.airFixed[panel]) return false;
    if (!E.AIR_PANELS.some((p) => p.id === panel)) return false;
    if (E.checkAir(g, now)) { g.stage = 'end'; return true; }
    g.airFixed[panel] = true;
    if (E.AIR_PANELS.every((p) => g.airFixed[p.id])) {
      g.air = 0;
      g.airFixed = {};
      g.darkReadyAt = now + DARK_AGAIN_S * 1000;
    }
    return true;
  },
  // ドアをしめる（ねむらせ屋）: 部屋の入口がぜんぶ DOOR_MS の間とじる。次は DOOR_AGAIN_S 秒あと
  door: (actor, room) => (g, now) => {
    if (g.stage !== 'play' || g.roles[actor] !== 'sleeper' || (E.hasLeft(g, actor) || !E.isAwake(g, actor))) return false;
    if (!E.DOOR_ROOMS.includes(room) || g.doorReadyAt > now || (g.doors[room] || 0) > now) return false;
    g.doors[room] = now + E.DOOR_MS;
    g.doorReadyAt = now + E.DOOR_AGAIN_S * 1000;
    return true;
  },
  // まもり星: おきている人にバリア（SHIELD_S 秒ねむらせられない）。次は ANGEL_GAP_S 秒あと。距離は押した端末が確かめる
  protect: (actor, target) => (g, now) => {
    if (g.stage !== 'play' || g.jobs[actor] !== 'angel' || E.hasLeft(g, actor)) return false;   // おきていても、ねむってからも使える
    if ((g.angelReadyAt || 0) > now || target === actor || !E.awakeOf(g).includes(target)) return false;
    g.shield = { [target]: now + E.SHIELD_S * 1000 };
    g.angelReadyAt = now + E.ANGEL_GAP_S * 1000;
    return true;
  },
  // へんしん屋: おきているほかの人のすがたに SHIFT_S 秒なる。次は、おわってから SHIFT_GAP_S 秒あと
  shift: (actor, target) => (g, now) => {
    if (g.stage !== 'play' || g.jobs[actor] !== 'shifter' || g.roles[actor] !== 'sleeper' || !E.isAwake(g, actor) || E.hasLeft(g, actor)) return false;
    if ((g.shiftReadyAt[actor] || 0) > now || E.looksAs(g, actor, now) !== actor) return false;
    if (target === actor || !E.awakeOf(g).includes(target)) return false;
    g.shape[actor] = { as: target, until: now + E.SHIFT_S * 1000 };
    g.shiftReadyAt[actor] = now + (E.SHIFT_S + E.SHIFT_GAP_S) * 1000;
    return true;
  },
  left: (ids) => (g, now) => markLeft(g, ids, now),
  // 抜けた人が戻ってきた: 同じ役・同じ状態（おきている／ねむっている）で続きから。のこりの仕事も全体の数にもどる
  back: (ids) => (g, now, room) => {
    if (g.stage === 'end') return false;
    let changed = false;
    ids.forEach((id) => { if (g.left[id] && room.players?.[id]) { delete g.left[id]; changed = true; } });
    return changed;
  },
  closeVote: () => (g, now) => {
    if (g.stage !== 'meeting') return false;
    endMeeting(g, now, true);
    return true;
  },
  // 時間で進むところ（会議のしめきり・結果のあと・15分の時間切れ・空気の時間切れ）。late はホスト以外の端末が代わるときの待ち
  advance: (late) => (g, now, room) => {
    if (g.stage === 'meeting' && (now >= g.meeting.endsAt + late || everyoneVoted(g, room))) {
      endMeeting(g, now, !everyoneVoted(g, room));
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
        g.buttonReadyAt = now + E.BUTTON_WAIT_S * 1000;
      }
      return true;
    }
    // 仕事の完了は小さな印で書くので、ぜんぶおわったかはここで確かめる
    if (g.stage === 'play' && E.checkWin(g)) {
      g.stage = 'end';
      return true;
    }
    if (g.stage === 'play' && g.air && now >= g.air + late && E.checkAir(g, now)) {
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
  if (actor === state.nickname && g.jobs[actor] === 'watcher') state.battery = E.WATCH_BATTERY_S;   // 見守り係: 仕事を1つおえるとチェッカーの電池が満タン
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

/* ── ひとこと（ボタンで知らせる） ── */
// 自分のひとことを game/say/{自分} に1件だけ書く（遊んでいる間と会議中。おきている人だけ。5秒に1回まで）
async function doSay(key, target) {
  const room = state.room;
  const g = gameOf(room);
  const me = state.nickname;
  if (!g || !isPlaying(g, me) || !E.isAwake(g, me)) return false;
  if (g.stage !== 'play' && g.stage !== 'meeting') return false;
  const p = E.sayPhrase(key);
  if (!p || !E.sayAllowed(key, g.stage)) return false;
  const withName = p.t.includes('{name}');
  if (withName && (!target || target === me || !g.players.includes(target) || E.hasLeft(g, target))) return false;
  const now = Date.now();
  if (now - state.sayAt < E.SAY_GAP_MS) { toast('ひとことは、5秒に1回まで', false); return false; }
  state.sayAt = now;
  const prev = g.say[me];
  const data = {
    k: key,
    t: withName ? target : '',
    r: p.t.includes('{room}') ? (E.roomAt(ME.x, ME.y) || '') : '',
    n: (prev ? prev.n : 0) + 1,
    at: RoomkRTDB.now(),
    m: g.stage === 'meeting' ? g.meeting.seq : 0,
    // 遊んでいる間は、近くの人にだけ届く（受け取る側が、自分の見える広さの中にいるかで決める）
    x: Math.round(ME.x * 10) / 10,
    y: Math.round(ME.y * 10) / 10,
    // 見た目のだれか（へんしん中は、なっている人。送った時点で決める。2026-10-29）
    a: g.stage === 'play' ? E.looksAs(g, me, RoomkRTDB.now()) : me,
  };
  try {
    await state.roomRef.child('game/say/' + me).set(data);
  } catch (error) {
    console.warn('[nemurase] say failed', error);
    toast('うまく送れませんでした。もう一度ためしてね');
    return false;
  }
  return true;
}

const sayLabel = (g, v) => E.sayText(v.k, v.r ? E.roomName(v.r) : E.HALL_LABEL, v.t ? nameIn(g, v.t) : '');

// 遊んでいる間のひとこと（ささやき）が自分に届くか: 送った人が、自分の見える広さの中にいて、間にかべがない。
// 自分のは届く。ねむった人はぜんぶ見えるので、ぜんぶ届く。進行役・見学には届かない（位置の話なので、画面共有で流れないように）
function sayReaches(g, id, v) {
  const me = state.nickname;
  if (id === me) return true;
  if (!isPlaying(g, me)) return false;
  if (!E.isAwake(g, me)) return true;
  if (v.x == null || v.y == null) return false;
  const from = { x: v.x, y: v.y };
  return E.dist(from, ME) <= viewRadius(g) && E.canSee(ME, from);
}

// 届いたひとことのうち、まだ見ていないものを流れに足し、遊んでいる間は近くの人にだけ画面の上に出す（2026-10-28 ささやきに）
function takeSays(g) {
  Object.keys(g.say).forEach((id) => {
    const v = g.say[id];
    if ((state.sayHeard[id] || 0) >= v.n) return;
    state.sayHeard[id] = v.n;
    const entry = { id, look: v.m ? id : v.a, text: sayLabel(g, v), m: v.m };
    if (v.m || sayReaches(g, id, v)) {
      state.sayLog.push(entry);
      if (state.sayLog.length > E.SAY_LOG_MAX * 4) state.sayLog.shift();
    }
    if (g.stage === 'play' && !v.m && sayReaches(g, id, v)) showSayTicker(g, entry);
  });
}

// 遊んでいる間の、画面の上の「名前: 言葉」（新しい順に3つまで。SAY_SHOW_MS で消える）
function showSayTicker(g, entry) {
  const ul = $('sayTicker');
  const li = makeElement('li', 'nk-says__item');
  // へんしん中のささやきは、なっている人の名前で出す（送った時点のすがた）
  const look = entry.look || entry.id;
  li.append(chip(g.colors[look]), makeElement('span', 'nk-says__name', nameIn(g, look)), makeElement('span', 'nk-says__text', entry.text));
  ul.prepend(li);
  while (ul.children.length > 3) ul.lastElementChild.remove();
  setTimeout(() => { if (li.parentNode) li.remove(); }, E.SAY_SHOW_MS);
}

function clearSayTicker() {
  $('sayTicker').replaceChildren();
}

// 言葉のボタン（chip）を作る。withName の言葉は onName で人を選ぶ
function sayChip(g, p, onPick) {
  const b = makeElement('button', 'nk-word', p.t.replace('{room}', E.roomName(E.roomAt(ME.x, ME.y)) || E.HALL_LABEL).replace('{name}', '〔名前〕').replace('{fix}', E.fixRoomName()));
  b.type = 'button';
  b.dataset.say = p.k;
  b.addEventListener('click', () => onPick(p));
  return b;
}

// 「だれ？」の一覧（名前の入る言葉を押したあと。自分と抜けた人は出ない。ねむっている人も出す＝だれがねむったかは知らせない）
function renderNamePicker(g, box, key, onPick, onCancel) {
  box.replaceChildren();
  box.appendChild(makeElement('span', 'nk-words__lead', 'だれ？'));
  g.players.filter((id) => id !== state.nickname && !E.hasLeft(g, id)).forEach((id) => {
    const b = makeElement('button', 'nk-word nk-word--name', nameIn(g, id));
    b.type = 'button';
    b.addEventListener('click', () => onPick(key, id));
    box.appendChild(b);
  });
  const cancel = makeElement('button', 'nk-word nk-word--quiet', 'やめる');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  box.appendChild(cancel);
}

// 遊んでいる間の「ひとこと」の一覧（開くたびに作り直す。部屋の名前が変わるため）。名前の入る言葉は「だれ？」で人を選んでから送る
function renderSayBox(g) {
  const box = $('sayBox');
  const me = state.nickname;
  const can = g.stage === 'play' && isPlaying(g, me) && E.isAwake(g, me) && !blocked();
  if (!can) state.sayOpen = false;
  box.hidden = !state.sayOpen;
  $('actSay').setAttribute('aria-expanded', String(state.sayOpen));
  if (!state.sayOpen) { if (g.stage === 'play') state.sayPending = null; return; }
  const list = $('sayChips');
  const names = $('sayNames');
  list.replaceChildren();
  const send = async (key, target) => {
    if (await doSay(key, target)) { state.sayOpen = false; state.sayPending = null; renderSayBox(g); }
  };
  E.SAYS.play.concat(E.SAYS.common).forEach((p) => {
    list.appendChild(sayChip(g, p, (q) => {
      if (!q.t.includes('{name}')) { state.sayPending = null; send(q.k, ''); return; }
      state.sayPending = state.sayPending === q.k ? null : q.k;
      renderSayBox(g);
    }));
  });
  if (state.sayPending) {
    list.querySelectorAll('.nk-word').forEach((b) => b.classList.toggle('is-picked', b.dataset.say === state.sayPending));
    renderNamePicker(g, names, state.sayPending, send, () => { state.sayPending = null; renderSayBox(g); });
  } else names.replaceChildren();
  names.hidden = !state.sayPending;
}

function toggleSayBox() {
  const g = gameOf(state.room);
  if (!g) return;
  state.sayOpen = !state.sayOpen;
  state.sayPending = null;
  renderSayBox(g);
}

/* ── ふたりの仕事（離れた2か所のスイッチを、ふたりが同時におす） ── */
// スイッチをおしはじめる: game/pair/{仕事}/{a|b} に {id, at} を書く。おしている間は PAIR_BEAT_MS おきに at を書き直す（はなれたらやめる）
async function pairPress(pid, end) {
  const g = gameOf(state.room);
  const me = state.nickname;
  if (!g || g.stage !== 'play' || !isPlaying(g, me) || state.pairHold) return false;
  state.pairHold = { pid, end, beatAt: 0 };
  return pairBeat();
}

async function pairBeat() {
  const h = state.pairHold;
  if (!h || !state.roomRef) return false;
  h.beatAt = Date.now();
  try {
    await state.roomRef.child('game/pair/' + h.pid + '/' + h.end).set({ id: state.nickname, at: RoomkRTDB.now() });
    return true;
  } catch (error) {
    console.warn('[nemurase] pair press failed', error);
    return false;
  }
}

// スイッチからはなれる・会議・おわり: おしているのをやめる（自分の分だけ消す）
function pairRelease() {
  const h = state.pairHold;
  if (!h) return;
  state.pairHold = null;
  if (!state.roomRef) return;
  const ref = state.roomRef.child('game/pair/' + h.pid + '/' + h.end);
  ref.transaction((cur) => (cur && cur.id === state.nickname ? null : undefined)).catch(() => {});
}

// おしつづけている間の世話: はなれたらやめる・時間がきたら書き直す・相手がもう一方をおしていたら仕事がおわる
function tendPair(g) {
  const h = state.pairHold;
  if (!h) return;
  const me = state.nickname;
  const p = E.pairOf(h.pid);
  // そろったあとの1.5秒は、動いても はなさない（相手の画面が「そろった」を見られるように）。会議・おしまいでは はなす
  if (h.doneAt) { if (!p || g.stage !== 'play' || Date.now() - h.doneAt >= PAIR_LINGER_MS) pairRelease(); return; }
  if (!p || g.stage !== 'play' || !isPlaying(g, me) || E.dist(p[h.end], ME) > E.USE_RANGE) { pairRelease(); return; }
  const now = RoomkRTDB.now();
  const other = (g.pair[h.pid] || {})[h.end === 'a' ? 'b' : 'a'];
  if (!h.doneAt && E.pairFresh(other, now) && other.id !== me) {
    // ふたりそろった。自分がこの仕事を持っていればおわる。持っていなければ手伝えた
    h.doneAt = Date.now();
    const mine = (g.tasks[me] || []).find((t) => t.spot === p.spot && !t.done);
    if (mine && g.roles[me] === 'crew') doTask(me, p.spot).then((ok) => { if (ok) smallToast('ふたりでできた！'); });
    else smallToast('手伝えた！');
  }
  // そろってもすぐには はなさない（相手の画面が「そろった」を見る前に消えると、相手の仕事がおわらないため。2026-10-29 E2E で見つけた）
  if (h.doneAt) return;
  if (Date.now() - h.beatAt >= E.PAIR_BEAT_MS) pairBeat();
}

// だれかがおしているスイッチ（有効なものだけ）{pid: {a: id, b: id}}
function pairHolders(g, now) {
  const out = {};
  E.PAIRS.forEach((p) => {
    const v = g.pair[p.id] || {};
    ['a', 'b'].forEach((end) => { if (E.pairFresh(v[end], now)) { out[p.id] = out[p.id] || {}; out[p.id][end] = v[end].id; } });
  });
  return out;
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
    || (g.stage === 'play' && (now >= g.endsAt || (g.air && now >= g.air) || E.checkWin(g)));
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
    BOTS[id] = { id, x: sp.x, y: sp.y, face: 1, route: [], goal: null, waitUntil: Date.now() + 1500 + Math.random() * 2000, voteAt: 0, sentAt: 0, sentText: '', findAt: 0, busyUntil: 0, pairHold: null };
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

// とじているドアのマス（いま）
const closedNow = (g) => E.doorTiles(E.closedRooms(g, RoomkRTDB.now()));

function routeTo(b, x, y, closed) {
  const r = E.path({ x: Math.floor(b.x), y: Math.floor(b.y) }, { x: Math.floor(x), y: Math.floor(y) }, closed);
  b.route = r ? r.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })) : [];
  if (b.route.length) b.route[b.route.length - 1] = { x, y };
  return b.route.length > 0;
}

// おきている隊員のロボット（順番どおり）。停電は1つ目、空気は1つ目と2つ目がなおしに行く
function crewBots(g) {
  return Object.keys(BOTS).filter((id) => E.isAwake(g, id) && g.roles[id] === 'crew');
}
function firstCrewBot(g) {
  return crewBots(g)[0];
}

// ロボットがふたりの仕事を手伝う: おしているのを書く・書き直す・やめる
function botPairWrite(b) {
  const h = b.pairHold;
  if (!h || !state.roomRef) return;
  h.beatAt = Date.now();
  state.roomRef.child('game/pair/' + h.pid + '/' + h.end).set({ id: b.id, at: RoomkRTDB.now() }).catch(() => {});
}
function botPairRelease(b) {
  const h = b.pairHold;
  if (!h) return;
  b.pairHold = null;
  if (!state.roomRef) return;
  state.roomRef.child('game/pair/' + h.pid + '/' + h.end).transaction((cur) => (cur && cur.id === b.id ? null : undefined)).catch(() => {});
}
// だれかがおしていて、もう一方がまだ空いているスイッチ {pid, end（空いている側）}。ロボットはそこへ行って手伝う
function pairNeedingHelp(g) {
  const holders = pairHolders(g, RoomkRTDB.now());
  const pid = Object.keys(holders).find((k) => (holders[k].a && !holders[k].b) || (holders[k].b && !holders[k].a));
  if (!pid) return null;
  return { pid, end: holders[pid].a ? 'b' : 'a' };
}

// ホストが知っている、その人の位置（ロボットはその場の位置）
function knownPos(id) {
  if (id === state.nickname) return ME;
  if (BOTS[id]) return BOTS[id];
  return PA[id] && !PA[id].hidden ? { x: PA[id].tx, y: PA[id].ty } : null;   // 近道の中の人は見えない
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
  // ふたりの仕事を手伝っている途中: おしつづける。相手がいなくなった・時間がきたらやめる
  if (b.pairHold) {
    const h = b.pairHold;
    const other = (g.pair[h.pid] || {})[h.end === 'a' ? 'b' : 'a'];
    if (now >= h.until || !E.pairFresh(other, RoomkRTDB.now()) && now - h.since > 2500) { botPairRelease(b); b.waitUntil = now + 1500; return; }
    if (now - h.beatAt >= E.PAIR_BEAT_MS) botPairWrite(b);
    return;
  }
  if (now < b.waitUntil) return;
  const closed = closedNow(g);
  if (!b.goal) {
    const cbots = crewBots(g);
    const airPanel = g.air && awake && role === 'crew' ? E.AIR_PANELS.filter((p) => !g.airFixed[p.id])[cbots.indexOf(b.id)] : null;
    const help = awake ? pairNeedingHelp(g) : null;
    let ok = true;
    if (airPanel && cbots.indexOf(b.id) < 2) {
      b.goal = { kind: 'airfix', panel: airPanel.id };
      ok = routeTo(b, airPanel.x, airPanel.y + 0.6, closed);
    } else if (g.dark && awake && role === 'crew' && firstCrewBot(g) === b.id) {
      b.goal = { kind: 'fix' };
      ok = routeTo(b, E.FIX_SPOT.x, E.FIX_SPOT.y + 0.6, closed);
    } else if (help && cbots[0] === b.id) {
      const p = E.pairOf(help.pid);
      b.goal = { kind: 'pair', pid: help.pid, end: help.end };
      ok = routeTo(b, p[help.end].x, p[help.end].y + 0.6, closed);
    } else {
      const todo = role === 'crew' ? g.tasks[b.id].filter((t) => !t.done && t.spot < E.PAIR_SPOT_BASE) : [];
      const sp = todo.length ? spotOf(todo[0].spot) : E.SPOTS[Math.floor(Math.random() * E.SPOTS.length)];
      b.goal = todo.length ? { kind: 'task', spot: todo[0].spot } : { kind: 'walk' };
      ok = routeTo(b, sp.x, sp.y + 0.6, closed);
    }
    // ドアがとじていて行けなければ、少し待ってから考えなおす
    if (!ok) { b.goal = null; b.waitUntil = now + 1500; return; }
  }
  if (b.route.length) {
    const w = b.route[0];
    const dx = w.x - b.x;
    const dy = w.y - b.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.12) { b.route.shift(); return; }
    const n = E.step(b, dx / d, dy / d, Math.min(dt, d / E.SPEED), closed);
    if (Math.abs(dx) > 0.01) b.face = dx > 0 ? 1 : -1;
    if (n.x === b.x && n.y === b.y) {
      // 進めない。ドアがとじたのなら、道を考えなおす（人と同じで通れない）。そうでなければ角に引っかかっただけなので、次の点へ
      if (closed.size && closed.has(E.tileKey(Math.floor(w.x), Math.floor(w.y)))) { b.goal = null; b.route = []; b.waitUntil = now + 1500; return; }
      b.x = w.x; b.y = w.y; b.route.shift(); return;
    }
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
    // 人と同じくらいの時間をかけてなおす（その間に電気がついていれば何もしない）
    b.busyUntil = now + BOT_FIX_MS;
    setTimeout(() => {
      const current = gameOf(state.room);
      if (current && current.id === g.id && current.stage === 'play' && current.dark) gameAct(mut.fix(b.id));
    }, BOT_FIX_MS);
  } else if (goal.kind === 'airfix') {
    b.busyUntil = now + BOT_FIX_MS;
    setTimeout(() => {
      const current = gameOf(state.room);
      if (current && current.id === g.id && current.stage === 'play' && current.air && !current.airFixed[goal.panel]) gameAct(mut.airFix(b.id, goal.panel));
    }, BOT_FIX_MS);
  } else if (goal.kind === 'pair') {
    // スイッチをおしつづける（相手がはなれるか、時間がくるまで）
    b.pairHold = { pid: goal.pid, end: goal.end, until: now + BOT_PAIR_HOLD_MS, since: now, beatAt: 0 };
    botPairWrite(b);
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
  if (!g || g.stage !== 'play') { Object.values(BOTS).forEach((b) => { if (b.pairHold) b.pairHold = null; }); return; }
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
  const text = E.encodePos(pos.x, pos.y, pos.face || 1, !!pos.vent);
  if (text === pos.sentText && !force) return;
  const now = Date.now();
  if (!force && now - (pos.sentAt || 0) < POS_MS) return;
  pos.sentAt = now;
  pos.sentText = text;
  state.rootRef.child((awake ? 'p/' : 'g/') + id).set(text).catch((error) => console.warn('[nemurase] position send failed', error));
  if (id === state.nickname) savePos();
}

// 自分の位置を端末に残す（読み込み直しで、テーブルへ瞬間移動して逃げられないように。同じ回・同じ spawnSeq のときだけ使う）
function savePos() {
  try {
    sessionStorage.setItem(POS_KEY, JSON.stringify({ g: state.gameId, s: state.spawnKey, x: Math.round(ME.x * 10) / 10, y: Math.round(ME.y * 10) / 10, f: ME.face }));
  } catch {
    // 保存できないときは、読み込み直しでテーブルのまわりから
  }
}
function loadPos(spawnKey) {
  try {
    const v = JSON.parse(sessionStorage.getItem(POS_KEY));
    if (!v || v.s !== spawnKey || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null;
    if (v.x < 0 || v.y < 0 || v.x > E.W || v.y > E.H) return null;
    return { x: v.x, y: v.y, face: v.f < 0 ? -1 : 1 };
  } catch {
    return null;
  }
}
function clearPos() {
  try { sessionStorage.removeItem(POS_KEY); } catch { /* 何もしない */ }
}

function takePos(map, id, text) {
  if (id === state.nickname || BOTS[id]) return;
  const p = E.decodePos(text);
  if (!p) { delete map[id]; return; }
  const cur = map[id];
  if (!cur || Math.hypot(cur.tx - p.x, cur.ty - p.y) > 3) map[id] = { x: p.x, y: p.y, tx: p.x, ty: p.y, face: p.face, hidden: p.hidden };
  else { cur.tx = p.x; cur.ty = p.y; cur.face = p.face; cur.hidden = p.hidden; }
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
      releaseWakeLock();
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
  const picks = host ? validPicks(room) : [];
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
    // 「ホストが選ぶ」のとき、ホストの画面にだけ選ぶボタンを出す（進行だけのホストは遊ばないので出さない）
    if (host && s.pick === 1 && !(p.isHost && s.hostPlays === 0)) {
      const picked = picks.includes(p.id);
      if (picked) li.appendChild(makeElement('span', 'nk-tag nk-tag--sleeper', 'ねむらせ屋'));
      const b = makeElement('button', 'btn btn-secondary btn-sm nk-person__pick', picked ? 'はずす' : 'ねむらせ屋にする');
      b.type = 'button';
      b.setAttribute('aria-pressed', picked ? 'true' : 'false');
      b.setAttribute('aria-label', (picked ? 'ねむらせ屋からはずす: ' : 'ねむらせ屋にする: ') + p.name);
      b.addEventListener('click', () => togglePick(p.id));
      li.appendChild(b);
    }
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
  const shortage = pickShortage(room);
  if (host && n >= E.MIN_PLAYERS && n <= E.MAX_PLAYERS && shortage !== 0) {
    note = shortage > 0
      ? 'ねむらせ屋にする人を、あと ' + shortage + ' 人えらんでください'
      : 'ねむらせ屋は ' + E.sleeperCount(s, n) + ' 人です。' + (-shortage) + ' 人はずしてください';
  }
  $('lobbyNote').textContent = note;
  $('btnStart').disabled = n < E.MIN_PLAYERS || n > E.MAX_PLAYERS || shortage !== 0;
}

function closeOverlays() {
  if (state.camOpen) closeCam();
  if (state.mapOpen) closeMap();
  if (state.vitalsOpen) closeVitals();
  state.shiftOpen = false;
  $('shiftBox').hidden = true;
  ['ovRole', 'ovTask', 'ovCam', 'ovMap', 'ovVitals', 'ovMeeting', 'ovResult', 'ovEnd'].forEach((id) => { $(id).hidden = true; });
  state.taskSpot = -1;
  state.votePick = null;
  state.sayPending = null;
  state.sabOpen = false;
  state.sabDoor = false;
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

// 通信が切れている間は、本人の画面に「切れています」を出す（一瞬の切れは出さない）
function showOffline(off) {
  clearTimeout(state.offlineTimer);
  state.offlineTimer = null;
  if (!off) { $('hudOffline').hidden = true; return; }
  state.offlineTimer = setTimeout(() => {
    state.offlineTimer = null;
    if (state.roomRef && !state.isConnected) $('hudOffline').hidden = false;
  }, OFFLINE_SHOW_MS);
}

// 遊んでいる間は画面を消さない（タブレット・スマホがスリープして通信が切れないように）。対応していない端末では何もしない
async function setWakeLock(want) {
  state.wakeWant = want;
  if (!want) { releaseWakeLock(); return; }
  if (state.wakePending) { state.wakeRetry = true; return; }   // 取りに行っている途中なら、終わってから必要なら取りなおす
  if (state.wakeLock || !navigator.wakeLock || document.visibilityState !== 'visible') return;
  state.wakePending = true;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (!state.wakeWant || state.wakeLock) { lock.release().catch(() => {}); return; }
    state.wakeLock = lock;
    lock.addEventListener('release', () => {
      if (state.wakeLock !== lock) return;
      state.wakeLock = null;
      // タブが表のまま外れたときは、まだ要るなら取りなおす（裏にまわったときは visibilitychange で取りなおす）
      if (state.wakeWant && document.visibilityState === 'visible') setWakeLock(true);
    });
  } catch {
    // 省電力モードなどで断られたときは、そのまま
  } finally {
    state.wakePending = false;
    if (state.wakeRetry) {
      state.wakeRetry = false;
      if (state.wakeWant && !state.wakeLock) setWakeLock(true);
    }
  }
}
function releaseWakeLock() {
  state.wakeWant = false;
  const lock = state.wakeLock;
  state.wakeLock = null;
  if (lock) lock.release().catch(() => {});
}

function renderGame(room) {
  const g = gameOf(room);
  // 新しい回
  if (state.gameId !== g.id) {
    state.gameId = g.id;
    state.spawnKey = '';
    state.placedKey = '';
    state.wasWatching = false;
    state.backNote = false;
    state.wasAsleep = false;
    state.votePick = null;
    state.engVentAt = 0;
    state.battery = E.WATCH_BATTERY_S;
    state.blockedSeen = null;
    // 前の回のひとことは出さない（読み込み直しでも、いま入っている分は見たことにする）
    state.sayHeard = {};
    Object.keys(g.say).forEach((id) => { state.sayHeard[id] = g.say[id].n; });
    state.sayLog = [];
    state.sayOpen = false;
    clearSayTicker();
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
  const wake = playing && g.stage !== 'end';
  if (wake !== state.wakeWant) setWakeLock(wake);
  // テーブルのまわりへもどる（はじめ・会議のあと）
  const sk = g.id + ':' + g.spawnSeq;
  if (state.spawnKey !== sk) {
    state.savedPos = state.spawnKey === '' ? loadPos(sk) : null;   // 読み込み直し（同じ回・同じ spawnSeq）なら元の場所から
    state.spawnKey = sk;
    if (state.role === 'host') resetBotsPosition(g);
  }
  // 自分を置く。抜けた人から戻ったときも、ここで置きなおす（見学の間は置かない）
  if (playing && state.placedKey !== sk) {
    state.placedKey = sk;
    const saved = state.savedPos;
    state.savedPos = null;
    const sp = E.spawnPoint(g.players.indexOf(state.nickname), g.players.length);
    const back = saved && (E.canStand(saved.x, saved.y) || !E.isAwake(g, state.nickname)) ? saved : sp;
    ME.x = back.x;
    ME.y = back.y;
    if (saved) ME.face = saved.face;
    ME.climb = null;
    leaveVent(false);
    pairRelease();
    if (g.stage === 'play') sendPosFor(state.nickname, ME, E.isAwake(g, state.nickname), true);
  }
  // 抜けた人から戻った（この回で見学だったのが、また遊ぶ人になった）。お知らせは遊んでいる間に一度だけ出す
  if (playing && state.wasWatching) {
    state.backNote = true;
    if (g.stage === 'play') sendPosFor(state.nickname, ME, E.isAwake(g, state.nickname), true);   // 止まったままでも、ほかの人の画面に出す
  }
  if (!playing || g.stage === 'end') state.backNote = false;
  state.wasWatching = !playing;
  const asleep = playing && !E.isAwake(g, state.nickname);
  if (playing && asleep && !state.wasAsleep) {
    state.wasAsleep = true;
    // おきている人の画面に残らないよう、p の位置を消して、ここからは g に送る
    state.rootRef.child('p/' + state.nickname).remove().catch(() => {});
    sendPosFor(state.nickname, ME, false, true);
    if (g.stage === 'play' && !state.backNote) {
      // だれにねむらされたかは、本人の画面にだけ出す（ほかの人には言わない約束。2026-10-28）
      const by = g.sleptBy[state.nickname] ? nameIn(g, g.sleptBy[state.nickname]) + ' さんにねむらされた… ' : 'ねむってしまった… ';
      banner(g.roles[state.nickname] === 'crew'
        ? by + 'でも、仕事はつづけられるよ。おきている人には見えず、かべも通りぬけられる。だれにねむらされたかは、ないしょだよ'
        : by + 'あとはみんなの様子を見ていてね', 8000);
    }
  }
  if (state.backNote && g.stage === 'play') {
    state.backNote = false;
    // 役のお知らせの中に書く（バナーだと、お知らせの下に隠れて読めないことがあるため）
    showRole(g, asleep ? 'もどってきたね。ねむったまま、つづきから遊べるよ（仕事はつづけられる）。' : 'もどってきたね。つづきから遊べるよ。');
  }
  if (state.pairHold && !(playing && g.stage === 'play')) pairRelease();
  noteJobs(g, playing);
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
  if ((g.stage !== 'play' || !playing) && state.taskSpot !== -1) closeTask();
  // なおしている途中に電気がついた（ほかの人がなおした）・ねむらされたら、ミニゲームをとじる
  if (state.taskSpot === FIX_TASK && (!g.dark || asleep)) { closeTask(); if (!g.dark) smallToast('電気はついたよ'); }
  // 監視カメラは、遊んでいる間におきている人だけ（会議がひらいた・ねむらされたら とじる）
  if (state.camOpen && (g.stage !== 'play' || !playing || asleep)) closeCam();
  if (state.taskSpot === AIR_TASK_A || state.taskSpot === AIR_TASK_B) {
    const panel = state.taskSpot === AIR_TASK_A ? 'a' : 'b';
    if (!g.air || g.airFixed[panel] || asleep) { closeTask(); if (!g.air) smallToast('空気がもどった'); }
  }
  if (state.mapOpen && (g.stage === 'end' || (g.stage === 'play' && !playing))) closeMap();
  if (state.vitalsOpen && (g.stage !== 'play' || !playing || asleep)) closeVitals();
  if (state.shiftOpen && (g.stage !== 'play' || !playing || asleep)) { state.shiftOpen = false; $('shiftBox').hidden = true; }
  if (state.sabOpen && (g.stage !== 'play' || !playing || asleep)) { state.sabOpen = false; state.sabDoor = false; }
  if (g.stage !== 'play' || !playing) $('ovRole').hidden = true;
  if (g.stage !== 'play') clearSayTicker();
  takeSays(g);
  renderSayBox(g);
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
    Object.assign(b, { x: sp.x, y: sp.y, route: [], goal: null, pairHold: null, waitUntil: Date.now() + 1500 + Math.random() * 2000 });
    if (g.stage === 'play') sendPosFor(id, b, E.isAwake(g, id), true);
  });
}

function renderHud(g, playing) {
  const me = state.nickname;
  $('hudName').textContent = playing ? nameIn(g, me) : me;
  $('hudChip').style.background = playing ? colorHex(g.colors[me]) : colorHex(state.room?.players?.[me]?.color);
  const role = $('hudRole');
  if (playing) {
    const job = E.jobOf(g, me);
    role.textContent = (g.roles[me] === 'sleeper' ? 'ねむらせ屋' : '隊員') + (job ? '・' + E.JOB_NAMES[job] : '') + (E.isAwake(g, me) ? '' : '（ねむっている）');
    role.className = 'nk-role' + (g.roles[me] === 'sleeper' ? ' nk-role--sleeper' : '');
  } else {
    role.textContent = state.role === 'host' ? '進行役' : '見学（次の回から）';
    role.className = 'nk-role';
  }
  const tp = E.taskProgress(g);
  $('hudProgress').style.width = (tp.total ? Math.round((tp.done / tp.total) * 100) : 0) + '%';
  $('hudProgressNum').textContent = tp.done + ' / ' + tp.total;
  // みんなの仕事のバー: 設定で「出す／進行役の画面だけ／出さない」（2026-10-28）
  $('hudGauge').hidden = !(g.settings.gauge === 2 || (g.settings.gauge === 1 && !playing));
  $('hudDark').hidden = !g.dark;
  setText('hudDarkText', '停電中！ ' + E.fixRoomName() + 'のスイッチでなおせる');
  // 声の約束: 会議（と結果）のときだけミュートを外す。帯は進行役の画面（画面共有）にも出す（2026-10-28 子どもの要望「会議の時間以外はミュート」）
  const talk = g.stage === 'meeting' || g.stage === 'result';
  const mute = $('hudMute');
  mute.hidden = g.stage === 'end';
  setText('hudMuteText', talk ? '会議の時間。ミュートを外して話そう' : 'いまはミュートの時間。ひとことで知らせよう');
  mute.classList.toggle('is-talk', talk);
  $('hudMuteIcon').textContent = talk ? 'mic' : 'mic_off';
  updateAirHud(g);
}

// 空気が止まっている間の帯（のこり秒・なおすパネル）
function updateAirHud(g) {
  const box = $('hudAir');
  if (!g.air || g.stage !== 'play') { box.hidden = true; return; }
  box.hidden = false;
  const left = Math.max(0, Math.ceil((g.air - RoomkRTDB.now()) / 1000));
  const todo = E.AIR_PANELS.filter((p) => !g.airFixed[p.id]).map((p) => E.roomName(p.room));
  setText('hudAirText', '空気が止まった！ あと ' + left + ' 秒で ' + (todo.length === 2 ? todo.join('と') + 'のパネルを両方' : todo.join('') + 'のパネルを') + 'なおして');
  box.classList.toggle('is-soon', left <= 15);
}

function renderWatchNote() {
  $('watchNote').textContent = state.role === 'host'
    ? 'みんなは基地の中で仕事をしているよ。会議がひらくまで待ってね'
    : 'いまはゲームの途中。次の回からいっしょに遊べるよ。会議の話し合いは聞いていてね';
}

// 役職の説明（役のお知らせに足す）
const JOB_DESC = {
  engineer: '整備係なので、ねむらせ屋と同じ「近道」を使える（1回使うと' + E.ENGINEER_GAP_S + '秒は使えない）。近道に入るところを見られると、あやしまれるかも。',
  watcher: '見守り係なので、「チェッカー」で、だれがねむっているかを見られる。電池は' + E.WATCH_BATTERY_S + '秒ぶん。少しずつたまり、仕事を1つおえると満タンになる。',
  shifter: 'へんしん屋なので、「へんしん」で、ほかの人のすがたに' + E.SHIFT_S + '秒なれる（次は、もとにもどってから' + E.SHIFT_GAP_S + '秒あと）。',
  angel: 'まもり星なので、近くの人に「まもる」でバリアをはれる。' + E.SHIELD_S + '秒のあいだ、その人はねむらされない（次は' + E.ANGEL_GAP_S + '秒あと。自分にははれない）。ねむらされても使えるよ。',
};
function showRole(g, note) {
  const role = g.roles[state.nickname];
  const job = g.jobs[state.nickname] || '';
  $('roleName').textContent = (role === 'sleeper' ? 'ねむらせ屋' : '隊員') + (job ? '・' + E.JOB_NAMES[job] : '');
  $('roleName').className = 'nk-rolecard__name' + (role === 'sleeper' ? ' nk-rolecard__name--sleeper' : '');
  let desc;
  if (role === 'sleeper') {
    const mates = g.players.filter((id) => id !== state.nickname && g.roles[id] === 'sleeper').map((id) => nameIn(g, id));
    desc = '仲間のふりをして、こっそり隊員をねむらせよう。「停電」で、隊員の見える広さをせまくできるよ。仕事の場所に立てば、仕事をしているふりもできる。';
    if (mates.length) desc += ' もうひとりのねむらせ屋は ' + mates.join('、') + ' さん。';
  } else {
    desc = '基地の仕事を片づけよう。みんなの仕事がぜんぶおわったら勝ち。ねむっている人を見つけたら「見つけた！」で会議をひらこう。';
  }
  if (job) desc += ' ' + JOB_DESC[job];
  $('roleDesc').textContent = (note ? note + ' ' : '') + desc;
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
    const li = makeElement('li', 'nk-task' + (done ? ' is-done' : '') + (sp.kind === 'pair' ? ' nk-task--pair' : ''));
    li.append(msIcon(done ? 'check_circle' : sp.kind === 'pair' ? 'group' : 'radio_button_unchecked'), makeElement('span', 'nk-task__room', spotRoom(sp)), makeElement('span', 'nk-task__label', sp.label));
    ul.appendChild(li);
  });
  let note = '';
  if (role === 'sleeper') note = asleep ? 'ねむってしまったので、見ているだけ' : '本当の仕事はできないよ。立って、仕事のふりをしよう';
  else if (asleep) note = 'ねむっていても、仕事はつづけられる' + (g.sleptBy[me] ? '（' + nameIn(g, g.sleptBy[me]) + ' さんにねむらされた。ないしょだよ）' : '');
  else if (mine.some((t) => !t.done && spotOf(t.spot).kind === 'pair')) note = 'ふたりの仕事は、2つのスイッチをだれかと同時におす';
  $('tasksNote').textContent = note;
}

function renderMeeting(g, room) {
  const box = $('ovMeeting');
  if (g.stage !== 'meeting') { box.hidden = true; state.votePick = null; state.sayPending = null; return; }
  box.hidden = false;
  const m = g.meeting;
  // この会議のひとこと（最新の1件を名前の横に、流れを下に）
  const saysNow = state.sayLog.filter((e) => e.m === m.seq);
  const latestSay = {};
  saysNow.forEach((e) => { latestSay[e.id] = e.text; });
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
    // ねむらせ屋どうしだけ、仲間（と自分）の名前を赤で（2026-10-29 子どもの要望。隊員・進行役の画面ではみんな同じ色）
    const mate = isPlaying(g, me) && g.roles[me] === 'sleeper' && g.roles[id] === 'sleeper';
    main.append(chip(g.colors[id]), makeElement('span', 'nk-vote__name' + (mate ? ' nk-vote__name--mate' : ''), nameIn(g, id)));
    if (id === me) main.appendChild(makeElement('span', 'nk-tag nk-tag--me', 'あなた'));
    if (gone) main.appendChild(makeElement('span', 'nk-tag', '抜けた'));
    else if (!up) main.appendChild(makeElement('span', 'nk-tag', 'ねむっている'));
    if (m.votes[id]) main.appendChild(makeElement('span', 'nk-tag nk-tag--done', '投票ずみ'));
    if (!gone && !isBot(id) && !room.players?.[id]) main.appendChild(makeElement('span', 'nk-tag nk-tag--away', '通信が切れた'));
    if (latestSay[id]) main.appendChild(makeElement('span', 'nk-vote__say', '「' + latestSay[id] + '」'));
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
  renderMeetingSay(g, awake, saysNow);
  $('meetingCount').textContent = '投票 ' + Object.keys(m.votes).length + ' / ' + E.awakeOf(g).length;
  $('btnCloseVote').hidden = state.role !== 'host';
  updateMeetingTimer(g);
}

// 会議の「ひとこと」: 言葉のボタン（おきている人だけ）と、この会議の流れ（みんな）
function renderMeetingSay(g, awake, saysNow) {
  const me = state.nickname;
  const chips = $('meetingChips');
  const names = $('meetingNames');
  chips.replaceChildren();
  names.replaceChildren();
  chips.hidden = !awake;
  $('meetingSayLabel').hidden = !awake;
  if (awake) {
    E.SAYS.meeting.concat(E.SAYS.common).forEach((p) => {
      chips.appendChild(sayChip(g, p, async (q) => {
        if (!q.t.includes('{name}')) { state.sayPending = null; await doSay(q.k, ''); renderMeeting(g, state.room); return; }
        // 名前の入る言葉: 投票で選んでいる人がいればその人、いなければ人を選ぶ
        if (state.votePick && state.votePick !== me) { state.sayPending = null; await doSay(q.k, state.votePick); renderMeeting(g, state.room); return; }
        state.sayPending = state.sayPending === q.k ? null : q.k;
        renderMeeting(g, state.room);
      }));
    });
    if (state.sayPending) {
      chips.querySelectorAll('.nk-word').forEach((b) => b.classList.toggle('is-picked', b.dataset.say === state.sayPending));
      renderNamePicker(g, names, state.sayPending, async (key, id) => { state.sayPending = null; await doSay(key, id); renderMeeting(g, state.room); }, () => { state.sayPending = null; renderMeeting(g, state.room); });
    }
  }
  names.hidden = !awake || !state.sayPending;
  const log = $('meetingSays');
  log.replaceChildren();
  saysNow.slice(-E.SAY_LOG_MAX).forEach((e) => {
    const li = makeElement('li', 'nk-saylog__item');
    li.append(chip(g.colors[e.id]), makeElement('span', 'nk-saylog__name', nameIn(g, e.id)), makeElement('span', 'nk-saylog__text', e.text));
    log.appendChild(li);
  });
  log.hidden = !saysNow.length;
}

// 会議の残り時間: 大きく出し、10秒を切ったら色を変えて点滅（音は鳴らさない）。進み具合のバーも出す
function updateMeetingTimer(g) {
  if (!g || g.stage !== 'meeting') return;
  const left = Math.max(0, Math.ceil((g.meeting.endsAt - RoomkRTDB.now()) / 1000));
  setText('meetingTimer', 'のこり ' + left + ' 秒');
  const t = $('meetingTimer');
  t.classList.toggle('is-soon', left <= 10);
  t.classList.toggle('is-near', left > 10 && left <= 30);
  const total = Math.max(1, g.settings.meeting);
  $('meetingBar').style.width = Math.max(0, Math.min(100, (left / total) * 100)) + '%';
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
    air: '空気が止まったまま、' + E.AIR_LIMIT_S + '秒たった',
  }[g.winReason] || '';
  const ul = $('endPeople');
  ul.replaceChildren();
  g.players.forEach((id) => {
    const li = makeElement('li', 'nk-person');
    const sl = g.roles[id] === 'sleeper';
    li.append(chip(g.colors[id]), makeElement('span', 'nk-person__name', nameIn(g, id)), makeElement('span', 'nk-tag' + (sl ? ' nk-tag--sleeper' : ''), sl ? 'ねむらせ屋' : '隊員'));
    if (g.jobs[id]) li.appendChild(makeElement('span', 'nk-tag', E.JOB_NAMES[g.jobs[id]]));
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
  $('taskTitle').textContent = spotRoom(sp) + '：' + sp.label;
  $('ovTask').hidden = false;
  KEYS.clear();
  G.open($('taskBox'), sp.kind, async () => {
    if (state.taskSpot !== spotId || state.taskGen !== gen) return;
    closeTask();
    if (await doTask(state.nickname, spotId)) smallToast('仕事ができた！');
  });
}

// 空気のパネルをなおす: パネルの前で短いミニゲーム（1〜4を順に）をおえてから直る。2つとも直すと空気がもどる
function openAirFix(panel) {
  const g = gameOf(state.room);
  if (!g || !g.air || g.airFixed[panel]) return;
  const p = E.AIR_PANELS.find((q) => q.id === panel);
  state.taskSpot = panel === 'a' ? AIR_TASK_A : AIR_TASK_B;
  const spot = state.taskSpot;
  const gen = ++state.taskGen;
  $('taskTitle').textContent = E.roomName(p.room) + '：空気のパネルを入れなおす';
  $('ovTask').hidden = false;
  KEYS.clear();
  G.open($('taskBox'), 'order4', async () => {
    if (state.taskSpot !== spot || state.taskGen !== gen) return;
    closeTask();
    if (await gameAct(mut.airFix(state.nickname, panel))) {
      const now = gameOf(state.room);
      smallToast(now && now.air ? 'このパネルはなおった！ もう1つも' : '空気がもどった！');
    }
  });
}

// 停電をなおす: スイッチの前で短いミニゲーム（1〜8を順に）をおえてから直る。2026-10-28 子どもの意見「電気を直しにくく」（ねむらせ屋が有利になる向き）
function openFix() {
  const g = gameOf(state.room);
  if (!g || !g.dark) return;
  state.taskSpot = FIX_TASK;
  const gen = ++state.taskGen;
  $('taskTitle').textContent = E.fixRoomName() + '：スイッチを順に入れなおす';
  $('ovTask').hidden = false;
  KEYS.clear();
  G.open($('taskBox'), 'order', async () => {
    if (state.taskSpot !== FIX_TASK || state.taskGen !== gen) return;
    closeTask();
    if (await gameAct(mut.fix(state.nickname))) smallToast('電気がついた！');
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
let ctx = canvas.getContext('2d');   // 地図の重なる画面を描くときだけ、一時的に差しかえる（drawMapOverlay）
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

const blocked = () => !$('ovRole').hidden || !$('ovTask').hidden || !$('ovCam').hidden || !$('ovMap').hidden || !$('ovVitals').hidden || !$('ovMeeting').hidden || !$('ovResult').hidden || !$('ovEnd').hidden
  || !$('hostOffOverlay').hidden || $('menuDialog').open || !!ME.vent;

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
    if (g.stage !== 'play') ME.climb = null;
    // 近道の中: 会議・ねむらされたら出る。中にいられる時間がきたら、入った近道から出る（切れている間は出ない）
    if (ME.vent && (g.stage !== 'play' || !awake)) leaveVent(false);
    else if (ME.vent && state.isConnected && Date.now() >= ME.vent.until) leaveVent(true);
    if (ME.vent) renderVentBox();
    if (g.stage === 'play' && ME.climb) {
      // はしごを使っている途中: その場に立ったまま。時間がきたら、つながったはしごへ移る
      if (Date.now() >= ME.climb.until && state.isConnected) {   // 切れている間は、のぼりおりを終えない
        const to = E.LADDERS[ME.climb.to];
        ME.x = to.x;
        ME.y = to.y;
        ME.climb = null;
        sendPosFor(state.nickname, ME, awake, true);
      }
    } else if (g.stage === 'play' && !blocked() && state.isConnected) {
      // 切れている間は歩けない（つながりなおしたときに、ほかの人が見ていない間に動いた場所へ現れないように）
      const d = inputDir();
      if (d.x || d.y) {
        // ねむった人はかべ・ドアを通りぬける。おきている人は、とじているドアも通れない
        const n = awake ? E.step(ME, d.x, d.y, dt, closedNow(g)) : E.stepFree(ME, d.x, d.y, dt);
        if (d.x) ME.face = d.x > 0 ? 1 : -1;
        ME.x = n.x;
        ME.y = n.y;
      }
    }
    // 送るのは遊んでいる間だけ（会議・結果・おしまいの間は送らない）
    if (g.stage === 'play') sendPosFor(state.nickname, ME, awake, false);
    // ふたりの仕事のスイッチ: はなれたらやめる・書き直す・相手がそろったらおわる（位置は毎フレーム変わるので、ここで見る）
    if (g.stage === 'play') tendPair(g);
    else if (state.pairHold) pairRelease();
    [PA, PG].forEach((map) => Object.values(map).forEach((p) => {
      const k = Math.min(1, dt * 8);
      p.x += (p.tx - p.x) * k;
      p.y += (p.ty - p.y) * k;
    }));
    draw(g);
    drawMini(g);
    tickBattery(g, dt);
    if (state.camOpen) drawCams(g);
    if (state.mapOpen) drawMapOverlay(g);
    updateActions(g);
    updateClock(g);
    updateMeetingTimer(g);
    if (g.air) updateAirHud(g);
  } else if (g) {
    if (!miniBtn.hidden) miniBtn.hidden = true;
    if (!miniToggle.hidden) miniToggle.hidden = true;
    drawOverview(g);
    if (state.mapOpen) drawMapOverlay(g);
    updateClock(g);
    updateMeetingTimer(g);
    if (g.air) updateAirHud(g);
  }
  requestAnimationFrame(frame);
}

function drawPos(g, id) {
  if (id === state.nickname) return ME;
  if (BOTS[id]) return BOTS[id];
  const p = E.isAwake(g, id) ? PA[id] || null : PG[id] || null;
  return p && p.hidden ? null : p;   // 近道の中の人は、描かない・ねむらせられない・カメラに映らない
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
  // 家具（部屋の目印）・ドア
  drawFurniture(sx, sy, TS);
  drawDoors(g, sx, sy, TS);
  ctx.font = '700 ' + Math.round(TS * 0.42) + 'px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  // 部屋の名前（置き物の上でも読めるよう、床の色の下地をしく）
  E.ROOMS.forEach((r) => {
    if (r.part) return;
    const tw = ctx.measureText(r.name).width;
    ctx.fillStyle = r.fill;
    ctx.globalAlpha = 0.85;
    roundRect(sx(r.x) + TS * 0.12, sy(r.y) + TS * 0.1, tw + TS * 0.26, TS * 0.62, TS * 0.16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(28,63,94,0.7)';
    ctx.fillText(r.name, sx(r.x) + TS * 0.25, sy(r.y) + TS * 0.2);
  });

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
  // はしご（だれでも使える）・監視カメラ（通路。だれかが見ている間は赤いランプ）・カメラの台（監視室）
  E.LADDERS.forEach((l) => drawLadder(sx(l.x), sy(l.y), TS));
  const watched = camWatched(g);
  E.CAMS.forEach((c) => drawCam(sx(c.x), sy(c.y), TS, watched));
  drawCamStand(sx(E.CAM_STAND.x), sy(E.CAM_STAND.y), TS);

  // 仕事の場所
  const me = state.nickname;
  const role = g.roles[me];
  const mine = {};
  (g.tasks[me] || []).forEach((t) => { mine[t.spot] = role === 'crew' ? (t.done ? 'done' : 'todo') : 'fake'; });
  // 空気のパネル・ふたりの仕事のスイッチ
  E.AIR_PANELS.forEach((p) => drawAirPanel(sx(p.x), sy(p.y), TS, g.air ? (g.airFixed[p.id] ? 'fixed' : 'todo') : 'off'));
  const holders = pairHolders(g, RoomkRTDB.now());
  E.PAIRS.forEach((p) => {
    const st = mine[p.spot];
    // どちらかをだれかがおしていたら、2つとも光る（もう一方に来てほしい合図）
    const lit = !!(holders[p.id] && (holders[p.id].a || holders[p.id].b));
    ['a', 'b'].forEach((end) => drawPairSwitch(sx(p[end].x), sy(p[end].y), TS, lit, st === 'todo', st === 'done'));
    if (st === 'todo') {
      ctx.fillStyle = '#F5B700';
      ctx.font = '900 ' + Math.round(TS * 0.5) + 'px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ['a', 'b'].forEach((end) => ctx.fillText('!', sx(p[end].x), sy(p[end].y) - TS * 0.75));
    }
  });
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
  const now = RoomkRTDB.now();
  const shieldOn = g.jobs[me] === 'angel';   // バリアの光は、まもり星にだけ見える
  order.forEach((id) => {
    const pos = drawPos(g, id);
    if (!pos) return;
    const up = E.isAwake(g, id);
    if (!up && meAwake) return;          // おきている人には、ねむった人は見えない
    if (id !== me && !inView(pos)) return;
    const mate = role === 'sleeper' && g.roles[id] === 'sleeper';
    // へんしん中は、なっている人の色と名前で描く（自分にも、なっている人のすがたで見える）
    const look = up ? E.looksAs(g, id, now) : id;
    if (shieldOn && up && E.shielded(g, id, now)) drawShield(sx(pos.x), sy(pos.y));
    drawPerson(sx(pos.x), sy(pos.y), colorHex(g.colors[look]), pos.face || 1, up && !(id === me && ME.vent) ? 1 : 0.45, nameIn(g, look), mate);
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
    // 置き物はかべ扱いなので、多角形だと手前のふちしか明るくならない。見えている置き物は、その形の所の暗がりも抜く（2026-10-29 オーナー「置き物がわかりづらい」）
    fctx.fillStyle = 'rgba(0,0,0,1)';
    E.FURNITURE.forEach((f) => {
      if (!furnitureSeen(f, vr)) return;
      const up = FURNITURE_TALL.has((FURNITURE_STYLE[f.kind] || {}).deco) ? 0.3 : 0;   // 上にはみ出す形（画面・葉・あかり）
      fctx.fillRect(sx(f.x), sy(f.y) - TS * up, f.w * TS, (f.h + up) * TS);
    });
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fog, 0, 0);
    ctx.restore();
  }
}

// 置き物が見えているか: 見える広さの中で、置き物にとなり合う床のどこかが見えていればよい
function furnitureSeen(f, vr) {
  if (f.floor) return false;   // じゅうたんは床なので、多角形でそのまま明るくなる
  // 暗がりのぼかし（見える広さの7割から外）にかかる物は抜かない（暗がりの中に四角く明るい所ができないように）
  if (E.dist({ x: f.x + f.w / 2, y: f.y + f.h / 2 }, ME) > vr * 0.8) return false;
  for (let yy = f.y - 1; yy <= f.y + f.h; yy++) {
    for (let xx = f.x - 1; xx <= f.x + f.w; xx++) {
      if (!E.isFloor(xx, yy)) continue;
      const pt = { x: xx + 0.5, y: yy + 0.5 };
      if (E.dist(pt, ME) <= vr && E.canSee(ME, pt)) return true;
    }
  }
  return false;
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
  drawWholeMap(g, sx, sy, s, null);
}

// 地図ぜんたい（進行役の画面と、遊んでいる人の「地図」・小さな地図で共通）。mine を渡すと、自分の仕事の「!」と（x があれば）自分の位置も描く。
// small: 小さな地図（部屋の名前を書かず、「!」を小さく）
function drawWholeMap(g, sx, sy, s, mine, small) {
  ctx.fillStyle = '#2D3642';
  ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = E.HALL_FILL;
  E.HALLS.forEach((h) => ctx.fillRect(sx(h[0]), sy(h[1]), h[2] * s, h[3] * s));
  E.ROOMS.forEach((r) => { ctx.fillStyle = r.fill; ctx.fillRect(sx(r.x), sy(r.y), r.w * s, r.h * s); });
  drawFurniture(sx, sy, s);
  drawDoors(g, sx, sy, s);
  ctx.fillStyle = '#B98A5E';
  circle(sx(E.TABLE.x), sy(E.TABLE.y), E.TABLE.r * s);
  ctx.fillStyle = g.dark ? '#F5C518' : '#9AA3AD';
  roundRect(sx(E.FIX_SPOT.x) - s * 0.35, sy(E.FIX_SPOT.y) - s * 0.35, s * 0.7, s * 0.7, 4);
  E.SPOTS.forEach((sp) => { ctx.fillStyle = '#7B8794'; roundRect(sx(sp.x) - s * 0.32, sy(sp.y) - s * 0.32, s * 0.64, s * 0.64, 3); });
  E.AIR_PANELS.forEach((p) => drawAirPanel(sx(p.x), sy(p.y), s, g.air ? (g.airFixed[p.id] ? 'fixed' : 'todo') : 'off'));
  E.PAIRS.forEach((p) => ['a', 'b'].forEach((end) => drawPairSwitch(sx(p[end].x), sy(p[end].y), s, false, false, false)));
  E.VENTS.forEach((v) => drawVent(sx(v.x), sy(v.y), s));
  E.LADDERS.forEach((l) => drawLadder(sx(l.x), sy(l.y), s));
  E.CAMS.forEach((c) => drawCam(sx(c.x), sy(c.y), s, false));
  drawCamStand(sx(E.CAM_STAND.x), sy(E.CAM_STAND.y), s);
  ctx.font = '700 ' + Math.max(12, Math.round(s * 0.6)) + 'px "Noto Sans JP", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(28,63,94,0.8)';
  // テーブルのある部屋は、名前をテーブルの下にずらす
  const tableRoom = E.roomAt(E.TABLE.x, E.TABLE.y);
  // 名前は部屋のはばに入る大きさまで小さくする（細い部屋の名前どうしが重ならないように）
  const base = Math.max(12, Math.round(s * 0.6));
  if (!small) E.ROOMS.forEach((r) => {
    if (r.part) return;
    ctx.font = '700 ' + base + 'px "Noto Sans JP", sans-serif';
    const fit = Math.max(7, Math.floor(base * Math.min(1, (r.w * s * 0.92) / ctx.measureText(r.name).width)));
    ctx.font = '700 ' + fit + 'px "Noto Sans JP", sans-serif';
    ctx.fillText(r.name, sx(r.x + r.w / 2), sy(r.y + r.h / 2) + (r.key === tableRoom ? s * 3 : 0));
  });
  if (mine) {
    // 自分の仕事の「!」（おわっていないもの）と、自分の位置
    ctx.fillStyle = '#F5B700';
    ctx.font = '900 ' + (small ? 11 : Math.max(14, Math.round(s * 0.9))) + 'px "Noto Sans JP", sans-serif';
    mine.spots.forEach((pt) => ctx.fillText('!', sx(pt.x), sy(pt.y) - (small ? 2 : s * 0.9)));
  }
  if (mine && mine.x !== undefined) {
    ctx.fillStyle = colorHex(mine.color);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(sx(mine.x), sy(mine.y), Math.max(6, s * 0.55), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.font = '700 ' + Math.max(12, Math.round(s * 0.6)) + 'px "Noto Sans JP", sans-serif';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText('あなた', sx(mine.x), sy(mine.y) - s * 0.7);
    ctx.fillStyle = '#1A1A1A';
    ctx.fillText('あなた', sx(mine.x), sy(mine.y) - s * 0.7);
  }
  if (g.dark) { ctx.fillStyle = 'rgba(12,16,24,0.45)'; ctx.fillRect(0, 0, CW, CH); }
}

/* ── 地図（遊んでいる人。自分の位置と自分の仕事だけ。ほかの人は出ない） ── */
function openMap() {
  const g = gameOf(state.room);
  // 遊んでいる間は遊ぶ人だけ。会議・結果の間はだれでも（2026-10-29 子どもの要望「会議中にマップを確認したい」。会議の画面の上に重ねる）
  const talk = g && (g.stage === 'meeting' || g.stage === 'result');
  if (!g || !(talk || (g.stage === 'play' && isPlaying(g, state.nickname))) || state.mapOpen) return;
  state.mapOpen = true;
  state.sayOpen = false;
  state.sabOpen = false;
  renderSayBox(g);
  $('ovMap').hidden = false;
  KEYS.clear();
  drawMapOverlay(g);
}
function closeMap() {
  state.mapOpen = false;
  $('ovMap').hidden = true;
}
const mapCanvas = $('mapView');
const mctx = mapCanvas.getContext('2d');
function drawMapOverlay(g) {
  const w = Math.max(200, Math.floor(mapCanvas.getBoundingClientRect().width));
  const h = Math.round(w * (E.H / E.W));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (mapCanvas.width !== w * dpr || mapCanvas.height !== h * dpr) {
    mapCanvas.width = w * dpr;
    mapCanvas.height = h * dpr;
    mapCanvas.style.height = h + 'px';
  }
  mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = w / E.W;
  // 地図のキャンバスに、同じ描き方で描く（ctx を一時的に差しかえる）
  const saved = { ctx, CW, CH };
  ctx = mctx; CW = w; CH = h;
  // 遊ぶ人は自分の場所と自分の仕事。進行役・見学（会議中に見るとき）は地図だけ
  const mine = isPlaying(g, state.nickname) ? { x: ME.x, y: ME.y, color: g.colors[state.nickname], spots: mySpots(g) } : { spots: [] };
  drawWholeMap(g, (x) => x * s, (y) => y * s, s, mine);
  ctx = saved.ctx; CW = saved.CW; CH = saved.CH;
}
// 自分のおわっていない仕事の場所（隊員だけ。ふたりの仕事は2か所）
function mySpots(g) {
  const me = state.nickname;
  return (g.tasks[me] || []).filter((t) => !t.done && g.roles[me] === 'crew').flatMap((t) => {
    const sp = spotOf(t.spot);
    if (!sp) return [];
    if (sp.kind === 'pair') { const p = E.pairOf(sp.pair); return [p.a, p.b]; }
    return [sp];
  });
}

/* ── 小さな地図（2026-10-29 子どもの要望「地図が開けるように（迷子になる）」。右上にいつも出す。自分の位置と自分の仕事の「!」だけ。押すと大きな地図） ── */
const miniBtn = $('miniMap');
const miniCanvas = $('miniView');
const nctx = miniCanvas.getContext('2d');
const miniBase = document.createElement('canvas');   // 地図の部分（変わったときだけ描きなおす）
let miniKey = '';
// 小さな地図を出すか（2026-10-29 子どもの要望「MAPの表示を On/Off」→ それぞれの子が自分で。端末に覚えておく）
const MINI_KEY = 'nemurase_mini';
let miniOn = true;
try { miniOn = localStorage.getItem(MINI_KEY) !== '0'; } catch (e) { /* 使えない端末では出したまま */ }
const miniToggle = $('miniToggle');
function setMiniOn(on) {
  miniOn = on;
  try { localStorage.setItem(MINI_KEY, on ? '1' : '0'); } catch (e) { /* 覚えられなくても切りかえはする */ }
  miniToggle.setAttribute('aria-label', on ? '小さな地図をかくす' : '小さな地図を出す');
  miniToggle.title = on ? '小さな地図をかくす' : '小さな地図を出す';
  miniToggle.classList.toggle('is-off', !on);
  $('miniToggleIcon').textContent = on ? 'close' : 'map';
}
function drawMini(g) {
  const can = g.stage === 'play' && isPlaying(g, state.nickname) && !state.mapOpen && !state.camOpen;
  if (miniToggle.hidden === can) miniToggle.hidden = !can;
  const show = can && miniOn;
  if (miniBtn.hidden === show) miniBtn.hidden = !show;
  if (!show) return;
  const w = Math.max(80, Math.floor(miniCanvas.getBoundingClientRect().width));
  const h = Math.round(w * (E.H / E.W));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (miniCanvas.width !== w * dpr || miniCanvas.height !== h * dpr) {
    miniCanvas.width = w * dpr;
    miniCanvas.height = h * dpr;
    miniCanvas.style.height = h + 'px';
  }
  const s = w / E.W;
  const spots = mySpots(g);
  const key = [E.mapKey(), w, dpr, g.dark ? 1 : 0, E.closedRooms(g, RoomkRTDB.now()).join(','), g.air ? 'air' + Object.keys(g.airFixed).join('') : '',
    spots.map((p) => p.x + ':' + p.y).join(',')].join('|');
  if (key !== miniKey) {
    miniKey = key;
    miniBase.width = w * dpr;
    miniBase.height = h * dpr;
    const saved = { ctx, CW, CH };
    ctx = miniBase.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CW = w; CH = h;
    drawWholeMap(g, (x) => x * s, (y) => y * s, s, { spots }, true);
    ctx = saved.ctx; CW = saved.CW; CH = saved.CH;
  }
  nctx.setTransform(1, 0, 0, 1, 0, 0);
  nctx.drawImage(miniBase, 0, 0);
  nctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  nctx.fillStyle = colorHex(g.colors[state.nickname]);
  nctx.strokeStyle = '#fff';
  nctx.lineWidth = 2;
  nctx.beginPath();
  nctx.arc(ME.x * s, ME.y * s, Math.max(3.5, s * 1.1), 0, Math.PI * 2);
  nctx.fill();
  nctx.stroke();
}

// 置き物（部屋の目印）。2026-10-28 子どもの要望「象徴的なオブジェクト・装飾」。
// 2026-10-29 オーナー「置き物がわかりづらい。置き物感がほしい。仕事場とまちがえる」→ 色の四角＋アイコン（仕事の場所のパネルと同じ作り）をやめ、
// 床に影を落とす立体（上の面＋手前の面）に、種類ごとの形（コンロの火口・たるの輪・植木鉢など）を描く。仕事の場所は床の平らなパネルのまま
const FURNITURE_STYLE = {
  stove: { top: '#5A6069', deco: 'stove' },
  table: { top: '#C49563', deco: 'table' },
  antenna: { top: '#6B7480', deco: 'antenna' },
  desk: { top: '#A47C55', deco: 'monitor' },
  crops: { top: '#7A5636', deco: 'crops' },
  tank: { top: '#4A86E0', deco: 'cylinder' },
  sofa: { top: '#C9604F', deco: 'sofa' },
  plant: { top: '#A0653A', deco: 'plant' },
  generator: { top: '#6A717B', deco: 'generator' },
  barrel: { top: '#9A6634', deco: 'barrel' },
  crate: { top: '#C08A4A', deco: 'crate' },
  shelf: { top: '#7A5A36', deco: 'shelf' },
  light: { top: '#5B6470', deco: 'light' },
  bench: { top: '#9A6A3E', deco: 'bench' },
  // 2026-10-29 足した部屋（監視室・洗たく室・ポンプ室・ゲーム室）
  screen: { top: '#3A4452', deco: 'monitor' },
  washer: { top: '#EEF2F5', deco: 'washer' },
  basket: { top: '#D2AE72', deco: 'basket' },
  pump: { top: '#5C7D9C', deco: 'pump' },
  arcade: { top: '#7A4BB3', deco: 'arcade' },
  gametable: { top: '#8C5A33', deco: 'gametable' },
  // 2026-10-29 夕 子どもの要望「部屋の内装を部屋の名前に合わせて」で足した物
  fridge: { top: '#E8EEF2', deco: 'fridge' },
  sink: { top: '#B9C4CC', deco: 'sink' },
  radioset: { top: '#5A6069', deco: 'radioset' },
  scarecrow: { top: '#7A5A36', deco: 'scarecrow' },
  chest: { top: '#A0652E', deco: 'chest' },
  treadmill: { top: '#6A717B', deco: 'treadmill' },
  weights: { top: '#7A818A', deco: 'weights' },
  mat: { top: '#5DB2A2', deco: 'mat' },
  battery: { top: '#3D4A57', deco: 'battery' },
  cart: { top: '#D9433B', deco: 'cart' },
  tire: { top: '#22272E', deco: 'tire' },
  toolbox: { top: '#C9302C', deco: 'toolbox' },
  shower: { top: '#CFE3EC', deco: 'shower' },
  telescope: { top: '#4B5563', deco: 'telescope' },
  // 2026-10-29 パーク
  swing: { top: '#8C5A33', deco: 'swing' },
  statue: { top: '#8A8F99', deco: 'statue' },
  bear: { top: '#F2A0B8', deco: 'bear' },
  campfire: { top: '#7A5A36', deco: 'campfire' },
  log: { top: '#A0703E', deco: 'log' },
  tree: { top: '#7A5A36', deco: 'tree' },
  board: { top: '#C9A46A', deco: 'board' },
  flower: { top: '#3E8E48', deco: 'flower' },
  pond: { top: '#4FA8D6', deco: 'pond' },
  frame: { top: '#8C5A33', deco: 'frame' },
  piano: { top: '#2A2E34', deco: 'piano' },
  stool: { top: '#F28C28', deco: 'stool' },
};
const FURNITURE_TALL = new Set(['monitor', 'plant', 'light', 'antenna', 'arcade', 'scarecrow', 'telescope', 'radioset', 'treadmill', 'toolbox', 'swing', 'statue', 'bear', 'campfire', 'tree', 'board', 'flower', 'frame']);
// 色を明るく（amt > 0）・暗く（amt < 0）する
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt)));
  return 'rgb(' + f(n >> 16) + ',' + f((n >> 8) & 255) + ',' + f(n & 255) + ')';
}
function furnRect(x, y, w, h, r, fill, stroke) {
  ctx.fillStyle = fill;
  roundRect(x, y, w, h, r);
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, r * 0.35); ctx.stroke(); }
}
function furnCircle(x, y, r, fill, stroke, lw) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.5; ctx.stroke(); }
}
function furnLine(pts, color, lw) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
}
// まるい物（たる・タンク・ポンプ）: 胴と上の楕円
function furnCylinder(cx, top, bottom, rx, color) {
  const ry = rx * 0.38;
  ctx.fillStyle = shade(color, -0.3);
  ctx.beginPath();
  ctx.ellipse(cx, bottom, rx, ry, 0, 0, Math.PI);
  ctx.lineTo(cx - rx, top);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(color, -0.12);
  ctx.fillRect(cx - rx, top, rx * 2, bottom - top);
  ctx.fillStyle = shade(color, 0.18);
  ctx.beginPath();
  ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = shade(color, -0.45);
  ctx.lineWidth = Math.max(1, rx * 0.08);
  ctx.stroke();
  return ry;
}

function drawFurniture(sx, sy, size) {
  ctx.save();
  const detail = size >= 14;   // 小さな地図・進行役の地図では形だけ
  // じゅうたん（floor: true。歩ける床の飾り）は先に平らに描く
  E.FURNITURE.forEach((f) => {
    if (!f.floor) return;
    ctx.fillStyle = f.color || '#C9473C';
    ctx.globalAlpha = 0.85;
    roundRect(sx(f.x) + size * 0.1, sy(f.y) + size * 0.1, f.w * size - size * 0.2, f.h * size - size * 0.2, Math.max(2, size * 0.2));
    ctx.globalAlpha = 1;
    if (f.label && detail) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.font = '700 ' + Math.round(size * 0.36) + 'px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(f.label, sx(f.x + f.w / 2), sy(f.y) + size * 0.25);
    }
  });
  E.FURNITURE.forEach((f) => {
    if (f.floor) return;
    const st = FURNITURE_STYLE[f.kind] || FURNITURE_STYLE.crate;
    const x = sx(f.x);
    const y = sy(f.y);
    const w = f.w * size;
    const h = f.h * size;
    const p = size * 0.08;               // まわりのすき間
    const d = detail ? size * 0.22 : size * 0.16;   // 手前の面の高さ（立体に見せる）
    const r = Math.max(1.5, size * 0.1);
    const round = ['cylinder', 'barrel', 'pump', 'plant', 'light', 'antenna', 'scarecrow', 'tire', 'telescope', 'bear', 'campfire', 'tree', 'flower', 'stool', 'statue', 'swing', 'pond'].includes(st.deco);
    // 床に落ちる影（少し右下）
    ctx.fillStyle = 'rgba(20,24,30,0.28)';
    if (round) {
      ctx.beginPath();
      ctx.ellipse(x + w / 2 + size * 0.06, y + h - p - size * 0.04, w / 2 - p * 0.5, size * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      roundRect(x + p + size * 0.08, y + p + size * 0.12, w - p * 2, h - p * 2, r);
    }
    if (!round) {
      // 手前の面（暗い）と上の面（明るい）
      furnRect(x + p, y + p + d, w - p * 2, h - p * 2 - d, r, shade(st.top, -0.38));
      furnRect(x + p, y + p, w - p * 2, h - p * 2 - d, r, st.top, shade(st.top, -0.5));
      ctx.fillStyle = 'rgba(255,255,255,0.22)';   // 上の面のふちの光
      ctx.fillRect(x + p + r, y + p + 1, w - p * 2 - r * 2, Math.max(1, size * 0.04));
    }
    if (!detail && !round) return;
    const tx = x + p;
    const ty = y + p;
    const tw = w - p * 2;
    const th = h - p * 2 - d;
    const cx = x + w / 2;
    const s = size;
    switch (st.deco) {
      case 'stove':
        for (let i = 0; i < 2; i++) {
          const bx = tx + tw * (i ? 0.72 : 0.28);
          furnCircle(bx, ty + th / 2, Math.min(th, tw / 2) * 0.32, '#2A2E34', '#E8692C', Math.max(1.5, s * 0.06));
        }
        for (let i = 0; i < 3; i++) furnCircle(tx + tw * (0.3 + i * 0.2), ty + th + d * 0.5, Math.max(1, s * 0.04), '#F5C518');
        break;
      case 'table':
        ctx.strokeStyle = shade(st.top, -0.25); ctx.lineWidth = 1;
        furnLine([[tx + tw * 0.15, ty + th * 0.35], [tx + tw * 0.85, ty + th * 0.35]], shade(st.top, -0.2), 1);
        furnCircle(cx, ty + th * 0.6, Math.min(tw, th) * 0.22, '#FFFFFF', '#D8D2C6', 1);
        break;
      case 'monitor': {
        // 机の上にたつ画面（上の面より上に出して、高さを見せる）
        const n = Math.max(1, Math.round(f.w));
        for (let i = 0; i < n; i++) {
          const mw = (tw / n) * 0.72;
          const mx = tx + (tw / n) * i + ((tw / n) - mw) / 2;
          furnRect(mx, ty - s * 0.22, mw, th * 0.85, Math.max(1, s * 0.05), '#22272E');
          ctx.fillStyle = '#7FC8F0';
          ctx.fillRect(mx + s * 0.05, ty - s * 0.17, mw - s * 0.1, th * 0.85 - s * 0.12);
        }
        break;
      }
      case 'crops':
        furnLine([[tx + s * 0.1, ty + th * 0.5], [tx + tw - s * 0.1, ty + th * 0.5]], shade(st.top, -0.35), Math.max(1, s * 0.05));
        for (let i = 0; i < f.w * 2; i++) {
          const lx = tx + (tw / (f.w * 2)) * (i + 0.5);
          ctx.fillStyle = i % 2 ? '#5DB25F' : '#7BCB6A';
          ctx.beginPath(); ctx.ellipse(lx - s * 0.06, ty + th * 0.35, s * 0.09, s * 0.16, -0.6, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(lx + s * 0.06, ty + th * 0.35, s * 0.09, s * 0.16, 0.6, 0, Math.PI * 2); ctx.fill();
        }
        break;
      case 'cylinder': {
        const ry = furnCylinder(cx, y + p + s * 0.12, y + h - p - s * 0.12, tw * 0.4, st.top);
        if (detail) furnLine([[cx - tw * 0.22, y + p + s * 0.12 + ry * 1.6], [cx - tw * 0.22, y + h - p - s * 0.24]], 'rgba(255,255,255,0.5)', Math.max(1, s * 0.06));
        break;
      }
      case 'barrel': {
        const top = y + p + s * 0.08;
        const bottom = y + h - p - s * 0.1;
        furnCylinder(cx, top, bottom, tw * 0.38, st.top);
        if (detail) [0.42, 0.75].forEach((k) => furnLine([[cx - tw * 0.38, top + (bottom - top) * k], [cx + tw * 0.38, top + (bottom - top) * k]], '#4A2E12', Math.max(1, s * 0.06)));
        break;
      }
      case 'pump': {
        const top = y + p + s * 0.12;
        const bottom = y + h - p - s * 0.1;
        furnCylinder(tx + tw * 0.32, top, bottom, tw * 0.22, st.top);
        if (detail) {
          furnLine([[tx + tw * 0.5, top + s * 0.25], [tx + tw * 0.92, top + s * 0.25], [tx + tw * 0.92, bottom]], '#8FA6BC', Math.max(2, s * 0.1));
          furnCircle(tx + tw * 0.75, top + s * 0.08, s * 0.13, '#FFFFFF', '#2D3642', 1.5);
          furnLine([[tx + tw * 0.75, top + s * 0.08], [tx + tw * 0.8, top - s * 0.01]], '#C9302C', 1.5);
        }
        break;
      }
      case 'sofa':
        furnRect(tx, ty, tw, th * 0.38, Math.max(1, s * 0.08), shade(st.top, -0.18));        // 背もたれ
        furnRect(tx + s * 0.08, ty + th * 0.42, tw / 2 - s * 0.1, th * 0.5, Math.max(1, s * 0.06), shade(st.top, 0.12));
        furnRect(tx + tw / 2 + s * 0.02, ty + th * 0.42, tw / 2 - s * 0.1, th * 0.5, Math.max(1, s * 0.06), shade(st.top, 0.12));
        break;
      case 'plant': {
        // 植木鉢と葉っぱ（葉は上にはみ出して、高さを見せる）
        const potTop = y + h * 0.55;
        ctx.fillStyle = st.top;
        ctx.beginPath();
        ctx.moveTo(cx - tw * 0.32, potTop); ctx.lineTo(cx + tw * 0.32, potTop);
        ctx.lineTo(cx + tw * 0.22, y + h - p); ctx.lineTo(cx - tw * 0.22, y + h - p);
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = shade(st.top, -0.3);
        ctx.fillRect(cx - tw * 0.34, potTop - s * 0.05, tw * 0.68, s * 0.08);
        [[-0.2, 0.32, 0.24], [0.2, 0.32, 0.24], [0, 0.16, 0.27], [0, 0.4, 0.2]].forEach(([dx, dy, rr], i) => furnCircle(cx + dx * s, y + dy * s, rr * s, i % 2 ? '#4FA857' : '#6CC070'));
        break;
      }
      case 'generator':
        ctx.fillStyle = '#F5C518';
        ctx.fillRect(tx + s * 0.06, ty + th * 0.36, tw - s * 0.12, th * 0.28);
        for (let i = 0; i < f.w * 3; i++) {
          const gx = tx + s * 0.06 + ((tw - s * 0.12) / (f.w * 3)) * i;
          ctx.fillStyle = '#2A2E34';
          ctx.beginPath(); ctx.moveTo(gx, ty + th * 0.64); ctx.lineTo(gx + s * 0.1, ty + th * 0.36); ctx.lineTo(gx + s * 0.17, ty + th * 0.36); ctx.lineTo(gx + s * 0.07, ty + th * 0.64); ctx.fill();
        }
        break;
      case 'crate':
        ctx.strokeStyle = shade(st.top, -0.42);
        ctx.lineWidth = Math.max(1.5, s * 0.06);
        ctx.strokeRect(tx + s * 0.08, ty + s * 0.06, tw - s * 0.16, th - s * 0.12);
        furnLine([[tx + s * 0.08, ty + s * 0.06], [tx + tw - s * 0.08, ty + th - s * 0.06]], shade(st.top, -0.42), Math.max(1.5, s * 0.06));
        break;
      case 'shelf':
        [0.33, 0.66].forEach((k) => furnLine([[tx + s * 0.06, ty + th * k], [tx + tw - s * 0.06, ty + th * k]], shade(st.top, -0.5), Math.max(1, s * 0.05)));
        ['#D9433B', '#2F6FD6', '#E8B820', '#2E9A4A'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(tx + s * 0.12 + i * tw * 0.18, ty + th * 0.08, tw * 0.12, th * 0.22); });
        break;
      case 'light':
        furnLine([[cx, y + h - p - s * 0.05], [cx, y + p + s * 0.2]], '#3A424D', Math.max(2, s * 0.08));
        if (detail) { ctx.fillStyle = 'rgba(245,197,24,0.25)'; ctx.beginPath(); ctx.arc(cx, y + p + s * 0.18, s * 0.38, 0, Math.PI * 2); ctx.fill(); }
        furnCircle(cx, y + p + s * 0.18, s * 0.16, '#F5C518', '#8A6D00', 1);
        break;
      case 'antenna':
        furnRect(cx - tw * 0.3, y + h - p - s * 0.28, tw * 0.6, s * 0.22, Math.max(1, s * 0.05), '#4B5563');
        furnLine([[cx, y + h - p - s * 0.26], [cx, y + p + s * 0.08]], '#9AA3AD', Math.max(1.5, s * 0.06));
        ctx.strokeStyle = '#9FD3E8'; ctx.lineWidth = Math.max(1.5, s * 0.06);
        ctx.beginPath(); ctx.arc(cx, y + p + s * 0.22, s * 0.22, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke();
        break;
      case 'bench':
        [0.3, 0.62].forEach((k) => furnLine([[tx + s * 0.06, ty + th * k], [tx + tw - s * 0.06, ty + th * k]], shade(st.top, -0.35), Math.max(1, s * 0.05)));
        break;
      case 'washer':
        ctx.fillStyle = '#C8D2DA';
        ctx.fillRect(tx + s * 0.06, ty + s * 0.05, tw - s * 0.12, th * 0.18);
        for (let i = 0; i < Math.max(1, Math.round(f.w)); i++) furnCircle(tx + (tw / f.w) * (i + 0.5), ty + th * 0.6, Math.min(th, tw / f.w) * 0.3, '#5AA9E6', '#7B8794', Math.max(1.5, s * 0.06));
        break;
      case 'basket':
        ctx.strokeStyle = shade(st.top, -0.35); ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) furnLine([[tx + (tw / 4) * i, ty + s * 0.05], [tx + (tw / 4) * i, ty + th - s * 0.03]], shade(st.top, -0.3), 1);
        furnCircle(cx - s * 0.08, ty + th * 0.3, s * 0.13, '#E86FA8');
        furnCircle(cx + s * 0.1, ty + th * 0.3, s * 0.12, '#2BB3C6');
        break;
      case 'arcade':
        furnRect(tx + s * 0.08, ty - s * 0.2, tw - s * 0.16, th * 0.7, Math.max(1, s * 0.05), '#22272E');
        ctx.fillStyle = '#2BB3C6';
        ctx.fillRect(tx + s * 0.14, ty - s * 0.15, tw - s * 0.28, th * 0.7 - s * 0.12);
        furnCircle(tx + tw * 0.3, ty + th * 0.75, s * 0.07, '#D9433B');
        furnCircle(tx + tw * 0.62, ty + th * 0.75, s * 0.06, '#F5C518');
        furnCircle(tx + tw * 0.75, ty + th * 0.75, s * 0.06, '#2E9A4A');
        break;
      case 'gametable':
        furnRect(tx + s * 0.08, ty + s * 0.07, tw - s * 0.16, th - s * 0.14, Math.max(1, s * 0.05), '#2E7D4F');
        ['#FFFFFF', '#D9433B', '#E8B820'].forEach((c, i) => furnCircle(tx + tw * (0.3 + i * 0.18), ty + th * (i % 2 ? 0.38 : 0.6), s * 0.06, c));
        break;
      case 'fridge':
        furnLine([[tx + s * 0.08, ty + th * 0.42], [tx + tw - s * 0.08, ty + th * 0.42]], shade(st.top, -0.35), Math.max(1, s * 0.05));
        ctx.fillStyle = '#7B8794';
        ctx.fillRect(tx + tw - s * 0.2, ty + th * 0.12, s * 0.06, th * 0.22);
        ctx.fillRect(tx + tw - s * 0.2, ty + th * 0.52, s * 0.06, th * 0.3);
        break;
      case 'sink':
        furnRect(tx + tw * 0.18, ty + th * 0.18, tw * 0.64, th * 0.62, Math.max(1, s * 0.1), '#7FB8DA', '#8A97A3');
        furnCircle(tx + tw / 2, ty + th * 0.12, s * 0.07, '#5B6470');
        break;
      case 'radioset':
        furnLine([[tx + tw * 0.8, ty + th * 0.2], [tx + tw * 0.9, ty - s * 0.3]], '#9AA3AD', Math.max(1, s * 0.05));
        for (let i = 0; i < 3; i++) furnLine([[tx + tw * 0.12, ty + th * (0.28 + i * 0.2)], [tx + tw * 0.45, ty + th * (0.28 + i * 0.2)]], '#2A2E34', Math.max(1, s * 0.05));
        furnCircle(tx + tw * 0.68, ty + th * 0.5, Math.min(th, tw) * 0.24, '#F5C518', '#8A6D00', 1);
        break;
      case 'scarecrow': {
        // かかし（棒・うで・顔・むぎわらぼうし）。上にはみ出して高さを見せる
        furnLine([[cx, y + h - p], [cx, y + p - s * 0.05]], '#7A5A36', Math.max(2, s * 0.08));
        furnLine([[cx - s * 0.32, y + p + s * 0.32], [cx + s * 0.32, y + p + s * 0.32]], '#7A5A36', Math.max(2, s * 0.07));
        furnCircle(cx, y + p + s * 0.08, s * 0.14, '#F3E2C7', '#8C5A33', 1);
        ctx.fillStyle = '#E8B820';
        ctx.beginPath(); ctx.ellipse(cx, y + p - s * 0.04, s * 0.24, s * 0.07, 0, 0, Math.PI * 2); ctx.fill();
        break;
      }
      case 'chest':
        ctx.fillStyle = shade(st.top, -0.3);
        ctx.fillRect(tx, ty + th * 0.38, tw, th * 0.16);
        furnRect(tx + tw / 2 - s * 0.09, ty + th * 0.3, s * 0.18, th * 0.34, Math.max(1, s * 0.03), '#F5C518');
        break;
      case 'treadmill':
        furnRect(tx + s * 0.16, ty + th * 0.18, tw - s * 0.24, th * 0.64, Math.max(1, s * 0.05), '#2A2E34');
        for (let i = 1; i < 4; i++) furnLine([[tx + s * 0.16 + (tw - s * 0.24) * (i / 4), ty + th * 0.22], [tx + s * 0.16 + (tw - s * 0.24) * (i / 4), ty + th * 0.78]], '#4A4F57', 1);
        furnRect(tx + s * 0.02, ty - s * 0.12, s * 0.12, th * 0.9, Math.max(1, s * 0.03), '#9AA3AD');
        break;
      case 'weights':
        for (let i = 0; i < 2; i++) {
          const wy = ty + th * (0.3 + i * 0.4);
          furnLine([[tx + tw * 0.2, wy], [tx + tw * 0.8, wy]], '#9AA3AD', Math.max(1.5, s * 0.06));
          furnCircle(tx + tw * 0.2, wy, s * 0.11, '#2A2E34');
          furnCircle(tx + tw * 0.8, wy, s * 0.11, '#2A2E34');
        }
        break;
      case 'mat':
        ctx.strokeStyle = shade(st.top, 0.35); ctx.lineWidth = Math.max(1, s * 0.04);
        ctx.strokeRect(tx + s * 0.1, ty + s * 0.08, tw - s * 0.2, th - s * 0.16);
        break;
      case 'battery':
        for (let i = 0; i < 2; i++) {
          const by = ty + th * (0.08 + i * 0.48);
          furnRect(tx + tw * 0.18, by, tw * 0.64, th * 0.4, Math.max(1, s * 0.04), '#2E9A4A', '#1F6B33');
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(tx + tw * 0.44, by + th * 0.12, tw * 0.12, th * 0.04);
          ctx.fillRect(tx + tw * 0.48, by + th * 0.08, tw * 0.04, th * 0.12);
        }
        break;
      case 'cart':
        furnRect(tx + tw * 0.55, ty + th * 0.15, tw * 0.3, th * 0.55, Math.max(1, s * 0.05), '#9FD3E8');   // 前のまど
        [0.2, 0.8].forEach((k) => furnCircle(tx + tw * k, y + h - p - d * 0.4, s * 0.16, '#22272E', '#9AA3AD', 1));
        break;
      case 'tire': {
        const ty0 = y + h / 2;
        furnCircle(cx, ty0, tw * 0.4, '#22272E', '#4A4F57', Math.max(1.5, s * 0.08));
        furnCircle(cx, ty0, tw * 0.16, '#9AA3AD');
        break;
      }
      case 'toolbox':
        furnLine([[tx + tw * 0.3, ty + th * 0.15], [tx + tw * 0.3, ty - s * 0.06], [tx + tw * 0.7, ty - s * 0.06], [tx + tw * 0.7, ty + th * 0.15]], '#2A2E34', Math.max(1.5, s * 0.06));
        ctx.fillStyle = '#F5C518';
        ctx.fillRect(tx + tw * 0.42, ty + th * 0.45, tw * 0.16, th * 0.2);
        break;
      case 'shower':
        furnCircle(tx + tw * 0.5, ty + th * 0.25, s * 0.14, '#9AA3AD', '#5B6470', 1);
        for (let i = 0; i < 5; i++) furnCircle(tx + tw * (0.3 + i * 0.1), ty + th * (0.55 + (i % 2) * 0.15), s * 0.035, '#4A86E0');
        furnCircle(tx + tw * 0.85, ty + th * 0.8, s * 0.05, '#5B6470');
        break;
      case 'telescope': {
        // 望遠鏡（三脚と、ななめの筒）
        const by = y + h - p;
        furnLine([[cx, y + h * 0.5], [cx - s * 0.25, by]], '#4B5563', Math.max(1.5, s * 0.05));
        furnLine([[cx, y + h * 0.5], [cx + s * 0.25, by]], '#4B5563', Math.max(1.5, s * 0.05));
        furnLine([[cx - s * 0.32, y + p + s * 0.36], [cx + s * 0.3, y + p - s * 0.05]], '#2F6FD6', Math.max(3, s * 0.16));
        furnCircle(cx + s * 0.3, y + p - s * 0.05, s * 0.09, '#9FD3E8');
        break;
      }
      case 'swing':
        // ブランコ（わくと、つるした2つの席）
        furnLine([[tx, ty - s * 0.25], [tx + tw, ty - s * 0.25]], '#8C5A33', Math.max(2, s * 0.08));
        [0.3, 0.7].forEach((k) => {
          furnLine([[tx + tw * k, ty - s * 0.25], [tx + tw * k, ty + th * 0.55]], '#5B6470', 1);
          furnRect(tx + tw * k - s * 0.14, ty + th * 0.5, s * 0.28, s * 0.1, 1, '#D9433B');
        });
        break;
      case 'statue':
        // 石の像（大きな顔）
        furnRect(tx + tw * 0.2, ty - s * 0.25, tw * 0.6, th + s * 0.15, Math.max(2, s * 0.12), '#8A8F99', '#5B6470');
        ctx.fillStyle = '#5B6470';
        ctx.fillRect(tx + tw * 0.3, ty + th * 0.05, tw * 0.4, s * 0.06);
        ctx.fillRect(tx + tw * 0.44, ty + th * 0.2, tw * 0.12, th * 0.35);
        break;
      case 'bear': {
        // くまのぬいぐるみ
        const bc = f.x % 2 ? '#F2A0B8' : '#F5D04A';
        furnCircle(cx, ty + th * 0.55, s * 0.26, bc, shade(bc, -0.3), 1);
        furnCircle(cx, ty + th * 0.05, s * 0.2, bc);
        furnCircle(cx - s * 0.14, ty - s * 0.1, s * 0.08, bc);
        furnCircle(cx + s * 0.14, ty - s * 0.1, s * 0.08, bc);
        furnCircle(cx - s * 0.06, ty + th * 0.02, s * 0.025, '#2A2E34');
        furnCircle(cx + s * 0.06, ty + th * 0.02, s * 0.025, '#2A2E34');
        break;
      }
      case 'campfire':
        [-0.2, 0.2].forEach((k) => furnLine([[cx - s * 0.3, ty + th * (0.6 + k)], [cx + s * 0.3, ty + th * (0.6 - k)]], '#7A5A36', Math.max(2, s * 0.08)));
        ctx.fillStyle = '#F28C28';
        ctx.beginPath(); ctx.moveTo(cx - s * 0.18, ty + th * 0.6); ctx.quadraticCurveTo(cx, ty - s * 0.35, cx + s * 0.18, ty + th * 0.6); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#F5C518';
        ctx.beginPath(); ctx.moveTo(cx - s * 0.09, ty + th * 0.6); ctx.quadraticCurveTo(cx, ty - s * 0.05, cx + s * 0.09, ty + th * 0.6); ctx.closePath(); ctx.fill();
        break;
      case 'log':
        for (let i = 1; i < 3; i++) furnLine([[tx + tw * 0.2, ty + (th / 3) * i], [tx + tw * 0.8, ty + (th / 3) * i]], shade(st.top, -0.35), 1);
        furnCircle(cx, ty + th * 0.15, Math.min(tw, s) * 0.22, '#D9B07A', '#7A5A36', 1);
        break;
      case 'tree': {
        furnLine([[cx, y + h - p], [cx, y + p + s * 0.2]], '#7A5A36', Math.max(2, s * 0.1));
        [[0, 0.05, 0.3], [-0.2, 0.25, 0.22], [0.2, 0.25, 0.22]].forEach(([dx, dy, rr], i) => furnCircle(cx + dx * s, y + p + dy * s, rr * s, i ? '#4FA857' : '#3E8E48'));
        break;
      }
      case 'board':
        // けいじ板（コルクの板と紙）
        furnRect(tx + s * 0.06, ty - s * 0.2, tw - s * 0.12, th + s * 0.1, Math.max(1, s * 0.04), '#C9A46A', '#7A5A36');
        ['#FFFFFF', '#F5D04A', '#9FD3E8'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(tx + s * 0.16 + i * tw * 0.28, ty - s * 0.1, tw * 0.2, th * 0.55); });
        break;
      case 'flower':
        furnLine([[cx, y + h - p], [cx, y + p + s * 0.25]], '#3E8E48', Math.max(1.5, s * 0.06));
        for (let i = 0; i < 6; i++) { const a = (Math.PI * 2 * i) / 6; furnCircle(cx + Math.cos(a) * s * 0.16, y + p + s * 0.2 + Math.sin(a) * s * 0.16, s * 0.1, '#F5C518'); }
        furnCircle(cx, y + p + s * 0.2, s * 0.1, '#7A5A36');
        break;
      case 'pond':
        // 池（水。歩けない）
        furnRect(tx, ty, tw, th + d, Math.max(2, s * 0.3), '#4FA8D6');
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = Math.max(1, s * 0.04);
        for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(tx + tw * (0.25 + i * 0.25), ty + th * (0.4 + (i % 2) * 0.3), s * 0.18, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
        break;
      case 'frame':
        furnRect(tx + s * 0.08, ty - s * 0.15, tw - s * 0.16, th + s * 0.05, Math.max(1, s * 0.03), '#F7F1E1', '#8C5A33');
        ctx.fillStyle = f.x % 2 ? '#9FD3E8' : '#F2A0B8';
        ctx.fillRect(tx + s * 0.18, ty - s * 0.05, tw - s * 0.36, th - s * 0.15);
        break;
      case 'piano':
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(tx + s * 0.08, ty + th * 0.55, tw - s * 0.16, th * 0.35);
        ctx.fillStyle = '#22272E';
        for (let i = 0; i < Math.round(tw / (s * 0.18)); i++) if (i % 3 !== 2) ctx.fillRect(tx + s * 0.14 + i * s * 0.18, ty + th * 0.55, s * 0.08, th * 0.2);
        break;
      case 'stool':
        furnCircle(cx, y + h / 2, s * 0.3, '#F28C28', '#8A5A2B', Math.max(1, s * 0.05));
        break;
      default:
        break;
    }
  });
  ctx.restore();
}

// ドア: ふだんは入口に細いわく（どこがドアか分かるように）。とじている間は板でふさぐ
function drawDoors(g, sx, sy, size) {
  const closed = new Set(E.closedRooms(g, RoomkRTDB.now()));
  ctx.save();
  E.DOORS.forEach((d) => {
    const x = sx(d.x);
    const y = sy(d.y);
    const w = d.w * size;
    const h = d.h * size;
    if (closed.has(d.room)) {
      ctx.fillStyle = '#6B4E2E';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, size * 0.06);
      ctx.beginPath();
      if (w >= h) { for (let i = 1; i < 3; i++) { ctx.moveTo(x, y + (h * i) / 3); ctx.lineTo(x + w, y + (h * i) / 3); } }
      else { for (let i = 1; i < 3; i++) { ctx.moveTo(x + (w * i) / 3, y); ctx.lineTo(x + (w * i) / 3, y + h); } }
      ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(107,78,46,0.45)';
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.setLineDash([size * 0.25, size * 0.2]);
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      ctx.setLineDash([]);
    }
  });
  ctx.restore();
}

// 空気のパネル: off＝ふだん（うすい）、todo＝止まっていてなおす（点滅）、fixed＝なおした（みどり）
function drawAirPanel(x, y, size, st) {
  ctx.save();
  const blink = st === 'todo' && Math.floor(Date.now() / 400) % 2 === 0;
  ctx.fillStyle = st === 'fixed' ? '#2E9A4A' : blink ? '#FF6B5B' : '#2BB3C6';
  roundRect(x - size * 0.36, y - size * 0.36, size * 0.72, size * 0.72, 6);
  ctx.fillStyle = '#fff';
  ctx.font = Math.round(size * 0.5) + 'px "Material Symbols Rounded"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(st === 'fixed' ? 'check' : 'air', x, y);
  if (st === 'todo') {
    ctx.strokeStyle = '#FF6B5B';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - size * 0.46, y - size * 0.46, size * 0.92, size * 0.92);
  }
  ctx.restore();
}

// ふたりの仕事のスイッチ: held＝だれかがおしている（光る）、todo＝自分の仕事（黄色いわく）、done＝おわった（みどりのわく）
function drawPairSwitch(x, y, size, held, todo, done) {
  ctx.save();
  ctx.fillStyle = '#5B6470';
  roundRect(x - size * 0.34, y - size * 0.34, size * 0.68, size * 0.68, 6);
  ctx.fillStyle = held ? '#F5C518' : '#C8D3DC';
  roundRect(x - size * 0.22, y - size * 0.26, size * 0.44, size * 0.52, 4);
  ctx.fillStyle = held ? '#3B2A17' : '#4B5563';
  ctx.font = Math.round(size * 0.42) + 'px "Material Symbols Rounded"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('group', x, y);
  if (held) {
    ctx.strokeStyle = 'rgba(245,197,24,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, size * 0.55 + (Math.floor(Date.now() / 300) % 2) * 2, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (todo || done) {
    ctx.strokeStyle = done ? '#2E9A4A' : '#F5B700';
    ctx.lineWidth = 3;
    ctx.strokeRect(x - size * 0.44, y - size * 0.44, size * 0.88, size * 0.88);
  }
  ctx.restore();
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

// はしご: 2本のレールと3本の足場
function drawLadder(x, y, size) {
  const w = size * 0.5;
  const h = size * 0.8;
  ctx.save();
  ctx.strokeStyle = '#8C5A33';
  ctx.lineWidth = Math.max(2, size * 0.09);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y - h / 2); ctx.lineTo(x - w / 2, y + h / 2);
  ctx.moveTo(x + w / 2, y - h / 2); ctx.lineTo(x + w / 2, y + h / 2);
  for (let i = -1; i <= 1; i++) { ctx.moveTo(x - w / 2, y + i * h * 0.3); ctx.lineTo(x + w / 2, y + i * h * 0.3); }
  ctx.stroke();
  ctx.restore();
}

// 監視カメラ（通路）: 小さな箱とレンズ。watched のときは赤いランプが点滅する
function drawCam(x, y, size, watched) {
  const r = size * 0.3;
  ctx.save();
  ctx.fillStyle = '#3A4350';
  roundRect(x - r, y - r * 0.7, r * 2, r * 1.4, Math.max(2, size * 0.08));
  ctx.fillStyle = '#9FD3E8';
  circle(x - r * 0.3, y, r * 0.42);
  ctx.fillStyle = '#1A2028';
  circle(x - r * 0.3, y, r * 0.2);
  if (watched && Math.floor(Date.now() / 500) % 2 === 0) {
    ctx.fillStyle = '#FF3B30';
    circle(x + r * 0.55, y - r * 0.3, r * 0.22);
  }
  ctx.restore();
}

// カメラの台（監視室）: 画面のついた机
function drawCamStand(x, y, size) {
  ctx.save();
  ctx.fillStyle = '#4B5563';
  roundRect(x - size * 0.42, y - size * 0.34, size * 0.84, size * 0.68, 5);
  ctx.fillStyle = '#9FD3E8';
  roundRect(x - size * 0.32, y - size * 0.26, size * 0.64, size * 0.4, 3);
  ctx.fillStyle = '#1A2028';
  ctx.font = Math.round(size * 0.42) + 'px "Material Symbols Rounded"';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('videocam', x, y - size * 0.06);
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
const ACT = { use: null, find: null, sleep: null, protect: null };
function updateActions(g) {
  const now = RoomkRTDB.now();
  const me = state.nickname;
  const role = g.roles[me];
  const awake = E.isAwake(g, me);
  const play = g.stage === 'play' && !blocked();

  let use = null;
  if (play) {
    // はしごを使っている途中は、ほかのことはできない
    if (ME.climb) use = { kind: 'climb', label: ME.climb.label, off: true };
    // 近道（ねむらせ屋と整備係）。整備係は1回使うと ENGINEER_GAP_S 秒使えない
    const eng = g.jobs[me] === 'engineer';
    if (!use && (role === 'sleeper' || eng) && awake && Date.now() - ME.ventAt >= VENT_GAP_MS) {
      const v = E.VENTS.find((x) => E.dist(x, ME) <= E.USE_RANGE);
      const wait = eng && state.engVentAt ? Math.ceil((state.engVentAt + E.ENGINEER_GAP_S * 1000 - Date.now()) / 1000) : 0;
      if (v) use = wait > 0 ? { kind: 'vent', vent: v.id, label: '近道（あと' + wait + '秒）', off: true } : { kind: 'vent', vent: v.id, label: '近道に入る' };
    }
    // はしご（だれでも。ねむった人も）
    if (!use) {
      const l = E.LADDERS.find((x) => E.dist(x, ME) <= E.USE_RANGE);
      if (l) use = { kind: 'ladder', ladder: l.id, label: l.label };
    }
    // 監視カメラの台（おきている人だけ）
    if (!use && awake && E.dist(E.CAM_STAND, ME) <= E.USE_RANGE) use = { kind: 'cam', label: 'カメラを見る' };
    // 空気のパネル（止まっている間。おきている人だけ）
    if (!use && awake && g.air) {
      const p = E.AIR_PANELS.find((q) => !g.airFixed[q.id] && E.dist(q, ME) <= E.USE_RANGE);
      if (p) use = { kind: 'airfix', panel: p.id, label: '空気をなおす' };
    }
    // ふたりの仕事のスイッチ（遊んでいる人ならだれでも。おしている間は「相手を待っている…」）
    if (!use && state.pairHold) use = { kind: 'pairhold', label: '相手を待っている…（はなれるとやめる）', off: true };
    if (!use) {
      for (const p of E.PAIRS) {
        const end = ['a', 'b'].find((e) => E.dist(p[e], ME) <= E.USE_RANGE);
        if (end) { use = { kind: 'pair', pid: p.id, end, label: 'スイッチをおす' }; break; }
      }
    }
    if (!use && role === 'crew') {
      const t = (g.tasks[me] || []).find((x) => !x.done && x.spot < E.PAIR_SPOT_BASE && E.dist(spotOf(x.spot), ME) <= E.USE_RANGE);
      if (t) use = { kind: 'task', spot: t.spot, label: '仕事をする' };
    }
    if (!use && awake && g.dark && E.dist(E.FIX_SPOT, ME) <= E.USE_RANGE) use = { kind: 'fix', label: '電気をなおす' };
    if (!use && awake && E.dist(E.TABLE, ME) <= E.TABLE.r + E.USE_RANGE) {
      const left = g.buttons[me] || 0;
      const wait = Math.max(0, Math.ceil((g.buttonReadyAt - now) / 1000));
      if (g.air) use = { kind: 'button', label: '会議ボタン（空気をなおしてから）', off: true };
      else if (wait > 0) use = { kind: 'button', label: '会議ボタン（あと' + wait + '秒で押せる）', off: true };
      else use = { kind: 'button', label: '会議ボタン（あと' + left + '回）', off: left <= 0 };
    }
  }
  ACT.use = use;
  $('actUse').disabled = !use || !!use.off;
  setText('actUseLabel', use ? use.label : 'つかう');

  let find = null;
  if (play && awake) find = Object.keys(g.bodies).find((id) => E.dist(g.bodies[id], ME) <= E.FIND_RANGE && E.canSee(ME, g.bodies[id])) || null;
  ACT.find = find;
  $('actFind').hidden = !find;

  const canSay = play && awake;
  $('actSay').hidden = !canSay;
  if (!canSay && state.sayOpen) { state.sayOpen = false; renderSayBox(g); }

  updateJobAction(g, play, now);

  const isSl = role === 'sleeper' && awake;
  $('actSleep').hidden = !isSl;
  $('actSab').hidden = !isSl;
  $('btnMap').hidden = !(g.stage === 'play' && isPlaying(g, me));
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
    $('actSab').disabled = !play;
    renderSabBox(g, now);
  } else if (state.sabOpen) {
    state.sabOpen = false;
    $('sabBox').hidden = true;
  }
}

/* ── ねむらせ屋の「しかけ」（停電・空気・ドア）。右下のボタンでひらく一覧 ── */
function renderSabBox(g, now) {
  const box = $('sabBox');
  const open = state.sabOpen && g.stage === 'play' && !blocked();
  if (!open) state.sabDoor = false;
  box.hidden = !open;
  $('actSab').setAttribute('aria-expanded', String(open));
  if (!open) return;
  const scd = Math.max(0, Math.ceil((g.darkReadyAt - now) / 1000));
  const busy = g.dark ? '停電中' : g.air ? '空気を止めている' : scd > 0 ? 'あと ' + scd + ' 秒' : '';
  const dark = $('sabDark');
  dark.disabled = !!busy;
  setText('sabDarkNote', busy || 'いま使える');
  setText('sabDarkDesc', '隊員の見える広さがせまくなる。' + E.fixRoomName() + 'のスイッチでなおされる');
  setText('sabAirDesc', E.AIR_LIMIT_S + '秒のうちに、' + E.AIR_PANELS.map((p) => E.roomName(p.room)).join('と') + 'のパネルを両方なおされなければ勝ち。会議ボタンは押せなくなる');
  const air = $('sabAir');
  air.disabled = !!busy;
  setText('sabAirNote', busy || 'いま使える');
  const dcd = Math.max(0, Math.ceil((g.doorReadyAt - now) / 1000));
  const door = $('sabDoor');
  door.disabled = dcd > 0;
  setText('sabDoorNote', dcd > 0 ? 'あと ' + dcd + ' 秒' : 'いま使える');
  door.setAttribute('aria-expanded', String(state.sabDoor));
  const rooms = $('sabRooms');
  rooms.hidden = !state.sabDoor || dcd > 0;
  if (!rooms.hidden && rooms.childElementCount === 0) {
    rooms.appendChild(makeElement('span', 'nk-words__lead', 'どの部屋？'));
    E.DOOR_ROOMS.forEach((key) => {
      const b = makeElement('button', 'nk-word', E.roomName(key));
      b.type = 'button';
      b.dataset.room = key;
      b.addEventListener('click', () => { state.sabDoor = false; state.sabOpen = false; gameAct(mut.door(state.nickname, key)); });
      rooms.appendChild(b);
    });
  }
}

function toggleSabBox() {
  const g = gameOf(state.room);
  if (!g || $('actSab').hidden || $('actSab').disabled) return;
  state.sabOpen = !state.sabOpen;
  state.sabDoor = false;
  if (state.sabOpen) { state.sayOpen = false; renderSayBox(g); }
  renderSabBox(g, RoomkRTDB.now());
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
  if (!u || u.off || !state.isConnected) return;   // 切れている間は使えない（近道で、ほかの人の見ていない場所へ移らないように）
  if (u.kind === 'vent') { enterVent(u.vent); return; }
  if (u.kind === 'ladder') {
    const l = E.LADDERS[u.ladder];
    ME.climb = { until: Date.now() + E.CLIMB_MS, to: l.to, label: l.busy };
    return;
  }
  if (u.kind === 'cam') openCam();
  else if (u.kind === 'task') openTask(u.spot);
  else if (u.kind === 'fix') openFix();
  else if (u.kind === 'airfix') openAirFix(u.panel);
  else if (u.kind === 'pair') pairPress(u.pid, u.end);
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
  if ($('sabDark').disabled) return;
  state.sabOpen = false;
  gameAct(mut.dark(state.nickname));
}
function doAir() {
  if ($('sabAir').disabled) return;
  state.sabOpen = false;
  gameAct(mut.air(state.nickname));
}

/* ── 役職（2026-10-29 子どもの要望の第3便）── */
// 「まもり星になった」「バリアでねむらせられなかった／まもれた」を、その本人にだけ知らせる
function noteJobs(g, playing) {
  const me = state.nickname;
  if (!playing) return;
  const b = g.blocked;
  const key = b ? b.at : 0;
  if (state.blockedSeen === null) { state.blockedSeen = key; return; }   // 読み込み直したときは、前の分を出さない
  if (key && key !== state.blockedSeen) {
    state.blockedSeen = key;
    if (b.by === me) smallToast('バリアでまもられていて、ねむらせられなかった');
    else if (g.jobs[me] === 'angel') smallToast(nameIn(g, b.t) + ' さんをまもれた！');
  }
}

// 役職のボタン（見守り係＝チェッカー・へんしん屋＝へんしん・まもり星＝まもる）。整備係は「つかう」で近道
function updateJobAction(g, play, now) {
  const me = state.nickname;
  const job = E.jobOf(g, me);
  const awake = E.isAwake(g, me);
  const btn = $('actJob');
  let show = false;
  let label = '';
  let icon = '';
  let off = true;
  if (job === 'watcher' && awake) {
    show = true;
    icon = 'monitor_heart';
    label = 'チェッカー ' + Math.floor(state.battery) + '秒';
    off = !play || state.battery < 1;
  } else if (job === 'shifter' && awake) {
    show = true;
    icon = 'theater_comedy';
    const sh = g.shape[me];
    if (sh && sh.until > now) { label = 'へんしん中 ' + Math.ceil((sh.until - now) / 1000); off = true; }
    else {
      const wait = Math.ceil(((g.shiftReadyAt[me] || 0) - now) / 1000);
      label = wait > 0 ? 'へんしん ' + wait : 'へんしん';
      off = !play || wait > 0;
    }
  } else if (job === 'angel') {
    show = true;
    icon = 'shield';
    const wait = Math.ceil(((g.angelReadyAt || 0) - now) / 1000);
    const t = wait > 0 ? null : angelTarget(g);
    ACT.protect = t;
    label = wait > 0 ? 'まもる ' + wait : 'まもる';
    off = !play || !t;
  }
  if (job !== 'angel') ACT.protect = null;
  if (btn.hidden === show) btn.hidden = !show;
  if (!show) return;
  btn.disabled = off;
  setText('actJobLabel', label);
  setText('actJobIcon', icon);
  if (state.shiftOpen) renderShiftBox(g, now);
}

// まもり星がバリアをはれる相手: いちばん近い、おきている人（ねむった人はかべに関係なく見える）
function angelTarget(g) {
  const awake = E.isAwake(g, state.nickname);
  let target = null;
  let best = Infinity;
  E.awakeOf(g).forEach((id) => {
    if (id === state.nickname) return;
    const p = drawPos(g, id);
    if (!p) return;
    const d = E.dist(p, ME);
    if (awake && !E.canSee(ME, p)) return;   // おきている間は、かべの向こうの人にははれない
    if (d <= E.ANGEL_RANGE && d < best) { best = d; target = id; }
  });
  return target;
}

function doJob() {
  const g = gameOf(state.room);
  const btn = $('actJob');
  if (!g || btn.hidden || btn.disabled || !state.isConnected) return;
  const job = E.jobOf(g, state.nickname);
  if (job === 'watcher') openVitals();
  else if (job === 'shifter') { state.shiftOpen = !state.shiftOpen; renderShiftBox(g, RoomkRTDB.now()); }
  else if (job === 'angel' && ACT.protect) gameAct(mut.protect(state.nickname, ACT.protect));
}

// へんしん屋の「だれになる？」（おきている、ほかの人）
function renderShiftBox(g, now) {
  const box = $('shiftBox');
  const me = state.nickname;
  const open = state.shiftOpen && g.stage === 'play' && !blocked() && E.isAwake(g, me) && !$('actJob').disabled;
  box.hidden = !open;
  if (!open) { state.shiftOpen = false; return; }
  const list = $('shiftNames');
  const ids = E.awakeOf(g).filter((id) => id !== me);
  const key = ids.join(',');
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren(makeElement('span', 'nk-words__lead', 'だれになる？'));
  ids.forEach((id) => {
    const b = makeElement('button', 'nk-word');
    b.type = 'button';
    b.append(chip(g.colors[id]), document.createTextNode(nameIn(g, id)));
    b.addEventListener('click', () => { state.shiftOpen = false; box.hidden = true; gameAct(mut.shift(me, id)); });
    list.appendChild(b);
  });
}

// 見守り係のチェッカー: だれがおきていて、だれがねむっているか（役は出さない）。見ている間は動けず、電池がへる
function openVitals() {
  const g = gameOf(state.room);
  if (!g || g.stage !== 'play' || state.vitalsOpen || state.battery < 1) return;
  state.vitalsOpen = true;
  state.sayOpen = false;
  state.shiftOpen = false;
  renderSayBox(g);
  $('ovVitals').hidden = false;
  KEYS.clear();
  renderVitals(g);
}
function closeVitals() {
  state.vitalsOpen = false;
  $('ovVitals').hidden = true;
}
function renderVitals(g) {
  const ul = $('vitalsList');
  const key = g.players.map((id) => id + (E.hasLeft(g, id) ? 'L' : E.isAwake(g, id) ? 'A' : 'S')).join(',');
  if (ul.dataset.key !== key) {
    ul.dataset.key = key;
    ul.replaceChildren();
    g.players.forEach((id) => {
      const li = makeElement('li', 'nk-person');
      const st = E.hasLeft(g, id) ? '抜けた' : E.isAwake(g, id) ? 'おきている' : 'ねむっている';
      li.append(chip(g.colors[id]), makeElement('span', 'nk-person__name', nameIn(g, id)), makeElement('span', 'nk-tag' + (st === 'ねむっている' ? ' nk-tag--zzz' : ''), st));
      ul.appendChild(li);
    });
  }
  setText('vitalsBattery', '電池 のこり ' + Math.max(0, Math.ceil(state.battery)) + ' 秒');
}
// 毎フレーム: 見ている間は電池がへり、見ていない間は少しずつたまる
function tickBattery(g, dt) {
  if (g.jobs[state.nickname] !== 'watcher') return;
  if (state.vitalsOpen) {
    state.battery = Math.max(0, state.battery - dt);
    renderVitals(g);
    if (state.battery <= 0) { closeVitals(); smallToast('電池がなくなった。少しずつたまるよ（仕事を1つおえると満タン）'); }
  } else if (g.stage === 'play') {
    state.battery = Math.min(E.WATCH_BATTERY_S, state.battery + dt / E.WATCH_CHARGE_S);
  }
}

// まもり星から見た、バリアの光（まもり星の画面にだけ描く）
function drawShield(x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 200, 255, 0.95)';
  ctx.fillStyle = 'rgba(120, 200, 255, 0.18)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x, y - TS * 0.1, TS * 0.62, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/* ── 近道（2026-10-29 子どもの要望「ベントで飛ぶ場所を選べるように」）──
   入ると姿が消え（位置の印が 2）、ほかの7か所から部屋の名前で選んで出る。中にいられるのは VENT_STAY_S 秒まで（過ぎたら入った所から出る） */
const ventRoom = (v) => E.roomName(E.roomAt(v.x, v.y));
function enterVent(id) {
  const g = gameOf(state.room);
  const v = E.VENTS[id];
  if (!g || !v || ME.vent || !state.isConnected) return;
  ME.x = v.x;
  ME.y = v.y;
  ME.vent = { id, until: Date.now() + E.VENT_STAY_S * 1000 };
  KEYS.clear();
  state.sayOpen = false;
  state.sabOpen = false;
  state.shiftOpen = false;
  renderSayBox(g);
  sendPosFor(state.nickname, ME, true, true);
  $('ventBox').hidden = false;
  $('ventRooms').replaceChildren();
  renderVentBox();
}
// 出る。to をわたすと、その近道から出る。send: 位置を送る（会議・置きなおしのときは送らない）
function leaveVent(send, to) {
  if (!ME.vent) return;
  if (send && !state.isConnected) return;   // 切れている間は出ない（ほかの人の見ていない間に動いた場所へ現れないように）
  const v = E.VENTS[to === undefined ? ME.vent.id : to];
  ME.vent = null;
  $('ventBox').hidden = true;
  if (!send) return;
  ME.x = v.x;
  ME.y = v.y;
  ME.ventAt = Date.now();
  const g = gameOf(state.room);
  if (g && g.jobs[state.nickname] === 'engineer') state.engVentAt = Date.now();
  sendPosFor(state.nickname, ME, true, true);
}
function renderVentBox() {
  if (!ME.vent) return;
  const left = Math.max(0, Math.ceil((ME.vent.until - Date.now()) / 1000));
  setText('ventLeft', 'あと' + left + '秒で出る');
  const box = $('ventRooms');
  if (box.childElementCount) return;
  box.appendChild(makeElement('span', 'nk-words__lead', 'どこに出る？'));
  E.VENTS.forEach((v) => {
    if (v.id === ME.vent.id) return;
    const b = makeElement('button', 'nk-word', ventRoom(v));
    b.type = 'button';
    b.dataset.vent = String(v.id);
    b.addEventListener('click', () => leaveVent(true, v.id));
    box.appendChild(b);
  });
  const here = makeElement('button', 'nk-word nk-word--quiet', 'ここから出る（' + ventRoom(E.VENTS[ME.vent.id]) + '）');
  here.type = 'button';
  here.dataset.vent = 'here';
  here.addEventListener('click', () => leaveVent(true));
  box.appendChild(here);
}

/* ── 監視カメラ ── */
// だれかがカメラを見ているか（ランプ用。遊んでいて おきている人の分だけ）
const camWatched = (g) => Object.keys(g.cam).some((id) => isPlaying(g, id) && E.isAwake(g, id));

function openCam() {
  const g = gameOf(state.room);
  const me = state.nickname;
  if (!g || g.stage !== 'play' || !isPlaying(g, me) || !E.isAwake(g, me) || state.camOpen) return;
  state.camOpen = true;
  state.sayOpen = false;
  state.sayPending = null;
  renderSayBox(g);
  setText('camCount', '通路の' + E.CAMS.length + 'か所');
  $('ovCam').hidden = false;
  KEYS.clear();
  // 見ていることをみんなに知らせる（カメラのランプ）。切れたら消える
  const ref = state.roomRef.child('game/cam/' + me);
  ref.onDisconnect().remove().catch(() => {});
  ref.set(true).catch((error) => console.warn('[nemurase] cam failed', error));
  drawCams(g);
}

function closeCam() {
  const was = state.camOpen;
  state.camOpen = false;
  $('ovCam').hidden = true;
  if (was && state.roomRef && state.nickname) {
    const ref = state.roomRef.child('game/cam/' + state.nickname);
    ref.onDisconnect().cancel().catch(() => {});
    ref.remove().catch(() => {});
  }
}

const camCanvas = $('camView');
const cctx = camCanvas.getContext('2d');
// カメラの映像を、はばが広ければ3列・せまければ2列にならべて描く（2026-10-29 カメラを6つに）。映るのは、カメラのまわり CAM_R マスの通路の部分と、そこにいる おきている人・ねむっている姿だけ。停電中は映らない
function drawCams(g) {
  const w = Math.max(160, Math.floor(camCanvas.getBoundingClientRect().width));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cols = w >= 420 ? 3 : 2;
  const cell = w / cols;
  const h = Math.round(cell * Math.ceil(E.CAMS.length / cols));
  if (camCanvas.width !== w * dpr || camCanvas.height !== h * dpr) {
    camCanvas.width = w * dpr;
    camCanvas.height = h * dpr;
    camCanvas.style.height = h + 'px';
  }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.fillStyle = '#1A2028';
  cctx.fillRect(0, 0, w, h);
  const s = (cell - 8) / (E.CAM_R * 2 + 1);
  const me = state.nickname;
  cctx.font = '700 ' + Math.max(11, Math.round(s * 0.36)) + 'px "Noto Sans JP", sans-serif';
  E.CAMS.forEach((c, i) => {
    const ox = (i % cols) * cell + 4;
    const oy = Math.floor(i / cols) * cell + 4;
    const cx = ox + (cell - 8) / 2;
    const cy = oy + (cell - 8) / 2;
    const px = (x) => cx + (x - c.x) * s;
    const py = (y) => cy + (y - c.y) * s;
    cctx.save();
    cctx.beginPath();
    cctx.rect(ox, oy, cell - 8, cell - 8);
    cctx.clip();
    cctx.fillStyle = '#242C36';
    cctx.fillRect(ox, oy, cell - 8, cell - 8);
    if (g.dark) {
      cctx.fillStyle = '#B8C2CC';
      cctx.textAlign = 'center';
      cctx.textBaseline = 'middle';
      cctx.fillText('停電中は映らない', cx, cy);
    } else {
      cctx.beginPath();
      cctx.arc(cx, cy, E.CAM_R * s, 0, Math.PI * 2);
      cctx.clip();
      cctx.fillStyle = E.HALL_FILL;
      for (let ty = Math.floor(c.y - E.CAM_R - 1); ty <= Math.ceil(c.y + E.CAM_R + 1); ty++) {
        for (let tx = Math.floor(c.x - E.CAM_R - 1); tx <= Math.ceil(c.x + E.CAM_R + 1); tx++) {
          if (E.isFloor(tx, ty) && !E.roomAt(tx + 0.5, ty + 0.5)) cctx.fillRect(px(tx), py(ty), s + 0.5, s + 0.5);
        }
      }
      const inCam = (p) => E.dist(p, c) <= E.CAM_R && !E.roomAt(p.x, p.y);
      Object.keys(g.bodies).forEach((id) => { if (inCam(g.bodies[id])) drawCamBody(px(g.bodies[id].x), py(g.bodies[id].y), s, colorHex(g.colors[id])); });
      g.players.forEach((id) => {
        const pos = drawPos(g, id);
        if (!pos || !E.isAwake(g, id) || !inCam(pos)) return;
        const look = E.looksAs(g, id, RoomkRTDB.now());
        drawCamPerson(px(pos.x), py(pos.y), s, colorHex(g.colors[look]), pos.face || 1, nameIn(g, look), id === me);
      });
    }
    cctx.restore();
    cctx.fillStyle = 'rgba(255,255,255,0.9)';
    cctx.textAlign = 'left';
    cctx.textBaseline = 'top';
    cctx.fillText(c.name, ox + 6, oy + 4);
  });
}

function drawCamPerson(x, y, s, hex, face, name, isMe) {
  const r = E.RADIUS * s * 1.25;
  cctx.save();
  cctx.fillStyle = hex;
  cctx.strokeStyle = 'rgba(0,0,0,0.45)';
  cctx.lineWidth = 2;
  cctx.beginPath();
  cctx.arc(x, y, r, 0, Math.PI * 2);
  cctx.fill();
  cctx.stroke();
  cctx.fillStyle = '#fff';
  const ex = x + face * r * 0.28;
  cctx.beginPath(); cctx.arc(ex - r * 0.28, y - r * 0.18, r * 0.24, 0, Math.PI * 2); cctx.fill();
  cctx.beginPath(); cctx.arc(ex + r * 0.28, y - r * 0.18, r * 0.24, 0, Math.PI * 2); cctx.fill();
  cctx.font = '700 ' + Math.max(10, Math.round(s * 0.34)) + 'px "Noto Sans JP", sans-serif';
  cctx.textAlign = 'center';
  cctx.textBaseline = 'bottom';
  cctx.lineWidth = 3;
  cctx.strokeStyle = 'rgba(255,255,255,0.95)';
  cctx.strokeText(name, x, y - r - 2);
  cctx.fillStyle = isMe ? '#1C3F5E' : '#1A1A1A';
  cctx.fillText(name, x, y - r - 2);
  cctx.restore();
}

function drawCamBody(x, y, s, hex) {
  const r = E.RADIUS * s * 1.25;
  cctx.save();
  cctx.fillStyle = hex;
  cctx.strokeStyle = 'rgba(0,0,0,0.45)';
  cctx.lineWidth = 2;
  cctx.beginPath();
  cctx.ellipse(x, y + r * 0.3, r * 1.2, r * 0.7, 0, 0, Math.PI * 2);
  cctx.fill();
  cctx.stroke();
  cctx.restore();
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
  $('btnCamClose').addEventListener('click', closeCam);
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
  $('actSay').addEventListener('click', toggleSayBox);
  $('btnSayClose').addEventListener('click', () => { state.sayOpen = false; state.sayPending = null; const g = gameOf(state.room); if (g) renderSayBox(g); });
  $('actSleep').addEventListener('click', doSleep);
  $('actSab').addEventListener('click', toggleSabBox);
  $('btnSabClose').addEventListener('click', () => { state.sabOpen = false; state.sabDoor = false; $('sabBox').hidden = true; });
  $('sabDark').addEventListener('click', doDark);
  $('sabAir').addEventListener('click', doAir);
  $('sabDoor').addEventListener('click', () => { state.sabDoor = !state.sabDoor; const g = gameOf(state.room); if (g) renderSabBox(g, RoomkRTDB.now()); });
  $('btnMap').addEventListener('click', () => { if (state.mapOpen) closeMap(); else openMap(); });
  $('btnMapClose').addEventListener('click', closeMap);
  $('btnMeetingMap').addEventListener('click', openMap);
  miniBtn.addEventListener('click', openMap);
  setMiniOn(miniOn);
  miniToggle.addEventListener('click', () => setMiniOn(!miniOn));
  $('actJob').addEventListener('click', doJob);
  $('btnVitalsClose').addEventListener('click', closeVitals);
  $('btnShiftClose').addEventListener('click', () => { state.shiftOpen = false; $('shiftBox').hidden = true; });
  $('btnTasks').addEventListener('click', () => {
    const closed = $('taskList').classList.toggle('is-closed');
    $('btnTasks').setAttribute('aria-expanded', String(!closed));
  });

  window.addEventListener('keydown', (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (state.currentScreen !== 'game') return;
    if (e.code === 'Escape' && !$('ovTask').hidden) { closeTask(); return; }
    if (e.code === 'Escape' && !$('ovCam').hidden) { closeCam(); return; }
    if (e.code === 'Escape' && !$('ovMap').hidden) { closeMap(); return; }
    if (e.code === 'Escape' && ME.vent) { leaveVent(true); return; }
    if ((e.code === 'Escape' || (e.code === 'KeyG' && !e.repeat)) && !$('ovVitals').hidden) { closeVitals(); return; }
    if (e.code === 'KeyM' && !e.repeat && !$('ovMap').hidden) { closeMap(); return; }
    if (e.code === 'KeyM' && !e.repeat && !$('ovMeeting').hidden) { openMap(); return; }   // 会議中も M で地図
    if (blocked()) return;
    if (/^(Arrow|Key[WASD]$)/.test(e.code)) { KEYS.add(e.code); e.preventDefault(); return; }
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'KeyE') { e.preventDefault(); doUse(); }
    else if (e.code === 'KeyR') doFind();
    else if (e.code === 'KeyT' && !$('actSay').hidden) toggleSayBox();
    else if (e.code === 'KeyQ') doSleep();
    else if (e.code === 'KeyF') toggleSabBox();
    else if (e.code === 'KeyG') doJob();
    else if (e.code === 'KeyM' && !$('btnMap').hidden) openMap();
  });
  window.addEventListener('keyup', (e) => KEYS.delete(e.code));
  window.addEventListener('blur', () => KEYS.clear());
  // 画面を消さない約束は、タブが裏にまわると外れるので、表にもどったら取りなおす
  document.addEventListener('visibilitychange', () => { if (state.wakeWant && !state.wakeLock) setWakeLock(true); });
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
