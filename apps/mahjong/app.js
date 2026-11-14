/* 麻雀 — ルーム型（Realtime Database）
   ・ゲームの状態（山・手牌・捨て牌・できごと・締め切り）は room.game に JSON の文字列で持つ。
     RTDB は空の配列を消すので、ルールの状態をそのまま置くと読み戻せないため。
   ・席はいつも4つ。あそぶ人（ホストをふくむ）が4人に足りない分は、はじめるときに CPU が入る。
   ・CPU の席・通信が切れた人・まかせた人の番と、時間切れは、ホストの画面が transaction で進める
     （ホストの通信が切れている間は止まる）。
   ・手牌は自分の分だけ画面に出す（DevTools で見えるのは性善説で許容）。
   ・ルームの作成・参加・在室・再接続・みんなにみせる画面は、大富豪（apps/daifugo）と同じ形。 */
const E = window.MahjongEngine;
const A = window.MahjongArt;
const { authReady, db } = RoomkRTDB.initFirebase(firebase);
const DB_PREFIX = 'mahjong_rooms';
const SESSION_KEY = 'mahjong_session';
const VIEW_KEY = 'mahjong:view';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
const STATUS = { WAITING: 'waiting', PLAYING: 'playing' };
const DEFAULT_TITLE = document.title;

const SEATS = 4;
const MAX_GUESTS = 12;
const TICK_MS = 250;
const LEAVE_GRACE_MS = 3000;   // 通信が切れてから、CPU が代わりに打つまで待つ時間（読み込み直しならその間にもどれる）
const CPU_DELAY_MS = 900;
const AUTO_AFTER = 2;          // 捨てる番で時間切れがこの回数続いたら CPU にまかせる
const LOG_MAX = 6;
const CPU_NAMES = ['CPU 1', 'CPU 2', 'CPU 3'];

const TIME_OPTS = [[0, 'なし'], [30, '30秒'], [60, '60秒'], [90, '90秒']];
const LEVEL_OPTS = [['easy', 'やさしい'], ['normal', 'ふつう']];
const DEFAULT_SETTINGS = { calls: true, chiitoi: true, level: 'easy', time: 60 };
// 自分の席から見た、ほかの人の置き場所（左・向かい・右）。番は 自分 → 右 → 向かい → 左 の順に回る
const PLACES = [[3, '左'], [2, '向かい'], [1, '右']];

const state = {
  role: null,          // 'host' | 'guest' | 'spectator'
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,
  view: null,
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
  watchTimer: null,
  tickTimer: null,
  roomFold: null,
  // ホストだけが使う
  hostBusy: false,
  cpuKey: null,
  cpuAt: 0,
  awaySince: {},
  seenAway: null,
  tickRound: null,
  // 端末の中だけで持つ状態
  acting: false,
  gameCache: { raw: null, val: null },
  rulesKey: null,
  shownRev: null,
  opts: loadViewOpts(),
};
const $ = (id) => document.getElementById(id);

/* ── 共通 ── */
function showScreen(id) {
  if (id === 'game' && state.currentScreen !== 'game') window.scrollTo(0, 0);
  document.querySelectorAll('.mj-screen').forEach((node) => node.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  state.currentScreen = id;
  $('roomBar').hidden = !state.roomRef;
  const fold = id === 'game';
  $('roomBar').classList.toggle('is-fold', fold);
  $('btnRoomMore').hidden = !fold;
  if (state.roomFold !== fold) { setRoomMore(false); state.roomFold = fold; }
  if (id !== 'game' && state.role !== 'spectator') document.title = DEFAULT_TITLE;
}

function setRoomMore(open) {
  $('roomBar').classList.toggle('is-open', open);
  $('btnRoomMore').setAttribute('aria-expanded', open ? 'true' : 'false');
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

// ヒント・そろった組の枠・牌の名前は、この端末だけの見え方（ルームには書かない。ひとりずつ選ぶ）
function loadViewOpts() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY));
    return { hint: v?.hint !== false, groups: v?.groups !== false, names: !!v?.names };
  } catch {
    return { hint: true, groups: true, names: false };
  }
}

function saveViewOpts() {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(state.opts));
  } catch {
    // 保存できないときは、読み込み直すと元にもどるだけ
  }
}

/* ── ルームの読み取り ── */
function byJoined(a, b) {
  return (Number(a.joinedAt) || 0) - (Number(b.joinedAt) || 0) || String(a.name).localeCompare(String(b.name), 'ja');
}

function settingsOf(room) {
  const s = room?.settings || {};
  const time = Number(s.time);
  return {
    calls: s.calls !== false,
    chiitoi: s.chiitoi !== false,
    level: s.level === 'normal' ? 'normal' : 'easy',
    time: TIME_OPTS.some(([v]) => v === time) ? time : DEFAULT_SETTINGS.time,
  };
}

function winsOf(room) {
  const w = parseJson(room?.wins);
  return w && typeof w === 'object' ? w : {};
}

