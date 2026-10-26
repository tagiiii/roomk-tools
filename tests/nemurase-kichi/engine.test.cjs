// ねむらせ基地のルール（engine.js）のテスト。エミュレーター不要。
// 実行: node tests/nemurase-kichi/engine.test.cjs
const E = require('../../apps/nemurase-kichi/engine.js');
let pass = 0;
let fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const fixed = () => 0.1;
const game = (ids, s) => E.newGame(ids, s, fixed);
const roleIds = (g, role) => g.players.filter((id) => g.roles[id] === role);

// マップ: 仕事の場所・スイッチ・はじめの場所に立てて、ひろばから歩いて行ける
[...E.SPOTS, E.FIX_SPOT].forEach((p) => {
  ok(E.canStand(p.x, p.y), '立てる場所 ' + JSON.stringify(p));
  ok(!!E.path({ x: 22, y: 12 }, { x: Math.floor(p.x), y: Math.floor(p.y) }), '行ける場所 ' + JSON.stringify(p));
});
for (let n = E.MIN_PLAYERS; n <= E.MAX_PLAYERS; n++) for (let i = 0; i < n; i++) { const q = E.spawnPoint(i, n); ok(E.canStand(q.x, q.y), 'はじめの場所 ' + n + '-' + i); }
ok(E.step({ x: 2.5, y: 3.5 }, -1, 0, 1).x >= 2 + E.RADIUS - 1e-9, 'かべを通りぬけない');
// 近道: 立てる・行ける・行き先が対になっている・仕事の場所やテーブルと重ならない
E.VENTS.forEach((v) => {
  ok(E.canStand(v.x, v.y), '近道に立てる ' + v.id);
  ok(!!E.path({ x: 22, y: 12 }, { x: Math.floor(v.x), y: Math.floor(v.y) }), '近道に行ける ' + v.id);
  ok(E.VENTS[v.to] && E.VENTS[v.to].to === v.id && v.to !== v.id, '近道の行き先が対 ' + v.id);
  ok(E.SPOTS.every((sp) => E.dist(sp, v) > E.USE_RANGE * 2), '近道が仕事の場所から離れている ' + v.id);
  ok(E.dist(E.FIX_SPOT, v) > E.USE_RANGE * 2 && E.dist(E.TABLE, v) > E.TABLE.r + E.USE_RANGE * 2, '近道がスイッチ・テーブルから離れている ' + v.id);
});
ok(E.VIEW.crew < E.VIEW.sleeper, '隊員の見える広さは、ねむらせ屋よりせまい');
ok(E.DEFAULT_SETTINGS.cooldown === 20 && E.SETTING_OPTS.cooldown.join() === '15,20,30', 'ねむらせる待ち時間のはじめの値と選べる値');

// 位置の形
ok(E.encodePos(12.34, 5.06, -1) === '123,51,0', '位置を短い文字列に');
ok(JSON.stringify(E.decodePos('123,51,0')) === JSON.stringify({ x: 12.3, y: 5.1, face: -1 }), '文字列から位置へ');
['', 'x', '1,2', '1,2,3', '9999,1,1', '-5,1,1'].forEach((t) => ok(E.decodePos(t) === null, 'こわれた位置は読まない ' + t));

// 役と仕事
let g = game(['a', 'b', 'c', 'd'], { tasks: 3 });
ok(roleIds(g, 'sleeper').length === 1, 'ねむらせ屋は1人');
ok(g.players.every((id) => g.tasks[id].length === 3), 'ひとり3つの仕事');
ok(roleIds(game(['a', 'b', 'c', 'd', 'e', 'f'], { sleepers: 2 }), 'sleeper').length === 1, '7人より少ないと、ねむらせ屋は1人');
ok(roleIds(game(['a', 'b', 'c', 'd', 'e', 'f', 'h'], { sleepers: 2 }), 'sleeper').length === 2, '7人なら2人にできる');

// 勝ち負け
g = game(['a', 'b', 'c', 'd'], { tasks: 2 });
const sl = roleIds(g, 'sleeper')[0];
const crew = roleIds(g, 'crew');
ok(!E.checkWin(g), 'はじめは決まらない');
crew.forEach((id) => g.tasks[id].forEach((t) => { t.done = true; }));
ok(E.checkWin(g) && g.winner === 'crew' && g.winReason === 'tasks', '仕事がぜんぶおわると隊員の勝ち');

g = game(['a', 'b', 'c', 'd'], {});
g.asleep[roleIds(g, 'sleeper')[0]] = 'voted';
ok(E.checkWin(g) && g.winReason === 'found', 'ねむらせ屋を見つけると隊員の勝ち');

g = game(['a', 'b', 'c', 'd'], {});
const c2 = roleIds(g, 'crew');
g.asleep[c2[0]] = 'slept';
g.asleep[c2[1]] = 'slept';
ok(E.checkWin(g) && g.winner === 'sleeper' && g.winReason === 'outnumber', 'おきている隊員が同じ数になるとねむらせ屋の勝ち');

// 途中で抜けた人
g = game(['a', 'b', 'c', 'd'], { tasks: 3 });
const cr = roleIds(g, 'crew');
g.tasks[cr[0]][0].done = true;
g.tasks[cr[1]][0].done = true;
let tp = E.taskProgress(g);
ok(tp.done === 2 && tp.total === 9, 'はじめの数', tp);
g.left[cr[1]] = true;
tp = E.taskProgress(g);
ok(tp.done === 2 && tp.total === 7, '抜けた人の仕事は、おわった分だけ数え、のこりを外す', tp);
ok(!E.awakeOf(g).includes(cr[1]), '抜けた人はおきている人に数えない');
ok(!E.checkWin(g), '隊員が1人抜けても、まだ決まらない（2対1）');
cr.forEach((id) => { if (id !== cr[1]) g.tasks[id].forEach((t) => { t.done = true; }); });
ok(E.checkWin(g) && g.winReason === 'tasks', '抜けた人の仕事がのこっていても、ほかがおわれば隊員の勝ち');

g = game(['a', 'b', 'c', 'd'], {});
g.left[roleIds(g, 'sleeper')[0]] = true;
ok(E.checkWin(g) && g.winner === 'crew' && g.winReason === 'left', 'ねむらせ屋が抜けると隊員の勝ち（いなくなった）');

g = game(['a', 'b', 'c', 'd'], {});
const c3 = roleIds(g, 'crew');
g.left[c3[0]] = true;
g.asleep[c3[1]] = 'slept';
ok(E.checkWin(g) && g.winner === 'sleeper', '隊員が抜けて同じ数になると、ねむらせ屋の勝ち');

g = game(['a', 'b', 'c', 'd', 'e', 'f', 'h'], { sleepers: 2 });
const sls = roleIds(g, 'sleeper');
g.asleep[sls[0]] = 'voted';
g.left[sls[1]] = true;
ok(E.checkWin(g) && g.winner === 'crew' && g.winReason === 'left', '1人見つけて、もう1人が抜けたときは「いなくなった」');
g = game(['a', 'b', 'c', 'd', 'e', 'f', 'h'], { sleepers: 2 });
roleIds(g, 'sleeper').forEach((id) => { g.asleep[id] = 'voted'; });
ok(E.checkWin(g) && g.winReason === 'found', '2人とも見つけたら「見つけた」');

// 票
const SK = '*skip';
let t = E.tally({ a: 'b', c: 'b', d: SK }, SK);
ok(t.target === 'b' && !t.tie, 'いちばん多い1人');
t = E.tally({ a: 'b', c: 'd' }, SK);
ok(t.target === null && t.tie, '同じ数ならだれもねむらない');
t = E.tally({ a: SK, c: SK, d: 'b' }, SK);
ok(t.target === null, 'スキップが多ければだれもねむらない');
t = E.tally({ a: 'skip', c: 'skip', d: 'b' }, SK);
ok(t.target === 'skip', '名前が skip の人も、スキップとまちがえない');
ok(E.tally({}, SK).target === null, '票がなければだれもねむらない');

console.log(`pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
