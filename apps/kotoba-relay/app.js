// ことばリレー アプリロジック
import { shuffle, popIn } from '../shared/js/utils.js';

// ── スターター（30）──
const starters = [
  '昨日カレー食べた。',
  'きのう変な夢を見た。',
  '家にカエルが入ってきた。',
  'コンビニでへんな音がした。',
  '冷蔵庫を開けたらプリンがなかった。',
  '朝起きたら靴下が片方なかった。',
  '公園でめずらしい石を拾った。',
  'ポケットからレシートが10枚出てきた。',
  '妹がいきなり踊り出した。',
  '空がやけに青かった。',
  '自販機でジュースを買おうとした。',
  'カバンの中からあめ玉が出てきた。',
  'テレビをつけたら知らない番組がやってた。',
  '道で500円玉を拾うところだった。',
  'ベランダにハトが3羽いた。',
  '近所のねこが家までついてきた。',
  '玄関の鍵が閉まっていなかった。',
  '隣の家から知らない鳴き声がした。',
  '洗濯物がぜんぶ裏返しだった。',
  'スマホの充電が急に100％になった。',
  '傘立てに見覚えのない傘があった。',
  'エレベーターのボタンが全部光っていた。',
  'コップに入れた麦茶の色が違った。',
  '郵便受けに手紙が1通だけ入っていた。',
  '靴の中に小さな葉っぱが入っていた。',
  '電車の中で同じかばんの人を見つけた。',
  '台所の窓が少し開いていた。',
  'よく行くパン屋に新しいパンがならんでいた。',
  '自転車のかごに知らない袋が入っていた。',
  '目覚まし時計が1時間早く鳴った。',
];

// ── つなぎ言葉カード(40) ──
// type は色分け用ラベル
const connectors = [
  // 順接・展開
  { word: 'だから',     type: 'go' },
  { word: 'それで',     type: 'go' },
  { word: 'そしたら',   type: 'go' },
  { word: 'すると',     type: 'go' },
  { word: 'そのあと',   type: 'go' },
  { word: 'つぎに',     type: 'go' },
  { word: 'ついに',     type: 'go' },
  { word: 'やっと',     type: 'go' },
  // 逆接
  { word: 'でも',         type: 'turn' },
  { word: 'ところが',     type: 'turn' },
  { word: 'なのに',       type: 'turn' },
  { word: 'けれど',       type: 'turn' },
  { word: 'それなのに',   type: 'turn' },
  { word: 'まさかの',     type: 'turn' },
  // 転換・脱線
  { word: 'ちなみに',   type: 'jump' },
  { word: 'そういえば', type: 'jump' },
  { word: '急に',       type: 'jump' },
  { word: 'とつぜん',   type: 'jump' },
  { word: 'ふと',       type: 'jump' },
  { word: 'ところで',   type: 'jump' },
  { word: 'そのとき',   type: 'jump' },
  // 強調・追加
  { word: 'しかも',       type: 'plus' },
  { word: 'じつは',       type: 'plus' },
  { word: 'なんと',       type: 'plus' },
  { word: 'さらに',       type: 'plus' },
  { word: 'おまけに',     type: 'plus' },
  { word: 'もっというと', type: 'plus' },
  // たとえ
  { word: 'たとえば',     type: 'like' },
  { word: 'まるで',       type: 'like' },
  { word: 'なんていうか', type: 'like' },
  { word: 'ちょっとまって', type: 'pass' },
  { word: 'うーん',         type: 'pass' },
  { word: 'まあまあ',       type: 'pass' },
  { word: 'そうそう',       type: 'pass' },
  { word: 'なるほどね',     type: 'pass' },
  { word: 'いうなれば',     type: 'like' },
  { word: 'たとえるなら',   type: 'like' },
  { word: 'ちょうど',       type: 'like' },
  { word: 'とはいえ',       type: 'turn' },
  { word: '話はかわるけど', type: 'jump' },
];

// ── 状態 ──
const state = {
  starter: null,
  pool: [],
  history: [], // [{word, type}]
};

// ── プール ──
function refillPool() {
  state.pool = shuffle(connectors);
}

function drawConnector() {
  if (state.pool.length === 0) refillPool();
  return state.pool.pop();
}

// ── 画面切替 ──
function showStart() {
  document.getElementById('screenStart').hidden = false;
  document.getElementById('screenGame').hidden = true;
}

function showGame() {
  document.getElementById('screenStart').hidden = true;
  document.getElementById('screenGame').hidden = false;
}

// ── 開始 ──
function start() {
  state.starter = starters[Math.floor(Math.random() * starters.length)];
  state.history = [];
  refillPool();

  document.getElementById('starterText').textContent = state.starter;
  renderHistory();
  showGame();

  popIn(document.getElementById('starterArea'));
}

// ── つなぎ言葉を引く ──
function draw() {
  const card = drawConnector();
  state.history.push(card);
  renderHistory();
  // 最新カードをポップイン
  const latest = document.querySelector('.kr-history__item:last-child');
  if (latest) popIn(latest);
}

// ── パス ──
function pass() {
  state.history.push({ word: 'パス', type: 'pass' });
  renderHistory();
  const latest = document.querySelector('.kr-history__item:last-child');
  if (latest) popIn(latest);
}

// ── 履歴描画 ──
function renderHistory() {
  const area = document.getElementById('historyArea');
  if (state.history.length === 0) {
    area.innerHTML = '<p class="kr-history__empty">「つなぎ言葉を引く」をタップしてリレーをはじめよう</p>';
    return;
  }
  area.innerHTML = state.history
    .map((c, i) => `
      <div class="kr-history__item kr-card kr-card--${c.type}">
        <span class="kr-card__num">${i + 1}</span>
        <span class="kr-card__word">${c.word}</span>
      </div>
    `)
    .join('');
}

// ── イベント ──
document.getElementById('btnStart').addEventListener('click', start);
document.getElementById('btnDraw').addEventListener('click', draw);
document.getElementById('btnPass').addEventListener('click', pass);
document.getElementById('btnAgain').addEventListener('click', start);
document.getElementById('btnEnd').addEventListener('click', showStart);
