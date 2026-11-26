// とりせつ解除班 のルールのテスト（node tests/torisetsu-kaijo/engine.test.cjs）。本番には接続しない
const assert = require('assert');
const E = require('../../apps/torisetsu-kaijo/engine.js');

const round = (G) => E.fromRoom(JSON.parse(JSON.stringify(E.toRoom(G))));

// 正解の操作をならべる（しかけ1つぶん）
function solveActions(bomb, slot, G) {
  const mod = bomb.slots[slot];
  const st = G.m[E.keyOf(slot)] || {};
  if (mod.type === 'cord') return [{ s: slot, k: 'cut', v: mod.sol }];
  if (mod.type === 'glyph') {
    const bits = st.b || 0;
    const out = [];
    mod.sol.forEach((up, i) => { if (!!(bits & (1 << i)) !== up) out.push({ s: slot, k: 'tog', v: i }); });
    return out.concat([{ s: slot, k: 'chk' }]);
  }
  if (mod.type === 'dial') {
    let pos = st.p || mod.start;
    const out = [];
    while (pos !== mod.sol) { out.push({ s: slot, k: 'turn', v: 1 }); pos = (pos % 8) + 1; }
    return out.concat([{ s: slot, k: 'chk' }]);
  }
  return mod.sol.split('').slice(st.p || 0).map((d) => ({ s: slot, k: 'dir', v: d }));
}

let bombs = 0;
const seenTypes = new Set();
for (const level of E.LEVEL_KEYS) {
  for (let seed = 1; seed <= 400; seed++) {
    const bomb = E.makeBomb(seed * 7919, level, false);
    bombs++;
    const L = E.LEVELS[level];
    const reg = E.regularSlots(bomb);
    assert.strictEqual(reg.length, L.mods, 'しかけの数');
    assert.strictEqual(!!bomb.fuse, L.fuse, '導火線');
    assert.strictEqual(bomb.slots.filter(Boolean).length, L.mods + (L.fuse ? 1 : 0));
    // 同じ番号なら同じ爆弾
    assert.deepStrictEqual(E.makeBomb(seed * 7919, level, false), bomb);
    // 手がかり
    assert.ok(E.FOUR.includes(bomb.clues.seal) && /^\d{4}$/.test(bomb.clues.serial) && bomb.clues.screws >= 2 && bomb.clues.screws <= 5 && E.MARKS.includes(bomb.clues.mark));
    assert.strictEqual(bomb.clues.even, Number(bomb.clues.serial[3]) % 2 === 0);
    reg.forEach((i) => {
      const m = bomb.slots[i];
      seenTypes.add(m.type);
      if (m.type === 'cord') {
        assert.strictEqual(new Set(m.colors).size, 5);
        assert.deepStrictEqual(m.dest.slice().sort(), [0, 1, 2, 3, 4]);
        // 説明書どおり: 表の行き先のコードか、それが黒なら①（①が黒なら⑤）
        const letter = E.CORD_TABLE[bomb.clues.seal][bomb.clues.even ? 0 : 1];
        const t = m.dest.indexOf(letter);
        assert.strictEqual(m.sol, m.colors[t] !== 'k' ? t : m.colors[0] === 'k' ? 4 : 0);
        assert.notStrictEqual(m.colors[m.sol], 'k', '黒いコードが正解になっている');
      }
      if (m.type === 'glyph') {
        assert.strictEqual(new Set(m.glyphs).size, 4);
        assert.ok(m.sol.some(Boolean), 'なにもしないで合ってしまう');
      }
      if (m.type === 'dial') { assert.ok(m.sol >= 1 && m.sol <= 8 && m.start >= 1 && m.start <= 8); assert.notStrictEqual(m.start, m.sol); }
      if (m.type === 'arrow') assert.ok(/^[UDLR]{4}$/.test(m.sol));
    });

    // 正しく操作すれば、まちがい0で解除できる（ルームに置いて読みなおしても同じ）
    let G = E.newState(level, false, 1000);
    let now = 1000;
    reg.forEach((slot) => {
      solveActions(bomb, slot, G).forEach((a) => {
        now += 100;
        const res = E.act(bomb, G, a, now);
        assert.ok(res, 'できない操作: ' + JSON.stringify(a));
        assert.notStrictEqual(res.ev, 'strike');
        G = round(res.G);
        assert.deepStrictEqual(G, round(res.G));
      });
      assert.ok(G.ok[E.keyOf(slot)]);
    });
    assert.strictEqual(G.out, 'safe');
    assert.strictEqual(G.x, 0);
    assert.strictEqual(E.act(bomb, G, { s: reg[0], k: 'chk' }, now + 1), null, 'おわったあとは操作できない');
    assert.strictEqual(E.tick(bomb, G, now + 999999), null);
  }
}
assert.strictEqual(seenTypes.size, 4);

// まちがい3回で爆発・まちがえるたびに速くなる
{
  const bomb = E.makeBomb(42, 'easy', false);
  const slot = E.regularSlots(bomb).find((i) => bomb.slots[i].type !== 'cord') ?? -1;
  const cord = E.regularSlots(bomb).find((i) => bomb.slots[i].type === 'cord');
  let G = E.newState('easy', false, 0);
  assert.strictEqual(E.leftMs(G, 10000), 290000);
  const wrong = (g, now) => {
    if (cord != null) {
      const cut = (g.m[E.keyOf(cord)]?.c || '').split(',').filter(Boolean).map(Number);
      const v = [0, 1, 2, 3, 4].find((i) => i !== bomb.slots[cord].sol && !cut.includes(i));
      return E.act(bomb, g, { s: cord, k: 'cut', v }, now);
    }
    const m = bomb.slots[slot];
    if (m.type === 'arrow') return E.act(bomb, g, { s: slot, k: 'dir', v: 'UDLR'.split('').find((d) => d !== m.sol[0]) }, now);
    return E.act(bomb, g, { s: slot, k: 'chk' }, now);
  };
  let r = wrong(G, 10000);
  assert.strictEqual(r.ev, 'strike');
  G = r.G;
  assert.strictEqual(G.x, 1);
  assert.strictEqual(G.t.rate, 1.25);
  assert.strictEqual(E.leftMs(G, 10000), 290000);
  assert.strictEqual(E.leftMs(G, 14000), 285000, '1.25倍でへる');
  r = wrong(G, 14000); G = r.G;
  assert.strictEqual(G.t.rate, 1.5);
  assert.strictEqual(G.out, null);
  r = wrong(G, 16000); G = r.G;
  assert.strictEqual(G.x, 3);
  assert.strictEqual(G.out, 'boom');
  assert.strictEqual(G.why, 'strike');
  assert.strictEqual(E.leftMs(G, 999999), 282000, 'おわったら時間は止まる');
}

// 時間が0で爆発。時間をはからないときは、時間で爆発しない・導火線もない
{
  const bomb = E.makeBomb(7, 'easy', false);
  const G = E.newState('easy', false, 0);
  assert.strictEqual(E.tick(bomb, G, 299999), null);
  const r = E.tick(bomb, G, 300000);
  assert.strictEqual(r.G.out, 'boom');
  assert.strictEqual(r.G.why, 'time');
  const slowBomb = E.makeBomb(7, 'hard', true);
  assert.strictEqual(slowBomb.fuse, null);
  const S = E.newState('hard', true, 0);
  assert.strictEqual(S.t, null);
  assert.strictEqual(E.leftMs(S, 5), null);
  assert.strictEqual(E.tick(slowBomb, S, 99999999), null);
  assert.strictEqual(round(S).t, null);
}

// 導火線: 30秒で火がつく・20秒のうちに正しいつまみ・まにあわないとまちがい1回・45秒ごと
{
  const bomb = E.makeBomb(99, 'normal', false);
  const slot = bomb.fuse.slot;
  let G = E.newState('normal', false, 0);
  assert.strictEqual(E.fuseInfo(bomb, G, 29999), null);
  assert.strictEqual(E.act(bomb, G, { s: slot, k: 'knob', v: 0 }, 29999), null, '火がついていないときは押せない');
  const f = E.fuseInfo(bomb, G, 30000);
  assert.strictEqual(f.k, 0);
  assert.strictEqual(f.left, 20000);
  const right = E.FUSE_TABLE[f.flame][bomb.clues.mark];
  const bad = E.act(bomb, G, { s: slot, k: 'knob', v: (right + 1) % 3 }, 31000);
  assert.strictEqual(bad.ev, 'strike');
  assert.ok(E.fuseInfo(bomb, bad.G, 32000), 'まちがえても火はついたまま');
  const good = E.act(bomb, G, { s: slot, k: 'knob', v: right }, 31000);
  assert.strictEqual(good.ev, 'fuse-ok');
  assert.strictEqual(E.fuseInfo(bomb, good.G, 32000), null);
  assert.strictEqual(E.tick(bomb, good.G, 60000), null, '止めたあとは、まにあわなかった扱いにならない');
  assert.strictEqual(E.fuseInfo(bomb, good.G, 75000).k, 1, '45秒あとにまた火がつく');
  // まにあわない
  assert.strictEqual(E.tick(bomb, G, 49999), null);
  const miss = E.tick(bomb, G, 50000);
  assert.strictEqual(miss.ev, 'fuse-miss');
  assert.strictEqual(miss.G.x, 1);
  assert.strictEqual(miss.G.fz, 1);
  assert.strictEqual(E.tick(bomb, miss.G, 60000), null, '同じ回を2度数えない');
  // 何回ぶんも過ぎていても、数えるのは1回
  const late = E.tick(bomb, G, 30000 + 45000 * 3 + 21000);
  assert.strictEqual(late.G.x, 1);
  assert.strictEqual(late.G.fz, 4);
}

// 説明書: 表と文がそろっている
{
  E.MANUAL_IDS.forEach((id) => {
    const man = E.manual(id);
    assert.strictEqual(man.id, id);
    assert.ok(man.title && man.lines.length >= 4);
    man.lines.forEach((line, n) => { assert.ok(E.lineText(id, n)); assert.ok(['p', 'row', 'note'].includes(line.t)); });
  });
  assert.strictEqual(E.manual('cord').lines.filter((l) => l.t === 'row').length, 8);
  assert.strictEqual(E.manual('glyph').lines.filter((l) => l.t === 'row').length, E.GLYPHS);
  assert.strictEqual(E.manual('dial').lines.filter((l) => l.t === 'row').length, 12);
  assert.strictEqual(E.manual('arrow').lines.filter((l) => l.t === 'row').length, 8);
  assert.strictEqual(E.manual('fuse').lines.filter((l) => l.t === 'row').length, 12);
  assert.strictEqual(E.lineText('nope', 0), '');
  assert.strictEqual(E.lineText('cord', 999), '');
  // 記号の決まりは、どの2つも同じ文でない・手がかりの組によって答えが分かれる
  assert.strictEqual(new Set(E.GLYPH_RULES.map((r) => r.text)).size, E.GLYPHS);
  const combos = [];
  E.FOUR.forEach((seal) => [true, false].forEach((even) => [2, 3, 4, 5].forEach((screws) => E.MARKS.forEach((mark) => combos.push({ seal, even, screws, mark })))));
  const sig = new Set(E.GLYPH_RULES.map((r) => combos.map((c) => (r.up(c) ? 1 : 0)).join('')));
  assert.strictEqual(sig.size, E.GLYPHS, '同じはたらきの記号がある');
  // やじるしの16通りは、どれもちがう順
  const seqs = new Set();
  E.SHAPES.forEach((s) => E.FOUR.forEach((c) => seqs.add(E.arrowSeq(s, c))));
  assert.strictEqual(seqs.size, 16, 'やじるしの順が重なっている');
}

// 役と説明書の配り方
{
  assert.strictEqual(E.pickDefuser([false, false, false], 0), 0);
  assert.strictEqual(E.pickDefuser([false, false, false], 4), 1);
  assert.strictEqual(E.pickDefuser([true, false, true], 5), 1);
  assert.strictEqual(E.pickDefuser([false, true, false], 1), 2);
  assert.strictEqual(E.pickDefuser([true, true], 0), -1);
  for (let seed = 1; seed <= 200; seed++) {
    const bomb = E.makeBomb(seed, 'hard', false);
    const ch = E.bombChapters(bomb);
    for (let n = 1; n <= 5; n++) {
      const readers = Array.from({ length: n }, (_, i) => i + 1);
      const all = E.deal(seed, bomb, readers, false);
      readers.forEach((i) => assert.deepStrictEqual(all[i], ch));
      const parts = E.deal(seed, bomb, readers, true);
      const got = new Set();
      readers.forEach((i) => { assert.ok(parts[i].length >= 1, 'ページのない人がいる'); parts[i].forEach((c) => got.add(c)); });
      assert.strictEqual(got.size, ch.length, '配られていないページがある');
      if (n >= 2 && n <= ch.length) assert.strictEqual(readers.reduce((s, i) => s + parts[i].length, 0), ch.length, '同じページが2人に行っている');
    }
  }
}

// こわれた値
assert.strictEqual(E.fromRoom(null), null);
assert.strictEqual(E.fromRoom({}), null);
assert.strictEqual(E.fromRoom({ startAt: 1, t: { left: 'x', at: 1, rate: 1 } }), null);
assert.deepStrictEqual(E.fromRoom({ startAt: 1, x: 9, m: { s0: { c: 'zz', p: 3 }, s9: { p: 1 } }, ok: { s1: true, s2: 'yes' } }),
  { startAt: 1, t: null, x: 0, ok: { s1: true }, m: { s0: { p: 3 } }, fz: 0, out: null, why: null, endAt: null });

console.log('engine.test: ok（爆弾 ' + bombs + ' こ）');
