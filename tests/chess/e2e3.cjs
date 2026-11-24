// チェスの E2E その3: 1台の画面（名前・指す・指せない理由・成る・盤の向き・1手もどす・読み込み直し・投了・もう一回・CPU と対戦・時間切れ・幅 375px）と、
// ルームの席の CPU（ホストの端末が指す・人の番までもどす）・持ち時間の時間切れ
const L = require('./lib.cjs');
const { check, cell, sq, waitFor } = L;
const clocks = (c) => c.page.$$eval('.ch-clock', (xs) => xs.map((x) => x.textContent));
const movesOf = (r) => (r && r.game && r.game.moves ? Object.keys(r.game.moves).length : 0);

(async () => {
  const server = await L.startServer();
  await L.launch();
  const M = await L.newClient('local');
  await L.open(M);
  await M.page.click('#btnGoLocal');
  await L.waitScreen(M, 'local');
  check('L1 補助のはじめは全部オン', (await M.page.isChecked('#localAid input[data-key="spots"]')) && (await M.page.isChecked('#localAid input[data-key="names"]')) && (await M.page.isChecked('#localAid input[data-key="hint"]')));
  await M.page.fill('#localName0', 'あおい');
  await M.page.fill('#localName1', 'そら');
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  check('L2 64マス', (await M.page.$$('#board .ch-cell')).length === 64);
  check('L3 番の表示', (await L.status(M)) === '白（あおい）の番', await L.status(M));
  check('L4 local-start を数える', await L.waitStats(M, 'local-start', 1));
  check('L5 ルームのバーは出ない', !(await L.visible(M, '#roomBar')));
  // キーボードで指す
  await M.page.focus(cell(sq('e2')));
  await M.page.keyboard.press('Enter');
  check('L6 キーボードで選んでもそのますにとどまる', (await M.page.evaluate(() => document.activeElement?.dataset?.i)) === String(sq('e2')));
  await M.page.focus(cell(sq('e4')));
  await M.page.keyboard.press('Enter');
  await waitFor(async () => (await L.status(M)) === '黒（そら）の番');
  check('L7 黒の番', (await L.status(M)) === '黒（そら）の番', await L.status(M));
  // ピン: 黒 d7d6 → 白 f1b5+ → 黒の c7 は… チェック中に関係ない駒は動かせない理由
  await L.move(M, sq('d7'), sq('d6'));
  await L.move(M, sq('f1'), sq('b5'));
  check('L8 チェックの札', (await L.status(M)).includes('チェック'), await L.status(M));
  check('L8b キングのますが赤い', (await M.page.$$('#board .ch-cell.is-check')).length === 1);
  await M.page.click(cell(sq('h7')));
  check('L9 チェックをよけない駒には動ける所がない', (await L.text(M, '#gameMsg')).includes('チェックをよけて'), await L.text(M, '#gameMsg'));
  await L.move(M, sq('c7'), sq('c6'));
  check('L10 表記', (await L.lastLine(M)) === '4手目　黒：ポーン c7→c6（c6）', await L.lastLine(M));
  // 盤の向き
  await M.page.click('#btnFlip');
  check('L11 盤の向きを変えると左上が h1', (await M.page.getAttribute('#board .ch-cell >> nth=0', 'data-i')) === '63');
  await M.page.click('#btnFlip');
  // 1手もどす・読み込み直し
  await M.page.click('#btnUndo');
  check('L12 1手もどす', (await L.lastLine(M)).startsWith('3手目') && (await L.text(M, '#gameMsg')) === '1手もどしたよ。', await L.lastLine(M));
  await M.page.reload();
  check('L13 読み込み直すと続きから', await waitFor(async () => (await L.screen(M)) === 'game' && (await L.lastLine(M)).startsWith('3手目')));
  // 投了
  await M.page.click('#btnResign');
  check('L14 投了', await waitFor(async () => (await L.status(M)).includes('黒（そら）が投了。白（あおい）の勝ち！')), await L.status(M));
  check('L15 local-finish', await L.waitStats(M, 'local-finish', 1));
  // 棋譜をコピー（2026-11-24）。国際式で「1. e4 d6」と白と黒を1行に・名前と結果つき
  await M.page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await M.page.click('#btnCopyKifu');
  await waitFor(async () => M.page.evaluate(() => window.__copied));
  const kifu = await M.page.evaluate(() => window.__copied);
  const wantKifu = ['チェス', '白: あおい', '黒: そら', '', '1. e4 d6', '2. Bb5+', '', '黒（そら）が投了。白（あおい）の勝ち！'].join('\n');
  check('L15b 棋譜をコピー（名前・国際式・結果）', kifu === wantKifu, kifu);
  check('L15c コピーの知らせ', await waitFor(async () => (await M.page.textContent('body')).includes('棋譜をコピーしました')));
  // もう一回（白と黒を入れかえる）
  await M.page.click('#btnAgain');
  check('L16 もう一回で名前が入れかわる', await waitFor(async () => (await L.status(M)) === '白（そら）の番'), await L.status(M));
  // 成る（1台の画面）: 局面を作って最後だけ画面で
  await M.page.evaluate(() => {
    const L = JSON.parse(sessionStorage.getItem('chess_local'));
    const sqn = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
    L.moves = 'a2a4 h7h5 a4a5 h5h4 a5a6 h4h3 a6b7 h3g2'.split(' ').map((s) => ({ from: sqn(s.slice(0, 2)), to: sqn(s.slice(2, 4)), promo: '' }));
    sessionStorage.setItem('chess_local', JSON.stringify(L));
  });
  await M.page.reload();
  await L.waitScreen(M, 'game');
  await M.page.click(cell(sq('b7')));
  check('L17 成れる駒の説明', (await L.text(M, '#pieceInfo')).includes('いちばん奥まで進むと'), await L.text(M, '#pieceInfo'));
  await M.page.click(cell(sq('a8')));
  await M.page.waitForSelector('#promoDialog[open]');
  const promoBox = await M.page.evaluate(() => { const r = document.getElementById('promoDialog').getBoundingClientRect(); return [r.left, innerWidth - r.right]; });
  check('L18 何になるかのダイアログが中央', Math.abs(promoBox[0] - promoBox[1]) < 4, promoBox);
  await M.page.keyboard.press('Escape');
  check('L19 Esc でやめると指さない', (await L.lastLine(M)).startsWith('8手目'), await L.lastLine(M));
  await L.move(M, sq('b7'), sq('a8'), 'Q');
  check('L20 クイーンになる', (await L.lastLine(M)).includes('クイーンになった') && (await L.lastLine(M)).includes('bxa8=Q'), await L.lastLine(M));

  // CPU と対戦（1台の画面）
  await M.page.click('#btnQuit');
  await L.waitScreen(M, 'top');
  await M.page.click('#btnGoLocal');
  await M.page.click('#localVs input[value="1"]');
  check('L21 CPU を選ぶと強さの欄', await L.visible(M, '#localLevelBox'));
  await M.page.click('#localLevel input[value="weak"]');
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  check('L22 あなたの番', (await L.status(M)) === 'あなたの番（白）', await L.status(M));
  await L.move(M, sq('d2'), sq('d4'));
  check('L23 CPU が考え中', (await L.status(M)).includes('CPU）が考え中'), await L.status(M));
  check('L24 CPU が指す', await waitFor(async () => (await L.status(M)) === 'あなたの番（白）', 8000), await L.status(M));
  await M.page.click('#btnUndo');
  check('L25 1手もどすと CPU の手と自分の手がもどる', await waitFor(async () => (await L.lastLine(M)) === ''), await L.lastLine(M));
  // 時間切れ（秒読み 10 秒）
  await M.page.click('#btnQuit');
  await L.waitScreen(M, 'top');
  await M.page.click('#btnGoLocal');
  await L.waitScreen(M, 'local');
  await M.page.click('#localVs input[value=""]');
  await M.page.selectOption('#localClockByo', '10');
  await M.page.click('#btnLocalStart');
  check('L26 時計が2つ', (await clocks(M)).length === 2, await clocks(M));
  check('L27 時間切れ（相手に駒があれば負け）', await waitFor(async () => (await L.status(M)).includes('白の時間が切れた。黒の勝ち！'), 20000), await L.status(M));
  check('L28 時間切れはもどせない', await M.page.isDisabled('#btnUndo'));
  // 幅 375px
  await M.page.setViewportSize({ width: 375, height: 760 });
  check('L29 幅 375px ではみ出さない', !(await L.overflow(M)), await L.overflow(M));
  const boardW = await M.page.$eval('#board .ch-board', (x) => x.getBoundingClientRect().width);
  check('L30 幅 375px で盤を大きく出す', boardW >= 330, boardW);
  await L.shot(M, 'e3-mobile-local');
  await M.page.setViewportSize({ width: 1100, height: 900 });

  // ── ルームの席の CPU ──
  const H = await L.newClient('host');
  const code = await L.createRoom(H, 'ほすと');
  const G = await L.newClient('guest');
  await L.joinRoom(G, 'みどり', code);
  await H.page.selectOption('#seat0', 'ほすと');
  await H.page.selectOption('#seat1', '#cpu:normal');
  await L.roomWhen(code, (r) => r.seats.w === 'ほすと' && r.seats.b === '#cpu:normal');
  check('R1 参加者の画面に CPU の席', await waitFor(async () => (await L.text(G, '#seatView')).includes('CPU（ふつう）')), await L.text(G, '#seatView'));
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  check('R2 ホストの番', (await L.status(H)) === 'あなたの番（白）', await L.status(H));
  await L.move(H, sq('e2'), sq('e4'));
  check('R3 CPU の番は考え中', await waitFor(async () => (await L.status(G)) === '黒（CPU）が考え中'), await L.status(G));
  const r2 = await L.roomWhen(code, (r) => movesOf(r) === 2, 10000);
  check('R4 CPU が指す', movesOf(r2) === 2);
  check('R5 room-cpu を数える', await L.waitStats(H, 'room-cpu', 1));
  await H.page.click('#btnUndo');
  check('R6 1手もどすで CPU の手と自分の手をもどす', !!(await L.roomWhen(code, (r) => movesOf(r) === 0)));
  // CPU どうしは選べない
  await H.page.click('#btnReset');
  await L.waitScreen(H, 'waiting');
  await H.page.selectOption('#seat0', '#cpu:weak');
  check('R7 CPU どうしは「はじめる」を押せない', await waitFor(async () => H.page.isDisabled('#btnStartGame')));
  // 持ち時間（ルーム・秒読み 10 秒）で時間切れ
  await H.page.selectOption('#seat0', 'みどり');
  await H.page.selectOption('#seat1', 'ほすと');
  await H.page.click('#btnLobbySet');
  await H.page.selectOption('#clockByo', '10');
  await H.page.click('#btnLobbySetClose');
  await L.roomWhen(code, (r) => r.clock && r.clock.b === 10 && r.seats.w === 'みどり' && r.seats.b === 'ほすと');
  check('R8 参加者に設定が見える', await waitFor(async () => (await L.text(G, '#sumClock')) === '持ち時間なし・秒読み 10秒'), await L.text(G, '#sumClock'));
  await H.page.click('#btnStartGame');
  await L.waitScreen(G, 'game');
  await L.move(G, sq('e2'), sq('e4'));
  const out = await L.roomWhen(code, (r) => r.game && r.game.timeout, 20000);
  check('R9 時間切れが書かれる', !!out && out.game.timeout === 'b', out && out.game);
  check('R10 時間切れの結果', await waitFor(async () => (await L.status(G)) === '黒（ほすと）の時間が切れた。白（みどり）の勝ち！'), await L.status(G));
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
