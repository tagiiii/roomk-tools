// 作戦会議 E2E その1: 進行役・子ども2人・みんなにみせる画面を別々のブラウザで動かし、流れを通す。
// 本物のクイズパックでルームを作り、参加用のリンクが自動で子どもに届くところまで見る。
const L = require('./lib.cjs');
const { check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  L.writeNotices([
    { date: L.addDays(-3), start: '10:00', end: '10:45', name: 'もう終わったプログラム', place: 'ひろば', cat: '特別プログラム' },
    { date: L.addDays(1), start: '13:00', end: '13:45', name: 'テストの特別プログラム', place: 'マイクラルーム', cat: '特別プログラム' },
    { date: L.addDays(18), start: '10:30', end: '11:15', name: 'テストのキャリアWEEK', place: '探Qルーム', cat: '進路プログラム' },
  ]);
  const H = await L.newClient('host');
  const W = await L.newClient('watch', { viewport: { width: 1280, height: 720 } });
  const A = await L.newClient('sota', { viewport: { width: 375, height: 812 } });
  const B = await L.newClient('mio', { viewport: { width: 375, height: 812 } });
  const hostOps = () => L.stageText(H, '#h-ops');
  const watch = () => L.stageText(W, '#watch-wrap');

  // ── 入口 ──
  const code = await L.createRoom(H);
  let room = await L.roomOf(code);
  check('A1 ルームコードは6文字（まぎらわしい字なし）', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('A2 ルームができている（status・進行役の在室）', room && room.status === 'live' && room.hostConnected === true && !!room.players[room.host].connections, room && room.status);
  check('A3 お知らせは、きょうから先の単発実施プログラムだけ（2件）', Array.isArray(room.notices) && room.notices.length === 2 && room.notices[0].name === 'テストの特別プログラム', room.notices);
  check('A4 チェックインのお題が入っている（トークテーマカードから）', typeof room.topic === 'string' && room.topic.length > 3, room.topic);
  await L.openWatch(W, code);
  check('A5 みんなにみせる画面に表紙（作戦会議・ルームコード）', (await watch()).includes('作戦会議') && (await watch()).includes(code));
  check('A6 みんなにみせる画面では「？」を出さない', await W.page.evaluate(() => { const f = document.querySelector('.howto-fab'); return !f || getComputedStyle(f).display === 'none'; }));
  await L.joinByLink(A, code, 'そうた');
  await L.active(A, 'guest');
  check('A7 リンクから参加すると、アドレスから ?room= が外れる', !A.page.url().includes('room='), A.page.url());
  await L.waitText(H, '#h-people', 'そうた');
  check('A8 進行役の「参加する人」に名前が出る', (await L.stageText(H, '#h-people')).includes('自分の端末'));
  // 同じ名前は入れない
  await B.page.goto(`${L.BASE}?room=${code}`);
  await L.active(B, 'join');
  check('A9 リンクからひらくと、コードが入り案内が出る', (await B.page.inputValue('#join-code')) === code && await B.page.isVisible('#joinLinkHint'));
  await B.page.fill('#join-name', 'そうた');
  await B.page.click('#join-form button[type=submit]');
  await L.waitText(B, '#join-error', '使われている');
  check('A10 同じニックネームは、フォームの中で断る', true);
  await B.page.fill('#join-name', 'みお');
  await B.page.click('#join-form button[type=submit]');
  await L.active(B, 'guest');
  // 端末のない子を足す
  await H.page.fill('#h-add-name', 'はると');
  await H.page.click('#h-add button[type=submit]');
  await L.waitText(H, '#h-people', 'はると');
  check('A11 端末のない子を足せる（端末なしの印は進行役の画面だけ）', (await L.stageText(H, '#h-people')).includes('端末なし') && !(await watch()).includes('端末なし'));
  room = await L.roomOf(code);
  const ids = Object.fromEntries(Object.entries(room.persons).map(([id, p]) => [p.name, id]));
  check('A12 子どもは3人（persons）。端末のない子は在室を持たない', room.order.length === 3 && !room.players[ids['はると']] && !!room.players[ids['そうた']].connections, room.order);

  // ── チェックイン ──
  await H.page.click('#h-next');
  await L.waitText(W, '#watch-wrap', 'チェックイン');
  const t1 = (await L.roomOf(code)).topic;
  check('B1 みんなの画面と子どもの画面にお題', (await watch()).includes(t1) && (await L.stageText(A, '#guest')).includes(t1), t1);
  await H.page.click('#h-ops [data-act=talk]');
  await H.page.waitForFunction((t) => !document.getElementById('h-preview').innerText.includes(t), t1);
  check('B2 「別のお題にする」でお題が変わる', (await L.roomOf(code)).topic !== t1);
  await H.page.click('#h-chat');
  await sleep(300);
  const chat1 = await H.page.evaluate(() => navigator.clipboard.readText());
  check('B3 チャット用の文（お題・絵文字なし）', chat1.startsWith('【チェックイン】') && chat1.includes((await L.roomOf(code)).topic), chat1);

  // ── ジブンチェック ──
  await L.goBody(H, 'heart');
  await L.waitText(A, '#guest', 'いまの気持ちは？');
  check('C1 押す前は「送る」ボタンがない（押したらすぐ送る）', !(await A.page.$('.g-send')));
  await A.page.click('[data-act="g-heart"][data-val="4"]');
  await W.page.waitForFunction(() => [...document.querySelectorAll('#watch-wrap .lv li')].some((li) => li.innerText.includes('4') && li.innerText.includes('そうた')));
  check('C2 子どもが押すと、みんなの画面のその段に名前が出る', (await L.roomOf(code)).heart[ids['そうた']] === 4);
  await A.page.click('[data-act="g-heart"][data-val="2"]');
  await sleep(600);
  check('C3 別のものを押すと、選びなおせる', (await L.roomOf(code)).heart[ids['そうた']] === 2);
  await H.page.click(`#h-people [data-act="ans-heart"][data-pid="${ids['はると']}"][data-val="5"]`);
  await W.page.waitForFunction(() => [...document.querySelectorAll('#watch-wrap .lv li')].some((li) => li.innerText.includes('はると')));
  await B.page.click('[data-act="g-heart"][data-val="pass"]');
  await L.waitText(W, '#watch-wrap', 'パス');
  await L.waitText(H, '#h-count', '3／3');
  check('C4 進行役が代わりに入れる・パスも出る', (await L.stageText(H, '#h-count')).includes('3／3'), await L.stageText(H, '#h-count'));
  await L.shot(W, 'heart-watch'); await L.shot(A, 'heart-guest');
  // 押している間に、ほかの人の答えが届いて画面が変わっても、「押した」が届く
  const holdPress = async (c, sel, bump) => {
    await c.page.locator(sel).scrollIntoViewIfNeeded();
    const b = await c.page.locator(sel).boundingBox();
    await c.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await c.page.mouse.down();
    await bump(); await sleep(350);
    await c.page.mouse.up();
  };
  const heartIs = async (name, v) => { for (let i = 0; i < 30; i++) { if ((await L.roomOf(code)).heart[ids[name]] === v) return true; await sleep(100); } return false; };
  await holdPress(H, `#h-people [data-act="ans-heart"][data-pid="${ids['はると']}"][data-val="3"]`, () => L.rest('PUT', `${L.ROOMS}/${code}/heart/${ids['そうた']}`, 1));
  check('C5 進行役が押している間にほかの人の答えが届いても、押した分が入る', await heartIs('はると', 3), (await L.roomOf(code)).heart);
  await holdPress(A, '[data-act="g-heart"][data-val="5"]', () => L.rest('PUT', `${L.ROOMS}/${code}/heart/${ids['はると']}`, 1));
  check('C6 子どもが押している間にほかの人の答えが届いても、押した分が入る', await heartIs('そうた', 5), (await L.roomOf(code)).heart);
  await W.page.waitForFunction(() => [...document.querySelectorAll('#watch-wrap .lv li')].some((li) => li.innerText.includes('5') && li.innerText.includes('そうた')));
  check('C7 離したあとに、届いていた分もまとめて画面に出る', (await L.stageText(A, '#guest')).length > 0 && (await L.stageText(H, '#h-count')).includes('3／3'));

  // ── 今日は何する？（決めるのは進行役）──
  await L.goBody(H, 'menu');
  await L.waitText(A, '#guest', 'やりたいのは？');
  await A.page.click('[data-act="g-want"][data-key="study"]');
  await L.waitText(H, '#h-ops .h-seg', 'そうた');
  check('D1 子どもが押しても、みんなの画面は6つの選択肢のまま（名前の札がつくだけ）', (await W.page.$$('#watch-wrap .mn li')).length === 6 && (await watch()).includes('そうた') && !(await L.roomOf(code)).decided);
  await H.page.click('#h-ops [data-act=decide][data-key=study]');
  await L.waitText(W, '#watch-wrap', 'きょうは');
  check('D2 進行役が押すと決まる。候補はイラストつきのカード', (await W.page.$$('#watch-wrap .trow li')).length === 4 && (await watch()).includes('e-board'));
  check('D3 イラストが読めている', await W.page.evaluate(() => { const i = document.querySelector('#watch-wrap .trow img'); return !!i && i.complete && i.naturalWidth > 0; }));
  await A.page.waitForSelector('[data-act="g-tool"]');
  await A.page.click('[data-act="g-tool"] >> nth=1');
  await L.waitText(H, '#h-ops', '子どもがえらんだもの');
  check('D4 子どもが候補を押しても決まらない（進行役に「えらんだもの」が出る）', !(await L.roomOf(code)).tool && (await W.page.$$('#watch-wrap .trow li')).length === 4);
  // 子どもの「ほかも見る」は、その子の画面の中だけ
  const n0 = (await A.page.$$('[data-act="g-tool"]')).length;
  await A.page.click('[data-act="g-wide"]');
  const n1 = (await A.page.$$('[data-act="g-tool"]')).length;
  check('D5 子どもの「ほかのツールも見る」は自分の画面だけ広がる', n1 > n0 && !(await L.roomOf(code)).wide, [n0, n1]);
  // 進行役: ツールの一覧から選ぶ（種類ごと）
  await H.page.click('#h-ops [data-act=browse]');
  const sak = (await H.page.$$('#h-ops .tgrid button')).length;
  await H.page.click('#h-ops [data-act=btab][data-tab=suiri]');
  const sui = (await H.page.$$('#h-ops .tgrid button')).length;
  check('D6 ツールの一覧は、ツール一覧のページから読んで種類で切りかえられる', sak >= 10 && sui >= 3 && sak !== sui, [sak, sui]);
  check('D7 一覧を開いても、プレビューは縮めたまま', await H.page.evaluate(() => /scale\(0\.\d+\)/.test(document.querySelector('#h-preview .sl').style.transform)));
  await H.page.click('#h-ops [data-act=browse]');
  // クイズパックを使う。前に作ったルームの記録が残っていても、それは送らない
  await H.page.evaluate(() => sessionStorage.setItem('quiz_session', JSON.stringify({ roomCode: 'ZZZ234', role: 'host' })));
  await H.page.click('#h-ops .tscroll:not(.tscroll--wish) [data-act=tool] >> nth=0');
  await L.waitText(W, '#watch-wrap', 'これを使おう');
  check('D8 使うものが決まると、子どもには「進行役がひらくよ」（リンクはまだ出ない）', (await L.stageText(A, '#guest')).includes('進行役がひらくよ') && !(await A.page.$('#guest a.btn')));
  const popupP = H.context.waitForEvent('page');
  await H.page.click('#h-ops [data-act=open]');
  const popup = await popupP;
  await popup.waitForLoadState();
  check('D9 「クイズパックを開く」で、クイズパックのタブが開く', popup.url().includes('/apps/quiz/'), popup.url());
  await sleep(3000);
  check('D10 ルームを作る前は、子どもにリンクが出ない（前のルームの記録を送らない）', !(await A.page.$('#guest a.btn')) && !(await L.roomOf(code)).tool.join, (await L.roomOf(code)).tool);
  if (await popup.isVisible('#btnGoCreate').catch(() => false)) await popup.click('#btnGoCreate');
  await popup.fill('#hostName', 'しんこう');
  await popup.click('#btnCreateRoom');
  await popup.waitForFunction(() => /"roomCode":"[A-HJ-NP-Z2-9]{6}"/.test(sessionStorage.getItem('quiz_session') || '') && !sessionStorage.getItem('quiz_session').includes('ZZZ234'), null, { timeout: 15000 });
  const quizCode = JSON.parse(await popup.evaluate(() => sessionStorage.getItem('quiz_session'))).roomCode;
  await A.page.waitForSelector('#guest a.btn', { timeout: 8000 });
  const href = await A.page.getAttribute('#guest a.btn', 'href');
  check('D11 ルームを作ると、子どもの画面に参加用のリンク（?room=）が自動で出る', href.endsWith('/apps/quiz/?room=' + quizCode), href);
  check('D12 進行役に「リンクを送った」、みんなの画面に入り方', (await hostOps()).includes(quizCode) && (await watch()).includes('に入る'));
  await popup.close();
  await H.page.click('#h-ops [data-act=untool]');
  await H.page.click('#h-ops [data-act=undecide]');
  await L.waitText(W, '#watch-wrap', 'やりたいのは、どれ？');
  check('D13 「ほかのものに変える」で、6つの選択肢にもどる', (await W.page.$$('#watch-wrap .mn li')).length === 6);

  // ── 予定の確認（いっしょに入れる・つかんで動かす）──
  await L.goBody(H, 'plan');
  await L.waitText(A, '#guest', 'これからの予定');
  await A.page.click('[data-act=cell][data-cell="0-am"]');
  check('E1 はじめの選択肢に、学校のものがない（趣味はある）', await A.page.evaluate(() => { const t = [...document.querySelectorAll('#picker-chips .chip')].map((c) => c.dataset.t); return !t.includes('学校') && !t.includes('部活') && t.includes('趣味') && t.includes('room-K'); }));
  await A.page.click('#picker-chips .chip[data-t="room-K"]');
  await A.page.fill('#picker-text', 'ばあばの家');
  await A.page.click('#picker-form button[type=submit]');
  await A.page.click('#picker-close');
  await H.page.click(`#h-ops [data-act=sel][data-pid="${ids['そうた']}"]`);
  await L.waitText(W, '#watch-wrap', 'ばあばの家');
  check('E2 子どもが入れた予定が、みんなの画面と進行役に出る', (await watch()).includes('room-K') && (await watch()).includes('そうたさんの'));
  await H.page.click('#h-preview .cell[data-cell="2-pm"]');
  await H.page.click('#picker-chips .chip[data-t="おでかけ"]');
  await H.page.click('#picker-close');
  await L.waitText(A, '#guest', 'おでかけ');
  check('E3 進行役が入れた予定が、子どもの画面に出る', true);
  // 学校の束は、進行役がその子についてオンにしたときだけ
  await H.page.check('#h-ops [data-act=school]');
  await sleep(600);
  await A.page.click('[data-act=cell][data-cell="3-pm"]');
  check('E4 進行役がオンにすると、その子の選択肢に学校・テスト・行事・部活が出る', await A.page.evaluate(() => { const t = [...document.querySelectorAll('#picker-chips .chip')].map((c) => c.dataset.t); return ['学校', 'テスト', '行事', '部活'].every((x) => t.includes(x)); }));
  await A.page.click('#picker-close');
  await B.page.click('[data-act=cell][data-cell="3-pm"]');
  check('E5 ほかの子の選択肢には出ない', await B.page.evaluate(() => !([...document.querySelectorAll('#picker-chips .chip')].map((c) => c.dataset.t).includes('学校'))));
  await B.page.click('#picker-close');
  // つかんで動かす（進行役のプレビューで）
  const from = await H.page.locator('#h-preview [data-drag="おでかけ"]').boundingBox();
  const to = await H.page.locator('#h-preview .cell[data-cell="4-todo"]').boundingBox();
  await H.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await H.page.mouse.down();
  await H.page.mouse.move(from.x + 40, from.y + 40, { steps: 4 });
  await H.page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await H.page.mouse.up();
  await H.page.waitForFunction(() => !!document.querySelector('#h-preview .cell[data-cell="4-todo"] [data-drag="おでかけ"]'));
  room = await L.roomOf(code);
  const cells = room.sched[ids['そうた']];
  check('E6 ふせんをつかんで別のマスへ動かせる', !cells['2-pm'] && cells['4-todo'].some((it) => it.t === 'おでかけ'), cells);
  check('E7 動かしたあと、選ぶ窓は開かない', !(await H.page.evaluate(() => document.getElementById('picker').open)));
  await L.shot(W, 'plan-watch'); await L.shot(A, 'plan-guest'); await L.shot(H, 'plan-host');

  // ── お知らせ ──
  await H.page.fill('#h-next-time', '10:15');
  await H.page.dispatchEvent('#h-next-time', 'change');
  // 時刻を入れた直後に、そのままほかのボタンを押しても効く（欄の確定で描きなおしても、押しが消えない）
  await L.goBody(H, 'news');
  await L.waitText(W, '#watch-wrap', 'テストの特別プログラム');
  check('F0 次回の時刻を入れた直後の1回めの押しが効く', true);
  check('F1 お知らせに単発実施プログラムと次回の日（終わったものは出ない）', (await watch()).includes('テストのキャリアWEEK') && !(await watch()).includes('もう終わった') && (await watch()).includes('10:15'));
  await H.page.click('#h-chat');
  await sleep(300);
  const chat2 = await H.page.evaluate(() => navigator.clipboard.readText());
  check('F2 チャット用の文（お知らせ）', chat2.startsWith('【お知らせ】') && chat2.includes('テストの特別プログラム') && chat2.includes('次回は'), chat2);
  await L.shot(W, 'news-watch');

  // ── コーナーの表紙を出さない ──
  await H.page.uncheck('#h-covers');
  await H.page.click('#h-steps [data-act=jump][data-id=heart]');
  await L.waitText(W, '#watch-wrap', 'いまの気持ちは？');
  check('G1 「コーナーの表紙を出す」を外すと、表紙を飛ばして中身から', true);

  // ── 読みこみなおし・切断と復帰 ──
  await A.page.reload();
  await L.active(A, 'guest');
  check('H1 子どもが読みこみなおしても、同じ名前で戻る', (await L.stageText(A, '#guest')).includes('そうた'));
  await H.page.reload();
  await L.active(H, 'host');
  check('H2 進行役が読みこみなおしても、進行役として戻る', (await H.page.textContent('#h-code')) === code && (await L.roomOf(code)).hostConnected === true);
  await H.context.setOffline(true);
  await L.waitText(A, '#overlay', '進行役の戻りを待っています', 20000);
  check('H3 進行役の通信が切れると、子どもとみんなの画面に「待っています」', (await L.stageText(W, '#overlay')).includes('待っています'));
  await H.context.setOffline(false);
  await A.page.waitForFunction(() => document.getElementById('overlay').hidden, null, { timeout: 20000 });
  // 古い接続の切断の予約が遅れて動いても、進行役が在室を入れなおして「接続中」に戻る
  await sleep(4000);
  check('H4 戻ると「待っています」が消え、そのまま接続中でいる', (await L.roomOf(code)).hostConnected === true && await A.page.evaluate(() => document.getElementById('overlay').hidden), (await L.roomOf(code)).hostConnected);

  // ── 外す・退出・閉じる ──
  await H.page.click(`#h-people [data-act=remove][data-pid="${ids['そうた']}"]`);
  await L.waitText(A, '#overlay', 'ルームから外れました');
  check('I1 進行役が外すと、その子に「ルームから外れました」', !(await L.roomOf(code)).persons[ids['そうた']]);
  await B.page.click('#g-leave');
  await L.active(B, 'top');
  await H.page.waitForFunction(() => !document.getElementById('h-people').innerText.includes('みお'));
  check('I2 「退出する」で抜けると、参加する人から消える', !(await L.roomOf(code)).persons[ids['みお']]);
  await H.page.click('#h-close');
  await L.active(H, 'top');
  await L.waitText(W, '#overlay', 'おしまい');
  await sleep(2500);
  check('I3 「ルームを閉じる」でルームが消える（内容を残さない）', (await L.roomOf(code)) === null);
  check('I4 子どもの画面が横にはみ出していない（幅375px）', await B.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  await L.finish(server);
})().catch((e) => { console.error(e); console.error('errors', L.T.errors, 'violations', L.T.violations); process.exit(1); });
