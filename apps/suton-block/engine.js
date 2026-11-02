/* すとんブロック 盤とブロックのしくみ（画面を持たない）
   ブラウザでは window.SutonEngine、node では require で読む。
   ・盤は横10・たて20。上にはみ出した部分（y < 0）は空きとして扱う
   ・ブロックは4マスの7種類（I・O・T・S・Z・L・J）。回す・1つとっておく、ができる
   ・回せないときは、向きの組み合わせごとに決まった5通りのずらし方を順に試す（よく知られた回し方と同じ）
   ・横1段がうまったら消える。いっぱいになったら「おしまい」か「からにしてつづける」
   ・ルームで「じゃまあり」なら、下から1列あいた段（じゃまブロック）が押し上げてくる */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SutonEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 10;
  const H = 20;

  // 形は n×n の箱の中のマス [x, y]（はじめの向き）。色は画面側で kind から決める
  // 箱の中で回すと、よく知られた回し方と同じ向きの変わり方になる（I は4×4、O は2×2、ほかは3×3）
  const SHAPES = {
    I: { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    O: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    T: { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    S: { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    Z: { n: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
    L: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    J: { n: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  };
  const KINDS = Object.keys(SHAPES);

  // 回せないときに試すずらし方。向きは 0 = はじめ・1 = 右に1回・2 = 2回・3 = 左に1回。
  // 「いまの向き > 回した先の向き」ごとに5通りを順に試す（y は負が上・正が下）。
  // I とそれ以外で表が分かれる。O は回しても形が変わらないので、その場だけ
  const KICKS_JLSTZ = {
    '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  };
  const KICKS_I = {
    '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
    '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
    '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
    '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
    '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  };
  function kicksFor(kind, from, to) {
    if (kind === 'O') return [[0, 0]];
    return (kind === 'I' ? KICKS_I : KICKS_JLSTZ)[from + '>' + to];
  }

  // 同じ種(seed)なら同じ順番でブロックが出る（ルームでみんなの出る順をそろえる）
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 7種類を1回ずつ混ぜた袋から順に出す
  function makeBag(rand) {
    const bag = KINDS.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag.map((kind) => ({ kind }));
  }

  function rotateCells(cells, n) { return cells.map(([x, y]) => [n - 1 - y, x]); }

  function newPiece(spec) {
    const s = SHAPES[spec.kind];
    return { kind: spec.kind, n: s.n, rot: 0, cells: s.cells.map((c) => c.slice()), x: Math.floor((W - s.n) / 2), y: -1 };
  }

  function emptyBoard() {
    const b = [];
    for (let y = 0; y < H; y++) b.push(new Array(W).fill(null));
    return b;
  }

  function fits(board, p, cells, x, y) {
    for (const [cx, cy] of cells) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= W || by >= H) return false;
      if (by >= 0 && board[by][bx]) return false;
    }
    return true;
  }

  function createGame(opts) {
    const o = Object.assign({ seed: 1, onFull: 'clear' }, opts);
    const rand = rng(o.seed);
    const g = {
      board: emptyBoard(),
      piece: null,
      queue: [],
      lines: 0,
      pieces: 0,
      resets: 0,
      taken: 0,         // 出る順番の列から取り出した数（読み込み直したとき、同じところから続けるため）
      over: false,
      hold: null,       // とっておいたブロック（{ kind }）
      holdUsed: false,  // いまのブロックで、もう「とっておく」を使ったか
      onFull: o.onFull, // 'clear' = からにしてつづける / 'end' = おしまい
      rand,
    };
    fillQueue(g);
    spawn(g);
    return g;
  }

  // 「つぎ」に5つ出せるよう、いつも5つ以上先まで並べておく（袋を足すのが早まるだけで、出る順番は変わらない）
  function fillQueue(g) {
    while (g.queue.length < 5) g.queue.push(...makeBag(g.rand));
  }

  // つぎのブロックを出す。出せないときは、いっぱい
  function spawn(g, spec) {
    fillQueue(g);
    if (!spec) g.taken++;
    const p = newPiece(spec || g.queue.shift());
    fillQueue(g);
    g.holdUsed = !!spec;
    if (!fits(g.board, p, p.cells, p.x, p.y)) {
      if (g.onFull === 'end') { g.piece = null; g.over = true; return { full: true }; }
      g.board = emptyBoard();
      g.resets++;
      g.piece = p;
      return { full: true, cleared: true };
    }
    g.piece = p;
    return { full: false };
  }

  function move(g, dx, dy) {
    const p = g.piece;
    if (!p || g.over) return false;
    if (!fits(g.board, p, p.cells, p.x + dx, p.y + dy)) return false;
    p.x += dx; p.y += dy;
    return true;
  }

  // dir: 1 = 右回り / -1 = 左回り
  function rotate(g, dir) {
    const p = g.piece;
    if (!p || g.over) return false;
    let cells = rotateCells(p.cells, p.n);
    if (dir < 0) cells = rotateCells(rotateCells(cells, p.n), p.n);
    const from = p.rot || 0;
    const to = (from + (dir < 0 ? 3 : 1)) % 4;
    for (const [kx, ky] of kicksFor(p.kind, from, to)) {
      if (fits(g.board, p, cells, p.x + kx, p.y + ky)) {
        p.cells = cells; p.rot = to; p.x += kx; p.y += ky;
        return true;
      }
    }
    return false;
  }

  function dropY(g) {
    const p = g.piece;
    if (!p) return 0;
    let y = p.y;
    while (fits(g.board, p, p.cells, p.x, y + 1)) y++;
    return y;
  }

  // 置いて、うまった段を消し、つぎを出す。消した段数・いっぱいになったかを返す
  function lock(g) {
    const p = g.piece;
    if (!p || g.over) return { lines: 0 };
    const aboveCells = [];
    for (const [cx, cy] of p.cells) {
      const by = p.y + cy;
      if (by < 0) { aboveCells.push([p.x + cx, by]); continue; }
      g.board[by][p.x + cx] = p.kind;
    }
    g.pieces++;
    g.holdUsed = false;
    const rows = [];
    for (let y = 0; y < H; y++) if (g.board[y].every((c) => c)) rows.push(y);
    if (rows.length) {
      g.board = g.board.filter((_, y) => !rows.includes(y));
      while (g.board.length < H) g.board.unshift(new Array(W).fill(null));
      g.lines += rows.length;
    }
    // 上にはみ出していたマスは、消えた段の数だけ下がって盤に入る。それでも上に残れば、いっぱい
    let above = false;
    for (const [x, by] of aboveCells) {
      const ny = by + rows.length;
      if (ny >= 0) g.board[ny][x] = p.kind;
      else above = true;
    }
    let res;
    if (above) {
      // 上にはみ出して置いた（消えても入りきらなかった）＝いっぱい
      if (g.onFull === 'end') { g.piece = null; g.over = true; res = { full: true }; }
      else { g.board = emptyBoard(); g.resets++; res = Object.assign({ full: true, cleared: true }, spawnOnly(g)); }
    } else {
      res = spawn(g);
    }
    return Object.assign({ lines: rows.length, rows }, res);
  }

  function spawnOnly(g) {
    fillQueue(g);
    g.taken++;
    g.piece = newPiece(g.queue.shift());
    fillQueue(g);
    return {};
  }

  // とっておく: いまのブロックをはじめの向きでしまい、しまってあったもの（なければ、つぎ）を出す。
  // 1つのブロックにつき1回だけ（置いたら、また使える）
  function hold(g) {
    const p = g.piece;
    if (!p || g.over || g.holdUsed) return false;
    const out = g.hold;
    g.hold = { kind: p.kind };
    const res = out ? spawn(g, out) : spawn(g);
    g.holdUsed = true;
    return Object.assign({ held: true }, res);
  }

  // じゃまブロック（ルームで「じゃまあり」のとき）。下から rows 段、gapX の列だけあけて押し上げる。
  // 上にはみ出したら、いっぱいと同じ扱い。いま落ちているブロックは重なるぶん上へよける
  function addGarbage(g, rows, gapX) {
    if (g.over || rows <= 0) return { full: false };
    rows = Math.min(rows, H);
    const spill = g.board.slice(0, rows).some((r) => r.some(Boolean));
    if (spill) {
      if (g.onFull === 'end') { g.piece = null; g.over = true; return { full: true }; }
      g.board = emptyBoard();
      g.resets++;
      return { full: true, cleared: true };
    }
    g.board = g.board.slice(rows);
    for (let i = 0; i < rows; i++) {
      const row = new Array(W).fill('jama');
      row[((gapX % W) + W) % W] = null;
      g.board.push(row);
    }
    const p = g.piece;
    if (p) {
      let up = 0;
      while (!fits(g.board, p, p.cells, p.x, p.y) && up < rows) { p.y--; up++; }
    }
    return { full: false };
  }

  function hardDrop(g) {
    if (!g.piece || g.over) return { lines: 0, dist: 0 };
    const y = dropY(g);
    const dist = y - g.piece.y;
    g.piece.y = y;
    return Object.assign({ dist }, lock(g));
  }

  // ルームでほかの人に見せる盤（ブロックの種類の頭文字、空きは .）
  const CODE = { I: 'a', O: 'b', T: 'c', S: 'd', L: 'e', Z: 'f', J: 'g', jama: 'j' };
  const UNCODE = Object.fromEntries(Object.entries(CODE).map(([k, v]) => [v, k]));
  function packBoard(board) { return board.map((r) => r.map((c) => (c ? CODE[c] : '.')).join('')).join(''); }
  function unpackBoard(s) {
    const b = emptyBoard();
    if (typeof s !== 'string' || s.length !== W * H) return b;
    for (let i = 0; i < s.length; i++) b[Math.floor(i / W)][i % W] = UNCODE[s[i]] || null;
    return b;
  }

  function cellsOf(spec) { return newPiece(spec); }

  // 読み込み直したとき: 同じ種で作りなおし、列から取り出した数まで進めて、盤・段の数・とっておいたものを戻す。
  // 落ちていた途中のブロックは、はじめの位置から出なおす
  function restoreGame(opts, saved) {
    const g = createGame(opts);
    const s = saved || {};
    const taken = Math.max(1, Math.min(100000, Number(s.taken) || 1));
    while (g.taken < taken) spawnOnly(g);
    g.board = unpackBoard(s.b);
    g.lines = Math.max(0, Number(s.lines) || 0);
    g.pieces = Math.max(0, Number(s.pieces) || 0);
    g.resets = Math.max(0, Number(s.resets) || 0);
    g.hold = s.hold && SHAPES[s.hold.kind] ? { kind: s.hold.kind } : null;
    g.holdUsed = !!s.holdUsed;
    if (!fits(g.board, g.piece, g.piece.cells, g.piece.x, g.piece.y)) {
      if (g.onFull === 'end') { g.piece = null; g.over = true; }
      else { g.board = emptyBoard(); g.resets++; }
    }
    return g;
  }

  return {
    W, H, SHAPES, KINDS, kicksFor,
    rng, makeBag, newPiece, emptyBoard, fits,
    createGame, spawn, move, rotate, dropY, lock, hardDrop, addGarbage, hold,
    packBoard, unpackBoard, cellsOf, restoreGame,
  };
});
