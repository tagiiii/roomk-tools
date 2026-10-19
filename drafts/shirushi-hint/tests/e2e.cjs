// しるしでヒント（試作）を、同じブラウザのウィンドウ（ホスト・参加2人・みんなにみせる画面）で動かして確かめる。
// 通信はしない（配信用のサーバーを 127.0.0.1 に立てるだけ）。画面の写真は一時フォルダに出す。
// 実行: PLAYWRIGHT=<playwright のフォルダ> node drafts/shirushi-hint/tests/e2e.cjs
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'shirushi-hint-e2e-'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const DATA = (() => { const w = {}; new Function('window', fs.readFileSync(path.join(__dirname, '../data.js'), 'utf8'))(w); return w.SHIRUSHI_DATA; })();
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
  const BASE = 'http://127.0.0.1:' + server.address().port + '/drafts/shirushi-hint/';
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
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
  const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(50); } return false; };
  const noHScroll = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  const signs = (p, sel = '#hint-signs') => p.$$eval(sel + ' .sh-sign:not(.is-preview) .sh-sign__label', (els) => els.map((e) => e.textContent));
  const tiles = (p) => p.$$eval('#hint-board .sh-tile', (els) => els.map((e) => ({ t: e.querySelector('.sh-tile__text').textContent, btn: e.tagName === 'BUTTON', crossed: e.classList.contains('is-crossed'), answer: e.classList.contains('is-answer'), mine: e.classList.contains('is-mine') })));
  const tapTile = (p, t) => p.click('#hint-board button.sh-tile:has(.sh-tile__text:text-is("' + t + '"))');
  const sendSign = async (p, label) => { await p.locator('#palette .sh-pbtn', { hasText: label }).first().click(); await p.click('#btn-send'); };
  const popText = (p) => p.$eval('#sh-pop', (e) => (e.classList.contains('is-on') ? e.textContent : ''));
  const orderPts = (p) => p.$$eval('#order-list li', (els) => els.map((e) => e.querySelector('.sh-order__name').textContent + ':' + e.querySelector('.sh-order__pts').textContent));
  const idOf = (p) => p.evaluate(() => JSON.parse(sessionStorage.getItem('shirushi-hint-id')));
  const post = (p, msg) => p.evaluate((m) => { new BroadcastChannel('roomk-shirushi-hint-draft').postMessage(m); }, msg);

  // ── A. ルームを作る・入る ──
  const host = await ctx.newPage(); watch(host, 'host');
  await host.goto(BASE);
  ok(await visible(host, '#sh-front'), 'A1 はじめの画面');
  await host.click('#sh-front-go');
  ok((await text(host, '#sh-front-msg')).includes('ニックネーム'), 'A2 名前なしは止める');
  await host.fill('#sh-name', 'メンター');
  await host.click('#sh-front-go');
  ok(await until(() => visible(host, '#ph-lobby')), 'A3 待合室');
  const code = (await text(host, '#sh-bar-code')).replace(/^.*\s/, '');
  ok(/^[A-HJ-NP-Z2-9]{6}$/.test(code), 'A4 ルームコード', code);
  ok((await host.$$('#pts-table tr')).length === 4 && (await text(host, '#pts-table')).includes('はずれ−1点'), 'A5 あそびかたに点数の表（はずれ −1点）', await text(host, '#pts-table'));
  ok(await host.isDisabled('#btn-start'), 'A6 1人では始められない');
  await host.click('#btn-copy');
  ok(await until(async () => (await text(host, '#btn-copy')).includes('コピーした')), 'A7 リンクをコピー');
  ok((await host.evaluate(() => navigator.clipboard.readText())).endsWith('?room=' + code), 'A8 コピーしたリンク');

  const nope = await ctx.newPage(); watch(nope, 'nope');
  await nope.goto(BASE + '?room=ZZZZZZ');
  await nope.fill('#sh-name', 'だれか');
  await nope.click('#sh-front-go');
  ok(await until(async () => (await text(nope, '#sh-front-msg')).includes('見つからない')), 'A9 ないルームには入れない');
  await nope.close();

  const g1 = await ctx.newPage(); watch(g1, 'g1');
  await g1.goto(BASE + '?room=' + code);
  ok((await text(g1, '#sh-front-go')) === '入る', 'A10 リンクからは「入る」');
  await g1.fill('#sh-name', 'あおい');
  await g1.click('#sh-front-go');
  ok(await until(() => visible(g1, '#ph-lobby')), 'A11 参加1 待合室');
  ok(await visible(g1, '#lobby-wait') && !(await visible(g1, '#lobby-host')), 'A12 参加者は待つ');
  const g2 = await ctx.newPage(); watch(g2, 'g2');
  await g2.goto(BASE + '?room=' + code);
  await g2.fill('#sh-name', '<b>そら</b>');
  await g2.click('#sh-front-go');
  ok(await until(() => visible(g2, '#ph-lobby')), 'A13 参加2 待合室');
  ok(await until(async () => (await host.$$('#lobby-players li')).length === 3), 'A14 ホストに3人');
  ok((await body(host)).includes('<b>そら</b>') && (await host.$$('#lobby-players b')).length === 0, 'A15 名前の HTML は文字のまま');

  // ── B. みんなにみせる画面 ──
  const tv = await ctx.newPage(); watch(tv, 'tv');
  await tv.goto(BASE + '?watch=' + code);
  ok(await until(() => visible(tv, '#ph-lobby')), 'B1 みんなにみせる画面');
  ok(!(await visible(tv, '#lobby-host')) && !(await visible(tv, '#lobby-wait')), 'B2 見るだけ');
  await sleep(300);
  ok((await host.$$('#lobby-players li')).length === 3, 'B3 参加者に数えない');

  // ── C. はじめる・お題を選ぶ ──
  await host.uncheck('#chk-host-plays');
  ok(await until(async () => (await text(host, '#lobby-start-note')).includes('遊ぶ人 2人')), 'C1 ホストが進行だけなら2人');
  await host.check('#chk-host-plays');
  ok(await until(async () => (await text(host, '#lobby-start-note')).includes('遊ぶ人 3人')), 'C2 ホストも遊ぶと3人');
  await host.click('#btn-start');
  ok(await until(() => visible(host, '#pick-teller')), 'C3 最初はホストが伝える人');
  ok(await until(async () => (await text(g1, '#pick-other-text')).includes('メンターさん')), 'C4 参加者は待つ');
  ok(await until(() => visible(tv, '#pick-other')), 'C5 みんなにみせる画面も待つ');
  ok(JSON.stringify(await orderPts(host)) === JSON.stringify(['メンター:0点', 'あおい:0点', '<b>そら</b>:0点']), 'C6 順番と点', await orderPts(host));
  let cands = await host.$$eval('#pick-cands .sh-cand', (els) => els.map((e) => e.textContent));
  ok(cands.length === 3 && !(await body(g1)).includes(cands[0]), 'C7 候補3つは伝える人だけ');
  await host.click('#btn-reroll');
  ok(await until(async () => { const n = await host.$$eval('#pick-cands .sh-cand', (els) => els.map((e) => e.textContent)); return n.every((c) => !cands.includes(c)); }), 'C8 ほかの候補は前と重ならない');
  cands = await host.$$eval('#pick-cands .sh-cand', (els) => els.map((e) => e.textContent));
  const topic1 = cands[0];
  await host.click('#pick-cands .sh-cand >> nth=0');
  ok(await until(() => visible(g1, '#ph-hint')), 'C9 しるしの画面へ');

  // ── D. しるしと答え合わせ ──
  const tH = await tiles(host);
  let t1 = await tiles(g1);
  ok(tH.length === 12 && t1.length === 12, 'D1 候補は12個', tH.length);
  ok(tH.map((x) => x.t).join() === t1.map((x) => x.t).join(), 'D2 全員同じ並び');
  ok(tH.filter((x) => x.answer).length === 1 && tH.find((x) => x.answer).t === topic1, 'D3 伝える人にはお題の印');
  ok(t1.every((x) => !x.answer) && !(await visible(g1, '#hint-topic')), 'D4 当てる人にお題の印は出ない');
  ok((await tiles(tv)).every((x) => !x.answer && !x.btn), 'D5 みんなにみせる画面は印なし・押せない');
  ok(t1.every((x) => !x.btn), 'D6 しるしが出る前は選べない');
  ok((await text(g1, '#hint-guide')).includes('1つ目のしるしを選んでいる'), 'D7 待つ案内');
  ok(await host.isDisabled('#btn-send'), 'D8 選ぶまで出せない');
  await host.locator('#palette .sh-pbtn', { hasText: '虫' }).first().click();
  ok((await host.$$('#hint-signs .sh-sign.is-preview')).length === 1, 'D9 伝える人には出す前の見本');
  ok((await signs(g1)).length === 0 && (await g1.$$('#hint-signs .is-preview')).length === 0, 'D10 出す前は参加者に見えない');
  await host.locator('#palette .sh-pbtn', { hasText: '動物' }).first().click();
  ok((await text(host, '#send-preview')).includes('動物'), 'D11 選びなおせる');
  await host.click('#btn-send');
  ok(await until(async () => (await signs(g1)).join() === '動物'), 'D12 しるし①が全員に出る');
  ok((await signs(tv)).join() === '動物', 'D13 みんなにみせる画面にも');
  ok(await host.locator('#palette .sh-pbtn', { hasText: '動物' }).first().isDisabled(), 'D14 出したしるしはもう出せない');
  t1 = await tiles(g1);
  ok(t1.every((x) => x.btn), 'D15 しるしが出たら選べる');
  const wrongs = tH.filter((x) => !x.answer).map((x) => x.t);
  // g1 はずれ、g2 は選ばない → 答え合わせ
  await tapTile(g1, wrongs[0]);
  ok(await until(async () => (await tiles(g1)).find((x) => x.t === wrongs[0]).mine), 'D16 選んだ候補に印');
  ok((await tiles(g1)).every((x) => !x.btn), 'D17 1つのしるしで1回だけ');
  ok(await until(async () => (await host.$$eval('#hint-picked .is-picked', (els) => els.map((e) => e.textContent))).some((t) => t.includes('あおい'))), 'D18 選んだことがほかの人に分かる');
  ok(!(await tiles(g2)).some((x) => x.mine), 'D19 何を選んだかはほかの人に出ない');
  ok(!(await tiles(host)).some((x) => x.crossed), 'D20 全員がそろうまで答え合わせしない');
  await g2.click('#btn-skip-guess');
  ok(await until(async () => (await tiles(tv)).find((x) => x.t === wrongs[0]).crossed), 'D21 はずれた候補が全員の画面で消える');
  ok(await until(async () => (await popText(tv)).includes('まだだれも当たらなかった')), 'D22 しるしごとの結果が出る');
  ok((await tiles(g1)).every((x) => !x.btn), 'D23 次のしるしまで選べない');
  ok((await text(g1, '#hint-guide')).includes('次のしるしを待っている'), 'D24 待つ案内');
  ok((await text(g1, '#hint-guide')).includes('はずれ（−1点）') && !(await text(g2, '#hint-guide')).includes('はずれ'), 'D24b はずれた人にだけ −1点の案内');
  ok(await until(async () => JSON.stringify(await orderPts(host)) === JSON.stringify(['メンター:0点', 'あおい:−1点', '<b>そら</b>:0点'])), 'D24c はずれは −1点・選ばなければ減らない', await orderPts(host));
  // ②: g1 当たり、g2 はずれ
  await sendSign(host, '黄色');
  ok(await until(async () => (await signs(g2)).join() === '動物,黄色'), 'D25 しるし②');
  await tapTile(g1, topic1);
  await tapTile(g2, wrongs[1]);
  ok(await until(async () => (await popText(g2)).includes('あおいさんが当てた')), 'D26 当てた人が全員に出る');
  ok(await until(async () => JSON.stringify(await orderPts(host)) === JSON.stringify(['メンター:2点', 'あおい:1点', '<b>そら</b>:−1点'])), 'D27 ②で当てた人と伝えた人に2点・はずれは −1点', await orderPts(host));
  ok((await tiles(g1)).find((x) => x.t === topic1).answer && (await text(g1, '#hint-guide')).includes('②つ目で当てた'), 'D28 当てた人には当たりの印');
  ok(!(await tiles(g2)).some((x) => x.answer) && !(await tiles(g2)).find((x) => x.t === topic1).crossed, 'D29 まだの人には答えが出ない');
  ok((await tiles(g2)).find((x) => x.t === wrongs[1]).crossed, 'D30 はずれが増える');
  // ③は g2 が選ぶ前に ④ を出す → ③はだれも選ばずに締まる
  await sendSign(host, '黒');
  ok(await until(async () => (await signs(g2)).length === 3), 'D31 しるし③');
  ok(!(await g1.$$('#hint-board button.sh-tile')).length, 'D32 当てた人はもう選べない');
  // 古い問の操作は受けない
  const g2id = await idOf(g2);
  const boardIdx = (await tiles(host)).findIndex((x) => x.t === wrongs[2]);
  await post(g1, { type: 'guess', code, from: g2id, q: 'old', step: 3, b: boardIdx });
  await sleep(200);
  ok((await host.$$eval('#hint-picked .is-picked', (els) => els.length)) === 0, 'D33 古い問の操作は受けない');
  await sendSign(host, '飛ぶ');
  ok(await until(async () => (await signs(g2)).length === 4), 'D34 しるし④（③は待たずに締まる）');
  ok(await until(async () => (await popText(g2)).includes('まだだれも当たらなかった')), 'D35 ③の結果');
  await tapTile(g2, topic1);
  ok(await until(() => visible(g1, '#ph-reveal')), 'D36 全員当てたら答えへ');
  ok((await text(tv, '#reveal-topic')) === topic1, 'D37 答え');
  ok(await until(async () => !(await popText(tv))), 'D37b 答えの画面には結果を重ねない');
  const pts = await tv.$$eval('#reveal-points li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  ok(pts.length === 3 && pts[0].includes('伝えた') && pts[0].includes('+2点') && pts[1].includes('②つ目で当てた・はずれ1回') && pts[1].includes('+1点') && pts[2].includes('④つ目で当てた・はずれ1回') && / 0点$/.test(pts[2].trim()), 'D38 この問の点（はずれの分を引く）', pts);
  ok(await until(async () => JSON.stringify(await orderPts(host)) === JSON.stringify(['メンター:2点', 'あおい:1点', '<b>そら</b>:0点'])), 'D39 伝えた人の点は1回だけ', await orderPts(host));
  ok((await signs(tv, '#reveal-signs')).join() === '動物,黄色,黒,飛ぶ', 'D40 出したしるしが並ぶ');
  ok(await visible(host, '#btn-next') && await visible(g1, '#reveal-wait'), 'D41 次の人へはホスト');
  await shot(tv, 'd-tv-reveal');

  // ── E. 次の人・パス・読み込み直し・答えを見せる ──
  await host.click('#btn-next');
  ok(await until(() => visible(g1, '#pick-teller')), 'E1 次は参加1');
  ok(!(await popText(g2)), 'E1b 前の問の結果は次の問に残らない');
  await g1.click('#btn-pass');
  ok(await until(() => visible(g2, '#pick-teller')), 'E2 パスすると次の人');
  await g2.click('#pick-cands .sh-cand >> nth=1');
  ok(await until(() => visible(host, '#ph-hint')), 'E3 参加2がお題を選ぶ');
  const topic3 = await text(g2, '#hint-topic-text');
  ok(!(await host.$$('#hint-board .is-answer')).length && !(await visible(host, '#hint-topic')), 'E4 ホストにも参加者のお題は出ない');
  await sendSign(g2, '白');
  ok(await until(async () => (await signs(host)).join() === '白'), 'E5 参加者のしるしが届く');
  await g2.reload();
  ok(await until(() => visible(g2, '#ph-hint'), 4000), 'E6 読み込み直すと戻る');
  ok((await text(g2, '#hint-topic-text')) === topic3 && await visible(g2, '#hint-tools'), 'E7 伝える人のまま');
  ok((await signs(g2)).join() === '白', 'E8 出したしるしは残る');
  await shot(g2, 'e-teller');
  await tapTile(host, topic3);
  await until(async () => (await host.$$eval('#hint-picked .is-picked', (els) => els.length)) === 1);
  await shot(g1, 'e-guesser');
  await sendSign(g2, '丸い'); // g1 が選ぶ前に②を出すと、①はホストだけで締まる
  ok(await until(async () => (await popText(g1)).includes('メンターさんが当てた')), 'E9 ①で当てた');
  ok(await until(async () => (await orderPts(g1)).join() === 'メンター:5点,あおい:1点,<b>そら</b>:3点'), 'E10 ①は3点（当てた人と伝えた人）', await orderPts(g1));
  await g2.click('#btn-show');
  ok(await until(() => visible(host, '#ph-reveal')), 'E11 答えを見せる');
  const pts2 = await host.$$eval('#reveal-points li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ')));
  ok(pts2.some((t) => t.includes('あおい') && t.includes('今回は当たらなかった') && / 0点$/.test(t.trim())), 'E12 当たらなかった人', pts2);
  ok(await visible(host, '#btn-lap') && !(await visible(host, '#btn-next')), 'E13 一巡したら「順位を見る」');
  await host.click('#btn-lap');
  ok(await until(() => visible(g1, '#ph-lap')), 'E14 一巡の順位');
  const rank = await g1.$$eval('#lap-rank li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  ok(rank.length === 3 && rank[0].includes('1位') && rank[0].includes('メンター') && rank[1].includes('2位') && rank[1].includes('そら') && rank[2].includes('3位') && rank[2].includes('あおい'), 'E15 点の高い順に順位', rank);
  ok(await visible(host, '#lap-host') && await visible(g1, '#lap-wait'), 'E16 もう一巡はホスト');
  ok(!(await popText(g1)) && !(await popText(host)), 'E17 順位の画面に結果は出ない（答えを見せて締めたとき）');
  await shot(g1, 'e-lap-rank');

  // ── F. もう一巡・交代・切断 ──
  await host.click('#btn-lap2');
  ok(await until(() => visible(host, '#pick-teller')), 'F1 もう一巡はホストから');
  ok((await orderPts(host)).join() === 'メンター:5点,あおい:1点,<b>そら</b>:3点', 'F2 点は続く');
  await host.click('#btn-skip');
  ok(await until(() => visible(g1, '#pick-teller')), 'F3 ホストの交代');
  await g1.click('#pick-cands .sh-cand >> nth=0');
  await until(() => visible(g1, '#ph-hint'));
  await sendSign(g1, '乗り物');
  await until(async () => (await signs(host)).length === 1);
  await g2.close({ runBeforeUnload: true });
  ok(await until(async () => (await host.$$eval('#hint-picked li', (els) => els.length)) === 1), 'F4 切れた人は当てる人から外れる');
  const wrong5 = (await tiles(g1)).find((x) => !x.answer).t;
  await tapTile(host, wrong5);
  ok(await until(async () => (await tiles(host)).find((x) => x.t === wrong5).crossed), 'F5 切れた人を待たずに答え合わせ');
  await g1.close({ runBeforeUnload: true });
  ok(await until(() => visible(host, '#hint-away')), 'F6 伝える人が切れたら案内');
  ok((await text(host, '#hint-away')).includes('この問を終えて次の人へ'), 'F7 ホストに交代の案内');
  await host.click('#btn-skip');
  ok(await until(() => visible(host, '#ph-lap')), 'F8 切れた人の番はとばして一巡');
  await host.click('#btn-finish2');
  ok(await until(() => visible(host, '#ph-end')), 'F9 おしまい');
  ok((await host.$$('#end-rank li')).length === 3 && (await text(host, '#end-rank li:first-child')).includes('1位'), 'F10 おしまいの順位');
  ok(await until(() => visible(tv, '#ph-end')) && !(await visible(tv, '#btn-restart')), 'F11 みんなにみせる画面にも順位');
  await host.click('#btn-restart');
  ok(await until(() => visible(host, '#ph-lobby')), 'F12 もう一回あそぶ');

  // ── G. ホストが進行だけ ──
  const h2 = await ctx.newPage(); watch(h2, 'h2');
  await h2.goto(BASE);
  await h2.fill('#sh-name', 'すすめる人');
  await h2.click('#sh-front-go');
  await until(() => visible(h2, '#ph-lobby'));
  const code2 = (await text(h2, '#sh-bar-code')).replace(/^.*\s/, '');
  await h2.uncheck('#chk-host-plays');
  const pa = await ctx.newPage(); watch(pa, 'pa');
  await pa.goto(BASE + '?room=' + code2); await pa.fill('#sh-name', 'はる'); await pa.click('#sh-front-go');
  await until(() => visible(pa, '#ph-lobby'));
  ok(await until(() => h2.isDisabled('#btn-start')), 'G1 遊ぶ人1人では始められない');
  const pb = await ctx.newPage(); watch(pb, 'pb');
  await pb.goto(BASE + '?room=' + code2); await pb.fill('#sh-name', 'なつ'); await pb.click('#sh-front-go');
  ok(await until(async () => !(await h2.isDisabled('#btn-start'))), 'G2 2人で始められる');
  await h2.click('#btn-start');
  ok(await until(() => visible(pa, '#pick-teller')), 'G3 進行だけのホストは伝える人にならない');
  await pa.click('#pick-cands .sh-cand >> nth=0');
  await until(() => visible(pa, '#ph-hint'));
  await sendSign(pa, '魚');
  ok(await until(async () => (await tiles(pb)).every((x) => x.btn)), 'G4 遊ぶ人は選べる');
  ok((await tiles(h2)).every((x) => !x.btn) && !(await visible(h2, '#btn-skip-guess')), 'G5 進行だけのホストは選べない');
  ok((await h2.$$eval('#hint-picked li', (els) => els.length)) === 1, 'G6 当てる人に進行だけのホストは入らない');
  ok((await h2.$$eval('#order-list li', (els) => els.length)) === 2, 'G7 順番にも入らない');
  const wrongG = (await tiles(pa)).find((x) => !x.answer).t;
  await tapTile(pb, wrongG);
  ok(await until(async () => (await orderPts(h2)).join() === 'はる:0点,なつ:−1点'), 'G8 持ち点はマイナスになる', await orderPts(h2));
  ok((await h2.$eval('#order-list li:nth-child(2) .sh-order__pts', (e) => e.classList.contains('is-minus'))), 'G9 マイナスは色でも分かる');
  await sendSign(pa, '水');
  await tapTile(pb, (await tiles(pa)).find((x) => !x.answer && !x.crossed).t);
  ok(await until(async () => (await orderPts(h2)).join() === 'はる:0点,なつ:−2点'), 'G10 はずれるたびに減る');
  await pa.click('#btn-show');
  ok(await until(() => visible(h2, '#ph-reveal')), 'G11 答え');
  ok((await h2.$eval('#reveal-points li:nth-child(2)', (e) => e.innerText.replace(/\s+/g, ' '))).includes('今回は当たらなかった・はずれ2回 −2点'), 'G12 答えの画面にはずれの分', await h2.$eval('#reveal-points li:nth-child(2)', (e) => e.innerText));
  await h2.click('#btn-next');
  await until(() => visible(pb, '#pick-teller'));
  await h2.click('#btn-skip');
  await until(() => visible(h2, '#ph-lap'));
  ok(await until(async () => (await h2.$$eval('#lap-rank li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()))).join('|').includes('2位 なつ −2点')), 'G13 順位にもマイナス');
  await h2.click('#btn-lap2');
  await until(() => visible(pa, '#pick-teller'));
  await pa.click('#pick-cands .sh-cand >> nth=0');
  await until(() => visible(pa, '#ph-hint'));
  await sendSign(pa, '魚');
  await until(async () => (await tiles(pb)).every((x) => x.btn));

  // ── H. アイコン・スマホの幅 ──
  await pa.evaluate(() => document.fonts.ready);
  await sleep(400);
  const wide = await pa.$$eval('#palette .sh-sign__icon', (els) => els.filter((e) => e.getBoundingClientRect().width > 40).map((e) => e.textContent));
  ok(wide.length === 0, 'H1 アイコンがすべて記号で出る', wide);
  ok((await pa.$$('#palette .sh-pbtn')).length === DATA.groups.reduce((n, g) => n + g.icons.length, 0), 'H2 アイコンの数');
  for (const [p, n] of [[pa, '伝える人'], [pb, '当てる人'], [h2, 'ホスト']]) {
    await p.setViewportSize({ width: 375, height: 800 });
    await sleep(150);
    ok(await noHScroll(p), 'H3 幅 375px で横にはみ出さない（' + n + '）');
  }
  await shot(pa, 'h-teller-375');
  await shot(pb, 'h-guesser-375');

  ok(errors.length === 0, 'Z コンソールのエラーなし', errors);
  console.log('\n' + pass + ' passed, ' + fail + ' failed   (写真: ' + OUT + ')');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
