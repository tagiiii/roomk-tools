// サークルタイム E2E その5: みんなでゲームで決めると、そのゲームのタブが開き、本物のツール（クイズパック）でルームを作ると、参加リンクが自動でみんなの端末に出る
const L = require('./lib.cjs');
const { check } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });
  const code = await L.createRoom(H, 'みほ', { kind: 'pm' });
  let room = await L.roomOf(code);
  const gi = room.steps.findIndex((s) => s.type === 'game');
  // 候補の1つ目をクイズパックにする（このテストの場所には、クイズパックが写してある）
  await L.rest('PUT', `${L.ROOMS}/${code}/steps/${gi}/cands/0`, { slug: 'quiz', name: 'クイズパック', hk: '3択・2択のクイズをテンポよく', thumb: 'assets/thumbnails/quiz.png' });
  await L.joinRoom(A, 'ゆい', code);
  await L.openWatch(W, code);
  await L.goMain(H, code, room.steps[gi].id);
  await L.waitStage(W, 'クイズパック');
  const popupP = H.context.waitForEvent('page');
  await H.page.click('#game-picks [data-pick="0"]');
  const popup = await popupP;
  await popup.waitForLoadState();
  check('E1 「これにする」でクイズパックのタブが開く', popup.url().includes('/apps/quiz/'), popup.url());
  // 開いたタブで、いつもどおりルームを作る
  await popup.click('#btnGoCreate');
  await popup.fill('#hostName', 'みほ');
  await popup.click('#btnCreateRoom');
  await popup.waitForFunction(() => /"roomCode":"[A-HJ-NP-Z2-9]{6}"/.test(sessionStorage.getItem('quiz_session') || ''), null, { timeout: 15000 });
  const quizCode = JSON.parse(await popup.evaluate(() => sessionStorage.getItem('quiz_session'))).roomCode;
  check('E2 クイズパックのルームができる（サークルタイムとは別のコード）', /^[A-HJ-NP-Z2-9]{6}$/.test(quizCode) && quizCode !== code, quizCode);
  await L.waitPlayer(A, 'ゲームに入る', 8000);
  const href = await A.page.getAttribute('#player-card .p-go', 'href');
  check('E3 参加者に、クイズパックの参加リンク（?room=）', href.endsWith('/apps/quiz/?room=' + quizCode), href);
  await L.waitStage(W, quizCode);
  check('E4 みんなの画面にクイズパックのルームコード', true);
  // 参加者がそのリンクを開くと、クイズパックの参加画面にコードが入っている
  const P = await A.context.newPage();
  await P.goto(href);
  await P.waitForFunction((c) => [...document.querySelectorAll('input')].some((i) => i.value.toUpperCase() === c), quizCode, { timeout: 10000 }).catch(() => {});
  check('E5 参加リンクを開くと、クイズパックの参加画面にコードが入る', await P.evaluate((c) => [...document.querySelectorAll('input')].some((i) => i.value.toUpperCase() === c), quizCode));
  await L.shot(W, 'pm-game-room', false);
  await L.shot(A, 'pm-player-game-room');
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });
