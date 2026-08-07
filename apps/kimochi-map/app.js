// きもちのことばマップ
// オフライン単独動作。選んだ内容の記録・保存・送信は一切しない。
// リロードで消えるのが正しい仕様（気持ちを証拠化しない）。

// ─── 感情語彙データ ───
// ・小学校中学年でも読めるひらがな中心の表記にする
// ・各グループ内は「近い言葉」が隣り合う順に並べる（is-near ハイライトが意味を持つため）
// ・ネガティブ語彙は「つらい」「しんどい」まで。それより深刻な語は入れない
const GROUPS = [
  {
    key: 'niko',
    name: 'にこにこ系',
    words: [
      'うれしい', 'たのしい', 'わらっちゃう', 'にこにこ',
      'ごきげん', 'いいきぶん', 'うきうき', 'わくわく',
      'るんるん', 'はずんでる', 'やったー', 'ラッキー',
    ],
  },
  {
    key: 'poka',
    name: 'ぽかぽか系',
    words: [
      'ぽかぽか', 'あったかい', 'ほっとする', 'あんしん',
      'おちつく', 'のんびり', 'ゆったり', 'まったり',
      'ふんわり', 'やさしいきもち', 'ありがとうのきもち', 'くすぐったい',
    ],
  },
  {
    key: 'moya',
    name: 'もやもや系',
    words: [
      'もやもや', 'なんとなくいや', 'ひっかかる', 'はっきりしない',
      'すっきりしない', 'うーんとなる', 'まよってる', 'こまった',
      'きまずい', 'はずかしい', 'ざんねん', 'ものたりない',
    ],
  },
  {
    key: 'zawa',
    name: 'ざわざわ系',
    words: [
      'ざわざわ', 'そわそわ', 'おちつかない', 'きんちょう',
      'どきどき', 'ふあん', 'しんぱい', 'びっくり',
      'いらいら', 'むかむか', 'ぷんぷん', 'くやしい',
    ],
  },
  {
    key: 'gutta',
    name: 'ぐったり系',
    words: [
      'ぐったり', 'つかれた', 'だるい', 'ねむい',
      'げんきがでない', 'やるきがでない', 'しんどい', 'つらい',
      'おもたいかんじ', 'さみしい', 'ひとりになりたい', 'ひとやすみしたい',
    ],
  },
  {
    key: 'suki',
    name: 'すっきり系',
    words: [
      'すっきり', 'さっぱり', 'かるいかんじ', 'スッとした',
      'ふっきれた', 'やりきった', 'できたかんじ', 'ほこらしい',
      'じしんがついた', 'まえむき', 'やってみたい', 'たのしみ',
    ],
  },
];

// 「えらばない」も正式なこたえ。押したときに返す一言（尊重の返事であって、なぐさめや分析ではない）
const NO_ANSWER_MESSAGES = {
  wakaranai: 'OK、「わからない」も大事な答え。',
  doredemo: 'OK、ぴったりのことばがないこともあるよ。',
  erabanai: 'OK、今日はながめるだけで大丈夫。',
};

const NO_ANSWER_LABELS = {
  wakaranai: 'わからない',
  doredemo: 'どれでもない',
  erabanai: '今日は選ばない',
};

// 選んだことばの前後何個までを「ちかくのことば」としてハイライトするか
const NEAR_RANGE = 2;

// 丸数字（チャット・口頭で番号回答するための表示。半角数字は使わない）
const NUMBERS = [
  '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧',
  '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮',
];

// 「わからない」等3ボタンの番号は、その画面の選択肢の続き番号にする
// （系えらび: ①〜⑥の続きで⑦⑧⑨ / ことば: ①〜⑫の続きで⑬⑭⑮ / マップ: 他に番号がないので①②③）
const NO_ANSWER_OFFSET = { groups: 6, words: 12, map: 0 };

