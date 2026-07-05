// ばめんカード アプリロジック
// 「ばめん」をひとつ切りとって話す練習。実話に限定せず、すきな作品や
// そうぞうの主人公でも同じように成立させる（モードはすべて同格）
import { shuffle } from '../shared/js/utils.js';

const NUMBERS = ['①', '②', '③', '④'];

// 4つのモードは全部同格。実話モード（today）を推奨扱い・先頭固定の特別扱いにしない
// 本体画面は「まず ばめんをきめる → つぎに 入口カードで話す」の2ステップで、
// 入口カードが「きめたばめん」に向いていることを文言でつなぐ
const MODES = [
  {
    id: 'today',
    label: 'きょうの小さなばめん',
    icon: 'wb_sunny',
    desc: 'さいきんあった ちいさなばめんを、ひとつだけ話す',
    decideTitle: 'ばめんを ひとつ おもいだす',
    lead: 'さいきんあった ちいさなばめんを、ひとつ おもいだしてみよう。おおきな できごとじゃなくて いいよ。',
    exampleTitle: 'たとえば、こんなくらいの ちいささで OK',
    examples: [
      '朝おきたら、ねこが まどの外に すわっていた',
      'コップのこおりが、カランと いい音をたてた',
      'くつしたが かた方だけ 行方不明になった',
    ],
    hero: false,
  },
  {
    id: 'sakuhin',
    label: 'すきな作品のばめん',
    icon: 'movie',
    desc: 'ゲーム・アニメ・動画・本などの すきなばめんを しょうかいする',
    decideTitle: 'すきな ばめんを ひとつ えらぶ',
    lead: 'すきな作品の中の、すきなばめんを ひとつ えらんで しょうかいしてみよう。おもいだしながらで OK。',
    exampleTitle: 'たとえば',
    examples: [
      'ゲームの すきなステージや、すきな場所',
      'アニメや動画で、何回も見ちゃうところ',
      '本やマンガの、すきな1ページ',
    ],
    hero: false,
  },
  {
    id: 'souzou',
    label: 'そうぞうの主人公のばめん',
    icon: 'auto_awesome',
    desc: 'カードの主人公の「ある日のばめん」を そうぞうして話す',
    decideTitle: '主人公の ばめんを そうぞうする',
    lead: 'カードの主人公には、どんな1日が あるんだろう。「ある日のばめん」を じゆうに そうぞうして話してみよう。せいかいは ないよ。',
    hero: true,
    heroNote: 'この主人公の、ある日のばめんを そうぞうしてみよう。べつの主人公に かえても OK。',
  },
  {
    id: 'listen',
    label: 'きょうは 話をきくだけでも OK',
    icon: 'hearing',
    desc: 'メンターが 主人公カードのばめんを話すよ。きき役になる回',
    decideTitle: '話してもらう 主人公を きめる',
    lead: 'きょうは、きく日。メンターが 主人公カードの「ある日のばめん」を話すよ。ゆっくり きいているだけで OK。',
    hero: true,
    heroNote: 'この主人公のばめんを、メンターが話すよ。主人公を えらんであげても OK。',
    entryTitle: '入口カードで、メンターに きいてみる',
    entryNote: 'メンターの話を ききながら、気になったら カードの といかけを そのまま メンターに きいてみよう。きいているだけでも OK。',
  },
];

// 入口カードのステップ見出し・説明（listen 以外の共通文言）
const ENTRY_TITLE_DEFAULT = '入口カードを ひいて、ばめんを 話す';
const ENTRY_NOTE_DEFAULT = 'きめた ばめんについて、カードの といかけに こたえてみよう。ばめんが すこしずつ くわしく 見えてくるよ。ひいても、ひかなくても OK。';

