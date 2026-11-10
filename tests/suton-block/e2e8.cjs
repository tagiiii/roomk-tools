// すとんブロック E2E その8: じゃまを送ったときの見せ方（2026-11-10 フィードバック「送るボタンはあるけど送った感がない」）
// 送ると、自分の盤から相手の盤へ「＋◯段」が飛び、着いたら相手の盤が揺れて「＋◯段」が出る。ルームの更新で欄を作りなおしても続く。
// 受けた人は来るじゃまの数がはずむ。375px は名前の一覧へ飛ぶ
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomOf, roomWhen, text, waitText, waitFor, key, shot, overflow, ROOMS } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
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
// 送ったあとの様子を、短い間かくで記録する（飛ぶ印・揺れ・「＋◯段」の印・受けた人の数のはずみ）
function watchFx(c, sel) {
  return c.page.evaluate((s) => new Promise((resolve) => {
    const seen = { fly: '', hitName: '', hitTag: '', hitRerendered: false, firstHitEl: null, hitGoneAt: 0, hitAt: 0 };
    const t0 = performance.now();
    const iv = setInterval(() => {
      const fly = document.querySelector('.sb-sendfx');
      if (fly && !seen.fly) seen.fly = fly.textContent;
      const hit = document.querySelector(s + ' .is-hit');
      if (hit) {
        if (!seen.hitAt) { seen.hitAt = performance.now() - t0; seen.firstHitEl = hit; }
        else if (hit !== seen.firstHitEl) seen.hitRerendered = true;
        seen.hitName = hit.dataset.name;
        seen.hitTag = hit.querySelector('.sb-hit')?.textContent || seen.hitTag;
      } else if (seen.hitAt && !seen.hitGoneAt) seen.hitGoneAt = performance.now() - t0;
      if (performance.now() - t0 > 2500) {
        clearInterval(iv);
        delete seen.firstHitEl;
        seen.flyLeft = document.querySelectorAll('.sb-sendfx').length;
        resolve(seen);
      }
    }, 20);
  }), sel);
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
  const R = (await roomOf(code)).round;

  // ── 広い画面: あおいが4段消して、並びのつぎの はる へ送る ──
  await setFourWell(A, code, R, 'あおい');
  check('F0 ほかの人の盤に名前の印（data-name）', await A.page.$$eval('#others [data-name]', (els) => els.map((e) => e.dataset.name).sort().join()) === 'はる,メンター');
  const recvBump = B.page.evaluate(() => new Promise((resolve) => {
    const el = document.querySelector('#playJama');
    const mo = new MutationObserver(() => { if (el.classList.contains('sb-lines--up')) { mo.disconnect(); resolve(true); } });
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    setTimeout(() => resolve(false), 4000);
  }));
  const fx = watchFx(A, '#others');
  await dropFour(A);
  await A.page.waitForTimeout(200);
  await shot(A, 'e2e8-fly-wide');
  const seen = await fx;
  check('F1 「＋4段」が自分の盤から飛ぶ', seen.fly === '＋4段', seen);
  check('F2 着くと、送った相手（はる）の盤が揺れる', seen.hitName === 'はる' && seen.hitAt >= 300, seen);
  check('F3 相手の盤に「＋4段」が出る', seen.hitTag === '＋4段', seen);
  check('F4 ルームの更新で欄を作りなおしても、揺れは続く', seen.hitRerendered === true || seen.hitGoneAt - seen.hitAt >= 700, seen);
  check('F5 しばらくすると消える（飛ぶ印も残らない）', seen.hitGoneAt > 0 && seen.hitGoneAt - seen.hitAt < 1300 && seen.flyLeft === 0, seen);
  check('F6 受けた人（はる）は来るじゃまの数がはずむ', await recvBump);
  await waitFor(async () => (await text(B, '#playJama')) === '4段');

  // ── 375px: 名前の一覧へ飛ぶ ──
  await A.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  await setFourWell(A, code, R, 'あおい');
  const fx2 = watchFx(A, '#othersList');
  await dropFour(A);
  await A.page.waitForTimeout(250);
  await shot(A, 'e2e8-fly-375');
  const seen2 = await fx2;
  check('F7 375px でも「＋4段」が飛び、一覧の はる が揺れる', seen2.fly === '＋4段' && seen2.hitName === 'はる' && seen2.hitTag === '＋4段', seen2);
  check('F8 375px で横にはみ出さない', (await overflow(A)) <= 0);

  // ── 動きを減らす設定: 飛ばさず、相手に印だけ ──
  await A.page.emulateMedia({ reducedMotion: 'reduce' });
  await A.page.setViewportSize({ width: 1280, height: 900 });
  await setFourWell(A, code, R, 'あおい');
  const fx3 = watchFx(A, '#others');
  await dropFour(A);
  const seen3 = await fx3;
  check('F9 動きを減らす設定では飛ばさず、相手に「＋4段」だけ出す', seen3.fly === '' && seen3.hitName === 'はる' && seen3.hitTag === '＋4段', seen3);
  check('F10 エラーなし', A.errors.length === 0 && H.errors.length === 0 && B.errors.length === 0, A.errors.concat(H.errors, B.errors));
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
