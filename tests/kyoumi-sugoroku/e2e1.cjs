// 興味スゴロク E2E その1: 1台の画面（通信しない）・作成・参加・待合室の設定・端末なしの参加者・
// 番の操作（サイコロ・質問・選択肢をみんなに出す・別の質問・次の人へ）・ホストの代わり・ゴール・もう一度・幅・ルームを閉じる
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const Q = L.loadQuestions();
  const choiceAt = (theme) => Q[theme].findIndex((x) => typeof x === 'object' && x.choices);
  const plainAt = (theme) => Q[theme].findIndex((x) => typeof x === 'string');
  const server = await L.startServer();
  await L.launch();

  // ── A. 1台の画面（ゲームの通信をしない） ──
  const O = await L.newClient('local');
  await L.open(O);
  check('A1 トップに3つの入口', await L.visible(O, '#btnGoCreate') && await L.visible(O, '#btnGoJoin') && await L.visible(O, '#btnGoLocal'));
  await O.page.click('#btnGoLocal');
  await L.waitScreen(O, 'settings');
  const counts = await O.page.$$eval('#player-count .ks-toggle__btn', (els) => els.map((e) => e.textContent));
  check('A2 人数は1〜6人', counts.join() === '1人,2人,3人,4人,5人,6人', counts);
  await O.page.click('#player-count [data-value="6"]');
  check('A3 6人なら名前欄も6つ', (await O.page.$$('#player-names input')).length === 6);
  await O.page.fill('#player-names input >> nth=5', 'ろくばん');
  await O.page.click('#btn-start');
  await L.waitScreen(O, 'game');
  const ind = await L.indicator(O);
  check('A4 6人のコマと名前', ind.length === 6 && ind[5].name === 'ろくばん' && ind[0].name === 'プレイヤー1', ind);
  check('A5 6色目のコマ', await O.page.evaluate(() => getComputedStyle(document.querySelector('#indicator .ks-pawn.ks-pawn--5')).backgroundColor !== 'rgba(0, 0, 0, 0)'));
  check('A6 ルームバーは出ない', !(await L.visible(O, '#roomBar')));
  await O.page.click('#btn-roll');
  await L.waitVisible(O, '#modal #questionCard');
  check('A7 質問はモーダルで出る', (await L.text(O, '#modal-player')) === 'プレイヤー1 さんへ');
  check('A8 start-local を数える', (await L.stats(O, 'start-local')) === 1);
  check('A9 1台の画面では通信しない', O.sockets === 0, O.sockets);
  await O.context.close();
  L.clients.splice(L.clients.indexOf(O), 1);

  // ── B. 作成・参加 ──
  const H = await L.newClient('host');
  const A = await L.newClient('aoi');
  const B = await L.newClient('sora', { viewport: { width: 375, height: 812 } });
  const code = await L.createRoom(H, 'メンター');
  check('B1 ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  let room = await L.roomOf(code);
  check('B2 ホストの初期値は遊ぶ・15マス・テーマ6つ', room.hostPlays === true && room.squares === 15 && room.themes.length === 6 && room.status === 'waiting', room);
  check('B3 room-create を数える', (await L.stats(H, 'room-create')) === 1);
  check('B4 ホストの道具が出る', await L.visible(H, '#hostWaitingTools') && await H.page.isChecked('#hostPlays'));
  check('B5 ホスト1人でも始められる', !(await H.page.isDisabled('#btnStartGame')));
  await L.open(A, '?room=' + code);
  await L.waitScreen(A, 'join');
  check('B6 リンクからはコードが入っている', (await A.page.inputValue('#joinCode')) === code && await L.visible(A, '#joinLinkHint'));
  await A.page.fill('#guestName', 'あおい');
  await A.page.click('#btnJoinRoom');
  await L.waitScreen(A, 'waiting');
  check('B7 参加したらアドレスから ?room= を外す', !(new URL(A.page.url()).search.includes('room=')));
  check('B8 参加者にホストの道具は出ない', !(await L.visible(A, '#hostWaitingTools')) && await L.visible(A, '#guestWaitingNote'));
  await L.joinRoom(B, 'そら', code);
  await L.waitText(H, '#waitingCount', '遊ぶ人 3人');
  // 同じ名前・ホストと同じ名前は入れない
  const X = await L.newClient('dup');
  await L.open(X, '?room=' + code);
  await X.page.fill('#guestName', 'あおい');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  await X.page.fill('#guestName', 'メンター');
  await X.page.click('#btnJoinRoom');
  await L.waitText(X, '#joinError', 'その名前は使われている');
  check('B9 同じ名前は入れない', true);
  await X.context.close();
  L.clients.splice(L.clients.indexOf(X), 1);

  // ── C. 待合室の設定 ──
  await H.page.click('#roomSquares [data-value="10"]');
  await L.roomWhen(code, (r) => r.squares === 10);
  await L.waitText(A, '#waitingSettings', 'マス数 10マス');
  check('C1 マス数をみんなに出す', true);
  await H.page.click('#roomThemes label:nth-child(2)'); // やってみたい を外す
  room = await L.roomWhen(code, (r) => r.themes.length === 5);
  check('C2 テーマを外せる', !room.themes.includes('yatte'), room.themes);
  await L.waitText(A, '#waitingSettings', 'テーマ 好きなもの・もしも…');
  // 2つより少なくはできない
  for (const [i, n] of [3, 4, 5].entries()) {
    await H.page.click(`#roomThemes label:nth-child(${n})`);
    await L.roomWhen(code, (r) => r.themes.length === 4 - i);
  }
  await H.page.click('#roomThemes label:nth-child(6)');
  await L.waitToast(H, 'テーマは2つ以上');
  room = await L.roomOf(code);
  check('C3 テーマは2つより少なくできない', room.themes.length === 2 && room.themes.join() === 'suki,tokui', room.themes);
  // もとにもどす（全部）
  for (const [i, n] of [2, 3, 4, 5].entries()) {
    await H.page.click(`#roomThemes label:nth-child(${n})`);
    await L.roomWhen(code, (r) => r.themes.length === 3 + i);
  }
  // 端末なしの参加者
  await H.page.fill('#proxyName', 'きいろ');
  await H.page.click('#btnAddProxy');
  await L.waitText(H, '#waitingCount', '遊ぶ人 4人');
  const hostList = await H.page.$$eval('#waitingPlayers li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  const guestList = await A.page.$$eval('#waitingPlayers li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  check('C4 端末なしの印はホストにだけ', hostList.some((t) => t.includes('きいろ') && t.includes('端末なし')) && guestList.some((t) => t.includes('きいろ') && !t.includes('端末なし')), { hostList, guestList });
  await H.page.fill('#proxyName', 'そら');
  await H.page.click('#btnAddProxy');
  await L.waitText(H, '#proxyError', 'もういる');
  check('C5 同じ名前の端末なしの参加者は足せない', true);
  check('C6 待合室で横にはみ出さない（375px）', (await L.overflow(B)) <= 0);

  // ── D. はじめる・ホストの番 ──
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  room = await L.roomOf(code);
  check('D1 順番はホスト・参加した順・端末なし', JSON.stringify(room.game.order) === '["メンター","あおい","そら","きいろ"]', room.game.order);
  check('D2 start と players-4 を数える（ホストだけ）', (await L.waitStats(H, 'start', 1)) && (await L.stats(H, 'players-4')) === 1 && (await L.stats(A, 'start')) === 0);
  check('D3 マス数は10', (await A.page.$$('#board .ks-square')).length === 10);
  check('D4 ホストの番: ホストにだけサイコロ', await L.visible(H, '#btn-roll') && !(await L.visible(A, '#btn-roll')) && !(await L.visible(B, '#btn-roll')));
  check('D5 番の案内', (await L.text(A, '#turnNote')) === 'メンターさんがサイコロを振る番だよ' && (await L.text(H, '#turnNote')).startsWith('あなたの番'));
  const indA = await L.indicator(A);
  check('D6 自分に「あなた」・端末なしの印は参加者に出さない', indA[1].tags.includes('あなた') && indA[3].tags.length === 0 && indA[0].current, indA);
  check('D7 ホストには端末なしの印', (await L.indicator(H))[3].tags.includes('端末なし'));
  await H.page.click('#btn-roll');
  await L.waitText(A, '#turnNote', 'メンターさんがサイコロを振ったよ', 3000);
  check('D8 ほかの人の画面でもサイコロが回る', true);
  await L.waitQuestion(A);
  room = await L.roomOf(code);
  const d1 = room.game.last.dice;
  check('D9 出目のぶん進む', room.game.pos[0] === d1 && (await L.text(A, '#dice')) === String(d1), { pos: room.game.pos, d1 });
  let cA = await L.card(A);
  let cH = await L.card(H);
  check('D10 質問はみんなに出る', cA.player === 'メンター さんへ' && cA.question === cH.question && cA.question.length > 0);
  check('D11 番の人でない人はボタンなし・待つ案内', !cA.next && !cA.skip && cA.wait.includes('メンターさんが話しおわると'), cA);
  check('D12 番の人に「別の質問」', cH.skip);
  // 選択肢なしの質問にそろえて「話せた！次の人へ」
  await L.rest('PATCH', `${L.ROOMS}/${code}/game/q`, { theme: 'suki', idx: plainAt('suki'), n: 5, choice: null });
  await L.waitText(H, '#modal-question', Q.suki[plainAt('suki')]);
  cH = await L.card(H);
  check('D13 選択肢なしなら「話せた！次の人へ」がすぐ出る', cH.next && cH.choices.length === 0, cH);
  await H.page.click('#btn-next');
  await L.waitText(A, '#turnNote', 'あなたの番だよ');
  check('D14 次はあおい', (await L.indicator(H))[1].current);
  check('D15 質問のカードは消える', !(await L.visible(A, '#roomStage')));

  // ── E. 参加者の番（選択肢をみんなに出す） ──
  check('E1 あおいとホストにサイコロ・そらにはない', await L.visible(A, '#btn-roll') && await L.visible(H, '#btn-roll') && !(await L.visible(B, '#btn-roll')));
  check('E2 ホストには代わりに押せる案内', (await L.text(H, '#turnNote')).includes('ホストは代わりに押せます'));
  await A.page.click('#btn-roll');
  await L.waitQuestion(B);
  const ci = choiceAt('suki');
  await L.rest('PATCH', `${L.ROOMS}/${code}/game/q`, { theme: 'suki', idx: ci, n: 7, choice: null });
  await L.waitText(A, '#modal-question', Q.suki[ci].q);
  cA = await L.card(A);
  let cB = await L.card(B);
  check('E3 選択肢と「自由に話す」', cA.choices.length === Q.suki[ci].choices.length + 1 && cA.choices.at(-1).text.includes('自由に話す'), cA.choices);
  check('E4 選ぶまで「話せた！次の人へ」は出ない', !cA.next && cA.skip);
  check('E5 ほかの人の選択肢は押せない', cB.choices.every((x) => x.disabled) && cA.choices.every((x) => !x.disabled));
  await A.page.click('#modal-choices .ks-choice >> nth=1');
  await B.page.waitForFunction(() => document.querySelectorAll('#modal-choices .ks-choice')[1]?.classList.contains('is-chosen'));
  check('E6 選んだものがみんなの画面に出る', true);
  room = await L.roomOf(code);
  check('E7 選んだ番号がルームに入る', room.game.q.choice === 1, room.game.q);
  cA = await L.card(A);
  check('E8 選んだら「話せた！次の人へ」', cA.next);
  await A.page.click('#modal-choices .ks-choice >> nth=0');
  await H.page.waitForFunction(() => document.querySelectorAll('#modal-choices .ks-choice')[0]?.classList.contains('is-chosen') && !document.querySelectorAll('#modal-choices .ks-choice')[1]?.classList.contains('is-chosen'));
  check('E9 選び直せる', true);
  await A.page.click('#modal-choices .ks-choice--free');
  await B.page.waitForFunction(() => document.querySelector('#modal-choices .ks-choice--free')?.classList.contains('is-chosen'));
  check('E10 「自由に話す」もみんなに出る', true);
  // 別の質問: テーマはそのまま、選んだものは消える
  await A.page.click('#btn-skip');
  room = await L.roomWhen(code, (r) => r.game.q.n === 8);
  check('E11 別の質問はテーマそのまま・ちがう質問・選んだものは消える', room.game.q.theme === 'suki' && room.game.q.idx !== ci && room.game.q.choice === undefined, room.game.q);
  await L.waitText(B, '#modal-question', (() => { const it = Q.suki[room.game.q.idx]; return typeof it === 'string' ? it : it.q; })());
  check('E12 別の質問もみんなに出る', true);
  await L.rest('PATCH', `${L.ROOMS}/${code}/game/q`, { theme: 'suki', idx: plainAt('suki'), n: 9 });
  await L.waitText(A, '#modal-question', Q.suki[plainAt('suki')]);
  await A.page.click('#btn-next');
  await L.waitText(B, '#turnNote', 'あなたの番だよ');
  check('E13 次はそら', true);
  check('E14 ゲーム画面で横にはみ出さない（375px）', (await L.overflow(B)) <= 0);
  await B.page.screenshot({ path: L.OUT + '/e2e1-sora-375.png', fullPage: true });

  // ── F. ホストが代わりに振る・番の人が次へ ──
  await H.page.click('#btn-roll');
  await L.waitQuestion(B);
  cB = await L.card(B);
  check('F1 ホストが代わりに振ってもそらの質問', cB.player === 'そら さんへ' && cB.skip, cB);
  await L.rest('PATCH', `${L.ROOMS}/${code}/game/q`, { theme: 'suki', idx: plainAt('suki'), n: 3 });
  await L.waitText(B, '#modal-question', Q.suki[plainAt('suki')]);
  await B.page.click('#btn-next');
  await L.waitText(H, '#turnNote', 'きいろさんの番だよ');
  check('F2 端末なしの人の番はホストだけ押せる', await L.visible(H, '#btn-roll') && !(await L.visible(A, '#btn-roll')) && !(await L.visible(B, '#btn-roll')));
  await H.page.click('#btn-roll');
  await L.waitQuestion(H);
  check('F3 端末なしの人の質問はホストが進める', (await L.card(H)).skip && !(await L.card(A)).skip);
  await L.rest('PATCH', `${L.ROOMS}/${code}/game/q`, { theme: 'suki', idx: plainAt('suki'), n: 3 });
  await L.waitText(H, '#modal-question', Q.suki[plainAt('suki')]);
  await H.page.click('#btn-next');
  await L.waitText(H, '#turnNote', 'あなたの番だよ');
  check('F4 一巡してホストへ', true);

  // ── G. 再読み込みで同じ席にもどる ──
  await A.page.reload();
  await L.waitScreen(A, 'game');
  check('G1 再読み込みで同じ席（ゲーム画面）', (await L.indicator(A))[1].tags.includes('あなた'));
  check('G2 もどったときはアニメーションしない', !(await L.text(A, '#turnNote')).includes('振ったよ'));

  // ── H. ゴール ──
  await L.rest('PATCH', `${L.ROOMS}/${code}/game/pos`, { 0: 8 });
  await sleep(300);
  await H.page.click('#btn-roll');
  await L.waitVisible(A, '#roomStage #goalCard', 8000);
  check('H1 ゴールはみんなに出る', (await L.text(A, '#goal-name')) === 'メンター さん、おめでとう！' && (await L.text(B, '#goal-name')) === 'メンター さん、おめでとう！');
  check('H2 もう一度あそぶはホストだけ', await L.visible(H, '#btn-restart') && !(await L.visible(A, '#btn-restart')) && await L.visible(A, '#goal-wait'));
  check('H3 finish を数える（振った端末だけ）', (await L.waitStats(H, 'finish', 1)) && (await L.stats(A, 'finish')) === 0);
  room = await L.roomOf(code);
  check('H4 ゴールでとまる', room.status === 'goal' && room.game.pos[0] === 9 && room.game.winner === 0, room.game);
  await H.page.click('#btn-restart');
  await L.waitScreen(A, 'waiting');
  room = await L.roomOf(code);
  check('H5 もう一度あそぶで待合室・設定と端末なしの参加者は残る', room.status === 'waiting' && !room.game && room.squares === 10 && !!room.proxies?.['きいろ'], room);
  check('H6 again を数える', (await L.waitStats(H, 'again', 1)));

  // ── I. ゲームの途中で待合室にもどる・ルームを閉じる ──
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  check('I1 ホストに「待合室にもどる」・参加者にはない', await L.visible(H, '#btnRoomBack') && !(await L.visible(A, '#btnRoomBack')));
  await H.page.click('#btnRoomBack');
  await L.waitScreen(A, 'waiting');
  check('I2 待合室にもどる', true);
  await H.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  await L.waitToast(A, 'ルームが閉じられた');
  check('I3 ルームを閉じるとみんなトップへ', (await L.roomOf(code)) === null);

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
