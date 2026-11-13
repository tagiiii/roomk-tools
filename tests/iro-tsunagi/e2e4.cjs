// いろつなぎ E2E その4（対戦の「ここまで」のあとの観戦。2026-11-13 フィードバック）。隔離した Firebase エミュレーターだけを使う（本番に接続しない）
// 使い方は README.md（その2と同じエミュレーターで流す）。ここまでになった人に「みんなの盤を見る」・ならべる画面・「自分の盤にもどる」・ルームに書かない
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


const active = (c) => c.page.evaluate(() => (document.querySelector('.it-screen.active') || {}).id);
// c の盤をいっぱいにして「ここまで」にする（その2の R39 と同じ）
async function goOut(c) {
  await waitPieceTop(c);
  const tall = [];
  for (let y = 1; y < E.H; y++) tall.push('..' + (y % 2 ? '1' : '2') + '...');
  await c.page.evaluate((b) => window.__iro.setBoard(b), boardRows(tall));
  await c.page.keyboard.press('Space');
  return waitFor(async () => (await st(c)).out);
}

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
  await waitFor(async () => { const r = await roomOf(code); return r.settings.mode === 'battle' && r.settings.time === 0 && r.settings.full === 'out'; });
  await H.page.click('#btnStartGame');
  check('W0 対戦がはじまる', await waitPlaying(H) && await waitPlaying(A) && await waitPlaying(B));
  check('W1 あそんでいる間は「みんなの盤を見る」を出さない', !(await shown(B, '#btnSpectate')) && !(await shown(A, '#btnSpectate')));

  check('W2 はるがここまで', await goOut(B));
  check('W3 ここまでになった人に「みんなの盤を見る」', await waitFor(() => shown(B, '#btnSpectate')));
  check('W4 盤の上の「ここまで！」で案内する', (await text(B, '#overlayText')).includes('みんなの盤を見る'));
  check('W5 のこっている人には出さない', !(await shown(A, '#btnSpectate')) && !(await shown(H, '#btnSpectate')));
  const before = JSON.stringify((await roomOf(code)).boards['はる']);
  await B.page.click('#btnSpectate');
  check('W6 押すと、あそぶ人の盤をならべる画面', await waitFor(async () => (await active(B)) === 'screen-watch'));
  check('W7 3人の盤がならぶ', await waitFor(async () => (await B.page.$$('#watchGrid .it-wboard')).length === 3));
  check('W8 「自分の盤にもどる」が出て、「早めにおわる」「トップへ戻る」は出ない（参加者）', await shown(B, '#btnWatchMine') && !(await shown(B, '#btnWatchEnd')) && !(await shown(B, '#btnWatchLeave')));
  await shot(B, 'e4-watch');
  await sleep(500);
  check('W9 見ているだけではルームに書かない', JSON.stringify((await roomOf(code)).boards['はる']) === before);

  await B.page.click('#btnWatchMine');
  check('W10 「自分の盤にもどる」で止まった盤にもどる', await waitFor(async () => (await active(B)) === 'screen-play') && await shown(B, '#btnSpectate'));
  check('W11 盤の大きさが保たれる', await B.page.evaluate(() => document.getElementById('board').getBoundingClientRect().width > 100));

  await B.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  await B.page.click('#btnSpectate');
  await waitFor(async () => (await active(B)) === 'screen-watch');
  check('W12 375px でも横にはみ出さない', (await B.page.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await shot(B, 'e4-watch-375');
  await B.page.setViewportSize({ width: 1100, height: 900 });

  await B.page.reload();
  await B.page.waitForFunction(() => window.__iro);
  check('W13 読み込み直したら、あそぶ画面から（「みんなの盤を見る」つき）', await waitFor(async () => (await active(B)) === 'screen-play' && await shown(B, '#btnSpectate'), 12000));
  await B.page.click('#btnSpectate');
  await waitFor(async () => (await active(B)) === 'screen-watch');

  check('W14 ホストもここまで', await goOut(H));
  check('W15 のこりが1人になると、観戦している人も結果へ', await waitFor(async () => (await active(B)) === 'screen-result' && (await active(H)) === 'screen-result', 12000));

  for (const c of clients) check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
  check('本番に接続しない', T.violations.length === 0, T.violations.slice(0, 5));
  await browser.close();
  server.close();
  console.log(`\n${T.pass} 合格 / ${T.failures.length} NG`);
  console.log('写真: ' + OUT);
  process.exit(T.failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function shot(c, name) { return c.page.screenshot({ path: path.join(OUT, name + '.png') }); }
