// のりあいロードのエンジンのテスト。node tests/noriai-road/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('../../apps/noriai-road/engine.js');

const DT = 1 / 60;
let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  ' + name); }
  catch (e) { console.log('NG  ' + name + '\n    ' + (e && e.stack || e)); process.exitCode = 1; }
}
// inputs(frame) → 人ごとの入力の配列
function run(world, frames, inputs) {
  let prev = world.players.map(() => ({}));
  for (let f = 0; f < frames; f++) {
    const cur = (inputs ? inputs(f) : []) || [];
    const ins = world.players.map((p, i) => {
      const c = cur[i] || {};
      return { ...c, jumpPressed: !!c.jump && !prev[i].jump, actPressed: !!c.act && !prev[i].act };
    });
    E.stepLocal(world, ins, DT);
    prev = world.players.map((p, i) => cur[i] || {});
  }
}
function place(p, x, y) { p.x = x; p.y = y; p.vx = 0; p.vy = 0; p.ground = null; }
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;

test('どのステージも作れて、スタートの場所が空いている', () => {
  E.STAGES.forEach((st, i) => {
    for (let n = 2; n <= E.MAX_PLAYERS; n++) {
      const w = E.createWorld(i, n);
      for (const p of w.players) {
        for (let tx = Math.floor(p.x); tx <= Math.floor(p.x + E.PW); tx++) {
          assert(!E.solidTile(w, tx, 9, p.seat), `stage ${i} seat ${p.seat} が壁の中`);
        }
      }
      run(w, 30);
      for (const p of w.players) assert(p.ground, `stage ${i} seat ${p.seat} が立てていない`);
      assert(w.door, 'とびらがある');
    }
  });
});

test('2マスの段は、ひとりでは上がれない', () => {
  const w = E.createWorld(0, 2);
  const g = w.gates[0]; // 台の下のとびら（台の左はしと同じ x）
  const [a] = w.players;
  place(a, g.x - 1.5, 10 - E.PH);
  place(w.players[1], 2, 10 - E.PH);
  run(w, 10);
  run(w, 60, () => [{ r: true, jump: true }]);
  assert(a.y > 8.5, '台に乗れてしまった y=' + a.y);
});

test('友だちの頭に乗ると、2マスの段に上がれる', () => {
  const w = E.createWorld(0, 2);
  const g = w.gates[0];
  const [a, b] = w.players;
  place(b, g.x - 1.0, 10 - E.PH);
  place(a, g.x - 1.0, 10 - E.PH * 2 - 0.05);
  run(w, 20);
  assert.strictEqual(a.ground, 's2', '頭に乗っている');
  run(w, 60, (f) => [{ r: true, jump: f < 20 }]);
  assert(near(a.y, 8 - E.PH), '台の上 y=' + a.y);
});


test('床から跳んで、友だちの頭に乗れる', () => {
  const w = E.createWorld(0, 2);
  const [a, b] = w.players;
  place(b, 5, 10 - E.PH);
  place(a, 3, 10 - E.PH);
  run(w, 10);
  // 右へ走りながら跳び、頭の上で止まる
  run(w, 40, (f) => [{ r: f < 14, jump: f < 12 }, {}]);
  assert.strictEqual(a.ground, 's2', '頭に乗った x=' + a.x + ' y=' + a.y);
});

test('台の上のスイッチをおさえている間だけ、とびらが開く', () => {
  const w = E.createWorld(0, 2);
  const s = w.switches[0];
  const [a] = w.players;
  place(a, s.x + 0.1, s.y + 1 - E.PH);
  run(w, 10);
  assert(w.gates[0].open, '開いた');
  place(a, s.x + 3, s.y + 1 - E.PH);
  run(w, 10);
  assert(!w.gates[0].open, '閉じた');
});

