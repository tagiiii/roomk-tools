// E2E その3: 作成・席の取得の transaction を送ったあとに通信が切れる（Error('disconnect')）→ やり直して1つだけできる
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, seatOf, liveOf, emptySeats, roomWhen, open, title, waitTitle, text, stats, pidOf, waitBar, waitWatch } = L;

// transaction の送信をサーバーへ通したあと、応答を捨ててページ側の接続を閉じる（1回だけ）
async function armDrop(page, state) {
  await page.routeWebSocket(/127\.0\.0\.1:9492/, (ws) => {
    const server = ws.connectToServer();
    let drop = false;
    ws.onMessage((msg) => {
      server.send(msg);
      if (state.armed && typeof msg === 'string' && msg.includes('"a":"p"') && msg.includes('"h"')) {
        state.armed = false;
        state.fired += 1;
        drop = true;
        setTimeout(() => ws.close(), 60);
      }
    });
    server.onMessage((msg) => { if (!drop) ws.send(msg); });
  });
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  await rest('DELETE', L.ROOMS);

  // ── 作成
  const H = await L.newClient('host');
  H.offlineOk = true;
  const hs = { armed: false, fired: 0 };
  await armDrop(H.page, hs);
  await open(H);
  hs.armed = true;
  await H.page.click('#btnCreateWatch');
  await waitTitle(H, '見る画面', 30000);
  check('create: the drop happened', hs.fired === 1, hs);
  const code = await text(H, '.yk-watch-bar__code strong');
  let all = await rest('GET', L.ROOMS);
  check('create: exactly one room', Object.keys(all).length === 1 && Object.keys(all)[0] === code, Object.keys(all));
  let room = await roomWhen(code, (r) => r.meta.hostConnected === true, 20000);
  check('create: host is connected (reservation is set)', room.meta.hostConnected === true, room.meta);
  check('create: counted once', (await stats(H, 'room-create')) === 1);

  // ── 席の取得
  const P = await L.newClient('player');
  P.offlineOk = true;
  const ps = { armed: false, fired: 0 };
  await armDrop(P.page, ps);
  await L.openInvite(P, code);
  ps.armed = true;
  await P.page.click('#btnShow');
  await waitBar(P, 'メンターに見せています', 30000);
  check('join: the drop happened', ps.fired === 1, ps);
  room = await roomWhen(code, (r) => seatOf(r) && liveOf(r) && liveOf(r).view, 20000);
  check('join: the seat is mine', seatOf(room) === (await pidOf(P)) && Object.keys(room.meta.seats).length === 1, room.meta);
  check('join: counted once', (await stats(P, 'show')) === 1);
  await waitWatch(H, '単元を選んでいます', 10000);
  await L.pickUnit(P, '身のまわりの物質');
  await waitWatch(H, '語を選んでいます', 10000);
  check('join: the viewer follows', true);

  // 切断時の予約が生きている: 閉じると席と中身が消える
  await P.page.close();
  room = await roomWhen(code, (r) => emptySeats(r), 20000);
  check('join: seat and live are removed on close', emptySeats(room), room);
  await H.page.close({ runBeforeUnload: false });
  room = await roomWhen(code, (r) => r.meta.hostConnected === false, 20000);
  check('create: marked disconnected on close', room.meta.hostConnected === false);
  await rest('DELETE', `${L.ROOMS}/${code}`);

  await L.finishAll(server);
})().catch((error) => { console.error(error); process.exit(2); });
