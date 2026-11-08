// ピッタリメーター E2E その1: 出口（2026-11-08 P5 監査の所見）
//  A. ゲストの待合室の「退出する」: 確認が出る・キャンセルで残る・押すと自分だけ外れる・読み込み直しても戻らない・同じ名前で入り直せる
//  B. ゲーム中のゲストの「退出する」（ヒント・回答・結果の画面）: 確認の文・自分だけ外れて進行が続く
//     答える人がいなくなったら、ホストに「ここで終わる」が出て終われる（2026-11-07 の形とつながる）
//  C. 出題者がヒントの途中で退出すると、ホストに「出題者を変える」が出て交代できる
//  D. ホストの待合室の「ルームを閉じる」: 確認が出る・キャンセルで残る・押すとルームが消える・ゲストは案内つきでトップへ
//     ホストのタブを閉じてもルームが作り直されない・読み込み直しても戻らない
//  E. ホスト切断の案内の「退出する」でも自分の players が消える
//  ふつうの流れ（作成・参加・開始・ヒント・回答・結果・次のラウンド・終わる）・375px・コンソール・本番への通信
const L = require('./lib.cjs');
const { check, sleep } = L;

async function createRoom(c, name, hostPlays = false) {
  await L.open(c);
  await c.page.click('button[onclick="goHostSetup()"]');
  await c.page.fill('#host-nickname', name);
  if (hostPlays) await c.page.check('#host-plays');
  await c.page.click('#btn-create-room');
  await L.waitVisible(c, '#host-step-room', 10000);
  return c.page.evaluate(() => state.roomCode);
}
async function joinRoom(c, name, code) {
  await L.open(c, '?room=' + code);
  await c.page.fill('#guest-nickname', name);
  await c.page.click('#btn-guest-join');
  await L.waitVisible(c, '#screen-waiting', 10000);
}
const screenOf = (c) => c.page.evaluate(() => state.currentScreen);
const waitScreen = (c, name, timeout = 10000) => c.page.waitForFunction((n) => state.currentScreen === n, name, { timeout });
const session = (c) => c.page.evaluate(() => sessionStorage.getItem('pittari_session'));
const lastDialog = (c) => (c.dialogs[c.dialogs.length - 1] || {}).message || '';
async function reloadedScreen(c) {
  await c.page.reload();
  await L.gate(c);
  await sleep(1500);
  return screenOf(c);
}

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── ルーム1: ホスト（進行だけ）＋ゲスト3人 ──
  const H = await L.newClient('host');
  const A = await L.newClient('a', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('b');
  const C = await L.newClient('c');
  const code = await createRoom(H, 'メンター');
  check('作成: ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code || ''), code);
  await joinRoom(A, 'あお', code);
  await joinRoom(B, 'べに', code);
  await joinRoom(C, 'しろ', code);
  await H.page.waitForFunction(() => document.getElementById('host-guest-count').textContent === '3');

  check('待合室: ホストに「ルームを閉じる」', await L.visible(H, '#btn-close-room'));
  check('待合室: ゲストに「退出する」', await L.visible(A, '#btn-waiting-leave'));
  check('待合室: 「ルームを閉じる」は控えめ（btn-ghost）', await H.page.evaluate(() => document.getElementById('btn-close-room').classList.contains('btn-ghost')));
  check('待合室: 「退出する」は控えめ（btn-ghost）', await A.page.evaluate(() => document.getElementById('btn-waiting-leave').classList.contains('btn-ghost')));
  check('待合室 375px: 横にはみ出さない', (await L.overflow(A)) <= 0);
  await L.shot(A, 'a-waiting-375');
  await L.shot(H, 'a-host-waiting');

  // A. 待合室の退出（B）
  B.dismissNext = true;
  await B.page.click('#btn-waiting-leave');
  await sleep(500);
  check('A1 退出の確認が出る', lastDialog(B) === 'ルームから退出しますか？', lastDialog(B));
  check('A2 キャンセルするとそのまま', (await screenOf(B)) === 'waiting' && !!(await L.roomOf(code)).players['べに']);
  await B.page.click('#btn-waiting-leave');
  await waitScreen(B, 'top');
  await sleep(500);
  let room = await L.roomOf(code);
  check('A3 押すと自分だけ外れる', !room.players['べに'] && !!room.players['あお'] && !!room.players['しろ'] && room.status === 'waiting', Object.keys(room.players));
  await H.page.waitForFunction(() => document.getElementById('host-guest-count').textContent === '2');
  check('A4 ホストの一覧から消える', !(await L.text(H, '#host-player-list')).includes('べに'));
  check('A5 ほかのゲストの一覧からも消える', await A.page.waitForFunction(() => !document.getElementById('waiting-player-list').textContent.includes('べに')).then(() => true, () => false));
  check('A6 記録が消える', (await session(B)) === null);
  check('A7 読み込み直しても待合室に戻らない', (await reloadedScreen(B)) === 'top');
  await joinRoom(B, 'べに', code);
  check('A8 同じ名前で入り直せる', !!(await L.roomOf(code)).players['べに']);

  // ふつうの流れ: 開始
  await H.page.waitForFunction(() => !document.getElementById('btn-start-game').disabled);
  await H.page.click('#btn-start-game');
  for (const c of [H, A, B, C]) await waitScreen(c, 'hinting');
  room = await L.roomOf(code);
  check('開始: ヒントの画面', room.status === 'hinting');
  const G = { 'あお': A, 'べに': B, 'しろ': C };
  const speaker1 = room.round.speaker;
  const others1 = Object.keys(G).filter((n) => n !== speaker1);
  check('ヒント: ゲストに「退出する」', await L.visible(G[others1[0]], '#btn-hinting-leave') && await L.visible(G[speaker1], '#btn-hinting-leave'));
  check('ヒント: ホストには「退出する」を出さない', !(await L.visible(H, '#btn-hinting-leave')));
  check('ヒント 375px: 横にはみ出さない', (await L.overflow(A)) <= 0);
  if (A !== G[speaker1]) await L.shot(A, 'b-hinting-375');

  // B. ヒントの途中で、出題者でないゲストが退出
  const leaver1 = others1[0];
  const L1 = G[leaver1];
  L1.dismissNext = true;
  await L1.page.click('#btn-hinting-leave');
  await sleep(400);
  check('B1 ゲーム中の確認の文', lastDialog(L1).startsWith('ゲームの途中です。退出しますか？'), lastDialog(L1));
  check('B2 キャンセルするとそのまま', (await screenOf(L1)) === 'hinting');
  await L1.page.click('#btn-hinting-leave');
  await waitScreen(L1, 'top');
  await sleep(500);
  room = await L.roomOf(code);
  check('B3 自分だけ外れる（ヒントの途中）', !room.players[leaver1] && room.status === 'hinting' && Object.keys(room.players).length === 3, Object.keys(room.players));
  check('B4 得点の記録は残る', room.scores && room.scores[leaver1] === 0, room.scores);
  check('B5 ホストに「出題者を変える」「ここで終わる」の案内は出ない（まだ遊べる）', !(await L.visible(H, '#hinting-host-actions')) && !(await L.visible(H, '#hinting-few')));
  check('B6 読み込み直しても戻らない（ヒントの途中）', (await reloadedScreen(L1)) === 'top');
  await L.open(L1, '?room=' + code);
  await L1.page.fill('#guest-nickname', leaver1);
  await L1.page.click('#btn-guest-join');
  await sleep(1200);
  check('B7 ゲームの途中は同じ名前で入り直せない（従来どおり）', (await screenOf(L1)) === 'guest-join' && !(await L.roomOf(code)).players[leaver1]);

  // 進行が続く: ヒント → 回答 → 結果
  const S1 = G[speaker1];
  const answerer1 = others1[1];
  await S1.page.fill('#hint-input', 'にくまん');
  await S1.page.click('button[onclick="speakerSubmitHint()"]');
  for (const c of [H, S1, G[answerer1]]) await waitScreen(c, 'guessing');
  check('B8 回答の画面の進み具合は残った人だけ', (await L.text(H, '#guessing-progress')).includes('0人 / 1人'), await L.text(H, '#guessing-progress'));
  check('回答: 答える人に「退出する」', await L.visible(G[answerer1], '#btn-guessing-leave'));
  check('回答: ホストには「退出する」を出さない', !(await L.visible(H, '#btn-guessing-leave')));
  await G[answerer1].page.click('button[onclick="guestDecide()"]');
  await H.page.waitForFunction(() => !document.getElementById('btn-reveal').disabled);
  await H.page.click('#btn-reveal');
  for (const c of [H, S1, G[answerer1]]) await waitScreen(c, 'reveal');
  check('結果: ゲストに「退出する」', await L.visible(G[answerer1], '#btn-reveal-leave'));
  check('結果: ホストには「退出する」を出さない', !(await L.visible(H, '#btn-reveal-leave')));
  check('結果: 「次のラウンドへ」は押せる（2人いる）', await H.page.evaluate(() => !document.getElementById('btn-next-round').disabled));
  if (A === G[answerer1] || A === S1) {
    check('結果 375px: 横にはみ出さない', (await L.overflow(A)) <= 0);
    await L.shot(A, 'b-reveal-375');
  }

  // 次のラウンド
  await H.page.click('#btn-next-round');
  for (const c of [H, S1, G[answerer1]]) await waitScreen(c, 'hinting');
  room = await L.roomOf(code);
  const speaker2 = room.round.speaker;
  const answerer2 = [speaker1, answerer1].find((n) => n !== speaker2);
  check('次のラウンド: 出題者は残った2人のどちらか', [speaker1, answerer1].includes(speaker2), speaker2);
  await G[speaker2].page.fill('#hint-input', 'ゆきだるま');
  await G[speaker2].page.click('button[onclick="speakerSubmitHint()"]');
  for (const c of [H, G[speaker2], G[answerer2]]) await waitScreen(c, 'guessing');

  // 回答の途中で、ただ1人の答える人が退出 → ホストに「ここで終わる」
  const L2 = G[answerer2];
  await L2.page.click('#btn-guessing-leave');
  await waitScreen(L2, 'top');
  check('B9 回答の途中の退出も確認の文', lastDialog(L2).startsWith('ゲームの途中です。退出しますか？'), lastDialog(L2));
  await L.waitVisible(H, '#guessing-few');
  check('B10 答える人がいなくなると、ホストに「ここで終わる」', await L.visible(H, '#btn-guessing-finish') && !(await L.visible(H, '#btn-reveal')));
  await G[speaker2].page.waitForFunction(() => document.getElementById('guessing-speaker-note').textContent.includes('ホストの操作を待っています'));
  check('B11 出題者は「ホストの操作を待っています」', true);
  check('B12 読み込み直しても戻らない（回答の途中）', (await reloadedScreen(L2)) === 'top');
  await H.page.click('#btn-guessing-finish');
  for (const c of [H, G[speaker2]]) await waitScreen(c, 'done');
  check('B13 「ここで終わる」で最終ランキングへ', (await L.roomOf(code)).status === 'done');
  check('終わる: ホストの確認の文', lastDialog(H).startsWith('ここで終わりにしますか？'), lastDialog(H));

  // ── ルーム2: 出題者がヒントの途中で退出（4人） ──
  const H2 = await L.newClient('host2');
  const D = [await L.newClient('d1'), await L.newClient('d2'), await L.newClient('d3')];
  const code2 = await createRoom(H2, 'ホスト');
  const names2 = ['いち', 'にい', 'さん'];
  for (let i = 0; i < 3; i++) await joinRoom(D[i], names2[i], code2);
  await H2.page.waitForFunction(() => !document.getElementById('btn-start-game').disabled);
  await H2.page.click('#btn-start-game');
  for (const c of [H2, ...D]) await waitScreen(c, 'hinting');
  room = await L.roomOf(code2);
  const sp = room.round.speaker;
  const SP = D[names2.indexOf(sp)];
  await SP.page.click('#btn-hinting-leave');
  await waitScreen(SP, 'top');
  await L.waitVisible(H2, '#hinting-host-actions');
  check('C1 出題者が退出すると、ホストに「出題者を変える」', true);
  await H2.page.click('button[onclick="hostChangeSpeaker()"]');
  await H2.page.waitForFunction((s) => state.room && state.room.round && state.room.round.speaker !== s, sp);
  room = await L.roomOf(code2);
  check('C2 残った人に出題者が交代する', room.status === 'hinting' && room.round.speaker !== sp && names2.includes(room.round.speaker) && !!room.players[room.round.speaker], room.round);
  check('C3 ラウンド番号はそのまま', room.round.number === 1);

  // E. ホスト切断の案内の「退出する」
  const stay = D.filter((c) => c !== SP);
  await L.rest('PATCH', L.ROOMS + '/' + code2, { hostConnected: false, hostDisconnectedAt: Date.now() });
  await L.waitVisible(stay[0], '#host-disconnect-overlay');
  const stayName = names2[D.indexOf(stay[0])];
  await stay[0].page.click('#host-disconnect-overlay button');
  await waitScreen(stay[0], 'top');
  await sleep(500);
  room = await L.roomOf(code2);
  check('E1 ホスト切断の案内から退出しても、自分の players が消える', !room.players[stayName], Object.keys(room.players));
  check('E2 記録が消える', (await session(stay[0])) === null);
  await L.rest('PATCH', L.ROOMS + '/' + code2, { hostConnected: true, hostDisconnectedAt: null });

  // ── ルーム3: ホストが待合室でルームを閉じる ──
  const H3 = await L.newClient('host3');
  const P = await L.newClient('p', { viewport: { width: 375, height: 812 } });
  const Q = await L.newClient('q');
  const code3 = await createRoom(H3, 'ホスト');
  await joinRoom(P, 'ぴい', code3);
  await joinRoom(Q, 'きゅう', code3);
  H3.dismissNext = true;
  await H3.page.click('#btn-close-room');
  await sleep(500);
  check('D1 閉じる確認が出る', lastDialog(H3) === 'ルームを閉じると、みんなの画面もトップに戻るよ。いい？', lastDialog(H3));
  check('D2 キャンセルするとそのまま', (await screenOf(H3)) === 'host-setup' && !!(await L.roomOf(code3)));
  await H3.page.click('#btn-close-room');
  await waitScreen(H3, 'top');
  for (const c of [P, Q]) await waitScreen(c, 'top');
  await sleep(500);
  check('D3 押すとルームが消える', (await L.roomOf(code3)) === null);
  check('D4 ゲストに「ホストがルームを閉じました」', lastDialog(P) === 'ホストがルームを閉じました' && lastDialog(Q) === 'ホストがルームを閉じました', [lastDialog(P), lastDialog(Q)]);
  check('D5 ホスト・ゲストの記録が消える', (await session(H3)) === null && (await session(P)) === null);
  check('D6 ホストは読み込み直しても待合室に戻らない', (await reloadedScreen(H3)) === 'top');
  check('D7 ゲストは読み込み直しても待合室に戻らない', (await reloadedScreen(P)) === 'top');
  check('D8 トップ 375px: 横にはみ出さない', (await L.overflow(P)) <= 0);
  for (const c of [H3, P, Q]) await c.context.close();
  await sleep(2500);
  check('D9 タブを閉じてもルームが作り直されない', (await L.roomOf(code3)) === null);

  // ホストが遊ぶルームでも、ホストの待合室に「ルームを閉じる」
  const H4 = await L.newClient('host4');
  await createRoom(H4, 'あそぶ', true);
  check('hostPlays のホストにも「ルームを閉じる」', await L.visible(H4, '#btn-close-room'));

  await L.finishAll(server);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