test('番号のかべは、その番号の人だけ通れる', () => {
  const w = E.createWorld(0, 2);
  const g = w.gates.find((x) => x.seatN);
  assert.strictEqual(g.seatN, 2);
  const [a, b] = w.players;
  place(a, g.x - 1.2, 10 - E.PH);
  place(b, g.x - 1.2, 10 - E.PH);
  run(w, 60, () => [{ r: true }, {}]);
  assert(a.x + E.PW <= g.x + 0.01, '1番は止まる');
  run(w, 25, () => [{}, { r: true }]);
  assert(b.x > g.x + 1, '2番は通る');
  // 2番が向こうのスイッチに乗ると、みんな通れる
  const s = w.switches.find((x) => x.letter === g.letter);
  place(b, s.x + 0.1, 10 - E.PH);
  run(w, 60, () => [{ r: true }, {}]);
  assert(a.x > g.x + 1, '1番も通れた');
});

test('人の上に乗ったまま、下の人が歩くといっしょに動く', () => {
  const w = E.createWorld(0, 2);
  const [a, b] = w.players;
  place(b, 3, 10 - E.PH);
  place(a, 3, 10 - E.PH * 2 - 0.05);
  run(w, 20);
  run(w, 30, () => [{}, { r: true }]);
  assert.strictEqual(a.ground, 's2');
  assert(near(a.x, b.x, 0.02), '同じだけ動いた');
});

test('番号のブロックの中のカギは、その人だけがとれて、とびらを開けられる', () => {
  const w = E.createWorld(0, 2);
  const key = w.items[0];
  const [a, b] = w.players;
  place(b, key.x - 1.5, 10 - E.PH);
  run(w, 90, () => [{}, { r: true }]);
  assert.strictEqual(key.holder, 0, '2番はブロックに入れない');
  place(a, key.x - 1.5, 10 - E.PH);
  run(w, 40, () => [{ r: true }, {}]);
  assert.strictEqual(key.holder, 1, '1番が持った');
  // とびらへ
  const d = w.door;
  place(a, d.x - 0.2, 10 - E.PH);
  run(w, 5);
  assert(!d.locked, 'カギで開いた');
  assert(key.gone);
  place(b, d.x, 10 - E.PH);
  run(w, 5);
  assert(w.players.every((p) => p.entered), '全員が入った');
  assert(w.clear, 'クリア');
});

test('とびらに入った人は、下（投げる）で出られて、出たまま歩ける', () => {
  const w = E.createWorld(1, 2);
  const d = w.door;
  const [a, b] = w.players;
  place(a, d.x, 10 - E.PH);
  place(b, d.x - 6, 10 - E.PH);
  run(w, 5);
  assert(a.entered, '入った');
  run(w, 2, (f) => [{ act: f === 0 }, {}]);
  run(w, 30);
  assert(!a.entered, '出たまま（すぐ入りなおさない）');
  assert(a.x + E.PW <= d.x && a.ground, 'とびらの左の床に出た x=' + a.x);
  assert(!w.clear, 'クリアにならない');
  // 左へ歩ける・右へ戻るとまた入れる
  const x0 = a.x;
  run(w, 20, () => [{ l: true }, {}]);
  assert(a.x < x0 - 0.5, '左へ歩けた');
  run(w, 60, () => [{ r: true }, {}]);
  assert(a.entered, 'また入れた');
});

test('重い箱は、数字の人数で押すと動く', () => {
  const w = E.createWorld(1, 3);
  const box = w.boxes[0];
  assert.strictEqual(box.need, 3);
  const ps = w.players;
  ps.forEach((p) => place(p, box.x - E.PW, 10 - E.PH));
  run(w, 5);
  const x0 = box.x;
  run(w, 30, () => [{ r: true }, { r: true }, {}]);
  assert(near(box.x, x0), '2人では動かない');
  run(w, 30, () => [{ r: true }, { r: true }, { r: true }]);
  assert(box.x > x0 + 0.5, '3人で動く');
  // スイッチまで押すと、とびらで止まり、とびらが開いたままになる
  run(w, 240, () => [{ r: true }, { r: true }, { r: true }]);
  const s = w.switches[0];
  assert(near(box.x, s.x, 0.01), '箱がスイッチの上 x=' + box.x);
  assert(s.on && w.gates[0].open, 'とびらが開いた');
});

