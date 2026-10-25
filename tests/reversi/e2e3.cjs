// リバーシ E2E その3: 1台の画面（名前・補助・たしかめる・1手もどす・読み込み直し・パス・最後まで・もう一回・制限時間と CPU・幅）
// 通信はしないが、ほかのテストと同じ写し（エミュレーター向け）で開く
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, cell } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const P = await L.newClient('local', { viewport: { width: 1280, height: 800 } });
  const go = async (moveTime = '0') => {
    await P.page.click('#btnGoLocal');
    await P.page.fill('#localNameB', 'メンター');
    await P.page.fill('#localNameW', 'あおい');
    await P.page.selectOption('#localMoveTime', moveTime);
    await P.page.click('#btnLocalStart');
    await L.waitScreen(P, 'game');
  };

  await L.open(P);
  await P.page.click('#btnGoLocal');
  await P.page.fill('#localNameB', 'あ');
  await P.page.fill('#localNameW', 'い');
  await P.page.click('#btnLocalSwap');
  check('L1 名前の入れかえ', (await P.page.inputValue('#localNameB')) === 'い' && (await P.page.inputValue('#localNameW')) === 'あ');
  await P.page.click('#btnLocalBack');
  await go();
  check('L2 local-start を数える', await L.waitStats(P, 'local-start', 1));
  check('L3 ルームバーは出ない', !(await L.visible(P, '#roomBar')) && await L.visible(P, '#appBar'));
  check('L4 はじめは 2 対 2・黒から', JSON.stringify(await L.counts(P)) === '[2,2]' && (await L.turnOf(P)) === 'b');
  check('L5 置ける場所が4つ出る', JSON.stringify(await L.spots(P)) === JSON.stringify([19, 26, 37, 44]), await L.spots(P));
  check('L6 番の表示', (await L.status(P)) === '黒（メンター）の番だよ', await L.status(P));
  check('L7 制限時間なしなら残り時間は出ない', (await L.clockText(P)) === '');
  await P.page.click(cell(0));
  check('L8 置けない場所はお知らせ', await waitFor(async () => (await L.text(P, '#roomk-toast') || '').includes('置けない')));
  await P.page.click(cell(19));
  check('L9 D3 で 4 対 1・白の番', JSON.stringify(await L.counts(P)) === '[4,1]' && (await L.turnOf(P)) === 'w');
  check('L10 直前の石に印・ひっくり返る動き', await P.page.$eval(cell(19), (x) => x.classList.contains('is-last')) && await P.page.$eval(cell(27), (x) => x.firstChild.classList.contains('is-flip')));
  await P.page.click('#btnUndo');
  check('L11 1手もどす', JSON.stringify(await L.counts(P)) === '[2,2]' && (await L.turnOf(P)) === 'b' && await P.page.isDisabled('#btnUndo'));

  // 補助の設定
  await P.page.click('#btnAid');
  await P.page.check('#dialogAid input[data-key=count]');
  await P.page.check('#dialogAid input[data-key=confirm]');
  await P.page.click('#btnAidClose');
  check('L12 ひっくり返る数が出る', (await P.page.$$eval('#board .rv-mark.is-count', (xs) => xs.map((x) => x.textContent))).join() === '1,1,1,1');
  await P.page.click(cell(19));
  check('L13 たしかめるときは1回では置かない', JSON.stringify(await L.counts(P)) === '[2,2]' && (await L.text(P, '#confirmText')).includes('D3 に置くと、1こ'));
  check('L14 ひっくり返る石が光る', await P.page.$eval(cell(27), (x) => x.classList.contains('is-will-flip')));
  await P.page.click('#btnUnpick');
  check('L15 やめる', !(await L.visible(P, '#confirmBox')));
  await P.page.click(cell(26));
  await P.page.click(cell(26));
  check('L16 同じ場所を2回で置く', JSON.stringify(await L.counts(P)) === '[4,1]');
  await P.page.click(cell(18));
  await P.page.click('#btnPlace');
  check('L17 「ここに置く」で置く', (await L.turnOf(P)) === 'b');
  await P.page.click('#btnAid');
  await P.page.click('#dialogAid .rv-seg__opt:nth-child(2)');
  await P.page.uncheck('#dialogAid input[data-key=confirm]');
  await P.page.click('#btnAidClose');
  check('L18 黒の人だけ: 黒の番は出る', (await L.spots(P)).length > 0);
  let board = await L.readBoard(P);
  await P.page.click(cell(Number(Object.keys(E.legalMoves(board, 'b'))[0])));
  check('L19 黒の人だけ: 白の番は出ない', (await L.turnOf(P)) === 'w' && (await L.spots(P)).length === 0);
  const before = await L.readBoard(P);
  await P.page.reload();
  await L.waitScreen(P, 'game');
  check('L20 読み込み直すと続きから', (await L.readBoard(P)) === before);

  // 最後まで
  for (let k = 0; k < 80; k += 1) {
    if (await L.visible(P, '#resultBox')) break;
    const t = await L.turnOf(P);
    const mv = Object.keys(E.legalMoves(await L.readBoard(P), t)).map(Number);
    if (!mv.length) break;
    await P.page.click(cell(mv[Math.floor(Math.random() * mv.length)]));
  }
  check('L21 最後までいくとボタンが出る', await L.visible(P, '#resultBox') && await L.visible(P, '#btnAgain'));
  const [nb, nw] = await L.counts(P);
  const st = await L.status(P);
  check('L22 勝ちの表示', st.startsWith(nb === nw ? '引き分け！' : nb > nw ? '黒（メンター）の勝ち！' : '白（あおい）の勝ち！') && st.endsWith('黒 ' + nb + ' ー 白 ' + nw), st);
  check('L23 local-finish を数える', await L.waitStats(P, 'local-finish', 1));
  await sleep(600);
  await L.shot(P, 'local-result');
  await P.page.click('#btnAgain');
  check('L24 もう一回で黒と白が入れかわる', (await L.text(P, '.rv-seat--b .rv-seat__name')) === 'あおい' && JSON.stringify(await L.counts(P)) === '[2,2]');
  await P.page.click('#btnQuit');
  check('L25 トップへ戻る', (await L.screen(P)) === 'top');

  // パスの局面: でたらめに打って、次の1手で相手がパスになる局面を探す
  let found = null;
  for (let t = 0; t < 3000 && !found; t += 1) {
    let g = E.newGame();
    while (!g.over && !found) {
      const mv = Object.keys(E.legalMoves(g.board, g.turn)).map(Number);
      const ng = E.play(g, mv[Math.floor(Math.random() * mv.length)]);
      if (ng.passed) found = { g, i: ng.last, ng };
      g = ng;
    }
  }
  await P.page.evaluate((s) => sessionStorage.setItem('reversi_local', JSON.stringify(s)), {
    names: { b: 'くろ', w: 'しろ' }, aid: { who: 'both', spots: true, count: false, confirm: false },
    game: { ...found.g, ply: 5, hist: [], moveTime: 0 },
  });
  await P.page.reload();
  await L.waitScreen(P, 'game');
  await P.page.click(cell(found.i));
  const pc = found.ng.passed;
  const pst = await L.status(P);
  check('P1 パスのお知らせと、つづけて置く', pst.startsWith((pc === 'b' ? '黒（くろ）' : '白（しろ）') + 'は置ける場所がないので、パス') && (await L.turnOf(P)) === E.other(pc), pst);
  await P.page.click('#btnQuit');

  // 制限時間（15秒）と CPU
  await go('15');
  check('M1 残り時間が出る', /^b:のこり 1[45]秒$/.test(await L.clockText(P)), await L.clockText(P));
  check('M2 時間切れで CPU が黒の代わりに置く', await waitFor(async () => (await L.status(P)).startsWith('時間切れ。CPU が黒の代わりに'), 20000), await L.status(P));
  check('M3 白の番になり、時間は最初から', (await L.turnOf(P)) === 'w' && /^w:のこり 1[45]秒$/.test(await L.clockText(P)), await L.clockText(P));
  await sleep(1500);
  await P.page.click('#btnUndo');
  check('M4 1手もどすと時間も最初から', (await L.turnOf(P)) === 'b' && /^b:のこり 1[45]秒$/.test(await L.clockText(P)) && !(await L.status(P)).includes('時間切れ'), await L.clockText(P));
  await L.shot(P, 'local-clock');

  // 幅
  await P.page.setViewportSize({ width: 375, height: 760 });
  await sleep(300);
  check('W1 375px で横にはみ出さない', (await L.overflow(P)) <= 0);
  await L.shot(P, 'local-375');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
