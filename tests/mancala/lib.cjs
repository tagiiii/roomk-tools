// マンカラの E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/mancala/engine.js');

// 検証用の写しと画面の写真は、リポジトリの外（MC_WORK）に置く
const WORK = process.env.MC_WORK;
if (!WORK) throw new Error('MC_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6961);
const BASE = `http://127.0.0.1:${PORT}/mancala/`;
const DB = 'http://127.0.0.1:9962';
const NS = 'demo-roomk-mc';
const ROOMS = 'mancala_rooms';
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
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && document.querySelector('.mc-screen.active'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const waitVisible = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout });
const screen = (c) => c.page.evaluate(() => document.querySelector('.mc-screen.active')?.id.replace('screen-', '') ?? null);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => document.querySelector('.mc-screen.active')?.id === 'screen-' + x, id, { timeout });
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
const hole = (i) => '#board .mc-hole[data-i="' + i + '"]';
// 盤を画面から読む（穴の番号順の石の数）
const readBoard = (c) => c.page.$$eval('#board .mc-hole', (hs) => {
  const out = new Array(14).fill(null);
  hs.forEach((h) => { out[Number(h.dataset.i)] = Number(h.querySelector('.mc-count').textContent); });
  return out;
});
const turnOf = (c) => c.page.evaluate(() => (document.querySelector('.mc-seat--b.is-turn') ? 'b' : document.querySelector('.mc-seat--w.is-turn') ? 'w' : null));
const goals = (c) => c.page.evaluate(() => ({ b: Number(document.querySelector('.mc-seat__count[data-color="b"]')?.textContent), w: Number(document.querySelector('.mc-seat__count[data-color="w"]')?.textContent) }));
const playable = (c) => c.page.$$eval('#board .mc-hole.is-playable', (xs) => xs.map((x) => Number(x.dataset.i)).sort((a, b) => a - b));
const hints = (c) => c.page.$$eval('#board .mc-hint:not([hidden])', (xs) => xs.map((x) => Number(x.parentElement.dataset.i)).sort((a, b) => a - b));
const bottomRow = (c) => c.page.$$eval('#board .mc-hole', (xs) => xs.filter((x) => x.style.gridRow === '2').map((x) => Number(x.dataset.i)));
const status = (c) => text(c, '#gameStatus');
// 石を入れる動きがおわるまで待つ（動きの間は盤が押せない）
const settled = (c, timeout = 15000) => c.page.waitForFunction(() => !document.querySelector('#gameStatus')?.textContent.includes('まいている') && !document.querySelector('#gameStatus')?.textContent.includes('よこどり！') && !document.querySelector('#gameStatus')?.textContent.startsWith('おわり。'), null, { timeout });
const clockText = (c) => c.page.$$eval('.mc-seat__clock', (xs) => xs.filter((x) => !x.hidden).map((x) => x.dataset.color + ':' + x.textContent).join(','));
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
  createRoom, joinRoom, hole, readBoard, turnOf, goals, playable, hints, bottomRow, status, settled, clockText, shot, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients,
};
