/* キャリアすごろく v2 — エンジンのテスト
   使い方: node tests/career-sugoroku/engine.test.cjs */
'use strict';
const path = require('path');
const assert = require('assert');
const E = require(path.join(__dirname, '..', '..', 'apps', 'career-sugoroku', 'engine.js'));
const D = require(path.join(__dirname, '..', '..', 'apps', 'career-sugoroku', 'data.js'));

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ── 道具 ────────────────────────────────────────
function rand(t) { // engine.js と同じ乱数
  let x = (t.rng = (t.rng + 0x6D2B79F5) >>> 0);
  x = Math.imul(x ^ (x >>> 15), x | 1);
  x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}
// 次のサイコロが face になるように乱数の状態を合わせる（テスト用）。nth で「何番目に見つかった値か」を変えられる
function forceDie(s, face, nth) {
  let k = nth || 0;
  for (let r = 1; r < 1e6; r++) {
    const t = { rng: r };
    if (1 + Math.floor(rand(t) * 6) === face && k-- === 0) { s.rng = r; return s; }
  }
  throw new Error('見つからない');
}
// 次の乱数（0〜1）が [lo, hi) に入るように合わせる（テスト用）
function forceRand(s, lo, hi) {
  for (let r = 1; r < 1e6; r++) {
    const t = { rng: r };
    const v = rand(t);
    if (v >= lo && v < hi) { s.rng = r; return s; }
  }
  throw new Error('見つからない');
}
function act(s, action) {
  const r = E.apply(s, action);
  if (!r.ok) throw new Error(`拒否: ${r.error}（step=${JSON.stringify(s.step)} action=${JSON.stringify(action)}）`);
  return r.state;
}
function rollTo(s, face, cheer, nth) {
  const t = JSON.parse(JSON.stringify(s));
  forceDie(t, face, nth);
  return act(t, { type: 'roll', cheer });
}
// これまでのテストは「サイコロ1つ」の遊び方で動かす（2つから選ぶ遊び方は下の専用のテスト）
const newG = (opts) => E.newGame(Object.assign({ dice: 1 }, opts));
function game(n, extra) {
  return newG(Object.assign({ names: Array.from({ length: n }, (_, i) => 'P' + i), seed: 42 }, extra || {}));
}
// 次の2つのサイコロが f1・f2 になるように乱数の状態を合わせる（テスト用）
function forceDice(s, f1, f2) {
  for (let r = 1; r < 2e6; r++) {
    const t = { rng: r };
    if (1 + Math.floor(rand(t) * 6) === f1 && 1 + Math.floor(rand(t) * 6) === f2) { s.rng = r; return s; }
  }
  throw new Error('見つからない');
}
function place(s, pid, node) { // 駒を置く（trail も合わせる）
  const p = s.players[pid];
  p.node = node;
  p.trail = ['start', node];
}
const ackAll = (s) => { while (s.phase === 'play' && s.step.kind === 'ack') s = act(s, { type: 'ack' }); return s; };

// ── テスト ───────────────────────────────────────
test('はじめ: 人数・名前・最初の手番', () => {
  const s = newG({ names: ['  たろう  ', '', 'とても長い名前のプレイヤーです'], seed: 1 });
  assert.strictEqual(s.players.length, 3);
  assert.strictEqual(s.players[0].name, 'たろう');
  assert.strictEqual(s.players[1].name, D.PLAYER_COLORS[1].name); // 空なら色の名前
  assert.strictEqual(s.players[2].name.length, 10);
  assert.strictEqual(s.step.kind, 'roll');
  assert.strictEqual(s.phase, 'play');
  assert.deepStrictEqual(s.players[0].apt, [0, 0, 0, 0, 0, 0]);
  assert.strictEqual(s.players[0].job, null); // はじめに職業を決めない
});

test('人数は1〜6人におさめる', () => {
  assert.strictEqual(newG({ names: [], seed: 1 }).players.length, 1);
  assert.strictEqual(newG({ names: Array(9).fill('x'), seed: 1 }).players.length, 6);
});

test('apply は入力を変えず、同じ入力なら同じ結果', () => {
  const s = game(2);
  const before = JSON.stringify(s);
  const a = E.apply(s, { type: 'roll' });
  const b = E.apply(s, { type: 'roll' });
  assert.strictEqual(JSON.stringify(s), before);
  assert.strictEqual(JSON.stringify(a.state), JSON.stringify(b.state));
});

test('いまの段階と合わない操作は断る', () => {
  const s = game(2);
  assert.strictEqual(E.apply(s, { type: 'ack' }).ok, false);
  assert.strictEqual(E.apply(s, { type: 'job', job: 0 }).ok, false);
  assert.strictEqual(E.apply(s, { type: 'nope' }).ok, false);
  assert.strictEqual(E.apply(null, { type: 'roll' }).ok, false);
});

test('節目では目が残っていても止まり、道を選ぶ', () => {
  let s = game(2);
  place(s, 0, 'b4'); // stop15 の1つ手前
  s = rollTo(s, 6);
  assert.strictEqual(s.players[0].node, 'stop15');
  assert.strictEqual(s.step.kind, 'route');
  s = act(s, { type: 'route', choice: 1 }); // しごとの道 → その場で職業を選ぶ
  assert.strictEqual(s.step.kind, 'job');
  assert.strictEqual(s.step.keep, false);
  assert.strictEqual(E.apply(s, { type: 'job', job: 'keep' }).ok, false); // 続ける仕事はまだない
  s = act(s, { type: 'job', job: 12 });
  assert.strictEqual(s.players[0].job, 12);
  assert.strictEqual(s.players[0].lanes.c, 'cw');
  assert.strictEqual(s.step.kind, 'ack');
  s = act(s, { type: 'ack' });
  assert.strictEqual(s.cur, 1);
});

test('次の手番は選んだ道へ進む', () => {
  let s = game(1);
  place(s, 0, 'stop15');
  s.players[0].routeNext.stop15 = 'cs1';
  s.players[0].lanes.c = 'cs';
  s = rollTo(s, 1);
  assert.strictEqual(s.players[0].node, 'cs1');
});

test('分かれ道の途中で方向を聞き、残りの目だけ進む', () => {
  let s = game(1);
  place(s, 0, 'b1'); // 次が分かれ道 b2
  s = rollTo(s, 3);
  assert.strictEqual(s.players[0].node, 'b2');
  assert.strictEqual(s.step.kind, 'fork');
  assert.strictEqual(s.step.remaining, 2);
  s = act(s, { type: 'fork', choice: 1 }); // 寄り道
  assert.strictEqual(s.players[0].node, 'bl2');
});

