// シナリオB: ホストも参加＋端末参加2人＋端末なし（代理）1人＋途中から見学1人。選ぶ時間30秒・仕上げのサイコロ。
// 確認: 代理の操作・準備の締め切りと後から目標・コラボ（承諾/見送り/返事なし）・休憩→自動スキップ→復帰・
//       参加を終える・ホストのスキップ・時間切れ・延長・再読み込み復帰・途中見学・代わりに操作・次の1周で終了・仕上げ・結果
const L = require('./lib.cjs');

async function waitG(c, fn, arg, timeout) {
  await c.page.waitForFunction(new Function('arg', `const g = window.CS_UI.state.game; return !!g && (${fn})(g, arg);`), arg, { timeout: timeout || 20000 });
}

// テスト専用: 手番の人の今の手番を「コラボの相手を選ぶ」段階にする（盤面の出目を待たないため）
async function forceCollab(H) {
  return H.page.evaluate(async () => {
    const code = window.CS_UI.state.session.code;
    const ref = window.firebase.database().ref(window.CS_NET.ROOMS + '/' + code + '/game/turn');
    const res = await ref.transaction((t) => {
      if (!t || t.stage !== 'roll') return undefined;
      t.stage = 'partner';
      t.sq = { node: 7, type: 'collab', eff: 'collab', note: '', opts: [], scene: 0 };
      return t;
    });
    return res.committed;
  });
}

