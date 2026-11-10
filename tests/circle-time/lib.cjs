// サークルタイムの E2E の土台（隔離エミュレーター）。本番の Firebase にも気象庁にも接続しない。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORK = process.env.CT_WORK;
if (!WORK) throw new Error('CT_WORK（作業フォルダ）を指定してね。README.md を参照');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6931);
const BASE = `http://127.0.0.1:${PORT}/apps/circle-time/`;
const DB = 'http://127.0.0.1:9932';
const NS = 'demo-roomk-ct';
const ROOMS = 'circletime_rooms';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
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

// 気象庁の応答の差し替え（本物と同じ形。日付は日本時間のきょう）
const jstToday = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
const WX_FIX = { '016000': ['205', 'くもり　時々　雪', '3', '1'], '130000': ['100', '晴れ', '21', '10'], '471000': ['313', '雨　時々　くもり', '26', '22'] };
function jmaBody(office) {
  const today = jstToday();
  const d = new Date(today + 'T00:00:00+09:00'); d.setDate(d.getDate() + 1);
  const tomorrow = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(d);
  const [code, text, max, min] = WX_FIX[office] || ['201', 'くもり　時々　晴れ', '18', '9'];
  return JSON.stringify([{ publishingOffice: 'テスト', reportDatetime: today + 'T05:00:00+09:00', timeSeries: [
    { timeDefines: [today + 'T05:00:00+09:00'], areas: [{ area: { name: '地方', code: office }, weatherCodes: [code], weathers: [text] }] },
    { timeDefines: [today + 'T06:00:00+09:00'], areas: [{ area: { name: '地方', code: office }, pops: ['10'] }] },
    { timeDefines: [today + 'T00:00:00+09:00', today + 'T09:00:00+09:00', tomorrow + 'T00:00:00+09:00', tomorrow + 'T09:00:00+09:00'], areas: [{ area: { name: '都市', code: office }, temps: [min, max, '8', '17'] }] },
  ] }, {}]);
}

// 子ども向けのニュースの差し替え（毎朝のタスクが書く形）
const NEWS_FIX = [
  { title: '白浜のパンダの赤ちゃん、初めて外へ', text: '和歌山県白浜町の動物園で8月に生まれたパンダの赤ちゃんが、9日に初めて外の運動場に出ました。体重は約10kgです。', ask: '見てみたい動物はいる？', source: 'テスト新聞', url: 'https://example.com/news/1', on: '11月9日', img: { src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Giant_Panda_2.JPG/960px-Giant_Panda_2.JPG', credit: 'Sheila Lau', license: 'Public domain' } },
  { title: '国の宇宙望遠鏡から星の写真', text: '国の宇宙望遠鏡が、約1500光年はなれた星が生まれる場所の写真を送ってきました。', source: 'テスト放送', url: 'https://example.com/news/2', on: '11月9日' },
  { title: '札幌で初雪', text: '北海道の札幌市で9日の朝、この冬はじめての雪がふりました。去年より5日おそいそうです。', ask: '雪でやりたいことは？', source: 'テスト新聞', url: 'https://example.com/news/3', on: '11月9日' },
];

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
  // 気象庁へは出ない（差し替え）。ほかの外のサイトは Google Fonts と gstatic の SDK だけ通す
  await context.route('**/bosai/forecast/data/forecast/*.json', (route) => {
    const office = route.request().url().match(/forecast\/(\d+)\.json/)[1];
    if (opts.weatherDown) return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: jmaBody(office) });
  });
  // 今日は何の日（毎朝のデータ）。opts.daily があればきょうの日付で返し、なければ「まだ用意されていない」（404）
  await context.route('**/apps/circle-time/daily/*.json', (route) => {
    if (!opts.daily) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...opts.daily, date: jstToday() }) });
  });
  // プログラム（Notion から毎朝書くファイル）。opts.program があれば、どの日付にもその中身を返す（後から登録したほうが先に効く）
  await context.route('**/apps/circle-time/daily/*.program.json', (route) => {
    if (!opts.program) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    const date = route.request().url().match(/(\d{4}-\d{2}-\d{2})\.program\.json/)[1];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ date, url: 'https://katariba.notion.site/room-K-277e1247489c4bbe979b0322df284a73', items: opts.program }) });
  });
  // 子ども向けのニュース（毎朝のデータ）。opts.news があれば opts.newsDate（なければきょう）の分だけ返し、ほかは 404
  await context.route('**/apps/circle-time/daily/*.news.json', (route) => {
    const date = route.request().url().match(/(\d{4}-\d{2}-\d{2})\.news\.json/)[1];
    if (!opts.news || date !== (opts.newsDate || jstToday())) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ date, items: opts.news }) });
  });
  // ニュースの写真（Wikimedia Commons）は外へ取りにいかず、小さな画像を返す
  await context.route('https://upload.wikimedia.org/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  // プログラムのサムネイル（Notion の公開ページの画像）は外へ取りにいかず、小さな画像を返す
  await context.route('https://katariba.notion.site/image/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') }));
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__audioMade = 0;
    ['AudioContext', 'webkitAudioContext', 'Audio'].forEach((name) => {
      const Original = window[name];
      if (!Original) return;
      window[name] = function (...args) { window.__audioMade += 1; return new Original(...args); };
    });
  });
  const client = { label, context, page, errors: [] };
  page.on('websocket', (ws) => { if (new URL(ws.url()).hostname !== '127.0.0.1') T.violations.push(label + ' ws ' + ws.url()); });
  page.on('request', (req) => { const h = new URL(req.url()).hostname; if (h === 'www.jma.go.jp') client.jma = (client.jma || 0) + 1; });
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const url = (msg.location() || {}).url || '';
    if (/favicon\.ico$/.test(url)) return;
    if (/\/daily\/\d{4}-\d{2}-\d{2}\.json/.test(url) && !opts.daily) return;
    if (/\/daily\/\d{4}-\d{2}-\d{2}\.news\.json/.test(url)) return; // ニュースはきょう→前の日の順に探すので、ない日の 404 は想定どおり
    if (/\/daily\/\d{4}-\d{2}-\d{2}\.program\.json/.test(url) && !opts.program) return; // プログラムがまだないときの 404 も想定どおり // 今日の分がまだないときの 404 は想定どおり
    if (opts.weatherDown && /jma\.go\.jp/.test(url)) return; // 天気を取れない場面では、取りにいった失敗の表示は想定どおり
    client.errors.push(msg.text() + ' @ ' + url);
  });
  page.on('pageerror', (err) => client.errors.push('pageerror: ' + err.message));
  page.on('dialog', (d) => d.accept());
  clients.push(client);
  return client;
}
async function gate(c) {
  await c.page.waitForFunction(() => window.RoomkRTDB && window.__EMU__);
  const emu = await c.page.evaluate(() => window.__EMU__);
  if (emu.projectId !== NS || !emu.db.includes('127.0.0.1')) throw new Error('emulator gate failed: ' + JSON.stringify(emu));
}
async function open(c, query = '') { await c.page.goto(BASE + query); await gate(c); }

