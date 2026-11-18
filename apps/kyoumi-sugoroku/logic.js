// 興味スゴロク ルームの決まり（DOM も Firebase も使わない。transaction の中から呼ぶ）
// 質問はテーマのキーと、app.js の QUESTIONS の中の番号で共有する。
// そのため QUESTIONS は並べ替え・途中の削除をしない（足すのは末尾だけ）。

export const MAX_PLAYERS = 10; // 2026-11-18 オーナー「10人くらいまで」（それまでは6人）
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

// 画面の版。人生の道の決まりを変えて、前の版の画面と混ざると困るときに1つ上げる（段階の名前 life{VER}-* も変わる）。
// ルームの参加者は players/{名前}/ver に自分の版を書く。版のちがう人がいると、人生の道を始められない（staleNames）
export const VER = 4;
const LV = 'life' + VER;

export const STEP = {
  ROLL: 'roll',  // 番の人がサイコロを振るのを待っている
  TALK: 'talk',  // 質問が出ている
  // 「人生の道」の段階。名前を分けて、ちがう決まりの版の画面からの操作を通さない。
  // 今までの遊び方は roll / talk、公開済みの前の版の人生の道は life-roll / life-talk（サイコロ1つ・「はなす」あり）と
  // life2-*（「いっしょ」「よそう」のマスがない）・life3-*（「みんなで」のマスとおたすけカードがない）
  LIFE_ROLL: LV + '-roll',
  LIFE_PICK: LV + '-pick', // サイコロを2つ振って、進む目を選んでいる
  LIFE_TALK: LV + '-talk',
};
// この版の人生の道の段階。これ以外（前の版が作ったゲームの life-roll / life-talk や、壊れた値）は、
// この版では進められないので、ホストの画面が待合室にもどす
const LIFE_STEPS = [STEP.LIFE_ROLL, STEP.LIFE_PICK, STEP.LIFE_TALK];

/* ── 「人生の道」モード（2026-11-18） ──
   盤は4段で、1段が1つの場面。マスの種類で起きることが決まる。みんながゴールしたらおわり。
   質問・できごとは、種類・場面のキー・app.js の一覧の中の番号で共有する（一覧は並べ替え・途中の削除をしない）。 */
export const MODE = { THEME: 'theme', LIFE: 'life' };
export const KIND = { ERABU: 'erabu', KIKU: 'kiku', DEKIGOTO: 'dekigoto', ISSHO: 'issho', YOSOU: 'yosou', MINNA: 'minna' };
// みんなで（minna）: お題に合うものを、番の人から順に1つずつ選ぶ（ほかの人が選んだものは選べない）。みんな選べたら、みんな1マス
// 書いて答える: 「自由に話す」のとき、短い文を添えられる（次のサイコロまで出して消す）
export const TEXT_MAX = 30;
export function cleanText(value) {
  if (typeof value !== 'string') return '';
  // 文字の数はコードポイントで数える（絵文字のとちゅうで切らない）
  return [...value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, TEXT_MAX).join('').trim();
}
// おたすけカード: 「きく」で答えてもらったら、聞いた人が1枚もらう。自分の番のサイコロの前に、ほかの人を2マス進めるのに使える
export const CARD_MAX = 3;
export const CARD_STEPS = 2;
// みんなが同時に選ぶマス（ルームで2人以上のときだけ出る）。
// いっしょ: みんなが自分の答えを選び、番の人と同じだった人が進む。よそう: 番の人の答えを、ほかの人が予想する
export function isVoteKind(kind) { return kind === KIND.ISSHO || kind === KIND.YOSOU; }
export const VOTE_CHOICES = 3; // 質問はどれも3択
// 「きく」の進み方: だれに聞くか → 3枚の質問から1枚 → 聞かれた人が答える
export const PHASE = { WHO: 'who', CARD: 'card', ANSWER: 'answer' };
export const ASK_CARDS = 3;
export const LIFE_ROWS = 4;
export const LIFE_SIZES = [12, 16, 20, 24, 28];
// マスの種類の並び（スタートの次のマスから、この順にくり返す）
export const LIFE_PATTERN = ['erabu', 'kiku', 'erabu', 'dekigoto', 'erabu', 'kiku', 'minna', 'dekigoto', 'kiku', 'erabu'];
// みんなが同時に選ぶマスのある並び（game.votes が true のとき）
export const LIFE_PATTERN_VOTES = ['erabu', 'kiku', 'issho', 'dekigoto', 'erabu', 'yosou', 'kiku', 'minna', 'dekigoto', 'issho'];
export const TARGET_ALL = -1;   // 「きく」の相手: みんな
export const TARGET_NEAR = -2;  // 「きく」の相手: そばにいる人（1人で遊ぶとき）

// app.js が持つ中身の形: { scenes: [キー…], erabu: {場面: 数}, kiku: {場面: 数}, events: [{ move, all, again }], minna: [お題ごとの選べるものの数…] }（質問はどれも3択）
let LIFE = null;
export function setLifeContent(content) { LIFE = content; }

export function modeOf(value) { return value === MODE.LIFE ? MODE.LIFE : MODE.THEME; }
export function lifeLenOf(value) { return value === -1 || value === 1 ? value : 0; }
// 20分くらいで終わるマス数（全員がゴールするまで）
export function lifeDefaultSize(players) {
  if (players <= 2) return 28;
  if (players === 3) return 24;
  if (players === 4) return 20;
  if (players <= 6) return 16;
  return 12; // 7人からは、いちばん短い盤（みんながゴールするまでが長くなりすぎないように）
}
// 「長さ」（-1 みじかい・0 ふつう・1 ながい）で1段階ずらす
export function lifeSizeFor(players, len) {
  const base = LIFE_SIZES.indexOf(lifeDefaultSize(players));
  return LIFE_SIZES[Math.max(0, Math.min(LIFE_SIZES.length - 1, base + lifeLenOf(len)))];
}
export function lifeKinds(total, votes = false) {
  const pattern = votes ? LIFE_PATTERN_VOTES : LIFE_PATTERN;
  return Array.from({ length: total }, (_, i) => (i === 0 || i === total - 1 ? '' : pattern[(i - 1) % pattern.length]));
}
// そのゲームの盤のマスの種類
export function lifeKindsOf(game) {
  return lifeKinds(boardSize(game), game?.votes === true);
}
export function isLife(game) { return game?.mode === MODE.LIFE; }
// サイコロを振るのを待っている・カードが出ている（モードごとの段階の名前で見る）
export function isRollStep(game) { return !!game && game.step === (isLife(game) ? STEP.LIFE_ROLL : STEP.ROLL); }
export function isTalkStep(game) { return !!game && game.step === (isLife(game) ? STEP.LIFE_TALK : STEP.TALK); }
export function isPickStep(game) { return isLife(game) && game.step === STEP.LIFE_PICK; }
export function isOldLife(game) { return isLife(game) && !LIFE_STEPS.includes(game.step); }
// 進む目を選んでいるときの2つの目（ちがう 1〜6 の数が2つ）。壊れた値は null
export function pickDice(game) {
  if (!isPickStep(game) || game.dice == null || typeof game.dice !== 'object') return null;
  const a = game.dice[0];
  const b = game.dice[1];
  const ok = (n) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 6;
  return ok(a) && ok(b) && a !== b ? [a, b] : null;
}
// 進む目を選ぶ段階なのに、目が読めない（壊れた値）
export function pickBroken(game) { return isPickStep(game) && !pickDice(game); }

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

