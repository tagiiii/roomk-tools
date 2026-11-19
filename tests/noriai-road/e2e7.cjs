// のりあいロード E2E その7（2026-11-19）: ステージ14「細い橋」をルームの2人（ホスト・参加者）で。
// 橋に1人なら沈まない・2人で沈む（両方の画面で）・へると戻る・順番にわたれる・沈みきると区間のはじめに戻る
const L = require('./lib.cjs');
const { check, sleep, until, st } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const host = await L.newClient('host');
    const guest = await L.newClient('guest');
    await L.open(host);
    await L.open(guest);

    const code = await L.createRoom(host, 'ホスト');
    await L.joinRoom(guest, 'ゲスト', code);
    await L.waitScreen(guest, 'waiting');
    await host.page.waitForFunction(() => document.querySelectorAll('#lobbyPeople li').length === 2);
    check('ステージは14こから選べる', (await host.page.$$('#lobbySet .nr-seg__btn')).length === 14);
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(14)');
    await L.roomWhen(code, (r) => r.set.stage === 13);
    await guest.page.waitForFunction(() => document.querySelector('#lobbySetNote').textContent.includes('14. 細い橋'));
    check('参加者にも「14. 細い橋」と出る', true);
    await host.page.click('#btnStartGame');
    await L.waitScreen(host, 'game');
    await L.waitScreen(guest, 'game');
    const room = await L.roomWhen(code, (r) => r.status === 'play' && r.game && r.live && r.live[r.game.id] && r.live[r.game.id].w);
    check('ステージ14を2人で', room.game.stage === 13 && room.game.n === 2, room.game);
    // 説明を閉じる（開いていれば）
    for (const c of [host, guest]) await c.page.evaluate(() => { const b = document.getElementById('btnHint'); const t = document.getElementById('hintText'); if (t && !t.closest('[hidden]') && t.getClientRects().length && b) b.click(); });

    const br = await st(host, (s) => ({ x: s.world.plats[0].x, cap: s.world.plats[0].cap, y: s.world.plats[0].y }));
    check('はじめの橋は「1人まで」', br.cap === 1 && Math.abs(br.y - 10) < 0.01, br);
    check('参加者の画面でも「1人まで」', (await st(guest, (s) => s.world.plats[0].cap)) === 1);

    // 自分のキャラを置く（自分の位置は自分の画面が決める）
    const put = (c, seat, x) => st(c, (s, E, a) => { const p = s.world.players[a.seat - 1]; p.x = a.x; p.y = 10 - E.PH; p.vx = 0; p.vy = 0; p.ground = null; return 1; }, { seat, x });
    // 位置を見ながら、着くまでキーを押す（時間を決め打ちにすると、ページの動きの速さで届かないことがある）
    const walkTo = async (c, seat, x, jump) => {
      await c.page.bringToFront();
      const key = (await st(c, (s, E, a) => s.world.players[a - 1].x, seat)) < x ? 'ArrowRight' : 'ArrowLeft';
      await c.page.keyboard.down(key);
      if (jump) { await c.page.keyboard.down('ArrowUp'); await sleep(250); await c.page.keyboard.up('ArrowUp'); }
      const t0 = Date.now();
      while (Date.now() - t0 < 6000) {
        const px = await st(c, (s, E, a) => s.world.players[a - 1].x, seat);
        if (key === 'ArrowRight' ? px >= x : px <= x) break;
        await sleep(15);
      }
      await c.page.keyboard.up(key);
    };
    const plat = (c) => st(c, (s) => ({ y: s.world.plats[0].y, riders: s.world.plats[0].riders }));
    const me = (c, seat) => st(c, (s, E, a) => { const p = s.world.players[a - 1]; return { x: p.x, y: p.y, ground: p.ground }; }, seat);

    await put(host, 1, br.x - 2.5);
    await put(guest, 2, br.x - 1.0);
    await sleep(600);
    // 参加者が橋の上へ
    await walkTo(guest, 2, br.x + 1.2);
    await sleep(1200);
    let pg = await me(guest, 2);
    check('参加者が橋に乗った', pg.ground === 'p0' && pg.x > br.x + 0.3, pg);
    let ph = await plat(host);
    check('1人なら沈まない（ホストの画面）', ph.riders === 1 && Math.abs(ph.y - 10) < 0.02, ph);
    await L.shot(guest, '71-one-on-bridge');

    // ホストも乗る → 2人で沈む
    await walkTo(host, 1, br.x + 0.3);
    await sleep(900);
    ph = await plat(host);
    const pgv = await plat(guest);
    pg = await me(guest, 2);
    check('2人で沈む（ホストの画面）', ph.riders === 2 && ph.y > 10.3, ph);
    check('参加者の画面でも橋が沈んでいる', pgv.y > 10.2, pgv);
    check('参加者のキャラも橋といっしょに下がる', pg.ground === 'p0' && pg.y > 10 - 0.9 + 0.2, pg);
    await L.shot(guest, '72-sinking-guest');
    await L.shot(host, '72-sinking-host');

    // ホストが左の床へもどる（橋が少し沈んでいるので跳ぶ）→ 浮き上がる
    await walkTo(host, 1, br.x - 1.5, true);
    await until(async () => (await plat(host)).riders === 1, 5000, 100);
    await until(async () => Math.abs((await plat(host)).y - 10) < 0.02, 6000, 100);
    ph = await plat(host);
    check('へると浮き上がる（ホストの画面）', ph.riders === 1 && Math.abs(ph.y - 10) < 0.02, ph);
    await sleep(500);
    pg = await me(guest, 2);
    const pgv2 = await plat(guest);
    check('参加者の画面でも戻り、参加者は橋の上のまま', Math.abs(pgv2.y - 10) < 0.05 && pg.ground === 'p0', [pgv2, pg]);

    // 順番にわたる: 参加者 → ホスト
    await walkTo(guest, 2, br.x + 7, true);
    await sleep(600);
    pg = await me(guest, 2);
    check('参加者が向こうの床へ', pg.x > br.x + 6.1 && pg.ground === 't', pg);
    await walkTo(host, 1, br.x + 6.5, true);
    await sleep(600);
    const phh = await me(host, 1);
    check('ホストも向こうの床へ', phh.x > br.x + 6.1 && phh.ground === 't', phh);
    ph = await plat(host);
    check('順番にわたれば、橋は沈まない', Math.abs(ph.y - 10) < 0.02, ph);

    // 沈みきると、区間のはじめに戻る
    await put(host, 1, br.x + 2);
    await put(guest, 2, br.x + 3.5);
    await sleep(7000);
    const a = await me(host, 1), b = await me(guest, 2);
    check('沈みきると、2人とも区間のはじめに戻る', a.x < br.x && b.x < br.x, [a, b]);
    await until(async () => Math.abs((await plat(host)).y - 10) < 0.02, 8000, 100);
    check('橋は戻る', Math.abs((await plat(host)).y - 10) < 0.02);
    await sleep(500);
    check('参加者の画面でも橋は戻る', Math.abs((await plat(guest)).y - 10) < 0.05);
  } catch (e) {
    console.log(e && e.stack || e);
    check('例外なし', false, String(e));
  } finally {
    L.finish();
    await L.browser.close();
    server.close();
  }
})();
