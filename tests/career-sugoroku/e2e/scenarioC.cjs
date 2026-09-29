// シナリオC: ホストの通信が切れる → 参加者の画面に「ホストの接続が切れています（あとN分…）」。自分の番は続けられる。
// ホストがつながりなおすと消える。ホスト自身の画面には「通信が切れています」（約1〜2分かかる）
'use strict';
const L = require('./lib.cjs');

(async () => {
  const browser = await L.launch();
  const t0 = Date.now();
  const all = [];
  try {
    const host = await L.newClient(browser, 'host');
    const ao = await L.newClient(browser, 'ao');
    const rin = await L.newClient(browser, 'rin');
    all.push(host, ao, rin);
    const code = await L.createRoom(host, 'しんこう', false);
    for (const [c, n] of [[ao, 'あお'], [rin, 'りん']]) L.assert((await L.join(c, n, code)) === '', n + ' joins');
    await host.page.waitForFunction(() => document.querySelectorAll('#cs-seats .cs-seat').length === 2);
    await host.page.click('#cs-room-start');
    for (const c of all) await c.page.waitForFunction(() => !document.getElementById('cs-play').hidden, null, { timeout: 15000 });

    // ホストの通信を切る
    await host.ctx.setOffline(true);
    await host.page.waitForFunction(() => !document.getElementById('cs-banner').hidden && document.getElementById('cs-banner').textContent.includes('通信が切れています'), null, { timeout: 30000 });
    // 参加者の画面: サーバーが切断を見つけるまで待つ（最大2分）
    await ao.page.waitForFunction(() => !document.getElementById('cs-banner').hidden && /ホストの接続が切れています（あと1[45]分/.test(document.getElementById('cs-banner').textContent), null, { timeout: 150000 });
    await L.shot(ao, 'C1-host-away');
    // そのあいだも、自分の番は押せる（ミニゲームは全員の答えが要ることがあるので、参加者は全員動かす）
    const before = (await L.ui(ao)).S.turnNo;
    for (let i = 0; i < 80 && (await L.ui(ao)).S.turnNo === before; i++) {
      let acted = false;
      for (const c of [ao, rin]) { const r = await L.step(c); if (r && r !== 'wait') acted = true; }
      if (!acted) await L.sleep(150);
    }
    L.assert((await L.ui(ao)).S.turnNo > before, 'players can go on while the host is away');
    // ホストがつながりなおす → 表示が消える
    await host.ctx.setOffline(false);
    await host.page.waitForFunction(() => document.getElementById('cs-banner').hidden && window.CS_UI.state.room.meta.hostConnected === true, null, { timeout: 60000 });
    await ao.page.waitForFunction(() => document.getElementById('cs-banner').hidden, null, { timeout: 30000 });
    // ホストの画面も、参加者が進めた状態にそろう
    await host.page.waitForFunction((n) => window.CS_UI.state.S.turnNo > n, before, { timeout: 15000 });

    const errs = all.flatMap((c) => L.realErrors(c.logs));
    L.assert(!errs.length, 'console errors: ' + errs.join(' | '));
    L.assert(!all.some((c) => c.blocked.length), 'production requests');
    console.log(`scenario C: OK (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (e) {
    console.error('scenario C: FAILED', e.message);
    for (const c of all) { console.error(c.logs.join('\n')); await L.shot(c, 'C-fail-' + c.name).catch(() => {}); }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
