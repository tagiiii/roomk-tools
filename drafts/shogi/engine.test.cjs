/* 将棋（試作）のルールのテスト
   実行: node drafts/shogi/engine.test.cjs */
'use strict';
const assert = require('assert');
const E = require('./engine.js');

let pass = 0;
function test(name, fn) {
  fn();
  pass += 1;
  console.log('ok  ' + name);
}

// 盤を文字で作る（'.' は空き。成った駒は「+P」のように2文字なので、ますは空白で区切る）
function pos(v, rows, turn, hands) {
  const S = E.create(v);
  S.board = [];
  rows.forEach((row) => row.trim().split(/\s+/).forEach((x) => S.board.push(x === '.' ? '' : x)));
  assert.strictEqual(S.board.length, S.n * S.n);
  S.turn = turn || 0;
  if (hands) {
    [0, 1].forEach((o) => Object.assign(S.hands[o], hands[o] || {}));
  }
  S.keys = [E.keyOf(S)];
  S.checks = [false];
  return S;
}
const at = (S, file, rank) => (rank - 1) * S.n + (S.n - file);   // 「７六」→ 添字

function perft(S, d) {
  if (d === 0) return 1;
  const ms = E.legalMoves(S);
  if (d === 1) return ms.length;
  let total = 0;
  for (const m of ms) total += perft(E.apply(S, m), d - 1);
  return total;
}

test('本将棋のはじめの局面からの手の数（既知の値 30・900・25470）', () => {
  const S = E.create('hon');
  assert.strictEqual(perft(S, 1), 30);
  assert.strictEqual(perft(S, 2), 900);
  assert.strictEqual(perft(S, 3), 25470);
});

test('5五将棋のはじめの局面からの手の数（既知の値 14・181・2512・35401）', () => {
  const S = E.create('mini');
  assert.strictEqual(perft(S, 1), 14);
  assert.strictEqual(perft(S, 2), 181);
  assert.strictEqual(perft(S, 3), 2512);
  assert.strictEqual(perft(S, 4), 35401);
});

test('二歩は打てない・理由が出る', () => {
  const S = pos('mini', [
    '. . . . k',
    '. . . . .',
    '. . . . .',
    'P . . . .',
    'K . . . .',
  ], 0, [{ P: 1 }]);
  const drops = E.legalMoves(S).filter((m) => m.drop === 'P');
  assert.ok(drops.every((m) => m.to % 5 !== 0));
  assert.ok(drops.length > 0);
  assert.ok(E.whyIllegal(S, -1, at(S, 5, 3), 'P').includes('二歩'));
});

test('いちばん奥の段には歩・香を打てない、桂は奥の2段に打てない', () => {
  const S = pos('hon', [
    '. . . . k . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . K . . . .',
  ], 0, [{ P: 1, L: 1, N: 1 }]);
  const ms = E.legalMoves(S);
  const rowOf = (m) => Math.floor(m.to / 9);
  assert.ok(!ms.some((m) => m.drop === 'P' && rowOf(m) === 0));
  assert.ok(!ms.some((m) => m.drop === 'L' && rowOf(m) === 0));
  assert.ok(!ms.some((m) => m.drop === 'N' && rowOf(m) <= 1));
  assert.ok(ms.some((m) => m.drop === 'N' && rowOf(m) === 2));
});

test('打ち歩詰めは指せない（突き歩詰めは指せる）', () => {
  // 後手の王が1一・桂が2一、先手の金が2三・香が1九。1二に歩を打つと詰みになる
  const S = pos('hon', [
    '. . . . . . . n k',
    '. . . . . . . . .',
    '. . . . . . . G .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . K . . . L',
  ], 0, [{ P: 1 }]);
  const to = at(S, 1, 2);
  assert.ok(!E.legalMoves(S).some((m) => m.drop === 'P' && m.to === to));
  assert.ok(E.whyIllegal(S, -1, to, 'P').includes('打ち歩詰め'));
  // 盤の歩を突いて詰ますのはよい
  const T = pos('hon', [
    '. . . . . . . n k',
    '. . . . . . . . .',
    '. . . . . . . G P',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . K . . . L',
  ], 0);
  const m = E.legalMoves(T).find((mm) => mm.from === at(T, 1, 3) && mm.to === to && !mm.promote);
  assert.ok(m);
  const U = E.apply(T, m);
  assert.deepStrictEqual(U.over, { winner: 0, reason: 'mate' });
});

test('王手を放っておく手・自分の王を取らせる手は指せない', () => {
  const S = pos('mini', [
    'r . . . k',
    '. . . . .',
    '. . . . .',
    '. S . . .',
    'K . . . .',
  ], 0);
  // 飛車の王手。銀は王手をよけない所へ動けない
  assert.ok(E.inCheck(S.board, 5, 0));
  const ms = E.legalMoves(S);
  assert.ok(ms.every((m) => m.from === at(S, 5, 5) || m.to === at(S, 5, 4) || m.to === at(S, 5, 3)));
  assert.ok(E.whyIllegal(S, at(S, 4, 4), at(S, 4, 3)).includes('王手'));
});

test('行き所のない所へは必ず成る。成れる所では成る・成らないを選べる', () => {
  const S = pos('hon', [
    '. . . . k . . . .',
    'P . . . . . . . .',
    '. . . . . . . . .',
    '. . S . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . K . . . .',
  ], 0);
  const ms = E.legalMoves(S);
  const pawn = ms.filter((m) => m.from === at(S, 9, 2));
  assert.strictEqual(pawn.length, 1);
  assert.strictEqual(pawn[0].promote, true);
  const silver = ms.filter((m) => m.from === at(S, 7, 4) && m.to === at(S, 7, 3));
  assert.strictEqual(silver.length, 2);
  const U = E.apply(S, pawn[0]);
  assert.strictEqual(U.board[at(S, 9, 1)], '+P');
  assert.strictEqual(U.last.text, '▲９一歩成');
});

test('取った駒は成りをもどして持ち駒になる・記録の表記', () => {
  const T = pos('mini', [
    '. . . . k',
    '. . . . .',
    '. . . . .',
    '. . +b R .',
    'K . . . .',
  ], 0);
  const c = E.legalMoves(T).find((mm) => mm.from === at(T, 2, 4) && mm.to === at(T, 3, 4));
  const V = E.apply(T, c);
  assert.strictEqual(V.hands[0].B, 1);
  assert.strictEqual(V.last.text, '▲３四飛');
  const r = E.legalMoves(V).find((mm) => mm.from === at(V, 1, 1) && mm.to === at(V, 1, 2));
  const W = E.apply(V, r);
  const d = E.legalMoves(W).find((mm) => mm.drop === 'B' && mm.to === at(W, 1, 3));
  assert.strictEqual(E.apply(W, d).last.text, '▲１三角打');
});

test('千日手は引き分け、王手をかけ続けた側は負け', () => {
  const go = (S, f1, r1, f2, r2) => {
    const m = E.legalMoves(S).find((mm) => mm.from === at(S, f1, r1) && mm.to === at(S, f2, r2) && !mm.promote);
    assert.ok(m, 'move ' + f1 + r1 + f2 + r2);
    return E.apply(S, m);
  };
  // 飛車を行ったり来たり（どちらも王手でない）
  let S = pos('hon', [
    '. . . . k . . . r',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    'R . . . K . . . .',
  ], 0);
  for (let i = 0; i < 3; i += 1) {
    S = go(S, 9, 9, 9, 8);
    S = go(S, 1, 1, 1, 2);
    S = go(S, 9, 8, 9, 9);
    assert.strictEqual(S.over, null);
    S = go(S, 1, 2, 1, 1);
  }
  assert.deepStrictEqual(S.over, { winner: -1, reason: 'sennichite' });

  // 先手の飛車が王手をかけ続ける → 先手の負け
  let P = pos('hon', [
    '. . . . . . . . k',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . K . . R .',
  ], 0);
  for (let i = 0; i < 3; i += 1) {
    P = go(P, 2, 9, 1, 9);
    assert.ok(P.check);
    P = go(P, 1, 1, 2, 1);
    P = go(P, 1, 9, 2, 9);
    assert.strictEqual(P.over, null);
    P = go(P, 2, 1, 1, 1);
  }
  assert.deepStrictEqual(P.over, { winner: 1, reason: 'perpetual' });
});

test('でたらめ対局（ルールの破綻がない）', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  ['mini', 'hon'].forEach((v) => {
    for (let g = 0; g < 30; g += 1) {
      let S = E.create(v);
      const moves = [];
      while (!S.over && S.ply < 300) {
        const ms = E.legalMoves(S);
        assert.ok(ms.length > 0);
        const m = ms[Math.floor(rnd() * ms.length)];
        moves.push(m);
        const T = E.apply(S, m);
        assert.ok(!E.inCheck(T.board, T.n, S.turn), '自分の王に王手が残っていない');
        assert.ok(E.kingSquare(T.board, 0) >= 0 && E.kingSquare(T.board, 1) >= 0);
        const count = T.board.filter(Boolean).length + [0, 1].reduce((a, o) => a + E.HAND_ORDER.reduce((b, t) => b + T.hands[o][t], 0), 0);
        assert.strictEqual(count, v === 'hon' ? 40 : 12);
        S = T;
      }
      const R = E.replay(v, moves);
      assert.strictEqual(E.keyOf(R), E.keyOf(S));
    }
  });
});

console.log('\n' + pass + ' 件 合格');
