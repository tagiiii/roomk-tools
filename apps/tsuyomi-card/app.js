// つよみカード アプリロジック
// 共通モジュール: copyToClipboard (M-2), showToast
import { copyToClipboard, showToast } from '../shared/js/utils.js';

// ── カードデータ（20枚） ──
// カードは素の記述形。非断定は画面の問いかけ「こういうところ、ありそう？」と
// 3択（ある/ない/どちらでもない）の答え方が担保する。「あなたは〇〇だ」型の
// 宣告文・学校/勉強文脈・他人との比較は禁止（AGENTS.md 参照）。
// icon は Material Symbols Rounded の名前。
// 系統が連続しないよう混ぜた固定順（読み上げ運用の再現性のためシャッフルしない）
const CARD_DEFS = [
  { text: '人の変化に気づく', icon: 'visibility' },
  { text: '細かいところに気づく', icon: 'search' },
  { text: '好きなことをとことん調べる', icon: 'travel_explore' },
  { text: '新しい遊びを思いつく', icon: 'lightbulb' },
  { text: '自分のペースを持っている', icon: 'directions_walk' },
  { text: '好きなことへの集中力がある', icon: 'center_focus_strong' },
  { text: 'じっくり考えてから動く', icon: 'psychology' },
  { text: '動物や植物にやさしくできる', icon: 'pets' },
  { text: '小さな幸せに気づける', icon: 'wb_sunny' },
  { text: '機械やゲームのしくみに詳しい', icon: 'joystick' },
  { text: '想像の世界を広げるのが得意', icon: 'auto_awesome' },
  { text: 'ひとりの時間を楽しめる', icon: 'self_improvement' },
  { text: 'うまくいかなくても、もう一度やってみることがある', icon: 'replay' },
  { text: '人のいいところを見つけられる', icon: 'thumb_up' },
  { text: '「なんでだろう？」と不思議に思う力がある', icon: 'help' },
  { text: '話す以外の方法で気持ちを伝えるのがうまい', icon: 'draw' },
  { text: '自分で決めたい気持ちを持っている', icon: 'how_to_reg' },
  { text: '体を動かすと元気になれる', icon: 'directions_run' },
  { text: '人を笑わせるのが好き', icon: 'mood' },
  { text: '一緒にいるとほっとする雰囲気がある', icon: 'diversity_1' },
];

const CARDS = CARD_DEFS.map((def, i) => ({ id: i + 1, ...def }));

// 答えは3択同格（どちらでもない＝まよったとき・答えたくないときの受け皿）
const ANSWER_KEYS = ['aru', 'nai', 'naka'];

// 0枚（「ある」なし）で終えたときの尊重の一言（なぐさめ・分析はしない）
const NO_ARU_REPLY = '「ある」がない日があってもいい。';

// ── 状態 ──
const state = {
  index: 0, // いま表示しているカードの位置（CARDS.length に達したら全部見た）
  decisions: CARDS.map(() => null), // null | 'aru' | 'nai' | 'naka'
  counted: false, // stats 'finish' を1プレイ1回にするためのフラグ
};

// ── DOM ──
const screens = document.querySelectorAll('.screen');
const btnStart = document.getElementById('btn-start');
const cardProgress = document.getElementById('card-progress');
const cardIcon = document.getElementById('card-icon');
const cardText = document.getElementById('card-text');
const answerButtons = document.querySelectorAll('.ty-choice-btn');
const btnBack = document.getElementById('btn-back');
const btnFinish = document.getElementById('btn-finish');
const summaryTitle = document.getElementById('summary-title');
const summarySub = document.getElementById('summary-sub');
const summaryCards = document.getElementById('summary-cards');
const btnCopy = document.getElementById('btn-copy');
const btnResume = document.getElementById('btn-resume');
const btnRestart = document.getElementById('btn-restart');

// ── 画面遷移 ──
function showScreen(id) {
  screens.forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

function aruCards() {
  return CARDS.filter((card, i) => state.decisions[i] === 'aru');
}

// ── カード画面（1枚ずつ） ──
function renderCard() {
  const i = state.index;
  const card = CARDS[i];
  cardProgress.textContent = `${i + 1} / ${CARDS.length}`;
  cardIcon.textContent = card.icon;
  cardText.textContent = card.text;
  cardText.setAttribute('aria-label', `${i + 1}枚目のカード: ${card.text}`);

  // もどってきたカードには前の答えを表示する（押し直せば上書き）
  answerButtons.forEach(btn => {
    const active = state.decisions[i] === btn.dataset.answer;
    btn.classList.toggle('ty-choice-btn--active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  btnBack.disabled = i === 0;
  cardText.focus();
}

function decide(key) {
  if (!ANSWER_KEYS.includes(key)) return;
  state.decisions[state.index] = key;
  if (state.index + 1 >= CARDS.length) {
    state.index = CARDS.length; // 全部見た
    goToSummary();
  } else {
    state.index += 1;
    renderCard();
  }
}

// ── まとめ画面 ──
function goToSummary() {
  const kept = aruCards();
  summaryCards.innerHTML = '';
  if (kept.length === 0) {
    // 「ある」0枚も正式な答え。とがめず同格に表示する
    summaryTitle.textContent = '今日は「ある」を選ばなかった';
    summarySub.textContent = NO_ARU_REPLY;
  } else {
    summaryTitle.textContent = '「ある」と答えたカード';
    summarySub.textContent = '気になるカードのことを、話してみよう';
    kept.forEach(card => {
      const item = document.createElement('div');
      item.className = 'ty-summary-card';
      const icon = document.createElement('span');
      icon.className = 'material-symbols-rounded ty-summary-card__icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = card.icon;
      const text = document.createElement('span');
      text.textContent = card.text;
      item.append(icon, text);
      summaryCards.appendChild(item);
    });
  }
  btnResume.hidden = state.index >= CARDS.length;
  if (!state.counted) {
    state.counted = true;
    window.RoomkStats?.count('finish');
  }
  // showScreen を先に呼ぶ（非表示要素への focus() は効かない）
  showScreen('summary');
  summaryTitle.focus();
}

function buildResultText() {
  const kept = aruCards();
  const lines = ['つよみカード'];
  if (kept.length === 0) {
    lines.push('今日は「ある」を選ばなかった');
  } else {
    kept.forEach(card => lines.push(`・${card.text}`));
  }
  return lines.join('\n');
}

async function copyResult(button) {
  // 連打中（コピー完了表示のリセット待ち）は copyToClipboard が false を返すため、
  // 誤ってエラートーストを出さないようここで抜ける
  if (button.dataset.copyBusy) return;
  let copied = false;
  try {
    copied = await copyToClipboard(buildResultText(), button, { successText: 'コピーしました' });
  } catch (error) {
    copied = false;
  }
  if (!copied) showToast('コピーできませんでした。カードの文を手で書きうつしてください', 'error');
}

// ── リセット ──
function resetAll() {
  state.index = 0;
  state.decisions = CARDS.map(() => null);
  state.counted = false;
}

// ── イベントリスナー ──
btnStart.addEventListener('click', () => {
  resetAll();
  // showScreen を先に呼ぶ（非表示のままだと1枚目のカードに focus() が効かない）
  showScreen('card');
  renderCard();
  window.RoomkStats?.count('start');
});

answerButtons.forEach(btn => {
  btn.addEventListener('click', () => decide(btn.dataset.answer));
});

btnBack.addEventListener('click', () => {
  if (state.index === 0) return;
  state.index -= 1;
  renderCard();
});

btnFinish.addEventListener('click', goToSummary);

btnCopy.addEventListener('click', () => copyResult(btnCopy));

btnResume.addEventListener('click', () => {
  if (state.index >= CARDS.length) return; // 全部答えたあとは戻る先がない
  showScreen('card');
  renderCard();
});

btnRestart.addEventListener('click', () => {
  resetAll();
  showScreen('top');
});
