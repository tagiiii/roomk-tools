// 好きなものマップ E2E その4: 接続が閉じられないまま、通信だけ止まる形。
// Playwright の routeWebSocket でデータベースとの WebSocket を中継し、
//   - 止める: ページ ⇄ サーバーのやりとりを両方向とも捨てる（どちらの接続も開いたまま）
//   - サーバーが先に気づく: サーバー側の接続だけ閉じる（ページは、まだつながっていると思っている）
//   - ブラウザがあきらめる: ページ側の接続を閉じる（ページがつなぎなおす）
// を作る。あわせて、作成・参加の「送信したあとに切れた」ときのやり直しも確かめる。
//
// 調べて分かったこと: ページがつなぎなおすと、サーバーは同じ端末の古い接続をその場で閉じる（つなぎなおしのときに
// 前の接続の番号を渡す決まりになっている）。なので「つなぎなおしたあとで、古い接続の切断にサーバーが遅れて気づく」
// という順番は起きない。起きるのは「サーバーが先に気づく → あとでページがつなぎなおす」か
// 「ページが先にあきらめてつなぎなおす（サーバーは古い接続をその場で閉じる）」のどちらか。
const L = require('./lib.cjs');
const { check, sleep, roomOf, rest } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const leaves = (c) => c.page.evaluate(() => [...document.querySelectorAll('#p-map .mp-node--leaf .mp-leaf__text')].map((n) => n.textContent));
async function waitRoom(code, test, timeout = 15000) {
  const start = Date.now();
  let room = null;
  while (Date.now() - start < timeout) { room = await roomOf(code); if (test(room)) return { room, ok: true, ms: Date.now() - start }; await sleep(150); }
  return { room, ok: false, ms: Date.now() - start };
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

// データベースとの WebSocket を中継して、止めたり、片側だけ閉じたりできるようにする。
// Playwright の connectToServer は、ページ側が閉じるとサーバー側もすぐ閉じてしまう（古い接続を残せない）。
// そこで、サーバー側の接続は Node の WebSocket で自分で持つ。
async function control(c) {
  const ctl = { socks: [], cutAfterTx: false, cuts: 0 };
  await c.page.routeWebSocket(/127\.0\.0\.1:9922/, (ws) => {
    const up = new WebSocket(ws.url());
    const sock = { ws, up, stalled: false, pageClosed: false, upClosed: false, queue: [] };
    ctl.socks.push(sock);
    up.addEventListener('open', () => { sock.queue.forEach((m) => up.send(m)); sock.queue = null; });
    up.addEventListener('message', (e) => { if (!sock.stalled && !sock.pageClosed) ws.send(e.data); });
    // サーバー側が閉じたとき: 止めている接続は、ページ側をそのままにする（ページはまだ気づかない）
    up.addEventListener('close', () => { sock.upClosed = true; if (!sock.stalled && !sock.pageClosed) { sock.pageClosed = true; ws.close(); } });
    up.addEventListener('error', () => {});
    ws.onMessage((m) => {
      if (sock.stalled || sock.upClosed) return;
      if (sock.queue) sock.queue.push(m); else up.send(m);
      // transaction の送信（"a":"p" と "h"）をサーバーへ通したら、その応答は捨てて、ページ側を閉じる
      if (ctl.cutAfterTx && typeof m === 'string' && m.includes('"a":"p"') && m.includes('"h"')) {
        ctl.cutAfterTx = false;
        ctl.cuts += 1;
        sock.stalled = true;
        setTimeout(() => { sock.pageClosed = true; ws.close(); }, 250);
      }
    });
    // ページ側が閉じたとき: 止めていない接続だけ、サーバー側も閉じる（止めた接続は、サーバー側を残す）
    ws.onClose(() => { sock.pageClosed = true; if (!sock.stalled && !sock.upClosed) up.close(); });
  });
  const live = () => ctl.socks.filter((s) => !s.pageClosed);
  // いまの接続を止める（両方向のやりとりを捨てる。接続は開いたまま）
  ctl.stall = () => live().forEach((s) => { s.stalled = true; });
  // ブラウザがあきらめる: 止めた接続のページ側を閉じる（ページがつなぎなおす）
  ctl.giveUp = () => ctl.socks.filter((s) => s.stalled && !s.pageClosed).forEach((s) => { s.pageClosed = true; s.ws.close(); });
  // サーバーが先に気づく: 止めた接続のサーバー側だけ閉じる（ページ側は開いたまま）
  ctl.serverNotices = () => ctl.socks.filter((s) => s.stalled && !s.upClosed).forEach((s) => s.up.close());
  // サーバー側がまだ開いている、止めた接続の数
  ctl.openOnServer = () => ctl.socks.filter((s) => s.stalled && !s.upClosed).length;
  return ctl;
}
const NET_ERROR = /WebSocket|net::ERR|Failed to load resource/;

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const hc = await control(host);
  const yc = await control(yu);
  const before = Object.keys((await rest('GET', L.ROOMS)) || {});

  // ── 1. ルームの作成: 送信したあとに切れる → やり直して、作れていたルームをそのまま使う ──
  await L.open(host);
  await host.page.click('#btnGoCreate');
  await host.page.fill('#hostName', 'ホスト');
  hc.cutAfterTx = true;
  await host.page.click('#btnCreateRoom');
  await L.waitVisible(host, '#screen-lobby', 20000);
  const code = (await L.text(host, '#roomCodeLabel')).trim();
  const made = Object.keys((await rest('GET', L.ROOMS)) || {}).filter((k) => !before.includes(k));
  check('create retry: the cut happened', hc.cuts === 1, hc.cuts);
  check('create retry: exactly one room, and it is the one on screen', made.length === 1 && made[0] === code, [made, code]);
  const c1 = await waitRoom(code, (r) => r?.hostConnected === true);
  check('create retry: host is connected', c1.ok && c1.room.host === 'ホスト' && c1.room.status === 'waiting');
  check('create retry: no error shown', !(await L.visible(host, '#createError')));

  // ── 2. 参加: 送信したあとに切れる → やり直して、入れていた在室をそのまま使う ──
  await L.open(yu, '?room=' + code);
  await yu.page.fill('#guestName', 'ゆう');
  yc.cutAfterTx = true;
  await yu.page.click('#btnJoinRoom');
  await L.waitVisible(yu, '#screen-lobby', 20000);
  check('join retry: the cut happened', yc.cuts === 1, yc.cuts);
  const j1 = await waitRoom(code, (r) => !!r?.players?.['ゆう']);
  check('join retry: joined once under the same name', j1.ok && Object.keys(j1.room.players).length === 2, Object.keys(j1.room?.players || {}));
  check('join retry: no error shown', !(await L.visible(yu, '#joinError')));
  await L.waitText(host, '#lobbyPlayers', 'ゆう');

  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-pick');
  await addGenre(yu, true, '動物', '犬');
  await addGenre(host, true, '食べもの', 'カレー');
  await waitRoom(code, (r) => arr(r?.maps?.['ゆう']?.genres).length === 1 && arr(r?.maps?.['ホスト']?.genres).length === 1);

  // ── 3. 参加する人の通信が止まる（接続は開いたまま）。サーバーが先に気づく ──
  yc.stall();
  await addItem(yu, '動物', '猫');
  check('guest stalled: can keep choosing', (await leaves(yu)).includes('猫'));
  await sleep(2500);
  const s1 = await roomOf(code);
  check('guest stalled: nothing reaches the room, presence still there', !arr(s1.maps['ゆう'].items.animal).includes('猫') && !!s1.players['ゆう']);
  check('guest stalled: host sees nothing odd', (await L.visible(host, '#p-box')) && !(await L.visible(host, '#hostOffOverlay')));
  yc.serverNotices();
  const s2 = await waitRoom(code, (r) => r && !r.players['ゆう'], 10000);
  check('server notices first (guest): presence removed, map kept', s2.ok && arr(s2.room.maps['ゆう'].genres).length === 1);
  await L.waitText(host, '#p-progress', '/ 1', 10000);
  check('server notices first (guest): host counts one maker', true);
  // ページはまだ気づいていない。そのまま選べて、エラーも出ない
  await addItem(yu, '動物', 'うさぎ');
  check('server notices first (guest): page still works', (await leaves(yu)).includes('うさぎ') && !((await L.text(yu, '#roomk-toast')) || '').includes('送れなかった'));
  // ブラウザがあきらめてつなぎなおす → 在室がもどり、止まっているあいだに選んだものが届く
  yc.giveUp();
  const s3 = await waitRoom(code, (r) => !!r?.players?.['ゆう'], 20000);
  check('guest reconnects: presence restored', s3.ok);
  const s4 = await waitRoom(code, (r) => { const a = arr(r?.maps?.['ゆう']?.items?.animal); return a.includes('猫') && a.includes('うさぎ'); }, 20000);
  check('guest reconnects: choices made while stalled arrive', s4.ok, arr(s4.room?.maps?.['ゆう']?.items?.animal));
  check('guest reconnects: no "could not send" message', !((await L.text(yu, '#roomk-toast')) || '').includes('送れなかった'));
  await L.waitText(host, '#p-progress', '/ 2', 10000);
  check('guest reconnects: host counts two makers again', true);

  // ── 3b. 参加する人の通信が止まる。ページが先にあきらめる（サーバーは古い接続をその場で閉じる） ──
  yc.stall();
  await addItem(yu, '動物', 'ハムスター');
  await sleep(1500);
  check('guest stalled again: old connection open on the server', yc.openOnServer() >= 1, yc.openOnServer());
  yc.giveUp();
  const s5 = await waitRoom(code, (r) => arr(r?.maps?.['ゆう']?.items?.animal).includes('ハムスター') && !!r.players['ゆう'], 20000);
  check('page gives up first (guest): presence there, choice arrives', s5.ok, arr(s5.room?.maps?.['ゆう']?.items?.animal));
  await sleep(1500);
  check('page gives up first (guest): server closed the old connection at once', yc.openOnServer() === 0, yc.openOnServer());
  check('page gives up first (guest): presence stays', !!(await roomOf(code)).players['ゆう']);

  // ── 4. ホストの通信が止まる（接続は開いたまま）。サーバーが先に気づく ──
  hc.stall();
  await addItem(host, '食べもの', 'お寿司');
  await sleep(2500);
  const h1 = await roomOf(code);
  check('host stalled: room still says connected, guest sees no waiting panel', h1.hostConnected === true && !(await L.visible(yu, '#hostOffOverlay')));
  hc.serverNotices();
  const h2 = await waitRoom(code, (r) => r?.hostConnected === false, 10000);
  check('server notices first (host): recorded as disconnected', h2.ok && typeof h2.room.hostDisconnectedAt === 'number');
  await L.waitVisible(yu, '#hostOffOverlay', 10000);
  check('server notices first (host): guest sees the waiting panel', await L.visible(yu, '#hostOffOverlay'));
  check('server notices first (host): host page still works', (await L.visible(host, '#p-box')) && (await leaves(host)).includes('お寿司'));
  // ホストのブラウザがあきらめてつなぎなおす → つながっているにもどり、待つ画面が消える
  hc.giveUp();
  const h3 = await waitRoom(code, (r) => r?.hostConnected === true && !r.hostDisconnectedAt, 20000);
  check('host reconnects: connected again', h3.ok, [h3.room?.hostConnected, h3.room?.hostDisconnectedAt]);
  await L.waitHidden(yu, '#hostOffOverlay', 10000);
  check('host reconnects: guest waiting panel closes', !(await L.visible(yu, '#hostOffOverlay')));
  const h4 = await waitRoom(code, (r) => arr(r?.maps?.['ホスト']?.items?.food).includes('お寿司'), 20000);
  check('host reconnects: choices made while stalled arrive', h4.ok, arr(h4.room?.maps?.['ホスト']?.items?.food));

  // ── 4b. ホストの通信が止まる。ページが先にあきらめる ──
  hc.stall();
  await addItem(host, '食べもの', 'ピザ');
  await sleep(1500);
  hc.giveUp();
  const h5 = await waitRoom(code, (r) => arr(r?.maps?.['ホスト']?.items?.food).includes('ピザ') && r.hostConnected === true, 20000);
  check('page gives up first (host): connected, choice arrives', h5.ok, [h5.room?.hostConnected, arr(h5.room?.maps?.['ホスト']?.items?.food)]);
  await sleep(2500);
  const h6 = await roomOf(code);
  check('page gives up first (host): stays connected, old connection closed', h6.hostConnected === true && !h6.hostDisconnectedAt && hc.openOnServer() === 0, [h6.hostConnected, hc.openOnServer()]);
  check('page gives up first (host): guest never left waiting', !(await L.visible(yu, '#hostOffOverlay')));
  // つづきから進められる
  await yu.page.click('#p-done');
  await host.page.click('#p-done');
  await L.waitText(host, '#p-progress', '2 / 2', 15000);
  await host.page.click('#btn-show');
  await L.waitVisible(yu, '#screen-show', 15000);
  check('after all that: the game goes on', (await roomOf(code)).status === 'show' && arr((await roomOf(code)).show.order).length === 2);

  // ── 5. そのあとの本当の切断は、これまでどおり働く（予約がつなぎなおした接続に付いている） ──
  await yu.page.goto('about:blank');
  const f1 = await waitRoom(code, (r) => r && !r.players['ゆう'], 15000);
  check('real leave after heal: guest presence removed', f1.ok);
  await host.page.goto('about:blank');
  const f2 = await waitRoom(code, (r) => r?.hostConnected === false, 15000);
  check('real leave after heal: host recorded as disconnected', f2.ok && typeof f2.room.hostDisconnectedAt === 'number');
  await sleep(3000);
  check('real leave after heal: nobody flips it back', (await roomOf(code)).hostConnected === false);
  await rest('DELETE', `${L.ROOMS}/${code}`);

  for (const c of L.clients) c.errors = c.errors.filter((e) => !NET_ERROR.test(e));
  await L.finishAll(server);
})().catch(async (error) => {
  console.error(error);
  for (const c of L.clients) {
    const info = await c.page.evaluate(() => ({ screen: document.querySelector('.sm-screen.active')?.id, overlay: !document.querySelector('#hostOffOverlay')?.hidden, join: document.querySelector('#joinError')?.textContent, create: document.querySelector('#createError')?.textContent, toast: document.querySelector('#roomk-toast')?.textContent })).catch(() => null);
    console.error(c.label, JSON.stringify(info), c.errors.slice(0, 3));
  }
  process.exit(1);
});
