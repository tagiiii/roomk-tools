// あれください商店 E2E その2: 12人・13人目は入れない・みんなが決めたら時間を待たずに次へ・スマホ幅・
// 名前の検査・ホストが切れている間は書かない（切断の検知を待つので1〜2分）
// 隔離エミュレーターだけを使う（本番には接続しない）。README.md を参照
const L = require('./lib.cjs');
const { E, check, sleep, roomWhen, gameOf, waitScreen, waitText, visible, waitVisible, text, overflow, shot } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host'); host.name = 'ホスト';
  const code = await L.createRoom(host, 'ホスト');
  // 名前の検査
  const bad = await L.newClient('bad');
  await L.open(bad, '?room=' + code);
  await waitScreen(bad, 'join');
  await bad.page.fill('#guestName', 'ホスト');
  await bad.page.click('#btnJoinRoom');
  await waitText(bad, '#joinError', 'その名前は使われている');
  await bad.page.fill('#guestName', 'a.b');
  await bad.page.click('#btnJoinRoom');
  await waitText(bad, '#joinError', '記号');
  check('name checks', true);
  await bad.context.close();
  L.clients.splice(L.clients.indexOf(bad), 1);

  // 11人が入る（1人はスマホ）
  const guests = [];
  for (let i = 1; i <= 11; i++) {
    const c = await L.newClient('g' + i, i === 1 ? { viewport: { width: 375, height: 812 }, mobile: true } : {});
    c.name = 'ひと' + i;
    await L.joinRoom(c, c.name, code);
    guests.push(c);
  }
  await waitText(host, '#peopleCount', '12人');
  // 13人目は入れない
  const full = await L.newClient('full');
  await L.open(full, '?room=' + code);
  await waitScreen(full, 'join');
  await full.page.fill('#guestName', 'じゅうさん');
  await full.page.click('#btnJoinRoom');
  await waitText(full, '#joinError', 'いっぱい');
  check('13th refused', (await L.roomOf(code)).players['じゅうさん'] === undefined);
  // ホストを進行だけにすると入れる → 戻すと12人をこえるので戻せない
  await host.page.uncheck('#hostPlays');
  await roomWhen(code, (r) => r.set.hostPlays === false);
  await full.page.click('#btnJoinRoom');
  await waitScreen(full, 'waiting');
  // 押すと、こえるので戻される（チェックは外れたまま）
  await host.page.click('#hostPlays');
  await L.waitToast(host, '12人まで');
  check('host plays stays off', (await L.roomOf(code)).set.hostPlays === false);
  await full.page.click('#btnLeave');
  await waitScreen(full, 'top');
  await host.page.check('#hostPlays');
  await roomWhen(code, (r) => r.set.hostPlays === true);

  const players = [host, ...guests];
  await host.page.click('#btnStartGame');
  for (const c of players) await waitScreen(c, 'game');
  let g = await gameOf(code);
  check('12 seats', g.seats.length === 12);
  check('12 houses', (await host.page.$$('#town .ak-house')).length === 12);
  check('mobile no overflow (game)', (await overflow(guests[0])) <= 0, await overflow(guests[0]));
  await shot(guests[0], '11-mobile-12');
  await shot(host, '12-desktop-12');

  // お客さんがヒントを送り、11のお店がみんな決めたら、時間を待たずに箱をえらぶ場面へ
  const byName = (name) => players.find((c) => c.name === name);
  const C = byName(g.seats[g.S.turn]);
  const want = g.S.players[g.S.turn].order;
  const tags = E.item(want).tags.slice(0, 2);
  await waitText(C, '#stage', 'あなたのほしい物');
  for (const t of tags) await C.page.click(`#stage .ak-chip-btn:has-text("${t}")`);
  await C.page.click('#stage button:has-text("これください！")');
  const holder = E.holderOf(g.S, want);
  const started = Date.now();
  for (let i = 0; i < 12; i++) {
    if (i === g.S.turn) continue;
    const c = byName(g.seats[i]);
    await waitText(c, '#stage', 'どうする？');
    if (i === holder || i % 3 === 0) {
      // 品物の札を押して、箱にそえるひとことをえらぶ
      if (i === holder) await c.page.click(`#shelf button.ak-card:has-text("${E.item(want).name}")`);
      else await c.page.click('#shelf button.ak-card >> nth=0');
      await waitText(c, '#stage', 'ひとことを、1つえらんでね');
      await c.page.click('#stage .ak-chip-btn >> nth=' + (i % 13));
    } else await c.page.click('#stage .ak-choice:has-text("出さない")');
  }
  await waitText(C, '#stage', 'どの箱を受け取る？', 8000);
  check('pick before deadline', Date.now() - started < 29000, Date.now() - started);
  check('mobile no overflow (pick)', (await overflow(guests[0])) <= 0);
  await shot(C, '13-pick-12');
  await C.page.click(`#stage button.ak-offer:has-text("${g.seats[holder]}のお店")`);
  await waitText(C, '#stage', 'ぴったり！', 6000);
  await waitText(guests[0], '#stage', 'ぴったり！', 6000);
  check('mobile no overflow (result)', (await overflow(guests[0])) <= 0);
  await shot(guests[0], '14-mobile-result');

  // ホストが切れている間は、参加者は押せない（オーバーレイ）
  host.offlineOk = true;
  await host.context.setOffline(true);
  await roomWhen(code, (r) => r.hostConnected === false, 120000);
  await waitVisible(guests[1], '#hostOffOverlay', 10000);
  check('overlay shown', await visible(guests[1], '#hostOffOverlay'));
  await host.context.setOffline(false);
  await roomWhen(code, (r) => r.hostConnected === true, 30000);
  await L.waitFor(async () => !(await visible(guests[1], '#hostOffOverlay')), 10000);
  check('overlay hidden after return', !(await visible(guests[1], '#hostOffOverlay')));

  await L.finishAll(server);
})().catch(async (e) => { console.error(e); process.exit(1); });
