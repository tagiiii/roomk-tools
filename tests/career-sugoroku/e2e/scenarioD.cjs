// シナリオD: ホスト（進行だけ）＋端末参加7人＋見学2人。7人の推奨設定（時間チップ4・進路1回）で最後まで。
// 確認: 7人でも同期・手番の交代・進路の同時選択・終盤・結果が止まらない
const L = require('./lib.cjs');

(async () => {
  const browser = await L.launch();
  const out = { checks: [], errors: [] };
  const ok = (msg) => { out.checks.push(msg); console.log('  ok -', msg); };
  try {
    const H = await L.newClient(browser, 'host');
    const code = await L.createRoom(H, 'すたっふ', false);
    const names = ['いち', 'にこ', 'さん', 'よん', 'ごう', 'ろく', 'なな'];
    const Ps = [];
    for (const n of names) {
      const c = await L.newClient(browser, n, { viewport: { width: 900, height: 800 } });
      await L.join(c, n, code);
      Ps.push(c);
    }
    const W1 = await L.newClient(browser, 'w1');
    await L.join(W1, 'みる1', code, true);
    const W2 = await L.newClient(browser, 'w2', { viewport: { width: 375, height: 812 }, mobile: true });
    await L.join(W2, 'みる2', code, true);
    await L.sleep(1000);
    let g = await L.game(H);
    L.assert(Object.keys(g.players).length === 7, '7 players');
    L.assert(g.settings.chips === 4 && g.settings.career === 1, '7-player recommended: chips 4, career 1');
    await L.shot(H, 'D01-lobby-7players');
    ok('lobby with 7 players and 2 spectators');
    await H.page.click('[data-act="start"]');
    const t0 = Date.now();
    let screensTaken = 0;
    while (true) {
      g = await L.game(H);
      if (g.phase === 'results') break;
      if (Date.now() - t0 > 600000) throw new Error('scenario D timed out');
      if (g.career && screensTaken === 0) { screensTaken += 1; await L.sleep(300); await L.shot(H, 'D10-career-host-7'); await L.shot(W2, 'D11-career-watch-mobile'); }
      if (g.phase === 'final' && screensTaken === 1) { screensTaken += 1; await L.sleep(300); await L.shot(H, 'D20-final-host-7'); }
      const acts = await Promise.all(Ps.map((c) => L.step(c, { accept: Math.random() < 0.6 })));
      const h = await L.step(H, { host: true });
      if (!acts.some(Boolean) && !h) await L.sleep(150);
    }
    const elapsed = (Date.now() - t0) / 1000;
    await L.sleep(1500);
    await L.shot(H, 'D30-results-host-7');
    await L.shot(W1, 'D31-results-watch');
    g = await L.game(H);
    L.assert(g.results.ranked && g.results.rows.length === 7, 'all 7 ranked');
    const turns = g.metrics.turns.filter((r) => r[1] === 0).length;
    ok(`7-player game completed in ${elapsed.toFixed(0)}s of automated play; normal turns ${turns}; career rounds ${g.metrics.turns.filter((r) => r[1] === 2).length}`);
    // すべての端末が同じ結果を見ている
    const seqs = await Promise.all([H, ...Ps, W1, W2].map((c) => c.page.evaluate(() => window.CS_UI.state.game.seq)));
    L.assert(new Set(seqs).size === 1, 'all clients converged to the same state seq ' + seqs.join(','));
    ok('all 10 clients converged');
    const logs = [H, ...Ps, W1, W2].flatMap((c) => c.logs).filter((l) => !/Auth Emulator|emulator/i.test(l));
    if (logs.length) console.log(logs.slice(0, 20).join('\n'));
    L.assert(logs.length === 0, 'no console errors');
    ok('console clean');
  } catch (err) {
    out.errors.push(String(err && err.stack || err));
    console.error(err);
  } finally {
    await browser.close();
    console.log(JSON.stringify({ checks: out.checks.length, errors: out.errors }, null, 1));
    process.exit(out.errors.length ? 1 : 0);
  }
})();
