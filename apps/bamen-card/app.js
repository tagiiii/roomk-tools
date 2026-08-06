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
    label: '今日の小さなばめん',
    icon: 'wb_sunny',
    desc: '最近あった小さなばめんを、ひとつだけ話す',
    decideTitle: 'ばめんをひとつ思い出す',
    lead: '最近あった小さなばめんを、ひとつ思い出してみよう。大きなできごとじゃなくていいよ。',
    exampleTitle: 'たとえば、こんなくらいの小ささでOK',
    examples: [
      '朝起きたら、ねこが窓の外にすわっていた',
      'コップの氷が、カランといい音をたてた',
      'くつしたが片方だけ行方不明になった',
    ],
    hero: false,
  },
  {
    id: 'sakuhin',
    label: '好きな作品のばめん',
    icon: 'movie',
    desc: 'ゲーム・アニメ・動画・本などの好きなばめんを紹介する',
    decideTitle: '好きなばめんをひとつ選ぶ',
    lead: '好きな作品の中の、好きなばめんをひとつ選んで紹介してみよう。思い出しながらでOK。',
    exampleTitle: 'たとえば',
    examples: [
      'ゲームの好きなステージや、好きな場所',
      'アニメや動画で、何回も見ちゃうところ',
      '本やマンガの、好きな1ページ',
    ],
    hero: false,
  },
  {
    id: 'souzou',
    label: '想像の主人公のばめん',
    icon: 'auto_awesome',
    desc: 'カードの主人公の「ある日のばめん」を想像して話す',
    decideTitle: '主人公のばめんを想像する',
    lead: 'カードの主人公には、どんな1日があるんだろう。「ある日のばめん」を自由に想像して話してみよう。正解はないよ。',
    hero: true,
    heroNote: 'この主人公の、ある日のばめんを想像してみよう。別の主人公に変えてもOK。',
  },
  {
    id: 'listen',
    label: '今日は話を聞くだけでもOK',
    icon: 'hearing',
    desc: 'メンターが主人公カードのばめんを話すよ。聞き役になる回',
    decideTitle: '話してもらう主人公を決める',
    lead: '今日は、聞く日。メンターが主人公カードの「ある日のばめん」を話すよ。ゆっくり聞いているだけでOK。',
    hero: true,
    heroNote: 'この主人公のばめんを、メンターが話すよ。主人公を選んであげてもOK。',
    entryTitle: '入口カードで、メンターに聞いてみる',
    entryNote: 'メンターの話を聞きながら、気になったらカードのといかけをそのままメンターに聞いてみよう。聞いているだけでもOK。',
  },
];

// 入口カードのステップ見出し・説明（listen 以外の共通文言）
const ENTRY_TITLE_DEFAULT = '入口カードを引いて、ばめんを話す';
const ENTRY_NOTE_DEFAULT = '決めたばめんについて、カードのといかけに答えてみよう。ばめんが少しずつくわしく見えてくるよ。引いても、引かなくてもOK。';

// そうぞうの主人公カード（ユーモラスで安全な架空設定のみ）
const HEROES = [
  { icon: 'bakery_dining', name: '雲の上でパン屋をやってる人' },
  { icon: 'mail', name: '海の底で郵便をとどけているタコ' },
  { icon: 'smart_toy', name: '星をぴかぴかにみがく係のロボット' },
  { icon: 'ramen_dining', name: '森のおくでラーメン屋をひらいたクマ' },
  { icon: 'menu_book', name: '月で本の貸し出しをしているウサギ' },
  { icon: 'coffee', name: '雨の日だけ店をあけるカフェの店主のカエル' },
  { icon: 'attractions', name: '世界一小さな遊園地をひとりで動かしている人' },
  { icon: 'science', name: '片方だけのくつしたを集めている博士' },
  { icon: 'palette', name: 'にじのふもとで色をつくっている職人' },
  { icon: 'pets', name: 'ねこのことばを通訳する人' },
  { icon: 'directions_bus', name: '空とぶバスの運転手' },
  { icon: 'cookie', name: 'おかしの家専門の大工さん' },
  { icon: 'local_shipping', name: '夢の中のわすれものをとどける配達員' },
  { icon: 'ac_unit', name: 'さばくのどまんなかでかき氷屋さんをやっている人' },
  { icon: 'landscape', name: '山のてっぺんで天気を毎日スケッチしている人' },
  { icon: 'sailing', name: '宝さがしの船の料理係' },
  { icon: 'weather_snowy', name: 'とけかけた雪だるまをなおしてまわるお医者さん' },
  { icon: 'location_city', name: '巨大なカメの背中の町に住む町長' },
  { icon: 'schedule', name: '大きな時計の中に住んでいるそうじ係のこびと' },
  { icon: 'local_florist', name: '宇宙ステーションで花を育てている人' },
  { icon: 'photo_camera', name: 'まぼろしの生きものをカメラでさがしている人' },
  { icon: 'graphic_eq', name: '音をびんにつめて売っているお店の人' },
  { icon: 'signpost', name: 'めいろの中で道案内をしているモグラ' },
  { icon: 'festival', name: '一年中夏まつりがつづく島のたこやき屋さん' },
];

// 話の入口カード（ばめんを描写するための軽い問い。「なんで？」系は入れない）
const ENTRY_CARDS = [
  'そのばめんはどこ？',
  'そこに何が見える？',
  '音はする？ どんな音？',
  'そこは明るい？ 暗い？',
  'あたたかい？ すずしい？',
  'においはしそう？',
  '時間はいつごろ？ 朝、昼、夜？',
  'いちばん近くにあるものは何？',
  '遠くのほうには何がありそう？',
  '動いているものはある？',
  'そのばめんでいちばん目立つものは？',
  'さわれるとしたら、どんな手ざわり？',
  'そのばめんに色をつけるなら、何色っぽい？',
  '一枚の絵にするなら、まんなかに何をかく？',
  '音楽をつけるなら、どんな感じの曲？',
  'そのばめんにタイトルをつけるなら？',
  'その少しあと、何がおこりそう？',
  'そこにはだれかいる？ 生きものでもOK',
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
      <h2 class="bm-panel__title" id="mode-title">今日は、どのばめんにする？</h2>
      <p class="bm-panel__lead">『ばめん』は、写真1枚ぶんのできごとのこと。どれを選んでもOK。とちゅうで変えてもいいよ。</p>
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
        <span class="material-symbols-rounded" aria-hidden="true">refresh</span>別の主人公にする
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
      <p class="bm-muted">答えたくないときは、パスして別のカードへ。1枚だけで終わってもじゅうぶん。</p>
    ` : ''}
    <div class="bm-actions bm-actions--tight">
      <button class="btn btn-secondary" type="button" data-action="draw-entry">
        <span class="material-symbols-rounded" aria-hidden="true">style</span>${state.entryCard ? '別の入口カードを引く' : '入口カードを引く'}
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
        <button class="btn btn-ghost" type="button" data-action="back-mode">← モードを選び直す</button>
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
