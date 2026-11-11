// すとんブロック E2E その6: 効果音（2026-11-09 フィードバック）
// はじめは切・入にするとこの端末だけで鳴る（動かす・回す・とっておく・置く・段を消す・じゃま・カウントダウン。2026-11-11 に増やした）・設定は端末に残る・ルームには書かない・みんなにみせる画面には出さない
const L = require('./lib.cjs');
const { check, sleep, roomOf, visible, waitText, waitFor, key, waitScreen, overflow } = L;

const waitFalling = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden, null, { timeout });
const sfxValue = (c, name) => c.page.evaluate((n) => document.querySelector('input[name="' + n + '"]:checked')?.value ?? null, name);
const stored = (c) => c.page.evaluate(() => localStorage.getItem('sutonblock:sfx'));
const tones = (c) => c.page.evaluate(() => window.__tones.slice());
const clearTones = (c) => c.page.evaluate(() => { window.__tones.length = 0; });
// 鳴らした音の高さを数える（音の部品が作られた数は lib の __audioMade）
// files が false のときは、音のファイル（sfx/*.mp3）を読めなくして、合成音で鳴るのを見る
async function countTones(c, files = false) {
  if (!files) await c.page.route('**/sfx/*.mp3*', (route) => route.fulfill({ status: 200, contentType: 'audio/mpeg', body: 'x' }));
  await c.page.addInitScript(() => {
    // ファイルで鳴らした音は、長さ（秒・小数2けた）を覚える
    window.__bufs = [];
    const startBuf = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) { if (this.buffer && this.buffer.duration < 0.99) window.__bufs.push(Math.round(this.buffer.duration * 100) / 100); return startBuf.apply(this, args); };
    window.__tones = [];
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { window.__tones.push(Math.round(this.frequency.value)); return start.apply(this, args); };
  });
}

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── ひとり ──
  const S = await L.newClient('solo');
  await countTones(S);
  await L.open(S);
  await S.page.click('#btnGoSolo');
  await waitScreen(S, 'solo');
  check('S1 はじめは切', (await sfxValue(S, 'soloSfx')) === 'off' && (await stored(S)) === null);
  await S.page.click('#btnSoloStart');
  await waitFalling(S);
  await key(S, 'Space', 3);
  await sleep(200);
  check('S2 切のまま置いても、音の部品を作らない', (await S.page.evaluate(() => window.__audioMade)) === 0 && (await tones(S)).length === 0);
  await S.page.reload();
  await S.page.waitForFunction(() => document.querySelector('.sb-screen.active'));
  await S.page.click('#btnGoSolo');
  await S.page.click('label:has(input[name="soloSfx"][value="on"])');
  await sleep(300);
  S.soundOk = true;
  check('S3 入にすると端末に残り、待合室の切りかえもそろう', (await stored(S)) === '1' && (await sfxValue(S, 'roomSfx')) === 'on');
  check('S4 入にした瞬間に見本の音を1回', JSON.stringify(await tones(S)) === '[523,1046,659,1318]', await tones(S));
  await S.page.reload();
  await S.page.waitForFunction(() => document.querySelector('.sb-screen.active'));
  await S.page.click('#btnGoSolo');
  check('S5 読み込み直しても入のまま', (await sfxValue(S, 'soloSfx')) === 'on');
  await S.page.setViewportSize({ width: 375, height: 812 });
  check('S6 375px ではみ出さない', (await overflow(S)) <= 0);
  await S.page.setViewportSize({ width: 1280, height: 900 });
  await S.page.click('#btnSoloStart');
  await waitFalling(S);
  await clearTones(S);
  await key(S, 'Space');
  await sleep(200);
  check('S7 すとんで置いたら低い音が1つ', JSON.stringify(await tones(S)) === '[196]', await tones(S));
  // 2026-11-11: 回す・動かす・とっておくでも鳴る（動かせなかったときは鳴らさない）
  await clearTones(S);
  await key(S, 'ArrowUp');
  await sleep(100);
  check('S8 回したら短い音が1つ', JSON.stringify(await tones(S)) === '[740]', await tones(S));
  await clearTones(S);
  await key(S, 'ArrowLeft');
  await sleep(100);
  check('S9 動かしたら短い音が1つ', JSON.stringify(await tones(S)) === '[660]', await tones(S));
  await key(S, 'ArrowLeft', 12);
  await sleep(100);
  await clearTones(S);
  await key(S, 'ArrowLeft');
  await sleep(100);
  check('S10 かべで動かなかったら鳴らさない', (await tones(S)).length === 0, await tones(S));
  await clearTones(S);
  await key(S, 'c');
  await sleep(200);
  check('S11 とっておいたら2つの音', JSON.stringify(await tones(S)) === '[392,587]', await tones(S));
  await S.page.click('label:has(input[name="soloSfx"][value="off"])').catch(() => {});

  // ── 音のファイル（2026-11-11。ElevenLabs で作った sfx/*.mp3） ──
  const F = await L.newClient('files');
  await countTones(F, true);
  const asked = [];
  F.page.on('request', (r) => { if (r.url().includes('/sfx/')) asked.push(r.url()); });
  await L.open(F);
  await F.page.click('#btnGoSolo');
  await waitScreen(F, 'solo');
  await sleep(300);
  check('F1 切のうちは音のファイルを読まない', asked.length === 0, asked);
  await F.page.click('label:has(input[name="soloSfx"][value="on"])');
  F.soundOk = true;
  await waitFor(async () => asked.length === 14);
  check('F2 入にすると14個のファイルを読む', asked.length === 14, asked.length);
  await sleep(800);
  await F.page.click('#btnSoloStart');
  await waitFalling(F);
  await F.page.evaluate(() => { window.__bufs.length = 0; window.__tones.length = 0; });
  await key(F, 'ArrowUp');
  await key(F, 'Space');
  await sleep(300);
  const bufs = await F.page.evaluate(() => window.__bufs.slice());
  check('F3 回す・すとんがファイルの音で鳴る（合成音は鳴らない）', bufs.length === 2 && (await tones(F)).length === 0, [bufs, await tones(F)]);
  await F.page.click('label:has(input[name="soloSfx"][value="off"])').catch(() => {});

  // ── ルーム ──
  const H = await L.newClient('host', { viewport: { width: 1280, height: 900 } });
  const A = await L.newClient('aoi', { viewport: { width: 1280, height: 900 } });
  await countTones(A);
  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あおい', code);
  // 音のファイルを読める参加者（カウントダウンがファイルの音で鳴るのを見る。ひとりにはカウントダウンがない）
  const B = await L.newClient('files-room', { viewport: { width: 1280, height: 900 } });
  await countTones(B, true);
  await L.joinRoom(B, 'みどり', code);
  await B.page.click('label:has(input[name="roomSfx"][value="on"])');
  B.soundOk = true;
  await sleep(1000);
  await B.page.evaluate(() => { window.__bufs.length = 0; window.__tones.length = 0; });
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await waitText(H, '#lobbyPeople', 'あおい');
  check('R1 待合室の「効果音」はホスト・参加者に出る', (await visible(H, '#lobbySfx')) && (await visible(A, '#lobbySfx')));
  check('R2 みんなにみせる画面には出さない', await waitFor(async () => (await L.screen(W)) === 'waiting' && !(await visible(W, '#lobbySfx'))));
  check('R3 参加者もはじめは切', (await sfxValue(A, 'roomSfx')) === 'off');
  await A.page.click('label:has(input[name="roomSfx"][value="on"])');
  A.soundOk = true;
  await sleep(300);
  const room = await roomOf(code);
  check('R4 入にしてもルームには書かない', !JSON.stringify(room).includes('sfx'));
  check('R5 ホストの端末は切のまま', (await sfxValue(H, 'roomSfx')) === 'off');
  await H.page.click('#btnStartGame');
  await Promise.all([waitFalling(H), waitFalling(A), waitFalling(B)]);
  await sleep(150);
  const cdBufs = await B.page.evaluate(() => window.__bufs.slice());
  check('R5c 音のファイルが読めた人は、カウントダウン3回とはじまりがファイルの音で鳴る（合成音は鳴らない）', cdBufs.length === 4 && (await tones(B)).length === 0, [cdBufs, await tones(B)]);
  const startTones = await tones(A);
  check('R5b カウントダウンで3回・はじまりで1回鳴る', startTones.filter((f) => f === 440).length === 3 && startTones.includes(880), startTones);
  await clearTones(A);
  await key(A, 'Space');
  await sleep(300);
  check('R6 入にした参加者は置いたら鳴る', (await tones(A)).includes(196), await tones(A));
  await key(H, 'Space');
  await sleep(300);
  check('R7 切のホストは置いても鳴らない', (await H.page.evaluate(() => window.__audioMade)) === 0);
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
