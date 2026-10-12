// 作戦会議チャットの E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 検証用の写しと画面の写真は、リポジトリの外（SC_WORK）に置く
const WORK = process.env.SC_WORK;
if (!WORK) throw new Error('SC_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6481);
const BASE = `http://127.0.0.1:${PORT}/sakusen-chat/`;
const DB = 'http://127.0.0.1:9482';
const NS = 'demo-roomk-sc';
// メンター用のカギはリポジトリに置かない（app.js にあるのはハッシュだけ）
const MENTOR = process.env.SC_MENTOR_KEY;
if (!MENTOR) throw new Error('SC_MENTOR_KEY（メンター用のカギ）を指定してね。README.md を参照');
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
const roomOf = (key) => rest('GET', 'sakusenchat_rooms/' + key);
async function roomWhen(key, fn, timeout = 6000) {
  const until = Date.now() + timeout;
  let room = null;
  while (Date.now() < until) {
    room = await roomOf(key);
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
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 760 } });
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
  const client = { label, context, page, errors: [] };
  page.on('websocket', (ws) => {
    const host = new URL(ws.url()).hostname;
    if (host !== '127.0.0.1') T.violations.push(label + ' ws ' + ws.url());
  });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() || {}).url || '';
    if (/favicon\.ico$/.test(url)) return;
    client.errors.push(msg.text() + ' @ ' + url);
  });
  page.on('pageerror', (err) => client.errors.push('pageerror: ' + err.message));
  clients.push(client);
  return client;
}
async function newClient(label, opts = {}) {
  return newPage(await newContext(label, opts), label);
}

async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__);
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const screen = (c) => c.page.evaluate(() => document.querySelector('.sc-screen.active')?.id);
const waitScreen = (c, id, timeout = 8000) => c.page.waitForFunction((x) => document.querySelector('.sc-screen.active')?.id === 'screen-' + x, id, { timeout });
const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const toastText = (c) => text(c, '#roomk-toast');
const waitToast = (c, part, timeout = 6000) => c.page.waitForFunction((p) => (document.getElementById('roomk-toast')?.textContent || '').includes(p), part, { timeout });
const badges = (c) => c.page.$$eval('.sc-topic', (els) => els.map((e) => (e.querySelector('.sc-count') || {}).textContent || ''));
const topicTitles = (c) => c.page.$$eval('.sc-topic__title', (els) => els.map((e) => e.textContent));
const msgs = (c) => c.page.$$eval('.sc-msg', (els) => els.map((e) => (e.classList.contains('sc-msg--me') ? 'me' : e.dataset.name) + ':' + (e.querySelector('.sc-msg__text')?.textContent || '') + (e.querySelector('.sc-msg__imgbtn') ? '[img]' : '')));
const waitMsgs = (c, n, timeout = 6000) => c.page.waitForFunction((k) => document.querySelectorAll('.sc-msg').length === k, n, { timeout });
const waitTitle = (c, prefix, timeout = 6000) => c.page.waitForFunction((p) => (p ? document.title.startsWith(p) : !document.title.startsWith('(')), prefix, { timeout });
const openTopic = (c, i) => c.page.click(`.sc-topic >> nth=${i}`);
const sendText = async (c, t) => { await c.page.fill('#textInput', t); await c.page.click('#btnSend'); };

async function mentorTop(c) {
  await open(c, '?mentor=' + MENTOR);
  await c.page.waitForFunction(() => !document.getElementById('mentorTools').hidden);
}
async function createRoom(c, name) {
  await mentorTop(c);
  await c.page.fill('#hostName', name);
  await c.page.click('#btnCreateRoom');
  await waitScreen(c, 'chat');
  await c.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length === 2);
  await c.page.click('#btnCopyLink');
  await waitToast(c, '参加用のリンクをコピーしました');
  const link = await c.page.evaluate(() => navigator.clipboard.readText());
  const key = new URL(link).searchParams.get('room');
  return { link, key };
}
async function join(c, key, name) {
  await open(c, '?room=' + key);
  await waitScreen(c, 'join');
  await c.page.fill('#guestName', name);
  await c.page.click('#btnJoinRoom');
}
async function joinOk(c, key, name) {
  await join(c, key, name);
  await waitScreen(c, 'chat');
  await c.page.waitForFunction(() => document.querySelectorAll('.sc-topic').length >= 2);
}

async function finishAll(server) {
  for (const c of clients) {
    check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
  }
  check('no production access', T.violations.length === 0, T.violations.slice(0, 5));
  console.log(`pass ${T.pass} / fail ${T.failures.length}`);
  await browser.close();
  server.close();
  process.exit(T.failures.length ? 1 : 0);
}

module.exports = { T, check, sleep, startServer, rest, roomOf, roomWhen, launch, newContext, newPage, newClient, open, screen, waitScreen, text, visible, overflow, toastText, waitToast, badges, topicTitles, msgs, waitMsgs, waitTitle, openTopic, sendText, mentorTop, createRoom, join, joinOk, finishAll, BASE, OUT, MENTOR, NS, DB, clients };