test('分かれ道にちょうど止まったら、そのマスの効果が起き、次の番に方向を聞く', () => {
  let s = game(2);
  place(s, 0, 'e2'); // 次が e3（なかま・分かれ道）
  s.players[0].job = 0;
  s = rollTo(s, 1);
  assert.strictEqual(s.players[0].node, 'e3');
  assert.strictEqual(s.step.kind, 'friend');
});

test('しごとマスは通るたびに★の数だけ。同じマスは1回だけ', () => {
  let s = game(1);
  place(s, 0, 'stop22');
  const p = s.players[0];
  p.job = 0; // イラストレーター（ものづくり・アイデア・気づく力）
  p.apt = [2, 2, 3, 0, 0, 0]; // いちばん低いのが2 → ★3
  assert.strictEqual(E.stars(p.apt, 0), 3);
  s = rollTo(s, 2); // e1（しごと）を通って e2 へ
  assert.strictEqual(s.players[0].pts.pay, 3);
  // もどって同じマスをもう一度通っても増えない
  s.players[0].node = 'stop22';
  s.players[0].trail = ['start', 'stop22'];
  s.step = { kind: 'roll' };
  s = rollTo(s, 1);
  assert.strictEqual(s.players[0].pts.pay, 3);
});

test('番の始めの全員の適性と職業を記録する（結果のカードで「★が上がった」を見せる）。しごとマスの記録に★', () => {
  let s = game(2);
  place(s, 0, 'a5');
  const p = s.players[0];
  p.job = 0; // イラストレーター（ものづくり・アイデア・気づく力）
  p.apt = [1, 0, 1, 0, 0, 0]; // 気づく力が0 → ★1
  s = rollTo(s, 1); // a6（気づく力の体験マス）
  assert.deepStrictEqual(s.last.before[0], { apt: [1, 0, 1, 0, 0, 0], job: 0 });
  assert.deepStrictEqual(s.last.before[1], { apt: [0, 0, 0, 0, 0, 0], job: null });
  assert.strictEqual(E.stars(s.players[0].apt, 0), 2); // 3つとも1 → ★2
  let t = game(1);
  place(t, 0, 'stop22');
  t.players[0].job = 0;
  t.players[0].apt = [2, 2, 3, 0, 0, 0]; // ★3
  t = rollTo(t, 2); // e1（しごとマス）を通る
  assert.ok(t.last.msgs.some((m) => m.k === 'pay' && m.n === 3 && m.stars === 3));
});

test('えらぶ体験マス: 出てきた3つの適性から1つ選んで+1（体験の文つき）。どの道でも通る区間にある', () => {
  let s = game(1);
  place(s, 0, 'a2');
  s = rollTo(s, 1); // a3（えらぶ体験マス）
  assert.strictEqual(s.step.kind, 'pick');
  assert.strictEqual(s.step.reason, 'choose');
  assert.strictEqual(s.step.opts.length, 3);
  assert.strictEqual(new Set(s.step.opts).size, 3);
  assert.strictEqual(E.apply(s, { type: 'pick', a: [0, 1, 2, 3, 4, 5].find((a) => !s.step.opts.includes(a)) }).ok, false); // 出ていない適性は選べない
  const a = s.step.opts[1];
  s = act(s, { type: 'pick', a });
  assert.strictEqual(s.players[0].apt[a], 1);
  const m = s.last.msgs.find((x) => x.k === 'apt');
  assert.strictEqual(m.reason, 'choose');
  assert.ok(D.EXP_TEXT.kid[a].includes(m.text));
  assert.strictEqual(s.step.kind, 'ack');
  const chooses = D.NODES.filter((n) => n.type === 'choose').map((n) => n.id);
  assert.deepStrictEqual(chooses, ['a3', 'b4']);
  chooses.forEach((id) => assert.ok(!D.NODES.find((n) => n.id === id).lane)); // 道（レーン）の中ではない
});

test('★は合う適性3つのうち、いちばん低いもので決まる（そろって1以上=★2、2以上=★3、3以上=★4）', () => {
  const j = 0; // イラストレーター（ものづくり・アイデア・気づく力）
  assert.strictEqual(E.stars([0, 0, 2, 0, 0, 0], j), 1);
  assert.strictEqual(E.stars([1, 1, 1, 0, 0, 0], j), 2);
  assert.strictEqual(E.stars([2, 2, 2, 0, 0, 0], j), 3);
  assert.strictEqual(E.stars([3, 3, 3, 0, 0, 0], j), 4);
  assert.strictEqual(E.stars([5, 5, 5, 0, 0, 0], j), 4);
  // ほかが高くても、1つ低ければ★は上がらない（オーナーの試遊の指摘）
  assert.strictEqual(E.stars([5, 1, 5, 0, 0, 0], j), 2);
  assert.strictEqual(E.stars([5, 0, 5, 0, 0, 0], j), 1);
  // 合う適性でないものは関係ない
  assert.strictEqual(E.stars([1, 1, 1, 5, 5, 5], j), 2);
});

test('つぎの★までに足りない適性と、職業の並び順', () => {
  const j = 0;
  assert.deepStrictEqual(E.nextStar([5, 1, 2, 0, 0, 0], j), { to: 3, level: 2, lack: [{ a: 1, n: 1 }] });
  assert.deepStrictEqual(E.nextStar([0, 0, 0, 0, 0, 0], j), { to: 2, level: 1, lack: [{ a: 2, n: 1 }, { a: 0, n: 1 }, { a: 1, n: 1 }] });
  assert.strictEqual(E.nextStar([3, 3, 3, 0, 0, 0], j), null);
  const opts = E.jobOptions([5, 0, 0, 0, 0, 0]);
  assert.strictEqual(opts.length, D.JOBS.length);
  for (let i = 1; i < opts.length; i++) {
    const a = opts[i - 1];
    const b = opts[i];
    assert.ok(a.stars > b.stars || (a.stars === b.stars && a.need <= b.need));
  }
  // ★が同じなら、つぎの★に近いほうが先（イラストレーターはものづくりあと1で★3、写真家は2つ足りない）
  const o2 = E.jobOptions([2, 2, 1, 0, 0, 1]);
  const at = (id) => o2.findIndex((o) => o.id === id);
  assert.strictEqual(o2[at(0)].stars, o2[at(2)].stars);
  assert.ok(at(0) < at(2));
});

test('学びの道から18さいの節目: 好きな適性+1と1ポイント → 道を選ぶ', () => {
  let s = game(1);
  place(s, 0, 'cs5');
  s.players[0].lanes.c = 'cs';
  s = rollTo(s, 4);
  assert.strictEqual(s.players[0].node, 'stop18');
  assert.strictEqual(s.players[0].pts.event, D.STUDY_BONUS.stop18.pts);
  assert.strictEqual(s.step.kind, 'pick');
  assert.strictEqual(s.step.opts.length, 6);
  s = act(s, { type: 'pick', a: 4 });
  assert.strictEqual(s.players[0].apt[4], 1);
  assert.strictEqual(s.step.kind, 'route');
});

