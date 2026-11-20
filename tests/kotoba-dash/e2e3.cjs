// ことばダッシュ！ E2E その3: 言葉の選択（日本語・英語・まぜる）。英語は大文字で入れても正解・選択肢も英語だけ・まぜるは両方から
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const L = require('./lib.cjs');
const { check, sleep, roomOf } = L;

const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'kotoba-dash', 'data.js'), 'utf8'), ctx);
const W = ctx.window.KOTOBA_DASH_WORDS;
const jaWords = new Set(W.middle.concat(W.long));
const enWords = new Set(W.en.middle.concat(W.en.long));
const enCatWords = new Set(Object.values(W.en.cats).flat());
const isEn = (s) => /^[a-z]+$/.test(s);
const texts = (q) => q.sprites.map((s) => s.text);

(async () => {
  await L.loadRules();
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const sora = await L.newClient('sora', { viewport: { width: 375, height: 812 } });

  const code = await L.createRoom(host, 'ホスト');
  await L.joinRoom(sora, 'そら', code);
  await host.page.waitForFunction(() => !document.querySelector('#btnStart').disabled);

  // はじめは日本語
  check('default lang ja', (await L.text(host, '#langOpts [aria-checked="true"]')).includes('日本語'));
  await L.waitText(sora, '#lobbyRule', '言葉: 日本語');

  // 英語・ことばだけ・時間なし・ホストが押す
  await L.seg(host, 'langOpts', '英語');
  for (const label of ['逆走・ななめ', 'どっちが先？', 'どのなかま？', 'にせもの入り', 'かくれ文字']) {
    await host.openAll();
    await host.page.locator('#kindOpts .kd-kind', { hasText: label }).click();
    await sleep(200);
  }
  await L.seg(host, 'limitOpts', '決めない');
  await L.seg(host, 'autoOpts', 'ホストが押す');
  await sleep(300);
  const s = (await roomOf(code)).settings;
  check('settings: lang en', s.lang === 'en' && JSON.stringify(s.kinds) === '["plain"]', s);
  check('lang note', (await L.text(host, '#langNote')).includes('英語'));
  await L.waitText(sora, '#lobbyRule', '言葉: 英語');
  await L.shot(host, '31-lobby-en');
  await host.page.click('#btnStart');

  const room = await roomOf(code);
  check('en: all words are English', room.qs.every((q) => isEn(q.answer) && enWords.has(q.answer)), room.qs.map((q) => q.answer));
  for (let i = 0; i < 5; i++) {
    await L.waitText(sora, '#qNo', `${i + 1} / 5`, 15000);
    const q = (await roomOf(code)).qs[i];
    await L.waitAnswerable(sora);
    await L.waitAnswerable(host);
    // 大文字（1問めは全角の大文字）で入れても正解
    const typed = i === 0 ? q.answer.toUpperCase().replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)) : q.answer.toUpperCase();
    await sora.page.fill('#qInput', typed);
    await sora.page.click('#qSubmit');
    await L.waitText(sora, '#qMine', 'あたり！', 5000);
    await host.page.click('#qPass');
    await L.waitVisible(host, '#btnNext', 8000);
    if (i === 0) await L.shot(sora, '32-reveal-en-375');
    await host.page.click('#btnNext');
  }
  await L.waitVisible(sora, '#screen-result', 10000);
  check('en: hits', (await roomOf(code)).hits?.['そら'] === 5);

  // もう一回 → 英語の選ぶ問題（どっちが先？・どのなかま？・にせもの入り）
  await host.page.click('#btnAgain');
  await L.waitVisible(host, '#lobbyHost', 8000);
  for (const label of ['どっちが先？', 'どのなかま？', 'にせもの入り', 'ことば']) {
    await host.openAll();
    await host.page.locator('#kindOpts .kd-kind', { hasText: label }).click();
    await sleep(200);
  }
  await sleep(300);
  check('settings kept lang en', (await roomOf(code)).settings.lang === 'en');
  await host.page.click('#btnStart');
  await sleep(500);
  const r2 = await roomOf(code);
  r2.qs.forEach((q, i) => {
    if (q.kind === 'fake') check(`en choice q${i + 1}: fake options English`, q.options.every((o) => enWords.has(o)), q.options);
    if (q.kind === 'order') check(`en choice q${i + 1}: order words English`, q.options.every((o) => enCatWords.has(o)), q.options);
    if (q.kind === 'cat') check(`en choice q${i + 1}: cat word English`, texts(q).every((t) => enCatWords.has(t)), texts(q));
  });
  // 1問だけ選んで当てる
  await L.waitAnswerable(sora);
  await L.answerNow(sora, code, 'right');
  await L.waitText(sora, '#qMine', 'あたり！', 5000);
  await L.shot(sora, '33-choice-en-375');

  // 結果まで進めて「もう一回」→ まぜる：日本語と英語の両方の言葉から出る
  for (let k = 0; k < 20; k++) {
    if (await L.visible(host, '#btnAgain')) break;
    if (await L.visible(host, '#btnNext')) await host.page.click('#btnNext');
    else if (await L.visible(host, '#btnReveal')) await host.page.click('#btnReveal');
    await sleep(1200);
  }
  await L.waitVisible(host, '#btnAgain', 20000);
  await host.page.click('#btnAgain');
  await L.waitVisible(host, '#lobbyHost', 8000);
  await L.seg(host, 'langOpts', 'まぜる');
  await L.seg(host, 'countOpts', '10問');
  await sleep(300);
  await L.waitText(sora, '#lobbyRule', '言葉: まぜる');
  await host.page.click('#btnStart');
  await sleep(500);
  const r3 = await roomOf(code);
  const all = r3.qs.flatMap(texts).join('');
  const words3 = r3.qs.filter((q) => q.kind === 'plain' || q.kind === 'dir').map((q) => q.answer);
  check('mix: words come from ja or en lists', words3.every((w) => jaWords.has(w) || enWords.has(w)), words3);
  check('mix: 10 questions', r3.qs.length === 10);
  console.log('  mix sample:', r3.qs.map((q) => q.answer).join(' '), /[a-z]/.test(all) && /[ぁ-ヶ]/.test(all) ? '(both)' : '(one side only this time)');

  check('375 no overflow', (await L.overflow(sora)) <= 0, await L.overflow(sora));
  await L.finishAll(server);
})().catch(async (e) => { console.error(e); process.exit(2); });
