import { copyToClipboard, popIn } from '../shared/js/utils.js';

// 選択肢の番号は room-K 共通の丸数字（AGENTS.md「選択肢・カードの番号付け」）
const NUMBERS = ['①', '②', '③', '④', '⑤'];

// waza.js（通常スクリプト）が window に載せたデータを読む。
// waza.js は index.html でこのモジュールより前に読み込まれる
const DATA = window.KotobaWaza ?? { groups: [], wazas: [] };
const GROUPS = Array.isArray(DATA.groups) ? DATA.groups : [];
const WAZAS = Array.isArray(DATA.wazas) ? DATA.wazas : [];

const state = {
  wazaId: null,   // 選択中の技
  index: 0,       // 何問目（0始まり）
  revealed: false, // その問題の答えを出したか
};

const screenTop = document.getElementById('screen-top');
const screenQuiz = document.getElementById('screen-quiz');
const screenSummary = document.getElementById('screen-summary');
const wazaGroups = document.getElementById('wazaGroups');
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
  screenQuiz.hidden = id !== 'quiz';
  screenSummary.hidden = id !== 'summary';
  // 画面共有中に前の画面のスクロール位置が残らないようにする
  window.scrollTo({ top: 0 });
}

function getWaza() {
  return WAZAS.find((w) => w.id === state.wazaId) ?? null;
}

function getQuestions(waza) {
  return waza && Array.isArray(waza.questions) ? waza.questions : [];
}

/* ── TOP（技えらび） ── */
function renderTop() {
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
      chip.addEventListener('click', () => startQuiz(waza.id));
      list.appendChild(chip);
    });

    section.appendChild(list);
    wazaGroups.appendChild(section);
  });

  if (!wazaGroups.childElementCount) {
    wazaGroups.appendChild(el('p', 'kw-empty', '技のデータがまだありません。'));
  }
}

/* ── クイズ ── */
function startQuiz(wazaId) {
  state.wazaId = wazaId;
  state.index = 0;
  state.revealed = false;

  const waza = getWaza();
  if (!waza || !getQuestions(waza).length) return;

  window.RoomkStats?.count('waza-' + wazaId);

  renderQuestion();
  showScreen('quiz');
}

function renderQuestion() {
  const waza = getWaza();
  const questions = getQuestions(waza);
  const current = questions[state.index];
  if (!current) {
    showSummary();
    return;
  }

  state.revealed = false;

  quizWazaName.textContent = waza.name;
  quizProgress.textContent = `${state.index + 1}問目 / ${questions.length}`;
  questionText.textContent = current.q;

  renderChoices(current);

  answerCard.hidden = true;
  answerText.textContent = '';
  answerExplanation.textContent = '';
  btnReveal.hidden = false;
  btnNext.hidden = true;
  btnNextLabel.textContent = state.index === questions.length - 1 ? 'まとめを見る' : '次へ';
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

  const waza = getWaza();
  const current = getQuestions(waza)[state.index];
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

  const questions = getQuestions(getWaza());
  if (state.index >= questions.length - 1) {
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
  const current = getQuestions(getWaza())[state.index];
  if (!current) return;
  copyToClipboard(formatQuestionText(current), btnCopyQuestion);
}

/* ── ナビゲーション ── */
function backToTop() {
  state.wazaId = null;
  state.index = 0;
  state.revealed = false;
  showScreen('top');
}

btnCopyQuestion.addEventListener('click', copyQuestion);
btnReveal.addEventListener('click', reveal);
btnNext.addEventListener('click', goNext);
btnQuizBack.addEventListener('click', backToTop);
btnBackTop.addEventListener('click', backToTop);

renderTop();
showScreen('top');
