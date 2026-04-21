import { shuffle, popIn, copyToClipboard } from '../shared/js/utils.js';
import { QUIZ_PACKS } from './questions.js';

const ALL_PACK = {
  id: 'all-shuffle',
  name: 'ぜんぶシャッフル',
  description: '4つのパックをまぜてランダム出題',
  icon: 'shuffle',
  questions: QUIZ_PACKS.flatMap((pack) =>
    pack.questions.map((question) => ({
      ...question,
      sourcePackName: pack.name,
    }))
  ),
};

const PACK_OPTIONS = [...QUIZ_PACKS, ALL_PACK];

const QUESTIONS_PER_ROUND = 5;

const state = {
  selectedPackId: null,
  deck: [],
  index: 0,
  score: 0,
  answered: false,
};

const screenTop = document.getElementById('screen-top');
const screenQuiz = document.getElementById('screen-quiz');
const screenEnd = document.getElementById('screen-end');
const packGrid = document.getElementById('packGrid');
const btnStart = document.getElementById('btnStart');
const quizPackName = document.getElementById('quizPackName');
const quizProgress = document.getElementById('quizProgress');
const questionText = document.getElementById('questionText');
const choicesArea = document.getElementById('choicesArea');
const feedbackCard = document.getElementById('feedbackCard');
const feedbackResult = document.getElementById('feedbackResult');
const feedbackAnswer = document.getElementById('feedbackAnswer');
const feedbackExplanation = document.getElementById('feedbackExplanation');
const btnNext = document.getElementById('btnNext');
const endPackName = document.getElementById('endPackName');
const endScore = document.getElementById('endScore');
const endMessage = document.getElementById('endMessage');
const btnReplay = document.getElementById('btnReplay');
const btnBackTop = document.getElementById('btnBackTop');
const btnCopyQuestion = document.getElementById('btnCopyQuestion');
const btnCopyAnswer = document.getElementById('btnCopyAnswer');

function showScreen(id) {
  screenTop.hidden = id !== 'top';
  screenQuiz.hidden = id !== 'quiz';
  screenEnd.hidden = id !== 'end';
}

function getSelectedPack() {
  return PACK_OPTIONS.find((pack) => pack.id === state.selectedPackId) ?? null;
}

function renderPackCards() {
  packGrid.innerHTML = '';

  PACK_OPTIONS.forEach((pack) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qz-pack-card';
    if (pack.id === state.selectedPackId) button.classList.add('is-selected');
    button.setAttribute('role', 'listitem');
    button.setAttribute('aria-pressed', pack.id === state.selectedPackId ? 'true' : 'false');

    const countLabel = `${pack.questions.length}問`;

    button.innerHTML = `
      <div class="qz-pack-card__top">
        <span class="qz-pack-card__icon material-symbols-rounded">${pack.icon}</span>
        <span class="badge qz-pack-card__count">${countLabel}</span>
      </div>
      <div class="qz-pack-card__title">${pack.name}</div>
      <div class="qz-pack-card__desc">${pack.description}</div>
    `;

    button.addEventListener('click', () => {
      state.selectedPackId = pack.id;
      btnStart.disabled = false;
      renderPackCards();
    });

    packGrid.appendChild(button);
  });
}

function makeDeck() {
  const pack = getSelectedPack();
  if (!pack) return [];
  // difficulty ごとにシャッフルし、各層から抜いて結合（d1:1, d2:2, d3:2）
  const questions = pack.questions.map((q) => ({ ...q }));
  const d1 = shuffle(questions.filter((q) => q.difficulty === 1));
  const d2 = shuffle(questions.filter((q) => q.difficulty === 2));
  const d3 = shuffle(questions.filter((q) => q.difficulty === 3));
  return [
    ...d1.slice(0, 1),
    ...d2.slice(0, 2),
    ...d3.slice(0, 2),
  ];
}

function startQuiz() {
  const pack = getSelectedPack();
  if (!pack) return;

  state.deck = makeDeck();
  state.index = 0;
  state.score = 0;
  state.answered = false;

  quizPackName.textContent = pack.name;
  renderQuestion();
  showScreen('quiz');
}

function renderQuestion() {
  const pack = getSelectedPack();
  const current = state.deck[state.index];

  if (!pack || !current) {
    finishQuiz();
    return;
  }

  state.answered = false;
  quizPackName.textContent = pack.name;
  quizProgress.textContent = `Q${state.index + 1} / ${state.deck.length}`;
  questionText.textContent = current.question;

  feedbackCard.hidden = true;
  feedbackResult.textContent = '';
  feedbackAnswer.textContent = '';
  feedbackExplanation.textContent = '';
  btnNext.hidden = true;
  btnNext.innerHTML = `
    <span class="material-symbols-rounded">arrow_forward</span>
    ${state.index === state.deck.length - 1 ? '結果を見る' : '次の問題へ'}
  `;

  renderChoices(current);
}

function renderChoices(question) {
  choicesArea.innerHTML = '';

  question.choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qz-choice';
    button.textContent = choice;
    button.addEventListener('click', () => answerQuestion(index));
    choicesArea.appendChild(button);
  });
}

function answerQuestion(choiceIndex) {
  if (state.answered) return;

  const current = state.deck[state.index];
  if (!current) return;

  state.answered = true;

  const buttons = Array.from(choicesArea.querySelectorAll('.qz-choice'));
  buttons.forEach((button, index) => {
    button.disabled = true;

    if (index === current.answerIndex) {
      button.classList.add('qz-choice--correct');
      return;
    }

    if (index === choiceIndex) {
      button.classList.add('qz-choice--wrong');
      return;
    }

    button.classList.add('qz-choice--muted');
  });

  const isCorrect = choiceIndex === current.answerIndex;
  if (isCorrect) state.score += 1;

  feedbackResult.textContent = isCorrect ? 'せいかい！' : 'おしい！';
  feedbackAnswer.textContent = `正解: ${current.choices[current.answerIndex]}`;
  feedbackExplanation.textContent = current.explanation;
  feedbackCard.hidden = false;
  btnNext.hidden = false;

  popIn(feedbackCard);
}

function goNext() {
  if (!state.answered) return;

  if (state.index >= state.deck.length - 1) {
    finishQuiz();
    return;
  }

  state.index += 1;
  renderQuestion();
}

function finishQuiz() {
  const pack = getSelectedPack();
  const total = state.deck.length;
  const ratio = total ? state.score / total : 0;

  endPackName.textContent = pack ? pack.name : 'クイズパック';
  endScore.textContent = `${state.score} / ${total}`;
  endMessage.textContent =
    ratio >= 0.8
      ? 'いい調子。このまま次のパックにも挑戦できそうです。'
      : ratio >= 0.5
        ? 'ちょうどいい手ごたえ。もう一度やると見え方が変わります。'
        : 'まだまだこれから。気楽に次のラウンドへどうぞ。';

  showScreen('end');
  popIn(endScore);
}

function backToTop() {
  showScreen('top');
}

/* ── コピー機能 ── */
function formatQuestionText(q) {
  const lines = [`【問題】`, q.question];
  q.choices.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
  return lines.join('\n');
}

function copyQuestion() {
  const q = state.deck[state.index];
  if (!q) return;
  copyToClipboard(formatQuestionText(q), btnCopyQuestion);
}

function copyAnswer() {
  const q = state.deck[state.index];
  if (!q) return;
  const lines = [
    formatQuestionText(q),
    '',
    `【正解】`,
    `${q.answerIndex + 1}. ${q.choices[q.answerIndex]}`,
    '',
    `【解説】`,
    q.explanation,
  ];
  copyToClipboard(lines.join('\n'), btnCopyAnswer);
}

btnStart.addEventListener('click', startQuiz);
btnNext.addEventListener('click', goNext);
btnReplay.addEventListener('click', startQuiz);
btnBackTop.addEventListener('click', backToTop);
btnCopyQuestion.addEventListener('click', copyQuestion);
btnCopyAnswer.addEventListener('click', copyAnswer);

renderPackCards();
showScreen('top');
