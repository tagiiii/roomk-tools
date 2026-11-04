// 興味スゴロク アプリロジック
// 遊び方は2つ: 1台の画面（メンターが押す・ゲームの通信はしない）と、ルーム（各自の端末・Realtime Database）。
// ルームの決まりは logic.js。質問はテーマのキーと QUESTIONS の中の番号で共有するので、
// QUESTIONS は並べ替え・途中の削除をしない（足すのは末尾だけ）。
import { shuffle, popIn } from '../shared/js/utils.js';
import * as L from './logic.js?v=20261104d';

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

const COUNTS = Object.fromEntries(Object.entries(QUESTIONS).map(([key, list]) => [key, list.length]));

// 質問を { q, choices } 形式に正規化
function normalizeQ(item) {
  return typeof item === 'string' ? { q: item, choices: null } : item;
}

// ── DOM ──
const $ = (id) => document.getElementById(id);

function makeElement(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

function msIcon(name) {
  const node = makeElement('span', 'material-symbols-rounded', name);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function toast(message, isError = true) {
  RoomkRTDB.showToast(message, isError);
}

const SCREENS = ['top', 'settings', 'create', 'join', 'waiting', 'game'];
function showScreen(name) {
  SCREENS.forEach((s) => { $('screen-' + s).hidden = s !== name; });
  // 説明の1行はトップだけ（ほかの画面では盤や質問を上に寄せる）
  $('headerSub').hidden = name !== 'top';
}

// ── 盤とコマ（1台の画面・ルーム共通） ──
// items: [{ name, current, tags: [文字] }]
function renderIndicator(items) {
  const ind = $('indicator');
  ind.replaceChildren();
  items.forEach((p, i) => {
    const label = makeElement('span', `ks-player-label ks-pawn--${i}${p.current ? ' is-current' : ''}`);
    label.appendChild(makeElement('span', `ks-pawn ks-pawn--${i}`, i + 1));
    label.appendChild(makeElement('span', 'ks-player-label__name', p.name));
    (p.tags || []).forEach((tag) => label.appendChild(makeElement('span', 'ks-tag', tag)));
    ind.appendChild(label);
  });
}

// 蛇行レイアウト・5列グリッド。positions はプレイヤー順のマスの番号
function renderBoard(total, positions) {
  const board = $('board');
  const COLS = 5;
  const rows = Math.ceil(total / COLS);
  board.style.setProperty('--ks-rows', rows);
  board.replaceChildren();
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / COLS);
    const colInRow = i % COLS;
    // 偶数段（0,2,…）は左→右、奇数段は右→左
    const col = row % 2 === 0 ? colInRow : (COLS - 1 - colInRow);
    const isGoal = i === total - 1;
    const sq = makeElement('div', 'ks-square' + (isGoal ? ' is-goal' : '') + (i === 0 ? ' is-start' : ''));
    sq.style.gridRow = row + 1;
    sq.style.gridColumn = col + 1;
    sq.appendChild(makeElement('span', 'ks-square__num', isGoal ? 'G' : i === 0 ? 'S' : i));
    const pawns = makeElement('span', 'ks-square__pawns');
    positions.forEach((pos, idx) => {
      if (pos === i) pawns.appendChild(makeElement('span', `ks-pawn ks-pawn--${idx}`, idx + 1));
    });
    sq.appendChild(pawns);
    board.appendChild(sq);
  }
}

// 質問のカード。1台の画面ではモーダルの中、ルームでは画面の中（#roomStage）に置く
// opts: { playerIndex, dice, canPress, onChoose, showNext, showSkip, waitText }
function fillQuestion(themeKey, item, playerName, opts) {
  const t = THEMES[themeKey];
  $('modal-theme').replaceChildren(msIcon(t.icon), document.createTextNode(' ' + t.label));
  // 宛先は、その人のコマの色の番号を添えて出す（盤のコマと見比べられるように）
  $('modal-player').replaceChildren(
    makeElement('span', `ks-pawn ks-pawn--${opts.playerIndex}`, opts.playerIndex + 1),
    document.createTextNode(`${playerName} さんへ`),
  );
  // ルームでは、サイコロの出た目をカードに出す（サイコロの欄は質問の間かくす）
  $('modal-dice').hidden = !opts.dice;
  $('modal-dice').replaceChildren(msIcon('casino'), document.createTextNode(opts.dice ? ` ${opts.dice}` : ''));
  $('modal-question').textContent = item.q;

  const choicesEl = $('modal-choices');
  choicesEl.replaceChildren();
  if (item.choices && item.choices.length) {
    item.choices.forEach((c, i) => {
      const btn = makeElement('button', 'ks-choice');
      btn.type = 'button';
      btn.appendChild(makeElement('span', 'ks-choice__num', NUMBERS[i]));
      btn.appendChild(makeElement('span', 'ks-choice__text', c));
      btn.disabled = !opts.canPress;
      btn.addEventListener('click', () => opts.onChoose(i));
      choicesEl.appendChild(btn);
    });
    const free = makeElement('button', 'ks-choice ks-choice--free');
    free.type = 'button';
    free.append(msIcon('chat'), document.createTextNode('自由に話す'));
    free.disabled = !opts.canPress;
    free.addEventListener('click', () => opts.onChoose(L.CHOICE_FREE));
    choicesEl.appendChild(free);
  }
  $('btn-next').style.display = opts.showNext ? '' : 'none';
  $('btn-skip').style.display = opts.showSkip ? '' : 'none';
  $('modal-actions').hidden = !opts.showNext && !opts.showSkip;
  $('modal-wait').hidden = !opts.waitText;
  $('modal-wait').textContent = opts.waitText || '';
}

// 前の人が選んだもの。選ぶと次の人の番になり、次にサイコロが振られるまで盤の上に出す
// pick: { playerIndex, name, item, choice } または null
function renderPick(pick) {
  $('lastPick').hidden = !pick;
  if (!pick) return;
  $('pickWho').replaceChildren(
    makeElement('span', `ks-pawn ks-pawn--${pick.playerIndex}`, pick.playerIndex + 1),
    document.createTextNode(`${pick.name} さんが選んだもの`),
  );
  $('pickQ').textContent = pick.item.q;
  const label = pick.choice === L.CHOICE_FREE ? '自由に話す' : (pick.item.choices?.[pick.choice] ?? '');
  $('pickA').replaceChildren(msIcon(pick.choice === L.CHOICE_FREE ? 'chat' : 'check_circle'), document.createTextNode(label));
}

const CHOICE_HINT = '選ぶと、次の人の番になるよ';

// 質問とゴールのカードを、1台の画面ではモーダルに、ルームでは画面の中に置く
function placeCards(inRoom) {
  if (inRoom) {
    $('roomStage').append($('questionCard'), $('goalCard'));
  } else {
    $('modal').appendChild($('questionCard'));
    $('goal-modal').appendChild($('goalCard'));
    $('questionCard').hidden = false;
    $('goalCard').hidden = false;
  }
}

/* ════════════ 1台の画面（メンターが押す。通信しない） ════════════ */

