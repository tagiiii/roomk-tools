// すとんブロック E2E その7: ねらってきた人みんなに送る（2026-11-10 フィードバック）
// 自分をねらっている人に「ねらってる」の印・人数が出る。「ねらってきた人みんなに送る」を押すと、その全員に同じ段の数が届く。
// 選んだもの（boards/{名前}/to）をほかの人の画面でも数える・もう一度押すともどる・375px
// 対戦では、2人いじょうにねらわれていると送るじゃまが増える（2人で＋1・3人で＋2）
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, text, visible, waitText, waitFor, key, shot, overflow, ROOMS } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const namesOf = (c, sel, cls) => c.page.$$eval(sel + ' .sb-target' + cls, (els) => els.map((el) => el.querySelector('.sb-mini__name, .sb-otherlist__name')?.textContent).sort());
const aimersOf = (c, sel) => c.page.$$eval(sel + ' .sb-target', (els) => els.filter((el) => el.querySelector('.sb-target__aim')).map((el) => el.querySelector('.sb-mini__name, .sb-otherlist__name')?.textContent).sort());
const clickTarget = (c, sel, name) => c.page.evaluate(([s, n]) => {
  [...document.querySelectorAll(s + ' .sb-target')].find((el) => el.querySelector('.sb-mini__name, .sb-otherlist__name')?.textContent === n).click();
}, [sel, name]);
const same = (a, b) => JSON.stringify(a) === JSON.stringify([...b].sort());

