// ちゃりんバトンのルールのテスト。node tests/charin-baton/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('../../apps/charin-baton/engine.js');

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', n, name); };

t('枚数は2枚から、2問正解するごとに1枚増え、上限で止まる', () => {
  const got = [0, 1, 2, 3, 4, 5, 6, 7, 20].map((c) => E.coinCountFor(c, 5));
  assert.deepStrictEqual(got, [2, 2, 3, 3, 4, 4, 5, 5, 5]);
  assert.strictEqual(E.coinCountFor(20, 8), 8);
  assert.strictEqual(E.coinCountFor(0, 4), 2);
});

t('硬貨の種類・同じ硬貨3枚まで・合計が合う', () => {
  const rng = E.makeRng(1);
  for (let i = 0; i < 3000; i += 1) {
    const kinds = i % 2 ? 'three' : 'all';
    const count = 2 + (i % 7);
    const p = E.makeProblem(rng, { count, kinds, arrange: i % 3 ? 'scatter' : 'sort', prevKey: null });
    assert.strictEqual(p.coins.length, count);
    const vals = p.coins.map((c) => c.v);
    vals.forEach((v) => assert.ok(E.KINDS[kinds].values.includes(v)));
    const cnt = {};
    vals.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; });
    Object.values(cnt).forEach((c) => assert.ok(c <= E.SAME_MAX));
    assert.strictEqual(p.total, vals.reduce((a, b) => a + b, 0));
  }
});

t('ばらばらでも硬貨は重ならず、トレーからはみ出さない', () => {
  const rng = E.makeRng(7);
  for (let i = 0; i < 2000; i += 1) {
    const count = 2 + (i % 7);
    const p = E.makeProblem(rng, { count, kinds: 'all', arrange: 'scatter', prevKey: null });
    p.coins.forEach((a, ai) => {
      const ra = E.COINS[a.v].d / 2;
      assert.ok(a.x - ra >= 0 && a.x + ra <= E.TRAY.w && a.y - ra >= 0 && a.y + ra <= E.TRAY.h, 'はみ出し');
      p.coins.forEach((b, bi) => {
        if (bi <= ai) return;
        assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= ra + E.COINS[b.v].d / 2, '重なり');
      });
    });
  }
});

t('直前の問題と同じ組み合わせを続けない', () => {
  const rng = E.makeRng(3);
  let prev = null;
  for (let i = 0; i < 2000; i += 1) {
    const p = E.makeProblem(rng, { count: 2, kinds: 'three', arrange: 'scatter', prevKey: prev });
    assert.notStrictEqual(p.key, prev);
    prev = p.key;
  }
});

t('内訳は金額の大きい順', () => {
  const s = E.breakdown([{ v: 10 }, { v: 100 }, { v: 10 }, { v: 1 }]);
  assert.strictEqual(s, '100円玉 1枚・10円玉 2枚・1円玉 1枚');
});

const SET0 = () => ({
  players: [{ name: 'A', time: 45, kinds: 'all' }, { name: 'B', time: 30, kinds: 'three' }],
  maxCoins: 5, arrange: 'scatter', first: 0,
});
// 3・2・1 のあと、時刻0から番の人の時計が動きはじめる状態を作る
const begin = (set, rng) => E.tick(E.createDuel(set, -E.READY_MS, rng), 0, rng);

t('はじまる前の3秒は、時計が止まっていて答えられない', () => {
  const rng = E.makeRng(2);
  let S = E.createDuel(SET0(), 0, rng);
  assert.strictEqual(S.phase, 'ready');
  assert.strictEqual(E.answer(S, 0, S.problem.total, 1000).result, 'ignored');
  assert.strictEqual(E.remaining(S, 0, 2500), 45000);
  S = E.tick(S, 2999, rng);
  assert.strictEqual(S.phase, 'ready');
  S = E.tick(S, 3000, rng);
  assert.strictEqual(S.phase, 'play');
  assert.strictEqual(E.remaining(S, 0, 4000), 44000);
});

const SET = SET0();

t('正解すると1.5秒時計が止まり、相手の番になる', () => {
  const rng = E.makeRng(5);
  let S = begin(SET, rng);
  assert.strictEqual(S.turn, 0);
  assert.strictEqual(S.problem.coins.length, 2);
  const r = E.answer(S, 0, S.problem.total, 4000);
  assert.strictEqual(r.result, 'ok');
  S = r.state;
  assert.strictEqual(S.phase, 'reveal');
  assert.strictEqual(E.remaining(S, 0, 5000), 41000);
  S = E.tick(S, 5000, rng);
  assert.strictEqual(S.phase, 'reveal', 'まだ止まっている');
  S = E.tick(S, 5500, rng);
  assert.strictEqual(S.phase, 'play');
  assert.strictEqual(S.turn, 1);
  assert.strictEqual(E.remaining(S, 1, 6500), 29000);
  assert.strictEqual(E.remaining(S, 0, 6500), 41000);
  // B は「3種類だけ」
  S.problem.coins.forEach((c) => assert.ok([1, 10, 100].includes(c.v)));
});

t('まちがいは何回でも。時計は止まらない', () => {
  const rng = E.makeRng(9);
  const S = begin(SET, rng);
  const r = E.answer(S, 0, S.problem.total + 1, 3000);
  assert.strictEqual(r.result, 'ng');
  assert.strictEqual(E.remaining(r.state, 0, 3000), 42000);
  assert.strictEqual(E.answer(S, 1, S.problem.total, 3000).result, 'ignored', '番でない人は答えられない');
});

