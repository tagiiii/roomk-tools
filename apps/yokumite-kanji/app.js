// =============================================
// よく見て漢字 — にせものの混ざった部品から字を組み立てるパズル
// 仕様の正本: AGENTS.md
// =============================================
import { shuffle } from '../shared/js/utils.js';
import { UNITS } from './data.js?v=20261014e';
import { KVG } from './kvg-data.js?v=20261014e';
import { applyPath, createRoom, openLink } from './link.js?v=20261014e';

const { RoomkRTDB } = window;

const STORE_KEY = 'yokumite-kanji:v2';
const SESSION_KEY = 'yokumitekanji_session';
const PID_KEY = 'yokumitekanji_pid';
const ROOM_RE = /^[A-Z2-9]{6}$/;
const PID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const PID_RE = /^[a-z0-9]{12}$/;
const SVG_NS = 'http://www.w3.org/2000/svg';

const SNAP = 10;          // 正しい場所からこの距離までで放すと、はまる（字の枠は 109）
const KEY_STEP = 3;       // 矢印キー1回で動く距離
const MAX_DECOYS = 3;
const MIN_DECOYS = 2;
const PEEK_MS = 2500;
const SAMPLES = 9;        // 部品の形をくらべるために、1画から取る点の数
const DRAW_STEP_MS = 150;
const SCATTER_TRIES = 40; // ばらまくとき、重なりの少ない置き場所をこの回数だけ探す
const MOVE_SEND_MS = 80;  // 動かしている間、見る画面へ位置を送る間隔
const PIECE_MAX = 12;     // 見る側が受け取る部品の数の上限（正しい部品＋にせもの）
const ORDER_ID_RE = /^[a-z0-9]{8}$/;
const ORDER_COUNTS = [3, 5, 10, 0]; // メンターが選べる問題数（0 は全部）
const ORDER_DEFAULT = 5;
const ORDER_MAX = 30;
const HANDLED_KEEP = 20;  // 済んだ問題の id をおぼえておく数（同じ問題を出しなおさないため）
const ORDER_TIMES = [0, 60, 30]; // メンターが選べる1問の制限時間（秒。0 はなし）
const TIMER_TICK_MS = 250;

const GUIDE = '部品をドラッグして、わくの中で字を組み立てましょう。にせものの部品が混ざっています。はまらない部品は、にせものです。';

// 盤面の大きさ（SVG の単位。字の枠は 109×109）
const LAYOUTS = {
  wide: { w: 400, h: 170, fx: 145.5, fy: 30.5, trays: [{ x: 6, y: 6, w: 128, h: 158 }, { x: 266, y: 6, w: 128, h: 158 }] },
  tall: { w: 230, h: 250, fx: 60.5, fy: 6, trays: [{ x: 5, y: 122, w: 220, h: 123 }] },
};

const app = document.getElementById('app');
const shareBar = document.getElementById('shareBar');

// ── 保存（この端末の中だけ） ──────────────────
// clear: 組み立てた語 ／ wrote: 紙にも書いた語
function loadStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {};
    return {
      clear: raw.clear && typeof raw.clear === 'object' ? raw.clear : {},
      wrote: raw.wrote && typeof raw.wrote === 'object' ? raw.wrote : {},
    };
  } catch {
    return { clear: {}, wrote: {} };
  }
}

const store = loadStore();

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // 保存できない環境（プライベートウィンドウ等）でも遊べる
  }
}

const wordKey = (unit, word) => `${unit.id}:${word.w}`;
const isCleared = (unit, word) => Boolean(store.clear[wordKey(unit, word)]);

// パズルにできるのは、字のデータがある語だけ
const playable = (unit) => unit.words.filter((w) => w.k && KVG[w.k]);
const unitTitle = (unit) => `${unit.subject}：${unit.name}`;

// ── DOM ヘルパー（文字はすべて textContent で入れる） ──
function build(node, attrs, children) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'on') {
      for (const [type, handler] of Object.entries(value)) node.addEventListener(type, handler);
    } else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

const el = (tag, attrs = {}, ...children) => build(document.createElement(tag), attrs, children);
const svg = (tag, attrs = {}, ...children) => build(document.createElementNS(SVG_NS, tag), attrs, children);
const icon = (name) => el('span', { class: 'material-symbols-rounded', 'aria-hidden': 'true' }, name);

function button(label, variant, onClick, { iconName, iconAfter, ...attrs } = {}) {
  return el('button', { type: 'button', class: `btn ${variant}`, on: { click: onClick }, ...attrs },
    iconName && !iconAfter ? icon(iconName) : null,
    el('span', { class: 'btn__label' }, label),
    iconName && iconAfter ? icon(iconName) : null);
}

// 1問の制限時間の帯。endsAt（時刻）まで、だんだん短くなる。0 になったら onEnd を1回だけ呼ぶ
let puzzleTimer = null;   // 遊ぶ側のパズルの帯
let watchTimer = null;    // 見る画面の帯

function timerBar(limitSec) {
  const fill = el('span', { class: 'yk-timer__fill' });
  const left = el('span', { class: 'yk-timer__left' }, `あと${limitSec}秒`);
  const root = el('div', { class: 'yk-timer', role: 'timer', 'aria-label': `制限時間 ${limitSec}秒` },
    el('span', { class: 'yk-timer__track' }, fill), left);
  return { root, fill, left };
}

function startCountdown(bar, endsAt, limitSec, onEnd) {
  let ended = false;
  const tick = () => {
    const rest = Math.max(0, endsAt - RoomkRTDB.now());
    bar.fill.style.width = `${(rest / (limitSec * 1000)) * 100}%`;
    bar.left.textContent = rest > 0 ? `あと${Math.ceil(rest / 1000)}秒` : '時間です';
    bar.root.classList.toggle('is-low', rest > 0 && rest <= 10000);
    if (rest <= 0 && !ended) {
      ended = true;
      stop();
      if (onEnd) onEnd();
    }
  };
  const handle = setInterval(tick, TIMER_TICK_MS);
  function stop() {
    clearInterval(handle);
  }
  tick();
  return { stop };
}

function stopTimer(timer) {
  if (timer) timer.stop();
  return null;
}

function show(...nodes) {
  puzzleTimer = stopTimer(puzzleTimer); // 画面を切りかえたら、前のパズルの時間は止める
  const screen = el('section', { class: 'yk-screen' }, ...nodes);
  app.replaceChildren(screen);
  window.scrollTo(0, 0);
  const first = screen.querySelector('[data-focus]');
  if (first) first.focus({ preventScroll: true });
}

const heading = (text) => el('h2', { class: 'yk-screen-title', tabindex: '-1', 'data-focus': true }, text);

function backLink(label, onClick) {
  return el('button', { type: 'button', class: 'yk-back-link', on: { click: onClick } }, icon('arrow_back'), label);
}

// 語の中の「よく見る1字」だけを別の見た目にする
function wordSpans(word, renderFocus) {
  const at = word.w.indexOf(word.k);
  return [word.w.slice(0, at), renderFocus(word.k), word.w.slice(at + word.k.length)];
}

function wordHead(word) {
  return el('div', { class: 'yk-puzzle-word' },
    el('h2', { class: 'yk-puzzle-word__text yk-kyo', tabindex: '-1', 'data-focus': true, 'aria-label': `${word.y}の字を組み立てる` },
      wordSpans(word, () => el('span', { class: 'yk-puzzle-word__blank', 'aria-hidden': 'true' }, '？'))),
    el('p', { class: 'yk-puzzle-word__yomi' }, word.y),
    el('p', { class: 'yk-puzzle-word__meaning' }, word.m));
}

