import { copyToClipboard, popIn, shuffle } from '../shared/js/utils.js';

// 選択肢の番号は room-K 共通の丸数字（AGENTS.md「選択肢・カードの番号付け」）
const NUMBERS = ['①', '②', '③', '④', '⑤'];

// waza.js（通常スクリプト）が window に載せたデータを読む。
// waza.js は index.html でこのモジュールより前に読み込まれる
const DATA = window.KotobaWaza ?? { groups: [], wazas: [] };
const GROUPS = Array.isArray(DATA.groups) ? DATA.groups : [];
const WAZAS = Array.isArray(DATA.wazas) ? DATA.wazas : [];

// ゲームカードの並び順。ここに無い app は末尾（出現順）に回るので、
// waza.js 側でゲームが増えてもこの配列を直さないと落ちる、ということにはならない
const GAME_ORDER = [
  'kotoba-pair',
  'toomawashi',
  'kotoba-tantei',
  'tatoe-narabe',
  'kaburazu-hint',
  'kotoba-mikke',
  'kotoba-relay',
  'kotoba-shuffle',
  'machigai-sagashi',
  'tatoe-gp',
  'minna-ranking',
  'quiz',
];

// 出題のカーブ。level 1（入口）1問 → level 2（少し迷う）2問 → level 3（核心）1問 の計4問。
// 毎回この配分でランダムに引き直すので、同じ技を2回やっても中身が変わる
const LEVELS = [1, 2, 3];
const LEVEL_PLAN = [
  { level: 1, count: 1 },
  { level: 2, count: 2 },
  { level: 3, count: 1 },
];
const QUIZ_SIZE = LEVEL_PLAN.reduce((sum, plan) => sum + plan.count, 0);

const state = {
  wazaId: null,    // 選択中の技
  gameApp: null,   // ゲームから入ったときの入口（もどる先の判断に使う）
  questions: [],   // 今回の出題（毎回抽選しなおす。保存しない）
  index: 0,        // 何問目（0始まり）
  revealed: false, // その問題の答えを出したか
};

const screenTop = document.getElementById('screen-top');
const screenGame = document.getElementById('screen-game');
const screenQuiz = document.getElementById('screen-quiz');
const screenSummary = document.getElementById('screen-summary');
const gameEntry = document.getElementById('gameEntry');
const gamePicker = document.getElementById('gamePicker');
const wazaFold = document.getElementById('wazaFold');
const wazaGroups = document.getElementById('wazaGroups');
const gameName = document.getElementById('gameName');
const gameLead = document.getElementById('gameLead');
const gameWazaList = document.getElementById('gameWazaList');
const btnGameBack = document.getElementById('btnGameBack');
const quizWazaName = document.getElementById('quizWazaName');
const quizProgress = document.getElementById('quizProgress');
const questionText = document.getElementById('questionText');
const choicesArea = document.getElementById('choicesArea');
const answerCard = document.getElementById('answerCard');
const answerText = document.getElementById('answerText');
const answerExplanation = document.getElementById('answerExplanation');
const btnCopyQuestion = document.getElementById('btnCopyQuestion');
const btnReveal = document.getElementById('btnReveal');
const btnNext = document.getElementById('btnNext');
const btnNextLabel = document.getElementById('btnNextLabel');
const btnQuizBack = document.getElementById('btnQuizBack');
const summaryName = document.getElementById('summaryName');
const summaryLabel = document.getElementById('summaryLabel');
const summaryCatch = document.getElementById('summaryCatch');
const gamesSection = document.getElementById('gamesSection');
const gamesList = document.getElementById('gamesList');
const btnBackTop = document.getElementById('btnBackTop');

/* ── 小さなDOMヘルパー（innerHTML を使わない = XSS の入口を作らない） ── */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const span = el('span', 'material-symbols-rounded', name);
  span.setAttribute('aria-hidden', 'true');
  return span;
}

