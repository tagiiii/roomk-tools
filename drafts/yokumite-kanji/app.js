// =============================================
// よく見て漢字（試作）— にせものの混ざった部品から字を組み立てるパズル
// 仕様と経緯: README.md
// =============================================
import { shuffle } from '../../apps/shared/js/utils.js';
import { UNITS } from './data.js';
import { KVG } from './kvg-data.js';
import { openLink } from './link.js';

const { RoomkRTDB } = window;

const STORE_KEY = 'yokumite-kanji:v2';
const SESSION_KEY = 'yokumite_session';
const ROOM_RE = /^[A-Z2-9]{6}$/;

// SVG の名前空間。アドレスの形の文字列を書くと draft-lint の外部通信の検査に掛かるので、ブラウザから受け取る
const SVG_NS = (() => {
  const probe = document.createElement('div');
  probe.innerHTML = '<svg></svg>';
  return probe.firstChild.namespaceURI;
})();

const SNAP = 10;          // 正しい場所からこの距離までで放すと、はまる（字の枠は 109）
const KEY_STEP = 3;       // 矢印キー1回で動く距離
const MAX_DECOYS = 3;
const MIN_DECOYS = 2;
const PEEK_MS = 2500;
const SAMPLES = 9;        // 部品の形をくらべるために、1画から取る点の数
const DRAW_STEP_MS = 150;
const SCATTER_TRIES = 40; // ばらまくとき、重なりの少ない置き場所をこの回数だけ探す
const MOVE_SEND_MS = 80;  // 動かしている間、見る画面へ位置を送る間隔

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

function show(...nodes) {
  const screen = el('section', { class: 'screen' }, ...nodes);
  app.replaceChildren(screen);
  window.scrollTo(0, 0);
  const first = screen.querySelector('[data-focus]');
  if (first) first.focus({ preventScroll: true });
}

const heading = (text) => el('h2', { class: 'screen-title', tabindex: '-1', 'data-focus': true }, text);

function backLink(label, onClick) {
  return el('button', { type: 'button', class: 'back-link', on: { click: onClick } }, icon('arrow_back'), label);
}

// 語の中の「よく見る1字」だけを別の見た目にする
function wordSpans(word, renderFocus) {
  const at = word.w.indexOf(word.k);
  return [word.w.slice(0, at), renderFocus(word.k), word.w.slice(at + word.k.length)];
}

function wordHead(word) {
  return el('div', { class: 'puzzle-word' },
    el('h2', { class: 'puzzle-word__text kyo', tabindex: '-1', 'data-focus': true, 'aria-label': `${word.y}の字を組み立てる` },
      wordSpans(word, () => el('span', { class: 'puzzle-word__blank', 'aria-hidden': 'true' }, '？'))),
    el('p', { class: 'puzzle-word__yomi' }, word.y),
    el('p', { class: 'puzzle-word__meaning' }, word.m));
}

function resultWord(word) {
  return [
    el('div', { class: 'puzzle-result__word kyo' },
      wordSpans(word, (k) => el('span', { class: 'puzzle-result__focus' }, k))),
    ...(word.p ? [el('p', { class: 'puzzle-result__point' }, word.p)] : []),
  ];
}

// ── メンターの見る画面とのつなぎ ────────────────────
// role: 'player'（子ども。自分の画面を見せる）／'viewer'（メンター。見るだけ）
const share = { link: null, role: null, code: null, peer: false, everPeer: false };

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return saved && ROOM_RE.test(saved.code) && ['player', 'viewer'].includes(saved.role) ? saved : null;
  } catch {
    return null;
  }
}

function saveSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ code: share.code, role: share.role }));
  } catch { /* 保存できなくても、このウィンドウの間はつながる */ }
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 何もしない */ }
}

function clearRoomParam() {
  if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
}

function openShare(code, role) {
  share.link = openLink(code, role);
  share.role = role;
  share.code = code;
  share.peer = false;
  share.everPeer = false;
  saveSession();
  clearRoomParam();
}

function closeShare(tellPeer) {
  if (share.link) share.link.close(tellPeer);
  share.link = null;
  share.role = null;
  share.code = null;
  share.peer = false;
  clearSession();
  renderShareBar();
}

// 見せる側だけが送る。見せていないときは何もしない
function publish(path, value) {
  if (share.role === 'player') share.link.set(path, value);
}

function startShowing(code) {
  openShare(code, 'player');
  share.link.onPeer((on) => {
    share.peer = on;
    renderShareBar();
  });
  share.link.onEnd(() => {
    closeShare(false);
    RoomkRTDB.showToast('メンターが見る画面をとじました', false);
  });
  renderShareBar();
}

