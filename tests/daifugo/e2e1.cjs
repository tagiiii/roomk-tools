// 大富豪の E2E その1: 作成・参加・設定・配る・手札・みんなにみせる画面・CPU・通信が切れた人の代わりと入りなおし・
// 読み込み直し・時間切れ2回でまかせる・自分でやる・最後まで・呼び名・もう一回のカード交換・交換オフ・375px・ルームを閉じる
const L = require('./lib.cjs');
const { check, sleep, waitScreen, waitText, visible, waitVisible, text, table, handOf, logText, isOver, humanMove, giveOn } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('guest-ao');
  const W = await L.newClient('watch');

  // ══ 作成・参加 ══
  const code = await L.createRoom(H, 'メンター');
  check('ルームコード', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('作成を数える', await L.waitStats(H, 'room-create', 1));
  await L.joinRoom(A, 'あお', code);
  let B = await L.newClient('guest-midori');
  await L.joinRoom(B, 'みどり', code);
  await waitText(H, '#lobbyCount', 'あそぶ人 3人');
  check('ホストもあそぶがはじめオン', await H.page.isChecked('#hostPlays'));
  check('参加する人に設定の欄はない', !(await visible(A, '#lobbyRules')) && await visible(A, '#lobbyRulesView'));

  // 同じ名前・CPU ではじまる名前は入れない
  const D = await L.newClient('dup');
  await L.open(D, '?room=' + code);
  await D.page.fill('#guestName', 'あお');
  await D.page.click('#btnJoinRoom');
  await waitText(D, '#joinError', 'その名前は使われている');
  check('同じ名前は断る', true);
  await D.page.fill('#guestName', 'CPU 9');
  await D.page.click('#btnJoinRoom');
  await waitText(D, '#joinError', 'CPU');
  check('CPU ではじまる名前は断る', true);
  await D.context.close();

  // CPU と設定
  await H.page.click('#btnAddCpu');
  await waitText(A, '#lobbyCount', 'あそぶ人 4人');
  check('CPU がみんなに見える', (await A.page.$$eval('#lobbyPeople li', (xs) => xs.map((x) => x.textContent))).some((t) => t.includes('CPU 1')));
  check('カード交換ははじめオフ', !(await H.page.isChecked('#lobbyRules input[data-rule="exchange"]')));
  check('ジョーカー・2・8ではあがれないの見出し', (await text(H, '#lobbyRules')).includes('ジョーカー・2・8ではあがれない'));
  await H.page.check('#lobbyRules input[data-rule="tenDiscard"]');
  await waitText(A, '#lobbyRulesView', '10捨て');
  await H.page.check('#lobbyRules input[data-rule="exchange"]');
  await waitText(A, '#lobbyRulesView', 'あり（2回目から）');
  await H.page.click('#lobbyRules input[name="time-limit"][value="15"]', { force: true });
  await waitText(A, '#lobbyRulesView', '15秒');
  const st = await L.roomOf(code);
  check('設定はルームに入る', st.settings.rules.tenDiscard === true && st.settings.rules.exchange === true && st.settings.time.limit === 15, st.settings);

  // みんなにみせる画面
  await L.open(W, '?watch=' + code);
  await waitScreen(W, 'lobby');
  check('みんなにみせる画面にコード', (await text(W, '#lobbyJoinCode')) === code);

  // ══ 配る ══
  await H.page.click('#btnStartGame');
  await waitScreen(A, 'game');
  await waitScreen(W, 'game');
  check('ホストの進行の時計は Worker で回す', H.page.workers().length >= 1, H.page.workers().length);
  check('はじめたことを数える', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-4', 1));
  const t0 = await table(H);
  check('席の順', t0.map((x) => x.name).join() === 'メンター,あお,みどり,CPU 1', t0.map((x) => x.name));
  check('53枚配る', t0.reduce((a, x) => a + x.count, 0) === 53, t0.map((x) => x.count));
  check('1回目は名前の横に呼び名なし', !t0.some((x) => x.tags.some((t) => /富豪|貧民|平民/.test(t))));
  const hA = await handOf(A);
  const hB = await handOf(B);
  check('あおの手札の枚数が合う', hA.length === t0[1].count);
  check('手札は人ごとにちがう', hA.length > 0 && !hA.some((card) => hB.includes(card)));
  check('みんなにみせる画面に手札は出ない', !(await visible(W, '#mine')) && (await handOf(W)).length === 0);
  check('♦3の人から', (await logText(H)).includes('♦3を持っている'));
  const room0 = await L.roomOf(code);
  check('ゲームは文字列で持つ', typeof room0.game === 'string' && room0.status === 'playing');

  const pages = { 'メンター': H, 'あお': A, 'みどり': B };
  const hold = new Set();
  async function step() {
    if (await isOver(H)) return 'over';
    const turns = (await table(H)).filter((x) => x.turn).map((x) => x.name);
    let did = null;
    for (const who of turns) {
      const P = pages[who];
      if (P && !hold.has(who) && !P.page.isClosed()) did = (await humanMove(P)) || did;
    }
    await sleep(did ? 250 : 200);
    return did || 'wait';
  }
  async function runUntil(cond, ms) {
    const t = Date.now();
    while (Date.now() - t < ms) {
      if (await cond()) return true;
      if ((await step()) === 'over') return cond();
    }
    return false;
  }

  let moves = 0;
  await runUntil(async () => { moves += 1; return moves > 10; }, 40000);
  check('まだ途中', !(await isOver(H)));
  await H.page.screenshot({ path: L.OUT + '/01-play-host.png', fullPage: true });

  // ══ 通信が切れる → CPU が代わり → 別の端末から同じ名前で入りなおす ══
  if (!(await isOver(H))) {
    hold.add('みどり');
    pages['みどり'] = null;
    await B.context.close();
    check('閉じたら「通信が切れた・CPUが代わり」', await H.page.waitForFunction(() => Array.from(document.querySelectorAll('#players .df-player'))[2]?.textContent.includes('通信が切れた'), null, { timeout: 15000 }).then(() => true, () => false));
    check('切れたことをできごとに書く', await waitText(H, '#log', 'みどりの通信が切れた', 8000).then(() => true, () => false));
    let sawTurn = false;
    const before = (await table(H))[2].count;
    const acted = await runUntil(async () => {
      const t = await table(H);
      if (t[2].turn) sawTurn = true;
      return (sawTurn && !t[2].turn) || t[2].count < before || (await isOver(H));
    }, 60000);
    check('みどりの番に CPU が代わりに出す', acted);
    check('できごとに「（CPUが代わり）」', (await logText(H)).includes('みどり（CPUが代わり）') || (await isOver(H)), await logText(H));
    if (!(await isOver(H))) {
      B = await L.newClient('guest-midori2', { viewport: { width: 375, height: 760 } });
      await L.joinRoom(B, 'みどり', code, 'game');
      pages['みどり'] = B;
      hold.delete('みどり');
      check('もどったら「通信が切れた」が消える', await H.page.waitForFunction(() => !Array.from(document.querySelectorAll('#players .df-player'))[2]?.textContent.includes('通信が切れた'), null, { timeout: 8000 }).then(() => true, () => false));
      check('もどった人に自分の手札', await B.page.waitForFunction(() => document.querySelectorAll('#hand .df-card').length > 0, null, { timeout: 8000 }).then(() => true, () => false));
      check('手札の枚数がホストの札と同じ', (await handOf(B)).length === (await table(H))[2].count);
      check('375px で横にはみ出さない', (await L.overflow(B)) <= 0, await L.overflow(B));
      await B.page.screenshot({ path: L.OUT + '/02-back-375.png', fullPage: true });
      // 読み込み直し（同じタブ）でも席にもどる
      await B.page.reload();
      check('読み込み直しても手札にもどる', await B.page.waitForFunction(() => document.querySelector('#screen-game.active') && document.querySelectorAll('#hand .df-card').length > 0, null, { timeout: 10000 }).then(() => true, () => false));
    }
  }

  // ══ 時間切れ（15秒）2回 → CPU にまかせる → 自分でやる ══
  if (!(await isOver(H))) {
    hold.add('あお');
    const done = await runUntil(async () => (await visible(A, '#autoBanner')) || (await isOver(H)), 90000);
    check('時間切れが2回続くと CPU にまかせる（または終わった）', done);
    if (await visible(A, '#autoBanner')) {
      check('時間切れをできごとに書く', /時間切れが2回続いた/.test(await logText(H)), await logText(H));
      check('札に「CPUが代わり」', (await table(H))[1].tags.some((t) => t === 'CPUが代わり'));
      await A.page.screenshot({ path: L.OUT + '/03-auto.png', fullPage: true });
      await A.page.click('#btnSelf');
      check('「自分でやる」でもどる', await A.page.waitForFunction(() => document.querySelector('#autoBanner').hidden, null, { timeout: 8000 }).then(() => true, () => false));
    }
    hold.delete('あお');
  }

  // ══ 最後まで ══
  check('最後までいく', await runUntil(() => isOver(H), 240000));
  const places = await H.page.$$eval('#resultList li', (xs) => xs.map((x) => x.querySelector('.df-result__name').textContent.replace('（あなた）', '')));
  const titles = await H.page.$$eval('#resultList li .df-tag--rank', (xs) => xs.map((x) => x.textContent));
  check('あがった順に4人', places.length === 4, places);
  check('結果に呼び名', titles.join() === '大富豪,富豪,貧民,大貧民', titles);
  check('みんなにみせる画面にも結果', await W.page.waitForFunction(() => document.querySelectorAll('#resultList li').length === 4, null, { timeout: 8000 }).then(() => true, () => false));
  check('参加する人は待つ', (await visible(A, '#resultWait')) && !(await visible(A, '#resultHost')));
  check('終わりを数える', await L.waitStats(H, 'finish', 1) || (await L.stats(A, 'finish')) + (await L.stats(B, 'finish')) === 1);
  const r1 = await L.roomOf(code);
  check('前回のあがり順をルームに置く', typeof r1.lastOrder === 'string' && JSON.parse(r1.lastOrder).length === 4);
  await H.page.screenshot({ path: L.OUT + '/04-result.png', fullPage: true });

  // ══ もう一回: カード交換 ══
  await H.page.click('#btnAgain');
  await A.page.waitForFunction(() => !document.querySelector('#result:not([hidden])') && document.querySelectorAll('#hand .df-card').length > 0, null, { timeout: 8000 });
  check('もう一回を数える', await L.waitStats(H, 'again', 1));
  check('2回目はカード交換から', /まずカード交換/.test(await logText(H)), await logText(H));
  const t1 = await table(H);
  const rankTag = (name) => (t1.find((x) => x.name === name) || { tags: [] }).tags.find((t) => /富豪|貧民|平民/.test(t));
  check('名前の横に前回の呼び名', rankTag(places[0]) === '大富豪' && rankTag(places[3]) === '大貧民', t1.map((x) => x.tags));
  const pageOf = (name) => pages[name] || null;
  const richP = pageOf(places[0]) || pageOf(places[1]);
  const poorP = pageOf(places[3]) || pageOf(places[2]);
  if (richP) check('上の人に「もらった・返すカードを選んでね」', await waitVisible(richP, '#actGive').then(() => true, () => false) && /をもらったよ/.test(await text(richP, '#exNote')));
  if (poorP) check('下の人に「わたした」', /をわたしたよ/.test(await text(poorP, '#exNote')));
  if (poorP) check('交換中は出せない', !(await visible(poorP, '#actPlay')));
  await (richP || H).page.screenshot({ path: L.OUT + '/05-exchange.png', fullPage: true });
  const exDone = await (async () => {
    const until = Date.now() + 25000;
    while (Date.now() < until) {
      for (const P of Object.values(pages)) { if (P && !P.page.isClosed()) await giveOn(P); }
      if (/カード交換がおわった/.test(await logText(H))) return true;
      await sleep(200);
    }
    return false;
  })();
  check('みんな返して交換がおわる', exDone);
  check('大貧民から出す', (await table(H)).find((x) => x.turn)?.name === places[3], await table(H));
  check('交換しても53枚', (await table(H)).reduce((a, x) => a + x.count, 0) === 53);
  if (poorP) check('交換の結果と、もらったカードの印', /をもらったよ/.test(await text(poorP, '#exNote')) && (await poorP.page.$$eval('#hand .df-card.is-got', (xs) => xs.length)) >= 1);

  // ══ 待合室へ → 交換オフで配る ══
  await H.page.click('#btnStop');
  await waitScreen(A, 'lobby');
  check('この回をやめて待合室へ', true);
  await H.page.uncheck('#lobbyRules input[data-rule="exchange"]');
  await waitText(A, '#lobbyRulesView', 'カード交換なし');
  await H.page.click('#btnStartGame');
  await waitScreen(A, 'game');
  const t2 = await table(H);
  check('交換オフなら名前の横に呼び名なし・♦3から', !t2.some((x) => x.tags.some((t) => /富豪|貧民|平民/.test(t))) && /♦3を持っている/.test(await logText(H)));
  await W.page.screenshot({ path: L.OUT + '/06-watch.png', fullPage: true });

  // ══ ルームを閉じる ══
  await H.page.click('#btnLeave');
  await waitScreen(A, 'top');
  check('ルームを閉じるとみんなトップへ', true);
  check('ルームは消える', (await L.roomOf(code)) === null);
  await waitScreen(W, 'watch-end');
  check('みんなにみせる画面は終わりの表示', true);

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
