// 新しい画面の撮影: はじめてガイド・ヒント・目標までのみちのり・仕上げのサイコロ・結果
// CS_MOBILE=1 でスマートフォン幅（375x812）。ファイル名の頭は G → GM
const L = require('./lib.cjs');
const MOBILE = process.env.CS_MOBILE === '1';
(async () => {
  const browser = await L.launch();
  const opts = MOBILE ? { viewport: { width: 375, height: 812 }, mobile: true } : {};
  const shotOf = L.shot;
  const overflow = []; // 横スクロールが出た画面（モーダルの中も含める）
  L.shot = async (c, tag) => {
    const w = await c.page.evaluate(() => {
      const m = document.querySelector('.cs-modal');
      return { page: document.documentElement.scrollWidth - window.innerWidth, modal: m ? m.scrollWidth - m.clientWidth : 0 };
    });
    if (w.page > 0 || w.modal > 0) overflow.push(`${tag}(${w.page}/${w.modal})`);
    return shotOf(c, MOBILE ? tag.replace(/^G/, 'GM') : tag);
  };
  try {
    const H = await L.newClient(browser, 'host', opts);
    // 入口からガイド
    await H.page.click('[data-act="openGuide"]');
    await H.page.waitForSelector('.cs-guidestep');
    for (let i = 0; i < 5; i++) {
      await L.sleep(250);
      await L.shot(H, `G0${i + 1}-guide-step${i + 1}`);
      const next = await H.page.$('.cs-modal [data-act="guideNext"]');
      if (next) await next.click();
    }
    await H.page.click('.cs-modal [data-act="closeModal"]');
    const P = await L.newClient(browser, 'p1', opts);
    const code = await L.createRoom(H, 'せんせい', true);
    await L.join(P, 'そら', code);
    await L.sleep(400);
    await H.page.click('[data-act="start"]');
    await P.page.waitForFunction(() => window.CS_UI.state.game.phase === 'setup');
    await L.sleep(300);
    await L.shot(P, 'G10-setup-ideal-guide');
    // 準備（P は手動、H はボット）
    for (let i = 0; i < 12; i++) { await L.step(P, { first: true }); await L.step(H, { host: true, first: true }); await L.sleep(150); const g = await L.game(H); if (g.phase === 'main') break; }
    await H.page.waitForFunction(() => window.CS_UI.state.game.phase === 'main', null, { timeout: 15000 }).catch(async () => { const b = await H.page.$('#stage [data-act="begin"]'); if (b) await b.click(); });
    await P.page.waitForFunction(() => window.CS_UI.state.game.phase === 'main');
    // 本編: 伸ばす・体験・イベント・コラボの画面が出たら撮る（P の手番）
    const seen = new Set();
    const pid = await P.page.evaluate(() => window.CS_UI.state.session.id);
    for (let i = 0; i < 400; i++) {
      const g = await L.game(H);
      if (g.phase !== 'main') break;
      const t = g.turn;
      if (t && t.pid === pid) {
        const key = t.stage === 'act' ? 'act-' + t.sq.eff : t.stage === 'challenge' ? 'challenge' : t.stage;
        if (['act-grow', 'act-new', 'act-job', 'challenge', 'roll', 'act-life', 'partner'].includes(key) && !seen.has(key)) {
          seen.add(key);
          await L.sleep(350);
          await L.shot(P, `G2${seen.size}-${key}`);
        }
      }
      // 判定の結果で準備チップをもらった場面（出目しだいなので、出ない回もある）
      if (t && t.pid === pid && t.stage === 'result' && t.ch && t.res.some((r) => r.k === 'prep' && r.p === pid) && !seen.has('result-prep')) {
        seen.add('result-prep');
        await L.sleep(350);
        await P.page.evaluate(() => { const el = document.querySelector('#stage .cs-prepline'); if (el) el.scrollIntoView({ block: 'center' }); });
        await L.shot(P, 'G29-result-prep');
      }
      if (g.career && !seen.has('career')) { seen.add('career'); await L.sleep(350); await L.shot(P, 'G30-career'); }
      await L.step(P, {});
      await L.step(H, { host: true });
      await L.sleep(90);
    }
    // 手札（目標までのみちのり・準備チップ）
    await L.sleep(300);
    if (await P.page.$('#hand.is-collapsed')) { await P.page.click('#hand [data-act="toggleHand"]'); await L.sleep(300); }
    await P.page.evaluate(() => document.getElementById('hand').scrollIntoView());
    await L.shot(P, 'G40-hand-goalmap');
    // 終盤: 選ぶ → 仕上げ
    await P.page.waitForFunction(() => window.CS_UI.state.game.phase === 'final', null, { timeout: 60000 });
    await L.sleep(400);
    await P.page.evaluate(() => window.scrollTo(0, 0));
    await L.shot(P, 'G50-final-choose');
    await P.page.click('#stage [data-act="sel"][data-i="0"]');
    await P.page.click('#stage [data-act="fnChoose"]');
    await P.page.waitForSelector('#stage [data-act="fnPresent"]');
    await L.sleep(300);
    await P.page.evaluate(() => document.querySelector('#stage .cs-bonus').scrollIntoView({ block: 'center' }));
    await L.shot(P, 'G51-present');
    // ホストの発表ボタン: 職業を選んでいない人と、仕上げの前の人を分けて伝える
    await L.sleep(300);
    await H.page.evaluate(() => { const b = document.querySelector('#stage [data-act="reveal"]'); if (b) b.scrollIntoView({ block: 'center' }); });
    await L.shot(H, 'G53-host-reveal-note');
    await P.page.click('#stage [data-act="fnPresent"]');
    await L.sleep(700);
    await P.page.evaluate(() => { const c = document.querySelector('#stage .cs-calc'); if (c) c.scrollIntoView({ block: 'center' }); });
    await L.shot(P, 'G52-present-done');
    for (let i = 0; i < 20; i++) { await L.step(H, { host: true }); await L.sleep(200); const g = await L.game(H); if (g.phase === 'results') break; }
    await L.sleep(1500);
    const resultsScrollY = await H.page.evaluate(() => window.scrollY); // 発表のあとは先頭から見せる（0 のはず）
    await L.shot(H, 'G60-results');
    console.log('seen', [...seen].join(','), 'logs', [...H.logs, ...P.logs].filter((l) => !/emulator/i.test(l)), 'overflow', overflow, 'resultsScrollY', resultsScrollY);
  } catch (e) { console.error(e); } finally { await browser.close(); }
})();