test('リフトは、数字の人数が乗ると上がり、おりると下がる', () => {
  const w = E.createWorld(1, 2);
  const lift = w.plats[0];
  const [a, b] = w.players;
  place(a, lift.x + 0.2, lift.y - E.PH);
  place(b, lift.x - 2, 10 - E.PH);
  run(w, 60);
  assert(near(lift.y, lift.ay), '1人では上がらない');
  place(b, lift.x + 1.4, lift.y - E.PH);
  run(w, 200);
  assert(near(lift.y, lift.by), '2人で上がった y=' + lift.y);
  assert(near(a.y, lift.by - E.PH, 0.05) && near(b.y, lift.by - E.PH, 0.05), 'いっしょに上がった');
  // 上の台へ歩いて出る
  run(w, 60, () => [{ r: true }, { r: true }]);
  assert(near(a.y, 4 - E.PH, 0.05), '台に出た');
  // 最後の人がおりてから1.5秒待って下がる
  run(w, 300);
  assert(near(lift.y, lift.ay), 'おりたら下がった');
});

test('人の上に人が乗っても、リフトの人数に数える', () => {
  const w = E.createWorld(1, 2);
  const lift = w.plats[0];
  const [a, b] = w.players;
  place(b, lift.x + 1, lift.y - E.PH);
  place(a, lift.x + 1, lift.y - E.PH * 2 - 0.05);
  run(w, 60);
  assert(lift.y < lift.ay - 0.5, '上がりはじめた');
});

test('動く床は、数字の人数が乗ると向こうへわたる', () => {
  const w = E.createWorld(1, 2);
  const br = w.plats[1];
  const [a, b] = w.players;
  place(a, br.x + 0.2, 10 - E.PH);
  place(b, br.x + 1.2, 10 - E.PH);
  run(w, 300);
  assert(near(br.x, br.bx), 'わたった');
  assert(a.x > br.bx - 0.1 && a.y < 10, '乗ったまま運ばれた');
});

test('シーソーは重いほうが下がり、箱も重さに入る', () => {
  const w = E.createWorld(2, 2);
  const [L, R] = [w.plats[0], w.plats[1]];
  const [a, b] = w.players;
  place(a, R.x + 1.8, R.y - E.PH);
  place(b, L.x + 0.3, L.y - E.PH);
  run(w, 120);
  assert(near(L.y, R.y), '1人ずつならつり合う');
  // 箱を左に乗せる
  const box = w.boxes[0];
  box.x = L.x + 1.6; box.y = L.y - 1; box.vy = 0;
  run(w, 120);
  assert(near(R.y, 10 - 1.5, 0.05), '右が上がった y=' + R.y);
  // 右から台へ
  run(w, 60, (f) => [{ r: true, jump: f < 20 }, {}]);
  assert(near(a.y, 7 - E.PH, 0.05), '台に上がれた y=' + a.y);
});

test('シーソーで下がった側からも、床へ跳んで出られる', () => {
  const w = E.createWorld(2, 2);
  const [L] = [w.plats[0]];
  const [a, b] = w.players;
  place(a, L.x + 0.3, L.y - E.PH);
  const box = w.boxes[0];
  box.x = L.x + 1.6; box.y = L.y - 1;
  place(b, 2, 10 - E.PH);
  run(w, 120);
  assert(near(L.y, 11.5, 0.05), '左が下がった');
  run(w, 60, (f) => [{ l: true, jump: f < 20 }, {}]);
  assert(near(a.y, 10 - E.PH, 0.05) && a.x < L.x, '左の床に出た y=' + a.y);
});