function resultWord(word) {
  return [
    el('div', { class: 'yk-puzzle-result__word yk-kyo' },
      wordSpans(word, (k) => el('span', { class: 'yk-puzzle-result__focus' }, k))),
    ...(word.p ? [el('p', { class: 'yk-puzzle-result__point' }, word.p)] : []),
  ];
}

// ── メンターの見る画面とのつなぎ ────────────────────
// role: 'player'（子ども。自分の画面を見せる）／'viewer'（メンター。見るだけ）
const share = { link: null, role: null, code: null, peer: false, everPeer: false, busy: false };

// このタブの人を表す id。同じブラウザの別タブは匿名認証の uid が同じなので、uid では区別しない
const pid = (() => {
  const make = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) => PID_CHARS[n % PID_CHARS.length]).join('');
  try {
    const saved = sessionStorage.getItem(PID_KEY);
    if (saved && PID_RE.test(saved)) return saved;
    const made = make();
    sessionStorage.setItem(PID_KEY, made);
    return made;
  } catch {
    return make();
  }
})();

// 今の画面の写し。見せていない間もここに持っておき、見せはじめたときにまとめて送る
let live = {};

// メンターが出した問題（子ども側）: { id, unit, words: [語の番号], i: いまの問題, done, counted }
let set = null;
let setShown = false;      // いま問題の画面（パズル・おわり）を出しているか
let afterSet = null;       // 問題から抜けたしるし { id, how: 'quit'|'done' }（メンターの画面に出す）
const handledOrders = new Set();

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return saved && ROOM_RE.test(saved.code) && ['player', 'viewer'].includes(saved.role) ? saved : null;
  } catch {
    return null;
  }
}

function saveSession() {
  if (!share.code) return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      code: share.code,
      role: share.role,
      set: share.role === 'player' ? set : null,
      afterSet: share.role === 'player' ? afterSet : null,
      handled: [...handledOrders].slice(-HANDLED_KEEP),
    }));
  } catch { /* 保存できなくても、このウィンドウの間はつながる */ }
}

// 再読み込みの前に出されていた問題と、済んだ問題を戻す
function restoreSet(saved) {
  (Array.isArray(saved.handled) ? saved.handled : []).forEach((id) => {
    if (typeof id === 'string' && ORDER_ID_RE.test(id)) handledOrders.add(id);
  });
  const after = saved.afterSet;
  if (after && typeof after.id === 'string' && ORDER_ID_RE.test(after.id) && ['quit', 'done'].includes(after.how)) {
    afterSet = { id: after.id, how: after.how };
  }
  // 出された問題は、形がそろっているときだけ戻す（そろっていなければ捨てる。済んだ問題の id は残る）
  const old = saved.set;
  const unit = old && UNITS.find((u) => u.id === old.unit);
  if (!unit || typeof old.id !== 'string' || !ORDER_ID_RE.test(old.id) || !Array.isArray(old.words)) return;
  const max = playable(unit).length;
  const words = old.words;
  const okIndex = (i) => Number.isInteger(i) && i >= 0 && i < max;
  if (!words.length || words.length > ORDER_MAX || !words.every(okIndex) || new Set(words).size !== words.length) return;
  const done = [...new Set(Array.isArray(old.done) ? old.done : [])].filter((i) => words.includes(i));
  const i = old.i;
  if (!Number.isInteger(i) || i < 0 || i > words.length) return;
  if (i === words.length && done.length !== words.length) return; // 全部できていないのに「おわり」にはしない
  const late = [...new Set(Array.isArray(old.late) ? old.late : [])].filter((k) => done.includes(k));
  const t = ORDER_TIMES.includes(old.t) ? old.t : 0;
  const dl = old.deadline;
  const deadline = dl && Number.isInteger(dl.i) && dl.i === i && Number.isFinite(dl.at) ? { i: dl.i, at: dl.at } : null;
  set = { id: old.id, unit: unit.id, words: [...words], i, done, late, t, deadline, counted: Boolean(old.counted) };
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 何もしない */ }
}

function clearRoomParam() {
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
}

function adoptLink(link, code, role) {
  share.link = link;
  share.role = role;
  share.code = code;
  share.peer = false;
  share.everPeer = false;
  saveSession();
  clearRoomParam(); // ?room= は、つないだあとにアドレスから外す
}

function resetShare() {
  share.link = null;
  share.role = null;
  share.code = null;
  share.peer = false;
  clearSession();
  renderShareBar();
}

const copyOf = (value) => (value == null ? null : JSON.parse(JSON.stringify(value)));

// 見せているときだけ送る。見せていないときは、手元の写しに入れるだけ
function publish(path, value) {
  live = applyPath(live, path, copyOf(value));
  if (share.role === 'player') share.link.set(path, copyOf(value));
}

const END_NOTES = {
  closed: 'メンターが見る画面をとじました',
  expired: 'メンターの画面がもどらなかったので、見せるのをおわりました',
  replaced: 'ほかの画面で見せはじめたので、この画面は見せるのをやめました',
};

// 見せはじめる。つながったら true（ルームがない・終わっているときは 'gone'、通信の失敗は 'error'）
async function startShowing(code) {
  if (share.busy || share.link) return 'busy';
  share.busy = true;
  try {
    const result = await openLink(code, 'player', pid);
    if (!result.ok) return result.reason;
    adoptLink(result.link, code, 'player');
    result.link.onPeer((on) => {
      share.peer = on;
      renderShareBar();
    });
    result.link.onEnd((reason) => {
      resetShare();
      RoomkRTDB.showToast(END_NOTES[reason] || END_NOTES.closed, false);
    });
    if (!share.link) return 'gone'; // つないだ直後に終わっていた（上の onEnd がもう片付けた）
    result.link.set('', copyOf(live)); // 今の画面を送る
    result.link.onOrder(onOrder);
    renderShareBar();
    return true;
  } finally {
    share.busy = false;
  }
}

function renderShareBar() {
  if (share.role !== 'player') {
    shareBar.hidden = true;
    shareBar.replaceChildren();
    return;
  }
  shareBar.hidden = false;
  shareBar.replaceChildren(
    el('span', { class: 'yk-share-bar__text', role: 'status' },
      icon(share.peer ? 'visibility' : 'hourglass_top'),
      share.peer ? 'メンターに見せています' : 'メンターの画面がひらくのを待っています'),
    el('button', {
      type: 'button', class: 'yk-share-bar__stop',
      on: {
        click: () => {
          if (share.role !== 'player') return;
          share.link.leave();
          resetShare();
          RoomkRTDB.showToast('見せるのをやめました', false);
        },
      },
    }, '見せるのをやめる'));
}

// ── トップ ───────────────────────────────────
function showTop() {
  setShown = false;
  publish('', { view: { name: 'top', ...(afterSet ? { afterSet } : {}) } });
  const subjects = [...new Set(UNITS.map((u) => u.subject))];
  const hasRecord = Object.keys(store.clear).length > 0 || Object.keys(store.wrote).length > 0;
  show(
    heading('単元を選ぶ'),
    el('p', { class: 'yk-lead' }, '今、学校でやっている単元を選びます。用語の漢字を、バラバラの部品から組み立てます。'),
    subjects.map((subject) => el('div', { class: 'yk-unit-group' },
      el('h3', { class: 'yk-unit-group__title' }, subject),
      el('div', { class: 'yk-unit-list' }, UNITS.filter((u) => u.subject === subject).map(unitCard)))),
    el('div', { class: 'yk-top-foot' },
      share.role ? null : button('見る画面をつくる（メンター用）', 'btn-ghost btn-sm', createWatch, { iconName: 'co_present', id: 'btnCreateWatch' }),
      hasRecord ? button('記録を消す', 'btn-ghost btn-sm', () => {
        if (!window.confirm('組み立てた字の記録を消します。よろしいですか。')) return;
        store.clear = {};
        store.wrote = {};
        saveStore();
        showTop();
      }, { iconName: 'delete' }) : null),
  );
}

