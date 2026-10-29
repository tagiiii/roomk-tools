// その5: 子どもの要望の第3便（2026-10-29）
// 広いマップ（監視室のカメラ6つ・十字のひろば）・小さな地図・役職（整備係・見守り係・へんしん屋・まもり星）
const L = require('./lib.cjs');
const { E, check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');
  const g2 = await L.newClient('g2');
  const g3 = await L.newClient('g3');
  const all = [host, g1, g2, g3];

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await L.joinRoom(g2, 'みどり', code);
  await L.joinRoom(g3, 'そら', code);
  await host.page.click('#btnAddBot');
  check('ロボット1つで5人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '5人'));

  // ══ 役職の設定 ══
  for (const k of ['engineer', 'watcher', 'angel', 'shifter']) {
    check('役職の設定（はじめは入れない） ' + k, (await L.text(g1, '#set-' + k)) === '入れない');
    await host.page.selectOption('#set-' + k, '1');
  }
  check('「入れる」が参加者に届く', await L.waitFor(async () => (await L.text(g1, '#set-shifter')) === '入れる' && (await L.text(g1, '#set-engineer')) === '入れる'));
  check('設定の名前', (await L.text(g1, '.nk-settings')).includes('整備係') && (await L.text(g1, '.nk-settings')).includes('まもり星'));
  await host.page.click('#btnStart');
  for (const c of all) await L.waitScreen(c, 'game');
  let room = await L.roomOf(code);
  const jobs0 = room.game.jobs || {};
  const humanSleeper = Object.keys(room.game.roles).some((id) => room.game.roles[id] === 'sleeper' && !id.startsWith('*'));
  check('整備係・見守り係が1人ずつ、人の隊員に付く', Object.values(jobs0).filter((j) => j === 'engineer').length === 1 && Object.values(jobs0).filter((j) => j === 'watcher').length === 1
    && Object.keys(jobs0).every((id) => !id.startsWith('*') && (jobs0[id] === 'shifter' ? room.game.roles[id] === 'sleeper' : room.game.roles[id] === 'crew')), jobs0);
  check('へんしん屋は、人のねむらせ屋がいるときだけ', humanSleeper === Object.values(jobs0).includes('shifter'), { jobs0, roles: room.game.roles });
  check('まもり星は、はじめはだれでもない', !room.game.angel);
  const jobHolder = Object.keys(jobs0).find((id) => id === 'ホスト' || id === 'あお' || id === 'みどり' || id === 'そら');
  if (jobHolder) {
    const c = { 'ホスト': host, 'あお': g1, 'みどり': g2, 'そら': g3 }[jobHolder];
    check('役のお知らせに役職', await L.waitFor(async () => (await L.text(c, '#roleName')).includes(E.JOB_NAMES[jobs0[jobHolder]])));
  }
  for (const c of all) await L.dismissRole(c);
  // ここからは役と役職を決めて確かめる
  await L.patchGame(code, {
    roles: { 'ホスト': 'crew', 'あお': 'sleeper', 'みどり': 'crew', 'そら': 'crew', '*1': 'crew' },
    jobs: { 'みどり': 'engineer', 'そら': 'watcher', 'あお': 'shifter' },
    cooldown: { 'あお': Date.now() + 3600000 }, darkReadyAt: Date.now() + 3600000, buttonReadyAt: Date.now() + 3600000,
  });
  check('役の表示に役職', await L.waitFor(async () => (await L.text(g2, '#hudRole')) === '隊員・整備係' && (await L.text(g3, '#hudRole')) === '隊員・見守り係' && (await L.text(g1, '#hudRole')) === 'ねむらせ屋・へんしん屋'));
  check('役職のない人はそのまま', (await L.text(host, '#hudRole')) === '隊員');

  // ══ 広いマップ ══
  check('マップは 64×43', E.W === 64 && E.H === 43);
  const sp0 = await L.me(host);
  check('はじめはテーブルのまわり（十字のひろば）', E.roomAt(sp0.x, sp0.y) === 'plaza', sp0);

  // ══ 小さな地図 ══
  for (const c of all) check('小さな地図がいつも出る ' + c.label, await L.waitFor(() => L.visible(c, '#miniMap')));
  const mm = await host.page.evaluate(() => { const r = document.getElementById('miniView').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  check('小さな地図はマップと同じ形', Math.abs(mm.h / mm.w - E.H / E.W) < 0.03, mm);
  const miniPx = async (c, wx, wy) => c.page.evaluate(([x, y]) => {
    const cv = document.getElementById('miniView');
    const En = window.NemuraseEngine;
    const dpr = cv.width / cv.clientWidth;
    const s = cv.clientWidth / En.W;
    const d = cv.getContext('2d').getImageData(Math.round(x * s * dpr), Math.round(y * s * dpr), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [wx, wy]);
  const hostHex = E.COLORS.find((c) => c.key === (room.game.colors['ホスト'])).hex;
  await L.teleport(host, 55.5, 4.5);   // 畑
  check('小さな地図に自分の場所', await L.waitFor(async () => L.nearColor(await miniPx(host, 55.5, 4.5), hostHex, 30)), await miniPx(host, 55.5, 4.5));
  check('ほかの人は出ない（みどりの場所は床の色）', !L.nearColor(await miniPx(host, (await L.me(g2)).x, (await L.me(g2)).y), E.COLORS.find((c) => c.key === room.game.colors['みどり']).hex, 30));
  await host.page.click('#miniMap');
  check('押すと大きな地図がひらく', await L.waitFor(() => L.visible(host, '#ovMap')));
  check('大きな地図の間は小さな地図をかくす', await L.waitFor(async () => !(await L.visible(host, '#miniMap'))));
  await host.page.click('#btnMapClose');
  check('とじると小さな地図がもどる', await L.waitFor(() => L.visible(host, '#miniMap')));
  await L.shot(host, '51-minimap');

  // ══ 監視室のカメラ ══
  check('カメラの台は監視室', E.roomAt(E.CAM_STAND.x, E.CAM_STAND.y) === 'monitor');
  await L.teleport(host, E.CAM_STAND.x, E.CAM_STAND.y + 0.5);
  check('監視室で「カメラを見る」', await L.waitFor(async () => (await L.text(host, '#actUseLabel')) === 'カメラを見る'));
  await host.page.click('#actUse');
  check('カメラの画面がひらく', await L.waitFor(() => L.visible(host, '#ovCam')));
  check('カメラは6か所（文言）', (await L.text(host, '#ovCam')).includes('6か所'));
  const cv = await host.page.evaluate(() => { const c = document.getElementById('camView'); return { w: c.clientWidth, h: c.clientHeight }; });
  check('カメラの映像は3列×2行', Math.abs(cv.h - Math.round(cv.w / 3) * 2) <= 2 || Math.abs(cv.h - Math.round((cv.w / 3) * 2)) <= 2, cv);
  await L.shot(host, '52-cams');
  await host.page.click('#btnCamClose');
  await L.waitHidden(host, '#ovCam');
  await L.teleport(g3, E.CAM_STAND.x, E.CAM_STAND.y + 0.5);
  await sleep(300);
  await g3.page.click('#actSay');
  await g3.page.click('#sayChips .nk-word[data-say="here"]');
  check('ひとことの部屋の名前は「監視室」', await L.waitFor(async () => (await L.text(host, '#sayTicker')).includes('監視室にいるよ')));
  await sleep(5200);   // ひとことは5秒に1回

  // ══ 整備係: 近道を使える（使うと30秒待つ） ══
  const v0 = E.VENTS[0];
  await L.teleport(host, v0.x, v0.y + 0.4);
  await sleep(400);
  check('役職のない隊員は近道を使えない', !(await L.text(host, '#actUseLabel')).includes('近道'));
  await L.teleport(host, 33, 24.5);
  await L.teleport(g2, v0.x, v0.y + 0.4);
  check('整備係は近道の上で「近道を使う」', await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === '近道を使う'));
  await g2.page.click('#actUse');
  const to = E.VENTS[v0.to];
  check('整備係はつながった近道へ移る', await L.waitFor(async () => { const m = await L.me(g2); return Math.hypot(m.x - to.x, m.y - to.y) < 0.1; }));
  check('続けては使えない（あと何秒）', await L.waitFor(async () => /^近道（あと\d+秒）$/.test(await L.text(g2, '#actUseLabel')) && await g2.page.$eval('#actUse', (b) => b.disabled)));
  check('整備係に役職のボタンは出ない', !(await L.visible(g2, '#actJob')));

  // ══ 見守り係: ねむりチェッカー ══
  await L.teleport(g3, 33, 25.5);
  check('見守り係に「チェッカー」', await L.waitFor(async () => (await L.visible(g3, '#actJob')) && (await L.text(g3, '#actJobLabel')).startsWith('チェッカー')));
  await g3.page.click('#actJob');
  check('チェッカーがひらく', await L.waitFor(() => L.visible(g3, '#ovVitals')));
  check('5人ぶんの状態（みんなおきている）', await L.waitFor(async () => (await g3.page.$$('#vitalsList .nk-person')).length === 5) && !(await L.text(g3, '#vitalsList')).includes('ねむっている'));
  check('役は出さない', !(await L.text(g3, '#vitalsList')).includes('ねむらせ屋'));
  const b0 = await g3.page.evaluate(() => window.__NK__.state.battery);
  await g3.page.keyboard.down('ArrowLeft');
  await sleep(500);
  await g3.page.keyboard.up('ArrowLeft');
  check('見ている間は歩けない', Math.abs((await L.me(g3)).x - 33) < 0.01);
  check('見ている間は電池がへる', (await g3.page.evaluate(() => window.__NK__.state.battery)) < b0 - 0.3);
  await L.shot(g3, '53-vitals');
  await g3.page.keyboard.press('KeyG');
  check('G でとじる', await L.waitFor(async () => !(await L.visible(g3, '#ovVitals'))));
  await g3.page.evaluate(() => { window.__NK__.state.battery = 1.5; });
  check('電池があれば押せる', await L.waitFor(async () => !(await g3.page.$eval('#actJob', (b) => b.disabled))), await g3.page.evaluate(() => ({ b: window.__NK__.state.battery, l: document.getElementById('actJobLabel').textContent, d: document.getElementById('actJob').disabled })));
  await g3.page.keyboard.press('KeyG');
  check('G でひらく', await L.waitFor(() => L.visible(g3, '#ovVitals')));
  check('電池がなくなると とじる', await L.waitFor(async () => !(await L.visible(g3, '#ovVitals')), 4000));
  check('電池がなくなったお知らせ', await L.waitToast(g3, '電池がなくなった'));
  check('電池がないと押せない', await g3.page.$eval('#actJob', (b) => b.disabled));
  await L.doFirstTask(g3, 'そら');
  check('仕事を1つおえると満タン', await L.waitFor(async () => (await g3.page.evaluate(() => window.__NK__.state.battery)) >= E.WATCH_BATTERY_S - 0.01));

  // ══ へんしん屋 ══
  check('へんしん屋に「へんしん」', await L.waitFor(async () => (await L.visible(g1, '#actJob')) && (await L.text(g1, '#actJobLabel')) === 'へんしん'));
  await g1.page.click('#actJob');
  check('だれになるかの一覧（おきているほかの人4人）', await L.waitFor(async () => (await L.visible(g1, '#shiftBox')) && (await g1.page.$$('#shiftNames .nk-word')).length === 4));
  await L.shot(g1, '54-shift');
  await g1.page.click('#shiftNames .nk-word:has-text("みどり")');
  check('へんしんが書かれる（みどりのすがた・20秒）', await L.waitFor(async () => { const s = (await L.roomOf(code)).game.shape?.['あお']; return s && s.as === 'みどり' && s.until > Date.now() + 15000; }));
  check('へんしん中は押せない', await L.waitFor(async () => (await L.text(g1, '#actJobLabel')).startsWith('へんしん中') && await g1.page.$eval('#actJob', (b) => b.disabled)));
  // そらの画面で、あおが みどりの色で描かれる
  const midoriHex = E.COLORS.find((c) => c.key === room.game.colors['みどり']).hex;
  const aoHex = E.COLORS.find((c) => c.key === room.game.colors['あお']).hex;
  await L.teleport(g2, 60.5, 21.5);   // みどりは倉庫へ（同じ色がならばないように）
  await L.teleport(g3, 34.5, 25.5);   // そらは十字のひろばの下（仕事をしに行った場所から戻す）
  await L.teleport(g1, 31.5, 25.5);
  const paSettled = (c, id, x, y) => L.waitFor(async () => {
    const pa = await c.page.evaluate((who) => window.__NK__.PA[who], id);
    return pa && Math.hypot(pa.tx - x, pa.ty - y) < 0.05 && Math.hypot(pa.x - pa.tx, pa.y - pa.ty) < 0.01;
  });
  check('あおの位置がそらに届く', await paSettled(g3, 'あお', 31.5, 25.5));
  await sleep(300);
  const pxShift = await L.pixelAt(g3, 31.5, 25.5);
  check('へんしん中のあおは、みどりの色で描かれる', L.nearColor(pxShift, midoriHex, 30) && !L.nearColor(pxShift, aoHex, 30), { pxShift, midoriHex, aoHex });
  await L.shot(g3, '55-shifted');
  await g1.page.click('#actSay');
  await g1.page.click('#sayChips .nk-word[data-say="hey"]');
  check('へんしん中のひとことは、なっている人の名前で出る', await L.waitFor(async () => (await L.text(g3, '#sayTicker')).includes('みどりおーい！')));
  check('見た目のだれかは送った時点で決まる（say.a）', (await L.roomOf(code)).game.say['あお'].a === 'みどり');
  await L.patchGame(code, { shape: { 'あお': { as: 'みどり', until: Date.now() - 1 } } });
  await sleep(500);
  check('へんしんがおわると、もとの色', await L.waitFor(async () => L.nearColor(await L.pixelAt(g3, 31.5, 25.5), aoHex, 30)), await L.pixelAt(g3, 31.5, 25.5));
  check('おわってから次まで待つ', await L.waitFor(async () => /^へんしん \d+$/.test(await L.text(g1, '#actJobLabel'))));

  // ══ まもり星: 最初にねむった隊員がなる ══
  await L.patchGame(code, { cooldown: { 'あお': 1 } });
  await L.teleport(host, 40.5, 37.5);   // 見はり台
  await L.teleport(g1, 39.8, 37.5);
  await L.waitFor(async () => !(await g1.page.$eval('#actSleep', (b) => b.disabled)));
  await g1.page.click('#actSleep');
  check('ホストがねむり、まもり星になる', await L.waitFor(async () => { const g = (await L.roomOf(code)).game; return g.asleep?.['ホスト'] === 'slept' && g.angel === 'ホスト' && g.angelReadyAt > Date.now(); }));
  check('まもり星のお知らせ', await L.waitFor(async () => (await L.text(host, '#stageBanner')).includes('まもり星になった')));
  check('役の表示に「まもり星」', await L.waitFor(async () => (await L.text(host, '#hudRole')).includes('まもり星')));
  check('まもり星の「まもる」は、はじめは待つ', await L.waitFor(async () => /^まもる \d+$/.test(await L.text(host, '#actJobLabel'))));
  await L.patchGame(code, { angelReadyAt: 1, cooldown: { 'あお': Date.now() + 3600000 } });
  await L.teleport(g2, 26.5, 37.5);
  await L.teleport(host, 27.5, 37.5);
  check('おきている人の近くで「まもる」が押せる', await L.waitFor(async () => (await L.text(host, '#actJobLabel')) === 'まもる' && !(await host.page.$eval('#actJob', (b) => b.disabled))));
  await host.page.click('#actJob');
  check('バリアが書かれる（15秒）', await L.waitFor(async () => (((await L.roomOf(code)).game.shield || {})['みどり'] || 0) > Date.now() + 10000));
  check('まもったあとは待つ', await L.waitFor(async () => /^まもる \d+$/.test(await L.text(host, '#actJobLabel'))));
  // バリアのある人はねむらせられない
  await L.patchGame(code, { cooldown: { 'あお': 1 } });
  await L.teleport(g1, 25.8, 37.5);
  await L.waitFor(async () => !(await g1.page.$eval('#actSleep', (b) => b.disabled)));
  await g1.page.click('#actSleep');
  check('バリアで ねむらせられない', await L.waitFor(async () => { const g = (await L.roomOf(code)).game; return g.blocked?.by === 'あお' && g.blocked?.t === 'みどり' && !g.asleep?.['みどり'] && !(g.shield || {})['みどり']; }));
  check('ねむらせ屋に「バリアでまもられていて」', await L.waitToast(g1, 'バリアでまもられていて'));
  check('まもり星に「まもれた！」', await L.waitToast(host, 'みどり さんをまもれた'));
  check('みどりには知らせない', !((await L.text(g2, '#roomk-toast').catch(() => '')) || '').includes('バリア'));
  check('ねむらせ屋の待ち時間ははじめから', ((await L.roomOf(code)).game.cooldown['あお'] || 0) > Date.now() + 10000);
  check('チェッカーに「ねむっている」', await (async () => { await g3.page.click('#actJob'); const ok = await L.waitFor(async () => (await L.text(g3, '#vitalsList')).includes('ねむっている')); await g3.page.keyboard.press('Escape'); return ok; })());

  // ══ 会議でへんしん・バリアは消える。小さな地図もかくす ══
  await L.patchGame(code, { shape: { 'あお': { as: 'そら', until: Date.now() + 20000 } }, shield: { 'そら': Date.now() + 20000 } });
  const body = (await L.roomOf(code)).game.bodies['ホスト'];
  await L.teleport(g2, body.x + 1, body.y);
  await L.waitFor(() => L.visible(g2, '#actFind'));
  await g2.page.click('#actFind');
  check('会議がひらく', await L.waitFor(() => L.visible(g3, '#ovMeeting')));
  room = await L.roomOf(code);
  check('会議でへんしん・バリアは消える', !room.game.shape?.['あお'] && !room.game.shield?.['そら']);
  check('会議の間は小さな地図をかくす', await L.waitFor(async () => !(await L.visible(g3, '#miniMap'))));

  // ══ おしまいの一覧に役職 ══
  await L.patchGame(code, { stage: 'end', winner: 'crew', winReason: 'tasks', meeting: null });
  check('おしまい', await L.waitFor(() => L.visible(g3, '#ovEnd')));
  const endText = await L.text(g3, '#endPeople');
  check('おしまいの一覧に役職', ['整備係', '見守り係', 'へんしん屋', 'まもり星'].every((w) => endText.includes(w)), endText);
  await L.shot(g3, '56-end');

  // ══ 幅 375px ══
  await host.page.click('#btnAgain');
  await L.waitScreen(g3, 'waiting');
  await host.page.click('#btnStart');
  await L.waitScreen(g3, 'game');
  await g3.page.setViewportSize({ width: 375, height: 740 });
  await L.dismissRole(g3).catch(() => {});
  await sleep(600);
  const rects = await g3.page.evaluate(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    return { mini: r('miniMap'), tasks: r('taskList'), actions: document.querySelector('.nk-actions').getBoundingClientRect().top };
  });
  check('375px: 小さな地図は118px', Math.abs(rects.mini.w - 118) < 1, rects);
  check('375px: 小さな地図と「やること」が重ならない', rects.tasks.r <= rects.mini.l, rects);
  check('375px: 小さな地図はボタンの上', rects.mini.b < rects.actions, rects);
  check('375px: 横にはみ出さない', (await L.overflow(g3)) <= 0);
  await L.shot(g3, '57-375');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
