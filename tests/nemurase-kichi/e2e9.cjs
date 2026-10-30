// その9: 見える広さの倍率（2026-10-30 子どもの要望「隊員とねむらせ屋、それぞれ視野の広さを選べるように」）
// 待合室の設定（0.5〜4倍・はじめは1倍・参加者に届く・要約）・ゲームの中の見える広さ（隊員・ねむらせ屋・停電中）・暗がりの大きさ（canvas の色）
const L = require('./lib.cjs');
const { E, check, sleep } = L;

const vr = (c) => c.page.evaluate(() => window.__NK__.viewRadius(window.__NK__.gameOf(window.__NK__.state.room)));
const near = (a, b) => Math.abs(a - b) < 1e-9;
const bright = (px) => px.some((v) => v > 150);
const dark = (px) => px.every((v) => v < 70);

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await host.page.click('#btnAddBot');
  await host.page.click('#btnAddBot');
  check('ロボット2つで4人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '4人'));

  // ══ 待合室の設定 ══
  const opts = await host.page.$$eval('#set-visCrew option', (n) => n.map((o) => o.textContent));
  check('隊員の見える広さ: 0.5〜4倍の15こ', opts.length === 15 && opts[0] === '0.5倍' && opts[2] === '1倍（ふつう）' && opts[14] === '4倍', opts);
  check('ねむらせ屋の見える広さも同じ選び方', (await host.page.$$eval('#set-visSleeper option', (n) => n.map((o) => o.textContent))).join() === opts.join());
  check('はじめは1倍（ふつう）', (await host.page.$eval('#set-visCrew', (s) => s.value)) === '1' && (await L.text(g1, '#set-visSleeper')) === '1倍（ふつう）');
  check('説明の1行（隊員）', (await host.page.$eval('#set-visCrew', (s) => s.closest('.nk-setting').querySelector('.nk-setting__desc').textContent)).includes('停電中の広さも同じ倍率'));
  check('はじめのままなら要約に出さない', !(await L.text(host, '#startSummary')).includes('見える広さ'));
  await host.page.selectOption('#set-visCrew', '0.5');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.visCrew === 0.5);
  await host.page.selectOption('#set-visSleeper', '2');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.visSleeper === 2);
  check('参加者に届く', await L.waitFor(async () => (await L.text(g1, '#set-visCrew')) === '0.5倍' && (await L.text(g1, '#set-visSleeper')) === '2倍'));
  check('要約に見える広さ（参加者にも）', await L.waitFor(async () => (await L.text(g1, '#startSummary')).endsWith('・見える広さ（隊員0.5倍・ねむらせ屋2倍）')), await L.text(g1, '#startSummary'));
  check('変えた2つに印', (await host.page.$$eval('.nk-setting.is-changed select', (n) => n.map((x) => x.id).filter((id) => id.startsWith('set-vis')))).sort().join() === 'set-visCrew,set-visSleeper');

  // ══ ゲームの中 ══
  await host.page.click('#btnStart');
  for (const c of [host, g1]) await L.waitScreen(c, 'game');
  let room = await L.roomOf(code);
  check('ゲームに倍率が入る', room.game.settings.visCrew === 0.5 && room.game.settings.visSleeper === 2, room.game.settings);
  for (const c of [host, g1]) await L.dismissRole(c);
  await L.patchGame(code, {
    roles: { 'ホスト': 'crew', 'あお': 'sleeper', '*1': 'crew', '*2': 'crew' },
    cooldown: { 'あお': Date.now() + 3600000 }, darkReadyAt: Date.now() + 3600000, buttonReadyAt: Date.now() + 3600000,
  });
  check('隊員の見える広さは 5.5×0.5', await L.waitFor(async () => near(await vr(host), E.VIEW.crew * 0.5)), await vr(host));
  check('ねむらせ屋の見える広さは 7.5×2', await L.waitFor(async () => near(await vr(g1), E.VIEW.sleeper * 2)), await vr(g1));

  // 畑の横に長い床（右へ7マス、かべも置き物もない）で、暗がりの大きさを色で確かめる
  const at = { x: 61.5, y: 5.5 };
  for (let d = 0; d <= 7; d++) check('床がつづく ' + d, E.isFloor(Math.floor(at.x + d), Math.floor(at.y)) && E.canSee(at, { x: at.x + d, y: at.y + 0.6 }));
  await L.teleport(host, at.x, at.y);
  await L.teleport(g1, at.x, at.y);
  await sleep(500);
  check('隊員 0.5倍: 1マス先は明るい', bright(await L.pixelAt(host, at.x + 1, at.y)), await L.pixelAt(host, at.x + 1, at.y));
  check('隊員 0.5倍: 3.5マス先は暗がり', dark(await L.pixelAt(host, at.x + 3.5, at.y)), await L.pixelAt(host, at.x + 3.5, at.y));
  await L.shot(host, '90-vis-crew-0.5');
  check('ねむらせ屋 2倍: 6マス先も明るい', bright(await L.pixelAt(g1, at.x + 6, at.y)), await L.pixelAt(g1, at.x + 6, at.y));
  await L.shot(g1, '91-vis-sleeper-2');

  // 遊んでいる途中の倍率を書きかえて、同じ場所の明るさが変わるのを確かめる（ふつうは待合室でしか変えない）
  const setVis = async (crew, sleeper) => {
    room = await L.roomOf(code);
    await L.patchGame(code, { settings: { ...room.game.settings, visCrew: crew, visSleeper: sleeper } });
    await L.waitFor(async () => near(await vr(host), E.VIEW.crew * crew));
    await sleep(300);
  };
  await setVis(1, 0.5);
  check('隊員 1倍（ふつう）: 3.5マス先は明るい', bright(await L.pixelAt(host, at.x + 3.5, at.y)), await L.pixelAt(host, at.x + 3.5, at.y));
  check('隊員 1倍: 7マス先は暗がり', dark(await L.pixelAt(host, at.x + 7, at.y)), await L.pixelAt(host, at.x + 7, at.y));
  check('ねむらせ屋 0.5倍: 6マス先は暗がり', await L.waitFor(async () => dark(await L.pixelAt(g1, at.x + 6, at.y))), await L.pixelAt(g1, at.x + 6, at.y));
  await setVis(4, 0.5);
  check('隊員 4倍: 7マス先も明るい', bright(await L.pixelAt(host, at.x + 7, at.y)), await L.pixelAt(host, at.x + 7, at.y));
  await L.shot(host, '92-vis-crew-4');

  // ══ 停電中 ══
  await setVis(2, 1);
  await L.patchGame(code, { dark: true });
  check('停電中の隊員は 2.4×2（隊員の倍率をかける）', await L.waitFor(async () => near(await vr(host), E.VIEW.dark * 2)), await vr(host));
  check('停電中もねむらせ屋は 7.5×1', near(await vr(g1), E.VIEW.sleeper), await vr(g1));
  await L.patchGame(code, { dark: false });
  check('停電がなおると 5.5×2', await L.waitFor(async () => near(await vr(host), E.VIEW.crew * 2)), await vr(host));

  // ══ 倍率のない部屋（前の版で作った部屋）は1倍 ══
  room = await L.roomOf(code);
  const old = { ...room.game.settings };
  delete old.visCrew;
  delete old.visSleeper;
  await L.patchGame(code, { settings: old });
  check('倍率がなければ隊員は1倍', await L.waitFor(async () => near(await vr(host), E.VIEW.crew)), await vr(host));
  check('倍率がなければねむらせ屋は1倍', await L.waitFor(async () => near(await vr(g1), E.VIEW.sleeper)), await vr(g1));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
