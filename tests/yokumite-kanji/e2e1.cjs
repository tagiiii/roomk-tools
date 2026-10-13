// E2E その1: 一人で遊ぶ・見る画面を作る・リンクから見せる・部品の動きが映る・完成・やめる・席の切りかえ・とじる
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, seatOf, liveOf, emptySeats, roomWhen, open, title, waitTitle, text, waitText, visible, overflow, toastText, waitToast, stats, session, pidOf, barText, waitBar, watchText, waitWatch, playerPieces, viewerPieces, waitSame, dragLoose, solve, pickUnit, pickWord } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  await rest('DELETE', L.ROOMS);

  // ── 一人で遊ぶ（Firebase につながない）
  const S = await L.newClient('solo');
  await open(S);
  check('solo: top', (await title(S)) === '単元を選ぶ');
  await pickUnit(S, '古代までの日本');
  await waitTitle(S, '社会：古代までの日本');
  check('solo: 13 words', (await S.page.$$eval('.yk-word-tile', (e) => e.length)) === 13);
  await pickWord(S, 5);
  await waitTitle(S, '？唐使');
  check('solo: 5 pieces (3 real + 2 decoys)', (await S.page.$$eval('.yk-stage .yk-piece', (e) => e.length)) === 5);
  check('solo: no template visible', !(await S.page.evaluate(() => document.querySelector('.yk-ghost').classList.contains('is-on'))));
  await dragLoose(S, 0, { dx: 30, dy: 20 });
  check('solo: a piece dropped off-target stays loose', (await S.page.$$eval('.yk-stage .yk-piece.is-locked', (e) => e.length)) === 0);
  await solve(S);
  await waitText(S, '.yk-puzzle-status', 'できました');
  check('solo: result shows the word', (await text(S, '.yk-puzzle-result__word')) === '遣唐使');
  check('solo: decoys fade', (await S.page.$$eval('.yk-stage .yk-piece.is-gone', (e) => e.length)) === 2);
  check('solo: final strokes drawn', (await S.page.$$eval('.yk-final path', (e) => e.length)) === 13);
  check('solo: counted puzzle-done', (await stats(S, 'puzzle-done')) === 1);
  check('solo: saved locally', (await S.page.evaluate(() => JSON.parse(localStorage.getItem('yokumite-kanji:v2')).clear['shakai-1-kodai:遣唐使'])) === 1);
  check('solo: firebase not initialised', (await S.page.evaluate(() => window.firebase.apps.length)) === 0);
  check('solo: no socket opened', S.sockets === 0, S.sockets);
  check('solo: nothing in the database', (await rest('GET', L.ROOMS)) === null);
  await S.page.click('.yk-puzzle-result .yk-actions .btn-secondary');
  await waitTitle(S, '社会：古代までの日本');
  check('solo: star on the tile', (await S.page.$$eval('.yk-word-tile', (els) => els.map((e) => (e.querySelector('.yk-word-tile__built') ? 1 : 0)).join(''))) === '0000010000000');

  // ── 全部の単元・全部の語で、盤面が組める（正しい部品2つ以上＋にせもの2〜3つ・画が欠けていない）
  await S.page.click('.yk-back-link');
  await waitTitle(S, '単元を選ぶ');
  const unitNames = await S.page.$$eval('.yk-unit-card__name', (els) => els.map((e) => e.textContent));
  check('all: six units', unitNames.join('|') === 'いろいろな生物とその共通点|身のまわりの物質|身のまわりの現象（光・音・力）|大地の成り立ちと変化|古代までの日本|中世の日本', unitNames);
  let wordsSeen = 0;
  const broken = [];
  for (const unitName of unitNames) {
    await pickUnit(S, unitName);
    await S.page.waitForSelector('.yk-word-tile');
    const count = await S.page.$$eval('.yk-word-tile', (e) => e.length);
    for (let i = 0; i < count; i += 1) {
      await pickWord(S, i);
      await S.page.waitForSelector('.yk-stage .yk-piece');
      const info = await S.page.evaluate(() => {
        const pieces = [...document.querySelectorAll('.yk-stage .yk-piece')];
        const status = document.querySelector('.yk-puzzle-status').textContent;
        const real = Number((/\d+/.exec(status) || [0])[0]);
        const strokes = pieces.reduce((n, p) => n + p.querySelectorAll('.yk-piece__ink').length, 0);
        const ghost = document.querySelectorAll('.yk-ghost path').length;
        const inside = pieces.every((p) => { const r = p.getBoundingClientRect(); const s = document.querySelector('.yk-stage').getBoundingClientRect(); return r.right > s.left && r.left < s.right && r.bottom > s.top && r.top < s.bottom; });
        return { word: document.querySelector('.yk-puzzle-word__text').textContent, real, decoys: pieces.length - real, strokes, ghost, inside };
      });
      wordsSeen += 1;
      if (!(info.real >= 2 && info.decoys >= 2 && info.decoys <= 3 && info.ghost >= 7 && info.strokes > info.ghost && info.inside)) broken.push(info);
      await S.page.click('.yk-back-link');
      await S.page.waitForSelector('.yk-word-tile');
    }
    await S.page.click('.yk-back-link');
    await waitTitle(S, '単元を選ぶ');
  }
  check('all: 76 words', wordsSeen === 76, wordsSeen);
  check('all: every board is well formed', broken.length === 0, broken.slice(0, 5));
  // 新しい単元の語を、いくつか最後まで組み立てる
  for (const [unitName, index, word] of [['大地の成り立ちと変化', 5, '初期微動'], ['中世の日本', 6, '元寇'], ['いろいろな生物とその共通点', 6, '葉脈'], ['身のまわりの現象（光・音・力）', 9, '摩擦力']]) {
    await pickUnit(S, unitName);
    await pickWord(S, index);
    await S.page.waitForSelector('.yk-stage .yk-piece');
    await solve(S);
    await waitText(S, '.yk-puzzle-status', 'できました');
    check('new unit: ' + word + ' can be built', (await text(S, '.yk-puzzle-result__word')) === word, await text(S, '.yk-puzzle-result__word'));
    await S.page.click('.yk-puzzle-result .yk-actions .btn-secondary');
    await S.page.click('.yk-back-link');
    await waitTitle(S, '単元を選ぶ');
  }
  await S.context.close();

  // ── 見る画面を作る
  const H = await L.newClient('host');
  const code = await L.createWatch(H);
  check('create: code shape', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await roomWhen(code, (r) => r.meta.hostConnected === true);
  check('create: room is open and connected', room.meta.status === 'open' && room.meta.hostConnected === true && !room.meta.player && !room.meta.seats, room.meta);
  check('create: counted once', (await stats(H, 'room-create')) === 1);
  check('create: session saved', JSON.stringify(await session(H)) === JSON.stringify({ code, role: 'viewer' }));
  check('create: waiting note', (await watchText(H)).includes('まだだれも入っていません'));
  await H.page.click('#btnCopyLink');
  await waitToast(H, '参加用のリンクをコピーしました');
  const link = await H.page.evaluate(() => navigator.clipboard.readText());
  check('create: link carries the code', link === L.BASE + '?room=' + code, link);

  // ── リンクからひらく → 見せずに一人でやる
  const P = await L.newClient('player');
  await L.openInvite(P, code);
  await P.page.click('#btnSolo');
  await waitTitle(P, '単元を選ぶ');
  check('invite: solo removes ?room=', (await P.page.evaluate(() => location.search)) === '');
  check('invite: solo takes no seat', seatOf(await roomOf(code)) === null && (await barText(P)) === null);
  check('invite: solo opens no socket', P.sockets === 0, P.sockets);

  // ── 見せてはじめる
  await L.showVia(P, code);
  await waitBar(P, 'メンターに見せています');
  await waitTitle(P, '単元を選ぶ');
  room = await roomWhen(code, (r) => seatOf(r) && liveOf(r) && liveOf(r).view);
  check('show: seat is mine', seatOf(room) === (await pidOf(P)), room.meta);
  check('show: view is top', liveOf(room).view.name === 'top', room.live);
  check('show: live is kept under my own id only', Object.keys(room.live).join() === (await pidOf(P)), Object.keys(room.live));
  check('show: ?room= removed', (await P.page.evaluate(() => location.search)) === '');
  check('show: counted once', (await stats(P, 'show')) === 1);
  check('show: no create button while showing', !(await visible(P, '#btnCreateWatch')));
  await waitWatch(H, '単元を選んでいます');

  await pickUnit(P, '古代までの日本');
  await waitWatch(H, '語を選んでいます（社会：古代までの日本）');
  await pickWord(P, 8);
  await waitTitle(P, '？田永年私財法');
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '？田永年私財法');
  check('watch: same number of pieces', (await viewerPieces(H)).length === (await playerPieces(P)).length);
  check('watch: same positions at start', await waitSame(P, H));
  check('watch: status', (await text(H, '.yk-watch-body .yk-puzzle-status')) === 'あと3つ');
  check('watch: pieces cannot be grabbed', (await H.page.$$eval('.yk-stage .yk-piece', (els) => els.every((e) => getComputedStyle(e).pointerEvents === 'none'))));
  room = await roomOf(code);
  check('db: decoys are references, not paths', liveOf(room).puzzle.decoys.every((d) => typeof d.c === 'string' && Number.isInteger(d.i)), liveOf(room).puzzle.decoys);

  // にせもの（うしろの2つ）を、もとの字での場所へ → はまらない
  const total = (await playerPieces(P)).length;
  for (const index of [total - 1, total - 2]) {
    const pts = await P.page.evaluate((i) => window.__ykPoints(i), index);
    await P.page.mouse.move(pts.from.x, pts.from.y);
    await P.page.mouse.down();
    await P.page.mouse.move(pts.home.x, pts.home.y, { steps: 5 });
    await P.page.mouse.up();
  }
  check('decoy: does not lock', (await P.page.$$eval('.yk-stage .yk-piece.is-locked', (e) => e.length)) === 0);
  check('decoy: viewer follows', await waitSame(P, H));
  check('decoy: status unchanged', (await text(H, '.yk-watch-body .yk-puzzle-status')) === 'あと3つ');

  // 正しい部品を1つ → はまる
  const firstReal = await P.page.evaluate(() => window.__ykPoints(0));
  await P.page.mouse.move(firstReal.from.x, firstReal.from.y);
  await P.page.mouse.down();
  await P.page.mouse.move(firstReal.home.x + 6, firstReal.home.y + 5, { steps: 6 });
  // 動かしている途中も映る
  await sleep(250);
  const mid = await viewerPieces(H);
  // わくの近くにあって、まだはまっていない部品が3つ（にせもの2つ＋動かしている途中の1つ）
  check('drag: viewer sees the piece moving before the drop', mid.filter((p) => Math.abs(p.x) < 12 && Math.abs(p.y) < 12 && !p.l).length === 3, mid);
  await P.page.mouse.up();
  await waitText(P, '.yk-puzzle-status', 'あと2つ');
  await waitText(H, '.yk-watch-body .yk-puzzle-status', 'あと2つ');
  check('lock: viewer shows it locked in place', (await viewerPieces(H)).filter((p) => p.l && p.x === 0 && p.y === 0).length === 1);
  check('lock: same positions', await waitSame(P, H));

  // 見本を見る
  await P.page.click('.yk-puzzle-tools .btn >> nth=0');
  await H.page.waitForFunction(() => document.querySelector('.yk-ghost').classList.contains('is-on'));
  await H.page.waitForFunction(() => !document.querySelector('.yk-ghost').classList.contains('is-on'), null, { timeout: 6000 });
  check('peek: shown then hidden on the viewer', true);

  // 完成
  await solve(P);
  await waitText(P, '.yk-puzzle-status', 'できました');
  await waitText(H, '.yk-watch-body .yk-puzzle-status', 'できました');
  check('done: viewer result', (await text(H, '.yk-watch-body .yk-puzzle-result__word')) === '墾田永年私財法');
  check('done: viewer has no buttons in the result', (await H.page.$$eval('.yk-watch-body .yk-puzzle-result button', (e) => e.length)) === 0);
  check('done: viewer draws the final strokes', (await H.page.$$eval('.yk-watch-body .yk-final path', (e) => e.length)) === 16);
  check('done: db', liveOf(await roomOf(code)).puzzle.done === true);

  // つぎの語へ・ばらし直す
  await P.page.click('.yk-puzzle-result .yk-actions .btn-primary');
  await waitTitle(P, '？政');
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '？政');
  check('next: fresh board on the viewer', (await text(H, '.yk-watch-body .yk-puzzle-status')) === 'あと3つ' && await waitSame(P, H));
  await P.page.click('.yk-puzzle-tools .btn >> nth=1');
  await sleep(300);
  check('reshuffle: viewer follows', await waitSame(P, H));

  // せまい画面（たて長の盤面）でも、見る側は同じ形で出す
  await P.page.setViewportSize({ width: 375, height: 760 });
  await P.page.click('.yk-puzzle-tools .btn >> nth=1');
  await H.page.waitForFunction(() => document.querySelector('.yk-stage').getAttribute('viewBox') === '0 0 230 250');
  check('narrow: no sideways scroll', (await overflow(P)) <= 0);
  check('narrow: viewer follows', await waitSame(P, H));
  check('narrow: viewer board fits the window', (await H.page.evaluate(() => document.querySelector('.yk-stage').getBoundingClientRect().height <= window.innerHeight * 0.65)));
  await dragLoose(P, 0);
  check('narrow: drag works', await waitSame(P, H));
  await P.page.setViewportSize({ width: 1100, height: 760 });

  // 見せるのをやめる
  await P.page.click('.yk-share-bar__stop');
  await waitToast(P, '見せるのをやめました');
  check('stop: bar hidden', (await barText(P)) === null);
  await waitWatch(H, '相手の画面がとじました');
  room = await roomWhen(code, (r) => emptySeats(r));
  check('stop: seat and live removed, room stays', emptySeats(room) && room.meta.status === 'open', room);
  check('stop: session cleared', (await session(P)) === null);
  check('stop: still playable', (await title(P)) === '？政');

  // もう一度リンクから入る → 遊んでいる途中の画面がそのまま映る
  await L.showVia(P, code);
  await pickUnit(P, '身のまわりの物質');
  await pickWord(P, 0);
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '？度');
  check('rejoin: viewer follows', await waitSame(P, H));

  // ── 別の画面が同じリンクで見せはじめる → あとから入った側に切りかわる
  const Q = await L.newClient('player2');
  await L.showVia(Q, code);
  await waitToast(P, 'ほかの画面で見せはじめた');
  check('replace: old bar hidden', (await barText(P)) === null);
  const pidQ = await pidOf(Q);
  room = await roomWhen(code, (r) => seatOf(r) === pidQ && liveOf(r) && liveOf(r).view && liveOf(r).view.name === 'top' && Object.keys(r.live).length === 1);
  check('replace: seat belongs to the new one', seatOf(room) === pidQ && Object.keys(room.meta.seats).join() === pidQ, room.meta);
  check('replace: the old one cleans up its own live', Object.keys(room.live).join() === pidQ, Object.keys(room.live));
  await waitWatch(H, '単元を選んでいます');
  // 前の画面を閉じても、新しい席は消えない
  await P.page.close();
  await sleep(2500);
  room = await roomOf(code);
  check('replace: closing the old page keeps the new seat', seatOf(room) === pidQ && !!liveOf(room), room);

  // ── おかしな値が届いても、見る画面は止まらない（直接データベースに書かれた場合への備え）
  await pickUnit(Q, '身のまわりの物質');
  await pickWord(Q, 2);
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '溶？');
  const good = liveOf(await roomOf(code));
  const livePath = `${L.ROOMS}/${code}/live/${pidQ}`;
  await rest('PUT', livePath, { view: good.view, puzzle: { ...good.puzzle, w: 'constructor' } });
  await waitWatch(H, '語を選んでいます');
  await rest('PUT', livePath, { view: good.view, puzzle: { ...good.puzzle, w: 999 } });
  await sleep(300);
  check('bad data: unknown word falls back', (await watchText(H)).includes('語を選んでいます'));
  await rest('PUT', livePath, { view: good.view, puzzle: { ...good.puzzle, layout: 'constructor', decoys: [{ c: 'constructor', i: 0 }, { c: '遺', i: 99 }, { c: '遺', i: 'x' }, null], pieces: { 0: { x: 1e9, y: 'a', l: 0 }, 1: 'text', 999999999: { x: 0, y: 0, l: 1 } } } });
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '溶？');
  check('bad data: board still drawn with only the real pieces', (await viewerPieces(H)).length === 3, await viewerPieces(H));
  check('bad data: positions are clamped', (await viewerPieces(H)).every((p) => Math.abs(p.x) <= 400 && Math.abs(p.y) <= 400), await viewerPieces(H));
  check('bad data: default layout', (await H.page.evaluate(() => document.querySelector('.yk-stage').getAttribute('viewBox'))) === '0 0 400 170');
  await rest('PUT', livePath, { view: 'text', puzzle: 5 });
  await waitWatch(H, '単元を選んでいます');
  // ほかの人の id の下に書かれた中身は、見る画面に出ない
  await rest('PUT', `${L.ROOMS}/${code}/live/zzzzzzzzzzzz`, good);
  await sleep(400);
  check('bad data: live of someone else is ignored', (await watchText(H)).includes('単元を選んでいます'));
  await rest('DELETE', `${L.ROOMS}/${code}/live/zzzzzzzzzzzz`);
  await Q.page.click('.yk-back-link');
  await waitWatch(H, '語を選んでいます（理科：身のまわりの物質）');
  await Q.page.click('.yk-back-link');
  await waitWatch(H, '単元を選んでいます');

  // ── メンターが「とじる」
  await pickUnit(Q, '身のまわりの物質');
  await pickWord(Q, 1);
  await waitText(H, '.yk-watch-body .yk-puzzle-word__text', '？質');
  await H.page.click('#btnCloseWatch');
  await waitTitle(H, '単元を選ぶ');
  await waitToast(Q, 'メンターが見る画面をとじました');
  check('close: bar hidden on the player', (await barText(Q)) === null);
  check('close: player keeps playing', (await title(Q)) === '？質');
  await dragLoose(Q, 0);
  await sleep(1500);
  check('close: room is gone and stays gone', (await roomOf(code)) === null);
  check('close: sessions cleared', (await session(H)) === null && (await session(Q)) === null);

  // ── 見せる人が切りかわったら、新しい人の中身がまだ空でも、前の人の盤面を出したままにしない
  const H5 = await L.newClient('host5');
  const code5 = await L.createWatch(H5);
  const P5 = await L.newClient('player5');
  await L.showVia(P5, code5);
  await pickUnit(P5, '身のまわりの物質');
  await pickWord(P5, 5);
  await waitText(H5, '.yk-watch-body .yk-puzzle-word__text', '再結？');
  await rest('PATCH', `${L.ROOMS}/${code5}/meta`, { player: 'yyyyyyyyyyyy', seats: { yyyyyyyyyyyy: { uid: 'x', joinedAt: 1 } } });
  await waitWatch(H5, '単元を選んでいます');
  check('switch: the old board is taken down at once', (await H5.page.$$eval('.yk-watch-body .yk-stage', (e) => e.length)) === 0);
  await waitToast(P5, 'ほかの画面で見せはじめた');
  check('switch: the old player stops showing', (await barText(P5)) === null && (await session(P5)) === null);
  room = await roomWhen(code5, (r) => !r.live);
  check('switch: the old player removes only its own live', !room.live && room.meta.player === 'yyyyyyyyyyyy' && !!room.meta.seats.yyyyyyyyyyyy, room);
  await H5.page.click('#btnCloseWatch');
  await waitTitle(H5, '単元を選ぶ');
  check('switch: room closed', (await roomWhen(code5, (r) => r === null)) === null);

  // ── 正しくないリンク・ないルームのリンク
  const B = await L.newClient('badlink');
  await open(B, '?room=' + encodeURIComponent('あいう'));
  await waitToast(B, 'ルームコードが正しくありません');
  check('bad link: top, ?room= removed', (await title(B)) === '単元を選ぶ' && (await B.page.evaluate(() => location.search)) === '');
  await L.openInvite(B, 'abcdef'); // 小文字でも読む
  await B.page.click('#btnShow');
  await waitTitle(B, 'このリンクのルームは、もうとじています');
  check('gone link: no room is created', (await roomOf('ABCDEF')) === null);
  check('gone link: no bar, no session', (await barText(B)) === null && (await session(B)) === null);
  await B.page.click('.yk-invite .btn-primary');
  await waitTitle(B, '単元を選ぶ');
  check('gone link: ?room= removed after choosing solo', (await B.page.evaluate(() => location.search)) === '');

  check('nothing left in the database', (await rest('GET', L.ROOMS)) === null, await rest('GET', L.ROOMS));
  await L.finishAll(server);
})().catch((error) => { console.error(error); process.exit(2); });
