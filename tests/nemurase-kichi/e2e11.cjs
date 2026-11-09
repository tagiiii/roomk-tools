// その11: みんなを見る（2026-11-09 子どもの要望「1人1人見えるようにしてほしい」→「ねむったあとや見学のとき、みんながどこにいるか見たい」）
// ねむった人と途中から入った見学の子だけが、上の ◀ ▶ で1人ずつ見られる・地図にみんなの点。おきている人・進行役には出ない
const L = require('./lib.cjs');
const { E, check, sleep } = L;

const nk = (c, fn, arg) => c.page.evaluate(fn, arg);
const follow = (c) => nk(c, () => window.__NK__.state.follow);
const fpos = (c) => nk(c, () => window.__NK__.followPos(window.__NK__.gameOf(window.__NK__.state.room)));
const people = (c) => nk(c, () => window.__NK__.watchPeople(window.__NK__.gameOf(window.__NK__.state.room)));
const kind = (c) => nk(c, () => window.__NK__.watcherKind(window.__NK__.gameOf(window.__NK__.state.room)));
const freezeBot = (c, id, x, y) => nk(c, ([i, a, b]) => {
  const bot = window.__NK__.BOTS[i];
  bot.x = a; bot.y = b; bot.route = []; bot.goal = null; bot.busyUntil = Date.now() + 3600000;
}, [id, x, y]);
// マップの canvas の色（いま画面の真ん中にいる人＝見ている人か自分 を中心にしたカメラで、マス座標 (wx, wy) の体の色の所）
const camPixel = (c, wx, wy) => nk(c, ([ax, ay]) => {
  const canvas = document.getElementById('map');
  const En = window.NemuraseEngine;
  const N = window.__NK__;
  const CW = canvas.clientWidth;
  const CH = canvas.clientHeight;
  const dpr = canvas.width / CW;
  const TS = Math.round(Math.max(26, Math.min(46, Math.min(CW / 15, CH / 10))));
  const F = N.followPos(N.gameOf(N.state.room)) || N.ME;
  const clamp = (v, max) => (max <= 0 ? max / 2 : Math.max(0, Math.min(max, v)));
  const camX = clamp(F.x * TS - CW / 2, En.W * TS - CW);
  const camY = clamp(F.y * TS - CH / 2, En.H * TS - CH);
  const r = En.RADIUS * TS * 1.25;
  const d = canvas.getContext('2d').getImageData(Math.round((ax * TS - camX) * dpr), Math.round((ay * TS - camY + r * 0.5) * dpr), 1, 1).data;
  return [d[0], d[1], d[2]];
}, [wx, wy]);
// 小さな地図の色（マス座標の所）
const miniPixel = (c, wx, wy) => nk(c, ([ax, ay]) => {
  const cv = document.getElementById('miniView');
  const En = window.NemuraseEngine;
  const w = cv.clientWidth;
  const dpr = cv.width / w;
  const s = w / En.W;
  const d = cv.getContext('2d').getImageData(Math.round(ax * s * dpr), Math.round(ay * s * dpr), 1, 1).data;
  return [d[0], d[1], d[2]];
}, [wx, wy]);
const colorOf = async (code, id) => (await L.roomOf(code)).game.colors[id];
const hexOf = (key) => E.COLORS.find((c) => c.key === key).hex;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');
  const g2 = await L.newClient('g2');

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(g1, 'あお', code);
  await L.joinRoom(g2, 'みどり', code);
  await host.page.click('#btnAddBot');
  await host.page.click('#btnAddBot');
  check('ロボット2つで5人', await L.waitFor(async () => (await L.text(host, '#playerCount')) === '5人'));
  await host.page.click('#btnStart');
  for (const c of [host, g1, g2]) await L.waitScreen(c, 'game');
  for (const c of [host, g1, g2]) await L.dismissRole(c);
  E.useMap(0);
  await L.patchGame(code, {
    roles: { 'ホスト': 'crew', 'あお': 'crew', 'みどり': 'sleeper', '*1': 'crew', '*2': 'crew' },
    cooldown: { 'みどり': Date.now() + 3600000, '*1': Date.now() + 3600000, '*2': Date.now() + 3600000 },
    darkReadyAt: Date.now() + 3600000, buttonReadyAt: Date.now() + 3600000,
  });
  // ロボットは遠くの仕事の場所に止める。ホストとみどりもはなれた所に置く
  const far = E.SPOTS.reduce((a, b) => (E.dist(b, E.TABLE) > E.dist(a, E.TABLE) ? b : a));
  const B = { x: far.x, y: far.y + 0.6 };
  await freezeBot(host, '*1', B.x, B.y);
  const B2 = { x: E.TABLE.x, y: E.TABLE.y + 5 };
  await freezeBot(host, '*2', B2.x, B2.y);
  const H = { x: E.TABLE.x + 4, y: E.TABLE.y };
  await L.teleport(host, H.x, H.y);
  const M = E.spawnPoint(2, 5);
  await L.teleport(g2, M.x, M.y);
  await sleep(800);

  // ══ おきている人には出ない ══
  check('おきている人には「みんなを見る」が出ない', !(await L.visible(g1, '#hudFollow')));
  check('おきている人は見る人を選べない（watcherKind が空）', (await kind(g1)) === '');
  check('おきている人の地図には、みんなの点を出さない', (await people(g1)) === null);
  check('おきている人は g を受け取らない', (await L.subs(g1)).g === false);

  // ══ ねむると出る ══
  await L.patchGame(code, { asleep: { 'あお': 'slept' }, sleptBy: { 'あお': 'みどり' } });
  check('ねむると「みんなを見る」が出る', await L.waitFor(() => L.visible(g1, '#hudFollow')));
  check('ねむった人は ghost', (await kind(g1)) === 'ghost');
  check('はじめは「自分を見ている」', (await L.text(g1, '#followText')) === '自分を見ている');
  check('はじめは ◀ ▶ の説明', (await L.text(g1, '#followHint')).includes('1人ずつ'));
  check('はじめは「自分にもどる」を出さない', !(await L.visible(g1, '#followSelf')));
  check('ねむったときの帯に ◀ ▶ の説明', await L.waitFor(async () => (await L.text(g1, '#stageBanner')).includes('◀ ▶')));
  const ppl = await people(g1);
  check('地図の点はほかの4人', ppl && ppl.length === 4, ppl);
  check('地図の点の位置（ロボット）', ppl.some((p) => E.dist(p, B) < 0.5), ppl);

  // ◀ ▶ でまわる（自分 → ホスト → みどり → ロボット → ロボット → 自分）
  const order = (await L.gameIn(g1)).players.filter((id) => id !== 'あお');
  await g1.page.click('#followNext');
  check('▶ で1人目を見る', (await follow(g1)) === order[0], await follow(g1));
  check('名前が出る', (await L.text(g1, '#followText')).includes('さんを見ている'));
  check('見ている間は「自分にもどる」', await L.visible(g1, '#followSelf') && (await L.text(g1, '#followSelf')).includes('自分にもどる'));
  check('見ている間は「歩くと自分にもどる」', (await L.text(g1, '#followHint')).includes('歩くと'));
  check('見ている人の色の丸', await L.visible(g1, '#followChip'));
  await g1.page.click('#followNext');
  await g1.page.click('#followNext');
  check('▶ で3人目', (await follow(g1)) === order[2]);
  await g1.page.click('#followNext');
  check('▶ で4人目', (await follow(g1)) === order[3]);
  await g1.page.click('#followNext');
  check('さいごの次は自分にもどる', (await follow(g1)) === null);
  await g1.page.click('#followPrev');
  check('◀ で さいごの人', (await follow(g1)) === order[3]);

  // ロボットを見る: カメラがロボットの所。ロボットが画面に描かれる
  await nk(g1, (id) => { window.__NK__.state.follow = id; window.__NK__.state.followLast = null; }, '*1');
  await sleep(300);
  check('見ている人の所にカメラ（ロボット）', E.dist(await fpos(g1), B) < 0.6, await fpos(g1));
  const botHex = hexOf(await colorOf(code, '*1'));
  check('見ている人が画面に描かれる（ロボットの色）', await L.waitFor(async () => L.nearColor(await camPixel(g1, B.x, B.y), botHex, 30)), [await camPixel(g1, B.x, B.y), botHex]);
  const p1 = (await people(g1)).find((p) => E.dist(p, B) < 0.6);
  check('地図の点で、見ている人に印', p1 && p1.on === true, p1);
  await L.shot(g1, '110-watch-bot');

  // ホストを見る: ホストが動くとカメラもついていく
  await nk(g1, (id) => { window.__NK__.state.follow = id; window.__NK__.state.followLast = null; }, 'ホスト');
  const H2 = { x: E.TABLE.x - 4, y: E.TABLE.y };
  await L.teleport(host, H2.x, H2.y);
  check('見ている人が動くと、カメラもついていく', await L.waitFor(async () => E.dist(await fpos(g1), H2) < 0.6), await fpos(g1));
  await g1.page.click('#followSelf');
  check('「自分にもどる」で自分', (await follow(g1)) === null && (await fpos(g1)) === null);

  // 歩くと自分にもどる
  await nk(g1, (id) => { window.__NK__.state.follow = id; }, 'ホスト');
  await g1.page.keyboard.down('ArrowRight');
  await sleep(250);
  await g1.page.keyboard.up('ArrowRight');
  check('歩くと自分にもどる', (await follow(g1)) === null);

  // ねむっている人も選べる（ロボットの片方をねむらせる。おきている隊員はまだねむらせ屋より多い）
  await L.patchGame(code, { asleep: { 'あお': 'slept', '*2': 'slept' } });
  check('ねむっている人も選べる', await L.waitFor(async () => ((await people(g1)) || []).some((p) => !p.up)), await people(g1));
  check('まだ遊んでいる（勝ち負けは決まっていない）', (await L.roomOf(code)).game.stage === 'play');
  await nk(g1, (id) => { window.__NK__.state.follow = id; window.__NK__.state.followLast = null; }, '*2');
  check('ねむっている人は「（ねむっている）」', await L.waitFor(async () => (await L.text(g1, '#followText')).includes('（ねむっている）')));

  // 近道の中の人: 描かず、カメラは入った所のまま（行き先が分からないように）
  await nk(g1, (id) => { window.__NK__.state.follow = id; window.__NK__.state.followLast = null; }, 'みどり');
  const v0 = E.VENTS[0];
  const v1 = E.VENTS[E.VENTS.length - 1];
  await L.teleport(g2, v0.x, v0.y);
  check('みどりを見ている（近道の前）', await L.waitFor(async () => E.dist(await fpos(g1), v0) < 0.6), await fpos(g1));
  await nk(g2, ([a, b]) => { window.__NK__.ME.vent = { id: 0, until: Date.now() + 60000 }; window.__NK__.ME.x = a; window.__NK__.ME.y = b; }, [v0.x, v0.y]);
  check('近道の中の人は地図の点に出ない', await L.waitFor(async () => !(await people(g1)).some((p) => E.dist(p, v0) < 0.6)), await people(g1));
  await nk(g2, ([a, b]) => { window.__NK__.ME.x = a; window.__NK__.ME.y = b; }, [v1.x, v1.y]);
  await sleep(1200);
  check('近道の中で移っても、カメラは入った所のまま', E.dist(await fpos(g1), v0) < 0.6, await fpos(g1));
  await nk(g2, () => { window.__NK__.ME.vent = null; });
  check('近道から出ると、また見える', await L.waitFor(async () => E.dist(await fpos(g1), v1) < 0.6), await fpos(g1));
  // 近道に入って移ったあとから選んでも、移った先にはカメラを動かさない（Codex レビュー 2026-11-09）
  await nk(g1, () => { window.__NK__.state.follow = null; window.__NK__.state.followLast = null; });
  await nk(g2, () => { window.__NK__.ME.vent = { id: 1, until: Date.now() + 60000 }; });
  await sleep(800);
  await nk(g2, ([a, b]) => { window.__NK__.ME.x = a; window.__NK__.ME.y = b; }, [v0.x, v0.y]);
  await sleep(1200);
  await nk(g1, (id) => { window.__NK__.state.follow = id; window.__NK__.state.followLast = null; }, 'みどり');
  await sleep(300);
  check('近道の中で移ったあとに選んでも、カメラは最後に見えていた所', E.dist(await fpos(g1), v1) < 0.6, await fpos(g1));
  await nk(g2, () => { window.__NK__.ME.vent = null; });
  check('近道から出ると、出た所が見える', await L.waitFor(async () => E.dist(await fpos(g1), v0) < 0.6), await fpos(g1));

  // へんしん中: なっている人の名前で出す（役は出さない）
  await L.patchGame(code, { jobs: { 'みどり': 'shifter' }, shape: { 'みどり': { as: 'ホスト', until: Date.now() + 20000 } } });
  check('へんしん中は、なっている人の名前', await L.waitFor(async () => (await L.text(g1, '#followText')) === 'ホスト さんを見ている'), await L.text(g1, '#followText'));
  check('地図の点も、なっている人の名前', (await people(g1)).filter((p) => p.name === 'ホスト').length === 2, await people(g1));
  check('バーに役を出さない', !(await L.text(g1, '#hudFollow')).includes('ねむらせ屋'));
  await L.patchGame(code, { shape: null });

  // 地図（大・小）にみんなの点
  await nk(g1, () => { window.__NK__.state.follow = null; });
  await L.teleport(g1, E.TABLE.x, E.TABLE.y + 6);
  const hostHex = hexOf(await colorOf(code, 'ホスト'));
  check('小さな地図にほかの人の点', await L.waitFor(async () => L.nearColor(await miniPixel(g1, H2.x, H2.y), hostHex, 30)), [await miniPixel(g1, H2.x, H2.y), hostHex]);
  await g1.page.click('#btnMap');
  check('大きな地図がひらく', await L.waitFor(() => L.visible(g1, '#ovMap')));
  await sleep(300);
  await L.shot(g1, '111-watch-map');
  await g1.page.click('#btnMapClose');
  // おきている人の小さな地図には出ない（同じ場所の色がホストの色でない）
  check('おきている人の小さな地図にはほかの人を出さない', !L.nearColor(await miniPixel(g2, H2.x, H2.y), hostHex, 30));

  // ══ 途中から入った見学の子 ══
  const late = await L.newClient('late');
  await L.joinRoom(late, 'おそい', code).catch(() => {});
  await L.waitScreen(late, 'game');
  check('見学の子は guest', await L.waitFor(async () => (await kind(late)) === 'guest'));
  check('見学の子にも「みんなを見る」', await L.waitFor(() => L.visible(late, '#hudFollow')));
  check('見学の子ははじめ「基地ぜんたいを見ている」', (await L.text(late, '#followText')) === '基地ぜんたいを見ている');
  check('見学のお知らせに ◀ ▶', (await L.text(late, '#watchNote')).includes('◀ ▶'));
  const ls = await L.subs(late);
  check('見学の子は位置を受け取る（p と g）', ls.p === true && ls.g === true, ls);
  check('見学の子の基地ぜんたいに、みんなの点', await L.waitFor(async () => ((await people(late)) || []).length === 5), await people(late));
  await L.shot(late, '112-watch-guest-overview');
  await late.page.click('#followNext');
  check('見学の子も ▶ で1人ずつ', (await follow(late)) !== null);
  check('見学の子の「基地ぜんたい」ボタン', (await L.text(late, '#followSelf')).includes('基地ぜんたい'));
  check('見学の子には「歩くと」を出さない', (await L.text(late, '#followHint')) === '');
  await nk(late, (id) => { window.__NK__.state.follow = id; window.__NK__.state.followLast = null; }, 'ホスト');
  check('見学の子の画面の真ん中に、見ている人が描かれる', await L.waitFor(async () => L.nearColor(await camPixel(late, H2.x, H2.y), hostHex, 30)), [await camPixel(late, H2.x, H2.y), hostHex]);
  await L.shot(late, '113-watch-guest-follow');
  await late.page.click('#followSelf');
  check('「基地ぜんたい」でもどる', (await follow(late)) === null);

  // 自分が抜けた人になったら、選んでいた人を外す（戻っても続きから見えない。Codex レビュー 2026-11-09）
  await nk(g1, (id) => { window.__NK__.state.follow = id; }, 'ホスト');
  await L.rest('PATCH', L.ROOMS + '/' + code + '/r/game/left', { 'あお': true });
  check('抜けた人になると、選んでいた人を外す', await L.waitFor(async () => (await follow(g1)) === null), await follow(g1));
  check('抜けた人にはバーを出さない（もとは遊ぶ人）', await L.waitFor(async () => !(await L.visible(g1, '#hudFollow')), 3000));
  await L.rest('DELETE', L.ROOMS + '/' + code + '/r/game/left/' + encodeURIComponent('あお'));
  check('戻ると、またねむった人としてバーが出る', await L.waitFor(() => L.visible(g1, '#hudFollow')));
  check('戻っても、前に選んでいた人は見ない', (await follow(g1)) === null);

  // ══ 幅 375px ══
  await g1.page.setViewportSize({ width: 375, height: 740 });
  await nk(g1, (id) => { window.__NK__.state.follow = id; }, 'ホスト');
  await sleep(400);
  check('375px: 横にはみ出さない', (await L.overflow(g1)) <= 0);
  const r = await g1.page.evaluate(() => {
    const box = (s) => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    return { bar: box('#hudFollow'), prev: box('#followPrev'), next: box('#followNext'), self: box('#followSelf'), vw: innerWidth };
  });
  check('375px: バーが画面に収まる', r.bar.r <= r.vw && r.next.r <= r.vw && r.self.r <= r.vw, r);
  check('375px: ◀ ▶ は40px以上', r.prev.w >= 40 && r.next.w >= 40, r);
  await L.shot(g1, '114-watch-375');
  await g1.page.setViewportSize({ width: 1200, height: 800 });

  // ══ 会議になると、自分にもどり、バーをかくす ══
  await nk(g1, (id) => { window.__NK__.state.follow = id; }, 'ホスト');
  let g = (await L.roomOf(code)).game;
  const seq = (g.meetingSeq || 0) + 1;
  await L.patchGame(code, { stage: 'meeting', meetingSeq: seq, meeting: { seq, why: 'button', caller: 'ホスト', endsAt: Date.now() + 120000, votes: {} } });
  check('会議になるとバーをかくす（ねむった人）', await L.waitFor(async () => (await L.visible(g1, '#ovMeeting')) && !(await L.visible(g1, '#hudFollow'))));
  check('会議になると自分にもどる', (await follow(g1)) === null);
  check('会議の間は地図の点を出さない', (await people(g1)) === null && (await people(late)) === null);
  check('会議になるとバーをかくす（見学）', !(await L.visible(late, '#hudFollow')));

  await sleep(200);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