// そうぞうの主人公カード（ユーモラスで安全な架空設定のみ）
const HEROES = [
  { icon: 'bakery_dining', name: '雲の上で パンやをやってる人' },
  { icon: 'mail', name: '海のそこで ゆうびんをとどけている タコ' },
  { icon: 'smart_toy', name: '星を ぴかぴかに みがく係の ロボット' },
  { icon: 'ramen_dining', name: '森のおくで ラーメン屋をひらいた クマ' },
  { icon: 'menu_book', name: '月で 本のかしだしをしている ウサギ' },
  { icon: 'coffee', name: '雨の日だけ 店をあける カフェの店主の カエル' },
  { icon: 'attractions', name: '世界一ちいさな遊園地を ひとりで動かしている人' },
  { icon: 'science', name: 'かた方だけの くつしたを あつめている はかせ' },
  { icon: 'palette', name: 'にじのふもとで 色をつくっている 職人' },
  { icon: 'pets', name: 'ねこのことばを つうやくする人' },
  { icon: 'directions_bus', name: '空とぶバスの 運転手' },
  { icon: 'cookie', name: 'おかしの家 せんもんの 大工さん' },
  { icon: 'local_shipping', name: '夢の中の わすれものを とどける 配達員' },
  { icon: 'ac_unit', name: 'さばくの どまんなかで かき氷屋さんをやっている人' },
  { icon: 'landscape', name: '山のてっぺんで 天気を 毎日スケッチしている人' },
  { icon: 'sailing', name: 'たからさがしの船の りょうり係' },
  { icon: 'weather_snowy', name: 'とけかけた雪だるまを なおしてまわる おいしゃさん' },
  { icon: 'location_city', name: 'きょだいなカメの せなかの町に住む 町長' },
  { icon: 'schedule', name: '大きな時計の中に住んでいる そうじ係の こびと' },
  { icon: 'local_florist', name: '宇宙ステーションで 花をそだてている人' },
  { icon: 'photo_camera', name: 'まぼろしの生きものを カメラでさがしている人' },
  { icon: 'graphic_eq', name: '音を びんにつめて売っている お店の人' },
  { icon: 'signpost', name: 'めいろの中で みちあんないをしている モグラ' },
  { icon: 'festival', name: '一年中 夏まつりがつづく島の たこやき屋さん' },
];

// 話の入口カード（ばめんを描写するための軽い問い。「なんで？」系は入れない）
const ENTRY_CARDS = [
  'そのばめんは どこ？',
  'そこに なにが 見える？',
  '音は する？ どんな音？',
  'そこは 明るい？ くらい？',
  'あたたかい？ すずしい？',
  'においは しそう？',
  '時間は いつごろ？ 朝、ひる、夜？',
  'いちばん ちかくに あるものは なに？',
  'とおくのほうには なにが ありそう？',
  'うごいているものは ある？',
  'そのばめんで いちばん 目立つものは？',
  'さわれるとしたら、どんな手ざわり？',
  'そのばめんに 色をつけるなら、なに色っぽい？',
  '一枚の絵にするなら、まんなかに なにをかく？',
  '音楽をつけるなら、どんな感じの曲？',
  'そのばめんに タイトルをつけるなら？',
  'その少しあと、なにが おこりそう？',
  'そこには だれか いる？ 生きものでも OK',
];

const state = {
  currentScreen: null,
  modeId: null,
  hero: null,
  entryCard: null,
};

let heroPool = [];
let entryPool = [];

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function currentMode() {
  return MODES.find(mode => mode.id === state.modeId) || null;
}

function drawHero() {
  if (!heroPool.length) heroPool = shuffle(HEROES);
  let next = heroPool.pop();
  // 引き直し直後に同じカードが出ないようにする
  if (state.hero && next.name === state.hero.name && heroPool.length) {
    heroPool.unshift(next);
    next = heroPool.pop();
  }
  return next;
}

