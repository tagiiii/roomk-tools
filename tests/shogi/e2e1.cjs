// 将棋の E2E その1: 作成・参加・席・観戦・みんなにみせる画面・盤えらび・補助・対局の同期・反則の知らせ・
// 番でない人・1手もどす・投了・詰み・結果・もう一回・待合室へ・端末なしの参加者・幅 375px・退出・ルームを閉じる
const L = require('./lib.cjs');
const { E, check, sleep, cell, waitFor } = L;

// 5五将棋で、最後の1手で詰む記録を作る（決まった種のくじ）
function mateGame() {
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let g = 0; g < 500; g += 1) {
    let G = E.create('mini');
    const moves = [];
    while (!G.over && moves.length < 120) {
      const ms = E.legalMoves(G);
      // 王手をかける手を少し選びやすくして、早く詰むようにする
      const checks = ms.filter((m) => E.apply(G, m).check);
      const pool = checks.length && rnd() < 0.6 ? checks : ms;
      const m = pool[Math.floor(rnd() * pool.length)];
      moves.push(m);
      G = E.apply(G, m);
    }
    if (G.over && G.over.reason === 'mate' && !moves.some((m) => m.promote === false && false)) return moves;
  }
  throw new Error('詰みの記録が作れなかった');
}
const pack = (m) => (m.from < 0 ? { f: -1, t: m.to, d: m.drop, p: false } : { f: m.from, t: m.to, p: !!m.promote });

(async () => {
  const server = await L.startServer();
  // エミュレーターにルールを読み込ませる（自動では当たらないことがある）
  const rules = require('fs').readFileSync(require('path').join(process.env.SH_WORK, 'database.rules.json'), 'utf8');
  await fetch(L.DB + '/.settings/rules.json?ns=' + L.NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: rules });
  await L.launch();

  // ── 作成・参加 ──
  const H = await L.newClient('host');
  const code = await L.createRoom(H, 'メンター');
  check('A1 ルームができる', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('A2 はじめの盤は5五将棋・補助は動ける所だけ', room.v === 'mini' && room.aid.spots === true && room.aid.arrows === false, { v: room.v, aid: room.aid });
  const A = await L.newClient('aoi');
  await L.joinRoom(A, 'あおい', code);
  const B = await L.newClient('sora');
  await L.joinRoom(B, 'そら', code);
  room = await L.roomWhen(code, (r) => r.seats && r.seats.s === 'あおい' && r.seats.g === 'そら');
  check('A3 入った順に先手・後手', room.seats.s === 'あおい' && room.seats.g === 'そら', room.seats);
  const C = await L.newClient('hikari');
  await L.joinRoom(C, 'ひかり', code);
  check('A4 3人目は観戦', await waitFor(async () => (await L.text(C, '#lobbyPeople')).includes('観戦')));
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  check('A5 みんなにみせる画面は参加のしかたとコード', await waitFor(async () => (await L.visible(W, '#lobbyJoin')) && (await L.text(W, '#lobbyJoinCode')) === code));
  check('A6 ゲストには盤が「5五将棋」と出る', (await L.text(A, '#lobbyVariantView')).includes('5五将棋'));

  // 盤を本将棋にしてもどす・補助を変える
  await H.page.click('#lobbyVariant input[value="hon"]');
  check('A7 盤を本将棋にすると全員に届く', await waitFor(async () => (await L.text(A, '#lobbyVariantView')).includes('本将棋')));
  await H.page.click('#lobbyVariant input[value="mini"]');
  await waitFor(async () => (await L.text(A, '#lobbyVariantView')).includes('5五将棋'));
  await H.page.click('#lobbyAid input[data-key="arrows"]');
  check('A8 補助の変更が届く', await waitFor(async () => (await L.text(A, '#lobbyAidView')).includes('動ける向きの印')));
  check('A9 ゲストの「はじめる」はない', !(await L.visible(A, '#btnStartGame')));

  // ── 対局 ──
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  await L.waitScreen(B, 'game');
  await L.waitScreen(W, 'game');
  check('B1 先手の画面に「あなたの番」', (await L.status(A)).startsWith('あなたの番（▲先手）'), await L.status(A));
  check('B2 後手の画面に「考え中」', (await L.status(B)).includes('考え中'), await L.status(B));
  check('B3 後手の画面は盤が逆向き（左上が１五）', (await B.page.getAttribute('#board .sh-cell >> nth=0', 'data-i')) === '24');
  check('B4 先手の画面は先手が手前（左上が５一）', (await A.page.getAttribute('#board .sh-cell >> nth=0', 'data-i')) === '0');
  check('B5 動ける向きの印が出る', (await A.page.$$('#board .sh-arrows')).length === 12);
  check('B6 後手は先手の番に押せない', await B.page.isDisabled(cell(4)));
  check('B7 観戦の人は押せない', await C.page.isDisabled(cell(15)));
  check('B8 観戦の人には「1手もどす」がない', !(await L.visible(C, '#btnUndo')) && !(await L.visible(C, '#btnResign')));
  await A.page.click(cell(15));
  check('B9 歩を選ぶと動ける所の点が1つ', JSON.stringify(await L.spots(A)) === '[10]', await L.spots(A));
  await A.page.click(cell(0));
  check('B10 動けない所を押すと理由が出る', (await L.text(A, '#gameMsg')).includes('そこへは動けない'), await L.text(A, '#gameMsg'));
  await L.move(A, 15, 10);
  room = await L.roomWhen(code, (r) => r.game && r.game.rev === 1);
  check('B11 指した手がルームに入る', room.game.moves && room.game.moves.length === 1 && room.game.moves[0].t === 10, room.game.moves);
  check('B12 みんなの画面に直前の手', await waitFor(async () => (await L.lastLine(B)).includes('▲５三歩') && (await L.lastLine(W)).includes('▲５三歩') && (await L.lastLine(C)).includes('▲５三歩')));
  check('B13 後手の番になる', (await L.status(B)).startsWith('あなたの番（△後手）'), await L.status(B));
  // 後手: 角 ４一 → １四
  await L.move(B, 1, 19);
  await L.roomWhen(code, (r) => r.game.rev === 2);
  check('B14 先手の画面に △１四角', await waitFor(async () => (await L.lastLine(A)).includes('△１四角')));

  // 1手もどす（ホスト）
  await H.page.click('#btnUndo');
  room = await L.roomWhen(code, (r) => r.game.rev === 3);
  check('C1 1手もどすと記録が1手へる', room.game.moves.length === 1, room.game.moves);
  check('C2 みんなの画面がもどる', await waitFor(async () => (await L.lastLine(A)).includes('▲５三歩') && (await L.status(B)).startsWith('あなたの番')));

  // 投了（後手） → ホストが取り消す
  await B.page.click('#btnResign');
  room = await L.roomWhen(code, (r) => r.game.resign === 'g');
  check('C3 投了が入る', room.game.resign === 'g' && room.game.ended === true);
  check('C4 結果「後手が投了。先手の勝ち」', await waitFor(async () => (await L.status(W)).includes('△後手（そら）が投了。▲先手（あおい）の勝ち！')), await L.status(W));
  check('C5 ホストに次のボタン・ゲストは待つ', (await L.visible(H, '#btnAgain')) && (await L.visible(A, '#resultWait')) && !(await L.visible(W, '#resultBox')));
  check('C6 finish は投了した端末で1回', await L.waitStats(B, 'finish', 1));
  await H.page.click('#btnUndo');
  room = await L.roomWhen(code, (r) => r.game.rev === 5);
  check('C7 1手もどすで投了を取り消す', room.game.resign == null && room.game.moves.length === 1, room.game);

  // ── 詰みまで（途中の記録はエミュレーターに直接入れ、最後の1手を画面で指す） ──
  const moves = mateGame();
  const last = moves[moves.length - 1];
  const mover = (moves.length - 1) % 2;   // 0 先手・1 後手
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game', { moves: moves.slice(0, -1).map(pack), rev: 10 });
  const P = mover === 0 ? A : B;
  check('D1 記録を入れると局面が届く', await waitFor(async () => (await L.lastLine(P)).startsWith((moves.length - 1) + '手目')), await L.lastLine(P));
  await L.move(P, last.from < 0 ? last.drop : last.from, last.to, last.from >= 0 && E.legalMoves(E.replay('mini', moves.slice(0, -1))).filter((m) => m.from === last.from && m.to === last.to).length === 2 ? last.promote : undefined);
  room = await L.roomWhen(code, (r) => r.game.rev === 11);
  check('D2 詰みの手が入る', room.game.moves.length === moves.length && room.game.ended === true, room.game.moves?.length);
  const winnerLabel = mover === 0 ? '▲先手（あおい）の勝ち！' : '△後手（そら）の勝ち！';
  check('D3 結果「詰み」', await waitFor(async () => (await L.status(W)) === '詰み。' + winnerLabel), await L.status(W));
  check('D4 勝った人の札に「勝ち」', (await L.text(H, mover === 0 ? '#sideBottom' : '#sideTop')).includes('勝ち'));
  check('D5 finish は取り消した投了と合わせて1回（ended）', await L.waitStats(P, 'finish', mover === 1 ? 1 : 1));
  await L.shot(W, 'e2e1-mate-watch');

  // もう一回（先手と後手を入れかえる）。補助の「先手だけ」も人についていく
  await L.rest('PATCH', L.ROOMS + '/' + code + '/aid', { who: 's' });
  await H.page.click('#btnAgain');
  room = await L.roomWhen(code, (r) => r.game && r.game.id === 2);
  check('E1 もう一回で先手と後手が入れかわる', room.game.seats.s === 'そら' && room.game.seats.g === 'あおい' && !room.game.moves, room.game.seats);
  check('E1b 補助の「先手だけ」は「後手だけ」になる（あおいについていく）', room.aid.who === 'g', room.aid);
  check('E2 そらの画面に「あなたの番」', await waitFor(async () => (await L.status(B)).startsWith('あなたの番（▲先手）')));
  check('E3 あおいの画面は盤が逆向き', await waitFor(async () => (await A.page.getAttribute('#board .sh-cell >> nth=0', 'data-i')) === '24'));
  check('E4 start と again を数える', (await L.waitStats(H, 'again', 1)) && (await L.waitStats(H, 'start', 2)));

  // この対局をやめる → 待合室
  await H.page.click('#btnReset');
  await L.waitScreen(A, 'waiting');
  room = await L.roomOf(code);
  check('E5 待合室にもどる・対局は消える', room.status === 'waiting' && !room.game, room.status);

  // ── 端末なしの参加者（ホストが代わりに指す）・本将棋 ──
  await H.page.fill('#proxyName', 'てつ');
  await H.page.click('#btnAddProxy');
  await L.roomWhen(code, (r) => r.proxies && r.proxies['てつ']);
  await H.page.selectOption('#seat0', 'てつ');
  await H.page.selectOption('#seat1', 'ひかり');
  await H.page.click('#lobbyVariant input[value="hon"]');
  room = await L.roomWhen(code, (r) => r.seats.s === 'てつ' && r.seats.g === 'ひかり' && r.v === 'hon');
  check('F1 端末なしの人を席に', room.seats.s === 'てつ', room.seats);
  check('F2 「端末なし」の印はホストだけ', (await L.text(H, '#lobbyPeople')).includes('端末なし') && !(await L.text(A, '#lobbyPeople')).includes('端末なし'));
  await H.page.click('#btnStartGame');
  await L.waitScreen(C, 'game');
  check('F3 本将棋は81ます', (await C.page.$$('#board .sh-cell')).length === 81);
  check('F4 ホストに「代わりに指してね」', await waitFor(async () => (await L.status(H)).includes('▲先手（てつ）の番。代わりに指してね')), await L.status(H));
  // ▲７六歩（7七 → 7六 = 56 → 47）
  await L.move(H, 56, 47);
  check('F5 ホストが代わりに指せる', await waitFor(async () => (await L.lastLine(C)).includes('▲７六歩')));
  // △３四歩（24 → 33）、▲２二角成（64 → 16 成る）
  await L.move(C, 24, 33);
  await waitFor(async () => (await L.lastLine(H)).includes('△３四歩'));
  await L.move(H, 64, 16, true);
  check('F6 成る・成らないを聞いて「角成」', await waitFor(async () => (await L.lastLine(C)).includes('▲２二角成')));
  check('F7 取った角が持ち駒に', (await L.text(H, '#sideBottom')).includes('持ち駒の角') || (await H.page.$$('#sideBottom .sh-handpiece')).length === 1);
  check('F8 board-9 を数える', await L.waitStats(H, 'board-9', 1));

  // ── 幅 375px ──
  const N = await L.newClient('narrow', { viewport: { width: 375, height: 812 } });
  await L.joinRoom(N, 'なな', code).catch(() => {});
  await L.waitScreen(N, 'game');
  check('G1 幅375pxで横にはみ出さない', (await L.overflow(N)) <= 0, await L.overflow(N));
  await L.shot(N, 'e2e1-narrow');
  await L.shot(H, 'e2e1-host-hon');

  // ── 退出・ルームを閉じる ──
  await N.page.click('#btnLeave');
  await L.waitScreen(N, 'top');
  room = await L.roomWhen(code, (r) => !r.players['なな']);
  check('H1 退出すると在室が消える', !room.players['なな']);
  await H.page.click('#btnLeave');
  check('H2 ルームを閉じると全員トップへ', await waitFor(async () => (await L.screen(A)) === 'top' && (await L.screen(C)) === 'top'));
  check('H3 みんなにみせる画面は終わりの表示', await waitFor(async () => (await L.screen(W)) === 'watch-end'));
  check('H4 ルームが消える', (await L.roomOf(code)) === null);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
