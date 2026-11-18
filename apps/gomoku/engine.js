/* 五目並べ — 盤面のルールだけ。画面にも通信にも触らない。
   盤は 15×15。盤面は225文字の文字列（'.' 空き・'b' 黒・'w' 白）。番号は 行×15＋列（左上が A1＝0、右下が O15＝224）。
   ルールは禁じ手なし: 黒も白も、たて・よこ・ななめに5つ以上ならべたら勝ち（6つ以上でも勝ち）。盤がうまったら引き分け。
   ブラウザでは window.GomokuEngine、node では module.exports。 */
(function (root) {
  'use strict';

  const SIZE = 15;
  const CELLS = SIZE * SIZE;
  const COLS = 'ABCDEFGHIJKLMNO';
  const CENTER = 7 * SIZE + 7; // H8
  const LINES = [[0, 1], [1, 0], [1, 1], [1, -1]]; // よこ・たて・ななめ2つ

  const other = (c) => (c === 'b' ? 'w' : 'b');
  const coord = (i) => COLS[i % SIZE] + String(Math.floor(i / SIZE) + 1);
  const emptyBoard = () => '.'.repeat(CELLS);
  const inside = (r, k) => r >= 0 && r < SIZE && k >= 0 && k < SIZE;

  // i の石（色 c）をふくむ、5つ以上のならび（番号の配列）。なければ空
  function lineAt(board, i, c) {
    const r0 = Math.floor(i / SIZE);
    const k0 = i % SIZE;
    for (const [dr, dk] of LINES) {
      const line = [i];
      for (const s of [1, -1]) {
        let r = r0 + dr * s;
        let k = k0 + dk * s;
        while (inside(r, k) && board[r * SIZE + k] === c) {
          line.push(r * SIZE + k);
          r += dr * s; k += dk * s;
        }
      }
      if (line.length >= 5) return line.sort((a, b) => a - b);
    }
    return [];
  }

  // 置いたら5つ以上ならぶ空きの場所（「あと1つで5つ」）
  function winningSpots(board, c) {
    const out = [];
    for (let i = 0; i < CELLS; i += 1) {
      if (board[i] !== '.') continue;
      if (lineAt(board, i, c).length) out.push(i);
    }
    return out;
  }

  // 勝ち負け: 直前の手で5つならんだら { win: 色, line }、盤がうまったら { win: 'draw', line: [] }、まだなら null
  function result(board, last) {
    if (Number.isInteger(last) && last >= 0 && last < CELLS && board[last] !== '.') {
      const line = lineAt(board, last, board[last]);
      if (line.length) return { win: board[last], line };
    }
    if (!board.includes('.')) return { win: 'draw', line: [] };
    return null;
  }

  function count(board) {
    let b = 0;
    let w = 0;
    for (const ch of board) { if (ch === 'b') b += 1; else if (ch === 'w') w += 1; }
    return { b, w };
  }

  // 対局の状態: { board, turn, last, over, ply }。黒が先に置く
  function newGame() {
    return { board: emptyBoard(), turn: 'b', last: -1, over: false, ply: 0 };
  }

  // 置く。空いていなければ null。5つならぶか盤がうまったら over
  function play(g, i) {
    if (!g || g.over || !Number.isInteger(i) || i < 0 || i >= CELLS || g.board[i] !== '.') return null;
    const board = g.board.slice(0, i) + g.turn + g.board.slice(i + 1);
    const over = !!result(board, i);
    return { board, turn: over ? g.turn : other(g.turn), last: i, over, ply: g.ply + 1 };
  }

  /* ── CPU ──
     5マスの窓（たて・よこ・ななめ）ごとに、相手の石がなければ、自分の石の数で点をつける。
     ある場所の点 ＝ そこに置いたときの自分の窓の点（攻め）＋ 相手がそこに置いたときの相手の窓の点（守り） */
  const WIN_W = [0, 1, 12, 150, 2500, 1000000];

  // 石から2マス以内の空き（石がなければ真ん中）
  function candidates(board) {
    const out = [];
    let any = false;
    for (let i = 0; i < CELLS; i += 1) {
      if (board[i] !== '.') { any = true; continue; }
      const r0 = Math.floor(i / SIZE);
      const k0 = i % SIZE;
      let near = false;
      for (let dr = -2; dr <= 2 && !near; dr += 1) {
        for (let dk = -2; dk <= 2; dk += 1) {
          const r = r0 + dr;
          const k = k0 + dk;
          if ((dr || dk) && inside(r, k) && board[r * SIZE + k] !== '.') { near = true; break; }
        }
      }
      if (near) out.push(i);
    }
    if (!any) return [CENTER];
    return out;
  }

  // i に c を置いたときの、c の窓の点
  function windowScore(board, i, c) {
    const o = other(c);
    const r0 = Math.floor(i / SIZE);
    const k0 = i % SIZE;
    let s = 0;
    for (const [dr, dk] of LINES) {
      for (let off = -4; off <= 0; off += 1) {
        let own = 1;
        let ok = true;
        for (let t = 0; t < 5; t += 1) {
          const r = r0 + dr * (off + t);
          const k = k0 + dk * (off + t);
          if (!inside(r, k)) { ok = false; break; }
          if (off + t === 0) continue;
          const ch = board[r * SIZE + k];
          if (ch === o) { ok = false; break; }
          if (ch === c) own += 1;
        }
        if (ok) s += WIN_W[Math.min(own, 5)];
      }
    }
    return s;
  }

  const scoreCell = (board, i, c, def = 0.9) => windowScore(board, i, c) + def * windowScore(board, i, other(c));

  const pickOne = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

  // 5つにできるならそこ、相手が5つにできるならふさぐ。どちらもなければ -1
  function mustMove(board, c, random) {
    const win = winningSpots(board, c);
    if (win.length) return pickOne(win, random);
    const block = winningSpots(board, other(c));
    if (block.length) return pickOne(block, random);
    return -1;
  }

  function ranked(board, c, def) {
    return candidates(board).map((i) => ({ i, s: scoreCell(board, i, c, def) })).sort((a, b) => b.s - a.s);
  }

  // 時間切れのときに代わりに置く手（CPU）。強すぎず、でたらめすぎない置き方:
  // 5つにできればそこ、相手が5つにできればふさぐ。あとは点の高い場所（いちばんの点の8割以上）からくじ
  function autoMove(board, c, rnd) {
    const random = typeof rnd === 'function' ? rnd : Math.random;
    if (!board.includes('.')) return -1;
    const m = mustMove(board, c, random);
    if (m >= 0) return m;
    const list = ranked(board, c);
    const top = list.filter((x) => x.s >= list[0].s * 0.8).map((x) => x.i);
    return pickOne(top, random);
  }

  // 1台の画面で CPU と対戦するときの手。level: 'weak' / 'normal'（autoMove）/ 'strong'
  function cpuMove(board, c, level, rnd) {
    const random = typeof rnd === 'function' ? rnd : Math.random;
    if (!board.includes('.')) return -1;
    if (level === 'weak') {
      // 5つにできればそこ。あとは点の上から8つの中からくじ（ふさぐのを見のがすことがある）
      const win = winningSpots(board, c);
      if (win.length) return pickOne(win, random);
      const list = ranked(board, c, 0.5).slice(0, 8).map((x) => x.i);
      return pickOne(list, random);
    }
    if (level !== 'strong') return autoMove(board, c, random);
    return strongMove(board, c, random);
  }

  // 盤全体の良さ（me から見て）。5マスの窓ごとに、片方の色だけがあれば、その数で点をつける
  function evaluate(board, me) {
    let s = 0;
    for (let r = 0; r < SIZE; r += 1) {
      for (let k = 0; k < SIZE; k += 1) {
        for (const [dr, dk] of LINES) {
          const er = r + dr * 4;
          const ek = k + dk * 4;
          if (!inside(er, ek)) continue;
          let b = 0;
          let w = 0;
          for (let t = 0; t < 5; t += 1) {
            const ch = board[(r + dr * t) * SIZE + k + dk * t];
            if (ch === 'b') b += 1; else if (ch === 'w') w += 1;
          }
          if (b && !w) s += me === 'b' ? WIN_W[b] : -WIN_W[b];
          else if (w && !b) s += me === 'w' ? WIN_W[w] : -WIN_W[w];
        }
      }
    }
    return s;
  }

  const BIG = 1e12;
  // turn から見た値（ネガマックス・アルファベータ）。各局面は点の上から BREADTH か所だけ読む
  const BREADTH = 8;
  function search(board, turn, depth, alpha, beta) {
    if (winningSpots(board, turn).length) return BIG + depth;
    const o = other(turn);
    const block = winningSpots(board, o);
    if (block.length >= 2) return -BIG - depth;
    if (!board.includes('.')) return 0;
    if (depth <= 0) return evaluate(board, turn);
    const moves = block.length ? block : ranked(board, turn, 1).slice(0, BREADTH).map((x) => x.i);
    let v = -Infinity;
    for (const i of moves) {
      const nb = board.slice(0, i) + turn + board.slice(i + 1);
      v = Math.max(v, -search(nb, o, depth - 1, -beta, -alpha));
      alpha = Math.max(alpha, v);
      if (alpha >= beta) break;
    }
    return v;
  }

  // つよい: 5つにできる・ふさぐ手のあとは、点の上から10か所を、3手先まで読んで比べる
  function strongMove(board, c, random) {
    const m = mustMove(board, c, random);
    if (m >= 0) return m;
    const o = other(c);
    const list = ranked(board, c, 1).slice(0, 10).map((x) => x.i);
    let best = -Infinity;
    let picks = [];
    list.forEach((i) => {
      const nb = board.slice(0, i) + c + board.slice(i + 1);
      const v = -search(nb, o, 2, -Infinity, Infinity);
      if (v > best) { best = v; picks = [i]; } else if (v === best) picks.push(i);
    });
    return pickOne(picks, random);
  }

  const api = { SIZE, CELLS, COLS, CENTER, other, coord, emptyBoard, lineAt, winningSpots, result, count, newGame, play, autoMove, cpuMove };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GomokuEngine = api;
})(typeof window !== 'undefined' ? window : this);
