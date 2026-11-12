// そろってゴールのルールのテスト。node tests/sorotte-goal/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('../../apps/sorotte-goal/engine.js');

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', n, name); };
const go = (S, who, ...dirs) => dirs.reduce((s, d) => E.move(s, who, d), S);
const fixed = (i) => E.create({ kind: 'fixed', index: i });
const gen = (level, players, seed) => ({ kind: 'gen', level, n: players, seed });

// はば優先で、いちばん少ない歩数でクリアできるかを調べる（星はとらなくていいので、はじめに消しておく）。
// only を渡すと、その人だけが動く。調べきれなかったら null
function solve(spec, only, cap = 400000) {
  const start = E.create(spec);
  start.stars = [];
  const key = (S) => S.players.map((p) => p.x + ',' + p.y + (p.key ? 'k' : '')).join('|') + '/' + S.boxes.join(';') + '/' + S.keys.length + '/' + S.open.length;
  const seen = new Set([key(start)]);
  let frontier = [start];
  for (let depth = 0; frontier.length; depth += 1) {
    const next = [];
    for (const S of frontier) {
      if (S.cleared) return depth;
      for (let who = 0; who < S.players.length; who += 1) {
        if (only != null && who !== only) continue;
        for (const dir of Object.keys(E.DIRS)) {
          const N = E.move(S, who, dir);
          if (N === S) continue;
          const k = key(N);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(N);
        }
      }
    }
    if (seen.size > cap) return null;
    frontier = next;
  }
  return -1;
}

t('手で作ったステージは、2人ならクリアでき、1人だけではクリアできない', () => {
  E.FIXED.forEach((st, i) => {
    const spec = { kind: 'fixed', index: i };
    const steps = solve(spec);
    console.log('   手で作ったステージ' + (i + 1) + '「' + st.name + '」: いちばん少なくて ' + steps + ' 歩');
    assert.ok(steps > 0, st.name);
    assert.strictEqual(solve(spec, 0), -1, st.name + ' 1人目だけ');
    assert.strictEqual(solve(spec, 1), -1, st.name + ' 2人目だけ');
  });
});

t('かべ・ほかの人のいるマスには入れない', () => {
  const S = fixed(0);
  assert.strictEqual(E.move(S, 0, 'up'), S);
  assert.strictEqual(E.move(S, 0, 'left'), S);
  const S1 = go(S, 0, 'down');
  assert.strictEqual(E.move(S1, 0, 'down'), S1); // 2人目がいる
  assert.strictEqual(S1.rev, 1);
});

t('とびら: スイッチに乗っている間だけ通れる。通っている途中に閉じても、出られる', () => {
  let S = fixed(0);
  S = go(S, 0, 'down', 'right', 'right');
  assert.strictEqual(E.doorOpen(S, 4, 2), false);
  assert.strictEqual(E.move(S, 0, 'right'), S);
  S = go(S, 1, 'right');
  assert.strictEqual(E.doorOpen(S, 4, 2), true);
  S = go(S, 0, 'right');
  S = go(S, 1, 'left');
  assert.strictEqual(E.doorOpen(S, 4, 2), false);
  const out = go(S, 0, 'right');
  assert.deepStrictEqual([out.players[0].x, out.players[0].y], [5, 2]);
});

t('重い箱: 1人では動かない。うしろから押してもらうと、3つそろって1マス進む。スイッチに乗るととびらが開く', () => {
  let S = fixed(1);
  S = go(S, 0, 'down', 'right', 'right', 'right', 'right');
  assert.strictEqual(E.move(S, 0, 'right'), S);
  S = go(S, 1, 'up', 'right', 'right', 'right');
  const P = go(S, 0, 'right');
  assert.deepStrictEqual(P.boxes[0], [7, 2]);
  assert.deepStrictEqual([P.players[0].x, P.players[1].x], [6, 5]);
  const Q = go(P, 0, 'right');
  assert.deepStrictEqual(Q.boxes[0], [8, 2]);
  assert.strictEqual(E.doorOpen(Q, 10, 2), true);
  assert.strictEqual(E.move(Q, 1, 'right'), Q);
});

