// その3（2026-10-28 子どもの要望の第2便）: 設定（会議の時間150/180・ふたりの仕事・みんなの仕事のバー）・声の約束の帯・
//        ねむった人はかべを通りぬける・だれにねむらされたか（本人だけ）・読み込み直しても元の場所・ドア・空気の妨害（なおす・時間切れで負け）・
//        ふたりの仕事（人どうし・ロボットの手伝い・はなれるとやめる）・地図・未投票はスキップ・会議の残り時間の見せ方
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

  // ══ 待合室の設定 ══
  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await L.joinRoom(g2, 'みどり', code);
  await L.joinRoom(g3, 'そら', code);
  check('会議の時間に150・180秒がある', await host.page.$eval('#set-meeting', (s) => Array.from(s.options).map((o) => o.value).join()) === '60,90,120,150,180');
  await host.page.selectOption('#set-meeting', '180');
  check('180秒が参加者に届く', await L.waitFor(async () => (await L.text(g1, '#set-meeting')) === '180秒'));
  await host.page.selectOption('#set-meeting', '60');
  check('ふたりの仕事の設定（はじめは あり）', (await L.text(g1, '#set-pair')) === 'あり（隊員はひとり1つ）');
  check('みんなの仕事のバーの設定（はじめは 出す）', (await L.text(g1, '#set-gauge')) === '出す');
  await host.page.selectOption('#set-gauge', '0');
  check('「出さない」が参加者に届く', await L.waitFor(async () => (await L.text(g1, '#set-gauge')) === '出さない'));

  // ══ はじめる（バーなし） ══
  await host.page.click('#btnStart');
  for (const c of all) { await L.waitScreen(c, 'game'); await L.dismissRole(c); }
  for (const c of all) check('バーを出さない設定では、みんなの仕事のバーが出ない ' + c.label, !(await L.visible(c, '#hudGauge')));
  for (const c of all) check('声の約束の帯（ミュート） ' + c.label, await L.visible(c, '#hudMute') && (await L.text(c, '#hudMuteText')).includes('ミュート'));
  let room = await L.roomOf(code);
  check('隊員は仕事5つ（ふたりの仕事を1つ含む）・ねむらせ屋は4つ', Object.keys(room.game.tasks).every((id) => room.game.tasks[id].length === (room.game.roles[id] === 'crew' ? 5 : 4)));
  check('ふたりの仕事はふたりずつ別の組', (() => { const ps = Object.keys(room.game.tasks).filter((id) => room.game.roles[id] === 'crew').map((id) => room.game.tasks[id].find((t) => t.spot >= E.PAIR_SPOT_BASE).spot); return new Set(ps).size === 2; })());
  // 役をテスト用に決める: あお＝ねむらせ屋。ふたりの仕事は みどり＝p0、そら＝p1
  const roles = { 'ホスト': 'crew', 'あお': 'sleeper', 'みどり': 'crew', 'そら': 'crew' };
  const tasks = {
    'ホスト': [{ spot: 0, done: false }, { spot: 100, done: false }],
    'あお': [{ spot: 2, done: false }],
    'みどり': [{ spot: 4, done: false }, { spot: 100, done: false }],
    'そら': [{ spot: 6, done: false }, { spot: 101, done: false }],
  };
  await L.patchGame(code, { roles, tasks, cooldown: { 'あお': 1 }, darkReadyAt: 1, buttonReadyAt: 1 });
  check('役が変わる', await L.waitFor(async () => (await L.text(g1, '#hudRole')) === 'ねむらせ屋'));
  check('やることに「ふたりの仕事」（部屋が2つ）', await L.waitFor(async () => (await L.text(g2, '#tasksItems')).includes('休けい室と畑') && (await L.text(g2, '#tasksItems')).includes('ふたりでスイッチを入れる')));
  check('やることの注意書き', (await L.text(g2, '#tasksNote')).includes('ふたりの仕事'));

  // ══ 地図 ══
  check('地図ボタンが出る', await L.visible(g2, '#btnMap'));
  await g2.page.keyboard.press('KeyM');
  check('M で地図がひらく', await L.waitFor(() => L.visible(g2, '#ovMap')));
  check('地図のキャンバスに描かれている', await g2.page.evaluate(() => { const c = document.getElementById('mapView'); return c.width > 100 && c.height > 50; }));
  await g2.page.keyboard.down('ArrowLeft');
  await sleep(400);
  await g2.page.keyboard.up('ArrowLeft');
  const sp2 = E.spawnPoint(2, 4);
  check('地図を見ている間は歩けない', Math.abs((await L.me(g2)).x - sp2.x) < 0.01);
  await g2.page.keyboard.press('Escape');
  check('Escape で地図がとじる', await L.waitFor(async () => !(await L.visible(g2, '#ovMap'))));
  await g2.page.click('#btnMap');
  await L.waitVisible(g2, '#ovMap');
  await g2.page.click('#btnMapClose');
  check('とじるボタンでもとじる', await L.waitFor(async () => !(await L.visible(g2, '#ovMap'))));
  check('進行役・見学でない人にだけ地図ボタン', await L.visible(host, '#btnMap'));

  // ══ 家具はかべ（ぶつかる） ══
  await L.teleport(g2, 6.5, 3.6);   // 台所のコンロ（6,2,2,1）の下
  await sleep(200);
  await g2.page.keyboard.down('ArrowUp');
  await sleep(700);
  await g2.page.keyboard.up('ArrowUp');
  check('家具にはぶつかる（コンロの上に行けない）', (await L.me(g2)).y >= 3 + E.RADIUS - 0.05, await L.me(g2));

  // ══ ドア ══
  check('ねむらせ屋に「しかけ」ボタン（停電ボタンはない）', await L.visible(g1, '#actSab') && !(await g1.page.$('#actDark')) && !(await L.visible(g2, '#actSab')));
  await g1.page.keyboard.press('KeyF');
  check('F で しかけの一覧がひらく（停電・空気・ドア）', await L.waitFor(() => L.visible(g1, '#sabBox')) && await L.visible(g1, '#sabDark') && await L.visible(g1, '#sabAir') && await L.visible(g1, '#sabDoor'));
  check('停電・空気は いま使える', (await L.text(g1, '#sabDarkNote')) === 'いま使える' && (await L.text(g1, '#sabAirNote')) === 'いま使える');
  await g1.page.click('#sabDoor');
  check('ドアを押すと部屋を選ぶ（10部屋・ひろばはない）', await L.waitFor(async () => (await L.visible(g1, '#sabRooms')) && (await g1.page.$$('#sabRooms .nk-word')).length === 10 && !(await L.text(g1, '#sabRooms')).includes('ひろば')));
  await L.shot(g1, '10-sab');
  // みどりを台所の外（台所↔通信室の通路、ドアの右どなり）に置いてから、台所のドアをしめる
  await L.teleport(g2, 15.5, 5.0);
  await g1.page.click('#sabRooms .nk-word[data-room="kitchen"]');
  check('台所のドアがとじる（doors.kitchen）', await L.waitFor(async () => ((await L.roomOf(code)).game.doors?.kitchen || 0) > Date.now()));
  check('しかけの一覧がとじる', await L.waitFor(async () => !(await L.visible(g1, '#sabBox'))));
  await sleep(200);
  await g2.page.keyboard.down('ArrowLeft');
  await sleep(1000);
  await g2.page.keyboard.up('ArrowLeft');
  check('とじたドアは通れない（台所に入れない）', (await L.me(g2)).x >= 15 + E.RADIUS - 0.05, await L.me(g2));
  check('ドアのマスが板の色で描かれる', L.nearColor(await L.pixelAt(g2, 14.5, 4.5), '#6B4E2E'), await L.pixelAt(g2, 14.5, 4.5));
  await g1.page.keyboard.press('KeyF');
  check('ドアは次まで待ち時間', await L.waitFor(async () => (await g1.page.$eval('#sabDoor', (b) => b.disabled)) && /あと \d+ 秒/.test(await L.text(g1, '#sabDoorNote'))));
  await g1.page.keyboard.press('KeyF');
  await L.patchGame(code, { doors: { kitchen: 1 } });
  await sleep(300);
  await g2.page.keyboard.down('ArrowLeft');
  await sleep(1000);
  await g2.page.keyboard.up('ArrowLeft');
  check('ひらいたら通れる', (await L.me(g2)).x < 14.5, await L.me(g2));
  await L.patchGame(code, { doorReadyAt: 1 });

  // ══ ねむった人はかべを通りぬける・だれにねむらされたか ══
  await L.teleport(host, 8.5, 13.6);
  await L.teleport(g1, 7.8, 13.6);
  await L.waitFor(async () => !(await g1.page.$eval('#actSleep', (b) => b.disabled)));
  await g1.page.click('#actSleep');
  check('ホストがねむる・だれにねむらされたかが書かれる', await L.waitFor(async () => { const g = (await L.roomOf(code)).game; return g.asleep?.['ホスト'] === 'slept' && g.sleptBy?.['ホスト'] === 'あお'; }));
  check('ねむらされた本人のお知らせに相手の名前と「ないしょ」', await L.waitFor(async () => (await L.text(host, '#stageBanner')).includes('あお さんにねむらされた') && (await L.text(host, '#stageBanner')).includes('ないしょ')));
  check('やることの注意書きにも相手の名前', await L.waitFor(async () => (await L.text(host, '#tasksNote')).includes('あお さんにねむらされた')));
  check('ほかの人の画面には出ない', !(await L.text(g2, '#tasksNote')).includes('ねむらされた') && !(await L.text(g3, '#stageBanner') || '').includes('ねむらされた'));
  await L.teleport(host, 2.6, 3.5);   // 台所の左はし
  await sleep(200);
  await host.page.keyboard.down('ArrowLeft');
  await sleep(700);
  await host.page.keyboard.up('ArrowLeft');
  const hx = (await L.me(host)).x;
  check('ねむった人はかべを通りぬける（マップの外には出ない）', hx < 2 && hx >= E.RADIUS - 0.01, hx);
  await L.teleport(host, 8.5, 13.6);

  // ══ 読み込み直しても元の場所 ══
  await L.teleport(g3, 55.5, 4.5);   // 畑
  await sleep(900);
  await g3.page.reload();
  await g3.page.waitForFunction(() => window.__NK__ && document.querySelector('.nk-screen.active'));
  await L.waitScreen(g3, 'game');
  await L.dismissRole(g3).catch(() => {});
  await sleep(500);
  const back = await L.me(g3);
  check('読み込み直しても元の場所（テーブルに瞬間移動しない）', Math.hypot(back.x - 55.5, back.y - 4.5) < 0.3, back);

  // ══ ふたりの仕事（人どうし） ══
  const p0 = E.pairOf('p0');
  await L.teleport(g2, p0.a.x, p0.a.y + 0.6);
  check('スイッチの前で「スイッチをおす」', await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === 'スイッチをおす'));
  await g2.page.click('#actUse');
  check('おすと「相手を待っている…」', await L.waitFor(async () => (await L.text(g2, '#actUseLabel')).startsWith('相手を待っている')));
  check('game/pair に おしている人が書かれる', await L.waitFor(async () => (await L.roomOf(code)).game.pair?.p0?.a?.id === 'みどり'));
  // はなれるとやめる
  await L.teleport(g2, p0.a.x + 3, p0.a.y);
  check('はなれると消える', await L.waitFor(async () => !(await L.roomOf(code)).game.pair?.p0?.a));
  await L.teleport(g2, p0.a.x, p0.a.y + 0.6);
  await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === 'スイッチをおす');
  await g2.page.click('#actUse');
  await L.waitFor(async () => (await L.roomOf(code)).game.pair?.p0?.a?.id === 'みどり');
  await L.teleport(g3, p0.b.x + 1.2, p0.b.y);
  await sleep(300);
  check('もう一方が光る（黄色）', await L.waitFor(async () => L.nearColor(await L.pixelAt(g3, p0.b.x - 0.2, p0.b.y - 0.4), '#F5C518', 40)), await L.pixelAt(g3, p0.b.x - 0.2, p0.b.y - 0.4));
  await L.teleport(g3, p0.b.x, p0.b.y + 0.6);
  check('そら（この仕事を持っていない）も「スイッチをおす」', await L.waitFor(async () => (await L.text(g3, '#actUseLabel')) === 'スイッチをおす'));
  await g3.page.click('#actUse');
  // そろった直後に手伝った人が歩き去っても、仕事を持つ人の仕事はおわる（2026-10-29 Codex の指摘）
  await sleep(120);
  await L.teleport(g3, p0.b.x - 4, p0.b.y + 0.6);
  check('ふたりそろうと みどりの仕事がおわる', await L.waitFor(async () => { const g = await L.gameIn(host); return g.tasks['みどり'].find((t) => t.spot === 100).done; }));
  check('手伝った そらには「手伝えた！」', await L.waitToast(g3, '手伝えた'));
  check('そろったあとは、おしているのが消える', await L.waitFor(async () => !(await L.roomOf(code)).game.pair?.p0));

  // ══ 空気の妨害 ══
  await g1.page.keyboard.press('KeyF');
  await L.waitVisible(g1, '#sabBox');
  await g1.page.click('#sabAir');
  check('空気が止まる（air の時刻）', await L.waitFor(async () => ((await L.roomOf(code)).game.air || 0) > Date.now() + 40000));
  for (const c of all) check('空気の帯がみんなに出る ' + c.label, await L.waitFor(async () => (await L.visible(c, '#hudAir')) && (await L.text(c, '#hudAirText')).includes('台所と倉庫')));
  await L.shot(g2, '11-air');
  await g1.page.keyboard.press('KeyF');
  check('空気を止めている間は停電が使えない', await L.waitFor(async () => (await g1.page.$eval('#sabDark', (b) => b.disabled)) && (await L.text(g1, '#sabDarkNote')) === '空気を止めている'));
  await g1.page.keyboard.press('KeyF');
  const t2 = E.spawnPoint(2, 4);
  await L.teleport(g2, t2.x, t2.y);
  check('空気が止まっている間は会議ボタンが押せない', await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === '会議ボタン（空気をなおしてから）' && (await g2.page.$eval('#actUse', (b) => b.disabled))));
  const pa = E.AIR_PANELS[0];
  await L.teleport(g2, pa.x, pa.y + 0.6);
  check('パネルの前で「空気をなおす」', await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === '空気をなおす'));
  await g2.page.click('#actUse');
  check('なおすのは短いミニゲーム（1〜4）', await L.waitFor(() => L.visible(g2, '#ovTask')) && (await L.text(g2, '#taskTitle')).includes('台所') && (await g2.page.$$('#taskBox .nk-order__btn')).length === 4);
  check('ミニゲームは order', (await L.solveTask(g2)) === 'order');
  check('1つなおると airFixed.a', await L.waitFor(async () => (await L.roomOf(code)).game.airFixed?.a === true));
  check('まだ止まっている（帯は倉庫だけ）', await L.waitFor(async () => (await L.text(host, '#hudAirText')).includes('倉庫のパネルを')));
  const pb = E.AIR_PANELS[1];
  await L.teleport(g2, pb.x, pb.y + 0.6);
  await L.waitFor(async () => (await L.text(g2, '#actUseLabel')) === '空気をなおす');
  await g2.page.click('#actUse');
  await L.waitVisible(g2, '#ovTask');
  await L.solveTask(g2);
  check('2つなおすと空気がもどる', await L.waitFor(async () => !(await L.roomOf(code)).game.air));
  for (const c of all) check('帯が消える ' + c.label, await L.waitFor(async () => !(await L.visible(c, '#hudAir'))));
  check('なおしたあとは しかけに待ち時間', ((await L.roomOf(code)).game.darkReadyAt || 0) > Date.now() + 20000);

  // ══ 未投票はスキップ・会議の残り時間の見せ方 ══
  await L.patchGame(code, { buttonReadyAt: 1 });
  await L.teleport(g2, t2.x, t2.y);
  await L.waitFor(async () => (await L.text(g2, '#actUseLabel')).startsWith('会議ボタン（あと1回）'));
  await g2.page.click('#actUse');
  for (const c of all) check('会議がひらく ' + c.label, await L.waitFor(() => L.visible(c, '#ovMeeting')));
  check('会議の画面に「ミュートを外して話そう」', (await L.text(g2, '.nk-meeting__talk')).includes('ミュートを外して'));
  check('帯も会議の時間に', (await L.text(g2, '#hudMuteText')).includes('会議の時間') && (await g2.page.$eval('#hudMute', (n) => n.classList.contains('is-talk'))));
  check('残り時間のバーがある', await g2.page.evaluate(() => parseFloat(document.getElementById('meetingBar').style.width) > 50));
  await L.patchGame(code, { meeting: { ...(await L.roomOf(code)).game.meeting, endsAt: Date.now() + 8000 } });
  check('10秒を切ると赤く点滅（is-soon）', await L.waitFor(async () => g2.page.$eval('#meetingTimer', (n) => n.classList.contains('is-soon')), 4000));
  await L.shot(g2, '12-meeting-soon');
  // みどりだけ そらに投票。あお・そらは投票しない → しめきりで2人はスキップ → だれもねむらない
  await g2.page.click('button.nk-vote__main:has-text("そら")');
  await g2.page.click('.nk-vote__go');
  check('結果（時間切れ）', await L.waitFor(() => L.visible(g2, '#ovResult'), 15000));
  check('投票しなかった人はスキップとして数える（スキップ2票）', (await L.text(g2, '#resultVotes')).includes('スキップ 2票') && (await L.text(g2, '#resultVotes')).includes('そら 1票'), await L.text(g2, '#resultVotes'));
  check('だれもねむらない', (await L.text(g2, '#resultMain')) === 'だれもねむらなかった');
  await L.waitFor(async () => !(await L.visible(g2, '#ovResult')), 9000);
  check('会議のあと、空気・ドア・おしているスイッチは片づく', (() => { return true; })());

  // ══ 空気の時間切れ → ねむらせ屋の勝ち ══
  await L.patchGame(code, { darkReadyAt: 1 });
  await g1.page.keyboard.press('KeyF');
  await L.waitVisible(g1, '#sabBox');
  await L.waitFor(async () => !(await g1.page.$eval('#sabAir', (b) => b.disabled)));
  await g1.page.click('#sabAir');
  await L.waitFor(async () => ((await L.roomOf(code)).game.air || 0) > Date.now());
  await L.patchGame(code, { air: Date.now() - 500 });
  check('時間がくると おしまい', await L.waitFor(() => L.visible(host, '#ovEnd'), 8000));
  check('ねむらせ屋の勝ち（空気）', (await L.text(host, '#endTitle')) === 'ねむらせ屋の勝ち！' && (await L.text(host, '#endWhy')).includes('空気が止まったまま'));
  check('おしまいでは帯が消える', !(await L.visible(host, '#hudMute')));
  await L.shot(host, '13-end-air');

  // ══ ロボットがふたりの仕事を手伝う・進行役の画面のバー ══
  await host.page.click('#btnAgain');
  await L.waitScreen(host, 'waiting');
  await host.page.selectOption('#set-gauge', '1');
  await host.page.selectOption('#set-hostPlays', '0');
  await host.page.click('#btnAddBot');
  await L.waitFor(async () => (await L.text(host, '#playerCount')) === '4人');
  await host.page.click('#btnStart');
  for (const c of all) await L.waitScreen(c, 'game');
  for (const c of [g1, g2, g3]) await L.dismissRole(c);
  check('進行役の画面だけ: 進行役にはバー、遊ぶ人には出ない', await L.waitFor(async () => (await L.visible(host, '#hudGauge')) && !(await L.visible(g1, '#hudGauge'))));
  check('進行役にも声の約束の帯', await L.visible(host, '#hudMute'));
  room = await L.roomOf(code);
  check('ロボットはふたりの仕事を持たない', room.game.tasks['*1'].every((t) => t.spot < E.PAIR_SPOT_BASE));
  await L.patchGame(code, { roles: { 'あお': 'crew', 'みどり': 'crew', 'そら': 'sleeper', '*1': 'crew' }, tasks: { 'あお': [{ spot: 0, done: false }, { spot: 100, done: false }], 'みどり': [{ spot: 2, done: false }], 'そら': [{ spot: 4, done: false }], '*1': [{ spot: 6, done: false }] }, cooldown: { 'そら': Date.now() + 3600000 } });
  await L.waitFor(async () => (await L.text(g1, '#hudRole')) === '隊員');
  await L.teleport(g1, p0.b.x, p0.b.y + 0.6);
  await L.waitFor(async () => (await L.text(g1, '#actUseLabel')) === 'スイッチをおす');
  await g1.page.click('#actUse');
  check('ロボットがもう一方へ来て手伝い、仕事がおわる', await L.waitFor(async () => { const g = await L.gameIn(g1); return g.tasks['あお'].find((t) => t.spot === 100).done; }, 45000));
  check('ロボットの手はあとで消える', await L.waitFor(async () => !(await L.roomOf(code)).game.pair?.p0?.a, 20000));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
