// かくれ怪盗 E2E その2: 進行だけのホスト＋参加者4人＋端末なし3人（7人）。端末なしの人を足す・代わりに押す・
// しらべのルーペ・話し合いの時間・端末なしのかしら／主任／ルーペの代わり。
// 後半は、ホストも遊ぶ4人で、参加者の読み込み直し・見回り中の切断と選びなおし・名前の取り置き・ホストの読み込み直し
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ══ B: 7人（端末なし3人）・ルーペ・話し合いの時間 ══
  {
    const H = await L.newClient('B-host');
    const code = await L.createRoom(H, 'メンター');
    const guests = ['アキラ', 'ソラ', 'リク', 'ハナ'];
    const nodev = ['ユウ', 'ミオ', 'ケン'];
    const C = {};
    for (const nm of guests) { C[nm] = await L.newClient('B-' + nm); await L.joinRoom(C[nm], nm, code); }
    check('B1 ホストも遊ぶときは端末なしを足せない', !(await L.visible(H, '#nodev-form')));
    await H.page.click('#host-plays');
    await L.waitVisible(H, '#nodev-form');
    for (const nm of nodev) {
      await H.page.fill('#nodev-name', nm);
      await H.page.click('#nodev-form button[type=submit]');
      await L.waitFor(async () => !!(await L.roomOf(code)).proxies?.[nm] && (await H.page.inputValue('#nodev-name')) === '');
    }
    check('B2 端末なしの人も数に入る（7人）', await L.waitFor(async () => (await L.text(H, '#lobby-count')).includes('遊ぶ人 7人')));
    check('B3 端末なしがいると、ホストは遊ぶにできない', await H.page.isDisabled('#host-plays'));
    check('B4 端末なしの印はホストにだけ', (await L.text(H, '#lobby-people')).includes('端末なし') && !(await L.text(C['アキラ'], '#lobby-people')).includes('端末なし'));
    await H.page.fill('#nodev-name', 'ソラ');
    await H.page.click('#nodev-form button[type=submit]');
    await L.waitText(H, '#nodev-msg', '使われている');
    check('B5 参加者と同じ名前は足せない', true);
    // 端末なしの参加者がいる名前では入れない
    const dup = await L.newClient('B-dup');
    await L.open(dup, '?room=' + code);
    await L.waitScreen(dup, 'join');
    await dup.page.fill('#guestName', 'ミオ');
    await dup.page.click('#btnJoinRoom');
    await L.waitText(dup, '#joinError', 'その名前は使われている');
    check('B6 端末なしの人と同じ名前では入れない', true);
    await dup.context.close();

    await H.page.click('#lobby-opts input[data-key="lens"]');
    await L.waitFor(async () => (await L.roomOf(code)).opts?.lens === true);
    await H.page.selectOption('#talk-select', '60');
    check('B7 参加者の待合室にルーペと時間', await L.waitFor(async () => { const t = await L.text(C['アキラ'], '#lobby-opts-view'); return t.includes('しらべのルーペ') && t.includes('話し合いの時間 1分'); }));
    check('B8 設定を続けて変えても両方残る', (await L.roomOf(code)).opts.lens === true && (await L.roomOf(code)).opts.talk === 60);

    await H.page.click('#btn-start');
    const gs = guests.map((n) => C[n]);
    await L.waitPhaseAll(gs.concat(H), 'reveal');
    check('B9 ホストに代わりに押す欄が3人分', await L.waitFor(async () => (await H.page.$$('.kk-proxy__row')).length === 3));
    check('B10 進行だけのホストには自分の役が出ない', (await H.page.$$('.kk-flip')).length === 0);
    const roles = {};
    let bossName = null;
    for (const nm of guests) { const r = await L.readRole(C[nm]); roles[nm] = r.role; if (r.boss) bossName = nm; }
    for (const nm of nodev) {
      const row = L.proxyRow(H, nm);
      await row.locator('button', { hasText: '役を見る' }).click();
      await row.locator('.kk-role__name').waitFor();
      roles[nm] = (await row.locator('.kk-role__name > span:last-child').textContent()).replace('あなたは ', '').trim();
      if (await row.locator('.kk-role__boss').count()) bossName = nm;
      await row.locator('button', { hasText: '役をかくす' }).click();
      await sleep(100);
    }
    const everyone = guests.concat(nodev);
    check('B11 7人なら怪盗3人', everyone.filter((n) => L.isThiefRole(roles[n])).length === 3, roles);
    check('B12 かしらがいる', !!bossName, roles);
    for (const nm of guests) await C[nm].page.click('#stage .btn-primary');
    for (const nm of nodev) { await L.proxyRow(H, nm).locator('button', { hasText: '役を伝えた' }).click(); await sleep(150); }
    check('B13 代わりに「役を伝えた」', await L.waitFor(async () => Object.keys((await L.roomOf(code)).game.seen || {}).length === 7));
    await H.page.click('#tools .btn-primary');
    await L.waitPhaseAll(gs, 'propose');
    check('B14 話し合いの残り時間が出る', await L.waitFor(async () => ((await L.text(C['アキラ'], '.kk-timer')) || '').includes('残り')));

    const actor = (nm) => (nodev.includes(nm) ? H : C[nm]);
    const watcher = C[guests[0]];
    async function propose(size) {
      const leader = await L.leaderName(H);
      const P = actor(leader);
      const team = everyone.filter((n) => !L.isThiefRole(roles[n])).slice(0, size);
      for (const m of team) { await L.pickBtn(P, m).click(); await L.waitFor(async () => (await L.text(watcher, '#stage')).includes(m), 3000); }
      await L.waitFor(async () => !(await P.page.isDisabled('#stage .btn-primary')), 3000);
      await P.page.click('#stage .btn-primary');
      return { team, leader };
    }
    const SIZES = [2, 3, 3];
    let lensChecked = false;
    for (let r = 0; r < 3; r += 1) {
      await L.waitPhaseAll(gs, 'propose');
      const { team, leader } = await propose(SIZES[r]);
      if (r === 0) check('B15 主任が端末なしでもホストが選べる（または主任が選ぶ）', true, leader);
      await L.waitPhaseAll(gs, 'vote');
      for (const nm of guests) { await L.waitVisible(C[nm], '.kk-choice--yes'); await C[nm].page.click('.kk-choice--yes'); }
      for (const nm of nodev) { await L.proxyRow(H, nm).locator('button', { hasText: '賛成' }).click(); await sleep(150); }
      check('B16 代わりの票も入って開く ' + r, await L.waitFor(async () => (await L.phaseOf(H)) === 'voteResult'));
      await H.page.click('#tools .btn-primary');
      await L.waitPhaseAll(gs, 'mission');
      for (const nm of team) {
        if (nodev.includes(nm)) { await L.proxyRow(H, nm).locator('button', { hasText: '異常なし' }).click(); await sleep(150); }
        else { await L.waitVisible(C[nm], '.kk-choice--safe'); await C[nm].page.click('.kk-choice--safe'); }
      }
      check('B17 代わりの札も入って結果 ' + r, await L.waitFor(async () => (await L.phaseOf(H)) === 'missionResult'));
      if (r === 1) {
        check('B18 2回目のあとはルーペへ', (await L.text(H, '#tools')).includes('しらべのルーペへ'));
        await H.page.click('#tools .btn-primary');
        await L.waitPhaseAll(gs, 'lens');
        const holder = await L.lensName(H);
        const P = actor(holder);
        const cands = await P.page.$$eval('#stage .kk-pick__name', (xs) => xs.map((x) => x.textContent.replace('（自分）', '')));
        check('B19 自分は確かめられない（6人から選ぶ）', !cands.includes(holder) && cands.length === 6, { holder, cands });
        const target = cands[0];
        await L.pickBtn(P, target).click();
        await L.waitText(P, '#stage .btn-primary', target + 'を確かめる');
        await P.page.click('#stage .btn-primary');
        await L.waitPhaseAll(gs, 'lensResult');
        check('B20 ルーペの結果は本当のチーム', await L.waitFor(async () => ((await L.text(P, '.kk-lensres__text')) || '').includes(L.isThiefRole(roles[target]) ? '怪盗チーム' : '警備員チーム')), { holder, target });
        const others = guests.filter((n) => n !== holder);
        let leak = false;
        for (const nm of others) if ((await C[nm].page.$$('.kk-lensres')).length) leak = true;
        check('B21 ほかの人の画面に結果は出ない', !leak);
        check('B22 だれがだれを確かめたかはみんなに出る', (await L.text(C[others[0]], '#banner')).includes(target));
        check('B23 ルーペが確かめた人に渡る', await L.waitFor(async () => (await L.lensName(H)) === target));
        await L.shot(P, 'B-lens-result');
        lensChecked = true;
      }
      await H.page.click('#tools .btn-primary');
    }
    check('B24 ルーペを確かめた', lensChecked);
    await L.waitPhaseAll(gs.concat(H), 'guess');
    check('B25 見やぶりにも残り時間', await L.waitFor(async () => ((await L.text(C['アキラ'], '#stage')) || '').includes('残り')));
    const BP = actor(bossName);
    const guessTarget = everyone.find((n) => !L.isThiefRole(roles[n]) && roles[n] !== '名探偵');
    await L.pickBtn(BP, guessTarget).click();
    await L.waitText(BP, '#stage .btn-primary', guessTarget + 'が名探偵だ');
    await BP.page.click('#stage .btn-primary');
    await L.waitPhaseAll(gs.concat(H), 'end');
    check('B26 かしらが端末なしでもホストが決められる（または本人）', (await L.text(H, '#banner')).includes('警備員チームの勝ち'), { bossName });
    check('B27 おしまいでは代わりに押す欄を出さない', (await H.page.$$('.kk-proxy')).length === 0);
    await L.shot(H, 'B-end-host');
    await H.page.click('#btnLeave');
    await L.waitScreen(H, 'top');
    for (const c of gs) await c.context.close();
  }

  // ══ C: ホストも遊ぶ4人。読み込み直し・切断・名前の取り置き ══
  {
    const names = ['ホスト', 'アオ', 'キイ', 'ミド'];
    const C = {};
    C[names[0]] = await L.newClient('C-host');
    const code = await L.createRoom(C[names[0]], names[0]);
    for (const nm of names.slice(1)) { C[nm] = await L.newClient('C-' + nm); await L.joinRoom(C[nm], nm, code); }
    const H = C[names[0]];
    await L.waitFor(async () => (await L.text(H, '#lobby-count')).includes('遊ぶ人 4人'));
    await H.page.click('#btn-start');
    const all = names.map((n) => C[n]);
    await L.waitPhaseAll(all, 'reveal');
    const roles = {};
    for (const nm of names) roles[nm] = (await L.readRole(C[nm])).role;
    check('C1 4人なら怪盗1人', names.filter((n) => L.isThiefRole(roles[n])).length === 1, roles);
    // 参加者の読み込み直し → 同じ役で続きから
    await C['キイ'].page.reload();
    await L.waitPhase(C['キイ'], 'reveal');
    check('C2 読み込み直しても同じ役', (await L.readRole(C['キイ'])).role === roles['キイ']);
    for (const nm of names) await C[nm].page.click('#stage .btn-primary');
    await L.waitFor(async () => Object.keys((await L.roomOf(code)).game.seen || {}).length === 4);
    await H.page.click('#tools .btn-primary');
    await L.waitPhaseAll(all, 'propose');
    // ホストの読み込み直し → ホストのまま続きから
    await H.page.reload();
    await L.waitPhase(H, 'propose');
    check('C3 ホストは読み込み直してもホストのまま', (await L.text(H, '#btnLeave')) === 'ルームを閉じる' && (await L.roomOf(code)).hostConnected === true);
    // 見回りに行く人を選んで出発
    const leader = await L.leaderName(H);
    const team = names.filter((n) => n !== leader).slice(0, 2);
    const gone = team.find((n) => n !== 'ホスト');
    for (const m of team) { await L.pickBtn(C[leader], m).click(); await sleep(200); }
    await L.waitFor(async () => !(await C[leader].page.isDisabled('#stage .btn-primary')), 3000);
    await C[leader].page.click('#stage .btn-primary');
    await L.waitPhaseAll(all, 'vote');
    for (const nm of names) await C[nm].page.click('.kk-choice--yes');
    await L.waitPhaseAll(all, 'voteResult');
    await H.page.click('#tools .btn-primary');
    await L.waitPhaseAll(all, 'mission');
    // メンバーの1人が切れる → ホストに「選びなおす」
    C[gone].offlineOk = true;
    await C[gone].context.close();
    check('C4 切れた人は在室から消える', await L.waitFor(async () => !(await L.roomOf(code)).players?.[gone], 90000));
    check('C5 ホストに「選びなおす」', await L.waitFor(async () => ((await L.text(H, '#tools')) || '').includes('選びなおす'), 10000));
    check('C6 遊んでいる人の札に「通信が切れた」', ((await L.text(C[names.find((n) => n !== gone && n !== 'ホスト')], '#players')) || '').includes('通信が切れた'));
    // 同じ名前でほかの人（別の匿名ID）は入れない
    const imp = await L.newClient('C-imp');
    await L.open(imp, '?room=' + code);
    await L.waitScreen(imp, 'join');
    await imp.page.fill('#guestName', gone);
    await imp.page.click('#btnJoinRoom');
    await L.waitText(imp, '#joinError', 'その名前は使われている');
    check('C7 遊んでいる人の名前はほかの人に使えない', true);
    // 途中から入った人は見ているだけ
    await imp.page.fill('#guestName', 'チャ');
    await imp.page.click('#btnJoinRoom');
    await L.waitPhase(imp, 'mission');
    check('C8 途中から入った人は見ているだけ', ((await L.text(imp, '#barMe')) || '').includes('見ているだけ') && (await imp.page.$$('#mycard-box:not([hidden])')).length === 0);
    await H.page.locator('#tools .btn-secondary', { hasText: '選びなおす' }).click();
    await L.waitPhase(H, 'propose');
    check('C9 選びなおしにもどる（回数は増えない）', ((await L.text(H, '#rejects')) || '').includes('1回目'));
    await L.shot(H, 'C-host-redo');
    // ホストが切れると、参加者にオーバーレイ
    H.offlineOk = true;
    await H.context.setOffline(true);
    const other = C[names.find((n) => n !== gone && n !== 'ホスト')];
    check('C10 ホストが切れると参加者にオーバーレイ', await L.waitFor(() => L.visible(other, '#hostOffOverlay'), 90000));
    await H.context.setOffline(false);
    check('C11 ホストが戻るとオーバーレイが消える', await L.waitFor(async () => !(await L.visible(other, '#hostOffOverlay')), 30000));
    await H.page.click('#btnLeave');
    await L.waitScreen(H, 'top');
  }

  // ══ D: 進行だけのホスト＋4人。見やぶりの途中でかしらが切れたら、ホストが代わりに決める ══
  {
    const H = await L.newClient('D-host');
    const code = await L.createRoom(H, 'メンター');
    const names = ['アオ', 'キイ', 'ミド', 'シロ'];
    const C = {};
    for (const nm of names) { C[nm] = await L.newClient('D-' + nm); await L.joinRoom(C[nm], nm, code); }
    await H.page.click('#host-plays');
    await L.waitFor(async () => (await L.text(H, '#lobby-count')).includes('遊ぶ人 4人'));
    await H.page.click('#btn-start');
    const all = names.map((n) => C[n]);
    await L.waitPhaseAll(all, 'reveal');
    const roles = {};
    let boss = null;
    for (const nm of names) { const r = await L.readRole(C[nm]); roles[nm] = r.role; if (r.boss) boss = nm; }
    check('D1 4人なら怪盗1人がかしら', !!boss && names.filter((n) => L.isThiefRole(roles[n])).length === 1, roles);
    for (const nm of names) await C[nm].page.click('#stage .btn-primary');
    await L.waitFor(async () => Object.keys((await L.roomOf(code)).game.seen || {}).length === 4);
    await H.page.click('#tools .btn-primary');
    const guards = names.filter((n) => n !== boss);
    for (let r = 0; r < 3; r += 1) {
      await L.waitPhaseAll(all, 'propose');
      const leader = await L.leaderName(H);
      for (const m of guards.slice(0, 2)) { await L.pickBtn(C[leader], m).click(); await L.waitFor(async () => (await L.text(C[boss], '#stage')).includes(m), 3000); }
      await L.waitFor(async () => !(await C[leader].page.isDisabled('#stage .btn-primary')), 3000);
      await C[leader].page.click('#stage .btn-primary');
      await L.waitPhaseAll(all, 'vote');
      for (const nm of names) await C[nm].page.click('.kk-choice--yes');
      await L.waitPhaseAll(all, 'voteResult');
      await H.page.click('#tools .btn-primary');
      await L.waitPhaseAll(all, 'mission');
      for (const nm of guards.slice(0, 2)) await C[nm].page.click('.kk-choice--safe');
      await L.waitPhaseAll(all, 'missionResult');
      await H.page.click('#tools .btn-primary');
    }
    await L.waitPhaseAll(all, 'guess');
    check('D2 かしらがいるあいだ、ホストに決めるボタンは出ない', (await H.page.$$('#stage .kk-pick__btn')).length === 0);
    C[boss].offlineOk = true;
    await C[boss].context.close();
    check('D3 かしらが切れたら、ホストに選ぶボタン', await L.waitFor(async () => (await H.page.$$('#stage .kk-pick__btn')).length === 3, 90000));
    const target = guards.find((n) => roles[n] !== '名探偵');
    await L.pickBtn(H, target).click();
    await L.waitText(H, '#stage .btn-primary', target + 'が名探偵だ');
    await H.page.click('#stage .btn-primary');
    await L.waitPhase(H, 'end');
    check('D4 ホストが代わりに決めて、おしまい', (await L.text(H, '#banner')).includes('警備員チームの勝ち'));
    await H.page.click('#btnLeave');
    await L.waitScreen(H, 'top');
  }

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
