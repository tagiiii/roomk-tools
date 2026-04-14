import { shuffle, popIn } from '../shared/js/utils.js';
import { WORDS } from './words.js';

/* ── レベル定義 ── */
const LEVELS = [
  { id: 'easy',   label: 'かんたん',   chars: 3, icon: 'looks_3',  desc: '3もじ' },
  { id: 'normal', label: 'ふつう',     chars: 4, icon: 'looks_4',  desc: '4もじ' },
  { id: 'hard',   label: 'むずかしい', chars: 5, icon: 'looks_5',  desc: '5もじ' },
  { id: 'expert', label: 'ちょうせん', chars: 6, icon: 'looks_6',  desc: '6もじ' },
];

const QUESTIONS_PER_ROUND = 8;

/* ── 状態 ── */
const state = {
  levelId: null,
  deck: [],
  index: 0,
  score: 0,
  currentWord: null,
  shuffledChars: [],
  placedChars: [],   // スロットに置かれた文字（null = 空）
  solved: false,
};

/* ── DOM参照 ── */
const screenTop  = document.getElementById('screen-top');
const screenPlay = document.getElementById('screen-play');
const screenEnd  = document.getElementById('screen-end');

const levelGrid    = document.getElementById('levelGrid');
const btnStart     = document.getElementById('btnStart');
const playLevel    = document.getElementById('playLevel');
const playProgress = document.getElementById('playProgress');
const tilesArea    = document.getElementById('tilesArea');
const slotsArea    = document.getElementById('slotsArea');
const hintArea     = document.getElementById('hintArea');
const hintText     = document.getElementById('hintText');
const btnHint      = document.getElementById('btnHint');
const btnReset     = document.getElementById('btnReset');
const feedbackArea = document.getElementById('feedbackArea');
const feedbackResult = document.getElementById('feedbackResult');
const feedbackWord = document.getElementById('feedbackWord');
const btnNext      = document.getElementById('btnNext');
const endLevel     = document.getElementById('endLevel');
const endScore     = document.getElementById('endScore');
const endMessage   = document.getElementById('endMessage');
const btnReplay    = document.getElementById('btnReplay');
const btnBackTop   = document.getElementById('btnBackTop');

/* ── 画面切替 ── */
function showScreen(id) {
  screenTop.hidden  = id !== 'top';
  screenPlay.hidden = id !== 'play';
  screenEnd.hidden  = id !== 'end';
}

/* ── レベル選択カード描画 ── */
function renderLevels() {
  levelGrid.innerHTML = '';
  LEVELS.forEach((lv) => {
    const count = WORDS.filter((w) => w.difficulty === lv.chars).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ks-level-card';
    if (lv.id === state.levelId) btn.classList.add('is-selected');
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', lv.id === state.levelId ? 'true' : 'false');
    btn.innerHTML = `
      <span class="material-symbols-rounded ks-level-card__icon">${lv.icon}</span>
      <span class="ks-level-card__label">${lv.label}</span>
      <span class="ks-level-card__desc">${lv.desc} / ${count}問</span>
    `;
    btn.addEventListener('click', () => {
      state.levelId = lv.id;
      btnStart.disabled = false;
      renderLevels();
    });
    levelGrid.appendChild(btn);
  });
}

/* ── デッキ生成 ── */
function makeDeck() {
  const level = LEVELS.find((l) => l.id === state.levelId);
  if (!level) return [];
  const pool = WORDS.filter((w) => w.difficulty === level.chars);
  const shuffled = shuffle(pool);
  return shuffled.slice(0, QUESTIONS_PER_ROUND);
}

/* ── ゲーム開始 ── */
function startGame() {
  const level = LEVELS.find((l) => l.id === state.levelId);
  if (!level) return;

  state.deck = makeDeck();
  state.index = 0;
  state.score = 0;

  playLevel.textContent = `${level.label}（${level.desc}）`;
  showScreen('play');
  renderQuestion();
}

/* ── 問題描画 ── */
function renderQuestion() {
  const q = state.deck[state.index];
  if (!q) { finishGame(); return; }

  state.currentWord = q;
  const chars = q.word.split('');
  state.shuffledChars = shuffleUntilDifferent(chars);
  state.placedChars = new Array(chars.length).fill(null);
  state.solved = false;

  playProgress.textContent = `Q${state.index + 1} / ${state.deck.length}`;
  hintArea.hidden = true;
  feedbackArea.hidden = true;
  btnNext.hidden = true;
  btnHint.hidden = false;
  btnReset.hidden = false;

  renderTiles();
  renderSlots();
}

/** シャッフル結果が元と同じにならないようにする */
function shuffleUntilDifferent(chars) {
  const original = chars.join('');
  let result;
  let attempts = 0;
  do {
    result = shuffle([...chars]);
    attempts++;
  } while (result.join('') === original && attempts < 20);
  return result;
}