test('しごとの道から学びの道へ: 仕事はいったんお休み → 22さいで選び直す', () => {
  let s = game(1);
  place(s, 0, 'cw5');
  s.players[0].lanes.c = 'cw';
  s.players[0].job = 3;
  s = rollTo(s, 1);
  assert.strictEqual(s.step.kind, 'route'); // しごとの道から来たので適性のボーナスはない
  s = act(s, { type: 'route', choice: 0 });
  assert.strictEqual(s.players[0].job, null);
  assert.strictEqual(s.players[0].prevJob, 3);
  s = act(s, { type: 'ack' });
  place(s, 0, 'ds5');
  s.players[0].lanes.d = 'ds';
  s.step = { kind: 'roll' };
  s = rollTo(s, 3);
  assert.strictEqual(s.players[0].node, 'stop22');
  assert.strictEqual(s.step.kind, 'pick'); // 学びの道のボーナス（2つ）
  s = act(s, { type: 'pick', a: 0 });
  assert.strictEqual(s.step.kind, 'pick');
  s = act(s, { type: 'pick', a: 1 });
  assert.strictEqual(s.step.kind, 'job');
  assert.strictEqual(s.step.keep, false);
});

test('道の選び直し: しごとを選んで職業のカードまで進んでも、学びの道にもどせる', () => {
  let s = game(1);
  place(s, 0, 'b4');
  s = rollTo(s, 6);
  assert.strictEqual(s.step.kind, 'route');
  s = act(s, { type: 'route', choice: 1 }); // しごと
  assert.strictEqual(s.step.kind, 'job');
  s = act(s, { type: 'reroute' });
  assert.strictEqual(s.step.kind, 'route');
  assert.strictEqual(s.players[0].lanes.c, undefined);
  assert.strictEqual(s.players[0].routeNext.stop15, undefined);
  assert.ok(!s.last.msgs.some((m) => m.k === 'route'));
  s = act(s, { type: 'route', choice: 0 }); // 学び（高校）
  assert.strictEqual(s.step.kind, 'ack');
  assert.strictEqual(s.players[0].lanes.c, 'cs');
  assert.strictEqual(s.last.msgs.filter((m) => m.k === 'route').length, 1);
});

test('道の選び直し: 「できごと」の記録は道を選ぶ前とまったく同じにもどる（記録が300件で古い順に消えていても）', () => {
  const run = (fill) => {
    let s = game(1);
    place(s, 0, 'b4');
    s = rollTo(s, 6); // 15さいの節目
    if (fill) s.log = Array.from({ length: 300 }, (_, k) => ({ n: 0, p: 0, text: `むかしの記録 ${k + 1}` })); // 上限いっぱい
    const before = JSON.parse(JSON.stringify(s.log));
    s = act(s, { type: 'route', choice: 1 }); // しごと
    s = act(s, { type: 'job', job: 12 }); // 料理人
    assert.ok(s.log.some((x) => x.text.startsWith('料理人になった')));
    s = act(s, { type: 'reroute' }); // 結果のカードから選び直す
    assert.deepStrictEqual(s.log, before);
    s = act(s, { type: 'route', choice: 0 }); // 学び（高校）
    const texts = s.log.map((x) => x.text);
    assert.ok(!texts.some((t) => t.includes('しごとの道へ') || t.startsWith('料理人になった') || t === '道を選び直す'));
    assert.strictEqual(texts[texts.length - 1], '学びの道へ');
    if (fill) {
      assert.strictEqual(s.log.length, 300);
      assert.strictEqual(texts[0], 'むかしの記録 2'); // 「学びの道へ」の1件ぶんだけ古い順に消える
    } else assert.deepStrictEqual(s.log.slice(0, -1), before);
  };
  run(false);
  run(true);
});

test('職業についた記録は★でなく、しごとマスのポイントで書く', () => {
  let s = game(1);
  place(s, 0, 'b4');
  s.players[0].apt = [1, 1, 1, 0, 0, 0];
  s = rollTo(s, 6);
  s = act(s, { type: 'route', choice: 1 });
  s = act(s, { type: 'job', job: 0 }); // イラストレーター（3つとも1 → しごとマスで +2）
  const t = s.log.find((x) => x.text.startsWith('イラストレーターになった')).text;
  assert.strictEqual(t, 'イラストレーターになった（しごとマスで +2）');
});

test('古い保存の形をそろえる: 目標の職業と記録の★を消す。元の状態は変えない', () => {
  let s = game(2);
  s = rollTo(s, 1);
  const old = JSON.parse(JSON.stringify(s));
  old.players[0].goal = 3;
  old.players[1].goal = null;
  old.log.push({ n: 1, p: 0, text: '目標の職業を写真家にした' }, { n: 1, p: 0, text: '料理人になった（★3）' }, { n: 1, p: 1, text: 'サイコロ 2' });
  const before = JSON.stringify(old);
  const m = E.migrate(old);
  assert.strictEqual(JSON.stringify(old), before);
  assert.ok(m.players.every((p) => !('goal' in p)));
  const texts = m.log.map((x) => x.text);
  assert.ok(!texts.some((t) => t.startsWith('目標の職業を')));
  assert.ok(texts.includes(`料理人になった（しごとマスで +${D.STAR_PAY[2]}）`));
  assert.ok(texts.includes('サイコロ 2'));
  assert.strictEqual(m.step.kind, 'ack'); // a1（体験）に止まったあと
  assert.ok(E.apply(m, { type: 'ack' }).ok); // そろえたあとも遊べる
  // last.before がない（前の形の）状態でもそのまま使える
  delete m.last.before;
  assert.ok(E.migrate(m));
  // 道を選んでいる途中で保存した古い形（routeUndo に記録の写しがない・その中の人に goal がある）
  let r = game(1);
  place(r, 0, 'b4');
  r = rollTo(r, 6);
  r = act(r, { type: 'route', choice: 1 });
  r = act(r, { type: 'job', job: 12 });
  const oldMid = JSON.parse(JSON.stringify(r));
  delete oldMid.routeUndo.log;
  oldMid.routeUndo.player.goal = 2;
  oldMid.players[0].goal = 2;
  const mm = E.migrate(oldMid);
  assert.strictEqual(mm.routeUndo, null); // 選び直しはできない（記録をもどせないので）
  assert.strictEqual(E.apply(mm, { type: 'reroute' }).ok, false);
  assert.ok(!('goal' in mm.players[0]));
  assert.ok(E.apply(mm, { type: 'ack' }).ok); // 道はそのままで先に進める
  // いまの形の途中の保存は、そろえても選び直せる
  const nowMid = E.migrate(r);
  assert.ok(Array.isArray(nowMid.routeUndo.log));
  assert.ok(E.apply(nowMid, { type: 'reroute' }).ok);
});

