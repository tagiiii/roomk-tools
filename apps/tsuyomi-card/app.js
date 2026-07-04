// つよみカード アプリロジック
// 共通モジュール: escapeHtml, showToast
import { escapeHtml, showToast } from '../shared/js/utils.js';

const APP_ID = 'tsuyomi-card';
const SCHEMA_VERSION = 1;

// ── カードデータ（42枚） ──
// すべて「〜かも」「〜ほうかも」の非断定形。断定・学校/勉強文脈・他人との比較は禁止（AGENTS.md 参照）
const CARD_TEXTS = [
  'さいごまで 見ちゃう しゅうちゅう力が あるかも',
  '人の へんかに 気づくほうかも',
  'じぶんの ペースを もってるかも',
  'すきなことを とことん しらべちゃうほうかも',
  'こまかいところに 気づくほうかも',
  'あたらしい あそびを 思いつくほうかも',
  'どうぶつや 植物に やさしく できるかも',
  '人の話を じっくり 聞けるときが あるかも',
  'おもしろいことを 見つけるのが うまいかも',
  'ひとりの時間を たのしめるほうかも',
  'まわりを よく 見ているほうかも',
  'じっくり かんがえてから うごくほうかも',
  '気になったことを ずっと おぼえてるほうかも',
  '手先が きようなほうかも',
  'ものを たいせつに つかうほうかも',
  'その場の ふんいきを かんじとる アンテナが あるかも',
  'すきなものへの こだわりが あるかも',
  'そうぞうの世界を ひろげるのが とくいかも',
  'だれかの いいところを 見つけられるかも',
  'しずかな 時間を たのしめるかも',
  'うまくいかなくても もういちど やってみるときが あるかも',
  'じぶんの「すき」を はっきり もってるかも',
  'たのしいことを かんがえるのが とくいかも',
  'ゆっくり ていねいに やるほうかも',
  'こまってる人が いると 気になっちゃうほうかも',
  'あぶなくないか よく たしかめる しんちょうさが あるかも',
  '音や 色の ちがいに 気づきやすいかも',
  '話す いがいの ほうほうで 気もちを つたえるのが うまいかも',
  'だれかを わらわせるのが すきかも',
  'きかいや ゲームの しくみに くわしいかも',
  'じぶんで きめたい 気もちを ちゃんと もってるかも',
  'まえに 聞いたことを よく おぼえてるかも',
  'からだを うごかすと 元気に なれるほうかも',
  'ちいさな しあわせに 気づけるかも',
  'きけんを さける ちょっかんが あるかも',
  'きれいなものに 気づく目が あるかも',
  '「なんでだろう？」と ふしぎに思う力が あるかも',
  'ひとつのことを ながく つづけられるときが あるかも',
  'じぶんだけの 見かたが できるかも',
  'やさしい ことばを えらべるときが あるかも',
  '気もちを 切りかえるのが うまいときが あるかも',
  'いっしょにいると ほっとする ふんいきが あるかも',
];

const CARDS = CARD_TEXTS.map((text, i) => ({ id: i + 1, text }));

// ── フェーズ設定 ──
const PHASES = {
  kid: {
    title: '「あるかも」を さがそう',
    sub: '「そういうところが あるかも」と 思うカードを えらんでね（なくても OK）',
    max: 3,
    next: 'つぎへ（メンターのばん）',
    limitMsg: 'えらぶのは 3まいくらいまで。いれかえたいときは、えらんである カードを タップして もどしてね',
  },
  mentor: {
    title: 'メンターから 見えた「あるかも」',
    sub: 'メンターの目から 見えたところを えらんでね（1〜2まい）',
    max: 2,
    next: 'みせあいへ',
    limitMsg: 'メンターが えらぶのは 2まいまで。いれかえるときは、えらんである カードを タップして もどしてね',
  },
};

// 「えらばない」も正式なこたえ。押したときに返す一言（尊重の返事であって、なぐさめや分析ではない）
const NO_ANSWER_LABELS = {
  wakaranai: 'わからない',
  erabanai: 'きょうは えらばない',
};
const NO_ANSWER_REPLIES = {
  wakaranai: 'OK、「わからない」も だいじな こたえ。',
  erabanai: 'OK、えらばない日が あっても いいよ。',
};

