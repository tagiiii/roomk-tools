// ことばガチャ — 空気にぴったりな言い方を当てる
import { shuffle, copyToClipboard } from '../shared/js/utils.js';

// 選択肢につける番号（①〜⑤。候補は最大3つだが余裕を持って）
const NUMBERS = ['①', '②', '③', '④', '⑤'];

// ── お題データ ─────────────────────────────────────
// template 内の ◯ が助詞の位置
const QUESTIONS = [
  {
    template: 'ぼく◯ラーメンがすき',
    choices: [
      { particle: 'は', hint: 'ふつうに伝えてる感じ' },
      { particle: 'も', hint: 'ほかの人と同じ、って感じ' },
      { particle: 'が', hint: 'けっこう強めに好き' },
    ],
  },
  {
    template: '今日◯晴れだ',
    choices: [
      { particle: 'は', hint: '今日のことを言ってる感じ' },
      { particle: 'も', hint: 'きのうに続いてる感じ' },
    ],
  },
  {
    template: 'このケーキ◯うまい!',
    choices: [
      { particle: 'は', hint: '落ち着いて味わってる感じ' },
      { particle: 'が', hint: '食べた瞬間の「うまっ!」' },
    ],
  },
  {
    template: 'きみ◯できるよ',
    choices: [
      { particle: 'なら', hint: 'きみを信じてる感じ' },
      { particle: 'は',   hint: 'ふつうにはげましてる感じ' },
    ],
  },
  {
    template: '犬◯ねこ、どっちがすき?',
    choices: [
      { particle: 'と', hint: 'この2つでくらべてる感じ' },
      { particle: 'や', hint: 'ほかにもいるけど、とりあえずこの2つ' },
    ],
  },
  {
    template: 'カレー◯食べたい',
    choices: [
      { particle: 'を', hint: 'ふつうに食べたい感じ' },
      { particle: 'が', hint: '今すぐ食べたい欲が出てる' },
    ],
  },
  {
    template: 'ぼく◯やるよ',
    choices: [
      { particle: 'は', hint: '落ち着いて引き受ける感じ' },
      { particle: 'が', hint: '「おれがやる!」な立候補感' },
      { particle: 'も', hint: 'ついでに参加する感じ' },
    ],
  },
  {
    template: 'それ◯いいね',
    choices: [
      { particle: 'は', hint: 'それひとつをほめてる' },
      { particle: 'も', hint: 'ほかのもいいし、それもいい' },
    ],
  },
  {
    template: 'その話、ぼく◯聞きたい',
    choices: [
      { particle: 'は', hint: '自分の気持ちを出してる感じ' },
      { particle: 'も', hint: 'みんなに乗っかる感じ' },
    ],
  },
  {
    template: 'そのアイデア◯おもしろい',
    choices: [
      { particle: 'は', hint: 'その案を見てる感じ' },
      { particle: 'が', hint: 'それに目がいく感じ' },
    ],
  },
];

// ── 状態 ─────────────────────────────────────
const state = {
  deck: [],
  index: 0,
  answered: false,
  correctCount: 0,
};

// ── DOM ─────────────────────────────────────
const $ = (id) => document.getElementById(id);
const elScreens = {
  top:  $('screen-top'),
  play: $('screen-play'),
  end:  $('screen-end'),
};
const elProgress   = $('progress');
const elPromptHint = $('promptHint');
const elOptions    = $('options');
const elFeedback   = $('feedback');
const elBtnNext    = $('btnNext');
const elBtnCopy    = $('btnCopy');
const elEndScore   = $('endScore');

// ── 画面切替 ─────────────────────────────────────
function showScreen(name) {
  Object.values(elScreens).forEach((s) => s.classList.remove('active'));
  elScreens[name].classList.add('active');
}

// ── HTMLエスケープ ─────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── テンプレートを「前・後」に分解 ─────────────────────────────────────
function splitTemplate(template) {
  const i = template.indexOf('◯');
  return { before: template.slice(0, i), after: template.slice(i + 1) };
}

// ── デッキ生成（お題順・選択肢順・正解をランダム化） ─────────────────────────────────────
function buildDeck() {
  return shuffle(QUESTIONS).map((q) => {
    const targetIndex = Math.floor(Math.random() * q.choices.length);
    const target = q.choices[targetIndex];
    const displayed = shuffle(q.choices.slice());
    return { template: q.template, choices: displayed, target };
  });
}

// ── 問題描画 ─────────────────────────────────────
function renderQuestion() {
  const q = state.deck[state.index];
  state.answered = false;

  elProgress.textContent = `${state.index + 1} / ${state.deck.length}`;
  elPromptHint.textContent = q.target.hint;

  elOptions.innerHTML = '';
  q.choices.forEach((c, i) => {
    const { before, after } = splitTemplate(q.template);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kg-option';
    btn.dataset.particle = c.particle;
    btn.innerHTML = `
      <span class="kg-option__sentence"><span class="kg-option__num">${NUMBERS[i]}</span>${esc(before)}<span class="kg-option__particle">${esc(c.particle)}</span>${esc(after)}</span>
      <span class="kg-option__hint">${esc(c.hint)}</span>
    `;
    btn.addEventListener('click', () => pickOption(btn, c));
    elOptions.appendChild(btn);
  });

  elFeedback.textContent = '';
  elFeedback.className = 'kg-feedback';
  elBtnNext.disabled = true;
}

// ── 選択 → 答え合わせ ─────────────────────────────────────
function pickOption(btn, choice) {
  if (state.answered) return;
  state.answered = true;

  const q = state.deck[state.index];
  const isCorrect = choice.particle === q.target.particle;
  if (isCorrect) state.correctCount++;

  [...elOptions.children].forEach((el) => {
    el.classList.add('revealed');
    if (el.dataset.particle === q.target.particle) el.classList.add('correct');
    if (el === btn && !isCorrect) el.classList.add('wrong');
  });

  elFeedback.textContent = isCorrect ? 'せいかい!' : 'せいかいは こっち';
  elFeedback.className = 'kg-feedback visible ' + (isCorrect ? 'correct' : 'wrong');

  elBtnNext.disabled = false;
}

// ── 次へ ─────────────────────────────────────
function next() {
  state.index++;
  if (state.index >= state.deck.length) {
    elEndScore.textContent = `${state.deck.length}問中 ${state.correctCount}問あたったよ`;
    showScreen('end');
    return;
  }
  renderQuestion();
}

// ── 開始 / リスタート ─────────────────────────────────────
function startGame() {
  state.deck = buildDeck();
  state.index = 0;
  state.correctCount = 0;
  renderQuestion();
  showScreen('play');
}

// ── イベント ─────────────────────────────────────
// ── 現在のお題をチャット用テキストにする ─────────────────────────────────────
function buildCopyText() {
  const q = state.deck[state.index];
  const lines = [
    'こんな感じ、なのはどれ?',
    `「${q.target.hint}」`,
    '',
    ...q.choices.map((c, i) => {
      const { before, after } = splitTemplate(q.template);
      return `${NUMBERS[i]} ${before}${c.particle}${after}`;
    }),
  ];
  return lines.join('\n');
}

$('btnStart').addEventListener('click', startGame);
$('btnNext').addEventListener('click', next);
$('btnBackTop').addEventListener('click', () => showScreen('top'));
$('btnBackTop2').addEventListener('click', () => showScreen('top'));
$('btnAgain').addEventListener('click', startGame);
elBtnCopy.addEventListener('click', () => copyToClipboard(buildCopyText(), elBtnCopy, { successText: 'コピーしました!' }));
