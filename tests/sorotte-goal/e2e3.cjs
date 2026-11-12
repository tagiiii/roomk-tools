// そろってゴール E2E その3: くらやみ（自分のまわりだけ見える）・砂時計（0になっても終わりではない）・1歩あたりの通信量
const L = require('./lib.cjs');
const { check, sleep, waitFor, KEY } = L;

const count = (c, sel) => c.page.$$eval(sel, (xs) => xs.length);
// 通信の量を数える（つなぐ前に付ける）。受けた・送ったバイト数
function meter(c) {
  c.net = { rx: 0, tx: 0 };
  c.page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => { c.net.rx += Buffer.byteLength(f.payload); });
    ws.on('framesent', (f) => { c.net.tx += Buffer.byteLength(f.payload); });
  });
}
async function synced(c, code) {
  return waitFor(async () => {
    const S = (await L.gameOf(code)).S;
    const want = S.players.map((p) => p.x + ',' + p.y).join(' ');
    const got = await c.page.$$eval('.sg-piece--player', (ps) => ps
      .sort((a, b) => Number(a.dataset.seat) - Number(b.dataset.seat))
      .map((p) => p.style.getPropertyValue('--x') + ',' + p.style.getPropertyValue('--y')).join(' '));
    return want === got;
  }, 5000);
}
async function stepAndWait(c, code, dir) {
  await synced(c, code);
  const before = (await L.gameOf(code)).S.rev;
  await L.press(c, KEY[dir]);
  return waitFor(async () => (await L.gameOf(code)).S.rev > before, 5000);
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { viewport: { width: 1280, height: 800 } });
  const A = await L.newClient('guestA', { viewport: { width: 1100, height: 800 } });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 800 } });
  [H, A, W].forEach(meter);
  const code = await L.createRoom(H, 'ほすと');
  await L.joinRoom(A, 'あおい', code);

  // ── A. 設定 ──
  check('A1 はじめは、くらやみなし・砂時計なし', (await L.roomOf(code)).set.dark !== true && !(await L.roomOf(code)).set.time);
  check('A2 参加者の画面の要約に、くらやみ・砂時計は出ない', !(await L.text(A, '#lobbySetView')).includes('くらやみ') && !(await L.text(A, '#lobbySetView')).includes('砂時計'));
  await H.page.click('#darkSeg .sg-seg__btn >> nth=1');
  await L.roomWhen(code, (r) => r.set.dark === true);
  await H.page.click('#timeSeg .sg-seg__btn >> nth=1');
  await L.roomWhen(code, (r) => r.set.time === 3);
  check('A3 えらぶと、参加者の画面の要約に出る', await waitFor(async () => (await L.text(A, '#lobbySetView')).includes('くらやみ') && (await L.text(A, '#lobbySetView')).includes('砂時計 3分')));
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  await H.page.click('#btnStartGame');
  for (const c of [H, A, W]) await L.waitScreen(c, 'game');
  const G = await L.gameOf(code);
  check('A4 ステージに、くらやみ・砂時計・はじめた時刻が入る', G.raw.dark === true && G.raw.limit === 3 && G.raw.startAt > 0, G.raw);

  // ── B. くらやみ ──
  const cells = await count(A, '.sg-cell');
  const unseenA = await count(A, '.sg-cell.is-unseen');
  check('B1 遊ぶ人の画面は、見えないマスがある', unseenA > 0 && unseenA < cells && await A.page.$eval('#board', (b) => b.classList.contains('is-dark')), [unseenA, cells]);
  check('B2 自分のコマは見える', (await count(A, '.sg-piece--player[data-seat="1"]:not(.is-hidden)')) === 1);
  check('B3 しかけの名前の行に、くらやみの説明が出る', (await L.text(A, '#stageHint')).includes('くらやみ'));
  // 見えていないマスのカギ・星は出ない
  const hiddenA = await count(A, '.sg-piece.is-hidden');
  check('B4 見えていない所の、カギ・星は出さない', hiddenA > 0, hiddenA);
  check('B5 みんなにみせる画面は、みんなの明かりを合わせた範囲（遊ぶ人の画面より、見えないマスが多くない）', (await count(W, '.sg-cell.is-unseen')) <= unseenA && (await count(W, '.sg-cell.is-unseen')) > 0);
  // 動くと、見えた所が増える。前に見た所は、うす暗く残る
  const s0 = (await L.gameOf(code)).S;
  const far = ['right', 'down', 'up', 'left'].find((d) => L.E.move(L.E.move(s0, 1, d), 1, d) !== L.E.move(s0, 1, d) && L.E.move(s0, 1, d) !== s0);
  await stepAndWait(A, code, far);
  await stepAndWait(A, code, far);
  check('B6 動くと、見えた所が増える', await waitFor(async () => (await count(A, '.sg-cell.is-unseen')) < unseenA), [await count(A, '.sg-cell.is-unseen'), unseenA]);
  check('B7 前に見た所は、うす暗く残る', (await count(A, '.sg-cell.is-dim')) > 0);
  check('B8 くらやみでも、ルームに余分な書き込みはない（動く部分は p だけが変わる）', JSON.stringify(Object.keys((await L.roomOf(code)).play[G.id]).sort()) === JSON.stringify(Object.keys(G.play[G.id]).sort()));
  await L.shot(A, 'e3-guest-dark');
  await L.shot(W, 'e3-watch-dark');

  // ── C. 砂時計 ──
  const shown = async () => [await L.text(H, '#timer'), await L.text(A, '#timer'), await L.text(W, '#timer')];
  check('C1 どの画面にも、残り時間が出る（はじめは 3:00 か 2:5x）', (await shown()).every((t) => /のこり (3:00|2:5\d)/.test(t)), await shown());
  await sleep(2200);
  check('C1b 時間がたつと、どの画面でも減る', (await shown()).every((t) => /のこり 2:5\d/.test(t)), await shown());
  check('C2 まだ「時間だよ」は出ない', !(await L.visible(A, '#timeBox')));
  // 時間を早送りする（はじめた時刻を、3分より前にする）
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/startAt', Date.now() - 181000);
  check('C3 0になると、どの画面にも「時間だよ」', await waitFor(async () => await L.visible(H, '#timeBox') && await L.visible(A, '#timeBox') && await L.visible(W, '#timeBox')));
  check('C4 ホストにだけ、えらぶボタン。参加者には待つ文', await L.visible(H, '#btnTimeGo') && !(await L.visible(A, '#btnTimeGo')) && await L.visible(A, '#timeWait') && !(await L.visible(W, '#timeWait')));
  const rev = (await L.gameOf(code)).S.rev;
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']) await A.page.keyboard.press(key);
  await sleep(500);
  check('C5 「時間だよ」の間は、1歩も書かない', (await L.gameOf(code)).S.rev === rev);
  await H.page.click('#btnTimeGo');
  await L.roomWhen(code, (r) => r.game.limit === 0);
  check('C6 「このままつづける」で、札と残り時間が消える', await waitFor(async () => !(await L.visible(A, '#timeBox')) && !(await L.visible(A, '#timer')) && !(await L.visible(W, '#timeBox'))));
  const s1 = (await L.gameOf(code)).S;
  const d1 = Object.keys(L.E.DIRS).find((d) => L.E.move(s1, 1, d) !== s1);
  check('C7 また動かせる', await stepAndWait(A, code, d1));

  // ── D. 1歩あたりの通信量（参考の数字。ホスト・参加者・みんなにみせる画面の3つがつながっている） ──
  const back = { left: 'right', right: 'left', up: 'down', down: 'up' };
  const before = { a: { ...A.net }, h: { ...H.net }, w: { ...W.net } };
  const STEPS = 40;
  // さっき進んだ向きの反対へもどり、行ったり来たりする
  let dir = back[d1];
  for (let i = 0; i < STEPS; i += 1) {
    if (!(await stepAndWait(A, code, dir))) { dir = back[dir]; await stepAndWait(A, code, dir); }
    dir = back[dir];
  }
  await sleep(500);
  const per = (now, was) => Math.round((now - was) / STEPS);
  const stat = {
    '動かした人が送る': per(A.net.tx, before.a.tx),
    '動かした人が受ける': per(A.net.rx, before.a.rx),
    'ほかの人（ホスト）が受ける': per(H.net.rx, before.h.rx),
    'みんなにみせる画面が受ける': per(W.net.rx, before.w.rx),
  };
  console.log('  1歩あたりの通信量（バイト。エミュレーター・WebSocket の中身だけ）: ' + JSON.stringify(stat));
  check('D1 1歩で、見ている端末が受けるのは 300 バイトより少ない', stat['ほかの人（ホスト）が受ける'] < 300 && stat['みんなにみせる画面が受ける'] < 300, stat);
  check('D2 1歩で、動かした人が送るのは 400 バイトより少ない', stat['動かした人が送る'] < 400, stat);

  await H.page.click('#btnLeave');
  await L.waitScreen(H, 'top');
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