const local = {
  players: [],
  currentIndex: 0,
  totalSquares: 15,
  themes: [],
  rolling: false,
  ended: false,
  history: [],
  pools: {},
  currentQ: null,
  lastPick: null,
  diceTimer: null,
  moveTimer: null,
};

function clearTimers() {
  if (local.diceTimer) { clearInterval(local.diceTimer); local.diceTimer = null; }
  if (local.moveTimer) { clearTimeout(local.moveTimer); local.moveTimer = null; }
}

const settings = { playerCount: 2, totalSquares: 15, names: Array(L.MAX_PLAYERS).fill('') };

function buildToggle(containerId, options, selectedValue, onChange) {
  const el = $(containerId);
  el.replaceChildren();
  options.forEach(({ value, label }) => {
    const btn = makeElement('button', 'ks-toggle__btn', label);
    btn.type = 'button';
    btn.dataset.value = value;
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(value === selectedValue));
    if (value === selectedValue) btn.classList.add('is-selected');
    btn.addEventListener('click', () => {
      selectToggle(el, value);
      onChange(value);
    });
    el.appendChild(btn);
  });
}

function selectToggle(el, value) {
  el.querySelectorAll('.ks-toggle__btn').forEach((b) => {
    const on = String(b.dataset.value) === String(value);
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-checked', String(on));
  });
}

// テーマのチェックボックス（1台の画面の設定と、ルームの待合室）
function buildThemeList(containerId, onChange) {
  const list = $(containerId);
  list.replaceChildren();
  Object.entries(THEMES).forEach(([key, t]) => {
    const label = makeElement('label', 'ks-theme');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = key;
    input.checked = true;
    if (onChange) input.addEventListener('change', () => onChange(input));
    const box = makeElement('span', 'ks-theme__box');
    box.append(msIcon(t.icon), document.createTextNode(t.label));
    label.append(input, box);
    list.appendChild(label);
  });
}

// 名前欄（任意）。人数を変えても入れた名前は残す
function renderNameInputs() {
  const el = $('player-names');
  el.innerHTML = '';
  for (let i = 0; i < settings.playerCount; i++) {
    const row = document.createElement('label');
    row.className = 'ks-name';
    const pawn = document.createElement('span');
    pawn.className = `ks-pawn ks-pawn--${i}`;
    pawn.textContent = i + 1;
    row.appendChild(pawn);
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-input ks-name__input';
    input.maxLength = L.NAME_MAX;
    input.autocomplete = 'off';
    input.placeholder = `プレイヤー${i + 1}`;
    input.setAttribute('aria-label', `${i + 1}人目の名前`);
    input.value = settings.names[i];
    input.addEventListener('input', () => { settings.names[i] = input.value; });
    row.appendChild(input);
    el.appendChild(row);
  }
}

function initSettings() {
  buildToggle('player-count',
    Array.from({ length: L.MAX_PLAYERS }, (_, i) => i + 1).map((n) => ({ value: n, label: `${n}人` })),
    settings.playerCount,
    (v) => { settings.playerCount = v; renderNameInputs(); }
  );
  renderNameInputs();
  buildToggle('square-count',
    L.SQUARE_OPTIONS.map((n) => ({ value: n, label: `${n}マス` })),
    settings.totalSquares,
    (v) => { settings.totalSquares = v; }
  );
  buildThemeList('theme-list');
  $('btn-start').addEventListener('click', startLocalGame);
}

function showError(msg) {
  const el = $('settings-error');
  el.textContent = msg;
  el.classList.add('visible');
}
function clearError() { $('settings-error').classList.remove('visible'); }

function startLocalGame() {
  clearError();
  const themes = Array.from(document.querySelectorAll('#theme-list input:checked'))
    .map((cb) => cb.value);
  if (themes.length < L.MIN_THEMES) {
    showError('テーマを2つ以上選んでね。');
    return;
  }

  const players = [];
  for (let i = 0; i < settings.playerCount; i++) {
    const name = settings.names[i].trim().slice(0, L.NAME_MAX);
    players.push({ name: name || `プレイヤー${i + 1}`, pos: 0 });
  }

  local.players = players;
  local.currentIndex = 0;
  local.totalSquares = settings.totalSquares;
  local.themes = themes;
  local.rolling = false;
  local.ended = false;
  local.history = [];
  local.lastPick = null;
  local.pools = {};
  themes.forEach((t) => { local.pools[t] = shuffle(QUESTIONS[t]); });

  window.RoomkStats?.count('start-local');
  showScreen('game');
  $('btn-back').hidden = false;
  $('btnRoomBack').hidden = true;
  $('roomStage').hidden = true;
  $('btn-roll').hidden = false;
  renderLocalGame();
}

function renderLocalGame() {
  renderIndicator(local.players.map((p, i) => ({ name: p.name, current: i === local.currentIndex })));
  // だれの番かを1行で（ルームと同じ）
  const name = local.players[local.currentIndex].name;
  $('turnNote').hidden = local.ended;
  $('turnNote').textContent = local.rolling ? `${name}さんがサイコロを振ったよ` : `${name}さんの番だよ`;
  renderPick(local.lastPick);
  renderBoard(local.totalSquares, local.players.map((p) => p.pos));
  $('btn-roll').disabled = local.rolling || local.ended;
}

function rollLocalDice() {
  if (local.rolling || local.ended) return;
  local.rolling = true;
  local.lastPick = null; // 前の人が選んだものは、次のサイコロで消す
  renderLocalGame();
  const diceEl = $('dice');
  let ticks = 0;
  local.diceTimer = setInterval(() => {
    diceEl.textContent = Math.floor(Math.random() * 6) + 1;
    if (++ticks >= 10) {
      clearInterval(local.diceTimer);
      local.diceTimer = null;
      const n = Math.floor(Math.random() * 6) + 1;
      diceEl.textContent = n;
      moveLocalPawn(n);
    }
  }, 60);
}

function moveLocalPawn(steps) {
  const player = local.players[local.currentIndex];
  const max = local.totalSquares - 1;
  let remaining = steps;
  const step = () => {
    if (remaining <= 0 || player.pos >= max) {
      if (player.pos >= max) {
        local.ended = true;
        renderLocalGame();
        showLocalGoal(player);
        return;
      }
      showLocalQuestion();
      return;
    }
    player.pos++;
    remaining--;
    renderLocalGame();
    local.moveTimer = setTimeout(step, 250);
  };
  step();
}

function pickLocalTheme() {
  const themes = local.themes;
  const last = local.history[local.history.length - 1]?.theme;
  const pool = themes.length > 1 ? themes.filter((t) => t !== last) : themes;
  return pool[Math.floor(Math.random() * pool.length)];
}

function pickLocalQuestion(theme) {
  if (!local.pools[theme] || local.pools[theme].length === 0) {
    local.pools[theme] = shuffle(QUESTIONS[theme]);
  }
  return normalizeQ(local.pools[theme].shift());
}

function renderLocalModal() {
  const { theme, question } = local.currentQ;
  const player = local.players[local.currentIndex];
  const hasChoices = !!(question.choices && question.choices.length);
  // 選択肢がある場合は、選ぶと次の人の番になる（選んだものは盤の上に残る。「話せた！次の人へ」は出さない）
  fillQuestion(theme, question, player.name, {
    playerIndex: local.currentIndex,
    dice: null,
    canPress: true,
    onChoose: chooseLocal,
    showNext: !hasChoices,
    showSkip: true,
    waitText: hasChoices ? CHOICE_HINT : '',
  });
}

function showLocalQuestion() {
  const theme = pickLocalTheme();
  const question = pickLocalQuestion(theme);
  local.currentQ = { theme, question };
  renderLocalModal();

  const modal = $('modal');
  modal.style.display = 'flex';
  popIn($('questionCard'));
}

function chooseLocal(choice) {
  const player = local.players[local.currentIndex];
  local.lastPick = { playerIndex: local.currentIndex, name: player.name, item: local.currentQ.question, choice };
  closeLocalQuestion();
}

function closeLocalQuestion() {
  local.history.push(local.currentQ);
  $('modal').style.display = 'none';
  local.currentIndex = (local.currentIndex + 1) % local.players.length;
  local.rolling = false;
  $('dice').textContent = '?';
  renderLocalGame();
}

function skipLocalQuestion() {
  // 別の質問を出す（テーマは維持）
  const theme = local.currentQ.theme;
  local.currentQ = { theme, question: pickLocalQuestion(theme) };
  renderLocalModal();
  popIn($('questionCard'));
}

function showLocalGoal(winner) {
  $('goal-name').textContent = `${winner.name} さん、おめでとう！`;
  $('goal-wait').hidden = true;
  $('btn-restart').hidden = false;
  $('btnGoalSettings').hidden = false;
  const m = $('goal-modal');
  m.style.display = 'flex';
  popIn($('goalCard'));
}

function resetLocal() {
  clearTimers();
  local.rolling = false;
  local.ended = false;
  local.lastPick = null;
  $('modal').style.display = 'none';
  $('goal-modal').style.display = 'none';
  $('dice').textContent = '?';
}

// 設定に戻る（人数・名前・マス数・テーマは残る）
function backToLocalSettings() {
  resetLocal();
  renderPick(null);
  $('turnNote').hidden = true;
  showScreen('settings');
}

// ゴールのあと「もう一度あそぶ」: 同じ設定ですぐはじめる
function playAgainLocal() {
  resetLocal();
  startLocalGame();
}

/* ════════════ ルーム（各自の端末。Realtime Database） ════════════ */

const DB_PREFIX = 'kyoumisugoroku_rooms';
const SESSION_KEY = 'kyoumisugoroku_session';
const ORPHAN_TTL_MS = 2 * 60 * 1000;
const PRESENCE_RETRY_MS = 3000;
const TX_RETRY_MAX = 3;
const ABSENT_GRACE_MS = 4000; // サイコロを振る番の人がいないとき、とばすまでの待ち（再読み込みの一瞬は待つ）
const DICE_MS = 600;          // サイコロが回っている時間（1台の画面と同じくらい）
const STEP_MS = 250;          // コマが1マス進む時間
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

const net = {
  role: null,          // 'host' | 'guest'
  nickname: null,
  roomCode: null,
  roomRef: null,
  room: null,          // 最新のルーム
  joinedAt: null,
  roomCallback: null,
  connectedRef: null,
  connectedCallback: null,
  isConnected: false,
  presenceDirty: false,
  presenceAt: 0,
  leaving: false,
  busy: false,
  timerInterval: null,
  orphanTimer: null,
  skipTimer: null,
  skipKey: null,
  seen: null,          // 描いたゲームの id と rollNo（新しく振られたらアニメーションする）
  anim: null,          // { key, turn, from, to, dice, start }
  animTimer: null,
  shownKey: null,      // カードを出したときの印（同じカードを出し直すたびに popIn しない）
};

// 通信はルームを作る・参加する・ルームにもどるときだけ準備する（1台の画面ではつながない）
let fb = null;
function firebaseReady() {
  if (!fb) fb = RoomkRTDB.initFirebase(firebase);
  return fb;
}

function currentUid() {
  return fb ? firebase.auth().currentUser?.uid || null : null;
}

function serverTimestamp() {
  return firebase.database.ServerValue.TIMESTAMP;
}

async function waitAuth() {
  try {
    await firebaseReady().authReady;
    return true;
  } catch {
    toast('うまくつながらなかったよ。ページを読み直してね');
    return false;
  }
}

function isExpired(room) {
  // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
  return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
}

async function removeExpired(ref, fallback) {
  try {
    // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
    await ref.transaction((room) => {
      const current = room || fallback;
      return current && isExpired(current) ? null : undefined;
    }, undefined, false);
  } catch (error) {
    console.warn('[kyoumi-sugoroku] expired room cleanup failed', error);
  }
}

// transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
function warmRoomCache(ref) {
  return new Promise((resolve, reject) => {
    const callback = (snap) => {
      resolve({ snap, release: () => ref.off('value', callback) });
    };
    ref.on('value', callback, reject);
  });
}

// 送信後に通信が切れて中止された transaction は、やり直す（届いていたかは中で確かめる）
async function transactRetry(ref, update) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await ref.transaction(update);
    } catch (error) {
      if (error?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
    }
  }
}

function reservedByOther(room, name, uid) {
  const game = L.gameOf(room);
  if (!game || room.status === L.STATUS.WAITING) return false;
  if (L.isProxy(game, name)) return true;
  const owner = game.uids?.[name];
  return !!owner && owner !== uid;
}

function setError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.hidden = !message;
}

/* ── 再接続用の記録（名前とルームコードだけ） ── */
function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      role: net.role,
      nickname: net.nickname,
      roomCode: net.roomCode,
      uid: currentUid(),
      joinedAt: net.joinedAt,
    }));
  } catch {
    // 保存できないときは、再読み込みで戻れないだけ
  }
}

function loadSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // 何もしない
  }
}

/* ── ルームへの出入り ── */
function stopAnim() {
  clearInterval(net.animTimer);
  net.animTimer = null;
  net.anim = null;
}

function cleanupRoom() {
  clearInterval(net.timerInterval);
  clearTimeout(net.orphanTimer);
  clearTimeout(net.skipTimer);
  stopAnim();
  if (net.roomRef && net.roomCallback) net.roomRef.off('value', net.roomCallback);
  if (net.connectedRef && net.connectedCallback) net.connectedRef.off('value', net.connectedCallback);
  if (net.roomRef) RoomkRTDB.cancelRoomOnDisconnect(net.roomRef);
  Object.assign(net, {
    role: null,
    nickname: null,
    roomCode: null,
    roomRef: null,
    room: null,
    joinedAt: null,
    roomCallback: null,
    connectedRef: null,
    connectedCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    timerInterval: null,
    orphanTimer: null,
    skipTimer: null,
    skipKey: null,
    seen: null,
    shownKey: null,
  });
  clearSession();
  $('hostOffOverlay').hidden = true;
  $('roomBar').hidden = true;
  $('roomStage').hidden = true;
  $('lastPick').hidden = true;
  $('turnNote').hidden = true;
  $('diceArea').hidden = false;
  $('dice').textContent = '?';
  placeCards(false);
}

function leaveLocally(message, isError = true) {
  cleanupRoom();
  showScreen('top');
  if (message) toast(message, isError);
}

function connectToRoom(role, nickname, code, ref, joinedAt) {
  // 念のため、前のルームの購読・タイマーが残っていたら片付けてからつなぐ
  if (net.roomRef) cleanupRoom();
  net.role = role;
  net.nickname = nickname;
  net.roomCode = code;
  net.roomRef = ref;
  net.joinedAt = Number(joinedAt) || RoomkRTDB.now();
  $('roomCodeLabel').textContent = code;
  $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
  $('roomBar').hidden = false;
  $('btn-back').hidden = true;
  placeCards(true);
  saveSession();
  // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);

  net.roomCallback = (snap) => {
    // 自分で退出・ルームを閉じている途中の変化は、退出処理の側で片付ける
    if (net.roomRef !== ref || net.leaving) return;
    if (!snap.exists()) {
      leaveLocally('ルームが閉じられたよ', false);
      return;
    }
    const room = snap.val();
    if (isExpired(room)) {
      removeExpired(ref, room);
      leaveLocally('このルームは終わったみたい');
      return;
    }
    net.room = room;
    handleRoom(room);
  };
  ref.on('value', net.roomCallback, (error) => {
    console.warn('[kyoumi-sugoroku] room listener failed', error);
    toast('ルームの読み込みに失敗しました');
  });

  net.connectedRef = firebaseReady().db.ref('.info/connected');
  net.connectedCallback = (snap) => {
    net.isConnected = snap.val() === true;
    if (net.isConnected && net.roomRef === ref) {
      net.presenceDirty = true;
      ensurePresence(true);
    }
  };
  net.connectedRef.on('value', net.connectedCallback);
  net.timerInterval = setInterval(tickRoom, 1000);
}

function tickRoom() {
  if (net.room && needsPresence(net.room)) ensurePresence();
}

// 接続中なのに、ルームの上では切断・不在になっている
function needsPresence(room) {
  if (net.role === 'host') return room.hostConnected === false;
  if (net.role === 'guest') return !room.players?.[net.nickname];
  return false;
}

// 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
// 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
async function ensurePresence(force = false) {
  const ref = net.roomRef;
  if (!ref || net.leaving || !net.isConnected || !net.room) return;
  if (!force && Date.now() - net.presenceAt < PRESENCE_RETRY_MS) return;
  net.presenceDirty = false;
  net.presenceAt = Date.now();
  const role = net.role;
  const nickname = net.nickname;
  const joinedAt = net.joinedAt;
  const uid = currentUid();
  // 退出・ルームを閉じる途中になったら、在室を書き戻さない（transaction の中でも見る。
  // 退出の transaction のあとに書き戻すと、抜けた人が在室のまま残るため）
  const stale = () => net.leaving || net.roomRef !== ref;
  try {
    if (role === 'host') {
      await ref.onDisconnect().update({
        hostConnected: false,
        hostDisconnectedAt: serverTimestamp(),
      });
      if (stale()) return;
      await ref.transaction((room) => {
        if (stale() || !room || room.hostUid !== uid || isExpired(room)) return;
        if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
        return { ...room, hostConnected: true, hostDisconnectedAt: null };
      });
    } else if (role === 'guest') {
      await ref.child('players/' + nickname).onDisconnect().remove();
      if (stale()) return;
      let full = false;
      await ref.transaction((room) => {
        full = false;
        if (stale() || !room || isExpired(room) || room.players?.[nickname]) return;
        if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) return;
        // 戻るときは参加したときの順番のまま。遊んでいるゲームの人は人数の上限を見ない
        const inGame = room.status !== L.STATUS.WAITING && L.ownsName(L.gameOf(room), nickname, uid);
        if (!inGame && L.playingNames(room).length >= L.MAX_PLAYERS) {
          full = true;
          return;
        }
        return {
          ...room,
          players: {
            ...(room.players || {}),
            [nickname]: { isHost: false, uid, joinedAt },
          },
        };
      });
      if (full && net.roomRef === ref && !net.leaving) {
        await RoomkRTDB.cancelRoomOnDisconnect(ref);
        leaveLocally('このルームはいっぱいだよ');
      }
    }
  } catch (error) {
    console.warn('[kyoumi-sugoroku] presence recovery failed', error);
    // 定期的な確認の失敗は通知しない（接続し直したときだけ知らせる）
    if (force) toast('再接続に失敗しました。ページを読み直してね');
  }
}

async function createRoom() {
  if (net.busy || net.roomRef) return;
  const nickname = $('hostName').value.trim();
  const error = L.validNickname(nickname);
  if (error) {
    setError('createError', error);
    return;
  }
  setError('createError', '');
  // 認証待ちの間の二度押しでルームが2つできないよう、待つ前にロックする
  net.busy = true;
  $('btnCreateRoom').disabled = true;
  try {
    if (!await waitAuth()) return;
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = RoomkRTDB.generateRoomCode();
      const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
      const result = await transactRetry(ref, (room) => {
        // やり直しのとき、前の送信で自分が作ったルームが届いていたら、そのまま使う
        if (room) return room.hostUid === uid && room.players?.[nickname]?.joinedAt === joinedAt ? room : undefined;
        return {
          status: L.STATUS.WAITING,
          host: nickname,
          hostUid: uid,
          hostPlays: true,
          squares: L.DEFAULT_SQUARES,
          themes: Object.keys(THEMES),
          hostConnected: true,
          hostDisconnectedAt: null,
          createdAt: serverTimestamp(),
          lastGameId: 0,
          players: {
            [nickname]: { isHost: true, uid, joinedAt },
          },
        };
      });
      if (result.committed) {
        window.RoomkStats?.count('room-create');
        connectToRoom('host', nickname, code, ref, joinedAt);
        return;
      }
    }
    setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
  } catch (err) {
    console.warn('[kyoumi-sugoroku] create failed', err);
    setError('createError', '接続できませんでした。もう一度ためしてね');
  } finally {
    net.busy = false;
    $('btnCreateRoom').disabled = false;
  }
}

// ルームコード: 日本語入力のまま打った全角の英数字は半角に、小文字は大文字にそろえて読む。
// 入力欄は打っている間に書き換えない（変換中に書き換えると文字が重なり、ローマ字が入らなくなる）
function normalizeRoomCode(raw) {
  return String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
}
// ひらがななど半角にできない文字が残ったら、日本語入力の切り替え方を案内する
function roomCodeImeError(code) {
  return /[^\x00-\x7F]/.test(code)
    ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）'
    : '';
}

async function joinRoom() {
  if (net.busy || net.roomRef) return;
  const nickname = $('guestName').value.trim();
  const code = normalizeRoomCode($('joinCode').value);
  const error = L.validNickname(nickname);
  if (error) {
    setError('joinError', error);
    return;
  }
  const imeError = roomCodeImeError(code);
  if (imeError) {
    setError('joinError', imeError);
    return;
  }
  if (!ROOM_CODE_PATTERN.test(code)) {
    setError('joinError', 'ルームコードは6文字で入れてね');
    return;
  }
  setError('joinError', '');
  net.busy = true;
  $('btnJoinRoom').disabled = true;
  let release = null;
  try {
    if (!await waitAuth()) return;
    const ref = firebaseReady().db.ref(DB_PREFIX + '/' + code);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const initial = warm.snap.val();
    if (!initial) {
      setError('joinError', 'ルームが見つからないよ。コードを確かめてね');
      return;
    }
    if (isExpired(initial)) {
      await removeExpired(ref, initial);
      setError('joinError', 'このルームは終わったみたい');
      return;
    }
    const uid = currentUid();
    const joinedAt = RoomkRTDB.now();
    let reason = '';
    let rejoinAt = null;
    const result = await transactRetry(ref, (room) => {
      reason = '';
      rejoinAt = null;
      if (!room) { reason = '見つからない'; return; }
      if (isExpired(room)) { reason = '終了'; return; }
      // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
      const stale = room.players?.[nickname];
      const mine = !!stale && !stale.isHost && stale.uid === uid;
      if (nickname === room.host || room.proxies?.[nickname] || (stale && !mine) || reservedByOther(room, nickname, uid)) {
        reason = '名前';
        return;
      }
      const game = L.gameOf(room);
      if (mine) {
        rejoinAt = Number(stale.joinedAt) || joinedAt;
      } else if (room.status !== L.STATUS.WAITING) {
        // 遊んでいる途中は、このゲームで遊んでいた人がタブを閉じたあとに入りなおすときだけ入れる
        if (!L.ownsName(game, nickname, uid)) { reason = '途中'; return; }
        rejoinAt = Number(game.joined?.[nickname]) || joinedAt;
      } else if (L.playingNames(room).length >= L.MAX_PLAYERS) {
        reason = '満員';
        return;
      }
      return {
        ...room,
        players: {
          ...(room.players || {}),
          [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt },
        },
      };
    });
    if (!result.committed) {
      const messages = {
        '見つからない': 'ルームが見つからないよ。コードを確かめてね',
        '終了': 'このルームは終わったみたい',
        '名前': 'その名前は使われているよ。少し変えてみてね',
        '満員': 'このルームはいっぱいだよ（遊べるのは' + L.MAX_PLAYERS + '人まで）',
        '途中': 'もうゲームが始まっているよ。ゴールして、ホストが「もう一度あそぶ」を押したら参加できるよ',
      };
      setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
      return;
    }
    connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
  } catch (err) {
    console.warn('[kyoumi-sugoroku] join failed', err);
    setError('joinError', '接続できませんでした。もう一度ためしてね');
  } finally {
    release?.();
    net.busy = false;
    $('btnJoinRoom').disabled = false;
  }
}

async function tryReconnect() {
  const saved = loadSession();
  if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
  if (!ROOM_CODE_PATTERN.test(saved.roomCode) || L.validNickname(saved.nickname)) return false;
  if (net.busy || net.roomRef) return false;
  // 復帰の途中で「ルームを作る／参加する」が重ならないようにする
  net.busy = true;
  ['btnGoCreate', 'btnGoJoin', 'btnGoLocal'].forEach((id) => { $(id).disabled = true; });
  let release = null;
  try {
    if (!await waitAuth()) return false;
    const uid = currentUid();
    if (!uid || uid !== saved.uid) return false;
    const ref = firebaseReady().db.ref(DB_PREFIX + '/' + saved.roomCode);
    const warm = await warmRoomCache(ref);
    release = warm.release;
    const room = warm.snap.val();
    if (!room) return false;
    if (isExpired(room)) {
      await removeExpired(ref, room);
      return false;
    }
    let joinedAt = Number(saved.joinedAt) || null;
    if (saved.role === 'host') {
      if (room.host !== saved.nickname || room.hostUid !== uid) return false;
      joinedAt = Number(room.players?.[saved.nickname]?.joinedAt) || joinedAt;
    } else if (saved.role === 'guest') {
      if (saved.nickname === room.host || room.proxies?.[saved.nickname]) return false;
      const player = room.players?.[saved.nickname];
      if (player && (player.isHost || player.uid !== uid)) return false;
      if (reservedByOther(room, saved.nickname, uid)) return false;
      if (player) joinedAt = Number(player.joinedAt) || joinedAt;
    } else {
      return false;
    }
    if (net.roomRef) return false;
    connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
    return true;
  } catch (error) {
    console.warn('[kyoumi-sugoroku] reconnect failed', error);
    return false;
  } finally {
    release?.();
    net.busy = false;
    ['btnGoCreate', 'btnGoJoin', 'btnGoLocal'].forEach((id) => { $(id).disabled = false; });
  }
}

async function leaveRoom() {
  if (net.busy || !net.roomRef) return;
  const ref = net.roomRef;
  const role = net.role;
  const nickname = net.nickname;
  const uid = currentUid();
  if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
  net.busy = true;
  net.leaving = true;
  try {
    await RoomkRTDB.cancelRoomOnDisconnect(ref);
    if (role === 'host') {
      await ref.remove();
    } else {
      // 自分の在室だけを消す（コマと名前はゲームが終わるまで残す。入りなおせるように）
      await ref.transaction((room) => {
        if (!room) return;
        if (room.players?.[nickname]?.uid !== uid) return;
        const players = { ...room.players };
        delete players[nickname];
        const left = { ...room, players };
        // 自分の番だったら、待たせないように次の人へ
        const game = L.gameOf(left);
        if (game && left.status === L.STATUS.PLAYING && L.actorOf(game) === nickname) {
          const rollNo = Number(game.rollNo) || 0;
          return (game.step === L.STEP.TALK ? L.nextPlayer(left, game.id, rollNo) : L.skipAbsent(left)) || left;
        }
        return left;
      });
    }
  } catch (error) {
    console.warn('[kyoumi-sugoroku] leave failed', error);
    toast('退出できませんでした。もう一度ためしてね');
    net.leaving = false;
    net.busy = false;
    // 退出の前に取り消した切断予約を張り直す
    ensurePresence(true);
    if (net.room) handleRoom(net.room);
    return;
  }
  net.busy = false;
  leaveLocally('');
}

/* ── 画面の更新 ── */
function handleRoom(room) {
  if (net.role === 'guest') {
    const me = room.players?.[net.nickname];
    if (me && me.uid !== currentUid()) {
      leaveLocally('同じ名前の人が参加したので、ルームから外れました');
      return;
    }
  }
  if (net.presenceDirty) ensurePresence(true);
  else if (needsPresence(room)) ensurePresence();
  updateHostOverlay(room);
  trackRoll(room);
  renderRoom(room);
  if (net.role === 'host') hostWatchAbsent(room);
}

function updateHostOverlay(room) {
  if (net.role === 'guest' && room.hostConnected === false) {
    $('hostOffOverlay').hidden = false;
    if (!net.orphanTimer) {
      const ref = net.roomRef;
      const at = RoomkRTDB.getHostDisconnectedAt(room);
      const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
      net.orphanTimer = setTimeout(() => {
        net.orphanTimer = null;
        if (net.roomRef === ref && net.room) removeExpired(ref, net.room);
      }, delay);
    }
  } else {
    $('hostOffOverlay').hidden = true;
    clearTimeout(net.orphanTimer);
    net.orphanTimer = null;
  }
}

