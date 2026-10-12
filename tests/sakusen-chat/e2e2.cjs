// E2E その2: 再読み込み・退出・切断・期限切れ・終わる・前のルームの片付け
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, roomWhen, open, screen, waitScreen, text, visible, waitToast, badges, topicTitles, msgs, waitMsgs, waitTitle, openTopic, sendText } = L;
const path = require('path');
const ROOMS = 'sakusenchat_rooms/';

(async () => {
  const server = await L.startServer();
  await L.launch();

  // 前の実行の残りを消してから始める（最後に「何も残っていない」を確かめるため）
  await rest('DELETE', 'sakusenchat_rooms');
  const H = await L.newClient('host');
  const { link, key } = await L.createRoom(H, 'メンター');
  const A = await L.newClient('guestA');
  await L.joinOk(A, key, 'たろう');
  const B = await L.newClient('guestB');
  await L.joinOk(B, key, 'はなこ');
  await sendText(H, '1通目');
  await waitMsgs(A, 1); await waitMsgs(B, 1);
  await openTopic(A, 1);

  // ── L. 参加している人の再読み込み → 名前を入れ直さずにもどる。読んだところも引きつぐ
  await sendText(H, '2通目');
  await waitTitle(A, '(1)');
  await A.page.reload();
  await waitScreen(A, 'chat');
  await A.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 2);
  await waitTitle(A, '(1)');
  check('L reload: back in chat with unread kept', (await badges(A)).join('|') === '1|', await badges(A));
  await openTopic(A, 0);
  check('L reload: divider at the unread one', (await A.page.$$eval('#msgList > *', (els) => els.findIndex((e) => e.classList.contains('sc-talk__divider')))) === 1);
  check('L reload: messages', (await msgs(A)).join('|') === 'メンター:1通目|メンター:2通目');
  let room = await roomWhen(key, (r) => Object.keys(r.meta.guests || {}).length === 2);
  check('L reload: seat kept, no extra seat', Object.values(room.meta.guests).map((g) => g.name).sort().join() === 'たろう,はなこ', room.meta.guests);
  await sendText(A, '再読み込みのあと');
  await waitMsgs(H, 3);
  check('L reload: same person after reload', (await msgs(H))[2] === 'たろう:再読み込みのあと');
  await waitMsgs(B, 3);
  await sendText(B, 'はなこも');
  await waitMsgs(A, 4);
  await A.page.reload();
  await waitScreen(A, 'chat');
  await A.page.waitForFunction(() => document.querySelectorAll('.sc-msg').length === 4);
  check('L reload: own old messages still mine', (await msgs(A)).join('|') === 'メンター:1通目|メンター:2通目|me:再読み込みのあと|はなこ:はなこも', await msgs(A));
  check('L reload: nothing unread', !(await A.page.title()).startsWith('('));

  // ── M. メンターの再読み込み → メンターとしてもどる。参加している人には待ち画面を出さない
  let sawOverlay = false;
  const watchOverlay = setInterval(async () => { try { if (await visible(A, '#hostOffOverlay')) sawOverlay = true; } catch {} }, 150);
  await H.page.reload();
  await waitScreen(H, 'chat');
  await H.page.waitForFunction(() => document.querySelectorAll('.sc-msg').length === 4);
  room = await roomWhen(key, (r) => r.meta.hostConnected === true);
  check('M host reload: connected again', room.meta.hostConnected === true && !('hostDisconnectedAt' in room.meta));
  check('M host reload: host tools', await visible(H, '#btnFinish') && (await msgs(H)).join('|') === 'me:1通目|me:2通目|たろう:再読み込みのあと|はなこ:はなこも', await msgs(H));
  await sleep(1500);
  clearInterval(watchOverlay);
  check('M host reload: no waiting screen for a short cut', !sawOverlay);
  await H.page.waitForFunction(() => document.getElementById('peerLabel').textContent.includes('たろう') && document.getElementById('peerLabel').textContent.includes('はなこ'));

  // ── Z. 参加している人の通信が切れる → お知らせが出て、送れない。もどると送れる
  await B.context.setOffline(true);
  await B.page.waitForSelector('#offlineNote:not([hidden])', { timeout: 8000 });
  await B.page.fill('#textInput', '切れている間');
  await B.page.click('#btnSend');
  await waitToast(B, '接続が切れているよ');
  check('Z offline: not sent, text kept', (await B.page.inputValue('#textInput')) === '切れている間' && (await msgs(B)).length === 4);
  await B.context.setOffline(false);
  await B.page.waitForSelector('#offlineNote', { state: 'hidden', timeout: 30000 });
  room = await roomWhen(key, (r) => Object.values(r.meta.guests || {}).some((g) => g.name === 'はなこ'), 30000);
  check('Z online again: seat is there', Object.values(room.meta.guests).some((g) => g.name === 'はなこ'), room.meta.guests);
  await B.page.waitForSelector('#roomk-toast', { state: 'detached', timeout: 5000 }).catch(() => {});
  await B.page.click('#btnSend');
  await waitMsgs(H, 5);
  check('Z online again: sent', (await msgs(H))[4] === 'はなこ:切れている間');
  B.errors = B.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|WebSocket/.test(e));

  // ── W. タブの複製（sessionStorage ごと写る）→ 複製された側は別の人になる。閉じても、もとのタブの席は消えない
  const stored = await A.page.evaluate(() => ({ mid: sessionStorage.getItem('sakusenchat_mid'), session: sessionStorage.getItem('sakusenchat_session') }));
  const A2 = await L.newPage(A.context, 'guestA-duplicate');
  await A2.page.addInitScript((v) => { if (!sessionStorage.getItem('sakusenchat_mid')) { sessionStorage.setItem('sakusenchat_mid', v.mid); sessionStorage.setItem('sakusenchat_session', v.session); } }, stored);
  await open(A2);
  await sleep(1200);
  const dup = await A2.page.evaluate(() => ({ mid: sessionStorage.getItem('sakusenchat_mid'), session: sessionStorage.getItem('sakusenchat_session') }));
  check('W duplicate tab: gets its own id, does not take the seat', dup.mid !== stored.mid && dup.session === null && (await screen(A2)) === 'screen-top', [dup, await screen(A2)]);
  await A2.page.close();
  await sleep(800);
  room = await roomOf(key);
  check('W duplicate tab closed: original seat stays', Object.values(room.meta.guests).some((g) => g.name === 'たろう'), room.meta.guests);
  await A.page.reload();
  await waitScreen(A, 'chat');
  check('W original tab still reconnects after reload', (await A.page.evaluate(() => sessionStorage.getItem('sakusenchat_mid'))) === stored.mid);

  // ── Q. 退出する → 参加の画面にもどる。席があく。入り直せる
  await B.page.click('#btnLeave');
  await waitScreen(B, 'join');
  check('Q leave: link is back in the address', B.page.url().includes('?room=' + key));
  await waitToast(H, 'はなこが出たよ');
  room = await roomWhen(key, (r) => Object.keys(r.meta.guests).length === 1);
  check('Q leave: seat freed', Object.values(room.meta.guests).map((g) => g.name).join() === 'たろう');
  check('Q leave: name is filled in', (await B.page.inputValue('#guestName')) === 'はなこ');
  await B.page.click('#btnJoinRoom');
  await waitScreen(B, 'chat');
  await B.page.waitForFunction(() => document.querySelectorAll('.sc-msg').length === 5);
  check('Q rejoin: sees the talk', true);

  // ── V. タブを閉じる → 席があく
  await B.page.close();
  await waitToast(H, 'はなこが出たよ');
  room = await roomWhen(key, (r) => Object.keys(r.meta.guests).length === 1);
  check('V close: seat freed', Object.keys(room.meta.guests).length === 1 && !room.typing);

  // ── N. メンターが「終わる」を押さずに閉じる → 参加している人は待ち画面。メンターは「前のルームにもどる」
  await H.page.close({ runBeforeUnload: false });
  room = await roomWhen(key, (r) => r.meta.hostConnected === false);
  check('N host closed: marked disconnected', room.meta.hostConnected === false && typeof room.meta.hostDisconnectedAt === 'number');
  await A.page.waitForSelector('#hostOffOverlay:not([hidden])', { timeout: 10000 });
  check('N guest waits', (await text(A, '#hostOffOverlay h2')) === 'メンターの戻りを待っています');
  await A.page.screenshot({ path: path.join(L.OUT, 'guest-waiting.png') });
  const H2 = await L.newPage(H.context, 'host-newtab');
  await open(H2);
  await H2.page.waitForSelector('#prevRoom:not([hidden])', { timeout: 8000 });
  check('N new tab: previous room offered, create hidden', await visible(H2, '#btnPrevResume') && await visible(H2, '#btnPrevDelete') && !(await visible(H2, '#createForm')));
  await H2.page.screenshot({ path: path.join(L.OUT, 'host-prev-room.png') });
  await H2.page.click('#btnPrevResume');
  await waitScreen(H2, 'chat');
  await H2.page.waitForFunction(() => document.querySelectorAll('.sc-msg').length === 5);
  check('N resume: talk is there, host tools', await visible(H2, '#btnFinish'));
  await A.page.waitForSelector('#hostOffOverlay', { state: 'hidden', timeout: 8000 });
  room = await roomWhen(key, (r) => r.meta.hostConnected === true);
  check('N resume: connected again, guest released', room.meta.hostConnected === true);
  await sendText(H2, 'もどったよ');
  await waitMsgs(A, 6);
  check('N resume: name kept (new tab is another person id)', (await msgs(A))[5] === 'メンター:もどったよ');

  // ── P. 終わる → すべて消える。参加している人は終わりの画面。古いリンクでは入れない
  await sendText(A, '画像なしの最後');
  await H2.page.click('#btnFinish');
  check('P confirm text', (await text(H2, '#confirmTitle')) === '作戦会議チャットを終わる？');
  await H2.page.click('#btnConfirmCancel');
  check('P cancel keeps room', (await screen(H2)) === 'screen-chat' && !!(await roomOf(key)));
  await H2.page.click('#btnFinish'); await H2.page.click('#btnConfirmOk');
  await waitScreen(H2, 'end');
  await waitScreen(A, 'end');
  room = await roomWhen(key, (r) => r === null);
  check('P db: room is gone', room === null, room);
  check('P guest end text', (await text(A, '#endLead')) === '会話と画像は、すべて消えたよ。' && !(await visible(A, '#btnEndTop')));
  check('P dom wiped', (await A.page.$$('.sc-msg, .sc-topic')).length === 0 && (await A.page.title()) === '作戦会議チャット | room-K');
  await sleep(1500);
  check('P no ghost after everyone is done', (await roomOf(key)) === null);
  await A.page.reload();
  await sleep(800);
  check('P guest reload after end: top, no room', (await screen(A)) === 'screen-top' && !(await visible(A, '#mentorTools')));
  const C = await L.newClient('late');
  await L.join(C, key, 'おそい');
  await C.page.waitForFunction(() => (document.getElementById('joinError').textContent || '').includes('もう終わっているよ'));
  check('P old link is dead', (await screen(C)) === 'screen-join');
  check('P failed join makes no ghost', (await roomOf(key)) === null);
  await H2.page.click('#btnEndTop');
  await waitScreen(H2, 'top');
  await sleep(600);
  check('P host back to top: can create, no previous room', await visible(H2, '#createForm') && !(await visible(H2, '#prevRoom')));

  // ── O. 期限切れ: メンターがもどらないまま時間がたつ → 参加している人の画面がルームを消す
  const H3 = await L.newPage(H.context, 'host3');
  const r2 = await L.createRoom(H3, 'メンター');
  const D = await L.newClient('guestD');
  await L.joinOk(D, r2.key, 'じろう');
  await sendText(D, '消える前');
  await H3.page.close({ runBeforeUnload: false });
  await roomWhen(r2.key, (r) => r.meta.hostConnected === false);
  await D.page.waitForSelector('#hostOffOverlay:not([hidden])', { timeout: 10000 });
  await rest('PATCH', ROOMS + r2.key + '/meta', { hostDisconnectedAt: Date.now() - 9 * 60 * 1000 });
  await sleep(2500);
  check('O 9 minutes: still waiting', (await screen(D)) === 'screen-chat' && !!(await roomOf(r2.key)));
  await rest('PATCH', ROOMS + r2.key + '/meta', { hostDisconnectedAt: Date.now() - 11 * 60 * 1000 });
  await waitScreen(D, 'end');
  check('O expired text', (await text(D, '#endLead')).startsWith('メンターがもどらなかったので'));
  room = await roomWhen(r2.key, (r) => r === null);
  check('O db: expired room removed with its messages', room === null, room);
  // メンターがあとからひらく → 前のルームは出ない
  const H4 = await L.newPage(H.context, 'host4');
  await open(H4);
  await H4.page.waitForFunction(() => !document.getElementById('mentorTools').hidden);
  await sleep(1200);
  check('O host later: no previous room', !(await visible(H4, '#prevRoom')) && await visible(H4, '#createForm'));
  check('O host later: forgotten', (await H4.page.evaluate(() => JSON.parse(localStorage.getItem('sakusenchat_my_rooms') || '[]').length)) === 0);

  // ── R. だれもいなくなったルーム: メンターがつぎにひらいたときに片付く
  await H4.page.fill('#hostName', 'メンター'); await H4.page.click('#btnCreateRoom');
  await waitScreen(H4, 'chat');
  await H4.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 2);
  await sendText(H4, 'のこった会話');
  const key3 = await H4.page.evaluate(() => JSON.parse(sessionStorage.getItem('sakusenchat_session')).key);
  await roomWhen(key3, (r) => r?.msgs);
  await H4.page.close({ runBeforeUnload: false });
  await roomWhen(key3, (r) => r.meta.hostConnected === false);
  // (1) 期限の前: もどるか消すかを選ぶ → 消す
  const H5 = await L.newPage(H.context, 'host5');
  await open(H5);
  await H5.page.waitForSelector('#prevRoom:not([hidden])', { timeout: 8000 });
  await H5.page.click('#btnPrevDelete');
  check('R delete confirm', (await text(H5, '#confirmTitle')) === '前のルームを消す？');
  await H5.page.click('#btnConfirmOk');
  await waitToast(H5, '前のルームを消したよ');
  check('R deleted: db gone, create shown', (await roomWhen(key3, (r) => r === null)) === null && await visible(H5, '#createForm') && !(await visible(H5, '#prevRoom')));
  // (2) 期限のあと: 何も聞かずに片付ける
  await H5.page.fill('#hostName', 'メンター'); await H5.page.click('#btnCreateRoom');
  await waitScreen(H5, 'chat');
  const key4 = await H5.page.evaluate(() => JSON.parse(sessionStorage.getItem('sakusenchat_session')).key);
  await sendText(H5, 'のこった会話2');
  await roomWhen(key4, (r) => r?.msgs);
  await H5.page.close({ runBeforeUnload: false });
  await roomWhen(key4, (r) => r.meta.hostConnected === false);
  await rest('PATCH', ROOMS + key4 + '/meta', { hostDisconnectedAt: Date.now() - 11 * 60 * 1000 });
  const H6 = await L.newPage(H.context, 'host6');
  await open(H6);
  await H6.page.waitForFunction(() => !document.getElementById('mentorTools').hidden);
  check('R expired: swept on next visit', (await roomWhen(key4, (r) => r === null)) === null);
  await sleep(500);
  check('R expired: no previous room offered', !(await visible(H6, '#prevRoom')) && await visible(H6, '#createForm'));
  // (3) メンターが長く切れたあとに再読み込み → 「もう終わっていたよ」
  await H6.page.fill('#hostName', 'メンター'); await H6.page.click('#btnCreateRoom');
  await waitScreen(H6, 'chat');
  const key5 = await H6.page.evaluate(() => JSON.parse(sessionStorage.getItem('sakusenchat_session')).key);
  await roomWhen(key5, (r) => r?.meta?.hostConnected === true);
  await H6.page.goto('about:blank');
  await roomWhen(key5, (r) => r.meta.hostConnected === false);
  await rest('PATCH', ROOMS + key5 + '/meta', { hostDisconnectedAt: Date.now() - 11 * 60 * 1000 });
  await H6.page.goBack();
  await waitToast(H6, '前のルームは、もう終わっていたよ');
  check('R late return: top, room removed', (await screen(H6)) === 'screen-top' && (await roomWhen(key5, (r) => r === null)) === null);

  // ── 正しくないリンク
  const E = await L.newClient('badlink');
  await open(E, '?room=abc');
  await waitToast(E, 'リンクが正しくないよ');
  check('B2 bad link: top, param removed', (await screen(E)) === 'screen-top' && !E.page.url().includes('room='));

  // ── すべての片付けのあと、検証用のデータベースに何も残っていない
  await sleep(1000);
  const all = await rest('GET', 'sakusenchat_rooms');
  check('END nothing left in the database', all === null, all && Object.keys(all));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });
