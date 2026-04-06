// 興味スゴロク アプリロジック
import { shuffle, popIn, escapeHtml } from '../shared/js/utils.js';

// ── テーマ & 質問データ ──
const THEMES = {
  suki:    { label: '好きなもの',       icon: 'favorite' },
  yatte:   { label: 'やってみたい',     icon: 'rocket_launch' },
  moshimo: { label: 'もしも…',          tag: 'もしも', icon: 'auto_awesome' },
  jibun:   { label: '自分のこと',       icon: 'person' },
  saikin:  { label: '最近のこと',       icon: 'today' },
  tokui:   { label: '得意・チャレンジ', icon: 'star' },
};

const QUESTIONS = {
  suki: [
    '最近ハマっているものは？', '好きな食べ物は？', '好きな動物は？',
    '好きな色はどれ？その色を選ぶ理由は？', '好きな音楽やアーティストは？',
    '好きなキャラクターは誰？', '好きなゲームやアプリは？',
    '好きな季節はいつ？', '好きなお菓子は？', '家の中でいちばん好きな場所は？',
    '好きな乗り物は？', '好きな天気はどんなとき？',
    '最近「これ最高！」と思ったものは？', '好きな言葉やフレーズは？',
    '好きなYouTubeやチャンネルは？',
  ],
  yatte: [
    '行ってみたい場所はどこ？', '食べてみたい料理は？',
    'やってみたい遊びやスポーツは？', '作ってみたいものはある？',
    'いつか行ってみたい国は？', '体験してみたい仕事は？',
    '習ってみたいことは？', 'チャレンジしてみたい乗り物は？',
    '見てみたい景色はある？', '友達と一緒にやってみたいことは？',
    '1人でゆっくりやってみたいことは？', '今年やってみたいことは？',
    '自分で作ってみたいゲームはどんなゲーム？',
  ],
  moshimo: [
    'もし魔法が1つ使えたら何をする？', 'もし1日だけ動物になれるとしたら何になる？',
    'もし空を飛べたら最初にどこへ行く？', 'もしタイムマシンがあったら過去・未来どっち？',
    'もし透明になれたら何をする？', 'もし無人島に1つだけ持っていくなら何？',
    'もし宇宙人に会えたら何を話す？', 'もし自分の秘密基地を作れるならどんな場所？',
    'もし3つ願いが叶うとしたら何をお願いする？',
    'もし世界中どこでも瞬間移動できたらどこに行く？',
    'もし自分のロボットがいたら何をさせる？',
    'もし1週間なんでも食べ放題だったら何を食べる？',
    'もし自分の街を作れるとしたらどんな街？',
  ],
  jibun: [
    '朝型？夜型？', '一人でいるのと誰かといるの、どっちが落ち着く？',
    '自分のここが好き、と思えるところはある？',
    '自分をひとつの食べ物にたとえると何？',
    'のんびり派？動き回る派？',
    '料理するのと食べるの、どっちが好き？',
    '1日のうちでいちばん好きな時間帯は？',
    '元気がないときに自分を元気にする方法は？',
    '自分ってどんな人だと思う？一言で！',
    'ゲームは一人プレイ派？みんなでプレイ派？',
    '大切にしているものはある？',
    'ちょっとこだわっていることはある？',
  ],
  saikin: [
    '今日はどんな気分？一言でいうと？',
    '最近ちょっと笑ったことは？',
    '最近うれしかったことは？',
    '最近「おいしい！」と思ったものは？',
    '最近見た夢で覚えているものはある？',
    '最近はまっているおやつは？',
    '最近お気に入りの動画や曲は？',
    '最近誰かに「ありがとう」って思ったことは？',
    '最近新しく知ったことは？',
    '最近ちょっとした発見はあった？',
    '最近やってみた新しいことは？',
    '今いちばん楽しみにしていることは？',
  ],
  tokui: [
    '自分の特技は何だと思う？',
    'もっとうまくなりたいことはある？',
    '人に教えてあげられそうなことは？',
    'ちょっと自信があることは何？',
    'コツをつかんだ！と思った瞬間は？',
    'やる前は苦手だったけど好きになったものはある？',
    '集中できるのはどんなとき？',
    '自分だけの工夫やこだわりはある？',
    '続けていることはある？',
    'ひとつだけなんでもマスターできるなら何にする？',
  ],
};

