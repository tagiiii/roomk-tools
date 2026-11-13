// いろつなぎ E2E その1（ひとりで遊ぶ・通信しない）
// apps/ をこのテストの中で 127.0.0.1 に配信し、外への通信はすべて止める（stats.js は数えるだけの写しに差し替える）。
// PLAYWRIGHT=（playwright のフォルダ） node tests/iro-tsunagi/e2e1.cjs
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/iro-tsunagi/engine.js');

const ROOT = path.join(__dirname, '../../apps');
const PORT = Number(process.env.E2E_PORT || 6931);
const BASE = `http://127.0.0.1:${PORT}/iro-tsunagi/`;
const OUT = process.env.IT_OUT || null;   // 写真を残すフォルダ（任意）

const T = { pass: 0, failures: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}

// 玉の順番が同じになる seed で、置き方の手順を Node で先に決める（ブラウザで同じ手順を押し、同じ盤になるかをくらべる）
// 手順: 右回しを k 回（回せなかったすぐあとの回しは上下の入れかえ）→ 左右に dx → 一気に落とす
function plan(seed, colors, n) {
  const g = E.newGame({ colors, seed });
  const steps = [];
  let best = 0;
  for (let i = 0; i < n; i++) {
    if (!E.spawn(g)) return null;
    const k = (i * 7 + seed) % 4;
    const dx = ((i * 5 + seed) % 6) - 2 - (k === 3 ? 0 : 0);
    let failed = false;
    for (let j = 0; j < k; j++) { const ok = E.rotate(g, 1, failed); failed = !ok; }
    for (let j = 0; j < Math.abs(dx); j++) E.move(g, Math.sign(dx));
    E.hardDropRows(g);
    E.lock(g);
    const r = E.settle(g);
    if (r.chain > best) best = r.chain;
    steps.push({ k, dx });
  }
  return { steps, best, board: g.board, score: g.score };
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  const outside = [];
  async function newPage(opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, opts || {}));
    await ctx.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') {
        if (u.pathname.endsWith('/shared/js/stats.js')) {
          return route.fulfill({ contentType: 'text/javascript', body: 'window.__counts={};window.RoomkStats={count:function(k){window.__counts[k]=(window.__counts[k]||0)+1;}};' });
        }
        return route.continue();
      }
      if (/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname)) return route.abort();   // 字は手元の字で見る
      outside.push(u.href);
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|fonts/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    return page;
  }
  const st = (page) => page.evaluate(() => window.__iro.state());
  const waitFor = async (fn, timeout = 6000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) { try { if (await fn()) return true; } catch (e) { /* まだ */ } await sleep(40); }
    return false;
  };
  const shot = async (page, name) => { if (OUT) await page.screenshot({ path: path.join(OUT, name + '.png') }); };

  // ---- 1. はじめの画面・はじめる・左右と下の押しっぱなし・W A S D ----
  let page = await newPage();
  await page.goto(BASE + '?test=1&seed=5');
  check('T1 タイトル', (await page.title()) === 'いろつなぎ | あそびのたな');
  check('T2 「？」が出る', await page.isVisible('.howto-fab'));
  check('T3 効果音ははじめ切', await page.isChecked('input[name="sfx"][value="off"]'));
  await shot(page, 'top-pc');
  await page.click('#btnStart');
  check('T4 あそぶ画面になる', await waitFor(async () => (await st(page)).mode === 'play'));
  check('T5 はじめるを数える', (await page.evaluate(() => window.__counts.start)) === 1);
  check('T6 時間なしのときは、のこりを出さない', !(await page.isVisible('#timerBox')));
  let s = await st(page);
  check('T7 軸の玉は左から3列目のいちばん上に出る', s.piece.x === 2 && s.piece.y === 0 && s.piece.rot === 0, s.piece);

  await page.keyboard.down('ArrowRight');
  await sleep(60);
  const x1 = (await st(page)).piece.x;
  await sleep(300);
  const x2 = (await st(page)).piece.x;
  await page.keyboard.up('ArrowRight');
  check('T8 押してすぐは1マスだけ', x1 === 3, x1);
  check('T9 押しっぱなしで0.36秒のうちにかべまで行く', x2 === 5, x2);
  await page.keyboard.press('a');
  check('T10 A で左へ', (await st(page)).piece.x === 4);
  await page.keyboard.press('w');
  check('T11 W で右に回す（かべぎわなので左にずれる）', (await st(page)).piece.rot === 1 && (await st(page)).piece.x === 4, await st(page));
  await page.keyboard.press('z');
  check('T12 Z で左に回す', (await st(page)).piece.rot === 0);
  const y0 = (await st(page)).piece.y;
  await page.keyboard.down('s');
  await sleep(500);
  const y1 = (await st(page)).piece.y;
  await page.keyboard.up('s');
  check('T13 下の押しっぱなしは同じ速さ（0.5秒で6〜8マス）', y1 - y0 >= 5 && y1 - y0 <= 8, y1 - y0);

  // ---- 2. とめる・あそびかたを開くととまる ----
  await page.keyboard.press('p');
  check('T14 P でとめる', (await st(page)).paused && (await page.textContent('#overlayText')) === 'とめています');
  check('T15 ボタンが「つづける」になる', (await page.textContent('#btnPause')) === 'つづける');
  const ys = (await st(page)).piece.y;
  await page.keyboard.press('ArrowLeft');
  await sleep(1200);
  check('T16 とめている間は落ちず、キーでも動かない', (await st(page)).piece.y === ys && (await st(page)).piece.x === 4);
  await page.click('#btnResume');
  check('T17 「つづける」でもどる', !(await st(page)).paused && (await page.isHidden('#overlay')));
  await page.click('.howto-fab');
  check('T18 あそびかたを開くと、とまる', await waitFor(async () => (await st(page)).paused));
  await page.keyboard.press('Escape');
  await page.click('#btnResume').catch(() => {});
  await waitFor(async () => !(await st(page)).paused);
  await page.click('#btnQuit');
  check('T19 「おわる」で結果', await page.isVisible('#screen-end'));
  check('T20 結果に全部消した・からにした', (await page.textContent('#endAll')) === '0回' && (await page.isVisible('#endClearsRow')));
  await page.close();

  // ---- 3. れんさ（同じ seed・同じ手順で、Node と同じ盤になる） ----
  let seed = 1;
  let p = null;
  for (; seed < 400; seed++) { p = plan(seed, 3, 24); if (p && p.best >= 2) break; }
  check('T21 れんさが出る手順が見つかる', p && p.best >= 2, seed);
  page = await newPage();
  await page.goto(BASE + '?test=1&seed=' + seed);
  await page.click('label:has(input[name="colors"][value="3"])');
  await page.click('#btnStart');
  const seen = new Set();
  const watch = setInterval(async () => {
    try { const t = await page.evaluate(() => { const el = document.getElementById('chainText'); return el.classList.contains('show') ? el.textContent : ''; }); if (t) seen.add(t); } catch (e) { /* 終わった */ }
  }, 50);
  for (const step of p.steps) {
    await waitFor(async () => { const v = await st(page); return v.mode === 'play' && v.piece && v.piece.y === 0; });
    for (let j = 0; j < step.k; j++) await page.keyboard.press('ArrowUp');
    for (let j = 0; j < Math.abs(step.dx); j++) await page.keyboard.press(step.dx < 0 ? 'ArrowLeft' : 'ArrowRight');
    await page.keyboard.press('Space');
  }
  await waitFor(async () => (await st(page)).mode === 'play');
  await sleep(300);
  clearInterval(watch);
  s = await st(page);
  check('T22 Node と同じ盤になる', JSON.stringify(s.board) === JSON.stringify(p.board));
  check('T23 点と最高れんさが同じ', s.score === p.score && s.bestChain === p.best, { s: s.score, p: p.score, b: s.bestChain });
  check('T24 「◯れんさ！」が盤の外に出た', [...seen].some((t) => /^\d+れんさ！$/.test(t)), [...seen]);
  const box = await page.$eval('#chainText', (el) => el.getBoundingClientRect().right);
  const boardLeft = await page.$eval('#board', (el) => el.getBoundingClientRect().left);
  check('T25 一言は盤の左の外', box <= boardLeft, { box, boardLeft });
  check('T26 点の表示が合う', (await page.textContent('#score')) === String(p.score));
  await shot(page, 'play-pc');
  await page.close();

  // ---- 4. 盤がいっぱい（からにしてつづける）・時間・おしまい ----
  page = await newPage();
  await page.goto(BASE + '?test=1&seed=9');
  await page.click('label:has(input[name="colors"][value="5"])');
  await page.evaluate(() => { document.querySelector('.it-more').open = true; });
  await page.click('label:has(input[name="time"][value="120"])');
  await page.click('#btnStart');
  check('T27 時間を決めると、のこりが出る', await waitFor(async () => /^(2:00|1:59)$/.test(await page.textContent('#timer'))));
  let full = false;
  for (let i = 0; i < 30 && !full; i++) {
    await waitFor(async () => { const v = await st(page); return v.mode === 'full' || (v.mode === 'play' && v.piece); });
    if ((await st(page)).mode === 'full') { full = true; break; }
    await page.keyboard.press('Space');
    await sleep(30);
  }
  full = full || await waitFor(async () => (await st(page)).mode === 'full', 3000);
  check('T28 盤がいっぱいになる', full);
  check('T29 「盤がいっぱい」と出る', (await page.textContent('#overlayText')).startsWith('盤がいっぱい'));
  await shot(page, 'full-pc');
  check('T30 からにして続く', await waitFor(async () => { const v = await st(page); return v.mode === 'play' && v.clears === 1; }, 4000));
  check('T31 盤がからになっている', (await st(page)).board.every((r) => r.every((v) => v === 0)));
  await page.evaluate(() => window.__iro.setTimeLeft(300));
  check('T32 時間になると結果', await waitFor(async () => await page.isVisible('#screen-end')));
  check('T33 「時間になったよ」', (await page.textContent('#endTitle')) === '時間になったよ');
  check('T34 からにした 1回', (await page.textContent('#endClears')) === '1回');
  await page.click('#btnTop');
  await page.evaluate(() => { document.querySelector('.it-more').open = true; });
  await page.click('label:has(input[name="time"][value="0"])');
  await page.click('label:has(input[name="full"][value="end"])');
  await page.click('#btnStart');
  let ended = false;
  for (let i = 0; i < 30 && !ended; i++) {
    await waitFor(async () => (await page.isVisible('#screen-end')) || ((await st(page)).mode === 'play' && (await st(page)).piece));
    if (await page.isVisible('#screen-end')) { ended = true; break; }
    await page.keyboard.press('Space');
    await sleep(30);
  }
  check('T35 「おしまい」なら、いっぱいで結果', ended || await waitFor(async () => page.isVisible('#screen-end'), 3000));
  check('T36 「おしまい」のときは、からにしたを出さない', await page.isHidden('#endClearsRow'));
  await page.click('#btnAgain');
  check('T37 「もう一回」ですぐあそぶ画面', await waitFor(async () => (await st(page)).mode === 'play' && (await st(page)).score === 0));
  await page.close();

  // ---- 5. 効果音（切のうちは読まない・入で読む・端末に残る） ----
  page = await newPage();
  const mp3 = [];
  page.on('request', (r) => { if (r.url().endsWith('.mp3') || r.url().includes('.mp3?')) mp3.push(r.url()); });
  await page.goto(BASE + '?test=1&seed=3');
  await page.click('#btnStart');
  await sleep(500);
  check('T38 切のうちは音のファイルを読まない', mp3.length === 0, mp3);
  await page.click('#btnQuit');
  await page.click('#btnTop');
  await page.evaluate(() => { document.querySelector('.it-more').open = true; });
  await page.click('label:has(input[name="sfx"][value="on"])');
  await page.click('#btnStart');
  check('T39 入にすると7つの音を読む', await waitFor(async () => (await st(page)).sfxLoaded.length === 7), (await st(page)).sfxLoaded);
  await page.reload();
  check('T40 読み込み直しても入のまま', await page.isChecked('input[name="sfx"][value="on"]'));
  await page.close();

  // ---- 6. 375px・さわれる画面のボタン ----
  page = await newPage({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  await page.goto(BASE + '?test=1&seed=4');
  check('T41 はじめの画面が横にはみ出さない', (await page.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await shot(page, 'top-375');
  await page.click('#btnStart');
  await waitFor(async () => (await st(page)).mode === 'play');
  await sleep(200);
  check('T42 操作ボタンが6つ出る', (await page.$$eval('.it-pad__btn', (b) => b.filter((x) => x.offsetParent).length)) === 6);
  const padBottom = await page.$eval('.it-pad', (el) => el.getBoundingClientRect().bottom);
  const fabTop = await page.$eval('.howto-fab', (el) => el.getBoundingClientRect().top);
  check('T43 盤と操作ボタンが1画面に収まり、右下の丸ボタンより上で終わる', padBottom <= fabTop, { padBottom, fabTop });
  check('T44 あそぶ画面が横にはみ出さない', (await page.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await page.dispatchEvent('[data-act="left"]', 'pointerdown');
  await page.dispatchEvent('[data-act="left"]', 'pointerup');
  check('T45 左のボタンで1マス', (await st(page)).piece.x === 1);
  await page.dispatchEvent('[data-act="rotR"]', 'pointerdown');
  check('T46 右回しのボタン', (await st(page)).piece.rot === 1);
  await page.dispatchEvent('[data-act="drop"]', 'pointerdown');
  check('T47 一気に落とすボタンで置く', await waitFor(async () => { const v = await st(page); return v.board.some((r) => r.some((c) => c)); }));
  await shot(page, 'play-375');
  await page.close();

  check('T48 コンソールにエラーがない', errors.length === 0, errors);
  check('T49 外への通信がない', outside.length === 0, outside);

  await browser.close();
  server.close();
  console.log(`\n${T.pass} 合格 / ${T.failures.length} NG`);
  if (T.failures.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
