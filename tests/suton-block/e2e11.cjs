// すとんブロック E2E その11: はじめの送る相手は、最後にじゃまを送ってきた人（2026-11-13 フィードバック）
// まだだれからも来ていなければ並びのつぎ・送ってきた人がいればその人（boards/{名前}/back）・ほかの人の画面の「ねらってる」も同じに数える・
// 読み込み直しても戻る・押して選ぶ／もう一度押すと、はじめの送り方にもどる・送ってきた人がここまでになったら並びのつぎ
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, text, visible, waitText, waitFor, key, shot } = L;
const { ROOMS } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const targetOf = (c) => c.page.$$eval('#others .sb-target.is-target', (els) => els.map((el) => el.querySelector('.sb-mini__name')?.textContent));
const aimersOf = (c) => c.page.$$eval('#others .sb-target', (els) => els.filter((el) => el.querySelector('.sb-target__aim')).map((el) => el.querySelector('.sb-mini__name')?.textContent));
const clickTarget = (c, name) => c.page.evaluate((n) => {
  [...document.querySelectorAll('#others .sb-target')].find((el) => el.querySelector('.sb-mini__name')?.textContent === n).click();
  return true;
}, name);

// name の盤を「左はしだけあいた4段」にして読み込み直す（つぎに I が来る所から）。extra は盤に足すもの（back など）
async function setFourWell(c, code, R, name, extra = {}) {
  const well = E.emptyBoard();
  for (let y = E.H - 4; y < E.H; y++) for (let x = 1; x < E.W; x++) well[y][x] = 'jama';
  well[E.H - 5][8] = 'jama';
  const b = E.packBoard(well);
  let taken = 1;
  for (; taken < 40; taken++) if (E.restoreGame({ seed: R.seed, onFull: 'end' }, { b, taken }).piece.kind === 'I') break;
  await rest('PUT', `${ROOMS}/${code}/boards/${name}`, { round: R.id, b, lines: 0, pieces: 0, resets: 0, taken, hold: null, holdUsed: false, b2b: false, combo: -1, sent: 0, pending: 0, done: false, out: false, ...extra });
  await c.page.reload();
  await waitFalling(c);
}
async function dropFour(c) {
  await key(c, 'ArrowUp');
  await key(c, 'ArrowLeft', 5);
  await key(c, 'Space');
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1280, height: 900 } });
  const A = await L.newClient('aoi', { viewport: { width: 1280, height: 900 } });
  const B = await L.newClient('haru', { viewport: { width: 1280, height: 900 } });
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'はる', code);
  await waitText(H, '#lobbyPeople', 'はる');
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  await H.page.click('label:has(input[name="roomTime"][value="0"])');
  await roomWhen(code, (r) => r.settings.mode === 'battle' && r.settings.time === 0);
  check('K0 待合室の説明に「送る相手は、じゃまを送ってきた人」', (await text(H, '#modeNote')).includes('じゃまを送ってきた人'));
  await H.page.click('#btnStartGame');
  await Promise.all([H, A, B].map((c) => waitFalling(c)));
  const R = (await roomOf(code)).round;
  check('K1 並びは メンター・あおい・はる', JSON.stringify(R.players) === JSON.stringify(['メンター', 'あおい', 'はる']), R.players);
  check('K2 まだだれからも来ていなければ、並びのつぎの人（はる）に「送る」', await waitFor(async () => JSON.stringify(await targetOf(A)) === '["はる"]'));

  // メンターがいつもの相手（並びのつぎ＝あおい）へ4段送る
  await setFourWell(H, code, R, 'メンター');
  await dropFour(H);
  check('K3 あおいに4段届く', await waitFor(async () => (await text(A, '#playJama')) === '4段'));
  check('K4 送ってきた人を盤に書く（boards/あおい/back）', (await roomWhen(code, (r) => r.boards?.['あおい']?.back === 'メンター')).boards['あおい'].back === 'メンター');
  check('K5 あおいの送る相手が、送ってきた人（メンター）になる', await waitFor(async () => JSON.stringify(await targetOf(A)) === '["メンター"]'));
  check('K6 メンターの画面で、あおいに「ねらってる」が付く（back を同じに数える）', await waitFor(async () => (await aimersOf(H)).includes('あおい')), await aimersOf(H));
  check('K7 はるの画面でも、あおいの送る相手はメンター（はるをねらっていない）', await waitFor(async () => !(await aimersOf(B)).includes('あおい')), await aimersOf(B));
  await shot(A, 'e2e11-back');

  // 読み込み直しても、送ってきた人のまま
  await A.page.reload();
  await waitFalling(A);
  check('K8 読み込み直しても、送る相手は送ってきた人（メンター）', await waitFor(async () => JSON.stringify(await targetOf(A)) === '["メンター"]'));

  // 押して選ぶ → もう一度押すと、はじめの送り方（送ってきた人）にもどる
  await clickTarget(A, 'はる');
  check('K9 押すと、その人（はる）が送る相手になる', JSON.stringify(await targetOf(A)) === '["はる"]');
  await clickTarget(A, 'はる');
  check('K10 もう一度押すと、送ってきた人（メンター）にもどる', JSON.stringify(await targetOf(A)) === '["メンター"]');

  // あおいが4段消すと、送ってきたメンターへ（並びのつぎの はる には届かない）
  await setFourWell(A, code, R, 'あおい', { back: 'メンター' });
  check('K11 盤の back から戻る', await waitFor(async () => JSON.stringify(await targetOf(A)) === '["メンター"]'));
  const jCount = (r) => (r.boards['メンター'].b.match(/j/g) || []).length;
  const j0 = jCount(await roomOf(code));
  await dropFour(A);
  const room = await roomWhen(code, (r) => Number(r.boards?.['あおい']?.sent) === 4);
  check('K12 送ってきた人（メンター）にじゃまが届く', await waitFor(async () => (await text(H, '#playJama')) === '4段' || jCount(await roomOf(code)) > j0));
  check('K13 並びのつぎの人（はる）には届かない', (await text(B, '#playJama')) === '0段' && !(room.jama && room.jama['はる']), room.jama);

  // 送ってきた人がここまでになったら、並びのつぎの人へ
  for (let i = 0; i < 80 && !(await roomOf(code)).boards?.['メンター']?.out; i++) { await key(H, 'Space'); await sleep(40); }
  await roomWhen(code, (r) => r.boards?.['メンター']?.out === true);
  check('K14 送ってきた人がここまでなら、並びのつぎの人（はる）へ', await waitFor(async () => JSON.stringify(await targetOf(A)) === '["はる"]'));
  check('K15 エラーなし', A.errors.length === 0 && H.errors.length === 0 && B.errors.length === 0, A.errors.concat(H.errors, B.errors));
  await sleep(300);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
