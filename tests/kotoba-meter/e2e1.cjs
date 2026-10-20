// ことばメーター E2E その1: 入口の画面・作成・参加・みんなにみせる画面・ルームバー・1ラウンドの流れ・公開・次のラウンド・幅
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yu', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('haru');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 入口の画面 ──
  await L.open(H);
  check('A1 トップに3つのボタン', await L.visible(H, '#go-create') && await L.visible(H, '#go-join') && await L.visible(H, '#go-watch'));
  await H.page.click('#go-create');
  check('A2 作る画面にコード欄はない', await L.visible(H, '#screen-entry') && !(await L.visible(H, '#code-field')));
  await H.page.click('#enter');
  await L.waitVisible(H, '#entry-error');
  check('A3 名前が空ならフォームの中にエラー', (await L.text(H, '#entry-error')).includes('ニックネーム'));
  await H.page.click('#screen-entry .km-back');
  check('A4 トップへ戻る', await L.visible(H, '#screen-top'));
  await L.shot(H, 'a-top', false);

  // ── B. 作成・参加 ──
  const code = await L.createRoom(H, 'メンター');
  check('B1 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('B2 room-create を数える', await L.waitStats(H, 'room-create', 1));
  let room = await L.roomOf(code);
  check('B3 待合室で作られる', room.status === 'lobby' && room.hostConnected === true);
  await H.page.click('#copy-code');
  await L.waitToast(H, 'コードをコピー');
  check('B4 コードだけをコピー', (await H.page.evaluate(() => navigator.clipboard.readText())) === code);
  await sleep(300);

  await L.open(A, '?room=' + code);
  check('B5 リンクから開くと参加の画面・案内・コード入り', await L.visible(A, '#screen-entry') && await L.visible(A, '#entry-note') && (await A.page.inputValue('#join-code')) === code);
  check('B6 リンクから開くとニックネームにフォーカス', await A.page.evaluate(() => document.activeElement.id === 'nickname'));
  await A.page.fill('#nickname', 'ゆう');
  await A.page.click('#enter');
  await L.waitVisible(A, '#game');
  check('B7 参加すると ?room= を外す', !(await A.page.evaluate(() => location.search)));

  await L.open(B);
  await B.page.click('#go-join');
  check('B8 トップから参加の画面を開くと案内は出ない', !(await L.visible(B, '#entry-note')));
  await B.page.fill('#nickname', 'はる');
  await B.page.fill('#join-code', code.toLowerCase());
  await B.page.click('#enter');
  await L.waitVisible(B, '#game').catch(() => {});
  check('B9 小文字のコードでも参加できる', await L.visible(B, '#game'));

  // みんなにみせる画面はトップから開く
  await L.open(W);
  await W.page.click('#go-watch');
  await W.page.fill('#watch-code', 'ab');
  await W.page.click('#watch-form button[type=submit]');
  check('B10 コードの形がちがうとフォームの中にエラー', await L.visible(W, '#watch-error'));
  await W.page.fill('#watch-code', code);
  await W.page.click('#watch-form button[type=submit]');
  await W.page.waitForURL(/\?watch=/);
  await L.gate(W);
  await L.waitVisible(W, '#game');
  check('B11 みんなにみせる画面の目印と、操作を出さない', await L.visible(W, '#watch-badge') && !(await L.visible(W, '#room-actions')) && !(await L.visible(W, '#leave')));
  await L.waitText(H, '#people-title', '3人');

  // ── C. ルームバー ──
  check('C1 「みんなにみせる画面」は進行役だけ', await L.visible(H, '#watch-link') && !(await L.visible(A, '#watch-link')) && !(await L.visible(B, '#watch-link')));
  check('C2 パソコンでは1行（進行役）', (await L.roombarRows(H)) === 1, await L.roombarRows(H));
  check('C3 パソコンでは1行（参加者）', (await L.roombarRows(B)) === 1, await L.roombarRows(B));
  check('C4 スマホの参加者は2行', (await L.roombarRows(A)) === 2, await L.roombarRows(A));
  check('C5 最初の出題者は進行役', (await L.text(A, '#next-presenter')).includes('メンター'));
  await L.shot(H, 'c-lobby-host');
  await L.shot(A, 'c-lobby-guest-375');
  await L.shot(W, 'c-lobby-watch', false);

  // ── D. 開始・出題者の画面 ──
  check('D1 制限時間の初期値は「なし」', await L.pressed(H, '#hint-seconds button[data-seconds="0"]'));
  await H.page.click('#hint-seconds button[data-seconds="120"]');
  check('D2 制限時間を選べる', await L.pressed(H, '#hint-seconds button[data-seconds="120"]'));
  check('D3 参加者に開始の道具は出ない', !(await L.visible(A, '#setup')));
  await H.page.click('#start');
  await L.waitVisible(H, '#secret-area');
  check('D4 start・players-3 を数える', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-3', 1));
  room = await L.roomOf(code);
  check('D5 ラウンド1・出題者は進行役・制限時間2分', room.status === 'hint' && room.round === 1 && room.presenter === room.host && room.hintSeconds === 120);
  const secret = Number(await L.text(H, '#secret-number'));
  check('D6 出題者に秘密の数字', secret === room.secret && secret >= 1 && secret <= 5, secret);
  check('D7 ゲージは秘密の数字まで', (await H.page.$$eval('#secret-gauge li.is-on', (l) => l.length)) === secret);
  await sleep(1200);
  check('D8 残り時間を出す', /あと.*分\d\d秒/.test(await L.text(H, '#hint-timer')), await L.text(H, '#hint-timer'));
  for (const c of [A, B, W]) check('D9 出題者以外に秘密の数字を出さない（' + c.label + '）', !(await L.visible(c, '#secret-area')) && (await L.text(c, '#secret-number')) === '');
  check('D10 ヒント例は最初は閉じている', !(await H.page.evaluate(() => document.getElementById('hint-examples').open)));
  await H.page.click('#hint-examples summary');
  check('D11 ヒント例は5つ', (await H.page.$$('#hint-example-list li')).length === 5);
  // お題を変更しても、秘密の数字は変わらない
  const before = room.theme.name;
  await H.page.click('#theme-change summary');
  const other = await H.page.evaluate((name) => [...document.querySelectorAll('#theme-select option')].find((o) => o.textContent !== name).value, before);
  await H.page.selectOption('#theme-select', other);
  await H.page.click('#change-theme');
  await L.waitText(A, '#theme-name', await H.page.evaluate((v) => document.querySelector(`#theme-select option[value="${v}"]`).textContent, other));
  room = await L.roomOf(code);
  check('D12 お題の変更で秘密の数字は変わらない', room.theme.name !== before && room.secret === secret);
  await H.page.click('#hint-examples summary');
  await L.shot(H, 'd-hint-presenter');
  await L.shot(A, 'd-hint-guest-375');
  await L.shot(W, 'd-hint-watch', false);

  // ── E. 予想 ──
  await L.sendHint(H, 'ふわふわの毛布');
  await L.waitVisible(A, '#vote-area');
  await L.waitText(W, '#hint-text', 'ふわふわの毛布').catch(() => {});
  check('E1 ヒントがみんなに出る', (await L.text(W, '#hint-text')) === 'ふわふわの毛布' && (await L.text(A, '#hint-text')) === 'ふわふわの毛布');
  check('E2 出題者は予想しない', !(await L.visible(H, '#vote-area')));
  await L.answer(A, 3);
  await A.page.waitForFunction(() => document.querySelector('#choices button[value="3"]').getAttribute('aria-pressed') === 'true');
  check('E3 選んだ数字を示す', (await L.text(A, '#answer-note')).includes('3 を選んだ'));
  const nums = await A.page.$$eval('#choices button', (bs) => bs.map((b) => { const r = document.createRange(); r.selectNodeContents(b.firstChild); return Math.round(r.getBoundingClientRect().top); }));
  check('E4 数字ボタンの数字の高さがそろう', new Set(nums).size === 1, nums);
  await L.waitText(H, '#progress', '1 / 2');
  check('E6 公開前はほかの人の数字を出さない', !(await L.visible(B, '#result-area')) && !(await L.text(B, '#result-columns')));
  await L.answer(B, 4);
  await sleep(500);
  await B.page.click('#pass');
  await B.page.waitForFunction(() => document.getElementById('pass').getAttribute('aria-pressed') === 'true');
  check('E7 パスを選べる', (await L.text(B, '#answer-note')).includes('パス'));
  await L.answer(B, 4);
  await B.page.waitForFunction(() => document.querySelector('#choices button[value="4"]').getAttribute('aria-pressed') === 'true');
  check('E8 公開前なら選び直せる', !(await L.pressed(B, '#pass')));
  check('E9 予想の画面で横にはみ出さない', (await L.overflow(A)) <= 0, await L.overflow(A));
  await L.shot(A, 'e-vote-guest-375');
  await L.shot(W, 'e-vote-watch', false);

  // ── F. 公開 ──
  await L.waitText(H, '#progress', '2 / 2');
  await H.page.click('#reveal');
  await L.waitVisible(A, '#result-area');
  check('F1 finish を数える', await L.waitStats(H, 'finish', 1));
  check('F2 出題者の数字の列', (await L.text(H, '#result-columns .is-target .km-column__num')) === String(secret));
  const cols = await H.page.$$eval('#result-columns .km-column', (cs) => cs.map((c) => [...c.querySelectorAll('.km-column__name')].map((n) => n.textContent)));
  check('F3 予想した数字の列に名前', cols[2].includes('ゆう') && cols[3].includes('はる'), cols);
  check('F4 「正解」と書かない', !(await H.page.evaluate(() => document.getElementById('result-area').textContent.includes('正解'))));
  check('F5 公開のあとは予想できない', !(await L.visible(A, '#vote-area')));
  check('F6 結果の画面で横にはみ出さない', (await L.overflow(A)) <= 0);
  check('F7 みんなにみせる画面は1280×720で「話してみよう」まで入る', await W.page.evaluate(() => document.querySelector('.km-talk').getBoundingClientRect().bottom <= innerHeight));
  await L.waitText(W, '#next-presenter', 'ゆう').catch(() => {});
  check('F8 次の出題者は参加順でゆう', (await L.text(H, '#next-presenter')).includes('ゆう') && (await L.text(W, '#next-presenter')).includes('ゆう'));
  await L.shot(H, 'f-result-host');
  await L.shot(A, 'f-result-guest-375');
  await L.shot(W, 'f-result-watch', false);

  // ── G. 次のラウンド ──
  await H.page.click('#start');
  await L.waitVisible(A, '#secret-area');
  check('G1 again・start を数える', await L.waitStats(H, 'again', 1) && await L.waitStats(H, 'start', 2));
  room = await L.roomOf(code);
  check('G2 ラウンド2・出題者はゆう', room.round === 2 && room.players[room.presenter].name === 'ゆう');
  await L.sendHint(A, 'りんご一個');
  await L.waitVisible(H, '#vote-area');
  check('G3 出題者でない進行役に予想の画面', await L.visible(H, '#vote-area'));
  await L.shot(A, 'g-presenter-375');

  // ── H. 幅 ──
  await H.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('H1 スマホの進行役のルームバーは3行まで', (await L.roombarRows(H)) <= 3, await L.roombarRows(H));
  check('H2 スマホの進行役で横にはみ出さない', (await L.overflow(H)) <= 0);
  await A.page.setViewportSize({ width: 320, height: 700 });
  await sleep(300);
  check('H3 320pxの参加者のルームバーは2行', (await L.roombarRows(A)) === 2, await L.roombarRows(A));
  check('H4 320pxで横にはみ出さない', (await L.overflow(A)) <= 0);
  await L.shot(A, 'h-presenter-320');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
