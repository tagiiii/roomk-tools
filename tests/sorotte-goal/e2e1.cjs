// そろってゴール E2E その1: 作成・参加・待合室・はじめる・1歩の同期・進めないときは書かない・クリア・次のステージ・
// 途中から入った人・端末なしの参加者・退出した人のコマをホストが動かす・やりなおす・読み込み直し・みんなにみせる画面・ルームを閉じる
const L = require('./lib.cjs');
const { check, sleep, waitFor, KEY } = L;

// コマの場所だけをくらべる（サーバーの値には、その人の歩数も入っている）
const xy = (p) => p.x + ',' + p.y;
// 画面のコマの場所が、サーバーの値と同じになるまで待つ
// （相手の1歩が届く前に押すと、手元では「まだ進めない」と判定されて書かれないため）
async function synced(c, code) {
  return waitFor(async () => {
    const S = (await L.gameOf(code)).S;
    const want = S.players.map((p) => p.x + ',' + p.y).join(' ');
    const got = await c.page.$$eval('.sg-piece--player', (ps) => ps
      .sort((a, b) => Number(a.dataset.seat) - Number(b.dataset.seat))
      .map((p) => p.style.getPropertyValue('--x') + ',' + p.style.getPropertyValue('--y')).join(' '));
    return want === got;
  }, 5000);
}
// 1歩動かして、サーバーの歩数が増えるまで待つ
async function stepAndWait(c, code, dir) {
  await synced(c, code);
  const before = (await L.gameOf(code)).S.rev;
  await L.press(c, KEY[dir]);
  return waitFor(async () => (await L.gameOf(code)).S.rev > before, 5000);
}
// 手順のとおりに、席の人の画面から動かす。who → その席を動かす画面
async function play(code, path, clientOf) {
  for (const [who, dir] of path) {
    const c = clientOf(who);
    if (!(await stepAndWait(c, code, dir))) return false;
  }
  return true;
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1280, height: 800 } });
  const A = await L.newClient('guestA', { viewport: { width: 390, height: 800 }, mobile: true });

  // ── A. 作成・参加・待合室 ──
  await L.open(H);
  check('A1 トップの主ボタンは1つ', (await H.page.$$('#screen-top .btn-primary')).length === 1);
  const code = await L.createRoom(H, 'ほすと');
  check('A2 room-create を数える', await L.waitStats(H, 'room-create', 1));
  check('A3 1人だけでは、はじめられない', await H.page.$eval('#btnStartGame', (b) => b.disabled));
  await L.joinRoom(A, 'あおい', code);
  check('A4 2人そろうと、はじめられる', await waitFor(async () => !(await H.page.$eval('#btnStartGame', (b) => b.disabled))));
  check('A5 参加した順に番号が付く', await waitFor(async () => (await H.page.$$eval('#lobbyPeople .sg-num', (xs) => xs.map((x) => x.textContent).join())) === '1,2'));
  check('A6 参加者の画面に、設定の欄とはじめるは出ない', !(await L.visible(A, '#lobbySet')) && !(await L.visible(A, '#btnStartGame')) && await L.visible(A, '#lobbyWait'));
  check('A6b むずかしさは4つ（やさしい・ふつう・むずかしい・げきむず）', (await H.page.$$eval('#levelSeg .sg-seg__btn', (bs) => bs.map((b) => b.textContent).join())) === 'やさしい,ふつう,むずかしい,げきむず');
  await H.page.click('#levelSeg .sg-seg__btn >> nth=3');
  await L.roomWhen(code, (r) => r.set.level === 'expert');
  check('A6c えらんだむずかしさが、参加者の画面にも出る', await waitFor(async () => (await L.text(A, '#lobbySetView')).includes('げきむず')));
  await H.page.click('#levelSeg .sg-seg__btn >> nth=0');
  await L.roomWhen(code, (r) => r.set.level === 'easy');
  await H.page.click('#btnStageNext');
  await L.roomWhen(code, (r) => r.set.stage === 2);
  await H.page.click('#btnStagePrev');
  await L.roomWhen(code, (r) => r.set.stage === 1);
  check('A7 参加者の画面に、設定の要約が出る', await waitFor(async () => (await L.text(A, '#lobbySetView')).includes('やさしい') && (await L.text(A, '#lobbySetView')).includes('ステージ 1')));
  await H.page.uncheck('#hostPlays');
  await L.roomWhen(code, (r) => r.set.hostPlays === false);
  check('A8 ホストが進行だけだと、1人なのではじめられない', await waitFor(async () => H.page.$eval('#btnStartGame', (b) => b.disabled)));
  await H.page.check('#hostPlays');
  await L.roomWhen(code, (r) => r.set.hostPlays === true);
  check('A9 スマホ幅の待合室ではみ出さない', (await L.overflow(A)) <= 0);

  // ── B. はじめる・1歩の同期 ──
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 800 } });
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('B0 みんなにみせる画面の待合室に、参加のしかたが出る', await L.visible(W, '#lobbyJoin'));
  await waitFor(async () => !(await H.page.$eval('#btnStartGame', (b) => b.disabled)));
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  await L.waitScreen(A, 'game');
  await L.waitScreen(W, 'game');
  let G = await L.gameOf(code);
  check('B1 ステージができる（2人・やさしい・ステージ1）', G && G.spec.n === 2 && G.spec.level === 'easy' && G.spec.seed === 1 && G.seats.join() === 'ほすと,あおい');
  check('B2 start と players-2 を数える', await L.waitStats(H, 'start', 1) && (await L.stats(H, 'players-2')) === 1);
  check('B3 どの画面にもコマが2つ', (await H.page.$$('.sg-piece--player')).length === 2 && (await A.page.$$('.sg-piece--player')).length === 2 && (await W.page.$$('.sg-piece--player')).length === 2);
  check('B4 自分のコマに「あなた」', (await L.text(H, '.sg-piece--player[data-seat="0"] .sg-pin__label')) === 'あなた' && (await L.text(A, '.sg-piece--player[data-seat="1"] .sg-pin__label')) === 'あなた');
  check('B5 みんなにみせる画面に、矢印のボタンと「そのほかの操作」は出ない', (await W.page.$$('.sg-pad')).length === 0 && !(await L.visible(W, '#hostMenu')));
  check('B6 参加者の画面に「そのほかの操作」は出ない', !(await L.visible(A, '#hostMenu')) && await L.visible(H, '#hostMenu'));
  check('B7 スマホ幅のステージではみ出さない', (await L.overflow(A)) <= 0);

  // 進めない向き（かべ）は書かない
  const start = (await L.gameOf(code)).S;
  const blocked = Object.keys(L.E.DIRS).find((d) => L.E.move(start, 1, d) === start);
  await L.press(A, KEY[blocked]);
  await sleep(500);
  check('B8 進めない1歩は書かない', (await L.gameOf(code)).S.rev === 0);
  // 進める向きは、ほかの画面にも届く
  const free = Object.keys(L.E.DIRS).find((d) => L.E.move(start, 1, d) !== start);
  const want = L.E.move(start, 1, free).players[1];
  check('B9 1歩がサーバーに届く', await stepAndWait(A, code, free));
  check('B10 ほかの画面のコマも動く', await waitFor(async () => JSON.stringify(await L.piecePos(H, 1)) === JSON.stringify([want.x, want.y]) && JSON.stringify(await L.piecePos(W, 1)) === JSON.stringify([want.x, want.y])));
  // ほかの人のコマは動かせない（ホストは、いる人のコマをえらべない）
  check('B11 ホストの画面に、コマをえらぶ一覧は出ない（自分のコマだけ）', !(await L.visible(H, '#pick')));
  await L.shot(H, 'e1-host-game');
  await L.shot(A, 'e1-guest-game');

  // ── B'. ひとこと（決まった言葉をえらんで送る） ──
  check('B12 みんなにみせる画面に「ひとこと」は出ない・遊ぶ人には出る', !(await L.visible(W, '#btnSay')) && await L.visible(A, '#btnSay') && await L.visible(H, '#btnSay'));
  await A.page.click('#btnSay');
  check('B13 言葉の一覧がひらく（自由に打つ欄はない）', await L.visible(A, '#sayPanel') && (await A.page.$$('#sayPanel .sg-saypanel__btn')).length >= 10 && (await A.page.$$('#sayPanel input, #sayPanel textarea')).length === 0);
  const phrase = await A.page.$eval('#sayPanel .sg-saypanel__btn >> nth=1', (b) => b.textContent);
  await A.page.click('#sayPanel .sg-saypanel__btn >> nth=1');
  // いまのステージの動く部分（番号のキーは、配列で返ってくることがあるので、番号で引く）
  const playOf = (r) => r.play[r.game.id];
  const said = await L.roomWhen(code, (r) => playOf(r).say);
  check('B14 送った言葉の番号が、自分の席に書かれる', said && playOf(said).say[1] === '1.1', said && playOf(said).say);
  check('B15 ほかの人の画面・みんなにみせる画面のコマに、吹き出しが出る', await waitFor(async () => (await L.text(H, '.sg-piece--player[data-seat="1"] .sg-say')) === phrase && (await L.text(W, '.sg-piece--player[data-seat="1"] .sg-say')) === phrase));
  check('B16 横の一覧にも出る・送ったあと一覧はとじる', (await L.text(H, '#roster')).includes(phrase) && !(await L.visible(A, '#sayPanel')));
  await A.page.click('#btnSay');
  await A.page.click('#sayPanel .sg-saypanel__btn >> nth=0');
  await sleep(500);
  check('B17 5秒たつ前の2回目は送らない', playOf(await L.roomOf(code)).say[1] === '1.1' && (await L.text(A, '#roomk-toast')).includes('5秒に1回'));
  check('B18 吹き出しは、しばらくすると消える', await waitFor(async () => (await H.page.$$('.sg-say')).length === 0, 9000));

  // ── C. クリアまで ──
  G = await L.gameOf(code);
  const path = L.solve(G.S);
  check('C1 クリアまでの手順がある', Array.isArray(path) && path.length > 0, path && path.length);
  const ok = await play(code, path, (who) => (who === 0 ? H : A));
  check('C2 手順のとおりに動かせる', ok);
  G = await L.gameOf(code);
  check('C3 クリアになる', G.S.cleared === true);
  check('C4 ホストに「次のステージへ」、参加者に待つ文', await waitFor(async () => await L.visible(H, '#btnNext') && await L.visible(A, '#clearWait') && !(await L.visible(A, '#btnNext'))));
  check('C5 みんなにみせる画面にも「クリア！」', await waitFor(async () => await L.visible(W, '.sg-clear__big') && !(await L.visible(W, '#btnNext')) && !(await L.visible(W, '#clearWait'))));
  await sleep(500);
  check('C6 finish は1回だけ', (await L.stats(H, 'finish')) + (await L.stats(A, 'finish')) === 1);
  // クリアのあとは動かない
  await L.press(A, KEY.left);
  await sleep(400);
  check('C7 クリアのあとの1歩は書かない', (await L.gameOf(code)).S.rev === G.S.rev);
  await L.shot(H, 'e1-host-clear');

  // ── D. 途中から入った人は、次のステージから ──
  const B = await L.newClient('guestB', { viewport: { width: 1100, height: 800 } });
  await L.open(B, '?room=' + code);
  await L.waitScreen(B, 'join');
  await B.page.fill('#guestName', 'みどり');
  await B.page.click('#btnJoinRoom');
  await L.waitScreen(B, 'game');
  check('D1 途中から入った人は見る番', (await L.text(B, '#youLine')).includes('見る番') && (await B.page.$$('.sg-pad')).length === 0);
  await H.page.click('#btnNext');
  G = (await L.roomWhen(code, (r) => r.game.id === 2)) && await L.gameOf(code);
  check('D2 次の番号のステージ・3人で作りなおす', G.spec.seed === 2 && G.spec.n === 3 && G.seats.join() === 'ほすと,あおい,みどり' && G.S.rev === 0);
  check('D3 設定のステージ番号も進む', (await L.roomOf(code)).set.stage === 2);
  check('D4 入った人にコマと矢印が出る', await waitFor(async () => (await B.page.$$('.sg-pad')).length === 1 && (await L.text(B, '#youLine')).includes('3 のコマ')));
  check('D5 コマが3つ', await waitFor(async () => (await W.page.$$('.sg-piece--player')).length === 3));

  // ── E. 退出した人のコマは、ホストが動かす ──
  const s3 = (await L.gameOf(code)).S;
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  check('E1 退出すると在室が消える', !!(await L.roomWhen(code, (r) => !r.players['みどり'])));
  check('E2 コマは残り、ホストに「通信が切れた」と、えらぶ一覧が出る', await waitFor(async () => (await H.page.$$('.sg-piece--player')).length === 3 && (await L.text(H, '#roster')).includes('通信が切れた') && await L.visible(H, '#pick')));
  await H.page.click('#pick .sg-pick__btn >> nth=1');
  const d3 = Object.keys(L.E.DIRS).find((d) => L.E.move(s3, 2, d) !== s3);
  check('E3 ホストが、退出した人のコマを動かせる', await stepAndWait(H, code, d3) && xy((await L.gameOf(code)).S.players[2]) === xy(L.E.move(s3, 2, d3).players[2]));
  // 参加者は、ほかの人のコマをえらべない
  check('E4 参加者に、えらぶ一覧は出ない', !(await L.visible(A, '#pick')));
  // 同じ名前で入りなおすと、自分のコマに戻る
  await L.open(B, '?room=' + code);
  await B.page.fill('#guestName', 'みどり');
  await B.page.click('#btnJoinRoom');
  await L.waitScreen(B, 'game');
  check('E5 同じ名前で入りなおすと、自分のコマに戻る', await waitFor(async () => (await L.text(B, '#youLine')).includes('3 のコマ') && !(await L.visible(H, '#pick'))));

  // ── F. やりなおす・読み込み直し ──
  await H.page.click('#btnRetry');
  G = (await L.roomWhen(code, (r) => r.game.id === 3)) && await L.gameOf(code);
  check('F1 やりなおすと、同じ番号で0歩にもどる', G.spec.seed === 2 && G.S.rev === 0 && G.spec.n === 3);
  await A.page.reload();
  await L.waitScreen(A, 'game');
  check('F2 参加者が読み込み直しても、自分のコマに戻る', await waitFor(async () => (await L.text(A, '#youLine')).includes('2 のコマ')));
  const s4 = (await L.gameOf(code)).S;
  const d4 = Object.keys(L.E.DIRS).find((d) => L.E.move(s4, 1, d) !== s4);
  check('F3 読み込み直したあとも動かせる', await stepAndWait(A, code, d4));
  await H.page.reload();
  await L.waitScreen(H, 'game');
  check('F4 ホストが読み込み直しても、ホストとして戻る', await waitFor(async () => await L.visible(H, '#hostMenu') && (await L.roomOf(code)).hostConnected === true));

  // ── G. 待合室へ・端末なしの参加者 ──
  await H.page.click('#btnLobby');
  await L.waitScreen(H, 'waiting');
  await L.waitScreen(A, 'waiting');
  check('G1 待合室にもどると、ステージが消える', !(await L.roomOf(code)).game);
  await H.page.fill('#proxyName', 'たろう');
  await H.page.click('#btnAddProxy');
  await L.roomWhen(code, (r) => r.proxies && r.proxies['たろう']);
  check('G2 「端末なし」の印はホストの画面にだけ', await waitFor(async () => (await L.text(H, '#lobbyPeople')).includes('端末なし') && (await L.text(A, '#lobbyPeople')).includes('たろう') && !(await L.text(A, '#lobbyPeople')).includes('端末なし')));
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  G = await L.gameOf(code);
  check('G3 端末なしの人も入って4人', G.spec.n === 4 && G.seats.includes('たろう') && G.raw.proxy[G.seats.indexOf('たろう')] === true);
  const seat = G.seats.indexOf('たろう');
  check('G4 ホストに、えらぶ一覧（自分と端末なしの人）', await waitFor(async () => (await H.page.$$('#pick .sg-pick__btn')).length === 2));
  // 盤のコマを押してえらぶ
  await H.page.evaluate((i) => document.querySelector('.sg-piece--player[data-seat="' + i + '"] .sg-piece__in').dispatchEvent(new MouseEvent('click', { bubbles: true })), seat);
  const s5 = (await L.gameOf(code)).S;
  const d5 = Object.keys(L.E.DIRS).find((d) => L.E.move(s5, seat, d) !== s5);
  check('G5 ホストが、端末なしの人のコマを動かせる', await stepAndWait(H, code, d5) && xy((await L.gameOf(code)).S.players[seat]) === xy(L.E.move(s5, seat, d5).players[seat]));
  check('G6 参加者の画面の一覧に「端末なし」は出ない', !(await L.text(A, '#roster')).includes('端末なし') && (await L.text(H, '#roster')).includes('端末なし'));

  // ── H. ルームを閉じる ──
  await H.page.click('#btnLeave');
  await L.waitScreen(H, 'top');
  check('H1 ルームが消える', await waitFor(async () => (await L.roomOf(code)) === null));
  check('H2 参加者はトップへ', await waitFor(async () => (await L.screen(A)) === 'top' && (await L.screen(B)) === 'top'));
  check('H3 みんなにみせる画面は、おわりの画面へ', await waitFor(async () => (await L.screen(W)) === 'watch-end'));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
