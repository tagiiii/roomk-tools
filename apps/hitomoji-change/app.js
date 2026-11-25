import { shuffle, popIn } from '../shared/js/utils.js';
import { PUZZLES, VOCAB } from './words.js';

/* ── お題の選び方 ── */
const LEVELS = [
  { id: 'two',    label: '2文字',       icon: 'looks_two', chars: 2 },
  { id: 'three',  label: '3文字',       icon: 'looks_3',   chars: 3 },
  { id: 'custom', label: '自分で決める', icon: 'edit',      chars: null },
];

/* ── 文字の表（1行10マス。左が あ〜な 行、右が は〜わ 行。空きは ''） ── */
const PAD_ROWS = [
  'あいうえお', 'はひふへほ',
  'かきくけこ', 'まみむめも',
  'さしすせそ', 'や ゆ よ',
  'たちつてと', 'らりるれろ',
  'なにぬねの', 'わ を ん',
  'がぎぐげご', 'ばびぶべぼ',
  'ざじずぜぞ', 'ぱぴぷぺぽ',
  'だぢづでど', 'ぁぃぅぇぉ',
  'ゃゅょっー', '     ',
];
const KANA_RE = /^[ぁ-ゖー]+$/;
const MIN_CHARS = 2;
const MAX_CHARS = 5;

/* ── 状態 ── */
const state = {
  levelId: null,
  puzzle: null,      // { chars, start, goal }
  ladder: [],        // これまでのことば（先頭がはじめのことば）
  selPos: null,      // 変える文字の位置
  hintStage: 0,      // 0: まだ / 1: 場所を出した / 2: 次のことばを出した
  cleared: false,
  decks: {},         // 2文字・3文字ごとの、まだ出していないお題
};

/* ── DOM ── */
const $ = (id) => document.getElementById(id);
const screenTop = $('screen-top');
const screenPlay = $('screen-play');
const levelGrid = $('levelGrid');
const customForm = $('customForm');
const customStart = $('customStart');
const customGoal = $('customGoal');
const customError = $('customError');
const btnStart = $('btnStart');
const playLevel = $('playLevel');
const btnSkip = $('btnSkip');
const btnSkipLabel = $('btnSkipLabel');
const odaiStart = $('odaiStart');
const odaiGoal = $('odaiGoal');
const ladderEl = $('ladder');
const nowArea = $('nowArea');
const nowLabel = $('nowLabel');
const tilesEl = $('tiles');
const pad = $('pad');
const padTitle = $('padTitle');
const padGrid = $('padGrid');
const btnPadClose = $('btnPadClose');
const hintArea = $('hintArea');
const hintText = $('hintText');
const playActions = $('playActions');
const btnUndo = $('btnUndo');
const btnHint = $('btnHint');
const clearArea = $('clearArea');
const clearSub = $('clearSub');
const clearOther = $('clearOther');
const btnNext = $('btnNext');
const btnNextLabel = $('btnNextLabel');
const btnTop = $('btnTop');

const chars = (w) => Array.from(w);

/* ── 文字の数が同じで、1文字だけちがうか ── */
function differsByOne(a, b) {
  const x = chars(a);
  const y = chars(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
  return d === 1;
}

/* ── 言葉のリストで、from から goal までのいちばん短いつなぎ方を探す ── */
function findPath(from, goal) {
  if (from === goal) return [from];
  const len = chars(from).length;
  const words = [...new Set([...VOCAB, goal])].filter((w) => chars(w).length === len && w !== from);
  const prev = new Map([[from, null]]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const w of words) {
      if (prev.has(w) || !differsByOne(cur, w)) continue;
      prev.set(w, cur);
      if (w === goal) {
        const path = [];
        for (let x = goal; x !== null; x = prev.get(x)) path.unshift(x);
        return path;
      }
      queue.push(w);
    }
  }
  return null;
}

/* ── カタカナをひらがなに ── */
function toHiragana(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/* ── 画面切替 ── */
function showScreen(id) {
  screenTop.hidden = id !== 'top';
  screenPlay.hidden = id !== 'play';
  window.scrollTo(0, 0);
}

/* ── はじめの画面 ── */
function renderLevels() {
  levelGrid.innerHTML = '';
  LEVELS.forEach((lv) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hmc-level';
    const selected = lv.id === state.levelId;
    btn.classList.toggle('is-selected', selected);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    const count = lv.chars ? PUZZLES.filter((p) => p.chars === lv.chars).length : 0;
    const desc = lv.chars ? `${count}題` : 'お題を書く';
    btn.innerHTML = `
      <span class="material-symbols-rounded hmc-level__icon" aria-hidden="true">${lv.icon}</span>
      <span class="hmc-level__label">${lv.label}</span>
      <span class="hmc-level__desc">${desc}</span>`;
    btn.addEventListener('click', () => {
      state.levelId = lv.id;
      customForm.hidden = lv.id !== 'custom';
      customError.textContent = '';
      btnStart.disabled = false;
      renderLevels();
      if (lv.id === 'custom') customStart.focus();
    });
    levelGrid.appendChild(btn);
  });
}

