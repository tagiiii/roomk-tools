// サークルタイム E2E その2: 午後のルーム（お題・話したい・ふりかえりの数字とひとこと・ゲーム）・読み込み直し・進行役の切断と復帰・ルームを閉じる・外された参加者・天気が取れないとき
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('sora');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 午後のルーム ──
  const code = await L.createRoom(H, 'みほ', { kind: 'pm', prog: ['9:00 午前のサークルタイム'] });
  let room = await L.roomOf(code);
  const types = room.steps.map((s) => s.type);
  check('A1 午後の流れは表紙・目次と4つ', room.kind === 'pm' && JSON.stringify(types) === JSON.stringify(['opening', 'agenda', 'talk', 'review', 'game', 'show', 'closing']), types);
  check('A2 お題が入っている（トークテーマカードから）', typeof room.steps[2].topic === 'string' && room.steps[2].topic.length > 3, room.steps[2].topic);
  const cands = room.steps[4].cands || [];
  check('A2b ゲームの候補は3つ・サムネイルつき', cands.length === 3 && cands.every((g) => g.name && /^assets\/thumbnails\//.test(g.thumb)), cands);
  await L.joinRoom(A, 'ゆい', code);
  await L.joinRoom(B, 'そら', code);
  await L.openWatch(W, code);
  await L.waitStage(W, '午後のサークルタイム');
  check('A3a はじめは午後の表紙', (await L.stage(W)).includes(code));
  await L.nextMain(H, code);
  await L.waitStage(W, 'きょうの流れ');
  check('A3b 目次に4つ', (await W.page.evaluate(() => document.querySelectorAll('#watch-stage .ag-list li').length)) === 4);
  await L.nextMain(H, code);
  await L.waitStage(W, room.steps[2].topic);
  check('A3 みせる画面にお題', (await L.stage(W)).includes('チェックイン'));
  await L.waitPlayer(A, '話したい');
  await A.page.click('#player-card [data-act="hand"]');
  await W.page.waitForFunction(() => document.querySelector('#watch-stage .talk .hands')?.textContent.includes('ゆい'));
  check('A4 話したいが名前で出る', true);
  await A.page.click('#player-card [data-act="hand"]');
  await W.page.waitForFunction(() => !document.querySelector('#watch-stage .talk .hands')?.textContent.includes('ゆい'));
  check('A5 取り消せる', true);
  await L.waitPlayer(B, 'チャットに書いたよ');
  await B.page.click('#player-card [data-act="chat"]');
  await W.page.waitForFunction(() => [...document.querySelectorAll('#watch-stage .talk .hands')].some((h) => h.textContent.includes('チャットに書いた人') && h.textContent.includes('そら')));
  check('A5b マイクを使わない人は「チャットに書いたよ」で名前が出る', true);
  await L.waitText(H, '#plist', 'チャット');
  check('A5c ホストの一覧にも「チャット」', true);
  const topic1 = room.steps[2].topic;
  await H.page.click('#btn-topic');
  await W.page.waitForFunction((t) => !document.querySelector('#watch-stage .odai')?.textContent.includes(t), topic1);
  room = await L.roomOf(code);
  check('A6 つぎのお題で変わる', room.steps[2].topic !== topic1 && room.steps[2].topic.length > 3);
  await L.shot(W, 'pm-talk', false);

  // ── B. ふりかえり ──
  await L.nextMain(H, code);
  await L.waitStage(W, '今日はどうだった');
  await L.waitPlayer(A, 'ひとこと');
  check('B1 ふりかえりは伏せない（せーのボタンなし）', !(await L.visible(H, '#btn-reveal')));
  await A.page.click('#player-card [data-act="pick"][data-v="5"]');
  await A.page.click('#player-card [data-act="pickw"][data-v="0"]');
  await A.page.click('#player-card [data-act="pickw"][data-v="2"]');
  await A.page.fill('#p-note', 'ゲームがたのしかった');
  check('B1b 送るまでは画面に出ない', (await W.page.evaluate(() => document.querySelectorAll('#watch-stage .rows .chip').length)) === 0);
  await A.page.click('#p-send');
  await W.page.waitForFunction(() => [...document.querySelectorAll('#watch-stage .rows .row:nth-child(1) .chip')].some((e) => e.textContent.trim() === 'ゆい'));
  check('B2 送ると数字の段に名前', true);
  check('B2b ひとこと・自由記述はみんなの画面に出さない', !(await L.stage(W)).includes('たのしかった') && !(await L.stage(W)).includes('わらった'));
  await L.waitText(H, '#plist', 'ゲームがたのしかった');
  check('B3 ホストの一覧に 5・たのしかった・わらった と自由記述', (await L.text(H, '#plist')).includes('5・たのしかった・わらった'));
  await A.page.click('#player-card [data-act="pickw"][data-v="0"]');
  await L.waitText(A, '#p-send', '送りなおす');
  await A.page.click('#p-send');
  await L.waitNoText(H, '#plist', 'たのしかった・');
  check('B4 ひとことは外して送りなおせる', (await L.text(H, '#plist')).includes('5・わらった'));
  await B.page.click('#player-card [data-act="pick"][data-v="3"]');
  await B.page.click('#p-send');
  await W.page.waitForFunction(() => [...document.querySelectorAll('#watch-stage .rows .row:nth-child(3) .chip')].some((e) => e.textContent.trim() === 'そら'));
  await L.shot(W, 'pm-review', false);
  await L.shot(A, 'pm-player-review');

  // ── C. 読み込み直し ──
  await A.page.reload();
  await L.gate(A);
  await L.waitScreen(A, 'player');
  await L.waitPlayer(A, 'ひとこと');
  check('C1 参加者は読み込み直しても続き', await L.pressed(A, '#player-card [data-act="pick"][data-v="5"]') && await L.pressed(A, '#player-card [data-act="pickw"][data-v="2"]') && (await A.page.inputValue('#p-note')) === 'ゲームがたのしかった');
  room = await L.roomOf(code);
  const idA = Object.keys(room.players).find((id) => room.players[id].name === 'ゆい');
  check('C2 古い在室は消えて1つ', Object.keys(room.players[idA].connections || {}).length === 1);
  await H.page.reload();
  await L.gate(H);
  await L.waitScreen(H, 'host');
  await L.waitText(H, '#plist', 'ゆい');
  room = await L.roomOf(code);
  check('C3 進行役も読み込み直しで戻る', room.hostConnected === true && (await L.text(H, '#host-code')) === code);

  // ── D. ゲームの画面 ──
  await L.nextMain(H, code);
  await L.waitStage(W, 'くじで決める');
  check('D0 ゲームの画面でだけくじと候補の操作が出る', await L.visible(H, '#game-box') && await L.visible(H, '#game-picks [data-draw]') && (await H.page.evaluate(() => document.querySelectorAll('#game-picks [data-pick]').length)) === 3);
  check('D0b みせる画面に3つのカードとサムネイル', (await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .game img')].filter((i) => i.complete && i.naturalWidth > 0).length)) === 3);
  await L.waitPlayer(A, 'くじで決める');
  check('D0c 票を入れるボタンは出さない', (await A.page.evaluate(() => document.querySelectorAll('#player-card [data-act="ans"]').length)) === 0);
  await L.shot(W, 'pm-game-choose', false);
  await L.shot(A, 'pm-player-game-choose');
  const popupP = H.context.waitForEvent('page');
  await H.page.click('#game-picks [data-draw]');
  const popup = await popupP;
  await W.page.waitForFunction(() => !!document.querySelector('#watch-stage .games.spin'));
  check('D0d くじのあいだは候補が順に光る', (await L.stage(W)).includes('くじを引いています'));
  await L.waitStage(W, 'あそびかたを説明', 6000);
  room = await L.roomOf(code);
  const picked = room.steps[4].cands[room.steps[4].pick];
  check('D0e くじで1つに決まる', !!picked && (await L.stage(W)).includes(picked.name));
  await L.waitPlayer(A, 'これであそぶよ');
  check('D0f くじを押すと、決まったゲームのタブが開く', popup.url().endsWith('/apps/' + picked.slug + '/'), popup.url());
  check('D0f2 ルームができるまでは「ルームができたら…」', (await L.player(A)).includes('ルームができたら') && !(await A.page.$('#player-card .p-go')));
  // 開いたタブでルームを作る（ゲームのツールがタブに残すのと同じ形）
  await popup.evaluate(() => sessionStorage.setItem('roomk-test-session', JSON.stringify({ roomCode: 'QWERTY', role: 'host' })));
  await L.waitPlayer(A, 'ゲームに入る', 6000);
  check('D0f3 ルームのコードを拾って、参加者に「ゲームに入る」（?room= つき）', (await A.page.getAttribute('#player-card .p-go', 'href')).endsWith('/apps/' + picked.slug + '/?room=QWERTY'));
  await L.waitStage(W, 'QWERTY');
  check('D0f4 みんなの画面にルームコード・ホストに「出しました」', (await L.text(H, '#game-picks')).includes('ルーム QWERTY をみんなの端末に出しました'));
  await H.page.click('#btn-chat');
  await L.waitToast(H, 'チャット用');
  check('D0f5 チャット用の文に参加リンク', (await H.page.evaluate(() => navigator.clipboard.readText())).includes('?room=QWERTY'));
  await popup.close();
  await L.shot(W, 'pm-game-picked', false);
  const before = room.steps[4].cands.map((g) => g.slug).join();
  await H.page.click('#game-picks [data-reshuffle]');
  await L.waitRoom(code, (r) => r.steps[4].cands.map((g) => g.slug).join() !== before);
  room = await L.roomOf(code);
  check('D0g 候補を入れかえると3つとも別のもの・決まりはとける', room.steps[4].cands.length === 3 && room.steps[4].cands.every((g) => !before.split(',').includes(g.slug)) && room.steps[4].pick == null, room.steps[4].cands.map((g) => g.slug));
  await H.page.evaluate(() => { document.querySelector('#game-box details').open = true; });
  await H.page.fill('#game-link-in', 'not a link');
  await H.page.click('#game-link-save');
  await L.waitToast(H, 'リンクの形');
  await H.page.fill('#game-link-in', 'https://example.com/roomk-tools/uso-jisho/?room=ABCDEF');
  await H.page.click('#game-link-save');
  await L.waitStage(W, 'うそつき辞書');
  await L.waitPlayer(A, 'ゲームに入る');
  check('D1 ゲームの名前はツール一覧から・リンクは参加者だけ', (await A.page.getAttribute('#player-card .p-link', 'href')) === 'https://example.com/roomk-tools/uso-jisho/?room=ABCDEF' && !(await L.stage(W)).includes('https://'));
  check('D2 帯に「ゲーム」「明日」', (await L.text(W, '#watch-stage .progress')).includes('ゲーム') && (await L.text(W, '#watch-stage .progress')).includes('明日'));
  await L.shot(W, 'pm-game', false);

  // ── E. 進行役の切断と復帰 ──
  await H.page.evaluate(() => firebase.database().goOffline());
  await A.page.waitForFunction(() => !document.querySelector('#overlay').hidden && document.querySelector('#overlay-title').textContent.includes('進行役'), null, { timeout: 60000 });
  check('E1 参加者に「進行役の戻りを待っています」', true);
  await W.page.waitForFunction(() => !document.querySelector('#overlay').hidden, null, { timeout: 20000 });
  check('E2 みせる画面にも', (await L.text(W, '#overlay-title')).includes('進行役'));
  await H.page.evaluate(() => firebase.database().goOnline());
  await A.page.waitForFunction(() => document.querySelector('#overlay').hidden, null, { timeout: 30000 });
  await W.page.waitForFunction(() => document.querySelector('#overlay').hidden, null, { timeout: 30000 });
  check('E3 戻ると続き', (await L.player(A)).includes('うそつき辞書'));

  // ── F. 外された参加者 ──
  room = await L.roomOf(code);
  const idB = Object.keys(room.players).find((id) => room.players[id].name === 'そら');
  await H.page.click(`#plist [data-remove="${idB}"]`);
  await B.page.waitForFunction(() => !document.querySelector('#overlay').hidden && document.querySelector('#overlay-title').textContent.includes('外れました'));
  check('F1 外された人に知らせてトップへ', (await L.screenActive(B)) === 'screen-top');
  check('F2 外された人の記録は消える', !(await B.page.evaluate(() => sessionStorage.getItem('roomk-circle-time-session'))));

  // ── G. ルームを閉じる ──
  await H.page.click('#btn-finish');
  await A.page.waitForFunction(() => !document.querySelector('#overlay').hidden && document.querySelector('#overlay-title').textContent.includes('おしまい'), null, { timeout: 15000 });
  check('G1 参加者に「おしまい」', (await L.screenActive(A)) === 'screen-top');
  await L.waitScreen(H, 'top');
  await sleep(1500);
  check('G2 ルームは消える', (await L.roomOf(code)) === null);
  check('G3 進行役の記録も消える', !(await H.page.evaluate(() => sessionStorage.getItem('roomk-circle-time-session'))));
  await W.page.waitForFunction(() => document.querySelector('.screen.active')?.id === 'screen-top', null, { timeout: 15000 });
  check('G4 みせる画面もトップへ', true);

  // ── H. 天気が取れないとき ──
  const H2 = await L.newClient('host2', { weatherDown: true });
  const code2 = await L.createRoom(H2, 'たぎ', { weatherDown: true });
  room = await L.roomOf(code2);
  check('H1 天気なしでも作れる・何の日は空なら飛ばす', room.weather === undefined || room.weather === null ? room.steps.length === 8 : false, room.steps?.map((s) => s.type));
  await L.goMain(H2, code2, room.steps.find((s) => s.type === 'weather').id);
  await L.waitText(H2, '#host-preview', '天気はまだ取れていません');
  check('H2 天気の画面に「まだ取れていません」', true);
  await H2.page.click('#btn-finish');
  await L.waitScreen(H2, 'top');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });
