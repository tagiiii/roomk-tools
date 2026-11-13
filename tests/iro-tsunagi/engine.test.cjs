// node tests/iro-tsunagi/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('../../apps/iro-tsunagi/engine.js');

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

t('1列のすき間では、flip のときだけ上下を入れかえる', () => {
  const g = game(['3.4...', '4.3...', '3.4...', '4.3...']);
  g.piece = { x: 1, y: E.H - 2, rot: 0, a: 1, b: 2 };
  assert.strictEqual(E.rotate(g, 1), false);
  assert.deepStrictEqual([g.piece.rot, g.piece.a, g.piece.b], [0, 1, 2]);
  assert.ok(E.rotate(g, 1, true));
  assert.deepStrictEqual([g.piece.rot, g.piece.a, g.piece.b], [0, 2, 1]);
});

t('はじめの1袋は3色だけ、そのあとはどの色も袋ごとに同じ数', () => {
  const g = E.newGame({ colors: 5, seed: 42 });
  const seen = [];
  for (let i = 0; i < 6 + 10 * 4; i++) { E.spawn(g); seen.push(...E.cells(g.piece).map((q) => q.c)); g.piece = null; }
  assert.ok(seen.slice(0, 12).every((c) => c <= 3));
  const rest = seen.slice(12, 12 + 5 * E.PER_COLOR * 2);
  for (let c = 1; c <= 5; c++) assert.strictEqual(rest.filter((v) => v === c).length, E.PER_COLOR * 2);
});

t('消して盤が全部なくなったら allClear', () => {
  const g = game(['1.....', '1.....', '1.....', '1.....']);
  const r = E.settle(g);
  assert.strictEqual(r.allClear, true);
  assert.strictEqual(g.allClears, 1);
  const g2 = game(['1.....', '1.....', '1.....', '12....']);
  assert.strictEqual(E.settle(g2).allClear, false);
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
    for (let k = 0; k < r; k++) E.rotate(g, 1, k % 2 === 1);
    const dx = Math.floor(rand() * 6) - 3;
    for (let k = 0; k < Math.abs(dx); k++) E.move(g, Math.sign(dx));
    E.hardDropRows(g);
    E.lock(g);
    E.settle(g);
    assert.strictEqual(E.findGroups(g.board).length, 0);
  }
  assert.ok(g.score > 0);
});

t('じゃまの玉はつながらず、となりの玉が消えるといっしょに消える', () => {
  const g = game(['9.....', '99....', '9.....', '1.....', '1.....', '1.....', '19....']);
  const r = E.settle(g);
  assert.strictEqual(r.chain, 1);
  assert.strictEqual(g.score, 40);
  // じゃま5つのうち、1 のとなり（1 のすぐ上の1つ・右の列に落ちた2つ）だけが消え、左の列の上の2つは残る
  const left = g.board.flat().filter((v) => v === E.JAMA).length;
  assert.strictEqual(left, 2);
  assert.strictEqual(E.findGroups(g.board).length, 0);
});

t('送るじゃまの数（独自の数え方）', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map(E.chainSend), [0, 3, 6, 10, 14, 18]);
  const steps = [{ type: 'pop', chain: 1, count: 4 }, { type: 'pop', chain: 2, count: 5 }, { type: 'fall' }];
  assert.strictEqual(E.attackOf(steps, false), 0 + 3 + 1);
  assert.strictEqual(E.attackOf(steps, true), 4 + 6);
  assert.strictEqual(E.attackOf([{ type: 'pop', chain: 1, count: 6 }], false), 2);
});

t('じゃまは6つで1段そろい、あまりはちがう列に。30個まで', () => {
  const g = game();
  const r = E.addJama(g, 8, E.rng(3));
  assert.strictEqual(r.placed, 8);
  const bottom = [0, 1, 2, 3, 4, 5].map((x) => E.get(g.board, x, E.H - 1));
  assert.ok(bottom.every((v) => v === E.JAMA));
  const second = [0, 1, 2, 3, 4, 5].filter((x) => E.get(g.board, x, E.H - 2) === E.JAMA);
  assert.strictEqual(second.length, 2);
  const g2 = game();
  assert.strictEqual(E.addJama(g2, 100, E.rng(1)).placed, E.JAMA_MAX);
});

t('じゃまは見えない段より上にははみ出さない', () => {
  const g = game();
  for (let y = E.TOP + 1; y < E.H; y++) E.set(g.board, 0, y, 1 + (y % 2));
  const r = E.addJama(g, 6, E.rng(5));
  assert.strictEqual(E.get(g.board, 0, E.TOP), E.JAMA);
  assert.strictEqual(r.placed, 6);
  const r2 = E.addJama(g, 6, E.rng(5));
  assert.strictEqual(r2.placed, 5);   // 0 列めはもう入らない
});

t('盤を文字にして戻せる', () => {
  const g = game(['9.....', '12345.']);
  const text = E.packBoard(g.board);
  assert.strictEqual(text.length, (E.H + 1) * E.W);
  assert.deepStrictEqual(E.unpackBoard(text), g.board);
  assert.strictEqual(E.unpackBoard('x'), null);
  assert.strictEqual(E.unpackBoard(text.replace('9', '7')), null);
});

t('読み込み直すと、同じ種で同じ順番の続きになる', () => {
  const a = E.newGame({ colors: 4, seed: 77 });
  for (let i = 0; i < 9; i++) { E.spawn(a); a.piece = null; }
  a.score = 120;
  const saved = { b: E.packBoard(a.board), taken: a.taken, score: a.score };
  const b = E.restoreGame({ colors: 4, seed: 77 }, saved);
  assert.strictEqual(b.taken, 9);
  assert.strictEqual(b.score, 120);
  for (let i = 0; i < 20; i++) {
    E.spawn(a); E.spawn(b);
    assert.deepStrictEqual([b.piece.a, b.piece.b], [a.piece.a, a.piece.b]);
    a.piece = null; b.piece = null;
  }
});

console.log(n + ' tests passed');