const text = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const waitText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => (document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const waitNoText = (c, sel, part, timeout = 8000) => c.page.waitForFunction(([s, p]) => !(document.querySelector(s)?.textContent || '').includes(p), [sel, part], { timeout });
const visible = (c, sel) => c.page.evaluate((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel);
const waitVisible = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !!n && !n.closest('[hidden]') && n.getClientRects().length > 0; }, sel, { timeout });
const waitHidden = (c, sel, timeout = 8000) => c.page.waitForFunction((s) => { const n = document.querySelector(s); return !n || !!n.closest('[hidden]') || n.getClientRects().length === 0; }, sel, { timeout });
const overflow = (c) => c.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const pressed = (c, sel) => c.page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', sel);
const waitToast = (c, part, timeout = 8000) => waitText(c, '#roomk-toast', part, timeout);
const screenActive = (c) => c.page.evaluate(() => document.querySelector('.screen.active')?.id || null);
const waitScreen = (c, id, timeout = 10000) => c.page.waitForFunction((x) => document.querySelector('.screen.active')?.id === x, 'screen-' + id, { timeout });
async function shot(c, name, fullPage = true) {
  await sleep(300);
  await c.page.evaluate(() => getSelection().removeAllRanges());
  await c.page.screenshot({ path: path.join(OUT, name + '.png'), fullPage });
}

