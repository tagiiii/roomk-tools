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

// 選んだことばの前後何個までを「ちかくのことば」としてハイライトするか
const NEAR_RANGE = 2;

const SIZES = [
  ['small', '小さめ'],
  ['normal', 'ふつう'],
  ['big', '大きめ'],
];

// ─── 状態 ───
const state = {
  selected: new Map(), // ことば → 大きさ('small'|'normal'|'big') / 未選択は null
  noAnswer: null,      // 'wakaranai' | 'doredemo' | 'erabanai' | null
};

// ことば → { btn, groupIdx, wordIdx }
const chipIndex = new Map();

const mapArea = document.getElementById('mapArea');
const noAnswerRow = document.getElementById('noAnswerRow');
const gentleMsg = document.getElementById('gentleMsg');
const panel = document.getElementById('selectionPanel');
const panelRows = document.getElementById('selectionRows');
const btnClear = document.getElementById('btnClear');

// ─── マップ構築 ───
function buildMap() {
  GROUPS.forEach((group, gi) => {
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

    group.words.forEach((word, wi) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'km-chip';
      btn.textContent = word;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => toggleWord(word));
      chips.appendChild(btn);
      chipIndex.set(word, { btn, groupIdx: gi, wordIdx: wi });
    });

    section.append(heading, chips);
    mapArea.appendChild(section);
  });
}

// ─── 操作 ───
function toggleWord(word) {
  if (state.selected.has(word)) {
    state.selected.delete(word);
  } else {
    state.selected.set(word, null);
    state.noAnswer = null; // ことばを選んだら「えらばない」状態は解除
  }
  render();
}

function setSize(word, size) {
  if (!state.selected.has(word)) return;
  state.selected.set(word, size);
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
  state.selected.forEach((_, word) => {
    const info = chipIndex.get(word);
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
  const near = nearWords();

  chipIndex.forEach(({ btn }, word) => {
    const selected = state.selected.has(word);
    btn.classList.toggle('is-selected', selected);
    btn.classList.toggle('is-near', near.has(word));
    btn.classList.toggle('km-chip--small', selected && state.selected.get(word) === 'small');
    btn.classList.toggle('km-chip--big', selected && state.selected.get(word) === 'big');
    btn.setAttribute('aria-pressed', String(selected));
  });

  noAnswerRow.querySelectorAll('.km-noanswer__btn').forEach((btn) => {
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
  panelRows.textContent = '';
  if (state.selected.size === 0) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  state.selected.forEach((size, word) => {
    const row = document.createElement('div');
    row.className = 'km-row';

    const name = document.createElement('span');
    name.className = 'km-row__word';
    name.textContent = word;

    const sizes = document.createElement('div');
    sizes.className = 'km-row__sizes';
    sizes.setAttribute('role', 'group');
    sizes.setAttribute('aria-label', `「${word}」の大きさ（選ばなくてもOK）`);

    SIZES.forEach(([key, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'km-size';
      btn.textContent = label;
      const active = size === key;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.addEventListener('click', () => setSize(word, active ? null : key));
      sizes.appendChild(btn);
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'km-row__remove';
    remove.setAttribute('aria-label', `「${word}」をはずす`);
    const icon = document.createElement('span');
    icon.className = 'material-symbols-rounded';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'close';
    remove.appendChild(icon);
    remove.addEventListener('click', () => toggleWord(word));

    row.append(name, sizes, remove);
    panelRows.appendChild(row);
  });
}

// ─── 初期化 ───
noAnswerRow.querySelectorAll('.km-noanswer__btn').forEach((btn) => {
  btn.addEventListener('click', () => toggleNoAnswer(btn.dataset.key));
});
btnClear.addEventListener('click', clearAll);

buildMap();
render();
