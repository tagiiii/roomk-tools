// そろってゴール E2E その2: 同時に動かしたときの食いちがいのなさ・ホストが切れている間は動かせない・
// 名前の検査・12人のステージ・13人目は入れない
const L = require('./lib.cjs');
const { check, sleep, waitFor } = L;

// 画面のコマの場所を、席の番号の順に
const allPos = (c) => c.page.$$eval('.sg-piece--player', (ps) => ps
  .sort((a, b) => Number(a.dataset.seat) - Number(b.dataset.seat))
  .map((p) => p.style.getPropertyValue('--x') + ',' + p.style.getPropertyValue('--y')).join(' '));

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1280, height: 800 } });
  const A = await L.newClient('guestA', { viewport: { width: 1100, height: 800 } });
  const B = await L.newClient('guestB', { viewport: { width: 1100, height: 800 } });
  const code = await L.createRoom(H, 'ほすと');

  // ── A. 名前の検査 ──
  await L.open(A, '?room=' + code);
  await L.waitScreen(A, 'join');
  check('A1 リンクから開くと、コードが入っていて案内が出る', (await A.page.$eval('#joinCode', (i) => i.value)) === code && await L.visible(A, '#joinLinkHint'));
  await A.page.click('#btnJoinRoom');
  check('A2 名前が空だと入れない', (await L.text(A, '#joinError')).includes('名前を入れてね'));
  await A.page.fill('#guestName', 'あ.い');
  await A.page.click('#btnJoinRoom');
  check('A3 使えない記号は、理由を出して断る', (await L.text(A, '#joinError')).includes('. # $ [ ] /'));
  await A.page.fill('#guestName', 'ほすと');
  await A.page.click('#btnJoinRoom');
  check('A4 同じ名前は使えない', await waitFor(async () => (await L.text(A, '#joinError')).includes('使われている')));
  await A.page.fill('#guestName', 'あおい');
  await A.page.click('#btnJoinRoom');
  await L.waitScreen(A, 'waiting');
  check('A5 つないだあと、アドレスからコードが外れる', !(await A.page.evaluate(() => location.search)));
  await L.joinRoom(B, 'みどり', code);

  // ── B. 同時に動かす ──
  await waitFor(async () => !(await H.page.$eval('#btnStartGame', (b) => b.disabled)));
  await H.page.click('#btnStartGame');
  for (const c of [H, A, B]) await L.waitScreen(c, 'game');
  // 3人が同時に、でたらめな向きへ40回ずつ押す
  const mash = (c, seed) => c.page.evaluate(async (s) => {
    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    let x = s;
    for (let i = 0; i < 40; i += 1) {
      // 小さい数の範囲でくじを引く（大きい数のかけ算は桁があふれて、同じ向きばかりになる）
      x = (x * 75 + 74) % 65537;
      const key = keys[x % 4];
      document.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 15));
    }
  }, seed);
  await Promise.all([mash(H, 11), mash(A, 22), mash(B, 33)]);
  await sleep(1500);
  const G = await L.gameOf(code);
  check('B1 サーバーの値が読める', !!G, (await L.roomOf(code)).game);
  const cells = G.S.players.map((p) => p.x + ',' + p.y);
  check('B2 同じマスに2人いない', new Set(cells).size === cells.length, cells);
  check('B3 かべの中にいない', G.S.players.every((p) => L.E.tileAt(G.S, p.x, p.y) !== '#'));
  // 押した数は120。かべ・人に当たる向きは書かないので、進むのはその一部。同時に押しても、進める1歩は捨てない
  check('B4 同時に押しても進む（30歩より多い）', G.S.rev > 30, G.S.rev);
  const want = cells.join(' ');
  check('B5 どの画面も、サーバーと同じ場所になる', await waitFor(async () => (await allPos(H)) === want && (await allPos(A)) === want && (await allPos(B)) === want), [want, await allPos(H), await allPos(A), await allPos(B)]);

  // ── C. ホストが切れている間は動かせない ──
  H.offlineOk = true;
  await H.context.setOffline(true);
  check('C1 ホストの切断に気づく', !!(await L.roomWhen(code, (r) => r.hostConnected === false, 100000)));
  check('C2 参加者の画面に「ホストの戻りを待っています」', await waitFor(async () => L.visible(A, '#hostOffOverlay')));
  const rev = (await L.gameOf(code)).S.rev;
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await A.page.keyboard.press(key);
  await sleep(600);
  check('C3 その間は1歩も書かない', (await L.gameOf(code)).S.rev === rev);
  await H.context.setOffline(false);
  check('C4 ホストが戻ると、切断の印が消える', !!(await L.roomWhen(code, (r) => r.hostConnected === true, 30000)));
  check('C5 参加者のオーバーレイが消える', await waitFor(async () => !(await L.visible(A, '#hostOffOverlay'))));
  const s = (await L.gameOf(code)).S;
  const d = Object.keys(L.E.DIRS).find((x) => L.E.move(s, 1, x) !== s);
  await A.page.keyboard.press(L.KEY[d]);
  check('C6 また動かせる', await waitFor(async () => (await L.gameOf(code)).S.rev > s.rev));
  H.offlineOk = false;

  // ── D. 12人・13人目は入れない ──
  await H.page.click('#btnLobby');
  await L.waitScreen(H, 'waiting');
  // 9人ぶんの在室を直接置く（撮影・検査用の架空の人。切断の予約がないので、消えない）
  for (let i = 0; i < 9; i += 1) await L.rest('PUT', L.ROOMS + '/' + code + '/players/ひと' + (i + 1), { isHost: false, uid: 'fake-' + i, joinedAt: Date.now() + i });
  check('D1 待合室に12人ならぶ', await waitFor(async () => (await H.page.$$('#lobbyPeople .sg-num')).length === 12));
  const C = await L.newClient('guestC', { viewport: { width: 1100, height: 800 } });
  await L.open(C, '?room=' + code);
  await C.page.fill('#guestName', 'じゅうさん');
  await C.page.click('#btnJoinRoom');
  check('D2 13人目は入れず、みんなにみせる画面を案内する', await waitFor(async () => (await L.text(C, '#joinError')).includes('いっぱい')));
  await H.page.fill('#proxyName', 'たろう');
  await H.page.click('#btnAddProxy');
  check('D3 12人のときは、端末なしの参加者も足せない', await waitFor(async () => (await L.text(H, '#proxyError')).includes('12人まで')));
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  const G12 = await L.gameOf(code);
  check('D4 12人のステージができる', G12 && G12.spec.n === 12 && G12.S.players.length === 12);
  check('D5 コマ12・ゴール12', await waitFor(async () => (await H.page.$$('.sg-piece--player')).length === 12 && (await H.page.$$('.sg-cell--goal')).length === 12));
  check('D6 動く部分は、前のステージの分が残っていない・人ごとの値は短い', Object.keys(G12.play).length === 1 && G12.play[G12.id].p.every((x) => x.length <= 12), Object.keys(G12.play));
  const fit = await H.page.evaluate(() => ({
    page: document.documentElement.scrollHeight,
    board: Math.round(document.getElementById('boardHost').getBoundingClientRect().bottom),
    side: Math.round(document.getElementById('side').getBoundingClientRect().bottom),
    pad: Math.round(document.querySelector('.sg-pad').getBoundingClientRect().bottom),
  }));
  check('D7 盤と矢印のボタンが1画面に入る（1280×800）', fit.board <= 800 && fit.pad <= 800, fit);
  check('D8 みんないる間は、ホストにえらぶ一覧は出ない', !(await L.visible(H, '#pick')));
  // 2人がいなくなる（在室をなくす）と、ホストがそのコマをえらべる
  await L.rest('PUT', L.ROOMS + '/' + code + '/players/ひと1', null);
  await L.rest('PUT', L.ROOMS + '/' + code + '/players/ひと2', null);
  check('D8b いなくなった人のコマを、ホストがえらべる（自分＋2人）', await waitFor(async () => (await H.page.$$('#pick .sg-pick__btn')).length === 3));
  check('D9 5人からは、ゆれるのは動かすコマだけ', await H.page.$eval('#board', (b) => b.classList.contains('is-calm')));
  await L.shot(H, 'e2-host-12');
  check('D10 横にはみ出さない', (await L.overflow(H)) <= 0 && (await L.overflow(A)) <= 0);

  await H.page.click('#btnLeave');
  await L.waitScreen(H, 'top');
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
