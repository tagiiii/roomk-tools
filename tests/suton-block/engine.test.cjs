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

t('7種類（I・O・T・S・Z・L・J）が袋ごとに1回ずつ出る', () => {
  const r = E.rng(7);
  const bag = E.makeBag(r).map((x) => x.kind).sort();
  assert.deepStrictEqual(bag, E.KINDS.slice().sort());
  assert.deepStrictEqual(E.KINDS.slice().sort(), ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
  for (const k of E.KINDS) assert.strictEqual(E.SHAPES[k].cells.length, 4, k + ' は4マス');
});

t('かべの外へは動かない', () => {
  const g = E.createGame({ seed: 1 });
  for (let i = 0; i < 20; i++) E.move(g, -1, 0);
  const minX = Math.min(...g.piece.cells.map(([x]) => g.piece.x + x));
  assert.strictEqual(minX, 0);
});

t('広いところで4回回すと、元の場所・元の向きにもどる（どの形も、右回り・左回り）', () => {
  for (const kind of E.KINDS) for (const dir of [1, -1]) {
    const g = E.createGame({ seed: 3 });
    g.board = E.emptyBoard();
    g.piece = E.newPiece({ kind });
    g.piece.y = 8;
    const at = () => JSON.stringify(g.piece.cells.map(([x, y]) => [g.piece.x + x, g.piece.y + y]).sort());
    const before = at();
    for (let i = 0; i < 4; i++) assert.ok(E.rotate(g, dir));
    assert.strictEqual(at(), before, kind);
    assert.strictEqual(g.piece.rot, 0);
  }
});

t('かべぎわで回すと、ずらして回る', () => {
  const g = E.createGame({ seed: 1 });
  g.piece = E.newPiece({ kind: 'I' });
  E.rotate(g, 1); // たて
  g.piece.y = 5;
  for (let i = 0; i < 10; i++) E.move(g, 1, 0);
  assert.ok(E.rotate(g, 1), 'よこにもどせる');
  const xs = g.piece.cells.map(([x]) => g.piece.x + x);
  assert.ok(Math.max(...xs) <= E.W - 1 && Math.min(...xs) >= 0);
});

// 回した先がふさがっているとき、表の d 番目のずらし方だけが通るように盤をうめて、d 番目で回ることを確かめる
const cellsAt = (cells, x, y) => cells.map(([cx, cy]) => (x + cx) + ',' + (y + cy));
t('回せないときは、向きの組み合わせごとの5通りを順に試す（I・T・S・Z・L・J のすべての回し方）', () => {
  let checked = 0;
  for (const kind of E.KINDS.filter((k) => k !== 'O')) for (let from = 0; from < 4; from++) for (const dir of [1, -1]) {
    const to = (from + (dir < 0 ? 3 : 1)) % 4;
    const kicks = E.kicksFor(kind, from, to);
    assert.strictEqual(kicks.length, 5);
    for (let d = 0; d < 5; d++) {
      const g = E.createGame({ seed: 1 });
      g.board = E.emptyBoard();
      const p = E.newPiece({ kind });
      g.piece = p;
      for (let i = 0; i < from; i++) assert.ok(E.rotate(g, 1));
      p.x = 3; p.y = 8;
      let cells = p.cells;
      const rot = (c) => c.map(([x, y]) => [p.n - 1 - y, x]);
      cells = dir > 0 ? rot(cells) : rot(rot(rot(cells)));
      const keep = new Set([...cellsAt(p.cells, p.x, p.y), ...cellsAt(cells, p.x + kicks[d][0], p.y + kicks[d][1])]);
      let ok = true;
      for (let e = 0; e < d; e++) {
        const block = cellsAt(cells, p.x + kicks[e][0], p.y + kicks[e][1]).filter((c) => !keep.has(c));
        if (!block.length) { ok = false; break; }
        const [bx, by] = block[0].split(',').map(Number);
        g.board[by][bx] = 'jama';
      }
      if (!ok) continue; // 前のずらし方と同じマスしか使わないときは、ふさげない
      assert.ok(E.rotate(g, dir), kind + ' ' + from + '>' + to + ' #' + d);
      assert.deepStrictEqual([p.x - 3, p.y - 8], kicks[d], kind + ' ' + from + '>' + to + ' #' + d);
      assert.strictEqual(p.rot, to);
      checked++;
    }
  }
  assert.ok(checked > 200, '確かめた数 ' + checked);
});

t('ずらし方の表（よく知られた回し方の表と同じ値）', () => {
  assert.deepStrictEqual(E.kicksFor('T', 0, 1), [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]]);
  assert.deepStrictEqual(E.kicksFor('L', 3, 0), [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]);
  assert.deepStrictEqual(E.kicksFor('I', 0, 1), [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]]);
  assert.deepStrictEqual(E.kicksFor('I', 1, 2), [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]]);
  assert.deepStrictEqual(E.kicksFor('O', 0, 1), [[0, 0]]);
});

