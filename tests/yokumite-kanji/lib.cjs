// よく見て漢字の E2E の土台（隔離エミュレーター）。本番の Firebase には接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 検証用の写しと画面の写真は、リポジトリの外（YK_WORK）に置く
const WORK = process.env.YK_WORK;
if (!WORK) throw new Error('YK_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6491);
const BASE = `http://127.0.0.1:${PORT}/yokumite-kanji/`;
const DB = 'http://127.0.0.1:9492';
const NS = 'demo-roomk-yk';
const ROOMS = 'yokumitekanji_rooms';
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
// いま見せている人（席があるときだけ）と、その人の中身
const seatOf = (room) => (room && room.meta && room.meta.player && room.meta.seats && room.meta.seats[room.meta.player] ? room.meta.player : null);
const liveOf = (room) => (room && room.live && room.meta && room.meta.player ? room.live[room.meta.player] || null : null);
const emptySeats = (room) => !!room && !room.meta.seats && !room.live;
async function roomWhen(code, fn, timeout = 6000) {
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
  await page.addInitScript(() => {
    // 音を鳴らす部品が作られた回数を数える（このアプリは音を鳴らさない）
    window.__audioMade = 0;
    ['AudioContext', 'webkitAudioContext', 'Audio'].forEach((name) => {
      const Original = window[name];
      if (!Original) return;
      window[name] = function (...args) { window.__audioMade += 1; return new Original(...args); };
    });
    // 部品の今の場所と、正しい場所（画面の座標）。
    // つかむ点は、その部品の画の上で、ほかの部品にかくれていない所をさがす（重なっていると別の部品をつかんでしまう）
    window.__ykPoints = (index) => {
      const node = document.querySelectorAll('.yk-stage .yk-piece')[index];
      const stage = document.querySelector('.yk-stage');
      const scale = stage.getBoundingClientRect().width / stage.viewBox.baseVal.width;
      const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(node.getAttribute('transform'));
      let from = null;
      let covered = true;
      for (const ink of node.querySelectorAll('.yk-piece__ink')) {
        const ctm = ink.getScreenCTM();
        const length = ink.getTotalLength();
        for (const t of [0.5, 0.3, 0.7, 0.15, 0.85]) {
          const pt = ink.getPointAtLength(length * t);
          const at = { x: pt.x * ctm.a + ctm.e, y: pt.y * ctm.d + ctm.f };
          if (!from) from = at;
          const top = document.elementFromPoint(at.x, at.y);
          if (top && top.closest('.yk-piece') === node) {
            from = at;
            covered = false;
            break;
          }
        }
        if (!covered) break;
      }
      return { from, covered, home: { x: from.x - m[1] * scale, y: from.y - m[2] * scale } };
    };
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
  clients.push(client);
  return client;
}
async function newClient(label, opts = {}) {
  return newPage(await newContext(label, opts), label);
}

async function open(c, query = '') {
  await c.page.goto(BASE + query);
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && document.querySelector('.yk-screen'));
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}

const title = (c) => c.page.evaluate(() => document.querySelector('.yk-screen-title, .yk-puzzle-word__text')?.textContent ?? null);
const waitTitle = (c, part, timeout = 8000) => c.page.waitForFunction((p) => (document.querySelector('.yk-screen-title, .yk-puzzle-word__text')?.textContent || '').includes(p), part, { timeout });
const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const toastText = (c) => text(c, '#roomk-toast');
const waitToast = (c, part, timeout = 8000) => waitText(c, '#roomk-toast', part, timeout);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
const session = (c) => c.page.evaluate(() => JSON.parse(sessionStorage.getItem('yokumitekanji_session') || 'null'));
const pidOf = (c) => c.page.evaluate(() => sessionStorage.getItem('yokumitekanji_pid'));
const barText = (c) => c.page.evaluate(() => { const b = document.getElementById('shareBar'); return b.hidden ? null : b.querySelector('.yk-share-bar__text').textContent; });
const waitBar = (c, part, timeout = 8000) => c.page.waitForFunction((p) => { const b = document.getElementById('shareBar'); return p === null ? b.hidden : (!b.hidden && b.querySelector('.yk-share-bar__text').textContent.includes(p)); }, part, { timeout });
const watchText = (c) => text(c, '.yk-watch-body');
const waitWatch = (c, part, timeout = 8000) => waitText(c, '.yk-watch-body', part, timeout);

// 見せる側の部品の位置（わくからのずれ）と、見る側に出ている位置
const playerPieces = (c) => c.page.$$eval('.yk-stage .yk-piece', (els) => els.map((e) => {
  const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(e.getAttribute('transform'));
  return { x: Number(m[1]), y: Number(m[2]), l: e.classList.contains('is-locked') };
}));
const viewerPieces = (c) => c.page.$$eval('.yk-stage .yk-piece', (els) => els.map((e) => {
  const m = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(e.style.transform) || [0, 0, 0];
  return { x: Number(m[1]), y: Number(m[2]), l: e.classList.contains('is-locked') };
}));
// 層の入れかえ（はまった部品は下の層へ移る）で DOM の順番が変わるので、位置の集まりとしてくらべる
// 見る側へは小数1けたに丸めて送るので、0.1 までのずれは同じとみなす
function samePieces(a, b) {
  if (a.length !== b.length) return false;
  const rest = [...b];
  return a.every((p) => {
    const at = rest.findIndex((q) => Math.abs(p.x - q.x) <= 0.11 && Math.abs(p.y - q.y) <= 0.11 && Boolean(p.l) === Boolean(q.l));
    if (at < 0) return false;
    rest.splice(at, 1);
    return true;
  });
}
async function waitSame(P, H, timeout = 6000) {
  const until = Date.now() + timeout;
  let a = [];
  let b = [];
  while (Date.now() < until) {
    a = await playerPieces(P);
    b = await viewerPieces(H);
    if (samePieces(a, b)) return true;
    await sleep(100);
  }
  console.log('  pieces differ', JSON.stringify(a), JSON.stringify(b));
  return false;
}

// はまっていない部品のうち n 番目を、本物のマウスで動かす（where: 'home'＝正しい場所／{dx,dy}＝今の場所からのずれ）
async function dragLoose(c, n, where = 'home') {
  const index = await c.page.evaluate((k) => {
    const all = [...document.querySelectorAll('.yk-stage .yk-piece')];
    const loose = all.filter((e) => !e.classList.contains('is-locked'));
    return all.indexOf(loose[k]);
  }, n);
  const pts = await c.page.evaluate((i) => window.__ykPoints(i), index);
  const to = where === 'home' ? pts.home : { x: pts.from.x + where.dx, y: pts.from.y + where.dy };
  await c.page.mouse.move(pts.from.x, pts.from.y);
  await c.page.mouse.down();
  await c.page.mouse.move((pts.from.x + to.x) / 2, (pts.from.y + to.y) / 2, { steps: 4 });
  await c.page.mouse.move(to.x, to.y, { steps: 4 });
  await c.page.mouse.up();
}
// 全部の部品を正しい場所へ（にせものは、はまらずに残る）
// 部品が重なっていると、上にある別の部品をつかむことがある（その部品はずれるだけ）。何回かやり直す
async function solve(c) {
  let stall = 0;
  for (let guard = 0; guard < 20; guard += 1) {
    const done = await c.page.evaluate(() => !document.querySelector('.yk-puzzle-result').hidden);
    if (done) return;
    const loose = await c.page.$$eval('.yk-stage .yk-piece:not(.is-locked)', (els) => els.length);
    let placed = false;
    for (let k = 0; k < loose && !placed; k += 1) {
      const before = await c.page.$$eval('.yk-stage .yk-piece.is-locked', (els) => els.length);
      await dragLoose(c, k);
      const after = await c.page.$$eval('.yk-stage .yk-piece.is-locked', (els) => els.length);
      placed = after > before;
    }
    if (!placed) stall += 1;
    if (stall > 4) return;
  }
}

async function createWatch(c) {
  await open(c);
  await c.page.click('#btnCreateWatch');
  await waitTitle(c, '見る画面');
  return text(c, '.yk-watch-bar__code strong');
}
async function openInvite(c, code) {
  await open(c, '?room=' + code);
  await waitTitle(c, 'メンターといっしょにやる');
}
async function showVia(c, code) {
  await openInvite(c, code);
  await c.page.click('#btnShow');
  await waitBar(c, 'メンター');
}
// 単元は名前で選ぶ（単元の並び順は変わることがある）
const pickUnit = (c, name) => c.page.click(`.yk-unit-card:has-text("${name}")`);
const pickWord = (c, i) => c.page.click(`.yk-word-tile >> nth=${i}`);

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
  T, check, sleep, startServer, rest, roomOf, seatOf, liveOf, emptySeats, roomWhen, launch, newContext, newPage, newClient, open,
  title, waitTitle, text, waitText, visible, overflow, toastText, waitToast, stats, session, pidOf,
  barText, waitBar, watchText, waitWatch, playerPieces, viewerPieces, samePieces, waitSame,
  dragLoose, solve, createWatch, openInvite, showVia, pickUnit, pickWord, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients,
};
