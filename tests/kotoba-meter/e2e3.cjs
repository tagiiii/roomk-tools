// ことばメーター E2E その3: 時間切れで次の出題者へ・進行役の切断と待ち画面・復帰・待ち画面からの退出・2分で終了
// 時間切れ（30秒）と2分の終了を実際に待つので、3分ほどかかる。
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yu', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('haru');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'ゆう', code);
  await L.joinRoom(B, 'はる', code);
  await L.openWatch(W, code);
  await L.waitText(H, '#people-title', '3人');

  // ── A. 時間切れ（30秒）で次の出題者へ ──
  await H.page.click('#hint-seconds button[data-seconds="30"]');
  await H.page.click('#start');
  await L.waitVisible(H, '#secret-area');
  let room = await L.roomOf(code);
  const firstTheme = room.theme.name;
  await sleep(21000);
  check('A1 残り10秒から色を変える', await H.page.evaluate(() => document.getElementById('hint-timer').classList.contains('is-soon')));
  await L.waitVisible(A, '#secret-area', 20000);
  room = await L.roomOf(code);
  check('A2 時間切れで参加順の次の人（ゆう）が出題者', room.round === 2 && room.players[room.presenter].name === 'ゆう' && room.status === 'hint');
  check('A3 お題は前と続かない', room.theme.name !== firstTheme);
  check('A4 時間切れのお知らせ', (await L.text(A, '#phase-note')).includes('時間切れ'));
  check('A5 時間切れのあとは前の出題者に秘密の数字を出さない', !(await L.visible(H, '#secret-area')));
  await L.sendHint(A, 'お風呂上がりの体');
  await L.waitVisible(B, '#vote-area');
  check('A6 次の出題者はそのまま続けられる', true);

  // ── B. 進行役の切断 → 待ち画面 ──
  check('B1 進行役がいる間は待ち画面を出さない', !(await L.visible(A, '#host-away')));
  await H.page.evaluate(() => firebase.database().goOffline());
  await L.waitVisible(A, '#host-away', 20000);
  await L.waitVisible(W, '#host-away', 20000);
  await L.waitVisible(B, '#host-away', 20000);
  check('B2 参加者に「進行役の戻りを待っています」', (await L.text(A, '#host-away-title')).includes('進行役の戻りを待っています'));
  check('B3 参加者のボタンは「退出する」', (await L.text(A, '#host-away-leave')).trim() === '退出する');
  check('B4 みんなにみせる画面のボタンは「トップへ戻る」', (await L.text(W, '#host-away-leave')).trim() === 'トップへ戻る');
  check('B5 待ち画面の後ろは操作できない', await A.page.evaluate(() => document.getElementById('game').inert));
  check('B6 参加者はボタンにフォーカス', await A.page.evaluate(() => document.activeElement.id === 'host-away-leave'));
  check('B7 みんなにみせる画面はフォーカスを移さない', await W.page.evaluate(() => document.activeElement.id !== 'host-away-leave'));
  check('B8 自分の通信の帯とは別', !(await L.visible(A, '#connection')));
  check('B9 進行役の画面には待ち画面を出さない', !(await L.visible(H, '#host-away')));
  await L.shot(A, 'b-hostaway-guest-375', false);
  await L.shot(W, 'b-hostaway-watch', false);

  // ── C. 進行役が戻る → 続きから ──
  await H.page.evaluate(() => firebase.database().goOnline());
  await L.waitHidden(A, '#host-away', 20000);
  await L.waitHidden(W, '#host-away', 20000);
  check('C1 戻ると待ち画面が消えて操作できる', !(await A.page.evaluate(() => document.getElementById('game').inert)));
  check('C2 予想の続きから', await L.visible(B, '#vote-area'));
  await L.answer(B, 2);
  await L.waitText(H, '#progress', '1 / 2', 10000);
  check('C3 進行役が戻ったあとも予想が届く', true);

  // ── D. 待ち画面から抜ける ──
  await H.page.evaluate(() => firebase.database().goOffline());
  await L.waitVisible(B, '#host-away', 20000);
  await B.page.click('#host-away-leave');
  await L.waitVisible(B, '#screen-top', 10000);
  check('D1 待ち画面から退出するとトップへ', !(await L.visible(B, '#host-away')));
  await L.waitVisible(W, '#host-away', 20000);
  await W.page.click('#host-away-leave');
  await L.waitVisible(W, '#screen-top', 10000);
  check('D2 みんなにみせる画面はトップへ', !(await W.page.evaluate(() => location.search)));
  await H.page.evaluate(() => firebase.database().goOnline());
  await L.waitHidden(A, '#host-away', 20000);
  await L.waitText(H, '#people-title', '2人', 10000);
  check('D3 退出した人は一覧から消える', !(await L.text(H, '#players')).includes('はる'));

  // ── E. 2分戻らなければルームを終える ──
  await H.page.evaluate(() => firebase.database().goOffline());
  await L.waitVisible(A, '#host-away', 20000);
  const t0 = Date.now();
  await L.waitVisible(A, '#entry-error', 170000);
  const sec = Math.round((Date.now() - t0) / 1000);
  check('E1 2分で終わり、参加の画面にお知らせ', (await L.text(A, '#entry-error')).includes('2分') && !(await L.visible(A, '#host-away')), sec);
  check('E2 ルームは消える', !(await L.roomOf(code)));
  console.log('  ended after ' + sec + 's');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