// ── 状態 ──
const state = {
  players: [],
  currentIndex: 0,
  totalSquares: 15,
  themes: [],
  rolling: false,
  ended: false,
  history: [],
  pools: {},
  currentQ: null,
  diceTimer: null,
  moveTimer: null,
};

function clearTimers() {
  if (state.diceTimer) { clearInterval(state.diceTimer); state.diceTimer = null; }
  if (state.moveTimer) { clearTimeout(state.moveTimer); state.moveTimer = null; }
}

// ── DOM ──
const $ = (id) => document.getElementById(id);

// ── 設定画面 ──
function initSettings() {
  const countSel = $('player-count');
  const namesDiv = $('player-names');
  const updateNames = () => {
    const n = Number(countSel.value);
    namesDiv.innerHTML = '';
    for (let i = 1; i <= n; i++) {
      const row = document.createElement('div');
      row.className = 'ks-name-row';
      row.innerHTML = `
        <span class="ks-pawn ks-pawn--${i - 1}">${i}</span>
        <input type="text" class="ks-input" maxlength="8"
               placeholder="プレイヤー${i}" data-idx="${i - 1}">
      `;
      namesDiv.appendChild(row);
    }
  };
  countSel.addEventListener('change', updateNames);
  updateNames();

  const themeList = $('theme-list');
  Object.entries(THEMES).forEach(([key, t]) => {
    const label = document.createElement('label');
    label.className = 'ks-theme';
    label.innerHTML = `
      <input type="checkbox" value="${key}" checked>
      <span class="ks-theme__box">
        <span class="material-symbols-rounded">${t.icon}</span>
        ${t.label}
      </span>
    `;
    themeList.appendChild(label);
  });

  $('btn-start').addEventListener('click', startGame);
}

function showError(msg) {
  const el = $('settings-error');
  el.textContent = msg;
  el.classList.add('visible');
}
function clearError() { $('settings-error').classList.remove('visible'); }

function startGame() {
  clearError();
  const count = Number($('player-count').value);
  const players = [];
  const inputs = document.querySelectorAll('#player-names .ks-input');
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const name = (inputs[i].value || '').trim();
    if (!name) {
      showError('名前を入力してね。');
      return;
    }
    if (name.length > 8) {
      showError('名前は8文字までにしてね。');
      return;
    }
    if (seen.has(name)) {
      showError('同じ名前の人がいます。名前を変えてね。');
      return;
    }
    seen.add(name);
    players.push({ name, pos: 0 });
  }

  const themes = Array.from(document.querySelectorAll('#theme-list input:checked'))
    .map((cb) => cb.value);
  if (themes.length < 2) {
    showError('テーマを2つ以上選んでね。');
    return;
  }

  state.players = players;
  state.currentIndex = 0;
  state.totalSquares = Number($('square-count').value);
  state.themes = themes;
  state.rolling = false;
  state.ended = false;
  state.history = [];
  state.pools = {};
  themes.forEach((t) => { state.pools[t] = shuffle(QUESTIONS[t]); });

  $('screen-settings').style.display = 'none';
  $('screen-game').style.display = 'block';
  renderGame();
}

// ── ゲーム画面 ──
function renderGame() {
  // インジケーター
  const ind = $('indicator');
  ind.innerHTML = state.players.map((p, i) => `
    <span class="ks-player-label ks-pawn--${i}${i === state.currentIndex ? ' is-current' : ''}">
      <span class="ks-pawn ks-pawn--${i}">${i + 1}</span>
      ${escapeHtml(p.name)}
    </span>
  `).join('');

  // ボード
  const board = $('board');
  board.innerHTML = '';
  for (let i = 0; i < state.totalSquares; i++) {
    const sq = document.createElement('div');
    const isGoal = i === state.totalSquares - 1;
    sq.className = 'ks-square' + (isGoal ? ' is-goal' : '') + (i === 0 ? ' is-start' : '');
    const pawns = state.players
      .map((p, idx) => p.pos === i
        ? `<span class="ks-pawn ks-pawn--${idx}">${idx + 1}</span>` : '')
      .filter(Boolean).join('');
    sq.innerHTML = `
      <span class="ks-square__num">${isGoal ? 'G' : i === 0 ? 'S' : i}</span>
      <span class="ks-square__pawns">${pawns}</span>
    `;
    board.appendChild(sq);
  }

  $('btn-roll').disabled = state.rolling || state.ended;
}

