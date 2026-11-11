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

  // CPU と対戦する（2026-11-11）
  await P.page.click('#btnQuit');
  await P.page.click('#btnGoLocal');
  check('C0 はじめは「人どうし」・CPU の強さは出ない', await P.page.isChecked('input[name="localVs"][value=""]') && !(await L.visible(P, '#localLevelBox')));
  await P.page.click('label:has(input[name="localVs"][value="w"])');
  check('CL1 CPU にすると強さが出て、はじめは「ふつう」', await L.visible(P, '#localLevelBox') && await P.page.isChecked('input[name="localLevel"][value="normal"]'));
  await P.page.click('label:has(input[name="localLevel"][value="strong"])');
  check('C1 CPU（自分が黒）にすると、白の名前の欄は押せない', await P.page.isDisabled('#localNameW') && !(await P.page.isDisabled('#localNameB')) && await P.page.isDisabled('#btnLocalSwap'));
  await P.page.fill('#localNameB', 'そら');
  await P.page.selectOption('#localMoveTime', '0');
  await P.page.click('#btnLocalStart');
  await L.waitScreen(P, 'game');
  const seatText = () => P.page.$eval('#seats', (x) => x.textContent);
  check('C2 自分の番と（あなた）・白は CPU', (await L.status(P)).startsWith('あなたの番だよ（黒）') && (await seatText()).includes('黒（あなた）') && (await seatText()).includes('CPU'), [await L.status(P), await seatText()]);
  await P.page.click(cell(19));
  check('C3 置くと CPU の番（考え中）', (await L.status(P)) === '白（CPU）が考え中' && (await L.turnOf(P)) === 'w', await L.status(P));
  // CPU が置く前（0.9秒の間）に、白の置ける場所を押して、その場で数える
  const c4 = await P.page.evaluate(() => {
    const spot = document.querySelector('#board .rv-cell .rv-mark.is-spot')?.parentElement
      || [...document.querySelectorAll('#board .rv-cell')].find((x) => !x.querySelector('.rv-stone'));
    spot?.click();
    return [...document.querySelectorAll('#seats .rv-seat__count')].map((x) => Number(x.textContent));
  });
  check('C4 CPU の番は押しても置けない', JSON.stringify(c4) === '[4,1]', c4);
  check('C5 少し待つと CPU が置き、どこに置いたか出る', await waitFor(async () => (await L.turnOf(P)) === 'b' && /^CPU は [A-H][1-8] に置いたよ。あなたの番だよ（黒）/.test(await L.status(P)), 4000), await L.status(P));
  const sum = (await L.counts(P)).reduce((a, b) => a + b, 0);
  check('C6 石は6こ（2手ぶん）', sum === 6, await L.counts(P));
  await P.page.reload();
  await L.waitScreen(P, 'game');
  check('C7 読み込み直しても CPU と対戦のまま', (await L.status(P)).includes('あなたの番だよ（黒）') && (await seatText()).includes('CPU'), await L.status(P));
  const savedLevel = await P.page.evaluate(() => JSON.parse(sessionStorage.getItem('reversi_local') || '{}').level);
  check('CL2 選んだ強さ（つよい）で対戦し、読み込み直しても残る', savedLevel === 'strong', savedLevel);
  await P.page.click('#btnUndo');
  check('C8 1手もどすと、CPU の手と自分の手をいっしょにもどす', JSON.stringify(await L.counts(P)) === '[2,2]' && (await L.turnOf(P)) === 'b' && await P.page.isDisabled('#btnUndo'), await L.counts(P));
  await sleep(1300);
  check('C9 もどしたあと CPU は勝手に置かない', JSON.stringify(await L.counts(P)) === '[2,2]', await L.counts(P));
  // 最後まで（自分は置ける場所の最初に置く）
  const playToEnd = async (me) => {
    for (let guard = 0; guard < 300; guard += 1) {
      if (await L.visible(P, '#resultBox')) return;
      if ((await L.turnOf(P)) === me && !(await L.status(P)).includes('考え中')) {
        const sp = await L.spots(P);
        if (sp.length) await P.page.click(cell(sp[0]));
      }
      await sleep(250);
    }
  };
  await playToEnd('b');
  check('C10 CPU と最後まで遊べる', await L.visible(P, '#resultBox') && /の勝ち！|引き分け！/.test(await L.status(P)), await L.status(P));
  await L.shot(P, 'local-cpu-result');
  await P.page.click('#btnAgain');
  check('C11 もう一回で黒と白を入れかえ、CPU が黒で先に置く', await waitFor(async () => (await L.turnOf(P)) === 'w' && (await L.status(P)).startsWith('CPU は '), 4000) && (await seatText()).includes('白（あなた）'), [await L.status(P), await seatText()]);
  check('C12 自分がまだ置いていないので、1手もどすは押せない', await P.page.isDisabled('#btnUndo'));
  await playToEnd('w');
  check('C12b 自分が白でも最後まで遊べる', await L.visible(P, '#resultBox'));
  await P.page.click('#btnRelobby');
  await L.waitScreen(P, 'local');
  check('C13 「名前と補助を変える」で、CPU（自分が白）のまま準備の画面へ', await P.page.isChecked('input[name="localVs"][value="b"]') && await P.page.isDisabled('#localNameB') && (await P.page.inputValue('#localNameW')) === 'そら');
  check('CL3 強さも「つよい」のまま', await P.page.isChecked('input[name="localLevel"][value="strong"]'));
  await P.page.click('label:has(input[name="localVs"][value=""])');
  check('C14 人どうしにもどすと、名前の欄はどちらも押せる・強さは隠れる', !(await P.page.isDisabled('#localNameB')) && !(await P.page.isDisabled('#localNameW')) && !(await L.visible(P, '#localLevelBox')));
  await P.page.selectOption('#localMoveTime', '15');
  await P.page.click('label:has(input[name="localVs"][value="w"])');
  await P.page.click('#btnLocalStart');
  await L.waitScreen(P, 'game');
  await P.page.click(cell(19));
  check('C15 制限時間があっても、CPU の番は残り時間を出さない', (await L.status(P)) === '白（CPU）が考え中' && (await L.clockText(P)) === '', await L.clockText(P));
  check('C16 自分の番になると、時間は最初から', await waitFor(async () => /^b:のこり 1[45]秒$/.test(await L.clockText(P)), 4000), await L.clockText(P));
  await L.shot(P, 'local-cpu');

  // 幅
  await P.page.setViewportSize({ width: 375, height: 760 });
  await sleep(300);
  check('W1 375px で横にはみ出さない', (await L.overflow(P)) <= 0);
  await L.shot(P, 'local-375');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
