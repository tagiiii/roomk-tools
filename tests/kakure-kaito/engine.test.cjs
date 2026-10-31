// かくれ怪盗（試作）のルールのテスト。実行: node drafts/kakure-kaito/tests/engine.test.cjs
const E = require('../../apps/kakure-kaito/engine.js');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ids = (n) => Array.from({ length: n }, (_, i) => 'p' + i);
const ALL = { detective: true, assistant: true, fake: true, disguise: true, lone: true, fifthGo: true };

// 人数と怪盗の数・見回りの人数
for (let n = E.MIN; n <= E.MAX; n += 1) {
  ok(E.TEAM[n].length === 5, 'T1 見回りは5回 ' + n);
  ok(E.TEAM[n].every((s) => s < n), 'T2 見回りの人数は全員より少ない ' + n);
  ok(E.THIEVES[n] < n / 2, 'T3 怪盗は半分より少ない ' + n);
}
ok(E.needFails(7, 3) === 2 && E.needFails(6, 3) === 1 && E.needFails(10, 2) === 1, 'T4 7人以上の4回目だけ2枚');

// 役が入りきるか
ok(E.checkOpts(3, {}) !== '', 'C1 3人ではできない');
ok(E.checkOpts(11, {}) !== '', 'C2 11人ではできない');
ok(E.checkOpts(4, {}) === '', 'C3 4人・名探偵だけはできる');
ok(E.checkOpts(4, ALL) !== '', 'C4 4人で怪盗の役3つは入らない');
ok(E.checkOpts(10, ALL) === '', 'C5 10人なら全部入る');
ok(E.checkOpts(7, ALL) === '', 'C6 7人（怪盗3）なら全部入る');
ok(E.checkOpts(6, ALL) !== '', 'C7 6人（怪盗2）で怪盗の役3つは入らない');
const n1 = E.normOpts({ detective: false, assistant: true, fake: true, disguise: true });
ok(!n1.assistant && !n1.fake && !n1.disguise, 'C8 名探偵なしなら助手・にせ探偵・変装名人も外れる');
ok(!E.normOpts({ assistant: false, fake: true }).fake, 'C9 助手なしならにせ探偵は外れる');

// 配る（たくさんくり返す）
let bossLone = 0;
for (let k = 0; k < 3000; k += 1) {
  const n = E.MIN + (k % (E.MAX - E.MIN + 1));
  const opts = n >= 7 ? ALL : (k % 2 ? { detective: true, assistant: true, fake: true } : { detective: false, lone: true });
  if (E.checkOpts(n, opts)) continue;
  const d = E.deal(ids(n), opts);
  const roles = Object.values(d.roles);
  const thieves = roles.filter((r) => E.sideOf(r) === 'thief').length;
  if (thieves !== E.THIEVES[n]) { ok(false, 'D1 怪盗の数', { n, roles }); break; }
  if (d.order.length !== n || new Set(d.order).size !== n) { ok(false, 'D2 順番に全員が1回ずつ'); break; }
  const o = E.normOpts(opts);
  ['detective', 'assistant', 'fake', 'disguise', 'lone'].forEach((r) => {
    if (roles.filter((x) => x === r).length !== (o[r] ? 1 : 0)) ok(false, 'D3 役の数 ' + r, { n, roles });
  });
  if (o.detective) {
    if (!d.boss || E.sideOf(d.roles[d.boss]) !== 'thief') { ok(false, 'D4 かしらは怪盗'); break; }
    if (d.roles[d.boss] === 'lone' && roles.filter((r) => E.sideOf(r) === 'thief').length > 1) bossLone += 1;
  } else if (d.boss !== null) { ok(false, 'D5 名探偵なしならかしらなし'); break; }

  // 知っていること
  const all = Object.keys(d.roles);
  all.forEach((id) => {
    const r = d.roles[id];
    const k2 = E.knows(d.roles, id);
    if (r === 'detective') {
      const want = all.filter((x) => E.sideOf(d.roles[x]) === 'thief' && d.roles[x] !== 'disguise').sort();
      if (JSON.stringify(k2[0].ids.slice().sort()) !== JSON.stringify(want)) ok(false, 'K1 名探偵は変装名人以外の怪盗を知る');
    } else if (r === 'assistant') {
      const want = all.filter((x) => d.roles[x] === 'detective' || d.roles[x] === 'fake').sort();
      if (JSON.stringify(k2[0].ids.slice().sort()) !== JSON.stringify(want)) ok(false, 'K2 助手は名探偵とにせ探偵を知る');
    } else if (r === 'lone' || r === 'guard') {
      if (k2.length) ok(false, 'K3 ひとり怪盗・警備員は何も知らない', { r, k2 });
    } else if (E.sideOf(r) === 'thief') {
      const want = all.filter((x) => x !== id && E.sideOf(d.roles[x]) === 'thief' && d.roles[x] !== 'lone').sort();
      if (JSON.stringify(k2[0].ids.slice().sort()) !== JSON.stringify(want)) ok(false, 'K4 怪盗は、ひとり怪盗以外の仲間を知る');
    }
  });
}
ok(bossLone === 0, 'D6 ほかに怪盗がいれば、ひとり怪盗はかしらにならない', bossLone);
pass += 1;

// 投票・見回り・勝ち負け
ok(E.approved({ a: true, b: true, c: false }), 'V1 過半数で出発');
ok(!E.approved({ a: true, b: false }), 'V2 同数は出発しない');
ok(!E.approved({ a: false, b: false, c: true }), 'V3 反対が多い');
ok(E.missionResult(5, 0, ['safe', 'safe']).ok, 'M1 すり替えなしは守った');
ok(!E.missionResult(5, 0, ['safe', 'swap']).ok, 'M2 1枚で失敗');
ok(E.missionResult(7, 3, ['safe', 'swap', 'safe', 'safe']).ok, 'M3 7人の4回目は1枚では守れる');
ok(!E.missionResult(7, 3, ['swap', 'swap', 'safe', 'safe']).ok, 'M4 7人の4回目は2枚で失敗');
ok(E.missionResult(5, 0, ['swap', 'safe']).swaps === 1, 'M5 枚数を数える');
ok(E.score([true, true]) === null, 'S1 まだ');
ok(E.score([true, false, true, true]) === 'guard', 'S2 3回守った');
ok(E.score([false, true, false, false]) === 'thief', 'S3 3回すり替え');
ok(E.canSwap('fake') && E.canSwap('lone') && !E.canSwap('detective') && !E.canSwap('guard'), 'S4 すり替えられるのは怪盗チームだけ');

// 話し合いの時間・しらべのルーペ
ok(E.normOpts().talk === 0 && E.normOpts({ talk: 120 }).talk === 120 && E.normOpts({ talk: 45 }).talk === 0, 'T1 話し合いの時間は決まった値だけ');
ok(E.normOpts().lens === false, 'L1 ルーペははじめオフ');
ok(!E.lensAfter(0) && E.lensAfter(1) && E.lensAfter(2) && E.lensAfter(3) && !E.lensAfter(4), 'L2 ルーペは2・3・4回目のあと');
ok(E.lensFirst(['a', 'b', 'c', 'd']) === 'd', 'L3 はじめに持つのは最初の主任のひとつ前');
ok(JSON.stringify(E.lensTargets(['a', 'b', 'c', 'd'], ['d', 'b'])) === '["a","c"]', 'L4 一度持った人は確かめられない');
ok(!E.lensOn(6, { lens: true }) && E.lensOn(7, { lens: true }) && !E.lensOn(10, { lens: false }), 'L5 ルーペは7人から・オンのときだけ');

console.log((fail ? 'NG ' : 'OK ') + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
