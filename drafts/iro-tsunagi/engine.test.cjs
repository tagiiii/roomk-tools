// node drafts/iro-tsunagi/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('./engine.js');

let n = 0;
function t(name, fn) { fn(); n++; console.log('ok', name); }

// 文字の絵から盤を作る（上が y=0。'.' は空き）
function fromRows(rows) {
  const b = E.emptyBoard();
  const off = E.H - rows.length;
  rows.forEach((r, i) => [...r].forEach((ch, x) => { if (ch !== '.') E.set(b, x, off + i, Number(ch)); }));
  return b;
}
function game(rows) {
  const g = E.newGame({ colors: 4, seed: 7 });
  if (rows) g.board = fromRows(rows);
  return g;
}

t('4つつながると消え、3つでは消えない', () => {
  const g = game(['1.....', '1.....', '1.....', '22....']);
  let r = E.settle(g);
  assert.strictEqual(r.chain, 0);
  E.set(g.board, 0, E.H - 5, 1);
  r = E.settle(g);
  assert.strictEqual(r.chain, 1);
  assert.strictEqual(E.get(g.board, 0, E.H - 1), 2);
  assert.strictEqual(g.score, 40);
});

t('消えたあと落ちてつながると、れんさになる', () => {
  // 2 が3つ並び、その上の 2 は 1 にのっている。1 が消えると 2 が落ちて4つになる
  const g = game([
    '2.....',
    '1.....',
    '1.....',
    '1.....',
    '12....',
    '22....',
  ]);
  const r = E.settle(g);
  assert.strictEqual(r.chain, 2);
  assert.strictEqual(g.bestChain, 2);
  assert.strictEqual(E.findGroups(g.board).length, 0);
});

t('置いた組はばらばらに落ちる', () => {
  const g = game(['......', '1.....']);
  E.spawn(g);
  g.piece = { x: 0, y: 0, rot: 1, a: 3, b: 4 };
  E.hardDropRows(g);
  E.lock(g);
  E.settle(g);
  assert.strictEqual(E.get(g.board, 0, E.H - 2), 3);
  assert.strictEqual(E.get(g.board, 1, E.H - 1), 4);
});

t('壁ぎわで回すと反対へずれる', () => {
  const g = game();
  g.piece = { x: 5, y: 3, rot: 0, a: 1, b: 2 };
  assert.ok(E.rotate(g, 1));
  assert.deepStrictEqual([g.piece.x, g.piece.rot], [4, 1]);
});

t('床で下向きに回すと1つ上がる', () => {
  const g = game();
  g.piece = { x: 2, y: E.H - 1, rot: 1, a: 1, b: 2 };
  assert.ok(E.rotate(g, 1));
  assert.deepStrictEqual([g.piece.y, g.piece.rot], [E.H - 2, 2]);
});

t('1列のすき間では上下を入れかえる', () => {
  const g = game(['3.4...', '4.3...', '3.4...', '4.3...']);
  g.piece = { x: 1, y: E.H - 2, rot: 0, a: 1, b: 2 };
  assert.ok(E.rotate(g, 1));
  assert.deepStrictEqual([g.piece.rot, g.piece.a, g.piece.b], [0, 2, 1]);
});

t('出る所がふさがると spawn は false', () => {
  const g = game();
  E.set(g.board, 2, 0, 1);
  assert.strictEqual(E.spawn(g), false);
  E.clearBoard(g);
  assert.strictEqual(E.spawn(g), true);
  assert.strictEqual(g.clears, 1);
});

t('影は2つの玉の落ちる先', () => {
  const g = game(['......', '1.....']);
  g.piece = { x: 0, y: 0, rot: 0, a: 3, b: 4 };
  const gh = E.ghost(g);
  assert.deepStrictEqual(gh.map((q) => [q.x, q.y]), [[0, E.H - 2], [0, E.H - 3]]);
  g.piece = { x: 0, y: 0, rot: 1, a: 3, b: 4 };
  const gh2 = E.ghost(g).sort((a, b) => a.x - b.x);
  assert.deepStrictEqual(gh2.map((q) => [q.x, q.y]), [[0, E.H - 2], [1, E.H - 1]]);
});

t('ためしに1000手おいても盤の外に玉が出ない', () => {
  const g = E.newGame({ colors: 4, seed: 123 });
  const rand = E.rng(99);
  for (let i = 0; i < 1000; i++) {
    if (!E.spawn(g)) { E.clearBoard(g); E.spawn(g); }
    const r = Math.floor(rand() * 4);
    for (let k = 0; k < r; k++) E.rotate(g, 1);
    const dx = Math.floor(rand() * 6) - 3;
    for (let k = 0; k < Math.abs(dx); k++) E.move(g, Math.sign(dx));
    E.hardDropRows(g);
    E.lock(g);
    E.settle(g);
    assert.strictEqual(E.findGroups(g.board).length, 0);
  }
  assert.ok(g.score > 0);
});

console.log(n + ' tests passed');
