// 将棋の E2E その4: 持ち時間・秒読み（ルームと1台の画面・時間切れ・表示）と、ルームの席の CPU
// （ホストの端末が指す・1手もどすで人の番まで・CPU が先手・参加者と CPU・CPU どうしは選べない）
const L = require('./lib.cjs');
const { check, waitFor } = L;

const clocks = (c) => c.page.$$eval('.sh-clock', (ns) => ns.map((n) => n.textContent));
const movesOf = (room) => (room?.game?.moves ? Object.keys(room.game.moves).length : 0);

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const G = await L.newClient('guest');
  const code = await L.createRoom(H, 'ほすと');
  await L.joinRoom(G, 'みどり', code);

  // ── 持ち時間の設定 ──
  check('T1 ホストに持ち時間の欄', (await L.visible(H, '#lobbyClock')) && (await H.page.inputValue('#clockMain')) === '0' && (await H.page.inputValue('#clockByo')) === '0');
  check('T2 参加者にははじめ「なし」', await waitFor(async () => (await L.text(G, '#lobbyClockView')) === 'なし'));
  await H.page.selectOption('#clockByo', '10');
  check('T3 ルームに秒読みが入る', !!(await L.roomWhen(code, (r) => r.clock && r.clock.b === 10 && r.clock.m === 0)));
  check('T4 参加者に設定が見える', await waitFor(async () => (await L.text(G, '#lobbyClockView')) === '持ち時間なし・秒読み 10秒'), await L.text(G, '#lobbyClockView'));

  await H.page.selectOption('#seat0', 'ほすと');
  await H.page.selectOption('#seat1', 'みどり');
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  await L.waitScreen(G, 'game');
  check('T5 時計が2つ出る', await waitFor(async () => (await clocks(G)).length === 2));
  check('T6 秒読みの表示', await waitFor(async () => (await clocks(H)).every((t) => /^秒読み \d+$/.test(t))), await clocks(H));
  check('T7 clock を数える', await L.waitStats(H, 'clock', 1));
  await L.move(H, 15, 10);
  check('T8 指すと時計がルームに残る', !!(await L.roomWhen(code, (r) => movesOf(r) === 1 && r.game.clock && r.game.clock.at > 0)));
  // 後手が指さないまま 10 秒（＋ずれの分）たつと時間切れ
  const out = await L.roomWhen(code, (r) => r.game && r.game.timeout === 'g', 20000);
  check('T9 時間切れが書かれる', !!out && out.game.timeout === 'g', out && out.game);
  check('T10 時間切れの結果', await waitFor(async () => (await L.status(G)) === '△後手（みどり）の時間が切れた。▲先手（ほすと）の勝ち！'), await L.status(G));
  check('T11 負けた側の時計は「時間切れ」', await waitFor(async () => (await clocks(H)).includes('時間切れ')), await clocks(H));
  check('T12 時間切れは1手もどせない', await H.page.isDisabled('#btnUndo'));
  await L.shot(H, 'e2e4-timeout');

  // ── ルームの CPU ──
  await H.page.click('#btnRelobby');
  await L.waitScreen(H, 'waiting');
  await H.page.selectOption('#clockMain', '3');
  await H.page.selectOption('#clockByo', '0');
  check('T13 持ち時間を変える', !!(await L.roomWhen(code, (r) => r.clock && r.clock.m === 3 && !r.clock.b)));
  const cpuOpts = await H.page.$$eval('#seat1 option', (os) => os.map((o) => o.textContent));
  check('T14 席に CPU の3つ', ['CPU（よわい）', 'CPU（ふつう）', 'CPU（つよい）'].every((x) => cpuOpts.includes(x)), cpuOpts);
  await H.page.selectOption('#seat1', '#cpu:weak');
  check('T15 参加者の画面に CPU の席', await waitFor(async () => (await L.text(G, '#seatView')).includes('CPU（よわい）')), await L.text(G, '#seatView'));
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  check('T16 ホストの番', (await L.status(H)) === 'あなたの番（▲先手）', await L.status(H));
  check('T17 持ち時間の表示', await waitFor(async () => (await clocks(H)).every((t) => /^残り [23]:\d\d$/.test(t))), await clocks(H));
  check('T18 room-cpu を数える', await L.waitStats(H, 'room-cpu', 1));
  await L.move(H, 15, 10);
  check('T19 CPU の番は「考え中」', await waitFor(async () => (await L.status(G)) === '△後手（CPU）が考え中'), await L.status(G));
  const r2 = await L.roomWhen(code, (r) => movesOf(r) === 2, 8000);
  check('T20 CPU が指す', movesOf(r2) === 2);
  check('T20b CPU は時間を使わない（CPU の持ち時間は減らない）', !!r2 && r2.game.clock.used.g === 0, r2 && r2.game.clock);
  check('T21 またホストの番', await waitFor(async () => (await L.status(H)).startsWith('あなたの番（▲先手）')), await L.status(H));
  await H.page.click('#btnUndo');
  check('T23 1手もどすで CPU の手と自分の手をもどす', !!(await L.roomWhen(code, (r) => movesOf(r) === 0)));
  // ホストの通信が切れている間は、CPU は指さない
  await waitFor(async () => (await L.status(H)).startsWith('あなたの番'));
  await L.move(H, 15, 10);
  await L.roomWhen(code, (r) => movesOf(r) === 1, 5000);
  await H.page.evaluate(() => firebase.database().goOffline());
  await L.sleep(3000);
  check('T23b 通信が切れている間は CPU が指さない', movesOf(await L.roomOf(code)) === 1);
  await H.page.evaluate(() => firebase.database().goOnline());
  check('T23c 通信がもどると CPU が指す', movesOf(await L.roomWhen(code, (r) => movesOf(r) === 2, 10000)) === 2);
  await waitFor(async () => (await L.status(H)).startsWith('あなたの番'));
  await H.page.click('#btnUndo');
  await L.roomWhen(code, (r) => movesOf(r) === 0);
  check('T24 もどしたあとも CPU は指さない（ホストの番）', await waitFor(async () => (await L.status(H)) === 'あなたの番（▲先手）'));
  await L.sleep(1500);
  check('T25 ホストの番のまま', movesOf(await L.roomOf(code)) === 0);
  await L.sleep(1200);
  await H.page.click('#btnResign');
  const rr = await L.roomWhen(code, (r) => r.game && r.game.resign === 's');
  check('T26 投了', !!rr);
  check('T26b 投了で番の人の使った時間をそろえて止める', !!rr && rr.game.clock.used.s >= 1000, rr && rr.game.clock);
  const frozen = await H.page.textContent('#sideBottom .sh-clock');
  await L.sleep(1200);
  check('T26c 投了のあと時計は止まり、もどらない', frozen !== '残り 3:00' && (await H.page.textContent('#sideBottom .sh-clock')) === frozen, frozen);
  // もう一回で CPU が先手になる → CPU から指す
  await H.page.click('#btnAgain');
  const r3 = await L.roomWhen(code, (r) => r.game && r.game.seats.s === '#cpu:weak' && movesOf(r) === 1, 8000);
  check('T27 もう一回で CPU が先手・先に指す', !!r3 && movesOf(r3) === 1, r3 && r3.game);
  check('T28 自分がまだ指していなければもどせない', await waitFor(async () => H.page.isDisabled('#btnUndo')));
  check('T29 後手の人が手前', (await H.page.textContent('#sideBottom .sh-side__label')).includes('後手（あなた）'));

  // 参加者と CPU（ホストは対戦しない）
  await H.page.click('#btnReset');
  await L.waitScreen(H, 'waiting');
  await H.page.selectOption('#seat0', 'みどり');
  await H.page.selectOption('#seat1', '#cpu:normal');
  await H.page.click('#btnStartGame');
  await L.waitScreen(G, 'game');
  check('T30 参加者の番', await waitFor(async () => (await L.status(G)) === 'あなたの番（▲先手）'), await L.status(G));
  check('T31 ホストは代わりに指せない（参加者がいる）', (await L.status(H)).includes('考え中'), await L.status(H));
  await L.move(G, 15, 10);
  const r4 = await L.roomWhen(code, (r) => movesOf(r) === 2, 8000);
  check('T32 ホストの端末で CPU が指す', movesOf(r4) === 2);
  check('T33 参加者は投了できる', await L.visible(G, '#btnResign'));
  await G.page.click('#btnResign');
  check('T34 参加者の投了', !!(await L.roomWhen(code, (r) => r.game && r.game.resign === 's')));

  // CPU どうしは選べない
  await H.page.click('#btnRelobby');
  await L.waitScreen(H, 'waiting');
  await H.page.selectOption('#seat0', '#cpu:weak');
  await H.page.selectOption('#seat1', '#cpu:strong');
  check('T35 CPU どうしは「はじめる」を押せない', await waitFor(async () => H.page.isDisabled('#btnStartGame')));
  check('T36 CPU どうしの知らせ', (await L.text(H, '#seatNote')).includes('CPU どうし'), await L.text(H, '#seatNote'));
  await H.page.setViewportSize({ width: 375, height: 800 });
  const seatW = await H.page.$eval('#seat0', (n) => n.getBoundingClientRect().width);
  check('T36b スマホ幅では席の選びが縦に並び、幅が広い', seatW > 280, seatW);
  await H.page.setViewportSize({ width: 1100, height: 900 });

  // ── 1台の画面の持ち時間 ──
  const M = await L.newClient('local');
  await L.open(M);
  await M.page.click('#btnGoLocal');
  await L.waitScreen(M, 'local');
  check('T37 1台の画面に持ち時間の欄（はじめはなし）', (await M.page.inputValue('#localClockMain')) === '0' && (await M.page.inputValue('#localClockByo')) === '0');
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  check('T38 持ち時間なしなら時計は出ない', (await clocks(M)).length === 0);
  await M.page.click('#btnQuit');
  await L.waitScreen(M, 'top');
  await M.page.click('#btnGoLocal');
  await L.waitScreen(M, 'local');
  await M.page.selectOption('#localClockByo', '10');
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  check('T39 秒読みの時計', (await clocks(M)).length === 2);
  await L.move(M, 15, 10);
  await M.page.reload();
  check('T40 読み込み直しても時計が続く', await waitFor(async () => (await L.screen(M)) === 'game' && (await clocks(M)).length === 2));
  check('T41 1台の画面の時間切れ', await waitFor(async () => (await L.status(M)) === '△後手の時間が切れた。▲先手の勝ち！', 20000), await L.status(M));
  check('T42 時間切れは1手もどせない', await M.page.isDisabled('#btnUndo'));
  await M.page.click('#btnAgain');
  check('T43 もう一回でも同じ持ち時間', await waitFor(async () => (await clocks(M)).length === 2 && (await L.status(M)).endsWith('の番')), await L.status(M));
  check('T43b 新しい対局でも時間切れになる', await waitFor(async () => (await L.status(M)) === '▲先手の時間が切れた。△後手の勝ち！', 20000), await L.status(M));
  await M.page.setViewportSize({ width: 375, height: 800 });
  check('T44 幅 375px ではみ出さない', !(await L.overflow(M)));
  // 盤は欄の実際の幅から大きさを決める（375px で盤の幅 330px 以上。本将棋のマス 37px 前後。2026-11-15）
  const boardW = await M.page.evaluate(() => {
    const n = document.querySelector('.sh-board').classList.contains('is-mini') ? 5 : 9;
    return document.querySelector('.sh-cell').getBoundingClientRect().width * n;
  });
  check('T44b 幅 375px で盤を大きく出す', boardW >= 330, boardW);
  await L.shot(M, 'e2e4-local-375');
  const clockLeftX = await M.page.$eval('#sideBottom .sh-clock', (n) => n.getBoundingClientRect().right);
  check('T45 スマホ幅で時計が右下の丸ボタンにかからない（左寄り）', clockLeftX < 240, clockLeftX);
  await M.page.click('#btnAid');
  await M.page.waitForSelector('#aidDialog[open]');
  const gap = await M.page.$eval('#aidDialog', (n) => { const b = n.getBoundingClientRect(); return [b.left, window.innerWidth - b.right, b.top, window.innerHeight - b.bottom]; });
  check('T46 補助の設定のダイアログが画面の中央に出る', Math.abs(gap[0] - gap[1]) < 4 && Math.abs(gap[2] - gap[3]) < 4, gap);
  await M.page.click('#btnAidClose');

  await L.finishAll(server);
})();
