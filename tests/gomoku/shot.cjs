// ツール一覧のサムネイルを撮る。1台の画面（通信しない）。Firebase の SDK は撮影ブラウザ内で無通信の代わりに差し替え、
// 利用回数（stats.js）は読み込まない。本番には接続しない。名前は撮影用の「そら」「みどり」。（tests/chess/shot.cjs をもとにした）
// 使い方: PLAYWRIGHT=（playwright のフォルダ） node tests/gomoku/shot.cjs 出力.png
// できた画像は 256 色にしてから apps/assets/thumbnails/gomoku.png へ手で写す（docs/development/thumbnails.md）
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '../../apps'), OUT = process.argv[2];
if (!OUT) throw new Error('出力するファイルの名前を指定してね');
const E = require(path.join(ROOT, 'gomoku/engine.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const STUB = `window.firebase=(function(){const ref=()=>({on(){},off(){},once(){return Promise.resolve({val:()=>null,exists:()=>false})},get(){return Promise.resolve({val:()=>null,exists:()=>false})},transaction(){return Promise.resolve({committed:false})},child(){return ref()},onDisconnect(){return {update(){return Promise.resolve()},remove(){return Promise.resolve()},cancel(){return Promise.resolve()},set(){return Promise.resolve()}}},remove(){return Promise.resolve()},set(){return Promise.resolve()},update(){return Promise.resolve()}});const db={ref,goOnline(){},goOffline(){}};const auth={signInAnonymously:()=>Promise.resolve({user:{uid:'shot'}}),currentUser:{uid:'shot'},onAuthStateChanged(){}};const f={initializeApp(){},auth:()=>auth,database:()=>db};f.database.ServerValue={TIMESTAMP:0};return f;})();`;
// 黒が G7〜J10 のななめに4つ（F6 は白がふさいでいる）。白の番で、K11 に赤い輪とおすすめの星が出る
const at = (s) => E.COLS.indexOf(s[0]) + (Number(s.slice(1)) - 1) * E.SIZE;
const list = 'H8 H9 I9 G9 I8 J8 J10 F6 G7'.split(' ');
let g = E.newGame();
const hist = [];
list.forEach((s) => { g = E.play(g, at(s)); if (!g || g.over) throw new Error('bad ' + s); hist.push(at(s)); });
const local = { names: { b: 'そら', w: 'みどり' }, aid: { who: 'both', threat: true, hint: true, last: true, confirm: false }, cpu: null, level: 'normal',
  game: { ...g, hist, moveTime: 0, turnAt: 0, auto: null, bot: null, ended: false } };
srv.listen(6545, '127.0.0.1', async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const bad = [];
  await ctx.route('**/*', (rt) => {
    const u = new URL(rt.request().url());
    if (/firebasejs\/.*firebase-app-compat\.js$/.test(u.pathname)) return rt.fulfill({ contentType: 'text/javascript', body: STUB });
    if (/firebasejs\//.test(u.pathname) || u.pathname.endsWith('/stats.js')) return rt.fulfill({ contentType: 'text/javascript', body: '' });
    if (/firebase|identitytoolkit|securetoken/.test(u.hostname)) { bad.push(u.href); return rt.abort(); }
    return rt.continue();
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((L) => { sessionStorage.setItem('gomoku_local', JSON.stringify(L)); }, local);
  await p.goto('http://127.0.0.1:6545/gomoku/');
  await p.waitForSelector('#screen-game.active #board .gm-cell');
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: '.howto-fab, .howto-feedback-fab { display: none !important; } * { animation: none !important; transition: none !important; }' });
  await p.waitForTimeout(800);
  const box = await p.evaluate(() => {
    const els = [document.getElementById('gameStatus'), document.getElementById('board'), ...document.querySelectorAll('.gm-seat')];
    let l = 1e9, t = 1e9, r = 0, bt = 0;
    els.forEach((e) => { const x = e.getBoundingClientRect(); if (!x.width) return; l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); bt = Math.max(bt, x.bottom); });
    return { x: Math.floor(l) - 12, y: Math.floor(t + scrollY) - 12, width: Math.ceil(r - l) + 24, height: Math.ceil(bt - t) + 24 };
  });
  await p.screenshot({ path: OUT, clip: box, fullPage: true });
  console.log('box', box, 'status', await p.textContent('#gameStatus'), 'errs', errs, 'blocked', bad);
  await b.close(); srv.close();
});
