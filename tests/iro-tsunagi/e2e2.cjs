// いろつなぎ E2E その2（ルーム・対戦・みんなにみせる画面）。隔離した Firebase エミュレーターだけを使う（本番に接続しない）
// 使い方は README.md。IT_WORK（作業フォルダ）に apps の写しを作り、共通の rtdb-utils.js をエミュレーター向けに差し替えて配信する
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

(async () => {
  syncSite();
  const server = await startServer();
  browser = await chromium.launch({ channel: 'chrome' });

  // ---- 1. 作成・参加・待合室 ----
  const H = await newClient('host');
  await open(H);
  await H.page.click('#btnGoCreate');
  await H.page.fill('#hostName', 'ホスト');
  await H.page.click('#btnCreateRoom');
  check('R1 ルームを作ると待合室', await waitScreen(H, 'waiting'));
  const code = (await text(H, '#roomCodeLabel')).trim();
  check('R2 ルームコードは6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('R3 room-create を数える', (await stats(H, 'room-create')) === 1);
  check('R4 ルームのバー（コード・リンク・QR・みんなにみせる画面・ルームを閉じる）', await shown(H, '#btnCopyLink') && await shown(H, '#btnShowQr') && await shown(H, '#btnOpenWatch') && (await text(H, '#btnLeave')) === 'ルームを閉じる');

  const G = await newClient('guest');
  await open(G, 'room=' + code);
  check('R5 参加用のリンクで、コード入りの参加画面', await waitScreen(G, 'join') && (await G.page.inputValue('#joinCode')) === code && await shown(G, '#joinLinkHint'));
  await G.page.fill('#guestName', 'ゲスト');
  await G.page.click('#btnJoinRoom');
  check('R6 参加すると待合室', await waitScreen(G, 'waiting'));
  check('R7 ゲストには「ホストがはじめるのを待っているよ」と設定の要約', await shown(G, '#lobbyWait') && (await text(G, '#lobbySettings')).includes('点をくらべる'));
  check('R8 ホストの一覧に2人', await waitFor(async () => (await text(H, '#lobbyPeople')).includes('ゲスト')));
  check('R9 アドレスから ?room= が外れる', !(await G.page.evaluate(() => location.search)).includes('room='));

  // 名前の検査
  const G2 = await newClient('guest-dup');
  await open(G2, 'room=' + code);
  await G2.page.fill('#guestName', 'ゲスト');
  await G2.page.click('#btnJoinRoom');
  check('R10 同じ名前は入れない', await waitFor(async () => (await text(G2, '#joinError')).includes('使われている')));
  await G2.page.fill('#guestName', 'a.b');
  await G2.page.click('#btnJoinRoom');
  check('R11 記号の名前は理由を出す', (await text(G2, '#joinError')).includes('記号'));
  await G2.context.close();
  clients.splice(clients.indexOf(G2), 1);

  // 設定
  await openDetails(H);
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  check('R12 対戦にすると「盤がいっぱいになったら」と時間「なし」が出る', await shown(H, '#fsFull') && await shown(H, '#timeNone'));
  await H.page.click('label:has(input[name="roomMode"][value="score"])');
  await H.page.click('label:has(input[name="roomTime"][value="120"])');
  await H.page.click('label:has(input[name="roomColors"][value="3"])');
  check('R13 設定がルームに入る', await waitFor(async () => { const r = await roomOf(code); return r.settings && r.settings.mode === 'score' && r.settings.time === 120 && r.settings.colors === 3; }));
  check('R14 ゲストの要約も変わる', await waitFor(async () => (await text(G, '#lobbySettings')).includes('2分') && (await text(G, '#lobbySettings')).includes('3色')));

  await shot(H, 'room-waiting-host');
  await shot(G, 'room-waiting-guest');
  // ---- 2. 点をくらべる回 ----
  await H.page.click('#btnStartGame');
  check('R15 はじめるとカウントダウン', await waitFor(async () => (await screenIs(G, 'play')) && !(await G.page.evaluate(() => document.getElementById('countdown').hidden))));
  check('R16 start・players-2 を数える', await waitFor(async () => (await stats(H, 'start')) === 1 && (await stats(H, 'players-2')) === 1, 3000));
  check('R17 落ちはじめる（ホスト・ゲスト）', await waitPlaying(H) && await waitPlaying(G));
  const hp = (await st(H)).piece;
  const gp = (await st(G)).piece;
  check('R18 みんな同じ順番で玉が出る', hp.a === gp.a && hp.b === gp.b, { hp, gp });
  check('R19 のこり時間が出る', /^(2:00|1:5\d)$/.test(await text(G, '#timer')));
  check('R20 あそんでいる間はルームのバーを出さない', !(await shown(G, '#roomBar')));
  check('R21 ほかの人の盤（広い画面）', await shown(H, '#others .it-other'));
  await G.page.keyboard.press('Space');
  check('R22 置くと盤を送る', await waitFor(async () => { const r = await roomOf(code); return r.boards && r.boards['ゲスト'] && /[1-5]/.test(r.boards['ゲスト'].b || ''); }));
  await waitPieceTop(G);
  await G.page.keyboard.press('ArrowLeft');
  await G.page.keyboard.press('Space');
  await waitPieceTop(G);
  const before = await st(G);
  await G.page.reload();
  await G.page.waitForFunction(() => window.__iro);
  check('R23 読み込み直すと同じ回にもどる', await waitPlaying(G));
  const after = await st(G);
  check('R24 盤と出した数が同じ', JSON.stringify(after.board) === JSON.stringify(before.board) && after.taken === before.taken, { b: before.taken, a: after.taken });
  check('R25 つぎの玉も同じ順番', after.piece.a === before.piece.a && after.piece.b === before.piece.b);
  await shot(H, 'room-play-host');
  await H.page.click('#btnQuit');   // 早めにおわる（確認は受け入れる）
  check('R26 早めにおわると結果', await waitScreen(H, 'result', 9000) && await waitScreen(G, 'result', 9000));
  check('R27 結果に2人の順位と点', await waitFor(async () => { const t = await text(G, '#resultBody'); return t.includes('ホスト') && t.includes('ゲスト') && t.includes('1位') && t.includes('点'); }));
  await shot(G, 'room-result');
  check('R28 finish を数えるのは1回', (await stats(H, 'finish')) + (await stats(G, 'finish')) === 1);
  check('R29 ゲストには「もう一回はホストが選ぶよ」', await shown(G, '#resultWait') && !(await shown(G, '#btnAgain')));
  await H.page.click('#btnAgain');
  check('R30 もう一回で待合室', await waitScreen(H, 'waiting') && await waitScreen(G, 'waiting'));
  check('R31 回の記録を消す', await waitFor(async () => { const r = await roomOf(code); return !r.round && !r.boards && !r.result; }));

  // ---- 3. 対戦（じゃまを送る） ----
  await openDetails(H);
  await H.page.click('label:has(input[name="roomMode"][value="battle"])');
  await H.page.click('label:has(input[name="roomFull"][value="out"])');
  await H.page.click('label:has(input[name="roomTime"][value="0"])');
  await H.page.click('label:has(input[name="roomColors"][value="4"])');
  await waitFor(async () => { const r = await roomOf(code); return r.settings.mode === 'battle' && r.settings.time === 0 && r.settings.colors === 4; });
  await H.page.click('#btnStartGame');
  check('R32 対戦がはじまる', await waitPlaying(H) && await waitPlaying(G));
  check('R33 対戦では「来るじゃま」と「送ったじゃま」を出し、時間なしは、のこりを出さない', await shown(G, '#jamaBox') && (await text(G, '#scoreLabel')) === '送ったじゃま' && !(await shown(G, '#timer')));
  // ゲストのいまの玉を、ちがう2色（1 と 2）にする
  await waitPieceTop(G);
  await G.page.evaluate(() => window.__iro.setPiece(1, 2));
  const p = (await st(G)).piece;
  const others = [1, 2, 3, 4].filter((c) => c !== p.a && c !== p.b);
  const c1 = others[0];
  // まっすぐ落とすと、a が4つで消え（1れんさ）、上の b が落ちて右の b 3つとつながる（2れんさ）盤。右上の玉は全部消えないためのもの
  const rows = [
    `${p.a}....${c1}`,
    `${p.a}${p.a}.${p.b}${p.b}${p.b}`,
  ];
  const pre = await st(G);
  await G.page.evaluate((b) => window.__iro.setBoard(b), boardRows(rows));
  await G.page.keyboard.press('Space');
  await sleep(100);
  const post = await st(G);
  check('R34 2れんさが出る', await waitFor(async () => (await text(G, '#chainText')).includes('2れんさ'), 4000));
  check('R35 送ったじゃま 3こ（2れんさ）', await waitFor(async () => (await st(G)).sent === 3), { sent: (await st(G)).sent, p, prePiece: pre.piece, preMode: pre.mode, postMode: post.mode, post: post.board.map((r) => r.join('')).join('/') });
  check('R36 ホストの「来るじゃま」が3になる', await waitFor(async () => (await st(H)).pending === 3), (await st(H)).pending);
  check('R37 ルームの盤に来るじゃまを書く', await waitFor(async () => { const r = await roomOf(code); return r.boards && r.boards['ホスト'] && r.boards['ホスト'].pending === 3; }));
  await waitPieceTop(H);
  await H.page.keyboard.press('Space');
  check('R38 置くと、じゃまの玉が落ちてくる', await waitFor(async () => { const v = await st(H); return v.pending === 0 && v.board.flat().filter((x) => x === E.JAMA).length === 3; }), await st(H));
  await shot(H, 'room-battle-host');
  // ホストの盤をいっぱいにして「ここまで」にする
  await waitPieceTop(H);
  const tall = [];
  for (let y = 1; y < E.H; y++) tall.push('..' + (y % 2 ? '1' : '2') + '...');
  await H.page.evaluate((b) => window.__iro.setBoard(b), boardRows(tall));
  await H.page.keyboard.press('Space');
  check('R39 いっぱいになると「ここまで」', await waitFor(async () => (await st(H)).out && (await text(H, '#overlayText')).includes('ここまで')));
  check('R40 のこりが1人になると結果', await waitScreen(G, 'result', 8000));
  const rt = await text(G, '#resultBody');
  check('R41 のこった人が1位、ここまでの人が2位', /1位ゲスト/.test(rt.replace(/\s/g, '')) && rt.includes('ここまで') && rt.includes('のこった'), rt);
  await H.page.click('#btnAgain');
  await waitScreen(H, 'waiting');

  // ---- 4. ホストは見るだけ・みんなにみせる画面 ----
  await H.page.click('#hostPlays');   // 外す
  check('R42 「ホストもあそぶ」を外すと一覧に印', await waitFor(async () => (await text(G, '#lobbyPeople')).includes('あそぶ人の盤を見る')));
  const W = await newClient('watch', { width: 1280, height: 800 });
  await open(W, 'watch=' + code);
  check('R43 みんなにみせる画面は待合室で参加のしかたとコード', await waitFor(async () => (await shown(W, '#lobbyJoin')) && (await text(W, '#lobbyJoinCode')) === code));
  check('R44 みんなにみせる画面はルームに入らない', await waitFor(async () => Object.keys((await roomOf(code)).players).length === 2));
  await openDetails(H);
  await H.page.click('label:has(input[name="roomMode"][value="score"])');
  await sleep(300);
  await H.page.click('#btnStartGame');
  check('R45 ホストはあそぶ人の盤を見る画面', await waitScreen(H, 'watch'));
  check('R46 みんなにみせる画面も盤をならべる', await waitScreen(W, 'watch') && await waitFor(async () => (await W.page.$$('#watchGrid .it-wboard')).length === 1));
  check('R47 回の人はゲストだけ', await waitFor(async () => { const r = await roomOf(code); return r.round && r.round.players.length === 1 && r.round.players[0] === 'ゲスト'; }));
  await waitPlaying(G);
  await G.page.keyboard.press('Space');
  check('R48 みんなにみせる画面に盤が出る', await waitFor(async () => (await text(W, '#watchGrid')).includes('点')));
  await shot(W, 'room-watch');
  await H.page.click('#btnWatchEnd');
  check('R49 結果がみんなにみせる画面にも出る', await waitScreen(W, 'result', 8000));
  await H.page.click('#btnAgain');
  await waitScreen(G, 'waiting');

  // ---- 5. 375px・退出・ルームを閉じる ----
  await G.page.setViewportSize({ width: 375, height: 812 });
  check('R50 375px の待合室は横にはみ出さない', (await G.page.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await H.page.click('#hostPlays');   // もどす
  await sleep(300);
  await H.page.click('#btnStartGame');
  await waitPlaying(G);
  check('R51 375px ではほかの人を一覧で出す', await shown(G, '#othersList li') && !(await shown(G, '#others')));
  check('R52 375px のあそぶ画面は横にはみ出さない', (await G.page.evaluate(() => document.documentElement.scrollWidth)) <= 375);
  await shot(G, 'room-play-375');
  await H.page.click('#btnQuit');
  await waitScreen(G, 'result', 8000);
  await G.page.click('#btnLeave');
  check('R53 ゲストが退出するとトップ', await waitScreen(G, 'top'));
  check('R54 退出した人は在室から消える', await waitFor(async () => !(await roomOf(code)).players['ゲスト']));
  const G3 = await newClient('guest3');
  await open(G3, 'room=' + code);
  await G3.page.fill('#guestName', 'さんにんめ');
  await G3.page.click('#btnJoinRoom');
  await waitScreen(G3, 'waiting');
  await H.page.click('#btnLeave');
  check('R55 ルームを閉じると参加者はトップ', await waitScreen(G3, 'top') && await waitScreen(H, 'top'));
  check('R56 ルームが消える', await waitFor(async () => (await roomOf(code)) === null));
  check('R57 みんなにみせる画面は「閉じられました」', await waitFor(async () => (await text(W, '#watchEndTitle')).includes('閉じられました')));

  for (const c of clients) check('console errors: ' + c.label, c.errors.length === 0, c.errors.slice(0, 5));
  check('本番に接続しない', T.violations.length === 0, T.violations.slice(0, 5));
  await browser.close();
  server.close();
  console.log(`\n${T.pass} 合格 / ${T.failures.length} NG`);
  console.log('写真: ' + OUT);
  process.exit(T.failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

function shot(c, name) { return c.page.screenshot({ path: path.join(OUT, name + '.png') }); }
