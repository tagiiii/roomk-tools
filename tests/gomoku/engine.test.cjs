// 五目並べの盤のルール（エミュレーター不要）。node tests/gomoku/engine.test.cjs
const E = require('../../apps/gomoku/engine.js');

let pass = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { pass += 1; return; }
  fails.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const at = (s) => E.COLS.indexOf(s[0]) + (Number(s.slice(1)) - 1) * E.SIZE;
// 場所の列から盤を作る（黒・白の順に置いたとして）
function boardOf(blacks, whites) {
  const a = E.emptyBoard().split('');
  blacks.forEach((s) => { a[at(s)] = 'b'; });
  whites.forEach((s) => { a[at(s)] = 'w'; });
  return a.join('');
}
function playAll(list) {
  let g = E.newGame();
  for (const s of list) { g = E.play(g, at(s)); if (!g) return null; }
  return g;
}

// 基本
check('size', E.SIZE === 15 && E.CELLS === 225 && E.COLS.length === 15);
check('coord', E.coord(0) === 'A1' && E.coord(224) === 'O15' && E.coord(E.CENTER) === 'H8');
const g0 = E.newGame();
check('new game', g0.board === E.emptyBoard() && g0.turn === 'b' && g0.last === -1 && !g0.over && g0.ply === 0);
const g1 = E.play(g0, E.CENTER);
check('play', g1 && g1.board[E.CENTER] === 'b' && g1.turn === 'w' && g1.last === E.CENTER && g1.ply === 1 && !g1.over);
check('occupied', E.play(g1, E.CENTER) === null);
check('out of range', E.play(g1, -1) === null && E.play(g1, 225) === null && E.play(g1, 1.5) === null);
check('immutable', g0.board === E.emptyBoard());

// 5つで勝ち（よこ・たて・ななめ2つ）
const lines = {
  よこ: ['D8', 'E8', 'F8', 'G8', 'H8'],
  たて: ['H4', 'H5', 'H6', 'H7', 'H8'],
  ななめ右下: ['D4', 'E5', 'F6', 'G7', 'H8'],
  ななめ左下: ['L4', 'K5', 'J6', 'I7', 'H8'],
};
const fillers = ['A15', 'C15', 'E15', 'G15', 'I15', 'K15'];
Object.entries(lines).forEach(([name, five]) => {
  const seq = [];
  five.forEach((s, k) => { seq.push(s); if (k < 4) seq.push(fillers[k]); });
  const g = playAll(seq);
  check('five ' + name, g && g.over && g.turn === 'b', g && g.over);
  const r = g && E.result(g.board, g.last);
  check('result ' + name, r && r.win === 'b' && r.line.length === 5 && five.every((s) => r.line.includes(at(s))), r);
});
// 4つではまだ
const g4 = playAll(['D8', 'A15', 'E8', 'C15', 'F8', 'E15', 'G8']);
check('four not over', g4 && !g4.over && g4.turn === 'w');
check('four result null', E.result(g4.board, g4.last) === null);
// 白も勝てる
const gw = playAll(['A1', 'D8', 'A3', 'E8', 'A5', 'F8', 'A7', 'G8', 'A9', 'H8']);
check('white wins', gw && gw.over && E.result(gw.board, gw.last).win === 'w');
// 6つ以上でも勝ち（禁じ手なし）
const six = boardOf(['C8', 'D8', 'E8', 'G8', 'H8'], ['A15', 'C15', 'E15', 'G15', 'I15']);
const g6 = E.play({ board: six, turn: 'b', last: -1, over: false, ply: 10 }, at('F8'));
check('six wins', g6 && g6.over && E.result(g6.board, g6.last).line.length === 6);
// 端をまたがない（よこの行の終わりから次の行へつながらない）
const wrap = boardOf(['L1', 'M1', 'N1', 'O1'], []);
const gwrap = E.play({ board: wrap, turn: 'b', last: -1, over: false, ply: 4 }, at('A2'));
check('no wrap', gwrap && !gwrap.over);
// おわったあとは置けない
check('no move after over', E.play(gw, at('O15')) === null);
// 盤がうまったら引き分け
{
  // 5つならばない並べ方: (列 + 2×行) を4で割った余りが 0・1 なら黒、2・3 なら白（どの向きも2つまで）
  const a = [];
  for (let r = 0; r < 15; r += 1) for (let k = 0; k < 15; k += 1) a.push((k + 2 * r) % 4 < 2 ? 'b' : 'w');
  // 1か所あけて、そこに置く
  const full = a.join('');
  const noFive = [...Array(225).keys()].every((i) => E.lineAt(full, i, full[i]).length === 0);
  check('draw pattern has no five', noFive);
  if (noFive) {
    const hole = 112;
    const color = full[hole];
    const before = full.slice(0, hole) + '.' + full.slice(hole + 1);
    const gd = E.play({ board: before, turn: color, last: -1, over: false, ply: 224 }, hole);
    check('draw', gd && gd.over && E.result(gd.board, gd.last).win === 'draw');
  }
}

// あと1つで5つ
const th = boardOf(['D8', 'E8', 'F8', 'G8'], ['H4', 'H5', 'H6']);
check('winningSpots open four', JSON.stringify(E.winningSpots(th, 'b')) === JSON.stringify([at('C8'), at('H8')].sort((a, b) => a - b)), E.winningSpots(th, 'b'));
check('winningSpots none for three', E.winningSpots(th, 'w').length === 0);
const gap = boardOf(['D8', 'E8', 'G8', 'H8'], []);
check('winningSpots gap', JSON.stringify(E.winningSpots(gap, 'b')) === JSON.stringify([at('F8')]), E.winningSpots(gap, 'b'));

// CPU: 勝てるなら勝つ・ふさぐ
['weak', 'normal', 'strong'].forEach((lv) => {
  for (let t = 0; t < 20; t += 1) {
    const m = E.cpuMove(gap, 'b', lv);
    if (m !== at('F8')) { check('cpu takes win ' + lv, false, E.coord(m)); break; }
  }
});
['normal', 'strong'].forEach((lv) => {
  for (let t = 0; t < 20; t += 1) {
    const m = E.cpuMove(gap, 'w', lv);
    if (m !== at('F8')) { check('cpu blocks ' + lv, false, E.coord(m)); break; }
  }
  pass += 1;
});
check('autoMove blocks', [...Array(20)].every(() => E.autoMove(gap, 'w') === at('F8')));
check('autoMove first move center', E.autoMove(E.emptyBoard(), 'b') === E.CENTER);
check('cpu full board', E.cpuMove('b'.repeat(225), 'w', 'strong') === -1 && E.autoMove('b'.repeat(225), 'w') === -1);
// つよい: ふさがれていない3つ（両はしが空き）を4つにして勝ちを決める／相手の両はしの空いた3つをふさぐ
{
  const open3 = boardOf(['F8', 'G8', 'H8'], ['F10', 'H12']);
  const m = E.cpuMove(open3, 'b', 'strong', () => 0);
  check('strong extends open three', [at('E8'), at('I8'), at('D8'), at('J8')].includes(m), E.coord(m));
  const m2 = E.cpuMove(open3, 'w', 'strong', () => 0);
  check('strong blocks open three', [at('E8'), at('I8'), at('D8'), at('J8')].includes(m2), E.coord(m2));
}

// でたらめ対局: いつも置ける・勝ちの判定が盤と合う
let rngSeed = 12345;
const rnd = () => { rngSeed = (rngSeed * 1103515245 + 12345) % 2147483648; return rngSeed / 2147483648; };
for (let n = 0; n < 200; n += 1) {
  let g = E.newGame();
  let ok = true;
  while (!g.over) {
    const empties = [...g.board].map((ch, i) => (ch === '.' ? i : -1)).filter((i) => i >= 0);
    const i = n % 2 ? empties[Math.floor(rnd() * empties.length)] : E.autoMove(g.board, g.turn, rnd);
    const ng = E.play(g, i);
    if (!ng) { ok = false; break; }
    // おわっていないなら、どちらにも5つはない
    if (!ng.over && E.result(ng.board, ng.last)) { ok = false; break; }
    g = ng;
  }
  check('random game ' + n, ok && E.result(g.board, g.last) !== null);
}

// CPU の強さの差
function series(a, b, n) {
  let wa = 0;
  for (let k = 0; k < n; k += 1) {
    const aB = k % 2 === 0;
    const lv = aB ? { b: a, w: b } : { b, w: a };
    let g = E.newGame();
    while (!g.over) g = E.play(g, E.cpuMove(g.board, g.turn, lv[g.turn]));
    const w = E.result(g.board, g.last).win;
    if (w !== 'draw' && (w === 'b') === aB) wa += 1;
  }
  return wa;
}
const t0 = Date.now();
const sn = series('strong', 'normal', 20);
check('strong beats normal (>=14/20)', sn >= 14, sn);
const nw = series('normal', 'weak', 20);
check('normal beats weak (>=16/20)', nw >= 16, nw);
console.log('strong vs normal ' + sn + '/20, normal vs weak ' + nw + '/20 (' + (Date.now() - t0) + 'ms)');
// つよいの1手の時間（おすすめの手にも使う）
{
  let g = playAll(['H8', 'H9', 'I9', 'G7', 'I7', 'I8', 'J9', 'G9', 'J8', 'J7', 'K9', 'G8']);
  const t = Date.now();
  for (let k = 0; k < 10; k += 1) E.cpuMove(g.board, g.turn, 'strong', () => 0);
  const ms = (Date.now() - t) / 10;
  check('strong move under 150ms', ms < 150, ms);
  console.log('strong move ' + ms.toFixed(1) + 'ms');
}

console.log(`pass ${pass} / fail ${fails.length}`);
process.exit(fails.length ? 1 : 0);
