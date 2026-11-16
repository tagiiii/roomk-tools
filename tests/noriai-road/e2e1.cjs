// のりあいロード E2E その1: 作成・参加・待合室・はじめる・同期（歩く・頭に乗る・箱・投げる）・ひとこと・クリア・
// 次のステージ・読み込み直し（参加者・ホスト）・退出・待合室へ・ルームを閉じる・スマホ幅・1台のパソコン・通信量
const L = require('./lib.cjs');
const { check, sleep, until, st } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const host = await L.newClient('host');
    const guest = await L.newClient('guest');
    await L.open(host);
    await L.open(guest);

    // ── 作成・参加 ──
    const code = await L.createRoom(host, 'ホスト');
    check('ルームコードは6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
    let room = await L.roomOf(code);
    check('はじめは待合室・ホストも遊ぶ', room.status === 'waiting' && room.set.hostPlays === true && room.set.stage === 0, room.set);
    check('はじめるは2人そろうまで押せない', await host.page.isDisabled('#btnStartGame'));
    await L.joinRoom(guest, 'ゲスト', code.toLowerCase());
    await L.waitScreen(guest, 'waiting');
    await host.page.waitForFunction(() => document.querySelectorAll('#lobbyPeople li').length === 2);
    check('待合室に番号つきで2人', (await L.text(host, '#lobbyPeople')).includes('1ホスト') && (await L.text(host, '#lobbyPeople')).includes('2ゲスト'), await L.text(host, '#lobbyPeople'));
    check('参加者は待つ表示', await L.visible(guest, '#lobbyWait') && !(await L.visible(guest, '#btnStartGame')));
    // ステージを選ぶ
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(2)');
    room = await L.roomWhen(code, (r) => r.set.stage === 1);
    check('ステージを選ぶとルームに書く', room.set.stage === 1);
    await guest.page.waitForFunction(() => document.querySelector('#lobbySetNote').textContent.includes('2. 重い箱と動く床'));
    check('参加者にも選んだステージが出る', true);
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(1)');
    await L.roomWhen(code, (r) => r.set.stage === 0);
    await L.shot(host, '01-waiting');

    // ── はじめる ──
    await host.page.click('#btnStartGame');
    await L.waitScreen(host, 'game');
    await L.waitScreen(guest, 'game');
    room = await L.roomWhen(code, (r) => r.status === 'play' && r.game && r.live && r.live[r.game.id] && r.live[r.game.id].p && r.live[r.game.id].p[1] && r.live[r.game.id].p[2] && r.live[r.game.id].w);
    const gid = room.game.id;
    check('ステージの決まり（2人・ステージ1）', room.game.n === 2 && room.game.stage === 0 && room.game.seats.join() === 'ホスト,ゲスト', room.game);
    check('止まっていても、はじめの位置は1回書く', !!room.live[gid].p[1] && !!room.live[gid].p[2], room.live[gid].p);
    check('ホストはワールドを書く', !!room.live[gid].w, room.live[gid]);
    check('自分の番号が出る', (await L.text(guest, '#youLine')) === 'あなたは2番' && (await L.text(host, '#youLine')) === 'あなたは1番');
    check('はじめのステージは説明が開いている', await L.visible(guest, '#hintText'));
    check('start・players-2・stage-1 を数える', (await L.stats(host, 'start')) === 1 && (await L.stats(host, 'players-2')) === 1 && (await L.stats(host, 'stage-1')) === 1);

    // ── 歩く: 参加者が右へ。ホストの画面でも動く ──
    const gx0 = await st(host, (s) => s.world.players[1].x);
    await guest.page.bringToFront();
    await guest.page.keyboard.down('ArrowRight');
    await sleep(500);
    await guest.page.keyboard.up('ArrowRight');
    await sleep(500);
    const gMine = await st(guest, (s) => s.world.players[1].x);
    const gOnHost = await st(host, (s) => s.world.players[1].x);
    check('参加者が歩いた', gMine > gx0 + 2, [gx0, gMine]);
    check('ホストの画面でも同じ所に来た', Math.abs(gMine - gOnHost) < 0.05, [gMine, gOnHost]);
    room = await L.roomOf(code);
    check('ルームの位置も同じ（1つの文字列で書く）', typeof room.live[gid].p[2] === 'string' && Math.abs(Number(room.live[gid].p[2].split(',')[0]) - gMine) < 0.02, room.live[gid].p[2]);

    // 止まっている間は書かない
    let before = guest.wsSent || 0;
    await sleep(1000);
    check('止まっている間は送らない（1秒で 300 バイト未満）', (guest.wsSent || 0) - before < 300, (guest.wsSent || 0) - before);

    // ── 頭に乗る: 参加者をホストの頭に乗せ、ホストが歩くと運ばれる ──
    await st(host, (s) => { const p = s.world.players[0]; p.x = 5; p.y = 9.1; p.vy = 0; p.ground = null; return 1; });
    await sleep(600);
    await st(guest, (s) => { const w = s.world; const me = w.players[1]; me.x = w.players[0].x + 0.1; me.y = w.players[0].y - 0.95; me.vy = 0; me.ground = null; return 1; });
    await sleep(600);
    check('参加者が頭に乗った', (await st(guest, (s) => s.world.players[1].ground)) === 's1');
    await host.page.bringToFront();
    await host.page.keyboard.down('ArrowRight');
    await sleep(500);
    await host.page.keyboard.up('ArrowRight');
    await sleep(700);
    const hx = await st(host, (s) => s.world.players[0].x);
    const gOnGuest = await st(guest, (s) => [s.world.players[1].x, s.world.players[1].ground, s.world.players[0].x]);
    const gOnHost2 = await st(host, (s) => [s.world.players[1].x, s.world.players[1].ground]);
    check('ホストが歩いた', hx > 7, hx);
    check('参加者は乗ったまま運ばれた（参加者の画面）', gOnGuest[1] === 's1' && Math.abs(gOnGuest[0] - gOnGuest[2] - 0.1) < 0.15, gOnGuest);
    check('ホストの画面でも乗ったまま', gOnHost2[1] === 's1' && Math.abs(gOnHost2[0] - hx - 0.1) < 0.15, [gOnHost2, hx]);

    // ── ひとこと ──
    await guest.page.click('#btnSay');
    await guest.page.click('#sayPanel button:nth-child(3)');
    await until(() => st(host, (s) => s.says[2] && s.says[2].text));
    check('ひとことがホストに届く', (await st(host, (s) => s.says[2] && s.says[2].text)) === '乗って');
    await guest.page.click('#btnSay');
    await guest.page.click('#sayPanel button:nth-child(1)');
    await sleep(500);
    check('5秒たたないと送れない', (await st(host, (s) => s.says[2].text)) === '乗って' && (await L.stats(guest, 'say')) === 1);

    // ── クリア ──
    await st(host, (s) => { s.world.door.locked = false; const p = s.world.players[0]; p.x = s.world.door.x; p.y = 9.1; p.ground = null; return 1; });
    await sleep(400);
    check('1人だけ入っても、クリアにならない', !(await L.visible(host, '#clearBox')));
    await st(guest, (s) => { const p = s.world.players[1]; p.x = s.world.door.x; p.y = 9.1; p.ground = null; return 1; });
    await L.waitVisible(host, '#clearBox');
    await L.waitVisible(guest, '#clearBox');
    check('ホストに次のステージへ', await L.visible(host, '#btnNext'));
    check('参加者は待つ表示', await L.visible(guest, '#clearWait') && !(await L.visible(guest, '#btnNext')));
    await until(async () => (await L.stats(host, 'finish')) === 1);
    check('finish は1回', (await L.stats(host, 'finish')) === 1);
    await L.shot(guest, '02-clear');
    await host.page.click('#btnNext');
    room = await L.roomWhen(code, (r) => r.game.id === gid + 1);
    check('次のステージ（ステージ2）', room.game.stage === 1 && room.set.stage === 1, room.game);
    check('前のステージの live は消える', !room.live || !room.live[gid], Object.keys(room.live || {}));
    await guest.page.waitForFunction(() => document.querySelector('#stageName').textContent.startsWith('2.'));
    check('クリアの表示が消える', !(await L.visible(guest, '#clearBox')));

    // ── 箱: 2人で押すと動く（ステージ2の箱は「みんな」） ──
    await sleep(800);
    const box0 = await st(host, (s) => s.world.boxes[0].x);
    await st(host, (s) => { const b = s.world.boxes[0]; const p = s.world.players[0]; p.x = b.x - 0.75; p.y = 9.1; p.ground = null; return 1; });
    await st(guest, (s) => { const b = s.world.boxes[0]; const p = s.world.players[1]; p.x = b.x - 0.75; p.y = 9.1; p.ground = null; return 1; });
    await sleep(700);
    await host.page.keyboard.down('ArrowRight');
    await sleep(800);
    check('1人では動かない', Math.abs((await st(host, (s) => s.world.boxes[0].x)) - box0) < 0.05);
    await guest.page.keyboard.down('ArrowRight');
    await sleep(1500);
    await host.page.keyboard.up('ArrowRight');
    await guest.page.keyboard.up('ArrowRight');
    await sleep(600);
    const box1 = await st(host, (s) => s.world.boxes[0].x);
    const box1g = await st(guest, (s) => s.world.boxes[0].x);
    check('2人で押すと動く', box1 > box0 + 1.5, [box0, box1]);
    check('参加者の画面の箱も同じ所', Math.abs(box1 - box1g) < 0.05, [box1, box1g]);

    // ── ホストの読み込み直し: ワールドの続きから ──
    await host.page.reload();
    await host.page.waitForFunction(() => window.__noriaiTest && window.__noriaiTest.state.world);
    await sleep(800);
    const box2 = await st(host, (s) => s.world.boxes[0].x);
    check('ホストが読み込み直しても、箱は押した所', Math.abs(box2 - box1) < 0.05, [box1, box2]);
    check('ホストは1番のまま', (await L.text(host, '#youLine')) === 'あなたは1番');

    // ── 参加者の読み込み直し: 自分の位置から ──
    const gpos = await st(guest, (s) => s.world.players[1].x);
    await guest.page.reload();
    await guest.page.waitForFunction(() => window.__noriaiTest && window.__noriaiTest.state.world);
    await sleep(800);
    check('参加者が読み込み直しても、同じ番号・同じ所', (await L.text(guest, '#youLine')) === 'あなたは2番' && Math.abs((await st(guest, (s) => s.world.players[1].x)) - gpos) < 0.3, [gpos, await st(guest, (s) => s.world.players[1].x)]);

    // ── 投げる: 参加者がボールを持っていて、下を押すと、ホストが投げる（ステージ3） ──
    await host.page.evaluate(() => { document.getElementById('hostMenu').open = true; });
    await host.page.click('#btnSkip');
    room = await L.roomWhen(code, (r) => r.game.stage === 2);
    await guest.page.waitForFunction(() => document.querySelector('#stageName').textContent.startsWith('3.'));
    await sleep(800);
    await st(host, (s) => { const b = s.world.items[0]; b.holder = 2; return 1; });
    await until(() => st(guest, (s) => s.world.items[0].holder === 2));
    check('参加者の画面でも、ボールを持っている', (await st(guest, (s) => s.world.items[0].holder)) === 2);
    await guest.page.bringToFront();
    await guest.page.keyboard.press('ArrowDown');
    await until(() => st(host, (s) => s.world.items[0].holder === 0));
    check('下を押すと、ホストの画面でボールが投げられる', (await st(host, (s) => s.world.items[0].holder)) === 0);
    room = await L.roomOf(code);
    check('投げた印はホストが消す', !room.live[room.game.id].ev, room.live[room.game.id].ev);

    // ── 待合室へ・3人目は待合室で入って次から ──
    await host.page.evaluate(() => { document.getElementById('hostMenu').open = true; });
    await host.page.click('#btnLobby');
    await L.waitScreen(guest, 'waiting');
    room = await L.roomOf(code);
    check('待合室へ: game と live は消える', room.status === 'waiting' && !room.game && !room.live);

    // ── スマホ幅・ステージの画面 ──
    const phone = await L.newClient('phone', { viewport: { width: 375, height: 760 }, mobile: true });
    await L.open(phone);
    await L.joinRoom(phone, 'スマホ', code);
    await L.waitScreen(phone, 'waiting');
    await host.page.click('#btnStartGame');
    await L.waitScreen(phone, 'game');
    await sleep(800);
    check('3人ではじまる', (await L.roomOf(code)).game.n === 3);
    check('スマホ幅で横にはみ出さない', (await L.overflow(phone)) <= 0, await L.overflow(phone));
    check('スマホに画面のボタン', await L.visible(phone, '.nr-pad--jump'));
    // 画面のボタンで動く
    const px0 = await st(phone, (s) => s.world.players[2].x);
    const pad = await phone.page.$('.nr-pad[data-key="r"]');
    const box = await pad.boundingBox();
    await phone.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await phone.page.mouse.down();
    await sleep(400);
    await phone.page.mouse.up();
    await sleep(300);
    check('画面の右のボタンで歩く', (await st(phone, (s) => s.world.players[2].x)) > px0 + 1, [px0, await st(phone, (s) => s.world.players[2].x)]);
    await L.shot(phone, '03-phone-game');

    // ── 通信量: 3人が動いている5秒 ──
    for (const c of [host, guest, phone]) { c.wsSent = 0; c.wsRecv = 0; }
    await Promise.all([host.page.keyboard.down('ArrowRight'), guest.page.keyboard.down('ArrowRight')]);
    await sleep(5000);
    await Promise.all([host.page.keyboard.up('ArrowRight'), guest.page.keyboard.up('ArrowRight')]);
    const usage = [host, guest, phone].map((c) => ({ who: c.label, sentPerSec: Math.round((c.wsSent || 0) / 5), recvPerSec: Math.round((c.wsRecv || 0) / 5) }));
    console.log('  通信量（3人・2人が歩いている5秒の平均。バイト/秒）', JSON.stringify(usage));
    check('受ける量は1台 1秒に 6KB 未満', usage.every((u) => u.recvPerSec < 6000), usage);

    // ── 参加者の退出: 一覧に「通信が切れた」・クリアの数に入れない ──
    await guest.page.click('#btnLeave');
    await L.waitScreen(guest, 'top');
    await host.page.waitForFunction(() => document.querySelector('#roster').textContent.includes('通信が切れた'));
    check('退出した人は「通信が切れた」', true);
    await st(host, (s) => { s.world.door.locked = false; s.world.items.forEach((it) => { it.gone = it.kind === 'key' ? true : it.gone; }); const p = s.world.players[0]; p.x = s.world.door.x; p.y = 9.1; p.ground = null; return 1; });
    await st(phone, (s) => { const p = s.world.players[2]; p.x = s.world.door.x; p.y = 9.1; p.ground = null; return 1; });
    await L.waitVisible(host, '#clearBox', 10000);
    check('いなくなった人をのぞいて、みんな入ればクリア', true);

    // ── ルームを閉じる ──
    await host.page.click('#btnLeave');
    await L.waitScreen(phone, 'top');
    check('ルームを閉じると消える', (await L.roomOf(code)) === null);

    // ── 1台のパソコンで遊ぶ ──
    const solo = await L.newClient('solo');
    await L.open(solo);
    await solo.page.click('#btnGoLocal');
    await L.waitScreen(solo, 'local');
    await solo.page.click('#localCountSeg .nr-seg__btn:nth-child(2)');
    await solo.page.click('#btnLocalStart');
    await L.waitScreen(solo, 'game');
    await sleep(300);
    check('1台: 3人', (await st(solo, (s) => s.world.n)) === 3);
    check('1台: ルームのバーは出ない', !(await L.visible(solo, '#roomBar')));
    const s2 = await st(solo, (s) => s.world.players[1].x);
    await solo.page.keyboard.down('KeyD');
    await sleep(400);
    await solo.page.keyboard.up('KeyD');
    check('1台: D で2番が歩く', (await st(solo, (s) => s.world.players[1].x)) > s2 + 1);
    check('1台: Firebase に書かない', (solo.wsSent || 0) < 2000, solo.wsSent);
    await solo.page.click('#btnLocalTop');
    await L.waitScreen(solo, 'top');
    check('音を鳴らす部品を作らない', (await Promise.all(L.clients.map((c) => c.page.evaluate(() => window.__audioMade).catch(() => 0)))).every((n) => !n));
  } catch (e) {
    check('例外なし', false, String(e && e.stack || e));
  } finally {
    L.finish();
    await L.browser.close();
    server.close();
  }
})();
