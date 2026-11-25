// ツール一覧のサムネイル（apps/assets/thumbnails/kotoba-hiroi.png）を撮る（隔離エミュレーター。本番には接続しない）。
// 使い方: README.md の 1・2 のあと  node tests/kotoba-hiroi/shot.cjs <出力先.png>
// できた画像は 256 色にしてから apps/assets/thumbnails/kotoba-hiroi.png へ写す（docs/development/thumbnails.md）
const L = require('./lib.cjs');
const { sleep, rest, waitText, waitVisible } = L;

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('出力先を指定してね');
  const server = await L.startServer();
  await L.loadRules();
  await L.launch();
  const sora = await L.newClient('sora', { viewport: { width: 1280, height: 1100 } });
  const midori = await L.newClient('midori', { viewport: { width: 1280, height: 1100 } });
  const ao = await L.newClient('ao');
  const code = await L.createRoom(sora, 'そら');
  await L.joinRoom(midori, 'みどり', code);
  await L.joinRoom(ao, 'あお', code);
  await waitText(sora, '#lobbyPlayers', 'あお');
  await sora.page.click('#btnStart');
  await waitVisible(midori, '#screen-play');
  // 撮影用に、1問めを「い こ た つ ら か」（既存データの n4）にして、文字の並びを決める
  const base = `${L.ROOMS}/${code}`;
  await rest('PUT', `${base}/order/0`, 'n4');
  await rest('PUT', `${base}/q/tiles`, ['た', 'い', 'か', 'こ', 'ら', 'つ']);
  // 見つかった言葉・たしかめ中の言葉・ヒント（撮影用に置いたもの）
  const at = Date.now();
  await rest('PUT', `${base}/found/0`, {
    'こたつ': { by: 'そら', at }, 'たいこ': { by: 'みどり', at }, 'たから': { by: 'あお', at },
    'たらこ': { by: 'みどり', at }, 'いつか': { by: 'あお', at },
  });
  await rest('PUT', `${base}/pending/0`, { 'かいこ': { by: 'あお', at } });
  await rest('PUT', `${base}/hints/0`, { 'からい': true });
  await waitText(midori, '#pBoardHead', '5 / 10');
  // みどりが「かたい」をつくっている途中（2文字まで）
  await midori.page.locator('#pTiles button', { hasText: 'か' }).first().click();
  await midori.page.locator('#pTiles button', { hasText: 'た' }).first().click();
  await midori.page.addStyleTag({ content: '.howto-fab,.howto-feedback-fab{display:none!important} *{animation:none!important;transition:none!important}' });
  await midori.page.evaluate(() => document.fonts.ready);
  await sleep(600);
  const a = await midori.page.locator('.khi-top').boundingBox();
  const z = await midori.page.locator('#pMaker').boundingBox();
  const pad = 16;
  await midori.page.screenshot({ path: out, clip: { x: z.x - pad, y: a.y - pad, width: z.width + pad * 2, height: z.y + z.height - a.y + pad * 2 } });
  console.log('shot', out);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
