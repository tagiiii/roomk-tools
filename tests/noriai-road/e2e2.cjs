// のりあいロード E2E その2: 大人数（NR_N 人。はじめは10人）。参加・満員・はじめる・10色・書く間かく・全員が歩く間の通信量・リフトの人数
// NR_N=4 などで流すと、同じ測り方で少ない人数の通信量もくらべられる
const L = require('./lib.cjs');
const { check, sleep, st } = L;
const N = Number(process.env.NR_N || 10);

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const cs = [];
    for (let i = 0; i < N; i++) cs.push(await L.newClient(i ? 'g' + i : 'host', { viewport: { width: 1000, height: 760 } }));
    await Promise.all(cs.map((c) => L.open(c)));
    const [host] = cs;
    const code = await L.createRoom(host, 'ホスト');
    for (let i = 1; i < N; i++) {
      await L.joinRoom(cs[i], 'ひと' + i, code);
      await L.waitScreen(cs[i], 'waiting');
    }
    await host.page.waitForFunction((n) => document.querySelectorAll('#lobbyPeople li').length === n, N);
    check(N + '人が待合室に入れる', true);
    await L.shot(host, 'n' + N + '-01-waiting');
    if (N === 10) {
      const extra = await L.newClient('g10');
      await L.open(extra);
      await L.joinRoom(extra, 'ひと10', code);
      await extra.page.waitForFunction(() => /いっぱい/.test(document.body.textContent));
      check('11人目は「いっぱい」', true);
      await extra.context.close();
      L.clients.splice(L.clients.indexOf(extra), 1);
    }

    // ── はじめる（ステージ2: 重い箱と動く床） ──
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(2)');
    await L.roomWhen(code, (r) => r.set.stage === 1);
    await host.page.click('#btnStartGame');
    await Promise.all(cs.map((c) => L.waitScreen(c, 'game', 15000)));
    const room = await L.roomWhen(code, (r) => r.status === 'play' && r.game && r.live?.[r.game.id]?.p && Object.values(r.live[r.game.id].p).filter(Boolean).length === N, 15000);
    const gid = room.game.id;
    check('ステージの決まり（人数・番号）', room.game.n === N && room.game.seats.length === N, room.game);
    check('位置は1つの文字列で書く', Object.values(room.live[gid].p).filter(Boolean).every((v) => typeof v === 'string'), room.live[gid].p);
    check('自分の番号が出る（' + N + '番まで）', (await L.text(cs[N - 1], '#youLine')) === 'あなたは' + N + '番');
    const need = await st(host, (s) => [s.world.boxes[0].need, s.world.plats[0].need]);
    check('「みんな」の数字は5まで', need[0] === Math.min(N, 5) && need[1] === Math.min(N, 5), need);
    const colors = await st(host, (s) => s.world.players.map((p) => p.seat));
    check('全員のキャラがいる', colors.length === N);
    await sleep(800);
    await L.shot(host, 'n' + N + '-02-game');

    // ── 全員が歩く5秒の通信量 ──
    await sleep(500);
    for (const c of cs) { c.wsSent = 0; c.wsRecv = 0; }
    // 歩きつづけると画面のはしで止まるので、左右に行ったり来たりする
    const t0 = Date.now();
    let dir = 'ArrowRight';
    await Promise.all(cs.map((c) => c.page.keyboard.down(dir)));
    while (Date.now() - t0 < 5000) {
      await sleep(700);
      await Promise.all(cs.map((c) => c.page.keyboard.up(dir)));
      dir = dir === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight';
      await Promise.all(cs.map((c) => c.page.keyboard.down(dir)));
    }
    await Promise.all(cs.map((c) => c.page.keyboard.up(dir)));
    const secs = (Date.now() - t0) / 1000;
    const usage = cs.map((c) => ({ who: c.label, sent: Math.round((c.wsSent || 0) / secs), recv: Math.round((c.wsRecv || 0) / secs) }));
    const recvAvg = Math.round(usage.reduce((a, u) => a + u.recv, 0) / N);
    const roomTotal = usage.reduce((a, u) => a + u.recv, 0);
    console.log('  通信量（' + N + '人が全員歩いている ' + secs.toFixed(1) + '秒の平均。バイト/秒）', JSON.stringify(usage));
    console.log('  1台の平均の受ける量 ' + recvAvg + ' B/秒・ルーム全体で ' + roomTotal + ' B/秒・10分で ' + (roomTotal * 600 / 1e6).toFixed(1) + ' MB');
    if (N === 10) check('10人でも受ける量は1台 1秒に 9KB 未満', usage.every((u) => u.recv < 9000), usage);

    // ── 同期: いちばん後ろの番号の人の位置が、ホストの画面でも同じ ──
    await sleep(1200);
    const mine = await st(cs[N - 1], (s, E, n) => s.world.players[n - 1].x, N);
    const onHost = await st(host, (s, E, n) => s.world.players[n - 1].x, N);
    check(N + '番の位置がホストの画面でもそろう', Math.abs(mine - onHost) < 0.05, [mine, onHost]);

    // ── リフト: 5人で上がる（10人のとき） ──
    if (N >= 6) {
      const lift = await st(host, (s) => { const p = s.world.plats[0]; return { x: p.x, y: p.y }; });
      // 1〜5番をリフトに乗せる（それぞれ自分の端末で置く）。ほかはリフトの手前
      await Promise.all(cs.map((c, i) => st(c, (s, E, a) => { const me = s.world.players[s.seat - 1]; me.x = a.on ? a.x + 0.2 + a.k * 0.5 : a.x - 2 - a.k * 0.3; me.y = 10 - E.PH - 0.02; me.vy = 0; me.ground = null; return 1; }, { x: lift.x, on: i < 5, k: i < 5 ? i : i - 5 })));
      await L.until(async () => (await st(host, (s) => s.world.plats[0].y)) < lift.y - 1, 10000);
      // 上がっている間、ホストの画面で2〜5番がリフトの上に描かれている（書く間かくをあけても、床からずれない）
      const onLift = await st(host, (s, E) => { const p = s.world.plats[0]; return s.world.players.slice(1, 5).map((q) => +(q.y + E.PH - p.y).toFixed(3)); });
      check('上がっている間も、乗っている人はリフトの上に描く', onLift.every((d) => Math.abs(d) < 0.05), onLift);
      await L.until(async () => (await st(host, (s) => s.world.plats[0].y)) < lift.y - 4, 10000);
      check('リフトは5人で上がる', true);
      const label = await st(host, (s, E) => [s.world.plats[0].riders, E.platNeed(s.world.plats[0], s.world.players)]);
      check('リフトの人数は 5/5', label[0] === 5 && label[1] === 5, label);
      await L.shot(host, 'n' + N + '-03-lift');
    }
  } catch (e) {
    check('例外なし', false, e && e.stack || e);
  } finally {
    L.finish();
    await L.browser.close();
    server.close();
  }
})();
