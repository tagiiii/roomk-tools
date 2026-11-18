// 五目並べ E2E その3: 1台の画面（名前・補助・たしかめる・1手もどす・読み込み直し・勝ち・もう一回・制限時間と CPU・CPU と対戦・キーボード・幅 375px）
// 通信はしないが、ほかのテストと同じ写し（エミュレーター向け）で開く
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, cell } = L;
const at = (s) => E.COLS.indexOf(s[0]) + (Number(s.slice(1)) - 1) * E.SIZE;

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const P = await L.newClient('local', { viewport: { width: 1280, height: 800 } });
    const go = async (opts = {}) => {
      await P.page.click('#btnGoLocal');
      await P.page.check('input[name="localVs"][value="' + (opts.vs || '') + '"]', { force: true });
      if (opts.level) await P.page.check('input[name="localLevel"][value="' + opts.level + '"]', { force: true });
      if (!opts.vs) {
        await P.page.fill('#localNameB', 'メンター');
        await P.page.fill('#localNameW', 'あおい');
      }
      await P.page.selectOption('#localMoveTime', opts.moveTime || '0');
      await P.page.click('#btnLocalStart');
      await L.waitScreen(P, 'game');
    };
    const put = async (s) => { await P.page.click(cell(at(s))); };

    await L.open(P);
    check('L0 top lead', (await L.text(P, '.app-entry__lead')).includes('5つならべた'));
    await P.page.click('#btnGoLocal');
    await P.page.fill('#localNameB', 'あ');
    await P.page.fill('#localNameW', 'い');
    await P.page.click('#btnLocalSwap');
    check('L1 名前の入れかえ', (await P.page.inputValue('#localNameB')) === 'い' && (await P.page.inputValue('#localNameW')) === 'あ');
    const aidLabels = await P.page.$$eval('#localAid .gm-check__label', (xs) => xs.map((x) => x.textContent));
    check('L1b 補助の項目', aidLabels.join('|') === 'あと1つで5つのしるし|おすすめの手|直前の手のしるし|置く前にたしかめる', aidLabels);
    const aidChecked = await P.page.$$eval('#localAid input[type=checkbox]', (xs) => xs.map((x) => x.checked));
    check('L1c 補助のはじめの値', JSON.stringify(aidChecked) === '[true,true,true,false]', aidChecked);
    await P.page.click('#btnLocalBack');
    await go();
    check('L2 local-start', await L.waitStats(P, 'local-start', 1));
    check('L3 ルームバーは出ない', !(await L.visible(P, '#roomBar')) && await L.visible(P, '#appBar'));
    check('L4 黒から・空の盤', (await L.turnOf(P)) === 'b' && (await L.readBoard(P)) === E.emptyBoard());
    check('L5 番の表示', (await L.status(P)) === '黒（メンター）の番だよ', await L.status(P));
    check('L6 おすすめは真ん中', JSON.stringify(await L.marked(P, 'is-hint')) === JSON.stringify([E.CENTER]));
    check('L7 残り時間は出ない', (await L.clockText(P)) === '');
    // キーボードで置く
    await P.page.focus(cell(at('H8')));
    await P.page.keyboard.press('Enter');
    await waitFor(async () => (await L.turnOf(P)) === 'w');
    check('L8 キーボードで置いて、そのますにとどまる', (await P.page.evaluate(() => document.activeElement?.dataset?.i)) === String(at('H8')));
    check('L9 直前の手のしるし', JSON.stringify(await L.lastMark(P)) === JSON.stringify([at('H8')]));
    await put('H8');
    check('L10 置いてある所はお知らせ', await waitFor(async () => (await L.text(P, '#roomk-toast') || '').includes('もう石がある')));
    await P.page.click('#btnUndo');
    check('L11 1手もどす', (await L.readBoard(P)) === E.emptyBoard() && (await L.turnOf(P)) === 'b' && await P.page.isDisabled('#btnUndo'));

    // 補助の設定: たしかめる
    await P.page.click('#btnAid');
    await P.page.waitForSelector('#aidDialog[open]');
    const gap = await P.page.$eval('#aidDialog', (n) => { const b = n.getBoundingClientRect(); return [b.left, window.innerWidth - b.right, b.top, window.innerHeight - b.bottom]; });
    check('L12 補助の設定が中央', Math.abs(gap[0] - gap[1]) < 4 && Math.abs(gap[2] - gap[3]) < 4, gap);
    await P.page.screenshot({ path: L.OUT + '/e2e3-aid-dialog.png' });
    await P.page.check('#dialogAid input[data-key=confirm]');
    await P.page.click('#btnAidClose');
    await put('H8');
    check('L13 たしかめるときは1回では置かない', (await L.readBoard(P)) === E.emptyBoard() && (await L.text(P, '#confirmText')).includes('H8 に置く？'));
    await P.page.click('#btnUnpick');
    check('L14 やめる', !(await L.visible(P, '#confirmBox')));
    await put('H8'); await put('H8');
    check('L15 同じ場所を2回で置く', (await L.readBoard(P))[at('H8')] === 'b');
    await put('A1');
    await P.page.click('#btnPlace');
    check('L16 「ここに置く」で置く', (await L.readBoard(P))[at('A1')] === 'w' && (await L.turnOf(P)) === 'b');
    // 黒の人だけ
    await P.page.click('#btnAid');
    await P.page.click('#dialogAid .gm-seg__opt:nth-child(2)');
    await P.page.uncheck('#dialogAid input[data-key=confirm]');
    await P.page.click('#btnAidClose');
    check('L17 黒の人だけ: 黒の番は出る', (await L.marked(P, 'is-hint')).length === 1 && (await L.lastMark(P)).length === 1);
    await put('I8');
    check('L18 黒の人だけ: 白の番は出ない', (await L.turnOf(P)) === 'w' && (await L.marked(P, 'is-hint')).length === 0 && (await L.lastMark(P)).length === 0);
    await P.page.click('#btnAid');
    await P.page.click('#dialogAid .gm-seg__opt:nth-child(1)');
    await P.page.click('#btnAidClose');
    const before = await L.readBoard(P);
    await P.page.reload();
    await L.waitScreen(P, 'game');
    check('L19 読み込み直すと続きから', (await L.readBoard(P)) === before && (await L.turnOf(P)) === 'w');

    // 勝ち（黒が H8〜L8）
    for (const s of ['A2', 'J8', 'A3', 'K8', 'A4']) await put(s);
    check('L20 白が4つ目の前: 黒に5つの輪', JSON.stringify(await L.marked(P, 'is-five')) === JSON.stringify([at('G8'), at('L8')].sort((a, b) => a - b)), await L.marked(P, 'is-five'));
    check('L21 相手（白）の4つも赤い輪', JSON.stringify(await L.marked(P, 'is-block')) === JSON.stringify([at('A5')]), await L.marked(P, 'is-block'));
    await put('L8');
    check('L22 勝ち', await waitFor(async () => (await L.status(P)).includes('黒（メンター）の勝ち')), await L.status(P));
    check('L23 5つのならび', (await L.lineCells(P)).length === 5);
    check('L24 local-finish', await L.waitStats(P, 'local-finish', 1));
    check('L25 結果のボタン', (await L.text(P, '#btnAgain')) === 'もう一回（黒と白を入れかえる）' && (await L.text(P, '#btnRelobby')) === '名前と補助を変える');
    await L.shot(P, 'local-result');
    await P.page.click('#btnUndo');
    check('L26 おわったあと1手もどす', !(await L.visible(P, '#resultBox')) && (await L.turnOf(P)) === 'b');
    await put('L8');
    await sleep(200);
    check('L27 終えなおしても数えない', (await L.stats(P, 'local-finish')) === 1);
    await P.page.click('#btnAgain');
    check('L28 もう一回で名前を入れかえ', (await L.status(P)) === '黒（あおい）の番だよ' && (await L.readBoard(P)) === E.emptyBoard(), await L.status(P));
    await P.page.click('#btnQuit');
    await L.waitScreen(P, 'top');

    // 制限時間（時計を早送り）
    const Q = await L.newClient('local-time', { viewport: { width: 1280, height: 800 } });
    await Q.page.clock.install();
    await L.open(Q);
    await Q.page.click('#btnGoLocal');
    await Q.page.selectOption('#localMoveTime', '15');
    await Q.page.click('#btnLocalStart');
    await L.waitScreen(Q, 'game');
    await Q.page.clock.runFor(1000);
    check('T1 残り時間', /^b:のこり 1[45]秒$/.test(await L.clockText(Q)), await L.clockText(Q));
    await Q.page.clock.runFor(11000);
    check('T2 5秒から色', await Q.page.$eval('.gm-seat--b .gm-seat__clock', (x) => x.classList.contains('is-hurry')));
    await Q.page.clock.runFor(4000);
    check('T3 時間切れで CPU が置く', (await L.readBoard(Q))[E.CENTER] === 'b' && (await L.status(Q)).startsWith('時間切れ。CPU が黒の代わりに H8 に置いたよ。'), await L.status(Q));
    check('T4 次の番は最初から', /^w:のこり 1[45]秒$/.test(await L.clockText(Q)), await L.clockText(Q));
    await Q.page.close();

    // CPU と対戦（自分が黒・つよい）
    await go({ vs: 'w', level: 'strong' });
    check('C1 自分の札に（あなた）・CPU の名前', (await L.text(P, '.gm-seat--b')).includes('あなた') && (await L.text(P, '.gm-seat--w')).includes('CPU'));
    await put('H8');
    check('C2 CPU の番は考え中', (await L.status(P)).includes('白（CPU）が考え中'), await L.status(P));
    check('C3 CPU の番は補助の印を出さない', (await L.marked(P, 'is-hint')).length === 0);
    check('C4 CPU が置く', await waitFor(async () => (await L.turnOf(P)) === 'b', 4000));
    check('C5 お知らせ', /^CPU は [A-O]\d+ に置いたよ。/.test(await L.status(P)), await L.status(P));
    await P.page.click('#btnUndo');
    check('C6 CPU の手と自分の手をいっしょにもどす', (await L.readBoard(P)) === E.emptyBoard() && (await L.turnOf(P)) === 'b');
    // CPU が黒（自分が白・よわい）: CPU が先に置く
    await P.page.click('#btnQuit');
    await L.waitScreen(P, 'top');
    await go({ vs: 'b', level: 'weak' });
    check('C7 CPU が先に置く', await waitFor(async () => (await L.readBoard(P)).includes('b'), 4000));
    check('C8 自分がまだ置いていなければもどせない', await P.page.isDisabled('#btnUndo'));
    // 読み込み直しても CPU のお知らせが残る
    await P.page.reload();
    await L.waitScreen(P, 'game');
    check('C9 読み込み直しても CPU のお知らせ', (await L.status(P)).startsWith('CPU は '), await L.status(P));

    // 幅 375px
    await P.page.setViewportSize({ width: 375, height: 760 });
    await sleep(300);
    check('M1 375 はみ出さない', (await L.overflow(P)) <= 0, await L.overflow(P));
    await L.shot(P, 'local-375');
    await P.page.click('#btnQuit');
    await L.waitScreen(P, 'top');
    await P.page.click('#btnGoLocal');
    check('M2 375 準備の画面もはみ出さない', (await L.overflow(P)) <= 0);
    await L.shot(P, 'local-setup-375');
  } catch (e) {
    check('exception', false, String(e && e.stack || e));
  }
  await L.finishAll(server);
})();
