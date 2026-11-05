// わたし、ぼくってどんな人？（試作）
// 1対1の作戦会議で、メンターが画面共有して読み上げ、子どもの答えを聞いて 1〜4 を押す。
// 回答は画面の中だけで持ち、保存・点数・タイプ分け・比較はしない。
import { copyToClipboard, showToast } from '../../apps/shared/js/utils.js';

// ── 問い（9つ） ──
// 元資料「わたし、ぼくってどんな人？」の9つの軸をもとに、2026-11-05 の修正案で言葉を直した。
//   - 両はしがどちらも「いいな」と思える言葉にする
//   - 左右を同じ形の言葉にそろえる
//   - 同じ軸を2回聞かない（元の「考え 慎重派／楽観的」は①③と重なるので「好きなことは？」に入れかえた）
// 言葉の直しはコンテンツの判断なので、変えるときはこの配列だけを書き換える。
// leftIcon / rightIcon は Material Symbols Rounded の名前。
// 1 = 左（left）にとても近い / 2 = 左に少し近い / 3 = 右に少し近い / 4 = 右にとても近い
const QUESTIONS = [
  { title: '動くときは？', left: '考えてから動く', leftIcon: 'psychology', right: 'まず動いてみる', rightIcon: 'directions_run' },
  { title: '話し合いでは？', left: 'みんなの意見を聞きたい', leftIcon: 'hearing', right: '自分の意見を言いたい', rightIcon: 'record_voice_over' },
  { title: '予定は？', left: '前もって決めておきたい', leftIcon: 'event_note', right: 'その場で決めたい', rightIcon: 'bolt' },
  { title: 'はじめての場所では？', left: 'ゆっくりなじむ', leftIcon: 'potted_plant', right: 'すぐになじむ', rightIcon: 'waving_hand' },
  { title: '好きなことは？', left: 'いろいろやってみたい', leftIcon: 'interests', right: 'ひとつをとことん', rightIcon: 'center_focus_strong' },
  { title: '何かするとき', left: '1人でするのが好き', leftIcon: 'person', right: 'みんなでするのが好き', rightIcon: 'groups' },
  { title: '選ぶなら？', left: '慣れていることが好き', leftIcon: 'home', right: '新しいことが好き', rightIcon: 'explore' },
  { title: '進むときは？', left: '流れにまかせる', leftIcon: 'waves', right: '自分で決めて進む', rightIcon: 'signpost' },
  { title: 'うれしいときは？', left: '心の中でかみしめる', leftIcon: 'favorite', right: '顔や声に出す', rightIcon: 'celebration' },
];

const VALUES = [1, 2, 3, 4];
// 数字の下に出す程度の言葉（1と4は「とても」、2と3は「少し」）
const DEGREES = { 1: 'とても', 2: '少し', 3: '少し', 4: 'とても' };
// 答えなかったときの言い方。「とばした」は失敗のように見えやすいので「パス」にする
const PASS_LABEL = 'パス';

// ── 状態 ──
// mode: 'answer'（1つずつ答える） / 'review'（答えたところを1つずつふりかえる）
//       / 'detail'（一覧から押した問いを1つだけ大きく出す）
const state = {
  mode: 'answer',
  index: 0, // 答える位置（QUESTIONS.length に達したら全部答えた）
  answers: QUESTIONS.map(() => null), // null（まだ・パス） | 1〜4
  seen: QUESTIONS.map(() => false), // 答える画面で一度出したか（「パス」と「まだ」を分ける）
  pending: null, // 答える画面で選んでいる値（「つぎへ」で answers に入る）
  reviewList: [], // ふりかえる問いの位置
  reviewPos: 0,
  detailIndex: null, // 一覧から大きく出している問いの位置
};

// ── DOM ──
const $ = id => document.getElementById(id);
const screens = document.querySelectorAll('.screen');
const qProgress = $('q-progress');
const qDots = $('q-dots');
const qTitle = $('q-title');
const qSub = $('q-sub');
const qLeft = $('q-left');
const qRight = $('q-right');
const qLeftIcon = $('q-left-icon');
const qRightIcon = $('q-right-icon');
const qScale = $('q-scale');
const qRing = $('q-ring');
const qNote = $('q-note');
const scaleButtons = document.querySelectorAll('.dh-scale__btn');
const btnNext = $('btn-next');
const btnNextLabel = $('btn-next-label');
const btnBack = $('btn-back');
const btnBackLabel = $('btn-back-label');
const btnSkip = $('btn-skip');
const btnFinish = $('btn-finish');
const summaryTitle = $('summary-title');
const summaryList = $('summary-list');

function showScreen(id) {
  screens.forEach(s => s.classList.remove('active'));
  $('screen-' + id).classList.add('active');
  window.scrollTo(0, 0);
}

// いま画面に出している問いの位置
function currentQuestionIndex() {
  if (state.mode === 'review') return state.reviewList[state.reviewPos];
  if (state.mode === 'detail') return state.detailIndex;
  return state.index;
}

// いま画面で選ばれている値（ふりかえりと一覧から出したときは、答えをその場で書きかえる）
function currentValue() {
  return state.mode === 'answer' ? state.pending : state.answers[currentQuestionIndex()];
}

// 輪: 選んだ数字を囲む。選ぶ前は出さない
// 選んでいない状態から選んだときは、すべらせずにその数字の位置に出す
function placeRing(value) {
  const wasPlaced = qRing.classList.contains('dh-ring--placed');
  qRing.classList.toggle('dh-ring--jump', !wasPlaced);
  if (value) qRing.style.left = `${((value - 0.5) / 4) * 100}%`;
  qRing.classList.toggle('dh-ring--placed', Boolean(value));
}

function renderQuestion() {
  const review = state.mode === 'review';
  const i = currentQuestionIndex();
  const q = QUESTIONS[i];
  const detail = state.mode === 'detail';
  if (detail) {
    qProgress.textContent = '一覧から';
    renderDots(0, -1, () => false);
    qSub.textContent = '話してみて変わったら、選び直してOK';
    btnNextLabel.textContent = '一覧にもどる';
  } else if (review) {
    qProgress.textContent = 'ふりかえり';
    renderDots(state.reviewList.length, state.reviewPos, k => k < state.reviewPos);
    qSub.textContent = '話してみて変わったら、選び直してOK';
    btnNextLabel.textContent = state.reviewPos + 1 >= state.reviewList.length ? '全部の答えを見る' : 'つぎへ';
    btnBackLabel.textContent = 'まえへ';
    btnBack.disabled = state.reviewPos === 0;
  } else {
    state.seen[i] = true;
    state.pending = state.answers[i];
    qProgress.textContent = '';
    renderDots(QUESTIONS.length, i, k => state.seen[k] && k !== i);
    qSub.textContent = 'どちらに近い？';
    btnNextLabel.textContent = i + 1 >= QUESTIONS.length ? 'ふりかえりへ' : 'つぎへ';
    btnBackLabel.textContent = 'ひとつ前にもどる';
    btnBack.disabled = i === 0;
  }
  btnSkip.hidden = review || detail;
  btnFinish.hidden = review || detail;
  btnBack.hidden = detail;
  qTitle.textContent = q.title;
  qLeft.textContent = q.left;
  qRight.textContent = q.right;
  qLeftIcon.textContent = q.leftIcon;
  qRightIcon.textContent = q.rightIcon;
  qScale.setAttribute('aria-label', `1は「${q.left}」、4は「${q.right}」`);
  scaleButtons.forEach(btn => {
    const v = Number(btn.dataset.value);
    btn.setAttribute('aria-label', `${v}、${DEGREES[v]}「${v <= 2 ? q.left : q.right}」`);
  });
  qRing.classList.remove('dh-ring--placed'); // 問いが変わったら、前の位置からすべらせない
  renderValue();
  qTitle.focus();
}

// 進み具合の点。いまの問いは横長、すんだ問いは塗り、まだの問いは枠だけ
function renderDots(count, current, isDone) {
  qDots.innerHTML = '';
  qDots.hidden = count === 0;
  for (let k = 0; k < count; k++) {
    const dot = document.createElement('span');
    dot.className = 'dh-dots__dot'
      + (k === current ? ' dh-dots__dot--current' : '')
      + (isDone(k) ? ' dh-dots__dot--done' : '');
    qDots.appendChild(dot);
  }
}

function renderValue() {
  const value = currentValue();
  scaleButtons.forEach(btn => {
    const active = Number(btn.dataset.value) === value;
    btn.classList.toggle('dh-scale__btn--active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  placeRing(value);
  // 答える画面は選ぶまで進めない（答えないときは「パス」で）。ふりかえりはいつでも進める
  btnNext.disabled = state.mode === 'answer' && value === null;
  const i = currentQuestionIndex();
  qNote.textContent = state.seen[i] ? `${PASS_LABEL}した。いま選んでもOK` : 'まだ答えていない。いま選んでもOK';
  qNote.hidden = !(state.mode !== 'answer' && value === null);
}

// ── 答える ──
function advanceAnswer() {
  if (state.index + 1 >= QUESTIONS.length) {
    state.index = QUESTIONS.length;
    startReview(QUESTIONS.length);
  } else {
    state.index += 1;
    renderQuestion();
  }
}

// 今日はここまで: いまの問いは、選んでいればふりかえりに入れる
function finishAnswering() {
  const i = state.index;
  if (state.pending !== null) state.answers[i] = state.pending;
  const end = state.answers[i] !== null ? i + 1 : i;
  startReview(end);
}

// ── ふりかえり（1つずつ） ──
// 答えたところまで（to の手前まで）を、はじめから1つずつ
function startReview(to) {
  const list = [];
  for (let i = 0; i < to; i++) list.push(i);
  if (list.length === 0) {
    goToSummary();
    return;
  }
  state.mode = 'review';
  state.reviewList = list;
  state.reviewPos = 0;
  showScreen('question'); // 先に表示する（非表示要素への focus() は効かない）
  renderQuestion();
}

// ── まとめ（一覧） ──
function buildMiniScale(value, seen) {
  const scale = document.createElement('span');
  scale.className = 'dh-mini';
  if (value === null) {
    const skipped = document.createElement('span');
    skipped.className = 'dh-mini__skipped';
    skipped.textContent = seen ? PASS_LABEL : 'まだ';
    scale.appendChild(skipped);
    return scale;
  }
  VALUES.forEach(v => {
    const dot = document.createElement('span');
    dot.className = 'dh-mini__dot' + (v === value ? ' dh-mini__dot--on' : '');
    dot.textContent = String(v);
    scale.appendChild(dot);
  });
  return scale;
}

function buildEnd(text, iconName, side, near) {
  const end = document.createElement('span');
  end.className = `dh-row__end dh-row__end--${side}` + (near ? ' dh-row__end--near' : '');
  const icon = document.createElement('span');
  icon.className = 'material-symbols-rounded dh-row__icon';
  icon.textContent = iconName;
  const label = document.createElement('span');
  label.textContent = text;
  end.append(icon, label);
  return end;
}

// 一覧の行を押したとき: その問いだけを大きく出す
function openDetail(i) {
  state.mode = 'detail';
  state.detailIndex = i;
  showScreen('question');
  renderQuestion();
}

function goToSummary(focusIndex = null) {
  state.mode = 'answer';
  state.pending = null;
  state.detailIndex = null;
  summaryList.innerHTML = '';
  QUESTIONS.forEach((q, i) => {
    const value = state.answers[i];
    // 行は押せるボタン。押すとその問いを大きく出す（ボタンの中は span だけにする）
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'dh-row';
    row.dataset.index = String(i);
    row.setAttribute('aria-label', (value === null
      ? `${q.title} ${state.seen[i] ? PASS_LABEL : 'まだ'}`
      : `${q.title} ${value}（1は「${q.left}」、4は「${q.right}」）`) + '。押すと大きく出す');
    row.addEventListener('click', () => openDetail(i));

    const title = document.createElement('span');
    title.className = 'dh-row__title';
    title.textContent = q.title;

    const left = buildEnd(q.left, q.leftIcon, 'left', value !== null && value <= 2);
    const right = buildEnd(q.right, q.rightIcon, 'right', value !== null && value >= 3);

    const line = document.createElement('span');
    line.className = 'dh-row__line';
    line.append(left, buildMiniScale(value, state.seen[i]), right);
    line.setAttribute('aria-hidden', 'true');

    row.append(title, line);
    summaryList.appendChild(row);
  });
  showScreen('summary');
  // 大きく出した問いから戻ったときは、その行に戻す
  const back = focusIndex === null ? null : summaryList.querySelector(`[data-index="${focusIndex}"]`);
  if (back) {
    back.scrollIntoView({ block: 'center' });
    back.focus();
  } else {
    summaryTitle.focus();
  }
}

function buildResultText() {
  const lines = ['わたし、ぼくってどんな人？'];
  QUESTIONS.forEach((q, i) => {
    const value = state.answers[i];
    if (value === null) {
      lines.push(`・${q.title} ${state.seen[i] ? PASS_LABEL : 'まだ'}`);
      return;
    }
    const marks = VALUES.map(v => (v === value ? `[${v}]` : String(v))).join(' ');
    lines.push(`・${q.title} ${q.left} ${marks} ${q.right}`);
  });
  return lines.join('\n');
}

async function copyResult(button) {
  if (button.dataset.copyBusy) return;
  let copied = false;
  try {
    copied = await copyToClipboard(buildResultText(), button, { successText: 'コピーしました' });
  } catch (error) {
    copied = false;
  }
  if (!copied) showToast('コピーできませんでした。画面の答えを手で書きうつしてください', 'error');
}

function resetAll() {
  state.mode = 'answer';
  state.index = 0;
  state.answers = QUESTIONS.map(() => null);
  state.seen = QUESTIONS.map(() => false);
  state.pending = null;
  state.reviewList = [];
  state.reviewPos = 0;
  state.detailIndex = null;
}

// ── イベント ──
$('btn-start').addEventListener('click', () => {
  resetAll();
  showScreen('question');
  renderQuestion();
});

scaleButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const value = Number(btn.dataset.value);
    // 同じ数字をもう一度押すと選ぶ前にもどる
    if (state.mode !== 'answer') {
      const i = currentQuestionIndex();
      state.answers[i] = state.answers[i] === value ? null : value;
    } else {
      state.pending = state.pending === value ? null : value;
    }
    renderValue();
  });
});