/* ── タイル描画 ── */
function renderTiles() {
  tilesArea.innerHTML = '';
  state.shuffledChars.forEach((ch, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ks-tile';
    btn.textContent = ch;
    btn.dataset.index = i;

    // すでにスロットに置かれている場合は非表示
    if (state.placedChars.includes(i)) {
      btn.classList.add('ks-tile--used');
    }

    btn.addEventListener('click', () => placeTile(i));
    tilesArea.appendChild(btn);
  });
}

/* ── スロット描画 ── */
function renderSlots() {
  slotsArea.innerHTML = '';
  state.placedChars.forEach((tileIdx, slotIdx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ks-slot';

    if (tileIdx !== null) {
      btn.textContent = state.shuffledChars[tileIdx];
      btn.classList.add('ks-slot--filled');
      btn.addEventListener('click', () => removeTile(slotIdx));
    } else {
      btn.classList.add('ks-slot--empty');
    }

    slotsArea.appendChild(btn);
  });
}

/* ── タイルをスロットに置く ── */
function placeTile(tileIndex) {
  if (state.solved) return;
  if (state.placedChars.includes(tileIndex)) return;

  const emptySlot = state.placedChars.indexOf(null);
  if (emptySlot === -1) return;

  state.placedChars[emptySlot] = tileIndex;
  renderTiles();
  renderSlots();

  // 全スロット埋まったら判定
  if (!state.placedChars.includes(null)) {
    checkAnswer();
  }
}

/* ── スロットからタイルを戻す ── */
function removeTile(slotIndex) {
  if (state.solved) return;
  if (state.placedChars[slotIndex] === null) return;

  state.placedChars[slotIndex] = null;
  renderTiles();
  renderSlots();
}

/* ── 正解判定 ── */
function checkAnswer() {
  const answer = state.placedChars
    .map((tileIdx) => state.shuffledChars[tileIdx])
    .join('');
  const correct = state.currentWord.word;

  state.solved = true;
  const isCorrect = answer === correct;
  if (isCorrect) state.score += 1;

  // スロットにフィードバック色
  const slots = slotsArea.querySelectorAll('.ks-slot');
  slots.forEach((slot) => {
    slot.classList.add(isCorrect ? 'ks-slot--correct' : 'ks-slot--wrong');
  });

  feedbackResult.textContent = isCorrect ? 'せいかい！' : 'おしい！';
  feedbackWord.textContent = `こたえ: ${correct}`;
  feedbackArea.hidden = false;
  btnNext.hidden = false;
  btnHint.hidden = true;
  btnReset.hidden = true;

  btnNext.innerHTML = state.index >= state.deck.length - 1
    ? '<span class="material-symbols-rounded">emoji_events</span> 結果を見る'
    : '<span class="material-symbols-rounded">arrow_forward</span> 次のもんだい';

  popIn(feedbackArea);
}

/* ── ヒント表示 ── */
function showHint() {
  if (!state.currentWord) return;
  const hint = state.currentWord.hint;
  if (!hint) {
    hintText.textContent = 'ヒントはありません';
  } else {
    hintText.textContent = hint;
  }
  hintArea.hidden = false;
  popIn(hintArea);
}

/* ── やりなおす ── */
function resetTiles() {
  if (state.solved) return;
  state.placedChars = new Array(state.currentWord.word.length).fill(null);
  renderTiles();
  renderSlots();
}

/* ── 次の問題 ── */
function goNext() {
  if (!state.solved) return;
  if (state.index >= state.deck.length - 1) {
    finishGame();
    return;
  }
  state.index += 1;
  renderQuestion();
}

/* ── ゲーム終了 ── */
function finishGame() {
  const level = LEVELS.find((l) => l.id === state.levelId);
  const total = state.deck.length;
  const ratio = total ? state.score / total : 0;

  endLevel.textContent = level ? `${level.label}（${level.desc}）` : 'ことばシャッフル';
  endScore.textContent = `${state.score} / ${total}`;
  endMessage.textContent =
    ratio >= 0.8
      ? 'すごい！ことばマスターだね。'
      : ratio >= 0.5
        ? 'いい調子！もう一回やるともっとわかるかも。'
        : 'どんまい！くりかえすとどんどんわかるよ。';

  showScreen('end');
  popIn(endScore);
}

/* ── TOPに戻る ── */
function backToTop() {
  showScreen('top');
}

/* ── イベント登録 ── */
btnStart.addEventListener('click', startGame);
btnHint.addEventListener('click', showHint);
btnReset.addEventListener('click', resetTiles);
btnNext.addEventListener('click', goNext);
btnReplay.addEventListener('click', startGame);
btnBackTop.addEventListener('click', backToTop);

/* ── 初期化 ── */
renderLevels();
showScreen('top');