function showScreen(id) {
  screenTop.hidden = id !== 'top';
  screenGame.hidden = id !== 'game';
  screenQuiz.hidden = id !== 'quiz';
  screenSummary.hidden = id !== 'summary';
  // 画面共有中に前の画面のスクロール位置が残らないようにする
  window.scrollTo({ top: 0 });
}

function getWaza() {
  return WAZAS.find((w) => w.id === state.wazaId) ?? null;
}

function getAllQuestions(waza) {
  return waza && Array.isArray(waza.questions) ? waza.questions : [];
}

function currentQuestion() {
  return state.questions[state.index] ?? null;
}

/* ── ゲームからの逆引き索引 ── */
// wazas[].games を走査して「ゲーム → そのゲームで使う技」を実行時に導出する。
// ゲームと技の対応表を別に持たない（waza.js だけがデータの正本。二重管理をしない）
function buildGameIndex() {
  const byApp = new Map();

  WAZAS.forEach((waza) => {
    const games = Array.isArray(waza.games) ? waza.games : [];
    games.forEach((game) => {
      if (!game || !game.app) return;

      let entry = byApp.get(game.app);
      if (!entry) {
        // 表示名は games[].name をそのまま使う（最初に見つかったものを採用）
        entry = { app: game.app, name: game.name || game.app, wazas: [] };
        byApp.set(game.app, entry);
      }
      // hint は「その技をこのゲームでどう使うか」。同じ技でもゲームごとに文言がちがう
      entry.wazas.push({ waza, hint: game.hint ?? '' });
    });
  });

  const rank = (app) => {
    const i = GAME_ORDER.indexOf(app);
    return i < 0 ? GAME_ORDER.length : i; // 未知の app は末尾
  };
  // 未知の app どうしは出現順のまま（Array.prototype.sort は安定ソート）
  return [...byApp.values()].sort((a, b) => rank(a.app) - rank(b.app));
}

const GAME_INDEX = buildGameIndex();

function getGame(app) {
  return GAME_INDEX.find((g) => g.app === app) ?? null;
}

/* ── 出題の抽選 ── */
// level ごとの箱から LEVEL_PLAN のとおりに引き、level 昇順（1→2→2→3）で並べて返す。
// 後方互換: level が付いていない技・4問以下の技は、従来どおり配列順に最大4問。
function selectQuestions(waza) {
  const all = getAllQuestions(waza);
  if (all.length <= QUIZ_SIZE || !all.every((q) => LEVELS.includes(q?.level))) {
    return all.slice(0, QUIZ_SIZE);
  }

  const pools = new Map(
    LEVELS.map((level) => [level, shuffle(all.filter((q) => q.level === level))]),
  );

  const picked = [];
  LEVEL_PLAN.forEach(({ level, count }) => {
    for (let i = 0; i < count; i++) {
      const question = takeNearest(pools, level);
      if (question) picked.push(question);
    }
  });

  // 同じ level の中は抽選順のまま（安定ソート）。補充が起きても並びは level 昇順になる
  return picked.sort((a, b) => a.level - b.level);
}

// 指定 level の箱から1問取り出す。空なら level が近い箱から順に補う（合計4問を保証する）
function takeNearest(pools, level) {
  const order = [...LEVELS].sort(
    (a, b) => Math.abs(a - level) - Math.abs(b - level) || a - b,
  );
  for (const l of order) {
    const pool = pools.get(l);
    if (pool && pool.length) return pool.shift();
  }
  return null;
}

/* ── TOP：ゲームからえらぶ（主） ── */
function renderGamePicker() {
  gamePicker.textContent = '';

  GAME_INDEX.forEach((game) => {
    const card = el('button', 'kw-gamecard');
    card.type = 'button';

    const body = el('div', 'kw-gamecard__body');
    body.appendChild(el('span', 'kw-gamecard__name', game.name));
    body.appendChild(el('span', 'kw-gamecard__count', `合う技 ${game.wazas.length}個`));

    card.appendChild(body);
    card.appendChild(icon('chevron_right'));
    card.addEventListener('click', () => showGame(game.app));
    gamePicker.appendChild(card);
  });

  // ゲームが1つも紐づいていないデータのときは、この入口ごと消して技のいちらんを開いておく
  const empty = !gamePicker.childElementCount;
  gameEntry.hidden = empty;
  if (empty) wazaFold.open = true;
}

