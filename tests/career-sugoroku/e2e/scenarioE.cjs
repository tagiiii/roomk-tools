// シナリオE: ミニゲームの途中で参加者の接続が切れる → ホストの画面にその人の答えのボタンが出る（つながりなおすと消える）。
// 再読み込みのとき、ルームを読めない（通信が一時的に止まっている）→ 戻るための情報を消さずに試し直し、通信がもどるとルームにもどる。
// 「トップへ戻る」でやめられる。重ねて開く画面（しごと図鑑）の中で Tab が回ること
'use strict';
const path = require('path');
const L = require('./lib.cjs');
const E = require(path.resolve(__dirname, '../../../apps/career-sugoroku/engine.js'));

const DB = 'http://127.0.0.1:9100';
const NS = 'demo-career-default-rtdb';
// エミュレーターのルームに直接書く（管理者として。本番には書かない）
async function putEmu(p, value) {
  const res = await fetch(`${DB}/${p}.json?ns=${NS}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: JSON.stringify(value) });
  if (!res.ok) throw new Error('emulator write failed: ' + res.status);
}
// いまのプレイヤーのまま、最初の人がミニゲームマスに止まった状態を作る
function miniGame(S) {
  const names = S.players.map((p) => p.name);
  for (let seed = 1; seed < 400; seed++) {
    const g = E.newGame({ names, dice: S.settings.dice, seed });
    g.players[0].node = 'a4';
    g.players[0].trail = ['start', 'a4'];
    const r = E.apply(g, { type: 'roll' });
    if (r.ok && r.state.step.kind === 'mini') return Object.assign(r.state, { rev: (S.rev || 0) + 1 });
  }
  throw new Error('no mini state');
}
// ホストの画面で、答えのボタンがある行の名前
const hostRows = (c) => c.page.evaluate(() => Array.from(document.querySelectorAll('#cs-card .cs-mini__row')).filter((r) => r.querySelector('.cs-mini__opt')).map((r) => r.querySelector('.cs-mini__name').textContent));

(async () => {
  const browser = await L.launch();
  const t0 = Date.now();
  const all = [];
  try {
    const host = await L.newClient(browser, 'host');
    const ao = await L.newClient(browser, 'ao');
    const rin = await L.newClient(browser, 'rin');
    all.push(host, ao, rin);
    // ao の通信だけを止められるようにしておく（エミュレーターの Realtime Database への接続）
    let blockAo = false;
    await ao.ctx.routeWebSocket(/127\.0\.0\.1:9100/, (ws) => { if (blockAo) ws.close(); else ws.connectToServer(); });
    await ao.ctx.route(/127\.0\.0\.1:9100\/\.lp/, (route) => (blockAo ? route.abort() : route.continue()));

    const code = await L.createRoom(host, 'しんこう', false, { dice: 1 }); // サイコロ1つ（ミニゲームの場面を作りやすい）
    for (const [c, n] of [[ao, 'あお'], [rin, 'りん']]) L.assert((await L.join(c, n, code)) === '', n + ' joins');
    await host.page.waitForFunction(() => document.querySelectorAll('#cs-seats .cs-seat').length === 2);
    await host.page.click('#cs-room-start');
    for (const c of all) await c.page.waitForFunction(() => !document.getElementById('cs-play').hidden, null, { timeout: 15000 });
    // 画面が切り替わったあと、焦点が見えない画面（待合室）に残っていない
    for (const c of all) {
      const ok = await c.page.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && a.getClientRects().length > 0 && !a.closest('[hidden]'); });
      L.assert(ok, c.name + ': focus moved into the play screen');
    }

    // ── 重ねて開く画面: 後ろは止まり、Tab は中で回る
    await host.page.click('#cs-open-book');
    await host.page.waitForFunction(() => !document.getElementById('cs-modal').hidden);
    L.assert(await host.page.evaluate(() => ['top', 'setup', 'create', 'join', 'lobby', 'play', 'results'].every((k) => document.getElementById('cs-' + k).inert)), 'all screens inert under the modal');
    for (let i = 0; i < 12; i++) {
      await host.page.keyboard.press(i % 3 === 2 ? 'Shift+Tab' : 'Tab');
      L.assert(await host.page.evaluate(() => document.getElementById('cs-modal').contains(document.activeElement)), 'focus stays in the modal');
    }
    await host.page.keyboard.press('Escape');
    L.assert(await host.page.evaluate(() => !document.getElementById('cs-play').inert), 'screens active again');

    // ── ミニゲームの場面にする（ao の番・ao が止まった）
    const S = (await L.ui(host)).S;
    const g = miniGame(S);
    await putEmu(`careersugoroku_rooms/${code}/game`, JSON.stringify(g));
    for (const c of all) await c.page.waitForFunction(() => { const s = window.CS_UI.state; return s.S && s.S.step && s.S.step.kind === 'mini' && !s.busy && !document.getElementById('cs-card-layer').hidden; }, null, { timeout: 15000 });
    L.assert((await hostRows(host)).length === 0, 'host cannot answer for connected players: ' + (await hostRows(host)).join(','));
    // りんの接続が切れる → ホストの画面にりんの行のボタンが出る
    await rin.ctx.setOffline(true);
    await host.page.waitForFunction(() => Array.from(document.querySelectorAll('#cs-card .cs-mini__row')).some((r) => r.querySelector('.cs-mini__opt') && r.textContent.includes('りん')), null, { timeout: 150000 });
    L.assert((await hostRows(host)).join(',') === 'りん', 'host rows: ' + (await hostRows(host)).join(','));
    await L.shot(host, 'E1-host-answers-for-offline');
    // ホストが代わりに答える → あおの画面でも「答えた」
    await host.page.evaluate(() => { const r = Array.from(document.querySelectorAll('#cs-card .cs-mini__row')).find((x) => x.textContent.includes('りん')); r.querySelector('.cs-mini__opt').click(); });
    await ao.page.waitForFunction(() => Array.from(document.querySelectorAll('#cs-card .cs-mini__row')).some((r) => r.textContent.includes('りん') && r.querySelector('.cs-mini__status--done')), null, { timeout: 15000 });
    // りんがつながりなおす → ホストの画面からりんの行のボタンが消える。りんの画面には答えが入っている
    await rin.ctx.setOffline(false);
    await host.page.waitForFunction(() => !Array.from(document.querySelectorAll('#cs-card .cs-mini__row')).some((r) => r.querySelector('.cs-mini__opt')), null, { timeout: 60000 });
    await rin.page.waitForFunction(() => !!document.querySelector('#cs-card .cs-mini__row--me .cs-mini__opt[aria-pressed="true"]'), null, { timeout: 30000 });

    // ── 再読み込みでルームを読めない → 情報を残して試し直す → 通信がもどるとルームにもどる
    blockAo = true;
    await ao.page.reload();
    await ao.page.waitForFunction(() => !document.getElementById('cs-overlay').hidden && !document.getElementById('cs-overlay-cancel').hidden, null, { timeout: 30000 });
    L.assert(await ao.page.evaluate(() => !!sessionStorage.getItem('careersugoroku_session')), 'session kept while retrying');
    await L.shot(ao, 'E2-reconnect-retrying');
    blockAo = false;
    await ao.page.waitForFunction(() => { const s = window.CS_UI.state; return s.sess && s.room && !document.getElementById('cs-play').hidden && document.getElementById('cs-overlay').hidden; }, null, { timeout: 60000 });
    L.assert((await L.ui(ao)).S.step.kind === 'mini', 'back in the same game');

    // ── もう一度読めなくして、2回目の読み込みの途中で「トップへ戻る」→ すぐ通信をもどしても、ルームにはもどらない
    blockAo = true;
    await ao.page.reload();
    await ao.page.waitForFunction(() => !document.getElementById('cs-overlay-cancel').hidden, null, { timeout: 30000 });
    await L.sleep(6500); // 5秒後に始まる2回目の読み込み（8秒で打ち切り）の途中
    await ao.page.click('#cs-overlay-cancel');
    blockAo = false;
    await ao.page.waitForFunction(() => !document.getElementById('cs-top').hidden && document.getElementById('cs-overlay').hidden);
    L.assert(await ao.page.evaluate(() => !sessionStorage.getItem('careersugoroku_session')), 'session cleared after giving up');
    await L.sleep(10000); // 読み込み中だった試しの結果が届いても、トップのまま
    L.assert(await ao.page.evaluate(() => !document.getElementById('cs-top').hidden && !window.CS_UI.state.sess && document.getElementById('cs-overlay').hidden), 'stays on top after giving up');

    // ── ルームを作る画面で Enter を続けて押しても、ルームは1つだけ
    const solo = await L.newClient(browser, 'solo');
    all.push(solo);
    await solo.page.click('#cs-go-create');
    await solo.page.fill('#cs-host-name', 'えんたー');
    await solo.page.focus('#cs-host-name');
    await solo.page.keyboard.press('Enter');
    await solo.page.keyboard.press('Enter');
    await solo.page.keyboard.press('Enter');
    await solo.page.waitForFunction(() => !document.getElementById('cs-lobby').hidden, null, { timeout: 20000 });
    await L.sleep(1500);
    const rooms = await (await fetch(`${DB}/careersugoroku_rooms.json?ns=${NS}`, { headers: { Authorization: 'Bearer owner' } })).json();
    const mine = Object.values(rooms || {}).filter((r) => r && r.meta && r.meta.hostName === 'えんたー');
    L.assert(mine.length === 1, 'rooms created by repeated Enter: ' + mine.length);
    await solo.page.evaluate(() => window.CS_NET.closeRoom(window.CS_UI.state.sess.code));

    const expected = /\[reconnect\]|ERR_CONNECTION|net::ERR_ABORTED|FIREBASE WARNING|WebSocket/;
    const errs = all.flatMap((c) => L.realErrors(c.logs)).filter((l) => !(l.startsWith('[ao]') && expected.test(l)) && !(l.startsWith('[rin]') && /FIREBASE WARNING/.test(l)));
    L.assert(!errs.length, 'console errors: ' + errs.join(' | '));
    L.assert(!all.some((c) => c.blocked.length), 'production requests');
    console.log(`scenario E: OK (${Math.round((Date.now() - t0) / 1000)}s)`);
  } catch (e) {
    console.error('scenario E: FAILED', e.message);
    for (const c of all) { console.error(c.logs.join('\n')); await L.shot(c, 'E-fail-' + c.name).catch(() => {}); }
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
