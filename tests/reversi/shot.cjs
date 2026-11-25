// ツール一覧のサムネイルを撮る。1台の画面（通信しない）の4人の対局。Firebase の SDK は撮影ブラウザ内で無通信の代わりに差し替え、
// 利用回数（stats.js）は読み込まない。本番には接続しない。名前は撮影用の「そら」「みどり」「あお」「ひかり」。（tests/gomoku/shot.cjs をもとにした）
// 使い方: PLAYWRIGHT=（playwright のフォルダ） node tests/reversi/shot.cjs 出力.png
// できた画像は 256 色にしてから apps/assets/thumbnails/reversi.png へ手で写す（docs/development/thumbnails.md）
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '../../apps'), OUT = process.argv[2];
if (!OUT) throw new Error('出力するファイルの名前を指定してね');
const E = require(path.join(ROOT, 'reversi/engine.js'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png' };
const srv = http.createServer((q, r) => { let p = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); if (!fs.existsSync(f)) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); });
const STUB = `window.firebase=(function(){const ref=()=>({on(){},off(){},once(){return Promise.resolve({val:()=>null,exists:()=>false})},get(){return Promise.resolve({val:()=>null,exists:()=>false})},transaction(){return Promise.resolve({committed:false})},child(){return ref()},onDisconnect(){return {update(){return Promise.resolve()},remove(){return Promise.resolve()},cancel(){return Promise.resolve()},set(){return Promise.resolve()}}},remove(){return Promise.resolve()},set(){return Promise.resolve()},update(){return Promise.resolve()}});const db={ref,goOnline(){},goOffline(){}};const auth={signInAnonymously:()=>Promise.resolve({user:{uid:'shot'}}),currentUser:{uid:'shot'},onAuthStateChanged(){}};const f={initializeApp(){},auth:()=>auth,database:()=>db};f.database.ServerValue={TIMESTAMP:0};return f;})();`;
// くじを固定した時間切れの手（autoMove）で4人の対局を PLY 手すすめる（ルールのコードで進めるので、ありえる局面）
const PLY = Number(process.env.PLY || 22);
let seed = Number(process.env.SEED || 7);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
let g = E.newGame(4);
const hist = [];
for (let k = 0; k < PLY; k += 1) {
  hist.push({ board: g.board, turn: g.turn, last: g.last, passed: null, ply: g.ply, n: 4 });
  g = E.play(g, E.autoMove(g.board, g.turn, rnd, 4));
  if (!g || g.over) throw new Error('bad ' + k);
}
const local = { names: { b: 'そら', w: 'みどり', y: 'あお', u: 'ひかり' }, aid: { who: 'both', spots: true, count: false, confirm: false }, cpu: null, cpus: [], level: 'normal',
  game: { ...g, hist, moveTime: 0, turnAt: 0, auto: null, bot: null, ended: false } };
srv.listen(6546, '127.0.0.1', async () => {
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
  await p.addInitScript((L) => { sessionStorage.setItem('reversi_local', JSON.stringify(L)); }, local);
  await p.goto('http://127.0.0.1:6546/reversi/');
  await p.waitForSelector('#screen-game.active #board .rv-cell');
  await p.evaluate(() => document.fonts.ready);
  await p.addStyleTag({ content: '.howto-fab, .howto-feedback-fab { display: none !important; } * { animation: none !important; transition: none !important; }' });
  await p.waitForTimeout(800);
  const box = await p.evaluate(() => {
    const els = [document.getElementById('gameStatus'), document.getElementById('board'), ...document.querySelectorAll('.rv-seat')];
    let l = 1e9, t = 1e9, r = 0, bt = 0;
    els.forEach((e) => { const x = e.getBoundingClientRect(); if (!x.width) return; l = Math.min(l, x.left); t = Math.min(t, x.top); r = Math.max(r, x.right); bt = Math.max(bt, x.bottom); });
    return { x: Math.floor(l) - 12, y: Math.floor(t + scrollY) - 12, width: Math.ceil(r - l) + 24, height: Math.ceil(bt - t) + 24 };
  });
  await p.screenshot({ path: OUT, clip: box, fullPage: true });
  console.log('box', box, 'status', await p.textContent('#gameStatus'), 'counts', E.count(g.board), 'spots', Object.keys(E.movesOf(g.board, g.turn, 4)).length, 'errs', errs, 'blocked', bad);
  await b.close(); srv.close();
});
