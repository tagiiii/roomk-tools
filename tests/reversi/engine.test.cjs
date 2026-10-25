// node tests/reversi/engine.test.cjs
const E = require('../../apps/reversi/engine.js');
let pass = 0; let fail = 0;
const ok = (c, m) => { if (c) pass += 1; else { fail += 1; console.log('NG', m); } };

// はじめの並びと置ける場所
const g0 = E.newGame();
ok(E.count(g0.board).b === 2 && E.count(g0.board).w === 2, '初期は2対2');
ok(JSON.stringify(Object.keys(E.legalMoves(g0.board, 'b')).map(Number).map(E.coord).sort()) === JSON.stringify(['C4', 'D3', 'E6', 'F5']), '黒の最初の置ける場所は D3 C4 F5 E6');
ok(E.play(g0, 0) === null, '置けない場所は null');
ok(E.play(g0, 27) === null, '石のある場所は null');

// perft（パスはこの深さでは起きない）
function perft(g, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const k of Object.keys(E.legalMoves(g.board, g.turn))) n += perft(E.play(g, Number(k)), d - 1);
  return n;
}
[[1, 4], [2, 12], [3, 56], [4, 244], [5, 1396], [6, 8200]].forEach(([d, n]) => ok(perft(g0, d) === n, 'perft ' + d + ' = ' + n));

// でたらめに最後まで打って、きまりを確かめる
for (let t = 0; t < 400; t += 1) {
  let g = E.newGame();
  let guard = 0;
  while (!g.over && guard < 100) {
    const moves = Object.keys(E.legalMoves(g.board, g.turn)).map(Number);
    if (!moves.length) { ok(false, '置ける場所がないのに番が来た'); break; }
    const i = moves[Math.floor(Math.random() * moves.length)];
    const before = E.count(g.board);
    const n = E.flipsAt(g.board, i, g.turn).length;
    const mover = g.turn;
    const ng = E.play(g, i);
    const after = E.count(ng.board);
    ok(after[mover] === before[mover] + n + 1, '置いた色が1＋ひっくり返した数ふえる');
    ok(ng.flipped.length === n && ng.last === i && ng.ply === g.ply + 1, '記録');
    if (ng.passed) ok(ng.turn === mover && !E.hasMove(ng.board, ng.passed), 'パスは置けない色だけ');
    else if (!ng.over) ok(ng.turn === E.other(mover), '番がかわる');
    if (ng.over) ok(!E.hasMove(ng.board, 'b') && !E.hasMove(ng.board, 'w'), 'おしまいはどちらも置けない');
    g = ng; guard += 1;
  }
  ok(g.over, '最後まで行く');
}

// パスの局面: 白が置けず黒がまだ置ける
{
  const a = Array(64).fill('.');
  a[0] = 'b'; a[1] = 'w'; // A1 黒・B1 白 → 黒が C1 に置くと白は0
  a[63] = 'w'; a[62] = 'w'; a[61] = 'b'; // H8 白・G8 白・F8 黒
  const g = { board: a.join(''), turn: 'b', last: -1, flipped: [], passed: null, over: false, ply: 0 };
  const g1 = E.play(g, 2);
  ok(g1 && g1.board[1] === 'b', 'C1 で B1 がかえる');
  ok(g1 && !g1.over && (g1.passed === 'w' ? g1.turn === 'b' : true), 'パスまたは続行');
}
ok(E.winner('b'.repeat(33) + 'w'.repeat(31)) === 'b' && E.winner('b'.repeat(32) + 'w'.repeat(32)) === 'draw', '勝ち');

// 時間切れの代わりの手（CPU）
for (let t = 0; t < 300; t += 1) {
  let g = E.newGame();
  while (!g.over) {
    const i = E.autoMove(g.board, g.turn);
    ok(E.flipsAt(g.board, i, g.turn).length > 0, 'CPU の手は置ける場所');
    const corners = [0, 7, 56, 63].filter((k) => E.flipsAt(g.board, k, g.turn).length);
    if (corners.length) ok(corners.includes(i), '角が取れれば角');
    g = E.play(g, i);
  }
}
{
  // 角のとなり（B2）とそうでない場所があれば、角のとなりは選ばない
  const a = Array(64).fill('.');
  a[18] = 'w'; a[27] = 'b'; // C3 白・D4 黒 → 黒は B2 に置ける
  a[29] = 'w'; a[30] = 'b'; // F4 白・G4 黒 → 黒は E4 に置ける
  const board = a.join('');
  const got = new Set(Array.from({ length: 50 }, () => E.autoMove(board, 'b')));
  ok(E.flipsAt(board, 9, 'b').length && E.flipsAt(board, 28, 'b').length, '局面の前提');
  ok(!got.has(9) && got.has(28), '空いた角のとなりは避ける', [...got]);
}
ok(E.autoMove(E.initialBoard().replace(/b/g, 'w'), 'b') === -1, '置けなければ -1');

console.log(fail ? 'FAIL' : 'OK', pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