// ── 操作 ──
async function createRoom(c, name, opts = {}) {
  await open(c);
  await c.page.click('#go-create');
  await waitScreen(c, 'setup');
  await c.page.fill('#host-name', name);
  await c.page.click(`#seg-session button[data-v="${opts.kind || 'am'}"]`);
  await waitNoText(c, '#day-status-text', '確かめています');
  await waitNoText(c, '#prog-status-text', '確かめています');
  if (opts.day || opts.prog || opts.note) await c.page.evaluate(() => { document.getElementById('setup-more').open = true; });
  if (opts.day) { for (let i = 0; i < 3; i++) await c.page.fill('#day-' + i, opts.day.options[i]); await c.page.check(`input[name="day-ok"][value="${opts.day.answer}"]`); await c.page.fill('#day-note', opts.day.note || ''); }
  if (opts.prog) await c.page.fill('#prog-lines', opts.prog.join('\n'));
  if (opts.note) await c.page.fill('#prog-note', opts.note);
  if (!opts.skipWeatherWait) await waitText(c, '#wx-status-text', opts.weatherDown ? '取れません' : '取りました', 15000);
  await c.page.waitForFunction(() => document.getElementById('rd-topic').className === 'ok');
  if (opts.free) await c.page.click(`#free-pick button[data-v="${opts.free}"]`);
  if ((opts.kind || 'am') === 'pm') {
    await c.page.waitForFunction(() => document.querySelectorAll('#game-sel option').length > 0);
    if (opts.game) await c.page.selectOption('#game-sel', opts.game);
    if (opts.topic) await c.page.fill('#topic-in', opts.topic);
  }
  await c.page.click('#btn-create');
  await waitScreen(c, 'host');
  await c.page.waitForFunction(() => /^[A-HJ-NP-Z2-9]{6}$/.test(document.querySelector('#host-code').textContent));
  return (await text(c, '#host-code')).trim();
}
async function joinRoom(c, name, code, adult = false) {
  await open(c, '?room=' + code);
  await waitScreen(c, 'join');
  await c.page.fill('#join-name', name);
  if (adult) await c.page.check('#join-adult');
  await c.page.click('#join-form button[type=submit]');
  await waitScreen(c, 'player');
}
async function openWatch(c, code) { await open(c, '?watch=' + code); await waitScreen(c, 'watch'); }
const stage = (c) => text(c, '#watch-stage');
const hostStage = (c) => text(c, '#host-preview');
const player = (c) => text(c, '#player-card');
const waitStage = (c, part, timeout = 8000) => waitText(c, '#watch-stage', part, timeout);
const waitPlayer = (c, part, timeout = 8000) => waitText(c, '#player-card', part, timeout);
const answerBtn = (c, v) => c.page.click(`#player-card [data-act="ans"][data-v="${v}"]`);
const curStepId = async (code) => (await roomOf(code)).cur;
// 舞台の中で、ある行（5段階の段・選択肢のカード）に出ている名前
const whoIn = (c, rowSel) => c.page.evaluate((s) => [...document.querySelectorAll(s + ' .chip')].map((e) => (e.firstChild?.textContent || '').trim()), rowSel);

// 部屋の中身が条件を満たすまで待つ
async function waitRoom(code, pred, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { const r = await roomOf(code); if (r && pred(r)) return r; await sleep(150); }
  throw new Error('waitRoom timeout');
}
// 「次へ」で次の画面の中身まで進む（表紙があれば、もう一度「次へ」）
async function nextMain(c, code) {
  const r0 = await roomOf(code);
  // 伏せて集める画面では、大きいボタンが先に「せーので見せる」「答えを見せる」になる。画面が変わるまで押す
  const key = (r) => JSON.stringify([r.cur, r.view || null, r.reveal || null, r.answerShown || null]);
  let r1 = r0;
  for (let i = 0; i < 3; i++) {
    const before = key(r1);
    await c.page.click('#btn-next');
    r1 = await waitRoom(code, (r) => key(r) !== before);
    if (r1.cur !== r0.cur || (r1.view || null) !== (r0.view || null)) break;
  }
  if (r1.view === 'cover') { await waitText(c, '#host-step-type', '表紙'); await c.page.click('#btn-next'); await waitRoom(code, (r) => r.cur === r1.cur && !r.view); await waitNoText(c, '#host-step-type', '表紙'); }
}
// 一覧の名前から移って、中身まで進む
async function goMain(c, code, id) {
  await c.page.click(`#steplist [data-go="${id}"]`);
  const r1 = await waitRoom(code, (r) => r.cur === id);
  if (r1.view === 'cover') { await waitText(c, '#host-step-type', '表紙'); await c.page.click('#btn-next'); await waitRoom(code, (r) => r.cur === id && !r.view); await waitNoText(c, '#host-step-type', '表紙'); }
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
  text, waitText, waitNoText, visible, waitVisible, waitHidden, overflow, pressed, waitToast, screenActive, waitScreen, shot,
  createRoom, joinRoom, openWatch, waitRoom, nextMain, goMain, stage, hostStage, player, waitStage, waitPlayer, answerBtn, curStepId, whoIn, finishAll,
  BASE, OUT, NS, DB, ROOMS, clients, jstToday, NEWS_FIX,
};
