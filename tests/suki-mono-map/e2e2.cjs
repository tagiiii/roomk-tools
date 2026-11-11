// 好きなものマップ E2E その2: 切断と復帰。
// ホストの読み込み直し・ホストの切断（「ホストの戻りを待っています」）・期限内の復帰・待つ画面からの退出・
// 2分の期限切れ（参加している人／あとから参加する人／あとから戻ったホスト）・参加する人の切断と復帰
const L = require('./lib.cjs');
const { check, sleep, roomOf, rest } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const TTL = 2 * 60 * 1000;
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const genres = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--genre .mp-genre__text`)].map((n) => n.textContent), box);
async function waitRoom(code, test, timeout = 20000) {
  const until = Date.now() + timeout;
  let room = null;
  while (Date.now() < until) { room = await roomOf(code); if (test(room)) return room; await sleep(150); }
  return room;
}
// タブを別のページへ移して、通信を切る（サーバーはすぐ切断に気づく）
const goAway = (c) => c.page.goto('about:blank');
// 同じタブでもどる（sessionStorage が残っているので、同じルームに戻る）
async function comeBack(c) { await c.page.goto(L.BASE); await L.gate(c); }
// 切断の時刻を過去へずらして、2分の期限を早送りする（本物の切断をサーバーが記録したあとで）
async function expire(code) {
  const room = await roomOf(code);
  await rest('PATCH', `${L.ROOMS}/${code}`, { hostDisconnectedAt: room.hostDisconnectedAt - TTL - 5000 });
}
async function addGenre(c, first, label, item) {
  await node(c, first ? '好きなジャンルを足す' : 'ジャンルを足す').click();
  await c.page.locator('#p-genres .sm-genre', { hasText: label }).first().click();
  if (item) await c.page.locator('#p-items .sm-item', { hasText: item }).first().click();
  await c.page.click('#p-pop-close');
}

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const mio = await L.newClient('mio', { viewport: { width: 375, height: 812 } });
  const late = await L.newClient('late');

  // ── ルーム1: 作っている途中 ──
  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(yu, 'ゆう', code);
  await L.joinRoom(mio, 'みお', code);
  await L.waitText(host, '#lobbyPlayers', 'みお');
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-pick');
  await addGenre(yu, true, '動物', '犬');
  await addGenre(host, true, '食べもの', 'カレー');
  await waitRoom(code, (r) => arr(r?.maps?.['ゆう']?.genres).length === 1 && arr(r?.maps?.['ホスト']?.genres).length === 1);

  // 1. ホストが読み込み直す → ホストとして同じ画面に戻る
  await host.page.reload();
  await L.gate(host);
  await L.waitVisible(host, '#screen-pick');
  const a1 = await waitRoom(code, (r) => r?.hostConnected === true && !r.hostDisconnectedAt);
  check('host reload: back as host', a1.hostConnected === true && !a1.hostDisconnectedAt && (await L.text(host, '#btnLeave')) === 'ルームを閉じる');
  check('host reload: own map kept', JSON.stringify(await genres(host)) === JSON.stringify(['食べもの']), await genres(host));
  check('host reload: host controls shown', await L.visible(host, '#p-host'));
  await L.waitHidden(yu, '#hostOffOverlay');
  check('host reload: guest not kicked', (await L.visible(yu, '#p-box')) && JSON.stringify(await genres(yu)) === JSON.stringify(['動物']));

  // 2. ホストが切れる → 参加する人に「ホストの戻りを待っています」
  await goAway(host);
  const a2 = await waitRoom(code, (r) => r?.hostConnected === false);
  check('host off: recorded', a2.hostConnected === false && typeof a2.hostDisconnectedAt === 'number', [a2.hostConnected, a2.hostDisconnectedAt]);
  check('host off: room and maps stay', a2.status === 'pick' && arr(a2.maps['ゆう'].genres).length === 1);
  await L.waitVisible(yu, '#hostOffOverlay');
  await L.waitVisible(mio, '#hostOffOverlay');
  check('host off: overlay text', (await L.text(yu, '#hostOffOverlay')).includes('ホストの戻りを待っています'));
  await L.shot(yu, '21-host-off-overlay', false);
  await L.shot(mio, '22-host-off-overlay-375', false);
  check('host off 375: no overflow', (await L.overflow(mio)) <= 0);

  // 3. 待つ画面の「退出する」で抜けられる
  await mio.page.click('#btnOverlayLeave');
  await L.waitVisible(mio, '#screen-top');
  const a3 = await waitRoom(code, (r) => r && !r.players['みお']);
  check('overlay leave: guest removed, room stays', !a3.players['みお'] && !!a3.players['ゆう'] && a3.status === 'pick');
  check('overlay leave: overlay closed', !(await L.visible(mio, '#hostOffOverlay')));

  // 4. ホストが期限内に戻る → 待つ画面が消えて、つづきから
  await comeBack(host);
  await L.waitVisible(host, '#screen-pick');
  const a4 = await waitRoom(code, (r) => r?.hostConnected === true && !r.hostDisconnectedAt);
  check('host back: connected again', a4.hostConnected === true && !a4.hostDisconnectedAt);
  await L.waitHidden(yu, '#hostOffOverlay');
  check('host back: guest continues', await L.visible(yu, '#p-box'));
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');
  await L.waitText(host, '#p-progress', '1 / 2');
  check('host back: host sees guest progress', true);
  await host.page.click('#btn-show');
  await L.waitVisible(yu, '#screen-show');
  check('host back: host can run the game', (await roomOf(code)).status === 'show');

  // 5. 参加する人が切れる → 在室が消える。戻ると同じ名前で入りなおし、マップも残っている
  await host.page.click('#btn-back-pick');
  await L.waitVisible(yu, '#p-box');
  await goAway(yu);
  const a5 = await waitRoom(code, (r) => r && !r.players['ゆう']);
  check('guest off: presence removed, map kept', !a5.players['ゆう'] && arr(a5.maps['ゆう'].genres).length === 1);
  await comeBack(yu);
  await L.waitVisible(yu, '#screen-pick');
  const a5b = await waitRoom(code, (r) => !!r?.players?.['ゆう']);
  check('guest back: same name, same map', !!a5b.players['ゆう'] && JSON.stringify(await genres(yu)) === JSON.stringify(['動物']), await genres(yu));

  // 6. ホストが切れたまま2分たつ → 参加している人はトップへ戻り、ルームは消える
  await goAway(host);
  await waitRoom(code, (r) => r?.hostConnected === false);
  await L.waitVisible(yu, '#hostOffOverlay');
  await expire(code);
  await L.waitVisible(yu, '#screen-top', 15000);
  check('expired: guest back to top', !(await L.visible(yu, '#hostOffOverlay')) && !(await L.visible(yu, '#roomBar')));
  const a6 = await waitRoom(code, (r) => r === null);
  check('expired: room removed by the guest', a6 === null, a6);
  check('expired: session cleared', (await yu.page.evaluate(() => sessionStorage.getItem('sukimonomap_session'))) === null);
  // ホストがあとから戻っても、トップに戻るだけ（ルームを作りなおさない）
  await comeBack(host);
  await L.waitVisible(host, '#screen-top');
  await sleep(800);
  check('expired: late host lands on top, no ghost room', (await roomOf(code)) === null && !(await L.visible(host, '#roomBar')));

  // ── ルーム2: 期限切れのルームに、あとから参加しようとした人が片づける ──
  const code2 = await L.createRoom(host, 'ホスト');
  await goAway(host);
  await waitRoom(code2, (r) => r?.hostConnected === false);
  await expire(code2);
  await L.open(late, '?room=' + code2);
  await late.page.fill('#guestName', 'おそい');
  await late.page.click('#btnJoinRoom');
  await L.waitText(late, '#joinError', 'このルームは終わったみたい');
  check('expired join: refused and removed', (await waitRoom(code2, (r) => r === null)) === null);

  // ── ルーム3: 期限切れのあとに戻ったホストが片づける（ほかにだれもいない） ──
  await comeBack(host);
  await L.waitVisible(host, '#screen-top');
  const code3 = await L.createRoom(host, 'ホスト');
  await goAway(host);
  await waitRoom(code3, (r) => r?.hostConnected === false);
  await expire(code3);
  await comeBack(host);
  await L.waitVisible(host, '#screen-top');
  check('expired host return: removed', (await waitRoom(code3, (r) => r === null)) === null);

  // ── ルーム4: 期限の前なら、あとから来た人も参加できる（ホストは切れたまま） ──
  const code4 = await L.createRoom(host, 'ホスト');
  await goAway(host);
  await waitRoom(code4, (r) => r?.hostConnected === false);
  await L.open(late, '?room=' + code4);
  await late.page.fill('#guestName', 'おそい');
  await late.page.click('#btnJoinRoom');
  await L.waitVisible(late, '#hostOffOverlay');
  check('join while host is away: joined and waiting', !!(await roomOf(code4)).players['おそい']);
  await comeBack(host);
  await L.waitVisible(host, '#screen-lobby');
  await L.waitHidden(late, '#hostOffOverlay');
  check('join while host is away: host returns to the lobby', (await L.text(host, '#lobbyPlayers')).includes('おそい'));
  await host.page.click('#btnLeave');
  await L.waitVisible(late, '#screen-top');
  check('close: room removed', (await waitRoom(code4, (r) => r === null)) === null);

  await L.finishAll(server);
})().catch(async (error) => {
  console.error(error);
  // 止まったときの画面を残す
  for (const c of L.clients) {
    const info = await c.page.evaluate(() => ({ screen: document.querySelector('.sm-screen.active')?.id, join: document.querySelector('#joinError')?.textContent, overlay: !document.querySelector('#hostOffOverlay')?.hidden, toast: document.querySelector('#roomk-toast')?.textContent })).catch(() => null);
    console.error(c.label, JSON.stringify(info), c.errors.slice(0, 3));
  }
  process.exit(1);
});
