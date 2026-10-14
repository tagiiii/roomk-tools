// E2E その4: メンターが単元と問題数を選んで「はじめる」→ 子どもの画面がその問題に切りかわる
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, roomWhen, open, title, waitTitle, text, waitText, overflow, toastText, waitToast, stats, session, liveOf, barText, waitBar, waitWatch, solve, pickUnit, pickWord } = L;

const status = (H) => text(H, '.yk-order__status');
const waitStatus = (H, part, timeout = 8000) => waitText(H, '.yk-order__status', part, timeout);
const setCount = (c) => text(c, '#app .yk-set-count');
const waitSetCount = (c, part, timeout = 8000) => waitText(c, '#app .yk-set-count', part, timeout);

async function startOrder(H, unitId, n) {
  await H.page.selectOption('#orderUnit', unitId);
  await H.page.click(`.yk-order__count[data-n="${n}"]`);
  await H.page.click('#btnStartOrder');
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  await rest('DELETE', L.ROOMS);

  // ── 子どもが前に一人で「火山噴出物」を組み立てていた
  const P = await L.newClient('player');
  await open(P);
  await pickUnit(P, '大地の成り立ちと変化');
  await pickWord(P, 0);
  await solve(P);
  await waitText(P, '.yk-puzzle-status', 'できました');

  // ── 見る画面: 相手がいない間は出せない
  const H = await L.newClient('host');
  const code = await L.createWatch(H);
  check('panel: start disabled while nobody is in', await H.page.isDisabled('#btnStartOrder'));
  check('panel: hint while nobody is in', (await status(H)).includes('相手が入ると'));
  check('panel: units listed by subject', (await H.page.$$eval('#orderUnit optgroup', (g) => g.map((x) => x.label + ':' + x.children.length).join(','))) === '理科:4,社会:2');
  check('panel: default count is 5', (await H.page.getAttribute('.yk-order__count[data-n="5"]', 'aria-pressed')) === 'true');

  await L.showVia(P, code);
  await H.page.waitForFunction(() => !document.getElementById('btnStartOrder').disabled);
  check('panel: enabled when the child is in', true);
  check('panel: no order yet', !(await H.page.isVisible('#btnEndOrder')));

  // ── 単元と問題数を選んで「はじめる」→ 子どもは押さなくても切りかわる
  await startOrder(H, 'rika-1-daichi', 3);
  await waitSetCount(P, '問題 1 / 3');
  check('order: child switched without pressing anything', (await text(P, '.yk-back-link')).includes('問題をやめる'));
  let room = await roomWhen(code, (r) => r.order && liveOf(r) && liveOf(r).view && liveOf(r).view.set);
  check('order: written by the mentor', room.order.unit === 'rika-1-daichi' && room.order.n === 3 && /^[a-z0-9]{8}$/.test(room.order.id) && typeof room.order.at === 'number', room.order);
  const chosen = liveOf(room).view.set.words;
  check('order: three words, unbuilt first', chosen.length === 3 && !chosen.includes(0) && new Set(chosen).size === 3, chosen);
  // 数えるのは、書きこみが届いた応答のあと（子どもの画面が切りかわるより、少しおそいことがある）
  await H.page.waitForFunction(() => (window.__STATS__ || []).includes('order-start'), null, { timeout: 5000 }).catch(() => {});
  check('order: counted once on the mentor side', (await stats(H, 'order-start')) === 1);
  await waitStatus(H, '1問目 / 3問');
  await waitText(H, '.yk-watch-body .yk-set-count', '問題 1 / 3');
  check('order: end button shown', await H.page.isVisible('#btnEndOrder'));

  // 3問を組み立てる
  for (let k = 0; k < 3; k += 1) {
    await solve(P);
    await waitText(P, '.yk-puzzle-status', 'できました');
    const label = await text(P, '.yk-puzzle-result .btn-primary');
    check(`order: result button ${k + 1}`, label.includes(k < 2 ? 'つぎの問題へ' : 'おわりへ'), label);
    check(`order: no word list button in a set ${k + 1}`, !(await P.page.$$eval('.yk-puzzle-result button', (b) => b.some((x) => x.textContent.includes('語の一覧へ')))));
    await P.page.click('.yk-puzzle-result .btn-primary');
    if (k < 2) {
      await waitSetCount(P, `問題 ${k + 2} / 3`);
      await waitStatus(H, `${k + 2}問目 / 3問`);
    }
  }
  await waitTitle(P, '全部組み立てました');
  check('done: three words listed', (await P.page.$$eval('#app .yk-set-list__item', (e) => e.length)) === 3);
  check('done: counted once', (await stats(P, 'order-done')) === 1);
  await waitStatus(H, '全部組み立てました');
  await waitWatch(H, '全部組み立てました');
  check('done: the mentor sees the list', (await H.page.$$eval('.yk-watch-body .yk-set-list__item', (e) => e.length)) === 3);
  await P.page.click('#app .btn-primary');
  await waitTitle(P, '理科：大地の成り立ちと変化');
  await waitStatus(H, 'おわって、一覧にもどりました');
  // 組み立てた語に星が付いている（もとの1語＋3語）
  check('done: stars on the tiles', (await P.page.$$eval('.yk-word-tile__built', (e) => e.length)) === 4);

  // 問題をおわる（子どもは問題の外なので、何も変わらない）
  await H.page.click('#btnEndOrder');
  room = await roomWhen(code, (r) => !r.order);
  check('end: order removed', !room.order);
  await waitStatus(H, 'を選んで「はじめる」');
  await sleep(500);
  check('end: child not disturbed', (await title(P)) === '理科：大地の成り立ちと変化' && (await toastText(P)) === null);

  // ── 自由に遊んでいる途中でも、「はじめる」でその場で切りかわる
  await P.page.click('.yk-back-link');
  await pickUnit(P, '古代までの日本');
  await pickWord(P, 2);
  await waitTitle(P, '古？');
  await startOrder(H, 'shakai-1-chusei', 5);
  await waitSetCount(P, '問題 1 / 5');
  check('switch: puzzle replaced by the order', (await text(P, '.yk-puzzle-word__text')) !== '古？');
  await solve(P);
  await waitText(P, '.yk-puzzle-status', 'できました');
  await P.page.click('.yk-puzzle-result .btn-primary');
  await waitSetCount(P, '問題 2 / 5');
  const second = await text(P, '.yk-puzzle-word__text');

  // 再読み込み → 同じ問題の、同じところにもどる
  await P.page.reload();
  await waitBar(P, 'メンターに見せています', 15000);
  await waitSetCount(P, '問題 2 / 5', 15000);
  check('reload: same word as before', (await text(P, '.yk-puzzle-word__text')) === second, [second, await text(P, '.yk-puzzle-word__text')]);
  check('reload: session keeps the set', (await session(P)).set.i === 1);
  await waitStatus(H, '2問目 / 5問');

  // 問題をやめる → 一覧へ。同じ問題は、もう始まらない（再読み込みしても）
  await P.page.click('.yk-back-link');
  await waitTitle(P, '社会：中世の日本');
  await waitStatus(H, '問題をやめて、一覧にもどりました');
  await P.page.reload();
  await waitBar(P, 'メンターに見せています', 15000);
  await sleep(1500);
  check('quit: the same order does not restart', (await title(P)) === '単元を選ぶ' && (await setCount(P)) === null, await title(P));
  // 抜けたしるしは、再読み込みのあとも、自由に遊んでいる間も、メンターの画面に出つづける
  await waitStatus(H, '問題をやめて、一覧にもどりました');
  await pickUnit(P, '古代までの日本');
  await pickWord(P, 0);
  await waitTitle(P, '？生時代');
  await sleep(600);
  check('quit: still shown while playing freely', (await status(H)).includes('問題をやめて、一覧にもどりました'), await status(H));
  // 記録の中の問題がこわれていたら、使わない（同じ問題は始まらない）
  await P.page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('yokumitekanji_session'));
    saved.set = { id: saved.handled[saved.handled.length - 1], unit: 'shakai-1-chusei', words: [2, 2, 3], i: 0, done: [] };
    sessionStorage.setItem('yokumitekanji_session', JSON.stringify(saved));
  });
  await P.page.reload();
  await waitBar(P, 'メンターに見せています', 15000);
  await sleep(1500);
  check('broken session set: ignored', (await setCount(P)) === null && (await title(P)) === '単元を選ぶ', await title(P));

  // 出しなおす → また始まる。とちゅうで「問題をおわる」→ 子どもに知らせて一覧へ
  await startOrder(H, 'shakai-1-chusei', 0);
  await waitSetCount(P, '問題 1 / 13');
  check('all: every word of the unit', true);
  await H.page.click('#btnEndOrder');
  await waitToast(P, 'メンターが問題をおわりにしました');
  await waitTitle(P, '社会：中世の日本');
  check('end in the middle: child back to the list', (await setCount(P)) === null);

  // ── メンターが語を選ぶ（押した順に出る）
  await H.page.click('.yk-order__count[data-n="pick"]');
  check('pick: start disabled until a word is chosen', await H.page.isDisabled('#btnStartOrder'));
  await H.page.selectOption('#orderUnit', 'rika-1-busshitsu');
  check('pick: the unit words are listed', (await H.page.$$eval('.yk-order__word', (e) => e.length)) === 12);
  for (const i of [9, 2, 5]) await H.page.click(`.yk-order__word[data-i="${i}"]`);
  // 押した順の番号が付く（語の並びは単元の順のまま）
  const numbers = await H.page.$$eval('.yk-order__word[aria-pressed="true"]', (e) => e.map((x) => x.dataset.i + ':' + x.querySelector('.yk-order__word-no').textContent).join(','));
  check('pick: numbers show the order', numbers === '2:2,5:3,9:1', numbers);
  check('pick: note', (await text(H, '.yk-order__pick-note')).includes('3語を選んでいます'));
  // 単元を変えると、選んだ語は空になる
  await H.page.selectOption('#orderUnit', 'rika-1-daichi');
  check('pick: changing the unit clears the choice', (await H.page.$$eval('.yk-order__word[aria-pressed="true"]', (e) => e.length)) === 0 && await H.page.isDisabled('#btnStartOrder'));
  await H.page.selectOption('#orderUnit', 'rika-1-busshitsu');
  for (const i of [9, 2, 5]) await H.page.click(`.yk-order__word[data-i="${i}"]`);
  // 外して選び直せる
  await H.page.click('.yk-order__word[data-i="2"]');
  await H.page.click('.yk-order__word[data-i="2"]');
  await H.page.click('#btnStartOrder');
  await waitSetCount(P, '問題 1 / 3');
  room = await roomWhen(code, (r) => r.order && r.order.words);
  check('pick: order carries the words', JSON.stringify(room.order.words) === '[9,5,2]' && room.order.n === 3, room.order);
  check('pick: first word is the first chosen', (await text(P, '.yk-puzzle-word__text')) === '状？変化', await text(P, '.yk-puzzle-word__text'));
  await waitStatus(H, '選んだ3語');
  await solve(P);
  await waitText(P, '.yk-puzzle-status', 'できました');
  await P.page.click('.yk-puzzle-result .btn-primary');
  await waitSetCount(P, '問題 2 / 3');
  check('pick: second word follows the order', (await text(P, '.yk-puzzle-word__text')) === '再結？', await text(P, '.yk-puzzle-word__text'));
  await waitStatus(H, '2問目 / 3問');
  await H.page.click('#btnEndOrder');
  await waitToast(P, 'メンターが問題をおわりにしました');
  await H.page.click('.yk-order__count[data-n="5"]');
  check('pick: word list hidden in count mode', !(await H.page.isVisible('#orderWords')));
  // 語の並びがおかしい問題（重なり・数の食いちがい）は使わない
  await rest('PUT', `${L.ROOMS}/${code}/order`, { id: 'abcdefgh', unit: 'rika-1-busshitsu', n: 2, words: [1, 1] });
  await sleep(800);
  check('pick: broken word list ignored', (await setCount(P)) === null);
  await rest('PUT', `${L.ROOMS}/${code}/order`, { id: 'abcdefgi', unit: 'rika-1-busshitsu', n: 5, words: [1, 2] });
  await sleep(800);
  check('pick: count mismatch ignored', (await setCount(P)) === null);
  await rest('DELETE', `${L.ROOMS}/${code}/order`);

  // ── おかしな問題が書かれても、止まらない
  await rest('PUT', `${L.ROOMS}/${code}/order`, { id: 'BAD', unit: 'constructor', n: 999 });
  await sleep(800);
  check('bad order: ignored by the child', (await setCount(P)) === null);
  check('bad order: the mentor panel treats it as none', (await status(H)).includes('を選んで「はじめる」'));
  await rest('DELETE', `${L.ROOMS}/${code}/order`);

  // ── 1問の制限時間（30秒）。時間切れでも×は出さず、形をたしかめて先へ。星は付けない
  check('timer: default is none', (await H.page.getAttribute('.yk-order__time[data-t="0"]', 'aria-pressed')) === 'true');
  await H.page.click('.yk-order__count[data-n="3"]');
  await H.page.click('.yk-order__time[data-t="30"]');
  await H.page.selectOption('#orderUnit', 'rika-1-genshou');
  await H.page.click('#btnStartOrder');
  await waitSetCount(P, '問題 1 / 3');
  room = await roomWhen(code, (r) => r.order && r.order.t === 30 && liveOf(r) && liveOf(r).puzzle && liveOf(r).puzzle.limit === 30);
  check('timer: order and puzzle carry the limit', room.order.t === 30 && typeof liveOf(room).puzzle.endsAt === 'number', room.order);
  check('timer: bar shown to the child', await P.page.isVisible('#app .yk-timer'));
  await H.page.waitForSelector('.yk-watch-body .yk-timer');
  await waitStatus(H, '1問30秒');
  const firstLeft = await text(P, '#app .yk-timer__left');
  check('timer: counts down from 30', /^あと(30|29|28)秒$/.test(firstLeft), firstLeft);
  await solve(P);
  await waitText(P, '.yk-puzzle-status', 'できました');
  check('timer: bar stops when built', (await text(P, '#app .yk-timer__left')) !== '時間です');
  await P.page.click('.yk-puzzle-result .btn-primary');
  await waitSetCount(P, '問題 2 / 3');
  // 2問目: 少し待ってから再読み込みしても、時間は始まり直さない
  await sleep(6000);
  await P.page.reload();
  await waitBar(P, 'メンターに見せています', 15000);
  await waitSetCount(P, '問題 2 / 3', 15000);
  const afterReload = Number(((await text(P, '#app .yk-timer__left')) || '').replace(/[^0-9]/g, ''));
  check('timer: reload keeps the same deadline', afterReload > 0 && afterReload <= 25, afterReload);
  // さわらずに時間を待つ
  await waitText(P, '.yk-puzzle-status', '時間です', 40000);
  check('timeup: message to the child', (await text(P, '.yk-puzzle-result__timeup')).includes('形をたしかめましょう'));
  check('timeup: no cross mark, the word is drawn', (await P.page.$$eval('.yk-final path', (e) => e.length)) > 0);
  check('timeup: next button', (await text(P, '.yk-puzzle-result .btn-primary')).includes('つぎの問題へ'));
  await waitText(H, '.yk-watch-body .yk-puzzle-status', '時間です', 10000);
  check('timeup: mentor sees it', (await text(H, '.yk-watch-body .yk-puzzle-result__timeup')) === '時間です。');
  room = await roomOf(code);
  check('timeup: written as done with the timeout mark', liveOf(room).puzzle.done === true && liveOf(room).puzzle.timeout === true);
  await P.page.click('.yk-puzzle-result .btn-primary');
  await waitSetCount(P, '問題 3 / 3');
  await solve(P);
  await waitText(P, '.yk-puzzle-status', 'できました');
  await P.page.click('.yk-puzzle-result .btn-primary');
  await waitTitle(P, 'おわりました');
  check('timeup: two stars in the list of three', (await P.page.$$eval('#app .yk-set-list__item', (e) => e.map((x) => (x.querySelector('.yk-word-tile__built') ? 1 : 0)).join(''))) === '101');
  await waitStatus(H, 'おわりました');
  await waitWatch(H, 'おわりました');
  await P.page.click('#app .btn-primary');
  await waitTitle(P, '理科：身のまわりの現象（光・音・力）');
  check('timeup: the timed-out word has no star on the tiles', (await P.page.$$eval('.yk-word-tile__built', (e) => e.length)) === 2);
  // 問題から抜けたら、時間は止まる（あとから時間切れが起きない）
  await H.page.click('#btnStartOrder');
  await waitSetCount(P, '問題 1 / 3');
  await P.page.click('.yk-back-link');
  await waitTitle(P, '理科：身のまわりの現象（光・音・力）');
  await sleep(32000);
  check('timer: stopped after leaving', (await title(P)) === '理科：身のまわりの現象（光・音・力）' && (await toastText(P)) === null);
  check('timer: nothing written after leaving', !liveOf(await roomOf(code)).puzzle);
  await H.page.click('#btnEndOrder');
  await H.page.click('.yk-order__time[data-t="0"]');

  // ── せまい画面でも、パネルがはみ出さない
  await H.page.setViewportSize({ width: 375, height: 760 });
  await sleep(300);
  check('narrow: no sideways scroll on the mentor screen', (await overflow(H)) <= 0);
  await H.page.setViewportSize({ width: 1100, height: 760 });

  await H.page.click('#btnCloseWatch');
  await waitTitle(H, '単元を選ぶ');
  await waitToast(P, 'メンターが見る画面をとじました');
  check('close: room removed', (await roomWhen(code, (r) => r === null)) === null);
  check('nothing left in the database', (await rest('GET', L.ROOMS)) === null, await rest('GET', L.ROOMS));
  await L.finishAll(server);
})().catch((error) => { console.error(error); process.exit(2); });
