// その1: 作成・参加・待合室・はじめる・歩く（位置の送り方）・仕事・停電・ねむらせる・ねむってからの仕事・
//        見つけた・会議・投票・結果・おしまい・待合室へ・会議ボタン・同じ数の票・ねむらせ屋の勝ち・ルームを閉じる・375px
const L = require('./lib.cjs');
const { E, check, sleep } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host');
  const g1 = await L.newClient('g1');
  const g2 = await L.newClient('g2');
  const g3 = await L.newClient('g3');
  const all = [host, g1, g2, g3];

  // ══ 待合室 ══
  const code = await L.createRoom(host, 'ホスト');
  check('ルームコード6文字', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  check('room-create を1回', await L.waitStats(host, 'room-create', 1));
  check('ホストに「コードをコピー」「リンクをコピー」「QRコードを出す」', await L.visible(host, '#btnCopyCode') && await L.visible(host, '#btnCopyLink') && await L.visible(host, '#btnShowQr'));
  await host.page.click('#btnCopyLink');
  const link = await host.page.evaluate(() => navigator.clipboard.readText());
  check('リンクをコピー', link.endsWith('?room=' + code), link);
  check('1人ではじめられない', await host.page.$eval('#btnStart', (b) => b.disabled));

  // ══ ルール（軽い決まり）: アプリを通さない書き込みは断る ══
  const tryWrite = (c, path, val) => c.page.evaluate(async ([p, v]) => {
    try { await firebase.database().ref(p).set(v); return 'ok'; } catch (e) { return /permission/i.test(String(e.code || e.message)) ? 'denied' : String(e.message); }
  }, [path, val]);
  const R0 = L.ROOMS + '/' + code;
  check('ルール: 位置は短い文字列なら書ける', (await tryWrite(host, R0 + '/p/テスト', '123,45,1')) === 'ok');
  check('ルール: 長い位置の文字列は断る', (await tryWrite(host, R0 + '/p/テスト', 'x'.repeat(40))) === 'denied');
  check('ルール: 文字列でない位置は断る', (await tryWrite(host, R0 + '/g/テスト', { x: 1 })) === 'denied');
  check('ルール: 長すぎる id の位置は断る', (await tryWrite(host, R0 + '/p/' + 'a'.repeat(30), '1,1,1')) === 'denied');
  check('ルール: 位置は消せる', (await tryWrite(host, R0 + '/p/テスト', null)) === 'ok');
  check('ルール: 部屋の中の r・p・g 以外は断る', (await tryWrite(host, R0 + '/x', 1)) === 'denied');
  check('ルール: ルームコードの形でない場所は断る', (await tryWrite(host, L.ROOMS + '/abc/r', { status: 'waiting' })) === 'denied');
  check('ルール: nemurase_rooms の外は断る', (await tryWrite(host, 'other/x', 1)) === 'denied');
  check('ルール: ルームの一覧は読めない', await host.page.evaluate(async (p) => {
    try { await firebase.database().ref(p).once('value'); return false; } catch (e) { return /permission/i.test(String(e.code || e.message)); }
  }, L.ROOMS));

  // 名前の検査
  await L.open(g1, '?room=' + code);
  check('リンクからひらくと参加画面（コード入り・ヒント）', (await L.screen(g1)) === 'join' && (await g1.page.inputValue('#joinCode')) === code && await L.visible(g1, '#joinLinkHint'));
  await g1.page.fill('#guestName', 'ホスト');
  await g1.page.click('#btnJoinRoom');
  await L.waitText(g1, '#joinError', 'その名前は使われているよ');
  check('ホストと同じ名前は入れない', true);
  await g1.page.fill('#guestName', 'ロボ1');
  await g1.page.click('#btnJoinRoom');
  await L.waitText(g1, '#joinError', 'ロボット');
  check('ロボットの名前は使えない', true);
  await g1.page.fill('#guestName', 'あお');
  await g1.page.click('#btnJoinRoom');
  await L.waitScreen(g1, 'waiting');
  await L.joinRoom(g2, 'みどり', code);
  await L.joinRoom(g3, 'そら', code);
  check('参加者には、はじめる・ロボット・コードのボタンがない', !(await L.visible(g1, '#btnStart')) && !(await L.visible(g1, '#botButtons')) && !(await L.visible(g1, '#btnCopyCode')));
  check('参加者にはホストの設定が出ない', !(await g1.page.$('#set-hostPlays')));
  check('一覧に4人', await L.waitFor(async () => (await host.page.$$('#lobbyPeople .nk-person')).length === 4));
  check('色がかぶらない', await L.waitFor(async () => {
    const r = await L.roomOf(code);
    const cs = Object.values(r.players).map((p) => p.color);
    return cs.length === 4 && new Set(cs).size === 4;
  }));
  await host.page.selectOption('#set-meeting', '60');
  check('設定が参加者に届く', await L.waitFor(async () => (await L.text(g1, '#set-meeting')) === '60秒'));
  await host.page.click('#btnAddBot');
  check('ロボットを入れると参加者の一覧にも出る', await L.waitFor(async () => (await g1.page.$$('#lobbyPeople .nk-person')).length === 5));
  await host.page.click('#btnRemoveBot');
  check('ロボットをへらせる', await L.waitFor(async () => (await g1.page.$$('#lobbyPeople .nk-person')).length === 4));
  await L.shot(host, '01-lobby');

  // ══ ねむらせ屋の決め方（ホストが選ぶ） ══
  check('はじめはランダム', (await L.text(g1, '#set-pick')) === 'ランダム');
  await host.page.selectOption('#set-pick', '1');
  check('「ホストが選ぶ」が参加者に届く', await L.waitFor(async () => (await L.text(g1, '#set-pick')) === 'ホストが選ぶ'));
  check('選ぶまで はじめられない・注意書き', await L.waitFor(async () => (await host.page.$eval('#btnStart', (b) => b.disabled)) && (await L.text(host, '#lobbyNote')) === 'ねむらせ屋にする人を、あと 1 人えらんでください'));
  check('ホストの一覧に「ねむらせ屋にする」が4つ', (await host.page.$$('#lobbyPeople .nk-person__pick')).length === 4);
  check('参加者の一覧には選ぶボタンがない', (await g1.page.$$('#lobbyPeople .nk-person__pick')).length === 0);
  await host.page.click('#lobbyPeople .nk-person__pick[aria-label="ねむらせ屋にする: そら"]');
  check('選んだ人にタグ・ボタンは「はずす」', await L.waitFor(async () => (await host.page.$$('#lobbyPeople .nk-tag--sleeper')).length === 1 && (await host.page.$('#lobbyPeople .nk-person__pick[aria-label="ねむらせ屋からはずす: そら"]')) !== null));
  check('選ぶとはじめられる・注意書きが消える', await L.waitFor(async () => !(await host.page.$eval('#btnStart', (b) => b.disabled)) && !(await L.text(host, '#lobbyNote')).includes('ねむらせ屋')));   // 2026-10-30 から、止める注意がないときは人数のおすすめが出る
  await host.page.click('#lobbyPeople .nk-person__pick[aria-label="ねむらせ屋にする: あお"]');
  check('2人選ぶと多すぎの注意書き・はじめられない', await L.waitFor(async () => (await host.page.$eval('#btnStart', (b) => b.disabled)) && (await L.text(host, '#lobbyNote')) === 'ねむらせ屋は 1 人です。1 人はずしてください'));
  await host.page.click('#lobbyPeople .nk-person__pick[aria-label="ねむらせ屋からはずす: あお"]');
  check('はずすともどる', await L.waitFor(async () => !(await host.page.$eval('#btnStart', (b) => b.disabled))));
  check('選んだ人は DB に書かれない（参加者には見えない）', !('picks' in (await L.roomOf(code))) && !('picks' in ((await L.roomOf(code)).settings || {})));
  check('参加者の一覧にタグが出ない', (await g1.page.$$('#lobbyPeople .nk-tag--sleeper')).length === 0);
  await L.shot(host, '01b-lobby-pick');

  // ══ はじめる ══
  check('4人ではじめられる', await L.waitFor(async () => !(await host.page.$eval('#btnStart', (b) => b.disabled))));
  await host.page.click('#btnStart');
  for (const c of all) await L.waitScreen(c, 'game');
  check('全員がゲームの画面', true);
  for (const c of all) check('役のお知らせ ' + c.label, await L.waitFor(() => L.visible(c, '#ovRole')));
  check('start・players-4 を1回', await L.waitStats(host, 'start', 1) && await L.waitStats(host, 'players-4', 1));
  let room = await L.roomOf(code);
  check('ねむらせ屋は1人・ひとり4つの仕事（隊員はふたりの仕事を足して5）', Object.values(room.game.roles).filter((r) => r === 'sleeper').length === 1 && Object.keys(room.game.tasks).every((id) => room.game.tasks[id].length === (room.game.roles[id] === 'crew' ? 5 : 4)));
  check('はじめは会議ボタンに待ち時間', room.game.buttonReadyAt > Date.now() + 10000, room.game.buttonReadyAt - Date.now());
  check('選んだ「そら」がねむらせ屋', room.game.roles['そら'] === 'sleeper');
  check('はじめると選んだ人は空にもどる', await host.page.evaluate(() => window.__NK__.state.picks.length === 0));
  check('のこり時間が15分', /^のこり 1[45]:\d\d$/.test(await L.text(host, '#hudTime')), await L.text(host, '#hudTime'));
  for (const c of all) await L.dismissRole(c);
  // テスト用に役を決める: あお＝ねむらせ屋
  const roles = { 'ホスト': 'crew', 'あお': 'sleeper', 'みどり': 'crew', 'そら': 'crew' };
  await L.patchGame(code, { roles, cooldown: { 'あお': 1 }, darkReadyAt: 1, buttonReadyAt: 1 });
  check('役の表示が変わる', await L.waitFor(async () => (await L.text(g1, '#hudRole')) === 'ねむらせ屋' && (await L.text(host, '#hudRole')) === '隊員'));
  check('ねむらせ屋にだけ、ねむらせる・停電', await L.waitFor(() => L.visible(g1, '#actSleep')) && !(await L.visible(g2, '#actSleep')));
  check('ねむらせ屋の一覧は「ふりをする場所」', (await L.text(g1, '#tasksTitle')).startsWith('ふりをする場所'));
  await L.shot(g1, '02-sleeper');

  // ══ ひとこと（遊んでいる間＝近くの人にだけ届く ささやき） ══
  check('おきている人に「ひとこと」ボタン', await L.visible(host, '#actSay') && await L.visible(g1, '#actSay'));
  check('声の約束の帯（いまはミュート）', (await L.text(host, '#hudMuteText')).includes('ミュート') && !(await host.page.$eval('#hudMute', (n) => n.classList.contains('is-talk'))));
  // みんなをホストの近く（見える広さの中）へ
  const hp = await L.me(host);
  await L.teleport(g1, hp.x + 1, hp.y);
  await L.teleport(g2, hp.x - 1, hp.y);
  await L.teleport(g3, hp.x, hp.y + 1);
  await sleep(300);
  await host.page.click('#actSay');
  check('一覧がひらく（遊んでいる間の14＋どちらでも4）', await L.waitFor(async () => (await L.visible(host, '#sayBox')) && (await host.page.$$('#sayChips .nk-word')).length === 18));
  check('「そうだよ」がある', (await host.page.$eval('#sayChips .nk-word[data-say="yes"]', (b) => b.textContent)) === 'そうだよ');
  check('名前の入る言葉は〔名前〕で出る', (await host.page.$eval('#sayChips .nk-word[data-say="sawnow"]', (b) => b.textContent)) === '〔名前〕さんが仕事をしていた');
  check('部屋の入る言葉は〔部屋〕で出る', (await host.page.$eval('#sayChips .nk-word[data-say="here"]', (b) => b.textContent)) === '〔部屋〕にいるよ');
  // 2026-10-29 部屋は「どこ？」で選ぶ（いまいる部屋がいちばん上。ほかの部屋・通路も選べる＝うそも言える）
  await host.page.click('#sayChips .nk-word[data-say="here"]');
  check('部屋の入る言葉を押すと「どこ？」（18部屋＋通路＋やめる）', await L.waitFor(async () => (await L.visible(host, '#sayNames')) && (await L.text(host, '#sayNames .nk-words__lead')) === 'どこ？' && (await host.page.$$('#sayNames .nk-word--room')).length === 19 && !!(await host.page.$('#sayNames .nk-word--room[data-room="hall"]'))));
  check('いまいる部屋がいちばん上に「（いまいる）」', (await host.page.$eval('#sayNames .nk-word--room', (b) => b.dataset.room + ':' + b.textContent)) === 'plaza:ひろば（いまいる）');
  check('押した言葉に印（部屋）', await host.page.$eval('#sayChips .nk-word[data-say="here"]', (b) => b.classList.contains('is-picked')));
  await L.shot(host, '02c-say-where');
  await host.page.click('#sayNames .nk-word--room[data-room="plaza"]');
  for (const c of all) check('みんなの画面の上に「ホスト: ひろばにいるよ」 ' + c.label, await L.waitFor(async () => (await L.text(c, '#sayTicker')) === 'ホストひろばにいるよ'));
  check('送ると一覧がとじる', await L.waitFor(async () => !(await L.visible(host, '#sayBox'))));
  room = await L.roomOf(code);
  check('game/say にひとり1枠（キー・部屋・番号1・会議0・位置つき）', room.game.say && room.game.say['ホスト'] && room.game.say['ホスト'].k === 'here' && room.game.say['ホスト'].r === 'plaza' && room.game.say['ホスト'].n === 1 && room.game.say['ホスト'].m === 0 && Math.abs(room.game.say['ホスト'].x - hp.x) < 0.2, room.game.say);
  // いまいない部屋も選べる（うその場所・ねむっている人を見た場所）
  await g1.page.click('#actSay');
  await g1.page.click('#sayChips .nk-word[data-say="body"]');
  check('「〔部屋〕でねむっている人がいた！」も「どこ？」', await L.waitFor(async () => (await L.visible(g1, '#sayNames')) && (await L.text(g1, '#sayNames .nk-words__lead')) === 'どこ？'));
  {
    const vp = g1.page.viewportSize();
    await g1.page.setViewportSize({ width: 375, height: 740 });
    await sleep(300);
    check('375px: 「どこ？」に横スクロールがない', (await L.overflow(g1)) <= 0 && await g1.page.$eval('#sayBox', (b) => b.getBoundingClientRect().right <= window.innerWidth));
    await L.shot(g1, '02d-say-where-375');
    await g1.page.setViewportSize(vp);
    await sleep(300);
  }
  await g1.page.click('#sayNames .nk-word--room[data-room="kitchen"]');
  for (const c of [host, g2]) check('ひろばにいても「台所でねむっている人がいた！」と送れる ' + c.label, await L.waitFor(async () => (await L.text(c, '#sayTicker')).includes('台所でねむっている人がいた！')));
  check('選んだ部屋が書かれる（r: kitchen・送った位置はひろば）', await L.waitFor(async () => { const v = (await L.roomOf(code)).game.say['あお']; return v && v.k === 'body' && v.r === 'kitchen' && Math.abs(v.x - (hp.x + 1)) < 0.3; }));
  // 遠くの人には届かない（ささやき）: そらを台所へ
  await L.teleport(g3, 4.5, 5.5);
  await sleep(300);
  await g2.page.click('#actSay');
  await g2.page.click('#sayChips .nk-word[data-say="hey"]');
  for (const c of [host, g1]) check('近くの人には届く「みどり: おーい！」 ' + c.label, await L.waitFor(async () => (await L.text(c, '#sayTicker')).includes('みどりおーい！')));
  await sleep(1200);
  check('遠くの人（台所）には届かない', !(await L.text(g3, '#sayTicker')).includes('おーい'));
  await L.teleport(g3, hp.x, hp.y + 1);
  await sleep(300);
  await host.page.click('#actSay');
  await host.page.click('#sayChips .nk-word[data-say="plaza"]');
  check('5秒に1回まで（続けて送れない）', await L.waitToast(host, '5秒に1回まで') && (await L.roomOf(code)).game.say['ホスト'].n === 1);
  await host.page.click('#btnSayClose');
  // 名前の入る言葉（遊んでいる間）: 「だれ？」で人を選んでから送る
  await g3.page.click('#actSay');
  await L.waitVisible(g3, '#sayBox');
  check('はじめは「だれ？」が出ていない', !(await L.visible(g3, '#sayNames')));
  await g3.page.click('#sayChips .nk-word[data-say="sawnow"]');
  check('名前の入る言葉を押すと「だれ？」（自分以外の3人＋やめる）', await L.waitFor(async () => (await L.visible(g3, '#sayNames')) && (await g3.page.$$('#sayNames .nk-word--name')).length === 3 && !(await g3.page.$('#sayNames .nk-word--name:text-is("そら")'))));
  check('押した言葉に印', await g3.page.$eval('#sayChips .nk-word[data-say="sawnow"]', (b) => b.classList.contains('is-picked')));
  await g3.page.click('#sayNames .nk-word--quiet');
  check('「やめる」で「だれ？」がとじる', await L.waitFor(async () => !(await L.visible(g3, '#sayNames'))));
  await g3.page.click('#sayChips .nk-word[data-say="sawnow"]');
  await g3.page.click('#sayNames .nk-word--name:text-is("みどり")');
  for (const c of [host, g2]) check('みんなの画面の上に「そら: みどりさんが仕事をしていた」 ' + c.label, await L.waitFor(async () => (await L.text(c, '#sayTicker')).includes('そらみどりさんが仕事をしていた')));
  check('名前の入る言葉は相手つきで書かれる', (await L.roomOf(code)).game.say['そら'].k === 'sawnow' && (await L.roomOf(code)).game.say['そら'].t === 'みどり');
  check('送ると一覧と「だれ？」がとじる', await L.waitFor(async () => !(await L.visible(g3, '#sayBox'))));
  await g2.page.keyboard.press('KeyT');
  check('キー T で一覧がひらく', await L.waitFor(() => L.visible(g2, '#sayBox')));
  await g2.page.keyboard.press('KeyT');
  check('もう一度 T でとじる', await L.waitFor(async () => !(await L.visible(g2, '#sayBox'))));
  await sleep(E.SAY_SHOW_MS + 800);
  check('6秒たつと画面の上から消える', (await L.text(g3, '#sayTicker')) === '');
  await L.shot(host, '02b-say');

  // ══ 歩く・位置の送り方 ══
  await sleep(800);
  const before = await L.me(host);
  host.posSends = [];
  await host.page.keyboard.down('ArrowUp');
  await sleep(2000);
  await host.page.keyboard.up('ArrowUp');
  const after = await L.me(host);
  check('キーで歩ける', after.y < before.y - 1, { before, after });
  const moveSends = host.posSends.filter((s) => s.ch === 'p').length;
  check('歩いている2秒の送信は7回以下（1秒に3回まで）', moveSends >= 3 && moveSends <= 7, moveSends);
  await sleep(400);
  host.posSends = [];
  await sleep(2000);
  check('止まっている間は送らない', host.posSends.length === 0, host.posSends.length);
  const pHost = await L.rest('GET', L.ROOMS + '/' + code + '/p/' + encodeURIComponent('ホスト'));
  const dec = E.decodePos(pHost);
  check('位置は短い文字列で、止まった場所', !!dec && Math.abs(dec.y - after.y) < 0.15, { pHost, after });
  check('ほかの人の画面に、ホストの位置が届く', await L.waitFor(async () => {
    const pa = await g2.page.evaluate(() => window.__NK__.PA['ホスト']);
    return pa && Math.abs(pa.ty - after.y) < 0.15;
  }));
  // かべは通れない
  await L.teleport(host, 3.5, 3.5);
  await host.page.keyboard.down('ArrowLeft');
  await sleep(600);
  await host.page.keyboard.up('ArrowLeft');
  check('かべを通りぬけない', (await L.me(host)).x >= 2 + E.RADIUS - 0.01, await L.me(host));

  // ══ 行き止まりの小部屋（道具室）══
  // ポンプ室↔見はり台の通路から下へ歩くと、入口を通って奥まで入れる。奥はかべで止まり、右へも出られない（2026-10-29 夕 84×56 のマップ）
  await L.teleport(host, 29.9, 49.0);
  await host.page.keyboard.down('ArrowDown');
  await sleep(2000);
  await host.page.keyboard.up('ArrowDown');
  const deep = await L.me(host);
  check('行き止まりの小部屋の奥まで入れる', deep.y > 54 && deep.y <= 55 - E.RADIUS + 0.01 && E.roomAt(deep.x, deep.y) === 'tools', deep);
  await host.page.keyboard.down('ArrowRight');
  await sleep(1200);
  await host.page.keyboard.up('ArrowRight');
  const corner = await L.me(host);
  check('行き止まりの奥はかべ（右へは出られない）', corner.x <= 33 - E.RADIUS + 0.01 && E.roomAt(corner.x, corner.y) === 'tools', corner);
  check('道具室の仕事の場所に「!」のやることとして出せる', E.SPOTS[11].room === 'tools' && E.SPOTS[12].room === 'green');

  // ══ かべの向こうの人は描かれない ══
  // ホスト（隊員）は道具室、みどりは道具室の上の通路（かべ1枚へだてて3マス。見える広さの中）
  const hexOf = async (id) => { const gg = await L.gameIn(host); return E.COLORS.find((c) => c.key === gg.colors[id]).hex; };
  const midoriHex = await hexOf('みどり');
  await L.teleport(host, 28.5, 52.5);
  await L.teleport(g2, 28.5, 49.5);
  const paSettled = (x, y) => L.waitFor(async () => {
    const pa = await host.page.evaluate(() => window.__NK__.PA['みどり']);
    return pa && Math.hypot(pa.tx - x, pa.ty - y) < 0.05 && Math.hypot(pa.x - pa.tx, pa.y - pa.ty) < 0.01;
  });
  check('かべの向こうの人の位置は届いている', await paSettled(28.5, 49.5));
  await sleep(300);
  let px = await L.pixelAt(host, 28.5, 49.5);
  check('かべの向こうの人は描かれない（その場所は暗がり）', !L.nearColor(px, midoriHex) && px.every((v) => v < 70), { px, midoriHex });
  check('かべの向こうの床は暗がり', (await L.pixelAt(host, 27.5, 49.5)).every((v) => v < 70), await L.pixelAt(host, 27.5, 49.5));
  check('同じ部屋の床は明るい', (await L.pixelAt(host, 30.5, 52.5)).some((v) => v > 150), await L.pixelAt(host, 30.5, 52.5));
  await L.shot(host, '02b-wall-hidden');
  await L.teleport(g2, 29.5, 50.5);
  check('入口に出てきた人の位置が届く', await paSettled(29.5, 50.5));
  await sleep(300);
  px = await L.pixelAt(host, 29.5, 50.5);
  check('かべのない所の人は描かれる（同じ距離）', L.nearColor(px, midoriHex), { px, midoriHex });
  await L.shot(host, '02c-wall-visible');
  const s2 = await L.subs(g2);
  check('おきている人は、ねむった人の位置（g）を受け取らない', s2.p === true && s2.g === false, s2);

  // ══ 仕事 ══
  await L.doFirstTask(g2, 'みどり');
  check('仕事がルームに届く', await L.waitFor(async () => L.doneCount(await L.gameIn(host)) === 1));
  check('みんなの仕事のバーが進む', await L.waitFor(async () => (await L.text(g3, '#hudProgressNum')).startsWith('1 /')));

  // ══ 近道（ねむらせ屋だけ）: 入ると見えなくなり、出る部屋を選ぶ（2026-10-29） ══
  const v0 = E.VENTS[0];
  const v1 = E.VENTS[3];
  await L.teleport(g1, v0.x, v0.y + 0.4);
  check('ねむらせ屋は近道の上で「近道に入る」', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')) === '近道に入る'));
  await g1.page.click('#actUse');
  check('近道の中の一覧（ほかの9か所＋ここから出る）', await L.waitFor(async () => (await L.visible(g1, '#ventBox')) && (await g1.page.$$('#ventRooms .nk-word')).length === 10));
  check('一覧は部屋の名前（入った台所はない）', (await L.text(g1, '#ventRooms')).includes('倉庫') && !(await L.text(g1, '#ventRooms .nk-word[data-vent="1"]')).includes('台所') && (await L.text(g1, '#ventLeft')).startsWith('あと'));
  check('近道の中は位置の印が 2', await L.waitFor(async () => String((await L.rootOf(code)).p?.['あお'] || '').endsWith(',2')));
  check('ほかの人の画面では見えない', await L.waitFor(() => g2.page.evaluate(() => !!(window.__NK__.PA['あお'] || {}).hidden)));
  await L.shot(g1, '03a-vent');
  await g1.page.keyboard.down('ArrowRight');
  await L.sleep(400);
  await g1.page.keyboard.up('ArrowRight');
  check('近道の中では歩けない', Math.abs((await L.me(g1)).x - v0.x) < 0.01);
  await g1.page.click('#ventRooms .nk-word[data-vent="3"]');
  const afterVent = await L.me(g1);
  check('選んだ部屋の近道から出る', Math.hypot(afterVent.x - v1.x, afterVent.y - v1.y) < 0.01 && !(await L.visible(g1, '#ventBox')), afterVent);
  check('出た位置がほかの人に届き、また見える', await L.waitFor(async () => {
    const pa = await g2.page.evaluate(() => window.__NK__.PA['あお']);
    return pa && Math.hypot(pa.tx - v1.x, pa.ty - v1.y) < 0.2 && !pa.hidden;
  }));
  // 中にいられる時間がくると、入った近道から出る
  check('出たあと、また入れる', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')) === '近道に入る'));
  await g1.page.click('#actUse');
  await L.waitVisible(g1, '#ventBox');
  await g1.page.evaluate(() => { window.__NK__.ME.vent.until = Date.now() + 200; });
  check('時間がくると、入った所から出る', await L.waitFor(async () => !(await L.visible(g1, '#ventBox')) && Math.hypot((await L.me(g1)).x - v1.x, (await L.me(g1)).y - v1.y) < 0.01));
  check('時間で出ても、また見える', await L.waitFor(async () => /,[01]$/.test(String((await L.rootOf(code)).p?.['あお'] || ''))));
  await L.teleport(g3, v0.x, v0.y + 0.4);
  await L.sleep(400);
  check('隊員は近道を使えない', !(await L.text(g3, '#actUseLabel')).includes('近道'));

  // ══ はしご（だれでも） ══
  const l1 = E.LADDERS[1];
  const l0 = E.LADDERS[l1.to];
  await L.teleport(g3, l1.x, l1.y - 0.4);
  check('隊員もはしごの上で「はしごをのぼる」', await L.waitFor(async () => (await L.text(g3, '#actUseLabel')) === 'はしごをのぼる' && !(await g3.page.$eval('#actUse', (b) => b.disabled))));
  await g3.page.click('#actUse');
  check('使っている間は「のぼっている…」で押せない', await L.waitFor(async () => (await L.text(g3, '#actUseLabel')) === 'のぼっている…' && (await g3.page.$eval('#actUse', (b) => b.disabled))));
  const during = await L.me(g3);
  check('使っている間はまだ その場にいる', Math.hypot(during.x - l1.x, during.y - (l1.y - 0.4)) < 0.01, during);
  await g3.page.keyboard.down('ArrowRight');
  await sleep(400);
  await g3.page.keyboard.up('ArrowRight');
  check('使っている間は歩けない', Math.abs((await L.me(g3)).x - l1.x) < 0.01);
  check('2.5秒たつと、つながったはしごへ移る', await L.waitFor(async () => { const m = await L.me(g3); return Math.hypot(m.x - l0.x, m.y - l0.y) < 0.01; }, E.CLIMB_MS + 2000));
  check('移った位置がほかの人に届く', await L.waitFor(async () => { const pa = await g2.page.evaluate(() => window.__NK__.PA['そら']); return pa && Math.hypot(pa.tx - l0.x, pa.ty - l0.y) < 0.2; }));
  check('移ったあとは「はしごをおりる」', await L.waitFor(async () => (await L.text(g3, '#actUseLabel')) === 'はしごをおりる'));
  await L.teleport(g1, l0.x, l0.y + 0.4);
  check('ねむらせ屋もはしごを使える', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')) === 'はしごをおりる'));

  // ══ 停電となおす ══
  await g1.page.click('#actSab');
  await g1.page.click('#sabDark');
  check('停電がみんなに出る', await L.waitFor(() => L.visible(host, '#hudDark')));
  await L.teleport(g3, E.FIX_SPOT.x, E.FIX_SPOT.y + 0.6);
  check('スイッチの前で「電気をなおす」', await L.waitFor(async () => (await L.text(g3, '#actUseLabel')) === '電気をなおす'));
  await L.shot(g3, '03-dark');
  await g3.page.click('#actUse');
  check('なおすのはミニゲーム（1〜8を順に）', await L.waitFor(() => L.visible(g3, '#ovTask')) && (await L.text(g3, '#taskTitle')) === '電気室：スイッチを順に入れなおす' && !!(await g3.page.$('#taskBox .nk-order')));
  await sleep(300);
  check('ミニゲームの途中は まだ停電中', await L.visible(host, '#hudDark'));
  await L.shot(g3, '03b-fix');
  check('ミニゲームは order', (await L.solveTask(g3)) === 'order');
  check('おわると電気がなおる', await L.waitFor(async () => !(await L.visible(host, '#hudDark'))));
  check('ミニゲームがとじる', await L.waitFor(async () => !(await L.visible(g3, '#ovTask'))));

  // ══ 監視カメラ ══
  const camPixel = (c, i, below) => c.page.evaluate(([idx, dy]) => {
    const cv = document.getElementById('camView');
    const En = window.NemuraseEngine;
    const w = cv.clientWidth; const dpr = cv.width / w; const cols = w >= 420 ? 3 : 2; const cell = w / cols; const s = (cell - 8) / (En.CAM_R * 2 + 1);
    const cx = (idx % cols) * cell + 4 + (cell - 8) / 2; const cy = Math.floor(idx / cols) * cell + 4 + (cell - 8) / 2 + (dy ? En.RADIUS * s * 1.25 * 0.4 : 0);
    const d = cv.getContext('2d').getImageData(Math.round(cx * dpr), Math.round(cy * dpr), 1, 1).data; return [d[0], d[1], d[2]];
  }, [i, below]);
  await L.teleport(host, E.CAM_STAND.x, E.CAM_STAND.y + 0.5);
  check('カメラの台で「カメラを見る」', await L.waitFor(async () => (await L.text(host, '#actUseLabel')) === 'カメラを見る'));
  await host.page.click('#actUse');
  check('カメラの画面がひらく', await L.waitFor(() => L.visible(host, '#ovCam')));
  check('見ていることが game/cam に書かれる', await L.waitFor(async () => (await L.roomOf(code)).game.cam?.['ホスト'] === true));
  await host.page.keyboard.down('ArrowLeft');
  await sleep(400);
  await host.page.keyboard.up('ArrowLeft');
  check('見ている間は歩けない', Math.abs((await L.me(host)).x - E.CAM_STAND.x) < 0.01);
  check('だれもいない通路は床の色', L.nearColor(await camPixel(host, 0, true), E.HALL_FILL), await camPixel(host, 0, true));
  await L.teleport(g2, E.CAMS[0].x, E.CAMS[0].y);
  check('カメラの下に来た人が映る（体の色）', await L.waitFor(async () => L.nearColor(await camPixel(host, 0, true), '#2E9A4A')), await camPixel(host, 0, true));
  await L.teleport(g2, 10.5, 5);
  check('部屋の中に入ると映らない', await L.waitFor(async () => L.nearColor(await camPixel(host, 0, true), E.HALL_FILL)));
  await L.shot(host, '03c-cam');
  await host.page.keyboard.press('Escape');
  check('Escape でとじる', await L.waitFor(async () => !(await L.visible(host, '#ovCam'))));
  check('とじると game/cam から消える', await L.waitFor(async () => !(await L.roomOf(code)).game.cam?.['ホスト']));
  await host.page.click('#actUse');
  await L.waitVisible(host, '#ovCam');
  await host.page.click('#btnCamClose');
  check('とじるボタンでもとじる', await L.waitFor(async () => !(await L.visible(host, '#ovCam'))));
  await L.teleport(g1, E.CAM_STAND.x, E.CAM_STAND.y + 0.5);
  check('ねむらせ屋もカメラを見られる', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')) === 'カメラを見る'));

  // ══ ねむらせる ══（道具室の下のはしで。あとで、かべごしに「見つけた！」が出ないことを確かめるため）
  await L.teleport(host, 31.5, 51.4);
  await L.teleport(g1, 30.8, 51.4);
  check('近くに隊員がいると、ねむらせるが押せる', await L.waitFor(async () => !(await g1.page.$eval('#actSleep', (b) => b.disabled))));
  await g1.page.click('#actSleep');
  check('ホストがねむる', await L.waitFor(async () => (await L.roomOf(code)).game.asleep?.['ホスト'] === 'slept'));
  check('ねむった人にお知らせ', await L.waitFor(() => L.visible(host, '#stageBanner')));
  check('ねむった人の役の表示', (await L.text(host, '#hudRole')).includes('ねむっている'));
  check('ねむった人の位置は p から消えて g に移る', await L.waitFor(async () => {
    const root = await L.rootOf(code);
    return !root.p?.['ホスト'] && !!root.g?.['ホスト'];
  }));
  check('ねむった人は g を受け取る', await L.waitFor(async () => (await L.subs(host)).g === true));
  check('おきている人の画面から、ねむった人の位置が消える', await L.waitFor(async () => !(await L.subs(g2)).pa.includes('ホスト')));
  check('ねむらせたあとは待ち時間', await L.waitFor(async () => (await L.text(g1, '#actSleepCd')) !== ''));
  await L.doFirstTask(host, 'ねむったホスト');
  check('ねむった人の仕事も数える', await L.waitFor(async () => L.doneCount(await L.gameIn(host)) === 2));
  check('ねむった人には「見つけた！」が出ない', !(await L.visible(host, '#actFind')));
  await L.shot(host, '04-asleep');

  // ══ 見つけた → 会議 → 投票 → 結果 → おしまい ══
  // かべ1枚へだてた上の通路から（2マス。見つけられる距離の中）では「見つけた！」が出ない
  await L.teleport(g2, 31.5, 49.6);
  await sleep(500);
  check('かべの向こうのねむっている人には「見つけた！」が出ない', !(await L.visible(g2, '#actFind')));
  await L.teleport(g2, 31.5, 52.6);
  check('ねむっている人の近くで「見つけた！」', await L.waitFor(() => L.visible(g2, '#actFind')));
  await g2.page.click('#actFind');
  for (const c of all) check('会議がひらく ' + c.label, await L.waitFor(() => L.visible(c, '#ovMeeting')));
  check('会議の理由に名前', (await L.text(g3, '#meetingWhy')).includes('みどり') && (await L.text(g3, '#meetingWhy')).includes('ホスト'));
  check('ねむった人は投票しない', !(await L.visible(host, '#btnVoteSkip')));
  check('ホストには「投票をしめきる」', await L.visible(host, '#btnCloseVote'));
  // 会議の間は位置を送らない
  g2.posSends = [];
  await g2.page.keyboard.down('ArrowRight');
  await sleep(1200);
  await g2.page.keyboard.up('ArrowRight');
  check('会議の間は位置を送らない', g2.posSends.length === 0, g2.posSends.length);
  await L.shot(g2, '05-meeting');

  // ══ ひとこと（会議中） ══
  check('ねむった人に言葉のボタンは出ない', !(await L.visible(host, '#meetingChips')));
  check('おきている人に言葉のボタン（会議の13＋どちらでも4）', (await g2.page.$$('#meetingChips .nk-word')).length === 17);
  check('会議のはじめは流れが空', !(await L.visible(g2, '#meetingSays')));
  await g2.page.click('#meetingChips .nk-word[data-say="crew"]');
  for (const c of all) check('会議の流れに「みどり: 自分は隊員だよ」 ' + c.label, await L.waitFor(async () => (await L.text(c, '#meetingSays')) === 'みどり自分は隊員だよ'));
  check('名前の下に最新の1件', await L.waitFor(async () => (await host.page.$eval('.nk-vote__row:has-text("みどり") .nk-vote__say', (n) => n.textContent)) === '「自分は隊員だよ」'));
  await g2.page.click('#meetingChips .nk-word[data-say="ok"]');
  check('会議中も5秒に1回まで', await L.waitToast(g2, '5秒に1回まで'));
  await g3.page.click('#meetingChips .nk-word[data-say="with"]');
  check('名前の入る言葉は「だれ？」で人を選ぶ（自分は出ない）', await L.waitFor(async () => (await L.visible(g3, '#meetingNames')) && (await g3.page.$$('#meetingNames .nk-word--name')).length === 3 && !(await L.text(g3, '#meetingNames')).includes('そら')));
  await g3.page.click('#meetingNames .nk-word--name:has-text("あお")');
  for (const c of all) check('流れに「そら: あおさんといっしょにいた」 ' + c.label, await L.waitFor(async () => (await L.text(c, '#meetingSays')).endsWith('そらあおさんといっしょにいた')));
  check('人を選ぶ欄がとじる', await L.waitFor(async () => !(await L.visible(g3, '#meetingNames'))));
  // 名前と部屋の両方が入る言葉（2026-10-29）: 「だれ？」→「どこ？」の順
  await g1.page.click('#meetingChips .nk-word[data-say="sawat"]');
  check('「〔名前〕さんが〔部屋〕にいた」はまず「だれ？」', await L.waitFor(async () => (await L.visible(g1, '#meetingNames')) && (await g1.page.$$('#meetingNames .nk-word--name')).length === 3));
  await g1.page.click('#meetingNames .nk-word--name:has-text("みどり")');
  check('人を選ぶと「どこ？」（いまいる部屋が上）', await L.waitFor(async () => (await L.text(g1, '#meetingNames .nk-words__lead')) === 'どこ？' && (await g1.page.$$('#meetingNames .nk-word--room')).length === 19 && (await g1.page.$eval('#meetingNames .nk-word--room', (b) => b.textContent)).endsWith('（いまいる）')));
  await L.shot(g1, '05c-meeting-where');
  await g1.page.click('#meetingNames .nk-word--room[data-room="store"]');
  for (const c of all) check('流れに「あお: みどりさんが倉庫にいた」 ' + c.label, await L.waitFor(async () => (await L.text(c, '#meetingSays')).endsWith('あおみどりさんが倉庫にいた')));
  check('選ぶ欄がとじる', await L.waitFor(async () => !(await L.visible(g1, '#meetingNames'))));
  room = await L.roomOf(code);
  check('名前と部屋の両方が書かれる', room.game.say['あお'].k === 'sawat' && room.game.say['あお'].t === 'みどり' && room.game.say['あお'].r === 'store' && room.game.say['あお'].m === 1);
  check('会議のひとことは会議の番号つき・相手つき', room.game.say['そら'].m === 1 && room.game.say['そら'].t === 'あお' && room.game.say['みどり'].m === 1);
  await L.shot(g3, '05b-meeting-say');
  const pick = async (c, name) => {
    await c.page.click('.nk-vote__main:has-text("' + name + '")');
    await c.page.click('.nk-vote__go');
  };
  await pick(g2, 'あお');
  check('投票の数がみんなに出る', await L.waitFor(async () => (await L.text(g3, '#meetingCount')) === '投票 1 / 3'));
  await pick(g3, 'あお');
  await g1.page.click('#btnVoteSkip');
  for (const c of all) check('会議の結果 ' + c.label, await L.waitFor(() => L.visible(c, '#ovResult')));
  check('結果: あおがねむる・ねむらせ屋だった', (await L.text(g2, '#resultMain')).includes('あお') && (await L.text(g2, '#resultSub')).includes('ねむらせ屋だった'));
  check('票の中身は数だけ', (await L.text(g2, '#resultVotes')).includes('あお 2票') && (await L.text(g2, '#resultVotes')).includes('スキップ 1票'));
  await L.shot(g2, '06-result');
  for (const c of all) check('おしまい ' + c.label, await L.waitFor(() => L.visible(c, '#ovEnd'), 10000));
  check('隊員の勝ち・理由', (await L.text(g3, '#endTitle')) === '隊員の勝ち！' && (await L.text(g3, '#endWhy')) === 'ねむらせ屋を全員見つけた');
  check('待合室にもどるのはホストだけ', await L.visible(host, '#btnAgain') && !(await L.visible(g1, '#btnAgain')));
  const fin = await Promise.all(all.map((c) => L.stats(c, 'finish')));
  check('finish はだれか1台で1回', fin.reduce((a, b) => a + b, 0) === 1, fin);
  await L.shot(g1, '07-end');

  // ══ 待合室へ → もう一回 ══
  await host.page.click('#btnAgain');
  for (const c of all) await L.waitScreen(c, 'waiting');
  check('待合室にもどる', true);
  check('again を1回', await L.waitStats(host, 'again', 1));
  check('位置は消えている', await L.waitFor(async () => { const r = await L.rootOf(code); return !r.p && !r.g; }));
  // 「ホストが選ぶ」のままなので、次の回は選び直すまではじめられない → ランダムにもどすと、はじめられる
  check('次の回は選び直すまではじめられない', await L.waitFor(async () => (await host.page.$eval('#btnStart', (b) => b.disabled)) && (await L.text(host, '#lobbyNote')) === 'ねむらせ屋にする人を、あと 1 人えらんでください'));
  await host.page.selectOption('#set-pick', '0');
  check('ランダムにもどすと選ぶボタンが消え、はじめられる', await L.waitFor(async () => !(await host.page.$eval('#btnStart', (b) => b.disabled)) && (await host.page.$$('#lobbyPeople .nk-person__pick')).length === 0 && (await L.text(g1, '#set-pick')) === 'ランダム'));
  await host.page.click('#btnStart');
  for (const c of all) { await L.waitScreen(c, 'game'); await L.dismissRole(c); }
  await L.patchGame(code, { roles: { 'ホスト': 'crew', 'あお': 'crew', 'みどり': 'crew', 'そら': 'sleeper' }, cooldown: { 'そら': 1 } });
  check('2回目の役', await L.waitFor(async () => (await L.text(g3, '#hudRole')) === 'ねむらせ屋'));
  // 会議ボタン（はじめは待ち時間で押せない）
  const t0 = E.spawnPoint(1, 4);
  await L.teleport(g1, t0.x, t0.y);
  check('はじめの20秒は会議ボタンが押せない（あとN秒で押せる）', await L.waitFor(async () => /^会議ボタン（あと\d+秒で押せる）$/.test(await L.text(g1, '#actUseLabel')) && (await g1.page.$eval('#actUse', (b) => b.disabled))), await L.text(g1, '#actUseLabel'));
  await L.patchGame(code, { buttonReadyAt: 1 });
  check('テーブルの近くで会議ボタン', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')).startsWith('会議ボタン（あと1回）')));
  await g1.page.click('#actUse');
  check('会議ボタンで会議', await L.waitFor(() => L.visible(host, '#ovMeeting')));
  check('会議ボタンの理由', (await L.text(host, '#meetingWhy')).includes('会議ボタン'));
  check('次の会議では前の流れが出ない', !(await L.visible(g1, '#meetingSays')) && !(await g1.page.$('.nk-vote__say')));
  await pick(g1, 'みどり');
  await pick(g2, 'あお');
  await g3.page.click('#btnVoteSkip');
  await host.page.click('#btnVoteSkip');
  check('同じ数の票でも結果', await L.waitFor(() => L.visible(g1, '#ovResult')));
  check('同じ数ならだれもねむらない', (await L.text(g1, '#resultMain')) === 'だれもねむらなかった');
  check('結果のあとゲームにもどる', await L.waitFor(async () => !(await L.visible(g1, '#ovResult')), 9000));
  check('会議のあとも会議ボタンに待ち時間', (await L.roomOf(code)).game.buttonReadyAt > Date.now() + 10000);
  await L.patchGame(code, { buttonReadyAt: 1 });
  check('会議ボタンは1回まで', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')).startsWith('会議ボタン（あと0回）')));
  // ねむらせ屋の勝ち
  await L.patchGame(code, { cooldown: { 'そら': 1 } });
  await L.teleport(g3, 24.5, 20.5);   // 洗たく室
  await L.teleport(g1, 25.2, 20.5);
  await L.waitFor(async () => !(await g3.page.$eval('#actSleep', (b) => b.disabled)));
  await g3.page.click('#actSleep');
  await L.waitFor(async () => (await L.roomOf(code)).game.asleep?.['あお']);
  await L.patchGame(code, { cooldown: { 'そら': 1 } });
  await L.teleport(g2, 25.2, 21.3);
  await L.waitFor(async () => !(await g3.page.$eval('#actSleep', (b) => b.disabled)));
  await g3.page.click('#actSleep');
  check('ねむらせ屋が勝つとおしまい', await L.waitFor(() => L.visible(host, '#ovEnd')));
  check('ねむらせ屋の勝ち', (await L.text(host, '#endTitle')) === 'ねむらせ屋の勝ち！');

  // ══ 時間切れ（遊んでいる途中） ══
  await host.page.click('#btnAgain');
  await L.waitScreen(host, 'waiting');
  await host.page.click('#btnStart');
  for (const c of all) { await L.waitScreen(c, 'game'); await L.dismissRole(c); }
  await L.patchGame(code, { endsAt: Date.now() - 1000 });
  check('15分たつと、すぐおしまい', await L.waitFor(() => L.visible(g2, '#ovEnd'), 6000));
  check('時間切れは引き分け', (await L.text(g2, '#endTitle')) === '時間切れ！ 引き分け' && (await L.text(g2, '#endWhy')) === '15分たった');

  // ══ 375px ══
  const phone = await L.newClient('phone', { viewport: { width: 375, height: 740 } });
  await L.open(phone);
  check('375px: トップに横スクロールがない', (await L.overflow(phone)) <= 0);
  await host.page.click('#btnAgain');
  await L.waitScreen(host, 'waiting');
  await L.joinRoom(phone, 'スマホ', code);
  check('375px: 待合室に横スクロールがない', (await L.overflow(phone)) <= 0);
  await L.shot(phone, '08-phone-lobby', { fullPage: true });
  await host.page.click('#btnStart');
  await L.waitScreen(phone, 'game');
  await L.dismissRole(phone);
  await L.dismissRole(host);
  check('375px: スティックが出る', await L.visible(phone, '#pad'));
  check('375px: キーの案内は出さない', !(await L.visible(phone, '#keyHint')));
  check('375px: やることはたたんである', !(await L.visible(phone, '#tasksItems')));
  const pb = await phone.page.$eval('#pad', (e) => { const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const s0 = await L.me(phone);
  await phone.page.mouse.move(pb.x, pb.y);
  await phone.page.mouse.down();
  await phone.page.mouse.move(pb.x + 50, pb.y, { steps: 3 });
  await sleep(600);
  await phone.page.mouse.up();
  check('375px: スティックで歩ける', (await L.me(phone)).x > s0.x + 0.5);
  check('375px: ゲームに横スクロールがない', (await L.overflow(phone)) <= 0);
  await L.shot(phone, '09-phone-game');

  // ══ ルームを閉じる ══
  await host.page.click('#btnMenu');
  await host.page.click('#btnMenuLeave');
  for (const c of [g1, g2, g3, phone]) check('ルームが閉じると参加者はトップ ' + c.label, await L.waitFor(async () => (await L.screen(c)) === 'top'));
  check('ルームのデータが消える', await L.waitFor(async () => (await L.rootOf(code)) === null));

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
