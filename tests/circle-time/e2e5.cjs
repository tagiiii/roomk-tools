// サークルタイム E2E その5: 準備で決めたみんなでゲームの「ルームを作る」で、そのゲームのタブが開き、本物のツール（クイズパック）でルームを作ると、参加リンクが自動でみんなの端末に出る
const L = require('./lib.cjs');
const { check } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });
  // 準備の画面でクイズパックをえらぶ（このテストの場所には、クイズパックが写してある）
  const code = await L.createRoom(H, 'みほ', { kind: 'pm', game: 'quiz' });
  let room = await L.roomOf(code);
  const gi = room.steps.findIndex((s) => s.type === 'game');
  await L.joinRoom(A, 'ゆい', code);
  await L.openWatch(W, code);
  await L.goMain(H, code, room.steps[gi].id);
  await L.waitStage(W, 'クイズパック');
  // 進行役のタブに、前に作った別のツールのルームの記録が残っている（開いたタブにも写る）
  await H.page.evaluate(() => sessionStorage.setItem('old_tool_session', JSON.stringify({ roomCode: 'ZZZ234' })));
  const popupP = H.context.waitForEvent('page');
  await H.page.click('#game-picks [data-open]');
  const popup = await popupP;
  await popup.waitForLoadState();
  await new Promise((r) => setTimeout(r, 3000));
  room = await L.roomOf(code);
  check('E0 ルームを作る前は、前のルームの記録を参加リンクとして送らない', !room.steps[gi].gameCode && !room.steps[gi].link && !(await A.page.$('#player-card .p-go')), room.steps[gi]);
  check('E1 「ルームを作る」でクイズパックのタブが開く', popup.url().includes('/apps/quiz/'), popup.url());
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
