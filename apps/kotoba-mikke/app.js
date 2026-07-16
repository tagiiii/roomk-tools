// ことばみっけ — 「◯からはじまる」お題に合うことばを、みんなでさがす
import { copyToClipboard } from '../shared/js/utils.js';

// ── 頭文字プール ─────────────────────────────────────
// 答えを出しにくい字（を・ん・ぬ・る・れ）と、小書き・濁点/半濁点始まり・
// 旧字・長音は入れない。迷う字はカタカナ語（同じ音）で拾える。
const INITIALS = [
  'あ', 'い', 'う', 'え', 'お',
  'か', 'き', 'く', 'け', 'こ',
  'さ', 'し', 'す', 'せ', 'そ',
  'た', 'ち', 'つ', 'て', 'と',
  'な', 'に', 'ね', 'の',
  'は', 'ひ', 'ふ', 'へ', 'ほ',
  'ま', 'み', 'む', 'め', 'も',
  'や', 'ゆ', 'よ',
  'ら', 'り', 'ろ', 'わ',
];

// ── お題（テーマ）プール ─────────────────────────────────────
// 小学館「コトバト」のお題に準拠した単一テーマ。「〜言葉」「〜もの」の2系統で、
// 感情の幅（ポジ〜ネガ）をあえて広く取る。こわい/わるい/あぶない 等も、
// 辞書や想像から言葉をさがす“言葉あそび”として扱う。
const THEMES = [
  // 〜言葉
  'やさしい言葉',
  'あたたかい言葉',
  'あかるい言葉',
  'うれしい言葉',
  'おもしろい言葉',
  'あまい言葉',
  'うつくしい言葉',
  'かなしい言葉',
  'くらい言葉',
  'わるい言葉',
  'えらそうな言葉',
  'きまずい言葉',
  // 〜もの
  'やわらかいもの',
  'かわいいもの',
  'きれいなもの',
  'おもいもの',
  'つよいもの',
  'はやいもの',
  'ながいもの',
  'ちいさなもの',
  'かたいもの',
  'こわいもの',
  'おおきなもの',
  'おいしいもの',
  'よわいもの',
  'あやしいもの',
  'あぶないもの',
  'へんなもの',
];

// ── 状態 ─────────────────────────────────────
// 点数・勝敗・累計は持たない。保持するのは今のお題だけ（保存もしない）。
const state = {
  initial: null,   // 現在の頭文字
  theme: null,     // 現在のお題（テーマ）
};

// ── DOM ─────────────────────────────────────
const $ = (id) => document.getElementById(id);
const elScreens = {
  top:  $('screen-top'),
  odai: $('screen-odai'),
};

// ── 画面切替 ─────────────────────────────────────
function showScreen(name) {
  Object.values(elScreens).forEach((s) => s.classList.remove('active'));
  elScreens[name].classList.add('active');
}

// ── お題を引く ─────────────────────────────────────
function pickDifferent(arr, prev) {
  if (arr.length <= 1) return arr[0];
  let v;
  do { v = arr[Math.floor(Math.random() * arr.length)]; } while (v === prev);
  return v;
}

// mode: 'both'（両方引き直し） / 'initial'（文字だけ） / 'theme'（テーマだけ）
function rollOdai(mode = 'both') {
  if (mode === 'both' || mode === 'initial') {
    state.initial = pickDifferent(INITIALS, state.initial);
  }
  if (mode === 'both' || mode === 'theme') {
    state.theme = pickDifferent(THEMES, state.theme);
  }
  renderOdai();
}

function renderOdai() {
  $('odaiInitial').textContent = state.initial;
  $('odaiTheme').textContent = state.theme;
}

// ── お題をチャット用テキストにする ─────────────────────────────────────
function buildCopyText() {
  return [
    `「${state.initial}」からはじまる、${state.theme}`,
    '思いついたら チャットで送ってね',
  ].join('\n');
}

// ── 開始 ─────────────────────────────────────
function startGame() {
  rollOdai('both');
  showScreen('odai');
}

// ── イベント ─────────────────────────────────────
$('btnStart').addEventListener('click', startGame);
$('btnReroll').addEventListener('click', () => rollOdai('both'));
$('btnRerollInitial').addEventListener('click', () => rollOdai('initial'));
$('btnRerollTheme').addEventListener('click', () => rollOdai('theme'));
$('btnBackTop').addEventListener('click', () => showScreen('top'));
$('btnCopy').addEventListener('click', () => copyToClipboard(buildCopyText(), $('btnCopy'), { successText: 'コピーしました!' }));