test('道の選び直し: 職業を選んだあとや学びの道を選んだあとの結果のカードでも、その番のうちならできる', () => {
  // 18さいで仕事がある人が学びの道 → 仕事がお休み → 選び直すと仕事がもどる
  let s = game(1);
  place(s, 0, 'cw5');
  s.players[0].lanes.c = 'cw';
  s.players[0].job = 3;
  s = rollTo(s, 1);
  s = act(s, { type: 'route', choice: 0 });
  assert.strictEqual(s.players[0].job, null);
  assert.strictEqual(s.step.kind, 'ack');
  s = act(s, { type: 'reroute' });
  assert.strictEqual(s.players[0].job, 3);
  assert.strictEqual(s.players[0].prevJob, null);
  assert.strictEqual(s.step.kind, 'route');
  s = act(s, { type: 'route', choice: 1 });
  assert.strictEqual(s.step.kind, 'job');
  assert.strictEqual(s.step.keep, true);
  // しごとを選んで職業まで決めたあとでも、結果のカードなら選び直せる
  let t = game(1);
  place(t, 0, 'b4');
  t = rollTo(t, 6);
  t = act(t, { type: 'route', choice: 1 });
  t = act(t, { type: 'job', job: 12 });
  assert.strictEqual(t.players[0].job, 12);
  t = act(t, { type: 'reroute' });
  assert.strictEqual(t.players[0].job, null);
  assert.strictEqual(t.step.kind, 'route');
});

test('道の選び直しは、節目の番のうちだけ（ほかの場面・番が終わったあとはできない）', () => {
  let s = game(2);
  place(s, 0, 'a5');
  s = rollTo(s, 1); // a6（体験）
  assert.strictEqual(s.step.kind, 'ack');
  assert.strictEqual(E.apply(s, { type: 'reroute' }).ok, false);
  let t = game(2);
  place(t, 0, 'b4');
  t = rollTo(t, 6);
  t = act(t, { type: 'route', choice: 0 });
  t = act(t, { type: 'ack' }); // 番が終わる
  assert.strictEqual(t.cur, 1);
  assert.strictEqual(E.apply(t, { type: 'reroute' }).ok, false);
  // 22さいの職業選びは道を選んでいないので、選び直しの対象にならない
  let u = game(1);
  place(u, 0, 'dw5');
  u.players[0].lanes.d = 'dw';
  u.players[0].job = 5;
  u = rollTo(u, 2);
  assert.strictEqual(u.step.kind, 'job');
  assert.strictEqual(E.apply(u, { type: 'reroute' }).ok, false);
});

test('22さい: 仕事がある人は続けられる', () => {
  let s = game(1);
  place(s, 0, 'dw5');
  s.players[0].lanes.d = 'dw';
  s.players[0].job = 5;
  s = rollTo(s, 2);
  assert.strictEqual(s.step.kind, 'job');
  assert.strictEqual(s.step.keep, true);
  s = act(s, { type: 'job', job: 'keep' });
  assert.strictEqual(s.players[0].job, 5);
});

test('イベントでもどる: ふつうは言われた数だけ', () => {
  let s = game(1);
  const p = s.players[0];
  place(s, 0, 'stop15');
  p.trail = ['start', 'stop15'];
  p.routeNext.stop15 = 'cs1';
  p.lanes.c = 'cs';
  s.decks.youth = [D.DECKS.youth.findIndex((c) => c.e.t === 'move' && c.e.n === -2)];
  s = rollTo(s, 3); // cs1 → cs2 → cs3（イベント）→ 2マスもどる
  assert.strictEqual(s.players[0].node, 'cs1');
  assert.strictEqual(s.step.kind, 'ack'); // もどった先のマスの効果は起きない
});

test('イベントでもどる: 節目より前へはもどらない', () => {
  const idx = D.DECKS.youth.push({ text: 'テスト用', e: { t: 'move', n: -5 } }) - 1;
  try {
    let s = game(1);
    const p = s.players[0];
    place(s, 0, 'stop18');
    p.trail = ['start', 'stop15', 'cw5', 'stop18'];
    p.routeNext.stop18 = 'dw1';
    p.lanes.d = 'dw';
    p.job = 0;
    s.decks.youth = [idx];
    s = rollTo(s, 2); // dw1 → dw2（イベント）→ 5マスもどる → 節目で止まる
    assert.strictEqual(s.players[0].node, 'stop18');
    const m = s.last.msgs.find((x) => x.k === 'move');
    assert.strictEqual(m.n, -2);
    assert.strictEqual(m.blocked, true);
  } finally {
    D.DECKS.youth.splice(idx, 1);
  }
});

test('イベントで進む: 言われた数だけ進み、進んだ先の効果は起きない', () => {
  let s = game(1);
  place(s, 0, 'bs1');
  s.decks.kid = [D.DECKS.kid.findIndex((c) => c.e.t === 'move' && c.e.n === 2)];
  s = rollTo(s, 1); // bs2（イベント）→ 2マス進む → bs3 → b3（なかま）
  assert.strictEqual(s.players[0].node, 'b3');
  assert.strictEqual(s.step.kind, 'ack');
});

test('イベントで進む: 分かれ道では方向を聞く・節目では止まって道を選ぶ', () => {
  const idx = D.DECKS.kid.push({ text: 'テスト用', e: { t: 'move', n: 5 } }) - 1;
  const idxA = D.DECKS.adult.push({ text: 'テスト用', e: { t: 'move', n: 5 } }) - 1;
  try {
    let u = game(1);
    place(u, 0, 'e1');
    u.players[0].job = 0;
    u.players[0].apt = [2, 2, 2, 0, 0, 0]; // ★3
    u.decks.adult = [idxA];
    u = rollTo(u, 1); // e2（イベント）→ 5マス進む → e3（分かれ道）で方向を聞く
    assert.strictEqual(u.step.kind, 'fork');
    assert.strictEqual(u.step.mode, 'event');
    u = act(u, { type: 'fork', choice: 0 }); // 近道: es1（しごと）, es2, es3, e4（しごと）
    assert.strictEqual(u.players[0].node, 'e4');
    assert.strictEqual(u.step.kind, 'ack'); // イベントで進んだ先の効果は起きない
    assert.strictEqual(u.players[0].pts.pay, 6); // 通ったしごとマス2つ × ★3
    let v = game(1);
    place(v, 0, 'bl3');
    v.decks.kid = [idx];
    v = rollTo(v, 1); // bl4（イベント）→ 5マス進む → bl5, b3, b4, stop15 で止まる
    assert.strictEqual(v.players[0].node, 'stop15');
    assert.strictEqual(v.step.kind, 'route');
  } finally {
    D.DECKS.kid.splice(idx, 1);
    D.DECKS.adult.splice(idxA, 1);
  }
});

