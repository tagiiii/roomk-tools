// その6: 2つ目のマップ「パーク」（2026-10-29 子どもの要望「カタリバパークのような空間でゲームがしたい」）
// 待合室でマップを選ぶ・みんなの画面がパークになる・テーブル（エントランス）・停電（ウェルカムセンター）・カメラ（マイクラルーム）・すべり台・近道の行き先・ひとことの部屋の名前・次の回でひみつ基地にもどす
const L = require('./lib.cjs');
const { E, check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');
  const g2 = await L.newClient('g2');
  const all = [host, g1, g2];

  const code = await L.createRoom(host, 'ホスト', { keepMap: true });
  await L.joinRoom(g1, 'あお', code);
  await L.joinRoom(g2, 'みどり', code);
  await host.page.click('#btnAddBot');
  check('ロボット1つで4人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '4人'));

  // ══ マップの設定 ══
  check('マップの設定（はじめはパーク）', (await L.text(g1, '#set-map')) === 'パーク' && (await host.page.$eval('#set-map', (s) => s.value)) === '1');
  await host.page.click('#btnStart');
  for (const c of all) await L.waitScreen(c, 'game');
  let room = await L.roomOf(code);
  check('ゲームの設定にマップ（1＝パーク）', room.game.settings.map === 1);
  for (const c of all) check('画面のマップがパーク ' + c.label, await L.waitFor(() => c.page.evaluate(() => window.NemuraseEngine.mapKey() === 'park' && window.NemuraseEngine.W === 87)));
  check('仕事の場所はパークの場所', Object.values(room.game.tasks).every((ts) => ts.every((t) => t.spot >= 100 || t.spot < 26)));
  for (const c of all) await L.dismissRole(c);
  await L.patchGame(code, { roles: { 'ホスト': 'crew', 'あお': 'sleeper', 'みどり': 'crew', '*1': 'crew' }, cooldown: { 'あお': Date.now() + 3600000 }, darkReadyAt: 1, buttonReadyAt: 1 });
  await sleep(800);
  const me0 = await L.me(host);
  check('はじめはエントランスのテーブルのまわり', E.useMap('park') && E.roomAt(me0.x, me0.y) === 'entrance', me0);
  await L.shot(host, '60-park-start');

  // ══ ひとことの部屋の名前 ══
  await L.teleport(host, 45.5, 8.5);   // みんなのひろば
  await sleep(300);
  await host.page.click('#actSay');
  await host.page.click('#sayChips .nk-word[data-say="here"]');
  check('ひとことに「みんなのひろばにいるよ」', await L.waitFor(async () => (await L.text(host, '#sayTicker')).includes('みんなのひろばにいるよ')));
  await L.shot(host, '61-park-hiroba');

  // ══ すべり台（みんなのひろば → 作戦会議エリア） ══
  const l0 = E.LADDERS[0];
  const l1 = E.LADDERS[1];
  await L.teleport(host, l0.x, l0.y + 0.4);
  check('すべり台の上で「すべり台ですべる」', await L.waitFor(async () => (await L.text(host, '#actUseLabel')) === 'すべり台ですべる'));
  await host.page.click('#actUse');
  check('すべると 作戦会議エリアへ', await L.waitFor(async () => { const m = await L.me(host); return Math.hypot(m.x - l1.x, m.y - l1.y) < 0.1; }, 6000));

  // ══ 停電（ウェルカムセンターのスイッチ） ══
  await g1.page.keyboard.press('KeyF');
  await L.waitVisible(g1, '#sabBox');
  check('しかけの説明もパークの部屋の名前', (await L.text(g1, '#sabDarkDesc')).includes('ウェルカムセンター') && (await L.text(g1, '#sabAirDesc')).includes('クラブルームとソファ席エリア'));
  await g1.page.click('#sabDark');
  check('停電の帯に「ウェルカムセンターのスイッチ」', await L.waitFor(async () => (await L.visible(g2, '#hudDark')) && (await L.text(g2, '#hudDark')).includes('ウェルカムセンターのスイッチ')));
  await L.teleport(g2, E.FIX_SPOT.x, E.FIX_SPOT.y + 0.6);
  check('ウェルカムセンターで「電気をなおす」', await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === '電気をなおす'));
  await g2.page.click('#actUse');
  check('ミニゲームの題も「ウェルカムセンター」', await L.waitFor(() => L.visible(g2, '#ovTask')) && (await L.text(g2, '#taskTitle')).startsWith('ウェルカムセンター'));
  await L.solveTask(g2);
  check('なおると停電がおわる', await L.waitFor(async () => !(await L.roomOf(code)).game.dark));
  await L.shot(g2, '62-park-staff');

  // ══ カメラ（マイクラルーム） ══
  await L.teleport(g2, E.CAM_STAND.x, E.CAM_STAND.y + 0.5);
  check('マイクラルームで「カメラを見る」', await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === 'カメラを見る'));
  await g2.page.click('#actUse');
  check('カメラは6か所', await L.waitFor(async () => (await L.visible(g2, '#ovCam')) && (await L.text(g2, '#camCount')) === '通路の6か所'));
  await L.shot(g2, '63-park-cams');
  await g2.page.click('#btnCamClose');

  // ══ 近道の行き先はパークの部屋 ══
  const v0 = E.VENTS[0];
  await L.teleport(g1, v0.x, v0.y + 0.4);
  check('ねむらせ屋は近道に入れる', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')) === '近道に入る'));
  await g1.page.click('#actUse');
  check('行き先にパークの部屋（探Qルーム・のんびり）', await L.waitFor(async () => (await L.visible(g1, '#ventBox')) && (await L.text(g1, '#ventRooms')).includes('探Qルーム') && (await L.text(g1, '#ventRooms')).includes('のんびり')));
  await g1.page.click('#ventRooms .nk-word[data-vent="9"]');
  check('探Qルームの近道から出る', await L.waitFor(async () => { const m = await L.me(g1); return Math.hypot(m.x - E.VENTS[9].x, m.y - E.VENTS[9].y) < 0.1; }));

  // ══ 仕事（パークの場所で） ══
  await L.doFirstTask(g2, 'みどり（パーク）');
  check('仕事が数えられる', await L.waitFor(async () => L.doneCount(await L.gameIn(host)) >= 1));

  // ══ 地図・小さな地図 ══
  await host.page.keyboard.press('KeyM');
  check('大きな地図がひらく', await L.waitFor(() => L.visible(host, '#ovMap')));
  const ratio = await host.page.evaluate(() => { const c = document.getElementById('mapView'); return c.clientHeight / c.clientWidth; });
  check('地図の形はパーク（60/87）', Math.abs(ratio - 60 / 87) < 0.02, ratio);
  await L.shot(host, '64-park-map');
  await host.page.keyboard.press('KeyM');

  // ══ 375px ══
  await g2.page.setViewportSize({ width: 375, height: 740 });
  await sleep(500);
  check('375px: 横にはみ出さない', (await L.overflow(g2)) <= 0);
  await L.shot(g2, '65-park-375');
  await g2.page.setViewportSize({ width: 1200, height: 800 });

  // ══ 次の回はひみつ基地にもどせる ══
  await L.patchGame(code, { stage: 'end', winner: 'draw', winReason: 'timeup' });
  await L.waitVisible(host, '#ovEnd');
  await host.page.click('#btnAgain');
  for (const c of all) await L.waitScreen(c, 'waiting');
  await host.page.selectOption('#set-map', '0');
  check('「ひみつ基地」が参加者に届く', await L.waitFor(async () => (await L.text(g1, '#set-map')) === 'ひみつ基地'));
  await host.page.click('#btnStart');
  for (const c of all) await L.waitScreen(c, 'game');
  for (const c of all) check('次の回はひみつ基地 ' + c.label, await L.waitFor(() => c.page.evaluate(() => window.NemuraseEngine.mapKey() === 'kichi' && window.NemuraseEngine.W === 84)));
  room = await L.roomOf(code);
  check('ひみつ基地の仕事の場所', Object.values(room.game.tasks).every((ts) => ts.every((t) => t.spot >= 100 || t.spot < 22)));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