// ゲームの状態を読む。壊れていたら null（読み取り専用の画面はキャッシュを使い、書きかえるときは毎回読み直す）
function parseGame(raw, fresh = false) {
  if (!fresh && state.gameCache.raw === raw) return state.gameCache.val;
  const G = parseJson(raw);
  const s = G?.s;
  const ok = Array.isArray(G?.seats) && G.seats.length === SEATS
    && G.seats.every((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
    && s && Array.isArray(s.seats) && s.seats.length === SEATS && Array.isArray(s.wall)
    && s.seats.every((x) => x && Array.isArray(x.hand) && Array.isArray(x.melds) && Array.isArray(x.river))
    && Number.isInteger(s.rev) && typeof s.phase === 'string';
  const val = ok ? {
    seats: G.seats,
    s: { ...s, disc: Number(s.disc) || 0, log: Array.isArray(s.log) ? s.log : [] },
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
function seatState(room, G, i, self = false) {
  const seat = G.seats[i];
  if (!seat || seat.cpu) return { kind: 'cpu', away: false, auto: false, cpu: true };
  const away = seat.name === room.host ? !self && room.hostConnected === false : !room.players?.[seat.name];
  const auto = !!G.auto[seat.id];
  return { kind: 'human', away, auto, cpu: away || auto };
}

function makeView(room) {
  const G = room.status === STATUS.PLAYING ? parseGame(room.game) : null;
  const people = [];
  Object.entries(room.players || {}).forEach(([name, p]) => {
    people.push({ id: 'p:' + name, name, kind: 'human', joinedAt: p?.joinedAt, away: name === room.host && room.hostConnected === false && state.role !== 'host' });
  });
  people.sort(byJoined);
  const seatInfo = G ? G.seats.map((seat, i) => seatState(room, G, i, state.role === 'host')) : [];
  return {
    code: state.roomCode,
    phase: G ? 'play' : 'lobby',
    people,
    hostId: 'p:' + room.host,
    hostPlays: room.hostPlays !== false,
    settings: settingsOf(room),
    wins: winsOf(room),
    round: Number(room.round) || 0,
    G,
    seatInfo,
  };
}

const myId = () => (state.nickname ? 'p:' + state.nickname : null);
// あそぶ人（「はじめる」で席に入る人）。4人まで、入った順
const canSit = (R) => R.people.filter((p) => !p.away && (p.id !== R.hostId || R.hostPlays));
const sitters = (R) => canSit(R).slice(0, SEATS);
const cpuSeat = (R, i) => !!R.seatInfo[i]?.cpu;

function isExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}

async function removeExpired(ref, fallback) {
  try {
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[mahjong] expired room cleanup failed', error);
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

/* ── ゲームを進める ── */
function pushLog(G, text) {
  if (!text) return;
  G.logN += 1;
  G.log.push({ n: G.logN, text });
  if (G.log.length > LOG_MAX) G.log.shift();
}

function resetClock(G, settings) {
  G.deadline = G.s.phase !== 'end' && settings.time ? RoomkRTDB.now() + settings.time * 1000 : null;
}

const tileName = (id) => E.kindName(E.kindOf(id));

// ルールの記録（s.log）に増えた分を、できごとの文にする
function describeNew(G, from, cause, by) {
  const name = (i) => (G.seats[i] ? G.seats[i].name : '（いない人）');
  const human = G.seats[by] && !G.seats[by].cpu;
  const tag = cause === 'cpu' && human ? '（CPUが代わり）' : '';
  const pre = cause === 'timeout' ? '時間切れ。' : '';
  G.s.log.slice(from).forEach((l) => {
    const who = name(l.seat) + (l.seat === by ? tag : '');
    if (l.t === 'discard') pushLog(G, pre + who + 'が ' + tileName(l.id) + ' を捨てた');
    else if (l.t === 'pon') pushLog(G, who + 'がポン');
    else if (l.t === 'chi') pushLog(G, who + 'がチー');
    else if (l.t === 'tsumo') pushLog(G, who + 'がツモ！ あがり');
    else if (l.t === 'ron') pushLog(G, who + 'がロン！ ' + name(l.from) + 'の ' + tileName(G.s.result.tile) + ' であがり');
    else if (l.t === 'draw-game') pushLog(G, '山がなくなった。引き分け');
  });
}

// 1つの操作を当てはめて、できごとを書く。ロン・ポン・チーを聞いている間の答えでは締め切りを動かさない
function applyMove(G, i, a, cause, settings) {
  let ns;
  try {
    ns = E.act(G.s, i, a);
  } catch {
    return false;
  }
  const from = G.s.log.length;
  const wasClaim = G.s.phase === 'claim';
  G.s = ns;
  describeNew(G, from, cause, i);
  if (!(wasClaim && ns.phase === 'claim')) resetClock(G, settings);
  return true;
}

// 時間切れ: 捨てる番は引いた牌をそのまま（鳴いたあとは CPU の選び方）、聞かれている間はパス
function timeUp(G, i, settings) {
  const s = G.s;
  if (s.phase === 'claim') {
    applyMove(G, i, { type: 'pass' }, 'timeout', settings);
    return;
  }
  const id = s.drawn !== null && s.seats[i].hand.includes(s.drawn) ? s.drawn : E.cpuAction(s, i)?.id;
  if (id == null || !applyMove(G, i, { type: 'discard', id }, 'timeout', settings)) {
    resetClock(G, settings);
    return;
  }
  const seat = G.seats[i];
  G.timeouts[seat.id] = (Number(G.timeouts[seat.id]) || 0) + 1;
  if (G.timeouts[seat.id] >= AUTO_AFTER && !G.auto[seat.id]) {
    G.auto[seat.id] = true;
    pushLog(G, seat.name + 'は時間切れが' + AUTO_AFTER + '回続いたので、CPUが代わりに打つよ（「自分でやる」でもどれる）');
  }
}

// ゲームの状態を transaction で書きかえる。mutate が false を返したら書かない。
// round: 押した時点の局。もどす・配りなおすをはさんだ古い操作を、新しい局に当てはめないように確かめる
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
      const wasOver = G.s.phase === 'end';
      if (!mutate(room, G, settings, uid)) return;
      const next = { ...room, game: JSON.stringify(G) };
      if (!wasOver && G.s.phase === 'end') {
        finished = true;
        const R = G.s.result;
        if (R && R.type !== 'draw') {
          const wins = winsOf(room);
          const id = G.seats[R.winner].id;
          wins[id] = (Number(wins[id]) || 0) + 1;
          next.wins = JSON.stringify(wins);
        }
      }
      return next;
    });
    if (result.committed && finished) window.RoomkStats?.count('finish');
    return result.committed;
  } catch (error) {
    console.warn('[mahjong] game update failed', error);
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

// 自分の操作（捨てる・ツモ・ロン・ポン・チー・パス）
async function act(a) {
  const g = state.view?.G?.s;
  if (state.acting || !g) return;
  state.acting = true;
  const claim = ['ron', 'pon', 'chi', 'pass'].includes(a.type);
  const rev = g.rev;
  const disc = g.disc;
  const round = state.view.round;
  try {
    const ok = await gameTx((room, G, settings, uid) => {
      // ロン・ポン・チー・パスはほかの人と同時に答えるので、同じ捨て牌への答えかだけを見る
      if (claim ? G.s.phase !== 'claim' || G.s.disc !== disc : G.s.rev !== rev) return false;
      const i = mySeatIn(room, G, uid);
      if (i < 0) return false;
      if (!applyMove(G, i, a, 'self', settings)) return false;
      const id = G.seats[i].id;
      G.auto[id] = false;
      G.timeouts[id] = 0;
      return true;
    }, '送れませんでした。もう一度ためしてね', round);
    if (ok === false) toast('そのあいだに場が変わったよ。もう一度選んでね', false);
  } finally {
    state.acting = false;
    // 送っている間は押せなくして描いている。終わったら描きなおす（ポンのあとなど、ルームの変化がもう来ないことがある）
    if (state.view?.phase === 'play') renderGame(state.view);
  }
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
    pushLog(G, G.seats[i].name + 'が自分で打つのにもどった');
    if (E.waitingFor(G.s).includes(i)) resetClock(G, settings);
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
  if (state.role !== 'host' || !room || !R || R.phase !== 'play' || state.hostBusy || state.leaving || !state.isConnected) return;
  const G = R.G;
  const g = G.s;
  if (g.phase === 'end') return;
  const now = Date.now();
  if (state.tickRound !== R.round) {
    state.tickRound = R.round;
    state.seenAway = null;
    state.awaySince = {};
    state.cpuKey = null;
  }

  // 席の人の通信が切れた・もどったら、できごとに書く（自分の番にもどったら、考える時間をはじめから）
  const awayNow = {};
  G.seats.forEach((seat, i) => {
    if (seat.cpu) return;
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
        if (snapshot[id]) pushLog(GG, GG.seats[i].name + 'の通信が切れた。もどるまでCPUが代わりに打つよ');
        else {
          pushLog(GG, GG.seats[i].name + 'がもどってきた');
          if (!GG.auto[id] && E.waitingFor(GG.s).includes(i)) resetClock(GG, settings);
        }
      });
      return true;
    }, R.round).then(() => { state.seenAway = snapshot; });
    return;
  }

  const due = E.waitingFor(g);
  const grace = (i) => {
    const since = state.awaySince[G.seats[i].id];
    return !!since && now - since < LEAVE_GRACE_MS;
  };
  const bots = due.filter((i) => cpuSeat(R, i) && !grace(i));
  const humans = due.filter((i) => !cpuSeat(R, i));
  if (bots.length && g.phase === 'claim') {
    // 聞かれている間の CPU の答えは、待たずにまとめて
    const disc = g.disc;
    hostRun((rm, GG, settings) => {
      if (GG.s.phase !== 'claim' || GG.s.disc !== disc) return false;
      let any = false;
      bots.forEach((i) => {
        if (GG.s.phase !== 'claim' || !E.waitingFor(GG.s).includes(i) || !seatState(rm, GG, i, true).cpu) return;
        const a = E.cpuAction(GG.s, i);
        if (a && applyMove(GG, i, a, 'cpu', settings)) any = true;
      });
      return any;
    }, R.round);
  } else if (bots.length) {
    const key = R.round + ':' + g.rev + ':' + bots[0];
    if (state.cpuKey !== key) {
      state.cpuKey = key;
      state.cpuAt = now + CPU_DELAY_MS;
      return;
    }
    if (now < state.cpuAt) return;
    const i = bots[0];
    const rev = g.rev;
    hostRun((rm, GG, settings) => {
      if (GG.s.rev !== rev || !seatState(rm, GG, i, true).cpu) return false;
      const a = E.cpuAction(GG.s, i);
      return !!a && applyMove(GG, i, a, 'cpu', settings);
    }, R.round);
  } else if (humans.length && G.deadline && RoomkRTDB.now() >= G.deadline) {
    const rev = g.rev;
    const deadline = G.deadline;
    hostRun((rm, GG, settings) => {
      if (GG.s.rev !== rev || GG.deadline !== deadline) return false;
      humans.forEach((i) => { if (E.waitingFor(GG.s).includes(i) && !seatState(rm, GG, i, true).cpu) timeUp(GG, i, settings); });
      return true;
    }, R.round);
  }
}

