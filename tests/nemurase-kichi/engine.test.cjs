// ねむらせ基地のルール（engine.js）のテスト。エミュレーター不要。
// 実行: node tests/nemurase-kichi/engine.test.cjs
const E = require('../../apps/nemurase-kichi/engine.js');
let pass = 0;
let fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const fixed = () => 0.1;
const game = (ids, s) => E.newGame(ids, s, fixed);
const roleIds = (g, role) => g.players.filter((id) => g.roles[id] === role);
const HOME = { x: Math.floor(E.TABLE.x) + 3, y: Math.floor(E.TABLE.y) };   // ひろばの床（テーブルの右）

// マップ: 仕事の場所・スイッチ・はじめの場所に立てて、ひろばから歩いて行ける
[...E.SPOTS, E.FIX_SPOT].forEach((p) => {
  ok(E.canStand(p.x, p.y), '立てる場所 ' + JSON.stringify(p));
  ok(!!E.path(HOME, { x: Math.floor(p.x), y: Math.floor(p.y) }), '行ける場所 ' + JSON.stringify(p));
});
for (let n = E.MIN_PLAYERS; n <= E.MAX_PLAYERS; n++) for (let i = 0; i < n; i++) { const q = E.spawnPoint(i, n); ok(E.canStand(q.x, q.y), 'はじめの場所 ' + n + '-' + i); }
ok(E.step({ x: 2.5, y: 3.5 }, -1, 0, 1).x >= 2 + E.RADIUS - 1e-9, 'かべを通りぬけない');
// 近道: 立てる・行ける・行き先が対になっている・仕事の場所やテーブルと重ならない
E.VENTS.forEach((v) => {
  ok(E.canStand(v.x, v.y), '近道に立てる ' + v.id);
  ok(!!E.path(HOME, { x: Math.floor(v.x), y: Math.floor(v.y) }), '近道に行ける ' + v.id);
  ok(E.VENTS[v.to] && E.VENTS[v.to].to === v.id && v.to !== v.id, '近道の行き先が対 ' + v.id);
  ok(E.SPOTS.every((sp) => E.dist(sp, v) > E.USE_RANGE * 2), '近道が仕事の場所から離れている ' + v.id);
  ok(E.dist(E.FIX_SPOT, v) > E.USE_RANGE * 2 && E.dist(E.TABLE, v) > E.TABLE.r + E.USE_RANGE * 2, '近道がスイッチ・テーブルから離れている ' + v.id);
});
ok(E.VIEW.crew < E.VIEW.sleeper, '隊員の見える広さは、ねむらせ屋よりせまい');
// はしご（2026-10-28）: 立てる・行ける・対になっている・書いてある部屋の中・仕事の場所や近道・スイッチ・テーブルと重ならない
ok(E.LADDERS.length === 2 && E.CLIMB_MS === 2500, 'はしごは2つ・使うのに2.5秒');
E.LADDERS.forEach((l) => {
  ok(E.canStand(l.x, l.y), 'はしごに立てる ' + l.id);
  ok(!!E.path(HOME, { x: Math.floor(l.x), y: Math.floor(l.y) }), 'はしごに行ける ' + l.id);
  ok(E.LADDERS[l.to] && E.LADDERS[l.to].to === l.id && l.to !== l.id, 'はしごの行き先が対 ' + l.id);
  ok(E.roomAt(l.x, l.y) === l.room, 'はしごは書いてある部屋の中 ' + l.id, E.roomAt(l.x, l.y));
  ok(E.SPOTS.every((sp) => E.dist(sp, l) > E.USE_RANGE * 2) && E.VENTS.every((v) => E.dist(v, l) > E.USE_RANGE * 2), 'はしごが仕事の場所・近道から離れている ' + l.id);
  ok(E.dist(E.FIX_SPOT, l) > E.USE_RANGE * 2 && E.dist(E.TABLE, l) > E.TABLE.r + E.USE_RANGE * 2, 'はしごがスイッチ・テーブルから離れている ' + l.id);
  ok(typeof l.label === 'string' && l.label && typeof l.busy === 'string' && l.busy, 'はしごのボタンの言葉 ' + l.id);
});
ok(E.LADDERS[0].room === 'radio' && E.LADDERS[1].room === 'tower', 'はしごは通信室と見はり台をつなぐ');
// 監視カメラ（2026-10-28）: 台は通信室・立てる・行ける・ほかの場所と重ならない。カメラは通路の上で、まわり CAM_R マスの床はぜんぶ通路（部屋の中は映らない）
ok(E.canStand(E.CAM_STAND.x, E.CAM_STAND.y) && E.roomAt(E.CAM_STAND.x, E.CAM_STAND.y) === 'monitor', 'カメラの台は監視室の中で立てる（2026-10-29 通信室から移した）');
ok(!!E.path(HOME, { x: Math.floor(E.CAM_STAND.x), y: Math.floor(E.CAM_STAND.y) }), 'カメラの台に行ける');
ok(E.SPOTS.every((sp) => E.dist(sp, E.CAM_STAND) > E.USE_RANGE * 2) && E.VENTS.every((v) => E.dist(v, E.CAM_STAND) > E.USE_RANGE * 2) && E.LADDERS.every((l) => E.dist(l, E.CAM_STAND) > E.USE_RANGE * 2), 'カメラの台が仕事の場所・近道・はしごから離れている');
ok(E.CAMS.length === 6 && E.CAM_R === 2.5 && E.CAMS.every((c, i) => c.id === i && c.name), 'カメラは6つ・映る広さ2.5マス');
E.CAMS.forEach((c) => {
  ok(E.isFloor(Math.floor(c.x), Math.floor(c.y)) && E.roomAt(c.x, c.y) === null, 'カメラは通路の上 ' + c.id);
  ok(!!E.path(HOME, { x: Math.floor(c.x), y: Math.floor(c.y) }), 'カメラの下まで行ける ' + c.id);
  const rooms = [];
  for (let ty = 0; ty < E.H; ty++) for (let tx = 0; tx < E.W; tx++) {
    if (E.isFloor(tx, ty) && E.dist({ x: tx + 0.5, y: ty + 0.5 }, c) <= E.CAM_R && E.roomAt(tx + 0.5, ty + 0.5)) rooms.push(tx + ',' + ty);
  }
  ok(rooms.length === 0, 'カメラのまわりの床はぜんぶ通路（部屋の中は映らない） ' + c.id, rooms);
});
ok(JSON.stringify(E.newGame(['a', 'b', 'c', 'd'], {}, fixed).cam) === '{}', 'はじめはだれもカメラを見ていない');

