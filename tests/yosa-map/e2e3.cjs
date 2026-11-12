// よさマップ E2E その3: 電波が切れる形の切断（タブは開いたまま、通信だけ落ちる）。
// その2は「タブを別のページへ移す」形で切断を作り、2分の期限を時刻の書きかえで早送りした。
// ここでは通信だけを落とし（context.setOffline）、2分の期限も実時間で待つ。1回およそ4〜6分かかる。
//
// 切れているあいだに押したときの動き（2026-11-12 にこのテストで確かめた。マップの書きかえは1操作ごとのルームの transaction）:
//   参加する人: 押しても札は出ない・メッセージも出ない・あとからも届かない（SDK は、切れた時点で「切断したら在室を消す」の予約を
//     手元の写しにも当てる。editMap は在室のない人の書きかえを通さないので、何も起きない）。つながりなおせば、また押せる
//   ホスト: 押したものはすぐ画面に出て、つながりなおしたときにルームへ届く（ホストの在室は切断で消さない）。進行の操作も同じ
const L = require('./lib.cjs');
const { check, sleep, roomOf } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const popOpen = (c) => c.page.evaluate(() => document.querySelector('#p-pop').open);
const leaves = (c) => c.page.evaluate(() => [...document.querySelectorAll('#p-map .mp-node--leaf .mp-leaf__text')].map((n) => n.textContent));
const pickYosa = (c, label) => c.page.locator('#p-genres .ym-genre', { hasText: label }).first().click();
const pickItem = (c, label) => c.page.locator('#p-items .ym-item', { hasText: label }).first().click();
const closePop = async (c) => { await c.page.click('#p-pop-close'); await c.page.waitForFunction(() => !document.querySelector('#p-pop').open); };
const texts = (room, name, yid) => arr(room?.maps?.[name]?.items?.[yid]).map((x) => x.t);
const toastText = (c) => c.page.evaluate(() => document.querySelector('#roomk-toast')?.textContent || '');
async function waitRoom(code, test, timeout) {
  const start = Date.now();
  let room = null;
  while (Date.now() - start < timeout) { room = await roomOf(code); if (test(room)) return { room, ms: Date.now() - start, ok: true }; await sleep(500); }
  return { room, ms: Date.now() - start, ok: false };
}
const sec = (ms) => Math.round(ms / 1000) + 's';
// 通信を落としているあいだは、ブラウザがつながらないことをエラーとして出す。それは数えない
const NET_ERROR = /ERR_INTERNET_DISCONNECTED|ERR_NETWORK|net::ERR|WebSocket|Failed to load resource|network-request-failed|Failed to fetch/;

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(yu, 'ゆう', code);
  await L.waitText(host, '#lobbyPlayers', 'ゆう');
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-pick');
  // ゆうは「やさしい」のポップアップをひらいたまま。ホストも「ていねい」をひらいたまま
  await node(yu, 'よさを足す').click();
  await pickYosa(yu, 'やさしい');
  await L.waitText(yu, '#p-panel-title', 'やさしい');
  await pickItem(yu, 'だれかが困っているとき');
  await node(host, 'よさを足す').click();
  await pickYosa(host, 'ていねい');
  await L.waitText(host, '#p-panel-title', 'ていねい');
  await pickItem(host, 'ものを作るとき');
  await waitRoom(code, (r) => texts(r, 'ゆう', 'kind').length === 1 && texts(r, 'ホスト', 'careful').length === 1, 10000);

  // ── 1. 参加する人の通信が切れる ──
  await yu.context.setOffline(true);
  const g1 = await waitRoom(code, (r) => r && !r.players['ゆう'], 180000);
  console.log('  guest offline → presence removed after ' + sec(g1.ms));
  check('guest offline: server removes the presence, map kept', g1.ok && texts(g1.room, 'ゆう', 'kind').length === 1, g1.ms);
  check('guest offline: host screen keeps going', (await L.visible(host, '#p-box')) && !(await L.visible(host, '#hostOffOverlay')));
  // 切れているあいだに押す → 札は出ない・メッセージも出ない（いまの動き。上の説明を参照）。ルームは変わらず、画面もこわれない
  await pickItem(yu, '人の話を聞くとき');
  await sleep(1500);
  check('guest offline press: nothing is added on the screen', JSON.stringify(await leaves(yu)) === JSON.stringify(['だれかが困っているとき']), await leaves(yu));
  check('guest offline press: no message is shown (current behaviour)', (await toastText(yu)) === '', await toastText(yu));
  check('guest offline press: popup stays, no overlay', (await popOpen(yu)) && !(await L.visible(yu, '#hostOffOverlay')));
  check('guest offline press: room untouched', JSON.stringify(texts(await roomOf(code), 'ゆう', 'kind')) === JSON.stringify(['だれかが困っているとき']));
  await L.shot(yu, '31-guest-offline-press', false);

  // 通信がもどる → 同じ名前で在室がもどる。切れているあいだに押したものは届かない。もう一度押せば入る
  await yu.context.setOffline(false);
  const g2 = await waitRoom(code, (r) => !!r?.players?.['ゆう'], 60000);
  console.log('  guest online → presence back after ' + sec(g2.ms));
  check('guest back: presence restored', g2.ok, g2.ms);
  await sleep(3000);
  check('guest back: the press made while offline did not arrive', JSON.stringify(texts(await roomOf(code), 'ゆう', 'kind')) === JSON.stringify(['だれかが困っているとき']), texts(await roomOf(code), 'ゆう', 'kind'));
  check('guest back: still on the map, popup open, no overlay', (await L.visible(yu, '#p-box')) && (await popOpen(yu)) && !(await L.visible(yu, '#hostOffOverlay')));
  await pickItem(yu, '人の話を聞くとき');
  const g3 = await waitRoom(code, (r) => texts(r, 'ゆう', 'kind').includes('人の話を聞くとき'), 10000);
  check('guest back: pressing again works', g3.ok && (await leaves(yu)).includes('人の話を聞くとき'), await leaves(yu));
  await closePop(yu);

  // ── 2. ホストの通信が切れる → 期限内にもどる ──
  await host.context.setOffline(true);
  // 切れているあいだも、ホストの画面は止まらずに選べる（すぐ画面に出る）
  await pickItem(host, '片づけや整理をするとき');
  await host.page.waitForFunction(() => document.querySelectorAll('#p-map .mp-node--leaf').length === 2, null, { timeout: 5000 }).catch(() => {});
  check('host offline: the press shows on the host screen', (await leaves(host)).includes('片づけや整理をするとき'), await leaves(host));
  const h1 = await waitRoom(code, (r) => r?.hostConnected === false, 180000);
  console.log('  host offline → recorded after ' + sec(h1.ms));
  check('host offline: recorded with a time', h1.ok && typeof h1.room.hostDisconnectedAt === 'number', h1.ms);
  check('host offline: the press is not in the room yet', !texts(h1.room, 'ホスト', 'careful').includes('片づけや整理をするとき'));
  await L.waitVisible(yu, '#hostOffOverlay', 15000);
  check('host offline: guest sees the waiting panel', await L.visible(yu, '#hostOffOverlay'));
  check('host offline: room and maps stay', h1.room.status === 'pick' && texts(h1.room, 'ゆう', 'kind').length === 2);
  check('host offline: host does not see the waiting panel', !(await L.visible(host, '#hostOffOverlay')));

  await host.context.setOffline(false);
  const h2 = await waitRoom(code, (r) => r?.hostConnected === true && !r.hostDisconnectedAt, 60000);
  console.log('  host online → connected again after ' + sec(h2.ms));
  check('host back: connected again', h2.ok, h2.ms);
  await L.waitHidden(yu, '#hostOffOverlay', 15000);
  check('host back: waiting panel closes', !(await L.visible(yu, '#hostOffOverlay')));
  const h3 = await waitRoom(code, (r) => texts(r, 'ホスト', 'careful').includes('片づけや整理をするとき'), 20000);
  check('host back: the press made while offline arrives', h3.ok, texts(h3.room, 'ホスト', 'careful'));
  await closePop(host);
  await yu.page.click('#p-done');
  await L.waitText(host, '#p-progress', '1 / 2', 15000);

  // 進行の操作を切れているあいだに押す → ホストの画面は先に進み、つながりなおすとみんなに届く
  await host.context.setOffline(true);
  await host.page.click('#p-done');
  await L.waitVisible(host, '#p-sent', 5000);
  await host.page.click('#btn-show');
  await L.waitVisible(host, '#screen-show', 5000);
  check('host offline: host actions move the host screen', await L.visible(host, '#screen-show'));
  await sleep(1500);
  check('host offline: not in the room yet', (await roomOf(code)).status === 'pick' && !(await L.visible(yu, '#screen-show')));
  await host.context.setOffline(false);
  const h4 = await waitRoom(code, (r) => r?.status === 'show' && r.hostConnected === true, 60000);
  check('host back: host actions made while offline arrive', h4.ok && h4.room.maps['ホスト'].done === true, [h4.room?.status, h4.room?.hostConnected]);
  await L.waitVisible(yu, '#screen-show', 15000);
  await L.waitHidden(yu, '#hostOffOverlay', 15000);
  check('host back: everyone on the show', (await L.visible(yu, '#screen-show')) && (await L.visible(host, '#s-host')));
  await host.page.click('#btn-back-pick');
  await L.waitVisible(yu, '#screen-pick', 15000);

  // ── 3. ホストの通信が切れたまま、実時間で2分たつ ──
  await host.context.setOffline(true);
  const e1 = await waitRoom(code, (r) => r?.hostConnected === false, 180000);
  console.log('  host offline again → recorded after ' + sec(e1.ms));
  await L.waitVisible(yu, '#hostOffOverlay', 15000);
  const t0 = Date.now();
  // 期限（2分）の前は、まだ待つ画面のまま
  await sleep(60000);
  check('TTL: still waiting after 1 minute', (await L.visible(yu, '#hostOffOverlay')) && (await roomOf(code)) !== null);
  await L.waitVisible(yu, '#screen-top', 120000);
  const waited = Date.now() - t0;
  console.log('  guest returned to top ' + sec(waited) + ' after the waiting panel appeared');
  check('TTL: guest goes back to top around 2 minutes', waited > 90000 && waited < 150000, waited);
  const e2 = await waitRoom(code, (r) => r === null, 10000);
  check('TTL: room removed', e2.ok);
  check('TTL: guest session cleared', (await yu.page.evaluate(() => sessionStorage.getItem('yosamap_session'))) === null);

  // ホストの通信があとからもどる → トップへもどり、ルームを作りなおさない
  await host.context.setOffline(false);
  await L.waitVisible(host, '#screen-top', 60000);
  await sleep(3000);
  check('late host: lands on top', !(await L.visible(host, '#roomBar')));
  check('late host: no ghost room', (await roomOf(code)) === null, await roomOf(code));

  // 通信を落としていたあいだの「つながらない」エラーは数えない
  for (const c of L.clients) c.errors = c.errors.filter((e) => !NET_ERROR.test(e));
  await L.finishAll(server);
})().catch(async (error) => {
  console.error(error);
  for (const c of L.clients) {
    const info = await c.page.evaluate(() => ({ screen: document.querySelector('.ym-screen.active')?.id, overlay: !document.querySelector('#hostOffOverlay')?.hidden, pop: document.querySelector('#p-pop')?.open, toast: document.querySelector('#roomk-toast')?.textContent })).catch(() => null);
    console.error(c.label, JSON.stringify(info), c.errors.slice(0, 3));
  }
  process.exit(1);
});
