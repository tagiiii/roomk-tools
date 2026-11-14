// 麻雀の E2E その2（隔離エミュレーター）: 人が押すポン・ロン。配ったあとに game を REST で書きかえて局面を作る
// そら（席0・親）が東を捨てる → うみ（席1）が「ポン」→ うみが捨てる番（引かない）→ うみが捨てた五萬で、そらが「ロン」
const L = require('./lib.cjs');
const { check, sleep } = L;
const id = (k, copy) => k * 4 + copy;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const guest = await L.newClient('guest');
  const watch = await L.newClient('watch');
  const code = await L.createRoom(host, 'そら');
  await L.joinRoom(guest, 'うみ', code);
  await host.page.click('label.mj-seg__opt:has(input[name="time-limit"][value="0"])');
  await L.roomWhen(code, (r) => r.settings.time === 0);
  await host.page.click('#btnStartGame');
  await Promise.all([L.waitScreen(host, 'game'), L.waitScreen(guest, 'game')]);
  await L.open(watch, '?watch=' + code);
  await L.waitScreen(watch, 'game');

  // 局面を作る（CPU の2人は字牌・索子の上のほうで、だれの捨て牌にも答えられない手）
  const room = await L.roomOf(code);
  const G = L.gameOf(room);
  const s = G.s;
  // そら: 東 + 一二三萬 四五六筒 七八九筒 南南 中（14枚）。東を捨てると 南南 中 … 中を待つ形ではないが、ロンの形は下で作り直す
  s.seats[0].hand = [id(27, 0), id(0, 0), id(1, 0), id(2, 0), id(12, 0), id(13, 0), id(14, 0), id(15, 0), id(16, 0), id(17, 0), id(28, 0), id(28, 1), id(3, 0), id(5, 0)];
  // うみ: 東東 + 五萬 + ばらばら
  s.seats[1].hand = [id(27, 1), id(27, 2), id(4, 1), id(9, 1), id(11, 1), id(18, 1), id(20, 1), id(22, 1), id(24, 1), id(26, 1), id(31, 1), id(32, 1), id(33, 1)];
  s.seats[2].hand = [id(29, 0), id(29, 1), id(30, 0), id(30, 1), id(31, 2), id(32, 2), id(33, 2), id(19, 2), id(21, 2), id(23, 2), id(25, 2), id(18, 2), id(20, 2)];
  s.seats[3].hand = [id(29, 2), id(29, 3), id(30, 2), id(30, 3), id(31, 3), id(32, 3), id(33, 3), id(19, 3), id(21, 3), id(23, 3), id(25, 3), id(18, 3), id(20, 3)];
  const used = new Set(s.seats.flatMap((x) => x.hand));
  s.wall = s.wall.filter((x) => !used.has(x));
  for (let i = 0; i < 136; i += 1) if (!used.has(i) && !s.wall.includes(i)) s.wall.push(i);
  s.wall = s.wall.filter((x) => ![id(4, 2), id(4, 3)].includes(x)); // 五萬は山に残さない（そらのツモであがらないように）
  s.drawn = id(27, 0);
  await L.rest('PUT', L.ROOMS + '/' + code + '/game', JSON.stringify(G));
  await host.page.waitForFunction(() => document.querySelectorAll('#me .mj-hand button').length === 14 && document.querySelector('#me .mj-hand button[data-id="108"]'));

  // そらが東を捨てる
  await host.page.click('#me .mj-hand button[data-id="108"]');
  await L.waitText(guest, '#gameStatus', 'どうする');
  const acts = await guest.page.$$eval('#actions button', (xs) => xs.map((x) => x.textContent));
  check('guest gets pon + pass', acts.some((t) => t.startsWith('ポン')) && acts.includes('パス'), acts);
  check('no chi for guest (honor)', !acts.some((t) => t.startsWith('チー')));
  check('pon button shows 3 tiles', (await guest.page.$$('#actions .mj-callbtn .mj-tile')).length === 3);
  check('host sees no buttons', (await host.page.$$('#actions button')).length === 0);
  check('watch status does not reveal claim', !(await L.text(watch, '#gameStatus')).includes('聞いている'));
  await guest.page.click('#actions .mj-callbtn');
  await L.waitText(guest, '#gameStatus', '組を見せたよ');
  check('guest meld shown', (await guest.page.$$('#me .mj-meld')).length === 1);
  check('taken tile marked', (await guest.page.$$('#me .mj-meld .is-taken')).length === 1);
  check('host sees guest meld', (await host.page.$$('#opps .mj-meld')).length === 1);
  check('called tile dimmed in river', (await host.page.$$('#me .mj-river .is-called')).length === 1);
  check('guest 11 tiles after pon', (await guest.page.$$('#me .mj-hand button')).length === 11);

  // そらをテンパイ（五萬待ち）にしてから、うみが五萬を捨てる
  {
    const r = await L.roomOf(code);
    const g = L.gameOf(r);
    // 一二三萬 四六萬 四五六筒 七八九筒 南南 = 13枚、五萬の嵌張待ち
    g.s.seats[0].hand = [id(0, 0), id(1, 0), id(2, 0), id(3, 0), id(5, 0), id(12, 0), id(13, 0), id(14, 0), id(15, 0), id(16, 0), id(17, 0), id(28, 0), id(28, 1)];
    await L.rest('PUT', L.ROOMS + '/' + code + '/game', JSON.stringify(g));
  }
  await L.waitText(host, '#hintLine', '待ち');
  check('host hint shows wait', (await host.page.$$('#hintLine .mj-tile')).length === 1);
  await guest.page.click('#me .mj-hand button[data-id="' + id(4, 1) + '"]');
  await L.waitText(host, '#gameStatus', 'どうする');
  const hacts = await host.page.$$eval('#actions button', (xs) => xs.map((x) => x.textContent));
  check('host gets ron', hacts.includes('ロン（あがる）'), hacts);
  check('host gets chi? no (not left of guest)', !hacts.some((t) => t.startsWith('チー')));
  await host.page.click('#actions button:text-is("ロン（あがる）")');
  await Promise.all([L.waitVisible(host, '#result'), L.waitVisible(guest, '#result'), L.waitVisible(watch, '#result')]);
  check('host result title', (await L.text(host, '#resultTitle')) === 'あがり！');
  check('guest result title', (await L.text(guest, '#resultTitle')) === 'そらのあがり');
  check('ron from guest', (await L.text(host, '#resultSub')).includes('うみ'));
  check('guest sees ron from self', (await L.text(guest, '#resultSub')).includes('あなた'));
  const r2 = await L.roomOf(code);
  check('wins', JSON.parse(r2.wins)['p:そら'] === 1, r2.wins);
  check('stats finish on host (ron pressed)', await L.waitStats(host, 'finish', 1));
  check('log has pon and ron', /うみがポン/.test(await L.text(host, '#log')) && /そらがロン/.test(await L.text(host, '#log')));
  await host.page.screenshot({ path: L.OUT + '/ron.png', fullPage: true });

  await host.page.click('#btnLeave');
  await L.waitScreen(guest, 'top', 10000);
  await L.finishAll(server);
})().catch(async (e) => {
  console.error('FATAL', e);
  process.exit(2);
});
