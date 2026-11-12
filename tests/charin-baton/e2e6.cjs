// ちゃりんバトン E2E その6: ならべ方「うごく」と「まぜる」
// ルーム（ホスト・参加者・みんなにみせる画面）と、1台の画面・いっしょに数える・動きを減らす設定
const L = require('./lib.cjs');
const { check, sleep, waitFor } = L;

// トレーの小銭の場所（transform の translate）
const spots = (c, sel = '#tray') => c.page.$$eval(sel + ' g', (gs) => gs.map((g) => {
  const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform'));
  return { x: Number(m[1]), y: Number(m[2]), r: Number(g.querySelector('circle').getAttribute('r')) };
}));
const moved = (a, b) => a.length === b.length && a.some((p, i) => Math.abs(p.x - b[i].x) + Math.abs(p.y - b[i].y) > 0.3);
const apart = (list) => list.every((a, i) => list.every((b, j) => j <= i || Math.hypot(a.x - b.x, a.y - b.y) >= a.r + b.r - 0.01)
  && a.x - a.r >= 0 && a.x + a.r <= 150 && a.y - a.r >= 0 && a.y + a.r <= 90);
const jamBtn = (c) => c.page.evaluate(() => {
  const b = document.querySelector('.cb-jambtn');
  return b ? { text: b.textContent, disabled: b.disabled } : null;
});

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── A. ルーム: はじめは「まぜる」なし ──
  const H = await L.newClient('host');
  const G = await L.newClient('guest', { viewport: { width: 390, height: 800 }, mobile: true });
  const code = await L.createRoom(H, 'ほすと');
  await L.joinRoom(G, 'げすと', code);
  check('A1 はじめは「まぜる」なし・ならべ方はばらばら', await H.page.$eval('#lobbyCommon-jam', (s) => s.value) === '0' && await H.page.$eval('#lobbyCommon-arrange', (s) => s.value) === 'scatter');
  check('A2 参加者の画面の設定に「まぜる」は出ない', !(await L.text(G, '#lobbyCommonView')).includes('まぜる'));
  await H.page.selectOption('#lobbyCommon-first', 'top');
  await H.page.click('#btnStartGame');
  await L.waitActive(H);
  let D = await L.duelOf(code);
  check('A3 なしのときは回数0・ボタンなし', D.jam.every((x) => x === 0) && (await jamBtn(G)) === null && (await jamBtn(H)) === null);
  const still = await spots(H);
  await sleep(400);
  check('A4 ばらばらは動かない', !moved(still, await spots(H)));
  await H.page.click('#tools .cb-quiet');
  await L.waitScreen(H, 'waiting');

  // ── B. うごく＋まぜる ──
  await H.page.selectOption('#lobbyCommon-arrange', 'move');
  await H.page.selectOption('#lobbyCommon-jam', '3');
  await L.roomWhen(code, (r) => r.set.jam === 3 && r.set.arrange === 'move');
  check('B1 参加者の画面の設定に出る', await waitFor(async () => { const t = await L.text(G, '#lobbyCommonView'); return t.includes('うごく') && t.includes('まぜるはあり（ひとり3回まで）'); }));
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await H.page.click('#btnStartGame');
  await L.waitActive(H);
  D = await L.duelOf(code);
  check('B2 対決の設定と回数', D.settings.arrange === 'move' && D.settings.jam === 3 && D.jam.join() === '3,3' && D.turn === 0);
  for (const c of [H, G, W]) {
    const a = await spots(c);
    await sleep(500);
    const b = await spots(c);
    check('B3 小銭が動く: ' + c.label, moved(a, b), { a, b });
    check('B4 重ならない・はみ出さない: ' + c.label, apart(a) && apart(b), { a, b });
  }
  check('B5 番の人にはボタンなし・番でない人に「まぜる あと3回」・みんなにみせる画面にはなし',
    (await jamBtn(H)) === null && (await jamBtn(W)) === null && JSON.stringify(await jamBtn(G)) === JSON.stringify({ text: 'cycloneまぜるあと3回', disabled: false }), await jamBtn(G));
  check('B6 スマホ幅ではみ出さない', (await L.overflow(G)) <= 0);
  await L.shot(G, 'e6-guest-jam');
  await L.shot(H, 'e6-host-move');

  // 番の人が数字を入れている途中にまぜる
  await H.page.keyboard.type('1');
  const sum = await L.traySum(H);
  const before = D.problem.coins.map((c) => c.x + ',' + c.y).join(';');
  await G.page.click('.cb-jambtn');
  const R = await L.roomWhen(code, (r) => r.game.duel.problem.mix === 1);
  const D2 = R.game.duel;
  check('B7 ならべなおした（回数が減る・金額と場面の番号はそのまま）', D2.problem.mix === 1 && D2.jam.join() === '3,2' && D2.rev === D.rev && D2.turn === 0
    && D2.problem.coins.map((c) => c.x + ',' + c.y).join(';') !== before && D2.problem.coins.map((c) => c.v).join() === D.problem.coins.map((c) => c.v).join());
  check('B8 番の人の入れている数字は残る・金額は同じ・トレーがゆれる', await waitFor(async () => (await H.page.$eval('#tray', (t) => t.classList.contains('is-mixed')))) && (await L.text(H, '#displayNum')) === '1' && (await L.traySum(H)) === sum);
  check('B9 ボタンは「あと2回」', await waitFor(async () => (await jamBtn(G))?.text === 'cycloneまぜるあと2回'));
  await G.page.click('.cb-jambtn');
  await L.roomWhen(code, (r) => r.game.duel.jam[1] === 1);
  await waitFor(async () => (await jamBtn(G))?.text === 'cycloneまぜるあと1回');
  await G.page.click('.cb-jambtn');
  await L.roomWhen(code, (r) => r.game.duel.jam[1] === 0);
  check('B10 3回で使いきると押せない', await waitFor(async () => { const b = await jamBtn(G); return b && b.disabled && b.text.includes('あと0回'); }));
  // 番の人は、まぜたあとも同じ金額で正解になる
  await H.page.keyboard.press('Backspace');
  await L.typeAnswer(H, sum);
  await L.waitText(H, '#trayBand', '正解！');
  const h1 = await spots(H);
  await sleep(300);
  check('B11 正解の帯の間は止まる', !moved(h1, await spots(H)));
  await L.waitActive(G);
  D = await L.duelOf(code);
  check('B12 次の人の番: 回数は持ちこす・mix は消える', D.turn === 1 && D.jam.join() === '3,0' && !D.problem.mix);
  check('B13 こんどはホストにボタン・番の人にはなし', (await jamBtn(G)) === null && await waitFor(async () => (await jamBtn(H))?.text === 'cycloneまぜるあと3回'));
  // まぜるのと同時に答えても、正解は通る
  const s2 = await L.traySum(G);
  await G.page.keyboard.type(String(s2));
  await Promise.all([H.page.evaluate(() => document.querySelector('.cb-jambtn')?.click()), G.page.keyboard.press('Enter')]);
  const R3 = await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal' || r.game.duel.turn === 0);
  check('B14 同時に送っても正解が通る', R3.game.duel.correct[1] === 1, R3.game.duel);

  // 動きを減らす設定の端末では動かない
  await W.page.emulateMedia({ reducedMotion: 'reduce' });
  await L.waitActive(H);
  const w1 = await spots(W);
  await sleep(500);
  check('B15 動きを減らす設定では動かない', w1.length > 0 && !moved(w1, await spots(W)));
  await H.page.click('#tools .cb-quiet');
  await L.waitScreen(H, 'waiting');

  // ── C. 1台の画面 ──
  const P = await L.newClient('local', { viewport: { width: 1280, height: 800 } });
  await P.page.clock.install();
  await L.open(P);
  await P.page.click('#btnGoLocal');
  await L.waitScreen(P, 'local');
  await P.page.fill('#localName0', 'そら');
  await P.page.fill('#localName1', 'みどり');
  await P.page.selectOption('#localCommon-arrange', 'move');
  await P.page.selectOption('#localCommon-jam', '3');
  await P.page.selectOption('#localCommon-first', 'top');
  await P.page.click('#btnLocalStart');
  await L.waitScreen(P, 'game');
  await P.page.clock.runFor(3200);
  await L.waitActive(P);
  const p1 = await spots(P);
  await P.page.clock.runFor(600);
  const p2 = await spots(P);
  check('C1 1台の画面でも動く・重ならない', moved(p1, p2) && apart(p2), { p1, p2 });
  const btns = await P.page.$$eval('.cb-jams .cb-jambtn', (bs) => bs.map((b) => b.textContent));
  check('C2 番でない人の「まぜる」だけ出る', btns.length === 1 && btns[0] === 'cycloneみどりがまぜるあと3回', btns);
  await P.page.keyboard.type('2');
  const ps = await L.traySum(P);
  await P.page.click('.cb-jams .cb-jambtn');
  check('C3 まぜても金額と入れている数字は同じ・あと2回', (await L.traySum(P)) === ps && (await L.text(P, '#displayNum')) === '2' && (await P.page.$eval('.cb-jams .cb-jambtn', (b) => b.textContent)).includes('あと2回'));
  await L.shot(P, 'e6-local');
  // 読み込み直しても回数が残る
  await P.page.reload();
  await L.waitScreen(P, 'game');
  await P.page.clock.runFor(3200);
  await L.waitActive(P);
  check('C4 読み込み直しても回数が残る', (await P.page.$eval('.cb-jams .cb-jambtn', (b) => b.textContent)).includes('あと2回'));
  await P.page.click('#tools .cb-quiet');

  // ── D. いっしょに数える ──
  await L.open(P);
  await P.page.click('#btnGoCount');
  await L.waitScreen(P, 'count');
  await P.page.click('#countOpts .cb-seg__btn >> text=うごく');
  const c1 = await spots(P, '#countTray');
  await P.page.clock.runFor(600);
  const c2 = await spots(P, '#countTray');
  check('D1 いっしょに数えるでも動く', moved(c1, c2) && apart(c2));
  await P.page.click('#btnCountGo');
  const c3 = await spots(P, '#countTray');
  await P.page.clock.runFor(600);
  check('D2 答えを見ると止まる', !moved(c3, await spots(P, '#countTray')));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
