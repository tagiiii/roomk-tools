/* リバーシ — 盤面のルールだけ。画面にも通信にも触らない。
   盤面は64文字の文字列（'.' 空き・'b' 黒・'w' 白）。番号は 行×8＋列（左上が A1＝0、右下が H8＝63）。
   ブラウザでは window.ReversiEngine、node では module.exports。 */
(function (root) {
  'use strict';

  const SIZE = 8;
  const DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const COLS = 'ABCDEFGH';

  const other = (c) => (c === 'b' ? 'w' : 'b');
  const coord = (i) => COLS[i % SIZE] + String(Math.floor(i / SIZE) + 1);

  // はじめの並び: D4 白・E4 黒・D5 黒・E5 白。黒が先に置く
  function initialBoard() {
    const a = Array(SIZE * SIZE).fill('.');
    a[27] = 'w'; a[28] = 'b'; a[35] = 'b'; a[36] = 'w';
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
    let b = 0;
    let w = 0;
    for (const ch of board) { if (ch === 'b') b += 1; else if (ch === 'w') w += 1; }
    return { b, w };
  }

  // 対局の状態: { board, turn, last, flipped, passed, over, ply }
  // passed: 直前に置ける場所がなくてパスになった色（なければ null）
  function newGame() {
    return { board: initialBoard(), turn: 'b', last: -1, flipped: [], passed: null, over: false, ply: 0 };
  }

  // 置く。置けなければ null。次の番・パス・おしまいまで決める
  function play(g, i) {
    if (!g || g.over || !Number.isInteger(i) || i < 0 || i >= SIZE * SIZE) return null;
    const fl = flipsAt(g.board, i, g.turn);
    if (!fl.length) return null;
    const a = g.board.split('');
    a[i] = g.turn;
    fl.forEach((j) => { a[j] = g.turn; });
    const board = a.join('');
    const next = other(g.turn);
    const res = { board, turn: next, last: i, flipped: fl, passed: null, over: false, ply: g.ply + 1 };
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

  // 時間切れのときに代わりに置く手（CPU）。強すぎず、でたらめすぎない置き方:
  // 角が取れれば角、取れなければ、まだ空いている角のとなり（相手に角を渡しやすい場所）を避けて、残りからくじで選ぶ
  const CORNERS = [0, 7, 56, 63];
  function nearEmptyCorner(board, i) {
    const r = Math.floor(i / SIZE);
    const c = i % SIZE;
    return CORNERS.some((k) => board[k] === '.' && k !== i
      && Math.abs(Math.floor(k / SIZE) - r) <= 1 && Math.abs((k % SIZE) - c) <= 1);
  }
  function autoMove(board, c, rnd) {
    const random = typeof rnd === 'function' ? rnd : Math.random;
    const moves = Object.keys(legalMoves(board, c)).map(Number);
    if (!moves.length) return -1;
    const corners = moves.filter((i) => CORNERS.includes(i));
    const safe = moves.filter((i) => !nearEmptyCorner(board, i));
    const pool = corners.length ? corners : safe.length ? safe : moves;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }

  const api = { SIZE, COLS, other, coord, initialBoard, flipsAt, legalMoves, hasMove, count, newGame, play, winner, autoMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ReversiEngine = api;
})(typeof window !== 'undefined' ? window : this);