async function setFourWell(c, code, R, name) {
  const well = E.emptyBoard();
  for (let y = E.H - 4; y < E.H; y++) for (let x = 1; x < E.W; x++) well[y][x] = 'jama';
  well[E.H - 5][8] = 'jama';
  const b = E.packBoard(well);
  let taken = 1;
  for (; taken < 40; taken++) if (E.restoreGame({ seed: R.seed, onFull: 'end' }, { b, taken }).piece.kind === 'I') break;
  await rest('PUT', `${ROOMS}/${code}/boards/${name}`, { round: R.id, b, lines: 0, pieces: 0, resets: 0, taken, hold: null, holdUsed: false, b2b: false, combo: -1, sent: 0, pending: 0, done: false, out: false });
  await c.page.reload();
  await waitFalling(c);
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const vp = { viewport: { width: 1280, height: 900 } };
  const H = await L.newClient('host', vp);
  const A = await L.newClient('aoi', vp);
  const B = await L.newClient('haru', vp);
  const C = await L.newClient('sora', vp);
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'はる', code);
  await L.joinRoom(C, 'そら', code);
  await waitText(H, '#lobbyPeople', 'そら');
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  await H.page.click('label:has(input[name="roomTime"][value="0"])');
  await roomWhen(code, (r) => r.settings.mode === 'battle' && r.settings.time === 0);
  await H.page.click('#btnStartGame');
  await Promise.all([H, A, B, C].map((c) => waitFalling(c)));
  let room = await roomOf(code);
  const R = room.round;
  check('U0 並びは メンター・あおい・はる・そら', JSON.stringify(R.players) === JSON.stringify(['メンター', 'あおい', 'はる', 'そら']), R.players);

  // あおいの盤を4段消せる形にしてから（読み込み直すと選んだものはもどる）
  await setFourWell(A, code, R, 'あおい');
  check('U1 「ねらってきた人みんなに送る」が出る', await waitFor(() => visible(A, '#counterBtn')));
  check('U2 はじめは並びの前の人（メンター）だけが自分をねらっている', await waitFor(async () => same(await aimersOf(A, '#others'), ['メンター'])) && (await text(A, '#counterBtn')).includes('いま 1人'));

  // はるが あおい を選ぶ → あおいの画面で2人に
  await clickTarget(B, '#others', 'あおい');
  room = await roomWhen(code, (r) => r.boards?.['はる']?.to === 'あおい');
  check('U3 選んだ相手を自分の盤に書く（boards/はる/to）', room.boards['はる'].to === 'あおい' && Number(room.boards['はる'].round) === R.id);
  check('U4 あおいの画面で、ねらっている人が2人（メンター・はる）になる', await waitFor(async () => same(await aimersOf(A, '#others'), ['メンター', 'はる']) && (await text(A, '#counterBtn')).includes('いま 2人')));
  check('U4b 2人にねらわれていると、ボタンに「送るじゃま＋1」', (await text(A, '#counterBtn')).includes('送るじゃま＋1'), await text(A, '#counterBtn'));

  // あおいが「ねらってきた人みんなに送る」
  await A.page.click('#counterBtn');
  check('U5 押すと、ねらってきた2人が送る相手になる', same(await namesOf(A, '#others', '.is-target'), ['メンター', 'はる']) && (await A.page.getAttribute('#counterBtn', 'aria-pressed')) === 'true');
  check('U6 押したあとボタンにフォーカスが残らない', await A.page.evaluate(() => document.activeElement?.id !== 'counterBtn'));
  room = await roomWhen(code, (r) => r.boards?.['あおい']?.to === '*');
  check('U7 「みんな」を選んだことを自分の盤に書く', room.boards['あおい'].to === '*');
  // メンターの画面: あおいは「みんな」でメンターにも送るので、メンターをねらっているのは そら（並び）と あおい
  check('U8 ほかの人の画面でも、みんなに送る人をねらっている人として数える', await waitFor(async () => same(await aimersOf(H, '#others'), ['そら', 'あおい'])));
  await shot(A, 'e2e7-counter-wide');

  await key(A, 'ArrowUp');
  await key(A, 'ArrowLeft', 5);
  await key(A, 'Space');
  room = await roomWhen(code, (r) => Number(r.boards?.['あおい']?.sent) === 10);
  check('U9 4段消すと、2人にねらわれているので＋1して、2人に5段ずつ（送ったじゃまは10）', Number(room.boards['あおい'].sent) === 10);
  check('U10 メンターとはるに5段ずつ届く', await waitFor(async () => (await text(H, '#playJama')) === '5段' && (await text(B, '#playJama')) === '5段'));
  check('U11 ねらっていない そら には届かない', (await text(C, '#playJama')) === '0段');
  check('U12 一言は「2人にねらわれて＋1」「2人に5段ずつおくったよ」', (await text(A, '#playNote')).includes('2人にねらわれて＋1') && (await text(A, '#playNote')).includes('2人に5段ずつおくったよ'), await text(A, '#playNote'));

  await A.page.click('#counterBtn');
  check('U13 もう一度押すと、並びのつぎの人（はる）にもどる', same(await namesOf(A, '#others', '.is-target'), ['はる']) && (await A.page.getAttribute('#counterBtn', 'aria-pressed')) === 'false');
  room = await roomWhen(code, (r) => !r.boards?.['あおい']?.to);
  check('U14 もどしたら盤の to も消える', !room.boards['あおい'].to);

  // 3人にねらわれると＋2（そらも あおい を選ぶ）。あおいは並びのつぎの はる へ
  await clickTarget(C, '#others', 'あおい');
  await roomWhen(code, (r) => r.boards?.['そら']?.to === 'あおい');
  await setFourWell(A, code, R, 'あおい');
  check('U14b 3人にねらわれている', await waitFor(async () => same(await aimersOf(A, '#others'), ['メンター', 'はる', 'そら']) && (await text(A, '#counterBtn')).includes('送るじゃま＋2')));
  await key(A, 'ArrowUp');
  await key(A, 'ArrowLeft', 5);
  await key(A, 'Space');
  room = await roomWhen(code, (r) => Number(r.boards?.['あおい']?.sent) === 6);
  check('U14c 3人にねらわれて4段消すと6段（4＋2）', Number(room.boards['あおい'].sent) === 6 && (await text(A, '#playNote')).includes('3人にねらわれて＋2'), await text(A, '#playNote'));
  await clickTarget(C, '#others', 'あおい');
  await roomWhen(code, (r) => !r.boards?.['そら']?.to);

  // ── 375px ──
  await A.page.click('#counterBtn');
  await A.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('U15 375px は一覧の上に「ねらってきた人みんなに送る」', await visible(A, '#counterBtn') && await A.page.evaluate(() => document.getElementById('counterBtn').nextElementSibling?.id === 'othersList') && (await text(A, '#counterBtn')).includes('ねらう人 2人'));
  check('U16 375px の一覧でも、ねらっている人に印・送る相手に枠', same(await aimersOf(A, '#othersList'), ['メンター', 'はる']) && same(await namesOf(A, '#othersList', '.is-target'), ['メンター', 'はる']));
  check('U17 375px で横にはみ出さない・1画面に収まる', (await overflow(A)) <= 0 && await L.fitsHeight(A));
  await shot(A, 'e2e7-counter-375');
  check('U18 エラーなし', [H, A, B, C].every((c) => c.errors.length === 0), [H, A, B, C].flatMap((c) => c.errors));
  await sleep(300);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
