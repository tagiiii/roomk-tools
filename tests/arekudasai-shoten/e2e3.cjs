// あれください商店 E2E その3: お客さんがヒントを決める時間（待合室でえらぶ・のこり秒・時間が来たら送る）
// 隔離エミュレーターだけを使う（本番には接続しない）。README.md を参照
const L = require('./lib.cjs');
const { E, check, roomWhen, gameOf, waitScreen, waitText, visible, text, rest, shot } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host'); host.name = 'ホスト';
  const a = await L.newClient('a'); a.name = 'あおい';
  const players = [host, a];
  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(a, 'あおい', code);
  await waitText(host, '#peopleCount', '2人');

  // はじめは「なし」
  check('ask default none', (await L.roomOf(code)).set?.ask === undefined || (await L.roomOf(code)).set.ask === 0);
  check('guest summary none', (await text(a, '#lobbySetView')).includes('ヒントを決める時間は なし'));
  await host.page.click('#askSeg .ak-seg__btn:has-text("20秒")');
  await roomWhen(code, (r) => r.set && r.set.ask === 20);
  await waitText(a, '#lobbySetView', 'ヒントを決める時間は 20秒');
  check('guest summary 20', true);
  await shot(host, '31-lobby-ask');

  await host.page.click('#btnStartGame');
  for (const c of players) await waitScreen(c, 'game');
  let g = await gameOf(code);
  check('game ask 20', (await L.roomOf(code)).game.ask === 20);
  const byName = (name) => players.find((c) => c.name === name);
  let C = byName(g.seats[g.S.turn]);
  let O = players.find((c) => c !== C);
  await waitText(C, '#stage', 'あなたのほしい物');
  check('customer countdown', await visible(C, '#askCount'));
  await waitText(O, '#stage', 'ヒントをえらんでいる');
  check('shop countdown', await visible(O, '#askCount'));
  const left = Number((await text(C, '#askCount')).replace(/\D/g, ''));
  check('countdown <= 20', left > 0 && left <= 20, left);
  await shot(C, '32-ask-count');

  // 1つもえらばずに時間が来たら、ほしい物に合うヒントが1つ送られる
  let want = g.S.players[g.S.turn].order;
  await rest('PUT', `${L.ROOMS}/${code}/play/${g.id}/r/s`, Date.now() - 19500);
  let r = await roomWhen(code, (room) => !!room.play?.[g.id]?.r?.h, 8000);
  let h = r.play[g.id].r.h.split(',');
  check('auto one hint', h.length === 1 && E.item(want).tags.includes(h[0]), h);
  await waitText(O, '#stage', 'どうする？');

  // お店が出さない → べつの物にする → 次の番
  await O.page.click('#stage .ak-choice:has-text("出さない")');
  await waitText(C, '#stage', 'べつの物にする');
  await C.page.click('#stage button:has-text("べつの物にする")');
  r = await roomWhen(code, (room) => room.play?.[g.id]?.r?.n === 2);
  const s2 = Number(r.play[g.id].r.s);
  check('next round s after result', s2 > Date.now() + 2000, s2 - Date.now());

  // 次のお客さんがヒントを1つえらんだところで時間が来たら、そのヒントで送る
  g = await gameOf(code);
  C = byName(g.seats[g.S.turn]);
  O = players.find((c) => c !== C);
  want = g.S.players[g.S.turn].order;
  // 結果の札を長く見ていても、お客さん本人の端末では、札を閉じたときからヒントを決める時間を数える
  await waitText(C, '#stage', 'つぎは、あなたがお客さん');
  await L.sleep(Math.max(0, s2 - Date.now()) + 3000);
  await L.closeCards(players);
  await waitText(C, '#stage', 'あなたのほしい物', 12000);
  const leftC = Number((await text(C, '#askCount')).replace(/\D/g, ''));
  check('customer ask restarts after card', leftC >= 18, leftC);
  const pick = E.item(want).tags[1];
  await C.page.click(`#stage .ak-chip-btn:has-text("${pick}")`);
  r = await roomWhen(code, (room) => !!room.play?.[g.id]?.r?.h, 25000);
  h = r.play[g.id].r.h.split(',');
  check('auto sends picked', h.length === 1 && h[0] === pick, h);

  await L.finishAll(server);
})().catch(async (e) => { console.error(e); process.exit(1); });
