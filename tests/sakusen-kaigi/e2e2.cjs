// 作戦会議 E2E その2: 指（タッチ）で、予定のふせんをつかんで動かす。
// Chrome のタッチ（CDP の Input.dispatchTouchEvent）で確かめる。iPhone・iPad の Safari の動きは、ここでは確かめられない。
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  L.writeNotices([]);
  const H = await L.newClient('host', { viewport: { width: 1180, height: 820 }, touch: true }); // タブレットを横にした大きさ
  const A = await L.newClient('sota', { viewport: { width: 375, height: 812 }, touch: true });
  const code = await L.createRoom(H);
  await L.joinByLink(A, code, 'そうた');
  await L.active(A, 'guest');
  let room = await L.roomOf(code);
  const sota = Object.keys(room.players).find((id) => room.players[id].name === 'そうた');
  await L.goBody(H, 'plan');
  await L.waitText(A, '#guest', 'これからの予定');

  // 指の操作（1本指）
  const touch = async (c) => {
    const cdp = await c.context.newCDPSession(c.page);
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) })) });
    return {
      start: (x, y) => send('touchStart', [[x, y]]),
      move: (x, y) => send('touchMove', [[x, y]]),
      end: () => send('touchEnd', []),
      async glide(x0, y0, x1, y1, steps = 10, wait = 25) { for (let i = 1; i <= steps; i++) { await send('touchMove', [[x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps]]); await sleep(wait); } },
    };
  };
  const mid = async (c, sel) => { await c.page.locator(sel).scrollIntoViewIfNeeded(); const b = await c.page.locator(sel).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const tap = async (c, sel) => { const [x, y] = await mid(c, sel); await c.page.touchscreen.tap(x, y); };
  const cellsOf = async () => ((await L.roomOf(code)).sched || {})[sota] || {};
  const has = (cells, cell, t) => (cells[cell] || []).some((it) => it.t === t);
  const waitCell = async (cell, t, want = true) => { for (let i = 0; i < 40; i++) { if (has(await cellsOf(), cell, t) === want) return true; await sleep(100); } return false; };
  const pickerOpen = (c) => c.page.evaluate(() => document.getElementById('picker').open);
  const tA = await touch(A);
  const g = (cell) => `#guest [data-act=cell][data-cell="${cell}"]`;

  // ── 子どもの端末（スマホの幅） ──
  await tap(A, g('0-am'));
  check('T1 指で押すと、予定を入れる窓が開く', await pickerOpen(A));
  await tap(A, '#picker-chips .chip[data-t="room-K"]');
  await tap(A, '#picker-close');
  check('T2 指で選んだ予定が入る', await waitCell('0-am', 'room-K'), await cellsOf());

  // つかんで、同じ日の別のマスへ
  let [x0, y0] = await mid(A, `${g('0-am')} [data-drag="room-K"]`);
  let [x1, y1] = await mid(A, g('0-todo'));
  const scroll0 = await A.page.evaluate(() => window.scrollY);
  await tA.start(x0, y0); await sleep(120);
  await tA.glide(x0, y0, x1, y1);
  const mid1 = await A.page.evaluate(() => ({ ghost: !!document.querySelector('.drag-ghost'), drop: document.querySelector('.drop')?.dataset.cell || null, scrollY: window.scrollY }));
  await tA.end();
  check('T3 指でつかむと、動かしている印が出て、行き先のマスに色がつく', mid1.ghost && mid1.drop === '0-todo', mid1);
  check('T4 ふせんをつかんでいる間、ページは動かない（スクロールしない）', mid1.scrollY === scroll0, [scroll0, mid1.scrollY]);
  check('T5 指をはなすと、ふせんが別のマスへ動く', await waitCell('0-todo', 'room-K') && !has(await cellsOf(), '0-am', 'room-K'), await cellsOf());
  await sleep(300);
  check('T6 動かしたあと、予定を入れる窓は開かない・印は消える', !(await pickerOpen(A)) && !(await A.page.evaluate(() => !!document.querySelector('.drag-ghost'))));

  // 動かした直後に、別のマスを押す
  await tap(A, g('0-pm'));
  check('T7 動かした直後に別のマスを押しても、ちゃんと開く', await pickerOpen(A));
  await tap(A, '#picker-close');

  // となりの日へ
  await A.page.waitForSelector(`${g('0-todo')} [data-drag="room-K"]`);
  [x0, y0] = await mid(A, `${g('0-todo')} [data-drag="room-K"]`);
  [x1, y1] = await mid(A, g('1-am'));
  // scrollIntoViewIfNeeded で位置が変わるので、つかむ所を取りなおす
  [x0, y0] = await mid(A, `${g('0-todo')} [data-drag="room-K"]`);
  const b1 = await A.page.locator(g('1-am')).boundingBox();
  const fits = b1.y + b1.height / 2 < 812 && y0 > 0;
  if (fits) {
    await tA.start(x0, y0); await sleep(120);
    await tA.glide(x0, y0, b1.x + b1.width / 2, b1.y + b1.height / 2);
    await tA.end();
  }
  check('T8 画面に見えている、となりの日のマスへも動かせる', fits && await waitCell('1-am', 'room-K'), { fits, cells: await cellsOf() });

  // ゆっくり動かす（2秒をこえる）間に、ほかの人が予定を足して画面が描きなおされても、つかんだまま動かせる
  await A.page.waitForSelector(`${g('1-am')} [data-drag="room-K"]`);
  [x0, y0] = await mid(A, `${g('1-am')} [data-drag="room-K"]`);
  const bt = await A.page.locator(g('1-todo')).boundingBox();
  await tA.start(x0, y0); await sleep(120);
  await tA.glide(x0, y0, x0 + 30, y0 + 30, 4);
  const cur = await cellsOf();
  await L.rest('PUT', `${L.ROOMS}/${code}/sched/${sota}/1-pm`, [{ ...(cur['1-am'][0]), t: 'おでかけ' }]);
  await sleep(2600);
  const slow = await A.page.evaluate(() => ({ ghost: !!document.querySelector('.drag-ghost'), added: !!document.querySelector('#guest [data-drag="おでかけ"]') }));
  // 描きなおしで行の高さが変わるので、行き先を取りなおす
  const bt2 = await A.page.locator(g('1-todo')).boundingBox();
  await tA.glide(x0 + 30, y0 + 30, bt2.x + bt2.width / 2, bt2.y + bt2.height / 2);
  await tA.end();
  check('T9 ゆっくり動かしている間に画面が描きなおされても、つかんだまま', slow.ghost, slow);
  check('T10 そのあと指をはなすと、ちゃんと動く', await waitCell('1-todo', 'room-K') && !has(await cellsOf(), '1-am', 'room-K'), await cellsOf());
  await A.page.waitForSelector('#guest [data-drag="おでかけ"]');
  check('T11 待っていた分（ほかの人が足した予定）も、はなしたあとに出る', true);

  // マスの外ではなす
  await A.page.waitForSelector(`${g('1-todo')} [data-drag="room-K"]`);
  [x0, y0] = await mid(A, `${g('1-todo')} [data-drag="room-K"]`);
  const before = JSON.stringify(await cellsOf());
  await tA.start(x0, y0); await sleep(120);
  await tA.glide(x0, y0, 187, 4);
  await tA.end(); await sleep(500);
  check('T12 マスの外ではなすと、何も変わらない・窓も開かない', JSON.stringify(await cellsOf()) === before && !(await pickerOpen(A)));

  // ふせんのない所から指を動かすと、ページが動く（スクロールできる）
  await A.page.evaluate(() => window.scrollTo(0, 0)); await sleep(200);
  const [ex, ey] = await mid(A, g('2-am')); // 空いているマス（ふせんの上からだと、つかむ動きになる）
  const sy0 = await A.page.evaluate(() => window.scrollY);
  await tA.start(ex, ey); await sleep(60);
  await tA.glide(ex, ey, ex, ey - 300, 12, 25);
  await tA.end(); await sleep(600);
  const sy1 = await A.page.evaluate(() => window.scrollY);
  check('T13 ふせんのない所から指を動かすと、ページがスクロールする・窓は開かない', sy1 - sy0 > 100 && !(await pickerOpen(A)), [sy0, sy1]);
  await L.shot(A, 'touch-guest');

  // ── 進行役（タブレットの大きさ・指） ──
  const tH = await touch(H);
  await tap(H, `#h-ops [data-act=sel][data-pid="${sota}"]`);
  await H.page.waitForSelector('#h-preview [data-drag="おでかけ"]');
  [x0, y0] = await mid(H, '#h-preview [data-drag="おでかけ"]');
  [x1, y1] = await mid(H, '#h-preview .cell[data-cell="4-am"]');
  [x0, y0] = await mid(H, '#h-preview [data-drag="おでかけ"]');
  await tH.start(x0, y0); await sleep(120);
  await tH.glide(x0, y0, x1, y1);
  const midH = await H.page.evaluate(() => ({ ghost: !!document.querySelector('.drag-ghost'), drop: document.querySelector('.drop')?.dataset.cell || null }));
  await tH.end();
  check('T14 進行役も、プレビューのふせんを指でつかめる', midH.ghost && midH.drop === '4-am', midH);
  check('T15 進行役が指をはなすと動く・子どもの画面にも出る', await waitCell('4-am', 'おでかけ') && !has(await cellsOf(), '1-pm', 'おでかけ'), await cellsOf());
  await A.page.waitForSelector(`${g('4-am')} [data-drag="おでかけ"]`);
  await sleep(300);
  check('T16 進行役が動かしたあと、窓は開かない', !(await pickerOpen(H)));
  await tap(H, '#h-preview .cell[data-cell="5-pm"]');
  check('T17 進行役が指でマスを押すと、予定を入れる窓が開く', await pickerOpen(H));
  await tap(H, '#picker-close');
  await L.shot(H, 'touch-host');
  await L.finish(server);
})().catch((e) => { console.error(e); process.exit(2); });
