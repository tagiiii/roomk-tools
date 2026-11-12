/* そろってゴール（試作） — ステージと動きのルール
   画面と通信に触らない。ブラウザでは window.SorotteEngine、node では module.exports。
   状態は JSON にできる値だけで持つ（本体にするときは、そのままルームに置ける形）。

   ステージは spec で指す:
     { kind: 'fixed', index }            れんしゅう（手で作った2人用の3つ）
     { kind: 'gen', level, n, seed }     おまかせ（むずかしさ・人数・くじの番号から、その場で作る。同じ spec なら同じステージ）

   マスの記号:
     #  かべ          .  ゆか          G  ゴール
     1 2  はじめの場所（れんしゅうのステージだけ。おまかせは、作るときに場所を別に持つ）
     a〜e  スイッチ   A〜E  とびら（同じしるしのスイッチに、人か箱が乗っている間だけ開く）
     O  重い箱（うしろからもう1人が押すと動く）
     k  カギ          L  かぎつきのとびら（カギを持った人が入ると開いたままになる）
     p q r … z o  橋（順に、1・2・3 … 11・12人目だけ渡れる）
     *  星（とってもとらなくてもいい。とった数がクリアのときに出る） */
(function (root) {
  'use strict';

  const FIXED = [
    {
      name: 'とびら',
      hint: 'スイッチに乗っている間だけ、同じしるしのとびらが開く。',
      rows: [
        '#############',
        '#1..#...#..G#',
        '#...A...B...#',
        '#2a.#ab.#b.G#',
        '#############',
      ],
    },
    {
      name: '重い箱',
      hint: '重い箱は、うしろからもう1人が押すと動く。箱をスイッチに乗せると、とびらが開いたままになる。',
      rows: [
        '#############',
        '#1....#...#G#',
        '#.....O.a.A.#',
        '#2....#...#G#',
        '#############',
      ],
    },
    {
      name: 'カギと橋',
      hint: '橋は、同じ番号の人だけ渡れる。カギを持つと、かぎつきのとびらを開けられる。',
      rows: [
        '################',
        '#1..p...A.k.L.G#',
        '#...########.b.#',
        '#2..q..a..B...G#',
        '################',
      ],
    },
  ];

  // おまかせのむずかしさ。slots は部屋のならび（1つ前の部屋のとなりに次の部屋。あいだに「関門」が1つ）
  // layouts はステージ番号ごとにくじで1つえらぶ
  const LEVELS = {
    easy: {
      label: 'やさしい',
      stars: 'floor',
      layouts: [
        [[0, 0], [1, 0], [2, 0]],
        [[0, 0], [1, 0], [1, 1]],
        [[0, 0], [0, 1], [1, 1]],
      ],
    },
    normal: {
      label: 'ふつう',
      stars: 'mix',
      layouts: [
        [[0, 0], [1, 0], [1, 1], [0, 1]],
        [[0, 0], [0, 1], [1, 1], [1, 0]],
        [[0, 0], [1, 0], [2, 0], [2, 1]],
        [[0, 0], [1, 0], [1, 1], [2, 1]],
      ],
    },
    hard: {
      label: 'むずかしい',
      stars: 'mix',
      layouts: [
        [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]],
        [[0, 0], [0, 1], [1, 1], [1, 0], [2, 0], [2, 1]],
        [[0, 1], [0, 0], [1, 0], [1, 1], [2, 1], [2, 0]],
        [[0, 0], [1, 0], [1, 1], [2, 1], [2, 0]],
      ],
    },
  };
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 12;
  const STARS = 3;
  // 部屋の中の広さ（人数が多いほど広い。4人まで 5×5・8人まで 7×7・12人まで 9×9）
  const roomSize = (n) => (n <= 4 ? 5 : n <= 8 ? 7 : 9);
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const SWITCHES = ['a', 'b', 'c', 'd', 'e'];
  const SWITCH_OF = { A: 'a', B: 'b', C: 'c', D: 'd', E: 'e' };
  const BRIDGES = 'pqrstuvwxyzo'.split('');
  const BRIDGE_OF = {};
  BRIDGES.forEach((ch, i) => { BRIDGE_OF[ch] = i; });

  // seed つきの乱数（同じ番号なら、どの端末でも同じステージになる）
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
  function shuffle(rng, arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ── おまかせステージを作る ──
     部屋を一列につなぎ、部屋と部屋のあいだに関門を1つずつ置く。関門はどれも、作り方から必ず通れる:
       relay   とびら。手前の部屋と先の部屋に、同じしるしのスイッチ（1人がおさえて通し、先でおさえ返す）
       relayJ  relay の手前のスイッチが、j 人目だけ渡れる橋の先にある
       key     かぎつきのとびら。カギは手前の部屋に置いてある
       keyJ    カギが、j 人目だけ渡れる橋の先にある
       box     とびら。手前の部屋の重い箱を、2人で押してスイッチに乗せる
       pair    とびら。同じしるしのスイッチを2つ同時におさえている間だけ開く（4人から。手前に2つ・先に2つ）
     部屋の中は、列・行とも 0〜R-1（R は部屋の広さ）。関門はかべのまん中にあり、そのとなりのマスには物を置かない。
     箱の通り道は 1 行目か R-2 行目をまるごと使う。置くだけのスイッチ・カギ・星は、それ以外の行。 */
  function generate(level, n, seed) {
    const L = LEVELS[level];
    const ROOM = roomSize(n);
    const M = (ROOM - 1) / 2;   // まん中
    const E1 = ROOM - 1;        // はし
    const rng = makeRng((seed * 2654435761 + n * 97 + level.length * 131) >>> 0);
    const slots = pick(rng, L.layouts);
    const cols = Math.max(...slots.map((s) => s[0])) + 1;
    const rowsN = Math.max(...slots.map((s) => s[1])) + 1;
    const W = cols * (ROOM + 1) + 1;
    const H = rowsN * (ROOM + 1) + 1;
    const grid = Array.from({ length: H }, () => new Array(W).fill('#'));
    const rooms = slots.map(([sx, sy]) => ({ ox: 1 + sx * (ROOM + 1), oy: 1 + sy * (ROOM + 1), used: new Set() }));
    const id = (x, y) => x + ',' + y;
    const put = (room, x, y, ch) => { grid[room.oy + y][room.ox + x] = ch; room.used.add(id(x, y)); };
    const free = (room, x, y) => !room.used.has(id(x, y));
    rooms.forEach((room) => {
      for (let y = 0; y < ROOM; y += 1) for (let x = 0; x < ROOM; x += 1) grid[room.oy + y][room.ox + x] = '.';
    });

    // 関門のマス（かべの中の1マス）と、そのとなりのマスをあけておく
    const gates = [];
    for (let i = 0; i < rooms.length - 1; i += 1) {
      const dx = slots[i + 1][0] - slots[i][0];
      const dy = slots[i + 1][1] - slots[i][1];
      const A = rooms[i];
      const B = rooms[i + 1];
      const gx = A.ox + (dx === 1 ? ROOM : dx === -1 ? -1 : M);
      const gy = A.oy + (dy === 1 ? ROOM : dy === -1 ? -1 : M);
      A.used.add(id(dx === 1 ? E1 : dx === -1 ? 0 : M, dy === 1 ? E1 : dy === -1 ? 0 : M));
      B.used.add(id(dx === 1 ? 0 : dx === -1 ? E1 : M, dy === 1 ? 0 : dy === -1 ? E1 : M));
      gates.push({ A, B, gx, gy });
    }

    // はじめの部屋: まん中の行から順にならぶ（箱の通り道の行と、出口のとなりの列は使わない）。おわりの部屋: ゴールを人数ぶん
    const first = rooms[0];
    const starts = [];
    const startRows = [];
    for (let k = 0; startRows.length < ROOM - 4; k += 1) {
      [M - k, M + k].forEach((y) => { if (y >= 2 && y <= ROOM - 3 && !startRows.includes(y)) startRows.push(y); });
    }
    startRows.forEach((y) => {
      for (let x = 0; x < E1 && starts.length < n; x += 1) { first.used.add(id(x, y)); starts.push([first.ox + x, first.oy + y]); }
    });
    for (let x = 0; x < ROOM; x += 1) first.used.add(id(x, M));
    const last = rooms[rooms.length - 1];
    const goals = [];
    for (let y = 1; y < E1; y += 2) for (let x = 1; x < E1; x += 2) goals.push([x, y]);
    goals.slice(0, n).forEach(([x, y]) => put(last, x, y, 'G'));

    // 置くだけ: 箱の通り道（1 行目・R-2 行目）でない行の、あいているマス
    function plain(room, ch) {
      const cells = [];
      for (let y = 0; y < ROOM; y += 1) {
        if (y === 1 || y === ROOM - 2) continue;
        for (let x = 0; x < ROOM; x += 1) if (free(room, x, y)) cells.push([x, y]);
      }
      if (!cells.length) return false;
      const [x, y] = pick(rng, cells);
      put(room, x, y, ch);
      return true;
    }
    // すみに置き、j 人目だけ渡れる橋でふさぐ（すみ・橋・かべの3マス）
    function nook(room, ch, j) {
      for (const [cx, cy] of shuffle(rng, [[0, 0], [E1, 0], [0, E1], [E1, E1]])) {
        const bx = cx === 0 ? 1 : E1 - 1;
        const wy = cy === 0 ? 1 : E1 - 1;
        if (!free(room, cx, cy) || !free(room, bx, cy) || !free(room, cx, wy)) continue;
        put(room, cx, cy, ch);
        put(room, bx, cy, BRIDGES[j]);
        put(room, cx, wy, '#');
        return true;
      }
      return false;
    }
    // 重い箱の通り道: 1 行目か R-2 行目をまるごと。箱はまん中、スイッチははし
    function lane(room, sw) {
      for (const y of shuffle(rng, [1, ROOM - 2])) {
        let ok = true;
        for (let x = 0; x < ROOM; x += 1) if (!free(room, x, y)) ok = false;
        if (!ok) continue;
        for (let x = 0; x < ROOM; x += 1) room.used.add(id(x, y));
        grid[room.oy + y][room.ox + M] = 'O';
        grid[room.oy + y][room.ox + (rng() < 0.5 ? 0 : E1)] = sw;
        return true;
      }
      return false;
    }

    // 関門の種類をえらぶ
    let kinds;
    if (level === 'easy') kinds = shuffle(rng, ['relay', 'key']);
    else if (level === 'normal') kinds = shuffle(rng, ['relay', 'relayJ', 'keyJ', 'box'].concat(n >= 4 ? ['pair'] : [])).slice(0, 3);
    else kinds = shuffle(rng, ['box', 'relayJ', 'keyJ', pick(rng, ['relay', 'box']), pick(rng, n >= 4 ? ['pair', 'pair', 'relayJ'] : ['relayJ', 'keyJ'])]);

    let color = 0;
    const used = [];
    const need = {};
    gates.forEach((g, i) => {
      let kind = kinds[i];
      if (kind === 'key' || kind === 'keyJ') {
        grid[g.gy][g.gx] = 'L';
        if (!(kind === 'keyJ' && nook(g.A, 'k', Math.floor(rng() * n)))) { plain(g.A, 'k'); if (kind === 'keyJ') kind = 'key'; }
      } else {
        const sw = SWITCHES[color];
        color += 1;
        grid[g.gy][g.gx] = sw.toUpperCase();
        if (kind === 'box' && !lane(g.A, sw)) kind = 'relay';
        if (kind === 'relayJ' && !nook(g.A, sw, Math.floor(rng() * n))) kind = 'relay';
        if (kind === 'pair') { need[sw] = 2; plain(g.A, sw); plain(g.B, sw); }
        if (kind === 'relay' || kind === 'pair') plain(g.A, sw);
        if (kind !== 'box') plain(g.B, sw);
      }
      used.push(kind);
    });

    // 星を3つ。部屋をかえて置く。ふつう・むずかしいは、橋の先にも置く
    shuffle(rng, rooms).slice(0, STARS).forEach((room) => {
      if (!(L.stars === 'mix' && rng() < 0.5 && nook(room, '*', Math.floor(rng() * n)))) plain(room, '*');
    });

    return { rows: grid.map((r) => r.join('')), kinds: used, starts, need };
  }

  /* ── ステージの動かない部分（かべ・ゆか・スイッチ・とびら・橋・ゴール）。人・箱・カギ・星は抜いて、ゆかにする ── */
  function parse(rows) {
    const h = rows.length;
    const w = rows[0].length;
    const tiles = [];
    const starts = [];
    const boxes = [];
    const keys = [];
    const stars = [];
    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error('ステージの行の長さがそろっていない');
      row.split('').forEach((ch, x) => {
        if (ch === '1' || ch === '2') { starts[Number(ch) - 1] = [x, y]; tiles.push('.'); }
        else if (ch === 'O') { boxes.push([x, y]); tiles.push('.'); }
        else if (ch === 'k') { keys.push([x, y]); tiles.push('.'); }
        else if (ch === '*') { stars.push([x, y]); tiles.push('.'); }
        else tiles.push(ch);
      });
    });
    return { w, h, tiles, starts, boxes, keys, stars };
  }

  const cache = {};
  const validSpec = (spec) => !!spec && (
    (spec.kind === 'fixed' && Number.isInteger(spec.index) && spec.index >= 0 && spec.index < FIXED.length)
    || (spec.kind === 'gen' && !!LEVELS[spec.level] && Number.isInteger(spec.n) && spec.n >= MIN_PLAYERS && spec.n <= MAX_PLAYERS && Number.isInteger(spec.seed) && spec.seed >= 0));
  const specKey = (spec) => (spec.kind === 'fixed' ? 'f' + spec.index : 'g' + spec.level + ':' + spec.n + ':' + spec.seed);
  function staticOf(spec) {
    const key = specKey(spec);
    if (!cache[key]) {
      if (spec.kind === 'fixed') {
        const st = FIXED[spec.index];
        cache[key] = Object.assign(parse(st.rows), { name: st.name, hint: st.hint, rows: st.rows, need: {} });
      } else {
        const g = generate(spec.level, spec.n, spec.seed);
        cache[key] = Object.assign(parse(g.rows), { name: LEVELS[spec.level].label, hint: '', rows: g.rows, kinds: g.kinds, starts: g.starts, need: g.need });
      }
    }
    return cache[key];
  }

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const tileAt = (S, x, y) => {
    const T = staticOf(S.spec);
    return x < 0 || y < 0 || x >= T.w || y >= T.h ? '#' : T.tiles[y * T.w + x];
  };
  const at = (list, x, y) => list.findIndex((p) => p[0] === x && p[1] === y);

  function create(spec) {
    const T = staticOf(spec);
    return {
      spec: clone(spec),
      players: T.starts.map(([x, y]) => ({ x, y, key: false })),
      boxes: clone(T.boxes),
      keys: clone(T.keys),
      stars: clone(T.stars),
      got: 0,          // とった星の数
      open: [],        // 開けた、かぎつきのとびら [x, y]
      cleared: false,
      rev: 0,          // 動くたびに1増える（歩数）
    };
  }

  // しるし c のスイッチが、要る数だけ（ふつうは1つ。pair の関門は2つ）、人か箱でおさえられているか
  function held(S, c) {
    const T = staticOf(S.spec);
    const on = (x, y) => T.tiles[y * T.w + x] === c;
    const count = S.players.filter((p) => on(p.x, p.y)).length + S.boxes.filter((b) => on(b[0], b[1])).length;
    return count >= (T.need[c] || 1);
  }

  // とびらが開いているか（画面でも使う）
  function doorOpen(S, x, y) {
    const t = tileAt(S, x, y);
    if (SWITCH_OF[t]) return held(S, SWITCH_OF[t]);
    if (t === 'L') return at(S.open, x, y) >= 0;
    return true;
  }

  // 箱を置けるマス
  function boxCanEnter(S, x, y) {
    const t = tileAt(S, x, y);
    if (!(t === '.' || t === 'G' || SWITCHES.includes(t))) return false;
    return at(S.boxes, x, y) < 0 && !S.players.some((p) => p.x === x && p.y === y) && at(S.keys, x, y) < 0 && at(S.stars, x, y) < 0;
  }

  // who 番の人が dir へ1マス動く。動けないときは同じ状態を返す
  function move(S0, who, dir) {
    const d = DIRS[dir];
    const me = S0.players[who];
    if (!d || !me || S0.cleared) return S0;
    const [dx, dy] = d;
    const tx = me.x + dx;
    const ty = me.y + dy;
    const t = tileAt(S0, tx, ty);
    if (t === '#') return S0;
    if (S0.players.some((p, i) => i !== who && p.x === tx && p.y === ty)) return S0;
    if (BRIDGE_OF[t] !== undefined && BRIDGE_OF[t] !== who) return S0;
    if (SWITCH_OF[t] && !held(S0, SWITCH_OF[t])) return S0;
    if (t === 'L' && at(S0.open, tx, ty) < 0 && !me.key) return S0;

    const S = clone(S0);
    const p = S.players[who];
    const bi = at(S.boxes, tx, ty);
    if (bi >= 0) {
      // 重い箱: うしろ（進む向きの反対どなり）にもう1人いるときだけ動く。うしろの人もいっしょに1マス進む
      const helper = S.players.findIndex((q, i) => i !== who && q.x === me.x - dx && q.y === me.y - dy);
      if (helper < 0 || !boxCanEnter(S0, tx + dx, ty + dy)) return S0;
      S.boxes[bi] = [tx + dx, ty + dy];
      S.players[helper].x = me.x;
      S.players[helper].y = me.y;
    }
    p.x = tx;
    p.y = ty;
    if (t === 'L' && at(S.open, tx, ty) < 0) { S.open.push([tx, ty]); p.key = false; }
    const ki = at(S.keys, tx, ty);
    if (ki >= 0 && !p.key) { S.keys.splice(ki, 1); p.key = true; }
    const si = at(S.stars, tx, ty);
    if (si >= 0) { S.stars.splice(si, 1); S.got += 1; }
    S.cleared = S.players.every((q) => tileAt(S, q.x, q.y) === 'G');
    S.rev += 1;
    return S;
  }

  const api = {
    FIXED, LEVELS, MIN_PLAYERS, MAX_PLAYERS, STARS, DIRS, SWITCHES, SWITCH_OF, BRIDGES, BRIDGE_OF,
    roomSize, makeRng, generate, validSpec, specKey, staticOf, create, tileAt, held, doorOpen, move,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SorotteEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
