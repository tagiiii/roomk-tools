// ポータルのサムネイルを撮る（隔離エミュレーター。名前は撮影用の「そら」と CPU）。
// 出力は DF_WORK/out/thumb.png。リポジトリへは手で写す
const L = require('./lib.cjs');
const { sleep, waitScreen } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1000, height: 1000 } });
  await L.createRoom(H, 'そら');
  for (let k = 0; k < 3; k += 1) await H.page.click('#btnAddCpu');
  await H.page.waitForFunction(() => document.querySelector('#lobbyCount').textContent.includes('4人'));
  await H.page.click('#btnStartGame');
  await waitScreen(H, 'game');
  // 場にカードが出ていて、そらの番になるまで進める（CPU は自分で出す）
  for (let n = 0; n < 200; n += 1) {
    const ready = await H.page.evaluate(() => document.querySelectorAll('#field .df-card').length > 0
      && !document.querySelector('#actPlay').hidden && document.querySelectorAll('#hand .df-card').length >= 9);
    if (ready) break;
    const mine = await H.page.evaluate(() => !document.querySelector('#actPlay').hidden);
    if (mine) {
      const empty = await H.page.evaluate(() => document.querySelectorAll('#field .df-card').length === 0);
      if (empty) {
        const card = await H.page.$eval('#hand .df-card', (x) => x.dataset.card);
        await H.page.click('#hand .df-card[data-card="' + card + '"]');
        await H.page.click('#btnPlay');
      }
    }
    await sleep(300);
  }
  // 出せるカードを1枚選んだ状態にする
  const card = await H.page.$eval('#hand .df-card:not(.is-dim)', (x) => x.dataset.card).catch(() => null);
  if (card) await H.page.click('#hand .df-card[data-card="' + card + '"]');
  await H.page.addStyleTag({ content: '.roomk-howto-fab, [class*="howto"] button { display: none !important; } .df-timer__bar { transition: none !important; }' });
  await sleep(300);
  const box = await H.page.evaluate(() => {
    const a = document.querySelector('#players').getBoundingClientRect();
    const b = document.querySelector('#mine').getBoundingClientRect();
    return { x: Math.floor(a.left), y: Math.floor(a.top + window.scrollY), width: Math.ceil(a.width), height: Math.ceil(b.bottom - a.top) };
  });
  await H.page.screenshot({ path: L.OUT + '/thumb.png', clip: box, fullPage: true });
  console.log('thumb', box.width, box.height);
  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
