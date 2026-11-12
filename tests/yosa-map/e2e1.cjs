// よさマップ E2E その1: ホスト・参加者2人（1人は375px）・端末なしの参加者1人で、2つの作り方を通す
//   それぞれ自分のマップ: 待合室 → 作る（＋のポップアップ・× で消す・自分で書く）→ 完成 → 見せあう → 待合室
//   みんなで1人のマップ: ほかの人が「見えた」の印を付ける → 本人がもらう → 完成 → つぎの人（端末なしの人。ホストが代わりに押す）
//   さいごに、ホストの読み込み直し・退出・ルームを閉じる
const L = require('./lib.cjs');
const { check, sleep, roomOf } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
// マップの点（押せるもの）を、読み上げ用の名前で押す
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const popOpen = (c) => c.page.evaluate(() => document.querySelector('#p-pop').open);
const leaves = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--leaf`)].map((n) => `${n.querySelector('.mp-leaf__text').textContent}|${n.classList.contains('is-offer') ? 'offer' : n.querySelector('.mp-leaf--kept') ? 'kept' : 'self'}`), box);
const yosas = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--genre .mp-genre__text`)].map((n) => n.textContent), box);
const pickYosa = (c, label) => c.page.locator('#p-genres .ym-genre', { hasText: label }).first().click();
const pickItem = (c, label) => c.page.locator('#p-items .ym-item', { hasText: label }).first().click();
const closePop = async (c) => { await c.page.click('#p-pop-close'); await c.page.waitForFunction(() => !document.querySelector('#p-pop').open); };
const itemsIn = (room, name, yid) => arr(room?.maps?.[name]?.items?.[yid]);
const itemOf = (room, name, yid, t) => itemsIn(room, name, yid).find((x) => x.t === t);
async function waitRoom(code, test, timeout = 5000) {
  const until = Date.now() + timeout;
  let room = null;
  while (Date.now() < until) { room = await roomOf(code); if (room && test(room)) return room; await sleep(100); }
  return room;
}

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const mio = await L.newClient('mio', { viewport: { width: 375, height: 812 } });

  // はじめの画面
  await L.open(host);
  check('top: entry visible', await L.visible(host, '#screen-top .app-entry'));
  check('top: title', (await host.page.title()) === 'よさマップ | あそびのたな');
  await L.shot(host, '01-top');

  // 作成・参加
  const code = await L.createRoom(host, 'ホスト');
  const r0 = await roomOf(code);
  check('create: room waiting', r0?.status === 'waiting');
  check('create: defaults', r0.settings.hostPlays === true && r0.settings.mode === 'own', r0.settings);
  check('stats: room-create', await L.waitStats(host, 'room-create', 1));
  await L.joinRoom(yu, 'ゆう', code);
  await L.joinRoom(mio, 'みお', code);
  await L.waitText(host, '#lobbyPlayers', 'みお');
  check('link: ?room removed after join', !(await yu.page.evaluate(() => location.search.includes('room'))));
  check('lobby: guest sees summary only', (await L.visible(yu, '#lobbyInfo')) && !(await L.visible(yu, '#lobbyHost')));
  check('lobby: guest rule (own)', (await L.text(yu, '#lobbyRule')).includes('それぞれ自分の'));

  // 端末なしの参加者を足す（印はホストの画面にだけ）
  await host.page.fill('#proxyName', 'じろう');
  await host.page.click('#btnAddProxy');
  await L.waitText(yu, '#lobbyPlayers', 'じろう');
  check('proxy: tag on host only', (await L.text(host, '#lobbyPlayers')).includes('端末なし') && !(await L.text(yu, '#lobbyPlayers')).includes('端末なし'));
  await L.shot(host, '02-lobby-host');
  check('lobby 375: no overflow', (await L.overflow(mio)) <= 0);

  // ── それぞれ自分のマップ ──
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-pick');
  const r1 = await roomOf(code);
  check('own start: status pick, round 1', r1.status === 'pick' && r1.round === 1, [r1.status, r1.round]);
  check('stats: start / players-4 / mode-own', (await L.waitStats(host, 'start', 1)) && (await L.waitStats(host, 'players-4', 1)) && (await L.waitStats(host, 'mode-own', 1)));
  check('own: no map title', !(await L.visible(yu, '#p-maptitle')));
  check('own: finish disabled before picking', await yu.page.evaluate(() => document.querySelector('#p-done').disabled));

  // ゆう: よさを足す → そのまま場面を選ぶ
  await node(yu, 'よさを足す').click();
  check('pop: opens with yosa list', (await popOpen(yu)) && (await L.text(yu, '#p-panel-title')) === 'どんなよさがありそう？');
  check('pop: 14 yosa', (await yu.page.locator('#p-genres .ym-genre').count()) === 14);
  await pickYosa(yu, 'やさしい');
  await L.waitText(yu, '#p-panel-title', '「やさしい」が出るのは、どんなとき？');
  check('pop: no by-switch for a guest', !(await L.visible(yu, '#p-by')));
  await pickItem(yu, 'だれかが困っているとき');
  await pickItem(yu, '人の話を聞くとき');
  await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 2);
  check('own: items are mine', itemsIn(await roomOf(code), 'ゆう', 'kind').every((x) => x.self === true && !x.from));
  // 自分で書く
  await yu.page.locator('#p-items .ym-item--add').click();
  await yu.page.fill('#p-free-input', 'ねこをなでるとき');
  await yu.page.press('#p-free-input', 'Enter');
  await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 3);
  await closePop(yu);
  check('map: leaves', JSON.stringify(await leaves(yu)) === JSON.stringify(['だれかが困っているとき|self', '人の話を聞くとき|self', 'ねこをなでるとき|self']), await leaves(yu));
  await L.shot(yu, '03-own-map');
  // × で消す
  await node(yu, '人の話を聞くときを消す').click();
  await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 2);
  check('map: × removes a leaf', !(await leaves(yu)).some((x) => x.startsWith('人の話')));
  // よさを足して消す（場面があるときは確かめる）
  await node(yu, 'よさを足す').click();
  await pickYosa(yu, 'おもしろい');
  await L.waitText(yu, '#p-panel-title', 'おもしろい');
  await pickItem(yu, 'チャットで話すとき');
  await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'funny').length === 1);
  await yu.page.click('#p-del');
  check('del: confirm shown', await L.visible(yu, '#p-del-confirm'));
  await yu.page.click('#p-del-yes');
  await waitRoom(code, (r) => !arr(r.maps['ゆう'].yosa).includes('funny'));
  check('del: yosa removed, pop closed', !(await popOpen(yu)) && JSON.stringify(await yosas(yu)) === JSON.stringify(['やさしい']), await yosas(yu));
  // 完成 → 選びなおす → 完成
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');
  check('done: room', (await roomOf(code)).maps['ゆう'].done === true);
  await yu.page.click('#p-redo');
  await L.waitVisible(yu, '#p-box');
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');
  // 読み込み直しても完成のまま
  await yu.page.reload();
  await L.gate(yu);
  await L.waitVisible(yu, '#p-sent');
  check('reload: guest returns to the done map', JSON.stringify(await yosas(yu, '#p-sent-map')) === JSON.stringify(['やさしい']));

  // みお（375px）: 作って、みんなに出さない
  await node(mio, 'よさを足す').click();
  await pickYosa(mio, '好奇心がある');
  await L.waitText(mio, '#p-panel-title', '好奇心がある');
  await pickItem(mio, 'しくみが気になるとき');
  await closePop(mio);
  check('375: tree layout, no overflow', (await mio.page.evaluate(() => document.querySelector('#p-map svg').classList.contains('mp--tree'))) && (await L.overflow(mio)) <= 0);
  check('375: leaf text >= 12px', await mio.page.evaluate(() => [...document.querySelectorAll('#p-map .mp-leaf__text')].every((n) => parseFloat(getComputedStyle(n).fontSize) >= 12)));
  await L.shot(mio, '04-own-map-375');
  await mio.page.click('#p-done');
  await L.waitVisible(mio, '#p-sent');
  await mio.page.uncheck('#p-share');
  await waitRoom(code, (r) => r.maps['みお'].share === false);
  check('share: off in room', (await roomOf(code)).maps['みお'].share === false);

  // ホスト: 自分の分と、端末なしの参加者の分
  check('host: switch shown (self + proxy)', await L.visible(host, '#p-switch'));
  await node(host, 'よさを足す').click();
  await pickYosa(host, 'ていねい');
  await L.waitText(host, '#p-panel-title', 'ていねい');
  await pickItem(host, 'ものを作るとき');
  await closePop(host);
  await host.page.click('#p-done');
  await L.waitVisible(host, '#p-sent');
  check('host: show button is secondary while others are making', (await host.page.evaluate(() => document.querySelector('#btn-show').className)) === 'btn btn-secondary');
  await host.page.locator('#p-switch button', { hasText: 'じろう' }).click();
  await L.waitVisible(host, '#p-box');
  await node(host, 'よさを足す').click();
  await pickYosa(host, 'ねばり強い');
  await L.waitText(host, '#p-panel-title', 'ねばり強い');
  await pickItem(host, '集めているものがあるとき');
  await closePop(host);
  await host.page.click('#p-done');
  await waitRoom(code, (r) => r.maps['じろう']?.done === true);
  check('proxy: host made the map', itemsIn(await roomOf(code), 'じろう', 'retry').length === 1);
  await host.page.waitForFunction(() => document.querySelector('#btn-show').className.includes('btn-primary'));
  check('host: all done → primary', (await L.text(host, '#p-progress')).includes('4 / 4'));

  // 見せあう（出さないと決めたみおはとばす）
  await host.page.click('#btn-show');
  await L.waitVisible(mio, '#screen-show');
  const r2 = await roomOf(code);
  check('show: order skips the one who opted out', JSON.stringify(arr(r2.show.order)) === JSON.stringify(['ホスト', 'ゆう', 'じろう']), r2.show.order);
  check('stats: finish', await L.waitStats(host, 'finish', 1));
  check('show: ask present', !!(await L.text(yu, '#s-ask-text')));
  check('show: guest has no host box', !(await L.visible(yu, '#s-host')) && !(await L.visible(yu, '#btn-ask')));
  const ask1 = await L.text(host, '#s-ask-text');
  await host.page.click('#btn-next');
  await L.waitText(yu, '#s-people .ym-person[aria-selected="true"]', 'ゆう');
  check('show: map of the shown person', (await yu.page.evaluate(() => document.querySelector('#s-map svg').getAttribute('aria-label'))) === 'ゆうのよさマップ');
  check('show: ask changed with the person', (await L.text(host, '#s-ask-text')) !== ask1);
  check('show: read-only map', (await yu.page.locator('#s-map .is-tap').count()) === 0);
  await L.shot(host, '05-show-host');
  check('show 375: no overflow', (await L.overflow(mio)) <= 0);
  // 待合室へ（マップは消える）
  await host.page.click('#btn-end');
  await L.waitVisible(yu, '#screen-lobby');
  const r3 = await roomOf(code);
  check('end: lobby, maps cleared', r3.status === 'waiting' && !r3.maps && !r3.show);
  check('stats: again', await L.waitStats(host, 'again', 1));

  // ── みんなで1人のマップ ──
  await L.seg(host, 'mode-opts', 'みんなで1人のマップを作る');
  await L.waitText(yu, '#lobbyRule', 'みんなで');
  // はじめは、ホストでない最初の人（ゆうは読み込み直したので、参加した順はみおのあと）
  check('one: focus defaults to the first guest', (await host.page.evaluate(() => document.querySelector('#focus-opts button[aria-checked="true"]')?.textContent)) === 'みお');
  await L.seg(host, 'focus-opts', 'ゆう');
  await L.waitText(yu, '#lobbyRule', 'みんなでゆうさんのよさマップ');
  check('one: focus chosen', (await roomOf(code)).settings.focus === 'ゆう');
  check('one: focus options include the proxy', (await host.page.locator('#focus-opts button').allTextContents()).includes('じろう'));
  check('one: host-plays field hidden', !(await L.visible(host, '#hostPlaysField')));
  await host.page.click('#btnStart');
  await L.waitVisible(mio, '#screen-pick');
  const r4 = await roomOf(code);
  check('one start: focus in room', r4.status === 'pick' && r4.focus === 'ゆう' && r4.round === 2, [r4.status, r4.focus, r4.round]);
  check('stats: mode-one', await L.waitStats(host, 'mode-one', 1));
  check('one: title on every screen', (await L.text(mio, '#p-maptitle')) === 'ゆうさんのよさマップ' && (await L.text(yu, '#p-maptitle')) === 'ゆうさんのよさマップ');
  check('one: finish button only for the person and the host', (await L.visible(yu, '#p-finish')) && (await L.visible(host, '#p-finish')) && !(await L.visible(mio, '#p-finish')));

  // みお（ほかの人）: よさを足して、見えた場面に印を付ける
  await node(mio, 'よさを足す').click();
  check('other: add title names the person', (await L.text(mio, '#p-panel-title')) === 'ゆうさんに、どんなよさがありそう？');
  await pickYosa(mio, 'やさしい');
  await L.waitText(mio, '#p-panel-title', 'ゆうさんの「やさしい」が見えたのは、どんなとき？');
  check('other: no free writing, no delete', (await mio.page.locator('#p-items .ym-item--add').count()) === 0 && !(await L.visible(mio, '#p-del')));
  await pickItem(mio, 'だれかが困っているとき');
  await pickItem(mio, '年下の子といるとき');
  const r5 = await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 2);
  check('other: marks stored as from', itemsIn(r5, 'ゆう', 'kind').every((x) => x.self === false && JSON.stringify(arr(x.from)) === JSON.stringify(['みお'])), itemsIn(r5, 'ゆう', 'kind'));
  await closePop(mio);
  check('other: own marks can be withdrawn on the map', (await node(mio, 'だれかが困っているとき（自分が付けた印を外す）').count()) === 1);

  // ホスト（本人が入っているので「わたしから見えた」がはじめの値）: 同じ場面にも印を付ける
  await host.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf').length === 2);
  await node(host, 'やさしいの場面を選ぶ').click();
  check('host: by-switch defaults to other while the person is here', (await host.page.evaluate(() => document.querySelector('#p-by-seg button[aria-checked="true"]')?.textContent)) === 'わたしから見えた');
  await pickItem(host, 'だれかが困っているとき');
  await pickItem(host, '人の話を聞くとき');
  const r6 = await waitRoom(code, (r) => itemsIn(r, 'ゆう', 'kind').length === 3);
  check('host: two people on the same leaf', JSON.stringify(arr(itemOf(r6, 'ゆう', 'kind', 'だれかが困っているとき').from)) === JSON.stringify(['みお', 'ホスト']), itemOf(r6, 'ゆう', 'kind', 'だれかが困っているとき'));
  await closePop(host);

  // ゆう（本人）: 点線の札を押して、もらう・置いておく
  await yu.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf.is-offer').length === 3);
  check('person: legend', (await L.text(yu, '#p-legend')).includes('点線の札を押すと'));
  await L.shot(yu, '06-one-offers');
  await node(yu, 'だれかが困っているとき（見えた場面。押すと選べる）').click();
  await L.waitVisible(yu, '#p-offer');
  check('offer: who it is from', (await L.text(yu, '#p-offer-from')) === 'みおさん・ホストさんから見えた「やさしい」', await L.text(yu, '#p-offer-from'));
  check('offer: no drop button for the person', !(await L.visible(yu, '#p-offer-drop')));
  await yu.page.click('#p-offer-take');
  const r7 = await waitRoom(code, (r) => itemOf(r, 'ゆう', 'kind', 'だれかが困っているとき')?.self === true);
  check('offer: accepted keeps from', r7 && arr(itemOf(r7, 'ゆう', 'kind', 'だれかが困っているとき').from).length === 2);
  await node(yu, '年下の子といるとき（見えた場面。押すと選べる）').click();
  await L.waitVisible(yu, '#p-offer');
  await yu.page.click('#p-offer-keep');
  check('offer: keep leaves it as it is', (await itemOf(await roomOf(code), 'ゆう', 'kind', '年下の子といるとき')).self === false && !(await popOpen(yu)));
  // 本人が自分でも選ぶ
  await node(yu, 'やさしいの場面を選ぶ').click();
  check('person: offered item marked in the list', (await yu.page.locator('#p-items .ym-item.is-offer').count()) === 2);
  await pickItem(yu, 'ゲームでゆずるとき');
  await waitRoom(code, (r) => itemOf(r, 'ゆう', 'kind', 'ゲームでゆずるとき')?.self === true);
  await closePop(yu);
  check('person: leaves', JSON.stringify((await leaves(yu)).sort()) === JSON.stringify(['だれかが困っているとき|kept', '年下の子といるとき|offer', '人の話を聞くとき|offer', 'ゲームでゆずるとき|self'].sort()), await leaves(yu));

  // みお: 自分の印を外す（札が消える）。本人の札は消せない
  await mio.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf').length === 4);
  check('other: cannot remove the person\'s own leaf', (await mio.page.locator('#p-map g.mp-node--leaf.is-tap', { hasText: 'ゲームでゆずるとき' }).count()) === 0);
  await node(mio, '年下の子といるとき（自分が付けた印を外す）').click();
  await waitRoom(code, (r) => !itemOf(r, 'ゆう', 'kind', '年下の子といるとき'));
  check('other: withdrawing the only mark removes the leaf', !(await itemOf(await roomOf(code), 'ゆう', 'kind', '年下の子といるとき')));
  check('one 375: no overflow', (await L.overflow(mio)) <= 0);

  // 本人が完成にする → みんなでながめる
  await yu.page.click('#p-done');
  await L.waitVisible(mio, '#screen-show');
  const r8 = await roomOf(code);
  check('one finish: show the person', r8.status === 'show' && JSON.stringify(arr(r8.show.order)) === JSON.stringify(['ゆう']));
  check('one show: legend, no nav', (await L.visible(mio, '#s-legend')) && !(await L.visible(host, '#s-nav')));
  check('one show: next-person buttons', JSON.stringify(await host.page.locator('#s-next-names button').allTextContents()) === JSON.stringify(['ホスト', 'みお', 'じろう']), await host.page.locator('#s-next-names button').allTextContents());
  await L.shot(host, '07-one-show');
  // コピー
  await host.page.click('#btn-copy-result');
  await L.waitText(host, '#btn-copy-result', 'コピーしたよ');
  const copied = await host.page.evaluate(() => navigator.clipboard.readText());
  check('copy: text', copied.startsWith('よさマップ（ゆう）') && copied.includes('・だれかが困っているとき（みおさん・ホストさんから）') && copied.includes('・ゲームでゆずるとき'), copied);

  // つぎの人: 端末なしの参加者（ホストが本人の代わりに押す）
  await host.page.locator('#s-next-names button', { hasText: 'じろう' }).click();
  await L.waitText(mio, '#p-maptitle', 'じろうさんのよさマップ');
  const r9 = await roomOf(code);
  check('next: focus changed, previous map kept', r9.focus === 'じろう' && r9.status === 'pick' && arr(r9.maps['ゆう'].yosa).length === 1);
  await node(host, 'よさを足す').click();
  await pickYosa(host, '集中力がある');
  await L.waitText(host, '#p-panel-title', '「集中力がある」が出るのは、どんなとき？');
  check('solo: by-switch defaults to self', (await host.page.evaluate(() => document.querySelector('#p-by-seg button[aria-checked="true"]')?.textContent)) === 'じろうさんが選んだ');
  await pickItem(host, 'ゲームをしているとき');
  await waitRoom(code, (r) => itemOf(r, 'じろう', 'focus', 'ゲームをしているとき')?.self === true);
  await L.seg(host, 'p-by-seg', 'わたしから見えた');
  await L.waitText(host, '#p-panel-title', 'じろうさんの「集中力がある」が見えたのは');
  await pickItem(host, '絵や工作をしているとき');
  const r10 = await waitRoom(code, (r) => itemsIn(r, 'じろう', 'focus').length === 2);
  check('solo: host offer stored', itemOf(r10, 'じろう', 'focus', '絵や工作をしているとき')?.self === false);
  await closePop(host);
  // 足し方を切りかえたあとも、マップの上では本人の代わりに押せる
  await node(host, '絵や工作をしているとき（見えた場面。押すと選べる）').click();
  await L.waitVisible(host, '#p-offer');
  check('solo: host can drop the leaf', await L.visible(host, '#p-offer-drop'));
  await host.page.click('#p-offer-take');
  await waitRoom(code, (r) => itemOf(r, 'じろう', 'focus', '絵や工作をしているとき')?.self === true);
  // みおも印を付けられる
  await mio.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf').length === 2);
  await node(mio, '集中力があるの場面を選ぶ').click();
  await pickItem(mio, 'ゲームをしているとき');
  await waitRoom(code, (r) => arr(itemOf(r, 'じろう', 'focus', 'ゲームをしているとき')?.from).includes('みお'));
  await closePop(mio);
  await host.page.click('#p-done');
  await L.waitVisible(yu, '#screen-show');
  check('solo finish: show', (await roomOf(code)).show.order[0] === 'じろう');
  check('next: previous person marked as continued', (await host.page.locator('#s-next-names button').allTextContents()).includes('ゆう（つづき）'));

  // もう一度作る時間 → 同じマップにもどる
  await host.page.click('#btn-back-pick');
  await L.waitVisible(mio, '#screen-pick');
  check('reopen: same map', (await L.text(mio, '#p-maptitle')) === 'じろうさんのよさマップ' && (await leaves(mio)).length === 2);

  // ホストの読み込み直し
  await host.page.reload();
  await L.gate(host);
  await L.waitVisible(host, '#screen-pick');
  check('reload: host returns to the map', (await L.text(host, '#p-maptitle')) === 'じろうさんのよさマップ' && (await roomOf(code)).hostConnected === true);

  // 退出・ルームを閉じる
  await yu.page.click('#btnLeave');
  await L.waitVisible(yu, '#screen-top');
  await waitRoom(code, (r) => !r.players['ゆう']);
  check('leave: guest removed, map kept', !(await roomOf(code)).players['ゆう'] && !!(await roomOf(code)).maps['ゆう']);
  await host.page.click('#btnLeave');
  await L.waitVisible(mio, '#screen-top');
  check('close: room removed', (await roomOf(code)) === null);

  await L.finishAll(server);
})().catch((error) => { console.error(error); process.exit(1); });