// ─── 状態 ───
const state = {
  selected: new Set(), // 選んだことば
  noAnswer: null,      // 'wakaranai' | 'doredemo' | 'erabanai' | null
  view: 'groups',      // 'groups' | 'words' | 'map'
  groupIdx: 0,         // view === 'words' のとき表示中のグループ
};

// ことば → { groupIdx, wordIdx }
const wordIndex = new Map();
GROUPS.forEach((group, gi) => {
  group.words.forEach((word, wi) => wordIndex.set(word, { groupIdx: gi, wordIdx: wi }));
});

const groupView = document.getElementById('groupView');
const groupGrid = document.getElementById('groupGrid');
const wordView = document.getElementById('wordView');
const wordViewName = document.getElementById('wordViewName');
const wordViewChips = document.getElementById('wordViewChips');
const mapView = document.getElementById('mapView');
const mapArea = document.getElementById('mapArea');
const noAnswerRow = document.getElementById('noAnswerRow');
const gentleMsg = document.getElementById('gentleMsg');
const panel = document.getElementById('selectionPanel');
const panelChips = document.getElementById('selectionChips');
const panelHint = document.getElementById('selectionHint');
const btnClear = document.getElementById('btnClear');

// ─── 画面の組み立て ───

// 系えらび（6グループの大ボタン）
function buildGroupGrid() {
  GROUPS.forEach((group, gi) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `km-groupbtn km-group--${group.key}`;

    const num = document.createElement('span');
    num.className = 'km-groupbtn__num';
    num.textContent = NUMBERS[gi];

    const body = document.createElement('span');
    body.className = 'km-groupbtn__body';

    const name = document.createElement('span');
    name.className = 'km-groupbtn__name';
    name.textContent = group.name;

    const preview = document.createElement('span');
    preview.className = 'km-groupbtn__preview';
    preview.textContent = `${group.words.slice(0, 3).join('・')} など`;

    body.append(name, preview);
    btn.append(num, body);
    btn.setAttribute('aria-label', `${gi + 1}番: ${group.name}`);
    btn.addEventListener('click', () => showWords(gi));
    groupGrid.appendChild(btn);
  });
}

// ことばえらび（選んだ系の12語を大きく・丸数字つきで）
function buildWordView(gi) {
  const group = GROUPS[gi];
  wordView.className = `km-wordview km-group--${group.key}`;
  wordViewName.textContent = group.name;
  wordViewChips.textContent = '';

  group.words.forEach((word, wi) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'km-wordbtn';
    btn.dataset.word = word;
    btn.setAttribute('aria-pressed', 'false');

    const num = document.createElement('span');
    num.className = 'km-wordbtn__num';
    num.textContent = NUMBERS[wi];

    const text = document.createElement('span');
    text.className = 'km-wordbtn__text';
    text.textContent = word;

    btn.append(num, text);
    btn.setAttribute('aria-label', `${wi + 1}番: ${word}`);
    btn.addEventListener('click', () => toggleWord(word));
    wordViewChips.appendChild(btn);
  });
}

// マップ全体（眺めるだけモード。ここは番号なしのまま）
function buildMap() {
  GROUPS.forEach((group) => {
    const section = document.createElement('section');
    section.className = `km-group km-group--${group.key}`;

    const heading = document.createElement('h2');
    heading.className = 'km-group__name';
    const dot = document.createElement('span');
    dot.className = 'km-group__dot';
    dot.setAttribute('aria-hidden', 'true');
    heading.append(dot, document.createTextNode(group.name));

    const chips = document.createElement('div');
    chips.className = 'km-group__chips';

    group.words.forEach((word) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'km-chip';
      btn.dataset.word = word;
      btn.textContent = word;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => toggleWord(word));
      chips.appendChild(btn);
    });

    section.append(heading, chips);
    mapArea.appendChild(section);
  });
}

// ─── 画面の切りかえ ───
function showGroups() {
  state.view = 'groups';
  render();
}

