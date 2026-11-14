/* 将棋のルールのテスト
   実行: node tests/shogi/engine.test.cjs */
'use strict';
const assert = require('assert');
const E = require('../../apps/shogi/engine.js');

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
  assert.strictEqual(E.apply(W, d).last.text, '▲１三角');   // 盤の駒が同じ所へ動けないので「打」は付けない
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

test('表記: 上・引・寄・右・左・直・打（日本将棋連盟の決まり）', () => {
  const S = pos('hon', [
    '. . . . k . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . G . . . .',
    '. . . . . G . . .',
    '. . . G G G . S K',
  ], 0, [{ S: 1 }]);
  const text = (from, to, drop) => {
    const m = E.legalMoves(S).find((mm) => (drop ? mm.drop === drop : mm.from === from) && mm.to === to && !mm.promote);
    assert.ok(m, 'move ' + from + '->' + to);
    return E.apply(S, m).last.text;
  };
  // ５八へは5枚の金が動ける
  assert.strictEqual(text(at(S, 5, 7), at(S, 5, 8)), '▲５八金引');
  assert.strictEqual(text(at(S, 4, 8), at(S, 5, 8)), '▲５八金寄');
  assert.strictEqual(text(at(S, 5, 9), at(S, 5, 8)), '▲５八金直');
  assert.strictEqual(text(at(S, 6, 9), at(S, 5, 8)), '▲５八金左');
  assert.strictEqual(text(at(S, 4, 9), at(S, 5, 8)), '▲５八金右上');
  // ６八へ: ６九は「直」、５九は「右」
  assert.strictEqual(text(at(S, 6, 9), at(S, 6, 8)), '▲６八金直');
  assert.strictEqual(text(at(S, 5, 9), at(S, 6, 8)), '▲６八金右');
  // 銀を３八に打つ: ２九の銀も動けるので「打」
  assert.strictEqual(text(-1, at(S, 3, 8), 'S'), '▲３八銀打');
  assert.strictEqual(text(at(S, 2, 9), at(S, 3, 8)), '▲３八銀');
  // 後手から見た右・左（後手の金が４一と６一から５二へ）
  const G = pos('hon', [
    '. . . G k G . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    'K . . . . . . . .',
  ].map((r) => r.replace(/G/g, 'g')), 1);
  const gm = (f) => E.apply(G, E.legalMoves(G).find((mm) => mm.from === at(G, f, 1) && mm.to === at(G, 5, 2))).last.text;
  assert.strictEqual(gm(6), '△５二金右');
  assert.strictEqual(gm(4), '△５二金左');
});

test('表記: ピンされて動けない駒は数えない', () => {
  // 先手の玉５九・金５八（後手の飛車５一にピンされている）・金４七。４八へ指せる金は４七だけ
  const S = pos('hon', [
    '. . . . r . . . k',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . G . . .',
    '. . . . G . . . .',
    '. . . . K . . . .',
  ], 0, [{ G: 1 }]);
  const m = E.legalMoves(S).find((mm) => mm.from === at(S, 4, 7) && mm.to === at(S, 4, 8));
  assert.strictEqual(E.apply(S, m).last.text, '▲４八金');
  const d = E.legalMoves(S).find((mm) => mm.drop === 'G' && mm.to === at(S, 4, 9));
  // ４九へは４七の金は届かず、５八の金はピンされているので「打」は付けない
  assert.strictEqual(E.apply(S, d).last.text, '▲４九金');
});

test('5五将棋の千日手は先手の負け', () => {
  const go = (S, f1, r1, f2, r2) => {
    const m = E.legalMoves(S).find((mm) => mm.from === at(S, f1, r1) && mm.to === at(S, f2, r2) && !mm.promote);
    assert.ok(m);
    return E.apply(S, m);
  };
  let S = pos('mini', [
    '. . . . k',
    '. . . . .',
    '. . . . .',
    '. . . . .',
    'K . . . .',
  ], 0, [{}, {}]);
  for (let i = 0; i < 3; i += 1) {
    S = go(S, 5, 5, 4, 5);
    S = go(S, 1, 1, 2, 1);
    S = go(S, 4, 5, 5, 5);
    S = go(S, 2, 1, 1, 1);
  }
  assert.deepStrictEqual(S.over, { winner: 1, reason: 'sennichite' });
});

test('入玉宣言（27点法）', () => {
  // 先手の玉が１二。相手の陣に飛・角・金4・銀4（10枚・18点）＋持ち駒で28点にする
  const rows = [
    'R B G G G G . . .',
    'S S S S . . . K .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . k . . . .',
  ];
  const S = pos('hon', rows, 0, [{ P: 10 }]);
  assert.deepStrictEqual(E.declarePoints(S, 0), { points: 28, count: 10 });
  assert.strictEqual(E.canDeclare(S), true);
  const T = pos('hon', rows, 0, [{ P: 9 }]);
  assert.strictEqual(E.canDeclare(T), false, '27点では足りない（先手）');
  const U = pos('hon', rows, 1, [{ P: 10 }]);
  assert.strictEqual(E.canDeclare(U), false, '相手の番には宣言できない');
  const M = pos('mini', ['. . . K k', '. . . . .', '. . . . .', '. . . . .', '. . . . .'], 0);
  assert.strictEqual(E.canDeclare(M), false, '5五将棋は宣言しない');
});

test('CPU: 指せる手を返す・1手詰めを見つける・ただで取れる駒を取る', () => {
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  ['mini', 'hon'].forEach((v) => {
    ['weak', 'normal', 'strong'].forEach((lv) => {
      const S = E.create(v);
      const m = E.cpuMove(S, lv, rnd, 300);
      assert.ok(E.legalMoves(S).some((x) => E.sameMove(x, m)), v + ' ' + lv);
    });
  });
  // 1手詰め（持ち駒の金を３二に打つ）
  const M = pos('mini', ['. . k . .', '. . . . .', '. . P . .', '. . . . .', 'K . . . .'], 0, [{ G: 1 }]);
  ['normal', 'strong'].forEach((lv) => {
    const T = E.apply(M, E.cpuMove(M, lv, rnd, 500));
    assert.deepStrictEqual(T.over, { winner: 0, reason: 'mate' }, lv);
  });
  // ただで取れる飛車（だれも守っていない）を取る
  // （王手と飛車取りの両取りにならないよう、後手の王は１一に置く）
  const F = pos('mini', ['. . . . k', '. . . . .', '. . . . r', '. . . . .', 'K . B . .'], 0);
  ['normal', 'strong'].forEach((lv) => {
    const m = E.cpuMove(F, lv, rnd, 500);
    assert.strictEqual(m.to, at(F, 1, 3), lv);
  });
  // 指せる手がないときは null
  const N = pos('mini', ['. . k . .', '. . G . .', '. . P . .', '. . . . .', 'K . . . .'], 1);
  assert.strictEqual(E.cpuMove(N, 'normal', rnd, 200), null);
});

test('CPU（ふつう・つよい）は1手詰めの形を避ける（2026-11-14 レビューで見つけた局面）', () => {
  const seq = ['５三歩', '２二銀', '１三飛', '３一銀', '４四銀', '１四角', '３三飛', '４一角', '３一飛不成', '１三歩', '３三銀', '３二角', '１五銀', '５二飛', '４二銀', '１二王', '２一飛不成'];
  let G = E.create('mini');
  seq.forEach((t, i) => {
    const want = (i % 2 === 0 ? '▲' : '△') + t;
    const m = E.legalMoves(G).find((x) => E.moveText(G, x) === want);
    assert.ok(m, want);
    G = E.apply(G, m);
  });
  ['normal', 'strong'].forEach((lv) => {
    const T = E.apply(G, E.cpuMove(G, lv, () => 0.5, 1500));
    const mateIn1 = E.legalMoves(T).some((x) => { const U = E.apply(T, x); return U.over && U.over.reason === 'mate'; });
    assert.ok(!mateIn1, lv + ' が選んだ ' + T.last.text + ' のあと、1手で詰む');
  });
});

test('CPU の強さの差（5五将棋の CPU どうし）', () => {
  let seed = 1;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const match = (A, B, games) => {
    let winA = 0;
    for (let g = 0; g < games; g += 1) {
      const side = g % 2 === 0 ? [A, B] : [B, A];
      let S = E.create('mini');
      while (!S.over && S.ply < 160) S = E.apply(S, E.cpuMove(S, side[S.turn], rnd, side[S.turn] === 'strong' ? 400 : undefined));
      if (S.over && S.over.winner >= 0 && side[S.over.winner] === A) winA += 1;
    }
    return winA;
  };
  const nw = match('normal', 'weak', 8);
  assert.ok(nw >= 7, 'ふつうはよわいに8局中7局以上勝つ: ' + nw);
  const sn = match('strong', 'normal', 6);
  assert.ok(sn >= 4, 'つよいはふつうに6局中4局以上勝つ: ' + sn);
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