// ── ファイルの目じるし（個人名の代わり。sakusen-kaigi と同方式） ──
const FILE_MARKERS = {
  colors: [
    { label: 'そらいろ', romaji: 'sora' },
    { label: 'みどり', romaji: 'midori' },
    { label: 'きいろ', romaji: 'kiiro' },
    { label: 'ももいろ', romaji: 'momo' },
    { label: 'むらさき', romaji: 'murasaki' },
    { label: 'あか', romaji: 'aka' },
    { label: 'しろ', romaji: 'shiro' },
    { label: 'ぎんいろ', romaji: 'gin' },
  ],
  animals: [
    { label: 'ネコ', romaji: 'neko', icon: 'pets' },
    { label: 'イヌ', romaji: 'inu', icon: 'pets' },
    { label: 'ウサギ', romaji: 'usagi', icon: 'cruelty_free' },
    { label: 'ペンギン', romaji: 'pengin', icon: 'icecream' },
    { label: 'イルカ', romaji: 'iruka', icon: 'waves' },
    { label: 'リス', romaji: 'risu', icon: 'park' },
    { label: 'フクロウ', romaji: 'fukurou', icon: 'nightlight' },
    { label: 'パンダ', romaji: 'panda', icon: 'forest' },
  ],
};

// ── 状態 ──
const state = {
  phase: 'kid', // 'kid' | 'mentor'
  kid: { cards: new Set(), noAnswer: null }, // noAnswer: null | 'wakaranai' | 'erabanai'
  mentor: { cards: new Set() },
  marker: null, // { color, animal } 見せ合い画面で初回生成
};

// ── DOM ──
const screens = document.querySelectorAll('.screen');
const btnStart = document.getElementById('btn-start');
const btnHowto = document.getElementById('btn-howto-toggle');
const howtoPanel = document.getElementById('howto-panel');
const pickTitle = document.getElementById('pick-title');
const pickSub = document.getElementById('pick-sub');
const noAnswerRow = document.getElementById('noanswer-row');
const noAnswerReply = document.getElementById('noanswer-reply');
const cardGrid = document.getElementById('card-grid');
const btnPickNext = document.getElementById('btn-pick-next');
const btnPickBack = document.getElementById('btn-pick-back');
const showKid = document.getElementById('show-kid');
const showMentor = document.getElementById('show-mentor');
const showMarker = document.getElementById('show-marker');
const btnSaveJson = document.getElementById('btn-save-json');
const btnShowBack = document.getElementById('btn-show-back');
const btnRestart = document.getElementById('btn-restart');

// ── 画面遷移 ──
function showScreen(id) {
  screens.forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// ── 丸数字（①〜㊿） ──
function circledNumber(n) {
  if (n >= 1 && n <= 20) return String.fromCodePoint(0x245F + n);
  if (n >= 21 && n <= 35) return String.fromCodePoint(0x3251 + n - 21);
  if (n >= 36 && n <= 50) return String.fromCodePoint(0x32B1 + n - 36);
  return `${n}.`;
}

function currentSelection() {
  return state.phase === 'kid' ? state.kid.cards : state.mentor.cards;
}

// ── えらぶ画面 ──
function renderPick() {
  const cfg = PHASES[state.phase];
  pickTitle.textContent = cfg.title;
  pickSub.textContent = cfg.sub;
  btnPickNext.textContent = cfg.next;
  btnPickBack.hidden = state.phase === 'kid';

  // 「えらばない」ボタンは子どものターンのみ（カードと同格の正式なこたえ）
  noAnswerRow.hidden = state.phase !== 'kid';
  noAnswerRow.querySelectorAll('button').forEach(btn => {
    btn.setAttribute('aria-pressed', String(state.phase === 'kid' && state.kid.noAnswer === btn.dataset.key));
  });
  noAnswerReply.textContent =
    state.phase === 'kid' && state.kid.noAnswer ? NO_ANSWER_REPLIES[state.kid.noAnswer] : '';

  renderGrid();
}

function renderGrid() {
  const selected = currentSelection();
  cardGrid.innerHTML = '';
  CARDS.forEach((card, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ty-card' + (selected.has(card.id) ? ' ty-card--selected' : '');
    btn.setAttribute('aria-pressed', String(selected.has(card.id)));
    btn.setAttribute('aria-label', `${i + 1}番のカード: ${card.text}`);
    // 未選択カードのグレーアウトはしない（選ばれなかった＝弱み、という見え方を作らない）
    btn.innerHTML = [
      `<span class="ty-card__num" aria-hidden="true">${circledNumber(i + 1)}</span>`,
      `<span class="ty-card__text">${escapeHtml(card.text)}</span>`,
      '<span class="ty-card__check material-symbols-rounded" aria-hidden="true">check_circle</span>',
    ].join('');
    btn.addEventListener('click', () => toggleCard(card.id));
    cardGrid.appendChild(btn);
  });
}

function toggleCard(id) {
  const selected = currentSelection();
  const cfg = PHASES[state.phase];
  if (selected.has(id)) {
    selected.delete(id);
  } else {
    if (selected.size >= cfg.max) {
      showToast(cfg.limitMsg, 'info');
      return;
    }
    selected.add(id);
    if (state.phase === 'kid') state.kid.noAnswer = null; // カードを選んだら「えらばない」は解除
  }
  renderPick();
}

noAnswerRow.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.key;
    if (state.kid.noAnswer === key) {
      state.kid.noAnswer = null;
    } else {
      state.kid.noAnswer = key;
      state.kid.cards.clear(); // えらばないことを尊重して選択はそっと消す
    }
    renderPick();
  });
});

