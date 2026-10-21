// ことばメーター E2E その4: 端末なしの参加者（進行役が足す・代わりに予想を入力・その子が出題者の番は進行役が代わりに出題・外す）
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yu', { viewport: { width: 375, height: 812 } });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });
  // 画面を通さずに操作を送る（サーバー側の検査を確かめる）
  const raw = (c, payload) => c.page.evaluate(async (p) => {
    const session = JSON.parse(sessionStorage.getItem('roomk-kotoba-meter-cloud-session'));
    const round = (await window.MeterCloud.request('/api/state?code=' + session.code, null, session, false)).state.round;
    try { await window.MeterCloud.request('/api/action', { code: session.code, round, ...p }, session, false); return 'ok'; }
    catch (e) { return e.message; }
  }, payload);

  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'ゆう', code);
  await L.openWatch(W, code);
  await L.waitText(H, '#people-title', '2人');

  // ── A. 足す ──
  check('A1 進行役の準備に「端末なしの参加者を足す」', await L.visible(H, '#proxy-name') && await L.visible(H, '#proxy-add'));
  check('A2 参加者には出さない', !(await L.visible(A, '#proxy-name')));
  await H.page.fill('#proxy-name', 'ゆう');
  await H.page.click('#proxy-add');
  await L.waitToast(H, '使われている');
  check('A3 同じニックネームは足せない', (await H.page.inputValue('#proxy-name')) === 'ゆう');
  await sleep(400);
  await H.page.fill('#proxy-name', 'ゆい');
  await H.page.click('#proxy-add');
  await L.waitText(H, '#people-title', '3人');
  check('A4 足すと一覧に出て、入力欄は空になる', (await H.page.inputValue('#proxy-name')) === '');
  let room = await L.roomOf(code);
  const yuiId = Object.entries(room.players).find(([, p]) => p.name === 'ゆい')[0];
  check('A5 在室を持たない参加者として保存', room.players[yuiId].proxy === true && !room.players[yuiId].uid && room.playerOrder.at(-1) === yuiId);
  check('A6 「端末なし」の印は進行役の画面だけ', (await L.text(H, '#players')).includes('端末なし'));
  await L.waitText(A, '#people-title', '3人');
  check('A7 参加者・みんなにみせる画面には印を出さない', !(await L.text(A, '#players')).includes('端末なし') && !(await L.text(W, '#players')).includes('端末なし'));
  check('A8 接続待ちにならない', !(await L.text(H, '#players')).includes('接続待ち'));
  check('A9 参加者は代わりの入力を送れない', (await raw(A, { action: 'proxy-add', name: 'そら' })) !== 'ok');
  await L.shot(H, 'a-proxy-lobby');

  // ── B. 代わりに予想を入力 ──
  await H.page.click('#start');
  await L.waitVisible(H, '#secret-area');
  await L.sendHint(H, 'ふわふわの毛布');
  await L.waitVisible(H, '#proxy-area');
  check('B1 進行役の画面に代わりに入力する欄', (await L.text(H, '#proxy-rows')).includes('ゆい'));
  await sleep(1200);
  check('B2 参加者・みんなにみせる画面には出さない', !(await L.visible(A, '#proxy-area')) && !(await L.visible(W, '#proxy-area')));
  await H.page.click('#proxy-rows button[aria-label="ゆいさん：4"]');
  await H.page.waitForFunction(() => document.querySelector('#proxy-rows button[aria-label="ゆいさん：4"]')?.getAttribute('aria-pressed') === 'true');
  room = await L.roomOf(code);
  check('B3 その子の予想として保存', room.answers[yuiId] === 4);
  await H.page.click('#proxy-rows button[aria-label="ゆいさん：パス"]');
  await H.page.waitForFunction(() => document.querySelector('#proxy-rows button[aria-label="ゆいさん：パス"]')?.getAttribute('aria-pressed') === 'true');
  check('B4 パスも選べる', (await L.roomOf(code)).answers[yuiId] === 0);
  await H.page.click('#proxy-rows button[aria-label="ゆいさん：5"]');
  await H.page.waitForFunction(() => document.querySelector('#proxy-rows button[aria-label="ゆいさん：5"]')?.getAttribute('aria-pressed') === 'true');
  await L.answer(A, 2);
  await L.waitText(H, '#progress', '2 / 2');
  check('B5 回答数に入る', true);
  check('B6 参加者は代わりに入力できない', (await raw(A, { action: 'answer', as: yuiId, value: 1 })) !== 'ok' && (await L.roomOf(code)).answers[yuiId] === 5);
  await H.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('B7 代わりに入力する欄はスマホ幅ではみ出さない', (await L.overflow(H)) <= 0);
  await L.shot(H, 'b-proxy-vote-375');
  await H.page.setViewportSize({ width: 1100, height: 900 });
  await H.page.click('#reveal');
  await L.waitVisible(W, '#result-area');
  const col5 = await W.page.$$eval('#result-columns .km-column', (cs) => [...cs[4].querySelectorAll('.km-column__name')].map((n) => n.textContent));
  check('B8 公開すると、その子の名前も列に出る', col5.includes('ゆい'), col5);

  // ── C. その子が出題者の番 ──
  await H.page.click('#start');                // ラウンド2: ゆう
  await L.waitVisible(A, '#secret-area');
  await L.sendHint(A, 'りんご');
  await L.waitVisible(H, '#vote-area');
  await H.page.click('#reveal');                // 未回答でも締め切る（確認は自動で OK）
  await L.waitVisible(H, '#result-area');
  await L.waitText(H, '#next-presenter', 'ゆい');
  check('C1 参加順で次の出題者はその子', !(await L.text(H, '#next-presenter')).includes('接続待ち'));
  await H.page.click('#start');                // ラウンド3: ゆい
  await L.waitVisible(H, '#secret-area');
  room = await L.roomOf(code);
  check('C2 その子が出題者で始められる', room.presenter === yuiId && room.status === 'hint');
  check('C3 進行役に「ゆいさんの秘密の数字（代わりに入力）」', (await L.text(H, '#secret-label')).includes('ゆいさんの秘密の数字') && Number(await L.text(H, '#secret-number')) === room.secret);
  await sleep(1200);
  check('C4 参加者・みんなにみせる画面には秘密の数字を出さない', !(await L.visible(A, '#secret-area')) && (await L.text(A, '#secret-number')) === '' && (await L.text(W, '#secret-number')) === '');
  await H.page.click('#hint-examples summary');
  check('C5 ヒント例も開ける', (await H.page.$$('#hint-example-list li')).length === 5);
  await L.shot(H, 'c-proxy-presenter');
  await L.sendHint(H, '日なたのクッション');
  await L.waitVisible(A, '#vote-area');
  check('C6 進行役が代わりにヒントを出せる', (await L.roomOf(code)).hint === '日なたのクッション');
  await sleep(1200);
  check('C7 そのラウンドは進行役は予想しない', !(await L.visible(H, '#vote-area')) && !(await L.visible(H, '#proxy-area')));
  check('C8 進行役の予想はサーバーでも止める', (await raw(H, { action: 'answer', value: 3 })) !== 'ok');
  await L.answer(A, 3);
  await L.waitText(H, '#progress', '1 / 1');
  check('C9 回答数から出題者の子と進行役を除く', (await L.text(H, '#progress')).startsWith('1 / 1'));

  // ── D. 外す ──
  await H.page.click('#reveal');
  await L.waitVisible(H, '#result-area');
  check('D0 結果に進行役を未回答として出さない', !(await L.text(H, '#other-answers')).includes('メンター'));
  check('D1 端末なしの子には、つながっていても「外す」', await L.visible(H, '#players button[aria-label="ゆいさんを外す"]'));
  check('D2 公開のあとは代わりに入力できない', (await raw(H, { action: 'answer', as: yuiId, value: 2 })) !== 'ok');
  await H.page.click('#players button[aria-label="ゆいさんを外す"]');
  await L.waitText(H, '#people-title', '2人', 10000);
  check('D3 外すと一覧から消える', !(await L.roomOf(code)).players[yuiId]);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
