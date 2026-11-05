// お絵描き伝言ゲーム: 形（丸・三角・四角）の道具のテスト（1つの画面だけ。Firebase にはつながない）
//
// Firebase の SDK を何もしない代わりのものに差し替え、描く回の状態を手で作って、
// キャンバスで形を引く → 保存されるデータ → 見る側の描きなおしが同じ絵になるか、を確かめる。
// 形はペンの線と同じ形式で保存するので、同期（ほかの画面への伝わり方）はこれまでの線と同じ。
//
//   node tests/oekaki-dengon/shapes.test.cjs [Playwright の場所] [スクリーンショットを置くフォルダ]
//
// Playwright の場所の既定は ~/.npm/_npx/31e32ef8478fbf80/node_modules/playwright（docs の E2E 手順と同じ）
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PW = process.argv[2] || path.join(os.homedir(), '.npm/_npx/31e32ef8478fbf80/node_modules/playwright');
const SHOT_DIR = process.argv[3] || null;
const { chromium } = require(PW);
const APPS = path.resolve(__dirname, '../../apps');
const PORT = 6721;

const FIREBASE_STUB = `(function () {
  function mk() {
    const f = function () { return mk(); };
    return new Proxy(f, {
      get(t, k) { if (k === 'then') return undefined; if (k === Symbol.toPrimitive) return () => ''; return mk(); },
      apply() { return mk(); },
    });
  }
  window.firebase = {
    initializeApp() {},
    auth() { return { signInAnonymously() { return new Promise(() => {}); }, onAuthStateChanged() {}, currentUser: null }; },
    database: Object.assign(function () { return mk(); }, { ServerValue: { TIMESTAMP: {} } }),
  };
}());`;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(APPS, u.endsWith('/') ? u + 'index.html' : u);
  if (!file.startsWith(APPS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log('  ok  ' + name); } else { fail += 1; console.log('  NG  ' + name + (detail ? '  ' + JSON.stringify(detail) : '')); }
}

async function setupDrawRound(page) {
  await page.evaluate(() => {
    window.__store = {};
    let seq = 0;
    const ref = (p) => ({
      child: (q) => ref(p ? p + '/' + q : q),
      push: () => ({ key: 'k' + String(++seq).padStart(6, '0') }),
      set: (v) => { window.__store[p] = v; return Promise.resolve(); },
      remove: () => { delete window.__store[p]; return Promise.resolve(); },
    });
    state.roomRef = ref('');
    state.play = Object.assign(newPlayState(), { key: '1:1', mid: 1, step: 1, chain: 0, type: 'draw', loaded: true });
    window.canEditNow = () => true;
    state.tool.mode = 'pen';
    showScreen('play');
    for (let el = $('work-draw'); el && el.id !== 'screen-play'; el = el.parentElement) el.hidden = false;
    paintStrokes(drawCanvas, [], null);
    renderToolState();
  });
}
// 論理座標（800×600）で引く
async function drag(page, from, to, steps = 8) {
  const box = await page.locator('#draw-canvas').boundingBox();
  const sx = box.width / 800;
  const sy = box.height / 600;
  await page.mouse.move(box.x + from[0] * sx, box.y + from[1] * sy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(box.x + (from[0] + (to[0] - from[0]) * t) * sx, box.y + (from[1] + (to[1] - from[1]) * t) * sy);
  }
  await page.mouse.up();
  await page.waitForTimeout(50);
}
const strokes = (page) => page.evaluate(() => Object.keys(window.__store).sort().map((k) => window.__store[k]));
const pixel = (page, x, y) => page.evaluate(([x, y]) => Array.from(ctx2d(drawCanvas).getImageData(x, y, 1, 1).data).slice(0, 3), [x, y]);
// 保存したデータだけから描いた絵（見る側と同じ描き方）と、手元のキャンバスがピクセルまで同じか
const sameAsViewer = (page) => page.evaluate(() => {
  const obj = {};
  Object.keys(window.__store).forEach((k) => { obj[k.split('/').pop()] = window.__store[k]; });
  const c = document.createElement('canvas');
  c.width = 800; c.height = 600;
  paintStrokes(c, decodeStrokeMap(obj), null);
  const a = ctx2d(c).getImageData(0, 0, 800, 600).data;
  const b = ctx2d(drawCanvas).getImageData(0, 0, 800, 600).data;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
  return diff;
});

(async () => {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch({ channel: 'chrome' });
  const errors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1000, height: 1100 } });
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      if (u.hostname === '127.0.0.1') {
        if (u.pathname.endsWith('/shared/js/stats.js')) return route.fulfill({ contentType: 'text/javascript', body: '' });
        return route.continue();
      }
      if (u.hostname === 'www.gstatic.com' && u.pathname.includes('firebase-app-compat')) return route.fulfill({ contentType: 'text/javascript', body: FIREBASE_STUB });
      if (u.hostname === 'www.gstatic.com' && u.pathname.includes('firebasejs')) return route.fulfill({ contentType: 'text/javascript', body: '' });
      if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://127.0.0.1:' + PORT + '/oekaki-dengon/');
    await page.waitForFunction(() => document.querySelectorAll('#tool-colors .oek-swatch').length === 13);
    await setupDrawRound(page);

    console.log('道具のボタン');
    for (const [id, label] of [['tool-circle', '丸'], ['tool-triangle', '三角'], ['tool-rect', '四角']]) {
      check(label + 'のボタンがある', await page.locator('#' + id).getAttribute('aria-label') === label);
    }
    check('道具と形が同じ行にある（どれか1つを選ぶものを1行にまとめる）', await page.evaluate(() =>
      $('tool-pen').closest('.oek-tools__row') === $('tool-rect').closest('.oek-tools__row')
      && $('tool-undo').closest('.oek-tools__row') === $('tool-widths').closest('.oek-tools__row')));
    await page.click('#tool-rect');
    check('四角を押すと四角が選ばれる', await page.locator('#tool-rect').getAttribute('aria-pressed') === 'true'
      && await page.locator('#tool-pen').getAttribute('aria-pressed') === 'false');
    await page.click('#tool-colors .oek-swatch >> nth=2');
    check('色を選んでも四角のまま', await page.evaluate(() => state.tool.mode) === 'rect');
    await page.click('#tool-tones .oek-tone >> nth=3');
    check('濃さを選んでも四角のまま', await page.evaluate(() => state.tool.mode) === 'rect');
    await page.click('#tool-rect');
    check('もう一度押すとペンに戻る', await page.evaluate(() => state.tool.mode) === 'pen');

    console.log('四角');
    await page.click('#tool-rect');
    await drag(page, [100, 100], [300, 250]);
    let st = await strokes(page);
    check('1本の線として保存される', st.length === 1, st);
    check('ペンの線と同じ形式（c・w・d・p だけ。f は無い）', st.length === 1
      && Object.keys(st[0]).sort().join(',') === 'c,d,p,w' && st[0].c === 2 && st[0].d === 1 && st[0].w === 1, st[0]);
    check('辺の上は線の色・中と外は白', JSON.stringify(await pixel(page, 200, 100)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 200, 175)) === '[255,255,255]'
      && JSON.stringify(await pixel(page, 50, 50)) === '[255,255,255]');
    check('角がとがっている（角のすぐ外側の 45°方向は白、角の上は線の色）', JSON.stringify(await pixel(page, 300, 100)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 306, 94)) === '[255,255,255]');
    check('保存したデータから描いた絵と同じ', await sameAsViewer(page) === 0);

    console.log('塗りつぶしで中を塗れる');
    await page.click('#tool-fill');
    await page.click('#tool-colors .oek-swatch >> nth=5');
    const box = await page.locator('#draw-canvas').boundingBox();
    await page.mouse.click(box.x + 200 * box.width / 800, box.y + 175 * box.height / 600);
    await page.waitForTimeout(50);
    check('中が塗られ、外は白のまま', JSON.stringify(await pixel(page, 200, 175)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 50, 50)) === '[255,255,255]'
      && JSON.stringify(await pixel(page, 400, 175)) === '[255,255,255]');
    check('塗ったあとも保存したデータから描いた絵と同じ', await sameAsViewer(page) === 0);

    console.log('丸・三角');
    await page.click('#tool-circle');
    await drag(page, [450, 80], [700, 280]);
    await page.click('#tool-triangle');
    await drag(page, [150, 320], [400, 560]);
    await page.click('#tool-triangle');
    await page.click('#tool-triangle');
    await drag(page, [500, 560], [700, 340]); // 下から上へ引くと、とがった角が下
    st = await strokes(page);
    check('丸と三角2つが足される（全部で5つ）', st.length === 5, st.length);
    const circlePts = st[2].p.length / 4;
    check('丸は点が 16〜97 個', circlePts >= 16 && circlePts <= 97, circlePts);
    check('丸: 楕円の上に線・中心は白', JSON.stringify(await pixel(page, 575, 80)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 700, 180)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 575, 180)) === '[255,255,255]');
    check('三角（上から下へ）: とがった角が上', JSON.stringify(await pixel(page, 275, 322)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 160, 330)) === '[255,255,255]'
      && JSON.stringify(await pixel(page, 275, 560)) !== '[255,255,255]');
    check('三角（下から上へ）: とがった角が下', JSON.stringify(await pixel(page, 600, 558)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 600, 340)) !== '[255,255,255]'
      && JSON.stringify(await pixel(page, 510, 550)) === '[255,255,255]');
    check('すべて保存したデータから描いた絵と同じ', await sameAsViewer(page) === 0);
    check('どの点も 0〜800 / 0〜600 の中', await page.evaluate(() => Object.values(window.__store)
      .every((v) => decodePoints(v.p).every(([x, y]) => x >= 0 && x <= 800 && y >= 0 && y <= 600))));

    console.log('置かない・はみ出す・戻す');
    await page.click('#tool-rect');
    await drag(page, [600, 450], [602, 452]);
    check('ほとんど動かさなかったときは置かない', (await strokes(page)).length === 5);
    check('置かなかったときは引き方を知らせる', await page.getByText('形は、キャンバスの上で引いて描くよ').isVisible());
    await drag(page, [700, 500], [900, 700]); // キャンバスの外まで引く
    st = await strokes(page);
    check('外まで引くと、キャンバスのふちまでの四角になる', st.length === 6
      && Math.max(...(await page.evaluate((p) => decodePoints(p).map(([x]) => x), st[5].p))) === 800, st[5]);
    await page.click('#tool-undo');
    check('「1つ戻す」で最後の形が消える', (await strokes(page)).length === 5 && await sameAsViewer(page) === 0);
    check('「1つ戻す」のあとも四角のまま', await page.evaluate(() => state.tool.mode) === 'rect');

    console.log('引いているあいだ');
    const prev = await page.evaluate(() => state.play.strokes.length);
    const b2 = await page.locator('#draw-canvas').boundingBox();
    await page.mouse.move(b2.x + 20 * b2.width / 800, b2.y + 20 * b2.height / 600);
    await page.mouse.down();
    await page.mouse.move(b2.x + 80 * b2.width / 800, b2.y + 70 * b2.height / 600);
    await page.waitForTimeout(80);
    check('引いているあいだは形が見える（まだ保存しない）', JSON.stringify(await pixel(page, 50, 20)) !== '[255,255,255]'
      && await page.evaluate(() => state.play.strokes.length) === prev);
    await page.mouse.move(b2.x + 40 * b2.width / 800, b2.y + 40 * b2.height / 600);
    await page.waitForTimeout(80);
    check('小さくすると前の形は残らない', JSON.stringify(await pixel(page, 60, 20)) === '[255,255,255]');
    await page.mouse.up();
    await page.waitForTimeout(50);
    check('はなすと保存される', (await strokes(page)).length === 6 && await sameAsViewer(page) === 0);

    console.log('次の回はペンから');
    await page.evaluate(() => { state.tool.mode = 'circle'; renderToolState(); });
    const resetsToPen = await page.evaluate(() => /state\.tool\.mode = 'pen'/.test(setupPlayStep.toString()));
    check('描く回が変わるとペンに戻す処理がある', resetsToPen);

    if (SHOT_DIR) {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      await page.evaluate(() => { state.tool.mode = 'rect'; renderToolState(); });
      await page.locator('#work-draw').screenshot({ path: path.join(SHOT_DIR, 'shapes-desktop.png') });
      await page.setViewportSize({ width: 375, height: 900 });
      await page.waitForTimeout(100);
      await page.locator('#work-draw').screenshot({ path: path.join(SHOT_DIR, 'shapes-375.png') });
      const rows = await page.evaluate(() => ({
        lines: Array.from(document.querySelectorAll('#work-draw .oek-tools__row')).map((r) =>
          new Set(Array.from(r.querySelectorAll('button')).map((b) => Math.round(b.getBoundingClientRect().top))).size),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        small: Array.from(document.querySelectorAll('#work-draw .oek-tools__row button')).filter((b) => {
          const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44;
        }).length,
      }));
      check('375px で道具と形・太さと戻す消すが、それぞれ1行に収まり、横にはみ出さない', rows.lines.every((n) => n === 1) && !rows.overflow, rows);
      check('375px でどのボタンも 44px 以上', rows.small === 0, rows);
    }
    check('コンソールにエラーが出ない', errors.length === 0, errors);
  } finally {
    await browser.close();
    server.close();
  }
  console.log('\n' + pass + ' ok / ' + fail + ' NG');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
