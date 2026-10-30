// フィードバックを送信する（apps/guide/feedback/）の E2E。隔離エミュレーターで、本番の Firebase には接続しない。
// RULES=proposed: 提案したルールで「書けるが読めない」を確かめる。RULES=current: 今のルールのままだと読めてしまうことを確かめる。
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const WORK = process.env.FB_WORK;
if (!WORK) throw new Error('FB_WORK（作業フォルダ）を指定してね。README.md を参照');
const RULES = process.env.RULES || 'proposed';
const SITE = path.join(WORK, 'site');
const OUT = path.join(WORK, 'out');
const PORT = Number(process.env.E2E_PORT || 6601);
const BASE = `http://127.0.0.1:${PORT}/guide/feedback/`;
const DB = 'http://127.0.0.1:9602';
const NS = 'demo-roomk-fb';
fs.mkdirSync(OUT, { recursive: true });

const T = { pass: 0, failures: [], violations: [] };
function check(label, cond, detail) {
  if (cond) { T.pass += 1; return; }
  T.failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };
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
    method, headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return res.json();
}
function isProd(hostname) {
  return /(^|\.)firebaseio\.com$/.test(hostname) || /(^|\.)firebasedatabase\.app$/.test(hostname)
    || hostname === 'identitytoolkit.googleapis.com' || hostname === 'securetoken.googleapis.com'
    || /(^|\.)firebaseapp\.com$/.test(hostname);
}