function unitCard(unit) {
  const words = playable(unit);
  const built = words.filter((w) => isCleared(unit, w)).length;
  return el('button', { type: 'button', class: 'yk-unit-card', on: { click: () => showUnit(unit.id) } },
    icon(unit.subject === '理科' ? 'science' : 'public'),
    el('span', { class: 'yk-unit-card__body' },
      el('span', { class: 'yk-unit-card__name' }, unit.name),
      el('span', { class: 'yk-unit-card__sub' }, `${words.length}語${built ? ` ・ 組み立てた字 ${built}` : ''}`)),
    icon('chevron_right'));
}

// ── 単元（語の一覧） ────────────────────────────
function showUnit(unitId) {
  const unit = UNITS.find((u) => u.id === unitId);
  if (!unit) return showTop();
  setShown = false;
  publish('', { view: { name: 'unit', unit: unit.id, ...(afterSet ? { afterSet } : {}) } });
  const words = playable(unit);
  return show(
    backLink('単元を選ぶ', showTop),
    heading(unitTitle(unit)),
    el('p', { class: 'yk-lead' }, '組み立てる語を選びます。色のついた字がバラバラになります。'),
    el('div', { class: 'yk-tile-grid' }, words.map((word, index) => el('button', {
      type: 'button', class: 'yk-word-tile',
      on: { click: () => showPuzzle(unit, index) },
    },
    el('span', { class: 'yk-word-tile__word yk-kyo' },
      wordSpans(word, (k) => el('span', { class: 'yk-word-tile__focus' }, k))),
    el('span', { class: 'yk-word-tile__yomi' }, word.y),
    el('span', { class: 'yk-word-tile__marks' },
      isCleared(unit, word)
        ? el('span', { class: 'yk-word-tile__built' }, icon('star'), el('span', { class: 'yk-sr-only' }, '組み立てた'))
        : null,
      store.wrote[wordKey(unit, word)]
        ? el('span', { class: 'yk-word-tile__wrote' }, icon('edit'), el('span', { class: 'yk-sr-only' }, '紙にも書いた'))
        : null)))),
  );
}

// ── 盤面（遊ぶ側と見る側で同じものを組む） ─────────────────
// にせものの部品（どの字の・何番目の部品か）。似た字の「ちがう所」を先に使い、足りなければほかの字から借りる
function pickDecoys(word) {
  // 自分の字にある部品（名前）は、にせものにしない
  const own = new Set([...KVG[word.k].t, ...KVG[word.k].e]);
  const sims = word.sim || [];
  const partsOf = (ch) => {
    const data = KVG[ch];
    if (!data) return [];
    return data.p
      .map((_, i) => ({ name: data.e[i], c: ch, i }))
      .filter((part) => part.name && !own.has(part.name));
  };
  const picked = [];
  const add = (part) => {
    if (picked.length < MAX_DECOYS && !picked.some((p) => p.name === part.name)) picked.push(part);
  };
  shuffle(sims.flatMap(partsOf)).forEach(add);
  if (picked.length < MIN_DECOYS) {
    const others = shuffle(Object.keys(KVG).filter((ch) => ch !== word.k && !sims.includes(ch)));
    for (const ch of others) {
      for (const part of partsOf(ch)) {
        if (picked.length < MIN_DECOYS) add(part);
      }
      if (picked.length >= MIN_DECOYS) break;
    }
  }
  return picked.map((part) => ({ c: part.c, i: part.i }));
}

// 部品の順番は「正しい部品（データの順）→ にせもの（渡された順）」。見る側もこの順で数える
function buildStage(word, decoys, layoutName, watching) {
  const data = KVG[word.k];
  const layout = Object.hasOwn(LAYOUTS, layoutName) ? LAYOUTS[layoutName] : LAYOUTS.wide;
  const pieces = [
    ...data.p.map((strokes) => ({ home: true, paths: strokes.map((s) => data.s[s]) })),
    ...decoys.map((ref) => ({ home: false, paths: KVG[ref.c].p[ref.i].map((s) => KVG[ref.c].s[s]) })),
  ];
  const ghost = svg('g', { class: 'yk-ghost' }, data.s.map((d) => svg('path', { d })));
  const placedLayer = svg('g', {});
  const looseLayer = svg('g', {});
  const finalLayer = svg('g', { class: 'yk-final' });
  const frame = svg('rect', { class: 'yk-stage__frame', x: 0, y: 0, width: 109, height: 109, rx: 4 });
  const stage = svg('svg', {
    class: `yk-stage${watching ? ' yk-stage--watch' : ''}`,
    viewBox: `0 0 ${layout.w} ${layout.h}`,
    role: watching ? 'img' : 'group',
    'aria-label': watching ? `「${word.k}」を組み立てている盤面` : `「${word.k}」を組み立てる盤面`,
  },
  layout.trays.map((t) => svg('rect', { class: 'yk-stage__tray', x: t.x, y: t.y, width: t.w, height: t.h, rx: 6 })),
  svg('g', { transform: `translate(${layout.fx} ${layout.fy})` },
    frame,
    svg('line', { class: 'yk-stage__guide', x1: 54.5, y1: 3, x2: 54.5, y2: 106 }),
    svg('line', { class: 'yk-stage__guide', x1: 3, y1: 54.5, x2: 106, y2: 54.5 }),
    ghost, placedLayer, looseLayer, finalLayer));

  for (const piece of pieces) {
    piece.inks = piece.paths.map((d) => svg('path', { class: 'yk-piece__ink', d }));
    piece.node = svg('g', { class: 'yk-piece' },
      watching ? null : piece.paths.map((d) => svg('path', { class: 'yk-piece__hit', d })),
      piece.inks);
    looseLayer.append(piece.node);
  }
  return { data, layout, pieces, stage, frame, ghost, placedLayer, looseLayer, finalLayer };
}

// 組み上がった字を、書き順どおりにもう一度書いて見せる
function drawFinal(parts) {
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  parts.frame.classList.add('is-done');
  parts.ghost.classList.remove('is-on');
  for (const piece of parts.pieces) {
    if (!piece.locked) piece.node.classList.add('is-gone');
    piece.node.removeAttribute('tabindex');
  }
  parts.placedLayer.classList.add('is-under');
  parts.data.s.forEach((d, i) => {
    const path = svg('path', { d });
    parts.finalLayer.append(path);
    if (still) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
    path.getBoundingClientRect();
    path.style.transition = `stroke-dashoffset ${DRAW_STEP_MS * 1.6}ms ease ${i * DRAW_STEP_MS}ms`;
    path.style.strokeDashoffset = '0';
  });
  return still;
}

