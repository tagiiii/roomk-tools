// すとんブロックのしくみを確かめる。実行: node tests/suton-block/engine.test.cjs
const assert = require('assert');
const E = require('../../apps/suton-block/engine.js');
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('同じ種なら同じ順番で出る', () => {
  const a = E.createGame({ seed: 42 }), b = E.createGame({ seed: 42 });
  for (let i = 0; i < 30; i++) {
    assert.strictEqual(a.piece.kind, b.piece.kind);
    assert.deepStrictEqual(a.piece.cells, b.piece.cells);
    E.hardDrop(a); E.hardDrop(b);
  }
});

t('8種類が袋ごとに1回ずつ出る', () => {
  const r = E.rng(7);
  const bag = E.makeBag(r).map((x) => x.kind).sort();
  assert.deepStrictEqual(bag, E.KINDS.slice().sort());
});

t('かべの外へは動かない', () => {
  const g = E.createGame({ seed: 1 });
  for (let i = 0; i < 20; i++) E.move(g, -1, 0);
  const minX = Math.min(...g.piece.cells.map(([x]) => g.piece.x + x));
  assert.strictEqual(minX, 0);
});

t('4回回すと元の形にもどる・裏返し2回で元にもどる', () => {
  const g = E.createGame({ seed: 3 });
  E.move(g, 0, 3);
  const before = JSON.stringify(g.piece.cells.map(([x, y]) => [g.piece.x + x, g.piece.y + y]).sort());
  for (let i = 0; i < 4; i++) assert.ok(E.rotate(g, 1));
  assert.strictEqual(JSON.stringify(g.piece.cells.map(([x, y]) => [g.piece.x + x, g.piece.y + y]).sort()), before);
  E.flip(g); E.flip(g);
  assert.strictEqual(JSON.stringify(g.piece.cells.map(([x, y]) => [g.piece.x + x, g.piece.y + y]).sort()), before);
});

t('かべぎわで回すと、ずらして回る', () => {
  const g = E.createGame({ seed: 1 });
  g.piece = E.newPiece({ kind: 'bou4', flip: false });
  E.rotate(g, 1); // たて
  g.piece.y = 5;
  for (let i = 0; i < 10; i++) E.move(g, 1, 0);
  assert.ok(E.rotate(g, 1), 'よこにもどせる');
  const xs = g.piece.cells.map(([x]) => g.piece.x + x);
  assert.ok(Math.max(...xs) <= E.W - 1 && Math.min(...xs) >= 0);
});

t('張り出しの下のすき間へ、回してねじこめる（下にずらす）', () => {
  const g = E.createGame({ seed: 1 });
  const r = E.H - 3;
  g.board = E.emptyBoard();
  g.board[r][1] = 'futa';      // 張り出し
  g.board[E.H - 1][1] = 'futa'; // すき間の床
  // 「└」の形で、張り出しの左に乗っている
  g.piece = { kind: 'kagi3', n: 2, cells: [[0, 0], [0, 1], [1, 1]], x: 0, y: r };
  assert.ok(!E.fits(g.board, g.piece, g.piece.cells, 0, r + 1), '置かれる前の位置で止まっている');
  assert.ok(E.rotate(g, 1));
  assert.strictEqual(g.piece.y, r + 1, '下へ1マスずれて入る');
  const cells = g.piece.cells.map(([x, y]) => [g.piece.x + x, g.piece.y + y]).sort().join(' ');
  assert.strictEqual(cells, '0,' + (r + 1) + ' 0,' + (r + 2) + ' 1,' + (r + 1));
  E.lock(g);
  assert.strictEqual(g.board[r + 1][1], 'kagi3', '張り出しの下に入った');
});

t('右回りは右へ、左回りは左へ先にずらす', () => {
  const bar = () => {
    const g = E.createGame({ seed: 1 });
    g.board = E.emptyBoard();
    g.piece = { kind: 'bou4', n: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]], x: 3, y: 5 };
    return g;
  };
  const right = bar();
  right.board[8][5] = 'futa'; // その場で右回りした先をふさぐ
  assert.ok(E.rotate(right, 1));
  assert.strictEqual(right.piece.x, 4, '右へ1マス');
  const left = bar();
  left.board[8][4] = 'futa'; // その場で左回りした先をふさぐ
  assert.ok(E.rotate(left, -1));
  assert.strictEqual(left.piece.x, 2, '左へ1マス');
});

