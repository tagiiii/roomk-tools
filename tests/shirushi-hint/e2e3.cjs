// しるしでヒント E2E その3: しるしごとに選ぶ時間（時間制限）
const path = require('path');
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const W = await L.newClient('watch');

  const code = await L.createRoom(H, 'メンター');
  let room = await L.roomOf(code);
  check('T1 はじめは時間制限なし', room.signTime === 0);
  const opts = await H.page.$$eval('#signTimeOpts .sh-timeopt', (els) => els.map((e) => e.textContent.trim()));
  check('T3 なし・15秒・30秒・60秒', opts.join() === 'なし,15秒,30秒,60秒', opts);
  check('T4 選んでいるものに印', (await H.page.$eval('#signTimeOpts .sh-timeopt.is-on', (e) => e.textContent)) === 'なし');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'そら', code);
  await H.page.click('#signTimeOpts .sh-timeopt >> nth=1');
  room = await L.roomWhen(code, (r) => r.signTime === 15);
  check('T5 15秒にできる', room.signTime === 15);
  await L.waitText(A, '#waitingTime', '15秒');
  check('T6 参加者にも設定が見える', true);
  check('T7 参加者は変えられない', !(await L.visible(A, '#signTimeOpts')));
  await H.page.check('#hostPlays');
  await L.waitText(H, '#waitingCount', '遊ぶ人 3人');
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'pick');
  room = await L.roomOf(code);
  check('T8 開始時の設定で固定', room.game.signTime === 15);
  // ホストが伝える人
  await H.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(A, 'hint');
  check('T9 しるしの前は残り時間を出さない', !(await L.visible(A, '#hintTimer')));
  const tH = await L.tiles(H);
  const ans = tH.find((x) => x.answer).t;
  const wrong = tH.find((x) => !x.answer).t;
  await L.sendSign(H, '動物');
  await L.waitVisible(A, '#hintTimer');
  const t0 = await L.text(A, '#hintTimer');
  check('T10 しるしが出たら残り時間', /^のこり 1[45]秒$/.test(t0), t0);
  check('T11 見る画面・伝える人にも残り時間', await L.visible(W, '#hintTimer') && await L.visible(H, '#hintTimer'));
  room = await L.roomOf(code);
  check('T12 しるしを出した時刻が入る', Number.isFinite(room.game.q.openedAt) && room.game.q.openedAt > 0);
  await L.tapTile(A, wrong);
  // 再読み込みしても、残り時間は続きから
  await sleep(3000); // 少し時間がたってから再読み込みする
  await B.page.reload();
  await L.waitScreen(B, 'hint', 10000);
  await L.waitVisible(B, '#hintTimer');
  const t1 = await L.text(B, '#hintTimer');
  check('T13 再読み込みしても残り時間は続き', /^のこり (\d+)秒$/.test(t1) && Number(t1.match(/\d+/)[0]) <= 12, t1);
  await A.page.screenshot({ path: path.join(L.OUT, 't-timer.png'), fullPage: true });
  // そらは選ばないまま、時間切れ
  await B.page.waitForFunction(() => /のこり [1-5]秒/.test(document.querySelector('#hintTimer').textContent), null, { timeout: 16000 });
  check('T14 残り5秒から色を変える', await B.page.$eval('#hintTimer', (e) => e.classList.contains('is-soon')));
  room = await L.roomWhen(code, (r) => r.game.q.judged === 1, 12000);
  check('T15 時間になったら答え合わせ', room.game.q.judged === 1 && room.status === 'hint', room.status);
  check('T16 選んでいない人は減らない・はずれは −1点', room.game.scores['そら'] === 0 && room.game.scores['あおい'] === -1, room.game.scores);
  await B.page.waitForFunction(() => document.querySelector('#hintTimer').closest('[hidden]') || document.querySelector('#hintTimer').hidden);
  check('T17 締まったら残り時間を消す', true);
    // 2つ目: 時間の前に全員選べば、すぐ答え合わせ
  await L.sendSign(H, '大きい');
  await A.page.waitForFunction(() => document.querySelectorAll('#hintBoard button.sh-tile').length > 0);
  const before = Date.now();
  await L.tapTile(A, ans);
  await L.tapTile(B, ans);
  await L.waitScreen(H, 'reveal');
  check('T19 全員選べば時間を待たない', Date.now() - before < 8000);
  room = await L.roomOf(code);
  check('T20 点', room.game.scores['あおい'] === 1 && room.game.scores['そら'] === 2 && room.game.scores['メンター'] === 2, room.game.scores);
  // 時間制限なしに戻すと、残り時間は出ない
  await H.page.click('#btnFinish');
  await L.waitScreen(H, 'end');
  await H.page.click('#btnPlayAgain');
  await L.waitScreen(H, 'waiting');
  await H.page.click('#signTimeOpts .sh-timeopt >> nth=0');
  room = await L.roomWhen(code, (r) => r.signTime === 0);
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'pick');
  await H.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(A, 'hint');
  await L.sendSign(H, '動物');
  await A.page.waitForFunction(() => document.querySelectorAll('#hintBoard button.sh-tile').length > 0);
  await sleep(600);
  check('T21 時間制限なしなら残り時間を出さない', !(await L.visible(A, '#hintTimer')));
  room = await L.roomOf(code);
  check('T22 時間制限なしなら時刻を入れない', !room.game.q.openedAt);
  await A.page.setViewportSize({ width: 375, height: 800 });
  await sleep(150);
  check('T23 幅 375px で横にはみ出さない', (await L.overflow(A)) <= 1);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