/* ── TOP：技のいちらんからえらぶ（副） ── */
function renderWazaGroups() {
  wazaGroups.textContent = '';

  GROUPS.forEach((group) => {
    const wazas = WAZAS.filter((w) => w.group === group.id);
    if (!wazas.length) return; // 技が1つもないグループは見出しごと出さない

    const section = el('section', 'kw-group');
    section.appendChild(el('h3', 'kw-group__title', group.name));

    const list = el('div', 'kw-group__chips');
    wazas.forEach((waza) => {
      const chip = el('button', 'kw-chip');
      chip.type = 'button';
      chip.appendChild(el('span', 'kw-chip__name', waza.name));
      if (waza.label) chip.appendChild(el('span', 'kw-chip__label', waza.label));
      chip.addEventListener('click', () => startQuiz(waza.id, null));
      list.appendChild(chip);
    });

    section.appendChild(list);
    wazaGroups.appendChild(section);
  });

  if (!wazaGroups.childElementCount) {
    wazaGroups.appendChild(el('p', 'kw-empty', '技のデータがまだありません。'));
  }
}

/* ── ゲーム別の技えらび（逆引き画面） ── */
function showGame(app) {
  const game = getGame(app);
  if (!game) {
    backToTop();
    return;
  }

  state.gameApp = app;
  gameName.textContent = game.name;
  gameLead.textContent =
    `このゲームに合う技が${game.wazas.length}個あります。1つえらぶとクイズがはじまります。`;

  gameWazaList.textContent = '';
  game.wazas.forEach(({ waza, hint }) => {
    const card = el('button', 'kw-wazacard');
    card.type = 'button';

    const body = el('div', 'kw-wazacard__body');
    const head = el('div', 'kw-wazacard__head');
    head.appendChild(el('span', 'kw-wazacard__name', waza.name));
    if (waza.label) head.appendChild(el('span', 'kw-wazacard__label', waza.label));
    body.appendChild(head);

    if (hint) {
      body.appendChild(el('span', 'kw-wazacard__hintlabel', 'このゲームでのつかいどころ'));
      body.appendChild(el('span', 'kw-wazacard__hint', hint));
    }

    card.appendChild(body);
    card.appendChild(icon('chevron_right'));
    card.addEventListener('click', () => startQuiz(waza.id, app));
    gameWazaList.appendChild(card);
  });

  showScreen('game');
}

/* ── クイズ ── */
// どちらの入口から入っても、ここから先の流れは同じ
function startQuiz(wazaId, fromGameApp) {
  const waza = WAZAS.find((w) => w.id === wazaId);
  if (!waza) return;

  const questions = selectQuestions(waza);
  if (!questions.length) return;

  state.wazaId = wazaId;
  state.gameApp = fromGameApp ?? null;
  state.questions = questions;
  state.index = 0;
  state.revealed = false;

  window.RoomkStats?.count('waza-' + wazaId);

  renderQuestion();
  showScreen('quiz');
}

function renderQuestion() {
  const waza = getWaza();
  const current = currentQuestion();
  if (!waza || !current) {
    showSummary();
    return;
  }

  state.revealed = false;

  quizWazaName.textContent = waza.name;
  quizProgress.textContent = `${state.index + 1}問目 / ${state.questions.length}`;
  questionText.textContent = current.q;

  renderChoices(current);

  answerCard.hidden = true;
  answerText.textContent = '';
  answerExplanation.textContent = '';
  btnReveal.hidden = false;
  btnNext.hidden = true;
  btnNextLabel.textContent = state.index === state.questions.length - 1 ? 'まとめを見る' : '次へ';
}

function renderChoices(question) {
  choicesArea.textContent = '';

  (question.choices ?? []).forEach((choice, i) => {
    const item = el('li', 'kw-choice');
    item.dataset.index = String(i);
    item.appendChild(el('span', 'kw-choice__num', NUMBERS[i] ?? `(${i + 1})`));
    item.appendChild(el('span', 'kw-choice__text', choice));
    choicesArea.appendChild(item);
  });
}

function reveal() {
  if (state.revealed) return;

  const current = currentQuestion();
  if (!current) return;

  state.revealed = true;

  const answerIndex = current.answerIndex;
  Array.from(choicesArea.children).forEach((item, i) => {
    // 正解だけを強調する。ほかを「まちがい」として色づけはしない
    item.classList.add(i === answerIndex ? 'kw-choice--correct' : 'kw-choice--dim');
  });

  const answerChoice = (current.choices ?? [])[answerIndex] ?? '';
  answerText.textContent = `${NUMBERS[answerIndex] ?? ''} ${answerChoice}`.trim();
  answerExplanation.textContent = current.explanation ?? '';
  answerCard.hidden = false;

  btnReveal.hidden = true;
  btnNext.hidden = false;

  popIn(answerCard);
}

function goNext() {
  if (!state.revealed) return;

  if (state.index >= state.questions.length - 1) {
    showSummary();
    return;
  }

  state.index += 1;
  renderQuestion();
}

/* ── まとめ（きょうのゲームへの橋渡し） ── */
function showSummary() {
  const waza = getWaza();
  if (!waza) {
    backToTop();
    return;
  }

  summaryName.textContent = waza.name;
  summaryLabel.textContent = waza.label ?? '';
  summaryLabel.hidden = !waza.label;
  summaryCatch.textContent = waza.catch ?? '';

  renderGames(waza);
  showScreen('summary');
  popIn(summaryCatch);
}

function renderGames(waza) {
  gamesList.textContent = '';

  const games = Array.isArray(waza.games) ? waza.games : [];
  gamesSection.hidden = !games.length;
  if (!games.length) return;

  games.forEach((game) => {
    const link = el('a', 'kw-game');
    link.href = `../${game.app}/`;

    const body = el('div', 'kw-game__body');
    body.appendChild(el('span', 'kw-game__name', game.name));
    if (game.hint) body.appendChild(el('span', 'kw-game__hint', game.hint));

    link.appendChild(body);
    link.appendChild(icon('chevron_right'));
    gamesList.appendChild(link);
  });
}

/* ── チャット貼り付け用のコピー ── */
// 1行目に問題文、以降 ①②③。答えの手がかりになる語は入れない
function formatQuestionText(question) {
  const lines = [question.q];
  (question.choices ?? []).forEach((choice, i) => {
    lines.push(`${NUMBERS[i] ?? `(${i + 1})`} ${choice}`);
  });
  return lines.join('\n');
}

function copyQuestion() {
  const current = currentQuestion();
  if (!current) return;
  copyToClipboard(formatQuestionText(current), btnCopyQuestion);
}

/* ── ナビゲーション ── */
function resetQuiz() {
  state.wazaId = null;
  state.questions = [];
  state.index = 0;
  state.revealed = false;
}

function backToTop() {
  resetQuiz();
  state.gameApp = null;
  showScreen('top');
}

// クイズ中の「技えらびにもどる」は、入ってきた入口に戻す
// （ゲームから入ったならそのゲームの技えらび、技のいちらんから入ったなら TOP）
function backToPicker() {
  const game = state.gameApp ? getGame(state.gameApp) : null;
  resetQuiz();
  if (game) {
    showGame(game.app);
    return;
  }
  backToTop();
}

btnGameBack.addEventListener('click', backToTop);
btnCopyQuestion.addEventListener('click', copyQuestion);
btnReveal.addEventListener('click', reveal);
btnNext.addEventListener('click', goNext);
btnQuizBack.addEventListener('click', backToPicker);
btnBackTop.addEventListener('click', backToTop);

renderGamePicker();
renderWazaGroups();
showScreen('top');
