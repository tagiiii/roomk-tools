// ネームチェンジ E2E その1: GM の待合室の「ルームを閉じる」（2026-11-08 P5 監査の所見）
//  A. 確認が出る・キャンセルで残る・押すとルームが消える・ゲストは「GMがルームを閉じました」でトップへ
//     GM のタブを閉じてもルームが作り直されない・GM もゲストも読み込み直して待合室に戻らない
//  B. ゲストの「退出する」（11-07 に足したもの）は従来どおり自分だけ外れる
//  C. ふつうの流れ（作成・参加・開始・名前変え・投票・結果発表・ゲーム終了）は変わらない。終わったあとの削除では案内を出さない
//  375px・コンソール・本番への通信
const L = require('./lib.cjs');
const { check, sleep } = L;

async function createRoom(c, name) {
  await L.open(c);
  await c.page.click('button[onclick="goHostSetup()"]');
  await c.page.fill('#host-nickname', name);
  await c.page.click('#host-create-btn');
  await L.waitVisible(c, '#waiting-host-ctrl', 10000);
  return c.page.evaluate(() => state.roomCode);
}
async function joinRoom(c, name, code) {
  await L.open(c, '?room=' + code);
  await c.page.fill('#guest-nickname', name);
  await c.page.click('#guest-join-btn');
  await L.waitVisible(c, '#waiting-guest-msg', 10000);
}
const screenOf = (c) => c.page.evaluate(() => state.currentScreen);
const waitScreen = (c, name, timeout = 10000) => c.page.waitForFunction((n) => state.currentScreen === n, name, { timeout });
const session = (c) => c.page.evaluate(() => sessionStorage.getItem('nc_session'));
const lastDialog = (c) => (c.dialogs[c.dialogs.length - 1] || {}).message || '';
async function reloadedScreen(c) {
  await c.page.reload();
  await L.gate(c);
  await sleep(1500);
  return screenOf(c);
}
const clickVisible = (c, sel) => c.page.locator(sel + ':visible').first().click();

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── ルーム1: GM が待合室でルームを閉じる ──
  const H = await L.newClient('gm');
  const A = await L.newClient('a', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('b');
  const code = await createRoom(H, 'ジーエム');
  check('作成: ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code || ''), code);
  await joinRoom(A, 'あおい', code);
  await joinRoom(B, 'べにお', code);
  check('待合室: GM に「ルームを閉じる」', await L.visible(H, '#waiting-close-btn'));
  check('待合室: 「ルームを閉じる」は控えめ（btn-ghost）', await H.page.evaluate(() => document.getElementById('waiting-close-btn').classList.contains('btn-ghost')));
  check('待合室: ゲストには「ルームを閉じる」を出さない', !(await L.visible(A, '#waiting-close-btn')));
  check('待合室: ゲストに「退出する」', await L.visible(A, '#waiting-leave-btn'));
  await L.shot(H, 'a-gm-waiting');

  // B. ゲストの退出（従来どおり）
  await B.page.click('#waiting-leave-btn');
  await waitScreen(B, 'top');
  await sleep(500);
  let room = await L.roomOf(code);
  check('B1 ゲストの退出は自分だけ外れる', !!room && !room.players['べにお'] && !!room.players['あおい'], room && Object.keys(room.players));
  check('B2 ゲストの退出では案内を出さない', B.dialogs.length === 0 && !(await B.page.evaluate(() => document.getElementById('toast').classList.contains('show'))));

  // A. GM がルームを閉じる
  H.dismissNext = true;
  await H.page.click('#waiting-close-btn');
  await sleep(500);
  check('A1 閉じる確認が出る', lastDialog(H) === 'ルームを閉じると、みんなの画面もトップに戻るよ。いい？', lastDialog(H));
  check('A2 キャンセルするとそのまま', (await screenOf(H)) === 'waiting' && !!(await L.roomOf(code)));
  await H.page.click('#waiting-close-btn');
  await waitScreen(H, 'top');
  await waitScreen(A, 'top');
  await sleep(500);
  check('A3 押すとルームが消える', (await L.roomOf(code)) === null);
  check('A4 ゲストに「GMがルームを閉じました」', (await L.text(A, '#toast')) === 'GMがルームを閉じました', await L.text(A, '#toast'));
  check('A5 GM には案内を出さない', !(await H.page.evaluate(() => document.getElementById('toast').classList.contains('show'))));
  check('A6 GM・ゲストの記録が消える', (await session(H)) === null && (await session(A)) === null);
  check('A7 トップ 375px: 横にはみ出さない', (await L.overflow(A)) <= 0);
  await L.shot(A, 'a-guest-closed-375');
  check('A8 GM は読み込み直しても待合室に戻らない', (await reloadedScreen(H)) === 'top');
  check('A9 ゲストは読み込み直しても待合室に戻らない', (await reloadedScreen(A)) === 'top');
  await H.context.close();
  await sleep(2500);
  check('A10 GM のタブを閉じてもルームが作り直されない', (await L.roomOf(code)) === null);

  // ── ルーム2: ふつうの流れ ──
  const H2 = await L.newClient('gm2');
  const C = await L.newClient('c', { viewport: { width: 375, height: 812 } });
  const D = await L.newClient('d');
  const code2 = await createRoom(H2, 'ジーエム');
  await joinRoom(C, 'かえで', code2);
  await joinRoom(D, 'だいち', code2);
  check('C0 待合室 375px: 横にはみ出さない', (await L.overflow(C)) <= 0);
  await H2.page.waitForFunction(() => !document.getElementById('waiting-start-btn').disabled);
  await H2.page.click('#waiting-start-btn');
  for (const c of [H2, C, D]) await waitScreen(c, 'naming');
  check('C1 開始すると名前変えへ', (await L.roomOf(code2)).status === 'naming');
  await C.page.fill('#changed-name-input', 'かえでX');
  await C.page.click('button[onclick="submitChangedName()"]');
  await D.page.click('[onclick="submitAsVoter()"]');
  await H2.page.waitForFunction(() => state.lastRoom && Object.values(state.lastRoom.players).filter((p) => !p.isHost && p.ready).length === 2);
  await clickVisible(H2, 'button[onclick="hostStartVoting()"]');
  for (const c of [H2, C, D]) await waitScreen(c, 'voting');
  check('C2 投票へ', (await L.roomOf(code2)).status === 'voting');
  await clickVisible(D, '#voting-cards button');
  await D.page.waitForFunction(() => !document.getElementById('voting-submit-btn').disabled);
  await D.page.click('#voting-submit-btn');
  await H2.page.waitForFunction(() => state.lastRoom && state.lastRoom.players['だいち'] && state.lastRoom.players['だいち'].votes);
  await clickVisible(H2, 'button[onclick="hostStartRevealing()"]');
  for (const c of [H2, C, D]) await waitScreen(c, 'revealing');
  check('C3 結果発表へ', (await L.roomOf(code2)).status === 'revealing');
  await clickVisible(H2, 'button[onclick="hostFinish()"]');
  for (const c of [H2, C, D]) await waitScreen(c, 'done');
  room = await L.roomOf(code2);
  check('C4 ゲーム終了', room.status === 'done' && Number.isFinite(room.deleteAt));
  // 終わったあとの削除を早める（deleteAt はそのまま。ルームが消えたゲストに「閉じました」を出さないことを見る）
  await clickVisible(C, '#screen-done button');
  await waitScreen(C, 'top');
  check('C5 ゲーム終了のあとの「トップへ戻る」では案内を出さない', !(await C.page.evaluate(() => document.getElementById('toast').classList.contains('show'))));
  await L.rest('DELETE', L.ROOMS + '/' + code2);
  await waitScreen(D, 'top');
  check('C6 終わったあとにルームが消えても「閉じました」は出さない', (await L.text(D, '#toast')) !== 'GMがルームを閉じました');

  await L.finishAll(server);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
