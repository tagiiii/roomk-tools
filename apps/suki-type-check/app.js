// すきタイプチェック — 18問の選択式で「すき」の傾向を出す診断ツール
// 仕様の正本: docs/sukina-map-renewal-plan.md ／ apps/suki-type-check/AGENTS.md
// 永続化 API（localStorage / sessionStorage / IndexedDB / Cookie）は一切呼ばない。
// 共通モジュール: copyToClipboard (M-2), showToast
import { copyToClipboard, showToast } from '../shared/js/utils.js';

const NUMBERS = ['①', '②', '③', '④', '⑤'];

// 5件法。5つとも同格に並べる（中間の「どちらでもない」だけ特別扱いしない）
const OPTIONS = [
  { key: 'a4', score: 4, label: 'あてはまる' },
  { key: 'a3', score: 3, label: 'やや当てはまる' },
  { key: 'a2', score: 2, label: 'どちらでもない' },
  { key: 'a1', score: 1, label: 'あまり当てはまらない' },
  { key: 'a0', score: 0, label: '当てはまらない' },
];

// 6軸。この配列の順序が「軸定義順」（同点時の表示順に使う）
const AXES = [
  {
    id: 'move',
    name: 'うごいて楽しむ',
    icon: 'directions_run',
    questions: [
      '体を動かしているときが、いちばん自分らしいと感じる',
      '頭で考えるより、まず動いてみたいほうだ',
      '体を思いきり動かしたあとの爽快感が好きだ',
    ],
    description: '考えるより先に、体のほうが動きだす。実際にやってみることで、世界の手ざわりを確かめていくタイプ。思いきり動いたあとの気持ちよさが、つぎの「やってみたい」につながっていく。',
    short: 'まず動いてみることで、世界を確かめていく',
    examples: ['スポーツ', 'ダンス', 'サイクリング', 'アスレチック', 'なわとび', '散歩', 'スケートボード'],
  },
  {
    id: 'make',
    name: 'つくってためす',
    icon: 'construction',
    questions: [
      '何かを自分の手で完成させたときの達成感が好きだ',
      'うまくいく方法をあれこれ試すのが楽しい',
      '「自分ならこう作る」「こう直したい」と考えることがある',
    ],
    description: '手を動かして形にしていく時間そのものが楽しい。試して、直して、だんだん良くなっていく感じが好きなタイプ。「できた」の手ごたえが、つぎの「つくりたい」につながっていく。',
    short: '手を動かして形にしていく過程が楽しい',
    examples: ['工作', '料理・おかしづくり', 'プラモデル', '木工・DIY', 'ゲームづくり', 'ブロックあそび', '手芸', 'かんたんな実験'],
  },
  {
    id: 'express',
    name: 'ひらめきをかたちにする',
    icon: 'palette',
    questions: [
      '自分の中にあるイメージや気持ちを、形にして伝えたくなる',
      '心が動いたものを、自分なりに表現してみたくなる',
      '自分のつくったもの・表現したものを、だれかに見てもらえるとうれしい',
    ],
    description: '頭の中にあるイメージを、外に出して伝えたくなる。心が動いたものを、自分なりの形にしていくタイプ。表現したものがだれかに届いたとき、うれしさがもう一度ふくらんでいく。',
    short: '頭の中のイメージを、外に出して伝えたくなる',
    examples: ['イラスト', 'マンガ', '音楽・楽器', '動画づくり', '物語を書く', '写真', 'うた', 'デザイン'],
  },
  {
    id: 'dig',
    name: 'とことんしらべる',
    icon: 'travel_explore',
    questions: [
      '気になったことは、納得するまで調べたくなる',
      '物事の仕組みや理由を知ると、わくわくする',
      'ひとつのことを深く掘り下げていくのが好きだ',
    ],
    description: '気になったことの「なぜ？」を追いかけて、深くもぐっていく。知れば知るほど面白くなっていくタイプ。ひとつのことを掘り下げるほど、その先にまた新しい入口が見えてくる。',
    short: '「なぜ？」を追いかけて、深くもぐっていく',
    examples: ['生き物', '宇宙', '歴史', '鉄道', 'ゲームの攻略', '地図', '天気', '図鑑を読む'],
  },
  {
    id: 'collect',
    name: 'あつめてととのえる',
    icon: 'inventory_2',
    questions: [
      '好きなものが少しずつそろっていく感覚が好きだ',
      'ものや情報がきれいに整理されていると気持ちいい',
      '「全部そろえたい」と思うことがある',
    ],
    description: 'そろえる・整える・ながめる時間に、しずかな喜びがある。少しずつ完成に近づいていく感じが好きなタイプ。ひとつ増えるたびに、自分の世界がていねいに広がっていく。',
    short: 'そろえる・整える・ながめることに喜びがある',
    examples: ['カード', 'フィギュア', '石や葉っぱの標本', 'ミニカー', 'シール', '図鑑', 'ぬいぐるみ', '部屋の模様がえ'],
  },
  {
    id: 'share',
    name: 'いっしょに楽しむ',
    icon: 'group',
    questions: [
      'だれかと一緒にやるほうが、楽しさが大きくなると感じる',
      '自分の好きなものの話を、人と共有したくなる',
      '人が喜んでくれると、自分もうれしくなる',
    ],
    description: '楽しさは、だれかと分かち合うと大きくなる。人と一緒だから力が出て、気持ちも大きく動いていくタイプ。すきなものの話をすることが、その場の楽しさをふくらませていく。',
    short: '楽しさは、人と分かち合うと大きくなる',
    examples: ['みんなであそぶゲーム', 'おしゃべり', 'だれかに教えること', 'いっしょに見る動画', 'チームであそぶこと', 'いっしょに料理', 'すきなものの紹介'],
  },
];

