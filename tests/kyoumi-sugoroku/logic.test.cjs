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

  console.log(`logic: ${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