// 2026-11-02 フィードバックボードの盤。左向きの T を右に回すと、下の穴には入らず、上へ2マスずれて回る
t('入らないはずの穴には入らず、上へずれて回る', () => {
  const rows = ['XXX..XXXXX', 'XXX...XXXX', 'XXXXX.XXXX', 'XXXX..XXXX', 'XXXXX.XXXX'];
  const g = E.createGame({ seed: 1 });
  g.board = E.emptyBoard();
  rows.forEach((line, i) => [...line].forEach((ch, x) => { if (ch === 'X') g.board[E.H - 5 + i][x] = 'jama'; }));
  const p = E.newPiece({ kind: 'T' });
  g.piece = p;
  p.y = 5;
  assert.ok(E.rotate(g, -1)); // 左向き
  p.x = 3; p.y = E.H - 6;     // (4,14) (3,15) (4,15) (4,16)
  assert.ok(E.fits(g.board, p, p.cells, p.x, p.y));
  assert.ok(E.rotate(g, 1));
  const cells = p.cells.map(([x, y]) => [p.x + x, p.y + y]).sort().join(' ');
  assert.strictEqual(cells, [[4, 12], [3, 13], [4, 13], [5, 13]].sort().join(' '), '上へ2マス');
  assert.strictEqual(p.rot, 0);
});

// 屋根の下の深いすき間（下3段に縦3マス＋まん中の出っぱり）へ、T を回して縦に入れる。右回りは左右を反転した盤
t('屋根の下の深いすき間へ、T を回して縦に入れられる（3段・2段消える）', () => {
  const rows = ['...XXXXXXX', '....XXXXXX', 'XXX.XXXXXX', 'XX..XXXXXX', 'XXX.XXXXXX'];
  for (const [mirror, full] of [[false, 3], [true, 3], [false, 2], [true, 2]]) {
    const g = E.createGame({ seed: 1 });
    g.board = E.emptyBoard();
    rows.forEach((line, i) => [...line].forEach((ch, x) => {
      if (i === 2 && x === 9 && full === 2) return; // 1段だけうめずに、2段消しの形にする
      if (ch === 'X') g.board[E.H - 5 + i][mirror ? 9 - x : x] = 'jama';
    }));
    const p = E.newPiece({ kind: 'T' });
    p.y = E.H - 5;
    p.x = mirror ? 6 : 1;
    g.piece = p;
    assert.ok(E.fits(g.board, p, p.cells, p.x, p.y));
    assert.ok(E.rotate(g, mirror ? 1 : -1));
    const c = mirror ? 6 : 3, nub = mirror ? 7 : 2, r = E.H - 3;
    const cells = g.piece.cells.map(([x, y]) => [g.piece.x + x, g.piece.y + y]).sort().join(' ');
    assert.strictEqual(cells, [[c, r], [c, r + 1], [c, r + 2], [nub, r + 1]].sort().join(' '), (mirror ? '右' : '左') + '回り');
    assert.strictEqual(E.lock(g).lines, full);
  }
});

t('O は回しても動かない', () => {
  const g = E.createGame({ seed: 1 });
  g.board = E.emptyBoard();
  g.piece = E.newPiece({ kind: 'O' });
  g.piece.y = 5;
  const at = () => JSON.stringify(g.piece.cells.map(([x, y]) => [g.piece.x + x, g.piece.y + y]).sort());
  const before = at();
  assert.ok(E.rotate(g, 1));
  assert.strictEqual(at(), before);
  assert.ok(E.rotate(g, -1));
  assert.strictEqual(at(), before);
});

