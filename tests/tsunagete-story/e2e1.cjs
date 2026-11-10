// つなげてストーリー E2E その1: ホスト・参加者2人（＋途中参加1人）で、お題の3択 → 書く → 読む → そのあと… → 2回め → おしまい まで通す
const L = require('./lib.cjs');
const { check, sleep, roomOf, rest } = L;

const arr = (v) => (Array.isArray(v) ? v : (v ? Object.values(v) : []));
const LABEL = { when: 'いつ', where: 'どこで', who: 'だれが', with: 'だれと', why: 'なぜ', how: 'どのように', what: '何をした' };

// 自分のうけもちの欄に書く（words: 項目のキー → 書く言葉）。candidate を渡した項目は候補から選ぶ
async function writeMine(c, words, candidate = []) {
  const cards = await c.page.$$('#wSlots .ts-slot');
  const done = [];
  for (const card of cards) {
    const label = (await card.$eval('.ts-slot__tag', (n) => n.textContent)).trim();
    const key = Object.keys(LABEL).find((k) => LABEL[k] === label);
    if (candidate.includes(key)) {
      await (await card.$('.ts-row button')).click();
      await (await card.$('.ts-cand')).click();
      done.push([key, null]);
    } else {
      await (await card.$('input')).fill(words[key] || 'テスト');
      done.push([key, words[key] || 'テスト']);
    }
  }
  return done;
}

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const mio = await L.newClient('mio', { viewport: { width: 375, height: 812 } });
  const late = await L.newClient('late');

  // はじめの画面（入口の型・絵）
  await L.open(host);
  check('top: entry visible', await L.visible(host, '#screen-top .app-entry'));
  check('top: illustration', await host.page.evaluate(() => !!document.querySelector('#screen-top .app-illust')));
  await L.shot(host, '01-top');

  const code = await L.createRoom(host, 'ホスト');
  const r0 = await roomOf(code);
  check('create: room waiting', r0?.status === 'waiting');
  check('create: defaults', r0.settings.hostPlays === true && r0.settings.themeMode === 'on' && JSON.stringify(r0.settings.extra) === '["how"]', r0.settings);
  check('stats: room-create', await L.waitStats(host, 'room-create', 1));
  check('lobby: start disabled alone', await host.page.evaluate(() => document.querySelector('#btnStart').disabled));
  await L.joinRoom(yu, 'ゆう', code);
  await L.joinRoom(mio, 'みお', code);
  await L.waitText(host, '#lobbyPlayers', 'みお');
  check('link: ?room removed after join', !(await yu.page.evaluate(() => location.search.includes('room'))));
  check('lobby: guest sees summary only', (await L.visible(yu, '#lobbyInfo')) && !(await L.visible(yu, '#lobbyHost')));

  // 文の項目に「なぜ」を足す → 6項目
  await host.page.locator('#extraOpts .ts-toggle', { hasText: 'なぜ' }).click();
  await L.waitText(host, '#extraNote', '6つ');
  check('lobby: extra why', JSON.stringify((await roomOf(code)).settings.extra) === '["why","how"]', (await roomOf(code)).settings.extra);
  await L.waitText(yu, '#lobbyRule', 'なぜ');
  await L.shot(host, '02-lobby-host');
  check('lobby 375: no overflow', (await L.overflow(mio)) <= 0);

  // はじめる → お題の3択
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-theme');
  check('stats: start/players-3', (await L.waitStats(host, 'start', 1)) && (await L.waitStats(host, 'players-3', 1)));
  let room = await roomOf(code);
  check('theme: 3 choices', arr(room.themeChoices).length === 3 && !room.theme, room.themeChoices);
  check('theme: begin disabled until chosen', await host.page.evaluate(() => document.querySelector('#btnBegin').disabled));
  check('theme: guest cards are not buttons', await yu.page.evaluate(() => document.querySelectorAll('#tChoices button').length === 0 && document.querySelectorAll('#tChoices .ts-choice').length === 3));
  check('theme: guest has no host box', !(await L.visible(yu, '#tHost')));
  const first3 = arr(room.themeChoices);
  const prevTitle = await host.page.$eval('#tChoices .ts-choice__title', (n) => n.textContent);
  await host.page.click('#btnTheme');
  await host.page.waitForFunction((prev) => {
    const t = [...document.querySelectorAll('#tChoices .ts-choice__title')].map((n) => n.textContent);
    return t.length === 3 && !t.includes(prev);
  }, prevTitle);
  room = await roomOf(code);
  check('theme: reroll gives 3 new', arr(room.themeChoices).every((id) => !first3.includes(id)), [first3, room.themeChoices]);
  const picked = arr(room.themeChoices)[1];
  await host.page.locator('#tChoices .ts-choice').nth(1).click();
  await yu.page.waitForFunction(() => !!document.querySelector('#tChoices .ts-choice.is-on'));
  check('theme: guest sees chosen', (await L.text(yu, '#tLead')).includes('決まりそう'));
  await L.shot(mio, '03-theme-guest-375');
  check('theme 375: no overflow', (await L.overflow(mio)) <= 0);
  await host.page.click('#btnBegin');

  // 書く: 3人で6項目 → 1人2つずつ・文は1つ
  await L.waitVisible(yu, '#screen-write');
  room = await roomOf(code);
  check('write: theme fixed', room.theme === picked && arr(room.usedThemes).includes(picked), [room.theme, room.usedThemes]);
  check('write: 6 slots', JSON.stringify(arr(room.slots)) === '["when","where","who","why","how","what"]', room.slots);
  check('write: each writer 2 tasks', ['ホスト', 'ゆう', 'みお'].every((n) => arr(room.tasks[n]).length === 2) && room.nSent === 1, room.tasks);
  check('stats: theme', await L.waitStats(host, 'theme-' + picked, 1));
  check('write: theme banner', (await L.text(yu, '#wTheme')).includes('お題'));
  check('write: input first, candidates hidden', await yu.page.evaluate(() => {
    const card = document.querySelector('#wSlots .ts-slot');
    return !card.querySelector('.ts-free').hidden && card.querySelector('.ts-cands').hidden;
  }));
  check('write: placeholder from theme', await yu.page.evaluate(() => /^例: .+/.test(document.querySelector('#wSlots input').placeholder)));
  check('write: send disabled until filled', await yu.page.evaluate(() => document.querySelector('#wSend').disabled));
  check('write: template marks mine', await yu.page.evaluate(() => document.querySelectorAll('#wTemplate .is-mine').length === 2));
  check('write: host progress 0/3', (await L.text(host, '#wProgress')).includes('0 / 3'));

  // 途中から入る人は、この回は見るだけ
  await L.joinRoom(late, 'あとから', code);
  await L.waitVisible(late, '#screen-write');
  check('late: watch only', (await L.visible(late, '#wWatch')) && !(await L.visible(late, '#wFormBox')));

  // ゆう: 自分で書く（助詞つきで書いても重ならない）＋ 1つは候補
  const words = { when: '夜おそく', where: '雲の上で', who: 'ねこが', why: 'ひまだったから', how: 'こっそり', what: 'おどりだした。' };
  await writeMine(yu, words);
  await yu.page.click('#wSend');
  await L.waitVisible(yu, '#wSent');
  check('write: sent text', (await L.text(yu, '#wSentText')).length > 0);
  check('write: rest count', (await L.text(yu, '#wSentRest')).includes('あと2人'));
  // 書きなおす
  await yu.page.click('#wRedo');
  await L.waitVisible(yu, '#wFormBox');
  await yu.page.click('#wSend');
  await L.waitVisible(yu, '#wSent');
  // 読み直しても送ったことが残る
  await yu.page.reload();
  await L.gate(yu);
  await L.waitVisible(yu, '#wSent', 10000);
  check('reload: still sent', await L.visible(yu, '#wSent'));

  await writeMine(mio, words, ['when', 'who', 'where', 'why', 'how', 'what'].slice(0, 6));
  await mio.page.click('#wSend');
  await L.waitVisible(mio, '#wSent');
  await writeMine(host, words);
  await host.page.locator('#wSlots input').last().press('Enter'); // Enter でも送れる

  // みんなが送ったら自動で読む
  await L.waitVisible(yu, '#screen-read', 10000);
  room = await roomOf(code);
  const parts = arr(arr(room.sents)[0].parts);
  check('read: 6 parts', parts.length === 6 && parts.every((p) => p), parts);
  const slotsNow = arr(room.slots);
  check('read: particle stripped', parts.every((p, i) => !({ where: /で$/, who: /が$/, what: /。$/ }[slotsNow[i]] || /$^/).test(p)), parts);
  check('read: sub stored', Object.keys(room.sub || {}).length === 3);
  // 1片ずつ出る
  const early = await yu.page.evaluate(() => document.querySelectorAll('#rPieces .ts-piece.is-open').length);
  check('read: not all at once', early < 6, early);
  await yu.page.waitForFunction(() => document.querySelectorAll('#rPieces .ts-piece.is-open').length === 6, null, { timeout: 15000 });
  const sentence = await yu.page.evaluate(() => [...document.querySelectorAll('#rPieces .ts-piece__text')].map((n) => n.textContent).join(''));
  check('read: sentence shape', /で、.*が、.*。$/.test(sentence), sentence);
  check('read: late can add line', await L.waitVisible(late, '#rNextBox', 5000).then(() => true, () => false));
  await L.shot(host, '04-read-host');
  await L.shot(mio, '05-read-375');
  check('read 375: no overflow', (await L.overflow(mio)) <= 0);

  // そのあと…: 自分で書く・候補から選ぶ・途中参加の人も
  await yu.page.fill('#rFreeInput', 'みんなで大笑いした。');
  await yu.page.click('#rFree button[type=submit]');
  await L.waitText(host, '#rLines', 'みんなで大笑いした。');
  await mio.page.click('#rFreeOpen');
  await L.waitVisible(mio, '#rCands .ts-cand');
  await mio.page.locator('#rCands .ts-cand').first().click();
  await host.page.waitForFunction(() => document.querySelectorAll('#rLines li').length === 2);
  await late.page.fill('#rFreeInput', 'それがニュースになった。');
  await late.page.click('#rFree button[type=submit]');
  await host.page.waitForFunction(() => document.querySelectorAll('#rLines li').length === 3);
  await L.waitVisible(yu, '#rFull');
  check('line: closed after 3', !(await L.visible(yu, '#rNextBox')));
  check('line: no author shown', !(await L.text(host, '#rLines')).includes('ゆう'));
  check('read: last sentence buttons', (await L.visible(host, '#btnRound')) && (await L.visible(host, '#btnEnd')) && !(await L.visible(host, '#btnNext')));

  // 2回め: お題の3択は1回めのお題を出さない → 「待たずに読む」でおまかせ → とばす → おしまい
  await host.page.click('#btnRound');
  await L.waitVisible(yu, '#screen-theme');
  room = await roomOf(code);
  check('round2: theme choices exclude used', !arr(room.themeChoices).includes(picked), room.themeChoices);
  check('round2: book has round1', arr(room.book).length === 1 && arr(arr(room.book)[0].lines).length === 3);
  await host.page.locator('#tChoices .ts-choice').first().click();
  await host.page.waitForFunction(() => !document.querySelector('#btnBegin').disabled);
  await host.page.click('#btnBegin');
  await L.waitVisible(late, '#screen-write');
  room = await roomOf(code);
  check('round2: late now writes', !!room.tasks['あとから'] && Object.keys(room.tasks).length === 4, room.tasks);
  await L.waitVisible(late, '#wFormBox');
  check('round2: late form visible', await L.visible(late, '#wFormBox'));
  await host.page.click('#btnReadNow');
  await L.waitVisible(yu, '#screen-read', 10000);
  room = await roomOf(code);
  check('round2: omakase filled', arr(arr(room.sents)[0].parts).every((p) => p && p.length > 0), room.sents);
  await host.page.click('#btnHide');
  await L.waitVisible(yu, '#rHidden');
  check('hide: guest sees skipped', await L.visible(yu, '#rHidden'));
  check('hide: no line box', !(await L.visible(yu, '#rNextBox')));
  await host.page.click('#btnEnd');
  await L.waitVisible(yu, '#screen-result');
  const book = await L.text(yu, '#endBook');
  check('end: round1 sentence with lines', book.includes('みんなで大笑いした。') && book.includes('お題'), book);
  check('end: hidden sentence not in book', arr((await roomOf(code)).book).length === 1);
  check('end: guest waits', await L.visible(yu, '#endWait'));
  await L.shot(host, '06-result');

  // もう一回（待合室へ）→ お題なし → すぐ書く
  await host.page.click('#btnAgain');
  await L.waitVisible(yu, '#screen-lobby');
  check('stats: again', await L.waitStats(host, 'again', 1));
  await L.seg(host, 'themeOpts', 'なし');
  await L.waitText(yu, '#lobbyRule', 'お題: なし');
  await host.page.click('#btnStart');
  await L.waitVisible(yu, '#screen-write');
  room = await roomOf(code);
  check('no theme: straight to write', room.status === 'write' && !room.theme, room.status);
  check('no theme: banner hidden', !(await L.visible(yu, '#wTheme')));

  // 退出・ルームを閉じる
  await late.page.click('#btnLeave');
  await L.waitVisible(late, '#screen-top');
  check('leave: guest removed', !(await roomOf(code)).players['あとから']);
  await host.page.click('#btnLeave');
  await L.waitVisible(yu, '#screen-top', 10000);
  check('close: room removed', (await roomOf(code)) === null);
  check('close: guest toast', await L.waitToast(yu, 'ルームが閉じられた').then(() => true, () => false));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });
