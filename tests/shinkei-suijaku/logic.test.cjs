// 神経衰弱 ルームの決まり（apps/shinkei-suijaku/logic.js）の単体テスト
// node tests/shinkei-suijaku/logic.test.cjs
const path = require('path');
const assert = require('assert');
const L = require(path.join(__dirname, '../../apps/shinkei-suijaku/logic.js'));

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok  ' + name); }
  catch (e) { console.error('NG  ' + name + '\n    ' + (e && e.stack || e)); process.exitCode = 1; }
}

const LEVEL = { id: 'easy', cards: 12 };
const KEYS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

function room(extra) {
  return Object.assign({
    status: L.STATUS.WAITING, host: 'ホスト', hostUid: 'u0', hostPlays: true, lastGameId: 0, level: 'easy',
    players: {
      'ホスト': { isHost: true, uid: 'u0', joinedAt: 1 },
      'あお': { isHost: false, uid: 'u1', joinedAt: 2 },
      'みどり': { isHost: false, uid: 'u2', joinedAt: 3 },
    },
  }, extra || {});
}

function started(r, first) {
  return L.startGame(r || room(), LEVEL, KEYS, 42, first || 0);
}

// ペアの位置と、ちがう2枚を探す
function pairOf(deck) {
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) if (deck[i] === deck[j]) return [i, j];
}
function missOf(deck, got) {
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) if (!got[i] && !got[j] && deck[i] !== deck[j]) return [i, j];
}

t('山札: 枚数どおり・どの絵もちょうど2枚・同じ種なら同じ並び', () => {
  const d = L.makeDeck(LEVEL, KEYS, 7);
  assert.strictEqual(d.length, 12);
  const count = {};
  d.forEach((k) => { count[k] = (count[k] || 0) + 1; });
  assert.strictEqual(Object.keys(count).length, 6);
  Object.values(count).forEach((n) => assert.strictEqual(n, 2));
  assert.deepStrictEqual(L.makeDeck(LEVEL, KEYS, 7), d);
  assert.notDeepStrictEqual(L.makeDeck(LEVEL, KEYS, 8), d);
});

t('はじめる: 遊ぶ人は参加順・2人から・6人まで・ホストが進行だけなら入れない', () => {
  const r = started();
  assert.strictEqual(r.status, L.STATUS.PLAYING);
  assert.deepStrictEqual(L.orderOf(r.game), ['ホスト', 'あお', 'みどり']);
  assert.deepStrictEqual(L.pairsOf(r.game), [0, 0, 0]);
  assert.strictEqual(L.deckOf(r.game).length, 12);
  assert.strictEqual(L.openOf(r.game), -1);
  const solo = room({ players: { 'ホスト': { isHost: true, uid: 'u0', joinedAt: 1 } } });
  assert.strictEqual(started(solo), null, '1人でははじめない');
  const noHost = started(room({ hostPlays: false }));
  assert.deepStrictEqual(L.orderOf(noHost.game), ['あお', 'みどり']);
  const players = { 'ホスト': { isHost: true, uid: 'u0', joinedAt: 1 } };
  for (let i = 1; i <= 6; i++) players['p' + i] = { isHost: false, uid: 'u' + i, joinedAt: 1 + i };
  assert.strictEqual(started(room({ players })), null, '7人ははじめない');
  delete players.p6;
  assert.strictEqual(L.orderOf(started(room({ players })).game).length, 6);
});

t('はじめる: 端末なしの参加者も入る（uid を持たない）・はじめの人を選べる', () => {
  const r = started(room({ proxies: { 'きいろ': { joinedAt: 10 } } }), 4);
  assert.deepStrictEqual(L.orderOf(r.game), ['ホスト', 'あお', 'みどり', 'きいろ']);
  assert.strictEqual(L.isProxy(r.game, 'きいろ'), true);
  assert.strictEqual(r.game.uids['きいろ'], undefined);
  assert.strictEqual(L.turnOf(r.game), 0, '4人で first=4 は 0 番め');
  assert.strictEqual(L.turnOf(started(room(), 2).game), 2);
});

