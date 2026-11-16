// ツール一覧の画面の例を撮る（隔離エミュレーター。名前は撮影用の「そら」「みどり」「あお」）。
// ルーム・ふつう（20枚）で、そら2ペア・みどり2ペア・あお1ペアのあと、みどりの番で1枚めくったところ。
// みどりの画面の名前の札から盤まで。出力は SS_WORK/out/thumb.png。リポジトリへは手で写す
const L = require('./lib.cjs');
const SS = require('../../apps/shinkei-suijaku/logic.js');
const { sleep } = L;
const PICK = [13, 2, 17, 8, 0, 19, 6, 11, 15, 4, 9, 18, 1, 12, 7, 16, 3, 10, 5, 14];

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('そら', { viewport: { width: 1280, height: 1000 } });
  const code = await L.createRoom(host, 'そら');
  const by = { 'そら': host };
  for (const name of ['みどり', 'あお']) {
    const c = await L.newClient(name, { viewport: { width: 1280, height: 1000 } });
    await L.joinRoom(c, name, code);
    by[name] = c;
  }
  await host.page.click('#roomLevel [data-value="normal"]');
  await sleep(400);
  await host.page.click('#btnStartGame');
  for (const c of Object.values(by)) await L.waitScreen(c, 'game');
  await sleep(900);

  const state = async () => { const r = await L.roomOf(code); const g = r.game; return { g, deck: SS.deckOf(g), got: SS.gotOf(g), who: SS.orderOf(g)[SS.turnOf(g)] }; };
  const flip2 = async (kind) => {
    const s = await state();
    // 取ったカードが盤の一か所に寄らないよう、決まった並びの順で探す（毎回同じ結果になるよう、くじは使わない）
    const order = PICK.filter((i) => i < s.deck.length && !s.got[i]);
    let a, b;
    for (const x of order) { for (const y of order) { if (x !== y && (kind === 'pair') === (s.deck[x] === s.deck[y])) { a = x; b = y; break; } } if (a !== undefined) break; }
    const c = by[s.who];
    await L.clickCard(c, a); await sleep(500);
    await L.clickCard(c, b); await sleep(1200);
    return s.who;
  };
  const plan = ['pair', 'pair', 'miss', 'pair', 'miss', 'pair', 'miss', 'miss', 'pair'];
  for (const k of plan) console.log(await flip2(k), k);
  const s = await state();
  console.log('deck', s.deck.length, 'turn', s.who);
  // みどりの番で、まだ相手を見ていない1枚をめくる
    const i = PICK.find((n) => !s.got[n] && s.deck.filter((x, m) => x === s.deck[n] && !s.got[m]).length === 2);
  const M = by[s.who];
  await L.clickCard(M, i); await sleep(800);
  await M.page.addStyleTag({ content: '.howto-fab, .howto-feedback-fab { display: none !important; }' });
  await M.page.mouse.move(2, 2);
  await sleep(600);
  const box = await M.page.evaluate(() => {
    const a = [...document.querySelectorAll('#players .ss-player')].reduce((m, e) => { const r = e.getBoundingClientRect(); return { left: Math.min(m.left, r.left), right: Math.max(m.right, r.right), top: Math.min(m.top, r.top) }; }, { left: 1e9, right: -1e9, top: 1e9 });
    const b = document.querySelector('#board').getBoundingClientRect();
    const l = Math.min(a.left, b.left) - 12, r = Math.max(a.right, b.right) + 12;
    return { x: Math.floor(l), y: Math.floor(a.top + window.scrollY) - 12, width: Math.ceil(r - l), height: Math.ceil(b.bottom - a.top) + 24 };
  });
  await M.page.screenshot({ path: L.OUT + '/thumb.png', clip: box, fullPage: true });
  console.log('thumb', box.width, box.height, await L.players(M));
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