// ── 見せ合い画面 ──
function makeMarker() {
  const color = FILE_MARKERS.colors[Math.floor(Math.random() * FILE_MARKERS.colors.length)];
  const animal = FILE_MARKERS.animals[Math.floor(Math.random() * FILE_MARKERS.animals.length)];
  return { color: color.label, animal: animal.label };
}

function markerParts(marker) {
  const color = FILE_MARKERS.colors.find(item => item.label === marker?.color) || FILE_MARKERS.colors[0];
  const animal = FILE_MARKERS.animals.find(item => item.label === marker?.animal) || FILE_MARKERS.animals[0];
  return { color, animal };
}

function selectedCards(cardSet) {
  return CARDS.filter(card => cardSet.has(card.id));
}

function renderShowGroup(el, cards, noAnswer) {
  el.innerHTML = '';
  if (noAnswer) {
    const chip = document.createElement('div');
    chip.className = 'ty-show-card ty-show-card--answer';
    chip.textContent = `「${NO_ANSWER_LABELS[noAnswer]}」を えらんだよ`;
    el.appendChild(chip);
    return;
  }
  if (cards.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ty-show-card ty-show-card--answer';
    empty.textContent = 'きょうは カードを えらばなかったよ（それも OK）';
    el.appendChild(empty);
    return;
  }
  cards.forEach(card => {
    const item = document.createElement('div');
    item.className = 'ty-show-card';
    item.textContent = card.text;
    el.appendChild(item);
  });
}

function renderShow() {
  if (!state.marker) state.marker = makeMarker();
  renderShowGroup(showKid, selectedCards(state.kid.cards), state.kid.noAnswer);
  renderShowGroup(showMentor, selectedCards(state.mentor.cards), null);
  const parts = markerParts(state.marker);
  showMarker.innerHTML = [
    '<span class="material-symbols-rounded" aria-hidden="true">',
    escapeHtml(parts.animal.icon),
    '</span><span>きろくの めじるし: ',
    escapeHtml(`${parts.color.label}の${parts.animal.label}`),
    '</span>',
  ].join('');
}

// ── JSON 書き出し（保存のみ・読み込みなし） ──
function buildRecord() {
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    fileMarker: state.marker,
    createdAt: new Date().toISOString(),
    kid: {
      answer: state.kid.noAnswer || 'cards',
      cards: selectedCards(state.kid.cards),
    },
    mentor: {
      answer: 'cards',
      cards: selectedCards(state.mentor.cards),
    },
  };
}

function exportFilename() {
  const parts = markerParts(state.marker);
  const date = new Date();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `tsuyomi-card_${parts.animal.romaji}-${parts.color.romaji}_${ymd}.json`;
}

function downloadRecord() {
  const blob = new Blob([JSON.stringify(buildRecord(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast('ほぞんしました', 'success');
}

// ── リセット ──
function resetAll() {
  state.phase = 'kid';
  state.kid.cards.clear();
  state.kid.noAnswer = null;
  state.mentor.cards.clear();
  state.marker = null;
}

// ── イベントリスナー ──
btnStart.addEventListener('click', () => {
  state.phase = 'kid';
  renderPick();
  showScreen('pick');
});

btnHowto.addEventListener('click', () => {
  howtoPanel.classList.toggle('visible');
  btnHowto.textContent = howtoPanel.classList.contains('visible')
    ? 'あそびかたを閉じる' : 'あそびかた';
});

btnPickNext.addEventListener('click', () => {
  if (state.phase === 'kid') {
    state.phase = 'mentor';
    renderPick();
    showScreen('pick');
    window.scrollTo(0, 0);
  } else {
    renderShow();
    showScreen('show');
  }
});

btnPickBack.addEventListener('click', () => {
  state.phase = 'kid';
  renderPick();
  showScreen('pick');
});

btnShowBack.addEventListener('click', () => {
  state.phase = 'mentor';
  renderPick();
  showScreen('pick');
});

btnSaveJson.addEventListener('click', downloadRecord);

btnRestart.addEventListener('click', () => {
  resetAll();
  showScreen('top');
  howtoPanel.classList.remove('visible');
  btnHowto.textContent = 'あそびかた';
});
