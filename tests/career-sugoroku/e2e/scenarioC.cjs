// シナリオC: スマートフォン幅（375x812）の参加者と、端末の「動きを減らす」設定。
// 確認: 横スクロールなし・主な操作が見える・手札の開閉・近くのマス・マップ・動きを減らすで演出が走らない
const L = require('./lib.cjs');

(async () => {
  const browser = await L.launch();
  const out = { checks: [], errors: [] };
  const ok = (msg) => { out.checks.push(msg); console.log('  ok -', msg); };
  try {
    const H = await L.newClient(browser, 'host');
    const M = await L.newClient(browser, 'mobile', { viewport: { width: 375, height: 812 }, mobile: true });
    const R = await L.newClient(browser, 'reduced', { viewport: { width: 390, height: 844 }, mobile: true, reducedMotion: 'reduce' });
    await M.page.screenshot({ path: `${L.SHOTS}/C00-top-mobile.png` });
    const code = await L.createRoom(H, 'メンター', false);
    await L.join(M, 'みなと', code);
    await L.join(R, 'りく', code);
    await L.sleep(600);
    await L.shot(M, 'C01-lobby-mobile');
    await H.page.click('[data-act="start"]');
    await M.page.waitForFunction(() => window.CS_UI.state.game.phase === 'setup');
    await L.sleep(400);
    await L.shot(M, 'C02-setup-ideal-mobile');
    const overflow = async (c) => c.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    L.assert(await overflow(M) <= 0, 'no horizontal scroll on setup (mobile)');
    await M.page.click('#stage [data-act="sel"][data-i="2"]');
    await M.page.click('#stage [data-act="idealOk"]');
    await M.page.waitForSelector('#stage [data-act="dealOk"]');
    await L.sleep(500);
    await L.shot(M, 'C03-setup-deal-mobile');
    await M.page.click('#stage [data-act="dealOk"]');
    await M.page.waitForSelector('#stage [data-act="goalOk"]');
    await L.shot(M, 'C04-setup-goal-mobile');
    await M.page.click('#stage [data-act="sel"][data-i="0"]');
    await M.page.click('#stage [data-act="goalOk"]');
    // R は動きを減らす設定。画面内のチェックは端末設定で固定
    for (let i = 0; i < 10; i++) { if (!(await L.step(R, {}))) break; await L.sleep(150); }
    await H.page.waitForSelector('#stage [data-act="begin"]:not([data-force])');
    await H.page.click('#stage [data-act="begin"]');
    await M.page.waitForFunction(() => window.CS_UI.state.game.phase === 'main');
    await L.sleep(500);
    await L.shot(M, 'C05-main-mobile');
    L.assert(await overflow(M) <= 0, 'no horizontal scroll in main (mobile)');
    // 手札の開閉
    const collapsed = await M.page.evaluate(() => document.getElementById('hand').classList.contains('is-collapsed'));
    L.assert(collapsed, 'hand collapsed by default on mobile');
    await M.page.click('#hand [data-act="toggleHand"]');
    await L.sleep(200);
    await L.shot(M, 'C06-hand-open-mobile');
    await M.page.click('#hand [data-act="toggleHand"]');
    // 近くのマス → マップ
    const near = await M.page.$('#near .cs-nearsq');
    L.assert(!!near, 'near squares visible on mobile');
    await M.page.click('#near [data-act="openMap"]');
    await M.page.waitForSelector('.cs-modal #map-slot svg');
    await L.sleep(200);
    await L.shot(M, 'C07-map-modal-mobile');
    await M.page.click('.cs-modal [data-act="closeModal"]');
    ok('mobile: no horizontal scroll, hand toggles, near squares and map modal');
    // 画面内の設定: 動きを減らす（R は端末設定で固定・無効表示）
    await R.page.click('[data-act="openPrefs"]');
    const prefDisabled = await R.page.$eval('input[data-pref="reduce"]', (el) => el.disabled && el.checked);
    L.assert(prefDisabled, 'reduced-motion device: in-app toggle checked and locked');
    await L.shot(R, 'C08-prefs-reduced');
    await R.page.click('.cs-modal [data-act="closeModal"]');
    // 通しプレイ。R の端末では演出が走らないこと（getAnimations が空）を毎手確認
    let maxAnimsR = 0;
    let screens = new Set();
    const t0 = Date.now();
    while (true) {
      const g = await L.game(H);
      if (g.phase === 'results') break;
      if (Date.now() - t0 > 300000) throw new Error('scenario C timed out');
      const t = g.turn;
      const key = g.phase === 'main' ? (g.career ? 'career' : t ? `${t.stage}${t.sq ? '-' + t.sq.eff : ''}` : 'x') : g.phase;
      if (!screens.has(key) && t && t.pid === (await M.page.evaluate(() => window.CS_UI.state.session.id))) {
        screens.add(key);
        await L.sleep(300);
        await L.shot(M, `C10-${key}-mobile`);
        L.assert(await overflow(M) <= 0, `no horizontal scroll (${key})`);
      }
      if (g.career && !screens.has('career-m')) { screens.add('career-m'); await L.sleep(300); await L.shot(M, 'C11-career-mobile'); }
      if (g.phase === 'final' && !screens.has('final-m')) { screens.add('final-m'); await L.sleep(300); await L.shot(M, 'C12-final-mobile'); }
      const a1 = await L.step(M, {});
      const a2 = await L.step(R, {});
      const a3 = await L.step(H, { host: true });
      const anims = await R.page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length);
      maxAnimsR = Math.max(maxAnimsR, anims);
      if (!a1 && !a2 && !a3) await L.sleep(120);
    }
    await L.sleep(1000);
    await L.shot(M, 'C20-results-mobile');
    L.assert(await overflow(M) <= 0, 'no horizontal scroll on results (mobile)');
    L.assert(maxAnimsR === 0, `no running animations on reduced-motion device (max ${maxAnimsR})`);
    ok(`reduced motion: no running animations across the game; screens ${[...screens].join(',')}`);
    const logs = [H, M, R].flatMap((c) => c.logs).filter((l) => !/Auth Emulator|emulator/i.test(l));
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
