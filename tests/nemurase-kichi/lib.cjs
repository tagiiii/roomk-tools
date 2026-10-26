// ねむらせ基地の E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/nemurase-kichi/engine.js');

// 検証用の写しと画面の写真は、リポジトリの外（NK_WORK）に置く
const WORK = process.env.NK_WORK;
if (!WORK) throw new Error('NK_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6881);
const BASE = `http://127.0.0.1:${PORT}/nemurase-kichi/`;
const DB = 'http://127.0.0.1:9882';
const NS = 'demo-roomk-nk';
const ROOMS = 'nemurase_rooms';
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
const roomOf = (code) => rest('GET', ROOMS + '/' + code + '/r');
const rootOf = (code) => rest('GET', ROOMS + '/' + code);
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
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1200, height: 800 } });
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
  // ブラウザが受け取った・送ったデータの量（WebSocket のフレーム）と、位置の送信の回数
  const client = { label, context, page, errors: [], rx: 0, tx: 0, posSends: [], posRecv: 0, posRecvBytes: 0 };
  page.on('websocket', (ws) => {
    const host = new URL(ws.url()).hostname;
    if (host !== '127.0.0.1') T.violations.push(label + ' ws ' + ws.url());
    ws.on('framereceived', (f) => {
      const text = typeof f.payload === 'string' ? f.payload : String(f.payload || '');
      const n = Buffer.byteLength(text);
      client.rx += n;
      // 位置の知らせ（p・g への書き込みが届いたもの）
      if (/"a":"d"/.test(text) && /"p":"\/?nemurase_rooms\/[A-Z0-9]+\/[pg]\//.test(text)) { client.posRecv += 1; client.posRecvBytes += n; }
    });
    ws.on('framesent', (f) => {
      const text = typeof f.payload === 'string' ? f.payload : String(f.payload || '');
      client.tx += Buffer.byteLength(text);
      const m = /"p":"\/nemurase_rooms\/[A-Z0-9]+\/([pg])\/([^"]+)"/.exec(text);
      if (m && /"a":"p"/.test(text)) client.posSends.push({ at: Date.now(), ch: m[1], id: m[2] });
    });
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
async function newClient(label, opts = {}) {
  return newPage(await newContext(label, opts), label);
}

async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && window.__NK__ && document.querySelector('.nk-screen.active'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none'; }, sel);
const waitVisible = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout });
const waitHidden = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !n || !!n.closest('[hidden]') || n.getClientRects().length === 0; }, sel, { timeout });
const screen = (c) => c.page.evaluate(() => document.querySelector('.nk-screen.active')?.id.replace('screen-', '') ?? null);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => document.querySelector('.nk-screen.active')?.id === 'screen-' + x, id, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
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
const me = (c) => c.page.evaluate(() => ({ id: window.__NK__.state.nickname, x: window.__NK__.ME.x, y: window.__NK__.ME.y }));
const teleport = (c, x, y) => c.page.evaluate(([a, b]) => { window.__NK__.ME.x = a; window.__NK__.ME.y = b; }, [x, y]);
const gameIn = (c) => c.page.evaluate(() => window.__NK__.gameOf(window.__NK__.state.room));
const subs = (c) => c.page.evaluate(() => ({ p: window.__NK__.state.subP, g: window.__NK__.state.subG, pa: Object.keys(window.__NK__.PA), pg: Object.keys(window.__NK__.PG) }));
// エミュレーターのゲームを直接書きかえる（役を決める・待ち時間をなくす・時間を早送りする）
async function patchGame(code, patch) {
  await rest('PATCH', ROOMS + '/' + code + '/r/game', patch);
}
async function dismissRole(c) {
  await waitVisible(c, '#ovRole');
  await c.page.click('#btnRoleOk');
}
// ミニゲームを画面の操作でおわらせる
async function solveTask(c) {
  const page = c.page;
  const kind = await page.evaluate(() => {
    const b = document.getElementById('taskBox');
    return b.querySelector('.nk-wire') ? 'wire' : b.querySelector('.nk-order') ? 'order' : b.querySelector('.nk-meter') ? 'meter' : null;
  });
  if (kind === 'wire') {
    for (const k of ['r', 'b', 'y', 'g', 'p']) {
      await page.click('.nk-wire__end--l[data-color="' + k + '"]');
      await page.click('.nk-wire__end--r[data-color="' + k + '"]');
    }
  } else if (kind === 'order') {
    const total = await page.$$eval('.nk-order__btn', (xs) => xs.length);
    for (let n = 1; n <= total; n++) await page.click('.nk-order__btn:text-is("' + n + '")');
  } else if (kind === 'meter') {
    await page.evaluate(() => {
      const mark = parseFloat(document.querySelector('.nk-meter__mark').style.left);
      const input = document.querySelector('.nk-meter__input');
      input.value = String(mark);
      input.dispatchEvent(new Event('input'));
    });
  }
  return kind;
}
async function doFirstTask(c, label) {
  const g = await gameIn(c);
  const id = (await me(c)).id;
  const t = g.tasks[id].find((x) => !x.done);
  const sp = E.SPOTS[t.spot];
  await teleport(c, sp.x, sp.y + 0.6);
  const ready = await waitFor(async () => (await text(c, '#actUseLabel')) === '仕事をする' && !(await c.page.$eval('#actUse', (b) => b.disabled)));
  check(label + ': 仕事の場所で「仕事をする」が押せる', ready);
  await c.page.click('#actUse');
  check(label + ': ミニゲームがひらく', await visible(c, '#ovTask'));
  const kind = await solveTask(c);
  check(label + ': ミニゲーム（' + kind + '）がおわってとじる', await waitFor(async () => !(await visible(c, '#ovTask')), 4000));
  return t.spot;
}
const doneCount = (g) => { let n = 0; Object.keys(g.tasks).forEach((id) => { if (g.roles[id] === 'crew') g.tasks[id].forEach((t) => { if (t.done) n++; }); }); return n; };
const shot = (c, name, opts = {}) => c.page.screenshot({ path: path.join(OUT, name + '.png'), ...opts });

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
  E, T, check, sleep, startServer, rest, roomOf, rootOf, roomWhen, launch, newContext, newPage, newClient, open,
  text, waitText, visible, waitVisible, waitHidden, screen, waitScreen, overflow, stats, waitStats, waitToast, waitFor,
  createRoom, joinRoom, me, teleport, gameIn, subs, patchGame, dismissRole, solveTask, doFirstTask, doneCount, shot, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients,
};
