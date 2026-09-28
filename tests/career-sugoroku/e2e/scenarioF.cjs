// シナリオF: 2026-09-28 独立レビューの3件の修正と、暮らしのプラン（3つから選ぶ形）の確認
// F1: ガイドを開いたままルームが閉じられる・待合室から外される → 再読み込みなしでトップを操作できる
// F2: 見学の人と同じ名前の「端末なしの人」は追加できない（逆順・通常参加も同じ）
// F3: 閉じたルームへの見学は断られ、閉じるのと見学の入室が重なっても一部だけのルームが残らない。見学の再読み込み
// F4: 暮らしのマスは、ちがう場面のプラン3つ＋「選ばない」から選ぶ。結果と見学の画面
const L = require('./lib.cjs');

(async () => {
  const browser = await L.launch();
  const out = { checks: [] };
  const ok = (msg) => { out.checks.push(msg); console.log('  ok -', msg); };
  const clients = [];
  const client = async (name, opts) => { const c = await L.newClient(browser, name, opts); clients.push(c); return c; };
  const roomData = (c, code) => c.page.evaluate(async (cd) => (await window.firebase.database().ref(window.CS_NET.ROOMS + '/' + cd).get()).val(), code);
  const topUsable = async (c) => {
    await c.page.waitForFunction(() => window.CS_UI.state.screen === 'top' && !window.CS_UI.state.session, null, { timeout: 15000 });
    const st = await c.page.evaluate(() => ({
      inert: Array.from(document.querySelectorAll('.screen, #drawer-root')).filter((e) => e.inert).map((e) => e.id),
      dialogs: document.querySelectorAll('#modal-root [role=dialog]').length, // 共通の「？」のモーダルは閉じていても DOM に残るので、このアプリのモーダルだけを数える
    }));
    L.assert(!st.inert.length && st.dialogs === 0, 'no inert/dialog left: ' + JSON.stringify(st));
    await c.page.click('[data-act="goJoin"]', { timeout: 3000 });
    await c.page.waitForFunction(() => window.CS_UI.state.screen === 'join', null, { timeout: 3000 });
    await c.page.keyboard.press('Tab');
    const inScreen = await c.page.evaluate(() => !!(document.activeElement && document.activeElement.closest('.screen.active')));
    L.assert(inScreen, 'Tab moves focus inside the visible screen');
    await c.page.click('#screen-join [data-act="goTop"]', { timeout: 3000 });
    await c.page.waitForFunction(() => window.CS_UI.state.screen === 'top', null, { timeout: 3000 });
  };
  // 参加フォームを送って、入れたか・エラーの文言を返す（失敗を確かめるため lib の join は使わない）
  const tryJoin = async (c, name, code, watch) => {
    await c.page.evaluate(() => { if (window.CS_UI.state.screen !== 'join') document.querySelector('[data-act="goJoin"]').click(); });
    await c.page.waitForFunction(() => window.CS_UI.state.screen === 'join');
    await c.page.fill('#join-name', name);
    await c.page.fill('#join-code', code);
    await c.page.click(`[data-act="joinRole"][data-v="${watch ? 'watch' : 'play'}"]`).catch(() => {});
    await c.page.evaluate(() => { document.getElementById('join-error').textContent = ''; });
    await c.page.click('#join-submit');
    await c.page.waitForFunction(() => window.CS_UI.state.game || (document.getElementById('join-error').textContent || '').trim(), null, { timeout: 15000 });
    return c.page.evaluate(() => ({ inRoom: !!window.CS_UI.state.game, error: (document.getElementById('join-error').textContent || '').trim() }));
  };
  try {
    const H = await client('host');
    const P = await client('p1');
    const W = await client('watch');

    // ── F1 ──
    let code = await L.createRoom(H, 'メンター', false);
    await L.join(P, 'そら', code);
    await L.join(W, 'みる', code, true);
    for (const c of [P, W]) {
      await c.page.click('[data-fk="lobby-guide"]');
      await c.page.waitForSelector('.cs-modal [role=dialog], .cs-modal', { timeout: 5000 });
      const inert = await c.page.evaluate(() => document.getElementById('screen-lobby').inert);
      L.assert(inert, 'background inert while the guide is open');
    }
    await L.shot(P, 'F01-guide-open-before-close');
    await H.page.click('[data-act="closeRoom"]');
    await H.page.click('.cs-modal [data-act="confirmOk"]');
    for (const c of [P, W]) await topUsable(c);
    await topUsable(H);
    L.assert((await roomData(H, code)) === null, 'room removed');
    ok('F1: guide open when the host closes the room -> player, spectator and host can use the top/join screens without reloading');

    code = await L.createRoom(H, 'メンター', false);
    await L.join(P, 'そら', code);
    await P.page.click('[data-fk="lobby-guide"]');
    await P.page.waitForSelector('.cs-modal');
    await H.page.waitForSelector('[data-act="removePlayer"]');
    await H.page.click('[data-act="removePlayer"]');
    await topUsable(P);
    await L.shot(P, 'F02-removed-top-usable');
    ok('F1b: removed from the waiting room with the guide open -> top/join usable');

    // ── F2 ──
    const r1 = await tryJoin(W, '同名テスト', code, true);
    L.assert(r1.inRoom, 'spectator joined: ' + JSON.stringify(r1));
    await H.page.waitForFunction(() => Object.values((window.CS_UI.state.room && window.CS_UI.state.room.spectators) || {}).some((s) => s.name === '同名テスト'));
    await H.page.fill('#proxy-name', '同名テスト');
    await H.page.click('#form-proxy [type=submit]');
    await H.page.waitForFunction(() => { const e = document.getElementById('proxy-error'); return e && !e.hidden && /使われています/.test(e.textContent); }, null, { timeout: 10000 });
    let g = await L.game(H);
    L.assert(Object.keys(g.players).length === 0, 'proxy with the spectator name was not added');
    L.assert(g.settings.chips === 8, 'recommended settings unchanged');
    await L.shot(H, 'F03-proxy-name-taken');
    await H.page.fill('#proxy-name', 'だいり');
    await H.page.click('#form-proxy [type=submit]');
    await H.page.waitForFunction(() => Object.values(window.CS_UI.state.game.players).some((p) => p.name === 'だいり'));
    const W2 = await client('watch2');
    const r2 = await tryJoin(W2, 'だいり', code, true);
    L.assert(!r2.inRoom && /使われています/.test(r2.error), 'spectator with a proxy name refused: ' + JSON.stringify(r2));
    const P2 = await client('p2');
    const r3 = await tryJoin(P2, '同名テスト', code, false);
    L.assert(!r3.inRoom && /使われています/.test(r3.error), 'player with a spectator name refused: ' + JSON.stringify(r3));
    const room = await L.room(H);
    const names = Object.values(room.game.players).map((p) => p.name).concat(Object.values(room.spectators || {}).map((s) => s.name), [room.game.host.name]);
    L.assert(new Set(names).size === names.length, 'names unique: ' + names.join(','));
    ok('F2: proxy with a spectator name refused (message shown, nothing changed); reverse order and normal join refused too');

    // ── F3 ──
    await W.page.reload();
    await W.page.waitForFunction(() => window.CS_UI && window.CS_UI.state.game && window.CS_UI.state.session && window.CS_UI.state.session.role === 'spectator', null, { timeout: 15000 });
    await L.sleep(800);
    const wid = await W.page.evaluate(() => window.CS_UI.state.session.id);
    const afterReload = await roomData(H, code);
    L.assert(afterReload.spectators && afterReload.spectators[wid] && afterReload.spectators[wid].name === '同名テスト', 'spectator re-registered after reload');
    L.assert(Object.keys(afterReload.spectators).length === 1, 'still one spectator');
    ok('F3a: spectator reload -> re-registered once with the same name');

    await H.page.click('[data-act="closeRoom"]');
    await H.page.click('.cs-modal [data-act="confirmOk"]');
    await topUsable(W);
    const r4 = await tryJoin(W2, 'あとから', code, true);
    L.assert(!r4.inRoom && /見つかりません/.test(r4.error), 'join to a closed room refused: ' + JSON.stringify(r4));
    L.assert((await roomData(H, code)) === null, 'no partial room after a refused join');
    ok('F3b: spectator join to a closed room is refused and writes nothing');

    let raced = 0;
    for (let k = 0; k < 8; k++) {
      const c2 = await L.createRoom(H, 'メンター', false);
      await W2.page.evaluate(() => { if (window.CS_UI.state.screen !== 'join') document.querySelector('[data-act="goJoin"]').click(); });
      await W2.page.fill('#join-name', 'きょうそう' + k);
      await W2.page.fill('#join-code', c2);
      await W2.page.click('[data-act="joinRole"][data-v="watch"]');
      await H.page.click('[data-act="closeRoom"]');
      await H.page.waitForSelector('.cs-modal [data-act="confirmOk"]');
      // 閉じる確定と見学の入室を、少しずつずらして同時に押す
      const delay = [0, 5, 10, 20, 30, 45, 60, 80][k];
      await Promise.all([
        H.page.click('.cs-modal [data-act="confirmOk"]'),
        L.sleep(delay).then(() => W2.page.click('#join-submit')),
      ]);
      await L.sleep(2500);
      const left = await roomData(H, c2);
      L.assert(left === null, `race ${k}: nothing left under the room code (${JSON.stringify(left)})`);
      const st = await W2.page.evaluate(() => ({ session: !!window.CS_UI.state.session, screen: window.CS_UI.state.screen }));
      L.assert(!st.session, `race ${k}: the spectator is not left in a room: ${JSON.stringify(st)}`);
      if (st.screen === 'top') raced += 1; // 入室してから閉じられた（トップへ戻った）回
      await W2.page.evaluate(() => { document.getElementById('join-error').textContent = ''; });
    }
    ok(`F3c: closing and joining at the same time x8 -> no partial room, the spectator never stays in a dead room (joined-then-closed ${raced}/8)`);

    // ── F4 ──
    // ホストも参加（直前の「進行だけ」の選択が画面に残っているので、参加を選び直す）
    await H.page.click('[data-act="goCreate"]');
    await H.page.fill('#create-name', 'メンター');
    await H.page.click('[data-act="createRole"][data-v="play"]');
    await H.page.click('#form-create [type=submit]');
    await H.page.waitForSelector('.cs-code__value', { timeout: 15000 });
    code = (await H.page.textContent('.cs-code__value')).trim();
    const WM = await client('watch-mobile', { viewport: { width: 375, height: 812 }, mobile: true });
    await L.join(WM, 'スマホ', code, true);
    await H.page.click('[data-act="start"]');
    for (let i = 0; i < 60; i++) {
      g = await L.game(H);
      if (g.phase === 'main' && g.turn && g.turn.stage === 'roll') break;
      await L.step(H, { host: true, first: true });
      await L.sleep(250);
    }
    g = await L.game(H);
    L.assert(g.phase === 'main' && g.turn.stage === 'roll', 'main phase reached');
    const opts = await H.page.evaluate(async () => {
      const code2 = window.CS_UI.state.session.code;
      const Eng = window.CS_ENGINE;
      const o = Eng.lifePlanOptions(Eng.makeRng(20260928));
      const ref = window.firebase.database().ref(window.CS_NET.ROOMS + '/' + code2 + '/game/turn');
      const res = await ref.transaction((t) => {
        if (!t || t.stage !== 'roll') return undefined;
        t.stage = 'act';
        t.sq = { node: 8, type: 'life', eff: 'life', note: '', opts: o, scene: -1 };
        return t;
      });
      return res.committed ? o : null;
    });
    L.assert(opts && opts.length === 3, 'life act state written');
    await H.page.waitForSelector('#stage [data-act="actOk"]');
    await L.sleep(400);
    const view = await H.page.evaluate((o) => {
      const D = window.CS_DATA;
      const buttons = Array.from(document.querySelectorAll('#stage .cs-choice'));
      return {
        n: buttons.length,
        texts: buttons.map((b) => b.querySelector('.cs-choice__text').textContent.trim()),
        want: o.map((k) => D.LIVES[D.LIFE_PLANS[k].s].title),
        head: document.querySelector('#stage').textContent.includes('どのプランにする'),
      };
    }, opts);
    L.assert(view.n === 4, 'three plans + pass: ' + JSON.stringify(view));
    L.assert(view.want.every((t, i) => view.texts[i] === t) && /選ばない/.test(view.texts[3]), 'plan titles shown: ' + JSON.stringify(view));
    L.assert(view.head, 'question shown');
    await L.shot(H, 'F04-life-plans-pc');
    await WM.page.waitForFunction(() => document.querySelectorAll('#stage .cs-choice').length === 4, null, { timeout: 10000 });
    const hscroll = await WM.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    L.assert(!hscroll, 'no horizontal scroll at 375px');
    await L.shot(WM, 'F05-life-plans-mobile-spectator');
    await H.page.click('#stage [data-act="sel"][data-i="1"]');
    await L.sleep(300);
    await WM.page.waitForFunction(() => { const b = document.querySelectorAll('#stage .cs-choice')[1]; return b && b.getAttribute('aria-pressed') === 'true'; }, null, { timeout: 5000 });
    await H.page.click('#stage [data-act="actOk"]');
    await H.page.waitForFunction(() => window.CS_UI.state.game.turn && window.CS_UI.state.game.turn.stage === 'result');
    await L.sleep(400);
    const res = await H.page.evaluate((k) => {
      const D = window.CS_DATA;
      const pl = D.LIFE_PLANS[k];
      const g2 = window.CS_UI.state.game;
      const me = g2.players[g2.turn.pid];
      return { text: document.querySelector('#stage').textContent, title: D.LIVES[pl.s].title, act: pl.text, apt: me.life.apt, want: pl.a, left: me.life.left };
    }, opts[1]);
    L.assert(res.text.includes(`暮らしのプラン「${res.title}」`) && res.text.includes(res.act), 'result shows the chosen plan');
    L.assert(res.apt === res.want && res.left === 2, 'life effect stored');
    await WM.page.waitForFunction((t) => document.querySelector('#stage').textContent.includes(t), `暮らしのプラン「${res.title}」`, { timeout: 5000 });
    await L.shot(H, 'F06-life-result-pc');
    await L.shot(WM, 'F07-life-result-mobile-spectator');
    ok('F4: life square offers 3 plans from different scenes + "choose none"; the spectator (375px) follows the selection and result');

    const logs = clients.flatMap((c) => c.logs);
    const blocked = clients.flatMap((c) => c.blocked);
    L.assert(!blocked.length, 'no production requests: ' + blocked.join(' '));
    if (logs.length) console.log('console:', logs.join('\n'));
    L.assert(!logs.length, 'no console errors/warnings');
    ok('console: no errors or warnings; no requests to production hosts');
    console.log(JSON.stringify({ result: 'PASS', checks: out.checks.length }));
  } catch (err) {
    console.error('FAIL', err && err.stack || err);
    clients.forEach((c) => { if (c.logs.length) console.error(c.logs.join('\n')); });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
