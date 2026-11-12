/* そろってゴール — ステージと動きのルール
   画面と通信に触らない。ブラウザでは window.SorotteEngine、node では module.exports。
   状態は JSON にできる値だけで持つ。ルームには toRoom の形で、さわった所だけ書けるように分けて置く。

   ステージは spec で指す:
     { kind: 'fixed', index }            手で作った2人用の3つ（ルールのテストで使う。画面からは選べない）
     { kind: 'gen', level, n, seed }     おまかせ（むずかしさ・人数・くじの番号から、その場で作る。同じ spec なら同じステージ）

   マスの記号:
     #  かべ          .  ゆか          G  ゴール
     1 2  はじめの場所（れんしゅうのステージだけ。おまかせは、作るときに場所を別に持つ）
     a b c d e f h i  スイッチ   A B C D E F H I  とびら（同じしるしのスイッチに、人か箱が乗っている間だけ開く。g・G はゴールとまぎれるので使わない）
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
      boxSw: ['a'],
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
      stars: 'door',
      layouts: [
        [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]],
        [[0, 0], [0, 1], [1, 1], [1, 0], [2, 0], [2, 1]],
        [[0, 1], [0, 0], [1, 0], [1, 1], [2, 1], [2, 0]],
        [[0, 0], [1, 0], [1, 1], [2, 1], [2, 0]],
      ],
    },
    // げきむず: 部屋6つ。どの関門も、2人以上で力を合わせないと通れない。星もとびらの先
    expert: {
      label: 'げきむず',
      stars: 'door',
      layouts: [
        [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1]],
        [[0, 0], [0, 1], [1, 1], [1, 0], [2, 0], [2, 1]],
        [[0, 1], [0, 0], [1, 0], [1, 1], [2, 1], [2, 0]],
      ],
    },
  };
  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 12;
  const STARS = 3;
  // 部屋の中の広さ（人数が多いほど広い。4人まで 5×5・8人まで 7×7・12人まで 9×9）
  const roomSize = (n) => (n <= 4 ? 5 : n <= 8 ? 7 : 9);
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const SWITCHES = 'abcdefhi'.split('');
  const SWITCH_OF = {};
  SWITCHES.forEach((c) => { SWITCH_OF[c.toUpperCase()] = c; });
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
       keyDoor かぎつきのとびら。カギは、べつのとびらの先のすみにある。1人がスイッチをおさえている間に、もう1人がとりに行く
     星も、むずかしい・げきむずでは、とびらの先のすみに置く（1人がおさえて、もう1人がとる）。
     しるしは8つ。使いきったら、とびらの先に置くのをやめて、橋の先か、ゆかに置く。
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
    // すみに置き、入口を gate（j 人目だけ渡れる橋か、とびら）でふさぐ（すみ・入口・かべの3マス）
    function nook(room, ch, gate) {
      for (const [cx, cy] of shuffle(rng, [[0, 0], [E1, 0], [0, E1], [E1, E1]])) {
        const bx = cx === 0 ? 1 : E1 - 1;
        const wy = cy === 0 ? 1 : E1 - 1;
        if (!free(room, cx, cy) || !free(room, bx, cy) || !free(room, cx, wy)) continue;
        put(room, cx, cy, ch);
        put(room, bx, cy, gate);
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
    const big = n >= 4;
    if (level === 'easy') kinds = shuffle(rng, ['relay', 'key']);
    else if (level === 'normal') kinds = shuffle(rng, ['relay', 'relayJ', 'keyJ', 'box', 'keyDoor'].concat(big ? ['pair'] : [])).slice(0, 3);
    else if (level === 'hard') kinds = shuffle(rng, ['box', 'keyDoor', 'relayJ', pick(rng, ['box', 'keyJ']), pick(rng, big ? ['pair', 'pair', 'keyDoor'] : ['relayJ', 'keyDoor'])]);
    else kinds = shuffle(rng, ['box', 'box', 'keyDoor', 'keyDoor', big ? 'pair' : 'relayJ']);

    let color = 0;
    const nextColor = () => { const sw = SWITCHES[color]; if (sw) color += 1; return sw || null; };
    const bridgeOf = () => BRIDGES[Math.floor(rng() * n)];
    // とびらの先のすみに置く（しるしが残っていて、すみと、スイッチを置くマスがあるとき）
    function doorNook(room, ch) {
      if (color >= SWITCHES.length) return false;
      const sw = SWITCHES[color];
      if (!nook(room, ch, sw.toUpperCase())) return false;
      color += 1;
      plain(room, sw);
      return true;
    }
    const used = [];
    const need = {};
    const boxSw = [];
    gates.forEach((g, i) => {
      let kind = kinds[i];
      if (kind === 'key' || kind === 'keyJ' || kind === 'keyDoor') {
        grid[g.gy][g.gx] = 'L';
        if (kind === 'keyDoor' && !doorNook(g.A, 'k')) kind = 'keyJ';
        if (kind === 'keyJ' && !nook(g.A, 'k', bridgeOf())) kind = 'key';
        if (kind === 'key') plain(g.A, 'k');
      } else {
        const sw = nextColor();
        grid[g.gy][g.gx] = sw.toUpperCase();
        if (kind === 'box' && !lane(g.A, sw)) kind = 'relay';
        if (kind === 'box') boxSw.push(sw);
        if (kind === 'relayJ' && !nook(g.A, sw, bridgeOf())) kind = 'relay';
        if (kind === 'pair') { need[sw] = 2; plain(g.A, sw); plain(g.B, sw); }
        if (kind === 'relay' || kind === 'pair') plain(g.A, sw);
        if (kind !== 'box') plain(g.B, sw);
      }
      used.push(kind);
    });

    // 星を3つ。部屋をかえて置く。ふつうは橋の先にも、むずかしい・げきむずは、とびらの先（だめなら橋の先）に置く
    shuffle(rng, rooms).slice(0, STARS).forEach((room) => {
      if (L.stars === 'door' && doorNook(room, '*')) return;
      if (L.stars !== 'floor' && (L.stars === 'door' || rng() < 0.5) && nook(room, '*', bridgeOf())) return;
      plain(room, '*');
    });

    return { rows: grid.map((r) => r.join('')), kinds: used, starts, need, boxSw };
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
    const locks = [];
    rows.forEach((row, y) => {
      if (row.length !== w) throw new Error('ステージの行の長さがそろっていない');
      row.split('').forEach((ch, x) => {
        if (ch === '1' || ch === '2') { starts[Number(ch) - 1] = [x, y]; tiles.push('.'); }
        else if (ch === 'O') { boxes.push([x, y]); tiles.push('.'); }
        else if (ch === 'k') { keys.push([x, y]); tiles.push('.'); }
        else if (ch === '*') { stars.push([x, y]); tiles.push('.'); }
        else if (ch === 'L') { locks.push([x, y]); tiles.push(ch); }
        else tiles.push(ch);
      });
    });
    return { w, h, tiles, starts, boxes, keys, stars, locks };
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
        cache[key] = Object.assign(parse(st.rows), { name: st.name, hint: st.hint, rows: st.rows, need: {}, boxSw: st.boxSw || [] });
      } else {
        const g = generate(spec.level, spec.n, spec.seed);
        cache[key] = Object.assign(parse(g.rows), { name: LEVELS[spec.level].label, hint: '', rows: g.rows, kinds: g.kinds, starts: g.starts, need: g.need, boxSw: g.boxSw });
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

  // 重い箱が、もうスイッチまで運べない場所に入ったか（詰み）。
  // 箱で開けるとびらのスイッチ（ステージを作るときに boxSw に入れてある）に、まだ箱が乗っていなくて、
  // どの箱も（人やほかの箱がいないとしても）そこまで押していけないなら、詰み。
  // 押すには、箱の手前に2マス（押す人・うしろの人）と、箱の先に置けるマスが要る
  function stuck(S) {
    if (!S.boxes.length || S.cleared) return false;
    const T = staticOf(S.spec);
    const tile = (x, y) => (x < 0 || y < 0 || x >= T.w || y >= T.h ? '#' : T.tiles[y * T.w + x]);
    const holds = (t) => t === '.' || t === 'G' || SWITCHES.includes(t);
    // 押す人・うしろの人が立てるマス（とびらの中からは押せないものとして数える）
    const stands = (t) => t !== '#' && !SWITCH_OF[t] && t !== 'L';
    // 人が乗っておさえているだけでは、その人が先へ進めないので、箱が乗っているかどうかで見る
    const boxOn = (c) => S.boxes.some((b) => tile(b[0], b[1]) === c);
    const targets = T.boxSw.filter((c) => !boxOn(c));
    if (!targets.length) return false;
    const reach = new Set();
    const stack = S.boxes.map((b) => [b[0], b[1]]);
    while (stack.length) {
      const [x, y] = stack.pop();
      const k = x + ',' + y;
      if (reach.has(k)) continue;
      reach.add(k);
      Object.keys(DIRS).forEach((d) => {
        const [dx, dy] = DIRS[d];
        if (!stands(tile(x - dx, y - dy)) || !stands(tile(x - 2 * dx, y - 2 * dy)) || !holds(tile(x + dx, y + dy))) return;
        stack.push([x + dx, y + dy]);
      });
    }
    return targets.some((c) => {
      const i = T.tiles.indexOf(c);
      return !reach.has((i % T.w) + ',' + Math.floor(i / T.w));
    });
  }

  /* ── ルームに置く形 ──
     動く部分を、さわった所だけ書けるように分けて置く（ステージの形は spec から作りなおすので入れない）。
       p: ["x.y.k.n", …]   人ごと。k はカギを持っていれば 1、n はその人の歩数
       b: ["x.y", …]       箱ごと
       k / st: { 番号: 1 }  まだ置いてあるカギ・星（とったら消す。番号は、ステージのカギ・星のならび順）
       o: { 番号: 1 }       開けた、かぎつきのとびら（番号は、ステージのかぎつきのとびらのならび順）
     1歩で書くのは、ふつうは自分の p/番号 だけ。全員ぶんを1つの値にまとめて transaction で書くと、
     ほかの人の1歩が先に届くたびに書きなおしになる。通信の往復に 0.1〜0.2 秒かかる本番で12人が動くと、
     書きなおしが続いて進めなくなるおそれがあるので、人ごとに分けた（2026-11-13。本番で測ったわけではない）。
     こわれた値・ステージに合わない値は、その所だけはじめの値で読む（1つこわれても、全体を読めなくしない） */
  const cellText = (c) => c[0] + '.' + c[1];
  const index1 = (list) => { const o = {}; list.forEach((_, i) => { o[i] = 1; }); return o; };
  // 配列でも { 番号: 値 } でも、[番号, 値] のならびにする（Realtime Database は、番号のキーを配列で返すことがある）
  const entries = (v) => (v && typeof v === 'object' ? Object.keys(v).map((k) => [Number(k), v[k]]).filter(([k, x]) => Number.isInteger(k) && k >= 0 && x != null) : []);
  const ints = (text, width) => {
    if (typeof text !== 'string') return null;
    const part = text.split('.');
    if (part.length !== width || !part.every((x) => /^\d{1,6}$/.test(x))) return null;
    return part.map(Number);
  };

  function toRoom(S) {
    const T = staticOf(S.spec);
    const pick = (all, left) => { const o = {}; all.forEach((c, i) => { if (at(left, c[0], c[1]) >= 0) o[i] = 1; }); return o; };
    const o = {};
    T.locks.forEach((c, i) => { if (at(S.open, c[0], c[1]) >= 0) o[i] = 1; });
    return {
      p: S.players.map((q) => q.x + '.' + q.y + '.' + (q.key ? 1 : 0) + '.' + (q.n || 0)),
      b: S.boxes.map(cellText),
      k: pick(T.keys, S.keys),
      st: pick(T.stars, S.stars),
      o,
    };
  }

  function fromRoom(d, spec) {
    if (!d || typeof d !== 'object' || !validSpec(spec)) return null;
    const T = staticOf(spec);
    const floor = (x, y) => x >= 0 && y >= 0 && x < T.w && y < T.h && T.tiles[y * T.w + x] !== '#';
    const pMap = new Map(entries(d.p));
    const bMap = new Map(entries(d.b));
    const players = T.starts.map((c, i) => {
      const v = ints(pMap.get(i), 4);
      return v && floor(v[0], v[1]) ? { x: v[0], y: v[1], key: v[2] === 1, n: v[3] } : { x: c[0], y: c[1], key: false, n: 0 };
    });
    const boxes = T.boxes.map((c, i) => {
      const v = ints(bMap.get(i), 2);
      return v && floor(v[0], v[1]) ? v : [c[0], c[1]];
    });
    const left = (all, v) => { const on = new Set(entries(v).map(([k]) => k)); return all.filter((_, i) => on.has(i)).map((c) => [c[0], c[1]]); };
    const stars = left(T.stars, d.st);
    const S = {
      spec: clone(spec),
      players,
      boxes,
      keys: left(T.keys, d.k),
      stars,
      got: T.stars.length - stars.length,
      open: left(T.locks, d.o),
      cleared: false,
      rev: players.reduce((a, q) => a + q.n, 0),
    };
    S.cleared = S.players.every((q) => tileAt(S, q.x, q.y) === 'G');
    return S;
  }

  // who が動いて S が next になったとき、ルームに書く所（{ 場所: 値 }。消す所は null）
  function patch(S, next, who) {
    const T = staticOf(S.spec);
    const out = {};
    next.players.forEach((q, i) => {
      const was = S.players[i];
      if (i !== who && was.x === q.x && was.y === q.y && was.key === q.key) return;
      out['p/' + i] = q.x + '.' + q.y + '.' + (q.key ? 1 : 0) + '.' + ((was.n || 0) + (i === who ? 1 : 0));
    });
    next.boxes.forEach((c, i) => { if (S.boxes[i][0] !== c[0] || S.boxes[i][1] !== c[1]) out['b/' + i] = cellText(c); });
    T.keys.forEach((c, i) => { if (at(S.keys, c[0], c[1]) >= 0 && at(next.keys, c[0], c[1]) < 0) out['k/' + i] = null; });
    T.stars.forEach((c, i) => { if (at(S.stars, c[0], c[1]) >= 0 && at(next.stars, c[0], c[1]) < 0) out['st/' + i] = null; });
    T.locks.forEach((c, i) => { if (at(S.open, c[0], c[1]) < 0 && at(next.open, c[0], c[1]) >= 0) out['o/' + i] = 1; });
    return out;
  }

  const api = {
    FIXED, LEVELS, MIN_PLAYERS, MAX_PLAYERS, STARS, DIRS, SWITCHES, SWITCH_OF, BRIDGES, BRIDGE_OF,
    roomSize, makeRng, generate, validSpec, specKey, staticOf, create, tileAt, held, doorOpen, move, stuck, toRoom, fromRoom, patch,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SorotteEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
