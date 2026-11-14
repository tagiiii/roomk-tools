// マンカラ E2E その2: 1手の制限時間（残り時間・時間切れで CPU がまく・1回だけ・ホストが切れている間は止めて、戻ると数えなおす）・途中から観戦・切断と代わりにまく・同じ名前の別人・再読み込み
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, hole } = L;

// その番の人の画面で、まける穴の最初を押して、確定まで待つ（たしかめるがオンなら2回押す）
async function sowFirst(c, code) {
  const room = await L.roomOf(code);
  const ply = room.game.ply;
  const mv = E.legalMoves(room.game.board, room.game.turn)[0];
  await c.page.click(hole(mv));
  if (await L.visible(c, '#confirmBox')) await c.page.click('#btnPlace');
  return L.roomWhen(code, (r) => r.game.ply === ply + 1);
}

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
  check('T1 制限時間が参加者に届く', await waitFor(async () => (await L.text(A, '#moveTimeView')) === '15秒（過ぎたら CPU が代わりにまく）'), await L.text(A, '#moveTimeView'));
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  let room = await L.roomOf(code);
  check('T2 対局に制限時間が入る', room.game.moveTime === 15 && typeof room.game.turnAt === 'number', room.game);
  check('T3 番の人に残り時間', await waitFor(async () => /^b:のこり 1[45]秒$/.test(await L.clockText(A))), await L.clockText(A));
  check('T4 みんなにみせる画面にも残り時間', /^b:のこり 1[45]秒$/.test(await L.clockText(W)), await L.clockText(W));
  // 先が穴0（番が変わる手）
  await A.page.click(hole(0));
  await A.page.click(hole(0));
  await L.roomWhen(code, (r) => r.game.ply === 1);
  check('T5 まくと相手の番の時間になる', await waitFor(async () => /^w:のこり 1[2345]秒$/.test(await L.clockText(W)), 10000), await L.clockText(W));
  await Promise.all([L.settled(A), L.settled(B)]);
  // 残り4秒 → 色が変わる
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/turnAt', Date.now() - 11000);
  check('T6 残り5秒から色が変わる', await waitFor(async () => B.page.$eval('.mc-seat--w .mc-seat__clock', (x) => x.classList.contains('is-hurry'))));
  // 時間切れ → CPU が後の代わりにまく
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/turnAt', Date.now() - 20000);
  room = await L.roomWhen(code, (r) => r.game.ply === 2, 8000);
  check('T7 時間切れで CPU がまく', room.game.ply === 2 && room.game.auto === 'w', { ply: room.game.ply, auto: room.game.auto });
  const autoNo = E.pitNumber(room.game.last);
  await Promise.all([L.settled(A), L.settled(W)]);
  check('T8 みんなに「時間切れ」のお知らせ', await waitFor(async () => (await L.status(W)).startsWith('時間切れ。CPU が後の代わりに ' + autoNo + '番めの穴からまいたよ。')), await L.status(W));
  await sleep(2500);
  room = await L.roomOf(code);
  check('T9 CPU は1回だけ（次の番は時間が残っている）', room.game.ply === 2, room.game.ply);
  // 人がまくと、お知らせは消える
  const cur = room.game.turn === 'b' ? A : B;
  room = await sowFirst(cur, code);
  await Promise.all([L.settled(A), L.settled(W)]);
  check('T10 人がまくと「時間切れ」のお知らせは消える', !room.game.auto && !(await L.status(W)).includes('時間切れ'));

  // ホストが切れている間は、時計を止めて CPU もまかない
  await H.page.evaluate(() => firebase.database().goOffline());
  H.offlineOk = true;
  check('T11 ホストの切断が届く', await waitFor(async () => (await L.visible(A, '#hostOffOverlay')), 15000));
  const ply3 = (await L.roomOf(code)).game.ply;
  const oldAt = Date.now() - 20000;
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/turnAt', oldAt);
  await sleep(3500);
  room = await L.roomOf(code);
  check('T12 ホストが切れている間は CPU がまかない', room.game.ply === ply3, room.game.ply);
  check('T13 ホストが切れている間は残り時間を出さない', (await L.clockText(B)) === '' && (await L.clockText(W)) === '', await L.clockText(B));
  await H.page.evaluate(() => firebase.database().goOnline());
  check('T14 ホストが戻るとお知らせが消える', await waitFor(async () => !(await L.visible(A, '#hostOffOverlay')), 15000));
  room = await L.roomWhen(code, (r) => r.game.turnAt > oldAt + 10000, 6000);
  check('T15 ホストが戻ると、その番の時間を最初から', room.game.turnAt > oldAt + 10000 && room.game.ply === ply3, { at: room.game.turnAt, ply: room.game.ply });

  // 対局中に入った人
  const V = await L.newClient('hikari');
  await L.joinRoom(V, 'ひかり', code).catch(() => {});
  check('R1 対局中に入った人は観戦', await waitFor(async () => (await L.screen(V)) === 'game' && (await L.text(V, '#barMe')).includes('観戦中')), await L.text(V, '#barMe'));
  check('R2 観戦の人は押せない', (await L.playable(V)).length === 0);

  // ── D. 切断・代わりにまく・同じ名前の別人・再読み込み ──
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/moveTime', 0);
  room = await L.roomOf(code);
  // 先（あおい）の番まで進める
  while (room.game.turn === 'w') {
    room = await sowFirst(B, code);
    await L.settled(B);
  }
  await L.settled(A);
  A.offlineOk = true;
  await A.context.close();
  check('D1 通信が切れたことがわかる', await waitFor(async () => (await L.text(H, '#seatTop')).includes('通信が切れた') || (await L.text(H, '#seatBottom')).includes('通信が切れた'), 90000));
  check('D2 ホストに「代わりにまいてね」', (await L.status(H)).includes('先（あおい）の番。代わりにまいてね'), await L.status(H));
  check('D3 後の人は押せない', (await L.playable(B)).length === 0);
  const ply0 = (await L.roomOf(code)).game.ply;
  room = await sowFirst(H, code);
  check('D4 ホストが代わりにまける', room.game.ply === ply0 + 1, room.game.ply);
  await Promise.all([L.settled(H), L.settled(B)]);
  // 同じ名前の別人は入れない
  const X = await L.newClient('aoi2');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'あおい');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('D5 席の名前は別の人には使えない', true);
  await X.page.close();

  // そらが読み込み直す → 後の席のまま続き
  await B.page.reload();
  check('D6 読み込み直すと続きから', await waitFor(async () => (await L.screen(B)) === 'game' && (await L.text(B, '#barMe')).includes('あなたは後')), await L.text(B, '#barMe'));
  check('D7 読み込み直しても下は自分の穴', JSON.stringify(await L.bottomRow(B)) === '[7,8,9,10,11,12]');
  room = await L.roomOf(code);
  if (room.game.turn === 'w') {
    check('D8 読み込み直しても自分の番', (await L.status(B)).startsWith('あなたの番'), await L.status(B));
    const p0 = room.game.ply;
    room = await sowFirst(B, code);
    check('D9 読み込み直したあともまける', room.game.ply === p0 + 1);
  }

  // ホストの再読み込み
  await H.page.reload();
  check('D10 ホストも読み込み直すと続きから', await waitFor(async () => (await L.screen(H)) === 'game' && (await L.visible(H, '#tools'))));
  room = await L.roomWhen(code, (r) => r.hostConnected === true);
  check('D11 ホストの在室が戻る', room.hostConnected === true && room.status === 'play');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
