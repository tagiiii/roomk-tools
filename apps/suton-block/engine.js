/* すとんブロック 盤とブロックのしくみ（画面を持たない）
   ブラウザでは window.SutonEngine、node では require で読む。
   ・盤は横10・たて20。上にはみ出した部分（y < 0）は空きとして扱う
   ・ブロックは1〜4マスの8種類。回す・裏返す（左右反転）・1つとっておく、ができる
   ・回せないときは、少しずらして試す（回す向きの側を先に・下へのねじこみ・4マスの棒は大きめ）
   ・横1段がうまったら消える。いっぱいになったら「おしまい」か「からにしてつづける」
   ・ルームで「じゃまあり」なら、下から1列あいた段（じゃまブロック）が押し上げてくる */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SutonEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const W = 10;
  const H = 20;

  // 形は n×n の箱の中のマス [x, y]。色は画面側で kind から決める
  const SHAPES = {
    bou4:  { n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
    shikaku: { n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    yama:  { n: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
    zure:  { n: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
    kagi4: { n: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
    bou3:  { n: 3, cells: [[0, 1], [1, 1], [2, 1]] },
    kagi3: { n: 2, cells: [[0, 0], [0, 1], [1, 1]] },
    futa:  { n: 2, cells: [[0, 0], [1, 0]] },
  };
  const KINDS = Object.keys(SHAPES);

  // 回せないときに試すずらし方（独自。y は負が上・正が下）
  //   s は回す向き（右回り 1・左回り -1）。回す向きの側を先に試す
  //   1) その場 2) 横に1マス 3) 下に1マス（張り出しの下のすき間へねじこむ）
  //   4) 上に1マス（床ぎわ） 5) 横に2マス。4マスの棒だけは、横に2マス＋上に1マスも試す
  function kicksFor(kind, s) {
    const k = [
      [0, 0],
      [s, 0], [-s, 0],
      [0, 1], [s, 1], [-s, 1],
      [0, -1], [s, -1], [-s, -1],
      [2 * s, 0], [-2 * s, 0],
    ];
    if (kind === 'bou4') k.push([2 * s, -1], [-2 * s, -1]);
    return k;
  }
  const KICKS = kicksFor('', 1);

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

  // 8種類を1回ずつ混ぜた袋から順に出す。半分の確率で裏返した向きで出す
  function makeBag(rand) {
    const bag = KINDS.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag.map((kind) => ({ kind, flip: rand() < 0.5 }));
  }

  function rotateCells(cells, n) { return cells.map(([x, y]) => [n - 1 - y, x]); }
  function flipCells(cells, n) { return cells.map(([x, y]) => [n - 1 - x, y]); }

  function newPiece(spec) {
    const s = SHAPES[spec.kind];
    let cells = s.cells.map((c) => c.slice());
    if (spec.flip) cells = flipCells(cells, s.n);
    return { kind: spec.kind, flip: !!spec.flip, n: s.n, cells, x: Math.floor((W - s.n) / 2), y: -1 };
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
      hold: null,       // とっておいたブロック（{ kind, flip }）
      holdUsed: false,  // いまのブロックで、もう「とっておく」を使ったか
      onFull: o.onFull, // 'clear' = からにしてつづける / 'end' = おしまい
      rand,
    };
    fillQueue(g);
    spawn(g);
    return g;
  }

  function fillQueue(g) {
    while (g.queue.length < 4) g.queue.push(...makeBag(g.rand));
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

  function tryCells(g, cells, s) {
    const p = g.piece;
    for (const [kx, ky] of kicksFor(p.kind, s)) {
      if (fits(g.board, p, cells, p.x + kx, p.y + ky)) {
        p.cells = cells; p.x += kx; p.y += ky;
        return true;
      }
    }
    return false;
  }

  // dir: 1 = 右回り / -1 = 左回り
  function rotate(g, dir) {
    const p = g.piece;
    if (!p || g.over) return false;
    let cells = rotateCells(p.cells, p.n);
    if (dir < 0) cells = rotateCells(rotateCells(cells, p.n), p.n);
    return tryCells(g, cells, dir < 0 ? -1 : 1);
  }

  function flip(g) {
    const p = g.piece;
    if (!p || g.over) return false;
    return tryCells(g, flipCells(p.cells, p.n), 1);
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
    g.hold = { kind: p.kind, flip: p.flip };
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
  const CODE = { bou4: 'a', shikaku: 'b', yama: 'c', zure: 'd', kagi4: 'e', bou3: 'f', kagi3: 'g', futa: 'h', jama: 'j' };
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
    g.hold = s.hold && SHAPES[s.hold.kind] ? { kind: s.hold.kind, flip: !!s.hold.flip } : null;
    g.holdUsed = !!s.holdUsed;
    if (!fits(g.board, g.piece, g.piece.cells, g.piece.x, g.piece.y)) {
      if (g.onFull === 'end') { g.piece = null; g.over = true; }
      else { g.board = emptyBoard(); g.resets++; }
    }
    return g;
  }

  return {
    W, H, SHAPES, KINDS, KICKS, kicksFor,
    rng, makeBag, newPiece, emptyBoard, fits,
    createGame, spawn, move, rotate, flip, dropY, lock, hardDrop, addGarbage, hold,
    packBoard, unpackBoard, cellsOf, restoreGame,
  };
});
