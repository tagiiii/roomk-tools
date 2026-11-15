// あれください商店 のルールのテスト（node tests/arekudasai-shoten/engine.test.cjs）。本番には接続しない
const assert = require('assert');
const E = require('../../apps/arekudasai-shoten/engine.js');

// 品物: 60種類・3つの組が重ならない・タグはすべて決まった言葉
assert.strictEqual(E.ITEMS.length, 60);
const keys = new Set(E.ITEMS.map((it) => it.tags.slice().sort().join('|')));
assert.strictEqual(keys.size, 60, '3つの組が同じ品物がある');
assert.strictEqual(new Set(E.ITEMS.map((it) => it.id)).size, 60, 'id が重なっている');
E.ITEMS.forEach((it) => { assert.strictEqual(it.tags.length, 3); it.tags.forEach((t) => assert.ok(E.isTag(t), it.id + ' のタグ ' + t)); });

// コンピューターのお店（テスト用）: ぜんぶ合えば出す、半分なら半分の確率で出す
function shopOffer(s, p, hints, rng) {
  let best = null, bestScore = 0;
  s.players[p].hand.forEach((id) => { const sc = E.matchScore(id, hints); if (sc > bestScore) { best = id; bestScore = sc; } });
  if (!best) return null;
  if (bestScore === hints.length || rng() < 0.5) return { from: p, item: best };
  return null;
}

let rnd = 12345;
const rng = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
for (let n = E.MIN_PLAYERS; n <= E.MAX_PLAYERS; n++) {
  for (let g = 0; g < 60; g++) {
    const away = g % 5 === 0 ? { [n - 1]: true } : null;   // ときどき、1人がいない
    let s = E.newGame(n, rng);
    let turns = 0;
    while (!s.over && turns++ < 500) {
      // ルームに置いて読みなおしても同じ
      s = E.fromRoom(JSON.parse(JSON.stringify(E.toRoom(s))), n);
      const c = s.turn;
      const want = s.players[c].order;
      assert.ok(want, '番の人に注文がない');
      assert.notStrictEqual(E.holderOf(s, want), c, '自分のお店の品物を注文している');
      const tags = E.item(want).tags.slice().sort(() => rng() - 0.5).slice(0, E.HINTS);
      const offers = [];
      for (let p = 0; p < n; p++) if (p !== c && !(away && away[p])) { const o = shopOffer(s, p, tags, rng); if (o) offers.push(o); }
      const chosen = offers.length ? Math.floor(rng() * offers.length) : -1;
      const before = s.players.reduce((a, p) => a + p.points, 0);
      const res = E.resolve(s, offers, chosen, tags, { [(c + 1) % n]: 1 }, rng, away);
      const after = s.players.reduce((a, p) => a + p.points, 0);
      if (res.none) assert.strictEqual(after, before);
      else assert.strictEqual(after - before, res.pt * 2 + res.fit.length * E.PT_FIT);
      // 品物は増えも減りもせず、だれかのお店・山・渡した物のどれか
      const inPlay = s.players.reduce((a, p) => a + p.hand.length, 0) + s.deck.length;
      assert.ok(inPlay <= 60);
      const all = s.players.flatMap((p) => p.hand).concat(s.deck);
      assert.strictEqual(new Set(all).size, all.length, '品物が重なった');
    }
    assert.ok(s.over, n + '人で終わらない');
    const t = E.titles(s);
    assert.strictEqual(new Set(t.map((x) => x.name)).size, n, n + '人で称号が重なった');
  }
}
// こわれた値でも読める
const bad = E.fromRoom({ h: ['nai,kotatsu', 5], o: ['x'], pt: ['a'], st: [null], turn: 99 }, 3);
assert.deepStrictEqual(bad.players[0].hand, ['kotatsu']);
assert.strictEqual(bad.turn, 0);
assert.strictEqual(E.fromRoom({}, 1), null);
console.log('ok');
