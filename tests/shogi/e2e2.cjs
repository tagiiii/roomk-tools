// 将棋の E2E その2: 対局中に入った人は観戦・ホストの切断と戻り・席の人の切断とホストが代わりに指す・
// 席の名前は別の人に使えない・再読み込み（参加者・ホスト）・古い操作は通らない・入玉宣言
const L = require('./lib.cjs');
const { E, check, sleep, cell, waitFor } = L;
const pack = (m) => (m.from < 0 ? { f: -1, t: m.to, d: m.drop, p: false } : { f: m.from, t: m.to, p: !!m.promote });

(async () => {
  const server = await L.startServer();
  const rules = require('fs').readFileSync(require('path').join(process.env.SH_WORK, 'database.rules.json'), 'utf8');
  await fetch(L.DB + '/.settings/rules.json?ns=' + L.NS, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: rules });
  await L.launch();

  const H = await L.newClient('host');
  const code = await L.createRoom(H, 'メンター');
  const A = await L.newClient('aoi');
  await L.joinRoom(A, 'あおい', code);
  const B = await L.newClient('sora');
  await L.joinRoom(B, 'そら', code);
  await L.roomWhen(code, (r) => r.seats && r.seats.g === 'そら');
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  await L.move(A, 15, 10);
  await L.roomWhen(code, (r) => r.game.rev === 1);

  // 対局中に入った人
  const V = await L.newClient('hikari');
  await L.joinRoom(V, 'ひかり', code).catch(() => {});
  check('R1 対局中に入った人は観戦', await waitFor(async () => (await L.screen(V)) === 'game' && (await L.text(V, '#barMe')).includes('観戦中')), await L.text(V, '#barMe'));
  check('R2 観戦の人は押せない', await V.page.isDisabled(cell(4)));

  // 古い操作は通らない: 後手の画面で駒を選んだあと、ホストが1手もどす → 選んだ手は指せない
  await B.page.click(cell(1));
  await H.page.click('#btnUndo');
  await L.roomWhen(code, (r) => r.game.rev === 2);
  check('S1 1手もどすと後手の選択が消える', await waitFor(async () => (await B.page.$$('#board .sh-cell.is-sel')).length === 0 && (await L.status(B)).includes('考え中')));
  await L.move(A, 15, 10);
  await L.roomWhen(code, (r) => r.game.rev === 3);

  // ── ホストの切断 ──
  await H.page.evaluate(() => firebase.database().goOffline());
  H.offlineOk = true;
  check('T1 ホストが切れると参加者に「ホストの戻りを待っています」', await waitFor(async () => (await L.visible(A, '#hostOffOverlay')), 15000));
  await H.page.evaluate(() => firebase.database().goOnline());
  check('T2 ホストが戻るとお知らせが消える', await waitFor(async () => !(await L.visible(A, '#hostOffOverlay')), 15000));
  let room = await L.roomWhen(code, (r) => r.hostConnected === true);
  check('T3 ホストの在室が戻る', room.hostConnected === true);

  // ── 席の人の切断（そらのブラウザを閉じる） → ホストが代わりに指す ──
  B.offlineOk = true;
  await B.context.close();
  check('D1 通信が切れたことがわかる', await waitFor(async () => (await L.text(H, '#sideTop')).includes('通信が切れた'), 90000));
  check('D2 ホストに「代わりに指してね」', (await L.status(H)).includes('△後手（そら）の番。代わりに指してね'), await L.status(H));
  check('D3 先手の人は押せない', await A.page.isDisabled(cell(4)));
  await L.move(H, 1, 19);
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

  // あおいが読み込み直す → 先手の席のまま続き
  await A.page.reload();
  check('D6 読み込み直すと続きから', await waitFor(async () => (await L.screen(A)) === 'game' && (await L.text(A, '#barMe')).includes('あなたは先手')), await L.text(A, '#barMe'));
  check('D7 読み込み直しても自分の番', (await L.status(A)).startsWith('あなたの番（▲先手）'), await L.status(A));
  await L.move(A, 20, 16);   // 玉 ５五 → ５四
  room = await L.roomWhen(code, (r) => r.game.rev === 5);
  check('D8 読み込み直したあとも指せる', room.game.moves.length === 3);

  // ホストの再読み込み
  await H.page.reload();
  check('D9 ホストも読み込み直すと続きから', await waitFor(async () => (await L.screen(H)) === 'game' && (await L.visible(H, '#btnUndo'))));
  room = await L.roomWhen(code, (r) => r.hostConnected === true);
  check('D10 ホストの在室が戻る', room.hostConnected === true && room.status === 'play');

  // 投了は相手の番でもできる（いまは後手の番。先手のあおいが投了する）
  check('P1 相手の番でも「投了する」が出る', await L.visible(A, '#btnResign'));
  await A.page.click('#btnResign');
  room = await L.roomWhen(code, (r) => r.game.resign === 's');
  check('P2 相手の番の投了が入る', room.game.resign === 's');
  check('P3 観戦の人には投了のボタンがない', !(await L.visible(V, '#btnResign')));
  await H.page.click('#btnUndo');
  await L.roomWhen(code, (r) => r.game.resign == null);

  // ── 入玉宣言（本将棋）: 待合室にもどして本将棋で始め、宣言できる局面の記録を入れる ──
  await H.page.click('#btnReset');
  await L.waitScreen(A, 'waiting');
  await H.page.selectOption('#seat1', 'ひかり');
  await H.page.click('#lobbyVariant input[value="hon"]');
  await L.roomWhen(code, (r) => r.v === 'hon' && r.seats.g === 'ひかり');
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  check('K1 はじめの局面では入玉宣言のボタンは出ない', !(await L.visible(A, '#declareBox')));
  await L.shot(A, 'e2e2-hon-start');
  // 宣言の条件（27点法）はルールのテストで確かめた。ここでは、条件がそろったときの画面と記録の流れを見る
  // （全員の画面で、条件の判定を「そろっている」に差しかえる。宣言の記録は条件がそろうときだけ有効に読むため）
  for (const c of [A, H, V]) await c.page.evaluate(() => { window.ShogiEngine.canDeclare = () => true; });
  await H.page.click('#btnAid');
  await H.page.click('#dialogAid input[data-key="danger"]');
  await H.page.click('#btnAidClose');
  check('K2 条件がそろうと「入玉宣言で勝ちにする」が出る（自分の番の人だけ）', await waitFor(async () => (await L.visible(A, '#declareBox')) && !(await L.visible(V, '#declareBox'))));
  await A.page.click('#btnDeclare');
  room = await L.roomWhen(code, (r) => r.game.declare === 's');
  check('K3 宣言がルームに入る', room.game.declare === 's' && room.game.ended === true);
  check('K4 結果「入玉宣言。先手の勝ち」', await waitFor(async () => (await L.status(V)).startsWith('入玉宣言。▲先手（あおい）の勝ち！')), await L.status(V));


  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
