// ツール一覧のサムネイルを撮る。1台の画面（通信しない）。Firebase の SDK は撮影ブラウザ内で無通信の代わりに差し替え、
// 利用回数（stats.js）は読み込まない。本番には接続しない。名前は撮影用の「そら」「みどり」。
// 使い方: PLAYWRIGHT=（playwright のフォルダ） node tests/chess/shot.cjs 出力.png
// できた画像は 256 色にしてから apps/assets/thumbnails/chess.png へ手で写す（docs/development/thumbnails.md）
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '../../apps'), OUT = process.argv[2];
if (!OUT) throw new Error('出力するファイルの名前を指定してね');
const E = require(path.join(ROOT, 'chess/engine.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const STUB = `window.firebase=(function(){const ref=()=>({on(){},off(){},once(){return Promise.resolve({val:()=>null,exists:()=>false})},get(){return Promise.resolve({val:()=>null,exists:()=>false})},transaction(){return Promise.resolve({committed:false})},child(){return ref()},onDisconnect(){return {update(){return Promise.resolve()},remove(){return Promise.resolve()},cancel(){return Promise.resolve()},set(){return Promise.resolve()}}},remove(){return Promise.resolve()},set(){return Promise.resolve()},update(){return Promise.resolve()}});const db={ref,goOnline(){},goOffline(){}};const auth={signInAnonymously:()=>Promise.resolve({user:{uid:'shot'}}),currentUser:{uid:'shot'},onAuthStateChanged(){}};const f={initializeApp(){},auth:()=>auth,database:()=>db};f.database.ServerValue={TIMESTAMP:0};return f;})();`;
const sqn = global.sqn = (n) => (8 - Number(n[1])) * 8 + 'abcdefgh'.indexOf(n[0]);
const list = 'e2e4 e7e5 g1f3 b8c6 f1c4 g8f6 d2d4 e5d4 e1g1 f6e4'.split(' ');
let G = E.create();
const moves = list.map((s) => { const m = { from: sqn(s.slice(0, 2)), to: sqn(s.slice(2, 4)), promo: '' }; if (!E.legalMoves(G).some((x) => E.sameMove(x, m))) throw new Error('bad ' + s); G = E.apply(G, m); return m; });
srv.listen(6537, '127.0.0.1', async () => {
  const b = await chromium.launch({ channel: 'chrome' });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 });
  const bad = [];
  await ctx.route('**/*', (rt) => {
    const u = new URL(rt.request().url());
    if (/firebasejs\/.*firebase-app-compat\.js$/.test(u.pathname)) return rt.fulfill({ contentType: 'text/javascript', body: STUB });
    if (/firebasejs\//.test(u.pathname) || u.pathname.endsWith('/stats.js')) return rt.fulfill({ contentType: 'text/javascript', body: '' });
    if (/firebase|identitytoolkit|securetoken/.test(u.hostname)) { bad.push(u.href); return rt.abort(); }
    return rt.continue();
  });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((L) => { sessionStorage.setItem('chess_local', JSON.stringify(L)); }, { names: ['そら', 'みどり'], aid: { who: 'both', spots: true, names: true, hint: true }, moves, resign: null, timeout: null, ended: false, rev: 1, cpu: null, level: 'normal', cc: { m: 0, b: 0 }, clock: null });
  await p.goto('http://127.0.0.1:6537/chess/');
  await p.waitForSelector('#screen-game.active #board .ch-cell');
  await p.evaluate(() => document.fonts.ready);
  await p.click('#board .ch-cell[data-i="' + sqn('f3') + '"]');
  await p.addStyleTag({ content: '.howto-fab, .howto-feedback-fab { display: none !important; } * { animation: none !important; transition: none !important; }' });
  await p.waitForTimeout(800);
  const box = await p.evaluate(() => {
    const ids = ['gameStatus', 'sideTop', 'board', 'sideBottom', 'hintBox', 'pieceInfo'];
    let l = 1e9, t = 1e9, r = 0, bt = 0;
    ids.forEach((id) => { const e = document.getElementById(id); if (!e || e.hidden) return; const x = e.getBoundingClientRect(); l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); bt = Math.max(bt, x.bottom); });
    return { x: Math.floor(l) - 8, y: Math.floor(t + scrollY) - 8, width: Math.ceil(r - l) + 16, height: Math.ceil(bt - t) + 16 };
  });
  await p.screenshot({ path: OUT, clip: box, fullPage: true });
  console.log('box', box, 'status', await p.textContent('#gameStatus'), 'errs', errs, 'blocked', bad);
  await b.close(); srv.close();
});
