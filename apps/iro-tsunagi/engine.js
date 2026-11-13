/* いろつなぎ — ルールだけ。画面・時間には触らない
 * 盤: 横 W・たて H。y = -1 は盤のすぐ上の見えない段（2つめの玉が出る所）
 * 玉は 1〜colors の数。0 は空き。9 はじゃまの玉（対戦で送られてくる。つながらず、となりの玉が消えるといっしょに消える）
 * 2つ1組で落ちる。軸の玉 (x, y) と、まわりを回る玉（rot 0:上 1:右 2:下 3:左）
 */
(function (root) {
  'use strict';

  const W = 6;
  const H = 12;
  const TOP = -1;          // 見えない段
  const SPAWN_X = 2;
  const POP = 4;           // この数つながると消える
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  const JAMA = 9;
  const JAMA_MAX = 30;     // 1回に落ちてくるじゃまの玉の数（5段ぶん）。のこりはつぎに置いたあと

  // 盤は rows[y + 1][x]（y = -1 から H-1 まで）
  function emptyBoard() {
    const rows = [];
    for (let i = 0; i < H + 1; i++) rows.push(new Array(W).fill(0));
    return rows;
  }
  function get(board, x, y) {
    if (x < 0 || x >= W || y >= H) return -1;   // 壁・床
    if (y < TOP) return 0;                       // 見えない段より上は空き
    return board[y + 1][x];
  }
  function set(board, x, y, v) {
    if (x < 0 || x >= W || y < TOP || y >= H) return;
    board[y + 1][x] = v;
  }

  // 0〜1 の乱数を返す関数（シードつき。ためすときに同じ順にできる）
  function rng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // 色の袋: どの色も同じ数（4つずつ）入れて混ぜ、2つずつ取り出す。袋がからになったら入れなおす
  // （運で同じ色ばかり・ある色が来ないが長く続かないように）
  const PER_COLOR = 4;
  function refill(g) {
    const bag = [];
    for (let c = 1; c <= g.colors; c++) for (let i = 0; i < PER_COLOR; i++) bag.push(c);
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(g.rand() * (i + 1));
      const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
    }
    g.bag = bag;
  }
  function nextPair(g) {
    if (g.bag.length < 2) refill(g);
    return [g.bag.pop(), g.bag.pop()];
  }

  function newGame(opts) {
    const colors = Math.min(5, Math.max(3, opts.colors || 4));
    const rand = rng(opts.seed || Date.now());
    const g = {
      board: emptyBoard(),
      colors,
      rand,
      queue: [],
      piece: null,
      score: 0,
      bestChain: 0,
      pops: 0,          // 消した玉の数
      clears: 0,        // からにしてつづけた回数
      allClears: 0,     // 消して盤が全部なくなった回数
      taken: 0,         // 出した組の数（読み込み直したとき、同じ順番の続きにするため）
      bag: [],
    };
    // 袋の色の数は、はじめは3色、1袋使い切ってから選んだ数にする（いきなり手づまりになりにくく）
    const want = colors;
    g.colors = Math.min(3, want);
    refill(g);
    g.colors = want;
    g.queue.push(nextPair(g), nextPair(g), nextPair(g));
    return g;
  }

  function cells(p) {
    return [
      { x: p.x, y: p.y, c: p.a },
      { x: p.x + DX[p.rot], y: p.y + DY[p.rot], c: p.b },
    ];
  }

  function fits(board, p) {
    return cells(p).every(function (q) { return get(board, q.x, q.y) === 0; });
  }

  // 次の組を出す。出る所がふさがっていたら false（盤がいっぱい）
  function spawn(g) {
    const pair = g.queue.shift();
    g.queue.push(nextPair(g));
    g.taken++;
    const p = { x: SPAWN_X, y: 0, rot: 0, a: pair[0], b: pair[1] };
    if (get(g.board, SPAWN_X, 0) !== 0) { g.piece = null; return false; }
    g.piece = p;
    return true;
  }

  function move(g, dx) {
    if (!g.piece) return false;
    const p = Object.assign({}, g.piece, { x: g.piece.x + dx });
    if (!fits(g.board, p)) return false;
    g.piece = p;
    return true;
  }

  function down(g) {
    if (!g.piece) return false;
    const p = Object.assign({}, g.piece, { y: g.piece.y + 1 });
    if (!fits(g.board, p)) return false;
    g.piece = p;
    return true;
  }

  // 回す（dir: 1 右回り / -1 左回り）。入らないときは、横にずらす・上にずらす の順にためす。
  // 1列のすき間で縦のまま回せないときは、flip が true のとき（画面では、すぐにもう一度押したとき）だけ上下を入れかえる
  function rotate(g, dir, flip) {
    if (!g.piece) return false;
    const cur = g.piece;
    const rot = (cur.rot + dir + 4) % 4;
    const tries = [
      { x: cur.x, y: cur.y },
      { x: cur.x - DX[rot], y: cur.y },      // 壁や玉に当たったら反対へ1つずらす
      { x: cur.x, y: cur.y - DY[rot] },      // 下に当たったら1つ上げる
    ];
    for (let i = 0; i < tries.length; i++) {
      const p = { x: tries[i].x, y: tries[i].y, rot, a: cur.a, b: cur.b };
      if (p.y < 0) continue;                 // 軸は盤の中に置く
      if (fits(g.board, p)) { g.piece = p; return true; }
    }
    if (flip && (cur.rot === 0 || cur.rot === 2)) {
      g.piece = Object.assign({}, cur, { a: cur.b, b: cur.a });
      return true;
    }
    return false;
  }

  function hardDropRows(g) {
    let n = 0;
    while (down(g)) n++;
    return n;
  }

  // 組を盤に置く（このあと settle で落として消す）
  function lock(g) {
    if (!g.piece) return;
    cells(g.piece).forEach(function (q) { set(g.board, q.x, q.y, q.c); });
    g.piece = null;
  }

  // 浮いている玉を下へ落とす。動いた玉の [{x, from, to}] を返す
  function gravity(board) {
    const moved = [];
    for (let x = 0; x < W; x++) {
      let write = H - 1;
      for (let y = H - 1; y >= TOP; y--) {
        const v = get(board, x, y);
        if (v === 0) continue;
        if (y !== write) {
          set(board, x, write, v);
          set(board, x, y, 0);
          moved.push({ x, from: y, to: write, c: v });
        }
        write--;
      }
    }
    return moved;
  }

  // POP 個以上つながった同じ色のまとまり（見えない段はふくめない）
  function findGroups(board) {
    const seen = {};
    const groups = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c = get(board, x, y);
        if (!c || c === JAMA || seen[x + ',' + y]) continue;
        const group = [];
        const stack = [{ x, y }];
        seen[x + ',' + y] = true;
        while (stack.length) {
          const q = stack.pop();
          group.push(q);
          for (let d = 0; d < 4; d++) {
            const nx = q.x + DX[d];
            const ny = q.y + DY[d];
            if (ny < 0 || seen[nx + ',' + ny]) continue;
            if (get(board, nx, ny) !== c) continue;
            seen[nx + ',' + ny] = true;
            stack.push({ x: nx, y: ny });
          }
        }
        if (group.length >= POP) groups.push({ c, cells: group });
      }
    }
    return groups;
  }

  // 1回分の「消す」。消えたら { groups, chain, points } を返し、なければ null
  function popOnce(g, chain) {
    const groups = findGroups(g.board);
    if (!groups.length) return null;
    let n = 0;
    const jama = [];
    groups.forEach(function (gr) {
      gr.cells.forEach(function (q) {
        // となりのじゃまの玉も、いっしょに消える（数・点には入れない）
        for (let d = 0; d < 4; d++) {
          const nx = q.x + DX[d];
          const ny = q.y + DY[d];
          if (ny >= 0 && get(g.board, nx, ny) === JAMA && !jama.some(function (j) { return j.x === nx && j.y === ny; })) jama.push({ x: nx, y: ny });
        }
      });
    });
    groups.forEach(function (gr) {
      gr.cells.forEach(function (q) { set(g.board, q.x, q.y, 0); });
      n += gr.cells.length;
    });
    jama.forEach(function (q) { set(g.board, q.x, q.y, 0); });
    const points = n * 10 * chain * (groups.length > 1 ? groups.length : 1);
    if (jama.length) groups.push({ c: JAMA, cells: jama });   // 画面で消えるのを見せる（点には入れない）
    g.score += points;
    g.pops += n;
    if (chain > g.bestChain) g.bestChain = chain;
    return { groups, chain, points, count: n };
  }

  // 落とす→消す をくりかえした手順を全部返す（画面はこれを順に見せる）
  function settle(g) {
    const steps = [];
    let chain = 0;
    for (;;) {
      const moved = gravity(g.board);
      if (moved.length) steps.push({ type: 'fall', moved });
      const r = popOnce(g, chain + 1);
      if (!r) break;
      chain++;
      steps.push({ type: 'pop', groups: r.groups, chain, points: r.points, count: r.count });
    }
    const allClear = chain > 0 && isEmpty(g.board);
    if (allClear) g.allClears++;
    return { steps, chain, allClear, attack: attackOf(steps, allClear) };
  }

  function isEmpty(board) {
    return board.every(function (row) { return row.every(function (v) { return v === 0; }); });
  }

  function clearBoard(g) {
    g.board = emptyBoard();
    g.clears++;
  }

  // 置いたらどこに落ちるか（影の表示用）
  function ghost(g) {
    if (!g.piece) return null;
    // 2つの玉がそれぞれ落ちる先（下の玉から積む）
    const cs = cells(g.piece).sort(function (a, b) { return b.y - a.y; });
    const tops = {};
    return cs.map(function (q) {
      if (tops[q.x] === undefined) {
        let y = Math.max(q.y, TOP);
        while (get(g.board, q.x, y + 1) === 0) y++;
        tops[q.x] = y + 1;
      }
      const y = tops[q.x] - 1;
      tops[q.x] = y;
      return { x: q.x, y, c: q.c };
    });
  }

  // 対戦で送るじゃまの玉の数（いろつなぎの数え方）。
  // れんさ1つめは5つ以上で消したぶん（4つなら0）、2れんさ目から 3・6・10・14…（4ずつ増える）に、5つ以上のぶんを足す。全部消えたら＋6
  function chainSend(c) {
    if (c <= 1) return 0;
    if (c === 2) return 3;
    if (c === 3) return 6;
    return 10 + (c - 4) * 4;
  }
  function attackOf(steps, allClear) {
    let n = 0;
    steps.forEach(function (st) {
      if (st.type === 'pop') n += chainSend(st.chain) + Math.max(0, st.count - POP);
    });
    if (allClear) n += 6;
    return n;
  }

  // じゃまの玉を n 個（JAMA_MAX まで）上から落とす。6つごとに1段そろえ、あまりはばらばらの列に。rand は 0〜1 の関数
  // 落とした数と、動いた玉（画面で落ちるのを見せる）を返す
  function addJama(g, n, rand) {
    n = Math.max(0, Math.min(JAMA_MAX, n | 0));
    const cols = new Array(W).fill(Math.floor(n / W));
    const rest = n % W;
    const order = [];
    for (let x = 0; x < W; x++) order.push(x);
    for (let i = W - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = order[i]; order[i] = order[j]; order[j] = t; }
    for (let i = 0; i < rest; i++) cols[order[i]]++;
    const moved = [];
    let placed = 0;
    for (let x = 0; x < W; x++) {
      // その列のいちばん上の玉のすぐ上から積む（見えない段より上にはみ出したぶんは入らない）
      let top = H;
      for (let y = TOP; y < H; y++) if (get(g.board, x, y) !== 0) { top = y; break; }
      for (let k = 0; k < cols[x]; k++) {
        const y = top - 1 - k;
        if (y < TOP) break;
        set(g.board, x, y, JAMA);
        moved.push({ x, from: TOP - 1 - k, to: y, c: JAMA });
        placed++;
      }
    }
    return { placed, moved };
  }

  // 盤を文字にする（ルームで送る・読み込み直しで戻す）。見えない段もふくめて (H+1)×W 文字。0〜5・9
  function packBoard(board) {
    return board.map(function (row) { return row.join(''); }).join('');
  }
  function unpackBoard(text) {
    if (typeof text !== 'string' || text.length !== (H + 1) * W || /[^0-59]/.test(text)) return null;
    const b = emptyBoard();
    for (let i = 0; i < text.length; i++) b[Math.floor(i / W)][i % W] = Number(text[i]);
    return b;
  }

  // ルームで読み込み直したとき: 同じ種で、出した組の数（taken）まで進めて、同じ順番の続きにする
  function restoreGame(opts, saved) {
    const g = newGame(opts);
    const b = unpackBoard(saved.b);
    if (b) g.board = b;
    const taken = Math.max(0, Math.min(100000, Number(saved.taken) || 0));
    for (let i = 0; i < taken; i++) { g.queue.shift(); g.queue.push(nextPair(g)); }
    g.taken = taken;
    ['score', 'bestChain', 'pops', 'clears', 'allClears'].forEach(function (k) { g[k] = Math.max(0, Number(saved[k]) || 0); });
    return g;
  }

  const api = {
    W, H, TOP, POP, DX, DY,
    emptyBoard, get, set, rng, newGame, cells, fits, spawn, move, down, rotate,
    hardDropRows, lock, gravity, findGroups, popOnce, settle, clearBoard, ghost, isEmpty, PER_COLOR,
    JAMA, JAMA_MAX, chainSend, attackOf, addJama, packBoard, unpackBoard, restoreGame,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.IroEngine = api;
})(typeof window !== 'undefined' ? window : this);
