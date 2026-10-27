/* 大富豪 — ルーム型（Realtime Database）
   ・ゲームの状態（手札・場・できごと・締め切り）は room.game に JSON の文字列で持つ。
     RTDB は空の配列を消すので、ルールの状態をそのまま置くと読み戻せないため。
   ・CPU の席・通信が切れた人・まかせた人の番と、時間切れは、ホストの画面が transaction で進める
     （ホストの通信が切れている間は止まる）。
   ・手札は自分の分だけ画面に出す（DevTools で見えるのは性善説で許容）。 */
const E = window.DaifugoEngine;
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'daifugo_rooms';
const SESSION_KEY = 'daifugo_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAYING: 'playing' };
const DEFAULT_TITLE = document.title;

const MAX_GUESTS = 12;
const TICK_MS = 250;
const LEAVE_GRACE_MS = 3000;   // 通信が切れてから、CPU が代わりに出すまで待つ時間（読み込み直しならその間にもどれる）
const CPU_DELAY_MS = 1100;
const AUTO_AFTER = 2;          // 時間切れがこの回数続いたら CPU にまかせる
const LOG_MAX = 6;
const SPLASH_MS = 1500;

const TIME_OPTS = [[0, 'なし'], [15, '15秒'], [30, '30秒'], [60, '60秒']];
const TIMEOUT_OPTS = [['pass', 'パスする'], ['cpu', 'CPUが代わりに出す']];
const JOKER_OPTS = [[0, 'なし'], [1, '1枚'], [2, '2枚']];
const DEFAULT_TIME = { limit: 30, onTimeout: 'pass' };

// 待合室で選べるルール（表示の順）
const RULE_ITEMS = [
  ['stairs', '階段', '同じマークで続いた数を3枚以上まとめて出せる'],
  ['revolution', '革命', '同じ数を4枚出すと、強さが逆になる'],
  ['stairsRevolution', '階段革命', '4枚以上の階段でも革命になる（革命と階段がオンのとき）'],
  ['eightCut', '8切り', '8を出すと場が流れて、続けて出せる'],
  ['elevenBack', 'イレブンバック', 'Jを出すと、場が流れるまで強さが逆になる'],
  ['tenDiscard', '10捨て', '10を出すと、出した枚数まで手札を捨てられる'],
  ['lock', 'しばり', '同じマークが続くと、場が流れるまでそのマークだけ'],
  ['spade3', 'スペ3返し', 'ジョーカー1枚には♠3で勝てる'],
  ['forbiddenFinish', 'ジョーカー・2・8ではあがれない', '最後の1手に入れられない。革命中は2のかわりに3、8は8切りがオンのときだけ'],
];
// ジョーカーだけで出すときの「何として出すか」のボタン
const AS_LABEL = { 8: '8として（8切り）', 10: '10として（捨てられる）', 11: 'Jとして（イレブンバック）' };
const FX_SPLASH = { revolution: '革命！', 'revolution-back': '革命返し！', eight: '8切り！', back: 'イレブンバック！', spade3: 'スペ3返し！', lock: 'しばり！' };
const REASON = {
  shape: (r) => (r.stairs ? '同じ数のカードか、同じマークで続いた3枚以上（階段）を選んでね' : '同じ数のカードを選んでね'),
  count: () => '場と同じ枚数で出してね',
  stairs: () => '場は階段だよ。同じ枚数の階段で出してね',
  lock: () => 'しばり中だよ。場と同じマークで出してね',
  weak: (r, dir) => (dir > 0 ? '場より強いカードを選んでね' : 'いまは強さが逆。場より弱い数を選んでね'),
  forbidden: (r, dir) => ['ジョーカー', dir > 0 ? '2' : '3'].concat(r.eightCut ? ['8'] : []).join('・') + ' では、あがれないよ',
};

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  view: null,          // 画面に出すためにそろえたルームの形
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
  tickTimer: null,
  // ホストだけが使う
  hostBusy: false,
  cpuKey: null,
  cpuAt: 0,
  awaySince: {},       // 席の人が通信が切れたと気づいた時刻
  seenAway: null,      // できごとに書いた「通信が切れた」の状態
  tickRound: null,
  // 端末の中だけで持つ状態
  acting: false,
  sel: [],
  selKey: '',
  selRound: null,
  fxSeq: -1,
  fxRound: -1,
  splashTimer: null,
  gameCache: { raw: null, val: null },
  rulesKey: null,
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  document.querySelectorAll('.df-screen').forEach((node) => node.classList.remove('active'));
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
  if (/^CPU/i.test(value)) return '「CPU」ではじまる名前は使えないよ';
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

