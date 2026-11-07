// ワードウルフの E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 検証用の写しと画面の写真は、リポジトリの外（WW_WORK）に置く
const WORK = process.env.WW_WORK;
if (!WORK) throw new Error('WW_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6751);
const BASE = `http://127.0.0.1:${PORT}/word-wolf/`;
const DB = 'http://127.0.0.1:9752';
const NS = 'demo-roomk-ww';
const ROOMS = 'wordwolf_rooms';
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

function isProd(hostname) {
  return /(^|\.)firebaseio\.com$/.test(hostname) || /(^|\.)firebasedatabase\.app$/.test(hostname)
    || hostname === 'identitytoolkit.googleapis.com' || hostname === 'securetoken.googleapis.com'
    || /(^|\.)firebaseapp\.com$/.test(hostname);
}

let browser;
const clients = [];
async function launch() { browser = await chromium.launch({ channel: 'chrome' }); return browser; }
async function newClient(label, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (isProd(host)) { T.violations.push(label + ' http ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
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
    if (new URL(ws.url()).hostname !== '127.0.0.1') T.violations.push(label + ' ws ' + ws.url());
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() || {}).url || '';
    if (/favicon\.ico$/.test(url)) return;
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

// 開いた画面がエミュレーター向けの写しであることを、毎回確かめる
async function gate(c) {
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__);
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}
async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await gate(c);
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = async (c, sel) => { if (c.openAll) await c.openAll(); return c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel); };
const waitVisible = async (c, sel, timeout = 8000) => { if (c.openAll) await c.openAll(); return c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout }); };
const waitHidden = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !n || !!n.closest('[hidden]') || n.getClientRects().length === 0; }, sel, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const pressed = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', sel);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
// 回数は書き込みが確定したあとに数えるので、画面が先に変わることがある。数が n になるまで少し待つ
async function waitStats(c, item, n, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if ((await stats(c, item)) === n) return true; await sleep(50); }
  return (await stats(c, item)) === n;
}
const waitToast = (c, part, timeout = 8000) => waitText(c, '#roomk-toast', part, timeout);
async function shot(c, name, fullPage = true) {
  await sleep(300);
  await c.page.evaluate(() => getSelection().removeAllRanges());
  await c.page.screenshot({ path: path.join(OUT, name + '.png'), fullPage });
}

// ── ゲームの操作 ──
async function createRoom(c, name) {
  await open(c);
  await c.page.click("button[onclick=\"goTo('host-setup')\"]");
  await c.page.fill('#host-nickname', name);
  await c.page.click('button[onclick="hostCreateRoom()"]');
  await c.page.waitForFunction(() => /^[A-HJ-NP-Z2-9]{6}$/.test((document.querySelector('#waiting-code')?.textContent || '').trim()) || /[?&]room=/.test(location.search), null, { timeout: 10000 }).catch(() => {});
  await waitVisible(c, '#screen-waiting');
  return c.page.evaluate(() => state.roomCode);
}
async function joinRoom(c, name, code) {
  await open(c, '?room=' + code);
  await c.page.fill('#guest-nickname', name);
  await c.page.click('button[onclick="guestJoin()"]');
  await waitVisible(c, '#screen-waiting');
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
  T, check, sleep, startServer, rest, roomOf, launch, newClient, gate, open,
  text, waitText, visible, waitVisible, waitHidden, overflow, stats, waitStats, waitToast, shot,
  createRoom, joinRoom, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients,
};