(async () => {
  const browser = await L.launch();
  const out = { checks: [], errors: [] };
  const ok = (msg) => { out.checks.push(msg); console.log('  ok -', msg); };
  let H; let P1; let P2; let W;
  try {
    H = await L.newClient(browser, 'host');
    P1 = await L.newClient(browser, 'p1');
    P2 = await L.newClient(browser, 'p2');
    const code = await L.createRoom(H, 'せんせい', true);
    await L.join(P1, 'はる', code);
    await L.join(P2, 'あお', code);
    await H.page.fill('#proxy-name', 'だいち');
    await H.page.click('#form-proxy [type=submit]');
    await waitG(H, (g) => Object.keys(g.players).length === 4);
    let g0 = await L.game(H);
    L.assert(g0.settings.chips === 6 && g0.settings.career === 2, 'recommended chips 6 / career 2 for 4 players');
    await H.page.click('[data-act="setting"][data-k="chips"][data-v="10"]');
    await H.page.click('[data-act="setting"][data-k="timerSec"][data-v="30"]');
    await waitG(H, (g) => g.settings.endRule === 'present' && g.settings.timerSec === 30 && g.settings.chips === 10);
    let g = await L.game(H);
    await L.sleep(300);
    await L.shot(H, 'B01-lobby-host-4players');
    ok('lobby: host plays + 2 device players + 1 proxy; chips 6 recommended (set 10 for coverage); timer 30; present roll');

    // ── 準備: ホストが自分と代理の分、端末の2人は各自。あおは目標の前で締め切り
    await H.page.click('[data-act="start"]');
    await waitG(P1, (g) => g.phase === 'setup');
    const hostId = g.host.id;
    const proxyId = Object.values(g.players).find((p) => p.ctrl === 'host').id;
    const p1Id = await P1.page.evaluate(() => window.CS_UI.state.session.id);
    const p2Id = await P2.page.evaluate(() => window.CS_UI.state.session.id);
    // P1: 理想 → 配布 → 目標
    for (let i = 0; i < 12; i++) { const a = await L.step(P1, {}); if (!a) break; await L.sleep(150); }
    // P2: 理想・配布まで
    await P2.page.click('#stage [data-act="idealSkip"]');
    await P2.page.waitForSelector('#stage [data-act="dealOk"]');
    await P2.page.click('#stage [data-act="dealOk"]');
    await P2.page.waitForSelector('#stage [data-act="goalOk"]');
    // ホスト: 自分 → 代理（タブで切り替え）
    await L.shot(H, 'B02-setup-host-tabs');
    for (let i = 0; i < 20; i++) {
      const gg = await L.game(H);
      if (gg.players[hostId].setup.step === 'done' && gg.players[proxyId].setup.step === 'done') break;
      const a = await L.step(H, {});
      if (!a) {
        // 自分の分が終わったら代理のタブへ
        await H.page.click(`[data-act="actFor"][data-pid="${proxyId}"]`).catch(() => {});
      }
      await L.sleep(150);
    }
    await L.sleep(300);
    await L.shot(H, 'B03-setup-host-proxy-done');
    g = await L.game(H);
    L.assert(g.players[proxyId].setup.step === 'done', 'proxy setup done by host');
    // 締め切ってはじめる（P2 は目標未選択）
    await H.page.click('#stage [data-act="begin"][data-force]');
    await H.page.click('.cs-modal [data-act="confirmOk"]');
    await waitG(H, (g) => g.phase === 'main');
    g = await L.game(H);
    L.assert(g.players[p2Id].setup.goalPending === true, 'p2 goal pending after force begin');
    ok('setup: proxy handled by host, force begin leaves goal pending');
    // P2 が手札の画面から後で目標を選ぶ
    await P2.page.click('#hand [data-act="lateGoal"]');
    await P2.page.click('.cs-modal [data-act="sel"][data-i="0"]');
    await L.shot(P2, 'B04-late-goal-modal');
    await P2.page.click('.cs-modal [data-act="lateGoalOk"]');
    await waitG(P2, (g, id) => g.players[id].goal >= 0 && !g.players[id].setup.goalPending, p2Id);
    ok('late goal chosen from hand panel');

    // ── 途中から見学
    W = await L.newClient(browser, 'watch');
    await L.join(W, 'みにきた', code, true);
    await L.sleep(800);
    await L.shot(W, 'B05-watch-midgame');
    const wInteractive = await W.page.evaluate(() => document.querySelectorAll('#stage [data-act="sel"], #stage [data-act="roll"], [data-act="drawer"]').length);
    L.assert(wInteractive === 0, 'spectator has no interactive game controls');
    ok('spectator joined mid-game, read-only');

    // ── 本編
    const flags = { accept: false, decline: false, timeoutInv: false, rest: false, restBack: false, leave: false, hostSkip: false, timerTimeout: false, extend: false, reload: false, proxyOn: false, endLap: false };
    const clients = { [hostId]: H, [p1Id]: P1, [p2Id]: P2 };
    const t0 = Date.now();
    let lastTurn = null;
    let p2RestChips = null;
    while (true) {
      g = await L.game(H);
      if (g.phase !== 'main') break;
      if (Date.now() - t0 > 900000) throw new Error('scenario B main timed out');
      const t = g.turn;
      // コラボ: P1 の手番の最初の3回で、承諾・見送り・返事なしを順に
      if (t && t.stage === 'roll' && t.pid === p1Id && t.id !== lastTurn && (!flags.accept || !flags.decline || !flags.timeoutInv) && g.players[p2Id].status === 'active' && g.players[p2Id].chips > 0) {
        lastTurn = t.id;
        if (await forceCollab(H)) {
          await P1.page.waitForSelector('#stage [data-act="sel"][data-key*="partner"]');
          await L.sleep(300);
          await L.shot(P1, 'B10-partner-choice');
          const names = await P1.page.$$eval('#stage [data-act="sel"][data-key*="partner"]', (els) => els.map((e) => e.textContent));
          const idx = names.findIndex((n) => n.includes('あお'));
          await P1.page.click(`#stage [data-act="sel"][data-key*="partner"][data-i="${idx}"]`);
          await P1.page.click('#stage [data-act="partnerOk"]');
          await P2.page.waitForSelector('.cs-invite');
          await L.sleep(300);
          await L.shot(P2, 'B11-invite-p2');
          await L.shot(H, 'B12-invite-host-view');
          const before = (await L.game(H)).players[p2Id].chips;
          if (!flags.accept) {
            await P2.page.click('.cs-invite [data-act="respond"][data-v="1"]');
            await waitG(H, (g) => g.turn && g.turn.stage === 'challenge' && g.turn.ch.members.length === 2);
            const g2 = await L.game(H);
            L.assert(g2.players[p2Id].chips === before - 1, 'invitee paid 1 chip on accept');
            await L.sleep(300);
            await L.shot(P1, 'B13-collab-two-members-p1');
            await L.shot(P2, 'B14-collab-two-members-p2');
            flags.accept = true;
            ok('collab accept: invitee -1 chip, two members');
          } else if (!flags.decline) {
            await P2.page.click('.cs-invite [data-act="respond"][data-v="0"]');
            await waitG(H, (g) => g.turn && g.turn.stage === 'challenge' && g.turn.ch.solo);
            L.assert((await L.game(H)).players[p2Id].chips === before, 'decline costs nothing');
            flags.decline = true;
            ok('collab decline: no chip cost, solo challenge');
          } else {
            await waitG(H, (g) => g.turn && g.turn.stage === 'challenge' && g.turn.ch.note === 'timeout', null, 20000);
            L.assert((await L.game(H)).players[p2Id].chips === before, 'timeout costs nothing');
            flags.timeoutInv = true;
            ok('collab invite timeout (10s): solo, no cost');
          }
          continue;
        }
      }
      // 休憩→自動スキップ→復帰（P2）
      if (t && t.pid === p2Id && t.stage === 'roll' && !flags.rest && flags.accept) {
        flags.rest = true;
        await P2.page.click('#stage [data-act="rest"]');
        await waitG(H, (g, id) => g.players[id].status === 'resting', p2Id);
        p2RestChips = (await L.game(H)).players[p2Id].chips;
        await L.sleep(300);
        await L.shot(P2, 'B20-resting-p2');
        ok('rest: p2 resting');
        continue;
      }
      if (flags.rest && !flags.restBack) {
        const gp = g.players[p2Id];
        if (gp.chips < p2RestChips) {
          L.assert(g.log.some((e) => e.k === 'skip' && e.p === p2Id && e.why === 'rest'), 'auto skip logged');
          await P2.page.click('#stage [data-act="back"]');
          await waitG(H, (g, id) => g.players[id].status === 'active', p2Id);
          flags.restBack = true;
          ok('resting turn auto-skipped with 1 chip; returned');
          continue;
        }
      }
      // ホストのスキップ（P1 の手番）
      if (t && t.pid === p1Id && t.stage === 'roll' && flags.timeoutInv && !flags.hostSkip && t.id !== lastTurn) {
        lastTurn = t.id;
        await H.page.click('[data-act="drawer"]');
        await H.page.waitForSelector('.cs-drawer');
        await L.shot(H, 'B30-host-drawer');
        await H.page.click('.cs-drawer [data-act="hostSkip"]');
        await H.page.click('.cs-modal [data-act="confirmOk"]');
        await waitG(H, (g, id) => !g.turn || g.turn.id !== id, t.id);
        await H.page.click('.cs-drawer [data-act="drawer"]').catch(() => {});
        await H.page.click('.cs-drawer-backdrop').catch(() => {});
        flags.hostSkip = true;
        ok('host skip via drawer');
        continue;
      }
      // 時間切れ（P1 が何もしない）と延長
      if (t && t.pid === p1Id && t.stage === 'roll' && flags.hostSkip && !flags.timerTimeout && t.id !== lastTurn) {
        lastTurn = t.id;
        const started = Date.now();
        // 延長を1回使う
        await P1.page.click('#stage [data-act="extend"]');
        await L.sleep(500);
        await L.shot(P1, 'B31-timer-extended');
        await waitG(H, (g, id) => !g.turn || g.turn.id !== id, t.id, 70000);
        const secs = (Date.now() - started) / 1000;
        const g2 = await L.game(H);
        L.assert(g2.log.some((e) => e.k === 'skip' && e.p === p1Id && e.why === 'timeout'), 'timeout logged');
        L.assert(secs >= 40, `timeout waited 30+15s (${secs.toFixed(1)}s)`);
        flags.timerTimeout = true;
        flags.extend = true;
        ok(`timer: extension once, timed out after ${secs.toFixed(1)}s`);
        continue;
      }
      // 再読み込み復帰（P1）
      if (flags.timerTimeout && !flags.reload) {
        flags.reload = true;
        await P1.page.reload();
        await P1.page.waitForFunction(() => window.CS_UI && window.CS_UI.state.game && window.CS_UI.state.session, null, { timeout: 20000 });
        const sid = await P1.page.evaluate(() => window.CS_UI.state.session.id);
        L.assert(sid === p1Id, 'same identity after reload');
        await L.sleep(500);
        await L.shot(P1, 'B40-after-reload-p1');
        ok('reload: reconnected as same player');
        continue;
      }
      // 代わりに操作（端末で参加している人の手番をホストが）
      if (t && (t.pid === p2Id || t.pid === p1Id) && t.stage === 'roll' && flags.reload && !flags.proxyOn && g.players[t.pid].status === 'active') {
        flags.proxyOn = true;
        await H.page.click('[data-act="drawer"]');
        await H.page.click('.cs-drawer [data-act="proxy"]');
        await H.page.click('.cs-drawer-backdrop');
        await H.page.waitForSelector('#stage [data-act="roll"]');
        await L.shot(H, 'B50-proxy-on-host');
        await H.page.click('#stage [data-act="roll"]');
        await waitG(H, (g, id) => g.turn && (g.turn.id !== id || g.turn.stage !== 'roll'), t.id);
        await H.page.click('[data-act="drawer"]');
        await H.page.click('.cs-drawer [data-act="proxy"]');
        await H.page.click('.cs-drawer-backdrop');
        ok('host operated for a device player with proxy mode');
        continue;
      }
      // 代理の人の参加を終える（ホスト）
      if (flags.proxyOn && !flags.leave) {
        flags.leave = true;
        await H.page.click('[data-act="drawer"]');
        await H.page.click(`.cs-drawer [data-act="pStatus"][data-pid="${proxyId}"][data-to="left"]`);
        await H.page.click('.cs-modal [data-act="confirmOk"]');
        await waitG(H, (g, id) => g.players[id].status === 'left', proxyId);
        await H.page.click('.cs-drawer-backdrop');
        ok('host ended proxy participation');
        continue;
      }
      // 次の1周で終了
      if (flags.leave && !flags.endLap && t && t.stage === 'roll') {
        flags.endLap = true;
        await H.page.click('[data-act="drawer"]');
        await H.page.click('.cs-drawer [data-act="endLap"]');
        await H.page.click('.cs-modal [data-act="confirmOk"]');
        await waitG(H, (g) => g.lastLap !== null);
        await H.page.click('.cs-drawer-backdrop');
        ok('end lap declared');
        continue;
      }
      if (g.turn && g.players[proxyId].status === 'left') L.assert(g.turn.pid !== proxyId, 'left player gets no turns');
      // それ以外は各端末が普通に進める（ホストは自分・代理の分も）
      const acted = [];
      for (const c of [H, P1, P2]) {
        // 時間切れテスト中は P1 を止める
        const a = await L.step(c, { host: c === H, accept: true });
        if (a) acted.push(a);
      }
      await L.sleep(acted.length ? 80 : 150);
    }
    g = await L.game(H);
    L.assert(g.phase === 'final', 'reached final');
    const missing = Object.entries(flags).filter(([, v]) => !v).map(([k]) => k);
    L.assert(missing.length === 0, 'all scripted checks covered before the game ended; missing: ' + missing.join(','));
    await L.sleep(500);
    await L.shot(H, 'B60-final-host');
    await L.shot(P1, 'B61-final-p1');
    ok('main finished -> final (choose + present roll)');
    // 最後の職業→仕上げのサイコロ: 各自（ホストは自分）
    for (let i = 0; i < 80; i++) {
      g = await L.game(H);
      if (g.phase === 'results') break;
      for (const c of [H, P1, P2]) {
        if (c === H) {
          // 参加を終えた代理の人の最後の職業は、ホストが代わりに選ばない（結果なしの表示を確かめる）
          const who = await H.page.evaluate(() => { const el = document.querySelector('#stage [data-who]'); return el ? el.dataset.who : ''; });
          if (who === proxyId && g.players[proxyId].status === 'left') {
            const rv = await H.page.$('#stage [data-act="reveal"]:not([data-force])');
            if (rv) await rv.click();
            continue;
          }
        }
        await L.step(c, { host: c === H });
      }
      await L.sleep(150);
    }
    g = await L.game(H);
    L.assert(g.phase === 'results', 'reached results');
    L.assert(g.results.ranked === true && g.results.rows.length >= 2, 'ranked with 2+ rows');
    L.assert(g.players[proxyId].status !== 'left' || g.results.none.includes(proxyId), 'left proxy shown as no result (not last place)');
    await L.sleep(1200);
    await L.shot(H, 'B70-results-host');
    await L.shot(P2, 'B71-results-p2');
    await L.shot(W, 'B72-results-watch');
    ok(`results ranked: ${g.results.rows.map((r) => `${r.rank}位${r.final}点`).join(' / ')}; none: ${g.results.none.length}`);
    // 計測
    const metrics = await H.page.evaluate(() => {
      const m = window.CS_UI.state.game.metrics;
      const turns = m.turns.filter((r) => r[1] === 0).map((r) => r[3] - r[2]);
      return { turns: turns.length, avg: turns.reduce((s, x) => s + x, 0) / Math.max(1, turns.length), careers: m.turns.filter((r) => r[1] === 2).length, autoSkips: m.turns.filter((r) => r[1] === 1).length };
    });
    ok(`metrics (automated clicks, not human): ${JSON.stringify(metrics)}`);
    const logs = [H, P1, P2, W].flatMap((c) => c.logs).filter((l) => !/Auth Emulator|emulator/i.test(l));
    const blocked = [H, P1, P2, W].flatMap((c) => c.blocked);
    L.assert(blocked.length === 0, 'no production requests');
    if (logs.length) console.log(logs.join('\n'));
    L.assert(logs.length === 0, 'no console errors');
    ok('console clean, no production access');
    console.log('flags', JSON.stringify(flags));
  } catch (err) {
    out.errors.push(String(err && err.stack || err));
    console.error(err);
    try { if (H) await L.shot(H, 'B99-error-host'); if (P1) await L.shot(P1, 'B99-error-p1'); if (P2) await L.shot(P2, 'B99-error-p2'); } catch (_) { /* noop */ }
    try { if (H) console.log('state:', JSON.stringify(await L.game(H)).slice(0, 3000)); } catch (_) { /* noop */ }
  } finally {
    await browser.close();
    console.log(JSON.stringify({ checks: out.checks.length, errors: out.errors }, null, 1));
    process.exit(out.errors.length ? 1 : 0);
  }
})();
