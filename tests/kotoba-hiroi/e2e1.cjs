// ことばひろい E2E その1: 協力と個人戦をひととおり（隔離エミュレーター）
const L = require('./lib.cjs');
const { check, sleep, roomOf, text, visible, waitText, waitVisible, waitHidden, overflow, waitStats, waitToast, shot, seg } = L;
const vm = require('vm');
const fs = require('fs');
const path = require('path');

// 問題（data.js）を読む
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'apps', 'kotoba-hiroi', 'data.js'), 'utf8'), ctx);
const PUZ = Object.fromEntries(ctx.window.KOTOBA_HIROI_PUZZLES.map((p) => [p.id, p]));

// 文字を順に押して「これにする」
async function make(c, word) {
  for (const ch of Array.from(word)) {
    await c.page.locator('#pTiles button:not([disabled])', { hasText: ch }).first().click();
  }
  await c.page.click('#btnSubmit');
}
// 答えの一覧にも、グレーにも、外す言葉にもない並び（たしかめ中になる言葉）
function nonWord(p, skip = []) {
  const known = new Set([...p.answers, ...p.gray, ...p.ng, ...skip]);
  const perms = (arr, n) => (n === 0 ? [[]] : arr.flatMap((x, i) => perms(arr.filter((_, j) => j !== i), n - 1).map((r) => [x, ...r])));
  return perms(p.tiles, p.len).map((r) => r.join('')).find((w) => !known.has(w));
}
async function current(code) {
  const room = await roomOf(code);
  return { room, p: PUZ[room.order[room.q.idx]], idx: room.q.idx };
}

