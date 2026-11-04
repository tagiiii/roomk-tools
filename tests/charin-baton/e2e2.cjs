// ちゃりんバトン E2E その2: ホストが切れている間は時計を止め、戻ると 3・2・1 から・席の人の切断とホストが代わりに答える・席の名前は別の人に使えない・対決中に入った人は観戦・読み込み直し（参加者・ホスト）
const L = require('./lib.cjs');
const { E, check, sleep, waitFor } = L;

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
  await L.roomWhen(code, (r) => r.seats?.b === 'そら');
  await H.page.selectOption('#lobbyCommon-first', 'a');
  await L.roomWhen(code, (r) => r.set?.first === 'a');
  await L.open(W, '?watch=' + code);
  await H.page.click('#btnStartGame');
  for (const c of [H, A, B, W]) await L.waitScreen(c, 'game');
  await L.waitActive(A);

  // ── A. ホストが切れている間は時計を止める ──
  H.offlineOk = true;
  await H.context.setOffline(true);
  let room = await L.roomWhen(code, (r) => r.hostConnected === false, 90000);
  check('A1 ホストの切断を検知', room.hostConnected === false);
  check('A2 参加者にホストを待つ表示', await waitFor(async () => L.visible(A, '#hostOffOverlay')) && await L.visible(W, '#hostOffOverlay'));
  const c1 = await L.clocks(A);
  await sleep(2500);
  const c2 = await L.clocks(A);
  check('A3 ホストが切れている間は時計が止まる', JSON.stringify(c1) === JSON.stringify(c2), [c1, c2]);
  check('A4 その間は答えられない', !(await A.page.evaluate(() => !!document.querySelector('#display.is-active'))));
  const remAt = E.remaining(room.game.duel, 0, Number(room.hostDisconnectedAt));
  await H.context.setOffline(false);
  H.offlineOk = false;
  room = await L.roomWhen(code, (r) => r.hostConnected === true, 30000);
  check('A5 ホストが戻る', room.hostConnected === true && room.hostDisconnectedAt == null);
  check('A6 戻ると 3・2・1 から（同じ番・止めた時刻の残り）', room.game.duel.phase === 'ready' && room.game.duel.turn === 0 && Math.abs(room.game.duel.rem[0] - remAt) < 50, [room.game.duel.phase, room.game.duel.rem[0], remAt]);
  check('A7 オーバーレイが消える', await waitFor(async () => !(await L.visible(A, '#hostOffOverlay'))));
  await L.waitActive(A);
  check('A8 3秒たつと続きから答えられる', (await L.duelOf(code)).phase === 'play');
  await L.typeAnswer(A, await L.traySum(A));
  await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal');
  await L.roomWhen(code, (r) => r.game.duel.phase === 'play' && r.game.duel.turn === 1);
  await L.waitActive(B);

  // ── B. 席の人が切れると、ホストが代わりに答える ──
  B.offlineOk = true;
  await B.context.setOffline(true);
  room = await L.roomWhen(code, (r) => !r.players?.['そら'], 90000);
  check('B1 席の人の切断を検知', !room.players?.['そら']);
  check('B2 札に「通信が切れた」', await waitFor(async () => (await L.text(H, '#card1')).includes('通信が切れた')) && (await L.text(W, '#card1')).includes('通信が切れた'));
  check('B3 ホストに代わりに入れる案内', await waitFor(async () => (await L.text(H, '#answerBox')).includes('そらの番。代わりに入れてね')), await L.text(H, '#answerBox'));
  check('B4 時計は止めない', await waitFor(async () => { const a = (await L.clocks(H))[1]; await sleep(1200); return (await L.clocks(H))[1] < a; }));
  // 同じ名前は、対決の間はほかの人が使えない
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'そら');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('B5 席の名前は別の人に使えない', true);
  // 対決中に入った人は観戦
  await X.page.fill('#guestName', 'りく');
  await X.page.click('#btnJoinRoom');
  await L.waitScreen(X, 'game');
  check('B6 対決中に入った人は観戦', (await L.text(X, '#barMe')).includes('観戦中') && !(await L.visible(X, '#display')));
  await L.waitActive(H);
  await L.typeAnswer(H, await L.traySum(H));
  room = await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal');
  check('B7 ホストが代わりに答えられる', room.game.duel.correct[1] === 1, room.game.duel.correct);
  await B.context.setOffline(false);
  B.offlineOk = false;
  room = await L.roomWhen(code, (r) => !!r.players?.['そら'], 30000);
  check('B8 戻ると在室に戻る', !!room.players?.['そら']);
  check('B9 「通信が切れた」が消える', await waitFor(async () => !(await L.text(H, '#card1')).includes('通信が切れた')));

  // ── C. 読み込み直し（参加者） ──
  await L.roomWhen(code, (r) => r.game.duel.phase === 'play' && r.game.duel.turn === 0);
  await L.waitActive(A);
  await A.page.reload();
  await L.waitScreen(A, 'game', 15000);
  await L.waitActive(A, 15000);
  check('C1 参加者は読み込み直しても同じ席で続きから', (await L.text(A, '#barMe')).includes('あなたは1人目'));
  await L.typeAnswer(A, await L.traySum(A));
  room = await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal');
  check('C2 読み込み直したあとも答えられる', room.game.duel.correct[0] === 2, room.game.duel.correct);

  // ── D. 読み込み直し（ホスト） ──
  await L.roomWhen(code, (r) => r.game.duel.phase === 'play' && r.game.duel.turn === 1);
  await L.waitActive(B);
  const before = await L.duelOf(code);
  await H.page.reload();
  await L.waitScreen(H, 'game', 15000);
  room = await L.roomWhen(code, (r) => r.hostConnected === true && r.game.duel.rev > before.rev, 15000);
  check('D1 ホストは読み込み直しても同じルームに戻る', (await L.text(H, '#btnLeave')) === 'ルームを閉じる');
  check('D2 対決は続いている（同じ対決）', room.game.id === before.duel?.id || room.game.id === 1);
  await L.waitActive(B, 15000);
  await L.typeAnswer(B, await L.traySum(B));
  room = await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal');
  check('D3 ホストが戻ったあとも続けられる', room.game.duel.correct[1] === 2, room.game.duel.correct);

  // ── E. みんなにみせる画面は書き込まない ──
  check('E1 みんなにみせる画面は参加者に入らない', !Object.keys((await L.roomOf(code)).players).some((n) => !['メンター', 'あおい', 'そら', 'りく'].includes(n)));
  await H.page.click('#btnLeave');
  for (const c of [A, B, X]) await L.waitScreen(c, 'top');
  check('E2 ルームが消える', await waitFor(async () => (await L.roomOf(code)) === null));
  check('E3 みんなにみせる画面はおわりの表示', await waitFor(async () => (await L.screen(W)) === 'watch-end'));

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
