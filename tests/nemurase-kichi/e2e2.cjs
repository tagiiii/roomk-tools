// その2: 進行だけのホスト・ロボット・途中から入った人（見学）・読み込み直し・ウィンドウを閉じた人・
//        ホストの切断と戻り・会議の途中の時間切れ
const L = require('./lib.cjs');
const { E, check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');
  const g2 = await L.newClient('g2');

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await L.joinRoom(g2, 'みどり', code);

  // ══ 進行だけのホスト＋ロボット ══
  await host.page.selectOption('#set-hostPlays', '0');
  check('進行だけにすると、遊ぶ人の数からホストが外れる', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '2人'));
  check('一覧に「ホスト・進行役」', await L.waitFor(async () => (await L.text(g1, '#lobbyPeople')).includes('ホスト・進行役')));
  check('遊ぶ人が4人いないと、はじめられない', await host.page.$eval('#btnStart', (b) => b.disabled));
  await host.page.click('#btnAddBot');
  await host.page.click('#btnAddBot');
  check('ロボット2つで4人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '4人'));
  await host.page.click('#btnStart');
  for (const c of [host, g1, g2]) await L.waitScreen(c, 'game');
  check('進行役の画面（お知らせ）', await L.waitFor(() => L.visible(host, '#watchNote')));
  check('進行役には役のお知らせが出ない', !(await L.visible(host, '#ovRole')));
  check('進行役の表示', (await L.text(host, '#hudRole')) === '進行役');
  check('進行役の画面にメンター向けの説明を出さない', !(await L.text(host, '#watchNote')).includes('画面共有'));
  check('進行役には操作ボタン・やることが出ない', !(await L.visible(host, '#actUse')) && !(await L.visible(host, '#taskList')));
  let room = await L.roomOf(code);
  check('進行役はゲームの人数に入らない', room.game.players.length === 4 && !room.game.players.includes('ホスト'));
  check('進行役は players-4（ホストを数えない）', await L.waitStats(host, 'players-4', 1));
  for (const c of [g1, g2]) await L.dismissRole(c);
  await L.patchGame(code, { roles: { 'あお': 'crew', 'みどり': 'crew', '*1': 'sleeper', '*2': 'crew' }, cooldown: { '*1': Date.now() + 600000 } });
  await sleep(6000);
  const root = await L.rootOf(code);
  check('ロボットが歩いて位置を送る', !!root.p?.['*2'] && !!E.decodePos(root.p['*2']), root.p);
  await L.shot(host, '10-facilitator');

  // ══ 途中から入った人は見学 ══
  const late = await L.newClient('late');
  await L.joinRoom(late, 'おそい', code).catch(() => {});
  await L.waitScreen(late, 'game');
  check('途中から入った人は見学（次の回から）', await L.waitFor(async () => (await L.visible(late, '#watchNote')) && (await L.text(late, '#watchNote')).includes('次の回から')));
  const ls = await L.subs(late);
  check('見学の人は位置を受け取らない', ls.p === false && ls.g === false, ls);
  check('見学の人には操作ボタンが出ない', !(await L.visible(late, '#actUse')));

  // ══ 読み込み直すと、同じ役で続きから ══
  await L.teleport(g2, 30.5, 16.5);
  await sleep(500);
  await g2.page.reload();
  await g2.page.waitForFunction(() => window.__NK__ && document.querySelector('.nk-screen.active'));
  await L.waitScreen(g2, 'game');
  await L.dismissRole(g2).catch(() => {});
  check('読み込み直しても同じ役', (await L.text(g2, '#hudRole')) === '隊員');
  check('読み込み直した人は、在室に戻る', await L.waitFor(async () => !!(await L.roomOf(code)).players?.['みどり']));
  check('読み込み直した人は見学にならない', !(await L.visible(g2, '#watchNote')));
  check('読み込み直した人の位置がまた届く', await L.waitFor(async () => !!(await L.rootOf(code)).p?.['みどり']));

  // ══ 会議と、進行役のしめきり ══
  const t0 = E.spawnPoint(0, 4);
  await L.teleport(g1, t0.x, t0.y);
  await L.waitFor(async () => (await L.text(g1, '#actUseLabel')).startsWith('会議ボタン'));
  await g1.page.click('#actUse');
  check('進行役にも会議', await L.waitFor(() => L.visible(host, '#ovMeeting')));
  check('進行役は投票しない', (await L.text(host, '#meetingHow')).includes('進行役は投票しない'));
  check('見学の人にも会議が出る', await L.waitFor(() => L.visible(late, '#ovMeeting')));
  check('ロボットも投票する（票は会議の番号の下に1つずつ）', await L.waitFor(async () => {
    const g = (await L.roomOf(code)).game;
    const seq = g.meeting?.seq;
    return !!seq && Object.keys(g.ballots?.[seq] || {}).some((k) => k.startsWith('*'));
  }, 15000));
  // ロボットの票はくじなので、しめきる前にスキップにそろえる（たまたまねむらせ屋に入ってゲームがおわらないように）
  await L.rest('PATCH', L.ROOMS + '/' + code + '/r/game/ballots/' + (await L.roomOf(code)).game.meeting.seq, { '*1': '*skip', '*2': '*skip' });
  await host.page.click('#btnCloseVote');
  check('進行役がしめきると結果', await L.waitFor(() => L.visible(g1, '#ovResult')));
  check('結果のあとゲームにもどる', await L.waitFor(async () => !(await L.visible(g1, '#ovResult')), 9000));
  await L.patchGame(code, { cooldown: { '*1': Date.now() + 3600000 } });

  // ══ ウィンドウを閉じた人は、会議の投票を待たない ══
  await late.page.close();
  await g2.context.close();
  check('閉じた人の在室が消える', await L.waitFor(async () => !(await L.roomOf(code)).players?.['みどり'], 15000));
  check('閉じた人の位置が消える', await L.waitFor(async () => !(await L.rootOf(code)).p?.['みどり'], 15000));
  // 30秒たっても戻らなければ、抜けた人として勝ち負けの判定と、のこりの仕事の数から外す
  const gBefore = await L.gameIn(g1);
  const tpBefore = E.taskProgress(gBefore);
  const midoriLeft = gBefore.tasks['みどり'].filter((t) => !t.done).length;
  check('閉じてすぐは、まだ抜けたことにしない', !gBefore.left['みどり']);
  const leftOk = await L.waitFor(async () => (await L.roomOf(code)).game.left?.['みどり'] === true, 45000);
  const rNow = await L.roomOf(code);
  check('30秒たつと、抜けた人になる', leftOk, { stage: rNow.game.stage, winner: rNow.game.winner, reason: rNow.game.winReason, asleep: rNow.game.asleep, players: Object.keys(rNow.players || {}), hostConnected: rNow.hostConnected, hostScreen: await L.screen(host), hostAway: await host.page.evaluate(() => window.__NK__.state.awaySince) });
  const gAfter = await L.gameIn(g1);
  check('抜けた人の、のこりの仕事は全体の数から外れる', E.taskProgress(gAfter).total === tpBefore.total - midoriLeft, { before: tpBefore, after: E.taskProgress(gAfter), midoriLeft });
  check('みんなの仕事のバーの数も変わる', await L.waitFor(async () => (await L.text(g1, '#hudProgressNum')).endsWith('/ ' + E.taskProgress(gAfter).total)));
  check('抜けた人は、おきている人に数えない', !E.awakeOf(gAfter).includes('みどり'));
  // ロボットのねむらせ屋は、会議のあとに待ち時間が設定の値へ戻るので、テストの間はねむらせないようにしておく
  await L.patchGame(code, { buttons: { 'あお': 1 }, cooldown: { '*1': Date.now() + 3600000 }, asleep: {} });
  await L.teleport(g1, t0.x, t0.y);
  await L.waitFor(async () => (await L.text(g1, '#actUseLabel')).startsWith('会議ボタン（あと1回）'));
  await g1.page.click('#actUse');
  await L.waitFor(() => L.visible(g1, '#ovMeeting'));
  check('抜けた人に「抜けた」（投票できない）', await L.waitFor(async () => (await L.text(g1, '#meetingPeople')).includes('抜けた')));
  check('抜けた人は投票の相手に選べない', !(await g1.page.$('button.nk-vote__main:has-text("みどり")')));
  check('投票の数は、抜けた人をのぞいた人数', /\/ 3$/.test(await L.text(g1, '#meetingCount')), await L.text(g1, '#meetingCount'));
  // ロボットの票はくじなので、ここではテストの側でスキップにしておく（たまたま票が集まってゲームがおわらないように）
  const seqNow = (await L.roomOf(code)).game.meeting.seq;
  await L.rest('PATCH', L.ROOMS + '/' + code + '/r/game/ballots/' + seqNow, { '*1': '*skip', '*2': '*skip' });
  await g1.page.click('#btnVoteSkip');
  check('閉じた人の票を待たずに結果', await L.waitFor(() => L.visible(g1, '#ovResult'), 16000));
  check('だれもねむらない（みんなスキップ）', (await L.text(g1, '#resultMain')) === 'だれもねむらなかった');
  await L.waitFor(async () => !(await L.visible(g1, '#ovResult')), 9000);
  await L.patchGame(code, { cooldown: { '*1': Date.now() + 3600000 } });

  // ══ ホストの切断と戻り ══
  host.offlineOk = true;
  await host.page.evaluate(() => firebase.database().goOffline());
  check('ホストが切れると参加者にお知らせ', await L.waitFor(() => L.visible(g1, '#hostOffOverlay'), 15000));
  check('ルームに hostConnected:false', (await L.roomOf(code)).hostConnected === false);
  await host.page.evaluate(() => firebase.database().goOnline());
  check('ホストが戻るとお知らせが消える', await L.waitFor(async () => !(await L.visible(g1, '#hostOffOverlay')), 10000));
  // ホストの読み込み直し（同じタブ）: 進行役の画面に戻る
  await host.page.reload();
  await host.page.waitForFunction(() => window.__NK__ && document.querySelector('.nk-screen.active'));
  check('ホストが読み込み直すとゲームの画面（進行役）', await L.waitFor(async () => (await L.screen(host)) === 'game' && (await L.text(host, '#hudRole')) === '進行役'));

  // ══ 参加者が短く切れて戻る: 止まったままでも位置を送り直す ══
  g1.offlineOk = true;
  await sleep(800);
  const rootNow = await L.rootOf(code);
  check('切れる前は位置がある', !!rootNow.p?.['あお'], { p: Object.keys(rootNow.p || {}), g: Object.keys(rootNow.g || {}), asleep: rootNow.r.game.asleep, stage: rootNow.r.game.stage, left: rootNow.r.game.left, sub: await L.subs(g1), me: await L.me(g1) });
  await g1.page.evaluate(() => firebase.database().goOffline());
  check('切れると位置が消える', await L.waitFor(async () => !(await L.rootOf(code)).p?.['あお'], 15000));
  await g1.page.evaluate(() => firebase.database().goOnline());
  check('戻ると、止まったままでも位置を送り直す', await L.waitFor(async () => !!(await L.rootOf(code)).p?.['あお'], 10000));
  check('戻ると在室も戻る', await L.waitFor(async () => !!(await L.roomOf(code)).players?.['あお']));

  // ══ 会議の途中で時間切れ → 結果を見せてから引き分け ══
  // ロボットのねむらせ屋は、会議のあとに待ち時間が設定の値へ戻るので、テストの間はねむらせないようにしておく
  await L.patchGame(code, { buttons: { 'あお': 1 }, cooldown: { '*1': Date.now() + 3600000 }, asleep: {} });
  await L.teleport(g1, t0.x, t0.y);
  await L.waitFor(async () => (await L.text(g1, '#actUseLabel')).startsWith('会議ボタン（あと1回）'));
  await g1.page.click('#actUse');
  await L.waitFor(() => L.visible(g1, '#ovMeeting'));
  await L.patchGame(code, { endsAt: Date.now() - 1000 });
  await sleep(2000);
  check('会議の途中では時間切れにしない', await L.visible(g1, '#ovMeeting'));
  // ロボットの票はくじなので、しめきる前にスキップにそろえる（たまたまねむらせ屋に入ってゲームがおわらないように）
  await L.rest('PATCH', L.ROOMS + '/' + code + '/r/game/ballots/' + (await L.roomOf(code)).game.meeting.seq, { '*1': '*skip', '*2': '*skip' });
  await host.page.click('#btnCloseVote');
  check('時間切れでも会議の結果は見せる', await L.waitFor(() => L.visible(g1, '#ovResult')));
  check('結果のあとで時間切れのおしまい', await L.waitFor(() => L.visible(g1, '#ovEnd'), 10000));
  check('時間切れは引き分け', (await L.text(g1, '#endTitle')) === '時間切れ！ 引き分け');
  const fin = await Promise.all([host, g1].map((c) => L.stats(c, 'finish')));
  check('finish はだれか1台で1回', fin.reduce((a, b) => a + b, 0) === 1, fin);

  // ══ 退出 ══
  await host.page.click('#btnAgain');
  await L.waitScreen(g1, 'waiting');
  await g1.page.click('#btnLeave');
  check('退出するとトップ', await L.waitFor(async () => (await L.screen(g1)) === 'top'));
  check('退出した人の在室が消える', await L.waitFor(async () => !(await L.roomOf(code)).players?.['あお']));

  // ══ ロボットが歩いている途中でルームを閉じても、位置が残らない ══
  const g4 = await L.newClient('g4');
  await L.joinRoom(g4, 'ひかり', code);
  await host.page.click('#btnAddBot');
  await L.waitFor(async () => !(await host.page.$eval('#btnStart', (b) => b.disabled)));
  await host.page.click('#btnStart');
  await L.waitScreen(g4, 'game');
  await L.dismissRole(g4);
  // ねむらせ屋が退出すると、ねむらせ屋がいなくなって隊員の勝ち
  await L.patchGame(code, { roles: { 'ひかり': 'sleeper', '*1': 'crew', '*2': 'crew', '*3': 'crew' } });
  await L.waitFor(async () => (await L.text(g4, '#hudRole')) === 'ねむらせ屋');
  await g4.page.click('#btnMenu');
  await g4.page.click('#btnMenuLeave');
  check('退出するとトップ（ゲームの途中）', await L.waitFor(async () => (await L.screen(g4)) === 'top'));
  check('退出した人はすぐ抜けた人になる', await L.waitFor(async () => (await L.roomOf(code)).game.left?.['ひかり'] === true));
  check('ねむらせ屋が抜けると、おしまい', await L.waitFor(() => L.visible(host, '#ovEnd')));
  check('隊員の勝ち・理由は「ねむらせ屋がいなくなった」', (await L.text(host, '#endTitle')) === '隊員の勝ち！' && (await L.text(host, '#endWhy')) === 'ねむらせ屋がいなくなった');
  check('おしまいの一覧に「途中で抜けた」', (await L.text(host, '#endPeople')).includes('途中で抜けた'));
  // ロボットが歩いている途中でルームを閉じる
  await host.page.click('#btnAgain');
  await L.waitScreen(host, 'waiting');
  await host.page.click('#btnAddBot');
  await L.waitFor(async () => !(await host.page.$eval('#btnStart', (b) => b.disabled)));
  await host.page.click('#btnStart');
  await L.waitScreen(host, 'game');
  await sleep(4000);
  check('ロボットが位置を送っている', Object.keys((await L.rootOf(code)).p || {}).some((k) => k.startsWith('*')));
  await host.page.click('#btnMenu');
  await host.page.click('#btnMenuLeave');
  check('ホストはトップへ', await L.waitFor(async () => (await L.screen(host)) === 'top'));
  await sleep(2000);
  check('ルームを閉じたあと、位置もふくめて何も残らない', (await L.rootOf(code)) === null, await L.rootOf(code));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