// 新しくサイコロが振られたのを見たら、サイコロとコマのアニメーションをする。
// 開いた直後・再読み込みのあとは、アニメーションせずにいまの形を出す
function trackRoll(room) {
  const game = L.gameOf(room);
  if (!game || room.status === L.STATUS.WAITING) {
    net.seen = null;
    stopAnim();
    return;
  }
  const rollNo = Number(game.rollNo) || 0;
  const seen = net.seen;
  const last = game.last;
  if (seen && seen.id === game.id && rollNo === seen.rollNo + 1 && last && Number.isInteger(last.turn)) {
    stopAnim();
    net.anim = {
      key: game.id + ':' + rollNo,
      turn: last.turn,
      from: Number(last.from) || 0,
      to: Number(last.to) || 0,
      dice: Number(last.dice) || 1,
      start: performance.now(),
    };
    net.animTimer = setInterval(() => {
      if (!animRunning()) stopAnim();
      if (net.room) renderRoom(net.room);
    }, 60);
  } else if (!seen || seen.id !== game.id || rollNo !== seen.rollNo) {
    stopAnim();
  }
  net.seen = { id: game.id, rollNo };
}

function animRunning() {
  const a = net.anim;
  if (!a) return false;
  return performance.now() - a.start < DICE_MS + Math.max(0, a.to - a.from) * STEP_MS + 150;
}

// アニメーション中のコマの位置
function animPos(a) {
  const t = performance.now() - a.start;
  if (t < DICE_MS) return a.from;
  return Math.min(a.to, a.from + Math.floor((t - DICE_MS) / STEP_MS) + 1);
}

function renderRoom(room) {
  const game = L.gameOf(room);
  if (game && (room.status === L.STATUS.PLAYING || room.status === L.STATUS.GOAL)) {
    renderRoomGame(room, game);
  } else {
    renderWaiting(room);
  }
}

function themeLabels(themes) {
  return themes.map((key) => THEMES[key].label).join('・');
}

function renderWaiting(room) {
  showScreen('waiting');
  const host = net.role === 'host';
  const playing = L.playingNames(room);
  const squares = L.squaresOf(room.squares);
  const themes = L.themesOf(room.themes, COUNTS);
  $('waitingCount').textContent = `遊ぶ人 ${playing.length}人（${L.MAX_PLAYERS}人まで）`;

  const list = $('waitingPlayers');
  list.replaceChildren();
  const addRow = (name, tags, onRemove) => {
    const li = makeElement('li', 'ks-people__item');
    li.appendChild(makeElement('span', 'ks-people__name', name));
    tags.forEach((tag) => li.appendChild(makeElement('span', 'ks-tag', tag)));
    if (onRemove) {
      const btn = makeElement('button', 'ks-quiet-btn', '外す');
      btn.type = 'button';
      btn.addEventListener('click', onRemove);
      li.appendChild(btn);
    }
    list.appendChild(li);
  };
  L.memberNames(room).forEach((name) => {
    const p = room.players[name];
    const tags = [];
    if (p.isHost) tags.push(room.hostPlays ? 'ホスト' : 'ホスト（進行だけ）');
    if (name === net.nickname) tags.push('あなた');
    addRow(name, tags);
  });
  // 「端末なし」の印は、ホストの画面にだけ出す（子どもどうしの画面で区別しない）
  L.proxyNames(room).forEach((name) => {
    addRow(name, host ? ['端末なし'] : [], host ? () => removeProxy(name) : null);
  });
  $('waitingSettings').textContent = `マス数 ${squares}マス・テーマ ${themeLabels(themes)}`;

  $('hostWaitingTools').hidden = !host;
  $('guestWaitingNote').hidden = host;
  if (host) {
    const box = $('hostPlays');
    box.checked = !!room.hostPlays;
    box.disabled = !room.hostPlays && playing.length >= L.MAX_PLAYERS;
    selectToggle($('roomSquares'), squares);
    $('roomThemes').querySelectorAll('input').forEach((input) => { input.checked = themes.includes(input.value); });
    const full = playing.length >= L.MAX_PLAYERS;
    $('btnAddProxy').disabled = full;
    $('btnStartGame').disabled = playing.length < L.MIN_PLAYERS;
    $('startNote').textContent = playing.length < L.MIN_PLAYERS
      ? '遊ぶ人がいません。「自分もプレイヤーとして参加する」にするか、参加する人を待ってね'
      : full ? `遊べるのは${L.MAX_PLAYERS}人までです` : '';
  }
}

function playerTags(room, game, name) {
  const tags = [];
  if (name === net.nickname) tags.push('あなた');
  if (net.role === 'host' && L.isProxy(game, name)) tags.push('端末なし');
  else if (!L.present(room, game, name)) tags.push('つながっていない');
  return tags;
}

function renderRoomGame(room, game) {
  showScreen('game');
  const order = L.orderOf(game);
  const turn = L.turnOf(game);
  const goal = room.status === L.STATUS.GOAL;
  const winner = goal && Number.isInteger(game.winner) ? game.winner : turn;
  const anim = animRunning() ? net.anim : null;
  const positions = order.map((_, i) => L.posOf(game, i));
  if (anim && positions[anim.turn] != null) positions[anim.turn] = animPos(anim);
  // アニメーション中は、振った人を「いまの番」として出す
  const current = anim ? anim.turn : goal ? winner : turn;

  renderIndicator(order.map((name, i) => ({ name, current: i === current, tags: playerTags(room, game, name) })));
  // 前の人が選んだもの（次にサイコロが振られると消える）
  const pick = !goal && !anim ? L.pickedOf(game, COUNTS) : null;
  renderPick(pick && {
    playerIndex: pick.turn,
    name: order[pick.turn],
    item: normalizeQ(QUESTIONS[pick.theme][pick.idx]),
    choice: pick.choice,
  });
  renderBoard(L.squaresOf(game.squares), positions);

  const uid = currentUid();
  const act = L.canAct(room, uid, net.nickname, net.role);
  const actor = L.actorOf(game);
  const mine = actor === net.nickname && net.role === 'guest' || (net.role === 'host' && actor === room.host);
  const rolling = game.step === L.STEP.ROLL && !goal;

  // サイコロ
  const dice = $('dice');
  if (anim && performance.now() - anim.start < DICE_MS) dice.textContent = Math.floor(Math.random() * 6) + 1;
  else if (anim || !rolling) dice.textContent = game.last?.dice || '?';
  else dice.textContent = '?';
  $('btn-roll').hidden = !rolling || !act;
  $('btn-roll').disabled = !!anim || net.busy;

  // いまの番の案内
  const note = $('turnNote');
  note.hidden = goal && !anim;
  if (anim) {
    note.textContent = `${order[anim.turn]}さんがサイコロを振ったよ`;
  } else if (rolling) {
    if (mine) note.textContent = 'あなたの番だよ。「サイコロを振る」を押してね';
    else if (act) note.textContent = `${actor}さんの番だよ（ホストは代わりに押せます${L.present(room, game, actor) ? '' : '。つながっていません'}）`;
    else note.textContent = `${actor}さんがサイコロを振る番だよ`;
  } else if (!goal) {
    note.textContent = mine ? 'あなたが話す番だよ' : `${actor}さんが話す番だよ`;
  }

  $('btnRoomBack').hidden = !(net.role === 'host' && !goal);

  // 質問・ゴールのカード（アニメーションが終わってから出す）
  const stage = $('roomStage');
  const q = L.questionOf(game, COUNTS);
  let key = null;
  if (!anim && goal) {
    key = 'goal:' + game.id;
    $('questionCard').hidden = true;
    $('goalCard').hidden = false;
    $('goal-name').textContent = `${order[winner]} さん、おめでとう！`;
    $('btn-restart').hidden = net.role !== 'host';
    $('btnGoalSettings').hidden = true;
    $('goal-wait').hidden = net.role === 'host';
  } else if (!anim && !rolling && q) {
    key = 'q:' + game.id + ':' + game.rollNo + ':' + q.n;
    const item = normalizeQ(QUESTIONS[q.theme][q.idx]);
    const hasChoices = !!(item.choices && item.choices.length);
    $('goalCard').hidden = true;
    $('questionCard').hidden = false;
    fillQuestion(q.theme, item, actor, {
      playerIndex: turn,
      dice: game.last?.dice || null,
      canPress: act && !net.busy,
      onChoose: roomChoose,
      // 選択肢がある質問は、選ぶと次の人の番になる（選んだものは盤の上に出る）
      showNext: act && !hasChoices,
      showSkip: act,
      waitText: act
        ? (hasChoices ? CHOICE_HINT : '')
        : (hasChoices ? `${actor}さんが選ぶと、次の人の番になるよ` : `${actor}さんが話しおわると、次の人へ進むよ`),
    });
  }
  stage.hidden = key == null;
  $('diceArea').hidden = key != null;
  if (key && key !== net.shownKey) popIn(key.startsWith('goal') ? $('goalCard') : $('questionCard'));
  net.shownKey = key;
}

/* ── 番の操作（番の人とホスト） ── */
async function roomAct(mutate, failMessage) {
  if (net.busy || !net.roomRef) return null;
  net.busy = true;
  const uid = currentUid();
  const nickname = net.nickname;
  const role = net.role;
  try {
    const result = await net.roomRef.transaction((room) => {
      if (!room || isExpired(room) || !L.canAct(room, uid, nickname, role)) return;
      return mutate(room) || undefined;
    });
    return result.committed;
  } catch (error) {
    console.warn('[kyoumi-sugoroku] action failed', error);
    toast(failMessage);
    return null;
  } finally {
    net.busy = false;
    if (net.room && net.roomRef) renderRoom(net.room);
  }
}

function currentTurn() {
  const game = L.gameOf(net.room);
  return game ? { id: game.id, rollNo: Number(game.rollNo) || 0, qn: L.questionOf(game, COUNTS)?.n ?? 0 } : null;
}

async function roomRoll() {
  const now = currentTurn();
  if (!now || animRunning()) return;
  const seed = L.randomSeed();
  let goal = false;
  const ok = await roomAct((room) => {
    const next = L.roll(room, now.id, now.rollNo, seed, COUNTS);
    goal = next?.status === L.STATUS.GOAL;
    return next;
  }, 'サイコロを振れませんでした。もう一度ためしてね');
  // 利用回数: ゴールまで進んだ（ゴールを確定させた端末だけ）
  if (ok && goal) window.RoomkStats?.count('finish');
}

async function roomReask() {
  const now = currentTurn();
  if (!now) return;
  const seed = L.randomSeed();
  await roomAct((room) => L.reask(room, now.id, now.rollNo, now.qn, seed, COUNTS), '質問を変えられませんでした。もう一度ためしてね');
}

async function roomChoose(choice) {
  const now = currentTurn();
  const game = L.gameOf(net.room);
  const q = L.questionOf(game, COUNTS);
  if (!now || !q) return;
  const item = normalizeQ(QUESTIONS[q.theme][q.idx]);
  const count = item.choices ? item.choices.length : 0;
  await roomAct((room) => L.choose(room, now.id, now.rollNo, now.qn, choice, count, COUNTS), '選べませんでした。もう一度ためしてね');
}

async function roomNext() {
  const now = currentTurn();
  if (!now) return;
  await roomAct((room) => L.nextPlayer(room, now.id, now.rollNo), '次の人へ進めませんでした。もう一度ためしてね');
}

/* ── ホストの操作 ── */
async function hostTransaction(update, failMessage) {
  // 処理中の二度押しは何もしない（失敗の通知も出さない）
  if (net.role !== 'host' || net.busy || !net.roomRef) return null;
  net.busy = true;
  const uid = currentUid();
  try {
    const result = await net.roomRef.transaction((room) => {
      if (!room || room.hostUid !== uid || isExpired(room)) return;
      return update(room) || undefined;
    });
    return result.committed;
  } catch (error) {
    console.warn('[kyoumi-sugoroku] host action failed', error);
    if (failMessage) toast(failMessage);
    return null;
  } finally {
    net.busy = false;
    if (net.room && net.roomRef) renderRoom(net.room);
  }
}

// サイコロを振る番の人がいない（退出・切断）まま少し待っても戻らなければ、次の人へとばす
function hostWatchAbsent(room) {
  const game = L.gameOf(room);
  const actor = game && room.status === L.STATUS.PLAYING && game.step === L.STEP.ROLL ? L.actorOf(game) : null;
  const key = actor != null && !L.present(room, game, actor) ? `${game.id}:${game.rollNo}:${L.turnOf(game)}` : null;
  if (key === net.skipKey) return;
  clearTimeout(net.skipTimer);
  net.skipTimer = null;
  net.skipKey = key;
  if (!key) return;
  net.skipTimer = setTimeout(async () => {
    net.skipTimer = null;
    if (net.skipKey !== key) return;
    const ok = await hostTransaction((r) => {
      const g = L.gameOf(r);
      if (!g || `${g.id}:${g.rollNo}:${L.turnOf(g)}` !== key) return;
      return L.skipAbsent(r);
    }, '');
    // 進めなかったら（処理中など）、次のルームの変化でまた見る
    if (!ok && net.skipKey === key) net.skipKey = null;
  }, ABSENT_GRACE_MS);
}

async function setHostPlays(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    if (value && !room.hostPlays && L.playingNames(room).length >= L.MAX_PLAYERS) return;
    return { ...room, hostPlays: value };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function setSquares(value) {
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    return { ...room, squares: L.squaresOf(value) };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function toggleTheme(input) {
  const current = L.themesOf(net.room?.themes, COUNTS);
  const next = input.checked
    ? Object.keys(THEMES).filter((key) => key === input.value || current.includes(key))
    : current.filter((key) => key !== input.value);
  if (next.length < L.MIN_THEMES) {
    input.checked = true;
    toast('テーマは2つ以上選んでね');
    return;
  }
  const ok = await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING) return;
    return { ...room, themes: next };
  }, '設定を変えられませんでした。もう一度ためしてね');
  if (!ok && net.room) renderRoom(net.room);
}

