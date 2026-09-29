// シナリオB: つなぎ直し・退出・始まったあとの参加
//  - 待合室で退出すると席が消える。始まったあとは参加できない
//  - ホストも遊ぶ。参加者が途中で再読み込みしても同じ席にもどる。ホストの再読み込みも同じ
//  - 参加者がゲームの途中で退出すると「つながっていない」になり、その人の番はホストが押せる
'use strict';
const L = require('./lib.cjs');

async function playUntil(clients, host, cond, ms, hostOwnOnly) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    let acted = false;
    for (const c of clients) {
      const r = await L.step(c, c === host ? (hostOwnOnly ? { ownOnly: true } : { hostProxyOnly: true }) : {});
      if (r && r !== 'wait') acted = true;
    }
    if (!acted) await L.sleep(120);
  }
  return cond();
}
const waitPlay = (c) => c.page.waitForFunction(() => !document.getElementById('cs-play').hidden && window.CS_UI.state.S, null, { timeout: 20000 });

(async () => {
  const browser = await L.launch();
  const t0 = Date.now();
  const all = [];
  try {
    const host = await L.newClient(browser, 'host');
    const ao = await L.newClient(browser, 'ao');
    const rin = await L.newClient(browser, 'rin');
    const kai = await L.newClient(browser, 'kai');
    all.push(host, ao, rin, kai);
    const code = await L.createRoom(host, 'せんせい', true);
    for (const [c, n] of [[ao, 'あお'], [rin, 'りん'], [kai, 'かい']]) L.assert((await L.join(c, n, code)) === '', n + ' joins');
    await host.page.waitForFunction(() => document.querySelectorAll('#cs-seats .cs-seat').length === 4);
    // 待合室で退出 → 席が消える
    await kai.page.click('#cs-lobby-leave');
    await kai.page.waitForFunction(() => !document.getElementById('cs-top').hidden);
    await host.page.waitForFunction(() => document.querySelectorAll('#cs-seats .cs-seat').length === 3, null, { timeout: 10000 });
    all.splice(all.indexOf(kai), 1);
    await host.page.click('#cs-room-start');
    for (const c of all) await waitPlay(c);
    // 始まったあとの参加は断る
    L.assert((await L.join(kai, 'かい', code)).includes('始まっています'), 'join after start refused');
    await kai.ctx.close();

    // 数手進める
    await playUntil(all, host, async () => (await L.ui(host)).S.turnNo >= 4, 60000);
    // 参加者の再読み込み → 同じ席にもどる
    const before = await L.ui(ao);
    await ao.page.reload();
    await ao.page.waitForFunction(() => window.CS_UI && !document.getElementById('cs-play').hidden && window.CS_UI.state.S, null, { timeout: 20000 });
    const after = await L.ui(ao);
    L.assert(after.sess.dev === before.sess.dev && after.myPid === before.myPid, 'guest came back to the same seat');
    L.assert(after.room.presence && after.room.presence[after.sess.dev] === true, 'guest presence re-registered');
    // ホストの再読み込み
    await host.page.reload();
    await host.page.waitForFunction(() => window.CS_UI && !document.getElementById('cs-play').hidden && window.CS_UI.state.room && window.CS_UI.state.room.meta.hostConnected === true, null, { timeout: 20000 });
    L.assert((await L.ui(host)).host === true, 'host came back as host');
    await playUntil(all, host, async () => (await L.ui(host)).S.turnNo >= 8, 60000);

    // 参加者が途中で退出 → つながっていない。その人の番はホストが押せる
    await rin.page.click('#cs-open-menu');
    await rin.page.click('.cs-modal button:has-text("退出する")');
    await rin.page.click('.cs-modal .cs-btn--danger');
    await rin.page.waitForFunction(() => !document.getElementById('cs-top').hidden, null, { timeout: 10000 });
    all.splice(all.indexOf(rin), 1);
    await host.page.waitForFunction(() => Array.from(document.querySelectorAll('#cs-players .cs-player')).some((b) => b.textContent.includes('りん') && b.textContent.includes('つながっていない')), null, { timeout: 15000 });
    await L.shot(host, 'B2-rin-left');
    // りんの番まで進めて、ホストが押す
    const rinPid = 2;
    const idleAt = async (c) => { const u = await L.ui(c); return !u.busy && !u.sending && u.S.cur === rinPid && u.S.step.kind === 'roll'; };
    const reached = await playUntil(all, host, async () => (await idleAt(host)) && (await idleAt(ao)), 90000, true);
    L.assert(reached, "reached rin's turn");
    L.assert(await host.page.isVisible('#cs-turn [data-primary]'), 'host sees the roll button on rin\'s turn');
    const turnText = await host.page.textContent('#cs-turn');
    L.assert(turnText.includes('りんさんの代わりに押す'), 'host is told it presses for rin: ' + turnText);
    const turnsBefore = (await L.ui(host)).S.players[rinPid].turns;
    await host.page.click('#cs-turn [data-primary]');
    await host.page.waitForFunction((n) => window.CS_UI.state.S.players[2].turns > n, turnsBefore, { timeout: 10000 });
    L.assert(await ao.page.isHidden('#cs-turn [data-primary]'), 'ao cannot roll for rin');

    // 最後まで（ホストが途中で終える）
    await host.page.click('#cs-open-menu');
    await host.page.click('.cs-modal button:has-text("ここで終えて結果を見る")');
    await host.page.click('.cs-modal .cs-confirm .cs-btn--primary');
    for (const c of all) await c.page.waitForFunction(() => !document.getElementById('cs-results').hidden, null, { timeout: 15000 });
    await L.shot(ao, 'B3-results-ao');
    // 参加者が結果から退出 → トップ。ホストは残る
    await ao.page.click('#cs-to-top');
    await ao.page.waitForFunction(() => !document.getElementById('cs-top').hidden);
    await host.page.click('#cs-to-top');
    await host.page.click('.cs-modal .cs-btn--danger');
    await host.page.waitForFunction(() => !document.getElementById('cs-top').hidden);

    const errs = [host, ao].flatMap((c) => L.realErrors(c.logs));
    L.assert(!errs.length, 'console errors: ' + errs.join(' | '));
    L.assert(![host, ao].some((c) => c.blocked.length), 'production requests');
    console.log(`scenario B: OK (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (e) {
    console.error('scenario B: FAILED', e.message);
    for (const c of all) { console.error(c.logs.join('\n')); await L.shot(c, 'B-fail-' + c.name).catch(() => {}); }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
