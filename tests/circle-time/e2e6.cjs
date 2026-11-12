// サークルタイム E2E その6: 押している間に、ほかの人の操作で画面が変わっても「押した」が届く。
// 進行役の通信が切れて戻ったあと、接続中のままでいる。
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('ren', { viewport: { width: 375, height: 812 } });
  const code = await L.createRoom(H, 'みほ', { kind: 'am' });
  await L.joinRoom(A, 'ゆい', code);
  await L.joinRoom(B, 'れん', code);
  let room = await L.roomOf(code);
  const step = room.steps.find((s) => s.type === 'scale');
  const idOf = (name) => Object.keys(room.players).find((id) => room.players[id].name === name);
  const yui = idOf('ゆい'); const ren = idOf('れん');
  await L.goMain(H, code, step.id);
  await A.page.waitForSelector('#player-card [data-act="pick"]');
  const ROOM = `circletime_rooms/${code}`;
  // 押して、離すまでの間に、ほかの人の答えを届ける
  const holdPress = async (c, sel, bump) => {
    await c.page.locator(sel).scrollIntoViewIfNeeded();
    const b = await c.page.locator(sel).boundingBox();
    await c.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await c.page.mouse.down();
    await bump(); await sleep(350);
    await c.page.mouse.up(); await sleep(400);
  };
  let n = 0;
  for (const v of [5, 4, 3, 2, 1]) {
    const sel = `#player-card [data-act="pick"][data-v="${v}"]`;
    await holdPress(A, sel, () => L.rest('PUT', `${ROOM}/answers/${step.id}/${ren}`, v));
    if (await L.pressed(A, sel)) n += 1;
  }
  check('F1 子どもが押している間にほかの人の答えが届いても、5回とも選べる', n === 5, n);
  check('F2 離したあとに、届いていた分が画面に出る（進行役の一覧）', await H.page.evaluate((id) => !!document.querySelector(`#plist button[data-pid="${id}"][aria-pressed="true"]`), ren));
  // 進行役の「代わりに入れる」も同じ
  let m = 0;
  for (const v of [5, 3, 1]) {
    await holdPress(H, `#plist button[data-pid="${yui}"][data-v="${v}"]`, () => L.rest('PUT', `${ROOM}/answers/${step.id}/${ren}`, v === 5 ? 2 : 4));
    for (let i = 0; i < 30; i++) { if ((await L.roomOf(code)).answers?.[step.id]?.[yui] === v) { m += 1; break; } await sleep(100); }
  }
  check('F3 進行役が押している間にほかの人の答えが届いても、3回とも入る', m === 3, m);
  // 進行役の切断と復帰: 戻ったあとも接続中でいる（古い接続の切断の予約が遅れて動いても、在室を入れなおす）
  await H.page.evaluate(() => firebase.database().goOffline());
  await L.waitRoom(code, (r) => r.hostConnected === false, 20000);
  await H.page.evaluate(() => firebase.database().goOnline());
  await L.waitRoom(code, (r) => r.hostConnected === true, 20000);
  await sleep(4000);
  room = await L.roomOf(code);
  check('F4 進行役が戻ったあと、そのまま接続中でいる', room.hostConnected === true, room.hostConnected);
  // あとから「切断」の印だけが付いても（古い接続の予約が遅れて動いた形）、進行役が在室を入れなおす
  await L.rest('PATCH', ROOM, { hostConnected: false, hostDisconnectedAt: Date.now() });
  await L.waitRoom(code, (r) => r.hostConnected === true, 10000).catch(() => {});
  check('F5 つながっているのに「切断」の印が付いたら、進行役が入れなおす', (await L.roomOf(code)).hostConnected === true);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