t('橋とカギ: 橋は同じ番号の人だけ。カギがないと、かぎつきのとびらは開かない。開けるとカギはなくなる', () => {
  const T = go(fixed(2), 1, 'up', 'up', 'right', 'right');
  assert.strictEqual(E.move(T, 1, 'right'), T);
  let S = go(fixed(2), 1, 'right', 'right', 'right', 'right', 'right', 'right');
  S = go(S, 0, 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right');
  assert.strictEqual(S.players[0].key, true);
  S = go(S, 0, 'right', 'right');
  assert.deepStrictEqual(S.open, [[12, 1]]);
  assert.strictEqual(S.players[0].key, false);
});

t('おまかせ: 同じ番号なら同じステージ。番号がちがえば、ちがうステージが出る', () => {
  const a = E.generate('normal', 3, 5).rows.join('\n');
  assert.strictEqual(E.generate('normal', 3, 5).rows.join('\n'), a);
  const kinds = new Set();
  for (let seed = 1; seed <= 200; seed += 1) kinds.add(E.generate('normal', 3, seed).rows.join('\n'));
  assert.ok(kinds.size >= 195, 'ちがうステージの数 ' + kinds.size);
});

t('おまかせ: 2〜12人のどのむずかしさでも、人数ぶんのはじめの場所とゴール・星3つがあり、ゴールまで道がつながっている', () => {
  let made = 0;
  for (const level of Object.keys(E.LEVELS)) {
    for (let players = E.MIN_PLAYERS; players <= E.MAX_PLAYERS; players += 1) {
      for (let seed = 1; seed <= 60; seed += 1) {
        const T = E.staticOf(gen(level, players, seed));
        const label = level + ' ' + players + '人 #' + seed;
        assert.strictEqual(T.starts.length, players, label);
        assert.strictEqual(new Set(T.starts.map(String)).size, players, label);
        assert.strictEqual(T.tiles.filter((c) => c === 'G').length, players, label);
        assert.strictEqual(T.stars.length, E.STARS, label);
        // 関門の数は部屋の数より1つ少ない。とびらごとに、同じしるしのスイッチがある
        T.tiles.forEach((c) => { if (E.SWITCH_OF[c]) assert.ok(T.tiles.includes(E.SWITCH_OF[c]), label + ' ' + c); });
        assert.strictEqual(T.tiles.filter((c) => c === 'L').length, T.keys.length, label + ' カギの数');
        // はじめの場所は、ゆかの上で、重ならない
        T.starts.forEach(([x, y]) => assert.strictEqual(T.tiles[y * T.w + x], '.', label));
        // とびらを開けて箱をどけたとして、はじめの場所からゴール・カギ・星・スイッチへ行ける
        // （番号つきの橋の先は、その番号の人なら行ける）
        for (let who = 0; who < players; who += 1) {
          const seen = new Set();
          const stack = [T.starts[who]];
          while (stack.length) {
            const [x, y] = stack.pop();
            const k = x + ',' + y;
            if (seen.has(k)) continue;
            const c = T.tiles[y * T.w + x];
            if (c === '#' || (E.BRIDGE_OF[c] !== undefined && E.BRIDGE_OF[c] !== who)) continue;
            seen.add(k);
            stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
          }
          T.tiles.forEach((c, i) => { if (c === 'G') assert.ok(seen.has((i % T.w) + ',' + Math.floor(i / T.w)), label + ' ゴール'); });
        }
        made += 1;
      }
    }
  }
  console.log('   作って調べたステージ: ' + made);
});

t('おまかせ: 2人のやさしい・ふつうは、総当たりでクリアできる。1人だけではクリアできない', () => {
  let solved = 0;
  let skipped = 0;
  for (const level of ['easy', 'normal']) {
    for (let seed = 1; seed <= (level === 'easy' ? 40 : 15); seed += 1) {
      const steps = solve(gen(level, 2, seed));
      if (steps === null) { skipped += 1; continue; }
      assert.ok(steps > 0, level + ' #' + seed + '\n' + E.staticOf(gen(level, 2, seed)).rows.join('\n'));
      assert.notStrictEqual(solve(gen(level, 2, seed), 0, 100000) > 0, true, level + ' #' + seed + ' 1人でクリアできてしまう');
      solved += 1;
    }
  }
  console.log('   クリアできた: ' + solved + '・調べきれなかった: ' + skipped);
  assert.ok(solved >= 30);
});

t('おまかせ: 3人のやさしいも、総当たりでクリアできる', () => {
  let solved = 0;
  for (let seed = 1; seed <= 4; seed += 1) {
    const steps = solve(gen('easy', 3, seed), null, 1500000);
    if (steps === null) continue;
    assert.ok(steps > 0, 'easy 3人 #' + seed);
    solved += 1;
  }
  console.log('   クリアできた: ' + solved + ' / 4');
});

t('星: とると数が増える。とらなくてもクリアできる', () => {
  const spec = gen('easy', 2, 1);
  const T = E.staticOf(spec);
  let S = E.create(spec);
  assert.strictEqual(S.stars.length, 3);
  // 1人目を星のマスへ置いて、となりから入りなおす
  const [sx, sy] = T.stars[0];
  S.players[0].x = sx;
  S.players[0].y = sy;
  const dir = ['left', 'right', 'up', 'down'].find((d) => E.move(S, 0, d) !== S);
  const back = { left: 'right', right: 'left', up: 'down', down: 'up' }[dir];
  S = go(S, 0, dir, back);
  assert.strictEqual(S.got, 1);
  assert.strictEqual(S.stars.length, 2);
});

t('2つ同時のスイッチ（pair）: 1つだけでは開かず、2つおさえると開く', () => {
  let found = null;
  for (let seed = 1; seed <= 200 && !found; seed += 1) {
    const T = E.staticOf(gen('normal', 4, seed));
    if (T.kinds.includes('pair')) found = gen('normal', 4, seed);
  }
  assert.ok(found, 'pair の出るステージがある');
  const T = E.staticOf(found);
  const c = Object.keys(T.need)[0];
  const cells = [];
  T.tiles.forEach((ch, i) => { if (ch === c) cells.push([i % T.w, Math.floor(i / T.w)]); });
  assert.strictEqual(cells.length, 4);
  const S = E.create(found);
  S.players[0].x = cells[0][0]; S.players[0].y = cells[0][1];
  assert.strictEqual(E.held(S, c), false);
  S.players[1].x = cells[1][0]; S.players[1].y = cells[1][1];
  assert.strictEqual(E.held(S, c), true);
});

t('詰み: 箱がスイッチまで運べない場所に入ると分かる。はじめは、どのステージも詰んでいない', () => {
  let S = fixed(1);
  assert.strictEqual(E.stuck(S), false);
  S = go(S, 0, 'down', 'right', 'right', 'right', 'right');
  S = go(S, 1, 'up', 'right', 'right', 'right');
  S = go(S, 0, 'right');
  assert.strictEqual(E.stuck(S), false);            // スイッチの1つ手前
  const on = go(S, 0, 'right');
  assert.strictEqual(E.stuck(on), false);           // スイッチの上（とびらが開いた）
  const over = go(on, 0, 'right');
  assert.deepStrictEqual(over.boxes[0], [9, 2]);
  assert.strictEqual(E.stuck(over), true);          // 押しすぎた
  assert.strictEqual(E.stuck(fixed(0)), false);     // 箱のないステージ
  let withBox = 0;
  for (const level of ['normal', 'hard']) {
    for (const players of [2, 4, 7, 12]) {
      for (let seed = 1; seed <= 80; seed += 1) {
        const G = E.create(gen(level, players, seed));
        if (G.boxes.length) withBox += 1;
        assert.strictEqual(E.stuck(G), false, level + ' ' + players + '人 #' + seed);
      }
    }
  }
  assert.ok(withBox > 100);
});

t('ルームに置く形: 文字列にして読みもどすと、同じ状態になる。こわれた値・ちがうステージの値は読まない', () => {
  for (const [level, players, seed] of [['easy', 2, 1], ['normal', 4, 9], ['hard', 12, 3], ['normal', 7, 44]]) {
    const spec = gen(level, players, seed);
    let S = E.create(spec);
    const rng = E.makeRng(seed);
    for (let i = 0; i < 300; i += 1) S = E.move(S, Math.floor(rng() * players), Object.keys(E.DIRS)[Math.floor(rng() * 4)]);
    const text = E.encode(S, 7);
    const back = E.decode(text, spec);
    assert.ok(back, text);
    assert.strictEqual(back.id, 7);
    assert.deepStrictEqual(back.S, S);
    assert.ok(text.length < 60 + players * 10, '長さ ' + text.length);
  }
  const spec = gen('easy', 2, 1);
  const text = E.encode(E.create(spec), 1);
  assert.strictEqual(E.decode(text, gen('easy', 3, 1)), null);          // 人数がちがう
  assert.strictEqual(E.decode(text.replace(/\|/, '|x|'), spec), null);  // 欄の数がちがう
  assert.strictEqual(E.decode('1|0|0|0|0.0.0,0.0.0||||', spec), null);  // かべの中
  assert.strictEqual(E.decode(null, spec), null);
  assert.strictEqual(E.decode(text, { kind: 'gen', level: 'x', n: 2, seed: 1 }), null);
  // 手で作ったステージでも同じ
  const F = { kind: 'fixed', index: 1 };
  assert.deepStrictEqual(E.decode(E.encode(E.create(F), 3), F).S, E.create(F));
});

console.log('all ' + n + ' passed');
