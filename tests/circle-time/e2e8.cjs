// サークルタイム E2E その8: 接続が切れた人が、別のタブ・端末から同じ名前で入りなおせる（その人として戻る・答えもそのまま）。
// いまつながっている人・進行役・端末なしの人の名前では入れない
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const C = await L.newClient('yui2', { viewport: { width: 375, height: 812 } });
  const code = await L.createRoom(H, 'みほ', { kind: 'am' });
  await L.joinRoom(A, 'ゆい', code);
  let room = await L.roomOf(code);
  const yui = Object.keys(room.players).find((id) => room.players[id].name === 'ゆい');
  const kokoro = room.steps.find((s) => s.type === 'scale' && s.key === 'kokoro');
  await L.goMain(H, code, kokoro.id);
  await L.rest('PUT', `circletime_rooms/${code}/answers/${kokoro.id}/${yui}`, 4);

  const tryJoin = async (c, name) => {
    await L.open(c, '?room=' + code);
    await L.waitScreen(c, 'join');
    await c.page.fill('#join-name', name);
    await c.page.click('#join-form button[type=submit]');
  };
  // つながっているあいだは入れない
  await tryJoin(C, 'ゆい');
  await L.waitVisible(C, '#join-error');
  check('R1 つながっている人の名前では入れない', (await L.text(C, '#join-error')).includes('使われている') && (await L.screenActive(C)) === 'screen-join');
  check('R2 少し待つよう案内する', (await L.text(C, '#join-error')).includes('少し待って'));
  // 進行役の名前では入れない
  await tryJoin(C, 'みほ');
  await L.waitText(C, '#join-error', '使われている');
  check('R3 進行役の名前では入れない', !(await L.text(C, '#join-error')).includes('少し待って'));
  // 端末なしの人の名前では入れない
  await H.page.fill('#proxy-name', 'そら');
  await H.page.click('#btn-add-proxy');
  await L.waitText(H, '#plist', 'そら');
  await tryJoin(C, 'そら');
  await L.waitText(C, '#join-error', '使われている');
  check('R4 端末なしの人の名前では入れない', (await L.screenActive(C)) === 'screen-join');

  // A のタブが閉じて接続が切れる
  await A.context.close();
  const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    room = await L.roomOf(code);
    if (!Object.keys(room.players[yui]?.connections || {}).length) break;
    await sleep(1000);
  }
  check('R5 接続が切れたことがルームに出る', !Object.keys(room.players[yui]?.connections || {}).length);
  await L.waitText(H, '#plist', '接続が切れています');

  // 別の端末から同じ名前で入りなおす
  await tryJoin(C, 'ゆい');
  await L.waitScreen(C, 'player');
  room = await L.roomOf(code);
  const yuis = Object.keys(room.players).filter((id) => room.players[id].name === 'ゆい');
  check('R6 同じ名前で入りなおせる（人は増えない）', yuis.length === 1 && yuis[0] === yui, yuis);
  check('R7 答えもそのまま', room.answers?.[kokoro.id]?.[yui] === 4);
  await L.waitPlayer(C, '4 を送ったよ');
  check('R8 入りなおした端末に、前の答えが出る', (await L.player(C)).includes('4 を送ったよ'));
  await L.waitNoText(H, '#plist', '接続が切れています');
  check('R9 進行役の一覧で「接続が切れています」が消える', true);
  await C.page.click('#player-card [data-act="pick"][data-v="2"]');
  await C.page.click('#p-send');
  await L.waitPlayer(C, '2 を送ったよ');
  room = await L.roomOf(code);
  check('R10 入りなおしたあとも答えを送れる', room.answers[kokoro.id][yui] === 2);
  await L.shot(C, '81-rejoin');
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
