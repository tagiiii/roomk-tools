// あれください商店 E2E その4: お店の人が決める時間「なし」（時間が過ぎても、みんな決めるまで待つ）
// 隔離エミュレーターだけを使う（本番には接続しない）。README.md を参照
const L = require('./lib.cjs');
const { E, check, sleep, roomWhen, gameOf, waitScreen, waitText, text, rest, shot } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host'); host.name = 'ホスト';
  const a = await L.newClient('a'); a.name = 'あおい';
  const players = [host, a];
  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(a, 'あおい', code);
  await waitText(host, '#peopleCount', '2人');

  await host.page.click('#offerSeg .ak-seg__btn:has-text("なし")');
  await roomWhen(code, (r) => r.set && r.set.offer === 0);
  await waitText(a, '#lobbySetView', 'お店の人が決める時間は なし');
  check('guest summary offer none', true);
  await shot(host, '41-lobby-offer-none');

  await host.page.click('#btnStartGame');
  for (const c of players) await waitScreen(c, 'game');
  let g = await gameOf(code);
  check('game offer 0', (await L.roomOf(code)).game.offer === 0);
  const byName = (name) => players.find((c) => c.name === name);
  const C = byName(g.seats[g.S.turn]);
  const O = players.find((c) => c !== C);
  const want = g.S.players[g.S.turn].order;
  await waitText(C, '#stage', 'あなたのほしい物');
  await C.page.click(`#stage .ak-chip-btn:has-text("${E.item(want).tags[0]}")`);
  await C.page.click('#stage button:has-text("これください！")');
  await roomWhen(code, (r) => r.play[r.game.id].r.h);
  await waitText(O, '#stage', 'どうする？');
  check('shop sees no limit', (await text(O, '#stage')).includes('みんな決めるまで待つよ'));
  check('shop no countdown', !/のこり \d+秒/.test(await text(O, '#stage')));

  // ヒントを送ってから2分たったことにしても、お店はまだ決められる
  await rest('PUT', `${L.ROOMS}/${code}/play/${g.id}/r/at`, Date.now() - 120000);
  await sleep(1500);
  check('still offer (shop)', (await text(O, '#stage')).includes('どうする？'));
  check('still offer (customer)', (await text(C, '#stage')).includes('お店の人が考えているよ'));
  await shot(O, '42-offer-none');

  // お店が決めたら、お客さんが箱をえらぶ場面へ
  await O.page.click('#stage .ak-choice:has-text("出さない")');
  await waitText(C, '#stage', 'べつの物にする');
  await C.page.click('#stage button:has-text("べつの物にする")');
  for (const c of players) await waitText(c, '#stage', 'だれも出さなかった', 6000);
  // 結果の札は「次へ」を押すまで残る
  await sleep(7000);
  for (const c of players) check('card stays: ' + c.name, (await text(c, '#stage')).includes('だれも出さなかった'));
  check('next customer line', (await text(O, '#stage')).includes('つぎは、あなたがお客さん'));
  await shot(O, '43-card-next');
  await L.closeCards(players);
  await waitText(O, '#stage', 'あなたのほしい物');
  check('card closed', !(await text(O, '#stage')).includes('だれも出さなかった'));

  await L.finishAll(server);
})().catch(async (e) => { console.error(e); process.exit(1); });
