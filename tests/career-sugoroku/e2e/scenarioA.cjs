// シナリオA: ホスト（進行だけ）＋端末の2人＋端末のない1人で、最後まで遊ぶ
//  - 待合室: 参加・端末のない人の追加・始める
//  - ゲーム: 各自の端末で自分の番を押す。端末のない人の番はホストが押す。自分の番でない端末のボタンは止まる
//  - ミニゲーム: 各自が自分の答えを押す（端末のない人の分はホスト）。ほかの人の答えは結果まで見えない（「答えた／まだ」だけ）
//  - 全員の画面が同じ状態にそろう。結果 → 同じメンバーでもう一度 → ホストがルームを閉じる → 参加者はトップへ
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
    L.assert(/^[A-HJ-NP-Z2-9]{6}$/.test(code), 'room code ' + code);
    L.assert((await L.join(ao, 'あお', code)) === '', 'ao joins');
    L.assert((await L.join(rin, 'りん', code)) === '', 'rin joins');
    // 同じ名前・間違ったコードは入れない
    const dup = await L.newClient(browser, 'dup');
    L.assert((await L.join(dup, 'あお', code)).includes('使われています'), 'duplicate name refused');
    await dup.page.fill('#cs-join-name', 'べつ');
    await dup.page.fill('#cs-join-code', 'ZZZZZZ');
    await dup.page.click('#cs-join-room');
    await dup.page.waitForFunction(() => !document.getElementById('cs-join-error').hidden && document.getElementById('cs-join-error').textContent.includes('見つかりません'), null, { timeout: 15000 });
    await dup.ctx.close();
    // 端末のない人を追加
    await host.page.fill('#cs-proxy-name', 'そら');
    await host.page.click('#cs-proxy-add');
    await host.page.waitForFunction(() => document.querySelectorAll('#cs-seats .cs-seat').length === 3);
    await ao.page.waitForFunction(() => document.querySelectorAll('#cs-seats .cs-seat').length === 3);
    L.assert(await ao.page.isHidden('#cs-room-start'), 'guest has no start button');
    L.assert(await ao.page.isVisible('#cs-lobby-wait'), 'guest sees the waiting note');
    await L.shot(host, 'A1-lobby-host');
    await L.shot(ao, 'A1-lobby-guest');
    await host.page.click('#cs-room-start');
    for (const c of all) await c.page.waitForFunction(() => !document.getElementById('cs-play').hidden, null, { timeout: 15000 });
    const u0 = await L.ui(ao);
    L.assert(u0.myPid === 0 && u0.S.players.map((p) => p.name).join(',') === 'あお,りん,そら', 'order and names ' + JSON.stringify(u0.S.players.map((p) => p.name)));
    await L.shot(ao, 'A2-play-ao');
    await L.shot(rin, 'A2-play-rin');

    // 最後まで遊ぶ
    let steps = 0;
    let lockChecks = 0;
    let miniSeen = 0;
    let proxyActs = 0;
    let miniViews = 0;
    const seenKinds = new Set();
    const deadline = Date.now() + 9 * 60 * 1000;
    while (Date.now() < deadline) {
      const screens = await Promise.all(all.map(L.screen));
      if (screens.every((s) => s === 'results')) break;
      let acted = false;
      for (const c of all) {
        const r = await L.step(c, { hostProxyOnly: c === host });
        if (r && r !== 'wait') {
          acted = true;
          steps++;
          if (c === host && r !== 'answer' && r !== 'closeModal') proxyActs++;
        }
      }
      // 自分の番でない端末のボタンが止まっているか（ときどき確かめる）
      if (steps % 7 === 0) {
        for (const c of [ao, rin]) {
          const n = await L.unlockedForOthers(c);
          L.assert(n === 0, `${c.name}: ${n} buttons are enabled on someone else's turn`);
          lockChecks++;
        }
      }
      const u = await L.ui(host);
      if (u.S && u.S.step) { seenKinds.add(u.S.step.kind); if (u.S.step.kind === 'mini') miniSeen++; }
      // ミニゲームのカード（りんの画面）: 自分の行だけボタン。ほかの行は「答えた／まだ」だけ
      const view = await rin.page.evaluate(() => (document.getElementById('cs-card-layer').hidden ? null : Array.from(document.querySelectorAll('#cs-card .cs-mini__row')).map((r) => ({ name: r.querySelector('.cs-mini__name').textContent, btns: r.querySelectorAll('.cs-mini__opt').length, status: (r.querySelector('.cs-mini__status') || {}).textContent || '' }))));
      if (view && view.length) {
        const mine = view.filter((v) => v.btns > 0);
        L.assert(mine.length === 1 && mine[0].name.includes('りん'), 'rin can press only her own row: ' + JSON.stringify(view));
        L.assert(view.filter((v) => v.btns === 0).every((v) => v.status === 'まだ' || v.status === '答えた'), 'others show only answered or not: ' + JSON.stringify(view));
        if (!miniViews++) await L.shot(rin, 'A2-mini-rin');
      }
      if (!acted) await L.sleep(120);
    }
    const screens = await Promise.all(all.map(L.screen));
    L.assert(screens.every((s) => s === 'results'), 'everyone reached the results: ' + screens.join(','));
    // 全員の結果が同じ
    const results = await Promise.all(all.map((c) => c.page.evaluate(() => document.getElementById('cs-rank').innerText)));
    L.assert(results.every((t) => t === results[0]), 'same results on all devices');
    L.assert(proxyActs > 0, 'host pressed for the player without a device');
    L.assert(await ao.page.isHidden('#cs-again') && await ao.page.isVisible('#cs-results-wait'), 'guest waits on the results');
    L.assert((await ao.page.textContent('#cs-to-top')).trim() === '退出する', 'guest leaves from the results');
    L.assert((await host.page.textContent('#cs-to-top')).trim() === 'ルームを閉じる', 'host closes from the results');
    await L.shot(host, 'A3-results-host');
    await L.shot(rin, 'A3-results-rin');
    console.log(`played: ${steps} actions, lock checks ${lockChecks}, mini steps seen ${miniSeen} (rin's card checked ${miniViews}), host proxy actions ${proxyActs}, kinds ${[...seenKinds].join(',')}`);

    // 同じメンバーでもう一度
    await host.page.click('#cs-again');
    for (const c of all) await c.page.waitForFunction(() => !document.getElementById('cs-play').hidden && window.CS_UI.state.room.meta.gameNo === 2, null, { timeout: 15000 });
    const u2 = await L.ui(rin);
    L.assert(u2.S.turnNo === 0 || u2.S.turnNo === 1, 'a new game started');
    // ホストがルームを閉じる → 参加者はトップへ
    await host.page.click('#cs-open-menu');
    await host.page.click('.cs-modal .cs-quiet--danger');
    await host.page.click('.cs-modal .cs-btn--danger');
    for (const c of all) await c.page.waitForFunction(() => !document.getElementById('cs-top').hidden, null, { timeout: 15000 });
    L.assert((await L.ui(ao)).sess === null, 'guest session cleared');
    const reloaded = await ao.page.evaluate(() => sessionStorage.getItem('careersugoroku_session'));
    L.assert(reloaded === null, 'no session left');

    const errs = all.flatMap((c) => L.realErrors(c.logs));
    const blocked = all.flatMap((c) => c.blocked);
    L.assert(!errs.length, 'console errors: ' + errs.join(' | '));
    L.assert(!blocked.length, 'production requests: ' + blocked.join(' | '));
    console.log(`scenario A: OK (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (e) {
    console.error('scenario A: FAILED', e.message);
    for (const c of all) { console.error(c.logs.join('\n')); await L.shot(c, 'A-fail-' + c.name).catch(() => {}); }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
