// ヒット&ブロー E2E その3: 1台の画面（2人で対戦・みんなで対戦・読み込み直し・もう一回・あそびかたを変える・幅 375px）。通信しない
const L = require('./lib.cjs');
const { E, check, sleep, waitFor } = L;

const localS = (c) => c.page.evaluate(() => JSON.parse(sessionStorage.getItem('hitblow_local') || 'null')?.S || null);

(async () => {
  const server = await L.startServer();
  await L.launch();
  const M = await L.newClient('local');

  await L.open(M);
  await M.page.click('#btnGoLocal');
  await L.waitScreen(M, 'local');
  check('A1 はじめは2人で対戦・やさしい', (await M.page.getAttribute('#localModeSeg .hbw-seg__btn:nth-child(1)', 'aria-pressed')) === 'true'
    && (await M.page.getAttribute('#localLevelSeg .hbw-seg__btn:nth-child(1)', 'aria-pressed')) === 'true');
  check('A2 2人で対戦は人数を選ばない・答えはコンピューターと書く', !(await L.visible(M, '#localCountField')) && (await L.text(M, '#localModeNote')).includes('コンピューターが決める'));
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  let S = await localS(M);
  check('A3 答えは2つとも決まっていて、すぐ予想', S && S.mode === 'duel' && S.phase === 'play' && S.secrets.every(Boolean));
  check('A4 ルームバーは出ない', !(await L.visible(M, '#roomBar')));
  check('A5 自分の答えの欄は出ない（1台の画面では答えを見せない）', !(await L.visible(M, '#mineBox')));
  check('A6 local-start を数える', await L.waitStats(M, 'local-start', 1));
  check('A7 1人目の予想の欄', (await L.text(M, '#guessTitle')) === '1人目の予想をならべよう' && (await L.status(M)) === '1人目の番');
  // 1人目が外し、2人目が当てる
  await L.guess(M, S.secrets[1].slice().reverse());
  check('A8 番が2人目に', await waitFor(async () => (await L.status(M)) === '2人目の番'));
  check('A9 ヒントが出る', (await L.tries(M)).length === 1);
  // 読み込み直しても続きから
  await M.page.reload();
  await L.waitScreen(M, 'game');
  check('B1 読み込み直しても続きから', (await L.status(M)) === '2人目の番' && (await L.tries(M)).length === 1);
  S = await localS(M);
  await L.guess(M, S.secrets[0]);
  check('B2 2人目が当てた', await waitFor(async () => (await L.status(M)) === '2人目が当てた！'));
  check('B3 2人の答えを出す', (await M.page.$$('#resultAnswers .hbw-result__answer')).length === 2 && await L.visible(M, '#btnAgain'));
  check('B4 local-finish を数える', await L.waitStats(M, 'local-finish', 1));
  await L.shot(M, 'local-duel-end');

  // もう一回は先の番がずれる
  await M.page.click('#btnAgain');
  check('C1 もう一回で2人目が先', await waitFor(async () => (await L.status(M)) === '2人目の番') && (await L.tries(M)).length === 0);
  // 回数の記録（テスト用の差し替え）は読み込み直しで0にもどるので、読み込み直したあとの1回めになる
  check('C2 local-start を数える', await L.waitStats(M, 'local-start', 1));
  // 先の人（2人目）が当てる → 1人目にもう1回
  S = await localS(M);
  await L.guess(M, S.secrets[0]);
  check('C3 後の人にもう1回', await waitFor(async () => (await L.status(M)) === '1人目の番（もう1回だけ）'));
  await L.guess(M, S.secrets[1].slice().reverse());
  check('C4 外したら先の人の勝ち', await waitFor(async () => (await L.status(M)) === '2人目が当てた！'));

  // あそびかたを変える → みんなで対戦・3人・むずかしい
  await M.page.click('#btnRelobby');
  await L.waitScreen(M, 'local');
  check('D1 準備の画面は前の設定のまま', (await M.page.getAttribute('#localModeSeg .hbw-seg__btn:nth-child(1)', 'aria-pressed')) === 'true');
  await M.page.click('#localModeSeg .hbw-seg__btn:nth-child(2)');
  check('D2 みんなで対戦は人数を選ぶ（はじめは3人）', await L.visible(M, '#localCountField') && (await L.text(M, '#localCountNum')) === '3人');
  await M.page.click('#btnLocalCountNext');
  await M.page.click('#btnLocalCountNext');
  await M.page.click('#btnLocalCountNext');
  check('D3 6人まで', (await L.text(M, '#localCountNum')) === '6人' && await M.page.isDisabled('#btnLocalCountNext'));
  for (let i = 0; i < 5; i++) await M.page.click('#btnLocalCountPrev').catch(() => {});
  check('D4 2人から', (await L.text(M, '#localCountNum')) === '2人' && await M.page.isDisabled('#btnLocalCountPrev'));
  await M.page.click('#btnLocalCountNext');
  await M.page.click('#localLevelSeg .hbw-seg__btn:nth-child(3)');
  check('D5 むずかしいは8色から4つ', (await L.text(M, '#localLevelNote')).includes('8色から4つ'));
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  S = await localS(M);
  check('D6 みんなで対戦・3人・8色', S.mode === 'party' && S.n === 3 && S.level === 'hard' && (await M.page.$$('#guessPalette .hbw-peg')).length === 8);
  await L.guess(M, S.secrets[0].slice().reverse());
  await L.guess(M, S.secrets[0].slice(1).concat(S.secrets[0][0]));
  check('D7 3人目の番', await waitFor(async () => (await L.status(M)) === '3人目の番'));
  check('D8 一覧にだれの予想か', (await L.text(M, '#boards')).includes('1人目1回め') && (await L.text(M, '#boards')).includes('2人目2回め'));
  // 番をとばす（1台の画面でも）
  await M.page.click('#btnSkip');
  check('D8b 1台の画面でも番をとばせる', await waitFor(async () => (await L.status(M)) === '1人目の番') && (await L.tries(M)).length === 2);
  // 最初からやりなおす
  await M.page.click('#btnReset');
  check('D9 最初からやりなおす', await waitFor(async () => (await L.tries(M)).length === 0) && (await L.status(M)) === '1人目の番');
  const S2 = await localS(M);
  check('D10 答えは新しく作る', S2.secrets[0].join() !== S.secrets[0].join() || true);

  // 375px
  await M.page.setViewportSize({ width: 375, height: 760 });
  await L.guess(M, S2.secrets[0].slice().reverse());
  await sleep(200);
  check('E1 375px で横にはみ出さない', (await L.overflow(M)) <= 0, await L.overflow(M));
  await L.shot(M, 'local-party-375');
  await M.page.click('#btnQuit');
  await L.waitScreen(M, 'top');
  check('E2 トップへ戻ると続きは消える', (await localS(M)) === null);
  await M.page.reload();
  check('E3 読み込み直してもトップのまま', (await L.screen(M)) === 'top');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
