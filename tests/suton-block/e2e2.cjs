// すとんブロック E2E その2: 読み込み直し（参加者・ホスト）・ホストの切断（あそんでいる間は盤をかくさない）・
// 参加者の切断と名前の保護・ホストが切れていても時間で結果が出る
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, text, visible, waitScreen, waitText, stats, waitFor, key, waitPlaying, ROOMS } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('haru');
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'はる', code);
  await H.page.click('#btnStartGame');
  await Promise.all([waitPlaying(H), waitPlaying(A), waitPlaying(B)]);
  let room = await roomOf(code);
  const seed = room.round.seed;

  // ── 参加者の読み込み直し: 盤・段の数・とっておいたものが戻り、同じ順番の続きになる ──
  for (let i = 0; i < 4; i++) await key(A, 'Space');
  await key(A, 'a');
  await key(A, 'Space');
  room = await roomWhen(code, (r) => r.boards?.['あおい']?.pieces === 5);
  const before = room?.boards?.['あおい'];
  if (!before) throw new Error('no board: ' + JSON.stringify({ status: room?.status, boards: room?.boards && Object.fromEntries(Object.entries(room.boards).map(([k, v]) => [k, v.pieces])), screen: await L.screen(A), lines: await text(A, '#playLines'), cd: await visible(A, '#countdown') }));
  check('R1 置くたびに続きの記録を送る', before.taken >= 6 && before.hold && typeof before.b === 'string', before);
  await A.page.reload();
  await waitPlaying(A);
  check('R2 読み込み直すと、あそぶ画面に戻る', true);
  check('R3 段の数が戻る', (await text(A, '#playLines')) === String(before.lines));
  check('R4 とっておいたものが戻る', !(await A.page.$eval('#hold', (c) => c.classList.contains('is-used'))) || before.holdUsed);
  await key(A, 'Space');
  room = await roomWhen(code, (r) => r.boards?.['あおい']?.pieces === 6);
  const sim = E.restoreGame({ seed, onFull: 'clear' }, before);
  E.hardDrop(sim);
  check('R5 読み込み直しても同じ順番の続き', room.boards['あおい'].b === E.packBoard(sim.board) && room.boards['あおい'].taken === sim.taken);

  // ── ホストの読み込み直し ──
  await key(H, 'Space'); await key(H, 'Space');
  room = await roomWhen(code, (r) => r.boards?.['メンター']?.pieces === 2);
  const hb = room.boards['メンター'];
  await H.page.reload();
  await waitPlaying(H);
  check('R6 ホストも読み込み直すと続きから', (await text(H, '#btnPlayEnd')) === '早めにおわる');
  await key(H, 'Space');
  room = await roomWhen(code, (r) => r.boards?.['メンター']?.pieces === 3);
  const simH = E.restoreGame({ seed, onFull: 'clear' }, hb);
  E.hardDrop(simH);
  check('R7 ホストの盤も同じ順番の続き', room.boards['メンター'].b === E.packBoard(simH.board));

  // ── ホストの切断: あそんでいる間は盤をかくさず、バーに出す ──
  H.offlineOk = true;
  await H.context.setOffline(true);
  room = await roomWhen(code, (r) => r.hostConnected === false, 90000);
  check('R8 ホストの切断がルームに出る', room.hostConnected === false);
  await waitFor(() => visible(A, '#playHostOff'), 8000);
  check('R9 あそんでいる間はバーに「ホストの通信が切れています」', await visible(A, '#playHostOff'));
  check('R10 あそんでいる間はオーバーレイで盤をかくさない', !(await visible(A, '#hostOffOverlay')));
  await key(A, 'Space');
  check('R11 ホストが切れていても置ける', !!(await roomWhen(code, (r) => r.boards['あおい'].pieces === 7)).boards['あおい']);
  // ホストが切れて2分をすぎても、あそんでいる回の間はルームを消さない（時間で結果が出て2分たつまでのばす）
  await rest('PATCH', `${ROOMS}/${code}`, { hostDisconnectedAt: Date.now() - 3 * 60 * 1000 });
  await sleep(3000);
  check('R11b ホストが切れて2分をすぎても、回の途中なら続く', (await L.screen(A)) === 'play' && !!(await roomOf(code)));
  // ホストが切れたまま時間になっても、あそぶ人の端末が結果を出す
  await rest('PATCH', `${ROOMS}/${code}/round`, { startedAt: Date.now() - (180 + 10) * 1000 });
  await Promise.all([waitScreen(A, 'result', 15000), waitScreen(B, 'result', 15000)]);
  check('R12 ホストが切れていても時間で結果が出る', true);
  check('R13 結果ではホストを待つオーバーレイ', await waitFor(() => visible(A, '#hostOffOverlay'), 4000));
  await sleep(1500);
  check('R13b 結果は出てから2分は見られる（ホストが切れて2分をすぎていても）', (await L.screen(A)) === 'result' && !!(await roomOf(code)));
  await sleep(500);
  const fin = (await stats(A, 'finish')) + (await stats(B, 'finish'));
  check('R14 finish は1回だけ', fin === 1, fin);
  await H.context.setOffline(false);
  room = await roomWhen(code, (r) => r.hostConnected === true, 30000);
  check('R15 ホストが戻る', room.hostConnected === true);
  await waitScreen(H, 'result', 15000);
  check('R16 戻ったホストも結果', true);
  check('R17 オーバーレイが消える', await waitFor(async () => !(await visible(A, '#hostOffOverlay')), 8000));
  H.offlineOk = false;

  // ── 参加者の切断と名前の保護 ──
  await H.page.click('#btnAgain');
  await waitScreen(A, 'waiting');
  await H.page.click('label:has(input[name="roomJama"][value="on"])');
  await roomWhen(code, (r) => r.settings.jama === true);
  await H.page.click('#btnStartGame');
  await Promise.all([waitPlaying(A), waitPlaying(B)]);
  A.offlineOk = true;
  await A.context.setOffline(true);
  room = await roomWhen(code, (r) => !r.players?.['あおい'], 90000);
  check('C1 切れた参加者は在室から消える', !room.players['あおい']);
  check('C2 ほかの人の盤に「いまはいない」', await waitFor(async () => (await text(H, '#others')).includes('いまはいない'), 8000));
  const D = await L.newClient('other');
  await L.open(D, '?room=' + code);
  await waitScreen(D, 'join');
  await D.page.fill('#guestName', 'あおい');
  await D.page.click('#btnJoinRoom');
  await waitText(D, '#joinError', '使われている');
  check('C3 あそんでいる回の人の名前は、ほかの人が使えない', true);
  await A.context.setOffline(false);
  room = await roomWhen(code, (r) => !!r.players?.['あおい'], 30000);
  check('C4 戻ると在室に戻る', !!room.players['あおい']);
  check('C5 「いまはいない」が消える', await waitFor(async () => !(await text(H, '#others')).includes('いまはいない'), 8000));
  A.offlineOk = false;
  await key(A, 'Space');
  const after = await roomWhen(code, (r) => r.boards?.['あおい']?.pieces >= 1);
  check('C6 戻ったあとも置ける', !!after?.boards?.['あおい'], { screen: await L.screen(A), status: after?.status, boards: Object.keys(after?.boards || {}), note: await text(A, '#playNote'), timer: await text(A, '#playTimer') });

  // 来るじゃまは、置く前に読み込み直しても消えない
  room = await roomOf(code);
  await rest('POST', `${ROOMS}/${code}/jama/はる`, { round: room.round.id, rows: 2, from: 'test' });
  await waitText(B, '#playJama', '2段');
  room = await roomWhen(code, (r) => !r.jama?.['はる'] && r.boards?.['はる']?.pending === 2);
  check('J1 受けとったじゃまを消すのと同時に、来るじゃまの数を書く', !room.jama?.['はる'] && room.boards['はる'].pending === 2);
  await B.page.reload();
  await waitPlaying(B);
  check('J2 読み込み直しても来るじゃまが残る', (await text(B, '#playJama')) === '2段');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
