// かくれ怪盗 E2E その1: ホストも遊ぶ5人。作成・参加・同じ名前・みんなにみせる画面・役を配る・選びなおし・
// 投票・見回り（すり替え）・見やぶり・おしまい・もう一回・待合室へ・幅 375px・退出・ルームを閉じる
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const names = ['メンター', 'アキラ', 'ソラ', 'リク', 'ハナ'];
  const C = {};
  C[names[0]] = await L.newClient('host');
  const code = await L.createRoom(C[names[0]], names[0]);
  check('A1 ルームコード6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('A2 room-create を数えた', await L.waitStats(C[names[0]], 'room-create', 1));
  for (const nm of names.slice(1)) {
    C[nm] = await L.newClient(nm);
    await L.joinRoom(C[nm], nm, code);
  }
  const H = C[names[0]];
  check('A3 ホストの待合室に5人', await L.waitFor(async () => (await H.page.$$('#lobby-people li')).length === 5));
  check('A4 参加用のリンクのコードはアドレスから外れる', !(C['アキラ'].page.url().includes('room=')));
  check('A5 遊ぶ人5人と出る', (await L.text(H, '#lobby-count')).includes('遊ぶ人 5人'));
  check('A6 参加者には役の設定が見るだけで出る', await L.visible(C['ソラ'], '#lobby-opts-view') && !(await L.visible(C['ソラ'], '#lobby-opts')));
  check('A7 参加者には端末なしを足す欄が出ない', !(await L.visible(C['ソラ'], '#nodev-form')));

  // 同じ名前は入れない
  const dup = await L.newClient('dup');
  await L.open(dup, '?room=' + code);
  await L.waitScreen(dup, 'join');
  await dup.page.fill('#guestName', '12');
  await dup.page.click('#btnJoinRoom');
  await L.waitText(dup, '#joinError', '数字だけ');
  check('A8a 数字だけの名前は使えない', true);
  await dup.page.fill('#guestName', 'ソラ');
  await dup.page.click('#btnJoinRoom');
  await L.waitText(dup, '#joinError', 'その名前は使われている');
  check('A8 同じ名前は入れない', true);
  await dup.context.close();

  // みんなにみせる画面
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 860 } });
  await L.open(W, '?watch=' + code);
  await L.waitPhase(W, 'lobby');
  check('A9 みんなにみせる画面に参加のしかた', (await L.text(W, '#lobby-join-code')).includes(code));
  check('A10 みんなにみせる画面は参加者に入らない', !(await L.roomOf(code)).players?.watch && Object.keys((await L.roomOf(code)).players).length === 5);

  // 役を配る
  await H.page.click('#btn-start');
  const all = names.map((n) => C[n]);
  await L.waitPhaseAll(all.concat(W), 'reveal');
  check('A11 start を数えた', await L.waitStats(H, 'start', 1) && await L.waitStats(H, 'players-5', 1));
  check('A12 みんなにみせる画面には役が出ない', (await W.page.$$('.kk-role, .kk-flip')).length === 0);
  check('A13 配った直後は伏せてある', !(await C['アキラ'].page.isVisible('.kk-flip .kk-role__name')));
  const roles = {};
  let bossName = null;
  for (const nm of names) {
    const r = await L.readRole(C[nm]);
    roles[nm] = r.role;
    if (r.boss) bossName = nm;
  }
  const thieves = names.filter((n) => L.isThiefRole(roles[n]));
  const guards = names.filter((n) => !L.isThiefRole(roles[n]));
  check('A14 5人なら怪盗2人', thieves.length === 2, roles);
  check('A15 名探偵が1人', names.filter((n) => roles[n] === '名探偵').length === 1, roles);
  check('A16 かしらは怪盗', !!bossName && thieves.includes(bossName), { bossName, roles });
  // 怪盗は仲間を知っている
  const mate = thieves.find((n) => n !== bossName) || thieves[0];
  const knowsText = await L.text(C[mate], '.kk-flip .kk-role');
  check('A17a かしらでない怪盗は、かしらの名前を知る', mate === bossName || knowsText.includes('かしらの' + bossName), knowsText);
  check('A17 怪盗は仲間の怪盗を知る', thieves.filter((n) => n !== mate).every((n) => knowsText.includes(n)), knowsText);
  // ほかの人の画面に、自分以外の役名は出ない（自分のカードの中だけ）
  const guardPage = C[guards.find((n) => roles[n] === '警備員') || guards[0]];
  check('A18 警備員の画面に怪盗の名前の一覧は出ない', !(await L.text(guardPage, '.kk-flip .kk-role')).includes('怪盗はこの人たち'));

  for (const nm of names) await C[nm].page.click('#stage .btn-primary');
  check('A19 全員たしかめた', await L.waitFor(async () => Object.keys((await L.roomOf(code)).game.seen || {}).length === 5));
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'propose');

  // 1回目のメンバー選び → 全員反対 → 選びなおし（主任が交代）
  const leader1 = await L.leaderName(H);
  const L1 = C[leader1];
  check('A20 主任の画面に選ぶボタン', (await L1.page.$$('#stage .kk-pick__btn')).length === 5);
  const notLeader = names.find((n) => n !== leader1);
  check('A21 主任でない人には選ぶボタンが出ない', (await C[notLeader].page.$$('#stage .kk-pick__btn')).length === 0);
  async function propose(team) {
    const leader = await L.leaderName(H);
    const P = C[leader];
    for (const m of team) { await L.pickBtn(P, m).click(); await L.waitFor(async () => (await L.text(C[notLeader], '#stage')).includes(m), 3000); }
    await L.waitFor(async () => !(await P.page.isDisabled('#stage .btn-primary')), 3000);
    await P.page.click('#stage .btn-primary');
  }
  async function voteAll(yes) {
    for (const nm of names) {
      await L.waitVisible(C[nm], '.kk-choice--yes');
      await C[nm].page.click(yes(nm) ? '.kk-choice--yes' : '.kk-choice--no');
    }
  }
  await propose(guards.slice(0, 2));
  await L.waitPhaseAll(all, 'vote');
  check('A22 投票の途中は、だれが何に入れたか出ない', !(await L.text(W, '#stage')).includes('反対'));
  await voteAll(() => false);
  await L.waitPhaseAll(all.concat(W), 'voteResult');
  check('A23 反対が多いと選びなおし', (await L.text(W, '#banner')).includes('選びなおし'));
  check('A24 開いたら、だれが反対したか出る', (await W.page.$$('.kk-vote--no')).length === 5);
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'propose');
  const leader2 = await L.leaderName(H);
  check('A25 主任がとなりに交代', leader2 && leader2 !== leader1);
  check('A26 メンバー選び2回目', (await L.text(W, '#rejects')).includes('2回目'));

  // 1回目の見回り: 警備員2人 → 守った
  await propose(guards.slice(0, 2));
  await L.waitPhaseAll(all, 'vote');
  await voteAll(() => true);
  await L.waitPhaseAll(all, 'voteResult');
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'mission');
  check('A27 警備員は「すり替える」を押せない', await C[guards[0]].page.isDisabled('.kk-choice--swap'));
  for (const nm of guards.slice(0, 2)) await C[nm].page.click('.kk-choice--safe');
  await L.waitPhaseAll(all.concat(W), 'missionResult');
  check('A28 守った', (await L.text(W, '#banner')).includes('守った'));
  const room1 = await L.roomOf(code);
  check('A29 出した札はだれのものか残さない（出したかどうかだけ）', Object.values(room1.game.submitted || {}).every((v) => v === true) && !/"(safe|swap)"/.test(JSON.stringify(room1.game.submitted || {})) && !room1.game.cards && room1.game.lastMission.safe === 2, room1.game.submitted);
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'propose');

  // 2回目: 怪盗を入れて、すり替える
  await propose([thieves[0], guards[0], guards[1]]);
  await L.waitPhaseAll(all, 'vote');
  await voteAll(() => true);
  await L.waitPhaseAll(all, 'voteResult');
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'mission');
  await C[thieves[0]].page.click('.kk-choice--swap');
  for (const nm of guards.slice(0, 2)) await C[nm].page.click('.kk-choice--safe');
  await L.waitPhaseAll(all.concat(W), 'missionResult');
  check('A30 すり替えられた', (await L.text(W, '#banner')).includes('すり替えられた'));
  check('A31 枚数だけ出る', (await L.text(W, '#game-sub')).includes('すり替え 1枚'));
  await sleep(2600); // 札がめくれる演出を待ってから写す
  await L.shot(W, 'A-watch-mission-result');
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'propose');

  // 375px で横にはみ出さない
  await C['ハナ'].page.setViewportSize({ width: 375, height: 760 });
  await sleep(300);
  check('A32 375px の参加者に横スクロールなし', (await L.overflow(C['ハナ'])) <= 0);
  await L.shot(C['ハナ'], 'A-guest-375');

  // 3回目・4回目: 警備員だけ → 3回守って見やぶりへ
  const sizes = [2, 3];
  for (const size of sizes) {
    await propose(guards.slice(0, size));
    await L.waitPhaseAll(all, 'vote');
    await voteAll(() => true);
    await L.waitPhaseAll(all, 'voteResult');
    await H.page.click('#tools .btn-primary');
    await L.waitPhaseAll(all, 'mission');
    for (const nm of guards.slice(0, size)) await C[nm].page.click('.kk-choice--safe');
    await L.waitPhaseAll(all, 'missionResult');
    await H.page.click('#tools .btn-primary');
  }
  await L.waitPhaseAll(all.concat(W), 'guess');
  const guessStage = await L.text(W, '#stage');
  check('A33 見やぶりで怪盗チームの正体が出る', thieves.every((n) => guessStage.includes(n)), guessStage);
  const detective = names.find((n) => roles[n] === '名探偵');
  const B = C[bossName];
  check('A34 かしらに決めるボタン', await L.visible(B, '#stage .btn-primary'));
  const other = thieves.find((n) => n !== bossName);
  check('A35 かしらでない怪盗に決めるボタンは出ない', !(await L.visible(C[other], '#stage .btn-primary')));
  await L.pickBtn(B, detective).click();
  await L.waitText(B, '#stage .btn-primary', detective + 'が名探偵だ');
  await B.page.click('#stage .btn-primary');
  await L.waitPhaseAll(all.concat(W), 'end');
  check('A36 名探偵を見やぶって怪盗チームの逆転勝ち', (await L.text(W, '#banner')).includes('逆転'));
  check('A37 おしまいで全員の役が出る', (await W.page.$$('.kk-roles__item')).length === 5);
  check('A38 finish を1回数えた', await L.waitStats(B, 'finish', 1) && (await L.stats(H, 'finish')) === 0);
  await sleep(800);
  await L.shot(W, 'A-watch-end');

  // もう一回 → 役を配りなおす
  await H.page.click('#tools .btn-primary');
  await L.waitPhaseAll(all, 'reveal');
  check('A39 もう一回で配りなおす', Number((await L.roomOf(code)).game.gid) === 2 && await L.waitStats(H, 'start', 2));
  // ゲームの途中で待合室へ
  await H.page.locator('#tools .kk-quiet', { hasText: '待合室にもどる' }).click();
  await L.waitPhaseAll(all, 'lobby');
  check('A40 待合室にもどる', !(await L.roomOf(code)).game);

  // 退出・ルームを閉じる
  await C['リク'].page.click('#btnLeave');
  await L.waitScreen(C['リク'], 'top');
  check('A41 退出すると在室が消える', await L.waitFor(async () => !(await L.roomOf(code)).players['リク']));
  await H.page.click('#btnLeave');
  await L.waitScreen(H, 'top');
  check('A42 ルームを閉じると消える', await L.waitFor(async () => (await L.roomOf(code)) === null));
  await L.waitScreen(C['ソラ'], 'top');
  check('A43 参加者はトップへ', true);
  await L.waitScreen(W, 'watch-end');
  check('A44 みんなにみせる画面は終わりの表示', true);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
