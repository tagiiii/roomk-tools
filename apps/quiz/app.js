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

/* ── ルームであそぶ（Realtime Database）の設定 ── */
const DB_PREFIX = 'quiz_rooms';
const SESSION_KEY = 'quiz_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const MAX_GUESTS = 10;
const MAX_POINTS = 1000;
const RANKING_SIZE = 5;
const PODIUM_RANK = 3;
// 締め切り直前に押した答えは、通信の遅れぶんを待ってから集計する
const ANSWER_GRACE_MS = 1000;
// 全員が答えたら、少し間をおいて締め切る
const ALL_ANSWERED_DELAY_MS = 800;
const CLOSE_RETRY_MS = 2000;
const PRESENCE_RETRY_MS = 3000;
const DEFAULT_LIMIT_SEC = 30;
const LIMIT_OPTIONS = [
  { value: '20', label: '20秒' },
  { value: '30', label: '30秒' },
  { value: '0', label: 'なし' },
];
const ROOM_STATUS = {
  LOBBY: 'lobby',
  QUESTION: 'question',
  REVEAL: 'reveal',
  FINAL: 'final',
};
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

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

  // ルームであそぶ
  role: null, // 'host' | 'guest'
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null, // 最後に受け取ったルームのデータ
  currentScreen: 'top',
  limitSec: DEFAULT_LIMIT_SEC,
  timerInterval: null,
  orphanTimer: null,
  closeTimer: null,
  closeTimerKey: null,
  closeTimerReason: null, // 'all' | 'manual'
  closeRetryAt: 0,
  closing: false,
  connectedRef: null,
  connectedCallback: null,
  roomCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  renderedKey: null,
  timeUpKey: null,
  sentAnswerKey: null, // 自分が答えを送った問題（締め切りと重なったときの表示に使う）
  answering: false,
  leaving: false,
  busy: false,
};

const packGrid = document.getElementById('packGrid');
const countSegment = document.getElementById('countSegment');
const modeSegment = document.getElementById('modeSegment');
const optionPreview = document.getElementById('optionPreview');
const optionsPanel = document.getElementById('optionsPanel');
const startHint = document.getElementById('startHint');
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

// ルームであそぶ
const $ = (id) => document.getElementById(id);
const packPicker = $('packPicker');
const packPickerHome = $('packPickerHome');
const roomPackSlot = $('roomPackSlot');
const limitRow = $('limitRow');
const limitSegment = $('limitSegment');
const limitPreview = $('limitPreview');
const roomBar = $('roomBar');
const roomCodeLabel = $('roomCodeLabel');
const btnLeave = $('btnLeave');
const btnGoCreate = $('btnGoCreate');
const btnGoJoin = $('btnGoJoin');
const btnCreateRoom = $('btnCreateRoom');
const btnJoinRoom = $('btnJoinRoom');
const hostNameInput = $('hostName');
const guestNameInput = $('guestName');
const joinCodeInput = $('joinCode');
const lobbyCode = $('lobbyCode');
const lobbyLead = $('lobbyLead');
const lobbyCount = $('lobbyCount');
const lobbyPlayers = $('lobbyPlayers');
const lobbyEmpty = $('lobbyEmpty');
const hostLobbyTools = $('hostLobbyTools');
const roomStartHint = $('roomStartHint');
const btnRoomStart = $('btnRoomStart');
const playPackName = $('playPackName');
const playProgress = $('playProgress');
const playTimer = $('playTimer');
const playTimerText = $('playTimerText');
const playQuestion = $('playQuestion');
const playChoices = $('playChoices');
const playStatus = $('playStatus');
const hostPlayTools = $('hostPlayTools');
const btnCloseAnswers = $('btnCloseAnswers');
const hostCopyTools = $('hostCopyTools');
const btnRoomCopyQuestion = $('btnRoomCopyQuestion');
const hostRevealCopy = $('hostRevealCopy');
const btnRoomCopyAnswer = $('btnRoomCopyAnswer');
const revealPackName = $('revealPackName');
const revealProgress = $('revealProgress');
const revealQuestion = $('revealQuestion');
const revealChoices = $('revealChoices');
const revealFeedback = $('revealFeedback');
const revealResult = $('revealResult');
const revealRank = $('revealRank');
const revealAnswer = $('revealAnswer');
const revealExplanation = $('revealExplanation');
const revealRankingPanel = $('revealRankingPanel');
const revealRanking = $('revealRanking');
const hostRevealTools = $('hostRevealTools');
const btnNextQuestion = $('btnNextQuestion');
const btnFinishGame = $('btnFinishGame');
const guestRevealWait = $('guestRevealWait');
const finalPackName = $('finalPackName');
const finalPodium = $('finalPodium');
const finalEmpty = $('finalEmpty');
const finalMe = $('finalMe');
const finalMeRank = $('finalMeRank');
const finalMeDetail = $('finalMeDetail');
const hostFinalTools = $('hostFinalTools');
const btnRoomReplay = $('btnRoomReplay');
const guestFinalWait = $('guestFinalWait');
const hostOffOverlay = $('hostOffOverlay');
const hostOffBanner = $('hostOffBanner');

const SCREEN_IDS = ['top', 'quiz', 'end', 'create', 'join', 'lobby', 'play', 'reveal', 'final'];
const screens = Object.fromEntries(SCREEN_IDS.map((id) => [id, $('screen-' + id)]));

function showScreen(id) {
  const changed = state.currentScreen !== id;
  SCREEN_IDS.forEach((name) => {
    screens[name].hidden = name !== id;
  });
  state.currentScreen = id;
  roomBar.hidden = !state.roomRef;
  // ルームでは画面が自動で切り替わるので、切り替わったら先頭から見せる
  if (changed && state.roomRef) window.scrollTo(0, 0);
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

/* ── オプション（問題数・手ごたえ・制限時間）UI ── */
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

  // 制限時間はルームを作ったホストだけが使う（ルームの待機画面で表示）
  renderSegmentButtons(limitSegment, LIMIT_OPTIONS, String(state.limitSec), (value) => {
    state.limitSec = Number(value);
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
  const inRoom = !limitRow.hidden;

  startHint.hidden = Boolean(pack);

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
  Array.from(limitSegment.children).forEach((btn) => {
    const isSelected = btn.dataset.value === String(state.limitSec);
    btn.classList.toggle('is-selected', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });

  // プレビュー文
  if (!pack) {
    optionPreview.textContent = 'パックをえらぶと、出る問題数がここに出ます';
  } else {
    const n = effectiveCount(pack, state.countKey);
    const modeLabel = state.mode === 'challenge' ? 'チャレンジ' : 'ふつう';
    const limitLabel = !inRoom ? '' : state.limitSec > 0 ? `・${state.limitSec}秒` : '・時間制限なし';
    let text = `この設定：${n}問・${modeLabel}${limitLabel}`;
    if (state.countKey === 'all' && pack.isShuffle && pack.questions.length > SHUFFLE_ALL_CAP) {
      text += `（まぜこぜは${SHUFFLE_ALL_CAP}問までにしています）`;
    } else if (!challengeUsable) {
      text += `（このパックは${n}問すべて出るので「ふつう」で遊びます）`;
    }
    optionPreview.textContent = text;
  }
  limitPreview.textContent = state.limitSec > 0
    ? `早く正解するほど点が高くなります（1問${MAX_POINTS}点まで）。全員が答えたら、その時点で締め切ります。`
    : `時間で締め切りません。全員が答えるか、ホストが締め切ったら正解を出します。正解は${MAX_POINTS}点です。`;

  updateRoomStartState();
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
        // 初めての選択のときだけ、問題数・手ごたえ・スタートまでスクロールして誘導する
        const isFirstSelection = btnStart.disabled;

        // 別のパックに変えたら、鮮度管理をリセット
        if (state.selectedPackId !== pack.id) {
          state.usedIds = new Set();
        }
        state.selectedPackId = pack.id;
        btnStart.disabled = false;
        renderPackCards();
        updateOptionState();

        if (isFirstSelection) {
          optionsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });

      grid.appendChild(button);
    });

    packGrid.appendChild(grid);
  });
}

