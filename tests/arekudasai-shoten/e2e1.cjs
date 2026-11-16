// あれください商店 E2E その1: 作成・参加・待合室・お客さん・お店の人・質問・結果・決める時間・合う物のポイント・
// 読み込み直し・退出した人の番を飛ばす・ここで終わる・もう一回・時間切れ・待合室へ・ルームを閉じる・みんなにみせる画面
// 隔離エミュレーターだけを使う（本番には接続しない）。README.md を参照
const L = require('./lib.cjs');
const { E, check, sleep, rest, roomWhen, gameOf, waitScreen, waitText, visible, waitVisible, text, overflow, waitFor, shot } = L;
// お店の人: 品物の札を押して、「この品物を出す」で決める
async function offer(c, name) {
  await waitVisible(c, '#shelf button.ak-card');
  await c.page.click(`#shelf button.ak-card:has-text("${name}")`);
  await waitText(c, '#stage', 'を出す？');
  await c.page.click('#stage button:has-text("この品物を出す")');
  await waitText(c, '#stage', '箱に入れて出したよ');
}

(async () => {
  const server = await L.startServer();
  await L.launch();
  const host = await L.newClient('host'); host.name = 'ホスト';
  const a = await L.newClient('a'); a.name = 'あおい';
  const b = await L.newClient('b'); b.name = 'みどり';
  const players = [host, a, b];
  const code = await L.createRoom(host, 'ホスト');
  check('room code', /^[A-HJ-NP-Z2-9]{6}$/.test(code), code);
  await L.joinRoom(a, 'あおい', code);
  await L.joinRoom(b, 'みどり', code);
  await waitText(host, '#peopleCount', '3人');
  check('lobby count', (await text(host, '#peopleCount')) === '3人');
  check('host sees settings', await visible(host, '#timeSeg'));
  check('guest sees summary', (await text(a, '#lobbySetView')).includes('10分'));
  // 設定: 5分・みんなのポイントを見せる
  await host.page.click('#timeSeg .ak-seg__btn:nth-child(1)');
  await host.page.check('#showAll');
  // お店の人が決める時間: 45秒
  await host.page.click('#offerSeg .ak-seg__btn:has-text("45秒")');
  await roomWhen(code, (r) => r.set.time === 5 && r.set.showAll === true && r.set.offer === 45);
  await waitText(a, '#lobbySetView', '5分');
  check('guest summary updated', (await text(a, '#lobbySetView')).includes('みんなのポイント') && (await text(a, '#lobbySetView')).includes('45秒'));

  // みんなにみせる画面
  const watch = await L.newClient('watch');
  await L.open(watch, '?watch=' + code);
  await waitScreen(watch, 'waiting');
  check('watch join info', (await text(watch, '#lobbyJoinCode')) === code);

  await host.page.click('#btnStartGame');
  for (const c of [...players, watch]) await waitScreen(c, 'game');
  let g = await gameOf(code);
  check('game seats', g && g.seats.length === 3, g?.seats);
  check('limit 5', g.raw.limit === 5);
  check('offer 45', g.raw.offer === 45);
  await shot(host, '01-start');

  // ── 1回目: ぴったり ──
  const byName = (name) => players.find((c) => c.name === name);
  let cust = g.seats[g.S.turn];
  let want = g.S.players[g.S.turn].order;
  let C = byName(cust);
  await waitText(C, '#stage', 'あなたのほしい物');
  check('customer sees wanted', (await text(C, '#stage')).includes(E.item(want).name));
  for (const o of players.filter((x) => x !== C)) {
    await waitText(o, '#stage', 'ヒントをえらんでいる');
    check('others do not see wanted: ' + o.label, !(await text(o, '#stage')).includes(E.item(want).name));
  }
  check('watch does not see wanted', !(await text(watch, '#stage')).includes(E.item(want).name));
  check('customer has no shelf', !(await visible(C, '#shelfBox')));
  // ヒント2つ（ほしい物のヒントから）
  const tags = E.item(want).tags.slice(0, 2);
  for (const t of tags) await C.page.click(`#stage .ak-chip-btn:has-text("${t}")`);
  check('third hint disabled', await C.page.evaluate(() => [...document.querySelectorAll('#stage .ak-chip-btn')].filter((b) => b.disabled).length === 11));
  await C.page.click('#stage button:has-text("これください！")');
  g = await roomWhen(code, (r) => r.play[r.game.id].r.h).then(() => gameOf(code));
  check('hints written', g.r.h === tags.join(','), g.r);
  const holderSeat = E.holderOf(g.S, want);
  const H = byName(g.seats[holderSeat]);
  const other = players.find((x) => x !== C && x !== H);
  await waitText(H, '#stage', 'どうする？');
  check('countdown shown', /のこり \d+秒/.test(await text(H, '#stage')));
  check('watch sees hints', (await text(watch, '#stage')).includes(tags[0]));
  // もう1人のお店: 質問してから出さない
  await waitText(other, '#stage', 'どうする？');
  await other.page.click('#stage .ak-choice:has-text("お客さんに質問する")');
  const askTag = E.TAGS.find((t) => !tags.includes(t));
  await other.page.click(`#stage .ak-chip-btn:has-text("${askTag}")`);
  const yes = E.item(want).tags.includes(askTag);
  await waitText(other, '#stage', 'それは、' + askTag + '？');
  check('answer right', (await text(other, '#stage')).includes(cust + '「' + (yes ? 'はい' : 'いいえ') + '」'));
  await waitText(C, '#stage', 'それは、' + askTag);
  check('rest count', (await text(other, '#stage')).includes('あと1回'));
  await other.page.click('#stage .ak-choice:has-text("出さない")');
  // 札には特徴の言葉を出さない・名前にも入っていない
  check('no tags on shelf', (await H.page.$$('#shelf .ak-tag')).length === 0);
  check('name has no tag word', !E.TAGS.some((t) => E.item(want).name.includes(t)));
  // 持っている人: ほしい物を出す（出したことが大きく出て、札に「出した」の印）
  await offer(H, E.item(want).name);
  check('sent badge on shelf', (await text(H, '#shelf')).includes('出した'));
  check('raw d is item', (await gameOf(code)).r.d[holderSeat] === want);
  await waitText(C, '#stage', 'どの箱を受け取る？');
  check('one box', (await C.page.$$('#stage .ak-offer')).length === 1);
  check('decline shown', (await text(C, '#stage')).includes('うちにはないです'));
  // 箱にそえる言葉はない（出した人には、出したことだけが出る）
  check('no comment yet', (await C.page.$$('#stage .ak-boxcomment')).length === 0);
  // 箱を出した人は、コメントをえらんで「送る」。その箱の下に出る。送りなおせる
  await waitText(H, '#stage', 'お客さんにコメントを送ろう');
  check('send disabled before pick', await H.page.isDisabled('#stage .ak-comment button.btn:has-text("送る")'));
  await H.page.click('#stage .ak-comment .ak-chip-btn:has-text("これだと思う！")');
  await H.page.click('#stage .ak-comment button.btn:has-text("送る")');
  await waitText(C, '#stage .ak-offer', '「これだと思う！」');
  check('raw m', (await gameOf(code)).r.m[holderSeat] === 1);
  await waitText(H, '#stage', '「これだと思う！」と送ったよ');
  await H.page.click('#stage .ak-comment .ak-chip-btn:has-text("どうぞ！")');
  await H.page.click('#stage .ak-comment button.btn:has-text("送りなおす")');
  await waitText(C, '#stage .ak-offer', '「どうぞ！」');
  check('comment resent', (await gameOf(code)).r.m[holderSeat] === 0);
  await shot(C, '04-comment-customer');
  await shot(H, '05-comment-shop');
  // 出さなかった人は、ぴったりだと思う箱をおすすめする。お客さんにはおすすめの数が見える
  await waitText(other, '#stage', 'おすすめしよう');
  check('customer cannot vote', !(await text(C, '#stage')).includes('おすすめしよう'));
  await other.page.click('#stage button.ak-offer--vote');
  await waitText(other, '#stage', 'あなたのおすすめ');
  await waitText(C, '#stage .ak-offer', 'おすすめ 1');
  check('raw vote', (await gameOf(code)).r.v[g.seats.indexOf(other.name)] === holderSeat);
  await C.page.click('#stage button.ak-offer');
  for (const c of [...players, watch]) await waitText(c, '#stage', 'ぴったり！', 6000);
  check('wanted revealed to watch', (await text(watch, '#stage')).includes(E.item(want).name));
  check('answer shown', (await text(watch, '#stage')).includes('答え合わせ'));
  check('gain shown to customer', (await text(C, '#stage')).includes('あなた +3ポイント'));
  check('gain shown to holder', (await text(H, '#stage')).includes('あなた +3ポイント'));
  check('vote shown to all', (await text(watch, '#stage')).includes('ぴったりの箱をおすすめした ' + other.name));
  // 「出さない」をえらんだお店: ヒントに合う物がお店になければ、正しく断れたので1ポイント（ぴったりの番なので入る）。おすすめが当たって1ポイント
  const otherSeat = g.seats.indexOf(other.name);
  const rightNo = !g.S.players[otherSeat].hand.some((id) => E.fits(id, tags));
  const otherGain = (rightNo ? 1 : 0) + 1;
  check('decline+vote point shown', (await text(other, '#stage')).includes('あなた +' + otherGain + 'ポイント'), otherGain);
  g = await gameOf(code);
  check('points', g.S.players[g.seats.indexOf(cust)].points === 3 && g.S.players[holderSeat].points === 3 && g.S.players[otherSeat].points === otherGain, g.S.players.map((p) => p.points));
  check('no list', (g.last.no || '') === (rightNo ? String(otherSeat) : ''), g.last.no);
  check('vote list', g.last.vt === String(otherSeat), g.last.vt);
  check('round advanced', g.r.n === 2 && g.last.n === 1 && g.last.hit === true);
  check('ask counted', g.S.players[g.seats.indexOf(other.name)].stat.ask === 1);
  check('town shows points (showAll)', (await text(a, '#town')).includes('3ポイント'));
  await shot(watch, '02-result-watch');
  await L.waitStats(C, 'hit', 1);

  // ── 2回目: 時間が来て、だれも出さなかった ──
  await sleep(6500);   // 結果の札は自動で閉じる
  cust = g.seats[g.S.turn];
  C = byName(cust);
  want = g.S.players[g.S.turn].order;
  await waitText(C, '#stage', 'あなたのほしい物');
  await C.page.click(`#stage .ak-chip-btn:has-text("${E.item(want).tags[0]}")`);
  await C.page.click('#stage button:has-text("これください！")');
  await roomWhen(code, (r) => r.play[r.game.id].r.h);
  // 決める時間を早送り
  await rest('PUT', `${L.ROOMS}/${code}/play/${g.id}/r/at`, Date.now() - 50000);
  await waitText(C, '#stage', 'どのお店にも', 6000);
  await C.page.click('#stage button:has-text("べつの物にする")');
  for (const c of players) await waitText(c, '#stage', 'だれも出さなかった', 6000);
  g = await gameOf(code);
  check('none round', g.last.none === true && g.r.n === 3);

  // ── 3回目: えらばれなかったけれど、ヒントに合う物を出したお店にも1ポイント ──
  await sleep(6500);   // 結果の札は自動で閉じる
  g = await gameOf(code);
  const c3 = g.S.turn;
  want = g.S.players[c3].order;
  const h3 = E.holderOf(g.S, want);
  const y3 = [0, 1, 2].find((i) => i !== c3 && i !== h3);
  // ヒント2つ（ほしい物の特徴3つから2つ）と、それに合う別の品物（山か、y3 のお店にある物）をさがす
  const wt = E.item(want).tags;
  let t3 = null, alt = null;
  for (const pair of [[wt[0], wt[1]], [wt[0], wt[2]], [wt[1], wt[2]]]) {
    alt = E.ITEMS.find((it) => it.id !== want && pair.every((t) => it.tags.includes(t)) && (g.S.deck.includes(it.id) || g.S.players[y3].hand.includes(it.id)));
    if (alt) { t3 = pair; break; }
  }
  check('found a fitting item', !!alt);
  // 合う物を y3 のお店に入れる（山から入れかえ。もうお店にあれば、そのまま）
  if (!g.S.players[y3].hand.includes(alt.id)) {
    const hand = g.S.players[y3].hand.slice(); hand[0] = alt.id;
    await rest('PUT', `${L.ROOMS}/${code}/play/${g.id}/h/${y3}`, hand.join(','));
  }
  C = byName(g.seats[c3]);
  await waitText(C, '#stage', 'あなたのほしい物');
  for (const t of t3) await C.page.click(`#stage .ak-chip-btn:has-text("${t}")`);
  await C.page.click('#stage button:has-text("これください！")');
  const Y = byName(g.seats[y3]);
  const H3 = byName(g.seats[h3]);
  await offer(Y, alt.name);
  await offer(H3, E.item(want).name);
  await waitText(C, '#stage', 'どの箱を受け取る？');
  check('two boxes', (await C.page.$$('#stage .ak-offer')).length === 2);
  const before = (await gameOf(code)).S.players.map((p) => p.points);
  await C.page.click(`#stage button.ak-offer:has-text("${g.seats[h3]}のお店")`);
  await waitText(Y, '#stage', 'ぴったり！', 6000);
  check('fit message', (await text(Y, '#stage')).includes('ヒントに合う物を出した'));
  check('fit gain', (await text(Y, '#stage')).includes('あなた +1ポイント'));
  g = await gameOf(code);
  check('fit points', g.S.players[y3].points === before[y3] + 1 && g.S.players[h3].points === before[h3] + 3, [before, g.S.players.map((p) => p.points)]);
  check('fit item stays', g.S.players[y3].hand.includes(alt.id));

  // ── 4回目: ちがう物がえらばれると、出したお店は1ポイント減る（本人の画面にだけ出す） ──
  await sleep(6500);   // 結果の札は自動で閉じる
  g = await gameOf(code);
  const c4 = g.S.turn;
  const w4 = g.S.players[c4].order;
  const x4 = [0, 1, 2].find((i) => i !== c4 && g.S.players[i].points > 0 && g.S.players[i].hand.some((id) => id !== w4));
  check('found a shop with points', x4 !== undefined, g.S.players.map((p) => p.points));
  const wrong = g.S.players[x4].hand.find((id) => id !== w4);
  const z4 = [0, 1, 2].find((i) => i !== c4 && i !== x4);
  C = byName(g.seats[c4]);
  await waitText(C, '#stage', 'あなたのほしい物');
  await C.page.click(`#stage .ak-chip-btn:has-text("${E.item(w4).tags[0]}")`);
  await C.page.click('#stage button:has-text("これください！")');
  const X = byName(g.seats[x4]);
  const Z = byName(g.seats[z4]);
  await offer(X, E.item(wrong).name);
  await waitText(Z, '#stage', 'どうする？');
  await Z.page.click('#stage .ak-choice:has-text("出さない")');
  await waitText(C, '#stage', 'どの箱を受け取る？');
  const before4 = (await gameOf(code)).S.players.map((p) => p.points);
  await C.page.click(`#stage button.ak-offer:has-text("${g.seats[x4]}のお店")`);
  await waitText(X, '#stage', 'ちがう物！', 6000);
  await waitText(watch, '#stage', 'ちがう物！', 6000);
  await waitText(C, '#stage', 'ちがう物！', 6000);
  check('loss shown to giver', (await text(X, '#stage')).includes('あなたは -1ポイント'));
  check('loss not shown to customer', !(await text(C, '#stage')).includes('-1'));
  check('loss not shown to watch', !(await text(watch, '#stage')).includes('-1') && !(await text(watch, '#stage')).includes('減'));
  check('customer +1', (await text(C, '#stage')).includes('あなた +1ポイント'));
  g = await gameOf(code);
  check('odd points', g.S.players[x4].points === before4[x4] - 1 && g.S.players[c4].points === before4[c4] + 1, [before4, g.S.players.map((p) => p.points)]);

  // ── 読み込み直し（参加者）: 同じ席にもどる ──
  await a.page.reload();
  await waitScreen(a, 'game');
  check('reload keeps seat', (await text(a, '#myPointsBox')) !== null && await visible(a, '#myPointsBox'));

  // ── 退出した人の番は、ホストが飛ばせる ──
  await sleep(6500);   // 結果の札は自動で閉じる
  await b.page.click('#btnLeave');
  await L.waitScreen(b, 'top');
  await roomWhen(code, (r) => !r.players['みどり']);
  // みどりの番にする
  g = await gameOf(code);
  const mi = g.seats.indexOf('みどり');
  if (g.S.turn !== mi) await rest('PUT', `${L.ROOMS}/${code}/play/${g.id}/turn`, mi);
  await waitText(host, '#stage', '通信が切れているよ');
  check('away in town', (await text(host, '#town')).includes('通信が切れた'));
  await host.page.click('#stage button:has-text("この番を飛ばす")');
  await waitText(host, '#stage', 'の番を飛ばした', 6000);
  g = await gameOf(code);
  check('skipped', g.last.skip === true && g.S.turn !== mi);
  await L.waitStats(host, 'skip', 1);

  // ── ここで終わる → おわり ──
  await sleep(6500);
  await host.page.click('#btnEndNow');
  for (const c of [host, a, watch]) await waitText(c, '#stage', 'おしまい', 6000);
  check('titles', (await host.page.$$('#stage .ak-titles li')).length === 3);
  check('end my points', (await text(a, '#stage')).includes('あなたのポイント'));
  check('watch no my points', !(await text(watch, '#stage')).includes('あなたのポイント'));
  check('guest waits', (await text(a, '#stage')).includes('ホストが、もう一回'));
  check('no shelf at end', !(await visible(a, '#shelfBox')));
  await shot(host, '03-end');
  await L.waitStats(host, 'finish', 1);

  // ── もう一回（いる人で決めなおす: みどりは外れる） ──
  await host.page.click('#stage button:has-text("もう一回")');
  await waitText(host, '#stage', '', 6000);
  g = await roomWhen(code, (r) => r.game.id === 2).then(() => gameOf(code));
  check('again seats', g.seats.length === 2 && !g.seats.includes('みどり'), g.seats);
  await waitFor(async () => !(await text(a, '#stage')).includes('おしまい'));

  // ── 時間切れ ──
  await rest('PUT', `${L.ROOMS}/${code}/game/startAt`, Date.now() - 6 * 60000);
  for (const c of [host, a]) await waitText(c, '#stage', 'おしまい', 6000);
  check('time up clock', (await text(host, '#clockText')) === '0:00');

  // ── 待合室へ → ルームを閉じる ──
  await host.page.click('#stage button:has-text("待合室へ")');
  for (const c of [host, a, watch]) await waitScreen(c, 'waiting');
  await host.page.click('#btnLeave');
  await waitScreen(a, 'top');
  await waitScreen(watch, 'watch-end');
  check('room removed', (await L.roomOf(code)) === null);

  // スマホ幅: はみ出さない
  check('no overflow host', (await overflow(host)) <= 0);
  await L.finishAll(server);
})().catch(async (e) => { console.error(e); process.exit(1); });
