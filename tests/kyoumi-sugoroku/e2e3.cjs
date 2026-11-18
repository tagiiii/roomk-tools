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
      (await c.page.$$('#board .ks-square__icon')).length === 22 && (await c.page.$$('#lifeLegend li')).length === 3 && await L.visible(c, '#lifeLegend') && (await c.page.$$('#board .ks-board__label')).length === 4);
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

  // ── D. きく（あおの番）: 相手 → 3枚の質問から1枚 → 聞かれた人が答える ──
  await set({ step: 'life-talk', turn: 1, pos: { 1: 8 }, q: { kind: 'kiku', scene: 'ima', n: 1 }, picked: null });
  await cardWhen(B, 'だれに聞く？');
  ac = await L.card(A);
  let bc = await L.card(B);
  check('D1 聞く相手は、自分以外の人と「みんなに聞く」', ac.choices.map((x) => x.text).join('|') === '①ほすと さんに聞く|②みどり さんに聞く|groupsみんなに聞く', ac.choices);
  check('D2 番の人だけが選べる・ほかの人には待つ案内', ac.choices.every((x) => !x.disabled) && bc.choices.every((x) => x.disabled) && bc.wait.includes('聞く相手を選んでいるよ'), bc);
  await A.page.click('#modal-choices .ks-choice >> nth=1');
  room = await gameWhen((g) => g.q && g.q.target === 2 && g.q.opts);
  check('D3 相手を選ぶと、質問が3枚出る（相手は順番の番号）', room.game.q.opts.length === 3 && room.game.turn === 1 && room.game.step === 'life-talk', room.game.q);
  await cardWhen(B, 'どの質問にする？');
  ac = await L.card(A);
  bc = await L.card(B);
  check('D4 3枚は番の人だけが選べる（「自由に話す」はない）・「別の質問」で引きなおせる', ac.choices.length === 3 && ac.choices.every((x) => !x.disabled) && ac.skip && !ac.next && bc.choices.every((x) => x.disabled) && !bc.skip, { ac, bc });
  check('D5 だれからだれへ、がみんなに出る', bc.player.includes('あお さんから、みどり さんへ') && bc.wait.includes('質問を選んでいるよ'), bc);
  await A.page.click('#btn-skip');
  room = await gameWhen((g) => g.q && g.q.n === 3);
  check('D6 引きなおしても3枚・相手はそのまま', room.game.q.opts.length === 3 && room.game.q.target === 2, room.game.q);
  await sleep(300);
  const askText = (await L.card(A)).choices[0].text.replace(/^①/, '');
  await A.page.click('#modal-choices .ks-choice >> nth=0');
  room = await gameWhen((g) => g.q && g.q.phase === 'answer');
  check('D7 選んだ1枚が質問になる', room.game.q.idx === room.game.q.opts[0] && room.game.turn === 1, room.game.q);
  await cardWhen(B, askText);
  ac = await L.card(A);
  bc = await L.card(B);
  check('D8 答えるのは聞かれた人（3択と「自由に話す」）。聞いた人は押せない', bc.choices.length === 4 && bc.choices.every((x) => !x.disabled) && ac.choices.every((x) => x.disabled), { ac, bc });
  check('D9 聞かれた人が「別の質問」に変えられる・聞いた人にはない', bc.skip && !ac.skip && !bc.next, { ac, bc });
  check('D10 ホストは代わりに押せる', (await L.card(H)).choices.every((x) => !x.disabled));
  check('D11 答える人を知らせる', (await L.text(B, '#turnNote')) === 'あなたが答える番だよ' && (await L.text(A, '#turnNote')) === 'みどりさんが答える番だよ', await L.text(A, '#turnNote'));
  await B.page.click('#btn-skip');
  room = await gameWhen((g) => g.q && g.q.n === 5);
  check('D12 聞かれた人が質問を変えても、答える段階のまま', room.game.q.phase === 'answer' && room.game.q.target === 2, room.game.q);
  await sleep(300);
  const answerText = (await L.card(B)).choices[1].text.replace(/^②/, '');
  await B.page.click('#modal-choices .ks-choice >> nth=1');
  room = await gameWhen((g) => g.step === 'life-roll' && !g.q);
  check('D13 答えると次の人の番。答えは聞かれた人のものとして置く', room.game.turn === 2 && room.game.picked.kiku === true && room.game.picked.turn === 2 && room.game.picked.by === 1 && room.game.picked.choice === 1, room.game.picked);
  await L.waitVisible(H, '#lastPick');
  check('D14 答えがみんなの画面に出る（だれの答えか・だれの質問か）', (await L.text(H, '#pickWho')).includes('みどり さんの答え（あお さんの質問）') && (await L.text(H, '#pickA')).includes(answerText), await L.text(H, '#pickWho'));

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

  // ── F. 本物のサイコロ: 2つ振って進む目を選ぶ。止まったマスの種類のカードが、みんなに出る ──
  await H.page.click('#btn-roll');
  room = await gameWhen((g) => g.step === 'life-pick' || g.rollNo === 2);
  if (room.game.step === 'life-pick') {
    const dice = room.game.dice;
    check('F0a ちがう目なら、まだ進まずに目を選ぶ', dice.length === 2 && dice[0] !== dice[1] && room.game.rollNo === 1 && room.game.pos[0] === 4, room.game);
    await L.waitVisible(H, '#dicePick button:not([disabled])'); // 書きこみが済むまでの一瞬は押せない
    await L.waitVisible(A, '#dicePick');
    const hb = await H.page.$$eval('#dicePick button', (els) => els.map((b) => ({ disabled: b.disabled, text: b.textContent })));
    const ab = await A.page.$$eval('#dicePick button', (els) => els.map((b) => b.disabled));
    check('F0b 目は2つ。番の人だけが選べる・止まるマスの種類が出る', hb.length === 2 && hb.every((b) => !b.disabled && b.text.includes('マス進む')) && ab.every(Boolean), { hb, ab });
    check('F0c ほかの人には待つ案内・サイコロを振るボタンは出ない', (await L.text(A, '#turnNote')).includes('進む目を選んでいるよ') && !(await L.visible(H, '#btn-roll')), await L.text(A, '#turnNote'));
    await H.page.click('#dicePick button >> nth=1');
    room = await gameWhen((g) => g.rollNo === 2);
    check('F0d 選んだ目のぶん進む', room.game.pos[0] === 4 + dice[1] && room.game.last.dice === dice[1] && !room.game.dice, room.game);
  }
  room = await gameWhen((g) => g.rollNo === 2 && g.step === 'life-talk');
  const landed = room.game.pos[0];
  const KINDS = ['erabu', 'kiku', 'erabu', 'dekigoto', 'erabu', 'kiku', 'erabu', 'dekigoto', 'kiku', 'erabu'];
  check('F1 出目のぶん進み、そのマスの種類のカード', landed === 4 + room.game.last.dice && room.game.q.kind === KINDS[(landed - 1) % 10], room.game);
  await L.waitQuestion(A);
  const LABEL = { erabu: 'えらぶ', kiku: 'きく', dekigoto: 'できごと' };
  check('F2 参加者の画面にも同じ種類のカード・出た目', (await L.card(A)).theme.includes(LABEL[room.game.q.kind]) && (await L.card(A)).dice === String(room.game.last.dice) && !(await L.visible(A, '#dicePick')), await L.card(A));

  // ── F2. レビューの指摘から: 退出・壊れた値・いない相手 ──
  // 読めないカードで止まったら、ホストの見はりが次の人へ進める
  await set({ step: 'life-talk', turn: 0, q: { kind: 'map', idx: 0, n: 1 }, pos: { 0: 5, 1: 6, 2: 8 } });
  room = await L.roomWhen(code, (r) => r.game && r.game.step === 'life-roll' && r.game.turn === 1, 12000);
  check('F3 読めないカードは、ホストの画面が次の人へ進めて立て直す', room.game.step === 'life-roll' && room.game.turn === 1 && !room.game.q, room.game);
  // きく: 選んだ相手がいなくなったら、いまいる人から選びなおす
  await set({ step: 'life-talk', turn: 0, q: { kind: 'kiku', scene: 'ima', n: 1 } });
  await cardWhen(H, 'だれに聞く？');
  await H.page.click('#modal-choices .ks-choice >> nth=1'); // みどり
  room = await gameWhen((g) => g.q && g.q.target === 2 && g.q.opts);
  await cardWhen(H, 'どの質問にする？');
  await H.page.click('#modal-choices .ks-choice >> nth=0');
  room = await gameWhen((g) => g.q && g.q.phase === 'answer');
  await L.waitText(A, '#modal-player', 'みどり さんへ');
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  await cardWhen(H, 'だれに聞く？');
  hc = await L.card(H);
  check('F4 相手がいなくなったら、いまいる人から選びなおす', hc.choices.map((x) => x.text).join('|') === '①あお さんに聞く|groupsみんなに聞く', hc.choices);
  await H.page.click('#modal-choices .ks-choice >> nth=0');
  room = await gameWhen((g) => g.q && g.q.target === 1);
  check('F5 選びなおすと、質問を選ぶところから', room.game.q.target === 1 && room.game.q.opts.length === 3 && !room.game.q.phase, room.game.q);
  await cardWhen(H, 'どの質問にする？');
  await H.page.click('#modal-choices .ks-choice >> nth=0');
  room = await gameWhen((g) => g.q && g.q.phase === 'answer');
  await A.page.waitForFunction(() => [...document.querySelectorAll('#modal-choices .ks-choice')].some((b) => !b.disabled), null, { timeout: 8000 });
  await A.page.click('#modal-choices .ks-choice >> nth=0');
  room = await gameWhen((g) => g.step === 'life-roll' && !g.q);
  check('F6 答えたら、次にいる人（あお）の番', room.game.turn === 1 && room.game.picked.turn === 1 && room.game.picked.by === 0, room.game);
  // できごとの途中で番の人が退出しても、できごとは確定しない
  await rejoin(B, 'みどり');
  await set({ step: 'life-talk', turn: 2, q: { kind: 'dekigoto', idx: 6, n: 1 }, pos: { 0: 5, 1: 6, 2: 8 } });
  await cardWhen(B, 'みんなでおやつタイム');
  await B.page.click('#btnLeave');
  await L.waitScreen(B, 'top');
  room = await gameWhen((g) => g.step === 'life-roll' && !g.q);
  check('F7 できごとの途中で退出しても、だれも進まない・次にいる人の番', JSON.stringify(room.game.pos) === '[5,6,8]' && room.game.turn === 0, room.game);
  await rejoin(B, 'みどり');

  // ── G. ゴール: 着いた人の番は「おうえん」・みんな着いたらおわり ──
  // サイコロを振って、目を選ぶ欄が出たら1つ目を選ぶ
  const rollNow = async (c, rollNo) => {
    await L.waitVisible(c, '#btn-roll');
    await c.page.click('#btn-roll');
    const r = await L.roomWhen(code, (x) => x.status === 'goal' || (x.game && (x.game.step === 'life-pick' || x.game.rollNo === rollNo + 1)));
    if (r.status !== 'goal' && r.game.step === 'life-pick') {
      await L.waitVisible(c, '#dicePick button:not([disabled])');
      await c.page.click('#dicePick button >> nth=0');
    }
  };
  await set({ step: 'life-roll', turn: 0, q: null, picked: null, dice: null, pos: { 0: 22, 1: 9, 2: 10 } });
  room = await L.roomOf(code);
  await rollNow(H, room.game.rollNo);
  room = await gameWhen((g) => g.done && g.done[0] === true);
  check('G1 ゴールでとまり、ゲームは続く・次の人の番', room.status === 'playing' && room.game.pos[0] === 23 && room.game.turn === 1 && room.game.step === 'life-roll', room.game);
  await L.waitText(A, '#turnNote', 'ほすとさんがゴール！');
  check('G2 着いた人を知らせる・「ゴール」の印', (await L.indicator(A)).find((p) => p.name === 'ほすと').tags.includes('ゴール'), await L.indicator(A));
  // ゴールした人にも番が回り、サイコロのかわりに「おうえん」
  await set({ step: 'life-roll', turn: 0, q: null, arrived: null });
  await cardWhen(A, 'だれを1マス進める？');
  hc = await L.card(H);
  ac = await L.card(A);
  check('G3 おうえんは、まだゴールしていない人から選ぶ（「自由に話す」はない）', hc.theme.includes('おうえん') && hc.choices.map((x) => x.text).join('|') === '①あお さん|②みどり さん' && hc.choices.every((x) => !x.disabled), hc);
  check('G4 ほかの人は押せず、待つ案内。サイコロを振るボタンは出ない', ac.choices.every((x) => x.disabled) && ac.wait.includes('おうえんする人を選んでいるよ') && !(await L.visible(H, '#btn-roll')), ac);
  const before = (await L.roomOf(code)).game;
  await H.page.click('#modal-choices .ks-choice >> nth=1');
  room = await gameWhen((g) => g.rollNo === before.rollNo + 1);
  check('G5 選んだ人が1マス進み、次の人の番', room.game.pos[2] === before.pos[2] + 1 && room.game.pos[1] === before.pos[1] && room.game.turn === 1 && room.game.last.cheerBy === 0, room.game);
  // みんな着く
  await set({ step: 'life-roll', turn: 1, q: null, dice: null, pos: { 0: 23, 1: 22, 2: 23 }, done: { 0: true, 1: false, 2: true } });
  room = await L.roomOf(code);
  await rollNow(A, room.game.rollNo);
  room = await L.roomWhen(code, (r) => r.status === 'goal');
  check('G6 みんな着いたらおわり・順位は持たない', room.status === 'goal' && room.game.winner === undefined && room.game.done.every(Boolean), room.game);
  await L.waitVisible(B, '#roomStage #goalCard');
  await L.waitVisible(H, '#roomStage #goalCard');
  check('G7 「みんなゴール！」', (await L.text(B, '#goal-title')) === 'みんなゴール！' && (await L.text(H, '#goal-title')) === 'みんなゴール！', await L.text(B, '#goal-title'));
  check('G8 ホストに「もう一度あそぶ」・参加者には待つ案内', await L.visible(H, '#btn-restart') && !(await L.visible(B, '#btn-restart')) && await L.visible(B, '#goal-wait'));
  check('G9 finish を数える（ゴールを確定させた端末）', await L.waitStats(A, 'finish', 1));

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
