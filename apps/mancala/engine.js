/* マンカラのルール（よくあるルール）。画面と通信に触らない。node でも読める。
   ・穴は1人6つ、はじめは各穴に石4つ。それぞれの右はしに自分のゴール
   ・自分の穴を1つ選び、中の石を全部取って、反時計まわりに1つずつ入れる。
     自分のゴールには入れる。相手のゴールはとばす
   ・最後の1つが自分のゴールに入ったら、もう1回
   ・最後の1つが自分の空の穴に入り、向かいの相手の穴に石があれば、
     その1つと向かいの石を全部、自分のゴールへ（よこどり）
   ・どちらかの穴が全部空になったらおわり。残った石は、その穴の側の人のゴールへ
   ・ゴールの石が多いほうの勝ち。同じなら引き分け

   盤の番号: 0〜5 = 先（'b'）の穴（先から見て左から右）、6 = 先のゴール、
            7〜12 = 後（'w'）の穴（後から見て左から右）、13 = 後のゴール */
(function (root) {
  'use strict';

  const PITS = 6;
  const SEEDS = 4;
  const TOTAL = PITS * 2 * SEEDS;
  const SIDES = ['b', 'w'];
  const STORE = { b: 6, w: 13 };
  const other = (c) => (c === 'b' ? 'w' : 'b');
  const pitsOf = (c) => (c === 'b' ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12]);
  const ownerOf = (i) => (i <= 6 ? 'b' : 'w');
  const isStore = (i) => i === 6 || i === 13;
  const isPit = (i) => Number.isInteger(i) && i >= 0 && i <= 13 && !isStore(i);
  const opposite = (i) => 12 - i;
  // その人から見て左から何番めの穴か（1〜6）
  const pitNumber = (i) => (i <= 5 ? i + 1 : i - 6);

  function initialBoard() {
    const b = new Array(14).fill(SEEDS);
    b[6] = 0;
    b[13] = 0;
    return b;
  }

  function newGame() {
    return { board: initialBoard(), turn: 'b', last: -1, ply: 0, over: false, extra: false, capture: null, path: [], sweep: false };
  }

  // 盤として読めるか（14この 0 以上の整数・合計 TOTAL）
  function validBoard(b) {
    return Array.isArray(b) && b.length === 14 && b.every((n) => Number.isInteger(n) && n >= 0)
      && b.reduce((s, n) => s + n, 0) === TOTAL;
  }

  function legalMoves(board, turn) {
    return pitsOf(turn).filter((i) => board[i] > 0);
  }

  const sideEmpty = (b, c) => pitsOf(c).every((i) => b[i] === 0);

  function score(board) {
    return { b: board[STORE.b], w: board[STORE.w] };
  }

  function winner(board) {
    const s = score(board);
    return s.b > s.w ? 'b' : s.w > s.b ? 'w' : 'draw';
  }

  /* 1手まいた結果。もとの盤は変えない。置けないときは null
     返す: { board, turn, over, extra, capture: {from, opp, count} | null, path: まいた穴の番号, last: 最後の石の穴, sweep } */
  function sow(board, turn, pit) {
    if (!isPit(pit) || ownerOf(pit) !== turn || !(board[pit] > 0)) return null;
    const b = board.slice();
    const skip = STORE[other(turn)];
    let seeds = b[pit];
    b[pit] = 0;
    let i = pit;
    const path = [];
    while (seeds > 0) {
      i = (i + 1) % 14;
      if (i === skip) continue;
      b[i] += 1;
      seeds -= 1;
      path.push(i);
    }
    let extra = i === STORE[turn];
    let capture = null;
    if (!extra && ownerOf(i) === turn && !isStore(i) && b[i] === 1 && b[opposite(i)] > 0) {
      const opp = opposite(i);
      const count = b[opp] + 1;
      b[STORE[turn]] += count;
      b[i] = 0;
      b[opp] = 0;
      capture = { from: i, opp, count };
    }
    let over = false;
    let sweep = false;
    if (sideEmpty(b, 'b') || sideEmpty(b, 'w')) {
      over = true;
      SIDES.forEach((c) => {
        pitsOf(c).forEach((k) => {
          if (b[k]) sweep = true;
          b[STORE[c]] += b[k];
          b[k] = 0;
        });
      });
      extra = false;
    }
    return { board: b, turn: over || extra ? turn : other(turn), over, extra, capture, path, last: i, sweep };
  }

  // 対局を1手進める（画面・通信で持つ形）。置けないときは null
  function play(game, pit) {
    if (!game || game.over) return null;
    const r = sow(game.board, game.turn, pit);
    if (!r) return null;
    return {
      board: r.board,
      turn: r.turn,
      last: pit,
      ply: (Number(game.ply) || 0) + 1,
      over: r.over,
      extra: r.extra,
      capture: r.capture,
      path: r.path,
      sweep: r.sweep,
    };
  }

  /* ── CPU ──
     weak: まける穴からくじ
     normal: もう1回 → よこどり（多いほう）→ くじ（時間切れの代わりの手もこれ）
     strong: 数手先まで読む（ゴールの差が大きくなる手） */
  function evaluate(board, over, me) {
    const d = board[STORE[me]] - board[STORE[other(me)]];
    return over ? d * 100 : d;
  }

  function search(board, turn, over, depth, me, alpha, beta) {
    if (depth === 0 || over) return evaluate(board, over, me);
    const maximize = turn === me;
    let best = maximize ? -Infinity : Infinity;
    for (const m of legalMoves(board, turn)) {
      const r = sow(board, turn, m);
      // もう1回の手は深さを減らさずに続ける（読みが短くなりすぎないように）
      const v = search(r.board, r.turn, r.over, r.extra ? depth : depth - 1, me, alpha, beta);
      if (maximize) {
        if (v > best) best = v;
        if (best > alpha) alpha = best;
      } else {
        if (v < best) best = v;
        if (best < beta) beta = best;
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  function pick(list, rnd) {
    return list[Math.floor(rnd() * list.length)];
  }

  function cpuMove(board, turn, level, rand) {
    const rnd = typeof rand === 'function' ? rand : Math.random;
    const moves = legalMoves(board, turn);
    if (!moves.length) return -1;
    if (level === 'weak') return pick(moves, rnd);
    if (level === 'strong') {
      let bestV = -Infinity;
      let best = [];
      for (const m of moves) {
        const r = sow(board, turn, m);
        const v = search(r.board, r.turn, r.over, r.extra ? 6 : 5, turn, -Infinity, Infinity);
        if (v > bestV) { bestV = v; best = [m]; } else if (v === bestV) best.push(m);
      }
      return pick(best, rnd);
    }
    const results = moves.map((m) => ({ m, r: sow(board, turn, m) }));
    const extras = results.filter((x) => x.r.extra);
    if (extras.length) return pick(extras.map((x) => x.m), rnd);
    const caps = results.filter((x) => x.r.capture);
    if (caps.length) {
      const most = Math.max(...caps.map((x) => x.r.capture.count));
      return pick(caps.filter((x) => x.r.capture.count === most).map((x) => x.m), rnd);
    }
    return pick(moves, rnd);
  }

  const autoMove = (board, turn) => cpuMove(board, turn, 'normal');

  const api = {
    PITS, SEEDS, TOTAL, SIDES, STORE, other, pitsOf, ownerOf, isStore, isPit, opposite, pitNumber,
    newGame, validBoard, legalMoves, score, winner, sow, play, cpuMove, autoMove,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MancalaEngine = api;
})(typeof window !== 'undefined' ? window : this);
