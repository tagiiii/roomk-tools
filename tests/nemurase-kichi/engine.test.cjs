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

// 行き止まりの小部屋（道具室・温室）: 入口は1つ。入口の2マスをふさぐと、ひろばから行けなくなる
const DEAD_ENDS = [
  { room: 'tools', spot: 11, mouth: [[8, 10], [8, 11]], from: 'power' },
  { room: 'green', spot: 12, mouth: [[35, 11], [35, 12]], from: 'store' },
];
const roomTiles = (key) => { const r = E.ROOMS.find((q) => q.key === key); const out = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y }); return out; };
DEAD_ENDS.forEach((d) => {
  const sp = E.SPOTS[d.spot];
  ok(sp && sp.room === d.room && E.roomAt(sp.x, sp.y) === d.room, '行き止まりの奥に仕事の場所 ' + d.room, sp);
  const goal = { x: Math.floor(sp.x), y: Math.floor(sp.y) };
  ok(!!E.path({ x: 22, y: 12 }, goal), '行き止まりまで歩いて行ける ' + d.room);
  const saved = d.mouth.map(([x, y]) => { const v = E.GRID[y][x]; E.GRID[y][x] = 0; return () => { E.GRID[y][x] = v; }; });
  ok(E.path({ x: 22, y: 12 }, goal) === null, '入口をふさぐと行けない（入口は1つ） ' + d.room);
  saved.forEach((f) => f());
  // 小部屋のまわりは、入口のとなり以外ぜんぶかべ
  const tiles = roomTiles(d.room);
  const inRoom = new Set(tiles.map((t) => t.y * E.W + t.x));
  const outside = [];
  tiles.forEach((t) => [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ax, ay]) => {
    const nx = t.x + ax; const ny = t.y + ay;
    if (!inRoom.has(ny * E.W + nx) && E.isFloor(nx, ny)) outside.push(nx + ',' + ny);
  }));
  ok(outside.length === 2, '小部屋の出口は通路の2マスだけ ' + d.room, outside);
});
ok(E.ROOMS.length === 9 && E.SPOTS.length === 13 && E.SPOTS.every((sp, i) => sp.id === i), '部屋9・仕事の場所13・id は並び順');

