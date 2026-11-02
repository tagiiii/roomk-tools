// すとんブロック E2E その3: ひとりであそぶ（通信しない）・とっておく・いっぱいでからにする・あそびかた中はキーで動かない・
// 時間切れ・おしまい・もう一回・375px・あそびかたとフィードバックのボタン
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
  const used = () => P.page.$eval('#hold', (c) => c.classList.contains('is-used'));
  check('S6 はじめは、とっておける', !(await used()));
  await key(P, 'a');
  check('S7 とっておくと箱がうすくなる', await used());
  await key(P, 'Space');
  check('S8 置いたら、またとっておける', !(await used()));
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

  // ── マウス（ルームで、盤をルームの記録と照らし合わせる）──
  const M = await L.newClient('mouse', { viewport: { width: 1000, height: 820 } });
  const code = await L.createRoom(M, 'そら');
  await M.page.click('#btnStartGame');
  await L.waitPlaying(M);
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
  // ホイールで左に回し、まん中のボタンで裏返して、まん中に落とす
  await M.page.mouse.move(colX(4), midY);
  await M.page.mouse.wheel(0, -100);
  await sleep(250);
  await M.page.mouse.down({ button: 'middle' }); await M.page.mouse.up({ button: 'middle' });
  // 画面と同じ順に: まん中へ動かす → 左に回す → 裏返す → まん中へ動かす
  const xs = () => g.piece.cells.map(([x]) => g.piece.x + x);
  const moveTo = (col) => {
    for (let i = 0; i < L.E.W; i++) {
      const cur = Math.round((Math.min(...xs()) + Math.max(...xs())) / 2);
      if (cur === col || !L.E.move(g, cur < col ? 1 : -1, 0)) break;
    }
  };
  moveTo(4);
  L.E.rotate(g, -1);
  L.E.flip(g);
  moveTo(4);
  await M.page.mouse.move(colX(4) + 1, midY);
  await M.page.mouse.down(); await M.page.mouse.up();
  L.E.hardDrop(g);
  r1 = await L.roomWhen(code, (r) => r.boards?.['そら']?.pieces === 3);
  check('S24 ホイールで回し、まん中のボタンで裏返して落とす', r1.boards['そら'].b === L.E.packBoard(g.board), { got: r1.boards['そら'].b.slice(-40), want: L.E.packBoard(g.board).slice(-40) });
  check('S25 右クリックでメニューを出さない（盤の上）', await M.page.evaluate(() => { const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); return !document.querySelector('#board').dispatchEvent(ev); }));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
