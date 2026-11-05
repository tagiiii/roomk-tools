// ちゃりんバトン E2E その5: ひとりで遊ぶ（ルームで対戦する人が1人・ホストは見るだけ／ホストがひとりで／1台の画面で1人）
// 正解するたびに同じ人に次の小銭・時計が0でおしまい・その回の点数（正解した数）・勝ち負けを出さない・もう一回
const L = require('./lib.cjs');
const { check, waitFor } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi', { viewport: { width: 375, height: 812 }, mobile: true });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 待合室: 対戦する人がいないと始められない・1人なら「ひとりで数える」 ──
  const code = await L.createRoom(H, 'メンター');
  await H.page.uncheck('#hostPlays');
  await L.roomWhen(code, (r) => r.set?.hostPlays === false);
  check('A1 対戦する人がいないと始められない', await waitFor(async () => H.page.isDisabled('#btnStartGame')) && (await L.text(H, '#seatNote')).includes('だれかが入るか'), await L.text(H, '#seatNote'));
  await L.joinRoom(A, 'あおい', code);
  check('A2 参加する人が1人なら始められる（ひとりで数える）', await waitFor(async () => !(await H.page.isDisabled('#btnStartGame')) && (await L.text(H, '#seatNote')).includes('ひとりで数える')), await L.text(H, '#seatNote'));
  await L.open(W, '?watch=' + code);
  await H.page.click('#btnStartGame');
  for (const c of [H, A, W]) await L.waitScreen(c, 'game');
  check('A3 players-1 を数える', await L.waitStats(H, 'players-1', 1));
  let room = await L.roomOf(code);
  check('A4 対戦する人はあおいだけ', JSON.stringify(room.game.seats) === JSON.stringify(['あおい']), room.game.seats);
  check('A5 札は1枚で「0点」', (await A.page.$$('.cb-player')).length === 1 && await waitFor(async () => (await L.text(W, '#card0')).includes('0点')), await L.text(W, '#card0'));

  // ── B. 正解するたびに同じ人に次の小銭 ──
  await L.waitActive(A);
  check('B1 ホストは見るだけ（金額の欄なし）', !(await L.visible(H, '#display')) && (await L.text(H, '#answerBox')).includes('あおいが数えているよ'), await L.text(H, '#answerBox'));
  check('B2 本人の画面は「あなた の番」', (await L.turnLine(A)).includes('あなた の番'), await L.turnLine(A));
  for (let k = 1; k <= 3; k++) {
    const before = (await L.duelOf(code)).problem.key;
    await L.typeAnswer(A, await L.traySum(A));
    await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal');
    if (k === 1) {
      check('B3 正解の帯のあいだ「次の小銭が出るよ」', await waitFor(async () => (await L.turnLine(A)).includes('次の小銭が出るよ') && (await L.turnLine(W)).includes('次の小銭が出るよ')), await L.turnLine(W));
      check('B4 ホストには「もうすぐ次の小銭が出るよ」', await waitFor(async () => (await L.text(H, '#answerBox')).includes('もうすぐ次の小銭が出るよ')), await L.text(H, '#answerBox'));
    }
    const d = (await L.roomWhen(code, (r) => r.game.duel.phase === 'play' && r.game.duel.problem.key !== before)).game.duel;
    check('B5 同じ人に次の小銭: ' + k, d.turn === 0 && d.correct[0] === k, d.correct);
    await L.waitActive(A);
  }
  check('B6 札の点数が増える（みんなにみせる画面も）', await waitFor(async () => (await L.text(W, '#card0')).includes('3点') && (await L.text(A, '#card0')).includes('3点')), await L.text(W, '#card0'));
  check('B7 小銭は正解ごとに増える（3問正解で3枚）', (await L.trayCount(A)) === 3, await L.trayCount(A));
  check('B8 スマホ幅ではみ出さない', (await L.overflow(A)) <= 0, await L.overflow(A));
  await L.shot(A, 'solo-mobile', { fullPage: false });
  await L.shot(W, 'solo-watch', { fullPage: false });

  // ── C. 時計が0でおしまい（残りを1.2秒に早送り） ──
  const sum = await L.traySum(A);
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game/duel', { rem: [1200], at: Date.now() });
  for (const c of [H, A, W]) await L.waitText(c, '#turnLine', 'おしまい', 9000);
  room = await L.roomOf(code);
  check('C1 おしまい（勝ち負けなし）', room.game.duel.phase === 'over' && room.game.duel.winner == null && room.game.ended === true, room.game.duel.winner);
  check('C2 その回の点数', (await L.turnLine(A)).includes('おしまい！ あなた は 3点') && (await L.turnLine(W)).includes('おしまい！ あおい は 3点') && (await L.turnLine(H)).includes('あおい は 3点'), [await L.turnLine(A), await L.turnLine(W)]);
  check('C3 「勝ち」は出さない', !(await L.text(W, '#screen-game')).includes('勝ち'), await L.text(W, '#turnLine'));
  check('C4 時間切れの小銭の合計', (await L.text(W, '#trayBand')).includes('この小銭は ' + sum.toLocaleString('ja-JP') + '円') && (await L.text(W, '#trayBand')).includes('時間切れ'), await L.text(W, '#trayBand'));
  check('C5 出た小銭の一覧（正解3回と時間切れ1回）', (await L.text(W, '#resultBox')).includes('この回で出た小銭（4回）'), await L.text(W, '#resultBox'));
  await waitFor(async () => (await L.stats(H, 'finish')) + (await L.stats(A, 'finish')) >= 1, 3000);
  const fin = (await L.stats(H, 'finish')) + (await L.stats(A, 'finish'));
  check('C6 finish は1回', fin === 1, fin);
  check('C7 ホストの「もう一回」', (await L.text(H, '#resultBox')).includes('もう一回') && !(await L.text(H, '#resultBox')).includes('先に答える人をかえる'), await L.text(H, '#resultBox'));
  check('C8 参加者は待つ', (await L.text(A, '#resultBox')).includes('ホストが次を決めるのを待っているよ'));
  await L.shot(W, 'solo-over-watch', { fullPage: false });
  await L.shot(A, 'solo-over-mobile', { fullPage: true });

  // ── D. もう一回: 同じ1人で新しい回（点数は0から） ──
  await H.page.locator('#resultBox .btn-primary').click();
  room = await L.roomWhen(code, (r) => r.game?.id === 2);
  check('D1 もう一回でも1人', room.game.seats.length === 1 && room.game.duel.correct[0] === 0, room.game.seats);
  check('D2 again と players-1 を数える', await L.waitStats(H, 'again', 1) && await L.waitStats(H, 'players-1', 2));
  check('D3 点数は0から', await waitFor(async () => (await L.text(A, '#card0')).includes('0点')), await L.text(A, '#card0'));

  // ── E. ホストがひとりで（「ホストも対戦する」のまま、だれも入っていない） ──
  const H2 = await L.newClient('host2');
  const code2 = await L.createRoom(H2, 'みどり');
  check('E1 ホストだけでも始められる', !(await H2.page.isDisabled('#btnStartGame')));
  await H2.page.click('#btnStartGame');
  await L.waitScreen(H2, 'game');
  await L.waitActive(H2);
  await L.typeAnswer(H2, await L.traySum(H2));
  await L.roomWhen(code2, (r) => r.game.duel.phase === 'play' && r.game.duel.correct[0] === 1);
  check('E2 ホストがひとりで数えられる', await waitFor(async () => (await L.text(H2, '#card0')).includes('1点')), await L.text(H2, '#card0'));
  await L.rest('PATCH', L.ROOMS + '/' + code2 + '/game/duel', { rem: [800], at: Date.now() });
  await L.waitText(H2, '#turnLine', 'おしまい', 9000);
  check('E3 おしまい！ あなた は 1点', (await L.turnLine(H2)).includes('おしまい！ あなた は 1点'), await L.turnLine(H2));

  // ── F. 1台の画面で1人 ──
  const P = await L.newClient('local', { viewport: { width: 1280, height: 800 } });
  await P.page.clock.install();
  await L.open(P);
  await P.page.click('#btnGoLocal');
  await L.waitScreen(P, 'local');
  check('F1 はじめは2人分の欄', (await P.page.$$('#screen-local .cb-seat')).length === 2);
  await P.page.locator('.cb-seat__del').first().click();
  check('F2 1人にでき、それ以上は外せない', (await P.page.$$('#screen-local .cb-seat')).length === 1 && (await P.page.$$('.cb-seat__del')).length === 0);
  await P.page.fill('#localName0', 'はる');
  await P.page.selectOption('#localCommon-time', '30');
  await P.page.click('#screen-local .btn-primary');
  await L.waitScreen(P, 'game');
  check('F3 local-start を数える', await L.waitStats(P, 'local-start', 1));
  await P.page.clock.runFor(3200);
  await L.waitActive(P);
  for (let k = 0; k < 2; k++) {
    await L.typeAnswer(P, await L.traySum(P));
    await P.page.clock.runFor(1600);
    await L.waitActive(P);
  }
  check('F4 同じ人に次の小銭・2点', (await L.turnLine(P)).includes('はる の番') && (await L.text(P, '#card0')).includes('2点'), [await L.turnLine(P), await L.text(P, '#card0')]);
  await P.page.clock.runFor(31000);
  await L.waitText(P, '#turnLine', 'おしまい', 5000);
  check('F5 おしまい！ はる は 2点', (await L.turnLine(P)).includes('おしまい！ はる は 2点'), await L.turnLine(P));
  check('F6 local-finish を数える', await L.waitStats(P, 'local-finish', 1));
  check('F7 「もう一回」で同じ1人', (await L.text(P, '#resultBox')).includes('もう一回'));
  await P.page.locator('#resultBox .btn-primary').click();
  await P.page.clock.runFor(3200);
  await L.waitActive(P);
  check('F8 もう一回は0点から', (await L.text(P, '#card0')).includes('0点') && (await P.page.$$('.cb-player')).length === 1);
  await L.shot(P, 'solo-local', { fullPage: false });

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