t('横1段がうまると消えて数える', () => {
  const g = E.createGame({ seed: 1 });
  for (let x = 0; x < E.W - 1; x++) g.board[E.H - 1][x] = 'jama';
  g.board[E.H - 2][0] = 'jama';
  g.piece = { kind: 'I', n: 4, rot: 1, cells: [[2, 0], [2, 1], [2, 2], [2, 3]], x: E.W - 3, y: 0 };
  const res = E.hardDrop(g);
  assert.strictEqual(res.lines, 1);
  assert.strictEqual(g.lines, 1);
  // 1段下がる
  assert.strictEqual(g.board[E.H - 1][0], 'jama');
  assert.strictEqual(g.board[E.H - 1][E.W - 1], 'I');
  assert.strictEqual(g.board[E.H - 1].filter(Boolean).length, 2);
});

t('いっぱいになったら、からにしてつづける', () => {
  const g = E.createGame({ seed: 5, onFull: 'clear' });
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) if (x !== 9) g.board[y][x] = 'jama';
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
  g.board[E.H - 1][0] = 'jama';
  const r = E.addGarbage(g, 2, 3);
  assert.ok(!r.full);
  assert.strictEqual(g.board[E.H - 3][0], 'jama', 'もとの段は2段上がる');
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
  g.piece = { kind: 'I', n: 4, rot: 1, cells: [[2, 0], [2, 1], [2, 2], [2, 3]], x: 7, y: 0 };
  const res = E.hardDrop(g);
  assert.strictEqual(res.lines, 1);
});

t('じゃまで上にはみ出したら、からにしてつづける', () => {
  const g = E.createGame({ seed: 4, onFull: 'clear' });
  g.board[1][5] = 'jama';
  const r = E.addGarbage(g, 3, 0);
  assert.ok(r.full && r.cleared && !g.over);
  assert.strictEqual(g.board.flat().filter(Boolean).length, 0);
});

t('じゃまで押し上げられても、落ちているブロックは重ならない', () => {
  const g = E.createGame({ seed: 4 });
  g.board = E.emptyBoard();
  g.piece = { kind: 'O', n: 2, cells: [[0, 0], [1, 0], [0, 1], [1, 1]], x: 2, y: E.H - 3 };
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
  assert.deepStrictEqual(g.piece.cells, E.newPiece({ kind: first }).cells, 'はじめの向きで出る');
  assert.strictEqual(g.piece.rot, 0);
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
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) if (x !== 0 && (y >= E.H - 2)) g.board[y][x] = 'jama';
  for (let y = 2; y < E.H - 2; y++) g.board[y][1] = 'jama';
  g.piece = { kind: 'I', n: 4, rot: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3]], x: 0, y: -2 };
  // 0列に、上2マスがはみ出した状態で置く（下の2マスは 0・1段目）。段は消えないので、いっぱい
  const r1 = E.lock(g);
  assert.ok(r1.full, 'はみ出して消えなければいっぱい');
  const h = E.createGame({ seed: 3 });
  h.board = E.emptyBoard();
  for (let x = 1; x < E.W; x++) { h.board[0][x] = 'jama'; h.board[1][x] = 'jama'; }
  for (let y = 2; y < E.H; y++) for (let x = 1; x < E.W; x++) h.board[y][x] = 'jama';
  h.piece = { kind: 'I', n: 4, rot: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3]], x: 0, y: -2 };
  const r2 = E.lock(h);
  assert.ok(!r2.full, '2段消えて、はみ出した2マスは入る');
  assert.strictEqual(r2.lines, 2);
  assert.strictEqual(h.board[0][0], 'I');
  assert.strictEqual(h.board[1][0], 'I');
});