function drawEntry() {
  if (!entryPool.length) entryPool = shuffle(ENTRY_CARDS);
  let next = entryPool.pop();
  if (state.entryCard && next === state.entryCard && entryPool.length) {
    entryPool.unshift(next);
    next = entryPool.pop();
  }
  return next;
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(screen => screen.classList.remove('active'));
  document.getElementById(`screen-${id}`).classList.add('active');
  state.currentScreen = id;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderModeScreen() {
  document.querySelector('#screen-mode').innerHTML = `
    <div class="bm-panel">
      <h2 class="bm-panel__title" id="mode-title">きょうは、どのばめんに する？</h2>
      <p class="bm-panel__lead">『ばめん』は、写真1まいぶんの できごとの こと。どれを えらんでも OK。とちゅうで かえても いいよ。</p>
      <div class="bm-mode-grid">
        ${MODES.map((mode, index) => `
          <button class="bm-mode" type="button" data-action="select-mode" data-value="${esc(mode.id)}"
            aria-label="${index + 1}番: ${esc(mode.label)}。${esc(mode.desc)}">
            <span class="bm-mode__num" aria-hidden="true">${esc(NUMBERS[index])}</span>
            <span class="material-symbols-rounded bm-mode__icon" aria-hidden="true">${esc(mode.icon)}</span>
            <span class="bm-mode__body">
              <span class="bm-mode__label">${esc(mode.label)}</span>
              <span class="bm-mode__desc">${esc(mode.desc)}</span>
            </span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
}

function exampleHtml(mode) {
  return `
    <p class="bm-caption">${esc(mode.exampleTitle)}</p>
    <ul class="bm-list">
      ${mode.examples.map(item => `<li class="bm-list__item">${esc(item)}</li>`).join('')}
    </ul>
  `;
}

function heroHtml(mode) {
  return `
    <div class="bm-hero-card">
      <span class="material-symbols-rounded bm-hero-card__icon" aria-hidden="true">${esc(state.hero.icon)}</span>
      <span class="bm-hero-card__name">${esc(state.hero.name)}</span>
    </div>
    <p class="bm-muted">${esc(mode.heroNote)}</p>
    <div class="bm-actions bm-actions--tight">
      <button class="btn btn-secondary" type="button" data-action="redraw-hero">
        <span class="material-symbols-rounded" aria-hidden="true">refresh</span>べつの主人公にする
      </button>
    </div>
  `;
}

function entryHtml() {
  return `
    ${state.entryCard ? `
      <div class="bm-entry__card">
        <span class="bm-entry__text">${esc(state.entryCard)}</span>
      </div>
      <p class="bm-muted">こたえたくない ときは、パスして べつのカードへ。1まいだけで おわっても じゅうぶん。</p>
    ` : ''}
    <div class="bm-actions bm-actions--tight">
      <button class="btn btn-secondary" type="button" data-action="draw-entry">
        <span class="material-symbols-rounded" aria-hidden="true">style</span>${state.entryCard ? 'べつの入口カードを引く' : '入口カードを引く'}
      </button>
    </div>
  `;
}

function renderTalkScreen() {
  const mode = currentMode();
  if (!mode) return;
  document.querySelector('#screen-talk').innerHTML = `
    <div class="bm-panel bm-panel--in">
      <div class="bm-talk-head">
        <span class="material-symbols-rounded bm-talk-head__icon" aria-hidden="true">${esc(mode.icon)}</span>
        <h2 class="bm-panel__title" id="talk-title">${esc(mode.label)}</h2>
      </div>
      <section class="bm-section" aria-label="まず、${esc(mode.decideTitle)}">
        <div class="bm-step">
          <span class="bm-step__label" aria-hidden="true">まず</span>
          <h3 class="bm-step__title">${esc(mode.decideTitle)}</h3>
        </div>
        <p class="bm-panel__lead">${esc(mode.lead)}</p>
        ${mode.examples ? exampleHtml(mode) : ''}
        ${mode.hero ? heroHtml(mode) : ''}
      </section>
      <section class="bm-section bm-entry" aria-label="つぎに、${esc(mode.entryTitle || ENTRY_TITLE_DEFAULT)}">
        <div class="bm-step">
          <span class="bm-step__label" aria-hidden="true">つぎに</span>
          <h3 class="bm-step__title">${esc(mode.entryTitle || ENTRY_TITLE_DEFAULT)}</h3>
        </div>
        <p class="bm-muted">${esc(mode.entryNote || ENTRY_NOTE_DEFAULT)}</p>
        ${entryHtml()}
      </section>
      <div class="bm-actions">
        <button class="btn btn-ghost" type="button" data-action="back-mode">← モードを えらびなおす</button>
      </div>
    </div>
  `;
}

function selectMode(id) {
  const mode = MODES.find(item => item.id === id);
  if (!mode) return;
  state.modeId = id;
  state.entryCard = null;
  if (mode.hero) state.hero = drawHero();
  renderTalkScreen();
  showScreen('talk');
}

function handleAction(action, button) {
  const value = button.dataset.value || '';
  if (action === 'select-mode') {
    selectMode(value);
  } else if (action === 'back-mode') {
    state.modeId = null;
    renderModeScreen();
    showScreen('mode');
  } else if (action === 'redraw-hero') {
    state.hero = drawHero();
    renderTalkScreen();
  } else if (action === 'draw-entry') {
    state.entryCard = drawEntry();
    renderTalkScreen();
  }
}

function wireEvents() {
  document.body.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    handleAction(target.dataset.action, target);
  });
}

renderModeScreen();
showScreen('mode');
wireEvents();
