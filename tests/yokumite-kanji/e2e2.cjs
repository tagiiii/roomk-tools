// E2E その2: 再読み込み・通信の切断と復帰・メンターの切断・期限切れ・残りかすの片付け
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, seatOf, liveOf, emptySeats, roomWhen, open, title, waitTitle, text, waitText, toastText, waitToast, session, pidOf, barText, waitBar, watchText, waitWatch, waitSame, dragLoose, pickUnit, pickWord } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  await rest('DELETE', L.ROOMS);

  const H = await L.newClient('host');
  const code = await L.createWatch(H);
  const P = await L.newClient('player');
  await L.showVia(P, code);
  await pickUnit(P, '古代までの日本');
  await pickWord(P, 3);
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '？来人');
  await dragLoose(P, 0);
  check('setup: synced', await waitSame(P, H));
  const pid = await pidOf(P);

  // ── 見せる側の再読み込み → 見せている状態にもどる（画面はトップから）
  await P.page.reload();
  await waitBar(P, 'メンターに見せています', 15000);
  check('player reload: top screen', (await title(P)) === '単元を選ぶ');
  let room = await roomWhen(code, (r) => seatOf(r) && liveOf(r) && liveOf(r).view && liveOf(r).view.name === 'top', 10000);
  check('player reload: same seat', seatOf(room) === pid && (await pidOf(P)) === pid, room.meta);
  await waitWatch(H, '単元を選んでいます', 10000);
  check('player reload: session kept', (await session(P)).role === 'player');

  // ── 見る側の再読み込み → 見る画面にもどり、今の盤面が出る
  await pickUnit(P, '身のまわりの物質');
  await pickWord(P, 4);
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '？和水溶液');
  await dragLoose(P, 0);
  await H.page.reload();
  await waitTitle(H, '見る画面', 15000);
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '？和水溶液', 10000);
  check('host reload: same code', (await text(H, '.yk-watch-bar__code strong')) === code);
  check('host reload: board restored', await waitSame(P, H));
  room = await roomWhen(code, (r) => r.meta.hostConnected === true, 10000);
  check('host reload: connected again', room.meta.hostConnected === true && room.meta.hostDisconnectedAt == null, room.meta);
  await waitBar(P, 'メンターに見せています', 10000);

  // ── 見る側の通信が切れて、もどる（期限の前）
  H.offlineOk = true;
  await H.context.setOffline(true);
  room = await roomWhen(code, (r) => r.meta.hostConnected === false, 90000);
  check('host offline: marked disconnected', room.meta.hostConnected === false);
  await waitBar(P, 'メンターの画面がひらくのを待っています', 10000);
  await H.page.click('#btnCloseWatch');
  await waitToast(H, '接続が切れています');
  check('host offline: cannot close while offline', (await title(H)) === '見る画面' && (await roomOf(code)) !== null);
  // 切れている間も、子どもは遊べる
  await dragLoose(P, 0);
  await H.context.setOffline(false);
  room = await roomWhen(code, (r) => r.meta.hostConnected === true, 30000);
  check('host back: connected again', room.meta.hostConnected === true);
  await waitBar(P, 'メンターに見せています', 10000);
  check('host back: board is current', await waitSame(P, H, 10000));

  // ── 見せる側の通信が切れて、もどる → 席を取り直し、今の画面を送り直す
  P.offlineOk = true;
  await P.context.setOffline(true);
  room = await roomWhen(code, (r) => emptySeats(r), 90000);
  check('player offline: seat and live removed by the server', emptySeats(room), room);
  await waitWatch(H, '相手の画面がとじました', 10000);
  // 切れている間に、別の語へ進む
  await P.page.click('.yk-back-link');
  await pickWord(P, 6);
  await waitTitle(P, '蒸？');
  await dragLoose(P, 0);
  await P.context.setOffline(false);
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '蒸？', 30000);
  room = await roomOf(code);
  check('player back: same seat again', seatOf(room) === pid, room.meta);
  check('player back: board is current', await waitSame(P, H, 10000));
  check('player back: bar', (await barText(P)).includes('メンターに見せています'));

  // ── メンターが「とじる」を押さずに閉じる → 切断中 → 期限切れで、子どもの端末が消す
  await H.page.close({ runBeforeUnload: false });
  room = await roomWhen(code, (r) => r.meta.hostConnected === false, 30000);
  check('host closed: marked disconnected', room.meta.hostConnected === false && typeof room.meta.hostDisconnectedAt === 'number', room.meta);
  await waitBar(P, 'メンターの画面がひらくのを待っています', 10000);
  check('host closed: player still has the seat', seatOf(room) === pid);
  // 期限（2分）を過ぎたことにする
  await rest('PUT', `${L.ROOMS}/${code}/meta/hostDisconnectedAt`, Date.now() - 3 * 60 * 1000);
  await waitToast(P, 'メンターの画面がもどらなかった', 15000);
  check('expired: bar hidden', (await barText(P)) === null);
  room = await roomWhen(code, (r) => r === null, 10000);
  check('expired: room removed by the player', room === null, room);
  check('expired: player keeps playing', (await title(P)) === '蒸？');
  await dragLoose(P, 0);
  await sleep(1500);
  check('expired: nothing written afterwards', (await roomOf(code)) === null);
  check('expired: session cleared', (await session(P)) === null);

  // ── 期限切れのルームのリンク・かけらだけが残ったルームのリンク → 入れず、残りを消す
  await rest('PUT', `${L.ROOMS}/EXPRDA`, { meta: { status: 'open', createdAt: 1, hostUid: 'x', hostToken: 't', hostConnected: false, hostDisconnectedAt: Date.now() - 5 * 60 * 1000 }, live: { view: { name: 'top' } } });
  await rest('PUT', `${L.ROOMS}/GHQSTA`, { meta: { hostConnected: false, hostDisconnectedAt: Date.now() } });
  await rest('PUT', `${L.ROOMS}/LEFTAA`, { live: { view: { name: 'top' } } });
  for (const dead of ['EXPRDA', 'GHQSTA', 'LEFTAA']) {
    await L.openInvite(P, dead);
    await P.page.click('#btnShow');
    await waitTitle(P, 'このリンクのルームは、もうとじています');
    const left = await roomWhen(dead, (r) => r === null, 8000);
    check('dead link ' + dead + ': leftovers removed', left === null, left);
  }

  // ── 見る画面をひらいたまま、ルームが消えた → トップへもどる
  const H2 = await L.newClient('host2');
  const code2 = await L.createWatch(H2);
  await roomWhen(code2, (r) => r.meta.hostConnected === true);
  await rest('DELETE', `${L.ROOMS}/${code2}`);
  await waitToast(H2, 'ルームがとじました', 10000);
  check('room vanished: host goes back to top', (await title(H2)) === '単元を選ぶ' && (await session(H2)) === null);
  await sleep(1500);
  check('room vanished: not recreated', (await roomOf(code2)) === null);
  // 閉じても、切断時の予約でかけらができない
  await H2.page.close();
  await sleep(2500);
  check('room vanished: no ghost after closing the page', (await roomOf(code2)) === null);

  // ── 記録が残っているのに、ルームがもうない → 再読み込みでトップへ
  const H3 = await L.newClient('host3');
  const code3 = await L.createWatch(H3);
  const P3 = await L.newClient('player3');
  await L.showVia(P3, code3);
  // ページをはなれている間にルームが消えた形を作る（同じタブなので、もどると記録は残っている）
  await H3.page.goto('about:blank');
  await P3.page.goto('about:blank');
  await roomWhen(code3, (r) => r.meta.hostConnected === false && emptySeats(r), 30000);
  await rest('DELETE', `${L.ROOMS}/${code3}`);
  await H3.page.goto(L.BASE);
  await waitToast(H3, '前のルームは、もうとじていました', 20000);
  check('stale session (host): top', (await title(H3)) === '単元を選ぶ' && (await session(H3)) === null);
  await P3.page.goto(L.BASE);
  await waitToast(P3, '前のルームは、もうとじていました', 20000);
  check('stale session (player): top, no bar', (await title(P3)) === '単元を選ぶ' && (await barText(P3)) === null && (await session(P3)) === null);
  await sleep(1500);
  check('stale session: room not recreated', (await roomOf(code3)) === null);

  check('nothing left in the database', (await rest('GET', L.ROOMS)) === null, await rest('GET', L.ROOMS));
  await L.finishAll(server);
})().catch((error) => { console.error(error); process.exit(2); });
