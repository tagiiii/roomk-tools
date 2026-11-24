// リバーシ E2E その3: 1台の画面（名前・補助・たしかめる・1手もどす・読み込み直し・パス・最後まで・もう一回・制限時間と CPU・幅）
// 通信はしないが、ほかのテストと同じ写し（エミュレーター向け）で開く
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, cell } = L;

// 棋譜（コピーした文字）を盤のルールで打ちなおして、手の色・パス・最後の盤が合うかを見る（2026-11-24）
function replayKifu(text, E) {
  const lines = String(text).split('\n');
  let g = E.newGame();
  let i = lines.indexOf('') + 1;
  for (; i < lines.length && lines[i] !== ''; i += 1) {
    const m = /^(\d+) ([黒白]) ([A-H][1-8])$/.exec(lines[i]);
    if (!m) return { ok: false, why: 'line ' + lines[i] };
    const color = m[2] === '黒' ? 'b' : 'w';
    if (color !== g.turn) return { ok: false, why: 'color ' + lines[i] };
    const at = E.COLS.indexOf(m[3][0]) + (Number(m[3].slice(1)) - 1) * E.SIZE;
    const ng = E.play(g, at);
    if (!ng) return { ok: false, why: 'illegal ' + lines[i] };
    if (ng.passed) {
      i += 1;
      if (lines[i] !== '（' + (ng.passed === 'b' ? '黒' : '白') + 'はパス）') return { ok: false, why: 'pass ' + lines[i] };
    }
    g = ng;
  }
  return { ok: g.over, board: g.board, head: lines.slice(0, 3), last: lines[lines.length - 1] };
}

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
  await P.page.focus(cell(19));
  await P.page.keyboard.press('Enter');
  await waitFor(async () => (await L.turnOf(P)) === 'w');
  check('L8b キーボードで置いたあとも、そのますにとどまる', (await P.page.evaluate(() => document.activeElement?.dataset?.i)) === '19', await P.page.evaluate(() => document.activeElement?.className));
  check('L9 D3 で 4 対 1・白の番', JSON.stringify(await L.counts(P)) === '[4,1]' && (await L.turnOf(P)) === 'w');
  check('L10 直前の石に印・ひっくり返る動き', await P.page.$eval(cell(19), (x) => x.classList.contains('is-last')) && await P.page.$eval(cell(27), (x) => x.firstChild.classList.contains('is-flip')));
  await P.page.click('#btnUndo');
  check('L11 1手もどす', JSON.stringify(await L.counts(P)) === '[2,2]' && (await L.turnOf(P)) === 'b' && await P.page.isDisabled('#btnUndo'));

  // 補助の設定
  await P.page.click('#btnAid');
  await P.page.waitForSelector('#aidDialog[open]');
  const gap = await P.page.$eval('#aidDialog', (n) => { const b = n.getBoundingClientRect(); return [b.left, window.innerWidth - b.right, b.top, window.innerHeight - b.bottom]; });
  check('L11b 補助の設定が画面の中央に出る', Math.abs(gap[0] - gap[1]) < 4 && Math.abs(gap[2] - gap[3]) < 4, gap);
  await P.page.screenshot({ path: L.OUT + '/e2e3-aid-dialog.png' });
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
  // 棋譜をコピー（2026-11-24）。打ちなおすと同じ盤になる・名前・結果と石の数
  await P.page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await P.page.click('#btnCopyKifu');
  await waitFor(async () => P.page.evaluate(() => window.__copied));
  const kr = replayKifu(await P.page.evaluate(() => window.__copied), E);
  const wantLast = (nb === nw ? '引き分け' : nb > nw ? '黒（メンター）の勝ち' : '白（あおい）の勝ち') + '　黒 ' + nb + ' ー 白 ' + nw;
  check('L23b 棋譜をコピー（打ちなおすと同じ盤・パス・名前・結果）', kr.ok && kr.board === (await L.readBoard(P)) && kr.head[0] === 'リバーシ' && kr.head[1] === '黒: メンター' && kr.last === wantLast, kr);
  check('L23c コピーの知らせ', await waitFor(async () => (await P.page.textContent('body')).includes('棋譜をコピーしました')));
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
  // パスのある終わった対局の棋譜（2026-11-24）。置く前の局面を hist に残しながら最後まで打ち、パスが1回以上ある対局を使う。
  // 終わった対局は読み込み直しでは戻らないので、最後の1手の前の局面を入れて、最後の1手を画面で置く
  let done = null;
  for (let t = 0; t < 3000 && !done; t += 1) {
    let g = E.newGame();
    let prev = null;
    let prevHist = null;
    const hist = [];
    let passes = 0;
    while (!g.over) {
      const mv = Object.keys(E.legalMoves(g.board, g.turn)).map(Number);
      prev = g;
      prevHist = hist.slice();
      hist.push({ board: g.board, turn: g.turn, last: g.last, passed: g.passed, ply: g.ply });
      g = E.play(g, mv[Math.floor(Math.random() * mv.length)]);
      if (g.passed) passes += 1;
    }
    if (passes) done = { pre: { ...prev, hist: prevHist, moveTime: 0 }, final: g, passes };
  }
  await P.page.evaluate((s) => sessionStorage.setItem('reversi_local', JSON.stringify(s)), {
    names: { b: 'くろ', w: 'しろ' }, aid: { who: 'both', spots: true, count: false, confirm: false }, game: done.pre,
  });
  await P.page.reload();
  await L.waitScreen(P, 'game');
  await P.page.click(cell(done.final.last));
  await L.waitVisible(P, '#btnCopyKifu');
  await P.page.evaluate(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
  await P.page.click('#btnCopyKifu');
  await waitFor(async () => P.page.evaluate(() => window.__copied));
  const passText = String(await P.page.evaluate(() => window.__copied));
  const pk = replayKifu(passText, E);
  check('P2 パスのある対局の棋譜（パスの行・打ちなおすと同じ盤）', pk.ok && pk.board === done.final.board && (passText.match(/^（[黒白]はパス）$/gm) || []).length === done.passes, { pk, passes: done.passes });
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
  check('C3b CPU の番は補助の印を出さない', (await P.page.$$('#board .rv-mark.is-spot')).length === 0);
  // CPU が置く前（0.9秒の間）に、白の置ける場所を押して、その場で数える（印は出ないので、ルールから置ける場所を選ぶ）
  const c4 = await P.page.evaluate(() => {
    const E = window.ReversiEngine;
    const board = [...document.querySelectorAll('#board .rv-cell')].map((x) => (x.firstChild.classList.contains('is-b') ? 'b' : x.firstChild.classList.contains('is-w') ? 'w' : '.')).join('');
    const at = Number(Object.keys(E.legalMoves(board, 'w'))[0]);
    document.querySelector('#board .rv-cell[data-i="' + at + '"]').click();
    return [...document.querySelectorAll('#seats .rv-seat__count')].map((x) => Number(x.textContent));
  });
  check('C4 CPU の番は押しても置けない', JSON.stringify(c4) === '[4,1]', c4);
  check('C5 少し待つと CPU が置き、どこに置いたか出る', await waitFor(async () => (await L.turnOf(P)) === 'b' && /^CPU は [A-H][1-8] に置いたよ。あなたの番だよ（黒）/.test(await L.status(P)), 4000), await L.status(P));
  const sum = (await L.counts(P)).reduce((a, b) => a + b, 0);
  check('C6 石は6こ（2手ぶん）', sum === 6, await L.counts(P));
  await P.page.reload();
  await L.waitScreen(P, 'game');
  check('C7 読み込み直しても CPU と対戦のまま', (await L.status(P)).includes('あなたの番だよ（黒）') && (await seatText()).includes('CPU'), await L.status(P));
  check('C7b 読み込み直しても、CPU がどこに置いたか出る', /^CPU は [A-H][1-8] に置いたよ。/.test(await L.status(P)), await L.status(P));
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
  const cw = await P.page.$eval(cell(0), (x) => x.getBoundingClientRect().width);
  check('W2 375px でマスが 42px 以上', cw >= 42, cw);
  await L.shot(P, 'local-375');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
