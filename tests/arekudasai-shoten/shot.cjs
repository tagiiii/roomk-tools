// ポータルの画面の例を撮る（隔離エミュレーター。名前は撮影用の「そら」「みどり」「あお」「ひかり」）。
// お店の人（みどり）の画面で、お客さんのヒントが届き、質問を1回したところ。出力は AK_WORK/out/thumb.png。リポジトリへは手で写す
const L = require('./lib.cjs');
const { E, sleep, rest } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const names = ['そら', 'みどり', 'あお', 'ひかり'];
  const host = await L.newClient('host'); host.name = 'そら';
  const code = await L.createRoom(host, 'そら');
  const guests = [];
  for (const name of names.slice(1)) {
    const c = await L.newClient(name, name === 'みどり' ? { viewport: { width: 1000, height: 1100 } } : {});
    c.name = name;
    await L.joinRoom(c, name, code);
    guests.push(c);
  }
  await host.page.click('#btnStartGame');
  for (const c of [host, ...guests]) await L.waitScreen(c, 'game');
  let g = await L.gameOf(code);
  const seat = (name) => g.seats.indexOf(name);
  const mi = seat('みどり'), ao = seat('あお'), hi = seat('ひかり');

  // 撮影用の場面: お客さんはひかり（ほしい物はまんじゅう。あおのお店にある）。みどりのお店に絵の飾りがわかる4つを置く
  const midoriHand = ['kotatsu', 'donatsu', 'kakigoori', 'purin'];
  const aoAdd = 'manju';
  const used = new Set([...midoriHand, aoAdd]);
  const S = g.S;
  S.players.forEach((p) => { p.hand = p.hand.filter((id) => !used.has(id)); });
  S.deck = S.deck.filter((id) => !used.has(id));
  // 抜けた分は山から足して、4こずつにする
  S.players.forEach((p, i) => { if (i === mi) p.hand = midoriHand.slice(); else { if (i === ao) p.hand.unshift(aoAdd); while (p.hand.length < 4) p.hand.push(S.deck.shift()); p.hand = p.hand.slice(0, 4); } });
  S.players.forEach((p, i) => { p.order = null; });
  S.players[hi].order = aoAdd;
  // ほかの人のほしい物も、ほかの人のお店にある物に
  S.players.forEach((p, i) => { if (i !== hi) p.order = S.players[(i + 1) % 4].hand.find((id) => id !== aoAdd) || null; });
  S.turn = hi;
  const play = E.toRoom(S);
  play.r = { n: 1, h: 'まるい,あまい', at: Date.now() - 7000, d: { [ao]: aoAdd + ':あたたかい' }, q: { [mi]: 'あたたかい:1' } };
  await rest('PUT', `${L.ROOMS}/${code}/play/${g.id}`, play);

  const M = guests.find((c) => c.name === 'みどり');
  await L.waitText(M, '#stage', 'どうする？');
  await M.page.addStyleTag({ content: '.howto-fab, .howto-feedback-fab { display: none !important; } .ak-art--live * { animation: none !important; }' });
  await M.page.mouse.move(2, 2);
  await sleep(600);
  const box = await M.page.evaluate(() => {
    const a = document.querySelector('#town').getBoundingClientRect();
    const b = document.querySelector('#shelfBox').getBoundingClientRect();
    return { x: Math.floor(a.left), y: Math.floor(a.top + window.scrollY), width: Math.ceil(b.right - a.left), height: Math.ceil(b.bottom - a.top) };
  });
  await M.page.screenshot({ path: L.OUT + '/thumb.png', clip: box, fullPage: true });
  console.log('thumb', box.width, box.height);
  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
