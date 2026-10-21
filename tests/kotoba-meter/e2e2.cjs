// ことばメーター E2E その2: 参加のエラー・途中参加・再読み込み・やり直し・退出・ルームを閉じる・終わったルームのみんなにみせる画面
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yu', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('haru');
  const C = await L.newClient('late');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'ゆう', code);
  await L.joinRoom(B, 'はる', code);

  // ── A. 参加のエラーはフォームの中 ──
  await L.open(C, '?room=' + code);
  await C.page.fill('#nickname', 'ゆう');
  await C.page.click('#enter');
  await L.waitVisible(C, '#entry-error');
  check('A1 同じニックネームは入れない', (await L.text(C, '#entry-error')).includes('使われている'), await L.text(C, '#entry-error'));
  check('A2 失敗しても ?room= は残す', (await C.page.evaluate(() => location.search)).includes('room='));

  // ── B. 開始（制限時間なし）と途中参加 ──
  await H.page.click('#start');
  await L.waitVisible(H, '#secret-area');
  check('B1 制限時間なしのときは残り時間を出さない', !(await L.visible(H, '#hint-timer')));
  await C.page.fill('#nickname', 'そら');
  await C.page.click('#enter');
  await L.waitText(C, '#entry-error', 'ラウンドの途中');
  check('B2 ラウンドの途中は参加できない', true);

  // ── C. 再読み込みしても続きから ──
  await L.sendHint(H, 'りんご');
  await L.waitVisible(A, '#vote-area');
  await L.answer(A, 5);
  await A.page.waitForFunction(() => document.querySelector('#choices button[value="5"]').getAttribute('aria-pressed') === 'true');
  await A.page.reload();
  await L.gate(A);
  await L.waitVisible(A, '#vote-area');
  await A.page.waitForFunction(() => document.querySelector('#choices button[value="5"]').getAttribute('aria-pressed') === 'true', null, { timeout: 8000 }).catch(() => {});
  check('C1 参加者は再読み込みしても自分の予想が残る', await L.pressed(A, '#choices button[value="5"]'));
  await H.page.reload();
  await L.gate(H);
  await L.openHostMenu(H);
  await L.waitVisible(H, '#reveal');
  check('C2 進行役は再読み込みしても進行役のまま', (await L.text(H, '#my-role')) === '進行役' && (await L.text(H, '#leave')) === 'ルームを閉じる');

  // ── D. やり直し ──
  await H.page.click('#reset');
  await L.waitText(A, '#phase-title', 'みんながそろったら');
  const room = await L.roomOf(code);
  check('D1 やり直すと待合室へ・ヒントと予想は消える', room.status === 'lobby' && !room.hint && !room.answers && !room.secret);

  // ── E. 参加者の退出 ──
  await B.page.click('#leave');
  await L.waitVisible(B, '#screen-top');
  check('E1 退出するとトップへ', true);
  await L.waitText(H, '#people-title', '2人');
  check('E2 進行役の一覧から消える', !(await L.text(H, '#players')).includes('はる'));

  // ── E2. 接続が切れたままの人を外す ──
  const idOf = async (name) => Object.entries((await L.roomOf(code)).players).find(([, p]) => p.name === name)?.[0];
  const removeBtn = (name) => `#players button[aria-label="${name}さんを外す"]`;
  await C.page.fill('#nickname', 'そら');
  await C.page.click('#enter');
  await L.waitVisible(C, '#game');
  await L.waitText(H, '#people-title', '3人');
  check('E3 つながっている人には「外す」を出さない', !(await H.page.$('#players button[data-remove]')));
  const soraId = await idOf('そら');
  await C.page.evaluate(() => firebase.database().goOffline());
  await L.waitVisible(H, removeBtn('そら'), 20000);
  check('E4 接続が切れると進行役に「外す」', (await H.page.$$('#players button[data-remove]')).length === 1);
  await sleep(1200);
  check('E5 参加者には「外す」を出さない', !(await A.page.$('#players button[data-remove]')));
  await L.shot(H, 'e-remove-button', false);
  await H.page.click(removeBtn('そら'));
  await L.waitText(H, '#people-title', '2人', 10000);
  let r = await L.roomOf(code);
  check('E6 外すと行が消え、参加順の目印は残る', !r.players[soraId] && r.playerOrder.includes(soraId));
  await L.waitText(A, '#people-title', '2人', 10000);
  check('E7 ほかの参加者の一覧からも消える', !(await L.text(A, '#players')).includes('そら'));
  await C.page.evaluate(() => firebase.database().goOnline());
  await L.waitVisible(C, '#entry-error', 15000);
  check('E8 外された人が戻ると参加の画面にお知らせ', await L.visible(C, '#code-field'), await L.text(C, '#entry-error'));
  check('E9 外された人がよみがえらない', !(await L.roomOf(code)).players[soraId]);
  // 出題中の出題者を外すと、ラウンドをやり直す
  await C.page.fill('#nickname', 'そら');
  await C.page.click('#enter');
  await L.waitVisible(C, '#game');
  await L.waitText(H, '#people-title', '3人');
  const yuId = await idOf('ゆう');
  await H.page.selectOption('#presenter-select', yuId);
  await L.waitText(A, '#next-presenter', 'ゆう');
  await H.page.click('#start');
  await L.waitVisible(A, '#secret-area');
  const roundBefore = (await L.roomOf(code)).round;
  await A.page.evaluate(() => firebase.database().goOffline());
  await L.waitVisible(H, removeBtn('ゆう'), 20000);
  await H.page.click(removeBtn('ゆう'));
  await L.waitText(H, '#phase-title', 'みんながそろったら', 10000);
  r = await L.roomOf(code);
  check('E10 出題中の出題者を外すと待合室へ', r.status === 'lobby' && r.round === roundBefore + 1 && !r.players[yuId] && !r.secret);
  await A.page.evaluate(() => firebase.database().goOnline());
  await L.waitVisible(A, '#entry-error', 15000);
  await A.page.fill('#nickname', 'ゆう');
  await A.page.click('#enter');
  await L.waitVisible(A, '#game');
  await L.waitText(H, '#people-title', '3人', 10000).catch(() => {});
  check('E11 外された人は同じニックネームで入り直せる', (await L.text(H, '#players')).includes('ゆう'));
  // 予想中に外すと、回答数の分母から消える
  await L.waitText(H, '#people-title', '3人');
  await H.page.selectOption('#presenter-select', await idOf('メンター'));
  await L.waitText(A, '#next-presenter', 'メンター');
  await H.page.click('#start');
  await L.waitVisible(H, '#secret-area');
  await L.sendHint(H, 'りんご');
  await L.waitVisible(A, '#vote-area');
  await L.answer(A, 3);
  await L.waitText(H, '#progress', '1 / 2');
  const soraId2 = await idOf('そら');
  await C.page.evaluate(() => firebase.database().goOffline());
  await L.waitVisible(H, removeBtn('そら'), 20000);
  await H.page.click(removeBtn('そら'));
  await L.waitText(H, '#progress', '1 / 1', 10000);
  r = await L.roomOf(code);
  check('E12 予想中に外すと回答数から消え、ラウンドは続く', r.status === 'vote' && !r.players[soraId2] && r.answers?.[soraId2] === undefined);
  check('E13 残った人の予想はそのまま', Object.values(r.answers || {}).includes(3));
  await C.page.evaluate(() => firebase.database().goOnline());

  // ── F. ルームを閉じる ──
  await L.openWatch(W, code);
  await H.page.click('#leave');
  await L.waitVisible(H, '#screen-top');
  check('F1 進行役はトップへ', true);
  await L.waitVisible(A, '#entry-error', 10000);
  check('F2 参加者は参加の画面にお知らせ', await L.visible(A, '#code-field'), await L.text(A, '#entry-error'));
  await L.waitVisible(W, '#watch-end', 10000);
  check('F3 みんなにみせる画面は終わりの表示', true);
  check('F4 ルームは消える', !(await L.roomOf(code)));
  await L.shot(A, 'f-closed-guest-375', false);
  await W.page.click('#watch-end-top');
  await L.waitVisible(W, '#screen-top');
  check('F5 終わりの表示からトップへ', !(await W.page.evaluate(() => location.search)));

  // ── G. ないルームのみんなにみせる画面 ──
  await L.open(W, '?watch=ZZZZZZ');
  await L.waitVisible(W, '#watch-end', 10000);
  check('G1 ないルームは終わりの表示', (await L.text(W, '#watch-end-text')).length > 0);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
