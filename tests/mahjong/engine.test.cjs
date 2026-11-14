// 麻雀のルールのテスト。node tests/mahjong/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('../../apps/mahjong/engine.js');

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', n, name); };

// "123m456p789s11z" のような書き方から、種類ごとの枚数にする
function parse(str) {
  const c = new Array(34).fill(0);
  const base = { m: 0, p: 9, s: 18, z: 27 };
  for (const [, nums, suit] of str.matchAll(/(\d+)([mpsz])/g)) {
    for (const d of nums) c[base[suit] + Number(d) - 1] += 1;
  }
  return c;
}
const opts = { chiitoi: true };

t('あがりの形', () => {
  assert.strictEqual(E.shanten(parse('123m456p789s11122z'), 0, opts), -1);
  assert.strictEqual(E.shanten(parse('111222333m44455p'), 0, opts), -1);
  assert.strictEqual(E.shanten(parse('11223344556677m'), 0, opts), -1);
});

t('七対子は設定で切れる', () => {
  const c = parse('1122m3344p5566s77z');
  assert.strictEqual(E.shanten(c, 0, { chiitoi: true }), -1);
  assert.notStrictEqual(E.shanten(c, 0, { chiitoi: false }), -1);
  assert.strictEqual(E.decompose(c, 0, { chiitoi: true }).form, 'pairs');
});

t('テンパイと待ち', () => {
  const c = parse('123m456p789s1122z');
  assert.strictEqual(E.shanten(c, 0, opts), 0);
  assert.deepStrictEqual(E.waits(c, 0, opts).map(E.kindName), ['東', '南']);
  assert.deepStrictEqual(E.waits(parse('123m456p789s1112z'), 0, opts).map(E.kindName), ['南']);
  assert.strictEqual(E.waits(parse('1112345678999m'), 0, opts).length, 9);
});

t('あと何枚（いろいろな形）', () => {
  assert.strictEqual(E.shanten(parse('19m19p19s1234567z'), 0, { chiitoi: false }), 8);
  assert.strictEqual(E.shanten(parse('123m456p78s11z257m'), 0, opts), 1);
});

t('鳴いた手のあがり', () => {
  assert.strictEqual(E.shanten(parse('123m456p77z'), 2, opts), -1);
  assert.strictEqual(E.shanten(parse('7z'), 4, opts), 0);
  assert.strictEqual(E.shanten(parse('77z'), 4, opts), -1);
});

t('組に分ける', () => {
  const d = E.decompose(parse('123m456p789s11122z'), 0, opts);
  assert.strictEqual(d.form, 'regular');
  assert.strictEqual(d.groups.length, 5);
  assert.strictEqual(d.groups[0].type, 'pair');
});

const seats = [0, 1, 2, 3].map((i) => ({ name: 'P' + i, cpu: true }));

function playOut(seed, o = {}) {
  let S = E.createRound({ seed, seats, dealer: seed % 4, ...o });
  let steps = 0;
  while (S.phase !== 'end') {
    const who = E.waitingFor(S)[0];
    S = E.act(S, who, E.cpuAction(S, who));
    // 牌の数はいつも 136
    const all = S.wall.length + S.seats.reduce((a, s) => a + s.hand.length
      + s.river.filter((r) => !r.called).length
      + s.melds.reduce((b, m) => b + m.tiles.length, 0), 0);
    assert.strictEqual(all, 136);
    steps += 1;
    assert.ok(steps < 2000);
  }
  return S;
}

t('はじめの配り方', () => {
  const S = E.createRound({ seed: 7, seats, dealer: 2 });
  assert.strictEqual(S.seats[2].hand.length, 14);
  assert.strictEqual(S.seats[0].hand.length, 13);
  assert.strictEqual(S.wall.length, 136 - 53);
  assert.strictEqual(S.turn, 2);
});

for (const level of ['easy', 'normal']) t('コンピューター4人で最後まで（' + level + '・150局）', () => {
  const tally = { tsumo: 0, ron: 0, draw: 0, calls: 0 };
  const t0 = Date.now();
  for (let seed = 1; seed <= 150; seed += 1) {
    const S = playOut(seed, { level });
    tally[S.result.type] += 1;
    tally.calls += S.log.filter((l) => l.t === 'pon' || l.t === 'chi').length;
    if (S.result.type !== 'draw') {
      assert.ok(S.result.shape, 'あがりの形が分けられる');
      const w = S.seats[S.result.winner];
      const size = S.result.shape.groups.reduce((a, g) => a + g.kinds.length, 0) + w.melds.length * 3;
      assert.strictEqual(size, 14);
    }
  }
  console.log('   ', tally, (Date.now() - t0) + 'ms');
  assert.ok(tally.tsumo + tally.ron > 75);
  if (level === 'easy') assert.strictEqual(tally.calls, 0);
});

t('鳴きなしの設定ではポン・チーしない', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const S = playOut(seed, { calls: false });
    assert.ok(!S.log.some((l) => l.t === 'pon' || l.t === 'chi'));
  }
});

t('できない操作ははじく', () => {
  const S = E.createRound({ seed: 3, seats, dealer: 0 });
  assert.throws(() => E.act(S, 1, { type: 'discard', id: S.seats[1].hand[0] }));
  assert.throws(() => E.act(S, 0, { type: 'discard', id: S.seats[1].hand[0] }));
  assert.throws(() => E.act(S, 0, { type: 'pon', tiles: [0, 1] }));
});

// 手を作りかえて、捨てたあとの答えの決まり方を確かめる
const id = (k, copy) => k * 4 + copy;
const ids = (list, copy) => list.map((k) => id(k, copy));
const FILL0 = [...ids([21, 22, 23, 24, 25, 26], 0), ...ids([21, 22, 23, 24, 25, 26], 1), id(33, 0)];
const FILL1 = [...ids([21, 22, 23, 24, 25, 26], 2), id(33, 1), id(33, 2), id(33, 3), id(32, 0), id(32, 1)];

t('ロンはポンより先', () => {
  let S = E.createRound({ seed: 11, seats, dealer: 0 });
  S.seats[0].hand = [id(27, 0), ...FILL0];
  S.seats[1].hand = [id(27, 1), id(27, 2), ...FILL1];
  S.seats[2].hand = ids([3, 4, 5, 12, 13, 14, 29, 29], 3).slice(0, 6).concat([id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(31, 0), id(31, 1)]);
  S.seats[3].hand = [...ids([0, 1, 2, 9, 10, 11, 18, 19, 20], 0), id(28, 0), id(28, 1), id(28, 2), id(27, 3)];
  S.drawn = id(27, 0);
  S = E.act(S, 0, { type: 'discard', id: id(27, 0) });
  assert.strictEqual(S.phase, 'claim');
  assert.ok(S.pending[1].options.pon.length);
  assert.ok(S.pending[3].options.ron);
  S = E.act(S, 1, { type: 'pon', tiles: S.pending[1].options.pon[0] });
  assert.strictEqual(S.phase, 'claim');
  S = E.act(S, 3, { type: 'ron' });
  assert.strictEqual(S.result.type, 'ron');
  assert.strictEqual(S.result.winner, 3);
});

t('2人がロンしたら、捨てた人の次に近い人', () => {
  let S = E.createRound({ seed: 12, seats, dealer: 0 });
  S.seats[0].hand = [id(4, 0), ...FILL0];
  S.seats[1].hand = [...FILL1, id(30, 2), id(30, 3)];
  S.seats[2].hand = [id(3, 0), id(5, 0), ...ids([9, 10, 11, 18, 19, 20], 0), id(28, 0), id(28, 1), id(28, 2), id(30, 0), id(30, 1)];
  S.seats[3].hand = [id(3, 1), id(5, 1), ...ids([9, 10, 11, 18, 19, 20], 1), id(29, 0), id(29, 1), id(29, 2), id(31, 0), id(31, 1)];
  S.drawn = id(4, 0);
  S = E.act(S, 0, { type: 'discard', id: id(4, 0) });
  assert.ok(!S.pending[1]);
  S = E.act(S, 3, { type: 'ron' });
  assert.strictEqual(S.phase, 'claim');
  S = E.act(S, 2, { type: 'ron' });
  assert.strictEqual(S.result.winner, 2);
});

t('ポンしたら、その人が引かずに捨てる番', () => {
  let S = E.createRound({ seed: 13, seats, dealer: 0 });
  S.seats[0].hand = [id(27, 0), ...FILL0];
  S.seats[2].hand = [id(27, 1), id(27, 2), ...FILL1];
  S.seats[1].hand = ids([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 3);
  S.seats[3].hand = ids([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 2);
  S.drawn = id(27, 0);
  S = E.act(S, 0, { type: 'discard', id: id(27, 0) });
  S = E.act(S, 2, { type: 'pon', tiles: [id(27, 1), id(27, 2)] });
  assert.strictEqual(S.turn, 2);
  assert.strictEqual(S.phase, 'discard');
  assert.strictEqual(S.drawn, null);
  assert.strictEqual(S.seats[2].melds.length, 1);
  assert.strictEqual(S.seats[0].river[0].called, true);
  assert.strictEqual(E.canTsumo(S, 2), false);
});

console.log('all', n, 'tests passed');
