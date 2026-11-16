// のりあいロード（試作）のエンジンのテスト。node drafts/noriai-road/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('./engine.js');

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
    for (let n = 2; n <= 4; n++) {
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
  run(w, 200);
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

console.log(`\n${passed} ok`);
