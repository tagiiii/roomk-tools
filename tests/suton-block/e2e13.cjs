// すとんブロック E2E その13: 対戦の「ここまで」で人数が減ったら落ちるのが速くなる（2026-11-20 フィードバック）
// 5人ではじめて、のこり3人（半分・切り上げ）で1段目、のこり2人（1対1）で2段目・一言はのこっている人だけ・
// 実際に落ちる間かくが短くなる・読み込み直しても速いまま（一言は出さない）
const L = require('./lib.cjs');
const { check, sleep, roomOf, roomWhen, text, waitText, waitFor, key } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const stage = (c) => c.page.evaluate(() => document.getElementById('screen-play').dataset.speedUp);
async function goOut(c, code, name) {
  for (let i = 0; i < 80 && !(await roomOf(code)).boards?.[name]?.out; i++) { await key(c, 'Space'); await sleep(40); }
  await roomWhen(code, (r) => r.boards?.[name]?.out === true);
}
// name が何もしないで置くブロックの、2つぶんの間かく（ms）。置くたびに boards/{name}/pieces が増える
async function lockInterval(code, name) {
  const piecesOf = async () => Number((await roomOf(code)).boards?.[name]?.pieces) || 0;
  let p = await piecesOf();
  const until = async (n) => { for (let i = 0; i < 400; i++) { if (await piecesOf() >= n) return Date.now(); await sleep(50); } return null; };
  const t1 = await until(p + 1);
  const t2 = await until(p + 2);
  return t1 && t2 ? t2 - t1 : Infinity;
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const vp = { viewport: { width: 1280, height: 900 } };
  const H = await L.newClient('host', vp);
  const A = await L.newClient('aoi', vp);
  const B = await L.newClient('haru', vp);
  const C = await L.newClient('sora', vp);
  const D = await L.newClient('riku', vp);
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  await L.joinRoom(B, 'はる', code);
  await L.joinRoom(C, 'そら', code);
  await L.joinRoom(D, 'りく', code);
  await waitText(H, '#lobbyPeople', 'りく');
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  await H.page.click('label:has(input[name="roomTime"][value="0"])');
  await H.page.evaluate(() => { document.getElementById('moreSettings').open = true; });
  await H.page.click('label:has(input[name="roomSpeed"][value="fast"])');
  await roomWhen(code, (r) => r.settings.mode === 'battle' && r.settings.time === 0 && r.settings.full !== 'clear' && r.settings.speed === 'fast');
  await H.page.click('#btnStartGame');
  await Promise.all([H, A, B, C, D].map((c) => waitFalling(c)));
  check('U1 はじめは設定の速さ（5人とも段階0）', (await Promise.all([H, A, B, C, D].map(stage))).every((s) => s === '0'));

  // あおいは何もしない。はじめの間かくを測る（はやい 0.38秒で1マス）
  const base = await lockInterval(code, 'あおい');
  check('U2 はじめの置く間かくを測れた', Number.isFinite(base), base);

  // 2人ここまで → のこり3人（5人の半分・切り上げ）
  await goOut(B, code, 'はる');
  await sleep(600);
  check('U3 のこり4人ではまだ変わらない', (await stage(A)) === '0');
  await goOut(C, code, 'そら');
  check('U4 のこり3人で段階1（のこっている人）', await waitFor(async () => (await stage(A)) === '1' && (await stage(H)) === '1' && (await stage(D)) === '1'));
  check('U5 のこっている人に一言', (await text(A, '#playNote')).includes('落ちるのが速くなった'));
  check('U6 ここまでの人には速さの一言を出さない', !(await text(C, '#playNote') || '').includes('速く'));

  // もう1人ここまで → 1対1
  await goOut(D, code, 'りく');
  check('U7 のこり2人で段階2', await waitFor(async () => (await stage(A)) === '2' && (await stage(H)) === '2'));
  check('U8 1対1の一言', await waitFor(async () => (await text(A, '#playNote')).includes('1対1')));
  const fast = await lockInterval(code, 'あおい');
  check('U9 実際に置く間かくが短くなる（はじめの0.7倍より短い）', fast < base * 0.7, { base, fast });

  // 読み込み直しても速いまま。一言は出さない
  await A.page.reload();
  await A.page.waitForFunction(() => document.querySelector('#screen-play.active'), null, { timeout: 12000 });
  check('U10 読み込み直しても段階2', await waitFor(async () => (await stage(A)) === '2', 8000));
  await sleep(800);
  check('U11 読み込み直した直後は一言を出さない', !((await text(A, '#playNote')) || '').includes('1対1'));

  const all = [H, A, B, C, D];
  check('U12 エラーなし', all.every((c) => c.errors.length === 0), all.flatMap((c) => c.errors));
  await H.page.click('#btnPlayEnd').catch(() => {});
  await sleep(300);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
