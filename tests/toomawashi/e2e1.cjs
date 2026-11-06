// とおまわしクイズ E2E その1: ホストの参加のしかたと、お題の見え方
//  A. ホストが説明役の順番に入る（既定）: ホストの番はお題が見える。ほかの人の番はお題を出さず、聞き手として答える
//  B. ホストが進行役（順番に入らない）: これまでどおり進行用にお題と言っちゃダメことばが見え、答えない
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── A. ホストも説明役の順番に入る ──
  const H = await L.newClient('host');
  const A = await L.newClient('yu', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('haru');
  const code = await L.createRoom(H, 'メンター');
  check('A1 ルームを作れる', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('A2 既定は「自分も説明役の順番に入る」', await H.page.isChecked('#set-host-plays'));
  await L.joinRoom(A, 'ゆう', code);
  await L.joinRoom(B, 'はる', code);
  await H.page.waitForFunction(() => !document.getElementById('btn-start').disabled);
  await H.page.click('#btn-start');
  await L.waitVisible(H, '#round-explainer');

  // 1人めはホスト: ホストにお題が見える
  const topic1 = (await L.text(H, '#explain-topic')).trim();
  check('A3 ホストの番はお題が見える', topic1.length > 0, topic1);
  check('A4 ホストの番は聞き手の欄なし', !(await L.visible(H, '#round-listener')));
  await L.waitVisible(A, '#round-listener');
  check('A5 聞き手にお題は書かれない', !(await L.domHas(A, topic1)));
  await H.page.click('#round-hostbar button[onclick="revealNow()"]');
  await L.waitVisible(H, '#reveal-judge');
  await H.page.click('#reveal-judge button[onclick="judgeRound(false)"]');

  // 2人めはゆう: ホストは聞き手になる
  await L.waitVisible(A, '#round-explainer');
  const topic2 = (await L.text(A, '#explain-topic')).trim();
  check('A6 ゆうの番はゆうにお題が見える', topic2.length > 0, topic2);
  await L.waitVisible(H, '#round-listener');
  check('A7 ホストに進行用のお題を出さない', !(await L.visible(H, '#round-hostpeek')));
  check('A8 ホストの画面のどこにもお題を書かない', !(await L.domHas(H, topic2)), topic2);
  check('A9 進行用の欄は空', (await L.text(H, '#hostpeek-topic')) === '' && (await L.text(H, '#hostpeek-ng')) === '');
  check('A10 ホストの画面に説明役の欄なし', !(await L.visible(H, '#round-explainer')) && (await L.text(H, '#explain-topic')) === '');
  check('A11 ホストに進行のボタンは出る', await L.visible(H, '#round-hostbar'));
  check('A12 はるにもお題を書かない', !(await L.domHas(B, topic2)));

  // ホストも答えられる。答えの全文は出さず人数だけ
  await L.waitVisible(H, '#listener-choices button');
  await H.page.click('#listener-choices button');
  await L.waitVisible(H, '#listener-mine');
  const hostAns = (await L.text(H, '#listener-mine-text')).trim();
  let room = await L.roomOf(code);
  check('A13 ホストの答えが届く', room.round && room.round.answers && room.round.answers['メンター'] && room.round.answers['メンター'].text === hostAns, room.round && room.round.answers);
  await H.page.fill('#listener-input', 'じぶんで書いた');
  await H.page.click('#round-listener button[onclick="submitTypedAnswer()"]');
  await L.waitText(H, '#listener-mine-text', 'じぶんで書いた');
  check('A14 ホストも書いて答えを上書きできる', true);
  check('A15 ホストに答えの全文は出さない', !(await L.visible(H, '#round-answers-card')) && (await L.text(H, '#round-answers')) === '');
  await L.waitText(H, '#round-answers-count', '1人が答えた');
  check('A16 ホストには答えた人数だけ', await L.visible(H, '#round-answers-count'));
  await L.waitText(A, '#round-answers', 'じぶんで書いた');
  check('A17 説明役にはホストの答えが見える', true);
  await L.shot(H, 'a-host-listener');

  // 正解発表でお題とホストの答えが出る
  await H.page.click('#round-hostbar button[onclick="revealNow()"]');
  await L.waitVisible(H, '#reveal-judge');
  check('A18 正解発表でホストにもお題が出る', (await L.text(H, '#reveal-topic')).trim() === topic2);
  check('A19 正解発表にホストの答え', (await L.text(B, '#reveal-answers')).includes('じぶんで書いた'));
  await H.page.click('#reveal-judge button[onclick="judgeRound(true)"]');

  // 3人めはる: 前のお題が残らず、ホストはまた聞き手
  await L.waitVisible(B, '#round-explainer');
  const topic3 = (await L.text(B, '#explain-topic')).trim();
  await L.waitVisible(H, '#round-listener');
  check('A20 次の人の番もホストにお題を書かない', !(await L.domHas(H, topic3)), topic3);
  check('A21 入力欄は新しいお題で空になる', (await H.page.inputValue('#listener-input')) === '' && !(await L.visible(H, '#listener-mine')));

  // 幅 375px で横にはみ出さない（ゆう）
  check('A22 375px で横にはみ出さない', (await L.overflow(A)) <= 0);

  // ── B. ホストが進行役 ──
  const H2 = await L.newClient('host2');
  const C = await L.newClient('sora');
  const D = await L.newClient('mio');
  const code2 = await L.createRoom(H2, 'しんこう');
  await H2.page.click('#set-host-plays');
  await H2.page.waitForFunction(() => !document.getElementById('set-host-plays').disabled);
  await sleep(300);
  let room2 = await L.roomOf(code2);
  check('B1 進行役を選べる', room2.settings && room2.settings.hostPlays === false, room2.settings);
  await L.joinRoom(C, 'そら', code2);
  await L.joinRoom(D, 'みお', code2);
  await H2.page.waitForFunction(() => !document.getElementById('btn-start').disabled);
  await H2.page.click('#btn-start');
  await L.waitVisible(C, '#round-explainer');
  const topicB = (await L.text(C, '#explain-topic')).trim();
  await L.waitVisible(H2, '#round-hostpeek');
  check('B2 進行役には進行用のお題が出る', (await L.text(H2, '#hostpeek-topic')).trim() === topicB, topicB);
  check('B3 進行役には言っちゃダメことばも出る', (await L.text(H2, '#hostpeek-ng')).includes('言っちゃダメことば'));
  check('B4 進行役は答えない', !(await L.visible(H2, '#round-listener')));
  check('B5 進行役には答えの全文の欄', await L.visible(H2, '#round-answers-card'));
  check('B6 聞き手のみおにはお題を書かない', !(await L.domHas(D, topicB)));
  await L.shot(H2, 'b-facilitator');

  await L.finishAll(server);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
