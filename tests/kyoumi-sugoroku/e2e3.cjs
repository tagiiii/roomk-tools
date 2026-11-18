// 興味スゴロク E2E その3: 「人生の道」のルーム
// 待合室のあそびかた・長さ／盤（4段・マスの種類・場面の名前）／えらぶ・きく（相手を選ぶ）・できごと（みんな進む・もう一度）／
// ゴールした人をとばす・みんなゴールでおわり／もう一度あそぶ・今までの遊び方にもどす
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const A = await L.newClient('ao', { viewport: { width: 375, height: 760 } });
  const B = await L.newClient('midori');
  const code = await L.createRoom(H, 'ほすと');
  await L.joinRoom(A, 'あお', code);
  await L.joinRoom(B, 'みどり', code);
  const gamePath = `${L.ROOMS}/${code}/game`;
  const set = (body) => L.rest('PATCH', gamePath, body);
  const gameWhen = (fn) => L.roomWhen(code, (r) => r && r.game && fn(r.game, r));
  const cardWhen = (c, part) => L.waitText(c, '#roomStage #modal-question', part);

  // 遊んでいる途中に、同じ名前で入りなおす（待合室ではなくゲームの画面にもどる）
  const rejoin = async (c, name) => {
    await L.open(c, '?room=' + code);
    await L.waitScreen(c, 'join');
    await c.page.fill('#guestName', name);
    await c.page.click('#btnJoinRoom');
    await L.waitScreen(c, 'game');
  };

  // ── A. 待合室: あそびかた・長さ ──
  check('A1 はじめは今までの遊び方（マス数とテーマの欄）', await L.visible(H, '#fieldRoomSquares') && await L.visible(H, '#fieldRoomThemes') && !(await L.visible(H, '#fieldRoomLength')));
  await H.page.click('#roomMode [data-value="life"]');
  let room = await L.roomWhen(code, (r) => r.mode === 'life');
  check('A2 「人生の道」にするとルームに入る', room.mode === 'life', room.mode);
  await L.waitVisible(H, '#fieldRoomLength');
  check('A3 マス数とテーマの欄をかくし、長さを出す', !(await L.visible(H, '#fieldRoomSquares')) && !(await L.visible(H, '#fieldRoomThemes')));
  check('A4 3人は24マス', (await L.text(H, '#roomLifeLenNote')) === '24マス', await L.text(H, '#roomLifeLenNote'));
  await L.waitText(A, '#waitingSettings', '人生の道');
  check('A5 参加者にも、あそびかたとマス数が出る', (await L.text(A, '#waitingSettings')).includes('24マス'), await L.text(A, '#waitingSettings'));
  await H.page.click('#roomLifeLen [data-value="1"]');
  await L.waitText(H, '#roomLifeLenNote', '28マス');
  room = await L.roomOf(code);
  check('A6 「ながい」で1段階ふえる', room.lifeLen === 1, room.lifeLen);
  await H.page.click('#roomLifeLen [data-value="0"]');
  await L.waitText(H, '#roomLifeLenNote', '24マス');

  // ── B. はじめる: 盤 ──
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  await L.waitScreen(B, 'game');
  room = await L.roomOf(code);
  check('B1 ゲームは人生の道・24マス・だれもゴールしていない', room.game.mode === 'life' && room.game.squares === 24 && room.game.done.every((d) => d === false), room.game);
  for (const c of [H, A]) {
    check(`B2 盤は24マス（${c.label}）`, (await c.page.$$('#board .ks-square')).length === 24);
    check(`B3 マスの種類のアイコンと見本・場面の名前（${c.label}）`,
      (await c.page.$$('#board .ks-square__icon')).length === 22 && await L.visible(c, '#lifeLegend') && (await c.page.$$('#board .ks-board__label')).length === 4);
  }
  check('B4 せまい画面でも横にはみ出さない', (await L.overflow(A)) <= 0, await L.overflow(A));
  check('B5 mode-life を数える', await L.waitStats(H, 'mode-life', 1));

  // ── C. えらぶ（ほすとの番） ──
  await set({ step: 'life-talk', rollNo: 1, turn: 0, pos: { 0: 1 }, q: { kind: 'erabu', scene: 'chiisai', idx: 0, n: 1 } });
  await cardWhen(A, '小さいころ、よく遊んだのは？');
  let hc = await L.card(H);
  let ac = await L.card(A);
  check('C1 見出しは場面とマスの種類', hc.theme.includes('小さいころ・えらぶ'), hc.theme);
  check('C2 番の人は選べる・ほかの人は選べない', hc.choices.length === 4 && hc.choices.every((x) => !x.disabled) && ac.choices.every((x) => x.disabled), { hc, ac });
  check('C3 ほかの人には、選ぶと次の人の番になる案内', ac.wait.includes('ほすとさんが選ぶと'), ac.wait);
  await H.page.click('#modal-choices .ks-choice >> nth=1');
  room = await gameWhen((g) => g.turn === 1 && g.step === 'life-roll');
  check('C4 選ぶと次の人の番・選んだものを置く', room.game.picked?.life === true && room.game.picked.choice === 1, room.game.picked);
  await L.waitVisible(A, '#lastPick');
  check('C5 選んだものがみんなの画面に出る', (await L.text(A, '#pickA')).includes('家の中でじっくり') && (await L.text(B, '#pickQ')).includes('よく遊んだのは'), await L.text(A, '#pickA'));

  // ── D. きく（あおの番）: 相手を選ぶ ──
  await set({ step: 'life-talk', turn: 1, pos: { 1: 8 }, q: { kind: 'kiku', scene: 'ima', idx: 1, n: 1 }, picked: null });
  await cardWhen(B, '最近、おいしかったものは？');
  ac = await L.card(A);
  let bc = await L.card(B);
  check('D1 聞く相手は、自分以外の人と「みんなに聞く」', ac.choices.map((x) => x.text).join('|') === '①ほすと さんに聞く|②みどり さんに聞く|groupsみんなに聞く', ac.choices);
  check('D2 番の人だけが選べる・ほかの人には待つ案内', ac.choices.every((x) => !x.disabled) && bc.choices.every((x) => x.disabled) && bc.wait.includes('聞く相手を選んでいるよ'), bc);
  check('D3 相手を選ぶ前も「別の質問」は押せる・「話せた」はまだない', ac.skip && !ac.next, ac);
  await A.page.click('#modal-choices .ks-choice >> nth=1');
  room = await gameWhen((g) => g.q && g.q.target === 2);
  check('D4 相手は順番の番号で入る（みどりは2）', room.game.q.target === 2 && room.game.turn === 1 && room.game.step === 'life-talk', room.game.q);
  await L.waitText(B, '#modal-player', 'みどり さんへ');
  bc = await L.card(B);
  ac = await L.card(A);
  check('D5 だれからだれへ、がみんなに出る', bc.player.includes('あお さんから、みどり さんへ') && bc.choices.length === 0, bc);
  check('D6 聞く人には「別の質問」「話せた！次の人へ」・聞かれた人にはない', ac.next && ac.skip && !bc.next && !bc.skip, { ac, bc });
  check('D7 ホストは代わりに押せる', (await L.card(H)).next);
  await A.page.click('#btn-skip');
  room = await gameWhen((g) => g.q && g.q.n === 3);
  check('D8 別の質問にしても相手はそのまま', room.game.q.target === 2 && room.game.q.idx !== 1 && room.game.q.kind === 'kiku', room.game.q);
  await A.page.click('#btn-next');
  room = await gameWhen((g) => g.turn === 2 && g.step === 'life-roll');
  check('D9 話せたら次の人の番', !room.game.q, room.game);

  // ── E. できごと ──
  // みんな1マス進む（みどりの番）
  await set({ step: 'life-talk', turn: 2, pos: { 0: 3, 1: 5, 2: 7 }, q: { kind: 'dekigoto', idx: 6, n: 1 } });
  await cardWhen(A, 'みんなでおやつタイム');
  bc = await L.card(B);
  ac = await L.card(A);
  check('E1 できごとの中身と「進む」・「別の質問」はない', (await L.text(B, '#modal-effect')) === 'みんな1マス進む' && bc.next && !bc.skip && (await L.text(B, '#btn-next')).includes('進む'), bc);
  check('E2 ほかの人にはボタンがなく、待つ案内', !ac.next && !ac.skip && ac.wait.includes('みどりさんが進めるのを待ってね'), ac);
  await B.page.click('#btn-next');
  room = await gameWhen((g) => g.step === 'life-roll' && g.turn === 0);
  check('E3 みんな1マス進んで、次の人の番', JSON.stringify(room.game.pos) === '[4,6,8]', room.game.pos);
  await sleep(400);
  check('E4 盤のコマも進む', JSON.stringify(await L.pawnsAt(A)) === JSON.stringify(await L.pawnsAt(H)) && (await L.pawnsAt(A)).length === 3, await L.pawnsAt(A));
  // もう一度サイコロ（ほすとの番）
  await set({ step: 'life-talk', turn: 0, q: { kind: 'dekigoto', idx: 5, n: 1 } });
  await cardWhen(H, '四つ葉のクローバー');
  check('E5 「もう一度サイコロを振る」', (await L.text(H, '#btn-next')).includes('もう一度サイコロを振る'));
  await H.page.click('#btn-next');
  room = await gameWhen((g) => g.step === 'life-roll' && !g.q);
  check('E6 同じ人がもう一度振る', room.game.turn === 0 && JSON.stringify(room.game.pos) === '[4,6,8]', room.game);
  await L.waitVisible(H, '#btn-roll');

  // ── F. 本物のサイコロ: 止まったマスの種類のカードが、みんなに出る ──
  await H.page.click('#btn-roll');
  room = await gameWhen((g) => g.rollNo === 2 && g.step === 'life-talk');
  const landed = room.game.pos[0];
  const KINDS = ['erabu', 'hanasu', 'kiku', 'erabu', 'dekigoto', 'hanasu', 'kiku', 'erabu', 'hanasu', 'dekigoto'];
  check('F1 出目のぶん進み、そのマスの種類のカード', landed === 4 + room.game.last.dice && room.game.q.kind === KINDS[(landed - 1) % 10], room.game);
  await L.waitQuestion(A);
  const LABEL = { erabu: 'えらぶ', hanasu: 'はなす', kiku: 'きく', dekigoto: 'できごと' };
  check('F2 参加者の画面にも同じ種類のカード・出た目', (await L.card(A)).theme.includes(LABEL[room.game.q.kind]) && (await L.card(A)).dice === String(room.game.last.dice), await L.card(A));

  // ── F2. レビューの指摘から: 退出・壊れた値・いない相手 ──
  // 読めないカードで止まったら、ホストの見はりが次の人へ進める
  await set({ step: 'life-talk', turn: 0, q: { kind: 'map', idx: 0, n: 1 }, pos: { 0: 5, 1: 6, 2: 8 } });
  room = await L.roomWhen(code, (r) => r.game && r.game.step === 'life-roll' && r.game.turn === 1, 12000);
  check('F3 読めないカードは、ホストの画面が次の人へ進めて立て直す', room.game.step === 'life-roll' && room.game.turn === 1 && !room.game.q, room.game);
  // きく: いない人は候補に出ない。選んだ相手がいなくなったら選びなおせる
  await set({ step: 'life-talk', turn: 0, q: { kind: 'kiku', scene: 'ima', idx: 1, n: 1 } });
  await cardWhen(H, '最近、おいしかったものは？');
  await H.page.click('#modal-choices .ks-choice >> nth=1'); // みどり
  room = await gameWhen((g) => g.q && g.q.target === 2);
  await L.waitText(A, '#modal-player', 'みどり さんへ');
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  await H.page.waitForFunction(() => document.querySelectorAll('#modal-choices .ks-choice').length > 0, null, { timeout: 8000 });
  hc = await L.card(H);
  check('F4 相手がいなくなったら、いまいる人から選びなおす', hc.choices.map((x) => x.text).join('|') === '①あお さんに聞く|groupsみんなに聞く', hc.choices);
  await H.page.click('#modal-choices .ks-choice >> nth=0');
  room = await gameWhen((g) => g.q && g.q.target === 1);
  check('F5 選びなおした相手が入る', room.game.q.target === 1, room.game.q);
  await H.page.click('#btn-next');
  room = await gameWhen((g) => g.step === 'life-roll' && !g.q);
  check('F6 話せたら、次にいる人（あお）の番', room.game.turn === 1, room.game.turn);
  // できごとの途中で番の人が退出しても、できごとは確定しない
  await rejoin(B, 'みどり');
  await set({ step: 'life-talk', turn: 2, q: { kind: 'dekigoto', idx: 6, n: 1 }, pos: { 0: 5, 1: 6, 2: 8 } });
  await cardWhen(B, 'みんなでおやつタイム');
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  room = await gameWhen((g) => g.step === 'life-roll' && !g.q);
  check('F7 できごとの途中で退出しても、だれも進まない・次にいる人の番', JSON.stringify(room.game.pos) === '[5,6,8]' && room.game.turn === 0, room.game);
  await rejoin(B, 'みどり');

  // ── G. ゴール: 着いた人をとばす・みんな着いたらおわり ──
  await set({ step: 'life-roll', turn: 0, q: null, picked: null, pos: { 0: 22, 1: 9, 2: 10 } });
  await L.waitVisible(H, '#btn-roll');
  await H.page.click('#btn-roll');
  room = await gameWhen((g) => g.rollNo === 3);
  check('G1 ゴールでとまり、ゲームは続く・次の人の番', room.status === 'playing' && room.game.pos[0] === 23 && room.game.done[0] === true && room.game.turn === 1 && room.game.step === 'life-roll', room.game);
  await L.waitText(A, '#turnNote', 'ほすとさんがゴール！');
  check('G2 着いた人を知らせる・「ゴール」の印', (await L.indicator(A)).find((p) => p.name === 'ほすと').tags.includes('ゴール'), await L.indicator(A));
  // あお → みどり → あお（ほすとはとばす）
  await L.waitVisible(A, '#btn-roll');
  await set({ step: 'life-talk', turn: 2, q: { kind: 'hanasu', scene: 'ima', idx: 6, n: 1 } });
  await cardWhen(B, 'いま、いちばん楽しみにしていることは？');
  await B.page.click('#btn-next');
  room = await gameWhen((g) => g.step === 'life-roll' && !g.q);
  check('G3 ゴールした人はとばして次の人へ', room.game.turn === 1, room.game.turn);
  // みんな着く
  await set({ step: 'life-roll', turn: 1, q: null, pos: { 0: 23, 1: 22, 2: 23 }, done: { 0: true, 1: false, 2: true } });
  await L.waitVisible(A, '#btn-roll');
  await A.page.click('#btn-roll');
  room = await L.roomWhen(code, (r) => r.status === 'goal');
  check('G4 みんな着いたらおわり・順位は持たない', room.status === 'goal' && room.game.winner === undefined && room.game.done.every(Boolean), room.game);
  await L.waitVisible(B, '#roomStage #goalCard');
  await L.waitVisible(H, '#roomStage #goalCard');
  check('G5 「みんなゴール！」', (await L.text(B, '#goal-title')) === 'みんなゴール！' && (await L.text(H, '#goal-title')) === 'みんなゴール！', await L.text(B, '#goal-title'));
  check('G6 ホストに「もう一度あそぶ」・参加者には待つ案内', await L.visible(H, '#btn-restart') && !(await L.visible(B, '#btn-restart')) && await L.visible(B, '#goal-wait'));
  check('G7 finish を数える（ゴールを確定させた端末）', await L.waitStats(A, 'finish', 1));

  // ── H. もう一度あそぶ・今までの遊び方にもどす ──
  await H.page.click('#btn-restart');
  await L.waitScreen(A, 'waiting');
  room = await L.roomOf(code);
  check('H1 待合室にもどっても、あそびかたは人生の道のまま', room.status === 'waiting' && room.mode === 'life' && !room.game, room);
  await H.page.click('#roomMode [data-value="theme"]');
  await L.waitVisible(H, '#fieldRoomSquares');
  await H.page.click('#btnStartGame');
  await L.waitScreen(A, 'game');
  room = await L.roomOf(code);
  check('H2 今までの遊び方ではじまる', !room.game.mode && [10, 15, 20].includes(room.game.squares) && !room.game.done, room.game);
  check('H3 盤は番号のマスにもどる（見本・アイコン・場面の名前なし）',
    (await A.page.$$('#board .ks-square')).length === room.game.squares && !(await L.visible(A, '#lifeLegend'))
    && (await A.page.$$('#board .ks-square__icon')).length === 0 && (await A.page.$$('#board .ks-board__label')).length === 0);
  await H.page.click('#btn-roll');
  await L.waitQuestion(A);
  check('H4 今までの質問のカードが出る', !(await L.card(A)).theme.includes('・') && (await L.text(A, '#btn-next')).includes('話せた！次の人へ'), await L.card(A));
  await H.page.click('#btnLeave');
  await L.waitScreen(A, 'top');
  check('H5 ルームを閉じる', (await L.roomOf(code)) === null);

  await L.finishAll(server);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
