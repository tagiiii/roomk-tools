// 興味スゴロク アプリロジック
import { shuffle, popIn, escapeHtml } from '../shared/js/utils.js';

const NUMBERS = ['①', '②', '③', '④', '⑤'];

// ── テーマ & 質問データ ──
const THEMES = {
  suki:    { label: '好きなもの',       icon: 'favorite' },
  yatte:   { label: 'やってみたい',     icon: 'rocket_launch' },
  moshimo: { label: 'もしも…',          tag: 'もしも', icon: 'auto_awesome' },
  jibun:   { label: '自分のこと',       icon: 'person' },
  saikin:  { label: '最近のこと',       icon: 'today' },
  tokui:   { label: '得意・チャレンジ', icon: 'star' },
};

// 質問は文字列 or { q, choices } 形式。choices がある場合は「自由に話す」が自動で追加される。
const QUESTIONS = {
  suki: [
    '最近ハマっているものは？', '好きな食べ物は？', '好きな動物は？',
    '好きな色はどれ？その色を選ぶ理由は？', '好きな音楽やアーティストは？',
    '好きなキャラクターは誰？', '好きなゲームやアプリは？',
    '好きなお菓子は？',
    '好きな乗り物は？',
    '最近「これ最高！」と思ったものは？', '好きな言葉やフレーズは？',
    '好きなYouTubeやチャンネルは？',
    { q: '好きな天気はどんなとき？', choices: ['晴れ', '雨', '雪'] },
    { q: '家の中でいちばん好きな場所はどこ？', choices: ['自分の部屋', 'リビング', 'ベッドの中'] },
    { q: '好きな季節はいつ？', choices: ['春・夏', '秋・冬', '全部好き'] },
    '好きなにおいは何？', '好きな果物は？', '好きな飲み物は？',
    '好きなパンやおにぎりの具は？', '好きなアイスの味は？',
    '好きな麺類はある？', '好きな漫画やアニメはある？',
    '好きな効果音やBGMはある？', '好きな文房具や持ち物はある？',
    '好きなお出かけ先はどこ？', '好きな虫や生き物はいる？',
    { q: '好きな味はどれ？', choices: ['あまい', 'しょっぱい', 'さっぱり'] },
    { q: '好きなスタイルは？', choices: ['ふわふわ', 'かっこいい', 'シンプル'] },
  ],
  yatte: [
    '行ってみたい場所はどこ？', '食べてみたい料理は？',
    'やってみたい遊びやスポーツは？', '作ってみたいものはある？',
    'いつか行ってみたい国は？', '体験してみたい仕事は？',
    '習ってみたいことは？', 'チャレンジしてみたい乗り物は？',
    '見てみたい景色はある？', '友達と一緒にやってみたいことは？',
    '1人でゆっくりやってみたいことは？', '今年やってみたいことは？',
    '自分で作ってみたいゲームはどんなゲーム？',
    '育ててみたい植物や生き物はある？', '集めてみたいものはある？',
    '挑戦してみたい料理はある？', '乗ってみたい乗り物はある？',
    '見てみたいお祭りやイベントは？', '会ってみたい人はいる？',
    '試してみたい遊びはある？', '撮ってみたい写真はある？',
    '作ってみたい秘密基地はどんなの？',
    '挑戦してみたい工作やものづくりは？',
    { q: '旅に出るならどこ？', choices: ['山', '海', '街'] },
    { q: 'やってみたいのは？', choices: ['アウトドア系', 'インドア系', 'クリエイティブ系'] },
  ],
  moshimo: [
    'もし空を飛べたら最初にどこへ行く？',
    'もし無人島に1つだけ持っていくなら何？',
    'もし宇宙人に会えたら何を話す？', 'もし自分の秘密基地を作れるならどんな場所？',
    'もし3つ願いが叶うとしたら何をお願いする？',
    'もし世界中どこでも瞬間移動できたらどこに行く？',
    'もし自分のロボットがいたら何をさせる？',
    'もし1週間なんでも食べ放題だったら何を食べる？',
    'もし自分の街を作れるとしたらどんな街？',
    { q: 'もし1日だけ動物になれるとしたら何になる？', choices: ['空を飛ぶ鳥', '海の生き物', '陸の動物'] },
    { q: 'もしタイムマシンがあったらどこへ？', choices: ['過去', '未来', '今がいいからどこにも行かない'] },
    { q: 'もし魔法が1つ使えたら何のために使う？', choices: ['自分のため', '誰かのため', '世界のため'] },
    { q: 'もし透明になれたら何をする？', choices: ['いたずらする', '探検する', 'のんびり観察する'] },
    'もし1日だけ大人になれたら何をする？',
    'もし好きなだけ寝られたら何時間寝る？',
    'もし自分の声を選べるならどんな声？',
    'もし1つだけ特技がもらえるなら何？',
    'もし宝の地図を見つけたらどうする？',
    'もし自分のテーマソングを作るならどんな曲？',
    'もし1日だけ身長を自由に変えられたらどうする？',
    'もし自分の星を持てるとしたらどんな星にする？',
    { q: 'もし冒険に出るとしたら？', choices: ['1人で', '友達と', 'ペットや相棒と'] },
    { q: 'もし動物と話せるなら最初にどの動物？', choices: ['犬や猫', '鳥', '虫や魚'] },
    { q: 'もし空を飛べるなら何で飛ぶ？', choices: ['自分のつばさ', '乗り物', '魔法'] },
  ],
  jibun: [
    '自分のここが好き、と思えるところはある？',
    '自分をひとつの食べ物にたとえると何？',
    '元気がないときに自分を元気にする方法は？',
    '自分ってどんな人だと思う？一言で！',
    '大切にしているものはある？',
    'ちょっとこだわっていることはある？',
    { q: '朝型？夜型？', choices: ['朝型', '夜型', 'その時による'] },
    { q: '一人でいるのと誰かといるの、どっちが落ち着く？', choices: ['一人', '誰かと', 'どっちも好き'] },
    { q: 'のんびり派？動き回る派？', choices: ['のんびり', '動き回る', '気分次第'] },
    { q: '料理するのと食べるの、どっちが好き？', choices: ['作る', '食べる', 'どっちも'] },
    { q: '1日のうちでいちばん好きな時間帯は？', choices: ['朝', '昼', '夜'] },
    { q: 'ゲームは一人プレイ派？みんなでプレイ派？', choices: ['一人プレイ', 'みんなでプレイ', 'どっちも'] },
    '笑いのツボはどんなとこ？', 'どんなときに「これ楽しい！」ってなる？',
    'どんな音が好き？', '疲れた時どうやって休む？',
    'ちょっと自慢できることはある？', '片付けは得意？苦手？',
    '自分のラッキーカラーを決めるなら何色？',
    '好きなにおいや空気感はある？',
    { q: '出かけるなら？', choices: ['にぎやかな場所', 'しずかな場所', 'どちらも気分次第'] },
    { q: '遊ぶなら？', choices: ['外で体を動かす', '家でゆっくり', '何か作る'] },
    { q: '話すのは？', choices: ['得意', 'ちょっと苦手', '人による'] },
    { q: '自分はどっち？', choices: ['計画立てる派', 'その場で決める派', '半々'] },
  ],
  saikin: [
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
    { q: '今日はどんな気分？', choices: ['げんき', 'ふつう', 'ちょっとしずか'] },
    '最近見つけたお気に入りの場所は？', '最近「きれい」と思ったものは？',
    '最近じっくり見たものは？', '最近ちょっとがんばったことは？',
    '最近ゆっくりできた時間はある？',
    '最近なんとなく気になっているものは？',
    '最近おもしろかった発見は？',
    '最近ちょっとした幸せを感じたのはどんなとき？',
    '最近心があったかくなったことは？',
    { q: '今週のコンディションは？', choices: ['絶好調', 'ふつう', 'ちょっとお休み中'] },
  ],
  tokui: [
    '自分の特技は何だと思う？',
    'もっとうまくなりたいことはある？',
    '人に教えてあげられそうなことは？',
    'ちょっと自信があることは何？',
    'コツをつかんだ！と思った瞬間は？',
    'やる前は苦手だったけど好きになったものはある？',
    '自分だけの工夫やこだわりはある？',
    '続けていることはある？',
    'ひとつだけなんでもマスターできるなら何にする？',
    { q: '集中できるのはどんなとき？', choices: ['静かな場所', '音楽を聴きながら', '誰かがそばにいるとき'] },
    '人に褒められたことで覚えていることは？',
    'これなら誰にも負けない、というものはある？',
    'やっていて時間を忘れることは？',
    '最初は苦手でも続けていたら変わったことはある？',
    '誰かに頼られたことはある？どんなとき？',
    '自分なりの工夫やちょっとしたコツはある？',
    'これから伸ばしてみたい力はある？',
    '自分で「ここ成長したな」って思うところは？',
    { q: '新しいことをやるときは？', choices: ['すぐ試す派', 'じっくり考える派', '様子を見る派'] },
  ],
};

// 質問を { q, choices } 形式に正規化
function normalizeQ(item) {
  return typeof item === 'string' ? { q: item, choices: null } : item;
}

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
const settings = { playerCount: 2, totalSquares: 15 };

function buildToggle(containerId, options, selectedValue, onChange) {
  const el = $(containerId);
  el.innerHTML = '';
  options.forEach(({ value, label }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ks-toggle__btn';
    btn.dataset.value = value;
    btn.setAttribute('role', 'radio');
    btn.textContent = label;
    if (value === selectedValue) {
      btn.classList.add('is-selected');
      btn.setAttribute('aria-checked', 'true');
    }
    btn.addEventListener('click', () => {
      el.querySelectorAll('.ks-toggle__btn').forEach((b) => {
        b.classList.remove('is-selected');
        b.setAttribute('aria-checked', 'false');
      });
      btn.classList.add('is-selected');
      btn.setAttribute('aria-checked', 'true');
      onChange(value);
    });
    el.appendChild(btn);
  });
}

function initSettings() {
  buildToggle('player-count',
    [1, 2, 3, 4].map((n) => ({ value: n, label: `${n}人` })),
    settings.playerCount,
    (v) => { settings.playerCount = v; }
  );
  buildToggle('square-count',
    [10, 15, 20].map((n) => ({ value: n, label: `${n}マス` })),
    settings.totalSquares,
    (v) => { settings.totalSquares = v; }
  );

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
  const themes = Array.from(document.querySelectorAll('#theme-list input:checked'))
    .map((cb) => cb.value);
  if (themes.length < 2) {
    showError('テーマを2つ以上選んでね。');
    return;
  }

  const players = [];
  for (let i = 0; i < settings.playerCount; i++) {
    players.push({ name: `プレイヤー${i + 1}`, pos: 0 });
  }

  state.players = players;
  state.currentIndex = 0;
  state.totalSquares = settings.totalSquares;
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

  // ボード（蛇行レイアウト・5列グリッド）
  const board = $('board');
  const COLS = 5;
  const rows = Math.ceil(state.totalSquares / COLS);
  board.style.setProperty('--ks-rows', rows);
  board.innerHTML = '';
  for (let i = 0; i < state.totalSquares; i++) {
    const row = Math.floor(i / COLS);
    const colInRow = i % COLS;
    // 偶数段（0,2,…）は左→右、奇数段は右→左
    const col = row % 2 === 0 ? colInRow : (COLS - 1 - colInRow);

    const sq = document.createElement('div');
    const isGoal = i === state.totalSquares - 1;
    sq.className = 'ks-square' + (isGoal ? ' is-goal' : '') + (i === 0 ? ' is-start' : '');
    sq.style.gridRow = row + 1;
    sq.style.gridColumn = col + 1;

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
  return normalizeQ(state.pools[theme].shift());
}

function renderModalContent() {
  const { theme, question } = state.currentQ;
  const t = THEMES[theme];
  const player = state.players[state.currentIndex];

  $('modal-theme').innerHTML =
    `<span class="material-symbols-rounded">${t.icon}</span> ${t.label}`;
  $('modal-player').textContent = `${player.name} さんへ`;
  $('modal-question').textContent = question.q;

  const choicesEl = $('modal-choices');
  choicesEl.innerHTML = '';
  if (question.choices && question.choices.length) {
    question.choices.forEach((c, i) => {
      const btn = document.createElement('button');
      btn.className = 'ks-choice';
      btn.innerHTML = `<span class="ks-choice__num">${NUMBERS[i]}</span><span class="ks-choice__text">${escapeHtml(c)}</span>`;
      btn.addEventListener('click', closeQuestionAndAdvance);
      choicesEl.appendChild(btn);
    });
    const free = document.createElement('button');
    free.className = 'ks-choice ks-choice--free';
    free.innerHTML = '<span class="material-symbols-rounded">chat</span>自由に話す';
    free.addEventListener('click', closeQuestionAndAdvance);
    choicesEl.appendChild(free);
    // 選択肢がある場合は「話せた！次の人へ」ボタンは不要
    $('btn-next').style.display = 'none';
  } else {
    $('btn-next').style.display = '';
  }
}

function showQuestion() {
  const theme = pickTheme();
  const question = pickQuestion(theme);
  state.currentQ = { theme, question };
  renderModalContent();

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
  state.currentQ = { theme, question: pickQuestion(theme) };
  renderModalContent();
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
