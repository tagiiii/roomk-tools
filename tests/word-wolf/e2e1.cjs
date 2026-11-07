// ワードウルフ E2E その1: 同じルームで使った組をくり返さない（2026-11-08 P3 監査の所見4）
//  A. 開始のたびに usedPairs に組の位置が1つずつ増え、重ならない。配られたお題はその位置の組
//  B. 結果から「もう一度」で待合室に戻っても usedPairs は残る
//  C. 残り1組のときはその組を選び、全部使ったら次は空から数えなおす
//  D. 参加者の画面に、自分のお題が出る（ほかの組のお題ではない）
const fs = require('fs');
const path = require('path');
const L = require('./lib.cjs');
const { check, sleep } = L;

// 組の一覧はアプリの index.html から読む（テスト側に写さない）
const html = fs.readFileSync(path.join(__dirname, '../../apps/word-wolf/index.html'), 'utf-8');
const block = html.slice(html.indexOf('const WORD_PAIRS = ['), html.indexOf('];', html.indexOf('const WORD_PAIRS = [')));
const PAIRS = [...block.matchAll(/citizen:\s*'([^']+)',\s*wolf:\s*'([^']+)'/g)].map((m) => [m[1], m[2]]);

const usedOf = (room) => (Array.isArray(room.usedPairs) ? room.usedPairs : Object.values(room.usedPairs || {}));
const matches = (room, idx) => {
  const [a, b] = PAIRS[idx] || [];
  return (room.citizenWord === a && room.wolfWord === b) || (room.citizenWord === b && room.wolfWord === a);
};

(async () => {
  check('組は100組', PAIRS.length === 100, PAIRS.length);
  const server = await L.startServer();
  await L.launch();

  const H = await L.newClient('host');
  const A = await L.newClient('yu', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('haru');
  const code = await L.createRoom(H, 'メンター');
  check('A1 ルームを作れる', /^[A-HJ-NP-Z2-9]{6}$/.test(code || ''), code);
  await L.joinRoom(A, 'ゆう', code);
  await L.joinRoom(B, 'はる', code);

  async function startRound() {
    await H.page.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 10000 });
    await H.page.click('#btn-start');
    await L.waitVisible(H, '#screen-revealing');
    return L.roomOf(code);
  }
  async function backToWaiting() {
    // 討論・投票は今回の確かめに関係しないので、結果の画面まで REST で進める
    await L.rest('PATCH', L.ROOMS + '/' + code, { status: 'result', citizenWin: true });
    await L.waitVisible(H, '#screen-result');
    await H.page.click('button[onclick="playAgain()"]');
    await L.waitVisible(H, '#screen-waiting');
    await L.waitVisible(A, '#screen-waiting');
  }

  // A・B: 6回続けて遊ぶ
  const seen = [];
  for (let round = 1; round <= 6; round++) {
    const room = await startRound();
    const used = usedOf(room);
    check(`A2-${round} usedPairs が ${round} 件`, used.length === round, used);
    const last = used[used.length - 1];
    check(`A3-${round} 配られたお題はその位置の組`, matches(room, last), { last, c: room.citizenWord, w: room.wolfWord });
    check(`A4-${round} 前に使った組と重ならない`, !seen.includes(last), { last, seen });
    seen.push(last);
    // D: 参加者の画面に自分のお題
    const words = await Promise.all([A, B].map(async (c) => {
      await L.waitVisible(c, '#screen-revealing');
      await c.page.waitForFunction(() => (document.getElementById('my-word')?.textContent || '---') !== '---', null, { timeout: 8000 });
      return (await L.text(c, '#my-word')).trim();
    }));
    check(`D1-${round} 参加者のお題はこの回の組のどちらか`, words.every((w) => w === room.citizenWord || w === room.wolfWord), words);
    if (round === 1) await L.shot(A, 'd-guest-word-375');
    await backToWaiting();
    const after = usedOf(await L.roomOf(code));
    check(`B1-${round} もう一度のあとも usedPairs は残る`, after.length === round, after);
  }

  // C: 残り1組
  const remain = 42;
  const almost = PAIRS.map((_, i) => i).filter((i) => i !== remain);
  await L.rest('PUT', L.ROOMS + '/' + code + '/usedPairs', almost);
  let room = await startRound();
  let used = usedOf(room);
  check('C1 残り1組のときはその組を選ぶ', used[used.length - 1] === remain && matches(room, remain), { last: used[used.length - 1], c: room.citizenWord });
  check('C2 100件ぜんぶ使った記録になる', used.length === 100 && new Set(used).size === 100, used.length);
  await backToWaiting();
  room = await startRound();
  used = usedOf(room);
  check('C3 全部使ったら次は空から数えなおす', used.length === 1 && matches(room, used[0]), used);

  // 古い形（usedPairs がない・おかしな値）のルームでも始められる
  await backToWaiting();
  await L.rest('PUT', L.ROOMS + '/' + code + '/usedPairs', { a: 'x', b: 999, c: -1 });
  room = await startRound();
  used = usedOf(room);
  check('C4 おかしな値は捨てて選ぶ', used.length === 1 && Number.isInteger(used[0]) && matches(room, used[0]), used);

  check('375px で横にはみ出さない', (await L.overflow(A)) <= 0);
  await L.finishAll(server);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