test('なかまマス: 2人とも+1。休みの人をさそうと休みがなくなる', () => {
  let s = game(3);
  place(s, 0, 'a3'); // 次が a4（なかま・協力する力）
  s.players[2].skip = 1;
  s = rollTo(s, 1);
  assert.strictEqual(s.step.kind, 'friend');
  assert.strictEqual(E.apply(s, { type: 'friend', pid: 0 }).ok, false); // 自分はさそえない
  s = act(s, { type: 'friend', pid: 2 });
  assert.strictEqual(s.players[0].apt[4], 1);
  assert.strictEqual(s.players[2].apt[4], 1);
  assert.strictEqual(s.players[2].skip, 0);
});

test('1人のときのなかまマスは自分だけ+1', () => {
  let s = game(1);
  place(s, 0, 'a3');
  s = rollTo(s, 1);
  assert.strictEqual(s.step.kind, 'ack');
  assert.strictEqual(s.players[0].apt[4], 1);
});

test('1回休み: その人の番は「休み」だけで次の人へ', () => {
  let s = game(2);
  s.players[1].skip = 1;
  place(s, 0, 'a5');
  s = rollTo(s, 1); // a6（体験）
  s = ackAll(s);
  assert.strictEqual(s.cur, 1);
  assert.strictEqual(s.step.kind, 'skip');
  s = act(s, { type: 'ack' });
  assert.strictEqual(s.players[1].skip, 0);
  assert.strictEqual(s.cur, 0);
  assert.strictEqual(s.round, 2);
});

test('ゴール: 順番にボーナス。全員ゴールで結果、同点は同じ順位', () => {
  let s = game(2);
  place(s, 0, 'e6');
  s.players[0].job = 0;
  s = rollTo(s, 6);
  assert.strictEqual(s.players[0].done, true);
  assert.strictEqual(s.players[0].rank, 1);
  assert.strictEqual(s.players[0].pts.bonus, D.GOAL_BONUS[0]);
  s = act(s, { type: 'ack' });
  assert.strictEqual(s.cur, 1);
  place(s, 1, 'e6');
  s.players[1].job = 0;
  // 合計を同じにする
  s.players[1].pts.event = s.players[0].pts.pay + s.players[0].pts.event + D.GOAL_BONUS[0] - D.GOAL_BONUS[1];
  s = rollTo(s, 6);
  s = act(s, { type: 'ack' });
  assert.strictEqual(s.phase, 'results');
  assert.strictEqual(s.results[0].place, 1);
  assert.strictEqual(s.results[1].place, 1);
});

test('ゴールした人は応援できる（+1）。まだの人は応援できない', () => {
  let s = game(3);
  s.players[1].done = true;
  s.players[1].rank = 1;
  place(s, 0, 'a1');
  assert.strictEqual(E.apply(s, { type: 'roll', cheer: 2 }).ok, false);
  assert.strictEqual(E.apply(s, { type: 'roll', cheer: 0 }).ok, false);
  s = rollTo(s, 1, 1);
  assert.strictEqual(s.last.cheer, 1);
  assert.strictEqual(s.players[0].node, 'a3');
});

test('ゴールした人の番は飛ばす', () => {
  let s = game(3);
  s.players[1].done = true;
  s.players[1].rank = 1;
  place(s, 0, 'a5');
  s = rollTo(s, 1); // a6（体験）
  s = ackAll(s);
  assert.strictEqual(s.cur, 2);
});

test('進行役が終えると、まだの人はゴールに近い順に続きの順位', () => {
  let s = game(3);
  place(s, 0, 'a1');
  place(s, 1, 'e6');
  place(s, 2, 'b1');
  s = act(s, { type: 'end' });
  assert.strictEqual(s.phase, 'results');
  assert.strictEqual(s.players[1].rank, 1);
  assert.strictEqual(s.players[2].rank, 2);
  assert.strictEqual(s.players[0].rank, 3);
  assert.strictEqual(E.apply(s, { type: 'end' }).ok, false);
});

test('途中で終えたとき、ゴールまでのマス数が同じ人は同じ順位・同じボーナス', () => {
  let s = game(3);
  ['e4', 'e4', 'e4'].forEach((n, i) => place(s, i, n));
  const all = act(s, { type: 'end' });
  assert.deepStrictEqual(all.players.map((p) => p.rank), [1, 1, 1]);
  assert.deepStrictEqual(all.players.map((p) => p.pts.bonus), [D.GOAL_BONUS[0], D.GOAL_BONUS[0], D.GOAL_BONUS[0]]);
  let t = game(3);
  place(t, 0, 'a1');
  place(t, 1, 'e4');
  place(t, 2, 'e4');
  const r = act(t, { type: 'end' });
  assert.deepStrictEqual(r.players.map((p) => p.rank), [3, 1, 1]); // 同じ2人は1位、次は3位
  assert.deepStrictEqual(r.players.map((p) => p.pts.bonus), [D.GOAL_BONUS[2], D.GOAL_BONUS[0], D.GOAL_BONUS[0]]);
  // もうゴールした人がいれば、その次の順位から
  let u = game(3);
  u.players[0].done = true;
  u.players[0].rank = 1;
  u.finished = 1;
  place(u, 1, 'e4');
  place(u, 2, 'e4');
  const v = act(u, { type: 'end' });
  assert.deepStrictEqual(v.players.map((p) => p.rank), [1, 2, 2]);
});

test('でたらめな値は例外にせず、拒否で返す', () => {
  const bad = ['map', -1, 1.5, '1', null, {}, [], 99, 'keep'];
  const make = (step) => { const s = game(3); s.step = step; return s; };
  const cases = [
    [{ kind: 'route', node: 'stop15' }, (v) => ({ type: 'route', choice: v })],
    [{ kind: 'job', reason: 'adult', keep: false }, (v) => ({ type: 'job', job: v })],
    [{ kind: 'friend', apt: 1 }, (v) => ({ type: 'friend', pid: v })],
    [{ kind: 'vote', opts: [{ label: 'x', a: 1 }] }, (v) => ({ type: 'vote', opt: v })],
    [{ kind: 'pick', opts: [0, 1, 2], reason: 'event' }, (v) => ({ type: 'pick', a: v })],
    [{ kind: 'roll' }, (v) => ({ type: 'roll', cheer: v })],
    [{ kind: 'mini', game: 'janken' }, (v) => ({ type: 'mini', picks: v })],
    [{ kind: 'mini', game: 'sum', target: 5 }, (v) => ({ type: 'mini', picks: { 0: v, 1: 1, 2: 1 } })],
  ];
  cases.forEach(([step, mk]) => bad.forEach((v) => {
    let r;
    assert.doesNotThrow(() => { r = E.apply(make(step), mk(v)); }, `${step.kind} ${JSON.stringify(v)}`);
    // 応援の null・じゃんけんの値なし（{}・null）は「応援なし」「今回は参加なし」として受け付けてよい
    const okAllowed = (step.kind === 'roll' && v == null) || (step.kind === 'mini' && step.game === 'janken');
    if (!okAllowed) assert.strictEqual(r.ok, false, `${step.kind} ${JSON.stringify(v)} を受け付けてしまった`);
  }));
});

test('上限の人には増えなかったことを記録する（なかま・みんなで決める・みんなでサイコロ）', () => {
  let s = game(2);
  s.players[0].apt[1] = D.APT_CAP;
  s.players[1].apt[1] = D.APT_CAP;
  s.step = { kind: 'friend', apt: 1 };
  s = act(s, { type: 'friend', pid: 1 });
  const f = s.last.msgs.find((m) => m.k === 'friend');
  assert.strictEqual(f.n, 0);
  assert.strictEqual(f.n2, 0);
  let v = game(3);
  v.players[2].apt[4] = D.APT_CAP;
  v.step = { kind: 'vote', opts: [{ label: 'x', a: 4 }] };
  v = act(v, { type: 'vote', opt: 0 });
  assert.deepStrictEqual(v.last.msgs.find((m) => m.k === 'vote').capped, [2]);
  let c = game(2);
  c.players[0].apt[4] = D.APT_CAP;
  c.step = { kind: 'coop', reward: { t: 'apt', a: 4 }, target: 2 }; // 目標2なら必ず成功
  c = act(c, { type: 'coop' });
  const m = c.last.msgs.find((x) => x.k === 'coop');
  assert.strictEqual(m.ok, true);
  assert.deepStrictEqual(m.capped, [0]);
});

test('みんなでサイコロ: 目標以上なら全員にごほうび', () => {
  let s = game(2);
  s.step = { kind: 'coop', reward: { t: 'pts', n: 2 }, target: E.coopTarget(s) };
  assert.strictEqual(s.step.target, 7);
  let found = null;
  for (let r = 1; r < 500 && !found; r++) {
    const t = JSON.parse(JSON.stringify(s));
    t.rng = r;
    const out = act(t, { type: 'coop' });
    const m = out.last.msgs.find((x) => x.k === 'coop');
    if (m.ok) found = out;
  }
  assert.ok(found);
  assert.strictEqual(found.players[0].pts.event, 2);
  assert.strictEqual(found.players[1].pts.event, 2);
});

test('みんなで決める: 全員その適性+1', () => {
  let s = game(3);
  s.step = { kind: 'vote', opts: D.DECKS.kid.find((c) => c.e.t === 'vote').e.opts };
  s = act(s, { type: 'vote', opt: 2 });
  const a = D.DECKS.kid.find((c) => c.e.t === 'vote').e.opts[2].a;
  s.players.forEach((p) => assert.strictEqual(p.apt[a], 1));
});

test('もう1回: 同じ人がもう一度ふる', () => {
  let s = game(2);
  s.again = true;
  s.step = { kind: 'ack' };
  s = act(s, { type: 'ack' });
  assert.strictEqual(s.cur, 0);
  assert.strictEqual(s.step.kind, 'roll');
});

test('適性は上限でとまる', () => {
  let s = game(2);
  s.players[0].apt[4] = D.APT_CAP;
  s.step = { kind: 'vote', opts: [{ label: 'x', a: 4 }] };
  s = act(s, { type: 'vote', opt: 0 });
  assert.strictEqual(s.players[0].apt[4], D.APT_CAP);
});

test('表示の切り替え（学校名／年齢）はいつでもできる', () => {
  let s = game(1);
  s = act(s, { type: 'labels', labels: 'age' });
  assert.strictEqual(s.settings.labels, 'age');
  s = act(s, { type: 'labels', labels: 'anything' });
  assert.strictEqual(s.settings.labels, 'school');
});

test('盤面: すべてのマスからゴールに着ける・節目は3つ・分かれ道は2つ', () => {
  const ids = D.NODES.map((n) => n.id);
  D.NODES.forEach((n) => {
    assert.ok(E.DIST[n.id] !== undefined, n.id + ' からゴールに着けない');
    n.next.forEach((m) => assert.ok(ids.includes(m)));
  });
  assert.strictEqual(D.NODES.filter((n) => n.type === 'stop').length, 3);
  assert.strictEqual(D.NODES.filter((n) => n.fork).length, 2);
  // 16〜22さいの道は、どちらを選んでも同じ長さ
  const lane = (k) => D.NODES.filter((n) => n.lane === k).length;
  assert.strictEqual(lane('cs'), lane('cw'));
  assert.strictEqual(lane('ds'), lane('dw'));
});

test('ミニゲームマスは共通の区間に3つ（どの道を通っても同じ数だけ通る）', () => {
  const minis = D.NODES.filter((n) => n.type === 'mini');
  assert.deepStrictEqual(minis.map((n) => n.id).sort(), ['a5', 'b2', 'e5']);
  minis.forEach((n) => {
    assert.ok(!n.lane, n.id + ' が道の片方にある');
    assert.ok(!/^(bs|bl|es|el)/.test(n.id), n.id + ' が近道・寄り道の片方にある');
  });
});

test('ミニゲームマスに止まると全員のミニゲーム → 結果のカード', () => {
  let s = game(3);
  place(s, 0, 'a4');
  s = rollTo(s, 1);
  assert.strictEqual(s.players[0].node, 'a5');
  assert.strictEqual(s.step.kind, 'mini');
  assert.ok(['hilo', 'janken', 'sum'].includes(s.step.game));
  const opts = { hilo: 'hi', janken: 'g', sum: 1 };
  const picks = { 0: opts[s.step.game], 1: opts[s.step.game], 2: opts[s.step.game] };
  s = act(s, { type: 'mini', picks });
  assert.strictEqual(s.step.kind, 'ack');
  assert.ok(s.last.msgs.some((m) => m.k === 'mini'));
});

