// node tests/mancala/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('../../apps/mancala/engine.js');

let pass = 0;
const t = (name, fn) => { fn(); pass += 1; };
const at = (board, turn = 'b') => ({ ...E.newGame(), board, turn });

t('はじめの局面', () => {
  const G = E.newGame();
  assert.deepStrictEqual(G.board, [4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
  assert.deepStrictEqual(E.legalMoves(G.board, 'b'), [0, 1, 2, 3, 4, 5]);
  assert.deepStrictEqual(E.legalMoves(G.board, 'w'), [7, 8, 9, 10, 11, 12]);
  assert.ok(E.validBoard(G.board));
});

t('3番めの穴（石4つ）の最後がゴールに入ってもう1回', () => {
  const r = E.play(E.newGame(), 2);
  assert.deepStrictEqual(r.path, [3, 4, 5, 6]);
  assert.strictEqual(r.extra, true);
  assert.strictEqual(r.turn, 'b');
  assert.strictEqual(r.ply, 1);
  assert.strictEqual(r.last, 2);
});

t('ふつうの手で番が変わる', () => {
  const r = E.play(E.newGame(), 0);
  assert.deepStrictEqual(r.path, [1, 2, 3, 4]);
  assert.strictEqual(r.turn, 'w');
});

t('後の人の手', () => {
  const r = E.play(at(E.newGame().board, 'w'), 9);
  assert.deepStrictEqual(r.path, [10, 11, 12, 13]);
  assert.strictEqual(r.extra, true);
});

t('相手のゴールはとばす', () => {
  const r = E.play(at([0, 0, 0, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 22]), 5);
  assert.deepStrictEqual(r.path, [6, 7, 8, 9, 10, 11, 12, 0, 1, 2]);
  const r2 = E.play(at([1, 1, 1, 1, 1, 1, 22, 0, 0, 0, 0, 0, 10, 0], 'w'), 12);
  assert.ok(!r2.path.includes(6));
});

t('よこどり', () => {
  const r = E.play(at([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 1, 41]), 0);
  assert.deepStrictEqual(r.capture, { from: 1, opp: 11, count: 6 });
  assert.strictEqual(r.board[6], 6);
  assert.strictEqual(r.board[1], 0);
  assert.strictEqual(r.board[11], 0);
});

t('向かいが空ならよこどりしない', () => {
  const r = E.play(at([1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 44]), 0);
  assert.strictEqual(r.capture, null);
});

t('相手の側の空の穴ではよこどりしない', () => {
  const r = E.play(at([0, 0, 0, 0, 0, 2, 20, 0, 1, 1, 1, 1, 1, 21]), 5);
  assert.strictEqual(r.capture, null);
});

t('片方が空になったらおわり・残りは持ち主へ', () => {
  const r = E.play(at([0, 0, 0, 0, 0, 1, 20, 2, 0, 0, 0, 0, 3, 22]), 5);
  assert.strictEqual(r.over, true);
  assert.strictEqual(r.extra, false);
  assert.strictEqual(r.sweep, true);
  assert.strictEqual(r.board[6], 21);
  assert.strictEqual(r.board[13], 27);
  assert.strictEqual(E.winner(r.board), 'w');
});

t('引き分け', () => {
  assert.strictEqual(E.winner([0, 0, 0, 0, 0, 0, 24, 0, 0, 0, 0, 0, 0, 24]), 'draw');
});

t('相手の穴・空の穴・ゴールは選べない', () => {
  const G = E.newGame();
  assert.strictEqual(E.play(G, 7), null);
  assert.strictEqual(E.play(G, 6), null);
  assert.strictEqual(E.play(G, -1), null);
  assert.strictEqual(E.play(at([0, 4, 4, 4, 4, 8, 0, 4, 4, 4, 4, 4, 4, 0]), 0), null);
  assert.strictEqual(E.play({ ...G, over: true }, 0), null);
});

t('穴の番号', () => {
  assert.strictEqual(E.pitNumber(0), 1);
  assert.strictEqual(E.pitNumber(5), 6);
  assert.strictEqual(E.pitNumber(7), 1);
  assert.strictEqual(E.pitNumber(12), 6);
});

t('盤の読み取り', () => {
  assert.ok(!E.validBoard([4, 4]));
  assert.ok(!E.validBoard([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 1]));
  assert.ok(!E.validBoard([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, -4, 8]));
});

let seed = 12345;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

t('でたらめ対局 3000 局（石は48のまま・必ず終わる・番と もう1回 が合う）', () => {
  for (let g = 0; g < 3000; g++) {
    let G = E.newGame();
    let steps = 0;
    while (!G.over) {
      const ms = E.legalMoves(G.board, G.turn);
      assert.ok(ms.length > 0);
      const m = ms[Math.floor(rand() * ms.length)];
      const n = E.play(G, m);
      assert.ok(E.validBoard(n.board));
      if (!n.over) assert.strictEqual(n.turn, n.extra ? G.turn : E.other(G.turn));
      G = n;
      assert.ok(++steps < 500);
    }
    assert.ok(E.SIDES.some((c) => E.pitsOf(c).every((i) => G.board[i] === 0)));
  }
});

function match(levelOf, n) {
  const wins = { first: 0, total: 0 };
  for (let g = 0; g < n; g++) {
    let G = E.newGame();
    const side = g % 2 ? 'w' : 'b';
    while (!G.over) {
      const lv = levelOf(G.turn === side);
      const m = E.cpuMove(G.board, G.turn, lv, rand);
      assert.ok(E.legalMoves(G.board, G.turn).includes(m));
      G = E.play(G, m);
    }
    if (E.winner(G.board) === side) wins.first += 1;
    wins.total += 1;
  }
  return wins.first;
}

t('CPU ふつうは よわい に多く勝つ', () => {
  const w = match((me) => (me ? 'normal' : 'weak'), 60);
  assert.ok(w >= 40, 'ふつう ' + w + '/60');
});

t('CPU つよいは ふつう に多く勝つ', () => {
  const w = match((me) => (me ? 'strong' : 'normal'), 30);
  assert.ok(w >= 22, 'つよい ' + w + '/30');
});

t('CPU つよいの1手は速い（250ms 未満）', () => {
  let worst = 0;
  let G = E.newGame();
  for (let k = 0; k < 10 && !G.over; k++) {
    const t0 = Date.now();
    const m = E.cpuMove(G.board, G.turn, 'strong', rand);
    worst = Math.max(worst, Date.now() - t0);
    G = E.play(G, m);
  }
  assert.ok(worst < 250, worst + 'ms');
});

t('置ける穴がないときの CPU は -1', () => {
  assert.strictEqual(E.cpuMove([0, 0, 0, 0, 0, 0, 24, 4, 4, 4, 4, 4, 4, 0], 'b', 'normal'), -1);
});

console.log('合格 ' + pass + ' 件');
