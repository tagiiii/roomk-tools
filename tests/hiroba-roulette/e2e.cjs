// なにするルーレットのルーム（進行役＋参加する人2人）の E2E。隔離エミュレーターだけを使い、本番の Firebase には接続しない。
// 使い方は README.md。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORK = process.env.HR_WORK;
if (!WORK) throw new Error('HR_WORK（作業フォルダ）を指定してね');
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6651);
const BASE = `http://127.0.0.1:${PORT}/hiroba-roulette/`;
const HOST_URL = BASE + '?date=2026-11-16&t=13:05';
const DB = 'http://127.0.0.1:9652';
const NS = 'demo-roomk-hr';
const ROOMS = 'hirobaroulette_rooms';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [], errors: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; console.log('  ok ' + label); return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
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
async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  let v;
  while (Date.now() < end) { try { v = await fn(); if (v) return v; } catch {} await sleep(100); }
  return v;
}
function isProd(host) {
  return /(^|\.)firebaseio\.com$/.test(host) || /(^|\.)firebasedatabase\.app$/.test(host) || host === 'identitytoolkit.googleapis.com' || host === 'securetoken.googleapis.com' || /(^|\.)firebaseapp\.com$/.test(host) || /katariba\.notion\.site$/.test(host);
}

let browser;
async function client(label, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1600, height: 900 }, ...(opts.mobile ? { isMobile: true, hasTouch: true } : {}) });
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (isProd(host)) { if (!/notion/.test(host)) T.violations.push(label + ' ' + route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => T.errors.push(label + ' pageerror ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|status of 404|ERR_BLOCKED/.test(m.text())) T.errors.push(label + ' console ' + m.text()); });
  page.on('dialog', (d) => d.accept());
  return { context, page };
}

async function main() {
  // ルールを明示的に読み込ませる（hirobaroulette_rooms がルールにあるかも確かめる）
  const rules = fs.readFileSync(path.join(WORK, 'database.rules.json'), 'utf8');
  await fetch(`${DB}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: rules });
  const server = await startServer();
  browser = await chromium.launch({ channel: 'chrome' });
  try {
    const H = await client('host');
    const host = H.page;
    await host.goto(HOST_URL);
    await host.waitForTimeout(1500);
    check('ルームを作る前は通信していない（Firebase を初期化していない）', await host.evaluate(() => firebase.apps.length === 0));
    await host.click('#btnRoom');
    const code = await until(() => host.$eval('#roomChipCode', (e) => e.textContent.trim()).then((t) => /^[A-Z2-9]{6}$/.test(t) && t));
    check('ルームのコードが共有画面に出る', !!code, code);
    const room0 = await roomOf(code);
    check('ルームに段・お題・候補8つが入る', room0 && room0.view === 'intro' && room0.topic && Array.isArray(room0.cands) && room0.cands.length === 8, room0 && { view: room0.view, n: room0.cands && room0.cands.length });

    const A = await client('sora', { viewport: { width: 390, height: 844 }, mobile: true });
    const B = await client('midori', { viewport: { width: 390, height: 844 }, mobile: true });
    for (const [c, name] of [[A, 'そら'], [B, 'みどり']]) {
      await c.page.goto(BASE + '?room=' + code);
      await c.page.waitForSelector('#guestName');
      check(name + ': リンクからひらくとコードが入っている', (await c.page.inputValue('#joinCode')) === code);
      await c.page.fill('#guestName', name);
      await c.page.click('#btnJoinRoom');
    }
    await until(async () => Object.keys((await roomOf(code)).players || {}).length === 2);
    check('2人が参加した', Object.keys((await roomOf(code)).players || {}).length === 2);
    check('参加した人には「プログラムを見ている」が出る', await until(() => A.page.textContent('#guRoom').then((t) => t.includes('プログラムを見ている'))));
    check('人数の表示が2人', await until(() => host.textContent('#roomChipCount').then((t) => t.includes('2人'))));

    // 2段目: 過ごし方
    await host.keyboard.press('Enter');
    await until(() => A.page.textContent('#guRoom').then((t) => t.includes('どう過ごしたい')));
    await A.page.click('#guRoom .gu-opt:has-text("みんなと遊ぶ")');
    await B.page.click('#guRoom .gu-opt:has-text("おまかせ")');
    const sgCount = (label) => host.$eval(`#sgGrid .sg[aria-label*="${label}"] .tokens`, (e) => e.children.length);
    check('端末で選んだ過ごし方が共有画面の丸に入る', await until(async () => (await sgCount('みんなと遊ぶ')) === 1 && (await sgCount('おまかせ')) === 1));
    await host.keyboard.press('2');
    check('進行役が押した分も足される', await until(async () => (await sgCount('みんなと遊ぶ')) === 2));
    const mem = await host.textContent('#members');
    check('参加者の一覧に名前が出る', mem.includes('そら') && mem.includes('みどり'), mem);
    const sgText = await host.textContent('#sgGrid');
    check('過ごし方の札にだれの分かは出ない', !sgText.includes('そら') && !sgText.includes('みどり'));
    check('選んだ人に印が付く', await until(() => host.$$eval('#members .mb.done', (a) => a.length).then((n) => n === 2)));
    await A.page.click('#guRoom .gu-opt:has-text("みんなと遊ぶ")');
    check('もう一度押すと取り消せる', await until(async () => (await sgCount('みんなと遊ぶ')) === 1));
    await A.page.click('#guRoom .gu-opt:has-text("みんなと遊ぶ")');
    await until(async () => (await sgCount('みんなと遊ぶ')) === 2);

    // 3段目: ゲーム
    await host.keyboard.press('Enter');
    check('参加する人に候補が8つ出る', await until(() => A.page.$$eval('#guRoom .gu-opts .gu-opt', (a) => a.length).then((n) => n === 8)));
    check('3段目の人数は「みんなと遊ぶ」「おまかせ」＋進行役', (await host.textContent('#pplText')).trim() === '4人', await host.textContent('#pplText'));
    const firstName = await A.page.$eval('#guRoom .gu-opts .gu-opt span:last-child', (e) => e.textContent);
    await A.page.click('#guRoom .gu-opts .gu-opt >> nth=0');
    const tok = (id) => host.$eval(`#grid .gm[data-id="${id}"] .tokens`, (e) => e.children.length).catch(() => -1);
    const room1 = await roomOf(code);
    const firstId = room1.cands[0].id;
    check('端末で選んだゲームが共有画面の丸に入る', await until(async () => (await tok(firstId)) === 1), firstName);
    // みどりは候補にないゲームをさがして選ぶ
    const candIds = room1.cands.map((c) => c.id);
    const target = ['shogi', 'mahjong', 'reversi', 'mancala', 'daifugo', 'blackjack'].find((id) => !candIds.includes(id));
    const words = { shogi: 'しょうぎ', mahjong: 'まーじゃん', reversi: 'リバーシ', mancala: 'マンカラ', daifugo: 'だいふごう', blackjack: 'ブラック' };
    await B.page.fill('#guFind', words[target]);
    await B.page.click('#guRoom .gu-hits .gu-opt >> nth=0');
    check('候補にないゲームを選ぶと、共有画面の候補に入って丸が付く', await until(async () => (await tok(target)) === 1), target);
    check('参加する人の候補にも入る', await until(async () => (await roomOf(code)).cands.some((c) => c.id === target)));
    const grid = await host.textContent('#grid') + await host.textContent('#pickedList');
    check('ゲームの札・えらばれたゲームにだれの分かは出ない', !grid.includes('そら') && !grid.includes('みどり'));
    await host.screenshot({ path: path.join(OUT, 'host-ask.png') });
    await B.page.screenshot({ path: path.join(OUT, 'guest-ask.png') });

    // 進行役の読み込み直し → 同じルームに戻り、数ももどる
    await host.reload();
    check('進行役が読み込み直しても同じルームに戻る', await until(() => host.$eval('#roomChipCode', (e) => e.textContent.trim()).then((t) => t === code), 10000));
    check('読み込み直したあとも3段目・数がもどる', await until(async () => (await host.evaluate(() => document.body.dataset.view)) === 'ask' && (await tok(firstId)) === 1 && (await tok(target)) === 1, 10000));

    // ルーレット
    await host.mouse.move(800, 450);
    await host.keyboard.press('Enter');
    await until(() => A.page.textContent('#guRoom').then((t) => t.includes('ルーレット')));
    await host.keyboard.press(' ');
    const won = await until(() => host.$eval('#result.show #resultName', (e) => e.textContent).catch(() => ''), 8000);
    check('ルーレットで決まる', !!won, won);
    check('参加する人の画面にも決まったものが出る', await until(() => A.page.textContent('#guRoom').then((t) => t.includes('決まり') && t.includes(won))), won);
    await A.page.screenshot({ path: path.join(OUT, 'guest-result.png') });

    // 参加する人の退出
    await B.page.click('#btnGuLeave');
    check('退出すると在室が消える', await until(async () => !(await roomOf(code)).players?.['みどり']));
    check('退出した人は参加の画面にもどる', await until(() => B.page.isVisible('#guJoin')));

    // 進行役の切断 → 参加する人に待つお知らせ
    await H.context.setOffline(true);
    check('進行役が切れると、待つお知らせが出る', await until(() => A.page.isVisible('#hostOffOverlay'), 90000));
    await H.context.setOffline(false);
    check('進行役がもどると、お知らせが消える', await until(async () => !(await A.page.isVisible('#hostOffOverlay')), 30000));

    // ルームを閉じる
    await host.mouse.move(800, 450);
    await host.click('#btnCloseRoom');
    check('ルームを閉じると、ルームが消える', await until(async () => (await roomOf(code)) === null));
    check('参加する人は参加の画面にもどる', await until(() => A.page.isVisible('#guJoin')));
    check('閉じたあと、ルームのボタンが「ルームを作る」にもどる', await until(() => host.isVisible('#btnRoom')));

    // 端末なし（ルームを作らない）でも、これまでどおり押して決められる
    const N = await client('noroom');
    await N.page.goto(HOST_URL);
    await N.page.waitForTimeout(1500);
    await N.page.keyboard.press('Enter'); await N.page.keyboard.press('Enter');
    await N.page.waitForTimeout(300);
    await N.page.keyboard.press('Enter');   // だれも選ばずにルーレットへ（おまかせ）
    await N.page.waitForTimeout(300);
    const segs = await N.page.$$eval('#wheelG path', (a) => a.length);
    check('だれも選ばないときは候補を同じ大きさで入れる', segs >= 2, segs);
    await N.page.keyboard.press(' ');
    check('ルームなしでもルーレットで決まる', !!(await until(() => N.page.$eval('#result.show #resultName', (e) => e.textContent).catch(() => ''), 8000)));
    check('ルームなしの画面は通信していない', await N.page.evaluate(() => firebase.apps.length === 0));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\npass ${T.pass} / fail ${T.failures.length}`);
  if (T.violations.length) console.log('PROD ACCESS', T.violations);
  if (T.errors.length) console.log('ERRORS', T.errors);
  process.exit(T.failures.length || T.violations.length || T.errors.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
