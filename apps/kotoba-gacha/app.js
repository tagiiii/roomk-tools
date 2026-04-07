// ことばガチャ — ひとこと変えると、空気が変わる
import { shuffle } from '../shared/js/utils.js';

// ── お題データ ─────────────────────────────────────
// template 内の ◯ が選択肢で置き換わる
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
  selected: null, // 現在選択中の助詞
};

// ── DOM ─────────────────────────────────────
const $ = (id) => document.getElementById(id);
const elScreens = {
  top:  $('screen-top'),
  play: $('screen-play'),
  end:  $('screen-end'),
};
const elProgress     = $('progress');
const elTopic        = $('topic');
const elChoices      = $('choices');
const elResult       = $('result');
const elResultSent   = $('resultSentence');
const elResultHint   = $('resultHint');
const elBtnNext      = $('btnNext');

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

// ── テンプレートを「前・◯・後」に分解 ─────────────────────────────────────
function splitTemplate(template) {
  const i = template.indexOf('◯');
  return { before: template.slice(0, i), after: template.slice(i + 1) };
}

// ── 問題描画 ─────────────────────────────────────
function renderQuestion() {
  const q = state.deck[state.index];
  state.selected = null;

  elProgress.textContent = `${state.index + 1} / ${state.deck.length}`;

  // お題文（◯はスロット）
  const { before, after } = splitTemplate(q.template);
  elTopic.innerHTML =
    `${esc(before)}<span class="kg-topic__slot" id="topicSlot">◯</span>${esc(after)}`;

  // 選択肢
  elChoices.innerHTML = '';
  q.choices.forEach((c) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kg-choice';
    btn.textContent = c.particle;
    btn.dataset.particle = c.particle;
    btn.addEventListener('click', () => selectChoice(c));
    elChoices.appendChild(btn);
  });

  // 結果エリアを隠す
  elResult.classList.remove('visible');
  elResultSent.innerHTML = '';
  elResultHint.textContent = '';

  // つぎボタンは未選択時は非活性
  elBtnNext.disabled = true;
}

// ── 選択肢クリック ─────────────────────────────────────
function selectChoice(choice) {
  const q = state.deck[state.index];
  state.selected = choice;

  // カードの見た目を更新
  [...elChoices.children].forEach((btn) => {
    btn.classList.remove('selected', 'dimmed');
    if (btn.dataset.particle === choice.particle) {
      btn.classList.add('selected');
    } else {
      btn.classList.add('dimmed');
    }
  });

  // お題の◯を選んだ助詞に置き換え（再度タップし直しても切り替わる）
  const slot = $('topicSlot');
  slot.textContent = choice.particle;
  slot.classList.add('filled');
  // 軽い pop アニメ
  slot.animate(
    [
      { transform: 'scale(0.8)', opacity: 0.4 },
      { transform: 'scale(1.15)', opacity: 1 },
      { transform: 'scale(1)', opacity: 1 },
    ],
    { duration: 260, easing: 'ease-out' }
  );

  // 結果エリア：完成文 + ヒント
  const { before, after } = splitTemplate(q.template);
  elResultSent.innerHTML =
    `${esc(before)}<span class="kg-particle">${esc(choice.particle)}</span>${esc(after)}`;
  elResultHint.textContent = choice.hint;
  elResult.classList.add('visible');

  elBtnNext.disabled = false;
}

// ── 次へ ─────────────────────────────────────
function next() {
  state.index++;
  if (state.index >= state.deck.length) {
    showScreen('end');
    return;
  }
  renderQuestion();
}

// ── 開始 / リスタート ─────────────────────────────────────
function startGame() {
  state.deck = shuffle(QUESTIONS);
  state.index = 0;
  renderQuestion();
  showScreen('play');
}

// ── イベント ─────────────────────────────────────
$('btnStart').addEventListener('click', startGame);
$('btnNext').addEventListener('click', next);
$('btnBackTop').addEventListener('click', () => showScreen('top'));
$('btnBackTop2').addEventListener('click', () => showScreen('top'));
$('btnAgain').addEventListener('click', startGame);
