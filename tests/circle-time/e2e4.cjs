// サークルタイム E2E その4: 準備は自動（入力欄はたたむ・4つの準備のようす・午前午後は時刻で）・プログラム（Notion のファイルから・時刻ごと・場所・この日だけ・サムネイル・申し込み制の印は出さない・午後は次の平日）・日本地図の天気・自由タイム（お題・クイズ・ことばあそび・参加者も押せる・続けて押せない・答えを見る）
const L = require('./lib.cjs');
const { check, sleep } = L;

const PROGRAM = [
  { start: '9:30', end: '10:15', name: 'ボドゲクラブ', place: 'クラブルーム', once: false, thumb: 'https://katariba.notion.site/image/attachment%3Atest%3Aboardgame.png?table=block&id=x&width=480' },
  { start: '9:30', end: '10:15', name: 'ほわぽかひろば', place: 'のんびり', once: false, thumb: '' },
  { start: '10:30', end: '11:15', name: 'コトバであそぼ!', place: '学びの沼', once: false, apply: true },
  { start: '13:00', end: '13:45', name: 'マイクラのミッション', place: 'マイクラルーム', once: true },
];

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host', { program: PROGRAM });
  const A = await L.newClient('yui', { viewport: { width: 375, height: 812 } });
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });

  // ── A. 準備は自動 ──
  await L.open(H);
  await H.page.click('#go-create');
  await L.waitScreen(H, 'setup');
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  check('A1 午前・午後は時刻で選ばれる', await L.pressed(H, `#seg-session button[data-v="${hour < 12 ? 'am' : 'pm'}"]`));
  check('A2 直す欄はたたんである', await H.page.evaluate(() => { const d = document.getElementById('setup-more'); return !d.open && d.contains(document.getElementById('prog-lines')) && d.contains(document.getElementById('day-0')); }));
  await H.page.click('#seg-session button[data-v="am"]');
  await L.waitText(H, '#prog-status-text', '件を room-K ポータルから');
  await L.waitText(H, '#wx-status-text', '13都市', 15000);
  await L.waitText(H, '#topic-status-text', 'クイズ', 15000);
  check('A3 プログラムは4件・この日だけ1件', (await L.text(H, '#prog-status-text')).includes('4件') && (await L.text(H, '#prog-status-text')).includes('この日だけのもの 1件'));
  check('A4 準備のようすは「できた」の色', await H.page.evaluate(() => ['rd-wx', 'rd-prog', 'rd-topic'].every((id) => document.getElementById(id).className === 'ok')));
  const qn = Number(((await L.text(H, '#topic-status-text')).match(/クイズ(\d+)問/) || [])[1]);
  check('A5 クイズは既存のパックから読む', qn >= 30, qn);
  await H.page.evaluate(() => { document.getElementById('setup-more').open = true; });
  const lines = (await H.page.inputValue('#prog-lines')).split('\n');
  check('A6 プログラムの文の形', lines[0] === '9:30 ボドゲクラブ｜クラブルーム' && lines[2] === '10:30 コトバであそぼ!｜学びの沼' && lines[3] === '13:00 マイクラのミッション｜マイクラルーム｜この日だけ', lines);
  await H.page.click('#seg-session button[data-v="pm"]');
  await L.waitText(H, '#prog-head', '明日のプログラム');
  check('A7 午後は明日のプログラム・何の日は出さない', !(await L.visible(H, '#rd-day')) && !(await L.visible(H, '#am-fields')));
  await H.page.click('#seg-session button[data-v="am"]');
  await L.waitText(H, '#prog-status-text', '件を room-K ポータルから');
  await H.page.fill('#host-name', 'たぎ');
  await L.shot(H, 'setup-auto');
  await H.page.click('#btn-create');
  await L.waitScreen(H, 'host');
  const code = (await L.text(H, '#host-code')).trim();
  let room = await L.roomOf(code);
  check('A8 自由タイムは、あそびを決めずに始まる', !room.free?.mode && room.free?.n === 1);

  // ── B. 自由タイム ──
  await L.joinRoom(A, 'ゆい', code);
  await L.openWatch(W, code);
  await L.waitStage(W, '午前のサークルタイム');
  await L.nextMain(H, code);
  await L.waitStage(W, 'なにしてあそぶ');
  check('B1 みせる画面に3つのあそびとおまかせ・説明', (await W.page.evaluate(() => document.querySelectorAll('#watch-stage .fr-opt').length)) === 4 && (await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .fr-opt img')].filter((i) => i.complete && i.naturalWidth > 0).length)) === 4 && (await L.stage(W)).includes('話したい人が話す'));
  check('B2 時刻と名前の一覧は出さない', !(await L.stage(W)).includes('9:15') && !(await L.stage(W)).includes('ゆい'));
  check('B3 ホストに自由タイムの操作（つぎ・答えを見るはまだ出さない）', await L.visible(H, '#free-ctrls') && !(await L.visible(H, '#free-ctrls [data-f="show"]')) && !(await L.visible(H, '#free-ctrls [data-f="next"]')));
  check('B3b 番号は丸の中に丸を入れない', await W.page.evaluate(() => getComputedStyle(document.querySelector('#watch-stage .fr-opt .num')).backgroundColor === 'rgba(0, 0, 0, 0)'));
  // 参加者は、やりたいもの（おまかせも）を送るだけ。画面は変わらず、だれが何をえらんだかも出ない
  const K = await L.newClient('sora');
  await L.joinRoom(K, 'そら', code);
  await L.waitPlayer(A, 'おまかせ');
  check('B3c 参加者に3つとおまかせ', (await A.page.evaluate(() => document.querySelectorAll('#player-card [data-act="fwish"]').length)) === 4);
  await L.shot(W, 'free-choose', false);
  await A.page.click('#player-card [data-act="fwish"][data-v="quiz"]');
  await K.page.click('#player-card [data-act="fwish"][data-v="any"]');
  await L.waitText(H, '#free-wish', 'おまかせ 1');
  room = await L.roomOf(code);
  check('B3d 進行役には人数だけ', (await L.text(H, '#free-wish')).includes('クイズ 1') && !(await L.text(H, '#plist')).includes('クイズ') && !(await L.text(H, '#plist')).includes('おまかせ'));
  check('B3e 押しても画面のあそびは変わらない・名前も出ない', !room.free.mode && (await L.stage(W)).includes('なにしてあそぶ') && !(await L.stage(W)).includes('ゆい') && !(await L.stage(W)).includes('そら'));
  check('B3f 自分の端末では、えらんだものに印', await L.pressed(A, '#player-card [data-act="fwish"][data-v="quiz"]'));
  await L.shot(A, 'free-player-choose');
  // 進行役がえらぶ
  await H.page.click('#free-ctrls [data-f="talk"]');
  room = await L.waitRoom(code, (r) => r.free?.mode === 'talk');
  await L.waitStage(W, 'チャットに書いた人');
  check('B3g 進行役が「おしゃべりのお題」にする', room.free.n === 2 && (await L.stage(W)).includes(room.free.topic));
  await L.waitPlayer(A, '話したい');
  check('B3h 参加者に「つぎ」「えらびなおす」は出さない', !(await A.page.$('#player-card [data-act="fnext"]')) && !(await L.player(A)).includes('えらびなおす'));
  await L.shot(W, 'free-talk', false);
  await A.page.click('#player-card [data-act="fhand"]');
  await W.page.waitForFunction(() => document.querySelector('#watch-stage .hands-box')?.textContent.includes('ゆい'));
  check('B4 参加者の「話したい」が出る', true);
  await sleep(2700);
  await H.page.click('#free-ctrls [data-f="quiz"]');
  await L.waitStage(W, '①');
  room = await L.roomOf(code);
  check('B5 進行役がクイズに変える', room.free.mode === 'quiz' && room.free.n === 3 && room.free.quiz.c.length >= 2);
  check('B6 話したいは次のあそびに持ちこさない', !(await L.stage(W)).includes('話したい人'));
  await L.waitPlayer(A, room.free.quiz.q.slice(0, 6));
  await A.page.click('#player-card [data-act="fq"][data-v="0"]');
  await W.page.waitForFunction(() => document.querySelector('#watch-stage .fb-c')?.textContent.includes('ゆい'));
  check('B7 クイズの答えに名前', true);
  // すぐ「つぎ」は押せない
  await H.page.click('#free-ctrls [data-f="next"]');
  await L.waitToast(H, 'ちょっとまってね');
  check('B8 続けて押すと待ってねと出る', (await L.roomOf(code)).free.n === 3);
  await H.page.click('#free-ctrls [data-f="show"]');
  await W.page.waitForFunction(() => !!document.querySelector('#watch-stage .fb-c.ok'));
  room = await L.roomOf(code);
  check('B9 答えを見ると正解の印と説明', (await L.stage(W)).includes('答えは') && room.free.shown === true);
  await L.waitPlayer(A, '答えは');
  check('B10 参加者にも答え', true);
  await L.shot(W, 'free-quiz', false);
  await sleep(2700);
  await H.page.click('#free-ctrls [data-f="kotoba"]');
  await L.waitStage(W, 'からはじまる');
  room = await L.roomOf(code);
  check('B11 ことばあそびは頭文字とテーマ', room.free.mode === 'kotoba' && room.free.kotoba.i.length === 1 && room.free.kotoba.t.length > 1);
  await L.shot(W, 'free-kotoba', false);
  await sleep(2700);
  await H.page.click('#free-ctrls [data-f="next"]');
  await L.waitRoom(code, (r) => r.free?.n === 5);
  check('B12 進行役の「つぎ」で入れかわる', true);
  await sleep(2700);
  await H.page.click('#free-ctrls [data-f="choose"]');
  await L.waitRoom(code, (r) => !r.free?.mode && r.free?.n === 6);
  await L.waitText(H, '#free-wish', 'クイズ 0');
  check('B12b えらぶ画面に戻ると、やりたいはまっさら', (await L.text(H, '#free-wish')).includes('おまかせ 0') && !(await L.pressed(A, '#player-card [data-act="fwish"][data-v="quiz"]').catch(() => false)));
  check('B13 参加者の画面は375pxではみ出ない', (await L.overflow(A)) <= 0);
  await L.shot(A, 'free-player');

  // ── C. 天気の地図 ──
  const steps0 = (await L.roomOf(code)).steps, ids = steps0.map((s) => s.id);
  await L.goMain(H, code, steps0.find((s) => s.type === 'weather').id);
  await L.waitStage(W, '出典');
  const wx = await W.page.evaluate(() => ({
    land: document.querySelectorAll('#watch-stage .wxmap path.land').length,
    landLen: [...document.querySelectorAll('#watch-stage .wxmap path.land')].map((p) => p.getAttribute('d').length),
    cards: document.querySelectorAll('#watch-stage .wxcard').length,
    dots: document.querySelectorAll('#watch-stage .wxmap .dot').length,
    tokyo: document.querySelector('#watch-stage .wxcard[data-city="東京"]')?.textContent,
    ask: !!document.querySelector('#watch-stage .wxmap foreignObject .ask2'),
  }));
  check('C1 日本地図（本州・沖縄の2つ）', wx.land === 2 && wx.landLen[0] > 5000 && wx.landLen[1] > 300, wx.landLen);
  check('C2 13都市のカードと点', wx.cards === 13 && wx.dots === 13, wx);
  check('C3 東京は晴れ 21/10（天気の言葉は出さない）', /東京.*sunny.*21\/10/.test(wx.tokyo || '') && !(wx.tokyo || '').includes('晴れ'), wx.tokyo);
  check('C4 きみのところは？は地図の中', wx.ask);
  // カードどうしが重ならない
  const overlap = await W.page.evaluate(() => {
    const r = [...document.querySelectorAll('#watch-stage .wxcard rect')].map((e) => e.getBoundingClientRect());
    const fo = document.querySelector('#watch-stage .wxmap foreignObject').getBoundingClientRect();
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    let n = 0; for (let i = 0; i < r.length; i++) { if (hit(r[i], fo)) n++; for (let j = i + 1; j < r.length; j++) if (hit(r[i], r[j])) n++; }
    return n;
  });
  check('C5 カードと「きみのところは？」が重ならない', overlap === 0, overlap);
  await L.shot(W, 'weather-map', false);

  // ── D. プログラム ──
  await L.goMain(H, code, steps0.find((s) => s.type === 'show').id);
  await L.waitStage(W, 'ボドゲクラブ');
  const pg = await W.page.evaluate(() => ({
    rows: [...document.querySelectorAll('#watch-stage .pgx-row')].map((r) => r.querySelector('.tm').textContent),
    first: document.querySelector('#watch-stage .pgx-row')?.textContent,
    once: document.querySelector('#watch-stage .pg-tag.once')?.textContent,
    apply: [...document.querySelectorAll('#watch-stage .pg-tag')].map((t) => t.textContent),
    thumbs: [...document.querySelectorAll('#watch-stage .pgx-it .th')].map((t) => t.style.backgroundImage),
  }));
  check('D1 時刻ごとにまとまり、1コマ目から数える', JSON.stringify(pg.rows) === JSON.stringify(['1コマ目9:30', '2コマ目10:30', '3コマ目13:00']), pg.rows);
  check('D2 同じ時刻は1行に・場所も出る', pg.first.includes('ボドゲクラブ') && pg.first.includes('ほわぽかひろば') && pg.first.includes('クラブルーム'));
  check('D3 この日だけの印・申し込み制の印は出さない', pg.once === 'この日だけ' && !pg.apply.includes('申し込み制'), pg.apply);
  check('D3b サムネイルは画像のあるものだけ', pg.thumbs.length === 1 && pg.thumbs[0].includes('katariba.notion.site/image/'), pg.thumbs);
  await L.waitPlayer(A, 'ボドゲクラブ');
  check('D4 参加者の画面にもコマ目・時刻・場所', (await L.player(A)).includes('1コマ目 9:30') && (await L.player(A)).includes('（クラブルーム）'));
  await L.shot(W, 'program', false);
  // 最後は1コマ目の移動の案内（場所つき）
  await H.page.click('#btn-next');
  await L.waitStage(W, '1コマ目のプログラムに移動しよう');
  check('D4b 時刻は小さく「9:30から」', (await L.stage(W)).includes('9:30から'));
  const mv = await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .mv-it')].map((e) => e.textContent));
  check('D5 1コマ目の2つと移動先', mv.length === 2 && mv[0].includes('ボドゲクラブ') && mv[0].includes('クラブルーム') && mv[1].includes('のんびり'), mv);
  const mvTh = await W.page.evaluate(() => [...document.querySelectorAll('#watch-stage .mv-it .th')].map((e) => e.style.backgroundImage));
  check('D5b 移動の案内にもサムネイル（画像のあるものだけ）', mvTh.length === 1 && mvTh[0].includes('katariba.notion.site/image/'), mvTh);
  await L.shot(W, 'am-closing-place', false);

  // ── E. 何もないとき ──
  const H2 = await L.newClient('host-none');
  await L.open(H2);
  await H2.page.click('#go-create');
  await L.waitText(H2, '#prog-status-text', 'まだ用意されていません');
  check('E1 プログラムがない日は知らせる', (await H2.page.evaluate(() => document.getElementById('rd-prog').className)) === 'none');

  await H.page.click('#btn-finish');
  await L.waitScreen(H, 'top');
  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(2); });
