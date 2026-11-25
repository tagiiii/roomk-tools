// たとえならべ E2E その2: ホストも遊んだ回の結果で端末なしの参加者を足す・参加者の切断中はチャットを送れない（2026-11-25）
const L = require('./lib.cjs');
const { check, sleep, roomOf, roomWhen, text, waitText, visible, waitScreen, createRoom, joinRoom, finishAll } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const host = await L.newClient('host');
    const sora = await L.newClient('sora');
    const code = await createRoom(host, 'メンター');
    await joinRoom(sora, 'そら', code);
    await host.page.click('#btn-start-game');
    await waitScreen(host, 'revealing');
    for (const c of [host, sora]) { await c.page.click('#flip-card'); await c.page.click('#btn-confirm-number'); }
    await host.page.click('#revealing-theme-options button >> nth=1');
    await host.page.waitForSelector('#btn-start-playing', { state: 'visible' });
    await host.page.click('#btn-start-playing');
    await waitScreen(sora, 'playing');

    // ホストも遊ぶときは、自分として送れて「だれとして」の選択は出ない
    check('1 遊ぶホストに送る欄', await visible(host, '#playing-chat-form'));
    check('2 遊ぶホストには選択を出さない', !(await visible(host, '#chat-as')));
    await host.page.fill('#chat-input', 'ちいさなあり');
    await host.page.click('#btn-chat-send');
    await waitText(sora, '#playing-chat-log', 'ちいさなあり');
    check('3 遊ぶホストのチャット', (await text(sora, '#playing-chat-log')).includes('メンター'));

    // 参加者の通信が切れている間は送れない
    sora.offlineOk = true;
    await sora.context.setOffline(true);
    await sora.page.waitForFunction(() => document.getElementById('guest-off-overlay').classList.contains('active'), null, { timeout: 15000 });
    await sora.page.evaluate(() => { document.getElementById('chat-input').value = 'きれてる'; sendChat(); });
    await sleep(500);
    await sora.context.setOffline(false);
    await sora.page.waitForFunction(() => !document.getElementById('guest-off-overlay').classList.contains('active'), null, { timeout: 30000 });
    await sleep(800);
    const r0 = await roomOf(code);
    check('4 切断中に押しても書きこまない', !Object.values(r0.chat || {}).some((m) => m.text === 'きれてる'), r0.chat);

    for (const c of [host, sora]) { await c.page.click('#btn-declare'); await c.page.click('#declare-confirm button:has-text("宣言する")'); }
    await roomWhen(code, (r) => r.players['メンター'].declaredAt != null && r.players['そら'].declaredAt != null);
    await host.page.click('#btn-finish-game');
    await waitScreen(sora, 'result');
    const score = await text(sora, '#result-score');
    check('5 2人の結果', score.endsWith('/2'), score);

    // 結果の画面で足すと、ホストは進行役になるが、その回のホストの結果は消えない
    await host.page.fill('#result-proxy-name', 'あお');
    await host.page.click('#result-proxy-add');
    const r1 = await roomWhen(code, (r) => r.players['あお']);
    check('6 結果の画面で足すとホストは進行役', r1.settings.hostPlays === false);
    await sleep(400);
    check('7 その回のホストの結果は残る', (await text(sora, '#result-score')) === score && (await sora.page.$$('#result-rows .ito-result-row')).length === 2);
    await host.page.click('#btn-play-again');
    await waitScreen(sora, 'revealing');
    const r2 = await roomOf(code);
    check('8 次の回はホストに数字を配らない', r2.players['メンター'].number === 0 && r2.players['あお'].number > 0 && r2.players['そら'].number > 0, r2.players);
    check('9 ホストに数字カードを出さない', !(await visible(host, '#flip-wrap')));
  } catch (e) {
    console.error(e);
    L.T.failures.push('exception: ' + e.message);
  }
  await finishAll(server);
})();
