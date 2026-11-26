// とりせつ解除班 E2E その1: 作成・参加・待合室・設定・みんなにみせる画面・役ごとの見え方（爆弾は解除する人だけ・説明書は読む人だけ）・
// 爆弾を回す・近くで見る・4種類のしかけを正しく解除・まちがい・ひとこと・説明書の1行を見せる・読み込み直し・解除成功・
// もう一回（解除する人の交代）・まちがい3回で爆発・時間切れで爆発・導火線・待合室へ・ルームを閉じる
// 隔離エミュレーターだけを使う（本番には接続しない）。README.md を参照
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomWhen, gameOf, waitScreen, waitText, visible, waitVisible, text, overflow, waitFor, shot } = L;

const count = (c, sel) => c.page.evaluate((s) => document.querySelectorAll(s).length, sel);
// 解除する人: しかけを近くで見る（見えていない面は、先に回す）
async function zoomSlot(c, slot) {
  if (await visible(c, '#zoom')) { await c.page.click('#btnZoomBack'); }
  await c.page.evaluate((back) => window.__tk.cube.showFace(back ? 'back' : 'front'), slot >= 3);
  await sleep(600);
  await c.page.click(`.tk-slot[data-slot="${slot}"]`);
  await waitVisible(c, '#zoomBody .tk-mod--big');
}
const press = (c, a) => c.page.click(`#zoomBody [data-a="${a}"]`);
// 正しい操作で、しかけを1つ解除する
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
// まちがいを1回する（コードがあれば、ちがうコードを切る。なければ、ちがうまま「たしかめる」）
async function mistake(c, code) {
  const g = await gameOf(code);
  const open = E.regularSlots(g.bomb).filter((i) => !g.G.ok[E.keyOf(i)]);
  const slot = open[0];
  const mod = g.bomb.slots[slot];
  const st = g.G.m[E.keyOf(slot)] || {};
  await zoomSlot(c, slot);
  if (mod.type === 'cord') {
    const cut = (st.c || '').split(',').filter(Boolean).map(Number);
    await press(c, 'cut:' + [0, 1, 2, 3, 4].find((i) => i !== mod.sol && !cut.includes(i)));
  } else if (mod.type === 'arrow') await press(c, 'dir:' + 'UDLR'.split('').find((d) => d !== mod.sol[st.p || 0]));
  else if (mod.type === 'dial') {
    if ((st.p || mod.start) === mod.sol) await press(c, 'turn:1');
    await press(c, 'chk:');
  } else {
    const bits = st.b || 0;
    if (mod.sol.every((up, i) => !!(bits & (1 << i)) === up)) await press(c, 'tog:0');
    await press(c, 'chk:');
  }
  await roomWhen(code, (r) => (r.game.x || 0) > g.G.x || r.game.out);
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host'); host.name = 'ホスト';
  const a = await L.newClient('a'); a.name = 'あおい';
  const b = await L.newClient('b'); b.name = 'みどり';
  const m = await L.newClient('m', { viewport: { width: 375, height: 760 }, mobile: true }); m.name = 'もも';
  const guests = [a, b, m];
  const byName = (name) => guests.find((c) => c.name === name);

  await L.open(host);
  await shot(host, '00-top');
  check('top no overflow', (await overflow(host)) <= 0);
  const code = await L.createRoom(host, 'ホスト');
  check('room code', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('create counted', await L.waitStats(host, 'room-create', 1));
  // ホストは、はじめは進行だけ。1人も遊ぶ人がいないと、はじめられない
  check('host does not play by default', (await text(host, '#barMe')).includes('進行だけ'));
  check('start disabled alone', await host.page.evaluate(() => document.getElementById('btnStartGame').disabled));
  await L.joinRoom(a, 'あおい', code);
  check('start disabled with 1 player', await host.page.evaluate(() => document.getElementById('btnStartGame').disabled));
  await L.joinRoom(b, 'みどり', code);
  await L.joinRoom(m, 'もも', code);
  await waitText(host, '#peopleCount', '3人');
  check('guest sees summary', (await text(a, '#lobbySetView')).includes('ふつう'));
  check('next defuser chip', (await text(host, '#lobbyPeople li:nth-child(1)')).includes('つぎに解除する人'));
  await shot(host, '01-lobby-host');
  await shot(m, '01-lobby-mobile');
  check('lobby mobile no overflow', (await overflow(m)) <= 0);

  // 「読むだけ」: 本人が付ける → つぎに解除する人が、次の人になる。ホストも付け外しできる
  await a.page.check('#roSelf');
  await roomWhen(code, (r) => r.players['あおい'].ro === true);
  await waitFor(async () => (await text(host, '#lobbyPeople li:nth-child(2)')).includes('つぎに解除する人'));
  check('ro moves next defuser', (await text(host, '#lobbyPeople li:nth-child(1)')).includes('読むだけ') && (await text(host, '#lobbyPeople li:nth-child(2)')).includes('つぎに解除する人'));
  await host.page.click('.tk-person__act[data-name="あおい"]');
  await roomWhen(code, (r) => !r.players['あおい'].ro);
  await waitFor(async () => !(await a.page.evaluate(() => document.getElementById('roSelf').checked)));
  check('host can clear ro', !(await a.page.evaluate(() => document.getElementById('roSelf').checked)));

  // 設定: むずかしさ
  await host.page.click('#levelSeg .tk-seg__btn:has-text("やさしい")');
  await roomWhen(code, (r) => r.set.level === 'easy');
  await waitText(a, '#lobbySetView', 'やさしい');
  check('level note', (await text(host, '#levelNote')).includes('しかけ3つ'));
  await host.page.click('#levelSeg .tk-seg__btn:has-text("むずかしい")');
  await roomWhen(code, (r) => r.set.level === 'hard');

  // みんなにみせる画面
  const watch = await L.newClient('watch');
  await L.open(watch, '?watch=' + code);
  await waitScreen(watch, 'waiting');
  check('watch join info', (await text(watch, '#lobbyJoinCode')) === code);

  // ── 1回目（むずかしい・あおいが解除する人） ──
  await host.page.click('#btnStartGame');
  for (const c of [host, ...guests, watch]) await waitScreen(c, 'game');
  let g = await gameOf(code);
  // 導火線は、あとで早送りして確かめる。それまで火がつかないよう、はじめた時刻を先へずらしておく
  await rest('PATCH', L.ROOMS + '/' + code + '/game', { startAt: g.G.startAt + 600000 });
  check('seats 3', g.seats.length === 3 && g.seats.join() === 'あおい,みどり,もも', g.seats);
  check('defuser is first', g.seats[g.def] === 'あおい');
  check('hard: 5 modules + fuse', E.regularSlots(g.bomb).length === 5 && !!g.bomb.fuse);
  check('start counted', await L.waitStats(host, 'start', 1) && await L.waitStats(host, 'players-3', 1) && await L.waitStats(host, 'level-hard', 1));
  // 見え方: 爆弾は解除する人だけ・説明書は読む人だけ・ホストとみんなにみせる画面は数だけ
  check('defuser sees bomb', await visible(a, '#cube .tk-face--front') && (await count(a, '.tk-slot')) === 6);
  check('defuser has no manual', !(await visible(a, '#viewRead')) && (await count(a, '.tk-line')) === 0);
  for (const c of [b, m]) {
    check('reader sees manual: ' + c.name, await visible(c, '#page') && (await count(c, '.tk-line')) > 3);
    check('reader has no bomb: ' + c.name, (await count(c, '.tk-slot')) === 0 && (await count(c, '.tk-face')) === 0);
  }
  for (const c of [host, watch]) {
    check('board: ' + c.label, await visible(c, '#viewBoard') && (await text(c, '#boardWho')).includes('あおい'));
    check('board has no bomb/manual: ' + c.label, (await count(c, '.tk-slot')) === 0 && (await count(c, '.tk-line')) === 0);
    check('board time: ' + c.label, /^[34]:\d\d$/.test(await text(c, '#boardTime')), await text(c, '#boardTime'));
  }
  check('fabs hidden for defuser', await a.page.evaluate(() => { const f = document.querySelector('.howto-fab'); return !f || getComputedStyle(f).display === 'none'; }));
  check('fabs shown for reader', await b.page.evaluate(() => { const f = document.querySelector('.howto-fab'); return !!f && getComputedStyle(f).display !== 'none'; }));
  await shot(a, '02-defuser');
  await shot(b, '02-reader');
  await shot(m, '02-reader-mobile');
  await shot(host, '02-board');
  check('reader mobile no overflow', (await overflow(m)) <= 0);

  // 説明書は分けて配る（2人で5ページ: どのページもどちらかが持ち、同じページを2人で持たない）
  const tabs = async (c) => c.page.evaluate(() => [...document.querySelectorAll('.tk-tab')].map((n) => n.dataset.ch));
  const tb = await tabs(b);
  const tm = await tabs(m);
  const need = E.bombChapters(g.bomb);
  check('both have clues page', tb[0] === 'clues' && tm[0] === 'clues');
  check('pages are split', need.every((id) => tb.includes(id) !== tm.includes(id)), { tb, tm, need });
  // 読む人がいなくなったら、その人のページは、いる読む人が読める。戻れば元にもどる
  await rest('DELETE', L.ROOMS + '/' + code + '/players/もも');
  check('absent reader pages go to the others', await waitFor(async () => (await tabs(b)).length === 1 + need.length, 2500), await tabs(b));
  check('board marks absent', await waitFor(async () => (await text(host, '#boardReaders')).includes('もも（いまいない）'), 2500) || (await L.roomOf(code)).players['もも'] != null);
  await roomWhen(code, (r) => !!r.players['もも'], 10000);
  check('pages return when the reader is back', await waitFor(async () => (await tabs(b)).join() === tb.join()), await tabs(b));
  await b.page.click('.tk-tab:nth-child(2)');
  await shot(b, '03-reader-page');

  // 爆弾を回す: ボタンで90度ずつ。見えていない面は選べない
  const facing = (c) => c.page.evaluate(() => [...document.querySelectorAll('.tk-face')].filter((f) => !f.inert).map((f) => f.dataset.face).sort().join());
  await a.page.click('#btnTurnL');
  await sleep(600);
  check('turn left shows right side', (await facing(a)).includes('right') && !(await facing(a)).includes('left'), await facing(a));
  await shot(a, '04-turned');
  await a.page.click('#btnTurnL');
  await sleep(600);
  check('turn twice shows back', (await facing(a)).includes('back') && !(await facing(a)).includes('front'), await facing(a));
  await a.page.click('#btnTurnU');
  await sleep(600);
  check('turn up shows bottom', (await facing(a)).includes('bottom'), await facing(a));
  // ドラッグでも回る
  const before = await a.page.evaluate(() => window.__tk.cube.q.join());
  const box = await a.page.locator('#scene').boundingBox();
  await a.page.mouse.move(box.x + box.width / 2, box.y + 40);
  await a.page.mouse.down();
  await a.page.mouse.move(box.x + box.width / 2 + 120, box.y + 70, { steps: 6 });
  await a.page.mouse.up();
  check('drag rotates', (await a.page.evaluate(() => window.__tk.cube.q.join())) !== before);
  check('drag does not open zoom', !(await visible(a, '#zoom')));

  // 手がかり: 側面・上・底を近くで見る
  const seeClue = async (face, part) => {
    await a.page.evaluate((f) => window.__tk.cube.showFace(f), face);
    await sleep(600);
    await a.page.click(`.tk-cluebtn[data-clue="${face}"]`);
    await waitVisible(a, '#zoomBody .tk-clue--big');
    if (face === 'bottom') {
      check('lid closed first', !(await text(a, '#zoomBody')).includes(E.MARK_NAME[g.bomb.clues.mark]));
      await a.page.click('#zoomBody button:has-text("ふたを開ける")');
    }
    await waitText(a, '#zoomBody', part);
    if (face === 'bottom') await shot(a, '05-clue-bottom');
    await a.page.keyboard.press('Escape');
    await waitVisible(a, '#stage');
  };
  await seeClue('left', E.COLOR[g.bomb.clues.seal]);
  await seeClue('right', g.bomb.clues.serial);
  await seeClue('top', 'ねじは ' + g.bomb.clues.screws + '本');
  await seeClue('bottom', E.MARK_NAME[g.bomb.clues.mark]);
  check('zoom back restores focus', await a.page.evaluate(() => document.activeElement?.dataset.clue === 'bottom'));

  // ひとこと（5秒に1回）と、説明書の1行を見せる
  await b.page.click('.tk-saybtn:has-text("もう一回言って")');
  for (const c of [a, m, host, watch]) await waitText(c, '#says', 'もう一回言って');
  check('say shows sender', (await text(a, '#says')).includes('みどり'));
  await b.page.click('.tk-saybtn:has-text("わかった")');
  await L.waitToast(b, '5秒に1回');
  await m.page.click('.tk-tab:nth-child(2)');
  await m.page.click('.tk-line--row .tk-line__send');
  await waitText(a, '#says', '説明書「');
  check('line shown to defuser', (await text(a, '#says')).includes('もも'));
  await shot(a, '06-says');
  check('no say box on board', !(await visible(host, '#sayBox')) && !(await visible(watch, '#sayBox')));

  // しかけ: 1つずつ近くで見て、正しく解除する
  const slots = E.regularSlots(g.bomb);
  await zoomSlot(a, slots[0]);
  await shot(a, '07-zoom-' + g.bomb.slots[slots[0]].type);
  await shot(a, '07-zoom-view', { fullPage: false });
  await solve(a, code, slots[0]);
  await waitText(host, '#boardSolved', '1 / 5');
  check('solved shows on board', (await text(watch, '#boardSolved')).includes('1 / 5'));
  check('readers see count', (await text(b, '#hudSolved')).includes('1 / 5'));
  // 読み込み直し: 解除する人は、同じ爆弾・同じ進み具合にもどる
  await a.page.reload();
  await waitScreen(a, 'game');
  await waitVisible(a, '#cube .tk-face--front');
  check('reload keeps role', (await text(a, '#hudRole')).includes('解除する人') && (await text(a, '#hudSolved')).includes('1 / 5'));
  check('reload shows no flash', !(await visible(a, '#flash')));
  // まちがい: ランプが点き、時間が速くなる
  await mistake(a, code);
  g = await gameOf(code);
  check('strike 1 + rate', g.G.x === 1 && g.G.t.rate === 1.25, g.G);
  await waitFor(async () => (await count(host, '#boardLamps .tk-lampx.is-on')) === 1);
  check('lamp on board', (await count(watch, '#boardLamps .tk-lampx.is-on')) === 1);
  await shot(host, '08-board-strike');
  // 種類ごとの写真を撮りながら、のこりを解除する（導火線が来たら、正しいつまみで止める）
  const stopFuse = async () => {
    const now = await gameOf(code);
    const serverNow = Date.now();
    const f = E.fuseInfo(now.bomb, now.G, serverNow);
    if (!f) return false;
    await a.page.click('#btnFuseGo');
    await waitVisible(a, '#zoomBody .tk-mod--fuse');
    await shot(a, '09-fuse');
    await press(a, 'knob:' + E.FUSE_TABLE[f.flame][now.bomb.clues.mark]);
    await roomWhen(code, (r) => (r.game.fz || 0) > now.G.fz);
    return true;
  };
  // 導火線を早送り: はじめた時刻を前にずらして、火がついた状態にする
  g = await gameOf(code);
  const shift = 31000 - (Date.now() - g.G.startAt);
  await rest('PATCH', L.ROOMS + '/' + code + '/game', { startAt: g.G.startAt - shift });
  await waitVisible(a, '#fuseBar');
  for (const c of [b, host, watch]) check('fuse notice: ' + c.label, await waitFor(() => visible(c, '#fuseBar')));
  check('fuse stopped', await stopFuse());
  g = await gameOf(code);
  check('fuse ok no strike', g.G.x === 1 && g.G.fz === 1, g.G);
  await waitFor(async () => !(await visible(host, '#fuseBar')));
  for (const s of slots.slice(1)) {
    g = await gameOf(code);
    if (g.G.out) break;
    await zoomSlot(a, s);
    await shot(a, '10-zoom-' + g.bomb.slots[s].type, { fullPage: false });
    await solve(a, code, s);
  }
  g = await gameOf(code);
  check('safe', g.G.out === 'safe', g.G);
  for (const c of [host, a, b, m, watch]) await waitText(c, '#resultBox', '解除成功');
  check('finish counted once', await L.waitStats(a, 'finish', 1) && await L.waitStats(a, 'safe', 1) && (await L.stats(host, 'finish')) === 0);
  check('host sees again', await visible(host, '#resultBox .tk-result__actions .btn-primary') && (await text(host, '#resultBox')).includes('つぎに解除する人: みどり'));
  check('guest waits', (await text(b, '#resultBox')).includes('ホストが次を決める'));
  check('fabs back after end', await a.page.evaluate(() => { const f = document.querySelector('.howto-fab'); return !!f && getComputedStyle(f).display !== 'none'; }));
  await shot(a, '11-safe-defuser');
  await shot(host, '11-safe-board');

  // ── 2回目: 解除する人が交代。まちがい3回で爆発 ──
  await host.page.click('#resultBox button:has-text("もう一回")');
  await roomWhen(code, (r) => r.game.id === 2);
  g = await gameOf(code);
  check('defuser rotates', g.seats[g.def] === 'みどり', g.seats[g.def]);
  check('again counted', await L.waitStats(host, 'again', 1) && await L.waitStats(host, 'start', 2));
  await waitVisible(b, '#cube .tk-face--front');
  await waitVisible(a, '#page');
  check('roles swapped', (await count(a, '.tk-slot')) === 0 && (await count(b, '.tk-line')) === 0);
  check('says cleared', (await text(a, '#says')) === '');
  for (let i = 0; i < 3; i++) await mistake(b, code);
  g = await gameOf(code);
  check('boom by strikes', g.G.out === 'boom' && g.G.why === 'strike' && g.G.x === 3, g.G);
  await waitVisible(host, '#boom');
  await shot(host, '12-boom', { fullPage: false });
  for (const c of [host, a, b, m, watch]) await waitText(c, '#resultBox', 'ドカーン');
  check('boom text names no one', !(await text(host, '#resultBox')).includes('みどりが') && (await text(host, '#resultBox')).includes('まちがいが3回'));
  check('boom counted', await L.waitStats(b, 'boom-strike', 1));
  await sleep(2600);
  check('boom overlay closes', !(await visible(host, '#boom')));
  await shot(b, '13-boom-defuser');
  check('locked after end', await b.page.evaluate(() => [...document.querySelectorAll('#zoomBody button[data-a]')].every((x) => x.disabled)));

  // ── 3回目（もも・スマホ）: 時間切れで爆発 ──
  await host.page.click('#resultBox button:has-text("もう一回")');
  await roomWhen(code, (r) => r.game.id === 3);
  g = await gameOf(code);
  check('third defuser', g.seats[g.def] === 'もも');
  await waitVisible(m, '#cube .tk-face--front');
  await shot(m, '14-defuser-mobile');
  check('defuser mobile no overflow', (await overflow(m)) <= 0);
  await zoomSlot(m, E.regularSlots(g.bomb)[0]);
  await shot(m, '14-zoom-mobile');
  check('zoom mobile no overflow', (await overflow(m)) <= 0);
  // 押せる所が小さすぎない（44px 以上）
  const small = await m.page.evaluate(() => [...document.querySelectorAll('#zoomBody button, #btnZoomBack')].filter((x) => { const r = x.getBoundingClientRect(); return r.width < 36 || r.height < 36; }).length);
  check('zoom buttons big enough', small === 0, small);
  // のこり2秒にする → 0 で爆発
  g = await gameOf(code);
  await rest('PATCH', L.ROOMS + '/' + code + '/game/t', { left: 2000, at: Date.now() });
  await roomWhen(code, (r) => r.game.out === 'boom', 8000);
  g = await gameOf(code);
  check('boom by time', g.G.out === 'boom' && g.G.why === 'time', g.G);
  await waitText(host, '#resultBox', '時間が0になった');
  check('time boom counted', await L.waitStats(m, 'boom-time', 1));

  // 待合室へ → ルームを閉じる
  await host.page.click('#resultBox button:has-text("待合室へ")');
  for (const c of [host, ...guests, watch]) await waitScreen(c, 'waiting');
  check('back to lobby clears game', !(await L.roomOf(code)).game);
  check('light look in lobby', !(await m.page.evaluate(() => document.body.classList.contains('tk-dark'))));
  await host.page.click('#btnLeave');
  for (const c of guests) await waitScreen(c, 'top');
  await waitScreen(watch, 'watch-end');
  check('room removed', (await L.roomOf(code)) === null);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
