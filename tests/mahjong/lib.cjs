// 麻雀の E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。tests/daifugo/lib.cjs を型にした
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORK = process.env.MJ_WORK;
if (!WORK) throw new Error('MJ_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6642);
const BASE = `http://127.0.0.1:${PORT}/mahjong/`;
const DB = 'http://127.0.0.1:9642';
const NS = 'demo-roomk-mj';
const ROOMS = 'mahjong_rooms';
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
    try { if (fn(room)) return room; } catch {}
    await sleep(100);
  }
  return room;
}
const gameOf = (room) => { try { return JSON.parse(room.game); } catch { return null; } };

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
    if (client.offlineOk && /ERR_INTERNET_DISCONNECTED|WebSocket/.test(msg.text())) return;
    client.errors.push(msg.text() + ' @ ' + url);
  });
  page.on('pageerror', (err) => client.errors.push('pageerror: ' + err.message));
  page.on('dialog', (d) => d.accept());
  const openAll = () => page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; })).catch(() => {});
  client.openAll = openAll;
  clients.push(client);
  return client;
}
async function newClient(label, opts = {}) {
  return newPage(await newContext(label, opts), label);
}

async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && document.querySelector('.mj-screen.active'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const waitVisible = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout });
const screen = (c) => c.page.evaluate(() => document.querySelector('.mj-screen.active')?.id.replace('screen-', '') ?? null);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => document.querySelector('.mj-screen.active')?.id === 'screen-' + x, id, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
async function waitStats(c, item, n, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if ((await stats(c, item)) === n) return true; await sleep(50); }
  return (await stats(c, item)) === n;
}
const waitToast = (c, part, timeout = 8000) => waitText(c, '#roomk-toast', part, timeout);

async function createRoom(c, name) {
  await open(c);
  await c.page.click('#btnGoCreate');
  await c.page.fill('#hostName', name);
  await c.page.click('#btnCreateRoom');
  await waitScreen(c, 'lobby');
  return (await text(c, '#roomCodeLabel')).trim();
}
async function joinRoom(c, name, code, where = 'lobby') {
  await open(c, '?room=' + code);
  await waitScreen(c, 'join');
  await c.page.fill('#guestName', name);
  await c.page.click('#btnJoinRoom');
  await waitScreen(c, where);
}

// 人の番を1手すすめる（あがれるならあがる。聞かれたらパス、ponRate の割合でポン。捨てる番はおすすめか右はしの牌）
async function humanMove(c, ponRate = 0) {
  const acts = await c.page.$$eval('#actions button', (xs) => xs.map((x) => ({ t: x.textContent, d: x.disabled })));
  const click = async (re) => {
    const i = acts.findIndex((a) => re.test(a.t) && !a.d);
    if (i < 0) return false;
    await c.page.click('#actions button >> nth=' + i);
    return true;
  };
  if (await click(/ロン|ツモ/)) return 'win';
  if (acts.some((a) => /^ポン/.test(a.t)) && Math.random() < ponRate && await click(/^ポン/)) return 'pon';
  if (await click(/^パス$/)) return 'pass';
  const tiles = await c.page.$$eval('#me .mj-hand button.mj-tile:not(:disabled)', (xs) => xs.map((x) => ({ id: x.dataset.id, best: x.classList.contains('is-best') })));
  if (tiles.length) {
    const t = tiles.find((x) => x.best) || tiles[tiles.length - 1];
    await c.page.click('#me .mj-hand button[data-id="' + t.id + '"]');
    return 'discard';
  }
  return null;
}

async function finishAll(server) {
  for (const c of clients) {
    check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
    const audio = c.page.isClosed() ? 0 : await c.page.evaluate(() => window.__audioMade || 0).catch(() => 0);
    check('no sound: ' + c.label, audio === 0, audio);
  }
  check('no production access', T.violations.length === 0, T.violations.slice(0, 5));
  console.log(`pass ${T.pass} / fail ${T.failures.length}`);
  await browser.close();
  server.close();
  process.exit(T.failures.length ? 1 : 0);
}

module.exports = {
  T, check, sleep, startServer, rest, roomOf, roomWhen, gameOf, launch, newContext, newPage, newClient, open,
  text, waitText, visible, waitVisible, screen, waitScreen, overflow, stats, waitStats, waitToast,
  createRoom, joinRoom, humanMove, finishAll, BASE, OUT, NS, DB, ROOMS, clients,
};
