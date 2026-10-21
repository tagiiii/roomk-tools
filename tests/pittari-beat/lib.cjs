// ぴったりビートの E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 検証用の写しと画面の写真は、リポジトリの外（PB_WORK）に置く
const WORK = process.env.PB_WORK;
if (!WORK) throw new Error('PB_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6651);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/pittari-beat/`;
const DB = 'http://127.0.0.1:9652';
const NS = 'demo-roomk-pb';
const ROOMS = 'pittari_beat_rooms';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.mp3': 'audio/mpeg' };
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
async function launch() {
  browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  return browser;
}
async function newContext(label, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1100, height: 900 },
    hasTouch: !!opts.hasTouch, isMobile: !!opts.isMobile, deviceScaleFactor: opts.deviceScaleFactor || 1,
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN }).catch(() => {});
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (isProd(host)) { T.violations.push(label + ' http ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
  return context;
}
async function newPage(context, label) {
  const page = await context.newPage();
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
  await c.page.goto(BASE + query + '#e2e');
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && window.__pb && document.querySelector('main:not([hidden])'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}
async function reload(c) {
  await c.page.reload();
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && window.__pb && document.querySelector('main:not([hidden])'));
}

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const screen = (c) => c.page.evaluate(() => (document.querySelector('main:not([hidden])') || {}).id || null);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => (document.querySelector('main:not([hidden])') || {}).id === x, id, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
const waitToast = (c, part, timeout = 8000) => waitText(c, '#roomk-toast', part, timeout);
const pick = (c, box, label) => c.page.click(`${box} .pb-choice:has-text("${label}")`);

const waitPlaying = (c, timeout = 8000) => c.page.waitForFunction(() => window.__pb.now() !== null, null, { timeout });
const waitResult = (c, timeout = 75000) => c.page.waitForSelector('#pb-result:not([hidden])', { timeout });
const results = (c) => c.page.evaluate(() => ({
  score: +document.getElementById('pb-result-score').textContent,
  perfect: +document.getElementById('pb-result-perfect').textContent,
  good: +document.getElementById('pb-result-good').textContent,
  combo: +document.getElementById('pb-result-combo').textContent,
  note: document.getElementById('pb-result-room').hidden ? '' : document.getElementById('pb-result-room').textContent,
  title: document.getElementById('pb-result-title').textContent,
  text: document.getElementById('pb-result').innerText,
}));
// 譜面どおりにキーを押す（ページの中で、しるしの時刻が来たら押す）。jitter はしるしごとのずらし（秒）を返す関数の本体
const autoplay = (c, jitter, limit) => c.page.evaluate(([jitter, limit]) => new Promise((done) => {
  const codes = ['KeyF', 'KeyJ'];
  const notes = window.__pb.notes().slice(0, limit || undefined);
  const j = new Function('i', jitter);
  let i = 0;
  const step = () => {
    const t = window.__pb.now();
    if (t !== null) {
      while (i < notes.length && notes[i].t + j(i) <= t + 0.003) {
        const n = notes[i++];
        document.dispatchEvent(new KeyboardEvent('keydown', { code: codes[n.lane], bubbles: true }));
      }
    }
    if (i >= notes.length || document.getElementById('pb-play').hidden) { done(i); return; }
    setTimeout(step, 4);
  };
  step();
}), [jitter || 'return 0;', limit || 0]);
const rankingRows = (c, sel) => c.page.evaluate((s) => [...document.querySelectorAll(s + ' .pb-rank')].map((li) => ({
  no: li.querySelector('.pb-rank__no').textContent,
  name: li.querySelector('.pb-rank__name').textContent,
  pts: li.querySelector('.pb-rank__pts').textContent,
  tag: li.querySelector('.pb-rank__tag').textContent,
  me: li.classList.contains('is-me'),
  away: li.classList.contains('is-away'),
})), sel);

async function createRoom(c, course, track) {
  await open(c);
  await c.page.click('#pb-go-create');
  await pick(c, '#pb-create-courses', course);
  await pick(c, '#pb-create-tracks', track);
  await c.page.click('#pb-create-go');
  await waitScreen(c, 'pb-host');
  return (await text(c, '#pb-host-code')).trim();
}
async function joinRoom(c, name, code) {
  await open(c, '?room=' + code);
  await waitScreen(c, 'pb-join');
  await c.page.fill('#pb-join-name', name);
  await c.page.click('#pb-join-go');
  await waitScreen(c, 'pb-guest');
  await c.page.waitForFunction(() => !document.getElementById('pb-guest-start').disabled);
}

async function finishAll(server) {
  for (const c of clients) check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
  check('no production access', T.violations.length === 0, T.violations.slice(0, 5));
  console.log(`pass ${T.pass} / fail ${T.failures.length}  写真: ${OUT}`);
  await browser.close();
  server.close();
  process.exit(T.failures.length ? 1 : 0);
}

module.exports = {
  T, check, sleep, startServer, rest, roomOf, roomWhen, launch, newContext, newPage, newClient, open, reload,
  text, waitText, visible, screen, waitScreen, overflow, stats, waitToast, pick,
  waitPlaying, waitResult, results, autoplay, rankingRows, createRoom, joinRoom, finishAll,
  BASE, ORIGIN, OUT, NS, DB, ROOMS, clients,
};
