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

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
