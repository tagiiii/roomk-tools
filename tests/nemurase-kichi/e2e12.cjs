// その12: スマホでスティックを押さえたまま「ねむらせる」を押す（2026-11-09 フィードバック「キルボタンがたまに機能しなくなる」）
// 2本目の指のタップでは click が出ない（pointerdown・pointerup は届く）ので、タッチは pointerup で動かす。二重には動かない
const L = require('./lib.cjs');
const { E, check, sleep } = L;

const freezeBot = (c, id, x, y) => c.page.evaluate(([i, a, b]) => {
  const bot = window.__NK__.BOTS[i];
  bot.x = a; bot.y = b; bot.route = []; bot.goal = null; bot.busyUntil = Date.now() + 3600000;
}, [id, x, y]);
const center = async (c, sel) => {
  const r = await c.page.$eval(sel, (el) => { const b = el.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  return r;
};
const tp = (id, p) => ({ x: p.x, y: p.y, id, radiusX: 4, radiusY: 4, force: 1 });

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1', { touch: true, viewport: { width: 375, height: 700 } });
  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await host.page.click('#btnAddBot');
  await host.page.click('#btnAddBot');
  check('ロボット2つで4人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '4人'));
  await host.page.click('#btnStart');
  for (const c of [host, g1]) await L.waitScreen(c, 'game');
  for (const c of [host, g1]) await L.dismissRole(c);
  E.useMap(0);
  const far = Date.now() + 3600000;
  await L.patchGame(code, {
    roles: { 'ホスト': 'crew', 'あお': 'sleeper', '*1': 'crew', '*2': 'crew' },
    cooldown: { 'あお': 0, '*1': far, '*2': far },
    darkReadyAt: far, buttonReadyAt: far,
  });
  const spot = E.SPOTS.reduce((a, b) => (E.dist(b, E.TABLE) > E.dist(a, E.TABLE) ? b : a));
  await freezeBot(host, '*1', spot.x, spot.y + 0.6);
  await freezeBot(host, '*2', E.TABLE.x, E.TABLE.y + 5);
  check('スマホのまねでスティックが出る', await L.waitFor(() => L.visible(g1, '#pad')));
  const cdp = await g1.context.newCDPSession(g1.page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });

  // ══ スティックを押さえたまま、別の指で「ねむらせる」 ══
  await L.teleport(host, 31.5, 51.4);
  await L.teleport(g1, 30.8, 51.4);
  check('近くに隊員がいると押せる', await L.waitFor(async () => (await L.visible(g1, '#actSleep')) && !(await g1.page.$eval('#actSleep', (b) => b.disabled))));
  const pad = await center(g1, '#pad');
  const btn = await center(g1, '#actSleep');
  await g1.page.evaluate(() => {
    window.__clicks = 0;
    document.getElementById('actSleep').addEventListener('click', () => { window.__clicks += 1; });
  });
  // 1本目の指でスティックを押さえ、少し動かしてから、2本目の指でボタンを押す（指はいっしょにはなす）
  await send('touchStart', [tp(1, pad)]);
  await send('touchMove', [tp(1, { x: pad.x + 4, y: pad.y })]);
  await send('touchStart', [tp(1, { x: pad.x + 4, y: pad.y }), tp(2, btn)]);
  await sleep(150);
  await send('touchEnd', []);
  check('スティックを押さえたまま押しても、ホストがねむる', await L.waitFor(async () => (await L.roomOf(code)).game.asleep?.['ホスト'] === 'slept'));
  check('（このとき click は出ていない）', (await g1.page.evaluate(() => window.__clicks)) === 0);
  check('ねむらせたあとは待ち時間', await L.waitFor(async () => (await L.text(g1, '#actSleepCd')) !== ''));

  // ══ 1本の指のタップでも1回だけ動く（pointerup と click で二重にならない） ══
  // つぎの相手はロボット（ねむったホストの位置は g に移ったので、もう相手にならない）
  await freezeBot(host, '*2', 30.8, 52.1);
  await L.patchGame(code, { cooldown: { 'あお': 0, '*1': far, '*2': far } });
  check('もとにもどすと、また押せる', await L.waitFor(async () => (await L.visible(g1, '#actSleep')) && !(await g1.page.$eval('#actSleep', (b) => b.disabled))));
  // r への transaction の回数を数える（ねむらせるは1回のタップで1回だけ）
  await g1.page.evaluate(() => {
    window.__tx = 0;
    const proto = window.firebase.database.Reference.prototype;
    const orig = proto.transaction;
    proto.transaction = function (...a) { window.__tx += 1; return orig.apply(this, a); };
  });
  await g1.page.tap('#actSleep');
  check('1本の指のタップでもねむる', await L.waitFor(async () => (await L.roomOf(code)).game.asleep?.['*2'] === 'slept'));
  await sleep(1200);
  const tx = await g1.page.evaluate(() => window.__tx);
  check('1回のタップで transaction は1回だけ（pointerup と click で二重にならない）', tx === 1, tx);
  check('エラーなし', g1.errors.length === 0 && host.errors.length === 0, g1.errors.concat(host.errors));

  await sleep(200);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
