// サークルタイム E2E その1: 入口・午前のルーム・参加・みんなにみせる画面・5段階（押したらすぐ段に出る）・代わりに入れる・流れの操作・天気・何の日・文を直す・その場で聞く・プログラム・退出・幅
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('haru');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 入口 ──
  await L.open(H);
  check('A1 トップに3つの入口', await L.visible(H, '#go-create') && await L.visible(H, '#go-join') && await L.visible(H, '#go-watch'));
  await H.page.click('#go-join');
  await L.waitScreen(H, 'join');
  check('A2 トップから開くと案内は出ない', !(await L.visible(H, '#joinLinkHint')));
  await H.page.click('#join-form button[type=submit]');
  await L.waitVisible(H, '#join-error');
  check('A3 空のまま参加するとフォームの中にエラー', (await L.text(H, '#join-error')).includes('ニックネーム'));
  await H.page.click('#screen-join [data-back]');
  await L.waitScreen(H, 'top');
  check('A4 トップへ戻る', (await L.screenActive(H)) === 'screen-top');

  // ── B. 作成（午前） ──
  const code = await L.createRoom(H, 'たぎ', {
    day: { options: ['鍋の日', 'ココアの日', 'くつ下の日'], answer: 1, note: '立冬のころだから' },
    prog: ['10:00 ボドゲクラブ', '11:00 コトバであそぼ'], note: '見ているだけでOK',
  });
  check('B1 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('B2 午前のルーム', room.status === 'live' && room.kind === 'am' && room.hostConnected === true);
  const types = (room.steps || []).map((s) => s.type);
  check('B3 流れは表紙・自由タイム・目次…移動の案内', JSON.stringify(types) === JSON.stringify(['opening', 'free', 'agenda', 'scale', 'scale', 'weather', 'choice', 'show', 'closing']), types);
  check('B4 はじめはサークルタイムの表紙', room.cur === room.steps[0].id && !room.view);
  const tokyo = (room.weather?.cities || []).find((c) => c.n === '東京');
  check('B5 天気は13都市・東京は晴れ 21/10', room.weather?.cities?.length === 13 && tokyo && tokyo.code === '100' && tokyo.max === 21 && tokyo.min === 10, tokyo);
  check('B6 天気はホストだけが取りにいく（13回）', H.jma === 13, H.jma);
  check('B7 ホストは大人', Object.values(room.players)[0].adult === true);
  check('B8 何の日は3択・答えは2', room.steps[6].options.length === 3 && room.steps[6].answer === 1 && room.steps[6].mode === 'hide');
  check('B9 プログラムの文とポータルのリンク', room.steps[7].lines.length === 2 && room.steps[7].link === 'https://katariba.notion.site/room-K-277e1247489c4bbe979b0322df284a73' && room.steps[7].note === '見ているだけでOK');
  check('B10 ?room= も ?watch= も付かない', !(await H.page.evaluate(() => location.search)));
  const prefs = await H.page.evaluate(() => JSON.parse(localStorage.getItem('roomk-circle-time-prefs') || '{}'));
  check('B11 名前を端末に覚える', prefs.name === 'たぎ');
  await H.page.click('#btnCopyCode');
  await L.waitToast(H, 'コードをコピー');
  check('B12 コードだけをコピー', (await H.page.evaluate(() => navigator.clipboard.readText())) === code);
  await sleep(200);
  await H.page.click('#btnCopyLink');
  await L.waitToast(H, '参加用のリンク');
  check('B13 リンクは ?room=', (await H.page.evaluate(() => navigator.clipboard.readText())).endsWith('?room=' + code));

  check('B14 はじめての進行役に「はじめに」の案内・リンクをコピーすると印', await L.visible(H, '#host-guide') && await H.page.evaluate(() => document.querySelector('#host-guide .g-step[data-g="link"]').classList.contains('done')));
  await H.page.click('#guide-off');
  check('B15 「もう出さない」で消えて、端末に覚える', !(await L.visible(H, '#host-guide')) && (await H.page.evaluate(() => JSON.parse(localStorage.getItem('roomk-circle-time-prefs')).guideOff)) === true);
  // ── C. 参加・みんなにみせる画面 ──
  await L.open(A, '?room=' + code);
  await L.waitScreen(A, 'join');
  check('C1 リンクから開くと案内とコード', await L.visible(A, '#joinLinkHint') && (await A.page.inputValue('#join-code')) === code);
  check('C2 名前にフォーカス', await A.page.evaluate(() => document.activeElement.id === 'join-name'));
  await A.page.fill('#join-name', 'ゆい');
  await A.page.click('#join-form button[type=submit]');
  await L.waitScreen(A, 'player');
  check('C3 参加すると ?room= を外す', !(await A.page.evaluate(() => location.search)));
  await L.waitPlayer(A, 'きょうの流れ');
  await L.joinRoom(B, 'はる', code, true);
  await L.openWatch(W, code);
  // ── C/D0. サークルタイムの表紙 → 自由タイム ──
  await L.waitStage(W, '午前のサークルタイム');
  check('D0a 表紙に午前のサークルタイムとコード・上の帯はなし', (await L.stage(W)).includes(code) && !(await W.page.evaluate(() => !!document.querySelector('#watch-stage .progress'))));
  await L.shot(W, 'am-opening', false);
  await L.nextMain(H, code);
  const fr = (await L.roomOf(code)).free;
  await L.waitPlayer(A, fr.topic);
  check('C4 ニュースがない日は、準備で決めたおしゃべりのお題が出る（希望をえらぶボタンはない）', fr.mode === 'talk' && (await A.page.evaluate(() => document.querySelectorAll('#player-card [data-act="fwish"]').length)) === 0, fr);
  await L.waitStage(W, fr.topic);
  const st = await L.stage(W);
  check('C5 みんなにみせる画面に自由タイムのあそびとコード', st.includes('おしゃべりのお題') && !st.includes('なにしてあそぶ') && st.includes(code));
  check('C6 自由タイムに名前・時刻は出さない', !st.includes('きているひと') && !st.includes('ゆい') && !st.includes('9:15') && !(await W.page.evaluate(() => !!document.querySelector('#watch-stage .clock-now'))));
  await L.waitText(H, '#plist', 'はる');
  check('C7 ホストの一覧には3人', (await L.text(H, '#players-title')).includes('3人'));
  check('C7b 左下の「みんなにみせる画面」の札はふだん見えない', (await W.page.evaluate(() => getComputedStyle(document.querySelector('.watch-bar')).opacity)) === '0');
  check('C8 みせる画面と参加者は天気を取りにいかない', !W.jma && !A.jma, [W.jma, A.jma]);
  check('C9 参加者の画面は375pxではみ出ない', (await L.overflow(A)) <= 0, await L.overflow(A));
  await L.shot(W, 'am-free', false);

  // ── D0. 目次・セクションの表紙 ──
  await H.page.click('#btn-next');
  await L.waitStage(W, 'きょうの流れ');
  const ag = await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .ag-list li')].map((li) => [li.textContent.trim(), li.classList.contains('done')]));
  check('D0b 目次に6つ・自由タイムは済み', ag.length === 6 && ag[0][0].includes('自由タイム') && ag[0][1] && !ag[1][1] && ag[5][0].includes('今日のプログラム'), ag);
  await L.shot(W, 'am-agenda', false);
  await H.page.click('#btn-next');
  await L.waitStage(W, '2／6');
  check('D0c 心の表紙は番号と見出しと一文だけ', (await L.stage(W)).includes('ジブンチェック　心') && (await L.stage(W)).includes('5つの中から') && !(await L.stage(W)).includes('まあまあ元気'));
  await L.waitPlayer(A, 'つぎは');
  check('D0d 参加者にも「つぎは」とボタンなし', (await A.page.evaluate(() => document.querySelectorAll('#player-card [data-act="pick"]').length)) === 0);
  await L.waitText(H, '#host-step-type', '表紙');
  check('D0e2 ホストに「いま」と「つぎ」', (await L.text(H, '#nav-now')).includes('ジブンチェック 心（表紙）') && (await L.text(H, '#nav-next')).includes('ジブンチェック 心（中身）'));
  check('D0e 表紙ではホストの「せーの」を出さない', !(await L.visible(H, '#btn-reveal')) && (await L.text(H, '#host-step-type')).includes('表紙'));
  await L.shot(W, 'am-cover', false);
  // ── D. 心（伏せる → せーので見せる） ──
  await H.page.click('#btn-next');
  await L.waitStage(W, 'いまの気持ちは');
  await L.waitPlayer(A, 'ジブンチェック　心');
  const row = (n) => `#watch-stage .rows .row:nth-child(${6 - n})`;
  const chipsIn = (n) => L.whoIn(W, row(n));
  const waitChip = (n, name) => W.page.waitForFunction(([s, nm]) => [...document.querySelectorAll(s + ' .chip')].some((e) => (e.firstChild?.textContent || '').trim() === nm), [row(n), name]);
  check('D1b 5段階に表情のアイコン', (await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .rows .fc')].map((e) => e.textContent).join())) === 'sentiment_very_satisfied,sentiment_satisfied,sentiment_neutral,sentiment_dissatisfied,sentiment_very_dissatisfied' && (await A.page.evaluate(() => document.querySelectorAll('#player-card .opt-btn .fc').length)) === 5);
  check('D1c 中身の画面に絵は置かない（ui.md）', await W.page.evaluate(() => !document.querySelector('#watch-stage .hd img')));
  check('D1 はじめは段に名前がない・言葉は見える', (await W.page.evaluate(() => document.querySelectorAll('#watch-stage .rows .chip').length)) === 0 && (await L.stage(W)).includes('まあまあ元気'));
  await L.waitText(H, '#host-step-type', '5段階');
  check('D3 「せーので見せる」は出さない（押したらすぐ出る）', !(await L.visible(H, '#btn-reveal')) && !(await L.stage(W)).includes('せーの'));
  const send = async (c, v) => { await c.page.click(`#player-card [data-act="pick"][data-v="${v}"]`); await c.page.click('#p-send'); };
  await A.page.click('#player-card [data-act="pick"][data-v="4"]');
  check('D3b 選んだだけでは送らない', (await L.text(A, '#p-send')).trim() === '送る' && (await W.page.evaluate(() => document.querySelectorAll('#watch-stage .rows .chip').length)) === 0);
  check('D3c わけ・ひとことの欄ははじめから出ている', await L.visible(A, '#p-note'));
  await A.page.fill('#p-note', 'きのうよくねた');
  await A.page.click('#p-send');
  await waitChip(4, 'ゆい');
  await L.waitPlayer(A, '4 を送ったよ');
  check('D4 送るとすぐ段に名前', (await chipsIn(4)).includes('ゆい'));
  check('D5 参加者の4が選ばれ、ボタンは「送ったよ」', await L.pressed(A, '#player-card [data-act="pick"][data-v="4"]') && (await L.text(A, '#p-send')).includes('送ったよ') && (await A.page.evaluate(() => document.querySelector('#p-send').classList.contains('sent'))));
  await L.waitText(H, '#plist', 'きのうよくねた');
  check('D5b わけは押すまで画面に出ない・進行役の一覧には出る', !(await L.stage(W)).includes('きのうよくねた'));
  await send(A, 5);
  await L.waitPlayer(A, '5 を送ったよ');
  let cur = await L.curStepId(code);
  room = await L.roomOf(code);
  const idA = Object.keys(room.players).find((id) => room.players[id].name === 'ゆい');
  check('D6 選び直すと5になる', room.answers[cur][idA] === 5);
  check('D6b 選び直すと段も移る', (await waitChip(5, 'ゆい').then(() => true)) && !(await chipsIn(4)).includes('ゆい'));
  await B.page.click('#player-card [data-act="pick"][data-v="3"]');
  await B.page.fill('#p-note', 'ちょっとねむい');
  await B.page.click('#p-send');
  await waitChip(3, 'はる');
  await W.page.waitForFunction(() => document.querySelectorAll('#watch-stage .chip.has-note').length === 2).catch(() => {});
  check('D6c わけを書いた人の名前だけ押せる', (await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .chip.has-note')].map((e) => e.firstChild.textContent.trim()).sort())).join() === ['はる', 'ゆい'].sort().join(), await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .chip')].map((e) => e.outerHTML.slice(0, 60))));
  check('D6d 押すまで、わけは出ない', !(await L.stage(W)).includes('ちょっとねむい') && !(await L.stage(W)).includes('きのうよくねた'));
  await W.page.locator('#watch-stage .chip.has-note', { hasText: 'はる' }).click();
  await L.waitStage(W, 'ちょっとねむい');
  check('D6e 名前を押すと、わけが出る', await L.visible(W, '#watch-stage .note-pop'));
  await L.shot(W, 'am-kokoro-note', false);
  await W.page.locator('#watch-stage .chip.has-note', { hasText: 'はる' }).click();
  await L.waitNoText(W, '#watch-stage', 'ちょっとねむい');
  check('D6f もう一度押すと閉じる', true);
  // 端末のない人と自分の分を代わりに入れる
  await H.page.fill('#proxy-name', 'れん');
  await H.page.click('#btn-add-proxy');
  await L.waitText(H, '#plist', 'れん');
  check('D7 端末なしの印はホストにだけ', (await L.text(H, '#plist')).includes('端末なし') && !(await L.stage(W)).includes('端末なし'));
  await L.waitText(H, '#plist', 'れん');
  await H.page.locator('#plist .prow', { hasText: '自分' }).locator('button[data-v="4"]').click();
  await waitChip(4, 'たぎ');
  const rows = await H.page.evaluate(() => [...document.querySelectorAll('#plist .prow')].map((r) => r.textContent));
  await L.waitText(H, '#ans-sum', '答えた 3／4人').catch(() => {});
  check('D8b 答えた人数', (await L.text(H, '#ans-sum')).includes('答えた 3／4人'), await L.text(H, '#ans-sum'));
  check('D8 代わりに入れる行は れん と 自分', rows.some((r) => r.includes('れん')) && rows.some((r) => r.includes('自分')));
  await H.page.locator('#plist .prow', { hasText: 'れん' }).locator('button[data-v="4"]').click();
  await waitChip(4, 'れん');
  check('D9 みんなの画面には れん も同じ形', !(await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .chip')].some((e) => e.textContent.includes('端末なし')))));
  check('D10 段ごとに名前', (await L.whoIn(W, row(5))).includes('ゆい') && (await L.whoIn(W, row(4))).includes('たぎ') && (await L.whoIn(W, row(4))).includes('れん') && (await L.whoIn(W, row(3))).includes('はる'));
  check('D10b 大人の名前は点線の丸', (await W.page.evaluate(() => document.querySelectorAll('#watch-stage .rows .chip.adult').length)) === 2);
  check('D11 答えた数の帯は出さない', !(await W.page.evaluate(() => !!document.querySelector('#watch-stage .ans-bar'))));
  await L.shot(W, 'am-kokoro', false);
  await A.page.click('#player-card [data-act="pass"]');
  await L.waitPlayer(A, 'パスしたよ');
  await W.page.waitForFunction((s) => ![...document.querySelectorAll(s + ' .chip')].some((e) => e.textContent.trim() === 'ゆい'), row(5));
  check('D12 パスすると段から消える', true);
  check('D13 ホストの一覧にパス', (await L.text(H, '#plist')).includes('パス'));
  await H.page.click('#btn-close');
  await A.page.waitForFunction(() => document.querySelector('#player-card [data-act="pick"]')?.disabled === true);
  check('D14 しめきると参加者のボタンが止まる', (await L.player(A)).includes('しめきりました'));
  await H.page.click('#btn-chat');
  await L.waitToast(H, 'チャット用');
  const chat = await H.page.evaluate(() => navigator.clipboard.readText());
  check('D15 チャット用の文', chat.includes('ジブンチェック　心') && chat.includes('5 とても元気') && chat.includes('パスもOK'));

  // ── E. 流れの操作 ──
  const stepIds = (await L.roomOf(code)).steps.map((s) => s.id);
  await H.page.click(`#steplist [data-go="${stepIds[4]}"]`);
  await L.waitStage(W, '3／6');
  check('E1a 一覧から移ると表紙から', (await L.roomOf(code)).view === 'cover');
  await H.page.click('#btn-next');
  await L.waitStage(W, 'とても調子がいい');
  check('E1 一覧から体へ', (await L.curStepId(code)) === stepIds[4]);
  check('E1b 並べかえ・飛ばすのボタンは、はじめはかくれている', !(await L.visible(H, `#steplist [data-hide="${stepIds[5]}"]`)));
  await H.page.click('#btn-reorder');
  await L.waitVisible(H, `#steplist [data-hide="${stepIds[5]}"]`);
  await H.page.click(`#steplist [data-hide="${stepIds[5]}"]`);
  await H.page.waitForFunction((id) => document.querySelector(`#steplist [data-hide="${id}"]`)?.closest('li')?.classList.contains('off'), stepIds[5]);
  await L.waitNoText(W, '#watch-stage .progress', '天気');
  check('E2 飛ばすと帯から消える', !(await L.text(W, '#watch-stage .progress')).includes('天気'));
  await H.page.click('#btn-next');
  await L.waitStage(W, '4／5');
  check('E3 次へで天気を飛ばして何の日の表紙', (await L.curStepId(code)) === stepIds[6] && (await L.stage(W)).includes('今日は何の日'));
  await H.page.click(`#steplist [data-hide="${stepIds[5]}"]`);
  await L.waitStage(W, '5／6');
  await H.page.click('#btn-prev');
  await L.waitStage(W, '出典: 気象庁');
  check('E4 戻すと前へで天気の中身に', (await L.curStepId(code)) === stepIds[5]);

  // ── F. 天気 ──
  const wxText = await L.stage(W);
  check('F1 13都市と出典', wxText.includes('東京') && wxText.includes('那覇') && wxText.includes('出典: 気象庁') && wxText.includes('21'));
  await L.waitPlayer(A, 'きみのところは');
  await L.answerBtn(A, 0);
  await W.page.waitForFunction(() => [...document.querySelectorAll('#watch-stage .wx .ask2 .opt')].some((o) => o.textContent.includes('はれ') && o.textContent.includes('ゆい')));
  check('F2 きみのところは？に名前', true);
  await L.shot(W, 'am-weather', false);

  // ── G. 何の日 ──
  await L.nextMain(H, code);
  await L.waitStage(W, '鍋の日');
  await L.waitPlayer(A, '鍋の日');
  await L.answerBtn(A, 1);
  await L.answerBtn(B, 0);
  await H.page.locator('#plist .prow', { hasText: 'れん' }).locator('button[data-v="2"]').click();
  await L.waitStage(W, '3／4人');
  check('G1 伏せているあいだはカードに名前がない', (await W.page.evaluate(() => document.querySelectorAll('#watch-stage .choice .chip').length)) === 0);
  check('G2 答えを見せるは伏せたままでも押せる', await L.visible(H, '#btn-answer'));
  await H.page.click('#btn-reveal');
  await W.page.waitForFunction(() => document.querySelectorAll('#watch-stage .choice .chip').length === 3);
  const card = (i) => `#watch-stage .choice:nth-child(${i})`;
  check('G3 せーので見せるとカードに名前', (await L.whoIn(W, card(2))).includes('ゆい') && (await L.whoIn(W, card(1))).includes('はる') && (await L.whoIn(W, card(3))).includes('れん'));
  check('G4 まだ正解の印はない', !(await W.page.evaluate(() => !!document.querySelector('#watch-stage .choice.ok'))));
  await H.page.click('#btn-answer');
  await W.page.waitForFunction(() => !!document.querySelector('#watch-stage .choice.ok'));
  check('G5 答えを見せると②に印と由来', (await W.page.evaluate(() => document.querySelector('#watch-stage .choice.ok .t').textContent)) === 'ココアの日' && (await L.stage(W)).includes('答えは ②') && (await L.stage(W)).includes('立冬'));
  await L.waitPlayer(A, '答えは ②');
  check('G6 参加者にも答え', (await L.player(A)).includes('立冬'));
  await L.shot(W, 'am-day', false);

  // ── H. 文を直す ──
  await H.page.click('#btn-edit');
  await L.waitVisible(H, '#edit-box');
  const before = await H.page.inputValue('#edit-text');
  check('H1 いまの文が入る', before.startsWith('今日は何の日？') && before.includes('鍋の日') && before.includes('答えのあと: 立冬'));
  await H.page.fill('#edit-text', before.replace('今日は何の日？', '11月7日は何の日？'));
  await H.page.click('#edit-save');
  await L.waitStage(W, '11月7日は何の日？');
  room = await L.roomOf(code);
  check('H2 見出しだけ変わり選択肢と答えはそのまま', room.steps[6].options[1] === 'ココアの日' && room.steps[6].answer === 1 && room.steps[6].note === '立冬のころだから');
  await L.waitHidden(H, '#edit-box').catch(() => {});
  check('H3 直す箱が閉じる', !(await L.visible(H, '#edit-box')));

  // ── I. その場で聞く ──
  await H.page.click('#btn-add-step');
  await H.page.fill('#add-text', 'きょうのおやつは？\nあまいもの\nしょっぱいもの');
  await H.page.click('#add-save');
  await L.waitToast(H, '足しました');
  room = await L.roomOf(code);
  check('I1 いまの次に足される', room.steps.length === 10 && room.steps[7].type === 'choice' && room.steps[7].title === 'きょうのおやつは？' && room.steps[7].options.length === 2);
  await L.nextMain(H, code);
  await L.waitStage(W, 'きょうのおやつは？');
  await L.waitPlayer(A, 'あまいもの');
  await L.answerBtn(A, 0);
  await L.waitStage(W, '1／4人');
  check('I2 足した質問にも答えられる', true);
  check('I3 帯には「質問」', (await L.text(W, '#watch-stage .progress')).includes('質問'));

  // ── J. プログラム ──
  await L.nextMain(H, code);
  await L.waitStage(W, 'ボドゲクラブ');
  const pg = await L.stage(W);
  check('J1 予定と時刻とひとこと', pg.includes('10:00') && pg.includes('コトバであそぼ') && pg.includes('見ているだけでOK'));
  check('J2 みせる画面にアドレスは出さない', !pg.includes('https://'));
  await L.waitPlayer(A, 'くわしく開く');
  check('J3 参加者はポータルを開ける', (await A.page.getAttribute('#player-card .p-link', 'href')) === 'https://katariba.notion.site/room-K-277e1247489c4bbe979b0322df284a73');
  await L.shot(W, 'am-program', false);
  await L.shot(A, 'am-player-program');
  await H.page.click('#btn-next');
  await L.waitStage(W, '1コマ目のプログラムに移動しよう');
  check('J3b 最後は1コマ目のプログラムへの移動の案内', (await L.stage(W)).includes('10:00') && (await L.stage(W)).includes('ボドゲクラブ') && !(await L.stage(W)).includes('コトバであそぼ'));
  await L.waitPlayer(A, '移動しよう');
  await L.shot(W, 'am-closing', false);
  await H.page.waitForFunction(() => document.querySelector('#btn-next').disabled, null, { timeout: 8000 }).catch(() => {});
  check('J4 最後は次へが止まる', await H.page.evaluate(() => document.querySelector('#btn-next').disabled));
  check('J5 一覧は短い名前', (await L.text(H, '#steplist')).includes('自由タイム') && (await L.text(H, '#steplist')).includes('ジブンチェック 心'));

  // ── K. 並べかえ ──
  await H.page.click(`#steplist [data-up="${stepIds[4]}"]`);
  await H.page.waitForFunction((id) => document.querySelector('#steplist li:nth-child(4) [data-go]')?.dataset.go === id, stepIds[4]);
  room = await L.roomOf(code);
  check('K1 体が心の前に', room.steps[3].id === stepIds[4] && room.steps[4].id === stepIds[3]);

  // ── L. 退出・外す ──
  await B.page.click('#btn-leave');
  await L.waitScreen(B, 'top');
  room = await L.roomOf(code);
  check('L1 退出すると消える', !Object.values(room.players).some((p) => p.name === 'はる'));
  const renId = Object.keys(room.players).find((id) => room.players[id].name === 'れん');
  await H.page.click(`#plist [data-remove="${renId}"]`);
  await L.waitNoText(H, '#plist', 'れん');
  room = await L.roomOf(code);
  check('L2 端末なしの人を外す', !room.players[renId] && !Object.values(room.answers || {}).some((a) => a[renId] !== undefined));
  check('L3 ホストは375pxでなくてもはみ出ない', (await L.overflow(H)) <= 0);
  await L.shot(H, 'am-host');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });
