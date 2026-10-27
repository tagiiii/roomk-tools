// 大富豪の E2E その2（2026-10-27 子どもの意見）: 階段革命・都落ち・ジョーカーに同じ効果。
// 手札はくじなので、配ったあとにルームの game をエミュレーターの REST で書きかえて、見たい局面を作る
const L = require('./lib.cjs');
const { check, sleep, waitScreen, waitText, visible, waitVisible, text, table, handOf, logText, isOver, humanMove } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('guest-ao');
  const B = await L.newClient('guest-midori');
  const W = await L.newClient('watch');

  const code = await L.createRoom(H, 'メンター');
  await L.joinRoom(A, 'あお', code);
  await L.joinRoom(B, 'みどり', code);
  await waitText(H, '#lobbyCount', 'あそぶ人 3人');
  await H.page.click('#btnAddCpu');
  await waitText(H, '#lobbyCount', 'あそぶ人 4人');

  // ══ 待合室の設定 ══
  check('階段革命の項目があり、はじめオン', await H.page.isChecked('#lobbyRules input[data-rule="stairsRevolution"]'));
  check('都落ちの項目があり、はじめオフ', (await H.page.$('#lobbyRules input[data-rule="miyakoOchi"]')) !== null && !(await H.page.isChecked('#lobbyRules input[data-rule="miyakoOchi"]')));
  check('2回目からのルールの見出し', (await text(H, '#lobbyRules')).includes('2回目からのルール'));
  check('参加する人の一覧に階段革命（使う）', /使う[^]*階段革命/.test(await text(A, '#lobbyRulesView')));
  check('参加する人の一覧に都落ち（なし）', /都落ち[^]*なし/.test(await text(A, '#lobbyRulesView')));
  await H.page.check('#lobbyRules input[data-rule="miyakoOchi"]');
  await waitText(A, '#lobbyRulesView', 'あり（2回目から）');
  await H.page.check('#lobbyRules input[data-rule="tenDiscard"]');
  await waitText(A, '#lobbyRulesView', '10捨て');
  await H.page.click('#lobbyRules input[name="time-limit"][value="0"]', { force: true });
  await waitText(A, '#lobbyRulesView', '考える時間');
  const st = await L.roomOf(code);
  check('設定はルームに入る', st.settings.rules.miyakoOchi === true && st.settings.rules.stairsRevolution === true && st.settings.rules.tenDiscard === true && st.settings.time.limit === 0, st.settings);
  await H.page.screenshot({ path: L.OUT + '/e2-01-lobby.png', fullPage: true });
  await L.open(W, '?watch=' + code);
  await waitScreen(W, 'lobby');

  // ══ 配る ══
  await H.page.click('#btnStartGame');
  await waitScreen(A, 'game');
  await waitScreen(W, 'game');
  const t0 = await table(H);
  check('席の順', t0.map((x) => x.name).join() === 'メンター,あお,みどり,CPU 1', t0.map((x) => x.name));
  check('1回目は呼び名なし', !t0.some((x) => x.tags.some((t) => /富豪|貧民|平民/.test(t))));

  // 局面を作る（ホストの番・場は空）
  async function setState(fn) {
    const room = await L.roomOf(code);
    const G = JSON.parse(room.game);
    const s = G.s;
    s.turn = 0; s.field = null; s.passed = s.passed.map(() => false); s.pending = null;
    s.rev = false; s.back = false; s.lock = null; s.over = false;
    s.done = s.done.map(() => false); s.places = []; s.fouls = []; s.fallen = null;
    s.last = { kind: 'start', by: 0, cards: [], fx: [] };
    fn(s);
    await L.rest('PUT', L.ROOMS + '/' + code + '/game', JSON.stringify(G));
    const want = s.hands[0].slice().sort().join();
    const got = await H.page.waitForFunction((h) => Array.from(document.querySelectorAll('#hand .df-card')).map((x) => x.dataset.card).sort().join() === h, want, { timeout: 8000 }).then(() => true, () => false);
    if (!got) throw new Error('setState: hand mismatch want=' + want + ' got=' + (await handOf(H)).sort().join() + ' room=' + JSON.stringify(JSON.parse((await L.roomOf(code)).game).s.hands[0]) + ' errors=' + JSON.stringify(H.errors));
  }
  async function playCards(c, cards) {
    if (await visible(c, '#btnClear')) await c.page.click('#btnClear');
    for (const card of cards) await c.page.click('#hand .df-card[data-card="' + card + '"]');
    await c.page.waitForFunction(() => !document.querySelector('#btnPlay').disabled, null, { timeout: 4000 });
    await c.page.click('#btnPlay');
  }

  // ══ 階段革命 ══
  await setState((s) => {
    s.hands = [
      ['S3', 'S4', 'S5', 'S6', 'S7', 'S10', 'X1', 'C9', 'H9'], // 8 を入れると8切りで流れるので 3〜7。10捨てのあとに2枚のこす
      ['H3', 'D11', 'S13', 'C12', 'H14'],
      ['D3', 'H11', 'S4', 'C13', 'D14'],
      ['C4', 'D9', 'H10', 'S12', 'C14'],
    ];
  });
  await playCards(H, ['S3', 'S4', 'S5', 'S6', 'S7']);
  check('5枚の階段で革命（できごと）', await waitText(H, '#log', '革命！ 強さが逆になった', 8000).then(() => true, () => false), await logText(H));
  check('革命中の表示', await waitText(H, '#modes', '革命中', 4000).then(() => true, () => false));
  check('みんなにみせる画面にも革命中', await waitText(W, '#modes', '革命中', 4000).then(() => true, () => false));
  await H.page.screenshot({ path: L.OUT + '/e2-02-stairs-revolution.png', fullPage: true });
  // みんなパス → ホストにもどる
  for (const c of [A, B]) {
    await c.page.waitForFunction(() => !document.querySelector('#btnPass').disabled && !document.querySelector('#actPlay').closest('[hidden]'), null, { timeout: 8000 });
    await c.page.click('#btnPass');
  }
  check('場が流れてホストから', await H.page.waitForFunction(() => document.querySelectorAll('#field .df-card').length === 0 && !document.querySelector('#actPlay').closest('[hidden]'), null, { timeout: 15000 }).then(() => true, () => false));

  // ══ ジョーカーに同じ効果: 10＋ジョーカーで2枚捨てられる ══
  await playCards(H, ['S10', 'X1']);
  check('10＋ジョーカーで捨てる画面', await waitVisible(H, '#actDiscard', 8000).then(() => true, () => false));
  check('2枚まで選べる', /2枚まで選んでね/.test(await L.bodyText(H)), await L.bodyText(H));
  await H.page.screenshot({ path: L.OUT + '/e2-03-joker-ten.png', fullPage: true });
  await H.page.click('#hand .df-card[data-card="C9"]');
  await H.page.waitForFunction(() => !document.querySelector('#btnDiscard').disabled, null, { timeout: 4000 });
  await H.page.click('#btnDiscard');
  check('1枚捨てた（できごと）', await waitText(H, '#log', 'メンターが 1枚 捨てた', 8000).then(() => true, () => false), await logText(H));

  // ══ ジョーカーだけを出すとき「何として出すか」を選ぶ ══
  await setState((s) => { s.hands = [['X1', 'C3', 'C4'], ['H3', 'D11'], ['D3', 'H11'], ['C5', 'D9']]; });
  await H.page.click('#hand .df-card[data-card="C3"]');
  check('ふつうのカードでは選ぶボタンは出ない', !(await visible(H, '#actAs')) && await visible(H, '#btnPlay'));
  await H.page.click('#btnClear');
  await H.page.click('#hand .df-card[data-card="X1"]');
  check('ジョーカーだけなら選ぶボタンが出る', await waitVisible(H, '#actAs', 4000).then(() => true, () => false));
  const asBtns = await H.page.$$eval('#actAs button', (xs) => xs.map((x) => x.textContent));
  check('ボタンは そのまま・8・10（イレブンバックはオフなので出ない）', asBtns.join('|') === 'そのまま|8として（8切り）|10として（捨てられる）', asBtns);
  check('「出す」はかくれる', !(await visible(H, '#btnPlay')));
  check('案内文', /ジョーカーを何として出す/.test(await text(H, '#selMsg')), await text(H, '#selMsg'));
  await H.page.screenshot({ path: L.OUT + '/e2-03b-joker-as.png', fullPage: true });
  await H.page.click('#actAs button[data-as="10"]');
  check('10として出すと捨てる画面', await waitVisible(H, '#actDiscard', 8000).then(() => true, () => false));
  check('できごとに「（10として）」', /メンターが ジョーカー を出した（10として）/.test(await logText(H)), await logText(H));
  check('場の説明に「（10として）」', /（10として）/.test(await text(H, '#fieldBy')), await text(H, '#fieldBy'));
  check('みんなにみせる画面の場の説明にも', await waitText(W, '#fieldBy', '（10として）', 4000).then(() => true, () => false));
  await H.page.click('#btnNoDiscard');
  await waitText(H, '#log', 'メンターは捨てなかった', 8000);
  // 8として → 場が流れてもう一度
  await setState((s) => { s.hands = [['X1', 'C3', 'C4'], ['H3', 'D11'], ['D3', 'H11'], ['C5', 'D9']]; });
  await H.page.click('#hand .df-card[data-card="X1"]');
  await waitVisible(H, '#actAs', 4000);
  await H.page.click('#actAs button[data-as="8"]');
  check('8として出すと8切り', await waitText(H, '#log', 'メンターが ジョーカー を出した（8として）　8切り！', 8000).then(() => true, () => false), await logText(H));
  check('場が流れてホストの番', await H.page.waitForFunction(() => document.querySelectorAll('#field .df-card').length === 0 && !document.querySelector('#actPlay').hidden, null, { timeout: 8000 }).then(() => true, () => false));

  // ══ 都落ち: 前回の大富豪はみどり（席2）。メンターが1番にあがると、みどりが抜けて最後 ══
  await setState((s) => {
    s.prev = [2, 0, 1, 3];
    s.hands = [['C3'], ['H3', 'H4'], ['D5', 'D6'], ['C9', 'C10']];
  });
  const t1 = await table(H);
  check('都落ちがオンなら名前の横に前回の呼び名', t1[2].tags.includes('大富豪') && t1[0].tags.includes('富豪'), t1.map((x) => x.tags));
  await playCards(H, ['C3']);
  check('都落ち（できごと）', await waitText(H, '#log', '都落ち！ 前回の大富豪のみどりは抜けて、最後になる', 8000).then(() => true, () => false), await logText(H));
  check('ホストは1番であがり', /メンターがあがり！（1番）/.test(await logText(H)));
  const t2 = await table(H);
  check('みどりの札に「都落ち」', t2[2].tags.includes('都落ち') && !t2[2].tags.some((t) => /番であがり/.test(t)), t2.map((x) => x.tags));
  check('みどりの枚数は出ない', t2[2].count === 0, t2);
  check('まだ途中。次はあお', !(await isOver(H)) && t2[1].turn, t2);
  check('みどりの画面に「都落ち。のこりの人を見ていてね」', await waitText(B, '#mineDone', '都落ち。のこりの人を見ていてね', 8000).then(() => true, () => false));
  check('みどりの手札は出ない', !(await visible(B, '#hand')));
  check('みんなにみせる画面にも都落ち', (await table(W))[2].tags.includes('都落ち'));
  await H.page.screenshot({ path: L.OUT + '/e2-04-miyako.png', fullPage: true });

  // のこりを最後まで（あおは人、CPU はホストが進める）
  const until = Date.now() + 120000;
  while (!(await isOver(H)) && Date.now() < until) {
    const turns = (await table(H)).filter((x) => x.turn).map((x) => x.name);
    if (turns.includes('あお')) await humanMove(A);
    await sleep(250);
  }
  check('最後までいく', await isOver(H), { table: await table(H), log: await logText(H), aErr: A.errors, hErr: H.errors });
  const places = await H.page.$$eval('#resultList li', (xs) => xs.map((x) => x.querySelector('.df-result__name').textContent.replace('（あなた）', '')));
  const titles = await H.page.$$eval('#resultList li .df-tag--rank', (xs) => xs.map((x) => x.textContent));
  const warns = await H.page.$$eval('#resultList li', (xs) => xs.map((x) => Array.from(x.querySelectorAll('.df-tag--warn')).map((t) => t.textContent).join()));
  check('結果の順: メンターが1番、みどりが最後', places[0] === 'メンター' && places[3] === 'みどり', places);
  check('結果の呼び名', titles.join() === '大富豪,富豪,貧民,大貧民', titles);
  check('結果に「都落ち」の印', warns[3] === '都落ち' && !warns[0] && !warns[1] && !warns[2], warns);
  const r1 = await L.roomOf(code);
  check('前回のあがり順の最後はみどり', JSON.parse(r1.lastOrder)[3] === 'p:みどり', r1.lastOrder);
  await H.page.screenshot({ path: L.OUT + '/e2-05-result.png', fullPage: true });

  // ══ もう一回: 呼び名は前回の順（みどりが大貧民）。前回の大富豪はメンター ══
  await H.page.click('#btnAgain');
  await A.page.waitForFunction(() => !document.querySelector('#result:not([hidden])') && document.querySelectorAll('#hand .df-card').length > 0, null, { timeout: 8000 });
  const t3 = await table(H);
  check('2回目: 名前の横にメンター＝大富豪・みどり＝大貧民', t3[0].tags.includes('大富豪') && t3[2].tags.includes('大貧民'), t3.map((x) => x.tags));
  // 前回の大富豪（メンター）が1番なら、何も起きない
  await setState((s) => { s.hands = [['C3'], ['H3', 'H4'], ['D5', 'D6'], ['C9', 'C10']]; });
  await playCards(H, ['C3']);
  await waitText(H, '#log', 'メンターがあがり！（1番）', 8000);
  const t4 = await table(H);
  check('前回の大富豪が1番なら都落ちなし', !t4.some((x) => x.tags.includes('都落ち')) && !/都落ち/.test(await logText(H)), t4.map((x) => x.tags));

  // ══ ルームを閉じる ══
  await H.page.click('#btnLeave');
  await waitScreen(A, 'top');
  check('ルームは消える', (await L.roomOf(code)) === null);
  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
