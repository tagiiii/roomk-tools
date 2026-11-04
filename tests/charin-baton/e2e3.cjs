// ちゃりんバトン E2E その3: 1台の画面（名前・設定・3・2・1・まちがい・正解・パス・読み込み直し・時間切れ・結果・もう一回・設定を変える）・数字ボタンの出し分け・いっしょに数える・スマホ幅
// 通信しない画面なので、時計は Playwright の clock で早送りする
const L = require('./lib.cjs');
const { check, sleep, waitFor } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const P = await L.newClient('pc', { viewport: { width: 1280, height: 800 } });
  await P.page.clock.install();
  await L.open(P);

  // ── A. 1台の画面の準備 ──
  await P.page.click('#btnGoLocal');
  await L.waitScreen(P, 'local');
  check('A1 準備の画面の主ボタンは1つ', (await P.page.$$('#screen-local .btn-primary')).length === 1);
  await P.page.fill('#localName0', 'そら');
  await P.page.fill('#localName1', 'みどり');
  await P.page.selectOption('#localCommon-time', '30');
  await P.page.selectOption('#localCommon-kinds', 'three');
  await P.page.selectOption('#localCommon-max', '4');
  await P.page.selectOption('#localCommon-arrange', 'sort');
  await P.page.selectOption('#localCommon-first', 'top');
  // 名前欄で Enter を押してはじめても、数字キーが名前欄に入らない
  await P.page.focus('#localName1');
  await P.page.keyboard.press('Enter');
  await L.waitScreen(P, 'game');
  check('A2 local-start を数える', await L.waitStats(P, 'local-start', 1));
  check('A3 ルームバーは出ない', !(await L.visible(P, '#roomBar')));
  check('A4 3・2・1', (await L.turnLine(P)).includes('そら からはじまるよ') && (await L.trayCount(P)) === 0);
  await P.page.clock.runFor(3200);
  await L.waitActive(P);
  check('A5 1台の画面はいつも答えられる', true);
  check('A6 PC では数字ボタンを出さない', !(await L.visible(P, '.cb-pad')) && await L.visible(P, '.cb-answer'));
  check('A7 そろえる: 金額の大きい順に並ぶ', await P.page.$$eval('#tray text', (ts) => ts.map((t) => Number(t.textContent)).every((v, i, a) => i === 0 || a[i - 1] >= v)));

  // ── B. まちがい・正解・パス ──
  await P.page.keyboard.type('9');
  await P.page.keyboard.press('Backspace');
  check('B1 Backspace で消える', (await L.text(P, '#displayNum')) === '');
  const s1 = await L.traySum(P);
  await L.typeAnswer(P, s1 + 1);
  check('B2 まちがい', (await L.text(P, '#ngMsg')).includes('ちがうみたい'));
  await L.typeAnswer(P, s1);
  check('B3 正解の帯', (await L.text(P, '#trayBand')).includes('正解！'));
  await P.page.clock.runFor(1600);
  check('B4 相手の番', await waitFor(async () => (await L.turnLine(P)).includes('みどり の番')));
  check('B5 1・10・100円だけ（みんな同じ）', await P.page.$$eval('#tray text', (ts) => ts.every((t) => ['1', '10', '100'].includes(t.textContent))));
  await P.page.click('.cb-passbtn');
  check('B6 パスの間は小銭をかくす', (await L.trayCount(P)) === 0 && (await L.text(P, '#trayOver')).includes('パス'));
  await P.page.clock.runFor(3100);
  await L.waitActive(P);
  check('B7 パスのあと同じ人に次の小銭', (await L.turnLine(P)).includes('みどり の番') && (await L.trayCount(P)) === 2);

  // 画面の数字ボタンを出す
  await P.page.click('.cb-padtoggle');
  check('B8 「画面の数字ボタンを出す」で出る', await L.visible(P, '.cb-pad') && (await L.text(P, '.cb-padtoggle')) === '画面の数字ボタンをかくす');
  await P.page.click('.cb-pad .cb-key >> text=1');
  check('B9 画面のボタンでも入る', (await L.text(P, '#displayNum')) === '1');
  await P.page.click('.cb-pad .cb-key--sub');
  await L.shot(P, 'local-pad-pc', { fullPage: false });
  await P.page.click('.cb-padtoggle');
  check('B10 かくせる', !(await L.visible(P, '.cb-pad')));

  // ── C. 読み込み直し（続きから） ──
  const clocksBefore = await L.clocks(P);
  await P.page.reload();
  await L.waitScreen(P, 'game');
  check('C1 読み込み直すと続きから（3・2・1・「からつづけるよ」）', (await L.turnLine(P)).includes('みどり からつづけるよ'), await L.turnLine(P));
  const clocksAfter = await L.clocks(P);
  check('C2 残り時間はおぼえている', Math.abs(clocksAfter[0] - clocksBefore[0]) <= 1 && Math.abs(clocksAfter[1] - clocksBefore[1]) <= 1, [clocksBefore, clocksAfter]);

  // ── D. 時間切れ・結果 ──
  await P.page.clock.runFor(3200);
  await L.waitActive(P);
  await P.page.clock.runFor(61000);
  check('D1 時計が0で負け', await waitFor(async () => (await L.turnLine(P)).includes('そら の勝ち')), await L.turnLine(P));
  check('D2 local-finish を数える', await L.waitStats(P, 'local-finish', 1));
  check('D3 時間切れの小銭の合計', (await L.text(P, '#trayBand')).includes('この小銭は'));
  check('D4 結果の一覧（正解・パス・時間切れ）', (await P.page.$$('.cb-hist')).length === 3);
  check('D5 結果のボタン', (await L.text(P, '#resultBox')).includes('もう一回（先に答える人をかえる）') && (await L.text(P, '#resultBox')).includes('名前や設定を変える'));
  await L.shot(P, 'local-result-pc');
  await P.page.click('#resultBox .btn-primary');
  check('D6 もう一回は先に答える人を次の人にかえる', await waitFor(async () => (await L.turnLine(P)).includes('みどり からはじまるよ')));
  // C で読み込み直したので、テスト用の数えた記録はそこで 0 から
  check('D7 もう一回も local-start を数える', await L.waitStats(P, 'local-start', 1));
  await P.page.click('#tools .cb-quiet');
  await L.waitScreen(P, 'top');
  check('D8 「この対決をやめる」でトップへ', true);

  // ── E. いっしょに数える ──
  await P.page.click('#btnGoCount');
  await L.waitScreen(P, 'count');
  check('E1 count-start を数える', await L.waitStats(P, 'count-start', 1));
  check('E2 はじめは3枚', (await P.page.$$('#countTray g')).length === 3);
  await P.page.keyboard.press('Enter');
  check('E3 Enter で答えを見る', (await L.text(P, '#countAnswer')).includes('ぜんぶで') && (await L.text(P, '#btnCountGo')) === '次の小銭');
  await P.page.click('[aria-label="1枚ふやす"]');
  check('E4 枚数を変えると新しい小銭', (await P.page.$$('#countTray g')).length === 4 && (await L.text(P, '#countAnswer')) === '');
  await P.page.click('#countOpts .cb-seg__btn >> text=1・10・100円だけ');
  check('E5 種類を変えられる', await P.page.$$eval('#countTray text', (ts) => ts.every((t) => ['1', '10', '100'].includes(t.textContent))));
  await L.shot(P, 'count-pc', { fullPage: false });
  await P.page.click('#btnCountBack');
  await L.waitScreen(P, 'top');

  // ── F. スマホ幅 ──
  const M = await L.newClient('mobile', { viewport: { width: 375, height: 812 }, mobile: true });
  await M.page.clock.install();
  await L.open(M);
  check('F1 トップがはみ出さない', (await L.overflow(M)) <= 0);
  await M.page.click('#btnGoLocal');
  check('F2 準備の画面がはみ出さない', (await L.overflow(M)) <= 0);
  await M.page.click('#btnLocalStart');
  await M.page.clock.runFor(3200);
  await L.waitActive(M);
  check('F3 スマホでは数字ボタンを出し、切りかえのリンクは出さない', await L.visible(M, '.cb-pad') && !(await L.visible(M, '.cb-padtoggle')));
  check('F4 スマホの案内は「下のボタンで入力」', await M.page.$eval('.cb-touch-only', (n) => getComputedStyle(n).display !== 'none'));
  const ms = await L.traySum(M);
  for (const ch of String(ms)) await M.page.click('.cb-pad .cb-key >> text="' + ch + '"');
  await M.page.click('.cb-okkey');
  check('F5 数字ボタンで答えられる', (await L.text(M, '#trayBand')).includes('正解！'));
  check('F6 対決の画面がはみ出さない', (await L.overflow(M)) <= 0);
  await L.shot(M, 'local-mobile', { fullPage: false });
  await M.page.click('#tools .cb-quiet');
  await L.waitScreen(M, 'top');
  await M.page.click('#btnGoCount');
  check('F7 いっしょに数えるがはみ出さない', (await L.overflow(M)) <= 0);
  await L.shot(M, 'count-mobile', { fullPage: false });

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
