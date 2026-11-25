// たとえならべ E2E その1: 見学の画面・たとえのチャット・端末なしの参加者（2026-11-25）
// 隔離エミュレーターで、ホスト・参加者2人・見学の画面を別々のブラウザとして動かす。本番の Firebase には接続しない。
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, roomWhen, text, waitText, visible, waitVisible, screen, waitScreen, overflow,
  waitToast, bodyText, createRoom, joinRoom, listText, clip, finishAll, ROOMS, OUT } = L;
const path = require('path');

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    // ── A. 待合室: 見学の画面・端末なしの参加者 ──
    console.log('A. 待合室');
    const host = await L.newClient('host');
    const sora = await L.newClient('sora');
    const midori = await L.newClient('midori');
    const watcher = await L.newClient('watch', { viewport: { width: 1280, height: 800 } });
    const code = await createRoom(host, 'メンター');
    await joinRoom(sora, 'そら', code);
    await joinRoom(midori, 'みどり', code);

    await L.open(watcher, '?watch=' + code);
    await waitScreen(watcher, 'watch');
    await waitText(watcher, '#watch-body', 'みどり');
    const wb0 = await text(watcher, '#watch-body');
    check('A1 見学: 待合室の参加者が出る', wb0.includes('メンター') && wb0.includes('そら') && wb0.includes('参加者を待っています'), wb0);
    check('A2 見学: ルームコードが出る', (await text(watcher, '#watch-code-line')).includes(code));

    check('A3 ホストに端末なしの欄が出る', await visible(host, '#waiting-proxy-box'));
    check('A4 参加者には端末なしの欄が出ない', !(await visible(sora, '#waiting-proxy-box')));
    check('A5 ホストに「みんなにみせる画面をひらく」', await visible(host, '#watch-open-link'));
    check('A6 参加者には「みんなにみせる画面をひらく」が出ない', !(await visible(sora, '#watch-open-link')));
    check('A7 見学用のリンクのボタンは参加者にも出る', await visible(sora, '#btnCopyWatchLink'));

    await host.page.click('#btnCopyWatchLink');
    await waitToast(host, '見学用のリンクをコピーしました');
    const wl = await clip(host);
    check('A8 見学用のリンク', wl.endsWith('/tatoe-narabe/?watch=' + code), wl);

    // 端末なしの参加者を足す
    await host.page.fill('#waiting-proxy-name', 'あお');
    await host.page.click('#waiting-proxy-add');
    let room = await roomWhen(code, (r) => r.players['あお']);
    check('A9 足した人は proxy: true', room.players['あお']?.proxy === true && room.players['あお'].isHost === false, room.players['あお']);
    check('A10 足すとホストは進行役', room.settings?.hostPlays === false, room.settings);
    await host.page.waitForFunction(() => document.getElementById('set-host-plays').disabled);
    check('A11 ホストの「自分も参加」は外れて押せない', !(await host.page.isChecked('#set-host-plays')));
    check('A12 入力欄は空にもどる', (await host.page.inputValue('#waiting-proxy-name')) === '');
    await waitText(sora, '#waiting-player-list', 'あお');
    const hostList = await text(host, '#waiting-player-list');
    const soraList = await text(sora, '#waiting-player-list');
    check('A13 ホストの一覧に「端末なし」', /あお\s*端末なし/.test(hostList), hostList);
    check('A14 参加者の一覧には「端末なし」を出さない', soraList.includes('あお') && !soraList.includes('端末なし'), soraList);
    check('A15 参加者の一覧に「進行役」', soraList.includes('進行役'), soraList);
    await waitText(watcher, '#watch-body', 'あお');
    check('A16 見学: 「端末なし」を出さない', !(await text(watcher, '#watch-body')).includes('端末なし'));

    // 同じ名前・外す
    await host.page.fill('#waiting-proxy-name', 'そら');
    await host.page.click('#waiting-proxy-add');
    await waitToast(host, 'その名前は使われています');
    check('A17 同じ名前は足せない', true);
    await host.page.fill('#waiting-proxy-name', 'はる');
    await host.page.press('#waiting-proxy-name', 'Enter');
    await roomWhen(code, (r) => r.players['はる']);
    await waitText(host, '#waiting-player-list', 'はる');
    await host.page.click('#waiting-player-list button[data-proxy="はる"]');
    room = await roomWhen(code, (r) => !r.players['はる']);
    check('A18 「外す」で消える（Enter でも足せた）', !room.players['はる'], Object.keys(room.players));
    check('A19 参加者には「外す」が出ない', (await sora.page.$$('#waiting-player-list button[data-proxy]')).length === 0);

    // 端末なしの人と同じ名前では参加できない
    const dup = await L.newClient('dup');
    await L.open(dup, '?room=' + code);
    await waitScreen(dup, 'guest-join');
    await dup.page.fill('#guest-nick', 'あお');
    await dup.page.click('#btn-join-room');
    await waitText(dup, '#guest-error', 'そのニックネームは使われています');
    check('A20 端末なしの人と同じ名前では入れない', true);
    await dup.context.close();

    // ── B. 数字の確認: 端末なしの参加者に伝える ──
    console.log('B. 数字の確認');
    await host.page.click('#btn-start-game');
    await waitScreen(sora, 'revealing');
    await waitScreen(host, 'revealing');
    room = await roomOf(code);
    const nums = Object.fromEntries(Object.entries(room.players).map(([n, p]) => [n, p.number]));
    check('B1 端末なしの人にも数字が配られる・ホストは0', nums['あお'] > 0 && nums['メンター'] === 0 && nums['そら'] > 0, nums);
    await waitVisible(host, '#revealing-proxy-box');
    check('B2 参加者には「数字を伝える」欄が出ない', !(await visible(sora, '#revealing-proxy-box')));
    check('B3 数字ははじめ隠す', (await host.page.$eval('#revealing-proxy-list .ito-proxy-num', (e) => e.textContent)) === '？');
    await host.page.click('#revealing-proxy-list button:has-text("見る")');
    await host.page.waitForFunction(() => document.querySelector('#revealing-proxy-list .ito-proxy-num').textContent !== '？');
    check('B4 「見る」で数字が出る', (await host.page.$eval('#revealing-proxy-list .ito-proxy-num', (e) => e.textContent)) === String(nums['あお']));
    await host.page.click('#revealing-proxy-list button:has-text("かくす")');
    await host.page.waitForFunction(() => document.querySelector('#revealing-proxy-list .ito-proxy-num').textContent === '？');
    check('B5 「かくす」でもどる', true);
    await host.page.click('#revealing-proxy-list button:has-text("数字をコピー")');
    await waitToast(host, 'あおさんの数字をコピーしました');
    const msg = await clip(host);
    check('B6 チャット用の文', msg === `あおさんの数字は ${nums['あお']} です。ほかの人には内緒にしてね。`, msg);
    await host.page.click('#revealing-proxy-list button:has-text("伝えた")');
    room = await roomWhen(code, (r) => r.players['あお'].ready === true);
    check('B7 「伝えた」で確認ずみ', room.players['あお'].ready === true);
    await waitText(host, '#revealing-proxy-list', '確認した！');

    for (const c of [sora, midori]) {
      await c.page.click('#flip-card');
      await c.page.click('#btn-confirm-number');
    }
    await roomWhen(code, (r) => r.players['そら'].ready && r.players['みどり'].ready);
    await waitText(watcher, '#watch-body', '確認した！');
    const wb1 = await text(watcher, '#watch-body');
    check('B8 見学: 確認の様子とお題の候補', wb1.includes('みんなが自分の数字を確認しています') && wb1.includes('①'), wb1);
    check('B9 見学: 数字を出さない', !(await watcher.page.$('#watch-body .ito-proxy-num, #watch-body .ito-number')));
    await host.page.click('#revealing-theme-options button >> nth=0');
    await waitVisible(host, '#btn-start-playing');
    await waitText(watcher, '#watch-body', '選択中のお題');
    await host.page.click('#btn-start-playing');

    // ── C. 発言: たとえのチャット・代わりに宣言 ──
    console.log('C. 発言');
    await waitScreen(sora, 'playing');
    await waitScreen(host, 'playing');
    await waitText(watcher, '#watch-body', '宣言した順番');
    check('C1 参加者に送る欄', await visible(sora, '#playing-chat-form'));
    check('C2 参加者には「だれとして」の選択を出さない', !(await visible(sora, '#chat-as')));
    check('C3 ホスト（進行役）は端末なしの人として送れる', await visible(host, '#playing-chat-form') && await visible(host, '#chat-as'));
    const asOptions = await host.page.$$eval('#chat-as option', (els) => els.map((e) => e.value));
    check('C4 進行役のホストの選択は端末なしの人だけ', JSON.stringify(asOptions) === JSON.stringify(['あお']), asOptions);
    check('C5 ホストに「代わりに宣言する」', await visible(host, '#playing-proxy-box'));
    check('C6 参加者には「代わりに宣言する」が出ない', !(await visible(sora, '#playing-proxy-box')));

    await sora.page.fill('#chat-input', '  ふわふわの   雲  ');
    await sora.page.press('#chat-input', 'Enter');
    await waitText(midori, '#playing-chat-log', 'ふわふわの 雲');
    check('C7 送った言葉がほかの人に出る（空白はつめる）', true);
    check('C8 送ったら入力欄は空', (await sora.page.inputValue('#chat-input')) === '');
    await waitText(watcher, '#watch-body', 'ふわふわの 雲');
    check('C9 見学: チャットが出る', true);
    await waitText(sora, '#undeclared-list', '「ふわふわの 雲」');
    check('C10 未宣言の一覧に、その人のたとえ', true);

    await sora.page.fill('#chat-input', 'もう一つ');
    await sora.page.click('#btn-chat-send');
    await waitToast(sora, '少し待ってから送ってね');
    check('C11 3秒に1回まで', (await sora.page.inputValue('#chat-input')) === 'もう一つ');

    await host.page.fill('#chat-input', '大きなくじら');
    await host.page.click('#btn-chat-send');
    room = await roomWhen(code, (r) => Object.values(r.chat || {}).some((m) => m.name === 'あお'));
    const aoMsg = Object.values(room.chat).find((m) => m.name === 'あお');
    check('C12 ホストが端末なしの人として送れる', aoMsg && aoMsg.text === '大きなくじら' && aoMsg.roundId === room.roundId, aoMsg);
    await waitText(sora, '#playing-chat-log', '大きなくじら');

    // ホストは書きこみを消せる。参加者には「消す」が出ない
    check('C13 参加者には「消す」が出ない', (await sora.page.$$('#playing-chat-log .ito-chat-item__del')).length === 0);
    await midori.page.fill('#chat-input', 'けしてね');
    await midori.page.click('#btn-chat-send');
    await waitText(host, '#playing-chat-log', 'けしてね');
    await host.page.click('#playing-chat-log li:has-text("けしてね") .ito-chat-item__del');
    room = await roomWhen(code, (r) => !Object.values(r.chat || {}).some((m) => m.text === 'けしてね'));
    check('C14 ホストの「消す」で消える', !Object.values(room.chat || {}).some((m) => m.text === 'けしてね'));
    await sora.page.waitForFunction(() => !document.getElementById('playing-chat-log').textContent.includes('けしてね'));

    check('C15 見学: 発言中も数字を出さない', !(await text(watcher, '#watch-body')).includes('数字:'));

    // 宣言（ホストは端末なしの人の代わりに）
    await sora.page.click('#btn-declare');
    await sora.page.click('#declare-confirm button:has-text("宣言する")');
    await roomWhen(code, (r) => r.players['そら'].declaredAt != null);
    await host.page.click('#playing-proxy-list button:has-text("代わりに宣言する")');
    room = await roomWhen(code, (r) => r.players['あお'].declaredAt != null);
    check('C16 代わりに宣言', room.players['あお'].declaredAt > room.players['そら'].declaredAt);
    await waitText(host, '#playing-proxy-list', '宣言ずみ');
    await sleep(3100);
    await midori.page.fill('#chat-input', 'ぞうのせなか');
    await midori.page.click('#btn-chat-send');
    await waitText(watcher, '#watch-body', 'ぞうのせなか');
    await midori.page.click('#btn-declare');
    await midori.page.click('#declare-confirm button:has-text("宣言する")');
    await roomWhen(code, (r) => r.players['みどり'].declaredAt != null);
    await waitText(watcher, '#watch-body', '全員が宣言しました');
    const order = await watcher.page.$$eval('#watch-body .ito-declared-item__name', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
    check('C17 見学: 宣言の順とたとえ', order.length === 3 && order[0].startsWith('そら') && order[0].includes('「ふわふわの 雲」') && order[1].startsWith('あお') && order[1].includes('「大きなくじら」'), order);
    await watcher.page.screenshot({ path: path.join(OUT, 'watch-playing.png') });
    await host.page.screenshot({ path: path.join(OUT, 'host-playing.png'), fullPage: true });

    // ── D. 答え合わせ ──
    console.log('D. 答え合わせ');
    await host.page.click('#btn-finish-game');
    await waitScreen(sora, 'result');
    await waitText(watcher, '#watch-body', '人正解！');
    const wb2 = await text(watcher, '#watch-body');
    check('D1 見学: 結果に数字が出る', wb2.includes('数字: ' + nums['あお']) && wb2.includes('数字: ' + nums['そら']), wb2);
    check('D2 見学: 結果にチャットが出る', wb2.includes('たとえのチャット') && wb2.includes('ぞうのせなか'));
    const rows = await sora.page.$$eval('#result-rows .ito-result-row', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
    check('D3 結果の行にたとえ', rows.length === 3 && rows[1].includes('あお') && rows[1].includes('「大きなくじら」'), rows);
    check('D4 結果のチャットのふりかえり', await visible(sora, '#result-chat-card'));
    const sorted = ['そら', 'あお', 'みどり'].map((n) => nums[n]);
    const expectAll = sorted[0] < sorted[1] && sorted[1] < sorted[2];
    const scoreText = await text(sora, '#result-score');
    check('D5 点の母数は3人', scoreText.endsWith('/3'), scoreText);
    check('D6 並びが合っていれば満点', !expectAll || scoreText === '3/3', { scoreText, nums });
    check('D7 ホストに結果の画面の端末なしの欄', await visible(host, '#result-proxy-box'));
    check('D8 参加者には出ない', !(await visible(sora, '#result-proxy-box')));
    check('D9 結果の画面では送る欄を出さない', !(await visible(sora, '#playing-chat-form')));
    await watcher.page.screenshot({ path: path.join(OUT, 'watch-result.png') });

    // 結果の画面で足す（その回の結果は変えない）
    await host.page.fill('#result-proxy-name', 'はる');
    await host.page.click('#result-proxy-add');
    await roomWhen(code, (r) => r.players['はる']);
    await waitText(host, '#result-proxy-list', 'はる');
    await sleep(300);
    check('D10 結果の画面で足しても、その回の結果はそのまま', (await text(sora, '#result-score')) === scoreText && (await sora.page.$$('#result-rows .ito-result-row')).length === 3);
    check('D11 結果の画面の一覧に外すボタン', (await host.page.$$('#result-proxy-list button[data-proxy="はる"]')).length === 1);

    // もう一度プレイ: チャットは消え、足した人にも数字
    await host.page.click('#btn-play-again');
    await waitScreen(sora, 'revealing');
    room = await roomOf(code);
    check('D12 もう一度でチャットは消える', !room.chat, room.chat);
    check('D13 結果の画面で足した人にも数字', room.players['はる'].number > 0 && room.players['あお'].number > 0 && room.players['メンター'].number === 0, room.players);
    await waitText(watcher, '#watch-body', 'みんなが自分の数字を確認しています');
    check('D14 見学: 次の回に切りかわる', !(await text(watcher, '#watch-body')).includes('ぞうのせなか'));

    // ── E. 幅 375px ──
    console.log('E. 幅 375px');
    for (const c of [host, watcher, sora]) await c.page.setViewportSize({ width: 375, height: 800 });
    await sleep(300);
    for (const c of [host, watcher, sora]) check('E1 横にはみ出さない: ' + c.label, (await overflow(c)) <= 0, await overflow(c));
    await host.page.screenshot({ path: path.join(OUT, 'host-revealing-375.png'), fullPage: true });

    // ── F. ルームを閉じると見学の画面に知らせ ──
    console.log('F. 終わり');
    await host.page.click('#btn-leave-revealing');
    await waitScreen(host, 'top');
    await waitText(watcher, '#watch-body', 'このルームは見つからないか、終わりました');
    check('F1 見学: ルームが終わったら知らせる', true);
    await watcher.page.click('#screen-watch button:has-text("トップへ戻る")');
    await waitScreen(watcher, 'top');
    check('F2 トップへ戻るとアドレスから ?watch を外す', !(await watcher.page.evaluate(() => location.search)).includes('watch'));

    // ── G. トップの「見学する」からコードで開く・まちがったコード ──
    console.log('G. 見学の入口');
    const g = await L.newClient('g');
    await L.open(g);
    await g.page.click('#screen-top button:has-text("見学する")');
    await waitScreen(g, 'watch-join');
    await g.page.fill('#watch-code', 'ab');
    await g.page.click('#btn-open-watch');
    await waitText(g, '#watch-error', '6文字');
    await g.page.fill('#watch-code', 'ZZZZZZ');
    await g.page.click('#btn-open-watch');
    await waitScreen(g, 'watch');
    await waitText(g, '#watch-body', '見つからないか');
    check('G1 ない部屋は「見つからない」', (await g.page.evaluate(() => location.search)) === '?watch=ZZZZZZ');
    // 見学の画面は何も書きこまない
    const zz = await rest('GET', ROOMS + '/ZZZZZZ');
    check('G2 見学の画面はルームを作らない', zz === null, zz);
  } catch (e) {
    console.error(e);
    L.T.failures.push('exception: ' + e.message);
  }
  await finishAll(server);
})();
