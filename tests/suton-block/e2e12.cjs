// すとんブロック E2E その12: 対戦の「ここまで」のあとの観戦（2026-11-13 フィードバック）
// ここまでになった人に「みんなの盤を見る」・押すと、のこっている人の盤をならべる画面・「自分の盤にもどる」・ルームに書かない・
// 375px・読み込み直したら、あそぶ画面から・結果になったら結果へ
const L = require('./lib.cjs');
const { check, sleep, roomOf, roomWhen, text, visible, waitText, waitFor, key, shot, overflow } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const active = (c) => c.page.evaluate(() => document.querySelector('.sb-screen.active')?.id);
async function goOut(c, code, name) {
  for (let i = 0; i < 80 && !(await roomOf(code)).boards?.[name]?.out; i++) { await key(c, 'Space'); await sleep(40); }
  await roomWhen(code, (r) => r.boards?.[name]?.out === true);
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1280, height: 900 } });
  const A = await L.newClient('aoi', { viewport: { width: 1280, height: 900 } });
  const B = await L.newClient('haru', { viewport: { width: 1280, height: 900 } });
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'はる', code);
  await waitText(H, '#lobbyPeople', 'はる');
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  await H.page.click('label:has(input[name="roomTime"][value="0"])');
  await roomWhen(code, (r) => r.settings.mode === 'battle' && r.settings.time === 0 && r.settings.full !== 'clear');
  await H.page.click('#btnStartGame');
  await Promise.all([H, A, B].map((c) => waitFalling(c)));
  check('V1 あそんでいる間は「みんなの盤を見る」を出さない', !(await visible(B, '#btnSpectate')) && !(await visible(A, '#btnSpectate')));

  await goOut(B, code, 'はる');
  check('V2 ここまでになった人に「みんなの盤を見る」', await waitFor(() => visible(B, '#btnSpectate')));
  check('V3 一言で案内する', (await text(B, '#playNote')).includes('みんなの盤を見る'));
  check('V4 のこっている人には出さない', !(await visible(A, '#btnSpectate')) && !(await visible(H, '#btnSpectate')));
  const before = JSON.stringify((await roomOf(code)).boards['はる']);
  await B.page.click('#btnSpectate');
  check('V5 押すと、あそぶ人の盤をならべる画面', await waitFor(async () => (await active(B)) === 'screen-watch'));
  check('V6 3人の盤がならぶ', await waitFor(async () => (await B.page.$$('#watchGrid .sb-mini')).length === 3), await B.page.$$eval('#watchGrid > *', (e) => e.length));
  check('V7 「自分の盤にもどる」が出て、「早めにおわる」「トップへ戻る」は出ない（参加者）', await visible(B, '#btnWatchMine') && !(await visible(B, '#btnWatchEnd')) && !(await visible(B, '#btnWatchLeave')));
  check('V8 ルームのバーは出さない（あそんでいる間）', !(await visible(B, '#roomBar')));
  await shot(B, 'e2e12-watch');
  await sleep(500);
  check('V9 見ているだけではルームに書かない', JSON.stringify((await roomOf(code)).boards['はる']) === before);

  // ほかの人が置くと、ならべた盤も変わる
  const aBefore = (await roomOf(code)).boards?.['あおい']?.b || '';
  await key(A, 'Space');
  await roomWhen(code, (r) => (r.boards?.['あおい']?.b || '') !== aBefore);
  check('V10 ほかの人が置くと、見ている画面のままで続く', (await active(B)) === 'screen-watch' && (await B.page.$$('#watchGrid .sb-mini')).length === 3);

  await B.page.click('#btnWatchMine');
  check('V11 「自分の盤にもどる」で止まった盤にもどる', await waitFor(async () => (await active(B)) === 'screen-play') && await visible(B, '#btnSpectate'));
  check('V12 盤の大きさが保たれる（0 にならない）', await B.page.evaluate(() => document.getElementById('board').getBoundingClientRect().width > 100));

  // 375px
  await B.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  await B.page.click('#btnSpectate');
  await waitFor(async () => (await active(B)) === 'screen-watch');
  check('V13 375px でも横にはみ出さない', (await overflow(B)) <= 0);
  await shot(B, 'e2e12-watch-375');
  await B.page.setViewportSize({ width: 1280, height: 900 });

  // 読み込み直したら、あそぶ画面（止まった盤）から
  await B.page.reload();
  check('V14 読み込み直したら、あそぶ画面から（「みんなの盤を見る」つき）', await waitFor(async () => (await active(B)) === 'screen-play' && await visible(B, '#btnSpectate'), 12000));

  // のこりが1人になると結果へ
  await B.page.click('#btnSpectate');
  await goOut(H, code, 'メンター');
  check('V16 のこりが1人になると、観戦している人も結果へ', await waitFor(async () => (await active(B)) === 'screen-result' && (await active(H)) === 'screen-result', 12000));
  check('V17 エラーなし', A.errors.length === 0 && H.errors.length === 0 && B.errors.length === 0, A.errors.concat(H.errors, B.errors));
  await sleep(300);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