// 版のちがう画面の人（ホストのほか）。版を書く前の画面（ver なし）も、ちがう版として数える。1台の画面は見ない
export function staleNames(room) {
  if (room?.offline) return [];
  return byJoined(Object.entries(room?.players || {}).filter(([, p]) => p && !p.isHost && Number(p.ver) !== VER));
}
// ホストの画面の版。ver のない（版を書く前の）ホストは 0
export function hostVer(room) {
  return Number(room?.players?.[room?.host]?.ver) || 0;
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
  return isLife(game) && game.done != null && typeof game.done === 'object' && game.done[i] === true;
}
export function qnOf(game) {
  return Number(game?.q?.n) || 0;
}
function lifeIndexOk(kind, scene, idx) {
  if (!LIFE || !Number.isInteger(idx) || idx < 0) return false;
  if (kind === KIND.DEKIGOTO) return idx < LIFE.events.length;
  if (!LIFE.scenes.includes(scene)) return false;
  if (kind === KIND.KIKU || kind === KIND.ERABU) return idx < (LIFE[kind][scene] || 0);
  if (isVoteKind(kind)) return idx < (LIFE.erabu[scene] || 0); // 質問は「えらぶ」と同じ一覧から
  if (kind === KIND.MINNA) return idx < asList(LIFE.minna).length;
  return false;
}
// 「人生の道」のいまのカード。壊れた値は読み飛ばす。
// 「きく」は phase（だれに → どの質問 → 答える）・target（相手。まだなら null）・opts（選べる質問の番号3つ）を持つ
export function lifeQuestionOf(game) {
  const q = game?.q;
  if (!isLife(game) || !q || typeof q !== 'object') return null;
  const n = Number(q.n) || 0;
  if (q.kind !== KIND.KIKU) {
    const idx = Number(q.idx);
    if (!lifeIndexOk(q.kind, q.scene, idx)) return null;
    const card = { kind: q.kind, scene: q.scene ?? null, idx, n, target: null, phase: null, opts: [] };
    if (isVoteKind(q.kind)) {
      // みんなの選んだもの { 順番の番号: 選択肢の番号 }。open になるまで、ほかの人の画面には出さない
      const count = orderOf(game).length;
      card.votes = {};
      if (q.votes != null && typeof q.votes === 'object') {
        for (let i = 0; i < count; i++) {
          const v = q.votes[i];
          if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < VOTE_CHOICES) card.votes[i] = v;
        }
      }
      card.open = q.open === true;
    }
    if (q.kind === KIND.MINNA) {
      // みんなの選んだもの { 順番の番号: 選べるものの番号 }。同じものは1人だけ（あとの人のぶんは読まない）
      const count = orderOf(game).length;
      const options = Number(asList(LIFE.minna)[idx]) || 0;
      const taken = new Set();
      card.picks = {};
      if (q.picks != null && typeof q.picks === 'object') {
        for (let i = 0; i < count; i++) {
          const v = q.picks[i];
          if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < options && !taken.has(v)) {
            card.picks[i] = v;
            taken.add(v);
          }
        }
      }
    }
    return card;
  }
  if (!LIFE || !LIFE.scenes.includes(q.scene)) return null;
  const order = orderOf(game);
  const t = Number(q.target);
  const target = q.target != null && Number.isInteger(t) && t >= TARGET_NEAR && t < order.length && t !== turnOf(game) ? t : null;
  const opts = asList(q.opts).map(Number).filter((i, at, all) => lifeIndexOk(KIND.KIKU, q.scene, i) && all.indexOf(i) === at);
  const idx = Number(q.idx);
  const hasIdx = q.idx != null && lifeIndexOk(KIND.KIKU, q.scene, idx);
  // 段階は、そろっている中身から決める（壊れた値で先の段階にならないように）
  let phase = PHASE.WHO;
  if (target != null && q.phase === PHASE.ANSWER && hasIdx) phase = PHASE.ANSWER;
  else if (target != null && opts.length) phase = PHASE.CARD;
  else if (target != null) return null;
  return { kind: KIND.KIKU, scene: q.scene, idx: phase === PHASE.ANSWER ? idx : null, n, target, phase, opts };
}
// 「きく」で選んだ相手が、いまルームにいない
export function targetGone(room, game, q) {
  return !!q && q.kind === KIND.KIKU && Number.isInteger(q.target) && q.target >= 0 && !present(room, game, orderOf(game)[q.target]);
}
// いま押す人の番号。ふだんは番の人。「きく」で答える段階は、聞かれた人（いなくなっていたら番の人にもどる）
export function actingIndex(room, game) {
  const q = lifeQuestionOf(game);
  if (q && isTalkStep(game) && q.phase === PHASE.ANSWER && q.target >= 0 && !targetGone(room, game, q)) return q.target;
  if (q && isTalkStep(game) && q.kind === KIND.MINNA) {
    const picker = minnaPicker(room, game, q);
    if (picker != null) return picker;
  }
  return turnOf(game);
}
// 「みんなで」で、いま選ぶ番の人（番の人から順に、いまいて、まだ選んでいない人）。みんな選んだら null
export function minnaPicker(room, game, q) {
  const order = orderOf(game);
  const turn = turnOf(game);
  // 選べるものが残っていなければ、そこまでで終わり（お題の数が人数より少なくても止まらない）
  const options = Number(asList(LIFE?.minna)[q.idx]) || 0;
  if (Object.keys(q.picks).length >= options) return null;
  for (let k = 0; k < order.length; k++) {
    const i = (turn + k) % order.length;
    if (present(room, game, order[i]) && q.picks[i] == null) return i;
  }
  return null;
}
// おたすけカードの枚数
export function cardsOf(game, i) {
  if (!isLife(game) || game.cards == null || typeof game.cards !== 'object') return 0;
  const n = game.cards[i];
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? Math.min(CARD_MAX, n) : 0;
}
// おたすけカードで進められる相手（自分以外の、まだゴールしていない、いまいる人）
export function helpTargets(room, game) {
  const turn = turnOf(game);
  return orderOf(game).map((_, i) => i).filter((i) => i !== turn && !doneOf(game, i) && present(room, game, orderOf(game)[i]));
}
function addCard(game, i) {
  const cards = {};
  orderOf(game).forEach((_, k) => { const n = cardsOf(game, k); if (n) cards[k] = n; });
  cards[i] = Math.min(CARD_MAX, (cards[i] || 0) + 1);
  return cards;
}

export function posOf(game, i) {
  // 順番の番号でそのまま読む（Realtime Database が途中の欠けた数値キーの形で返しても、ほかの人の位置を読まない）
  const raw = game?.pos != null && typeof game.pos === 'object' ? game.pos[i] : undefined;
  const n = Number(raw);
  return raw != null && Number.isInteger(n) && n >= 0 ? n : 0;
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
    const kiku = p.kiku === true;
    if (!isLife(game) || !lifeIndexOk(kiku ? KIND.KIKU : KIND.ERABU, p.scene, idx)) return null;
    if (!Number.isInteger(turn) || turn < 0 || turn >= orderOf(game).length) return null;
    if (!Number.isInteger(choice) || choice < CHOICE_FREE) return null;
    const by = Number(p.by);
    // kiku: 「きく」で聞かれた人の答え（by は聞いた人）
    return { life: true, kiku, by: kiku && Number.isInteger(by) && by >= 0 && by < orderOf(game).length ? by : null, scene: p.scene, idx, turn, choice, text: choice === CHOICE_FREE ? cleanText(p.text) : '' };
  }
  if (!counts[p.theme]) return null;
  if (!Number.isInteger(idx) || idx < 0 || idx >= counts[p.theme]) return null;
  if (!Number.isInteger(turn) || turn < 0 || turn >= orderOf(game).length) return null;
  if (!Number.isInteger(choice) || choice < CHOICE_FREE) return null;
  return { theme: p.theme, idx, turn, choice, text: choice === CHOICE_FREE ? cleanText(p.text) : '' };
}

