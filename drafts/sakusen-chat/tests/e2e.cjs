// 作戦会議チャット（試作）を、同じブラウザの2つのウィンドウ（メンター・子ども）で動かして確かめる。
// 通信はしない（配信用のサーバーを 127.0.0.1 に立てるだけ）。画面の写真と作業ファイルは一時フォルダに出す。
// 実行: PLAYWRIGHT=<playwright のフォルダ> node drafts/sakusen-chat/tests/e2e.cjs
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const ROOT = path.resolve(__dirname, '../../..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'sakusen-chat-e2e-'));
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
  const BASE = 'http://127.0.0.1:' + server.address().port + '/drafts/sakusen-chat/';
  const browser = await chromium.launch({ channel: 'chrome' });
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const errors = [];
  const watch = (page, tag) => {
    page.on('console', (m) => { if (m.type() !== 'error') return; const u = (m.location() || {}).url || ''; if (/\/favicon\.ico$/.test(u)) return; errors.push(tag + ': ' + m.text() + ' @ ' + u); });
    page.on('pageerror', (e) => errors.push(tag + ': ' + e.message));
    page.on('response', (r) => { if (r.status() >= 400) console.log('  HTTP', r.status(), r.url()); });
  };
  const title = (p) => p.title();
  const topicBadges = (p) => p.$$eval('.sc-topic', (els) => els.map((e) => (e.querySelector('.sc-count') || {}).textContent || ''));
  const msgTexts = (p) => p.$$eval('.sc-msg', (els) => els.map((e) => (e.classList.contains('sc-msg--me') ? 'me:' : 'peer:') + ((e.querySelector('.sc-msg__text') || {}).textContent || '') + (e.querySelector('img') ? '[img]' : '')));
  const sendText = async (p, text) => { await p.fill('#sc-text', text); await p.click('#sc-send'); };
  const openTopic = (p, i) => p.click(`.sc-topic >> nth=${i}`);

  const T0 = Date.now();
  // ── 1. はじめの画面
  const M = await ctx.newPage(); watch(M, 'mentor');
  await M.goto(BASE);
  ok(await M.isVisible('#sc-top'), 'top shown');
  ok(!(await M.isVisible('#sc-app')), 'app hidden at top');
  await M.click('#sc-open');
  ok(await M.isVisible('#sc-app'), 'mentor app shown');
  ok((await M.$$eval('.sc-topic__title', (e) => e.map((x) => x.textContent))).join() === 'チェックイン,ジブンチェック', 'first topics');
  ok((await M.textContent('#sc-peer')) === '相手を待っているよ', 'peer waiting');
  ok(await M.isVisible('#sc-copy') && await M.isVisible('#sc-finish'), 'mentor buttons');
  await M.click('#sc-copy');
  const link = await M.evaluate(() => navigator.clipboard.readText());
  ok(/\?room=[A-HJ-NP-Z2-9]{6}$/.test(link), 'link copied', link);
  ok((await M.textContent('#sc-copy')) === 'コピーしたよ', 'copy feedback');

  // ── 2. 部屋がないリンク・正しくないリンク
  const X = await ctx.newPage(); watch(X, 'x');
  await X.goto(BASE + '?room=ZZZZZZ');
  ok(await X.isVisible('#sc-join'), 'join shown');
  await X.click('#sc-enter');
  await X.waitForSelector('#sc-join-msg:not([hidden])');
  ok((await X.textContent('#sc-join-msg')).includes('部屋がひらいていないよ'), 'no room message');
  ok(await X.isEnabled('#sc-enter'), 'enter re-enabled');
  await X.goto(BASE + '?room=abc');
  ok(await X.isVisible('#sc-top'), 'bad link → top');
  ok(!X.url().includes('room='), 'bad param removed');
  ok((await X.textContent('#sc-toast')) === 'リンクが正しくないよ', 'bad link toast');

  // ── 3. 子どもが入る
  const C = await ctx.newPage(); watch(C, 'child');
  await C.goto(link);
  await C.click('#sc-enter');
  await C.waitForSelector('#sc-app:not([hidden])');
  ok(!(await C.isVisible('#sc-copy')) && !(await C.isVisible('#sc-finish')), 'child has no mentor buttons');
  ok(!(await C.isVisible('#sc-peer')), 'child peer label hidden');
  await M.waitForFunction(() => document.getElementById('sc-peer').textContent === '相手が入っているよ');
  ok(true, 'mentor sees peer');

  // ── 4. 3人目は入れない
  await X.goto(link);
  await X.click('#sc-enter');
  await X.waitForSelector('#sc-join-msg:not([hidden])');
  ok((await X.textContent('#sc-join-msg')).includes('もう2人入っているよ'), 'third is full');

  // ── 5. 見ている話題に届く → 未読にならない
  await sendText(M, 'こんにちは。今日の朝ごはんは何だった？');
  await C.waitForSelector('.sc-msg--peer');
  ok((await msgTexts(C)).join('|') === 'peer:こんにちは。今日の朝ごはんは何だった？', 'child got msg');
  ok((await topicBadges(C)).join('|') === '|', 'no unread while watching');
  ok(!(await title(C)).startsWith('('), 'title no count');
  ok((await msgTexts(M)).join('|') === 'me:こんにちは。今日の朝ごはんは何だった？', 'mentor own msg');

  // ── 6. 別の話題を見ている間に届く → 未読
  await openTopic(C, 1);
  ok(await C.isVisible('.sc-mood'), 'mood card');
  ok((await C.$$eval('.sc-choice', (e) => e.map((x) => x.textContent))).join('|') === '⑤絶好調|④調子がよさそう|③いつも通り|②少し気持ちが落ち込んでいる|①とても気持ちが落ち込んでいる|今日は答えない', 'mood choices');
  await sendText(M, '2つ目');
  await sendText(M, '3つ目');
  await C.waitForFunction(() => document.title.startsWith('(2)'));
  ok((await topicBadges(C)).join('|') === '2|', 'unread 2 on topic 1', await topicBadges(C));
  ok((await C.$eval('.sc-topic', (e) => e.getAttribute('aria-label'))) === '1番の話題: チェックイン、未読2件', 'aria unread');
  ok((await C.$eval('.sc-topic__preview', (e) => e.textContent)) === '3つ目', 'preview');
  await openTopic(C, 0);
  ok((await topicBadges(C)).join('|') === '|', 'unread cleared on open');
  ok(!(await title(C)).startsWith('('), 'title cleared');
  const divIdx = await C.$$eval('#sc-msgs > *', (els) => els.findIndex((e) => e.classList.contains('sc-talk__divider')));
  ok(divIdx === 1, 'divider before first unread', divIdx);
  await sendText(C, 'パンだった');
  ok(!(await C.$('.sc-talk__divider')), 'divider gone after reply');
  await M.waitForFunction(() => document.querySelectorAll('.sc-msg').length === 4);
  ok((await topicBadges(M)).join('|') === '|', 'mentor watching → no unread');

  // ── 7. ジブンチェック
  await openTopic(C, 1);
  await C.click('.sc-choice >> nth=2');
  ok((await msgTexts(C)).join('|') === 'me:③ いつも通り', 'mood answer mine');
  await M.waitForFunction(() => document.title.startsWith('(1)'));
  ok((await topicBadges(M)).join('|') === '|1', 'mentor unread on mood topic');
  await openTopic(M, 1);
  ok((await msgTexts(M)).join('|') === 'peer:③ いつも通り', 'mentor sees mood answer');
  await M.click('.sc-choice--pass');
  await C.waitForFunction(() => document.querySelectorAll('.sc-msg').length === 2);
  ok((await msgTexts(C)).join('|') === 'me:③ いつも通り|peer:今日は答えない', 'pass answer');

  // ── 8. 話題をふやす
  await C.click('#sc-add-open');
  ok(await C.isVisible('#sc-add-form') && !(await C.isVisible('#sc-add-open')), 'add form');
  await C.fill('#sc-add-input', '   ');
  await C.press('#sc-add-input', 'Enter');
  ok((await C.$$('.sc-topic')).length === 2, 'blank title rejected');
  await C.fill('#sc-add-input', '見てほしいもの');
  await C.press('#sc-add-input', 'Enter');
  ok((await C.$$('.sc-topic')).length === 3, 'topic added');
  ok((await C.textContent('#sc-talk-title')) === '見てほしいもの', 'adder opens it');
  await M.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 3);
  ok((await topicBadges(M)).join('|') === '||新しい', 'fresh badge', await topicBadges(M));
  ok((await title(M)).startsWith('(1)'), 'fresh counted in title');
  ok((await M.$$eval('.sc-topic__num', (e) => e.map((x) => x.textContent))).join('') === '①②③', 'topic numbers');

  // ── 9. 入力中・書きかけは話題ごと
  await C.type('#sc-text', 'いま書いて');
  await M.waitForFunction(() => document.querySelectorAll('.sc-topic__preview')[2].textContent === '入力中…');
  ok(!(await M.isVisible('#sc-typing')), 'typing line hidden in other topic');
  await openTopic(M, 2);
  ok(await M.isVisible('#sc-typing'), 'typing line shown');
  ok((await topicBadges(M)).join('|') === '||', 'fresh cleared');
  await openTopic(C, 0);
  ok((await C.inputValue('#sc-text')) === '', 'draft not carried to other topic');
  await M.waitForFunction(() => document.getElementById('sc-typing').hidden);
  ok(true, 'typing off on topic switch');
  await openTopic(C, 2);
  ok((await C.inputValue('#sc-text')) === 'いま書いて', 'draft restored');

  // ── 10. 画像
  const big = await C.evaluate(() => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 3000, 2000); g.addColorStop(0, '#2E7D8C'); g.addColorStop(1, '#F5F2EC'); x.fillStyle = g; x.fillRect(0, 0, 3000, 2000); x.fillStyle = '#1C3F5E'; x.font = '200px sans-serif'; x.fillText('TEST', 300, 1000); return c.toDataURL('image/png').split(',')[1]; });
  fs.writeFileSync(path.join(OUT, 'big.png'), Buffer.from(big, 'base64'));
  fs.writeFileSync(path.join(OUT, 'note.txt'), 'x');
  await C.setInputFiles('#sc-file', path.join(OUT, 'big.png'));
  await C.waitForSelector('#sc-pending:not([hidden])');
  await C.click('#sc-send');
  ok((await msgTexts(C)).join('|') === 'me:いま書いて[img]', 'image + caption sent', await msgTexts(C));
  ok(!(await C.isVisible('#sc-pending')), 'pending cleared');
  await M.waitForSelector('.sc-msg--peer img');
  const dims = await M.$eval('.sc-msg--peer img', (i) => new Promise((r) => { const d = () => r([i.naturalWidth, i.naturalHeight, i.src.slice(0, 23), i.src.length]); i.complete ? d() : (i.onload = d); }));
  ok(dims[0] === 1280 && dims[1] === 853 && dims[2] === 'data:image/jpeg;base64,', 'image shrunk to 1280 jpeg', dims);
  console.log('  image bytes(base64 chars):', dims[3]);
  await M.click('.sc-msg__imgbtn');
  ok(await M.$eval('#sc-viewer', (d) => d.open), 'viewer open');
  await M.click('#sc-viewer-close');
  ok(!(await M.$eval('#sc-viewer', (d) => d.open)), 'viewer closed');
  const box = await M.evaluate(() => { const i = document.querySelector('.sc-msg--peer img').getBoundingClientRect(); const b = document.querySelector('.sc-msg--peer .sc-msg__bubble').getBoundingClientRect(); return [Math.round(i.width), Math.round(i.height), Math.round(b.width)]; });
  ok(box[0] === 260 && box[1] === 173 && box[2] <= 260 + 30, 'image thumb size, bubble hugs image', box);
  await M.click('.sc-msg__imgbtn'); await M.screenshot({ path: path.join(OUT, 'mentor-viewer.png') }); await M.click('#sc-viewer-close');
  await M.screenshot({ path: path.join(OUT, 'mentor-image.png') });
  await C.setInputFiles('#sc-file', path.join(OUT, 'note.txt'));
  await C.waitForFunction(() => !document.getElementById('sc-toast').hidden && document.getElementById('sc-toast').textContent.includes('使えなかった'));
  ok(true, 'non-image rejected');
  // 貼りつけ
  await M.evaluate(async () => { const c = document.createElement('canvas'); c.width = 40; c.height = 30; const b = await new Promise((r) => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([b], 'p.png', { type: 'image/png' })); document.getElementById('sc-text').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); });
  await M.waitForSelector('#sc-pending:not([hidden])');
  await M.click('#sc-pending-remove');
  ok(!(await M.isVisible('#sc-pending')), 'pasted image removable');

  // ── 11. 消す（本人だけ）
  ok((await M.$$('.sc-msg--peer .sc-msg__del')).length === 0, 'no delete on peer msg');
  await C.click('.sc-msg--me .sc-msg__del');
  ok(await C.$eval('#sc-confirm', (d) => d.open), 'confirm open');
  await C.click('#sc-confirm-cancel');
  ok((await C.$$('.sc-msg')).length === 1, 'cancel keeps');
  await C.click('.sc-msg--me .sc-msg__del');
  await C.click('#sc-confirm-ok');
  ok((await C.$$('.sc-msg')).length === 0, 'deleted mine');
  await M.waitForFunction(() => document.querySelectorAll('.sc-msg').length === 0);
  ok(await M.isVisible('.sc-talk__empty'), 'deleted at peer, empty note');

  // ── 12. HTML はそのまま文字として出る
  await sendText(M, '<img src=x onerror="window.__xss=1"><b>太字</b>');
  await C.waitForSelector('.sc-msg--peer');
  ok((await C.$eval('.sc-msg--peer .sc-msg__text', (e) => e.textContent)) === '<img src=x onerror="window.__xss=1"><b>太字</b>', 'html as text');
  ok(!(await C.evaluate(() => window.__xss)) && !(await C.$('.sc-msg__text b')), 'no injection');
  await C.click('#sc-add-open'); await C.fill('#sc-add-input', '<i>x</i>'); await C.click('#sc-add-form button[type=submit]');
  await M.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 4);
  ok(!(await M.$('.sc-topic i')), 'topic title as text');

  // ── 13. ウィンドウが後ろにあるとき → 開いている話題でも未読
  await openTopic(M, 0); await openTopic(C, 0);
  await C.evaluate(() => { document.hasFocus = () => false; });
  await sendText(M, '後ろにいる間のメッセージ');
  await C.waitForFunction(() => document.title.startsWith('(1)'));
  ok((await topicBadges(C))[0] === '1', 'unread while unfocused');
  await C.evaluate(() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); });
  ok(!(await title(C)).startsWith('('), 'read on focus');
  ok(!!(await C.$('.sc-talk__divider')), 'divider on focus');

  // ── 14. 上にスクロールしている間に届く → 「新しいメッセージ」
  for (let i = 0; i < 14; i++) await sendText(M, '行' + i + '\nもう1行');
  await C.waitForFunction(() => document.querySelectorAll('.sc-msg').length >= 19);
  await C.$eval('#sc-msgs', (e) => { e.scrollTop = 0; });
  await sleep(100);
  await sendText(M, '下に届いた');
  await C.waitForSelector('#sc-newer:not([hidden])');
  ok((await topicBadges(C))[0] === '', 'still no unread when watching');
  await C.click('#sc-newer');
  ok(await C.$eval('#sc-msgs', (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 5), 'jumped to bottom');
  ok(!(await C.isVisible('#sc-newer')), 'pill hidden');

  // ── 15. Enter で送る・Shift+Enter は改行・変換中の Enter は送らない
  const before = (await M.$$('.sc-msg')).length;
  await M.fill('#sc-text', 'えんたー');
  await M.$eval('#sc-text', (t) => t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, bubbles: true, cancelable: true })));
  await M.$eval('#sc-text', (t) => t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })));
  ok((await M.$$('.sc-msg')).length === before, 'composing enter does not send');
  await M.press('#sc-text', 'Shift+Enter');
  ok((await M.$$('.sc-msg')).length === before && (await M.inputValue('#sc-text')).includes('\n'), 'shift+enter newline');
  await M.press('#sc-text', 'Enter');
  ok((await M.$$('.sc-msg')).length === before + 1 && (await M.inputValue('#sc-text')) === '', 'enter sends');

  // ── 16. 音の切りかえ
  await C.click('#sc-sound');
  ok((await C.getAttribute('#sc-sound', 'aria-pressed')) === 'false' && (await C.getAttribute('#sc-sound', 'aria-label')) === '新着の音: オフ', 'sound off');
  await C.click('#sc-sound');
  ok((await C.getAttribute('#sc-sound', 'aria-pressed')) === 'true', 'sound on');

  console.log('  elapsed ms to step 16:', Date.now() - T0);
  await M.waitForSelector('#sc-toast', { state: 'hidden', timeout: 4000 }); await C.waitForSelector('#sc-toast', { state: 'hidden', timeout: 4000 });
  ok(true, 'toasts disappear');
  await M.screenshot({ path: path.join(OUT, 'mentor-desktop.png') });

  // ── 17. せまい画面（子ども）
  await C.setViewportSize({ width: 375, height: 700 });
  await sleep(150);
  ok(await C.isVisible('.sc-topics') && !(await C.isVisible('.sc-talk')), 'narrow: list only');
  ok((await C.$$('.sc-topic[aria-current]')).length === 0, 'narrow list: no current mark');
  await sendText(M, 'せまい画面の間に');
  await C.waitForFunction(() => document.title.startsWith('(1)'));
  ok((await topicBadges(C))[0] === '1', 'narrow list: unread even on current topic');
  await openTopic(M, 1); await sendText(M, 'ジブンチェックにも');
  await C.waitForFunction(() => document.title.startsWith('(2)'));
  await C.screenshot({ path: path.join(OUT, 'child-mobile-list.png') });
  await openTopic(C, 0);
  ok(!(await C.isVisible('.sc-topics')) && await C.isVisible('.sc-talk'), 'narrow: talk only');
  const vis = await C.evaluate(() => { const box = document.getElementById('sc-msgs').getBoundingClientRect(); const inBox = (e) => { const r = e.getBoundingClientRect(); return r.top >= box.top - 1 && r.bottom <= box.bottom + 1; }; const all = document.querySelectorAll('.sc-msg'); return [inBox(document.querySelector('.sc-talk__divider')), inBox(all[all.length - 1])]; });
  ok(vis[0] && vis[1], 'narrow: divider and newest message in view', vis);
  ok((await C.textContent('#sc-back-badge')) === '1' && await C.isVisible('#sc-back-badge'), 'back badge shows others');
  const overflow = await C.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 0, 'no horizontal overflow (talk)', overflow);
  await C.screenshot({ path: path.join(OUT, 'child-mobile-talk.png') });
  await C.click('#sc-back');
  ok(await C.isVisible('.sc-topics'), 'back to list');
  ok((await C.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0, 'no horizontal overflow (list)');
  await openTopic(C, 1);
  await C.screenshot({ path: path.join(OUT, 'child-mobile-mood.png') });
  ok(!(await title(C)).startsWith('('), 'all read');
  await C.setViewportSize({ width: 1100, height: 720 });
  await sleep(150);
  ok((await C.$$('.sc-topic[aria-current]')).length === 1 && await C.$eval('#sc-msgs', (e) => e.scrollHeight - e.scrollTop - e.clientHeight < 5), 'wide again: current mark and bottom');

  // ── 18. 子どもが読みこみ直す → 同じ人として入り直せる
  await C.reload();
  ok(await C.isVisible('#sc-join'), 'reload → join');
  await M.waitForFunction(() => document.getElementById('sc-peer').textContent === '相手を待っているよ');
  await C.click('#sc-enter');
  await C.waitForSelector('#sc-app:not([hidden])');
  ok((await C.$$('.sc-topic')).length === 4, 'state restored after rejoin');
  ok((await C.$$('.sc-msg')).length > 10, 'messages restored');
  await M.waitForFunction(() => document.getElementById('sc-peer').textContent === '相手が入っているよ');

  // ── 19. 子どもがとじる → 3人目だった人が入れる
  await C.close();
  await M.waitForFunction(() => document.getElementById('sc-peer').textContent === '相手を待っているよ');
  ok(true, 'mentor sees leave');
  await X.click('#sc-enter');
  await X.waitForSelector('#sc-app:not([hidden])');
  ok(true, 'seat freed');

  // ── 20. 終わる
  await M.click('#sc-finish');
  ok((await M.textContent('#sc-confirm-title')) === '作戦会議チャットを終わる？', 'finish confirm');
  await M.click('#sc-confirm-cancel');
  ok(await M.isVisible('#sc-app'), 'cancel keeps room');
  await M.click('#sc-finish'); await M.click('#sc-confirm-ok');
  ok(await M.isVisible('#sc-end') && await M.isVisible('#sc-end-again'), 'mentor end');
  await X.waitForSelector('#sc-end:not([hidden])');
  ok(!(await X.isVisible('#sc-end-again')), 'child end, no reopen button');
  ok((await X.$$('.sc-msg, .sc-topic')).length === 0 && (await M.$$('.sc-msg, .sc-topic')).length === 0, 'DOM wiped');
  ok((await title(X)) === '作戦会議チャット（試作） | room-K', 'title reset');
  // とじた部屋のリンクではもう入れない
  const C2 = await ctx.newPage(); watch(C2, 'child2');
  await C2.goto(link); await C2.click('#sc-enter');
  await C2.waitForSelector('#sc-join-msg:not([hidden])');
  ok((await C2.textContent('#sc-join-msg')).includes('部屋がひらいていないよ'), 'old link dead');

  // ── 21. 新しい部屋 → メンターがウィンドウをとじると子どもも終わる
  await M.click('#sc-end-again');
  await M.click('#sc-copy');
  const link2 = await M.evaluate(() => navigator.clipboard.readText());
  ok(link2 !== link, 'new code each time');
  ok((await M.$$('.sc-msg')).length === 0 && (await M.$$('.sc-topic')).length === 2, 'fresh room');
  await C2.goto(link2); await C2.click('#sc-enter');
  await C2.waitForSelector('#sc-app:not([hidden])');
  await M.close({ runBeforeUnload: false });
  await C2.waitForSelector('#sc-end:not([hidden])');
  ok(true, 'mentor close ends child');

  ok(errors.length === 0, 'no console errors', errors);
  console.log('screenshots:', OUT);
  console.log(`pass ${pass} / fail ${fail}`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