function renderShareBar() {
  if (share.role !== 'player') {
    shareBar.hidden = true;
    shareBar.replaceChildren();
    return;
  }
  shareBar.hidden = false;
  shareBar.replaceChildren(
    el('span', { class: 'share-bar__text', role: 'status' },
      icon(share.peer ? 'visibility' : 'hourglass_top'),
      share.peer ? 'メンターに見せています' : 'メンターの画面がひらくのを待っています'),
    el('button', {
      type: 'button', class: 'share-bar__stop',
      on: {
        click: () => {
          closeShare(true);
          RoomkRTDB.showToast('見せるのをやめました', false);
        },
      },
    }, '見せるのをやめる'));
}

// ── トップ ───────────────────────────────────
function showTop() {
  publish('', { view: { name: 'top' } });
  const subjects = [...new Set(UNITS.map((u) => u.subject))];
  const hasRecord = Object.keys(store.clear).length > 0 || Object.keys(store.wrote).length > 0;
  show(
    heading('単元を選ぶ'),
    el('p', { class: 'lead' }, '今、学校でやっている単元を選びます。用語の漢字を、バラバラの部品から組み立てます。'),
    subjects.map((subject) => el('div', { class: 'unit-group' },
      el('h3', { class: 'unit-group__title' }, subject),
      el('div', { class: 'unit-list' }, UNITS.filter((u) => u.subject === subject).map(unitCard)))),
    el('div', { class: 'top-foot' },
      share.role ? null : button('見る画面をつくる（メンター用）', 'btn-ghost btn-sm', createWatch, { iconName: 'co_present' }),
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
  return el('button', { type: 'button', class: 'unit-card', on: { click: () => showUnit(unit.id) } },
    icon(unit.subject === '理科' ? 'science' : 'public'),
    el('span', { class: 'unit-card__body' },
      el('span', { class: 'unit-card__name' }, unit.name),
      el('span', { class: 'unit-card__sub' }, `${words.length}語${built ? ` ・ 組み立てた字 ${built}` : ''}`)),
    icon('chevron_right'));
}

// ── 単元（語の一覧） ────────────────────────────
function showUnit(unitId) {
  const unit = UNITS.find((u) => u.id === unitId);
  if (!unit) return showTop();
  publish('', { view: { name: 'unit', unit: unit.id } });
  const words = playable(unit);
  return show(
    backLink('単元を選ぶ', showTop),
    heading(unitTitle(unit)),
    el('p', { class: 'lead' }, '組み立てる語を選びます。色のついた字がバラバラになります。'),
    el('div', { class: 'tile-grid' }, words.map((word, index) => el('button', {
      type: 'button', class: 'word-tile',
      on: { click: () => showPuzzle(unit, index) },
    },
    el('span', { class: 'word-tile__word kyo' },
      wordSpans(word, (k) => el('span', { class: 'word-tile__focus' }, k))),
    el('span', { class: 'word-tile__yomi' }, word.y),
    el('span', { class: 'word-tile__marks' },
      isCleared(unit, word)
        ? el('span', { class: 'word-tile__built' }, icon('star'), el('span', { class: 'sr-only' }, '組み立てた'))
        : null,
      store.wrote[wordKey(unit, word)]
        ? el('span', { class: 'word-tile__wrote' }, icon('edit'), el('span', { class: 'sr-only' }, '紙にも書いた'))
        : null)))),
  );
}

// ── 盤面（遊ぶ側と見る側で同じものを組む） ─────────────────
// にせものの部品。似た字の「ちがう所」を先に使い、足りなければほかの字から借りる
function pickDecoys(word) {
  const own = new Set(KVG[word.k].t);
  const sims = word.sim || [];
  const partsOf = (ch) => {
    const data = KVG[ch];
    if (!data) return [];
    return data.p
      .map((strokes, i) => ({ name: data.e[i], paths: strokes.map((s) => data.s[s]) }))
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
  return picked.map((part) => part.paths);
}

// 部品の順番は「正しい部品（データの順）→ にせもの（渡された順）」。見る側もこの順で数える
function buildStage(word, decoys, layoutName, watching) {
  const data = KVG[word.k];
  const layout = LAYOUTS[layoutName] || LAYOUTS.wide;
  const pieces = [
    ...data.p.map((strokes) => ({ home: true, paths: strokes.map((s) => data.s[s]) })),
    ...decoys.map((paths) => ({ home: false, paths })),
  ];
  const ghost = svg('g', { class: 'ghost' }, data.s.map((d) => svg('path', { d })));
  const placedLayer = svg('g', {});
  const looseLayer = svg('g', {});
  const finalLayer = svg('g', { class: 'final' });
  const frame = svg('rect', { class: 'stage__frame', x: 0, y: 0, width: 109, height: 109, rx: 4 });
  const stage = svg('svg', {
    class: `stage${watching ? ' stage--watch' : ''}`,
    viewBox: `0 0 ${layout.w} ${layout.h}`,
    role: watching ? 'img' : 'group',
    'aria-label': watching ? `「${word.k}」を組み立てている盤面` : `「${word.k}」を組み立てる盤面`,
  },
  layout.trays.map((t) => svg('rect', { class: 'stage__tray', x: t.x, y: t.y, width: t.w, height: t.h, rx: 6 })),
  svg('g', { transform: `translate(${layout.fx} ${layout.fy})` },
    frame,
    svg('line', { class: 'stage__guide', x1: 54.5, y1: 3, x2: 54.5, y2: 106 }),
    svg('line', { class: 'stage__guide', x1: 3, y1: 54.5, x2: 106, y2: 54.5 }),
    ghost, placedLayer, looseLayer, finalLayer));

  for (const piece of pieces) {
    piece.inks = piece.paths.map((d) => svg('path', { class: 'piece__ink', d }));
    piece.node = svg('g', { class: 'piece' },
      watching ? null : piece.paths.map((d) => svg('path', { class: 'piece__hit', d })),
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
function showPuzzle(unit, index) {
  const words = playable(unit);
  const word = words[index];
  const layoutName = window.matchMedia('(max-width: 700px)').matches ? 'tall' : 'wide';
  const decoys = pickDecoys(word);
  const parts = buildStage(word, decoys, layoutName, false);
  const { layout, pieces, stage, ghost, placedLayer, looseLayer } = parts;
  let remaining = parts.data.p.length;
  let finished = false;

  const status = el('p', { class: 'puzzle-status', 'aria-live': 'polite' }, `あと${remaining}つ`);
  const result = el('div', { class: 'puzzle-result', hidden: true });
  const tools = el('div', { class: 'puzzle-tools' },
    button('見本を見る', 'btn-ghost btn-sm', () => {
      ghost.classList.add('is-on');
      publish('puzzle/peek', true);
      setTimeout(() => {
        ghost.classList.remove('is-on');
        if (!finished) publish('puzzle/peek', false);
      }, PEEK_MS);
    }, { iconName: 'visibility' }),
    button('ばらし直す', 'btn-ghost btn-sm', () => showPuzzle(unit, index), { iconName: 'shuffle' }));

  show(
    backLink('語の一覧', () => showUnit(unit.id)),
    el('div', { class: 'puzzle-head' }, wordHead(word)),
    el('div', { class: 'puzzle-guide' }, el('p', {}, GUIDE), status),
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
      piece.node.prepend(svg('rect', { class: 'piece__area', x: box.x, y: box.y, width: box.w, height: box.h }));
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

  publish('', {
    view: { name: 'puzzle', unit: unit.id },
    puzzle: { unit: unit.id, w: index, layout: layoutName, decoys, pieces: pieces.map(wire), peek: false, done: false },
  });

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

  function finish() {
    finished = true;
    store.clear[wordKey(unit, word)] = 1;
    saveStore();
    status.textContent = 'できました';
    tools.hidden = true;
    const still = drawFinal(parts);
    publish('puzzle/done', true);

    const nextIndex = (index + 1) % words.length;
    const wroteKey = wordKey(unit, word);
    const wroteBtn = button(store.wrote[wroteKey] ? '紙にも書きました' : '紙にも書いた', 'btn-ghost btn-sm', () => {
      store.wrote[wroteKey] = true;
      saveStore();
      wroteBtn.disabled = true;
      wroteBtn.querySelector('.btn__label').textContent = '紙にも書きました';
    }, { iconName: 'edit', disabled: Boolean(store.wrote[wroteKey]) });

    result.hidden = false;
    result.replaceChildren(
      ...resultWord(word),
      el('div', { class: 'actions' },
        button('もう一度', 'btn-ghost', () => showPuzzle(unit, index), { iconName: 'replay' }),
        button('語の一覧へ', 'btn-secondary', () => showUnit(unit.id)),
        button('つぎの語へ', 'btn-primary', () => showPuzzle(unit, nextIndex), { iconName: 'arrow_forward', iconAfter: true })),
      el('div', { class: 'puzzle-result__write' },
        el('span', {}, 'お手本を見ながら、紙にも1回書いてみましょう。'),
        wroteBtn));
    result.querySelector('.actions .btn-primary').focus({ preventScroll: true });
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

// ── リンクからひらいたとき（子ども側） ─────────────────
function showInvite(code) {
  show(
    heading('メンターといっしょにやる'),
    el('div', { class: 'card invite' },
      el('p', {}, 'このリンクからひらくと、あなたのパズルの画面が、メンターの画面にも出ます。'),
      el('ul', { class: 'invite__list' },
        el('li', {}, '見えるのは、パズルの画面だけです。'),
        el('li', {}, '上に出る「見せるのをやめる」で、いつでもやめられます。')),
      el('div', { class: 'actions' },
        button('見せずに一人でやる', 'btn-ghost', () => {
          clearRoomParam();
          showTop();
        }),
        button('見せてはじめる', 'btn-primary', () => {
          startShowing(code);
          showTop();
        }, { iconName: 'visibility' }))),
  );
}

// ── 見る画面（メンター側） ───────────────────────────
let watchBody = null;
let watchBoard = null;

function createWatch() {
  startWatching(RoomkRTDB.generateRoomCode());
}

function startWatching(code) {
  openShare(code, 'viewer');
  share.link.onPeer((on) => {
    share.peer = on;
    if (on) share.everPeer = true;
    renderWatch();
  });
  share.link.onValue(onWatchValue);
  share.link.onEnd(() => {
    share.peer = false;
    renderWatch();
  });
  showWatch();
}

function showWatch() {
  const code = share.code;
  watchBody = el('div', { class: 'watch-body' });
  const linkBtn = button('リンクをコピー', 'btn-secondary btn-sm', () => RoomkRTDB.copyRoomLink(code, linkBtn), { iconName: 'link', id: 'btnCopyLink' });
  show(
    heading('見る画面'),
    el('div', { class: 'watch-bar' },
      el('span', { class: 'watch-bar__code' }, 'ルームコード ', el('strong', {}, code)),
      linkBtn,
      button('とじる', 'btn-ghost btn-sm', () => {
        closeShare(true);
        watchBody = null;
        watchBoard = null;
        showTop();
      }, { iconName: 'close' })),
    el('p', { class: 'draft-note' }, '試作：同じブラウザの別のウィンドウでリンクをひらいたときだけ、つながります。'),
    watchBody,
  );
  renderWatch();
}

const watchNote = (text, iconName) => el('p', { class: 'watch-note', role: 'status' }, icon(iconName), text);

// 画面の切りかえ・新しいパズル・はじめの一括のときに、見る画面の中身を作り直す
function renderWatch() {
  if (!watchBody) return;
  watchBoard = null;
  const state = share.link.get();
  const view = state.view;
  if (!share.peer) {
    watchBody.replaceChildren(share.everPeer
      ? watchNote('相手の画面がとじました。', 'visibility_off')
      : watchNote('まだだれも入っていません。リンクを送って、ひらいてもらいましょう。', 'hourglass_top'));
    return;
  }
  const unit = view && UNITS.find((u) => u.id === view.unit);
  if (!view || view.name === 'top' || !unit) {
    watchBody.replaceChildren(watchNote('単元を選んでいます。', 'list'));
    return;
  }
  const spec = state.puzzle;
  const word = spec ? playable(unit)[spec.w] : null;
  if (view.name !== 'puzzle' || !word) {
    watchBody.replaceChildren(watchNote(`語を選んでいます（${unitTitle(unit)}）。`, 'list'));
    return;
  }

  const parts = buildStage(word, spec.decoys || [], spec.layout, true);
  const status = el('p', { class: 'puzzle-status', 'aria-live': 'polite' });
  const result = el('div', { class: 'puzzle-result', hidden: true });
  const homeCount = parts.data.p.length;
  const board = {
    parts,
    last: -1,
    setPiece(i, p) {
      const piece = parts.pieces[i];
      if (!piece || !p) return;
      piece.node.style.transform = `translate(${Number(p.x) || 0}px, ${Number(p.y) || 0}px)`;
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
    finish() {
      if (board.done) return;
      board.done = true;
      drawFinal(parts);
      status.textContent = 'できました';
      result.hidden = false;
      result.replaceChildren(...resultWord(word));
    },
  };
  watchBody.replaceChildren(
    el('div', { class: 'puzzle-head' }, wordHead(word)),
    el('div', { class: 'puzzle-guide' }, el('p', {}, unitTitle(unit)), status),
    parts.stage,
    result,
  );
  (spec.pieces || []).forEach((p, i) => board.setPiece(i, p));
  board.setPeek(spec.peek);
  if (spec.done) board.finish();
  watchBoard = board;
}

// 部品の動きは、その部品だけを動かす（盤面を作り直さない）
function onWatchValue(state, path) {
  const puzzle = state.puzzle;
  if (watchBoard && puzzle) {
    const piece = /^puzzle\/pieces\/(\d+)$/.exec(path);
    if (piece) return watchBoard.setPiece(Number(piece[1]), puzzle.pieces[piece[1]]);
    if (path === 'puzzle/peek') return watchBoard.setPeek(puzzle.peek);
    if (path === 'puzzle/done') return puzzle.done ? watchBoard.finish() : undefined;
  }
  return renderWatch();
}

// ── はじめに ──────────────────────────────────
// 順番: ?room=（リンク）→ 保存した記録（同じウィンドウの再読み込み）→ トップ
function resume(saved) {
  if (saved.role === 'viewer') return startWatching(saved.code);
  startShowing(saved.code);
  return showTop();
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