function startQuiz() {
  const pack = getSelectedPack();
  if (!pack) return;

  window.RoomkStats?.count('pack-' + pack.id);
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
  // トップへ戻るときは鮮度管理をリセット
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

function formatAnswerText(q) {
  const lines = [
    formatQuestionText(q),
    '',
    `【正解】`,
    `${NUMBERS[q.answerIndex]} ${q.choices[q.answerIndex]}`,
    '',
    `【解説】`,
    q.explanation,
  ];
  return lines.join('\n');
}

function copyAnswer() {
  const q = state.deck[state.index];
  if (!q) return;
  copyToClipboard(formatAnswerText(q), btnCopyAnswer);
}

/* ── ルームであそぶ：接続まわり ── */
let firebaseHandles = null;

// Firebase はルームに入るときだけ初期化する（ひとつの画面で遊ぶときは通信しない）
function ensureFirebase() {
  if (firebaseHandles) return firebaseHandles;
  try {
    firebaseHandles = RoomkRTDB.initFirebase(firebase);
  } catch (error) {
    console.warn('[quiz] firebase init failed', error);
    return null;
  }
  return firebaseHandles;
}

function db() {
  return firebaseHandles.db;
}

function currentUid() {
  return firebase.auth().currentUser?.uid || null;
}

function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

async function waitAuth() {
  const handles = ensureFirebase();
  if (!handles) {
    toast('接続できませんでした。ページを読み直してね');
    return false;
  }
  try {
    await handles.authReady;
    return true;
  } catch {
    toast('接続できませんでした。ページを読み直してね');
    return false;
  }
}

function toast(message, isError = true) {
  window.RoomkRTDB?.showToast(message, isError);
}

function setError(id, message) {
  const node = $(id);
  node.textContent = message || '';
  node.hidden = !message;
}

function validNickname(value) {
  if (!value) return '名前を入れてね';
  if (value.length > 8) return '名前は8文字までだよ';
  if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '名前に使えない文字があるよ';
  return '';
}

function readSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function writeSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      role: state.role,
      nickname: state.nickname,
      roomCode: state.roomCode,
      uid: currentUid(),
    }));
  } catch {
    // 保存できないときは、再読み込みで戻れないだけ
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 何もしない
  }
}

function guestNames(data) {
  return Object.entries(data?.players || {})
    .filter(([, player]) => !player?.isHost)
    .sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0) || a[0].localeCompare(b[0], 'ja'))
    .map(([name]) => name);
}

function isExpired(data) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(data, ORPHAN_TTL_MS) || (!!data && !data.status);
}

async function removeExpired(ref, fallback) {
  try {
    await ref.transaction((data) => {
      const current = data || fallback;
      return current && isExpired(current) ? null : undefined;
    });
  } catch (error) {
    console.warn('[quiz] expired room cleanup failed', error);
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

function answerKey(game) {
  return 'g' + game.id + 'q' + game.index;
}

function currentQuestion(data) {
  const game = data?.game;
  return game?.questions?.[game.index] || null;
}

function deadlineOf(game) {
  const limitSec = Number(game?.limitSec) || 0;
  const startedAt = Number(game?.startedAt);
  if (!limitSec || !Number.isFinite(startedAt)) return null;
  return startedAt + limitSec * 1000;
}

// 答えを出せる最初の問題番号（途中参加の人は参加した問題から）
function joinedFrom(member) {
  return Number(member?.fromIndex) || 0;
}

// その名前で今参加している人（匿名IDが一致する人）の答えだけを返す。
// 退出した人と同じ名前で別の人が入っても、前の人の答えを引き継がない
function answerOf(data, key, name) {
  const answer = data?.answers?.[key]?.[name];
  const member = data?.scores?.[name];
  return answer && answer.choice != null && member && answer.uid === member.uid ? answer : null;
}

// 答えの受付枠（1人に1つ）。出題と同じ transaction で作り、締め切りで閉じる。
// 人ごとに別のノードなので、同時に押しても互いに待たされない。
// 枠には持ち主の匿名IDを入れ、持ち主の答えだけを受け付ける
function openSlots(owners) {
  return Object.fromEntries(Object.entries(owners).map(([name, uid]) => [name, { open: true, uid }]));
}

// その問題に答えられる人と匿名ID（点数に参加していて、その問題から参加している人。切断中の人も含む）
function membersFor(data, index) {
  return Object.fromEntries(Object.entries(data.scores || {})
    .filter(([, member]) => joinedFrom(member) <= index)
    .map(([name, member]) => [name, member.uid]));
}

// 正解の点数。制限時間ありは、はやいほど高い（締め切りちょうどで半分）
function pointsFor(elapsedMs, limitSec) {
  if (!limitSec) return MAX_POINTS;
  const limitMs = limitSec * 1000;
  const clamped = Math.min(Math.max(elapsedMs, 0), limitMs);
  return Math.round(MAX_POINTS * (1 - clamped / limitMs / 2));
}

function formatPoints(points) {
  return `${points.toLocaleString('ja-JP')}点`;
}

// 同点は同じ順位にする
function rankedScores(data) {
  const entries = Object.entries(data?.scores || {}).map(([name, score]) => ({
    name,
    points: Number(score?.points) || 0,
    correct: Number(score?.correct) || 0,
  }));
  entries.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'ja'));
  entries.forEach((entry) => {
    entry.rank = 1 + entries.filter((other) => other.points > entry.points).length;
  });
  return entries;
}

