// カンペ放送局の E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/kanpe-housou/engine.js');

// 検証用の写しと画面の写真は、リポジトリの外（KH_WORK）に置く
const WORK = process.env.KH_WORK;
if (!WORK) throw new Error('KH_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6721);
const BASE = `http://127.0.0.1:${PORT}/kanpe-housou/`;
const DB = 'http://127.0.0.1:9722';
const NS = 'demo-roomk-kh';
const ROOMS = 'kanpe_rooms';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
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

async function rest(method, p, body) {
  const res = await fetch(`${DB}/${p}.json?ns=${NS}`, {
    method,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}
const roomOf = (code) => rest('GET', ROOMS + '/' + code);
async function roomWhen(code, fn, timeout = 8000) {
  const until = Date.now() + timeout;
  let room = null;
  while (Date.now() < until) {
    room = await roomOf(code);
    try { if (fn(room)) return room; } catch {}
    await sleep(100);
  }
  return room;
}

function isProd(hostname) {
  return /(^|\.)firebaseio\.com$/.test(hostname) || /(^|\.)firebasedatabase\.app$/.test(hostname)
    || hostname === 'identitytoolkit.googleapis.com' || hostname === 'securetoken.googleapis.com'
    || /(^|\.)firebaseapp\.com$/.test(hostname);
}

let browser;
const clients = [];
async function launch() { browser = await chromium.launch({ channel: 'chrome' }); return browser; }
async function newContext(label, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (isProd(host)) { T.violations.push(label + ' http ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
  return context;
}
async function newPage(context, label) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    // 音を鳴らす部品が作られた回数を数える（このアプリは音を鳴らさない）
    window.__audioMade = 0;
    ['AudioContext', 'webkitAudioContext', 'Audio'].forEach((name) => {
      const Original = window[name];
      if (!Original) return;
      window[name] = function (...args) { window.__audioMade += 1; return new Original(...args); };
    });
  });
  const client = { label, context, page, errors: [] };
  page.on('websocket', (ws) => {
    const host = new URL(ws.url()).hostname;
    if (host !== '127.0.0.1') T.violations.push(label + ' ws ' + ws.url());
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() || {}).url || '';
    if (/favicon\.ico$/.test(url)) return;
    // 通信を切る検証の間は、Chrome が接続の失敗を出す（想定どおり）
    if (client.offlineOk && /ERR_INTERNET_DISCONNECTED|WebSocket/.test(msg.text())) return;
    client.errors.push(msg.text() + ' @ ' + url);
  });
  page.on('pageerror', (err) => client.errors.push('pageerror: ' + err.message));
  page.on('dialog', (d) => d.accept());
  clients.push(client);
  return client;
}
async function newClient(label, opts = {}) {
  return newPage(await newContext(label, opts), label);
}

async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && document.querySelector('.kh-screen.active'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const waitVisible = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout });
const screen = (c) => c.page.evaluate(() => document.querySelector('.kh-screen.active')?.id.replace('screen-', '') ?? null);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => document.querySelector('.kh-screen.active')?.id === 'screen-' + x, id, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
// 回数は書き込みが確定したあとに数えるので、画面が先に変わることがある。数が n になるまで少し待つ
async function waitStats(c, item, n, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if ((await stats(c, item)) === n) return true; await sleep(50); }
  return (await stats(c, item)) === n;
}
const waitToast = (c, part, timeout = 8000) => waitText(c, '#roomk-toast', part, timeout);
async function waitFor(fn, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { if (await fn()) return true; } catch {} await sleep(100); }
  return false;
}

// ── ゲームの操作 ──
async function createRoom(c, name) {
  await open(c);
  await c.page.click('#btnGoCreate');
  await c.page.fill('#hostName', name);
  await c.page.click('#btnCreateRoom');
  await waitPhase(c, 'lobby');
  return (await text(c, '#roomCodeLabel')).trim();
}
async function joinRoom(c, name, code) {
  await open(c, '?room=' + code);
  await waitScreen(c, 'join');
  await c.page.fill('#guestName', name);
  await c.page.click('#btnJoinRoom');
  await waitPhase(c, 'lobby');
}
const phaseOf = (c) => c.page.evaluate(() => (document.querySelector('#screen-room.active') ? document.body.dataset.phase || null : null));
const waitPhase = (c, ph, timeout = 8000) => c.page.waitForFunction((x) => !!document.querySelector('#screen-room.active') && document.body.dataset.phase === x, ph, { timeout });
async function waitPhaseAll(cs, ph, timeout = 8000) { for (const c of cs) await waitPhase(c, ph, timeout); return true; }
const stepOf = async (code) => Number((await roomOf(code)).game?.step) || 0;
const readerOf = async (c) => (await text(c, '.kh-onair__reader')).replace('読む人 ', '').trim();
// 自分の書く欄（scope は #stage か #tools）に言葉を入れて出す
async function writeAll(c, word, scope = '#stage') {
  // ほかの人が出すと描きなおされるので、毎回さがしなおす（描きなおしても、入れた言葉は残る）
  const n = await c.page.locator(scope + ' .kh-hint__input').count();
  for (let i = 0; i < n; i += 1) await c.page.locator(scope + ' .kh-hint__input').nth(i).fill(word + (i ? i : ''));
  await c.page.locator(scope + ' button', { hasText: '出す' }).first().click();
}
const clickText = (c, scope, label) => c.page.locator(scope + ' button', { hasText: label }).first().click();
const words = (c) => c.page.$$eval('#stage .kh-word', (els) => els.map((e) => e.textContent));
const lineCount = (c) => c.page.$$eval('#stage .kh-line', (els) => els.length);
const lineWith = (c, w) => c.page.locator('#stage .kh-line', { hasText: w }).first();
async function laughCount(c, w) {
  const n = lineWith(c, w).locator('.kh-laughs__count');
  return (await n.count()) ? Number((await n.innerText()).replace(/\D/g, '')) : 0;
}
const laughAt = (c, w) => lineWith(c, w).locator('.kh-laugh').click();
// 読む人の画面で、書き出しから締めまで読みすすめる（読みおわったは押さない）
async function readThrough(c, k, scope = '#stage') {
  const label = (n) => (n === 0 ? '読みはじめる' : 'つぎへ');
  for (let n = 0; n <= k + 1; n += 1) {
    await clickText(c, scope, scope === '#tools' ? '代わりに：' + label(n) : label(n));
    await c.page.waitForFunction((x) => document.querySelectorAll('#stage .kh-line').length === x, n + 1, { timeout: 8000 });
  }
}
const shot = (c, name, opts = {}) => c.page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true, ...opts });

async function finishAll(server) {
  for (const c of clients) {
    check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
    const audio = c.page.isClosed() ? 0 : await c.page.evaluate(() => window.__audioMade || 0).catch(() => 0);
    check('no sound: ' + c.label, audio === 0, audio);
  }
  check('no production access', T.violations.length === 0, T.violations.slice(0, 5));
  console.log(`pass ${T.pass} / fail ${T.failures.length}`);
  console.log('写真: ' + OUT);
  await browser.close();
  server.close();
  process.exit(T.failures.length ? 1 : 0);
}

module.exports = {
  E, T, check, sleep, startServer, rest, roomOf, roomWhen, launch, newContext, newPage, newClient, open,
  text, waitText, visible, waitVisible, screen, waitScreen, overflow, stats, waitStats, waitToast, waitFor,
  createRoom, joinRoom, phaseOf, waitPhase, waitPhaseAll, stepOf, readerOf, writeAll, clickText, words, lineCount, lineWith, laughCount, laughAt, readThrough, shot, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients,
};
