// のりあいロード E2E その6: しかけブロックと持ち運べるばね（ステージ13）。
// 2人がブロックに乗ると開く（両方の画面）・参加者が「ひろう」「置く」（ホストが決める）・置いたばねで穴をわたる・1台のパソコンでも
const L = require('./lib.cjs');
const { check, sleep, until, st } = L;

// 自分のキャラを置く（その画面の自分の番号）
const put = (c, seat, x, y) => st(c, (s, E, a) => { const p = s.world.players[a[0] - 1]; p.x = a[1]; p.y = a[2]; p.vx = 0; p.vy = 0; p.ground = null; return 1; }, [seat, x, y]);
const info = (c) => st(c, (s) => {
  const w = s.world;
  const k = w.blocks[0];
  const sp = w.items.find((it) => it.kind === 'spring' && Math.abs(it.x0 - (k.x + 0.7)) < 0.5);
  let px = k.x + 2;
  while (window.__noriaiTest.E.solidTile(w, px, 10, 99)) px++;
  let pe = px;
  while (!window.__noriaiTest.E.solidTile(w, pe, 10, 99)) pe++;
  return { k: { x: k.x, y: k.y, open: k.open, riders: k.riders, need: k.need }, sp: { x: sp.x, y: sp.y, holder: sp.holder, hidden: sp.hidden }, px, pe, me: s.seat ? { x: w.players[s.seat - 1].x, y: w.players[s.seat - 1].y } : null };
});

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
    check('ステージは14こ', (await host.page.$$('#lobbySet .nr-seg__btn')).length === 14);
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(13)');
    await L.roomWhen(code, (r) => r.set.stage === 12);
    await host.page.waitForFunction(() => !document.querySelector('#btnStartGame').disabled);
    await host.page.click('#btnStartGame');
    await L.waitScreen(guest, 'game');
    await sleep(800);
    let i0 = await info(host);
    check('はじめはブロックは閉じていて、ばねは出ていない', !i0.k.open && i0.sp.hidden && i0.k.need === 2, i0);
    await L.shot(host, 'block-01-start');

    // 1人だけ乗る → 開かない。参加者の画面にも人数が出る
    await put(host, 1, i0.k.x + 0.2, i0.k.y - 0.9);
    await until(async () => (await info(guest)).k.riders === 1, 5000);
    check('1人では開かない（参加者の画面でも 1/2）', !(await info(host)).k.open && (await info(guest)).k.riders === 1);
    // 2人目が乗る → 開いて、ばねが出る
    await put(guest, 2, i0.k.x + 1.1, i0.k.y - 0.9);
    await until(async () => (await info(guest)).k.open && !(await info(guest)).sp.hidden, 5000);
    check('2人乗ると開いて、ばねが出る（参加者の画面でも）', (await info(host)).k.open && !(await info(guest)).sp.hidden);
    await sleep(800);
    await L.shot(guest, 'block-02-open');

    // 参加者が「ひろう」
    await guest.page.waitForFunction(() => document.querySelector('.nr-pad[data-key="a"]').textContent === 'ひろう', null, { timeout: 5000 });
    check('近くにばねがあると「ひろう」（読み上げも）', (await guest.page.getAttribute('.nr-pad[data-key="a"]', 'aria-label')) === 'ばねをひろう');
    check('キーの案内も「ひろえる」', (await L.text(guest, '#keyHint')).includes('ひろえる'));
    await guest.page.bringToFront();
    await guest.page.keyboard.press('ArrowDown');
    await until(async () => (await info(host)).sp.holder === 2, 5000);
    check('ホストが参加者にひろわせた', (await info(host)).sp.holder === 2);
    await guest.page.waitForFunction(() => document.querySelector('.nr-pad[data-key="a"]').textContent === '置く', null, { timeout: 5000 });
    check('持っていると「置く」', true);
    // 穴の手前で置く
    const i1 = await info(host);
    await put(host, 1, i1.k.x - 3, 9.1);
    await put(guest, 2, i1.px - 1.9, 9.1);
    await sleep(500);
    await st(guest, (s) => { s.world.players[1].face = 1; return 1; });
    await guest.page.keyboard.press('ArrowDown');
    await until(async () => { const v = await info(host); return v.sp.holder === 0 && Math.abs(v.sp.y + 0.6 - 10) < 0.06; }, 5000);
    const i2 = await info(host);
    check('目の前の足もと（穴の手前）に置いた', i2.sp.x > i1.px - 1.5 && i2.sp.x + 0.6 <= i1.px + 0.01, i2);
    await until(async () => { const v = await info(guest); return !v.sp.holder && Math.abs(v.sp.x - i2.sp.x) < 0.05; }, 5000);
    check('参加者の画面でも置いてある', true);
    await guest.page.waitForFunction(() => ['ひろう', '投げる'].includes(document.querySelector('.nr-pad[data-key="a"]').textContent));
    // 参加者が歩いて乗る → 跳んで穴をわたる（ひろわない）
    await put(guest, 2, i2.sp.x - 2.5, 9.1);
    await sleep(300);
    await guest.page.keyboard.down('ArrowRight');
    let crossed = false;
    for (let t = 0; t < 40 && !crossed; t++) { await sleep(100); const v = await info(guest); if (v.me.x > i1.pe - 0.2 && v.me.y < 10) crossed = true; }
    await guest.page.keyboard.up('ArrowRight');
    check('置いたばねに乗ると跳んで、穴をわたれた', crossed, await info(guest));
    check('乗ってもひろわない（ばねは置いたまま）', (await info(host)).sp.holder === 0);
    await sleep(800);
    const gx = (await info(guest)).me;
    await until(async () => { const hp = await st(host, (s) => s.world.players[1].x); return Math.abs(hp - gx.x) < 0.3; }, 5000);
    check('ホストの画面でも、参加者は穴の向こう', true);
    await L.shot(host, 'block-03-crossed');

    // 1台のパソコン
    const solo = await L.newClient('solo');
    await L.open(solo);
    await solo.page.click('#btnGoLocal');
    await L.waitScreen(solo, 'local');
    await solo.page.click('#localStageSeg .nr-seg__btn:nth-child(13)');
    await solo.page.click('#btnLocalStart');
    await L.waitScreen(solo, 'game');
    const s0 = await info(solo);
    await st(solo, (s, E, k) => { s.world.players.forEach((p, i) => { p.x = k.x + 0.1 + i * 0.95; p.y = k.y - E.PH; p.vy = 0; p.ground = null; }); return 1; }, s0.k);
    await until(async () => (await info(solo)).k.open, 5000);
    check('1台: 2人乗ると開く', true);
    await sleep(800);
    await solo.page.bringToFront();
    await solo.page.waitForFunction(() => document.querySelector('.nr-pad[data-key="a"]').textContent === 'ひろう', null, { timeout: 5000 });
    await solo.page.keyboard.press('ArrowDown'); // 1番は矢印キー
    await until(async () => (await info(solo)).sp.holder === 1, 3000);
    check('1台: 1番が下の矢印キーでひろった', (await info(solo)).sp.holder === 1);
    check('画面のはみ出しなし', (await L.overflow(solo)) <= 0);
  } catch (e) {
    check('例外なし', false, e && e.stack || e);
  } finally {
    L.finish();
    await L.browser.close();
    server.close();
  }
})();
