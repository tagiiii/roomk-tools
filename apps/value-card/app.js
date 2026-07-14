// バリューカード アプリロジック
// 共通モジュール: shuffle (M-3), popIn (M-5), escapeHtml
import { shuffle, popIn, escapeHtml } from '../shared/js/utils.js';

// ── カードデータ（30枚） ──
const cardData = [
  { id: 1,  keyword: '自分のペース',   description: '自分のペースでやれるのがいちばん' },
  { id: 2,  keyword: '新しい発見',     description: '知らないことを見つけるとワクワクする' },
  { id: 3,  keyword: 'ものづくり',     description: '何かを作っている時間が好き' },
  { id: 4,  keyword: '仲間',           description: '気の合う人と一緒にいるとホッとする' },
  { id: 5,  keyword: 'チャレンジ',     description: 'むずかしいことに挑戦したい' },
  { id: 6,  keyword: 'のんびり',       description: 'ゆっくり過ごす時間が大切' },
  { id: 7,  keyword: '笑い',           description: '笑っている時間がいちばん楽しい' },
  { id: 8,  keyword: '自然',           description: '外の空気や自然にふれるのが好き' },
  { id: 9,  keyword: 'ゲーム・勝負',   description: '勝負や駆け引きにワクワクする' },
  { id: 10, keyword: 'やさしさ',       description: '誰かにやさしくできるとうれしい' },
  { id: 11, keyword: '自由',           description: '好きなときに好きなことをしたい' },
  { id: 12, keyword: '集中',           description: '何かに夢中になっている時間が好き' },
  { id: 13, keyword: '家族',           description: '家族と過ごす時間を大切にしたい' },
  { id: 14, keyword: '動物',           description: '動物と一緒にいると気持ちが落ち着く' },
  { id: 15, keyword: '音楽',           description: '音楽を聴いたり歌ったりするのが好き' },
  { id: 16, keyword: '安心',           description: '安心できる場所があるのが大事' },
  { id: 17, keyword: '得意なこと',     description: '自分の得意をもっと伸ばしたい' },
  { id: 18, keyword: 'ありがとう',     description: '「ありがとう」って言える関係がいい' },
  { id: 19, keyword: '冒険',           description: 'まだ知らない場所に行ってみたい' },
  { id: 20, keyword: 'おいしいもの',   description: 'おいしいものを食べるとしあわせ' },
  { id: 21, keyword: 'ひとりの時間',   description: 'ひとりでゆっくりする時間も好き' },
  { id: 22, keyword: 'やりきる',       description: '最後までやりきると気持ちいい' },
  { id: 23, keyword: 'おしゃべり',     description: '人と話すのが楽しい' },
  { id: 24, keyword: '想像・空想',     description: '頭のなかで自由に想像するのが好き' },
  { id: 25, keyword: 'きれいなもの',   description: 'きれいな景色やものを見ると元気になる' },
  { id: 26, keyword: '助ける',         description: '困っている人の力になりたい' },
  { id: 27, keyword: '変化',           description: 'いつもと違うことをするのが好き' },
  { id: 28, keyword: 'コツコツ',       description: '少しずつ続けるのが得意' },
  { id: 29, keyword: '公平',           description: 'みんなが公平にあつかわれるのが大事' },
  { id: 30, keyword: 'ユーモア',       description: 'おもしろいことを考えるのが好き' },
];

// ── 状態 ──
let pool = [];
let hand = [];
let selectedIndex = null;
let exchangeCount = 5;

// ── DOM ──
const screens = document.querySelectorAll('.screen');
const btnStart = document.getElementById('btn-start');
const btnHowto = document.getElementById('btn-howto-toggle');
const howtoPanel = document.getElementById('howto-panel');
const handArea = document.getElementById('hand-area');
const btnExchange = document.getElementById('btn-exchange');
const exchangeNum = document.getElementById('exchange-num');
const btnConfirm = document.getElementById('btn-confirm');
const rankingArea = document.getElementById('ranking-area');
const btnFinishRanking = document.getElementById('btn-finish-ranking');
const resultArea = document.getElementById('result-area');
const btnSaveImage = document.getElementById('btn-save-image');
const btnRestart = document.getElementById('btn-restart');
const btnQuitGame = document.getElementById('btn-quit-game');
const btnQuitRanking = document.getElementById('btn-quit-ranking');

