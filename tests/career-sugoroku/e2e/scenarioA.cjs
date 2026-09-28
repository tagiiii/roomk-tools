// シナリオA: ホスト（進行だけ）＋参加者1人＋見学1人。最小構成で最後まで。
// 確認: 1人モード（コラボは架空の仕事仲間）・スキップ・休憩（全員休憩で保留）・復帰・進路2回・仕上げのサイコロ・結果・見学の追従
const L = require('./lib.cjs');

(async () => {
  const browser = await L.launch();
  const out = { checks: [], errors: [] };
  const ok = (msg) => { out.checks.push(msg); console.log('  ok -', msg); };
  try {
    const H = await L.newClient(browser, 'host');
    const P = await L.newClient(browser, 'p1');
    const W = await L.newClient(browser, 'watch');
    const code = await L.createRoom(H, 'メンター', false);
    await L.join(P, 'そら', code);
    await L.join(W, 'みる', code, true);
    await L.sleep(800);
    await L.shot(H, 'A01-lobby-host');
    await L.shot(P, 'A02-lobby-p1');
    await L.shot(W, 'A03-lobby-watch');
    let g = await L.game(H);
    L.assert(Object.keys(g.players).length === 1 && !g.players[g.host.id], 'host is not a player');
    const r0 = await L.room(H);
    L.assert(Object.keys(r0.spectators || {}).length === 1, 'spectator registered');
    L.assert(g.settings.chips === 8, 'solo recommended chips 8');
    ok('lobby: host facilitator + 1 player + 1 spectator; chips 8');

    await H.page.click('[data-act="start"]');
    await P.page.waitForFunction(() => window.CS_UI.state.game.phase === 'setup');
    await L.sleep(500);
    await L.shot(P, 'A04-setup-ideal');
    await P.page.click('#stage [data-act="sel"][data-i="0"]');
    await L.sleep(200);
    await L.shot(P, 'A05-setup-ideal-selected');
    await P.page.click('#stage [data-act="idealOk"]');
    await P.page.waitForSelector('#stage [data-act="dealOk"]');
    await L.sleep(700);
    await L.shot(P, 'A06-setup-deal');
    await P.page.click('#stage [data-act="dealOk"]');
    await P.page.waitForSelector('#stage [data-act="goalOk"]');
    await L.shot(P, 'A07-setup-goal');
    await P.page.click('#stage [data-act="sel"][data-i="1"]');
    await P.page.click('#stage [data-act="goalOk"]');
    await H.page.waitForSelector('#stage [data-act="begin"]:not([data-force])', { timeout: 10000 });
    await L.shot(H, 'A08-setup-host-ready');
    await L.shot(W, 'A08b-setup-watch');
    await H.page.click('#stage [data-act="begin"]');
    await P.page.waitForFunction(() => window.CS_UI.state.game.phase === 'main');
    await L.sleep(700);
    await L.shot(P, 'A09-main-roll-p1');
    await L.shot(H, 'A10-main-roll-host');
    await L.shot(W, 'A11-main-roll-watch');
    ok('setup: ideal -> deal -> goal -> begin');

    const seen = new Set();
    const t0 = Date.now();
    let skipped = false;
    let rested = false;
    let chipsBeforeSkip = null;
    while (true) {
      g = await L.game(P);
      if (g.phase === 'results') break;
      if (Date.now() - t0 > 300000) {
        await L.shot(P, 'A99-stuck-p1'); await L.shot(H, 'A99-stuck-host');
        const dbg = await P.page.evaluate(() => { const g = window.CS_UI.state.game; return { phase: g.phase, hold: g.hold, career: g.career, turn: g.turn && { stage: g.turn.stage, pid: g.turn.pid, sq: g.turn.sq, ch: g.turn.ch }, stageHtml: document.getElementById('stage').innerText.slice(0, 600), busy: window.CS_UI.state.busy }; });
        console.log('STUCK', JSON.stringify(dbg).slice(0, 2500));
        console.log('STUCK logs:', [...P.logs, ...H.logs, ...W.logs].slice(-20).join('\n'));
        throw new Error('scenario A timed out');
      }
      const t = g.turn;
      const key = g.phase === 'main' ? (g.hold ? 'hold' : g.career ? `career-${g.career.stage}` : t ? `turn-${t.stage}${t.sq ? '-' + t.sq.eff : ''}` : 'x') : g.phase;
      if (!seen.has(key)) {
        seen.add(key);
        await L.sleep(450);
        await L.shot(P, `A20-${key}-p1`);
        await L.shot(H, `A21-${key}-host`);
        if (key.startsWith('turn-challenge') || key.startsWith('career')) await L.shot(W, `A22-${key}-watch`);
      }
      const pid = g.order[0];
      if (g.phase === 'main' && t && t.stage === 'roll' && g.round === 3 && !skipped) {
        skipped = true;
        chipsBeforeSkip = g.players[pid].chips;
        await P.page.click('#stage [data-act="skip"]');
        await P.page.waitForFunction((id) => !window.CS_UI.state.game.turn || window.CS_UI.state.game.turn.id !== id, t.id);
        const g2 = await L.game(P);
        // 1人なので次の自分の番が始まる → 1枚減る（スキップでは二重に減らない）
        L.assert(g2.players[pid].chips === chipsBeforeSkip - (g2.turn && g2.turn.pid === pid ? 1 : 0), 'skip did not double-consume');
        ok('skip: chips consumed once');
        continue;
      }
      if (g.phase === 'main' && t && t.stage === 'roll' && g.round >= 4 && !rested && !g.career) {
        rested = true;
        const before = g.players[pid].chips;
        await P.page.click('#stage [data-act="rest"]');
        await P.page.waitForFunction(() => window.CS_UI.state.game.hold === 'allResting');
        await L.sleep(400);
        await L.shot(P, 'A30-hold-p1');
        await L.shot(H, 'A31-hold-host');
        const g2 = await L.game(P);
        L.assert(g2.players[pid].chips === before, 'all resting holds without burning chips');
        ok('rest: solo player resting -> hold without consuming chips');
        await P.page.click('#stage [data-act="back"]');
        await P.page.waitForFunction(() => !!(window.CS_UI.state.game.turn || window.CS_UI.state.game.career));
        ok('return: resumes from next own turn');
        continue;
      }
      const a = await L.step(P, {});
      const h = await L.step(H, { host: true });
      if (!a && !h) await L.sleep(120);
      else await L.sleep(60);
    }
    await L.sleep(1200);
    await L.shot(P, 'A40-results-p1');
    await L.shot(H, 'A41-results-host');
    await L.shot(W, 'A42-results-watch');
    g = await L.game(H);
    L.assert(g.results && g.results.rows.length === 1 && g.results.ranked === false, 'solo results unranked');
    const row = g.results.rows[0];
    L.assert(row.roll && row.final === row.base + row.roll.bonus && row.roll.bonus >= 0 && row.roll.bonus <= 3, 'present roll applied 0..3');
    L.assert(g.metrics.turns.some((r) => r[1] === 2), 'career rounds happened');
    const wg = await L.game(W);
    L.assert(wg.phase === 'results', 'spectator followed to results');
    ok(`results: solo score ${g.results.rows[0].final}, career rounds ${g.metrics.turns.filter((r) => r[1] === 2).length}, stages seen ${[...seen].join(',')}`);
    // ふりかえりはなし（2026-09-28 オーナー決定）。結果画面は順位・得点と「退出する」／「ルームを閉じる」だけ
    for (const c of [P, H, W]) {
      const noReflect = await c.page.evaluate(() => !document.querySelector('[data-act="reflect"]') && !/ふりかえり/.test(document.getElementById('screen-game').textContent));
      L.assert(noReflect, `no reflection on the results screen (${c.name})`);
    }
    ok('results: no reflection section (host, player, spectator)');

    const logs = [...H.logs, ...P.logs, ...W.logs].filter((l) => !/Auth Emulator|emulator/i.test(l));
    const blocked = [...H.blocked, ...P.blocked, ...W.blocked];
    L.assert(blocked.length === 0, 'no production requests: ' + blocked.join(','));
    if (logs.length) { console.log('console:', logs.join('\n')); }
    L.assert(logs.length === 0, 'no console errors/warnings');
    ok('console clean, no production access');
    // 片付け
    await H.page.click('#results [data-act="closeRoom"]');
    await H.page.click('.cs-modal [data-act="confirmOk"]');
    await P.page.waitForSelector('#screen-top.active', { timeout: 10000 });
    ok('host closed room -> participant returned to top');
  } catch (err) {
    out.errors.push(String(err && err.stack || err));
    console.error(err);
  } finally {
    await browser.close();
    console.log(JSON.stringify({ checks: out.checks.length, errors: out.errors }, null, 1));
    process.exit(out.errors.length ? 1 : 0);
  }
})();