// フラット判定（どの軸も強く出なかったとき）用のタイプ
const FLAT_TYPE = {
  name: 'すきさがし',
  icon: 'explore',
  description: '今は「これ！」と言えるものを、さがしている途中。まだ形になっていないだけで、心が動く方向はこれから見えてくるタイプ。出会いはいくらでも残っているから、気になったものから ためしていけばいい。',
  note: 'まずは、さいきん見たもの・さわったものから 話してみよう',
};

const FLAT_MAX_AVG = 2.0;   // 全軸の最大平均がこれ以下ならフラット判定
const FLAT_EPSILON = 1e-9;  // 浮動小数対策
const ROUNDS = 3;

// 出題順: 軸①→⑥を1問ずつ3周する固定順（シャッフルしない）
const QUESTIONS = [];
for (let round = 0; round < ROUNDS; round += 1) {
  AXES.forEach(axis => QUESTIONS.push({ axisId: axis.id, text: axis.questions[round] }));
}

const state = {
  index: 0,
  answers: new Array(QUESTIONS.length).fill(null),
  currentScreen: null,
};

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  state.currentScreen = id;
  window.scrollTo(0, 0);
}

function optionByKey(key) {
  return OPTIONS.find(option => option.key === key) || null;
}

// 回答キーから点数を返す。未回答（まだ到達していない問）は null
function scoreOf(key) {
  const option = optionByKey(key);
  return option ? option.score : null;
}

function resetAnswers() {
  state.index = 0;
  state.answers = new Array(QUESTIONS.length).fill(null);
}

// ── スコアリング ───────────────────────────────
// 軸スコア = その軸3問の平均。% = 平均 ÷ 4 × 100 の四捨五入
function computeScores() {
  const stats = AXES.map(axis => {
    let sum = 0;
    QUESTIONS.forEach((question, index) => {
      if (question.axisId !== axis.id) return;
      sum += scoreOf(state.answers[index]) ?? 0;
    });
    const avg = sum / 3;
    return { axis, avg, percent: Math.round((avg / 4) * 100) };
  });
  return { stats };
}

// タイプ判定 = 最高スコアの軸。1位同点はハイブリッド（3軸以上同点なら軸定義順の上位2つ）
function determineType(stats) {
  const maxAvg = stats.reduce((max, entry) => Math.max(max, entry.avg), 0);
  if (maxAvg <= FLAT_MAX_AVG + FLAT_EPSILON) {
    return {
      kind: 'flat',
      axisIds: [],
      icons: [FLAT_TYPE.icon],
      title: `あなたは ${FLAT_TYPE.name}タイプ！`,
      description: FLAT_TYPE.description,
      examples: [],
      note: FLAT_TYPE.note,
    };
  }
  const top = stats.filter(entry => Math.abs(entry.avg - maxAvg) < FLAT_EPSILON);
  if (top.length === 1) {
    const axis = top[0].axis;
    return {
      kind: 'single',
      axisIds: [axis.id],
      icons: [axis.icon],
      title: `あなたは ${axis.name}タイプ！`,
      description: axis.description,
      examples: axis.examples,
      note: '',
    };
  }
  const [first, second] = [top[0].axis, top[1].axis]; // stats は軸定義順のまま
  return {
    kind: 'hybrid',
    axisIds: [first.id, second.id],
    icons: [first.icon, second.icon],
    title: `あなたは ${first.name}×${second.name} のハイブリッドタイプ！`,
    description: `${first.short}。そして、${second.short}。この2つがかさなっているのが、あなたの「すき」のかたち。`,
    examples: [...first.examples.slice(0, 4), ...second.examples.slice(0, 4)],
    note: '',
  };
}

