// チェスの E2E その2: 対局中に入った人は観戦・古い操作は通らない・ホストの切断と戻り・席の人の切断とホストが代わりに指す・
// 席の名前は別の人に使えない・再読み込み（参加者・ホスト）・相手の番の投了・ルール（ルールを読み込ませて流す）
const L = require('./lib.cjs');
const { check, cell, sq, waitFor } = L;

(async () => {
  const server = await L.startServer();
  const rules = require('fs').readFileSync(require('path').join(process.env.CH_WORK, 'database.rules.json'), 'utf8');
  await fetch(L.DB + '/.settings/rules.json?ns=' + L.NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: rules });
  await L.launch();

  const H = await L.newClient('host');
  const code = await L.createRoom(H, 'メンター');
  const A = await L.newClient('aoi');
  await L.joinRoom(A, 'あおい', code);
  const B = await L.newClient('sora');
  await L.joinRoom(B, 'そら', code);
  await L.roomWhen(code, (r) => r.seats && r.seats.b === 'そら');
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  await L.move(A, sq('e2'), sq('e4'));
  await L.roomWhen(code, (r) => r.game.rev === 1);

  // 対局中に入った人
  const V = await L.newClient('hikari');
  await L.joinRoom(V, 'ひかり', code).catch(() => {});
  check('R1 対局中に入った人は観戦', await waitFor(async () => (await L.screen(V)) === 'game' && (await L.text(V, '#barMe')).includes('観戦中')), await L.text(V, '#barMe'));
  check('R2 観戦の人は押せない', await V.page.isDisabled(cell(sq('e7'))));
  check('R3 観戦の人には補助の説明もおすすめも出ない', !(await L.visible(V, '#pieceInfo')) && !(await L.visible(V, '#btnHint')));

  // 古い操作は通らない: 黒の画面で駒を選んだあと、ホストが1手もどす → 選んだ駒が消える
  await L.waitScreen(B, 'game');
  await B.page.click(cell(sq('e7')));
  await H.page.click('#btnUndo');
  await L.roomWhen(code, (r) => r.game.rev === 2);
  check('S1 1手もどすと黒の選択が消える', await waitFor(async () => (await B.page.$$('#board .ch-cell.is-sel')).length === 0 && (await L.status(B)).includes('考え中')));
  await L.move(A, sq('e2'), sq('e4'));
  await L.roomWhen(code, (r) => r.game.rev === 3);

  // ── ホストの切断 ──
  await H.page.evaluate(() => firebase.database().goOffline());
  H.offlineOk = true;
  check('T1 ホストが切れると参加者に「ホストの戻りを待っています」', await waitFor(async () => (await L.visible(A, '#hostOffOverlay')), 15000));
  const off = await A.page.evaluate(() => ({
    role: document.getElementById('hostOffOverlay').getAttribute('role'),
    focus: document.activeElement?.id,
    boardInert: !!document.getElementById('board').closest('[inert]'),
  }));
  check('T1b 待つ画面はダイアログで、うしろの盤は押せない', off.role === 'dialog' && off.focus === 'btnOverlayLeave' && off.boardInert, off);
  await H.page.evaluate(() => firebase.database().goOnline());
  check('T2 ホストが戻るとお知らせが消える', await waitFor(async () => !(await L.visible(A, '#hostOffOverlay')), 15000));
  let room = await L.roomWhen(code, (r) => r.hostConnected === true);
  check('T3 ホストの在室が戻る', room.hostConnected === true);

  // ── 席の人の切断（そらのブラウザを閉じる） → ホストが代わりに指す ──
  B.offlineOk = true;
  await B.context.close();
  check('D1 通信が切れたことがわかる', await waitFor(async () => (await L.text(H, '#sideTop')).includes('通信が切れた'), 90000));
  check('D2 ホストに「代わりに指してね」', (await L.status(H)).includes('黒（そら）の番。代わりに指してね'), await L.status(H));
  check('D3 白の人は押せない', await A.page.isDisabled(cell(sq('d2'))));
  await L.move(H, sq('c7'), sq('c5'));
  room = await L.roomWhen(code, (r) => r.game.rev === 4);
  check('D4 ホストが代わりに指せる', room.game.moves.length === 2);
  // 同じ名前の別人は入れない
  const X = await L.newClient('sora2');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'そら');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('D5 席の名前は別の人には使えない', true);
  await X.page.close();

  // あおいが読み込み直す → 白の席のまま続き
  await A.page.reload();
  check('D6 読み込み直すと続きから', await waitFor(async () => (await L.screen(A)) === 'game' && (await L.text(A, '#barMe')).includes('あなたは白')), await L.text(A, '#barMe'));
  check('D7 読み込み直しても自分の番', (await L.status(A)).startsWith('あなたの番（白）'), await L.status(A));
  await L.move(A, sq('g1'), sq('f3'));
  room = await L.roomWhen(code, (r) => r.game.rev === 5);
  check('D8 読み込み直したあとも指せる', room.game.moves.length === 3);

  // ホストの再読み込み
  await H.page.reload();
  check('D9 ホストも読み込み直すと続きから', await waitFor(async () => (await L.screen(H)) === 'game' && (await L.visible(H, '#btnUndo'))));
  room = await L.roomWhen(code, (r) => r.hostConnected === true);
  check('D10 ホストの在室が戻る', room.hostConnected === true && room.status === 'play');

  // 投了は相手の番でもできる（いまは黒の番。白のあおいが投了する）
  check('P1 相手の番でも「投了する」が出る', await L.visible(A, '#btnResign'));
  await A.page.click('#btnResign');
  room = await L.roomWhen(code, (r) => r.game.resign === 'w');
  check('P2 相手の番の投了が入る', room.game.resign === 'w');
  check('P3 観戦の人には投了のボタンがない', !(await L.visible(V, '#btnResign')));
  check('P4 観戦の人に結果', await waitFor(async () => (await L.status(V)).includes('白（あおい）が投了。黒（そら）の勝ち！')), await L.status(V));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
