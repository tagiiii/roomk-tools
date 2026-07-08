import { shuffle, popIn, copyToClipboard, escapeHtml } from '../shared/js/utils.js';
import { QUIZ_PACKS } from './questions.js';

const NUMBERS = ['①', '②', '③', '④', '⑤'];

// 手ごたえのある（難しめ）パック。表示名ではなく id で判定する。
const CHALLENGE_PACK_IDS = new Set([
  'kanyouku',
  'onomatope',
  'ruigigo',
  'kotowaza',
  'machigai-nihongo',
  'douongigo',
  'kurashi-suiri',
]);

function createShufflePack({ id, name, description, icon, packs }) {
  return {
    id,
    name,
    description,
    icon,
    isShuffle: true,
    questions: packs.flatMap((pack) =>
      pack.questions.map((question) => ({
        ...question,
        sourcePackName: pack.name,
      }))
    ),
  };
}

const NANDOKU_PACKS = QUIZ_PACKS.filter((pack) => pack.id.startsWith('nandoku-'));

const NANDOKU_SHUFFLE_PACK = createShufflePack({
  id: 'nandoku-shuffle',
  name: '難読まぜこぜ',
  description: `${NANDOKU_PACKS.length}つの難読パックをまぜてランダム出題`,
  icon: 'shuffle',
  packs: NANDOKU_PACKS,
});

const ALL_PACK = createShufflePack({
  id: 'all-shuffle',
  name: 'ぜんぶシャッフル',
  description: `${QUIZ_PACKS.length}のパックをまぜてランダム出題`,
  icon: 'shuffle',
  packs: QUIZ_PACKS,
});

const SHUFFLE_PACKS = [NANDOKU_SHUFFLE_PACK, ALL_PACK];

// 手ごたえあり／ふつう／まぜこぜ の3セクションに分けて表示する
const CHALLENGE_SECTION_PACKS = QUIZ_PACKS.filter((pack) => CHALLENGE_PACK_IDS.has(pack.id));
const NORMAL_SECTION_PACKS = QUIZ_PACKS.filter((pack) => !CHALLENGE_PACK_IDS.has(pack.id));

const PACK_SECTIONS = [
  { key: 'challenge', title: '手ごたえあり', hint: 'ちょっと難しめ。じっくり考えたいときに', packs: CHALLENGE_SECTION_PACKS },
  { key: 'normal', title: 'ふつうのパック', hint: '気楽に楽しめる雑学・ことばクイズ', packs: NORMAL_SECTION_PACKS },
  { key: 'shuffle', title: 'まぜこぜ', hint: 'いろんなパックをまぜて出題', packs: SHUFFLE_PACKS },
];

const PACK_OPTIONS = [...QUIZ_PACKS, ...SHUFFLE_PACKS];

// 問題数モード。'all' はパック在庫ぶん（シャッフル系のみ 30 でキャップ）
const SHUFFLE_ALL_CAP = 30;

// 5問・10問は合意した配分を明示テーブルで持つ（重み計算だと10問チャレンジがズレるため）
const TARGETS = {
  normal: { '5': { 1: 1, 2: 2, 3: 2 }, '10': { 1: 2, 2: 4, 3: 4 } },
  challenge: { '5': { 1: 0, 2: 1, 3: 4 }, '10': { 1: 0, 2: 3, 3: 7 } },
};

// テーブルに無い問題数（シャッフル系の30問など）は、この重みで配って作る
const MODE_WEIGHTS = {
  normal: { 1: 1, 2: 2, 3: 2 },
  challenge: { 1: 0, 2: 1, 3: 4 },
};

// 出題済み判定のキー。シャッフル系は複数パック由来の id が混ざるので出典もキーに含める
function keyOf(q) {
  return q.sourcePackName ? `${q.sourcePackName}:${q.id}` : q.id;
}

const state = {
  selectedPackId: null,
  countKey: '5', // '5' | '10' | 'all'
  mode: 'normal', // 'normal' | 'challenge'
  deck: [],
  index: 0,
  score: 0,
  answered: false,
  answeredCount: 0,
  usedIds: new Set(),
};

