// 麻雀の E2E その1（隔離エミュレーター）: 作成・参加・名前の検査・設定・みんなにみせる画面・はじめる（4席・CPU）・
// 手牌は人ごと・最後まで打つ・結果・次の局・時間切れ2回で CPU にまかせる・自分でやる・通信が切れた人の番は CPU・
// 同じ名前で入りなおす・読み込み直し・375px・この局をやめる・ルームを閉じる
const L = require('./lib.cjs');
const { check, sleep } = L;

async function playUntilOver(people, watcher, timeout = 240000, ponRate = 0.3) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (await L.visible(people[0], '#result')) return true;
    for (const c of people) await L.humanMove(c, ponRate).catch(() => null);
    await sleep(150);
  }
  return L.visible(watcher, '#result');
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const guest = await L.newClient('guest');

  // ── 作成・参加 ──
  const code = await L.createRoom(host, 'そら');
  check('room code', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('stats room-create', await L.waitStats(host, 'room-create', 1));
  await L.waitText(host, '#lobbyCount', 'あいている3席はCPU');

  await L.open(guest, '?room=' + code);
  await L.waitScreen(guest, 'join');
  await guest.page.fill('#guestName', 'CPUくん');
  await guest.page.click('#btnJoinRoom');
  await L.waitText(guest, '#joinError', 'CPU');
  check('CPU name rejected', true);
  await guest.page.fill('#guestName', 'そら');
  await guest.page.click('#btnJoinRoom');
  await L.waitText(guest, '#joinError', '使われている');
  check('same name rejected', true);
  await guest.page.fill('#guestName', 'うみ');
  await guest.page.click('#btnJoinRoom');
  await L.waitScreen(guest, 'lobby');
  await L.waitText(host, '#lobbyCount', 'あいている2席はCPU');
  check('guest sees rules view, not editor', await L.visible(guest, '#lobbyRulesView') && !(await L.visible(guest, '#lobbyRules')));

  // ── 設定がみんなに見える ──
  await host.page.click('label.mj-seg__opt:has(input[name="rule-level"][value="normal"])');
  await L.waitText(guest, '#lobbyRulesView', 'ふつう');
  await host.page.click('label.mj-seg__opt:has(input[name="rule-level"][value="easy"])');
  await host.page.click('label.mj-seg__opt:has(input[name="time-limit"][value="30"])');
  await host.page.click('input[data-rule="chiitoi"]');
  await L.waitText(guest, '#lobbyRulesView', '30秒');
  let room = await L.roomWhen(code, (r) => r.settings.level === 'easy' && r.settings.time === 30 && r.settings.chiitoi === false);
  check('settings saved', room.settings.level === 'easy' && room.settings.time === 30 && room.settings.chiitoi === false && room.settings.calls === true, room.settings);
  check('guest rules view chiitoi off', (await L.text(guest, '#lobbyRulesView')).includes('あがりにしない'));
  await host.page.click('input[data-rule="chiitoi"]');

  // ── 見え方は、待合室でひとりずつ選べる（ルームには書かない） ──
  check('lobby view card for guest', await L.visible(guest, '#lobbyView'));
  check('groups on by default', await guest.page.isChecked('#lobbyView input[data-opt="groups"]'));
  await guest.page.uncheck('#lobbyView input[data-opt="groups"]');
  check('guest groups off stored locally', await guest.page.evaluate(() => JSON.parse(localStorage.getItem('mahjong:view')).groups === false));
  check('host still on', await host.page.isChecked('#lobbyView input[data-opt="groups"]'));
  check('view not written to room', !JSON.stringify(await L.roomOf(code)).includes('groups'));

  // ── みんなにみせる画面 ──
  const watch = await L.newClient('watch');
  await L.open(watch, '?watch=' + code);
  await L.waitScreen(watch, 'lobby');
  check('watch join info', await L.visible(watch, '#lobbyJoin'));
  check('watch has no lobby view card', !(await L.visible(watch, '#lobbyView')));
  check('watch title', (await watch.page.title()).startsWith('みんなにみせる画面 | 麻雀'));

  // ── はじめる ──
  await host.page.click('#btnStartGame');
  await Promise.all([L.waitScreen(host, 'game'), L.waitScreen(guest, 'game'), L.waitScreen(watch, 'game')]);
  room = await L.roomOf(code);
  let G = L.gameOf(room);
  check('4 seats', G.seats.length === 4, G.seats);
  check('seats humans then CPU', G.seats.map((x) => x.name).join(',') === 'そら,うみ,CPU 1,CPU 2', G.seats.map((x) => x.name));
  const total = G.s.wall.length + G.s.seats.reduce((a, s) => a + s.hand.length, 0);
  check('136 tiles at start', total === 136, total);
  check('dealer is first seat in round 1', G.s.dealer === 0);
  check('stats start / players-2', await L.waitStats(host, 'start', 1) && await L.waitStats(host, 'players-2', 1));
  const hostTiles = await host.page.$$eval('#me .mj-hand button', (xs) => xs.map((x) => x.dataset.id));
  const guestTiles = await guest.page.$$eval('#me .mj-hand button', (xs) => xs.map((x) => x.dataset.id));
  check('host has 14 (dealer)', hostTiles.length === 14, hostTiles.length);
  check('guest has 13', guestTiles.length === 13, guestTiles.length);
  check('hands differ', !hostTiles.some((id) => guestTiles.includes(id)));
  check('watch shows no hand buttons', (await watch.page.$$('#me button.mj-tile')).length === 0);
  check('watch shows backs', (await watch.page.$$('#me .mj-tile--back')).length === 14);
  check('3 opponents', (await host.page.$$('#opps .mj-opp')).length === 3);
  check('host turn status', (await L.text(host, '#gameStatus')).includes('あなたの番'));
  check('host hint shows', (await L.text(host, '#hintLine')).includes('あと'));
  check('best marked', (await host.page.$$('#me .is-best')).length > 0);
  check('timer visible (30s)', await L.visible(host, '#timer'));
  check('tab title my turn', (await host.page.title()).startsWith('●あなたの番'));
  // 見え方: 名前を出す（この端末だけ・ルームに書かない）
  await host.page.check('#viewOpts input[data-opt="names"]');
  check('names shown', (await host.page.$$('#me .mj-cap')).length === 14);
  check('names stored locally', await host.page.evaluate(() => JSON.parse(localStorage.getItem('mahjong:view')).names === true));
  check('guest has no names', (await guest.page.$$('#me .mj-cap')).length === 0);
  await host.page.uncheck('#viewOpts input[data-opt="names"]');
  // 見え方: そろった組の枠（はじめはオン。うみは待合室で切った）
  const hostSets = await host.page.$$eval('#me .mj-set', (xs) => xs.map((x) => x.querySelectorAll('.mj-tile').length));
  const expect = await host.page.evaluate(() => {
    const ids = [...document.querySelectorAll('#me .mj-hand button')].map((b) => Number(b.dataset.id));
    const drawn = document.querySelector('#me .mj-gap + button');
    const rest = ids.filter((x) => !drawn || x !== Number(drawn.dataset.id));
    return window.MahjongEngine.groupHand(window.MahjongEngine.counts(rest)).map((g) => g.kinds.length);
  });
  check('host frames match groupHand', JSON.stringify(hostSets) === JSON.stringify(expect), [hostSets, expect]);
  check('host still 14 tiles with frames', (await host.page.$$('#me .mj-hand button')).length === 14);
  check('guest has no frames (chose off)', (await guest.page.$$('#me .mj-set')).length === 0);
  check('guest game toggle synced off', !(await guest.page.isChecked('#viewOpts input[data-opt="groups"]')));
  await guest.page.check('#viewOpts input[data-opt="groups"]');
  check('guest lobby toggle synced on', await guest.page.isChecked('#lobbyView input[data-opt="groups"]'));
  check('watch has no view options', !(await L.visible(watch, '#viewOpts')));
  await host.page.uncheck('#viewOpts input[data-opt="groups"]');
  check('host frames off', (await host.page.$$('#me .mj-set')).length === 0);
  await host.page.check('#viewOpts input[data-opt="groups"]');

  // 自分の番でない人は押せない
  check('guest tiles disabled', await guest.page.$$eval('#me .mj-hand button', (xs) => xs.every((x) => x.disabled)));

  // ── 最後まで ──
  const over = await playUntilOver([host, guest], watch);
  check('round finished', over);
  await Promise.all([L.waitVisible(guest, '#result'), L.waitVisible(watch, '#result')]);
  room = await L.roomOf(code);
  G = L.gameOf(room);
  const res = G.s.result;
  const tiles2 = G.s.wall.length + G.s.seats.reduce((a, s) => a + s.hand.length + s.river.filter((r) => !r.called).length + s.melds.reduce((b, m) => b + m.tiles.length, 0), 0);
  check('136 tiles at end', tiles2 === 136, tiles2);
  check('result title', (await L.text(guest, '#resultTitle')).length > 0);
  check('host has next buttons', await L.visible(host, '#btnAgain') && !(await L.visible(guest, '#btnAgain')));
  check('guest waits', await L.visible(guest, '#resultWait'));
  if (res.type !== 'draw') {
    const wins = JSON.parse(room.wins);
    check('wins counted', wins[G.seats[res.winner].id] === 1, wins);
    check('winning hand shown', (await host.page.$$('#resultHand .mj-tile')).length === 14, (await host.page.$$('#resultHand .mj-tile')).length);
    check('win tile marked', (await host.page.$$('#resultHand .is-win')).length === 1);
  } else {
    check('draw shown', (await L.text(host, '#resultTitle')) === '引き分け');
  }
  // 終わらせた transaction の画面で1回（ホストの CPU か、ロン・ツモを押した人）
  await sleep(500);
  check('stats finish once', (await L.stats(host, 'finish')) + (await L.stats(guest, 'finish')) === 1);
  check('log has events', (await host.page.$$('#log li')).length > 0);
  await host.page.screenshot({ path: L.OUT + '/result.png', fullPage: true });

  // ── 次の局 ──
  await host.page.click('#btnAgain');
  room = await L.roomWhen(code, (r) => r.round === 2);
  G = L.gameOf(room);
  check('round 2', room.round === 2);
  check('dealer moved', G.s.dealer === 1, G.s.dealer);
  check('stats again', await L.waitStats(host, 'again', 1));
  await L.waitText(guest, '#roundLine', '第2局');

  // ── 時間切れ（うみの捨てる番で、締め切りを過去にして2回） ──
  async function timeoutGuestOnce() {
    const until = Date.now() + 60000;
    while (Date.now() < until) {
      const r = await L.roomOf(code);
      const g = L.gameOf(r);
      if (g.s.phase === 'end') return 'end';
      if (g.s.phase === 'discard' && g.seats[g.s.turn].name === 'うみ') {
        const n = (g.timeouts['p:うみ'] || 0);
        g.deadline = 1;
        await L.rest('PUT', L.ROOMS + '/' + code + '/game', JSON.stringify(g));
        const after = await L.roomWhen(code, (x) => (L.gameOf(x).timeouts['p:うみ'] || 0) > n, 5000);
        return (L.gameOf(after).timeouts['p:うみ'] || 0) > n ? 'ok' : 'stuck';
      }
      // うみの番になるまで、聞かれたらパス・そらは打つ
      await L.humanMove(host).catch(() => null);
      const acts = await guest.page.$$eval('#actions button', (xs) => xs.map((x) => x.textContent));
      if (acts.includes('パス')) await guest.page.click('#actions button:text-is("パス")').catch(() => null);
      await sleep(150);
    }
    return 'timeout';
  }
  const t1 = await timeoutGuestOnce();
  const t2 = t1 === 'ok' ? await timeoutGuestOnce() : t1;
  check('timeouts x2', t1 === 'ok' && t2 === 'ok', [t1, t2]);
  if (t2 === 'ok') {
    await L.waitVisible(guest, '#autoBanner');
    check('auto banner', true);
    check('log says CPU takes over', (await L.text(host, '#log')).includes('時間切れが2回続いた') || (await host.page.evaluate(() => [...document.querySelectorAll('#log li')].some((x) => x.textContent.includes('時間切れ')))));
    await guest.page.click('#btnSelf');
    await L.roomWhen(code, (x) => !L.gameOf(x).auto['p:うみ']);
    await guest.page.waitForFunction(() => document.getElementById('autoBanner').closest('[hidden]') || document.getElementById('autoBanner').hidden);
    check('take back', true);
  }

  // ── 通信が切れた人の番は CPU（タブを閉じる） ──
  await guest.context.close();
  await L.roomWhen(code, (x) => !x.players['うみ'], 30000);
  await L.waitText(host, '#opps', '通信が切れた', 15000);
  check('away tag on host', true);
  {
    const until = Date.now() + 60000;
    let cpuPlayed = false;
    while (Date.now() < until && !cpuPlayed) {
      const g = L.gameOf(await L.roomOf(code));
      cpuPlayed = g.log.some((x) => x.text.includes('うみ（CPUが代わり）')) || g.s.phase === 'end';
      if (!cpuPlayed) { await L.humanMove(host).catch(() => null); await sleep(200); }
    }
    check('CPU plays for away guest', cpuPlayed);
  }

  // ── 同じ名前で入りなおす（別の端末） ──
  const guest2 = await L.newClient('guest2');
  await L.joinRoom(guest2, 'うみ', code, 'game');
  check('rejoined seat', (await guest2.page.$$('#me .mj-hand button')).length > 0 || await L.visible(guest2, '#result'));
  await host.page.waitForFunction(() => !document.getElementById('opps').textContent.includes('通信が切れた'), null, { timeout: 15000 });
  check('away tag cleared', true);

  // ── 読み込み直し ──
  await guest2.page.reload();
  await L.waitScreen(guest2, 'game', 10000);
  check('reload returns to game', true);

  // ── 375px ──
  await guest2.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('375 no overflow', (await L.overflow(guest2)) <= 0, await L.overflow(guest2));
  const w = await guest2.page.$$eval('#me .mj-hand button', (xs) => (xs[0] ? xs[0].getBoundingClientRect().width : 40));
  check('375 tile width >= 32', w >= 32, w);
  await guest2.page.screenshot({ path: L.OUT + '/m375.png', fullPage: true });
  await host.page.screenshot({ path: L.OUT + '/host.png', fullPage: true });
  await watch.page.screenshot({ path: L.OUT + '/watch.png', fullPage: true });

  // ── この局をやめて待合室へ → ルームを閉じる ──
  if (await L.visible(host, '#btnStop')) {
    await host.page.click('#btnStop');
  } else {
    await host.page.click('#btnRelobby');
  }
  await Promise.all([L.waitScreen(host, 'lobby'), L.waitScreen(guest2, 'lobby'), L.waitScreen(watch, 'lobby')]);
  check('back to lobby', true);
  await host.page.click('#btnLeave');
  await L.waitScreen(guest2, 'top', 10000);
  await L.waitScreen(watch, 'watch-end', 10000);
  check('room closed', (await L.roomOf(code)) === null);

  await L.finishAll(server);
})().catch(async (e) => {
  console.error('FATAL', e);
  process.exit(2);
});
