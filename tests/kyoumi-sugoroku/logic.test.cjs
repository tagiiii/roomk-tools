// 興味スゴロク ルームの決まり（logic.js）のテスト。node tests/kyoumi-sugoroku/logic.test.cjs
const path = require('path');
const assert = require('assert');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (error) {
    console.error('NG', name);
    throw error;
  }
}

(async () => {
  const L = await import(path.join(__dirname, '../../apps/kyoumi-sugoroku/logic.js'));
  const COUNTS = { a: 3, b: 2, c: 4 };

  function waitingRoom(extra = {}) {
    return {
      status: L.STATUS.WAITING,
      host: 'ホスト',
      hostUid: 'uH',
      hostPlays: true,
      squares: 10,
      themes: ['a', 'b', 'c'],
      lastGameId: 0,
      players: {
        'ホスト': { isHost: true, uid: 'uH', joinedAt: 1, ver: L.VER },
        'あお': { isHost: false, uid: 'uA', joinedAt: 2, ver: L.VER },
        'みどり': { isHost: false, uid: 'uM', joinedAt: 3, ver: L.VER },
      },
      ...extra,
    };
  }

  test('版: 版のちがう参加者がいると、道中すごろくははじめない（今までの遊び方ははじめる）', () => {
    assert.strictEqual(L.STEP.LIFE_ROLL, 'life' + L.VER + '-roll');
    const players = (vers) => Object.fromEntries(Object.entries(waitingRoom().players).map(([n, p]) => [n, { ...p, ver: vers[n] ?? p.ver }]));
    const old = players({ 'あお': L.VER - 1, 'みどり': undefined });
    delete old['みどり'].ver;
    assert.deepStrictEqual(L.staleNames(waitingRoom({ players: old })), ['あお', 'みどり']);
    assert.deepStrictEqual(L.staleNames(waitingRoom()), []);
    assert.strictEqual(L.startGame(waitingRoom({ mode: L.MODE.LIFE, players: old }), COUNTS), null);
    assert.ok(L.startGame(waitingRoom({ players: old }), COUNTS)); // 今までの遊び方
    assert.ok(L.startGame(waitingRoom({ mode: L.MODE.LIFE }), COUNTS));
    // ホストの版は staleNames に入れない（はじめるのはホスト自身）。ホストの版は hostVer で見る
    const oldHost = players({ 'ホスト': L.VER - 1 });
    assert.deepStrictEqual(L.staleNames(waitingRoom({ players: oldHost })), []);
    assert.strictEqual(L.hostVer(waitingRoom({ players: oldHost })), L.VER - 1);
    const noVer = waitingRoom();
    delete noVer.players['ホスト'].ver;
    assert.strictEqual(L.hostVer(noVer), 0);
    // 1台の画面（通信しない）は版を見ない
    assert.deepStrictEqual(L.staleNames({ ...waitingRoom({ players: old }), offline: true }), []);
  });

  test('はじめる: 参加した順・ホストが最初・端末なしもふくむ', () => {
    const room = waitingRoom({ proxies: { 'きいろ': { joinedAt: 4 } } });
    const next = L.startGame(room, COUNTS);
    assert.deepStrictEqual(next.game.order, ['ホスト', 'あお', 'みどり', 'きいろ']);
    assert.deepStrictEqual(next.game.pos, [0, 0, 0, 0]);
    assert.strictEqual(next.status, L.STATUS.PLAYING);
    assert.strictEqual(next.game.step, L.STEP.ROLL);
    assert.strictEqual(next.game.uids['あお'], 'uA');
    assert.strictEqual(next.game.uids['きいろ'], undefined);
    assert.strictEqual(next.game.proxy['きいろ'], true);
    assert.strictEqual(next.game.id, 1);
    assert.strictEqual(next.lastGameId, 1);
  });

  test('はじめる: ホストが進行だけなら順番に入らない', () => {
    const next = L.startGame(waitingRoom({ hostPlays: false }), COUNTS);
    assert.deepStrictEqual(next.game.order, ['あお', 'みどり']);
  });

  test('はじめる: 遊ぶ人0人・11人以上・待合室以外は進めない', () => {
    assert.strictEqual(L.startGame(waitingRoom({ hostPlays: false, players: { 'ホスト': { isHost: true, uid: 'uH', joinedAt: 1 } } }), COUNTS), null);
    const proxies = Object.fromEntries(['い', 'ろ', 'は', 'に', 'ほ', 'へ', 'と', 'ち'].map((n, i) => [n, { joinedAt: 10 + i }]));
    assert.strictEqual(L.startGame(waitingRoom({ proxies }), COUNTS), null); // 3 + 8 = 11人
    const ten = Object.fromEntries(['い', 'ろ', 'は', 'に', 'ほ', 'へ', 'と'].map((n, i) => [n, { joinedAt: 10 + i }]));
    assert.strictEqual(L.startGame(waitingRoom({ proxies: ten }), COUNTS).game.order.length, 10); // 10人までは遊べる
    assert.strictEqual(L.startGame({ ...waitingRoom(), status: L.STATUS.PLAYING }, COUNTS), null);
  });

  test('はじめる: マス数・テーマの壊れた値は初期値に', () => {
    const next = L.startGame(waitingRoom({ squares: 7, themes: ['a', 'zzz'] }), COUNTS);
    assert.strictEqual(next.game.squares, L.DEFAULT_SQUARES);
    assert.deepStrictEqual(next.game.themes, ['a', 'b', 'c']);
  });

  const started = L.startGame(waitingRoom(), COUNTS);

  test('振る: 出目のぶん進み、質問が出る', () => {
    const next = L.roll(started, 1, 0, 12345, COUNTS);
    const g = next.game;
    assert.ok(g.last.dice >= 1 && g.last.dice <= 6);
    assert.strictEqual(g.pos[0], g.last.dice);
    assert.strictEqual(g.last.from, 0);
    assert.strictEqual(g.last.turn, 0);
    assert.strictEqual(g.rollNo, 1);
    assert.strictEqual(g.step, L.STEP.TALK);
    assert.ok(COUNTS[g.q.theme] > g.q.idx);
    assert.strictEqual(g.lastTheme, g.q.theme);
    assert.deepStrictEqual(g.used[g.q.theme], [g.q.idx]);
  });

  test('振る: 同じ種なら同じ結果（transaction のやり直しで変わらない）', () => {
    assert.deepStrictEqual(L.roll(started, 1, 0, 777, COUNTS), L.roll(started, 1, 0, 777, COUNTS));
  });

  test('振る: 古い操作（rollNo・game id のちがい）・話す番は受けない', () => {
    assert.strictEqual(L.roll(started, 1, 1, 1, COUNTS), null);
    assert.strictEqual(L.roll(started, 2, 0, 1, COUNTS), null);
    const talk = L.roll(started, 1, 0, 1, COUNTS);
    assert.strictEqual(L.roll(talk, 1, 1, 1, COUNTS), null);
  });

  test('振る: ゴールでとまる（オーバーしない）', () => {
    const near = { ...started, game: { ...started.game, pos: [8, 0, 0] } };
    let goal = null;
    for (let seed = 1; seed < 200 && !goal; seed++) {
      const r = L.roll(near, 1, 0, seed, COUNTS);
      if (r.game.last.dice >= 1 && r.status === L.STATUS.GOAL) goal = r;
    }
    assert.ok(goal);
    assert.strictEqual(goal.game.pos[0], 9);
    assert.strictEqual(goal.game.winner, 0);
    assert.strictEqual(goal.game.q, null);
  });

  test('質問: 直前と同じテーマを避け、テーマの中では出しきるまで重ねない', () => {
    let room = started;
    let lastTheme = null;
    const seen = { a: [], b: [], c: [] };
    for (let k = 0; k < 30; k++) {
      const g = L.gameOf(room);
      room = L.roll({ ...room, game: { ...g, pos: [0, 0, 0] } }, 1, g.rollNo, 1000 + k, COUNTS);
      const q = room.game.q;
      if (lastTheme) assert.notStrictEqual(q.theme, lastTheme);
      lastTheme = q.theme;
      seen[q.theme].push(q.idx);
      const used = room.game.used[q.theme];
      assert.ok(used.length <= COUNTS[q.theme]);
      room = L.nextPlayer(room, 1, room.game.rollNo);
    }
    // 各テーマで、出しきる前に同じ質問が2回出ていない
    for (const [theme, list] of Object.entries(seen)) {
      for (let i = 0; i + COUNTS[theme] <= list.length; i += COUNTS[theme]) {
        const chunk = list.slice(i, i + COUNTS[theme]);
        assert.strictEqual(new Set(chunk).size, chunk.length, theme + ' ' + list.join(','));
      }
    }
  });

  const talk = L.roll(started, 1, 0, 42, COUNTS);

  test('別の質問: テーマはそのまま・ちがう質問', () => {
    const next = L.reask(talk, 1, 1, 1, 99, COUNTS);
    assert.strictEqual(next.game.q.theme, talk.game.q.theme);
    assert.notStrictEqual(next.game.q.idx, talk.game.q.idx);
    assert.strictEqual(next.game.q.n, 2);
    assert.strictEqual(next.game.step, L.STEP.TALK);
    assert.strictEqual(L.reask(started, 1, 0, 0, 1, COUNTS), null); // 振る番では使えない
    // 同時に押された古い「別の質問」（押した時点の質問とちがう）は通らない
    assert.strictEqual(L.reask(next, 1, 1, 1, 5, COUNTS), null);
    assert.strictEqual(L.reask(next, 1, 1, 2, 5, COUNTS).game.q.n, 3);
  });

  test('選ぶ: 選ぶと次の人の番。選んだものは次のサイコロまで残る。古い質問・二度押しは通らない', () => {
    const one = L.choose(talk, 1, 1, 1, 2, 3, COUNTS);
    assert.strictEqual(one.game.step, L.STEP.ROLL);
    assert.strictEqual(one.game.q, null);
    assert.strictEqual(one.game.turn, 1);
    assert.deepStrictEqual(L.pickedOf(one.game, COUNTS), { turn: 0, theme: talk.game.q.theme, idx: talk.game.q.idx, choice: 2, text: '' });
    assert.strictEqual(L.choose(one, 1, 1, 1, 0, 3, COUNTS), null); // もう話す番ではない（二度押し）
    assert.strictEqual(L.pickedOf(L.choose(talk, 1, 1, 1, L.CHOICE_FREE, 3, COUNTS).game, COUNTS).choice, L.CHOICE_FREE);
    assert.strictEqual(L.choose(talk, 1, 1, 1, 3, 3, COUNTS), null);
    assert.strictEqual(L.choose(talk, 1, 1, 1, 0, 0, COUNTS), null);
    assert.strictEqual(L.choose(talk, 1, 1, 2, 0, 3, COUNTS), null);
    // 次の人がサイコロを振ると消える（ゴールでも）
    const rolled = L.roll(one, 1, 1, 7, COUNTS);
    assert.strictEqual(L.pickedOf(rolled.game, COUNTS), null);
    const nearGoal = { ...one, game: { ...one.game, pos: [0, 13, 0] } };
    const goal = L.roll(nearGoal, 1, 1, 7, COUNTS);
    assert.strictEqual(goal.status, L.STATUS.GOAL);
    assert.strictEqual(L.pickedOf(goal.game, COUNTS), null);
    // 壊れた値は読み飛ばす
    assert.strictEqual(L.pickedOf({ ...one.game, picked: { ...one.game.picked, idx: 9999 } }, COUNTS), null);
    assert.strictEqual(L.pickedOf({ ...one.game, picked: { ...one.game.picked, turn: 5 } }, COUNTS), null);
    assert.strictEqual(L.pickedOf({ ...one.game, picked: { ...one.game.picked, choice: -2 } }, COUNTS), null);
  });

  test('次の人へ: 質問を消し、順番どおり。いない人はとばす。最後のあとは最初へ', () => {
    const next = L.nextPlayer(talk, 1, 1);
    assert.strictEqual(next.game.step, L.STEP.ROLL);
    assert.strictEqual(next.game.q, null);
    assert.strictEqual(next.game.turn, 1);
    const players = { ...talk.players };
    delete players['あお'];
    assert.strictEqual(L.nextPlayer({ ...talk, players }, 1, 1).game.turn, 2);
    const last = { ...talk, game: { ...talk.game, turn: 2 } };
    assert.strictEqual(L.nextPlayer(last, 1, 1).game.turn, 0);
    assert.strictEqual(L.nextPlayer(started, 1, 0), null); // 振る番では使えない
  });

  test('いない人をとばす: 振る番の人がいないときだけ', () => {
    const turn1 = { ...started, game: { ...started.game, turn: 1 } };
    assert.strictEqual(L.skipAbsent(turn1), null);
    const players = { ...turn1.players };
    delete players['あお'];
    assert.strictEqual(L.skipAbsent({ ...turn1, players }).game.turn, 2);
    // 端末なしの参加者はいつもいる
    const withProxy = L.startGame(waitingRoom({ proxies: { 'きいろ': { joinedAt: 4 } } }), COUNTS);
    assert.strictEqual(L.skipAbsent({ ...withProxy, game: { ...withProxy.game, turn: 3 } }), null);
  });

  test('押せる人: 番の人の端末とホストだけ', () => {
    const turn1 = { ...started, game: { ...started.game, turn: 1 } };
    assert.strictEqual(L.canAct(turn1, 'uA', 'あお', 'guest'), true);
    assert.strictEqual(L.canAct(turn1, 'uX', 'あお', 'guest'), false);
    assert.strictEqual(L.canAct(turn1, 'uM', 'みどり', 'guest'), false);
    assert.strictEqual(L.canAct(turn1, 'uH', 'ホスト', 'host'), true);
    assert.strictEqual(L.canAct(turn1, 'uA', 'あお', 'host'), false);
    assert.strictEqual(L.canAct(waitingRoom(), 'uH', 'ホスト', 'host'), false);
  });

  test('待合室にもどる: ゲーム中・ゴールのあとから。ゲームを消す', () => {
    const back = L.backToWaiting(talk, 1);
    assert.strictEqual(back.status, L.STATUS.WAITING);
    assert.strictEqual(back.game, null);
    assert.strictEqual(L.backToWaiting(talk, 2), null);
    assert.strictEqual(L.backToWaiting(waitingRoom(), 1), null);
  });

  test('名前の検査', () => {
    assert.strictEqual(L.validNickname('あいうえおかきく'), '');
    assert.ok(L.validNickname('あいうえおかきくけ'));
    assert.ok(L.validNickname(''));
    assert.ok(L.validNickname('a.b'));
    assert.ok(L.validNickname('a/b'));
  });

  /* ── 「道中すごろく」 ── */
  const LIFE = {
    scenes: ['s0', 's1', 's2', 's3'],
    erabu: { s0: 4, s1: 4, s2: 4, s3: 4 },
    kiku: { s0: 5, s1: 5, s2: 5, s3: 5 },
    events: [{ move: 2, all: 0, again: false }, { move: 0, all: 1, again: false }, { move: 0, all: 0, again: true }, { move: 0, all: 0, again: false }],
    minna: [6, 4],
  };
  L.setLifeContent(LIFE);
  const lifeRoom = (extra = {}) => L.startGame(waitingRoom({ mode: 'life', ...extra }), COUNTS);
  // 決まったマスに置いて、決まったカードを出した形にする
  const withCard = (room, q, pos) => ({ ...room, game: { ...room.game, step: L.STEP.LIFE_TALK, rollNo: 1, q, pos: pos || room.game.pos } });
  // サイコロを振って、ちがう目なら1つ目を選ぶ（止まるマスまで進める）
  const rollAndPick = (room, seed, which = 0) => {
    const rolled = L.roll(room, room.game.id, room.game.rollNo || 0, seed, COUNTS);
    return L.isPickStep(rolled.game) ? L.pickDie(rolled, rolled.game.id, rolled.game.rollNo || 0, which, seed + 1) : rolled;
  };
  const kikuWho = { kind: 'kiku', scene: 's1', n: 1 };

  test('道中すごろく: マス数は人数と長さから・マスの種類・場面', () => {
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 10].map((n) => L.lifeSizeFor(n, 0)), [28, 28, 24, 20, 16, 16, 12, 12]);
    assert.strictEqual(L.lifeKinds(12).length, 12);
    assert.strictEqual(L.lifeSizeFor(10, 1), 16);
    assert.strictEqual(L.lifeSizeFor(4, -1), 16);
    assert.strictEqual(L.lifeSizeFor(4, 1), 24);
    assert.strictEqual(L.lifeSizeFor(1, 1), 28);
    assert.strictEqual(L.lifeSizeFor(6, -1), 12);
    assert.strictEqual(L.lifeSizeFor(10, -1), 12);
    const kinds = L.lifeKinds(20);
    assert.strictEqual(kinds[0], '');
    assert.strictEqual(kinds[19], '');
    assert.deepStrictEqual(kinds.slice(1, 5), ['erabu', 'kiku', 'erabu', 'dekigoto']);
    assert.ok(kinds.slice(1, 19).every((k) => ['erabu', 'kiku', 'dekigoto', 'minna'].includes(k)));
    const room = lifeRoom(); // 3人 → 24マス・6列
    assert.strictEqual(room.game.mode, 'life');
    assert.strictEqual(L.boardSize(room.game), 24);
    assert.deepStrictEqual(room.game.done, [false, false, false]);
    assert.strictEqual(L.lifeSceneAt(room.game, 5), 's0');
    assert.strictEqual(L.lifeSceneAt(room.game, 6), 's1');
    assert.strictEqual(L.lifeSceneAt(room.game, 23), 's3');
    // 今までの遊び方は変わらない
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.strictEqual(theme.game.mode, undefined);
    assert.strictEqual(L.boardSize(theme.game), 10);
  });

  test('道中すごろく: サイコロは2つ。ちがう目なら進む目を選び、同じ目ならそのまま進む', () => {
    const room = lifeRoom();
    let picks = 0;
    let doubles = 0;
    for (let seed = 1; seed <= 80; seed++) {
      const rolled = L.roll(room, 1, 0, seed, COUNTS);
      if (L.isPickStep(rolled.game)) {
        picks++;
        const [a, b] = rolled.game.dice;
        assert.notStrictEqual(a, b);
        assert.deepStrictEqual(rolled.game.pos, [0, 0, 0]); // まだ進まない
        assert.strictEqual(rolled.game.rollNo, 0);
        assert.strictEqual(L.roll(rolled, 1, 0, seed, COUNTS), null); // 二度は振れない
        assert.strictEqual(L.pickDie(rolled, 1, 0, 2, seed), null);
        const first = L.pickDie(rolled, 1, 0, 0, seed);
        const second = L.pickDie(rolled, 1, 0, 1, seed);
        assert.strictEqual(first.game.pos[0], a);
        assert.strictEqual(second.game.pos[0], b);
        assert.strictEqual(first.game.rollNo, 1);
        assert.strictEqual(first.game.last.quick, true);
        assert.strictEqual(first.game.dice, null);
        assert.strictEqual(L.pickDie(first, 1, 0, 1, seed), null); // 選んだあとは選べない
      } else {
        doubles++;
        assert.strictEqual(rolled.game.rollNo, 1);
        assert.strictEqual(rolled.game.pos[0], rolled.game.last.dice);
        assert.strictEqual(rolled.game.last.quick, undefined);
      }
    }
    assert.ok(picks > 40 && doubles > 0, `${picks}/${doubles}`);
  });

  test('道中すごろく: 止まったマスの種類のカードが出る', () => {
    const room = lifeRoom();
    for (let seed = 1; seed <= 40; seed++) {
      const next = rollAndPick(room, seed);
      const to = next.game.pos[0];
      const q = L.lifeQuestionOf(next.game);
      assert.strictEqual(next.game.step, L.STEP.LIFE_TALK);
      assert.strictEqual(q.kind, L.lifeKindsOf(next.game)[to]);
      if (q.kind !== 'dekigoto') assert.strictEqual(q.scene, to < 6 ? 's0' : 's1'); // 6列なので、6マス目から次の場面
      if (q.kind === 'kiku') assert.strictEqual(q.phase, L.PHASE.WHO);
      assert.strictEqual(L.questionOf(next.game, COUNTS), null);
    }
  });

  test('道中すごろく: えらぶは選ぶと次の人・選んだものが残る', () => {
    const room = withCard(lifeRoom(), { kind: 'erabu', scene: 's0', idx: 1, n: 1 });
    assert.strictEqual(L.choose(room, 1, 1, 1, 5, 3, COUNTS), null);
    assert.strictEqual(L.choose(room, 1, 1, 2, 0, 3, COUNTS), null); // 古い質問
    const next = L.choose(room, 1, 1, 1, 2, 3, COUNTS);
    assert.strictEqual(next.game.turn, 1);
    assert.strictEqual(next.game.step, L.STEP.LIFE_ROLL);
    assert.deepStrictEqual(L.pickedOf(next.game, COUNTS), { life: true, kiku: false, by: null, scene: 's0', idx: 1, turn: 0, choice: 2, text: '' });
    // 次のサイコロで消える
    assert.strictEqual(L.roll(next, 1, 1, 3, COUNTS).game.picked, null);
    // 別の質問
    const re = L.reask(room, 1, 1, 1, 5, COUNTS);
    assert.notStrictEqual(L.lifeQuestionOf(re.game).idx, 1);
    assert.strictEqual(L.lifeQuestionOf(re.game).n, 2);
  });

  test('道中すごろく: きくは、相手 → 3枚の質問から1枚 → 聞かれた人が答える', () => {
    const room = withCard(lifeRoom(), kikuWho);
    assert.strictEqual(L.lifeQuestionOf(room.game).phase, L.PHASE.WHO);
    assert.strictEqual(L.actingIndex(room, room.game), 0);
    assert.strictEqual(L.choose(room, 1, 1, 1, 0, 0, COUNTS, 3), null); // 自分
    assert.strictEqual(L.choose(room, 1, 1, 1, 3, 0, COUNTS, 3), null); // いない番号
    assert.strictEqual(L.reask(room, 1, 1, 1, 3, COUNTS), null); // 相手を選ぶ前は変える質問がない
    // 相手を選ぶと、質問が3枚出る
    const card = L.choose(room, 1, 1, 1, 2, 0, COUNTS, 3);
    let q = L.lifeQuestionOf(card.game);
    assert.strictEqual(q.phase, L.PHASE.CARD);
    assert.strictEqual(q.target, 2);
    assert.strictEqual(q.opts.length, 3);
    assert.strictEqual(new Set(q.opts).size, 3);
    assert.strictEqual(q.n, 2);
    assert.strictEqual(L.actingIndex(card, card.game), 0); // 選ぶのは聞く人
    assert.strictEqual(L.choose(card, 1, 1, 2, 3, 0, COUNTS, 3), null); // 4枚目はない
    // 3枚を引きなおせる
    const redraw = L.reask(card, 1, 1, 2, 9, COUNTS);
    assert.strictEqual(L.lifeQuestionOf(redraw.game).phase, L.PHASE.CARD);
    assert.strictEqual(L.lifeQuestionOf(redraw.game).opts.length, 3);
    assert.strictEqual(L.lifeQuestionOf(redraw.game).target, 2);
    // 1枚選ぶと、聞かれた人が答える番
    const answer = L.choose(card, 1, 1, 2, 1, 0, COUNTS, 3);
    q = L.lifeQuestionOf(answer.game);
    assert.strictEqual(q.phase, L.PHASE.ANSWER);
    assert.strictEqual(q.idx, L.lifeQuestionOf(card.game).opts[1]);
    assert.strictEqual(L.actingIndex(answer, answer.game), 2);
    assert.strictEqual(answer.game.turn, 0);
    // 押せるのは、聞かれた人の端末とホスト（聞いた人の端末は押せない）
    assert.strictEqual(L.canAct(answer, 'uM', 'みどり', 'guest'), true);
    assert.strictEqual(L.canAct(answer, 'uA', 'あお', 'guest'), false);
    assert.strictEqual(L.canAct(answer, 'uH', 'ホスト', 'host'), true);
    // 聞かれた人は、別の質問に変えられる
    const changed = L.reask(answer, 1, 1, 3, 5, COUNTS);
    assert.strictEqual(L.lifeQuestionOf(changed.game).phase, L.PHASE.ANSWER);
    assert.notStrictEqual(L.lifeQuestionOf(changed.game).idx, q.idx);
    // 答えると次の人の番。答えは、聞かれた人のものとして残る
    assert.strictEqual(L.choose(answer, 1, 1, 3, 4, 3, COUNTS), null);
    const done = L.choose(answer, 1, 1, 3, 0, 3, COUNTS);
    assert.strictEqual(done.game.turn, 1);
    assert.strictEqual(done.game.step, L.STEP.LIFE_ROLL);
    assert.deepStrictEqual(L.pickedOf(done.game, COUNTS), { life: true, kiku: true, by: 0, scene: 's1', idx: q.idx, turn: 2, choice: 0, text: '' });
    // 「自由に話す」でも答えられる
    assert.strictEqual(L.pickedOf(L.choose(answer, 1, 1, 3, L.CHOICE_FREE, 3, COUNTS).game, COUNTS).choice, L.CHOICE_FREE);
  });

  test('道中すごろく: みんなに聞いたときは、声やチャットで答えて「話せた！次の人へ」', () => {
    const room = withCard(lifeRoom(), kikuWho);
    const card = L.choose(room, 1, 1, 1, L.TARGET_ALL, 0, COUNTS, 3);
    assert.strictEqual(L.lifeQuestionOf(card.game).target, L.TARGET_ALL);
    const answer = L.choose(card, 1, 1, 2, 0, 0, COUNTS, 3);
    assert.strictEqual(L.lifeQuestionOf(answer.game).phase, L.PHASE.ANSWER);
    assert.strictEqual(L.actingIndex(answer, answer.game), 0); // 押すのは聞いた人
    assert.strictEqual(L.choose(answer, 1, 1, 3, 0, 3, COUNTS), null); // 選択肢は押せない
    const done = L.nextPlayer(answer, 1, 1);
    assert.strictEqual(done.game.turn, 1);
    assert.strictEqual(done.game.q, null);
  });

  test('道中すごろく: 1人で遊ぶときの きく は、そばにいる人へ（質問を選ぶところから）', () => {
    const solo = lifeRoom({ players: { 'ホスト': { isHost: true, uid: 'uH', joinedAt: 1 } } });
    assert.strictEqual(L.boardSize(solo.game), 28);
    let found = false;
    for (let seed = 1; seed <= 80 && !found; seed++) {
      const next = rollAndPick(solo, seed);
      const q = L.lifeQuestionOf(next.game);
      if (q.kind === 'kiku') {
        found = true;
        assert.strictEqual(q.target, L.TARGET_NEAR);
        assert.strictEqual(q.phase, L.PHASE.CARD);
        assert.strictEqual(q.opts.length, 3);
      }
    }
    assert.ok(found);
  });

  test('道中すごろく: できごとは変えられない（別の質問・選ぶ）', () => {
    const ev = withCard(lifeRoom(), { kind: 'dekigoto', idx: 0, n: 1 });
    assert.strictEqual(L.reask(ev, 1, 1, 1, 5, COUNTS), null);
    assert.strictEqual(L.choose(ev, 1, 1, 1, 0, 3, COUNTS), null);
  });

  test('道中すごろく: できごと（進む・みんな進む・もう一度・ひと息）', () => {
    const base = lifeRoom();
    const move = L.nextPlayer(withCard(base, { kind: 'dekigoto', idx: 0, n: 1 }, [5, 0, 0]), 1, 1);
    assert.deepStrictEqual(move.game.pos, [7, 0, 0]);
    assert.strictEqual(move.game.turn, 1);
    assert.strictEqual(move.game.step, L.STEP.LIFE_ROLL);
    const all = L.nextPlayer(withCard(base, { kind: 'dekigoto', idx: 1, n: 1 }, [5, 2, 9]), 1, 1);
    assert.deepStrictEqual(all.game.pos, [6, 3, 10]);
    assert.strictEqual(all.game.turn, 1);
    const again = L.nextPlayer(withCard(base, { kind: 'dekigoto', idx: 2, n: 1 }, [5, 2, 9]), 1, 1);
    assert.deepStrictEqual(again.game.pos, [5, 2, 9]);
    assert.strictEqual(again.game.turn, 0);
    assert.strictEqual(again.game.step, L.STEP.LIFE_ROLL);
    const rest = L.nextPlayer(withCard(base, { kind: 'dekigoto', idx: 3, n: 1 }, [5, 2, 9]), 1, 1);
    assert.deepStrictEqual(rest.game.pos, [5, 2, 9]);
    assert.strictEqual(rest.game.turn, 1);
    // 二度押しは進めない
    assert.strictEqual(L.nextPlayer(move, 1, 1), null);
  });

  test('道中すごろく: ゴールした人の番は「おうえん」（だれかを1マス進める）・みんな着いたらおわり', () => {
    const base = lifeRoom(); // 24マス
    // できごとでゴールに着く
    const one = L.nextPlayer(withCard(base, { kind: 'dekigoto', idx: 0, n: 1 }, [22, 3, 4]), 1, 1);
    assert.deepStrictEqual(one.game.pos, [23, 3, 4]);
    assert.deepStrictEqual(one.game.done, [true, false, false]);
    assert.deepStrictEqual(one.game.arrived.who, [0]);
    assert.strictEqual(one.status, L.STATUS.PLAYING);
    assert.strictEqual(one.game.turn, 1);
    // ゴールした人にも番が回る
    const t2 = L.nextPlayer(withCard(one, { kind: 'dekigoto', idx: 3, n: 1 }), 1, 1);
    assert.strictEqual(t2.game.turn, 2);
    const t3 = L.nextPlayer(withCard(t2, { kind: 'dekigoto', idx: 3, n: 1 }), 1, 1);
    assert.strictEqual(t3.game.turn, 0);
    assert.strictEqual(L.doneOf(t3.game, 0), true);
    // その番はサイコロを振れず、おうえんする
    assert.strictEqual(L.roll(t3, 1, 1, 7, COUNTS), null);
    assert.strictEqual(L.cheer(t3, 1, 1, 0), null); // ゴールした人は選べない
    assert.strictEqual(L.cheer(t3, 1, 1, 5), null);
    assert.strictEqual(L.cheer(t3, 1, 0, 1), null); // 古い画面
    const cheered = L.cheer(t3, 1, 1, 1);
    assert.deepStrictEqual(cheered.game.pos, [23, 4, 4]);
    assert.strictEqual(cheered.game.turn, 1);
    assert.strictEqual(cheered.game.rollNo, 2);
    assert.deepStrictEqual(cheered.game.last, { dice: 1, from: 3, to: 4, turn: 1, quick: true, cheerBy: 0 });
    assert.strictEqual(L.cheer(cheered, 1, 1, 2), null); // 二度押し
    // まだゴールしていない人は、おうえんできない
    assert.strictEqual(L.cheer(cheered, 1, 2, 2), null);
    // おうえんでゴールに着く・みんな着いたらおわり
    const last = { ...base, game: { ...base.game, pos: [23, 22, 23], done: [true, false, true], turn: 0, rollNo: 4 } };
    const end = L.cheer(last, 1, 4, 1);
    assert.strictEqual(end.status, L.STATUS.GOAL);
    assert.strictEqual(end.game.winner, null);
    assert.deepStrictEqual(end.game.pos, [23, 23, 23]);
    // サイコロでゴール: ゴールでとまる
    const near = { ...base, game: { ...base.game, pos: [23, 22, 23], done: [true, false, true], turn: 1 } };
    const goal = rollAndPick(near, 7);
    assert.strictEqual(goal.status, L.STATUS.GOAL);
    assert.deepStrictEqual(goal.game.pos, [23, 23, 23]);
    // みんな1マス進むで、いっしょにゴール
    const both = L.nextPlayer(withCard(base, { kind: 'dekigoto', idx: 1, n: 1 }, [22, 22, 22]), 1, 1);
    assert.strictEqual(both.status, L.STATUS.GOAL);
  });

  test('道中すごろく: ゴールした順（places）・同時に着いたら同じ順位・順位を出すかは「はじめる」の時点で固定', () => {
    const base = lifeRoom(); // 24マス
    assert.deepStrictEqual(base.game.places, [0, 0, 0]);
    assert.strictEqual(L.showsRank(base.game), false); // はじめは出さない
    const one = L.nextPlayer(withCard(base, { kind: 'dekigoto', idx: 0, n: 1 }, [22, 3, 4]), 1, 1);
    assert.deepStrictEqual(one.game.places, [1, 0, 0]);
    assert.strictEqual(L.placeOf(one.game, 0), 1);
    // みんな進むできごとで、2人がいっしょに着く → 2人とも2位
    const tie = { ...base, game: { ...base.game, pos: [23, 22, 22], done: [true, false, false], places: [1, 0, 0] } };
    const end = L.nextPlayer(withCard(tie, { kind: 'dekigoto', idx: 1, n: 1 }, [23, 22, 22]), 1, 1);
    assert.strictEqual(end.status, L.STATUS.GOAL);
    assert.deepStrictEqual(end.game.places, [1, 2, 2]);
    // 着いた人の順位は、あとで変わらない
    assert.strictEqual(L.placeOf({ places: { 2: 3 } }, 2), 3); // RTDB の数値キーの形
    assert.strictEqual(L.placeOf({ places: { 2: 'x' } }, 2), 0);
    // 順位を出す設定
    const ranked = L.startGame(waitingRoom({ mode: L.MODE.LIFE, rank: true }), COUNTS);
    assert.strictEqual(L.showsRank(ranked.game), true);
    assert.strictEqual(L.showsRank(L.startGame(waitingRoom({ rank: true }), COUNTS).game), false); // 今までの遊び方には出さない
  });

  test('道中すごろく: 壊れたカード・選んだものは読み飛ばす', () => {
    const room = lifeRoom();
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'erabu', scene: 's0', idx: 4, n: 1 }).game), null); // 範囲の外
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'kiku', scene: 'x', n: 1 }).game), null);
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'dekigoto', idx: 9, n: 1 }).game), null);
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'map', idx: 0, n: 1 }).game), null);
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'hanasu', scene: 's0', idx: 0, n: 1 }).game), null); // なくした種類
    // きく: 相手の番号が外なら、相手を選ぶところから。相手はいるのに質問がなければ読めない
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'kiku', scene: 's0', n: 1, target: 9, opts: [0, 1, 2] }).game).phase, L.PHASE.WHO);
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'kiku', scene: 's0', n: 1, target: 0, opts: [0, 1, 2] }).game).phase, L.PHASE.WHO); // 自分
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'kiku', scene: 's0', n: 1, target: 1 }).game), null);
    // 答える段階なのに質問の番号がおかしければ、質問を選ぶところにもどる
    assert.strictEqual(L.lifeQuestionOf(withCard(room, { kind: 'kiku', scene: 's0', n: 1, target: 1, phase: 'answer', idx: 99, opts: [0, 1, 9] }).game).phase, L.PHASE.CARD);
    assert.deepStrictEqual(L.lifeQuestionOf(withCard(room, { kind: 'kiku', scene: 's0', n: 1, target: 1, opts: [0, 1, 9, 1] }).game).opts, [0, 1]);
    assert.strictEqual(L.pickedOf({ ...room.game, picked: { life: true, scene: 's0', idx: 4, turn: 0, choice: 0 } }, COUNTS), null);
    assert.strictEqual(L.pickedOf({ ...room.game, picked: { life: true, kiku: true, scene: 's0', idx: 5, turn: 0, choice: 0 } }, COUNTS), null);
    // 今までの遊び方のルームでは、道中すごろくのカードは読まない
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.strictEqual(L.lifeQuestionOf(withCard(theme, { kind: 'erabu', scene: 's0', idx: 0, n: 1 }).game), null);
  });

  test('道中すごろく: 段階の名前は今までの遊び方と分ける（古い版の画面からの操作を通さない）', () => {
    const room = lifeRoom();
    assert.strictEqual(room.game.step, 'life5-roll');
    assert.ok(L.isRollStep(room.game));
    // 古い版が見る名前（roll / talk）になっていたら、振れない・進めない
    assert.strictEqual(L.roll({ ...room, game: { ...room.game, step: 'roll' } }, 1, 0, 3, COUNTS), null);
    assert.strictEqual(L.nextPlayer({ ...room, game: { ...room.game, step: 'talk', rollNo: 1, q: { kind: 'erabu', scene: 's0', idx: 2, n: 1 } } }, 1, 1), null);
    // 今までの遊び方は roll / talk のまま
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.strictEqual(theme.game.step, 'roll');
    assert.strictEqual(L.roll({ ...theme, game: { ...theme.game, step: 'life5-roll' } }, 1, 0, 3, COUNTS), null);
    assert.strictEqual(L.isPickStep({ ...theme.game, step: 'life5-pick' }), false);
  });

  test('道中すごろく: 番の人がいなくなったとき（できごとは確定しない・選びかけの目は捨てる）', () => {
    const base = lifeRoom();
    const card = withCard(base, { kind: 'dekigoto', idx: 1, n: 1 }, [22, 22, 22]); // みんな1マス進む
    const next = L.dropTalk(card);
    assert.deepStrictEqual(next.game.pos, [22, 22, 22]);
    assert.strictEqual(next.status, L.STATUS.PLAYING);
    assert.strictEqual(next.game.turn, 1);
    assert.strictEqual(next.game.step, 'life5-roll');
    assert.strictEqual(next.game.q, null);
    assert.strictEqual(L.dropTalk(base), null); // サイコロを振る段階では何もしない
    // 進む目を選んでいる途中でいなくなったら、その目は捨てて次の人へ
    const picking = { ...base, game: { ...base.game, step: 'life5-pick', dice: [2, 5] } };
    assert.strictEqual(L.skipAbsent(picking), null); // いるうちはとばさない
    const { 'ホスト': _h, ...rest } = picking.players;
    const skipped = L.skipAbsent({ ...picking, players: rest });
    assert.strictEqual(skipped.game.turn, 1);
    assert.strictEqual(skipped.game.step, 'life5-roll');
    assert.strictEqual(skipped.game.dice, null);
    // ゴールした人は、いるかぎりとばさない（おうえんの番）
    const done = { ...base, game: { ...base.game, pos: [23, 3, 4], done: [true, false, false], turn: 0 } };
    assert.strictEqual(L.skipAbsent(done), null);
    // 今までの遊び方でも dropTalk は使える
    const theme = L.roll(L.startGame(waitingRoom(), COUNTS), 1, 0, 3, COUNTS);
    const dropped = L.dropTalk(theme);
    assert.strictEqual(dropped.game.step, 'roll');
    assert.strictEqual(dropped.game.turn, 1);
  });

  test('道中すごろく: 読めないカードで止まったら立て直せる（talkBroken → dropTalk）', () => {
    const base = lifeRoom();
    const broken = withCard(base, { kind: 'map', idx: 0, n: 1 });
    assert.strictEqual(L.talkBroken(broken.game, COUNTS), true);
    assert.strictEqual(L.talkBroken({ ...broken.game, q: null }, COUNTS), true);
    assert.strictEqual(L.talkBroken(withCard(base, { kind: 'erabu', scene: 's0', idx: 2, n: 1 }).game, COUNTS), false);
    assert.strictEqual(L.talkBroken(withCard(base, kikuWho).game, COUNTS), false);
    assert.strictEqual(L.talkBroken(base.game, COUNTS), false);
    assert.strictEqual(L.dropTalk(broken).game.turn, 1);
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.strictEqual(L.talkBroken({ ...theme.game, step: 'talk', q: { theme: 'zzz', idx: 0, n: 1 } }, COUNTS), true);
  });

  test('道中すごろく: ゴールの印は道中すごろくだけで見る・添字の欠けた形でもずれない', () => {
    const theme = L.startGame(waitingRoom(), COUNTS);
    const odd = { ...theme, game: { ...theme.game, done: [false, true, false] } };
    assert.strictEqual(L.doneOf(odd.game, 1), false);
    const base = lifeRoom();
    const sparse = { ...base.game, done: { 2: true } }; // RTDB の数値キーの形
    assert.strictEqual(L.doneOf(sparse, 0), false);
    assert.strictEqual(L.doneOf(sparse, 2), true);
    assert.strictEqual(L.doneOf({ ...base.game, done: 'x' }, 0), false);
    assert.strictEqual(L.doneOf({ ...base.game, done: null }, 0), false);
  });

  test('道中すごろく: きく の相手は、いまいる人だけ。相手がいなくなったら選びなおせる', () => {
    const base = lifeRoom();
    const card = withCard(base, kikuWho);
    const { 'みどり': _gone, ...rest } = card.players;
    const without = { ...card, players: rest };
    assert.strictEqual(L.choose(without, 1, 1, 1, 2, 0, COUNTS, 3), null); // いない人は選べない
    assert.ok(L.choose(without, 1, 1, 1, 1, 0, COUNTS, 3));
    // 質問を選んだあとで、相手がいなくなった
    const picked = L.choose(L.choose(card, 1, 1, 1, 2, 0, COUNTS, 3), 1, 1, 2, 0, 0, COUNTS, 3);
    assert.strictEqual(L.actingIndex(picked, picked.game), 2);
    const left = { ...picked, players: rest };
    assert.strictEqual(L.targetGone(left, left.game, L.lifeQuestionOf(left.game)), true);
    assert.strictEqual(L.actingIndex(left, left.game), 0); // 押す人は、聞いた人にもどる
    assert.strictEqual(L.canAct(left, 'uH', 'ホスト', 'host'), true);
    // 選びなおすと、質問を選ぶところから
    const again = L.choose(left, 1, 1, 3, 1, 0, COUNTS, 5);
    assert.strictEqual(L.lifeQuestionOf(again.game).target, 1);
    assert.strictEqual(L.lifeQuestionOf(again.game).phase, L.PHASE.CARD);
    assert.strictEqual(L.lifeQuestionOf(again.game).idx, null);
  });

  test('道中すごろく: 前の版が作ったゲームは見分けて、この版の操作を通さない', () => {
    const room = lifeRoom();
    assert.strictEqual(room.game.step, 'life5-roll');
    assert.strictEqual(L.isOldLife(room.game), false);
    for (const step of ['life-roll', 'life-talk', 'life2-roll', 'life2-pick', 'life2-talk', 'life3-roll', 'life3-pick', 'life3-talk', 'life4-roll', 'life4-pick', 'life4-talk', 'roll', 'talk', 'zzz', '', null, 7]) { // 前の版の名前と、知らない値
      const old = { ...room, game: { ...room.game, step, rollNo: 1, q: { kind: 'hanasu', scene: 's0', idx: 2, n: 1 } } };
      assert.strictEqual(L.isOldLife(old.game), true);
      assert.strictEqual(L.isRollStep(old.game), false);
      assert.strictEqual(L.isTalkStep(old.game), false);
      assert.strictEqual(L.roll(old, 1, 1, 3, COUNTS), null);
      assert.strictEqual(L.nextPlayer(old, 1, 1), null);
      assert.strictEqual(L.dropTalk(old), null);
      assert.strictEqual(L.talkBroken(old.game, COUNTS), false);
      assert.ok(L.backToWaiting(old, 1)); // ホストは待合室にもどせる
    }
    // 今までの遊び方のゲームは、前の版のゲームと見なさない
    assert.strictEqual(L.isOldLife(L.startGame(waitingRoom(), COUNTS).game), false);
  });

  test('道中すごろく: 進む目が読めないときは、振りなおすところにもどせる', () => {
    const base = lifeRoom();
    const pick = (dice) => ({ ...base, game: { ...base.game, step: 'life5-pick', dice } });
    assert.deepStrictEqual(L.pickDice(pick([2, 5]).game), [2, 5]);
    assert.deepStrictEqual(L.pickDice(pick({ 0: 2, 1: 5 }).game), [2, 5]); // RTDB の数値キーの形
    for (const bad of [null, undefined, [3], [3, 3], [0, 4], [2, 7], { 1: 5 }, 'x', [2, 'a'], [true, 2], ['3', 4]]) {
      const room = pick(bad);
      assert.strictEqual(L.pickDice(room.game), null);
      assert.strictEqual(L.pickBroken(room.game), true);
      assert.strictEqual(L.pickDie(room, 1, 0, 0, 3), null);
      const fixed = L.dropPick(room);
      assert.strictEqual(fixed.game.step, 'life5-roll');
      assert.strictEqual(fixed.game.turn, 0); // 同じ人が振りなおす
      assert.strictEqual(fixed.game.dice, null);
    }
    assert.strictEqual(L.pickBroken(pick([2, 5]).game), false);
    assert.strictEqual(L.dropPick(pick([2, 5])), null);
    assert.strictEqual(L.pickBroken(base.game), false);
  });

  test('道中すごろく: おうえんの相手は、いまいる人だけ', () => {
    const base = lifeRoom();
    const done = { ...base, game: { ...base.game, pos: [23, 3, 4], done: [true, false, false], turn: 0, rollNo: 2 } };
    assert.deepStrictEqual(L.cheerTargets(done, done.game), [1, 2]);
    const { 'みどり': _gone, ...rest } = done.players;
    const without = { ...done, players: rest };
    assert.deepStrictEqual(L.cheerTargets(without, without.game), [1]);
    assert.strictEqual(L.cheer(without, 1, 2, 2), null); // いない人は進められない
    assert.ok(L.cheer(without, 1, 2, 1));
    // まだゴールしていない人がだれもいないときは、おうえんできない（いる人だけでゲームを終わらせない）
    const alone = { ...done, players: { 'ホスト': done.players['ホスト'] } };
    assert.deepStrictEqual(L.cheerTargets(alone, alone.game), []);
    assert.strictEqual(L.cheer(alone, 1, 2, 1), null);
    assert.strictEqual(L.cheer(alone, 1, 2, 2), null);
  });

  /* ── みんなが同時に選ぶマス（いっしょ・よそう） ── */
  const voteCard = (kind, room = lifeRoom(), turn = 1) => ({ ...withCard(room, { kind, scene: 's0', idx: 1, n: 1 }), game: { ...withCard(room, { kind, scene: 's0', idx: 1, n: 1 }).game, turn } });

  test('みんなで選ぶマス: ルームで2人以上のときだけ盤に出る', () => {
    const room = lifeRoom();
    assert.strictEqual(room.game.votes, true);
    const kinds = L.lifeKindsOf(room.game);
    assert.ok(kinds.includes('issho') && kinds.includes('yosou'));
    assert.deepStrictEqual(L.lifeKinds(12, true).slice(1, 11), ['erabu', 'kiku', 'issho', 'dekigoto', 'erabu', 'yosou', 'kiku', 'minna', 'dekigoto', 'issho']);
    // 1人のルームと、1台の画面（通信しないルーム）には出ない
    const solo = lifeRoom({ players: { 'ホスト': { isHost: true, uid: 'uH', joinedAt: 1 } } });
    assert.strictEqual(solo.game.votes, undefined);
    assert.ok(!L.lifeKindsOf(solo.game).includes('issho'));
    const offline = lifeRoom({ offline: true });
    assert.strictEqual(offline.game.votes, undefined);
    assert.ok(!L.lifeKindsOf(offline.game).some((k) => L.isVoteKind(k)));
    // 止まると、質問つきのカードが出る（まだだれも選んでいない・開いていない）
    let seen = false;
    for (let seed = 1; seed <= 120 && !seen; seed++) {
      const next = rollAndPick(room, seed);
      const q = L.lifeQuestionOf(next.game);
      if (L.isVoteKind(q.kind)) {
        seen = true;
        assert.deepStrictEqual(q.votes, {});
        assert.strictEqual(q.open, false);
        assert.ok(Number.isInteger(q.idx));
      }
    }
    assert.ok(seen);
  });

  test('みんなで選ぶマス: 自分のぶんだけ選べる。ホストは、自分・端末のない人・つながっていない人のぶん', () => {
    const room = voteCard('issho', lifeRoom({ proxies: { 'きいろ': { joinedAt: 4 } } }));
    // 順番: ホスト0・あお1・みどり2・きいろ3（端末なし）
    assert.strictEqual(L.canVote(room, 'uA', 'あお', 'guest', 1), true);
    assert.strictEqual(L.canVote(room, 'uA', 'あお', 'guest', 2), false);
    assert.strictEqual(L.canVote(room, 'uA', 'あお', 'guest', 3), false);
    assert.strictEqual(L.canVote(room, 'uX', 'あお', 'guest', 1), false); // ちがう端末
    assert.strictEqual(L.canVote(room, 'uH', 'ホスト', 'host', 0), true);
    assert.strictEqual(L.canVote(room, 'uH', 'ホスト', 'host', 3), true); // 端末のない人
    assert.strictEqual(L.canVote(room, 'uH', 'ホスト', 'host', 1), false); // つながっている人のぶんは本人
    assert.strictEqual(L.canVote(room, 'uH', 'ホスト', 'host', 9), false);
    const { 'あお': _a, ...rest } = room.players;
    assert.strictEqual(L.canVote({ ...room, players: rest }, 'uH', 'ホスト', 'host', 1), true); // つながっていない人
    // 進行だけのホストは、自分のぶんがない
    const hostOnly = voteCard('issho', lifeRoom({ hostPlays: false }), 0);
    assert.deepStrictEqual(L.orderOf(hostOnly.game), ['あお', 'みどり']);
    assert.strictEqual(L.canVote(hostOnly, 'uH', 'ホスト', 'host', 0), false);
    // みんなで選ぶマスでないとき・開いたあとは選べない
    assert.strictEqual(L.canVote(withCard(lifeRoom(), { kind: 'erabu', scene: 's0', idx: 1, n: 1 }), 'uA', 'あお', 'guest', 1), false);
    const opened = { ...room, game: { ...room.game, q: { ...room.game.q, open: true } } };
    assert.strictEqual(L.canVote(opened, 'uA', 'あお', 'guest', 1), false);
  });

  test('みんなで選ぶマス: みんな選んだら開く。開くまでは選びなおせる', () => {
    const room = voteCard('issho');
    assert.strictEqual(L.vote(room, 1, 1, 1, 1, 3), null); // 3択の外
    assert.strictEqual(L.vote(room, 1, 1, 1, 9, 0), null);
    assert.strictEqual(L.vote(room, 1, 1, 2, 1, 0), null); // 古い質問
    let r = L.vote(room, 1, 1, 1, 1, 0);
    assert.deepStrictEqual(L.lifeQuestionOf(r.game).votes, { 1: 0 });
    assert.strictEqual(L.lifeQuestionOf(r.game).open, false);
    r = L.vote(r, 1, 1, 1, 1, 2); // 選びなおし
    assert.deepStrictEqual(L.lifeQuestionOf(r.game).votes, { 1: 2 });
    r = L.vote(r, 1, 1, 1, 0, 2);
    assert.strictEqual(L.lifeQuestionOf(r.game).open, false);
    assert.strictEqual(L.nextPlayer(r, 1, 1), null); // 開く前には進めない
    r = L.vote(r, 1, 1, 1, 2, 1);
    assert.strictEqual(L.lifeQuestionOf(r.game).open, true); // 3人とも選んだ
    assert.strictEqual(L.vote(r, 1, 1, 1, 2, 0), null); // 開いたあとは選べない
    assert.strictEqual(L.reask(r, 1, 1, 1, 5, COUNTS), null); // 開いたあとは質問を変えられない
    // いない人のぶんは待たない
    const { 'みどり': _m, ...rest } = room.players;
    let two = L.vote({ ...room, players: rest }, 1, 1, 1, 1, 0);
    two = L.vote(two, 1, 1, 1, 0, 0);
    assert.strictEqual(L.lifeQuestionOf(two.game).open, true);
    // 番の人かホストが、先に開ける
    const early = L.openVotes(L.vote(room, 1, 1, 1, 1, 0), 1, 1, 1);
    assert.strictEqual(L.lifeQuestionOf(early.game).open, true);
    assert.strictEqual(L.openVotes(early, 1, 1, 1), null);
    // 別の質問にすると、選んだものは消える
    const re = L.reask(L.vote(room, 1, 1, 1, 1, 0), 1, 1, 1, 5, COUNTS);
    assert.deepStrictEqual(L.lifeQuestionOf(re.game).votes, {});
    assert.notStrictEqual(L.lifeQuestionOf(re.game).idx, 1);
    assert.strictEqual(L.lifeQuestionOf(re.game).n, 2);
  });

  test('いっしょ: 番の人と同じだった人が1マス。みんな同じなら、みんなもう1マス', () => {
    const base = voteCard('issho'); // 番は あお（1）
    const withVotes = (votes, pos) => ({ ...base, game: { ...base.game, pos: pos || [3, 4, 5], q: { ...base.game.q, votes, open: true } } });
    let room = withVotes({ 0: 2, 1: 2, 2: 0 });
    let res = L.voteResult(room.game, L.lifeQuestionOf(room.game));
    assert.deepStrictEqual(res, { answer: 2, same: [0], all: false, moves: { 0: 1 } });
    let next = L.nextPlayer(room, 1, 1);
    assert.deepStrictEqual(next.game.pos, [4, 4, 5]);
    assert.strictEqual(next.game.turn, 2);
    assert.strictEqual(next.game.step, 'life5-roll');
    assert.strictEqual(L.nextPlayer(next, 1, 1), null); // 二度押し
    // みんな同じ
    room = withVotes({ 0: 1, 1: 1, 2: 1 });
    res = L.voteResult(room.game, L.lifeQuestionOf(room.game));
    assert.strictEqual(res.all, true);
    assert.deepStrictEqual(res.moves, { 0: 2, 1: 1, 2: 2 });
    assert.deepStrictEqual(L.nextPlayer(room, 1, 1).game.pos, [5, 5, 7]);
    // だれも同じでない・番の人が選んでいない
    assert.deepStrictEqual(L.voteResult(withVotes({ 0: 0, 1: 1, 2: 2 }).game, L.lifeQuestionOf(withVotes({ 0: 0, 1: 1, 2: 2 }).game)).moves, {});
    room = withVotes({ 0: 0, 2: 0 });
    assert.deepStrictEqual(L.voteResult(room.game, L.lifeQuestionOf(room.game)), { answer: null, same: [], all: false, moves: {} });
    assert.deepStrictEqual(L.nextPlayer(room, 1, 1).game.pos, [3, 4, 5]);
    // 1人しか選んでいないときは、「みんな同じ」にしない
    assert.strictEqual(L.voteResult(withVotes({ 1: 0 }).game, L.lifeQuestionOf(withVotes({ 1: 0 }).game)).all, false);
    // 進んでゴールに着く・ゴールした人は進まない
    room = withVotes({ 0: 1, 1: 1, 2: 1 }, [22, 5, 23]);
    room = { ...room, game: { ...room.game, done: [false, false, true] } };
    next = L.nextPlayer(room, 1, 1);
    assert.deepStrictEqual(next.game.pos, [23, 6, 23]);
    assert.deepStrictEqual(next.game.done, [true, false, true]);
    assert.deepStrictEqual(next.game.arrived.who, [0]);
  });

  test('よそう: 番の人の答えを当てた人が1マス。当ててもらえたら番の人も1マス', () => {
    const base = voteCard('yosou');
    const withVotes = (votes) => ({ ...base, game: { ...base.game, pos: [3, 4, 5], q: { ...base.game.q, votes, open: true } } });
    let room = withVotes({ 0: 2, 1: 2, 2: 0 });
    assert.deepStrictEqual(L.voteResult(room.game, L.lifeQuestionOf(room.game)), { answer: 2, same: [0], all: false, moves: { 0: 1, 1: 1 } });
    assert.deepStrictEqual(L.nextPlayer(room, 1, 1).game.pos, [4, 5, 5]);
    // みんな当てても、おまけはない（1マスずつ）
    room = withVotes({ 0: 1, 1: 1, 2: 1 });
    assert.deepStrictEqual(L.voteResult(room.game, L.lifeQuestionOf(room.game)).moves, { 0: 1, 2: 1, 1: 1 });
    // だれも当たらなければ、だれも進まない
    room = withVotes({ 0: 0, 1: 1, 2: 2 });
    assert.deepStrictEqual(L.nextPlayer(room, 1, 1).game.pos, [3, 4, 5]);
  });

  test('みんなで選ぶマス: 壊れた値は読み飛ばす・番の人がいなくなったら捨てられる', () => {
    const base = voteCard('issho');
    const q = (votes) => L.lifeQuestionOf({ ...base.game, q: { ...base.game.q, votes } });
    assert.deepStrictEqual(q({ 0: 1, 1: 5, 2: 'a', 7: 0, x: 1 }).votes, { 0: 1 });
    assert.deepStrictEqual(q([1, null, 2]).votes, { 0: 1, 2: 2 }); // 配列で返ってきても読める
    assert.deepStrictEqual(q('zzz').votes, {});
    assert.deepStrictEqual(q([true, 1]).votes, { 1: 1 });
    assert.strictEqual(L.lifeQuestionOf({ ...base.game, q: { kind: 'issho', scene: 's0', idx: 99, n: 1 } }), null);
    assert.strictEqual(L.talkBroken({ ...base.game, q: { kind: 'issho', scene: 's0', idx: 99, n: 1 } }, COUNTS), true);
    // 番の人の退出: 選んだものは確定させず、だれも進まない
    const voted = L.vote(L.vote(base, 1, 1, 1, 1, 0), 1, 1, 1, 0, 0);
    const dropped = L.dropTalk(voted);
    assert.deepStrictEqual(dropped.game.pos, voted.game.pos);
    assert.strictEqual(dropped.game.q, null);
    // 押せる人（開く・進む・別の質問）は、番の人とホスト
    assert.strictEqual(L.canAct(base, 'uA', 'あお', 'guest'), true);
    assert.strictEqual(L.canAct(base, 'uM', 'みどり', 'guest'), false);
    assert.strictEqual(L.canAct(base, 'uH', 'ホスト', 'host'), true);
  });

  test('みんなで選ぶマス: まだの人がいなくなって、いる人がみんな選んだ形になったら開ける', () => {
    const base = voteCard('issho');
    const two = L.vote(L.vote(base, 1, 1, 1, 1, 0), 1, 1, 1, 0, 0); // みどりだけ、まだ
    assert.strictEqual(L.votesComplete(two, two.game), false);
    assert.strictEqual(L.openIfComplete(two), null);
    const { 'みどり': _m, ...rest } = two.players;
    const left = { ...two, players: rest };
    assert.strictEqual(L.votesComplete(left, left.game), true);
    const opened = L.openIfComplete(left);
    assert.strictEqual(L.lifeQuestionOf(opened.game).open, true);
    assert.strictEqual(L.votesComplete(opened, opened.game), false); // もう開いている
    assert.strictEqual(L.openIfComplete(opened), null);
    // だれもいないとき・みんなで選ぶマスでないときは開かない
    assert.strictEqual(L.votesComplete({ ...base, players: {} }, base.game), false);
    const erabu = withCard(lifeRoom(), { kind: 'erabu', scene: 's0', idx: 1, n: 1 });
    assert.strictEqual(L.votesComplete(erabu, erabu.game), false);
  });

  test('位置は順番の番号で読む（途中の欠けた形で返っても、人がずれない）', () => {
    const base = voteCard('issho');
    const sparse = { ...base.game, pos: { 0: 3, 2: 5 } }; // 2人目の位置が欠けている
    assert.deepStrictEqual([0, 1, 2].map((i) => L.posOf(sparse, i)), [3, 0, 5]);
    assert.deepStrictEqual([0, 1, 2].map((i) => L.posOf({ ...base.game, pos: [3, null, 5] }, i)), [3, 0, 5]);
    assert.deepStrictEqual([0, 1].map((i) => L.posOf({ ...base.game, pos: 'x' }, i)), [0, 0]);
    assert.deepStrictEqual([0, 1].map((i) => L.posOf({ ...base.game, pos: null }, i)), [0, 0]);
    // 欠けた形のまま結果を確かめても、ほかの人の位置を書きかえない
    const room = { ...base, game: { ...sparse, q: { ...base.game.q, votes: { 0: 1, 1: 1, 2: 0 }, open: true } } };
    assert.deepStrictEqual(L.nextPlayer(room, 1, 1).game.pos, [4, 0, 5]);
    // 今までの遊び方でも同じ
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.deepStrictEqual([0, 1, 2].map((i) => L.posOf({ ...theme.game, pos: { 0: 2, 2: 7 } }, i)), [2, 0, 7]);
  });

  /* ── 書いて答える・おたすけカード・みんなで ── */
  test('書いて答える: 「自由に話す」のときだけ、短い文を添えられる（どちらの遊び方も）', () => {
    assert.strictEqual(L.cleanText('  ねこ\tが\n好き  '), 'ねこ が 好き');
    assert.strictEqual(L.cleanText('あ'.repeat(40)).length, 30);
    assert.strictEqual(L.cleanText(null), '');
    assert.strictEqual(L.cleanText(123), '');
    assert.strictEqual(L.cleanText({ a: 1 }), '');
    // 道中すごろくの「えらぶ」
    const room = withCard(lifeRoom(), { kind: 'erabu', scene: 's0', idx: 1, n: 1 });
    const free = L.choose(room, 1, 1, 1, L.CHOICE_FREE, 3, COUNTS, 0, ' ねこが好き ');
    assert.strictEqual(free.game.picked.text, 'ねこが好き');
    assert.strictEqual(L.pickedOf(free.game, COUNTS).text, 'ねこが好き');
    // 選択肢を選んだときは、文を持たない
    const picked = L.choose(room, 1, 1, 1, 0, 3, COUNTS, 0, 'いらない文');
    assert.strictEqual(picked.game.picked.text, undefined);
    assert.strictEqual(L.pickedOf(picked.game, COUNTS).text, '');
    // 書かなければ、今までどおり
    assert.strictEqual(L.choose(room, 1, 1, 1, L.CHOICE_FREE, 3, COUNTS, 0, '   ').game.picked.text, undefined);
    // 壊れた値は読まない・長すぎる文は切る
    assert.strictEqual(L.pickedOf({ ...free.game, picked: { ...free.game.picked, text: 99 } }, COUNTS).text, '');
    assert.strictEqual(L.pickedOf({ ...free.game, picked: { ...free.game.picked, text: 'あ'.repeat(99) } }, COUNTS).text.length, 30);
    // 今までの遊び方
    const theme = L.roll(L.startGame(waitingRoom(), COUNTS), 1, 0, 3, COUNTS);
    const t = L.choose(theme, 1, 1, 1, L.CHOICE_FREE, 3, COUNTS, 0, 'たのしい');
    assert.strictEqual(L.pickedOf(t.game, COUNTS).text, 'たのしい');
    // きく の答え
    const kiku = L.choose(L.choose(withCard(lifeRoom(), kikuWho), 1, 1, 1, 2, 0, COUNTS, 3), 1, 1, 2, 0, 0, COUNTS, 3);
    const answered = L.choose(kiku, 1, 1, 3, L.CHOICE_FREE, 3, COUNTS, 0, 'ひみつ');
    assert.strictEqual(L.pickedOf(answered.game, COUNTS).text, 'ひみつ');
  });

  test('おたすけカード: きく で答えてもらうと、聞いた人が1枚もらう（3枚まで）', () => {
    const base = lifeRoom();
    assert.strictEqual(L.cardsOf(base.game, 0), 0);
    const kiku = L.choose(L.choose(withCard(base, kikuWho), 1, 1, 1, 2, 0, COUNTS, 3), 1, 1, 2, 0, 0, COUNTS, 3);
    const answered = L.choose(kiku, 1, 1, 3, 1, 3, COUNTS);
    assert.strictEqual(L.cardsOf(answered.game, 0), 1); // 聞いた人
    assert.strictEqual(L.cardsOf(answered.game, 2), 0); // 答えた人はもらわない
    // みんなに聞いたときも、「話せた」でもらう
    const all = L.choose(L.choose(withCard(base, kikuWho), 1, 1, 1, L.TARGET_ALL, 0, COUNTS, 3), 1, 1, 2, 0, 0, COUNTS, 3);
    assert.strictEqual(L.cardsOf(L.nextPlayer(all, 1, 1).game, 0), 1);
    // 質問を選ぶ前に番を進めたら、もらえない
    const who = withCard(base, kikuWho);
    assert.strictEqual(L.cardsOf(L.nextPlayer(who, 1, 1).game, 0), 0);
    // 3枚まで
    const full = { ...kiku, game: { ...kiku.game, cards: { 0: 3 } } };
    assert.strictEqual(L.cardsOf(L.choose(full, 1, 1, 3, 1, 3, COUNTS).game, 0), 3);
    // 壊れた値は0枚・多すぎる値は3枚まで
    assert.strictEqual(L.cardsOf({ ...base.game, cards: { 0: 'x', 1: -2, 2: 99 } }, 0), 0);
    assert.strictEqual(L.cardsOf({ ...base.game, cards: { 0: 'x', 1: -2, 2: 99 } }, 1), 0);
    assert.strictEqual(L.cardsOf({ ...base.game, cards: { 0: 'x', 1: -2, 2: 99 } }, 2), 3);
    assert.strictEqual(L.cardsOf({ ...base.game, cards: 'zzz' }, 0), 0);
    // 今までの遊び方にはない
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.strictEqual(L.cardsOf({ ...theme.game, cards: { 0: 2 } }, 0), 0);
  });

  test('おたすけカード: 自分の番のサイコロの前に、ほかの人を2マス進める', () => {
    const base = lifeRoom();
    const room = { ...base, game: { ...base.game, pos: [3, 4, 5], cards: { 0: 2 }, rollNo: 2 } };
    assert.deepStrictEqual(L.helpTargets(room, room.game), [1, 2]);
    assert.strictEqual(L.useHelp(room, 1, 2, 0, 2), null); // 自分には使えない
    assert.strictEqual(L.useHelp(room, 1, 2, 9, 2), null);
    assert.strictEqual(L.useHelp(room, 1, 1, 1, 2), null); // 古い画面
    assert.strictEqual(L.useHelp(room, 1, 2, 1, 1), null); // 枚数がちがう（二度押し）
    const used = L.useHelp(room, 1, 2, 2, 2);
    assert.deepStrictEqual(used.game.pos, [3, 4, 7]);
    assert.strictEqual(L.cardsOf(used.game, 0), 1);
    assert.strictEqual(used.game.turn, 0); // 番はそのまま
    assert.strictEqual(used.game.step, 'life5-roll');
    assert.strictEqual(used.game.rollNo, 2);
    assert.strictEqual(L.useHelp(used, 1, 2, 2, 2), null); // 同じ押し方は通らない
    const again = L.useHelp(used, 1, 2, 1, 1);
    assert.deepStrictEqual(again.game.pos, [3, 6, 7]);
    assert.strictEqual(L.cardsOf(again.game, 0), 0);
    assert.strictEqual(L.useHelp(again, 1, 2, 1, 0), null); // もうない
    // そのあと、サイコロを振れる
    assert.ok(L.roll(again, 1, 2, 5, COUNTS));
    // いない人・ゴールした人には使えない
    const { 'みどり': _m, ...rest } = room.players;
    assert.deepStrictEqual(L.helpTargets({ ...room, players: rest }, room.game), [1]);
    assert.strictEqual(L.useHelp({ ...room, players: rest }, 1, 2, 2, 2), null);
    const done = { ...room, game: { ...room.game, pos: [3, 23, 5], done: [false, true, false] } };
    assert.deepStrictEqual(L.helpTargets(done, done.game), [2]);
    // ゴールした人の番（おうえん）・カードが出ている間は使えない
    const mine = { ...room, game: { ...room.game, pos: [23, 4, 5], done: [true, false, false] } };
    assert.strictEqual(L.useHelp(mine, 1, 2, 1, 2), null);
    assert.strictEqual(L.useHelp(withCard(room, { kind: 'erabu', scene: 's0', idx: 1, n: 1 }), 1, 1, 1, 2), null);
    // 進めた相手がゴールに着く・それでみんな着いたらおわり
    const near = { ...room, game: { ...room.game, pos: [3, 22, 5] } };
    const goal = L.useHelp(near, 1, 2, 1, 2);
    assert.deepStrictEqual(goal.game.pos, [3, 23, 5]);
    assert.deepStrictEqual(goal.game.done, [false, true, false]);
    assert.deepStrictEqual(goal.game.arrived.who, [1]);
    assert.strictEqual(goal.status, L.STATUS.PLAYING);
  });

  test('みんなで: 番の人から順に、ほかの人が選んでいないものを1つずつ。みんな選べたら1マス', () => {
    const base = lifeRoom();
    const room = { ...withCard(base, { kind: 'minna', scene: 's1', idx: 0, n: 1 }, [3, 4, 5]), };
    const game1 = { ...room.game, turn: 1 }; // 番は あお。順は あお → みどり → ホスト
    const r0 = { ...room, game: game1 };
    let q = L.lifeQuestionOf(r0.game);
    assert.deepStrictEqual(q.picks, {});
    assert.strictEqual(L.minnaPicker(r0, r0.game, q), 1);
    assert.strictEqual(L.actingIndex(r0, r0.game), 1);
    assert.strictEqual(L.canAct(r0, 'uA', 'あお', 'guest'), true);
    assert.strictEqual(L.canAct(r0, 'uM', 'みどり', 'guest'), false);
    assert.strictEqual(L.choose(r0, 1, 1, 1, 6, 0, COUNTS), null); // 選べるものの外
    assert.strictEqual(L.choose(r0, 1, 1, 1, L.CHOICE_FREE, 0, COUNTS), null);
    // お題は、だれかが選ぶ前なら変えられる
    assert.strictEqual(L.lifeQuestionOf(L.reask(r0, 1, 1, 1, 5, COUNTS).game).idx, 1);
    const r1 = L.choose(r0, 1, 1, 1, 2, 0, COUNTS);
    q = L.lifeQuestionOf(r1.game);
    assert.deepStrictEqual(q.picks, { 1: 2 });
    assert.strictEqual(q.n, 2); // 1人選ぶたびに進む
    // 同時に押した古いクリック（番の人が選ぶ前の番号）は、次の人のぶんとして入らない
    assert.strictEqual(L.choose(r1, 1, 1, 1, 4, 0, COUNTS), null);
    assert.strictEqual(L.minnaPicker(r1, r1.game, q), 2); // 次は みどり
    assert.strictEqual(L.canAct(r1, 'uM', 'みどり', 'guest'), true);
    assert.strictEqual(L.canAct(r1, 'uA', 'あお', 'guest'), false);
    assert.strictEqual(L.reask(r1, 1, 1, 2, 5, COUNTS), null); // 選んだあとは、お題を変えない
    assert.strictEqual(L.choose(r1, 1, 1, 2, 2, 0, COUNTS), null); // 同じものは選べない
    const r2 = L.choose(r1, 1, 1, 2, 0, 0, COUNTS);
    const r3 = L.choose(r2, 1, 1, 3, 5, 0, COUNTS);
    q = L.lifeQuestionOf(r3.game);
    assert.deepStrictEqual(q.picks, { 0: 5, 1: 2, 2: 0 });
    assert.strictEqual(L.minnaPicker(r3, r3.game, q), null);
    assert.strictEqual(L.actingIndex(r3, r3.game), 1); // 進めるのは番の人
    assert.strictEqual(L.choose(r3, 1, 1, 4, 1, 0, COUNTS), null); // みんな選んだあとは選べない
    const next = L.nextPlayer(r3, 1, 1);
    assert.deepStrictEqual(next.game.pos, [4, 5, 6]);
    assert.strictEqual(next.game.turn, 2);
    assert.strictEqual(next.game.step, 'life5-roll');
    // 途中で進めたら（ホストがとばしたとき）、だれも進まない
    assert.deepStrictEqual(L.nextPlayer(r1, 1, 1).game.pos, [3, 4, 5]);
    // いない人は待たない・ゴールした人は進まない
    const { 'みどり': _m, ...rest } = r1.players;
    const without = { ...r1, players: rest };
    assert.strictEqual(L.minnaPicker(without, without.game, L.lifeQuestionOf(without.game)), 0);
    const two = L.choose(without, 1, 1, 2, 4, 0, COUNTS);
    assert.strictEqual(L.minnaPicker(two, two.game, L.lifeQuestionOf(two.game)), null);
    const doneRoom = { ...two, game: { ...two.game, pos: [23, 4, 5], done: [true, false, false] } };
    assert.deepStrictEqual(L.nextPlayer(doneRoom, 1, 1).game.pos, [23, 5, 5]);
    // 壊れた値: 同じものを2人が持っていたら、あとの人のぶんは読まない
    const dup = L.lifeQuestionOf({ ...r0.game, q: { ...r0.game.q, picks: { 0: 1, 1: 1, 2: 9, 7: 0 } } });
    assert.deepStrictEqual(dup.picks, { 0: 1 });
    assert.strictEqual(L.lifeQuestionOf({ ...r0.game, q: { kind: 'minna', scene: 's1', idx: 2, n: 1 } }), null); // お題の外
    // 盤に出る（1台の画面にも）
    assert.ok(L.lifeKinds(12).includes('minna'));
    assert.ok(L.lifeKinds(12, true).includes('minna'));
  });

  test('みんなで: 選べるものが足りなくても止まらない・番の人が退出しても選んだものは残る', () => {
    const base = lifeRoom();
    // お題1 は選べるものが4個。ここでは3人なので足りるが、2個まで選ばれた形から、残りがなくなる場合を作る
    const room = { ...withCard(base, { kind: 'minna', scene: 's1', idx: 1, n: 1 }, [3, 4, 5]) };
    const four = lifeRoom({ proxies: { 'きいろ': { joinedAt: 4 }, 'しろ': { joinedAt: 5 } } }); // 5人
    const tight = withCard(four, { kind: 'minna', scene: 's1', idx: 1, n: 5, picks: { 0: 0, 1: 1, 2: 2, 3: 3 } });
    const tq = L.lifeQuestionOf(tight.game);
    assert.strictEqual(Object.keys(tq.picks).length, 4);
    assert.strictEqual(L.minnaPicker(tight, tight.game, tq), null); // 5人目は選べるものがないので、そこまでで終わり
    const moved = L.nextPlayer(tight, 1, 1);
    assert.deepStrictEqual(moved.game.pos, [1, 1, 1, 1, 0]); // 選んだ人だけ進む
    // 番の人が退出: 選んだものは残り、残った人で続く（通信が切れたときと同じ）
    const r1 = L.choose(room, 1, 1, 1, 2, 0, COUNTS); // ホスト（番の人）が選んだ
    const { 'ホスト': _h, ...rest } = r1.players;
    const left = L.leaveTalk({ ...r1, players: rest });
    assert.deepStrictEqual(L.lifeQuestionOf(left.game).picks, { 0: 2 });
    assert.strictEqual(L.minnaPicker(left, left.game, L.lifeQuestionOf(left.game)), 1);
    assert.strictEqual(left.game.turn, 0);
    // ほかのカードは、今までどおり中身を確定させずに次の人へ
    const ev = withCard(base, { kind: 'dekigoto', idx: 1, n: 1 }, [22, 22, 22]);
    const dropped = L.leaveTalk(ev);
    assert.deepStrictEqual(dropped.game.pos, [22, 22, 22]);
    assert.strictEqual(dropped.game.q, null);
    assert.strictEqual(dropped.game.turn, 1);
    // 今までの遊び方でも使える
    const theme = L.roll(L.startGame(waitingRoom(), COUNTS), 1, 0, 3, COUNTS);
    assert.strictEqual(L.leaveTalk(theme).game.step, 'roll');
  });

  test('書いて答える: 30文字は見た目の文字で数え、絵文字のとちゅうで切らない', () => {
    const face = '\u{1F600}'; // 1文字だが、内部では2つぶん
    assert.strictEqual([...L.cleanText(face.repeat(40))].length, 30);
    assert.strictEqual(L.cleanText('あ'.repeat(29) + face + 'い'), 'あ'.repeat(29) + face);
    assert.ok(!/[\uD800-\uDBFF]$/.test(L.cleanText('あ'.repeat(29) + face + 'い'))); // 片割れで終わらない
    assert.strictEqual(L.cleanText('  ' + 'あ'.repeat(29) + ' い'), 'あ'.repeat(29)); // 切ったあとの終わりの空白も取る
  });

  console.log(`logic: ${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
