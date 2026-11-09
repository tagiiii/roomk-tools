// ことばダッシュ！ E2E その2: 選んでこたえる問題（どっちが先？・どのなかま？・にせもの入り）・ホストは進行だけ・こたえる時間なし・ホストが押して進む
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const L = require('./lib.cjs');
const { check, sleep, roomOf } = L;

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'kotoba-dash', 'data.js'), 'utf8'), ctx);
const W = ctx.window.KOTOBA_DASH_WORDS;
const realWords = new Set(W.middle.concat(W.long));

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const mio = await L.newClient('mio', { viewport: { width: 375, height: 812 } });

  const code = await L.createRoom(host, 'すすめる');
  await host.page.uncheck('#setHostPlays');
  await host.page.waitForFunction(() => document.querySelector('#lobbyPlayers').textContent.includes('進行役'));
  check('host only: start disabled', await host.page.evaluate(() => document.querySelector('#btnStart').disabled));
  await L.joinRoom(mio, 'みお', code);
  await host.page.waitForFunction(() => !document.querySelector('#btnStart').disabled);
  check('guest sees 進行役 label', (await L.text(mio, '#lobbyPlayers')).includes('進行役'));

  for (const label of ['ことば', '逆走・ななめ', 'かくれ文字']) {
    await host.openAll();
    await host.page.locator('#kindOpts .kd-kind', { hasText: label }).click();
    await sleep(200);
  }
  await L.seg(host, 'limitOpts', '決めない');
  await L.seg(host, 'autoOpts', 'ホストが押す');
  await sleep(300);
  const s = (await roomOf(code)).settings;
  check('settings saved', JSON.stringify(s.kinds) === '["order","cat","fake"]' && s.limit === 0 && s.auto === 'off', s);
  await host.page.click('#btnStart');
  check('stats: players-1 (host not counted)', await L.waitStats(host, 'players-1', 1));

  let right = 0;
  for (let i = 0; i < 5; i++) {
    await L.waitText(mio, '#qNo', `${i + 1} / 5`, 15000);
    const room = await roomOf(code);
    const q = room.qs[i];
    check(`q${i + 1}: choice kind`, ['order', 'cat', 'fake'].includes(q.kind), q.kind);
    if (q.kind === 'fake') {
      check(`q${i + 1}: fake options are real words`, q.options.every((o) => realWords.has(o)), q.options);
      await mio.page.waitForSelector('.kd-word.is-real', { state: 'attached', timeout: 5000 }).catch(() => {});
      check(`q${i + 1}: real word has star`, await mio.page.evaluate(() => !!document.querySelector('.kd-word.is-real .kd-word__star')));
    }
    check(`q${i + 1}: host has no answer form`, !(await L.visible(host, '#qForm')) && !(await L.visible(host, '#qMeBox')));
    await L.waitAnswerable(mio);
    check(`q${i + 1}: no timer`, !(await L.visible(mio, '#qTimer')));
    check(`q${i + 1}: no hint bar on choices`, !(await L.visible(mio, '#qHintBar')));
    const n = await mio.page.evaluate(() => document.querySelectorAll('#qChoices button').length);
    check(`q${i + 1}: option count`, n === (q.kind === 'order' ? 2 : 3), n);
    check(`q${i + 1}: host progress`, (await L.text(host, '#qProgress')).includes('1人のうち 0人'));
    const mode = i % 2 === 0 ? 'right' : 'wrong';
    if (mode === 'right') right += 1;
    await L.answerNow(mio, code, mode);
    await L.waitText(mio, '#qMine', mode === 'right' ? 'あたり！' : 'ゆっくり見てみよう', 5000);
    await L.waitVisible(host, '#btnNext');
    check(`q${i + 1}: auto off → no hold button`, !(await L.visible(host, '#btnHold')));
    await sleep(800);
    check(`q${i + 1}: does not advance by itself`, (await roomOf(code)).q.idx === i);
    await host.page.click('#btnNext');
  }

  await L.waitVisible(mio, '#screen-result', 10000);
  const r = await roomOf(code);
  check('result: hits', r.hits?.['みお'] === right && !r.hits?.['すすめる'], r.hits);
  const people = await mio.page.evaluate(() => [...document.querySelectorAll('#resPeople li')].map((x) => x.textContent));
  check('result: host not listed', people.length === 1 && people[0].startsWith('みお'), people);
  check('result: 375 no overflow', (await L.overflow(mio)) <= 0, await L.overflow(mio));
  await L.shot(mio, '05-result-375');

  await L.finishAll(server);
})().catch(async (e) => { console.error(e); process.exit(2); });
