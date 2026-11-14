// ヒット&ブロー E2E その1: 作成・参加・遊ぶ人・みんなにみせる画面・2人で対戦（答え・予想の同期・秘密の出し分け・勝ち・引き分け）・もう一回・待合室へ・幅・退出・ルームを閉じる
const L = require('./lib.cjs');
const { E, check, sleep, waitFor } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 作成 ──
  await L.open(H);
  check('A0 トップの主ボタンは1つ', (await H.page.$$('#screen-top .btn-primary')).length === 1);
  check('A0b はじめの画面にイラスト', await H.page.$eval('#screen-top .app-hero img', (n) => n.complete && n.naturalWidth === 400));
  await H.page.click('#btnGoCreate');
  await H.page.click('#btnCreateRoom');
  check('A1 名前がないと作れない', (await L.text(H, '#createError')).includes('名前'));
  await H.page.fill('#hostName', 'a.b');
  await H.page.click('#btnCreateRoom');
  check('A1b 記号の名前は理由を出して断る', (await L.text(H, '#createError')).includes('記号'));
  await H.page.fill('#hostName', 'メンター');
  await H.page.click('#btnCreateRoom');
  await L.waitScreen(H, 'waiting');
  const code = (await L.text(H, '#roomCodeLabel')).trim();
  check('A2 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('A3 はじめの設定（2人で対戦・やさしい・ホストも遊ぶ）', room.status === 'waiting' && room.mode === 'duel' && room.level === 'easy' && room.seated?.['メンター'] === true, room);
  check('A4 ホストに「みんなにみせる画面」と「ルームを閉じる」', await L.visible(H, '#btnOpenWatch') && (await L.text(H, '#btnLeave')) === 'ルームを閉じる');
  check('A5 1人では始められない', await H.page.isDisabled('#btnStartGame'));
  check('A6 room-create を数える', await L.waitStats(H, 'room-create', 1));

  // ── B. 参加・遊ぶ人 ──
  await L.joinRoom(A, 'あおい', code);
  check('B1 参加者は待つ', await L.visible(A, '#lobbyWait') && !(await L.visible(A, '#btnStartGame')));
  room = await L.roomWhen(code, (r) => r.seated?.['あおい']);
  check('B2 2人目は「遊ぶ」で入る', room.seated?.['あおい'] === true);
  check('B3 2人そろうと始められる', await waitFor(async () => !(await H.page.isDisabled('#btnStartGame'))));
  await L.joinRoom(B, 'そら', code);
  room = await L.roomWhen(code, (r) => r.players?.['そら']);
  check('B4 上限をこえた人は「見るだけ」', !room.seated?.['そら'], room.seated);
  check('B5 見るだけの人のバー', await waitFor(async () => (await L.text(B, '#barMe')).includes('見るだけ')));
  check('B6 参加者の一覧に「遊ぶ」「見るだけ」', await waitFor(async () => { const t = await L.text(A, '#lobbyPeople'); return t.includes('あおい遊ぶ') && t.includes('そら見るだけ'); }), await L.text(A, '#lobbyPeople'));
  check('B7 参加者には切りかえのボタンが出ない', (await A.page.$$('#lobbyPeople .hbw-quiet')).length === 0);
  // 同じ名前は入れない
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  check('B8 リンクから開くとコードが入っている', (await X.page.inputValue('#joinCode')) === code && await L.visible(X, '#joinLinkHint'));
  await X.page.fill('#guestName', 'あおい');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('B9 同じ名前は入れない', true);
  await X.page.fill('#guestName', 'メンター');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('B10 ホストと同じ名前も入れない', true);
  await X.page.fill('#guestName', 'そらの');
  await X.page.fill('#joinCode', 'ａｂｃ');
  await X.page.click('#btnJoinRoom');
  check('B11 ルームコードの全角は直してから検査する', (await L.text(X, '#joinError')).includes('6文字'));
  await X.page.close();

  // みんなにみせる画面
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('C1 みんなにみせる画面に参加のしかた', await L.visible(W, '#lobbyJoin') && (await L.text(W, '#lobbyJoinCode')) === code);
  check('C2 みんなにみせる画面は参加者に入らない', Object.keys((await L.roomOf(code)).players).length === 3);
  check('C3 みんなにみせる画面にコピーのボタンは出ない', !(await L.visible(W, '#btnCopyCode')) && await L.visible(W, '#btnLeave'));

  // ホストが遊ぶ人を入れかえる・むずかしさ
  const toggle = (c, name) => c.page.locator('#lobbyPeople .hbw-person', { hasText: name }).locator('button').first();
  check('D0 上限のときは「遊ぶにする」を押せない', await toggle(H, 'そら').isDisabled());
  await toggle(H, 'メンター').click();
  room = await L.roomWhen(code, (r) => !r.seated?.['メンター']);
  check('D1 ホストを「見るだけ」にできる', !room.seated?.['メンター'], room.seated);
  await waitFor(async () => !(await toggle(H, 'そら').isDisabled()));
  await toggle(H, 'そら').click();
  room = await L.roomWhen(code, (r) => r.seated?.['そら']);
  check('D2 そらを「遊ぶ」に', room.seated?.['そら'] === true);
  check('D3 参加者の画面にも届く', await waitFor(async () => (await L.text(B, '#barMe')).includes('遊ぶ')));
  await H.page.click('#lobbyLevelSeg .hbw-seg__btn:nth-child(2)');
  check('D4 むずかしさが参加者に届く', await waitFor(async () => (await L.text(A, '#lobbyModeView')).includes('ふつう（6色から4つ）')), await L.text(A, '#lobbyModeView'));
  await H.page.click('#lobbyModeSeg .hbw-seg__btn:nth-child(2)');
  check('D5 あそびかたが参加者に届く', await waitFor(async () => (await L.text(A, '#lobbyModeView')).includes('みんなで対戦')));
  await H.page.click('#lobbyModeSeg .hbw-seg__btn:nth-child(1)');
  await L.roomWhen(code, (r) => r.mode === 'duel');
  await L.shot(H, 'lobby-host');
  await L.shot(W, 'lobby-watch');

  // ── E. 2人で対戦: 答えを決める ──
  await H.page.click('#btnStartGame');
  room = await L.roomWhen(code, (r) => r.status === 'play');
  let g = E.normalize(room.game);
  check('E1 ゲームができる（あおい・そらの順、ふつう）', g && g.phase === 'setup' && room.game.names.join() === 'あおい,そら' && g.level === 'normal', room.game);
  check('E2 start・players-2 を数える', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-2', 1));
  await L.waitVisible(A, '#setupBox');
  await L.waitVisible(B, '#setupBox');
  check('E3 ホストは答えを決めない', !(await L.visible(H, '#setupBox')) && (await L.text(H, '#waitText')).includes('2人が答えを決める'));
  check('E4 みんなにみせる画面も待つ', await waitFor(async () => (await L.text(W, '#waitText')).includes('答えを決める')));
  check('E5 4つそろうまで「これにする」を押せない', await A.page.isDisabled('#btnSetupOk'));
  const secretA = ['red', 'blue', 'yellow', 'green'];
  await L.pickColors(A, 'setup', ['red', 'blue', 'yellow']);
  check('E6 使った色は押せない', await A.page.isDisabled('#setupPalette .hbw-peg:nth-child(1)'));
  await A.page.click('#setupSlots .hbw-peg:nth-child(2)');
  check('E7 ならべた色を押すとけせる', (await A.page.$$('#setupSlots .hbw-peg--empty')).length === 2);
  await L.pickColors(A, 'setup', ['blue', 'green']);
  await A.page.click('#btnSetupOk');
  room = await L.roomWhen(code, (r) => r.game?.secrets?.[0]);
  check('E8 答えが保存される', JSON.stringify(E.normalize(room.game).secrets[0]) === JSON.stringify(secretA), room.game.secrets);
  check('E9 決めた人には自分の答えが出る', await waitFor(async () => (await A.page.$$('#mineRow .hbw-peg')).length === 4) && !(await L.visible(A, '#setupBox')));
  check('E10 相手・ホスト・みんなにみせる画面には出ない', !(await L.visible(B, '#mineBox')) && !(await L.visible(H, '#mineBox')) && !(await L.visible(W, '#mineBox')));
  check('E11 決めた印が札に出る', await waitFor(async () => (await H.page.$$('#seats .hbw-seat .material-symbols-rounded')).length === 1));
  await B.page.click('#btnSetupRandom');
  check('E12 「おまかせ」で4つ入る', (await B.page.$$('#setupSlots .hbw-peg--empty')).length === 0 && !(await B.page.isDisabled('#btnSetupOk')));
  await B.page.click('#btnSetupOk');
  room = await L.roomWhen(code, (r) => r.game?.phase === 'play');
  g = E.normalize(room.game);
  const secretB = g.secrets[1];
  check('E13 2人そろうと予想に進む', g.phase === 'play' && g.turn === 0 && E.validCode(secretB, 'normal'));

  // ── F. 予想の同期 ──
  await L.waitVisible(A, '#guessBox');
  check('F1 番の人に予想の欄', (await L.text(A, '#guessTitle')).includes('あなたの予想'));
  check('F2 番でない人・ホストには出ない', !(await L.visible(B, '#guessBox')) && !(await L.visible(H, '#guessBox')) && (await L.text(B, '#waitText')).includes('あおいが考えています'));
  check('F3 番の表示', (await L.status(A)) === 'あなたの番' && (await L.status(H)) === 'あおいの番');
  check('F4 自分が当てる一覧が先', (await A.page.$eval('#boards .hbw-board__title', (n) => n.textContent)).startsWith('あなたが当てる'));
  const wrong = secretB.slice().reverse();
  const j1 = E.judge(secretB, wrong);
  await L.guess(A, wrong);
  room = await L.roomWhen(code, (r) => E.normalize(r.game)?.log.length === 1);
  g = E.normalize(room.game);
  check('F5 予想とヒントが保存される', g.log[0].by === 0 && g.log[0].hit === j1.hit && g.log[0].blow === j1.blow && g.turn === 1);
  const want = 'ヒット' + j1.hit + '・ブロー' + j1.blow;
  for (const [c, label] of [[A, 'A'], [B, 'B'], [H, 'H'], [W, 'W']]) {
    check('F6 ヒントが全員に届く ' + label, await waitFor(async () => (await L.tries(c)).includes(want)), await L.tries(c));
  }
  check('F7 点の数は予想の数と同じ', (await W.page.$$('#boards .hbw-try .hbw-dot')).length === 4);
  check('F8 番が移る', await waitFor(async () => (await L.status(B)) === 'あなたの番') && !(await L.visible(A, '#guessBox')));
  check('F9 番が変わると組み立て中の予想は空', (await B.page.$$('#guessSlots .hbw-peg--empty')).length === 4);
  // 秘密がほかの画面に出ていない（相手の答えが「あなたの答え」に出ない・結果まで答えの欄が出ない）
  check('F10 結果の前は答えの欄を出さない', !(await L.visible(H, '#resultBox')) && !(await L.visible(W, '#resultBox')));
  await L.shot(A, 'duel-play-a');
  await L.shot(W, 'duel-play-watch');

  // ── G. 後の人が先に当てると、すぐ勝ち ──
  await L.guess(B, secretA);
  room = await L.roomWhen(code, (r) => r.game?.phase === 'end');
  g = E.normalize(room.game);
  check('G1 そらの勝ち', g.phase === 'end' && JSON.stringify(g.winners) === '[1]' && room.game.ended === true);
  check('G2 結果の文', await waitFor(async () => (await L.status(H)) === 'そらが当てた！') && (await L.status(B)) === 'あなたが当てた！');
  check('G3 2人の答えを全員に出す', await waitFor(async () => (await W.page.$$('#resultAnswers .hbw-result__answer')).length === 2));
  check('G4 ホストに「もう一回」、ほかは待つ', await L.visible(H, '#btnAgain') && await L.visible(A, '#resultWait') && !(await L.visible(A, '#btnAgain')) && !(await L.visible(W, '#resultWait')));
  check('G5 finish は当てた端末だけで1回', await L.waitStats(B, 'finish', 1) && (await L.stats(A, 'finish')) === 0 && (await L.stats(H, 'finish')) === 0);
  check('G6 勝った人の札に印', (await H.page.$$('#seats .hbw-seat .material-symbols-rounded')).length === 1);
  check('G7 自分の答えの欄は結果では閉じる', !(await L.visible(A, '#mineBox')));
  await L.shot(H, 'duel-end-host');

  // ── H. もう一回（先の番がずれる）・引き分け ──
  await H.page.click('#btnAgain');
  room = await L.roomWhen(code, (r) => r.game?.phase === 'setup' && Number(r.game.id) === 2);
  check('H1 もう一回で新しいゲーム', !!room && room.status === 'play');
  check('H2 again・start を数える', await L.waitStats(H, 'again', 1) && await L.waitStats(H, 'start', 2));
  await L.waitVisible(A, '#setupBox');
  check('H3 前の答えは残っていない', (await A.page.$$('#setupSlots .hbw-peg--empty')).length === 4 && (await L.tries(A)).length === 0);
  const sA2 = ['purple', 'orange', 'red', 'blue'];
  const sB2 = ['green', 'yellow', 'blue', 'red'];
  // 2人がほぼ同時に「これにする」を押しても、どちらも通る（レビューの指摘・答えは番号 rev を見ない）
  await L.waitVisible(B, '#setupBox');
  await L.pickColors(A, 'setup', sA2);
  await L.pickColors(B, 'setup', sB2);
  await Promise.all([A.page.click('#btnSetupOk'), B.page.click('#btnSetupOk')]);
  room = await L.roomWhen(code, (r) => r.game?.phase === 'play' && Number(r.game.id) === 2);
  check('H3b 同時に決めても2人とも通る', !!room && room.game.phase === 'play', room && room.game);
  check('H3c 「送れなかった」は出ない', !((await L.text(A, '#roomk-toast')) || '').includes('送れなかった') && !((await L.text(B, '#roomk-toast')) || '').includes('送れなかった'));
  check('H4 2回めは2人目が先', E.normalize(room.game).turn === 1);
  await L.waitVisible(B, '#guessBox');
  await L.guess(B, sA2);
  room = await L.roomWhen(code, (r) => r.game?.lastChance === 0);
  check('H5 先の人が当てたら、後の人にもう1回', !!room && room.game.phase === 'play');
  check('H6 「もう1回だけ」の表示', await waitFor(async () => (await L.status(A)).includes('もう1回だけ')), await L.status(A));
  await L.waitVisible(A, '#guessBox');
  await L.guess(A, sB2);
  room = await L.roomWhen(code, (r) => r.game?.phase === 'end' && Number(r.game.id) === 2);
  check('H7 引き分け', room.game.draw === true);
  check('H8 引き分けの文', await waitFor(async () => (await L.status(W)).includes('引き分け')));
  check('H9 finish を数える（最後の予想の端末）', await L.waitStats(A, 'finish', 1));

  // 幅 375px
  await A.page.setViewportSize({ width: 375, height: 760 });
  await sleep(200);
  check('I1 375px で横にはみ出さない（結果）', (await L.overflow(A)) <= 0, await L.overflow(A));
  await L.shot(A, 'duel-end-375');

  // ── J. 待合室へ ──
  await H.page.click('#btnRelobby');
  await L.waitScreen(A, 'waiting');
  room = await L.roomOf(code);
  check('J1 待合室にもどる（遊ぶ人はそのまま）', room.status === 'waiting' && !room.game && room.seated?.['あおい'] && room.seated?.['そら'] && room.mode === 'duel' && room.level === 'normal', room);
  check('J2 again を数える', await L.waitStats(H, 'again', 2));
  check('I2 375px で横にはみ出さない（待合室）', (await L.overflow(A)) <= 0);

  // ── K. 退出・ルームを閉じる ──
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  room = await L.roomWhen(code, (r) => !r.players?.['そら']);
  check('K1 待合室で退出すると「遊ぶ」も外れる', !room.players?.['そら'] && !room.seated?.['そら'], room);
  await H.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  check('K2 ルームを閉じると参加者はトップへ', true);
  check('K3 ルームが消える', (await L.roomOf(code)) === null);
  check('K4 みんなにみせる画面はおわりの表示', await waitFor(async () => (await L.screen(W)) === 'watch-end'));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