// ── パズル（遊ぶ側） ─────────────────────────────
// fresh: 制限時間を新しく始める（「もう一度」のとき）。再読み込み・「ばらし直す」では、前と同じ終わりの時刻を使う
function showPuzzle(unit, index, { inSet = false, fresh = false } = {}) {
  const words = playable(unit);
  const word = words[index];
  setShown = inSet;
  const layoutName = window.matchMedia('(max-width: 700px)').matches ? 'tall' : 'wide';
  const decoys = pickDecoys(word);
  const parts = buildStage(word, decoys, layoutName, false);
  const { layout, pieces, stage, ghost, placedLayer, looseLayer } = parts;
  let remaining = parts.data.p.length;
  let finished = false;

  const status = el('p', { class: 'yk-puzzle-status', 'aria-live': 'polite' }, `あと${remaining}つ`);
  const result = el('div', { class: 'yk-puzzle-result', hidden: true });
  // メンターが制限時間を決めたときだけ、残り時間の帯を出す（一人で遊ぶときは時間制限なし）
  const limitSec = inSet && set.t > 0 ? set.t : 0;
  const bar = limitSec ? timerBar(limitSec) : null;
  const tools = el('div', { class: 'yk-puzzle-tools' },
    button('見本を見る', 'btn-ghost btn-sm', () => {
      ghost.classList.add('is-on');
      publish('puzzle/peek', true);
      setTimeout(() => {
        ghost.classList.remove('is-on');
        if (!finished) publish('puzzle/peek', false);
      }, PEEK_MS);
    }, { iconName: 'visibility' }),
    button('ばらし直す', 'btn-ghost btn-sm', () => showPuzzle(unit, index, { inSet }), { iconName: 'shuffle' }));

  show(
    inSet ? backLink('問題をやめる', quitSet) : backLink('語の一覧', () => showUnit(unit.id)),
    inSet ? el('p', { class: 'yk-set-count' }, `問題 ${set.i + 1} / ${set.words.length}`) : null,
    el('div', { class: 'yk-puzzle-head' }, wordHead(word)),
    el('div', { class: 'yk-puzzle-guide' }, el('p', {}, GUIDE), status),
    bar ? bar.root : null,
    stage,
    tools,
    result,
  );

  // 形をはかる（盤面に入れてからでないと長さが取れない）
  for (const piece of pieces) {
    const points = piece.inks.map((path) => {
      const length = path.getTotalLength();
      return Array.from({ length: SAMPLES }, (_, i) => path.getPointAtLength((length * i) / (SAMPLES - 1)));
    });
    const xs = points.flat().map((p) => p.x);
    const ys = points.flat().map((p) => p.y);
    const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    piece.box = box;
    piece.cx = box.x + box.w / 2;
    piece.cy = box.y + box.h / 2;
    piece.size = Math.hypot(box.w, box.h);
    piece.shape = points.map((pts) => pts.map((p) => ({ x: p.x - piece.cx, y: p.y - piece.cy })));
    piece.node.setAttribute('tabindex', '0');
    piece.node.setAttribute('role', 'button');
    piece.node.setAttribute('aria-label', '部品');
    // 部品（2画以上）は、すき間をつかんでも動かせるようにする
    if (piece.inks.length > 1) {
      piece.node.prepend(svg('rect', { class: 'yk-piece__area', x: box.x, y: box.y, width: box.w, height: box.h }));
    }
  }

  // 同じ形の部品（「晶」の3つの「日」）は、どの場所にもはまるようにする
  const sameShape = (a, b) => {
    if (a.shape.length !== b.shape.length) return false;
    const limit = Math.max(3, 0.22 * Math.max(a.size, b.size));
    return a.shape.every((pts, i) => pts.every((p, k) => Math.hypot(p.x - b.shape[i][k].x, p.y - b.shape[i][k].y) < limit));
  };
  const slots = pieces.filter((p) => p.home).map((owner) => ({ owner, filled: false }));
  for (const piece of pieces) {
    piece.fits = piece.home ? slots.filter((slot) => slot.owner === piece || sameShape(piece, slot.owner)) : [];
  }

  function moveTo(piece, dx, dy) {
    // 盤面の外には出さない
    piece.dx = Math.min(layout.w - layout.fx - piece.cx - 4, Math.max(4 - layout.fx - piece.cx, dx));
    piece.dy = Math.min(layout.h - layout.fy - piece.cy - 4, Math.max(4 - layout.fy - piece.cy, dy));
    piece.node.setAttribute('transform', `translate(${piece.dx.toFixed(2)} ${piece.dy.toFixed(2)})`);
  }

  // 見る画面へ送る形（x・y は字の枠からのずれ。l は「はまった」）
  const round = (n) => Math.round(n * 10) / 10;
  const wire = (piece) => ({ x: round(piece.dx), y: round(piece.dy), l: piece.locked ? 1 : 0 });
  const sendPiece = (piece) => publish(`puzzle/pieces/${pieces.indexOf(piece)}`, wire(piece));

  // ばらまく（ほかの部品から、なるべくはなす）
  const scattered = [];
  shuffle(pieces).forEach((piece, order) => {
    const tray = layout.trays[order % layout.trays.length];
    const range = (min, max) => (max > min ? min + Math.random() * (max - min) : (min + max) / 2);
    let best = null;
    for (let i = 0; i < SCATTER_TRIES; i += 1) {
      const dx = range(tray.x - layout.fx - piece.box.x, tray.x + tray.w - layout.fx - piece.box.x - piece.box.w);
      const dy = range(tray.y - layout.fy - piece.box.y, tray.y + tray.h - layout.fy - piece.box.y - piece.box.h);
      const cx = piece.cx + dx;
      const cy = piece.cy + dy;
      const gap = Math.min(Infinity, ...scattered.map((p) => Math.hypot(p.cx - cx, p.cy - cy)));
      if (!best || gap > best.gap) best = { dx, dy, cx, cy, gap };
    }
    scattered.push(best);
    moveTo(piece, best.dx, best.dy);
  });

  let endsAt = 0;
  if (limitSec) {
    if (!fresh && set.deadline && set.deadline.i === set.i) {
      endsAt = set.deadline.at;
    } else {
      endsAt = RoomkRTDB.now() + limitSec * 1000;
      set.deadline = { i: set.i, at: endsAt };
      saveSession();
    }
  }
  publish('', {
    view: {
      name: 'puzzle',
      unit: unit.id,
      ...(inSet ? { set: { id: set.id, words: set.words, i: set.i } } : {}),
      ...(!inSet && afterSet ? { afterSet } : {}),
    },
    puzzle: {
      unit: unit.id, w: index, layout: layoutName, decoys, pieces: pieces.map(wire), peek: false, done: false,
      ...(limitSec ? { limit: limitSec, endsAt } : {}),
    },
  });

  if (bar) puzzleTimer = startCountdown(bar, endsAt, limitSec, () => finish({ timeUp: true }));

  function tryPlace(piece) {
    let best = null;
    for (const slot of piece.fits) {
      if (slot.filled) continue;
      const dx = slot.owner.cx - piece.cx;
      const dy = slot.owner.cy - piece.cy;
      const gap = Math.hypot(piece.dx - dx, piece.dy - dy);
      if (gap < SNAP && (!best || gap < best.gap)) best = { slot, dx, dy, gap };
    }
    if (!best) return sendPiece(piece);
    best.slot.filled = true;
    piece.locked = true;
    moveTo(piece, best.dx, best.dy);
    piece.node.classList.add('is-locked');
    piece.node.removeAttribute('tabindex');
    placedLayer.append(piece.node);
    sendPiece(piece);
    remaining -= 1;
    if (remaining === 0) return finish();
    status.textContent = `あと${remaining}つ`;
    return undefined;
  }

  // timeUp: 制限時間になった。×は出さず、字を書き順どおりに書いて形をたしかめ、そのまま先へ進める。星は付けない
  function finish({ timeUp = false } = {}) {
    if (finished) return;
    finished = true;
    puzzleTimer = stopTimer(puzzleTimer);
    if (!timeUp) {
      store.clear[wordKey(unit, word)] = 1;
      saveStore();
      window.RoomkStats?.count('puzzle-done');
    }
    status.textContent = timeUp ? '時間です' : 'できました';
    tools.hidden = true;
    const still = drawFinal(parts);
    if (timeUp) publish('puzzle', { ...copyOf(live.puzzle), done: true, timeout: true });
    else publish('puzzle/done', true);

    const nextIndex = (index + 1) % words.length;
    const wroteKey = wordKey(unit, word);
    const wroteBtn = button(store.wrote[wroteKey] ? '紙にも書きました' : '紙にも書いた', 'btn-ghost btn-sm', () => {
      store.wrote[wroteKey] = true;
      saveStore();
      wroteBtn.disabled = true;
      wroteBtn.querySelector('.btn__label').textContent = '紙にも書きました';
    }, { iconName: 'edit', disabled: Boolean(store.wrote[wroteKey]) });

    if (inSet) {
      if (!set.done.includes(index)) set.done.push(index);
      // もう一度やって組み立てられたら、時間切れのしるしは外す
      if (timeUp && !set.late.includes(index)) set.late.push(index);
      if (!timeUp) set.late = set.late.filter((k) => k !== index);
      saveSession();
    }
    const lastInSet = inSet && set.i >= set.words.length - 1;
    result.hidden = false;
    result.replaceChildren(
      timeUp ? el('p', { class: 'yk-puzzle-result__timeup' }, '時間です。形をたしかめましょう。') : null,
      ...resultWord(word),
      inSet
        ? el('div', { class: 'yk-actions' },
          button('もう一度', 'btn-ghost', () => showPuzzle(unit, index, { inSet, fresh: true }), { iconName: 'replay' }),
          lastInSet
            ? button('おわりへ', 'btn-primary', showSetDone, { iconName: 'arrow_forward', iconAfter: true })
            : button('つぎの問題へ', 'btn-primary', () => {
              set.i += 1;
              saveSession();
              showSetPuzzle();
            }, { iconName: 'arrow_forward', iconAfter: true }))
        : el('div', { class: 'yk-actions' },
          button('もう一度', 'btn-ghost', () => showPuzzle(unit, index), { iconName: 'replay' }),
          button('語の一覧へ', 'btn-secondary', () => showUnit(unit.id)),
          button('つぎの語へ', 'btn-primary', () => showPuzzle(unit, nextIndex), { iconName: 'arrow_forward', iconAfter: true })),
      el('div', { class: 'yk-puzzle-result__write' },
        el('span', {}, 'お手本を見ながら、紙にも1回書いてみましょう。'),
        wroteBtn));
    result.querySelector('.yk-actions .btn-primary').focus({ preventScroll: true });
    result.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' });
  }

  // ドラッグ
  const toStage = (event) => {
    const point = stage.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    return point.matrixTransform(stage.getScreenCTM().inverse());
  };

  for (const piece of pieces) {
    let grab = null;
    let lastSent = 0;
    piece.node.addEventListener('pointerdown', (event) => {
      if (finished || piece.locked || event.button > 0) return;
      event.preventDefault();
      const at = toStage(event);
      grab = { x: at.x, y: at.y, dx: piece.dx, dy: piece.dy, id: event.pointerId };
      looseLayer.append(piece.node);
      piece.node.classList.add('is-drag');
      try { piece.node.setPointerCapture(event.pointerId); } catch { /* つかめなくても動かせる */ }
    });
    piece.node.addEventListener('pointermove', (event) => {
      if (!grab || event.pointerId !== grab.id) return;
      const at = toStage(event);
      moveTo(piece, grab.dx + at.x - grab.x, grab.dy + at.y - grab.y);
      if (performance.now() - lastSent >= MOVE_SEND_MS) {
        lastSent = performance.now();
        sendPiece(piece);
      }
    });
    const drop = (event) => {
      if (!grab || event.pointerId !== grab.id) return;
      grab = null;
      piece.node.classList.remove('is-drag');
      if (event.type === 'pointerup') tryPlace(piece);
      else sendPiece(piece);
    };
    piece.node.addEventListener('pointerup', drop);
    piece.node.addEventListener('pointercancel', drop);

    // キーボード：矢印で動かし、Enter か スペースで放す
    piece.node.addEventListener('keydown', (event) => {
      if (finished || piece.locked) return;
      const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (step) {
        event.preventDefault();
        moveTo(piece, piece.dx + step[0] * KEY_STEP, piece.dy + step[1] * KEY_STEP);
        sendPiece(piece);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        tryPlace(piece);
      }
    });
  }
}

// ── メンターが出した問題（子ども側） ─────────────────
// メンターが「はじめる」を押すと、子どもの画面はその場で問題に切りかわる（オーナー決定）。
// 語は、メンターが選んだ語があればその語を選んだ順に。なければ、その単元から、まだ組み立てていない語を先に、おまかせで選ぶ
function readOrder(value) {
  if (!value || typeof value !== 'object' || typeof value.id !== 'string' || !ORDER_ID_RE.test(value.id)) return null;
  const unit = UNITS.find((u) => u.id === value.unit);
  if (!unit) return null;
  // 制限時間は、決めてある秒数だけ（書いていなければ、なし）
  const t = value.t === undefined ? 0 : value.t;
  if (!ORDER_TIMES.includes(t)) return null;
  if (value.words !== undefined) {
    const words = value.words;
    const count = playable(unit).length;
    if (!Array.isArray(words) || !words.length || words.length > ORDER_MAX || value.n !== words.length
      || !words.every((i) => Number.isInteger(i) && i >= 0 && i < count) || new Set(words).size !== words.length) return null;
    return { id: value.id, unit, n: words.length, words: [...words], t };
  }
  const n = value.n;
  if (!(n === 0 || (Number.isInteger(n) && n >= 1 && n <= ORDER_MAX))) return null;
  return { id: value.id, unit, n, t };
}

function onOrder(value) {
  const order = readOrder(value);
  if (!order) {
    if (afterSet) {
      afterSet = null;
      saveSession();
    }
    if (set) {
      const unitId = set.unit;
      set = null;
      saveSession();
      RoomkRTDB.showToast('メンターが問題をおわりにしました', false);
      showUnit(unitId);
    }
    return;
  }
  if (set && set.id === order.id) {
    if (!setShown) showSetScreen(); // 再読み込みのあと、続きにもどる
    return;
  }
  if (handledOrders.has(order.id)) return;
  startSet(order);
}

function startSet(order) {
  handledOrders.add(order.id);
  afterSet = null;
  const words = playable(order.unit);
  const all = words.map((_, i) => i);
  const fresh = shuffle(all.filter((i) => !isCleared(order.unit, words[i])));
  const built = shuffle(all.filter((i) => isCleared(order.unit, words[i])));
  const count = order.n === 0 ? all.length : Math.min(order.n, all.length);
  const chosen = order.words || [...fresh, ...built].slice(0, count);
  set = { id: order.id, unit: order.unit.id, words: chosen, i: 0, done: [], late: [], t: order.t, deadline: null, counted: false };
  saveSession();
  showSetScreen();
}

function showSetScreen() {
  if (set.i >= set.words.length) showSetDone();
  else showSetPuzzle();
}

function showSetPuzzle() {
  const unit = UNITS.find((u) => u.id === set.unit);
  showPuzzle(unit, set.words[set.i], { inSet: true });
}

function showSetDone() {
  const unit = UNITS.find((u) => u.id === set.unit);
  const words = playable(unit);
  set.i = set.words.length;
  if (!set.counted) {
    set.counted = true;
    window.RoomkStats?.count('order-done');
  }
  saveSession();
  setShown = true;
  const late = set.late || [];
  publish('', { view: { name: 'setdone', unit: unit.id, set: { id: set.id, words: set.words, i: set.i, ...(late.length ? { late } : {}) } } });
  show(
    heading(late.length ? 'おわりました' : '全部組み立てました'),
    el('p', { class: 'yk-lead' }, late.length
      ? `${unitTitle(unit)}の${set.words.length}問です。星のない語は、一覧からもう一度組み立てられます。`
      : `${unitTitle(unit)}の${set.words.length}問です。`),
    setList(words, set.words, late),
    el('div', { class: 'yk-actions' },
      button('一覧へもどる', 'btn-primary', () => leaveSet('done'), { iconName: 'arrow_forward', iconAfter: true })),
  );
}

// おわりの一覧。組み立てた語には星、時間切れの語には付けない
function setList(words, chosen, late) {
  return el('ul', { class: 'yk-set-list' }, chosen.map((i) => el('li', { class: 'yk-set-list__item' },
    el('span', { class: 'yk-kyo' }, wordSpans(words[i], (k) => el('span', { class: 'yk-word-tile__focus' }, k))),
    late.includes(i) ? null : el('span', { class: 'yk-word-tile__built' }, icon('star'), el('span', { class: 'yk-sr-only' }, '組み立てた')))));
}

// 子どもが問題から抜ける（やめる・おわる）。メンターの画面には、抜けたことが出る
function leaveSet(how) {
  if (!set) return;
  const unitId = set.unit;
  afterSet = { id: set.id, how };
  set = null;
  saveSession(); // 抜けたしるしも残す（再読み込みしても、メンターの画面に「抜けた」と出しつづける）
  showUnit(unitId);
}

function quitSet() {
  leaveSet('quit');
}

// ── リンクからひらいたとき（子ども側） ─────────────────
function showInvite(code) {
  const error = el('p', { class: 'form-message', id: 'inviteError', role: 'alert', hidden: true });
  const startBtn = button('見せてはじめる', 'btn-primary', async () => {
    startBtn.disabled = true;
    error.hidden = true;
    const result = await startShowing(code);
    if (result === true) {
      window.RoomkStats?.count('show');
      if (!setShown) showTop(); // つないだ時点でメンターが問題を出していれば、もうその画面になっている
      return;
    }
    startBtn.disabled = false;
    if (result === 'gone') {
      showGone();
      return;
    }
    // 入れなかった間は ?room= を残す（再読み込みしても、このリンクのまま）
    error.textContent = 'うまくつながりませんでした。もう一度ためしてください。';
    error.hidden = false;
  }, { iconName: 'visibility', id: 'btnShow' });
  show(
    heading('メンターといっしょにやる'),
    el('div', { class: 'card yk-invite' },
      el('p', {}, 'このリンクからひらくと、あなたのパズルの画面が、メンターの画面にも出ます。'),
      el('ul', { class: 'yk-invite__list' },
        el('li', {}, '見えるのは、パズルの画面だけです。'),
        el('li', {}, 'メンターが問題を出すと、その問題がはじまります。'),
        el('li', {}, '上に出る「見せるのをやめる」で、いつでもやめられます。')),
      error,
      el('div', { class: 'yk-actions' },
        button('見せずに一人でやる', 'btn-ghost', () => {
          clearRoomParam();
          showTop();
        }, { id: 'btnSolo' }),
        startBtn)),
  );
}

function showGone() {
  show(
    heading('このリンクのルームは、もうとじています'),
    el('div', { class: 'card yk-invite' },
      el('p', {}, 'メンターに、新しいリンクを送ってもらいましょう。一人でやることもできます。'),
      el('div', { class: 'yk-actions' },
        button('一人でやる', 'btn-primary', () => {
          clearRoomParam();
          showTop();
        }))),
  );
}

// ── 見る画面（メンター側） ───────────────────────────
let watchBody = null;
let watchBoard = null;
let watchPanel = null;     // 問題を出すパネル { root, start, end, status }
// n: 問題数（0 は全部）か 'pick'（語を選ぶ）。picked: 選んだ語の番号（選んだ順）。単元を変えると空にする
const panelState = { unit: UNITS[0].id, n: ORDER_DEFAULT, picked: [], t: 0 };

async function createWatch() {
  if (share.busy || share.link) return;
  share.busy = true;
  const createBtn = document.getElementById('btnCreateWatch');
  if (createBtn) createBtn.disabled = true;
  let code = null;
  try {
    code = await createRoom();
    window.RoomkStats?.count('room-create');
  } catch (error) {
    console.warn('[yokumite-kanji] create failed', error);
    RoomkRTDB.showToast('ルームを作れませんでした。もう一度ためしてください');
  } finally {
    share.busy = false;
    if (createBtn) createBtn.disabled = false;
  }
  if (code && await startWatching(code) !== true) {
    RoomkRTDB.showToast('うまくつながりませんでした。もう一度ためしてください');
  }
}

// 見る画面をひらく。つながったら true（ルームがない・終わっているときは 'gone'、通信の失敗は 'error'）
async function startWatching(code) {
  if (share.busy || share.link) return 'busy';
  share.busy = true;
  try {
    const result = await openLink(code, 'viewer', pid);
    if (!result.ok) return result.reason;
    adoptLink(result.link, code, 'viewer');
    result.link.onPeer((on) => {
      share.peer = on;
      if (on) share.everPeer = true;
      renderWatch();
    });
    result.link.onValue(onWatchValue);
    result.link.onOrder(() => renderPanel());
    result.link.onEnd((reason) => {
      leaveWatch();
      RoomkRTDB.showToast(reason === 'expired' ? '時間がたったので、ルームがとじました' : 'ルームがとじました', false);
    });
    if (!share.link) return 'gone'; // つないだ直後に終わっていた（上の onEnd がもう片付けた）
    showWatch();
    return true;
  } finally {
    share.busy = false;
  }
}

function leaveWatch() {
  watchTimer = stopTimer(watchTimer);
  resetShare();
  watchBody = null;
  watchBoard = null;
  watchPanel = null;
  showTop();
}

const orderTitle = (order) => `${unitTitle(order.unit)}・${order.words ? `選んだ${order.n}語` : order.n === 0 ? '全部' : `${order.n}問`}${order.t ? `・1問${order.t}秒` : ''}`;

function buildPanel() {
  const wordsBox = el('div', { class: 'yk-order__words', id: 'orderWords', role: 'group', 'aria-label': '出す語' });
  const pickNote = el('p', { class: 'yk-order__pick-note', 'aria-live': 'polite' });
  // 「語を選ぶ」のときだけ、単元の語を並べる。押した順に出す
  function renderWords() {
    const picking = panelState.n === 'pick';
    wordsBox.hidden = !picking;
    pickNote.hidden = !picking;
    if (!picking) return;
    const unit = UNITS.find((u) => u.id === panelState.unit);
    wordsBox.replaceChildren(...playable(unit).map((word, i) => {
      const at = panelState.picked.indexOf(i);
      return el('button', {
        type: 'button', class: 'yk-order__word', 'data-i': String(i), 'aria-pressed': String(at >= 0),
        on: {
          click: () => {
            const k = panelState.picked.indexOf(i);
            if (k >= 0) panelState.picked.splice(k, 1);
            else if (panelState.picked.length < ORDER_MAX) panelState.picked.push(i);
            renderWords();
            renderPanel();
          },
        },
      },
      at >= 0 ? el('span', { class: 'yk-order__word-no' }, String(at + 1)) : null,
      el('span', { class: 'yk-kyo' }, word.w));
    }));
    pickNote.textContent = panelState.picked.length
      ? `${panelState.picked.length}語を選んでいます。押した順に出します。`
      : '出したい語を押して選びます。押した順に出します。';
  }
  const select = el('select', {
    class: 'form-select yk-order__unit', id: 'orderUnit', 'aria-label': '単元',
    on: {
      change: () => {
        panelState.unit = select.value;
        panelState.picked = [];
        renderWords();
        renderPanel();
      },
    },
  }, [...new Set(UNITS.map((u) => u.subject))].map((subject) => el('optgroup', { label: subject },
    UNITS.filter((u) => u.subject === subject).map((u) => el('option', { value: u.id, selected: u.id === panelState.unit }, u.name)))));
  const counts = [...ORDER_COUNTS, 'pick'].map((n) => el('button', {
    type: 'button', class: 'yk-order__count', 'data-n': String(n), 'aria-pressed': String(n === panelState.n),
    on: {
      click: () => {
        panelState.n = n;
        counts.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.n === String(n))));
        renderWords();
        renderPanel();
      },
    },
  }, n === 'pick' ? '語を選ぶ' : n === 0 ? '全部' : `${n}問`));
  const times = ORDER_TIMES.map((t) => el('button', {
    type: 'button', class: 'yk-order__count yk-order__time', 'data-t': String(t), 'aria-pressed': String(t === panelState.t),
    on: {
      click: () => {
        panelState.t = t;
        times.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.t) === t)));
      },
    },
  }, t === 0 ? 'なし' : `${t}秒`));
  const start = button('はじめる', 'btn-primary', async () => {
    const link = share.link;
    if (!link || !share.peer) return;
    if (!link.isConnected()) {
      RoomkRTDB.showToast('接続が切れています。つながってから、もう一度押してください');
      return;
    }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => PID_CHARS[n % PID_CHARS.length]).join('');
    start.disabled = true;
    const picking = panelState.n === 'pick';
    if (picking && !panelState.picked.length) return;
    const ok = await link.sendOrder(picking
      ? { id, unit: panelState.unit, n: panelState.picked.length, words: [...panelState.picked], t: panelState.t }
      : { id, unit: panelState.unit, n: panelState.n, t: panelState.t });
    start.disabled = false;
    renderPanel();
    if (ok) window.RoomkStats?.count('order-start');
    else RoomkRTDB.showToast('問題を出せませんでした。もう一度ためしてください');
  }, { iconName: 'play_arrow', id: 'btnStartOrder' });
  const end = button('問題をおわる', 'btn-ghost btn-sm', async () => {
    const link = share.link;
    if (!link) return;
    end.disabled = true;
    const ok = await link.clearOrder();
    end.disabled = false;
    if (!ok) RoomkRTDB.showToast('おわりにできませんでした。もう一度ためしてください');
  }, { iconName: 'stop', id: 'btnEndOrder' });
  const status = el('p', { class: 'yk-order__status', 'aria-live': 'polite' });
  const root = el('section', { class: 'card yk-order', 'aria-labelledby': 'orderTitle' },
    el('h3', { class: 'yk-order__title', id: 'orderTitle' }, '問題を出す'),
    el('div', { class: 'yk-order__row' },
      el('label', { class: 'yk-order__field' }, el('span', { class: 'yk-order__label' }, '単元'), select),
      el('div', { class: 'yk-order__field' },
        el('span', { class: 'yk-order__label', id: 'orderCountLabel' }, '問題数'),
        el('div', { class: 'yk-order__counts', role: 'group', 'aria-labelledby': 'orderCountLabel' }, counts)),
      el('div', { class: 'yk-order__field' },
        el('span', { class: 'yk-order__label', id: 'orderTimeLabel' }, '1問の制限時間'),
        el('div', { class: 'yk-order__counts', role: 'group', 'aria-labelledby': 'orderTimeLabel' }, times)),
      start),
    pickNote,
    wordsBox,
    el('div', { class: 'yk-order__foot' }, status, end));
  renderWords();
  return { root, start, end, status };
}

// 出している問題と、子どもの進み具合を、パネルに出す
function renderPanel() {
  if (!watchPanel || !share.link) return;
  const order = readOrder(share.link.getOrder());
  const state = share.link.get();
  const view = state.view;
  watchPanel.start.disabled = !share.peer || (panelState.n === 'pick' && !panelState.picked.length);
  watchPanel.end.hidden = !order;
  if (!share.peer) {
    watchPanel.status.textContent = order ? `出している問題: ${orderTitle(order)}（相手が入ると、はじまります）` : '相手が入ると、問題を出せます。';
    return;
  }
  if (!order) {
    watchPanel.status.textContent = '単元と問題数（または語）を選んで「はじめる」を押すと、相手の画面がその問題になります。';
    return;
  }
  let progress = 'はじまるのを待っています';
  const info = readSetView(view, state);
  const mine = info && info.id === order.id ? info : null;
  const after = readAfterSet(view);
  if (mine && mine.done) progress = mine.late.length ? 'おわりました' : '全部組み立てました';
  else if (mine) progress = `${mine.i + 1}問目 / ${mine.words.length}問`;
  else if (after && after.id === order.id) {
    progress = after.how === 'done' ? 'おわって、一覧にもどりました' : '問題をやめて、一覧にもどりました';
  }
  watchPanel.status.textContent = `出している問題: ${orderTitle(order)} ・ ${progress}`;
}


function showWatch() {
  const code = share.code;
  watchBody = el('div', { class: 'yk-watch-body' });
  const linkBtn = button('リンクをコピー', 'btn-secondary btn-sm', () => RoomkRTDB.copyRoomLink(code, linkBtn), { iconName: 'link', id: 'btnCopyLink' });
  const closeBtn = button('とじる', 'btn-ghost btn-sm', async () => {
    const link = share.link;
    if (!link) return;
    if (!link.isConnected()) {
      RoomkRTDB.showToast('接続が切れています。つながってから、もう一度押してください');
      return;
    }
    closeBtn.disabled = true;
    const done = await link.finish();
    closeBtn.disabled = false;
    if (done) leaveWatch();
    else RoomkRTDB.showToast('とじられませんでした。もう一度ためしてください');
  }, { iconName: 'close', id: 'btnCloseWatch' });
  watchPanel = buildPanel();
  show(
    heading('見る画面'),
    el('div', { class: 'yk-watch-bar' },
      el('span', { class: 'yk-watch-bar__code' }, 'ルームコード ', el('strong', {}, code)),
      linkBtn,
      closeBtn),
    watchPanel.root,
    watchBody,
  );
  renderWatch();
}

const watchNote = (text, iconName) => el('p', { class: 'yk-watch-note', role: 'status' }, icon(iconName), text);

// 画面の切りかえ・新しいパズル・はじめの一括のときに、見る画面の中身を作り直す
function renderWatch() {
  if (!watchBody) return;
  watchTimer = stopTimer(watchTimer);
  renderPanel();
  watchBoard = null;
  const state = share.link.get();
  const view = state.view;
  if (!share.peer) {
    watchBody.replaceChildren(share.everPeer
      ? watchNote('相手の画面がとじました。', 'visibility_off')
      : watchNote('まだだれも入っていません。リンクを送って、ひらいてもらいましょう。', 'hourglass_top'));
    return;
  }
  const unit = view && typeof view === 'object' ? UNITS.find((u) => u.id === view.unit) : null;
  if (!unit || view.name === 'top') {
    watchBody.replaceChildren(watchNote('単元を選んでいます。', 'list'));
    return;
  }
  const words = playable(unit);
  const setInfo = readSetView(view, state);
  if (view.name === 'setdone' && setInfo) {
    watchBody.replaceChildren(
      watchNote(`${setInfo.late.length ? 'おわりました' : '全部組み立てました'}（${unitTitle(unit)}の${setInfo.words.length}問）。`, 'star'),
      setList(words, setInfo.words, setInfo.late));
    return;
  }
  const spec = state.puzzle;
  const word = spec && Number.isInteger(spec.w) && spec.w >= 0 && spec.w < words.length ? words[spec.w] : null;
  if (view.name !== 'puzzle' || !word) {
    watchBody.replaceChildren(watchNote(`語を選んでいます（${unitTitle(unit)}）。`, 'list'));
    return;
  }
  try {
    renderWatchBoard(unit, word, spec, setInfo);
  } catch (error) {
    console.warn('[yokumite-kanji] watch render failed', error);
    watchBoard = null;
    watchBody.replaceChildren(watchNote('相手の画面を読みこめませんでした。', 'visibility_off'));
  }
}