test('ボールを持つとジャンプできない', () => {
  const w = E.createWorld(2, 2);
  const ball = w.items[0];
  const [a] = w.players;
  ball.holder = 1;
  place(a, 3, 10 - E.PH);
  run(w, 10);
  run(w, 30, () => [{ jump: true }]);
  assert(near(a.y, 10 - E.PH), '跳ばない');
});

function hoopTry(standOnFriend) {
  // かごの手前で、いろいろな所から投げて、入るものがあるか
  let ok = false;
  const base = E.createWorld(2, 2);
  const h = base.hoops[0];
  for (let dx = -6; dx <= 2 && !ok; dx += 0.25) {
    for (const face of [1, -1]) {
      const w = E.createWorld(2, 2);
      const [a, b] = w.players;
      const ball = w.items[0];
      const x = h.x + dx;
      place(b, x, 10 - E.PH);
      if (standOnFriend) place(a, x, 10 - E.PH * 2 - 0.05); else { place(a, x, 10 - E.PH); place(b, x - 3, 10 - E.PH); }
      run(w, 15);
      ball.holder = 1;
      run(w, 2);
      a.face = face;
      run(w, 2, () => [{ act: true }]);
      run(w, 120);
      if (w.hoops[0].done) { ok = true; break; }
    }
  }
  return ok;
}
test('ボールは、地面からはかごにとどかず、友だちの頭の上からなら入る', () => {
  assert(!hoopTry(false), '地面から入ってしまう');
  assert(hoopTry(true), '頭の上からも入らない');
});

test('かごにボールが入ると、とびらが開いたままになる', () => {
  const w = E.createWorld(2, 2);
  w.hoops[0].done = true;
  run(w, 5);
  const g = w.gates.find((x) => x.letter === w.hoops[0].letter);
  assert(g.open);
});

test('ひも: となりの人から、ひもの長さより遠くへは行けない', () => {
  const w = E.createWorld(3, 2);
  const [a, b] = w.players;
  run(w, 10);
  run(w, 120, () => [{ r: true }, {}]);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert(d <= E.ROPE_LEN + 0.05, 'はなれすぎ d=' + d);
});

test('落ちても、手前の区間のはじめに戻る', () => {
  const w = E.createWorld(0, 2);
  const [a] = w.players;
  place(a, 15.5, 11);
  run(w, 90);
  assert(a.y < 10 && a.ground, '床に戻った');
  assert(a.x < 15, '手前に戻った x=' + a.x);
});

test('全員が画面の中にいる（ひとりだけ先へ行けない）', () => {
  const w = E.createWorld(1, 2);
  run(w, 10);
  run(w, 300, () => [{ r: true }, {}]);
  const [a, b] = w.players;
  assert(a.x - b.x <= E.VIEW, 'はなれすぎ ' + (a.x - b.x));
});

test('ルームに置く形: 人は書いて読むと同じ', () => {
  const p = E.makePlayer(2, 3.456, 8.2);
  p.ground = 's1'; p.rx = 0.123; p.face = -1; p.inDir = 1;
  const enc = E.encodePlayer(p);
  assert.strictEqual(typeof enc, 'string', '1つの文字列で書く');
  const d = E.decodePlayer(JSON.parse(JSON.stringify(enc)));
  assert.deepStrictEqual([d.x, d.y, d.face, d.ground, d.inDir, d.entered, d.rx], [3.46, 8.2, -1, 's1', 1, false, 0.12]);
  assert.strictEqual(E.decodePlayer(['a', 1, 1, 0, 0, 0]), null, 'こわれた値は null');
  assert.strictEqual(E.decodePlayer([1, 1, 1, 'x9', 0, 0]).ground, null, '知らない乗りものは null');
  assert.strictEqual(E.decodePlayer('a,1,1,0,0,0'), null, 'こわれた文字列は null');
  const q = E.makePlayer(3, 21.2, 9.1); q.ground = 'p0'; q.rx = 1.2;
  assert.deepStrictEqual([E.decodePlayer(E.encodePlayer(q)).ground, E.decodePlayer(E.encodePlayer(q)).rx], ['p0', 1.2], '動く床の上の位置も書く');
  assert.strictEqual(E.decodePlayer('1,2'), null, '短い文字列は null');
  assert.strictEqual(E.decodePlayer('1,2,1,0,0,0').ground, null, '乗っていない');
  assert.strictEqual(E.decodePlayer('1,2,1,t,-1,1').entered, true);
  // 前の版が書いた配列も読める
  assert.deepStrictEqual(E.decodePlayer([3.46, 8.2, -1, 's1', 1, 0, 0.12]), d);
});

test('ルームに置く形: ワールドを書いて読みこむと、印と位置がそろう', () => {
  const w = E.createWorld(4, 3);
  w.boxes[0].x += 2; w.gates[1].open = true; w.items[0].holder = 2; w.hoops[0].done = true; w.door.locked = false;
  w.plats[0].y = 6; w.seesaws[0].off = 1.5; w.plats[w.seesaws[0].left].y = 11.5; w.plats[w.seesaws[0].right].y = 8.5;
  const snap = JSON.parse(JSON.stringify(E.snapshot(w)));
  const v = E.createWorld(4, 3);
  E.applySnapshot(v, snap, true);
  assert(near(v.boxes[0].x, w.boxes[0].x));
  assert(v.gates[1].open && v.items[0].holder === 2 && v.hoops[0].done && !v.door.locked);
  assert(near(v.plats[0].y, 6) && near(v.seesaws[0].off, 1.5));
  // 位置なし: 印だけ
  const u = E.createWorld(4, 3);
  E.applySnapshot(u, snap, false);
  assert(u.gates[1].open && near(u.boxes[0].x, u.boxes[0].x0));
  // こわれた値でも落ちない
  E.applySnapshot(u, { b: 'x', p: null, i: [[1]], g: 5 }, true);
});

test('いなくなった人は、クリアの数に入れない', () => {
  const w = E.createWorld(0, 3);
  w.door.locked = false;
  w.players[2].absent = true; w.players[2].entered = true;
  w.players.slice(0, 2).forEach((p) => { p.x = w.door.x; p.y = 9.1; });
  run(w, 5);
  assert(w.clear);
});

/* ── 大人数（5〜10人） ── */
test('「みんな」の数字は5までで、ほかの数字は人数で頭打ち', () => {
  assert.strictEqual(E.MAX_PLAYERS, 10);
  for (let n = 2; n <= 10; n++) {
    const w = E.createWorld(1, n);
    assert.strictEqual(w.boxes[0].need, Math.min(n, 5), 'box n=' + n);
    assert.strictEqual(w.plats[0].need, Math.min(n, 5), 'lift n=' + n);
    const v = E.createWorld(4, n);
    assert.strictEqual(v.boxes[0].need, 2, '数字2の箱 n=' + n);
  }
});

test('10人でも、はじめの場所に全員が並べる', () => {
  const w = E.createWorld(0, 10);
  const bump = w.checkpoints[1];
  for (const p of w.players) assert(p.x + E.PW < bump + 2, 'seat ' + p.seat + ' が次の区間に入っている x=' + p.x);
  run(w, 30);
  for (const p of w.players) assert(p.ground === 't', 'seat ' + p.seat + ' が床に立っていない');
});

