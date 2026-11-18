// カンペ放送局 E2E その3: 12人で遊ぶ（ホストも遊ぶ＋参加者11人）。13人ではじめられない・12人ならはじめられる・
// 書く人が空らん（7つ）より多いときは、書く番が交代でお休みになる（お休みの人の画面と印・お休みの人も判定する・
// 次の番組では、前にお休みだった人から書く）
const L = require('./lib.cjs');
const { check } = L;

(async () => {
  const server = await L.startServer();
  await L.launch();
  const H = await L.newClient('host');
  const code = await L.createRoom(H, 'ホスト');
  const names = ['アオイ', 'イツキ', 'ウタ', 'エマ', 'カイ', 'キコ', 'クウ', 'ケン', 'コハル', 'サク', 'シオン', 'スズ'];
  const G = [];
  for (const n of names) {
    const c = await L.newClient(n, { viewport: { width: 800, height: 900 } });
    await L.joinRoom(c, n, code);
    G.push(c);
  }
  const byName = (n) => (n === 'ホスト' ? H : G[names.indexOf(n)]);

  // ホストも遊ぶと13人。はじめられない
  check('A1 13人そろう', await L.waitFor(async () => (await L.text(H, '#lobby-count')).includes('遊ぶ人 13人')), await L.text(H, '#lobby-count'));
  check('A2 3〜12人で遊べると出る', (await L.text(H, '#lobby-count')).includes('3〜12人'));
  check('A3 13人でははじめられない', await L.waitFor(() => H.page.isDisabled('#btn-start')));
  check('A4 理由が出る', (await L.text(H, '#lobby-check')).includes('12人まで'), await L.text(H, '#lobby-check'));
  // 1人が退出して12人に
  const out = G.pop();
  names.pop();
  await out.page.click('#btnLeave');
  check('A5 12人ならはじめられる', await L.waitFor(async () => (await L.text(H, '#lobby-count')).includes('遊ぶ人 12人') && !(await H.page.isDisabled('#btn-start')), 10000), await L.text(H, '#lobby-count'));
  await out.page.close();
  const all = [H, ...G];

  async function round(label, prevRest) {
    await L.waitPhaseAll(all, 'write');
    const room = await L.roomOf(code);
    const g = room.game;
    const reader = g.reader;
    const writers = [...new Set(g.blanks.map((b) => b.writer))];
    const rest = g.players.filter((id) => id !== reader && !writers.includes(id));
    check(label + '1 空らんは7つ', g.blanks.length === 7, g.blanks.length);
    check(label + '2 書く人は7人で1つずつ', writers.length === 7);
    check(label + '3 お休みは4人', rest.length === 4, rest);
    // 書いた回数の少ない人から書く（この番組の分を引いた、前までの回数でくらべる）
    const before = (id) => (Number((g.wrote || {})[id]) || 0) - (writers.includes(id) ? 1 : 0);
    check(label + '4 書く人は、お休みの人より前までに書いた回数が多くない', Math.max(...writers.map(before)) <= Math.min(...rest.map(before)), g.wrote);
    const R = byName(reader);
    const restC = byName(rest[0]);
    check(label + '5 お休みの人の画面', await L.waitFor(async () => (await L.text(restC, '#game-status')).includes('書く番がお休み')), await L.text(restC, '#game-status'));
    check(label + '6 お休みの人に書く欄は出ない', (await restC.page.$$('#stage .kh-hint__input')).length === 0);
    check(label + '7 遊ぶ人の一覧に「お休み」', (await L.text(H, '#players')).split('お休み').length - 1 === 4);
    if (label === 'B') await L.shot(restC, 'k-rest');
    for (const w of writers) await L.writeAll(byName(w), 'ことば');
    await L.waitPhaseAll(all, 'read');
    await L.readThrough(R, 7);
    await L.clickText(R, '#stage', '読みおわった');
    await L.waitPhaseAll(all, 'judge');
    check(label + '8 お休みの人も判定する', (await restC.page.$$('#stage .kh-choice')).length === 2);
    for (const c of all) if (c !== R) await L.clickText(c, '#stage', '笑わずに読めた');
    await L.waitPhaseAll(all, 'result', 10000);
    check(label + '9 結果が出る', (await L.text(H, '#ph-game')).includes('笑わずに読みきった'));
    return rest;
  }

  await H.page.click('#btn-start');
  check('B0 12人×1周で12本', await L.waitFor(async () => (await L.text(H, '.kh-onair__round') || '').includes('全12本')));
  const rest1 = await round('B');
  await L.clickText(H, '#stage', 'つぎの番組へ');
  const rest2 = await round('C', rest1);
  await L.clickText(H, '#stage', 'つぎの番組へ');
  await round('D', rest2);
  const wrote = (await L.roomOf(code)).game.wrote || {};
  const counts = Object.values(wrote);
  check('E1 3本で書いた回数の差は2まで（読む番の人は書かない）', Math.max(...counts) - Math.min(...counts) <= 2, wrote);
  check('E2 幅 800px で横にはみ出さない', (await L.overflow(G[0])) <= 0);

  await L.finishAll(server);
})().catch((e) => { console.error(e); process.exit(1); });
