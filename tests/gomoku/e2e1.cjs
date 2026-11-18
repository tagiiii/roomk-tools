// 五目並べ E2E その1: ルームの作成・参加・席・観戦・みんなにみせる画面・対局の同期・補助の印・勝ち・1手もどす・もう一回・待合室へ・端末なしの参加者・幅 375px・退出
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, newClient, open, text, visible, waitVisible, waitScreen, waitText, overflow, waitStats, stats, waitFor,
  createRoom, joinRoom, cell, readBoard, turnOf, marked, lastMark, lineCells, status, shot, finishAll, ROOMS } = L;

const at = (s) => E.COLS.indexOf(s[0]) + (Number(s.slice(1)) - 1) * E.SIZE;

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const H = await newClient('host');
    const A = await newClient('guestA');
    const B = await newClient('guestB');
    const C = await newClient('watcherC');
    const code = await createRoom(H, 'ホスト');
    check('room code', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
    check('title', (await H.page.title()) === '五目並べ | あそびのたな');
    check('stats room-create', await waitStats(H, 'room-create', 1));
    await joinRoom(A, 'あお', code);
    await joinRoom(B, 'みどり', code);
    await joinRoom(C, 'きいろ', code);
    let room = await roomWhen(code, (r) => r.seats?.b && r.seats?.w && r.players?.['きいろ']);
    check('seats by join order', room.seats.b === 'あお' && room.seats.w === 'みどり', room.seats);
    check('rules default', room.moveTime === 0 && room.aid.who === 'both' && room.aid.threat === true && room.aid.hint === true && room.aid.last === true && room.aid.confirm === false, room.aid);
    await waitText(C, '#lobbyPeople', '観戦');
    check('guest sees seat view', await visible(A, '#seatView') && !(await visible(A, '#seatEdit')));
    check('guest sees aid summary', (await text(A, '#lobbyAidView')).includes('あと1つで5つのしるし'), await text(A, '#lobbyAidView'));

    // みんなにみせる画面
    const W = await newClient('watch', { viewport: { width: 1280, height: 800 } });
    await open(W, '?watch=' + code);
    await waitScreen(W, 'waiting');
    check('watch join code shown', (await text(W, '#lobbyJoinCode')) === code);
    check('watch title', (await W.page.title()).startsWith('みんなにみせる画面 | 五目並べ'));

    // はじめる
    await H.page.click('#btnStartGame');
    for (const c of [H, A, B, C, W]) await waitScreen(c, 'game');
    check('stats start', await waitStats(H, 'start', 1) && (await stats(H, 'players-2')) === 1);
    check('board 225 cells', (await H.page.$$eval('#board .gm-cell', (x) => x.length)) === 225);
    check('board empty', (await readBoard(A)) === E.emptyBoard());
    check('turn black', (await turnOf(A)) === 'b');
    check('A status mine', (await status(A)).includes('あなたの番'), await status(A));
    check('B status waiting', (await status(B)).includes('考え中'), await status(B));
    check('B cells disabled', await B.page.$eval(cell(at('H8')), (b) => b.disabled));
    check('C cells disabled', await C.page.$eval(cell(at('H8')), (b) => b.disabled));
    check('hint on empty board is center', JSON.stringify(await marked(A, 'is-hint')) === JSON.stringify([E.CENTER]), await marked(A, 'is-hint'));
    check('coords A..O', (await H.page.$$eval('.gm-coords-top .gm-coord', (x) => x.map((n) => n.textContent).join(''))) === 'ABCDEFGHIJKLMNO');

    // 置く（黒: H8 I8 J8 K8 / 白: H9 I9 J9）
    const seq = [['b', 'H8'], ['w', 'H9'], ['b', 'I8'], ['w', 'I9'], ['b', 'J8'], ['w', 'J9'], ['b', 'K8']];
    for (const [color, s] of seq) {
      const who = color === 'b' ? A : B;
      await who.page.click(cell(at(s)));
      const ply = seq.findIndex((x) => x[1] === s) + 1;
      await roomWhen(code, (r) => r.game?.ply === ply);
    }
    room = await roomOf(code);
    check('room board', room.game.board[at('K8')] === 'b' && room.game.board[at('J9')] === 'w' && room.game.ply === 7, room.game.ply);
    check('hist is indices', Array.isArray(room.game.hist) && room.game.hist.length === 7 && room.game.hist[0] === at('H8'), room.game.hist);
    await waitFor(async () => (await readBoard(C))[at('K8')] === 'b');
    check('spectator synced', (await readBoard(C)) === room.game.board);
    check('watch synced', (await readBoard(W)) === room.game.board);
    // 白の番: 相手（黒）が5つにできる場所に赤い輪・直前の手のしるし・おすすめの手
    await waitFor(async () => (await turnOf(B)) === 'w');
    check('B sees block marks', JSON.stringify(await marked(B, 'is-block')) === JSON.stringify([at('G8'), at('L8')].sort((a, b) => a - b)), await marked(B, 'is-block'));
    check('B status warns', (await status(B)).includes('相手があと1つで5つ'), await status(B));
    check('B sees last mark', JSON.stringify(await lastMark(B)) === JSON.stringify([at('K8')]), await lastMark(B));
    const hint = await marked(B, 'is-hint');
    check('B hint blocks', hint.length === 1 && [at('G8'), at('L8')].includes(hint[0]), hint);
    check('spectator sees marks too', (await marked(C, 'is-block')).length === 2);
    await shot(H, 'room-host-desktop');
    await shot(W, 'room-watch');
    // 番でない人が押しても置けない（ボタンが押せない）
    check('A disabled on B turn', await A.page.$eval(cell(at('A1')), (b) => b.disabled));
    // 置いてある所には置けない
    await B.page.click(cell(at('H8')), { force: true });
    await sleep(300);
    check('occupied stays', (await roomOf(code)).game.ply === 7);
    // 白はふさがずに置く → 黒の番に「5つならぶ」輪
    await B.page.click(cell(at('A15')));
    await roomWhen(code, (r) => r.game?.ply === 8);
    await waitFor(async () => (await turnOf(A)) === 'b');
    check('A sees five marks', JSON.stringify(await marked(A, 'is-five')) === JSON.stringify([at('G8'), at('L8')].sort((a, b) => a - b)), await marked(A, 'is-five'));
    check('A status five', (await status(A)).includes('輪の場所に置くと5つ'), await status(A));
    // 勝ち
    await A.page.click(cell(at('L8')));
    room = await roomWhen(code, (r) => r.game?.over === true);
    check('room over', room.game.over === true && room.game.ended === true);
    for (const c of [H, A, B, C, W]) await waitText(c, '#gameStatus', '勝ち');
    check('result text', (await status(C)).includes('黒（あお）の勝ち') && (await status(C)).includes('5つならんだ'), await status(C));
    check('win line', JSON.stringify(await lineCells(W)) === JSON.stringify(['H8', 'I8', 'J8', 'K8', 'L8'].map(at).sort((a, b) => a - b)), await lineCells(W));
    check('win tag', (await text(B, '.gm-seat--b')).includes('勝ち'));
    check('stats finish once', await waitStats(A, 'finish', 1) && (await stats(B, 'finish')) === 0);
    check('host result buttons', await visible(H, '#btnAgain') && await visible(H, '#btnRelobby'));
    check('guest waits', await visible(A, '#resultWait'));
    check('watch no result box', !(await visible(W, '#resultBox')));
    check('no marks after over', (await marked(B, 'is-hint')).length === 0 && (await marked(B, 'is-block')).length === 0);
    await shot(W, 'room-watch-result');

    // 1手もどす（ホスト） → おわりが消え、黒の番
    await H.page.click('#btnUndo');
    room = await roomWhen(code, (r) => r.game && !r.game.over && r.game.ply === 8);
    check('undo', room.game.board[at('L8')] === '.' && room.game.turn === 'b' && room.game.last === at('A15') && room.game.hist.length === 8, room.game);
    await waitFor(async () => !(await status(A)).includes('勝ち'));
    // もう一度勝っても finish は数えない
    await A.page.click(cell(at('G8')));
    await roomWhen(code, (r) => r.game?.over === true);
    await sleep(400);
    check('finish not double', (await stats(A, 'finish')) === 1);

    // もう一回（黒と白を入れかえる）
    await H.page.click('#btnAgain');
    room = await roomWhen(code, (r) => r.game && !r.game.over && r.game.ply === 0 && r.game.id === 2);
    check('again swaps', room.game.seats.b === 'みどり' && room.game.seats.w === 'あお', room.game.seats);
    check('stats again', await waitStats(H, 'again', 1) && await waitStats(H, 'start', 2));
    await waitFor(async () => (await status(B)).includes('あなたの番'));
    check('B now black', (await status(B)).includes('黒'));

    // 補助の設定（ホスト・あそんでいる間）: 使わない → 印が消える
    await B.page.click(cell(at('H8')));
    await roomWhen(code, (r) => r.game?.ply === 1);
    await waitFor(async () => (await marked(A, 'is-hint')).length === 1);
    check('hint before off', (await marked(A, 'is-hint')).length === 1);
    await H.page.click('#btnAid');
    await waitVisible(H, '#aidDialog');
    const box = await H.page.$eval('#aidDialog', (d) => { const r = d.getBoundingClientRect(); return { x: r.x, w: r.width, vw: innerWidth }; });
    check('aid dialog centered', Math.abs(box.x + box.w / 2 - box.vw / 2) < 4, box);
    await H.page.click('#dialogAid input[value="none"]');
    await roomWhen(code, (r) => r.aid?.who === 'none');
    await waitFor(async () => (await marked(A, 'is-hint')).length === 0);
    check('aid off hides hint', (await marked(A, 'is-hint')).length === 0);
    check('aid off hides last', (await lastMark(A)).length === 0);
    await H.page.click('#dialogAid input[value="both"]');
    await H.page.click('#btnAidClose');
    await roomWhen(code, (r) => r.aid?.who === 'both');
    await waitFor(async () => (await lastMark(A)).length === 1);
    check('aid back', (await lastMark(A)).length === 1);

    // 置く前にたしかめる
    await H.page.click('#btnAid');
    await H.page.check('#dialogAid input[data-key="confirm"]');
    await H.page.click('#btnAidClose');
    await roomWhen(code, (r) => r.aid?.confirm === true);
    await sleep(300);
    await A.page.click(cell(at('I9')));
    await waitVisible(A, '#confirmBox');
    check('confirm text', (await text(A, '#confirmText')).includes('I9 に置く'), await text(A, '#confirmText'));
    check('not placed yet', (await roomOf(code)).game.ply === 1);
    check('ghost', await A.page.$eval(cell(at('I9')), (b) => b.classList.contains('is-ghost-w')));
    await A.page.click('#btnPlace');
    await roomWhen(code, (r) => r.game?.ply === 2);
    check('placed after confirm', (await roomOf(code)).game.board[at('I9')] === 'w');

    // 幅 375px（参加者）
    await A.page.setViewportSize({ width: 375, height: 760 });
    await sleep(300);
    check('375 no overflow', (await overflow(A)) <= 0, await overflow(A));
    const cw = await A.page.$eval(cell(0), (b) => b.getBoundingClientRect().width);
    check('375 cell size >= 21px', cw >= 21, cw);
    await shot(A, 'room-guest-375');

    // この対局をやめる → 待合室（席は直前の対局のまま）
    await H.page.click('#btnReset');
    room = await roomWhen(code, (r) => r.status === 'waiting');
    check('back to lobby', room.status === 'waiting' && !room.game && room.seats.b === 'みどり', room.seats);
    for (const c of [A, B, W]) await waitScreen(c, 'waiting');

    // 端末なしの参加者
    await H.page.fill('#proxyName', 'もも');
    await H.page.click('#btnAddProxy');
    room = await roomWhen(code, (r) => r.proxies?.['もも']);
    check('proxy added', !!room.proxies['もも']);
    check('proxy mark host only', (await text(H, '#lobbyPeople')).includes('端末なし') && !(await text(A, '#lobbyPeople')).includes('端末なし'));
    await H.page.selectOption('#seatW', 'もも');
    room = await roomWhen(code, (r) => r.seats?.w === 'もも');
    await H.page.click('#btnStartGame');
    room = await roomWhen(code, (r) => r.status === 'play');
    check('proxy game', room.game.proxy.w === true && room.game.seats.b === 'みどり');
    // 「置く前にたしかめる」がオンのままなので、同じ場所を2回押して置く
    await B.page.click(cell(at('H8')));
    await B.page.click(cell(at('H8')));
    await roomWhen(code, (r) => r.game?.ply === 1);
    await waitText(H, '#gameStatus', '代わりに置いて');
    await H.page.click(cell(at('H9')));
    await H.page.click(cell(at('H9')));
    room = await roomWhen(code, (r) => r.game?.ply === 2);
    check('host places for proxy', room.game.board[at('H9')] === 'w');
    check('guest cannot place for proxy', await A.page.$eval(cell(at('A1')), (b) => b.disabled));

    // 退出（観戦の人）・ルームを閉じる
    await C.page.click('#btnLeave');
    await waitScreen(C, 'top');
    room = await roomWhen(code, (r) => !r.players?.['きいろ']);
    check('C left', !room.players['きいろ']);
    await H.page.click('#btnLeave');
    await waitScreen(H, 'top');
    check('room removed', (await roomWhen(code, (r) => r === null)) === null);
    for (const c of [A, B]) await waitScreen(c, 'top');
    await waitScreen(W, 'watch-end');
    check('watch end', (await text(W, '#watchEndTitle')).includes('閉じられ'));
    // 観戦画面はルームに書かない（players に入らない）
  } catch (e) {
    check('exception', false, String(e && e.stack || e));
  }
  await finishAll(server);
})();
