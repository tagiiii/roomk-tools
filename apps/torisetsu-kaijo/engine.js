/* とりせつ解除班 のルール。画面と通信に触らない（node でも読める）。
   爆弾（手がかり4つ・しかけ3〜5こ・導火線）は、番号（seed）からその場で作る。
   しかけの正解と説明書の文は、同じ表（CORD_TABLE など）から作る（説明書と正解がずれない）。
   しかけの種類・決まり・説明書の文は、すべてこのツールのために作ったもの。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KaijoEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 6;
  const MAX_STRIKES = 3;
  const SLOTS = 6;   // 表に3つ（0〜2）・裏に3つ（3〜5）
  // むずかしさ: しかけの数・時間（秒）・導火線があるか
  const LEVELS = {
    easy: { label: 'やさしい', mods: 3, sec: 300, fuse: false },
    normal: { label: 'ふつう', mods: 4, sec: 300, fuse: true },
    hard: { label: 'むずかしい', mods: 5, sec: 240, fuse: true },
  };
  const LEVEL_KEYS = ['easy', 'normal', 'hard'];
  const TYPES = ['cord', 'glyph', 'dial', 'arrow'];
  const TYPE_NAME = { cord: 'コード', glyph: '記号スイッチ', dial: 'ダイヤル', arrow: 'やじるし', fuse: '導火線' };

  const COLOR = { r: '赤', b: '青', y: '黄', g: '緑', w: '白', k: '黒' };
  const FOUR = ['r', 'b', 'y', 'g'];
  const MARKS = ['star', 'moon', 'sun'];
  const MARK_NAME = { star: 'ほし', moon: 'つき', sun: 'たいよう' };
  const NUMS = ['①', '②', '③', '④', '⑤'];
  const LETTERS = ['ア', 'イ', 'ウ', 'エ', 'オ'];
  const EVEN_TEXT = '0・2・4・6・8';
  const ODD_TEXT = '1・3・5・7・9';

  /* ── しかけの決まり（説明書もここから作る） ── */
  // コード: シールの色 × 番号の最後の数字 [偶数, 奇数] → 切るコードの行き先（ア〜オの番号）
  const CORD_TABLE = { r: [2, 0], b: [4, 1], y: [0, 3], g: [1, 2] };

  // 記号スイッチ: 記号（0〜11）ごとの、スイッチを上にする条件
  const GLYPH_RULES = [
    { text: 'いつも上', up: () => true },
    { text: 'いつも下', up: () => false },
    { text: 'ねじが2本か4本なら上。3本か5本なら下', up: (c) => c.screws % 2 === 0 },
    { text: 'シールが赤か黄なら上。青か緑なら下', up: (c) => c.seal === 'r' || c.seal === 'y' },
    { text: '番号の最後の数字が ' + ODD_TEXT + ' なら上。ちがえば下', up: (c) => !c.even },
    { text: 'ふたの中の印が「ほし」なら下。ちがえば上', up: (c) => c.mark !== 'star' },
    { text: 'シールが青なら上。ちがえば下', up: (c) => c.seal === 'b' },
    { text: 'ねじが4本か5本なら上。2本か3本なら下', up: (c) => c.screws >= 4 },
    { text: 'ふたの中の印が「つき」なら上。ちがえば下', up: (c) => c.mark === 'moon' },
    { text: '番号の最後の数字が ' + EVEN_TEXT + ' なら上。ちがえば下', up: (c) => c.even },
    { text: 'シールが緑なら下。ちがえば上', up: (c) => c.seal !== 'g' },
    { text: 'ふたの中の印が「たいよう」なら上。ちがえば下', up: (c) => c.mark === 'sun' },
  ];
  const GLYPHS = GLYPH_RULES.length;

  // ダイヤル: いちばん左のランプの色 × [3つともちがう色, 2つが同じ色, 3つとも同じ色] → 合わせる数字
  const DIAL_TABLE = { r: [3, 6, 1], b: [5, 2, 8], y: [7, 4, 2], g: [1, 8, 5] };
  const DIAL_CATS = ['3つとも ちがう色', '2つが同じ色', '3つとも同じ色'];

  // やじるし: 形ごとの4回の順（U上・D下・L左・R右）と、色ごとの読み方
  const SHAPES = ['circle', 'triangle', 'square', 'diamond'];
  const SHAPE_NAME = { circle: 'まる', triangle: 'さんかく', square: 'しかく', diamond: 'ひしがた' };
  const ARROW_BASE = { circle: 'URDR', triangle: 'LLUD', square: 'DURL', diamond: 'RDDU' };
  const DIR_NAME = { U: '上', D: '下', L: '左', R: '右' };
  const ARROW_COLOR_TEXT = {
    r: 'そのままの順で押す',
    b: 'うしろから読んで押す（4つめ → 1つめ）',
    y: '上と下を入れかえて押す（左と右はそのまま）',
    g: '左と右を入れかえて押す（上と下はそのまま）',
  };

  // 導火線: 火の色 × ふたの中の印 → 押すつまみ（0 △・1 ○・2 □）
  const FUSE_TABLE = {
    r: { star: 0, moon: 2, sun: 1 },
    b: { star: 1, moon: 0, sun: 2 },
    y: { star: 2, moon: 1, sun: 0 },
    g: { star: 1, moon: 2, sun: 0 },
  };
  const KNOBS = ['△', '○', '□'];
  const FUSE_FIRST = 30000;    // はじめて火がつくまで
  const FUSE_PERIOD = 45000;   // 火がつく間かく
  const FUSE_WINDOW = 20000;   // 火がついてから、止めるまでの時間
  const FUSE_CYCLES = 16;

  /* ── くじ ── */
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  function shuffle(r, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  const keyOf = (slot) => 's' + slot;

  /* ── しかけを作る・正解を出す ── */
  function cordSol(m, c) {
    const letter = CORD_TABLE[c.seal][c.even ? 0 : 1];
    let i = m.dest.indexOf(letter);
    // 黒いコードは切らない。かわりに①（①が黒なら⑤）
    if (m.colors[i] === 'k') i = m.colors[0] === 'k' ? 4 : 0;
    return i;
  }
  const glyphSol = (m, c) => m.glyphs.map((g) => GLYPH_RULES[g].up(c));
  function dialCat(lamps) {
    const n = new Set(lamps).size;
    return n === 3 ? 0 : n === 2 ? 1 : 2;
  }
  function dialSol(m, c) {
    const base = DIAL_TABLE[m.lamps[0]][dialCat(m.lamps)];
    return c.mark === 'moon' ? ((base - 1 + 4) % 8) + 1 : base;
  }
  function arrowSeq(shape, color) {
    let s = ARROW_BASE[shape].split('');
    if (color === 'b') s = s.reverse();
    if (color === 'y') s = s.map((d) => (d === 'U' ? 'D' : d === 'D' ? 'U' : d));
    if (color === 'g') s = s.map((d) => (d === 'L' ? 'R' : d === 'R' ? 'L' : d));
    return s.join('');
  }

  function makeModule(r, type, c) {
    if (type === 'cord') {
      const m = { type, colors: shuffle(r, ['r', 'b', 'y', 'w', 'k']), dest: shuffle(r, [0, 1, 2, 3, 4]) };
      m.sol = cordSol(m, c);
      return m;
    }
    if (type === 'glyph') {
      for (;;) {
        const m = { type, glyphs: shuffle(r, GLYPH_RULES.map((_, i) => i)).slice(0, 4) };
        m.sol = glyphSol(m, c);
        // はじめは4つとも下。なにもしないで合ってしまう組は使わない
        if (m.sol.some(Boolean)) return m;
      }
    }
    if (type === 'dial') {
      const m = { type, lamps: [pick(r, FOUR), pick(r, FOUR), pick(r, FOUR)] };
      m.sol = dialSol(m, c);
      m.start = ((m.sol - 1 + 1 + Math.floor(r() * 7)) % 8) + 1;   // 正解とちがう位置から
      return m;
    }
    const m = { type: 'arrow', shape: pick(r, SHAPES), color: pick(r, FOUR) };
    m.sol = arrowSeq(m.shape, m.color);
    return m;
  }

  // 爆弾を作る。slow（時間をはからない）のときは導火線を付けない
  function makeBomb(seed, level, slow) {
    const L = LEVELS[level] || LEVELS.normal;
    const r = rng(seed);
    const serial = String(1000 + Math.floor(r() * 9000));
    const clues = { seal: pick(r, FOUR), serial, even: Number(serial[3]) % 2 === 0, screws: 2 + Math.floor(r() * 4), mark: pick(r, MARKS) };
    const types = shuffle(r, TYPES).slice(0, Math.min(L.mods, TYPES.length));
    while (types.length < L.mods) types.push(pick(r, TYPES));
    const order = shuffle(r, [0, 1, 2, 3, 4, 5]);
    const slots = [null, null, null, null, null, null];
    types.forEach((type, i) => { slots[order[i]] = makeModule(r, type, clues); });
    let fuse = null;
    if (L.fuse && !slow) {
      fuse = { slot: order[types.length], flames: Array.from({ length: FUSE_CYCLES }, () => pick(r, FOUR)) };
      slots[fuse.slot] = { type: 'fuse' };
    }
    return { clues, slots, fuse, level: LEVELS[level] ? level : 'normal' };
  }
  const regularSlots = (bomb) => bomb.slots.map((m, i) => (m && m.type !== 'fuse' ? i : -1)).filter((i) => i >= 0);
  const solvedCount = (bomb, G) => regularSlots(bomb).filter((i) => G.ok[keyOf(i)]).length;

  /* ── 進み具合（ルームに置く形と同じ欄） ──
     t: のこり時間 { left: ミリ秒, at: その時刻, rate: へる速さ }。まちがえるたびに rate が上がる。
     x: まちがいの数・ok: 解除したしかけ・m: しかけごとの途中の様子・fz: 済んだ導火線の回数・out: 'safe' | 'boom' */
  function newState(level, slow, now) {
    const L = LEVELS[level] || LEVELS.normal;
    return { startAt: now, t: slow ? null : { left: L.sec * 1000, at: now, rate: 1 }, x: 0, ok: {}, m: {}, fz: 0, out: null, why: null, endAt: null };
  }
  function clone(G) {
    const m = {};
    Object.keys(G.m).forEach((k) => { m[k] = Object.assign({}, G.m[k]); });
    return { startAt: G.startAt, t: G.t ? Object.assign({}, G.t) : null, x: G.x, ok: Object.assign({}, G.ok), m, fz: G.fz, out: G.out, why: G.why, endAt: G.endAt };
  }
  // のこり時間（ミリ秒）。時間をはからないときは null
  function leftMs(G, now) {
    if (!G.t) return null;
    if (G.out) return G.t.left;
    return G.t.left - Math.max(0, now - G.t.at) * G.t.rate;
  }
  const rateFor = (x) => 1 + 0.25 * x;
  function finish(G, out, why, now) {
    if (G.t) G.t = { left: Math.max(0, leftMs(G, now)), at: now, rate: G.t.rate };
    G.out = out;
    G.why = why || null;
    G.endAt = now;
  }
  function strike(G, now) {
    G.x += 1;
    if (G.t) G.t = { left: Math.max(0, leftMs(G, now)), at: now, rate: rateFor(G.x) };
    if (G.x >= MAX_STRIKES) finish(G, 'boom', 'strike', now);
  }

  // 導火線のいまの回（el: はじめてからのミリ秒）
  function fuseCycle(el) {
    if (el < FUSE_FIRST) return null;
    const k = Math.floor((el - FUSE_FIRST) / FUSE_PERIOD);
    const into = el - FUSE_FIRST - k * FUSE_PERIOD;
    return { k, into, active: into < FUSE_WINDOW };
  }
  // 火がついているときだけ { k, flame, left }
  function fuseInfo(bomb, G, now) {
    if (!bomb.fuse || G.out) return null;
    const c = fuseCycle(now - G.startAt);
    if (!c || !c.active || G.fz > c.k) return null;
    return { k: c.k, flame: bomb.fuse.flames[c.k % bomb.fuse.flames.length], left: FUSE_WINDOW - c.into };
  }

  // 解除する人の操作。a = { s: しかけの場所, k: 操作, v: 値 }。できない操作は null
  // 返す ev: 'ok'（途中）・'solved'・'strike'・'fuse-ok'
  function act(bomb, G0, a, now) {
    if (!a || G0.out) return null;
    const slot = a.s;
    const mod = bomb.slots[slot];
    if (!mod) return null;
    const key = keyOf(slot);
    const G = clone(G0);
    let ev = 'ok';
    if (mod.type === 'fuse') {
      const f = fuseInfo(bomb, G, now);
      if (!f || a.k !== 'knob' || ![0, 1, 2].includes(a.v)) return null;
      if (FUSE_TABLE[f.flame][bomb.clues.mark] === a.v) { G.fz = f.k + 1; ev = 'fuse-ok'; }
      else { strike(G, now); ev = 'strike'; }
      return { G, ev };
    }
    if (G.ok[key]) return null;
    const st = G.m[key] || {};
    let solved = false;
    if (mod.type === 'cord') {
      const cut = typeof st.c === 'string' && st.c ? st.c.split(',').map(Number) : [];
      if (a.k !== 'cut' || !Number.isInteger(a.v) || a.v < 0 || a.v > 4 || cut.includes(a.v)) return null;
      G.m[key] = { c: cut.concat([a.v]).join(',') };
      if (a.v === mod.sol) solved = true;
      else { strike(G, now); ev = 'strike'; }
    } else if (mod.type === 'glyph') {
      const bits = Number.isInteger(st.b) ? st.b : 0;
      if (a.k === 'tog') {
        if (!Number.isInteger(a.v) || a.v < 0 || a.v > 3) return null;
        G.m[key] = { b: bits ^ (1 << a.v) };
      } else if (a.k === 'chk') {
        if (mod.sol.every((up, i) => !!(bits & (1 << i)) === up)) solved = true;
        else { strike(G, now); ev = 'strike'; }
      } else return null;
    } else if (mod.type === 'dial') {
      const pos = Number.isInteger(st.p) ? st.p : mod.start;
      if (a.k === 'turn') {
        if (a.v !== 1 && a.v !== -1) return null;
        G.m[key] = { p: ((pos - 1 + a.v + 8) % 8) + 1 };
      } else if (a.k === 'chk') {
        if (pos === mod.sol) solved = true;
        else { strike(G, now); ev = 'strike'; }
      } else return null;
    } else if (mod.type === 'arrow') {
      const p = Number.isInteger(st.p) ? st.p : 0;
      if (a.k !== 'dir' || !DIR_NAME[a.v]) return null;
      if (mod.sol[p] === a.v) {
        if (p + 1 >= mod.sol.length) solved = true;
        else G.m[key] = { p: p + 1 };
      } else {
        G.m[key] = { p: 0 };
        strike(G, now);
        ev = 'strike';
      }
    } else return null;
    if (solved) {
      G.ok[key] = true;
      ev = 'solved';
      if (!G.out && solvedCount(bomb, G) >= regularSlots(bomb).length) finish(G, 'safe', null, now);
    }
    return { G, ev };
  }

  // 時間で起きること（導火線がまにあわなかった・時間が0）。変わらなければ null
  function tick(bomb, G0, now) {
    if (G0.out) return null;
    const G = clone(G0);
    let ev = null;
    if (bomb.fuse) {
      const c = fuseCycle(now - G.startAt);
      const ended = c ? (c.active ? c.k - 1 : c.k) : -1;
      if (ended >= G.fz) {
        G.fz = ended + 1;
        strike(G, now);
        ev = 'fuse-miss';
      }
    }
    if (!G.out && G.t && leftMs(G, now) <= 0) {
      finish(G, 'boom', 'time', now);
      ev = 'time';
    }
    return ev ? { G, ev } : null;
  }

  /* ── ルームに置く形 ── */
  function toRoom(G) {
    const out = { startAt: G.startAt, t: G.t ? { left: Math.round(G.t.left), at: G.t.at, rate: G.t.rate } : null, x: G.x, fz: G.fz, out: G.out || null, why: G.why || null, endAt: G.endAt || null };
    out.ok = Object.keys(G.ok).length ? Object.assign({}, G.ok) : null;
    out.m = Object.keys(G.m).length ? clone(G).m : null;
    return out;
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  // こわれた値は null
  function fromRoom(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const startAt = num(raw.startAt);
    if (startAt === null) return null;
    let t = null;
    if (raw.t != null) {
      if (typeof raw.t !== 'object') return null;
      const left = num(raw.t.left), at = num(raw.t.at), rate = num(raw.t.rate);
      if (left === null || at === null || rate === null || rate < 1 || rate > 3) return null;
      t = { left, at, rate };
    }
    const x = Number.isInteger(raw.x) && raw.x >= 0 && raw.x <= MAX_STRIKES ? raw.x : 0;
    const ok = {};
    const m = {};
    for (let i = 0; i < SLOTS; i++) {
      const k = keyOf(i);
      if (raw.ok && raw.ok[k] === true) ok[k] = true;
      const v = raw.m && raw.m[k];
      if (v && typeof v === 'object') {
        const s = {};
        if (typeof v.c === 'string' && /^[0-4](,[0-4]){0,4}$/.test(v.c)) s.c = v.c;
        if (Number.isInteger(v.b) && v.b >= 0 && v.b < 16) s.b = v.b;
        if (Number.isInteger(v.p) && v.p >= 0 && v.p <= 8) s.p = v.p;
        if (Object.keys(s).length) m[k] = s;
      }
    }
    const out = raw.out === 'safe' || raw.out === 'boom' ? raw.out : null;
    return { startAt, t, x, ok, m, fz: Number.isInteger(raw.fz) && raw.fz >= 0 ? raw.fz : 0, out, why: raw.why === 'time' || raw.why === 'strike' ? raw.why : null, endAt: num(raw.endAt) };
  }

  /* ── 役と説明書の配り方 ── */
  // 解除する人の席（ro: 「読むだけ」の人。みんな読むだけなら -1）
  function pickDefuser(ro, turn) {
    const cand = ro.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
    return cand.length ? cand[((turn % cand.length) + cand.length) % cand.length] : -1;
  }
  // この爆弾で使う説明書のページ
  function bombChapters(bomb) {
    const used = TYPES.filter((t) => bomb.slots.some((m) => m && m.type === t));
    if (bomb.fuse) used.push('fuse');
    return used;
  }
  // 読む人ごとのページ。split（分けて配る）で読む人が2人以上なら、1ページずつ順に配る（だれも0ページにならない）
  function deal(seed, bomb, readers, split) {
    const ch = bombChapters(bomb);
    const out = {};
    readers.forEach((i) => { out[i] = []; });
    if (!split || readers.length < 2) {
      readers.forEach((i) => { out[i] = ch.slice(); });
      return out;
    }
    const mixed = shuffle(rng((seed ^ 0x5bd1e995) >>> 0), ch);
    const n = Math.max(mixed.length, readers.length);
    for (let i = 0; i < n; i++) out[readers[i % readers.length]].push(mixed[i % mixed.length]);
    // 見やすいよう、ページの順は決まった順にそろえる
    readers.forEach((i) => { out[i].sort((a, b) => ch.indexOf(a) - ch.indexOf(b)); });
    return out;
  }

  /* ── 説明書（1行ずつ。lines の番号が「この行を見せる」で送る番号） ──
     p: 文・row: 条件（a）と止め方（b）。g は記号の番号、shape は形・note: ただし書き */
  function manual(id) {
    const P = (text) => ({ t: 'p', text });
    const R = (a, b, extra) => Object.assign({ t: 'row', a, b }, extra || {});
    const N = (text) => ({ t: 'note', text });
    if (id === 'clues') {
      return { id, title: '本体の手がかり', lines: [
        P('爆弾の本体に、手がかりが4つある。解除する人に、爆弾を回して見てもらおう。'),
        R('左の側面', 'シール（赤・青・黄・緑のどれか）'),
        R('右の側面', '4けたの番号（最後の数字を使う）'),
        R('上の面', 'ねじ（2〜5本。数を使う）'),
        R('底の面', 'ふた。開けると、印（ほし・つき・たいよう）がある'),
        N('まちがい3回か、時間が0で爆発する。まちがえるたびに、時間のへりかたが速くなる。'),
      ] };
    }
    if (id === 'cord') {
      const lines = [
        P('コードが5本。上の ①〜⑤ から出て、下の ア〜オ につながっている。切るのは1本だけ。'),
        P('シールの色と、番号の最後の数字で、切るコードの行き先が決まる。'),
      ];
      FOUR.forEach((s) => {
        lines.push(R('シールが' + COLOR[s] + ' ・ 最後の数字が ' + EVEN_TEXT, '「' + LETTERS[CORD_TABLE[s][0]] + '」につながるコードを切る'));
        lines.push(R('シールが' + COLOR[s] + ' ・ 最後の数字が ' + ODD_TEXT, '「' + LETTERS[CORD_TABLE[s][1]] + '」につながるコードを切る'));
      });
      lines.push(N('ただし、そのコードが黒いときは切らない。かわりに ① から出ているコードを切る（① が黒いときは ⑤）。'));
      return { id, title: TYPE_NAME.cord, lines };
    }
    if (id === 'glyph') {
      const lines = [
        P('記号が4つ。それぞれのスイッチを「上」か「下」にして、「たしかめる」を押す。'),
        P('記号には名前がない。どんな形か、言葉で伝えてもらおう。'),
      ];
      GLYPH_RULES.forEach((rule, g) => lines.push(R('', rule.text, { g })));
      return { id, title: TYPE_NAME.glyph, lines };
    }
    if (id === 'dial') {
      const lines = [
        P('ランプが3つと、1〜8のダイヤルがある。ダイヤルを合わせて「たしかめる」を押す。'),
        P('いちばん左のランプの色と、同じ色のランプがあるかで決まる。'),
      ];
      FOUR.forEach((s) => DIAL_CATS.forEach((cat, i) => lines.push(R('いちばん左が' + COLOR[s] + ' ・ ' + cat, DIAL_TABLE[s][i] + ' に合わせる'))));
      lines.push(N('ただし、ふたの中の印が「つき」のときは、ちょうど反対がわの数字に合わせる（1↔5・2↔6・3↔7・4↔8）。'));
      return { id, title: TYPE_NAME.dial, lines };
    }
    if (id === 'arrow') {
      const lines = [
        P('色のついた形が1つ出ている。やじるしのボタンを4回、決まった順に押す。まちがえると、はじめからやりなおし。'),
        P('まず形で順を調べ、次に色で読み方を決める。'),
      ];
      SHAPES.forEach((s) => lines.push(R(SHAPE_NAME[s], ARROW_BASE[s].split('').map((d) => DIR_NAME[d]).join(' → '), { shape: s })));
      FOUR.forEach((c) => lines.push(R('形が' + COLOR[c], ARROW_COLOR_TEXT[c])));
      return { id, title: TYPE_NAME.arrow, lines };
    }
    const lines = [
      P('ときどき、導火線に火がつく。20秒のうちに、正しいつまみを1つ押す。まにあわないと、まちがい1回になる。'),
      P('火の色と、底のふたの中の印で決まる。'),
    ];
    FOUR.forEach((c) => MARKS.forEach((mk) => lines.push(R('火が' + COLOR[c] + ' ・ 印が「' + MARK_NAME[mk] + '」', KNOBS[FUSE_TABLE[c][mk]] + ' のつまみを押す'))));
    return { id: 'fuse', title: TYPE_NAME.fuse, lines };
  }
  const MANUAL_IDS = ['clues', 'cord', 'glyph', 'dial', 'arrow', 'fuse'];
  // 送られた行を1文にする（ひとことの欄に出す）。ない行は ''
  function lineText(id, n) {
    if (!MANUAL_IDS.includes(id)) return '';
    const line = manual(id).lines[n];
    if (!line) return '';
    if (line.t !== 'row') return line.text;
    return (line.a ? line.a + ' → ' : '') + line.b;
  }

  return {
    MIN_PLAYERS, MAX_PLAYERS, MAX_STRIKES, SLOTS, LEVELS, LEVEL_KEYS, TYPES, TYPE_NAME,
    COLOR, FOUR, MARKS, MARK_NAME, NUMS, LETTERS, SHAPES, SHAPE_NAME, DIR_NAME, KNOBS, GLYPHS,
    CORD_TABLE, GLYPH_RULES, DIAL_TABLE, ARROW_BASE, FUSE_TABLE, FUSE_FIRST, FUSE_PERIOD, FUSE_WINDOW,
    MANUAL_IDS, rng, keyOf, makeBomb, regularSlots, solvedCount, newState, leftMs, fuseInfo, act, tick,
    toRoom, fromRoom, pickDefuser, bombChapters, deal, manual, lineText, arrowSeq, dialCat,
  };
});
