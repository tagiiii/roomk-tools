// 将棋の E2E その3: 1台の画面（盤えらび・名前・補助・指す・成る・持ち駒を打つ・反則の知らせ・1手もどす・
// 盤の向き・読み込み直し・投了・詰み・もう一回・盤と補助を変える・幅 375px）。通信しない
const L = require('./lib.cjs');
const { E, check, cell, waitFor } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const M = await L.newClient('local');
  await L.open(M);
  await M.page.click('#btnGoLocal');
  await L.waitScreen(M, 'local');
  check('L1 はじめは5五将棋', await M.page.isChecked('#localVariant input[value="mini"]'));
  await M.page.click('#localVariant input[value="hon"]');
  await M.page.fill('#localName0', 'あおい');
  await M.page.fill('#localName1', 'そら');
  await M.page.click('#btnLocalStart');
  await L.waitScreen(M, 'game');
  check('L2 本将棋で始まる', (await M.page.$$('#board .sh-cell')).length === 81);
  check('L3 番の表示', (await L.status(M)) === '▲先手（あおい）の番', await L.status(M));
  check('L4 local-start と board-9 を数える', (await L.waitStats(M, 'local-start', 1)) && (await L.waitStats(M, 'board-9', 1)));
  check('L5 ルームのバーは出ない', !(await L.visible(M, '#roomBar')));

  // ▲７六歩 △３四歩 ▲２二角成 △同銀
  await L.move(M, 56, 47);
  check('L6 後手の番になる', (await L.status(M)) === '△後手（そら）の番', await L.status(M));
  await L.move(M, 24, 33);
  await L.move(M, 64, 16, true);
  check('L7 ▲２二角成', (await L.lastLine(M)) === '3手目　▲２二角成', await L.lastLine(M));
  await L.move(M, 6, 16);
  check('L8 △同銀', (await L.lastLine(M)) === '4手目　△同銀', await L.lastLine(M));
  // 二歩: 先手の持ち駒の角を打つ所の点・歩は持っていない
  await M.page.click('#sideBottom .sh-handpiece');
  check('L9 持ち駒を選ぶと打てる所に点', (await L.spots(M)).length > 30, (await L.spots(M)).length);
  await M.page.click(cell(33));
  check('L10 相手の駒のある所には打てない', (await L.text(M, '#gameMsg')).includes('駒のあるますには打てない'), await L.text(M, '#gameMsg'));
  // 角を ４五 に打つ（王手ではない）→ 表記に「打」は付かない
  await L.move(M, 'B', 4 * 9 + 5);
  check('L11 ▲４五角（打は付けない）', (await L.lastLine(M)).endsWith('▲４五角'), await L.lastLine(M));

  // 盤の向き
  await M.page.click('#btnFlip');
  check('L12 盤の向きを変えると左上が９九', (await M.page.getAttribute('#board .sh-cell >> nth=0', 'data-i')) === '80');
  await M.page.click('#btnFlip');

  // 1手もどす・読み込み直し
  await M.page.click('#btnUndo');
  check('L13 1手もどす', (await L.lastLine(M)) === '4手目　△同銀' && (await L.text(M, '#gameMsg')) === '1手もどしたよ。');
  await M.page.reload();
  check('L14 読み込み直すと続きから', await waitFor(async () => (await L.screen(M)) === 'game' && (await L.lastLine(M)) === '4手目　△同銀'));

  // 投了（先手の番）
  await M.page.click('#btnResign');
  check('L15 投了の結果', (await L.status(M)) === '▲先手（あおい）が投了。△後手（そら）の勝ち！', await L.status(M));
  check('L16 local-finish を数える', await L.waitStats(M, 'local-finish', 1));
  check('L17 結果のボタン', (await L.visible(M, '#btnAgain')) && (await L.text(M, '#btnRelobby')) === '盤と補助を変える');
  check('L18 投了のボタンは消える', !(await L.visible(M, '#btnResign')));
  await M.page.click('#btnUndo');
  check('L19 1手もどすで投了を取り消す', (await L.status(M)) === '▲先手（あおい）の番', await L.status(M));

  // もう一回（終わっていないので「最初からやりなおす」）
  await M.page.click('#btnReset');
  check('L20 最初からやりなおす', (await L.lastLine(M)) === '');

  // 盤と補助を変える → 5五将棋で詰みまで（記録を差しこむ）
  await M.page.click('#btnResign');
  await M.page.click('#btnRelobby');
  await L.waitScreen(M, 'local');
  check('L21 準備にもどると名前と盤が残る', (await M.page.inputValue('#localName0')) === 'あおい' && (await M.page.isChecked('#localVariant input[value="hon"]')));
  await M.page.click('#localVariant input[value="mini"]');
  await M.page.click('#localAid input[data-key="danger"]');
  await M.page.click('#btnLocalStart');
  check('L22 5五将棋', (await M.page.$$('#board .sh-cell')).length === 25);
  // 取られそうな駒（はじめの局面では、先手の歩 ５四 に後手の…は利いていない）。歩を進めると印が出る
  await L.move(M, 15, 10);
  await L.move(M, 9, 14);
  check('L23 取られそうな駒の印', (await M.page.$$('#board .sh-cell.is-danger')).length > 0, (await M.page.$$('#board .sh-cell.is-danger')).length);
  // 詰みの記録を差しこんで読み込み直し、最後の1手を指す
  const moves = (() => {
    let seed = 5;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let g = 0; g < 500; g += 1) {
      let G = E.create('mini');
      const ms = [];
      while (!G.over && ms.length < 120) {
        const all = E.legalMoves(G);
        const checks = all.filter((m) => E.apply(G, m).check);
        const pool = checks.length && rnd() < 0.6 ? checks : all;
        const m = pool[Math.floor(rnd() * pool.length)];
        ms.push(m);
        G = E.apply(G, m);
      }
      if (G.over && G.over.reason === 'mate') return ms;
    }
    return null;
  })();
  await M.page.evaluate((ms) => {
    sessionStorage.setItem('shogi_local', JSON.stringify({ v: 'mini', names: ['あおい', 'そら'], aid: { who: 'both', spots: true, arrows: false, danger: false }, moves: ms.slice(0, -1), rev: 50 }));
  }, moves);
  await M.page.reload();
  await L.waitScreen(M, 'game');
  const last = moves[moves.length - 1];
  const before = E.replay('mini', moves.slice(0, -1));
  const two = last.from >= 0 && E.legalMoves(before).filter((m) => m.from === last.from && m.to === last.to).length === 2;
  // 持ち駒は手前（盤の下）にある先手のものしか押さないので、後手の打つ手なら盤の向きを変える
  if (last.from < 0 && before.turn === 1) await M.page.click('#btnFlip');
  await L.move(M, last.from < 0 ? last.drop : last.from, last.to, two ? last.promote : undefined);
  const winner = before.turn === 0 ? '▲先手（あおい）の勝ち！' : '△後手（そら）の勝ち！';
  check('L24 詰み', (await L.status(M)) === '詰み。' + winner, await L.status(M));
  await M.page.reload();
  check('L24b 終わった対局も読み込み直すと結果が出る', await waitFor(async () => (await L.status(M)) === '詰み。' + winner && (await L.visible(M, '#btnAgain'))), await L.status(M));
  await M.page.click('#btnAgain');
  check('L25 もう一回で名前が入れかわる', (await L.status(M)) === '▲先手（そら）の番', await L.status(M));

  // 幅 375px
  await M.page.setViewportSize({ width: 375, height: 812 });
  check('L26 幅375pxで横にはみ出さない', (await L.overflow(M)) <= 0, await L.overflow(M));
  await L.shot(M, 'e2e3-local-narrow');
  await M.page.click('#btnQuit');
  check('L27 トップへ戻る', (await L.screen(M)) === 'top');
  await M.page.reload();
  check('L28 トップへ戻ったあとは続きを出さない', (await L.screen(M)) === 'top');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
