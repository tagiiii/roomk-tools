// とりせつ解除班 E2E その2: 名前の検査・2人で遊ぶ（ホストも遊ぶ）・ゆっくり（時間をはからない・導火線なし）・説明書を分けない・
// みんなが「読むだけ」だとはじめられない・7人目は入れない・途中から入った人は見る番・解除する人が退出したときの時間切れ（ホストが代わりに書く）・
// 導火線がまにあわない・この回をやめて待合室へ・ホストが切れている間は時間が止まる（切断の検知を待つので1〜2分）
// 隔離エミュレーターだけを使う（本番には接続しない）。README.md を参照
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomWhen, gameOf, waitScreen, waitText, visible, waitVisible, text, overflow, waitFor, shot } = L;

const count = (c, sel) => c.page.evaluate((s) => document.querySelectorAll(s).length, sel);
async function zoomSlot(c, slot) {
  if (await visible(c, '#zoom')) await c.page.click('#btnZoomBack');
  await c.page.evaluate((back) => window.__tk.cube.showFace(back ? 'back' : 'front'), slot >= 3);
  await sleep(600);
  await c.page.click(`.tk-slot[data-slot="${slot}"]`);
  await waitVisible(c, '#zoomBody .tk-mod--big');
}
const press = (c, a) => c.page.click(`#zoomBody [data-a="${a}"]`);
async function solve(c, code, slot) {
  const g = await gameOf(code);
  const mod = g.bomb.slots[slot];
  const st = g.G.m[E.keyOf(slot)] || {};
  await zoomSlot(c, slot);
  if (mod.type === 'cord') await press(c, 'cut:' + mod.sol);
  else if (mod.type === 'glyph') {
    for (let i = 0; i < 4; i++) if (!!((st.b || 0) & (1 << i)) !== mod.sol[i]) await press(c, 'tog:' + i);
    await press(c, 'chk:');
  } else if (mod.type === 'dial') {
    let pos = st.p || mod.start;
    while (pos !== mod.sol) { await press(c, 'turn:1'); pos = (pos % 8) + 1; }
    await press(c, 'chk:');
  } else {
    for (const d of mod.sol.slice(st.p || 0)) await press(c, 'dir:' + d);
  }
  await roomWhen(code, (r) => r.game.ok && r.game.ok[E.keyOf(slot)] === true);
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host'); host.name = 'メンター';
  const a = await L.newClient('a'); a.name = 'あおい';

  // 名前の検査
  await L.open(host);
  await host.page.click('#btnGoCreate');
  await host.page.click('#btnCreateRoom');
  await waitText(host, '#createError', '名前を入れてね');
  await host.page.fill('#hostName', 'a.b');
  await host.page.click('#btnCreateRoom');
  await waitText(host, '#createError', '使えない');
  await host.page.fill('#hostName', 'メンター');
  await host.page.click('#btnCreateRoom');
  await waitScreen(host, 'waiting');
  const code = (await text(host, '#roomCodeLabel')).trim();
  await L.open(a);
  await a.page.click('#btnGoJoin');
  await a.page.fill('#guestName', 'メンター');
  await a.page.fill('#joinCode', code.toLowerCase());
  await a.page.click('#btnJoinRoom');
  await waitText(a, '#joinError', '使われている');
  await a.page.fill('#guestName', 'あおい');
  await a.page.fill('#joinCode', 'あいうえおか');
  await a.page.click('#btnJoinRoom');
  await waitText(a, '#joinError', '英字に切り替えて');
  await a.page.fill('#joinCode', code.toLowerCase());
  await a.page.click('#btnJoinRoom');
  await waitScreen(a, 'waiting');

  // 1人では、はじめられない → 「ホストも遊ぶ」で2人
  check('note for 1 player', (await text(host, '#seatNote')).includes('ホストも遊ぶ'));
  check('start disabled', await host.page.evaluate(() => document.getElementById('btnStartGame').disabled));
  await host.page.check('#hostPlays');
  await roomWhen(code, (r) => r.set.hostPlays === true);
  await waitText(host, '#peopleCount', '2人');
  check('start enabled with 2', !(await host.page.evaluate(() => document.getElementById('btnStartGame').disabled)));
  // みんなが「読むだけ」だと、はじめられない
  await host.page.check('#roSelf');
  await a.page.check('#roSelf');
  await roomWhen(code, (r) => r.players['メンター'].ro === true && r.players['あおい'].ro === true);
  await waitText(host, '#seatNote', '読むだけ');
  check('all read-only blocks start', await host.page.evaluate(() => document.getElementById('btnStartGame').disabled));
  // ゲストの「読むだけ」は、読み込み直しても残る（在室が消えて書きなおされても）
  await a.page.reload();
  await waitScreen(a, 'waiting');
  await roomWhen(code, (r) => r.players['あおい'] && r.players['あおい'].ro === true, 10000);
  await sleep(1500);
  check('ro kept after guest reload', (await L.roomOf(code)).players['あおい'].ro === true && await a.page.evaluate(() => document.getElementById('roSelf').checked));
  await a.page.uncheck('#roSelf');
  await roomWhen(code, (r) => !r.players['あおい'].ro);
  // 読むだけの印は、読み込み直しても残る
  await host.page.reload();
  await waitScreen(host, 'waiting');
  check('ro kept after host reload', (await L.roomOf(code)).players['メンター'].ro === true);

  // ゆっくり・説明書を分けない・やさしい
  await host.page.click('#levelSeg .tk-seg__btn:has-text("やさしい")');
  await host.page.check('#setSlow');
  await host.page.uncheck('#setSplit');
  await roomWhen(code, (r) => r.set.slow === true && r.set.split === false && r.set.level === 'easy');
  check('slow note', (await text(host, '#levelNote')).includes('時間をはからない'));
  await waitText(a, '#lobbySetView', 'みんなが全部読める');
  await shot(host, '20-lobby-settings');

  // ── 2人（ホストは読むだけ・あおいが解除する人）・ゆっくり ──
  await host.page.click('#btnStartGame');
  for (const c of [host, a]) await waitScreen(c, 'game');
  let g = await gameOf(code);
  check('2 seats, guest defuses (host is read-only)', g.seats.join() === 'メンター,あおい' && g.seats[g.def] === 'あおい', g);
  check('slow: no timer, no fuse', g.G.t === null && g.bomb.fuse === null && E.regularSlots(g.bomb).length === 3);
  check('host reads manual', await visible(host, '#page') && (await count(host, '.tk-slot')) === 0);
  check('host menu while playing', await visible(host, '#hostMenu'));
  check('slow clock text', (await text(a, '#hudTime')) === 'ゆっくり' && (await text(host, '#hudTime')) === 'ゆっくり');
  // 説明書を分けない: 読む人が全部のページを持つ
  const tabs = await host.page.evaluate(() => [...document.querySelectorAll('.tk-tab')].map((n) => n.dataset.ch));
  check('all pages for the reader', tabs.join() === ['clues', ...E.bombChapters(g.bomb)].join(), tabs);
  // みんなにみせる画面を途中でひらく
  const watch = await L.newClient('watch');
  await L.open(watch, '?watch=' + code);
  await waitScreen(watch, 'game');
  check('watch board slow', await visible(watch, '#viewBoard') && (await text(watch, '#boardTime')) === 'ゆっくり' && (await count(watch, '.tk-slot, .tk-line')) === 0);
  await shot(watch, '21-watch-slow');
  // 途中から入った人は、この回は見る番（みんなの画面）
  const late = await L.newClient('late'); late.name = 'みどり';
  await L.open(late, '?room=' + code);
  await waitScreen(late, 'join');
  await late.page.fill('#guestName', 'みどり');
  await late.page.click('#btnJoinRoom');
  await waitScreen(late, 'game');
  check('late joiner watches', await visible(late, '#viewBoard') && (await text(late, '#barMe')).includes('見る番') && (await count(late, '.tk-slot, .tk-line')) === 0);
  // 解除
  for (const s of E.regularSlots(g.bomb)) await solve(a, code, s);
  g = await gameOf(code);
  check('safe in slow mode', g.G.out === 'safe');
  await waitText(host, '#resultBox', '解除成功');
  check('slow result has no time', !(await text(host, '#resultBox')).includes('のこり時間'));
  check('next defuser skips read-only host', (await text(host, '#resultBox')).includes('つぎに解除する人: みどり'), await text(host, '#resultBox'));

  // ── 待合室へ → ふつう・時間あり・3人（メンター読むだけ・あおい・みどり） ──
  await host.page.click('#resultBox .tk-quiet');
  for (const c of [host, a, late, watch]) await waitScreen(c, 'waiting');
  await host.page.uncheck('#setSlow');
  await host.page.click('#levelSeg .tk-seg__btn:has-text("ふつう")');
  await roomWhen(code, (r) => r.set.slow === false && r.set.level === 'normal');

  // 7人目は入れない（遊ぶ人は6人まで）
  const extras = [];
  for (const name of ['あ', 'い', 'う']) { const c = await L.newClient('x' + name); c.name = name; await L.joinRoom(c, name, code); extras.push(c); }
  await waitText(host, '#peopleCount', '6人');
  const seventh = await L.newClient('seventh');
  await L.open(seventh, '?room=' + code);
  await waitScreen(seventh, 'join');
  await seventh.page.fill('#guestName', 'なな');
  await seventh.page.click('#btnJoinRoom');
  await waitText(seventh, '#joinError', 'いっぱい');
  check('7th rejected', (await L.screen(seventh)) === 'join');
  await shot(host, '22-lobby-6');
  check('lobby 6 no overflow', (await overflow(host)) <= 0);
  for (const c of extras) { await c.page.click('#btnLeave'); await waitScreen(c, 'top'); }
  await waitText(host, '#peopleCount', '3人');

  await host.page.click('#btnStartGame');
  for (const c of [host, a, late, watch]) await waitScreen(c, 'game');
  g = await gameOf(code);
  check('normal: 4 modules + fuse + 5:00', E.regularSlots(g.bomb).length === 4 && !!g.bomb.fuse && g.G.t.left === 300000);
  const D = [a, late].find((c) => c.name === g.seats[g.def]);
  check('defuser is a non read-only guest', !!D, g.seats[g.def]);
  // 説明書を分けない設定のまま: 読む人2人とも、全部のページ
  const R = [host, a, late].filter((c) => c !== D);
  for (const c of R) check('reader has all pages: ' + c.name, (await c.page.evaluate(() => document.querySelectorAll('.tk-tab').length)) === 1 + E.bombChapters(g.bomb).length);

  // 導火線がまにあわない → まちがい1回（解除する人の端末が書く）
  await rest('PATCH', L.ROOMS + '/' + code + '/game', { startAt: Date.now() - 49000 });
  await waitVisible(D, '#fuseBar');
  await roomWhen(code, (r) => r.game.x === 1 && r.game.fz === 1, 6000);
  g = await gameOf(code);
  check('fuse miss = 1 strike', g.G.x === 1 && g.G.fz === 1 && g.G.t.rate === 1.25, g.G);
  await waitFor(async () => (await count(watch, '#boardLamps .tk-lampx.is-on')) === 1);
  // 導火線が来ないよう、はじめた時刻を先へ
  await rest('PATCH', L.ROOMS + '/' + code + '/game', { startAt: Date.now() + 600000 });

  // 二度押し: まちがった操作を続けて2回押しても、まちがいは1回だけ増える
  g = await gameOf(code);
  {
    const slot = E.regularSlots(g.bomb)[0];
    const mod = g.bomb.slots[slot];
    await zoomSlot(D, slot);
    let wrong = 'chk:';
    if (mod.type === 'cord') wrong = 'cut:' + [0, 1, 2, 3, 4].find((i) => i !== mod.sol);
    if (mod.type === 'arrow') wrong = 'dir:' + 'UDLR'.split('').find((d) => d !== mod.sol[0]);
    if (mod.type === 'dial' && mod.start === mod.sol) await press(D, 'turn:1');
    await D.page.evaluate((a) => { const b = document.querySelector('#zoomBody [data-a="' + a + '"]'); b.click(); b.click(); document.querySelector('#zoomBody [data-a="' + a + '"]')?.click(); }, wrong);
    await roomWhen(code, (r) => r.game.x >= 2);
    await sleep(700);
    g = await gameOf(code);
    check('double press = 1 strike', g.G.x === 2, g.G.x);
  }
  // ホストが切れている間は、時間が止まる（オーバーレイ）。戻ると、その分だけずれて続く
  host.offlineOk = true;
  await host.context.setOffline(true);
  await roomWhen(code, (r) => r.hostConnected === false, 120000);
  await waitVisible(D, '#hostOffOverlay');
  check('overlay for guests + watch', await visible(late, '#hostOffOverlay') || await visible(a, '#hostOffOverlay'));
  const t1 = await text(D, '#hudTime');
  await sleep(2500);
  const t2 = await text(D, '#hudTime');
  check('clock frozen while host is away', t1 === t2, { t1, t2 });
  await shot(D, '23-host-off');
  const before = await gameOf(code);
  await host.context.setOffline(false);
  await roomWhen(code, (r) => r.hostConnected === true, 60000);
  await waitFor(async () => !(await visible(D, '#hostOffOverlay')));
  const after = await gameOf(code);
  check('time shifted on host return', after.G.t.at > before.G.t.at && after.G.t.left === before.G.t.left, { b: before.G.t, a: after.G.t });
  check('no boom from the pause', !after.G.out && after.G.x === 2);

  // 解除する人が退出 → のこり2秒にして、ホストが3秒おくれて代わりに爆発を書く
  await D.page.click('#btnLeave');
  await waitScreen(D, 'top');
  await roomWhen(code, (r) => !r.players[D.name]);
  await rest('PATCH', L.ROOMS + '/' + code + '/game/t', { left: 2000, at: Date.now() });
  await roomWhen(code, (r) => r.game.out === 'boom', 12000);
  g = await gameOf(code);
  check('host backup writes time-out', g.G.out === 'boom' && g.G.why === 'time', g.G);
  check('backup counted on host only', await L.waitStats(host, 'boom-time', 1));
  await waitText(watch, '#resultBox', 'ドカーン');

  // もう一回: いなくなった人は入らない。この回をやめて待合室へ
  await host.page.click('#resultBox .tk-result__actions .btn-primary');
  await roomWhen(code, (r) => r.game && r.game.out == null && r.game.id >= 3);
  g = await gameOf(code);
  check('left player not seated', !g.seats.includes(D.name), g.seats);
  await host.page.click('#btnLobby');
  for (const c of [host, watch]) await waitScreen(c, 'waiting');
  check('abort does not count finish', (await L.stats(host, 'finish')) === 1, await L.stats(host, 'finish'));

  await host.page.click('#btnLeave');
  await waitScreen(watch, 'watch-end');
  check('room removed', (await L.roomOf(code)) === null);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