// ブラウザの中で、匿名ユーザーとして読み書きを試す（規則どおり拒否されるかを見る）
const tryRef = async (page, op, p, value) => page.evaluate(async ({ op, p, value }) => {
  try {
    const ref = firebase.database().ref(p);
    if (op === 'read') { const s = await ref.once('value'); return { ok: true, val: s.val() }; }
    if (op === 'set') { await ref.set(value); return { ok: true }; }
    if (op === 'update') { await ref.update(value); return { ok: true }; }
    if (op === 'remove') { await ref.remove(); return { ok: true }; }
    if (op === 'push') { const r = await ref.push(value); return { ok: true, key: r.key }; }
  } catch (e) { return { ok: false, code: e.code || String(e) }; }
}, { op, p, value });

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  async function open(label, query, viewport) {
    const context = await browser.newContext({ viewport: viewport || { width: 1100, height: 900 } });
    await context.route('**/*', (route) => {
      const host = new URL(route.request().url()).hostname;
      if (isProd(host)) { T.violations.push(label + ' ' + route.request().url()); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(label + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(label + ' pageerror: ' + e.message));
    await page.goto(BASE + (query || ''));
    const emu = await page.evaluate(() => window.__EMU__);
    if (!emu || emu.projectId !== NS) throw new Error('エミュレーター設定になっていない: ' + JSON.stringify(emu));
    await page.waitForFunction(() => firebase.auth().currentUser != null, null, { timeout: 10000 });
    return page;
  }

  console.log(`[ルール: ${RULES}]`);
  // firebase.json 経由でルールが載らないことがあったので、作業フォルダの rules をテスト側から直接セットする
  const rulesText = fs.readFileSync(path.join(WORK, 'database.rules.json'), 'utf-8');
  await fetch(`${DB}/.settings/rules.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: rulesText });
  const loaded = await (await fetch(`${DB}/.settings/rules.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } })).json();
  check('ルールが載っている', (RULES === 'proposed') === !!(loaded.rules && loaded.rules.feedback), loaded);
  await rest('DELETE', 'feedback');

  // 1. ?app= で開くと、そのツールが選ばれている。知らない ID なら「どれでもない」
  const page = await open('A', '?app=reversi');
  check('?app=reversi で選ばれる', await page.$eval('#fb-app', (el) => el.value) === 'reversi');
  check('その他が初期の種類', await page.$eval('input[name="kind"]:checked', (el) => el.value) === 'other');
  const p2 = await open('A2', '?app=../../etc');
  check('知らない app は other', await p2.$eval('#fb-app', (el) => el.value) === 'other');
  await p2.context().close();

  // 2. 空のまま送るとトースト、保存されない
  await page.click('#fb-send');
  await page.waitForSelector('#roomk-toast');
  check('空で送れない', (await page.textContent('#roomk-toast')).includes('何があった？'));
  check('空では保存されない', (await rest('GET', 'feedback')) === null);

  // 3. 書いて送ると、feedback/ に4つの欄だけで入り、完了の表示になる
  check('初期の例文', (await page.getAttribute('#fb-text', 'placeholder')).includes('こんな遊び'));
  await page.click('input[name="kind"][value="bug"]');
  check('種類で例文が変わる', (await page.getAttribute('#fb-text', 'placeholder')).includes('待合室'));
  await page.fill('#fb-text', '待合室で「はじめる」を押しても進まなかった（スマホ・Safari）');
  check('文字数が出る', (await page.textContent('#fb-count')) === [...(await page.inputValue('#fb-text'))].length + ' / 300');
  await page.click('#fb-send');
  await page.waitForSelector('#done-card:not([hidden])');
  check('完了の表示', (await page.textContent('#done-card')).includes('送信しました'));
  check('フォームは隠れる', await page.$eval('#form-card', (el) => el.hidden));
  const all = await rest('GET', 'feedback');
  const ids = Object.keys(all || {});
  check('1件入る', ids.length === 1, all);
  const row = all[ids[0]];
  check('欄は4つだけ', JSON.stringify(Object.keys(row).sort()) === JSON.stringify(['app', 'at', 'kind', 'text']), row);
  check('app/kind/text', row.app === 'reversi' && row.kind === 'bug' && row.text.includes('はじめる'));
  check('at は数', typeof row.at === 'number' && row.at > 1.7e12);
  check('stats は sent だけ', JSON.stringify(await page.evaluate(() => window.__STATS__)) === '["sent"]');
  await page.screenshot({ path: path.join(OUT, `done-${RULES}.png`) });

  // 4. もう1件送る → フォームに戻り、空になっている
  await page.click('#fb-again');
  check('フォームに戻る', !(await page.$eval('#form-card', (el) => el.hidden)));
  check('本文は空', (await page.inputValue('#fb-text')) === '');

  // 5. ルール: 読めない・書き換えられない・消せない・欄を足せない・長すぎは書けない
  const r = await tryRef(page, 'read', 'feedback');
  const r1 = await tryRef(page, 'read', 'feedback/' + ids[0]);
  const upd = await tryRef(page, 'update', 'feedback/' + ids[0], { text: '書きかえ' });
  const rm = await tryRef(page, 'remove', 'feedback/' + ids[0]);
  const extra = await tryRef(page, 'push', 'feedback', { app: 'x', kind: 'bug', text: 'a', at: 1, uid: 'me' });
  const long = await tryRef(page, 'push', 'feedback', { app: 'x', kind: 'bug', text: 'あ'.repeat(301), at: 1 });
  const empty = await tryRef(page, 'push', 'feedback', { app: 'x', kind: 'bug', text: '', at: 1 });
  const nokind = await tryRef(page, 'push', 'feedback', { app: 'x', text: 'a', at: 1 });
  const strAt = await tryRef(page, 'push', 'feedback', { app: 'x', kind: 'bug', text: 'a', at: 'now' });
  const okOne = await tryRef(page, 'push', 'feedback', { app: 'x', kind: 'bug', text: 'a', at: 1 });
  if (RULES === 'proposed') {
    check('feedback/ は読めない', !r.ok && /permission/i.test(r.code), r);
    check('自分の1件も読めない', !r1.ok, r1);
    check('書きかえできない', !upd.ok, upd);
    check('消せない', !rm.ok, rm);
    check('欄を足せない', !extra.ok, extra);
    check('301字は書けない', !long.ok, long);
    check('空は書けない', !empty.ok, empty);
    check('kind なしは書けない', !nokind.ok, nokind);
    check('at が文字は書けない', !strAt.ok, strAt);
    check('正しい形は書ける', okOne.ok, okOne);
    const after = await rest('GET', 'feedback');
    check('サーバーには2件・本文はそのまま', Object.keys(after).length === 2 && after[ids[0]].text === row.text, after);
    // 別の匿名ユーザーでも読めない・消せない
    const other = await open('B', '?app=quiz');
    const rb = await tryRef(other, 'read', 'feedback/' + ids[0]);
    const rmb = await tryRef(other, 'remove', 'feedback/' + ids[0]);
    check('別の人も読めない', !rb.ok, rb);
    check('別の人も消せない', !rmb.ok, rmb);
    await other.context().close();
  } else {
    // 今のルールのままだと、ワイルドカードに当たって誰でも読める・消せる（提案の根拠）
    // $app_rooms/$roomId に当たるので、feedback/ 全体は読めないが、id を知っていれば1件ずつ読める・書き換えられる・消せる
    check('【今のルール】feedback/ 全体は読めない', !r.ok, r);
    check('【今のルール】id が分かれば読めてしまう', r1.ok && r1.val && r1.val.text === row.text, r1);
    check('【今のルール】書き換えられてしまう', upd.ok, upd);
    check('【今のルール】消せてしまう', rm.ok, rm);
    check('【今のルール】欄も長さも縛れない', extra.ok && long.ok && empty.ok, { extra, long, empty });
  }

  // 6. 375px でも横にはみ出さない
  const m = await open('M', '?app=daifugo', { width: 375, height: 740 });
  check('375px で横スクロールなし', await m.evaluate(() => document.documentElement.scrollWidth <= 375));
  await m.screenshot({ path: path.join(OUT, `mobile-${RULES}.png`), fullPage: true });
  await m.context().close();

  await page.context().close();
  await browser.close();
  server.close();
  const realErrors = errors.filter((e) => !/PERMISSION_DENIED|permission_denied/i.test(e));
  check('コンソールにエラーなし（権限拒否の意図した分を除く）', realErrors.length === 0, realErrors);
  check('本番あての通信なし', T.violations.length === 0, T.violations);
  console.log(`合格 ${T.pass} / 不合格 ${T.failures.length}`);
  if (T.failures.length) { console.log(T.failures); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
