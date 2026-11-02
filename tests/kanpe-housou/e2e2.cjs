// カンペ放送局 E2E その2: 進行だけのホスト＋参加者2人＋端末なし1人。端末なしの人を足す・書くだけ（自分の行だけ・ホストはみんなの行・
// みんな書くだけだとはじめられない）・2周・順位・読み込み直し・端末なしの人の書く／読む・読む人の切断と代わりの進行・
// 途中から入った人は見ているだけ・ホストが切れたときのオーバーレイ
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const code = await L.createRoom(H, 'ホスト');
  const N = await L.newClient('ナツキ');
  await L.joinRoom(N, 'ナツキ', code);
  const HR = await L.newClient('ハルト');
  await L.joinRoom(HR, 'ハルト', code);
  const all = [H, N, HR];

  await H.page.uncheck('#host-plays');
  await H.page.fill('#nodev-name', 'ミオ');
  await H.page.press('#nodev-name', 'Enter');
  check('A1 端末のない人を足せる', await L.waitFor(async () => (await H.page.$$('#lobby-people li')).length === 4));
  check('A2 「端末なし」の印はホストにだけ', (await L.text(H, '#lobby-people')).includes('端末なし') && !(await L.text(N, '#lobby-people')).includes('端末なし'));
  await H.page.fill('#nodev-name', 'ナツキ');
  await H.page.press('#nodev-name', 'Enter');
  await L.waitText(H, '#nodev-msg', 'その名前は使われている');
  check('A3 参加者と同じ名前は足せない', true);
  await H.page.check('input[name=opt-laps][value="2"]');
  await H.page.check('#opt-score');
  check('A4 参加者に設定が見える', await L.waitFor(async () => (await L.text(N, '#lobby-opts-view')).includes('2回ずつ') && (await L.text(N, '#lobby-opts-view')).includes('「笑った！」をもらった数')));
  check('A5 進行だけのホストは数えない', (await L.text(H, '#lobby-count')).includes('遊ぶ人 3人'));

  // 書くだけ
  check('B1 参加する人には自分の「書くだけ」だけ', (await HR.page.$$('#lobby-people .kh-noread')).length === 1);
  check('B2 ホストには遊ぶ人みんなの「書くだけ」（進行だけのホストはのぞく）', (await H.page.$$('#lobby-people .kh-noread')).length === 3);
  await HR.page.check('#lobby-people .kh-noread input');
  check('B3 書くだけにしたことが、ほかの人にも見える', await L.waitFor(async () => (await L.text(N, '#lobby-people')).includes('書くだけ')));
  const rowOf = (c, name) => c.page.locator('#lobby-people li', { hasText: name }).first();
  check('B4 ホストの画面でもチェックが入る', await L.waitFor(() => rowOf(H, 'ハルト').locator('.kh-noread input').isChecked()));
  await rowOf(H, 'ナツキ').locator('.kh-noread input').check();
  await rowOf(H, 'ミオ').locator('.kh-noread input').check();
  check('B5 みんな書くだけだと、はじめられない', await L.waitFor(() => H.page.isDisabled('#btn-start')));
  check('B6 理由が出る', (await L.text(H, '#lobby-check')).includes('読む人がいない'));
  await rowOf(H, 'ナツキ').locator('.kh-noread input').uncheck();
  await rowOf(H, 'ミオ').locator('.kh-noread input').uncheck();
  check('B7 読む人がいれば、はじめられる', await L.waitFor(async () => !(await H.page.isDisabled('#btn-start'))));
  await L.shot(H, 'a-lobby-host');

  // ── 1本目: 読むのはナツキ。書くのはハルト・ミオ（2つずつ） ──
  await H.page.click('#btn-start');
  await L.waitPhaseAll(all, 'write');
  check('C1 書くだけの人をのぞいた2人×2周で4本', (await L.text(H, '.kh-onair__round')).includes('全4本'));
  check('C2 はじめに読むのはナツキ', (await L.readerOf(H)) === 'ナツキ');
  check('C3 ゲーム中も「書くだけ」とわかる', (await L.text(N, '#players')).includes('書くだけ'));
  check('C4 書く人2人なら2つずつ', (await HR.page.$$('#stage .kh-hint__input')).length === 2);
  check('C5 進行だけのホストには自分の書く欄はない', (await H.page.$$('#stage .kh-hint__input')).length === 0);
  check('C6 端末のない人の代わりに書く欄が出る', (await H.page.$$('#tools .kh-hint__input')).length === 2);
  check('C7 ヒントをチャット用にコピーできる', (await L.text(H, '#tools')).includes('ヒントをチャット用にコピー'));
  check('C8 players-3 を数えた', await L.waitStats(H, 'players-3', 1));
  await L.shot(H, 'c-host-write');

  // 読み込み直し（書いている途中の参加者）
  await HR.page.reload();
  await L.waitPhase(HR, 'write', 15000);
  check('C9 読み込み直しても同じルームの書く画面にもどる', (await HR.page.$$('#stage .kh-hint__input')).length === 2);
  await L.writeAll(H, 'ミオのことば', '#tools');
  await L.writeAll(HR, 'ハルトのことば');
  await L.waitPhaseAll(all, 'read');
  check('C10 みんな出したら読む', true);
  await L.readThrough(N, 4);
  check('C11 空らん4つが出る', (await L.words(N)).length === 4);
  check('C12 書くだけの人も「笑った！」を押せる（自分の2つはのぞく）', (await HR.page.$$('#stage .kh-laugh')).length === 2);
  check('C13 進行だけのホストには「笑った！」は出ない', (await H.page.$$('#stage .kh-laugh')).length === 0);
  await L.laughAt(HR, 'ミオのことば1');
  await L.laughAt(N, 'ハルトのことば1');
  await L.laughAt(N, 'ミオのことば1');
  check('C14 数がそろう', await L.waitFor(async () => (await L.laughCount(H, 'ミオのことば1')) === 2 && (await L.laughCount(H, 'ハルトのことば1')) === 1));
  await L.clickText(N, '#stage', '読みおわった');
  await L.waitPhaseAll(all, 'result');
  check('C15 いちばん押された言葉が出る', (await L.text(N, '#game-status')).includes('ミオのことば1'));

  // ── 2本目: 端末のない ミオ が読む → ホストが代わりに進める（書くだけの ハルト はとばす） ──
  await L.clickText(H, '#stage', 'つぎの番組へ');
  await L.waitPhaseAll(all, 'write');
  check('D1 書くだけの人はとばして、次に読むのは ミオ', (await L.readerOf(H)) === 'ミオ');
  await L.writeAll(N, 'ナツキ');
  await L.writeAll(HR, 'ハルト');
  await L.waitPhaseAll(all, 'read');
  check('D2 ホストに代わりに進めるボタン', (await L.text(H, '#tools')).includes('代わりに：読みはじめる'));
  check('D3 参加者には代わりのボタンは出ない', !(await L.visible(N, '#tools')));
  await L.readThrough(H, 4, '#tools');
  check('D4 ホストが代わりに進められる', (await L.lineCount(N)) === 6);
  await L.shot(H, 'd-host-proxy-read');
  await L.clickText(H, '#tools', '代わりに：読みおわった');
  await L.waitPhaseAll(all, 'result');

  // ── 3本目: ナツキ（2周目）。読んでいる途中で通信が切れる → ホストが代わりに進める → もどると続きから ──
  await L.clickText(H, '#stage', 'つぎの番組へ');
  await L.waitPhaseAll(all, 'write');
  check('E1 2周目も書くだけの人はとばす', (await L.readerOf(H)) === 'ナツキ');
  await L.clickText(H, '#tools', 'まだの人を待たずに読みはじめる');
  await L.waitPhaseAll(all, 'read');
  await L.clickText(N, '#stage', '読みはじめる');
  await N.page.waitForFunction(() => document.querySelectorAll('#stage .kh-line').length === 1);
  N.offlineOk = true;
  await N.context.setOffline(true);
  check('E2 読む人の通信が切れたと分かる', await L.waitFor(async () => !(await L.roomOf(code)).players?.['ナツキ'], 120000));
  await L.waitText(H, '#tools', '通信が切れた', 10000);
  check('E3 ホストに代わりに進めるボタン（通信が切れた）', (await L.text(H, '#tools')).includes('代わりに：つぎへ'));
  check('E4 札に「通信が切れた」', (await L.text(HR, '#players')).includes('通信が切れた'));
  await L.clickText(H, '#tools', '代わりに：つぎへ');
  check('E5 代わりに1行進められる', await L.waitFor(async () => (await L.lineCount(HR)) === 2));
  await N.context.setOffline(false);
  check('E6 もどると在室が戻る', await L.waitFor(async () => !!(await L.roomOf(code)).players?.['ナツキ'], 60000));
  check('E7 もどると続きから（同じ行まで出ている）', await L.waitFor(async () => (await L.lineCount(N)) === 2, 15000));
  check('E8 もどった読む人に「つぎへ」が出る', await L.waitFor(() => N.page.isVisible('#stage .kh-next')));
  check('E9 「通信が切れた」の知らせは消える', await L.waitFor(async () => !(await L.text(H, '#tools')).includes('通信が切れた')));
  const before = await L.lineCount(N);
  await L.clickText(H, '#tools', '代わりに：つぎへ');
  check('E10 読む人がつながっていても、ホストは確かめて代わりに進められる', await L.waitFor(async () => (await L.lineCount(N)) === before + 1));

  // 途中から入った人は見ているだけ
  const Y = await L.newClient('ユウ');
  await L.open(Y, '?room=' + code);
  await L.waitScreen(Y, 'join');
  await Y.page.fill('#guestName', 'ユウ');
  await Y.page.click('#btnJoinRoom');
  await L.waitPhase(Y, 'read');
  check('F1 途中から入った人は「見ているだけ」', (await L.text(Y, '#barMe')).includes('見ているだけ'));
  check('F2 見ているだけの人には「笑った！」が出ない', (await Y.page.$$('#stage .kh-laugh')).length === 0);
  check('F3 見ているだけの人は遊ぶ人に入らない', !(await L.roomOf(code)).game.players.includes('ユウ'));

  // ホストが切れたときのオーバーレイ
  H.offlineOk = true;
  await H.context.setOffline(true);
  check('G1 ホストが切れたことがルームに残る', await L.waitFor(async () => (await L.roomOf(code)).hostConnected === false, 120000));
  await L.waitVisible(N, '#hostOffOverlay', 10000);
  check('G2 参加者にオーバーレイが出る', true);
  await H.context.setOffline(false);
  check('G3 ホストがもどるとオーバーレイが消える', await L.waitFor(async () => !(await L.visible(N, '#hostOffOverlay')), 60000));

  // おしまい・順位（途中まで進んでいるので、残りを読む人が進める）
  while ((await L.text(N, '#stage .kh-next')).includes('つぎへ')) {
    const n = await L.lineCount(N);
    await L.clickText(N, '#stage', 'つぎへ');
    await N.page.waitForFunction((x) => document.querySelectorAll('#stage .kh-line').length === x, n + 1);
  }
  await L.clickText(N, '#stage', '読みおわった');
  await L.waitPhaseAll(all, 'result');
  await L.clickText(H, '#stage', 'ここでおしまいにする');
  await L.waitPhaseAll(all, 'end');
  const endText = await L.text(N, '#stage');
  check('H1 順位が出る（設定でオン）', endText.includes('「笑った！」をもらった数'));
  check('H2 もらった人だけ並ぶ（書くだけの人も入る・0回は出さない）', (await N.page.$$('.kh-rank__row')).length === 2 && !endText.includes('0回'));
  const first = await L.text(N, '.kh-rank__row');
  check('H3 いちばん上は いちばん多くもらった人', first.includes('ミオ') && first.includes('2回'), first);
  check('H4 名場面に、いちばんがない回もある', endText.includes('みんなの言葉で放送したよ'));
  await L.shot(N, 'h-end');
  await L.clickText(H, '#stage', '待合室にもどる');
  await L.waitPhaseAll(all, 'lobby');
  check('H5 もどっても「書くだけ」は残る', await HR.page.isChecked('#lobby-people .kh-noread input'));
  check('H6 もどっても端末のない人は残る', (await L.text(H, '#lobby-people')).includes('ミオ'));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