btnNext.addEventListener('click', () => {
  if (state.mode === 'detail') {
    goToSummary(state.detailIndex);
    return;
  }
  if (state.mode === 'review') {
    if (state.reviewPos + 1 >= state.reviewList.length) {
      goToSummary();
    } else {
      state.reviewPos += 1;
      renderQuestion();
    }
    return;
  }
  if (state.pending === null || state.index >= QUESTIONS.length) return;
  state.answers[state.index] = state.pending;
  advanceAnswer();
});

btnSkip.addEventListener('click', () => {
  if (state.mode !== 'answer' || state.index >= QUESTIONS.length) return;
  state.answers[state.index] = null;
  advanceAnswer();
});

btnBack.addEventListener('click', () => {
  if (state.mode === 'detail') return;
  if (state.mode === 'review') {
    if (state.reviewPos === 0) return;
    state.reviewPos -= 1;
  } else {
    if (state.index === 0) return;
    state.index -= 1;
  }
  renderQuestion();
});

btnFinish.addEventListener('click', () => {
  if (state.mode !== 'answer' || state.index >= QUESTIONS.length) return;
  finishAnswering();
});

$('btn-copy').addEventListener('click', e => copyResult(e.currentTarget));

// メンター向け: キーボードの1〜4キーで選ぶ・Enter で「つぎへ」（答える画面・ふりかえり・一覧から開いた画面）
document.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  if (!$('screen-question').classList.contains('active')) return;
  if (document.querySelector('[aria-modal="true"].show')) return; // つかいかた・説明が開いているとき
  if (VALUES.includes(Number(e.key))) {
    e.preventDefault();
    document.querySelector(`.dh-scale__btn[data-value="${e.key}"]`).click();
    return;
  }
  // ほかのボタンにフォーカスがあるときの Enter は、そのボタンを押す（ブラウザにまかせる）。
  // 1〜4 の数字をマウスで押したあとの Enter は、選び直しでなく「つぎへ」にする
  const onScale = e.target.closest('.dh-scale__btn');
  if (e.key === 'Enter' && (onScale || !e.target.closest('button, a, input, textarea, select'))) {
    e.preventDefault();
    if (!btnNext.disabled) btnNext.click();
  }
});

$('btn-restart').addEventListener('click', () => {
  resetAll();
  showScreen('top');
});
