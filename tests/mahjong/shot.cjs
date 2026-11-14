// ポータルの画面の例を撮る（隔離エミュレーター。名前は撮影用の「そら」と CPU 3人・役あり）。
// 出力は MJ_WORK/out/thumb.png。リポジトリへは手で写す
const L = require('./lib.cjs');
const { sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1000, height: 1000 } });
  const code = await L.createRoom(H, 'そら');
  await H.page.click('label.mj-seg__opt:has(input[name="rule-kind"][value="yaku"])');
  await H.page.click('label.mj-seg__opt:has(input[name="time-limit"][value="0"])');
  await L.roomWhen(code, (r) => r.settings.rule === 'yaku' && r.settings.time === 0);
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'game');
  // 中ごろ（山が45枚以下）で、そらの捨てる番、手にそろった組が2つ以上あるところまで進める
  for (let n = 0; n < 600; n += 1) {
    if (await L.visible(H, '#result')) { await H.page.click('#btnAgain'); await sleep(800); continue; }
    const st = await H.page.evaluate(() => ({
      mine: document.querySelector('#me .mj-hand.is-active') !== null,
      wall: Number(document.getElementById('wallCount').textContent),
      sets: document.querySelectorAll('#me .mj-set').length,
      riichi: !!document.querySelector('#me .mj-tag--riichi'),
      acts: [...document.querySelectorAll('#actions button')].map((b) => b.textContent),
    }));
    if (st.mine && st.wall <= 45 && st.sets >= 2 && !st.riichi && !st.acts.some((t) => /ツモ/.test(t))) break;
    if (st.acts.includes('パス')) { await H.page.click('#actions button:text-is("パス")'); await sleep(200); continue; }
    if (st.mine) {
      const t = await H.page.$$eval('#me .mj-hand button:not(:disabled)', (xs) => (xs.find((x) => x.classList.contains('is-best')) || xs[xs.length - 1])?.dataset.id);
      if (t) await H.page.click('#me .mj-hand button[data-id="' + t + '"]');
    }
    await sleep(250);
  }
  await H.page.addStyleTag({ content: '.howto-fab, .howto-feedback-fab { display: none !important; } .mj-tile.is-new, .mj-hand .is-drawn { animation: none !important; }' });
  await H.page.mouse.move(2, 2);
  await sleep(500);
  const box = await H.page.evaluate(() => {
    const a = document.querySelector('.mj-bar').getBoundingClientRect();
    const b = document.querySelector('.mj-mat').getBoundingClientRect();
    return { x: Math.floor(a.left), y: Math.floor(a.top + window.scrollY), width: Math.ceil(b.right - a.left), height: Math.ceil(b.bottom - a.top) };
  });
  await H.page.screenshot({ path: L.OUT + '/thumb.png', clip: box, fullPage: true });
  console.log('thumb', box.width, box.height);
  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
