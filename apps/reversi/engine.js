/* リバーシ — 盤面のルールだけ。画面にも通信にも触らない。
   盤面は64文字の文字列（'.' 空き・'b' 黒・'w' 白・'y' 黄・'u' 青）。番号は 行×8＋列（左上が A1＝0、右下が H8＝63）。
   2人（黒・白）はふつうのリバーシ。3〜4人（黒→白→黄→青）は 2026-11-25 に足した、みんなで1つの盤を囲む形:
   ・自分の石で、ほかの色の石（色がまじっていてもいい）をはさめる場所があれば、そこに置く（はさんだ石はぜんぶ自分の色）
   ・はさめる場所がないときは、どれかの石のとなり（たて・よこ・ななめ）の空きに置ける。パスはない
   ・盤がうまったらおしまい。石がいちばん多い人の勝ち（同じ数なら、その人たちみんなの勝ち）
   ブラウザでは window.ReversiEngine、node では module.exports。 */
(function (root) {
  'use strict';

  const SIZE = 8;
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const COLS = 'ABCDEFGH';

  const other = (c) => (c === 'b' ? 'w' : 'b');
  // 置く順の色。3〜4人は、はじめの並びと同じく盤の中央を時計まわり（左上 黒→右上 白→右下 黄→左下 青）
  const ORDER = ['b', 'w', 'y', 'u'];
  const nOf = (n) => (n === 3 || n === 4 ? n : 2);
  const colorsOf = (n) => ORDER.slice(0, nOf(n));
  const nextColor = (c, n) => { const cs = colorsOf(n); return cs[(cs.indexOf(c) + 1) % cs.length]; };
  const coord = (i) => COLS[i % SIZE] + String(Math.floor(i / SIZE) + 1);

  // はじめの並び: D4 白・E4 黒・D5 黒・E5 白。黒が先に置く
  // 3〜4人: D4 黒・E4 白・E5 黄・D5 青（3人のときは D5 が空き）
  function initialBoard(n) {
    const a = Array(SIZE * SIZE).fill('.');
    if (nOf(n) === 2) { a[27] = 'w'; a[28] = 'b'; a[35] = 'b'; a[36] = 'w'; }
    else { a[27] = 'b'; a[28] = 'w'; a[36] = 'y'; if (nOf(n) === 4) a[35] = 'u'; }
    return a.join('');
  }

  // i に c を置いたときにひっくり返る石の番号（置けなければ空）
  function flipsAt(board, i, c) {
    if (board[i] !== '.') return [];
    const r0 = Math.floor(i / SIZE);
    const c0 = i % SIZE;
    const o = other(c);
    const out = [];
    DIRS.forEach(([dr, dc]) => {
      const line = [];
      let r = r0 + dr;
      let k = c0 + dc;
      while (r >= 0 && r < SIZE && k >= 0 && k < SIZE && board[r * SIZE + k] === o) {
        line.push(r * SIZE + k);
        r += dr; k += dc;
      }
      if (line.length && r >= 0 && r < SIZE && k >= 0 && k < SIZE && board[r * SIZE + k] === c) out.push(...line);
    });
    return out;
  }

  // 3〜4人: i に c を置いたときにひっくり返る石（自分の色でない石の列を、自分の石ではさむ）
  function flipsAtMulti(board, i, c) {
    if (board[i] !== '.') return [];
    const r0 = Math.floor(i / SIZE);
    const c0 = i % SIZE;
    const out = [];
    DIRS.forEach(([dr, dc]) => {
      const line = [];
      let r = r0 + dr;
      let k = c0 + dc;
      while (r >= 0 && r < SIZE && k >= 0 && k < SIZE && board[r * SIZE + k] !== '.' && board[r * SIZE + k] !== c) {
        line.push(r * SIZE + k);
        r += dr; k += dc;
      }
      if (line.length && r >= 0 && r < SIZE && k >= 0 && k < SIZE && board[r * SIZE + k] === c) out.push(...line);
    });
    return out;
  }
  const flipsFor = (board, i, c, n) => (nOf(n) === 2 ? flipsAt(board, i, c) : flipsAtMulti(board, i, c));
  function nextToStone(board, i) {
    const r0 = Math.floor(i / SIZE);
    const c0 = i % SIZE;
    return DIRS.some(([dr, dc]) => {
      const r = r0 + dr;
      const k = c0 + dc;
      return r >= 0 && r < SIZE && k >= 0 && k < SIZE && board[r * SIZE + k] !== '.';
    });
  }

  // 置ける場所 → ひっくり返る数。3〜4人ではさめる場所がないときは、石のとなりの空き → 0
  function movesOf(board, c, n) {
    if (nOf(n) === 2) return legalMoves(board, c);
    const out = {};
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const k = flipsAtMulti(board, i, c).length;
      if (k) out[i] = k;
    }
    if (Object.keys(out).length) return out;
    for (let i = 0; i < SIZE * SIZE; i += 1) if (board[i] === '.' && nextToStone(board, i)) out[i] = 0;
    return out;
  }

  // 置ける場所 → ひっくり返る数
  function legalMoves(board, c) {
    const out = {};
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      const n = flipsAt(board, i, c).length;
      if (n) out[i] = n;
    }
    return out;
  }
  const hasMove = (board, c) => Object.keys(legalMoves(board, c)).length > 0;

  function count(board) {
    const n = { b: 0, w: 0, y: 0, u: 0 };
    for (const ch of board) if (n[ch] != null) n[ch] += 1;
    return n;
  }

  // 対局の状態: { board, turn, last, flipped, passed, over, ply, n }
  // passed: 直前に置ける場所がなくてパスになった色（なければ null。3〜4人ではいつも null）
  // n: 対戦する人数（2〜4）
  function newGame(n) {
    return { board: initialBoard(n), turn: 'b', last: -1, flipped: [], passed: null, over: false, ply: 0, n: nOf(n) };
  }

  // 3〜4人の置き方
  function playMulti(g, i) {
    const n = nOf(g.n);
    const moves = movesOf(g.board, g.turn, n);
    if (moves[i] == null) return null;
    const fl = flipsAtMulti(g.board, i, g.turn);
    const a = g.board.split('');
    a[i] = g.turn;
    fl.forEach((j) => { a[j] = g.turn; });
    const board = a.join('');
    return { board, turn: nextColor(g.turn, n), last: i, flipped: fl, passed: null, over: !board.includes('.'), ply: g.ply + 1, n };
  }

  // 置く。置けなければ null。次の番・パス・おしまいまで決める
  function play(g, i) {
    if (!g || g.over || !Number.isInteger(i) || i < 0 || i >= SIZE * SIZE) return null;
    if (nOf(g.n) !== 2) return playMulti(g, i);
    const fl = flipsAt(g.board, i, g.turn);
    if (!fl.length) return null;
    const a = g.board.split('');
    a[i] = g.turn;
    fl.forEach((j) => { a[j] = g.turn; });
    const board = a.join('');
    const next = other(g.turn);
    const res = { board, turn: next, last: i, flipped: fl, passed: null, over: false, ply: g.ply + 1, n: 2 };
    if (!hasMove(board, next)) {
      if (hasMove(board, g.turn)) { res.turn = g.turn; res.passed = next; }
      else res.over = true;
    }
    return res;
  }

  // 勝ち: 'b' | 'w' | 'draw'
  function winner(board) {
    const n = count(board);
    if (n.b === n.w) return 'draw';
    return n.b > n.w ? 'b' : 'w';
  }
  // 勝った色の列（石がいちばん多い色。同じ数ならその色みんな）
  function winners(board, n) {
    const k = count(board);
    const cs = colorsOf(n);
    const top = Math.max(...cs.map((c) => k[c]));
    return cs.filter((c) => k[c] === top);
  }

  // 時間切れのときに代わりに置く手（CPU）。強すぎず、でたらめすぎない置き方:
  // 角が取れれば角、取れなければ、まだ空いている角のとなり（相手に角を渡しやすい場所）を避けて、残りからくじで選ぶ
  const CORNERS = [0, 7, 56, 63];
  function nearEmptyCorner(board, i) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    return CORNERS.some((k) => board[k] === '.' && k !== i
      && Math.abs(Math.floor(k / SIZE) - r) <= 1 && Math.abs((k % SIZE) - c) <= 1);
  }
  function autoMove(board, c, rnd, n) {
    const random = typeof rnd === 'function' ? rnd : Math.random;
    const moves = Object.keys(movesOf(board, c, n)).map(Number);
    if (!moves.length) return -1;
    const corners = moves.filter((i) => CORNERS.includes(i));
    const safe = moves.filter((i) => !nearEmptyCorner(board, i));
    const pool = corners.length ? corners : safe.length ? safe : moves;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }

  // 1台の画面で CPU と対戦するときの手。level: 'weak'（置ける場所からくじ）/ 'normal'（autoMove）/ 'strong'（数手先まで読む）
  const WEIGHTS = [
    100, -20, 10, 5, 5, 10, -20, 100,
    -20, -40, -2, -2, -2, -2, -40, -20,
    10, -2, 1, 1, 1, 1, -2, 10,
    5, -2, 1, 0, 0, 1, -2, 5,
    5, -2, 1, 0, 0, 1, -2, 5,
    10, -2, 1, 1, 1, 1, -2, 10,
    -20, -40, -2, -2, -2, -2, -40, -20,
    100, -20, 10, 5, 5, 10, -20, 100,
  ];
  // c から見た局面の良さ。角を取ったあとは、そのとなりの減点をやめる
  function evaluate(board, c) {
    const o = other(c);
    let s = 0;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      if (board[i] === '.') continue;
      let w = WEIGHTS[i];
      if (w < 0 && !nearEmptyCorner(board, i)) w = 1;
      s += board[i] === c ? w : board[i] === o ? -w : 0;
    }
    const mine = Object.keys(legalMoves(board, c)).length;
    const theirs = Object.keys(legalMoves(board, o)).length;
    return s + 3 * (mine - theirs);
  }
  const putStone = (board, i, c) => {
    const a = board.split('');
    a[i] = c;
    flipsAt(board, i, c).forEach((j) => { a[j] = c; });
    return a.join('');
  };
  // me から見た値（アルファベータ）
  function search(board, turn, me, depth, alpha, beta) {
    const moves = Object.keys(legalMoves(board, turn)).map(Number);
    if (!moves.length) {
      if (!hasMove(board, other(turn))) {
        const n = count(board);
        const d = me === 'b' ? n.b - n.w : n.w - n.b;
        return d * 10000;
      }
      return search(board, other(turn), me, depth, alpha, beta);
    }
    if (depth <= 0) return evaluate(board, me);
    if (turn === me) {
      let v = -Infinity;
      for (const i of moves) {
        v = Math.max(v, search(putStone(board, i, turn), other(turn), me, depth - 1, alpha, beta));
        alpha = Math.max(alpha, v);
        if (alpha >= beta) break;
      }
      return v;
    }
    let v = Infinity;
    for (const i of moves) {
      v = Math.min(v, search(putStone(board, i, turn), other(turn), me, depth - 1, alpha, beta));
      beta = Math.min(beta, v);
      if (alpha >= beta) break;
    }
    return v;
  }
  // 3〜4人の「つよい」: 1手だけ読み、自分の石の良さから、いちばん良いほかの色の石の良さを引いた値が大きい手
  function positional(board, c) {
    let s = 0;
    for (let i = 0; i < SIZE * SIZE; i += 1) {
      if (board[i] !== c) continue;
      let w = WEIGHTS[i];
      if (w < 0 && !nearEmptyCorner(board, i)) w = 1;
      s += w;
    }
    return s;
  }
  function cpuMoveMulti(board, c, n, random) {
    const moves = Object.keys(movesOf(board, c, n)).map(Number);
    let best = -Infinity;
    let picks = [];
    moves.forEach((i) => {
      const a = board.split('');
      a[i] = c;
      flipsAtMulti(board, i, c).forEach((j) => { a[j] = c; });
      const nb = a.join('');
      const others = colorsOf(n).filter((o) => o !== c).map((o) => positional(nb, o));
      const v = positional(nb, c) - Math.max(...others);
      if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
    });
    return picks[Math.min(picks.length - 1, Math.floor(random() * picks.length))];
  }
  function cpuMove(board, c, level, rnd, n) {
    const random = typeof rnd === 'function' ? rnd : Math.random;
    const moves = Object.keys(movesOf(board, c, n)).map(Number);
    if (!moves.length) return -1;
    if (level === 'weak') return moves[Math.min(moves.length - 1, Math.floor(random() * moves.length))];
    if (level !== 'strong') return autoMove(board, c, random, n);
    if (nOf(n) !== 2) return cpuMoveMulti(board, c, n, random);
    // 残りが少ないときは最後まで読む
    const empties = board.split('').filter((ch) => ch === '.').length;
    const depth = empties <= 10 ? empties : 4;
    let best = -Infinity;
    let picks = [];
    moves.forEach((i) => {
      const v = search(putStone(board, i, c), other(c), c, depth - 1, -Infinity, Infinity);
      if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
    });
    return picks[Math.min(picks.length - 1, Math.floor(random() * picks.length))];
  }

  const api = { SIZE, COLS, ORDER, nOf, colorsOf, nextColor, other, coord, initialBoard, flipsAt, flipsAtMulti, flipsFor, movesOf, legalMoves, hasMove, count, newGame, play, winner, winners, autoMove, cpuMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReversiEngine = api;
})(typeof window !== 'undefined' ? window : this);