/* ── 自分で決めたお題を確かめる（正しければ { start, goal }、だめなら null） ── */
function readCustom() {
  const start = toHiragana(customStart.value.replace(/\s/g, ''));
  const goal = toHiragana(customGoal.value.replace(/\s/g, ''));
  let msg = '';
  if (!start || !goal) msg = 'はじめのことばとゴールのことばを書いてね';
  else if (!KANA_RE.test(start) || !KANA_RE.test(goal)) msg = 'ひらがなで書いてね';
  else if (chars(start).length !== chars(goal).length) msg = '2つのことばの文字の数をそろえてね';
  else if (chars(start).length < MIN_CHARS || chars(start).length > MAX_CHARS) msg = `${MIN_CHARS}〜${MAX_CHARS}文字のことばにしてね`;
  else if (start === goal) msg = 'ちがうことばにしてね';
  customError.textContent = msg;
  return msg ? null : { chars: chars(start).length, start, goal };
}

/* ── お題を1つ出す ── */
function drawPuzzle(levelChars) {
  let deck = state.decks[levelChars];
  if (!deck || deck.length === 0) {
    const last = state.puzzle;
    deck = shuffle(PUZZLES.filter((p) => p.chars === levelChars));
    // 引き直した直後に、いま遊んだお題が続かないようにする
    if (last && deck.length > 1 && deck[deck.length - 1] === last) deck.unshift(deck.pop());
    state.decks[levelChars] = deck;
  }
  return deck.pop();
}

function startGame() {
  const lv = LEVELS.find((l) => l.id === state.levelId);
  if (!lv) return;
  let puzzle;
  if (lv.id === 'custom') {
    puzzle = readCustom();
    if (!puzzle) return;
  } else {
    puzzle = drawPuzzle(lv.chars);
  }
  beginPuzzle(puzzle);
  showScreen('play');
}

function beginPuzzle(puzzle) {
  state.puzzle = puzzle;
  state.ladder = [puzzle.start];
  state.selPos = null;
  state.hintStage = 0;
  state.cleared = false;
  const lv = LEVELS.find((l) => l.id === state.levelId);
  playLevel.textContent = lv.id === 'custom' ? '自分で決めたお題' : `${lv.label}のお題`;
  btnSkipLabel.textContent = lv.id === 'custom' ? 'お題を決めなおす' : 'お題を変える';
  btnNextLabel.textContent = lv.id === 'custom' ? 'お題を決めなおす' : '次のお題';
  odaiStart.textContent = puzzle.start;
  odaiGoal.textContent = puzzle.goal;
  window.RoomkStats?.count(lv.id === 'custom' ? 'custom' : `chars${lv.chars}`);
  render();
}

/* ── 遊ぶ画面の描画 ── */
function render() {
  renderLadder();
  renderTiles();
  renderPad();
  nowArea.hidden = state.cleared;
  playActions.hidden = state.cleared;
  btnUndo.disabled = state.ladder.length <= 1;
  if (state.cleared) {
    hintArea.hidden = true;
    pad.hidden = true;
  }
  nowLabel.textContent = state.selPos === null ? '変える文字を押してね' : 'いまのことば';
}

function renderLadder() {
  ladderEl.innerHTML = '';
  state.ladder.forEach((word, i) => {
    const li = document.createElement('li');
    li.className = 'hmc-ladder__step';
    if (i === state.ladder.length - 1) li.classList.add('is-current');
    const prev = i > 0 ? chars(state.ladder[i - 1]) : null;
    chars(word).forEach((c, j) => {
      const span = document.createElement('span');
      span.textContent = c;
      if (prev && prev[j] !== c) span.className = 'hmc-ladder__changed';
      li.appendChild(span);
    });
    ladderEl.appendChild(li);
  });
  const last = ladderEl.lastElementChild;
  if (last && last.scrollIntoView && state.ladder.length > 1) last.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderTiles() {
  tilesEl.innerHTML = '';
  const current = chars(state.ladder[state.ladder.length - 1]);
  const goal = chars(state.puzzle.goal);
  const hintPos = state.hintStage >= 1 ? hintStep()?.pos : null;
  current.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'hmc-tile';
    btn.textContent = c;
    btn.setAttribute('aria-label', `${i + 1}文字目「${c}」を変える`);
    btn.setAttribute('aria-pressed', state.selPos === i ? 'true' : 'false');
    if (state.selPos === i) btn.classList.add('is-selected');
    if (c === goal[i]) btn.classList.add('is-goal');
    if (hintPos === i) btn.classList.add('is-hint');
    btn.addEventListener('click', () => selectPos(i));
    tilesEl.appendChild(btn);
  });
}

