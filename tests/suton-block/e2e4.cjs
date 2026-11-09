// すとんブロック E2E その4: 対戦（設定の出し分け・時間なし・ここまでになった人をとばしてじゃまを送る・
// 4段消しで4段送る・来るじゃまが入る・退出でここまで・のこった人が上）・からにしてつづける対戦・段の数をくらべるときの結果
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, text, visible, waitScreen, waitText, overflow, waitFor, key, shot, ROOMS } = L;

// 対戦は時間なしにできるので、残り時間ではなく、カウントダウンが終わったことで落ちはじめたと見る
const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const rankText = (c) => c.page.$$eval('.sb-rank li', (lis) => lis.map((li) => li.textContent));

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('haru');
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'はる', code);
  await waitText(H, '#lobbyPeople', 'はる');

  // ── 設定の出し分け ──
  check('B1 はじめは段の数をくらべる（いっぱいの設定・時間なしは出さない）', !(await visible(H, '#fsFull')) && (await visible(H, '#fsJama')) && !(await visible(H, '#timeNone')));
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  check('B2 対戦にすると「盤がいっぱいになったら」と時間なしが出て、じゃまの設定はかくれる', await waitFor(async () => (await visible(H, '#fsFull')) && !(await visible(H, '#fsJama')) && (await visible(H, '#timeNone'))));
  await H.page.click('label:has(input[name="roomTime"][value="0"])');
  await waitText(A, '#lobbySettings', '対戦・いっぱいでここまで・時間なし');
  check('B3 参加者に対戦の設定が出る', true);
  let room = await roomWhen(code, (r) => r.settings.mode === 'battle' && r.settings.time === 0);
  check('B4 設定がルームに入る', room.settings.mode === 'battle' && room.settings.full === 'out' && room.settings.time === 0, room.settings);
  await H.page.setViewportSize({ width: 375, height: 812 });
  check('B5 375px でホストの設定が横にはみ出さない', (await overflow(H)) <= 0);
  await shot(H, 'e2e4-lobby-battle-375');
  await H.page.setViewportSize({ width: 1280, height: 900 });

  // ── 対戦（ここまで・時間なし）──
  await H.page.click('#btnStartGame');
  await Promise.all([H, A, B].map((c) => waitFalling(c)));
  room = await roomOf(code);
  const R = room.round;
  check('B6 回に対戦の設定が入る（じゃまはいつもあり）', R.mode === 'battle' && R.full === 'out' && R.time === 0 && R.jama === true, R);
  check('B7 時間なしは残り時間を出さない', !(await visible(A, '#playTimer')));
  check('B8 対戦は「送ったじゃま」と「来るじゃま」を出す', (await text(A, '#playLinesLabel')) === '送ったじゃま' && (await visible(A, '#jamaBox')));
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await waitScreen(W, 'watch');
  check('B9 みんなにみせる画面は「時間なし」', await waitFor(async () => (await text(W, '#watchTimer')) === '時間なし'));

  // はる（並びの3人目）が、すとんを続けて盤をいっぱいにする → はるはここまで
  for (let i = 0; i < 60 && !(await visible(B, '#playNote')); i++) { await key(B, 'Space'); await sleep(40); }
  check('B10 いっぱいになった人は「ここまで」', await waitFor(async () => (await text(B, '#playNote')).includes('ここまで')));
  room = await roomWhen(code, (r) => r.boards?.['はる']?.out === true);
  check('B11 ここまでになった人の盤に out と時刻', room.boards['はる'].out === true && room.boards['はる'].outAt > 0, room.boards['はる']);
  check('B12 2人のこっているので、まだ結果にならない', room.status === 'play');
  check('B13 ほかの人の盤に「ここまで」', await waitFor(async () => (await text(H, '#others')).includes('はる') && (await text(H, '#others')).includes('ここまで')));

  // あおいの盤を「左はしだけあいた4段」にして読み込み直し、たての棒で4段消す → 4段送る。
  // つぎの人ははる（ここまで）なので、とばしてメンターへ
  await key(A, 'Space');
  await sleep(300);
  const well = E.emptyBoard();
  for (let y = E.H - 4; y < E.H; y++) for (let x = 1; x < E.W; x++) well[y][x] = 'jama';
  well[E.H - 5][8] = 'jama';
  const b = E.packBoard(well);
  let taken = 1;
  for (; taken < 40; taken++) if (E.restoreGame({ seed: R.seed, onFull: 'end' }, { b, taken }).piece.kind === 'I') break;
  await rest('PUT', `${ROOMS}/${code}/boards/あおい`, { round: R.id, b, lines: 0, pieces: 0, resets: 0, taken, hold: null, holdUsed: false, b2b: false, combo: -1, sent: 0, pending: 0, done: false, out: false });
  await A.page.reload();
  await waitFalling(A);
  await key(A, 'ArrowUp');
  await key(A, 'ArrowLeft', 5);
  await key(A, 'Space');
  room = await roomWhen(code, (r) => Number(r.boards?.['あおい']?.sent) === 4);
  check('B14 4段消すと4段送る', Number(room.boards?.['あおい']?.sent) === 4 && Number(room.boards['あおい'].lines) === 4, room.boards?.['あおい']);
  check('B15 送ったじゃまの数が出る', await waitFor(async () => (await text(A, '#playLines')) === '4'));
  check('B16 ひとことが出る（4段消しの一言が先頭）', (await text(A, '#playNote')).startsWith('4段すとん！') && (await text(A, '#playNote')).includes('4段おくったよ'));
  // 一言は小さく左上に（2026-11-09 フィードバック）。広い画面は盤の外の左で、盤の上のはしにそろえて1行
  const nr = await A.page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const n = r('playNote'); const b = r('board');
    return { right: n.right, top: n.top, h: n.height, left: b.left, btop: b.top };
  });
  check('B16b 一言は盤の外の左・盤の上のはしにそろえて1行', nr.right <= nr.left && Math.abs(nr.top - nr.btop) < 2 && nr.h < 34, nr);
  check('B17 ここまでの人をとばして、つぎののこっている人に届く', await waitFor(async () => (await text(H, '#playJama')) === '4段'));
  check('B18 ここまでの人には届かない', !(room.jama && room.jama['はる']));
  await key(H, 'Space');
  room = await roomWhen(code, (r) => (r.boards?.['メンター']?.b || '').slice(-40).split('j').length - 1 === 36);
  check('B19 消さずに置くと、来るじゃまが盤の下に4段入る', (room.boards?.['メンター']?.b || '').slice(-40).split('j').length - 1 === 36);

  // ここまでになったのを知る前に送られたじゃま（はるあて）は、はるのつぎののこっている人（メンター）が受けとる
  await rest('POST', `${ROOMS}/${code}/jama/はる`, { round: R.id, rows: 2, from: 'test' });
  check('B19b ここまでの人あてに届いたじゃまは、つぎののこっている人が受けとる', await waitFor(async () => (await text(H, '#playJama')) === '2段'));
  room = await roomWhen(code, (r) => !r.jama?.['はる']);
  check('B19c 受けとったら消える', !room.jama?.['はる'], room.jama);

  // 盤の上の見えない段: じゃまで盤より上へ押し上げられても、出る所があいていればつづく（2026-11-06）
  // メンターの盤を、左はしの列だけ1〜19段目までうめたものにして読み込み直す（来るじゃま2段はそのまま）
  room = await roomOf(code);
  const mb = room.boards['メンター'];
  const tall = Array.from({ length: E.H }, (_, y) => (y >= 1 ? 'j' : '.') + '.'.repeat(E.W - 1)).join('');
  await rest('PUT', `${ROOMS}/${code}/boards/メンター`, { ...mb, b: tall, h: null, pending: 2 });
  await H.page.reload();
  await waitFalling(H);
  check('B19d 読み込み直すと来るじゃま2段', await waitFor(async () => (await text(H, '#playJama')) === '2段'));
  await key(H, 'Space');
  room = await roomWhen(code, (r) => Number(r.boards?.['メンター']?.pieces) === Number(mb.pieces) + 1);
  const m2 = room.boards['メンター'];
  check('B19e じゃまで盤より上へ押し上げられても、出る所があいていればここまでにならない', m2.out === false && !(await text(H, '#playNote')).includes('ここまで'), m2);
  check('B19f 盤より上へ出たマスは、見えない段として送る', typeof m2.h === 'string' && m2.h.length === E.W * E.HB && m2.h[(E.HB - 1) * E.W] === 'j' && m2.b[0] === 'j', m2.h);
  await H.page.reload();
  await waitFalling(H);
  await key(H, 'Space');
  room = await roomWhen(code, (r) => Number(r.boards?.['メンター']?.pieces) === Number(mb.pieces) + 2);
  check('B19g 読み込み直しても、見えない段のマスは残る', (room.boards['メンター'].h || '')[(E.HB - 1) * E.W] === 'j', room.boards['メンター'].h);
  await shot(H, 'e2e4-top-rows');

  // あおいが回の途中で出る → あおいもここまで → のこりはメンターだけで結果
  await A.page.click('#btnPlayEnd');
  await waitScreen(A, 'top');
  await waitScreen(H, 'result', 8000);
  room = await roomOf(code);
  check('B20 のこりが1人になると結果', room.status === 'result' && room.result.mode === 'battle');
  const rowA = room.result.rows.find((r) => r.name === 'あおい');
  check('B21 途中で出た人はここまでになる', rowA && rowA.out === true && rowA.sent === 4, rowA);
  const ranks = await rankText(H);
  check('B22 のこった人が1位・あとまでのこった人が上', ranks.length === 3 && ranks[0].startsWith('1位メンター') && ranks[0].includes('のこった')
    && ranks[1].startsWith('2位あおい') && ranks[1].includes('送った 4段') && ranks[2].startsWith('3位はる') && ranks[2].includes('ここまで'), ranks);
  await shot(H, 'e2e4-result-battle-out');
  await waitScreen(W, 'result');
  check('B23 みんなにみせる画面も結果', (await rankText(W)).length === 3);

  // ── 対戦（からにしてつづける）──
  await H.page.click('#btnAgain');
  await waitScreen(H, 'waiting');
  await H.page.click('label:has(input[name="roomFull"][value="clear"])');
  room = await roomWhen(code, (r) => r.settings.full === 'clear');
  check('B24 からにしてつづけるにすると、時間なしは3分にもどる', room.settings.time === 180 && !(await visible(H, '#timeNone')), room.settings);
  await H.page.click('#btnStartGame');
  await Promise.all([H, B].map((c) => L.waitPlaying(c)));
  for (let i = 0; i < 80; i++) {
    await key(B, 'Space');
    await sleep(30);
    if (i % 10 === 9 && Number((await roomOf(code)).boards?.['はる']?.resets) >= 1) break;
  }
  room = await roomWhen(code, (r) => Number(r.boards?.['はる']?.resets) >= 1);
  check('B25 からにしてつづける対戦は、いっぱいでもつづく', Number(room.boards?.['はる']?.resets) >= 1 && room.boards['はる'].out === false && room.status === 'play');
  await H.page.click('#btnPlayEnd');
  await waitScreen(H, 'result', 8000);
  const ranks2 = await rankText(H);
  check('B26 結果に、送ったじゃまと、からにした回数', ranks2.length === 2 && ranks2.every((t) => t.includes('送った') && t.includes('からにした')) && ranks2.some((t) => t.includes('はる') && !t.includes('からにした 0回')), ranks2);

  // ── 段の数をくらべる: 結果にからにした回数も出る ──
  await H.page.click('#btnAgain');
  await waitScreen(H, 'waiting');
  await H.page.click('label:has(input[name="roomMode"][value="lines"])');
  await roomWhen(code, (r) => r.settings.mode === 'lines');
  await H.page.click('#btnStartGame');
  await Promise.all([H, B].map((c) => L.waitPlaying(c)));
  check('B27 段の数をくらべるときは「消した段」', (await text(B, '#playLinesLabel')) === '消した段');
  await H.page.click('#btnPlayEnd');
  await waitScreen(H, 'result', 8000);
  const ranks3 = await rankText(H);
  check('B28 段の数をくらべる結果にも、からにした回数', ranks3.length === 2 && ranks3.every((t) => /\d+段$/.test(t) && t.includes('からにした 0回')), ranks3);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
