// 神経衰弱 E2E その2: 6人まで（7人目）・途中参加は不可・自分の番で退出（めくりかけ）・同じ名前で入りなおし・
// タブを閉じた人の番をとばす・おわりのあとは参加できる・ホストの切断と復帰
const path = require('path');
const H = require('./lib.cjs');
const { check, sleep } = H;

(async () => {
  const server = await H.startServer();
  await H.launch();
  await H.loadRules(path.join(__dirname, '../../database.rules.json'));
  try {
    console.log('# 6人まで');
    const host = await H.newClient('host');
    const code = await H.createRoom(host, 'ホスト');
    const g = [];
    for (let i = 1; i <= 5; i++) {
      const c = await H.newClient('g' + i);
      await H.joinRoom(c, 'p' + i, code);
      g.push(c);
    }
    await H.waitText(host, '#waitingCount', '6人');
    check('6人で「遊べるのは6人まで」', (await H.text(host, '#startNote')).includes('6人まで'));
    check('6人で端末なしは足せない', await host.page.$eval('#btnAddProxy', (b) => b.disabled));
    const seventh = await H.newClient('seventh');
    await H.open(seventh, '?room=' + code);
    await H.waitScreen(seventh, 'join');
    await seventh.page.fill('#guestName', 'p6');
    await seventh.page.click('#btnJoinRoom');
    await H.waitText(seventh, '#joinError', 'いっぱい');
    check('7人目は入れない', true);
    // ホストが進行だけになれば入れる
    await host.page.uncheck('#hostPlays');
    await H.waitText(host, '#waitingCount', '5人');
    await seventh.page.click('#btnJoinRoom');
    await H.waitScreen(seventh, 'waiting');
    check('進行だけにすると7人目が入れる', true);
    await H.waitText(host, '#waitingCount', '6人');
    check('6人で進行だけのとき、遊ぶにもどせない', await host.page.$eval('#hostPlays', (b) => b.disabled));
    // 2人だけ残す
    for (const c of [g[2], g[3], g[4], seventh]) {
      await c.page.click('#btnLeave');
      await H.waitScreen(c, 'top');
    }
    await H.waitText(host, '#waitingCount', '2人');
    await host.page.check('#hostPlays');
    await H.waitText(host, '#waitingCount', '3人');

    console.log('# 途中参加');
    await host.page.click('#btnStartGame');
    await H.waitScreen(g[0], 'game');
    const late = await H.newClient('late');
    await H.open(late, '?room=' + code);
    await H.waitScreen(late, 'join');
    await late.page.fill('#guestName', 'おそい');
    await late.page.click('#btnJoinRoom');
    await H.waitText(late, '#joinError', 'もうゲームが始まっているよ');
    check('遊んでいる途中は新しく入れない', true);

    console.log('# 自分の番で退出');
    let room = await H.roomOf(code);
    const deck = room.game.deck;
    // ホストが外して p1 の番にする
    const [a, b] = H.missIn(deck);
    await H.clickCard(host, a);
    await H.clickCard(host, b);
    await H.waitText(g[0], '#status', 'あなたの番', 4000);
    await H.clickCard(g[0], 0);
    await H.roomWhen(code, (r) => r.game.open === 0);
    await g[0].page.click('#btnLeave');
    await H.waitScreen(g[0], 'top');
    room = await H.roomWhen(code, (r) => r.game.turn === 2);
    check('退出すると次の人（p2）へ', room.game.turn === 2, room.game.turn);
    check('めくりかけは裏にもどる', room.game.open === -1);
    check('札に「つながっていない」', (await H.players(host))[1].tags.includes('つながっていない'));
    check('名前とペアは残る', (await H.players(host)).length === 3);

    console.log('# 同じ名前で入りなおし');
    await H.open(g[0], '?room=' + code);
    await H.waitScreen(g[0], 'join');
    await g[0].page.fill('#guestName', 'p1');
    await g[0].page.click('#btnJoinRoom');
    await H.waitScreen(g[0], 'game');
    check('同じ端末・同じ名前なら途中でも戻れる', !(await H.players(host))[1].tags.includes('つながっていない'));
    // ほかの端末が同じ名前で入ろうとしても入れない
    await late.page.fill('#guestName', 'p1');
    await late.page.click('#btnJoinRoom');
    await H.waitText(late, '#joinError', 'その名前は使われているよ');
    check('ほかの端末は同じ名前で入れない', true);

    console.log('# タブを閉じた人の番をとばす');
    // いまは p2 の番。p2 が1枚めくってタブを閉じる
    await H.clickCard(g[1], 1);
    await H.roomWhen(code, (r) => r.game.open === 1);
    await g[1].page.close();
    room = await H.roomWhen(code, (r) => r.game.turn === 0 && r.game.open === -1, 20000);
    check('ホストが見はって、いない人の番をとばす', room.game.turn === 0 && room.game.open === -1, room.game);

    console.log('# おわり → 参加できる');
    room = await H.roomOf(code);
    const got = room.game.got.slice();
    const last = H.pairIn(deck, got);
    deck.forEach((_, i) => { if (i !== last[0] && i !== last[1]) got[i] = true; });
    await H.rest('PATCH', H.ROOMS + '/' + code + '/game', { got });
    await host.page.waitForFunction(() => document.querySelectorAll('#board .ss-card.is-got').length === 10);
    await H.clickCard(host, last[0]);
    await H.clickCard(host, last[1]);
    await H.waitVisible(g[0], '#result', 4000);
    // おわりの画面でも、このゲームの名前（タブを閉じた p2）は別の端末では使えない
    await late.page.fill('#guestName', 'p2');
    await late.page.click('#btnJoinRoom');
    await H.waitText(late, '#joinError', 'その名前は使われているよ');
    check('おわりの画面でも、抜けた人の名前は別の端末で使えない', true);
    await late.page.fill('#guestName', 'おそい');
    await late.page.click('#btnJoinRoom');
    await H.waitScreen(late, 'game');
    check('おわりのあとは参加できる（結果が見える）', await H.visible(late, '#result'));
    await host.page.click('#btn-again');
    await H.waitHidden(late, '#result', 4000);
    const names = (await H.players(late)).map((p) => p.name).join(',');
    check('もう一回: あとから入った人も入る・いない人は外れる', names === 'ホスト,p1,おそい', names);

    console.log('# ホストの切断と復帰');
    host.offlineOk = true;
    await host.context.setOffline(true);
    await H.waitVisible(g[0], '#hostOffOverlay', 90000);
    check('ホストが切れるとゲストに待つ画面', true);
    check('待つ画面では「退出する」にフォーカス', await g[0].page.evaluate(() => document.activeElement?.id === 'btnOverlayLeave'));
    await host.context.setOffline(false);
    await H.waitHidden(g[0], '#hostOffOverlay', 30000);
    check('ホストが戻ると待つ画面が消える', true);
    await host.page.reload();
    await H.waitScreen(host, 'game');
    check('ホストの再読み込みで遊ぶ画面に戻る', (await H.text(host, '#btn-quit')) === '待合室にもどる');
  } catch (e) {
    console.error(e);
    check('exception', false, String(e && e.message));
  }
  await H.finishAll(server);
})();
