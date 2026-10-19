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

// ── 制限時間 ─────────────────────────────────────
// 選べる制限時間（秒。0 はなし）。はじめは「なし」で、急かさない使い方を標準にする
const LIMITS = [0, 60, 120, 180, 300];
const TIMER_TICK_MS = 250;
const TIMER_LOW_MS = 10000; // 残り10秒から帯の色を変える

// ── 状態 ─────────────────────────────────────
// 点数・勝敗・累計は持たない。保持するのは今のお題と制限時間だけ（保存もしない）。
const state = {
  initial: null,   // 現在の頭文字
  theme: null,     // 現在のお題（テーマ）
  limitSec: 0,     // 制限時間（秒。0 はなし）
  timer: null,     // 動いている残り時間の setInterval（止まっているときは null）
};

// ── DOM ─────────────────────────────────────
const $ = (id) => document.getElementById(id);
const elScreens = {
  top:  $('screen-top'),
  odai: $('screen-odai'),
};

// ── 画面切替 ─────────────────────────────────────
function showScreen(name) {
  if (name !== 'odai') stopTimer();
  Object.values(elScreens).forEach((s) => s.classList.remove('active'));
  elScreens[name].classList.add('active');
}

// ── 制限時間の選択 ─────────────────────────────────────
const elLimitOptions = document.querySelectorAll('.kmk-limit__option');

function selectLimit(sec) {
  state.limitSec = LIMITS.includes(sec) ? sec : 0;
  elLimitOptions.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.sec) === state.limitSec)));
}

// ── 残り時間 ─────────────────────────────────────
// お題を出しただけでは動かさず、「スタート」を押してから減らす（急に始まらないように）。
// 時間になったら「時間です」と出して止まるだけ。音は鳴らさず、お題も自動では変えない
function formatRest(ms) {
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function stopTimer() {
  clearInterval(state.timer);
  state.timer = null;
}

function drawTimer(rest) {
  const root = $('odaiTimer');
  $('odaiTimerFill').style.width = `${(rest / (state.limitSec * 1000)) * 100}%`;
  $('odaiTimerLeft').textContent = rest > 0 ? formatRest(rest) : '時間です';
  root.classList.toggle('is-low', rest > 0 && rest <= TIMER_LOW_MS);
  root.classList.toggle('is-done', rest <= 0);
}

// 時間をもとにもどして「スタート」を待つ（お題を出したとき・お題をかえたとき・「リセット」）
function resetTimer() {
  stopTimer();
  const root = $('odaiTimer');
  root.hidden = state.limitSec === 0;
  if (state.limitSec === 0) return;
  root.setAttribute('aria-label', `制限時間 ${state.limitSec / 60}分`);
  drawTimer(state.limitSec * 1000);
  setTimerButton('play_arrow', 'スタート');
}

function setTimerButton(icon, label) {
  $('btnTimerIcon').textContent = icon;
  $('btnTimerLabel').textContent = label;
}

function startTimer() {
  stopTimer();
  const endsAt = Date.now() + state.limitSec * 1000;
  const tick = () => {
    const rest = Math.max(0, endsAt - Date.now());
    drawTimer(rest);
    if (rest <= 0) stopTimer();
  };
  setTimerButton('restart_alt', 'リセット');
  tick();
  state.timer = setInterval(tick, TIMER_TICK_MS);
}

// 止まっていればスタート、動いている・時間になったあとはリセット
function toggleTimer() {
  const idle = !state.timer && !$('odaiTimer').classList.contains('is-done');
  if (idle) startTimer();
  else resetTimer();
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
  resetTimer(); // お題が変わったら、時間はもとにもどして「スタート」を待つ
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
elLimitOptions.forEach((b) => b.addEventListener('click', () => selectLimit(Number(b.dataset.sec))));
$('btnTimer').addEventListener('click', toggleTimer);
$('btnStart').addEventListener('click', startGame);
$('btnReroll').addEventListener('click', () => rollOdai('both'));
$('btnRerollInitial').addEventListener('click', () => rollOdai('initial'));
$('btnRerollTheme').addEventListener('click', () => rollOdai('theme'));
$('btnBackTop').addEventListener('click', () => showScreen('top'));
$('btnCopy').addEventListener('click', () => copyToClipboard(buildCopyText(), $('btnCopy'), { successText: 'コピーしました!' }));
