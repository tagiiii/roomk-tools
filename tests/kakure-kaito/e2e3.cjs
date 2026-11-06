// かくれ怪盗 E2E その3: ひとこと（決まった言葉をボタンで送る）。進行だけのホスト＋参加者4人＋みんなにみせる画面。
// 送れる人・段階ごとの言葉・「だれ？」・5秒に1回まで・名前の下と流れ・ひとことだけでは描きなおさない・
// 決まった言葉のほかは出さない・読み込み直し・待合室とはじめなおしで消える・途中から入った人・幅 375px
const L = require('./lib.cjs');
const { check, sleep } = L;

const word = (c, label) => c.page.locator('#say-pick .kk-word', { hasText: label }).first();
const logText = (c) => L.text(c, '#say-log');
const logCount = (c) => c.page.$$eval('#say-log .kk-say__item', (x) => x.length);
const bubble = (c, name) => c.page.$eval('#players', (ul, nm) => {
  const li = [...ul.children].find((x) => x.dataset.id === nm);
  const s = li && li.querySelector('.kk-player__say');
  return s && !s.hidden ? s.textContent : null;
}, name);
const groupLabels = (c) => c.page.$$eval('#say-pick .kk-say__group-label', (x) => x.map((n) => n.textContent));

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const code = await L.createRoom(H, 'メンター');
  await H.page.click('#host-plays'); // 進行だけ
  await L.waitFor(async () => (await L.roomOf(code)).hostPlays === false);
  const names = ['アキラ', 'ソラ', 'リク', 'ハナ'];
  const C = {};
  for (const nm of names) { C[nm] = await L.newClient(nm); await L.joinRoom(C[nm], nm, code); }
  const all = names.map((n) => C[n]);
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 860 } });
  await L.open(W, '?watch=' + code);
  await L.waitPhase(W, 'lobby');
  const A = C['アキラ'];
  const B = C['ソラ'];
  const D = C['ハナ'];

  check('H1 待合室ではひとことの欄が出ない', !(await L.visible(A, '#say')) && !(await L.visible(H, '#say')));

  await H.page.click('#btn-start');
  await L.waitPhaseAll(all.concat(H, W), 'reveal');
  check('H2 遊んでいる人に「ひとことを送る」', await L.visible(A, '#btn-say'));
  check('H3 進行だけのホストには送るボタンが出ない', !(await L.visible(H, '#btn-say')));
  check('H4 まだだれも送っていないと、みんなにみせる画面には欄が出ない', !(await L.visible(W, '#say')));
  check('H5 遊んでいる人には説明の一文', (await L.text(A, '#say-empty')).includes('ボタンでみんなに送れる') && await L.visible(A, '#say-empty'));

  // 役の確認の間は「いつでも」だけ
  await A.page.click('#btn-say');
  await L.waitVisible(A, '#say-pick .kk-word');
  check('H6 役の確認の間は「いつでも」だけ', JSON.stringify(await groupLabels(A)) === '["いつでも"]', await groupLabels(A));
  check('H7 ボタンは「とじる」になる', (await L.text(A, '#btn-say')).includes('とじる') && (await A.page.getAttribute('#btn-say', 'aria-expanded')) === 'true');
  await word(A, 'そう思う').click();
  const r1 = await L.roomWhen(code, (r) => r.say && r.say['アキラ']);
  const s1 = r1.say && r1.say['アキラ'];
  check('H8 say/{名前} にひとり1枠で書く', !!s1 && s1.k === 'yes' && s1.t === '' && Number(s1.gid) === Number(r1.game.gid) && Number(s1.s) === Number(r1.game.step), s1);
  await L.waitText(B, '#say-log', 'そう思う');
  check('H9 ほかの人の流れに出る', (await logText(B)).includes('アキラ') && (await logText(B)).includes('そう思う'));
  await L.waitText(W, '#say-log', 'そう思う');
  check('H10 みんなにみせる画面にも出る（送るボタンはなし）', await L.visible(W, '#say-log') && !(await L.visible(W, '#btn-say')));
  check('H11 送った人の名前の下に出る', (await bubble(B, 'アキラ')) === 'chat_bubbleそう思う', await bubble(B, 'アキラ'));
  check('H12 ホスト（進行だけ）の画面にも出る', await L.waitFor(async () => (await logText(H)).includes('そう思う')));
  check('H13 送ったあとも一覧はひらいたまま', await L.visible(A, '#say-pick .kk-word'));

  // 5秒に1回まで
  await word(A, 'オッケー').click();
  await L.waitToast(A, '5秒に1回まで');
  await sleep(400);
  check('H14 5秒たたないうちは送らない', (await L.roomOf(code)).say['アキラ'].k === 'yes');

  // ひとことだけ変わったときは、段階の中身を作りなおさない
  await B.page.evaluate(() => { document.querySelector('#stage').firstElementChild.__mark = 1; });
  await B.page.click('#btn-say');
  await word(B, 'ちょっと待って').click();
  await L.waitText(A, '#say-log', 'ちょっと待って');
  await sleep(300);
  check('H15 ひとことだけでは段階の中身を描きなおさない', await B.page.evaluate(() => document.querySelector('#stage').firstElementChild.__mark === 1));
  check('H16 流れは新しい順', (await A.page.$eval('#say-log .kk-say__item', (x) => x.textContent)).includes('ちょっと待って'));

  for (const nm of names) { await L.readRole(C[nm]); await C[nm].page.click('#stage .btn-primary'); }
  await L.waitFor(async () => Object.keys((await L.roomOf(code)).game.seen || {}).length === 4);
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'propose');

  // メンバー選びの間は「いつでも」「メンバー選び」「見回りのあと」。見やぶりの言葉は出ない
  check('H17 メンバー選びの間の組', JSON.stringify(await groupLabels(A)) === '["いつでも","メンバー選び","見回りのあと"]', await groupLabels(A));
  check('H18 見やぶりの言葉は出ない', !(await L.text(A, '#say-pick')).includes('名探偵'));
  check('H19 名前の入る言葉は〇〇で出る', (await L.text(A, '#say-pick')).includes('〇〇さんを入れたい'));
  check('H20 前の段階のひとことは、次の段階まで名前の下に残る', (await bubble(D, 'アキラ')) !== null);

  // 「だれ？」で人を選ぶ。やめるで戻る
  await D.page.click('#btn-say');
  await word(D, '〇〇さんがあやしいと思う').click();
  await L.waitVisible(D, '#say-pick .kk-say__ask');
  const who = await D.page.$$eval('#say-pick .kk-word--who', (x) => x.map((n) => n.textContent));
  check('H21 「だれ？」に自分は出ない', who.length === 3 && !who.some((t) => t.includes('ハナ')), who);
  await D.page.locator('#say-pick .kk-quiet', { hasText: 'やめる' }).click();
  await L.waitVisible(D, '#say-pick .kk-say__group');
  check('H22 やめると言葉の一覧にもどり、何も送らない', !((await L.roomOf(code)).say || {})['ハナ']);
  await word(D, '〇〇さんを入れたい').click();
  await D.page.locator('#say-pick .kk-word--who', { hasText: 'リク' }).click();
  const r2 = await L.roomWhen(code, (r) => r.say && r.say['ハナ']);
  check('H23 選んだ人を t に書く', r2.say['ハナ'].k === 'want' && r2.say['ハナ'].t === 'リク', r2.say['ハナ']);
  await L.waitText(W, '#say-log', 'リクさんを入れたい');
  check('H24 流れに名前の入った言葉', (await logText(W)).includes('ハナ') && (await logText(W)).includes('リクさんを入れたい'));
  check('H25 送ったあとは言葉の一覧にもどる', await L.visible(D, '#say-pick .kk-say__group'));

  // 決まった言葉のほかは出さない（知らないキー・自分の名前・前のゲーム）
  const before = await logCount(W);
  const gid = Number((await L.roomOf(code)).game.gid);
  const step = Number((await L.roomOf(code)).game.step);
  const bad = [
    ['知らないキー', 'リク', { k: 'hack', t: '' }],
    ['自分の名前', 'リク', { k: 'sus', t: 'リク' }],
    ['名前の要らない言葉に名前', 'リク', { k: 'ok', t: 'ソラ' }],
    ['遊んでいない人の名前', 'リク', { k: 'want', t: 'だれか' }],
    ['前のゲーム', 'リク', { k: 'ok', t: '', gid: gid - 1 }],
    ['遊んでいない人', 'だれか', { k: 'ok', t: '' }],
  ];
  for (const [label, from, v] of bad) {
    await L.rest('PUT', L.ROOMS + '/' + code + '/say/' + encodeURIComponent(from), Object.assign({ at: Date.now(), gid, s: step }, v));
    await sleep(500);
    check('H26 決まった言葉のほかは流れに出さない: ' + label, (await logCount(W)) === before, await logText(W));
  }
  await L.rest('DELETE', L.ROOMS + '/' + code + '/say/' + encodeURIComponent('だれか'));

  // 段階が2つ進むと、名前の下からは消える（流れには残る）
  await L.waitVisible(A, '#players');
  const leader = await L.leaderName(H);
  const P = C[leader];
  const size = L.E.teamSize(4, 0);
  for (const m of names.slice(0, size)) await L.pickBtn(P, m).click().then(() => sleep(250));
  await L.waitFor(async () => !(await P.page.isDisabled('#stage .btn-primary')), 3000);
  await P.page.click('#stage .btn-primary');
  await L.waitPhaseAll(all, 'vote');
  check('H28 2段階前のひとことは名前の下から消える', await L.waitFor(async () => (await bubble(A, 'ソラ')) === null));
  check('H29 1段階前のひとことは名前の下に残る', (await bubble(A, 'ハナ')) !== null);
  check('H30 流れには残る', (await logText(A)).includes('ちょっと待って'));

  // 読み込み直すと、いま入っている分（ひとりひとりの最新）から
  await B.page.reload();
  await L.waitPhase(B, 'vote');
  check('H31 読み込み直しても、いまのひとことは出る', await L.waitFor(async () => (await logText(B)).includes('リクさんを入れたい') && (await logText(B)).includes('ちょっと待って') && (await logText(B)).includes('そう思う')));
  check('H32 読み込み直すと一覧はとじている', !(await L.visible(B, '#say-pick')));

  // 途中から入った人（見ているだけ）は送らない
  const E2 = await L.newClient('late');
  await L.open(E2, '?room=' + code);
  await L.waitScreen(E2, 'join');
  await E2.page.fill('#guestName', 'ユイ');
  await E2.page.click('#btnJoinRoom');
  await L.waitPhase(E2, 'vote');
  check('H33 見ているだけの人には送るボタンが出ない', !(await L.visible(E2, '#btn-say')) && await L.visible(E2, '#say-log'));

  // 375px
  await D.page.setViewportSize({ width: 375, height: 760 });
  await L.waitVisible(D, '#say-pick .kk-word');
  await D.page.locator('#say').scrollIntoViewIfNeeded();
  await sleep(300);
  check('H34 375px で横スクロールなし', (await L.overflow(D)) <= 0);
  await L.shot(D, 'H-say-375');
  await L.shot(W, 'H-say-watch');

  // 「だれ？」を選んでいる途中で見やぶりに進むと、出せない言葉は言葉の一覧にもどる
  await word(D, '〇〇さんがあやしいと思う').click();
  await L.waitVisible(D, '#say-pick .kk-say__ask');
  // 見やぶりの間は「いつでも」「見やぶり」
  const room = await L.roomOf(code);
  await L.rest('PATCH', L.ROOMS + '/' + code + '/game', { phase: 'guess', step: Number(room.game.step) + 1, results: [true, true, true] });
  await L.waitPhase(A, 'guess');
  await L.waitVisible(A, '#say-pick .kk-word');
  check('H35 見やぶりの間の組', JSON.stringify(await groupLabels(A)) === '["いつでも","見やぶり"]', await groupLabels(A));
  check('H36 見やぶりの言葉', (await L.text(A, '#say-pick')).includes('〇〇さんが名探偵だと思う'));
  await L.shot(A, 'H-say-guess');
  check('H37a 段階が進んで出せなくなった言葉の「だれ？」は一覧にもどる', await L.waitFor(async () => !(await L.visible(D, '#say-pick .kk-say__ask')) && (await L.text(D, '#say-pick')).includes('名探偵だと思う')));
  // キーボードで選んでも、フォーカスが次のボタンへ移る
  await word(A, '〇〇さんが名探偵だと思う').focus();
  await A.page.keyboard.press('Enter');
  await L.waitVisible(A, '#say-pick .kk-say__ask');
  check('H37b キーボードで名前の入る言葉を選ぶと、フォーカスは「だれ？」の最初の人へ', await A.page.evaluate(() => document.activeElement?.classList.contains('kk-word--who')));
  await A.page.locator('#say-pick .kk-quiet', { hasText: 'やめる' }).focus();
  await A.page.keyboard.press('Enter');
  await L.waitVisible(A, '#say-pick .kk-say__group');
  check('H37c 「やめる」のあとは、選んでいた言葉にフォーカスがもどる', await A.page.evaluate(() => document.activeElement?.dataset.k === 'det'));
  await A.page.keyboard.press('Enter');
  await L.waitVisible(A, '#say-pick .kk-say__ask');
  await A.page.keyboard.press('Enter');
  await L.waitText(W, '#say-log', '名探偵だと思う');
  check('H37d 送ったあとも、選んでいた言葉にフォーカスがもどる', await A.page.evaluate(() => document.activeElement?.dataset.k === 'det'));
  check('H37e 読み上げには新しく届いた1件だけ', (await L.text(W, '#say-live')).startsWith('アキラ、') && (await L.text(W, '#say-live')).includes('名探偵だと思う') && !(await W.page.getAttribute('#say-log', 'aria-live')));

  // 待合室にもどると消える
  await H.page.evaluate(() => { document.getElementById('host-menu').open = true; }); await H.page.locator('#host-menu button', { hasText: '待合室にもどる' }).click();
  await L.waitPhaseAll(all, 'lobby');
  check('H37 待合室にもどると say を消す', !(await L.roomOf(code)).say);
  check('H38 待合室では欄が出ない', !(await L.visible(A, '#say')) && !(await L.visible(W, '#say')));

  // はじめなおすと前の流れは出ない
  await H.page.click('#btn-start');
  await L.waitPhaseAll(all.concat(W), 'reveal');
  check('H39 はじめなおすと前の流れは出ない', (await logCount(A)) === 0 && !(await L.visible(W, '#say')));

  await H.page.click('#btnLeave');
  await L.waitScreen(H, 'top');
  check('H40 ルームを閉じると消える', await L.waitFor(async () => (await L.roomOf(code)) === null));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
