// すとんブロック E2E その10: 音楽（2026-11-12）
// はじめは切（切のうちは <audio> を作らず、曲も読まない）・入にすると端末に残る・あそんでいる間だけ流れる（とめる・画面が裏・おわるで止まる）・
// もう一回で頭から・切にすると手放す・ルームには書かない・みんなにみせる画面には出さない・カウントダウンの間は流さない・読み込み直したあとは押したときから流れる
const L = require('./lib.cjs');
const { check, sleep, roomOf, visible, waitText, waitFor, key, waitScreen, overflow } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const bgmValue = (c, name) => c.page.evaluate((n) => document.querySelector('input[name="' + n + '"]:checked')?.value ?? null, name);
const stored = (c) => c.page.evaluate(() => localStorage.getItem('sutonblock:bgm'));
// play() された <audio> を覚えておき、いまの様子を見る
async function watchMedia(c) {
  c.asked = [];
  c.page.on('request', (r) => { if (r.url().includes('/bgm/')) c.asked.push(r.url()); });
  await c.page.addInitScript(() => {
    window.__media = [];
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) { if (!window.__media.includes(this)) window.__media.push(this); return play.apply(this, args); };
  });
}
const media = (c) => c.page.evaluate(() => window.__media.map((e) => ({ paused: e.paused, muted: e.muted, loop: e.loop, t: e.currentTime, src: e.getAttribute('src') })));
const playing = async (c) => { const m = await media(c); return m.length === 1 && !m[0].paused && !m[0].muted; };
const stopped = async (c) => { const m = await media(c); return m.every((e) => e.paused); };

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── ひとり ──
  const S = await L.newClient('solo');
  await watchMedia(S);
  await L.open(S);
  await S.page.click('#btnGoSolo');
  await waitScreen(S, 'solo');
  check('M1 はじめは切', (await bgmValue(S, 'soloBgm')) === 'off' && (await stored(S)) === null);
  await S.page.click('#btnSoloStart');
  await waitFalling(S);
  await key(S, 'Space', 2);
  await sleep(300);
  check('M2 切のままあそんでも、<audio> を作らず曲も読まない', (await S.page.evaluate(() => window.__audioMade)) === 0 && S.asked.length === 0 && (await media(S)).length === 0, [S.asked, await media(S)]);
  await S.page.click('#btnPlayEnd');
  await waitScreen(S, 'result');
  await S.page.click('#btnResultTop');
  await S.page.click('#btnGoSolo');
  await S.page.click('label:has(input[name="soloBgm"][value="on"])');
  S.soundOk = true;
  await sleep(400);
  check('M3 入にすると端末に残り、待合室の切りかえもそろう', (await stored(S)) === '1' && (await bgmValue(S, 'roomBgm')) === 'on');
  check('M4 設定の画面では流れない', await stopped(S), await media(S));
  await S.page.setViewportSize({ width: 375, height: 812 });
  check('M5 375px ではみ出さない', (await overflow(S)) <= 0);
  await S.page.setViewportSize({ width: 1100, height: 900 });
  await S.page.click('#btnSoloStart');
  await waitFalling(S);
  check('M6 はじめると流れる（くり返し・音あり）', await waitFor(async () => (await playing(S)) && (await media(S))[0].loop && (await media(S))[0].t > 0.2, 5000), await media(S));
  check('M7 曲のファイルを読んだ', S.asked.length >= 1 && S.asked.every((u) => u.includes('/bgm/play.mp3?v=')), S.asked);
  await key(S, 'p');
  check('M8 とめると止まる', await waitFor(() => stopped(S), 2000), await media(S));
  const at = (await media(S))[0].t;
  await key(S, 'p');
  check('M9 つづけると、続きから流れる', await waitFor(async () => (await playing(S)) && (await media(S))[0].t >= at, 3000), [at, await media(S)]);
  // 画面が裏に回ったことにする
  await S.page.evaluate(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(300);
  check('M10 画面が裏のときは止まる', await stopped(S), await media(S));
  await S.page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
  check('M11 もどると流れる', await waitFor(() => playing(S), 3000), await media(S));
  await sleep(1200);
  await S.page.click('#btnPlayEnd');
  await waitScreen(S, 'result');
  check('M12 おわると止まる', await waitFor(() => stopped(S), 2000), await media(S));
  const endAt = (await media(S))[0].t;
  await S.page.click('#btnAgain');
  await waitFalling(S);
  check('M13 もう一回で、曲の頭から流れる', await waitFor(() => playing(S), 3000) && (await media(S))[0].t < endAt, [endAt, await media(S)]);
  await S.page.reload();
  await S.page.waitForFunction(() => document.querySelector('.sb-screen.active'));
  await S.page.click('#btnGoSolo');
  check('M14 読み込み直しても入のまま', (await bgmValue(S, 'soloBgm')) === 'on');
  await S.page.click('#btnSoloStart');
  await waitFalling(S);
  check('M15 読み込み直したあとも、はじめると流れる', await waitFor(() => playing(S), 5000), await media(S));
  await S.page.click('#btnPlayEnd');
  await waitScreen(S, 'result');
  await S.page.click('#btnResultTop');
  await S.page.click('#btnGoSolo');
  await S.page.click('label:has(input[name="soloBgm"][value="off"])');
  await sleep(300);
  const off = await media(S);
  check('M16 切にすると手放す（src を外す）', (await stored(S)) === '0' && off.every((e) => e.paused && e.src === null), off);
  const made = await S.page.evaluate(() => window.__audioMade);
  await S.page.click('#btnSoloStart');
  await waitFalling(S);
  await sleep(500);
  check('M17 切にしたあとは、あそんでも流れない', (await stopped(S)) && (await S.page.evaluate(() => window.__audioMade)) === made, await media(S));

  // ── ルーム ──
  const H = await L.newClient('host', { viewport: { width: 1280, height: 900 } });
  const A = await L.newClient('aoi', { viewport: { width: 1280, height: 900 } });
  await watchMedia(H);
  await watchMedia(A);
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await waitText(H, '#lobbyPeople', 'あおい');
  check('R1 待合室の「音楽」はホスト・参加者に出る', (await visible(H, 'input[name="roomBgm"] + span')) && (await visible(A, 'input[name="roomBgm"] + span')));
  check('R2 みんなにみせる画面には出さない', await waitFor(async () => (await L.screen(W)) === 'waiting' && !(await visible(W, 'input[name="roomBgm"] + span'))));
  check('R3 参加者もはじめは切', (await bgmValue(A, 'roomBgm')) === 'off');
  await A.page.click('label:has(input[name="roomBgm"][value="on"])');
  A.soundOk = true;
  await sleep(400);
  check('R4 入にしてもルームには書かない', !JSON.stringify(await roomOf(code)).includes('bgm'));
  check('R5 ホストの端末は切のまま', (await bgmValue(H, 'roomBgm')) === 'off');
  check('R6 待合室では流れない', await stopped(A), await media(A));
  // 回をはじめるのはホスト（参加者は押していない）
  await H.page.click('#btnStartGame');
  await waitFor(() => visible(A, '#countdown'), 3000);
  check('R7 カウントダウンの間は流れない', (await visible(A, '#countdown')) && (await stopped(A)), await media(A));
  await Promise.all([waitFalling(H), waitFalling(A)]);
  check('R8 落ちはじめると、入にした参加者に流れる', await waitFor(() => playing(A), 5000), await media(A));
  await key(H, 'Space');
  await sleep(300);
  check('R9 切のホストには流れない', (await media(H)).length === 0 && H.asked.length === 0);
  // 読み込み直したあと（まだ何も押していない）は、押したときから流れる
  await A.page.reload();
  await waitFalling(A);
  await sleep(800);
  const before = await media(A);
  await key(A, 'ArrowLeft');
  check('R10 読み込み直したあとは、押したときから流れる', await waitFor(() => playing(A), 5000), [before, await media(A)]);
  await H.page.click('#btnPlayEnd');
  await Promise.all([waitScreen(H, 'result'), waitScreen(A, 'result')]);
  check('R11 結果では止まる', await waitFor(() => stopped(A), 2000), await media(A));
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