test('大きい？小さい？: 当たった人に+1。予想しなかった人はなし。同じ数なら全員+1', () => {
  let s = game(3);
  s.step = { kind: 'mini', game: 'hilo', base: 3 };
  const t = forceDie(JSON.parse(JSON.stringify(s)), 5);
  const r = act(t, { type: 'mini', picks: { 0: 'hi', 1: 'lo' } });
  assert.deepStrictEqual(r.players.map((p) => p.pts.mini), [1, 0, 0]);
  const m = r.last.msgs.find((x) => x.k === 'mini');
  assert.strictEqual(m.roll, 5);
  assert.deepStrictEqual(m.winners, [0]);
  const u = forceDie(JSON.parse(JSON.stringify(s)), 3);
  const r2 = act(u, { type: 'mini', picks: { 0: 'hi' } });
  assert.deepStrictEqual(r2.players.map((p) => p.pts.mini), [1, 1, 1]);
  assert.strictEqual(r2.last.msgs.find((x) => x.k === 'mini').tie, true);
});

test('大きい？小さい？の基準の数は2〜5', () => {
  const bases = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    let s = newG({ names: ['a', 'b'], seed });
    s.miniDeck = ['hilo'];
    place(s, 0, 'a4');
    s = rollTo(s, 1, undefined, seed);
    bases.add(s.step.base);
    assert.strictEqual(s.step.game, 'hilo');
    assert.ok(s.step.base >= 2 && s.step.base <= 5);
  }
  assert.deepStrictEqual([...bases].sort(), [2, 3, 4, 5]);
});

test('じゃんけん: コンピューターに勝った人に+1、あいこは記録だけ', () => {
  let s = game(3);
  s.step = { kind: 'mini', game: 'janken' };
  forceRand(s, 0, 1 / 3); // コンピューターはグー
  s = act(s, { type: 'mini', picks: { 0: 'p', 1: 'g', 2: 'c' } });
  const m = s.last.msgs.find((x) => x.k === 'mini');
  assert.strictEqual(m.cpu, 'g');
  assert.deepStrictEqual(m.winners, [0]);
  assert.deepStrictEqual(m.draws, [1]);
  assert.deepStrictEqual(s.players.map((p) => p.pts.mini), [1, 0, 0]);
});

test('合計ピッタリ: 全員の数が要る。合計が目標と同じなら全員+1', () => {
  let s = game(2);
  s.step = { kind: 'mini', game: 'sum', target: 5 };
  assert.strictEqual(E.apply(s, { type: 'mini', picks: { 0: 2 } }).ok, false);
  const ok = act(s, { type: 'mini', picks: { 0: 2, 1: 3 } });
  assert.deepStrictEqual(ok.players.map((p) => p.pts.mini), [1, 1]);
  assert.strictEqual(ok.last.msgs.find((x) => x.k === 'mini').ok, true);
  const ng = act(s, { type: 'mini', picks: { 0: 1, 1: 1 } });
  assert.deepStrictEqual(ng.players.map((p) => p.pts.mini), [0, 0]);
  assert.strictEqual(ng.last.msgs.find((x) => x.k === 'mini').total, 2);
});

test('合計ピッタリの目標は「全員1」「全員3」の端を除いた範囲', () => {
  for (let n = 2; n <= 6; n++) {
    for (let seed = 1; seed <= 25; seed++) {
      let s = newG({ names: Array.from({ length: n }, (_, i) => 'P' + i), seed });
      s.miniDeck = ['sum'];
      place(s, 0, 'a4');
      s = rollTo(s, 1, undefined, seed);
      assert.strictEqual(s.step.game, 'sum');
      assert.ok(s.step.target >= n + 1 && s.step.target <= 3 * n - 1, `n=${n} target=${s.step.target}`);
    }
  }
});

test('ミニゲームの選び方がちがうと断る', () => {
  const s = game(2);
  s.step = { kind: 'mini', game: 'janken' };
  assert.strictEqual(E.apply(s, { type: 'mini', picks: { 0: 'x' } }).ok, false);
  s.step = { kind: 'mini', game: 'sum', target: 4 };
  assert.strictEqual(E.apply(s, { type: 'mini', picks: { 0: 4, 1: 1 } }).ok, false);
});

test('1人のときは合計ピッタリが出ない・3つは順番に出る', () => {
  const seen = new Set();
  for (let k = 0; k < 40; k++) {
    let s = newG({ names: ['ひとり'], seed: k + 1 });
    place(s, 0, 'a4');
    s = rollTo(s, 1, undefined, k); // 毎回ちがう乱数の値で1を出す
    seen.add(s.step.game);
  }
  assert.ok(!seen.has('sum'));
  assert.ok(seen.has('hilo') && seen.has('janken'));
  // 3人: 3回続けて止まると、3つが1回ずつ出る
  let s = game(3);
  const got = [];
  for (let i = 0; i < 3; i++) {
    place(s, 0, 'a4');
    s.step = { kind: 'roll' };
    s.cur = 0;
    s = rollTo(s, 1);
    got.push(s.step.game);
    const opts = { hilo: 'hi', janken: 'g', sum: 1 };
    s = act(s, { type: 'mini', picks: { 0: opts[s.step.game], 1: opts[s.step.game], 2: opts[s.step.game] } });
  }
  assert.deepStrictEqual(got.slice().sort(), ['hilo', 'janken', 'sum']);
});

test('ミニゲームの点は合計に入る', () => {
  const s = game(2);
  s.players[0].pts.mini = 3;
  assert.strictEqual(E.total(s.players[0]), 3);
  const r = act(s, { type: 'end' });
  assert.strictEqual(r.results.find((x) => x.pid === 0).total, 3 + r.players[0].pts.bonus);
});

test('サイコロの遊び方の既定は「2つから選ぶ」。1つも選べる', () => {
  assert.strictEqual(E.newGame({ names: ['a'], seed: 1 }).settings.dice, 2);
  assert.strictEqual(E.newGame({ names: ['a'], seed: 1, dice: 1 }).settings.dice, 1);
});

test('サイコロ2つ: 振ると2つの目が出て、選んだ目で進む（応援の+1は選んだ目に足す）', () => {
  let s = E.newGame({ names: ['a', 'b'], seed: 3, dice: 2 });
  place(s, 0, 'a1');
  forceDice(s, 2, 5);
  s = act(s, { type: 'roll' });
  assert.strictEqual(s.step.kind, 'dice');
  assert.deepStrictEqual(s.step.dice, [2, 5]);
  assert.strictEqual(s.players[0].node, 'a1'); // まだ進まない
  assert.strictEqual(E.apply(s, { type: 'dice', pick: 2 }).ok, false);
  const r = act(s, { type: 'dice', pick: 1 }); // 5で進む: a2, a3, a4, a5, a6
  assert.strictEqual(r.players[0].node, 'a6');
  assert.strictEqual(r.last.roll, 5);
  // 応援
  let t = E.newGame({ names: ['a', 'b'], seed: 3, dice: 2 });
  t.players[1].done = true;
  t.players[1].rank = 1;
  place(t, 0, 'a1');
  forceDice(t, 2, 5);
  t = act(t, { type: 'roll', cheer: 1 });
  t = act(t, { type: 'dice', pick: 0 }); // 2+1=3: a2, a3, a4
  assert.strictEqual(t.players[0].node, 'a4');
});

