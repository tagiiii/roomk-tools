const NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫'];
const APP_ID = 'sakusen-kaigi';
const SCHEMA_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ACTIVE_GOALS = 3;
const MAX_GOALS = 10;

const GOAL_CATEGORIES = [
  { id: 'life', label: 'せいかつ', icon: 'self_care',
    examples: ['おきたい時間におきる', 'ねるじゅんびをする', 'ごはんを食べる',
      'みじたくをする', 'ゆっくり休けいする', 'そとに出てみる'] },
  { id: 'learn', label: '学び・きょうみ', icon: 'menu_book',
    examples: ['気になることをしらべる', 'よみたい本をよむ', 'きょうざいにさわってみる',
      '決めた時間だけやってみる', 'あたらしいことをひとつためす'] },
  { id: 'activity', label: '習いごと・活動', icon: 'sports_soccer',
    examples: ['れんしゅうをする', 'じゅんびをする', 'さんかしてみる', 'さくひんをつくる'] },
  { id: 'hobby', label: 'しゅみ', icon: 'palette',
    examples: ['ゲームでやりたいことにちょうせん', 'なにかをつくる', 'どうがや本をたのしむ',
      'あつめているものをせいりする', 'すきなことを人にしょうかいする'] },
  { id: 'people', label: '人とのかかわり', icon: 'forum',
    examples: ['じぶんから話しかけてみる', 'たのみごとをしてみる', '気もちをつたえてみる',
      'あいさつをしてみる', 'いっしょになにかをする'] },
];

const WHEN_CHIPS = ['あさ', 'ひる', 'ゆうがた', 'よる', 'ねる前', 'きめない'];
const AMOUNT_CHIPS = ['1回だけ', '5分だけ', '15分くらい', '30分くらい', 'きりのいいところまで', 'きめない'];

const PLAN_STRATEGIES = [
  { id: 'time', label: 'やる時間を決める', icon: 'schedule' },
  { id: 'place', label: 'やる場所を決める', icon: 'location_on' },
  { id: 'first', label: 'さいしょの一歩だけ決める', icon: 'footprint' },
  { id: 'small', label: '量や時間を小さくする', icon: 'compress' },
  { id: 'prepare', label: 'ひつようなものを先に用意', icon: 'inventory_2' },
  { id: 'visible', label: '見える場所におく', icon: 'visibility' },
  { id: 'timer', label: 'タイマーや通知をつかう', icon: 'alarm' },
  { id: 'voice', label: 'だれかに声をかけてもらう', icon: 'record_voice_over' },
  { id: 'together', label: 'いっしょにやってもらう', icon: 'group' },
  { id: 'planb', label: 'うまくいかないときの べつの作戦も決める', icon: 'alt_route' },
  { id: 'end', label: 'どこまでやったら おわりにするか決める', icon: 'flag' },
];

const FILE_MARKERS = {
  colors: [
    { label: 'そらいろ', romaji: 'sora' },
    { label: 'みどり', romaji: 'midori' },
    { label: 'きいろ', romaji: 'kiiro' },
    { label: 'ももいろ', romaji: 'momo' },
    { label: 'むらさき', romaji: 'murasaki' },
    { label: 'あか', romaji: 'aka' },
    { label: 'しろ', romaji: 'shiro' },
    { label: 'ぎんいろ', romaji: 'gin' },
  ],
  animals: [
    { label: 'ネコ', romaji: 'neko', icon: 'pets' },
    { label: 'イヌ', romaji: 'inu', icon: 'pets' },
    { label: 'ウサギ', romaji: 'usagi', icon: 'cruelty_free' },
    { label: 'ペンギン', romaji: 'pengin', icon: 'icecream' },
    { label: 'イルカ', romaji: 'iruka', icon: 'waves' },
    { label: 'リス', romaji: 'risu', icon: 'park' },
    { label: 'フクロウ', romaji: 'fukurou', icon: 'nightlight' },
    { label: 'パンダ', romaji: 'panda', icon: 'forest' },
  ],
};

const RATING_LABELS = {
  1: '今回は ためす タイミングが なかった',
  2: 'ちょっとだけ ためせた',
  3: '半分くらい できたかんじ',
  4: 'だいたい できたかんじ',
  5: '思ったように できた',
};

const POINT_GROUPS = {
  wentWell: [
    { id: 'method-fit', label: 'やり方が合っていた' },
    { id: 'small-good', label: '小さくしたのがよかった' },
    { id: 'help-good', label: 'だれかの助けがよかった' },
  ],
  wasHard: [
    { id: 'time-place', label: '時間や場所が合わなかった' },
    { id: 'forgot', label: 'わすれていた' },
    { id: 'difficult', label: '思ったよりむずかしかった' },
    { id: 'no-room', label: '今週はよゆうがなかった' },
    { id: 'feeling', label: '気もちがかわった' },
  ],
};

const STATUS_LABELS = {
  active: 'とりくみ中',
  paused: 'おやすみ中',
  done: 'おえた',
};

const STEP_BY_SCREEN = {
  start: null,
  'load-confirm': null,
  home: null,
  'goal-category': 'goal',
  'goal-example': 'goal',
  'goal-build': 'goal',
  plan: 'plan',
  confirm: 'plan',
  save: 'do',
  'check-last': 'check',
  'check-rating': 'check',
  'check-points': 'check',
  'check-next': 'check',
};

const state = {
  record: null,
  dirty: false,
  currentScreen: null,
  draft: {},
};

let toastTimer = null;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function trimText(value, max) {
  return String(value ?? '').trim().slice(0, max);
}

function nowIso() {
  return new Date().toISOString();
}

function randomIndex(max) {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] % max;
}

function makeId(prefix) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, b => chars[b % chars.length]).join('')}`;
}

function makeMarker() {
  const color = FILE_MARKERS.colors[randomIndex(FILE_MARKERS.colors.length)];
  const animal = FILE_MARKERS.animals[randomIndex(FILE_MARKERS.animals.length)];
  return { color: color.label, animal: animal.label };
}

function markerParts(marker) {
  const color = FILE_MARKERS.colors.find(item => item.label === marker?.color) || FILE_MARKERS.colors[0];
  const animal = FILE_MARKERS.animals.find(item => item.label === marker?.animal) || FILE_MARKERS.animals[0];
  return { color, animal };
}

function createRecord() {
  const createdAt = nowIso();
  return {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    fileMarker: makeMarker(),
    createdAt,
    updatedAt: createdAt,
    goals: [],
  };
}

function setDirty(value = true) {
  state.dirty = value;
}

function activeGoals() {
  return (state.record?.goals || []).filter(goal => goal.status === 'active');
}

function findGoal(id) {
  return (state.record?.goals || []).find(goal => goal.id === id) || null;
}

function latestPlan(goal, statuses = null) {
  const plans = goal?.plans || [];
  const filtered = statuses ? plans.filter(plan => statuses.includes(plan.status)) : plans;
  return filtered.length ? filtered[filtered.length - 1] : null;
}

function strategyLabel(id) {
  return PLAN_STRATEGIES.find(item => item.id === id)?.label || null;
}

function planLabels(plan) {
  if (!plan || plan.status === 'undecided') return ['今は決めない'];
  const labels = (plan.strategies || []).map(strategyLabel).filter(Boolean);
  if (plan.customStrategy) labels.push(plan.customStrategy);
  return labels.length ? labels : ['今は決めない'];
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('active');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('active'), 2600);
}

function setStartError(message) {
  state.draft.startError = message;
  renderStart();
  showScreen('start');
}

function stepperHtml(current) {
  const steps = [
    { id: 'goal', label: 'めあて', icon: 'flag' },
    { id: 'plan', label: 'さくせん', icon: 'route' },
    { id: 'do', label: 'ためす', icon: 'directions_run' },
    { id: 'check', label: 'ふりかえり', icon: 'fact_check' },
  ];
  return steps.map(step => {
    const isCurrent = step.id === current;
    return `
      <li class="sk-stepper__step${isCurrent ? ' sk-stepper__step--current' : ''}"${isCurrent ? ' aria-current="step"' : ''}>
        <span class="material-symbols-rounded sk-stepper__icon" aria-hidden="true">${esc(step.icon)}</span>
        <span class="sk-stepper__label">${esc(step.label)}</span>
      </li>
    `;
  }).join('');
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  state.currentScreen = id;
  document.querySelector('#stepper').innerHTML = stepperHtml(STEP_BY_SCREEN[id]);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function markerHtml(record = state.record) {
  const parts = markerParts(record?.fileMarker);
  return `
    <div class="sk-marker">
      <span class="material-symbols-rounded" aria-hidden="true">${esc(parts.animal.icon)}</span>
      <span>${esc(parts.color.label)}の${esc(parts.animal.label)}</span>
    </div>
  `;
}

function statusBadge(status) {
  const icon = status === 'done' ? '<span class="material-symbols-rounded" aria-hidden="true">check_circle</span>' : '';
  const modifier = status === 'active' ? ' sk-status--active' : status === 'done' ? ' sk-status--done' : '';
  return `<span class="sk-status${modifier}">${icon}${esc(STATUS_LABELS[status] || 'おやすみ中')}</span>`;
}

function numberedChoice({ index, text, icon = null, action, checked = false, pressed = null, value = '' }) {
  const aria = pressed === null
    ? `role="radio" aria-checked="${checked ? 'true' : 'false'}"`
    : `aria-pressed="${pressed ? 'true' : 'false'}"`;
  return `
    <button class="sk-choice" type="button" data-action="${esc(action)}" data-value="${esc(value)}" ${aria} aria-label="${index + 1}番: ${esc(text)}">
      <span class="sk-choice__num">${esc(NUMBERS[index])}</span>
      ${icon ? `<span class="material-symbols-rounded sk-choice__icon" aria-hidden="true">${esc(icon)}</span>` : ''}
      <span class="sk-choice__text">${esc(text)}</span>
      <span class="material-symbols-rounded sk-choice__check" aria-hidden="true">check_circle</span>
    </button>
  `;
}

function specialButton(text, action, value = '', classes = 'sk-choice') {
  return `
    <button class="${esc(classes)}" type="button" data-action="${esc(action)}" data-value="${esc(value)}">
      <span class="sk-choice__text">${esc(text)}</span>
    </button>
  `;
}

function renderStart() {
  const el = document.querySelector('#screen-start');
  const error = state.draft.startError
    ? `<div class="alert alert-error sk-alert" aria-live="assertive">${esc(state.draft.startError)}</div>`
    : '';
  el.innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="start-title">さくせん会議</h2>
      <p class="sk-panel__lead">めあてを決めて、さくせんを立てて、ためして、ふりかえろう</p>
      ${error}
      <div class="sk-choice-grid" role="group" aria-label="はじめ方">
        <button class="sk-choice" type="button" data-action="start-new">
          <span class="sk-choice__num">①</span>
          <span class="sk-choice__text">はじめて さくせん会議をする</span>
        </button>
        <label class="sk-choice sk-file-label" for="recordFile">
          <span class="sk-choice__num">②</span>
          <span class="sk-choice__text">前回のファイルをひらく</span>
        </label>
      </div>
      <p class="sk-muted" style="margin-top: var(--space-md);">このアプリはデータをどこにも保存しません。おわるときにファイルをダウンロードして持ち帰ります</p>
    </div>
  `;
}

function renderLoadConfirm() {
  const record = state.draft.importRecord;
  const goals = record?.goals || [];
  const lastDate = formatDate(record?.updatedAt);
  document.querySelector('#screen-load-confirm').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="load-confirm-title">この記録でつづきをはじめる？</h2>
      ${markerHtml(record)}
      <p class="sk-muted" style="margin-top: var(--space-md);">さいごの会議：${esc(lastDate)}</p>
      <ul class="sk-list">
        ${goals.map(goal => `
          <li class="sk-list__item">
            <strong>${esc(goal.title)}</strong><br>
            ${statusBadge(goal.status)}
            <span class="sk-muted">さくせん回数：${esc(String((goal.plans || []).length))}</span>
          </li>
        `).join('') || '<li class="sk-list__item">めあてはまだありません</li>'}
      </ul>
      <div class="sk-actions">
        <button class="btn btn-primary" type="button" data-action="accept-import">①この記録ではじめる</button>
        <label class="btn btn-ghost" for="recordFile">②ちがうファイルをえらび直す</label>
      </div>
    </div>
  `;
}

function renderHome(reason = '') {
  const record = state.record;
  const goals = record?.goals || [];
  const activeCount = activeGoals().length;
  const canAdd = activeCount < MAX_ACTIVE_GOALS && goals.length < MAX_GOALS;
  const allClosed = goals.length > 0 && goals.every(goal => goal.status !== 'active');
  const alert = reason ? `<div class="alert alert-info sk-alert">${esc(reason)}</div>` : '';
  const addLimit = goals.length >= MAX_GOALS
    ? '<p class="sk-muted">これ以上あたらしいめあてを追加できません。おわっためあてはファイルにのこります</p>'
    : '';
  document.querySelector('#screen-home').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="home-title">いまのめあて</h2>
      ${record ? markerHtml(record) : ''}
      ${alert}
      <div class="sk-board">
        ${goals.length ? goals.map(goalCardHtml).join('') : '<div class="sk-empty">まだめあてはありません</div>'}
      </div>
      ${allClosed && canAdd ? '<div class="sk-actions"><button class="btn btn-primary" type="button" data-action="add-goal">あたらしいめあてを決める</button></div>' : ''}
      <div class="sk-actions sk-actions--between">
        <div>
          ${canAdd && !allClosed ? '<button class="btn btn-ghost" type="button" data-action="add-goal">もう1つ めあてを追加する</button>' : ''}
          ${addLimit}
        </div>
        <button class="btn btn-primary" type="button" data-action="go-save">きょうの会議をおわる</button>
      </div>
    </div>
  `;
}

function goalCardHtml(goal) {
  const openPlan = latestPlan(goal, ['open']);
  const currentPlan = openPlan || latestPlan(goal, ['undecided']) || latestPlan(goal);
  const labels = planLabels(currentPlan);
  let action = '';
  if (goal.status === 'active') {
    action = openPlan
      ? `<button class="btn btn-secondary" type="button" data-action="review-goal" data-value="${esc(goal.id)}">ふりかえる</button>`
      : `<button class="btn btn-secondary" type="button" data-action="plan-for-goal" data-value="${esc(goal.id)}">つづきを決める</button>`;
  } else if (goal.status === 'paused') {
    action = `<button class="btn btn-secondary" type="button" data-action="resume-goal" data-value="${esc(goal.id)}">また とりくむ</button>`;
  }
  return `
    <article class="sk-board__card">
      <div class="sk-board__title-row">
        <div class="sk-board__title">${esc(goal.title)}</div>
        ${statusBadge(goal.status)}
      </div>
      <p class="sk-board__plan">いまのさくせん：${esc(labels.join('、'))}</p>
      ${action ? `<div class="sk-actions">${action}</div>` : ''}
    </article>
  `;
}

function startGoalFlow(mode, selectedGoalId = null, oldGoalStatus = null) {
  if (!state.record) state.record = createRecord();
  state.draft = {
    ...state.draft,
    mode,
    selectedGoalId,
    oldGoalStatus,
    goal: {
      category: null,
      example: null,
      customTitle: '',
      when: 'きめない',
      amount: 'きめない',
      customWhen: '',
      customAmount: '',
      customWhenOpen: false,
      customAmountOpen: false,
    },
    plan: { strategies: [], customStrategy: '', undecided: false },
    confirmBack: 'plan',
  };
  setDirty(true);
  renderGoalCategory();
  showScreen('goal-category');
}

function renderGoalCategory() {
  document.querySelector('#screen-goal-category').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="goal-category-title">どんなことに とりくんでみたい？</h2>
      <div class="sk-choice-grid" role="radiogroup" aria-labelledby="goal-category-title">
        ${GOAL_CATEGORIES.map((category, index) => numberedChoice({
          index,
          text: category.label,
          icon: category.icon,
          action: 'choose-category',
          value: category.id,
          checked: state.draft.goal?.category === category.id,
        })).join('')}
      </div>
      <div class="sk-specials">
        ${specialButton('じぶんで決める', 'custom-goal-category')}
      </div>
      ${backActionsHtml()}
    </div>
  `;
}

function renderGoalExample() {
  const category = GOAL_CATEGORIES.find(item => item.id === state.draft.goal?.category);
  document.querySelector('#screen-goal-example').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="goal-example-title">たとえば、こんなこと。近いものはある？</h2>
      <div class="sk-choice-grid" role="radiogroup" aria-labelledby="goal-example-title">
        ${(category?.examples || []).map((example, index) => numberedChoice({
          index,
          text: example,
          action: 'choose-example',
          value: example,
          checked: state.draft.goal?.example === example,
        })).join('')}
      </div>
      <div class="sk-specials">
        ${specialButton('あてはまるものがない → じぶんで決める', 'custom-goal-example')}
        ${specialButton('← べつのカテゴリを見る', 'back-goal-category')}
      </div>
      ${backActionsHtml()}
    </div>
  `;
}

function goalTitlePreview() {
  const goal = state.draft.goal || {};
  const base = trimText(goal.customTitle, 60) || goal.example || '';
  if (!base) return '';
  if (goal.customTitle) return base;
  const when = goal.customWhenOpen ? trimText(goal.customWhen, 30) || 'きめない' : goal.when || 'きめない';
  const amount = goal.customAmountOpen ? trimText(goal.customAmount, 30) || 'きめない' : goal.amount || 'きめない';
  const prefix = when !== 'きめない' ? `${when}、` : '';
  const suffix = amount !== 'きめない' ? `（${amount}）` : '';
  return `${prefix}${base}${suffix}`;
}

function renderGoalBuild() {
  const goal = state.draft.goal || {};
  const isCustom = !goal.example;
  const preview = isCustom
    ? trimText(goal.customTitle, 60)
    : `「${goal.example || ''}」を〔いつ：${goal.customWhenOpen ? trimText(goal.customWhen, 30) || 'きめない' : goal.when || 'きめない'}〕〔どのくらい：${goal.customAmountOpen ? trimText(goal.customAmount, 30) || 'きめない' : goal.amount || 'きめない'}〕`;
  const canProceed = goalTitlePreview().length > 0;
  document.querySelector('#screen-goal-build').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="goal-build-title">めあてを くみたてよう</h2>
      <div class="sk-builder">
        <div class="sk-preview" id="goalPreview">${esc(preview || ' ')}</div>
        ${isCustom ? customGoalFieldHtml(goal) : slotBuilderHtml(goal)}
      </div>
      <div class="sk-actions">
        <button class="btn btn-primary" id="goalSubmit" type="button" data-action="goal-to-plan"${canProceed ? '' : ' disabled'}>これでいい</button>
      </div>
      ${backActionsHtml()}
    </div>
  `;
}

function customGoalFieldHtml(goal) {
  return `
    <label class="sk-field">
      <span class="sk-field__label">めあて</span>
      <input class="sk-field__input" id="customGoalTitle" maxlength="60" value="${esc(goal.customTitle || '')}" data-input="custom-title" />
      <span class="sk-muted">なまえ・学校名などは書かないでね</span>
    </label>
  `;
}

function slotBuilderHtml(goal) {
  return `
    <div class="sk-field">
      <div class="sk-field__label">いつ</div>
      <div class="sk-chip-row" role="radiogroup" aria-label="いつ">
        ${WHEN_CHIPS.map(chip => `
          <button class="sk-chip" type="button" role="radio" aria-checked="${goal.when === chip && !goal.customWhenOpen ? 'true' : 'false'}" data-action="set-when" data-value="${esc(chip)}">${esc(chip)}</button>
        `).join('')}
        <button class="sk-chip" type="button" role="radio" aria-checked="${goal.customWhenOpen ? 'true' : 'false'}" data-action="open-custom-when">じぶんで決める</button>
      </div>
      ${goal.customWhenOpen ? `
        <input class="sk-field__input" maxlength="30" value="${esc(goal.customWhen || '')}" data-input="custom-when" />
        <span class="sk-muted">なまえ・学校名などは書かないでね</span>
      ` : ''}
    </div>
    <div class="sk-field">
      <div class="sk-field__label">どのくらい</div>
      <div class="sk-chip-row" role="radiogroup" aria-label="どのくらい">
        ${AMOUNT_CHIPS.map(chip => `
          <button class="sk-chip" type="button" role="radio" aria-checked="${goal.amount === chip && !goal.customAmountOpen ? 'true' : 'false'}" data-action="set-amount" data-value="${esc(chip)}">${esc(chip)}</button>
        `).join('')}
        <button class="sk-chip" type="button" role="radio" aria-checked="${goal.customAmountOpen ? 'true' : 'false'}" data-action="open-custom-amount">じぶんで決める</button>
      </div>
      ${goal.customAmountOpen ? `
        <input class="sk-field__input" maxlength="30" value="${esc(goal.customAmount || '')}" data-input="custom-amount" />
        <span class="sk-muted">なまえ・学校名などは書かないでね</span>
      ` : ''}
    </div>
  `;
}

function renderPlan() {
  const draftPlan = state.draft.plan || { strategies: [], customStrategy: '', undecided: false };
  const hasPlan = draftPlan.strategies.length > 0 || trimText(draftPlan.customStrategy, 80).length > 0;
  document.querySelector('#screen-plan').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="plan-title">どれなら ためせそう？（1〜3こまで）</h2>
      <div class="sk-choice-grid" aria-labelledby="plan-title">
        ${PLAN_STRATEGIES.map((strategy, index) => numberedChoice({
          index,
          text: strategy.label,
          icon: strategy.icon,
          action: 'toggle-strategy',
          value: strategy.id,
          pressed: draftPlan.strategies.includes(strategy.id),
        })).join('')}
      </div>
      <div class="sk-specials">
        ${specialButton('じぶんで さくせんを書く', 'open-custom-strategy')}
        ${draftPlan.customOpen ? `
          <label class="sk-field">
            <span class="sk-field__label">じぶんで書くさくせん</span>
            <input class="sk-field__input" maxlength="80" value="${esc(draftPlan.customStrategy || '')}" data-input="custom-strategy" />
            <span class="sk-muted">なまえ・学校名などは書かないでね</span>
          </label>
        ` : ''}
        ${specialButton('今は決めない', 'plan-undecided')}
      </div>
      <div class="sk-actions">
        <button class="btn btn-primary" id="planSubmit" type="button" data-action="plan-to-confirm"${hasPlan ? '' : ' disabled'}>この さくせんにする</button>
      </div>
      ${backActionsHtml()}
    </div>
  `;
}

function renderConfirm() {
  const title = state.draft.pendingTitle || goalTitlePreview() || findGoal(state.draft.selectedGoalId)?.title || '';
  const plan = state.draft.plan || {};
  const labels = plan.undecided ? ['今は決めない'] : planLabels({ strategies: plan.strategies || [], customStrategy: trimText(plan.customStrategy, 80), status: 'open' });
  document.querySelector('#screen-confirm').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="confirm-title">これで いってみる？</h2>
      <div class="sk-board__card">
        <div class="sk-board__title">${esc(title)}</div>
        <ul class="sk-list">
          ${labels.map(label => `<li class="sk-list__item">${esc(label)}</li>`).join('')}
        </ul>
        <p class="sk-muted" style="margin-top: var(--space-md);">つぎの会議まで、ためしてみる期間だよ（ためす＝Do）</p>
      </div>
      <div class="sk-actions">
        <button class="btn btn-primary" type="button" data-action="confirm-apply">①これでいく</button>
        <button class="btn btn-ghost" type="button" data-action="confirm-back">②なおすところがある</button>
      </div>
    </div>
  `;
}

function renderSave(downloaded = false) {
  const filename = exportFilename();
  document.querySelector('#screen-save').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="save-title">きょうの記録を ほぞんしよう</h2>
      ${markerHtml()}
      <p class="sk-muted" style="margin-top: var(--space-md);">ファイル名：${esc(filename)}</p>
      <div class="alert alert-info sk-alert">じゆうに書いたところに、なまえ・学校名などの個人じょうほうが入っていないか、たしかめてください</div>
      <div class="sk-actions">
        <button class="btn btn-primary" type="button" data-action="download-record">記録ファイルをダウンロード</button>
      </div>
      ${downloaded ? `
        <div class="alert alert-info sk-alert">ダウンロードしました。Googleドライブへの保存はメンターがおこないます</div>
        <div class="sk-actions">
          <button class="btn btn-secondary" type="button" data-action="back-home">ボードにもどる</button>
          <button class="btn btn-ghost" type="button" data-action="finish-session">これでおわる</button>
        </div>
      ` : ''}
    </div>
  `;
}

function renderCheckLast() {
  const goal = findGoal(state.draft.selectedGoalId);
  const plan = latestPlan(goal, ['open']);
  document.querySelector('#screen-check-last').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="check-last-title">前回の さくせん会議</h2>
      <div class="sk-board__card">
        <div class="sk-board__title">${esc(goal?.title || '')}</div>
        <ul class="sk-list">
          ${planLabels(plan).map(label => `<li class="sk-list__item">${esc(label)}</li>`).join('')}
        </ul>
        <p class="sk-panel__lead">ためしてみて、どうだった？</p>
      </div>
      ${historyHtml(goal)}
      <div class="sk-actions">
        <button class="btn btn-primary" type="button" data-action="go-rating">ふりかえりに すすむ</button>
      </div>
      <div class="sk-specials">
        ${specialButton('今回はふりかえらない', 'skip-check')}
      </div>
      ${backActionsHtml()}
    </div>
  `;
}

function historyHtml(goal) {
  const items = (goal?.plans || []).map(plan => {
    const check = plan.check;
    const ratingText = check
      ? check.rating
        ? `そのとき自分でつけた感覚: ${check.rating}（${RATING_LABELS[check.rating]}）`
        : check.ratingSpecial
          ? `そのとき自分でつけた感覚: ${ratingSpecialLabel(check.ratingSpecial)}`
          : 'そのとき自分でつけた感覚: —'
      : 'ふりかえり: —';
    return `
      <div class="sk-history__item">
        <div class="sk-muted">${esc(formatDate(plan.createdAt))}</div>
        <div>${planLabels(plan).map(esc).join('、')}</div>
        <div class="sk-muted">${esc(ratingText)}</div>
        ${check?.note ? `<div class="sk-muted">ひとことメモ: ${esc(check.note)}</div>` : ''}
      </div>
    `;
  }).join('');
  return `
    <details class="sk-history">
      <summary class="sk-history__summary">これまでのあゆみ</summary>
      <div class="sk-history__list">${items || '<div class="sk-empty">まだありません</div>'}</div>
    </details>
  `;
}

function ratingSpecialLabel(value) {
  return {
    'hard-to-say': '数字では決めにくい',
    'no-talk': '話さなくてもよい',
    'skip-check': '今回はふりかえらない',
  }[value] || '—';
}

function renderCheckRating() {
  const check = state.draft.check || {};
  document.querySelector('#screen-check-rating').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="check-rating-title">じぶんでは、どのくらい できたかんじがする？</h2>
      <p class="sk-panel__lead">せいせきや点数じゃないよ。じぶんの かんじたままでOK</p>
      <div class="sk-choice-grid sk-choice-grid--rating" role="radiogroup" aria-labelledby="check-rating-title">
        ${Object.entries(RATING_LABELS).map(([value, label], index) => `
          <button class="sk-radio-card" type="button" role="radio" aria-checked="${check.rating === Number(value) ? 'true' : 'false'}" data-action="choose-rating" data-value="${esc(value)}">
            <span class="sk-choice__num">${esc(String(value))}</span>
            <span class="sk-choice__text">${esc(label)}</span>
            <span class="material-symbols-rounded sk-choice__check" aria-hidden="true">check_circle</span>
          </button>
        `).join('')}
      </div>
      <div class="sk-specials sk-specials--inline">
        ${specialButton('数字では決めにくい', 'choose-rating-special', 'hard-to-say')}
        ${specialButton('話さなくてもよい', 'choose-rating-special', 'no-talk')}
      </div>
      ${backActionsHtml()}
    </div>
  `;
}

function renderCheckPoints() {
  const check = state.draft.check || { wentWell: [], wasHard: [] };
  document.querySelector('#screen-check-points').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="check-points-title">今回のこと、あてはまるものはある？（いくつでも・なくてもOK）</h2>
      ${pointGroupHtml('よかったかも', 'wentWell', POINT_GROUPS.wentWell, check.wentWell || [])}
      ${pointGroupHtml('うまくいきにくかったかも', 'wasHard', POINT_GROUPS.wasHard, check.wasHard || [])}
      <div class="sk-specials sk-specials--inline">
        ${specialButton('どれともちがう', 'choose-points-special', 'none-fit')}
        ${specialButton('話さなくてもよい', 'choose-points-special', 'no-talk')}
      </div>
      <label class="sk-field" style="margin-top: var(--space-lg);">
        <span class="sk-field__label">ひとことメモ</span>
        <textarea class="sk-field__textarea" maxlength="120" data-input="check-note">${esc(check.note || '')}</textarea>
        <span class="sk-muted">なまえ・学校名などは書かないでね</span>
      </label>
      <div class="sk-actions">
        <button class="btn btn-primary" type="button" data-action="go-check-next">つぎへ</button>
      </div>
      ${backActionsHtml()}
    </div>
  `;
}

function pointGroupHtml(title, key, items, selected) {
  return `
    <div class="sk-field" style="margin-top: var(--space-lg);">
      <div class="sk-field__label">${esc(title)}</div>
      <div class="sk-choice-grid">
        ${items.map(item => `
          <button class="sk-check-card" type="button" aria-pressed="${selected.includes(item.id) ? 'true' : 'false'}" data-action="toggle-point" data-group="${esc(key)}" data-value="${esc(item.id)}">
            <span class="sk-choice__text">${esc(item.label)}</span>
            <span class="material-symbols-rounded sk-choice__check" aria-hidden="true">check_circle</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function renderCheckNext() {
  const inline = state.draft.nextInline || null;
  document.querySelector('#screen-check-next').innerHTML = `
    <div class="sk-panel">
      <h2 class="sk-panel__title" id="check-next-title">つぎは、どうしてみる？</h2>
      <p class="sk-panel__lead">前とおなじでも、変えても、どっちでもいいよ</p>
      <div class="sk-choice-grid" role="radiogroup" aria-labelledby="check-next-title">
        ${['この さくせんを つづける', 'さくせんを 変えてみる', 'めあてを 変える', 'いったん おしまいにする'].map((label, index) => numberedChoice({
          index,
          text: label,
          action: ['next-continue', 'next-change-plan', 'next-change-goal', 'next-finish'][index],
          value: '',
          checked: false,
        })).join('')}
      </div>
      ${inline === 'finish' ? `
        <div class="sk-inline-panel">
          <div class="sk-field__label">いったん おしまいにする</div>
          <div class="sk-specials sk-specials--inline">
            ${specialButton('またやるかも（おやすみにする）', 'finalize-pause')}
            ${specialButton('ここでひと区切り（おわりにする）', 'finalize-done')}
          </div>
        </div>
      ` : ''}
      ${inline === 'change-goal' ? `
        <div class="sk-inline-panel">
          <div class="sk-field__label">今のめあては？</div>
          <div class="sk-specials sk-specials--inline">
            ${specialButton('おやすみにする', 'change-goal-status', 'paused')}
            ${specialButton('おわりにする', 'change-goal-status', 'done')}
          </div>
        </div>
      ` : ''}
      ${backActionsHtml()}
    </div>
  `;
}

function backActionsHtml() {
  return `
    <div class="sk-actions">
      <button class="btn btn-ghost" type="button" data-action="back">← もどる</button>
    </div>
  `;
}

function goBack() {
  const screen = state.currentScreen;
  if (screen === 'goal-category') {
    if (state.record?.goals?.length) {
      renderHome();
      showScreen('home');
    } else {
      renderStart();
      showScreen('start');
    }
  } else if (screen === 'goal-example') {
    renderGoalCategory();
    showScreen('goal-category');
  } else if (screen === 'goal-build') {
    if (state.draft.goal?.category) {
      renderGoalExample();
      showScreen('goal-example');
    } else {
      renderGoalCategory();
      showScreen('goal-category');
    }
  } else if (screen === 'plan') {
    if (['plan-only', 'change-plan'].includes(state.draft.mode)) {
      renderHome();
      showScreen('home');
    } else {
      renderGoalBuild();
      showScreen('goal-build');
    }
  } else if (screen === 'check-last') {
    renderHome();
    showScreen('home');
  } else if (screen === 'check-rating') {
    renderCheckLast();
    showScreen('check-last');
  } else if (screen === 'check-points') {
    renderCheckRating();
    showScreen('check-rating');
  } else if (screen === 'check-next') {
    renderCheckPoints();
    showScreen('check-points');
  }
}

function handleAction(action, button) {
  const value = button.dataset.value || '';
  if (action === 'start-new') {
    state.record = createRecord();
    state.draft.startError = '';
    startGoalFlow('new-goal');
  } else if (action === 'accept-import') {
    state.record = state.draft.importRecord;
    state.draft = {};
    setDirty(false);
    renderHome();
    showScreen('home');
  } else if (action === 'add-goal') {
    startGoalFlow('add-goal');
  } else if (action === 'go-save') {
    renderSave();
    showScreen('save');
  } else if (action === 'choose-category') {
    state.draft.goal.category = value;
    state.draft.goal.example = null;
    state.draft.goal.customTitle = '';
    renderGoalExample();
    showScreen('goal-example');
  } else if (action === 'custom-goal-category' || action === 'custom-goal-example') {
    state.draft.goal.category = action === 'custom-goal-category' ? 'custom' : state.draft.goal.category;
    state.draft.goal.example = null;
    renderGoalBuild();
    showScreen('goal-build');
  } else if (action === 'choose-example') {
    state.draft.goal.example = value;
    state.draft.goal.customTitle = '';
    renderGoalBuild();
    showScreen('goal-build');
  } else if (action === 'back-goal-category') {
    renderGoalCategory();
    showScreen('goal-category');
  } else if (action === 'set-when') {
    state.draft.goal.when = value;
    state.draft.goal.customWhenOpen = false;
    renderGoalBuild();
  } else if (action === 'set-amount') {
    state.draft.goal.amount = value;
    state.draft.goal.customAmountOpen = false;
    renderGoalBuild();
  } else if (action === 'open-custom-when') {
    state.draft.goal.customWhenOpen = true;
    renderGoalBuild();
  } else if (action === 'open-custom-amount') {
    state.draft.goal.customAmountOpen = true;
    renderGoalBuild();
  } else if (action === 'goal-to-plan') {
    state.draft.pendingTitle = goalTitlePreview();
    renderPlan();
    showScreen('plan');
  } else if (action === 'toggle-strategy') {
    toggleStrategy(value);
  } else if (action === 'open-custom-strategy') {
    state.draft.plan.customOpen = true;
    renderPlan();
  } else if (action === 'plan-undecided') {
    state.draft.plan = { strategies: [], customStrategy: '', customOpen: false, undecided: true };
    renderConfirm();
    showScreen('confirm');
  } else if (action === 'plan-to-confirm') {
    state.draft.plan.undecided = false;
    renderConfirm();
    showScreen('confirm');
  } else if (action === 'confirm-apply') {
    applyConfirm();
  } else if (action === 'confirm-back') {
    renderPlan();
    showScreen('plan');
  } else if (action === 'review-goal') {
    state.draft = { ...state.draft, selectedGoalId: value, check: emptyCheck(), nextInline: null };
    renderCheckLast();
    showScreen('check-last');
  } else if (action === 'plan-for-goal') {
    state.draft = { ...state.draft, mode: 'plan-only', selectedGoalId: value, plan: { strategies: [], customStrategy: '', undecided: false } };
    renderPlan();
    showScreen('plan');
  } else if (action === 'resume-goal') {
    resumeGoal(value);
  } else if (action === 'download-record') {
    downloadRecord();
  } else if (action === 'back-home') {
    renderHome();
    showScreen('home');
  } else if (action === 'finish-session') {
    state.draft = {};
    renderStart();
    showScreen('start');
  } else if (action === 'go-rating') {
    state.draft.check = emptyCheck();
    renderCheckRating();
    showScreen('check-rating');
  } else if (action === 'skip-check') {
    state.draft.check = { ...emptyCheck(), ratingSpecial: 'skip-check' };
    renderCheckNext();
    showScreen('check-next');
  } else if (action === 'choose-rating') {
    state.draft.check.rating = Number(value);
    state.draft.check.ratingSpecial = null;
    renderCheckPoints();
    showScreen('check-points');
  } else if (action === 'choose-rating-special') {
    state.draft.check.rating = null;
    state.draft.check.ratingSpecial = value;
    renderCheckPoints();
    showScreen('check-points');
  } else if (action === 'toggle-point') {
    togglePoint(button.dataset.group, value);
  } else if (action === 'choose-points-special') {
    state.draft.check.pointsSpecial = value;
    state.draft.check.wentWell = [];
    state.draft.check.wasHard = [];
    renderCheckPoints();
  } else if (action === 'go-check-next') {
    renderCheckNext();
    showScreen('check-next');
  } else if (action === 'next-continue') {
    continuePlan();
  } else if (action === 'next-change-plan') {
    changePlan();
  } else if (action === 'next-change-goal') {
    state.draft.nextInline = 'change-goal';
    renderCheckNext();
  } else if (action === 'next-finish') {
    state.draft.nextInline = 'finish';
    renderCheckNext();
  } else if (action === 'finalize-pause') {
    finalizeGoalEnd('pause', 'paused');
  } else if (action === 'finalize-done') {
    finalizeGoalEnd('done', 'done');
  } else if (action === 'change-goal-status') {
    finishOpenPlan('change-goal');
    startGoalFlow('change-goal', state.draft.selectedGoalId, value);
  } else if (action === 'back') {
    goBack();
  }
}

function toggleStrategy(id) {
  const selected = state.draft.plan.strategies;
  if (selected.includes(id)) {
    state.draft.plan.strategies = selected.filter(item => item !== id);
  } else if (selected.length >= 3) {
    showToast('さくせんは 3こまで えらべるよ');
  } else {
    state.draft.plan.strategies = [...selected, id];
  }
  renderPlan();
}

function togglePoint(group, id) {
  const check = state.draft.check;
  check.pointsSpecial = null;
  const selected = check[group] || [];
  check[group] = selected.includes(id) ? selected.filter(item => item !== id) : [...selected, id];
  renderCheckPoints();
}

function applyConfirm() {
  const mode = state.draft.mode;
  if (['new-goal', 'add-goal', 'change-goal'].includes(mode)) {
    if (mode === 'change-goal') {
      const oldGoal = findGoal(state.draft.selectedGoalId);
      if (oldGoal) oldGoal.status = state.draft.oldGoalStatus;
    }
    state.record.goals.push(makeGoalFromDraft());
  } else if (['plan-only', 'change-plan'].includes(mode)) {
    const goal = findGoal(state.draft.selectedGoalId);
    if (goal) goal.plans.push(makePlanFromDraft());
  } else if (mode === 'continue') {
    const goal = findGoal(state.draft.selectedGoalId);
    if (goal) goal.plans.push(makePlanFromDraft());
  }
  state.record.updatedAt = nowIso();
  setDirty(true);
  state.draft = {};
  renderSave();
  showScreen('save');
}

function makeGoalFromDraft() {
  const goalDraft = state.draft.goal;
  const title = trimText(state.draft.pendingTitle || goalTitlePreview(), 60);
  return {
    id: makeId('g'),
    status: 'active',
    category: goalDraft.category === 'custom' ? null : goalDraft.category,
    exampleId: goalDraft.example || null,
    when: goalDraft.customWhenOpen ? trimText(goalDraft.customWhen, 30) || 'きめない' : goalDraft.when || 'きめない',
    amount: goalDraft.customAmountOpen ? trimText(goalDraft.customAmount, 30) || 'きめない' : goalDraft.amount || 'きめない',
    customTitle: goalDraft.customTitle ? trimText(goalDraft.customTitle, 60) : null,
    title,
    createdAt: nowIso(),
    plans: [makePlanFromDraft()],
  };
}

function makePlanFromDraft() {
  const draftPlan = state.draft.plan || {};
  const customStrategy = trimText(draftPlan.customStrategy, 80) || null;
  const undecided = Boolean(draftPlan.undecided);
  return {
    id: makeId('p'),
    createdAt: nowIso(),
    strategies: undecided ? [] : [...(draftPlan.strategies || [])],
    customStrategy: undecided ? null : customStrategy,
    status: undecided ? 'undecided' : 'open',
    check: null,
  };
}

function emptyCheck() {
  return {
    rating: null,
    ratingSpecial: null,
    wentWell: [],
    wasHard: [],
    pointsSpecial: null,
    note: null,
  };
}

function finishOpenPlan(nextAction) {
  const goal = findGoal(state.draft.selectedGoalId);
  const plan = latestPlan(goal, ['open']);
  if (!plan || plan.status === 'checked') return;
  const check = state.draft.check || emptyCheck();
  plan.status = 'checked';
  plan.check = {
    checkedAt: nowIso(),
    rating: Number.isInteger(check.rating) ? check.rating : null,
    ratingSpecial: check.ratingSpecial || null,
    wentWell: [...(check.wentWell || [])],
    wasHard: [...(check.wasHard || [])],
    pointsSpecial: check.pointsSpecial || null,
    note: trimText(check.note, 120) || null,
    nextAction,
  };
  state.record.updatedAt = nowIso();
  setDirty(true);
}

function continuePlan() {
  const goal = findGoal(state.draft.selectedGoalId);
  const plan = latestPlan(goal, ['open']);
  finishOpenPlan('continue');
  state.draft.mode = 'continue';
  state.draft.pendingTitle = goal?.title || '';
  state.draft.plan = {
    strategies: [...(plan?.strategies || [])],
    customStrategy: plan?.customStrategy || '',
    customOpen: Boolean(plan?.customStrategy),
    undecided: false,
  };
  renderConfirm();
  showScreen('confirm');
}

function changePlan() {
  finishOpenPlan('change-plan');
  state.draft.mode = 'change-plan';
  state.draft.plan = { strategies: [], customStrategy: '', customOpen: false, undecided: false };
  renderPlan();
  showScreen('plan');
}

function finalizeGoalEnd(nextAction, status) {
  finishOpenPlan(nextAction);
  const goal = findGoal(state.draft.selectedGoalId);
  if (goal) goal.status = status;
  state.record.updatedAt = nowIso();
  setDirty(true);
  state.draft = {};
  renderSave();
  showScreen('save');
}

function resumeGoal(id) {
  if (activeGoals().length >= MAX_ACTIVE_GOALS) {
    renderHome('とりくみ中のめあてが3つあります。どれかをおやすみにすると、また とりくめます');
    showScreen('home');
    return;
  }
  const goal = findGoal(id);
  if (goal) {
    goal.status = 'active';
    state.record.updatedAt = nowIso();
    setDirty(true);
  }
  renderHome();
  showScreen('home');
}

function exportFilename() {
  const parts = markerParts(state.record?.fileMarker);
  const date = new Date();
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `sakusen-record_${parts.animal.romaji}-${parts.color.romaji}_${ymd}.json`;
}

function downloadRecord() {
  if (!state.record) return;
  state.record.updatedAt = nowIso();
  const blob = new Blob([JSON.stringify(state.record, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportFilename();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setDirty(false);
  renderSave(true);
}

function handleFile(file) {
  if (!file || file.size > MAX_FILE_BYTES) {
    setStartError('このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください');
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result || ''));
    } catch (error) {
      setStartError('このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください');
      return;
    }
    try {
      const record = normalizeImport(parsed);
      state.draft = { importRecord: record, startError: '' };
      renderLoadConfirm();
      showScreen('load-confirm');
    } catch (error) {
      setStartError(error.message);
    }
  };
  reader.onerror = () => {
    setStartError('このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください');
  };
  reader.readAsText(file);
}

function normalizeImport(data) {
  if (!data || typeof data !== 'object' || data.app !== APP_ID) {
    throw new Error('このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください');
  }
  if (typeof data.schemaVersion !== 'number') {
    throw new Error('このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください');
  }
  if (data.schemaVersion > SCHEMA_VERSION) {
    throw new Error('このファイルは新しいバージョンでつくられています。アプリを更新してから開いてください');
  }
  if (data.schemaVersion < SCHEMA_VERSION || data.schemaVersion == null) {
    throw new Error('このファイルは読み込めませんでした。さくせん会議でほぞんしたファイルか、たしかめてください');
  }
  if (!Array.isArray(data.goals) || data.goals.length > MAX_GOALS) {
    throw new Error('記録の内容が正しくないため読み込めませんでした');
  }
  const record = {
    app: APP_ID,
    schemaVersion: SCHEMA_VERSION,
    fileMarker: normalizeMarker(data.fileMarker),
    createdAt: normalizeDate(data.createdAt),
    updatedAt: normalizeDate(data.updatedAt),
    goals: data.goals.map(normalizeGoal).filter(Boolean),
  };
  if (record.goals.filter(goal => goal.status === 'active').length > MAX_ACTIVE_GOALS) {
    throw new Error('記録の内容が正しくないため読み込めませんでした');
  }
  return record;
}

function normalizeMarker(marker) {
  const color = FILE_MARKERS.colors.find(item => item.label === marker?.color)?.label || FILE_MARKERS.colors[0].label;
  const animal = FILE_MARKERS.animals.find(item => item.label === marker?.animal)?.label || FILE_MARKERS.animals[0].label;
  return { color, animal };
}

function normalizeDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

function normalizeGoal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = ['active', 'paused', 'done'].includes(raw.status) ? raw.status : 'paused';
  const plans = Array.isArray(raw.plans) ? raw.plans.map(normalizePlan).filter(Boolean) : [];
  return {
    id: makeId('g'),
    status,
    category: GOAL_CATEGORIES.some(item => item.id === raw.category) ? raw.category : null,
    exampleId: typeof raw.exampleId === 'string' ? trimText(raw.exampleId, 60) : null,
    when: trimText(raw.when, 30) || 'きめない',
    amount: trimText(raw.amount, 30) || 'きめない',
    customTitle: raw.customTitle == null ? null : trimText(raw.customTitle, 60) || null,
    title: trimText(raw.title, 60) || 'めあて',
    createdAt: normalizeDate(raw.createdAt),
    plans,
  };
}

function normalizePlan(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const status = ['open', 'checked', 'undecided'].includes(raw.status) ? raw.status : 'undecided';
  const knownStrategies = new Set(PLAN_STRATEGIES.map(item => item.id));
  const strategies = Array.isArray(raw.strategies)
    ? raw.strategies.filter(id => knownStrategies.has(id)).slice(0, 3)
    : [];
  return {
    id: makeId('p'),
    createdAt: normalizeDate(raw.createdAt),
    strategies,
    customStrategy: raw.customStrategy == null ? null : trimText(raw.customStrategy, 80) || null,
    status,
    check: raw.check ? normalizeCheck(raw.check) : null,
  };
}

function normalizeCheck(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const rating = Number.isInteger(raw.rating) && raw.rating >= 1 && raw.rating <= 5 ? raw.rating : null;
  const ratingSpecial = ['hard-to-say', 'no-talk', 'skip-check'].includes(raw.ratingSpecial) ? raw.ratingSpecial : null;
  const pointsSpecial = ['none-fit', 'no-talk'].includes(raw.pointsSpecial) ? raw.pointsSpecial : null;
  return {
    checkedAt: normalizeDate(raw.checkedAt),
    rating: ratingSpecial ? null : rating,
    ratingSpecial,
    wentWell: normalizeEnumArray(raw.wentWell, POINT_GROUPS.wentWell.map(item => item.id)),
    wasHard: normalizeEnumArray(raw.wasHard, POINT_GROUPS.wasHard.map(item => item.id)),
    pointsSpecial,
    note: raw.note == null ? null : trimText(raw.note, 120) || null,
    nextAction: ['continue', 'change-plan', 'change-goal', 'pause', 'done'].includes(raw.nextAction) ? raw.nextAction : null,
  };
}

function normalizeEnumArray(value, allowed) {
  if (!Array.isArray(value)) return [];
  const allowedSet = new Set(allowed);
  return value.filter(item => allowedSet.has(item));
}

function wireEvents() {
  document.body.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });

  document.body.addEventListener('input', event => {
    const input = event.target;
    const kind = input.dataset.input;
    if (!kind) return;
    if (kind === 'custom-title') state.draft.goal.customTitle = trimText(input.value, 60);
    if (kind === 'custom-when') state.draft.goal.customWhen = trimText(input.value, 30);
    if (kind === 'custom-amount') state.draft.goal.customAmount = trimText(input.value, 30);
    if (kind === 'custom-strategy') state.draft.plan.customStrategy = trimText(input.value, 80);
    if (kind === 'check-note') state.draft.check.note = trimText(input.value, 120);
    setDirty(true);
    if (['custom-title', 'custom-when', 'custom-amount'].includes(kind)) updateGoalBuildLive();
    if (kind === 'custom-strategy') updatePlanLive();
  });

  document.querySelector('#recordFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    handleFile(file);
  });

  window.addEventListener('beforeunload', event => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function updateGoalBuildLive() {
  const preview = document.querySelector('#goalPreview');
  const submit = document.querySelector('#goalSubmit');
  const goal = state.draft.goal || {};
  if (preview) {
    if (!goal.example) {
      preview.textContent = trimText(goal.customTitle, 60) || ' ';
    } else {
      const when = goal.customWhenOpen ? trimText(goal.customWhen, 30) || 'きめない' : goal.when || 'きめない';
      const amount = goal.customAmountOpen ? trimText(goal.customAmount, 30) || 'きめない' : goal.amount || 'きめない';
      preview.textContent = `「${goal.example}」を〔いつ：${when}〕〔どのくらい：${amount}〕`;
    }
  }
  if (submit) submit.disabled = goalTitlePreview().length === 0;
}

function updatePlanLive() {
  const submit = document.querySelector('#planSubmit');
  const draftPlan = state.draft.plan || {};
  if (submit) submit.disabled = !((draftPlan.strategies || []).length > 0 || trimText(draftPlan.customStrategy, 80).length > 0);
}

renderStart();
showScreen('start');
wireEvents();