// 自分が、いまの番の操作（サイコロ・質問のボタン）をしてよいか。
// 番の人の端末と、ホスト（だれの番でも代わりに押せる）
export function canAct(room, uid, nickname, role) {
  const game = gameOf(room);
  if (!game || room.status !== STATUS.PLAYING || !uid) return false;
  if (role === 'host' && room.hostUid === uid) return true;
  const actor = orderOf(game)[actingIndex(room, game)] ?? null;
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
// （「人生の道」でゴールした人にも番は回る。その番は「おうえん」）
function nextTurn(room, game) {
  const order = orderOf(game);
  const from = turnOf(game);
  for (let k = 1; k <= order.length; k++) {
    const i = (from + k) % order.length;
    if (present(room, game, order[i])) return i;
  }
  return from;
}

/* ── 「人生の道」の進行 ── */
// 一覧（番号の並び）から、まだ出していないものを count 個（出しきったら最初から。avoid はすぐには出さない）
function lifeDraw(game, key, candidates, rng, avoid = [], count = 1) {
  const used = { ...(game.used || {}) };
  const seen = new Set(asList(used[key]).filter((i) => Number.isInteger(i)));
  const out = [];
  for (let k = 0; k < count; k++) {
    let fresh = candidates.filter((i) => !seen.has(i) && !avoid.includes(i) && !out.includes(i));
    if (!fresh.length) {
      seen.clear();
      fresh = candidates.filter((i) => !avoid.includes(i) && !out.includes(i));
      if (!fresh.length) fresh = candidates.filter((i) => !out.includes(i));
      if (!fresh.length) break;
    }
    const idx = fresh[Math.floor(rng() * fresh.length)];
    seen.add(idx);
    out.push(idx);
  }
  used[key] = [...seen];
  return { list: out, used };
}
function lifeCandidates(kind, scene) {
  if (kind === KIND.DEKIGOTO) return LIFE.events.map((_, i) => i);
  if (kind === KIND.MINNA) return asList(LIFE.minna).map((_, i) => i);
  const list = isVoteKind(kind) ? KIND.ERABU : kind;
  return Array.from({ length: LIFE[list][scene] || 0 }, (_, i) => i);
}
function lifeUsedKey(kind, scene) {
  if (kind === KIND.MINNA) return 'life_minna';
  return kind === KIND.DEKIGOTO ? 'life_event' : `life_${kind}_${scene}`;
}
// ゴールに着いた人に印を付ける。みんな着いたらおわり（順位は出さない）
function lifeSettle(room, game, pos) {
  const max = boardSize(game) - 1;
  const done = orderOf(game).map((_, i) => doneOf(game, i) || pos[i] >= max);
  const arrived = done.map((d, i) => (d && !doneOf(game, i) ? i : -1)).filter((i) => i >= 0);
  const settled = { ...game, pos, done, arrived: arrived.length ? { who: arrived, rollNo: Number(game.rollNo) || 0 } : null };
  if (done.every(Boolean)) {
    return { all: true, room: { ...room, status: STATUS.GOAL, game: { ...settled, step: STEP.LIFE_ROLL, q: null, dice: null, winner: null } } };
  }
  return { all: false, game: settled };
}
// サイコロを2つ振る。同じ目ならそのまま進み、ちがう目なら番の人が進む目を選ぶ
function lifeRoll(room, game, rollNo, seed) {
  if (!LIFE) return null;
  const turn = turnOf(game);
  if (doneOf(game, turn)) return null; // ゴールした人の番は「おうえん」
  const rng = seededRandom(seed);
  const a = Math.floor(rng() * 6) + 1;
  const b = Math.floor(rng() * 6) + 1;
  if (a === b) return lifeAdvance(room, game, a, rng, false);
  return { ...room, game: { ...game, step: STEP.LIFE_PICK, dice: [a, b], picked: null, arrived: null } };
}
// 選んだ目のぶん進み（ゴールでとまる）、止まったマスのカードを出す
function lifeAdvance(room, game, dice, rng, quick) {
  const turn = turnOf(game);
  const rollNo = Number(game.rollNo) || 0;
  const max = boardSize(game) - 1;
  const from = posOf(game, turn);
  const to = Math.min(from + dice, max);
  const pos = orderOf(game).map((_, i) => posOf(game, i));
  pos[turn] = to;
  const last = { dice, from, to, turn };
  if (quick) last.quick = true; // サイコロはもう見せたので、コマの動きだけ
  const moved = { ...game, pos, rollNo: rollNo + 1, last, dice: null, picked: null, arrived: null };
  if (to >= max) {
    const end = lifeSettle(room, moved, pos);
    if (end.all) return end.room;
    return { ...room, game: { ...end.game, step: STEP.LIFE_ROLL, q: null, turn: nextTurn(room, end.game) } };
  }
  const kind = lifeKindsOf(moved)[to];
  if (kind === KIND.KIKU) {
    const scene = lifeSceneAt(moved, to);
    // 聞く相手がほかにいないとき（1人で遊ぶ）は、そばにいる人に聞く
    if (orderOf(game).length < 2) {
      const drawn = lifeDraw(moved, lifeUsedKey(kind, scene), lifeCandidates(kind, scene), rng, [], ASK_CARDS);
      return { ...room, game: { ...moved, step: STEP.LIFE_TALK, used: drawn.used, q: { kind, scene, n: 1, target: TARGET_NEAR, opts: drawn.list } } };
    }
    return { ...room, game: { ...moved, step: STEP.LIFE_TALK, q: { kind, scene, n: 1 } } };
  }
  const scene = kind === KIND.DEKIGOTO ? null : lifeSceneAt(moved, to);
  const drawn = lifeDraw(moved, lifeUsedKey(kind, scene), lifeCandidates(kind, scene), rng);
  const q = { kind, idx: drawn.list[0], n: 1 };
  if (scene) q.scene = scene;
  return { ...room, game: { ...moved, step: STEP.LIFE_TALK, used: drawn.used, q } };
}
// 2つの目から、進む目を選ぶ（which は 0 か 1）
export function pickDie(room, gameId, rollNo, which, seed) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isPickStep(game)) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || (which !== 0 && which !== 1)) return null;
  const pair = pickDice(game);
  if (!pair) return null;
  return lifeAdvance(room, game, pair[which], seededRandom(seed), true);
}
// おうえんできる相手（まだゴールしていない、いまいる人）の順番の番号
export function cheerTargets(room, game) {
  return orderOf(game).map((_, i) => i).filter((i) => !doneOf(game, i) && present(room, game, orderOf(game)[i]));
}
// おたすけカードを使う: 自分の番のサイコロの前に、ほかの人を2マス進める（進んだ先のマスでは何も起きない）。
// have は押した時点の枚数（二度押しで2枚使わないように）。使っても番はそのまま（そのあとサイコロを振る）
export function useHelp(room, gameId, rollNo, target, have) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isLife(game) || !isRollStep(game)) return null;
  if ((Number(game.rollNo) || 0) !== rollNo) return null;
  const turn = turnOf(game);
  if (doneOf(game, turn) || have < 1 || cardsOf(game, turn) !== have) return null;
  if (!helpTargets(room, game).includes(target)) return null;
  const max = boardSize(game) - 1;
  const pos = orderOf(game).map((_, i) => posOf(game, i));
  pos[target] = Math.min(max, pos[target] + CARD_STEPS);
  const cards = {};
  orderOf(game).forEach((_, k) => { const n = cardsOf(game, k) - (k === turn ? 1 : 0); if (n > 0) cards[k] = n; });
  const end = lifeSettle(room, { ...game, cards, picked: null }, pos);
  if (end.all) return end.room;
  return { ...room, game: end.game };
}
// ゴールした人の番: まだゴールしていない人を1人選んで、1マス進める
export function cheer(room, gameId, rollNo, target) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isLife(game) || !isRollStep(game)) return null;
  if ((Number(game.rollNo) || 0) !== rollNo) return null;
  const turn = turnOf(game);
  const order = orderOf(game);
  if (!doneOf(game, turn)) return null;
  // まだゴールしていない、いまいる人だけ（いない人を進めて、いる人だけでゲームを終わらせない）
  if (!cheerTargets(room, game).includes(target)) return null;
  const max = boardSize(game) - 1;
  const pos = order.map((_, i) => posOf(game, i));
  const from = pos[target];
  pos[target] = Math.min(max, from + 1);
  const moved = {
    ...game,
    rollNo: rollNo + 1,
    last: { dice: 1, from, to: pos[target], turn: target, quick: true, cheerBy: turn },
    picked: null,
    arrived: null,
  };
  const end = lifeSettle(room, moved, pos);
  if (end.all) return end.room;
  return { ...room, game: { ...end.game, turn: nextTurn(room, end.game) } };
}
function lifeReask(room, game, q, seed) {
  if (!LIFE || q.kind === KIND.DEKIGOTO) return null;
  const rng = seededRandom(seed);
  const key = lifeUsedKey(q.kind, q.scene);
  const all = lifeCandidates(q.kind, q.scene);
  if (q.kind === KIND.KIKU) {
    if (q.phase === PHASE.WHO) return null;
    if (q.phase === PHASE.CARD) {
      // 3枚を引きなおす
      const drawn = lifeDraw(game, key, all, rng, q.opts, ASK_CARDS);
      return { ...room, game: { ...game, used: drawn.used, q: { ...game.q, opts: drawn.list, n: q.n + 1 } } };
    }
  }
  if (isVoteKind(q.kind) && q.open) return null;
  if (q.kind === KIND.MINNA && Object.keys(q.picks).length) return null; // だれかが選んだあとは、お題を変えない
  const drawn = lifeDraw(game, key, all, rng, [q.idx]);
  const next = { ...game.q, idx: drawn.list[0], n: q.n + 1 };
  if (isVoteKind(q.kind)) next.votes = null; // 質問が変わるので、選んだものは消す
  return { ...room, game: { ...game, used: drawn.used, q: next } };
}
function lifeChoose(room, game, q, choice, choiceCount, seed, text) {
  const turn = turnOf(game);
  const order = orderOf(game);
  const note = choice === CHOICE_FREE ? cleanText(text) : '';
  if (q.kind === KIND.MINNA) {
    // いま選ぶ番の人が、まだだれも選んでいないものを1つ
    const picker = minnaPicker(room, game, q);
    const options = Number(asList(LIFE?.minna)[q.idx]) || 0;
    if (picker == null || !Number.isInteger(choice) || choice < 0 || choice >= options) return null;
    if (Object.values(q.picks).includes(choice)) return null;
    // 1人選ぶたびに n を進める（番の人とホストが同時に押したとき、おそいほうが次の人のぶんとして入らないように）
    return { ...room, game: { ...game, q: { ...game.q, picks: { ...q.picks, [picker]: choice }, n: q.n + 1 } } };
  }
  if (q.kind === KIND.KIKU) {
    // だれに聞くか（自分以外の、いまいる人か、みんな）。選んだ相手がいなくなったら選びなおせる
    if (q.phase === PHASE.WHO || targetGone(room, game, q)) {
      const ok = choice === TARGET_ALL
        || (Number.isInteger(choice) && choice >= 0 && choice < order.length && choice !== turn && present(room, game, order[choice]));
      if (!ok || !LIFE) return null;
      const drawn = lifeDraw(game, lifeUsedKey(q.kind, q.scene), lifeCandidates(q.kind, q.scene), seededRandom(seed), [], ASK_CARDS);
      return { ...room, game: { ...game, used: drawn.used, q: { kind: q.kind, scene: q.scene, target: choice, opts: drawn.list, n: q.n + 1 } } };
    }
    // 3枚の質問から1枚
    if (q.phase === PHASE.CARD) {
      if (!Number.isInteger(choice) || choice < 0 || choice >= q.opts.length) return null;
      return { ...room, game: { ...game, q: { ...game.q, idx: q.opts[choice], phase: PHASE.ANSWER, n: q.n + 1 } } };
    }
    // 聞かれた人が答える（みんな・そばにいる人に聞いたときは、声やチャットで答えて「話せた！次の人へ」）
    if (q.target < 0) return null;
    if (choice !== CHOICE_FREE && !(Number.isInteger(choice) && choice >= 0 && choice < choiceCount)) return null;
    return {
      ...room,
      game: {
        ...game,
        step: STEP.LIFE_ROLL,
        q: null,
        picked: withText({ life: true, kiku: true, turn: q.target, by: turn, scene: q.scene, idx: q.idx, choice }, note),
        cards: addCard(game, turn), // 答えてもらったので、聞いた人におたすけカードを1枚
        turn: nextTurn(room, game),
      },
    };
  }
  if (q.kind !== KIND.ERABU) return null;
  if (choice !== CHOICE_FREE && !(Number.isInteger(choice) && choice >= 0 && choice < choiceCount)) return null;
  return {
    ...room,
    game: {
      ...game,
      step: STEP.LIFE_ROLL,
      q: null,
      picked: withText({ life: true, turn, scene: q.scene, idx: q.idx, choice }, note),
      turn: nextTurn(room, game),
    },
  };
}
function withText(picked, note) {
  return note ? { ...picked, text: note } : picked;
}
/* ── みんなが同時に選ぶマス（いっしょ・よそう） ── */
// 選ぶ人（いまいる人。端末のない人もふくむ）の順番の番号
export function voters(room, game) {
  return orderOf(game).map((_, i) => i).filter((i) => present(room, game, orderOf(game)[i]));
}
// 自分がその人のぶんを選んでよいか。自分の端末は自分のぶん。ホストは、自分・端末のない人・つながっていない人のぶん
// （つながっている人のぶんは本人が押す）
export function canVote(room, uid, nickname, role, voter) {
  const game = gameOf(room);
  const q = lifeQuestionOf(game);
  if (!game || room.status !== STATUS.PLAYING || !uid || !isTalkStep(game) || !q || !isVoteKind(q.kind) || q.open) return false;
  const order = orderOf(game);
  if (!Number.isInteger(voter) || voter < 0 || voter >= order.length) return false;
  const name = order[voter];
  if (role === 'host' && room.hostUid === uid) {
    return name === room.host || isProxy(game, name) || !present(room, game, name);
  }
  return role === 'guest' && name === nickname && ownsName(game, name, uid);
}
// 選ぶ（開くまでは選びなおせる）。いまいる人がみんな選んだら、自動で開く
export function vote(room, gameId, rollNo, qn, voter, choice) {
  const game = gameOf(room);
  const q = lifeQuestionOf(game);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isTalkStep(game)) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || !q || q.n !== qn || !isVoteKind(q.kind) || q.open) return null;
  if (!Number.isInteger(voter) || voter < 0 || voter >= orderOf(game).length) return null;
  if (!Number.isInteger(choice) || choice < 0 || choice >= VOTE_CHOICES) return null;
  const votes = { ...q.votes, [voter]: choice };
  const all = voters(room, game).every((i) => votes[i] != null);
  const next = { ...game.q, votes };
  if (all) next.open = true;
  return { ...room, game: { ...game, q: next } };
}
// いまいる人がみんな選んでいるのに、まだ開いていない（まだ選んでいない人が切断・退出したとき）
export function votesComplete(room, game) {
  const q = lifeQuestionOf(game);
  if (room?.status !== STATUS.PLAYING || !isTalkStep(game) || !q || !isVoteKind(q.kind) || q.open) return false;
  const list = voters(room, game);
  return list.length > 0 && list.every((i) => q.votes[i] != null);
}
// そのときに開く（ホストの見はりから）
export function openIfComplete(room) {
  const game = gameOf(room);
  if (!game || !votesComplete(room, game)) return null;
  return { ...room, game: { ...game, q: { ...game.q, open: true } } };
}
// 開く（みんなが選ぶ前に、番の人かホストが開く。選んでいない人は進まない）
export function openVotes(room, gameId, rollNo, qn) {
  const game = gameOf(room);
  const q = lifeQuestionOf(game);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isTalkStep(game)) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || !q || q.n !== qn || !isVoteKind(q.kind) || q.open) return null;
  return { ...room, game: { ...game, q: { ...game.q, open: true } } };
}
// 開いたあとの結果。answer: 番の人が選んだもの（選んでいなければ null）、same: 番の人と同じだった人、
// all: みんな同じ（いっしょのおまけ）、moves: { 順番の番号: 進むマス数 }
export function voteResult(game, q) {
  const turn = turnOf(game);
  const votes = q?.votes || {};
  const answer = votes[turn] ?? null;
  const voted = Object.keys(votes).map(Number);
  const same = answer == null ? [] : voted.filter((i) => i !== turn && votes[i] === answer);
  const moves = {};
  same.forEach((i) => { moves[i] = 1; });
  let all = false;
  if (q?.kind === KIND.ISSHO) {
    // みんな同じだったら、選んだ人みんな（番の人も）もう1マス
    all = answer != null && voted.length >= 2 && same.length === voted.length - 1;
    if (all) voted.forEach((i) => { moves[i] = (moves[i] || 0) + 1; });
  } else if (same.length) {
    // よそう: 当ててもらえたら、番の人も1マス
    moves[turn] = 1;
  }
  return { answer, same, all, moves };
}

