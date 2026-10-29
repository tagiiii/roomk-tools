// その8: はじめてのホストが迷わない待合室（2026-10-30）
// まず決めること（ホスト・マップ）と、たたんだ「くわしい設定」・下に固定した要約と「はじめる」・変えた印と「くわしい設定をはじめの値にもどす」・375px
const L = require('./lib.cjs');
const { E, check, sleep } = L;

const rows = (c, box) => c.page.$$eval('#' + box + ' select, #' + box + ' .nk-setting__value', (n) => n.map((x) => x.id));
const changed = (c) => c.page.$$eval('.nk-setting.is-changed', (n) => n.map((x) => x.querySelector('select, .nk-setting__value').id));
const inView = (c, sel) => c.page.$eval(sel, (b) => { const r = b.getBoundingClientRect(); return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0; });

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host', { moreClosed: true });
  const g1 = await L.newClient('g1', { moreClosed: true, viewport: { width: 375, height: 740 } });

  const code = await L.createRoom(host, 'ホスト', { keepMap: true });
  await L.joinRoom(g1, 'あお', code);

  // ══ まず決めること と くわしい設定 ══
  check('ホストの「まず決めること」はホストとマップの2つ', (await rows(host, 'lobbySettings')).join() === 'set-hostPlays,set-map', await rows(host, 'lobbySettings'));
  check('参加者の「まず決めること」はマップだけ', (await rows(g1, 'lobbySettings')).join() === 'set-map');
  const moreIds = await rows(host, 'lobbyMore');
  check('のこりの12個は「くわしい設定」', moreIds.length === 12 && moreIds.includes('set-tasks') && moreIds.includes('set-shifter'), moreIds);
  for (const c of [host, g1]) {
    const st = await c.page.evaluate(() => ({ open: document.getElementById('moreSettings').open, seen: document.querySelector('#lobbyMore .nk-setting').checkVisibility() }));
    check('くわしい設定は、はじめはたたんである ' + c.label, !st.open && !st.seen, st);
    check('「はじめのままで遊べます」 ' + c.label, (await L.text(c, '#moreSub')) === 'はじめのままで遊べます');
    check('変えた印はない ' + c.label, (await changed(c)).length === 0);
  }
  check('もどすボタンは出ない（変えていない）', !(await L.visible(host, '#btnResetSettings')));

  // ══ 要約と「はじめる」 ══
  check('要約: 2人・パーク・ねむらせ屋1人・ひとりの仕事4つ＋ふたりの仕事', await L.waitFor(async () => (await L.text(host, '#startSummary')) === '2人・パーク・ねむらせ屋1人・ひとりの仕事4つ＋ふたりの仕事'), await L.text(host, '#startSummary'));
  check('参加者にも同じ要約', (await L.text(g1, '#startSummary')) === (await L.text(host, '#startSummary')));
  check('参加者に「はじめる」は出ない', !(await L.visible(g1, '#btnStart')));
  await host.page.evaluate(() => window.scrollTo(0, 0));
  check('一番上にいても「はじめる」が画面の中（下に固定）', await inView(host, '#btnStart'));
  await L.shot(host, '80-lobby-host');

  // ══ くわしい設定を変える → 印・数・要約・参加者 ══
  await host.page.click('#moreSettings > summary');
  check('押すと、くわしい設定がひらく', await L.waitFor(() => host.page.$eval('#set-tasks', (n) => n.checkVisibility())));
  await host.page.selectOption('#set-tasks', '3');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.tasks === 3);
  await host.page.selectOption('#set-pair', '0');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.pair === 0);
  await host.page.selectOption('#set-angel', '1');
  check('変えた3つに印', await L.waitFor(async () => (await changed(host)).sort().join() === 'set-angel,set-pair,set-tasks'), await changed(host));
  check('「変えた」の文字', (await host.page.$$eval('.nk-tag--changed', (n) => n.map((x) => x.textContent))).every((t) => t === '変えた'));
  check('「3つ変えています」', (await L.text(host, '#moreSub')) === '3つ変えています');
  check('参加者にも印と数', await L.waitFor(async () => (await changed(g1)).length === 3 && (await L.text(g1, '#moreSub')) === '3つ変えています'));
  check('ひらいた状態は描きなおしても保たれる', await host.page.$eval('#moreSettings', (d) => d.open));
  check('要約: ひとりの仕事3つ（ふたりの仕事なし）・役職1つ', (await L.text(host, '#startSummary')) === '2人・パーク・ねむらせ屋1人・ひとりの仕事3つ・役職1つ', await L.text(host, '#startSummary'));
  check('もどすボタンが出る', await L.visible(host, '#btnResetSettings'));
  check('参加者には、もどすボタンは出ない', !(await L.visible(g1, '#btnResetSettings')));
  await host.page.evaluate(() => window.scrollTo(0, 0));
  check('ひらいていても「はじめる」は画面の中', await inView(host, '#btnStart'));
  await L.shot(host, '81-lobby-more-changed');
  await host.page.$eval('h3.nk-h3:nth-of-type(2)', (n) => n.scrollIntoView()).catch(() => {});
  await host.page.$eval('#lobbySettings', (n) => n.scrollIntoView({ block: 'start' }));
  await sleep(200);
  await L.shot(host, '81b-lobby-settings');

  // ══ まず決めることを変える → 印。もどすボタンはまず決めることを変えない ══
  await host.page.selectOption('#set-map', '0');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.map === 0);
  await host.page.selectOption('#set-hostPlays', '0');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.hostPlays === 0);
  check('マップ・ホストにも印', await L.waitFor(async () => (await changed(host)).includes('set-map') && (await changed(host)).includes('set-hostPlays')));
  check('要約: ひみつ基地・ホストは進行だけ（遊ぶ人は1人）', await L.waitFor(async () => (await L.text(host, '#startSummary')) === '1人・ひみつ基地・ねむらせ屋1人・ひとりの仕事3つ・ホストは進行だけ・役職1つ'), await L.text(host, '#startSummary'));
  check('くわしい設定の数には入らない（3つのまま）', (await L.text(host, '#moreSub')) === '3つ変えています');
  await host.page.click('#btnResetSettings');
  const r0 = await L.roomWhen(code, (r) => r && r.settings && r.settings.tasks === 4);
  const keep = Object.keys(E.DEFAULT_SETTINGS).filter((k) => k !== 'map' && k !== 'hostPlays').every((k) => r0.settings[k] === E.DEFAULT_SETTINGS[k]);
  check('もどす: くわしい設定はぜんぶはじめの値', keep, r0.settings);
  check('もどす: マップ・ホストはそのまま', r0.settings.map === 0 && r0.settings.hostPlays === 0);
  check('もどすと「はじめのままで遊べます」・ボタンが消える', await L.waitFor(async () => (await L.text(host, '#moreSub')) === 'はじめのままで遊べます' && !(await L.visible(host, '#btnResetSettings'))));
  check('参加者も「はじめのままで遊べます」', await L.waitFor(async () => (await L.text(g1, '#moreSub')) === 'はじめのままで遊べます'));
  await host.page.selectOption('#set-hostPlays', '1');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.hostPlays === 1);

  // ══ 375px ══
  check('375px（参加者）: 横スクロールなし・要約が画面の中', (await L.overflow(g1)) <= 0 && (await g1.page.evaluate(() => { window.scrollTo(0, 0); return true; })) && (await inView(g1, '#startSummary')));
  await L.shot(g1, '82-lobby-guest-375');
  await host.page.setViewportSize({ width: 375, height: 740 });
  await host.page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  check('375px（ホスト）: 横スクロールなし・「はじめる」が画面の中', (await L.overflow(host)) <= 0 && (await inView(host, '#btnStart')));
  const hit = await host.page.evaluate(() => {
    const a = document.getElementById('btnStart').getBoundingClientRect();
    const f = document.querySelector('.howto-fab');
    if (!f) return false;
    const b = f.getBoundingClientRect();
    return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
  });
  check('375px（ホスト）: 「はじめる」と「？」がかさならない', !hit);
  await L.shot(host, '83-lobby-host-375');
  await host.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(200);
  await L.shot(host, '83b-lobby-host-375-bottom');

  // ══ はじめられる（ロボットを足して） ══
  for (let i = 0; i < 2; i++) await host.page.click('#btnAddBot');
  await host.page.click('#btnStart');
  for (const c of [host, g1]) await L.waitScreen(c, 'game');
  check('はじめると、ゲームの設定はもどしたあとの値', (await L.roomOf(code)).game.settings.tasks === 4);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
