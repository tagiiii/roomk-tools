// キャリアすごろく E2E の共通部品（ローカルのエミュレーターだけに接続する。本番のホストへの通信は遮断）
'use strict';
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
    reducedMotion: opts.reducedMotion || 'reduce',
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
  if (!(await page.evaluate(() => window.CS_NET.EMU))) throw new Error('not in emulator mode');
  return { name, ctx, page, logs, blocked };
}

async function createRoom(c, name, plays, opts = {}) {
  await c.page.click('#cs-go-create');
  if (name) await c.page.fill('#cs-host-name', name);
  if (plays) await c.page.check('#cs-host-plays');
  if (opts.dice === 1) await c.page.check('input[name="cs-room-dice"][value="1"]');
  await c.page.click('#cs-create-room');
  await c.page.waitForFunction(() => { const s = window.CS_UI.state; return s.room && s.room.meta && s.room.meta.hostConnected === true && !document.getElementById('cs-lobby').hidden; }, null, { timeout: 20000 });
  return (await c.page.textContent('#cs-lobby-code')).trim();
}

async function join(c, name, code) {
  await c.page.click('#cs-go-join');
  await c.page.fill('#cs-join-name', name);
  await c.page.fill('#cs-join-code', code);
  await c.page.click('#cs-join-room');
  await c.page.waitForFunction(() => { const s = window.CS_UI.state; return (s.room && !document.getElementById('cs-lobby').hidden) || !document.getElementById('cs-join-error').hidden; }, null, { timeout: 20000 });
  const err = await c.page.evaluate(() => { const e = document.getElementById('cs-join-error'); return e.hidden ? '' : e.textContent; });
  return err;
}

const ui = (c) => c.page.evaluate(() => {
  const s = window.CS_UI.state;
  return JSON.parse(JSON.stringify({ S: s.S, mode: s.mode, sess: s.sess, room: s.room, busy: s.busy, sending: s.sending, myPid: s.myPid, host: s.host, proxyTurn: s.proxyTurn, onlineTurn: s.onlineTurn }));
});
const screen = (c) => c.page.evaluate(() => ['top', 'setup', 'create', 'join', 'lobby', 'play', 'results'].find((k) => !document.getElementById('cs-' + k).hidden) || null);

// 1手だけ画面の操作を進める。押せるボタンがあれば押す（ミニゲームは自分の行に答える）。
// hostProxyOnly: ホストは、端末のない人・つながっていない人の番だけ押す（ほかの人の番は本人の端末に任せる）
async function step(c, opts = {}) {
  return c.page.evaluate((o) => {
    const U = window.CS_UI.state;
    // 動きの途中の「イベント（○マス進む）」のカードは、OK を押して進める
    if (U.busy && !document.getElementById('cs-card-layer').hidden) {
      const ok = document.querySelector('#cs-card [data-primary]');
      if (ok && !ok.disabled) { ok.click(); return 'reveal'; }
    }
    if (!U.S || U.busy || U.sending) return 'wait';
    if (!document.getElementById('cs-modal').hidden) { document.getElementById('cs-modal-close').click(); return 'closeModal'; }
    const vis = (el) => el && !el.disabled && el.getClientRects().length > 0;
    const card = document.getElementById('cs-card');
    const layerOpen = !document.getElementById('cs-card-layer').hidden;
    // ミニゲーム: 自分が押せる行で、まだ答えていない行に答える
    if (layerOpen) {
      const groups = Array.from(card.querySelectorAll('.cs-mini__opts')).filter((g) => g.querySelector('.cs-mini__opt'));
      for (const g of groups) {
        if (!g.querySelector('.cs-mini__opt[aria-pressed="true"]')) {
          const bs = Array.from(g.querySelectorAll('.cs-mini__opt')).filter(vis);
          if (bs.length) { bs[Math.floor(Math.random() * bs.length)].click(); return 'answer'; }
        }
      }
    }
    const hostOthersTurn = U.host && U.myPid !== U.S.cur && !U.proxyTurn && U.onlineTurn;
    if (o.hostProxyOnly && hostOthersTurn) return null;
    if (o.ownOnly && U.myPid !== U.S.cur) return null; // 自分の番だけ押す（ホストでも代わりに押さない）
    if (layerOpen) {
      const nums = Array.from(card.querySelectorAll('[data-num]')).filter(vis);
      if (nums.length) { nums[Math.floor(Math.random() * nums.length)].click(); return 'choice'; }
      const prim = Array.from(card.querySelectorAll('[data-primary]')).filter(vis)[0];
      if (prim) { prim.click(); return 'primary'; }
      return null;
    }
    const roll = Array.from(document.querySelectorAll('#cs-turn [data-primary]')).filter(vis)[0];
    if (roll) { roll.click(); return 'roll'; }
    return null;
  }, opts);
}

// ほかの人の番のとき、自分のカードのボタンが止まっているか（止まっていない選択肢の数）
const unlockedForOthers = (c) => c.page.evaluate(() => {
  const U = window.CS_UI.state;
  if (!U.S || U.busy || U.host || U.myPid === U.S.cur) return 0;
  if (document.getElementById('cs-card-layer').hidden) {
    return Array.from(document.querySelectorAll('#cs-turn [data-primary]')).filter((b) => !b.disabled).length;
  }
  if (U.S.step && U.S.step.kind === 'mini') return 0; // ミニゲームは各自の行を押せる
  return Array.from(document.querySelectorAll('#cs-card [data-num], #cs-card [data-primary]')).filter((b) => !b.disabled).length;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(c, tag) {
  await c.page.evaluate(() => window.getSelection && window.getSelection().removeAllRanges());
  await c.page.screenshot({ path: path.join(SHOTS, `${tag}.png`) });
}

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT: ' + msg);
}

// 想定どおりのコンソールの警告（オフラインにしたときの通信エラー）を除く
const realErrors = (logs) => logs.filter((l) => !/ERR_INTERNET_DISCONNECTED|net::ERR_FAILED|WebSocket connection/.test(l));

module.exports = { launch, newClient, createRoom, join, ui, screen, step, unlockedForOthers, sleep, shot, assert, realErrors, SHOTS, BASE };
