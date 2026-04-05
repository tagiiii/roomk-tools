// 以心伝心しないゲーム アプリロジック
import { shuffle, copyToClipboard, popIn } from '../shared/js/utils.js';

// ── お題リスト（100問）──
const topics = [
  // 食べもの系（20）
  '赤いものといえば？',
  '夏に食べたいものといえば？',
  '冷たい食べものといえば？',
  '甘いものといえば？',
  '朝ごはんに食べるものといえば？',
  'カレーに入れるものといえば？',
  'おにぎりの具といえば？',
  'コンビニで買うものといえば？',
  'お祭りで食べるものといえば？',
  'ラーメンのトッピングといえば？',
  'お弁当に入っていたらうれしいものといえば？',
  'パンにはさむものといえば？',
  'ピザのトッピングといえば？',
  '白いごはんのお供といえば？',
  '冬に食べたいものといえば？',
  'おやつといえば？',
  '飲みものといえば？',
  'すっぱい食べものといえば？',
  'お寿司のネタといえば？',
  'アイスの味といえば？',

  // 動物・生きもの系（15）
  '動物といえば？',
  '海にいる生きものといえば？',
  'ペットにしたい動物といえば？',
  '大きい動物といえば？',
  '小さい生きものといえば？',
  '空を飛ぶ生きものといえば？',
  'かわいい動物といえば？',
  'すばしっこい動物といえば？',
  '動物園にいる動物といえば？',
  '水族館にいる生きものといえば？',
  '虫といえば？',
  'もふもふな動物といえば？',
  '強そうな動物といえば？',
  'おもしろい名前の生きものといえば？',
  '夜に活動する動物といえば？',

  // 色・形・もの系（15）
  '丸いものといえば？',
  '白いものといえば？',
  '四角いものといえば？',
  '大きいものといえば？',
  'やわらかいものといえば？',
  'かたいものといえば？',
  'キラキラしているものといえば？',
  '長いものといえば？',
  '小さいものといえば？',
  '青いものといえば？',
  '黄色いものといえば？',
  'ふわふわなものといえば？',
  '重いものといえば？',
  '透明なものといえば？',
  '冷たいものといえば？',

  // 場所・乗りもの系（10）
  '乗りものといえば？',
  '行ってみたい場所といえば？',
  '遊園地の乗りものといえば？',
  '海で遊ぶものといえば？',
  '公園にあるものといえば？',
  'お店の種類といえば？',
  'キャンプで使うものといえば？',
  'お風呂にあるものといえば？',
  '台所にあるものといえば？',
  'リビングにあるものといえば？',

  // スポーツ・遊び系（10）
  'スポーツといえば？',
  '楽器といえば？',
  'ボールを使うスポーツといえば？',
  'みんなで遊べるゲームといえば？',
  'カードゲームといえば？',
  '外で遊ぶ遊びといえば？',
  'お正月の遊びといえば？',
  '雨の日にできる遊びといえば？',
  '二人でできる遊びといえば？',
  'パーティーでやることといえば？',

  // 季節・イベント系（10）
  'お祭りといえば？',
  '誕生日にほしいものといえば？',
  '冬にしたいことといえば？',
  '夏にしたいことといえば？',
  'クリスマスといえば？',
  'お正月といえば？',
  '春といえば？',
  '秋といえば？',
  'ハロウィンの仮装といえば？',
  '夏休みにしたいことといえば？',

  // 日常・おもしろ系（10）
  'ポケットに入っていたらいいものといえば？',
  '朝起きて最初にすることといえば？',
  '寝る前にすることといえば？',
  '100個あったらうれしいものといえば？',
  '透明人間になったらやることといえば？',
  '無人島に持っていくものといえば？',
  'タイムマシンで行きたい時代といえば？',
  '自分の部屋にほしいものといえば？',
  '10分でできることといえば？',
  '道に落ちていたらびっくりするものといえば？',

  // 人・キャラ系（10）
  '有名な人といえば？',
  'かっこいい職業といえば？',
  'マンガ・アニメのキャラといえば？',
  'おとぎ話の登場人物といえば？',
  'ヒーローの必殺技に使いそうな言葉といえば？',
  'RPGの職業といえば？',
  '魔法使いが使いそうな道具といえば？',
  '戦隊ヒーローの色といえば？',
  'ロボットに付けたい名前といえば？',
  'ゲームのアイテムといえば？',
];