// 見せる側が送ってきた「問題の何問目か」を確かめる。形がそろっていなければ null（数は出さない）
//   パズル中: i は 0〜問題数-1 で、出ている語（puzzle.w）が words[i] と同じ
//   おわり（setdone）: i は問題数と同じ
function readSetView(view, state) {
  const raw = view && typeof view === 'object' ? view.set : null;
  const unit = view && UNITS.find((u) => u.id === view.unit);
  if (!unit || !raw || typeof raw !== 'object' || typeof raw.id !== 'string' || !ORDER_ID_RE.test(raw.id)) return null;
  const count = playable(unit).length;
  const words = raw.words;
  if (!Array.isArray(words) || !words.length || words.length > ORDER_MAX
    || !words.every((i) => Number.isInteger(i) && i >= 0 && i < count) || new Set(words).size !== words.length) return null;
  const i = raw.i;
  const late = Array.isArray(raw.late) ? [...new Set(raw.late)].filter((k) => words.includes(k)) : [];
  if (view.name === 'setdone') return i === words.length ? { id: raw.id, words, i, done: true, late } : null;
  const puzzle = state && state.puzzle;
  if (view.name !== 'puzzle' || !Number.isInteger(i) || i < 0 || i >= words.length) return null;
  if (!puzzle || puzzle.unit !== unit.id || puzzle.w !== words[i]) return null;
  return { id: raw.id, words, i, done: false, late };
}

// メンターの画面に出す「抜けた」しるし
function readAfterSet(view) {
  const after = view && typeof view === 'object' ? view.afterSet : null;
  return after && typeof after.id === 'string' && ORDER_ID_RE.test(after.id) && ['quit', 'done'].includes(after.how) ? after : null;
}

function renderWatchBoard(unit, word, spec, setInfo) {
  // にせものは「どの字の・何番目の部品か」で届く。手元のデータにあるものだけを使う
  const decoys = (Array.isArray(spec.decoys) ? spec.decoys : [])
    .slice(0, MAX_DECOYS)
    .filter((ref) => ref && typeof ref.c === 'string' && Object.hasOwn(KVG, ref.c)
      && Number.isInteger(ref.i) && ref.i >= 0 && ref.i < KVG[ref.c].p.length);
  const parts = buildStage(word, decoys, spec.layout, true);
  const status = el('p', { class: 'yk-puzzle-status', 'aria-live': 'polite' });
  const result = el('div', { class: 'yk-puzzle-result', hidden: true });
  const homeCount = parts.data.p.length;
  // 制限時間は、見せる側が決めた終わりの時刻（サーバーの時刻にそろえた値）から数える
  const limitSec = ORDER_TIMES.includes(spec.limit) && spec.limit > 0 && Number.isFinite(spec.endsAt) ? spec.limit : 0;
  const bar = limitSec ? timerBar(limitSec) : null;
  const board = {
    parts,
    last: -1,
    setPiece(i, p) {
      const piece = parts.pieces[i];
      if (!piece || !p || typeof p !== 'object') return;
      // 盤面の外の数は受けつけない（わくからのずれは、盤面の大きさの中に収まる）
      const clamp = (n) => Math.max(-400, Math.min(400, Number(n) || 0));
      piece.node.style.transform = `translate(${clamp(p.x)}px, ${clamp(p.y)}px)`;
      if (p.l && !piece.locked) {
        piece.locked = true;
        piece.node.classList.add('is-locked');
        parts.placedLayer.append(piece.node);
      } else if (!p.l && board.last !== i) {
        board.last = i;
        parts.looseLayer.append(piece.node); // 今さわっている部品をいちばん上に
      }
      const left = homeCount - parts.pieces.filter((x) => x.home && x.locked).length;
      status.textContent = left > 0 ? `あと${left}つ` : 'できました';
    },
    setPeek(on) {
      parts.ghost.classList.toggle('is-on', Boolean(on));
    },
    finish(timeUp) {
      if (board.done) return;
      board.done = true;
      watchTimer = stopTimer(watchTimer);
      if (bar) bar.root.hidden = true;
      drawFinal(parts);
      status.textContent = timeUp ? '時間です' : 'できました';
      result.hidden = false;
      result.replaceChildren(
        timeUp ? el('p', { class: 'yk-puzzle-result__timeup' }, '時間です。') : null,
        ...resultWord(word));
    },
  };
  watchBody.replaceChildren(
    setInfo ? el('p', { class: 'yk-set-count' }, `問題 ${setInfo.i + 1} / ${setInfo.words.length}`) : null,
    el('div', { class: 'yk-puzzle-head' }, wordHead(word)),
    el('div', { class: 'yk-puzzle-guide' }, el('p', {}, unitTitle(unit)), status),
    bar ? bar.root : null,
    parts.stage,
    result,
  );
  (Array.isArray(spec.pieces) ? spec.pieces : []).slice(0, PIECE_MAX).forEach((p, i) => board.setPiece(i, p));
  board.setPeek(spec.peek);
  if (spec.done) board.finish(spec.timeout === true);
  else if (bar) watchTimer = startCountdown(bar, spec.endsAt, limitSec, null); // 時間切れは、見せる側の知らせで出す
  watchBoard = board;
}

// 部品の動きは、その部品だけを動かす（盤面を作り直さない）
function onWatchValue(state, path) {
  const puzzle = state.puzzle;
  if (watchBoard && puzzle) {
    const piece = /^puzzle\/pieces\/(\d+)$/.exec(path);
    if (piece) return watchBoard.setPiece(Number(piece[1]), (puzzle.pieces || [])[piece[1]]);
    if (path === 'puzzle/peek') return watchBoard.setPeek(puzzle.peek);
    if (path === 'puzzle/done') return puzzle.done ? watchBoard.finish(puzzle.timeout === true) : undefined;
  }
  return renderWatch();
}

// ── はじめに ──────────────────────────────────
// 順番: ?room=（リンク）→ 保存した記録（同じウィンドウの再読み込み）→ トップ
async function resume(saved) {
  const gone = () => {
    clearSession();
    clearRoomParam();
    RoomkRTDB.showToast('前のルームは、もうとじていました', false);
  };
  // 通信の失敗では、記録も ?room= も残す（読み直せば、もう一度つなぎに行く）
  const failed = () => RoomkRTDB.showToast('うまくつながりませんでした。ページを読み直してください');
  if (saved.role === 'viewer') {
    show(heading('見る画面'), el('p', { class: 'yk-watch-note', role: 'status' }, icon('hourglass_top'), 'つないでいます。'));
    const result = await startWatching(saved.code);
    if (result === true) return;
    showTop();
    if (result === 'gone') gone();
    else failed();
    return;
  }
  restoreSet(saved);
  showTop(); // 一人でも遊べるので、先に画面を出す（問題の続きは、つないだあとに出す）
  const result = await startShowing(saved.code);
  if (result === true) return;
  if (result === 'gone') gone();
  else failed();
}

function boot() {
  const raw = new URLSearchParams(location.search).get('room');
  const saved = readSession();
  if (raw != null) {
    const code = raw.normalize('NFKC').replace(/\s+/g, '').toUpperCase();
    if (!ROOM_RE.test(code)) {
      RoomkRTDB.showToast('ルームコードが正しくありません');
      clearRoomParam();
    } else if (saved && saved.code === code) {
      return resume(saved); // 同じルームの記録があれば、つなぎ直す
    } else {
      clearSession();       // 別のルームの記録は捨てて、リンクのルームを優先する
      return showInvite(code);
    }
  }
  if (saved) return resume(saved);
  return showTop();
}

boot();