const screenTop = document.getElementById('screen-top');
const screenQuiz = document.getElementById('screen-quiz');
const screenEnd = document.getElementById('screen-end');
const packGrid = document.getElementById('packGrid');
const countSegment = document.getElementById('countSegment');
const modeSegment = document.getElementById('modeSegment');
const optionPreview = document.getElementById('optionPreview');
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
const btnFinishEarly = document.getElementById('btnFinishEarly');
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

function countByDifficulty(pack) {
  const counts = { 1: 0, 2: 0, 3: 0 };
  pack.questions.forEach((q) => {
    counts[q.difficulty] = (counts[q.difficulty] ?? 0) + 1;
  });
  return counts;
}

// この設定で実際に出る問題数（在庫・シャッフルキャップを反映）
function effectiveCount(pack, countKey) {
  const total = pack.questions.length;
  if (countKey === '5') return Math.min(5, total);
  if (countKey === '10') return Math.min(10, total);
  // 'all'
  return pack.isShuffle ? Math.min(SHUFFLE_ALL_CAP, total) : total;
}

// 手ごたえ（チャレンジ）が意味を持つか。全問出るなら配分を変えられない
function challengeApplies(pack, countKey) {
  return effectiveCount(pack, countKey) < pack.questions.length;
}

// want 問を難易度の重みで配る（合計が want になるよう largest remainder で調整）
function buildTarget(want, weights) {
  const totalWeight = weights[1] + weights[2] + weights[3];
  if (totalWeight === 0) return { 1: 0, 2: 0, 3: 0 };
  const raw = {
    1: (weights[1] / totalWeight) * want,
    2: (weights[2] / totalWeight) * want,
    3: (weights[3] / totalWeight) * want,
  };
  const target = { 1: Math.floor(raw[1]), 2: Math.floor(raw[2]), 3: Math.floor(raw[3]) };
  let assigned = target[1] + target[2] + target[3];
  // 端数の大きい層から 1 ずつ足して want に合わせる
  const order = [1, 2, 3].sort((a, b) => (raw[b] - target[b]) - (raw[a] - target[a]));
  let i = 0;
  while (assigned < want) {
    target[order[i % 3]] += 1;
    assigned += 1;
    i += 1;
  }
  return target;
}

function resolveTarget(want, countKey, useChallenge) {
  const mode = useChallenge ? 'challenge' : 'normal';
  const explicit = TARGETS[mode][countKey];
  if (explicit) return { ...explicit };
  return buildTarget(want, MODE_WEIGHTS[mode]);
}

function makeDeck() {
  const pack = getSelectedPack();
  if (!pack) return [];

  const want = effectiveCount(pack, state.countKey);
  const useChallenge = state.mode === 'challenge' && challengeApplies(pack, state.countKey);

  // 全問出す（配分を変えられない）ケース：難易度内はシャッフルし、やさしい→むずかしいの流れで返す
  if (want >= pack.questions.length) {
    const byDiff = (d) => shuffle(pack.questions.filter((q) => q.difficulty === d).map((q) => ({ ...q })));
    return [...byDiff(1), ...byDiff(2), ...byDiff(3)];
  }

  const target = resolveTarget(want, state.countKey, useChallenge);
  const fillOrder = useChallenge ? [3, 2, 1] : [1, 2, 3];

  const picked = [];
  const pickedKeys = new Set();
  const countPicked = (d) => picked.filter((q) => q.difficulty === d).length;

  // 1ソース（未出題→既出の順で呼ぶ）から target ＋ fallback で picked を埋める
  function fillFromSource(source) {
    const pools = { 1: [], 2: [], 3: [] };
    [1, 2, 3].forEach((d) => {
      pools[d] = shuffle(source.filter((q) => q.difficulty === d).map((q) => ({ ...q })));
    });
    const take = (d, n) => {
      let taken = 0;
      while (taken < n && pools[d].length) {
        const q = pools[d].shift();
        if (pickedKeys.has(keyOf(q))) continue;
        picked.push(q);
        pickedKeys.add(keyOf(q));
        taken += 1;
      }
    };
    // まず目標配分ぶん、次に足りない分を fillOrder で補充
    [1, 2, 3].forEach((d) => take(d, Math.max(0, target[d] - countPicked(d))));
    for (const d of fillOrder) {
      if (picked.length >= want) break;
      take(d, want - picked.length);
    }
  }

  // 鮮度を難易度配分より優先：まず未出題だけで組み、足りなければ既出を解禁
  fillFromSource(pack.questions.filter((q) => !state.usedIds.has(keyOf(q))));
  if (picked.length < want) {
    fillFromSource(pack.questions.filter((q) => state.usedIds.has(keyOf(q))));
  }

  return shuffle(picked).slice(0, want);
}