t('4マスの棒だけは、横に2マス＋上に1マスまで試す', () => {
  assert.ok(E.kicksFor('bou4', 1).some(([x, y]) => x === 2 && y === -1));
  assert.ok(!E.kicksFor('yama', 1).some(([x, y]) => x === 2 && y === -1));
  assert.deepStrictEqual(E.kicksFor('yama', -1)[1], [-1, 0], '左回りは左が先');
});

t('横1段がうまると消えて数える', () => {
  const g = E.createGame({ seed: 1 });
  for (let x = 0; x < E.W - 1; x++) g.board[E.H - 1][x] = 'futa';
  g.board[E.H - 2][0] = 'futa';
  g.piece = { kind: 'futa', n: 2, cells: [[0, 0], [0, 1]], x: E.W - 1, y: 0 };
  const res = E.hardDrop(g);
  assert.strictEqual(res.lines, 1);
  assert.strictEqual(g.lines, 1);
  // 1段下がる
  assert.strictEqual(g.board[E.H - 1][0], 'futa');
  assert.strictEqual(g.board[E.H - 1][E.W - 1], 'futa');
  assert.strictEqual(g.board[E.H - 1].filter(Boolean).length, 2);
});

t('いっぱいになったら、からにしてつづける', () => {
  const g = E.createGame({ seed: 5, onFull: 'clear' });
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) if (x !== 9) g.board[y][x] = 'bou3';
  const r = E.spawn(g);
  assert.ok(r.full && r.cleared);
  assert.ok(!g.over);
  assert.strictEqual(g.board.flat().filter(Boolean).length, 0);
});

t('いっぱいになったら、おしまい', () => {
  const g = E.createGame({ seed: 5, onFull: 'end' });
  let guard = 0;
  while (!g.over && guard++ < 500) E.hardDrop(g);
  assert.ok(g.over);
});

t('積みつづけても、からにしてつづける', () => {
  const g = E.createGame({ seed: 9, onFull: 'clear' });
  for (let i = 0; i < 300; i++) E.hardDrop(g);
  assert.ok(!g.over);
  assert.ok(g.resets > 0);
});

t('盤をつめて送り、もどせる', () => {
  const g = E.createGame({ seed: 2 });
  for (let i = 0; i < 12; i++) E.hardDrop(g);
  const s = E.packBoard(g.board);
  assert.strictEqual(s.length, E.W * E.H);
  assert.deepStrictEqual(E.unpackBoard(s), g.board);
  assert.deepStrictEqual(E.unpackBoard('へん'), E.emptyBoard());
});

t('じゃまブロックが下から入り、1列だけあいている', () => {
  const g = E.createGame({ seed: 4 });
  g.board[E.H - 1][0] = 'futa';
  const r = E.addGarbage(g, 2, 3);
  assert.ok(!r.full);
  assert.strictEqual(g.board[E.H - 3][0], 'futa', 'もとの段は2段上がる');
  for (const y of [E.H - 2, E.H - 1]) {
    assert.strictEqual(g.board[y][3], null);
    assert.strictEqual(g.board[y].filter((c) => c === 'jama').length, E.W - 1);
  }
  assert.ok(E.fits(g.board, g.piece, g.piece.cells, g.piece.x, g.piece.y));
  assert.strictEqual(E.unpackBoard(E.packBoard(g.board))[E.H - 1][0], 'jama', '送れる');
});

t('じゃまのあいた列にブロックを入れると消える', () => {
  const g = E.createGame({ seed: 4 });
  g.board = E.emptyBoard();
  E.addGarbage(g, 1, 9);
  g.piece = { kind: 'futa', n: 2, cells: [[0, 0], [0, 1]], x: 9, y: 0 };
  const res = E.hardDrop(g);
  assert.strictEqual(res.lines, 1);
});

t('じゃまで上にはみ出したら、からにしてつづける', () => {
  const g = E.createGame({ seed: 4, onFull: 'clear' });
  g.board[1][5] = 'futa';
  const r = E.addGarbage(g, 3, 0);
  assert.ok(r.full && r.cleared && !g.over);
  assert.strictEqual(g.board.flat().filter(Boolean).length, 0);
});

t('じゃまで押し上げられても、落ちているブロックは重ならない', () => {
  const g = E.createGame({ seed: 4 });
  g.board = E.emptyBoard();
  g.piece = { kind: 'shikaku', n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], x: 2, y: E.H - 3 };
  E.addGarbage(g, 2, 9);
  assert.ok(E.fits(g.board, g.piece, g.piece.cells, g.piece.x, g.piece.y));
  assert.strictEqual(g.piece.y, E.H - 4);
});

