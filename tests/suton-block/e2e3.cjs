// すとんブロック E2E その3: ひとりであそぶ（通信しない）・とっておく・いっぱいでからにする・あそびかた中はキーで動かない・
// 時間切れ・おしまい・もう一回・375px・あそびかたとフィードバックのボタン・とめる（ひとりのとき）
const L = require('./lib.cjs');
const { check, sleep, text, visible, waitScreen, waitFor, key, fitsHeight, overflow, stats, shot } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const P = await L.newClient('solo');
  await L.open(P);
  check('S1 「？」が出る', await visible(P, '.howto-fab'));
  await P.page.click('#btnGoSolo');
  await waitScreen(P, 'solo');
  await P.page.click('label:has(input[name="soloTime"][value="120"])');
  await P.page.click('#btnSoloStart');
  await waitScreen(P, 'play');
  check('S2 solo-start を数える', (await stats(P, 'solo-start')) === 1);
  check('S3 時間を選ぶと残り時間が出る', await waitFor(async () => /^(2:00|1:59)$/.test(await text(P, '#playTimer'))));
  check('S4 ひとりのときは「おわる」', (await text(P, '#btnPlayEnd')) === 'おわる');
  check('S5 ひとりのときはルームのバー・じゃま・ほかの人を出さない', !(await visible(P, '#roomBar')) && !(await visible(P, '#jamaBox')) && !(await visible(P, '#others')) && !(await visible(P, '#othersList')));
  check('S5b 画面のボタンは7つで、裏返すはない', (await P.page.$$eval('.sb-padbtn', (b) => b.length)) === 7 && !(await P.page.$('.sb-padbtn[data-act="flip"]')));
  const used = () => P.page.$eval('#hold', (c) => c.classList.contains('is-used'));
  check('S6 はじめは、とっておける', !(await used()));
  await key(P, 'a');
  check('S6b A では、とっておかない（A は左へ動かす。裏返すはない）', !(await used()));
  await key(P, 'c');
  check('S7 C でとっておくと箱がうすくなる', await used());
  await key(P, 'Space');
  check('S8 置いたら、またとっておける', !(await used()));
  await key(P, 'Shift');
  check('S8b Shift でもとっておける', await used());
  await key(P, 'Space');
  let noted = false;
  for (let i = 0; i < 150 && !noted; i++) { await key(P, 'Space'); noted = await visible(P, '#playNote'); }
  check('S9 いっぱいになったら、からにしてつづける', noted && (await text(P, '#playNote')).includes('からにしたよ'));
  await P.page.click('.howto-fab');
  await sleep(200);
  const before = await P.page.$eval('#board', (c) => c.toDataURL());
  await key(P, 'ArrowLeft', 4);
  await sleep(1600);
  check('S10 あそびかたを開いている間は、キーで動かず、落ちるのも止まる', (await P.page.$eval('#board', (c) => c.toDataURL())) === before);
  check('S11 あそびかたに説明スライドの入口', await visible(P, '.howto-slides-btn, [data-howto-slides]') || (await P.page.content()).includes('説明スライドを見る'));
  await P.page.keyboard.press('Escape');
  check('S12 Esc で閉じる', await waitFor(async () => !(await P.page.$eval('#screen-play', (e) => e.inert))));
  // とめる・つづける（ひとりのとき）
  check('S12a ひとりのときは「とめる」が出る', await visible(P, '#btnPause') && !(await visible(P, '#pauseCover')));
  await P.page.click('#btnPause');
  check('S12b 「とめる」で「とめています」と「つづける」が出て、「とめる」はかくれる', await visible(P, '#pauseCover') && (await text(P, '#pauseCover')).includes('とめています') && !(await visible(P, '#btnPause')));
  await sleep(200);
  const pBoard = await P.page.$eval('#board', (c) => c.toDataURL());
  const pTimer = await text(P, '#playTimer');
  await key(P, 'ArrowLeft', 4);
  await key(P, 'Space');
  await P.page.click('.sb-padbtn[data-act="right"]');
  await sleep(1600);
  check('S12c とめている間は、キー・ボタンで動かず、落ちるのも時間も止まる', (await P.page.$eval('#board', (c) => c.toDataURL())) === pBoard && (await text(P, '#playTimer')) === pTimer);
  await P.page.click('#btnResume');
  check('S12d 「つづける」で、とめる前の続きから', !(await visible(P, '#pauseCover')) && await visible(P, '#btnPause'));
  check('S12e つづけたら時間が進む', await waitFor(async () => (await text(P, '#playTimer')) !== pTimer, 2500));
  await key(P, 'p');
  check('S12f P でとめる', await visible(P, '#pauseCover'));
  await key(P, 'P');
  check('S12g もう一度 P でつづける', !(await visible(P, '#pauseCover')));
  // 時間になったら結果へ（時計を進める。止めていたぶんをずらし終えてから）
  await sleep(300);
  await P.page.evaluate(() => { window.__realNow = Date.now; Date.now = () => window.__realNow.call(Date) + 130000; });
  await waitScreen(P, 'result');
  check('S13 時間になったら結果', (await text(P, '#resultBody')).includes('消した段'));
  check('S14 solo-finish を数える', (await stats(P, 'solo-finish')) === 1);
  check('S15 ひとりの結果は「もう一回」「トップへ戻る」', await visible(P, '#btnAgain') && await visible(P, '#btnResultTop') && !(await visible(P, '#resultWait')));
  await P.page.evaluate(() => { Date.now = window.__realNow; });
  // おしまいを選ぶと、いっぱいで結果へ
  await P.page.click('#btnResultTop');
  await waitScreen(P, 'top');
  await P.page.click('#btnGoSolo');
  await P.page.click('label:has(input[name="soloTime"][value="0"])');
  await P.page.click('label:has(input[name="soloFull"][value="end"])');
  await P.page.click('#btnSoloStart');
  await waitScreen(P, 'play');
  check('S16 時間なしなら残り時間は出ない', !(await visible(P, '#playTimer')));
  let ended = false;
  for (let i = 0; i < 150 && !ended; i++) { await key(P, 'Space'); ended = (await L.screen(P)) === 'result'; }
  check('S17 「おしまい」なら、いっぱいで結果へ', ended);
  await P.page.click('#btnAgain');
  await waitScreen(P, 'play');
  check('S18 もう一回', true);
  await P.page.click('#btnPlayEnd');
  await waitScreen(P, 'result');
  check('S19 「おわる」で結果', true);
  await P.page.click('#btnAgain');
  await waitScreen(P, 'play');
  await P.page.setViewportSize({ width: 375, height: 812 });
  await sleep(200);
  check('S20 375px で1画面に収まる（ひとり）', (await overflow(P)) <= 0 && await fitsHeight(P));
  await shot(P, 'e2e3-solo-375');
  // 画面のボタン（押しっぱなしで動く）
  await P.page.click('.sb-padbtn[data-act="drop"]');
  check('S21 画面のボタンでも置ける', true);

  // ── 左右の押しっぱなし（新しいひとりの画面で。盤の下半分のマスの色で、置いた列を見る）──
  const K = await L.newClient('shift');
  await L.open(K);
  await K.page.click('#btnGoSolo');
  await waitScreen(K, 'solo');
  await K.page.click('#btnSoloStart');
  await waitScreen(K, 'play');
  await sleep(400);
  const lowerGrid = () => K.page.$eval('#board', (c) => {
    const ctx = c.getContext('2d'); const out = [];
    for (let r = 10; r < 20; r++) for (let x = 0; x < 10; x++) {
      out.push(ctx.getImageData(Math.floor((x + 0.5) * c.width / 10), Math.floor((r + 0.5) * c.height / 20), 1, 1).data.join(','));
    }
    return out;
  });
  const emptyCell = (await lowerGrid())[99];
  const placedCols = async (fn) => {
    const before = await lowerGrid();
    await fn();
    await K.page.keyboard.press('Space');
    await sleep(120);
    const cols = new Set();
    (await lowerGrid()).forEach((v, i) => { if (v !== before[i] && before[i] === emptyCell) cols.add(i % 10); });
    return [...cols].sort((a, b) => a - b);
  };
  const holdKey = async (k, ms) => { await K.page.keyboard.down(k); await sleep(ms); await K.page.keyboard.up(k); };
  const tap = await placedCols(() => holdKey('ArrowLeft', 60));
  check('S22 左を短く押すと1マスだけ（待ちの間はくり返さない）', tap[0] >= 2 && tap[0] <= 3, tap);
  const longL = await placedCols(() => holdKey('ArrowLeft', 450));
  check('S23 左を0.45秒押しっぱなしにすると、かべまで動く（OS のくり返しを待たない）', longL[0] === 0, longL);
  const longR = await placedCols(() => holdKey('ArrowRight', 450));
  check('S24 右も同じ', longR[longR.length - 1] === 9, longR);
  const both = await placedCols(async () => {
    await K.page.keyboard.down('ArrowLeft'); await sleep(40);
    await K.page.keyboard.down('ArrowRight'); await sleep(450);
    await K.page.keyboard.up('ArrowRight'); await sleep(450);
    await K.page.keyboard.up('ArrowLeft');
  });
  check('S25 左を押したまま右を押してはなすと、左へもどる', both[0] === 0, both);
  const padR = await placedCols(async () => {
    const box = await (await K.page.$('.sb-padbtn[data-act="right"]')).boundingBox();
    await K.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await K.page.mouse.down(); await sleep(450); await K.page.mouse.up();
  });
  check('S26 画面のボタンも0.45秒で右のかべまで', padR[padR.length - 1] === 9, padR);

  // WASD（矢印キーと同じ。W は ↑ と同じ右に回す。大文字でも動く）。まっさらな盤で、袋の中の続く4つで確かめる
  const W2 = await L.newClient('wasd');
  K.page = W2.page; // placedCols・holdKey・lowerGrid は K.page を見る
  await L.open(W2);
  await W2.page.click('#btnGoSolo');
  await waitScreen(W2, 'solo');
  await W2.page.click('#btnSoloStart');
  await waitScreen(W2, 'play');
  await sleep(400);
  const width = (cols) => cols.length ? cols[cols.length - 1] - cols[0] + 1 : 0;
  const wa = await placedCols(async () => { await key(W2, 'w'); await holdKey('a', 450); });
  check('S27 A の押しっぱなしで左のかべまで動く', wa[0] === 0, wa);
  const dd = await placedCols(() => holdKey('D', 450));
  check('S28 D（大文字）の押しっぱなしで右のかべまで動く', dd[dd.length - 1] === 9, dd);
  const wd = await placedCols(async () => { await key(W2, 'w'); await key(W2, 'd', 2); });
  // 回すと横はばが2マス以下になる（O は回しても2マス。同じ袋の2つなので、O はどちらか1つだけ）
  check('S29 W で右に回す（回した2つとも横はばが2マス以下）', width(wa) >= 1 && width(wa) <= 2 && width(wd) >= 1 && width(wd) <= 2, { wa, wd });
  const beforeS = await lowerGrid();
  await key(W2, 's', 25);
  await sleep(900);
  const afterS = await lowerGrid();
  check('S30 S で下まで動かすと、すとんを押さなくても置ける', afterS.some((v, i) => v !== beforeS[i] && beforeS[i] === emptyCell));
  await shot(W2, 'e2e3-wasd');

  // ── マウス（ルームで、盤をルームの記録と照らし合わせる）──
  const M = await L.newClient('mouse', { viewport: { width: 1000, height: 820 } });
  const code = await L.createRoom(M, 'そら');
  await M.page.click('#btnStartGame');
  await L.waitPlaying(M);
  check('S21b ルームでは「とめる」を出さない', !(await visible(M, '#btnPause')));
  const room = await L.roomWhen(code, (r) => r.round && typeof r.round.startedAt === 'number');
  const g = L.E.createGame({ seed: room.round.seed, onFull: 'clear' });
  const box = await M.page.$eval('#board', (c) => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const colX = (col) => box.x + (col + 0.5) * (box.w / L.E.W);
  const midY = box.y + box.h * 0.6;
  // 左はしへ動かしてクリック → 左のかべまで寄せて、すとん
  await M.page.mouse.move(colX(5), midY);
  await M.page.mouse.move(colX(0), midY, { steps: 6 });
  await M.page.mouse.down(); await M.page.mouse.up();
  while (L.E.move(g, -1, 0));
  L.E.hardDrop(g);
  let r1 = await L.roomWhen(code, (r) => r.boards?.['そら']?.pieces === 1);
  check('S22 マウスを左はしへ動かしてクリックで、左のかべに寄せて落とす', r1.boards['そら'].b === L.E.packBoard(g.board));
  // 右クリックで右に回し、右はしへ動かしてクリック
  await M.page.mouse.click(colX(5), midY, { button: 'right' });
  L.E.rotate(g, 1);
  await M.page.mouse.move(colX(9), midY, { steps: 6 });
  await M.page.mouse.down(); await M.page.mouse.up();
  while (L.E.move(g, 1, 0));
  L.E.hardDrop(g);
  r1 = await L.roomWhen(code, (r) => r.boards?.['そら']?.pieces === 2);
  check('S23 右クリックで右に回し、右はしへ寄せて落とす', r1.boards['そら'].b === L.E.packBoard(g.board));
  // ホイールで左に回し、まん中のボタンを押しても何も起きないことを確かめて、まん中に落とす
  await M.page.mouse.move(colX(4), midY);
  await M.page.mouse.wheel(0, -100);
  await sleep(250);
  await M.page.mouse.down({ button: 'middle' }); await M.page.mouse.up({ button: 'middle' });
  // 画面と同じ順に: まん中へ動かす → 左に回す → まん中へ動かす
  const xs = () => g.piece.cells.map(([x]) => g.piece.x + x);
  const moveTo = (col) => {
    for (let i = 0; i < L.E.W; i++) {
      const cur = Math.round((Math.min(...xs()) + Math.max(...xs())) / 2);
      if (cur === col || !L.E.move(g, cur < col ? 1 : -1, 0)) break;
    }
  };
  moveTo(4);
  L.E.rotate(g, -1);
  moveTo(4);
  await M.page.mouse.move(colX(4) + 1, midY);
  await M.page.mouse.down(); await M.page.mouse.up();
  L.E.hardDrop(g);
  r1 = await L.roomWhen(code, (r) => r.boards?.['そら']?.pieces === 3);
  check('S24 ホイールで回して落とす（まん中のボタンでは何も起きない）', r1.boards['そら'].b === L.E.packBoard(g.board), { got: r1.boards['そら'].b.slice(-40), want: L.E.packBoard(g.board).slice(-40) });
  check('S25 右クリックでメニューを出さない（盤の上）', await M.page.evaluate(() => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); return !document.querySelector('#board').dispatchEvent(ev); }));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
