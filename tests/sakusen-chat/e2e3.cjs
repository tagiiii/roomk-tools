// E2E その3: 作成・参加の transaction を送ったあとに通信が切れる（Error('disconnect')）→ やり直して1つだけできる
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, roomWhen, open, screen, waitScreen, text, visible, msgs, waitMsgs, sendText } = L;

// transaction の送信をサーバーへ通したあと、応答を捨ててページ側の接続を閉じる（1回だけ）
async function armDrop(page, state) {
  await page.routeWebSocket(/127\.0\.0\.1:9482/, (ws) => {
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
  await rest('DELETE', 'sakusenchat_rooms');

  // ── 作成
  const H = await L.newClient('host');
  const hs = { armed: false, fired: 0 };
  await armDrop(H.page, hs);
  await L.mentorTop(H);
  await H.page.fill('#hostName', 'メンター');
  hs.armed = true;
  await H.page.click('#btnCreateRoom');
  await waitScreen(H, 'chat', 20000);
  check('create: the drop happened', hs.fired === 1, hs);
  await H.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 2);
  const key = await H.page.evaluate(() => JSON.parse(sessionStorage.getItem('sakusenchat_session')).key);
  let all = await rest('GET', 'sakusenchat_rooms');
  check('create: exactly one room', Object.keys(all).length === 1 && Object.keys(all)[0] === key, Object.keys(all));
  let room = await roomWhen(key, (r) => r.meta.hostConnected === true, 15000);
  check('create: host is connected (reservation is set)', room.meta.hostConnected === true, room.meta);
  check('create: counted once', (await H.page.evaluate(() => window.__STATS__.filter((x) => x === 'room-create').length)) === 1);

  // ── 参加
  const A = await L.newClient('guest');
  const gs = { armed: false, fired: 0 };
  await armDrop(A.page, gs);
  await open(A, '?room=' + key);
  await waitScreen(A, 'join');
  await A.page.fill('#guestName', 'たろう');
  gs.armed = true;
  await A.page.click('#btnJoinRoom');
  await waitScreen(A, 'chat', 20000);
  check('join: the drop happened', gs.fired === 1, gs);
  room = await roomWhen(key, (r) => Object.keys(r.meta.guests || {}).length === 1, 15000);
  check('join: exactly one seat', Object.values(room.meta.guests).map((g) => g.name).join() === 'たろう', room.meta.guests);
  await sendText(A, 'とどく？');
  await waitMsgs(H, 1);
  check('join: can talk', (await msgs(H)).join() === 'たろう:とどく？');
  // 切断時の予約が生きている: 閉じると席が消える
  await A.page.close();
  room = await roomWhen(key, (r) => !r.meta.guests, 15000);
  check('join: seat is removed on close', !room.meta.guests, room.meta.guests);
  // メンターも閉じると切断中になる
  await H.page.close({ runBeforeUnload: false });
  room = await roomWhen(key, (r) => r.meta.hostConnected === false, 15000);
  check('create: marked disconnected on close', room.meta.hostConnected === false);
  // ── 残りかす: meta だけが消えて会話が残った（削除よりあとに書き込みが届いた形）→ 開いている端末が残りを消す
  const H2 = await L.newClient('host2');
  const made = await L.createRoom(H2, 'メンター');
  const G = await L.newClient('guest2');
  await L.joinOk(G, made.key, 'じろう');
  await sendText(G, 'のこりかす');
  await waitMsgs(H2, 1);
  await H2.page.close({ runBeforeUnload: false });
  await roomWhen(made.key, (r) => r.meta.hostConnected === false);
  await rest('DELETE', 'sakusenchat_rooms/' + made.key + '/meta');
  await waitScreen(G, 'end');
  room = await roomWhen(made.key, (r) => r === null, 8000);
  check('leftover: messages without meta are removed by the open client', room === null, room);
  await sleep(500);
  check('leftover: forgotten after it is cleared', (await G.page.evaluate(() => JSON.parse(localStorage.getItem('sakusenchat_my_rooms') || '[]').length)) === 0);

  await rest('DELETE', 'sakusenchat_rooms');
  for (const c of L.clients) c.errors = c.errors.filter((e) => !/WebSocket|ERR_|disconnect/i.test(e));
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });
