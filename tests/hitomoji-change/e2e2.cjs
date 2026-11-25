// ひともじチェンジ E2E その2: 番の人がタブを閉じる（つぎの人へ）・同じ名前で入りなおし・満員・ホストの切断と復帰
const path = require('path');
const T = require('./lib.cjs');
const { check, sleep } = T;
const L = require(path.join(__dirname, '../../apps/hitomoji-change/logic.js'));

(async () => {
  const server = await T.startServer();
  check('rules loaded', await T.loadRules(path.join(T.WORK, 'database.rules.json')));
  await T.launch();
  const host = await T.newClient('host');
  const sora = await T.newClient('sora');
  const midori = await T.newClient('midori');
  const code = await T.createRoom(host, 'メンター');
  await T.joinRoom(sora, 'そら', code);
  await T.joinRoom(midori, 'みどり', code);
  await T.waitText(host, '#waitingCount', '3人');
  await host.page.click('#btnStartGame');
  for (const c of [host, sora, midori]) await T.waitScreen(c, 'play');
  // メンターがパスして、そらの番に
  await host.page.click('#btnPass');
  await T.waitText(sora, '#turnText', 'あなたの番');

  // ── 番の人がタブを閉じる ──
  await sora.context.close();
  const room = await T.roomWhen(code, (r) => !r.players?.['そら'], 30000);
  check('sora removed on close', !room.players?.['そら']);
  check('turn moves to midori', L.turnOf(room) === 'みどり', L.turnOf(room));
  await T.waitText(midori, '#turnText', 'あなたの番');
  await T.waitText(host, '#turnText', 'みどりの番');

  // ── 同じ名前で入りなおす（遊んでいる途中でも入れる） ──
  const sora2 = await T.newClient('sora2');
  await T.open(sora2, '?room=' + code);
  await T.waitScreen(sora2, 'join');
  await sora2.page.fill('#guestName', 'そら');
  await sora2.page.click('#btnJoinRoom');
  await T.waitScreen(sora2, 'play');
  const r2 = await T.roomOf(code);
  check('sora rejoined last in order', L.participants(r2).slice(-1)[0].name === 'そら');
  check('turn still midori', L.turnOf(r2) === 'みどり');

  // ── 満員（12人まで。REST で10人足して、13人目を断る） ──
  const fill = {};
  for (let i = 0; i < 9; i++) fill['p' + i] = { isHost: false, uid: 'x' + i, joinedAt: Date.now() + i };
  await T.rest('PATCH', T.ROOMS + '/' + code + '/players', fill);
  const r3 = await T.roomWhen(code, (r) => L.participants(r).length === 12);
  check('12 participants', L.participants(r3).length === 12, L.participants(r3).length);
  const extra = await T.newClient('extra');
  await T.open(extra, '?room=' + code);
  await T.waitScreen(extra, 'join');
  await extra.page.fill('#guestName', 'はる');
  await extra.page.click('#btnJoinRoom');
  await T.waitText(extra, '#joinError', 'いっぱい');
  check('13th rejected', true);
  const clean = {};
  for (let i = 0; i < 9; i++) clean['p' + i] = null;
  await T.rest('PATCH', T.ROOMS + '/' + code + '/players', clean);

  // ── ホストの切断と復帰 ──
  host.offlineOk = true;
  await host.context.setOffline(true);
  await T.waitVisible(midori, '#hostOffOverlay', 100000);
  check('guest overlay on host off', await T.visible(midori, '#hostOffOverlay'));
  const off = await T.roomOf(code);
  check('hostConnected false', off.hostConnected === false && !!off.hostDisconnectedAt);
  await host.context.setOffline(false);
  await T.waitHidden(midori, '#hostOffOverlay', 60000);
  const back = await T.roomWhen(code, (r) => r.hostConnected === true, 30000);
  check('host back', back.hostConnected === true && back.hostDisconnectedAt == null);
  check('host still on play', (await T.screen(host)) === 'play');

  // ── 片づけ ──
  await host.page.click('#btnLeave');
  check('room removed', (await T.roomWhen(code, (r) => r === null)) === null);
  await T.waitScreen(midori, 'top');
  await T.finishAll(server);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
