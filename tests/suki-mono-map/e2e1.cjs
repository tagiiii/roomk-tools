// 好きなものマップ E2E その1: ホスト・参加者2人（1人は375px）・端末なしの参加者1人・途中参加1人で、
// 待合室 → 作る（＋のポップアップ・× で消す）→ 見せあう → もう一度作る → 待合室 → 退出・ルームを閉じる まで通す
const L = require('./lib.cjs');
const { check, sleep, roomOf } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
// マップの点（押せるもの）を、読み上げ用の名前で押す
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const popOpen = (c) => c.page.evaluate(() => document.querySelector('#p-pop').open);
const leaves = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--leaf .mp-leaf__text`)].map((n) => n.textContent), box);
const genres = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--genre .mp-genre__text`)].map((n) => n.textContent), box);
const pickGenre = (c, label) => c.page.locator('#p-genres .sm-genre', { hasText: label }).first().click();
const pickItem = (c, label) => c.page.locator('#p-items .sm-item', { hasText: label }).first().click();
// ルームに届くまで待つ（選んだものは少しまとめて送る）
async function waitRoom(code, test, timeout = 5000) {
  const until = Date.now() + timeout;
  let room = null;
  while (Date.now() < until) { room = await roomOf(code); if (room && test(room)) return room; await sleep(100); }
  return room;
}

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const mio = await L.newClient('mio', { viewport: { width: 375, height: 812 } });
  const late = await L.newClient('late');

  // はじめの画面
  await L.open(host);
  check('top: entry visible', await L.visible(host, '#screen-top .app-entry'));
  check('top: title', (await host.page.title()) === '好きなものマップ | あそびのたな');
  await L.shot(host, '01-top');

  // 作成・参加
  const code = await L.createRoom(host, 'ホスト');
  const r0 = await roomOf(code);
  check('create: room waiting', r0?.status === 'waiting');
  check('create: defaults', r0.settings.hostPlays === true && r0.settings.maxGenres === 3, r0.settings);
  check('stats: room-create', await L.waitStats(host, 'room-create', 1));
  check('lobby: host alone can start (host makes a map)', !(await host.page.evaluate(() => document.querySelector('#btnStart').disabled)));
  await L.joinRoom(yu, 'ゆう', code);
  await L.joinRoom(mio, 'みお', code);
  await L.waitText(host, '#lobbyPlayers', 'みお');
  check('link: ?room removed after join', !(await yu.page.evaluate(() => location.search.includes('room'))));
  check('lobby: guest sees summary only', (await L.visible(yu, '#lobbyInfo')) && !(await L.visible(yu, '#lobbyHost')));

  // 端末なしの参加者を足す（印はホストの画面にだけ）
  await host.page.fill('#proxyName', 'じろう');
  await host.page.click('#btnAddProxy');
  await L.waitText(host, '#lobbyPlayers', 'じろう');
  await L.waitText(yu, '#lobbyPlayers', 'じろう');
  check('proxy: tag on host only', (await L.text(host, '#lobbyPlayers')).includes('端末なし') && !(await L.text(yu, '#lobbyPlayers')).includes('端末なし'));
  await host.page.fill('#proxyName', 'ゆう');
  await host.page.click('#btnAddProxy');
  await L.waitText(host, '#proxyError', '使われている');
  check('proxy: same name as a player is refused', !(await roomOf(code)).proxies['ゆう']);
  // 端末なしの参加者と同じ名前では入れない
  await L.open(late, '?room=' + code);
  await late.page.fill('#guestName', 'じろう');
  await late.page.click('#btnJoinRoom');
  await L.waitText(late, '#joinError', '使われている');
  check('join: proxy name refused', !(await roomOf(code)).players['じろう']);

  // 選べるジャンルの数を5つまでに
  await L.seg(host, 'max-opts', '5つまで');
  await L.waitText(yu, '#lobbyRule', '5つまで');
  check('lobby: maxGenres 5', (await roomOf(code)).settings.maxGenres === 5);
  await L.shot(host, '02-lobby-host');
  check('lobby 375: no overflow', (await L.overflow(mio)) <= 0);

  // はじめる
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-pick');
  const r1 = await roomOf(code);
  check('start: status pick, round 1', r1.status === 'pick' && r1.round === 1, [r1.status, r1.round]);
  check('stats: start', await L.waitStats(host, 'start', 1));
  check('stats: players-4 (host + 2 guests + 1 proxy)', await L.waitStats(host, 'players-4', 1));

  // ゆう: マップだけの画面。「＋」でポップアップ
  check('pick: only one filled button', (await yu.page.evaluate(() => [...document.querySelectorAll('#screen-pick .btn-primary')].filter((b) => b.getClientRects().length).length)) === 1);
  check('pick: done disabled before choosing', await yu.page.evaluate(() => document.querySelector('#p-done').disabled));
  check('pick: popup closed at first', !(await popOpen(yu)));
  await L.shot(yu, '03-pick-empty');
  await node(yu, '好きなジャンルを足す').click();
  check('pop: opens from the plus', await popOpen(yu));
  check('pop: genre list', (await yu.page.locator('#p-genres .sm-genre').count()) === 12);
  await pickGenre(yu, '動物');
  await L.waitText(yu, '#p-panel-title', '好きな動物は？');
  await pickItem(yu, '犬');
  await pickItem(yu, '猫');
  await pickItem(yu, 'ペンギン');
  await L.shot(yu, '04-pop-items');
  // 自分で書く
  await yu.page.locator('#p-items .sm-item--add').click();
  await yu.page.fill('#p-free-input', 'カピバラ');
  await yu.page.press('#p-free-input', 'Enter');
  await yu.page.waitForFunction(() => [...document.querySelectorAll('#p-items .sm-item')].some((b) => b.textContent.includes('カピバラ')));
  await yu.page.click('#p-pop-close');
  check('pop: closes with the button', !(await popOpen(yu)));
  check('map: leaves', JSON.stringify(await leaves(yu)) === JSON.stringify(['犬', '猫', 'ペンギン', 'カピバラ']), await leaves(yu));
  // × で消す
  await node(yu, '猫を消す').click();
  check('map: leaf removed by tapping', !(await leaves(yu)).includes('猫'), await leaves(yu));
  const r2 = await waitRoom(code, (r) => { const a = arr(r.maps?.['ゆう']?.items?.animal); return a.includes('カピバラ') && !a.includes('猫'); });
  check('db: own map written', JSON.stringify(arr(r2.maps['ゆう'].items.animal)) === JSON.stringify(['犬', 'ペンギン', 'カピバラ']) && r2.maps['ゆう'].r === 1, r2.maps);
  // ジャンルの丸い「＋」で足す
  await node(yu, '動物に足す').click();
  check('pop: opens from the genre plus', (await popOpen(yu)) && (await L.text(yu, '#p-panel-title')) === '好きな動物は？');
  await pickItem(yu, 'うさぎ');
  await yu.page.keyboard.press('Escape');
  await sleep(200);
  check('pop: closes with Esc', !(await popOpen(yu)));
  // もう1つジャンルを足して、消す（中身があるので確かめが出る）
  await node(yu, 'ジャンルを足す').click();
  await pickGenre(yu, 'ゲーム');
  await pickItem(yu, '育成');
  await pickItem(yu, 'FPS');
  await yu.page.click('#p-pop-close');
  check('map: two genres', JSON.stringify(await genres(yu)) === JSON.stringify(['動物', 'ゲーム']), await genres(yu));
  await L.shot(yu, '05-map-two');
  await node(yu, 'ゲームの中身を選ぶ').click();
  await yu.page.click('#p-del');
  await L.waitText(yu, '#p-del-q', '選んだ2こを消す？');
  await yu.page.click('#p-del-no');
  check('del: cancel keeps genre', (await popOpen(yu)) && (await L.visible(yu, '#p-del')));
  await yu.page.click('#p-del');
  await yu.page.click('#p-del-yes');
  await sleep(200);
  check('del: genre removed and popup closed', !(await popOpen(yu)) && JSON.stringify(await genres(yu)) === JSON.stringify(['動物']), await genres(yu));
  await node(yu, 'ジャンルを足す').click();
  await pickGenre(yu, 'ゲーム');
  await pickItem(yu, 'パズル');
  await yu.page.click('#p-pop-close');

  // みお（375px）: 上限の5つまで足すと「＋ ジャンルを足す」が消える
  for (const [i, g] of ['食べもの', 'おやつ', '音楽', '乗りもの', 'おでかけ'].entries()) {
    await node(mio, i === 0 ? '好きなジャンルを足す' : 'ジャンルを足す').click();
    await pickGenre(mio, g);
    if (i === 0) {
      for (const t of ['ラーメン', 'お寿司', 'カレー', 'ハンバーグ']) await pickItem(mio, t);
      // いちばん長い「自分で書く」（12文字）も、はみ出さずに入る
      await mio.page.locator('#p-items .sm-item--add').click();
      await mio.page.fill('#p-free-input', 'あいうえおかきくけこさし');
      await mio.page.press('#p-free-input', 'Enter');
      await mio.page.waitForFunction(() => [...document.querySelectorAll('#p-items .sm-item')].some((b) => b.textContent.includes('あいうえおかきくけこさし')));
      await L.shot(mio, '06-pop-375', false);
    }
    await mio.page.click('#p-pop-close');
  }
  check('max: add node hidden at the limit', (await mio.page.locator('#p-map g.mp-node--add').count()) === 0);
  check('pick 375: no overflow', (await L.overflow(mio)) <= 0);
  // スマホの幅では、上から下へ枝をのばす形で、文字が実寸（16px以上）で出る
  const phone = await mio.page.evaluate(() => {
    const svg = document.querySelector('#p-map svg');
    const box = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const rects = [...svg.querySelectorAll('.mp-node')].map((n) => n.getBoundingClientRect());
    const leaf = svg.querySelector('.mp-leaf__text');
    const plus = svg.querySelector('.mp-node--plus').getBoundingClientRect();
    return {
      tree: svg.classList.contains('mp--tree'),
      scale: box.width / vb.width,
      leafPx: parseFloat(getComputedStyle(leaf).fontSize) * (box.width / vb.width),
      genrePx: parseFloat(getComputedStyle(svg.querySelector('.mp-genre__text')).fontSize) * (box.width / vb.width),
      inside: rects.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1 && r.bottom <= box.bottom + 1),
      plusSize: Math.min(plus.width, plus.height),
    };
  });
  check('phone: top-down layout', phone.tree, phone);
  check('phone: text at real size', phone.leafPx >= 15.5 && phone.genrePx >= 17.5 && Math.abs(phone.scale - 1) < 0.03, phone);
  check('phone: every node inside the map', phone.inside, phone);
  check('phone: plus is easy to tap', phone.plusSize >= 38, phone);
  check('pc: radial layout stays', await yu.page.evaluate(() => { const v = document.querySelector('#p-map svg, #p-sent-map svg'); return !!v && v.classList.contains('mp--radial'); }));
  await L.shot(mio, '07-map-375');

  // ゆう: 完成 → 読み込み直しても、できあがりのまま
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');
  const r3 = await waitRoom(code, (r) => r.maps?.['ゆう']?.done === true);
  check('done: written', r3.maps['ゆう'].done === true);
  check('done: host sees progress', (await L.waitText(host, '#p-progress', '1 / 4').then(() => true).catch(() => false)));
  await yu.page.reload();
  await L.gate(yu);
  await L.waitVisible(yu, '#p-sent');
  check('reload: still done, map kept', JSON.stringify(await genres(yu, '#p-sent-map')) === JSON.stringify(['動物', 'ゲーム']), await genres(yu, '#p-sent-map'));
  await L.shot(yu, '08-sent');
  // 選びなおす → もう一度完成
  await yu.page.click('#p-redo');
  await L.waitVisible(yu, '#p-box');
  await waitRoom(code, (r) => r.maps?.['ゆう']?.done === false);
  check('redo: back to editing with items', (await leaves(yu)).includes('パズル'));
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');

  // みお: 完成して、みんなに出さない
  await mio.page.click('#p-done');
  await L.waitVisible(mio, '#p-sent');
  await mio.page.uncheck('#p-share');
  await waitRoom(code, (r) => r.maps?.['みお']?.share === false && r.maps['みお'].done === true);

  // ホスト: 端末なしの参加者の分を代わりに作る → 自分の分
  check('host: switcher shown', await L.visible(host, '#p-switch'));
  check('host: show button is secondary while editing', (await host.page.evaluate(() => document.querySelector('#btn-show').className)) === 'btn btn-secondary');
  await host.page.locator('#p-switch button', { hasText: 'じろう' }).click();
  await node(host, '好きなジャンルを足す').click();
  await pickGenre(host, '乗りもの');
  await pickItem(host, '電車');
  await host.page.click('#p-pop-close');
  await host.page.click('#p-done');
  await waitRoom(code, (r) => r.maps?.['じろう']?.done === true);
  await host.page.locator('#p-switch button', { hasText: 'ホスト' }).click();
  await node(host, '好きなジャンルを足す').click();
  await pickGenre(host, '食べもの');
  await host.page.click('#p-pop-close'); // 中身は選ばない
  await host.page.click('#p-done');
  await L.waitText(host, '#p-progress', '4 / 4');
  check('host: show button becomes the main button when all done', (await host.page.evaluate(() => document.querySelector('#btn-show').className)).includes('btn-primary'));
  check('db: proxy map written by host', arr((await roomOf(code)).maps['じろう'].genres)[0] === 'ride');
  await L.shot(host, '09-host-all-done');

  // 見せあう
  await host.page.click('#btn-show');
  await L.waitVisible(yu, '#screen-show');
  const r4 = await roomOf(code);
  check('show: order skips unshared map', JSON.stringify(arr(r4.show.order)) === JSON.stringify(['ホスト', 'ゆう', 'じろう']), r4.show);
  check('stats: finish', await L.waitStats(host, 'finish', 1));
  check('show: ask for a genre-only map', r4.show.ask === '「食べもの」だと、どんなのが好き？', r4.show.ask);
  check('show: map is not editable', (await yu.page.locator('#s-map .is-tap').count()) === 0 && (await yu.page.locator('#s-map .mp-node--plus, #s-map .mp-node--add').count()) === 0);
  check('show: guest has no host controls', !(await L.visible(yu, '#s-host')) && !(await L.visible(yu, '#btn-ask')));
  await host.page.click('#btn-next');
  await yu.page.waitForFunction(() => document.querySelector('#s-people [aria-selected="true"]')?.textContent === 'ゆう');
  check('show: second person map on guest', JSON.stringify(await genres(yu, '#s-map')) === JSON.stringify(['動物', 'ゲーム']));
  const ask2 = (await roomOf(code)).show.ask;
  check('show: ask uses an item', /「(犬|ペンギン|カピバラ|うさぎ|パズル)」/.test(ask2), ask2);
  await L.shot(host, '10-show-host');
  await L.shot(mio, '11-show-375');
  check('show 375: no overflow', (await L.overflow(mio)) <= 0);
  await host.page.click('#btn-next');
  await L.waitText(host, '#s-count', '3 / 3');
  check('show: no main button on the last person', (await host.page.evaluate(() => document.querySelector('#btn-next').className)) === 'btn btn-secondary' && (await L.text(host, '#btn-next')).includes('はじめの人へ'));

  // 見せあいの途中で入った人は見るだけ
  await late.page.fill('#guestName', 'おそい');
  await late.page.click('#btnJoinRoom');
  await L.waitVisible(late, '#screen-show');
  check('late: sees the show', (await genres(late, '#s-map')).length > 0);

  // もう一度作る時間にする（マップは残り、「できた」だけ外れる）
  await host.page.click('#btn-back-pick');
  await L.waitVisible(yu, '#p-box');
  const r5 = await roomOf(code);
  check('back to pick: seq 1, done cleared, maps kept', r5.status === 'pick' && r5.seq === 1 && r5.maps['ゆう'].done === false && arr(r5.maps['ゆう'].genres).length === 2, [r5.status, r5.seq]);
  check('back to pick: guest edits the same map', (await leaves(yu)).includes('犬'));
  check('late: can make a map now', await L.visible(late, '#p-box'));
  await host.page.click('#btn-show');
  await L.waitVisible(yu, '#screen-show');
  await sleep(400);
  check('stats: finish not counted twice', (await L.stats(host, 'finish')) === 1);

  // 待合室へ（マップは消える）
  await host.page.click('#btn-end');
  await L.waitVisible(yu, '#screen-lobby');
  const r6 = await roomOf(code);
  check('lobby again: maps cleared', r6.status === 'waiting' && !r6.maps && !r6.show, [r6.status, !!r6.maps]);
  check('stats: again', await L.waitStats(host, 'again', 1));
  // 進行だけにすると、ホストは作る人から外れる
  await host.page.uncheck('#setHostPlays');
  await L.waitText(yu, '#lobbyPlayers', '進行役');
  await host.page.click('#btnStart');
  await L.waitVisible(host, '#screen-pick');
  check('stats: players-4 again (2 guests + late + proxy)', await L.waitStats(host, 'players-4', 2));
  check('host only: makes the proxy map, no switcher', (await L.visible(host, '#p-box')) && !(await L.visible(host, '#p-switch')));
  check('round 2: previous maps are not shown', (await genres(yu)).length === 0);

  // 退出・ルームを閉じる
  await yu.page.click('#btnLeave');
  await L.waitVisible(yu, '#screen-top');
  const r7 = await waitRoom(code, (r) => !r.players['ゆう']);
  check('leave: guest removed', !r7.players['ゆう']);
  await host.page.click('#btnLeave');
  await L.waitVisible(mio, '#screen-top');
  await L.waitToast(mio, 'ルームが閉じられたよ');
  check('close: room removed', (await roomOf(code)) === null);

  await L.finishAll(server);
})().catch(async (error) => {
  console.error(error);
  // 止まったときの画面を残す
  for (const c of L.clients) {
    const info = await c.page.evaluate(() => ({ screen: document.querySelector('.sm-screen.active')?.id, join: document.querySelector('#joinError')?.textContent, proxy: document.querySelector('#proxyError')?.textContent, toast: document.querySelector('#roomk-toast')?.textContent })).catch(() => null);
    console.error(c.label, JSON.stringify(info), c.errors.slice(0, 3));
  }
  process.exit(1);
});
