// エミュレーターも Java も使わずに、1つの画面だけでルームを動かすための部品（サムネイルの撮影・効果音の検査で使う）。
// 撮影・検査のブラウザの中だけで、Firebase の SDK を「メモリの中のデータベース」に差し替える
// （本番にも、ほかのどこにも接続しない。本番あての通信が出たら bad に入る）。利用回数（stats.js）も数えない。
// ほかの端末とのやりとり（同時の書き込み・切断）は確かめられない。それは e2e1.cjs・e2e2.cjs（エミュレーター）で見る。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/torisetsu-kaijo/engine.js');

const APPS = path.join(__dirname, '../../apps');
const PORT = Number(process.env.E2E_PORT || 6471);
const CODE = 'ABCDEF';
const BASE = `http://127.0.0.1:${PORT}/torisetsu-kaijo/`;
const ROOM = 'torisetsukaijo_rooms/' + CODE;

// メモリの中のデータベース（このアプリが使う分だけ。1つの画面の中で閉じている）
const STUB = `(() => {
  const TS = { '.sv': 'timestamp' };
  // 読み込む前から置いておくデータ（window.__shotSeed。読み込んですぐルームを読む「みんなにみせる画面」用）
  let tree = window.__shotSeed ? JSON.parse(JSON.stringify(window.__shotSeed)) : {};
  const listeners = [];
  const parts = (p) => String(p).split('/').filter(Boolean);
  const copy = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));
  const resolve = (v) => {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      const out = Array.isArray(v) ? [] : {};
      Object.keys(v).forEach((k) => { const r = resolve(v[k]); if (r !== null && r !== undefined) out[k] = r; });
      return Object.keys(out).length ? out : null;
    }
    return v === undefined ? null : v;
  };
  const read = (p) => {
    if (p === '.info/connected') return true;
    if (p === '.info/serverTimeOffset') return 0;
    let cur = tree;
    for (const k of parts(p)) { if (cur === null || typeof cur !== 'object' || !(k in cur)) return null; cur = cur[k]; }
    return copy(cur);
  };
  const prune = (node) => {
    if (!node || typeof node !== 'object') return node;
    Object.keys(node).forEach((k) => { const v = prune(node[k]); if (v === null || v === undefined) delete node[k]; else node[k] = v; });
    return Object.keys(node).length ? node : null;
  };
  const write = (p, value) => {
    const ks = parts(p);
    const v = resolve(copy(value));
    if (!ks.length) { tree = v || {}; return; }
    let cur = tree;
    ks.slice(0, -1).forEach((k) => { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
    if (v === null) delete cur[ks[ks.length - 1]]; else cur[ks[ks.length - 1]] = v;
    tree = prune(tree) || {};
  };
  const snap = (p) => { const v = read(p); return { key: parts(p).pop() || null, val: () => copy(v), exists: () => v !== null }; };
  const fire = () => setTimeout(() => listeners.slice().forEach((l) => l.cb(snap(l.path))), 0);
  let pushN = 0;
  const ref = (p) => ({
    key: parts(p).pop() || null,
    child: (c) => ref(p + '/' + c),
    on(ev, cb) { listeners.push({ path: p, cb }); setTimeout(() => cb(snap(p)), 0); return cb; },
    off(ev, cb) { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].path === p && (!cb || listeners[i].cb === cb)) listeners.splice(i, 1); },
    get: async () => snap(p),
    once: async () => snap(p),
    async set(v) { write(p, v); fire(); },
    async update(obj) { Object.keys(obj).forEach((k) => write(p + '/' + k, obj[k])); fire(); },
    async remove() { write(p, null); fire(); },
    push(v) { const r = ref(p + '/-shot' + String(++pushN).padStart(4, '0')); const done = r.set(v); const out = Object.assign(done.then(() => r), r); return out; },
    async transaction(fn) {
      const next = fn(read(p));
      if (next === undefined) return { committed: false, snapshot: snap(p) };
      write(p, next); fire();
      return { committed: true, snapshot: snap(p) };
    },
    onDisconnect: () => ({ update: async () => {}, set: async () => {}, remove: async () => {}, cancel: async () => {} }),
  });
  const user = { uid: 'shot-sora' };
  const auth = { currentUser: user, signInAnonymously: async () => ({ user }), onAuthStateChanged(cb) { setTimeout(() => cb(user), 0); return () => {}; } };
  const database = () => ({ ref, goOffline() {}, goOnline() {} });
  database.ServerValue = { TIMESTAMP: TS };
  window.firebase = { initializeApp() {}, auth: () => auth, database };
  window.__shotdb = { read, write(p, v) { write(p, v); fire(); } };
})();`;

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp' };
function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(APPS, p);
    if (!file.startsWith(APPS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, '127.0.0.1', () => resolve(server)));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ブラウザと画面を1つ用意する（Firebase の SDK と stats.js を差し替え、本番あての通信は止めて記録する）
async function openBrowser(opts = {}) {
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 1000 }, deviceScaleFactor: opts.scale || 1 });
  const bad = [];
  const errors = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'www.gstatic.com' && url.pathname.includes('/firebasejs/')) {
      return route.fulfill({ contentType: 'text/javascript', body: url.pathname.endsWith('firebase-app-compat.js') ? STUB : '' });
    }
    if (url.pathname.endsWith('/shared/js/stats.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
    if (/firebaseio\.com$|firebasedatabase\.app$|firebaseapp\.com$/.test(url.hostname) || /^(identitytoolkit|securetoken)\.googleapis\.com$/.test(url.hostname)) {
      bad.push(url.href);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('websocket', (ws) => bad.push('ws ' + ws.url()));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  return { browser, context, page, bad, errors };
}

// 架空のルーム（名前は撮影用。進行だけのメンターと、みどり・あお）を置いてから、そらが入る。待合室まで進める
async function joinAsSora(page) {
  await page.addInitScript(([room]) => {
    window.__seedRoom = () => window.__shotdb.write(room, {
      status: 'waiting', host: 'メンター', hostUid: 'shot-host', hostConnected: true, createdAt: Date.now(), lastGameId: 0, turn: 0,
      set: { hostPlays: false, level: 'normal', slow: false, split: true },
      players: {
        'メンター': { isHost: true, uid: 'shot-host', joinedAt: Date.now() - 4000 },
        'みどり': { isHost: false, uid: 'shot-midori', joinedAt: Date.now() - 3000 },
        'あお': { isHost: false, uid: 'shot-ao', joinedAt: Date.now() - 2000 },
      },
    });
  }, [ROOM]);
  await page.goto(BASE + '?room=' + CODE);
  await page.waitForFunction(() => window.__shotdb && document.querySelector('.tk-screen.active'));
  await page.evaluate(() => window.__seedRoom());
  await page.waitForFunction(() => document.querySelector('.tk-screen.active')?.id === 'screen-join');
  await page.fill('#guestName', 'そら');
  await page.click('#btnJoinRoom');
  await page.waitForFunction(() => document.querySelector('.tk-screen.active')?.id === 'screen-waiting');
}

// ホストの「はじめる」と同じ形の回を置く（解除する人はそら）。G を直してから渡せる
async function putGame(page, id, seed, level, G) {
  const game = { id, seed, level, slow: false, split: true, seats: ['そら', 'みどり', 'あお'], uids: ['shot-sora', 'shot-midori', 'shot-ao'], def: 0, ...E.toRoom(G) };
  await page.evaluate(([room, g]) => {
    const cur = window.__shotdb.read(room);
    window.__shotdb.write(room, { ...cur, status: 'play', lastGameId: g.id, turn: g.id, game: g, say: null });
  }, [ROOM, game]);
  await page.waitForFunction((n) => document.querySelector('.tk-screen.active')?.id === 'screen-game' && window.__tk.gameOf(window.__tk.state.room)?.id === n, id);
  await page.waitForSelector('#viewDef:not([hidden]) .tk-slot');
}
const readDb = (page, sub) => page.evaluate(([p]) => window.__shotdb.read(p), [ROOM + (sub ? '/' + sub : '')]);
const writeDb = (page, sub, value) => page.evaluate(([p, v]) => window.__shotdb.write(p, v), [ROOM + '/' + sub, value]);

module.exports = { E, PORT, CODE, BASE, ROOM, startServer, sleep, openBrowser, joinAsSora, putGame, readDb, writeDb };
