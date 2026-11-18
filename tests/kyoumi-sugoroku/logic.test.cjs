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
        'ホスト': { isHost: true, uid: 'uH', joinedAt: 1 },
        'あお': { isHost: false, uid: 'uA', joinedAt: 2 },
        'みどり': { isHost: false, uid: 'uM', joinedAt: 3 },
      },
      ...extra,
    };
  }

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

  test('はじめる: 遊ぶ人0人・7人以上・待合室以外は進めない', () => {
    assert.strictEqual(L.startGame(waitingRoom({ hostPlays: false, players: { 'ホスト': { isHost: true, uid: 'uH', joinedAt: 1 } } }), COUNTS), null);
    const proxies = Object.fromEntries(['い', 'ろ', 'は', 'に', 'ほ'].map((n, i) => [n, { joinedAt: 10 + i }]));
    assert.strictEqual(L.startGame(waitingRoom({ proxies }), COUNTS), null); // 3 + 5 = 8人
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
    assert.deepStrictEqual(L.pickedOf(one.game, COUNTS), { turn: 0, theme: talk.game.q.theme, idx: talk.game.q.idx, choice: 2 });
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

  /* ── 「人生の道」 ── */
  const LIFE = {
    scenes: ['s0', 's1', 's2', 's3'],
    erabu: { s0: 4, s1: 4, s2: 4, s3: 4 },
    kiku: { s0: 5, s1: 5, s2: 5, s3: 5 },
    events: [{ move: 2, all: 0, again: false }, { move: 0, all: 1, again: false }, { move: 0, all: 0, again: true }, { move: 0, all: 0, again: false }],
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

  test('人生の道: マス数は人数と長さから・マスの種類・場面', () => {
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6].map((n) => L.lifeSizeFor(n, 0)), [28, 28, 24, 20, 16, 16]);
    assert.strictEqual(L.lifeSizeFor(4, -1), 16);
    assert.strictEqual(L.lifeSizeFor(4, 1), 24);
    assert.strictEqual(L.lifeSizeFor(1, 1), 28);
    assert.strictEqual(L.lifeSizeFor(6, -1), 16);
    const kinds = L.lifeKinds(20);
    assert.strictEqual(kinds[0], '');
    assert.strictEqual(kinds[19], '');
    assert.deepStrictEqual(kinds.slice(1, 5), ['erabu', 'kiku', 'erabu', 'dekigoto']);
    assert.ok(kinds.slice(1, 19).every((k) => ['erabu', 'kiku', 'dekigoto'].includes(k)));
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

  test('人生の道: サイコロは2つ。ちがう目なら進む目を選び、同じ目ならそのまま進む', () => {
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

  test('人生の道: 止まったマスの種類のカードが出る', () => {
    const room = lifeRoom();
    for (let seed = 1; seed <= 40; seed++) {
      const next = rollAndPick(room, seed);
      const to = next.game.pos[0];
      const q = L.lifeQuestionOf(next.game);
      assert.strictEqual(next.game.step, L.STEP.LIFE_TALK);
      assert.strictEqual(q.kind, L.lifeKinds(24)[to]);
      if (q.kind !== 'dekigoto') assert.strictEqual(q.scene, to < 6 ? 's0' : 's1'); // 6列なので、6マス目から次の場面
      if (q.kind === 'kiku') assert.strictEqual(q.phase, L.PHASE.WHO);
      assert.strictEqual(L.questionOf(next.game, COUNTS), null);
    }
  });

  test('人生の道: えらぶは選ぶと次の人・選んだものが残る', () => {
    const room = withCard(lifeRoom(), { kind: 'erabu', scene: 's0', idx: 1, n: 1 });
    assert.strictEqual(L.choose(room, 1, 1, 1, 5, 3, COUNTS), null);
    assert.strictEqual(L.choose(room, 1, 1, 2, 0, 3, COUNTS), null); // 古い質問
    const next = L.choose(room, 1, 1, 1, 2, 3, COUNTS);
    assert.strictEqual(next.game.turn, 1);
    assert.strictEqual(next.game.step, L.STEP.LIFE_ROLL);
    assert.deepStrictEqual(L.pickedOf(next.game, COUNTS), { life: true, kiku: false, by: null, scene: 's0', idx: 1, turn: 0, choice: 2 });
    // 次のサイコロで消える
    assert.strictEqual(L.roll(next, 1, 1, 3, COUNTS).game.picked, null);
    // 別の質問
    const re = L.reask(room, 1, 1, 1, 5, COUNTS);
    assert.notStrictEqual(L.lifeQuestionOf(re.game).idx, 1);
    assert.strictEqual(L.lifeQuestionOf(re.game).n, 2);
  });

  test('人生の道: きくは、相手 → 3枚の質問から1枚 → 聞かれた人が答える', () => {
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
    assert.deepStrictEqual(L.pickedOf(done.game, COUNTS), { life: true, kiku: true, by: 0, scene: 's1', idx: q.idx, turn: 2, choice: 0 });
    // 「自由に話す」でも答えられる
    assert.strictEqual(L.pickedOf(L.choose(answer, 1, 1, 3, L.CHOICE_FREE, 3, COUNTS).game, COUNTS).choice, L.CHOICE_FREE);
  });

  test('人生の道: みんなに聞いたときは、声やチャットで答えて「話せた！次の人へ」', () => {
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

  test('人生の道: 1人で遊ぶときの きく は、そばにいる人へ（質問を選ぶところから）', () => {
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

  test('人生の道: できごとは変えられない（別の質問・選ぶ）', () => {
    const ev = withCard(lifeRoom(), { kind: 'dekigoto', idx: 0, n: 1 });
    assert.strictEqual(L.reask(ev, 1, 1, 1, 5, COUNTS), null);
    assert.strictEqual(L.choose(ev, 1, 1, 1, 0, 3, COUNTS), null);
  });

  test('人生の道: できごと（進む・みんな進む・もう一度・ひと息）', () => {
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

  test('人生の道: ゴールした人の番は「おうえん」（だれかを1マス進める）・みんな着いたらおわり', () => {
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

  test('人生の道: 壊れたカード・選んだものは読み飛ばす', () => {
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
    // 今までの遊び方のルームでは、人生の道のカードは読まない
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.strictEqual(L.lifeQuestionOf(withCard(theme, { kind: 'erabu', scene: 's0', idx: 0, n: 1 }).game), null);
  });

  test('人生の道: 段階の名前は今までの遊び方と分ける（古い版の画面からの操作を通さない）', () => {
    const room = lifeRoom();
    assert.strictEqual(room.game.step, 'life-roll');
    assert.ok(L.isRollStep(room.game));
    // 古い版が見る名前（roll / talk）になっていたら、振れない・進めない
    assert.strictEqual(L.roll({ ...room, game: { ...room.game, step: 'roll' } }, 1, 0, 3, COUNTS), null);
    assert.strictEqual(L.nextPlayer({ ...room, game: { ...room.game, step: 'talk', rollNo: 1, q: { kind: 'erabu', scene: 's0', idx: 2, n: 1 } } }, 1, 1), null);
    // 今までの遊び方は roll / talk のまま
    const theme = L.startGame(waitingRoom(), COUNTS);
    assert.strictEqual(theme.game.step, 'roll');
    assert.strictEqual(L.roll({ ...theme, game: { ...theme.game, step: 'life-roll' } }, 1, 0, 3, COUNTS), null);
    assert.strictEqual(L.isPickStep({ ...theme.game, step: 'life-pick' }), false);
  });

  test('人生の道: 番の人がいなくなったとき（できごとは確定しない・選びかけの目は捨てる）', () => {
    const base = lifeRoom();
    const card = withCard(base, { kind: 'dekigoto', idx: 1, n: 1 }, [22, 22, 22]); // みんな1マス進む
    const next = L.dropTalk(card);
    assert.deepStrictEqual(next.game.pos, [22, 22, 22]);
    assert.strictEqual(next.status, L.STATUS.PLAYING);
    assert.strictEqual(next.game.turn, 1);
    assert.strictEqual(next.game.step, 'life-roll');
    assert.strictEqual(next.game.q, null);
    assert.strictEqual(L.dropTalk(base), null); // サイコロを振る段階では何もしない
    // 進む目を選んでいる途中でいなくなったら、その目は捨てて次の人へ
    const picking = { ...base, game: { ...base.game, step: 'life-pick', dice: [2, 5] } };
    assert.strictEqual(L.skipAbsent(picking), null); // いるうちはとばさない
    const { 'ホスト': _h, ...rest } = picking.players;
    const skipped = L.skipAbsent({ ...picking, players: rest });
    assert.strictEqual(skipped.game.turn, 1);
    assert.strictEqual(skipped.game.step, 'life-roll');
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

  test('人生の道: 読めないカードで止まったら立て直せる（talkBroken → dropTalk）', () => {
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

  test('人生の道: ゴールの印は人生の道だけで見る・添字の欠けた形でもずれない', () => {
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

  test('人生の道: きく の相手は、いまいる人だけ。相手がいなくなったら選びなおせる', () => {
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

  console.log(`logic: ${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
