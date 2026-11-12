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

t('おまかせ: 2人は、どのむずかしさも総当たりでクリアできる。1人だけではクリアできない', () => {
  const COUNT = { easy: 40, normal: 20, hard: 12, expert: 12 };
  for (const level of Object.keys(E.LEVELS)) {
    let solved = 0;
    let longest = 0;
    for (let seed = 1; seed <= COUNT[level]; seed += 1) {
      const steps = solve(gen(level, 2, seed), null, 4000000);
      assert.ok(steps !== null, level + ' #' + seed + ' 調べきれない');
      assert.ok(steps > 0, level + ' #' + seed + '\n' + E.staticOf(gen(level, 2, seed)).rows.join('\n'));
      assert.notStrictEqual(solve(gen(level, 2, seed), 0, 100000) > 0, true, level + ' #' + seed + ' 1人でクリアできてしまう');
      solved += 1;
      longest = Math.max(longest, steps);
    }
    console.log('   ' + E.LEVELS[level].label + ': ' + solved + '個クリアできた（いちばん少ない歩数の、いちばん長いもの ' + longest + '歩）');
  }
});

t('おまかせ: とびらの先のカギ（keyDoor）は、1人がスイッチをおさえている間だけ、もう1人がとれる', () => {
  let spec = null;
  for (let seed = 1; seed <= 100 && !spec; seed += 1) {
    if (E.staticOf(gen('normal', 2, seed)).kinds.includes('keyDoor')) spec = gen('normal', 2, seed);
  }
  assert.ok(spec, 'keyDoor の出るステージがある');
  const T = E.staticOf(spec);
  // カギのとなりの、とびらのマスをさがす
  const [kx, ky] = T.keys[0];
  const door = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [kx + dx, ky + dy]).find(([x, y]) => E.SWITCH_OF[T.tiles[y * T.w + x]]);
  assert.ok(door, 'カギのとなりに、とびらがある');
  const sw = E.SWITCH_OF[T.tiles[door[1] * T.w + door[0]]];
  const i = T.tiles.indexOf(sw);
  const S = E.create(spec);
  assert.strictEqual(E.doorOpen(S, door[0], door[1]), false);
  S.players[1].x = i % T.w;
  S.players[1].y = Math.floor(i / T.w);
  assert.strictEqual(E.doorOpen(S, door[0], door[1]), true);
  // 箱のスイッチではないので、詰みの判定には入らない
  assert.ok(!T.boxSw.includes(sw));
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

t('人数に合わせた協力: 押す人数とスイッチの数は、人数で決まる', () => {
  const team = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((p) => E.teamFor(p, E.roomSize(p)));
  assert.deepStrictEqual(team, [2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7]);
  assert.deepStrictEqual([4, 5, 6, 7, 8, 12].map(E.needFor), [2, 2, 3, 3, 4, 4]);
  // おさえる人も先へ行けるよう、通る人がおさえる人より少なくならない
  for (let p = 4; p <= 12; p += 1) assert.ok(p - E.needFor(p) >= E.needFor(p), p + '人');
});

t('3人以上で押す箱: 人数が足りないと動かない。たてにならぶと、みんなそろって1マス進む', () => {
  let spec = null;
  for (let seed = 1; seed <= 100 && !spec; seed += 1) {
    const T = E.staticOf(gen('normal', 3, seed));
    if (T.team.includes(3)) spec = gen('normal', 3, seed);
  }
  assert.ok(spec, '3人で押す箱の出るステージがある');
  const T = E.staticOf(spec);
  const bi = T.team.indexOf(3);
  const [bx, by] = T.boxes[bi];
  // 箱は通り道の行にある。スイッチのあるがわへ押す
  const row = T.tiles.slice(by * T.w, by * T.w + T.w);
  const sx = row.findIndex((c, x) => T.boxSw.includes(c) && Math.abs(x - bx) <= 8 && row.slice(Math.min(x, bx), Math.max(x, bx)).every((t) => t !== '#'));
  assert.ok(sx >= 0, 'スイッチが同じ行にある');
  const dx = Math.sign(sx - bx);
  const dir = dx > 0 ? 'right' : 'left';
  const S = E.create(spec);
  const put = (i, x) => { S.players[i].x = x; S.players[i].y = by; };
  put(0, bx - dx);
  put(1, bx - 2 * dx);
  assert.strictEqual(E.move(S, 0, dir), S);                 // 2人では動かない
  put(2, bx - 3 * dx);
  const N = E.move(S, 0, dir);
  assert.notStrictEqual(N, S);
  assert.deepStrictEqual(N.boxes[bi], [bx + dx, by]);
  assert.deepStrictEqual(N.players.map((p) => p.x), [bx, bx - dx, bx - 2 * dx]);
  // ルームに書く所: 箱と、ならんだ3人
  assert.deepStrictEqual(Object.keys(E.patch(S, N, 0)).sort(), ['b/' + bi, 'p/0', 'p/1', 'p/2']);
  // あいだが1人ぬけていると動かない
  put(1, bx - 2 * dx); S.players[1].y = by === 1 ? by + 1 : by - 1;
  assert.strictEqual(E.move(S, 0, dir), S);
});

t('同時におさえるスイッチ: 6人なら3つ。2つでは開かず、3つおさえると開く', () => {
  let spec = null;
  for (let seed = 1; seed <= 200 && !spec; seed += 1) {
    if (E.staticOf(gen('normal', 6, seed)).kinds.includes('pair')) spec = gen('normal', 6, seed);
  }
  assert.ok(spec);
  const T = E.staticOf(spec);
  const c = Object.keys(T.need)[0];
  assert.strictEqual(T.need[c], 3);
  const cells = [];
  T.tiles.forEach((ch, i) => { if (ch === c) cells.push([i % T.w, Math.floor(i / T.w)]); });
  assert.strictEqual(cells.length, 6);   // 手前に3つ・先に3つ
  const S = E.create(spec);
  [0, 1].forEach((i) => { S.players[i].x = cells[i][0]; S.players[i].y = cells[i][1]; });
  assert.strictEqual(E.held(S, c), false);
  S.players[2].x = cells[2][0]; S.players[2].y = cells[2][1];
  assert.strictEqual(E.held(S, c), true);
});

t('おまかせ: 3人の、3人で押す箱の入ったステージも、総当たりでクリアできる（30秒ほどかかる）', () => {
  const spec = gen('normal', 3, 2);
  assert.ok(E.staticOf(spec).kinds.includes('boxBig'), E.staticOf(spec).kinds.join());
  const steps = solve(spec, null, 8000000);
  assert.ok(steps > 0, String(steps));
  console.log('   いちばん少なくて ' + steps + ' 歩');
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
  for (const level of ['normal', 'hard', 'expert']) {
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

// ルームの代わり: { 場所: 値 } を、入れ子の値に書きこむ（null は消す）
function applyPatch(room, patch) {
  Object.keys(patch).forEach((path) => {
    const [a, k] = path.split('/');
    if (!room[a]) room[a] = {};
    if (patch[path] === null) delete room[a][k];
    else room[a][k] = patch[path];
  });
}
// 歩数（n）をのぞいて、ルールの上の状態をくらべる
const plain = (S) => ({
  players: S.players.map((p) => [p.x, p.y, p.key]),
  boxes: S.boxes, keys: S.keys.slice().sort(), stars: S.stars.slice().sort(), open: S.open.slice().sort(),
  got: S.got, cleared: S.cleared, rev: S.rev,
});

t('ルームに置く形: 1歩ごとに書く所だけを当てていくと、ルールの上の状態と同じになる', () => {
  for (const [level, players, seed] of [['easy', 2, 1], ['normal', 4, 9], ['hard', 12, 3], ['normal', 7, 44], ['hard', 5, 8]]) {
    const spec = gen(level, players, seed);
    let S = E.create(spec);
    const room = JSON.parse(JSON.stringify(E.toRoom(S)));
    assert.deepStrictEqual(plain(E.fromRoom(room, spec)), plain(S));
    const rng = E.makeRng(seed);
    let wrote = 0;
    let single = 0;
    for (let i = 0; i < 1500; i += 1) {
      const who = Math.floor(rng() * players);
      const next = E.move(S, who, Object.keys(E.DIRS)[Math.floor(rng() * 4)]);
      if (next === S) continue;
      const patch = E.patch(E.fromRoom(room, spec), next, who);
      wrote += 1;
      if (Object.keys(patch).length === 1) single += 1;
      assert.ok(patch['p/' + who], '動いた人の場所を書く');
      applyPatch(room, patch);
      S = next;
      assert.deepStrictEqual(plain(E.fromRoom(JSON.parse(JSON.stringify(room)), spec)), plain(S), level + ' ' + players + '人 ' + i);
    }
    assert.ok(wrote > 50);
    // ほとんどの1歩は、自分の場所の1か所だけを書く
    assert.ok(single / wrote > 0.9, '1か所だけの割合 ' + (single / wrote).toFixed(2));
  }
});

t('ルームに置く形: 手で作ったステージを、手順のとおりに進めても同じ（箱・カギ・かぎつきのとびら）', () => {
  for (let index = 0; index < E.FIXED.length; index += 1) {
    const spec = { kind: 'fixed', index };
    let S = E.create(spec);
    const room = JSON.parse(JSON.stringify(E.toRoom(S)));
    // はば優先で見つけた手順をたどる
    const seen = new Set();
    let frontier = [{ S, path: [] }];
    let path = null;
    while (frontier.length && !path) {
      const nextF = [];
      for (const node of frontier) {
        if (node.S.cleared) { path = node.path; break; }
        for (let who = 0; who < 2; who += 1) for (const dir of Object.keys(E.DIRS)) {
          const N = E.move(node.S, who, dir);
          const k = JSON.stringify([N.players, N.boxes, N.keys, N.open]);
          if (N === node.S || seen.has(k)) continue;
          seen.add(k);
          nextF.push({ S: N, path: node.path.concat([[who, dir]]) });
        }
      }
      frontier = nextF;
    }
    assert.ok(path, 'ステージ' + index);
    for (const [who, dir] of path) {
      const next = E.move(S, who, dir);
      applyPatch(room, E.patch(E.fromRoom(room, spec), next, who));
      S = next;
    }
    const back = E.fromRoom(JSON.parse(JSON.stringify(room)), spec);
    assert.strictEqual(back.cleared, true);
    assert.deepStrictEqual(plain(back), plain(S));
  }
});

t('ルームに置く形: こわれた値は、その所だけはじめの値で読む。配列で返ってきても読める', () => {
  const spec = gen('normal', 3, 7);
  const T = E.staticOf(spec);
  const room = E.toRoom(E.create(spec));
  // かべの中・形のちがう値・足りない値
  const broken = { p: ['0.0.0.0', 'x', room.p[2]], b: room.b, k: room.k, st: room.st };
  const S = E.fromRoom(broken, spec);
  assert.deepStrictEqual([S.players[0].x, S.players[0].y], T.starts[0]);
  assert.deepStrictEqual([S.players[1].x, S.players[1].y], T.starts[1]);
  assert.strictEqual(S.open.length, 0);
  // 星の 0 番をとったあと、Realtime Database が [null, 1, 1] の配列で返す形
  const arr = E.fromRoom({ p: room.p, b: room.b, k: room.k, st: [null, 1, 1] }, spec);
  assert.strictEqual(arr.stars.length, 2);
  assert.strictEqual(arr.got, 1);
  // 星もカギもぜんぶ消えた（空の入れ物は Realtime Database から消える）
  const none = E.fromRoom({ p: room.p, b: room.b }, spec);
  assert.strictEqual(none.stars.length, 0);
  assert.strictEqual(none.keys.length, 0);
  assert.strictEqual(E.fromRoom(null, spec), null);
  assert.strictEqual(E.fromRoom(room, { kind: 'gen', level: 'x', n: 3, seed: 7 }), null);
});

console.log('all ' + n + ' passed');
