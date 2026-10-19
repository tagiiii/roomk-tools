// しるしでヒント E2E その1: 作成・参加・みんなにみせる画面・1問の流れ・点・パス・一巡・ホストも遊ぶ・出せないしるし・おしまい・幅
const path = require('path');
const { pathToFileURL } = require('url');
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const D = await import(pathToFileURL(path.resolve(__dirname, '../../apps/shirushi-hint/data.js')).href);
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 900 } });

  // ── A. 作成・参加 ──
  const code = await L.createRoom(H, 'メンター');
  check('A1 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('A2 ホストの初期値は進行だけ', room.hostPlays === false && room.status === 'waiting');
  check('A3 「みんなにみせる画面」はホストだけ', await L.visible(H, '#btnOpenWatch'));
  check('A4 1人では始められない', await H.page.isDisabled('#btnStartGame'));
  check('A5 room-create を数える', (await L.stats(H, 'room-create')) === 1);
  await L.joinRoom(A, 'あおい', code);
  check('A6 参加者は待つ', (await L.text(A, '#waitingLead')).includes('ホストが始める'));
  check('A7 参加者にホストの道具は出ない', !(await L.visible(A, '#hostWaitingTools')) && !(await L.visible(A, '#btnOpenWatch')));
  await L.joinRoom(B, 'そら', code);
  await L.waitText(H, '#waitingCount', '遊ぶ人 2人');
  check('A8 2人で始められる', !(await H.page.isDisabled('#btnStartGame')));
  // 同じ名前は入れない
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'あおい');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('A9 同じ名前は入れない', true);
  await X.page.fill('#guestName', 'メンター');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('A10 ホストと同じ名前も入れない', true);
  await X.context.close();
  L.clients.splice(L.clients.indexOf(X), 1);

  // ── B. みんなにみせる画面 ──
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  check('B1 みんなにみせる画面の札', await L.visible(W, '#watchBadge'));
  check('B2 見るだけ（ホストの道具なし）', !(await L.visible(W, '#hostWaitingTools')));
  room = await L.roomOf(code);
  check('B3 見る画面は参加者に数えない', Object.keys(room.players).length === 3);

  // ── C. 1問目（あおいが伝える、そらが当てる） ──
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'pick');
  room = await L.roomOf(code);
  check('C1 順番は参加した順（進行だけのホストは入らない）', JSON.stringify(room.game.order) === '["あおい","そら"]', room.game.order);
  check('C2 伝える人に候補3つ', (await A.page.$$('#pickCands .sh-cand')).length === 3);
  check('C3 ほかの人は待つ', (await L.text(B, '#pickTitle')).includes('あおいさんがお題を選んでいる') && !(await L.visible(B, '#pickPanel')));
  check('C4 ホストに候補は出ない', !(await L.visible(H, '#pickPanel')));
  check('C5 ホストに「この問を終えて次の人へ」', await L.visible(H, '#btnSkipQuestion') && !(await L.visible(A, '#btnSkipQuestion')));
  const cands1 = await A.page.$$eval('#pickCands .sh-cand__text', (els) => els.map((e) => e.textContent));
  await A.page.click('#btnReroll');
  await A.page.waitForFunction((old) => [...document.querySelectorAll('#pickCands .sh-cand__text')].every((e) => !old.includes(e.textContent)), cands1);
  check('C6 ほかの候補は前と重ならない', true);
  const topic1 = await A.page.$eval('#pickCands .sh-cand__text', (e) => e.textContent);
  await A.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(B, 'hint');
  check('C7 start と players-2 を数える（選んだ端末だけ）', (await L.waitStats(A, 'start', 1)) && (await L.stats(A, 'players-2')) === 1 && (await L.stats(H, 'start')) === 0);
  check('C8 伝える人にお題', (await L.text(A, '#hintTopic')) === topic1);
  const tB = await L.tiles(B);
  const tA = await L.tiles(A);
  check('C9 候補は12個・全員同じ並び', tB.length === 12 && tB.map((x) => x.t).join() === tA.map((x) => x.t).join());
  check('C10 候補に A〜L', tB.map((x) => x.k).join('') === 'ABCDEFGHIJKL');
  check('C11 伝える人にだけお題の印', tA.filter((x) => x.answer).length === 1 && tA.find((x) => x.answer).t === topic1 && tB.every((x) => !x.answer));
  const kindOf = (w) => Object.keys(D.TOPIC_KINDS).find((k) => D.TOPIC_KINDS[k].includes(w));
  check('C12 お題と同じなかまを6個そろえる', tA.filter((x) => kindOf(x.t) === kindOf(topic1)).length === 6);
  check('C13 当てる人・ホスト・見る画面にお題を出さない', !(await L.visible(B, '#hintTopicBox')) && !(await L.visible(H, '#hintTopicBox')) && !(await L.visible(W, '#hintTopicBox')));
  check('C14 しるしの前は選べない', tB.every((x) => !x.btn));
  check('C15 当てる人にアイコンの一覧は出ない', !(await L.visible(B, '#tellerTools')));
  // ①: 選んでから出す
  await A.page.locator('#palette .sh-pbtn', { hasText: '虫' }).first().click();
  check('C16 出す前の見本は伝える人だけ', (await A.page.$$('#signsList .is-preview')).length === 1 && (await L.signs(B)).length === 0);
  await A.page.locator('#palette .sh-pbtn', { hasText: '動物' }).first().click();
  await A.page.click('#btnSend');
  await B.page.waitForFunction(() => document.querySelectorAll('#signsList .sh-sign').length === 1 && !document.querySelector('#signsList .is-preview'));
  check('C17 しるし①が全員に出る', (await L.signs(B)).join() === '動物' && (await L.signs(W)).join() === '動物' && (await L.signs(H)).join() === '動物');
  check('C18 出したしるしはもう出せない', await A.page.locator('#palette .sh-pbtn', { hasText: '動物' }).first().isDisabled());
  const wrongs = tA.filter((x) => !x.answer).map((x) => x.t);
  await L.tapTile(B, wrongs[0]);
  // 当てる人は1人なので、すぐ答え合わせ
  room = await L.roomWhen(code, (r) => r.game.q.judged === 1);
  check('C19 はずれは −1点', room.game.scores['そら'] === -1 && room.game.scores['あおい'] === 0, room.game.scores);
  await B.page.waitForFunction(() => document.querySelector('#hintGuide').textContent.includes('はずれ'));
  check('C20 はずれた人に「はずれ（−1点）」', (await L.text(B, '#hintGuide')).includes('はずれ（−1点）'));
  check('C21 はずれた候補が全員の画面で消える', (await L.tiles(W)).find((x) => x.t === wrongs[0]).crossed && (await L.tiles(A)).find((x) => x.t === wrongs[0]).crossed);
  check('C22 結果が出る', (await L.popText(W)).includes('まだだれも当たらなかった'));
  await L.waitText(H, '#orderList', '−1点');
  check('C23 マイナスの点が赤で出る', await H.page.$eval('#orderList li:nth-child(2) .sh-order__pts', (e) => e.classList.contains('is-minus')));
  // ②: 当たり
  await L.sendSign(A, '黄色');
  await B.page.waitForFunction(() => document.querySelectorAll('#signsList .sh-sign').length === 2);
  await L.tapTile(B, topic1);
  await L.waitScreen(H, 'reveal');
  check('C24 当てる人が全員当てたら答え', (await L.text(W, '#revealTopic')) === topic1);
  const rows1 = await L.resultRows(H);
  check('C25 この問の点', rows1[0].includes('あおい') && rows1[0].includes('伝えた') && rows1[0].includes('+2点')
    && rows1[1].includes('そら') && rows1[1].includes('②つ目で当てた・はずれ1回') && rows1[1].includes('+1点'), rows1);
  room = await L.roomOf(code);
  check('C26 点の合計', room.game.scores['あおい'] === 2 && room.game.scores['そら'] === 1, room.game.scores);
  check('C27 finish を数える（答えに進めた端末だけ）', (await L.waitStats(B, 'finish', 1)) && (await L.stats(H, 'finish')) === 0 && (await L.stats(A, 'finish')) === 0);
  check('C28 答えの画面に結果を重ねない', !(await L.popText(W)));
  check('C29 次へ進むのはホスト', await L.visible(H, '#btnNext') && (await L.text(H, '#btnNext')) === '次の人へ' && await L.visible(A, '#revealWait'));
  await H.page.screenshot({ path: path.join(L.OUT, 'c-host-reveal.png'), fullPage: true });

  // ── D. 次の人・パス・一巡 ──
  await H.page.click('#btnNext');
  await L.waitScreen(B, 'pick');
  check('D1 次はそら', await L.visible(B, '#pickPanel'));
  check('D2 again を数える', await L.waitStats(H, 'again', 1));
  await B.page.click('#btnPass');
  await L.waitScreen(H, 'lap');
  const lap1 = await L.rankRows(H, '#lapRank');
  check('D3 一巡の順位（点の高い順）', lap1[0].includes('1位') && lap1[0].includes('あおい') && lap1[1].includes('2位') && lap1[1].includes('そら'), lap1);
  check('D4 もう一巡はホスト', await L.visible(H, '#btnLapAgain') && await L.visible(A, '#lapWait'));
  await H.page.click('#btnLapAgain');
  await L.waitScreen(A, 'pick');
  check('D5 もう一巡は最初の人から', await L.visible(A, '#pickPanel') && (await L.text(A, '#pickRound')).includes('2巡目'));

  // ── E. 出せないしるし（お題を「飛行機」にする） ──
  const plane = D.TOPICS.indexOf('飛行機');
  room = await L.roomOf(code);
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/q/cands', [plane, ...room.game.q.cands.filter((t) => t !== plane).slice(0, 2)]);
  await A.page.waitForFunction(() => document.querySelector('#pickCands .sh-cand__text')?.textContent === '飛行機');
  await A.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(A, 'hint');
  const fly = A.page.locator('#palette .sh-pbtn', { hasText: '飛ぶ' }).first();
  check('E1 このお題では「飛ぶ」を出せない', await fly.isDisabled() && (await fly.getAttribute('aria-label')).includes('このお題では出せない'));
  await fly.evaluate((e) => { e.disabled = false; e.click(); });
  check('E2 むりに選んでも出せない', await A.page.isDisabled('#btnSend'));
  // おしまい（問の途中）
  await H.page.click('#btnFinish');
  await L.waitScreen(A, 'end');
  check('E3 おしまいに順位', (await L.rankRows(W, '#endRank')).length === 2);
  check('E4 もう一回あそぶはホストだけ', await L.visible(H, '#btnPlayAgain') && !(await L.visible(A, '#btnPlayAgain')));
  await H.page.click('#btnPlayAgain');
  await L.waitScreen(A, 'waiting');
  room = await L.roomOf(code);
  check('E5 もう一回あそぶでゲームを消す', !room.game && room.status === 'waiting');

  // ── F. ホストも遊ぶ（3人） ──
  await H.page.check('#hostPlays');
  await L.waitText(H, '#waitingCount', '遊ぶ人 3人');
  await H.page.click('#btnStartGame');
  await L.waitScreen(H, 'pick');
  room = await L.roomOf(code);
  check('F1 ホストが先頭', room.game.order[0] === 'メンター');
  await H.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(A, 'hint');
  const topicF = await L.text(H, '#hintTopic');
  check('F2 ホストが伝える人のとき、見る画面にお題は出ない', !(await L.bodyText(W)).includes('あなたのお題') && !(await L.visible(W, '#hintTopicBox')));
  await L.sendSign(H, '丸い');
  await A.page.waitForFunction(() => document.querySelectorAll('#signsList .sh-sign').length === 1);
  await L.tapTile(A, topicF);
  check('F3 当てた人が選んだあと、ほかの人を待つ', (await L.roomOf(code)).game.q.judged === 0);
  check('F4 選んだことだけほかの人に出る', await H.page.waitForFunction(() => [...document.querySelectorAll('#pickedList .is-picked')].some((e) => e.textContent.includes('あおい'))).then(() => true));
  check('F5 何を選んだかは出さない', !(await L.tiles(B)).some((x) => x.mine));
  await B.page.click('#btnSkipGuess');
  room = await L.roomWhen(code, (r) => r.game.q.judged === 1);
  check('F6 ①で当てたら3点（当てた人と伝えた人）・選ばなければ減らない', room.game.scores['あおい'] === 3 && room.game.scores['メンター'] === 3 && (room.game.scores['そら'] || 0) === 0, room.game.scores);
  await L.waitText(B, '#popBanner', 'あおいさんが当てた');
  check('F7 「○○さんが当てた！」', true);
  check('F8 当てた人に当たりの印', (await L.tiles(A)).find((x) => x.t === topicF).answer && !(await L.tiles(B)).some((x) => x.answer));
  // そらが選ぶ前に次のしるし → ②で締まらずに待つ（②はまだ出ていない）。①は締まっているので、②を出す
  await L.sendSign(H, '大きい');
  await B.page.waitForFunction(() => document.querySelectorAll('#signsList .sh-sign').length === 2);
  // ③を、そらが選ぶ前に出す → ②はそらが選ばずに締まる
  await L.sendSign(H, '赤');
  room = await L.roomWhen(code, (r) => r.game.q.judged === 2 && (r.game.q.signs || []).length === 3);
  check('F9 待たずに次のしるしを出すと締まる', room.game.q.judged === 2);
  check('F10 伝えた人の点は1回だけ', room.game.scores['メンター'] === 3);
  await L.tapTile(B, topicF);
  await L.waitScreen(H, 'reveal');
  room = await L.roomOf(code);
  check('F11 ③で当てたら1点', room.game.scores['そら'] === 1 && room.game.scores['メンター'] === 3, room.game.scores);
  check('F12 最後の人のあとは「順位を見る」', (await L.text(H, '#btnNext')) === '次の人へ');

  // ── G. 幅 375px ──
  for (const c of [H, A, B, W]) {
    await c.page.setViewportSize({ width: 375, height: 800 });
  }
  await sleep(200);
  for (const c of [H, A, B, W]) check('G1 幅 375px で横にはみ出さない（' + c.label + '）', (await L.overflow(c)) <= 1, await L.overflow(c));
  await H.page.click('#btnNext');
  await L.waitScreen(A, 'pick');
  await A.page.click('#pickCands .sh-cand >> nth=0');
  await L.waitScreen(A, 'hint');
  await L.sendSign(A, '動物');
  await B.page.waitForFunction(() => document.querySelectorAll('#hintBoard button.sh-tile').length > 0);
  for (const c of [H, A, B, W]) check('G2 しるしの画面で横にはみ出さない（' + c.label + '）', (await L.overflow(c)) <= 1, await L.overflow(c));
  await A.page.screenshot({ path: path.join(L.OUT, 'g-teller-375.png'), fullPage: true });
  await B.page.screenshot({ path: path.join(L.OUT, 'g-guesser-375.png'), fullPage: true });
  await W.page.setViewportSize({ width: 1280, height: 900 });
  await W.page.screenshot({ path: path.join(L.OUT, 'g-watch.png'), fullPage: true });

  // ── H. アイコンがすべて記号で出る ──
  await A.page.setViewportSize({ width: 1100, height: 900 });
  await A.page.evaluate(() => document.fonts.ready);
  await sleep(400);
  const wide = await A.page.$$eval('#palette .sh-sign__icon', (els) => els.filter((e) => e.getBoundingClientRect().width > 40).map((e) => e.textContent));
  check('H1 アイコンがすべて記号で出る', wide.length === 0, wide);
  check('H2 アイコンの数', (await A.page.$$('#palette .sh-pbtn')).length === D.ICON_GROUPS.reduce((n, g) => n + g.icons.length, 0));

  // ── I. ルームを閉じる ──
  await H.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  check('I1 ルームを閉じると参加者もトップへ', !(await L.roomOf(code)));
  await L.waitScreen(W, 'watch-end');
  check('I2 見る画面は終わりの表示', true);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