// ── サイコロ ──
function rollDice() {
  if (state.rolling || state.ended) return;
  state.rolling = true;
  renderGame();
  const diceEl = $('dice');
  let ticks = 0;
  state.diceTimer = setInterval(() => {
    diceEl.textContent = Math.floor(Math.random() * 6) + 1;
    if (++ticks >= 10) {
      clearInterval(state.diceTimer);
      state.diceTimer = null;
      const n = Math.floor(Math.random() * 6) + 1;
      diceEl.textContent = n;
      movePawn(n);
    }
  }, 60);
}

function movePawn(steps) {
  const player = state.players[state.currentIndex];
  const max = state.totalSquares - 1;
  let remaining = steps;
  const step = () => {
    if (remaining <= 0 || player.pos >= max) {
      if (player.pos >= max) {
        state.ended = true;
        renderGame();
        showGoal(player);
        return;
      }
      showQuestion();
      return;
    }
    player.pos++;
    remaining--;
    renderGame();
    state.moveTimer = setTimeout(step, 250);
  };
  step();
}

// ── 質問モーダル ──
function pickTheme() {
  const themes = state.themes;
  const last = state.history[state.history.length - 1]?.theme;
  const pool = themes.length > 1 ? themes.filter((t) => t !== last) : themes;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickQuestion(theme) {
  if (!state.pools[theme] || state.pools[theme].length === 0) {
    state.pools[theme] = shuffle(QUESTIONS[theme]);
  }
  return state.pools[theme].shift();
}

function showQuestion() {
  const theme = pickTheme();
  const question = pickQuestion(theme);
  const player = state.players[state.currentIndex];
  state.currentQ = { theme, question };

  const t = THEMES[theme];
  $('modal-theme').innerHTML =
    `<span class="material-symbols-rounded">${t.icon}</span> ${t.label}`;
  $('modal-player').textContent = `${player.name} さんへ`;
  $('modal-question').textContent = question;

  const modal = $('modal');
  modal.style.display = 'flex';
  popIn(modal.querySelector('.ks-modal'));
}

function closeQuestionAndAdvance() {
  state.history.push(state.currentQ);
  $('modal').style.display = 'none';
  state.currentIndex = (state.currentIndex + 1) % state.players.length;
  state.rolling = false;
  $('dice').textContent = '?';
  renderGame();
}

function skipQuestion() {
  // 別の質問を出す（テーマは維持）
  const theme = state.currentQ.theme;
  const question = pickQuestion(theme);
  state.currentQ.question = question;
  $('modal-question').textContent = question;
  popIn($('modal').querySelector('.ks-modal'));
}

// ── ゴール ──
function showGoal(winner) {
  $('goal-name').textContent = `${winner.name} さん、おめでとう！`;
  const m = $('goal-modal');
  m.style.display = 'flex';
  popIn(m.querySelector('.ks-modal'));
}

function restart() {
  clearTimers();
  state.rolling = false;
  state.ended = false;
  $('modal').style.display = 'none';
  $('goal-modal').style.display = 'none';
  $('screen-game').style.display = 'none';
  $('screen-settings').style.display = 'block';
}

// ── イベント ──
initSettings();
$('btn-roll').addEventListener('click', rollDice);
$('btn-next').addEventListener('click', closeQuestionAndAdvance);
$('btn-skip').addEventListener('click', skipQuestion);
$('btn-restart').addEventListener('click', restart);
$('btn-back').addEventListener('click', () => {
  if (confirm('ゲームを終わって設定に戻りますか？')) restart();
});
