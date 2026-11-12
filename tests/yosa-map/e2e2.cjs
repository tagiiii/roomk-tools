// よさマップ E2E その2: 切断と復帰。
//   それぞれ自分のマップ: ホストの読み込み直し・ホストの切断（「ホストの戻りを待っています」）・期限内の復帰・待つ画面からの退出・
//     参加する人の切断と復帰（作っている途中／完成したあと）・2分の期限切れ（参加している人／あとから参加する人／あとから戻ったホスト）
//   みんなで1人のマップ: マップの本人が切れる → ホストが本人の代わりに押せる → 本人が戻る・「見えた」の札を選んでいる途中でホストが切れる・
//     ながめる画面でホストが切れる
// 切断は「タブを別のページへ移す」形で作り、2分の期限は切断の時刻の書きかえで早送りする（通信だけが落ちる形と実時間の2分は その3）
const L = require('./lib.cjs');
const { check, sleep, roomOf, rest } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const TTL = 2 * 60 * 1000;
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const popOpen = (c) => c.page.evaluate(() => document.querySelector('#p-pop').open);
const leaves = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--leaf`)].map((n) => `${n.querySelector('.mp-leaf__text').textContent}|${n.classList.contains('is-offer') ? 'offer' : n.querySelector('.mp-leaf--kept') ? 'kept' : 'self'}`), box);
const yosas = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--genre .mp-genre__text`)].map((n) => n.textContent), box);
const pickYosa = (c, label) => c.page.locator('#p-genres .ym-genre', { hasText: label }).first().click();
const pickItem = (c, label) => c.page.locator('#p-items .ym-item', { hasText: label }).first().click();
const closePop = async (c) => { await c.page.click('#p-pop-close'); await c.page.waitForFunction(() => !document.querySelector('#p-pop').open); };
const itemsIn = (room, name, yid) => arr(room?.maps?.[name]?.items?.[yid]);
const itemOf = (room, name, yid, t) => itemsIn(room, name, yid).find((x) => x.t === t);
const bySeg = (c) => c.page.evaluate(() => document.querySelector('#p-by-seg button[aria-checked="true"]')?.textContent);
const onTop = (c) => c.page.evaluate(() => { const r = document.querySelector('#btnOverlayLeave').getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top && top.id === 'btnOverlayLeave'; });
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
// よさを足して、場面を1つ選ぶ
async function addYosa(c, label, item) {
  await node(c, 'よさを足す').click();
  await pickYosa(c, label);
  await L.waitText(c, '#p-panel-title', label);
  if (item) await pickItem(c, item);
  await closePop(c);
}

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const mio = await L.newClient('mio', { viewport: { width: 375, height: 812 } });
  const late = await L.newClient('late');

  // ══ ルーム1: それぞれ自分のマップを作っている途中 ══
  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(yu, 'ゆう', code);
  await L.joinRoom(mio, 'みお', code);
  await L.waitText(host, '#lobbyPlayers', 'みお');
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-pick');
  await addYosa(yu, 'やさしい', 'だれかが困っているとき');
  await addYosa(host, 'ていねい', 'ものを作るとき');
  await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 1 && itemsIn(r, 'ホスト', 'careful').length + arr(r?.maps?.['ホスト']?.yosa).length >= 1);

  // 1. ホストが読み込み直す → ホストとして同じ画面に戻る
  await host.page.reload();
  await L.gate(host);
  await L.waitVisible(host, '#screen-pick');
  const a1 = await waitRoom(code, (r) => r?.hostConnected === true && !r.hostDisconnectedAt);
  check('host reload: back as host', a1.hostConnected === true && !a1.hostDisconnectedAt && (await L.text(host, '#btnLeave')) === 'ルームを閉じる');
  check('host reload: own map kept', JSON.stringify(await yosas(host)) === JSON.stringify(['ていねい']), await yosas(host));
  check('host reload: host controls shown', await L.visible(host, '#p-host'));
  await L.waitHidden(yu, '#hostOffOverlay');
  check('host reload: guest not kicked', (await L.visible(yu, '#p-box')) && JSON.stringify(await yosas(yu)) === JSON.stringify(['やさしい']));

  // 2. ホストが切れる → 参加する人に「ホストの戻りを待っています」
  // ゆうはポップアップをひらいたまま（場面を選んでいる途中）
  await node(yu, 'やさしいの場面を選ぶ').click();
  await pickItem(yu, '人の話を聞くとき');
  await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 2);
  check('before host off: popup open', await popOpen(yu));
  await goAway(host);
  const a2 = await waitRoom(code, (r) => r?.hostConnected === false);
  check('host off: recorded', a2.hostConnected === false && typeof a2.hostDisconnectedAt === 'number', [a2.hostConnected, a2.hostDisconnectedAt]);
  check('host off: room and maps stay', a2.status === 'pick' && itemsIn(a2, 'ゆう', 'kind').length === 2 && arr(a2.maps['ホスト'].yosa).length === 1);
  await L.waitVisible(yu, '#hostOffOverlay');
  await L.waitVisible(mio, '#hostOffOverlay');
  check('host off: overlay text', (await L.text(yu, '#hostOffOverlay')).includes('ホストの戻りを待っています'));
  // ひらいていたポップアップは閉じて、待つ画面がいちばん手前に見える。選んだものは残る
  check('host off: popup closed', !(await popOpen(yu)));
  check('host off: overlay is on top', await onTop(yu));
  check('host off: picks kept on the map', (await leaves(yu)).length === 2, await leaves(yu));
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
  check('host back: own map kept', JSON.stringify(await yosas(host)) === JSON.stringify(['ていねい']), await yosas(host));
  await L.waitHidden(yu, '#hostOffOverlay');
  check('host back: guest continues', await L.visible(yu, '#p-box'));
  // 戻ったあとも、ふつうに書きかえられる
  await node(yu, '人の話を聞くときを消す').click();
  check('host back: guest can edit again', itemsIn(await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 1), 'ゆう', 'kind').length === 1);
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');
  await L.waitText(host, '#p-progress', '1 / 2');
  check('host back: host sees guest progress', true);

  // 5. 参加する人が切れる（完成したあと）→ 在室が消える。戻ると同じ名前で入りなおし、完成のまま
  await goAway(yu);
  const a5 = await waitRoom(code, (r) => r && !r.players['ゆう']);
  check('guest off: presence removed, map kept', !a5.players['ゆう'] && a5.maps['ゆう'].done === true && itemsIn(a5, 'ゆう', 'kind').length === 1);
  // 切れているあいだも、できた人の数にはマップを作った人として残る
  check('guest off: host screen keeps going', (await L.visible(host, '#p-host')) && !(await L.visible(host, '#hostOffOverlay')));
  await comeBack(yu);
  await L.waitVisible(yu, '#p-sent');
  const a5b = await waitRoom(code, (r) => !!r?.players?.['ゆう']);
  check('guest back: same name, done map', !!a5b.players['ゆう'] && JSON.stringify(await yosas(yu, '#p-sent-map')) === JSON.stringify(['やさしい']), await yosas(yu, '#p-sent-map'));
  // 選びなおす → 作っている途中で切れる → 戻ると、つづきから
  await yu.page.click('#p-redo');
  await L.waitVisible(yu, '#p-box');
  await addYosa(yu, 'おもしろい', 'チャットで話すとき');
  await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'funny').length === 1);
  await goAway(yu);
  await waitRoom(code, (r) => r && !r.players['ゆう']);
  await comeBack(yu);
  await L.waitVisible(yu, '#p-box');
  await waitRoom(code, (r) => !!r?.players?.['ゆう']);
  check('guest back (making): map kept', JSON.stringify(await yosas(yu)) === JSON.stringify(['やさしい', 'おもしろい']) && (await leaves(yu)).length === 2, [await yosas(yu), await leaves(yu)]);
  await node(yu, 'チャットで話すときを消す').click();
  check('guest back (making): can edit', itemsIn(await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'funny').length === 0), 'ゆう', 'funny').length === 0);
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');
  await host.page.click('#p-done');
  await L.waitText(host, '#p-progress', '2 / 2');
  await host.page.click('#btn-show');
  await L.waitVisible(yu, '#screen-show');
  check('after returns: host can run the show', (await roomOf(code)).status === 'show');

  // 6. 見せあいの途中でホストが切れたまま2分たつ → 参加している人はトップへ戻り、ルームは消える
  await goAway(host);
  await waitRoom(code, (r) => r?.hostConnected === false);
  await L.waitVisible(yu, '#hostOffOverlay');
  check('host off (show): overlay on top of the show screen', (await onTop(yu)) && (await L.visible(yu, '#screen-show')));
  await expire(code);
  await L.waitVisible(yu, '#screen-top', 15000);
  check('expired: guest back to top', !(await L.visible(yu, '#hostOffOverlay')) && !(await L.visible(yu, '#roomBar')));
  const a6 = await waitRoom(code, (r) => r === null);
  check('expired: room removed by the guest', a6 === null, a6);
  check('expired: session cleared', (await yu.page.evaluate(() => sessionStorage.getItem('yosamap_session'))) === null);
  // ホストがあとから戻っても、トップに戻るだけ（ルームを作りなおさない）
  await comeBack(host);
  await L.waitVisible(host, '#screen-top');
  await sleep(800);
  check('expired: late host lands on top, no ghost room', (await roomOf(code)) === null && !(await L.visible(host, '#roomBar')));

  // ══ ルーム2: 期限切れのルームに、あとから参加しようとした人が片づける ══
  const code2 = await L.createRoom(host, 'ホスト');
  await goAway(host);
  await waitRoom(code2, (r) => r?.hostConnected === false);
  await expire(code2);
  await L.open(late, '?room=' + code2);
  await late.page.fill('#guestName', 'おそい');
  await late.page.click('#btnJoinRoom');
  await L.waitText(late, '#joinError', 'このルームは終わったみたい');
  check('expired join: refused and removed', (await waitRoom(code2, (r) => r === null)) === null);

  // ══ ルーム3: 期限切れのあとに戻ったホストが片づける（ほかにだれもいない） ══
  await comeBack(host);
  await L.waitVisible(host, '#screen-top');
  const code3 = await L.createRoom(host, 'ホスト');
  await goAway(host);
  await waitRoom(code3, (r) => r?.hostConnected === false);
  await expire(code3);
  await comeBack(host);
  await L.waitVisible(host, '#screen-top');
  check('expired host return: removed', (await waitRoom(code3, (r) => r === null)) === null);

  // ══ ルーム4: 期限の前なら、あとから来た人も参加できる（ホストは切れたまま） ══
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

  // ══ ルーム5: みんなで1人のマップ（ゆうのマップ） ══
  const code5 = await L.createRoom(host, 'ホスト');
  await L.joinRoom(yu, 'ゆう', code5);
  await L.joinRoom(mio, 'みお', code5);
  await L.waitText(host, '#lobbyPlayers', 'みお');
  await L.seg(host, 'mode-opts', 'みんなで1人のマップを作る');
  await L.seg(host, 'focus-opts', 'ゆう');
  await waitRoom(code5, (r) => r?.settings?.focus === 'ゆう');
  await host.page.click('#btnStart');
  await L.waitVisible(mio, '#screen-pick');
  // ゆう（本人）が1つ選び、みおが「見えた」の印を2つ付ける
  await addYosa(yu, 'やさしい', 'ゲームでゆずるとき');
  await mio.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf').length === 1);
  await node(mio, 'やさしいの場面を選ぶ').click();
  await pickItem(mio, 'だれかが困っているとき');
  await pickItem(mio, '年下の子といるとき');
  await closePop(mio);
  await waitRoom(code5, (r) => itemsIn(r, 'ゆう', 'kind').length === 3);
  // 本人がいるあいだ、ホストは「わたしから見えた」がはじめの値で、本人の札は動かせない
  await host.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf').length === 3);
  await node(host, 'やさしいの場面を選ぶ').click();
  check('one: host adds as other while the person is here', (await bySeg(host)) === 'わたしから見えた', await bySeg(host));
  await closePop(host);
  check('one: host cannot remove the person\'s leaf while the person is here', (await node(host, 'ゲームでゆずるときを消す').count()) === 0);

  // 7. マップの本人が切れる → マップは残り、ホストが本人の代わりに押せる
  await goAway(yu);
  const b1 = await waitRoom(code5, (r) => r && !r.players['ゆう']);
  check('person off: presence removed, map and marks kept', !b1.players['ゆう'] && b1.focus === 'ゆう' && b1.status === 'pick' && itemsIn(b1, 'ゆう', 'kind').length === 3 && JSON.stringify(arr(itemOf(b1, 'ゆう', 'kind', 'だれかが困っているとき').from)) === JSON.stringify(['みお']));
  check('person off: title stays for the others', (await L.text(mio, '#p-maptitle')) === 'ゆうさんのよさマップ' && (await leaves(mio)).length === 3);
  await host.page.waitForFunction(() => !!document.querySelector('#p-map g.mp-node.is-tap[aria-label="ゲームでゆずるときを消す"]'));
  check('person off: host can act as the person on the map', (await node(host, 'ゲームでゆずるときを消す').count()) === 1);
  await node(host, 'やさしいの場面を選ぶ').click();
  check('person off: host adds as the person by default', (await bySeg(host)) === 'ゆうさんが選んだ', await bySeg(host));
  await closePop(host);
  await node(host, 'だれかが困っているとき（見えた場面。押すと選べる）').click();
  await L.waitVisible(host, '#p-offer');
  check('person off: host can take or drop the offered leaf', (await L.visible(host, '#p-offer-take')) && (await L.visible(host, '#p-offer-drop')));
  await host.page.click('#p-offer-take');
  const b2 = await waitRoom(code5, (r) => itemOf(r, 'ゆう', 'kind', 'だれかが困っているとき')?.self === true);
  check('person off: host took the leaf for the person', itemOf(b2, 'ゆう', 'kind', 'だれかが困っているとき')?.self === true);
  // ほかの人は、本人がいないあいだも印を付けられる
  await node(mio, 'やさしいの場面を選ぶ').click();
  await pickItem(mio, '人の話を聞くとき');
  await closePop(mio);
  check('person off: others can still mark', arr(itemOf(await waitRoom(code5, (r) => !!itemOf(r, 'ゆう', 'kind', '人の話を聞くとき')), 'ゆう', 'kind', '人の話を聞くとき')?.from).includes('みお'));
  await L.shot(host, '23-one-person-off-host');

  // 8. 本人が戻る → 同じ名前で、本人としてつづきから。ホストは「わたしから見えた」にもどる
  await comeBack(yu);
  await L.waitVisible(yu, '#screen-pick');
  const b3 = await waitRoom(code5, (r) => !!r?.players?.['ゆう']);
  check('person back: presence restored', !!b3.players['ゆう']);
  await yu.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf').length === 4);
  check('person back: map with marks made meanwhile', JSON.stringify((await leaves(yu)).sort()) === JSON.stringify(['ゲームでゆずるとき|self', 'だれかが困っているとき|kept', '年下の子といるとき|offer', '人の話を聞くとき|offer'].sort()), await leaves(yu));
  check('person back: finish button for the person', await L.visible(yu, '#p-finish'));
  await node(yu, '年下の子といるとき（見えた場面。押すと選べる）').click();
  await L.waitVisible(yu, '#p-offer');
  check('person back: no drop button for the person', !(await L.visible(yu, '#p-offer-drop')));
  await yu.page.click('#p-offer-take');
  check('person back: can take a leaf as the person', itemOf(await waitRoom(code5, (r) => itemOf(r, 'ゆう', 'kind', '年下の子といるとき')?.self === true), 'ゆう', 'kind', '年下の子といるとき')?.self === true);
  await host.page.waitForFunction(() => !document.querySelector('#p-map g.mp-node.is-tap[aria-label="ゲームでゆずるときを消す"]'));
  check('person back: host no longer acts as the person', (await node(host, 'ゲームでゆずるときを消す').count()) === 0);

  // 9. 「見えた」の札を選んでいる途中でホストが切れる → 選ぶ窓は閉じて、待つ画面が手前
  await node(yu, '人の話を聞くとき（見えた場面。押すと選べる）').click();
  await L.waitVisible(yu, '#p-offer');
  await node(mio, 'やさしいの場面を選ぶ').click();
  check('before host off (one): windows open', (await popOpen(yu)) && (await popOpen(mio)));
  await goAway(host);
  await waitRoom(code5, (r) => r?.hostConnected === false);
  await L.waitVisible(yu, '#hostOffOverlay');
  await L.waitVisible(mio, '#hostOffOverlay');
  check('host off (one): windows closed, overlay on top', !(await popOpen(yu)) && !(await popOpen(mio)) && (await onTop(yu)) && (await onTop(mio)));
  check('host off (one) 375: no overflow', (await L.overflow(mio)) <= 0);
  const b4 = await roomOf(code5);
  check('host off (one): map untouched', b4.status === 'pick' && b4.focus === 'ゆう' && itemsIn(b4, 'ゆう', 'kind').length === 4 && itemOf(b4, 'ゆう', 'kind', '人の話を聞くとき').self === false);
  await comeBack(host);
  await L.waitVisible(host, '#screen-pick');
  await L.waitHidden(yu, '#hostOffOverlay');
  await L.waitHidden(mio, '#hostOffOverlay');
  check('host back (one): same map and title', (await L.text(host, '#p-maptitle')) === 'ゆうさんのよさマップ' && (await leaves(host)).length === 4);
  // 本人がいるので、戻ったホストは「わたしから見えた」
  await node(host, 'やさしいの場面を選ぶ').click();
  check('host back (one): host adds as other again', (await bySeg(host)) === 'わたしから見えた', await bySeg(host));
  await closePop(host);
  // 本人が完成にする → みんなでながめる
  await yu.page.click('#p-done');
  await L.waitVisible(mio, '#screen-show');
  check('one finish after returns: show', (await roomOf(code5)).status === 'show');

  // 10. ながめる画面でホストが切れて戻る → 同じ画面のまま、つぎの人へ進められる
  await goAway(host);
  await waitRoom(code5, (r) => r?.hostConnected === false);
  await L.waitVisible(mio, '#hostOffOverlay');
  await comeBack(host);
  await L.waitVisible(host, '#screen-show');
  await L.waitHidden(mio, '#hostOffOverlay');
  check('host back (show): host box and next-person buttons', (await L.visible(host, '#s-host')) && (await host.page.locator('#s-next-names button').allTextContents()).includes('みお'));
  await host.page.locator('#s-next-names button', { hasText: 'みお' }).click();
  await L.waitText(yu, '#p-maptitle', 'みおさんのよさマップ');
  const b5 = await roomOf(code5);
  check('host back (show): next person, previous map kept', b5.focus === 'みお' && b5.status === 'pick' && itemsIn(b5, 'ゆう', 'kind').length === 4);

  // 11. つぎの本人（375px）が切れているあいだにホストが完成にする → 戻った本人はながめる画面へ
  await goAway(mio);
  await waitRoom(code5, (r) => r && !r.players['みお']);
  await host.page.waitForFunction(() => (document.querySelector('#p-map g.mp-node.is-tap[aria-label="よさを足す"]')) !== null);
  await addYosa(host, '好奇心がある', 'しくみが気になるとき');
  const b6 = await waitRoom(code5, (r) => itemsIn(r, 'みお', 'curious').length === 1);
  check('person off (2): host added as the person', itemsIn(b6, 'みお', 'curious')[0]?.self === true, itemsIn(b6, 'みお', 'curious'));
  await host.page.click('#p-done');
  await L.waitVisible(yu, '#screen-show');
  await comeBack(mio);
  await L.waitVisible(mio, '#screen-show');
  check('person back (2): lands on the show of their own map', (await mio.page.evaluate(() => document.querySelector('#s-map svg').getAttribute('aria-label'))) === 'みおのよさマップ' && (await L.overflow(mio)) <= 0);

  await host.page.click('#btnLeave');
  await L.waitVisible(yu, '#screen-top');
  check('close (one): room removed', (await waitRoom(code5, (r) => r === null)) === null);

  await L.finishAll(server);
})().catch(async (error) => {
  console.error(error);
  // 止まったときの画面を残す
  for (const c of L.clients) {
    const info = await c.page.evaluate(() => ({ screen: document.querySelector('.ym-screen.active')?.id, join: document.querySelector('#joinError')?.textContent, overlay: !document.querySelector('#hostOffOverlay')?.hidden, pop: document.querySelector('#p-pop')?.open, title: document.querySelector('#p-maptitle')?.textContent, toast: document.querySelector('#roomk-toast')?.textContent })).catch(() => null);
    console.error(c.label, JSON.stringify(info), c.errors.slice(0, 3));
  }
  process.exit(1);
});
