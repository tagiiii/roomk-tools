// のりあいロード: ツール一覧のサムネイルを撮る（通信しない「1台のパソコンで遊ぶ」。本番には接続しない）
// 使い方: NR_WORK=… PLAYWRIGHT=… node tests/noriai-road/shot.cjs → $NR_WORK/out/thumb-raw.png
// 2026-11-18: ステージ12「いちばん長い道」のはじめ。4人で、1番が2マスの台の上のスイッチをおさえてとびらを開け、
// 3マスの人の塔の手前で3番が2番の頭に乗り、4番に「乗って」と出している場面（位置は撮影用に置いたもの）。
// 同じ日に、タイムアタックをオンにして、上の行（ステージ名と「タイム 0:42」）もいっしょに撮るようにした（時間は撮影用に置いたもの）
// 時計の字が読めるよう、画面の幅を600（ステージの枠が幅いっぱいになる幅）にして、2倍の細かさで撮る
// 同じ日に、ステージ13「しかけブロック」の場面にした: 開いたしかけブロックの上に3番、穴の手前に置いたばね、
// その手前に4番と1番、ばねで穴を跳んでいる2番（「行くよ」）。位置・時間は撮影用に置き、撮る間だけ動きを止める
// 2026-11-19、ステージ14「細い橋」の場面にした: 「1人まで」の橋の上に2番、手前で待つ1番（「待って」）と3番、
// わたり終えた4番。時計は「タイム 0:48」（位置・時間・カメラは撮影用。撮る間だけ動きを止める。
// 説明スライドの3枚目は、この画像を正方形に左から切って出すので、場面が左の約15マスに入るようカメラを置く）
// → $NR_WORK/out/thumb-raw.png（上の行からステージの枠の下まで）
const L = require('./lib.cjs');
const path = require('path');

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const c = await L.newClient('shot', { viewport: { width: 600, height: 760 }, scale: 2 });
    await L.open(c);
    await c.page.click('#btnGoLocal');
    await L.waitScreen(c, 'local');
    await c.page.click('#localCountSeg .nr-seg__btn:nth-child(3)'); // 4人
    await c.page.click('#localStageSeg .nr-seg__btn:nth-child(14)');
    await c.page.check('#localTimer'); // タイムアタック
    await c.page.click('#btnLocalStart');
    await L.waitScreen(c, 'game');
    const place = (s, E) => {
      const w = s.world;
      const br = w.plats[0]; // 1人までの細い橋
      // 2番が橋の上、1番・3番は手前で待つ、4番はわたり終えた
      const at = [[br.x - 1.6, 10 - E.PH, 1], [br.x + 2.6, br.y - E.PH, 1], [br.x - 2.7, 10 - E.PH, 1], [br.x + br.w + 1.0, 10 - E.PH, -1]];
      w.players.forEach((p, i) => { p.x = at[i][0]; p.y = at[i][1]; p.vx = 0; p.vy = 0; p.ground = null; p.face = at[i][2]; });
      br.riders = 1;
      // 撮る間だけ、動きを止める（描くのは続ける）
      E.stepLocal = () => {};
      // カメラは撮影用に決める: 説明スライドは画像を正方形に左から切って出すので、場面を左の約15マスに入れる
      const camL = br.x - 4.2;
      E.camLeft = () => camL;
      s.camX = camL;
      return 1;
    };
    await L.st(c, place);
    await c.page.waitForTimeout(1500);
    await L.st(c, (s) => { s.says[1] = { text: '待って', until: performance.now() + 60000 }; s.local.t0 = performance.now() - 48300; return 1; });
    await c.page.evaluate(() => {
      // 右下の「？」とフィードバックのボタンは撮影時だけ隠す（body の howto-has-fab は残す）
      document.querySelectorAll('[class*="fab"]').forEach((n) => { if (n !== document.body && n !== document.documentElement) n.style.visibility = 'hidden'; });
      // 上の行の右の「しかけの説明」「トップへ戻る」も撮影時だけ隠す
      for (const id of ['btnHint', 'btnLocalTop']) document.getElementById(id).style.visibility = 'hidden';
    });
    await c.page.waitForTimeout(600);
    const info = await L.st(c, (s) => s.world.players.map((p) => [p.seat, +p.x.toFixed(2), +p.y.toFixed(2), p.ground && (p.ground.kind || p.ground)]));
    console.log(JSON.stringify(info));
    const r = await c.page.evaluate(() => {
      const b = document.querySelector('#stageBox').getBoundingClientRect();
      const h = document.querySelector('#stageName').getBoundingClientRect();
      const x = Math.floor(Math.min(b.x, h.x - 8));
      const y = Math.floor(h.y + scrollY - 12);
      return { x, y, width: Math.ceil(b.right - x), height: Math.ceil(b.bottom + scrollY - y) };
    });
    console.log('time:', await L.text(c, '#timeLine'));
    await c.page.screenshot({ path: path.join(L.OUT, 'thumb-raw.png'), clip: r, fullPage: true });
    console.log('box', JSON.stringify(r));
    await c.page.screenshot({ path: path.join(L.OUT, 'thumb-page.png') });
  } catch (e) {
    console.log(e && e.stack || e);
  } finally {
    await L.browser.close();
    server.close();
  }
})();
