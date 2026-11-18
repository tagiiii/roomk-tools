// サークルタイム E2E その7: 参加者の「ルームにいる人・これまでの画面」（ルームにいる人・ここまでの画面・心のわけ・ふりかえりの自由記述）
const L = require('./lib.cjs');
const { check, sleep } = L;
const lookText = (c) => c.page.evaluate(() => document.querySelector('#player-look')?.innerText || '');

(async () => {
  const server = await L.startServer();
  await L.launch();
  // ── 午前: 心・体 ──
  const H = await L.newClient('host');
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('ren', { viewport: { width: 375, height: 812 } });
  const code = await L.createRoom(H, 'みほ', { kind: 'am' });
  await L.joinRoom(A, 'ゆい', code);
  await L.joinRoom(B, 'れん', code);
  let room = await L.roomOf(code);
  const idOf = (r, name) => Object.keys(r.players).find((id) => r.players[id].name === name);
  const yui = idOf(room, 'ゆい'); const ren = idOf(room, 'れん');
  const kokoro = room.steps.find((s) => s.type === 'scale' && s.key === 'kokoro');
  const karada = room.steps.find((s) => s.type === 'scale' && s.key === 'karada');
  const ROOM = `circletime_rooms/${code}`;
  await L.goMain(H, code, kokoro.id);
  await A.page.waitForSelector('#player-card [data-act="pick"]');
  check('G1 はじめは閉じている', await B.page.evaluate(() => document.querySelector('#player-look').hidden));
  await L.rest('PUT', `${ROOM}/answers/${kokoro.id}/${yui}`, 4);
  await L.rest('PUT', `${ROOM}/notes/${kokoro.id}/${yui}`, 'あさごはんがおいしかった');
  await L.rest('PUT', `${ROOM}/answers/${kokoro.id}/${ren}`, 'pass');
  await B.page.click('#btn-look');
  await L.waitText(B, '#player-look', 'あさごはんがおいしかった');
  let t = await lookText(B);
  check('G2 ルームにいる人が見える', t.includes('ルームにいる人') && t.includes('ゆい') && t.includes('れん'), t.slice(0, 200));
  check('G3 いまの心の画面に、ほかの人の番号とわけ', t.includes('いま') && t.includes('4') && t.includes('まあまあ元気') && t.includes('あさごはんがおいしかった'), t);
  check('G4 パスはパスと出る', t.includes('パス'));
  check('G5 ボタンの文字が「とじる」になる', (await L.text(B, '#btn-look')).includes('とじる'));
  check('G6 幅375pxではみ出さない', (await L.overflow(B)) <= 0);
  await L.shot(B, '71-look-kokoro');
  // 体へ進んでも、心はあとから見られる。体の表紙のあいだは、体はまだ入らない
  await H.page.click(`#steplist [data-go="${karada.id}"]`);
  await L.waitRoom(code, (r) => r.cur === karada.id);
  await sleep(800);
  t = await lookText(B);
  check('G7 表紙のあいだは、次の画面はまだ入らない', !t.includes('体') || !t.includes('いま'), t);
  await L.goMain(H, code, karada.id);
  await sleep(800);
  t = await lookText(B);
  check('G8 進んだあとも、前の心の答えとわけが見られる', t.includes('あさごはんがおいしかった') && t.includes('いま'), t);
  check('G9 書き込みはしない（参加者の操作で room は変わらない）', JSON.stringify((await L.roomOf(code)).notes) === JSON.stringify({ [kokoro.id]: { [yui]: 'あさごはんがおいしかった' } }));
  await B.page.click('#btn-look');
  check('G10 もう一度押すと閉じる', await B.page.evaluate(() => document.querySelector('#player-look').hidden));

  // ── 午後: ふりかえりの自由に書いたことも出る ──
  const H2 = await L.newClient('host2');
  const C = await L.newClient('sora', { viewport: { width: 375, height: 812 } });
  const code2 = await L.createRoom(H2, 'みほ', { kind: 'pm' });
  await L.joinRoom(C, 'そら', code2);
  room = await L.roomOf(code2);
  const sora = idOf(room, 'そら');
  const review = room.steps.find((s) => s.type === 'review');
  const R2 = `circletime_rooms/${code2}`;
  await L.goMain(H2, code2, review.id);
  await L.rest('PUT', `${R2}/answers/${review.id}/${sora}`, { n: 5, w: { 0: true } });
  await L.rest('PUT', `${R2}/notes/${review.id}/${sora}`, 'ないしょのはなし');
  await C.page.click('#btn-look');
  await L.waitText(C, '#player-look', 'たのしかった');
  t = await lookText(C);
  check('G11 ふりかえりは番号と決まった言葉', t.includes('5') && t.includes('とても楽しかった') && t.includes('たのしかった'), t);
  check('G12 ふりかえりの自由に書いたことも出る', t.includes('ないしょのはなし'), t);
  check('G13 書く欄の上に、ルームにいる人も見られると出る', (await L.text(C, '#player-card')).includes('ルームにいる人も自分の端末で見られるよ'));
  check('G14 ボタンの名前', (await L.text(C, '#btn-look')).includes('ルームにいる人・これまでの画面'));
  await L.shot(C, '72-look-review');
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