function showWords(gi) {
  state.view = 'words';
  state.groupIdx = gi;
  buildWordView(gi);
  render();
  wordViewName.focus();
}

function showMap() {
  state.view = 'map';
  render();
}

// ─── 操作 ───
function toggleWord(word) {
  if (state.selected.has(word)) {
    state.selected.delete(word);
  } else {
    state.selected.add(word);
    state.noAnswer = null; // ことばを選んだら「えらばない」状態は解除
  }
  render();
}

function toggleNoAnswer(key) {
  if (state.noAnswer === key) {
    state.noAnswer = null;
  } else {
    state.noAnswer = key;
    state.selected.clear(); // えらばないことを尊重して選択はそっと消す
  }
  render();
}

function clearAll() {
  state.selected.clear();
  state.noAnswer = null;
  render();
}

// ─── 描画 ───
function nearWords() {
  const near = new Set();
  state.selected.forEach((word) => {
    const info = wordIndex.get(word);
    if (!info) return;
    const words = GROUPS[info.groupIdx].words;
    for (let d = -NEAR_RANGE; d <= NEAR_RANGE; d++) {
      const neighbor = words[info.wordIdx + d];
      if (neighbor && !state.selected.has(neighbor)) near.add(neighbor);
    }
  });
  return near;
}

function render() {
  groupView.hidden = state.view !== 'groups';
  wordView.hidden = state.view !== 'words';
  mapView.hidden = state.view !== 'map';

  // ことばボタン（ことばえらび・マップ両方）の選択・ちかく表示
  const near = nearWords();
  document.querySelectorAll('[data-word]').forEach((btn) => {
    const word = btn.dataset.word;
    const selected = state.selected.has(word);
    btn.classList.toggle('is-selected', selected);
    btn.classList.toggle('is-near', near.has(word));
    btn.setAttribute('aria-pressed', String(selected));
  });

  // 「わからない」等の番号は画面ごとの続き番号にふり直す
  const offset = NO_ANSWER_OFFSET[state.view];
  noAnswerRow.querySelectorAll('.km-noanswer__btn').forEach((btn, i) => {
    btn.querySelector('.km-noanswer__num').textContent = NUMBERS[offset + i];
    btn.setAttribute('aria-label', `${offset + i + 1}番: ${NO_ANSWER_LABELS[btn.dataset.key]}`);
    const active = state.noAnswer === btn.dataset.key;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  if (state.noAnswer) {
    gentleMsg.textContent = NO_ANSWER_MESSAGES[state.noAnswer];
    gentleMsg.hidden = false;
  } else {
    gentleMsg.textContent = '';
    gentleMsg.hidden = true;
  }

  renderPanel();
}

function renderPanel() {
  panelChips.textContent = '';
  if (state.selected.size === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  // 「ちかくのことば」の破線はことばえらび・マップでしか見えないため、案内もそこだけ出す
  panelHint.hidden = state.view === 'groups';

  state.selected.forEach((word) => {
    const info = wordIndex.get(word);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `km-picked km-group--${GROUPS[info.groupIdx].key}`;
    btn.setAttribute('aria-label', `「${word}」をはずす`);

    const text = document.createElement('span');
    text.textContent = word;

    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'close';

    btn.append(text, icon);
    btn.addEventListener('click', () => toggleWord(word));
    panelChips.appendChild(btn);
  });
}

// ─── 初期化 ───
noAnswerRow.querySelectorAll('.km-noanswer__btn').forEach((btn) => {
  btn.addEventListener('click', () => toggleNoAnswer(btn.dataset.key));
});
btnClear.addEventListener('click', clearAll);
document.getElementById('btnShowMap').addEventListener('click', showMap);
document.getElementById('btnBackFromWords').addEventListener('click', showGroups);
document.getElementById('btnBackFromMap').addEventListener('click', showGroups);

buildGroupGrid();
buildMap();
render();