test('7人: リフトは5人で上がり、残りの2人だけでも上がれる', () => {
  const w = E.createWorld(1, 7);
  const lift = w.plats[0];
  const ps = w.players;
  ps.slice(0, 5).forEach((p, k) => place(p, lift.x + 0.1 + k * 0.5, lift.y - E.PH));
  ps.slice(5).forEach((p, k) => place(p, lift.x - 2 - k * 0.5, 10 - E.PH));
  run(w, 10);
  assert.strictEqual(E.platNeed(lift, ps), 5);
  run(w, 200);
  assert(near(lift.y, lift.by), '5人で上がった y=' + lift.y);
  // 5人は上の台へ出る
  run(w, 90, () => ps.map((p, k) => (k < 5 ? { r: true } : {})));
  ps.slice(0, 5).forEach((p) => assert(p.x + E.PW / 2 > lift.x + lift.w && p.y < 4, 'seat ' + p.seat + ' が台に出た'));
  run(w, 240);
  assert(near(lift.y, lift.ay), '下がってきた');
  assert.strictEqual(E.platNeed(lift, ps), 2, '残りは2人');
  ps.slice(5).forEach((p, k) => place(p, lift.x + 0.3 + k, lift.y - E.PH));
  run(w, 200);
  assert(near(lift.y, lift.by), '2人で上がった');
});

test('通信が切れた人は、動く床の人数に入れない', () => {
  const w = E.createWorld(1, 3);
  const br = w.plats[1];
  const [a, b, c] = w.players;
  c.absent = true;
  assert.strictEqual(E.platNeed(br, w.players), 2);
  place(a, br.x + 0.2, 10 - E.PH);
  place(b, br.x + 1.2, 10 - E.PH);
  run(w, 300);
  assert(near(br.x, br.bx), '2人でわたった');
});

test('ひもの組: 4人までは1本、5人からは4人までの組', () => {
  assert.deepStrictEqual(E.ropeGroups(4), [[1, 4]]);
  assert.deepStrictEqual(E.ropeGroups(5), [[1, 3], [4, 5]]);
  assert.deepStrictEqual(E.ropeGroups(8), [[1, 4], [5, 8]]);
  assert.deepStrictEqual(E.ropeGroups(10), [[1, 4], [5, 7], [8, 10]]);
  for (let n = 2; n <= 10; n++) {
    const gs = E.ropeGroups(n);
    assert.strictEqual(gs[gs.length - 1][1], n);
    assert(gs.every(([lo, hi]) => hi - lo + 1 >= 2 && hi - lo + 1 <= 4), 'n=' + n);
  }
  assert(E.ropeLinked(10, 3, 4) && !E.ropeLinked(10, 4, 5) && E.ropeLinked(10, 5, 6) && !E.ropeLinked(10, 7, 8));
  assert(!E.ropeLinked(10, 1, 3) && !E.ropeLinked(4, 4, 5));
});

test('ひも: 組がちがう人とは、はなれられる', () => {
  const w = E.createWorld(3, 6);
  run(w, 10);
  // 1〜3番は右へ、4〜6番は止まる
  run(w, 150, () => w.players.map((p) => (p.seat <= 3 ? { r: true } : {})));
  const [p1, p2, p3, p4] = w.players;
  assert(Math.hypot(p1.x - p2.x, p1.y - p2.y) <= E.ROPE_LEN + 0.05, '同じ組ははなれない');
  assert(Math.hypot(p2.x - p3.x, p2.y - p3.y) <= E.ROPE_LEN + 0.05, '同じ組ははなれない');
  assert(p3.x - p4.x > E.ROPE_LEN + 0.5, '組がちがうとはなれられる d=' + (p3.x - p4.x));
});

test('10人: 頭の上に積み重なっても、リフトの人数に数える', () => {
  const w = E.createWorld(1, 10);
  const lift = w.plats[0];
  const ps = w.players;
  for (let k = 0; k < 5; k++) place(ps[k], lift.x + 1, lift.y - E.PH * (k + 1) - 0.02 * k);
  ps.slice(5).forEach((p, k) => place(p, lift.x - 3 - k * 0.4, 10 - E.PH));
  run(w, 60);
  assert.strictEqual(lift.riders, 5);
  assert(lift.y < lift.ay - 0.5, '上がりはじめた');
});

console.log(`\n${passed} ok`);
