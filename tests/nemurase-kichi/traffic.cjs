// 通信量を測る: ホスト＋参加者1人＋ロボット6つ（8人）で40秒遊び、参加者のブラウザが受け取ったデータの量を数える。
// ロボットは仕事の場所を歩きまわって仕事をし、参加者はずっと歩きつづける（多めに出る側の条件）。
// 本体の目標: 8人で1時間あたり40MB 以下（全員の受信の合計）。
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const guest = await L.newClient('guest');
  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(guest, 'あお', code);
  for (let i = 0; i < 6; i++) await host.page.click('#btnAddBot');
  await L.waitFor(async () => (await L.text(host, '#playerCount')) === '8人');
  await host.page.click('#btnStart');
  await L.waitScreen(guest, 'game');
  await L.dismissRole(host);
  await L.dismissRole(guest);
  // ロボットのねむらせ屋は動かさない（40秒の間にゲームが終わらないように）
  const roles = { 'ホスト': 'crew', 'あお': 'crew' };
  for (let i = 1; i <= 6; i++) roles['*' + i] = i === 1 ? 'sleeper' : 'crew';
  await L.patchGame(code, { roles, cooldown: { '*1': Date.now() + 600000 }, darkReadyAt: Date.now() + 600000 });
  await sleep(3000);

  const SEC = 40;
  const start = { rx: guest.rx, recv: guest.posRecv, bytes: guest.posRecvBytes, hostRx: host.rx };
  guest.posSends = [];
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'];
  const until = Date.now() + SEC * 1000;
  let k = 0;
  while (Date.now() < until) {
    await guest.page.keyboard.down(keys[k % 4]);
    await sleep(1500);
    await guest.page.keyboard.up(keys[k % 4]);
    k += 1;
  }
  const rx = guest.rx - start.rx;
  const recv = guest.posRecv - start.recv;
  const recvBytes = guest.posRecvBytes - start.bytes;
  const hostRx = host.rx - start.hostRx;
  const perMsg = recv ? recvBytes / recv : 0;
  const perHourGuest = (rx / SEC) * 3600 / 1e6;
  const sends = guest.posSends.length / SEC;
  // 8人がみな、この参加者と同じだけ受け取ると考えた合計（ロボットは受け取らないので、実際の8人の部屋の見積もり）
  const roomPerHour = perHourGuest * 8;
  // いちばん多い場合: 8人全員がずっと歩き、1秒に3回ずつ送る（位置の分だけ）
  const worstPerHour = 8 * 7 * 3 * perMsg * 3600 / 1e6;
  console.log(JSON.stringify({
    seconds: SEC,
    guestReceivedBytes: rx,
    hostReceivedBytes: hostRx,
    positionMessages: recv,
    bytesPerPositionMessage: Math.round(perMsg),
    guestSendsPerSecond: Math.round(sends * 10) / 10,
    guestMBperHour: Math.round(perHourGuest * 10) / 10,
    room8MBperHour: Math.round(roomPerHour * 10) / 10,
    room8WorstMBperHour: Math.round(worstPerHour * 10) / 10,
  }, null, 2));
  check('参加者の送信は1秒に3回まで', sends <= 3.2, sends);
  check('8人の部屋の見積もりが1時間40MB 以下', roomPerHour <= 40, roomPerHour);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
