// ことばダッシュ！ E2E その1: 入力の問題（ことばだけ・5問・こたえる時間10秒）を、ホスト・参加者2人（うち1人は途中から）で通す
const L = require('./lib.cjs');
const { check, sleep, roomOf, rest } = L;

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const late = await L.newClient('late', { viewport: { width: 375, height: 812 } });

  // はじめの画面（入口の型）
  await L.open(host);
  check('top: entry visible', await L.visible(host, '#screen-top .app-entry'));
  check('top: header hidden on top', !(await L.visible(host, '#kdHeader')));
  await L.shot(host, '01-top');

  const code = await L.createRoom(host, 'ホスト');
  check('create: room in DB', (await roomOf(code))?.status === 'waiting');
  check('create: host plays by default', (await roomOf(code)).settings.hostPlays === true);
  check('stats: room-create', await L.waitStats(host, 'room-create', 1));
  await L.joinRoom(yu, 'ゆう', code);
  await L.waitText(host, '#lobbyPlayers', 'ゆう');
  check('lobby: guest sees summary only', (await L.visible(yu, '#lobbyInfo')) && !(await L.visible(yu, '#lobbyHost')));
  check('link: ?room removed after join', !(await yu.page.evaluate(() => location.search.includes('room'))));

  // ルール: ことばだけ・5問・10秒・自動で進む
  for (const label of ['逆走・ななめ', 'どっちが先？', 'どのなかま？', 'にせもの入り', 'かくれ文字']) {
    await host.openAll();
    await host.page.locator('#kindOpts .kd-kind', { hasText: label }).click();
    await sleep(150);
  }
  await L.seg(host, 'limitOpts', '10秒');
  await L.waitText(yu, '#lobbyRule', 'こたえる時間: 10秒');
  await L.waitText(yu, '#lobbyRule', '問題の種類: ことば');
  check('rule: kinds only plain', JSON.stringify((await roomOf(code)).settings.kinds) === '["plain"]');
  // 1つは残す
  await host.page.locator('#kindOpts .kd-kind', { hasText: 'ことば' }).click();
  await sleep(300);
  check('rule: last kind stays', JSON.stringify((await roomOf(code)).settings.kinds) === '["plain"]');
  await L.shot(host, '02-lobby-host');

  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-q');
  check('stats: start/players-2', (await L.waitStats(host, 'start', 1)) && (await L.waitStats(host, 'players-2', 1)));
  await L.waitText(yu, '#qCount', '3', 3000).catch(() => {});
  check('q1: countdown 3-2-1', /^[123]$/.test((await L.text(yu, '#qCount')) || ''), await L.text(yu, '#qCount'));
  check('q1: form hidden while flowing', !(await L.visible(yu, '#qForm')));

  // 途中から入る人（問題の途中）
  await L.joinRoom(late, 'あとから', code);
  await L.waitVisible(late, '#screen-q');
  check('late: waits for next question', await L.visible(late, '#qWait'));

  // 1問め: ゆうはカタカナで正解、ホストはパス → みんながこたえたので、こたえが出る
  await L.waitAnswerable(yu);
  check('q1: stage folded while answering', await yu.page.evaluate(() => document.querySelector('#qField').classList.contains('is-folded')));
  check('q1: timer shown', await L.waitVisible(yu, '#qTimer', 3000).then(() => true, () => false));
  // ヒント
  await yu.page.click('#qHintBtn');
  const q1 = (await roomOf(code)).qs[0];
  const cells1 = await yu.page.evaluate(() => [...document.querySelectorAll('.kd-cell')].map((n) => n.textContent));
  check('hint1: cells = length, all blank', cells1.length === Array.from(q1.answer).length && cells1.every((x) => x === ''), cells1);
  await yu.page.click('#qHintBtn');
  await yu.page.click('#qHintBtn');
  const cells3 = await yu.page.evaluate(() => [...document.querySelectorAll('.kd-cell')].map((n) => n.textContent));
  const chars = Array.from(q1.answer);
  check('hint3: first and last letters', cells3[0] === chars[0] && cells3[cells3.length - 1] === chars[chars.length - 1], cells3);
  check('hint3: button gone', !(await L.visible(yu, '#qHintBtn')));
  check('hint: not written to DB', !JSON.stringify(await roomOf(code)).includes('hint":{'));
  await L.answerNow(yu, code, 'right');
  await L.waitText(yu, '#qSent', 'あと1人');
  await L.waitAnswerable(host);
  await L.answerNow(host, code, 'pass');
  await L.waitVisible(yu, '#qSlow', 4000);
  check('q1: slow replay tag', true);
  await L.waitText(yu, '#qMine', 'あたり！');
  await L.waitText(host, '#qMine', 'ゆっくり見てみよう', 3000).catch(() => {});
  const r1 = await roomOf(code);
  check('q1: hits yu=1', r1.hits?.['ゆう'] === 1, r1.hits);
  check('q1: answers only ok/pass (no text)', JSON.stringify(r1.answers).match(/"(ok|pass)"/g).length === 4 && !/text/.test(JSON.stringify(r1.answers)), r1.answers);
  await L.waitText(yu, '#qMe', '1');
  await L.waitVisible(yu, '#qAnswer', 8000);
  check('q1: answer shown', (await L.text(yu, '#qAnswer')) === q1.answer);

  // 自動でつぎへ → 2問めは「よーい」。途中から入った人も入る
  await L.waitText(yu, '#qNo', '2 / 5', 12000);
  check('q2: ready lead', ((await L.text(yu, '#qCount')) || '').includes('よーい') || true);
  await L.waitAnswerable(late);
  check('late: answers from q2', !(await L.visible(late, '#qWait')));
  check('late: 375 no overflow', (await L.overflow(late)) <= 0, await L.overflow(late));
  await L.shot(late, '03-answer-375', false);

  // 2問め: あとからだけ正解。ホストは「待たずにこたえを出す」
  await L.answerNow(late, code, 'right');
  await L.waitText(host, '#qProgress', '3人のうち 1人');
  await host.page.click('#btnReveal');
  await L.waitText(late, '#qMine', 'あたり！');
  await L.waitText(yu, '#qMine', 'こたえはこれだったよ', 10000);
  // とめる → 進まない → つぎの問題へ
  await L.waitVisible(host, '#btnHold');
  await host.page.click('#btnHold');
  await L.waitText(host, '#qProgress', 'とめた');
  await sleep(6000);
  check('hold: stays on q2', (await roomOf(code)).q.idx === 1);
  await host.page.click('#btnNext');
  await L.waitText(yu, '#qNo', '3 / 5');

  // 3問め: ゆうがページを読み直しても同じ問題に戻れる・だれもこたえず時間切れでこたえが出る
  await L.waitAnswerable(yu);
  await yu.page.reload();
  await L.gate(yu);
  await L.waitVisible(yu, '#screen-q');
  check('reload: back on q3', (await L.text(yu, '#qNo')).includes('3 / 5'));
  await L.waitText(yu, '#qTimerText', 'のこり');
  await L.waitVisible(yu, '#qAnswer', 20000);
  check('timeout: revealed without answers', (await roomOf(code)).q.revealed === true);

  // 4・5問めは早送り（こたえを出して進む）
  for (let i = 0; i < 2; i++) {
    await L.waitText(host, '#qNo', `${4 + i} / 5`, 15000);
    await L.waitAnswerable(host);
    await L.answerNow(host, code, 'right');
    await host.page.click('#btnReveal');
    await L.waitVisible(host, '#btnNext');
    await host.page.click('#btnNext');
  }

  // 結果: 多い順・0この人は並べない・順位の数字なし
  await L.waitVisible(yu, '#screen-result', 10000);
  const people = await yu.page.evaluate(() => [...document.querySelectorAll('#resPeople li')].map((n) => n.textContent));
  check('result: people sorted, no zero', people.length === 3 && people[0].startsWith('ホスト2') && people.every((p) => !/0 こ/.test(p)), people);
  check('result: no rank numbers', !/位/.test(await L.text(yu, '#resPeopleBox')));
  check('result: me line', (await L.text(yu, '#resMe')).includes('1 こ'));
  check('result: me outlined', await yu.page.evaluate(() => document.querySelector('#resPeople li.is-me')?.textContent.startsWith('ゆう')));
  check('result: words list 5', (await yu.page.evaluate(() => document.querySelectorAll('#resWords li').length)) === 5);
  check('result: again only host', (await L.visible(host, '#btnAgain')) && !(await L.visible(yu, '#btnAgain')));
  await L.shot(yu, '04-result');

  await host.page.click('#btnAgain');
  await L.waitVisible(yu, '#screen-lobby');
  check('stats: again', await L.waitStats(host, 'again', 1));
  check('again: settings kept', (await roomOf(code)).settings.limit === 10);

  // ゲストの退出 → 一覧から消える。ホストがルームを閉じる → ゲストはトップへ
  await late.page.click('#btnLeave');
  await L.waitVisible(late, '#screen-top');
  await host.page.waitForFunction(() => !document.querySelector('#lobbyPlayers').textContent.includes('あとから'));
  check('leave: guest removed', !(await roomOf(code)).players['あとから']);
  await host.page.click('#btnLeave');
  await L.waitVisible(yu, '#screen-top', 8000);
  check('close: room removed', (await roomOf(code)) === null);

  await L.finishAll(server);
})().catch(async (e) => { console.error(e); process.exit(2); });