function msIcon(name, className) {
  const node = el('span', 'material-symbols-rounded' + (className ? ' ' + className : ''), name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function parseJson(raw) {
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/* ── ルームの読み取り ── */
function byJoined(a, b) {
  return (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0) || String(a.name).localeCompare(String(b.name), 'ja');
}

function settingsOf(room) {
  const s = room?.settings || {};
  const limit = Number(s.time?.limit);
  return {
    rules: E.normRules(s.rules),
    time: {
      limit: TIME_OPTS.some(([v]) => v === limit) ? limit : DEFAULT_TIME.limit,
      onTimeout: s.time?.onTimeout === 'cpu' ? 'cpu' : 'pass',
    },
    hint: s.hint !== false,
  };
}

// ゲームの状態を読む。壊れていたら null（読み取り専用の画面はキャッシュを使い、書きかえるときは毎回読み直す）
function parseGame(raw, fresh = false) {
  if (!fresh && state.gameCache.raw === raw) return state.gameCache.val;
  const G = parseJson(raw);
  const n = Array.isArray(G?.seats) ? G.seats.length : 0;
  const ok = n >= E.PLAYERS_MIN && n <= E.PLAYERS_MAX
    && G.seats.every((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
    && G.s && Array.isArray(G.s.hands) && G.s.hands.length === n && Number.isInteger(G.s.seq);
  const val = ok ? {
    seats: G.seats,
    s: G.s,
    log: Array.isArray(G.log) ? G.log.filter((x) => x && typeof x.text === 'string') : [],
    logN: Number(G.logN) || 0,
    deadline: Number(G.deadline) || null,
    auto: G.auto && typeof G.auto === 'object' ? G.auto : {},
    timeouts: G.timeouts && typeof G.timeouts === 'object' ? G.timeouts : {},
  } : null;
  if (!fresh) state.gameCache = { raw, val };
  return val;
}

// 席の人のいまの様子。CPU の席・通信が切れた人・まかせた人は CPU が動かす。
// self: ホストの画面で使うとき。ホスト自身の席は、この画面が動いているので在室とみなす
// （再読み込みの直後など、hostConnected が戻る前に自分の番を CPU が出さないように）
function seatState(room, G, i, self = false) {
  const seat = G.seats[i];
  if (!seat || seat.cpu) return { kind: 'cpu', away: false, auto: false, cpu: true };
  const away = seat.name === room.host ? !self && room.hostConnected === false : !room.players?.[seat.name];
  const auto = !!G.auto[seat.id];
  return { kind: 'human', away, auto, cpu: away || auto };
}

// 画面に出すための形にそろえる（席は id: 'p:名前' か 'c:CPUのキー'）
function makeView(room) {
  const G = room.status === STATUS.PLAYING ? parseGame(room.game) : null;
  const people = [];
  Object.entries(room.players || {}).forEach(([name, p]) => {
    people.push({ id: 'p:' + name, name, kind: 'human', joinedAt: p?.joinedAt, away: name === room.host && room.hostConnected === false && state.role !== 'host' });
  });
  Object.entries(room.cpus || {}).forEach(([key, c]) => {
    people.push({ id: 'c:' + key, name: String(c?.name || 'CPU'), kind: 'cpu', joinedAt: c?.joinedAt });
  });
  people.sort(byJoined);
  if (G) {
    G.seats.forEach((seat, i) => {
      let p = people.find((x) => x.id === seat.id);
      if (!p) {
        p = { id: seat.id, name: seat.name, kind: seat.cpu ? 'cpu' : 'human' };
        people.push(p);
      }
      const st = seatState(room, G, i, state.role === 'host');
      p.away = st.away;
      p.auto = st.auto;
    });
  }
  const settings = settingsOf(room);
  return {
    code: state.roomCode,
    phase: G ? 'play' : 'lobby',
    people,
    seats: G ? G.seats.map((x) => x.id) : [],
    seatNames: G ? G.seats.map((x) => x.name) : [],
    hostId: 'p:' + room.host,
    hostPlays: !!room.hostPlays,
    rules: settings.rules,
    time: settings.time,
    hint: settings.hint,
    game: G ? G.s : null,
    log: G ? G.log : [],
    deadline: G ? G.deadline : null,
    round: Number(room.round) || 0,
    G,
  };
}

const myId = () => (state.nickname ? 'p:' + state.nickname : null);
const personOf = (R, id) => R.people.find((p) => p.id === id);
const seatName = (R, i) => R.seatNames[i] || '（いない人）';
const seatPerson = (R, i) => personOf(R, R.seats[i]);
// いま動く人。カード交換の間は -1（返すカードを選ぶ人は givers）
const actorOf = (g) => (g.exchange ? -1 : g.pending ? g.pending.by : g.turn);
const givers = (g) => (g.exchange ? g.exchange.pairs.filter((x) => !x.down).map((x) => x.rich) : []);
const dueSeats = (g) => (g.over ? [] : g.exchange ? givers(g) : [actorOf(g)]);
function cpuSeat(R, i) {
  const p = seatPerson(R, i);
  return !p || p.kind === 'cpu' || !!p.away || !!p.auto;
}
// あそぶ人（「はじめる」で席に入る人）
const canSit = (R) => R.people.filter((p) => (p.kind === 'cpu' || !p.away) && (p.id !== R.hostId || R.hostPlays));
const players = (R) => canSit(R).slice(0, E.PLAYERS_MAX);
// 前回のあがり順での呼び名
function rankWord(g, i) {
  const k = g.prev ? g.prev.indexOf(i) : -1;
  return k < 0 ? '' : E.titleOf(g.n, k);
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
    console.warn('[daifugo] expired room cleanup failed', error);
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

/* ── ゲームを進める（ルールの状態を書きかえる） ── */
function pushLog(G, text) {
  if (!text) return;
  G.logN += 1;
  G.log.push({ n: G.logN, text });
  if (G.log.length > LOG_MAX) G.log.shift();
}

function resetClock(G, settings) {
  G.deadline = !G.s.over && settings.time.limit ? RoomkRTDB.now() + settings.time.limit * 1000 : null;
}

function describe(room, G, g, cause) {
  const L = g.last;
  const name = (i) => (G.seats[i] ? G.seats[i].name : '（いない人）');
  const human = G.seats[L.by] && !G.seats[L.by].cpu;
  const who = name(L.by) + (cause === 'cpu' && human ? '（CPUが代わり）' : '');
  const pre = cause === 'timeout' ? '時間切れ。' : '';
  const parts = [];
  if (L.kind === 'play') {
    parts.push(pre + who + 'が ' + L.cards.map(E.cardLabel).join('・') + ' を出した' + (L.as ? '（' + E.rankLabel(L.as) + 'として）' : ''));
    L.fx.forEach((f) => {
      if (f === 'revolution') parts.push('革命！ 強さが逆になった');
      else if (f === 'revolution-back') parts.push('革命返し！ 強さが元にもどった');
      else if (f === 'eight') parts.push('8切り！');
      else if (f === 'back') parts.push('イレブンバック！ 場が流れるまで強さが逆');
      else if (f === 'spade3') parts.push('スペ3返し！');
      else if (f === 'lock') parts.push('しばり！ ' + (g.lock || []).map((x) => E.SUIT_MARK[x]).join('') + 'だけ');
      else if (f === 'ten') parts.push('10捨て。捨てるカードを選んでいるよ');
    });
  } else if (L.kind === 'give') {
    parts.push(pre + who + 'がカードを返した');
    if (L.fx.includes('exchanged')) parts.push('カード交換がおわった。' + name(L.lead) + 'から');
  } else if (L.kind === 'pass') parts.push(pre + who + 'はパス');
  else if (L.kind === 'discard') parts.push(pre + (L.cards.length ? who + 'が ' + L.cards.length + '枚 捨てた' : who + 'は捨てなかった'));
  if (L.fx.includes('done')) parts.push(name(L.by) + 'があがり！（' + (g.places.indexOf(L.by) + 1) + '番）');
  if (L.fx.includes('foul')) parts.push(name(L.by) + 'は反則あがり（最後になる）');
  if (L.fx.includes('fallen')) parts.push('都落ち！ 前回の大富豪の' + name(g.fallen) + 'は抜けて、最後になる');
  if (g.over) parts.push('おしまい！');
  else if (L.flow) parts.push('場が流れた。' + name(L.lead) + 'から');
  return parts.join('　');
}

// 1手を当てはめて、できごとを書く
function applyMove(room, G, i, mv, cause, settings) {
  const ng = E.apply(G.s, i, mv);
  if (!ng) return false;
  G.s = ng;
  pushLog(G, describe(room, G, ng, cause));
  // 交換の間は、締め切りは返す人みんなで同じ
  if (!ng.exchange) resetClock(G, settings);
  return true;
}

// 時間切れ: パス（場が空・10捨て・カード交換は決めた動き）か、CPU が代わりに出す
function timeUp(room, G, i, settings) {
  const g = G.s;
  let mv;
  if (g.exchange) mv = E.cpuMove(g, i);
  else if (g.pending) mv = settings.time.onTimeout === 'cpu' ? E.cpuMove(g, i) : { kind: 'discard', cards: [] };
  else if (settings.time.onTimeout === 'pass' && g.field) mv = { kind: 'pass' };
  else mv = E.cpuMove(g, i);
  if (!applyMove(room, G, i, mv, 'timeout', settings)) {
    resetClock(G, settings);
    return;
  }
  const seat = G.seats[i];
  G.timeouts[seat.id] = (Number(G.timeouts[seat.id]) || 0) + 1;
  if (G.timeouts[seat.id] >= AUTO_AFTER && !G.auto[seat.id]) {
    G.auto[seat.id] = true;
    pushLog(G, seat.name + 'は時間切れが' + AUTO_AFTER + '回続いたので、CPUが代わりに出すよ（「自分でやる」でもどれる）');
  }
}

function startText(G, changed) {
  const g = G.s;
  const name = (i) => G.seats[i].name;
  const who = (i) => rankWord(g, i) + '（' + name(i) + '）';
  if (g.exchange) {
    return '配ったよ。まずカード交換。' + g.exchange.pairs.map((x) => who(x.poor) + 'が' + who(x.rich) + 'に強いカードを' + x.k + '枚わたした').join('。')
      + '。' + g.exchange.pairs.map((x) => name(x.rich)).join('と') + 'は、返すカードを選んでね';
  }
  const note = changed && g.rules.exchange ? '（前回と人がちがうので、カード交換はなし）' : '';
  return '配ったよ。♦3を持っている' + name(g.turn) + 'から' + note;
}

// ゲームの状態を transaction で書きかえる。mutate が false を返したら書かない。
// round: 押した時点の回。もどす・配りなおすをはさんだ古い操作を、新しい回に当てはめないように確かめる
async function gameTx(mutate, failMessage, round) {
  const ref = state.roomRef;
  if (!ref) return null;
  const uid = currentUid();
  let finished = false;
  try {
    const result = await ref.transaction((room) => {
      finished = false;
      if (!room || isExpired(room) || room.status !== STATUS.PLAYING) return;
      if (round != null && (Number(room.round) || 0) !== round) return;
      const G = parseGame(room.game, true);
      if (!G) return;
      const settings = settingsOf(room);
      const wasOver = G.s.over;
      if (!mutate(room, G, settings, uid)) return;
      const next = { ...room, game: JSON.stringify(G) };
      if (!wasOver && G.s.over) {
        // 次の回の呼び名・カード交換に使う
        next.lastOrder = JSON.stringify(G.s.places.map((k) => G.seats[k].id));
        finished = true;
      }
      return next;
    });
    if (result.committed && finished) window.RoomkStats?.count('finish');
    return result.committed;
  } catch (error) {
    console.warn('[daifugo] game update failed', error);
    if (failMessage) toast(failMessage);
    return null;
  }
}

// この画面の人の席（名前の持ち主であることも確かめる）
function mySeatIn(room, G, uid) {
  if (!state.nickname || state.role === 'spectator') return -1;
  const owns = state.role === 'host' ? room.hostUid === uid && room.host === state.nickname : room.players?.[state.nickname]?.uid === uid;
  if (!owns) return -1;
  return G.seats.findIndex((x) => !x.cpu && x.name === state.nickname);
}

// 自分の操作（出す・パス・捨てる・返す）
async function act(kind, cards, as) {
  if (state.acting || !state.view?.game) return;
  state.acting = true;
  const seq = state.view.game.seq;
  const round = state.view.round;
  try {
    const ok = await gameTx((room, G, settings, uid) => {
      const g = G.s;
      // カード交換はほかの人と同時に返すので、何手目かは見ない（自分がまだ返していないかだけ）
      if (kind !== 'give' && g.seq !== seq) return false;
      if ((kind === 'give') !== !!g.exchange) return false;
      if (kind !== 'give' && (kind === 'discard') !== !!g.pending) return false;
      const i = mySeatIn(room, G, uid);
      if (i < 0) return false;
      const mv = kind === 'pass' ? { kind: 'pass' } : as ? { kind, cards, as } : { kind, cards };
      if (!applyMove(room, G, i, mv, 'self', settings)) return false;
      const id = G.seats[i].id;
      G.auto[id] = false;
      G.timeouts[id] = 0;
      return true;
    }, '送れませんでした。もう一度ためしてね', round);
    // 押したのと同じころに時間切れ・ほかの人の操作が先に入ったとき
    if (ok === false) toast('そのあいだに場が変わったよ。もう一度選んでね', false);
  } finally {
    state.acting = false;
  }
}

// 自分の番にもどった人の考える時間をはじめからにする（カード交換中は、みんなの締め切りをその人の分までのばす）
function restartClock(G, settings) {
  if (!G.s.exchange) {
    resetClock(G, settings);
    return;
  }
  if (settings.time.limit) G.deadline = Math.max(Number(G.deadline) || 0, RoomkRTDB.now() + settings.time.limit * 1000);
}

// 「自分でやる」: CPU にまかせていたのをもどす
async function takeBack() {
  const round = state.view?.round;
  await gameTx((room, G, settings, uid) => {
    const i = mySeatIn(room, G, uid);
    if (i < 0 || !G.auto[G.seats[i].id]) return false;
    const id = G.seats[i].id;
    G.auto[id] = false;
    G.timeouts[id] = 0;
    pushLog(G, G.seats[i].name + 'が自分で出すのにもどった');
    if (dueSeats(G.s).includes(i)) restartClock(G, settings);
    return true;
  }, 'もどせませんでした。もう一度ためしてね', round);
}

/* ── ホストが進める（CPU・時間切れ・通信が切れた人） ── */
async function hostRun(mutate, round) {
  if (state.hostBusy) return;
  state.hostBusy = true;
  try {
    await gameTx(mutate, '', round);
  } finally {
    state.hostBusy = false;
  }
}

function hostTick() {
  const room = state.room;
  const R = state.view;
  // 通信が切れている間は進めない（もどってから、最新のルームで決めなおす）
  if (state.role !== 'host' || !room || !R || R.phase !== 'play' || state.hostBusy || state.leaving || !state.isConnected) return;
  const g = R.game;
  const G = R.G;
  if (g.over) return;
  const now = Date.now();
  // 新しい回になったら、在室の記録と CPU の待ちを決めなおす
  if (state.tickRound !== R.round) {
    state.tickRound = R.round;
    state.seenAway = null;
    state.awaySince = {};
    state.cpuKey = null;
  }

  // 席の人の通信が切れた・もどったら、できごとに書く（自分の番にもどったら、考える時間をはじめから）
  const awayNow = {};
  G.seats.forEach((seat, i) => {
    if (seat.cpu || g.done[i]) return;
    const st = seatState(room, G, i, true);
    awayNow[seat.id] = st.away;
    if (st.away && !state.awaySince[seat.id]) state.awaySince[seat.id] = now;
    if (!st.away) delete state.awaySince[seat.id];
  });
  if (!state.seenAway) state.seenAway = awayNow;
  const changed = Object.keys(awayNow).filter((id) => !!state.seenAway[id] !== awayNow[id]);
  if (changed.length) {
    const snapshot = awayNow;
    hostRun((rm, GG, settings) => {
      changed.forEach((id) => {
        const i = GG.seats.findIndex((x) => x.id === id);
        if (i < 0) return;
        if (snapshot[id]) pushLog(GG, GG.seats[i].name + 'の通信が切れた。もどるまでCPUが代わりに出すよ');
        else {
          pushLog(GG, GG.seats[i].name + 'がもどってきた');
          if (!GG.auto[id] && dueSeats(GG.s).includes(i)) restartClock(GG, settings);
        }
      });
      return true;
    }, R.round).then(() => { state.seenAway = snapshot; });
    return;
  }

  const due = dueSeats(g);
  const grace = (i) => {
    const since = state.awaySince[G.seats[i].id];
    return !!since && now - since < LEAVE_GRACE_MS;
  };
  const bots = due.filter((i) => cpuSeat(R, i) && !grace(i));
  const humans = due.filter((i) => !cpuSeat(R, i));
  if (bots.length) {
    const key = R.round + ':' + g.seq + ':' + bots[0];
    if (state.cpuKey !== key) {
      state.cpuKey = key;
      state.cpuAt = now + CPU_DELAY_MS;
      return;
    }
    if (now < state.cpuAt) return;
    const i = bots[0];
    const seq = g.seq;
    hostRun((rm, GG, settings) => {
      if (GG.s.seq !== seq || !seatState(rm, GG, i, true).cpu) return false;
      return applyMove(rm, GG, i, E.cpuMove(GG.s, i), 'cpu', settings);
    }, R.round);
  } else if (humans.length && R.deadline && RoomkRTDB.now() >= R.deadline) {
    const seq = g.seq;
    const deadline = R.deadline;
    hostRun((rm, GG, settings) => {
      if (GG.s.seq !== seq || GG.deadline !== deadline) return false;
      humans.forEach((i) => { if (dueSeats(GG.s).includes(i) && !seatState(rm, GG, i, true).cpu) timeUp(rm, GG, i, settings); });
      return true;
    }, R.round);
  }
}

/* ── 再接続用の記録（手札は保存しない） ── */
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
  ['lobbyPeople', 'lobbyRulesView', 'players', 'modes', 'field', 'log', 'hand', 'resultList', 'gameRules'].forEach((id) => $(id).replaceChildren());
  $('lobbyRules').replaceChildren();
  state.rulesKey = null;
  state.sel = [];
  state.selKey = '';
  state.selRound = null;
  state.fxSeq = -1;
  state.fxRound = -1;
  clearTimeout(state.splashTimer);
  $('splash').hidden = true;
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  state.tickTimer?.stop();
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
    view: null,
    joinedAt: null,
    timerInterval: null,
    tickTimer: null,
    orphanTimer: null,
    connectedRef: null,
    connectedCallback: null,
    roomCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    watchTimer: null,
    hostBusy: false,
    cpuKey: null,
    cpuAt: 0,
    awaySince: {},
    seenAway: null,
    tickRound: null,
    acting: false,
  });
  clearSession();
  resetBoxes();
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
    console.warn('[daifugo] room listener failed', error);
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
  state.tickTimer = startTicker(() => {
    hostTick();
    updateTimer();
  });
}

// ホストのタブは「みんなにみせる画面」を開くと裏に回る。裏のタブのタイマーは間引かれ（長く裏にあると1分に1回）、
// CPU や時間切れが止まってしまうので、進行の時計は Worker で回す（Worker のタイマーは間引かれにくい）
function startTicker(fn) {
  try {
    // Worker は terminate() で止める（自分で次を予約するだけの時計）
    const src = 'function tick() { postMessage(0); setTimeout(tick, ' + TICK_MS + '); } tick();';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    worker.onmessage = fn;
    return { stop: () => worker.terminate() };
  } catch {
    const id = setInterval(fn, TICK_MS);
    return { stop: () => clearInterval(id) };
  }
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
        if (!room || isExpired(room) || room.players?.[nickname] || nickname === room.host) return;
        // 席のある人（もどってくる人）は人数の上限を見ない
        const G = room.status === STATUS.PLAYING ? parseGame(room.game, true) : null;
        const seated = !!G && G.seats.some((x) => !x.cpu && x.name === nickname);
        if (!seated && Object.keys(room.players || {}).length - 1 >= MAX_GUESTS) {
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
    console.warn('[daifugo] presence recovery failed', error);
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
          cpuN: 0,
          settings: { rules: E.normRules(), time: { ...DEFAULT_TIME }, hint: true },
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
    console.warn('[daifugo] create failed', err);
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
      if (nickname === room.host || (stale && !mine)) { reason = '名前'; return; }
      // あそんでいる途中に、席のある人が入りなおすときは、人数の上限を見ない（別の端末からでも同じ名前なら席にもどる）
      const G = room.status === STATUS.PLAYING ? parseGame(room.game, true) : null;
      const seated = !!G && G.seats.some((x) => !x.cpu && x.name === nickname);
      if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
      else if (!seated && Object.keys(room.players || {}).length - 1 >= MAX_GUESTS) { reason = '満員'; return; }
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
    console.warn('[daifugo] join failed', err);
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
      if (player) joinedAt = Number(player.joinedAt) || joinedAt;
    } else {
      return false;
    }
    if (state.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
    return true;
  } catch (error) {
    console.warn('[daifugo] reconnect failed', error);
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
  if (role === 'guest' && state.view?.phase === 'play' && state.view.seats.includes(myId()) && !state.view.game.over
    && !window.confirm('退出すると、あなたの番はCPUが代わりに出すよ。同じ名前で入りなおすと、また自分で出せるよ。退出しますか？')) return;
  state.busy = true;
  state.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す（席と手札はゲームが終わるまで残す。入りなおせるように）
      await ref.transaction((room) => {
        if (!room) return;
        if (room.players?.[nickname]?.uid !== uid) return;
        const next = { ...room.players };
        delete next[nickname];
        return { ...room, players: next };
      });
    }
  } catch (error) {
    console.warn('[daifugo] leave failed', error);
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
  const R = makeView(room);
  state.view = R;
  if (R.phase === 'lobby') {
    state.seenAway = null;
    state.awaySince = {};
    renderLobby(R);
    showScreen('lobby');
  } else {
    renderGame(R);
    showScreen('game');
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

/* ── 待合室 ── */
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
    console.warn('[daifugo] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    state.busy = false;
  }
}

const SETTING_FAIL = '設定を変えられませんでした。もう一度ためしてね';
function setSettings(change) {
  return hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const cur = settingsOf(room);
    return { ...room, settings: { ...cur, ...change(cur) } };
  }, SETTING_FAIL);
}

function setHostPlays(value) {
  return hostTransaction((room) => (room.status === STATUS.WAITING ? { ...room, hostPlays: !!value } : undefined), SETTING_FAIL);
}

function addCpu() {
  return hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    const R = makeView(room);
    if (players(R).length >= E.PLAYERS_MAX) return;
    const n = (Number(room.cpuN) || 0) + 1;
    return { ...room, cpuN: n, cpus: { ...(room.cpus || {}), ['c' + n]: { name: 'CPU ' + n, joinedAt: RoomkRTDB.now() } } };
  }, 'CPUを足せませんでした。もう一度ためしてね');
}

function removeCpu(key) {
  return hostTransaction((room) => {
    if (room.status !== STATUS.WAITING || !room.cpus?.[key]) return;
    const cpus = { ...room.cpus };
    delete cpus[key];
    // CPU がいなくなったら、名前の番号を1からにもどす
    return { ...room, cpus, cpuN: Object.keys(cpus).length ? room.cpuN : 0 };
  }, 'CPUを外せませんでした。もう一度ためしてね');
}

// 配る（again: 同じ席でもう一回）
async function startGame(again = false) {
  let count = 0;
  const ok = await hostTransaction((room) => {
    if (again ? room.status !== STATUS.PLAYING : room.status !== STATUS.WAITING) return;
    let seats;
    if (again) {
      const old = parseGame(room.game, true);
      if (!old || !old.s.over) return;
      seats = old.seats;
    } else {
      seats = players(makeView(room)).map((p) => ({ id: p.id, name: p.name, cpu: p.kind === 'cpu' }));
    }
    if (seats.length < E.PLAYERS_MIN) return;
    const settings = settingsOf(room);
    // 前回と同じ人たちなら、前回のあがり順を使う（呼び名・カード交換）
    const last = parseJson(room.lastOrder);
    const prev = Array.isArray(last) && last.length === seats.length ? last.map((id) => seats.findIndex((x) => x.id === id)) : null;
    const okPrev = !!prev && prev.every((k) => k >= 0);
    const G = {
      seats,
      s: E.newGame(seats.length, settings.rules, undefined, okPrev ? prev : null),
      log: [], logN: 0, deadline: null, auto: {}, timeouts: {},
    };
    pushLog(G, startText(G, Array.isArray(last) && !okPrev));
    resetClock(G, settings);
    count = seats.length;
    return { ...room, status: STATUS.PLAYING, round: (Number(room.round) || 0) + 1, game: JSON.stringify(G) };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count(again ? 'again' : 'start');
    window.RoomkStats?.count('players-' + count);
  }
}

function backToLobby() {
  return hostTransaction((room) => (room.status === STATUS.PLAYING ? { ...room, status: STATUS.WAITING, game: null } : undefined),
    '待合室にもどれませんでした。もう一度ためしてね');
}

function segment(name, opts, value, onPick) {
  const seg = el('div', 'df-seg');
  seg.style.setProperty('--n', String(opts.length));
  opts.forEach(([v, label]) => {
    const lb = el('label', 'df-seg__opt');
    const r = el('input');
    r.type = 'radio';
    r.name = name;
    r.value = String(v);
    r.checked = value === v;
    r.addEventListener('change', () => onPick(v));
    lb.append(r, el('span', '', label));
    seg.append(lb);
  });
  return seg;
}

function checkRow(label, sub, checked, onToggle, key) {
  const lb = el('label', 'df-check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = checked;
  if (key) c.dataset.rule = key;
  c.addEventListener('change', () => onToggle(c.checked));
  const txt = el('span', 'df-check__text');
  txt.append(el('span', 'df-check__label', label));
  if (sub) txt.append(el('span', 'df-check__sub', sub));
  lb.append(c, txt);
  return lb;
}

function rulesEditor(root, R) {
  const rules = { ...R.rules };
  root.replaceChildren();

  const fsR = el('fieldset', 'df-fieldset');
  fsR.append(el('legend', 'df-legend', '使うルール'));
  const grid = el('div', 'df-checks');
  RULE_ITEMS.forEach(([key, label, sub]) => {
    grid.append(checkRow(label, sub, !!rules[key], (v) => setSettings((cur) => ({ rules: { ...cur.rules, [key]: v } })), key));
  });
  fsR.append(grid);

  const fsJ = el('fieldset', 'df-fieldset');
  fsJ.append(el('legend', 'df-legend', 'ジョーカー'));
  fsJ.append(segment('rule-jokers', JOKER_OPTS, rules.jokers, (v) => setSettings((cur) => ({ rules: { ...cur.rules, jokers: v } }))));

  const fsC = el('fieldset', 'df-fieldset');
  fsC.append(el('legend', 'df-legend', '2回目からのルール（前回と同じ人たちのとき）'));
  const grid2 = el('div', 'df-checks');
  grid2.append(checkRow('カード交換をする', '配ったあと、前回の大貧民は強いカード2枚を大富豪へ、大富豪は好きなカード2枚を大貧民へわたす（4人以上は富豪と貧民も1枚）。大貧民から出す',
    !!rules.exchange, (v) => setSettings((cur) => ({ rules: { ...cur.rules, exchange: v } })), 'exchange'));
  grid2.append(checkRow('都落ち', '前回の大富豪がいちばんにあがれなかったら、その場で手札を捨てて抜け、大貧民になる',
    !!rules.miyakoOchi, (v) => setSettings((cur) => ({ rules: { ...cur.rules, miyakoOchi: v } })), 'miyakoOchi'));
  fsC.append(grid2);

  const fsT = el('fieldset', 'df-fieldset');
  fsT.append(el('legend', 'df-legend', '1回に考える時間'));
  fsT.append(segment('time-limit', TIME_OPTS, R.time.limit, (v) => setSettings((cur) => ({ time: { ...cur.time, limit: v } }))));
  const fsO = el('fieldset', 'df-fieldset');
  fsO.append(el('legend', 'df-legend', '時間切れのとき'));
  fsO.append(segment('time-out', TIMEOUT_OPTS, R.time.onTimeout, (v) => setSettings((cur) => ({ time: { ...cur.time, onTimeout: v } }))));
  fsO.append(el('p', 'df-note', '場が空いているときは、パスのかわりにCPUが1枚出す。' + AUTO_AFTER + '回続けて時間切れになった人は、CPUが代わりに出す（「自分でやる」でもどれる）。'));
  fsO.disabled = !R.time.limit;
  fsO.classList.toggle('is-off', !R.time.limit);

  const fsH = el('fieldset', 'df-fieldset');
  fsH.append(el('legend', 'df-legend', '補助'));
  fsH.append(checkRow('出せるカードを目立たせる', '自分の番に、出せないカードを薄くする', R.hint, (v) => setSettings(() => ({ hint: v }))));

  root.append(fsR, fsJ, fsC, fsT, fsO, fsH);
}

// 設定の一覧（参加する人・いまのルール）
function rulesSummary(R) {
  const rules = R.rules;
  const on = RULE_ITEMS.filter(([k]) => rules[k]).map(([, label]) => label);
  const off = RULE_ITEMS.filter(([k]) => !rules[k]).map(([, label]) => label);
  const items = [
    ['使う', on.length ? on.join('・') : 'なし（同じ数をまとめて出すだけ）'],
    ['使わない', off.length ? off.join('・') : 'なし'],
    ['ジョーカー', rules.jokers ? rules.jokers + '枚' : 'なし'],
    ['カード交換', rules.exchange ? 'あり（2回目から）' : 'なし'],
    ['都落ち', rules.miyakoOchi ? 'あり（2回目から）' : 'なし'],
    ['考える時間', R.time.limit ? R.time.limit + '秒（時間切れは' + (R.time.onTimeout === 'cpu' ? 'CPUが代わりに出す' : 'パス') + '）' : 'なし'],
  ];
  return items.map(([k, v]) => {
    const li = el('li', 'df-rulesview__item');
    li.append(el('span', 'df-rulesview__key', k), el('span', 'df-rulesview__val', v));
    return li;
  });
}

function renderLobby(R) {
  const isHost = state.role === 'host';
  const watch = state.role === 'spectator';
  $('lobbyJoin').hidden = !watch;
  $('lobbyJoinCode').textContent = R.code || '';

  const inGame = new Set(players(R).map((p) => p.id));
  $('lobbyPeople').replaceChildren(...R.people.map((p) => {
    const li = el('li', 'df-person');
    li.append(msIcon(p.kind === 'cpu' ? 'smart_toy' : 'person'), el('span', 'df-person__name', p.name + (p.id === myId() && !watch ? '（あなた）' : '')));
    if (p.id === R.hostId) li.append(el('span', 'df-tag df-tag--muted', 'ホスト'));
    if (p.kind === 'cpu') li.append(el('span', 'df-tag df-tag--cpu', 'CPU'));
    if (p.away) li.append(el('span', 'df-tag df-tag--warn', '通信が切れた'));
    else li.append(el('span', 'df-tag ' + (inGame.has(p.id) ? 'df-tag--play' : 'df-tag--watch'), inGame.has(p.id) ? 'あそぶ' : '見る'));
    if (isHost && p.kind === 'cpu') {
      const del = el('button', 'df-quiet df-person__del', '外す');
      del.type = 'button';
      del.addEventListener('click', () => removeCpu(p.id.slice(2)));
      li.append(del);
    }
    return li;
  }));
  const n = inGame.size;
  let note = 'あそぶ人 ' + n + '人（' + E.PLAYERS_MIN + '〜' + E.PLAYERS_MAX + '人）。';
  if (n < E.PLAYERS_MIN) note += 'あと' + (E.PLAYERS_MIN - n) + '人でいっしょにあそべるよ。' + (isHost ? 'CPUを足してもいい' : '');
  else if (canSit(R).length > E.PLAYERS_MAX) note += E.PLAYERS_MAX + '人をこえた人は、見る人になるよ';
  $('lobbyCount').textContent = note;
  $('lobbyHostSeat').hidden = !isHost;
  if (isHost) {
    $('hostPlays').checked = !!R.hostPlays;
    $('btnAddCpu').disabled = n >= E.PLAYERS_MAX;
  }

  $('lobbyRules').hidden = !isHost;
  $('lobbyRulesView').hidden = isHost;
  if (isHost) {
    const key = JSON.stringify([R.rules, R.time, R.hint]);
    if (state.rulesKey !== key) {
      rulesEditor($('lobbyRules'), R);
      state.rulesKey = key;
    }
  } else $('lobbyRulesView').replaceChildren(...rulesSummary(R));

  $('lobbyHost').hidden = !isHost;
  if (isHost) $('btnStartGame').disabled = n < E.PLAYERS_MIN;
  $('lobbyWait').hidden = isHost || watch;
}

/* ── あそんでいる間 ── */
function cardEl(c, tag) {
  const red = !E.isJoker(c) && (E.suitOf(c) === 'H' || E.suitOf(c) === 'D');
  const b = el(tag || 'span', 'df-card' + (E.isJoker(c) ? ' is-joker' : red ? ' is-red' : ''));
  if (E.isJoker(c)) {
    b.append(el('span', 'df-card__rank', '★'), el('span', 'df-card__suit df-card__suit--joker', 'JOKER'));
  } else {
    b.append(el('span', 'df-card__rank', E.rankLabel(E.rankOf(c))), el('span', 'df-card__suit', E.SUIT_MARK[E.suitOf(c)]));
  }
  b.setAttribute('aria-label', E.cardLabel(c));
  b.dataset.card = c;
  return b;
}

function renderGame(R) {
  const g = R.game;
  const isHost = state.role === 'host';
  const watch = state.role === 'spectator';
  const myIdx = watch ? -1 : R.seats.indexOf(myId());
  const actor = g.over ? -1 : actorOf(g);
  const due = dueSeats(g);
  const dir = E.dirOf(g);

  // あそぶ人
  $('players').replaceChildren(...R.seats.map((id, i) => {
    const p = personOf(R, id);
    const turn = due.includes(i);
    const box = el('div', 'df-player' + (turn ? ' is-turn' : '') + (g.done[i] ? ' is-done' : '') + (i === myIdx ? ' is-me' : ''));
    const top = el('div', 'df-player__top');
    top.append(msIcon(p && p.kind === 'cpu' ? 'smart_toy' : 'person', 'df-player__icon'));
    top.append(el('span', 'df-player__name', seatName(R, i) + (i === myIdx ? '（あなた）' : '')));
    const count = el('span', 'df-player__count');
    if (!g.done[i]) count.append(el('strong', '', String(g.hands[i].length)), document.createTextNode('枚'));
    top.append(count);
    const tags = el('div', 'df-player__tags');
    const place = g.places.indexOf(i);
    if (g.over) tags.append(el('span', 'df-tag df-tag--win', (place + 1) + '番'));
    else if (g.done[i] && g.fouls.includes(i)) tags.append(el('span', 'df-tag df-tag--warn', '反則あがり'));
    else if (g.done[i] && g.fallen === i) tags.append(el('span', 'df-tag df-tag--warn', '都落ち'));
    else if (g.done[i] && place >= 0) tags.append(el('span', 'df-tag df-tag--win', (place + 1) + '番であがり'));
    else if (turn) tags.append(el('span', 'df-tag df-tag--turn', g.exchange ? '返すカードを選び中' : g.pending ? '捨てるカードを選び中' : '番'));
    else if (g.passed[i]) tags.append(el('span', 'df-tag df-tag--muted', 'パス'));
    if (!g.over && (g.rules.exchange || g.rules.miyakoOchi) && g.prev) tags.append(el('span', 'df-tag df-tag--rank', rankWord(g, i)));
    if (!g.over && p && p.away) tags.append(el('span', 'df-tag df-tag--warn', '通信が切れた・CPUが代わり'));
    else if (!g.over && p && p.auto) tags.append(el('span', 'df-tag df-tag--cpu', 'CPUが代わり'));
    box.append(top, tags);
    return box;
  }));

  // 強さ・しばり
  const modes = [];
  if (g.rev && g.back) modes.push(['revolution', '革命中にイレブンバック（いまはふつうの強さ）']);
  else if (g.rev) modes.push(['revolution', '革命中（3がいちばん強い）']);
  else if (g.back) modes.push(['back', 'イレブンバック中（場が流れるまで3がいちばん強い）']);
  if (g.lock) modes.push(['lock', 'しばり：' + g.lock.map((x) => E.SUIT_MARK[x]).join('') + 'だけ']);
  $('modes').replaceChildren(...modes.map(([k, t]) => el('span', 'df-mode df-mode--' + k, t)));
  $('modes').hidden = !modes.length;

  // 場
  if (g.field) {
    $('field').replaceChildren(...g.field.play.cards.map((c) => cardEl(c)));
    $('fieldBy').textContent = seatName(R, g.field.by) + 'が出したカード' + (g.field.play.as ? '（' + E.rankLabel(g.field.play.as) + 'として）' : '');
  } else {
    $('field').replaceChildren(el('p', 'df-field__empty', '場は空いているよ'));
    $('fieldBy').textContent = '';
  }

  // できごと
  const logs = R.log.slice(-3);
  $('log').replaceChildren(...logs.map((x, k) => el('li', 'df-log__item' + (k === logs.length - 1 ? ' is-new' : ''), x.text)));
  if (R.round !== state.fxRound) {
    // 新しい回（前の回の演出は消す）
    clearTimeout(state.splashTimer);
    $('splash').hidden = true;
    state.fxRound = R.round;
    state.fxSeq = g.seq;
  } else if (g.seq !== state.fxSeq) {
    const fx = ['revolution', 'revolution-back', 'eight', 'back', 'spade3', 'lock'].find((f) => g.last?.fx?.includes(f));
    if (fx) splash(FX_SPLASH[fx]);
    state.fxSeq = g.seq;
  }

  // いまの番
  const myGive = g.exchange && g.exchange.pairs.find((x) => x.rich === myIdx && !x.down);
  let status = '';
  if (g.over) status = 'おしまい！';
  else if (myGive) status = 'カード交換：' + seatName(R, myGive.poor) + 'に返すカードを' + myGive.k + '枚選んでね';
  else if (g.exchange) status = 'カード交換中。' + givers(g).map((i) => seatName(R, i)).join('と') + 'が返すカードを選んでいるよ';
  else if (actor === myIdx) status = g.pending ? '10捨て：捨てるカードを' + g.pending.n + '枚まで選んでね' : 'あなたの番だよ' + (g.field ? '' : '。好きなカードを出せるよ');
  else status = seatName(R, actor) + (g.pending ? 'が捨てるカードを選んでいるよ' : 'の番') + (cpuSeat(R, actor) ? '（CPUが出すよ）' : '');
  $('gameStatus').textContent = status;
  $('gameStatus').classList.toggle('is-mine', myIdx >= 0 && due.includes(myIdx));
  $('turnBox').hidden = g.over;
  $('table').hidden = g.over;
  updateTimer();

  // 自分の手札
  const seated = myIdx >= 0 && !g.over;
  $('mine').hidden = !seated;
  if (seated) renderMine(R, g, myIdx, actor, dir);

  // 結果
  $('result').hidden = !g.over;
  if (g.over) {
    $('resultList').replaceChildren(...g.places.map((i, k) => {
      const li = el('li', 'df-result__item' + (i === myIdx ? ' is-me' : ''));
      li.append(el('span', 'df-result__place', (k + 1) + '番'), el('span', 'df-result__name', seatName(R, i) + (i === myIdx ? '（あなた）' : '')));
      li.append(el('span', 'df-tag df-tag--rank', E.titleOf(g.n, k)));
      if (g.fouls.includes(i)) li.append(el('span', 'df-tag df-tag--warn', '反則あがり'));
      if (g.fallen === i) li.append(el('span', 'df-tag df-tag--warn', '都落ち'));
      return li;
    }));
    $('resultHost').hidden = !isHost;
    $('resultWait').hidden = isHost || watch;
  }

  $('gameRules').replaceChildren(...rulesSummary(R));
  $('gameTools').hidden = !isHost || g.over;
}

function renderMine(R, g, myIdx, actor, dir) {
  const me = personOf(R, myId());
  const hand = g.hands[myIdx];
  const done = g.done[myIdx];
  const myTurn = actor === myIdx;
  const key = R.round + ':' + hand.join();
  if (key !== state.selKey) {
    state.sel = state.selRound === R.round ? state.sel.filter((c) => hand.includes(c)) : [];
    state.selKey = key;
    state.selRound = R.round;
  }
  $('autoBanner').hidden = !(me && me.auto) || done;
  $('mineDone').hidden = !done;
  if (done) {
    const place = g.places.indexOf(myIdx);
    $('mineDone').textContent = g.fouls.includes(myIdx) ? '反則あがり。のこりの人を見ていてね'
      : g.fallen === myIdx ? '都落ち。のこりの人を見ていてね' : (place + 1) + '番であがり！ のこりの人を見ていてね';
  }
  $('hand').hidden = done;

  // カード交換（自分がかかわる組だけ）
  const exPairs = g.exchange ? g.exchange.pairs : g.exchanged && g.seq < g.exSeq + g.n ? g.exchanged : [];
  const mp = exPairs.find((x) => x.rich === myIdx || x.poor === myIdx);
  const labels = (cs) => cs.map(E.cardLabel).join('・');
  const who = (i) => rankWord(g, i) + '（' + seatName(R, i) + '）';
  let exNote = '';
  let got = [];
  if (mp && !done) {
    const rich = mp.rich === myIdx;
    got = rich ? mp.up : mp.down || [];
    if (!mp.down) {
      exNote = rich ? who(mp.poor) + 'から ' + labels(mp.up) + ' をもらったよ。' + seatName(R, mp.poor) + 'に返すカードを' + mp.k + '枚選んでね'
        : who(mp.rich) + 'に ' + labels(mp.up) + ' をわたしたよ。返ってくる' + mp.k + '枚を待ってね';
    } else {
      exNote = rich ? 'カード交換で ' + labels(mp.up) + ' をもらって、' + labels(mp.down) + ' を返したよ'
        : 'カード交換で ' + labels(mp.up) + ' をわたして、' + labels(mp.down) + ' をもらったよ';
    }
  }
  $('exNote').hidden = !exNote;
  $('exNote').textContent = exNote;
  const giving = !!(mp && mp.rich === myIdx && !mp.down && g.exchange);

  // 出せるカード（補助）
  let playable = null;
  if (myTurn && !g.pending && R.hint) {
    playable = new Set();
    E.legalPlays(g, myIdx).forEach((m) => m.cards.forEach((c) => playable.add(c)));
    if ([...playable].some(E.isJoker)) hand.filter(E.isJoker).forEach((c) => playable.add(c));
  }
  $('hand').replaceChildren(...hand.map((c) => {
    const b = cardEl(c, 'button');
    b.type = 'button';
    const on = state.sel.includes(c);
    b.classList.toggle('is-sel', on);
    b.classList.toggle('is-dim', !!playable && !playable.has(c));
    b.classList.toggle('is-got', got.includes(c));
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.addEventListener('click', () => {
      state.sel = state.sel.includes(c) ? state.sel.filter((x) => x !== c) : state.sel.concat([c]);
      if (state.view) renderGame(state.view);
    });
    return b;
  }));

  const discarding = myTurn && !!g.pending;
  let asRow = [];
  $('actPlay').hidden = !myTurn || discarding || done;
  $('actDiscard').hidden = !discarding;
  $('actGive').hidden = !giving;
  let msg = '';
  if (giving) {
    $('btnGive').disabled = state.sel.length !== mp.k;
    msg = state.sel.length === mp.k ? labels(state.sel) + ' を返すよ' : state.sel.length > mp.k ? mp.k + '枚にしてね' : 'あと' + (mp.k - state.sel.length) + '枚選んでね';
  } else if (myTurn && !discarding) {
    const chk = state.sel.length ? E.check(g, myIdx, state.sel) : null;
    // ジョーカーだけを出すときは「何として出すか」を選ぶ（オンのルールの分だけ。手札がなくなるなら10捨ては出さない）
    const asOpts = chk && chk.ok && state.sel.every(E.isJoker)
      ? E.asOptions(g.rules).filter((r) => (r !== 10 || hand.length > state.sel.length) && (r !== 11 || !g.back)) : [];
    asRow = asOpts;
    $('btnPlay').disabled = !(chk && chk.ok);
    $('btnPlay').hidden = asOpts.length > 0;
    $('btnPass').disabled = !g.field;
    if (!state.sel.length) msg = g.field ? '出すカードを選んでね。出せないときはパス' : '出すカードを選んでね';
    else if (!chk.ok) msg = (REASON[chk.reason] || (() => ''))(g.rules, dir);
    else if (asOpts.length) msg = 'ジョーカーを何として出す？（強さはいちばん強いまま）';
    else msg = labels(state.sel) + ' を出せるよ';
  } else if (discarding) {
    const over = state.sel.length > g.pending.n;
    $('btnDiscard').disabled = !state.sel.length || over;
    msg = over ? g.pending.n + '枚までだよ' : state.sel.length ? state.sel.length + '枚 捨てる' : '捨てるカードを選んでね（捨てなくてもいい）';
  } else if (!done && state.sel.length) msg = '選んでおけるよ。自分の番になったら出してね';
  $('selMsg').textContent = msg;
  $('actAs').hidden = !asRow.length;
  $('actAs').replaceChildren(...asRow.length ? [['そのまま', 0]].concat(asRow.map((r) => [AS_LABEL[r], r])).map(([label, r]) => {
    const b = el('button', 'btn ' + (r ? 'btn-secondary' : 'btn-primary'), label);
    b.type = 'button';
    b.dataset.as = String(r);
    b.addEventListener('click', () => act('play', state.sel.slice(), r || undefined));
    return b;
  }) : []);
  $('btnClear').hidden = !state.sel.length;
  $('btnClearGive').hidden = !state.sel.length;
}

// 残り時間（ホストの決めた締め切りまで）
function updateTimer() {
  const R = state.view;
  const g = R && R.game;
  const show = !!(R && R.phase === 'play' && g && !g.over && R.deadline && R.time.limit && dueSeats(g).some((i) => !cpuSeat(R, i)));
  $('timer').hidden = !show;
  if (!show) return;
  const left = Math.max(0, R.deadline - RoomkRTDB.now());
  const sec = Math.ceil(left / 1000);
  $('timerNum').textContent = 'のこり ' + sec + '秒';
  $('timerBar').style.width = Math.min(100, (left / (R.time.limit * 1000)) * 100) + '%';
  $('timer').classList.toggle('is-low', sec <= 5);
}

function splash(text) {
  const s = $('splash');
  s.textContent = text;
  s.hidden = false;
  s.classList.remove('is-on');
  void s.offsetWidth; // eslint-disable-line no-void
  s.classList.add('is-on');
  clearTimeout(state.splashTimer);
  state.splashTimer = setTimeout(() => { s.hidden = true; }, SPLASH_MS);
}

/* ── みんなにみせる画面（見るだけ。書き込まない） ── */
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
    console.warn('[daifugo] watch failed', error);
    fail('接続できませんでした。もう一度ためしてね');
    return false;
  } finally {
    state.busy = false;
    $('btnWatchOpen').disabled = false;
  }
}

function connectWatch(code, ref) {
  state.role = 'spectator';
  state.tickTimer?.stop();
  state.tickTimer = startTicker(updateTimer);
  // 共有するタブ・ウィンドウを選ぶときに見分けられるよう、題名と見出しを変える
  document.title = 'みんなにみせる画面 | 大富豪 | room-K';
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
    console.warn('[daifugo] watch listener failed', error);
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
  state.tickTimer?.stop();
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, view: null, roomCallback: null, watchTimer: null, tickTimer: null });
  resetBoxes();
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
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
$('btnCopyLink').addEventListener('click', (event) => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkRTDB.copyRoomLink(state.roomCode, event.currentTarget);
});

// 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
$('btnShowQr')?.addEventListener('click', () => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkQR.show(state.roomCode);
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
$('btnAddCpu').addEventListener('click', addCpu);
$('btnStartGame').addEventListener('click', () => startGame(false));
$('btnPlay').addEventListener('click', () => act('play', state.sel.slice()));
$('btnPass').addEventListener('click', () => act('pass'));
$('btnClear').addEventListener('click', () => {
  state.sel = [];
  if (state.view) renderGame(state.view);
});
$('btnClearGive').addEventListener('click', () => {
  state.sel = [];
  if (state.view) renderGame(state.view);
});
$('btnGive').addEventListener('click', () => act('give', state.sel.slice()));
$('btnDiscard').addEventListener('click', () => act('discard', state.sel.slice()));
$('btnNoDiscard').addEventListener('click', () => act('discard', []));
$('btnSelf').addEventListener('click', takeBack);
$('btnAgain').addEventListener('click', () => startGame(true));
$('btnRelobby').addEventListener('click', backToLobby);
$('btnStop').addEventListener('click', () => {
  if (window.confirm('この回をやめて、待合室にもどる？')) backToLobby();
});

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
