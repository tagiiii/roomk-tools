// ツール一覧のサムネイル（apps/assets/thumbnails/torisetsu-kaijo.png）を撮る。
// エミュレーターも Java も使わない（memdb.cjs。本番にも、ほかのどこにも接続しない。本番あての通信が出たら失敗にする）。
// 使い方: PLAYWRIGHT=（playwright のフォルダ） node tests/torisetsu-kaijo/shot.cjs <出力先.png>
// できた画像は 256 色にしてから apps/assets/thumbnails/torisetsu-kaijo.png へ写す（docs/development/thumbnails.md）
const M = require('./memdb.cjs');
const { E, sleep } = M;

const SEED = Number(process.env.SHOT_SEED || 0);
// 表にコード・記号・ダイヤル（かやじるし）の3種類がならぶ爆弾の番号をさがす（いつも同じ番号になる）
function pickSeed() {
  if (SEED) return SEED;
  for (let seed = 1; seed < 5000; seed++) {
    const bomb = E.makeBomb(seed, 'normal', false);
    const front = [0, 1, 2].map((i) => bomb.slots[i] && bomb.slots[i].type);
    if (front[0] === 'cord' && front[1] === 'glyph' && (front[2] === 'dial' || front[2] === 'arrow')) return seed;
  }
  throw new Error('seed not found');
}

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('出力先を指定してね');
  const seed = pickSeed();
  const server = await M.startServer();
  const { browser, page, bad, errors } = await M.openBrowser({ scale: Number(process.env.SHOT_SCALE || 1) });
  await M.joinAsSora(page);

  // はじめてから20秒（導火線に火がつく前）で、のこり時間だけ 2:30 あたりにしておく
  const now = Date.now();
  const G = E.newState('normal', false, now - 20000);
  G.t = { ...G.t, left: 153000, at: now };
  await M.putGame(page, 1, seed, 'normal', G);

  // 表のコードを正しく切って、しかけを1つ解除する
  const bomb = E.makeBomb(seed, 'normal', false);
  await page.evaluate(() => window.__tk.cube.showFace('front'));
  await sleep(700);
  await page.click('.tk-slot[data-slot="0"]');
  await page.waitForSelector('#zoomBody .tk-mod--big');
  await page.click(`#zoomBody [data-a="cut:${bomb.slots[0].sol}"]`);
  await page.waitForFunction(([room]) => window.__shotdb.read(room + '/game/ok/s0') === true, [M.ROOM]);
  // 爆弾にもどって、「しかけを解除！」の知らせが消えるのを待つ
  await page.click('#btnZoomBack');
  await page.waitForSelector('#stage', { state: 'visible' });
  await sleep(3500);

  await page.addStyleTag({ content: '.howto-fab,.howto-feedback-fab{display:none!important} .tk-zoom,.tk-zoom *{animation:none!important}' });
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.fonts.ready);
  await sleep(900);
  if (process.env.SHOT_FULL) await page.screenshot({ path: out.replace(/\.png$/, '-full.png') });
  const a = await page.locator('#hud').boundingBox();
  const s = await page.locator('#stage').boundingBox();
  const left = Math.min(a.x, s.x);
  const right = Math.max(a.x + a.width, s.x + s.width);
  const bottom = s.y + s.height;
  const pad = 12;
  await page.screenshot({ path: out, clip: { x: left - pad, y: a.y - pad, width: right - left + pad * 2, height: bottom - a.y + pad * 2 } });
  console.log('shot', out, 'seed', seed, 'front', [0, 1, 2].map((i) => bomb.slots[i].type).join(','));
  if (errors.length) console.log('console errors', errors.slice(0, 5));
  if (bad.length) console.log('本番あての通信', bad.slice(0, 5));
  await browser.close();
  server.close();
  process.exit(errors.length || bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
