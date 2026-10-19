/* しるしでヒント：アイコンとお題えらび（オーナーが正式な候補を選ぶための一覧）
   いまの試作の data.js と、下の「追加の候補」を並べる。チェックと書きかえはこのブラウザの localStorage に残す。
   「選んだ結果をコピー」で JSON を作り、チャットに貼ってもらって data.js に反映する。 */
(() => {
  'use strict';

  const DATA = window.SHIRUSHI_DATA;
  const KEY = 'shirushi-hint-pick-v2'; // data.js の中身を変えたら上げる（前の選び途中を読まないように）
  const KIND_NAMES = { creature: '生き物', food: '食べ物', ride: '乗り物', nature: '自然', thing: 'もの' };
  const SAME_KIND = 6;

  // 追加の候補（アイコン）。group は data.js の groups の id
  // 2026-10-19 に挙げた23個は、オーナーの判断ですべて data.js に入れた。新しい候補を挙げるときはここに足す
  const EXTRA_ICONS = [];
  // 追加の候補（お題）。学校・勉強・こわいもの・恋愛を連想させるものは入れない
  // 2026-10-19 に挙げた49個は、オーナーの判断ですべて data.js に入れた。新しい候補を挙げるときはここに足す
  const EXTRA_TOPICS = { creature: [], food: [], ride: [], nature: [], thing: [] };

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);

  // ── 状態 ──
  function initial() {
    const icons = [];
    DATA.groups.forEach((g) => g.icons.forEach((ic) => icons.push(Object.assign({ group: g.id, on: true, src: 'cur' }, ic))));
    EXTRA_ICONS.forEach((ic) => icons.push(Object.assign({ on: false, src: 'new' }, ic)));
    const topics = [];
    Object.keys(KIND_NAMES).forEach((k) => {
      DATA.kinds[k].forEach((w) => topics.push({ w, kind: k, on: true, two: false, src: 'cur' }));
      EXTRA_TOPICS[k].forEach((w) => topics.push({ w, kind: k, on: false, two: false, src: 'new' }));
    });
    return { icons, topics };
  }
  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved && Array.isArray(saved.icons) && Array.isArray(saved.topics)) return saved;
    } catch { /* noop */ }
    return initial();
  }
  let ST = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(ST)); } catch { /* noop */ } };

  // ── アイコン ──
  function face(ic) {
    if (ic.color) {
      const sw = el('span', 'pk-swatch');
      sw.style.background = ic.color;
      sw.setAttribute('aria-hidden', 'true');
      return sw;
    }
    const s = el('span', 'material-symbols-rounded pk-glyph', ic.icon);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }
  function renderIcons() {
    $('pk-icons').replaceChildren(...DATA.groups.map((g) => {
      const list = ST.icons.filter((ic) => ic.group === g.id);
      const sec = el('section', 'pk-group');
      const on = list.filter((ic) => ic.on).length;
      sec.append(el('h3', 'pk-h3', g.name + '（' + on + ' / ' + list.length + '）'));
      const grid = el('div', 'pk-igrid');
      list.forEach((ic) => {
        const card = el('div', 'pk-icard' + (ic.on ? ' is-on' : ''));
        const chk = el('input');
        chk.type = 'checkbox';
        chk.checked = ic.on;
        chk.id = 'ic-' + ic.id;
        chk.setAttribute('aria-label', ic.label + 'を使う');
        chk.addEventListener('change', () => { ic.on = chk.checked; save(); render(); });
        const lab = el('label', 'pk-icard__face');
        lab.htmlFor = chk.id;
        lab.append(face(ic));
        const name = el('input', 'pk-icard__name');
        name.type = 'text';
        name.value = ic.label;
        name.maxLength = 8;
        name.setAttribute('aria-label', 'アイコンの名前');
        name.addEventListener('change', () => { ic.label = clean(name.value, 8) || ic.label; save(); render(); });
        card.append(chk, lab, name, el('span', 'pk-flag' + (ic.src === 'new' ? ' pk-flag--new' : ''), ic.src === 'new' ? '追加の候補' : 'いまの試作'));
        if (ic.icon) card.append(el('code', 'pk-icard__code', ic.icon));
        grid.append(card);
      });
      sec.append(grid);
      return sec;
    }));
  }

  // ── お題 ──
  function kindSelect(value, onChange, label) {
    const sel = el('select', 'form-select pk-kind');
    sel.setAttribute('aria-label', label);
    Object.keys(KIND_NAMES).forEach((k) => {
      const o = el('option', '', KIND_NAMES[k]);
      o.value = k;
      if (k === value) o.selected = true;
      sel.append(o);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  function renderTopics() {
    const counts = {};
    ST.topics.forEach((t) => { if (t.on) counts[t.w] = (counts[t.w] || 0) + 1; });
    $('pk-topics').replaceChildren(...Object.keys(KIND_NAMES).map((k) => {
      const list = ST.topics.filter((t) => t.kind === k);
      const on = list.filter((t) => t.on).length;
      const sec = el('section', 'pk-group');
      const h = el('h3', 'pk-h3', KIND_NAMES[k] + '（' + on + ' / ' + list.length + '）');
      if (on && on < SAME_KIND) h.append(el('span', 'pk-warn', '6個より少ないと、同じなかまで候補をそろえきれない'));
      sec.append(h);
      const ul = el('ul', 'pk-tlist');
      list.forEach((t) => {
        const li = el('li', 'pk-trow' + (t.on ? ' is-on' : ''));
        li.dataset.w = t.w;
        const idx = ST.topics.indexOf(t);
        const chk = el('input');
        chk.type = 'checkbox';
        chk.checked = t.on;
        chk.setAttribute('aria-label', t.w + 'を使う');
        chk.addEventListener('change', () => { t.on = chk.checked; save(); render(); });
        const word = el('input', 'pk-trow__word');
        word.type = 'text';
        word.value = t.w;
        word.maxLength = 12;
        word.setAttribute('aria-label', 'お題');
        word.addEventListener('change', () => { t.w = clean(word.value, 12) || t.w; save(); render(); });
        const two = el('label', 'pk-two');
        const twoChk = el('input');
        twoChk.type = 'checkbox';
        twoChk.checked = t.two;
        twoChk.addEventListener('change', () => { t.two = twoChk.checked; save(); render(); });
        two.append(twoChk, document.createTextNode('2通り'));
        li.append(chk, word, kindSelect(t.kind, (v) => { t.kind = v; save(); render(); }, t.w + 'のなかま'), two,
          el('span', 'pk-flag' + (t.src === 'cur' ? '' : ' pk-flag--new'), t.src === 'cur' ? 'いまの試作' : (t.src === 'new' ? '追加の候補' : '足したお題')));
        if (t.on && counts[t.w] > 1) li.append(el('span', 'pk-warn', '同じお題がほかにもある'));
        if (t.src === 'add') {
          const del = el('button', 'btn btn-ghost btn-sm', '消す');
          del.type = 'button';
          del.addEventListener('click', () => { ST.topics.splice(idx, 1); save(); render(); });
          li.append(del);
        }
        ul.append(li);
      });
      sec.append(ul);
      return sec;
    }));
  }

  // ── まとめ ──
  function result() {
    const icons = {};
    DATA.groups.forEach((g) => {
      icons[g.id] = ST.icons.filter((ic) => ic.group === g.id && ic.on).map((ic) => (ic.color ? { id: ic.id, label: ic.label, color: ic.color } : { id: ic.id, label: ic.label, icon: ic.icon }));
    });
    const kinds = {};
    Object.keys(KIND_NAMES).forEach((k) => { kinds[k] = ST.topics.filter((t) => t.kind === k && t.on).map((t) => t.w); });
    const checked = ST.topics.filter((t) => t.on && t.two).map((t) => t.w);
    return { icons, kinds, checked2: checked };
  }
  function renderSummary() {
    const r = result();
    const iconN = Object.values(r.icons).reduce((n, a) => n + a.length, 0);
    const topicN = Object.values(r.kinds).reduce((n, a) => n + a.length, 0);
    const labels = Object.values(r.icons).flat().map((ic) => ic.label);
    const dupL = labels.filter((l, i) => labels.indexOf(l) !== i);
    $('pk-icon-count').textContent = iconN + '個えらんだ';
    $('pk-topic-count').textContent = topicN + '個えらんだ';
    $('pk-sum').textContent = 'アイコン ' + iconN + '個・お題 ' + topicN + '個';
    const parts = ['アイコン ' + iconN + '個・お題 ' + topicN + '個（' + Object.keys(KIND_NAMES).map((k) => KIND_NAMES[k] + ' ' + r.kinds[k].length).join('・') + '）・「2通り」の印 ' + r.checked2.length + '個'];
    if (dupL.length) parts.push('同じ名前のアイコン: ' + Array.from(new Set(dupL)).join('・'));
    $('pk-out-sum').textContent = parts.join('。');
  }
  function render() { renderIcons(); renderTopics(); renderSummary(); }

  // ── 操作 ──
  const kindAdd = $('pk-add-kind');
  Object.keys(KIND_NAMES).forEach((k) => { const o = el('option', '', KIND_NAMES[k]); o.value = k; kindAdd.append(o); });
  $('pk-add').addEventListener('submit', (e) => {
    e.preventDefault();
    if (e.isComposing) return;
    const w = clean($('pk-add-word').value, 12);
    if (!w) { $('pk-add-msg').textContent = 'お題を入れてね'; return; }
    if (ST.topics.some((t) => t.w === w)) { $('pk-add-msg').textContent = '「' + w + '」はもう一覧にあるよ'; return; }
    ST.topics.push({ w, kind: kindAdd.value, on: true, two: false, src: 'add' });
    $('pk-add-word').value = '';
    $('pk-add-msg').textContent = '「' + w + '」を' + KIND_NAMES[kindAdd.value] + 'に足したよ';
    save();
    render();
  });
  $('pk-copy').addEventListener('click', () => {
    const text = 'しるしでヒントの選んだ結果\n' + JSON.stringify(result());
    const btn = $('pk-copy');
    const done = (ok) => {
      btn.textContent = ok ? 'コピーしたよ' : 'コピーできなかったよ';
      setTimeout(() => { btn.textContent = '選んだ結果をコピー'; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  });
  $('pk-reset').addEventListener('click', () => {
    if (!window.confirm('チェックと書きかえを、はじめの状態にもどす？')) return;
    ST = initial();
    save();
    render();
  });

  render();
})();
