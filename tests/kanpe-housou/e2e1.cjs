// カンペ放送局 E2E その1: ホストも遊ぶ5人。作成・参加・同じ名前・みんなにみせる画面・書く（描きなおしても消えない・変換中・
// 書きなおし・おまかせ）・読む・「笑った！」・結果・待たずに読む・おまかせに替える・おしまい・もう一回・幅 375px・待合室へ・退出・ルームを閉じる
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const names = ['メンター', 'アキラ', 'ソラ', 'リク', 'ハナ'];
  const C = {};
  C[names[0]] = await L.newClient('host');
  const code = await L.createRoom(C[names[0]], names[0]);
  check('A1 ルームコード6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('A2 room-create を数えた', await L.waitStats(C[names[0]], 'room-create', 1));
  for (const nm of names.slice(1)) {
    C[nm] = await L.newClient(nm);
    await L.joinRoom(C[nm], nm, code);
  }
  const H = C['メンター'];
  const K = C['アキラ'];
  const S2 = C['ソラ'];
  const RK = C['リク'];
  const HN = C['ハナ'];
  const all = names.map((n) => C[n]);
  check('A3 ホストの待合室に5人', await L.waitFor(async () => (await H.page.$$('#lobby-people li')).length === 5));
  check('A4 参加用のリンクのコードはアドレスから外れる', !K.page.url().includes('room='));
  check('A5 遊ぶ人5人と出る', (await L.text(H, '#lobby-count')).includes('遊ぶ人 5人'));
  check('A6 参加者には設定が見るだけで出る', await L.visible(S2, '#lobby-opts-view') && !(await L.visible(S2, '#lobby-opts')));
  check('A7 参加者には端末なしを足す欄が出ない', !(await L.visible(S2, '#nodev-form')));
  check('A8 参加者には自分の「書くだけ」だけ出る', (await S2.page.$$('#lobby-people .kh-noread')).length === 1);
  check('A9 ホストにはみんなの「書くだけ」が出る', (await H.page.$$('#lobby-people .kh-noread')).length === 5);

  // 同じ名前・数字だけの名前は入れない
  const dup = await L.newClient('dup');
  await L.open(dup, '?room=' + code);
  await L.waitScreen(dup, 'join');
  await dup.page.fill('#guestName', '12');
  await dup.page.click('#btnJoinRoom');
  await L.waitText(dup, '#joinError', '数字だけ');
  check('A10 数字だけの名前は使えない', true);
  await dup.page.fill('#guestName', 'ソラ');
  await dup.page.click('#btnJoinRoom');
  await L.waitText(dup, '#joinError', 'その名前は使われている');
  check('A11 同じ名前は入れない', true);
  await dup.context.close();

  // みんなにみせる画面
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 860 } });
  await L.open(W, '?watch=' + code);
  await L.waitPhase(W, 'lobby');
  check('A12 みんなにみせる画面に参加のしかた', (await L.text(W, '#lobby-join-code')).includes(code));
  check('A13 みんなにみせる画面は参加者に入らない', Object.keys((await L.roomOf(code)).players).length === 5);
  check('A14 みんなにみせる画面には「書くだけ」の欄がない', (await W.page.$$('#lobby-people .kh-noread')).length === 0);
  await L.shot(H, 'a-lobby');

  // ── 1本目 ──
  await H.page.click('#btn-start');
  await L.waitPhaseAll(all.concat(W), 'write');
  check('B1 start を数えた', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-5', 1));
  check('B2 はじめに読むのはホスト（入った順）', (await L.readerOf(H)) === 'メンター', await L.readerOf(H));
  check('B3 読む人には書く欄が出ない', (await H.page.$$('#stage .kh-hint__input')).length === 0);
  check('B4 読む人に原稿はまだ見えない', (await H.page.$$('#stage .kh-script')).length === 0);
  for (const nm of ['アキラ', 'ソラ', 'リク', 'ハナ']) check('B5 書く人には空らんが1つずつ ' + nm, (await C[nm].page.$$('#stage .kh-hint__input')).length === 1);
  check('B6 みんなにみせる画面には書く欄も原稿も出ない', (await W.page.$$('#stage .kh-hint__input, #stage .kh-script')).length === 0);
  check('B7 空らんは4つ（書く人4人）', (await L.roomOf(code)).game.k === 4);
  await L.shot(K, 'b-write');

  // 書いている途中で、ほかの人が出しても、入れている言葉と場所が消えない
  await K.page.fill('#stage .kh-hint__input', 'とちゅう');
  await K.page.focus('#stage .kh-hint__input');
  await L.writeAll(S2, 'プリンアラモード');
  await L.waitText(H, '#players', '出した');
  await sleep(300);
  check('B8 ほかの人が出しても、書いている言葉が残る', (await K.page.inputValue('#stage .kh-hint__input')) === 'とちゅう');
  check('B9 入力欄から外れない', await K.page.evaluate(() => document.activeElement && document.activeElement.classList.contains('kh-hint__input')));

  // 日本語の変換中は描きなおさない
  const soraRow = () => K.page.$eval('#players', (ul) => [...ul.children].find((li) => li.textContent.includes('ソラ'))?.textContent || '');
  await K.page.evaluate(() => { const i = document.querySelector('#stage .kh-hint__input'); i.__mark = 1; i.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
  await L.clickText(S2, '#stage', '書きなおす');
  check('B10 書きなおすと、出したのが取り消される', await L.waitFor(async () => !(await L.roomOf(code)).game.submitted?.['ソラ']));
  await sleep(400);
  check('B11 変換中は入力欄を作りなおさない', await K.page.evaluate(() => document.querySelector('#stage .kh-hint__input').__mark === 1));
  check('B12a 変換中は、ほかの部分も描きなおさない', (await soraRow()).includes('出した'));
  await K.page.evaluate(() => document.querySelector('#stage .kh-hint__input').dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await sleep(200);
  check('B12 変換が終わったら、ほかの部分を描きなおす', await L.waitFor(async () => (await soraRow()).includes('書いている')));
  check('B12b 自分の欄が変わらないうちは、入力欄を作りなおさない（キーボードが閉じない）', await K.page.evaluate(() => document.querySelector('#stage .kh-hint__input').__mark === 1));
  check('B13 描きなおしても言葉は残る', (await K.page.inputValue('#stage .kh-hint__input')) === 'とちゅう');

  // 書きなおし→出しなおし
  check('B14 書きなおすとき、前の言葉が入っている', (await S2.page.inputValue('#stage .kh-hint__input')) === 'プリンアラモード');
  await L.clickText(S2, '#stage', '出す');
  await L.waitFor(async () => (await L.roomOf(code)).game.submitted?.['ソラ']);

  // からっぽでは出せない・おまかせ
  await K.page.fill('#stage .kh-hint__input', '');
  await L.clickText(K, '#stage', '出す');
  await L.waitToast(K, 'ぜんぶの空らん');
  check('B15 からっぽで出すと知らせる', true);
  check('B16 からっぽでは出ない', !(await L.roomOf(code)).game.submitted?.['アキラ']);
  await L.clickText(K, '#stage', 'おまかせ');
  const om = await K.page.inputValue('#stage .kh-hint__input');
  check('B17 おまかせで言葉が入る', om.length > 0, om);
  // おまかせの言葉がほかの人の言葉と同じになると、あとの「笑った！」の行を取りちがえるので、決まった言葉にする
  await K.page.fill('#stage .kh-hint__input', 'ヒミツキチ');
  await L.clickText(K, '#stage', '出す');
  await L.writeAll(RK, 'ズンドコ');
  await sleep(300);
  check('B18 まだの人がいれば書く段階のまま', (await L.phaseOf(H)) === 'write');
  await L.writeAll(HN, 'カピバラ');
  await L.waitPhaseAll(all.concat(W), 'read');
  check('B19 みんな出したら読む段階へ', true);
  check('B20 読む前の言葉は、ほかの人の画面に入っていない', !(await K.page.content()).includes('ズンドコ') && !(await W.page.content()).includes('ズンドコ'));

  // 読む
  await L.clickText(H, '#stage', '読みはじめる');
  await K.page.waitForFunction(() => document.querySelectorAll('#stage .kh-line').length === 1);
  check('C1 書き出しの行には言葉がない', (await L.words(K)).length === 0);
  for (let n = 1; n <= 4; n += 1) {
    await L.clickText(H, '#stage', 'つぎへ');
    await K.page.waitForFunction((x) => document.querySelectorAll('#stage .kh-word').length === x, n);
    check('C2 つぎへで言葉が1つずつ出る ' + n, (await L.words(K)).length === n);
    check('C3 みんなにみせる画面にも出る ' + n, await L.waitFor(async () => (await W.page.$$('#stage .kh-word')).length === n));
    check('C4 新しく出た行だけ動く ' + n, (await H.page.$$('#stage .kh-line.is-new')).length === 1);
  }
  check('C5 読んでいるあいだは判定のボタンが出ない', (await K.page.$$('#stage .kh-choice')).length === 0);
  check('C6 聞いている人には「よく聞いていてね」', (await L.text(K, '#game-sub')).includes('読む人が笑うかどうか'));
  await L.shot(W, 'c-watch-read');
  await L.clickText(H, '#stage', 'つぎへ');
  await H.page.waitForFunction(() => document.querySelectorAll('#stage .kh-line').length === 6);
  check('C7 締めの行のあとは「読みおわった」', (await L.text(H, '#stage .kh-next')).includes('読みおわった'));
  check('C8 読む人のほかに「つぎへ」は出ない', (await K.page.$$('#stage .kh-next')).length === 0);
  await L.shot(H, 'c-read');
  await L.clickText(H, '#stage', '読みおわった');
  await L.waitPhaseAll(all.concat(W), 'judge');

  // 判定: 読む人のほかのみんなが、いっせいに出す
  check('J1 読みおわったら判定へ', true);
  check('J2 読む人には判定のボタンが出ない', (await H.page.$$('#stage .kh-choice')).length === 0);
  check('J3 聞いていた人には2つのボタン', (await K.page.$$('#stage .kh-choice')).length === 2);
  check('J4 みんなにみせる画面には判定のボタンが出ない', (await W.page.$$('#stage .kh-choice')).length === 0);
  check('J5 判定のときは原稿をぜんぶ見られる', (await L.words(K)).length === 4);
  await L.shot(K, 'j-judge');
  await L.clickText(K, '#stage', '笑わずに読めた');
  await L.clickText(S2, '#stage', '笑わずに読めた');
  await L.clickText(RK, '#stage', '笑った');
  check('J6 出した人は待つ画面になる', await L.waitFor(async () => (await L.text(K, '#game-status')).includes('出したよ')));
  check('J7 まだの人がいれば判定のまま', (await L.phaseOf(H)) === 'judge');
  check('J8 だれが何を出したかは、みんなにみせる画面にもほかの人の画面にも出ない', !(await L.text(W, '#ph-game')).includes('笑った') && !(await L.text(K, '#ph-game')).includes('笑った'));
  check('J9 出したかどうかは札でわかる', (await L.text(H, '#players')).includes('出した') && (await L.text(H, '#players')).includes('考えている'));
  await L.clickText(HN, '#stage', '笑わずに読めた');
  await L.waitPhaseAll(all.concat(W), 'result');
  check('D1 みんな出したら結果へ', true);
  check('D2 半分より多くが読めたなら「読みきった」', (await L.text(K, '#game-status')).includes('メンター は、笑わずに読みきった！'));
  check('D3 だれが書いたかが出る', (await L.text(K, '#stage')).includes('ソラ が書いた'));
  check('D4 判定の数は出さない', !/[0-9]+人|[0-9]+票/.test(await L.text(K, '#stage')));
  check('D5 参加者に「ホストだけ」は出ない', !(await L.visible(K, '#tools')));
  const r1 = await L.roomOf(code);
  check('D6 読みきった読む人に1点', r1.game.points?.['メンター'] === 1 && Object.keys(r1.game.points).length === 1, r1.game.points);
  await L.shot(K, 'd-result');

  // ── 2本目: 読むのはアキラ。ホストが届いた言葉をたしかめて替える→待たずに読む ──
  await L.clickText(H, '#stage', 'つぎの番組へ');
  await L.waitPhaseAll(all, 'write');
  check('E1 2本目に読むのは次の人', (await L.readerOf(H)) === 'アキラ', await L.readerOf(H));
  await L.writeAll(H, 'へんなことば');
  await L.clickText(H, '#tools', '届いた言葉をたしかめる');
  await L.waitText(H, '#tools', 'へんなことば');
  check('E2 ホストは届いた言葉を見られる', true);
  check('E3 参加者には届いた言葉は出ない', !(await K.page.content()).includes('へんなことば'));
  await L.clickText(H, '#tools', 'おまかせに替える');
  check('E4 おまかせに替えられる', await L.waitFor(async () => !(await L.text(H, '#tools')).includes('へんなことば')));
  check('E4b 替えられた人は書きなおせない', await L.waitFor(async () => (await L.text(H, '#stage')).includes('ホストが、おまかせの言葉に替えたよ') && !(await L.text(H, '#stage')).includes('書きなおす')));
  await L.clickText(H, '#tools', 'まだの人を待たずに読みはじめる');
  await L.waitPhaseAll(all, 'read');
  check('E5 待たずに読みはじめられる', true);
  await L.readThrough(K, 4);
  await L.clickText(K, '#stage', '読みおわった');
  await L.waitPhaseAll(all, 'judge');
  await L.clickText(H, '#stage', '笑った');
  await L.clickText(S2, '#stage', '笑った');
  await L.clickText(RK, '#stage', '笑わずに読めた');
  await L.clickText(HN, '#stage', '笑った');
  await L.waitPhaseAll(all, 'result');
  check('E6 笑ったが多ければ「笑っちゃった」', (await L.text(S2, '#game-status')).includes('アキラ は、笑っちゃった！'));
  check('E7 おまかせの言葉とわかる', (await L.text(S2, '#stage')).includes('おまかせの言葉'));
  const r2 = await L.roomOf(code);
  check('E8 おまかせの言葉しかない回は、だれにも点が入らない', JSON.stringify(r2.game.points) === JSON.stringify({ 'メンター': 1 }), r2.game.points);

  // ここでおしまい
  await L.clickText(H, '#stage', 'ここでおしまいにする');
  await L.waitPhaseAll(all.concat(W), 'end');
  check('F1 finish を数えた', await L.waitStats(H, 'finish', 1));
  check('F2 きょうの放送が出る', (await L.text(K, '#stage')).includes('きょうの放送'));
  check('F3 1本目は読みきった・2本目は笑っちゃった', (await L.text(K, '#stage')).includes('笑わずに読みきった！') && (await L.text(K, '#stage')).includes('笑っちゃった！'));
  check('F4 書かれた言葉がふりかえりに出る', (await L.text(K, '#stage')).includes('プリンアラモード'));
  check('F5 順位は出さない（はじめの設定）', !(await L.text(K, '#stage')).includes('点数'));
  await L.shot(K, 'f-end');

  // もう一回
  await L.clickText(H, '#stage', 'もう一回');
  await L.waitPhaseAll(all, 'write');
  check('G1 もう一回で書く段階から', true);
  check('G2 新しいゲーム', Number((await L.roomOf(code)).game.gid) === 2 && await L.waitStats(H, 'start', 2));
  // 幅 375px
  await K.page.setViewportSize({ width: 375, height: 760 });
  await sleep(200);
  check('G3 375px: 書く画面で横にはみ出さない', (await L.overflow(K)) <= 0, await L.overflow(K));
  await L.shot(K, 'g-375-write');
  // みんなが出したあとも、読みはじめる前なら書きなおせる（書く段階にもどる）
  await L.writeAll(K, 'アオゾラ');
  await L.writeAll(S2, 'イルカ');
  await L.writeAll(RK, 'ウキワ');
  await L.writeAll(HN, 'エンピツ');
  await L.waitPhaseAll(all, 'read');
  check('G4 読みはじめる前は、出した言葉と「書きなおす」が出る', await L.waitFor(async () => (await L.text(K, '#stage')).includes('書きなおす')));
  check('G5 読みはじめる前は、ホストが届いた言葉をたしかめられる', (await L.text(H, '#tools')).includes('届いた言葉を'));
  await L.clickText(K, '#stage', '書きなおす');
  await L.waitPhaseAll(all, 'write');
  check('G6 書きなおすと書く段階にもどる', true);
  await L.writeAll(K, 'アオゾラ');
  await L.waitPhaseAll(all, 'read');
  const k2 = (await L.roomOf(code)).game.k;
  await L.readThrough(H, k2);
  check('G7 375px: 読む画面で横にはみ出さない', (await L.overflow(K)) <= 0, await L.overflow(K));
  check('G8 読みはじめたら書きなおせない', !(await L.text(K, '#stage')).includes('書きなおす'));
  await L.shot(K, 'g-375-read');
  await L.clickText(H, '#stage', '読みおわった');
  await L.waitPhaseAll(all, 'judge');
  check('G8b 375px: 判定の画面で横にはみ出さない', (await L.overflow(K)) <= 0, await L.overflow(K));
  await L.shot(K, 'g-375-judge');
  for (const c of [K, S2, RK, HN]) await L.clickText(c, '#stage', '笑わずに読めた');
  await L.waitPhaseAll(all, 'result');
  check('G9 375px: 結果の画面で横にはみ出さない', (await L.overflow(K)) <= 0, await L.overflow(K));
  // 途中で待合室にもどる
  await L.clickText(H, '#tools', '放送をやめて待合室にもどる');
  await L.waitPhaseAll(all, 'lobby');
  check('G10 放送の途中でも待合室にもどれる（ゲームは消える）', !(await L.roomOf(code)).game);
  check('G11 375px: 待合室で横にはみ出さない', (await L.overflow(K)) <= 0, await L.overflow(K));

  // 退出・ルームを閉じる
  await HN.page.click('#btnLeave');
  await L.waitScreen(HN, 'top');
  check('H1 退出するとトップへ', true);
  check('H2 退出した人の在室が消える', await L.waitFor(async () => !(await L.roomOf(code)).players?.['ハナ']));
  await H.page.click('#btnLeave');
  await L.waitScreen(K, 'top');
  check('H3 ルームを閉じると参加者もトップへ', true);
  check('H4 ルームが消える', await L.waitFor(async () => (await L.roomOf(code)) === null));
  await L.waitScreen(W, 'watch-end');
  check('H5 みんなにみせる画面は「閉じられました」', true);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
