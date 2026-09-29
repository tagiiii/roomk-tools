/* キャリアすごろく — ルームの決まり（room.js）のテスト
   使い方: node tests/career-sugoroku/room.test.cjs */
'use strict';
const path = require('path');
const assert = require('assert');
const app = path.join(__dirname, '..', '..', 'apps', 'career-sugoroku');
const RM = require(path.join(app, 'room.js'));
const E = require(path.join(app, 'engine.js'));

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const room = (over) => Object.assign({
  meta: { hostId: 'h', hostConnected: true },
  status: 'playing',
  seats: { d0: { name: 'あお', dev: 'd0', no: 1 }, x1: { name: 'だいり', dev: '', no: 2 }, d2: { name: 'みどり', dev: 'd2', no: 3 } },
  order: ['d0', 'x1', 'd2'],
  game: JSON.stringify(E.newGame({ names: ['あお', 'だいり', 'みどり'], dice: 1, seed: 3 })),
  presence: { d0: true },
}, over || {});

test('名前: 前後の空白を除いて1〜8文字', () => {
  assert.strictEqual(RM.nameError(' あお '), null);
  assert.strictEqual(RM.nameError(''), 'empty');
  assert.strictEqual(RM.nameError('   '), 'empty');
  assert.strictEqual(RM.nameError('12345678'), null);
  assert.strictEqual(RM.nameError('123456789'), 'long');
  assert.strictEqual(RM.cleanName(' あお '), 'あお');
});

test('期限: 待合室は2分・ゲーム中は15分。つながっていれば期限なし。ゴーストは期限切れ', () => {
  const t = 1000000;
  const lobby = { meta: { hostConnected: false, hostDisconnectedAt: t }, status: 'waiting' };
  assert.strictEqual(RM.isExpired(lobby, t + 2 * 60 * 1000 - 1), false);
  assert.strictEqual(RM.isExpired(lobby, t + 2 * 60 * 1000), true);
  const game = { meta: { hostConnected: false, hostDisconnectedAt: t }, status: 'playing' };
  assert.strictEqual(RM.isExpired(game, t + 14 * 60 * 1000), false);
  assert.strictEqual(RM.isExpired(game, t + 15 * 60 * 1000), true);
  assert.strictEqual(RM.hostDeadline(game), t + 15 * 60 * 1000);
  assert.strictEqual(RM.isExpired({ meta: { hostConnected: true }, status: 'playing' }, t * 9), false);
  assert.strictEqual(RM.hostDeadline({ meta: { hostConnected: true }, status: 'playing' }), null);
  assert.strictEqual(RM.isExpired({ meta: { hostConnected: false } }, t), true); // status がない
  assert.strictEqual(RM.isExpired(null, t), true);
});

test('席: 待合室は入った順、ゲーム中は order の順。端末とプレイヤー番号の対応・つながり・端末なし', () => {
  const w = { status: 'waiting', seats: { b: { name: 'に', no: 2 }, a: { name: 'いち', no: 1 }, c: { name: 'さん', no: 3 } } };
  assert.deepStrictEqual(RM.seatList(w).map((s) => s.name), ['いち', 'に', 'さん']);
  assert.strictEqual(RM.nameTaken(w, ' に '), true);
  const r = room();
  assert.deepStrictEqual(RM.seatList(r).map((s) => s.name), ['あお', 'だいり', 'みどり']);
  assert.strictEqual(RM.pidOf(r, 'd2'), 2);
  assert.strictEqual(RM.pidOf(r, 'h'), null);
  assert.strictEqual(RM.seatOnline(r, 0), true);
  assert.strictEqual(RM.seatOnline(r, 2), false);
  assert.strictEqual(RM.isProxySeat(r, 1), true);
  assert.strictEqual(RM.isHost(r, 'h'), true);
  assert.strictEqual(RM.isHost(r, 'd0'), false);
});

