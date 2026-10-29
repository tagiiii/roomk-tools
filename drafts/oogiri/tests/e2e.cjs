// ひらめき大喜利（試作）を、同じブラウザのウィンドウ（ホスト・参加2人・みんなにみせる画面）で動かして確かめる。
// 通信はしない（配信用のサーバーを 127.0.0.1 に立てるだけ）。画面の写真は一時フォルダに出す。
// ホストは ?fast=1 で開く（押せる時間は3分の1・はじめの15秒は5秒に。一本 1.2秒）。
// 実行: PLAYWRIGHT=<playwright のフォルダ> node drafts/oogiri/tests/e2e.cjs
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'oogiri-e2e-'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; } else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p.endsWith('/') ? p + 'index.html' : p, (err, buf) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port + '/drafts/oogiri/';
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.replace(/\/drafts.*$/, '') });
  const errors = [];
  const watch = (page, tag) => {
    page.on('console', (m) => { if (m.type() !== 'error') return; const u = (m.location() || {}).url || ''; if (/\/favicon\.ico$/.test(u)) return; errors.push(tag + ': ' + m.text() + ' @ ' + u); });
    page.on('pageerror', (e) => errors.push(tag + ': ' + e.message));
    page.on('dialog', (d) => d.accept());
  };
  const visible = (p, sel) => p.isVisible(sel);
  const text = (p, sel) => p.textContent(sel);
  const body = (p) => p.evaluate(() => document.body.innerText);
  const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  const until = async (fn, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(40); } return false; };
  const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const stage = (p) => p.evaluate(() => (document.getElementById('stage-on').hidden ? '' : document.getElementById('stage-text').textContent));
  const shown = (p) => p.$$eval('#shown-list .og-list__item', (els) => els.map((e) => ({ t: e.querySelector('.og-list__text').textContent, w: e.querySelector('.og-list__what').textContent, ippon: e.classList.contains('is-ippon') })));
  const mine = (p) => p.$$eval('#mine-list .og-list__item', (els) => els.map((e) => e.querySelector('.og-list__text').textContent + ':' + e.querySelector('.og-list__what').textContent));
  const ipponOn = (p) => p.evaluate(() => !document.getElementById('og-ippon').hidden);
  const answer = async (p, t, h) => {
    await p.fill('#answer-input', t);
    await p.click('#btn-answer');
    if (!h) return;
    // 参加者の答えはホストが確認してから出る
    const sel = '#check-list li:has-text("' + t + '") .og-approve';
    await until(async () => (await h.$$(sel)).length > 0);
    await h.click(sel);
  };
  const setMode = (p, label) => p.click('#mode-opts .og-seg__btn:text-is("' + label + '")');
  const BOTH = '答えも出す', PRESS = '投票だけ';
  const segs = (p, sel) => p.$$eval(sel + ' .og-seg__btn', (els) => els.map((e) => e.textContent).join('/'));
  const segOn = (p, sel) => p.$eval(sel + ' .og-seg__btn.is-on', (e) => e.textContent);
  const modeOn = (p) => p.$eval('#mode-opts .og-seg__btn.is-on', (e) => e.textContent);

  // ── 0. 一本に必要な数の表 ──
  const calc = await ctx.newPage(); watch(calc, 'calc');
  await calc.goto(BASE);
  const need = await calc.evaluate(() => [1, 2, 3, 4, 5, 7].map((n) => [window.OOGIRI_NEED(n, 'half'), window.OOGIRI_NEED(n, 'two3'), window.OOGIRI_NEED(n, 'all')]));
  ok(JSON.stringify(need.map((r) => r[0])) === '[1,1,2,2,3,4]', '0-1 半分（押せる人1,2,3,4,5,7人 → 1,1,2,2,3,4）', need);
  ok(JSON.stringify(need.map((r) => r[1])) === '[1,2,2,3,4,5]', '0-2 3分の2', need);
  ok(JSON.stringify(need.map((r) => r[2])) === '[1,2,3,4,5,7]', '0-3 全員', need);
  ok(await calc.evaluate(() => window.OOGIRI_NEED(0, 'half') === Infinity), '0-4 押せる人0人では一本にならない');
  await calc.close();

  // ── A. ルームを作る・入る ──
  const host = await ctx.newPage(); watch(host, 'host');
  await host.goto(BASE + '?fast=1');
  ok(await visible(host, '#og-front') && !(await visible(host, '#og-front-mode')), 'A1 はじめの画面（ホストは参加のしかたを選ばない）');
  await host.click('#og-front-go');
  ok((await text(host, '#og-front-msg')).includes('ニックネーム'), 'A2 名前なしは止める');
  await host.fill('#og-name', 'メンター');
  await host.click('#og-front-go');
  ok(await until(() => visible(host, '#ph-lobby')), 'A3 待合室');
  const code = (await text(host, '#og-bar-code')).replace(/^.*\s/, '');
  ok(/^[A-HJ-NP-Z2-9]{6}$/.test(code), 'A4 ルームコード', code);
  ok(await host.isDisabled('#btn-start'), 'A5 押せる人1人では始められない');
  ok((await text(host, '#lobby-start-note')).includes('2人以上'), 'A6 始められない理由');
  ok((await host.$$eval('#ratio-opts .og-seg__btn', (els) => els.map((e) => e.textContent).join('/'))) === '半分/3分の2/全員', 'A7 一本の決め方は3つ');
  ok((await host.$eval('#ratio-opts .is-on', (e) => e.textContent)) === '半分', 'A8 はじめは半分');
  ok((await host.$$eval('#mode-opts .og-seg__btn', (els) => els.map((e) => e.textContent).join('/'))) === BOTH + '/' + PRESS + '/進行だけ', 'A9 ホストの参加のしかたは3つ');
  ok((await modeOn(host)) === BOTH, 'A10 ホストもはじめは答える・押す');
  ok((await segs(host, '#cut-opts')) === '一本が出たら/時間で' && (await segOn(host, '#cut-opts')) === '一本が出たら', 'A10b お題の区切りは2つ・はじめは一本が出たら');
  ok(!(await visible(host, '#time-opts')), 'A10c 一本で区切るときは時間を選ばない');
  ok((await segs(host, '#show-opts')) === '10秒/15秒/20秒' && (await segOn(host, '#show-opts')) === '15秒', 'A10e 答えを見る時間は10・15・20秒（はじめは15秒）');
  ok((await text(host, '#mode-note')).includes('おもしろい！'), 'A10d 参加のしかたの説明に「おもしろい！」');
  await host.click('#btn-copy');
  ok(await until(async () => (await text(host, '#btn-copy')).includes('コピーした')), 'A11 リンクをコピー');
  ok((await host.evaluate(() => navigator.clipboard.readText())).endsWith('?room=' + code), 'A12 コピーしたリンク');

  const nope = await ctx.newPage(); watch(nope, 'nope');
  await nope.goto(BASE + '?room=ZZZZZZ');
  await nope.fill('#og-name', 'だれか');
  await nope.click('#og-front-go');
  ok(await until(async () => (await text(nope, '#og-front-msg')).includes('見つからない')), 'A13 ないルームには入れない');
  await nope.close();

  const g1 = await ctx.newPage(); watch(g1, 'g1');
  await g1.goto(BASE + '?room=' + code);
  ok((await text(g1, '#og-front-go')) === '入る' && await visible(g1, '#og-front-mode'), 'A14 リンクからは「入る」と参加のしかた');
  ok(await g1.isChecked('input[name="front-mode"][value="both"]'), 'A15 はじめは答えも出す');
  ok((await text(g1, '#og-front-mode')).includes('「おもしろい！」を押して投票する'), 'A15b 投票だけの説明がある');
  await g1.fill('#og-name', 'あおい');
  await g1.click('#og-front-go');
  ok(await until(() => visible(g1, '#ph-lobby')), 'A16 参加1 待合室');
  ok(await visible(g1, '#lobby-wait') && !(await visible(g1, '#lobby-host')), 'A17 参加者は待つ');
  ok((await g1.$$eval('#mode-opts .og-seg__btn', (els) => els.map((e) => e.textContent).join('/'))) === BOTH + '/' + PRESS, 'A18 参加者は2つから（進行だけはない）');
  const g2 = await ctx.newPage(); watch(g2, 'g2');
  await g2.goto(BASE + '?room=' + code);
  await g2.fill('#og-name', '<b>そら</b>');
  await g2.check('input[name="front-mode"][value="press"]');
  await g2.click('#og-front-go');
  ok(await until(() => visible(g2, '#ph-lobby')), 'A19 参加2 待合室');
  ok((await modeOn(g2)) === PRESS, 'A20 押すだけで入れる');
  ok(await until(async () => (await host.$$('#lobby-players li')).length === 3), 'A21 ホストに3人');
  ok((await body(host)).includes('<b>そら</b>') && (await host.$$('#lobby-players b')).length === 0, 'A22 名前の HTML は文字のまま');
  ok(!(await text(host, '#lobby-players')).includes(PRESS) && !(await text(g1, '#lobby-players')).includes(PRESS), 'A23 参加のしかたは一覧に出ない');
  ok(await until(async () => !(await host.isDisabled('#btn-start'))), 'A24 押せる人3人で始められる');
  ok((await text(host, '#lobby-start-note')).includes('3人'), 'A25 投票する人 3人', await text(host, '#lobby-start-note'));

  // ── B. みんなにみせる画面 ──
  const [tv] = await Promise.all([ctx.waitForEvent('page'), host.click('#btn-watch')]);
  watch(tv, 'tv');
  ok(await until(() => visible(tv, '#ph-lobby')), 'B1 みんなにみせる画面がひらく');
  ok((await host.$$('#lobby-players li')).length === 3, 'B2 みんなにみせる画面は参加者に数えない');
  ok(!(await visible(tv, '#mode-card')) && !(await visible(tv, '#lobby-host')) && !(await visible(tv, '#lobby-wait')), 'B3 みんなにみせる画面には操作がない');

  // 押せる人の数え方: ホストが進行だけ → 2人、押すだけ → 3人
  await setMode(host, '進行だけ');
  ok(await until(async () => (await text(host, '#lobby-start-note')).includes('2人')), 'B4 進行だけのホストは押せる人に数えない');
  await setMode(g1, PRESS);
  ok(await until(async () => (await text(host, '#lobby-start-note')).includes('2人')), 'B5 押すだけの人は押せる人に数える');
  await setMode(g2, BOTH);
  await setMode(host, BOTH);
  await setMode(g1, BOTH);
  await setMode(g2, PRESS);
  ok(await until(async () => (await text(host, '#lobby-start-note')).includes('3人')), 'B6 切りかえが届く');

  // 区切りを時間（5分）にする。ここからの流れは5分のうちに終わる
  await host.click('#cut-opts .og-seg__btn:text-is("時間で")');
  ok(await until(() => visible(host, '#time-opts')) && (await segs(host, '#time-opts')) === '2分/3分/5分' && (await segOn(host, '#time-opts')) === '3分', 'B7 時間で区切るときは2・3・5分（はじめは3分）');
  await host.click('#time-opts .og-seg__btn:text-is("5分")');
  ok(await until(async () => (await text(g1, '#howto-cut')).includes('5分')), 'B8 区切りがあそびかたに出る');

  // ── C. お題を選ぶ ──
  await host.click('#btn-start');
  ok(await until(() => visible(host, '#ph-pick')), 'C1 お題を選ぶ画面');
  ok((await host.$$('#pick-cands .og-cand')).length === 3, 'C2 候補は3つ');
  ok(await until(() => visible(g1, '#pick-other')) && !(await visible(g1, '#pick-host')), 'C3 参加者は待つ');
  ok(await visible(tv, '#pick-other'), 'C4 みんなにみせる画面も待つ');
  const c1 = await host.$$eval('#pick-cands .og-cand', (els) => els.map((e) => e.textContent));
  await host.click('#btn-reroll');
  const c2 = await host.$$eval('#pick-cands .og-cand', (els) => els.map((e) => e.textContent));
  ok(c2.length === 3 && c2.every((t) => !c1.includes(t)), 'C5 ほかの候補は別のお題', [c1, c2]);
  const topic1 = c2[0];
  await host.click('#pick-cands .og-cand >> nth=0');
  ok(await until(() => visible(host, '#ph-play')), 'C6 答える画面');
  ok(await until(async () => (await text(g1, '#play-topic')) === topic1 && (await text(tv, '#play-topic')) === topic1), 'C7 みんなに同じお題');
  ok(await visible(g1, '#stage-empty') && (await text(g1, '#stage-empty')).includes('答えが出るのを待っている'), 'C8 答えが出るまでは待つ案内');
  ok(await until(async () => /^のこり [45]:\d\d$/.test(await text(tv, '#play-left'))) && !(await visible(tv, '#play-rule')), 'C9 のこり時間が出る', await text(tv, '#play-left'));

  // ── D. 答えを出す・一本 ──
  ok(await visible(g1, '#answer-form') && await visible(host, '#answer-form'), 'D1 答える・押すの人に入力欄');
  ok(!(await visible(g2, '#answer-form')), 'D2 押すだけの人に入力欄はない');
  ok(!(await visible(g2, '#my-card')), 'D2b 投票だけで答えがない人には「あなたの答え」を出さない');
  ok(!(await visible(tv, '#answer-form')) && !(await visible(tv, '#mode-card')), 'D3 みんなにみせる画面に入力欄はない');
  await g1.click('#btn-answer');
  ok((await text(g1, '#answer-msg')).includes('書いてね'), 'D4 空の答えは出せない');
  await answer(g1, '<i>レジが全部セルフ、店員もセルフ</i>', host);
  ok(await until(async () => (await stage(host)) === '<i>レジが全部セルフ、店員もセルフ</i>'), 'D5 答えが出る（HTML は文字のまま）');
  ok(await until(async () => (await g1.inputValue('#answer-input')) === ''), 'D6 出したら入力欄が空になる');
  ok(await until(async () => (await stage(tv)) !== '' && (await stage(g2)) !== ''), 'D7 みんなの画面に同じ答え');
  ok((await tv.$$('#stage-text i')).length === 0, 'D8 答えの HTML は文字のまま（みんなにみせる画面）');
  ok(!(await text(tv, '#stage')).includes('あおい') && !(await text(g2, '#stage')).includes('あおい'), 'D9 押している間は名前を出さない');
  ok(await visible(g1, '#stage-mine') && !(await visible(g1, '#btn-press')), 'D10 自分の答えには押せない');
  ok((await text(g2, '#stage-hint')).includes('投票して'), 'D10b 投票の案内');
  ok((await text(tv, '#stage-hint')).includes('自分の画面で'), 'D10c みんなにみせる画面には、自分の画面で押す案内');
  ok(await visible(host, '#btn-press') && await visible(g2, '#btn-press'), 'D11 ほかの人は押せる（押すだけの人も）');
  ok(!(await visible(tv, '#btn-press')), 'D12 みんなにみせる画面には押すボタンがない');
  ok((await text(g2, '#stage-sec')).includes('秒'), 'D13 のこりの秒');
  ok(!/[0-9]+\s*(人|票)/.test(await text(g2, '#stage')), 'D14 押した数は出ない');
  ok((await mine(g1)).some((s) => s.endsWith('いま出ているよ')), 'D15 自分の画面に「いま出ているよ」', await mine(g1));
  // 押せる人 = ホスト・そら（2人）→ 半分で1人
  await g2.click('#btn-press');
  ok(await until(() => ipponOn(host)), 'D16 1人押して一本（押せる人2人の半分）');
  ok(await until(() => ipponOn(tv)) && await until(() => ipponOn(g1)), 'D17 みんなの画面に一本');
  ok((await text(tv, '#og-ippon')).includes('あおいさん') && (await text(tv, '#og-ippon')).includes('レジが全部セルフ'), 'D18 一本のときだけ名前を出す');
  await shot(tv, 'd-ippon-tv');
  ok(await until(async () => !(await ipponOn(host))), 'D19 一本は少しのあいだだけ');
  ok(await until(async () => { const s = await shown(g2); return s.length === 1 && s[0].ippon && s[0].w === 'あおいさん'; }), 'D20 出た答えに一本（名前つき）', await shown(g2));
  ok((await mine(g1)).some((s) => s.endsWith('一本！')), 'D21 自分の画面に「一本！」', await mine(g1));

  // ── E. 一本にならない答え ──
  await answer(host, 'おでんの具が全部ちくわぶ');
  ok(await until(async () => (await stage(g1)) === 'おでんの具が全部ちくわぶ'), 'E1 ホストも答えられる');
  ok(await until(async () => (await stage(g1)) === '', 8000), 'E2 だれも押さないと時間で次へ');
  ok(!(await ipponOn(g1)), 'E3 一本は出ない');
  const s1 = await shown(g1);
  ok(s1.length === 2 && !s1[0].ippon && s1[0].w === '', 'E4 一本でない答えは名前なしで出た答えへ', s1);
  ok((await shown(host))[0].w === 'あなた', 'E5 書いた本人の画面にだけ「あなた」');

  // ── Q. ホストの確認 ──
  await answer(g1, 'かくにんまち');
  ok(await until(async () => (await text(host, '#check-list')).includes('かくにんまち')), 'Q1 ホストに「確認する答え」');
  ok((await text(host, '#check-list')).includes('あおいさん'), 'Q2 ホストには書いた人も出る');
  ok(await until(async () => (await mine(g1)).includes('かくにんまち:ホストが確認中')), 'Q3 書いた人には「ホストが確認中」', await mine(g1));
  ok((await text(g1, '#answer-msg')).includes('ホストが確認したら'), 'Q4 出したときの案内');
  await sleep(400);
  ok((await stage(tv)) === '' && !(await text(tv, '#ph-play')).includes('かくにんまち') && !(await text(g2, '#ph-play')).includes('かくにんまち'), 'Q5 確認するまでほかの人には出ない');
  ok(!(await visible(g2, '#check-card')) && !(await visible(tv, '#check-card')) && !(await visible(g1, '#check-card')), 'Q6 確認する答えはホストだけ');
  ok(await visible(host, '#host-panel') && !(await visible(g1, '#host-panel')) && !(await visible(tv, '#host-panel')), 'Q6b ホストの操作はホストの画面にだけ');
  ok((await text(host, '#check-count')) === '1つ', 'Q6c 届いた答えの数');
  ok((await text(host, '#stage-empty')).includes('みんなに出す'), 'Q6d 答えが出ていないとき、ホストには確認の案内');
  await host.click('#check-list li:has-text("かくにんまち") .og-reject');
  ok(await until(async () => (await mine(g1)).includes('かくにんまち:ホストがかくした')), 'Q7 確認でかくすと本人にだけ「ホストがかくした」');
  ok(await until(async () => !(await visible(host, '#check-card'))), 'Q8 確認する答えがなくなると消える');
  await answer(g1, 'かくにんOK', host);
  ok(await until(async () => (await stage(tv)) === 'かくにんOK'), 'Q9 「みんなに出す」で出る');
  ok(!(await text(tv, '#stage')).includes('あおい'), 'Q10 出ても名前は出さない');
  await answer(host, 'ホストのこたえ');
  ok(await until(async () => (await host.$$('#queue-list li')).length === 1) && !(await visible(host, '#check-card')), 'Q11 ホストの答えは確認しない');
  ok(await until(async () => (await stage(tv)) === 'ホストのこたえ', 9000), 'Q12 ホストの答えも順番に出る');
  ok(await until(async () => (await stage(tv)) === '', 9000), 'Q13 時間で次へ');

  // ── F. 順番待ちは2つまで・ホストがかくす ──
  await answer(g1, 'ひとつめ', host);
  ok(await until(async () => (await stage(host)) === 'ひとつめ'), 'F1 1つ目が出る');
  await answer(g1, 'ふたつめ', host);
  await until(async () => (await g1.inputValue('#answer-input')) === '');
  await answer(g1, 'みっつめ', host);
  await until(async () => (await g1.inputValue('#answer-input')) === '');
  ok(await until(() => g1.isDisabled('#btn-answer')), 'F2 順番待ちが2つで出すボタンが押せない');
  ok((await text(g1, '#answer-msg')).includes('2つ'), 'F3 順番待ちの案内');
  ok(JSON.stringify((await mine(g1)).slice(0, 3)) === JSON.stringify(['ふたつめ:順番待ち', 'みっつめ:順番待ち', 'ひとつめ:いま出ているよ']), 'F4 自分の答えの状態', await mine(g1));
  ok(await visible(host, '#queue-card') && (await host.$$('#queue-list li')).length === 2, 'F5 ホストに「このあと出る答え」');
  ok((await text(host, '#queue-list')).includes('あおいさん'), 'F6 ホストには書いた人も出る');
  ok(!(await visible(g2, '#queue-card')) && !(await visible(tv, '#queue-card')), 'F7 このあと出る答えはホストだけ');
  // むりに3つ目を送っても受けない
  await g1.evaluate(() => { const b = document.getElementById('btn-answer'); b.disabled = false; });
  await g1.fill('#answer-input', 'よっつめ');
  await g1.click('#btn-answer');
  ok(await until(async () => (await text(g1, '#answer-msg')).includes('出るのを待っている')), 'F8 むりに出しても受けない');
  ok((await g1.inputValue('#answer-input')) === 'よっつめ', 'F9 出せなかった答えは入力欄に残る');
  await g1.fill('#answer-input', '');
  await host.click('#queue-list li:has-text("みっつめ") button');
  ok(await until(async () => (await mine(g1)).includes('みっつめ:ホストがかくした')), 'F10 かくした答えは本人にだけ「ホストがかくした」', await mine(g1));
  ok(!(await text(g2, '#ph-play')).includes('みっつめ'), 'F11 ほかの人には出ない');
  await host.click('#btn-hide-cur');
  ok(await until(async () => (await mine(g1)).includes('ひとつめ:ホストがかくした')), 'F12 いま出ている答えもかくせる');
  ok(await until(async () => (await stage(tv)) === 'ふたつめ'), 'F13 かくすと次の答えへ');
  ok(!(await text(tv, '#shown-list')).includes('ひとつめ'), 'F14 かくした答えは出た答えに入らない');
  ok(await until(async () => (await stage(tv)) === '', 8000), 'F15 時間で次へ');

  // ── G. 遊んでいる途中の切りかえ ──
  await setMode(g1, PRESS);
  ok(await until(async () => !(await visible(g1, '#answer-form'))), 'G1 押すだけにすると入力欄が消える');
  await setMode(g2, BOTH);
  ok(await until(() => visible(g2, '#answer-form')), 'G2 答える・押すにすると入力欄が出る');
  ok(!(await host.evaluate(() => ['stage', 'host-panel', 'shown-card'].map((id) => document.getElementById(id).textContent).join(''))).includes(PRESS), 'G3 ホストの画面に、ほかの人の参加のしかたは出ない');
  // 全員が押すだけ → 待つ案内だけ
  await setMode(g2, PRESS);
  await setMode(host, PRESS);
  ok(await until(async () => !(await visible(host, '#answer-form')) && !(await visible(g2, '#answer-form'))), 'G4 全員押すだけ');
  ok((await text(tv, '#stage-empty')).includes('答えが出るのを待っている') && await visible(tv, '#stage-empty'), 'G5 答えが出るのを待つ案内');
  await setMode(g1, BOTH);
  await setMode(g2, BOTH);
  await setMode(host, '進行だけ');
  ok(await until(async () => !(await visible(host, '#answer-form'))), 'G6 進行だけのホストは答えない');

  // ── H. 押せる人の数えなおし（ホストが進行だけ）──
  // 押せる人 = そら（あおいの答え）→ 1人で一本。あおいの答えに、ホストは押せない
  await answer(g1, 'しんこうだけ', host);
  ok(await until(async () => (await stage(host)) === 'しんこうだけ'), 'H1 答えが出る');
  ok(!(await visible(host, '#btn-press')), 'H2 進行だけのホストは押せない');
  ok(await visible(host, '#btn-hide-cur'), 'H3 進行だけでも「かくす」はある');
  await g2.click('#btn-press');
  ok(await until(() => ipponOn(tv)), 'H4 押せる人1人で一本');
  await until(async () => !(await ipponOn(tv)));

  // ── I. 締め切り・結果 ──
  await setMode(host, BOTH);
  await until(async () => (await modeOn(host)) === BOTH);
  await answer(g2, 'しめきりまえ1', host);
  await until(async () => (await stage(host)) === 'しめきりまえ1');
  await answer(g2, 'しめきりまえ2', host);
  await until(async () => (await g2.inputValue('#answer-input')) === '');
  await host.click('#btn-close');
  ok(await until(async () => !(await visible(g1, '#answer-form')) && await visible(g1, '#play-closed')), 'I1 締め切ると新しい答えは出せない');
  ok(await until(async () => (await stage(tv)) === 'しめきりまえ2', 8000), 'I2 順番待ちの答えは出る');
  await host.click('#btn-press');
  ok(await until(() => ipponOn(tv)), 'I3 締め切ったあとも一本になる');
  ok(await until(() => visible(g1, '#ph-result'), 8000), 'I4 出終わったら結果');
  ok((await text(g1, '#result-topic')) === topic1, 'I5 結果にお題');
  const rip = await g1.$$eval('#result-ippon .og-list__item', (els) => els.map((e) => e.textContent));
  ok(rip.length === 3 && rip.some((t) => t.includes('しめきりまえ2') && t.includes('<b>そら</b>さん')), 'I6 結果に一本（名前つき）', rip);
  const rot = await g1.$$eval('#result-others .og-list__item', (els) => els.map((e) => e.textContent));
  ok(rot.length === 5 && !rot.some((t) => t.includes('さん')), 'I7 ほかの答えは名前なし', rot);
  ok(await visible(host, '#result-host') && await visible(g1, '#result-wait') && !(await visible(tv, '#result-wait')), 'I8 ホストが進める');
  await shot(g1, 'i-result');

  // ── J. 全員の決め方・次のお題 ──
  await host.click('#btn-next');
  ok(await until(() => visible(host, '#ph-pick')), 'J1 次のお題を選ぶ');
  ok(!(await host.$$eval('#pick-cands .og-cand', (els) => els.map((e) => e.textContent))).includes(topic1), 'J2 出したお題は先に出さない');
  await host.click('#pick-cands .og-cand >> nth=1');
  ok(await until(() => visible(g1, '#ph-play')), 'J3 次のお題');
  ok(await until(async () => (await text(g1, '#shown-list')).includes('まだない')), 'J4 前のお題の答えは残らない');
  ok((await mine(g1)).length === 0 && !(await visible(g1, '#mine-card')), 'J5 自分の答えも空', await mine(g1));

  // ── K. 読み込み直し・途中の参加・切断 ──
  await g1.reload();
  ok(await until(() => visible(g1, '#ph-play')), 'K1 参加者が読み込み直すと続きから');
  ok(await until(async () => (await modeOn(g1)) === BOTH), 'K3 参加のしかたも続き');
  const g3 = await ctx.newPage(); watch(g3, 'g3');
  await g3.goto(BASE + '?room=' + code);
  await g3.fill('#og-name', 'みどり');
  await g3.click('#og-front-go');
  ok(await until(() => visible(g3, '#ph-play')), 'K4 途中から入れる');
  // 押せる人（あおいの答え）: ホスト・そら・みどり → 半分で2人
  await answer(g1, 'とちゅうさんか', host);
  ok(await until(async () => (await stage(g3)) === 'とちゅうさんか'), 'K5 途中の人にも答えが出る');
  await g3.click('#btn-press');
  await sleep(500);
  ok(!(await ipponOn(tv)), 'K6 押せる人3人では1人だけでは一本にならない');
  // みどりが抜けると押せる人は2人 → 必要は1人。みどりの押した分は数えないので、まだ一本ではない
  await g3.close({ runBeforeUnload: true });
  await sleep(500);
  ok(!(await ipponOn(tv)), 'K7 抜けた人の押した分は数えない');
  await g2.click('#btn-press');
  ok(await until(() => ipponOn(tv)), 'K8 抜けたあとの数で一本');
  await until(async () => !(await ipponOn(tv)));

  // ── L. 幅 375px ──
  await answer(g1, 'スマホのはばでも、はみ出さないか確かめるための、ちょっと長めの答え', host);
  await until(async () => (await stage(g2)) !== '');
  for (const [p, tag] of [[g2, 'g2'], [host, 'host']]) {
    await p.setViewportSize({ width: 375, height: 760 });
    await sleep(200);
    ok(await noHScroll(p), 'L1 375px で横にはみ出さない ' + tag);
    await shot(p, 'l-375-' + tag);
  }
  await answer(g1, 'まちあい1');
  ok(await until(() => visible(host, '#check-card')), 'L2a 375px で確認する答えが出る');
  ok(await noHScroll(host), 'L2 375px で確認する答えもはみ出さない');
  await shot(host, 'l-375-host-queue');
  await host.setViewportSize({ width: 1000, height: 900 });
  await g2.setViewportSize({ width: 1000, height: 900 });

  // ── M. おしまい・もう一回 ──
  await host.click('#btn-end');
  ok(await until(() => visible(g1, '#ph-end')), 'M1 おしまい');
  const hist = await g1.$$eval('#end-history .og-history__item', (els) => els.map((e) => e.textContent));
  ok(hist.length === 2 && hist[0].includes(topic1) && hist[0].includes('しめきりまえ2'), 'M2 お題ごとの一本', hist);
  ok(hist[1].includes('とちゅうさんか') && hist[1].includes('あおいさん'), 'M3 2つ目のお題の一本', hist);
  const counts = await g1.$$eval('#end-counts li', (els) => els.map((e) => e.textContent.replace(/^workspace_premium/, '')));
  ok(JSON.stringify(counts) === JSON.stringify(['あおい3本', '<b>そら</b>1本']), 'M4 人ごとの一本の数（参加した順・1本以上の人だけ）', counts);
  ok(!(await text(g1, '#end-counts')).includes('メンター') && !(await text(g1, '#end-counts')).includes('0本'), 'M4e 0本の人は並べない');
  ok(!(await text(g1, '#ph-end')).includes('位'), 'M4b 順位は出さない');
  ok((await g1.$$('#end-counts b')).length === 0, 'M4c 名前の HTML は文字のまま');
  ok((await tv.$$('#end-counts li')).length === 2, 'M4d みんなにみせる画面にも一本の数');
  ok(!(await visible(g1, '#mode-card')), 'M5 おしまいでは参加のしかたを出さない');
  ok(await visible(host, '#btn-restart') && !(await visible(g1, '#btn-restart')), 'M6 もう一回はホストだけ');
  await shot(tv, 'm-end-tv');
  await host.click('#btn-restart');
  ok(await until(() => visible(g1, '#ph-lobby')), 'M7 もう一回で待合室');
  // 全員の決め方
  await host.click('#ratio-opts .og-seg__btn:text-is("全員")');
  ok(await until(async () => (await text(g1, '#howto-ratio')).includes('全員')), 'M8 決め方があそびかたに出る');
  await host.click('#btn-start');
  await until(() => visible(host, '#ph-pick'));
  await host.click('#pick-cands .og-cand >> nth=0');
  await until(() => visible(g1, '#ph-play'));
  await answer(g1, 'ぜんいん', host);
  await until(async () => (await stage(host)) === 'ぜんいん');
  await host.click('#btn-press');
  await sleep(400);
  ok(!(await ipponOn(tv)), 'M9 全員のときは1人では一本にならない');
  await g2.click('#btn-press');
  ok(await until(() => ipponOn(tv)), 'M10 全員押したら一本');

  await host.click('#btn-end');

  // ── O. 一本が出たら区切る ──
  const join2 = async (p, c, name, mode) => {
    await p.goto(BASE + '?room=' + c);
    await p.fill('#og-name', name);
    if (mode) await p.check('input[name="front-mode"][value="' + mode + '"]');
    await p.click('#og-front-go');
    return until(() => visible(p, '#ph-lobby'));
  };
  const openHost = async (p, q) => {
    await p.goto(BASE + q);
    await p.fill('#og-name', 'ホスト');
    await p.click('#og-front-go');
    await until(() => visible(p, '#ph-lobby'));
    return (await text(p, '#og-bar-code')).replace(/^.*\s/, '');
  };
  const h2 = await ctx.newPage(); watch(h2, 'h2');
  const code2 = await openHost(h2, '?fast=1');
  const oa = await ctx.newPage(); watch(oa, 'oa');
  const ob = await ctx.newPage(); watch(ob, 'ob');
  ok(await join2(oa, code2, 'うみ') && await join2(ob, code2, 'やま'), 'O1 一本で区切るルームに入る');
  ok((await text(oa, '#howto-cut')).includes('一本が出たら'), 'O2 あそびかたに区切り');
  await until(async () => !(await h2.isDisabled('#btn-start')));
  await h2.click('#btn-start');
  await until(() => visible(h2, '#ph-pick'));
  await h2.click('#pick-cands .og-cand >> nth=0');
  ok(await until(() => visible(oa, '#ph-play')), 'O3 はじまる');
  ok(await visible(oa, '#play-rule') && (await text(oa, '#play-rule')).includes('一本が出たら') && !(await visible(oa, '#play-left')), 'O4 一本で区切ることが出る');
  await answer(oa, 'いちばん', h2);
  await until(async () => (await stage(ob)) === 'いちばん');
  await answer(oa, 'でなかった1', h2);
  await until(async () => (await oa.inputValue('#answer-input')) === '');
  await answer(ob, 'でなかった2', h2);
  await until(async () => (await ob.inputValue('#answer-input')) === '');
  ok(await until(async () => (await h2.$$('#queue-list li')).length === 2), 'O5 順番待ちが2つ');
  await ob.click('#btn-press');
  ok(await until(() => ipponOn(oa)), 'O6 一本');
  ok(await until(async () => !(await visible(ob, '#answer-form')) && (await text(ob, '#play-closed')).includes('一本が出た')), 'O7 一本が出たら答えを締め切る');
  ok(await until(() => visible(oa, '#ph-result'), 6000), 'O8 順番待ちの答えは出さずに結果へ');
  const o_ip = await oa.$$eval('#result-ippon .og-list__item', (els) => els.map((e) => e.textContent));
  const o_ot = await oa.$$eval('#result-others .og-list__item', (els) => els.map((e) => e.textContent));
  ok(o_ip.length === 1 && o_ip[0].includes('いちばん') && o_ip[0].includes('うみさん'), 'O9 結果に一本', o_ip);
  ok(o_ot.length === 2 && o_ot.some((t) => t.includes('でなかった1')) && o_ot.some((t) => t.includes('でなかった2')) && !o_ot.some((t) => t.includes('さん')), 'O10 出る前だった答えは名前なしで並ぶ', o_ot);
  await shot(oa, 'o-result');
  await h2.click('#btn-next');
  await until(() => visible(h2, '#ph-pick'));
  await h2.click('#pick-cands .og-cand >> nth=0');
  ok(await until(async () => await visible(ob, '#answer-form') && !(await visible(ob, '#play-closed'))), 'O11 次のお題ではまた答えられる');

  // ── P. 時間で区切る（テストでは1分を2秒にする）──
  const h3 = await ctx.newPage(); watch(h3, 'h3');
  const code3 = await openHost(h3, '?fast=1&min=2000');
  const pa = await ctx.newPage(); watch(pa, 'pa');
  ok(await join2(pa, code3, 'かわ'), 'P1 時間で区切るルームに入る');
  await h3.click('#cut-opts .og-seg__btn:text-is("時間で")');
  await h3.click('#time-opts .og-seg__btn:text-is("2分")');
  ok(await until(async () => (await text(pa, '#howto-cut')).includes('2分')), 'P2 2分');
  await until(async () => !(await h3.isDisabled('#btn-start')));
  await h3.click('#btn-start');
  await until(() => visible(h3, '#ph-pick'));
  await h3.click('#pick-cands .og-cand >> nth=0');
  ok(await until(() => visible(pa, '#ph-play')), 'P3 はじまる');
  await answer(pa, 'じかんぎれ', h3);
  ok(await until(async () => (await stage(h3)) === 'じかんぎれ'), 'P4 答えが出る');
  await answer(pa, 'まにあわず');
  ok(await until(async () => (await text(h3, '#check-list')).includes('まにあわず')), 'P4b 確認待ちの答え');
  ok(await until(async () => !(await visible(pa, '#answer-form')) && (await text(pa, '#play-closed')).includes('時間になった'), 5000), 'P5 時間になったら締め切る');
  ok(!(await visible(pa, '#play-left')), 'P6 締め切ったらのこり時間は消す');
  ok((await stage(h3)) === 'じかんぎれ', 'P7 出ている答えはそのまま押せる');
  await until(async () => (await stage(h3)) === '', 8000);
  await sleep(600);
  ok(await visible(pa, '#ph-play') && await visible(h3, '#check-card'), 'P8a 確認待ちの答えがあると結果へ進まない');
  await h3.click('#check-list li:has-text("まにあわず") .og-approve');
  ok(await until(async () => (await stage(pa)) === 'まにあわず'), 'P8b 締め切ったあとに確認した答えも出る');
  ok(await until(() => visible(pa, '#ph-result'), 9000), 'P8 出終わったら結果');
  ok((await text(pa, '#result-others')).includes('じかんぎれ'), 'P9 結果に出た答え');

  // ── R. 端末のない参加者（ホストが代わりに書く・押す）──
  const h4 = await ctx.newPage(); watch(h4, 'h4');
  const code4 = await openHost(h4, '?fast=1');
  const ra = await ctx.newPage(); watch(ra, 'ra');
  ok(await join2(ra, code4, 'りく'), 'R1 入る');
  ok(await visible(h4, '#proxy-admin') && !(await visible(ra, '#proxy-admin')), 'R2 端末のない参加者を足す欄はホストにだけ');
  const addProxy = async (name) => { await h4.fill('#proxy-name', name); await h4.click('#proxy-add button'); };
  await addProxy('そら');
  ok(await until(async () => (await text(ra, '#lobby-players')).includes('そら')), 'R3 足した子はみんなの参加者の一覧に出る');
  ok((await text(h4, '#lobby-players')).includes('端末なし') && !(await text(ra, '#lobby-players')).includes('端末なし'), 'R4 端末なしの印はホストの画面にだけ');
  await addProxy('そら');
  ok((await text(h4, '#proxy-add-msg')).includes('同じ名前'), 'R5 同じ名前は足せない');
  await addProxy('ほし');
  ok(await until(async () => (await h4.$$('#proxy-admin-list li')).length === 2), 'R6 2人足した');
  await h4.setViewportSize({ width: 375, height: 800 });
  await sleep(200);
  ok(await noHScroll(h4), 'R6b 待合室もスマホの幅で横にはみ出さない');
  await shot(h4, 'r-lobby-375');
  await h4.setViewportSize({ width: 1000, height: 900 });
  await h4.click('#proxy-admin-list li:has-text("ほし") .og-proxy-remove');
  ok(await until(async () => !(await text(ra, '#lobby-players')).includes('ほし')), 'R7 待合室では外せる');
  await setMode(h4, '進行だけ');
  ok(await until(async () => !(await h4.isDisabled('#btn-start')) && (await text(h4, '#lobby-start-note')).includes('2人')), 'R8 端末のない子も投票する人に数える（りく＋そら）');
  await h4.click('#btn-start');
  await until(() => visible(h4, '#ph-pick'));
  await h4.click('#pick-cands .og-cand >> nth=0');
  ok(await until(() => visible(h4, '#ph-play')), 'R9 はじまる');
  ok(await visible(h4, '#proxy-box') && !(await visible(ra, '#proxy-box')), 'R10 代わりに書く・押す欄はホストにだけ');
  ok(await until(async () => (await h4.$$('#proxy-press-list .og-proxy-press:disabled')).length === 1), 'R11 答えが出ていないうちは押せない');
  await h4.fill('#proxy-input', 'かわりのこたえ');
  await h4.click('#btn-proxy-answer');
  ok((await text(h4, '#proxy-msg')).includes('そらさん'), 'R12 代わりに出した', await text(h4, '#proxy-msg'));
  ok(await until(async () => (await stage(ra)) === 'かわりのこたえ'), 'R13 代わりに書いた答えは確認なしで出る');
  ok(await until(async () => (await text(h4, '#proxy-press-list')).includes('本人の答え')), 'R14 本人の答えには代わりに押せない');
  await ra.click('#btn-press');
  ok(await until(() => ipponOn(ra)) && (await text(ra, '#og-ippon-name')) === 'そらさん', 'R15 端末のない子の答えも一本になる');
  ok(await until(() => visible(h4, '#ph-result'), 6000), 'R16 結果');
  ok(await visible(h4, '#proxy-admin') && (await h4.$$('.og-proxy-remove')).length === 0, 'R17 結果の画面でも足せる（外すのは待合室だけ）');
  await addProxy('ほし');
  ok(await until(async () => (await h4.$$('#proxy-admin-list li')).length === 2), 'R18 お題の間に足した');
  await h4.click('#btn-next');
  await until(() => visible(h4, '#ph-pick'));
  await h4.click('#pick-cands .og-cand >> nth=0');
  await until(() => visible(h4, '#ph-play'));
  ok((await h4.$$eval('#proxy-who option', (els) => els.map((e) => e.textContent))).join('/') === 'そらさん/ほしさん', 'R19 だれの答えか選べる');
  ok((await text(h4, '#proxy-msg')) === '', 'R19b 前のお題の知らせは消える');
  await answer(ra, 'ほんにんのこたえ', h4);
  ok(await until(async () => (await stage(h4)) === 'ほんにんのこたえ'), 'R20 答えが出る');
  ok(await until(async () => (await h4.$$('#proxy-press-list .og-proxy-press:not(:disabled)')).length === 2), 'R21 端末のない2人のぶんを押せる');
  await h4.setViewportSize({ width: 375, height: 800 });
  await sleep(200);
  ok(await noHScroll(h4), 'R22 スマホの幅で横にはみ出さない');
  await shot(h4, 'r-proxy-375');
  await h4.setViewportSize({ width: 1000, height: 900 });
  await h4.click('#proxy-press-list li:has-text("ほし") .og-proxy-press');
  ok(await until(() => ipponOn(ra)), 'R23 代わりに押した票で一本（そら・ほしの半分）');
  await until(() => visible(h4, '#ph-result'), 6000);
  await h4.click('#btn-finish');
  ok(await until(() => visible(ra, '#ph-end')), 'R24 おしまい');
  const r_counts = await ra.$$eval('#end-counts .og-counts__item', (els) => els.map((e) => e.textContent));
  ok(r_counts.length === 2 && r_counts[0].includes('りく') && r_counts[1].includes('そら'), 'R25 一本の数に端末のない子も入る', r_counts);
  for (const p of [h2, oa, ob, h3, pa, h4, ra]) await p.close();

  // ── N. ホストが閉じる ──
  ok(errors.length === 0, 'N1 コンソールのエラーなし', errors);
  await host.close({ runBeforeUnload: true });
  ok(await until(() => visible(g1, '#og-closed')), 'N2 ホストが閉じたら案内');

  console.log(`\n${pass} passed, ${fail} failed  (写真: ${OUT})`);
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
