/* そろってゴール（試作） — ステージと動きのルール
   画面と通信に触らない。ブラウザでは window.SorotteEngine、node では module.exports。
   状態は JSON にできる値だけで持つ（本体にするときは、そのままルームに置ける形）。

   マスの記号:
     #  かべ          .  ゆか          G  ゴール
     1 2  はじめの場所（1人目・2人目）
     a b  スイッチ（まる・さんかく）   A B  とびら（同じしるしのスイッチに、人か箱が乗っている間だけ開く）
     O  重い箱（うしろからもう1人が押すと動く）
     k  カギ          L  かぎつきのとびら（カギを持った人が入ると開いたままになる）
     p q  橋（p は1人目だけ・q は2人目だけ渡れる） */
(function (root) {
  'use strict';

  const STAGES = [
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
  const PLAYERS = 2;
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const SWITCH_OF = { A: 'a', B: 'b' };
  const BRIDGE_OF = { p: 0, q: 1 };

  // ステージの動かない部分（かべ・ゆか・スイッチ・とびら・橋・ゴール）。人・箱・カギは抜いて、ゆかにする
  const STATIC = STAGES.map((st) => {
    const h = st.rows.length;
    const w = st.rows[0].length;
    const tiles = [];
    const starts = [];
    const boxes = [];
    const keys = [];
    st.rows.forEach((row, y) => {
      if (row.length !== w) throw new Error('ステージの行の長さがそろっていない: ' + st.name);
      row.split('').forEach((ch, x) => {
        if (ch === '1' || ch === '2') { starts[Number(ch) - 1] = [x, y]; tiles.push('.'); }
        else if (ch === 'O') { boxes.push([x, y]); tiles.push('.'); }
        else if (ch === 'k') { keys.push([x, y]); tiles.push('.'); }
        else tiles.push(ch);
      });
    });
    return { w, h, tiles, starts, boxes, keys };
  });

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const tileAt = (stage, x, y) => {
    const T = STATIC[stage];
    return x < 0 || y < 0 || x >= T.w || y >= T.h ? '#' : T.tiles[y * T.w + x];
  };
  const at = (list, x, y) => list.findIndex((p) => p[0] === x && p[1] === y);

  function createStage(stage) {
    const T = STATIC[stage];
    return {
      stage,
      players: T.starts.map(([x, y]) => ({ x, y, key: false })),
      boxes: clone(T.boxes),
      keys: clone(T.keys),
      open: [],        // 開けた、かぎつきのとびら [x, y]
      cleared: false,
      rev: 0,          // 動くたびに1増える
    };
  }

  // しるし c のスイッチに、人か箱が乗っているか
  function held(S, c) {
    const T = STATIC[S.stage];
    const on = (x, y) => T.tiles[y * T.w + x] === c;
    return S.players.some((p) => on(p.x, p.y)) || S.boxes.some((b) => on(b[0], b[1]));
  }

  // とびらが開いているか（画面でも使う）
  function doorOpen(S, x, y) {
    const t = tileAt(S.stage, x, y);
    if (SWITCH_OF[t]) return held(S, SWITCH_OF[t]);
    if (t === 'L') return at(S.open, x, y) >= 0;
    return true;
  }

  // 箱を置けるマス
  function boxCanEnter(S, x, y) {
    const t = tileAt(S.stage, x, y);
    if (!(t === '.' || t === 'a' || t === 'b' || t === 'G')) return false;
    return at(S.boxes, x, y) < 0 && !S.players.some((p) => p.x === x && p.y === y) && at(S.keys, x, y) < 0;
  }

  // who 番の人が dir へ1マス動く。動けないときは同じ状態を返す
  function move(S0, who, dir) {
    const d = DIRS[dir];
    const me = S0.players[who];
    if (!d || !me || S0.cleared) return S0;
    const [dx, dy] = d;
    const tx = me.x + dx;
    const ty = me.y + dy;
    const t = tileAt(S0.stage, tx, ty);
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
    S.cleared = S.players.every((q) => tileAt(S.stage, q.x, q.y) === 'G');
    S.rev += 1;
    return S;
  }

  const api = { STAGES, STATIC, PLAYERS, DIRS, SWITCH_OF, BRIDGE_OF, createStage, tileAt, held, doorOpen, move };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SorotteEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
