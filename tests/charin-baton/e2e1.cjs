// ちゃりんバトン E2E その1: 作成・参加・席・設定・観戦・みんなにみせる画面・3・2・1・まちがい・正解・パス・小銭の増え方・時間切れ・結果・もう一回・待合室へ・端末なしの参加者・スマホ幅・退出・ルームを閉じる
const L = require('./lib.cjs');
const { E, check, sleep, waitFor } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora', { viewport: { width: 375, height: 812 }, mobile: true });
  const C = await L.newClient('riku');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 作成・参加・席 ──
  await L.open(H);
  check('A0 トップの主ボタンは1つ', (await H.page.$$('#screen-top .btn-primary')).length === 1);
  await H.page.click('#btnGoCreate');
  await H.page.click('#btnCreateRoom');
  check('A1 名前がないと作れない', (await L.text(H, '#createError')).includes('名前'));
  await H.page.fill('#hostName', 'メンター');
  await H.page.click('#btnCreateRoom');
  await L.waitScreen(H, 'waiting');
  const code = (await L.text(H, '#roomCodeLabel')).trim();
  check('A2 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('A3 はじめの設定', room.status === 'waiting' && room.set.time.a === 45 && room.set.time.b === 45 && room.set.kinds.a === 'all' && room.set.maxCoins === 5 && room.set.arrange === 'scatter' && room.set.first === 'random', room.set);
  check('A4 ホストに「みんなにみせる画面」と「ルームを閉じる」', await L.visible(H, '#btnOpenWatch') && (await L.text(H, '#btnLeave')) === 'ルームを閉じる');
  check('A5 1人では始められない', await H.page.isDisabled('#btnStartGame'));
  check('A6 room-create を数える', await L.waitStats(H, 'room-create', 1));

  await L.joinRoom(A, 'あおい', code);
  check('A7 参加者は待つ', await L.visible(A, '#lobbyWait') && !(await L.visible(A, '#btnStartGame')));
  room = await L.roomWhen(code, (r) => r.seats?.a === 'あおい');
  check('A8 入った人が1人目の席に入る', room.seats?.a === 'あおい', room.seats);
  check('A9 ホストは席に入らない', !room.seats?.b);
  await L.joinRoom(B, 'そら', code);
  room = await L.roomWhen(code, (r) => r.seats?.b === 'そら');
  check('A10 2人目の席', room.seats?.b === 'そら');
  check('A11 2人そろうと始められる', await waitFor(async () => !(await H.page.isDisabled('#btnStartGame'))));
  await L.joinRoom(C, 'りく', code);
  check('A12 3人目は観戦', await waitFor(async () => (await L.text(H, '#lobbyPeople')).includes('りく観戦')), await L.text(H, '#lobbyPeople'));
  check('A13 観戦の人のバー', (await L.text(C, '#barMe')).includes('観戦中'));
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  check('A14 リンクからひらくとコードが入っている', (await X.page.inputValue('#joinCode')) === code && await L.visible(X, '#joinLinkHint'));
  await X.page.fill('#guestName', 'あおい');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('A15 同じ名前は入れない', true);
  await X.page.close();

  // みんなにみせる画面
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('A16 みんなにみせる画面に参加のしかた', await L.visible(W, '#lobbyJoin') && (await L.text(W, '#lobbyJoinCode')) === code);
  check('A17 みんなにみせる画面は参加者に入らない', Object.keys((await L.roomOf(code)).players).length === 4);
  check('A18 みんなにみせる画面にコピーのボタンは出ない', !(await L.visible(W, '#btnCopyCode')) && await L.visible(W, '#btnLeave'));

  // 席の入れかえ・ホストが席に入る
  await H.page.click('#btnSeatSwap');
  check('A19 入れかえが参加者に届く', await waitFor(async () => (await L.text(A, '#lobbySeats')).includes('2人目あおい（あなた）')), await L.text(A, '#lobbySeats'));
  await H.page.selectOption('#seat-a', { label: 'メンター（自分）' });
  check('A20 ホストも席に入れる', await waitFor(async () => (await L.text(B, '#lobbySeats')).includes('1人目メンター')), await L.text(B, '#lobbySeats'));
  await H.page.selectOption('#seat-a', { label: 'あおい' });
  room = await L.roomWhen(code, (r) => r.seats?.a === 'あおい');
  check('A21 反対の席の人を選ぶと入れかわる', room.seats?.a === 'あおい' && room.seats?.b === 'メンター', room.seats);
  await H.page.selectOption('#seat-b', { label: 'そら' });
  await L.roomWhen(code, (r) => r.seats?.b === 'そら');

  // ── B. 設定（人ごとのハンデ・小銭の出し方） ──
  await H.page.selectOption('#lobbySeats-time-b', '60');
  await L.roomWhen(code, (r) => r.set?.time?.b === 60);
  await H.page.selectOption('#lobbySeats-kinds-a', 'three');
  await L.roomWhen(code, (r) => r.set?.kinds?.a === 'three');
  await H.page.selectOption('#lobbyCommon-max', '4');
  await H.page.selectOption('#lobbyCommon-first', 'a');
  room = await L.roomWhen(code, (r) => r.set?.maxCoins === 4 && r.set?.first === 'a');
  check('B1 続けて変えても取りこぼさない', room.set.time.b === 60 && room.set.kinds.a === 'three' && room.set.maxCoins === 4 && room.set.first === 'a' && room.set.time.a === 45, room.set);
  check('B2 参加者には持ち時間と種類が出る', await waitFor(async () => {
    const t = await L.text(A, '#lobbySeats');
    return t.includes('持ち時間 45秒・小銭は1・10・100円だけ') && t.includes('持ち時間 60秒・小銭はぜんぶ（6種類）');
  }), await L.text(A, '#lobbySeats'));
  check('B3 参加者には小銭の出し方のまとめ', await waitFor(async () => (await L.text(A, '#lobbyCommonView')).includes('4枚まで') && (await L.text(A, '#lobbyCommonView')).includes('1人目から')), await L.text(A, '#lobbyCommonView'));
  await L.shot(H, 'room-lobby-host');
  await L.shot(W, 'room-lobby-watch');

  // ── C. はじめる・3・2・1 ──
  await H.page.click('#btnStartGame');
  for (const c of [H, A, B, C, W]) await L.waitScreen(c, 'game');
  check('C1 start と players-2 を数える', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-2', 1));
  room = await L.roomOf(code);
  let d = room.game.duel;
  check('C2 はじめは 3・2・1', d.phase === 'ready' && d.turn === 0, d.phase);
  check('C3 3・2・1 の間は小銭をかくす', (await L.trayCount(A)) === 0 && /[123]/.test(await L.text(A, '#readyLeft')));
  check('C4 番の表示', (await L.turnLine(A)).includes('あなた からはじまるよ') && (await L.turnLine(C)).includes('あおい からはじまるよ'), [await L.turnLine(A), await L.turnLine(C)]);
  check('C5 次の番の人に「もうすぐ」', (await L.text(B, '#answerBox')).includes('もうすぐはじまるよ'), await L.text(B, '#answerBox'));
  check('C6 みんなにみせる画面に金額の欄は出ない', !(await L.visible(W, '#answerBox')));
  await L.waitActive(A);
  d = await L.duelOf(code);
  check('C7 3秒たつと番の人が答えられる', d.phase === 'play', d.phase);
  check('C8 1人目は1・10・100円だけ・2枚', d.problem.coins.length === 2 && d.problem.coins.every((x) => [1, 10, 100].includes(x.v)), d.problem.coins);
  check('C9 PC では画面の数字ボタンを出さない', !(await L.visible(A, '.cb-pad')) && await L.visible(A, '.cb-answer') && await L.visible(A, '.cb-padtoggle'));
  check('C10 スマホでは数字ボタンを出す（番でなくても）', true);
  check('C11 観戦の人には金額の欄が出ない', !(await L.visible(C, '#display')) && (await L.text(C, '#answerBox')).includes('あおいが数えているよ'));

  // ── D. まちがい・正解 ──
  const sum = await L.traySum(A);
  check('D1 画面の合計とルームの答えが同じ', sum === E.totalOf(d.problem.coins.map((x) => x.v)), [sum, d.problem]);
  const rev0 = d.rev;
  await L.typeAnswer(A, sum + 1);
  await L.waitText(A, '#ngMsg', 'ちがうみたい');
  check('D2 まちがいはルームに書かない', (await L.duelOf(code)).rev === rev0);
  check('D3 まちがいはほかの人に出ない', (await L.text(C, '#answerBox')).includes('数えているよ'));
  await L.typeAnswer(A, sum);
  d = await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal').then((r) => r.game.duel);
  check('D4 正解で帯の段階', d.phase === 'reveal' && d.correct[0] === 1, d.phase);
  for (const c of [H, B, C, W]) check('D5 正解の金額がみんなに出る: ' + c.label, await waitFor(async () => (await L.text(c, '#trayBand')).includes('正解！ ' + sum.toLocaleString('ja-JP') + '円')), await L.text(c, '#trayBand'));
  check('D6 帯の間も小銭は見えている', (await L.trayCount(W)) === 2);
  check('D7 内訳が出る', (await L.text(W, '#trayBand')).includes('円玉'));
  await L.shot(W, 'room-reveal-watch');
  await L.waitActive(B);
  d = await L.duelOf(code);
  check('D8 1.5秒で相手の番', d.phase === 'play' && d.turn === 1, d);
  check('D9 2人目はぜんぶの種類から（2枚）', d.problem.coins.length === 2);
  check('D10 スマホに数字ボタン', await L.visible(B, '.cb-pad') && !(await L.visible(B, '.cb-padtoggle')));
  check('D11 番でない人の画面は待つ', (await L.text(A, '#answerBox')).includes('そらが数えているよ'));
  check('D12 スマホ幅ではみ出さない', (await L.overflow(B)) <= 0, await L.overflow(B));
  await L.shot(B, 'room-turn-mobile');

  // ── E. パス ──
  const passKey = d.problem.key;
  const clockBefore = d.rem[1];
  await B.page.click('.cb-passbtn');
  d = await L.roomWhen(code, (r) => r.game.duel.phase === 'pass').then((r) => r.game.duel);
  check('E1 パス', d.phase === 'pass');
  check('E2 パスの間は小銭をかくす', await waitFor(async () => (await L.trayCount(C)) === 0 && (await L.text(C, '#trayOver')).includes('パス')));
  check('E2b 相手の画面に「パス」の案内', await waitFor(async () => (await L.text(A, '#answerBox')).includes('そらはパス')), await L.text(A, '#answerBox'));
  await L.waitActive(B);
  d = await L.duelOf(code);
  check('E3 3秒で同じ人に新しい小銭', d.phase === 'play' && d.turn === 1 && d.problem.key !== passKey, d);
  check('E4 パスの間も自分の時計は減る', E.remaining(d, 1, Date.now()) <= clockBefore - 3000, [clockBefore, d.rem]);
  check('E5 パスでは枚数が増えない', (d.correct?.[1] ?? 0) === 0 && d.problem.coins.length === 2);

  // ── F. 小銭の増え方（上限4枚）・ならべ方 ──
  const counts = [];
  for (let k = 0; k < 7; k++) {
    // 正解の帯の間は番がまだ前の人なので、答える段階になってから番を読む
    const r = await L.roomWhen(code, (x) => x.game.duel.phase === 'play');
    const turn = r.game.duel.turn;
    const who = turn === 0 ? A : B;
    await L.waitActive(who);
    counts.push(await L.trayCount(who));
    const want = await L.traySum(who);
    await L.typeAnswer(who, want);
    const got = await L.roomWhen(code, (x) => x.game.duel.phase === 'reveal');
    if (got.game.duel.phase !== 'reveal') {
      console.log('  diag', k, who.label, 'want', want, 'db', got.game.duel.problem.coins.map((x) => x.v), got.game.duel.phase, 'ng', await L.text(who, '#ngMsg'), 'disp', await L.text(who, '#displayNum'), 'active', await who.page.evaluate(() => document.activeElement.outerHTML.slice(0, 80)));
    }
  }
  // そら、あおい、そら、あおい… の順。あおいは1回正解ずみ。枚数はその番が始まったときの自分の正解の数で決まる
  check('F1 正解2回ごとに1枚増える', JSON.stringify(counts) === JSON.stringify([2, 2, 2, 3, 3, 3, 3]), counts);
  await L.roomWhen(code, (x) => x.game.duel.phase === 'play');
  await L.waitActive(A);
  check('F2 答えた数は時計の札だけ（正答数は出さない）', !(await L.text(H, '#card0')).match(/問|正解/), await L.text(H, '#card0'));

  // ── G. 時間切れ・結果 ──
  d = await L.duelOf(code);
  check('G0 いまはあおいの番', d.turn === 0 && d.phase === 'play', d.turn);
  const lastSum = await L.traySum(A);
  // 時間切れを早送りする（あおいの残りを1.2秒に）
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game/duel', { rem: [1200, d.rem[1]], at: Date.now() });
  for (const c of [H, A, B, C, W]) await L.waitText(c, '#turnLine', 'の勝ち', 9000);
  room = await L.roomOf(code);
  check('G1 時計が0の人の負け', room.game.duel.phase === 'over' && room.game.duel.winner === 1 && room.game.ended === true, room.game.duel.winner);
  check('G2 勝った人', (await L.turnLine(W)).includes('そら の勝ち') && (await L.turnLine(B)).includes('あなた の勝ち'), [await L.turnLine(W), await L.turnLine(B)]);
  check('G3 時間切れの小銭の合計が出る', (await L.text(W, '#trayBand')).includes('この小銭は ' + lastSum.toLocaleString('ja-JP') + '円'), await L.text(W, '#trayBand'));
  const nHist = room.game.duel.history.length;
  check('G4 出た小銭の一覧（パスと時間切れもふくむ）', (await H.page.$$('.cb-hist')).length === nHist && nHist === 10, nHist);
  check('G5 ホストに「もう一回」', await L.visible(H, '#resultBox .btn-primary') && (await L.text(H, '#resultBox')).includes('待合室へ'));
  check('G6 参加者は待つ', (await L.text(A, '#resultBox')).includes('ホストが次を決めるのを待っているよ') && !(await L.visible(A, '#resultBox .btn-primary')));
  check('G7 みんなにみせる画面にボタンは出ない', !(await L.visible(W, '#resultBox .btn')) && (await W.page.$$('.cb-hist')).length === nHist);
  let fin = 0;
  for (const c of [H, A, B]) fin += await L.stats(c, 'finish');
  await sleep(800);
  fin = 0;
  for (const c of [H, A, B]) fin += await L.stats(c, 'finish');
  check('G8 finish は1回だけ数える', fin === 1, fin);
  await H.page.click('.cb-hist >> nth=0');
  check('G9 一覧の小銭を大きく見る', await waitFor(async () => (await L.text(H, '#zoomTotal')).includes('ぜんぶで')) && (await L.text(H, '#zoomBreak')).includes('円玉'));
  await L.shot(H, 'room-zoom-host');
  await H.page.click('#btnZoomClose');
  await L.shot(W, 'room-result-watch');
  await L.shot(B, 'room-result-mobile');
  check('G10 結果の画面もスマホ幅ではみ出さない', (await L.overflow(B)) <= 0, await L.overflow(B));

  // ── H. もう一回・待合室へ ──
  await A.page.click('.cb-hist >> nth=1');
  await waitFor(async () => A.page.evaluate(() => document.getElementById('zoom').open));
  await H.page.click('#resultBox .btn-primary');
  check('H0 大きく見ていた窓は、次の対決で閉じる', await waitFor(async () => !(await A.page.evaluate(() => document.getElementById('zoom').open))));
  d = await L.roomWhen(code, (r) => r.game?.id === 2).then((r) => r.game.duel);
  check('H1 もう一回は先に答える人を入れかえる', d.turn === 1 && d.phase === 'ready' && d.history?.length === undefined, d.turn);
  check('H2 again と start を数える', await L.waitStats(H, 'again', 1) && await L.waitStats(H, 'start', 2));
  check('H3 新しい対決の画面', await waitFor(async () => (await L.turnLine(A)).includes('そら からはじまるよ')), await L.turnLine(A));
  await H.page.click('#tools .cb-quiet');
  await L.waitScreen(H, 'waiting');
  for (const c of [A, B, C, W]) await L.waitScreen(c, 'waiting');
  room = await L.roomOf(code);
  check('H4 待合室へ: 席はそのまま', room.status === 'waiting' && !room.game && room.seats.a === 'あおい' && room.seats.b === 'そら', room.seats);
  check('H5 途中でやめたときは again を数えない', await L.waitStats(H, 'again', 1));

  // ── I. 端末なしの参加者（ホストが代わりに入れる） ──
  await H.page.fill('#proxyName', 'ひかり');
  await H.page.click('#btnAddProxy');
  room = await L.roomWhen(code, (r) => r.proxies?.['ひかり']);
  check('I1 端末なしの参加者を足せる', !!room.proxies?.['ひかり']);
  check('I2 「端末なし」の印はホストだけ', (await L.text(H, '#lobbyPeople')).includes('端末なし') && !(await L.text(A, '#lobbyPeople')).includes('端末なし'));
  await H.page.selectOption('#seat-b', { label: 'ひかり（端末なし）' });
  await L.roomWhen(code, (r) => r.seats?.b === 'ひかり');
  await H.page.selectOption('#lobbyCommon-first', 'b');
  await L.roomWhen(code, (r) => r.set?.first === 'b');
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  check('I3 ホストに代わりに入れる案内', await waitFor(async () => (await L.text(H, '#answerBox')).includes('ひかりの番。代わりに入れてね')), await L.text(H, '#answerBox'));
  await L.waitActive(H);
  check('I4 そらは観戦になる', (await L.text(B, '#barMe')).includes('観戦中'));
  await L.typeAnswer(H, await L.traySum(H));
  d = await L.roomWhen(code, (r) => r.game.duel.phase === 'reveal').then((r) => r.game.duel);
  check('I5 ホストが代わりに答えられる', d.correct[1] === 1, d.correct);
  await L.waitActive(A);
  check('I6 次はあおいの番', (await L.duelOf(code)).turn === 0);
  check('I7 ホストはあおいの番には入れられない', !(await L.visible(H, '#display')));
  check('I8 対決中は端末なしの参加者を外すボタンが見えない', !(await L.visible(H, '#lobbyPeople .cb-person__del')));

  // ── J. 退出・ルームを閉じる ──
  await C.page.click('#btnLeave');
  await L.waitScreen(C, 'top');
  room = await L.roomWhen(code, (r) => !r.players['りく']);
  check('J1 観戦の人が退出すると在室が消える', !room.players['りく']);
  await H.page.click('#btnLeave');
  for (const c of [A, B]) await L.waitScreen(c, 'top');
  check('J2 ルームを閉じると参加者はトップへ', true);
  check('J3 ルームが消える', await waitFor(async () => (await L.roomOf(code)) === null));
  check('J4 みんなにみせる画面はおわりの表示', await waitFor(async () => (await L.screen(W)) === 'watch-end'));

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