// 「話せた！次の人へ」・できごとの「進む」。できごとで進んだ先のマスでは何も起きない
function lifeNext(room, game, q) {
  const base = { ...game, step: STEP.LIFE_ROLL, q: null, picked: null };
  if (q && isVoteKind(q.kind)) {
    if (!q.open) return null; // 開く前には進めない（先に「開く」）
    const max = boardSize(game) - 1;
    const moves = voteResult(game, q).moves;
    const pos = orderOf(game).map((_, i) => Math.min(max, posOf(game, i) + (doneOf(game, i) ? 0 : (moves[i] || 0))));
    const end = lifeSettle(room, base, pos);
    if (end.all) return end.room;
    return { ...room, game: { ...end.game, turn: nextTurn(room, end.game) } };
  }
  if (q && q.kind === KIND.MINNA) {
    // いまいる人がみんな選べたら、選んだ人みんな1マス
    const max = boardSize(game) - 1;
    const complete = Object.keys(q.picks).length > 0 && minnaPicker(room, game, q) == null;
    const pos = orderOf(game).map((_, i) => Math.min(max, posOf(game, i) + (complete && q.picks[i] != null && !doneOf(game, i) ? 1 : 0)));
    const end = lifeSettle(room, base, pos);
    if (end.all) return end.room;
    return { ...room, game: { ...end.game, turn: nextTurn(room, end.game) } };
  }
  if (q && q.kind === KIND.KIKU && q.phase === PHASE.ANSWER && orderOf(game).length >= 2) {
    // みんなに聞いて、声やチャットで答えてもらったとき
    return { ...room, game: { ...base, cards: addCard(game, turnOf(game)), turn: nextTurn(room, game) } };
  }
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
  // 人生の道は、版のちがう画面の人がいると始めない（その画面では操作できないため。読みこみなおすとそろう）
  if (modeOf(room.mode) === MODE.LIFE && staleNames(room).length) return null;
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
    game.step = STEP.LIFE_ROLL;
    game.squares = lifeSizeFor(names.length, room.lifeLen); // 人数と「長さ」から
    game.done = names.map(() => false);
    if (!room.offline && names.length >= 2) game.votes = true;
  }
  return { ...room, status: STATUS.PLAYING, lastGameId: id, game };
}

// サイコロを振る。出目のぶん進み（ゴールでとまる）、ゴールでなければ質問を出す
export function roll(room, gameId, rollNo, seed, counts) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId) return null;
  if (!isRollStep(game) || (Number(game.rollNo) || 0) !== rollNo) return null;
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
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isTalkStep(game)) return null;
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
export function choose(room, gameId, rollNo, qn, choice, choiceCount, counts, seed = 0, text = '') {
  const game = gameOf(room);
  const q = isLife(game) ? lifeQuestionOf(game) : questionOf(game, counts);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isTalkStep(game)) return null;
  if ((Number(game.rollNo) || 0) !== rollNo || !q || q.n !== qn) return null;
  if (isLife(game)) return lifeChoose(room, game, q, choice, choiceCount, seed, text);
  if (choice !== CHOICE_FREE && !(Number.isInteger(choice) && choice >= 0 && choice < choiceCount)) return null;
  return {
    ...room,
    game: {
      ...game,
      step: STEP.ROLL,
      q: null,
      picked: withText({ turn: turnOf(game), theme: q.theme, idx: q.idx, choice }, choice === CHOICE_FREE ? cleanText(text) : ''),
      turn: nextTurn(room, game),
    },
  };
}

// 「話せた！次の人へ」: 質問を消して、次の人がサイコロを振る番に
export function nextPlayer(room, gameId, rollNo) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || game.id !== gameId || !isTalkStep(game)) return null;
  if ((Number(game.rollNo) || 0) !== rollNo) return null;
  if (isLife(game)) return lifeNext(room, game, lifeQuestionOf(game));
  return { ...room, game: { ...game, step: STEP.ROLL, q: null, picked: null, turn: nextTurn(room, game) } };
}

