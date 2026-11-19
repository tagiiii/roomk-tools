// 将棋の E2E その5: ルールの板（2026-11-19。バーの「ルール」・開いたまま指せる・中身は盤に合わせる・
// 広い画面は右に、せまい画面は下から・待合室でも見られる・みんなにみせる画面には出さない）
const L = require('./lib.cjs');
const { check, cell, waitFor } = L;

const tabsOf = (c) => c.page.$$eval('#ruleTabs button', (xs) => xs.map((x) => x.textContent));
const pageText = (c, tab) => c.page.$eval('#ruleBody [data-tab="' + tab + '"]', (n) => n.textContent);

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── 1台の画面・5五将棋・広い画面 ──
  const M = await L.newClient('local');
  await M.page.setViewportSize({ width: 1280, height: 860 });
  await L.open(M);
  check('R1 はじめの画面にはルールのボタンを出さない（バーがない）', !(await L.visible(M, '#btnRules')));
  await M.page.click('#btnGoLocal');
  await L.waitScreen(M, 'local');
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  check('R2 対局の画面に「ルール」', await L.visible(M, '#btnRules'));
  await M.page.click('#btnRules');
  await L.waitVisible(M, '#rulePanel');
  check('R3 タブ', JSON.stringify(await tabsOf(M)) === JSON.stringify(['駒の動き', '指しかた', '勝ち負け', 'いまの設定']), await tabsOf(M));
  check('R4 開くと見出しへ', await M.page.evaluate(() => document.activeElement?.id === 'rulePanelTitle'));
  check('R5 aria-expanded', (await M.page.getAttribute('#btnRules', 'aria-expanded')) === 'true');
  const miniPiece = await pageText(M, 'piece');
  check('R6 5五将棋: 桂馬・香車は出さない', miniPiece.includes('飛車') && miniPiece.includes('龍（龍王）') && !miniPiece.includes('桂馬') && !miniPiece.includes('香車'));
  check('R7 駒の動きの図（駒6つ＋龍・馬）', (await M.page.$$('#ruleBody [data-tab="piece"] .sh-mv')).length === 8);
  check('R8 飛車の図は線が8本（4方向×2マス）', await M.page.$eval('#ruleBody .sh-rx__piece:nth-of-type(2) .sh-mv', (n) => n.querySelectorAll('.sh-mv__bar').length === 8 && n.querySelectorAll('.sh-mv__dot').length === 0));
  check('R9 広い画面は右に立て、盤は左に収まる', await M.page.evaluate(() => {
    const p = document.getElementById('rulePanel').getBoundingClientRect();
    const b = document.getElementById('board').getBoundingClientRect();
    const s = document.getElementById('sideBottom').getBoundingClientRect();
    return p.right >= window.innerWidth - 1 && p.height >= window.innerHeight - 1 && b.right <= p.left && s.right <= p.left;
  }));
  check('R10 広い画面: はみ出さない', (await L.overflow(M)) <= 0, await L.overflow(M));
  await M.page.locator('#rulePanel').screenshot({ path: require('path').join(L.OUT, 'e2e5-pieces.png') });
  await M.page.click('#ruleTabs button:text-is("指しかた")');
  check('R11 タブの切りかえ', (await L.visible(M, '#ruleBody [data-tab="play"]')) && !(await L.visible(M, '#ruleBody [data-tab="piece"]')));
  check('R12 5五将棋: 陣は奥の1段', (await pageText(M, 'play')).includes('奥の1段'));
  const miniEnd = await pageText(M, 'end');
  check('R13 5五将棋: 千日手は先手の負け・入玉宣言なし・時間なし', miniEnd.includes('5五将棋は先手の負け') && !miniEnd.includes('入玉宣言') && !miniEnd.includes('秒読み'));
  check('R14 いまの設定', (await pageText(M, 'now')).includes('5五将棋（5×5）'));
  // 開いたまま指せる（▲２四歩: 5五将棋の歩は 15 → 10）
  await L.move(M, 15, 10);
  check('R15 開いたまま指せる', await waitFor(async () => (await L.lastLine(M)).includes('▲'), 3000), await L.lastLine(M));
  check('R16 指しても板は開いたまま・タブもそのまま', (await L.visible(M, '#rulePanel')) && (await L.visible(M, '#ruleBody [data-tab="play"]')));
  await L.shot(M, 'e2e5-wide', { fullPage: false });
  await M.page.focus('#ruleTabs button:text-is("勝ち負け")');
  await M.page.keyboard.press('Escape');
  check('R17 Esc で閉じてボタンへもどる', !(await L.visible(M, '#rulePanel')) && (await M.page.evaluate(() => document.activeElement?.id === 'btnRules')));

  // ── 1台の画面・本将棋・持ち時間・幅 375px ──
  await M.page.click('#btnResign');
  await L.waitVisible(M, '#btnRelobby');
  await M.page.click('#btnRelobby');
  await L.waitScreen(M, 'local');
  await M.page.click('#localVariant input[value="hon"]');
  await M.page.selectOption('#localClockMain', '10');
  await M.page.selectOption('#localClockByo', '30');
  await M.page.setViewportSize({ width: 375, height: 812 });
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  await M.page.click('#btnRules');
  await L.waitVisible(M, '#rulePanel');
  check('R18 せまい画面は下から出す', await M.page.evaluate(() => {
    const p = document.getElementById('rulePanel').getBoundingClientRect();
    return p.left === 0 && Math.abs(p.bottom - window.innerHeight) < 1 && p.height < window.innerHeight * 0.5;
  }));
  check('R19 盤は板の上に入る', await M.page.evaluate(() => {
    const p = document.getElementById('rulePanel').getBoundingClientRect();
    const b = document.getElementById('board').getBoundingClientRect();
    return b.top >= 0 && b.bottom <= p.top + 1;
  }), await M.page.evaluate(() => [document.getElementById('board').getBoundingClientRect().bottom, document.getElementById('rulePanel').getBoundingClientRect().top]));
  check('R20 375px: はみ出さない', (await L.overflow(M)) <= 0, await L.overflow(M));
  check('R21 丸ボタンを隠す', await M.page.evaluate(() => [...document.querySelectorAll('.howto-fab, .howto-feedback-fab')].every((n) => !n.getClientRects().length)));
  // 本将棋に合わせて中身が変わる（タブは前に見ていた「勝ち負け」のまま）
  const honEnd = await pageText(M, 'end');
  check('R22 本将棋: 入玉宣言・引き分け・秒読み 30秒', honEnd.includes('入玉宣言') && honEnd.includes('本将棋は引き分け') && honEnd.includes('30秒'));
  check('R23 本将棋: 桂馬・香車', (await pageText(M, 'piece')).includes('桂馬') && (await pageText(M, 'piece')).includes('香車'));
  check('R24 本将棋: 陣は奥の3段', (await pageText(M, 'play')).includes('奥の3段'));
  check('R25 いまの設定に持ち時間', (await pageText(M, 'now')).includes('10分・秒読み 30秒'));
  await M.page.click('#ruleTabs button:text-is("駒の動き")');
  await L.move(M, 56, 47);   // ▲７六歩
  check('R26 375px でも開いたまま指せる', await waitFor(async () => (await L.lastLine(M)) === '1手目　▲７六歩', 3000), await L.lastLine(M));
  await L.shot(M, 'e2e5-375', { fullPage: false });
  await M.page.click('#btnRulesClose');
  check('R27 × で閉じる・丸ボタンがもどる', !(await L.visible(M, '#rulePanel')) && (await M.page.evaluate(() => [...document.querySelectorAll('.howto-fab')].every((n) => n.getClientRects().length > 0))));
  await M.page.click('#btnRules');
  await M.page.click('#btnQuit');
  await L.waitScreen(M, 'top');
  check('R28 トップへもどると閉じる', !(await L.visible(M, '#rulePanel')) && !(await M.page.evaluate(() => document.documentElement.classList.contains('sh-rules-open'))));

  // ── ルーム: 待合室でも見られる・みんなにみせる画面には出さない ──
  const H = await L.newClient('host');
  await H.page.setViewportSize({ width: 1280, height: 860 });
  const code = await L.createRoom(H, 'あおい');
  check('R29 待合室に「ルール」', await L.visible(H, '#btnRules'));
  await H.page.click('#btnRules');
  await L.waitVisible(H, '#rulePanel');
  check('R30 待合室ではルームの設定（5五将棋）', (await pageText(H, 'now')).includes('5五将棋'));
  await L.shot(H, 'e2e5-waiting', { fullPage: false });
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('R31 みんなにみせる画面には出さない', !(await L.visible(W, '#btnRules')));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
