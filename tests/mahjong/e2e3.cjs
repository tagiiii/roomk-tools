// 麻雀の E2E その3（隔離エミュレーター）: 役ありのルール。待合室で選ぶ・ドラ表示牌・自風・リーチ（捨てる牌を選ぶ・
// 宣言牌の印・リーチ中は引いた牌だけ）・ツモの結果に役と翻数・裏ドラ・次の局（東2局・親が移る）・暗槓・役の一覧。
// 配ったあとに game を REST で書きかえて局面を作る
const L = require('./lib.cjs');
const { check, sleep } = L;
const id = (k, copy) => k * 4 + copy;

// 手を作りかえる（ほかの牌は山・王牌に回す。同じ牌が2回出ないことを確かめる）
function rebuild(s, hands, turn, drawn) {
  const used = new Set(hands.flat());
  if (used.size !== hands.flat().length) throw new Error('same tile twice in test hands');
  const pool = [];
  for (let i = 0; i < 136; i += 1) if (!used.has(i)) pool.push(i);
  s.seats.forEach((x, i) => { x.hand = hands[i].slice(); x.river = []; x.melds = []; x.riichi = null; x.ippatsu = false; x.furitenTemp = false; x.furitenRiichi = false; });
  s.dead = { rinshan: pool.splice(0, 4), dora: pool.splice(0, 5), ura: pool.splice(0, 5) };
  s.wall = pool;
  s.turn = turn; s.drawn = drawn; s.phase = 'discard'; s.pending = null; s.claim = null; s.chankan = null;
  s.noCall = true; s.kuikae = []; s.doraN = 1; s.pendDora = 0; s.kans = 0; s.kanBy = [];
}
async function putGame(code, G) {
  await L.rest('PUT', L.ROOMS + '/' + code + '/game', JSON.stringify(G));
}
const F = (k0, n, copy) => Array.from({ length: n }, (_, i) => id(k0 + i, copy));

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const guest = await L.newClient('guest');
  const code = await L.createRoom(host, 'そら');
  await L.joinRoom(guest, 'うみ', code);

  // ── 待合室: ルールを選ぶ ──
  await host.page.click('label.mj-seg__opt:has(input[name="rule-kind"][value="yaku"])');
  await L.waitText(guest, '#lobbyRulesView', '役あり');
  await host.page.click('label.mj-seg__opt:has(input[name="time-limit"][value="0"])');
  await L.roomWhen(code, (r) => r.settings.rule === 'yaku' && r.settings.time === 0);
  check('chiitoi option hidden in yaku', !(await host.page.$('input[data-rule="chiitoi"]')));
  check('calls label mentions kan', (await L.text(host, '#lobbyRules')).includes('ポン・チー・カン'));
  await host.page.click('#btnStartGame');
  await Promise.all([L.waitScreen(host, 'game'), L.waitScreen(guest, 'game')]);
  check('stats rule-yaku', await L.waitStats(host, 'rule-yaku', 1));
  check('round line 東1局', (await L.text(host, '#roundLine')).startsWith('東1局'));
  check('dora line shown', await L.visible(host, '#doraLine') && (await host.page.$$('#doraLine .mj-tile')).length === 2);
  check('seat wind tag (host is 東・親)', (await L.text(host, '#me .mj-seat__head')).includes('東・親'));
  check('yaku list shown', await L.visible(host, '#yakuList'));
  let room = await L.roomOf(code);
  let G = L.gameOf(room);
  check('dead wall 14', G.s.dead.rinshan.length + G.s.dead.dora.length + G.s.dead.ura.length === 14);

  // ── リーチ ──
  // うみ（席1）の番: 234萬 345筒 678索 2345索 中 を持ち、中を引いた
  const umi = [id(1, 0), id(2, 0), id(3, 0), id(11, 0), id(12, 0), id(13, 0), id(23, 0), id(24, 0), id(25, 0), id(19, 0), id(20, 0), id(21, 0), id(22, 0), id(33, 0)];
  const sora = [...F(27, 4, 0), ...F(27, 4, 1), id(31, 0), id(31, 1), id(32, 0), id(32, 1), id(30, 2)];
  const c2 = [...F(0, 9, 2), id(28, 2), id(29, 2), id(31, 2), id(32, 2)];
  const c3 = [...F(9, 9, 2), id(28, 3), id(29, 3), id(31, 3), id(32, 3)];
  rebuild(G.s, [sora, umi, c2, c3], 1, id(33, 0));
  G.s.rev += 1;
  await putGame(code, G);
  await guest.page.waitForFunction(() => document.querySelectorAll('#me .mj-hand button').length === 14);
  await L.waitText(guest, '#hintLine', 'リーチ');
  check('riichi hint', true);
  const acts = await guest.page.$$eval('#actions button', (xs) => xs.map((x) => x.textContent));
  check('riichi button', acts.includes('リーチ'), acts);
  await guest.page.click('#actions button:text-is("リーチ")');
  await L.waitText(guest, '#gameStatus', 'リーチ：');
  const enabled = await guest.page.$$eval('#me .mj-hand button:not(:disabled)', (xs) => xs.map((x) => Number(x.dataset.id)));
  check('riichi: 中 can be discarded', enabled.includes(id(33, 0)), enabled);
  check('riichi: non-tenpai discard locked', !enabled.includes(id(1, 0)));
  check('cancel button', (await guest.page.$$eval('#actions button', (xs) => xs.map((x) => x.textContent))).includes('リーチをやめる'));
  await guest.page.click('#me .mj-hand button[data-id="' + id(33, 0) + '"]');
  room = await L.roomWhen(code, (r) => L.gameOf(r).s.seats[1].riichi);
  G = L.gameOf(room);
  check('riichi set', !!G.s.seats[1].riichi);
  await host.page.waitForFunction(() => document.querySelector('#opps .mj-tag--riichi'));
  check('host sees riichi tag', true);
  check('riichi tile marked in river', (await host.page.$$('#opps .mj-river .is-riichi')).length === 1);
  check('log riichi', (await L.text(host, '#log')).includes('うみがリーチ'));

  // ── リーチ中: 引いた牌だけ押せる。5索を引いてツモ ──
  // ほかの人の番を飛ばして、うみが 5索 を引いたところにする
  room = await L.roomOf(code);
  G = L.gameOf(room);
  const s = G.s;
  const take = s.wall.indexOf(id(22, 1));
  s.wall.splice(take, 1);
  s.seats[1].hand.push(id(22, 1));
  s.turn = 1; s.drawn = id(22, 1); s.phase = 'discard'; s.pending = null; s.claim = null; s.rev += 1;
  await putGame(code, G);
  await guest.page.waitForFunction(() => document.querySelectorAll('#me .mj-hand button').length === 14);
  const en2 = await guest.page.$$eval('#me .mj-hand button:not(:disabled)', (xs) => xs.map((x) => Number(x.dataset.id)));
  check('in riichi only drawn tile enabled', en2.length === 1 && en2[0] === id(22, 1), en2);
  check('status in riichi', (await L.text(guest, '#gameStatus')).includes('リーチ中'));
  await guest.page.click('#actions button:text-is("ツモ（あがる）")');
  await Promise.all([L.waitVisible(host, '#result'), L.waitVisible(guest, '#result')]);
  const yk = await host.page.$$eval('#resultYaku .mj-yaku__name', (xs) => xs.map((x) => x.textContent));
  check('yaku listed', yk.includes('門前清自摸和') && yk.includes('合計') && yk.some((x) => /立直/.test(x)), yk);
  check('han shown', /翻$/.test(await L.text(host, '#resultYaku .mj-yaku__total .mj-yaku__han')));
  check('ura dora shown for riichi', (await L.text(host, '#resultDora')).includes('裏ドラ表示牌'));
  check('no points shown', !/点/.test(await L.text(host, '#result')));
  room = await L.roomOf(code);
  check('wins counted', JSON.parse(room.wins)['p:うみ'] === 1);
  await host.page.screenshot({ path: L.OUT + '/yaku-result.png', fullPage: true });

  // ── 次の局: 子があがったので親が移って東2局 ──
  await host.page.click('#btnAgain');
  room = await L.roomWhen(code, (r) => r.round === 2);
  G = L.gameOf(room);
  check('kyoku 1 (東2局)', G.kyoku === 1 && G.s.dealer === 1, [G.kyoku, G.s.dealer]);
  await L.waitText(guest, '#roundLine', '東2局');
  check('guest is dealer now', (await L.text(guest, '#me .mj-seat__head')).includes('東・親'));

  // ── 暗槓: うみ（親）が白を4枚持って引いた ──
  const umi2 = [id(31, 0), id(31, 1), id(31, 2), id(31, 3), ...F(0, 9, 0), id(9, 0)];
  const sora2 = [...F(18, 9, 0), id(27, 0), id(27, 1), id(27, 2), id(28, 0)];
  const c22 = [...F(0, 9, 1), id(28, 1), id(29, 1), id(30, 1), id(32, 1)];
  const c32 = [...F(9, 9, 1), id(28, 2), id(29, 2), id(30, 2), id(32, 2)];
  rebuild(G.s, [sora2, umi2, c22, c32], 1, id(9, 0));
  G.s.dealer = 1;
  G.s.rev += 1;
  await putGame(code, G);
  await guest.page.waitForFunction(() => document.querySelectorAll('#me .mj-hand button').length === 14);
  const kanBtn = await guest.page.$$eval('#actions button', (xs) => xs.map((x) => x.textContent));
  check('kan button', kanBtn.some((t) => t.startsWith('カン')), kanBtn);
  await guest.page.click('#actions .mj-callbtn');
  room = await L.roomWhen(code, (r) => L.gameOf(r).s.kans === 1);
  G = L.gameOf(room);
  check('ankan meld', G.s.seats[1].melds[0].type === 'ankan');
  await guest.page.waitForFunction(() => document.querySelectorAll('#doraLine .mj-tile').length === 4);
  check('kan dora revealed (2 indicators)', true);
  check('ankan shows 2 backs', (await guest.page.$$('#me .mj-meld .mj-tile--back')).length === 2);
  check('after kan: guest draws rinshan (11 in hand)', (await guest.page.$$('#me .mj-hand button')).length === 11);
  check('log kan', (await L.text(host, '#log')).includes('うみがカン'));
  await guest.page.screenshot({ path: L.OUT + '/yaku-kan.png', fullPage: true });

  // 375px
  await guest.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('375 no overflow', (await L.overflow(guest)) <= 0, await L.overflow(guest));
  await guest.page.screenshot({ path: L.OUT + '/yaku-375.png', fullPage: true });

  await host.page.click('#btnLeave');
  await L.waitScreen(guest, 'top', 10000);
  await L.finishAll(server);
})().catch(async (e) => {
  console.error('FATAL', e);
  process.exit(2);
});
