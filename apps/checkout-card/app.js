// チェックアウトカード アプリロジック
// 共通モジュール: shuffle (M-3), popIn (M-5)
import { shuffle, popIn } from '../shared/js/utils.js';

// ── 問いリスト（24問）──
// トーンは軽く、答えが一言で済むもの。評価・感想・成果を問う形にしない。
const QUESTIONS = [
  // 次回につなぐ問い（8）
  'つぎの作戦会議で やってみたいこと ある？',
  'つぎは どんなゲームが よさそう？',
  'きょうの つづきを やるなら どれから？',
  'つぎに ためしてみたい ツール ある？',
  'つぎ会うとき、ゲームと おしゃべり どっちの気分？',
  'こんど 見せたいものとか ある？',
  'つぎに 話したい話題、なにか ある？',
  'つぎは なにから はじめよっか？',

  // 今日を軽く締める問い（8）
  'きょうは ここまでで OK？',
  'きょう ちょっとでも わらったとこ、あった？',
  'きょうの中で 「もう1回やりたい」のは どれ？',
  'きょう 「ちょっとよかった」とこ、あるとしたら どこ？',
  'きょうの気分、てんきで いうと どんなかんじ？',
  'さいごに いうなら 「おつかれ」と「またね」どっち？',
  'きょうの あそびの中で おきにいりは どれ？',
  'きょうは このへんで おひらきに する？',

  // ゆるい未来の問い（8）
  '来週までに たのしみなこと ある？',
  'こんど 食べたいもの ある？',
  'あしたの たのしみ、なにか ある？',
  'こんど いっしょに しらべてみたいこと ある？',
  'つぎに会うまでに 見たい動画とか ある？',
  'こんど ためしてみたい あそび ある？',
  '週末は なにして すごしたい気分？',
  '来週の いまごろ、なにしてたい？',
];

// ── パス後の一言（どれも軽く。パスが失敗に見えない文言）──
const PASS_MESSAGES = [
  'OK！また来週！',
  'りょうかい！またね！',
  'OK！きょうも ありがとう！',
];

// ── 状態（出題履歴は「直前の1問」以外持たない）──
let pool = [];        // シャッフル済みの残りプール
let last = null;      // 直前に出した問い（連続重複の防止用）
let drawn = false;    // 1問目を引いたか
let animating = false;

// ── DOM ──
const mainArea = document.querySelector('#mainArea');
const flipCard = document.querySelector('#flipCard');
const questionText = document.querySelector('#questionText');
const passArea = document.querySelector('#passArea');
const passText = document.querySelector('#passText');
const btnDraw = document.querySelector('#btnDraw');
const btnRedraw = document.querySelector('#btnRedraw');
const btnPass = document.querySelector('#btnPass');

// ── 出題（M-3: shuffle プール方式。直前と同じ問いは出さない）──
function nextQuestion() {
  if (pool.length === 0) {
    pool = shuffle(QUESTIONS);
    // 補充直後に直前の問いが先頭へ来たら末尾に回す
    if (pool[0] === last) pool.push(pool.shift());
  }
  last = pool.shift();
  return last;
}

// ── カードを引く / 引き直す（M-4: flip-card）──
function draw() {
  if (animating) return;
  animating = true;

  if (!drawn) {
    // 1問目: 表面に問いをセットしてフリップ
    drawn = true;
    questionText.textContent = nextQuestion();
    requestAnimationFrame(() => flipCard.classList.add('flipped'));
    btnDraw.hidden = true;
    btnRedraw.hidden = false;
    flipCard.setAttribute('aria-label', 'べつのカードにする');
    setTimeout(() => { animating = false; }, 650);
  } else {
    // 引き直し: いったん裏に戻し、裏向きの間に問いを差し替えて再フリップ
    flipCard.classList.remove('flipped');
    setTimeout(() => { questionText.textContent = nextQuestion(); }, 320);
    setTimeout(() => { flipCard.classList.add('flipped'); }, 500);
    setTimeout(() => { animating = false; }, 1150);
  }
}

// ── きょうはパス（軽い一言だけ表示して終わる）──
function pass() {
  passText.textContent = PASS_MESSAGES[Math.floor(Math.random() * PASS_MESSAGES.length)];
  mainArea.hidden = true;
  passArea.hidden = false;
  popIn(passArea);
}

// ── イベント ──
btnDraw.addEventListener('click', draw);
btnRedraw.addEventListener('click', draw);
btnPass.addEventListener('click', pass);

flipCard.addEventListener('click', draw);
flipCard.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    draw();
  }
});
