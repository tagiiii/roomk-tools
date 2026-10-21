// ルームとランキング: 作成・参加・同時に遊ぶ・いちばんよい点数・再読み込み・お手本・コースの変更・
// はなれている人の点数は消さない・退出・進行役の切断と復帰・ルームを閉じる・おかしなリンク・期限切れのルーム
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();

  // 1. ルームを作る
  const host = await L.newClient('host');
  const code = await L.createRoom(host, 'ふつう', 'はやい');
  check('ルームコードは6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('DB: ルームの中身', room && room.status === 'open' && room.course === 'normal' && room.track === 'fast' && room.version === 1 && room.hostConnected === true, room);
  check('DB: 進行役は名前を持たない', !room.players);
  check('進行役の画面: コースと曲', (await L.text(host, '#pb-host-setting')) === 'ふつうコース／曲：はやい');
  check('だれもいないときは待っている', await L.visible(host, '#pb-host-empty'));
  check('利用回数: ルームを作った', (await L.stats(host, 'room-create')) === 1);
  await host.page.click('#btnCopyCode');
  check('コードをコピー: コードだけ', (await host.page.evaluate(() => navigator.clipboard.readText())) === code);
  await sleep(700);
  await host.page.click('#btnCopyLink');
  await sleep(300);
  const link = await host.page.evaluate(() => navigator.clipboard.readText());
  check('リンクをコピー', link === L.BASE + '?room=' + code, link);
  await host.page.screenshot({ path: L.OUT + '/r01-host-empty.png' });

  // 2. 参加する（リンクから・入力から・まちがい）
  const g1 = await L.newClient('g1');
  await L.open(g1, '?room=' + code);
  check('リンクから: 参加画面とヒント', (await L.screen(g1)) === 'pb-join' && await L.visible(g1, '#joinLinkHint'));
  check('リンクから: コードが入っている', (await g1.page.inputValue('#pb-join-code')) === code);
  await g1.page.click('#pb-join-go');
  check('名前なしでは入れない', /ニックネーム/.test(await L.text(g1, '#pb-join-error')));
  await g1.page.fill('#pb-join-name', 'あおい');
  await g1.page.click('#pb-join-go');
  await L.waitScreen(g1, 'pb-guest');
  check('入ったら ?room= が外れる', !/room=/.test(g1.page.url()), g1.page.url());
  await g1.page.waitForFunction(() => !document.getElementById('pb-guest-start').disabled);
  check('参加者にもコースと曲', (await L.text(g1, '#pb-guest-setting')) === 'ふつうコース／曲：はやい');
  check('はじめは まだ', (await L.text(g1, '#pb-guest-best')) === 'まだ');
  room = await L.roomOf(code);
  check('DB: 参加者と、つながっている印', room.players?.['あおい']?.uid && room.online?.['あおい']?.uid === room.players['あおい'].uid, room);
  check('利用回数: 参加した', (await L.stats(g1, 'room-join')) === 1);

  const g2 = await L.newClient('g2');
  await L.open(g2);
  await g2.page.click('#pb-go-join');
  check('トップから: ヒントは出ない', !(await L.visible(g2, '#joinLinkHint')));
  await g2.page.fill('#pb-join-name', 'あおい');
  await g2.page.fill('#pb-join-code', code.toLowerCase().replace(/[a-z0-9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0xFEE0)));
  await g2.page.click('#pb-join-go');
  await g2.page.waitForSelector('#pb-join-error:not([hidden])');
  check('同じ名前は入れない', /もうルームにいる/.test(await L.text(g2, '#pb-join-error')));
  await g2.page.fill('#pb-join-name', 'そら');
  await g2.page.click('#pb-join-go');
  await L.waitScreen(g2, 'pb-guest');
  check('全角・小文字のコードでも入れる', true);

  const g3 = await L.newClient('g3');
  await L.open(g3);
  await g3.page.click('#pb-go-join');
  await g3.page.fill('#pb-join-name', 'りく');
  await g3.page.fill('#pb-join-code', 'ZZZZZZ');
  await g3.page.click('#pb-join-go');
  await g3.page.waitForSelector('#pb-join-error:not([hidden])');
  check('ないルームには入れない', /見つからなかった/.test(await L.text(g3, '#pb-join-error')));
  await g3.page.fill('#pb-join-code', 'あいう');
  await g3.page.click('#pb-join-go');
  check('ひらがなのときは英字への切りかえを案内', /英字に切り替え/.test(await L.text(g3, '#pb-join-error')));
  await g3.page.fill('#pb-join-name', 'a.b');
  await g3.page.fill('#pb-join-code', code);
  await g3.page.click('#pb-join-go');
  check('使えない記号の名前は入れない', /使えない/.test(await L.text(g3, '#pb-join-error')));
  await g3.page.fill('#pb-join-name', 'りく');
  await g3.page.click('#pb-join-go');
  await L.waitScreen(g3, 'pb-guest');
  await host.page.waitForFunction(() => document.querySelectorAll('#pb-host-ranking .pb-rank').length === 3);
  check('3人入った', !(await L.visible(host, '#pb-host-empty')));

  // 3. あおい は全部ぴったり、そら は少しずらす（同時に遊ぶ）
  await g1.page.click('#pb-guest-start');
  await g2.page.click('#pb-guest-start');
  await Promise.all([L.waitPlaying(g1), L.waitPlaying(g2)]);
  await host.page.waitForFunction(() => [...document.querySelectorAll('#pb-host-ranking .pb-rank__tag')].filter((e) => e.textContent === 'あそんでいる').length === 2, null, { timeout: 8000 }).catch(() => {});
  check('遊んでいる人がわかる', (await L.rankingRows(host, '#pb-host-ranking')).filter((x) => x.tag === 'あそんでいる').length === 2);
  room = await L.roomOf(code);
  check('DB: 遊んでいる印', room.online?.['あおい']?.playing === true && room.online?.['そら']?.playing === true, room.online);
  check('曲のファイルが鳴る', await g1.page.evaluate(() => window.__pb.music()));
  const total = await g1.page.evaluate(() => window.__pb.notes().length);
  await Promise.all([L.autoplay(g1), L.autoplay(g2, 'return i % 2 ? 0.1 : 0;')]);
  await Promise.all([L.waitResult(g1), L.waitResult(g2)]);
  const r1 = await L.results(g1);
  const r2 = await L.results(g2);
  check('あおい: 最高点', r1.score === total * 100, r1);
  check('参加者: ランキングに送ったと出る', /ランキングに送った/.test(r1.note), r1.note);
  check('そら: あおいより低い', r2.score < r1.score && r2.score > 0, r2);
  room = await L.roomWhen(code, (x) => x.players['あおい'].best === total * 100 && x.players['そら'].best === r2.score);
  check('DB: いちばんの点と版', room.players['あおい'].best === total * 100 && room.players['あおい'].v === 1 && room.players['そら'].best === r2.score, room.players);
  check('DB: 遊びおわると印が消える', !room.online['あおい'].playing && !room.online['そら'].playing, room.online);
  await host.page.waitForFunction((s) => document.querySelector('#pb-host-ranking .pb-rank__pts')?.textContent === s + '点', total * 100, { timeout: 8000 });
  let rows = await L.rankingRows(host, '#pb-host-ranking');
  check('ランキング1位', rows[0].no === '1位' && rows[0].name === 'あおい' && rows[0].pts === total * 100 + '点', rows);
  check('ランキング2位', rows[1].no === '2位' && rows[1].name === 'そら' && rows[1].pts === r2.score + '点', rows);
  check('まだ遊んでいない人は後ろ', rows[2].no === '―' && rows[2].name === 'りく' && rows[2].pts === 'まだ', rows);
  check('利用回数: 曲ごとに数える', (await L.stats(g1, 'play-fast')) === 1);
  await host.page.screenshot({ path: L.OUT + '/r02-host-ranking.png' });
  await g1.page.click('#pb-back');
  check('参加者: もどると参加者の画面', (await L.screen(g1)) === 'pb-guest');
  check('参加者: 自分のいちばん', (await L.text(g1, '#pb-guest-best')) === total * 100 + '点');
  check('参加者: 自分の順位', /1位/.test(await L.text(g1, '#pb-guest-rank')));
  check('参加者のランキングで自分がわかる', (await L.rankingRows(g1, '#pb-guest-ranking')).find((x) => x.me)?.name === 'あおい');
  await g1.page.screenshot({ path: L.OUT + '/r03-guest.png' });

  // 4. あおい は何も押さずに最後まで → いちばんは変わらない
  await g1.page.click('#pb-guest-start');
  await L.waitPlaying(g1);
  await L.waitResult(g1);
  const r1b = await L.results(g1);
  check('低い点のときは、いちばんがのっていると出る', r1b.score === 0 && /いちばんよい点数/.test(r1b.note), r1b);
  await sleep(800);
  room = await L.roomOf(code);
  check('DB: 低い点では、いちばんは変わらない', room.players['あおい'].best === total * 100, room.players['あおい']);

  // 5. 読み込みなおし（参加者・進行役）
  await L.reload(g1);
  await L.waitScreen(g1, 'pb-guest', 8000);
  await g1.page.waitForFunction(() => !document.getElementById('pb-guest-start').disabled);
  check('参加者が読み込みなおしても、いちばんはそのまま', (await L.text(g1, '#pb-guest-best')) === total * 100 + '点');
  await L.reload(host);
  await L.waitScreen(host, 'pb-host', 8000);
  await host.page.waitForFunction(() => document.querySelectorAll('#pb-host-ranking .pb-rank').length === 3);
  rows = await L.rankingRows(host, '#pb-host-ranking');
  check('進行役が読み込みなおしても、ランキングはそのまま', rows.length === 3 && rows[0].name === 'あおい', rows);
  room = await L.roomWhen(code, (x) => x.hostConnected === true);
  check('DB: 読み込みなおしたあとも進行役はつながっている', room.hostConnected === true, room.hostConnected);

  // 6. お手本（ランキングに入らない）
  await host.page.click('#pb-host-demo');
  await L.waitPlaying(host);
  await host.page.click('#pb-pause');
  await host.page.click('#pb-quit');
  check('お手本をやめると、ランキングの画面', (await L.screen(host)) === 'pb-host');
  check('お手本はランキングに入らない', (await L.rankingRows(host, '#pb-host-ranking')).length === 3);

  // 7. そら が遊んでいる途中で、コースと曲を変える。りく は新しいコースで遊ぶ
  await g2.page.click('#pb-back');
  await g2.page.click('#pb-guest-start');
  await L.waitPlaying(g2);
  await host.page.click('#pb-host-change-open');
  await L.pick(host, '#pb-change-courses', 'やさしい');
  await host.page.click('#pb-change-ok');
  room = await L.roomWhen(code, (x) => x.version === 2);
  check('DB: 版が上がる', room.version === 2 && room.course === 'easy' && room.track === 'fast', room);
  check('DB: 前の点数は残っているが版が古い', room.players['あおい'].v === 1, room.players['あおい']);
  await host.page.waitForFunction(() => document.getElementById('pb-host-setting').textContent.startsWith('やさしい'));
  rows = await L.rankingRows(host, '#pb-host-ranking');
  check('コースを変えると、点数は消える（表示）', rows.every((x) => x.pts === 'まだ'), rows);
  await g1.page.waitForFunction(() => document.getElementById('pb-guest-setting').textContent.startsWith('やさしい'));
  check('参加者の画面も新しいコースに', (await L.text(g1, '#pb-guest-best')) === 'まだ');
  await g3.page.click('#pb-guest-start');
  await L.waitPlaying(g3);
  const total3 = await g3.page.evaluate(() => window.__pb.notes().length);
  await Promise.all([L.autoplay(g2), L.autoplay(g3)]);
  await Promise.all([L.waitResult(g2), L.waitResult(g3)]);
  check('途中で変わった回は、のらないと出る', /とちゅうでコースが変わった/.test((await L.results(g2)).note));
  check('りく: 新しいコースで最高点', (await L.results(g3)).score === total3 * 100);
  room = await L.roomWhen(code, (x) => x.players['りく'].best === total3 * 100);
  check('DB: 途中で変わった回は書かない', room.players['そら'].v === 1, room.players['そら']);
  check('DB: りく は新しい版で', room.players['りく'].v === 2 && room.players['りく'].best === total3 * 100, room.players['りく']);
  await sleep(500);
  rows = await L.rankingRows(host, '#pb-host-ranking');
  check('新しいコースのランキング', rows[0].name === 'りく' && rows[0].no === '1位' && rows.slice(1).every((x) => x.pts === 'まだ'), rows);

  // 8. りく のブラウザを閉じる → はなれている（点数は消さない）
  await g3.page.close();
  room = await L.roomWhen(code, (x) => !x.online?.['りく'], 90000);
  check('DB: 閉じた人の、つながっている印が消える', !room.online?.['りく'], room.online);
  check('DB: 閉じた人の点数は消えない', room.players?.['りく']?.best === total3 * 100, room.players?.['りく']);
  await host.page.waitForFunction(() => [...document.querySelectorAll('#pb-host-ranking .pb-rank')].some((li) => li.classList.contains('is-away')), null, { timeout: 8000 });
  rows = await L.rankingRows(host, '#pb-host-ranking');
  const riku = rows.find((x) => x.name === 'りく');
  check('進行役の画面: はなれている・点数はそのまま', riku && riku.away && riku.tag === 'はなれている' && riku.pts === total3 * 100 + '点' && riku.no === '1位', rows);
  await host.page.screenshot({ path: L.OUT + '/r04-host-away.png' });
  // 同じブラウザでもう一度入る（同じ名前・同じ端末なので入りなおし）
  const g3b = await L.newPage(g3.context, 'g3b');
  await L.open(g3b);
  await g3b.page.click('#pb-go-join');
  await g3b.page.fill('#pb-join-name', 'りく');
  await g3b.page.fill('#pb-join-code', code);
  await g3b.page.click('#pb-join-go');
  await L.waitScreen(g3b, 'pb-guest');
  await g3b.page.waitForFunction(() => !document.getElementById('pb-guest-start').disabled);
  check('同じ端末なら、同じ名前で入りなおせて点数もそのまま', (await L.text(g3b, '#pb-guest-best')) === total3 * 100 + '点');
  await host.page.waitForFunction(() => ![...document.querySelectorAll('#pb-host-ranking .pb-rank')].some((li) => li.classList.contains('is-away')), null, { timeout: 8000 });
  check('入りなおすと、はなれている が消える', true);

  // 9. 退出する → ランキングから消える
  await g2.page.click('#pb-back');
  await g2.page.click('#pb-guest-leave');
  await L.waitScreen(g2, 'pb-top');
  check('退出すると、はじめの画面', true);
  room = await L.roomWhen(code, (x) => !x.players?.['そら']);
  check('DB: 退出した人は消える', !room.players?.['そら'] && !room.online?.['そら'], room);
  await host.page.waitForFunction(() => ![...document.querySelectorAll('#pb-host-ranking .pb-rank__name')].some((e) => e.textContent === 'そら'));
  check('退出した人はランキングから消える', true);

  // 10. 進行役の通信が切れる → 参加者に知らせる（遊ぶことはできる）→ もどる
  host.offlineOk = true;
  await host.context.setOffline(true);
  room = await L.roomWhen(code, (x) => x.hostConnected === false, 95000);
  check('DB: 進行役が切れた', room.hostConnected === false, room.hostConnected);
  await g1.page.waitForSelector('#pb-guest-offline:not([hidden])', { timeout: 8000 });
  check('参加者に「つながっていない」と出る', await L.visible(g1, '#pb-guest-offline'));
  check('進行役が切れても、はじめるは押せる', !(await g1.page.isDisabled('#pb-guest-start')));
  await host.context.setOffline(false);
  room = await L.roomWhen(code, (x) => x.hostConnected === true, 30000);
  check('DB: 進行役がもどる', room.hostConnected === true, room.hostConnected);
  await g1.page.waitForSelector('#pb-guest-offline', { state: 'hidden', timeout: 8000 });
  check('もどると知らせが消える', !(await L.visible(g1, '#pb-guest-offline')));
  host.offlineOk = false;

  // 11. ルームを閉じる
  await host.page.click('#pb-host-close');
  await L.waitScreen(host, 'pb-top');
  check('閉じると、はじめの画面', true);
  room = await L.roomWhen(code, (x) => x === null);
  check('DB: ルームが消える', room === null, room);
  await L.waitScreen(g1, 'pb-top');
  await L.waitToast(g1, '閉じられた');
  check('参加者に、閉じられたと出る', true);
  await L.reload(g1);
  check('閉じたあとに読み込みなおしても、はじめの画面', (await L.screen(g1)) === 'pb-top');
  await sleep(1500);
  check('DB: 閉じたあと、ルームは作り直されない', (await L.roomOf(code)) === null);

  // 12. おかしなリンク・期限切れのルーム
  const g4 = await L.newClient('g4');
  await L.open(g4, '?room=xx');
  check('おかしなリンクは、はじめの画面', (await L.screen(g4)) === 'pb-top');
  await L.waitToast(g4, '正しくない');
  check('おかしなリンクの ?room= は外す', !/room=/.test(g4.page.url()));
  const old = 'QQQQQ2';
  await L.rest('PUT', L.ROOMS + '/' + old, { status: 'open', hostUid: 'x', hostConnected: false, hostDisconnectedAt: Date.now() - 10 * 60 * 1000, createdAt: Date.now() - 20 * 60 * 1000, course: 'easy', track: 'mid', version: 1 });
  await g4.page.click('#pb-go-join');
  await g4.page.fill('#pb-join-name', 'うみ');
  await g4.page.fill('#pb-join-code', old);
  await g4.page.click('#pb-join-go');
  await g4.page.waitForSelector('#pb-join-error:not([hidden])');
  check('期限切れのルームには入れない', /終わったみたい/.test(await L.text(g4, '#pb-join-error')));
  check('DB: 期限切れのルームは消す', (await L.roomWhen(old, (x) => x === null)) === null);

  // 13. 幅 375px でもランキングの画面と参加者の画面がはみ出さない
  const m = await L.newClient('mobile', { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const mcode = await L.createRoom(m, 'やさしい', 'ゆっくり');
  check('375px: ランキングの画面がはみ出さない', (await L.overflow(m)) <= 0);
  const mg = await L.newClient('mobile-guest', { viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await L.joinRoom(mg, 'はなこ', mcode);
  check('375px: 参加者の画面がはみ出さない', (await L.overflow(mg)) <= 0);
  await mg.page.screenshot({ path: L.OUT + '/r05-mobile-guest.png' });

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