test('だれが押せるか: 自分の番の端末と進行役。進行役だけの操作。結果のあとは押せない', () => {
  const r = room(); // あお（d0）の番
  assert.strictEqual(RM.canAct(r, 'd0', { type: 'roll' }), true);
  assert.strictEqual(RM.canAct(r, 'd2', { type: 'roll' }), false);
  assert.strictEqual(RM.canAct(r, 'h', { type: 'roll' }), true);
  assert.strictEqual(RM.canAct(r, 'd0', { type: 'end' }), false);
  assert.strictEqual(RM.canAct(r, 'h', { type: 'end' }), true);
  assert.strictEqual(RM.canAct(r, 'd0', { type: 'labels', labels: 'age' }), false);
  const g = JSON.parse(r.game);
  g.cur = 1; // 端末のない人の番
  const r2 = room({ game: JSON.stringify(g) });
  assert.strictEqual(RM.canAct(r2, 'd0', { type: 'roll' }), false);
  assert.strictEqual(RM.canAct(r2, 'h', { type: 'roll' }), true);
  const done = room({ status: 'finished' });
  assert.strictEqual(RM.canAct(done, 'h', { type: 'roll' }), false);
});

test('しるし: 操作が1つ通るたびに変わる（二度押しを見分ける）', () => {
  let s = E.newGame({ names: ['a', 'b'], dice: 1, seed: 11 });
  const seen = new Set([RM.stamp(s)]);
  let r = 1;
  const pick = (k) => { r = (r * 1103515245 + 12345) >>> 0; return r % k; };
  for (let i = 0; i < 400 && s.phase === 'play'; i++) {
    const st = s.step;
    let a;
    switch (st.kind) {
      case 'roll': a = { type: 'roll' }; break;
      case 'skip': case 'ack': a = { type: 'ack' }; break;
      case 'fork': a = { type: 'fork', choice: pick(2) }; break;
      case 'route': a = { type: 'route', choice: pick(2) }; break;
      case 'job': a = { type: 'job', job: pick(24) }; break;
      case 'friend': a = { type: 'friend', pid: 1 - s.cur }; break;
      case 'pick': a = { type: 'pick', a: st.opts[pick(st.opts.length)] }; break;
      case 'vote': a = { type: 'vote', opt: 0 }; break;
      case 'coop': a = { type: 'coop' }; break;
      case 'mini': a = { type: 'mini', picks: { 0: { hilo: 'hi', janken: 'g', sum: 1 }[st.game], 1: { hilo: 'lo', janken: 'p', sum: 2 }[st.game] } }; break;
      default: throw new Error(st.kind);
    }
    const before = RM.stamp(s);
    const out = E.apply(s, a);
    assert.ok(out.ok, st.kind);
    s = out.state;
    assert.notStrictEqual(RM.stamp(s), before, `${st.kind} のあとでしるしが変わらない`);
  }
});

test('ミニゲームの答え: キーは文字列（p0 など）。いまの番の分だけ読む', () => {
  const g = E.newGame({ names: ['a', 'b'], dice: 1, seed: 1 });
  g.step = { kind: 'mini', game: 'hilo', base: 3 };
  g.last = Object.assign({}, g.last, { id: 12 });
  const r = room({ game: JSON.stringify(g), answers: { n12: { p0: 'hi', p1: 'lo', px: 'ng' }, n11: { p0: 'lo' } } });
  assert.deepStrictEqual(RM.answersOf(r), { 0: 'hi', 1: 'lo' });
  assert.strictEqual(RM.answerKey(g), 'n12');
  assert.strictEqual(RM.pidKey(3), 'p3');
  assert.strictEqual(RM.canAnswer(r, 'd0', 0), true);
  assert.strictEqual(RM.canAnswer(r, 'd0', 2), false);
  assert.strictEqual(RM.canAnswer(r, 'h', 1), true); // 端末のない人
  assert.strictEqual(RM.canAnswer(r, 'h', 0), false); // つながっている人の分は本人が押す
  assert.strictEqual(RM.canAnswer(room({ game: r.game, presence: {} }), 'h', 0), true); // つながっていない人
  assert.strictEqual(RM.canAnswer(room({ game: r.game, status: 'finished' }), 'd0', 0), false);
});

for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log('  ok  ' + t.name);
  } catch (e) {
    console.log('  NG  ' + t.name);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`\n${passed}/${tests.length} 件合格`);
if (passed !== tests.length) process.exitCode = 1;
