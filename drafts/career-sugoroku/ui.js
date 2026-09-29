/* キャリアすごろく v2（試作）— 画面
   1台の画面をみんなで見て遊ぶ（メンターが代わりに押す）。通信はしない。
   いつも出すのは盤面・コマ・「○○さんの番」だけ。適性・職業・ポイント・ルール・できごとはボタンで開く。
   利用者の入力（名前）は textContent で入れる（innerHTML に変数を入れない）。 */
(function () {
  'use strict';
  const D = window.CS_DATA;
  const E = window.CS_ENGINE;
  const NODE = E.NODE;
  const NUM = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔'.split('');
  const STORE_KEY = 'careersugoroku_v2_draft';
  const STEP_MS = 170;
  const SVGNS = document.getElementById('cs-svg').namespaceURI; // 名前空間はページの <svg> から取る（URL を書かない）
  const ZONE_TINT = { child: '#EEF5EA', teen: '#EAF1F7', c: '#F7F1E4', d: '#F2EEF7', adult: '#F8EEEA' };
  const ZONE_INK = { child: '#3F6B3A', teen: '#2F5A80', c: '#7A5A1E', d: '#5B4A86', adult: '#8A4A3A' };
  // 同じマスに何人かいるときの駒の位置（人ごとに固定）。スタート・節目・ゴールは文字を隠さないよう外側に並べる
  const SLOTS = {
    small: [[-12, -12], [12, -12], [-15, 5], [15, 5], [-6, 16], [6, 16]],
    start: [[-26, 44], [0, 44], [26, 44], [-26, 70], [0, 70], [26, 70]],
    stop: [[-52, -12], [52, -12], [-52, 14], [52, 14], [0, -40], [0, 40]],
    goal: [[-50, -29], [50, -29], [-50, 29], [50, 29], [0, -58], [0, 58]],
  };

  const $ = (id) => document.getElementById(id);
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduceMotion() ? 0 : ms));

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (v == null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : String(v));
      });
    }
    kids.flat(Infinity).forEach((c) => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return e;
  }
  const icon = (name, cls) => h('span', { class: 'material-symbols-rounded' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true', text: name });
  function sv(tag, attrs, parent) {
    const e = document.createElementNS(SVGNS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null) e.setAttribute(k, String(v)); });
    if (parent) parent.appendChild(e);
    return e;
  }
  function svText(parent, text, attrs) {
    const t = sv('text', Object.assign({ 'text-anchor': 'middle', 'dominant-baseline': 'central' }, attrs), parent);
    t.textContent = text;
    return t;
  }

  // ── 状態 ─────────────────────────────────────
  let S = null; // エンジンの状態
  let meta = { names: [], startedAt: 0 };
  let busy = false;
  let lastSeen = { id: null, animated: 0 }; // その番の移動をどこまで見せたか
  const shown = {}; // 盤面に見せている駒の位置
  let cheerSel = null;
  let showAllJobs = false;
  let miniPicks = {}; // ミニゲームで、メンターが入れた各プレイヤーの答え
  let piecesLayer = null;
  let hiLayer = null; // 2つの目の止まる先の目印
  let modalOpener = null;
  let gen = 0; // 表示の世代。ゲームを始める・再開する・終える・最初にもどるたびに増やし、古い present() を途中で止める
  let menuTimer = null;
  const setup = { count: 4, names: ['', '', '', '', '', ''] };

  const P = (id) => S.players[id];
  const curP = () => S.players[S.cur];
  const L = () => (S ? S.settings.labels : 'school');
  const colorOf = (p) => D.PLAYER_COLORS[p.color].color;
  const inkOf = (p) => D.PLAYER_COLORS[p.color].ink || '#FFFFFF';
  const aptOf = (a) => D.APTS[a];
  const jobOf = (j) => D.JOBS[j];
  const stageLabel = (stage) => D.STAGES[stage][L()];
  const laneLabel = (lane) => D.LANES[lane][L()];

  function dot(p, small) {
    return h('span', { class: 'cs-dot', style: `background:${colorOf(p)};color:${inkOf(p)}${small ? ';width:22px;height:22px;font-size:12px' : ''}`, 'aria-hidden': 'true', text: String(p.id + 1) });
  }
  function dotIdx(i) {
    return h('span', { class: 'cs-dot cs-name__dot', style: `background:${D.PLAYER_COLORS[i].color};color:${D.PLAYER_COLORS[i].ink || '#FFFFFF'}`, 'aria-hidden': 'true', text: String(i + 1) });
  }
  function aptChip(a, suffix) {
    const t = aptOf(a);
    return h('span', { class: 'cs-apt', style: `background:${t.tint};color:${t.color}` }, icon(t.icon), t.name + (suffix || ''));
  }
  function starsEl(n) {
    return h('span', { class: 'cs-stars', role: 'img', 'aria-label': `★${n}` }, '★'.repeat(n), h('span', { class: 'cs-stars__off', 'aria-hidden': 'true' }, '★'.repeat(Math.max(0, 4 - n))));
  }
  function where(p) {
    const n = NODE[p.node];
    if (n.type === 'start') return 'スタート（6さい）';
    if (n.type === 'goal') return 'ゴール（35さい）';
    if (n.type === 'stop') return `${n.age}さいの節目`;
    if (n.lane) return `${stageLabel(n.stage)}・${laneLabel(n.lane)}`;
    return stageLabel(n.stage);
  }
  function announce(text) { $('cs-live').textContent = text; }

  // ── 画面の切り替え ───────────────────────────────
  function show(name) {
    $('cs-setup').hidden = name !== 'setup';
    $('cs-play').hidden = name !== 'play';
    $('cs-results').hidden = name !== 'results';
    window.scrollTo(0, 0);
  }

  // ── はじめの画面 ─────────────────────────────────
  function renderSetup() {
    const seg = $('cs-count');
    seg.setAttribute('role', 'group');
    seg.replaceChildren();
    for (let n = 1; n <= D.MAX_PLAYERS; n++) {
      seg.appendChild(h('button', {
        class: 'cs-seg__btn', type: 'button', 'aria-pressed': String(setup.count === n), 'aria-label': `${n}人`,
        onclick: () => { setup.count = n; renderSetup(); },
      }, String(n)));
    }
    const box = $('cs-names');
    box.replaceChildren();
    for (let i = 0; i < setup.count; i++) {
      const c = D.PLAYER_COLORS[i];
      const input = h('input', { class: 'cs-name__input', type: 'text', maxlength: '10', placeholder: c.name, 'aria-label': `${i + 1}人目の名前（空なら「${c.name}」）`, autocomplete: 'off' });
      input.value = setup.names[i];
      input.addEventListener('input', () => { setup.names[i] = input.value; });
      box.appendChild(h('label', { class: 'cs-name' }, dotIdx(i), input));
    }
    $('cs-resume').hidden = !loadSaved();
  }

  function startGame(names, labels, dice) {
    meta = { names: names.slice(), startedAt: Date.now() };
    S = E.newGame({ names, labels, dice, seed: (Math.random() * 4294967296) >>> 0 });
    resetView();
    save();
    show('play');
    mountBoard();
    renderAll();
    announce(`${curP().name}さんの番`);
  }

  function resetView() {
    gen++;
    lastSeen = { id: S.last ? S.last.id : null, animated: S.last ? S.last.path.length : 0 };
    S.players.forEach((p) => { shown[p.id] = p.node; });
    cheerSel = null;
    showAllJobs = false;
    miniPicks = {};
    busy = false;
  }

  // ── 保存（このタブの中だけ） ───────────────────────────
  function save() {
    try { sessionStorage.setItem(STORE_KEY, JSON.stringify({ state: S, meta })); } catch (e) { /* 保存できなくても遊べる */ }
  }
  function loadSaved() {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || !d.state || d.state.v !== 2 || !Array.isArray(d.state.players) || d.state.phase !== 'play') return null;
      return d;
    } catch (e) { return null; }
  }
  function clearSaved() { try { sessionStorage.removeItem(STORE_KEY); } catch (e) { /* なにもしない */ } }

  // ── 盤面 ─────────────────────────────────────
  function mountBoard() {
    const svg = $('cs-svg');
    svg.replaceChildren();
    sv('rect', { x: 0, y: 0, width: 1000, height: 620, rx: 18, fill: '#FBF9F4' }, svg);
    D.ZONES.forEach((z) => {
      sv('rect', { x: z.x, y: z.y, width: z.w, height: z.h, rx: 16, fill: ZONE_TINT[z.stage] }, svg);
      const t = sv('text', { x: z.lx, y: z.ly, class: 'cs-b-zone', 'font-size': 18, fill: ZONE_INK[z.stage], 'text-anchor': z.anchor === 'end' ? 'end' : 'start' }, svg);
      t.textContent = stageLabel(z.stage);
    });
    const roads = sv('g', { 'aria-hidden': 'true' }, svg);
    D.NODES.forEach((n) => n.next.forEach((m) => {
      const b = NODE[m];
      sv('line', { x1: n.x, y1: n.y, x2: b.x, y2: b.y, stroke: '#E6DECD', 'stroke-width': 22, 'stroke-linecap': 'round' }, roads);
    }));
    D.NODES.forEach((n) => n.next.forEach((m) => {
      const b = NODE[m];
      sv('line', { x1: n.x, y1: n.y, x2: b.x, y2: b.y, stroke: '#FFFFFF', 'stroke-width': 3, 'stroke-dasharray': '2 12', 'stroke-linecap': 'round' }, roads);
    }));
    // 道の名前札
    D.LANE_TAGS.forEach((t) => {
      const text = laneLabel(t.lane);
      const w = text.length * 15 + 20;
      const g = sv('g', { 'aria-hidden': 'true' }, svg);
      const work = D.LANES[t.lane].kind === 'work';
      sv('rect', { x: t.x - w / 2, y: t.y - 12, width: w, height: 24, rx: 12, fill: work ? '#1C3F5E' : '#FFFFFF', stroke: '#1C3F5E', 'stroke-width': 1.5 }, g);
      svText(g, text, { x: t.x, y: t.y + 1, 'font-size': 14, 'font-weight': 700, fill: work ? '#FFFFFF' : '#1C3F5E', class: 'cs-b-label' });
    });
    // 近道・寄り道の札
    D.NODES.filter((n) => n.fork).forEach((n) => n.next.forEach((m, i) => {
      const b = NODE[m];
      const up = b.y <= n.y;
      svText(svg, n.fork[i], { x: b.x + (up ? 0 : -16), y: up ? b.y - 30 : b.y + 30, 'font-size': 13, 'font-weight': 700, fill: '#5A6270', class: 'cs-b-label', 'aria-hidden': 'true' });
    }));
    const tiles = sv('g', {}, svg);
    D.NODES.forEach((n) => drawNode(tiles, n));
    hiLayer = sv('g', { 'aria-hidden': 'true' }, svg);
    piecesLayer = sv('g', {}, svg);
    renderPieces();
  }

  function nodeTitle(n) {
    switch (n.type) {
      case 'exp': return `体験マス（${aptOf(n.apt).name}）`;
      case 'friend': return `なかまマス（${aptOf(n.apt).name}）`;
      case 'event': return 'イベントマス';
      case 'pay': return 'しごとマス';
      case 'grow': return '成長マス';
      case 'change': return '転職チャンス';
      case 'mini': return 'ミニゲームマス';
      case 'stop': return `${n.age}さいの節目`;
      case 'start': return 'スタート';
      case 'goal': return 'ゴール';
      default: return '';
    }
  }

  function drawSquare(g, type, x, y, apt) {
    const r = 19;
    const iconAt = (name, color, size) => svText(g, name, { x, y: y + 1, 'font-size': size || 20, fill: color, class: 'cs-b-icon', 'aria-hidden': 'true' });
    if (type === 'exp' || type === 'friend') {
      const t = aptOf(apt);
      sv('circle', { cx: x, cy: y, r, fill: t.tint, stroke: t.color, 'stroke-width': 3, 'stroke-dasharray': type === 'friend' ? '5 3' : null }, g);
      iconAt(type === 'friend' ? 'group' : t.icon, t.color);
    } else if (type === 'event') {
      sv('circle', { cx: x, cy: y, r, fill: '#1C3F5E' }, g);
      iconAt('style', '#FFFFFF', 19);
    } else if (type === 'pay') {
      sv('circle', { cx: x, cy: y, r, fill: '#FFFFFF', stroke: '#2E7D8C', 'stroke-width': 3 }, g);
      iconAt('star', '#C98A00', 22);
    } else if (type === 'grow') {
      sv('circle', { cx: x, cy: y, r, fill: '#E3F1F2', stroke: '#2E7D8C', 'stroke-width': 2 }, g);
      iconAt('trending_up', '#2E7D8C');
    } else if (type === 'change') {
      sv('circle', { cx: x, cy: y, r, fill: '#FFFFFF', stroke: '#5A6270', 'stroke-width': 2 }, g);
      iconAt('swap_horiz', '#1C3F5E');
    } else if (type === 'mini') {
      sv('circle', { cx: x, cy: y, r, fill: '#FFE9C7', stroke: '#D9822B', 'stroke-width': 3 }, g);
      iconAt('sports_esports', '#B35C00');
    }
  }

  function drawNode(parent, n) {
    const g = sv('g', { role: 'img', 'aria-label': nodeTitle(n) }, parent);
    sv('title', {}, g).textContent = nodeTitle(n);
    if (n.type === 'start') {
      sv('rect', { x: n.x - 38, y: n.y - 24, width: 76, height: 48, rx: 12, fill: '#E6EDF3', stroke: '#1C3F5E', 'stroke-width': 2 }, g);
      svText(g, 'スタート', { x: n.x, y: n.y - 7, 'font-size': 14, 'font-weight': 700, fill: '#1C3F5E', class: 'cs-b-label' });
      svText(g, '6さい', { x: n.x, y: n.y + 11, 'font-size': 12, fill: '#1C3F5E', class: 'cs-b-label' });
    } else if (n.type === 'stop') {
      sv('rect', { x: n.x - 40, y: n.y - 25, width: 80, height: 50, rx: 12, fill: '#1C3F5E' }, g);
      svText(g, `${n.age}さい`, { x: n.x, y: n.y - 6, 'font-size': 18, 'font-weight': 700, fill: '#FFFFFF', class: 'cs-b-label' });
      svText(g, '節目', { x: n.x, y: n.y + 13, 'font-size': 12, fill: '#CFE0EC', class: 'cs-b-label' });
    } else if (n.type === 'goal') {
      sv('circle', { cx: n.x, cy: n.y, r: 42, fill: '#1C3F5E' }, g);
      sv('circle', { cx: n.x, cy: n.y, r: 48, fill: 'none', stroke: '#1C3F5E', 'stroke-width': 2, 'stroke-dasharray': '4 5' }, g);
      svText(g, 'flag', { x: n.x, y: n.y - 14, 'font-size': 24, fill: '#FFD76A', class: 'cs-b-icon', 'aria-hidden': 'true' });
      svText(g, 'ゴール', { x: n.x, y: n.y + 8, 'font-size': 15, 'font-weight': 700, fill: '#FFFFFF', class: 'cs-b-label' });
      svText(g, '35さい', { x: n.x, y: n.y + 26, 'font-size': 12, fill: '#CFE0EC', class: 'cs-b-label' });
    } else {
      drawSquare(g, n.type, n.x, n.y, n.apt);
    }
  }

  function piecePos(pid, nodeId) {
    const n = NODE[nodeId];
    const set = SLOTS[n.type] || SLOTS.small;
    const [ox, oy] = set[pid % set.length];
    return { x: n.x + ox, y: n.y + oy };
  }

  function renderPieces() {
    if (!piecesLayer || !S) return;
    piecesLayer.replaceChildren();
    // 番の人を最後に描いて、いちばん上に出す
    const order = S.players.map((p) => p.id).sort((a, b) => (a === S.cur) - (b === S.cur));
    order.forEach((id) => {
      const p = P(id);
      const pos = piecePos(id, shown[id] || p.node);
      const now = S.phase === 'play' && id === S.cur;
      const g = sv('g', { class: 'cs-piece' + (now ? ' cs-piece--now' : ''), 'data-pid': id, 'aria-hidden': 'true' }, piecesLayer);
      g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      if (now) sv('circle', { class: 'cs-piece__ring', cx: 0, cy: 0, r: 16, stroke: colorOf(p) }, g);
      sv('circle', { cx: 0, cy: 0, r: now ? 12.5 : 11, fill: colorOf(p), stroke: '#FFFFFF', 'stroke-width': 2.5 }, g);
      svText(g, String(id + 1), { x: 0, y: 1, 'font-size': now ? 14 : 12, 'font-weight': 700, fill: inkOf(p), class: 'cs-b-label' });
    });
    const desc = S.players.map((p) => `${p.name}さん: ${where(p)}`).join('、');
    $('cs-svg').setAttribute('aria-label', `すごろくの盤面。${desc}`);
  }

  async function stepPiece(pid, nodeId) {
    shown[pid] = nodeId;
    const g = piecesLayer && piecesLayer.querySelector(`[data-pid="${pid}"]`);
    if (g) {
      const pos = piecePos(pid, nodeId);
      g.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    }
    await wait(STEP_MS);
  }

  // ── サイド（手番とプレイヤー） ──────────────────────────
  function renderTurn(rolling) {
    const box = $('cs-turn');
    box.replaceChildren();
    if (!S || S.phase !== 'play') return;
    const p = curP();
    box.appendChild(h('div', { class: 'cs-turn__who' }, dot(p), h('div', {},
      h('p', { class: 'cs-turn__name' }, `${p.name}さんの番`),
      h('p', { class: 'cs-turn__where' }, where(p)),
    )));
    const dice = h('div', { class: 'cs-turn__dice', 'aria-hidden': 'true' });
    if (S.settings.dice === 2) {
      const ds = rolling || !S.last || !S.last.dice ? null : S.last.dice; // 振っている途中は結果を見せない
      [0, 1].forEach((i) => {
        const chosen = ds && S.last.chosen === i;
        const other = ds && S.last.chosen != null && S.last.chosen !== i;
        dice.appendChild(h('div', { class: 'cs-die' + (ds || rolling ? '' : ' cs-die--idle') + (chosen ? ' cs-die--chosen' : '') + (other ? ' cs-die--off' : ''), id: 'cs-die' + i }, ds ? String(ds[i]) : (rolling ? '' : '?')));
      });
    } else {
      const roll = rolling ? null : (S.last && S.last.roll);
      dice.appendChild(h('div', { class: 'cs-die' + (roll || rolling ? '' : ' cs-die--idle'), id: 'cs-die0' }, roll ? String(roll) : (rolling ? '' : '?')));
    }
    if (S.last && (S.last.roll || S.last.dice) && S.last.cheer && !rolling) dice.appendChild(h('span', { class: 'cs-die__plus' }, `+${S.last.cheer} 応援`));
    box.appendChild(dice);
    if (S.step && S.step.kind === 'roll' && !busy) {
      box.appendChild(h('button', { class: 'cs-btn cs-btn--primary cs-btn--full cs-btn--lg', type: 'button', 'data-primary': '1', onclick: () => doRoll() }, icon('casino'), 'サイコロをふる'));
      const fans = S.players.filter((q) => q.done && q.id !== p.id);
      if (fans.length) {
        const row = h('div', { class: 'cs-cheer' },
          h('p', { class: 'cs-cheer__label' }, 'ゴールした人の応援で、サイコロ +1'),
          h('div', { class: 'cs-cheer__btns' }, fans.map((f) => h('button', {
            class: 'cs-cheer__btn', type: 'button', 'aria-pressed': String(cheerSel === f.id),
            onclick: () => { cheerSel = cheerSel === f.id ? null : f.id; renderTurn(); },
          }, dot(f, true), `${f.name}さんが応援`))),
        );
        box.appendChild(row);
      }
    } else if (!busy && S.step && S.step.kind !== 'roll') {
      box.appendChild(h('p', { class: 'cs-turn__wait' }, '盤面のカードを見てね'));
    }
  }

  function renderPlayers() {
    const ul = $('cs-players');
    ul.replaceChildren();
    S.players.forEach((p) => {
      const tags = [];
      if (p.done) tags.push(h('span', { class: 'cs-player__tag cs-player__tag--goal' }, icon('flag'), `${p.rank}番にゴール`));
      else if (p.skip > 0) tags.push(h('span', { class: 'cs-player__tag cs-player__tag--rest' }, icon('bedtime'), '休み'));
      const now = S.phase === 'play' && p.id === S.cur;
      ul.appendChild(h('li', {}, h('button', {
        class: 'cs-player' + (now ? ' cs-player--now' : ''), type: 'button',
        'aria-label': `${p.name}さんの手帳を開く（${where(p)}${p.done ? '・ゴール' : ''}${p.skip > 0 && !p.done ? '・休み' : ''}）`,
        onclick: (ev) => openNotebook(p.id, ev.currentTarget),
      }, dot(p), h('span', { class: 'cs-player__name' }, p.name), tags, icon('chevron_right', 'cs-player__more'))));
    });
  }

  function renderAll() {
    renderTurn();
    renderPlayers();
    renderPieces();
    renderCard();
  }

  // ── カード ───────────────────────────────────
  function hideCard() {
    $('cs-card-layer').hidden = true;
    $('cs-card').replaceChildren();
    renderHighlights(null);
  }
  // opts.wide: 横に広いカード / opts.place: 'top'・'bottom'（盤面を見ながら選ぶカードは、駒と反対側に寄せる）
  function openCard(parts, opts) {
    const card = $('cs-card');
    card.className = 'cs-card' + (opts && opts.wide ? ' cs-card--wide' : '') + (opts && opts.place ? ' cs-card--compact' : '');
    $('cs-card-layer').className = 'cs-card-layer' + (opts && opts.place ? ' cs-card-layer--' + opts.place : '');
    card.replaceChildren(...parts.flat(Infinity).filter(Boolean));
    $('cs-card-layer').hidden = false;
    card.scrollTop = 0;
    const first = card.querySelector('[data-num="1"], [data-primary]');
    if (first) first.focus({ preventScroll: true });
  }
  function head(kicker, kIcon, title, text, sub) {
    return [
      h('p', { class: 'cs-card__kicker' }, icon(kIcon), kicker),
      h('h2', { class: 'cs-card__title', id: 'cs-card-title' }, title),
      text ? h('p', { class: 'cs-card__text' }, text) : null,
      sub ? h('p', { class: 'cs-card__sub' }, sub) : null,
    ];
  }
  // aria: 読み上げに足す文（見た目では side や extra に出している★・今の数・手がかりなど）
  function choice(i, name, desc, side, onclick, extra, aria) {
    return h('button', {
      class: 'cs-choice', type: 'button', 'data-num': i < 9 ? String(i + 1) : null,
      'aria-label': `${i + 1}番: ${name}${desc ? '。' + desc : ''}${aria ? '。' + aria : ''}`, onclick,
    }, h('span', { class: 'cs-choice__num', 'aria-hidden': 'true' }, NUM[i] || String(i + 1)),
    h('span', { class: 'cs-choice__body' }, h('span', { class: 'cs-choice__name' }, name), desc ? h('span', { class: 'cs-choice__desc' }, desc) : null, extra || null),
    side ? h('span', { class: 'cs-choice__side' }, side) : null);
  }
  function primary(label, onclick, ic) {
    return h('div', { class: 'cs-card__actions' }, h('button', { class: 'cs-btn cs-btn--primary cs-btn--lg', type: 'button', 'data-primary': '1', onclick }, ic ? icon(ic) : null, label));
  }

  function renderCard() {
    if (!S || S.phase !== 'play' || busy) { hideCard(); return; }
    const st = S.step;
    const p = curP();
    const card = S.last && S.last.card ? D.DECKS[S.last.card.deck][S.last.card.i] : null;
    switch (st.kind) {
      case 'roll': hideCard(); return;
      case 'skip':
        openCard([...head('1回休み', 'bedtime', `${p.name}さんは、この番お休み`, 'つぎの番から、また進めるよ'), primary(nextLabel(), () => dispatch({ type: 'ack' }), 'arrow_forward')]);
        return;
      case 'fork': {
        const n = NODE[st.node];
        const lens = n.next.map((m) => branchLength(m));
        openCard([...head('分かれ道', 'alt_route', 'どっちに進む？', `あと${st.remaining}マス進むよ`),
          h('div', { class: 'cs-choices' }, n.fork.map((label, i) => choice(i, label, `${lens[i]}マス${n.forkNote && n.forkNote[i] ? '。' + n.forkNote[i] : ''}`, null, () => dispatch({ type: 'fork', choice: i })))),
        ]);
        return;
      }
      case 'route': {
        const n = NODE[st.node];
        const range = st.node === 'stop15' ? '16〜18さい' : '19〜22さい';
        openCard([...head(`${n.age}さいの節目`, 'signpost', 'どっちの道に進む？', 'みんなに相談してもいいよ。決めるのは本人'),
          lastLines(),
          h('div', { class: 'cs-choices' }, D.ROUTES[st.node].map((o, i) => choice(i, `${laneLabel(o.lane)}（${range}）`, o.desc, null, () => dispatch({ type: 'route', choice: i })))),
        ]);
        return;
      }
      case 'job': renderJobCard(st, p); return;
      case 'friend': {
        const others = S.players.filter((q) => q.id !== p.id);
        openCard([...head('なかまマス', 'group', 'だれをさそう？', null),
          h('p', { class: 'cs-card__text' }, '2人とも ', aptChip(st.apt, ' +1'), '。休んでいる人をさそうと、休みがなくなる'),
          h('div', { class: 'cs-choices' }, others.map((q, i) => choice(i, `${q.name}さん`, q.skip > 0 && !q.done ? 'いま休み中' : (q.done ? 'ゴールしている' : ''), dot(q), () => dispatch({ type: 'friend', pid: q.id })))),
        ]);
        return;
      }
      case 'pick': {
        let top;
        const guide = '各適性の下に「★が上がる職業」を出しているよ。職業ごとの合う適性は「しごと図鑑」で見られる';
        if (st.reason === 'study') top = head('学びの道のボーナス', 'school', st.of > 1 ? `好きな適性を選ぼう（${st.i + 1}つめ／${st.of}つ）` : '好きな適性を1つ選ぼう', guide);
        else if (card) top = head('イベント', 'style', card.text, 'どれか1つ +1', guide);
        else top = head('成長', 'trending_up', 'どれか1つ +1', guide);
        openCard([...top, lastLines(),
          h('div', { class: 'cs-choices' }, st.opts.map((a, i) => choice(i, aptOf(a).name, aptOf(a).desc, meter(p.apt[a]), () => dispatch({ type: 'pick', a }), aptJobHint(p, a), aptJobHintText(p, a)))),
          h('div', { class: 'cs-card__actions' }, h('button', { class: 'cs-quiet', type: 'button', onclick: (ev) => openJobBook(p.id, ev.currentTarget) }, icon('menu_book'), 'しごと図鑑を見る（職業ごとの合う適性）')),
        ]);
        return;
      }
      case 'vote':
        openCard([...head('みんなで決めよう', 'how_to_vote', card ? card.text : 'みんなで決めよう', 'みんなで話して、多かったものを押してね。全員の適性が1つ増える'),
          h('div', { class: 'cs-choices' }, st.opts.map((o, i) => choice(i, o.label, null, aptChip(o.a, ' +1'), () => dispatch({ type: 'vote', opt: i }), null, `全員 ${aptOf(o.a).name} +1`))),
        ]);
        return;
      case 'coop':
        openCard([...head('みんなでサイコロ', 'casino', card ? card.text : 'みんなでサイコロ', `全員のサイコロの合計が ${st.target} 以上なら、全員 ${rewardText(st.reward)}`, 'ゴールした人も一緒にふるよ'),
          primary('みんなでふる', () => dispatch({ type: 'coop' }), 'casino'),
        ]);
        return;
      case 'dice': renderDiceCard(st, p); return;
      case 'mini': renderMiniCard(st); return;
      case 'ack': renderAckCard(p, card); return;
      default: hideCard();
    }
  }

  function branchLength(startId) {
    let n = 0;
    let id = startId;
    const joinCounts = {};
    D.NODES.forEach((x) => x.next.forEach((m) => { joinCounts[m] = (joinCounts[m] || 0) + 1; }));
    while (id && (joinCounts[id] || 0) < 2) { n++; id = NODE[id].next[0]; }
    return n;
  }
  function meter(v) {
    return h('span', { class: 'cs-meter', role: 'img', 'aria-label': `いま ${v}` }, Array.from({ length: D.APT_CAP }, (_, i) => h('i', { style: i < v ? 'background:#2E7D8C' : null })));
  }
  const rewardText = (r) => (r.t === 'apt' ? `${aptOf(r.a).name} +1` : `+${r.n}ポイント`);

  // 適性 a を1つ増やすと★が上がる職業（上がったあとの★が多い順）
  function jobsUpFor(apt, a) {
    const next = apt.slice();
    next[a] = Math.min(D.APT_CAP, next[a] + 1);
    return D.JOBS.map((j) => ({ id: j.id, from: E.stars(apt, j.id), to: E.stars(next, j.id), sum: E.jobSum(next, j.id) }))
      .filter((x) => x.to > x.from)
      .sort((x, y) => y.to - x.to || y.sum - x.sum || x.id - y.id);
  }
  // 適性 a が合う職業（いまの合計が多い順）
  function jobsWith(apt, a) {
    return D.JOBS.filter((j) => j.apts.includes(a)).map((j) => ({ id: j.id, sum: E.jobSum(apt, j.id) }))
      .sort((x, y) => y.sum - x.sum || x.id - y.id);
  }
  const jobNames = (list, n) => list.slice(0, n).map((x) => jobOf(x.id).name).join('・') + (list.length > n ? ` ほか${list.length - n}` : '');

  // 適性を選ぶカードの各選択肢の下に出す手がかり（表示と読み上げで同じ文を使う）
  function aptJobHintParts(p, a) {
    const parts = {};
    if (p.job != null && jobOf(p.job).apts.includes(a)) {
      const from = E.stars(p.apt, p.job);
      const next = p.apt.slice();
      next[a] = Math.min(D.APT_CAP, next[a] + 1);
      const to = E.stars(next, p.job);
      parts.job = `今の職業（${jobOf(p.job).name}）に合う${to > from ? `・★${from}→★${to}` : ''}`;
    }
    const up = jobsUpFor(p.apt, a).filter((x) => x.id !== p.job);
    if (up.length) parts.jobs = { icon: 'trending_up', text: `★が上がる職業: ${jobNames(up, 3)}` };
    else parts.jobs = { icon: 'work_outline', text: `合う職業: ${jobNames(jobsWith(p.apt, a).filter((x) => x.id !== p.job), 3)}` };
    return parts;
  }
  function aptJobHint(p, a) {
    const parts = aptJobHintParts(p, a);
    const wrap = h('span', { class: 'cs-choice__hint' });
    if (parts.job) wrap.appendChild(h('span', { class: 'cs-tag cs-tag--job' }, icon('work'), parts.job));
    wrap.appendChild(h('span', { class: 'cs-choice__jobs' }, icon(parts.jobs.icon), parts.jobs.text));
    return wrap;
  }
  function aptJobHintText(p, a) {
    const parts = aptJobHintParts(p, a);
    return [`いまの数 ${p.apt[a]}`, parts.job, parts.jobs.text].filter(Boolean).join('。');
  }

  // 2つの目それぞれの止まる先を言葉にする
  function previewText(pv, p) {
    const n = NODE[pv.node];
    const payNow = p.job != null ? D.STAR_PAY[E.stars(p.apt, p.job) - 1] : 0;
    let t;
    if (pv.kind === 'goal') t = 'ゴール！';
    else if (pv.kind === 'stop') t = `${n.age}さいの節目で止まる`;
    else if (pv.kind === 'fork') t = `分かれ道まで進んで、方向を選ぶ（あと${pv.left}マス）`;
    else {
      switch (n.type) {
        case 'exp': t = `${aptOf(n.apt).name}の体験マス`; break;
        case 'friend': t = `なかまマス（${aptOf(n.apt).name}）`; break;
        case 'event': t = 'イベントマス'; break;
        case 'pay': t = pv.exactPay ? `しごとマスにぴったり（2倍で +${payNow * 2}）` : 'しごとマス（もう通ったマス）'; break;
        case 'grow': t = '成長マス'; break;
        case 'change': t = '転職チャンス'; break;
        case 'mini': t = 'ミニゲームマス'; break;
        default: t = nodeTitle(n);
      }
    }
    if (pv.pass) t += `・途中でしごとマスを${pv.pass}つ通る（+${pv.pass * payNow}）`;
    return t;
  }

  function renderDiceCard(st, p) {
    const c = S.last.cheer || 0;
    const pvs = st.dice.map((d) => E.previewMove(S, d + c));
    // 止まる先の①②が隠れないよう、駒が下半分にいればカードを上に、上半分にいれば下に寄せる
    const place = NODE[p.node].y > 300 ? 'top' : 'bottom';
    openCard([...head('サイコロ', 'casino', 'どっちの目で進む？', '急いで進むか、ほしいマスをねらうか（止まる先は盤面の①②）', D.EXACT_PAY_BONUS ? 'しごとマスにぴったり止まると、そのポイントが2倍' : null),
      h('div', { class: 'cs-choices cs-choices--row' }, st.dice.map((d, i) => choice(i, c ? `${d}（応援で +1 して ${d + c}マス）` : `${d}マス進む`, previewText(pvs[i], p), h('span', { class: 'cs-die cs-die--mini' }, String(d)), () => dispatch({ type: 'dice', pick: i })))),
    ], { place });
    renderHighlights(pvs);
  }

  // 盤面に①②の目印を出す（同じマスなら並べる）
  function renderHighlights(pvs) {
    if (!hiLayer) return;
    hiLayer.replaceChildren();
    if (!pvs) return;
    const seen = {};
    pvs.forEach((pv, i) => {
      const n = NODE[pv.node];
      const k = seen[pv.node] = (seen[pv.node] || 0) + 1;
      const big = n.type === 'stop' || n.type === 'start' || n.type === 'goal';
      if (k === 1) sv('circle', { cx: n.x, cy: n.y, r: big ? 50 : 27, fill: 'none', stroke: '#2E7D8C', 'stroke-width': 3, 'stroke-dasharray': '6 4' }, hiLayer);
      const bx = n.x + (k === 1 ? 0 : 26);
      const by = n.y - (big ? 52 : 34);
      sv('circle', { cx: bx, cy: by, r: 13, fill: '#2E7D8C', stroke: '#FFFFFF', 'stroke-width': 2 }, hiLayer);
      svText(hiLayer, NUM[i], { x: bx, y: by + 1, 'font-size': 15, 'font-weight': 700, fill: '#FFFFFF', class: 'cs-b-label' });
    });
  }

  const MINI_OPTS = {
    hilo: [{ v: 'hi', label: '大きい', icon: 'arrow_upward' }, { v: 'lo', label: '小さい', icon: 'arrow_downward' }],
    janken: [{ v: 'g', label: 'グー' }, { v: 'c', label: 'チョキ' }, { v: 'p', label: 'パー' }],
    sum: [{ v: 1, label: '1' }, { v: 2, label: '2' }, { v: 3, label: '3' }],
  };
  const MINI_BTN = { hilo: ['サイコロをふる', 'casino'], janken: ['コンピューターの手を見る', 'smart_toy'], sum: ['合計を見る', 'functions'] };
  const pickLabel = (game, v) => (MINI_OPTS[game].find((o) => o.v === v) || { label: '' }).label;

  // 全員の行を並べ、メンターがそれぞれの答えを押す。押しても描き直さない（押した場所から焦点が動かないように）
  function renderMiniCard(st) {
    const G = D.MINI_GAMES[st.game];
    let lead = null;
    if (st.game === 'hilo') lead = h('div', { class: 'cs-mini__big' }, h('span', { class: 'cs-mini__num' }, String(st.base)), h('span', {}, 'より大きい？ 小さい？'));
    if (st.game === 'sum') lead = h('div', { class: 'cs-mini__big' }, h('span', {}, '目標'), h('span', { class: 'cs-mini__num' }, String(st.target)));
    const [btnLabel, btnIcon] = MINI_BTN[st.game];
    const btn = h('button', { class: 'cs-btn cs-btn--primary cs-btn--lg', type: 'button', 'data-primary': '1', onclick: () => dispatch({ type: 'mini', picks: Object.assign({}, miniPicks) }) }, icon(btnIcon), btnLabel);
    const hint = h('p', { class: 'cs-card__hint', 'aria-live': 'polite' });
    const refresh = () => {
      const all = S.players.every((q) => miniPicks[q.id] != null);
      btn.disabled = st.game === 'sum' && !all;
      hint.textContent = all ? '' : (st.game === 'sum' ? '全員の数を入れてね' : '入れなかった人は、今回は参加なし');
    };
    const rows = h('div', { class: 'cs-mini__rows' }, S.players.map((q) => {
      const group = h('div', { class: 'cs-mini__opts', role: 'group', 'aria-label': `${q.name}さんの答え` });
      MINI_OPTS[st.game].forEach((o) => {
        const b = h('button', { type: 'button', class: 'cs-mini__opt', 'aria-pressed': String(miniPicks[q.id] === o.v), 'aria-label': `${q.name}さん: ${o.label}` }, o.icon ? icon(o.icon) : null, o.label);
        b.addEventListener('click', () => {
          miniPicks[q.id] = miniPicks[q.id] === o.v ? undefined : o.v;
          group.querySelectorAll('.cs-mini__opt').forEach((x, i) => x.setAttribute('aria-pressed', String(miniPicks[q.id] === MINI_OPTS[st.game][i].v)));
          refresh();
        });
        group.appendChild(b);
      });
      return h('div', { class: 'cs-mini__row' }, dot(q, true), h('span', { class: 'cs-mini__name' }, q.name), group);
    }));
    // 人数が多くてもボタンが隠れないよう、ボタンはカードの下に固定する
    openCard([...head(`ミニゲーム・${P(st.by).name}さんが止まった`, 'sports_esports', G.name, G.rule, G.note), lead, rows,
      h('div', { class: 'cs-card__actions cs-card__foot' }, btn, hint)], { wide: S.players.length > 2 });
    refresh();
  }

  function renderJobCard(st, p) {
    const keeping = st.keep && p.job != null;
    // 続けられる今の仕事は「続ける」だけに出して、番号つきの一覧からは外す
    const opts = E.jobOptions(p.apt).filter((o) => !(keeping && o.id === p.job));
    const kick = st.reason === 'change' ? '転職チャンス' : 'しごと選び';
    const title = st.reason === 'change' ? '職業を変える？（今のままでもいい）' : 'どの職業にする？';
    const list = showAllJobs ? opts : opts.slice(0, D.JOB_LIST_FIRST);
    const parts = [...head(kick, 'work', title, '★は、その職業に合う3つの適性の合計で決まる。★が多いほど、しごとマスでもらえるポイントが多い'),
      lastLines(),
      h('div', { class: 'cs-apts', 'aria-label': 'いまの適性' }, D.APTS.map((a) => aptChip(a.id, ` ${p.apt[a.id]}`))),
    ];
    if (p.prevJob != null && p.job == null) parts.push(h('p', { class: 'cs-card__sub' }, `前の仕事: ${jobOf(p.prevJob).name}（また選んでもいい）`));
    const choices = h('div', { class: 'cs-choices' });
    if (keeping) {
      choices.appendChild(h('button', { class: 'cs-choice cs-choice--keep', type: 'button', 'data-primary': '1', 'aria-label': `今の仕事を続ける: ${jobOf(p.job).name}。★${E.stars(p.apt, p.job)}`, onclick: () => dispatch({ type: 'job', job: 'keep' }) },
        h('span', { class: 'cs-choice__num', 'aria-hidden': 'true' }, icon('check')),
        h('span', { class: 'cs-choice__body' }, h('span', { class: 'cs-choice__name' }, `今の仕事を続ける: ${jobOf(p.job).name}`)),
        h('span', { class: 'cs-choice__side' }, starsEl(E.stars(p.apt, p.job)))));
    }
    list.forEach((o, i) => {
      const j = jobOf(o.id);
      const chips = h('span', { class: 'cs-apts' }, j.apts.map((a) => aptChip(a, ` ${p.apt[a]}`)));
      choices.appendChild(choice(i, j.name, j.desc, h('span', {}, starsEl(o.stars)), () => dispatch({ type: 'job', job: o.id }), chips,
        `★${o.stars}。合う適性 ${j.apts.map((a) => `${aptOf(a).name} ${p.apt[a]}`).join('、')}`));
    });
    parts.push(choices);
    parts.push(h('div', { class: 'cs-card__actions' }, h('button', { class: 'cs-quiet', type: 'button', onclick: () => { showAllJobs = !showAllJobs; renderCard(); } }, showAllJobs ? '少なく表示する' : `ほかの職業も見る（全${opts.length}）`)));
    openCard(parts);
  }

  // その番に起きたことの行（カードの本文）
  function lastLines() {
    const ms = (S.last ? S.last.msgs : []).filter((m) => m.k !== 'stop');
    if (!ms.length) return null;
    return h('ul', { class: 'cs-card__lines' }, ms.map(msgLine));
  }
  function msgLine(m) {
    const line = (ic, cls, ...content) => h('li', { class: 'cs-line' + (cls ? ' cs-line--' + cls : '') }, icon(ic), h('span', {}, ...content));
    switch (m.k) {
      case 'pay': return line('star', 'good', `しごとマス（${jobOf(m.job).name}）→ +${m.n}ポイント`);
      case 'payExact': return line('stars', 'good', `しごとマスにぴったり！ もう1回 +${m.n}ポイント`);
      case 'apt': {
        const pre = m.reason === 'study' ? '学びの道のボーナス: ' : (m.text ? m.text + ' ' : '');
        return line('add_circle', 'good', pre, aptChip(m.a, m.n > 0 ? ` +${m.n}` : '（もう上限）'));
      }
      case 'pts': return line('add_circle', 'good', m.reason === 'study' ? `学びの道のボーナス: +${m.n}ポイント` : `${m.text ? m.text + ' ' : ''}+${m.n}ポイント`);
      case 'move':
        if (m.n > 0) return line('fast_forward', 'good', `${m.n}マス進んだ`);
        if (m.n < 0) return line('fast_rewind', 'oops', `${-m.n}マスもどった${m.blocked ? '（節目より前にはもどらない）' : ''}`);
        return line('fast_rewind', null, '節目にいるので、もどらなかった');
      case 'skip': return line('bedtime', 'oops', 'つぎの番は1回休み（なかまマスでさそってもらうと休みがなくなる）');
      case 'again': return line('replay', 'good', 'もう1回サイコロをふれる');
      case 'friend': {
        const f = P(m.pid);
        const me = curP();
        let out;
        if (m.n && m.n2) out = [line('group', 'good', `${f.name}さんと一緒に: 2人とも `, aptChip(m.a, ' +1'))];
        else if (m.n || m.n2) out = [line('group', 'good', `${f.name}さんと一緒に: ${(m.n ? me : f).name}さん `, aptChip(m.a, ' +1'), `（${(m.n ? f : me).name}さんはもう上限）`)];
        else out = [line('group', null, `${f.name}さんと一緒に体験（`, aptChip(m.a), 'は2人とももう上限）')];
        if (m.rescued) out.push(line('celebration', 'good', `${f.name}さんの休みがなくなった`));
        return out;
      }
      case 'route': {
        const lane = D.LANES[m.lane];
        return line('signpost', null, lane.kind === 'work' ? 'しごとの道に進む' : `${laneLabel(m.lane)}に進む`);
      }
      case 'setaside': return line('work_off', null, `${jobOf(m.job).name}の仕事はいったんお休み（22さいで、もう一度選ぶ）`);
      case 'job': {
        const j = jobOf(m.job);
        const text = m.keep ? `${j.name}を続ける` : (m.changed ? `${j.name}に転職` : `${j.name}になった`);
        return line(j.icon, 'good', text + ' ', starsEl(m.stars));
      }
      case 'goal': return line('flag', 'good', `${m.rank}番目にゴール → +${m.n}ポイント`);
      case 'vote': return line('how_to_vote', 'good', `みんなで「${m.label}」に決定: 全員 `, aptChip(m.a, ' +1'), m.capped && m.capped.length ? `（もう上限の ${m.capped.map((pid) => P(pid).name + 'さん').join('・')} はそのまま）` : '');
      case 'coop': return [
        line('casino', null, `サイコロ ${m.dice.join('・')} → 合計 ${m.total}（目標 ${m.target}）`),
        m.ok ? line('celebration', 'good', `成功！ 全員 ${rewardText(m.reward)}${m.capped && m.capped.length ? `（もう上限の ${m.capped.map((pid) => P(pid).name + 'さん').join('・')} はそのまま）` : ''}`) : line('sentiment_satisfied', null, 'あと少し。またチャレンジしよう'),
      ];
      case 'mini': {
        const names = (ids) => ids.map((pid) => P(pid).name + 'さん').join('・');
        const out = [];
        if (m.game === 'hilo') {
          const rel = m.roll > m.base ? '大きい' : (m.roll < m.base ? '小さい' : '同じ');
          out.push(line('casino', null, `サイコロは ${m.roll}（${m.base}より${rel}）`));
          if (m.tie) out.push(line('celebration', 'good', `同じ数！ 全員 +${m.n}ポイント`));
          else out.push(m.winners.length ? line('celebration', 'good', `当たり: ${names(m.winners)}（+${m.n}ポイント）`) : line('sentiment_satisfied', null, '当たった人はいなかった。つぎに期待'));
        } else if (m.game === 'janken') {
          out.push(line('smart_toy', null, `コンピューターは ${pickLabel('janken', m.cpu)}`));
          out.push(m.winners.length ? line('celebration', 'good', `勝ち: ${names(m.winners)}（+${m.n}ポイント）`) : line('sentiment_satisfied', null, '勝った人はいなかった。つぎに期待'));
          if (m.draws.length) out.push(line('handshake', null, `あいこ: ${names(m.draws)}`));
        } else {
          out.push(line('functions', null, `合計 ${m.total}（目標 ${m.target}）`));
          out.push(m.ok ? line('celebration', 'good', `ピッタリ！ 全員 +${m.n}ポイント`) : line('sentiment_satisfied', null, `おしい！ 目標との差は ${Math.abs(m.target - m.total)}`));
        }
        if (m.picks.length) out.push(line('groups', null, 'みんなの答え: ' + m.picks.map((x) => `${P(x.pid).name} ${pickLabel(m.game, x.v)}`).join('・')));
        return out;
      }
      case 'text': return line('info', null, m.text);
      default: return null;
    }
  }

  function renderAckCard(p, card) {
    const n = NODE[p.node];
    const goal = S.last.msgs.find((m) => m.k === 'goal');
    const stop = S.last.msgs.find((m) => m.k === 'stop');
    const expMsg = !card && n.type === 'exp' ? S.last.msgs.find((m) => m.k === 'apt' && m.text) : null;
    const mini = S.last.msgs.find((m) => m.k === 'mini');
    let top;
    if (goal) top = head('ゴール', 'flag', `${p.name}さん、ゴール！`, `${goal.rank}番目のゴール`);
    else if (mini) top = head('ミニゲーム', 'sports_esports', `${D.MINI_GAMES[mini.game].name}の結果`);
    else if (card) top = head('イベント', 'style', card.text);
    else if (stop) top = head('節目', 'signpost', `${stop.age}さいの節目`);
    else if (expMsg) top = head('体験マス', 'explore', expMsg.text);
    else if (n.type === 'friend') top = head('なかまマス', 'group', '一緒に体験');
    else if (n.type === 'pay') top = head('しごとマス', 'star', 'しごとをがんばった');
    else if (n.type === 'grow') top = head('成長マス', 'trending_up', '仕事で成長');
    else if (n.type === 'change') top = head('転職チャンス', 'swap_horiz', '職業を見直した');
    else top = head('すごろく', 'casino', `${p.name}さんの番`);
    // 体験マスの文は見出しに出したので、行には適性のしるしだけを出す
    const lines = S.last.msgs.filter((m) => m.k !== 'stop').map((m) => (m === expMsg ? Object.assign({}, m, { text: '' }) : m));
    const body = lines.length ? h('ul', { class: 'cs-card__lines' }, lines.map(msgLine)) : null;
    openCard([top, body, primary(nextLabel(), () => dispatch({ type: 'ack' }), S.again && !p.done ? 'replay' : 'arrow_forward')]);
  }

  function nextLabel() {
    const p = curP();
    if (S.step.kind !== 'skip' && S.again && !p.done) return 'もう1回サイコロをふる';
    const left = S.players.filter((q) => !q.done);
    if (!left.length) return '結果を見る';
    for (let k = 1; k <= S.players.length; k++) {
      const q = S.players[(S.cur + k) % S.players.length];
      if (!q.done) return `つぎへ（${q.name}さんの番）`;
    }
    return 'つぎへ';
  }

  // イベントで動く前に、イベントのカードを見せる
  function eventReveal() {
    return new Promise((resolve) => {
      const c = D.DECKS[S.last.card.deck][S.last.card.i];
      const m = S.last.msgs.find((x) => x.k === 'move');
      const n = c.e.n;
      const text = n > 0 ? `${n}マス進む` : `${-n}マスもどる`;
      openCard([...head('イベント', 'style', c.text),
        h('ul', { class: 'cs-card__lines' }, h('li', { class: 'cs-line cs-line--' + (n > 0 ? 'good' : 'oops') }, icon(n > 0 ? 'fast_forward' : 'fast_rewind'), h('span', {}, text + (m && m.blocked ? '（節目より前にはもどらない）' : '')))),
        primary('OK', () => { hideCard(); resolve(); }, 'check'),
      ]);
    });
  }

  // ── 操作 ───────────────────────────────────
  async function doRoll() {
    if (busy) return;
    const cheer = cheerSel;
    cheerSel = null;
    await dispatch(cheer != null ? { type: 'roll', cheer } : { type: 'roll' });
  }

  async function dispatch(action) {
    if (busy) return;
    showAllJobs = false; // 職業の一覧は、カードが変わるたびに短い表示にもどす
    miniPicks = {};
    const r = E.apply(S, action);
    if (!r.ok) { announce(r.error); return; }
    const prev = S;
    S = r.state;
    save();
    await present(prev, action);
  }

  async function animateDice() {
    const dice = [$('cs-die0'), $('cs-die1')].filter(Boolean);
    if (!dice.length || reduceMotion()) return;
    dice.forEach((d) => d.classList.remove('cs-die--idle'));
    for (let i = 0; i < 6; i++) {
      dice.forEach((d) => { d.textContent = String(1 + Math.floor(Math.random() * 6)); });
      await wait(60);
    }
  }

  async function present(prev, action) {
    const my = gen;
    const stale = () => my !== gen || !S; // 途中で最初にもどった・終えた・別のゲームを始めた
    busy = true;
    hideCard();
    const last = S.last;
    if (last && last.id !== lastSeen.id) lastSeen = { id: last.id, animated: 0 };
    const path = last ? last.path : [];
    const fresh = path.slice(lastSeen.animated);
    const mover = S.cur;
    if (action.type === 'roll') {
      renderTurn(true);
      renderPlayers();
      await animateDice();
      if (stale()) return;
      renderTurn();
      announce(last.dice ? `${P(mover).name}さん、サイコロ ${last.dice[0]} と ${last.dice[1]}` : `${P(mover).name}さん、サイコロ ${last.roll}${last.cheer ? '（応援で +1）' : ''}`);
    } else {
      renderTurn();
    }
    if (fresh.length) {
      renderPieces();
      for (let i = 0; i < fresh.length; i++) {
        const idx = lastSeen.animated + i;
        if (last.moveFrom != null && idx === last.moveFrom && last.card) await eventReveal();
        if (stale()) return;
        await stepPiece(mover, fresh[i]);
        if (stale()) return;
      }
      lastSeen.animated = path.length;
      await wait(120);
      if (stale()) return;
    }
    S.players.forEach((p) => { shown[p.id] = p.node; });
    busy = false;
    if (S.phase === 'results') { clearSaved(); showResults(); return; }
    renderAll();
    if (action.type === 'ack' && S.step.kind === 'roll') announce(`${curP().name}さんの番`);
    else if (S.step.kind !== 'roll') {
      const t = $('cs-card-title');
      if (t) announce(t.textContent);
    }
  }

  // ── 重ねて開く画面 ───────────────────────────────
  function openModal(title, body, opener) {
    modalOpener = opener || document.activeElement;
    $('cs-modal-title').textContent = title;
    $('cs-modal-body').replaceChildren(body);
    $('cs-modal').hidden = false;
    ['cs-setup', 'cs-play', 'cs-results'].forEach((id) => { $(id).inert = true; });
    $('cs-modal-close').focus();
  }
  function closeModal() {
    if ($('cs-modal').hidden) return;
    $('cs-modal').hidden = true;
    ['cs-setup', 'cs-play', 'cs-results'].forEach((id) => { $(id).inert = false; });
    if (menuTimer) { clearInterval(menuTimer); menuTimer = null; }
    if (modalOpener && document.contains(modalOpener)) modalOpener.focus();
    modalOpener = null;
  }

  function openNotebook(pid, opener) {
    const p = P(pid);
    const body = h('div', {});
    body.appendChild(h('p', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:12px' }, dot(p), h('b', { style: 'font-size:18px' }, `${p.name}さん`), h('span', { style: 'color:#5A6270;font-size:14px' }, where(p) + (p.skip > 0 && !p.done ? '・つぎの番は休み' : ''))));
    body.appendChild(h('h3', {}, '職業'));
    if (p.job != null) {
      const j = jobOf(p.job);
      const sum = E.jobSum(p.apt, p.job);
      body.appendChild(h('div', { class: 'cs-note-job' }, icon(j.icon), h('div', {},
        h('p', {}, h('b', {}, j.name), ' ', starsEl(E.stars(p.apt, p.job))),
        h('p', { style: 'font-size:14px;color:#5A6270' }, `合う適性: ${j.apts.map((a) => aptOf(a).name).join('・')}（合計 ${sum}）`),
      )));
    } else {
      body.appendChild(h('p', { style: 'color:#5A6270' }, p.prevJob != null ? `いまは学びの道（前の仕事: ${jobOf(p.prevJob).name}）` : 'まだ決めていない。体験で適性をためて、あとで選ぶ'));
    }
    body.appendChild(h('button', { class: 'cs-quiet', type: 'button', onclick: () => { const o = modalOpener; closeModal(); openJobBook(p.id, o); } }, icon('menu_book'), 'しごと図鑑（職業ごとの合う適性と★）'));
    body.appendChild(h('h3', {}, '適性'));
    D.APTS.forEach((a) => body.appendChild(h('div', { class: 'cs-note-row' }, aptChip(a.id), h('span', { class: 'cs-note-row__name' }), meter(p.apt[a.id]), h('b', { style: 'min-width:1.5em;text-align:right' }, String(p.apt[a.id])))));
    body.appendChild(h('h3', {}, 'ポイント'));
    body.appendChild(h('div', { class: 'cs-note-pts' },
      h('div', {}, h('b', {}, String(p.pts.pay)), h('span', {}, 'しごと')),
      h('div', {}, h('b', {}, String(p.pts.event)), h('span', {}, 'イベントなど')),
      h('div', {}, h('b', {}, String(p.pts.mini || 0)), h('span', {}, 'ミニゲーム')),
      h('div', {}, h('b', {}, String(p.pts.bonus)), h('span', {}, 'ゴール')),
    ));
    body.appendChild(h('p', { style: 'margin-top:10px;font-size:13px;color:#5A6270' }, 'ポイントや★はゲームの中のもの。本当の向き・不向きとは関係ありません。'));
    openModal('手帳', body, opener);
  }

  // しごと図鑑: 全職業の「合う適性3つ」と、その人のいまの★。適性でしぼれる
  function openJobBook(pid, opener) {
    const p = P(pid);
    let filter = null;
    const list = h('ul', { class: 'cs-book__list' });
    const chips = h('div', { class: 'cs-book__filter', role: 'group', 'aria-label': '適性でしぼる' });
    const renderList = () => {
      const opts = E.jobOptions(p.apt).filter((o) => filter == null || jobOf(o.id).apts.includes(filter));
      list.replaceChildren(...opts.map((o) => {
        const j = jobOf(o.id);
        const now = p.job === o.id;
        return h('li', { class: 'cs-book__item' + (now ? ' cs-book__item--now' : '') },
          icon(j.icon, 'cs-book__icon'),
          h('div', { class: 'cs-book__body' },
            h('p', { class: 'cs-book__name' }, j.name, now ? h('span', { class: 'cs-tag cs-tag--job' }, '今の職業') : null),
            h('p', { class: 'cs-book__desc' }, j.desc),
            h('span', { class: 'cs-apts' }, j.apts.map((a) => aptChip(a, ` ${p.apt[a]}`))),
          ),
          h('span', { class: 'cs-book__side' }, starsEl(o.stars), h('span', { class: 'cs-book__sum' }, `合計 ${o.sum}`)));
      }));
    };
    const setFilter = (v) => {
      filter = v;
      chips.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
      renderList();
    };
    chips.appendChild(h('button', { type: 'button', class: 'cs-book__chip', 'data-v': 'null', 'aria-pressed': 'true', onclick: () => setFilter(null) }, 'すべて'));
    D.APTS.forEach((a) => chips.appendChild(h('button', { type: 'button', class: 'cs-book__chip', 'data-v': String(a.id), 'aria-pressed': 'false', onclick: () => setFilter(a.id) }, icon(a.icon), a.name)));
    renderList();
    const body = h('div', {},
      h('p', { class: 'cs-book__intro' }, dot(p, true), h('span', {}, `${p.name}さんのいまの適性で見た★。★は、その職業に合う3つの適性の合計で決まる（0〜2で★1、3〜5で★2、6〜8で★3、9以上で★4）。適性を押すと、その適性が合う職業だけになる。`)),
      chips, list);
    openModal('しごと図鑑', body, opener);
  }

  function openLog(opener) {
    const items = S.log.slice(-80).reverse();
    const body = items.length
      ? h('ul', { class: 'cs-log' }, items.map((x) => h('li', {}, dot(P(x.p), true), h('span', {}, `${P(x.p).name}さん: ${x.text}`))))
      : h('p', {}, 'まだ何も起きていません。');
    openModal('できごと', body, opener);
  }

  function legendItem(type, apt, label) {
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', '40');
    svg.setAttribute('height', '40');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('aria-hidden', 'true');
    if (type === 'stop') {
      sv('rect', { x: 2, y: 8, width: 36, height: 24, rx: 6, fill: '#1C3F5E' }, svg);
      svText(svg, '節目', { x: 20, y: 21, 'font-size': 11, 'font-weight': 700, fill: '#FFFFFF', class: 'cs-b-label' });
    } else {
      drawSquare(svg, type, 20, 20, apt);
    }
    return h('li', {}, svg, h('span', {}, label));
  }

  // ゴールの順のボーナスの説明。最後まで同じ値が続くところは「○番目から」にまとめる（8・5・3・2・1・1 → …、5番目から +1）
  function bonusText() {
    const b = D.GOAL_BONUS;
    let last = b.length - 1;
    while (last > 0 && b[last - 1] === b[b.length - 1]) last--;
    const parts = b.slice(0, last).map((v, i) => `${i + 1}番目 +${v}`);
    parts.push(`${last + 1}番目${last < b.length - 1 ? 'から' : ''} +${b[last]}`);
    return parts.join('、');
  }

  function openHowto(opener) {
    const body = h('div', {},
      h('h3', {}, 'どんなゲーム？'),
      h('p', {}, '小学生から35さいのゴールまで、すごろくで進むゲーム。体験マスで「適性」がたまり、しごとの道に進むときに職業を選ぶ。ポイントを集めながらゴールをめざそう。'),
      h('h3', {}, '1回の番'),
      h('p', {}, 'サイコロをふって進む → 止まったマスで何かが起きる → つぎの人へ。「サイコロ2つから選ぶ」遊び方では、2つの目のどちらで進むかを選ぶ（止まる先は盤面の①②で見られる）。急いでゴールをめざすか、ほしいマスをねらうか。しごとマスにぴったり止まると、そのポイントが2倍。'),
      h('h3', {}, 'マスの種類'),
      h('ul', { class: 'cs-legend' },
        legendItem('exp', 2, '体験マス: 止まると、その色の適性 +1'),
        legendItem('friend', 4, 'なかまマス: だれかをさそって、2人とも +1'),
        legendItem('event', null, 'イベント: カードをめくる'),
        legendItem('pay', null, 'しごとマス: 通ると★に応じたポイント（同じマスは1回）。ぴったり止まると2倍'),
        legendItem('grow', null, '成長マス: 今の職業に合う適性 +1'),
        legendItem('change', null, '転職チャンス: 職業を変えてもいい'),
        legendItem('mini', null, 'ミニゲームマス: 全員でミニゲーム'),
        legendItem('stop', null, '節目: 必ず止まって、道や職業を選ぶ'),
      ),
      h('h3', {}, '道と職業'),
      h('p', {}, '15さいと18さいの節目で、学びの道か、しごとの道を選ぶ。しごとの道に進むときに職業を選ぶ（22さいの節目で、まだ職業がない人も選ぶ）。学びの道から節目に着くと、好きな適性を増やせる。どちらの道も長さは同じ。'),
      h('h3', {}, '★とポイント'),
      h('p', {}, '★は、職業に合う3つの適性の合計で決まる（0〜2で★1、3〜5で★2、6〜8で★3、9以上で★4）。職業ごとの合う適性は、上の「しごと図鑑」で見られる。'),
      h('p', {}, `ゴールした順にボーナス（${bonusText()}）。全員がゴールしたら、ポイントの合計が多い人から順位を発表。時間が来て途中で終えたときは、ゴールに近い順に続きの順位のボーナス（同じマスにいる人は同じ順位）。`),
      h('h3', {}, 'ミニゲーム'),
      h('p', {}, 'ミニゲームマスに止まると、全員でミニゲーム。「大きい？小さい？」（つぎのサイコロを予想）・「じゃんけん」（コンピューターと勝負）・「合計ピッタリ」（相談しないで1〜3を出し、合計を目標に合わせる）のどれかが出る。みんなが口・チャット・手で出したものを、メンターが1人ずつ押して入れる。当たり・勝ち・ピッタリで +1ポイント。'),
      h('h3', {}, '休み・応援'),
      h('p', {}, 'イベントで1回休みになっても、なかまマスでさそってもらうと休みがなくなる。ゴールした人は、まだの人のサイコロに +1 の応援ができる。'),
      h('p', { style: 'margin-top:12px;font-size:14px;color:#5A6270' }, 'ポイントや★はゲームの中のもの。本当の向き・不向きとは関係ありません。'),
    );
    openModal('あそびかた', body, opener);
  }

  function fmtTime(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒`;
  }

  function openMenu(opener) {
    const body = h('div', {});
    const toggle = h('div', { class: 'cs-toggle', role: 'group', 'aria-label': 'ステージの表示' },
      ['school', 'age'].map((v) => h('button', { type: 'button', 'aria-pressed': String(L() === v), onclick: () => setLabels(v) }, v === 'school' ? '学校名' : '年齢だけ')));
    body.appendChild(h('div', { class: 'cs-menu-row' }, h('span', {}, 'ステージの表示'), toggle));
    const time = h('b', {}, fmtTime(Date.now() - meta.startedAt));
    body.appendChild(h('div', { class: 'cs-menu-row' }, h('span', {}, '遊んでいる時間'), h('span', {}, time, `（${S.turnNo}手番め・${S.round}周め）`)));
    const endBox = h('div', {});
    const endBtn = h('button', { class: 'cs-btn cs-btn--secondary', type: 'button', onclick: () => {
      endBox.replaceChildren(h('div', { class: 'cs-confirm' },
        h('p', {}, 'ここで終えて、結果を見る？ まだゴールしていない人は、ゴールに近い順に続きの順位のボーナスになる。'),
        h('div', { class: 'cs-confirm__btns' },
          h('button', { class: 'cs-btn cs-btn--primary', type: 'button', onclick: () => { closeModal(); endNow(); } }, '結果を見る'),
          h('button', { class: 'cs-btn cs-btn--secondary', type: 'button', onclick: () => endBox.replaceChildren() }, 'やめる'))));
    } }, icon('sports_score'), 'ここで終えて結果を見る');
    body.appendChild(h('div', { class: 'cs-menu-row' }, h('span', {}, '時間が来たら'), endBtn));
    body.appendChild(endBox);
    const topBox = h('div', {});
    const topBtn = h('button', { class: 'cs-quiet', type: 'button', onclick: () => {
      topBox.replaceChildren(h('div', { class: 'cs-confirm' },
        h('p', {}, '最初の画面にもどる？ いまのゲームは消える。'),
        h('div', { class: 'cs-confirm__btns' },
          h('button', { class: 'cs-btn cs-btn--danger', type: 'button', onclick: () => { closeModal(); goTop(); } }, 'もどる'),
          h('button', { class: 'cs-btn cs-btn--secondary', type: 'button', onclick: () => topBox.replaceChildren() }, 'やめる'))));
    } }, '最初の画面にもどる');
    body.appendChild(h('div', { class: 'cs-menu-row' }, h('span', {}, 'やり直す'), topBtn));
    body.appendChild(topBox);
    openModal('メニュー', body, opener);
    menuTimer = setInterval(() => { time.textContent = fmtTime(Date.now() - meta.startedAt); }, 1000);
  }

  function goTop() {
    gen++;
    busy = false;
    miniPicks = {};
    clearSaved();
    S = null;
    renderSetup();
    show('setup');
  }

  function setLabels(v) {
    const r = E.apply(S, { type: 'labels', labels: v });
    if (!r.ok) return;
    S = r.state;
    save();
    mountBoard();
    renderAll();
    closeModal();
  }

  function endNow() {
    const r = E.apply(S, { type: 'end' });
    if (!r.ok) return;
    gen++;
    busy = false;
    miniPicks = {};
    S = r.state;
    clearSaved();
    showResults();
  }

  // ── 結果 ─────────────────────────────────────
  function showResults() {
    renderResults();
    show('results');
    const top = S.results.filter((r) => r.place === 1).map((r) => P(r.pid).name + 'さん').join('・');
    $('cs-results-title').focus();
    announce(`結果発表。1位は${top}`);
  }

  function renderResults() {
    const ol = $('cs-rank');
    ol.replaceChildren();
    S.results.forEach((row) => {
      const p = P(row.pid);
      const job = p.job != null ? jobOf(p.job) : (p.prevJob != null ? jobOf(p.prevJob) : null);
      const st = job ? E.stars(p.apt, job.id) : null;
      ol.appendChild(h('li', { class: 'cs-rank__item' + (row.place === 1 ? ' cs-rank__item--top' : '') },
        h('span', { class: 'cs-rank__place' }, `${row.place}位`),
        h('span', { class: 'cs-rank__who' }, dot(p), h('span', { class: 'cs-rank__name' }, `${p.name}さん`)),
        h('span', { class: 'cs-rank__total' }, h('b', {}, String(row.total)), h('span', {}, 'ポイント')),
        job ? h('span', { class: 'cs-rank__job' }, icon(job.icon), job.name, ' ', starsEl(st)) : null,
        h('span', { class: 'cs-rank__detail' },
          h('span', {}, `しごと ${p.pts.pay}`),
          h('span', {}, `イベントなど ${p.pts.event}`),
          h('span', {}, `ミニゲーム ${p.pts.mini || 0}`),
          h('span', {}, p.unfinished ? `ゴール ${p.pts.bonus}（途中で終了・ゴールに近い順で${p.rank}位）` : `ゴール ${p.pts.bonus}（${p.rank}番目にゴール）`),
        ),
      ));
    });
  }

  // ── キーボード（進行役が数字キーで選べる） ─────────────────
  document.addEventListener('keydown', (e) => {
    if (!$('cs-modal').hidden) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }
    if ($('cs-play').hidden || busy) return;
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (/^[1-9]$/.test(e.key)) {
      const btn = document.querySelector(`#cs-card [data-num="${e.key}"]`);
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    if (e.key === 'Enter' && !(e.target.closest && e.target.closest('button'))) {
      const btn = document.querySelector('#cs-card [data-primary]') || document.querySelector('#cs-turn [data-primary]');
      if (btn) { e.preventDefault(); btn.click(); }
    }
  });

  // ── はじめる ─────────────────────────────────
  $('cs-start').addEventListener('click', () => {
    const names = setup.names.slice(0, setup.count).map((v, i) => (v.trim() || D.PLAYER_COLORS[i].name));
    const labels = (document.querySelector('input[name="cs-labels"]:checked') || {}).value || 'school';
    const dice = ((document.querySelector('input[name="cs-dice"]:checked') || {}).value === '1') ? 1 : 2;
    startGame(names, labels, dice);
  });
  $('cs-resume').addEventListener('click', () => {
    const d = loadSaved();
    if (!d) { renderSetup(); return; }
    S = d.state;
    meta = d.meta || { names: S.players.map((p) => p.name), startedAt: Date.now() };
    resetView();
    show('play');
    mountBoard();
    renderAll();
  });
  $('cs-howto-top').addEventListener('click', (e) => openHowto(e.currentTarget));
  $('cs-open-howto').addEventListener('click', (e) => openHowto(e.currentTarget));
  $('cs-open-log').addEventListener('click', (e) => openLog(e.currentTarget));
  $('cs-open-book').addEventListener('click', (e) => { if (S) openJobBook(S.cur, e.currentTarget); });
  $('cs-open-menu').addEventListener('click', (e) => openMenu(e.currentTarget));
  $('cs-modal-close').addEventListener('click', closeModal);
  $('cs-modal').addEventListener('click', (e) => { if (e.target === $('cs-modal')) closeModal(); });
  $('cs-again').addEventListener('click', () => startGame(meta.names && meta.names.length ? meta.names : S.players.map((p) => p.name), S.settings.labels, S.settings.dice));
  $('cs-to-top').addEventListener('click', () => goTop());

  renderSetup();
  show('setup');
})();
