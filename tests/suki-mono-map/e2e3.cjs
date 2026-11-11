// 好きなものマップ E2E その3: 電波が切れる形の切断（タブは開いたまま、通信だけ落ちる）。
// その2は「タブを別のページへ移す」形で切断を作り、2分の期限を時刻の書きかえで早送りした。
// ここでは通信だけを落とし（context.setOffline）、2分の期限も実時間で待つ。1回およそ6〜8分かかる。
const L = require('./lib.cjs');
const { check, sleep, roomOf } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const leaves = (c) => c.page.evaluate(() => [...document.querySelectorAll('#p-map .mp-node--leaf .mp-leaf__text')].map((n) => n.textContent));
async function waitRoom(code, test, timeout) {
  const start = Date.now();
  let room = null;
  while (Date.now() - start < timeout) { room = await roomOf(code); if (test(room)) return { room, ms: Date.now() - start, ok: true }; await sleep(500); }
  return { room, ms: Date.now() - start, ok: false };
}
async function addGenre(c, first, label, item) {
  await node(c, first ? '好きなジャンルを足す' : 'ジャンルを足す').click();
  await c.page.locator('#p-genres .sm-genre', { hasText: label }).first().click();
  if (item) await c.page.locator('#p-items .sm-item', { hasText: item }).first().click();
  await c.page.click('#p-pop-close');
}
async function addItem(c, genreLabel, item) {
  await node(c, `${genreLabel}に足す`).click();
  await c.page.locator('#p-items .sm-item', { hasText: item }).first().click();
  await c.page.click('#p-pop-close');
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
  await addGenre(yu, true, '動物', '犬');
  await addGenre(host, true, '食べもの', 'カレー');
  await waitRoom(code, (r) => arr(r?.maps?.['ゆう']?.genres).length === 1 && arr(r?.maps?.['ホスト']?.genres).length === 1, 10000);

  // ── 1. 参加する人の通信が切れる ──
  await yu.context.setOffline(true);
  // 切れているあいだも、画面は止まらずに選べる
  await addItem(yu, '動物', '猫');
  check('guest offline: can keep choosing', (await leaves(yu)).includes('猫'), await leaves(yu));
  const g1 = await waitRoom(code, (r) => r && !r.players['ゆう'], 180000);
  console.log('  guest offline → presence removed after ' + sec(g1.ms));
  check('guest offline: server removes the presence', g1.ok && arr(g1.room.maps['ゆう'].genres).length === 1, g1.ms);
  check('guest offline: offline choice is not in the room yet', !arr(g1.room.maps['ゆう'].items.animal).includes('猫'));
  check('guest offline: host screen keeps going', await L.visible(host, '#p-box'));

  // 通信がもどる → 同じ名前で在室がもどり、切れているあいだに選んだものも届く
  await yu.context.setOffline(false);
  const g2 = await waitRoom(code, (r) => !!r?.players?.['ゆう'], 60000);
  console.log('  guest online → presence back after ' + sec(g2.ms));
  check('guest back: presence restored', g2.ok, g2.ms);
  const g3 = await waitRoom(code, (r) => arr(r?.maps?.['ゆう']?.items?.animal).includes('猫'), 20000);
  check('guest back: choices made while offline arrive', g3.ok, arr(g3.room?.maps?.['ゆう']?.items?.animal));
  check('guest back: still on the map, no overlay', (await L.visible(yu, '#p-box')) && !(await L.visible(yu, '#hostOffOverlay')));
  await addItem(yu, '動物', 'うさぎ');
  const g4 = await waitRoom(code, (r) => arr(r?.maps?.['ゆう']?.items?.animal).includes('うさぎ'), 10000);
  check('guest back: new choices are sent as usual', g4.ok);

  // ── 2. ホストの通信が切れる → 期限内にもどる ──
  await host.context.setOffline(true);
  await addItem(host, '食べもの', 'お寿司');
  check('host offline: can keep choosing', (await leaves(host)).includes('お寿司'));
  const h1 = await waitRoom(code, (r) => r?.hostConnected === false, 180000);
  console.log('  host offline → recorded after ' + sec(h1.ms));
  check('host offline: recorded with a time', h1.ok && typeof h1.room.hostDisconnectedAt === 'number', h1.ms);
  await L.waitVisible(yu, '#hostOffOverlay', 15000);
  check('host offline: guest sees the waiting panel', await L.visible(yu, '#hostOffOverlay'));
  check('host offline: room and maps stay', h1.room.status === 'pick' && arr(h1.room.maps['ゆう'].genres).length === 1);

  await host.context.setOffline(false);
  const h2 = await waitRoom(code, (r) => r?.hostConnected === true && !r.hostDisconnectedAt, 60000);
  console.log('  host online → connected again after ' + sec(h2.ms));
  check('host back: connected again', h2.ok, h2.ms);
  await L.waitHidden(yu, '#hostOffOverlay', 15000);
  check('host back: waiting panel closes', !(await L.visible(yu, '#hostOffOverlay')));
  const h3 = await waitRoom(code, (r) => arr(r?.maps?.['ホスト']?.items?.food).includes('お寿司'), 20000);
  check('host back: choices made while offline arrive', h3.ok, arr(h3.room?.maps?.['ホスト']?.items?.food));
  await yu.page.click('#p-done');
  await L.waitText(host, '#p-progress', '1 / 2', 15000);
  await host.page.click('#p-done');
  await L.waitText(host, '#p-progress', '2 / 2', 15000);
  await host.page.click('#btn-show');
  await L.waitVisible(yu, '#screen-show', 15000);
  check('host back: host can run the game', (await roomOf(code)).status === 'show');
  await host.page.click('#btn-back-pick');
  await L.waitVisible(yu, '#p-box', 15000);

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
  check('TTL: guest session cleared', (await yu.page.evaluate(() => sessionStorage.getItem('sukimonomap_session'))) === null);

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
    const info = await c.page.evaluate(() => ({ screen: document.querySelector('.sm-screen.active')?.id, overlay: !document.querySelector('#hostOffOverlay')?.hidden, toast: document.querySelector('#roomk-toast')?.textContent })).catch(() => null);
    console.error(c.label, JSON.stringify(info), c.errors.slice(0, 3));
  }
  process.exit(1);
});