// ── 状態 ──
let pool = [];
let candidates = [];
let totalRounds = 5;
let currentRound = 0;

// ── DOM参照 ──
const $topScreen     = document.getElementById('screen-top');
const $selectScreen  = document.getElementById('screen-select');
const $topicScreen   = document.getElementById('screen-topic');
const $finalScreen   = document.getElementById('screen-final');
const $roundSelect   = document.getElementById('roundSelect');
const $startBtn      = document.getElementById('btnStart');
const $selectTitle   = document.getElementById('selectTitle');
const $candidateGrid = document.getElementById('candidateGrid');
const $topicText     = document.getElementById('topicText');
const $roundBadge    = document.getElementById('roundBadge');
const $nextBtn       = document.getElementById('btnNext');
const $poolInfo      = document.getElementById('poolInfo');

// ── 画面遷移 ──
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// ── プール管理 ──
function refillPool() {
  pool = shuffle(topics);
}

function drawCandidates() {
  if (pool.length < 3) refillPool();
  candidates = pool.splice(0, 3);
}

// ── ゲーム開始 ──
function startGame() {
  totalRounds = parseInt($roundSelect.value, 10);
  currentRound = 0;
  refillPool();
  nextRound();
}

// ── 次のラウンド ──
function nextRound() {
  currentRound++;
  drawCandidates();
  renderSelectScreen();
  showScreen('select');
}

// ── お題選択画面の描画 ──
function renderSelectScreen() {
  $selectTitle.textContent = `ラウンド ${currentRound} / ${totalRounds}`;
  $candidateGrid.innerHTML = '';

  candidates.forEach((topic, i) => {
    const card = document.createElement('button');
    card.className = 'isd-candidate';
    card.setAttribute('aria-label', `${i + 1}番のお題: ${topic}`);
    card.innerHTML = `<span class="isd-candidate__text">${topic}</span>`;
    card.addEventListener('click', () => pickTopic(i, topic));
    $candidateGrid.appendChild(card);
  });

  $poolInfo.textContent = `残り ${pool.length} / ${topics.length} 問`;
}

// ── お題を選ぶ ──
function pickTopic(idx, topic) {
  const cards = document.querySelectorAll('#candidateGrid .isd-candidate');
  cards.forEach((c, i) => {
    if (i === idx) {
      c.classList.add('selected');
    } else {
      c.classList.add('dimmed');
    }
    c.disabled = true;
  });

  setTimeout(() => {
    showTopicScreen(topic);
  }, 400);
}

// ── お題表示画面 ──
function showTopicScreen(topic) {
  $topicText.textContent = topic;
  $roundBadge.textContent = `ラウンド ${currentRound} / ${totalRounds}`;

  if (currentRound >= totalRounds) {
    $nextBtn.innerHTML = '<span class="material-symbols-rounded">emoji_events</span> 結果発表へ';
  } else {
    $nextBtn.innerHTML = '<span class="material-symbols-rounded">arrow_forward</span> 次のラウンドへ';
  }

  showScreen('topic');
  popIn(document.querySelector('.isd-topic'));
}

// ── 次へ / 結果発表へ ──
function handleNext() {
  if (currentRound >= totalRounds) {
    document.getElementById('finalRounds').textContent = `全 ${totalRounds} ラウンド終了`;
    showScreen('final');
    popIn(document.querySelector('.isd-final'));
  } else {
    nextRound();
  }
}

// ── 最初からやり直す ──
function restart() {
  showScreen('top');
}

// ── イベント ──
$startBtn.addEventListener('click', startGame);
$nextBtn.addEventListener('click', handleNext);
document.getElementById('btnCopy').addEventListener('click', function () {
  copyToClipboard($topicText.textContent, this);
});
document.getElementById('btnRestart').addEventListener('click', restart);
document.getElementById('btnBackToTop').addEventListener('click', restart);