t('パスは3秒待ち、その間も自分の時計が減り、同じ人に新しい問題', () => {
  const rng = E.makeRng(11);
  let S = begin(SET, rng);
  const first = S.problem.key;
  S = E.pass(S, 0, 1000);
  assert.strictEqual(S.phase, 'pass');
  assert.strictEqual(E.answer(S, 0, S.problem.total, 2000).result, 'ignored', 'パスの間は答えられない');
  S = E.tick(S, 4000, rng);
  assert.strictEqual(S.phase, 'play');
  assert.strictEqual(S.turn, 0);
  assert.notStrictEqual(S.problem.key, first);
  assert.strictEqual(E.remaining(S, 0, 4000), 41000);
  assert.strictEqual(S.correct[0], 0, 'パスでは枚数が増えない');
});

t('時計が0になった人の負け', () => {
  const rng = E.makeRng(13);
  let S = begin(SET, rng);
  S = E.tick(S, 45000, rng);
  assert.strictEqual(S.phase, 'over');
  assert.strictEqual(S.winner, 1);
  assert.strictEqual(S.history.length, 1, '時間切れの小銭も一覧に入る');
  assert.strictEqual(S.history[0].how, 'timeout');
  assert.strictEqual(E.answer(S, 0, S.problem.total, 45100).result, 'ignored');
});

t('パスの間に時間切れ: パスした小銭を時間切れとして一覧に残す（増やさない）', () => {
  const rng = E.makeRng(31);
  let S = begin(SET, rng);
  S = E.pass(S, 0, 43000);           // 残り2秒でパス
  S = E.tick(S, 45000, rng);
  assert.strictEqual(S.phase, 'over');
  assert.strictEqual(S.history.length, 1);
  assert.strictEqual(S.history[0].how, 'timeout');
  assert.strictEqual(S.history[0].total, S.problem.total);
});

t('正解の数で枚数が増える（ふたりそれぞれ）', () => {
  const rng = E.makeRng(17);
  let S = begin(Object.assign({}, SET, { players: [{ name: 'A', time: 999, kinds: 'all' }, { name: 'B', time: 999, kinds: 'all' }] }), rng);
  let now = 0;
  const counts = [];
  for (let k = 0; k < 12; k += 1) {
    counts.push(S.problem.coins.length);
    S = E.answer(S, S.turn, S.problem.total, now += 100).state;
    S = E.tick(S, now += 1600, rng);
  }
  // A, B, A, B, … の順。それぞれ 2,2,3,3,4,4
  assert.deepStrictEqual(counts, [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]);
  assert.strictEqual(S.history.length, 12);
});

t('状態は JSON にできる', () => {
  const S = E.createDuel(SET, 0, E.makeRng(1));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(S)), S);
});

t('つづきから: 止めた時刻の残りを残して 3・2・1 から。止めていた間は数えない', () => {
  const rng = E.makeRng(21);
  let S = begin(SET, rng);           // 時刻0から A の時計が動く
  const key = S.problem.key;
  S = E.resume(S, 10000, 70000, rng); // 10秒の時点で止まり、70秒に戻った
  assert.strictEqual(S.phase, 'ready');
  assert.strictEqual(S.problem.key, key, '数えていた小銭はそのまま');
  assert.strictEqual(E.remaining(S, 0, 72000), 35000);
  assert.strictEqual(E.due(S, 72999), false);
  assert.strictEqual(E.due(S, 73000), true);
  S = E.tick(S, 73000, rng);
  assert.strictEqual(S.phase, 'play');
  assert.strictEqual(E.remaining(S, 0, 74000), 34000);
});

t('つづきから: 正解の帯の途中なら相手の番から・パスの途中なら新しい小銭から', () => {
  const rng = E.makeRng(22);
  let S = begin(SET, rng);
  S = E.answer(S, 0, S.problem.total, 1000).state;
  const R = E.resume(S, 1500, 9000, rng);
  assert.strictEqual(R.turn, 1);
  assert.strictEqual(R.phase, 'ready');
  let P = E.pass(begin(SET, rng), 0, 2000);
  const pk = P.problem.key;
  P = E.resume(P, 3000, 9000, rng);
  assert.strictEqual(P.turn, 0);
  assert.notStrictEqual(P.problem.key, pk);
  assert.strictEqual(E.remaining(P, 0, 9000), 42000);
});

t('つづきから: 止めた時点で時間が残っていなければ負け', () => {
  const rng = E.makeRng(23);
  const S = E.resume(begin(SET, rng), 50000, 60000, rng);
  assert.strictEqual(S.phase, 'over');
  assert.strictEqual(S.winner, 1);
});

t('due は時間で進めるときだけ true', () => {
  const rng = E.makeRng(24);
  const S = begin(SET, rng);
  assert.strictEqual(E.due(S, 44999), false);
  assert.strictEqual(E.due(S, 45000), true);
  const R = E.answer(S, 0, S.problem.total, 1000).state;
  assert.strictEqual(E.due(R, 2499), false);
  assert.strictEqual(E.due(R, 2500), true);
});

console.log('all ' + n + ' passed');
