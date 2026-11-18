// のりあいロード E2E その5: タイムアタック（はじめはオフ・ホストがオンにする・時計・クリアのタイムを両方の画面に・
// いちばん速いタイム（速くなったとき・遅かったとき）・オフにもどす・1台のパソコンで遊ぶ）
const L = require('./lib.cjs');
const { check, sleep, until, st } = L;

// 全員をゴールのとびらに入れる（ホストは1番、参加者は2番を、自分の画面で動かす）
async function allIn(host, guest) {
  const put = (s, E, seat) => { const me = s.world.players[seat - 1]; const d = s.world.door; me.x = d.x + 0.2; me.y = 10 - 0.9; me.vy = 0; me.ground = null; return 1; };
  await st(host, put, 1);
  await st(guest, put, 2);
}
async function startStage(host, guest) {
  await host.page.waitForFunction(() => !document.querySelector('#btnStartGame').disabled);
  await host.page.click('#btnStartGame');
  await L.waitScreen(guest, 'game');
  await L.waitScreen(host, 'game');
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const host = await L.newClient('host');
    const guest = await L.newClient('guest');
    await L.open(host);
    await L.open(guest);
    const code = await L.createRoom(host, 'ホスト');
    await L.joinRoom(guest, 'ゲスト', code);
    await L.waitScreen(guest, 'waiting');
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(2)'); // カギのいらないとびら
    await L.roomWhen(code, (r) => r.set.stage === 1);

    // はじめはオフ。ホストだけがえらべる
    check('はじめはオフ', (await host.page.isChecked('#timerOn')) === false);
    check('タイムアタックのチェックはホストだけ', (await L.visible(host, '#timerBox')) && !(await L.visible(guest, '#timerBox')));
    check('オフの間、参加者に知らせは出ない', !(await L.visible(guest, '#lobbyTimerNote')));
    await host.page.check('#timerOn');
    const r1 = await L.roomWhen(code, (r) => r.set.timer === true);
    check('オンにすると set.timer', r1.set.timer === true, r1.set);
    await L.waitVisible(guest, '#lobbyTimerNote');
    check('参加者の待合室に「タイムアタック」の知らせ', (await L.text(guest, '#lobbyTimerNote')).includes('タイムアタック'));
    await L.shot(host, 'timer-01-lobby-host');

    // はじめる → 時計
    await startStage(host, guest);
    const g1 = await L.roomWhen(code, (r) => r.game && r.game.timer === true && typeof r.game.startedAt === 'number');
    check('ステージに timer と startedAt（サーバーの時刻）', g1.game.timer === true && Math.abs(g1.game.startedAt - Date.now()) < 60000, g1.game);
    await L.waitVisible(guest, '#timeLine');
    check('両方の画面に時計', (await L.visible(host, '#timeLine')) && (await L.visible(guest, '#timeLine')));
    const t0 = await L.text(guest, '#timeLine');
    await sleep(2200);
    const t1 = await L.text(guest, '#timeLine');
    check('時計が進む（1秒ごと）', /^タイム 0:0\d$/.test(t0) && /^タイム 0:0\d$/.test(t1) && t1 > t0, [t0, t1]);
    check('timer を数える', (await L.stats(host, 'timer')) === 1);

    // クリア → タイムを両方に
    await allIn(host, guest);
    const g2 = await L.roomWhen(code, (r) => typeof r.game.clearMs === 'number');
    const ms1 = g2.game.clearMs;
    check('クリアまでの時間をホストが書く', ms1 >= 2000 && ms1 < 30000, g2.game);
    check('いちばん速いタイムを覚える', g2.best && g2.best[1] === ms1, g2.best);
    await L.waitVisible(guest, '#clearTime');
    const fmt = (ms) => Math.floor(ms / 60000) + ':' + String(Math.floor((ms % 60000) / 1000)).padStart(2, '0') + '.' + Math.floor((ms % 1000) / 100);
    const want = 'クリアまでのタイム ' + fmt(ms1);
    check('両方のクリアの札にタイム（同じ値）', (await L.text(host, '#clearTime')).startsWith(want) && (await L.text(guest, '#clearTime')).startsWith(want), [want, await L.text(guest, '#clearTime')]);
    check('はじめてのクリアは、いちばん速いの行を出さない', (await L.text(guest, '#clearTime')) === want);
    check('止まった時計もクリアのタイム', (await L.text(guest, '#timeLine')) === 'タイム ' + fmt(ms1), await L.text(guest, '#timeLine'));
    await sleep(1200);
    check('クリアのあと、時計は進まない', (await L.text(host, '#timeLine')) === 'タイム ' + fmt(ms1));
    await L.shot(guest, 'timer-02-clear-guest');

    // もう一回（速くなったとき）: 前のいちばん速いタイムを遅くしておく
    await host.page.click('#btnAgain');
    await L.roomWhen(code, (r) => r.game && r.game.id === g2.game.id + 1);
    const g3 = await L.roomWhen(code, (r) => typeof r.game.startedAt === 'number' && r.game.clearMs === undefined);
    check('もう一回でも、時計は新しく', g3.game.timer === true && g3.game.startedAt >= g1.game.startedAt);
    await L.rest('PUT', L.ROOMS + '/' + code + '/best/1', 999900);
    await sleep(800);
    check('もう一回: クリアの札は消える', !(await L.visible(guest, '#clearBox')) && !(await L.visible(guest, '#clearTime')));
    await allIn(host, guest);
    const g4 = await L.roomWhen(code, (r) => typeof r.game.clearMs === 'number');
    check('速くなったら、いちばん速いタイムを書きかえる', g4.best[1] === g4.game.clearMs, g4.best);
    await L.waitVisible(guest, '#clearTime');
    for (const c of [host, guest]) {
      const t = await L.text(c, '#clearTime');
      check(c.label + ': 「いちばん速いタイム！（前は …）」', t.includes('このステージで、いちばん速いタイム！（前は 16:39.9）'), t);
    }
    await L.shot(host, 'timer-03-best-host');

    // もう一回（遅かったとき）
    await host.page.click('#btnAgain');
    await L.roomWhen(code, (r) => r.game && r.game.id === g4.game.id + 1 && r.game.clearMs === undefined);
    await L.rest('PUT', L.ROOMS + '/' + code + '/best/1', 100);
    await sleep(800);
    await allIn(host, guest);
    const g5 = await L.roomWhen(code, (r) => typeof r.game.clearMs === 'number');
    check('遅かったら、いちばん速いタイムはそのまま', g5.best[1] === 100, g5.best);
    await L.waitVisible(guest, '#clearTime');
    check('遅かったとき: 「このステージのいちばん速いタイム 0:00.1」', (await L.text(guest, '#clearTime')).includes('このステージのいちばん速いタイム 0:00.1'), await L.text(guest, '#clearTime'));

    // ホストが読み込み直しても、クリアのタイムは書きなおさない
    await host.page.reload();
    await L.waitScreen(host, 'game');
    await sleep(1500);
    const g6 = await L.roomOf(code);
    check('ホストの読み込み直しで、タイムは変わらない', g6.game.clearMs === g5.game.clearMs && g6.best[1] === 100);
    await L.waitVisible(host, '#clearTime');
    check('読み込み直したホストにもタイム', (await L.text(host, '#clearTime')).startsWith('クリアまでのタイム ' + fmt(g5.game.clearMs)));

    // 待合室へ → オフにもどす → 時計は出ない
    await host.page.click('#hostMenu summary');
    await host.page.click('#btnLobby');
    await L.waitScreen(guest, 'waiting');
    await L.waitScreen(host, 'waiting');
    check('待合室でも、オンのまま', await host.page.isChecked('#timerOn'));
    await host.page.uncheck('#timerOn');
    await L.roomWhen(code, (r) => r.set.timer === false);
    await guest.page.waitForFunction(() => document.querySelector('#lobbyTimerNote').hidden);
    check('オフにすると、参加者の知らせも消える', true);
    await startStage(host, guest);
    const g7 = await L.roomWhen(code, (r) => r.game && r.status === 'play');
    check('オフのとき、ステージに timer を書かない', g7.game.timer === undefined && g7.game.startedAt === undefined, g7.game);
    await sleep(600);
    check('オフのとき、時計は出ない', !(await L.visible(host, '#timeLine')) && !(await L.visible(guest, '#timeLine')));
    await allIn(host, guest);
    await L.waitVisible(guest, '#clearBox');
    await sleep(800);
    check('オフのとき、クリアの札にタイムは出ない', !(await L.visible(guest, '#clearTime')) && !(await L.visible(host, '#clearTime')));
    const g8 = await L.roomOf(code);
    check('オフのとき、タイムを書かない', g8.game.clearMs === undefined);
    check('画面のはみ出しなし', (await L.overflow(guest)) <= 0);

    // 1台のパソコンで遊ぶ
    const solo = await L.newClient('solo');
    await L.open(solo);
    await solo.page.click('#btnGoLocal');
    await L.waitScreen(solo, 'local');
    check('1台: はじめはオフ', (await solo.page.isChecked('#localTimer')) === false);
    await solo.page.click('#localStageSeg .nr-seg__btn:nth-child(2)');
    await solo.page.click('#btnLocalStart');
    await L.waitScreen(solo, 'game');
    await sleep(500);
    check('1台: オフなら時計は出ない', !(await L.visible(solo, '#timeLine')));
    await solo.page.click('#btnLocalTop');
    await solo.page.click('#btnGoLocal');
    await solo.page.check('#localTimer');
    await solo.page.click('#btnLocalStart');
    await L.waitScreen(solo, 'game');
    await L.waitVisible(solo, '#timeLine');
    await solo.page.waitForFunction(() => document.querySelector('#timeLine').textContent !== '');
    check('1台: オンなら時計', /^タイム 0:0\d$/.test(await L.text(solo, '#timeLine')), await L.text(solo, '#timeLine'));
    check('1台: timer を数える', (await L.stats(solo, 'timer')) === 1);
    await sleep(1100);
    const inAll = (s) => { const d = s.world.door; s.world.players.forEach((p) => { p.x = d.x + 0.2; p.y = 10 - 0.9; p.vy = 0; p.ground = null; }); return 1; };
    await st(solo, inAll);
    await L.waitVisible(solo, '#clearTime');
    const s1 = await L.text(solo, '#clearTime');
    check('1台: クリアのタイム', /^クリアまでのタイム 0:0\d\.\d$/.test(s1), s1);
    await L.shot(solo, 'timer-04-local-clear');
    // もう一回（前のタイムを遅くしておく）→ いちばん速い
    await solo.page.click('#btnAgain');
    await sleep(300);
    await st(solo, (s) => { s.local.best[s.world.stage] = 999900; return 1; });
    await st(solo, inAll);
    await L.waitVisible(solo, '#clearTime');
    check('1台: 速くなったら「いちばん速いタイム！」', (await L.text(solo, '#clearTime')).includes('いちばん速いタイム！（前は 16:39.9）'), await L.text(solo, '#clearTime'));
    check('1台: 保存しない（localStorage を使わない）', (await solo.page.evaluate(() => localStorage.length)) === 0);
  } catch (e) {
    check('例外なし', false, e && e.stack || e);
  } finally {
    L.finish();
    await L.browser.close();
    server.close();
  }
})();
