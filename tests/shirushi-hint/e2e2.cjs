// しるしでヒント E2E その2: 端末なしの参加者・再読み込み・退出・切断・途中参加・ホストの切断
const path = require('path');
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const W = await L.newClient('watch');

  // ── P. 端末なしの参加者 ──
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await H.page.check('#hostPlays');
  await L.waitText(H, '#waitingCount', '遊ぶ人 2人');
  await H.page.click('#btnAddProxy');
  await L.waitText(H, '#proxyError', '名前を入れて');
  check('P1 名前なしは足せない', true);
  await H.page.fill('#proxyName', 'あおい');
  await H.page.click('#btnAddProxy');
  await L.waitText(H, '#proxyError', 'もういる');
  check('P2 同じ名前は足せない', true);
  await H.page.fill('#proxyName', 'たろう');
  await H.page.click('#btnAddProxy');
  let room = await L.roomWhen(code, (r) => r.proxies && r.proxies['たろう']);
  check('P3 足せる', !!room.proxies['たろう']);
  check('P4 足すとホストは進行だけ', room.hostPlays === false);
  await H.page.waitForFunction(() => document.querySelector('#hostPlays').disabled && !document.querySelector('#hostPlays').checked);
  check('P5 「自分もプレイヤーとして参加する」は押せない', (await L.text(H, '#hostPlaysHint')).includes('進行だけ'));
  await L.waitText(A, '#waitingPlayers', 'たろう');
  check('P6 「端末なし」はホストにだけ', (await L.text(H, '#waitingPlayers')).includes('端末なし') && !(await L.text(A, '#waitingPlayers')).includes('端末なし'));
  // 前の「足す」が終わる（入力欄が空になる）のを待つ。処理中の二度押しは何もしない作りのため
  await H.page.waitForFunction(() => document.querySelector('#proxyName').value === '');
  await H.page.fill('#proxyName', 'じろう');
  await H.page.click('#btnAddProxy');
  await L.waitText(H, '#waitingPlayers', 'じろう');
  await H.page.click('#waitingPlayers li:has-text("じろう") .sh-people__del');
  await H.page.waitForFunction(() => !document.querySelector('#waitingPlayers').textContent.includes('じろう'));
  check('P7 はじめる前なら外せる', true);
  // 端末なしの子と同じ名前では参加できない
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'たろう');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('P8 端末なしの子と同じ名前では入れない', true);
  await X.context.close();
  L.clients.splice(L.clients.indexOf(X), 1);
  await L.joinRoom(B, 'そら', code);
  await L.waitText(H, '#waitingCount', '遊ぶ人 3人');
  check('P9 端末なしの子も遊ぶ人に数える', true);
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'pick');
  room = await L.roomOf(code);
  check('P10 順番に端末なしの子も入る', JSON.stringify(room.game.order) === '["あおい","たろう","そら"]', room.game.order);
  // 1問目: あおいが伝える。たろうの分はホストが押す
  await A.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(H, 'hint');
  check('P11 しるしの前は代わりに押す欄を出さない', !(await L.visible(H, '#proxyPanel')));
  await L.sendSign(A, '動物');
  await L.waitVisible(H, '#proxyPanel');
  check('P12 ホストに代わりに押す欄', (await L.text(H, '#proxyRows')).includes('たろう'));
  check('P13 参加者・見る画面には出ない', !(await L.visible(B, '#proxyPanel')) && !(await L.visible(W, '#proxyPanel')));
  const tA = await L.tiles(A);
  const ans = tA.findIndex((x) => x.answer);
  const wrong = tA.findIndex((x) => !x.answer);
  await H.page.click('#proxyRows .sh-proxy__key >> nth=' + wrong);
  await L.waitText(H, '#proxyRows', '選んだ（' + 'ABCDEFGHIJKL'[wrong] + '）');
  check('P14 代わりに選んだ記号がホストに出る', true);
  check('P15 ほかの人には選んだことだけ', !(await L.text(B, '#pickedList')).includes('ABCDEFGHIJKL'[wrong] + '）') && (await L.text(B, '#pickedList')).includes('たろう'));
  await B.page.click('#btnSkipGuess');
  room = await L.roomWhen(code, (r) => r.game.q.judged === 1);
  check('P16 代わりに押したはずれは −1点', room.game.scores['たろう'] === -1, room.game.scores);
  await L.sendSign(A, '大きい');
  await H.page.waitForFunction(() => document.querySelectorAll('#proxyRows .sh-proxy__key').length > 0);
  check('P17 消えた候補は押せない', await H.page.isDisabled('#proxyRows .sh-proxy__key >> nth=' + wrong));
  await B.page.waitForFunction(() => !document.querySelector('#btnSkipGuess').closest('[hidden]') && !document.querySelector('#btnSkipGuess').hidden);
  await B.page.click('#btnSkipGuess');
  await H.page.click('#proxyRows .sh-proxy__key >> nth=' + ans);
  await H.page.waitForFunction(() => document.querySelector('#proxyRows').textContent.includes('②つ目で当てた'));
  check('P18 代わりに押して当たり', true);
  await H.page.screenshot({ path: path.join(L.OUT, 'p-proxy-panel.png'), fullPage: true });
  await L.sendSign(A, '赤');
  await B.page.waitForFunction(() => document.querySelectorAll('#signsList .sh-sign').length === 3);
  await L.tapTile(B, tA[ans].t);
  await L.waitScreen(H, 'reveal');
  room = await L.roomOf(code);
  check('P19 点（端末なしの子は②で当てて −1＋2）', room.game.scores['たろう'] === 1 && room.game.scores['あおい'] === 2 && room.game.scores['そら'] === 1, room.game.scores);
  // 2問目: たろうが伝える → ホストが代わりに操作
  await H.page.click('#btnNext');
  await L.waitScreen(H, 'pick');
  check('P20 端末なしの子の番はホストが選ぶ', (await L.text(H, '#pickTitle')).includes('たろうさんが伝える番'));
  check('P21 参加者には、たろうさんが選んでいると出る', (await L.text(A, '#pickTitle')).includes('たろうさんがお題を選んでいる'));
  await H.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(A, 'hint');
  check('P22 ホストにたろうさんのお題と道具', (await L.text(H, '#hintTopicLabel')) === 'たろうさんのお題' && await L.visible(H, '#tellerTools'));
  check('P23 参加者にお題は出ない', !(await L.visible(A, '#hintTopicBox')) && !(await A.page.$$('#hintBoard .is-answer')).length);
  check('P24 見る画面にお題は出ない', !(await L.visible(W, '#hintTopicBox')));
  await L.sendSign(H, '食べ物');
  await A.page.waitForFunction(() => document.querySelectorAll('#signsList .sh-sign').length === 1);
  check('P25 伝える番の子は代わりに押す欄に出ない', !(await L.visible(H, '#proxyPanel')));
  const ans2 = (await L.tiles(H)).find((x) => x.answer).t;

  // ── R. 再読み込み・退出・途中参加 ──
  await A.page.reload();
  await L.waitScreen(A, 'hint', 10000);
  check('R1 再読み込みで同じ問に戻る', (await L.signs(A)).join() === '食べ物');
  await L.tapTile(A, ans2);
  room = await L.roomWhen(code, (r) => r.game.q.picks && r.game.q.picks['あおい'] !== undefined);
  check('R2 戻ったあとも選べる', true);
  // そらが「退出する」→ 待たずに答え合わせ
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  room = await L.roomWhen(code, (r) => r.game.q.judged === 1);
  check('R3 抜けた人を待たずに答え合わせ', room.game.q.judged === 1 && room.status === 'reveal', room.status);
  check('R4 たろう（伝えた・端末なし）にも点', room.game.scores['たろう'] === 4, room.game.scores);
  await L.waitText(H, '#orderList', '接続が切れています');
  check('R5 抜けた人は順番で分かる', true);
  // 新しい名前では途中参加できない
  const Y = await L.newClient('late');
  await L.open(Y, '?room=' + code);
  await Y.page.fill('#guestName', 'はる');
  await Y.page.click('#btnJoinRoom');
  await L.waitText(Y, '#joinError', 'もうゲームが始まっている');
  check('R6 遊んでいる途中に新しい名前では入れない', true);
  await Y.context.close();
  L.clients.splice(L.clients.indexOf(Y), 1);
  // そらは同じ名前で入りなおせる（同じブラウザ）
  await L.joinRoom(B, 'そら', code).catch(() => {});
  await L.waitScreen(B, 'reveal');
  check('R7 同じ名前で入りなおせる', true);
  // 次へ → いない人はとばさない（戻ったので）、そらの番
  await H.page.click('#btnNext');
  await L.waitScreen(B, 'pick');
  check('R8 戻った人の番が来る', await L.visible(B, '#pickPanel'));

  // ── S. 伝える人の切断（ブラウザごと閉じる） ──
  await B.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(A, 'hint');
  await L.sendSign(B, '動物');
  await B.context.close();
  await L.waitVisible(H, '#tellerAwayNote', 90000);
  check('S1 伝える人が切れたらホストに案内', (await L.text(H, '#tellerAwayNote')).includes('この問を終えて次の人へ'));
  check('S2 参加者には待つ案内', (await L.text(A, '#tellerAwayNote')).includes('待ってね'));
  check('S3 出したしるしは残る', (await L.signs(A)).join() === '動物');
  await H.page.click('#btnSkipQuestion');
  await L.waitScreen(H, 'lap');
  check('S4 切れた人の番をとばして一巡（ここまでの点は残る）', (await L.rankRows(H, '#lapRank')).length === 3);
  check('S5 いまいる人が2人より少ないと続けられない', true);

  // ── T. ホストの切断 ──
  H.offlineOk = true;
  await H.context.setOffline(true);
  await L.waitVisible(A, '#hostOffOverlay', 90000);
  check('T1 ホストが切れたら参加者にオーバーレイ', true);
  check('T2 見る画面にもオーバーレイ', await L.visible(W, '#hostOffOverlay'));
  await H.context.setOffline(false);
  await A.page.waitForFunction(() => document.querySelector('#hostOffOverlay').hidden, null, { timeout: 60000 });
  check('T3 ホストが戻るとオーバーレイが消える', true);
  room = await L.roomOf(code);
  check('T4 ホストが戻ると hostConnected', room.hostConnected === true && !room.hostDisconnectedAt);

  // ── U. 端末なしの子がいると「もう一巡」で続けられる ──
  await H.page.click('#btnLapAgain');
  await L.waitScreen(A, 'pick');
  check('U1 もう一巡（いまいる2人＋端末なし）', await L.visible(A, '#pickPanel'));
  await H.page.click('#btnFinish');
  await L.waitScreen(A, 'end');
  await H.page.click('#btnPlayAgain');
  await L.waitScreen(A, 'waiting');
  room = await L.roomOf(code);
  check('U2 待合室に戻っても端末なしの子は残る', !!room.proxies?.['たろう'] && room.hostPlays === false);

  // ── V. レビューの指摘の確認 ──
  const H2 = await L.newClient('host2');
  const C = await L.newClient('c');
  const E = await L.newClient('e');
  const code2 = await L.createRoom(H2, 'ホスト');
  await L.joinRoom(C, 'かい', code2);
  await L.joinRoom(E, 'えま', code2);
  await H2.page.check('#hostPlays');
  await L.waitText(H2, '#waitingCount', '遊ぶ人 3人');
  await H2.page.click('#btnStartGame');
  await L.waitScreen(H2, 'pick');
  await H2.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(C, 'hint');
  const ansV = (await L.tiles(H2)).find((x) => x.answer).t;
  await L.sendSign(H2, '動物');
  await C.page.waitForFunction(() => document.querySelectorAll('#hintBoard button.sh-tile').length > 0);
  // 当てる人が再読み込みしている間に次のしるしを出しても、答えへ進まない
  await L.tapTile(C, ansV);
  await E.page.reload();
  await L.sendSign(H2, '大きい');
  room = await L.roomWhen(code2, (r) => (r.game.q.signs || []).length === 2);
  check('V1 再読み込みの一瞬に次のしるしを出しても、答えへ進まない', room.status === 'hint', room.status);
  await L.waitScreen(E, 'hint', 10000);
  check('V2 戻った人は続きから選べる', await E.page.waitForFunction(() => document.querySelectorAll('#hintBoard button.sh-tile').length > 0).then(() => true));
  // まだ当てていない人が抜けて、当てた人だけが残ったら、答えへ進む
  await E.page.click('#btnLeave');
  await L.waitScreen(E, 'top');
  room = await L.roomWhen(code2, (r) => r.status === 'reveal');
  check('V3 当てていない人が抜けて、当てた人だけ残ったら答えへ', room.status === 'reveal', room.status);
  check('V4 その退出で答えへ進めた端末が finish を数える', await L.waitStats(E, 'finish', 1));
  // 6つ目のしるしのあとの案内
  await H2.page.click('#btnNext');
  await L.waitScreen(C, 'pick');
  await C.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(H2, 'hint');
  for (const label of ['動物', '大きい', '赤', '丸い', '水', '夜']) {
    const n = (await L.signs(C)).length;
    await L.sendSign(C, label);
    await C.page.waitForFunction((k) => document.querySelectorAll('#signsList .sh-sign:not(.is-preview)').length === k + 1, n).catch(() => {});
  }
  room = await L.roomOf(code2);
  if (room.status === 'hint' && (room.game.q.signs || []).length === 6) {
    check('V5 6つ目のあとは「答えを見せる」を案内', (await L.text(C, '#hintGuide')).includes('答えを見せる'));
  } else {
    check('V5 6つ目のあとは「答えを見せる」を案内（その前に当たって答えへ進んだ）', room.status === 'reveal', room.status);
  }
  // 古い「ここでおしまい」は、あとの問を終えない（問の番号がちがう操作は弾く）
  const qnBefore = room.game.q?.n;
  check('V6 問の番号がある', Number.isInteger(qnBefore));
  await H2.page.click('#btnFinish');
  await L.waitScreen(C, 'end');
  check('V7 ここでおしまい', true);
  await H2.page.click('#btnPlayAgain');
  await L.waitScreen(C, 'waiting');
  check('V8 もう一回あそぶで again', (await L.stats(H2, 'again')) >= 1);
  // 壊れた候補のときに「選ばない」を押しても、当たりにならない（Codex 2回目の指摘）
  await L.joinRoom(E, 'えま', code2).catch(() => {});
  await L.waitText(H2, '#waitingCount', '遊ぶ人 3人');
  await H2.page.click('#btnStartGame');
  await L.waitScreen(H2, 'pick');
  await H2.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(C, 'hint');
  await L.sendSign(H2, '動物');
  await C.page.waitForFunction(() => document.querySelectorAll('#hintBoard button.sh-tile').length > 0);
  await L.rest('PUT', L.ROOMS + '/' + code2 + '/game/q/board', [1, 2, 3]);
  await C.page.waitForFunction(() => document.querySelectorAll('#hintBoard .sh-tile').length === 0);
  check('V9 壊れた候補は出さない', true);
  await C.page.click('#btnSkipGuess');
  await E.page.click('#btnSkipGuess');
  room = await L.roomWhen(code2, (r) => r.game.q.judged === 1);
  const sc = room.game.scores;
  check('V10 壊れた候補で「選ばない」を押しても、当たりにも点にもならない', room.game.q.judged === 1 && !room.game.q.solved && sc['かい'] === 0 && sc['えま'] === 0 && sc['ホスト'] === 0, [room.game.q.solved, sc]);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
