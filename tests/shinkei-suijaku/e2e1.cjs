// 神経衰弱 E2E その1: 1台の画面（通信しない）・作成・参加（リンク）・待合室（むずかしさ・端末のない人）・
// めくる（みんなの画面に出る・番でない人は押せない・そろう・ちがう）・ホストの代わり・再読み込み・おわり・もう一回・待合室にもどる・375px・ルームを閉じる
const path = require('path');
const H = require('./lib.cjs');
const { check, sleep } = H;

(async () => {
  const server = await H.startServer();
  await H.launch();
  await H.loadRules(path.join(__dirname, '../../database.rules.json'));
  try {
    /* ── 1台の画面 ── */
    console.log('# 1台の画面');
    const solo = await H.newClient('solo');
    await H.open(solo);
    check('トップに3つのボタン', await H.visible(solo, '#btnGoCreate') && await H.visible(solo, '#btnGoJoin') && await H.visible(solo, '#btnGoLocal'));
    await solo.page.click('#btnGoLocal');
    await H.waitScreen(solo, 'local');
    await solo.page.click('#btn-start');
    await H.waitScreen(solo, 'game');
    check('1台: 12枚', (await H.cards(solo)).length === 12);
    const p0 = await H.players(solo);
    check('1台: あなたと CPU', p0.map((p) => p.name).join(',') === 'あなた,CPU', p0);
    await H.clickCard(solo, 0);
    check('1台: 1枚めくれる', (await H.cards(solo))[0].up);
    check('1台: ルームのバーは出ない', !(await H.visible(solo, '#roomBar')));
    check('1台: 通信しない（WebSocket 0）', solo.sockets === 0, solo.sockets);
    await solo.page.click('#btn-quit');
    await H.waitScreen(solo, 'local');
    await solo.page.click('#btnLocalBack');
    await H.waitScreen(solo, 'top');
    check('1台: 利用回数 start', await H.stats(solo, 'start') === 1);

    /* ── 作成・参加 ── */
    console.log('# 作成・参加');
    const host = await H.newClient('host');
    const code = await H.createRoom(host, 'ホスト');
    check('ルームコード6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
    check('利用回数 room-create', await H.waitStats(host, 'room-create', 1));
    check('はじめるは押せない（1人）', await host.page.$eval('#btnStartGame', (b) => b.disabled));
    const guest = await H.newClient('guest');
    await H.open(guest, '?room=' + code);
    await H.waitScreen(guest, 'join');
    check('リンク: コードが入る', (await guest.page.inputValue('#joinCode')) === code);
    check('リンク: ヒントが出る', await H.visible(guest, '#joinLinkHint'));
    await guest.page.fill('#guestName', 'ホスト');
    await guest.page.click('#btnJoinRoom');
    await H.waitText(guest, '#joinError', 'その名前は使われているよ');
    check('同じ名前は入れない', true);
    check('まちがいの欄に aria-invalid', (await guest.page.getAttribute('#guestName', 'aria-invalid')) === 'true');
    await guest.page.fill('#guestName', 'あお');
    await guest.page.click('#btnJoinRoom');
    await H.waitScreen(guest, 'waiting');
    check('参加後 ?room= が消える', !guest.page.url().includes('room='), guest.page.url());
    await H.waitText(host, '#waitingPlayers', 'あお');
    check('ゲストに「ホストが「はじめる」を押すのを待ってね」', await H.visible(guest, '#guestWaitingNote'));
    check('ゲストに設定の操作は出ない', !(await H.visible(guest, '#hostWaitingTools')));

    /* ── 待合室の設定 ── */
    console.log('# 待合室');
    await host.page.click('#roomLevel button[data-value="normal"]');
    await H.waitText(guest, '#waitingSettings', 'ふつう');
    check('むずかしさがゲストの要約に出る', true);
    await host.page.fill('#proxyName', 'きいろ');
    await host.page.click('#btnAddProxy');
    await H.waitText(guest, '#waitingPlayers', 'きいろ');
    const hostRows = await host.page.$$eval('#waitingPlayers li', (els) => els.map((e) => e.textContent));
    const guestRows = await guest.page.$$eval('#waitingPlayers li', (els) => els.map((e) => e.textContent));
    check('ホストには「端末なし」', hostRows.some((r) => r.includes('きいろ') && r.includes('端末なし')), hostRows);
    check('ゲストには「端末なし」を出さない', guestRows.every((r) => !r.includes('端末なし')), guestRows);
    check('人数の表示', (await H.text(host, '#waitingCount')).includes('3人'));
    await host.page.fill('#proxyName', 'あお');
    await host.page.click('#btnAddProxy');
    await H.waitText(host, '#proxyError', 'もういるよ');
    check('端末のない人も同じ名前は不可', true);

    /* ── はじめる ── */
    console.log('# はじめる');
    await host.page.click('#btnStartGame');
    await H.waitScreen(host, 'game');
    await H.waitScreen(guest, 'game');
    check('利用回数 room-start / room-players-3', await H.waitStats(host, 'room-start', 1) && await H.stats(host, 'room-players-3') === 1);
    let room = await H.roomOf(code);
    const deck = room.game.deck;
    check('20枚（ふつう）', deck.length === 20 && (await H.cards(guest)).length === 20);
    const gp = await H.players(guest);
    check('札: ホスト・あお・きいろ', gp.map((p) => p.name).join(',') === 'ホスト,あお,きいろ', gp);
    check('札: ホストの番', gp[0].turn);
    check('札: ゲストの画面に「あなた」', gp[1].tags.includes('あなた'));
    check('札: ゲストに「端末なし」を出さない', !gp[2].tags.includes('端末なし'));
    check('札: ホストに「端末なし」', (await H.players(host))[2].tags.includes('端末なし'));
    check('ゲストの案内: ホストの番', (await H.text(guest, '#status')) === 'ホストの番');
    check('ホストの案内: あなたの番', (await H.text(host, '#status')).includes('あなたの番'));
    check('ゲストに「待合室にもどる」を出さない', !(await H.visible(guest, '#btn-quit')));
    check('ホストに「待合室にもどる」', (await H.text(host, '#btn-quit')) === '待合室にもどる' && await H.visible(host, '#btn-quit'));
    await H.clickCard(guest, 0);
    await sleep(400);
    check('番でない人は押せない', (await H.roomOf(code)).game.open === -1);

    /* ── ホストがちがう2枚 ── */
    console.log('# めくる');
    const [m1, m2] = H.missIn(deck);
    await H.clickCard(host, m1);
    await guest.page.waitForFunction((i) => document.querySelector(`#board .ss-card[data-i="${i}"]`).classList.contains('is-up'), m1);
    check('1枚めがゲストの画面でも表', true);
    check('ゲストの案内: めくっている', (await H.text(guest, '#status')).includes('ホストがめくっているよ'));
    await H.clickCard(host, m2);
    await H.waitText(guest, '#status', 'ちがったね', 3000);
    const during = await H.cards(guest);
    check('2枚めくると、ゲストの画面に2枚とも表', during[m1].up && during[m2].up);
    await H.waitText(guest, '#status', 'あなたの番', 3000);
    const after = await H.cards(guest);
    check('ちがったら裏にもどる', !after[m1].up && !after[m2].up);
    check('次はあお', (await H.players(host))[1].turn);

    /* ── あおがそろえる ── */
    const [q1, q2] = H.pairIn(deck);
    await H.clickCard(guest, q1);
    await H.clickCard(guest, q2);   // すばやく2枚押す（1枚めの処理中なら、終わってからめくる）
    await H.waitText(host, '#status', 'そろった！ あおがもらうよ', 3000);
    room = await H.roomWhen(code, (r) => r.game.pairs[1] === 1);
    check('そろうとペアが増える（DB）', room.game.pairs[1] === 1 && room.game.got[q1] && room.game.got[q2]);
    await H.waitText(guest, '#status', 'あなたの番', 3000);
    check('そろったら同じ人がもう1回', (await H.players(guest))[1].turn);
    check('取ったカードは薄く表のまま', (await H.cards(host))[q1].got && (await H.cards(host))[q1].up);
    check('札のペアの数 1', (await H.players(host))[1].pairs === 1);

    /* ── あおが外す → 端末なしのきいろ（ホストが代わりに） ── */
    const [n1, n2] = H.missIn(deck, room.game.got);
    await H.clickCard(guest, n1);
    await H.clickCard(guest, n2);
    await H.waitText(host, '#status', 'きいろの番。代わりにめくれます', 4000);
    check('端末なしの人の番はホストが代わりに', true);
    check('ゲストの案内: きいろの番', (await H.text(guest, '#status')) === 'きいろの番');

    /* ── 再読み込み ── */
    console.log('# 再読み込み');
    await guest.page.reload();
    await H.waitScreen(guest, 'game');
    check('再読み込みで遊ぶ画面に戻る', (await H.players(guest))[1].pairs === 1);
    check('再読み込み後も取ったカードは取ったまま', (await H.cards(guest))[q1].got);

    /* ── おわり ── */
    console.log('# おわり');
    room = await H.roomOf(code);
    const got = room.game.got.slice();
    const last = H.pairIn(deck, got.map((g, i) => g));
    // 最後の1組を残して、ほかは取ったことにする（ホスト0・あお1 のまま）
    deck.forEach((_, i) => { if (i !== last[0] && i !== last[1]) got[i] = true; });
    await H.rest('PATCH', H.ROOMS + '/' + code + '/game', { got });
    await host.page.waitForFunction((i) => document.querySelectorAll('#board .ss-card.is-got').length === 18, null);
    await H.clickCard(host, last[0]);
    await H.clickCard(host, last[1]);
    await H.waitVisible(host, '#result', 4000);
    await H.waitVisible(guest, '#result', 4000);
    check('おわり: 引き分けの文（きいろ1・あお1）', (await H.text(guest, '#result-body')).includes('あお・きいろが 1ペア'), await H.text(guest, '#result-body'));
    check('利用回数 room-finish（最後にめくった端末）', await H.waitStats(host, 'room-finish', 1));
    check('ゲストに「もう一回」を出さない・待つ文', !(await H.visible(guest, '#btn-again')) && await H.visible(guest, '#result-wait'));
    check('ホストに「もう一回」「待合室にもどる」', await H.visible(host, '#btn-again') && (await H.text(host, '#btn-back')) === '待合室にもどる');
    check('おわりの画面で番の印は出さない', (await H.players(guest)).every((p) => !p.turn));

    /* ── もう一回 ── */
    await host.page.click('#btn-again');
    await H.waitHidden(guest, '#result', 4000);
    room = await H.roomOf(code);
    check('もう一回: 新しい対戦', room.game.id === 2 && room.status === 'playing');
    check('もう一回: はじめの人を交代（あお）', room.game.turn === 1, room.game.turn);
    check('もう一回: ペアは0から', (await H.players(guest)).every((p) => p.pairs === 0));
    check('もう一回: カードはみんな裏', (await H.cards(guest)).every((x) => !x.up));
    check('利用回数 room-again', await H.waitStats(host, 'room-again', 1));

    /* ── 375px ── */
    console.log('# 375px');
    await guest.page.setViewportSize({ width: 375, height: 760 });
    await sleep(300);
    check('375px: 横にはみ出さない', (await H.overflow(guest)) <= 0, await H.overflow(guest));
    const w = await guest.page.$eval('#board .ss-card', (b) => b.getBoundingClientRect().width);
    check('375px: カードが 44px 以上', w >= 44, w);
    await guest.page.screenshot({ path: path.join(H.OUT, 'e2e1-guest-375.png'), fullPage: true });
    await host.page.screenshot({ path: path.join(H.OUT, 'e2e1-host-1100.png'), fullPage: true });

    /* ── 待合室にもどる ── */
    await host.page.click('#btn-quit');   // 確認は自動で OK
    await H.waitScreen(guest, 'waiting');
    await H.waitScreen(host, 'waiting');
    check('待合室にもどる', (await H.roomOf(code)).status === 'waiting');
    check('待合室: きいろは残る', (await H.text(guest, '#waitingPlayers')).includes('きいろ'));
    await guest.page.screenshot({ path: path.join(H.OUT, 'e2e1-guest-waiting-375.png'), fullPage: true });
    await host.page.screenshot({ path: path.join(H.OUT, 'e2e1-host-waiting.png'), fullPage: true });

    /* ── 進行だけのホスト ── */
    await host.page.uncheck('#hostPlays');
    await H.waitText(guest, '#waitingPlayers', '進行役');
    check('進行だけ: 人数に数えない', (await H.text(host, '#waitingCount')).includes('2人'));
    await host.page.click('#btnStartGame');
    await H.waitScreen(guest, 'game');
    const order = (await H.players(guest)).map((p) => p.name).join(',');
    check('進行だけ: ホストは札に出ない', order === 'あお,きいろ', order);
    check('進行だけのホストも代わりにめくれる', (await H.text(host, '#status')).includes('代わりにめくれます'));
    // ホストが代わりに、ちがう2枚と3枚めをすばやく押す → 3枚めは番が変わったので捨てる（次の人の1枚めにしない）
    const r3 = await H.roomOf(code);
    const [x1, x2] = H.missIn(r3.game.deck);
    const x3 = [...Array(r3.game.deck.length).keys()].find((i) => i !== x1 && i !== x2);
    // 「はじめる」の書き込みの応答を待つ（応答待ちの間に押したカードは、はじめの1枚だけ覚える作りのため）
    await sleep(800);
    // 3回のクリックを同じ瞬間に送る（?fast=1 の見せる時間は0.25秒なので、1回ずつだと見せおわってから届く）
    await host.page.evaluate((ids) => ids.forEach((i) => document.querySelector(`#board .ss-card[data-i="${i}"]`).click()), [x1, x2, x3]);
    await H.roomWhen(code, (r) => r.game.turn === 1);
    await sleep(1200);
    const r4 = await H.roomOf(code);
    check('番が変わったら、ホストが続けて押した3枚めは捨てる', r4.game.turn === 1 && r4.game.open === -1, { turn: r4.game.turn, open: r4.game.open });
    // ちがった2枚を見せている間にホストが押したカードは、次の人（あお）の1枚めにしない
    const [y1, y2] = H.missIn(r4.game.deck);
    const y3 = [...Array(r4.game.deck.length).keys()].find((i) => i !== y1 && i !== y2);
    await H.clickCard(host, y1);
    await H.roomWhen(code, (r) => r.game.open === y1);
    await host.page.evaluate((i) => document.querySelector(`#board .ss-card[data-i="${i}"]`).click(), y2);
    await H.waitText(host, '#status', 'ちがったね', 3000);
    await host.page.evaluate((i) => document.querySelector(`#board .ss-card[data-i="${i}"]`).click(), y3);
    await sleep(1200);
    const r5 = await H.roomOf(code);
    check('ちがった2枚を見せている間に押したカードは、次の人の番でめくらない', r5.game.turn === 0 && r5.game.open === -1, { turn: r5.game.turn, open: r5.game.open });
    await host.page.click('#btn-quit');
    await H.waitScreen(guest, 'waiting');

    /* ── ルームを閉じる ── */
    await host.page.click('#btnLeave');
    await H.waitScreen(guest, 'top');
    await H.waitToast(guest, 'ルームが閉じられたよ');
    check('ルームを閉じるとゲストはトップへ', (await H.roomOf(code)) === null);
  } catch (e) {
    console.error(e);
    check('exception', false, String(e && e.message));
  }
  await H.finishAll(server);
})();
