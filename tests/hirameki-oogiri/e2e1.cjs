// ひらめき大喜利 E2E その1: 作成・参加・待合室・お題・答え（確認なし）・おもしろゲージ・一本・結果・押せる時間の終わり・
// 審査が終わるまで出せない・却下・かくす・参加スタイル（回答者・審査員）・おしまい・もう一回あそぶ・時間で区切る・
// みんなにみせる画面・幅 375px・ルームを閉じる
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
  check('A6 ホストの参加スタイルは回答者と審査員の両方', (await L.roleOn(h)) === '回答者+審査員' && (await h.page.$$eval('#modeOpts .og-seg__btn', (e) => e.length)) === 2);
  check('A7 審査員が1人では、はじめられない', await h.page.isDisabled('#btnStart'));
  let room = await roomOf(code);
  check('A8 ルームの初期値', room.status === 'waiting' && room.rule.ratio === 'half' && room.rule.showSec === 15 && room.players['メンター'].mode === 'both' && room.roster['メンター'], room);

  const g1 = await L.newClient('g1');
  await L.joinRoom(g1, 'あお', code);
  check('A9 参加できる（はじめは回答者と審査員の両方）', (await L.screen(g1)) === 'waiting' && (await L.roleOn(g1)) === '回答者+審査員');
  check('A10 参加者にはホストのすること・ルールが出ない', !(await visible(g1, '#lobbyGuide')) && !(await visible(g1, '#lobbyHost')) && await visible(g1, '#lobbyWait'));
  const g2 = await L.newClient('g2');
  await L.joinRoom(g2, 'みどり', code, 'judge');
  check('A11 審査員だけで参加', (await L.roleOn(g2)) === '審査員');
  check('A12 参加者は両方を外せない（残り1つのボタンは押せない）', await g2.page.isDisabled('#modeOpts .og-seg__btn:text-is("審査員")') && !(await g2.page.isDisabled('#modeOpts .og-seg__btn:text-is("回答者")')));
  room = await roomOf(code);
  check('A13 参加スタイルはルームの在室に入る', room.players['みどり'].mode === 'judge' && room.players['あお'].mode === 'both');
  const lobbyText = await text(g1, '#lobbyPlayers');
  check('A14 参加者の一覧に参加スタイルの印はない', lobbyText.includes('あお') && lobbyText.includes('みどり') && !lobbyText.includes('審査員'), lobbyText);

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
  await dup.page.fill('#guestName', 'きいろ');
  await dup.page.uncheck('#joinAnswer');
  await dup.page.uncheck('#joinJudge');
  await dup.page.click('#btnJoinRoom');
  check('A16c 回答者も審査員も選ばないと参加できない', await waitUntil(async () => ((await text(dup, '#joinError')) || '').includes('「回答者」か「審査員」')));
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
  check('A21 審査員3人', await waitUntil(async () => !(await h.page.isDisabled('#btnStart')) && (await text(h, '#lobbyStartNote')).includes('審査員 3人')));

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
  check('B8 審査員だけの人には答えの入力欄がない', !(await visible(g2, '#answerForm')) && !(await visible(g2, '#myCard')) && await visible(g1, '#answerForm'));
  check('B9 ホストの枠はホストにだけ', await visible(h, '#hostPanel') && !(await visible(g1, '#hostPanel')) && !(await visible(tv, '#hostPanel')));

  // ── C. 答え（確認なし）・おもしろゲージ・一本 ──
  await answer(g1, 'こたえいち');
  check('C1 答えはホストの確認なしで、すぐ全員の画面に出る', await waitUntil(async () => (await stage(g2)) === 'こたえいち' && (await stage(tv)) === 'こたえいち' && (await stage(g1)) === 'こたえいち'));
  check('C2 書いた人の画面に「いま審査中」', await waitUntil(async () => (await listRows(g1, '#mineList')).some((r) => r.t === 'こたえいち' && r.w === 'いま審査中')));
  check('C3 入力欄は空になる', await waitUntil(async () => (await g1.page.inputValue('#answerInput')) === ''));
  check('C3b 審査が終わるまで「出す」は押せない（書くことはできる）', await waitUntil(async () => await g1.page.isDisabled('#btnAnswer') && !(await g1.page.isDisabled('#answerInput')) && (await text(g1, '#answerMsg')).includes('審査が終わったら')));
  check('C4 ゲージははじめ空', (await L.gauge(tv)) === 0 && (await L.gauge(g2)) === 0);
  check('C5 確認の欄はなく、ホストに「却下」', await visible(h, '#btnReject') && !(await visible(g1, '#btnReject')) && !(await visible(tv, '#btnReject')));
  check('C7 名前は出ない', !(await bodyText(g2)).includes('あおさん') && !(await bodyText(tv)).includes('あおさん'));
  check('C8 書いた人は押せず「あなたの答え」', !(await visible(g1, '#btnPress')) && await visible(g1, '#stageMine'));
  check('C9 みんなにみせる画面には押すボタンがなく、案内が出る', !(await visible(tv, '#btnPress')) && (await text(tv, '#stageHint')).includes('自分の画面'));
  check('C10 押せる時間の帯', await waitUntil(async () => /あと \d+秒/.test(await text(g2, '#stageSec'))));
  // 審査員はホストとみどり（2人）。半分は1人
  await g2.page.click('#btnPress');
  check('C11 一本！（みんなにみせる画面に名前つきで大きく出る）', await waitUntil(async () => await ipponOn(tv) && (await text(tv, '#ipponTitle')) === '一本！' && (await text(tv, '#ipponName')) === 'あおさん' && (await text(tv, '#ipponText')) === 'こたえいち'));
  check('C11b ゲージが一本の線までたまる', (await L.gauge(tv)) === 100 && await tv.page.$eval('#gauge', (e) => e.classList.contains('is-full')));
  check('C12 一本が出たら締め切る', await waitUntil(async () => !(await visible(g1, '#answerForm')) && (await text(g1, '#playClosed')).includes('一本が出た')));
  check('C13 一本を出し終えたら結果へ', await waitUntil(async () => (await L.screen(g1)) === 'result', 8000));
  check('C14 finish を数える', await waitStats(h, 'finish', 1));
  check('C15 結果に一本（名前つき）', await waitUntil(async () => (await listRows(tv, '#resultIppon')).some((r) => r.t === 'こたえいち' && r.w === 'あおさん' && r.ippon)));
  check('C16 参加者は待つ・ホストは次へ', await visible(g1, '#resultWait') && await visible(h, '#resultHost') && !(await visible(tv, '#resultWait')));

  // ── D. 次のお題・押せる時間の終わり・審査が終わるまで出せない・却下・かくす・参加スタイル ──
  await h.page.click('#btnNext');
  check('D1 again を数える', await waitStats(h, 'again', 1));
  await waitScreen(h, 'pick');
  const second = (await h.page.$eval('#pickCands .og-cand', (e) => e.textContent)).slice(1);
  check('D2 前のお題は候補に出ない', second !== chosen);
  await h.page.click('#pickCands .og-cand >> nth=0');
  await waitScreen(g1, 'play');
  check('D3 前のお題の自分の答えは消える', (await listRows(g1, '#mineList')).length === 0 && (await text(g1, '#answerMsg')) === '');
  await answer(g1, 'にばんめ');
  await waitUntil(async () => (await stage(g2)) === 'にばんめ');
  await g1.page.fill('#answerInput', 'さんばんめ');
  check('D4 審査中は、次の答えを書けるが「出す」は押せない', await g1.page.isDisabled('#btnAnswer') && (await g1.page.inputValue('#answerInput')) === 'さんばんめ');
  // 押せる時間を「全員」で見る（あおの答えの審査員はホストとみどり。全員は2人）
  await rest('PATCH', L.ROOMS + '/' + code + '/rule', { ratio: 'all' });
  await g2.page.click('#btnPress');
  check('D5 おもしろゲージが半分たまる（数字は出さない）', await waitUntil(async () => (await L.gauge(tv)) === 50) && !/\d+人/.test(await text(tv, '#stage')));
  await endWindow(code);
  check('D7 押せる時間が終わると、名前なしで「これまでに出た答え」へ', await waitUntil(async () => (await stage(g2)) === '' && (await listRows(g2, '#shownList')).some((r) => r.t === 'にばんめ' && r.w === '' && !r.ippon)));
  check('D8 書いた人には「あなた」', (await listRows(g1, '#shownList')).some((r) => r.t === 'にばんめ' && r.w === 'あなた'));
  check('D9 審査が終わったら、また出せる', await waitUntil(async () => !(await g1.page.isDisabled('#btnAnswer'))));
  await g1.page.click('#btnAnswer');
  await waitUntil(async () => (await stage(g2)) === 'さんばんめ');
  // このあと出る答えは、出る前にかくせる
  await answer(h, 'まつこたえ');
  check('D10 このあと出る答えは、ホストにだけ名前つきで出る', await waitUntil(async () => (await text(h, '#queueList')).includes('まつこたえ') && (await text(h, '#queueList')).includes('メンターさん')));
  await h.page.click('#queueList li:has-text("まつこたえ") .og-list__btn');
  check('D11 かくした答えは、書いた人にだけ「ホストがかくした」', await waitUntil(async () => (await listRows(h, '#mineList')).some((r) => r.t === 'まつこたえ' && r.w === 'ホストがかくした')));
  // 却下（いま出ている答え）
  await g2.page.click('#btnPress');
  await waitUntil(async () => (await L.gauge(tv)) === 50);
  await h.page.click('#btnReject');
  check('D12 却下！が大きく出る（名前も答えの文も出さない）', await waitUntil(async () => await ipponOn(tv) && (await text(tv, '#ipponTitle')) === '却下！' && (await text(tv, '#ipponName')) === '' && !(await text(tv, '#ipponText')).includes('さんばんめ') && !(await bodyText(tv)).includes('さんばんめ')));
  check('D13 却下した答えは出た答えに並ばず、書いた人には「却下」', await waitUntil(async () => (await stage(g2)) === '' && !(await text(g2, '#shownList')).includes('さんばんめ') && (await listRows(g1, '#mineList')).some((r) => r.t === 'さんばんめ' && r.w === '却下'), 8000));
  await rest('PATCH', L.ROOMS + '/' + code + '/rule', { ratio: 'half' });

  // 参加スタイル
  await setMode(g1, '回答者');
  check('D14 回答者を外すと入力欄が消える', await waitUntil(async () => !(await visible(g1, '#answerForm')) && (await L.roleOn(g1)) === '審査員'));
  await setMode(g1, '回答者');
  await setMode(g1, '審査員');
  check('D15 回答者だけにできる', await waitUntil(async () => (await L.roleOn(g1)) === '回答者' && await visible(g1, '#answerForm')) && !!(await roomWhen(code, (r) => r.players['あお'].mode === 'answer')));
  await setMode(g1, '審査員');
  await setMode(h, '回答者');
  await setMode(h, '審査員');
  check('D16 ホストは両方外して進行だけにできる', !!(await roomWhen(code, (r) => r.players['メンター'].mode === 'none')) && (await L.roleOn(h)) === '');
  // あおの答えの審査員はみどりだけ。半分は1人
  await answer(g1, 'しんこうだけ');
  await waitUntil(async () => (await stage(g2)) === 'しんこうだけ');
  check('D17 進行だけのホストには押すボタンがない', !(await visible(h, '#btnPress')));
  await g2.page.click('#btnPress');
  check('D18 進行だけのホストを数えずに一本', await waitUntil(async () => await ipponOn(g1) && (await text(g1, '#ipponTitle')) === '一本！'));
  await waitScreen(g1, 'result', 8000);
  check('D19 結果に一本・却下した答えは並ばない', (await listRows(g1, '#resultIppon')).some((r) => r.t === 'しんこうだけ') && !(await text(g1, '#resultOthers')).includes('さんばんめ'));
  await setMode(h, '回答者');
  await setMode(h, '審査員');

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
  await waitUntil(async () => (await stage(g2)) === 'じかんない');
  await g2.page.click('#btnPress');
  check('F3 時間で区切るときは、一本が出ても締め切らない', await waitUntil(async () => await ipponOn(g2)) && await visible(g1, '#answerForm'));
  await waitUntil(async () => !(await g1.page.isDisabled('#btnAnswer')), 8000);
  await answer(g1, 'まにあわず');
  await waitUntil(async () => (await stage(g2)) === 'まにあわず');
  await rest('PATCH', L.ROOMS + '/' + code + '/game', { roundEndsAt: Date.now() + 300 });
  check('F4 時間になったら締め切る', await waitUntil(async () => !(await visible(g1, '#answerForm')) && (await text(g1, '#playClosed')).includes('時間になった')));
  check('F5 締め切ったら、のこり時間は消える', !(await visible(g1, '#playLeft')));
  await sleep(1200);
  check('F6 出ている答えがあるあいだは結果へ進まない', (await L.screen(g1)) === 'play' && (await stage(g2)) === 'まにあわず');
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
  await waitUntil(async () => (await stage(tv)).startsWith('すまほ'));
  await answer(h, 'ほすとのこたえ');
  await waitUntil(async () => (await text(h, '#queueList')).includes('ほすと'));
  await g2.page.click('#btnPress');
  await sleep(400);
  for (const c of [h, g1, tv]) check('G1 幅375pxで横にはみ出さない: ' + c.label, (await overflow(c)) <= 0, await overflow(c));
  await shot(h, 'g-host-375');
  await shot(g1, 'g-guest-375');
  const order = await h.page.evaluate(() => ['stage', 'hostPanel', 'myCard', 'shownCard'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().top)));
  check('G2 せまい画面では、ホストの枠が「いま出ている答え」のすぐ下', order[0] < order[1] && order[1] < order[2] && order[2] < order[3], order);
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