async function addProxy() {
  const name = $('proxyName').value.trim();
  const error = L.validNickname(name);
  if (error) {
    setError('proxyError', error);
    return;
  }
  setError('proxyError', '');
  let reason = '';
  const ok = await hostTransaction((room) => {
    reason = '';
    if (room.status !== L.STATUS.WAITING) { reason = 'はじめる前だけ足せるよ'; return; }
    if (room.players?.[name] || room.proxies?.[name] || name === room.host) { reason = '「' + name + '」はもういるよ'; return; }
    if (L.playingNames(room).length >= L.MAX_PLAYERS) { reason = '遊べるのは' + L.MAX_PLAYERS + '人までだよ'; return; }
    return { ...room, proxies: { ...(room.proxies || {}), [name]: { joinedAt: RoomkRTDB.now() } } };
  }, '足せませんでした。もう一度ためしてね');
  // 待っている間に次の名前を打ちはじめていたら、消さない
  if (ok && $('proxyName').value.trim() === name) $('proxyName').value = '';
  else if (ok === false) setError('proxyError', reason || '足せませんでした。もう一度ためしてね');
}

async function removeProxy(name) {
  await hostTransaction((room) => {
    if (room.status !== L.STATUS.WAITING || !room.proxies?.[name]) return;
    const proxies = { ...room.proxies };
    delete proxies[name];
    return { ...room, proxies: Object.keys(proxies).length ? proxies : null };
  }, '外せませんでした。もう一度ためしてね');
}

async function startRoomGame() {
  let players = 0;
  const ok = await hostTransaction((room) => {
    const next = L.startGame(room, COUNTS);
    players = next ? L.orderOf(next.game).length : 0;
    return next;
  }, 'はじめられませんでした。もう一度ためしてね');
  if (ok) {
    window.RoomkStats?.count('start');
    window.RoomkStats?.count('players-' + players);
  } else if (ok === false) {
    toast('はじめられませんでした。参加している人を確かめてね');
  }
}

async function backToWaiting(fromGoal) {
  const gameId = L.gameOf(net.room)?.id;
  if (gameId == null) return;
  if (!fromGoal && !window.confirm('ゲームを終わって待合室に戻りますか？')) return;
  const ok = await hostTransaction((room) => {
    if (fromGoal && room.status !== L.STATUS.GOAL) return;
    return L.backToWaiting(room, gameId);
  }, 'もどれませんでした。もう一度ためしてね');
  // 利用回数: ゴールのあと、続けてもう1回を選んだ
  if (ok && fromGoal) window.RoomkStats?.count('again');
}

/* ════════════ ボタンと入口 ════════════ */
function inRoom() {
  return !!net.roomRef;
}

function submitOnEnter(input, handler) {
  input.addEventListener('keydown', (event) => {
    // 日本語入力の確定の Enter では送らない（Safari は確定の Enter を isComposing=false・keyCode 229 で届ける）
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) handler();
  });
}

initSettings();
buildToggle('roomSquares', L.SQUARE_OPTIONS.map((n) => ({ value: n, label: `${n}マス` })), L.DEFAULT_SQUARES, setSquares);
buildThemeList('roomThemes', toggleTheme);

$('btnGoLocal').addEventListener('click', () => showScreen('settings'));
$('btnSettingsBack').addEventListener('click', () => showScreen('top'));
$('btnGoCreate').addEventListener('click', () => {
  setError('createError', '');
  showScreen('create');
  $('hostName').focus({ preventScroll: true });
});
$('btnGoJoin').addEventListener('click', () => {
  setError('joinError', '');
  $('joinLinkHint').hidden = true;
  showScreen('join');
});
$('btnCreateBack').addEventListener('click', () => showScreen('top'));
$('btnJoinBack').addEventListener('click', () => showScreen('top'));
$('btnCreateRoom').addEventListener('click', createRoom);
$('btnJoinRoom').addEventListener('click', joinRoom);
submitOnEnter($('hostName'), createRoom);
submitOnEnter($('guestName'), joinRoom);
submitOnEnter($('joinCode'), joinRoom);
$('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(net.roomCode, event.currentTarget));
$('btnCopyLink').addEventListener('click', (event) => {
  if (!net.roomCode || !ROOM_CODE_PATTERN.test(net.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkRTDB.copyRoomLink(net.roomCode, event.currentTarget);
});
// 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
$('btnShowQr').addEventListener('click', () => {
  if (!net.roomCode || !ROOM_CODE_PATTERN.test(net.roomCode)) {
    toast('ルームコードがありません');
    return;
  }
  RoomkQR.show(net.roomCode);
});
$('btnLeave').addEventListener('click', leaveRoom);
$('btnOverlayLeave').addEventListener('click', leaveRoom);
$('hostPlays').addEventListener('change', (event) => setHostPlays(event.currentTarget.checked));
$('btnAddProxy').addEventListener('click', addProxy);
submitOnEnter($('proxyName'), addProxy);
$('btnStartGame').addEventListener('click', startRoomGame);
$('btnRoomBack').addEventListener('click', () => backToWaiting(false));

$('btn-roll').addEventListener('click', () => (inRoom() ? roomRoll() : rollLocalDice()));
$('btn-next').addEventListener('click', () => (inRoom() ? roomNext() : closeLocalQuestion()));
$('btn-skip').addEventListener('click', () => (inRoom() ? roomReask() : skipLocalQuestion()));
$('btn-restart').addEventListener('click', () => (inRoom() ? backToWaiting(true) : playAgainLocal()));
$('btnGoalSettings').addEventListener('click', backToLocalSettings);
$('btn-back').addEventListener('click', () => {
  if (confirm('ゲームを終わって設定に戻りますか？')) backToLocalSettings();
});

// 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう（コード欄は直せるように残す）
function openJoinFromLink(code) {
  setError('joinError', '');
  $('joinCode').value = code;
  $('joinLinkHint').hidden = false;
  showScreen('join');
  $('guestName').focus({ preventScroll: true });
}

// 再読み込みなどで、保存した記録から同じルームへ戻る
function resumeFromSession() {
  if (!loadSession()) return;
  tryReconnect().then((reconnected) => {
    if (!reconnected && !net.roomRef) clearSession();
  });
}

showScreen('top');
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam !== null) {
  // 参加用のリンク（?room=コード）の入口。コードはつないだときにアドレスから外す（connectToRoom）
  const linkCode = normalizeRoomCode(roomParam);
  const saved = loadSession();
  if (!ROOM_CODE_PATTERN.test(linkCode)) {
    toast('ルームコードが正しくないよ');
    history.replaceState(null, '', location.pathname);
    resumeFromSession();
  } else if (saved && saved.roomCode === linkCode) {
    // 同じルームの記録が残っていれば、名前を入れなおさずに戻る。戻れなければ参加画面へ
    tryReconnect().then((reconnected) => {
      if (reconnected || net.roomRef) return;
      clearSession();
      openJoinFromLink(linkCode);
    });
  } else {
    // 別のルームの記録が残っていても、ひらいたリンクのルームを優先する
    if (saved) clearSession();
    openJoinFromLink(linkCode);
  }
} else {
  resumeFromSession();
}