function renderPad() {
  if (state.selPos === null || state.cleared) {
    pad.hidden = true;
    return;
  }
  const current = chars(state.ladder[state.ladder.length - 1]);
  const from = current[state.selPos];
  padTitle.textContent = `${state.selPos + 1}文字目の「${from}」を、どの文字に変える？`;
  padGrid.innerHTML = '';
  for (let r = 0; r < PAD_ROWS.length; r += 2) {
    const row = (PAD_ROWS[r] + PAD_ROWS[r + 1]).split('');
    row.forEach((c) => {
      if (c === ' ') {
        const gap = document.createElement('span');
        gap.className = 'hmc-key hmc-key--blank';
        gap.setAttribute('aria-hidden', 'true');
        padGrid.appendChild(gap);
        return;
      }
      const key = document.createElement('button');
      key.type = 'button';
      key.className = 'hmc-key';
      key.textContent = c;
      if (c === from) {
        key.disabled = true;
        key.classList.add('is-same');
      }
      key.addEventListener('click', () => changeChar(c));
      padGrid.appendChild(key);
    });
  }
  pad.hidden = false;
}

/* ── 操作 ── */
function selectPos(i) {
  if (state.cleared) return;
  state.selPos = state.selPos === i ? null : i;
  render();
  if (state.selPos !== null) {
    pad.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    padGrid.querySelector('.hmc-key:not(:disabled)')?.focus({ preventScroll: true });
  }
}

function closePad() {
  const pos = state.selPos;
  state.selPos = null;
  render();
  if (pos !== null) tilesEl.children[pos]?.focus();
}

function changeChar(c) {
  if (state.selPos === null || state.cleared) return;
  const current = chars(state.ladder[state.ladder.length - 1]);
  if (current[state.selPos] === c) return;
  const pos = state.selPos;
  current[pos] = c;
  const next = current.join('');
  state.ladder.push(next);
  state.selPos = null;
  state.hintStage = 0;
  hintArea.hidden = true;
  if (next === state.puzzle.goal) {
    finishPuzzle();
    return;
  }
  render();
  tilesEl.children[pos]?.focus();
}

function undo() {
  if (state.ladder.length <= 1 || state.cleared) return;
  state.ladder.pop();
  state.selPos = null;
  state.hintStage = 0;
  hintArea.hidden = true;
  render();
}

/* ── ヒント ── */
function hintStep() {
  const current = state.ladder[state.ladder.length - 1];
  const path = findPath(current, state.puzzle.goal);
  if (!path || path.length < 2) return null;
  const a = chars(current);
  const b = chars(path[1]);
  const pos = a.findIndex((c, i) => c !== b[i]);
  return { pos, word: path[1], steps: path.length - 1 };
}

function showHint() {
  if (state.cleared) return;
  const step = hintStep();
  if (!step) {
    const fromStart = state.ladder.length > 1 && findPath(state.puzzle.start, state.puzzle.goal);
    hintText.textContent = fromStart
      ? 'ここから先のヒントは見つからなかった。「1つ戻す」で前のことばに戻ってみよう'
      : 'このお題のヒントは見つからなかった。いろいろ変えて試してみよう';
    state.hintStage = 0;
  } else if (state.hintStage === 0) {
    state.hintStage = 1;
    hintText.textContent = `光っている文字を変えてみよう（あと${step.steps}回くらいでゴールできそう）`;
  } else {
    state.hintStage = 2;
    hintText.textContent = `たとえば「${step.word}」にできるよ`;
  }
  hintArea.hidden = false;
  render();
  popIn(hintArea);
}

/* ── ゴール ── */
function finishPuzzle() {
  state.cleared = true;
  const moves = state.ladder.length - 1;
  clearSub.textContent = `${moves}回の変更で「${state.puzzle.start}」から「${state.puzzle.goal}」につながった`;
  // ほかのつなぎ方の例（自分たちと同じ道なら出さない）
  const example = findPath(state.puzzle.start, state.puzzle.goal);
  if (example && example.join() !== state.ladder.join()) {
    clearOther.textContent = `ほかのつなぎ方の例: ${example.join(' → ')}`;
    clearOther.hidden = false;
  } else {
    clearOther.hidden = true;
  }
  render();
  clearArea.hidden = false;
  popIn(clearArea);
  btnNext.focus({ preventScroll: true });
  clearArea.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function nextPuzzle() {
  clearArea.hidden = true;
  hintArea.hidden = true;
  const lv = LEVELS.find((l) => l.id === state.levelId);
  if (!lv || lv.id === 'custom') {
    backToTop();
    return;
  }
  beginPuzzle(drawPuzzle(lv.chars));
  window.scrollTo(0, 0);
}

function backToTop() {
  clearArea.hidden = true;
  hintArea.hidden = true;
  showScreen('top');
}

/* ── イベント ── */
btnStart.addEventListener('click', startGame);
customForm.addEventListener('submit', (e) => { e.preventDefault(); startGame(); });
[customStart, customGoal].forEach((el) => {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); startGame(); }
  });
});
btnSkip.addEventListener('click', nextPuzzle);
btnPadClose.addEventListener('click', closePad);
btnUndo.addEventListener('click', undo);
btnHint.addEventListener('click', showHint);
btnNext.addEventListener('click', nextPuzzle);
btnTop.addEventListener('click', backToTop);
$('btnPlayTop').addEventListener('click', backToTop);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !pad.hidden && !document.querySelector('.howto-overlay.show')) closePad();
});

/* ── はじめ ── */
renderLevels();
showScreen('top');
