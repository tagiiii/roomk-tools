// ちゃりんバトン E2E その4: 3人以上の勝ち残り（参加した人みんなが対戦・6人まで・7人目は入れない・席の順に回る・「ここまで」の人はとばす・最後の1人の勝ち・順位は出さない・6人のスマホ表示・もう一回）
const L = require('./lib.cjs');
const { check, sleep, waitFor } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const C = await L.newClient('riku', { viewport: { width: 375, height: 812 }, mobile: true });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });
  const P = [A, B, C];

  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'そら', code);
  await L.joinRoom(C, 'りく', code);
  check('A1 参加した人はみんな対戦する（ホストもふくめ参加した順）', await waitFor(async () => /1番目メンター.*2番目あおい.*3番目そら.*4番目りく/.test(await L.text(H, '#lobbyPeople'))), await L.text(H, '#lobbyPeople'));
  await L.open(W, '?watch=' + code);

  // ── A. 対戦するのは6人まで ──
  for (const name of ['ひかり', 'はる']) {
    await H.page.fill('#proxyName', name);
    await H.page.click('#btnAddProxy');
    await L.roomWhen(code, (r) => r.proxies?.[name]);
    // 書き込みが終わると欄が空になる（終わる前に次を押すと、二度押しよけで何もしない）
    await waitFor(async () => (await H.page.inputValue('#proxyName')) === '');
  }
  await H.page.fill('#proxyName', 'なつ');
  await H.page.click('#btnAddProxy');
  check('A2 6人をこえる端末なしの参加者は足せない', await waitFor(async () => (await L.text(H, '#proxyError')).includes('6人まで')), await L.text(H, '#proxyError'));
  const X = await L.newClient('seventh');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'なつ');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'いっぱい');
  check('A3 7人目は入れず、みんなにみせる画面を案内する', (await L.text(X, '#joinError')).includes('みんなにみせる画面'), await L.text(X, '#joinError'));
  await X.page.close();
  // 6人で始めて、スマホ幅の表示を見る
  await H.page.click('#btnStartGame');
  for (const c of [H, C, W]) await L.waitScreen(c, 'game');
  check('A4 6人の札が出る', (await C.page.$$('.cb-player')).length === 6 && (await W.page.$$('.cb-player')).length === 6);
  check('A5 players-6 を数える', await L.waitStats(H, 'players-6', 1));
  check('A6 6人でもスマホ幅ではみ出さない', (await L.overflow(C)) <= 0, await L.overflow(C));
  await L.shot(C, 'six-mobile', { fullPage: false });
  await L.shot(W, 'six-watch', { fullPage: false });
  await H.page.click('#tools .cb-quiet');
  await L.waitScreen(H, 'waiting');
  for (const name of ['ひかり', 'はる']) {
    await H.page.locator('#lobbyPeople .cb-person', { hasText: name }).locator('.cb-person__del').click();
    await L.roomWhen(code, (r) => !r.proxies?.[name]);
  }
  await H.page.uncheck('#hostPlays');
  await L.roomWhen(code, (r) => r.set?.hostPlays === false);
  check('A7 外すと対戦する人から外れる・ホストは進行だけ', await waitFor(async () => /1番目あおい.*2番目そら.*3番目りく/.test(await L.text(H, '#lobbyPeople')) && !(await L.text(H, '#lobbyPeople')).includes('ひかり')), await L.text(H, '#lobbyPeople'));

  // ── B. 3人の勝ち残り ──
  await H.page.selectOption('#lobbyCommon-first', 'top');
  await L.roomWhen(code, (r) => r.set?.first === 'top');
  await H.page.click('#btnStartGame');
  for (const c of [H, A, B, C, W]) await L.waitScreen(c, 'game');
  check('B0 players-3 を数える', await L.waitStats(H, 'players-3', 1));
  const order = [];
  for (let k = 0; k < 3; k++) {
    const r = await L.roomWhen(code, (x) => x.game.duel.phase === 'play');
    const t = r.game.duel.turn;
    order.push(t);
    await L.waitActive(P[t]);
    if (k === 0) {
      check('B1 番でない人は待つ', (await L.text(B, '#answerBox')).includes('あおいが数えているよ。次はあなたの番') && (await L.text(C, '#answerBox')).includes('あおいが数えているよ'), [await L.text(B, '#answerBox'), await L.text(C, '#answerBox')]);
    }
    if (k === 2) break;
    await L.typeAnswer(P[t], await L.traySum(P[t]));
    await L.roomWhen(code, (x) => x.game.duel.phase === 'reveal');
    if (k === 0) check('B2 正解の帯の間、次の人に「次はあなたの番だよ」', await waitFor(async () => (await L.text(B, '#answerBox')).includes('次はあなたの番だよ')), await L.text(B, '#answerBox'));
  }
  check('B3 席の順に回る', JSON.stringify(order) === JSON.stringify([0, 1, 2]), order);

  // りくの時間切れ（残りを1.2秒に早送り）→「ここまで」
  let d = await L.duelOf(code);
  const sumC = await L.traySum(C);
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game/duel', { rem: [d.rem[0], d.rem[1], 1200], at: Date.now() });
  d = await L.roomWhen(code, (r) => r.game.duel.phase === 'out', 9000).then((r) => r.game.duel);
  check('B4 時計が0の人は「ここまで」', d.phase === 'out' && d.out[2] === true && d.lastOut === 2, d);
  for (const c of [H, A, W]) check('B5 みんなに「りくはここまで」と小銭の合計: ' + c.label, await waitFor(async () => (await L.text(c, '#trayBand')).includes('この小銭は ' + sumC.toLocaleString('ja-JP') + '円') && (await L.text(c, '#trayBand')).includes('りくはここまで')), await L.text(c, '#trayBand'));
  check('B5b 本人の画面は「あなたはここまで」で、数字ボタンは出さない', await waitFor(async () => (await L.text(C, '#trayBand')).includes('あなたはここまで')) && !(await L.visible(C, '.cb-pad')), [await L.text(C, '#trayBand'), await L.visible(C, '.cb-pad')]);
  check('B6 りくの札は「ここまで」', await waitFor(async () => (await L.text(W, '#card2')).includes('ここまで') && await W.page.$eval('#card2', (n) => n.classList.contains('is-out'))));
  await L.shot(W, 'out-watch', { fullPage: false });
  await L.waitActive(A);
  d = await L.duelOf(code);
  check('B7 「ここまで」のあと、残っている次の人（あおい）へ', d.phase === 'play' && d.turn === 0, d.turn);
  check('B8 りくの画面は見る番', (await L.text(C, '#answerBox')).includes('ここからは見る番'), await L.text(C, '#answerBox'));
  await L.typeAnswer(A, await L.traySum(A));
  await L.roomWhen(code, (r) => r.game.duel.phase === 'play' && r.game.duel.turn === 1);
  await L.waitActive(B);
  check('B9 そらの次は、りくをとばしてあおい', true);
  await L.typeAnswer(B, await L.traySum(B));
  d = await L.roomWhen(code, (r) => r.game.duel.phase === 'play' && r.game.duel.turn === 0).then((r) => r.game.duel);
  check('B10 りくをとばす', d.turn === 0, d.turn);

  // あおいの時間切れ → 残りはそらだけ → そらの勝ち
  await L.waitActive(A);
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game/duel', { rem: [1200, d.rem[1], 0], at: Date.now() });
  for (const c of [H, A, B, C, W]) await L.waitText(c, '#turnLine', 'の勝ち', 9000);
  room = await L.roomOf(code);
  check('B11 最後の1人の勝ち', room.game.duel.phase === 'over' && room.game.duel.winner === 1 && room.game.ended === true, room.game.duel.winner);
  check('B12 勝った人の表示', (await L.turnLine(W)).includes('そら の勝ち') && (await L.turnLine(B)).includes('あなた の勝ち'));
  check('B13 順位は出さない', !/[0-9１-９]位/.test(await L.text(W, '#screen-game')), await L.text(W, '#resultBox'));
  let fin = 0;
  await sleep(800);
  for (const c of [H, A, B, C]) fin += await L.stats(c, 'finish');
  check('B14 finish は1回だけ', fin === 1, fin);
  check('B15 結果の画面もスマホ幅ではみ出さない', (await L.overflow(C)) <= 0);
  await L.shot(W, 'result3-watch', { fullPage: false });

  // ── C. もう一回（先に答える人を次の人にかえる） ──
  await H.page.click('#resultBox .btn-primary');
  d = await L.roomWhen(code, (r) => r.game?.id === 3).then((r) => r.game.duel);
  check('C1 もう一回は次の人（そら）から・みんな戻る', d.turn === 1 && d.out.every((o) => o === false) && d.phase === 'ready', d);
  check('C2 again と players-3', await L.waitStats(H, 'again', 1) && await L.waitStats(H, 'players-3', 2));

  await H.page.click('#btnLeave');
  for (const c of [A, B, C]) await L.waitScreen(c, 'top');
  check('C3 ルームを閉じる', await waitFor(async () => (await L.roomOf(code)) === null));

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
