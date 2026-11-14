// ヒット&ブロー E2E その2: みんなで対戦（順番・全員に見える一覧・答えは結果まで出さない）・端末なしの参加者・席の人が抜けたらホストが代わりに押す・番をとばす・再読み込み・ゲーム中に入った人は見るだけ・2人で対戦の端末なし／おまかせで決める
const L = require('./lib.cjs');
const { E, check, sleep, waitFor } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. みんなで対戦の準備 ──
  const code = await L.createRoom(H, 'メンター');
  await H.page.click('#lobbyModeSeg .hbw-seg__btn:nth-child(2)');
  await L.roomWhen(code, (r) => r.mode === 'party');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'そら', code);
  await H.page.fill('#proxyName', 'メンター');
  await H.page.click('#btnAddProxy');
  check('A1 ホストと同じ名前の端末なしは足せない', await waitFor(async () => (await L.text(H, '#proxyError')).includes('もういる')));
  await H.page.fill('#proxyName', 'はると');
  await H.page.click('#btnAddProxy');
  let room = await L.roomWhen(code, (r) => r.proxies?.['はると']);
  check('A2 端末なしの参加者を足すと「遊ぶ」で入る', room.seated?.['はると'] === true && !room.players?.['はると'], room);
  check('A3 「端末なし」の印はホストだけ', await waitFor(async () => (await L.text(H, '#lobbyPeople')).includes('端末なし')) && !(await L.text(A, '#lobbyPeople')).includes('端末なし'));
  check('A4 遊ぶ人 4人', (await L.text(H, '#seatNote')).includes('遊ぶ人 4人'));
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');

  await H.page.click('#btnStartGame');
  room = await L.roomWhen(code, (r) => r.status === 'play');
  let g = E.normalize(room.game);
  check('A5 みんなで対戦が始まる（答えは1つ・ホストから）', g.mode === 'party' && g.phase === 'play' && g.secrets.length === 1 && room.game.names.join() === 'メンター,あおい,そら,はると' && g.turn === 0, room.game);
  check('A6 players-4 を数える', await L.waitStats(H, 'players-4', 1));
  const secret = g.secrets[0];
  check('A7 答えの欄・自分の答えはだれにも出ない', !(await L.visible(H, '#mineBox')) && !(await L.visible(A, '#mineBox')) && !(await L.visible(W, '#resultBox')));
  check('A8 答えを決める欄は出ない', !(await L.visible(A, '#setupBox')));

  // ── B. 順番・一覧 ──
  await L.waitVisible(H, '#guessBox');
  check('B1 ホストも遊ぶ（あなたの予想）', (await L.text(H, '#guessTitle')).includes('あなたの予想'));
  const miss = L.missOf(secret, 'easy');
  await L.guess(H, miss);
  await L.waitVisible(A, '#guessBox');
  check('B2 次はあおい', (await L.status(A)) === 'あなたの番' && (await L.status(B)) === 'あおいの番');
  check('B3 一覧にだれの予想か', await waitFor(async () => (await L.text(B, '#boards')).includes('メンター1回め')), await L.text(B, '#boards'));
  check('B4 外れはヒット0・ブロー0', (await L.tries(W)).includes('ヒット0・ブロー0'));
  await L.guess(A, secret.slice().reverse());

  // ── C. そらが抜ける → ホストが代わりに押す ──
  await L.waitVisible(B, '#guessBox');
  await B.page.close();
  check('C1 抜けた人の札に「通信が切れた」', await waitFor(async () => (await L.text(H, '#seats')).includes('通信が切れた'), 15000));
  await L.waitVisible(H, '#guessBox');
  check('C2 ホストに「代わりにならべてね」', (await L.text(H, '#guessTitle')) === 'そらの番。代わりにならべてね');
  check('C3 ほかの人には出ない', !(await L.visible(A, '#guessBox')));
  await L.guess(H, miss);
  room = await L.roomWhen(code, (r) => E.normalize(r.game)?.log.length === 3);
  check('C4 ホストが代わりに出した予想は、そらの予想', E.normalize(room.game).log[2].by === 2);

  // ── D. 端末なしの人の番 ──
  await L.waitVisible(H, '#guessBox');
  check('D1 端末なしの人の番もホストが入れる', (await L.text(H, '#guessTitle')) === 'はるとの番。代わりにならべてね');
  await L.guess(H, miss);
  await L.roomWhen(code, (r) => E.normalize(r.game)?.log.length === 4);

  // ── E. 再読み込み（ホスト・参加者） ──
  await L.waitVisible(H, '#guessBox');
  await H.page.reload();
  await L.waitScreen(H, 'game');
  check('E1 ホストが読み込み直しても続きから', await waitFor(async () => (await L.status(H)) === 'あなたの番') && (await L.tries(H)).length === 4);
  await L.guess(H, miss);
  await L.waitVisible(A, '#guessBox');
  await A.page.reload();
  await L.waitScreen(A, 'game');
  check('E2 参加者が読み込み直しても続きから', await waitFor(async () => (await L.status(A)) === 'あなたの番'));
  check('E3 戻った人は席のまま', await waitFor(async () => !/あおい通信が切れた/.test(await L.text(H, '#seats'))));

  // ── F. 番をとばす（ホスト） ──
  check('F1 ホストに「この人の番をとばす」', await L.visible(H, '#btnSkip'));
  check('F2 参加者には出ない', !(await L.visible(A, '#btnSkip')));
  await H.page.click('#btnSkip');
  room = await L.roomWhen(code, (r) => E.normalize(r.game)?.turn === 2);
  check('F3 とばすと次の人の番（予想は増えない）', E.normalize(room.game).log.length === 5);

  // ── G. ゲーム中に入った人は見るだけ ──
  const C = await L.newClient('riku');
  await L.joinRoom(C, 'りく', code).catch(() => {});
  await L.waitScreen(C, 'game');
  check('G1 ゲーム中に入った人は見るだけ', (await L.text(C, '#barMe')).includes('見るだけ') && !(await L.visible(C, '#guessBox')) && (await L.tries(C)).length === 5);
  // 抜けた そら の名前は、ほかの人（別の匿名ID）は使えない
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'そら');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('G2 ゲームの席の名前は別の人に使えない', true);
  await X.page.close();

  // ── H. 当てる ──
  await L.waitVisible(H, '#guessBox');
  await L.guess(H, secret);
  room = await L.roomWhen(code, (r) => r.game?.phase === 'end');
  check('H1 代わりに当てても、その席の人の勝ち', JSON.stringify(E.normalize(room.game).winners) === '[2]');
  check('H2 結果の文と答え', await waitFor(async () => (await L.status(W)) === 'そらが当てた！') && (await W.page.$$('#resultAnswers .hbw-result__answer')).length === 1);
  check('H3 finish を数える', await L.waitStats(H, 'finish', 1));
  await L.shot(W, 'party-end-watch');
  await L.shot(H, 'party-end-host');

  // もう一回は、抜けた人がいると進めない
  await H.page.click('#btnAgain');
  check('H4 抜けた人がいると「もう一回」は案内を出す', await waitFor(async () => (await L.text(H, '#roomk-toast')).includes('そろっていない')));
  await H.page.click('#btnRelobby');
  await L.waitScreen(H, 'waiting');
  room = await L.roomOf(code);
  check('H5 待合室では、いる人だけ「遊ぶ」に残る', room.seated?.['メンター'] && room.seated?.['あおい'] && room.seated?.['はると'] && !room.seated?.['そら'], room.seated);

  // ── I. 2人で対戦: 端末なしの人の答えはくじ・ホストが代わりに当てる ──
  await H.page.click('#lobbyModeSeg .hbw-seg__btn:nth-child(1)');
  await L.roomWhen(code, (r) => r.mode === 'duel');
  // メンターとはるとの2人にする
  const toggle = (name) => H.page.locator('#lobbyPeople .hbw-person', { hasText: name }).locator('button').first();
  await toggle('あおい').click();
  await L.roomWhen(code, (r) => !r.seated?.['あおい']);
  check('I0 遊ぶ人 2人', await waitFor(async () => (await L.text(H, '#seatNote')).includes('遊ぶ人 2人')));
  await H.page.click('#btnStartGame');
  room = await L.roomWhen(code, (r) => r.status === 'play');
  g = E.normalize(room.game);
  check('I1 端末なしの人の答えは、はじめからくじで決まる', g.phase === 'setup' && !g.secrets[0] && E.validCode(g.secrets[1], 'easy'), room.game);
  check('I2 ホストは自分の答えだけを決める', await L.visible(H, '#setupBox') && !(await L.visible(H, '#btnAutoSecret')));
  check('I2b ホストには「見ないでおまかせで決める」', await L.visible(H, '#btnSetupBlind'));
  await H.page.click('#btnSetupBlind');
  room = await L.roomWhen(code, (r) => r.game?.phase === 'play');
  g = E.normalize(room.game);
  const sH = g.secrets[0];
  check('I3 見ないで決めた答えは、画面に出ないまま保存される', E.validCode(sH, 'easy') && (await H.page.$$('#mineRow .hbw-peg')).length === 0 && !(await L.visible(H, '#resultBox')));
  check('I3b ホストの答えは折りたたみ（「見る」で出す）', await L.visible(H, '#btnMineToggle') && (await L.text(H, '#btnMineToggle')) === '見る');
  await H.page.click('#btnMineToggle');
  check('I3c 「見る」で出て「かくす」でしまう', await waitFor(async () => (await H.page.$$('#mineRow .hbw-peg')).length === 3) && (await L.text(H, '#btnMineToggle')) === 'かくす');
  await H.page.click('#btnMineToggle');
  check('I3d かくす', await waitFor(async () => (await H.page.$$('#mineRow .hbw-peg')).length === 0));
  // 3回めのゲームなので、先の番は round で決まる
  if (g.turn === 1) {
    await L.waitVisible(H, '#guessBox');
    check('I4 はるとの番はホストが代わりに入れる', (await L.text(H, '#guessTitle')) === 'はるとの番。代わりにならべてね');
    await L.guess(H, sH);
  } else {
    await L.waitVisible(H, '#guessBox');
    await L.guess(H, g.secrets[1].slice().reverse());
    await L.waitVisible(H, '#guessBox');
    check('I4 はるとの番はホストが代わりに入れる', (await L.text(H, '#guessTitle')) === 'はるとの番。代わりにならべてね');
    await L.guess(H, sH);
  }
  room = await L.roomWhen(code, (r) => r.game?.phase === 'end' || r.game?.lastChance != null);
  check('I5 代わりに入れた予想でゲームが進む', !!room.game);
  await H.page.click('#btnReset');
  await L.waitScreen(H, 'waiting');

  // ── J. 2人で対戦: 答えを決める前に抜けた人は、ホストがおまかせで決める ──
  await toggle('はると').click();
  await L.roomWhen(code, (r) => !r.seated?.['はると']);
  await toggle('メンター').click();
  await L.roomWhen(code, (r) => !r.seated?.['メンター']);
  const toggleOn = (name) => H.page.locator('#lobbyPeople .hbw-person', { hasText: name }).locator('button').first();
  await toggleOn('あおい').click();
  await toggleOn('りく').click();
  room = await L.roomWhen(code, (r) => r.seated?.['あおい'] && r.seated?.['りく']);
  check('J0 あおいとりく', Object.keys(room.seated).sort().join() === 'あおい,りく', room.seated);
  await H.page.click('#btnStartGame');
  await L.waitVisible(A, '#setupBox');
  await L.setSecret(A, ['purple', 'orange', 'red']);
  await L.waitVisible(C, '#setupBox');
  await C.page.close();
  check('J1 抜けた人がいると「おまかせで決める」がホストに出る', await waitFor(async () => await L.visible(H, '#btnAutoSecret'), 15000));
  await H.page.click('#btnAutoSecret');
  room = await L.roomWhen(code, (r) => r.game?.phase === 'play');
  check('J2 おまかせで決まって、予想に進む', !!room && E.validCode(E.normalize(room.game).secrets[1], 'easy'));
  check('J3 ホストには答えが出ない', !(await L.visible(H, '#mineBox')));

  await H.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  check('K1 ルームを閉じる', (await L.roomOf(code)) === null);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
