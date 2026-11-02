// すとんブロック E2E その1: 作成・参加・設定・同じ順番・ほかの人の盤・じゃま・早めにおわる・結果・もう一回・
// ホストが見るだけ・みんなにみせる画面・途中から入る人・時間で結果・退出・ルームを閉じる・375px
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, text, visible, waitVisible, waitScreen, waitText, overflow, waitStats, waitFor, key, waitPlaying, fitsHeight, shot, ROOMS } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('haru', { viewport: { width: 375, height: 812 } });

  // ── 作成・参加 ──
  await L.open(H);
  check('T1 トップの主ボタンは1つ', (await H.page.$$('#screen-top .btn-primary')).length === 1);
  await H.page.click('#btnGoCreate');
  await H.page.click('#btnCreateRoom');
  check('T2 名前がないと作れない', (await text(H, '#createError')).includes('名前'));
  await H.page.fill('#hostName', 'メンター');
  await H.page.click('#btnCreateRoom');
  await waitScreen(H, 'waiting');
  const code = (await text(H, '#roomCodeLabel')).trim();
  check('T3 ルームコード6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('T4 room-create を数える', await waitStats(H, 'room-create', 1));
  let room = await roomOf(code);
  check('T5 ルームの初期値', room.status === 'waiting' && room.hostPlays === true && room.settings.time === 180 && room.settings.jama === false, room);

  await L.open(A, '?room=' + code);
  await waitScreen(A, 'join');
  check('T6 リンクで開くとコードが入っている', (await A.page.inputValue('#joinCode')) === code);
  check('T7 リンクのヒント', await visible(A, '#joinLinkHint'));
  await A.page.fill('#guestName', 'メンター');
  await A.page.click('#btnJoinRoom');
  await waitText(A, '#joinError', '使われている');
  check('T8 ホストと同じ名前は不可', true);
  await A.page.fill('#guestName', 'あおい');
  await A.page.click('#btnJoinRoom');
  await waitScreen(A, 'waiting');
  check('T9 参加でリンクのコードが外れる', !(await A.page.evaluate(() => location.search)).includes('room='));
  await L.joinRoom(B, 'はる', code);
  await waitText(H, '#lobbyPeople', 'はる');
  check('T10 ホストに参加者が出る', (await text(H, '#lobbyPeople')).includes('あおい'));
  check('T11 参加する人には設定を出さない', !(await visible(A, '#lobbyHost')) && await visible(A, '#lobbyWait'));
  // 同じブラウザの別のタブ（同じ匿名ID）から、在室している名前では入れない
  const A2 = await L.newPage(A.context, 'aoi-tab2');
  await L.open(A2, '?room=' + code);
  await waitScreen(A2, 'join');
  await A2.page.fill('#guestName', 'あおい');
  await A2.page.click('#btnJoinRoom');
  await waitText(A2, '#joinError', '使われている');
  check('T10b 同じブラウザの別のタブから、在室している名前では入れない', (await L.screen(A)) === 'waiting');
  await A2.page.close();
  await H.page.click('label:has(input[name="roomJama"][value="on"])');
  await H.page.click('label:has(input[name="roomTime"][value="120"])');
  await waitText(A, '#lobbySettings', '2分・ゆっくり・じゃまあり');
  check('T12 設定がすぐ参加者に出る', true);
  room = await roomWhen(code, (r) => r.settings.jama === true && r.settings.time === 120);
  check('T13 設定がルームに入る', room.settings.jama === true && room.settings.time === 120);
  check('T14 375px で横にはみ出さない（待合室）', (await overflow(B)) <= 0);

  // ── はじめる ──
  await H.page.click('#btnStartGame');
  await Promise.all([waitScreen(H, 'play'), waitScreen(A, 'play'), waitScreen(B, 'play')]);
  check('T15 みんなあそぶ画面', true);
  check('T16 カウントダウン', await waitFor(() => visible(A, '#countdown'), 3000));
  const counts = new Set();
  await waitFor(async () => { counts.add(await text(A, '#countdown')); return !(await visible(A, '#countdown')); }, 6000);
  check('T16b カウントダウンは 3・2・1', [...counts].every((x) => ['3', '2', '1'].includes(x)) && counts.has('3'), [...counts]);
  room = await roomWhen(code, (r) => r.status === 'play' && r.round && typeof r.round.startedAt === 'number');
  const R1 = room.round;
  check('T17 回の中身', JSON.stringify(R1.players) === JSON.stringify(['メンター', 'あおい', 'はる']) && R1.jama === true && R1.time === 120, R1);
  check('T18 start・players-3 を数える', await waitStats(H, 'start', 1) && await waitStats(H, 'players-3', 1));
  check('T19 あそんでいる間はルームのバーを出さない', !(await visible(H, '#roomBar')));
  await Promise.all([L.waitPlaying(H), L.waitPlaying(A), L.waitPlaying(B)]);
  check('T20 じゃまの欄が出る', await visible(H, '#jamaBox') && await visible(B, '#jamaBox'));
  const t0 = await text(A, '#playTimer');
  await sleep(2200);
  const t1 = await text(A, '#playTimer');
  check('T20b 残り時間が進む', /^\d:\d\d$/.test(t0) && t0 !== t1 && t1 < t0, [t0, t1]);
  check('T21 ボタンの名前', (await text(H, '#btnPlayEnd')) === '早めにおわる' && (await text(A, '#btnPlayEnd')) === '退出する');

  // 同じ順番で出る: 3人とも同じ操作で置くと、同じ盤になる
  await key(H, 'Space'); await key(A, 'Space'); await key(B, 'Space');
  room = await roomWhen(code, (r) => r.boards && ['メンター', 'あおい', 'はる'].every((n) => r.boards[n]?.pieces === 1));
  const bs = ['メンター', 'あおい', 'はる'].map((n) => room.boards?.[n]?.b);
  check('T22 みんな同じ順番でブロックが出る', bs[0] && bs[0] === bs[1] && bs[1] === bs[2] && bs[0].replace(/\./g, '').length > 0);
  const g0 = E.createGame({ seed: R1.seed });
  E.hardDrop(g0);
  check('T23 種どおりの盤', E.packBoard(g0.board) === bs[0]);
  check('T24 広い画面はほかの人の盤を右に', await waitFor(async () => (await H.page.$$('#others .sb-mini')).length === 2));
  check('T25 スマホは名前と段の数だけ', await visible(B, '#othersList') && !(await visible(B, '#others')) && (await text(B, '#othersList')).includes('あおい'));
  check('T26 375px で1画面に収まる（あそぶ画面）', (await overflow(B)) <= 0 && await fitsHeight(B));
  await shot(B, 'e2e1-play-375');

  // ── じゃま: ホストに2段送る → 置くと下に入る → あいた列に縦のブロックで2段消す → つぎの人（あおい）に1段 ──
  await rest('POST', `${ROOMS}/${code}/jama/メンター`, { round: R1.id, rows: 2, from: 'test' });
  await waitText(H, '#playJama', '2段');
  check('T27 来るじゃまに数が出る', true);
  room = await roomWhen(code, (r) => !r.jama?.['メンター']);
  check('T28 受けとったじゃまは消える', !room.jama?.['メンター']);
  // じゃまのあく列はでたらめなので、ホストの Math.random を固定して左はし（0列）にする（まん中に置いたブロックと重ならない）
  await H.page.evaluate(() => { Math.random = () => 0.01; });
  await key(H, 'ArrowRight', 6); await key(H, 'Space');
  await waitText(H, '#playJama', '0段');
  room = await roomWhen(code, (r) => r.boards['メンター'].pieces === 2 && /^j*\.j*$/.test(r.boards['メンター'].b.slice(-10)));
  const hb = room.boards['メンター'];
  const gap = hb.b.slice(-10).indexOf('.');
  check('T29 盤の下に1列あいた段が2つ', gap >= 0 && hb.b.slice(-20, -10) === hb.b.slice(-10), hb.b.slice(-20));
  // 同じ盤を node で作りなおして、縦に入るブロックまでの手を決める
  const g = E.restoreGame({ seed: R1.seed, onFull: 'clear' }, hb);
  const far = [];
  let guard = 0;
  while (g.piece.kind !== 'I' && guard++ < 12) {
    // あいた列の反対側へ寄せて置く
    const dir = gap < 5 ? 1 : -1;
    for (let i = 0; i < 6; i++) E.move(g, dir, 0);
    E.hardDrop(g);
    far.push(dir);
  }
  E.rotate(g, 1);
  const col = Math.min(...g.piece.cells.map(([x]) => g.piece.x + x));
  const shift = gap - col;
  for (let i = 0; i < Math.abs(shift); i++) E.move(g, Math.sign(shift), 0);
  const plan = E.hardDrop(g);
  check('T30 （計画）縦のブロックで2段消える', plan.lines === 2, { plan, far: far.length });
  for (const dir of far) { await key(H, dir > 0 ? 'ArrowRight' : 'ArrowLeft', 6); await key(H, 'Space'); await sleep(30); }
  await key(H, 'x');
  await key(H, shift < 0 ? 'ArrowLeft' : 'ArrowRight', Math.abs(shift));
  await key(H, 'Space');
  await waitText(H, '#playLines', '2');
  check('T31 あいた列に入れて2段消える', true);
  await waitText(A, '#playJama', '1段');
  check('T32 つぎの人に1段とどく', true);
  check('T33 その先の人には来ない', (await text(B, '#playJama')) === '0段');
  await key(A, 'ArrowLeft', 5); await key(A, 'Space');
  room = await roomWhen(code, (r) => /^j*\.j*$/.test(r.boards['あおい'].b.slice(-10)));
  check('T34 受けた人が置くと盤の下に入る', /^j*\.j*$/.test(room.boards['あおい'].b.slice(-10)));
  await shot(H, 'e2e1-host-play');

  // ── 早めにおわる → 結果 → もう一回 ──
  await H.page.click('#btnPlayEnd');
  await Promise.all([waitScreen(H, 'result'), waitScreen(A, 'result'), waitScreen(B, 'result')]);
  check('T35 早めにおわると、みんな結果', true);
  room = await roomOf(code);
  check('T36 結果がルームに入る', room.status === 'result' && room.result.rows.length === 3);
  const rows = await H.page.$$eval('.sb-rank li', (ls) => ls.map((l) => l.textContent));
  check('T37 順位と段の数', rows[0].startsWith('1位') && rows[0].includes('メンター') && rows[0].includes('2段') && rows[1].startsWith('2位'), rows);
  check('T38 finish を数える（1回）', await waitStats(H, 'finish', 1));
  check('T39 もう一回はホストだけ', !(await visible(A, '#btnAgain')) && await visible(A, '#resultWait'));
  check('T40 結果ではルームのバーが出る', await visible(A, '#roomBar'));
  await H.page.click('#btnAgain');
  await Promise.all([waitScreen(H, 'waiting'), waitScreen(A, 'waiting'), waitScreen(B, 'waiting')]);
  room = await roomOf(code);
  check('T41 もう一回で待合室・回の記録を消す', room.status === 'waiting' && !room.round && !room.boards && !room.result);
  check('T42 again を数える', await waitStats(H, 'again', 1));

  // ── ホストが見るだけ・みんなにみせる画面・途中から入る人 ──
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await waitScreen(W, 'waiting');
  check('W1 みんなにみせる画面は参加のしかたを出す', await visible(W, '#lobbyJoin') && (await text(W, '#lobbyJoinCode')) === code);
  check('W2 みんなにみせる画面は在室に入らない', Object.keys((await roomOf(code)).players).length === 3);
  await H.page.click('#hostPlays');
  await roomWhen(code, (r) => r.hostPlays === false);
  await waitText(H, '#lobbyPeople', 'あそぶ人の盤を見る');
  check('W3 ホストの印', true);
  await H.page.click('#btnStartGame');
  await waitScreen(H, 'watch');
  check('W4 ホストは盤をならべて見る画面', true);
  room = await roomWhen(code, (r) => r.status === 'play' && r.round);
  check('W5 ホストはあそぶ人に入らない', JSON.stringify(room.round.players) === JSON.stringify(['あおい', 'はる']));
  await waitScreen(W, 'watch');
  check('W6 みんなにみせる画面も盤をならべる', await waitFor(async () => (await W.page.$$('#watchGrid .sb-mini')).length === 2));
  check('W7 みんなにみせる画面には「早めにおわる」を出さない', !(await visible(W, '#btnWatchEnd')) && await visible(H, '#btnWatchEnd'));
  check('W7b みんなにみせる画面には「トップへ戻る」', await visible(W, '#btnWatchLeave') && !(await visible(H, '#btnWatchLeave')));
  const C = await L.newClient('sora');
  await L.joinRoom(C, 'そら', code);
  check('W8 途中から入った人は待合室で待つ', await visible(C, '#lobbyLate'));
  await L.waitPlaying(A);
  await key(A, 'Space');
  check('W9 見る画面に段の数・盤が届く', await waitFor(async () => (await W.page.$$eval('#watchGrid .sb-mini canvas', (cs) => cs.length)) === 2));
  // 時間で結果: 回の始まりを過去へずらして早送りする（ホストの端末が結果を出す）
  await rest('PATCH', `${ROOMS}/${code}/round`, { startedAt: Date.now() - (120 + 10) * 1000 });
  await Promise.all([waitScreen(A, 'result', 12000), waitScreen(C, 'result', 12000), waitScreen(W, 'result', 12000)]);
  check('W10 時間になると結果（途中から入った人・見る画面にも）', true);
  room = await roomOf(code);
  check('W11 結果はあそんだ2人', room.result.rows.length === 2);
  await H.page.click('#btnAgain');
  await waitScreen(C, 'waiting');
  await H.page.click('#btnStartGame');
  room = await roomWhen(code, (r) => r.status === 'play' && r.round);
  check('W12 つぎの回から入れる', room.round.players.includes('そら'));
  await waitScreen(C, 'play');

  // ── 退出・ルームを閉じる ──
  await C.page.click('#btnPlayEnd');
  await waitScreen(C, 'top');
  room = await roomWhen(code, (r) => !r.players['そら']);
  check('X1 退出すると在室から消える（回の人のまま）', !room.players['そら'] && room.round.players.includes('そら'));
  await rest('PATCH', `${ROOMS}/${code}/round`, { startedAt: Date.now() - (120 + 10) * 1000 });
  await waitScreen(A, 'result', 12000);
  room = await roomOf(code);
  check('X2 退出した人も結果に出る', room.result.rows.some((r) => r.name === 'そら'));
  await H.page.click('#btnLeave');
  await Promise.all([waitScreen(A, 'top'), waitScreen(B, 'top')]);
  check('X3 ルームを閉じると参加者はトップへ', true);
  check('X4 ルームが消える', (await roomOf(code)) === null);
  await waitScreen(W, 'watch-end');
  check('X5 みんなにみせる画面は終わりの表示', true);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
