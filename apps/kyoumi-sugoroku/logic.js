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
  if (!p || typeof p !== 'object' || !counts[p.theme]) return null;
  const idx = Number(p.idx);
  const turn = Number(p.turn);
  const choice = Number(p.choice);
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
    if (present(room, game, order[i])) return i;
  }
  return from;
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
  return { ...room, status: STATUS.PLAYING, lastGameId: id, game };
}

// サイコロを振る。出目のぶん進み（ゴールでとまる）、ゴールでなければ質問を出す
export function roll(room, gameId, rollNo, seed, counts) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId) return null;
  if (game.step !== STEP.ROLL || (Number(game.rollNo) || 0) !== rollNo) return null;
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
  const q = questionOf(game, counts);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || game.step !== STEP.TALK) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || !q || q.n !== qn) return null;
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
  const q = questionOf(game, counts);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || game.step !== STEP.TALK) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || !q || q.n !== qn) return null;
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
  return { ...room, game: { ...game, step: STEP.ROLL, q: null, picked: null, turn: nextTurn(room, game) } };
}

// サイコロを振る番の人がいなくなったら（退出・切断）、次にいる人へとばす（ホストの見はりと退出から）
export function skipAbsent(room) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.step !== STEP.ROLL) return null;
  const actor = actorOf(game);
  if (actor == null || present(room, game, actor)) return null;
  const turn = nextTurn(room, game);
  return turn === turnOf(game) ? null : { ...room, game: { ...game, turn } };
}

// 待合室にもどる（ゲームの途中・ゴールのあと。ホスト）
export function backToWaiting(room, gameId) {
  const game = gameOf(room);
  if (!game || game.id !== gameId || (room.status !== STATUS.PLAYING && room.status !== STATUS.GOAL)) return null;
  return { ...room, status: STATUS.WAITING, game: null };
}
