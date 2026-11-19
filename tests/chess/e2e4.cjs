// チェスの E2E その4: ルールの板（2026-11-19。バーの「ルール」・開いたまま指せる・中身は持ち時間と相手に合わせる・
// 広い画面は右に、せまい画面は下から・待合室でも見られる・みんなにみせる画面には出さない）
const path = require('path');
const L = require('./lib.cjs');
const { check, sq, waitFor } = L;

const tabsOf = (c) => c.page.$$eval('#ruleTabs button', (xs) => xs.map((x) => x.textContent));
const pageText = (c, tab) => c.page.$eval('#ruleBody [data-tab="' + tab + '"]', (n) => n.textContent);
const fig = (c, i) => c.page.$eval('#ruleBody [data-tab="piece"] .ch-mv >> nth=' + i, (n) => ({
  bars: n.querySelectorAll('.ch-mv__bar').length,
  dots: n.querySelectorAll('.ch-mv__dot:not(.is-jump):not(.is-first)').length,
  jumps: n.querySelectorAll('.ch-mv__dot.is-jump').length,
  first: n.querySelectorAll('.ch-mv__dot.is-first').length,
  rings: n.querySelectorAll('.ch-mv__ring').length,
  label: n.getAttribute('aria-label'),
}));

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── 1台の画面・人どうし・広い画面 ──
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
  const piece = await pageText(M, 'piece');
  check('R6 駒6つ', ['キング', 'クイーン', 'ルーク', 'ビショップ', 'ナイト', 'ポーン'].every((w) => piece.includes(w)));
  check('R7 図は6つ', (await M.page.$$('#ruleBody [data-tab="piece"] .ch-mv')).length === 6);
  const [k, q, r, b, n, p] = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => fig(M, i)));
  check('R8 キングは点8つ', k.dots === 8 && k.bars === 0 && k.label === 'キングの動き', k);
  check('R9 クイーンは線16本・ルークとビショップは8本', q.bars === 16 && r.bars === 8 && b.bars === 8 && !q.dots, [q, r, b]);
  check('R10 ナイトは跳ぶ所8つ', n.jumps === 8 && !n.dots && !n.bars, n);
  check('R11 ポーンは前1・はじめの2マス目・取る所2つ', p.dots === 1 && p.first === 1 && p.rings === 2, p);
  check('R12 広い画面は右に立て、盤と札は左に収まる', await M.page.evaluate(() => {
    const pp = document.getElementById('rulePanel').getBoundingClientRect();
    const bb = document.getElementById('board').getBoundingClientRect();
    const s = document.getElementById('sideBottom').getBoundingClientRect();
    return pp.right >= window.innerWidth - 1 && pp.height >= window.innerHeight - 1 && bb.right <= pp.left && s.right <= pp.left;
  }));
  check('R13 広い画面: はみ出さない', (await L.overflow(M)) <= 0, await L.overflow(M));
  await M.page.locator('#rulePanel').screenshot({ path: path.join(L.OUT, 'e2e4-pieces.png') });
  await M.page.click('#ruleTabs button:text-is("指しかた")');
  check('R14 タブの切りかえ', (await L.visible(M, '#ruleBody [data-tab="play"]')) && !(await L.visible(M, '#ruleBody [data-tab="piece"]')));
  const play = await pageText(M, 'play');
  check('R15 特別な手（成る・キャスリング・アンパッサン）', play.includes('キャスリング') && play.includes('アンパッサン') && play.includes('プロモーション'));
  const end0 = await pageText(M, 'end');
  check('R16 勝ち負け: メイト・引き分け4つ・時間なし', end0.includes('チェックメイト') && end0.includes('ステイルメイト') && end0.includes('50手') && end0.includes('同じ形が3回') && !end0.includes('秒読み'));
  const now0 = await pageText(M, 'now');
  check('R17 いまの設定（持ち時間なし・相手の行はない）', now0.includes('持ち時間なし') && now0.includes('補助') && !now0.includes('相手'), now0);
  await L.move(M, sq('e2'), sq('e4'));
  check('R18 開いたまま指せる', await waitFor(async () => (await L.lastLine(M)).startsWith('1手目'), 3000), await L.lastLine(M));
  check('R19 指しても板は開いたまま・タブもそのまま', (await L.visible(M, '#rulePanel')) && (await L.visible(M, '#ruleBody [data-tab="play"]')));
  await L.shot(M, 'e2e4-wide', { fullPage: false });
  await M.page.click('#ruleTabs button:text-is("勝ち負け")');
  await M.page.keyboard.press('Escape');
  check('R20 Esc で閉じてボタンへもどる', !(await L.visible(M, '#rulePanel')) && (await M.page.evaluate(() => document.activeElement?.id === 'btnRules')));

  // ── 1台の画面・CPU と・持ち時間・幅 375px ──
  await M.page.click('#btnResign');
  await L.waitVisible(M, '#btnRelobby');
  await M.page.click('#btnRelobby');
  await L.waitScreen(M, 'local');
  await M.page.click('#localVs input[value="1"]');
  await M.page.selectOption('#localClockMain', '10');
  await M.page.selectOption('#localClockByo', '30');
  await M.page.setViewportSize({ width: 375, height: 812 });
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  await M.page.click('#btnRules');
  await L.waitVisible(M, '#rulePanel');
  check('R21 せまい画面は下から出す', await M.page.evaluate(() => {
    const pp = document.getElementById('rulePanel').getBoundingClientRect();
    return pp.left === 0 && Math.abs(pp.bottom - window.innerHeight) < 1 && pp.height < window.innerHeight * 0.5;
  }));
  check('R22 盤は板の上に入る', await M.page.evaluate(() => {
    const pp = document.getElementById('rulePanel').getBoundingClientRect();
    const bb = document.getElementById('board').getBoundingClientRect();
    return bb.top >= 0 && bb.bottom <= pp.top + 1;
  }), await M.page.evaluate(() => [document.getElementById('board').getBoundingClientRect().top, document.getElementById('board').getBoundingClientRect().bottom, document.getElementById('rulePanel').getBoundingClientRect().top]));
  check('R23 375px: はみ出さない', (await L.overflow(M)) <= 0, await L.overflow(M));
  check('R24 丸ボタンを隠す', await M.page.evaluate(() => [...document.querySelectorAll('.howto-fab, .howto-feedback-fab')].every((x) => !x.getClientRects().length)));
  // 持ち時間・相手に合わせて中身が変わる（タブは前に見ていた「勝ち負け」のまま）
  check('R25 タブは前のまま', await L.visible(M, '#ruleBody [data-tab="end"]'));
  check('R26 勝ち負けに秒読み 30秒', (await pageText(M, 'end')).includes('30秒'));
  const now = await pageText(M, 'now');
  check('R27 いまの設定に持ち時間と CPU', now.includes('10分・秒読み 30秒') && now.includes('CPU（ふつう）'), now);
  await M.page.click('#ruleTabs button:text-is("駒の動き")');
  await L.move(M, sq('d2'), sq('d4'));
  check('R28 375px でも開いたまま指せる', await waitFor(async () => /^[12]手目/.test(await L.lastLine(M)), 3000), await L.lastLine(M));
  await L.shot(M, 'e2e4-375', { fullPage: false });
  await M.page.click('#btnRulesClose');
  check('R29 × で閉じる・丸ボタンがもどる', !(await L.visible(M, '#rulePanel')) && (await M.page.evaluate(() => [...document.querySelectorAll('.howto-fab')].every((x) => x.getClientRects().length > 0))));
  await M.page.click('#btnRules');
  await M.page.click('#btnQuit');
  await L.waitScreen(M, 'top');
  check('R30 トップへもどると閉じる', !(await L.visible(M, '#rulePanel')) && !(await M.page.evaluate(() => document.documentElement.classList.contains('ch-rules-open'))));

  // ── ルーム: 待合室でも見られる・みんなにみせる画面には出さない ──
  const H = await L.newClient('host');
  await H.page.setViewportSize({ width: 1280, height: 860 });
  const code = await L.createRoom(H, 'あおい');
  check('R31 待合室に「ルール」', await L.visible(H, '#btnRules'));
  await H.page.click('#btnRules');
  await L.waitVisible(H, '#rulePanel');
  check('R32 待合室ではルームの設定', (await pageText(H, 'now')).includes('補助'));
  await L.shot(H, 'e2e4-waiting', { fullPage: false });
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('R33 みんなにみせる画面には出さない', !(await L.visible(W, '#btnRules')));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