t('めくる: 1枚めは open に・同じ flipNo でないと何もしない・同じカードは二度めくれない', () => {
  const r = started();
  const r1 = L.flip(r, 1, 0, 3);
  assert.strictEqual(L.openOf(r1.game), 3);
  assert.strictEqual(L.flipNoOf(r1.game), 1);
  assert.strictEqual(L.flip(r1, 1, 0, 4), null, '古い flipNo');
  assert.strictEqual(L.flip(r1, 1, 1, 3), null, '同じカード');
  assert.strictEqual(L.flip(r1, 2, 1, 4), null, 'ちがう対戦');
  assert.strictEqual(L.flip(r1, 1, 1, 99), null, '山札の外');
});

t('めくる: そろえば取って同じ人がもう1回・ペアの数が増える', () => {
  const r = started();
  const [a, b] = pairOf(L.deckOf(r.game));
  const r2 = L.flip(L.flip(r, 1, 0, a), 1, 1, b);
  assert.strictEqual(L.turnOf(r2.game), 0);
  assert.deepStrictEqual(L.pairsOf(r2.game), [1, 0, 0]);
  assert.strictEqual(L.gotOf(r2.game)[a], true);
  assert.strictEqual(L.gotOf(r2.game)[b], true);
  assert.strictEqual(L.openOf(r2.game), -1);
  const rv = L.revealOf(r2.game);
  assert.deepStrictEqual([rv.a, rv.b, rv.match, rv.turn, rv.n], [a, b, true, 0, 1]);
  assert.strictEqual(L.flip(r2, 1, 2, a), null, '取ったカードはめくれない');
});

t('めくる: ちがえば次の人へ・カードは裏のまま（got にならない）', () => {
  const r = started();
  const [a, b] = missOf(L.deckOf(r.game), L.gotOf(r.game));
  const r2 = L.flip(L.flip(r, 1, 0, a), 1, 1, b);
  assert.strictEqual(L.turnOf(r2.game), 1);
  assert.deepStrictEqual(L.pairsOf(r2.game), [0, 0, 0]);
  assert.strictEqual(L.gotOf(r2.game).some(Boolean), false);
  assert.strictEqual(L.revealOf(r2.game).match, false);
  assert.strictEqual(L.revealOf(r2.game).turn, 0, '見せるのはめくった人の番として');
});

t('めくる: 次の人がいなければとばす（在室していない人）', () => {
  const r = started();
  delete r.players['あお'];
  const [a, b] = missOf(L.deckOf(r.game), L.gotOf(r.game));
  const r2 = L.flip(L.flip(r, 1, 0, a), 1, 1, b);
  assert.strictEqual(L.turnOf(r2.game), 2);
});

t('ぜんぶそろうと over・結果はいちばん多い人', () => {
  let r = started(room({ players: { 'ホスト': { isHost: true, uid: 'u0', joinedAt: 1 }, 'あお': { isHost: false, uid: 'u1', joinedAt: 2 } } }));
  const deck = L.deckOf(r.game);
  let guard = 0;
  while (r.status === L.STATUS.PLAYING && guard++ < 100) {
    const got = L.gotOf(r.game);
    // 1回めだけ外して番をまわす
    if (guard === 1) {
      const [a, b] = missOf(deck, got);
      r = L.flip(L.flip(r, 1, L.flipNoOf(r.game), a), 1, L.flipNoOf(r.game) + 1, b);
      continue;
    }
    let a = -1, b = -1;
    for (let i = 0; i < deck.length && a < 0; i++) for (let j = i + 1; j < deck.length; j++) if (!got[i] && !got[j] && deck[i] === deck[j]) { a = i; b = j; break; }
    const n = L.flipNoOf(r.game);
    r = L.flip(L.flip(r, 1, n, a), 1, n + 1, b);
  }
  assert.strictEqual(r.status, L.STATUS.OVER);
  assert.deepStrictEqual(L.pairsOf(r.game), [0, 6]);
  const res = L.resultOf(r.game);
  assert.deepStrictEqual(res.tops, ['あお']);
  assert.strictEqual(res.max, 6);
  assert.strictEqual(L.flip(r, 1, L.flipNoOf(r.game), 0), null, 'おわったらめくれない');
});

