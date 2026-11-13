// いろつなぎ E2E その3（対戦の送る相手: 最後にじゃまを送ってきた人に返す。2026-11-13 フィードバック）。隔離した Firebase エミュレーターだけを使う（本番に接続しない）
// 使い方は README.md（その2と同じエミュレーターで流す）。送る相手は、まだだれからも来ていなければ並びのつぎ・送ってきた人がいればその人・その人がここまでになったら並びのつぎ
'use strict';
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/iro-tsunagi/engine.js');

const REPO = path.join(__dirname, '../..');
const WORK = process.env.IT_WORK;
if (!WORK) throw new Error('IT_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6932);
const BASE = `http://127.0.0.1:${PORT}/iro-tsunagi/`;
const DB = 'http://127.0.0.1:9932';
const NS = 'demo-roomk-it';
const ROOMS = 'irotsunagi_rooms';

// ---- 写しを作る（共通部品はエミュレーター向けに差し替える） ----
function syncSite() {
  fs.rmSync(SITE, { recursive: true, force: true });
  fs.mkdirSync(SITE, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const d of ['shared', 'assets', 'iro-tsunagi']) fs.cpSync(path.join(REPO, 'apps', d), path.join(SITE, d), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'apps', 'updates.json'), path.join(SITE, 'updates.json'));
  const p = path.join(SITE, 'shared/js/rtdb-utils.js');
  let s = fs.readFileSync(p, 'utf8');
  const start = s.indexOf('const FIREBASE_CONFIG = {');
  const end = s.indexOf('};', start) + 2;
  s = s.slice(0, start) + `const FIREBASE_CONFIG = {
    apiKey: 'demo-key', authDomain: '${NS}.firebaseapp.com', databaseURL: '${DB}?ns=${NS}', projectId: '${NS}', appId: 'demo-app',
  };
  window.__EMU__ = { projectId: FIREBASE_CONFIG.projectId, db: FIREBASE_CONFIG.databaseURL };` + s.slice(end);
  const a = 'firebaseNamespace.initializeApp(FIREBASE_CONFIG);';
  if (s.split(a).length !== 2) throw new Error('rtdb-utils.js の形が変わった');
  s = s.replace(a, a + `
    firebaseNamespace.auth().useEmulator('http://127.0.0.1:9931', { disableWarnings: true });
    firebaseNamespace.database().useEmulator('127.0.0.1', 9932);`);
  if (/roomk-tools-default-rtdb/.test(s)) throw new Error('本番の URL が残っている');
  fs.writeFileSync(p, s);
  fs.writeFileSync(path.join(SITE, 'shared/js/stats.js'), 'window.__STATS__ = []; window.RoomkStats = { count(item) { window.__STATS__.push(item); } };');
}

const T = { pass: 0, failures: [], violations: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail).slice(0, 400) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { try { if (await fn()) return true; } catch (e) { /* まだ */ } await sleep(80); }
  return false;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
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
  const res = await fetch(`${DB}/${p}.json?ns=${NS}`, { method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json();
}
const roomOf = (code) => rest('GET', ROOMS + '/' + code);

function isProd(host) {
  return /(^|\.)firebaseio\.com$/.test(host) || /(^|\.)firebasedatabase\.app$/.test(host)
    || host === 'identitytoolkit.googleapis.com' || host === 'securetoken.googleapis.com' || /(^|\.)firebaseapp\.com$/.test(host);
}

let browser;
const clients = [];
async function newClient(label, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 1100, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (isProd(host)) { T.violations.push(label + ' http ' + route.request().url()); return route.abort(); }
    if (/fonts\.(googleapis|gstatic)\.com$/.test(host)) return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  const c = { label, context, page, errors: [] };
  page.on('websocket', (ws) => { if (new URL(ws.url()).hostname !== '127.0.0.1') T.violations.push(label + ' ws ' + ws.url()); });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource|ERR_FAILED|fonts/.test(m.text())) return;
    c.errors.push(m.text());
  });
  page.on('pageerror', (e) => c.errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  clients.push(c);
  return c;
}
async function open(c, query = '') {
  await c.page.goto(BASE + '?test=1' + (query ? '&' + query : ''));
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__ && window.__iro);
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed');
}
const st = (c) => c.page.evaluate(() => window.__iro.state());
const text = (c, sel) => c.page.evaluate((s) => (document.querySelector(s) || {}).textContent || '', sel);
const shown = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const screenIs = (c, id) => c.page.evaluate((x) => !!document.querySelector('#screen-' + x + '.active'), id);
const waitScreen = (c, id, timeout = 9000) => waitFor(() => screenIs(c, id), timeout);
const stats = (c, item) => c.page.evaluate((x) => (window.__STATS__ || []).filter((s) => s === x).length, item);
const openDetails = (c) => c.page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
const waitPlaying = (c, timeout = 9000) => waitFor(async () => { const v = await st(c); return v.screen === 'play' && v.mode === 'play' && v.piece && v.t >= 0 && (await c.page.evaluate(() => document.getElementById('countdown').hidden)); }, timeout);
const waitPieceTop = (c, timeout = 6000) => waitFor(async () => { const v = await st(c); return v.mode === 'play' && v.t >= 0 && v.piece && v.piece.y === 0 && v.piece.x === 2 && v.piece.rot === 0; }, timeout);

// 盤を文字の絵から作る（上が y=0。'.' は空き）。見えない段は空き
function boardRows(rows) {
  const b = E.emptyBoard();
  const off = E.H - rows.length;
  rows.forEach((r, i) => [...r].forEach((ch, x) => { if (ch !== '.') E.set(b, x, off + i, Number(ch)); }));
  return b;
}



