/* のりあいロード — ステージと動きのきまり。画面と通信には触らない（node でも読める）
 *
 * 座標はマス単位。x は右へ、y は下へ増える。マス (tx, ty) は x∈[tx, tx+1]・y∈[ty, ty+1]。
 * ステージは「区間」を左からつないで作る。どの区間も、はじめと終わりの床の高さは y=10。
 *
 * 遅れに強くするための決まり（ルームで、それぞれの端末から遊ぶとき）:
 *  - 自分のキャラの動きは、自分の端末で計算する（stepPlayer）
 *  - 箱・動く床・とびら・カギ・ボールは、ホストの端末だけが計算する（stepObjects）
 *  - 人・動く床・箱の上に乗っているときは「なにの上の、どこに乗っているか」を送る（ground と rx）。
 *    受けとった側は、下の人の描く位置に乗せて描くので、遅れても下の人とずれない
 */
(function (root) {
  'use strict';

  const H = 13;               // 縦のマス数
  const VIEW = 22;            // 画面に映る横のマス数（全員がこの中にいる）
  const PW = 0.75;            // キャラの幅
  const PH = 0.9;             // キャラの高さ
  const GRAV = 38;
  const JUMP_H = 1.7;         // ひとりで跳べる高さ（2マスの段は、ひとりでは上がれない）
  const JUMP_V = Math.sqrt(2 * GRAV * JUMP_H);
  const SPEED = 6;
  const MAX_FALL = 18;
  const ROPE_LEN = 3.5;       // ひもの長さ（となりの番号の人まで）
  const BOX_SPEED = 2.2;
  const PUSH_REACH = 0.25;        // 止まっている箱を押しはじめる近さ
  const PUSH_REACH_MOVING = 2.0;  // 動いている箱を押しつづけていると数える近さ
  const PLAT_SPEED = 2.4;
  const PLAT_WAIT = 1.5;      // 人数がへってから戻りはじめるまで（秒）
  const SEESAW_UNIT = 1.5;    // 重さの差1つぶんで傾く高さ
  const SEESAW_MAX = 1.5;     // 傾きの上限（下がった側からも床へ跳んで出られる高さ）
  const SEESAW_SPEED = 2.2;
  const ITEM = 0.6;           // カギ・ボールの大きさ
  const THROW = { ball: { vx: 6.5, vy: -16 }, key: { vx: 4, vy: -7 } };
  const EPS = 1e-4;
  const LINKS = 'ABCDEFGH';
  const MAX_PLAYERS = 10;
  const ALL_CAP = 5;          // 「みんな」の数字の上限（人数が多いときは、5人ずつに分かれて動かす）
  const SPAWN_GAP = 1.05;     // はじめに並ぶ間かく
  const SPRING_H = 4.6;       // ばねで跳べる高さ（4マスのかべをこえられる）
  const SPRING_V = Math.sqrt(2 * GRAV * SPRING_H);

  /* ── ステージを作る道具 ── */
  function builder() {
    const cols = [];
    const meta = { gates: [], switches: [], plats: [], seesaws: [], boxes: [], items: [], hoops: [], springs: [], checkpoints: [], door: null };
    let ox = 0;
    let link = 0;
    function ensure(x) {
      while (cols.length <= x) {
        const c = new Array(H).fill('.');
        for (let y = 10; y < H; y++) c[y] = '#';
        cols.push(c);
      }
    }
    function set(x, y, ch) { ensure(x); cols[x][y] = ch; }
    function fill(x0, x1, y0, y1, ch) {
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set(x, y, ch);
    }
    return {
      cols, meta, set, fill, ensure,
      get ox() { return ox; },
      nextLink() { return LINKS[link++ % LINKS.length]; },
      begin() { meta.checkpoints.push(ox + 0.6); },
      advance(len) { ensure(ox + len - 1); ox += len; },
    };
  }

  /* ── 区間（どれも左はしの床から始まり、右はしの床で終わる）。SEG.名前(b, ステージに書いた引数, 遊ぶ人数) ── */
  const SEG = {
    // はじめの場所。左のかべとスタート
    // n: 遊ぶ人数（多いときは、みんなが並べるように広くする）
    start(b, _, n) {
      b.begin();
      b.fill(0, 0, 0, H - 1, '#');
      b.meta.spawn = 1.2;
      b.advance(Math.max(7, Math.ceil(1.2 + (n || 1) * SPAWN_GAP + 1)));
    },
    // 1マスの段（跳ぶ練習）
    bump(b) {
      b.begin();
      const o = b.ox;
      b.fill(o + 2, o + 3, 9, 9, '#');
      b.advance(6);
    },
    // 穴（落ちても、この区間のはじめにすぐ戻る）
    pit(b, w) {
      b.begin();
      const o = b.ox;
      b.fill(o + 2, o + 1 + w, 10, H - 1, '.');
      b.advance(w + 4);
    },
    // 人の階段: 2マスの台。上のスイッチをおさえている間だけ、下のとびらが開く
    ledge(b) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      b.fill(o + 3, o + 12, 8, 8, '#');
      b.meta.gates.push({ letter: L, x: o + 3, y0: 9, y1: 9, seat: 0 });
      b.meta.switches.push({ letter: L, x: o + 7, y: 7 });
      b.advance(14);
    },
    // 番号の人だけ通れるかべ。向こうのスイッチをその人がおさえると、みんな通れる
    colorGate(b, seat) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      b.meta.gates.push({ letter: L, x: o + 3, y0: 3, y1: 9, seat });
      b.meta.switches.push({ letter: L, x: o + 5, y: 9 });
      b.advance(8);
    },
    // 番号の人だけ入れるブロックの中のカギ
    keyBlock(b, seat) {
      b.begin();
      const o = b.ox;
      b.fill(o + 2, o + 4, 9, 9, String(seat));
      b.meta.items.push({ kind: 'key', x: o + 3.2, y: 9.4 });
      b.advance(7);
    },
    // 重い箱をスイッチまで押す（箱は、とびらで止まる）
    boxSwitch(b, need) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      b.meta.boxes.push({ x: o + 2, y: 9, need });
      b.meta.switches.push({ letter: L, x: o + 8, y: 9 });
      b.meta.gates.push({ letter: L, x: o + 9, y0: 3, y1: 9, seat: 0 });
      b.advance(11);
    },
    // 乗っている人数で上がるリフト
    lift(b, need) {
      b.begin();
      const o = b.ox;
      b.fill(o + 5, o + 14, 4, 9, '#');
      b.meta.plats.push({ x: o + 2, y: 10, w: 3, ax: o + 2, ay: 10, bx: o + 2, by: 4, need });
      b.advance(16);
    },
    // 乗っている人数で動く床（広い穴をわたる）
    bridge(b, need) {
      b.begin();
      const o = b.ox;
      b.fill(o + 3, o + 11, 10, H - 1, '.');
      b.meta.plats.push({ x: o + 0.5, y: 10, w: 2.5, ax: o + 0.5, ay: 10, bx: o + 11.5, by: 10, need });
      b.advance(15);
    },
    // シーソー: 重いほうが下がる。上がった側から、右の台の上のもの（カギかボール）をとる
    seesaw(b, item) {
      b.begin();
      const o = b.ox;
      b.fill(o + 3, o + 8, 10, H - 1, '.');
      b.fill(o + 10, o + 13, 7, 7, '#');
      const ss = b.meta.seesaws.length;
      b.meta.plats.push({ x: o + 3, y: 10, w: 2.8, ax: o + 3, ay: 10, bx: o + 3, by: 10, need: 0, seesaw: ss, side: -1 });
      b.meta.plats.push({ x: o + 6.2, y: 10, w: 2.8, ax: o + 6.2, ay: 10, bx: o + 6.2, by: 10, need: 0, seesaw: ss, side: 1 });
      b.meta.seesaws.push({ left: b.meta.plats.length - 2, right: b.meta.plats.length - 1, rest: 10, cx: o + 6 });
      b.meta.boxes.push({ x: o + 1, y: 9, need: 1 });
      if (item) b.meta.items.push({ kind: item, x: o + 11.7, y: 6.4 });
      b.advance(16);
    },
    // ボールを高いかごに入れると、とびらが開いたままになる。ボールを持つとジャンプできない
    ballHoop(b, withBall) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      if (withBall) b.meta.items.push({ kind: 'ball', x: o + 1.2, y: 9.4 });
      b.meta.hoops.push({ x: o + 5, y: 5, w: 1.6, h: 0.8, letter: L });
      b.meta.gates.push({ letter: L, x: o + 10, y0: 0, y1: 9, seat: 0 });
      b.advance(13);
    },
    // 1マスずつ上がる階段
    stairs(b) {
      b.begin();
      const o = b.ox;
      b.fill(o + 1, o + 3, 9, 9, '#');
      b.fill(o + 4, o + 6, 8, 9, '#');
      b.fill(o + 7, o + 9, 7, 9, '#');
      b.advance(12);
    },
    // 穴の上の小さな足場
    floats(b) {
      b.begin();
      const o = b.ox;
      b.fill(o + 1, o + 13, 10, H - 1, '.');
      b.fill(o + 3, o + 4, 9, 9, '#');
      b.fill(o + 7, o + 8, 9, 9, '#');
      b.fill(o + 11, o + 12, 9, 9, '#');
      b.advance(16);
    },
    // 人の塔: 3マスの台（2人なら2マス）。上のスイッチをおさえている間だけ、下のとびらが開く。
    // 3マスは、2人重なった上から跳ぶと上がれる（ひとりで跳べる 1.7マス＋頭2つぶん）
    tower(b, _, n) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      const row = 10 - (n >= 3 ? 3 : 2);
      b.fill(o + 3, o + 12, row, row, '#');
      b.meta.gates.push({ letter: L, x: o + 3, y0: row + 1, y1: 9, seat: 0 });
      // スイッチは、とびらのすぐ上（ひもでつながっていても、下の人がとびらを通れる近さ）
      b.meta.switches.push({ letter: L, x: o + 4, y: row - 1 });
      b.advance(14);
    },
    // 箱を足場にする: 3マスの台。箱をとびらの前まで押して、箱の上の人の頭から跳ぶ
    boxStep(b) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      b.meta.boxes.push({ x: o + 2, y: 9, need: 1 });
      b.fill(o + 7, o + 15, 7, 7, '#');
      b.meta.gates.push({ letter: L, x: o + 7, y0: 8, y1: 9, seat: 0 });
      b.meta.switches.push({ letter: L, x: o + 8, y: 6 });
      b.advance(17);
    },
    // 手分け: 下のスイッチと、高い足場の上のスイッチを同時におさえると、とびらがずっと開く
    split(b) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      b.meta.switches.push({ letter: L, x: o + 2, y: 9 });
      b.fill(o + 7, o + 10, 8, 8, '#');
      b.meta.switches.push({ letter: L, x: o + 9, y: 7 });
      b.meta.gates.push({ letter: L, x: o + 13, y0: 0, y1: 9, seat: 0, all: true, latch: true });
      b.advance(16);
    },
    // 番号のスイッチ: 1番と、いちばん大きい番号の人が、同時におさえると、とびらがずっと開く（片方は高い足場の上）
    numPair(b) {
      b.begin();
      const o = b.ox;
      const L = b.nextLink();
      b.meta.switches.push({ letter: L, x: o + 2, y: 9, seat: 1 });
      b.fill(o + 6, o + 8, 8, 8, '#');
      b.meta.switches.push({ letter: L, x: o + 7, y: 7, seat: 'last' });
      b.meta.gates.push({ letter: L, x: o + 11, y0: 0, y1: 9, seat: 0, all: true, latch: true });
      b.advance(14);
    },
    // ばねで穴をこえる（ふつうのジャンプでは、とどかない幅）
    springPit(b) {
      b.begin();
      const o = b.ox;
      b.meta.springs.push({ x: o + 2, y: 10 });
      b.fill(o + 4, o + 7, 10, H - 1, '.');
      b.advance(11);
    },
    // ばねで4マスのかべをこえる。かべの上にカギなど
    springWall(b, item) {
      b.begin();
      const o = b.ox;
      b.meta.springs.push({ x: o + 2, y: 10 });
      b.fill(o + 4, o + 7, 6, 9, '#');
      if (item) b.meta.items.push({ kind: item, x: o + 5.7, y: 5.4 });
      b.advance(11);
    },
    // ゴールのとびら。locked ならカギを持った人がふれると開く
    door(b, locked) {
      b.begin();
      const o = b.ox;
      b.meta.door = { x: o + 2, y: 8, locked: !!locked };
      b.fill(o + 5, o + 5, 0, H - 1, '#');
      b.advance(6);
    },
  };

  /* ── ステージ ── */
  const STAGES = [
    {
      name: 'のりあいの練習',
      hint: '2マスの段は、友だちの頭に乗って上がる。台の上のスイッチをおさえている間だけ、下のとびらが開くよ。番号のかべは、その番号の人だけ通れる。カギを持ってとびらへ。',
      parts: [['start'], ['bump'], ['pit', 2], ['ledge'], ['colorGate', 2], ['keyBlock', 1], ['door', true]],
    },
    {
      name: '重い箱と動く床',
      hint: '箱の数字は、押すのに要る人数。リフトと動く床は、数字の人数が乗ると動くよ。人数が多いときは、何回かに分かれて乗ろう。',
      parts: [['start'], ['boxSwitch', 'all'], ['lift', 'all'], ['bridge', 'all'], ['door', false]],
    },
    {
      name: 'シーソーとボール',
      hint: 'シーソーは重いほうが下がる。箱も重さに入るよ。ボールを持つとジャンプできないので、投げてわたそう。高いかごに入れると、とびらが開く。',
      parts: [['start'], ['seesaw', 'ball'], ['ballHoop', false], ['door', false]],
    },
    {
      name: 'ひもでつながる',
      hint: 'となりの番号の人と、ひもでつながっている（5人からは、いくつかの組に分かれる）。はなれすぎると進めない。ぶら下がったら、ジャンプで上がれるよ。',
      rope: true,
      parts: [['start'], ['pit', 3], ['stairs'], ['floats'], ['ledge'], ['door', false]],
    },
    {
      name: 'ぜんぶ',
      hint: 'これまでのしかけが全部出てくる。カギはシーソーの先、ボールはかごの手前にあるよ。',
      parts: [['start'], ['ledge'], ['boxSwitch', 2], ['colorGate', 3], ['lift', 'all'], ['seesaw', 'key'], ['bridge', 'all'], ['ballHoop', true], ['door', true]],
    },
    {
      name: '高い台',
      hint: '3マスの台は、2人重なった上から跳ぶと上がれる（2人のときは2マス）。箱も足場になるよ。台の上のスイッチをおさえている間だけ、下のとびらが開く。',
      parts: [['start'], ['bump'], ['tower'], ['boxStep'], ['door', false]],
    },
    {
      name: 'ばねでとぶ',
      hint: 'ばねに乗ると、高く跳べる。ふつうのジャンプでとどかない穴や、高いかべをこえよう。カギはかべの上にあるよ。',
      parts: [['start'], ['springPit'], ['springWall', 'key'], ['pit', 2], ['door', true]],
    },
    {
      name: '手分けの道',
      hint: '同じしるしのスイッチを全部、同時におさえると、とびらがずっと開く。番号のスイッチは、その番号の人だけがおさえられるよ。',
      parts: [['start'], ['split'], ['numPair'], ['lift', 'all'], ['door', false]],
    },
    {
      name: 'ひもと高い台',
      hint: 'となりの番号の人と、ひもでつながっている（5人からは、いくつかの組に分かれる）。箱や友だちの頭を足場にして、高い台に上がろう。',
      rope: true,
      parts: [['start'], ['boxStep'], ['stairs'], ['tower'], ['door', false]],
    },
    {
      name: 'さいごの道',
      hint: 'これまでのしかけが全部出てくる。カギは、ばねで上がるかべの上にあるよ。',
      parts: [['start'], ['springPit'], ['split'], ['tower'], ['boxSwitch', 2], ['springWall', 'key'], ['bridge', 'all'], ['numPair'], ['door', true]],
    },
    // 11・12: むずかしい道（2026-11-18。これまでの区間を、長く・続けてつなぐ。新しいしかけはない）
    {
      name: 'ひもでつながる長い道',
      hint: 'となりの番号の人と、ひもでつながっている（5人からは、いくつかの組に分かれる）。穴・箱の足場・穴の上の足場・高い台が、何回も続く長い道。はなれすぎないように、声をかけ合って進もう。',
      rope: true,
      parts: [['start'], ['pit', 3], ['boxStep'], ['floats'], ['tower'], ['pit', 3], ['stairs'], ['ledge'], ['tower'], ['door', false]],
    },
    {
      name: 'いちばん長い道',
      hint: 'ステージ1〜10のしかけが、ほとんど全部出てくる長い道。ボールはシーソーの先、カギはばねで上がるかべの上にあるよ。',
      parts: [['start'], ['ledge'], ['tower'], ['boxSwitch', 'all'], ['springPit'], ['numPair'], ['seesaw', 'ball'], ['ballHoop', false], ['split'], ['lift', 'all'], ['springWall', 'key'], ['bridge', 'all'], ['colorGate', 2], ['door', true]],
    },
  ];

  function buildStage(index, n) {
    const st = STAGES[index];
    const b = builder();
    for (const [name, arg] of st.parts) SEG[name](b, arg, n);
    return { cols: b.cols, meta: b.meta, W: b.cols.length };
  }

  /* ── 番号・人数 ── */
  const mapSeat = (seat, n) => ((seat - 1) % n) + 1;
  const resolveNeed = (need, n) => (need === 'all' ? Math.min(n, ALL_CAP) : Math.min(need, n));

  // ひもの組: 4人までは1本につながる。5人からは、4人までの組に分ける（10人なら 4・3・3）
  function ropeGroups(n) {
    const k = Math.ceil(n / 4);
    const out = [];
    let seat = 1;
    for (let g = 0; g < k; g++) {
      const size = Math.floor(n / k) + (g < n % k ? 1 : 0);
      out.push([seat, seat + size - 1]);
      seat += size;
    }
    return out;
  }
  // a と b（番号）がひもでつながっているか
  function ropeLinked(n, a, b) {
    if (Math.abs(a - b) !== 1 || a < 1 || b < 1 || a > n || b > n) return false;
    return ropeGroups(n).some(([lo, hi]) => a >= lo && a <= hi && b >= lo && b <= hi);
  }

  // 動く床が動くのに要る人数: 数字の人数と、まだ向こうへ行っていない人の少ないほう
  // （人数が多くて何回かに分けて運ぶとき、最後の組が数字より少なくても動けるように）
  function platNeed(p, players) {
    if (p.seesaw >= 0) return 0;
    const edge = p.bx !== p.ax ? Math.max(p.ax, p.bx) : p.ax + p.w;
    let left = 0;
    for (const q of players) if (!q.entered && !q.absent && q.x + PW / 2 < edge) left++;
    return Math.max(1, Math.min(p.need, left));
  }

  /* ── ワールド ── */
  function createWorld(stage, n) {
    const { cols, meta, W } = buildStage(stage, n);
    const world = {
      stage, n, W, cols,
      rope: !!STAGES[stage].rope,
      gates: meta.gates.map((g) => ({ ...g, seatN: g.seat ? mapSeat(g.seat, n) : 0, open: false, latched: false, anim: 0 })),
      switches: meta.switches.map((s) => ({ ...s, seatN: s.seat === 'last' ? n : s.seat ? mapSeat(s.seat, n) : 0, on: false })),
      boxes: meta.boxes.map((b) => ({ x: b.x, y: b.y, w: 1, h: 1, x0: b.x, y0: b.y, need: resolveNeed(b.need, n), vx: 0, vy: 0, ground: null, dx: 0, dy: 0, pushers: 0 })),
      plats: meta.plats.map((p) => ({
        x: p.x, y: p.y, w: p.w, h: 0.35, ax: p.ax, ay: p.ay, bx: p.bx, by: p.by,
        need: p.seesaw == null ? resolveNeed(p.need, n) : 0, seesaw: p.seesaw == null ? -1 : p.seesaw, side: p.side || 0,
        riders: 0, dx: 0, dy: 0,
      })),
      seesaws: meta.seesaws.map((s) => ({ ...s, off: 0, wl: 0, wr: 0 })),
      items: meta.items.map((it) => ({ kind: it.kind, x: it.x, y: it.y, x0: it.x, y0: it.y, w: ITEM, h: ITEM, vx: 0, vy: 0, holder: 0, cool: {}, hooped: false, gone: false })),
      hoops: meta.hoops.map((h) => ({ ...h, done: false })),
      springs: meta.springs.map((sp) => ({ ...sp })),
      door: meta.door ? { x: meta.door.x, y: meta.door.y, w: 1.2, h: 2, locked: meta.door.locked } : null,
      checkpoints: meta.checkpoints.slice(),
      spawn: meta.spawn || 1.2,
      players: [],
      clear: false,
    };
    for (let s = 1; s <= n; s++) world.players.push(makePlayer(s, spawnX(world, s), 10 - PH));
    return world;
  }
  function spawnX(world, seat) { return world.spawn + (seat - 1) * SPAWN_GAP; }

  function makePlayer(seat, x, y) {
    return {
      seat, x, y, w: PW, h: PH, vx: 0, vy: 0, face: 1, ground: null, coyote: 0, jumpBuf: 0,
      entered: false, dx: 0, dy: 0, inDir: 0, ropeTaut: false, blink: 0, rx: 0, boost: false,
    };
  }

  /* ── 当たり ── */
  // mode: 1〜4 はその番号の人、0 は箱、-1 はカギ・ボール
  function solidTile(world, tx, ty, mode) {
    if (tx < 0 || tx >= world.W) return true;
    if (ty < 0 || ty >= H) return false;
    const c = world.cols[tx][ty];
    if (c === '#') return true;
    if (c >= '1' && c <= '4') {
      if (mode < 0) return false;
      return mode === 0 || mapSeat(+c, world.n) !== mode;
    }
    return false;
  }
  const overlapY = (e, r) => e.y < r.y + r.h - EPS && e.y + e.h > r.y + EPS;
  const overlapX = (e, r) => e.x < r.x + r.w - EPS && e.x + e.w > r.x + EPS;
  const overlap = (a, b) => overlapX(a, b) && overlapY(a, b);

  function gateRect(g) { return { x: g.x, y: g.y0, w: 1, h: g.y1 - g.y0 + 1 }; }

  // その人にとって通れないもの（箱・閉じたとびら）
  function solidsFor(mode, ctx, selfBox) {
    const out = [];
    for (const g of ctx.gates) {
      const closed = mode === 0 ? true : (!g.open && !(mode > 0 && g.seatN === mode));
      if (closed) out.push({ ...gateRect(g), ref: 'g' });
    }
    ctx.boxes.forEach((b, i) => { if (i !== selfBox) out.push({ x: b.x, y: b.y, w: b.w, h: b.h, ref: 'b' + i }); });
    return out;
  }
  // 上からだけ乗れるもの（動く床・人の頭）
  function topsFor(ctx, selfSeat) {
    const out = [];
    ctx.plats.forEach((p, i) => out.push({ x: p.x, y: p.y, w: p.w, h: p.h, ref: 'p' + i }));
    if (selfSeat != null) {
      for (const q of ctx.players) {
        if (q.seat === selfSeat || q.entered) continue;
        out.push({ x: q.x, y: q.y, w: PW, h: 0.2, ref: 's' + q.seat });
      }
    }
    return out;
  }

  function moveX(e, dx, world, mode, solids) {
    if (!dx) return false;
    let nx = e.x + dx;
    let hit = false;
    const y0 = Math.floor(e.y + EPS);
    const y1 = Math.floor(e.y + e.h - EPS);
    if (dx > 0) {
      const tx = Math.floor(nx + e.w - EPS);
      if (tx !== Math.floor(e.x + e.w - EPS)) {
        for (let ty = y0; ty <= y1; ty++) if (solidTile(world, tx, ty, mode)) { nx = tx - e.w; hit = true; break; }
      }
    } else {
      const tx = Math.floor(nx + EPS);
      if (tx !== Math.floor(e.x + EPS)) {
        for (let ty = y0; ty <= y1; ty++) if (solidTile(world, tx, ty, mode)) { nx = tx + 1; hit = true; break; }
      }
    }
    for (const r of solids) {
      if (!overlapY(e, r)) continue;
      if (dx > 0 && e.x + e.w <= r.x + EPS && nx + e.w > r.x) { nx = r.x - e.w; hit = true; }
      if (dx < 0 && e.x >= r.x + r.w - EPS && nx < r.x + r.w) { nx = r.x + r.w; hit = true; }
    }
    e.x = nx;
    return hit;
  }

  // 返り値: { land: ref|null, bump: bool }
  function moveY(e, dy, world, mode, solids, tops) {
    const res = { land: null, bump: false };
    if (!dy) return res;
    let ny = e.y + dy;
    const x0 = Math.floor(e.x + EPS);
    const x1 = Math.floor(e.x + e.w - EPS);
    if (dy > 0) {
      const ty = Math.floor(ny + e.h - EPS);
      if (ty !== Math.floor(e.y + e.h - EPS)) {
        for (let tx = x0; tx <= x1; tx++) if (solidTile(world, tx, ty, mode)) { ny = ty - e.h; res.land = 't'; break; }
      }
      for (const r of solids) {
        if (!overlapX(e, r)) continue;
        if (e.y + e.h <= r.y + EPS && ny + e.h > r.y) { ny = r.y - e.h; res.land = r.ref; }
      }
      if (tops) {
        for (const r of tops) {
          if (!overlapX(e, r)) continue;
          if (e.y + e.h <= r.y + 0.02 && ny + e.h > r.y - EPS) {
            if (r.y - e.h < ny + EPS) { ny = r.y - e.h; res.land = r.ref; }
          }
        }
      }
    } else {
      const ty = Math.floor(ny + EPS);
      if (ty !== Math.floor(e.y + EPS)) {
        for (let tx = x0; tx <= x1; tx++) if (solidTile(world, tx, ty, mode)) { ny = ty + 1; res.bump = true; break; }
      }
      for (const r of solids) {
        if (!overlapX(e, r)) continue;
        if (e.y >= r.y + r.h - EPS && ny < r.y + r.h) { ny = r.y + r.h; res.bump = true; }
      }
    }
    e.y = ny;
    return res;
  }

  // 箱やとびらに重なってしまったとき、近いほうへ押し出す
  function depenetrate(e, solids) {
    for (const r of solids) {
      if (!overlap(e, r)) continue;
      const left = e.x + e.w - r.x;
      const right = r.x + r.w - e.x;
      const up = e.y + e.h - r.y;
      const m = Math.min(left, right, up);
      if (m === up) e.y = r.y - e.h;
      else if (m === left) e.x = r.x - e.w;
      else e.x = r.x + r.w;
    }
  }

  function findPlayer(list, seat) {
    for (const q of list) if (q.seat === seat) return q;
    return null;
  }
  function carryOf(ref, ctx) {
    if (!ref || ref === 't' || ref === 'g') return null;
    const k = ref[0];
    const i = +ref.slice(1);
    if (k === 'p') return ctx.plats[i] || null;
    if (k === 'b') return ctx.boxes[i] || null;
    if (k === 's') return findPlayer(ctx.players, i);
    return null;
  }

  // 落ちた所のすぐ手前の区間のはじめ
  function respawnX(world, x) {
    let best = world.checkpoints[0];
    for (const c of world.checkpoints) if (c <= x + 1) best = c;
    return best;
  }
  function surfaceY(world, x) {
    const tx = Math.floor(x + PW / 2);
    for (let ty = 0; ty < H; ty++) if (solidTile(world, tx, ty, 99)) return ty;
    return 10;
  }

  /* ── 1人ぶんの動き ──
   * inp: { l, r, jump, jumpPressed, actPressed }
   * ctx: { gates, boxes, plats, players(ほかの人), cam: {l, r} | null, door, holding(seat) }
   * 返り値: 投げる・置くときは { throw: true }
   */
  function stepPlayer(world, p, inp, dt, ctx) {
    const out = {};
    p.dx = 0; p.dy = 0;
    p.blink = Math.max(0, p.blink - dt);
    if (p.entered) {
      if (inp.actPressed) exitDoor(world, p, ctx.door);
      return out;
    }
    const x0 = p.x;
    const y0 = p.y;
    const solids = solidsFor(p.seat, ctx);
    const tops = topsFor(ctx, p.seat);
    depenetrate(p, solids);

    // 乗っているものといっしょに動く
    const carrier = carryOf(p.ground, ctx);
    if (carrier && (carrier.dx || carrier.dy)) {
      moveX(p, carrier.dx, world, p.seat, solids);
      if (carrier.dy) moveY(p, carrier.dy, world, p.seat, solids, null);
    }

    const dir = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
    p.inDir = dir;
    if (dir) p.face = dir;
    p.vx = dir * SPEED;
    p.coyote = p.ground ? 0.08 : Math.max(0, p.coyote - dt);
    p.jumpBuf = inp.jumpPressed ? 0.12 : Math.max(0, p.jumpBuf - dt);
    const holdKind = ctx.holding ? ctx.holding(p.seat) : null;
    const canJump = holdKind !== 'ball' && (p.coyote > 0 || p.ropeTaut);
    if (p.jumpBuf > 0 && canJump) {
      p.vy = -JUMP_V;
      p.jumpBuf = 0;
      p.coyote = 0;
      p.ground = null;
    }
    if (!inp.jump && !p.boost && p.vy < -JUMP_V * 0.45) p.vy = -JUMP_V * 0.45;
    if (p.vy >= 0) p.boost = false;
    p.vy = Math.min(MAX_FALL, p.vy + GRAV * dt);
    p.ropeTaut = false;

    // 横
    const bx = p.x;
    moveX(p, p.vx * dt, world, p.seat, solids);
    if (ctx.cam) {
      if (p.x < ctx.cam.l && p.x < bx) p.x = Math.max(p.x, Math.min(bx, ctx.cam.l));
      if (p.x + PW > ctx.cam.r && p.x > bx) p.x = Math.min(p.x, Math.max(bx, ctx.cam.r - PW));
    }
    // 縦
    const r = moveY(p, p.vy * dt, world, p.seat, solids, tops);
    if (r.land) { p.vy = 0; p.ground = r.land; } else { p.ground = null; if (r.bump) p.vy = Math.max(0, p.vy); }
    // ばね: 床のばねの上に立つと、高く跳ぶ（ジャンプのキーをはなしても、低くならない）
    if (r.land === 't' && onSpring(world, p)) { p.vy = -SPRING_V; p.ground = null; p.coyote = 0; p.boost = true; }
    // 人・動く床・箱の上では、乗っているものからの横の位置も書く（受けた側は、描いている乗りものの上に乗せる）
    if (p.ground && 'spb'.includes(p.ground[0])) {
      const q = carryOf(p.ground, ctx);
      p.rx = q ? p.x - q.x : 0;
    }

    if (world.rope) ropeFix(world, p, ctx, solids);

    // 落ちたら、手前の区間のはじめに戻る
    if (p.y > H + 1) respawn(world, p);

    // ゴールのとびら
    const d = ctx.door;
    if (d && !d.locked && overlap({ x: p.x, y: p.y, w: PW, h: PH }, d)) {
      p.entered = true;
      p.ground = null;
    }
    if (inp.actPressed && holdKind) out.throw = true;

    p.dx = p.x - x0;
    p.dy = p.y - y0;
    return out;
  }

  function onSpring(world, p) {
    for (const sp of world.springs) {
      if (Math.abs(p.y + PH - sp.y) < 0.05 && p.x + PW > sp.x + 0.15 && p.x < sp.x + 0.85) return true;
    }
    return false;
  }

  // とびらから出る: とびらの左どなりの床に出す（とびらに重なったままだと、次のこまでまた入ってしまうため）
  function exitDoor(world, p, d) {
    p.entered = false;
    p.vx = 0; p.vy = 0; p.ground = null;
    if (!d) return;
    p.x = d.x - PW - 0.1;
    p.y = surfaceY(world, p.x + PW / 2) - PH;
    p.blink = 0.6;
  }

  function respawn(world, p) {
    const x = respawnX(world, p.x);
    p.x = x;
    p.y = surfaceY(world, x) - PH - 1.5;
    p.vx = 0; p.vy = 0; p.ground = null; p.boost = false;
    p.blink = 1.2;
  }

  // ひも: となりの番号の人から ROPE_LEN より遠くへは行けない
  function ropeFix(world, p, ctx, solids) {
    const e = { x: p.x, y: p.y, w: PW, h: PH };
    for (const s of [p.seat - 1, p.seat + 1]) {
      if (!ropeLinked(world.n, p.seat, s)) continue;
      const q = findPlayer(ctx.players, s);
      if (!q || q.entered) continue;
      const cx = p.x + PW / 2;
      const cy = p.y + PH / 2;
      const qx = q.x + PW / 2;
      const qy = q.y + PH / 2;
      const d = Math.hypot(qx - cx, qy - cy);
      if (d <= ROPE_LEN) continue;
      const k = (d - ROPE_LEN) / d;
      const mx = (qx - cx) * k;
      const my = (qy - cy) * k;
      e.x = p.x; e.y = p.y;
      moveX(e, mx, world, p.seat, solids);
      moveY(e, my, world, p.seat, solids, null);
      p.x = e.x; p.y = e.y;
      if ((mx > 0 && p.vx < 0) || (mx < 0 && p.vx > 0)) p.vx = 0;
      if (my < 0 && p.vy > 0) { p.vy = 0; if (qy < cy - 0.5) p.ropeTaut = true; }
    }
  }

  /* ── 箱・床・とびら・カギ・ボール（1人目の端末だけが動かす）──
   * players: 全員（自分は本当の位置、ほかの人は描く位置）
   */
  function rootOf(ref, players, depth) {
    if (!ref || depth > MAX_PLAYERS) return ref;
    if (ref[0] === 's') {
      const q = findPlayer(players, +ref.slice(1));
      return q && !q.entered ? rootOf(q.ground, players, depth + 1) : null;
    }
    return ref;
  }

  function stepObjects(world, dt, players) {
    const ctx = { gates: world.gates, boxes: world.boxes, plats: world.plats, players };
    const live = players.filter((q) => !q.entered);

    // 乗っている重さ
    const weight = world.plats.map(() => 0);
    for (const q of live) {
      const r = rootOf(q.ground, players, 0);
      if (r && r[0] === 'p') weight[+r.slice(1)] += 1;
    }
    world.boxes.forEach((b) => { if (b.ground && b.ground[0] === 'p') weight[+b.ground.slice(1)] += 1; });

    // 動く床
    world.plats.forEach((p, i) => {
      p.riders = weight[i];
      if (p.seesaw >= 0) return;
      // 人数がそろったら向こうへ。へっても少し待ってから戻る（おりる間に下がらないように）
      if (p.riders >= platNeed(p, players)) p.hold = PLAT_WAIT; else p.hold = Math.max(0, (p.hold || 0) - dt);
      const toB = p.hold > 0;
      const tx = toB ? p.bx : p.ax;
      const ty = toB ? p.by : p.ay;
      const dx = tx - p.x;
      const dy = ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = Math.min(d, PLAT_SPEED * dt);
      const ox = p.x, oy = p.y;
      if (d > EPS) { p.x += dx / d * step; p.y += dy / d * step; }
      p.dx = p.x - ox; p.dy = p.y - oy;
    });
    // シーソー
    for (const s of world.seesaws) {
      const L = world.plats[s.left];
      const R = world.plats[s.right];
      s.wl = L.riders; s.wr = R.riders;
      const target = Math.max(-SEESAW_MAX, Math.min(SEESAW_MAX, (s.wl - s.wr) * SEESAW_UNIT));
      const d = target - s.off;
      s.off += Math.sign(d) * Math.min(Math.abs(d), SEESAW_SPEED * dt);
      const ly = L.y, ry = R.y;
      L.y = s.rest + s.off; R.y = s.rest - s.off;
      L.dx = 0; R.dx = 0; L.dy = L.y - ly; R.dy = R.y - ry;
    }

    // 箱
    world.boxes.forEach((b, i) => {
      const ox = b.x, oy = b.y;
      // 押している人: 箱の横で、箱へ向かって進もうとしている人。
      // 動きだしたあとは、少し後ろにいる人も数える（ほかのウィンドウの人は、遅れたぶん後ろに見えるため）
      let push = 0, sum = 0;
      const reach = b.vx ? PUSH_REACH_MOVING : PUSH_REACH;
      for (const q of live) {
        if (!q.ground || !q.inDir) continue;
        const e = { x: q.x, y: q.y, w: PW, h: PH };
        if (!(e.y < b.y + b.h - 0.1 && e.y + e.h > b.y + 0.1)) continue;
        if (q.inDir > 0 && e.x + PW <= b.x + 0.15 && b.x - (e.x + PW) < reach) { push++; sum++; }
        if (q.inDir < 0 && e.x >= b.x + b.w - 0.15 && e.x - (b.x + b.w) < reach) { push++; sum--; }
      }
      b.pushers = push;
      b.vx = push >= b.need && sum !== 0 && b.ground ? Math.sign(sum) * BOX_SPEED : 0;
      const solids = solidsFor(0, ctx, i);
      const carrier = carryOf(b.ground, ctx);
      if (carrier && (carrier.dx || carrier.dy)) {
        moveX(b, carrier.dx, world, 0, solids);
        if (carrier.dy) moveY(b, carrier.dy, world, 0, solids, null);
      }
      moveX(b, b.vx * dt, world, 0, solids);
      b.vy = Math.min(MAX_FALL, b.vy + GRAV * dt);
      const r = moveY(b, b.vy * dt, world, 0, solids, topsFor(ctx, null));
      if (r.land) { b.vy = 0; b.ground = r.land; } else b.ground = null;
      if (b.y > H + 1) { b.x = b.x0; b.y = b.y0; b.vy = 0; b.ground = null; }
      b.dx = b.x - ox; b.dy = b.y - oy;
    });

    // スイッチ
    for (const s of world.switches) {
      const plate = { x: s.x + 0.15, w: 0.7 };
      const top = s.y + 1;
      const pressed = (e) => e.y + e.h > top - 0.3 && e.y + e.h < top + 0.05 && e.x < plate.x + plate.w && e.x + e.w > plate.x;
      // 番号のスイッチは、その番号の人だけ（箱ではおさえられない）
      s.on = live.some((q) => (!s.seatN || q.seat === s.seatN) && pressed({ x: q.x, y: q.y, w: PW, h: PH })) || (!s.seatN && world.boxes.some(pressed));
    }

    // カギ・ボール
    const holding = {};
    world.items.forEach((it, i) => { if (!it.gone && it.holder) holding[it.holder] = i; });
    world.items.forEach((it) => {
      if (it.gone || it.hooped) return;
      for (const k of Object.keys(it.cool)) { it.cool[k] -= dt; if (it.cool[k] <= 0) delete it.cool[k]; }
      if (it.holder) {
        const q = findPlayer(players, it.holder);
        if (!q) { it.holder = 0; return; }
        it.x = q.x + PW / 2 - ITEM / 2;
        it.y = q.y - ITEM - 0.02;
        // カギを持ってとびらにふれると開く
        const d = world.door;
        if (it.kind === 'key' && d && d.locked && overlap({ x: q.x, y: q.y, w: PW, h: PH }, d)) {
          d.locked = false;
          it.gone = true;
          delete holding[it.holder];
          it.holder = 0;
        }
        return;
      }
      // 閉じたとびらはカギ・ボールも通さない（開いたとびらは通す）
      const blocks = [];
      for (const g of world.gates) if (!g.open) blocks.push(gateRect(g));
      world.boxes.forEach((b) => blocks.push(b));
      it.vy = Math.min(MAX_FALL, it.vy + GRAV * dt);
      const hx = moveX(it, it.vx * dt, world, -1, blocks);
      if (hx) it.vx = -it.vx * 0.4;
      const vyBefore = it.vy;
      const r = moveY(it, it.vy * dt, world, -1, blocks, topsFor(ctx, null));
      if (r.land) {
        it.vy = vyBefore > 4 ? -vyBefore * 0.3 : 0;
        it.vx *= 0.8;
        if (Math.abs(it.vx) < 0.05) it.vx = 0;
      } else if (r.bump) it.vy = Math.abs(it.vy) * 0.3;
      if (it.y > H + 1) { it.x = it.x0; it.y = it.y0; it.vx = 0; it.vy = 0; }
      // かご
      // かご: ふちより上から落ちてきたときだけ入る
      if (it.kind === 'ball' && vyBefore > 0) {
        const cx = it.x + ITEM / 2;
        const cy = it.y + ITEM / 2;
        const py = cy - vyBefore * dt;
        for (const h of world.hoops) {
          if (!h.done && cx > h.x && cx < h.x + h.w && py < h.y && cy >= h.y) {
            h.done = true;
            it.hooped = true;
            it.x = h.x + h.w / 2 - ITEM / 2;
            it.y = h.y + h.h - ITEM;
          }
        }
      }
      if (it.hooped) return;
      // ひろう
      for (const q of live) {
        if (holding[q.seat] != null || it.cool[q.seat] > 0) continue;
        if (overlap(it, { x: q.x, y: q.y - 0.1, w: PW, h: PH + 0.1 })) {
          it.holder = q.seat;
          it.vx = 0; it.vy = 0;
          holding[q.seat] = world.items.indexOf(it);
          break;
        }
      }
    });

    // とびら
    for (const g of world.gates) {
      // all: 同じしるしのスイッチが全部おさえられたとき。latch: 一度開いたら、ずっと開いたまま
      const mine = world.switches.filter((s) => s.letter === g.letter);
      let want = (g.all ? mine.length > 0 && mine.every((s) => s.on) : mine.some((s) => s.on)) || world.hoops.some((h) => h.letter === g.letter && h.done);
      if (g.latch && want) g.latched = true;
      if (g.latched) want = true;
      const r = gateRect(g);
      const blocked = live.some((q) => overlap({ x: q.x, y: q.y, w: PW, h: PH }, r)) || world.boxes.some((b) => overlap(b, r));
      g.open = want || (g.open && blocked);
      g.anim += (g.open ? 1 : -1) * dt * 5;
      g.anim = Math.max(0, Math.min(1, g.anim));
    }

    // クリア: いる人がみんなとびらに入った（ルームからいなくなった人 absent は数えない）
    world.clear = players.length === world.n && players.some((q) => !q.absent) && players.every((q) => q.absent || (q.entered && !q.away));
  }

  function holdingOf(world, seat) {
    for (const it of world.items) if (!it.gone && it.holder === seat) return it.kind;
    return null;
  }

  // 投げる（ボール）・そっと投げる（カギ）。x, y, face は投げた人の位置
  function throwItem(world, seat, face, x, y) {
    for (const it of world.items) {
      if (it.gone || it.holder !== seat) continue;
      const t = THROW[it.kind];
      it.holder = 0;
      it.x = x + PW / 2 - ITEM / 2;
      it.y = y - ITEM - 0.02;
      it.vx = face * t.vx;
      it.vy = t.vy;
      it.cool[seat] = 0.4;
      return true;
    }
    return false;
  }

  // 画面に映すところ（全員の真ん中）
  function camLeft(world, players) {
    const live = players.filter((q) => !q.entered);
    if (!live.length) return null;
    const mid = live.reduce((a, q) => a + q.x + PW / 2, 0) / live.length;
    return Math.max(0, Math.min(world.W - VIEW, mid - VIEW / 2));
  }

  // 1台の画面でみんなを動かすときの1こま
  function stepLocal(world, inputs, dt) {
    stepObjects(world, dt, world.players);
    const l = camLeft(world, world.players);
    const cam = l == null ? null : { l, r: l + VIEW };
    const order = world.players.slice().sort((a, b) => (b.y + PH) - (a.y + PH));
    const ctx = {
      gates: world.gates, boxes: world.boxes, plats: world.plats, players: world.players,
      cam, door: world.door, holding: (s) => holdingOf(world, s),
    };
    for (const p of order) {
      const o = stepPlayer(world, p, inputs[p.seat - 1] || {}, dt, ctx);
      if (o.throw) throwItem(world, p.seat, p.face, p.x, p.y);
    }
  }


  /* ── ルームに置く形 ──
   * 人: [x, y, 向き, 乗っているもの, 押している向き, とびらに入った(0/1), 頭の上での横の位置]
   * ワールド（ホストが書く）: 箱・床・カギとボール・とびら・スイッチ・かご・ゴールのカギ・クリア
   */
  const r2 = (v) => Math.round(v * 100) / 100;
  // 1つの文字列にまとめて書く（配列より短く、通信量が少ない）。例 "12.3,9.1,1,0,0,0"
  function encodePlayer(p) {
    const out = [r2(p.x), r2(p.y), p.face < 0 ? -1 : 1, p.ground || 0, p.inDir || 0, p.entered ? 1 : 0];
    if (p.ground && 'spb'.includes(p.ground[0])) out.push(r2(p.rx));
    return out.join(',');
  }
  // こわれた値は null（前の版が書いた配列も読む）
  function decodePlayer(raw) {
    const v = typeof raw === 'string' ? raw.split(',').map((x, k) => (k === 3 ? x : Number(x))) : raw;
    if (!Array.isArray(v) || v.length < 6) return null;
    const x = Number(v[0]);
    const y = Number(v[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const g = typeof v[3] === 'string' && /^(t|g|[pbs]\d+)$/.test(v[3]) ? v[3] : null;
    return { x, y, face: v[2] < 0 ? -1 : 1, ground: g, inDir: v[4] > 0 ? 1 : v[4] < 0 ? -1 : 0, entered: Number(v[5]) === 1, rx: Number(v[6]) || 0 };
  }
  function snapshot(world) {
    return {
      b: world.boxes.map((b) => [r2(b.x), r2(b.y)]),
      p: world.plats.map((p) => [r2(p.x), r2(p.y), p.riders]),
      i: world.items.map((it) => [r2(it.x), r2(it.y), it.holder, it.hooped ? 1 : 0, it.gone ? 1 : 0]),
      g: world.gates.map((g) => (g.open ? 1 : 0)).join('') || '-',
      s: world.switches.map((s) => (s.on ? 1 : 0)).join('') || '-',
      h: world.hoops.map((h) => (h.done ? 1 : 0)).join('') || '-',
      d: world.door && world.door.locked ? 1 : 0,
      c: world.clear ? 1 : 0,
    };
  }
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const listOf = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  // とびら・スイッチなどの印と、カギ・ボールの持ち主を当てる（位置は positions のときだけ）
  function applySnapshot(world, w, positions) {
    if (!w || typeof w !== 'object') return;
    const bs = listOf(w.b), ps = listOf(w.p), is = listOf(w.i);
    const bit = (str, k) => typeof str === 'string' && str[k] === '1';
    world.gates.forEach((g, k) => { g.open = bit(w.g, k); });
    world.switches.forEach((s, k) => { s.on = bit(w.s, k); });
    world.hoops.forEach((h, k) => { h.done = bit(w.h, k); });
    if (world.door) world.door.locked = w.d === 1;
    world.clear = w.c === 1;
    world.items.forEach((it, k) => {
      const v = listOf(is[k]);
      if (v.length < 5) return;
      const holder = Math.trunc(num(v[2], 0));
      it.holder = holder >= 1 && holder <= world.n ? holder : 0;
      it.hooped = v[3] === 1; it.gone = v[4] === 1;
      if (positions) { it.x = num(v[0], it.x); it.y = num(v[1], it.y); it.vx = 0; it.vy = 0; }
    });
    world.plats.forEach((p, k) => {
      const v = listOf(ps[k]);
      if (v.length < 2) return;
      p.riders = Math.max(0, Math.trunc(num(v[2], 0)));
      if (positions) { p.x = num(v[0], p.x); p.y = num(v[1], p.y); }
    });
    if (positions) {
      world.boxes.forEach((b, k) => { const v = listOf(bs[k]); if (v.length >= 2) { b.x = num(v[0], b.x); b.y = num(v[1], b.y); b.vy = 0; b.ground = null; } });
      for (const s of world.seesaws) s.off = world.plats[s.left].y - s.rest;
      for (const g of world.gates) { g.anim = g.open ? 1 : 0; if (g.latch) g.latched = g.open; }
    }
  }

  const api = {
    H, VIEW, PW, PH, ITEM, ROPE_LEN, JUMP_H, GRAV, JUMP_V, SPEED, SPRING_H,
    STAGES, buildStage, createWorld, makePlayer, stepPlayer, stepObjects, stepLocal,
    throwItem, holdingOf, camLeft, mapSeat, solidTile, respawnX, surfaceY, gateRect, rootOf,
    encodePlayer, decodePlayer, snapshot, applySnapshot, MIN_PLAYERS: 2, MAX_PLAYERS, ALL_CAP, ropeGroups, ropeLinked, platNeed,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NoriaiEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
