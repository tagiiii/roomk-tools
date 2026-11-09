// すとんブロック E2E その5: じゃまを送る相手を選ぶ（2026-11-09 フィードバック）
// ほかの人の盤（広い画面）・一覧（スマホ）を押すと、その人へじゃまを送る。はじめは並びのつぎの人。もう一度押すともどる。
// ここまでの人は選べない・押したあとスペースでボタンが押されない
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, text, visible, waitText, waitFor, key, shot, overflow, ROOMS } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const targetOf = (c, sel) => c.page.$$eval(sel + ' .sb-target.is-target', (els) => els.map((el) => el.querySelector('.sb-mini__name, .sb-otherlist__name')?.textContent));
const clickTarget = (c, sel, name) => c.page.evaluate(([s, n]) => {
  const btn = [...document.querySelectorAll(s + ' .sb-target')].find((el) => el.querySelector('.sb-mini__name, .sb-otherlist__name')?.textContent === n);
  btn.click();
  return true;
}, [sel, name]);

// name の盤を「左はしだけあいた4段」にして読み込み直す（つぎに I が来る所から）。たての棒で4段消せる
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
  await H.page.click('#btnStartGame');
  await Promise.all([H, A, B].map((c) => waitFalling(c)));
  let room = await roomOf(code);
  const R = room.round;
  check('T0 並びは メンター・あおい・はる', JSON.stringify(R.players) === JSON.stringify(['メンター', 'あおい', 'はる']), R.players);

  // ── 広い画面: ほかの人の盤を押して選ぶ ──
  check('T1 「押した人にじゃまを送る」が出る', await waitFor(() => visible(A, '#othersHint')));
  check('T2 ほかの人の盤がボタンになる', (await A.page.$$('#others .sb-target')).length === 2);
  check('T3 はじめは並びのつぎの人（はる）に「送る」', JSON.stringify(await targetOf(A, '#others')) === '["はる"]' && (await text(A, '#others .is-target .sb-target__tag')) === '送る');
  await clickTarget(A, '#others', 'メンター');
  check('T4 押すと、その人（メンター）が送る相手になる', JSON.stringify(await targetOf(A, '#others')) === '["メンター"]');
  check('T5 押したあとボタンにフォーカスが残らない（スペースはすとんのまま）', await A.page.evaluate(() => !document.activeElement?.classList?.contains('sb-target')));
  await A.page.waitForTimeout(300);
  check('T6 選んだ相手は、ほかの人の盤が描きなおされても残る', JSON.stringify(await targetOf(A, '#others')) === '["メンター"]');

  // メンターを選んだまま4段消す → メンターに4段届く（並びのつぎの はる には届かない）
  await setFourWell(A, code, R, 'あおい');
  check('T7 読み込み直すと、送る相手は並びのつぎの人にもどる', JSON.stringify(await targetOf(A, '#others')) === '["はる"]');
  await clickTarget(A, '#others', 'メンター');
  await dropFour(A);
  room = await roomWhen(code, (r) => Number(r.boards?.['あおい']?.sent) === 4);
  check('T8 選んだ相手（メンター）にじゃまが届く', await waitFor(async () => (await text(H, '#playJama')) === '4段'));
  check('T9 並びのつぎの人（はる）には届かない', (await text(B, '#playJama')) === '0段' && !(room.jama && room.jama['はる']), room.jama);

  // もう一度押すと、並びのつぎの人にもどる
  await clickTarget(A, '#others', 'メンター');
  check('T10 同じ人をもう一度押すと、並びのつぎの人にもどる', JSON.stringify(await targetOf(A, '#others')) === '["はる"]');
  await shot(A, 'e2e5-target-wide');

  // ── スマホ: 名前の一覧を押して選ぶ ──
  await A.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('T11 375px は一覧がボタンになる（盤のならびとヒントは出さない）', (await A.page.$$('#othersList .sb-target')).length === 2 && !(await visible(A, '#othersHint')) && !(await visible(A, '#othersCol')));
  check('T12 375px も送る相手に印（枠の色。「送る」の文字はせまいので出さない）', JSON.stringify(await targetOf(A, '#othersList')) === '["はる"]');
  await clickTarget(A, '#othersList', 'メンター');
  check('T13 375px で押すと送る相手が変わる', JSON.stringify(await targetOf(A, '#othersList')) === '["メンター"]');
  check('T14 375px で横にはみ出さない', (await overflow(A)) <= 0);
  await shot(A, 'e2e5-target-375');
  await A.page.setViewportSize({ width: 1280, height: 900 });
  await sleep(300);

  // ── ここまでの人は選べない。選んでいた人がここまでになったら、並びのつぎの人へ ──
  await clickTarget(A, '#others', 'はる');
  check('T15 はるを選ぶ', JSON.stringify(await targetOf(A, '#others')) === '["はる"]');
  await clickTarget(A, '#others', 'メンター');
  for (let i = 0; i < 60 && !(await visible(B, '#playNote')); i++) { await key(B, 'Space'); await sleep(40); }
  await roomWhen(code, (r) => r.boards?.['はる']?.out === true);
  check('T16 ここまでの人のボタンは押せない', await waitFor(() => A.page.$$eval('#others .sb-target', (els) => els.some((el) => el.disabled && el.textContent.includes('はる')))));
  check('T17 選んだ人（メンター）はそのまま', JSON.stringify(await targetOf(A, '#others')) === '["メンター"]');
  check('T18 エラーなし', A.errors.length === 0 && H.errors.length === 0 && B.errors.length === 0, A.errors.concat(H.errors, B.errors));
  await sleep(300);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