// c のいまの玉で2れんさを作って落とす（その2の R34 と同じ盤）。来るじゃまは先に0にする（へらすぶんで送る数が減らないように）
async function chain2(c) {
  if (!(await waitPieceTop(c))) throw new Error(c.label + ': 玉が上に出ない');
  await c.page.evaluate(() => { const v = window.__iro.state(); if (v.pending) window.__iro.addPending(-v.pending); window.__iro.setPiece(1, 2); });
  const p = (await st(c)).piece;
  const c1 = [1, 2, 3, 4].filter((x) => x !== p.a && x !== p.b)[0];
  await c.page.evaluate((b) => window.__iro.setBoard(b), boardRows([`${p.a}....${c1}`, `${p.a}${p.a}.${p.b}${p.b}${p.b}`]));
  await c.page.keyboard.press('Space');
}
const sentTo = (c, name) => waitFor(async () => (await text(c, '#chainText')).includes(name + 'に3こおくったよ'), 6000);

(async () => {
  syncSite();
  const server = await startServer();
  browser = await chromium.launch({ channel: 'chrome' });

  const H = await newClient('host');
  await open(H);
  await H.page.click('#btnGoCreate');
  await H.page.fill('#hostName', 'ホスト');
  await H.page.click('#btnCreateRoom');
  await waitScreen(H, 'waiting');
  const code = (await text(H, '#roomCodeLabel')).trim();
  const A = await newClient('aoi');
  const B = await newClient('haru');
  for (const [c, name] of [[A, 'あおい'], [B, 'はる']]) {
    await open(c, 'room=' + code);
    await waitScreen(c, 'join');
    await c.page.fill('#guestName', name);
    await c.page.click('#btnJoinRoom');
    await waitScreen(c, 'waiting');
  }
  await waitFor(async () => (await text(H, '#lobbyPeople')).includes('はる'));
  await openDetails(H);
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  await H.page.click('label:has(input[name="roomFull"][value="out"])');
  await H.page.click('label:has(input[name="roomTime"][value="0"])');
  await H.page.click('label:has(input[name="roomColors"][value="4"])');
  await waitFor(async () => { const r = await roomOf(code); return r.settings.mode === 'battle' && r.settings.time === 0 && r.settings.colors === 4; });
  await H.page.click('#btnStartGame');
  check('B0 対戦がはじまる', await waitPlaying(H) && await waitPlaying(A) && await waitPlaying(B));
  const R = (await roomOf(code)).round;
  check('B1 並びは ホスト・あおい・はる', JSON.stringify(R.players) === JSON.stringify(['ホスト', 'あおい', 'はる']), R.players);

  // まだだれからも来ていない → 並びのつぎ（ホスト → あおい）
  await chain2(H);
  check('B3 まだだれからも来ていなければ、並びのつぎの人（あおい）へ', await sentTo(H, 'あおい'));
  check('B4 あおいに3こ届く', await waitFor(async () => (await st(A)).pending === 3));
  check('B5 送ってきた人を盤に書く（boards/あおい/back）', await waitFor(async () => (await roomOf(code)).boards['あおい'].back === 'ホスト'));

  // あおいは、送ってきたホストへ返す（並びのつぎの はる ではなく）
  await chain2(A);
  check('B6 送ってきた人（ホスト）へ返す', await sentTo(A, 'ホスト'));
  check('B7 ホストに届く', await waitFor(async () => (await st(H)).pending > 0 || (await st(H)).board.flat().includes(E.JAMA)));
  check('B8 並びのつぎの人（はる）には届かない', (await st(B)).pending === 0 && !((await roomOf(code)).jama || {})['はる']);
  check('B9 ホストの back はあおい（返されたら、返してきた人が相手）', await waitFor(async () => (await roomOf(code)).boards['ホスト'].back === 'あおい'));

  // 読み込み直しても、送ってきた人へ返す
  await A.page.reload();
  await A.page.waitForFunction(() => window.__iro);
  check('B10 読み込み直すと同じ回にもどる', await waitPlaying(A));
  await chain2(A);
  check('B11 読み込み直しても、送ってきた人（ホスト）へ返す', await sentTo(A, 'ホスト'));
  await shot(A, 'e3-back');

  // 送ってきた人がここまでになったら、並びのつぎの人へ
  await waitPieceTop(H);
  const tall = [];
  for (let y = 1; y < E.H; y++) tall.push('..' + (y % 2 ? '1' : '2') + '...');
  await H.page.evaluate((b) => window.__iro.setBoard(b), boardRows(tall));
  await H.page.keyboard.press('Space');
  check('B12 ホストがここまで', await waitFor(async () => (await roomOf(code)).boards['ホスト'].out === true));
  await chain2(A);
  check('B13 送ってきた人がここまでなら、並びのつぎの人（はる）へ', await sentTo(A, 'はる'));
  check('B14 はるに届く', await waitFor(async () => (await st(B)).pending === 3 || (await st(B)).board.flat().includes(E.JAMA)));

  for (const c of clients) check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
  check('本番に接続しない', T.violations.length === 0, T.violations.slice(0, 5));
  await browser.close();
  server.close();
  console.log(`\n${T.pass} 合格 / ${T.failures.length} NG`);
  console.log('写真: ' + OUT);
  process.exit(T.failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function shot(c, name) { return c.page.screenshot({ path: path.join(OUT, name + '.png') }); }
