// ひともじチェンジ E2E その1: 1台の画面・作成・参加・待合室・順番・パス・端末なし・1つ戻す・ヒント・ゴール・次のお題・
// だれでも（同時に押す）・途中参加・再読み込み・自分で決めるお題・進行だけのホスト・ことばの判定（ホストが決める）・375px・退出・ルームを閉じる
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const T = require('./lib.cjs');
const { check, sleep } = T;
const L = require(path.join(__dirname, '../../apps/hitomoji-change/logic.js'));
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../../apps/hitomoji-change/words.js'), 'utf8').replace(/\bexport\s+const\s+/g, 'var '), ctx);
const VOCAB = ctx.VOCAB;

const word = (room) => L.currentWord(L.gameOf(room));
const len = (room) => L.gameOf(room)?.ladder.length || 0;

(async () => {
  const server = await T.startServer();
  check('rules loaded', await T.loadRules(path.join(T.WORK, 'database.rules.json')));
  await T.launch();

  // ── 1台の画面 ──
  const solo = await T.newClient('solo');
  await T.open(solo);
  await solo.page.click('#btnGoLocal');
  await T.waitScreen(solo, 'local');
  check('local start disabled first', await solo.page.isDisabled('#btnStart'));
  await solo.page.click('#levelGrid .hmc-level[data-level="two"]');
  await solo.page.click('#btnStart');
  await T.waitScreen(solo, 'play');
  check('local no turn bar', !(await T.visible(solo, '#turnBar')));
  check('local no room bar', !(await T.visible(solo, '#roomBar')));
  for (let k = 0; k < 8 && !(await T.visible(solo, '#clearArea')); k++) {
    await solo.page.click('#btnHint');
    await solo.page.click('#btnHint');
    const m = (await T.text(solo, '#hintText')).match(/「(.+)」/);
    const next = Array.from(m[1]);
    const cur = (await T.tiles(solo)).map((t) => t.ch);
    const pos = cur.findIndex((ch, i) => ch !== next[i]);
    await T.change(solo, pos, next[pos]);
  }
  check('local cleared', await T.visible(solo, '#clearArea'));
  await solo.page.click('#btnTop');
  await T.waitScreen(solo, 'top');
  check('local no socket', solo.sockets === 0, solo.sockets);

  // ── 作成・参加 ──
  const host = await T.newClient('host');
  const sora = await T.newClient('sora');
  const midori = await T.newClient('midori');
  const code = await T.createRoom(host, 'メンター');
  check('room code', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('stats room-create', await T.waitStats(host, 'room-create', 1));
  await T.open(sora, '?room=' + code);
  await T.waitScreen(sora, 'join');
  check('link hint', await T.visible(sora, '#joinLinkHint'));
  check('code filled', (await sora.page.inputValue('#joinCode')) === code);
  await sora.page.fill('#guestName', 'そら');
  await sora.page.click('#btnJoinRoom');
  await T.waitScreen(sora, 'waiting');
  check('link removed from url', !(await sora.page.evaluate(() => location.search.includes('room='))));
  // みどりは、トップから打って入る
  await T.open(midori);
  await midori.page.click('#btnGoJoin');
  check('no link hint from top', !(await T.visible(midori, '#joinLinkHint')));
  await midori.page.fill('#guestName', 'そら');
  await midori.page.fill('#joinCode', code.toLowerCase());
  await midori.page.click('#btnJoinRoom');
  await T.waitText(midori, '#joinError', 'その名前は使われているよ');
  check('dup name rejected', true);
  await midori.page.fill('#guestName', 'みどり');
  await midori.page.click('#btnJoinRoom');
  await T.waitScreen(midori, 'waiting');

  // ── 待合室 ──
  await T.waitText(host, '#waitingCount', '3人');
  check('guest sees no host tools', !(await T.visible(sora, '#hostWaitingTools')) && await T.visible(sora, '#guestWaitingNote'));
  check('order default turn', (await host.page.getAttribute('#roomOrder [data-order="turn"]', 'aria-checked')) === 'true');
  check('judge default host', (await host.page.getAttribute('#roomJudge [data-judge="host"]', 'aria-checked')) === 'true');
  await T.waitText(sora, '#waitingSettings', 'ことばの判定: ホストが決める');
  // ここからしばらくは「みんなで決める」で流す（ホストが決めるは、あとでまとめて見る）
  await host.page.click('#roomJudge [data-judge="all"]');
  await T.waitText(sora, '#waitingSettings', 'ことばの判定: みんなで決める');
  await host.page.click('#roomLevelGrid .hmc-level[data-level="three"]');
  await T.waitText(sora, '#waitingSettings', 'お題: 3文字');
  await host.page.click('#roomLevelGrid .hmc-level[data-level="two"]');
  await T.waitText(sora, '#waitingSettings', 'お題: 2文字');
  // 端末なしの参加者
  await host.page.fill('#proxyName', 'そら');
  await host.page.click('#btnAddProxy');
  await T.waitText(host, '#proxyError', 'その名前は使われているよ');
  await host.page.fill('#proxyName', 'あお');
  await host.page.click('#btnAddProxy');
  await T.waitText(host, '#waitingCount', '4人');
  await T.waitText(sora, '#waitingCount', '4人');
  const hostTags = await host.page.$$eval('#waitingPlayers .hmc-person', (els) => els.map((e) => e.textContent));
  const soraTags = await sora.page.$$eval('#waitingPlayers .hmc-person', (els) => els.map((e) => e.textContent));
  check('proxy mark host only', hostTags.some((t) => t.includes('あお') && t.includes('端末なし')) && soraTags.some((t) => t.includes('あお') && !t.includes('端末なし')), { hostTags, soraTags });
  await host.page.click('#waitingPlayers button[aria-label="あおを外す"]');
  await T.waitText(host, '#waitingCount', '3人');
  await host.page.fill('#proxyName', 'あお');
  await host.page.click('#btnAddProxy');
  await T.waitText(host, '#waitingCount', '4人');

  // ── はじめる（順番に） ──
  await host.page.click('#btnStartGame');
  for (const c of [host, sora, midori]) await T.waitScreen(c, 'play');
  check('stats room-chars2', await T.waitStats(host, 'room-chars2', 1));
  check('stats players-4', await T.waitStats(host, 'players-4', 1));
  let room = await T.roomOf(code);
  check('turn host first', L.turnOf(room) === 'メンター', L.turnOf(room));
  await T.waitText(host, '#turnText', 'あなたの番');
  await T.waitText(sora, '#turnText', 'メンターの番');
  check('guest tiles disabled', (await T.tiles(sora)).every((t) => t.disabled));
  check('guest no hint button', !(await T.visible(sora, '#btnHint')) && !(await T.visible(sora, '#btnSkip')));
  check('host has pass', await T.visible(host, '#btnPass'));
  check('guest no pass', !(await T.visible(sora, '#btnPass')));

  // メンターが変える
  let st = T.nextStep(L, VOCAB, room);
  await T.change(host, st.pos, st.ch);
  room = await T.roomWhen(code, (r) => len(r) === 2);
  check('host moved', word(room) === st.word && L.turnOf(room) === 'そら');
  await T.waitText(sora, '#turnText', 'あなたの番');
  check('ladder synced', (await T.ladder(midori)).length === 2);
  check('sora tiles enabled', (await T.tiles(sora)).every((t) => !t.disabled));
  // そらのパス
  await sora.page.click('#btnPass');
  room = await T.roomWhen(code, (r) => L.turnOf(r) === 'みどり');
  check('sora passed', L.turnOf(room) === 'みどり' && len(room) === 2);
  await T.waitText(midori, '#turnText', 'あなたの番');
  // みどりが変える
  st = T.nextStep(L, VOCAB, room);
  if (st) {
    await T.change(midori, st.pos, st.ch);
    room = await T.roomWhen(code, (r) => len(r) === 3);
  }
  // ゴールしていなければ、あお（端末なし）の番
  if (room && !L.gameOf(room).cleared) {
    check('proxy turn', L.turnOf(room) === 'あお', L.turnOf(room));
    await T.waitText(host, '#turnText', 'あおの番。代わりに入れてね');
    await T.waitText(sora, '#turnText', 'あおの番');
    check('host can type for proxy', (await T.tiles(host)).every((t) => !t.disabled));
    // ヒント（ホストだけ）。みんなの画面に出る
    await host.page.click('#btnHint');
    await T.waitText(sora, '#hintText', '光っている');
    check('hint glow on guest', (await T.tiles(sora)).some((t) => t.hint));
    await host.page.click('#btnHint');
    await T.waitText(midori, '#hintText', 'たとえば');
    st = T.nextStep(L, VOCAB, room);
    await T.change(host, st.pos, st.ch);
    room = await T.roomWhen(code, (r) => len(r) === 4);
    const last = L.gameOf(room).ladder[3];
    check('proxy move by aoi', last.by === 'あお', last);
    await T.waitHidden(sora, '#hintArea');
    // 1つ戻す: みどりは押せない（最後はあお）／ホストは押せる → あおの番にもどる
    if (!L.gameOf(room).cleared) {
      check('midori cannot undo', !(await T.visible(midori, '#btnUndo')));
      await host.page.click('#btnUndo');
      room = await T.roomWhen(code, (r) => len(r) === 3);
      check('undo back to proxy turn', L.turnOf(room) === 'あお');
    }
  }
  // ゴールまで進める（番の人の画面で。あおの番はホスト）
  const byName = { 'メンター': host, 'そら': sora, 'みどり': midori, 'あお': host };
  for (let k = 0; k < 12; k++) {
    room = await T.roomOf(code);
    if (L.gameOf(room).cleared) break;
    st = T.nextStep(L, VOCAB, room);
    const who = byName[L.turnOf(room)];
    const n = len(room);
    await T.waitVisible(who, `#tiles .hmc-tile[data-pos="${st.pos}"]:not([disabled])`);
    await T.change(who, st.pos, st.ch);
    await T.roomWhen(code, (r) => len(r) === n + 1);
  }
  room = await T.roomOf(code);
  check('cleared', L.gameOf(room).cleared && word(room) === L.gameOf(room).puzzle.goal);
  for (const c of [host, sora, midori]) await T.waitVisible(c, '#clearArea');
  check('guest waits', await T.visible(sora, '#clearWait') && !(await T.visible(sora, '#btnNext')));
  check('host next visible', await T.visible(host, '#btnNext'));
  await host.page.screenshot({ path: path.join(T.OUT, 'host-clear.png'), fullPage: true });
  const firstPuzzle = L.gameOf(room).puzzle;
  const lastBy = L.gameOf(room).ladder[len(room) - 1].by;
  await host.page.click('#btnNext');
  room = await T.roomWhen(code, (r) => L.gameOf(r)?.id === 2);
  check('next puzzle', L.gameOf(room).id === 2 && (L.gameOf(room).puzzle.start !== firstPuzzle.start || L.gameOf(room).puzzle.goal !== firstPuzzle.goal));
  check('turn rotates', L.turnOf(room) === L.nextAfter(room, lastBy), { turn: L.turnOf(room), lastBy });
  await T.waitHidden(sora, '#clearArea');

  // ── 途中参加・再読み込み ──
  const haru = await T.newClient('haru');
  await T.open(haru, '?room=' + code);
  await T.waitScreen(haru, 'join');
  await haru.page.fill('#guestName', 'はる');
  await haru.page.click('#btnJoinRoom');
  await T.waitScreen(haru, 'play');
  check('mid join to play', (await T.ladder(haru)).length >= 1);
  room = await T.roomOf(code);
  check('haru participant last', L.participants(room).slice(-1)[0].name === 'はる');
  await sora.page.reload();
  await T.waitScreen(sora, 'play');
  check('reload back to play', true);

  // ── 375px ──
  await host.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('375 play no overflow', (await T.overflow(host)) <= 0, await T.overflow(host));
  await host.page.screenshot({ path: path.join(T.OUT, 'host-375-play.png'), fullPage: true });

  // ── 待合室にもどる → だれでも ──
  await host.page.click('#btnToWaiting');
  for (const c of [host, sora, midori, haru]) await T.waitScreen(c, 'waiting');
  check('375 waiting no overflow', (await T.overflow(host)) <= 0, await T.overflow(host));
  await host.page.screenshot({ path: path.join(T.OUT, 'host-375-waiting.png'), fullPage: true });
  await host.page.setViewportSize({ width: 1100, height: 900 });
  await host.page.click('#roomOrder [data-order="free"]');
  await T.waitText(sora, '#waitingSettings', '変える人: だれでも');
  await host.page.click('#btnStartGame');
  for (const c of [host, sora, midori]) await T.waitScreen(c, 'play');
  await T.waitText(sora, '#turnText', 'だれが変えてもいい');
  check('free all enabled', (await T.tiles(sora)).every((t) => !t.disabled) && (await T.tiles(midori)).every((t) => !t.disabled));
  check('free no pass', !(await T.visible(host, '#btnPass')));
  room = await T.roomOf(code);
  const n0 = len(room);
  // そらとみどりが同時に、ちがう文字を押す → 1つだけ入る
  await sora.page.click('#tiles .hmc-tile[data-pos="0"]');
  await midori.page.click('#tiles .hmc-tile[data-pos="1"]');
  // 同じ瞬間に押す（先に入った手で、もう一方の文字の表が閉じる前に）
  const pressNow = (c, ch) => c.page.evaluate((x) => {
    const b = [...document.querySelectorAll('#padGrid .hmc-key')].find((k) => k.textContent === x);
    if (!b) return false;
    b.click();
    return true;
  }, ch);
  const pressed = await Promise.all([pressNow(sora, 'ぽ'), pressNow(midori, 'ぺ')]);
  await sleep(1500);
  room = await T.roomOf(code);
  check('only one simultaneous move', len(room) === n0 + 1, { diff: len(room) - n0, pressed });
  if (pressed[0] && pressed[1]) {
    const toastSeen = await sora.page.evaluate(() => (document.getElementById('roomk-toast')?.textContent || '')) + await midori.page.evaluate(() => (document.getElementById('roomk-toast')?.textContent || ''));
    check('loser told', toastSeen.includes('ほかの人が先に変えたよ'), toastSeen);
  }
  const mover = L.gameOf(room).ladder[n0].by;
  const moverC = mover === 'そら' ? sora : midori;
  const other = mover === 'そら' ? midori : sora;
  check('mover can undo', await T.visible(moverC, '#btnUndo'));
  check('other cannot undo', !(await T.visible(other, '#btnUndo')));
  await moverC.page.click('#btnUndo');
  room = await T.roomWhen(code, (r) => len(r) === n0);
  check('free undo', len(room) === n0);

  // ── 自分で決めるお題・進行だけのホスト ──
  await host.page.click('#btnToWaiting');
  await T.waitScreen(host, 'waiting');
  await host.page.click('#roomLevelGrid .hmc-level[data-level="custom"]');
  await T.waitVisible(host, '#roomCustomForm');
  await host.page.click('#roomOrder [data-order="turn"]');
  await host.page.uncheck('#hostPlays');
  await T.waitText(sora, '#waitingPlayers', '進行役');
  await host.page.click('#btnStartGame');
  await T.waitText(host, '#roomCustomError', 'はじめのことばとゴールのことばを書いてね');
  await host.page.fill('#roomCustomStart', 'サカナ');
  await host.page.fill('#roomCustomGoal', 'たから');
  await host.page.click('#btnStartGame');
  for (const c of [host, sora]) await T.waitScreen(c, 'play');
  room = await T.roomOf(code);
  check('custom puzzle', L.gameOf(room).puzzle.start === 'さかな' && L.gameOf(room).puzzle.goal === 'たから');
  check('host not in turn', L.turnOf(room) !== 'メンター' && !L.participants(room).some((p) => p.name === 'メンター'));
  await T.waitText(host, '#playLevel', '自分で決めたお題');
  check('facilitator tiles disabled on child turn', L.isProxy(room, L.turnOf(room)) || (await T.tiles(host)).every((t) => t.disabled));
  check('facilitator can pass', await T.visible(host, '#btnPass'));
  await host.page.click('#btnPass');
  await T.roomWhen(code, (r) => L.turnOf(r) !== L.turnOf(room));

  // ── ことばの判定: ホストが決める ──
  await host.page.click('#btnToWaiting');
  for (const c of [host, sora, midori]) await T.waitScreen(c, 'waiting');
  await host.page.check('#hostPlays');
  await host.page.click('#roomLevelGrid .hmc-level[data-level="two"]');
  await host.page.click('#roomJudge [data-judge="host"]');
  await T.waitText(sora, '#waitingSettings', 'ことばの判定: ホストが決める');
  await host.page.click('#btnStartGame');
  for (const c of [host, sora, midori]) await T.waitScreen(c, 'play');
  // そらの番まで、ホストがパスで進める
  for (let k = 0; k < 6; k++) {
    room = await T.roomOf(code);
    if (L.turnOf(room) === 'そら') break;
    await T.waitVisible(host, '#btnPass');
    const before = L.turnOf(room);
    await host.page.click('#btnPass');
    await T.roomWhen(code, (r) => L.turnOf(r) !== before);
  }
  room = await T.roomOf(code);
  check('judge sora turn', L.turnOf(room) === 'そら', L.turnOf(room));
  // ゴールにならない変え方（1文字目を ぬ／ね に）
  const pickMove = (r) => {
    const g = L.gameOf(r);
    const cur = Array.from(L.currentWord(g));
    for (const ch of ['ぬ', 'ね', 'ほ']) {
      if (cur[0] === ch) continue;
      const w = [ch, ...cur.slice(1)].join('');
      if (w !== g.puzzle.goal) return { pos: 0, ch, word: w };
    }
    return null;
  };
  const nJ = len(room);
  let mv = pickMove(room);
  await T.waitVisible(sora, '#tiles .hmc-tile[data-pos="0"]:not([disabled])');
  await T.change(sora, mv.pos, mv.ch);
  room = await T.roomWhen(code, (r) => !!L.pendingOf(r));
  check('pending not committed', len(room) === nJ && L.pendingOf(room).w === mv.word && L.turnOf(room) === 'そら');
  await T.waitVisible(host, '#judgeArea');
  await T.waitText(host, '#judgeText', '「' + mv.word + '」');
  check('host sees ok/no', await T.visible(host, '#btnJudgeOk') && await T.visible(host, '#btnJudgeNo'));
  await T.waitText(sora, '#judgeText', 'ホストが見ている');
  check('mover can retry', await T.visible(sora, '#btnJudgeRetry') && !(await T.visible(sora, '#btnJudgeOk')));
  check('mover tiles hidden', !(await T.visible(sora, '#nowArea')) && !(await T.visible(sora, '#turnBar')));
  await T.waitVisible(midori, '#judgeArea');
  check('other no buttons', !(await T.visible(midori, '#btnJudgeRetry')) && !(await T.visible(midori, '#btnJudgeOk')));
  check('host no undo/pass while pending', !(await T.visible(host, '#btnUndo')) && !(await T.visible(host, '#btnPass')));
  await host.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('375 judge no overflow', (await T.overflow(host)) <= 0, await T.overflow(host));
  await host.page.screenshot({ path: path.join(T.OUT, 'host-375-judge.png'), fullPage: true });
  await host.page.setViewportSize({ width: 1100, height: 900 });
  // やりなおし → 同じ人がもう一度
  await host.page.click('#btnJudgeNo');
  room = await T.roomWhen(code, (r) => !L.pendingOf(r));
  check('rejected', len(room) === nJ && L.turnOf(room) === 'そら');
  await T.waitToast(sora, 'もう一度、変える文字を選んでね');
  await T.waitText(sora, '#turnText', 'あなたの番');
  await T.waitHidden(midori, '#judgeArea');
  // もう一度変えて、OK → みどりの番
  await T.change(sora, mv.pos, mv.ch);
  await T.roomWhen(code, (r) => !!L.pendingOf(r));
  await T.waitVisible(host, '#btnJudgeOk');
  await host.page.click('#btnJudgeOk');
  room = await T.roomWhen(code, (r) => len(r) === nJ + 1);
  check('approved', word(room) === mv.word && !L.pendingOf(room) && L.turnOf(room) === 'みどり' && L.gameOf(room).ladder[nJ].by === 'そら');
  await T.waitHidden(sora, '#judgeArea');
  await T.waitText(midori, '#turnText', 'あなたの番');
  // 変えた本人の「えらびなおす」
  mv = pickMove(room);
  await T.change(midori, mv.pos, mv.ch);
  await T.roomWhen(code, (r) => !!L.pendingOf(r));
  await T.waitVisible(midori, '#btnJudgeRetry');
  await midori.page.click('#btnJudgeRetry');
  room = await T.roomWhen(code, (r) => !L.pendingOf(r));
  check('self retry', len(room) === nJ + 1 && L.turnOf(room) === 'みどり');
  await T.waitHidden(host, '#judgeArea');

  // ── 退出・ルームを閉じる ──
  await haru.page.click('#btnLeave');
  await T.waitScreen(haru, 'top');
  room = await T.roomWhen(code, (r) => !r.players?.['はる']);
  check('haru left', !room.players?.['はる']);
  await host.page.click('#btnLeave');
  for (const c of [sora, midori]) await T.waitScreen(c, 'top');
  check('room removed', (await T.roomWhen(code, (r) => r === null)) === null);
  await T.waitToast(sora, 'ルームが閉じられたよ').catch(() => {});

  await T.finishAll(server);
})().catch(async (e) => {
  console.error(e);
  process.exit(1);
});
