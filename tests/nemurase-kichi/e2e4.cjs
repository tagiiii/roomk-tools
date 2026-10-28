// その4: 途中で落ちた子が戻る（2026-10-28 オーナー決定）
// 切れても1分は待つ・抜けた人が同じ名前で戻ったら同じ役で続きから・のこりの仕事も数にもどる・
// 切れている間は本人の画面に「通信が切れています」・遊んでいる間は画面を消さない
const L = require('./lib.cjs');
const { E, check, sleep } = L;

(async () => {
  const server = await L.startServer();
  const browser = await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');
  const g2 = await L.newClient('g2');

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await L.joinRoom(g2, 'みどり', code);
  await host.page.click('#btnAddBot');
  await host.page.click('#btnAddBot');
  check('ロボット2つで5人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '5人'));
  await host.page.click('#btnStart');
  for (const c of [host, g1, g2]) await L.waitScreen(c, 'game');
  for (const c of [host, g1, g2]) await L.dismissRole(c);
  await L.patchGame(code, { roles: { 'ホスト': 'crew', 'あお': 'crew', 'みどり': 'crew', '*1': 'sleeper', '*2': 'crew' }, cooldown: { '*1': Date.now() + 3600000 }, darkReadyAt: Date.now() + 3600000 });
  await sleep(1500);

  // ══ 遊んでいる間は画面を消さない ══
  check('遊んでいる間は画面を消さない約束をする', await L.waitFor(() => g1.page.evaluate(() => window.__NK__.state.wakeWant === true)));

  // ══ タブを閉じて、同じブラウザの新しいタブから同じ名前で戻る ══
  await L.teleport(g2, 30.5, 16.5);
  await sleep(600);
  const ctx2 = g2.context;
  await g2.page.close();
  check('閉じた人の在室が消える', await L.waitFor(async () => !(await L.roomOf(code)).players?.['みどり'], 15000));
  const gBefore = await L.gameIn(g1);
  const tpBefore = E.taskProgress(gBefore);
  await sleep(35000);
  check('30秒では、まだ抜けた人にしない', !(await L.roomOf(code)).game.left?.['みどり']);
  check('1分たつと、抜けた人になる', await L.waitFor(async () => (await L.roomOf(code)).game.left?.['みどり'] === true, 40000));
  const gLeft = await L.gameIn(g1);
  const midoriLeft = gLeft.tasks['みどり'].filter((t) => !t.done).length;
  check('抜けた人の、のこりの仕事は全体の数から外れる', E.taskProgress(gLeft).total === tpBefore.total - midoriLeft, { before: tpBefore, after: E.taskProgress(gLeft) });

  const g2b = await L.newPage(ctx2, 'g2b');
  await L.joinRoom(g2b, 'みどり', code).catch(() => {});
  check('同じ名前で入りなおせる', await L.waitFor(async () => (await L.screen(g2b)) === 'game', 10000));
  check('戻ると抜けた人の印が外れる', await L.waitFor(async () => !(await L.roomOf(code)).game.left?.['みどり'], 10000));
  check('同じ役で続きから（役のお知らせが出る）', await L.waitFor(() => L.visible(g2b, '#ovRole')) && (await L.text(g2b, '#roleName')) === '隊員');
  check('「もどってきたね」と出る', await L.waitFor(async () => (await L.text(g2b, '#roleDesc')).includes('もどってきたね')));
  await L.dismissRole(g2b).catch(() => {});
  check('見学のお知らせは出ない', !(await L.visible(g2b, '#watchNote')));
  check('役の表示は隊員', (await L.text(g2b, '#hudRole')) === '隊員');
  // 位置はタブごとの保存（sessionStorage）なので、新しいタブからはテーブルのまわりから
  const gNow = await L.gameIn(g1);
  const sp = E.spawnPoint(gNow.players.indexOf('みどり'), gNow.players.length);
  check('新しいタブからは、テーブルのまわりから', await L.waitFor(async () => { const m = await L.me(g2b); return Math.abs(m.x - sp.x) < 0.3 && Math.abs(m.y - sp.y) < 0.3; }), { me: await L.me(g2b), sp });
  check('止まったままでも位置を送る', await L.waitFor(async () => !!(await L.rootOf(code)).p?.['みどり'], 8000));
  const gBack = await L.gameIn(g1);
  check('のこりの仕事が全体の数にもどる', E.taskProgress(gBack).total === tpBefore.total, { before: tpBefore, back: E.taskProgress(gBack) });
  check('みんなの仕事のバーの数ももどる', await L.waitFor(async () => (await L.text(g1, '#hudProgressNum')).endsWith('/ ' + tpBefore.total)));
  check('おきている人に数える', E.awakeOf(gBack).includes('みどり'));
  check('ほかの人の画面に、戻った人が見える位置で届く', await L.waitFor(() => g1.page.evaluate(() => !!window.__NK__.PA['みどり'])));
  check('戻った人のやることが出る', await L.waitFor(() => L.visible(g2b, '#taskList')));
  await L.shot(g2b, '40-returned');

  // ══ 同じタブのまま1分以上切れて、つながりなおす ══
  g1.offlineOk = true;
  await g1.page.evaluate(() => firebase.database().goOffline());
  check('切れると本人の画面に「通信が切れています」', await L.waitFor(() => L.visible(g1, '#hudOffline'), 6000));
  check('「通信が切れています」の文', (await L.text(g1, '#hudOffline')).includes('つながりなおしています'));
  await L.shot(g1, '41-offline');
  check('切れている間は歩けない', await (async () => {
    const a = await L.me(g1);
    await g1.page.keyboard.down('ArrowRight'); await sleep(600); await g1.page.keyboard.up('ArrowRight');
    const b = await L.me(g1);
    return Math.abs(b.x - a.x) < 0.01 && Math.abs(b.y - a.y) < 0.01;
  })());
  check('1分たつと、抜けた人になる（同じタブ）', await L.waitFor(async () => (await L.roomOf(code)).game.left?.['あお'] === true, 80000));
  await g1.page.evaluate(() => firebase.database().goOnline());
  check('つながると「通信が切れています」が消える', await L.waitFor(async () => !(await L.visible(g1, '#hudOffline')), 10000));
  check('つながると抜けた人の印が外れる', await L.waitFor(async () => !(await L.roomOf(code)).game.left?.['あお'], 10000));
  check('同じタブでも「もどってきたね」', await L.waitFor(async () => (await L.text(g1, '#roleDesc')).includes('もどってきたね')));
  await L.dismissRole(g1).catch(() => {});
  check('同じタブで戻ると、止まったままでも位置を送る', await L.waitFor(async () => !!(await L.rootOf(code)).p?.['あお'], 8000));
  check('同じタブで戻ると歩ける', await (async () => {
    const a = await L.me(g1);
    await g1.page.keyboard.down('ArrowRight'); await sleep(500); await g1.page.keyboard.up('ArrowRight');
    const b = await L.me(g1);
    return Math.abs(b.x - a.x) > 0.1 || Math.abs(b.y - a.y) > 0.1;
  })());

  // ══ 一瞬の切れでは「通信が切れています」を出さない ══
  await g1.page.evaluate(() => firebase.database().goOffline());
  await sleep(600);
  await g1.page.evaluate(() => firebase.database().goOnline());
  await sleep(2500);
  check('一瞬の切れでは出さない', !(await L.visible(g1, '#hudOffline')));

  // ══ ねむっている人が抜けて戻ると、ねむったまま ══
  await L.patchGame(code, { asleep: { 'みどり': 'slept' } });
  await sleep(1000);
  await g2b.page.close();
  check('ねむった人の在室が消える', await L.waitFor(async () => !(await L.roomOf(code)).players?.['みどり'], 15000));
  check('ねむった人も1分で抜けた人になる', await L.waitFor(async () => (await L.roomOf(code)).game.left?.['みどり'] === true, 80000));
  const g2c = await L.newPage(ctx2, 'g2c');
  await L.joinRoom(g2c, 'みどり', code).catch(() => {});
  check('ねむった人も戻れる', await L.waitFor(async () => !(await L.roomOf(code)).game.left?.['みどり'], 10000));
  check('ねむったまま戻ると「ねむったまま、つづきから」', await L.waitFor(async () => (await L.text(g2c, '#roleDesc')).includes('ねむったまま')), await L.text(g2c, '#roleDesc'));
  await L.dismissRole(g2c).catch(() => {});
  const gSleep = await L.gameIn(g1);
  check('戻ってもねむったまま', !E.isAwake(gSleep, 'みどり'));
  check('ねむった人の位置は g に送る', await L.waitFor(async () => { const r = await L.rootOf(code); return !!r.g?.['みどり'] && !r.p?.['みどり']; }, 8000));

  // ══ 会議の間に戻ると、会議のあと遊ぶ時間になってからお知らせを出す ══
  // （在室のあるまま抜けた人の印だけをつけ、会議をひらいて、ホストの端末が会議の間に戻すのを見る）
  const gM = await L.gameIn(g1);
  const seqM = gM.meetingSeq + 1;
  await L.patchGame(code, { stage: 'meeting', meetingSeq: seqM, meeting: { seq: seqM, why: 'button', caller: 'ホスト', endsAt: Date.now() + 6000, votes: {} }, left: { 'あお': true } });
  // ロボットの票はくじなので、スキップにそろえる（たまたまねむらせ屋に入ってゲームがおわらないように）
  await L.rest('PATCH', L.ROOMS + '/' + code + '/r/game/ballots/' + seqM, { '*1': '*skip', '*2': '*skip' });
  check('会議の間でも戻る', await L.waitFor(async () => !(await L.roomOf(code)).game.left?.['あお'], 8000));
  await sleep(800);
  check('会議の間は役のお知らせを出さない', !(await L.visible(g1, '#ovRole')));
  check('会議のあと、遊ぶ時間になってから役のお知らせ', await L.waitFor(async () => (await L.visible(g1, '#ovRole')) && (await L.roomOf(code)).game.stage === 'play', 25000));
  check('会議のあとに「もどってきたね」', (await L.text(g1, '#roleDesc')).includes('もどってきたね'));
  await L.dismissRole(g1).catch(() => {});

  // ══ 勝ち負けが決まったあとは戻さない ══
  await g2c.page.close();
  check('閉じた人の在室が消える（3回目）', await L.waitFor(async () => !(await L.roomOf(code)).players?.['みどり'], 15000));
  await L.patchGame(code, { stage: 'end', winner: 'crew', winReason: 'tasks', ended: true, left: { 'みどり': true } });
  const g2d = await L.newPage(ctx2, 'g2d');
  await L.joinRoom(g2d, 'みどり', code).catch(() => {});
  await sleep(3000);
  check('おしまいのあとは抜けた人の印を外さない', (await L.roomOf(code)).game.left?.['みどり'] === true);
  check('おしまいになると画面を消さない約束を外す', await L.waitFor(() => g1.page.evaluate(() => window.__NK__.state.wakeWant === false)));

  // ══ 別の端末（別の匿名ID）からは、同じ名前で入れない（これまでどおり） ══
  await host.page.click('#btnAgain').catch(() => {});
  await L.waitFor(async () => (await L.roomOf(code)).status === 'waiting', 8000);

  let phoneWake = false;
  let phoneRef = null;
  check('幅375pxでも「通信が切れています」が画面に収まる', await (async () => {
    const phone = await L.newClient('phone', { viewport: { width: 375, height: 740 } });
    await phone.page.addInitScript(() => {
      window.__wl = { req: 0, active: 0 };
      const wl = { request: async () => {
        window.__wl.req += 1; window.__wl.active += 1;
        await new Promise((r) => setTimeout(r, 50));
        const t = new EventTarget();
        let done = false;
        t.release = async () => { if (done) return; done = true; window.__wl.active -= 1; t.dispatchEvent(new Event('release')); };
        return t;
      } };
      Object.defineProperty(navigator, 'wakeLock', { value: wl, configurable: true });
    });
    await L.joinRoom(phone, 'きいろ', code);
    await host.page.click('#btnStart');
    await L.waitScreen(phone, 'game');
    await L.dismissRole(phone).catch(() => {});
    phoneWake = await L.waitFor(() => phone.page.evaluate(() => window.__wl.active === 1 && window.__wl.req === 1));
    phoneRef = phone;
    phone.offlineOk = true;
    await phone.page.evaluate(() => firebase.database().goOffline());
    await L.waitFor(() => L.visible(phone, '#hudOffline'), 6000);
    await L.shot(phone, '42-offline-375');
    const ok = (await L.overflow(phone)) <= 0 && await phone.page.evaluate(() => { const r = document.getElementById('hudOffline').getBoundingClientRect(); return r.right <= window.innerWidth && r.left >= 0; });
    await phone.page.evaluate(() => firebase.database().goOnline());
    return ok;
  })());
  check('遊んでいる間は画面を消さない約束を1つだけ取る', phoneWake, phoneRef && await phoneRef.page.evaluate(() => window.__wl));
  await L.waitFor(async () => !(await L.visible(phoneRef, '#hudOffline')), 10000);
  await phoneRef.page.click('#btnMenu');
  await phoneRef.page.click('#btnMenuLeave');
  check('退出すると画面を消さない約束を外す', await L.waitFor(() => phoneRef.page.evaluate(() => window.__wl.active === 0)), await phoneRef.page.evaluate(() => window.__wl));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
