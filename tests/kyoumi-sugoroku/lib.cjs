// 興味スゴロクの E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
// しるしでヒントの tests/shirushi-hint/lib.cjs と同じ作り。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 検証用の写しと画面の写真は、リポジトリの外（KS_WORK）に置く
const WORK = process.env.KS_WORK;
if (!WORK) throw new Error('KS_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6611);
const BASE = `http://127.0.0.1:${PORT}/kyoumi-sugoroku/`;
const DB = 'http://127.0.0.1:9612';
const NS = 'demo-roomk-ks';
const ROOMS = 'kyoumisugoroku_rooms';
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

// app.js の QUESTIONS を取り出す（テストでエミュレーターの質問を書きかえるため）
function loadQuestions() {
  const src = fs.readFileSync(path.join(SITE, 'kyoumi-sugoroku/app.js'), 'utf8');
  const start = src.indexOf('const QUESTIONS = ');
  const end = src.indexOf('\n};', start);
  return new Function('return ' + src.slice(start + 'const QUESTIONS = '.length, end + 2))();
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
  const client = { label, context, page, errors: [], sockets: 0 };
  page.on('websocket', (ws) => {
    client.sockets += 1;
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

const SCREEN_JS = () => {
  const s = [...document.querySelectorAll('.ks-screen')].find((n) => !n.hidden);
  return s ? s.id.replace('screen-', '') : null;
};
async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && [...document.querySelectorAll('.ks-screen')].some((n) => !n.hidden) && document.getElementById('roomThemes').children.length > 0);
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none'; }, sel);
const waitVisible = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none'; }, sel, { timeout });
const waitHidden = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !n || !!n.closest('[hidden]') || n.getClientRects().length === 0 || getComputedStyle(n).display === 'none'; }, sel, { timeout });
const screen = (c) => c.page.evaluate(SCREEN_JS);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => {
  const s = [...document.querySelectorAll('.ks-screen')].find((n) => !n.hidden);
  return s && s.id === 'screen-' + x;
}, id, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
// 回数は書き込みが確定したあとに数えるので、画面が先に変わることがある。数が n になるまで少し待つ
async function waitStats(c, item, n, timeout = 3000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if ((await stats(c, item)) === n) return true; await sleep(50); }
  return (await stats(c, item)) === n;
}
const waitToast = (c, part, timeout = 8000) => waitText(c, '#roomk-toast', part, timeout);

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
const indicator = (c) => c.page.$$eval('#indicator .ks-player-label', (els) => els.map((e) => ({
  name: e.querySelector('.ks-player-label__name').textContent,
  current: e.classList.contains('is-current'),
  tags: [...e.querySelectorAll('.ks-tag')].map((t) => t.textContent),
})));
// 質問のカードが出ている（アニメーションが終わった）
const waitQuestion = (c, timeout = 8000) => waitVisible(c, '#roomStage #questionCard', timeout);
const card = (c) => c.page.evaluate(() => ({
  player: document.getElementById('modal-player').textContent,
  question: document.getElementById('modal-question').textContent,
  theme: document.getElementById('modal-theme').textContent.trim(),
  choices: [...document.querySelectorAll('#modal-choices .ks-choice')].map((b) => ({ text: b.textContent.trim(), chosen: b.classList.contains('is-chosen'), disabled: b.disabled })),
  next: getComputedStyle(document.getElementById('btn-next')).display !== 'none' && !document.getElementById('modal-actions').hidden,
  skip: getComputedStyle(document.getElementById('btn-skip')).display !== 'none' && !document.getElementById('modal-actions').hidden,
  wait: document.getElementById('modal-wait').hidden ? '' : document.getElementById('modal-wait').textContent,
}));
const pawnsAt = (c) => c.page.$$eval('#board .ks-square', (els) => els.map((e) => [e.querySelector('.ks-square__num').textContent, [...e.querySelectorAll('.ks-pawn')].map((p) => p.textContent).join('')]).filter(([, p]) => p));

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
  T, check, sleep, startServer, rest, roomOf, roomWhen, loadQuestions, launch, newContext, newPage, newClient, open,
  text, waitText, visible, waitVisible, waitHidden, screen, waitScreen, overflow, stats, waitStats, waitToast,
  createRoom, joinRoom, indicator, waitQuestion, card, pawnsAt, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients,
};