// 参加者を追加する。ゲームの途中なら、今の問題（正解発表中なら次の問題）から得点に参加する。
// 最後の問題の正解発表中・結果発表中に入った人は、次のゲームから
function addMember(data, nickname, uid) {
  const next = {
    ...data,
    players: {
      ...(data.players || {}),
      [nickname]: { isHost: false, uid, joinedAt: RoomkRTDB.now() },
    },
  };
  const game = data.game;
  const fromIndex = data.status === ROOM_STATUS.QUESTION ? game?.index : (game?.index ?? 0) + 1;
  const playing = data.status === ROOM_STATUS.QUESTION
    || (data.status === ROOM_STATUS.REVEAL && fromIndex < (Number(game?.total) || 0));
  if (game && playing && !data.scores?.[nickname]) {
    next.scores = {
      ...(data.scores || {}),
      [nickname]: { points: 0, correct: 0, uid, fromIndex },
    };
  }
  // 問題の途中なら、この問題の受付枠も作る（参加と同じ transaction で）。
  // 同じ名前で退出した別の人の枠が残っていたら、新しい持ち主の空の枠に差し替える
  const owner = next.scores?.[nickname]?.uid;
  if (game && data.status === ROOM_STATUS.QUESTION && owner) {
    const key = answerKey(game);
    const slot = data.answers?.[key]?.[nickname];
    if (!slot || slot.uid !== owner) {
      next.answers = {
        ...(data.answers || {}),
        [key]: { ...(data.answers?.[key] || {}), [nickname]: { open: true, uid: owner } },
      };
    }
  }
  return next;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function setButtonLabel(button, icon, label) {
  button.replaceChildren(el('span', 'material-symbols-rounded', icon), document.createTextNode(label));
}

// パック選択（問題数・手ごたえ）はトップとルームの待機画面で同じものを使う
function placePicker(inRoom) {
  const target = inRoom ? roomPackSlot : packPickerHome;
  const moved = packPicker.parentElement !== target || limitRow.hidden === inRoom;
  limitRow.hidden = !inRoom;
  limitPreview.hidden = !inRoom;
  if (packPicker.parentElement !== target) target.appendChild(packPicker);
  if (moved) updateOptionState();
}

function openRoomForm(id) {
  ensureFirebase(); // 先に匿名ログインを始めておく
  setError(id === 'create' ? 'createError' : 'joinError', '');
  showScreen(id);
}

async function createRoom() {
  if (state.busy || state.roomRef) return;
  const nickname = hostNameInput.value.trim();
  const error = validNickname(nickname);
  if (error) {
    setError('createError', error);
    return;
  }
  setError('createError', '');
  // 認証待ちの間の二度押しでルームが2つできないよう、待つ前にロックする
  state.busy = true;
  btnCreateRoom.disabled = true;
  try {
    if (!await waitAuth()) return;
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = RoomkRTDB.generateRoomCode();
      const ref = db().ref(DB_PREFIX + '/' + code);
      const result = await ref.transaction((data) => {
        if (data) return;
        return {
          status: ROOM_STATUS.LOBBY,
          host: nickname,
          hostUid: uid,
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          gameSeq: 0,
          players: {
            [nickname]: { isHost: true, uid, joinedAt },
          },
        };
      });
      if (result.committed) {
        connectToRoom('host', nickname, code, ref);
        return;
      }
    }
    setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
  } catch (err) {
    console.warn('[quiz] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    state.busy = false;
    btnCreateRoom.disabled = false;
  }
}

async function joinRoom() {
  if (state.busy || state.roomRef) return;
  const nickname = guestNameInput.value.trim();
  const code = joinCodeInput.value.trim().toUpperCase();
  const error = validNickname(nickname);
  if (error) {
    setError('joinError', error);
    return;
  }
  if (!ROOM_CODE_PATTERN.test(code)) {
    setError('joinError', 'ルームコードは6文字で入れてね');
    return;
  }
  setError('joinError', '');
  state.busy = true;
  btnJoinRoom.disabled = true;
  let release = null;
  try {
    if (!await waitAuth()) return;
    const ref = db().ref(DB_PREFIX + '/' + code);
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
    let reason = '';
    const result = await ref.transaction((data) => {
      reason = '';
      if (!data) { reason = '見つからない'; return; }
      if (isExpired(data)) { reason = '終了'; return; }
      if (nickname === data.host || data.players?.[nickname]) { reason = '名前'; return; }
      // ゲームの途中で抜けた人の名前は、同じ端末からだけ使える
      const member = data.scores?.[nickname];
      if (member && member.uid !== uid) { reason = '名前'; return; }
      if (guestNames(data).length >= MAX_GUESTS) { reason = '満員'; return; }
      return addMember(data, nickname, uid);
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
    connectToRoom('guest', nickname, code, ref);
  } catch (err) {
    console.warn('[quiz] join failed', err);
    setError('joinError', '接続できませんでした。もう一度ためしてね');
  } finally {
    release?.();
    state.busy = false;
    btnJoinRoom.disabled = false;
  }
}

function connectToRoom(role, nickname, code, ref) {
  // 念のため、前のルームの購読・タイマーが残っていたら片付けてからつなぐ
  if (state.roomRef) cleanupRoom();
  state.role = role;
  state.nickname = nickname;
  state.roomCode = code;
  state.roomRef = ref;
  roomCodeLabel.textContent = code;
  btnLeave.textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  writeSession();
  if (role === 'host') placePicker(true);

  state.roomCallback = (snap) => {
    // 自分で退出・ルームを閉じている途中の変化は、退出処理の側で片付ける
    if (state.roomRef !== ref || state.leaving) return;
    if (!snap.exists()) {
      leaveLocally('ルームが閉じられたよ', false);
      return;
    }
    const data = snap.val();
    if (isExpired(data)) {
      removeExpired(ref, data);
      leaveLocally('このルームは終わったみたい');
      return;
    }
    state.room = data;
    handleRoom(data);
  };
  ref.on('value', state.roomCallback, (error) => {
    console.warn('[quiz] room listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });

  state.connectedRef = db().ref('.info/connected');
  state.connectedCallback = (snap) => {
    state.isConnected = snap.val() === true;
    if (state.isConnected && state.roomRef === ref) {
      state.presenceDirty = true;
      ensurePresence(true);
    }
  };
  state.connectedRef.on('value', state.connectedCallback);
  state.timerInterval = setInterval(tickRoom, 250);
}

function tickRoom() {
  updateTimer();
  if (state.room && needsPresence(state.room)) ensurePresence();
}

// 接続中なのに、ルームの上では切断・不在になっている
function needsPresence(data) {
  if (state.role === 'host') return data.hostConnected === false;
  if (state.role === 'guest') return !data.players?.[state.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
// 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
async function ensurePresence(force = false) {
  const ref = state.roomRef;
  if (!ref || state.leaving || !state.isConnected || !state.room) return;
  if (!force && Date.now() - state.presenceAt < PRESENCE_RETRY_MS) return;
  state.presenceDirty = false;
  state.presenceAt = Date.now();
  const role = state.role;
  const nickname = state.nickname;
  const uid = currentUid();
  try {
    if (role === 'host') {
      await ref.onDisconnect().update({
        hostConnected: false,
        hostDisconnectedAt: serverTimestamp(),
      });
      await ref.transaction((data) => {
        if (!data || data.hostUid !== uid || isExpired(data)) return;
        if (data.hostConnected === true && data.hostDisconnectedAt == null) return;
        return { ...data, hostConnected: true, hostDisconnectedAt: null };
      });
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      await ref.transaction((data) => {
        if (!data || isExpired(data) || data.players?.[nickname]) return;
        const member = data.scores?.[nickname];
        if (member && member.uid !== uid) return;
        return addMember(data, nickname, uid);
      });
    }
  } catch (error) {
    console.warn('[quiz] presence recovery failed', error);
    // 定期的な確認の失敗は通知しない（接続し直したときだけ知らせる）
    if (force) toast('再接続に失敗しました。ページを読み直してね');
  }
}

async function tryReconnect() {
  const saved = readSession();
  if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
  if (!ROOM_CODE_PATTERN.test(saved.roomCode) || validNickname(saved.nickname)) return false;
  if (state.busy || state.roomRef) return false;
  // 復帰の途中で「ルームを作る／参加する」が重ならないようにする（押せないことが分かるよう無効にする）
  state.busy = true;
  btnGoCreate.disabled = true;
  btnGoJoin.disabled = true;
  let release = null;
  try {
    if (!await waitAuth()) return false;
    const uid = currentUid();
    if (!uid || uid !== saved.uid) return false;
    const ref = db().ref(DB_PREFIX + '/' + saved.roomCode);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const data = warm.snap.val();
    if (!data) return false;
    if (isExpired(data)) {
      await removeExpired(ref, data);
      return false;
    }
    if (saved.role === 'host') {
      if (data.host !== saved.nickname || data.hostUid !== uid) return false;
      restoreSetup(data.setup);
      // 今のゲームで出した問題は、「もう一度あそぶ」で避けられるよう出題済みに戻す
      const game = data.game;
      (game?.questions || []).slice(0, (Number(game?.index) || 0) + 1)
        .forEach((question) => state.usedIds.add(keyOf(question)));
    } else if (saved.role === 'guest') {
      if (saved.nickname === data.host) return false;
      const player = data.players?.[saved.nickname];
      if (player && (player.isHost || player.uid !== uid)) return false;
      const member = data.scores?.[saved.nickname];
      if (member && member.uid !== uid) return false;
    } else {
      return false;
    }
    if (state.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref);
    return true;
  } catch (error) {
    console.warn('[quiz] reconnect failed', error);
    return false;
  } finally {
    release?.();
    state.busy = false;
    btnGoCreate.disabled = false;
    btnGoJoin.disabled = false;
  }
}

// ホストが再読み込みしたとき、前のゲームの設定を選択状態に戻す
function restoreSetup(setup) {
  if (!setup) return;
  if (PACK_OPTIONS.some((pack) => pack.id === setup.packId)) {
    state.selectedPackId = setup.packId;
    btnStart.disabled = false;
  }
  if (['5', '10', 'all'].includes(setup.countKey)) state.countKey = setup.countKey;
  if (['normal', 'challenge'].includes(setup.mode)) state.mode = setup.mode;
  if (LIMIT_OPTIONS.some((option) => Number(option.value) === Number(setup.limitSec))) {
    state.limitSec = Number(setup.limitSec);
  }
  renderPackCards();
  updateOptionState();
}

function cleanupRoom() {
  clearInterval(state.timerInterval);
  clearTimeout(state.orphanTimer);
  clearCloseTimer();
  state.timerInterval = null;
  state.orphanTimer = null;
  if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
  if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
  if (state.roomRef) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
  state.role = null;
  state.nickname = null;
  state.roomCode = null;
  state.roomRef = null;
  state.room = null;
  state.connectedRef = null;
  state.connectedCallback = null;
  state.roomCallback = null;
  state.isConnected = false;
  state.presenceDirty = false;
  state.presenceAt = 0;
  state.renderedKey = null;
  state.timeUpKey = null;
  state.sentAnswerKey = null;
  state.closeRetryAt = 0;
  state.closing = false;
  state.answering = false;
  state.leaving = false;
  // トップへ戻るときは、ひとつの画面モードと同じく出題済みの記録をリセットする
  state.usedIds = new Set();
  clearSession();
  hostOffOverlay.hidden = true;
  hostOffBanner.hidden = true;
  roomBar.hidden = true;
  placePicker(false);
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('top');
  if (message) toast(message, isError);
}

async function leaveRoom() {
  if (state.busy || !state.roomRef) return;
  const ref = state.roomRef;
  const role = state.role;
  const nickname = state.nickname;
  if (role === 'host' && !window.confirm('ルームを閉じると、参加者の画面もトップに戻ります。閉じますか？')) return;
  state.busy = true;
  state.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      await ref.transaction((data) => {
        if (!data) return;
        const next = { ...data, players: { ...(data.players || {}) }, scores: { ...(data.scores || {}) } };
        delete next.players[nickname];
        delete next.scores[nickname];
        return next;
      });
    }
  } catch (error) {
    console.warn('[quiz] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    state.leaving = false;
    state.busy = false;
    // 退出の前に取り消した切断予約を張り直す
    ensurePresence(true);
    if (state.room) handleRoom(state.room);
    return;
  }
  state.busy = false;
  leaveLocally('');
}

/* ── ルームであそぶ：画面の更新 ── */
function handleRoom(data) {
  if (state.role === 'guest') {
    const me = data.players?.[state.nickname];
    if (me && me.uid !== currentUid()) {
      leaveLocally('同じ名前の人が参加したので、ルームから外れました');
      return;
    }
  }
  if (state.presenceDirty) ensurePresence(true);
  else if (needsPresence(data)) ensurePresence();
  updateHostOverlay(data);
  if (data.status !== ROOM_STATUS.QUESTION) clearCloseTimer();

  switch (data.status) {
    case ROOM_STATUS.LOBBY: renderLobby(data); break;
    case ROOM_STATUS.QUESTION: renderPlay(data); break;
    case ROOM_STATUS.REVEAL: renderReveal(data); break;
    case ROOM_STATUS.FINAL: renderFinal(data); break;
    default: renderLobby(data);
  }
}

function updateHostOverlay(data) {
  if (state.role === 'guest' && data.hostConnected === false) {
    // 問題中は答えを送れるので、画面をふさがない帯で知らせる
    const answering = data.status === ROOM_STATUS.QUESTION;
    hostOffOverlay.hidden = answering;
    hostOffBanner.hidden = !answering;
    if (!state.orphanTimer) {
      const ref = state.roomRef;
      const at = RoomkRTDB.getHostDisconnectedAt(data);
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
      state.orphanTimer = setTimeout(() => {
        state.orphanTimer = null;
        if (state.roomRef === ref && state.room) removeExpired(ref, state.room);
      }, delay);
    }
  } else {
    hostOffOverlay.hidden = true;
    hostOffBanner.hidden = true;
    clearTimeout(state.orphanTimer);
    state.orphanTimer = null;
  }
}

function renderPeople(list, names) {
  list.replaceChildren();
  names.forEach((name) => {
    const mine = state.role === 'guest' && name === state.nickname;
    list.append(el('li', 'qz-people__item' + (mine ? ' is-me' : ''), name));
  });
}

function renderLobby(data) {
  showScreen('lobby');
  const isHost = state.role === 'host';
  const names = guestNames(data);
  state.renderedKey = null;
  lobbyCode.textContent = state.roomCode;
  lobbyLead.textContent = isHost
    ? '参加する人は「ルームに参加する」を押して、このコードを入れてね。'
    : 'ホストが問題をえらんでいます。はじまるまで待ってね。';
  lobbyCount.textContent = `${names.length}人`;
  renderPeople(lobbyPlayers, names);
  lobbyEmpty.hidden = names.length > 0;
  hostLobbyTools.hidden = !isHost;
  if (isHost) {
    placePicker(true);
    updateRoomStartState();
  }
}

function updateRoomStartState() {
  if (state.role !== 'host' || !state.room) return;
  const pack = getSelectedPack();
  const guests = guestNames(state.room).length;
  btnRoomStart.disabled = state.room.status !== ROOM_STATUS.LOBBY || !pack || guests === 0;
  btnRoomReplay.disabled = state.room.status !== ROOM_STATUS.FINAL || !pack || guests === 0;
  roomStartHint.textContent = !pack
    ? 'パックをえらぶと、スタートを押せます'
    : guests === 0
      ? '参加者が1人以上になると、スタートを押せます'
      : '';
  roomStartHint.hidden = !roomStartHint.textContent;
}

// 今の問題に答える人（接続中で、この問題から参加している人）
function answerableGuests(data, game) {
  return guestNames(data).filter((name) => {
    const member = data.scores?.[name];
    return member && joinedFrom(member) <= game.index;
  });
}

function renderPlay(data) {
  const game = data.game;
  const question = currentQuestion(data);
  if (!game || !question) return;
  showScreen('play');
  const isHost = state.role === 'host';
  const key = answerKey(game);
  playPackName.textContent = game.packName || 'クイズパック';
  playProgress.textContent = `Q${game.index + 1} / ${game.total}`;
  hostPlayTools.hidden = !isHost;
  hostCopyTools.hidden = !isHost;

  if (state.renderedKey !== key) {
    state.renderedKey = key;
    state.timeUpKey = null;
    playQuestion.textContent = question.question;
    renderPlayChoices(question, key, isHost);
    // 出題済みとして記録し、「もう一度あそぶ」で同じ問題を避ける
    if (isHost) state.usedIds.add(keyOf(question));
    popIn(playQuestion.parentElement);
  }

  if (isHost) {
    const expected = answerableGuests(data, game);
    const done = expected.filter((name) => answerOf(data, key, name)).length;
    playStatus.textContent = `回答 ${done} / ${expected.length}人`;
    if (expected.length && done >= expected.length) {
      scheduleClose(game, ALL_ANSWERED_DELAY_MS, 'all');
    } else if (state.closeTimerKey === key && state.closeTimerReason === 'all') {
      // 締め切りを待つ間に答える人が増えたら、全員の回答を待ち直す
      clearCloseTimer();
    }
    btnCloseAnswers.disabled = state.closeTimerKey === key && state.closeTimerReason === 'manual';
  } else {
    updateGuestChoices(data, game, answerOf(data, key, state.nickname));
  }
  updateTimer();
}

function renderPlayChoices(question, key, isHost) {
  playChoices.replaceChildren();
  question.choices.forEach((choice, index) => {
    // ホストの画面は画面共有用。押せない表示にする
    const node = el(isHost ? 'div' : 'button', isHost ? 'qz-choice qz-choice--static' : 'qz-choice');
    if (!isHost) {
      node.type = 'button';
      node.addEventListener('click', () => submitAnswer(key, index));
    }
    node.append(el('span', 'qz-choice__num', NUMBERS[index]), el('span', 'qz-choice__text', choice));
    playChoices.append(node);
  });
}

function updateGuestChoices(data, game, myAnswer) {
  const member = data.scores?.[state.nickname];
  const deadline = deadlineOf(game);
  const timeUp = deadline != null && RoomkRTDB.now() >= deadline;
  const eligible = Boolean(member) && joinedFrom(member) <= game.index;
  const picked = myAnswer ? Number(myAnswer.choice) : null;
  const locked = !eligible || picked != null || timeUp || state.answering;
  Array.from(playChoices.children).forEach((button, index) => {
    button.disabled = locked;
    button.classList.toggle('qz-choice--picked', picked === index);
    button.classList.toggle('qz-choice--muted', picked != null && picked !== index);
    button.setAttribute('aria-pressed', picked === index ? 'true' : 'false');
  });
  // ホストの切断中の帯は、まだ答えられるときだけ「そのまま押せる」と伝える
  hostOffBanner.textContent = locked
    ? 'ホストの戻りを待っています。'
    : 'ホストの戻りを待っています。答えはそのまま押せるよ。';
  playStatus.textContent = !eligible
    ? '次の問題から参加できるよ'
    : picked != null
      ? '回答しました。みんなを待っています'
      : timeUp
        ? '時間切れ！正解の発表を待ってね'
        : '';
}

async function submitAnswer(key, choice) {
  const data = state.room;
  const game = data?.game;
  if (state.role !== 'guest' || !state.roomRef || state.answering) return;
  if (!data || data.status !== ROOM_STATUS.QUESTION || !game || answerKey(game) !== key) return;
  const member = data.scores?.[state.nickname];
  if (!member || joinedFrom(member) > game.index) return;
  if (answerOf(data, key, state.nickname)) return;
  const deadline = deadlineOf(game);
  if (deadline != null && RoomkRTDB.now() >= deadline) {
    renderPlay(data);
    return;
  }
  const nickname = state.nickname;
  const uid = currentUid();
  state.answering = true;
  // 送る前に記録しておく（締め切りと重なって取り消されたときも「間に合わなかった」と出せるように）
  state.sentAnswerKey = key;
  renderPlay(data);
  try {
    // 自分の受付枠が開いていて、まだ答えていないときだけ書く。締め切り後や、ルームが消えた後、
    // 同じ名前の別の人に枠が移った後に遅れて届いた答えでは書かない
    await state.roomRef.child(`answers/${key}/${nickname}`).transaction((current) => {
      if (!current || current.open !== true || current.uid !== uid || current.choice != null) return;
      return { ...current, choice, at: serverTimestamp() };
    });
  } catch (error) {
    console.warn('[quiz] answer failed', error);
    if (state.sentAnswerKey === key) state.sentAnswerKey = null;
    toast('答えを送れませんでした。もう一度押してね');
  } finally {
    state.answering = false;
    if (state.room?.status === ROOM_STATUS.QUESTION) renderPlay(state.room);
    else if (state.room?.status === ROOM_STATUS.REVEAL) renderReveal(state.room);
  }
}

function updateTimer() {
  const data = state.room;
  if (!data || data.status !== ROOM_STATUS.QUESTION || !data.game) return;
  const game = data.game;
  const deadline = deadlineOf(game);
  if (deadline == null) {
    playTimerText.textContent = '時間制限なし';
    playTimer.classList.remove('is-urgent');
    return;
  }
  const left = deadline - RoomkRTDB.now();
  playTimerText.textContent = left > 0 ? `のこり ${Math.ceil(left / 1000)}秒` : '時間切れ';
  playTimer.classList.toggle('is-urgent', left > 0 && left <= 5000);
  const key = answerKey(game);
  if (left <= 0 && state.timeUpKey !== key) {
    state.timeUpKey = key;
    if (state.role === 'guest') renderPlay(data);
  }
  if (state.role === 'host' && left <= -ANSWER_GRACE_MS && Date.now() >= state.closeRetryAt) {
    closeQuestion(game.id, game.index, 'timeout');
  }
}

function clearCloseTimer() {
  clearTimeout(state.closeTimer);
  state.closeTimer = null;
  state.closeTimerKey = null;
  state.closeTimerReason = null;
}

// 締め切りを少し待ってから実行する。reason は 'all'（全員が回答）か 'manual'（ホストが締め切る）
function scheduleClose(game, delay, reason) {
  const key = answerKey(game);
  // ホストが押した締め切りは、全員回答による予約より優先して残す
  if (state.closeTimerKey === key && (state.closeTimerReason === reason || state.closeTimerReason === 'manual')) return;
  clearCloseTimer();
  state.closeTimerKey = key;
  state.closeTimerReason = reason;
  const { id, index } = game;
  state.closeTimer = setTimeout(() => {
    state.closeTimer = null;
    state.closeTimerKey = null;
    state.closeTimerReason = null;
    closeQuestion(id, index, reason);
  }, delay);
}

// 答えられる人が全員答えたか（締め切りの transaction の中でも確かめ直す）
function allAnswered(data, game) {
  const key = answerKey(game);
  const expected = answerableGuests(data, game);
  return expected.length > 0 && expected.every((name) => answerOf(data, key, name));
}

// 締め切り：答えの受付を閉じ、有効な答えだけを数えて、点数と答えの分布を確定する
function revealRoom(data, game, question, reason) {
  const key = answerKey(game);
  const slots = data.answers?.[key] || {};
  const deadline = deadlineOf(game);
  const acceptUntil = deadline == null ? Infinity : deadline + ANSWER_GRACE_MS;
  const startedAt = Number(game.startedAt) || 0;
  const limitSec = Number(game.limitSec) || 0;
  const counts = question.choices.map(() => 0);
  const picks = {};
  const gains = {};
  const scores = { ...(data.scores || {}) };
  let answered = 0;
  Object.keys(slots).forEach((name) => {
    const member = scores[name];
    const answer = answerOf(data, key, name);
    const choice = Number(answer?.choice);
    const at = Number(answer?.at);
    if (!member || !answer || joinedFrom(member) > game.index) return;
    if (!Number.isInteger(choice) || choice < 0 || choice >= counts.length) return;
    if (!Number.isFinite(at) || at > acceptUntil) return;
    counts[choice] += 1;
    picks[name] = choice;
    answered += 1;
    if (choice === question.answerIndex) {
      const gain = pointsFor(at - startedAt, limitSec);
      gains[name] = gain;
      scores[name] = {
        ...member,
        points: (Number(member.points) || 0) + gain,
        correct: (Number(member.correct) || 0) + 1,
      };
    }
  });
  // 締め切り後に確定したか（手動で締めても、時間を過ぎていれば「時間切れ」と伝える）
  const timedOut = deadline != null && RoomkRTDB.now() >= deadline;
  const closedSlots = Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, { ...slot, open: false }]));
  return {
    ...data,
    status: ROOM_STATUS.REVEAL,
    scores,
    answers: { ...(data.answers || {}), [key]: closedSlots },
    results: { ...(data.results || {}), [key]: { counts, picks, gains, answered, reason, timedOut } },
  };
}

async function closeQuestion(gameId, index, reason) {
  if (state.role !== 'host' || !state.roomRef || state.closing) return;
  state.closing = true;
  const uid = currentUid();
  try {
    const result = await state.roomRef.transaction((data) => {
      if (!data || data.status !== ROOM_STATUS.QUESTION || data.hostUid !== uid) return;
      const game = data.game;
      if (!game || game.id !== gameId || game.index !== index) return;
      const question = game.questions?.[index];
      if (!question) return;
      // 予約した後に答える人が増えた・まだ時間が残っているなら締め切らない
      if (reason === 'all' && !allAnswered(data, game)) return;
      if (reason === 'timeout') {
        const deadline = deadlineOf(game);
        if (deadline == null || RoomkRTDB.now() < deadline + ANSWER_GRACE_MS) return;
      }
      return revealRoom(data, game, question, reason);
    });
    if (!result.committed && reason === 'timeout') state.closeRetryAt = Date.now() + CLOSE_RETRY_MS;
  } catch (error) {
    console.warn('[quiz] close failed', error);
    state.closeRetryAt = Date.now() + CLOSE_RETRY_MS;
    if (reason === 'manual') toast('締め切れませんでした。もう一度ためしてね');
  } finally {
    state.closing = false;
    if (state.room?.status === ROOM_STATUS.QUESTION) renderPlay(state.room);
  }
}

function renderResultChoices(question, result, myPick) {
  revealChoices.replaceChildren();
  const answered = Number(result.answered) || 0;
  question.choices.forEach((choice, index) => {
    const count = Number(result.counts?.[index]) || 0;
    const isCorrect = index === question.answerIndex;
    const row = el('div', 'qz-result');
    if (isCorrect) row.classList.add('qz-result--correct');
    else if (index === myPick) row.classList.add('qz-result--wrong');
    // 選択肢の文は横幅いっぱいに使い、印は文の後ろ、人数は棒の横に置く
    const label = el('span', 'qz-result__text', choice);
    if (isCorrect) {
      const icon = el('span', 'material-symbols-rounded qz-result__icon', 'check_circle');
      icon.setAttribute('aria-hidden', 'true');
      label.append(icon);
    }
    if (index === myPick) label.append(el('span', 'qz-result__tag', 'あなた'));
    const head = el('div', 'qz-result__head');
    head.append(el('span', 'qz-choice__num', NUMBERS[index]), label);
    const bar = el('div', 'qz-bar');
    const fill = el('div', 'qz-bar__fill');
    fill.style.width = `${answered ? Math.round((count / answered) * 100) : 0}%`;
    bar.append(fill);
    const foot = el('div', 'qz-result__foot');
    foot.append(bar, el('span', 'qz-result__count', `${count}人`));
    row.append(head, foot);
    revealChoices.append(row);
  });
}

function renderRanking(list, entries, gains) {
  list.replaceChildren();
  if (!entries.length) {
    list.append(el('li', 'qz-rank-list__item qz-rank-list__item--empty', 'まだ点が入った人はいません'));
    return;
  }
  entries.forEach((entry) => {
    const gain = Number(gains?.[entry.name]) || 0;
    const item = el('li', 'qz-rank-list__item');
    item.append(
      el('span', 'qz-rank-list__rank', `${entry.rank}位`),
      el('span', 'qz-rank-list__name', entry.name),
      el('span', 'qz-rank-list__points', formatPoints(entry.points)),
      el('span', 'qz-rank-list__gain', gain ? `+${gain}` : ''),
    );
    list.append(item);
  });
}

function renderReveal(data) {
  const game = data.game;
  const question = currentQuestion(data);
  if (!game || !question) return;
  showScreen('reveal');
  const isHost = state.role === 'host';
  const key = answerKey(game);
  const result = data.results?.[key] || {};
  const pick = result.picks?.[state.nickname];
  const myPick = !isHost && typeof pick === 'number' ? pick : null;
  const ranked = rankedScores(data);

  revealPackName.textContent = game.packName || 'クイズパック';
  revealProgress.textContent = `Q${game.index + 1} / ${game.total}`;
  revealQuestion.textContent = question.question;
  renderResultChoices(question, result, myPick);
  revealAnswer.textContent = `正解: ${NUMBERS[question.answerIndex]} ${question.choices[question.answerIndex]}`;
  revealExplanation.textContent = question.explanation || '';

  if (isHost) {
    revealResult.hidden = true;
    revealRank.hidden = true;
    revealRankingPanel.hidden = false;
    // 0点の人は順位に並べない（同点の0点がたくさん並ぶのを避ける）
    renderRanking(revealRanking, ranked.filter((entry) => entry.points > 0 && entry.rank <= RANKING_SIZE), result.gains);
  } else {
    revealRankingPanel.hidden = true;
    const member = data.scores?.[state.nickname];
    const gain = Number(result.gains?.[state.nickname]) || 0;
    // 押したのに集計に入らなかった（締め切りと同時・通信の遅れ）
    const late = Boolean(answerOf(data, key, state.nickname)) || state.sentAnswerKey === key;
    let text;
    let tone;
    if (!member || joinedFrom(member) > game.index) {
      text = game.index + 1 >= game.total ? '次のゲームから参加できるよ' : '次の問題から参加できるよ';
      tone = 'muted';
    } else if (myPick === question.answerIndex) {
      text = `せいかい！ +${formatPoints(gain)}`;
      tone = 'correct';
    } else if (myPick != null) {
      text = 'おしい！';
      tone = 'wrong';
    } else if (late) {
      text = '締め切りに間に合わなかったよ';
      tone = 'muted';
    } else if (result.timedOut) {
      text = '時間切れ！';
      tone = 'muted';
    } else {
      text = '今回は答えなし';
      tone = 'muted';
    }
    revealResult.textContent = text;
    revealResult.dataset.tone = tone;
    revealResult.hidden = false;
    const mine = ranked.find((entry) => entry.name === state.nickname);
    revealRank.textContent = mine && mine.points > 0 ? `いま ${mine.rank}位（${formatPoints(mine.points)}）` : '';
    revealRank.hidden = !revealRank.textContent;
  }

  const isLast = game.index + 1 >= game.total;
  hostRevealTools.hidden = !isHost;
  hostRevealCopy.hidden = !isHost;
  setButtonLabel(btnNextQuestion, isLast ? 'emoji_events' : 'arrow_forward', isLast ? '結果発表へ' : '次の問題へ');
  btnFinishGame.hidden = isLast;
  guestRevealWait.hidden = isHost;

  if (state.renderedKey !== 'reveal-' + key) {
    state.renderedKey = 'reveal-' + key;
    popIn(revealFeedback);
  }
}

function renderPodium(entries) {
  finalPodium.replaceChildren();
  entries.forEach((entry) => {
    const item = el('li', 'qz-podium__item' + (entry.rank === 1 ? ' qz-podium__item--top' : ''));
    const rank = el('span', 'qz-podium__rank');
    if (entry.rank === 1) {
      const icon = el('span', 'material-symbols-rounded', 'emoji_events');
      icon.setAttribute('aria-hidden', 'true');
      rank.append(icon);
    }
    rank.append(document.createTextNode(`${entry.rank}位`));
    item.append(rank, el('span', 'qz-podium__name', entry.name), el('span', 'qz-podium__points', formatPoints(entry.points)));
    finalPodium.append(item);
  });
}

function renderFinal(data) {
  showScreen('final');
  const isHost = state.role === 'host';
  const game = data.game;
  const ranked = rankedScores(data);
  // 表彰は点が入った人だけ（0点の同順位は並べない）
  const podium = ranked.filter((entry) => entry.points > 0 && entry.rank <= PODIUM_RANK);
  const hasPoints = podium.length > 0;
  finalPackName.textContent = game?.packName || 'クイズパック';
  renderPodium(podium);
  finalPodium.hidden = !hasPoints;
  finalEmpty.hidden = hasPoints;

  finalMe.hidden = isHost;
  if (!isHost) {
    const member = data.scores?.[state.nickname];
    const mine = ranked.find((entry) => entry.name === state.nickname);
    const played = Boolean(member && mine && game) && joinedFrom(member) <= game.index;
    let rankText = '次のゲームから参加できるよ';
    let detail = '';
    if (played && mine.points > 0) {
      rankText = `${mine.rank}位`;
      detail = `${formatPoints(mine.points)}・正解 ${mine.correct}問`;
    } else if (played) {
      rankText = formatPoints(0);
    }
    finalMeRank.textContent = rankText;
    finalMeRank.classList.toggle('qz-final-me__rank--note', !played);
    finalMeDetail.textContent = detail;
    finalMeDetail.hidden = !detail;
  }
  hostFinalTools.hidden = !isHost;
  guestFinalWait.hidden = isHost;
  if (isHost) updateRoomStartState();

  const key = 'final-' + (data.game?.id ?? '');
  if (state.renderedKey !== key) {
    state.renderedKey = key;
    popIn(hasPoints ? finalPodium : finalEmpty);
  }
}

// ルームに入っていない人もチャットで一緒に考えられるよう、ホストは問題・正解をコピーできる。
// 文面はひとつの画面モードのコピーと同じ
function copyRoomText(button, format) {
  const question = currentQuestion(state.room);
  if (state.role !== 'host' || !question || button.dataset.copyBusy) return;
  copyToClipboard(format(question), button).then((ok) => {
    if (!ok) toast('コピーできませんでした。問題を読み上げて伝えてね');
  });
}

/* ── ルームであそぶ：ホストの操作 ── */
async function hostTransaction(update, failMessage) {
  if (state.role !== 'host' || state.busy || !state.roomRef) return false;
  state.busy = true;
  const uid = currentUid();
  try {
    const result = await state.roomRef.transaction((data) => {
      if (!data || data.hostUid !== uid) return;
      return update(data);
    });
    return result.committed;
  } catch (error) {
    console.warn('[quiz] host action failed', error);
    toast(failMessage);
    return null;
  } finally {
    state.busy = false;
  }
}

function toRoomQuestion(q) {
  const item = {
    id: q.id,
    question: q.question,
    choices: q.choices.slice(),
    answerIndex: q.answerIndex,
    explanation: q.explanation || '',
  };
  if (q.sourcePackName) item.sourcePackName = q.sourcePackName;
  return item;
}

async function startRoomGame() {
  if (state.role !== 'host' || state.busy || !state.roomRef) return;
  const pack = getSelectedPack();
  if (!pack) {
    toast('パックをえらんでね');
    return;
  }
  const questions = makeDeck().map(toRoomQuestion);
  if (!questions.length) return;
  const limitSec = state.limitSec;
  const setup = { packId: pack.id, countKey: state.countKey, mode: state.mode, limitSec };
  const committed = await hostTransaction((data) => {
    if (data.status !== ROOM_STATUS.LOBBY && data.status !== ROOM_STATUS.FINAL) return;
    const guests = guestNames(data);
    if (!guests.length) return;
    const id = (Number(data.gameSeq) || 0) + 1;
    return {
      ...data,
      status: ROOM_STATUS.QUESTION,
      gameSeq: id,
      setup,
      game: {
        id,
        packName: pack.name,
        limitSec,
        total: questions.length,
        questions,
        index: 0,
        startedAt: serverTimestamp(),
      },
      // 出題と同時に、答える人ごとの受付枠を開く
      answers: {
        [answerKey({ id, index: 0 })]: openSlots(Object.fromEntries(guests.map((name) => [name, data.players[name]?.uid || null]))),
      },
      results: null,
      scores: Object.fromEntries(guests.map((name) => [
        name,
        { points: 0, correct: 0, uid: data.players[name]?.uid || null, fromIndex: 0 },
      ])),
    };
  }, 'はじめられませんでした。もう一度ためしてね');
  if (committed) {
    window.RoomkStats?.count('pack-' + pack.id);
    window.RoomkStats?.count('room-start');
  } else if (committed === false) {
    toast('はじめられませんでした。参加者を確かめてね');
  }
}

function expectedGame() {
  const game = state.room?.game;
  return game ? { id: game.id, index: game.index } : null;
}

async function nextQuestion() {
  const expected = expectedGame();
  if (!expected) return;
  await hostTransaction((data) => {
    const game = data.game;
    if (data.status !== ROOM_STATUS.REVEAL || !game) return;
    if (game.id !== expected.id || game.index !== expected.index) return;
    if (game.index + 1 >= game.total) return { ...data, status: ROOM_STATUS.FINAL };
    const nextGame = { ...game, index: game.index + 1, startedAt: serverTimestamp() };
    return {
      ...data,
      status: ROOM_STATUS.QUESTION,
      game: nextGame,
      answers: { ...(data.answers || {}), [answerKey(nextGame)]: openSlots(membersFor(data, nextGame.index)) },
    };
  }, '進められませんでした。もう一度ためしてね');
}

async function finishGame() {
  const expected = expectedGame();
  if (!expected) return;
  await hostTransaction((data) => {
    const game = data.game;
    if (data.status !== ROOM_STATUS.REVEAL || !game) return;
    if (game.id !== expected.id || game.index !== expected.index) return;
    return { ...data, status: ROOM_STATUS.FINAL };
  }, '進められませんでした。もう一度ためしてね');
}

async function backToLobby() {
  await hostTransaction((data) => {
    if (data.status !== ROOM_STATUS.FINAL) return;
    return {
      ...data,
      status: ROOM_STATUS.LOBBY,
      game: null,
      answers: null,
      results: null,
      scores: null,
    };
  }, '進められませんでした。もう一度ためしてね');
}

function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) handler();
  });
}

btnStart.addEventListener('click', startQuiz);
btnNext.addEventListener('click', goNext);
btnFinishEarly.addEventListener('click', finishEarly);
btnReplay.addEventListener('click', startQuiz);
btnBackTop.addEventListener('click', backToTop);
btnCopyQuestion.addEventListener('click', copyQuestion);
btnCopyAnswer.addEventListener('click', copyAnswer);

btnGoCreate.addEventListener('click', () => openRoomForm('create'));
btnGoJoin.addEventListener('click', () => openRoomForm('join'));
$('btnCreateBack').addEventListener('click', () => showScreen('top'));
$('btnJoinBack').addEventListener('click', () => showScreen('top'));
btnCreateRoom.addEventListener('click', createRoom);
btnJoinRoom.addEventListener('click', joinRoom);
submitOnEnter(hostNameInput, createRoom);
submitOnEnter(guestNameInput, joinRoom);
submitOnEnter(joinCodeInput, joinRoom);
$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
btnLeave.addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);
btnRoomStart.addEventListener('click', startRoomGame);
btnCloseAnswers.addEventListener('click', () => {
  const game = state.room?.game;
  if (state.role !== 'host' || state.room?.status !== ROOM_STATUS.QUESTION || !game) return;
  // 押す直前に送られた答えが届くのを待ってから締め切る
  scheduleClose(game, ANSWER_GRACE_MS, 'manual');
  btnCloseAnswers.disabled = true;
});
btnRoomCopyQuestion.addEventListener('click', () => copyRoomText(btnRoomCopyQuestion, formatQuestionText));
btnRoomCopyAnswer.addEventListener('click', () => copyRoomText(btnRoomCopyAnswer, formatAnswerText));
btnNextQuestion.addEventListener('click', nextQuestion);
btnFinishGame.addEventListener('click', finishGame);
btnRoomReplay.addEventListener('click', startRoomGame);
$('btnRoomRepick').addEventListener('click', backToLobby);

renderSegments();
renderPackCards();
updateOptionState();
showScreen('top');

// ルームにいる途中で再読み込みしたときは、同じルームに戻る
if (readSession()) {
  tryReconnect().then((reconnected) => {
    if (!reconnected && !state.roomRef) clearSession();
  });
}