// ── 画面遷移 ──
function showScreen(id) {
  screens.forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + id).classList.add('active');
}

// ── ゲーム開始 ──
function startGame() {
  pool = shuffle([...cardData]);
  hand = pool.splice(0, 5);
  selectedIndex = null;
  exchangeCount = 5;
  exchangeNum.textContent = exchangeCount;
  btnExchange.disabled = true;
  showScreen('game');
  renderHand();
}

// ── 手札描画 ──
function renderHand() {
  handArea.innerHTML = '';
  hand.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'vc-card';
    if (selectedIndex === i) el.classList.add('vc-card--selected');
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');

    el.innerHTML = `
      <span class="vc-card__number">${i + 1}</span>
      <div class="vc-card__body">
        <div class="vc-card__keyword">${escapeHtml(card.keyword)}</div>
        <div class="vc-card__desc">${escapeHtml(card.description)}</div>
      </div>
    `;

    const handleSelect = () => selectCard(i);
    el.addEventListener('click', handleSelect);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleSelect();
      }
    });

    handArea.appendChild(el);
  });
}

// ── カード選択 ──
function selectCard(index) {
  if (selectedIndex === index) {
    selectedIndex = null;
  } else {
    selectedIndex = index;
  }
  btnExchange.disabled = selectedIndex === null || exchangeCount <= 0;
  renderHand();
}

// ── カード交換（戻さない） ──
function exchangeCard() {
  if (selectedIndex === null || exchangeCount <= 0 || pool.length === 0) return;

  hand[selectedIndex] = pool.shift();
  exchangeCount--;
  selectedIndex = null;

  exchangeNum.textContent = exchangeCount;
  btnExchange.disabled = true;

  renderHand();

  if (exchangeCount <= 0) {
    btnExchange.disabled = true;
  }
}

// ── ランキング画面 ──
let sortableInstance = null;

function showRanking() {
  showScreen('ranking');
  renderRanking();

  sortableInstance = new Sortable(rankingArea, {
    animation: 150,
    ghostClass: 'sortable-ghost',
    chosenClass: 'sortable-chosen',
    onEnd: () => {
      syncHandFromRanking();
      renderRanking();
    },
  });
}

function renderRanking() {
  rankingArea.innerHTML = '';
  hand.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'vc-rank-item';
    el.dataset.cardId = card.id;

    el.innerHTML = `
      <span class="vc-rank-item__number">${i + 1}</span>
      <span class="vc-rank-item__keyword">${escapeHtml(card.keyword)}</span>
      <div class="vc-rank-item__arrows">
        <button aria-label="上へ移動" ${i === 0 ? 'disabled' : ''}>
          <span class="material-symbols-rounded" aria-hidden="true">keyboard_arrow_up</span>
        </button>
        <button aria-label="下へ移動" ${i === hand.length - 1 ? 'disabled' : ''}>
          <span class="material-symbols-rounded" aria-hidden="true">keyboard_arrow_down</span>
        </button>
      </div>
    `;

    const [btnUp, btnDown] = el.querySelectorAll('button');
    btnUp.addEventListener('click', (e) => {
      e.stopPropagation();
      moveCard(i, -1);
    });
    btnDown.addEventListener('click', (e) => {
      e.stopPropagation();
      moveCard(i, 1);
    });

    rankingArea.appendChild(el);
  });
}

function moveCard(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= hand.length) return;
  [hand[index], hand[newIndex]] = [hand[newIndex], hand[index]];
  renderRanking();
}

function syncHandFromRanking() {
  const items = rankingArea.querySelectorAll('.vc-rank-item');
  const newHand = [];
  items.forEach(item => {
    const id = parseInt(item.dataset.cardId, 10);
    const card = hand.find(c => c.id === id);
    if (card) newHand.push(card);
  });
  hand = newHand;
}

// ── 結果画面 ──
function showResult() {
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
  showScreen('result');
  renderResult();
}