// ── 対戦で送るじゃま（よく知られた対戦の表）──
// 下の段から文字で盤を作る（X はうまっている）
function boardFrom(rows) {
  const b = E.emptyBoard();
  rows.forEach((row, i) => {
    const y = E.H - rows.length + i;
    for (let x = 0; x < E.W; x++) if (row[x] === 'X') b[y][x] = 'jama';
  });
  return b;
}
// 向き rot の T を (x, y) に置いて、最後の動きを回すにする
function tAt(rot, x, y, kick = 0) {
  const p = E.newPiece({ kind: 'T' });
  for (let i = 0; i < rot; i++) p.cells = p.cells.map(([cx, cy]) => [p.n - 1 - cy, cx]);
  return Object.assign(p, { rot, x, y, spun: true, kick });
}
// たての棒を列 x に、下の4段へ置く
function iDown(x) {
  return { kind: 'I', n: 4, rot: 1, cells: [[0, 0], [0, 1], [0, 2], [0, 3]], x, y: E.H - 4 };
}
// うめていない1列を残して、下の n 段をうめる。その上に1マス残して、消しても全部は消えないようにする
function wellRows(n, gap) {
  return ['........X.'].concat(Array.from({ length: n }, () => 'XXXXXXXXXX'.split('').map((c, x) => (x === gap ? '.' : c)).join('')));
}

t('回し入れダブルは4段、つづけて4段消すと 4＋1（つづけて大技）', () => {
  const g = E.createGame({ seed: 1 });
  // まん中に T のすき間。左上がひさしになっている
  g.board = boardFrom(['...X......', 'XXX...XXXX', 'XXXX.XXXXX']);
  g.piece = tAt(2, 3, E.H - 3);
  const r = E.lock(g);
  assert.strictEqual(r.lines, 2);
  assert.strictEqual(r.spin, 'spin');
  assert.strictEqual(r.attack, 4);
  g.board = boardFrom(wellRows(4, 0));
  g.piece = iDown(0);
  const r2 = E.lock(g);
  assert.strictEqual(r2.lines, 4);
  assert.ok(r2.b2b);
  assert.strictEqual(r2.attack, 5, '4＋つづけて大技1（れんぞく2回目は0）');
});

t('1段0・2段1・3段2・4段4。ふつうに消すと、つづけて大技が切れる', () => {
  const lines = (n) => {
    const g = E.createGame({ seed: 1 });
    g.board = boardFrom(wellRows(n, 0));
    g.piece = iDown(0);
    return E.lock(g).attack;
  };
  assert.deepStrictEqual([1, 2, 3, 4].map(lines), [0, 1, 2, 4]);
  const g = E.createGame({ seed: 1 });
  g.board = boardFrom(wellRows(4, 0)); g.piece = iDown(0); E.lock(g);
  g.board = boardFrom(wellRows(2, 0)); g.piece = iDown(0); E.lock(g);
  assert.ok(!g.b2b, '2段で切れる');
  g.board = E.emptyBoard(); g.piece = iDown(0); E.lock(g); // 消さずに置いて、れんぞくを切る
  g.board = boardFrom(wellRows(4, 0)); g.piece = iDown(0);
  assert.strictEqual(E.lock(g).attack, 4, '切れたあとの4段は4のまま');
});

t('れんぞくで消すと 0・0・1・1・2…と足す（消さずに置くともどる。つづけて大技はのこる）', () => {
  const g = E.createGame({ seed: 1 });
  const got = [];
  for (let i = 0; i < 5; i++) {
    g.board = boardFrom(wellRows(2, 0)); g.piece = iDown(0);
    got.push(E.lock(g).attack);
  }
  assert.deepStrictEqual(got, [1, 1, 2, 2, 3]);
  g.board = boardFrom(wellRows(4, 0)); g.piece = iDown(0); E.lock(g);
  g.board = E.emptyBoard(); g.piece = iDown(0);
  const r = E.lock(g);
  assert.strictEqual(r.combo, -1);
  assert.ok(g.b2b, '消さずに置いても、つづけて大技は切れない');
});

t('盤が全部消えたら10段', () => {
  const g = E.createGame({ seed: 1 });
  g.board = boardFrom(['....XXXXXX']);
  g.piece = Object.assign(E.newPiece({ kind: 'I' }), { x: 0, y: E.H - 2 });
  const r = E.lock(g);
  assert.ok(r.allClear);
  assert.strictEqual(r.attack, 10);
});

