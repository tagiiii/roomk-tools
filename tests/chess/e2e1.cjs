// チェスの E2E その1: ルームの作成・参加・席・対局の同期・補助・指せない理由・メイト・もう一回・1手もどす・投了・成る・キャスリング・端末なしの参加者・みんなにみせる画面・幅 375px・退出
const L = require('./lib.cjs');
const { E, check, sq, cell } = L;
const pack = (list) => {
  let G = E.create();
  return list.split(' ').map((s) => {
    const m = { from: sq(s.slice(0, 2)), to: sq(s.slice(2, 4)), promo: s[4] ? s[4].toUpperCase() : '' };
    if (!E.legalMoves(G).some((x) => E.sameMove(x, m))) throw new Error('bad ' + s);
    G = E.apply(G, m);
    return m.promo ? { f: m.from, t: m.to, q: m.promo } : { f: m.from, t: m.to };
  });
};
const disabled = (c, i) => c.page.evaluate((s) => document.querySelector(s).disabled, cell(i));

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('alice');
  const B = await L.newClient('bob');
  const W = await L.newClient('watch');
  const code = await L.createRoom(H, 'ホスト');
  check('room code', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('room has no variant', room.v === undefined && room.aid && room.aid.names === true && room.aid.hint === true, room.aid);
  await L.joinRoom(A, 'アリス', code);
  await L.joinRoom(B, 'ボブ', code);
  room = await L.roomWhen(code, (r) => r.seats && r.seats.w && r.seats.b);
  check('seats auto', room.seats.w === 'アリス' && room.seats.b === 'ボブ', room.seats);
  await L.open(W, '?watch=' + code);
  await L.waitText(W, '#lobbyJoinCode', code);
  await L.waitText(A, '#seatView', 'アリス');
  check('guest seat view', (await L.text(A, '#seatView')).includes('白（先に指す）アリス（あなた）'), await L.text(A, '#seatView'));
  check('summary aid', (await L.text(H, '#sumAid')).includes('駒の名前と動き方'), await L.text(H, '#sumAid'));
  await L.shot(H, 'e1-lobby-host');

  // はじめる
  await H.page.click('#btnStartGame');
  for (const c of [H, A, B, W]) await L.waitScreen(c, 'game');
  check('status white turn on A', (await L.status(A)).includes('あなたの番（白）'), await L.status(A));
  check('status on B', (await L.status(B)).includes('白（アリス）が考え中'), await L.status(B));
  // 黒の人は盤を黒が手前に
  const firstA = await A.page.$eval('#board .ch-cell', (x) => x.dataset.i);
  const firstB = await B.page.$eval('#board .ch-cell', (x) => x.dataset.i);
  check('board orientation', firstA === '0' && firstB === '63', [firstA, firstB]);
  check('names on pieces', (await A.page.$$('#board .ch-piece__name')).length === 32);
  check('hint only for turn', (await L.visible(A, '#btnHint')) && !(await L.visible(B, '#btnHint')));
  check('B cells disabled', await disabled(B, sq('e7')));
  // 選ぶと動き方と点
  await A.page.click(cell(sq('g1')));
  check('spots knight', JSON.stringify(await L.spots(A)) === JSON.stringify([sq('h3'), sq('f3')].sort((a, b) => a - b)), await L.spots(A));
  check('info knight', (await L.text(A, '#pieceInfo')).includes('「L」の形'), await L.text(A, '#pieceInfo'));
  await A.page.click(cell(sq('g3')));
  check('illegal reason', (await L.text(A, '#gameMsg')).includes('ナイトは、そこへは動けない'), await L.text(A, '#gameMsg'));
  // 指す
  await L.move(A, sq('e2'), sq('e4'));
  await L.waitText(B, '#lastLine', 'ポーン e2→e4');
  await L.waitText(W, '#lastLine', 'e2→e4');
  check('sync last line', (await L.lastLine(W)).includes('1手目　白：ポーン e2→e4（e4）'), await L.lastLine(W));
  check('B turn status', (await L.status(B)).includes('あなたの番（黒）'));
  // 相手の駒を押したとき
  await B.page.click(cell(sq('e4')));
  check('opp piece msg', (await L.text(B, '#gameMsg')).includes('相手の駒'), await L.text(B, '#gameMsg'));
  // おすすめの手（黒）
  await B.page.click('#btnHint');
  await B.page.waitForFunction(() => document.querySelector('#hintText').textContent.includes('おすすめ'));
  check('hint cells', (await B.page.$$('#board .ch-cell.is-hint')).length === 2);
  check('hint not written', (await L.roomOf(code)).game.moves.length === 1);
  check('hint counted', await L.waitStats(B, 'hint', 1));
  // スカラーズメイト
  await L.move(B, sq('e7'), sq('e5'));
  await L.waitText(A, '#lastLine', 'e7→e5');
  await L.move(A, sq('f1'), sq('c4'));
  await L.waitText(B, '#lastLine', 'f1→c4');
  await L.move(B, sq('b8'), sq('c6'));
  await L.waitText(A, '#lastLine', 'b8→c6');
  await L.move(A, sq('d1'), sq('h5'));
  await L.waitText(B, '#lastLine', 'd1→h5');
  await L.move(B, sq('g8'), sq('f6'));
  await L.waitText(A, '#lastLine', 'g8→f6');
  await L.move(A, sq('h5'), sq('f7'));
  await L.waitText(W, '#gameStatus', 'チェックメイト');
  await L.waitText(B, '#gameStatus', 'チェックメイト');
  check('mate text', (await L.status(B)).includes('チェックメイト。白（アリス）の勝ち！'), await L.status(B));
  check('mate san', (await L.lastLine(H)).includes('Qxf7#'), await L.lastLine(H));
  check('captured shown', (await A.page.$$('#sideBottom .ch-caps .ch-piece')).length === 1);
  check('result host buttons', (await L.visible(H, '#btnAgain')) && !(await L.visible(A, '#btnAgain')) && (await L.visible(A, '#resultWait')));
  check('finish counted once', await L.waitStats(A, 'finish', 1));
  await L.shot(W, 'e1-mate-watch');
  await L.shot(B, 'e1-mate-black');

  // もう一回（白と黒を入れかえる）
  await H.page.click('#btnAgain');
  await L.waitText(B, '#gameStatus', 'あなたの番（白）');
  room = await L.roomOf(code);
  check('swapped', room.game.seats.w === 'ボブ' && room.game.seats.b === 'アリス', room.game.seats);
  await L.move(B, sq('d2'), sq('d4'));
  await L.waitText(A, '#lastLine', 'd2→d4');
  // 1手もどす（ホスト）
  await H.page.click('#btnUndo');
  room = await L.roomWhen(code, (r) => !r.game.moves);
  check('undo', !room.game.moves, room.game.moves);
  await L.waitText(B, '#gameStatus', 'あなたの番（白）');
  // 投了（黒のアリスが、白の番に）
  await A.page.click('#btnResign');
  await L.waitText(B, '#gameStatus', '投了');
  check('resign text', (await L.status(B)).includes('黒（アリス）が投了。白（ボブ）の勝ち！'), await L.status(B));
  await H.page.click('#btnUndo');
  await L.waitFor(async () => !(await L.status(B)).includes('投了'));
  check('undo resign', !(await L.roomOf(code)).game.resign);

  // 成る（記録を入れて、最後だけ画面で）
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game', { moves: pack('a2a4 h7h5 a4a5 h5h4 a5a6 h4h3 a6b7 h3g2'), rev: 50 });
  await L.waitText(B, '#lastLine', 'h3→g2');
  await L.move(B, sq('b7'), sq('a8'), 'N');
  await L.waitText(A, '#lastLine', 'ナイトになった');
  check('promo san', (await L.lastLine(A)).includes('bxa8=N'), await L.lastLine(A));
  check('promo room', (await L.roomOf(code)).game.moves[8].q === 'N');
  // キャスリング
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game', { moves: pack('e2e4 e7e5 g1f3 b8c6 f1c4 g8f6'), rev: 60 });
  await L.waitText(B, '#lastLine', 'g8→f6');
  await B.page.click(cell(sq('e1')));
  check('castle info', (await L.text(B, '#pieceInfo')).includes('キャスリングができる'), await L.text(B, '#pieceInfo'));
  await B.page.click(cell(sq('g1')));
  await L.waitText(A, '#lastLine', 'キャスリング（キングの側）');
  const bd = await L.readBoard(A);
  check('castle rook', bd[sq('f1')].includes('白のルーク') && bd[sq('g1')].includes('白のキング'), [bd[sq('f1')], bd[sq('g1')]]);

  // 補助を変える（ホスト・対局中）
  await H.page.click('#btnAid');
  await H.page.click('#dialogAid input[value="none"]');
  await H.page.click('#btnAidClose');
  await L.waitFor(async () => (await A.page.$$('#board .ch-piece__name')).length === 0);
  check('aid off names gone', (await A.page.$$('#board .ch-piece__name')).length === 0);
  check('aid off hint gone', !(await L.visible(A, '#btnHint')));

  // 待合室へ
  await H.page.click('#btnReset');
  for (const c of [H, A, B]) await L.waitScreen(c, 'waiting');
  // 端末なしの参加者
  await H.page.fill('#proxyName', 'カイ');
  await H.page.click('#btnAddProxy');
  await L.waitText(H, '#lobbyPeople', 'カイ');
  check('proxy shown host', (await L.text(H, '#lobbyPeople')).includes('端末なし'));
  await L.waitText(A, '#lobbyPeople', 'カイ');
  check('proxy mark hidden for guest', !(await L.text(A, '#lobbyPeople')).includes('端末なし'));
  await H.page.selectOption('#seat1', 'カイ');
  room = await L.roomWhen(code, (r) => r.seats.b === 'カイ');
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  room = await L.roomOf(code);
  const white = room.game.seats.w === 'アリス' ? A : B;
  await L.waitScreen(white, 'game');
  await L.move(white, sq('e2'), sq('e4'));
  await L.waitText(H, '#gameStatus', '代わりに指してね');
  await L.move(H, sq('e7'), sq('e5'));
  await L.waitText(white, '#lastLine', 'e7→e5');
  check('proxy move', (await L.roomOf(code)).game.moves.length === 2);

  // 幅 375px
  const M = await L.newClient('mobile', { viewport: { width: 375, height: 760 } });
  await L.open(M, '?watch=' + code);
  await L.waitScreen(M, 'game');
  check('mobile overflow', (await L.overflow(M)) <= 0, await L.overflow(M));
  await L.shot(M, 'e1-mobile-watch');
  await white.page.setViewportSize({ width: 375, height: 760 });
  check('mobile overflow guest', (await L.overflow(white)) <= 0, await L.overflow(white));
  await L.shot(white, 'e1-mobile-guest');
  await white.page.setViewportSize({ width: 1100, height: 900 });

  // 退出・ルームを閉じる
  await H.page.click('#btnReset');
  await L.waitScreen(A, 'waiting');
  await A.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  room = await L.roomWhen(code, (r) => !r.players['アリス']);
  check('guest left', !room.players['アリス']);
  await H.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  check('room closed', (await L.roomOf(code)) === null);
  await L.waitScreen(W, 'watch-end');
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
