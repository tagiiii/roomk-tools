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
  check('選ぶとはじめられる・注意書きが消える', await L.waitFor(async () => !(await host.page.$eval('#btnStart', (b) => b.disabled)) && (await L.text(host, '#lobbyNote')) === ''));
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
  check('ねむらせ屋は1人・ひとり4つの仕事', Object.values(room.game.roles).filter((r) => r === 'sleeper').length === 1 && Object.values(room.game.tasks).every((t) => t.length === 4));
  check('選んだ「そら」がねむらせ屋', room.game.roles['そら'] === 'sleeper');
  check('はじめると選んだ人は空にもどる', await host.page.evaluate(() => window.__NK__.state.picks.length === 0));
  check('のこり時間が15分', /^のこり 1[45]:\d\d$/.test(await L.text(host, '#hudTime')), await L.text(host, '#hudTime'));
  for (const c of all) await L.dismissRole(c);
  // テスト用に役を決める: あお＝ねむらせ屋
  const roles = { 'ホスト': 'crew', 'あお': 'sleeper', 'みどり': 'crew', 'そら': 'crew' };
  await L.patchGame(code, { roles, cooldown: { 'あお': 1 }, darkReadyAt: 1 });
  check('役の表示が変わる', await L.waitFor(async () => (await L.text(g1, '#hudRole')) === 'ねむらせ屋' && (await L.text(host, '#hudRole')) === '隊員'));
  check('ねむらせ屋にだけ、ねむらせる・停電', await L.waitFor(() => L.visible(g1, '#actSleep')) && !(await L.visible(g2, '#actSleep')));
  check('ねむらせ屋の一覧は「ふりをする場所」', (await L.text(g1, '#tasksTitle')).startsWith('ふりをする場所'));
  await L.shot(g1, '02-sleeper');

  // ══ ひとこと（遊んでいる間） ══
  check('おきている人に「ひとこと」ボタン', await L.visible(host, '#actSay') && await L.visible(g1, '#actSay'));
  await host.page.click('#actSay');
  check('一覧がひらく（遊んでいる間の14＋どちらでも4）', await L.waitFor(async () => (await L.visible(host, '#sayBox')) && (await host.page.$$('#sayChips .nk-word')).length === 18));
  check('「そうだよ」がある', (await host.page.$eval('#sayChips .nk-word[data-say="yes"]', (b) => b.textContent)) === 'そうだよ');
  check('名前の入る言葉は〔名前〕で出る', (await host.page.$eval('#sayChips .nk-word[data-say="sawnow"]', (b) => b.textContent)) === '〔名前〕さんが仕事をしていた');
  check('部屋の名前が入っている（はじめはひろば）', (await host.page.$eval('#sayChips .nk-word[data-say="here"]', (b) => b.textContent)) === 'ひろばにいるよ');
  await host.page.click('#sayChips .nk-word[data-say="here"]');
  for (const c of all) check('みんなの画面の上に「ホスト: ひろばにいるよ」 ' + c.label, await L.waitFor(async () => (await L.text(c, '#sayTicker')) === 'ホストひろばにいるよ'));
  check('送ると一覧がとじる', await L.waitFor(async () => !(await L.visible(host, '#sayBox'))));
  room = await L.roomOf(code);
  check('game/say にひとり1枠（キー・部屋・番号1・会議0）', room.game.say && room.game.say['ホスト'] && room.game.say['ホスト'].k === 'here' && room.game.say['ホスト'].r === 'plaza' && room.game.say['ホスト'].n === 1 && room.game.say['ホスト'].m === 0, room.game.say);
  await host.page.click('#actSay');
  await host.page.click('#sayChips .nk-word[data-say="plaza"]');
  check('5秒に1回まで（続けて送れない）', await L.waitToast(host, '5秒に1回まで') && (await L.roomOf(code)).game.say['ホスト'].n === 1);
  await host.page.click('#btnSayClose');
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
  // 台所↔電気室の通路から右へ歩くと、通路を通って奥まで入れる。奥はかべで止まり、下へも出られない
  await L.teleport(host, 6.8, 10.9);
  await host.page.keyboard.down('ArrowRight');
  await sleep(2600);
  await host.page.keyboard.up('ArrowRight');
  const deep = await L.me(host);
  check('行き止まりの小部屋の奥まで入れる', deep.x > 14 && deep.x <= 15 - E.RADIUS + 0.01 && E.roomAt(deep.x, deep.y) === 'tools', deep);
  await host.page.keyboard.down('ArrowDown');
  await sleep(1200);
  await host.page.keyboard.up('ArrowDown');
  const corner = await L.me(host);
  check('行き止まりの奥はかべ（下へは出られない）', corner.y <= 13 - E.RADIUS + 0.01 && E.roomAt(corner.x, corner.y) === 'tools', corner);
  check('道具室の仕事の場所に「!」のやることとして出せる', E.SPOTS[11].room === 'tools' && E.SPOTS[12].room === 'green');

  // ══ かべの向こうの人は描かれない ══
  // ホスト（隊員）は道具室の通路、みどりは電気室（かべ1枚へだてて2.1マス。見える広さの中）
  const hexOf = async (id) => { const gg = await L.gameIn(host); return E.COLORS.find((c) => c.key === gg.colors[id]).hex; };
  const midoriHex = await hexOf('みどり');
  await L.teleport(host, 9.5, 11.4);
  await L.teleport(g2, 9.5, 13.5);
  const paSettled = (x, y) => L.waitFor(async () => {
    const pa = await host.page.evaluate(() => window.__NK__.PA['みどり']);
    return pa && Math.hypot(pa.tx - x, pa.ty - y) < 0.05 && Math.hypot(pa.x - pa.tx, pa.y - pa.ty) < 0.01;
  });
  check('かべの向こうの人の位置は届いている', await paSettled(9.5, 13.5));
  await sleep(300);
  let px = await L.pixelAt(host, 9.5, 13.5);
  check('かべの向こうの人は描かれない（その場所は暗がり）', !L.nearColor(px, midoriHex) && px.every((v) => v < 70), { px, midoriHex });
  check('かべの向こうの床は暗がり', (await L.pixelAt(host, 8.5, 14.5)).every((v) => v < 70), await L.pixelAt(host, 8.5, 14.5));
  check('同じ通路の床は明るい', (await L.pixelAt(host, 8.5, 10.5)).some((v) => v > 150), await L.pixelAt(host, 8.5, 10.5));
  await L.shot(host, '02b-wall-hidden');
  await L.teleport(g2, 7.5, 10.5);
  check('通路に出てきた人の位置が届く', await paSettled(7.5, 10.5));
  await sleep(300);
  px = await L.pixelAt(host, 7.5, 10.5);
  check('かべのない所の人は描かれる（同じ距離）', L.nearColor(px, midoriHex), { px, midoriHex });
  await L.shot(host, '02c-wall-visible');
  const s2 = await L.subs(g2);
  check('おきている人は、ねむった人の位置（g）を受け取らない', s2.p === true && s2.g === false, s2);

  // ══ 仕事 ══
  await L.doFirstTask(g2, 'みどり');
  check('仕事がルームに届く', await L.waitFor(async () => L.doneCount(await L.gameIn(host)) === 1));
  check('みんなの仕事のバーが進む', await L.waitFor(async () => (await L.text(g3, '#hudProgressNum')).startsWith('1 /')));

  // ══ 近道（ねむらせ屋だけ） ══
  const v0 = E.VENTS[0];
  const v1 = E.VENTS[v0.to];
  await L.teleport(g1, v0.x, v0.y + 0.4);
  check('ねむらせ屋は近道の上で「近道を使う」', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')) === '近道を使う'));
  await g1.page.click('#actUse');
  const afterVent = await L.me(g1);
  check('近道を使うと、つながった近道へ移る', Math.hypot(afterVent.x - v1.x, afterVent.y - v1.y) < 0.01, afterVent);
  check('近道で移った位置がほかの人に届く', await L.waitFor(async () => {
    const pa = await g2.page.evaluate(() => window.__NK__.PA['あお']);
    return pa && Math.hypot(pa.tx - v1.x, pa.ty - v1.y) < 0.2;
  }));
  await L.teleport(g3, v0.x, v0.y + 0.4);
  await L.sleep(400);
  check('隊員は近道を使えない', (await L.text(g3, '#actUseLabel')) !== '近道を使う');

  // ══ 停電となおす ══
  await g1.page.click('#actDark');
  check('停電がみんなに出る', await L.waitFor(() => L.visible(host, '#hudDark')));
  await L.teleport(g3, E.FIX_SPOT.x, E.FIX_SPOT.y + 0.6);
  check('スイッチの前で「電気をなおす」', await L.waitFor(async () => (await L.text(g3, '#actUseLabel')) === '電気をなおす'));
  await L.shot(g3, '03-dark');
  await g3.page.click('#actUse');
  check('電気がなおる', await L.waitFor(async () => !(await L.visible(host, '#hudDark'))));

  // ══ ねむらせる ══（道具室の通路で。あとで、かべごしに「見つけた！」が出ないことを確かめるため）
  await L.teleport(host, 9.5, 11.6);
  await L.teleport(g1, 8.8, 11.6);
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
  // かべ1枚へだてた電気室から（1.8マス。見つけられる距離の中）では「見つけた！」が出ない
  await L.teleport(g2, 9.5, 13.4);
  await sleep(500);
  check('かべの向こうのねむっている人には「見つけた！」が出ない', !(await L.visible(g2, '#actFind')));
  await L.teleport(g2, 9.5, 10.6);
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
  check('おきている人に言葉のボタン（会議の10＋どちらでも4）', (await g2.page.$$('#meetingChips .nk-word')).length === 14);
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
  room = await L.roomOf(code);
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
  // 会議ボタン
  const t0 = E.spawnPoint(1, 4);
  await L.teleport(g1, t0.x, t0.y);
  check('テーブルの近くで会議ボタン', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')).startsWith('会議ボタン')));
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
  check('会議ボタンは1回まで', await L.waitFor(async () => (await L.text(g1, '#actUseLabel')).startsWith('会議ボタン（あと0回）')));
  // ねむらせ屋の勝ち
  await L.patchGame(code, { cooldown: { 'そら': 1 } });
  await L.teleport(g3, 12.5, 15.5);
  await L.teleport(g1, 13.2, 15.5);
  await L.waitFor(async () => !(await g3.page.$eval('#actSleep', (b) => b.disabled)));
  await g3.page.click('#actSleep');
  await L.waitFor(async () => (await L.roomOf(code)).game.asleep?.['あお']);
  await L.patchGame(code, { cooldown: { 'そら': 1 } });
  await L.teleport(g2, 13.2, 16.3);
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
