// シナリオD: スマートフォン幅（375×812）のルームの画面と、「1台の画面であそぶ」を最後まで
//  - トップ・参加・待合室・ゲーム・カード・結果で、ページの横はみ出しがない
//  - 1台の画面では通信しない（Firebase の接続を作らない）
'use strict';
const L = require('./lib.cjs');

const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

(async () => {
  const browser = await L.launch();
  const t0 = Date.now();
  const all = [];
  try {
    const host = await L.newClient(browser, 'host');
    const phone = await L.newClient(browser, 'phone', { viewport: { width: 375, height: 812 }, mobile: true });
    all.push(host, phone);
    L.assert((await overflow(phone)) <= 0, 'top: no horizontal overflow');
    await L.shot(phone, 'D1-top-375');
    const code = await L.createRoom(host, 'しんこう', true);
    await phone.page.click('#cs-go-join');
    L.assert((await overflow(phone)) <= 0, 'join: no horizontal overflow');
    await phone.page.fill('#cs-join-name', 'ひかり');
    await phone.page.fill('#cs-join-code', code.toLowerCase()); // 小文字でも入る
    await phone.page.click('#cs-join-room');
    await phone.page.waitForFunction(() => !document.getElementById('cs-lobby').hidden, null, { timeout: 15000 });
    L.assert((await overflow(phone)) <= 0, 'lobby: no horizontal overflow');
    await L.shot(phone, 'D2-lobby-375');
    await host.page.click('#cs-room-start');
    await phone.page.waitForFunction(() => !document.getElementById('cs-play').hidden, null, { timeout: 15000 });
    L.assert((await overflow(phone)) <= 0, 'play: no horizontal overflow');
    await L.shot(phone, 'D3-play-375');
    // カードが出る場面まで進めて、はみ出しを確かめる
    let checkedCard = 0;
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      const s = await Promise.all([L.screen(host), L.screen(phone)]);
      if (s.every((x) => x === 'results')) break;
      let acted = false;
      for (const c of all) { const r = await L.step(c); if (r && r !== 'wait') acted = true; }
      if (await phone.page.evaluate(() => !document.getElementById('cs-card-layer').hidden)) {
        const o = await overflow(phone);
        L.assert(o <= 0, 'card: horizontal overflow ' + o);
        if (checkedCard++ === 3) await L.shot(phone, 'D4-card-375');
      }
      if (!acted) await L.sleep(100);
    }
    L.assert(await phone.page.evaluate(() => !document.getElementById('cs-results').hidden), 'phone reached the results');
    L.assert((await overflow(phone)) <= 0, 'results: no horizontal overflow');
    await L.shot(phone, 'D5-results-375');
    console.log(`phone: ${checkedCard} card views checked`);

    // 1台の画面であそぶ（別の端末。通信しない）
    const local = await L.newClient(browser, 'local');
    all.push(local);
    await local.page.click('#cs-go-local');
    await local.page.click('#cs-count button:nth-child(3)');
    await local.page.click('#cs-start');
    await local.page.waitForFunction(() => !document.getElementById('cs-play').hidden);
    const deadline2 = Date.now() + 4 * 60 * 1000;
    while (Date.now() < deadline2 && (await L.screen(local)) !== 'results') {
      const r = await L.step(local);
      if (!r || r === 'wait') await L.sleep(60);
    }
    L.assert((await L.screen(local)) === 'results', 'local game reached the results');
    const u = await L.ui(local);
    L.assert(u.mode === 'local' && u.sess === null, 'local mode, no room session');
    const fbApps = await local.page.evaluate(() => (window.firebase && window.firebase.apps ? window.firebase.apps.length : 0));
    L.assert(fbApps === 0, 'local mode does not start Firebase');
    await local.page.click('#cs-to-top');
    await local.page.waitForFunction(() => !document.getElementById('cs-top').hidden);

    const errs = all.flatMap((c) => L.realErrors(c.logs));
    L.assert(!errs.length, 'console errors: ' + errs.join(' | '));
    L.assert(!all.some((c) => c.blocked.length), 'production requests');
    console.log(`scenario D: OK (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (e) {
    console.error('scenario D: FAILED', e.message);
    for (const c of all) { console.error(c.logs.join('\n')); await L.shot(c, 'D-fail-' + c.name).catch(() => {}); }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
