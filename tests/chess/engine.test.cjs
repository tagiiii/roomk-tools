// チェスの盤のルールのテスト（エミュレーター不要）。node tests/chess/engine.test.cjs
const E = require('../../apps/chess/engine.js');
let pass = 0; let fail = 0;
function check(label, cond, detail) {
  if (cond) { pass += 1; return; }
  fail += 1;
  console.log('NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sq = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
function fromFen(fen) {
  const [b, t, c, ep, h] = fen.split(' ');
  const board = [];
  for (const row of b.split('/')) for (const ch of row) { if (/\d/.test(ch)) for (let i = 0; i < +ch; i += 1) board.push(''); else board.push(ch); }
  const S = { board, turn: t === 'w' ? 0 : 1, castle: c === '-' ? '' : c, ep: ep === '-' ? -1 : sq(ep), half: +h || 0, ply: 0, last: null, check: false, over: null, keys: [] };
  S.check = E.inCheck(S.board, S.turn);
  S.keys.push(E.keyOf(S));
  return S;
}
// 'e2e4' の形で指す（成るときは 'e7e8q'）
function mv(S, s) {
  const m = { from: sq(s.slice(0, 2)), to: sq(s.slice(2, 4)), promo: s[4] ? s[4].toUpperCase() : '' };
  const ok = E.legalMoves(S).some((x) => E.sameMove(x, m));
  if (!ok) throw new Error('illegal ' + s);
  return E.apply(S, m);
}
const play = (S, list) => list.split(' ').reduce(mv, S);

// 1. はじめの局面からの手の数（既知の値。perft）
function child(S, m) { const a = E.playOnBoard(S, m); return { board: a.board, turn: 1 - S.turn, castle: a.castle, ep: a.ep, half: a.half, over: null }; }
function perft(S, d) { const ms = E.legalMoves(S); if (d === 1) return ms.length; let n = 0; for (const m of ms) n += perft(child(S, m), d - 1); return n; }
[
  ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0', [20, 400, 8902, 197281]],
  ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0', [48, 2039, 97862]],
  ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0', [14, 191, 2812, 43238]],
  ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0', [6, 264, 9467]],
  ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1', [44, 1486, 62379]],
].forEach(([f, exp]) => exp.forEach((e, i) => check('perft ' + f.slice(0, 12) + ' d' + (i + 1), perft(fromFen(f), i + 1) === e)));

// 2. チェックメイト（いちばん短いメイト）と表記
let S = play(E.create(), 'f2f3 e7e5 g2g4 d8h4');
check('fool mate', S.over && S.over.reason === 'mate' && S.over.winner === 1, S.over);
check('mate san #', S.last.san === 'Qh4#', S.last.san);
check('mate text', S.last.text === 'クイーン d8→h4', S.last.text);
// 3. ステイルメイト
S = fromFen('7k/5Q2/6K1/8/8/8/8/8 w - - 0');
S = mv(S, 'f7f6');   // まだ動ける
check('not stalemate yet', !S.over);
S = fromFen('k7/2Q5/8/8/8/8/8/7K w - - 0');
S = mv(S, 'h1g2');
check('stalemate', S.over && S.over.reason === 'stalemate' && S.over.winner === -1, S.over);
// 4. キャスリング（できる・チェック中はできない・通り道がねらわれている）
S = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0');
let ms = E.legalMoves(S).filter((m) => m.from === sq('e1')).map((m) => m.to);
check('castle both', ms.includes(sq('g1')) && ms.includes(sq('c1')));
S = mv(S, 'e1g1');
check('castle rook moved', S.board[sq('f1')] === 'R' && S.board[sq('h1')] === '' && S.last.san === 'O-O' && S.last.text === 'キャスリング（キングの側）');
check('castle rights', S.castle === 'kq', S.castle);
S = fromFen('r3k2r/8/8/8/8/8/5r2/R3K2R w KQkq - 0');
check('castle through attack', !E.legalMoves(S).some((m) => m.from === sq('e1') && m.to === sq('g1')));
check('castle why pass', /キングが通る/.test(E.whyIllegal(S, sq('e1'), sq('g1'))), E.whyIllegal(S, sq('e1'), sq('g1')));
S = fromFen('r3k2r/8/8/8/8/8/4r3/R3K2R w KQkq - 0');
check('castle in check why', /チェックされている/.test(E.whyIllegal(S, sq('e1'), sq('c1'))));
S = fromFen('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0');
check('castle blocked why', /間に駒/.test(E.whyIllegal(S, sq('e1'), sq('c1'))));
S = play(fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0'), 'h1h2 a8a7 h2h1 a7a8');
check('castle moved why', /もう動いた/.test(E.whyIllegal(S, sq('e1'), sq('g1'))));
// 5. アンパッサン
S = play(E.create(), 'e2e4 a7a6 e4e5 d7d5');
check('ep legal', E.legalMoves(S).some((m) => m.from === sq('e5') && m.to === sq('d6')));
S = mv(S, 'e5d6');
check('ep captured', S.board[sq('d5')] === '' && S.last.san === 'exd6' && /アンパッサン/.test(S.last.text), S.last);
S = play(E.create(), 'e2e4 a7a6 e4e5 d7d5 a2a3 a6a5');
check('ep only right after', !E.legalMoves(S).some((m) => m.from === sq('e5') && m.to === sq('d6')));
// 6. 成る
S = fromFen('8/4P3/8/8/8/8/8/k6K w - - 0');
ms = E.legalMoves(S).filter((m) => m.from === sq('e7'));
check('promo 4', ms.length === 4 && ms.map((m) => m.promo).sort().join('') === 'BNQR');
S = mv(S, 'e7e8n');
check('promo knight', S.board[sq('e8')] === 'N' && S.last.san === 'e8=N' && /ナイトになった/.test(S.last.text), S.last);
// 7. ピン・チェックをよけない理由
S = fromFen('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0');
check('pinned why', /キングがねらわれて/.test(E.whyIllegal(S, sq('e2'), sq('d3'))));
S = fromFen('4k3/8/8/8/8/8/8/r3K2R w K - 0');
check('in check why', /チェックをよけて/.test(E.whyIllegal(S, sq('h1'), sq('h5'))), E.whyIllegal(S, sq('h1'), sq('h5')));
check('king into attack why', /キングが取られて/.test(E.whyIllegal(S, sq('e1'), sq('d1'))));
check('knight why', /ナイトは、そこへは動けない/.test(E.whyIllegal(E.create(), sq('g1'), sq('g3'))));
check('jump why', /跳びこえられない/.test(E.whyIllegal(E.create(), sq('a1'), sq('a3'))));
check('pawn diag why', /ななめに進むのは/.test(E.whyIllegal(E.create(), sq('e2'), sq('d3'))));
// 8. 引き分け: 同じ形3回・50手・駒が足りない
S = play(E.create(), 'g1f3 g8f6 f3g1 f6g8 g1f3 g8f6 f3g1');
check('rep not yet', !S.over);
S = mv(S, 'f6g8');
check('repetition', S.over && S.over.reason === 'repetition', S.over);
S = fromFen('4k3/8/8/8/8/8/8/R3K3 w - - 99');
S = mv(S, 'a1a2');
check('fifty', S.over && S.over.reason === 'fifty', S.over);
S = fromFen('4k3/8/8/8/8/8/3p4/4K3 w - - 0');
S = mv(S, 'e1d2');
check('material K vs K', S.over && S.over.reason === 'material', S.over);
check('material KB', E.insufficient(fromFen('4k3/8/8/8/8/8/8/2B1K3 w - - 0').board));
check('material KN vs K not KR', !E.insufficient(fromFen('4k3/8/8/8/8/8/8/R3K3 w - - 0').board));
// 9. 表記の区別（Nbd2 など）
S = fromFen('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0');
S = mv(S, 'b1d2');
check('san disambig', S.last.san === 'Nbd2', S.last.san);
// 10. 取った駒
S = play(E.create(), 'e2e4 d7d5 e4d5 d8d5');
const caps = E.capturedLists(S.board);
check('captured lists', caps[0].join() === 'P' && caps[1].join() === 'P', caps);
// 11. CPU: メイト1手を見つける・指せる手を返す・でたらめ対局で駒の数が合う
S = fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0');
const cm = E.cpuMove(S, 'normal', () => 0.5);
check('cpu finds mate', cm && cm.from === sq('a1') && cm.to === sq('a8'), cm);
check('hint finds mate', (() => { const h = E.cpuMove(S, 'hint'); return h && h.to === sq('a8'); })());
let rnd = 1;
const R = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
let games = 0; let bad = 0;
for (let g = 0; g < 30; g += 1) {
  let G = E.create();
  for (let i = 0; i < 300 && !G.over; i += 1) {
    const list = E.legalMoves(G);
    const m = list[Math.floor(R() * list.length)];
    G = E.apply(G, m);
    if (G.board.filter((p) => p === 'K').length !== 1 || G.board.filter((p) => p === 'k').length !== 1) bad += 1;
  }
  games += 1;
}
check('random games keep kings', bad === 0, bad);
// CPU どうし（よわい×ふつう）で最後まで指せる
let G = E.create();
for (let i = 0; i < 160 && !G.over; i += 1) G = E.apply(G, E.cpuMove(G, i % 2 ? 'weak' : 'normal', R, 60));
check('cpu game runs', G.ply > 10, G.ply);
// replay
const rec = [];
let H = E.create();
for (let i = 0; i < 40 && !H.over; i += 1) { const m = E.cpuMove(H, 'weak', R); rec.push(m); H = E.apply(H, m); }
check('replay same', E.replay(rec).keys.join('/') === H.keys.join('/'));

console.log(`pass ${pass} / fail ${fail}`);
process.exit(fail ? 1 : 0);
