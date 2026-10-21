// ひとりで遊ぶ: はじめの画面・全部ぴったり・いいね・でたらめにたたく・止める/つづける・タイミング合わせ・スマホ
const L = require('./lib.cjs');
const { check, sleep } = L;

const goSolo = async (c, course, track) => {
  await c.page.click('#pb-go-solo');
  await L.pick(c, '#pb-solo-courses', course);
  await L.pick(c, '#pb-solo-tracks', track);
};

(async () => {
  const server = await L.startServer();
  await L.launch();

  // 1. はじめの画面
  {
    const c = await L.newClient('top');
    await L.open(c);
    check('はじめの画面が出る', (await L.screen(c)) === 'pb-top');
    check('名前', (await L.text(c, '#pb-title')) === 'ぴったりビート');
    const txt = await c.page.evaluate(() => document.body.innerText);
    check('使わないことばが出ない', !/支援|太鼓|どん|かっ|保存|試作/.test(txt));
    await goSolo(c, 'むずかしい', 'はやい');
    check('コースを選べる', (await c.page.getAttribute('#pb-solo-courses .pb-choice:nth-child(3)', 'aria-pressed')) === 'true');
    await L.reload(c);
    await c.page.click('#pb-go-solo');
    check('選んだコースを覚えている', (await c.page.getAttribute('#pb-solo-courses .pb-choice:nth-child(3)', 'aria-pressed')) === 'true');
    await c.page.click('#pb-solo [data-go-top]');
    await c.page.screenshot({ path: L.OUT + '/s01-top.png' });
    await c.page.click('.howto-fab');
    check('「？」に説明スライドの入口がある', /説明スライドを見る/.test(await c.page.evaluate(() => document.body.innerText)));
    await c.page.keyboard.press('Escape');
  }

  const jobs = [];

  // 2. やさしい・はやい: 譜面どおりに押すと全部ぴったり
  jobs.push((async () => {
    const c = await L.newClient('easy');
    await L.open(c);
    await goSolo(c, 'やさしい', 'はやい');
    await c.page.click('#pb-solo-start');
    await L.waitPlaying(c);
    check('やさしい: ボタンは1つ', (await c.page.evaluate(() => document.querySelectorAll('#pb-pads .pb-pad').length)) === 1);
    check('音の時計が動いている', (await c.page.evaluate(() => window.__pb.audio())) === 'running');
    check('曲のファイルを鳴らす', await c.page.evaluate(() => window.__pb.music()));
    check('利用回数: ひとりで遊ぶ', (await L.stats(c, 'solo')) === 1 && (await L.stats(c, 'play-fast')) === 1);
    const total = await c.page.evaluate(() => window.__pb.notes().length);
    const playing = L.autoplay(c);
    await sleep(7000);
    await c.page.screenshot({ path: L.OUT + '/s02-easy-playing.png' });
    await playing;
    await L.waitResult(c);
    const r = await L.results(c);
    check('やさしい: 全部ぴったり', r.perfect === total && r.good === 0, { r, total });
    check('やさしい: 最高点・ずっとつづけて当てた', r.score === total * 100 && r.combo === total, r);
    check('おわりの画面に責めることばがない', !/ミス|はずれ|ざんねん|失敗/.test(r.text));
    check('ひとりのときはランキングの案内が出ない', r.note === '');
    await c.page.screenshot({ path: L.OUT + '/s03-result.png' });
    await c.page.click('#pb-again');
    await L.waitPlaying(c);
    check('もう一回: 点は0から', (await c.page.evaluate(() => window.__pb.counts().perfect)) === 0);
    await c.page.click('#pb-pause');
    await c.page.click('#pb-quit');
    check('ひとり: やめると、ひとりで遊ぶ画面へ', (await L.screen(c)) === 'pb-solo');
  })());

  // 3. ふつう・ふつう: 少しずらして押す → いいね が混ざり、点数と回数が合う
  jobs.push((async () => {
    const c = await L.newClient('normal');
    await L.open(c);
    await goSolo(c, 'ふつう', 'ふつう');
    await c.page.click('#pb-solo-start');
    await L.waitPlaying(c);
    check('ふつう: ボタンは まる と ひしがた', (await c.page.evaluate(() => [...document.querySelectorAll('#pb-pads .pb-pad__label')].map((e) => e.textContent).join('/'))) === 'まる/ひしがた');
    const total = await c.page.evaluate(() => window.__pb.notes().length);
    await L.autoplay(c, 'return i % 3 === 0 ? 0.1 : 0;');
    await L.waitResult(c);
    const r = await L.results(c);
    check('ふつう: ぴったり と いいね', r.good > 0 && r.perfect > 0 && r.perfect + r.good === total, { r, total });
    check('ふつう: 点数＝回数から出した値', r.score === r.perfect * 100 + r.good * 50, r);
  })());

  // 4. むずかしい・はやい: 譜面どおりなら全部ぴったり／でたらめにたたいてもエラーなし・数が合う
  jobs.push((async () => {
    const c = await L.newClient('hard');
    await L.open(c);
    await goSolo(c, 'むずかしい', 'はやい');
    await c.page.click('#pb-solo-start');
    await L.waitPlaying(c);
    const total = await c.page.evaluate(() => window.__pb.notes().length);
    await L.autoplay(c);
    await L.waitResult(c);
    check('むずかしい: 16分音符も全部ぴったり', (await L.results(c)).perfect === total);
    await c.page.click('#pb-again');
    await L.waitPlaying(c);
    const pads = await c.page.$$('#pb-pads .pb-pad');
    let k = 0;
    while ((await L.screen(c)) === 'pb-play') {
      k++;
      if (k % 3 === 0) await pads[k % 2].dispatchEvent('pointerdown');
      else if (k % 3 === 1) await c.page.keyboard.press(k % 2 ? 'KeyF' : 'KeyJ');
      else await c.page.mouse.click(300 + (k % 5) * 100, 400);
      if (k % 7 === 0) await c.page.keyboard.press('Space');
      await sleep(20 + (k * 37) % 60);
      if (k > 4000) break;
    }
    const r = await L.results(c);
    check('でたらめ: 当てた数は しるしの数以下', r.perfect + r.good <= total, { r, total });
    check('でたらめ: 点数＝回数から出した値', r.score === r.perfect * 100 + r.good * 50, r);
    check('でたらめ: つづけた回数', r.combo <= r.perfect + r.good);
  })());

  // 5. とちゅうで止める・つづける・画面を切りかえる
  jobs.push((async () => {
    const c = await L.newClient('pause');
    const p = c.page;
    await L.open(c);
    await goSolo(c, 'ふつう', 'ふつう');
    await p.click('#pb-solo-start');
    await L.waitPlaying(c);
    await sleep(5500);
    await p.evaluate(() => new Promise((done) => {
      const t0 = window.__pb.now();
      const notes = window.__pb.notes().filter((n) => n.t > t0 + 0.2).slice(0, 3);
      let i = 0;
      const step = () => {
        const t = window.__pb.now();
        while (t !== null && i < notes.length && notes[i].t <= t + 0.003) document.dispatchEvent(new KeyboardEvent('keydown', { code: notes[i++].lane ? 'KeyJ' : 'KeyF', bubbles: true }));
        if (i >= notes.length) { done(); return; }
        setTimeout(step, 4);
      };
      step();
    }));
    const before = await p.evaluate(() => window.__pb.now());
    await p.click('#pb-pause');
    check('止めると「ひとやすみ中」', await L.visible(c, '#pb-pause-layer'));
    check('止めたときの点数の表示が合う', await p.evaluate(() => { const n = window.__pb.counts(); return +document.getElementById('pb-score').textContent === n.perfect * 100 + n.good * 50; }));
    await sleep(1500);
    check('止めている間は進まない', (await p.evaluate(() => window.__pb.now())) === null);
    await p.screenshot({ path: L.OUT + '/s04-pause.png' });
    const hitsBefore = await p.evaluate(() => window.__pb.counts().perfect + window.__pb.counts().good);
    check('止める前に3つ当てた', hitsBefore === 3, hitsBefore);
    await p.keyboard.press('KeyF');
    await p.keyboard.press('KeyJ');
    check('止めている間のキーは数えない', (await p.evaluate(() => window.__pb.counts().perfect + window.__pb.counts().good)) === hitsBefore);
    await p.evaluate(() => { const b = document.getElementById('pb-resume'); b.click(); b.click(); });
    await L.waitPlaying(c);
    const after = await p.evaluate(() => window.__pb.now());
    check('つづけると少し前から', after < before && after > before - 3, { before, after });
    check('つづけると、曲も続きから鳴る', await p.evaluate(() => window.__pb.music()));
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    check('ほかの画面に切りかえると止まる', (await p.evaluate(() => window.__pb.counts().paused)) === true);
    await p.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); });
    await p.keyboard.press('Escape');
    await L.waitPlaying(c);
    check('Esc でつづける', (await p.evaluate(() => window.__pb.counts().paused)) === false);
    await p.keyboard.press('Escape');
    check('Esc で止める', await L.visible(c, '#pb-pause-layer'));
    await p.click('#pb-quit');
    check('やめる→ひとりで遊ぶ画面', (await L.screen(c)) === 'pb-solo');
    await sleep(500);
    check('やめたあとは動いていない', (await p.evaluate(() => window.__pb.now())) === null);
  })());

  // 6. タイミング合わせ
  jobs.push((async () => {
    const c = await L.newClient('calib');
    const p = c.page;
    await L.open(c);
    await p.click('#pb-top [data-open-calib]');
    check('タイミング合わせの画面', (await L.screen(c)) === 'pb-calib');
    check('鳴らす前は押せない', await p.isDisabled('#pb-calib-pad'));
    await p.click('#pb-calib-run');
    await p.waitForFunction(() => window.__pb.calib() !== null);
    await p.evaluate(() => new Promise((done) => {
      const c0 = window.__pb.calib();
      let i = 2;
      const step = () => {
        const now = window.__pb.calib();
        if (!now) { done(); return; }
        if (now.heard - c0.t0 >= i * c0.beat + 0.15) {
          document.getElementById('pb-calib-pad').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          i++;
        }
        if (i >= 12) { done(); return; }
        setTimeout(step, 4);
      };
      step();
    }));
    await p.waitForFunction(() => window.__pb.calib() === null, null, { timeout: 15000 });
    const v = await p.evaluate(() => window.__pb.offset());
    check('ずれを測れる', Math.abs(v - 0.15) <= 0.02, v);
    await p.screenshot({ path: L.OUT + '/s05-calib.png' });
    await p.click('#pb-offset-plus');
    check('＋で0.01秒ふえる', Math.abs((await p.evaluate(() => window.__pb.offset())) - v - 0.01) < 0.0011);
    await p.click('#pb-offset-reset');
    check('0 にもどす', (await p.evaluate(() => window.__pb.offset())) === 0);
    await p.click('#pb-calib-back');
    check('ひらいた画面（はじめの画面）にもどる', (await L.screen(c)) === 'pb-top');
    await p.click('#pb-top [data-open-calib]');
    for (let i = 0; i < 20; i++) await p.click('#pb-offset-plus');
    await p.click('#pb-calib-back');
    await goSolo(c, 'やさしい', 'はやい');
    check('ひとりで遊ぶ画面にもずれが出る', /0\.20/.test(await L.text(c, '#pb-solo [data-offset-now]')));
    await p.click('#pb-solo-start');
    await L.waitPlaying(c);
    const total = await p.evaluate(() => window.__pb.notes().length);
    await L.autoplay(c);
    await L.waitResult(c);
    check('ずれ0.2秒でも、そのぶん差し引いて全部ぴったり', (await L.results(c)).perfect === total);
  })());

  await Promise.all(jobs);

  // 7. スマホ（縦・横・せまい画面）
  for (const [name, vp] of [['縦375', { width: 375, height: 667 }], ['縦320', { width: 320, height: 568 }], ['横', { width: 740, height: 360 }]]) {
    const c = await L.newClient('mobile-' + name, { viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const p = c.page;
    await L.open(c);
    check(name + ': はじめの画面がはみ出さない', (await L.overflow(c)) <= 0);
    await p.tap('#pb-go-solo');
    await p.tap('#pb-solo-courses .pb-choice:nth-child(2)');
    await p.tap('#pb-solo-tracks .pb-choice:nth-child(2)');
    check(name + ': ひとりで遊ぶ画面がはみ出さない', (await L.overflow(c)) <= 0);
    await p.tap('#pb-solo-start');
    await L.waitPlaying(c);
    check(name + ': 遊ぶ画面がはみ出さない', (await L.overflow(c)) <= 0);
    const boxes = await p.evaluate(() => [...document.querySelectorAll('#pb-pads .pb-pad')].map((b) => { const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, bottom: r.bottom }; }));
    check(name + ': ボタンが大きい', boxes.length === 2 && boxes.every((b) => b.w >= 100 && b.h >= 64), boxes);
    check(name + ': ボタンが画面に収まる', boxes.every((b) => b.bottom <= vp.height + 0.5), boxes);
    const stage = await p.evaluate(() => document.getElementById('pb-stage').getBoundingClientRect().height);
    check(name + ': しるしの落ちる場所が見える', stage >= 120, stage);
    check(name + ': 遊んでいる間は「？」が出ない', await p.evaluate(() => { const f = document.querySelector('.howto-fab'); return !f || getComputedStyle(f).display === 'none'; }));
    await p.evaluate(() => new Promise((done) => {
      const notes = window.__pb.notes().slice(0, 12);
      const pads = document.querySelectorAll('#pb-pads .pb-pad');
      let i = 0;
      const step = () => {
        const t = window.__pb.now();
        while (t !== null && i < notes.length && notes[i].t <= t + 0.003) pads[notes[i++].lane].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
        if (i >= notes.length) { done(); return; }
        setTimeout(step, 4);
      };
      step();
    }));
    const n = await p.evaluate(() => window.__pb.counts());
    check(name + ': タッチで当たる', n.perfect === 12, n);
    await p.screenshot({ path: L.OUT + '/s06-mobile-' + name + '.png' });
    await p.tap('#pb-pause');
    await p.tap('#pb-quit');
    check(name + ': やめられる', (await L.screen(c)) === 'pb-solo');
  }

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
