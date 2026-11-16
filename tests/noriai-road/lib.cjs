// のりあいロードの E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORK = process.env.NR_WORK;
if (!WORK) throw new Error('NR_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6971);
const BASE = `http://127.0.0.1:${PORT}/noriai-road/`;
const DB = 'http://127.0.0.1:9972';
const NS = 'demo-roomk-nr';
const ROOMS = 'noriairoad_rooms';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    try { if (fn(room)) return room; } catch { /* まだ */ }
    await sleep(100);
  }
  return room;
}
async function until(fn, timeout = 8000, every = 100) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) {
    try { v = await fn(); if (v) return v; } catch { /* まだ */ }
    await sleep(every);
  }
  return v;
}

function isProd(hostname) {
  return /(^|\.)firebaseio\.com$/.test(hostname) || /(^|\.)firebasedatabase\.app$/.test(hostname)
    || hostname === 'identitytoolkit.googleapis.com' || hostname === 'securetoken.googleapis.com'
    || /(^|\.)firebaseapp\.com$/.test(hostname);
}

let browser;
const clients = [];
async function launch() { browser = await chromium.launch({ channel: 'chrome' }); return browser; }
async function newClient(label, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1200, height: 900 }, ...(opts.mobile ? { isMobile: true, hasTouch: true } : {}) });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (isProd(host)) { T.violations.push(label + ' http ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__audioMade = 0;
    ['AudioContext', 'webkitAudioContext', 'Audio'].forEach((name) => {
      const Original = window[name];
      if (!Original) return;
      window[name] = function (...args) { window.__audioMade += 1; return new Original(...args); };
    });
  });
  const client = { label, context, page, errors: [], wsBytes: 0 };
  page.on('websocket', (ws) => {
    const host = new URL(ws.url()).hostname;
    if (host !== '127.0.0.1') T.violations.push(label + ' ws ' + ws.url());
    ws.on('framesent', (f) => { client.wsBytes += Buffer.byteLength(typeof f.payload === 'string' ? f.payload : f.payload || ''); client.wsSent = (client.wsSent || 0) + Buffer.byteLength(typeof f.payload === 'string' ? f.payload : f.payload || ''); });
    ws.on('framereceived', (f) => { client.wsBytes += Buffer.byteLength(typeof f.payload === 'string' ? f.payload : f.payload || ''); client.wsRecv = (client.wsRecv || 0) + Buffer.byteLength(typeof f.payload === 'string' ? f.payload : f.payload || ''); });
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() || {}).url || '';
    if (/favicon\.ico$/.test(url)) return;
    if (client.offlineOk && /ERR_INTERNET_DISCONNECTED|WebSocket/.test(msg.text())) return;
    client.errors.push(msg.text() + ' @ ' + url);
  });
  page.on('pageerror', (err) => client.errors.push('pageerror: ' + err.message));
  page.on('dialog', (d) => d.accept());
  clients.push(client);
  return client;
}

async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && window.__noriaiTest && document.querySelector('.nr-screen.active'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}
const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const waitVisible = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout });
const screen = (c) => c.page.evaluate(() => document.querySelector('.nr-screen.active')?.id.replace('screen-', '') ?? null);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => document.querySelector('.nr-screen.active')?.id === 'screen-' + x, id, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
// ページの中の状態（検証用のフック window.__noriaiTest）
const st = (c, fn, arg) => c.page.evaluate(([f, a]) => {
  const { state, E } = window.__noriaiTest;
  // eslint-disable-next-line no-new-func
  return new Function('state', 'E', 'arg', 'return (' + f + ')(state, E, arg)')(state, E, a);
}, [fn.toString(), arg]);
async function shot(c, name) { await c.page.screenshot({ path: path.join(OUT, name + '.png') }); }

async function createRoom(c, name) {
  await c.page.click('#btnGoCreate');
  await c.page.fill('#hostName', name);
  await c.page.click('#btnCreateRoom');
  await waitScreen(c, 'waiting');
  return (await text(c, '#roomCodeLabel')).trim();
}
async function joinRoom(c, name, code) {
  await c.page.click('#btnGoJoin');
  await c.page.fill('#guestName', name);
  await c.page.fill('#joinCode', code);
  await c.page.click('#btnJoinRoom');
}

function finish() {
  for (const c of clients) {
    if (c.errors.length) check(c.label + ' コンソールエラーなし', false, c.errors.slice(0, 5));
  }
  check('本番あての通信なし', T.violations.length === 0, T.violations);
  console.log(`\n${T.pass} ok, ${T.failures.length} NG`);
  if (T.failures.length) process.exitCode = 1;
}

module.exports = { T, check, sleep, until, startServer, rest, roomOf, roomWhen, launch, newClient, open, text, visible, waitVisible, screen, waitScreen, overflow, stats, st, shot, createRoom, joinRoom, finish, clients, ROOMS, OUT, get browser() { return browser; } };
