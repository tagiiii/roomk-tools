// シナリオE: ホストが一時的にいなくなる（選ぶ時間30秒）。
// 確認: ホスト不在の間は参加者の画面に待機の表示が出て、手番が時間切れにならない。
//       ホストが戻ると、いなかった時間ぶん締め切りが延び、続きから遊べる。
const L = require('./lib.cjs');

(async () => {
  const browser = await L.launch();
  const out = { checks: [], errors: [] };
  const ok = (msg) => { out.checks.push(msg); console.log('  ok -', msg); };
  try {
    const H = await L.newClient(browser, 'host');
    const P = await L.newClient(browser, 'p1');
    const code = await L.createRoom(H, 'メンター', false);
    await L.join(P, 'そら', code);
    await H.page.click('[data-act="setting"][data-k="timerSec"][data-v="30"]');
    await H.page.waitForFunction(() => window.CS_UI.state.game.settings.timerSec === 30);
    await H.page.click('[data-act="start"]');
    await P.page.waitForFunction(() => window.CS_UI.state.game.phase === 'setup');
    for (let i = 0; i < 10; i++) { if (!(await L.step(P, {}))) break; await L.sleep(150); }
    await H.page.waitForSelector('#stage [data-act="begin"]:not([data-force])');
    await H.page.click('#stage [data-act="begin"]');
    await P.page.waitForFunction(() => { const g = window.CS_UI.state.game; return g.turn && g.turn.stage === 'roll'; });
    const turnId = (await L.game(P)).turn.id;
    // ホストがページを離れる（接続が切れる）
    const hostUrl = H.page.url();
    await H.page.goto('about:blank');
    await P.page.waitForFunction(() => window.CS_UI.state.room.meta.hostConnected === false, null, { timeout: 30000 });
    await L.sleep(500);
    await L.shot(P, 'E01-host-away-overlay');
    const overlay = await P.page.evaluate(() => !document.getElementById('overlay').hidden && document.getElementById('overlay-title').textContent);
    L.assert(overlay && overlay.includes('ホスト'), 'participant sees host-away overlay: ' + overlay);
    ok('host away -> participant overlay shown');
    await L.sleep(40000); // 選ぶ時間（30秒）を過ぎる
    let g = await L.game(P);
    L.assert(g.turn && g.turn.id === turnId && g.turn.stage === 'roll', 'turn not timed out while host away');
    ok('no timeout while host was away (40s)');
    // ホストが戻る（同じタブの sessionStorage で再接続）
    await H.page.goto(hostUrl);
    await H.page.waitForFunction(() => window.CS_UI && window.CS_UI.state.game && window.CS_UI.state.session, null, { timeout: 20000 });
    await P.page.waitForFunction(() => window.CS_UI.state.room.meta.hostConnected === true, null, { timeout: 20000 });
    await P.page.waitForFunction(() => window.CS_UI.state.game.log.some((e) => e.k === 'hostBack'), null, { timeout: 15000 });
    await L.sleep(2000);
    g = await L.game(P);
    L.assert(g.turn && g.turn.id === turnId, 'same turn continues after host returned');
    const rem = await P.page.evaluate(() => window.CS_ENGINE.timerRemaining(window.CS_UI.state.game, window.CS_NET.now()));
    L.assert(rem > 10000, 'remaining time restored after host returned: ' + rem);
    ok(`host returned: deadline extended (remaining ${(rem / 1000).toFixed(0)}s), same turn continues`);
    await L.shot(P, 'E02-after-host-back');
    await P.page.click('#stage [data-act="roll"]');
    await P.page.waitForFunction((id) => { const t = window.CS_UI.state.game.turn; return !t || t.id !== id || t.stage !== 'roll'; }, turnId);
    ok('participant can continue playing');
    const logs = [H, P].flatMap((c) => c.logs).filter((l) => !/Auth Emulator|emulator|ERR_INTERNET_DISCONNECTED|about:blank/i.test(l));
    if (logs.length) console.log(logs.join('\n'));
    L.assert(logs.length === 0, 'no console errors');
    ok('console clean');
  } catch (err) {
    out.errors.push(String(err && err.stack || err));
    console.error(err);
  } finally {
    await browser.close();
    console.log(JSON.stringify({ checks: out.checks.length, errors: out.errors }, null, 1));
    process.exit(out.errors.length ? 1 : 0);
  }
})();
