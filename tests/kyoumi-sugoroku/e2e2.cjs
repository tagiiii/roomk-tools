// 興味スゴロク E2E その2: 6人まで・途中参加は不可・退出で番をとばす・切断した人の番をとばす・
// 同じ名前で入りなおし・話す番の人が抜けたら次へ・ホストの切断と復帰
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const Q = L.loadQuestions();
  const plainAt = (theme) => Q[theme].findIndex((x) => typeof x === 'string');
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const C = await L.newClient('midori');

  // ── A. 6人まで ──
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'そら', code);
  for (const name of ['い', 'ろ', 'は']) {
    await H.page.fill('#proxyName', name);
    await H.page.click('#btnAddProxy');
    await L.roomWhen(code, (r) => !!r.proxies?.[name]);
  }
  await L.waitText(H, '#waitingCount', '遊ぶ人 6人');
  check('A1 6人になったら足せない', await H.page.isDisabled('#btnAddProxy'));
  await L.open(C, '?room=' + code);
  await C.page.fill('#guestName', 'みどり');
  await C.page.click('#btnJoinRoom');
  await L.waitText(C, '#joinError', 'いっぱい');
  check('A2 7人目は参加できない', true);
  // ホストが進行だけになれば、もう1人入れる。そのあとホストは遊ぶにもどせない
  await H.page.click('#hostPlays');
  await L.roomWhen(code, (r) => r.hostPlays === false);
  await C.page.click('#btnJoinRoom');
  await L.waitScreen(C, 'waiting');
  await L.waitText(H, '#waitingCount', '遊ぶ人 6人');
  check('A3 ホストが進行だけなら6人目の参加者が入れる', true);
  check('A4 6人のときホストは遊ぶにもどせない', await H.page.isDisabled('#hostPlays'));
  // 端末なしの参加者を外して5人に
  for (const name of ['い', 'ろ', 'は']) {
    await H.page.click(`#waitingPlayers li:has-text("${name}") button`);
    await L.roomWhen(code, (r) => !r.proxies?.[name]);
  }
  await L.waitText(H, '#waitingCount', '遊ぶ人 3人');
  check('A5 端末なしの参加者を外せる', true);

  // ── B. 途中参加は不可 ──
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  let room = await L.roomOf(code);
  check('B1 進行だけのホストは順番に入らない', JSON.stringify(room.game.order) === '["あおい","そら","みどり"]', room.game.order);
  check('B2 進行だけのホストもサイコロを押せる', await L.visible(H, '#btn-roll'));
  const X = await L.newClient('late');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'あとから');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'もうゲームが始まっている');
  check('B3 遊んでいる途中に新しい名前では入れない', true);
  await X.context.close();
  L.clients.splice(L.clients.indexOf(X), 1);

  // ── C. 自分の番で退出すると次の人へ ──
  await A.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  room = await L.roomWhen(code, (r) => r.game.turn === 1);
  check('C1 振る番の人が退出したら、すぐ次の人', room.game.turn === 1 && !room.players['あおい'], room.game);
  await L.waitText(B, '#turnNote', 'あなたの番だよ');
  check('C2 抜けた人は「つながっていない」', (await L.indicator(B))[0].tags.includes('つながっていない'));
  // 同じ名前で入りなおす（同じブラウザ）
  await A.page.goto(L.BASE + '?room=' + code);
  await L.waitScreen(A, 'join');
  await A.page.fill('#guestName', 'あおい');
  await A.page.click('#btnJoinRoom');
  await L.waitScreen(A, 'game');
  check('C3 同じ名前・同じブラウザなら入りなおせる', (await L.indicator(A))[0].tags.includes('あなた') && !(await L.indicator(B))[0].tags.includes('つながっていない'));

  // ── D. 話す番の人が退出すると次の人へ ──
  await B.page.click('#btn-roll');
  await L.waitQuestion(B);
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  room = await L.roomWhen(code, (r) => r.game.turn === 2 && r.game.step === 'roll');
  check('D1 話す番の人が退出したら、質問を閉じて次の人', room.game.turn === 2 && !room.game.q, room.game);
  await L.waitText(C, '#turnNote', 'あなたの番だよ');

  // ── E. 切断した人の番は、少し待ってとばす ──
  await C.page.click('#btn-roll');
  await L.waitQuestion(C);
  await L.rest('PATCH', `${L.ROOMS}/${code}/game/q`, { theme: 'suki', idx: plainAt('suki'), n: 4 });
  await L.waitText(C, '#modal-question', Q.suki[plainAt('suki')]);
  await C.page.click('#btn-next');
  await L.waitText(A, '#turnNote', 'あなたの番だよ');
  // あおいのタブを閉じる（切断）。ほかにいるのは みどり だけ（そらは退出したまま）
  const aContext = A.context;
  await A.page.close();
  room = await L.roomWhen(code, (r) => !r.players['あおい'], 20000);
  check('E1 タブを閉じたら在室が消える', !room.players['あおい']);
  room = await L.roomWhen(code, (r) => r.game.turn === 2, 12000);
  check('E2 切断した人の番は、少し待って次にいる人へ（いない人もとばす）', room.game.turn === 2, room.game);
  await L.waitText(H, '#turnNote', 'みどりさんの番だよ');

  // ── F. 再読み込みで同じ席・同じブラウザの新しいタブから入りなおす ──
  await C.page.reload();
  await L.waitScreen(C, 'game');
  check('F1 再読み込みで同じ席', (await L.text(C, '#turnNote')).startsWith('あなたの番'));
  const A2 = await L.newPage(aContext, 'aoi2');
  await L.open(A2, '?room=' + code);
  await A2.page.fill('#guestName', 'あおい');
  await A2.page.click('#btnJoinRoom');
  await L.waitScreen(A2, 'game');
  check('F2 タブを閉じたあと同じ名前で入りなおせる', (await L.indicator(A2))[0].tags.includes('あなた'));

  // ── G. ホストの切断と復帰 ──
  H.offlineOk = true;
  await H.context.setOffline(true);
  await L.waitVisible(C, '#hostOffOverlay', 120000);
  check('G1 ホストが切れたら参加者に案内', (await L.text(C, '#hostOffOverlay')).includes('ホストの戻りを待っています'));
  await C.page.screenshot({ path: L.OUT + '/e2e2-host-off.png' });
  await H.context.setOffline(false);
  await L.waitHidden(C, '#hostOffOverlay', 60000);
  check('G2 ホストがもどったら案内が消える', true);
  room = await L.roomOf(code);
  check('G3 ゲームはそのまま', room.status === 'playing' && room.hostConnected === true, { s: room.status, h: room.hostConnected });
  // 番の人は自分で続けられる
  await C.page.click('#btn-roll');
  await L.waitQuestion(A2);
  check('G4 番の人が続けられる', (await L.card(A2)).player === 'みどり さんへ');

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
