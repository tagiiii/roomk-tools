// のりあいロード E2E その3: ゴールのとびらから出る（ボタンの文言・下の矢印キー・ホストの画面にも出る・すぐ入りなおさない）
const L = require('./lib.cjs');
const { check, sleep, st } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  try {
    const host = await L.newClient('host');
    const guest = await L.newClient('guest');
    await L.open(host);
    await L.open(guest);
    const code = await L.createRoom(host, 'ホスト');
    await L.joinRoom(guest, 'ゲスト', code);
    await L.waitScreen(guest, 'waiting');
    await host.page.click('#lobbySet .nr-seg__btn:nth-child(2)'); // カギのいらないとびら
    await L.roomWhen(code, (r) => r.set.stage === 1);
    await host.page.waitForFunction(() => !document.querySelector('#btnStartGame').disabled);
    await host.page.click('#btnStartGame');
    await L.waitScreen(guest, 'game');
    await sleep(800);
    check('はじめは「投げる」', (await L.text(guest, '.nr-pad[data-key="a"]')) === '投げる');

    // 参加者をとびらに入れる
    await st(guest, (s) => { const me = s.world.players[1]; const d = s.world.door; me.x = d.x + 0.2; me.y = 10 - 0.9; me.vy = 0; me.ground = null; return 1; });
    await L.until(async () => await st(host, (s) => s.world.players[1].entered), 5000);
    check('とびらに入った（ホストの画面でも）', true);
    check('入っている間は「出る」（読み上げは「とびらから出る」）', (await L.text(guest, '.nr-pad[data-key="a"]')) === '出る' && (await guest.page.getAttribute('.nr-pad[data-key="a"]', 'aria-label')) === 'とびらから出る');
    check('キーの案内も出かたを言う', (await L.text(guest, '#keyHint')).includes('とびらから出られる'), await L.text(guest, '#keyHint'));
    await L.shot(guest, 'exit-01-inside');

    // 下の矢印キーで出る
    await guest.page.bringToFront();
    await guest.page.keyboard.press('ArrowDown');
    await sleep(1200);
    const me = await st(guest, (s) => { const p = s.world.players[1]; return { entered: p.entered, x: p.x, door: s.world.door.x, ground: p.ground }; });
    check('下の矢印キーで出て、出たまま', !me.entered && me.x + 0.75 <= me.door && !!me.ground, me);
    check('ホストの画面でも出ている', !(await st(host, (s) => s.world.players[1].entered)));
    check('出たら「投げる」に戻る', (await L.text(guest, '.nr-pad[data-key="a"]')) === '投げる' && (await guest.page.getAttribute('.nr-pad[data-key="a"]', 'aria-label')) === null);
    check('クリアにならない', !(await L.visible(host, '#clearBox')));

    // 画面の「とびらから出る」ボタンでも出られる
    await st(guest, (s) => { const me = s.world.players[1]; const d = s.world.door; me.x = d.x + 0.2; me.y = 10 - 0.9; me.vy = 0; me.ground = null; return 1; });
    await guest.page.waitForFunction(() => document.querySelector('.nr-pad[data-key="a"]').textContent === '出る');
    const pad = await guest.page.$('.nr-pad[data-key="a"]');
    const b = await pad.boundingBox();
    await guest.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await guest.page.mouse.down();
    await sleep(120);
    await guest.page.mouse.up();
    await sleep(800);
    check('「出る」のボタンでも出られる', !(await st(guest, (s) => s.world.players[1].entered)));
    await L.shot(guest, 'exit-02-out');
  } catch (e) {
    check('例外なし', false, e && e.stack || e);
  } finally {
    L.finish();
    await L.browser.close();
    server.close();
  }
})();
