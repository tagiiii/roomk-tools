// キャリアすごろく E2E の共通部品（ローカルのエミュレーターだけに接続する。本番のホストへの通信は遮断）
const path = require('path');
const fs = require('fs');
const os = require('os');
// Playwright の場所は PW_PATH で指定する（例: npx のキャッシュの node_modules/playwright）。未指定なら通常の require で探す
const { chromium } = require(process.env.PW_PATH || 'playwright');

const BASE = process.env.CS_BASE || 'http://localhost:8090/apps/career-sugoroku/?emu=1&db=9100&auth=9199';
// スクリーンショットはリポジトリの外（一時フォルダ）に保存する
const SHOTS = process.env.CS_SHOTS || path.join(os.tmpdir(), 'career-sugoroku-shots');
fs.mkdirSync(SHOTS, { recursive: true });

const PROD_HOST = /(firebaseio\.com|firebasedatabase\.app)$|^(identitytoolkit|securetoken|firebaseinstallations)\.googleapis\.com$/;

async function launch() {
  return chromium.launch({ channel: 'chrome', headless: true });
}

async function newClient(browser, name, opts = {}) {
  const ctx = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: opts.reducedMotion || 'no-preference',
    isMobile: !!opts.mobile,
    hasTouch: !!opts.mobile,
  });
  const blocked = [];
  await ctx.route('**/*', (route) => {
    let host = '';
    try { host = new URL(route.request().url()).hostname; } catch (_) { /* noop */ }
    if (PROD_HOST.test(host)) { blocked.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') logs.push(`[${name}] ${t}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`[${name}] pageerror: ${e.message}`));
  await page.goto(BASE);
  await page.waitForFunction(() => window.CS_UI && window.CS_NET);
  // エミュレーター接続の確認（本番に接続していないこと）
  const emu = await page.evaluate(() => window.CS_NET.EMU);
  if (!emu) throw new Error('not in emulator mode');
  return { name, ctx, page, logs, blocked };
}

async function createRoom(c, name, plays) {
  await c.page.click('[data-act="goCreate"]');
  await c.page.fill('#create-name', name);
  if (!plays) await c.page.click('[data-act="createRole"][data-v="host"]');
  await c.page.click('#form-create [type=submit]');
  await c.page.waitForSelector('.cs-code__value', { timeout: 15000 });
  return (await c.page.textContent('.cs-code__value')).trim();
}

async function join(c, name, code, watch) {
  await c.page.click('[data-act="goJoin"]');
  await c.page.fill('#join-name', name);
  await c.page.fill('#join-code', code);
  if (watch) await c.page.click('[data-act="joinRole"][data-v="watch"]');
  await c.page.click('#join-submit');
  try {
    await c.page.waitForFunction(() => window.CS_UI.state.game, null, { timeout: 15000 });
  } catch (e) {
    const st = await c.page.evaluate(() => ({ screen: window.CS_UI.state.screen, session: window.CS_UI.state.session, err: document.getElementById('join-error').textContent, btn: document.getElementById('join-submit').disabled, busy: window.CS_UI.state.busy, connected: window.CS_UI.state.connected })).catch(() => null);
    throw new Error('join timeout: ' + JSON.stringify(st) + ' logs=' + c.logs.join(' | '));
  }
}

const game = (c) => c.page.evaluate(() => JSON.parse(JSON.stringify(window.CS_UI.state.game)));
const room = (c) => c.page.evaluate(() => JSON.parse(JSON.stringify(window.CS_UI.state.room)));

// 1手だけ画面の操作を進める（選択 → 確定の順。確定前の選択は乱数）
async function step(c, opts = {}) {
  return c.page.evaluate((o) => {
    const S = window.CS_UI && window.CS_UI.state;
    if (!S || !S.game) return null;
    if (document.body.classList.contains('cs-busy')) return 'busy';
    const vis = (el) => el && !el.disabled && el.getClientRects().length > 0;
    const qa = (sel) => Array.from(document.querySelectorAll(sel)).filter(vis);
    const click = (el, tag) => { el.click(); return tag; };
    const confirmBtn = document.querySelector('.cs-modal [data-act="confirmOk"]');
    if (confirmBtn) return o.allowConfirm ? click(confirmBtn, 'confirmOk') : null;
    if (document.querySelector('.cs-modal')) { document.querySelector('.cs-modal [data-act="closeModal"]').click(); return 'closeModal'; }
    const inv = qa('.cs-invite [data-act="respond"]');
    if (inv.length) return click(inv.find((b) => b.dataset.v === (o.accept === false ? '0' : '1')) || inv[0], 'respond');
    const direct = o.direct || ['roll', 'dealOk', 'chRoll', 'endTurn', 'fnPresent'];
    for (const act of direct) {
      const b = qa(`#stage [data-act="${act}"]`)[0];
      if (b) return click(b, act);
    }
    const choices = qa('#stage [data-act="sel"]');
    const groups = {};
    choices.forEach((ch) => { (groups[ch.dataset.key] = groups[ch.dataset.key] || []).push(ch); });
    for (const [key, list] of Object.entries(groups)) {
      if (!list.some((ch) => ch.getAttribute('aria-pressed') === 'true')) {
        const pick = o.first ? list[0] : list[Math.floor(Math.random() * list.length)];
        return click(pick, 'sel:' + key.split(':')[0]);
      }
    }
    const confirm = o.confirm || ['idealOk', 'goalOk', 'forkOk', 'actOk', 'partnerOk', 'chPick', 'rewardOk', 'crRoute', 'crAct', 'fnChoose'];
    for (const act of confirm) {
      const b = qa(`#stage [data-act="${act}"]`)[0];
      if (b) return click(b, act);
    }
    if (o.host) {
      for (const act of ['begin', 'reveal']) {
        const b = qa(`#stage [data-act="${act}"]:not([data-force])`)[0];
        if (b) return click(b, act);
      }
    }
    return null;
  }, opts);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(c, tag) {
  await c.page.evaluate(() => window.getSelection && window.getSelection().removeAllRanges());
  await c.page.screenshot({ path: path.join(SHOTS, `${tag}.png`) });
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

module.exports = { launch, newClient, createRoom, join, game, room, step, sleep, shot, assert, SHOTS, BASE };
