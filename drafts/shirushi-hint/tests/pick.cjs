// アイコンとお題えらび（tools/pick.html）を動かして確かめる。通信はしない（配信用のサーバーを 127.0.0.1 に立てるだけ）。
// 実行: PLAYWRIGHT=<playwright のフォルダ> node drafts/shirushi-hint/tests/pick.cjs
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'shirushi-pick-'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; } else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(p, (err, buf) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || MIME['.html'], 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const ORIGIN = 'http://127.0.0.1:' + server.address().port;
  const URL = ORIGIN + '/drafts/shirushi-hint/tools/pick.html';
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
  const errors = [];
  const p = await ctx.newPage();
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon/.test((m.location() || {}).url || '')) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('dialog', (d) => d.accept());
  const copied = async () => { await p.click('#pk-copy'); await sleep(200); const t = await p.evaluate(() => navigator.clipboard.readText()); return JSON.parse(t.split('\n')[1]); };

  await p.goto(URL);
  await p.evaluate(() => document.fonts.ready);
  await sleep(500);
  const wide = await p.$$eval('.pk-glyph', (els) => els.filter((e) => e.getBoundingClientRect().width > 50).map((e) => e.textContent));
  ok(wide.length === 0, '1 アイコンがすべて記号で出る（追加の候補もふくむ）', wide);
  ok((await p.$$('.pk-icard')).length === 68 && (await p.$$('.pk-icard.is-on')).length === 68, '2 アイコンは68個（追加の候補も data.js に入れた）');
  ok((await p.textContent('#pk-sum')) === 'アイコン 68個・お題 89個', '3 はじめは data.js の中身が選んである', await p.textContent('#pk-sum'));
  ok((await p.$$('.pk-trow')).length === 89, '4 お題は89個');
  ok(!(await p.textContent('#pk-topics')).includes('6個より少ない'), '5 どのなかまも6個以上');
  let r = await copied();
  ok(r.kinds.thing.length === 17 && r.icons.nakama.length === 20 && r.checked2.length === 0, '6 コピーした結果', r.kinds.thing);
  // 選ぶ・書きかえる
  await p.uncheck('#ic-clothes');
  await p.uncheck('#ic-toy');
  await p.fill('.pk-icard:has(#ic-sky) .pk-icard__name', '天気');
  await p.press('.pk-icard:has(#ic-sky) .pk-icard__name', 'Tab');
  await p.uncheck('.pk-trow[data-w="時計"] > input[type="checkbox"]');
  await p.check('.pk-trow[data-w="ハチ"] .pk-two input');
  await p.selectOption('.pk-trow[data-w="風船"] .pk-kind', 'nature');
  r = await copied();
  ok(!r.icons.nakama.some((ic) => ic.id === 'clothes') && !r.icons.nakama.some((ic) => ic.id === 'toy') && r.icons.nakama.length === 18, '7 アイコンを外す');
  ok(r.icons.nakama.find((ic) => ic.id === 'sky').label === '天気', '8 名前を書きかえる');
  ok(!r.kinds.thing.includes('時計') && r.kinds.thing.length === 15, '9 お題を外す・なかまを移す', r.kinds.thing);
  ok(r.kinds.nature.includes('風船'), '10 なかまを移す');
  ok(JSON.stringify(r.checked2) === '["ハチ"]', '11 2通りの印');
  // お題を足す
  await p.fill('#pk-add-word', 'ハチ');
  await p.click('#pk-add button[type="submit"]');
  ok((await p.textContent('#pk-add-msg')).includes('もう一覧にある'), '12 同じお題は足せない');
  await p.fill('#pk-add-word', '<b>こま</b>');
  await p.selectOption('#pk-add-kind', 'thing');
  await p.click('#pk-add button[type="submit"]');
  r = await copied();
  ok(r.kinds.thing.includes('<b>こま</b>') && (await p.$$('#pk-topics b')).length === 0, '13 足したお題（HTML は文字のまま）');
  await p.fill('.pk-trow[data-w="めがね"] .pk-trow__word', 'ハチ');
  await p.press('.pk-trow[data-w="めがね"] .pk-trow__word', 'Tab');
  await sleep(100);
  ok((await p.textContent('#pk-topics')).includes('同じお題がほかにもある'), '14 同じお題の注意');
  // ブラウザに残る
  await p.reload();
  r = await copied();
  ok(r.kinds.thing.includes('<b>こま</b>') && r.icons.nakama.find((ic) => ic.id === 'sky').label === '天気', '15 読み込み直しても残る');
  await p.click('.pk-trow[data-w="<b>こま</b>"] button');
  r = await copied();
  ok(!r.kinds.thing.includes('<b>こま</b>'), '16 足したお題は消せる');
  await p.click('#pk-reset');
  ok((await p.textContent('#pk-sum')) === 'アイコン 68個・お題 89個', '17 はじめにもどす');
  await p.setViewportSize({ width: 375, height: 800 });
  await sleep(150);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '18 幅 375px で横にはみ出さない');
  await p.screenshot({ path: path.join(OUT, 'pick-375.png'), fullPage: false });
  await p.setViewportSize({ width: 1100, height: 900 });
  await p.screenshot({ path: path.join(OUT, 'pick.png'), fullPage: false });
  ok(errors.length === 0, 'Z コンソールのエラーなし', errors);
  console.log('\n' + pass + ' passed, ' + fail + ' failed   (写真: ' + OUT + ')');
  await browser.close();
  server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