/* ── オプション（問題数・手ごたえ）UI ── */
function renderSegments() {
  renderSegmentButtons(countSegment, [
    { value: '5', label: '5問' },
    { value: '10', label: '10問' },
    { value: 'all', label: 'ぜんぶ' },
  ], state.countKey, (value) => {
    state.countKey = value;
    updateOptionState();
  });

  renderSegmentButtons(modeSegment, [
    { value: 'normal', label: 'ふつう' },
    { value: 'challenge', label: 'チャレンジ' },
  ], state.mode, (value) => {
    state.mode = value;
    updateOptionState();
  });
}

function renderSegmentButtons(container, options, selected, onSelect) {
  container.innerHTML = '';
  options.forEach((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qz-segment__btn';
    button.dataset.value = option.value;
    button.textContent = option.label;
    button.setAttribute('aria-pressed', option.value === selected ? 'true' : 'false');
    if (option.value === selected) button.classList.add('is-selected');
    button.addEventListener('click', () => onSelect(option.value));
    container.appendChild(button);
  });
}

// 選択中パック・問題数に応じて、手ごたえの有効/無効とプレビュー文を更新
function updateOptionState() {
  const pack = getSelectedPack();

  // 手ごたえセグメントの有効/無効
  const challengeUsable = pack ? challengeApplies(pack, state.countKey) : true;
  if (!challengeUsable && state.mode === 'challenge') {
    state.mode = 'normal';
  }
  Array.from(modeSegment.children).forEach((btn) => {
    if (btn.dataset.value === 'challenge') {
      btn.disabled = !challengeUsable;
      btn.classList.toggle('is-disabled', !challengeUsable);
    }
    const isSelected = btn.dataset.value === state.mode;
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
  Array.from(countSegment.children).forEach((btn) => {
    // シャッフル系は「ぜんぶ」でも30問なので、誤解を避けてラベルを変える
    if (btn.dataset.value === 'all') {
      btn.textContent = pack && pack.isShuffle ? `${SHUFFLE_ALL_CAP}問` : 'ぜんぶ';
    }
    const isSelected = btn.dataset.value === state.countKey;
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  // プレビュー文
  if (!pack) {
    optionPreview.textContent = 'パックをえらぶと、出る問題数がここに出ます';
  } else {
    const n = effectiveCount(pack, state.countKey);
    const modeLabel = state.mode === 'challenge' ? 'チャレンジ' : 'ふつう';
    let text = `この設定：${n}問・${modeLabel}`;
    if (state.countKey === 'all' && pack.isShuffle && pack.questions.length > SHUFFLE_ALL_CAP) {
      text += `（まぜこぜは${SHUFFLE_ALL_CAP}問までにしています）`;
    } else if (!challengeUsable) {
      text += `（このパックは${n}問すべて出るので「ふつう」で遊びます）`;
    }
    optionPreview.textContent = text;
  }
}

/* ── パック選択 ── */
function renderPackCards() {
  packGrid.innerHTML = '';

  PACK_SECTIONS.forEach((section) => {
    if (!section.packs.length) return;

    const heading = document.createElement('div');
    heading.className = 'qz-pack-section';
    heading.innerHTML = `
      <span class="qz-pack-section__title">${escapeHtml(section.title)}</span>
      <span class="qz-pack-section__hint">${escapeHtml(section.hint)}</span>
    `;
    packGrid.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'qz-pack-grid';
    grid.setAttribute('role', 'list');

    section.packs.forEach((pack) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'qz-pack-card';
      if (section.key === 'challenge') button.classList.add('qz-pack-card--challenge');
      if (pack.id === state.selectedPackId) button.classList.add('is-selected');
      button.setAttribute('role', 'listitem');
      button.setAttribute('aria-pressed', pack.id === state.selectedPackId ? 'true' : 'false');

      const countLabel = `${pack.questions.length}問`;
      const tag = section.key === 'challenge'
        ? '<span class="qz-pack-card__tag">手ごたえあり</span>'
        : '';

      button.innerHTML = `
        <div class="qz-pack-card__top">
          <span class="qz-pack-card__icon material-symbols-rounded">${pack.icon}</span>
          <span class="badge qz-pack-card__count">${countLabel}</span>
        </div>
        <div class="qz-pack-card__title">${escapeHtml(pack.name)}${tag}</div>
        <div class="qz-pack-card__desc">${escapeHtml(pack.description)}</div>
      `;

      button.addEventListener('click', () => {
        // 別のパックに変えたら、鮮度管理をリセット
        if (state.selectedPackId !== pack.id) {
          state.usedIds = new Set();
        }
        state.selectedPackId = pack.id;
        btnStart.disabled = false;
        renderPackCards();
        updateOptionState();
      });

      grid.appendChild(button);
    });

    packGrid.appendChild(grid);
  });
}

function startQuiz() {
  const pack = getSelectedPack();
  if (!pack) return;

  state.deck = makeDeck();
  state.index = 0;
  state.score = 0;
  state.answered = false;
  state.answeredCount = 0;

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

  // 表示した時点で「出題済み」として記録（デッキ作成時ではない）
  state.usedIds.add(keyOf(current));

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

  // 中断ボタンは、1問以上答えたあとだけ押せる
  btnFinishEarly.hidden = state.answeredCount === 0;

  renderChoices(current);
}

function renderChoices(question) {
  choicesArea.innerHTML = '';

  question.choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'qz-choice';
    button.innerHTML = `<span class="qz-choice__num">${NUMBERS[index]}</span><span class="qz-choice__text">${escapeHtml(choice)}</span>`;
    button.addEventListener('click', () => answerQuestion(index));
    choicesArea.appendChild(button);
  });
}

function answerQuestion(choiceIndex) {
  if (state.answered) return;

  const current = state.deck[state.index];
  if (!current) return;

  state.answered = true;
  state.answeredCount += 1;

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
  feedbackAnswer.textContent = `正解: ${NUMBERS[current.answerIndex]} ${current.choices[current.answerIndex]}`;
  feedbackExplanation.textContent = current.explanation;
  feedbackCard.hidden = false;
  btnNext.hidden = false;
  // 最終問題では「結果を見る」(btnNext) と役割が重なるので中断ボタンは隠す
  btnFinishEarly.hidden = state.index >= state.deck.length - 1;

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

function finishEarly() {
  if (state.answeredCount === 0) return;
  finishQuiz();
}

function finishQuiz() {
  const pack = getSelectedPack();
  // 分母は「答えた数」。中断しても未回答を不正解扱いにしない
  const total = state.answeredCount;
  const ratio = total ? state.score / total : 0;

  endPackName.textContent = pack ? pack.name : 'クイズパック';
  endScore.textContent = `${state.score} / ${total}`;
  endMessage.textContent =
    total === 0
      ? 'また気が向いたら、すきなパックをのぞいてみてください。'
      : ratio >= 0.8
        ? 'いい調子。気になった問題があれば、話のたねにしてみよう。'
        : ratio >= 0.5
          ? 'ちょうどいい手ごたえ。「あれ面白かった」を1つ見つけられたら十分です。'
          : '正解の数はおまけ。ひとつでも「へぇ」があればいい時間です。';

  showScreen('end');
  popIn(endScore);
}

function backToTop() {
  // TOPに戻るときは鮮度管理をリセット
  state.usedIds = new Set();
  showScreen('top');
  updateOptionState();
}

/* ── コピー機能 ── */
function formatQuestionText(q) {
  const lines = [`【問題】`, q.question];
  q.choices.forEach((c, i) => lines.push(`${NUMBERS[i]} ${c}`));
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
    `${NUMBERS[q.answerIndex]} ${q.choices[q.answerIndex]}`,
    '',
    `【解説】`,
    q.explanation,
  ];
  copyToClipboard(lines.join('\n'), btnCopyAnswer);
}

btnStart.addEventListener('click', startQuiz);
btnNext.addEventListener('click', goNext);
btnFinishEarly.addEventListener('click', finishEarly);
btnReplay.addEventListener('click', startQuiz);
btnBackTop.addEventListener('click', backToTop);
btnCopyQuestion.addEventListener('click', copyQuestion);
btnCopyAnswer.addEventListener('click', copyAnswer);

renderSegments();
renderPackCards();
updateOptionState();
showScreen('top');
