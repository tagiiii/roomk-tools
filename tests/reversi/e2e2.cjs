// リバーシ E2E その2: 1手の制限時間（残り時間・時間切れで CPU が置く・ホストが切れている間は止めて、戻ると数えなおす）・切断と代わりに置く・同じ名前の別人・再読み込み・途中から観戦・ホストの再読み込み
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, cell } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'そら', code);
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  await L.roomWhen(code, (r) => r.seats?.b === 'あおい' && r.seats?.w === 'そら');

  // ── T. 1手の制限時間 ──
  await H.page.selectOption('#moveTime', '15');
  check('T1 制限時間が参加者に届く', await waitFor(async () => (await L.text(A, '#moveTimeView')) === '15秒（過ぎたら CPU が代わりに置く）'), await L.text(A, '#moveTimeView'));
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  let room = await L.roomOf(code);
  check('T2 対局に制限時間が入る', room.game.moveTime === 15 && typeof room.game.turnAt === 'number', room.game);
  check('T3 番の人に残り時間', await waitFor(async () => /^b:のこり 1[45]秒$/.test(await L.clockText(A))), await L.clockText(A));
  check('T4 みんなにみせる画面にも残り時間', /^b:のこり 1[45]秒$/.test(await L.clockText(W)), await L.clockText(W));
  await sleep(1200);
  check('T5 残り時間が減る', /^b:のこり 1[34]秒$/.test(await L.clockText(A)), await L.clockText(A));
  await A.page.click(cell(19));
  check('T6 置くと相手の番の時間になる', await waitFor(async () => /^w:のこり 1[45]秒$/.test(await L.clockText(W))), await L.clockText(W));

  // 残り4秒にする → 色が変わる
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/turnAt', Date.now() - 11000);
  check('T7 残り5秒から色が変わる', await waitFor(async () => B.page.$eval('.rv-seat--w .rv-seat__clock', (x) => x.classList.contains('is-hurry'))));
  // 時間切れ → CPU が白の代わりに置く
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/turnAt', Date.now() - 20000);
  room = await L.roomWhen(code, (r) => r.game.ply === 2, 6000);
  check('T8 時間切れで CPU が置く', room.game.ply === 2 && room.game.auto === 'w' && room.game.turn === 'b', { ply: room.game.ply, auto: room.game.auto });
  const autoAt = E.coord(room.game.last);
  check('T9 みんなに「時間切れ」のお知らせ', await waitFor(async () => (await L.status(W)).startsWith('時間切れ。CPU が白の代わりに ' + autoAt + ' に置いたよ。') && (await L.status(A)).startsWith('時間切れ。CPU が白の代わりに')), await L.status(W));
  await sleep(2500);
  room = await L.roomOf(code);
  check('T10 CPU は1回だけ置く（次の番は時間が残っている）', room.game.ply === 2, room.game.ply);
  check('T11 次の番の時間は最初から', /^b:のこり 1[2345]秒$/.test(await L.clockText(A)), await L.clockText(A));
  await A.page.click(cell(Number(Object.keys(E.legalMoves(room.game.board, 'b'))[0])));
  room = await L.roomWhen(code, (r) => r.game.ply === 3);
  check('T12 人が置くと「時間切れ」のお知らせは消える', !room.game.auto && !(await L.status(W)).includes('時間切れ'));

  // ホストが切れている間は、参加者の画面はホストを待っていて押せないので、時計を止めて CPU も置かない
  await H.page.evaluate(() => firebase.database().goOffline());
  H.offlineOk = true;
  check('T13 ホストの切断が届く', await waitFor(async () => (await L.visible(A, '#hostOffOverlay')), 15000));
  // 白（そら）の番の締め切りを過ぎさせる
  const oldAt = Date.now() - 20000;
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/turnAt', oldAt);
  await sleep(3500);
  room = await L.roomOf(code);
  check('T14 ホストが切れている間は CPU が置かない', room.game.ply === 3, room.game.ply);
  check('T15 ホストが切れている間は残り時間を出さない', (await L.clockText(B)) === '' && (await L.clockText(W)) === '', await L.clockText(B));
  await H.page.evaluate(() => firebase.database().goOnline());
  check('T16 ホストが戻るとお知らせが消える', await waitFor(async () => !(await L.visible(A, '#hostOffOverlay')), 15000));
  room = await L.roomWhen(code, (r) => r.game.turnAt > oldAt + 10000, 6000);
  check('T17 ホストが戻ると、その番の時間を最初から数えなおす', room.game.turnAt > oldAt + 10000 && room.game.ply === 3, { at: room.game.turnAt, ply: room.game.ply });
  check('T18 戻ったあとの残り時間', await waitFor(async () => /^w:のこり 1[2345]秒$/.test(await L.clockText(B))), await L.clockText(B));

  // 対局中に入った人
  const V = await L.newClient('hikari');
  await L.joinRoom(V, 'ひかり', code).catch(() => {});
  check('R1 対局中に入った人は観戦', await waitFor(async () => (await L.screen(V)) === 'game' && (await L.text(V, '#barMe')).includes('観戦中')), await L.text(V, '#barMe'));
  check('R2 観戦の人は押せない', await V.page.isDisabled(cell(0)));

  // ── D. 切断・代わりに置く・同じ名前の別人・再読み込み ──
  // 時間制限があると CPU が進めてしまうので、ここからは時間を戻しておく（ホストの操作はないので REST で）
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/moveTime', 0);
  room = await L.roomOf(code);
  // 黒（あおい）の番まで進める
  if (room.game.turn === 'w') {
    const mv = Number(Object.keys(E.legalMoves(room.game.board, 'w'))[0]);
    await B.page.click(cell(mv));
    room = await L.roomWhen(code, (r) => r.game.turn === 'b');
  }
  // あおいのブラウザを閉じる
  A.offlineOk = true;
  await A.context.close();
  check('D1 通信が切れたことがわかる', await waitFor(async () => (await L.text(H, '#seats')).includes('通信が切れた'), 90000));
  check('D2 ホストに「代わりに置いてね」', (await L.status(H)).includes('黒（あおい）の番。代わりに置いてね'), await L.status(H));
  check('D3 白の人は押せない', await B.page.isDisabled(cell(0)));
  const ply0 = room.game.ply;
  room = await L.roomOf(code);
  await H.page.click(cell(Number(Object.keys(E.legalMoves(room.game.board, 'b'))[0])));
  room = await L.roomWhen(code, (r) => r.game.ply === ply0 + 1);
  check('D4 ホストが代わりに置ける', room.game.ply === ply0 + 1 && room.game.turn === 'w', room.game.ply);
  // 同じ名前の別人は入れない
  const X = await L.newClient('aoi2');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'あおい');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('D5 席の名前は別の人には使えない', true);
  await X.page.close();

  // そらが読み込み直す → 白の席のまま続き
  await B.page.reload();
  check('D6 読み込み直すと続きから', await waitFor(async () => (await L.screen(B)) === 'game' && (await L.text(B, '#barMe')).includes('あなたは白')), await L.text(B, '#barMe'));
  check('D7 読み込み直しても自分の番', (await L.status(B)).startsWith('あなたの番だよ（白）'), await L.status(B));
  room = await L.roomOf(code);
  await B.page.click(cell(Number(Object.keys(E.legalMoves(room.game.board, 'w'))[0])));
  room = await L.roomWhen(code, (r) => r.game.ply === ply0 + 2);
  check('D8 読み込み直したあとも置ける', room.game.ply === ply0 + 2);

  // ホストの再読み込み
  await H.page.reload();
  check('D9 ホストも読み込み直すと続きから', await waitFor(async () => (await L.screen(H)) === 'game' && (await L.visible(H, '#tools'))));
  room = await L.roomWhen(code, (r) => r.hostConnected === true);
  check('D10 ホストの在室が戻る', room.hostConnected === true && room.status === 'play');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
