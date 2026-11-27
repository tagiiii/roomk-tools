// 効果音の検査（1つの画面だけ。エミュレーターも Java も使わない。memdb.cjs）。
// はじめは切で音の部品を作らない・「入」で鳴る・鳴る所（時計・操作・解除・まちがい・導火線・爆発・解除成功）・
// 終わったあとは時計が鳴らない・設定が端末に残る・「切」で止まる・みんなにみせる画面でも入にできる
// 使い方: PLAYWRIGHT=（playwright のフォルダ） node tests/torisetsu-kaijo/sound.cjs
const M = require('./memdb.cjs');
const { E, sleep } = M;

let pass = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { pass += 1; return; }
  failures.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
// 音の部品（AudioContext）が作られた回数を数える
const countAudio = (page) => page.addInitScript(() => {
  window.__audioMade = 0;
  ['AudioContext', 'webkitAudioContext'].forEach((name) => {
    const Original = window[name];
    if (!Original) return;
    window[name] = function (...args) { window.__audioMade += 1; return new Original(...args); };
  });
});
const made = (page) => page.evaluate(() => window.__audioMade);
const log = (page) => page.evaluate(() => window.__tk.sfx.log.slice());
const clearLog = (page) => page.evaluate(() => { window.__tk.sfx.log.length = 0; });
const count = (list, name) => list.filter((n) => n === name).length;
const segOn = (page, box) => page.evaluate((sel) => document.querySelector(sel + ' .tk-seg__btn.is-on')?.textContent, box);
const LOBBY = '#screen-waiting [data-sfx-seg]';
const GAME = '#screen-game [data-sfx-seg]';
const pickSfx = (page, box, label) => page.locator(box + ' .tk-seg__btn', { hasText: label }).click();
async function waitLog(page, name, timeout = 4000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if ((await log(page)).includes(name)) return true; await sleep(50); }
  return false;
}
// 表にコード・記号がならび、導火線のある爆弾
function pickSeed() {
  for (let seed = 1; seed < 5000; seed++) {
    const bomb = E.makeBomb(seed, 'normal', false);
    if (bomb.slots[0]?.type === 'cord' && bomb.slots[1]?.type === 'glyph' && bomb.fuse) return seed;
  }
  throw new Error('seed not found');
}
async function zoom(page, slot) {
  if (await page.locator('#zoom').isVisible()) await page.click('#btnZoomBack');
  await page.evaluate((back) => window.__tk.cube.showFace(back ? 'back' : 'front'), slot >= 3);
  await sleep(600);
  await page.click(`.tk-slot[data-slot="${slot}"]`);
  await page.waitForSelector('#zoomBody .tk-mod--big');
}
const press = (page, a) => page.click(`#zoomBody [data-a="${a}"]`);
const gameNow = async (page) => { const g = await M.readDb(page, 'game'); return { raw: g, G: E.fromRoom(g) }; };
const waitGame = (page, fn, arg) => page.waitForFunction(fn, [M.ROOM, arg]);
// 正しい操作で、しかけを1つ解除する
async function solve(page, bomb, slot) {
  const mod = bomb.slots[slot];
  const st = ((await gameNow(page)).G.m || {})[E.keyOf(slot)] || {};
  await zoom(page, slot);
  if (mod.type === 'cord') await press(page, 'cut:' + mod.sol);
  else if (mod.type === 'glyph') {
    for (let i = 0; i < 4; i++) if (!!((st.b || 0) & (1 << i)) !== mod.sol[i]) await press(page, 'tog:' + i);
    await press(page, 'chk:');
  } else if (mod.type === 'dial') {
    let pos = st.p || mod.start;
    while (pos !== mod.sol) { await press(page, 'turn:1'); pos = (pos % 8) + 1; }
    await press(page, 'chk:');
  } else {
    for (const d of mod.sol.slice(st.p || 0)) await press(page, 'dir:' + d);
  }
  await waitGame(page, ([room, key]) => window.__shotdb.read(room + '/game/ok/' + key) === true, E.keyOf(slot));
}

(async () => {
  const seed = pickSeed();
  const bomb = E.makeBomb(seed, 'normal', false);
  const server = await M.startServer();
  const { browser, context, page, bad, errors } = await M.openBrowser();
  await countAudio(page);
  await M.joinAsSora(page);

  // ── はじめは切 ──
  check('lobby seg off', (await segOn(page, LOBBY)) === '切');
  check('no audio at start', (await made(page)) === 0);
  // 導火線に火がつかないよう、はじめた時刻をいまにしておく
  await M.putGame(page, 1, seed, 'normal', E.newState('normal', false, Date.now()));
  check('game seg off', (await segOn(page, GAME)) === '切');
  await solve(page, bomb, 0);
  await sleep(1300);
  check('off: nothing played', (await log(page)).length === 0, await log(page));
  check('off: no audio made', (await made(page)) === 0);

  // ── 入にする ──
  if (await page.locator('#zoom').isVisible()) await page.click('#btnZoomBack');
  await pickSfx(page, GAME, '入');
  check('on: audio made once', (await made(page)) === 1);
  check('on: sample played', await waitLog(page, 'solved'));
  check('on: saved', (await page.evaluate(() => localStorage.getItem('torisetsukaijo:sfx'))) === '1');
  check('on: both segs', (await segOn(page, GAME)) === '入' && (await page.evaluate((sel) => document.querySelector(sel + ' .tk-seg__btn.is-on')?.textContent, LOBBY)) === '入');
  check('audio running', (await page.evaluate(() => window.__tk.sfx.ac.state)) === 'running');
  await clearLog(page);
  await sleep(2300);
  let l = await log(page);
  check('tick each second', count(l, 'tick') >= 2 && count(l, 'tick') <= 3 && count(l, 'hurry') === 0, l);

  // ── 操作・まちがい ──
  await clearLog(page);
  await zoom(page, 1);
  await press(page, 'tog:0');
  check('press sound', await waitLog(page, 'press'));
  // ちがうまま「たしかめる」→ まちがい
  const g1 = bomb.slots[1];
  const bits = (((await gameNow(page)).G.m || {}).s1 || {}).b || 0;
  if (g1.sol.every((up, i) => !!(bits & (1 << i)) === up)) await press(page, 'tog:1');
  await press(page, 'chk:');
  check('strike sound', await waitLog(page, 'strike'));
  check('strike: no boom yet', !(await log(page)).includes('boom'));
  await sleep(900);

  // ── 新しい回: コードを切る・解除・導火線 ──
  await M.putGame(page, 2, seed, 'normal', E.newState('normal', false, Date.now() - 28500));
  await clearLog(page);
  check('fuse lit sound', await waitLog(page, 'fuse', 5000));
  await page.click('#btnFuseGo');
  await page.waitForSelector('#zoomBody .tk-mod--fuse');
  const f = E.fuseInfo(bomb, (await gameNow(page)).G, Date.now());
  await press(page, 'knob:' + E.FUSE_TABLE[f.flame][bomb.clues.mark]);
  check('fuse stopped sound', await waitLog(page, 'fuseok'));
  check('fuse: no strike', !(await log(page)).includes('strike'));
  await clearLog(page);
  await solve(page, bomb, 0);
  check('cut sound', await waitLog(page, 'cut'));
  check('solved sound', await waitLog(page, 'solved'));

  // ── のこり30秒から ──
  {
    const cur = await gameNow(page);
    cur.G.t = { ...cur.G.t, left: 20000, at: Date.now() };
    cur.G.startAt = Date.now();   // 導火線は遠ざける
    await M.writeDb(page, 'game', { ...cur.raw, ...E.toRoom(cur.G) });
    await clearLog(page);
    await sleep(2300);
    l = await log(page);
    check('hurry ticks', count(l, 'hurry') >= 2 && count(l, 'tick') <= 1, l);
  }

  // ── 解除成功 ──
  {
    const cur = await gameNow(page);
    cur.G.t = { ...cur.G.t, left: 200000, at: Date.now() };
    await M.writeDb(page, 'game', { ...cur.raw, ...E.toRoom(cur.G) });
    await sleep(300);
    await clearLog(page);
    for (const slot of E.regularSlots(bomb)) if (!(await gameNow(page)).G.ok[E.keyOf(slot)]) await solve(page, bomb, slot);
    check('safe sound', await waitLog(page, 'safe'));
    l = await log(page);
    check('safe: once, no boom', count(l, 'safe') === 1 && !l.includes('boom'), l);
    await sleep(600);
    await clearLog(page);
    await sleep(2300);
    l = await log(page);
    check('no tick after the end', l.length === 0, l);
  }

  // ── 爆発（まちがい3回め） ──
  {
    const G = E.newState('normal', false, Date.now());
    G.x = 2;
    await M.putGame(page, 3, seed, 'normal', G);
    await clearLog(page);
    await zoom(page, 0);
    await press(page, 'cut:' + [0, 1, 2, 3, 4].find((i) => i !== bomb.slots[0].sol));
    check('boom sound', await waitLog(page, 'boom'));
    l = await log(page);
    check('boom: once, no strike', count(l, 'boom') === 1 && !l.includes('strike'), l);
  }

  // ── 時間切れの爆発 ──
  {
    const G = E.newState('normal', false, Date.now());
    G.t = { ...G.t, left: 1500, at: Date.now() };
    await M.putGame(page, 4, seed, 'normal', G);
    await clearLog(page);
    check('timeout boom sound', await waitLog(page, 'boom', 6000));
    check('timeout: once', count(await log(page), 'boom') === 1, await log(page));
  }

  // ── 切にする ──
  await M.putGame(page, 5, seed, 'normal', E.newState('normal', false, Date.now()));
  await sleep(1200);
  await pickSfx(page, GAME, '切');
  check('off: saved', (await page.evaluate(() => localStorage.getItem('torisetsukaijo:sfx'))) === '0');
  await clearLog(page);
  await solve(page, bomb, 0);
  await sleep(1300);
  check('off again: nothing played', (await log(page)).length === 0, await log(page));
  check('no console errors', errors.length === 0, errors.slice(0, 5));

  // ── みんなにみせる画面（同じ端末の設定を使う。入にできる） ──
  await page.evaluate(() => localStorage.setItem('torisetsukaijo:sfx', '0'));
  const watch = await context.newPage();
  const werrors = [];
  watch.on('console', (msg) => { if (msg.type() === 'error') werrors.push(msg.text()); });
  watch.on('pageerror', (err) => werrors.push('pageerror: ' + err.message));
  await countAudio(watch);
  const room = await M.readDb(page);
  const G = E.newState('normal', false, Date.now());
  const game = { ...room.game, id: 6, ...E.toRoom(G), ok: null, m: null, out: null, why: null };
  await watch.addInitScript(([path, value]) => {
    const tree = {}; let cur = tree; const ks = path.split('/');
    ks.slice(0, -1).forEach((k) => { cur[k] = {}; cur = cur[k]; });
    cur[ks[ks.length - 1]] = value;
    window.__shotSeed = tree;
  }, [M.ROOM, { ...room, status: 'waiting', game: null }]);
  await watch.goto(M.BASE + '?watch=' + M.CODE);
  await watch.waitForFunction(() => document.querySelector('.tk-screen.active')?.id === 'screen-waiting');
  check('watch: lobby seg off', (await segOn(watch, LOBBY)) === '切');
  check('watch: no audio at start', (await made(watch)) === 0);
  await pickSfx(watch, LOBBY, '入');
  check('watch: sample played', await waitLog(watch, 'solved'));
  await watch.evaluate(([path, g]) => { const cur = window.__shotdb.read(path); window.__shotdb.write(path, { ...cur, status: 'play', lastGameId: g.id, game: g }); }, [M.ROOM, game]);
  await watch.waitForFunction(() => document.querySelector('.tk-screen.active')?.id === 'screen-game');
  check('watch: board only', await watch.evaluate(() => !document.getElementById('viewBoard').hidden && document.getElementById('viewDef').hidden && document.getElementById('viewRead').hidden));
  check('watch: game seg on', (await segOn(watch, GAME)) === '入');
  await clearLog(watch);
  await sleep(2300);
  check('watch: ticks', count(await log(watch), 'tick') >= 2, await log(watch));
  // ほかの人のまちがい（データだけが変わる）
  await clearLog(watch);
  {
    const raw = await watch.evaluate(([p]) => window.__shotdb.read(p + '/game'), [M.ROOM]);
    const Gw = E.fromRoom(raw);
    Gw.x = 1;
    await watch.evaluate(([p, g]) => window.__shotdb.write(p + '/game', g), [M.ROOM, { ...raw, ...E.toRoom(Gw) }]);
  }
  check('watch: strike sound', await waitLog(watch, 'strike'));
  check('watch: no press sound', !(await log(watch)).includes('press') && !(await log(watch)).includes('cut'));
  check('watch: no console errors', werrors.length === 0, werrors.slice(0, 5));

  check('no production access', bad.length === 0, bad.slice(0, 5));
  console.log(`pass ${pass} / fail ${failures.length}`);
  await browser.close();
  server.close();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
