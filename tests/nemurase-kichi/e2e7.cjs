// その7: はじめの道しるべ（2026-10-30 オーナー「はじめてプレイする人が何をしていいかわからず終わってしまう」）
// 役のお知らせの「はじめにすること」・自分の仕事への矢印（通れる道でいちばん近い所・かべの向こうを指さない）・「いまやること」の1行（隊員は仕事を1つおえるまで・ねむらせ屋は2段階）・375px
const L = require('./lib.cjs');
const { E, check, sleep } = L;

const guide = (c) => c.page.evaluate(() => {
  const G = window.__NK__.GUIDE;
  const pt = (p) => (p ? { x: p.x, y: p.y } : null);
  return { goal: pt(G.goal), aim: pt(G.aim), shown: G.shown };
});
const hint = async (c) => ((await L.visible(c, '#guideHint')) ? L.text(c, '#guideHint') : '');
const steps = (c) => c.page.$$eval('#roleSteps li', (li) => li.map((x) => x.textContent));
const tile = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
// テーブルをよけた道の長さ（アプリと同じ決め方を、ここでは別に書いて比べる）
// 人が立てる部屋のまん中（置き物・テーブルの上はのぞく）を n か所
const standPlaces = (n) => E.ROOMS.filter((r) => !r.part).map((r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 })).filter((p) => E.canStand(p.x, p.y)).slice(0, n);
function routeLen(from, to) {
  const a = tile(from);
  const b = tile(to);
  const ok = (x, y) => E.isFloor(x, y) && Math.hypot(x + 0.5 - E.TABLE.x, y + 0.5 - E.TABLE.y) >= E.TABLE.r + E.RADIUS;
  const seen = new Set([a.x + ',' + a.y]);
  let q = [a];
  for (let n = 0; q.length; n++) {
    const next = [];
    for (const c of q) {
      if (c.x === b.x && c.y === b.y) return n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = (c.x + dx) + ',' + (c.y + dy);
        if (!seen.has(k) && ok(c.x + dx, c.y + dy)) { seen.add(k); next.push({ x: c.x + dx, y: c.y + dy }); }
      }
    }
    q = next;
  }
  return Infinity;
}
// 矢印の向きの先が、かべにもテーブルにも当たらず見通せるか
function clear(a, b) {
  if (!E.canSee(a, b)) return false;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const k = Math.max(0, Math.min(1, ((E.TABLE.x - a.x) * dx + (E.TABLE.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(a.x + dx * k - E.TABLE.x, a.y + dy * k - E.TABLE.y) >= E.TABLE.r;
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');
  const g2 = await L.newClient('g2', { viewport: { width: 375, height: 740 } });
  const all = [host, g1, g2];

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await L.joinRoom(g2, 'みどり', code);
  await host.page.click('#btnAddBot');
  check('ロボット1つで4人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '4人'));
  await host.page.click('#btnStart');
  for (const c of all) await L.waitScreen(c, 'game');
  E.useMap('kichi');
  let room = await L.roomOf(code);

  // ══ 役のお知らせの「はじめにすること」 ══
  for (const c of all) {
    await L.waitVisible(c, '#ovRole');
    const id = (await L.me(c)).id;
    const s = await steps(c);
    const walk = c === g2 ? '左下のスティック' : '矢印キー';
    check('はじめにすること: 3つ ' + c.label, (await L.visible(c, '#roleStepsBox')) && s.length === 3, s);
    if (room.game.roles[id] === 'sleeper') check('ねむらせ屋の1つ目は仕事のふり（' + walk + '）' + c.label, s[0].includes('仕事をしているふり') && s[0].includes(walk) && s[1].includes('ねむらせる'), s);
    else check('隊員の1つ目は矢印の方へ（' + walk + '）' + c.label, s[0] === '黄色い矢印の方へ歩く（' + walk + '）' && s[1].includes('仕事をする') && s[2].includes('見つけた！'), s);
  }
  await L.shot(g2, '70-role-steps-375');
  await L.shot(host, '70b-role-steps');
  for (const c of all) await L.dismissRole(c);
  await L.patchGame(code, { roles: { 'ホスト': 'crew', 'あお': 'sleeper', 'みどり': 'crew', '*1': 'crew' }, cooldown: { 'あお': Date.now() + 3600000 }, darkReadyAt: Date.now() + 3600000, buttonReadyAt: 1 });
  await sleep(800);
  room = await L.roomOf(code);

  // ══ 隊員: 矢印と「いまやること」 ══
  const hostTasks = room.game.tasks['ホスト'];
  const solo = hostTasks.filter((t) => t.spot < E.PAIR_SPOT_BASE).map((t) => E.SPOTS[t.spot]);
  check('はじめは「いまやること」に「キーボードで、…歩こう」', await L.waitFor(async () => /^キーボードで、黄色い(矢印の方へ|「!」の所まで)歩こう$/.test(await hint(host))), await hint(host));
  let gd = await guide(host);
  check('矢印が出ている（テーブルのまわりからは仕事が見えない）', gd.shown, gd);
  await L.shot(host, '71-guide-arrow');

  // いろいろな場所に立って: 行き先はひとりの仕事のうち道でいちばん近い所・向きはかべの向こうでない
  const places = [E.TABLE, ...standPlaces(8)];
  let okNear = 0;
  let okAim = 0;
  let tried = 0;
  const badAim = [];
  for (const p0 of places) {
    const p = p0 === E.TABLE ? { x: E.TABLE.x + E.TABLE.r + 0.8, y: E.TABLE.y } : p0;
    await L.teleport(host, p.x, p.y);
    await sleep(150);
    gd = await guide(host);
    if (!gd.goal) continue;
    tried++;
    const best = Math.min(...solo.map((s) => routeLen(p, s)));
    if (routeLen(p, gd.goal) === best && solo.some((s) => s.x === gd.goal.x && s.y === gd.goal.y)) okNear++;
    if (E.isFloor(Math.floor(gd.aim.x), Math.floor(gd.aim.y)) && clear(p, gd.aim)) okAim++;
    else badAim.push({ p, aim: gd.aim, goal: gd.goal, see: E.canSee(p, gd.aim) });
  }
  check('行き先は、ひとりの仕事のうち道でいちばん近い所（' + tried + 'か所）', tried >= 6 && okNear === tried, { tried, okNear });
  check('矢印の向きの先は、かべにもテーブルにも当たらず見通せる床（' + tried + 'か所）', okAim === tried, { tried, okAim, badAim });

  // 仕事の前に立つと「仕事をする」を押そう・矢印は消える
  const first = solo[0];
  await L.teleport(host, first.x, first.y + 0.6);
  check('仕事の前では「「仕事をする」を押そう（スペースキーでもできる）」', await L.waitFor(async () => (await hint(host)) === '「仕事をする」を押そう（スペースキーでもできる）'), await hint(host));
  check('仕事の前では矢印を出さない', !(await guide(host)).shown);
  await L.shot(host, '72-guide-at-task');

  // 仕事を1つおえると「いまやること」は消え、矢印は次の仕事を指す
  await host.page.click('#actUse');
  await L.waitVisible(host, '#ovTask');
  await L.solveTask(host);
  check('1つおえると「いまやること」が消える', await L.waitFor(async () => (await hint(host)) === ''));
  await L.teleport(host, E.TABLE.x + E.TABLE.r + 0.8, E.TABLE.y);
  await sleep(300);
  gd = await guide(host);
  check('矢印は次の仕事を指す（おえた仕事でない）', !!gd.goal && !(gd.goal.x === first.x && gd.goal.y === first.y) && solo.some((s) => s.x === gd.goal.x && s.y === gd.goal.y), gd);

  // ひとりの仕事がぜんぶおわると、ふたりの仕事のスイッチを指す。ぜんぶおわると矢印なし
  const pairT = hostTasks.find((t) => t.spot >= E.PAIR_SPOT_BASE);
  await L.patchGame(code, { ['tasks/ホスト']: hostTasks.map((t) => ({ spot: t.spot, done: t.spot < E.PAIR_SPOT_BASE })) });
  if (pairT) {
    const p = E.pairOf(E.spotInfo(pairT.spot).pair);
    check('ひとりの仕事がおわると、ふたりの仕事のスイッチを指す', await L.waitFor(async () => { const x = await guide(host); return !!x.goal && [p.a, p.b].some((e) => e.x === x.goal.x && e.y === x.goal.y); }));
  }
  await L.patchGame(code, { ['tasks/ホスト']: hostTasks.map((t) => ({ spot: t.spot, done: true })) });
  check('仕事がぜんぶおわると矢印なし', await L.waitFor(async () => { const x = await guide(host); return !x.goal && !x.shown; }));

  // ══ 375px: やることはたたまれていても「いまやること」は出る ══
  check('375px: やることの一覧はたたまれている', await g2.page.$eval('#taskList', (n) => n.classList.contains('is-closed')));
  check('375px: 「左下のスティックで、…歩こう」', await L.waitFor(async () => (await hint(g2)).startsWith('左下のスティックで、黄色い')), await hint(g2));
  const r2 = await g2.page.evaluate(() => {
    const h = document.getElementById('guideHint').getBoundingClientRect();
    const m = document.getElementById('miniMap').getBoundingClientRect();
    return { right: h.right, mini: m.left, w: window.innerWidth };
  });
  check('375px: 横スクロールなし・小さな地図にかからない', (await L.overflow(g2)) <= 0 && r2.right <= r2.mini, r2);
  await L.shot(g2, '73-guide-375');

  // ══ ねむらせ屋: 2段階 ══
  const g1Tasks = room.game.tasks['あお'];
  check('ねむらせ屋: はじめは「…仕事の場所に立つと、仕事のふりができる」', await L.waitFor(async () => (await hint(g1)).endsWith('仕事の場所に立つと、仕事のふりができる')), await hint(g1));
  gd = await guide(g1);
  check('ねむらせ屋: 矢印はふりをする場所を指す', !!gd.goal && g1Tasks.some((t) => E.SPOTS[t.spot] && E.SPOTS[t.spot].x === gd.goal.x && E.SPOTS[t.spot].y === gd.goal.y), gd);
  const fake = E.SPOTS[g1Tasks[0].spot];
  await L.teleport(g1, fake.x, fake.y + 0.6);
  check('ねむらせ屋: 仕事の場所に立つと「ひとりでいる隊員に近づいて「ねむらせる」…」', await L.waitFor(async () => (await hint(g1)).startsWith('ひとりでいる隊員に近づいて「ねむらせる」')), await hint(g1));
  await L.teleport(g1, E.TABLE.x + E.TABLE.r + 0.8, E.TABLE.y);
  await sleep(300);
  check('ねむらせ屋: 2段目では矢印を出さない', !(await guide(g1)).goal);
  await L.shot(g1, '74-guide-sleeper');
  await L.patchGame(code, { sleptBy: { '*1': 'あお' } });
  check('ねむらせ屋: だれかをねむらせると「いまやること」が消える', await L.waitFor(async () => (await hint(g1)) === ''));

  // ══ ねむった隊員: かべを通りぬけるので、まっすぐ指す ══
  await L.patchGame(code, { asleep: { 'みどり': 'slept' } });
  await sleep(600);
  gd = await guide(g2);
  check('ねむった隊員: 矢印は仕事の場所をまっすぐ指す', !!gd.goal && gd.aim.x === gd.goal.x && gd.aim.y === gd.goal.y, gd);

  // ══ 会議の間は出さない ══
  await L.teleport(host, E.TABLE.x + E.TABLE.r + 0.3, E.TABLE.y);
  check('テーブルで会議ボタン', await L.waitFor(async () => (await L.text(host, '#actUseLabel')).startsWith('会議ボタン（あと')));
  await host.page.click('#actUse');
  check('会議がひらく', await L.waitFor(() => L.visible(g2, '#ovMeeting')));
  check('会議の間は「いまやること」も矢印も出さない', await L.waitFor(async () => (await hint(g2)) === '' && !(await guide(g2)).goal));

  // ══ パークでも、道でいちばん近い仕事を指す ══
  // 会議の途中で時間切れにして、票をスキップにそろえてしめきる（結果のあとで時間切れのおしまい）
  await L.patchGame(code, { endsAt: Date.now() - 1000 });
  await L.rest('PATCH', L.ROOMS + '/' + code + '/r/game/ballots/' + (await L.roomOf(code)).game.meeting.seq, { 'ホスト': '*skip', 'あお': '*skip', '*1': '*skip' });
  await host.page.click('#btnCloseVote');
  check('時間切れでおしまい', await L.waitFor(() => L.visible(host, '#ovEnd'), 12000));
  await host.page.click('#btnAgain');
  await L.waitScreen(host, 'waiting');
  await host.page.selectOption('#set-map', '1');
  await L.roomWhen(code, (r) => r && r.settings && r.settings.map === 1);
  await host.page.click('#btnStart');
  for (const c of all) { await L.waitScreen(c, 'game'); await L.dismissRole(c); }
  await L.patchGame(code, { roles: { 'ホスト': 'crew', 'あお': 'sleeper', 'みどり': 'crew', '*1': 'crew' }, cooldown: { 'あお': Date.now() + 3600000 }, darkReadyAt: Date.now() + 3600000 });
  await sleep(800);
  E.useMap('park');
  room = await L.roomOf(code);
  const soloP = room.game.tasks['ホスト'].filter((t) => t.spot < E.PAIR_SPOT_BASE).map((t) => E.SPOTS[t.spot]);
  let triedP = 0;
  let okP = 0;
  for (const p of standPlaces(8)) {
    await L.teleport(host, p.x, p.y);
    await sleep(150);
    const x = await guide(host);
    if (!x.goal) continue;
    triedP++;
    const best = Math.min(...soloP.map((s) => routeLen(p, s)));
    if (routeLen(p, x.goal) === best && clear(p, x.aim)) okP++;
  }
  check('パーク: 行き先は道でいちばん近い仕事・向きは見通せる床（' + triedP + 'か所）', triedP >= 6 && okP === triedP, { triedP, okP });
  await L.shot(host, '75-guide-park');

  // ══ 補助はそれぞれの子がメニューでかくす／出す（端末に覚えて、次の回もそのまま） ══
  const menuGuide = async (c) => { await c.page.click('#btnMenu'); await L.waitVisible(c, '#menuDialog'); const t = await L.text(c, '#btnMenuGuide'); await c.page.click('#btnMenuGuide'); const u = await L.text(c, '#btnMenuGuide'); await c.page.click('#btnMenuClose'); return [t, u]; };
  const [t0, t1] = await menuGuide(g2);
  check('メニュー: 「補助（矢印・いまやること）をかくす」→ 押すと「…を出す」', t0 === '補助（矢印・いまやること）をかくす' && t1 === '補助（矢印・いまやること）を出す', [t0, t1]);
  await sleep(500);
  let x2 = await guide(g2);
  check('かくした子には矢印も「いまやること」も出ない', !x2.goal && !x2.shown && (await hint(g2)) === '', x2);
  check('端末に覚える（nemurase_guide＝0）', (await g2.page.evaluate(() => localStorage.getItem('nemurase_guide'))) === '0');
  check('ほかの子はそのまま（矢印が出る）', !!(await guide(host)).goal);
  await L.shot(g2, '76-guide-off-375');
  // 次の回: かくした子は「はじめにすること」もなし、ほかの子にはある
  await L.patchGame(code, { endsAt: Date.now() - 1000 });
  check('時間切れでおしまい（2回目）', await L.waitFor(() => L.visible(host, '#ovEnd'), 6000));
  await host.page.click('#btnAgain');
  await L.waitScreen(host, 'waiting');
  await host.page.click('#btnStart');
  for (const c of all) { await L.waitScreen(c, 'game'); await L.waitVisible(c, '#ovRole'); }
  check('次の回: かくした子の役のお知らせに「はじめにすること」がない', !(await L.visible(g2, '#roleStepsBox')));
  check('次の回: ほかの子にはある', (await L.visible(host, '#roleStepsBox')) && (await L.visible(g1, '#roleStepsBox')));
  for (const c of all) await L.dismissRole(c);
  await sleep(800);
  x2 = await guide(g2);
  check('次の回も、かくした子には矢印も「いまやること」も出ない', !x2.goal && (await hint(g2)) === '', x2);
  // 出しなおす
  const [t2, t3] = await menuGuide(g2);
  check('メニュー: 「…を出す」→ 押すと「…をかくす」', t2 === '補助（矢印・いまやること）を出す' && t3 === '補助（矢印・いまやること）をかくす', [t2, t3]);
  check('出しなおすと、矢印と「いまやること」がもどる', await L.waitFor(async () => !!(await guide(g2)).goal && (await hint(g2)) !== ''));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
