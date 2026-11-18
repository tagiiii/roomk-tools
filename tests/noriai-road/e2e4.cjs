// のりあいロード E2E その4: ステージ6〜10。ステージを10こから選べる・同時スイッチと番号スイッチの同期（3台）・
// 1台のパソコンで新しいステージの画面（ばねで跳ぶ・高い台・さいごの道）
const L = require('./lib.cjs');
const { check, sleep, st } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const host = await L.newClient('host');
    const g1 = await L.newClient('g1');
    const g2 = await L.newClient('g2');
    for (const c of [host, g1, g2]) await L.open(c);
    const code = await L.createRoom(host, 'ホスト');
    await L.joinRoom(g1, 'いち', code);
    await L.waitScreen(g1, 'waiting');
    await L.joinRoom(g2, 'にい', code);
    await L.waitScreen(g2, 'waiting');
    check('ステージは13こから選べる', (await host.page.$$('#lobbySet .nr-seg__btn')).length === 13);
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(8)');
    await L.roomWhen(code, (r) => r.set.stage === 7);
    await g1.page.waitForFunction(() => document.querySelector('#lobbySetNote').textContent.includes('8. 手分けの道'));
    check('参加者にも「8. 手分けの道」', true);
    await host.page.click('#btnStartGame');
    for (const c of [host, g1, g2]) await L.waitScreen(c, 'game');
    await sleep(800);
    check('stage-8 を数える', (await L.stats(host, 'stage-8')) === 1);

    // ── 同時スイッチ（下と高い足場）: それぞれの端末で自分の位置を置く ──
    const sw = await st(host, (s) => s.world.switches.map((x) => ({ x: x.x, y: x.y, seatN: x.seatN })));
    const put = (c, seat, x, top) => st(c, (s, E, a) => { const p = s.world.players[a.seat - 1]; p.x = a.x + 0.1; p.y = a.top - E.PH; p.vy = 0; p.ground = null; return 1; }, { seat, x, top });
    await put(g1, 2, sw[0].x, sw[0].y + 1);
    await sleep(800);
    check('1つでは開かない', !(await st(host, (s) => s.world.gates[0].open)));
    check('参加者の画面でも1つおさえている', (await st(g2, (s) => s.world.switches.filter((x) => x.letter === s.world.gates[0].letter && x.on).length)) === 1);
    await L.shot(g2, 'stage8-01-one');
    await put(g2, 3, sw[1].x, sw[1].y + 1);
    await L.until(async () => await st(host, (s) => s.world.gates[0].open), 5000);
    check('2つ同時で開く（ホスト）', true);
    await L.until(async () => await st(g1, (s) => s.world.gates[0].open), 5000);
    check('参加者の画面でも開く', true);
    await put(g1, 2, sw[0].x - 3, 10);
    await put(g2, 3, sw[0].x - 2, 10);
    await sleep(1000);
    check('はなれても開いたまま', (await st(host, (s) => s.world.gates[0].open)) && (await st(g2, (s) => s.world.gates[0].open)));

    // ── 番号のスイッチ（1番と3番）: 2番が乗ってもおさえられない ──
    check('番号のスイッチは1番と3番', sw[2].seatN === 1 && sw[3].seatN === 3, sw);
    await put(g1, 2, sw[2].x, sw[2].y + 1);
    await sleep(800);
    check('2番では1番のスイッチをおさえられない', !(await st(host, (s) => s.world.switches[2].on)));
    await L.shot(g1, 'stage8-02-num');
    await put(g1, 2, sw[2].x - 3, 10);
    await put(host, 1, sw[2].x, sw[2].y + 1);
    await put(g2, 3, sw[3].x, sw[3].y + 1);
    await L.until(async () => await st(host, (s) => s.world.gates[1].open), 5000);
    check('1番と3番で開く', true);

    // ── 1台のパソコンで遊ぶ: ステージ7（ばね） ──
    const solo = await L.newClient('solo');
    await L.open(solo);
    await solo.page.click('#btnGoLocal');
    await L.waitScreen(solo, 'local');
    check('1台のパソコンでもステージは13こ', (await solo.page.$$('#localStageSeg .nr-seg__btn')).length === 13);
    await solo.page.click('#localStageSeg .nr-seg__btn:nth-child(7)');
    await solo.page.click('#btnLocalStart');
    await L.waitScreen(solo, 'game');
    await sleep(500);
    const sp = await st(solo, (s) => s.world.springs.map((x) => x.x));
    check('ステージ7にばねが2つ', sp.length === 2, sp);
    await st(solo, (s, E, x) => { s.world.players.forEach((q, k) => { q.x = k ? x - 2 - k : x + 0.1; q.y = 10 - E.PH; q.vy = 0; q.ground = null; }); return 1; }, sp[0]);
    let minY = 99;
    for (let k = 0; k < 14; k++) { minY = Math.min(minY, await st(solo, (s) => s.world.players[0].y)); await sleep(40); }
    check('ばねで高く跳ぶ（画面の中で）', 9.1 - minY > 3.5, minY);
    await sleep(1200);
    await st(solo, (s, E, x) => { s.world.players.forEach((q, k) => { q.x = x - 2.5 + k * 0.9; q.y = 10 - E.PH; q.vy = 0; q.ground = null; }); return 1; }, sp[1]);
    await sleep(900);
    await L.shot(solo, 'stage7-spring-wall');
    // ステージ6（高い台）・10（さいごの道）の画面
    for (const [nth, name] of [[6, 'stage6'], [10, 'stage10'], [11, 'stage11'], [12, 'stage12'], [13, 'stage13']]) {
      await solo.page.click('#btnLocalTop');
      await L.waitScreen(solo, 'top');
      await solo.page.click('#btnGoLocal');
      await L.waitScreen(solo, 'local');
      await solo.page.click('#localStageSeg .nr-seg__btn:nth-child(' + nth + ')');
      await solo.page.click('#btnLocalStart');
      await L.waitScreen(solo, 'game');
      await sleep(600);
      await L.shot(solo, name + '-start');
    }
    check('画面のはみ出しなし', (await L.overflow(solo)) <= 0);
  } catch (e) {
    check('例外なし', false, e && e.stack || e);
  } finally {
    L.finish();
    await L.browser.close();
    server.close();
  }
})();