function buildResult() {
  const { stats } = computeScores();
  const type = determineType(stats);
  const ranking = [...stats].sort((a, b) => b.avg - a.avg); // 同点は軸定義順（安定ソート）
  // 発表したタイプ以外で、いちばん高い軸を「2位への一言」に使う。
  // すきさがしタイプのときは見出しと矛盾して見えるため出さない
  const second = type.kind === 'flat'
    ? null
    : ranking.find(entry => !type.axisIds.includes(entry.axis.id) && entry.percent > 0) || null;
  return { type, ranking, second };
}

function buildResultText(result) {
  const lines = ['すきタイプチェック 結果', result.type.title];
  result.ranking.forEach(entry => lines.push(`・${entry.axis.name} ${entry.percent}%`));
  return lines.join('\n');
}

// ── 画面描画 ───────────────────────────────
function renderStart() {
  document.querySelector('#screen-start').innerHTML = `
    <div class="stc-panel">
      <h2 class="stc-panel__title" id="start-title" tabindex="-1">すきタイプチェック</h2>
      <p class="stc-panel__lead">18この質問にこたえていくと、じぶんの「すき」のタイプが出てきます。ぜんぶで10分くらい。</p>
      <ul class="stc-note-list">
        <li>正解はありません。ぱっと思ったほうでOK</li>
        <li>まよったときは、まんなかの「どちらでもない」でOK</li>
        <li>タイプは、話のきっかけにするためのものです</li>
      </ul>
      <div class="stc-actions">
        <button class="btn btn-primary btn-lg" type="button" data-action="start">はじめる</button>
      </div>
      <p class="stc-muted stc-muted--spaced">このアプリは、こたえた内容をどこにも保存しません。ページを閉じると消えます</p>
    </div>
  `;
}

function renderQuestion() {
  const total = QUESTIONS.length;
  const current = QUESTIONS[state.index];
  const chosen = state.answers[state.index];
  const percent = Math.round(((state.index + 1) / total) * 100);
  const optionsHtml = OPTIONS.map((option, index) => `
    <button class="stc-option" type="button" role="radio"
      aria-checked="${chosen === option.key ? 'true' : 'false'}"
      aria-label="${index + 1}番: ${esc(option.label)}"
      data-action="answer" data-value="${esc(option.key)}">
      <span class="stc-option__num" aria-hidden="true">${esc(NUMBERS[index])}</span>
      <span class="stc-option__text">${esc(option.label)}</span>
      <span class="material-symbols-rounded stc-option__check" aria-hidden="true">check_circle</span>
    </button>
  `).join('');

  document.querySelector('#screen-question').innerHTML = `
    <div class="stc-panel">
      <div class="stc-progress">
        <p class="stc-progress__text">${esc(String(state.index + 1))} / ${esc(String(total))}</p>
        <div class="stc-progress__track" aria-hidden="true">
          <div class="stc-progress__fill" style="width: ${esc(String(percent))}%"></div>
        </div>
      </div>
      <h2 class="stc-question" id="question-title" tabindex="-1">${esc(current.text)}</h2>
      <div class="stc-options" role="radiogroup" aria-label="どれくらい当てはまるか">
        ${optionsHtml}
      </div>
      <div class="stc-actions stc-actions--start">
        <button class="btn btn-ghost" type="button" data-action="back"${state.index === 0 ? ' disabled' : ''}>
          <span class="material-symbols-rounded" aria-hidden="true">arrow_back</span>ひとつ前にもどる
        </button>
      </div>
    </div>
  `;
  document.querySelector('#question-title')?.focus();
}

