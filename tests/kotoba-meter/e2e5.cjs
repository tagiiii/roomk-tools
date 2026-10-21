// ことばメーター E2E その5: 20人のルームで、みんなにみせる画面（1280×720）が待合室・結果とも1画面に収まるか（端末なしの参加者で20人にする）
const L = require('./lib.cjs');
const { check, sleep } = L;
(async () => {
  const server = await L.startServer(); await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('guest', { viewport: { width: 375, height: 812 } });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });
  const code = await L.createRoom(H, 'メンターさん');
  await L.joinRoom(A, 'ながいなまえだ', code);
  await L.openWatch(W, code);
  // 端末なしの参加者で20人にする（名前は8文字いっぱい）
  const names = Array.from({ length: 18 }, (_, i) => 'さんかしゃ' + String(i + 1).padStart(2, '0') + 'ん');
  for (const n of names) {
    await H.page.fill('#proxy-name', n);
    await H.page.click('#proxy-add');
    await H.page.waitForFunction((x) => document.getElementById('players').textContent.includes(x), n);
  }
  await L.waitText(W, '#people-title', '20人', 10000);
  const bottom = (sel) => W.page.evaluate((s) => document.querySelector(s).getBoundingClientRect().bottom, sel);
  console.log('lobby: next-presenter bottom', await bottom('#next-presenter'), 'players bottom', await bottom('#players'));
  check('lobby: 参加のしかたと次の出題者は720に入る', (await bottom('#next-presenter')) <= 720);
  await L.shot(W, 'w20-lobby', false);
  await L.shot(W, 'w20-lobby-full', true);
  // 21人目は入れない
  await H.page.fill('#proxy-name', 'あふれる');
  await H.page.click('#proxy-add');
  await L.waitToast(H, '20人');
  check('21人目は足せない', (await L.text(H, '#people-title')).includes('20人'));
  await sleep(500);

  const round = async (dist, label) => {
    const hostId = await H.page.evaluate(() => JSON.parse(sessionStorage.getItem('roomk-kotoba-meter-cloud-session')).id);
    if ((await H.page.inputValue('#presenter-select')) !== hostId) {
      await H.page.selectOption('#presenter-select', hostId);
      await L.waitText(W, '#next-presenter', 'メンターさん', 10000);
    }
    await H.page.click('#start');
    await L.waitVisible(H, '#secret-area');
    await L.sendHint(H, 'ふわふわの毛布で全身をつつむ');
    await L.waitVisible(H, '#proxy-area');
    await L.answer(A, dist[0]);
    for (let i = 0; i < names.length; i++) {
      const sel = `#proxy-rows button[aria-label="${names[i]}さん：${dist[(i + 1) % dist.length]}"]`;
      await H.page.click(sel);
      await H.page.waitForFunction((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', sel);
    }
    await L.waitText(H, '#progress', '19 / 19', 10000);
    await sleep(1200);
    if (label === 'all-same') await L.shot(W, 'w20-vote', false);
    console.log(label, 'vote: hint bottom', await bottom('#hint-area'));
    await H.page.click('#reveal');
    await L.waitVisible(W, '#result-area', 10000);
    await sleep(1200);
    const talk = await bottom('.km-talk');
    const cols = await bottom('#result-columns');
    console.log(label, 'columns bottom', cols, 'talk bottom', talk, 'overflowX', await L.overflow(W));
    check(label + ': 「話してみよう」まで720に入る', talk <= 720, talk);
    check(label + ': 横にはみ出さない', (await L.overflow(W)) <= 0);
    check(label + ': ゲストのスマホで横にはみ出さない', (await L.overflow(A)) <= 0);
    await L.shot(W, 'w20-' + label, false);
    await L.shot(A, 'g20-' + label, true);
  };
  await round([3], 'all-same');          // 19人が同じ数字（いちばん縦に伸びる）
  await round([1, 2, 3, 4, 5, 3, 4], 'spread');   // ばらける
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
