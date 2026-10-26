/* ねむらせ基地 — 仕事のミニゲーム。
   NemuraseGames.open(box, kind, onDone) で box の中に作る。おわったら onDone() を1回だけ呼ぶ。
   どれも数十秒でおわる、まちがえてもやりなおしにならない作り。 */
(function (root) {
  'use strict';

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const nudge = (node) => { node.classList.remove('is-nudge'); void node.offsetWidth; node.classList.add('is-nudge'); };

  const WIRE_COLORS = [
    { key: 'r', name: 'あか', hex: '#D9433B' },
    { key: 'b', name: 'あお', hex: '#2F6FD6' },
    { key: 'y', name: 'きいろ', hex: '#E8B820' },
    { key: 'g', name: 'みどり', hex: '#2E9A4A' },
  ];

  // 線をつなぐ: 左の色を押してから、右の同じ色を押す
  function wire(box, done) {
    box.appendChild(el('p', 'nk-game__how', '左の線を押してから、右の同じ色を押してつなごう。'));
    const wrap = el('div', 'nk-wire');
    const left = el('div', 'nk-wire__col');
    const right = el('div', 'nk-wire__col');
    const lines = el('div', 'nk-wire__lines');
    let picked = null;
    let joined = 0;
    const make = (c, side) => {
      const b = el('button', 'nk-wire__end nk-wire__end--' + side);
      b.type = 'button';
      b.dataset.color = c.key;
      b.style.setProperty('--wire', c.hex);
      b.setAttribute('aria-label', c.name + 'の線（' + (side === 'l' ? '左' : '右') + '）');
      return b;
    };
    WIRE_COLORS.forEach((c) => {
      const b = make(c, 'l');
      b.addEventListener('click', () => {
        if (b.classList.contains('is-done')) return;
        left.querySelectorAll('.is-picked').forEach((x) => x.classList.remove('is-picked'));
        picked = c.key;
        b.classList.add('is-picked');
      });
      left.appendChild(b);
    });
    shuffle(WIRE_COLORS).forEach((c) => {
      const b = make(c, 'r');
      b.addEventListener('click', () => {
        if (b.classList.contains('is-done')) return;
        if (!picked) { nudge(left); return; }
        if (picked !== c.key) { nudge(b); return; }
        const lb = left.querySelector('[data-color="' + c.key + '"]');
        lb.classList.remove('is-picked');
        lb.classList.add('is-done');
        b.classList.add('is-done');
        picked = null;
        joined++;
        drawLine(lb, b, c.hex);
        if (joined === WIRE_COLORS.length) setTimeout(done, 350);
      });
      right.appendChild(b);
    });
    function drawLine(a, b, hex) {
      const base = wrap.getBoundingClientRect();
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const x1 = ra.right - base.left;
      const y1 = ra.top + ra.height / 2 - base.top;
      const x2 = rb.left - base.left;
      const y2 = rb.top + rb.height / 2 - base.top;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const line = el('span', 'nk-wire__line');
      line.style.left = x1 + 'px';
      line.style.top = y1 + 'px';
      line.style.width = len + 'px';
      line.style.background = hex;
      line.style.transform = 'rotate(' + Math.atan2(y2 - y1, x2 - x1) + 'rad)';
      lines.appendChild(line);
    }
    wrap.append(left, lines, right);
    box.appendChild(wrap);
  }

  // 番号を順に押す: 1 から 6 まで
  function order(box, done) {
    const N = 6;
    let next = 1;
    const how = el('p', 'nk-game__how', '1 から 6 まで、順番に押そう。');
    const grid = el('div', 'nk-order');
    shuffle(Array.from({ length: N }, (_, i) => i + 1)).forEach((n) => {
      const b = el('button', 'nk-order__btn', String(n));
      b.type = 'button';
      b.addEventListener('click', () => {
        if (b.classList.contains('is-done')) return;
        if (n !== next) { nudge(b); return; }
        b.classList.add('is-done');
        next++;
        if (next > N) setTimeout(done, 300);
      });
      grid.appendChild(b);
    });
    box.append(how, grid);
  }

  // メーターを合わせる: つまみを動かして、目印に合わせる（合ったまま少し待つとおわる）
  function meter(box, done) {
    const target = 15 + Math.floor(Math.random() * 71);
    let start = Math.floor(Math.random() * 101);
    if (Math.abs(start - target) < 25) start = target > 50 ? target - 40 : target + 40;
    const how = el('p', 'nk-game__how', 'つまみを動かして、オレンジの目印に合わせよう。');
    const wrap = el('div', 'nk-meter');
    const bar = el('div', 'nk-meter__bar');
    const mark = el('span', 'nk-meter__mark');
    mark.style.left = target + '%';
    const fill = el('span', 'nk-meter__fill');
    bar.append(fill, mark);
    const input = el('input', 'nk-meter__input');
    input.type = 'range';
    input.min = '0';
    input.max = '100';
    input.value = String(start);
    input.setAttribute('aria-label', 'メーター');
    const state = el('p', 'nk-meter__state', '');
    let timer = null;
    let finished = false;
    const update = () => {
      const v = Number(input.value);
      fill.style.width = v + '%';
      const near = Math.abs(v - target) <= 3;
      wrap.classList.toggle('is-near', near);
      state.textContent = near ? 'ぴったり！そのまま…' : '';
      if (near && !timer && !finished) {
        timer = setTimeout(() => { finished = true; done(); }, 600);
      } else if (!near && timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    input.addEventListener('input', update);
    wrap.append(bar, input, state);
    box.append(how, wrap);
    update();
  }

  const KINDS = { wire, order, meter };

  function open(box, kind, onDone) {
    box.textContent = '';
    let called = false;
    const done = () => { if (called) return; called = true; onDone(); };
    (KINDS[kind] || order)(box, done);
  }

  root.NemuraseGames = { open };
})(window);
