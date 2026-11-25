// ツール一覧のサムネイル（apps/assets/thumbnails/hitomoji-change.png）を撮る。
// 使い方: cd apps && python3 -m http.server 8733 を起こしてから
//   node tests/hitomoji-change/shot.cjs <playwright のパス> <出力先.png>
const { chromium } = require(process.argv[2]);
(async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.route('**/stats.js*', (r) => r.abort());
  await p.goto('http://localhost:8733/hitomoji-change/');
  await p.click('.hmc-level >> nth=2');
  await p.fill('#customStart', 'いぬ');
  await p.fill('#customGoal', 'ねこ');
  await p.click('#btnStart');
  // いぬ → いか → たか（お題 いぬ→ねこ の途中）
  await p.click('.hmc-tile >> nth=1'); await p.click('.hmc-key:text-is("か")');
  await p.click('.hmc-tile >> nth=0'); await p.click('.hmc-key:text-is("た")');
  await p.addStyleTag({ content: '.howto-fab,.howto-feedback-fab{display:none!important}' });
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(600);
  const a = await p.locator('.hmc-odai').boundingBox();
  const z = await p.locator('#nowArea').boundingBox();
  const pad = 16;
  await p.screenshot({ path: process.argv[3], clip: { x: a.x - pad, y: a.y - pad, width: a.width + pad * 2, height: z.y + z.height - a.y + pad * 2 } });
  await b.close();
})();