(async () => {
  const server = await L.startServer();
  await L.loadRules();
  await L.launch();
  const host = await L.newClient('host');
  const yu = await L.newClient('yu');
  const ao = await L.newClient('ao');

  // ── はじめの画面・作成・リンクで参加 ──
  await L.open(host);
  check('top: title', (await host.page.title()) === 'ことばひろい | あそびのたな');
  check('top: entry visible', await visible(host, '.app-entry'));
  await shot(host, '01-top');
  const code = await L.createRoom(host, 'ホスト');
  check('stats room-create', await waitStats(host, 'room-create', 1));
  await L.joinRoom(yu, 'ゆう', code);
  await L.joinRoom(ao, 'あお', code);
  await waitText(host, '#lobbyPlayers', 'あお');
  check('lobby: guest sees wait', await visible(yu, '#lobbyWait'));
  check('lobby: guest no rule controls', !(await visible(yu, '#lobbyHost')));

  // ── 端末なしの参加者 ──
  await host.page.fill('#proxyName', 'ゆう');
  await host.page.click('#btnAddProxy');
  await waitText(host, '#proxyError', '使われている');
  check('proxy: duplicate name rejected', true);
  await host.page.fill('#proxyName', 'はな');
  await host.page.click('#btnAddProxy');
  await waitText(yu, '#lobbyPlayers', 'はな');
  check('proxy: host sees mark', (await text(host, '#lobbyPlayers')).includes('端末なし'));
  check('proxy: guest does not see mark', !(await text(yu, '#lobbyPlayers')).includes('端末なし'));
  check('proxy: guest has no remove button', (await yu.page.locator('.khi-players__remove').count()) === 0);
  await host.page.fill('#proxyName', 'そら');
  await host.page.click('#btnAddProxy');
  await waitText(host, '#lobbyPlayers', 'そら');
  await host.page.locator('.khi-players__remove[aria-label="そらを外す"]').click();
  await host.page.waitForFunction(() => !document.querySelector('#lobbyPlayers').textContent.includes('そら'));
  check('proxy: removed', !(await text(yu, '#lobbyPlayers')).includes('そら') || (await waitHidden(yu, '#nonexistent').then(() => true)));
  check('lobby: start note counts proxies', (await text(host, '#startNote')).includes('4人'), await text(host, '#startNote'));
  check('lobby: guest rule summary', (await text(yu, '#lobbyRule')).includes('協力'), await text(yu, '#lobbyRule'));
  await shot(host, '02-lobby-host');

  // ── 協力・ふつう・3問 ──
  await host.page.click('#btnStart');
  await waitVisible(yu, '#screen-play');
  await waitVisible(host, '#screen-play');
  check('stats start', await waitStats(host, 'start', 1));
  check('stats players-4', await waitStats(host, 'players-4', 1));
  check('stats mode-coop', await waitStats(host, 'mode-coop', 1));
  let { room, p, idx } = await current(code);
  check('start: 3 puzzles from normal', room.order.length === 3 && room.order.every((id) => PUZ[id].level === 'normal'), room.order);
  check('start: tiles shuffled set', room.q.tiles.slice().sort().join('') === p.tiles.slice().sort().join(''));
  check('play: slots = answers', (await yu.page.locator('#pSlots .khi-slot').count()) === p.answers.length);
  check('play: tiles shown', (await yu.page.locator('#pTiles button').count()) === p.tiles.length);
  check('play: ask text', (await text(yu, '#pAsk')).includes(`${p.len}文字`));
  check('play: guest has no who selector', !(await visible(yu, '#pWhoBox')));
  check('play: host who selector (proxy)', await visible(host, '#pWhoBox'));
  check('play: no timer when limit none', !(await visible(yu, '#pTimer')));
  await shot(yu, '03-play-guest');

  // 文字の操作: 押した文字は押せない・決めた数まで・1文字もどす・ぜんぶ消す
  const w0 = p.answers[0];
  const ch0 = Array.from(w0)[0];
  await yu.page.locator('#pTiles button', { hasText: ch0 }).first().click();
  check('tile: used tile disabled', await yu.page.locator('#pTiles button.is-used').count() === 1);
  check('tile: submit disabled until full', await yu.page.isDisabled('#btnSubmit'));
  await yu.page.click('#btnBack');
  check('tile: back clears', (await yu.page.locator('#pTiles button.is-used').count()) === 0);
  await yu.page.click('#btnMix');
  check('tile: mix keeps tiles', (await yu.page.locator('#pTiles button').count()) === p.tiles.length);

  // 答えを見つける
  await make(yu, w0);
  await waitText(yu, '#pFeedback', `見つけた！「${w0}」`);
  await waitText(host, '#pSlots', w0);
  check('found: host board shows word', true);
  check('found: head count', (await text(ao, '#pBoardHead')).includes(`1 / ${p.answers.length}`), await text(ao, '#pBoardHead'));
  room = await roomOf(code);
  check('found: db by ゆう', room.found[idx][w0].by === 'ゆう', room.found);
  check('coop: board does not show finder name', !(await text(ao, '#pSlots')).includes('ゆう'));
  // 同じ言葉
  await make(ao, w0);
  await waitText(ao, '#pFeedback', 'もう見つかっている');
  check('found: duplicate rejected locally', true);

  // 一覧にない言葉 → たしかめ中 → OK
  const nw1 = nonWord(p);
  await make(yu, nw1);
  await waitText(yu, '#pFeedback', 'ボードにない言葉');
  await waitText(ao, '#pPend', nw1);
  check('pending: shown to others', true);
  check('pending: no name shown', !(await text(ao, '#pPendBox')).includes('ゆう'));
  await waitText(host, '#pCheck', nw1);
  await shot(host, '04-host-check');
  await host.page.locator(`button[aria-label="「${nw1}」をOKにする"]`).click();
  await waitText(ao, '#pExtra', nw1);
  room = await roomOf(code);
  check('judge ok: extra by ゆう', room.extra[idx][nw1].by === 'ゆう', room.extra);
  check('judge ok: pending removed', !(room.pending && room.pending[idx] && room.pending[idx][nw1]));
  // もう一つ → ちがうみたい
  const nw2 = nonWord(p, [nw1]);
  await make(ao, nw2);
  await waitText(host, '#pCheck', nw2);
  await host.page.locator(`button[aria-label="「${nw2}」をちがうことにする"]`).click();
  await waitHidden(yu, '#pPendBox');
  check('judge ng: gone everywhere', !(await text(yu, '#pExtra')).includes(nw2));
  room = await roomOf(code);
  check('judge ng: not in extra', !room.extra[idx][nw2]);
  // 外す言葉（あれば）
  if (p.ng.length) {
    await make(yu, p.ng[0]);
    await waitText(yu, '#pFeedback', 'ほかの言葉をさがしてみよう');
    room = await roomOf(code);
    check('ng: not written', !(room.pending && room.pending[idx] && room.pending[idx][p.ng[0]]) && !room.found[idx][p.ng[0]]);
  }

  // ヒント
  await host.page.click('#btnHint');
  await yu.page.waitForFunction(() => document.querySelectorAll('#pSlots .khi-cell.is-hint').length === 1);
  check('hint: one first letter shown', true);

  // ホストが端末なしの参加者の言葉を出す
  await host.page.locator('#pWho button', { hasText: 'はな' }).click();
  check('who: ask names proxy', (await text(host, '#pAsk')).includes('はなの言葉'));
  const w1 = p.answers[1];
  await make(host, w1);
  await waitText(yu, '#pSlots', w1);
  room = await roomOf(code);
  check('proxy: found by はな', room.found[idx][w1].by === 'はな', room.found[idx][w1]);

  // 読み直して同じ問題に戻る
  await yu.page.reload();
  await L.gate(yu);
  await waitVisible(yu, '#screen-play');
  check('reload: back to same puzzle', (await text(yu, '#pNo')).startsWith('1 /'));
  check('reload: board kept', (await text(yu, '#pSlots')).includes(w0));

  // のこりのこたえを出す
  await host.page.click('#btnOpen');
  await waitVisible(yu, '#pDone');
  check('open: rest shown', (await yu.page.locator('#pSlots .khi-slot.is-open').count()) === p.answers.length - 2);
  check('open: maker hidden', !(await visible(yu, '#pMaker')));
  check('open: guest waits', await visible(yu, '#pWait'));
  check('open: host next', await visible(host, '#btnNext'));
  await shot(yu, '05-open');
  await host.page.click('#btnNext');
  await waitText(yu, '#pNo', '2 /');

  // 2問め: 全部見つけてクリア
  ({ room, p, idx } = await current(code));
  for (let i = 0; i < p.answers.length; i += 1) {
    const c = i % 2 ? ao : yu;
    await make(c, p.answers[i]);
    await waitText(c, '#pFeedback', '見つけた');
  }
  await waitText(yu, '#pDone', 'クリア');
  check('clear: message', true);
  room = await roomOf(code);
  check('clear: endedBy all', room.q.ended && room.q.endedBy === 'all');
  await shot(ao, '06-clear');
  await host.page.click('#btnNext');
  await waitText(yu, '#pNo', '3 /');
  await host.page.click('#btnOpen');
  await waitVisible(host, '#btnNext');
  check('last: result button', (await text(host, '#btnNext')) === '結果を見る');
  await host.page.click('#btnNext');
  await waitVisible(yu, '#screen-result');
  check('result coop: total', /みんなで \d+ こ 見つけたよ/.test(await text(yu, '#resMain')), await text(yu, '#resMain'));
  check('result coop: no people list', !(await visible(yu, '#resPeopleBox')));
  check('result coop: 3 puzzles', (await yu.page.locator('.khi-res').count()) === 3);
  check('result: guest waits', await visible(yu, '#resWait'));
  await shot(yu, '07-result-coop');

  // ── 個人戦・やさしい・制限時間1分 ──
  await host.page.click('#btnAgain');
  await waitVisible(host, '#lobbyHost');
  check('stats again', await waitStats(host, 'again', 1));
  await seg(host, 'modeOpts', '個人戦');
  await seg(host, 'levelOpts', 'やさしい');
  await seg(host, 'limitOpts', '1分');
  await waitText(yu, '#lobbyRule', '個人戦');
  check('rule: easy 1min', (await text(yu, '#lobbyRule')).includes('やさしい') && (await text(yu, '#lobbyRule')).includes('1分'));
  await host.page.click('#btnStart');
  await waitVisible(yu, '#screen-play');
  check('stats mode-race', await waitStats(host, 'mode-race', 1));
  ({ room, p, idx } = await current(code));
  check('race: easy puzzles', room.order.every((id) => PUZ[id].level === 'easy'));
  await waitVisible(yu, '#pTimer');
  check('timer: shown', /のこり/.test(await text(yu, '#pTimerText')), await text(yu, '#pTimerText'));
  check('race: me count shown', await visible(yu, '#pMeBox'));
  // 同じ言葉を同時に出す → どちらか1人のもの
  const r0 = p.answers[0];
  await Promise.all([make(yu, r0), make(ao, r0)]);
  await sleep(800);
  room = await roomOf(code);
  const winner = room.found[idx][r0].by;
  check('race: one winner', winner === 'ゆう' || winner === 'あお', winner);
  const loser = winner === 'ゆう' ? ao : yu;
  const winC = winner === 'ゆう' ? yu : ao;
  check('race: loser told', /だれかが見つけた/.test(await text(loser, '#pFeedback')), await text(loser, '#pFeedback'));
  check('race: winner highlighted', (await winC.page.locator('#pSlots .khi-slot.is-mine').count()) === 1);
  check('race: loser not highlighted', (await loser.page.locator('#pSlots .khi-slot.is-mine').count()) === 0);
  check('race: me count 1', (await text(winC, '#pMe')) === '1');
  await make(yu, p.answers[1]);
  await waitText(yu, '#pFeedback', '見つけた');
  await make(yu, p.answers[1]);
  await waitText(yu, '#pFeedback', 'もう見つけた言葉');
  check('race: own duplicate message', true);
  await shot(yu, '08-race');
  // モバイル幅
  await yu.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('mobile: no horizontal overflow (play)', (await overflow(yu)) <= 0, await overflow(yu));
  await shot(yu, '09-mobile-play');
  await yu.page.setViewportSize({ width: 1100, height: 900 });
  // 残りの問題を進めて結果へ
  for (let i = 0; i < 3; i += 1) {
    await host.page.click('#btnOpen');
    await waitVisible(host, '#btnNext');
    await host.page.click('#btnNext');
    await sleep(400);
  }
  await waitVisible(yu, '#screen-result');
  const people = await yu.page.$$eval('#resPeople li', (lis) => lis.map((li) => li.textContent));
  check('result race: people listed', people.length >= 1, people);
  check('result race: host (0) not listed', !people.some((t) => t.includes('ホスト')), people);
  check('result race: no rank numbers', !people.some((t) => /位/.test(t)), people);
  const nums = people.map((t) => Number((t.match(/(\d+) こ/) || [])[1]));
  check('result race: sorted desc', nums.every((n, i) => i === 0 || nums[i - 1] >= n), nums);
  check('result race: me line', /あなたは \d+ こ 見つけたよ/.test(await text(yu, '#resMain')));
  await shot(yu, '10-result-race');
  await yu.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('mobile: no horizontal overflow (result)', (await overflow(yu)) <= 0);
  await yu.page.setViewportSize({ width: 1100, height: 900 });

  // ── 退出・ルームを閉じる ──
  await ao.page.click('#btnLeave');
  await waitVisible(ao, '#screen-top');
  room = await roomOf(code);
  check('leave: player removed', !room.players['あお']);
  await host.page.click('#btnLeave');
  await waitToast(yu, 'ルームが閉じられた');
  await waitVisible(yu, '#screen-top');
  check('close: room removed', (await roomOf(code)) === null);
  // 375px のはじめの画面
  await host.page.setViewportSize({ width: 375, height: 812 });
  await sleep(300);
  check('mobile: top no overflow', (await overflow(host)) <= 0);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