function renderResult(result) {
  const type = result.type;
  const iconsHtml = type.icons
    .map(icon => `<span class="material-symbols-rounded stc-type__icon" aria-hidden="true">${esc(icon)}</span>`)
    .join('');
  const examplesHtml = type.examples.length
    ? `
      <section class="stc-block">
        <h3 class="stc-block__title">こういうものが好きかも</h3>
        <ul class="stc-tags">
          ${type.examples.map(example => `<li class="stc-tag">${esc(example)}</li>`).join('')}
        </ul>
      </section>
    `
    : '';
  const noteHtml = type.note
    ? `
      <section class="stc-block">
        <p class="stc-note">${esc(type.note)}</p>
      </section>
    `
    : '';
  const barsHtml = result.ranking.map(entry => {
    const isTop = type.axisIds.includes(entry.axis.id);
    return `
      <li class="stc-bar${isTop ? ' stc-bar--top' : ''}">
        <div class="stc-bar__head">
          <span class="stc-bar__name">${esc(entry.axis.name)}</span>
          <span class="stc-bar__value">${esc(String(entry.percent))}%</span>
        </div>
        <div class="stc-bar__track" aria-hidden="true">
          <div class="stc-bar__fill" style="width: ${esc(String(entry.percent))}%"></div>
        </div>
      </li>
    `;
  }).join('');
  const secondHtml = result.second
    ? `<p class="stc-second">${esc(result.second.axis.name)}タイプの気質もあります</p>`
    : '';

  document.querySelector('#screen-result').innerHTML = `
    <div class="stc-panel">
      <div class="stc-type">
        <div class="stc-type__icons">${iconsHtml}</div>
        <h2 class="stc-panel__title stc-type__title" id="result-title" tabindex="-1">${esc(type.title)}</h2>
      </div>
      <p class="stc-type__desc">${esc(type.description)}</p>
      ${examplesHtml}
      ${noteHtml}
      <section class="stc-block">
        <h3 class="stc-block__title">6つの軸のわりあい</h3>
        <ul class="stc-bars">${barsHtml}</ul>
        ${secondHtml}
      </section>
      <p class="stc-prompt">近いなと思うところ、ちがうなと思うところはある？</p>
      <div class="stc-actions">
        <button class="btn btn-primary" id="btnCopy" type="button" data-action="copy">
          <span class="material-symbols-rounded" aria-hidden="true">content_copy</span>結果をコピー
        </button>
        <button class="btn btn-secondary" type="button" data-action="restart">
          <span class="material-symbols-rounded" aria-hidden="true">refresh</span>もういちどやる
        </button>
      </div>
    </div>
  `;
}

// ── 操作 ───────────────────────────────
let lastResult = null;
let lastAnswerAt = 0;

function goToResult() {
  lastResult = buildResult();
  showScreen('result');
  renderResult(lastResult);
  document.querySelector('#result-title')?.focus();
  window.RoomkStats?.count('result');
}

function answer(key) {
  if (!optionByKey(key)) return;
  // 連打ガード: 全置換描画で次問のボタンが同じ位置に出るため、
  // ダブルタップの2回目が次問への回答として記録されるのを防ぐ
  const now = Date.now();
  if (now - lastAnswerAt < 300) return;
  lastAnswerAt = now;
  state.answers[state.index] = key;
  if (state.index >= QUESTIONS.length - 1) {
    goToResult();
    return;
  }
  state.index += 1;
  renderQuestion();
}

async function copyResult(button) {
  // 連打中（コピー完了表示のリセット待ち）は copyToClipboard が false を返すため、
  // 誤ってエラートーストを出さないようここで抜ける
  if (!lastResult || button.dataset.copyBusy) return;
  let copied = false;
  try {
    copied = await copyToClipboard(buildResultText(lastResult), button, { successText: 'コピーしました' });
  } catch (error) {
    copied = false;
  }
  if (!copied) showToast('コピーできませんでした。結果を手で書きうつしてください', 'error');
}

function handleAction(action, button) {
  if (action === 'start') {
    resetAnswers();
    // showScreen を先に呼ぶ（非表示のままだと第1問の見出しに focus() が効かない）
    showScreen('question');
    renderQuestion();
    window.RoomkStats?.count('start');
  } else if (action === 'answer') {
    answer(button.dataset.value || '');
  } else if (action === 'back') {
    if (state.index === 0) return;
    state.index -= 1;
    renderQuestion();
  } else if (action === 'copy') {
    copyResult(button);
  } else if (action === 'restart') {
    resetAnswers();
    lastResult = null;
    showScreen('start');
    renderStart();
    document.querySelector('#start-title')?.focus();
  }
}

function init() {
  document.body.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });
  renderStart();
  showScreen('start');
}

init();
