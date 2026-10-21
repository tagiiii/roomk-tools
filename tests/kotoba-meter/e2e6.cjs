// ことばメーター E2E その6: 個人戦の点と順位（ぴったり2点・1つちがい1点・出題者はぴったりの人がいれば2点・パスと未回答は点なし・同点は同じ順位・0にもどす・退出）
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yu', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('haru');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });
  const raw = (c, payload) => c.page.evaluate(async (p) => {
    const session = JSON.parse(sessionStorage.getItem('roomk-kotoba-meter-cloud-session'));
    const round = (await window.MeterCloud.request('/api/state?code=' + session.code, null, session, false)).state.round;
    try { await window.MeterCloud.request('/api/action', { code: session.code, round, ...p }, session, false); return 'ok'; }
    catch (e) { return e.message; }
  }, payload);
  const far = (secret) => [1, 2, 3, 4, 5].find((n) => Math.abs(n - secret) >= 2);
  const near = (secret) => (secret < 5 ? secret + 1 : secret - 1);
  const rows = (c) => c.page.$$eval('#ranking-list .km-rank', (ls) => ls.map((l) => [...l.children].map((x) => x.textContent).join('|') + (l.classList.contains('is-top') ? '|TOP' : '')));

  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'ゆう', code);
  await L.joinRoom(B, 'はる', code);
  await H.page.fill('#proxy-name', 'ゆい');
  await H.page.click('#proxy-add');
  await L.waitText(H, '#people-title', '4人');
  await L.openWatch(W, code);
  check('A1 点がないうちは待合室に順位表を出さない', !(await L.visible(H, '#ranking')));

  // ── B. ラウンド1（出題者: 進行役） ──
  await H.page.click('#start');
  await L.waitVisible(H, '#secret-area');
  let room = await L.roomOf(code);
  const s1 = room.secret;
  await L.sendHint(H, 'ふわふわの毛布');
  await L.waitVisible(A, '#vote-area');
  await L.answer(A, s1);                       // ぴったり
  await L.waitVisible(B, '#vote-area');
  await L.answer(B, near(s1));                 // 1つちがい
  await L.waitVisible(H, '#proxy-area');
  await H.page.click(`#proxy-rows button[aria-label="ゆいさん：${far(s1)}"]`);   // 2つ以上ちがい
  await L.waitText(H, '#progress', '3 / 3');
  await H.page.click('#reveal');
  await L.waitVisible(W, '#result-area');
  room = await L.roomOf(code);
  const id = (name) => Object.entries(room.players).find(([, p]) => p.name === name)[0];
  check('B1 ぴったり2点・1つちがい1点・ちがう0点', room.scores[id('ゆう')] === 2 && room.scores[id('はる')] === 1 && room.scores[id('ゆい')] === 0, room.scores);
  check('B2 出題者はぴったりの人がいれば2点', room.scores[id('メンター')] === 2);
  await L.waitText(W, '#ranking-list', 'ゆう');
  await sleep(800);
  const r1 = await rows(W);
  console.log('  ', JSON.stringify(r1));
  check('B3 同点は同じ順位（1,1,3）・1位に印', r1[0].startsWith('1位') && r1[1].startsWith('1位') && r1[2].startsWith('3位|はる') && r1[3].startsWith('4位|ゆい') && r1[0].endsWith('TOP') && r1[1].endsWith('TOP') && !r1[2].endsWith('TOP'), r1);
  check('B4 今回の点（出題者は「出題」）', r1.some((r) => r.includes('メンター|出題 +2|2点')) && r1.some((r) => r.includes('はる|+1|1点')) && r1.some((r) => r.includes('ゆい|+0|0点')));
  const chips = await W.page.$$eval('#result-columns .km-column__name', (cs) => cs.map((c) => c.textContent));
  check('B5 結果の名前に +点（0点には付けない）', chips.includes('ゆう+2') && chips.includes('はる+1') && chips.includes('ゆい'), chips);
  check('B6 参加者の画面にも順位表', await L.visible(A, '#ranking'));
  check('B7 「点を0にもどす」は進行役だけ', await L.visible(H, '#scores-reset') && !(await L.visible(A, '#scores-reset')));
  check('B8 みんなにみせる画面で「話してみよう」まで720に入る', await W.page.evaluate(() => document.querySelector('.km-talk').getBoundingClientRect().bottom <= innerHeight));
  await L.shot(W, 'b-points-watch', true);
  await L.shot(A, 'b-points-guest-375');

  // ── C. ラウンド2（出題者: ゆう。ぴったりなし・パス・未回答） ──
  await H.page.click('#start');
  await L.waitVisible(A, '#secret-area');
  check('C1 始まると今回の点は消える', !(await L.roomOf(code)).roundPoints);
  const s2 = (await L.roomOf(code)).secret;
  await L.sendHint(A, 'りんご');
  await L.waitVisible(H, '#vote-area');
  await L.answer(H, far(s2));
  await L.waitVisible(B, '#vote-area');
  await B.page.click('#pass');
  await B.page.waitForFunction(() => document.getElementById('pass').getAttribute('aria-pressed') === 'true');
  await H.page.click('#reveal');                // ゆいは未回答のまま
  await L.waitVisible(H, '#result-area');
  room = await L.roomOf(code);
  check('C2 ぴったりの人がいなければ出題者は0点・合計は変わらない', room.scores[id('ゆう')] === 2 && room.scores[id('メンター')] === 2 && room.scores[id('はる')] === 1 && room.scores[id('ゆい')] === 0, room.scores);
  check('C3 パスと未回答は点の対象外', room.roundPoints[id('はる')] === undefined && room.roundPoints[id('ゆい')] === undefined && room.roundPoints[id('メンター')] === 0);
  await L.waitText(H, '#ranking-list', '出題 +0');
  const r2 = await rows(H);
  check('C4 パス・未回答は「—」', r2.some((r) => r.includes('はる|—|1点')) && r2.some((r) => r.includes('ゆい|—|0点')), r2);

  // ── D. 0にもどす・退出 ──
  check('D1 参加者は0にもどせない', (await raw(A, { action: 'scores-reset' })) !== 'ok' && (await L.roomOf(code)).scores);
  await H.page.click('#scores-reset');
  await H.page.waitForFunction(() => !document.getElementById('ranking-list').textContent.match(/[1-9]点/));
  room = await L.roomOf(code);
  check('D2 0にもどすと点が消える', !room.scores && !room.roundPoints);
  check('D3 0にもどすとリセットのボタンは消える', !(await L.visible(H, '#scores-reset')));
  // もう1ラウンドして点をつけ、退出した人の点は消える
  await H.page.waitForFunction(() => !document.getElementById('start').disabled);
  await sleep(500);
  await H.page.click('#start');
  await L.waitVisible(B, '#secret-area');    // 出題者: はる
  const s3 = (await L.roomOf(code)).secret;
  await L.sendHint(B, 'ねこ');
  await L.waitVisible(A, '#vote-area');
  await L.answer(A, s3);
  await H.page.click('#reveal');
  await L.waitVisible(H, '#result-area');
  room = await L.roomOf(code);
  const haruId = id('はる');
  check('D4 出題者（はる）も点が入る', room.scores[haruId] === 2 && room.scores[id('ゆう')] === 2);
  await B.page.click('#leave');
  await L.waitVisible(B, '#screen-top');
  await L.waitText(H, '#people-title', '3人');
  room = await L.roomOf(code);
  await L.waitText(H, '#people-title', '3人');
  await sleep(800);
  check('D5 退出した人の点は消え、順位表からも消える', room.scores[haruId] === undefined && !(await L.text(H, '#ranking-list')).includes('はる'), room.scores);
  await H.page.click('#start');
  await L.waitVisible(H, '#secret-area');     // はるが抜けたので、参加順で次は端末なしのゆい（進行役が代わりに出題）
  await H.page.click('#reset');
  await L.waitText(H, '#phase-title', 'みんながそろったら');
  check('D6 やり直したあとも、点があれば待合室に順位表', await L.visible(H, '#ranking'));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
