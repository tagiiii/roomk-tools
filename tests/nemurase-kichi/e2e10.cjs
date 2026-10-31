// その10: ロボットの票（2026-10-31 子どもの要望「ロボットの投票を何とかして。ねむった人を最後に見た場所の方で見かけた人に投票するとか」）
// ロボットが見かけた人と場所を覚える・ねむった人の場所を覚える・会議でその近くで見かけた人に入れる・手がかりがなければスキップ
const L = require('./lib.cjs');
const { E, check, sleep } = L;

const botsOf = (c) => c.page.evaluate(() => JSON.parse(JSON.stringify(window.__NK__.BOTS)));
// ロボットをその場に止める（歩かない・仕事をしない・見つけたも押さない。覚えるのはつづける）
const freeze = (c, id, x, y) => c.page.evaluate(([i, a, b]) => {
  const bot = window.__NK__.BOTS[i];
  bot.x = a; bot.y = b; bot.route = []; bot.goal = null; bot.busyUntil = Date.now() + 3600000;
}, [id, x, y]);

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await host.page.click('#btnAddBot');
  await host.page.click('#btnAddBot');
  check('ロボット2つで4人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '4人'));
  await host.page.click('#btnStart');
  for (const c of [host, g1]) await L.waitScreen(c, 'game');
  for (const c of [host, g1]) await L.dismissRole(c);
  E.useMap(0);
  await L.patchGame(code, {
    roles: { 'ホスト': 'crew', 'あお': 'sleeper', '*1': 'crew', '*2': 'crew' },
    cooldown: { 'あお': Date.now() + 3600000, '*1': Date.now() + 3600000, '*2': Date.now() + 3600000 },
    darkReadyAt: Date.now() + 3600000, buttonReadyAt: Date.now() + 3600000,
  });

  // 現場: ひろばから遠い仕事の場所。*1 はそこに止め、*2 は現場からいちばん遠い仕事の場所に止める
  const spot = E.SPOTS.reduce((a, b) => (E.dist(b, E.TABLE) > E.dist(a, E.TABLE) ? b : a));
  const P = { x: spot.x, y: spot.y + 0.6 };
  const farSpot = E.SPOTS.reduce((a, b) => (E.dist(b, P) > E.dist(a, P) ? b : a));
  const F = { x: farSpot.x, y: farSpot.y + 0.6 };
  check('現場と遠い場所は見える広さより離れている', E.dist(P, F) > E.VIEW.crew * 3, { P, F });
  await freeze(host, '*1', P.x, P.y);
  await freeze(host, '*2', F.x, F.y);
  // ホスト（ねむる人）とあお（ねむらせ屋）が現場に来る
  await L.teleport(host, P.x, P.y);
  await L.teleport(g1, P.x + 0.5, P.y);
  check('ロボットが見かけた人と場所を覚える', await L.waitFor(async () => {
    const b = (await botsOf(host))['*1'];
    return (b.seen['あお'] || []).some((s) => E.dist(s, P) < 1) && (b.seen['ホスト'] || []).some((s) => E.dist(s, P) < 1);
  }), Object.keys((await botsOf(host))['*1'].seen));
  check('遠くのロボットは、見えない人を覚えない', !(await botsOf(host))['*2'].seen['あお']?.some((s) => E.dist(s, P) < 3));

  // ホストが現場でねむる（あおがねむらせた形）。あおはすぐ遠くへ逃げる
  await L.patchGame(code, { asleep: { 'ホスト': 'slept' }, bodies: { 'ホスト': { x: P.x, y: P.y } } });
  await L.teleport(g1, E.TABLE.x + 3, E.TABLE.y);
  check('ロボットが、ねむった人の場所と最後に見かけた所を覚える', await L.waitFor(async () => {
    const c = (await botsOf(host))['*1'].cases['ホスト'];
    return !!c && E.dist(c, P) < 0.2 && !!c.last && E.dist(c.last, P) < 1;
  }), (await botsOf(host))['*1'].cases);

  // 会議をひらく（ロボットは4〜12秒のうちに入れる）
  let g = (await L.roomOf(code)).game;
  const seq = (g.meetingSeq || 0) + 1;
  await L.patchGame(code, { stage: 'meeting', meetingSeq: seq, meeting: { seq, why: 'body', caller: 'あお', found: 'ホスト', endsAt: Date.now() + 120000, votes: {} }, bodies: null });
  check('会議がひらく', await L.waitFor(() => L.visible(g1, '#ovMeeting')));
  const ballots = async () => ((await L.roomOf(code)).game.ballots || {})[seq] || {};
  check('ロボットが2つとも入れる', await L.waitFor(async () => { const b = await ballots(); return !!b['*1'] && !!b['*2']; }, 20000), await ballots());
  const b = await ballots();
  check('現場で見かけた人に入れる（*1 → あお）', b['*1'] === 'あお', b);
  check('手がかりがなければスキップ（*2）', b['*2'] === '*skip', b);
  await L.shot(g1, '100-bot-vote');

  // 会議のあとは前の手がかりを使わない: 結果のあと遊ぶ時間にもどると、覚えたねむった人は消える
  await L.rest('PATCH', L.ROOMS + '/' + code + '/r/game/ballots/' + seq, { 'あお': '*skip' });
  check('みんな入れたら結果', await L.waitFor(() => L.visible(g1, '#ovResult'), 10000));
  check('結果のあと遊ぶ時間にもどる', await L.waitFor(async () => (await L.roomOf(code)).game.stage === 'play', 15000));
  check('会議のあとは、前のねむった人の手がかりを使わない', await L.waitFor(async () => Object.keys((await botsOf(host))['*1'].cases).length === 0));
  g = (await L.roomOf(code)).game;
  check('あおはつかまっていない（スキップが多い）', !g.asleep?.['あお'] && !g.winner, { asleep: g.asleep, winner: g.winner });

  await sleep(200);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
