// ひらめき大喜利 E2E その2: 端末のない参加者（足す・外す・同じ名前・代わりに押す・代わりに書く・一本の数）・
// 再読み込み・遊んでいる途中の参加・退出で数えなおして一本・同じ名前で入りなおし・ほかの人は同じ名前で入れない・
// ホストの切断と復帰（参加者の端末が時間を進める・戻ると続く）・レビューの指摘の確認（締め切ったあとの一本・一本の途中のおしまい）
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, roomWhen, text, visible, waitScreen, overflow, waitUntil, stage, listRows, ipponOn, answer, approve, setMode } = L;
const path = require('path');

const shot = (c, name) => c.page.screenshot({ path: path.join(L.OUT, name + '.png'), fullPage: true });
async function endWindow(code) {
  await rest('PATCH', L.ROOMS + '/' + code + '/game/cur', { endsAt: Date.now() - 1000 });
}
async function startTopic(h, g) {
  await waitScreen(h, 'pick');
  await h.page.click('#pickCands .og-cand >> nth=0');
  await waitScreen(g, 'play');
}

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── P. 端末のない参加者 ──
  const h = await L.newClient('host');
  const code = await L.createRoom(h, 'メンター');
  const g = await L.newClient('g');
  await L.joinRoom(g, 'りく', code);
  check('P1 足す欄はホストにだけ・はじめはたたんである', await visible(h, '#proxyAdmin') && !(await h.page.$eval('#proxyAdmin', (e) => e.open)) && !(await visible(g, '#proxyAdmin')));
  await h.page.click('#proxyAdmin > summary');
  const addProxy = async (name) => { await h.page.fill('#proxyName', name); await h.page.click('#btnAddProxy'); };
  await addProxy('そら');
  check('P2 足した子はみんなの一覧に出る', await waitUntil(async () => (await text(g, '#lobbyPlayers')).includes('そら')));
  check('P3 端末なしの印はホストの画面にだけ', (await text(h, '#lobbyPlayers')).includes('端末なし') && !(await text(g, '#lobbyPlayers')).includes('端末なし'));
  await addProxy('りく');
  check('P4 参加している人と同じ名前は足せない', await waitUntil(async () => (await text(h, '#proxyAddMsg')).includes('同じ名前')));
  await addProxy('ほし');
  check('P5 2人足した', await waitUntil(async () => (await h.page.$$('#proxyAdminList li')).length === 2));
  await h.page.click('#proxyAdminList li:has-text("ほし") .og-proxy-remove');
  check('P6 待合室では外せる', await waitUntil(async () => !(await text(g, '#lobbyPlayers')).includes('ほし')));
  const dup = await L.newClient('dup');
  await L.open(dup, '?room=' + code);
  await waitScreen(dup, 'join');
  await dup.page.fill('#guestName', 'そら');
  await dup.page.click('#btnJoinRoom');
  check('P7 端末のない子と同じ名前では参加できない', await waitUntil(async () => ((await text(dup, '#joinError')) || '').includes('その名前は使われている')));
  await dup.page.close();
  await setMode(h, '回答者');
  await setMode(h, '審査員');
  check('P8 端末のない子も審査員に数える（りく＋そら）', await waitUntil(async () => !(await h.page.isDisabled('#btnStart')) && (await text(h, '#lobbyStartNote')).includes('2人')));
  await h.page.click('#btnStart');
  await startTopic(h, g);
  check('P9 代わりに書く・押す欄はホストにだけ', await visible(h, '#proxyBox') && !(await visible(g, '#proxyBox')));
  check('P10 答えが出ていないうちは押せない', await waitUntil(async () => (await h.page.$$('#proxyPressList .og-proxy-press:disabled')).length === 1));
  await h.page.fill('#proxyInput', 'かわりのこたえ');
  await h.page.click('#btnProxyAnswer');
  check('P11 代わりに出した', await waitUntil(async () => (await text(h, '#proxyMsg')).includes('そらさん')));
  check('P12 代わりに書いた答えは確認なしで出る', await waitUntil(async () => (await stage(g)) === 'かわりのこたえ'));
  check('P13 本人の答えには代わりに押せない', await waitUntil(async () => (await text(h, '#proxyPressList')).includes('本人の答え')));
  await g.page.click('#btnPress');
  check('P14 端末のない子の答えも一本になる', await waitUntil(async () => await ipponOn(g) && (await text(g, '#ipponName')) === 'そらさん'));
  await waitScreen(h, 'result', 9000);
  check('P15 結果の画面でも足せる（外すのは待合室だけ）', await visible(h, '#proxyAdmin') && (await h.page.$$('.og-proxy-remove')).length === 0);
  if (!(await h.page.$eval('#proxyAdmin', (e) => e.open))) await h.page.click('#proxyAdmin > summary');
  await addProxy('ほし');
  check('P16 お題の間に足した', await waitUntil(async () => (await h.page.$$('#proxyAdminList li')).length === 2));
  await h.page.click('#btnNext');
  await startTopic(h, g);
  check('P17 前のお題の知らせは消える', (await text(h, '#proxyMsg')) === '');
  check('P18 だれの答えか選べる', (await h.page.$$eval('#proxyWho option', (els) => els.map((e) => e.textContent))).join('/') === 'そらさん/ほしさん');
  await answer(g, 'ほんにんのこたえ');
  await approve(h, 'ほんにんのこたえ');
  check('P19 端末のない2人のぶんを押せる', await waitUntil(async () => (await h.page.$$('#proxyPressList .og-proxy-press:not(:disabled)')).length === 2));
  await h.page.setViewportSize({ width: 375, height: 800 });
  await sleep(200);
  check('P20 幅375pxで横にはみ出さない', (await overflow(h)) <= 0, await overflow(h));
  await shot(h, 'p-proxy-375');
  await h.page.setViewportSize({ width: 1100, height: 900 });
  await h.page.click('#proxyPressList li:has-text("ほし") .og-proxy-press');
  check('P21 代わりに押した票で一本（そら・ほしの半分）', await waitUntil(async () => await ipponOn(g) && (await text(g, '#ipponName')) === 'りくさん'));
  let room = await roomOf(code);
  check('P22 押したのは、ほしのぶん', room.game?.cur?.presses?.['ほし'] === true || (room.game?.shown || []).some((a) => a.text === 'ほんにんのこたえ' && a.ippon), room.game?.cur);
  await waitScreen(h, 'result', 9000);
  await h.page.click('#btnFinish');
  await waitScreen(g, 'end');
  const counts = await g.page.$$eval('#endCounts .og-counts__item', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('P23 一本の数に端末のない子も入る（参加した順）', counts.length === 2 && counts[0].includes('りく') && counts[1].includes('そら'), counts);
  await h.page.click('#btnRestart');
  await waitScreen(g, 'waiting');
  check('P24 端末のない子は待合室に残る', (await text(g, '#lobbyPlayers')).includes('そら') && (await text(g, '#lobbyPlayers')).includes('ほし'));
  await setMode(h, '回答者');
  await setMode(h, '審査員');
  for (const name of ['そら', 'ほし']) {
    await h.page.click('#proxyAdminList li:has-text("' + name + '") .og-proxy-remove');
    await waitUntil(async () => !(await text(g, '#lobbyPlayers')).includes(name));
  }

  // ── Q. 再読み込み・途中参加・退出・入りなおし ──
  await h.page.click('#btnStart');
  await startTopic(h, g);
  await setMode(g, '回答者');
  await waitUntil(async () => !(await visible(g, '#answerForm')));
  await g.page.reload();
  check('Q1 再読み込みで同じ画面に戻る（参加スタイルも）', await waitUntil(async () => (await L.screen(g)) === 'play' && !(await visible(g, '#answerForm')) && (await L.roleOn(g)) === '審査員'));
  await setMode(g, '回答者');
  const late = await L.newClient('late');
  await L.joinRoom(late, 'あさひ', code, 'both', 'play');
  check('Q2 遊んでいる途中からも入れる', (await L.screen(late)) === 'play' && await visible(late, '#answerForm'));
  // りくの答えの審査員は、メンター・あさひ（2人）→ 一本は1人。全員にして、あさひが抜けたら数えなおす
  await answer(g, 'ぬけたらいっぽん');
  await approve(h, 'ぬけたらいっぽん');
  await waitUntil(async () => (await stage(late)) === 'ぬけたらいっぽん');
  await rest('PATCH', L.ROOMS + '/' + code + '/rule', { ratio: 'all' });
  await rest('PATCH', L.ROOMS + '/' + code + '/game/cur', { endsAt: Date.now() + 20000 });
  await h.page.click('#btnPress');
  await sleep(600);
  check('Q3 全員のときは、1人では一本にならない', !(await ipponOn(g)));
  await late.page.click('#btnLeave');
  check('Q4 抜けた人を数えずに、その場で一本', await waitUntil(async () => await ipponOn(g)));
  room = await roomOf(code);
  check('Q5 遊んでいる途中に抜けても、名前は残る', !!room.roster['あさひ'] && !room.players['あさひ']);
  await rest('PATCH', L.ROOMS + '/' + code + '/rule', { ratio: 'half' });
  await waitScreen(h, 'result', 9000);
  await L.joinRoom(late, 'あさひ', code, 'both', 'result');
  check('Q6 同じ人は同じ名前で入りなおせる', (await L.screen(late)) === 'result');
  const other = await L.newClient('other');
  await L.open(other, '?room=' + code);
  await waitScreen(other, 'join');
  await other.page.fill('#guestName', 'あさひ');
  await other.page.click('#btnJoinRoom');
  check('Q7 ほかの人は、抜けた人の名前でも入れない', await waitUntil(async () => ((await text(other, '#joinError')) || '').includes('その名前は使われている')));
  await other.page.close();

  // ── R. ホストの切断と復帰 ──
  await h.page.click('#btnNext');
  await startTopic(h, g);
  await answer(g, 'きれてもまつ');
  await approve(h, 'きれてもまつ');
  await waitUntil(async () => (await stage(late)) === 'きれてもまつ');
  h.offlineOk = true;
  await h.context.setOffline(true);
  check('R1 ホストが切れると、参加者にオーバーレイ', await waitUntil(async () => await visible(g, '#hostOffOverlay'), 90000));
  await rest('PATCH', L.ROOMS + '/' + code + '/game/cur', { endsAt: Date.now() - 1000 });
  check('R2 ホストがいない間も、参加者の端末が押せる時間を終わらせる', await waitUntil(async () => (await stage(g)) === '' && (await listRows(g, '#shownList')).some((r) => r.t === 'きれてもまつ'), 8000));
  await h.context.setOffline(false);
  check('R3 ホストが戻るとオーバーレイが消える', await waitUntil(async () => !(await visible(g, '#hostOffOverlay')), 30000));
  h.offlineOk = false;
  await answer(g, 'もどったあと');
  await approve(h, 'もどったあと');
  check('R4 戻ったあとも続けて遊べる', await waitUntil(async () => (await stage(late)) === 'もどったあと'));
  await endWindow(code);
  await waitUntil(async () => (await stage(late)) === '');

  // ── S. レビューの指摘の確認 ──
  // 一本が出ても、順番待ちの答えは最後まで出してから結果へ（2026-10-30 オーナー判断。ホストが先に締め切っていても同じ）
  await answer(g, 'えすいち');
  await approve(h, 'えすいち');
  await waitUntil(async () => (await stage(late)) === 'えすいち');
  // 1人が出しておけるのは1つなので、順番待ちはあさひの答え
  await answer(late, 'えすに');
  await approve(h, 'えすに');
  check('S1 順番待ちに1つ', await waitUntil(async () => (await h.page.$$('#queueList li')).length === 1));
  await h.page.click('#btnClose');
  await waitUntil(async () => (await text(g, '#playClosed')).includes('締め切った'));
  await late.page.click('#btnPress');
  check('S2 一本のあとも、順番待ちの答えが出る（押すこともできる）', await waitUntil(async () => (await stage(g)) === 'えすに', 10000) && await visible(g, '#btnPress'));
  await g.page.click('#btnPress');
  check('S2b 一本のあとの答えも一本になれる', await waitUntil(async () => await ipponOn(late) && (await text(late, '#ipponText')) === 'えすに'));
  check('S2c 出し終えたら結果へ（一本が2つ）', await waitUntil(async () => (await L.screen(late)) === 'result', 10000) && (await listRows(late, '#resultIppon')).length === 2);

  // 「一本が出たら」で一本が出ても、順番待ちを出しきる（ホストが締め切っていないとき）
  await h.page.click('#btnNext');
  await startTopic(h, g);
  await answer(g, 'てぃーいち');
  await approve(h, 'てぃーいち');
  await waitUntil(async () => (await stage(late)) === 'てぃーいち');
  await answer(late, 'てぃーに');
  await approve(h, 'てぃーに');
  await waitUntil(async () => (await h.page.$$('#queueList li')).length === 1);
  await late.page.click('#btnPress');
  check('T1 一本が出たら受付は締め切る', await waitUntil(async () => !(await visible(g, '#answerForm')) && (await text(g, '#playClosed')).includes('一本が出た')));
  check('T2 順番待ちの答えは最後まで出る', await waitUntil(async () => (await stage(late)) === 'てぃーに', 10000));
  await endWindow(code);
  check('T3 出し終えたら結果へ。一本にならなかった答えは名前なしで並ぶ', await waitUntil(async () => (await L.screen(late)) === 'result', 10000) && (await listRows(g, '#resultOthers')).some((r) => r.t === 'てぃーに' && r.w === '') && (await listRows(late, '#resultOthers')).some((r) => r.t === 'てぃーに' && r.w === 'あなた'));
  // 一本を出している途中の「ここでおしまい」でも、その一本はおしまいの画面に入る
  await h.page.click('#btnNext');
  await startTopic(h, g);
  await answer(g, 'さいごのいっぽん');
  await approve(h, 'さいごのいっぽん');
  await waitUntil(async () => (await stage(late)) === 'さいごのいっぽん');
  await answer(late, 'でないまま');
  await waitUntil(async () => (await text(h, '#queueList')).includes('でないまま'));
  await late.page.click('#btnPress');
  await waitUntil(async () => await ipponOn(h));
  h.dialogs.length = 0;
  await h.page.click('#btnEnd');
  check('S4 おしまいの確認に、まだ出ていない答えの数が出る', h.dialogs.some((m) => m.includes('まだ出ていない答えが1つ')), h.dialogs);
  await waitScreen(g, 'end');
  const lastHist = await g.page.$$eval('#endHistory .og-history__item', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('S3 一本の途中でおしまいにしても、その一本が残る', lastHist[lastHist.length - 1].includes('さいごのいっぽん'), lastHist);

  await h.page.click('#btnLeave');
  check('Z1 ルームを閉じる', await waitUntil(async () => (await L.screen(g)) === 'top' && (await roomOf(code)) === null));
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