/* ── 再接続用の記録（手牌は保存しない） ── */
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
  ['lobbyPeople', 'lobbyRulesView', 'lobbyRules', 'opps', 'me', 'actions', 'hintLine', 'log', 'gameRules', 'resultHand'].forEach((id) => $(id).replaceChildren());
  state.rulesKey = null;
  state.shownRev = null;
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
    orphanAt: null,
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
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  state.roomCallback = (snap) => {
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
    console.warn('[mahjong] room listener failed', error);
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

// ホストのタブは「みんなにみせる画面」を開くと裏に回る。裏のタブのタイマーは間引かれ、
// CPU や時間切れが止まってしまうので、進行の時計は Worker で回す（Worker のタイマーは間引かれにくい）
function startTicker(fn) {
  try {
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

function needsPresence(room) {
  if (state.role === 'host') return room.hostConnected === false;
  if (state.role === 'guest') return !room.players?.[state.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる
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
    console.warn('[mahjong] presence recovery failed', error);
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
      const ref = db.ref(DB_PREFIX + '/' + code);
      const result = await transactRetry(ref, (room) => {
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
    console.warn('[mahjong] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

// ルームコード: 日本語入力のまま打った全角の英数字は半角に、小文字は大文字にそろえて読む。
// 入力欄は打っている間に書き換えない（変換中に書き換えると文字が重なる）
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
      const stale = room.players?.[nickname];
      const mine = !!stale && !stale.isHost && stale.uid === uid;
      if (nickname === room.host || (stale && !mine)) { reason = '名前'; return; }
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
    console.warn('[mahjong] join failed', err);
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
    console.warn('[mahjong] reconnect failed', error);
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
  const G = state.view?.G;
  if (role === 'guest' && G && G.s.phase !== 'end' && G.seats.some((x) => !x.cpu && x.name === nickname)
    && !window.confirm('退出すると、あなたの番はCPUが代わりに打つよ。同じ名前で入りなおすと、また自分で打てるよ。退出しますか？')) return;
  state.busy = true;
  state.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す（席と手牌は局が終わるまで残す。入りなおせるように）
      await ref.transaction((room) => {
        if (!room) return;
        if (room.players?.[nickname]?.uid !== uid) return;
        const next = { ...room.players };
        delete next[nickname];
        return { ...room, players: next };
      });
    }
  } catch (error) {
    console.warn('[mahjong] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.leaving = false;
    state.busy = false;
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
    // 切れたままのあいだに切れた時刻だけが新しくなったら、期限のタイマーを仕掛けなおす（2026-11-13 の作り）
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

/* ── 待合室 ── */
async function hostTransaction(update, failMessage, concurrent) {
  if (state.role !== 'host' || (!concurrent && state.busy) || !state.roomRef) return null;
  if (!concurrent) state.busy = true;
  const uid = currentUid();
  try {
    const result = await state.roomRef.transaction((room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      return update(room);
    });
    return result.committed;
  } catch (error) {
    console.warn('[mahjong] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    if (!concurrent) state.busy = false;
  }
}

const SETTING_FAIL = '設定を変えられませんでした。もう一度ためしてね';
function setSettings(change) {
  return hostTransaction((room) => {
    if (room.status !== STATUS.WAITING) return;
    return { ...room, settings: { ...settingsOf(room), ...change } };
  }, SETTING_FAIL, true);
}

function setHostPlays(value) {
  return hostTransaction((room) => (room.status === STATUS.WAITING ? { ...room, hostPlays: !!value } : undefined), SETTING_FAIL, true);
}

// はじめる（again: 同じ席で次の局）。親（はじめの人）は局ごとに1つずつ回る
async function startGame(again = false) {
  let humans = 0;
  const ok = await hostTransaction((room) => {
    if (again ? room.status !== STATUS.PLAYING : room.status !== STATUS.WAITING) return;
    let seats;
    if (again) {
      const old = parseGame(room.game, true);
      if (!old || old.s.phase !== 'end') return;
      seats = old.seats;
    } else {
      const people = sitters(makeView(room));
      if (!people.length) return;
      seats = people.map((p) => ({ id: p.id, name: p.name, cpu: false }));
      CPU_NAMES.slice(0, SEATS - seats.length).forEach((name, k) => seats.push({ id: 'c:' + (k + 1), name, cpu: true }));
    }
    const settings = settingsOf(room);
    const round = (Number(room.round) || 0) + 1;
    const s = E.createRound({
      seed: Math.floor(Math.random() * 2147483647),
      seats: seats.map((x) => ({ name: x.name, cpu: x.cpu })),
      dealer: (round - 1) % SEATS,
      calls: settings.calls, chiitoi: settings.chiitoi, level: settings.level,
    });
    const G = { seats, s, log: [], logN: 0, deadline: null, auto: {}, timeouts: {} };
    pushLog(G, '第' + round + '局。' + seats[s.dealer].name + 'から');
    resetClock(G, settings);
    humans = seats.filter((x) => !x.cpu).length;
    // 待合室からはじめるときは、あがった回数を0から
    const next = { ...room, status: STATUS.PLAYING, round, game: JSON.stringify(G) };
    if (!again) next.wins = '{}';
    return next;
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count(again ? 'again' : 'start');
    window.RoomkStats?.count('players-' + humans);
  }
}

function backToLobby() {
  return hostTransaction((room) => (room.status === STATUS.PLAYING ? { ...room, status: STATUS.WAITING, game: null } : undefined),
    '待合室にもどれませんでした。もう一度ためしてね');
}

function segment(name, opts, value, onPick) {
  const seg = el('div', 'mj-seg');
  seg.style.setProperty('--n', String(opts.length));
  opts.forEach(([v, label]) => {
    const lb = el('label', 'mj-seg__opt');
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
  const lb = el('label', 'mj-check');
  const c = el('input');
  c.type = 'checkbox';
  c.checked = checked;
  if (key) c.dataset.rule = key;
  c.addEventListener('change', () => onToggle(c.checked));
  const txt = el('span', 'mj-check__text');
  txt.append(el('span', 'mj-check__label', label));
  if (sub) txt.append(el('span', 'mj-check__sub', sub));
  lb.append(c, txt);
  return lb;
}

function fieldset(legend, ...children) {
  const fs = el('fieldset', 'mj-fieldset');
  fs.append(el('legend', 'mj-legend', legend), ...children);
  return fs;
}

function rulesEditor(box, S) {
  box.replaceChildren(
    fieldset('CPUの強さ', segment('rule-level', LEVEL_OPTS, S.level, (v) => setSettings({ level: v })),
      el('p', 'mj-note', 'やさしいは、ポンをせず、ときどき遠回りの牌を捨てる。ふつうは、近道を選んでポンもする（チーはしない）。')),
    fieldset('使うルール',
      checkRow('ポン・チーをする', 'ほかの人が捨てた牌をもらって、組を作れる', S.calls, (v) => setSettings({ calls: v }), 'calls'),
      checkRow('同じ2枚 × 7組でもあがり（七対子）', '組を4つ作らなくても、同じ2枚が7組そろえばあがり', S.chiitoi, (v) => setSettings({ chiitoi: v }), 'chiitoi')),
    fieldset('1回に考える時間', segment('time-limit', TIME_OPTS, S.time, (v) => setSettings({ time: v })),
      el('p', 'mj-note', '時間をすぎると、引いた牌をそのまま捨てる（ポン・チー・ロンを聞かれているときはパス）。捨てる番で' + AUTO_AFTER + '回続けて時間切れになった人は、CPUが代わりに打つ（「自分でやる」でもどれる）。')),
  );
}

function rulesSummary(S) {
  const items = [
    ['CPUの強さ', S.level === 'normal' ? 'ふつう' : 'やさしい'],
    ['ポン・チー', S.calls ? 'する' : 'しない'],
    ['七対子', S.chiitoi ? 'あがりにする' : 'あがりにしない'],
    ['考える時間', S.time ? S.time + '秒' : 'なし'],
  ];
  return items.map(([k, v]) => {
    const li = el('li', 'mj-rulesview__item');
    li.append(el('span', 'mj-rulesview__key', k), el('span', 'mj-rulesview__val', v));
    return li;
  });
}

function renderLobby(R) {
  const isHost = state.role === 'host';
  const watch = state.role === 'spectator';
  $('lobbyJoin').hidden = !watch;
  $('lobbyJoinCode').textContent = R.code || '';

  const inGame = new Set(sitters(R).map((p) => p.id));
  $('lobbyPeople').replaceChildren(...R.people.map((p) => {
    const li = el('li', 'mj-person');
    li.append(msIcon('person'), el('span', 'mj-person__name', p.name + (p.id === myId() && !watch ? '（あなた）' : '')));
    if (p.id === R.hostId) li.append(el('span', 'mj-tag mj-tag--muted', R.hostPlays ? 'ホスト' : '進行役'));
    if (p.away) li.append(el('span', 'mj-tag mj-tag--warn', '通信が切れた'));
    else li.append(el('span', 'mj-tag ' + (inGame.has(p.id) ? 'mj-tag--play' : 'mj-tag--watch'), inGame.has(p.id) ? 'あそぶ' : '見る'));
    return li;
  }));
  const n = inGame.size;
  let note = 'あそぶ人 ' + n + '人（1〜4人）。';
  if (n === 0) note += 'あそぶ人がいないよ。' + (isHost ? '「ホストもあそぶ」にするか、参加する人を待ってね' : '');
  else if (n < SEATS) note += 'あいている' + (SEATS - n) + '席はCPUが打つよ。';
  if (canSit(R).length > SEATS) note += SEATS + '人をこえた人は、見る人になるよ';
  $('lobbyCount').textContent = note;
  $('lobbyHostSeat').hidden = !isHost;
  if (isHost) $('hostPlays').checked = !!R.hostPlays;

  $('lobbyRules').hidden = !isHost;
  $('lobbyRulesView').hidden = isHost;
  if (isHost) {
    const key = JSON.stringify(R.settings);
    if (state.rulesKey !== key) {
      rulesEditor($('lobbyRules'), R.settings);
      state.rulesKey = key;
    }
  } else $('lobbyRulesView').replaceChildren(...rulesSummary(R.settings));

  $('lobbyHost').hidden = !isHost;
  if (isHost) $('btnStartGame').disabled = n < 1;
  $('lobbyWait').hidden = isHost || watch;
  $('lobbyView').hidden = watch;
}

/* ── 牌 ── */
function tileEl(k, o = {}) {
  const tag = o.button ? 'button' : 'span';
  const node = el(tag, 'mj-tile' + (o.size ? ' mj-tile--' + o.size : '') + (o.extra ? ' ' + o.extra : ''));
  // 牌の絵は自前の SVG の文字列（ユーザーの入力は入らない）
  node.insertAdjacentHTML('afterbegin', A.face(k));
  const name = E.kindName(k);
  if (o.button) {
    node.type = 'button';
    node.dataset.id = String(o.id);
    node.setAttribute('aria-label', name + 'を捨てる');
  } else {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', name);
  }
  if (state.opts.names && o.caption !== false) node.append(el('span', 'mj-cap', name));
  return node;
}

function backEl(size) {
  const node = el('span', 'mj-tile mj-tile--' + size + ' mj-tile--back');
  node.setAttribute('aria-hidden', 'true');
  node.insertAdjacentHTML('afterbegin', A.back());
  return node;
}

function riverEl(g, i, fresh) {
  const box = el('div', 'mj-river');
  box.setAttribute('aria-label', '捨て牌');
  const river = g.seats[i].river;
  river.forEach((r, k) => {
    const last = g.last && g.last.seat === i && k === river.length - 1 && !r.called;
    box.append(tileEl(E.kindOf(r.id), { size: 'sm', caption: false, extra: [r.called ? 'is-called' : '', last ? 'is-last' : '', last && fresh ? 'is-new' : ''].join(' ').trim() }));
  });
  return box;
}

function meldsEl(g, i, size) {
  const box = el('div', 'mj-melds');
  g.seats[i].melds.forEach((m) => {
    const label = m.type === 'pon' ? 'ポン' : 'チー';
    const node = el('span', 'mj-meld');
    node.setAttribute('aria-label', label + 'した組');
    node.append(el('span', 'mj-meld__label', label));
    m.tiles.forEach((id) => node.append(tileEl(E.kindOf(id), { size, caption: false, extra: id === m.called ? 'is-taken' : '' })));
    box.append(node);
  });
  return box;
}

/* ── あそんでいる間 ── */
function seatHead(R, i, myIdx) {
  const G = R.G;
  const seat = G.seats[i];
  const info = R.seatInfo[i] || {};
  const head = el('div', 'mj-seat__head');
  head.append(msIcon(seat.cpu ? 'smart_toy' : 'person', 'mj-seat__icon'));
  head.append(el('span', 'mj-name', seat.name + (i === myIdx ? '（あなた）' : '')));
  if (i === G.s.dealer) head.append(el('span', 'mj-tag mj-tag--muted', 'はじめ'));
  if (G.s.phase !== 'end' && info.away) head.append(el('span', 'mj-tag mj-tag--warn', '通信が切れた・CPUが代わり'));
  else if (G.s.phase !== 'end' && info.auto) head.append(el('span', 'mj-tag mj-tag--cpu', 'CPUが代わり'));
  head.append(el('span', 'mj-wins', 'あがり ' + (Number(R.wins[seat.id]) || 0)));
  return head;
}

function renderGame(R) {
  const G = R.G;
  const g = G.s;
  const isHost = state.role === 'host';
  const watch = state.role === 'spectator';
  const myIdx = watch ? -1 : G.seats.findIndex((x) => !x.cpu && x.name === state.nickname);
  const seated = myIdx >= 0;
  const over = g.phase === 'end';
  const due = over ? [] : E.waitingFor(g);
  const fresh = state.shownRev !== null && state.shownRev !== g.rev;
  const bottom = seated ? myIdx : 0;

  $('roundLine').textContent = '第' + R.round + '局 · はじめは ' + G.seats[g.dealer].name;
  $('wallCount').textContent = String(g.wall.length);

  // ほかの3人（左・向かい・右）
  $('opps').replaceChildren(...PLACES.map(([d, place]) => {
    const i = (bottom + d) % SEATS;
    const box = el('section', 'mj-opp' + (due.includes(i) ? ' is-turn' : ''));
    box.setAttribute('aria-label', G.seats[i].name);
    const head = seatHead(R, i, myIdx);
    head.insertBefore(el('span', 'mj-place', place), head.children[2]);
    const hand = el('div', 'mj-opp__hand');
    g.seats[i].hand.forEach(() => hand.append(backEl('xs')));
    hand.append(meldsEl(g, i, 'xs'));
    box.append(head, hand, riverEl(g, i, fresh));
    return box;
  }));

  // 自分（見る人は、最初の席を下に、手牌は裏で）
  const myTurn = seated && !over && g.phase === 'discard' && g.turn === myIdx;
  const me = $('me');
  me.classList.toggle('is-turn', due.includes(bottom));
  const advice = myTurn && state.opts.hint ? E.discardAdvice(g, myIdx) : null;
  const best = new Set(advice ? advice.list.filter((x) => x.best).map((x) => x.kind) : []);
  const hand = el('div', 'mj-hand' + (myTurn ? ' is-active' : ''));
  hand.setAttribute('aria-label', seated ? 'あなたの手牌' : '手牌');
  if (seated) {
    const drawn = myTurn ? g.drawn : null;
    const rest = g.seats[myIdx].hand.filter((id) => id !== drawn).sort((a, b) => a - b);
    const tile = (id) => {
      const b = tileEl(E.kindOf(id), { size: 'lg', button: true, id, extra: (best.has(E.kindOf(id)) ? 'is-best' : '') + (id === drawn && fresh ? ' is-drawn' : '') });
      b.disabled = !myTurn || state.acting;
      return b;
    };
    if (state.opts.groups) {
      // そろっている組は枠で囲む（引いた牌は右に離したまま、組には入れない）。組と、組に入らない牌を、種類の順に並べる
      const pool = rest.slice();
      const take = (k) => pool.splice(pool.findIndex((x) => E.kindOf(x) === k), 1)[0];
      const units = E.groupHand(E.counts(rest)).map((grp) => ({ k: grp.kinds[0], grp, ids: grp.kinds.map(take) }));
      pool.forEach((id) => units.push({ k: E.kindOf(id), ids: [id] }));
      units.sort((a, b) => a.k - b.k || (b.grp ? 1 : 0) - (a.grp ? 1 : 0));
      units.forEach((u) => {
        if (!u.grp) { hand.append(tile(u.ids[0])); return; }
        const box = el('span', 'mj-set mj-set--' + (u.grp.type === 'pair' ? 'pair' : 'meld'));
        box.setAttribute('role', 'group');
        box.setAttribute('aria-label', u.grp.type === 'pair' ? '同じ2枚' : 'そろった組');
        u.ids.forEach((id) => box.append(tile(id)));
        hand.append(box);
      });
    } else {
      rest.forEach((id) => hand.append(tile(id)));
    }
    if (drawn !== null && drawn !== undefined) hand.append(el('span', 'mj-gap'), tile(drawn));
  } else {
    g.seats[bottom].hand.forEach(() => hand.append(backEl('md')));
  }
  const row = el('div', 'mj-handrow');
  row.append(hand, meldsEl(g, bottom, 'md'));
  me.replaceChildren(seatHead(R, bottom, myIdx), riverEl(g, bottom, fresh), row);

  // いまの番
  const pend = seated && g.phase === 'claim' && g.pending?.[myIdx];
  let status = '';
  const L = g.log[g.log.length - 1];
  const nameOf = (i) => (i === myIdx ? 'あなた' : G.seats[i].name);
  if (over) status = 'この局はおしまい';
  else if (pend && !pend.answer) status = nameOf(g.last.seat) + 'が ' + tileName(g.last.id) + ' を捨てたよ。どうする？';
  else if (pend) status = 'ほかの人が答えるのを待っているよ';
  else if (myTurn) {
    const called = L && (L.t === 'pon' || L.t === 'chi') && L.seat === myIdx;
    status = called ? '組を見せたよ。いらない牌を1枚押して捨てよう' : 'あなたの番。いらない牌を1枚押して捨てよう';
  } else if (g.phase === 'claim') {
    // 聞かれていない人には「聞いている」と出さない（だれかが鳴ける牌を持っていることがわかってしまうため）
    status = nameOf(g.last.seat) + 'が ' + tileName(g.last.id) + ' を捨てた';
  }
  else {
    const called = L && (L.t === 'pon' || L.t === 'chi') ? nameOf(L.seat) + 'が' + (L.t === 'pon' ? 'ポン' : 'チー') + '。' : '';
    status = called + nameOf(g.turn) + 'の番' + (cpuSeat(R, g.turn) ? '（CPUが打つよ）' : '');
  }
  $('gameStatus').textContent = status;
  const myDue = seated && due.includes(myIdx) && !(pend && pend.answer);
  $('gameStatus').classList.toggle('is-mine', myDue);
  if (!watch) document.title = myDue ? '●あなたの番 | ' + DEFAULT_TITLE : DEFAULT_TITLE;

  renderHint(g, myIdx, myTurn, advice, seated && !over);
  renderActions(g, myIdx, myTurn, pend);
  $('autoBanner').hidden = !(seated && !over && G.auto[G.seats[myIdx].id]);
  $('viewOpts').hidden = !seated;

  // 結果
  $('result').hidden = !over;
  if (over) renderResult(R, g, myIdx);
  $('resultHost').hidden = !(over && isHost);
  $('resultWait').hidden = !(over && !isHost && !watch);

  const logs = G.log.slice();
  $('log').replaceChildren(...logs.map((x, k) => el('li', 'mj-log__item' + (k === logs.length - 1 ? ' is-new' : ''), x.text)));
  $('gameRules').replaceChildren(...rulesSummary(R.settings));
  $('gameTools').hidden = !isHost || over;
  updateTimer();
  state.shownRev = g.rev;
}

function renderHint(g, myIdx, myTurn, advice, show) {
  const box = $('hintLine');
  box.replaceChildren();
  if (!state.opts.hint || !show) return;
  const line = el('span', 'mj-hint');
  const strong = (t) => el('b', '', t);
  if (myTurn) {
    if (E.canTsumo(g, myIdx)) line.append(strong('そろったよ！'), '「ツモ」であがれる');
    else if (advice) {
      line.append(el('span', 'mj-dot'), 'のついた牌を捨てると、');
      if (advice.shanten === 0) line.append(strong('あと1枚'), 'であがれる形（テンパイ）');
      else line.append('あがりまで', strong('あと' + (advice.shanten + 1) + '枚'));
    }
  } else {
    const ws = E.handWaits(g, myIdx);
    if (ws.length) {
      box.append(el('span', 'mj-hint__label', '待ち'), ...ws.map((k) => tileEl(k, { size: 'sm' })), el('span', 'mj-hint__label', 'が来たらあがり'));
      return;
    }
    line.append('あがりまで', strong('あと' + (E.handShanten(g, myIdx) + 1) + '枚'));
  }
  box.append(line);
}

function renderActions(g, myIdx, myTurn, pend) {
  const box = $('actions');
  const btns = [];
  const button = (cls, label, onClick) => {
    const b = el('button', 'btn btn-lg ' + cls, label);
    b.type = 'button';
    b.disabled = state.acting;
    b.addEventListener('click', onClick);
    return b;
  };
  if (myTurn && E.canTsumo(g, myIdx)) btns.push(button('btn-primary', 'ツモ（あがる）', () => act({ type: 'tsumo' })));
  if (pend && !pend.answer) {
    const o = pend.options;
    const k = E.kindOf(g.last.id);
    if (o.ron) btns.push(button('btn-primary', 'ロン（あがる）', () => act({ type: 'ron' })));
    const call = (type, label, pair) => {
      const b = button('btn-secondary mj-callbtn', label, () => act({ type, tiles: pair }));
      const tiles = el('span', 'mj-callbtn__tiles');
      pair.map(E.kindOf).concat([k]).sort((a, c) => a - c).forEach((kk) => tiles.append(tileEl(kk, { size: 'xs', caption: false })));
      b.append(tiles);
      b.setAttribute('aria-label', label + '（' + pair.map(tileName).join('・') + ' と ' + E.kindName(k) + '）');
      return b;
    };
    o.pon.forEach((p) => btns.push(call('pon', 'ポン', p)));
    o.chi.forEach((p) => btns.push(call('chi', 'チー', p)));
    btns.push(button('btn-secondary', 'パス', () => act({ type: 'pass' })));
  }
  box.replaceChildren(...btns);
}

function renderResult(R, g, myIdx) {
  const res = g.result;
  const G = R.G;
  if (!res || res.type === 'draw') {
    $('resultTitle').textContent = '引き分け';
    $('resultSub').textContent = '山がなくなったよ';
    $('resultHand').replaceChildren();
    return;
  }
  $('resultTitle').textContent = res.winner === myIdx ? 'あがり！' : G.seats[res.winner].name + 'のあがり';
  $('resultSub').textContent = res.type === 'tsumo' ? 'ツモ（自分で引いた牌でそろった）'
    : 'ロン（' + (res.from === myIdx ? 'あなた' : G.seats[res.from].name) + 'の捨てた牌でそろった）';
  const winK = E.kindOf(res.tile);
  let marked = false;
  const groups = (res.shape ? res.shape.groups : []).map((grp) => {
    const box = el('span', 'mj-group');
    grp.kinds.forEach((k) => {
      const mark = !marked && k === winK;
      if (mark) marked = true;
      box.append(tileEl(k, { size: 'md', extra: mark ? 'is-win' : '' }));
    });
    return box;
  });
  $('resultHand').replaceChildren(...groups, meldsEl(g, res.winner, 'md'));
}

function updateTimer() {
  const R = state.view;
  const G = R && R.G;
  const g = G && G.s;
  const show = !!(R && R.phase === 'play' && g && g.phase !== 'end' && G.deadline && R.settings.time
    && E.waitingFor(g).some((i) => !cpuSeat(R, i)));
  $('timer').hidden = !show;
  if (!show) return;
  const left = Math.max(0, G.deadline - RoomkRTDB.now());
  const sec = Math.ceil(left / 1000);
  $('timerNum').textContent = 'のこり ' + sec + '秒';
  $('timerBar').style.width = Math.min(100, (left / (R.settings.time * 1000)) * 100) + '%';
  $('timer').classList.toggle('is-low', sec <= 5);
}

/* ── みんなにみせる画面（見るだけ。書き込まない） ── */
async function enterWatch(code, fromForm = false) {
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
    history.replaceState(null, '', location.pathname + '?watch=' + code);
    return true;
  } catch (error) {
    console.warn('[mahjong] watch failed', error);
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
  document.title = 'みんなにみせる画面 | 麻雀 | あそびのたな';
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
    console.warn('[mahjong] watch listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });
}

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
$('btnRoomMore').addEventListener('click', () => setRoomMore(!$('roomBar').classList.contains('is-open')));
$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
$('btnCopyLink').addEventListener('click', (event) => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkRTDB.copyRoomLink(state.roomCode, event.currentTarget);
});
$('btnShowQr')?.addEventListener('click', () => {
  if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkQR.show(state.roomCode);
});

function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}

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
  window.open(location.pathname + '?watch=' + state.roomCode, '_blank', 'noopener');
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);

$('hostPlays').addEventListener('change', (event) => setHostPlays(event.currentTarget.checked));
$('btnStartGame').addEventListener('click', () => startGame(false));
$('btnAgain').addEventListener('click', () => startGame(true));
$('btnRelobby').addEventListener('click', backToLobby);
$('btnStop').addEventListener('click', () => {
  if (window.confirm('この局をやめて、待合室にもどる？')) backToLobby();
});
$('btnSelf').addEventListener('click', takeBack);
// 手牌を押したら捨てる
$('me').addEventListener('click', (event) => {
  const b = event.target.closest('button[data-id]');
  if (!b || b.disabled) return;
  act({ type: 'discard', id: Number(b.dataset.id) });
});
// 見え方の切りかえは、待合室とゲームの画面の両方にある（同じ設定。片方を変えるともう片方もそろえる）
function syncViewInputs() {
  document.querySelectorAll('input[data-opt]').forEach((c) => { c.checked = !!state.opts[c.dataset.opt]; });
}
document.querySelectorAll('input[data-opt]').forEach((c) => c.addEventListener('change', () => {
  state.opts = { ...state.opts, [c.dataset.opt]: c.checked };
  saveViewOpts();
  syncViewInputs();
  if (state.view?.phase === 'play') renderGame(state.view);
}));
syncViewInputs();

// トップの飾り（東・白・發・中・五筒・五索）
[27, 31, 32, 33, 13, 22].forEach((k) => {
  const node = el('span', 'mj-tile mj-tile--md');
  node.insertAdjacentHTML('afterbegin', A.face(k));
  $('hero').append(node);
});

showScreen('top');
const startParams = new URLSearchParams(location.search);
const watchParam = startParams.get('watch');
const roomParam = startParams.get('room');
if (watchParam !== null) {
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
  const linkCode = normalizeRoomCode(roomParam);
  const saved = loadSession();
  if (!ROOM_CODE_PATTERN.test(linkCode)) {
    toast('ルームコードが正しくないよ');
    history.replaceState(null, '', location.pathname);
    resumeFromSession();
  } else if (saved && saved.roomCode === linkCode) {
    tryReconnect().then((reconnected) => {
      if (reconnected || state.roomRef) return;
      clearSession();
      openJoinFromLink(linkCode);
    });
  } else {
    if (saved) clearSession();
    openJoinFromLink(linkCode);
  }
} else {
  resumeFromSession();
}
