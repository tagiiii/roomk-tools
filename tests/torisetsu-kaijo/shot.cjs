// ツール一覧のサムネイル（apps/assets/thumbnails/torisetsu-kaijo.png）を撮る。
// エミュレーターも Java も使わない。撮影ブラウザの中だけで、Firebase の SDK を「メモリの中のデータベース」に差し替える
// （本番にも、ほかのどこにも接続しない。本番あての通信が出たら失敗にする）。利用回数（stats.js）も数えない。
// 使い方: PLAYWRIGHT=（playwright のフォルダ） node tests/torisetsu-kaijo/shot.cjs <出力先.png>
// できた画像は 256 色にしてから apps/assets/thumbnails/torisetsu-kaijo.png へ写す（docs/development/thumbnails.md）
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const E = require('../../apps/torisetsu-kaijo/engine.js');

const APPS = path.join(__dirname, '../../apps');
const PORT = Number(process.env.E2E_PORT || 6471);
const CODE = 'ABCDEF';
const SEED = Number(process.env.SHOT_SEED || 0);

// メモリの中のデータベース（このアプリが使う分だけ。1つの画面の中で閉じている）
const STUB = `(() => {
  const TS = { '.sv': 'timestamp' };
  let tree = {};
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

// 表にコード・記号・ダイヤル（かやじるし）の3種類がならぶ爆弾の番号をさがす（いつも同じ番号になる）
function pickSeed() {
  if (SEED) return SEED;
  for (let seed = 1; seed < 5000; seed++) {
    const bomb = E.makeBomb(seed, 'normal', false);
    const front = [0, 1, 2].map((i) => bomb.slots[i] && bomb.slots[i].type);
    if (front[0] === 'cord' && front[1] === 'glyph' && (front[2] === 'dial' || front[2] === 'arrow')) return seed;
  }
  throw new Error('seed not found');
}

(async () => {
  const out = process.argv[2];
  if (!out) throw new Error('出力先を指定してね');
  const seed = pickSeed();
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'chrome' });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: Number(process.env.SHOT_SCALE || 1) });
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

  // 架空のルーム（名前は撮影用。進行だけのメンターと、みどり・あお）を置いてから、そらが入る
  await page.addInitScript(([code]) => {
    window.__seedRoom = () => window.__shotdb.write('torisetsukaijo_rooms/' + code, {
      status: 'waiting', host: 'メンター', hostUid: 'shot-host', hostConnected: true, createdAt: Date.now(), lastGameId: 0, turn: 0,
      set: { hostPlays: false, level: 'normal', slow: false, split: true },
      players: {
        'メンター': { isHost: true, uid: 'shot-host', joinedAt: Date.now() - 4000 },
        'みどり': { isHost: false, uid: 'shot-midori', joinedAt: Date.now() - 3000 },
        'あお': { isHost: false, uid: 'shot-ao', joinedAt: Date.now() - 2000 },
      },
    });
  }, [CODE]);
  await page.goto(`http://127.0.0.1:${PORT}/torisetsu-kaijo/`);
  await page.waitForFunction(() => window.__shotdb && document.querySelector('.tk-screen.active'));
  await page.evaluate(() => window.__seedRoom());
  await page.goto(`http://127.0.0.1:${PORT}/torisetsu-kaijo/?room=${CODE}`).catch(() => {});
  await page.waitForFunction(() => window.__shotdb && document.querySelector('.tk-screen.active'));
  await page.evaluate(() => window.__seedRoom());
  await page.waitForFunction(() => document.querySelector('.tk-screen.active')?.id === 'screen-join');
  await page.fill('#guestName', 'そら');
  await page.click('#btnJoinRoom');
  await page.waitForFunction(() => document.querySelector('.tk-screen.active')?.id === 'screen-waiting');

  // ホストの「はじめる」と同じ形の回を置く（解除する人はそら）
  const seats = ['そら', 'みどり', 'あお'];
  const now = Date.now();
  // はじめてから20秒（導火線に火がつく前）で、のこり時間だけ 2:30 あたりにしておく
  const G = E.newState('normal', false, now - 20000);
  G.t = { ...G.t, left: 153000, at: now };
  const game = { id: 1, seed, level: 'normal', slow: false, split: true, seats, uids: ['shot-sora', 'shot-midori', 'shot-ao'], def: 0, ...E.toRoom(G) };
  await page.evaluate(([code, g]) => {
    const base = 'torisetsukaijo_rooms/' + code;
    const room = window.__shotdb.read(base);
    window.__shotdb.write(base, { ...room, status: 'play', lastGameId: 1, turn: 1, game: g });
  }, [CODE, game]);
  await page.waitForFunction(() => document.querySelector('.tk-screen.active')?.id === 'screen-game');
  await page.waitForSelector('#viewDef:not([hidden]) .tk-slot');

  // 表のコードを正しく切って、しかけを1つ解除する
  const bomb = E.makeBomb(seed, 'normal', false);
  await page.evaluate(() => window.__tk.cube.showFace('front'));
  await sleep(700);
  await page.click('.tk-slot[data-slot="0"]');
  await page.waitForSelector('#zoomBody .tk-mod--big');
  await page.click(`#zoomBody [data-a="cut:${bomb.slots[0].sol}"]`);
  await page.waitForFunction(([code]) => window.__shotdb.read('torisetsukaijo_rooms/' + code + '/game/ok/s0') === true, [CODE]);
  // 爆弾にもどって、「しかけを解除！」の知らせが消えるのを待つ
  await page.click('#btnZoomBack');
  await page.waitForSelector('#stage', { state: 'visible' });
  await sleep(3500);

  await page.addStyleTag({ content: '.howto-fab,.howto-feedback-fab{display:none!important} .tk-zoom,.tk-zoom *{animation:none!important}' });
  await page.mouse.move(2, 2);
  await page.evaluate(() => document.fonts.ready);
  await sleep(900);
  if (process.env.SHOT_FULL) await page.screenshot({ path: out.replace(/\.png$/, '-full.png') });
  const a = await page.locator('#hud').boundingBox();
  const s = await page.locator('#stage').boundingBox();
  const left = Math.min(a.x, s.x);
  const right = Math.max(a.x + a.width, s.x + s.width);
  const bottom = s.y + s.height;
  const pad = 12;
  await page.screenshot({ path: out, clip: { x: left - pad, y: a.y - pad, width: right - left + pad * 2, height: bottom - a.y + pad * 2 } });
  console.log('shot', out, 'seed', seed, 'front', [0, 1, 2].map((i) => bomb.slots[i].type).join(','));
  if (errors.length) console.log('console errors', errors.slice(0, 5));
  if (bad.length) console.log('本番あての通信', bad.slice(0, 5));
  await browser.close();
  server.close();
  process.exit(errors.length || bad.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
