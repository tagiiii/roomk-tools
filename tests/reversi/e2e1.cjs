// リバーシ E2E その1: 作成・参加・席・観戦・みんなにみせる画面・補助・対局の同期・1手もどす・最後まで・もう一回・待合室へ・端末なしの参加者・ホストも対戦・幅・ルームを閉じる
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, cell } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const C = await L.newClient('riku');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 作成・参加・席 ──
  await L.open(H);
  check('A0 トップの主ボタンは1つ', (await H.page.$$('#screen-top .btn-primary')).length === 1);
  await H.page.click('#btnGoCreate');
  await H.page.click('#btnCreateRoom');
  check('A1 名前がないと作れない', (await L.text(H, '#createError')).includes('名前'));
  await H.page.fill('#hostName', 'メンター');
  await H.page.click('#btnCreateRoom');
  await L.waitScreen(H, 'waiting');
  const code = (await L.text(H, '#roomCodeLabel')).trim();
  check('A2 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('A3 はじめの設定', room.status === 'waiting' && room.aid.who === 'both' && room.aid.spots === true && room.aid.count === false && room.moveTime === 0, room);
  check('A4 ホストに「みんなにみせる画面」と「ルームを閉じる」', await L.visible(H, '#btnOpenWatch') && (await L.text(H, '#btnLeave')) === 'ルームを閉じる');
  check('A5 1人では始められない', await H.page.isDisabled('#btnStartGame'));
  check('A6 room-create を数える', await L.waitStats(H, 'room-create', 1));

  await L.joinRoom(A, 'あおい', code);
  check('A7 参加者は待つ', await L.visible(A, '#lobbyWait') && !(await L.visible(A, '#btnStartGame')));
  room = await L.roomWhen(code, (r) => r.seats?.b === 'あおい');
  check('A8 入った人が黒の席に入る', room.seats?.b === 'あおい', room.seats);
  check('A9 ホストは席に入らない', !room.seats?.w);
  await L.joinRoom(B, 'そら', code);
  room = await L.roomWhen(code, (r) => r.seats?.w === 'そら');
  check('A10 2人目は白', room.seats?.w === 'そら');
  check('A11 2人そろうと始められる', await waitFor(async () => !(await H.page.isDisabled('#btnStartGame'))));
  await L.joinRoom(C, 'りく', code);
  check('A12 3人目は観戦', await waitFor(async () => (await L.text(H, '#lobbyPeople')).includes('りく観戦')), await L.text(H, '#lobbyPeople'));
  check('A13 観戦の人のバー', (await L.text(C, '#barMe')).includes('観戦中'));
  // 同じ名前は入れない
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'あおい');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('A14 同じ名前は入れない', true);
  await X.page.fill('#guestName', 'メンター');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('A15 ホストと同じ名前も入れない', true);
  await X.page.close();

  // みんなにみせる画面
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('A16 みんなにみせる画面に参加のしかた', await L.visible(W, '#lobbyJoin') && (await L.text(W, '#lobbyJoinCode')) === code);
  check('A17 みんなにみせる画面は参加者に入らない', Object.keys((await L.roomOf(code)).players).length === 4);
  check('A18 みんなにみせる画面にコピーのボタンは出ない', !(await L.visible(W, '#btnCopyCode')) && await L.visible(W, '#btnLeave'));

  // 席の入れかえ・ホストが席に入る
  await H.page.click('#btnSeatSwap');
  check('A19 入れかえが参加者に届く', await waitFor(async () => (await L.text(A, '#seatView')).includes('白あおい（あなた）')), await L.text(A, '#seatView'));
  await H.page.selectOption('#seatB', { label: 'メンター（自分）' });
  check('A20 ホストも席に入れる', await waitFor(async () => (await L.text(B, '#seatView')).includes('黒メンター')));
  await H.page.selectOption('#seatB', { label: 'あおい' });
  room = await L.roomWhen(code, (r) => r.seats?.b === 'あおい');
  check('A21 反対の席の人を選ぶと入れかわる', room.seats?.b === 'あおい' && room.seats?.w === 'メンター', room.seats);
  await H.page.selectOption('#seatW', { label: 'そら' });
  await L.roomWhen(code, (r) => r.seats?.w === 'そら');

  // 補助: 黒の人だけ・ひっくり返る数
  await H.page.click('#lobbyAid .rv-seg__opt:nth-child(2)');
  await H.page.check('#lobbyAid input[data-key=count]');
  check('A22 補助の設定が参加者に届く', await waitFor(async () => (await L.text(A, '#lobbyAidView')) === '黒の人だけ：置ける場所とひっくり返る数'), await L.text(A, '#lobbyAidView'));
  check('A23 制限時間のはじめは「なし」', (await L.text(A, '#moveTimeView')) === 'なし');
  await L.shot(H, 'room-lobby-host');
  await L.shot(W, 'room-lobby-watch');

  // ── B. 対局 ──
  await H.page.click('#btnStartGame');
  check('B1 みんな対局の画面へ', await waitFor(async () => (await L.screen(A)) === 'game' && (await L.screen(B)) === 'game' && (await L.screen(C)) === 'game' && (await L.screen(W)) === 'game'));
  check('B2 start・players-2 を数える', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-2', 1));
  room = await L.roomOf(code);
  check('B3 対局の記録', room.status === 'play' && room.game.seats.b === 'あおい' && room.game.seats.w === 'そら' && room.game.ply === 0 && typeof room.game.turnAt === 'number', room.game);
  check('B4 黒の人に「あなたの番」', (await L.status(A)).startsWith('あなたの番だよ（黒）'), await L.status(A));
  check('B5 白の人は待つ', (await L.status(B)).includes('黒（あおい）が考え中'), await L.status(B));
  check('B6 観戦・みんなにみせる画面も見られる', (await L.status(C)).includes('考え中') && (await L.status(W)).includes('考え中'));
  check('B7 黒の番は補助が出る（数つき）', (await L.spots(A)).length === 4 && (await A.page.$$('#board .rv-mark.is-count')).length === 4);
  check('B8 番でない人・観戦は押せない', await B.page.isDisabled(cell(19)) && await C.page.isDisabled(cell(19)) && await W.page.isDisabled(cell(19)));
  check('B9 そのほかの操作はホストだけ', !(await L.visible(A, '#tools')) && await L.visible(H, '#tools'));
  check('B10 制限時間なしなら残り時間は出ない', (await L.clockText(A)) === '');
  await A.page.click(cell(0));
  check('B11 置けない場所はお知らせ', await waitFor(async () => (await L.text(A, '#roomk-toast') || '').includes('置けない')));
  await A.page.click(cell(19)); // D3
  check('B12 置いた石がみんなに届く', await waitFor(async () => JSON.stringify(await L.counts(W)) === '[4,1]' && JSON.stringify(await L.counts(B)) === '[4,1]' && JSON.stringify(await L.counts(C)) === '[4,1]'));
  check('B13 白の番', (await L.status(B)).startsWith('あなたの番だよ（白）'));
  check('B14 黒の人だけの補助なので白には出ない', (await L.spots(B)).length === 0);
  check('B15 直前の印', await W.page.$eval(cell(19), (x) => x.classList.contains('is-last')));
  await W.page.bringToFront();
  await sleep(700);
  check('B16 置いた石の動きが終わっている', await W.page.$eval(cell(19) + ' .rv-stone', (s) => getComputedStyle(s).opacity === '1' && s.getAnimations().every((a) => a.playState === 'finished')));
  await L.shot(W, 'room-game-watch');

  // ホストの「1手もどす」
  await H.page.click('#btnUndo');
  check('B17 1手もどすがみんなに届く', await waitFor(async () => JSON.stringify(await L.counts(A)) === '[2,2]' && (await L.turnOf(W)) === 'b'));
  room = await L.roomOf(code);
  check('B18 もどすと手数ももどる', room.game.ply === 0 && !room.game.hist, room.game);

  // 黒が置く → 古い手数の操作は使われない（REST で手数を進めてから押す）
  await A.page.click(cell(19));
  await waitFor(async () => (await L.turnOf(B)) === 'w');
  check('B19 番でない人のボタンは押せない（黒）', await A.page.isDisabled(cell(26)));

  // 最後まで打つ
  for (let k = 0; k < 80; k += 1) {
    room = await L.roomOf(code);
    if (room.game.over) break;
    const t = room.game.turn;
    const page = t === 'b' ? A : B;
    const mv = Object.keys(E.legalMoves(room.game.board, t)).map(Number);
    const ply = room.game.ply;
    await waitFor(async () => !(await page.page.isDisabled(cell(mv[0]))), 4000);
    await page.page.click(cell(mv[Math.floor(Math.random() * mv.length)]));
    await L.roomWhen(code, (r) => r.game.ply > ply, 4000);
  }
  room = await L.roomOf(code);
  check('B20 最後まで行く', room.game.over === true);
  const n = E.count(room.game.board);
  const want = n.b === n.w ? '引き分け！' : (n.b > n.w ? '黒（あおい）の勝ち！' : '白（そら）の勝ち！');
  check('B21 結果がみんなに出る', await waitFor(async () => (await L.status(W)).startsWith(want) && (await L.status(C)).startsWith(want) && (await L.status(H)).startsWith(want)), await L.status(W));
  check('B22 石の数', (await L.status(W)).endsWith('黒 ' + n.b + ' ー 白 ' + n.w));
  check('B23 次を決めるのはホスト', await L.visible(H, '#resultHost') && !(await L.visible(A, '#resultHost')) && await L.visible(A, '#resultWait') && !(await L.visible(W, '#resultBox')));
  const finishSum = async () => (await L.stats(A, 'finish')) + (await L.stats(B, 'finish')) + (await L.stats(H, 'finish'));
  await waitFor(async () => (await finishSum()) >= 1, 3000);
  await sleep(500);
  check('B24 finish は1回だけ', (await finishSum()) === 1, await finishSum());
  // おわったあとに1手もどして、もう一度おわらせても finish は増えない
  await H.page.click('#btnUndo');
  room = await L.roomWhen(code, (r) => r.game.over !== true);
  {
    const t = room.game.turn;
    const page = t === 'b' ? A : B;
    const mv = Number(Object.keys(E.legalMoves(room.game.board, t))[0]);
    await waitFor(async () => !(await page.page.isDisabled(cell(mv))), 4000);
    await page.page.click(cell(mv));
    room = await L.roomWhen(code, (r) => r.game.over === true || r.game.ply > room.game.ply);
    // 最後の1手でなかったときは、最後まで打ちなおす
    for (let k = 0; k < 10 && !room.game.over; k += 1) {
      const t2 = room.game.turn;
      const p2 = t2 === 'b' ? A : B;
      const m2 = Number(Object.keys(E.legalMoves(room.game.board, t2))[0]);
      const ply2 = room.game.ply;
      await waitFor(async () => !(await p2.page.isDisabled(cell(m2))), 4000);
      await p2.page.click(cell(m2));
      room = await L.roomWhen(code, (r) => r.game.ply > ply2);
    }
  }
  await sleep(800);
  check('B24b もどして終えなおしても finish は増えない', room.game.over === true && (await finishSum()) === 1, await finishSum());
  await L.shot(W, 'room-result-watch');

  // もう一回（黒と白を入れかえる）
  await H.page.click('#btnAgain');
  check('B25 もう一回で黒と白が入れかわる', await waitFor(async () => (await L.text(A, '#barMe')).includes('あなたは白') && JSON.stringify(await L.counts(A)) === '[2,2]'), await L.text(A, '#barMe'));
  check('B26 again・start を数える', await L.waitStats(H, 'again', 1) && await L.waitStats(H, 'start', 2));
  // この対局をやめる → 待合室
  await H.page.click('#btnReset');
  check('B27 対局をやめると待合室へ', await waitFor(async () => (await L.screen(A)) === 'waiting' && (await L.screen(W)) === 'waiting'));
  room = await L.roomOf(code);
  check('B28 席は直前の対局のまま', room.seats.b === 'そら' && room.seats.w === 'あおい' && !room.game, room.seats);
  check('B29 途中でやめたときは again を数えない', (await L.stats(H, 'again')) === 1);

  // ── C. 端末なしの参加者・ホストも対戦 ──
  await H.page.fill('#proxyName', 'はる');
  await H.page.click('#btnAddProxy');
  check('C1 端末なしの参加者を足せる', await waitFor(async () => (await L.text(A, '#lobbyPeople')).includes('はる') && (await H.page.inputValue('#proxyName')) === ''));
  check('C1b 「端末なし」の印はホストの待合室だけ', (await L.text(H, '#lobbyPeople')).includes('端末なし') && !(await L.text(A, '#lobbyPeople')).includes('端末なし'));
  await H.page.fill('#proxyName', 'そら');
  await H.page.click('#btnAddProxy');
  check('C2 同じ名前は足せない', await waitFor(async () => (await L.text(H, '#proxyError') || '').includes('もういる')));
  await H.page.selectOption('#seatB', { label: 'はる（端末なし）' });
  await H.page.selectOption('#seatW', { label: 'メンター（自分）' });
  await L.roomWhen(code, (r) => r.seats?.b === 'はる' && r.seats?.w === 'メンター');
  await H.page.click('#btnStartGame');
  check('C3 端末なしの人の番はホストが置く', await waitFor(async () => (await L.status(H)).includes('黒（はる）の番。代わりに置いてね')), await L.status(H));
  check('C4 「端末なし」の印はホストだけ', (await L.text(H, '#seats')).includes('端末なし') && !(await L.text(A, '#seats')).includes('端末なし'));
  await H.page.click(cell(19));
  check('C5 代わりに置いた手が届く', await waitFor(async () => (await L.status(H)).startsWith('あなたの番だよ（白）')), { st: await L.status(H), game: (await L.roomOf(code)).game, me: await L.text(H, '#barMe') });
  check('C6 対局の席の人以外は押せない', await A.page.isDisabled(cell(18)), { st: await L.status(A), scr: await L.screen(A) });
  check('C7 ホストのバー', (await L.text(H, '#barMe')) === 'ホスト・あなたは白', await L.text(H, '#barMe'));

  // 幅
  await A.page.setViewportSize({ width: 375, height: 760 });
  await sleep(300);
  check('C8 375px で横にはみ出さない（対局）', (await L.overflow(A)) <= 0);
  await L.shot(A, 'room-375');
  await H.page.click('#btnReset');
  await L.waitScreen(H, 'waiting');
  await H.page.setViewportSize({ width: 375, height: 760 });
  await sleep(300);
  check('C9 375px で横にはみ出さない（待合室）', (await L.overflow(H)) <= 0);
  await L.shot(H, 'room-lobby-375');

  // 退出: 待合室の席は空く
  await A.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  room = await L.roomWhen(code, (r) => !r.players?.['あおい']);
  check('C10 退出した人の席は空く', !Object.values(room.seats || {}).includes('あおい'), room.seats);

  // ルームを閉じる
  await H.page.click('#btnLeave');
  check('C11 ルームを閉じると参加者はトップへ', await waitFor(async () => (await L.screen(B)) === 'top' && (await L.screen(C)) === 'top'));
  check('C12 みんなにみせる画面は終わりの表示', await waitFor(async () => (await L.screen(W)) === 'watch-end'));
  check('C13 ルームが消える', (await L.roomOf(code)) === null);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
