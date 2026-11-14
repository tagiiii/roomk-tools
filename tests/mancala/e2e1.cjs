// マンカラ E2E その1: 作成・参加・席・観戦・みんなにみせる画面・補助・対局の同期（動き）・番でない人・1手もどす・最後まで・もう一回・待合室へ・端末なしの参加者・幅・退出・ルームを閉じる
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, hole } = L;
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const C = await L.newClient('riku');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 作成・参加・席 ──
  await L.open(H);
  check('A0 トップの主ボタンは1つ', (await H.page.$$('#screen-top .btn-primary')).length === 1);
  await H.page.click('#btnGoCreate');
  await H.page.fill('#hostName', 'メンター');
  await H.page.click('#btnCreateRoom');
  await L.waitScreen(H, 'waiting');
  const code = (await L.text(H, '#roomCodeLabel')).trim();
  check('A1 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('A2 はじめの設定', room.status === 'waiting' && room.aid.who === 'both' && room.aid.confirm === true && room.aid.hint === false && room.moveTime === 0, room);
  check('A3 room-create', await L.waitStats(H, 'room-create', 1));
  check('A4 1人では始められない', await H.page.isDisabled('#btnStartGame'));

  await L.joinRoom(A, 'あおい', code);
  room = await L.roomWhen(code, (r) => r.seats?.b === 'あおい');
  check('A5 入った人が先の席', room.seats?.b === 'あおい', room.seats);
  await L.joinRoom(B, 'そら', code);
  room = await L.roomWhen(code, (r) => r.seats?.w === 'そら');
  check('A6 2人目は後', room.seats?.w === 'そら');
  check('A7 2人そろうと始められる', await waitFor(async () => !(await H.page.isDisabled('#btnStartGame'))));
  await L.joinRoom(C, 'りく', code);
  check('A8 3人目は観戦', await waitFor(async () => (await L.text(H, '#lobbyPeople')).includes('りく観戦')), await L.text(H, '#lobbyPeople'));
  check('A9 参加者の席の表示', await waitFor(async () => (await L.text(A, '#seatView')).includes('先あおい（あなた）')), await L.text(A, '#seatView'));

  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('A10 みんなにみせる画面に参加のしかた', await L.visible(W, '#lobbyJoin') && (await L.text(W, '#lobbyJoinCode')) === code);
  check('A11 みんなにみせる画面は参加者に入らない', Object.keys((await L.roomOf(code)).players).length === 4);
  check('A12 みんなにみせる画面の題名', (await W.page.title()).includes('みんなにみせる画面 | マンカラ'));

  // 補助: いい手に印をオン
  await H.page.check('#lobbyAid input[data-key=hint]');
  check('A13 補助が参加者に届く', await waitFor(async () => (await L.text(A, '#lobbyAidView')) === 'ふたりとも：まく前にたしかめる・いい手に印を出す'), await L.text(A, '#lobbyAidView'));
  await L.shot(H, 'room-lobby-host');

  // ── B. 対局 ──
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  await L.waitScreen(B, 'game');
  await L.waitScreen(W, 'game');
  check('B1 start・players-2', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-2', 1));
  check('B2 先（あおい）の下は先の穴', same(await L.bottomRow(A), [0, 1, 2, 3, 4, 5]));
  check('B3 後（そら）の下は後の穴', same(await L.bottomRow(B), [7, 8, 9, 10, 11, 12]), await L.bottomRow(B));
  check('B4 観戦・みんなにみせる画面は先が下', same(await L.bottomRow(C), [0, 1, 2, 3, 4, 5]) && same(await L.bottomRow(W), [0, 1, 2, 3, 4, 5]));
  check('B5 先の人だけ押せる', (await L.playable(A)).length === 6 && (await L.playable(B)).length === 0 && (await L.playable(C)).length === 0 && (await L.playable(H)).length === 0);
  check('B6 あなたの番の表示', (await L.status(A)).includes('あなたの番'), await L.status(A));
  check('B7 相手は考え中', (await L.status(B)).includes('先（あおい）が考え中'), await L.status(B));
  check('B8 いい手に印（穴2 がもう1回）', same(await L.hints(A), [2]), await L.hints(A));
  check('B9 番でない人の画面に印は出ない', (await L.hints(B)).length === 0);

  // 先が 穴2（もう1回）→ 穴0
  await A.page.click(hole(2));
  check('B10 たしかめるは自分の画面だけ', await L.visible(A, '#confirmBox') && !(await L.visible(B, '#confirmBox')));
  await A.page.click('#btnPlace');
  await sleep(400);
  check('B11 相手の画面でも動く', (await L.status(B)).includes('まいている'), await L.status(B));
  await Promise.all([L.settled(A), L.settled(B), L.settled(W)]);
  const g1 = E.play(E.newGame(), 2);
  check('B12 盤がそろう', same(await L.readBoard(B), g1.board) && same(await L.readBoard(W), g1.board) && same(await L.readBoard(C), g1.board));
  check('B13 もう1回で先のまま', (await L.turnOf(B)) === 'b' && (await L.status(A)).includes('もう1回'));
  await A.page.click(hole(0));
  await A.page.click(hole(0));
  await Promise.all([L.settled(A), L.settled(B)]);
  const g2 = E.play(g1, 0);
  check('B14 後の番になる', (await L.turnOf(A)) === 'w' && (await L.playable(B)).length === E.legalMoves(g2.board, 'w').length);
  room = await L.roomOf(code);
  check('B15 ルームの盤', same(room.game.board, g2.board) && room.game.ply === 2 && room.game.rev === 2, room.game);
  // 後が 1手
  const mv = E.legalMoves(g2.board, 'w')[0];
  await B.page.click(hole(mv));
  await B.page.click(hole(mv));
  await Promise.all([L.settled(A), L.settled(B)]);
  const g3 = E.play(g2, mv);
  check('B16 後の手がそろう', same(await L.readBoard(A), g3.board) && same(await L.readBoard(H), g3.board));
  await L.shot(B, 'room-game-sora');
  await L.shot(W, 'room-game-watch');

  // 1手もどす（ホスト）
  check('B17 ホストだけに操作', await L.visible(H, '#tools') && !(await L.visible(A, '#tools')));
  await H.page.click('#btnUndo');
  room = await L.roomWhen(code, (r) => r.game.ply === 2);
  check('B18 1手もどす', same(room.game.board, g2.board) && room.game.turn === 'w' && room.game.rev === 4, room.game);
  check('B19 もどしたら動かさない', await waitFor(async () => same(await L.readBoard(A), g2.board) && !(await L.status(A)).includes('まいている')));

  // 最後の1手の手前の局面を REST で作る（先の穴5 に1つ。まくとゴールに入って先の側が空 → おわり）
  const nearEnd = [0, 0, 0, 0, 0, 1, 20, 2, 0, 0, 0, 0, 3, 22];
  const gid = room.game.id;
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game', { board: nearEnd, turn: 'b', ply: 30, rev: 50, last: -1, path: null, capture: null, extra: null, hist: [{ board: g2.board, turn: 'w', last: 0, ply: 29 }] });
  await waitFor(async () => same(await L.readBoard(A), nearEnd));
  await A.page.click(hole(5));
  await A.page.click(hole(5));
  await L.settled(A, 20000);
  await L.settled(B, 20000);
  room = await L.roomWhen(code, (r) => r.game.over === true);
  check('B20 おわり', room.game.over === true && room.game.board[6] === 21 && room.game.board[13] === 27, room.game);
  check('B21 結果の表示', (await L.status(B)).includes('後（そら）の勝ち！') && (await L.status(B)).includes('先 21 ー 後 27'), await L.status(B));
  check('B22 勝った人の札', await waitFor(async () => (await L.text(W, '.mc-seat--w')).includes('勝ち')));
  check('B23 finish は1回', await L.waitStats(A, 'finish', 1));
  check('B24 ホストに次のボタン・参加者は待つ', await L.visible(H, '#resultHost') && await L.visible(A, '#resultWait') && !(await L.visible(W, '#resultBox')));
  await L.shot(W, 'room-result-watch');

  // もう一回（先と後を入れかえる）
  await H.page.click('#btnAgain');
  room = await L.roomWhen(code, (r) => r.game.id === gid + 1);
  check('B25 もう一回で入れかわる', room.game.seats.b === 'そら' && room.game.seats.w === 'あおい' && room.game.ply === 0, room.game.seats);
  check('B26 again', await L.waitStats(H, 'again', 1));
  check('B27 そらの下は先の穴に', await waitFor(async () => same(await L.bottomRow(B), [0, 1, 2, 3, 4, 5])));

  // 待合室へ（対局をやめる）
  await H.page.click('#btnReset');
  await L.waitScreen(A, 'waiting');
  room = await L.roomOf(code);
  check('B28 待合室へ・対局は消える', room.status === 'waiting' && !room.game, room.status);

  // ── C. 端末なしの参加者 ──
  await H.page.fill('#proxyName', 'はな');
  await H.page.click('#btnAddProxy');
  check('C1 端末なしの参加者を足す', await waitFor(async () => !!(await L.roomOf(code)).proxies?.['はな']));
  check('C2 端末なしの印はホストだけ', (await L.text(H, '#lobbyPeople')).includes('端末なし') && !(await L.text(A, '#lobbyPeople')).includes('端末なし'));
  await H.page.selectOption('#seatB', { label: 'はな（端末なし）' });
  await L.roomWhen(code, (r) => r.seats?.b === 'はな');
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  check('C3 ホストが代わりにまける', await waitFor(async () => (await L.playable(H)).length === 6) && (await L.status(H)).includes('代わりにまいてね'), await L.status(H));
  await H.page.click(hole(1));
  await H.page.click(hole(1));
  room = await L.roomWhen(code, (r) => r.game.ply === 1);
  check('C4 代わりの手が入る', same(room.game.board, E.play(E.newGame(), 1).board));
  await L.settled(H);

  // ── D. 幅 375px・退出・閉じる ──
  const M = await L.newClient('mobile', { viewport: { width: 375, height: 812 } });
  await L.joinRoom(M, 'みき', code).catch(() => {});
  await L.waitScreen(M, 'game');
  check('D1 375: はみ出しなし（観戦）', (await L.overflow(M)) <= 0, await L.overflow(M));
  await L.shot(M, 'room-375');
  await C.page.click('#btnLeave');
  await L.waitScreen(C, 'top');
  check('D2 退出すると在室が消える', await waitFor(async () => !(await L.roomOf(code)).players?.['りく']));
  await H.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  check('D3 ルームを閉じると消える', (await L.roomOf(code)) === null);
  check('D4 みんなにみせる画面はおわりの表示', await waitFor(async () => (await L.screen(W)) === 'watch-end'));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
