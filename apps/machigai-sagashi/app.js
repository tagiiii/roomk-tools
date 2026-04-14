import { shuffle, popIn } from '../shared/js/utils.js';
import { QUESTIONS, CATEGORIES } from './questions.js';

const ALL_CAT = { id: 'all', name: 'ぜんぶシャッフル', icon: 'shuffle' };
const CAT_OPTIONS = [
  ...Object.entries(CATEGORIES).map(([id, c]) => ({ id, ...c })),
  ALL_CAT,
];

const QUESTIONS_PER_ROUND = 5;

/* ── 状態 ── */
const state = {
  catId: null,
  deck: [],
  index: 0,
  total: 0,
};

/* ── DOM参照 ── */
const screenTop  = document.getElementById('screen-top');
const screenPlay = document.getElementById('screen-play');
const screenEnd  = document.getElementById('screen-end');

const catGrid      = document.getElementById('catGrid');
const btnStart     = document.getElementById('btnStart');
const playCat      = document.getElementById('playCat');
const playProgress = document.getElementById('playProgress');
const originalText = document.getElementById('originalText');
const modifiedText = document.getElementById('modifiedText');
const btnReveal    = document.getElementById('btnReveal');
const feedbackArea = document.getElementById('feedbackArea');
const feedbackAnswer = document.getElementById('feedbackAnswer');
const feedbackDetail = document.getElementById('feedbackDetail');
const btnNext      = document.getElementById('btnNext');
const endCat       = document.getElementById('endCat');
const endScore     = document.getElementById('endScore');
const btnReplay    = document.getElementById('btnReplay');
const btnBackTop   = document.getElementById('btnBackTop');

/* ── 画面切替 ── */
function showScreen(id) {
  screenTop.hidden  = id !== 'top';
  screenPlay.hidden = id !== 'play';
  screenEnd.hidden  = id !== 'end';
}

/* ── ジャンル選択カード描画 ── */
function renderCatCards() {
  catGrid.innerHTML = '';
  CAT_OPTIONS.forEach((cat) => {
    const count = cat.id === 'all'
      ? QUESTIONS.length
      : QUESTIONS.filter((q) => q.category === cat.id).length;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ms-cat-card';
    if (cat.id === state.catId) btn.classList.add('is-selected');
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', cat.id === state.catId ? 'true' : 'false');

    btn.innerHTML = `
      <span class="material-symbols-rounded ms-cat-card__icon">${cat.icon}</span>
      <span class="ms-cat-card__label">${cat.name}</span>
      <span class="ms-cat-card__count">${count}問</span>
    `;

    btn.addEventListener('click', () => {
      state.catId = cat.id;
      btnStart.disabled = false;
      renderCatCards();
    });

    catGrid.appendChild(btn);
  });
}

/* ── デッキ生成 ── */
function makeDeck() {
  const pool = state.catId === 'all'
    ? [...QUESTIONS]
    : QUESTIONS.filter((q) => q.category === state.catId);
  return shuffle(pool).slice(0, QUESTIONS_PER_ROUND);
}

/* ── ゲーム開始 ── */
function startGame() {
  const cat = CAT_OPTIONS.find((c) => c.id === state.catId);
  if (!cat) return;

  state.deck = makeDeck();
  state.index = 0;
  state.total = state.deck.length;

  playCat.textContent = cat.name;
  showScreen('play');
  renderQuestion();
}

/* ── 問題描画 ── */
function renderQuestion() {
  const q = state.deck[state.index];
  if (!q) { finishGame(); return; }

  playProgress.textContent = `Q${state.index + 1} / ${state.total}`;
  originalText.textContent = q.original;
  modifiedText.textContent = q.modified;

  feedbackArea.hidden = true;
  btnNext.hidden = true;
  btnReveal.hidden = false;

  btnNext.innerHTML = state.index >= state.total - 1
    ? '<span class="material-symbols-rounded">emoji_events</span> 結果を見る'
    : '<span class="material-symbols-rounded">arrow_forward</span> 次のもんだい';
}

/* ── こたえを見る ── */
function revealAnswer() {
  const q = state.deck[state.index];
  if (!q) return;

  feedbackAnswer.textContent = q.wrongPart;
  feedbackDetail.textContent = q.answer;
  feedbackArea.hidden = false;
  btnReveal.hidden = true;
  btnNext.hidden = false;
  popIn(feedbackArea);
}

/* ── 次の問題 ── */
function goNext() {
  if (state.index >= state.total - 1) {
    finishGame();
    return;
  }
  state.index += 1;
  renderQuestion();
}

/* ── ゲーム終了 ── */
function finishGame() {
  const cat = CAT_OPTIONS.find((c) => c.id === state.catId);
  endCat.textContent = cat ? cat.name : 'まちがいさがし';
  endScore.textContent = `${state.total}問クリア`;
  showScreen('end');
  popIn(endScore);
}

/* ── TOPに戻る ── */
function backToTop() {
  showScreen('top');
}

/* ── イベント ── */
btnStart.addEventListener('click', startGame);
btnReveal.addEventListener('click', revealAnswer);
btnNext.addEventListener('click', goNext);
btnReplay.addEventListener('click', startGame);
btnBackTop.addEventListener('click', backToTop);

/* ── 初期化 ── */
renderCatCards();
showScreen('top');