test('進む先の見通し: 止まるマス・分かれ道・節目・ゴール（状態は変えない）', () => {
  const s = game(1);
  const look = (node, steps, job) => {
    place(s, 0, node);
    s.players[0].job = job == null ? null : job;
    const before = JSON.stringify(s);
    const r = E.previewMove(s, steps);
    assert.strictEqual(JSON.stringify(s), before, '見通しで状態が変わった');
    return r;
  };
  assert.deepStrictEqual(look('a1', 2), { node: 'a3', kind: 'land', exactPay: false, pass: 0 });
  assert.deepStrictEqual(look('b1', 3), { node: 'b2', kind: 'fork', left: 2, pass: 0 });
  assert.deepStrictEqual(look('b3', 6), { node: 'stop15', kind: 'stop', pass: 0 });
  assert.deepStrictEqual(look('e6', 4), { node: 'goal', kind: 'goal', pass: 0 });
  assert.deepStrictEqual(look('stop22', 1, 0), { node: 'e1', kind: 'land', exactPay: true, pass: 0 });
  assert.deepStrictEqual(look('stop22', 2, 0), { node: 'e2', kind: 'land', exactPay: false, pass: 1 }); // e1 を通る
  assert.deepStrictEqual(look('stop22', 2), { node: 'e2', kind: 'land', exactPay: false, pass: 0 }); // 職業がなければ数えない
});

test('しごとマスにぴったり止まるとポイント2倍。通っただけなら1回分', () => {
  let s = game(1);
  place(s, 0, 'stop22');
  const p = s.players[0];
  p.job = 0;
  p.apt = [2, 2, 3, 0, 0, 0]; // ★3（しごとマス1つで3ポイント）
  const exact = rollTo(s, 1); // e1（しごとマス）にぴったり
  assert.strictEqual(exact.players[0].pts.pay, 6);
  assert.ok(exact.last.msgs.some((m) => m.k === 'payExact'));
  const pass = rollTo(s, 2); // e1 を通って e2 へ
  assert.strictEqual(pass.players[0].pts.pay, 3);
  // もう払ったしごとマスに止まっても、ぴったりのボーナスはない
  const again = JSON.parse(JSON.stringify(exact));
  again.players[0].node = 'stop22';
  again.players[0].trail = ['start', 'stop22'];
  again.step = { kind: 'roll' };
  const r = rollTo(again, 1);
  assert.strictEqual(r.players[0].pts.pay, 6);
});

test('ランダムな操作で最後まで遊べる（1〜6人・各80ゲーム）', () => {
  for (let n = 1; n <= 6; n++) {
    for (let g = 0; g < 80; g++) {
      let s = newG({ names: Array.from({ length: n }, (_, i) => 'P' + i), seed: g * 31 + n, dice: g % 2 ? 2 : 1 });
      let r = g + 1;
      const pickN = (k) => { r = (r * 1103515245 + 12345) >>> 0; return r % k; };
      let guard = 0;
      while (s.phase === 'play') {
        const st = s.step;
        const p = s.players[s.cur];
        let a;
        switch (st.kind) {
          case 'roll': { const d = s.players.filter((q) => q.done && q.id !== p.id); a = { type: 'roll', cheer: d.length && pickN(2) ? d[0].id : undefined }; break; }
          case 'skip': case 'ack': a = { type: 'ack' }; break;
          case 'dice': a = { type: 'dice', pick: pickN(2) }; break;
          case 'fork': a = { type: 'fork', choice: pickN(2) }; break;
          case 'route': a = { type: 'route', choice: pickN(2) }; break;
          case 'job': a = { type: 'job', job: st.keep && pickN(2) ? 'keep' : pickN(D.JOBS.length) }; break;
          case 'friend': { const o = s.players.filter((q) => q.id !== p.id); a = { type: 'friend', pid: o[pickN(o.length)].id }; break; }
          case 'pick': a = { type: 'pick', a: st.opts[pickN(st.opts.length)] }; break;
          case 'vote': a = { type: 'vote', opt: pickN(st.opts.length) }; break;
          case 'coop': a = { type: 'coop' }; break;
          case 'mini': {
            const opts = { hilo: ['hi', 'lo'], janken: ['g', 'c', 'p'], sum: [1, 2, 3] }[st.game];
            const picks = {};
            s.players.forEach((q) => { if (st.game === 'sum' || pickN(4)) picks[q.id] = opts[pickN(opts.length)]; });
            a = { type: 'mini', picks };
            break;
          }
          default: throw new Error('unknown ' + st.kind);
        }
        // ときどき節目の道を選び直す（職業のカード・結果のカードから）
        if (s.routeUndo && (st.kind === 'ack' || (st.kind === 'job' && (st.reason === 'work15' || st.reason === 'work18'))) && pickN(3) === 0) a = { type: 'reroute' };
        if (pickN(400) === 0) a = { type: 'end' };
        s = act(s, a);
        s.players.forEach((q) => {
          q.apt.forEach((v) => assert.ok(v >= 0 && v <= D.APT_CAP));
          assert.ok(q.pts.pay >= 0 && q.pts.event >= 0 && q.pts.bonus >= 0 && q.pts.mini >= 0);
        });
        if (++guard > 5000) throw new Error('終わらない');
      }
      assert.strictEqual(s.results.length, n);
      assert.ok(s.players.every((q) => q.rank >= 1 && q.rank <= n));
      assert.ok(s.log.every((x) => !x.text.includes('★')), '記録に★が出ている'); // 画面には★を出さない
      // 23さい以降にいる人は必ず職業を持っている（ゴールした人を含む）
      s.players.forEach((q) => { if (E.NODE[q.node].stage === 'adult') assert.ok(q.job != null, 'おとななのに職業がない'); });
    }
  }
});

// ── 実行 ─────────────────────────────────────────
for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log('  ok  ' + t.name);
  } catch (e) {
    console.log('  NG  ' + t.name);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
    process.exitCode = 1;
  }
}
console.log(`\n${passed}/${tests.length} 件合格`);