// かべの向こうは見えない（canSee）
ok(E.canSee({ x: 4.5, y: 3.5 }, { x: 9.5, y: 6.5 }), '同じ部屋の中は見える');
ok(!E.canSee({ x: 10.5, y: 3.5 }, { x: 18.5, y: 3.5 }), '台所から通信室へ、かべごしには見えない');
ok(E.canSee({ x: 10.5, y: 4.5 }, { x: 18.5, y: 4.5 }), '通路を通して見える');
ok(!E.canSee({ x: 9.5, y: 13.5 }, { x: 12.5, y: 11.5 }), '電気室から道具室へ、かべごしには見えない（近くても）');
ok(E.canSee({ x: 8.5, y: 10.5 }, { x: 14.5, y: 11.5 }), '道具室の入口から、奥の仕事の場所が見える');
ok(!E.canSee({ x: 30.5, y: 12.5 }, { x: 30.5, y: 15.5 }), '温室から倉庫へ、かべごしには見えない');
ok(!E.canSee({ x: 4.5, y: 3.5 }, { x: 0.5, y: 0.5 }), 'かべの中の点は見えない');
ok(E.canSee({ x: 4.5, y: 3.5 }, { x: 4.5, y: 3.5 }), '自分の位置は見える');
ok(!E.canSee({ x: 0.5, y: 0.5 }, { x: 4.5, y: 3.5 }), 'かべの中からは何も見えない');
{
  // 対称（a から b が見えれば b から a も見える）。床の上の点をくじで選ぶ
  let seed = 7; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const pt = () => { for (;;) { const x = rnd() * E.W; const y = rnd() * E.H; if (E.canStand(x, y)) return { x, y }; } };
  let asym = 0; let n = 0;
  for (let i = 0; i < 3000; i++) { const a = pt(); const b = pt(); if (E.dist(a, b) > 8) continue; n++; if (E.canSee(a, b) !== E.canSee(b, a)) asym++; }
  ok(n > 500 && asym === 0, 'canSee は対称', { n, asym });
}
// 見える範囲の多角形（viewPolygon）: 半径の中・かべで止まる・本数
{
  const from = { x: 10.5, y: 3.5 }; // 台所の右はし（右はかべ、通路は y 4〜5）
  const poly = E.viewPolygon(from, 7.5);
  ok(poly.length === E.VIEW_RAYS, '光線の本数ぶんの点', poly.length);
  ok(poly.every((p) => E.dist(p, from) <= 7.5 + 1e-9), 'どの点も半径の中');
  ok(poly.every((p) => !(p.x >= 17 && p.y < 4)), '通信室の上の方（かべの向こう）には届かない');
  ok(poly.some((p) => p.x >= 16.5 && p.y >= 4 && p.y <= 6), '通路を通して通信室の側へ届く');
  const right = poly.filter((p) => Math.abs(p.y - 3.5) < 0.05 && p.x > from.x);
  ok(right.length && right.every((p) => p.x >= 12 && p.x <= 12 + E.VIEW_OVER + 1e-9), '右のかべに当たった光線は、かべの面を少しこえた所で止まる', right);
  const open = E.viewPolygon({ x: 22, y: 12.5 }, 2, 8, 0);
  ok(open.every((p) => Math.abs(E.dist(p, { x: 22, y: 12.5 }) - 2) < 1e-9), 'かべがなければ丸');
  ok(E.rayDist({ x: 4.5, y: 3.5 }, -1, 0, 10) === 2.5 && E.rayDist({ x: 4.5, y: 3.5 }, 0, -1, 10) === 1.5, 'かべまでの距離');
}
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
// ホストが選ぶ（picks）: 選んだ人がねむらせ屋。遊ぶ人にいない名前・重なりは無視し、足りない分はシャッフルで決める
ok(E.DEFAULT_SETTINGS.pick === 0 && E.SETTING_OPTS.pick.join() === '0,1', 'ねむらせ屋の決め方は はじめランダム（0）・ホストが選ぶ（1）');
ok(roleIds(E.newGame(['a', 'b', 'c', 'd'], { pick: 1 }, fixed, ['c']), 'sleeper').join() === 'c', '選んだ人がねむらせ屋になる');
ok(roleIds(E.newGame(['a', 'b', 'c', 'd'], { pick: 1 }, fixed, ['d']), 'sleeper').join() === 'd', '最後の人も選べる');
ok(roleIds(E.newGame(['a', 'b', 'c', 'd', 'e', 'f', 'h'], { sleepers: 2, pick: 1 }, fixed, ['h', 'b']), 'sleeper').sort().join() === 'b,h', '2人のときは2人とも選んだ人');
ok(roleIds(E.newGame(['a', 'b', 'c', 'd', 'e', 'f', 'h'], { sleepers: 2, pick: 1 }, fixed, ['h', 'b', 'a']), 'sleeper').sort().join() === 'b,h', '多く選んでも人数ぶんだけ');
ok(roleIds(E.newGame(['a', 'b', 'c', 'd'], { sleepers: 2, pick: 1 }, fixed, ['a', 'b']), 'sleeper').join() === 'a', '7人より少ないと、選んでも1人');
{ const g2 = E.newGame(['a', 'b', 'c', 'd'], { pick: 1 }, fixed, ['zzz', 'c', 'c']); ok(roleIds(g2, 'sleeper').join() === 'c' && Object.keys(g2.roles).length === 4, '遊ぶ人にいない名前と重なりは無視'); }
{ const g2 = E.newGame(['a', 'b', 'c', 'd'], { pick: 1 }, fixed, []); ok(roleIds(g2, 'sleeper').length === 1, '選んでいなければシャッフルで1人'); }
{ const g2 = E.newGame(['a', 'b', 'c', 'd', 'e', 'f', 'h'], { sleepers: 2, pick: 1 }, fixed, ['a']); const r = roleIds(g2, 'sleeper'); ok(r.length === 2 && r.includes('a'), '1人だけ選んだら、もう1人はシャッフル'); }
{ const g2 = E.newGame(['a', 'b', 'c', 'd'], { pick: 1 }, fixed, ['b']); ok(g2.players.join() === 'a,b,c,d' && Object.values(g2.tasks).every((t) => t.length === 4), '選んでも遊ぶ人の順と仕事の数は変わらない'); }
// ランダム: 最後の人だけになる偏りがない（固定の乱数列で、だれでもねむらせ屋になれる）
{ const seen = new Set(); for (let k = 0; k < 40; k++) { let i = k; const rnd = () => { i = (i * 9301 + 49297) % 233280; return i / 233280; }; seen.add(roleIds(E.newGame(['a', 'b', 'c', 'd', 'e'], {}, rnd), 'sleeper')[0]); } ok(seen.size === 5, 'ランダムでは5人のだれでもねむらせ屋になる', [...seen]); }

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
