// 作戦会議の E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORK = process.env.SK_WORK;
if (!WORK) throw new Error('SK_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6951);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const BASE = `${ORIGIN}/apps/sakusen-kaigi/`;
const DB = 'http://127.0.0.1:9942';
const NS = 'demo-roomk-sk';
const ROOMS = 'sakusenkaigi_rooms';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [], errors: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
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

// お知らせ（単発実施プログラム）の差し替え。毎朝のタスクが書く形（apps/circle-time/daily/once.json）
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
function writeNotices(items) {
  const dir = path.join(SITE, 'apps/circle-time/daily');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'once.json'), JSON.stringify({ source: 'test', items }));
}

let browser;
async function launch() { browser = await chromium.launch({ channel: 'chrome' }); return browser; }
async function newClient(label, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (isProd(host)) { T.violations.push(label + ' http ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
  const watchPage = (page) => {
    page.on('pageerror', (e) => T.errors.push(label + ' pageerror ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) T.errors.push(label + ' console ' + m.text()); });
    page.on('websocket', (ws) => { try { if (isProd(new URL(ws.url()).hostname)) T.violations.push(label + ' ws ' + ws.url()); } catch (e) { /* 読めない URL は数えない */ } });
    page.on('dialog', (d) => d.accept());
  };
  context.on('page', watchPage);
  const page = await context.newPage();
  return { label, context, page };
}
const active = (c, id) => c.page.waitForSelector(`#screen-${id}.active`, { timeout: 15000 });
async function createRoom(H) {
  await H.page.goto(BASE);
  await H.page.click('#go-create');
  await active(H, 'host');
  await H.page.waitForFunction(() => /^[A-HJ-NP-Z2-9]{6}$/.test(document.getElementById('h-code').textContent));
  return H.page.textContent('#h-code');
}
async function joinByLink(G, code, name) {
  await G.page.goto(`${BASE}?room=${code}`);
  await active(G, 'join');
  await G.page.fill('#join-name', name);
  await G.page.click('#join-form button[type=submit]');
}
async function openWatch(W, code) { await W.page.goto(`${BASE}?watch=${code}`); await active(W, 'watch'); }
// 進行役: 流れの一覧から、その画面の中身へ移る（コーナーの表紙が出たら、もう一度進める）
async function goBody(H, id) {
  await H.page.click(`#h-steps [data-act=jump][data-id=${id}]`);
  await H.page.waitForFunction((x) => document.querySelector('#h-steps li.cur [data-id]')?.dataset.id === x, id);
  if ((await H.page.textContent('#h-now')).includes('（表紙）つぎ')) { await H.page.click('#h-next'); }
  await H.page.waitForFunction(() => !document.getElementById('h-now').textContent.includes('（表紙）つぎ'));
}
const stageText = (c, sel) => c.page.evaluate((s) => (document.querySelector(s) || {}).innerText || '', sel);
const waitText = (c, sel, text, timeout = 8000) => c.page.waitForFunction(([s, t]) => ((document.querySelector(s) || {}).innerText || '').includes(t), [sel, text], { timeout });
async function shot(c, name) { await c.page.screenshot({ path: path.join(OUT, name + '.png') }); }
async function finish(server) {
  check('本番の Firebase あての通信が出ていない', T.violations.length === 0, T.violations.slice(0, 3));
  check('コンソールのエラー・例外が出ていない', T.errors.length === 0, T.errors.slice(0, 5));
  await browser.close(); server.close();
  console.log(`\n合格 ${T.pass} ／ 不合格 ${T.failures.length}`);
  if (T.failures.length) { console.log(T.failures.join('\n')); process.exit(1); }
}

module.exports = { T, check, sleep, startServer, rest, roomOf, launch, newClient, active, createRoom, joinByLink, openWatch, goBody, stageText, waitText, shot, finish, writeNotices, addDays, BASE, ORIGIN, ROOMS, OUT };
