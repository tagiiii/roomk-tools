// 好きなものマップ: 説明スライドと発表者ウィンドウの確かめ。
// リポジトリの apps/ をそのまま配信して動かす（エミュレーターは要らない）。本番の Firebase あての通信は止める。
// P キーで発表者ウィンドウ・両方向の同期・チャットにコピー・ノートの書きかえと「元に戻す」・14枚のノート・
// アプリの「？」から重ねてひらく（矢印キー・Esc・「スライドを閉じる」・見ていたページから続く）
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..', '..', 'apps');
const PORT = Number(process.env.E2E_PORT || 6923);
const BASE = `http://127.0.0.1:${PORT}/suki-mono-map/`;
// 画面の写真は SM_WORK を指定したときだけ残す（リポジトリの外）
const OUT = process.env.SM_WORK ? path.join(process.env.SM_WORK, 'out') : null;
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => (OUT ? page.screenshot({ path: path.join(OUT, name + '.png') }) : Promise.resolve());

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(SITE, p);
    if (!file.startsWith(SITE) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

let pass = 0; const fails = [];
const check = (label, cond, detail) => { if (cond) { pass += 1; return; } fails.push(label); console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

(async () => {
  const server = await startServer();
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const blocked = [];
  await ctx.route('**/*', (r) => { const h = new URL(r.request().url()).hostname; if (/firebaseio\.com$|firebasedatabase\.app$|identitytoolkit|securetoken|firebaseapp\.com$/.test(h)) { blocked.push(h); return r.abort(); } return r.continue(); });
  const errors = [];
  const main = await ctx.newPage();
  main.on('pageerror', (e) => errors.push('main: ' + e.message));
  await main.goto(BASE + 'slides.html');
  await main.waitForFunction(() => document.querySelector('#counter').textContent.includes('/ 14'));
  const notes = await main.evaluate(() => SLIDES.map((s) => s.note));
  const counter = (p) => p.evaluate(() => document.querySelector('#counter').textContent.trim());

  // 1. P キーで発表者ウィンドウがひらく
  const [pv] = await Promise.all([ctx.waitForEvent('page'), main.keyboard.press('p')]);
  pv.on('pageerror', (e) => errors.push('presenter: ' + e.message));
  await pv.waitForLoadState();
  check('P key: presenter window opens', pv.url().includes('view=presenter'), pv.url());
  check('presenter: title', (await pv.title()) === '発表者ノート | 好きなものマップ | あそびのたな', await pv.title());
  await pv.waitForFunction(() => document.querySelector('#pvConn').textContent.includes('接続中'));
  check('presenter: connected', true);
  const pvState = () => pv.evaluate(() => ({ count: document.querySelector('#pvCount').textContent.trim(), title: document.querySelector('#pvTitle').textContent.trim(), note: document.querySelector('#pvNote').value, next: document.querySelector('#pvNextTitle').textContent.trim(), prevOff: document.querySelector('#pvPrev').disabled, nextOff: document.querySelector('#pvNext').disabled }));
  let s = await pvState();
  check('presenter: starts at slide 1 with its note', s.count === '1 / 14' && s.note === notes[0] && s.prevOff && !s.nextOff, s);
  check('presenter: deck hidden, note shown', await pv.evaluate(() => getComputedStyle(document.querySelector('#deck')).display === 'none' && getComputedStyle(document.querySelector('#presenter')).display !== 'none'));
  await shot(pv, '31-presenter');

  // 2. スライドを送ると、発表者ウィンドウのノートが変わる
  await main.bringToFront();
  await main.keyboard.press('ArrowRight');
  await pv.waitForFunction(() => document.querySelector('#pvCount').textContent.trim() === '2 / 14');
  s = await pvState();
  check('sync main → presenter', s.title === '好きなものマップ' && s.note === notes[1] && s.next.includes('次のスライド'), s);

  // 3. 発表者ウィンドウから送ると、スライドも変わる（ボタン・矢印キー）
  await pv.bringToFront();
  await pv.click('#pvNext');
  await main.waitForFunction(() => document.querySelector('#counter').textContent.trim() === '3 / 14');
  check('sync presenter → main (button)', (await pvState()).note === notes[2]);
  await pv.locator('#pvTitle').click();
  await pv.keyboard.press('ArrowRight');
  await main.waitForFunction(() => document.querySelector('#counter').textContent.trim() === '4 / 14');
  await pv.keyboard.press('ArrowLeft');
  await main.waitForFunction(() => document.querySelector('#counter').textContent.trim() === '3 / 14');
  check('sync presenter → main (arrow keys)', (await counter(main)) === '3 / 14');

  // 4. チャットにコピー
  await pv.click('#pvCopy');
  await pv.waitForFunction(() => document.querySelector('#pvCopy').textContent.includes('コピーしました'));
  const clip = await pv.evaluate(() => navigator.clipboard.readText());
  check('copy: clipboard has the note', clip === notes[2], clip.slice(0, 40));
  check('copy: note has no emoji and no HTML', !EMOJI.test(clip) && !/[<>]/.test(clip));
  await shot(pv, '32-presenter-copied');
  await sleep(2400);
  check('copy: button label returns', (await pv.evaluate(() => document.querySelector('#pvCopy').textContent)).includes('チャットにコピー'));

  // 5. ノートを書きかえると残る。「もとにもどす」でもどる
  await pv.fill('#pvNote', 'じぶん用に書きかえたメモ');
  await pv.click('#pvNext');
  await pv.click('#pvPrev');
  check('edit: kept after moving away and back', (await pvState()).note === 'じぶん用に書きかえたメモ');
  await pv.click('#pvCopy');
  await sleep(200);
  check('edit: copy uses the edited note', (await pv.evaluate(() => navigator.clipboard.readText())) === 'じぶん用に書きかえたメモ');
  await pv.reload();
  await pv.waitForFunction(() => document.querySelector('#pvConn').textContent.includes('接続中'));
  s = await pvState();
  check('reload: reconnects to the current slide, edit kept', s.count === '3 / 14' && s.note === 'じぶん用に書きかえたメモ', s);
  await pv.click('#pvReset');
  check('reset: original note', (await pvState()).note === notes[2]);
  check('reset: saved copy removed', (await pv.evaluate(() => localStorage.getItem('smm_note_2'))) === null);

  // 6. 14枚ぜんぶ: ノートがあり、絵文字がなく、発表者ウィンドウに同じ文が出る
  await main.bringToFront();
  for (let i = 0; i < 14; i++) await main.keyboard.press('ArrowLeft');
  await pv.waitForFunction(() => document.querySelector('#pvCount').textContent.trim() === '1 / 14');
  let allOk = true; const bad = [];
  for (let i = 0; i < 14; i++) {
    await pv.waitForFunction((n) => document.querySelector('#pvCount').textContent.trim() === `${n} / 14`, i + 1);
    const st = await pvState();
    if (!(st.note === notes[i] && st.note.length > 20 && !EMOJI.test(st.note) && st.title.length > 0)) { allOk = false; bad.push(i + 1); }
    if (i < 13) await main.keyboard.press('ArrowRight');
  }
  check('all 14 notes: shown, non-empty, no emoji', allOk, bad);
  s = await pvState();
  check('last slide: next disabled and labelled', s.nextOff && s.next.includes('最後のスライドです'), s);
  check('no "kotoba tantei" leftovers', !(await pv.evaluate(() => document.body.textContent.includes('ことば探偵'))) && !(await main.evaluate(() => document.body.textContent.includes('ことば探偵'))));

  // 7. アプリの「？」から、スライドを重ねてひらく
  const app = await ctx.newPage();
  app.on('pageerror', (e) => { if (!/auth\/network-request-failed/.test(e.message)) errors.push('app: ' + e.message); });
  await app.goto(BASE);
  await app.waitForSelector('.howto-fab, [class*="howto"][class*="fab"], button[aria-label*="あそびかた"]');
  const opened = await app.evaluate(() => { if (!window.RoomkHowto || !RoomkHowto.openSlides) return 'no api'; RoomkHowto.openSlides(); return 'ok'; });
  await app.waitForSelector('iframe[src*="slides.html"]', { timeout: 5000 }).catch(() => {});
  check('app: slides open over the page', opened === 'ok' && (await app.locator('iframe[src*="slides.html"]').count()) === 1, opened);
  // スライドの読み込みが終わってから Esc を押す（読み込み前の空のページにはキーの受け口がない）
  const frame = app.frames().find((f) => f.url().includes('slides.html'));
  await frame.waitForFunction(() => document.querySelector('#counter') && document.querySelector('#counter').textContent.includes('/ 14'));
  await sleep(300);
  check('app: slides inside the overlay show 14 slides', (await frame.evaluate(() => document.querySelector('#counter').textContent.trim())) === '1 / 14');
  await shot(app, '33-app-slides-overlay');
  await app.keyboard.press('ArrowRight');
  await sleep(300);
  check('app: arrow key moves the slides in the overlay', (await frame.evaluate(() => document.querySelector('#counter').textContent.trim())) === '2 / 14');
  await app.keyboard.press('Escape');
  await sleep(400);
  const layerShown = () => app.evaluate(() => !!document.querySelector('.howto-slides.show'));
  check('app: Esc closes the slides', !(await layerShown()));
  // もう一度ひらくと、見ていたページから続く。「スライドを閉じる」でも閉じる
  await app.evaluate(() => RoomkHowto.openSlides());
  await sleep(300);
  check('app: reopens on the same slide', (await layerShown()) && (await frame.evaluate(() => document.querySelector('#counter').textContent.trim())) === '2 / 14');
  await app.click('.howto-slides-close');
  await sleep(300);
  check('app: close button closes the slides', !(await layerShown()));
  // 「？」の中に「説明スライドを見る」が出る
  await app.evaluate(() => document.querySelector('.howto-fab, button[aria-label*="あそびかた"]').click());
  await sleep(400);
  check('app: help modal has the slides button', await app.evaluate(() => { const b = document.querySelector('.howto-slides-btn'); return !!b && b.getClientRects().length > 0 && b.textContent.includes('説明スライドを見る'); }));

  check('no page errors', errors.length === 0, errors.slice(0, 4));
  // アプリの画面は本番の認証へ出ようとするので、ここで止めている（止めた先を書き出す）
  console.log(`pass ${pass} / fail ${fails.length}` + (blocked.length ? `（止めた本番あての通信: ${[...new Set(blocked)].join(', ')}）` : ''));
  await b.close();
  server.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
