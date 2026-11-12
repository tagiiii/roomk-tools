// すとんブロックの E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium, webkit } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/suton-block/engine.js');

// 検証用の写しと画面の写真は、リポジトリの外（SB_WORK）に置く
const WORK = process.env.SB_WORK;
if (!WORK) throw new Error('SB_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6771);
const BASE = `http://127.0.0.1:${PORT}/suton-block/`;
const DB = 'http://127.0.0.1:9772';
const NS = 'demo-roomk-sb';
const ROOMS = 'sutonblock_rooms';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.mp3': 'audio/mpeg' };
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
// E2E_BROWSER=webkit で Safari と同じエンジン（Playwright の WebKit）で流す。ふだんは Chrome
async function launch() {
  browser = process.env.E2E_BROWSER === 'webkit' ? await webkit.launch() : await chromium.launch({ channel: 'chrome' });
  return browser;
}
async function newContext(label, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 } });
  if (process.env.E2E_BROWSER !== 'webkit') await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
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
    // 音を鳴らす部品が作られた回数を数える（効果音ははじめは切なので、入にしないかぎり作られない）
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
  // ホストのたまに使う操作（「そのほかの操作」）と待合室の「くわしい設定」は <details> にたたんである（2026-11-06）。
  // このテストの手順はたたむ前に書いたものなので、操作や表示の確かめの前に、たたんだ欄を開いておく
  const openAll = () => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })).catch(() => {});
  for (const m of ['click', 'fill', 'check', 'uncheck', 'selectOption', 'press']) {
    const orig = page[m].bind(page);
    page[m] = async (...args) => { await openAll(); return orig(...args); };
  }
  client.openAll = openAll;
  clients.push(client);
  return client;
}
async function newClient(label, opts = {}) {
  return newPage(await newContext(label, opts), label);
}

async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && document.querySelector('.sb-screen.active'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = async (c, sel) => { if (c.openAll) await c.openAll(); return c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel); };
const waitVisible = async (c, sel, timeout = 8000) => { if (c.openAll) await c.openAll(); return c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout }); };
const screen = (c) => c.page.evaluate(() => document.querySelector('.sb-screen.active')?.id.replace('screen-', '') ?? null);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => document.querySelector('.sb-screen.active')?.id === 'screen-' + x, id, { timeout });
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
  await waitScreen(c, 'waiting');
  return (await text(c, '#roomCodeLabel')).trim();
}
async function joinRoom(c, name, code) {
  await open(c, '?room=' + code);
  await waitScreen(c, 'join');
  await c.page.fill('#guestName', name);
  await c.page.click('#btnJoinRoom');
  await waitScreen(c, 'waiting');
}
const key = async (c, k, n = 1) => { for (let i = 0; i < n; i++) await c.page.keyboard.press(k); };
// カウントダウン（3・2・1）が終わって、落ちはじめるまで待つ（ルームの残り時間は落ちはじめてから出る）
const waitPlaying = (c, timeout = 9000) => c.page.waitForFunction(() => document.querySelector('#screen-play.active') && document.querySelector('#countdown').hidden && /^\d+:\d\d$/.test(document.querySelector('#playTimer').textContent), null, { timeout });
const fitsHeight = (c) => c.page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight);
const shot = (c, name, opts = {}) => c.page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true, ...opts });

async function finishAll(server) {
  for (const c of clients) {
    check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
    const audio = c.page.isClosed() ? 0 : await c.page.evaluate(() => window.__audioMade || 0).catch(() => 0);
    if (!c.soundOk) check('no sound: ' + c.label, audio === 0, audio); // 効果音を入にした人（soundOk）はのぞく
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
  createRoom, joinRoom, key, waitPlaying, fitsHeight, shot, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients,
};
