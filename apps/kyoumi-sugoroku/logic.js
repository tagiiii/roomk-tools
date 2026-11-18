// 興味スゴロク ルームの決まり（DOM も Firebase も使わない。transaction の中から呼ぶ）
// 質問はテーマのキーと、app.js の QUESTIONS の中の番号で共有する。
// そのため QUESTIONS は並べ替え・途中の削除をしない（足すのは末尾だけ）。

export const MAX_PLAYERS = 6;
export const MIN_PLAYERS = 1;
export const MIN_THEMES = 2;
export const SQUARE_OPTIONS = [10, 15, 20];
export const DEFAULT_SQUARES = 15;
export const NAME_MAX = 8;
export const CHOICE_FREE = -1; // 「自由に話す」

export const STATUS = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  GOAL: 'goal',
};

export const STEP = {
  ROLL: 'roll',  // 番の人がサイコロを振るのを待っている
  TALK: 'talk',  // 質問が出ている
};

/* ── 「人生の道」モード（2026-11-18） ──
   盤は4段で、1段が1つの場面。マスの種類で起きることが決まる。みんながゴールしたらおわり。
   質問・できごとは、種類・場面のキー・app.js の一覧の中の番号で共有する（一覧は並べ替え・途中の削除をしない）。 */
export const MODE = { THEME: 'theme', LIFE: 'life' };
export const KIND = { ERABU: 'erabu', HANASU: 'hanasu', KIKU: 'kiku', DEKIGOTO: 'dekigoto' };
export const LIFE_ROWS = 4;
export const LIFE_SIZES = [16, 20, 24, 28];
// マスの種類の並び（スタートの次のマスから、この順にくり返す）
export const LIFE_PATTERN = ['erabu', 'hanasu', 'kiku', 'erabu', 'dekigoto', 'hanasu', 'kiku', 'erabu', 'hanasu', 'dekigoto'];
export const TARGET_ALL = -1;   // 「きく」の相手: みんな
export const TARGET_NEAR = -2;  // 「きく」の相手: そばにいる人（1人で遊ぶとき）

// app.js が持つ中身の形: { scenes: [キー…], erabu: {場面: [番号…]}, hanasu: {場面: [番号…]}, kiku: {場面: 数}, events: [{ move, all, again }] }
let LIFE = null;
export function setLifeContent(content) { LIFE = content; }

export function modeOf(value) { return value === MODE.LIFE ? MODE.LIFE : MODE.THEME; }
export function lifeLenOf(value) { return value === -1 || value === 1 ? value : 0; }
// 20分くらいで終わるマス数（全員がゴールするまで）
export function lifeDefaultSize(players) {
  if (players <= 2) return 28;
  if (players === 3) return 24;
  if (players === 4) return 20;
  return 16;
}
// 「長さ」（-1 みじかい・0 ふつう・1 ながい）で1段階ずらす
export function lifeSizeFor(players, len) {
  const base = LIFE_SIZES.indexOf(lifeDefaultSize(players));
  return LIFE_SIZES[Math.max(0, Math.min(LIFE_SIZES.length - 1, base + lifeLenOf(len)))];
}
export function lifeKinds(total) {
  return Array.from({ length: total }, (_, i) => (i === 0 || i === total - 1 ? '' : LIFE_PATTERN[(i - 1) % LIFE_PATTERN.length]));
}
export function isLife(game) { return game?.mode === MODE.LIFE; }

export function validNickname(value) {
  if (!value) return '名前を入れてね';
  if (value.length > NAME_MAX) return '名前は' + NAME_MAX + '文字までだよ';
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '名前に使えない文字があるよ';
  return '';
}

export function randomSeed() {
  return Math.floor(Math.random() * 0x7fffffff);
}

// transaction の中で使う乱数は、外で作った種から決める（同じ種なら何度呼ばれても同じ結果）
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function asList(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

/* ── ルームの読み取り ── */
function byJoined(entries) {
  return entries
    .sort((a, b) => (Number(a[1]?.joinedAt) || 0) - (Number(b[1]?.joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

// 在室している人を参加順に
export function memberNames(room) {
  return byJoined(Object.entries(room?.players || {}));
}

export function guestNames(room) {
  return memberNames(room).filter((name) => !room.players[name]?.isHost);
}

// 端末なしの参加者（ホストが代わりに押す）。切断しない
export function proxyNames(room) {
  return byJoined(Object.entries(room?.proxies || {}));
}

// 遊ぶ人（ホストは「自分もプレイヤーとして参加する」のときだけ）。端末なしの参加者もふくめて参加順
export function playingNames(room) {
  const entries = Object.entries(room?.players || {}).filter(([, p]) => !p?.isHost || room.hostPlays)
    .concat(Object.entries(room?.proxies || {}));
  return byJoined(entries);
}

export function gameOf(room) {
  const game = room?.game;
  return game && typeof game === 'object' ? game : null;
}

export function orderOf(game) {
  return asList(game?.order).filter((name) => typeof name === 'string');
}

export function isProxy(game, name) {
  return game?.proxy?.[name] === true;
}

// いまルームにいるか（端末なしの参加者はいつもいる）
export function present(room, game, name) {
  return isProxy(game, name) || !!room?.players?.[name];
}

// このゲームで、その名前を持っている端末か（端末なしの参加者はだれも持たない）
export function ownsName(game, name, uid) {
  return !!uid && game?.uids?.[name] === uid;
}

// 待合室の設定（壊れた値は初期値に）
export function squaresOf(value) {
  return SQUARE_OPTIONS.includes(value) ? value : DEFAULT_SQUARES;
}

export function themesOf(value, counts) {
  const keys = Object.keys(counts);
  const list = asList(value).filter((key, i, all) => keys.includes(key) && all.indexOf(key) === i);
  return list.length >= MIN_THEMES ? list : keys;
}

// 盤のマス数（「人生の道」は 16〜28、今までの遊び方は 10〜20）
export function boardSize(game) {
  if (isLife(game)) return LIFE_SIZES.includes(game.squares) ? game.squares : 20;
  return squaresOf(game?.squares);
}
export function lifeCols(game) { return boardSize(game) / LIFE_ROWS; }
// そのマスの場面のキー
export function lifeSceneAt(game, pos) {
  const scenes = LIFE?.scenes || [];
  return scenes[Math.min(scenes.length - 1, Math.floor(pos / lifeCols(game)))] ?? null;
}
// ゴールした人か（「人生の道」だけ）
export function doneOf(game, i) {
  return asList(game?.done)[i] === true;
}
export function qnOf(game) {
  return Number(game?.q?.n) || 0;
}
function lifeIndexOk(kind, scene, idx) {
  if (!LIFE || !Number.isInteger(idx) || idx < 0) return false;
  if (kind === KIND.DEKIGOTO) return idx < LIFE.events.length;
  if (!LIFE.scenes.includes(scene)) return false;
  if (kind === KIND.KIKU) return idx < (LIFE.kiku[scene] || 0);
  if (kind === KIND.ERABU || kind === KIND.HANASU) return asList(LIFE[kind][scene]).includes(idx);
  return false;
}
// 「人生の道」のいまのカード。壊れた値は読み飛ばす。target は「きく」の相手（まだ選んでいなければ null）
export function lifeQuestionOf(game) {
  const q = game?.q;
  if (!isLife(game) || !q || typeof q !== 'object') return null;
  const idx = Number(q.idx);
  if (!lifeIndexOk(q.kind, q.scene, idx)) return null;
  const order = orderOf(game);
  const t = Number(q.target);
  const target = q.target != null && Number.isInteger(t) && t >= TARGET_NEAR && t < order.length ? t : null;
  return { kind: q.kind, scene: q.scene ?? null, idx, n: Number(q.n) || 0, target };
}

export function posOf(game, i) {
  const n = Number(asList(game?.pos)[i]);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function turnOf(game) {
  const t = Number(game?.turn);
  const order = orderOf(game);
  return Number.isInteger(t) && t >= 0 && t < order.length ? t : 0;
}

export function actorOf(game) {
  return orderOf(game)[turnOf(game)] ?? null;
}

// いまの質問。壊れた値は読み飛ばす
export function questionOf(game, counts) {
  const q = game?.q;
  if (!q || typeof q !== 'object' || !counts[q.theme]) return null;
  const idx = Number(q.idx);
  if (!Number.isInteger(idx) || idx < 0 || idx >= counts[q.theme]) return null;
  const choice = Number.isInteger(q.choice) ? q.choice : null;
  return { theme: q.theme, idx, choice, n: Number(q.n) || 0 };
}

// 前の人が選んだもの（選ぶと次の人の番になり、次にサイコロが振られるまで盤の上に出す）。壊れた値は読み飛ばす
export function pickedOf(game, counts) {
  const p = game?.picked;
  if (!p || typeof p !== 'object') return null;
  const idx = Number(p.idx);
  const turn = Number(p.turn);
  const choice = Number(p.choice);
  if (p.life === true) {
    // 「人生の道」の「えらぶ」
    if (!isLife(game) || !lifeIndexOk(KIND.ERABU, p.scene, idx)) return null;
    if (!Number.isInteger(turn) || turn < 0 || turn >= orderOf(game).length) return null;
    if (!Number.isInteger(choice) || choice < CHOICE_FREE) return null;
    return { life: true, scene: p.scene, idx, turn, choice };
  }
  if (!counts[p.theme]) return null;
  if (!Number.isInteger(idx) || idx < 0 || idx >= counts[p.theme]) return null;
  if (!Number.isInteger(turn) || turn < 0 || turn >= orderOf(game).length) return null;
  if (!Number.isInteger(choice) || choice < CHOICE_FREE) return null;
  return { theme: p.theme, idx, turn, choice };
}

// 自分が、いまの番の操作（サイコロ・質問のボタン）をしてよいか。
// 番の人の端末と、ホスト（だれの番でも代わりに押せる）
export function canAct(room, uid, nickname, role) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAYING || !uid) return false;
  if (role === 'host' && room.hostUid === uid) return true;
  const actor = actorOf(game);
  return role === 'guest' && actor === nickname && ownsName(game, actor, uid);
}

/* ── 質問を選ぶ ── */
// 直前と同じテーマは、ほかがあれば避ける。テーマの中では出していない質問から（出しきったら最初から）
function drawQuestion(game, counts, rng, theme) {
  const themes = themesOf(game.themes, counts);
  let t = theme;
  if (!t) {
    const pool = themes.length > 1 ? themes.filter((key) => key !== game.lastTheme) : themes;
    t = pool[Math.floor(rng() * pool.length)];
  }
  const used = { ...(game.used || {}) };
  const seen = new Set(asList(used[t]).filter((i) => Number.isInteger(i)));
  const current = game.q && game.q.theme === t ? Number(game.q.idx) : null;
  let fresh = [];
  for (let i = 0; i < counts[t]; i++) if (!seen.has(i) && i !== current) fresh.push(i);
  if (!fresh.length) {
    // 出しきったら最初から（いま出ている質問はすぐには出さない）
    seen.clear();
    for (let i = 0; i < counts[t]; i++) if (i !== current) fresh.push(i);
    if (!fresh.length) fresh = [0];
  }
  const idx = fresh[Math.floor(rng() * fresh.length)];
  seen.add(idx);
  used[t] = [...seen];
  return { theme: t, idx, used };
}

// 次の番の人。順番どおりに回し、いない人はとばす。だれもいなければ、いまの人のまま
function nextTurn(room, game) {
  const order = orderOf(game);
  const from = turnOf(game);
  for (let k = 1; k <= order.length; k++) {
    const i = (from + k) % order.length;
    if (present(room, game, order[i]) && !doneOf(game, i)) return i;
  }
  return from;
}

/* ── 「人生の道」の進行 ── */
// 一覧（番号の並び）から、まだ出していないものを1つ（出しきったら最初から。いま出ているものはすぐには出さない）
function lifeDraw(game, key, candidates, rng, current) {
  const used = { ...(game.used || {}) };
  const seen = new Set(asList(used[key]).filter((i) => Number.isInteger(i)));
  let fresh = candidates.filter((i) => !seen.has(i) && i !== current);
  if (!fresh.length) {
    seen.clear();
    fresh = candidates.filter((i) => i !== current);
    if (!fresh.length) fresh = candidates.slice(0, 1);
  }
  const idx = fresh[Math.floor(rng() * fresh.length)];
  seen.add(idx);
  used[key] = [...seen];
  return { idx, used };
}
function lifeCandidates(kind, scene) {
  if (kind === KIND.DEKIGOTO) return LIFE.events.map((_, i) => i);
  if (kind === KIND.KIKU) return Array.from({ length: LIFE.kiku[scene] || 0 }, (_, i) => i);
  return asList(LIFE[kind][scene]);
}
function lifeUsedKey(kind, scene) {
  return kind === KIND.DEKIGOTO ? 'life_event' : `life_${kind}_${scene}`;
}
// ゴールに着いた人に印を付ける。みんな着いたらおわり（順位は出さない）。まだなら null
function lifeSettle(room, game, pos) {
  const max = boardSize(game) - 1;
  const done = orderOf(game).map((_, i) => doneOf(game, i) || pos[i] >= max);
  const arrived = done.map((d, i) => d && !doneOf(game, i)).map((d, i) => (d ? i : -1)).filter((i) => i >= 0);
  const settled = { ...game, pos, done, arrived: arrived.length ? { who: arrived, rollNo: Number(game.rollNo) || 0 } : null };
  if (done.every(Boolean)) {
    return { all: true, room: { ...room, status: STATUS.GOAL, game: { ...settled, step: STEP.ROLL, q: null, winner: null } } };
  }
  return { all: false, game: settled };
}
function lifeRoll(room, game, rollNo, seed) {
  if (!LIFE) return null;
  const turn = turnOf(game);
  if (doneOf(game, turn)) return null;
  const rng = seededRandom(seed);
  const dice = Math.floor(rng() * 6) + 1;
  const max = boardSize(game) - 1;
  const from = posOf(game, turn);
  const to = Math.min(from + dice, max);
  const pos = orderOf(game).map((_, i) => posOf(game, i));
  pos[turn] = to;
  const moved = { ...game, pos, rollNo: rollNo + 1, last: { dice, from, to, turn }, picked: null, arrived: null };
  if (to >= max) {
    const end = lifeSettle(room, moved, pos);
    if (end.all) return end.room;
    return { ...room, game: { ...end.game, step: STEP.ROLL, q: null, turn: nextTurn(room, end.game) } };
  }
  const kind = lifeKinds(max + 1)[to];
  const scene = kind === KIND.DEKIGOTO ? null : lifeSceneAt(moved, to);
  const drawn = lifeDraw(moved, lifeUsedKey(kind, scene), lifeCandidates(kind, scene), rng, null);
  const q = { kind, idx: drawn.idx, n: 1 };
  if (scene) q.scene = scene;
  // 聞く相手がほかにいないとき（1人で遊ぶ）は、そばにいる人に聞く
  if (kind === KIND.KIKU && orderOf(game).length < 2) q.target = TARGET_NEAR;
  return { ...room, game: { ...moved, step: STEP.TALK, used: drawn.used, q } };
}
function lifeReask(room, game, q, seed) {
  if (!LIFE || q.kind === KIND.DEKIGOTO) return null;
  const drawn = lifeDraw(game, lifeUsedKey(q.kind, q.scene), lifeCandidates(q.kind, q.scene), seededRandom(seed), q.idx);
  return { ...room, game: { ...game, used: drawn.used, q: { ...game.q, idx: drawn.idx, n: q.n + 1 } } };
}
function lifeChoose(room, game, q, choice, choiceCount) {
  if (q.kind === KIND.KIKU) {
    // だれに聞くかを選ぶ（自分以外の人か、みんな）
    if (q.target != null) return null;
    const ok = choice === TARGET_ALL
      || (Number.isInteger(choice) && choice >= 0 && choice < orderOf(game).length && choice !== turnOf(game));
    if (!ok) return null;
    return { ...room, game: { ...game, q: { ...game.q, target: choice, n: q.n + 1 } } };
  }
  if (q.kind !== KIND.ERABU) return null;
  if (choice !== CHOICE_FREE && !(Number.isInteger(choice) && choice >= 0 && choice < choiceCount)) return null;
  return {
    ...room,
    game: {
      ...game,
      step: STEP.ROLL,
      q: null,
      picked: { life: true, turn: turnOf(game), scene: q.scene, idx: q.idx, choice },
      turn: nextTurn(room, game),
    },
  };
}
// 「話せた！次の人へ」・できごとの「進む」。できごとで進んだ先のマスでは何も起きない
function lifeNext(room, game, q) {
  const base = { ...game, step: STEP.ROLL, q: null, picked: null };
  if (!q || q.kind !== KIND.DEKIGOTO || !LIFE) return { ...room, game: { ...base, turn: nextTurn(room, game) } };
  const ev = LIFE.events[q.idx] || {};
  const turn = turnOf(game);
  const max = boardSize(game) - 1;
  const pos = orderOf(game).map((_, i) => posOf(game, i));
  if (ev.all) pos.forEach((p, i) => { if (!doneOf(game, i)) pos[i] = Math.min(max, p + ev.all); });
  else if (ev.move) pos[turn] = Math.min(max, pos[turn] + ev.move);
  const end = lifeSettle(room, base, pos);
  if (end.all) return end.room;
  // 「もう一度サイコロ」は同じ人のまま（その人がゴールした・いないときは次の人へ）
  const again = ev.again && !doneOf(end.game, turn) && present(room, game, orderOf(game)[turn]);
  return { ...room, game: { ...end.game, turn: again ? turn : nextTurn(room, end.game) } };
}

/* ── 進行（どれも新しいルームを返す。進められないときは null） ── */
export function startGame(room, counts) {
  if (room?.status !== STATUS.WAITING) return null;
  const names = playingNames(room);
  if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) return null;
  const id = (Number(room.lastGameId) || 0) + 1;
  const proxies = room.proxies || {};
  const real = names.filter((name) => !proxies[name]);
  const game = {
    id,
    order: names, // 参加した順（ホストが遊ぶときはホストが最初）
    uids: Object.fromEntries(real.map((name) => [name, room.players[name].uid])),
    joined: Object.fromEntries(real.map((name) => [name, Number(room.players[name].joinedAt) || 0])),
    proxy: Object.keys(proxies).length ? Object.fromEntries(Object.keys(proxies).map((name) => [name, true])) : null,
    squares: squaresOf(room.squares), // 「はじめる」の時点の設定で固定
    themes: themesOf(room.themes, counts),
    pos: names.map(() => 0),
    turn: 0,
    step: STEP.ROLL,
    rollNo: 0,
  };
  if (modeOf(room.mode) === MODE.LIFE) {
    game.mode = MODE.LIFE;
    game.squares = lifeSizeFor(names.length, room.lifeLen); // 人数と「長さ」から
    game.done = names.map(() => false);
  }
  return { ...room, status: STATUS.PLAYING, lastGameId: id, game };
}

// サイコロを振る。出目のぶん進み（ゴールでとまる）、ゴールでなければ質問を出す
export function roll(room, gameId, rollNo, seed, counts) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId) return null;
  if (game.step !== STEP.ROLL || (Number(game.rollNo) || 0) !== rollNo) return null;
  if (isLife(game)) return lifeRoll(room, game, rollNo, seed);
  const rng = seededRandom(seed);
  const dice = Math.floor(rng() * 6) + 1;
  const turn = turnOf(game);
  const max = squaresOf(game.squares) - 1;
  const from = posOf(game, turn);
  const to = Math.min(from + dice, max);
  const pos = orderOf(game).map((_, i) => posOf(game, i));
  pos[turn] = to;
  const moved = {
    ...game,
    pos,
    rollNo: rollNo + 1,
    last: { dice, from, to, turn },
    picked: null, // 前の人が選んだものは、次のサイコロで消す
  };
  if (to >= max) {
    return { ...room, status: STATUS.GOAL, game: { ...moved, step: STEP.ROLL, q: null, winner: turn } };
  }
  const drawn = drawQuestion(moved, counts, rng);
  return {
    ...room,
    game: {
      ...moved,
      step: STEP.TALK,
      used: drawn.used,
      lastTheme: drawn.theme,
      q: { theme: drawn.theme, idx: drawn.idx, n: 1 },
    },
  };
}

// 「別の質問」: テーマはそのままで、ちがう質問にする。
// 押した時点の質問（qn）と一致するときだけ（番の人とホストが同時に押しても1回だけ変わる）
export function reask(room, gameId, rollNo, qn, seed, counts) {
  const game = gameOf(room);
  const q = isLife(game) ? lifeQuestionOf(game) : questionOf(game, counts);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || game.step !== STEP.TALK) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || !q || q.n !== qn) return null;
  if (isLife(game)) return lifeReask(room, game, q, seed);
  const drawn = drawQuestion(game, counts, seededRandom(seed), q.theme);
  return {
    ...room,
    game: { ...game, used: drawn.used, q: { theme: drawn.theme, idx: drawn.idx, n: q.n + 1 } },
  };
}

// 選択肢を選ぶ（CHOICE_FREE は「自由に話す」）。選ぶと次の人の番になり、選んだものは
// 次にサイコロが振られるまで、みんなの画面の盤の上に出る（記録・集計はしない）
export function choose(room, gameId, rollNo, qn, choice, choiceCount, counts) {
  const game = gameOf(room);
  const q = isLife(game) ? lifeQuestionOf(game) : questionOf(game, counts);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || game.step !== STEP.TALK) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || !q || q.n !== qn) return null;
  if (isLife(game)) return lifeChoose(room, game, q, choice, choiceCount);
  if (choice !== CHOICE_FREE && !(Number.isInteger(choice) && choice >= 0 && choice < choiceCount)) return null;
  return {
    ...room,
    game: {
      ...game,
      step: STEP.ROLL,
      q: null,
      picked: { turn: turnOf(game), theme: q.theme, idx: q.idx, choice },
      turn: nextTurn(room, game),
    },
  };
}

// 「話せた！次の人へ」: 質問を消して、次の人がサイコロを振る番に
export function nextPlayer(room, gameId, rollNo) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || game.step !== STEP.TALK) return null;
  if ((Number(game.rollNo) || 0) !== rollNo) return null;
  if (isLife(game)) return lifeNext(room, game, lifeQuestionOf(game));
  return { ...room, game: { ...game, step: STEP.ROLL, q: null, picked: null, turn: nextTurn(room, game) } };
}

// サイコロを振る番の人がいなくなったら（退出・切断）、次にいる人へとばす（ホストの見はりと退出から）
export function skipAbsent(room) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.step !== STEP.ROLL) return null;
  const actor = actorOf(game);
  // 「人生の道」で、ゴールした人に番が残っているときもとばす
  if (actor == null || (present(room, game, actor) && !doneOf(game, turnOf(game)))) return null;
  const turn = nextTurn(room, game);
  return turn === turnOf(game) ? null : { ...room, game: { ...game, turn } };
}

// 待合室にもどる（ゲームの途中・ゴールのあと。ホスト）
export function backToWaiting(room, gameId) {
  const game = gameOf(room);
  if (!game || game.id !== gameId || (room.status !== STATUS.PLAYING && room.status !== STATUS.GOAL)) return null;
  return { ...room, status: STATUS.WAITING, game: null };
}