t('小さな回し入れ（出っぱりの側のすみが1つあいている）は、ふつうに消したのと同じ', () => {
  const g = E.createGame({ seed: 1 });
  // 右向きの T を左はしに。うしろ（左）のすみはかべ。出っぱりの側は右下だけうまっている
  g.board = boardFrom(['..........', '..XXXXXXXX', '.XXXXXXXXX']);
  g.piece = tAt(1, -1, E.H - 3);
  const r = E.lock(g);
  assert.strictEqual(r.spin, 'mini');
  assert.strictEqual(r.lines, 2);
  assert.strictEqual(r.attack, 1, '小さな回し入れの2段は、ふつうの2段と同じ1');
  // 5番目のずらし方で入ったときは、ふつうの回し入れ
  const h = E.createGame({ seed: 1 });
  h.board = boardFrom(['..........', '..XXXXXXXX', '.XXXXXXXXX']);
  h.piece = tAt(1, -1, E.H - 3, 4);
  assert.strictEqual(E.lock(h).spin, 'spin');
});

t('回したあと動かした・落ちた T は回し入れにならない。回すと回し入れの目じるしがつく', () => {
  const g = E.createGame({ seed: 1 });
  g.board = E.emptyBoard();
  g.piece = E.newPiece({ kind: 'T' });
  g.piece.y = 5;
  assert.ok(E.rotate(g, 1));
  assert.ok(g.piece.spun);
  assert.ok(E.move(g, 1, 0));
  assert.ok(!g.piece.spun);
  assert.ok(E.rotate(g, 1));
  E.hardDrop(g);
  assert.strictEqual(E.spinOf(g, { kind: 'T', spun: false }), null);
});

t('読み込み直し: ここまでになった人は、そのまま', () => {
  const g = E.restoreGame({ seed: 5, onFull: 'end' }, { b: '.'.repeat(200), taken: 3, out: true, b2b: true, combo: 2 });
  assert.ok(g.over);
  assert.strictEqual(g.piece, null);
  assert.ok(g.b2b);
  assert.strictEqual(g.combo, 2);
});

t('おしまい: つぎが出せないときは、出せなかったブロックを残す（動かせない）', () => {
  const g = E.createGame({ seed: 5, onFull: 'end' });
  for (let y = 0; y < 3; y++) for (let x = 0; x < E.W; x++) if (x !== 0) g.board[y][x] = 'jama';
  const r = E.spawn(g);
  assert.ok(r.full && g.over);
  assert.strictEqual(g.overBy, 'spawn');
  assert.ok(g.piece, '出せなかったブロックが残る');
  assert.ok(!E.fits(g.board, g.piece, g.piece.cells, g.piece.x, g.piece.y));
  const before = JSON.stringify(g.piece);
  assert.ok(!E.move(g, 1, 0) && !E.rotate(g, 1));
  assert.strictEqual(JSON.stringify(g.piece), before);
  assert.strictEqual(E.hardDrop(g).lines, 0);
  assert.strictEqual(E.hold(g), false);
});

t('おしまい: じゃまで押し上げられたら、じゃまが入った盤のまま止まる', () => {
  const g = E.createGame({ seed: 4, onFull: 'end' });
  g.board = E.emptyBoard();
  g.board[1][5] = 'L';
  g.board[E.H - 1][2] = 'T';
  const r = E.addGarbage(g, 3, 0);
  assert.ok(r.full && g.over && !r.cleared);
  assert.strictEqual(g.overBy, 'jama');
  assert.strictEqual(g.piece, null);
  for (const y of [E.H - 3, E.H - 2, E.H - 1]) {
    assert.strictEqual(g.board[y][0], null);
    assert.strictEqual(g.board[y].filter((c) => c === 'jama').length, E.W - 1);
  }
  assert.strictEqual(g.board[E.H - 4][2], 'T', 'もとの段は3段上がる');
  assert.strictEqual(g.board.flat().filter((c) => c === 'L').length, 0, '上にはみ出したマスは盤の外');
  assert.strictEqual(E.unpackBoard(E.packBoard(g.board))[E.H - 1][1], 'jama', '入ったじゃまも送る盤に入る');
});

t('おしまい: 上にはみ出して置いたら、わけは top', () => {
  const g = E.createGame({ seed: 4, onFull: 'end' });
  g.board = E.emptyBoard();
  for (let y = 2; y < E.H; y++) g.board[y][0] = 'jama';
  g.piece = { kind: 'I', n: 4, rot: 1, cells: [[2, 0], [2, 1], [2, 2], [2, 3]], x: -2, y: -4 };
  E.hardDrop(g);
  assert.ok(g.over);
  assert.strictEqual(g.overBy, 'top');
});

console.log('engine: ' + n + ' 項目 OK');
