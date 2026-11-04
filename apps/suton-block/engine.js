/* すとんブロック 盤とブロックのしくみ（画面を持たない）
   ブラウザでは window.SutonEngine、node では require で読む。
   ・盤は横10・たて20。上にはみ出した部分（y < 0）は空きとして扱う
   ・ブロックは4マスの7種類（I・O・T・S・Z・L・J）。回す・1つとっておく、ができる
   ・回せないときは、向きの組み合わせごとに決まった5通りのずらし方を順に試す（よく知られた回し方と同じ）
   ・横1段がうまったら消える。いっぱいになったら「おしまい」か「からにしてつづける」
   ・ルームで「じゃまあり」なら、下から1列あいた段（じゃまブロック）が押し上げてくる
   ・対戦で送るじゃまの数は、よく知られた対戦の表で決める（attackOf。回し入れ・つづけて大技・れんぞく・全部消す） */
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
  // 対戦で送るじゃまの数（よく知られた対戦の表と同じ）。消した段の数ごと
  const ATTACK_LINES = [0, 0, 1, 2, 4];       // ふつうに消した
  const ATTACK_SPIN = [0, 2, 4, 6];           // T を回し入れて消した
  const ATTACK_MINI = [0, 0, 1];              // 小さな回し入れ（ふつうと同じ数）
  const ATTACK_COMBO = [0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 4, 5]; // れんぞくで消した回数（1回目が0）ごとに足す。11回目からは5
  const ATTACK_ALL_CLEAR = 10;                // 盤が全部消えた
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

  // 盤をからにしてつづける。れんぞく・つづけて大技もそこまで
  function resetBoard(g) {
    g.board = emptyBoard();
    g.resets++;
    g.b2b = false;
    g.combo = -1;
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
      b2b: false,       // 前に消したのが大技（4段・回し入れ）だったか
      combo: -1,        // れんぞくで消した回数（消さずに置くと -1 にもどる）
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
      resetBoard(g);
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
    p.spun = false;
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
    const kicks = kicksFor(p.kind, from, to);
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (fits(g.board, p, cells, p.x + kx, p.y + ky)) {
        p.cells = cells; p.rot = to; p.x += kx; p.y += ky;
        // 最後に回したか・何番目のずらし方で回ったか（回し入れの見分けに使う）
        p.spun = true; p.kick = i;
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

  // T を回して入れたか（よく知られた見分け方）。最後の動きが回すで、T のまん中のまわり4すみのうち3つ以上がうまっている。
  // 出っぱりの側の2すみの片方があいていれば小さな回し入れ（5番目のずらし方で入ったときはふつうの回し入れ）
  function spinOf(g, p) {
    if (p.kind !== 'T' || !p.spun) return null;
    const cx = p.x + 1, cy = p.y + 1;
    const filled = (x, y) => x < 0 || x >= W || y >= H || (y >= 0 && !!g.board[y][x]);
    const c = [filled(cx - 1, cy - 1), filled(cx + 1, cy - 1), filled(cx + 1, cy + 1), filled(cx - 1, cy + 1)]; // 左上・右上・右下・左下
    if (c.filter(Boolean).length < 3) return null;
    const front = [[0, 1], [1, 2], [2, 3], [3, 0]][p.rot || 0];
    return (c[front[0]] && c[front[1]]) || p.kick === 4 ? 'spin' : 'mini';
  }

  // 消した段の数と回し入れから、送るじゃまの数を出す。れんぞく・つづけて大技も、ここで進める
  function attackOf(g, lines, spin, allClear) {
    if (!lines) {
      g.combo = -1;
      return { attack: 0, b2b: false, combo: -1 };
    }
    g.combo++;
    const big = lines === 4 || !!spin;
    const b2b = big && g.b2b;
    g.b2b = big;
    const base = spin === 'spin' ? ATTACK_SPIN[lines] : spin === 'mini' ? ATTACK_MINI[lines] : ATTACK_LINES[lines];
    const attack = allClear ? ATTACK_ALL_CLEAR : (base || 0) + (b2b ? 1 : 0) + ATTACK_COMBO[Math.min(g.combo, ATTACK_COMBO.length - 1)];
    return { attack, b2b, combo: g.combo };
  }

  // 置いて、うまった段を消し、つぎを出す。消した段数・いっぱいになったか・対戦で送るじゃまの数を返す
  function lock(g) {
    const p = g.piece;
    if (!p || g.over) return { lines: 0, attack: 0 };
    const spin = spinOf(g, p);
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
    const allClear = rows.length > 0 && !above && g.board.every((r) => r.every((c) => !c));
    const atk = attackOf(g, rows.length, spin, allClear);
    let res;
    if (above) {
      // 上にはみ出して置いた（消えても入りきらなかった）＝いっぱい
      if (g.onFull === 'end') { g.piece = null; g.over = true; res = { full: true }; }
      else { resetBoard(g); res = Object.assign({ full: true, cleared: true }, spawnOnly(g)); }
    } else {
      res = spawn(g);
    }
    return Object.assign({ lines: rows.length, rows, spin, allClear }, atk, res);
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
      resetBoard(g);
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
    if (dist > 0) g.piece.spun = false; // 回したあと落ちたら、回し入れではない
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
    g.b2b = s.b2b === true;
    g.combo = Number.isInteger(s.combo) && s.combo >= -1 ? s.combo : -1;
    if (s.out === true) { g.piece = null; g.over = true; return g; }
    if (!fits(g.board, g.piece, g.piece.cells, g.piece.x, g.piece.y)) {
      if (g.onFull === 'end') { g.piece = null; g.over = true; }
      else resetBoard(g);
    }
    return g;
  }

  return {
    W, H, SHAPES, KINDS, kicksFor,
    rng, makeBag, newPiece, emptyBoard, fits,
    createGame, spawn, move, rotate, dropY, lock, hardDrop, addGarbage, hold, spinOf, attackOf,
    packBoard, unpackBoard, cellsOf, restoreGame,
  };
});
