// ひらめき大喜利 E2E その1: 作成・参加・待合室・お題・答え・確認・一本・結果・押せる時間の終わり・かくす・
// 参加のしかた・おしまい・もう一回あそぶ・時間で区切る・みんなにみせる画面・幅 375px・ルームを閉じる
// 時間の進みは、エミュレーターのルームの時刻（endsAt・roundEndsAt）を書きかえて早める
const L = require('./lib.cjs');
const { check, sleep, rest, roomOf, roomWhen, text, visible, waitScreen, overflow, waitUntil, stage, listRows, ipponOn, answer, approve, setMode, stats, waitStats, bodyText } = L;
const path = require('path');

const shot = (c, name) => c.page.screenshot({ path: path.join(L.OUT, name + '.png'), fullPage: true });
const segOn = (c, sel) => c.page.$eval(sel + ' .og-seg__btn.is-on', (e) => e.textContent);
// いま出ている答えの押せる時間を、すぐ終わらせる
async function endWindow(code) {
  await rest('PATCH', L.ROOMS + '/' + code + '/game/cur', { endsAt: Date.now() - 1000 });
}

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── A. 作成・参加・待合室 ──
  const h = await L.newClient('host');
  const code = await L.createRoom(h, 'メンター');
  check('A1 ルームができる', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('A2 room-create を数える', await L.waitStats(h, 'room-create', 1));
  check('A3 ホストのすること（画面共有の案内）はホストに出る', await visible(h, '#lobbyGuide'));
  check('A4 ルールはホストに出る', await visible(h, '#lobbyHost'));
  check('A5 はじめの設定: 半分・15秒・一本が出たら', (await segOn(h, '#ratioOpts')) === '半分' && (await segOn(h, '#showOpts')) === '15秒' && (await segOn(h, '#cutOpts')) === '一本が出たら');
  check('A6 ホストの参加のしかたは「答えも出す」（3つから）', (await segOn(h, '#modeOpts')) === '答えも出す' && (await h.page.$$eval('#modeOpts .og-seg__btn', (e) => e.length)) === 3);
  check('A7 投票する人が1人では、はじめられない', await h.page.isDisabled('#btnStart'));
  let room = await roomOf(code);
  check('A8 ルームの初期値', room.status === 'waiting' && room.rule.ratio === 'half' && room.rule.showSec === 15 && room.players['メンター'].mode === 'both' && room.roster['メンター'], room);

  const g1 = await L.newClient('g1');
  await L.joinRoom(g1, 'あお', code);
  check('A9 参加画面はリンクのヒントを出していた（参加できた）', (await L.screen(g1)) === 'waiting');
  check('A10 参加者にはホストのすること・ルールが出ない', !(await visible(g1, '#lobbyGuide')) && !(await visible(g1, '#lobbyHost')) && await visible(g1, '#lobbyWait'));
  check('A11 参加者の参加のしかたは2つ', (await g1.page.$$eval('#modeOpts .og-seg__btn', (e) => e.map((x) => x.textContent).join('/'))) === '答えも出す/投票だけ');
  const g2 = await L.newClient('g2');
  await L.joinRoom(g2, 'みどり', code, 'press');
  check('A12 投票だけで参加', (await segOn(g2, '#modeOpts')) === '投票だけ');
  room = await roomOf(code);
  check('A13 参加のしかたはルームの在室に入る', room.players['みどり'].mode === 'press' && room.players['あお'].mode === 'both');
  const lobbyText = await text(g1, '#lobbyPlayers');
  check('A14 参加者の一覧に参加のしかたの印はない', lobbyText.includes('あお') && lobbyText.includes('みどり') && !lobbyText.includes('投票だけ'), lobbyText);

  const dup = await L.newClient('dup');
  await L.open(dup, '?room=' + code);
  await waitScreen(dup, 'join');
  await dup.page.fill('#guestName', 'あお');
  await dup.page.click('#btnJoinRoom');
  check('A15 同じ名前は入れない', await waitUntil(async () => ((await text(dup, '#joinError')) || '').includes('その名前は使われている')));
  await dup.page.fill('#guestName', 'メンター');
  await dup.page.click('#btnJoinRoom');
  check('A16 ホストと同じ名前も入れない', await waitUntil(async () => ((await text(dup, '#joinError')) || '').includes('その名前は使われている')));
  await dup.page.fill('#guestName', 'toString');
  await dup.page.click('#btnJoinRoom');
  check('A16b ほかのものとぶつかる名前（toString）は使えない', await waitUntil(async () => ((await text(dup, '#joinError')) || '').includes('その名前は使えない')));
  await dup.page.close();

  // みんなにみせる画面（待合室のボタンから）
  const [tvPage] = await Promise.all([h.context.waitForEvent('page'), h.page.click('#btnWatchGuide')]);
  const tv = await (async () => {
    const c = { label: 'tv', context: h.context, page: tvPage, errors: [] };
    tvPage.on('pageerror', (e) => c.errors.push('pageerror: ' + e.message));
    tvPage.on('console', (m) => { if (m.type() === 'error') c.errors.push(m.text()); });
    L.clients.push(c);
    return c;
  })();
  await tvPage.waitForFunction(() => document.querySelector('.og-screen.active')?.id === 'screen-waiting', null, { timeout: 8000 });
  check('A17 みんなにみせる画面がひらく（見るだけ）', tvPage.url().includes('watch=' + code) && !(await visible(tv, '#modeCard')) && !(await visible(tv, '#lobbyGuide')) && !(await visible(tv, '#lobbyWait')));
  room = await roomOf(code);
  check('A18 みんなにみせる画面はルームに書きこまない', Object.keys(room.players).length === 3, Object.keys(room.players));

  // 設定（参加者のあそびかたにも出る）
  await h.page.click('#showOpts .og-seg__btn:text-is("10秒")');
  check('A19 見る時間を10秒に', !!(await roomWhen(code, (r) => r.rule.showSec === 10)));
  await h.page.click('#ratioOpts .og-seg__btn:text-is("全員")');
  check('A20 一本になる数「全員」があそびかたに出る', await waitUntil(async () => (await text(g1, '#howtoRatio')).includes('全員')));
  await h.page.click('#ratioOpts .og-seg__btn:text-is("半分")');
  await waitUntil(async () => (await text(g1, '#howtoRatio')).includes('半分'));
  check('A21 投票する人3人', await waitUntil(async () => !(await h.page.isDisabled('#btnStart')) && (await text(h, '#lobbyStartNote')).includes('3人')));

  // ── B. お題を選ぶ ──
  await h.page.click('#btnStart');
  await waitScreen(h, 'pick');
  const cands = await h.page.$$eval('#pickCands .og-cand', (els) => els.map((e) => e.textContent));
  check('B1 候補は3つで、①②③がつく', cands.length === 3 && cands[0].startsWith('①') && cands[2].startsWith('③'), cands);
  check('B2 参加者はお題を選んでいるのを待つ', await waitUntil(async () => (await L.screen(g1)) === 'pick' && await visible(g1, '#pickOther') && !(await visible(g1, '#pickHost'))));
  check('B3 ホストの画面の下に「ここでおしまい」', await visible(h, '#btnEndPick') && !(await visible(g1, '#btnEndPick')));
  await h.page.click('#btnReroll');
  check('B4 ほかの候補は、いまの3つと重ならない', await waitUntil(async () => {
    const next = await h.page.$$eval('#pickCands .og-cand', (els) => els.map((e) => e.textContent.slice(1)));
    return next.length === 3 && next.every((t) => !cands.map((x) => x.slice(1)).includes(t));
  }));
  const chosen = (await h.page.$eval('#pickCands .og-cand', (e) => e.textContent)).slice(1);
  await h.page.click('#pickCands .og-cand >> nth=0');
  await waitScreen(g1, 'play');
  check('B5 お題が出る', (await text(g1, '#playTopic')) === chosen && (await text(tv, '#playTopic')) === chosen);
  check('B6 start・players-3 を数える', await waitStats(h, 'start', 1) && await waitStats(h, 'players-3', 1));
  check('B7 一本で区切ることが出る', await visible(g1, '#playRule') && !(await visible(g1, '#playLeft')));
  check('B8 投票だけの人には答えの入力欄がない', !(await visible(g2, '#answerForm')) && !(await visible(g2, '#myCard')) && await visible(g1, '#answerForm'));
  check('B9 ホストの枠はホストにだけ', await visible(h, '#hostPanel') && !(await visible(g1, '#hostPanel')) && !(await visible(tv, '#hostPanel')));

  // ── C. 答え・確認・一本 ──
  await answer(g1, 'こたえいち');
  check('C1 参加者の答えはホストの確認待ち', await waitUntil(async () => (await text(h, '#checkList')).includes('こたえいち') && (await text(h, '#checkList')).includes('あおさん')));
  check('C2 書いた人の画面に「ホストが確認中」', await waitUntil(async () => (await listRows(g1, '#mineList')).some((r) => r.t === 'こたえいち' && r.w === 'ホストが確認中')));
  check('C3 入力欄は空になり、知らせが出る', await waitUntil(async () => (await g1.page.inputValue('#answerInput')) === '' && (await text(g1, '#answerMsg')).includes('ホストが確認したら')));
  check('C4 ほかの人・みんなにみせる画面には、確認待ちの答えは出ない', !(await bodyText(g2)).includes('こたえいち') && !(await bodyText(tv)).includes('こたえいち'));
  check('C5 いま出ている答えがないときの案内（ホスト）', (await text(h, '#stageEmpty')).includes('みんなに出す'));
  await approve(h, 'こたえいち');
  check('C6 みんなに出すと、全員の画面に出る', await waitUntil(async () => (await stage(g2)) === 'こたえいち' && (await stage(tv)) === 'こたえいち' && (await stage(g1)) === 'こたえいち'));
  check('C7 名前は出ない', !(await bodyText(g2)).includes('あおさん') && !(await bodyText(tv)).includes('あおさん'));
  check('C8 書いた人は押せず「あなたの答え」', !(await visible(g1, '#btnPress')) && await visible(g1, '#stageMine'));
  check('C9 みんなにみせる画面には押すボタンがなく、案内が出る', !(await visible(tv, '#btnPress')) && (await text(tv, '#stageHint')).includes('自分の画面'));
  check('C10 押せる時間の帯', await waitUntil(async () => /あと \d+秒/.test(await text(g2, '#stageSec'))));
  // 投票する人はホストとみどり（2人）。半分は1人
  await g2.page.click('#btnPress');
  check('C11 一本！（みんなにみせる画面に名前つきで大きく出る）', await waitUntil(async () => await ipponOn(tv) && (await text(tv, '#ipponName')) === 'あおさん' && (await text(tv, '#ipponText')) === 'こたえいち'));
  check('C12 一本が出たら締め切る', await waitUntil(async () => !(await visible(g1, '#answerForm')) && (await text(g1, '#playClosed')).includes('一本が出た')));
  check('C13 一本を出し終えたら結果へ', await waitUntil(async () => (await L.screen(g1)) === 'result', 8000));
  check('C14 finish を数える', await waitStats(h, 'finish', 1));
  check('C15 結果に一本（名前つき）', await waitUntil(async () => (await listRows(tv, '#resultIppon')).some((r) => r.t === 'こたえいち' && r.w === 'あおさん' && r.ippon)));
  check('C16 参加者は待つ・ホストは次へ', await visible(g1, '#resultWait') && await visible(h, '#resultHost') && !(await visible(tv, '#resultWait')));

  // ── D. 次のお題・押せる時間の終わり・かくす・順番待ちの数 ──
  await h.page.click('#btnNext');
  check('D1 again を数える', await waitStats(h, 'again', 1));
  await waitScreen(h, 'pick');
  const second = (await h.page.$eval('#pickCands .og-cand', (e) => e.textContent)).slice(1);
  check('D2 前のお題は候補に出ない', second !== chosen);
  await h.page.click('#pickCands .og-cand >> nth=0');
  await waitScreen(g1, 'play');
  check('D3 前のお題の自分の答えは消える', (await listRows(g1, '#mineList')).length === 0 && (await text(g1, '#answerMsg')) === '');
  await answer(g1, 'にばんめ');
  await waitUntil(async () => (await g1.page.inputValue('#answerInput')) === '');
  await answer(g1, 'さんばんめ');
  await waitUntil(async () => (await g1.page.inputValue('#answerInput')) === '');
  check('D4 確認待ち・順番待ちは2つまで（出すボタンが押せない）', await waitUntil(async () => await g1.page.isDisabled('#btnAnswer') && (await text(g1, '#answerMsg')).includes('2つ')));
  await h.page.click('#checkList li:has-text("さんばんめ") .og-reject');
  check('D5 かくした答えは、書いた人にだけ「ホストがかくした」', await waitUntil(async () => (await listRows(g1, '#mineList')).some((r) => r.t === 'さんばんめ' && r.w === 'ホストがかくした')));
  check('D6 かくすと、また出せる', await waitUntil(async () => !(await g1.page.isDisabled('#btnAnswer'))));
  await approve(h, 'にばんめ');
  await waitUntil(async () => (await stage(g2)) === 'にばんめ');
  await endWindow(code);
  check('D7 押せる時間が終わると、名前なしで「これまでに出た答え」へ', await waitUntil(async () => (await stage(g2)) === '' && (await listRows(g2, '#shownList')).some((r) => r.t === 'にばんめ' && r.w === '' && !r.ippon)));
  check('D8 書いた人には「あなた」', (await listRows(g1, '#shownList')).some((r) => r.t === 'にばんめ' && r.w === 'あなた'));
  check('D9 一本にならなかった答えの押した数は出ない', !/\d+人/.test(await text(g2, '#shownList')));
  // ホスト自身の答えは確認しない
  await answer(h, 'ほすとのこたえ');
  check('D10 ホストの答えは確認なしで出る', await waitUntil(async () => (await stage(g1)) === 'ほすとのこたえ'));
  await h.page.click('#btnHideCur');
  check('D11 いま出ている答えもかくせる', await waitUntil(async () => (await stage(g1)) === '' && !(await text(g1, '#shownList')).includes('ほすとのこたえ')));

  // 参加のしかた
  await setMode(g1, '投票だけ');
  check('D12 投票だけにすると入力欄が消える', await waitUntil(async () => !(await visible(g1, '#answerForm'))));
  await setMode(g1, '答えも出す');
  check('D13 答えも出すに戻すと入力欄が出る', await waitUntil(async () => await visible(g1, '#answerForm')));
  await setMode(h, '進行だけ');
  check('D14 ホストは進行だけにできる', !!(await roomWhen(code, (r) => r.players['メンター'].mode === 'none')));
  // あおの答えに投票する人はみどりだけ。半分は1人
  await answer(g1, 'しんこうだけ');
  await approve(h, 'しんこうだけ');
  await waitUntil(async () => (await stage(g2)) === 'しんこうだけ');
  check('D15 進行だけのホストには押すボタンがない', !(await visible(h, '#btnPress')));
  await g2.page.click('#btnPress');
  check('D16 押したら「押したよ」で押せなくなる', await waitUntil(async () => await ipponOn(g2) || ((await text(g2, '#btnPressLabel')) === '押したよ' && await g2.page.isDisabled('#btnPress'))));
  check('D17 進行だけのホストを数えずに一本', await waitUntil(async () => await ipponOn(g1)));
  await waitScreen(g1, 'result', 8000);
  check('D18 結果に一本', (await listRows(g1, '#resultIppon')).some((r) => r.t === 'しんこうだけ'));
  await setMode(h, '答えも出す');

  // ── E. おしまい・もう一回あそぶ ──
  await h.page.click('#btnFinish');
  await waitScreen(g1, 'end');
  const counts = await g1.page.$$eval('#endCounts .og-counts__item', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('E1 一本の数（1本以上の人だけ）', counts.length === 1 && counts[0].includes('あお') && counts[0].includes('2本'), counts);
  const hist = await g1.page.$$eval('#endHistory .og-history__item', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('E2 お題ごとの一本', hist.length === 2 && hist[0].includes('こたえいち') && hist[1].includes('しんこうだけ'), hist);
  check('E3 もう一回あそぶはホストだけ', await visible(h, '#btnRestart') && !(await visible(g1, '#btnRestart')) && await visible(g1, '#endWait'));
  await h.page.click('#btnRestart');
  await waitScreen(g1, 'waiting');
  check('E4 again を数える', await waitStats(h, 'again', 2));
  room = await roomOf(code);
  check('E5 もう一回あそぶでゲームを消し、使ったお題は残す', !room.game && room.usedTopics.length === 2, room.usedTopics);

  // ── F. 時間で区切る ──
  await h.page.click('#cutOpts .og-seg__btn:text-is("時間で")');
  await waitUntil(async () => await visible(h, '#timeOpts'));
  await h.page.click('#timeOpts .og-seg__btn:text-is("2分")');
  check('F1 あそびかたに2分', await waitUntil(async () => (await text(g1, '#howtoCut')).includes('2分')));
  await h.page.click('#btnStart');
  await waitScreen(h, 'pick');
  await h.page.click('#pickCands .og-cand >> nth=0');
  await waitScreen(g1, 'play');
  check('F2 のこり時間が出る', await waitUntil(async () => /のこり [12]:\d\d/.test(await text(g1, '#playLeft'))) && !(await visible(g1, '#playRule')));
  await answer(g1, 'じかんない');
  await approve(h, 'じかんない');
  await waitUntil(async () => (await stage(g2)) === 'じかんない');
  await g2.page.click('#btnPress');
  check('F3 時間で区切るときは、一本が出ても締め切らない', await waitUntil(async () => await ipponOn(g2)) && await visible(g1, '#answerForm'));
  await answer(g1, 'まにあわず');
  await waitUntil(async () => (await text(h, '#checkList')).includes('まにあわず'));
  await rest('PATCH', L.ROOMS + '/' + code + '/game', { roundEndsAt: Date.now() + 300 });
  check('F4 時間になったら締め切る', await waitUntil(async () => !(await visible(g1, '#answerForm')) && (await text(g1, '#playClosed')).includes('時間になった')));
  check('F5 締め切ったら、のこり時間は消える', !(await visible(g1, '#playLeft')));
  await sleep(1200);
  check('F6 確認待ちの答えがあると結果へ進まない', (await L.screen(g1)) === 'play' && await visible(h, '#checkCard'));
  check('F6b 確認待ちの答えに、自動で出るまでの秒が出る', /あと\d+秒で出るよ/.test(await text(h, '#checkList')), await text(h, '#checkList'));
  // ホストが押し忘れても、届いてから10秒で出る（エミュレーターの届いた時刻を前へずらして早める）
  await rest('PATCH', L.ROOMS + '/' + code + '/game/pending/0', { at: Date.now() - 10000 });
  check('F7 押し忘れた答えも、締め切ったあとに自動で出る', await waitUntil(async () => (await stage(g2)) === 'まにあわず'));
  await endWindow(code);
  check('F8 出終わったら結果へ', await waitUntil(async () => (await L.screen(g1)) === 'result'));
  check('F9 時間内の一本が結果に出る', (await listRows(g1, '#resultIppon')).some((r) => r.t === 'じかんない'));

  // ── G. 幅 375px ──
  for (const c of [h, g1, tv]) await c.page.setViewportSize({ width: 375, height: 800 });
  await h.page.click('#btnNext');
  await waitScreen(h, 'pick');
  await h.page.click('#pickCands .og-cand >> nth=0');
  await waitScreen(g1, 'play');
  await answer(g1, 'すまほのはばで、ながめのこたえをかいてみる');
  await waitUntil(async () => (await text(h, '#checkList')).includes('すまほ'));
  for (const c of [h, g1, tv]) check('G1 幅375pxで横にはみ出さない: ' + c.label, (await overflow(c)) <= 0, await overflow(c));
  await shot(h, 'g-host-375');
  await shot(g1, 'g-guest-375');
  const order = await h.page.evaluate(() => ['stage', 'hostPanel', 'myCard', 'shownCard'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)));
  check('G2 せまい画面では、ホストの枠が「いま出ている答え」のすぐ下', order[0] < order[1] && order[1] < order[2] && order[2] < order[3], order);
  await approve(h, 'すまほ');
  await waitUntil(async () => (await stage(tv)).startsWith('すまほ'));
  await shot(tv, 'g-tv-375');
  for (const c of [h, g1, tv]) await c.page.setViewportSize({ width: 1100, height: 900 });
  await shot(h, 'g-host-1100');
  await shot(tv, 'g-tv-1100');

  // ── H. ルームを閉じる ──
  await h.page.click('#btnLeave');
  check('H1 ルームを閉じると参加者はトップへ', await waitUntil(async () => (await L.screen(g1)) === 'top' && (await L.screen(g2)) === 'top'));
  check('H2 みんなにみせる画面は「閉じられました」', await waitUntil(async () => (await L.screen(tv)) === 'watch-end'));
  check('H3 ルームは消える', (await roomOf(code)) === null);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