function renderResult() {
  resultArea.innerHTML = '';
  hand.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'vc-result-item';
    el.dataset.cardId = card.id;

    el.innerHTML = `
      <div class="vc-result-item__top">
        <span class="vc-result-item__number">${i + 1}</span>
        <span class="vc-result-item__keyword">${escapeHtml(card.keyword)}</span>
      </div>
      <div class="vc-result-item__desc">${escapeHtml(card.description)}</div>
      <div class="vc-result-item__memo">
        <textarea placeholder="なんでこれが大事？" rows="2" maxlength="100"></textarea>
      </div>
    `;

    resultArea.appendChild(el);
  });
}

// ── 画像保存 ──
function saveImage() {
  const memos = [];
  resultArea.querySelectorAll('textarea').forEach(ta => {
    memos.push(ta.value.trim());
  });

  const container = document.createElement('div');
  container.style.cssText = `
    padding: 48px 40px;
    background: #F5F2EC;
    width: 560px;
    font-family: 'Noto Sans JP', sans-serif;
    border-radius: 16px;
    position: fixed;
    left: -9999px;
    top: 0;
  `;

  let cardsHtml = '';
  hand.forEach((card, i) => {
    const memo = memos[i] || '';
    cardsHtml += `
      <div style="
        background: #fff;
        border: 2px solid #C4D2D8;
        border-radius: 16px;
        padding: 16px 20px;
        margin-bottom: 12px;
      ">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="
            width:28px; height:28px; border-radius:50%;
            background:#2E7D8C; color:#fff;
            font-size:13px; font-weight:700;
            display:flex; align-items:center; justify-content:center;
            flex-shrink:0;
          ">${i + 1}</span>
          <span style="font-size:16px; font-weight:700; color:#1A1A1A;">
            ${escapeHtml(card.keyword)}
          </span>
        </div>
        <div style="font-size:13px; color:#5A6270; margin-top:4px; margin-left:40px;">
          ${escapeHtml(card.description)}
        </div>
        ${memo ? `
          <div style="
            margin-top:10px; margin-left:40px;
            font-size:13px; color:#1A1A1A;
            background:#F5F2EC; border-radius:8px;
            padding:8px 12px; line-height:1.5;
          ">${escapeHtml(memo)}</div>
        ` : ''}
      </div>
    `;
  });

  container.innerHTML = `
    <h2 style="
      text-align:center; font-size:22px; font-weight:700;
      color:#1C3F5E; margin:0 0 24px;
    ">わたしの「大事」</h2>
    ${cardsHtml}
    <p style="
      text-align:center; font-size:11px; color:#5A6270;
      margin-top:20px;
    ">バリューカード | roomK</p>
  `;

  document.body.appendChild(container);

  setTimeout(() => {
    html2canvas(container, {
      scale: 2,
      backgroundColor: '#F5F2EC',
      useCORS: true,
    }).then(canvas => {
      const link = document.createElement('a');
      link.download = 'value-card-result.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }).catch(() => {
      // キャプチャ失敗時は何もしない
    }).finally(() => {
      if (container.parentNode) container.parentNode.removeChild(container);
    });
  }, 300);
}

// ── イベントリスナー ──
btnStart.addEventListener('click', startGame);

btnHowto.addEventListener('click', () => {
  howtoPanel.classList.toggle('visible');
  btnHowto.textContent = howtoPanel.classList.contains('visible')
    ? 'あそびかたを閉じる' : 'あそびかた';
});

btnExchange.addEventListener('click', exchangeCard);
btnConfirm.addEventListener('click', showRanking);
btnFinishRanking.addEventListener('click', showResult);
btnSaveImage.addEventListener('click', saveImage);

// ── TOP へ戻る（中断・やり直し共通。sortable を後片付け） ──
function goToTop() {
  if (sortableInstance) {
    sortableInstance.destroy();
    sortableInstance = null;
  }
  showScreen('top');
  howtoPanel.classList.remove('visible');
  btnHowto.textContent = 'あそびかた';
}

btnRestart.addEventListener('click', goToTop);
btnQuitGame.addEventListener('click', goToTop);
btnQuitRanking.addEventListener('click', goToTop);
