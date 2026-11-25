// リバーシ E2E その4: 3〜4人（2026-11-25）
// 1台の画面（人数・名前・置ける場所・となりに置く手・最後まで・棋譜・もう一回で色をまわす・1手もどす・読み込み直し・CPU・幅・広い画面の並び）
// ルーム（人数を変える・席・4人で最後まで・みんなにみせる画面・3人にへらす・時間切れの CPU）
const L = require('./lib.cjs');
const { E, check, sleep, waitFor, cell } = L;

const NAME = { b: '黒', w: '白', y: '黄', u: '青' };
const COLOR_OF = { 黒: 'b', 白: 'w', 黄: 'y', 青: 'u' };

// 棋譜を盤のルールで打ちなおす
function replayKifu(text, n) {
  const lines = String(text).split('\n');
  let g = E.newGame(n);
  let i = lines.indexOf('') + 1;
  let moves = 0;
  for (; i < lines.length && lines[i] !== ''; i += 1) {
    const m = /^(\d+) ([黒白黄青]) ([A-H][1-8])$/.exec(lines[i]);
    if (!m) return { ok: false, why: 'line ' + lines[i] };
    if (COLOR_OF[m[2]] !== g.turn) return { ok: false, why: 'color ' + lines[i] };
    const at = E.COLS.indexOf(m[3][0]) + (Number(m[3].slice(1)) - 1) * E.SIZE;
    const ng = E.play(g, at);
    if (!ng) return { ok: false, why: 'illegal ' + lines[i] };
    g = ng;
    moves += 1;
  }
  return { ok: g.over, board: g.board, moves, head: lines.slice(0, n + 1), last: lines[lines.length - 1] };
}

const seatNames = (c) => c.page.$$eval('#seats .rv-seat', (xs) => xs.map((x) => (x.querySelector('.rv-seat__name')?.textContent || '')));
const seatColors = (c) => c.page.$$eval('#seats .rv-seat', (xs) => xs.map((x) => ['b', 'w', 'y', 'u'].find((k) => x.classList.contains('rv-seat--' + k))));

(async () => {
  const server = await L.startServer();
  await L.launch();

  // ── 1台の画面 ──
  const P = await L.newClient('local', { viewport: { width: 1280, height: 860 } });
  await L.open(P);
  await P.page.click('#btnGoLocal');
  check('M1 はじめは2人・黄と青の名前の欄は出ない', await P.page.isChecked('input[name="localN"][value="2"]') && !(await L.visible(P, '#localNameY')) && !(await L.visible(P, '#localNameU')) && await L.visible(P, '#btnLocalSwap'));
  await P.page.click('label:has(input[name="localN"][value="4"])');
  check('M2 4人にすると黄・青の欄が出て、入れかえのボタンは隠れる', await L.visible(P, '#localNameY') && await L.visible(P, '#localNameU') && !(await L.visible(P, '#btnLocalSwap')));
  const whoLabels = await P.page.$$eval('#localAid input[type=radio]', (xs) => xs.map((x) => x.nextSibling.textContent));
  check('M3 補助を使う人に「みんな」と4色が出る', JSON.stringify(whoLabels) === JSON.stringify(['みんな', '黒の人だけ', '白の人だけ', '黄の人だけ', '青の人だけ', '使わない']), whoLabels);
  await P.page.fill('#localNameB', 'あ');
  await P.page.fill('#localNameW', 'い');
  await P.page.fill('#localNameY', 'う');
  await P.page.fill('#localNameU', 'え');
  await P.page.click('#btnLocalStart');
  await L.waitScreen(P, 'game');
  check('M4 札は4つ・石は1こずつ・黒から', JSON.stringify(await seatColors(P)) === '["b","w","y","u"]' && JSON.stringify(await L.counts(P)) === '[1,1,1,1]' && (await L.turnOf(P)) === 'b', [await seatColors(P), await L.counts(P)]);
  check('M5 はじめの並び（D4 黒・E4 白・E5 黄・D5 青）', (await L.readBoard(P)) === E.newGame(4).board);
  check('M6 置ける場所は D6・F4・F6', JSON.stringify(await L.spots(P)) === '[29,43,45]', await L.spots(P));
  check('M7 番の表示', (await L.status(P)) === '黒（あ）の番だよ', await L.status(P));
  await P.page.click(cell(0));
  check('M8 置けない場所のお知らせ（はさめるとき）', await waitFor(async () => (await L.text(P, '#roomk-toast') || '').includes('ほかの色の石をはさめる場所')));
  await P.page.click(cell(29));
  check('M9 F4 で E4 がかえり、白の番', await waitFor(async () => (await L.turnOf(P)) === 'w') && JSON.stringify(await L.counts(P)) === '[3,0,1,1]', await L.counts(P));
  check('M10 0こになった白にも番が来て、置ける場所が出る', (await L.spots(P)).length > 0, await L.spots(P));
  await L.shot(P, 'multi-local-4');
  // 広い画面の並び: 左上 黒・右上 白・右下 黄・左下 青
  const pos = await P.page.evaluate(() => {
    const bd = document.querySelector('.rv-board').getBoundingClientRect();
    const r = {};
    document.querySelectorAll('#seats .rv-seat').forEach((x) => {
      const k = ['b', 'w', 'y', 'u'].find((c) => x.classList.contains('rv-seat--' + c));
      const b = x.getBoundingClientRect();
      r[k] = { left: b.right <= bd.left, right: b.left >= bd.right, top: b.top + b.height / 2 < bd.top + bd.height / 2 };
    });
    return r;
  });
  check('M11 広い画面では盤の左右に時計まわり', pos.b.left && pos.b.top && pos.w.right && pos.w.top && pos.y.right && !pos.y.top && pos.u.left && !pos.u.top, pos);

  // 1手もどす
  await P.page.click('#btnUndo');
  check('M12 1手もどす', await waitFor(async () => (await L.readBoard(P)) === E.newGame(4).board && (await L.turnOf(P)) === 'b'));

  // 読み込み直し
  await P.page.click(cell(29));
  await waitFor(async () => (await L.turnOf(P)) === 'w');
  const sp = await L.spots(P);
  await P.page.click(cell(sp[0]));
  await waitFor(async () => (await L.turnOf(P)) === 'y');
  const before = await L.readBoard(P);
  await P.page.reload();
  await L.waitScreen(P, 'game');
  check('M13 読み込み直しても4人のまま続きから', (await L.readBoard(P)) === before && (await L.turnOf(P)) === 'y' && (await seatColors(P)).length === 4);

  // 最後まで（いつも先頭の置ける場所に置く）
  for (let k = 0; k < 70 && !(await L.visible(P, '#resultBox')); k += 1) {
    const s = await L.spots(P);
    if (!s.length) break;
    await P.page.click(cell(s[0]));
    await sleep(40);
  }
  const st = await L.status(P);
  check('M14 盤がうまって結果が出る', await L.visible(P, '#resultBox') && !(await L.readBoard(P)).includes('.'), st);
  check('M15 結果は勝った人と、その石の数だけ', /^(.+の勝ち！　石 \d+こ|みんな同じ数で、引き分け！)$/.test(st) && !/黒 \d+ ー/.test(st), st);
  const board = await L.readBoard(P);
  const cnt = E.count(board);
  const wins = E.winners(board, 4);
  const winTags = await P.page.$$eval('#seats .rv-seat', (xs) => xs.filter((x) => x.querySelector('.rv-tag--win')).length);
  check('M16 勝った人の札に「勝ち」', winTags === (wins.length === 4 ? 0 : wins.length), [winTags, wins]);
  check('M17 結果の数は勝った色の石の数', wins.length === 4 || st.endsWith('石 ' + cnt[wins[0]] + 'こ'), [st, cnt]);
  check('M18 local-finish を数える', await L.waitStats(P, 'local-finish', 1));
  await L.shot(P, 'multi-local-result');
  await P.page.click('#btnCopyKifu');
  await sleep(300);
  const kifu = await P.page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  const rp = replayKifu(kifu, 4);
  check('M19 棋譜: 見出しと4人の名前', JSON.stringify(rp.head) === JSON.stringify(['リバーシ（4人）', '黒: あ', '白: い', '黄: う', '青: え']), rp.head);
  check('M20 棋譜を打ちなおすと同じ盤になる（60手）', rp.ok && rp.moves === 60 && rp.board === board, rp.why || rp.moves);
  check('M21 棋譜の最後の行は結果の一行', rp.last === st.replace('！', ''), [rp.last, st]);

  // もう一回: 色をまわす（白の人が黒＝先に置く）
  check('M22 もう一回のボタンの文言', (await L.text(P, '#btnAgain')) === 'もう一回（色をまわす）');
  await P.page.click('#btnAgain');
  await waitFor(async () => !(await L.visible(P, '#resultBox')));
  check('M23 もう一回で色が1つずつまわる', JSON.stringify(await seatNames(P)) === JSON.stringify(['い', 'う', 'え', 'あ']), await seatNames(P));

  // となりに置く手（はさめる場所がないとき）: 3人の盤を作って読み込み直す
  await P.page.evaluate(() => {
    const a = Array(64).fill('.');
    a[27] = 'w'; a[28] = 'y';
    const game = { board: a.join(''), turn: 'b', last: -1, flipped: [], passed: null, over: false, ply: 0, n: 3, hist: [], moveTime: 0, turnAt: Date.now(), auto: null };
    sessionStorage.setItem('reversi_local', JSON.stringify({ names: { b: 'あ', w: 'い', y: 'う' }, aid: { who: 'both', spots: true, count: true, confirm: false }, cpu: null, cpus: [], level: 'normal', game }));
  });
  await P.page.reload();
  await L.waitScreen(P, 'game');
  check('M24 3人: 札は3つ', JSON.stringify(await seatColors(P)) === '["b","w","y"]');
  check('M25 はさめないときは石のとなり10マスに点', (await L.spots(P)).length === 10, await L.spots(P));
  const nums = await P.page.$$eval('#board .rv-mark.is-count', (xs) => xs.length);
  check('M26 ひっくり返る数を見せる設定でも、0 のところは数を出さない', nums === 0, nums);
  const label19 = await P.page.getAttribute(cell(19), 'aria-label');
  check('M26b 読み上げも数を言わない', label19 === 'D3 置ける', label19);
  await P.page.click(cell(0));
  check('M27 置けない場所のお知らせ（となり）', await waitFor(async () => (await L.text(P, '#roomk-toast') || '').includes('石のとなりに置いてね')));
  await P.page.click(cell(19));
  check('M28 となりに置くと、何もかえらず白の番', await waitFor(async () => (await L.turnOf(P)) === 'w') && JSON.stringify(await L.counts(P)) === '[1,1,1]', await L.counts(P));

  // CPU といっしょに（3人・自分が黒・ほかは CPU・つよい）
  await P.page.click('#btnQuit');
  await L.waitScreen(P, 'top');
  await P.page.click('#btnGoLocal');
  await P.page.click('label:has(input[name="localN"][value="3"])');
  await P.page.click('label:has(input[name="localVs"][value="w"])');
  await P.page.click('label:has(input[name="localLevel"][value="strong"])');
  check('M29 CPU の色（白・黄）の名前の欄は押せない', await P.page.isDisabled('#localNameW') && await P.page.isDisabled('#localNameY') && !(await P.page.isDisabled('#localNameB')) && !(await L.visible(P, '#localNameU')));
  check('M30 相手の選択肢の文言', (await L.text(P, '#localVsCpuW')) === 'CPU（自分が黒・ほかは CPU）');
  await P.page.fill('#localNameB', 'そら');
  await P.page.click('#btnLocalStart');
  await L.waitScreen(P, 'game');
  check('M31 名前は CPU', JSON.stringify(await seatNames(P)) === JSON.stringify(['そら', 'CPU', 'CPU']), await seatNames(P));
  const s0 = await L.spots(P);
  await P.page.click(cell(s0[0]));
  check('M32 白と黄の CPU が続けて置いて、自分の番にもどる', await waitFor(async () => (await L.turnOf(P)) === 'b' && (await L.status(P)).startsWith('CPU（黄）は '), 6000), await L.status(P));
  check('M33 自分の番の表示', (await L.status(P)).endsWith('あなたの番だよ（黒）。置ける場所に印が出ているよ'), await L.status(P));
  await P.page.click('#btnUndo');
  check('M34 1手もどすと、自分の手の前までもどる', await waitFor(async () => (await L.readBoard(P)) === E.newGame(3).board && (await L.turnOf(P)) === 'b'));
  const playCpuGame = async () => {
    for (let k = 0; k < 400 && !(await L.visible(P, '#resultBox')); k += 1) {
      if ((await L.status(P)).includes('あなたの番')) {
        const s = await L.spots(P);
        if (s.length) await P.page.click(cell(s[0]));
      }
      await sleep(150);
    }
  };
  await playCpuGame();
  check('M35 CPU と最後まで遊べる', await L.visible(P, '#resultBox'), await L.status(P));
  await P.page.click('#btnAgain');
  check('M36 もう一回で色がまわり、自分は黄（先に CPU が2回置く）', await waitFor(async () => (await seatNames(P)).join() === 'CPU,CPU,そら' && (await L.turnOf(P)) === 'y' && (await L.status(P)).includes('あなたの番だよ（黄）'), 6000), [await seatNames(P), await L.status(P)]);
  await P.page.reload();
  await L.waitScreen(P, 'game');
  check('M36b 読み込み直しても、自分は黄のまま（CPU の色を覚えている）', (await L.status(P)).includes('あなたの番だよ（黄）'), await L.status(P));
  await playCpuGame();
  check('M36c 黄でも最後まで遊べる', await L.visible(P, '#resultBox'));
  await P.page.click('#btnRelobby');
  await L.waitScreen(P, 'local');
  check('M37 名前と補助を変える画面は3人・CPU のまま', await P.page.isChecked('input[name="localN"][value="3"]') && await P.page.isChecked('input[name="localVs"][value="w"]'));
  check('M37b 色をまわしたあとでも、自分の名前は自分の欄に入る', (await P.page.inputValue('#localNameB')) === 'そら' && (await P.page.inputValue('#localNameW')) === '', await P.page.inputValue('#localNameB'));
  await P.page.click('label:has(input[name="localN"][value="4"])');
  await P.page.click('label:has(input[name="localVs"][value=""])');
  await P.page.click('#btnLocalStart');
  await L.waitScreen(P, 'game');

  // 幅
  await P.page.setViewportSize({ width: 375, height: 760 });
  await sleep(300);
  check('W1 375px で横にはみ出さない（4人）', (await L.overflow(P)) <= 0);
  const rows = await P.page.$$eval('#seats .rv-seat', (xs) => xs.map((x) => Math.round(x.getBoundingClientRect().top)));
  check('W2 375px で札は2段（上 黒・白、下 青・黄）', rows[0] === rows[1] && rows[2] === rows[3] && rows[2] > rows[0], rows);
  await L.shot(P, 'multi-local-375');
  await P.page.click('#btnQuit');

  // ── ルーム ──
  const H = await L.newClient('host');
  const A = await L.newClient('guest-a');
  const B = await L.newClient('guest-b');
  const C = await L.newClient('guest-c');
  const code = await L.createRoom(H, 'ホスト');
  await L.joinRoom(A, 'あお', code);
  await L.joinRoom(B, 'みどり', code);
  await L.joinRoom(C, 'きいろ', code);
  let room = await L.roomWhen(code, (r) => r.seats?.b === 'あお' && r.seats?.w === 'みどり');
  check('R1 はじめは2人・入った順に黒と白', room.n === 2 && !room.seats.y, room.seats);
  check('R2 人数の選択はホストだけ', await L.visible(H, '#playersEdit') && !(await L.visible(A, '#playersEdit')) && (await L.text(A, '#playersView')) === '2人');
  await H.page.click('label:has(input[name="players"][value="4"])');
  room = await L.roomWhen(code, (r) => r.n === 4 && r.seats?.y === 'きいろ');
  check('R3 4人にすると、席にいない参加者が黄に入る', room.n === 4 && room.seats.y === 'きいろ' && !room.seats.u, room.seats);
  check('R4 参加者の画面も4人・席は4つ', await waitFor(async () => (await L.text(A, '#playersView')) === '4人' && (await A.page.$$eval('#seatView .rv-seatview', (x) => x.length)) === 4));
  check('R5 そろうまで「はじめる」は押せない', await H.page.isDisabled('#btnStartGame') && (await L.text(H, '#seatNote')).includes('黒・白・黄・青の人を選んでね'), await L.text(H, '#seatNote'));
  await H.page.selectOption('#seatU', 'ホスト');
  await L.roomWhen(code, (r) => r.seats?.u === 'ホスト');
  check('R6 そろうと「はじめる」が押せて、置く順が出る', await waitFor(async () => !(await H.page.isDisabled('#btnStartGame'))) && (await L.text(H, '#seatNote')) === '黒→白→黄→青の順に置くよ', await L.text(H, '#seatNote'));
  // 席の入れかえ: 黄の人を黒に選ぶと、黒にいた人が黄へ
  await H.page.selectOption('#seatB', 'きいろ');
  room = await L.roomWhen(code, (r) => r.seats?.b === 'きいろ');
  check('R7 ほかの色の席の人を選ぶと入れかわる', room.seats.b === 'きいろ' && room.seats.y === 'あお', room.seats);
  await H.page.selectOption('#seatB', 'あお');
  await L.roomWhen(code, (r) => r.seats?.b === 'あお' && r.seats?.y === 'きいろ');
  const W = await L.newClient('watch');
  await L.open(W, '?watch=' + code);
  await L.waitScreen(W, 'waiting');
  await H.page.click('#btnStartGame');
  for (const c of [H, A, B, C, W]) await L.waitScreen(c, 'game');
  room = await L.roomOf(code);
  check('R8 対局は4人・席は4つ', room.game.n === 4 && Object.keys(room.game.seats).length === 4, room.game.seats);
  check('R9 players-4 を数える', await L.waitStats(H, 'players-4', 1));
  check('R10 自分の色の表示', (await L.text(C, '#barMe')) === 'きいろ・あなたは黄' && (await L.text(H, '#barMe')) === 'ホスト・あなたは青', [await L.text(C, '#barMe'), await L.text(H, '#barMe')]);
  check('R11 黒の人の画面だけ押せる', (await L.status(A, '#gameStatus')).startsWith('あなたの番だよ（黒）') && (await L.status(B)).startsWith('黒（あお）が考え中') && await B.page.isDisabled(cell(29)));
  const who = { b: A, w: B, y: C, u: H };
  let moves = 0;
  for (let k = 0; k < 80; k += 1) {
    const g = (await L.roomOf(code)).game;
    if (!g || g.over) break;
    const c = who[g.turn];
    await waitFor(async () => (await L.turnOf(c)) === g.turn && (await L.readBoard(c)) === g.board, 4000);
    const s = await L.spots(c);
    const mv = Object.keys(E.movesOf(g.board, g.turn, 4)).map(Number).sort((a, b) => a - b);
    if (k < 8) check('R12 置ける場所の印はルールと同じ（' + k + '手目）', JSON.stringify(s) === JSON.stringify(mv), [s, mv]);
    await c.page.click(cell(mv[mv.length - 1]));
    await L.roomWhen(code, (r) => r.game.ply === g.ply + 1, 4000);
    moves += 1;
  }
  room = await L.roomOf(code);
  check('R13 4人で最後まで（60手）', room.game.over && moves === 60, [moves, room.game.over]);
  const fin = room.game.board;
  check('R14 みんなにみせる画面も同じ盤と結果', await waitFor(async () => (await L.readBoard(W)) === fin && (await L.status(W)) === (await L.status(H))), [await L.status(W)]);
  check('R15 finish を数える', await L.waitStats(H, 'finish', 1) || await L.waitStats(A, 'finish', 1) || await L.waitStats(B, 'finish', 1) || await L.waitStats(C, 'finish', 1));
  await L.shot(H, 'multi-room-result');
  await L.shot(W, 'multi-watch-result');
  check('R16 もう一回のボタン', (await L.text(H, '#btnAgain')) === 'もう一回（色をまわす）');
  await H.page.click('#btnAgain');
  room = await L.roomWhen(code, (r) => r.game && !r.game.over && r.game.ply === 0);
  const rs = room.game.seats;
  check('R17 もう一回で色がまわる', rs.b === 'みどり' && rs.w === 'きいろ' && rs.y === 'ホスト' && rs.u === 'あお', rs);
  check('R18 players-4 をもう一度数える', await L.waitStats(H, 'players-4', 2));

  // 待合室へ → 3人にへらす・制限時間 15秒 → 時間切れの CPU
  await H.page.click('#btnReset');
  await L.waitScreen(H, 'waiting');
  await H.page.click('label:has(input[name="players"][value="3"])');
  room = await L.roomWhen(code, (r) => r.n === 3);
  check('R19 3人にへらすと青の席が空く', !room.seats.u && room.seats.b === 'みどり' && room.seats.y === 'ホスト', room.seats);
  check('R20 参加者の画面の席は3つ', await waitFor(async () => (await A.page.$$eval('#seatView .rv-seatview', (x) => x.length)) === 3));
  await H.page.selectOption('#moveTime', '15');
  await L.roomWhen(code, (r) => r.moveTime === 15);
  await H.page.click('#btnStartGame');
  room = await L.roomWhen(code, (r) => r.game && r.game.n === 3);
  check('R21 3人の対局', room.game.n === 3 && !room.game.seats.u && room.game.board === E.newGame(3).board, room.game.seats);
  check('R22 観戦になった人（あお）は押せない', await waitFor(async () => (await L.text(A, '#barMe')) === 'あお・観戦中'));
  check('R23 番の人の札に残り時間', await waitFor(async () => /^b:のこり 1[45]秒$/.test(await L.clockText(B))), await L.clockText(B));
  await L.rest('PUT', L.ROOMS + '/' + code + '/game/turnAt', Date.now() - 20000);
  room = await L.roomWhen(code, (r) => r.game.ply === 1, 8000);
  check('R24 時間切れで CPU が黒の代わりに置く（置ける場所に）', room.game.auto === 'b' && E.movesOf(E.newGame(3).board, 'b', 3)[room.game.last] != null, room.game);
  check('R25 時間切れのお知らせ', await waitFor(async () => (await L.status(C)).startsWith('時間切れ。CPU が黒の代わりに ')), await L.status(C));
  await L.shot(C, 'multi-room-3');

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
