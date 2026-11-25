// 好きなものマップ E2E その5: ホストが参加する人のマップをいっしょに編集する（2026-11-26）
// ホストと参加する人の2台で同じマップを編集し、両方の画面に届くこと・同時に押しても相手の分が消えないこと・
// 完成と「みんなに出す」は本人だけが決めること・通信が切れていたあいだの編集も重なること を確かめる
const L = require('./lib.cjs');
const { check, sleep, roomOf } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const node = (c, label) => c.page.locator(`#p-map g.mp-node.is-tap[aria-label="${label}"]`);
const leaves = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--leaf .mp-leaf__text`)].map((n) => n.textContent), box);
const genres = (c, box = '#p-map') => c.page.evaluate((b) => [...document.querySelectorAll(`${b} .mp-node--genre .mp-genre__text`)].map((n) => n.textContent), box);
const pickGenre = (c, label) => c.page.locator('#p-genres .sm-genre', { hasText: label }).first().click();
const pickItem = (c, label) => c.page.locator('#p-items .sm-item', { hasText: label }).first().click();
const tab = (c, label) => c.page.locator('#p-switch button', { hasText: label }).first().click();
async function waitRoom(code, test, timeout = 6000) {
  const until = Date.now() + timeout;
  let room = null;
  while (Date.now() < until) { room = await roomOf(code); if (room && test(room)) return room; await sleep(100); }
  return room;
}
async function waitFor(fn, timeout = 6000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await fn()) return true; await sleep(100); }
  return !!(await fn());
}
const itemsOf = (r, name, gid) => arr(r?.maps?.[name]?.items?.[gid]);
const genresOf = (r, name) => arr(r?.maps?.[name]?.genres);

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu', { viewport: { width: 375, height: 812 } });

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(yu, 'ゆう', code);
  await L.waitText(host, '#lobbyPlayers', 'ゆう');
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-pick');
  await L.waitVisible(host, '#screen-pick');

  // ホストには「だれのマップ？」が出て、はじめは自分の分。参加する人には出ない
  check('host: switcher with guest', await L.visible(host, '#p-switch') && (await L.text(host, '#p-switch')).includes('ゆう'));
  check('host: starts on own map', (await host.page.evaluate(() => document.querySelector('#p-switch button[aria-selected="true"]')?.textContent)) === 'ホスト（自分）');
  check('guest: no switcher', !(await L.visible(yu, '#p-switch')));

  // ゆうが選ぶ → ホストのゆうのマップに出る
  await node(yu, '好きなジャンルを足す').click();
  await pickGenre(yu, '動物');
  await pickItem(yu, '犬');
  await yu.page.click('#p-pop-close');
  await waitRoom(code, (r) => itemsOf(r, 'ゆう', 'animal').includes('犬'));
  await tab(host, 'ゆう');
  check('host on guest map: finish button hidden', !(await L.visible(host, '#p-done')));
  check('host on guest map: hint', (await L.text(host, '#p-map-hint')).includes('ゆうさんのマップを、いっしょに作れるよ'));
  check('host sees guest picks', await waitFor(async () => (await leaves(host)).includes('犬')));
  await L.shot(host, '51-host-edits-guest');

  // ホストが足す → ゆうの画面に出る
  await node(host, '動物の中身を選ぶ').click();
  await L.waitVisible(host, '#p-items');
  await pickItem(host, '猫');
  await host.page.click('#p-pop-close');
  await waitRoom(code, (r) => itemsOf(r, 'ゆう', 'animal').includes('猫'));
  check('guest sees host edit', await waitFor(async () => (await leaves(yu)).includes('猫')));
  check('guest keeps own pick', (await leaves(yu)).includes('犬'));
  await L.shot(yu, '52-guest-sees-host-edit');

  // 同時に押す: ゆうはゲーム、ホストは乗りものを足す → どちらも残る
  await node(yu, 'ジャンルを足す').click();
  await L.waitVisible(yu, '#p-genres');
  await node(host, 'ジャンルを足す').click();
  await L.waitVisible(host, '#p-genres');
  const clickGenre = (label) => [...document.querySelectorAll('#p-genres .sm-genre')].find((b) => b.textContent.includes(label)).click();
  await Promise.all([yu.page.evaluate(clickGenre, 'ゲーム'), host.page.evaluate(clickGenre, '乗りもの')]);
  const both = await waitRoom(code, (r) => genresOf(r, 'ゆう').includes('game') && genresOf(r, 'ゆう').includes('ride'));
  check('concurrent: both genres kept', genresOf(both, 'ゆう').includes('game') && genresOf(both, 'ゆう').includes('ride'), genresOf(both, 'ゆう'));
  await pickItem(yu, 'パズル');
  await pickItem(host, '電車');
  const both2 = await waitRoom(code, (r) => itemsOf(r, 'ゆう', 'game').includes('パズル') && itemsOf(r, 'ゆう', 'ride').includes('電車'));
  check('concurrent: both items kept', itemsOf(both2, 'ゆう', 'game').includes('パズル') && itemsOf(both2, 'ゆう', 'ride').includes('電車'), both2?.maps?.['ゆう']);
  await yu.page.click('#p-pop-close');
  await host.page.click('#p-pop-close');
  check('concurrent: guest map shows all', await waitFor(async () => { const g = await genres(yu); return g.includes('ゲーム') && g.includes('乗りもの') && (await leaves(yu)).includes('電車'); }));
  check('concurrent: host map shows all', await waitFor(async () => { const g = await genres(host); return g.includes('ゲーム') && (await leaves(host)).includes('パズル'); }));

  // ホストが × で消す → ゆうの画面からも消える
  await node(host, '犬を消す').click();
  await waitRoom(code, (r) => !itemsOf(r, 'ゆう', 'animal').includes('犬'));
  check('host removes: gone on guest', await waitFor(async () => !(await leaves(yu)).includes('犬')));

  // ゆうが完成・みんなに出さない → ホストはそのまま直せる。完成とみんなに出さないは変わらない
  await yu.page.click('#p-done');
  await L.waitVisible(yu, '#p-sent');
  await yu.page.uncheck('#p-share');
  await waitRoom(code, (r) => r.maps?.['ゆう']?.done === true && r.maps['ゆう'].share === false);
  check('host: still editing a done guest map', await waitFor(async () => (await L.visible(host, '#p-map')) && (await L.text(host, '#p-map-hint')).includes('できあがっている')));
  check('host: tab shows done', await host.page.evaluate(() => !!document.querySelector('#p-switch button[aria-selected="true"] .material-symbols-rounded')));
  await node(host, 'ゲームの中身を選ぶ').click();
  await L.waitVisible(host, '#p-items');
  await pickItem(host, '育成');
  await host.page.click('#p-pop-close');
  const r5 = await waitRoom(code, (r) => itemsOf(r, 'ゆう', 'game').includes('育成'));
  check('done map edited by host: done and share kept', r5.maps['ゆう'].done === true && r5.maps['ゆう'].share === false, r5.maps['ゆう']);
  check('guest sent map shows host edit', await waitFor(async () => (await leaves(yu, '#p-sent-map')).includes('育成')));
  check('guest: share stays off', !(await yu.page.isChecked('#p-share')));

  // 選びなおす（ゆう）→ 完成を外せる
  await yu.page.click('#p-redo');
  await L.waitVisible(yu, '#p-box');
  await waitRoom(code, (r) => r.maps?.['ゆう']?.done === false);
  check('guest redo works', true);

  // ゆうの通信が切れると、ホストの「だれのマップ？」からゆうが外れ、自分の分にもどる（ほかの人の分にポップアップを残さない）
  await node(host, '乗りものの中身を選ぶ').click();
  await L.waitVisible(host, '#p-items');
  await yu.context.setOffline(true);
  check('offline: guest tab removed on host', await waitFor(async () => !(await L.text(host, '#p-switch')).includes('ゆう') || !(await L.visible(host, '#p-switch')), 90000));
  check('offline: host popup closed, back to own map', !(await host.page.evaluate(() => document.querySelector('#p-pop').open)) && (await genres(host)).length === 0);
  // 切れているあいだにゆうが選んだ分は、もどると届き、ホストにも出る
  await node(yu, '動物の中身を選ぶ').click();
  await L.waitVisible(yu, '#p-items');
  await pickItem(yu, 'うさぎ');
  await yu.page.click('#p-pop-close');
  await yu.context.setOffline(false);
  const r6 = await waitRoom(code, (r) => itemsOf(r, 'ゆう', 'animal').includes('うさぎ') && itemsOf(r, 'ゆう', 'game').includes('育成'), 30000);
  check('offline: guest edit arrives, host edit kept', itemsOf(r6, 'ゆう', 'animal').includes('うさぎ') && itemsOf(r6, 'ゆう', 'game').includes('育成'), r6?.maps?.['ゆう']);
  check('offline: tab back on host', await waitFor(async () => (await L.text(host, '#p-switch')).includes('ゆう'), 15000));
  await tab(host, 'ゆう');
  check('offline: host shows guest edit', await waitFor(async () => (await leaves(host)).includes('うさぎ'), 10000));

  // ホストは自分の分にもどって作れる（ゆうの分と混ざらない）
  await tab(host, 'ホスト');
  check('host own map is separate', (await genres(host)).length === 0);
  check('host own map: finish button back', await L.visible(host, '#p-done'));
  check('375: no overflow', (await L.overflow(yu)) <= 0);
  await L.shot(yu, '53-guest-final');

  // 見せあいには、いっしょに作った形が出る
  await host.page.click('#btn-show');
  await L.waitVisible(yu, '#screen-show');
  const r7 = await roomOf(code);
  // ゆうは「みんなに出す」を外したので順番に入らない（ホストが直しても本人の選んだとおり）。マップはいっしょに作った形
  check('show: guest who turned share off is skipped', !arr(r7.show?.order).includes('ゆう') && itemsOf(r7, 'ゆう', 'game').includes('育成'), r7.show);

  // 通信を落としたときの接続のエラーは想定どおり（e2e3 と同じ）
  const NET_ERROR = /ERR_INTERNET_DISCONNECTED|Permissions policy violation: unload/;
  for (const c of [host, yu]) c.errors = c.errors.filter((e) => !NET_ERROR.test(e));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
