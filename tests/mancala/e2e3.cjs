// その3: 1台の画面（人どうし・補助・たしかめる・動き・1手もどす・読み込み直し・最後まで・もう一回・CPU と対戦・幅 375px）
const L = require('./lib.cjs');
const { E, check, sleep, startServer, launch, newClient, open, text, visible, waitScreen, overflow, waitStats, hole, readBoard, turnOf, goals, playable, hints, bottomRow, status, settled, shot, finishAll } = L;
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

(async () => {
  const server = await startServer();
  await launch();
  const a = await newClient('local');
  await open(a);
  check('トップの題名', (await text(a, '.app-title')) === 'マンカラ');
  await a.page.click('#btnGoLocal');
  await waitScreen(a, 'local');
  check('補助のはじめ: たしかめるはオン・いい手はオフ', await a.page.evaluate(() => {
    const cs = [...document.querySelectorAll('#localAid input[type=checkbox]')];
    return cs.length === 2 && cs[0].checked && !cs[1].checked;
  }));
  check('CPU の強さは人どうしのとき隠れる', !(await visible(a, '#localLevelBox')));
  await a.page.fill('#localNameB', 'あお');
  await a.page.fill('#localNameW', 'あか');
  await a.page.click('#btnLocalStart');
  await waitScreen(a, 'game');
  check('はじめの盤', same(await readBoard(a), E.newGame().board), await readBoard(a));
  check('先の番', (await turnOf(a)) === 'b');
  check('下の段は先の穴', same(await bottomRow(a), [0, 1, 2, 3, 4, 5]), await bottomRow(a));
  check('押せるのは先の穴', same(await playable(a), [0, 1, 2, 3, 4, 5]));
  check('local-start', await waitStats(a, 'local-start', 1));
  check('番の表示', (await status(a)).includes('先（あお）の番'), await status(a));

  // たしかめる: 1回目は印だけ
  await a.page.click(hole(2));
  check('たしかめるの欄が出る', await visible(a, '#confirmBox'));
  check('もう1回の説明', (await text(a, '#confirmText')).includes('もう1回'), await text(a, '#confirmText'));
  check('石が入る穴に点線', (await a.page.$$eval('#board .mc-hole.is-path', (xs) => xs.map((x) => Number(x.dataset.i)).sort((p, q) => p - q).join(','))) === '3,4,5,6');
  check('最後の穴に印', (await a.page.$eval('#board .mc-hole.is-end', (x) => Number(x.dataset.i))) === 6);
  check('まだまいていない', same(await readBoard(a), E.newGame().board));
  await a.page.click('#btnUnpick');
  check('やめると印が消える', !(await visible(a, '#confirmBox')) && (await a.page.$$('#board .mc-hole.is-path')).length === 0);
  // もう1回押す → まく（動きの途中を見る）
  await a.page.click(hole(2));
  await a.page.click(hole(2));
  await sleep(350);
  check('動きの途中は押せない', (await playable(a)).length === 0);
  check('動きの途中の表示', (await status(a)).includes('まいている'), await status(a));
  const mid = await readBoard(a);
  check('途中の盤（すくった穴は0・ゴールはまだ）', mid[2] === 0 && mid[6] === 0, mid);
  await settled(a);
  const b1 = await readBoard(a);
  check('まいたあとの盤', same(b1, [4, 4, 0, 5, 5, 5, 1, 4, 4, 4, 4, 4, 4, 0]), b1);
  check('もう1回で先の番のまま', (await turnOf(a)) === 'b');
  check('もう1回の表示', (await status(a)).includes('もう1回'), await status(a));
  check('札のゴールの数', (await goals(a)).b === 1);
  check('直前にまいた穴の印', (await a.page.$eval('#board .mc-hole.is-last', (x) => Number(x.dataset.i))) === 2);

  // 補助の設定: たしかめるを切る・いい手に印
  await a.page.click('#btnAid');
  await a.page.evaluate(() => {
    const cs = [...document.querySelectorAll('#dialogAid input[type=checkbox]')];
    cs[0].click();
    cs[1].click();
  });
  await a.page.click('#btnAidClose');
  const want = E.legalMoves(b1, 'b').filter((i) => { const r = E.sow(b1, 'b', i); return r.extra || r.capture; });
  check('いい手に印（計算と同じ穴）', same(await hints(a), want), [await hints(a), want]);
  // たしかめなしで1回でまく
  await a.page.click(hole(0));
  await settled(a);
  const g2 = E.play(E.play(E.newGame(), 2), 0);
  check('1回押すとまく', same(await readBoard(a), g2.board), await readBoard(a));
  check('後の番', (await turnOf(a)) === 'w');
  check('後の番は上の段が押せる', same(await playable(a), E.legalMoves(g2.board, 'w')));

  // 1手もどす
  await a.page.click('#btnUndo');
  check('もどすと先の番', (await turnOf(a)) === 'b' && same(await readBoard(a), b1));
  // 読み込み直し
  await a.page.click(hole(0));
  await settled(a);
  await a.page.reload();
  await waitScreen(a, 'game');
  check('読み込み直しで続きから', same(await readBoard(a), g2.board) && (await turnOf(a)) === 'w');

  // 最後まで（でたらめに）
  let guard = 0;
  while (!(await visible(a, '#resultBox')) && guard++ < 300) {
    const p = await playable(a);
    if (!p.length) { await sleep(100); continue; }
    await a.page.click(hole(p[Math.floor(Math.random() * p.length)]));
    await settled(a, 20000);
  }
  const fin = await readBoard(a);
  check('おわり: 石はゴールだけに48', fin[6] + fin[13] === 48, fin);
  check('結果の表示', /の勝ち！|引き分け！/.test(await status(a)), await status(a));
  check('local-finish', await waitStats(a, 'local-finish', 1));
  check('もう一回のボタン', (await text(a, '#btnAgain')).includes('入れかえる'));
  await shot(a, 'local-result');
  await a.page.click('#btnAgain');
  check('もう一回で名前が入れかわる', (await text(a, '.mc-seat--b .mc-seat__name')) === 'あか');
  await shot(a, 'local-pc');

  // CPU と対戦（自分が後・つよい）
  await a.page.click('#btnQuit');
  await waitScreen(a, 'top');
  await a.page.click('#btnGoLocal');
  await a.page.check('input[name="localVs"][value="b"]', { force: true });
  check('CPU の強さが出る', await visible(a, '#localLevelBox'));
  await a.page.check('input[name="localLevel"][value="strong"]', { force: true });
  await a.page.click('#btnLocalStart');
  await waitScreen(a, 'game');
  check('CPU と: 下の段は自分（後）の穴', same(await bottomRow(a), [7, 8, 9, 10, 11, 12]), await bottomRow(a));
  check('CPU の名前', (await text(a, '.mc-seat--b .mc-seat__name')) === 'CPU');
  check('CPU が考え中で押せない', (await playable(a)).length === 0);
  await L.waitFor(async () => (await turnOf(a)) === 'w' && (await playable(a)).length > 0, 30000);
  check('CPU がまいたあと自分の番', (await turnOf(a)) === 'w');
  check('CPU の手の表示', (await status(a)).includes('CPU は'), await status(a));
  const before = await readBoard(a);
  const p = await playable(a);
  await a.page.click(hole(p[p.length - 1]));
  if (await visible(a, '#confirmBox')) await a.page.click('#btnPlace');
  await L.waitFor(async () => (await turnOf(a)) === 'w' && (await playable(a)).length > 0 && !same(await readBoard(a), before), 40000);
  await a.page.click('#btnUndo');
  check('CPU と: もどすと自分の番の局面', same(await readBoard(a), before) && (await turnOf(a)) === 'w', await readBoard(a));
  await shot(a, 'local-cpu');

  // 幅 375px
  const m = await newClient('mobile', { viewport: { width: 375, height: 812 } });
  await open(m);
  check('375: トップのはみ出しなし', (await overflow(m)) <= 0);
  await m.page.click('#btnGoLocal');
  await m.page.click('#btnLocalStart');
  await waitScreen(m, 'game');
  check('375: 盤のはみ出しなし', (await overflow(m)) <= 0, await overflow(m));
  const w = await m.page.$eval(hole(0), (x) => x.getBoundingClientRect().width);
  check('375: 穴の幅', w >= 38, w);
  await shot(m, 'local-375');
  await finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