// 行き止まりの小部屋（道具室・温室）: 入口は1つ。入口の2マスをふさぐと、ひろばから行けなくなる
const DEAD_ENDS = [
  { room: 'tools', spot: 11, mouth: [[8, 13], [8, 14]], from: 'power' },
  { room: 'green', spot: 12, mouth: [[56, 14], [56, 15]], from: 'store' },
];
const roomTiles = (key) => { const r = E.ROOMS.find((q) => q.key === key); const out = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push({ x, y }); return out; };
DEAD_ENDS.forEach((d) => {
  const sp = E.SPOTS[d.spot];
  ok(sp && sp.room === d.room && E.roomAt(sp.x, sp.y) === d.room, '行き止まりの奥に仕事の場所 ' + d.room, sp);
  const goal = { x: Math.floor(sp.x), y: Math.floor(sp.y) };
  ok(!!E.path(HOME, goal), '行き止まりまで歩いて行ける ' + d.room);
  const saved = d.mouth.map(([x, y]) => { const v = E.GRID[y][x]; E.GRID[y][x] = 0; return () => { E.GRID[y][x] = v; }; });
  ok(E.path(HOME, goal) === null, '入口をふさぐと行けない（入口は1つ） ' + d.room);
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
ok(new Set(E.ROOMS.map((r) => r.key)).size === 13 && E.SPOTS.length === 17 && E.SPOTS.every((sp, i) => sp.id === i), '部屋13・仕事の場所17・id は並び順（2026-10-29 マップを広げた）');
ok(E.W === 64 && E.H === 43, 'マップは 64×43 マス');
// 四角を組み合わせた部屋（L字・T字・十字）: 続きの四角も同じ部屋。名前は最初の四角だけ
ok(E.ROOMS.filter((r) => r.part).length === 4 && E.ROOMS.filter((r) => r.part).every((r) => !r.name && E.ROOMS.find((q) => q.key === r.key && !q.part)), '続きの四角は4つで、名前のある本体がある');
ok(E.roomAt(3.5, 10.5) === 'kitchen' && E.roomAt(54.5, 11.5) === 'farm' && E.roomAt(33, 15) === 'plaza' && E.roomAt(58.5, 28.5) === 'store', '続きの四角の中も、その部屋');
ok(E.roomName('kitchen') === '台所' && E.roomName('playroom') === 'ゲーム室' && E.roomName('monitor') === '監視室', '部屋の名前（本体から引く）');
ok(E.roomAt(E.TABLE.x, E.TABLE.y) === 'plaza', 'テーブルはひろばのまん中');
E.SPOTS.forEach((sp) => ok(E.roomAt(sp.x, sp.y) === sp.room, '仕事の場所は書いてある部屋の中 ' + sp.id, E.roomAt(sp.x, sp.y)));
['monitor', 'laundry', 'pump', 'playroom'].forEach((key) => ok(E.SPOTS.some((sp) => sp.room === key), '足した部屋にも仕事の場所がある ' + key));

// かべの向こうは見えない（canSee）
ok(E.canSee({ x: 4.5, y: 3.5 }, { x: 9.5, y: 6.5 }), '同じ部屋の中は見える');
ok(!E.canSee({ x: 12.5, y: 3.5 }, { x: 20.5, y: 3.5 }), '台所から通信室へ、かべごしには見えない');
ok(E.canSee({ x: 12.5, y: 4.5 }, { x: 20.5, y: 4.5 }), '通路を通して見える');
ok(!E.canSee({ x: 10.5, y: 18.5 }, { x: 10.5, y: 14.5 }), '電気室から道具室へ、かべごしには見えない（近くても）');
ok(E.canSee({ x: 6.5, y: 13.5 }, { x: 11.5, y: 13.5 }), '道具室の入口から、奥の仕事の場所が見える');
ok(!E.canSee({ x: 60.5, y: 15.5 }, { x: 60.5, y: 19.5 }), '温室から倉庫へ、かべごしには見えない');
ok(E.canSee({ x: 25, y: 21 }, { x: 40, y: 21 }) && E.canSee({ x: 33, y: 15 }, { x: 33, y: 26 }) && !E.canSee({ x: 29, y: 15 }, { x: 25, y: 20 }), '十字のひろばは、まん中の通りは見え、かどの向こうは見えない');
ok(!E.canSee({ x: 4.5, y: 3.5 }, { x: 0.5, y: 0.5 }), 'かべの中の点は見えない');
ok(E.canSee({ x: 4.5, y: 3.5 }, { x: 4.5, y: 3.5 }), '自分の位置は見える');
ok(!E.canSee({ x: 0.5, y: 0.5 }, { x: 4.5, y: 3.5 }), 'かべの中からは何も見えない');
{
  // 対称（a から b が見えれば b から a も見える）。床の上の点をくじで選ぶ
  let seed = 7; const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
  const pt = () => { for (;;) { const x = rnd() * E.W; const y = rnd() * E.H; if (E.canStand(x, y)) return { x, y }; } };
  let asym = 0; let n = 0;
  for (let i = 0; i < 20000; i++) { const a = pt(); const b = pt(); if (E.dist(a, b) > 8) continue; n++; if (E.canSee(a, b) !== E.canSee(b, a)) asym++; }
  ok(n > 500 && asym === 0, 'canSee は対称', { n, asym });
}
// 見える範囲の多角形（viewPolygon）: 半径の中・かべで止まる・本数
{
  const from = { x: 12.5, y: 3.5 }; // 台所の右はし（右はかべ x=14、通路は y 4〜5）
  const poly = E.viewPolygon(from, 7.5);
  ok(poly.length === E.VIEW_RAYS, '光線の本数ぶんの点', poly.length);
  ok(poly.every((p) => E.dist(p, from) <= 7.5 + 1e-9), 'どの点も半径の中');
  ok(poly.every((p) => !(p.x >= 19 && p.y < 4)), '通信室の上の方（かべの向こう）には届かない');
  ok(poly.some((p) => p.x >= 18.5 && p.y >= 4 && p.y <= 6), '通路を通して通信室の側へ届く');
  const right = poly.filter((p) => Math.abs(p.y - 3.5) < 0.05 && p.x > from.x);
  ok(right.length && right.every((p) => p.x >= 14 && p.x <= 14 + E.VIEW_OVER + 1e-9), '右のかべに当たった光線は、かべの面を少しこえた所で止まる', right);
  const open = E.viewPolygon({ x: 33, y: 25.5 }, 2, 8, 0);
  ok(open.every((p) => Math.abs(E.dist(p, { x: 33, y: 25.5 }) - 2) < 1e-9), 'かべがなければ丸');
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
ok(g.players.every((id) => g.tasks[id].length === (g.roles[id] === 'crew' ? 4 : 3)), 'ひとり3つの仕事（隊員はふたりの仕事を1つ足して4）');
ok(roleIds(g, 'crew').every((id) => g.tasks[id].filter((t) => t.spot >= E.PAIR_SPOT_BASE).length === 1), '隊員はふたりの仕事を1つだけ持つ');
ok(roleIds(g, 'sleeper').every((id) => g.tasks[id].every((t) => t.spot < E.PAIR_SPOT_BASE)), 'ねむらせ屋はふたりの仕事を持たない');
{ const g0 = game(['a', 'b', 'c', 'd'], { tasks: 3, pair: 0 }); ok(g0.players.every((id) => g0.tasks[id].length === 3), '設定 pair=0 ならふたりの仕事はない'); }
{ const gb = game(['a', 'b', 'c', '*1', '*2'], { tasks: 3 }); ok(['*1', '*2'].every((id) => gb.tasks[id].every((t) => t.spot < E.PAIR_SPOT_BASE)), 'ロボットはふたりの仕事を持たない'); }
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
{ const g2 = E.newGame(['a', 'b', 'c', 'd'], { pick: 1 }, fixed, ['b']); ok(g2.players.join() === 'a,b,c,d' && g2.players.every((id) => g2.tasks[id].length === (g2.roles[id] === 'crew' ? 5 : 4)), '選んでも遊ぶ人の順と仕事の数は変わらない'); }
// ひとこと（ボタンで知らせる）: 言葉の数・キーの重なりなし・{name} は会議だけ・置きかえ・場面ごとに送れる言葉
ok(E.SAYS.play.length === 14 && E.SAYS.meeting.length === 10 && E.SAYS.common.length === 4, 'ひとことは 14・10・4');
ok(E.sayText('yes') === 'そうだよ' && E.sayAllowed('yes', 'play') && E.sayAllowed('yes', 'meeting'), '「そうだよ」はどちらでも使える');
ok(E.sayText('withnow', '', 'あお') === 'あおさんといっしょにいる' && E.sayText('sawnow', '', 'あお') === 'あおさんが仕事をしていた' && E.sayAllowed('withnow', 'play') && E.sayAllowed('sawnow', 'play') && !E.sayAllowed('withnow', 'meeting') && !E.sayAllowed('sawnow', 'meeting'), '遊んでいる間の名前の入る言葉は2つ');
ok(E.sayText('done1') === '仕事がひとつおわったよ' && E.sayText('doneall') === '仕事がぜんぶおわったよ' && E.sayAllowed('done1', 'play') && !E.sayAllowed('done1', 'meeting'), '仕事がおわった の2つは遊んでいる間の言葉');
{ const keys = E.SAYS.play.concat(E.SAYS.meeting, E.SAYS.common).map((p) => p.k); ok(new Set(keys).size === keys.length, 'ひとことのキーが重ならない'); }
ok(E.SAYS.play.filter((p) => p.t.includes('{name}')).map((p) => p.k).join() === 'withnow,sawnow', '遊んでいる間に名前の入る言葉は withnow・sawnow だけ');
ok(E.SAYS.common.every((p) => !p.t.includes('{name}') && !p.t.includes('{room}')), 'どちらでも使える言葉に名前・部屋は入らない');
ok(E.sayText('here', '台所') === '台所にいるよ' && E.sayText('here', '') === '通路にいるよ', '部屋の名前が入る（通路のときは「通路」）');
ok(E.sayText('with', '', 'あお') === 'あおさんといっしょにいた' && E.sayText('from', '畑') === '畑のほうから来た', '名前・部屋が入る');
ok(E.sayText('nope') === '' && E.sayPhrase('nope') === null, '知らないキーは空');
ok(E.sayAllowed('here', 'play') && !E.sayAllowed('here', 'meeting') && E.sayAllowed('with', 'meeting') && !E.sayAllowed('with', 'play') && E.sayAllowed('ok', 'play') && E.sayAllowed('ok', 'meeting'), '場面ごとに送れる言葉');
ok(E.SAY_GAP_MS === 5000 && E.SAY_LOG_MAX === 8, '5秒に1回・流れは8件');
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
g = game(['a', 'b', 'c', 'd'], { tasks: 3, pair: 0 });
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


// ── 2026-10-28 子どもの要望の第2便 ──
// 設定
ok(E.SETTING_OPTS.meeting.join() === '60,90,120,150,180', '会議の時間は 60〜180');
ok(E.SETTING_OPTS.gauge.join() === '2,1,0' && E.DEFAULT_SETTINGS.gauge === 2, 'みんなの仕事のバーの設定（はじめは出す）');
ok(E.SETTING_OPTS.pair.join() === '1,0' && E.DEFAULT_SETTINGS.pair === 1, 'ふたりの仕事の設定（はじめは あり）');
ok(E.BUTTON_WAIT_S === 20 && E.AIR_LIMIT_S === 60 && E.DOOR_MS === 10000 && E.DOOR_AGAIN_S === 20, '待ち時間の数字');
// 家具: 部屋の中・かべになる・ほかの物（仕事の場所・近道・はしご・スイッチ・パネル・テーブル・はじめの場所・入口）とかさならない
const things = [...E.SPOTS, E.FIX_SPOT, E.CAM_STAND, ...E.VENTS, ...E.LADDERS, ...E.AIR_PANELS, ...E.PAIRS.flatMap((p) => [p.a, p.b])];
E.FURNITURE.forEach((f, i) => {
  // 部屋の四角（続きの四角を含む）のどれかの中
  ok(E.ROOMS.filter((q) => q.key === f.room).some((r) => f.x >= r.x && f.y >= r.y && f.x + f.w <= r.x + r.w && f.y + f.h <= r.y + r.h), '家具は部屋の中 ' + i);
  for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) ok(!E.isFloor(x, y), '家具のマスはかべ ' + i + ' ' + x + ',' + y);
  ok(things.every((t) => !(t.x >= f.x - 0.1 && t.x <= f.x + f.w + 0.1 && t.y >= f.y - 0.1 && t.y <= f.y + f.h + 0.1)), '家具がほかの物とかさならない ' + i);
  ok(E.dist({ x: f.x + f.w / 2, y: f.y + f.h / 2 }, E.TABLE) > E.TABLE.r + 1.5, '家具がテーブルから離れている ' + i);
});
for (let n = E.MIN_PLAYERS; n <= E.MAX_PLAYERS; n++) for (let i = 0; i < n; i++) { const q = E.spawnPoint(i, n); ok(E.canStand(q.x, q.y), '家具を置いてもはじめの場所に立てる ' + n + '-' + i); }
// 家具を置いても、どの床のマスにも ひろばから行ける（部屋の入口をふさいでいない）
{
  let unreachable = 0;
  for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) if (E.isFloor(x, y) && !E.path(HOME, { x, y })) unreachable++;
  ok(unreachable === 0, '家具を置いても床はぜんぶ行ける', unreachable);
}
// ねむった人の歩き方: かべを通りぬける・マップの外には出ない
ok(E.stepFree({ x: 2.5, y: 3.5 }, -1, 0, 1).x < 2, 'ねむった人はかべを通りぬける');
ok(E.stepFree({ x: 0.5, y: 3.5 }, -1, 0, 1).x === E.RADIUS, 'ねむった人もマップの外には出ない（左）');
ok(E.stepFree({ x: E.W - 0.5, y: E.H - 0.5 }, 1, 1, 1).x === E.W - E.RADIUS && E.stepFree({ x: E.W - 0.5, y: E.H - 0.5 }, 1, 1, 1).y === E.H - E.RADIUS, 'ねむった人もマップの外には出ない（右下）');
ok(E.stepFree({ x: E.TABLE.x, y: E.TABLE.y - 2.4 }, 0, 1, 1).y > E.TABLE.y, 'ねむった人はテーブルも通りぬける');
// ドア: 通路の上・部屋のふち・6部屋・とじると通れない・上にいた人は出られる・道さがしも通らない・ひろばにはない
ok(E.DOOR_ROOMS.length === 10 && !E.DOOR_ROOMS.includes('plaza') && !E.DOOR_ROOMS.includes('tools') && !E.DOOR_ROOMS.includes('green'), 'ドアは10部屋（ひろば・行き止まりの小部屋にはない）');
E.DOORS.forEach((d, i) => {
  for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) ok(E.isFloor(x, y), 'ドアは床の上 ' + i + ' ' + x + ',' + y);
  ok(E.DOOR_ROOMS.includes(d.room), 'ドアの部屋はドアのある部屋 ' + i);
});
E.DOOR_ROOMS.forEach((key) => {
  const r = E.ROOMS.find((q) => q.key === key);
  const closed = E.doorTiles([key]);
  const inside = { x: r.x + Math.floor(r.w / 2), y: r.y + Math.floor(r.h / 2) };
  ok(E.isFloor(inside.x, inside.y), '部屋のまん中は床 ' + key);
  ok(!!E.path(HOME, inside), 'ひらいていれば ひろばから ' + key + ' に行ける');
  ok(!E.path(HOME, inside, closed), 'ドアをとじると ひろばから ' + key + ' に行けない（入口はぜんぶドア）');
});
{
  const closed = E.doorTiles(['kitchen']);
  // 台所と通信室の間のドア（x=14, y=4..5）。右（通路）から左へ歩いても入れない
  const p = E.step({ x: 15.5, y: 5 }, -1, 0, 1, closed);
  ok(p.x >= 15 + E.RADIUS - 1e-9, 'とじたドアには入れない', p);
  // ドアの上にいた人は出られる
  const q = E.step({ x: 14.5, y: 5 }, 1, 0, 1, closed);
  ok(q.x > 15, 'とじた瞬間にドアの上にいた人は出られる', q);
  ok(!E.canStand(14.5, 5, closed) && E.canStand(14.5, 5), 'とじたドアの上には立てない（ひらいていれば立てる）');
  ok(E.closedRooms({ doors: { kitchen: 100, farm: 50, plaza: 100 } }, 60).join() === 'kitchen', 'いまとじている部屋（時刻が過ぎたもの・ひろばは入れない）');
}
// 空気のパネル・ふたりの仕事のスイッチ: 立てる・行ける・書いてある部屋・ほかとかさならない
[...E.AIR_PANELS, ...E.PAIRS.flatMap((p) => [p.a, p.b])].forEach((t, i) => {
  ok(E.canStand(t.x, t.y), 'パネル・スイッチに立てる ' + i);
  ok(!!E.path(HOME, { x: Math.floor(t.x), y: Math.floor(t.y) }), 'パネル・スイッチに行ける ' + i);
  ok(E.roomAt(t.x, t.y) === t.room, 'パネル・スイッチは書いてある部屋の中 ' + i, E.roomAt(t.x, t.y));
  ok(E.SPOTS.every((sp) => E.dist(sp, t) > E.USE_RANGE * 2) && E.VENTS.every((v) => E.dist(v, t) > E.USE_RANGE * 2) && E.LADDERS.every((l) => E.dist(l, t) > E.USE_RANGE * 2), 'パネル・スイッチが仕事の場所・近道・はしごから離れている ' + i);
});
ok(E.AIR_PANELS.length === 2 && E.dist(E.AIR_PANELS[0], E.AIR_PANELS[1]) > 20, '空気のパネルは2つで、離れている');
E.PAIRS.forEach((p) => ok(E.dist(p.a, p.b) > 20 && p.a.room !== p.b.room, 'ふたりの仕事の2か所は離れた別の部屋 ' + p.id));
ok(E.spotInfo(100).kind === 'pair' && E.spotInfo(100).roomLabel === '電気室と畑' && E.spotInfo(101).roomLabel === '台所と見はり台', 'ふたりの仕事の場所の名前');
ok(E.spotInfo(0) === E.SPOTS[0] && E.spotInfo(999) === null, 'spotInfo はふつうの場所も引ける・ないものは null');
ok(E.pairFresh({ id: 'a', at: 1000 }, 1000 + E.PAIR_HOLD_MS) && !E.pairFresh({ id: 'a', at: 1000 }, 1001 + E.PAIR_HOLD_MS) && !E.pairFresh(null, 0) && !E.pairFresh({ id: 1, at: 1000 }, 1000), 'おしているのが有効か');
// 空気の時間切れ
{
  const ga = game(['a', 'b', 'c', 'd'], {});
  ok(!E.checkAir(ga, 1000), '空気が止まっていなければ何もない');
  ga.air = 5000;
  ok(!E.checkAir(ga, 4999) && !ga.winner, '時間の前は決まらない');
  ok(E.checkAir(ga, 5000) && ga.winner === 'sleeper' && ga.winReason === 'air', '時間がくると ねむらせ屋の勝ち（空気）');
  const gb = game(['a', 'b', 'c', 'd'], {});
  gb.winner = 'crew'; gb.air = 1;
  ok(E.checkAir(gb, 10) && gb.winner === 'crew', '決まっている勝ち負けは変えない');
}
ok(JSON.stringify(E.newGame(['a', 'b', 'c', 'd'], {}, fixed).doors) === '{}' && E.newGame(['a', 'b', 'c', 'd'], {}, fixed).air === 0 && JSON.stringify(E.newGame(['a', 'b', 'c', 'd'], {}, fixed).sleptBy) === '{}', 'はじめはドア・空気・ねむらせた人は空');

