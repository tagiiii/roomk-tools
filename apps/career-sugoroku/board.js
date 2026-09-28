/* キャリアすごろく — 盤面（SVG）
   文字・マス・駒・道はすべて画面側で描く（画像に焼き込まない）。 */
(function (root) {
  'use strict';
  const D = root.CS_DATA;
  const TILE = 62;
  let NS = null; // SVG の名前空間は、ページにある <svg> 要素から取る

  function el(tag, attrs, parent) {
    const node = document.createElementNS(NS, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => node.setAttribute(k, String(v)));
    if (parent) parent.appendChild(node);
    return node;
  }
  function icon(parent, name, x, y, size, color) {
    const t = el('text', { x, y, 'font-size': size, fill: color, 'text-anchor': 'middle', class: 'cs-b-icon', 'aria-hidden': 'true' }, parent);
    t.textContent = name;
    return t;
  }
  function label(parent, text, x, y, size, color, weight) {
    const t = el('text', { x, y, 'font-size': size, fill: color, 'text-anchor': 'middle', 'font-weight': weight || 700 }, parent);
    t.textContent = text;
    return t;
  }

  const districtOf = (id) => D.DISTRICTS.find((d) => d.id === id);

  const state = { svg: null, tokensLayer: null, tokens: {}, tiles: {}, onTile: null, lastPos: {}, reduce: () => false, hereLayer: null };

  function mount(svg, legendEl, opts) {
    NS = svg.namespaceURI;
    state.svg = svg;
    state.onTile = opts && opts.onTile;
    state.reduce = (opts && opts.reduce) || (() => false);
    svg.replaceChildren();
    el('rect', { x: 0, y: 0, width: 1000, height: 600, rx: 18, fill: '#F7F4EE' }, svg);

    // 地区（同じ色の円を重ねて、まとまりのある面にする）
    const areas = el('g', { 'aria-hidden': 'true' }, svg);
    D.NODES.forEach((n) => {
      const d = districtOf(n.d);
      el('circle', { cx: n.x, cy: n.y, r: 66, fill: d.tint }, areas);
    });
    // 地区名と、その地区のイベントで狙いやすい適性
    D.DISTRICTS.forEach((d) => {
      const g = el('g', { 'aria-hidden': 'true' }, svg);
      label(g, d.name, d.label.x, d.label.y, 22, '#5A6270', 700);
      if (d.apts.length) {
        const w = d.apts.length * 30;
        d.apts.forEach((a, i) => {
          const apt = D.APTS[a];
          const cx = d.label.x - w / 2 + 15 + i * 30;
          el('circle', { cx, cy: d.label.y + 22, r: 13, fill: apt.tint }, g);
          icon(g, apt.icon, cx, d.label.y + 29, 18, apt.color);
        });
      }
    });

    // 道
    const roads = el('g', { 'aria-hidden': 'true' }, svg);
    const dashes = el('g', { 'aria-hidden': 'true' }, svg);
    D.NODES.forEach((n) => n.next.forEach((m) => {
      const b = D.NODES[m];
      el('line', { x1: n.x, y1: n.y, x2: b.x, y2: b.y, stroke: '#E6DECD', 'stroke-width': 26, 'stroke-linecap': 'round' }, roads);
      el('line', { x1: n.x, y1: n.y, x2: b.x, y2: b.y, stroke: '#FFFFFF', 'stroke-width': 3, 'stroke-dasharray': '2 12', 'stroke-linecap': 'round' }, dashes);
    }));
    // 進む向き（小さな矢印）
    const arrows = el('g', { 'aria-hidden': 'true' }, svg);
    D.NODES.forEach((n) => n.next.forEach((m) => {
      const b = D.NODES[m];
      const mx = (n.x + b.x) / 2; const my = (n.y + b.y) / 2;
      const ang = Math.atan2(b.y - n.y, b.x - n.x) * 180 / Math.PI;
      el('path', { d: 'M -6 -6 L 4 0 L -6 6', fill: 'none', stroke: '#B9AE97', 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', transform: `translate(${mx} ${my}) rotate(${ang})` }, arrows);
    }));

    // いまいるマスの目印（駒の下）
    state.hereLayer = el('g', { 'aria-hidden': 'true' }, svg);

    // マス
    const tiles = el('g', {}, svg);
    D.NODES.forEach((n) => {
      const sq = D.SQUARES[n.type];
      const size = n.type === 'start' ? TILE + 12 : TILE;
      const g = el('g', { class: 'cs-tile', tabindex: 0, role: 'button', 'data-node': n.id, 'aria-label': tileLabel(n) }, tiles);
      el('rect', { x: n.x - size / 2, y: n.y - size / 2, width: size, height: size, rx: 17, fill: '#FFFFFF', stroke: sq.color, 'stroke-width': 3 }, g);
      el('rect', { x: n.x - size / 2 + 5, y: n.y - size / 2 + 5, width: size - 10, height: size - 10, rx: 13, fill: sq.tint }, g);
      icon(g, sq.icon, n.x, n.y + 12, n.type === 'start' ? 36 : 32, sq.color);
      if (n.type === 'start') label(g, '駅', n.x, n.y + size / 2 + 22, 18, D.SQUARES.start.color, 700);
      if (n.next.length > 1) {
        el('circle', { cx: n.x + size / 2 - 4, cy: n.y - size / 2 + 4, r: 13, fill: '#1C3F5E' }, g);
        icon(g, 'call_split', n.x + size / 2 - 4, n.y - size / 2 + 11, 18, '#FFFFFF');
      }
      g.addEventListener('click', () => state.onTile && state.onTile(n.id));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (state.onTile) state.onTile(n.id); }
      });
      state.tiles[n.id] = g;
    });

    state.tokensLayer = el('g', {}, svg);
    state.tokens = {};
    state.lastPos = {};

    if (legendEl) {
      const types = ['grow', 'new', 'job', 'event', 'collab', 'life'];
      const html = types.map((t) => {
        const sq = D.SQUARES[t];
        return '<span class="cs-legend__item"><span class="material-symbols-rounded" aria-hidden="true" style="color:' + sq.color + '">' + sq.icon + '</span>' + esc(sq.long) + '</span>';
      }).join('') + '<span class="cs-legend__item"><span class="material-symbols-rounded" aria-hidden="true" style="color:#1C3F5E">call_split</span>分かれ道</span>';
      legendEl.innerHTML = html;
    }
  }

  function esc(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function tileLabel(n) {
    const sq = D.SQUARES[n.type];
    const d = districtOf(n.d);
    return `${sq.long}のマス（${d.name}）${n.next.length > 1 ? '・分かれ道' : ''}`;
  }

  // 同じマスに複数の駒がいるときは、マスの上に横並び
  function tokenPos(nodeId, index, count) {
    const n = D.NODES[nodeId];
    const spread = Math.min(24, 150 / Math.max(1, count));
    const x = n.x + (index - (count - 1) / 2) * spread;
    const y = n.y - (n.type === 'start' ? 50 : 44);
    return { x, y };
  }

  // players: [{ id, name, color, pos, current, dim }]
  function update(players) {
    if (!state.svg) return;
    const byNode = {};
    players.forEach((p) => { (byNode[p.pos] = byNode[p.pos] || []).push(p); });
    const seen = new Set();
    // いま手番の人のマスに目印
    state.hereLayer.replaceChildren();
    const cur = players.find((p) => p.current);
    if (cur) {
      const n = D.NODES[cur.pos];
      el('circle', { cx: n.x, cy: n.y, r: 46, fill: 'none', stroke: cur.color, 'stroke-width': 5, 'stroke-dasharray': '6 7', opacity: 0.9 }, state.hereLayer);
    }
    Object.entries(byNode).forEach(([node, list]) => {
      // 手番の人は最前面・右端
      list.sort((a, b) => (a.current ? 1 : 0) - (b.current ? 1 : 0));
      list.forEach((p, i) => {
        seen.add(p.id);
        const pos = tokenPos(Number(node), i, list.length);
        let tok = state.tokens[p.id];
        if (!tok) {
          tok = el('g', { class: 'cs-token' }, state.tokensLayer);
          el('circle', { class: 'cs-token__ring', r: 22, fill: 'none', stroke: '#1C3F5E', 'stroke-width': 4 }, tok);
          el('circle', { class: 'cs-token__body', r: 17, stroke: '#FFFFFF', 'stroke-width': 3 }, tok);
          const t = el('text', { class: 'cs-token__text', y: 6, 'font-size': 16, 'text-anchor': 'middle', fill: '#FFFFFF', 'font-weight': 700 }, tok);
          t.textContent = '';
          el('title', {}, tok);
          state.tokens[p.id] = tok;
        }
        tok.querySelector('.cs-token__body').setAttribute('fill', p.color);
        tok.querySelector('.cs-token__ring').setAttribute('visibility', p.current ? 'visible' : 'hidden');
        tok.querySelector('.cs-token__text').textContent = Array.from(p.name)[0] || '?';
        tok.querySelector('title').textContent = `${p.name}（${D.SQUARES[D.NODES[p.pos].type].long}のマス）`;
        tok.setAttribute('opacity', p.dim ? 0.45 : 1);
        if (!tok.dataset.moving) tok.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
        tok.dataset.x = pos.x; tok.dataset.y = pos.y;
        if (p.current) state.tokensLayer.appendChild(tok);
      });
    });
    Object.keys(state.tokens).forEach((id) => {
      if (!seen.has(id)) { state.tokens[id].remove(); delete state.tokens[id]; }
    });
  }

  // 駒の移動（通ったマスに沿って、全体で600ms以内）。確定した位置は update 済み。
  function animateMove(pid, fromNode, path) {
    const tok = state.tokens[pid];
    if (!tok || !path || !path.length || state.reduce() || typeof tok.animate !== 'function') return;
    const pts = [fromNode].concat(path).map((id) => {
      const n = D.NODES[id];
      return { x: n.x, y: n.y - (n.type === 'start' ? 50 : 44) };
    });
    const end = { x: Number(tok.dataset.x), y: Number(tok.dataset.y) };
    pts[pts.length - 1] = end;
    const frames = pts.map((p) => ({ transform: `translate(${p.x}px, ${p.y}px)` }));
    const duration = Math.min(600, 110 * (pts.length - 1));
    tok.dataset.moving = '1';
    tok.getAnimations().forEach((a) => a.cancel());
    const anim = tok.animate(frames, { duration, easing: 'ease-in-out' });
    const done = () => { delete tok.dataset.moving; tok.style.transform = `translate(${end.x}px, ${end.y}px)`; };
    anim.onfinish = done;
    anim.oncancel = done;
    const tile = state.tiles[path[path.length - 1]];
    if (tile && typeof tile.animate === 'function') {
      setTimeout(() => {
        if (state.reduce()) return;
        tile.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.08)' }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
      }, duration);
      tile.style.transformBox = 'fill-box';
      tile.style.transformOrigin = 'center';
    }
  }

  function stopMotion() {
    Object.values(state.tokens).forEach((t) => t.getAnimations && t.getAnimations().forEach((a) => a.cancel()));
  }

  // pos から先のマス（分かれ道では両方の道を返す）
  function ahead(pos, count) {
    const out = [];
    let cur = pos;
    for (let i = 0; i < count; i++) {
      const n = D.NODES[cur];
      if (n.next.length > 1) {
        const branches = n.next.map((start) => {
          const list = [];
          let c = start;
          for (let k = i; k < count; k++) { list.push(c); c = D.NODES[c].next[0]; }
          return list;
        });
        out.push({ fork: cur, branches });
        return out;
      }
      cur = n.next[0];
      out.push({ node: cur, step: i + 1 });
    }
    return out;
  }

  // 分かれ道の先（各道の3マス）
  function branchPreview(forkNode, len) {
    const n = D.NODES[forkNode];
    return n.next.map((start) => {
      const list = [];
      let c = start;
      for (let k = 0; k < (len || 3); k++) { list.push(c); c = D.NODES[c].next[0]; }
      return list;
    });
  }

  // 入口の小さな絵（道・マス・カード・駒）。文字は入れない。
  function hero(svg) {
    NS = NS || svg.namespaceURI;
    svg.replaceChildren();
    el('path', { d: 'M 10 118 C 90 60, 150 140, 225 92 S 350 40, 410 70', fill: 'none', stroke: '#E6DECD', 'stroke-width': 24, 'stroke-linecap': 'round' }, svg);
    el('path', { d: 'M 10 118 C 90 60, 150 140, 225 92 S 350 40, 410 70', fill: 'none', stroke: '#fff', 'stroke-width': 3, 'stroke-dasharray': '2 12', 'stroke-linecap': 'round' }, svg);
    const stops = [[40, 97, 'grow'], [118, 104, 'new'], [200, 104, 'job'], [280, 70, 'event'], [360, 58, 'collab']];
    stops.forEach(([x, y, t]) => {
      const sq = D.SQUARES[t];
      el('rect', { x: x - 20, y: y - 20, width: 40, height: 40, rx: 11, fill: '#fff', stroke: sq.color, 'stroke-width': 2.5 }, svg);
      icon(svg, sq.icon, x, y + 8, 22, sq.color);
    });
    const cards = [[70, 32, 0, -8], [150, 30, 2, 4], [330, 112, 3, 7], [250, 124, 4, -5]];
    cards.forEach(([x, y, a, rot]) => {
      const apt = D.APTS[a];
      const g = el('g', { transform: `translate(${x} ${y}) rotate(${rot})` }, svg);
      el('rect', { x: -17, y: -22, width: 34, height: 44, rx: 7, fill: '#fff', stroke: apt.color, 'stroke-width': 2 }, g);
      el('rect', { x: -12, y: -17, width: 24, height: 20, rx: 5, fill: apt.tint }, g);
      icon(g, apt.icon, 0, 0, 18, apt.color);
    });
    const tok = el('g', { transform: 'translate(200 62)' }, svg);
    el('circle', { r: 14, fill: '#C0392B', stroke: '#fff', 'stroke-width': 3 }, tok);
    const tok2 = el('g', { transform: 'translate(226 66)' }, svg);
    el('circle', { r: 14, fill: '#2463A8', stroke: '#fff', 'stroke-width': 3 }, tok2);
  }

  root.CS_BOARD = { mount, update, animateMove, stopMotion, ahead, branchPreview, hero, tileLabel };
}(window));
