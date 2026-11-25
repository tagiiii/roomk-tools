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

// 対戦相手の CPU の強さ（2026-11-11）
for (const level of ['weak', 'normal', 'strong']) {
  for (let t = 0; t < (level === 'strong' ? 5 : 100); t += 1) {
    let g = E.newGame();
    while (!g.over) {
      const i = E.cpuMove(g.board, g.turn, level);
      ok(E.flipsAt(g.board, i, g.turn).length > 0, 'CPU（' + level + '）の手は置ける場所');
      g = E.play(g, i);
    }
  }
}
{
  // つよいは、ふつうに勝ち越す（黒白を入れかえて10局ずつ）
  let strongWins = 0;
  for (let t = 0; t < 20; t += 1) {
    const strong = t % 2 ? 'w' : 'b';
    let g = E.newGame();
    while (!g.over) g = E.play(g, E.cpuMove(g.board, g.turn, g.turn === strong ? 'strong' : 'normal'));
    if (E.winner(g.board) === strong) strongWins += 1;
  }
  ok(strongWins >= 15, 'つよいはふつうに勝ち越す', strongWins);
  // 角が取れる局面では、つよいは角を取る（初期局面に角が取れる形を作る）
  const a = Array(64).fill('.');
  a[9] = 'w'; a[18] = 'b'; a[27] = 'w'; a[36] = 'b';
  const board = a.join('');
  ok(E.flipsAt(board, 0, 'b').length > 0, '角の前提');
  ok(E.cpuMove(board, 'b', 'strong') === 0, 'つよいは角を取る');
}
ok(E.cpuMove(E.initialBoard().replace(/b/g, 'w'), 'b', 'strong') === -1, '置けなければ -1（つよい）');

// ── 3〜4人（2026-11-25）──
{
  const g3 = E.newGame(3);
  const g4 = E.newGame(4);
  ok(g3.n === 3 && g4.n === 4 && E.newGame().n === 2, '人数');
  ok(g4.board[27] === 'b' && g4.board[28] === 'w' && g4.board[36] === 'y' && g4.board[35] === 'u', '4人のはじめの並び');
  ok(g3.board[35] === '.' && E.count(g3.board).y === 1 && E.count(g3.board).u === 0, '3人のはじめの並び');
  ok(JSON.stringify(E.colorsOf(3)) === '["b","w","y"]' && E.nextColor('y', 3) === 'b' && E.nextColor('y', 4) === 'u' && E.nextColor('u', 4) === 'b', '置く順');
  // 黒の最初: E4 白・E5 黄をはさめる F4・F6（4人は D5 青も → D6）
  const m4 = Object.keys(E.movesOf(g4.board, 'b', 4)).map(Number).map(E.coord).sort();
  ok(JSON.stringify(m4) === JSON.stringify(['D6', 'F4', 'F6']), '4人の黒の最初の置ける場所 ' + m4);
  // 色がまじった列もはさめる: 黒 A1・白 B1・黄 C1 → 黒が D1 で B1 C1 がかえる
  const a = Array(64).fill('.');
  a[0] = 'b'; a[1] = 'w'; a[2] = 'y';
  const mixed = E.flipsAtMulti(a.join(''), 3, 'b');
  ok(JSON.stringify(mixed.sort()) === '[1,2]', 'まじった列をはさむ');
  // はさめないときは石のとなりへ
  const b = Array(64).fill('.');
  b[27] = 'w'; b[28] = 'y';
  const adj = E.movesOf(b.join(''), 'b', 3);
  ok(Object.keys(adj).length === 10 && Object.values(adj).every((v) => v === 0), 'となりに置ける（10マス）');
  ok(E.play({ ...E.newGame(3), board: b.join('') }, 0) === null, 'となりでない所は置けない');
  const p1 = E.play({ ...E.newGame(3), board: b.join('') }, 19);
  ok(p1 && p1.board[19] === 'b' && p1.flipped.length === 0 && p1.turn === 'w', 'となりに置いて番がかわる');
  // はさめる場所があるときは、となりでも、はさめない所には置けない
  ok(E.play(g4, E.SIZE * 2 + 2) === null && E.play(g4, 18) === null, 'はさめるときは、はさむ場所だけ');
  // でたらめに最後まで
  for (const n of [3, 4]) {
    for (let t = 0; t < 300; t += 1) {
      let g = E.newGame(n);
      let guard = 0;
      while (!g.over && guard < 80) {
        const mv = E.movesOf(g.board, g.turn, n);
        const keys = Object.keys(mv).map(Number);
        if (!keys.length) { ok(false, '置ける場所がない（' + n + '人）'); break; }
        const i = t % 3 === 0 ? E.autoMove(g.board, g.turn, undefined, n) : t % 3 === 1 ? E.cpuMove(g.board, g.turn, 'strong', undefined, n) : keys[Math.floor(Math.random() * keys.length)];
        ok(mv[i] != null, 'CPU は置ける場所に置く（' + n + '人）');
        const before = E.count(g.board);
        const mover = g.turn;
        const ng = E.play(g, i);
        const after = E.count(ng.board);
        ok(after[mover] === before[mover] + mv[i] + 1 && ng.flipped.length === mv[i], 'ふえる数（' + n + '人）');
        ok(E.colorsOf(n).reduce((s, c) => s + after[c], 0) === ng.ply + (n === 3 ? 3 : 4), '石の合計（' + n + '人）');
        ok(ng.passed === null && ng.n === n, 'パスはない');
        if (!ng.over) ok(ng.turn === E.nextColor(mover, n), '番は次の色へ');
        else ok(!ng.board.includes('.'), 'おしまいは盤がうまったとき');
        g = ng; guard += 1;
      }
      ok(g.over && g.ply === (n === 3 ? 61 : 60), '最後まで行く（' + n + '人）');
      const ws = E.winners(g.board, n);
      const k = E.count(g.board);
      ok(ws.length >= 1 && ws.every((c) => k[c] === Math.max(...E.colorsOf(n).map((x) => k[x]))), '勝ち（' + n + '人）');
    }
  }
  ok(JSON.stringify(E.winners('b'.repeat(20) + 'w'.repeat(20) + 'y'.repeat(24), 3)) === '["y"]', '勝ち 3人');
  ok(JSON.stringify(E.winners('b'.repeat(16) + 'w'.repeat(16) + 'y'.repeat(16) + 'u'.repeat(16), 4)) === '["b","w","y","u"]', 'みんな同じ数');
}

console.log(fail ? 'FAIL' : 'OK', pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