// カードが出ているときに、その中身（できごとの効き目・選んだもの）を確定させずに次の人へ進める。
// 番の人の退出と、読めないカードで止まったときの立て直し（ホストの見はり）から
export function dropTalk(room) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || !isTalkStep(game)) return null;
  return {
    ...room,
    game: { ...game, step: isLife(game) ? STEP.LIFE_ROLL : STEP.ROLL, q: null, dice: null, picked: null, turn: nextTurn(room, game) },
  };
}
// 進む目を選ぶ段階で目が読めないとき、同じ人がサイコロを振りなおすところにもどす（ホストの見はりから）
export function dropPick(room) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || !pickBroken(game)) return null;
  return { ...room, game: { ...game, step: STEP.LIFE_ROLL, dice: null } };
}
// カードが出ているときに番の人が退出した。「みんなで」は、選んだものを捨てずに、残った人で続ける
// （通信が切れたときと同じ動きにする。進めるのはホスト）。ほかのカードは、中身を確定させずに次の人へ
export function leaveTalk(room) {
  const game = gameOf(room);
  const q = lifeQuestionOf(game);
  if (q && isTalkStep(game) && q.kind === KIND.MINNA) return room;
  return dropTalk(room);
}
// カードが出ている段階なのに、読めるカードがない（壊れた値）
export function talkBroken(game, counts) {
  if (!isTalkStep(game)) return false;
  return !(isLife(game) ? lifeQuestionOf(game) : questionOf(game, counts));
}

// サイコロを振る番の人がいなくなったら（退出・切断）、次にいる人へとばす（ホストの見はりと退出から）
export function skipAbsent(room) {
  const game = gameOf(room);
  if (room?.status !== STATUS.PLAYING || !game || !(isRollStep(game) || isPickStep(game))) return null;
  const actor = actorOf(game);
  if (actor == null || present(room, game, actor)) return null;
  const turn = nextTurn(room, game);
  if (turn === turnOf(game)) return null;
  // 目を選んでいる途中なら、その目は捨てる
  return { ...room, game: isPickStep(game) ? { ...game, step: STEP.LIFE_ROLL, dice: null, turn } : { ...game, turn } };
}

// 待合室にもどる（ゲームの途中・ゴールのあと。ホスト）
export function backToWaiting(room, gameId) {
  const game = gameOf(room);
  if (!game || game.id !== gameId || (room.status !== STATUS.PLAYING && room.status !== STATUS.GOAL)) return null;
  return { ...room, status: STATUS.WAITING, game: null };
}