t('とっておく: しまって、つぎが出る。もう一度は置くまで使えない', () => {
  const g = E.createGame({ seed: 11 });
  const first = g.piece.kind;
  const second = g.queue[0].kind;
  E.rotate(g, 1);
  assert.ok(E.hold(g));
  assert.strictEqual(g.hold.kind, first);
  assert.strictEqual(g.piece.kind, second);
  assert.strictEqual(E.hold(g), false, '同じブロックで2回目はできない');
  E.hardDrop(g);
  const third = g.piece.kind;
  assert.ok(E.hold(g), '置いたらまた使える');
  assert.strictEqual(g.piece.kind, first, 'しまってあったものが出る');
  assert.deepStrictEqual(g.piece.cells, E.newPiece({ kind: first, flip: g.piece.flip }).cells, 'はじめの向きで出る');
  assert.strictEqual(g.hold.kind, third);
});

t('とっておいても、出る順番（種）は変わらない', () => {
  const a = E.createGame({ seed: 21 }), b = E.createGame({ seed: 21 });
  E.hold(a);
  const seqA = [a.piece.kind, ...a.queue.slice(0, 3).map((x) => x.kind)];
  E.hardDrop(b);
  const seqB = [b.piece.kind, ...b.queue.slice(0, 3).map((x) => x.kind)];
  assert.deepStrictEqual(seqA, seqB);
});

t('読み込み直し: 同じ種・取り出した数から、同じ順番の続きになる', () => {
  const a = E.createGame({ seed: 31 });
  for (let i = 0; i < 7; i++) E.hardDrop(a);
  E.hold(a);
  E.hardDrop(a);
  const saved = { b: E.packBoard(a.board), lines: a.lines, pieces: a.pieces, resets: a.resets, taken: a.taken, hold: a.hold, holdUsed: a.holdUsed };
  const b = E.restoreGame({ seed: 31 }, saved);
  assert.strictEqual(b.piece.kind, a.piece.kind, 'いま落ちているブロック');
  assert.deepStrictEqual(b.queue.slice(0, 5).map((x) => x.kind), a.queue.slice(0, 5).map((x) => x.kind), 'つぎの順番');
  assert.deepStrictEqual(b.board, a.board);
  assert.strictEqual(b.hold.kind, a.hold.kind);
  assert.strictEqual(b.lines, a.lines);
  for (let i = 0; i < 20; i++) { E.hardDrop(a); E.hardDrop(b); }
  assert.deepStrictEqual(b.board, a.board, '続けても同じ');
});

t('読み込み直し: こわれた記録でも動く', () => {
  const g = E.restoreGame({ seed: 5 }, { b: 'x', taken: 'abc', hold: { kind: 'nai' } });
  assert.ok(g.piece && !g.over);
  assert.strictEqual(g.hold, null);
  assert.strictEqual(g.taken, 1);
});

t('上にはみ出して置いても、段が消えればはみ出した分が下がって入る', () => {
  const g = E.createGame({ seed: 3 });
  g.board = E.emptyBoard();
  // 下の2段を、0列だけあけてうめる。0列の上（1〜17段目）もうめて、たての棒がはみ出すようにする
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) if (x !== 0 && (y >= E.H - 2)) g.board[y][x] = 'futa';
  for (let y = 2; y < E.H - 2; y++) g.board[y][1] = 'futa';
  g.piece = { kind: 'bou4', flip: false, n: 4, cells: [[0, 0], [0, 1], [0, 2], [0, 3]], x: 0, y: -2 };
  // 0列に、上2マスがはみ出した状態で置く（下の2マスは 0・1段目）。段は消えないので、いっぱい
  const r1 = E.lock(g);
  assert.ok(r1.full, 'はみ出して消えなければいっぱい');
  const h = E.createGame({ seed: 3 });
  h.board = E.emptyBoard();
  for (let x = 1; x < E.W; x++) { h.board[0][x] = 'futa'; h.board[1][x] = 'futa'; }
  for (let y = 2; y < E.H; y++) for (let x = 1; x < E.W; x++) h.board[y][x] = 'futa';
  h.piece = { kind: 'bou4', flip: false, n: 4, cells: [[0, 0], [0, 1], [0, 2], [0, 3]], x: 0, y: -2 };
  const r2 = E.lock(h);
  assert.ok(!r2.full, '2段消えて、はみ出した2マスは入る');
  assert.strictEqual(r2.lines, 2);
  assert.strictEqual(h.board[0][0], 'bou4');
  assert.strictEqual(h.board[1][0], 'bou4');
});

console.log('engine: ' + n + ' 項目 OK');