// 役職（2026-10-29）
{
  ok(['engineer', 'watcher', 'angel', 'shifter'].every((k) => E.DEFAULT_SETTINGS[k] === 0 && E.SETTING_OPTS[k].join() === '0,1'), '役職ははじめはどれも入れない・入れる／入れないを選べる');
  const none = game(['a', 'b', 'c', 'd', 'e'], {});
  ok(JSON.stringify(none.jobs) === '{}' && none.angel === '' && JSON.stringify(none.shield) === '{}' && JSON.stringify(none.shape) === '{}', '役職なしなら、だれにも付かない');
  const all = game(['a', 'b', 'c', 'd', 'e', 'f'], { engineer: 1, watcher: 1, angel: 1, shifter: 1 });
  const jobs = Object.entries(all.jobs);
  ok(jobs.filter(([, j]) => j === 'engineer').length === 1 && jobs.filter(([, j]) => j === 'watcher').length === 1 && jobs.filter(([, j]) => j === 'shifter').length === 1, '整備係・見守り係・へんしん屋が1人ずつ');
  ok(jobs.every(([id, j]) => (j === 'shifter' ? all.roles[id] === 'sleeper' : all.roles[id] === 'crew')), '整備係・見守り係は隊員、へんしん屋はねむらせ屋');
  ok(all.angel === '', 'まもり星は、はじめはだれでもない');
  const bots = game(['a', '*1', '*2', '*3', '*4'], { engineer: 1, watcher: 1, shifter: 1 });
  ok(Object.keys(bots.jobs).every((id) => !id.startsWith('*')), 'ロボットには役職を付けない');
  ok(Object.keys(bots.jobs).length <= 1, '人が1人なら、役職は多くても1つ');
  // まもり星: 最初にねむった人の隊員だけがなる
  const crew = roleIds(all, 'crew');
  const sl = roleIds(all, 'sleeper')[0];
  ok(!E.claimAngel(all, sl, 1000) && all.angel === '', 'ねむらせ屋はまもり星にならない');
  ok(E.claimAngel(all, crew[0], 1000) && all.angel === crew[0] && all.angelReadyAt === 1000 + E.ANGEL_FIRST_S * 1000, '最初にねむった隊員がまもり星になる');
  ok(!E.claimAngel(all, crew[1], 2000) && all.angel === crew[0], '2人目からはならない');
  ok(E.jobOf(all, crew[0]) === 'angel' && E.jobOf(all, crew[1]) === (all.jobs[crew[1]] || ''), 'jobOf はまもり星を先に見る');
  const off = game(['a', 'b', 'c', 'd'], {});
  ok(!E.claimAngel(off, roleIds(off, 'crew')[0], 1) && off.angel === '', '設定がなければ、まもり星にならない');
  const gb = game(['*1', 'b', 'c', 'd'], { angel: 1 });
  if (gb.roles['*1'] === 'crew') ok(!E.claimAngel(gb, '*1', 1) && gb.angel === '', 'ロボットはまもり星にならない');
  // バリア・へんしんの見方
  all.shield = { [crew[1]]: 5000 };
  ok(E.shielded(all, crew[1], 4999) && !E.shielded(all, crew[1], 5000) && !E.shielded(all, crew[2], 0), 'バリアは時刻まで');
  all.shape = { [sl]: { as: crew[1], until: 5000 } };
  ok(E.looksAs(all, sl, 4999) === crew[1] && E.looksAs(all, sl, 5000) === sl && E.looksAs(all, crew[1], 0) === crew[1], 'へんしん中は、なっている人に見える');
  all.shape = { [sl]: { as: 'nobody', until: 5000 } };
  ok(E.looksAs(all, sl, 1) === sl, 'いない人にはなれない');
  ok(E.JOB_NAMES.engineer === '整備係' && E.JOB_NAMES.watcher === '見守り係' && E.JOB_NAMES.shifter === 'へんしん屋' && E.JOB_NAMES.angel === 'まもり星', '役職の名前');
}

console.log(`pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