t('押せる人: 番の人の端末とホスト。番でない人・ちがう端末は押せない', () => {
  const r = started(room(), 1);   // あおの番
  assert.strictEqual(L.canAct(r, 'u1', 'あお', 'guest'), true);
  assert.strictEqual(L.canAct(r, 'u0', 'ホスト', 'host'), true);
  assert.strictEqual(L.canAct(r, 'u2', 'みどり', 'guest'), false);
  assert.strictEqual(L.canAct(r, 'u9', 'あお', 'guest'), false);
  assert.strictEqual(L.canAct(r, 'u9', 'ホスト', 'host'), false);
  assert.strictEqual(L.canAct(room(), 'u0', 'ホスト', 'host'), false, '待合室では押せない');
});

t('いない人をとばす: めくりかけを裏にもどして次の人へ（いれば何もしない）', () => {
  const r = L.flip(started(room(), 1), 1, 0, 2);
  assert.strictEqual(L.skipAbsent(r), null);
  delete r.players['あお'];
  const r2 = L.skipAbsent(r);
  assert.strictEqual(L.turnOf(r2.game), 2);
  assert.strictEqual(L.openOf(r2.game), -1);
  assert.strictEqual(L.flipNoOf(r2.game), 2);
});

t('端末なしの参加者はいつもいる扱い（とばさない）', () => {
  const r = started(room({ proxies: { 'きいろ': { joinedAt: 10 } } }), 3);
  assert.strictEqual(L.actorOf(r.game), 'きいろ');
  assert.strictEqual(L.skipAbsent(r), null);
  assert.strictEqual(L.present(r, r.game, 'きいろ'), true);
});

t('自分の番で退出: passTurn で次の人へ', () => {
  const r = L.flip(started(room(), 1), 1, 0, 5);
  delete r.players['あお'];
  const r2 = L.passTurn(r);
  assert.strictEqual(L.turnOf(r2.game), 2);
  assert.strictEqual(L.openOf(r2.game), -1);
});

t('もう一回: おわりのあとから、はじめの人を交代してはじめられる・待合室にもどれる', () => {
  const r = started();
  const over = Object.assign({}, r, { status: L.STATUS.OVER });
  const again = L.startGame(over, LEVEL, KEYS, 9, Number(over.game.first) + 1);
  assert.strictEqual(again.status, L.STATUS.PLAYING);
  assert.strictEqual(again.game.id, 2);
  assert.strictEqual(L.turnOf(again.game), 1);
  assert.strictEqual(L.startGame(r, LEVEL, KEYS, 9, 0), null, '遊んでいる途中ははじめない');
  const w = L.backToWaiting(over, 1);
  assert.strictEqual(w.status, L.STATUS.WAITING);
  assert.strictEqual(w.game, null);
  assert.strictEqual(L.backToWaiting(over, 5), null);
});

t('壊れた値を読み飛ばす', () => {
  const g = { order: { 0: 'a', 1: 'b' }, deck: ['x', 'x', 'y'], pairs: ['1', -2], turn: 9, open: 'z' };
  assert.deepStrictEqual(L.orderOf(g), ['a', 'b']);
  assert.strictEqual(L.deckOf(g), null, '奇数枚');
  assert.deepStrictEqual(L.pairsOf(g), [0, 0]);
  assert.strictEqual(L.turnOf(g), 0);
  assert.strictEqual(L.openOf(g), -1);
  assert.strictEqual(L.revealOf({ deck: ['a', 'a'], order: ['p'], reveal: { a: 0, b: 0, turn: 0, n: 1 } }), null, '同じ2枚');
  // RTDB が配列を {0:…} で返しても読める
  assert.deepStrictEqual(L.deckOf({ deck: { 0: 'a', 1: 'b', 2: 'a', 3: 'b' } }), ['a', 'b', 'a', 'b']);
});

t('名前の検査', () => {
  assert.ok(L.validNickname(''));
  assert.ok(L.validNickname('123456789'));
  assert.ok(L.validNickname('a.b'));
  assert.ok(L.validNickname('a/b'));
  assert.strictEqual(L.validNickname('あおい'), '');
});

console.log(pass + ' passed');
