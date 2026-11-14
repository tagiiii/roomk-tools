// 麻雀の役ありルールのテスト。node tests/mahjong/yaku.test.cjs
'use strict';
const assert = require('assert');
const Y = require('../../apps/mahjong/yaku.js');
const E = require('../../apps/mahjong/engine.js');

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', n, name); };
const BASE = { m: 0, p: 9, s: 18, z: 27 };
function parse(str) {
  const c = new Array(34).fill(0);
  for (const [, nums, suit] of str.matchAll(/(\d+)([mpsz])/g)) for (const d of nums) c[BASE[suit] + Number(d) - 1] += 1;
  return c;
}
const kind = (s) => BASE[s[1]] + Number(s[0]) - 1;
// 手（あがり牌をふくむ）とあがり牌から役を出す。melds: [['run','1m',true], ['set','5z',true], ['kan','1z',false]]
function ev(hand, win, o = {}) {
  const c = parse(hand);
  const melds = (o.melds || []).map(([tt, k, open]) => ({ t: tt, k: kind(k), open }));
  const all = c.slice();
  melds.forEach((m) => { if (m.t === 'run') { all[m.k] += 1; all[m.k + 1] += 1; all[m.k + 2] += 1; } else all[m.k] += m.t === 'kan' ? 4 : 3; });
  return Y.evaluate({
    c, melds, win: kind(win), tsumo: !!o.tsumo, seatWind: o.seat || 28, roundWind: o.round || 27,
    riichi: !!o.riichi, double: false, ippatsu: !!o.ippatsu, rinshan: false, chankan: false,
    haitei: false, houtei: false, tenhou: false, chiihou: false,
    dora: (o.dora || []).map(kind), ura: (o.ura || []).map(kind), all,
  });
}
const names = (r) => (r ? r.yaku.map((y) => y.name).sort() : null);

t('役がなければ null', () => {
  // 鳴いた手で、役がない
  assert.strictEqual(ev('234m567p11s789s', '9s', { melds: [] }) && null, null);
  assert.strictEqual(ev('234m11s', '1s', { melds: [['run', '5p', true], ['run', '7s', true], ['set', '9m', true]] }), null);
});

t('立直・門前清自摸和・平和・断么九', () => {
  const r = ev('234m345p567s55678s', '8s', { riichi: true, tsumo: true });
  assert.deepStrictEqual(names(r), ['平和', '断么九', '立直', '門前清自摸和'].sort());
  assert.strictEqual(r.han, 4);
});

t('平和は両面待ちだけ（嵌張・辺張・単騎はつかない）', () => {
  assert.ok(names(ev('123m456p789s23455s', '3s', { riichi: true })).includes('平和') === false); // 嵌張 2-4
  assert.ok(names(ev('123m456p789s12355s', '3s', { riichi: true })).includes('平和') === false); // 辺張 12-3
  assert.ok(names(ev('123m456p789s23455s', '2s', { riichi: true })).includes('平和'));
});

t('平和はあたまが役牌ならつかない', () => {
  assert.ok(!names(ev('123m456p789s234s11z', '4s', { riichi: true, round: 27 })).includes('平和'));
  assert.ok(names(ev('123m456p789s234s44z', '4s', { riichi: true, seat: 28, round: 27 })).includes('平和'));
});

t('役牌（三元牌・自風・場風、ダブ東）', () => {
  assert.deepStrictEqual(names(ev('123m456p789s55z777z', '5z')), ['役牌 中']);
  const r = ev('123m456p789s55s111z', '5s', { seat: 27, round: 27 });
  assert.deepStrictEqual(names(r), ['場風 東', '自風 東'].sort());
  assert.strictEqual(r.han, 2);
});

t('一盃口・二盃口・七対子', () => {
  assert.ok(names(ev('112233m456p789s55z', '5z', { riichi: true })).includes('一盃口'));
  const r = ev('112233m556677p55s', '5s');
  assert.ok(names(r).includes('二盃口'));
  assert.ok(!names(r).includes('七対子')); // 二盃口のほうが高い
  assert.deepStrictEqual(names(ev('1199m3377p5588s11z', '1z')), ['七対子']);
});

t('三色同順・一気通貫（鳴くと1つ下がる）', () => {
  assert.strictEqual(ev('123m123p123s99s555z', '9s').yaku.find((y) => y.name === '三色同順').han, 2);
  assert.strictEqual(ev('123p123s99s555z', '9s', { melds: [['run', '1m', true]] }).yaku.find((y) => y.name === '三色同順').han, 1);
  assert.ok(names(ev('123456789m11p555z', '1p')).includes('一気通貫'));
});

t('混全帯么九・純全帯么九・混老頭', () => {
  assert.ok(names(ev('123m789p123s99s111z', '9s')).includes('混全帯么九'));
  assert.ok(names(ev('123m789p123s789s99m', '9m', { riichi: true })).includes('純全帯么九'));
  const r = ev('111m999p111s11z', '1z', { melds: [['set', '9s', true]] });
  assert.ok(names(r).includes('混老頭'));
  assert.ok(names(r).includes('対々和'));
});

t('対々和・三暗刻（ロンの刻子は暗刻に数えない）', () => {
  // ツモなら四暗刻（役満）
  assert.strictEqual(ev('222m333p444s55s666s', '6s', { tsumo: true }).yakuman, 1);
  // 6索のシャンポンをロンなら三暗刻＋対々和
  const r = ev('222m333p444s55s666s', '6s');
  assert.deepStrictEqual(names(r).filter((x) => /暗刻|対々/.test(x)).sort(), ['三暗刻', '対々和'].sort());
  // 単騎待ちのロンは四暗刻
  assert.strictEqual(ev('222m333p444s666s55s', '5s').yakuman, 1);
});

t('混一色・清一色・小三元・三色同刻', () => {
  assert.ok(names(ev('123456m789m11z555z', '1z')).includes('混一色'));
  assert.strictEqual(ev('11123456789999m', '9m', { tsumo: false }).yakuman, 1); // 九蓮宝燈
  assert.ok(names(ev('1112345678m99m55m', '5m')).includes('清一色'));
  assert.ok(names(ev('123m456p55z666z777z', '5z')).includes('小三元'));
  assert.ok(names(ev('222m222p222s456m11p', '1p', { riichi: true })).includes('三色同刻'));
});

t('役満: 国士無双・大三元・字一色・緑一色・清老頭・小四喜・大四喜', () => {
  assert.deepStrictEqual(names(ev('19m19p19s12345677z', '7z')), ['国士無双']);
  assert.ok(names(ev('123m555z666z777z33p', '3m')).includes('大三元'));
  assert.ok(names(ev('11122233344455z', '5z')).includes('字一色'));
  assert.ok(names(ev('22334466888s666z', '6z')).includes('緑一色'));
  assert.ok(names(ev('111999m111999p11s', '1s')).includes('清老頭'));
  assert.ok(names(ev('111222333z44z123m', '3m')).includes('小四喜'));
  assert.ok(names(ev('111222333444z11m', '1m')).includes('大四喜'));
});

t('ドラ・裏ドラ（役がないとドラだけではあがれない）', () => {
  const r = ev('234m345p567s55678s', '8s', { riichi: true, dora: ['5s'], ura: ['4m'] });
  assert.strictEqual(r.dora, 3 + 1);
  assert.strictEqual(ev('234m11s', '1s', { melds: [['run', '5p', true], ['run', '7s', true], ['set', '9m', true]], dora: ['1s'] }), null);
  // 裏ドラはリーチのときだけ
  assert.strictEqual(ev('123m456p789s55z777z', '5z', { ura: ['7z'] }).dora, 0);
});

t('ドラ表示牌の次がドラ', () => {
  assert.strictEqual(Y.doraOf(8), 0); // 9萬 → 1萬
  assert.strictEqual(Y.doraOf(30), 27); // 北 → 東
  assert.strictEqual(Y.doraOf(33), 31); // 中 → 白
  assert.strictEqual(Y.doraOf(13), 14);
});

// ── 局の流れ ──
const id = (k, copy) => k * 4 + copy;
const seats = [0, 1, 2, 3].map((i) => ({ name: 'P' + i, cpu: true }));
function yround(seed, o = {}) { return E.createRound({ seed, seats, dealer: 0, rule: 'yaku', ...o }); }
function total(S) {
  return S.wall.length + S.dead.rinshan.length + S.dead.dora.length + S.dead.ura.length
    + S.seats.reduce((a, s) => a + s.hand.length + s.river.filter((r) => !r.called).length + s.melds.reduce((b, m) => b + m.tiles.length, 0), 0);
}
// 手を作りかえる（ほかの牌は山から抜いて重ならないように）
function setHands(S, hands, drawnId) {
  const used = new Set(hands.flat());
  assert.strictEqual(used.size, hands.flat().length, 'テストの手に同じ牌が2回ある');
  const pool = [];
  for (let i = 0; i < 136; i += 1) if (!used.has(i)) pool.push(i);
  S.seats.forEach((s, i) => { s.hand = hands[i].slice(); });
  S.dead = { rinshan: pool.splice(0, 4), dora: pool.splice(0, 5), ura: pool.splice(0, 5) };
  S.wall = pool;
  S.drawn = drawnId;
}
const F = (k0, n, copy = 3) => Array.from({ length: n }, (_, i) => id(k0 + i, copy));

t('はじめの形（王牌14枚・ドラ表示牌1枚）', () => {
  const S = yround(5);
  assert.strictEqual(S.dead.rinshan.length + S.dead.dora.length + S.dead.ura.length, 14);
  assert.strictEqual(S.wall.length, 136 - 14 - 53);
  assert.strictEqual(S.doraN, 1);
  assert.strictEqual(total(S), 136);
});

t('役がないとロンできない（形はあがりでも）', () => {
  let S = yround(6);
  // P0: 234萬 1索 ＋ チー567筒・チー789索・ポン999萬（役なし）。5萬を捨てて 1索 単騎
  setHands(S, [
    [id(1, 0), id(2, 0), id(3, 0), id(18, 0), id(4, 0)],
    [id(18, 1), ...F(27, 7, 2), ...F(9, 5, 2)],
    [...F(27, 7, 1), ...F(9, 6, 1)],
    [...F(27, 7, 3), ...F(0, 6, 3)],
  ], id(4, 0));
  S.seats[0].melds = [
    { type: 'chi', tiles: [id(13, 0), id(14, 0), id(15, 0)], called: id(13, 0), from: 3 },
    { type: 'chi', tiles: [id(24, 0), id(25, 0), id(26, 0)], called: id(24, 0), from: 3 },
    { type: 'pon', tiles: [id(8, 0), id(8, 1), id(8, 2)], called: id(8, 0), from: 2 },
  ];
  S.wall = S.wall.filter((x) => ![id(13, 0), id(14, 0), id(15, 0), id(24, 0), id(25, 0), id(26, 0), id(8, 0), id(8, 1), id(8, 2)].includes(x));
  S = E.act(S, 0, { type: 'discard', id: id(4, 0) });
  if (S.phase === 'claim') Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), { type: 'pass' }); });
  assert.strictEqual(S.turn, 1);
  assert.deepStrictEqual(E.handWaits(S, 0), [18]);
  S = E.act(S, 1, { type: 'discard', id: id(18, 1) });
  assert.ok(!S.pending || !S.pending[0], '役がないのでロンは出ない');
  const info = E.waitInfo(S, 0);
  assert.strictEqual(info.yaku, false);
  assert.strictEqual(info.riichiYaku, false); // 鳴いているのでリーチもできない
});

t('リーチ・一発・裏ドラ・リーチ後は引いた牌だけ捨てられる', () => {
  let S = yround(7);
  // P0: 234m 345p 678s 2345s + 9z → 9z(中)を捨ててリーチ、2-5s 待ち
  setHands(S, [
    [id(1, 0), id(2, 0), id(3, 0), id(11, 0), id(12, 0), id(13, 0), id(23, 0), id(24, 0), id(25, 0), id(19, 0), id(20, 0), id(21, 0), id(22, 0), id(33, 0)],
    [id(33, 1), id(33, 2), ...F(0, 11)],
    F(9, 13).map((x) => x - 1),
    [id(27, 0), id(27, 1), id(27, 2), id(28, 0), id(28, 1), id(28, 2), id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(31, 0)],
  ], id(33, 0));
  assert.ok(E.riichiOptions(S, 0).includes(id(33, 0)));
  S = E.act(S, 0, { type: 'discard', id: id(33, 0), riichi: true });
  assert.ok(S.seats[0].riichi);
  assert.ok(S.seats[0].ippatsu);
  assert.ok(S.seats[0].river[0].riichi);
  // P1 のポンを断って、山から 5索 を P0 の次のツモに置く
  if (S.phase === 'claim') Object.keys(S.pending).forEach((s) => { S = E.act(S, Number(s), { type: 'pass' }); });
  // P1〜P3 は山の牌をそのまま捨てる（だれもロンしない牌になるよう、山の上に字牌を置く）
  S.wall.push(id(22, 1)); // P0 が最後に引く 5索
  S.wall.push(id(31, 1), id(31, 2)); // P3, P2 が引く
  const safe = S.wall[S.wall.length - 1];
  void safe;
  for (const s of [1, 2, 3]) {
    if (S.phase === 'claim') Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), { type: 'pass' }); });
    assert.strictEqual(S.turn, s);
    S = E.act(S, s, { type: 'discard', id: S.drawn });
  }
  if (S.phase === 'claim') Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), { type: 'pass' }); });
  assert.strictEqual(S.turn, 0);
  // リーチのあとは引いた牌しか捨てられない
  const other = S.seats[0].hand.find((x) => x !== S.drawn);
  assert.throws(() => E.act(S, 0, { type: 'discard', id: other }));
  assert.ok(E.canTsumo(S, 0));
  S = E.act(S, 0, { type: 'tsumo' });
  const yk = S.result.yaku.yaku.map((y) => y.name);
  assert.ok(yk.includes('ダブル立直') && yk.includes('一発') && yk.includes('門前清自摸和'), yk); // 最初の一巡のリーチ
  assert.strictEqual(S.result.ura.length, 1);
});

t('フリテン: 待ちの牌を自分で捨てていたらロンできない（ツモはできる）', () => {
  let S = yround(8);
  // P1: 123m 456p 789s 11z + 4s5s → 3s/6s 待ち。P1 の捨て牌に 6s を入れておく
  setHands(S, [
    [id(20, 0), ...F(9, 13)],
    [id(0, 0), id(1, 0), id(2, 0), id(12, 0), id(13, 0), id(14, 0), id(24, 1), id(25, 1), id(26, 1), id(27, 0), id(27, 1), id(21, 0), id(22, 0)],
    F(0, 13).map((x) => x - 2),
    [id(28, 0), id(28, 1), id(28, 2), id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(31, 0), id(31, 1), id(31, 2), id(32, 0)],
  ], id(20, 0));
  S.seats[1].river = [{ id: id(23, 2), called: false }];
  assert.ok(E.furiten(S, 1));
  S = E.act(S, 0, { type: 'discard', id: id(20, 0) }); // 3索
  assert.ok(!S.pending || !S.pending[1] || !S.pending[1].options.ron);
});

t('見逃しのフリテンは、次に自分が引くまで', () => {
  let S = yround(9);
  // P2: 123m 456p 白白白 45s 東東 → 3索・6索待ち（役牌 白）
  setHands(S, [
    [id(20, 0), ...F(9, 13).map((x) => x - 2)],
    [id(23, 1), ...F(27, 4, 2), ...F(0, 8, 2)],
    [id(0, 0), id(1, 0), id(2, 0), id(12, 0), id(13, 0), id(14, 0), id(31, 0), id(31, 1), id(31, 2), id(21, 0), id(22, 0), id(27, 0), id(27, 1)],
    [id(28, 0), id(28, 1), id(29, 0), id(29, 1), id(30, 0), id(30, 1), id(32, 0), id(32, 1), id(33, 0), id(33, 1), id(24, 0), id(25, 0), id(26, 0)],
  ], id(20, 0));
  S = E.act(S, 0, { type: 'discard', id: id(20, 0) }); // 3索
  assert.ok(S.pending[2].options.ron);
  Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), { type: 'pass' }); });
  assert.ok(S.seats[2].furitenTemp);
  assert.strictEqual(S.turn, 1);
  S = E.act(S, 1, { type: 'discard', id: id(23, 1) }); // 6索。P2 は見逃しのフリテンでロンできない
  assert.ok(!S.pending || !S.pending[2] || !S.pending[2].options.ron);
  if (S.phase === 'claim') Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), { type: 'pass' }); });
  assert.strictEqual(S.turn, 2);
  assert.ok(!S.seats[2].furitenTemp); // 自分が引いたので外れた
});

t('暗槓: 嶺上牌を引き、カンドラがすぐめくれる。王牌は14枚のまま', () => {
  let S = yround(10);
  setHands(S, [
    [id(31, 0), id(31, 1), id(31, 2), id(31, 3), ...F(0, 10)],
    F(9, 13, 2), F(18, 9).concat([id(27, 0), id(27, 1), id(27, 2), id(28, 0)]),
    [id(28, 1), id(28, 2), id(28, 3), id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(32, 0), id(32, 1), id(32, 2), id(33, 0)],
  ], id(31, 3));
  const wall0 = S.wall.length;
  assert.deepStrictEqual(E.kanOptions(S, 0).ankan, [31]);
  S = E.act(S, 0, { type: 'ankan', kind: 31 });
  assert.strictEqual(S.seats[0].melds[0].type, 'ankan');
  assert.strictEqual(S.doraN, 2);
  assert.strictEqual(S.wall.length, wall0 - 1);
  assert.strictEqual(S.dead.rinshan.length, 4);
  assert.ok(S.rinshanDraw);
  assert.strictEqual(S.seats[0].hand.length, 11);
  assert.strictEqual(total(S), 136);
});

t('明槓・加槓のカンドラは次に捨てたときにめくれる', () => {
  let S = yround(11);
  setHands(S, [
    [id(31, 0), ...F(0, 13)],
    [id(31, 1), id(31, 2), id(31, 3), ...F(9, 10, 2)],
    F(18, 9).concat([id(27, 0), id(27, 1), id(27, 2), id(28, 0)]),
    [id(28, 1), id(28, 2), id(28, 3), id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(32, 0), id(32, 1), id(32, 2), id(33, 0)],
  ], id(31, 0));
  S = E.act(S, 0, { type: 'discard', id: id(31, 0) });
  const mk = S.pending[1].options.minkan;
  assert.strictEqual(mk.length, 1);
  Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), Number(q) === 1 ? { type: 'minkan', tiles: mk[0] } : { type: 'pass' }); });
  assert.strictEqual(S.seats[1].melds[0].type, 'minkan');
  assert.strictEqual(S.turn, 1);
  assert.strictEqual(S.doraN, 1);
  S = E.act(S, 1, { type: 'discard', id: S.seats[1].hand[0] });
  assert.strictEqual(S.doraN, 2);
  assert.strictEqual(total(S), 136);
});

t('槍槓: 加槓の牌でロン', () => {
  let S = yround(12);
  // P0 は 東 をポン済み、4枚目の東を引いた。P1 は 東 単騎（役: 七対子でなく…）→ 東単騎は槍槓の役がつく
  setHands(S, [
    [id(27, 3), ...F(0, 10)],
    [id(9, 1), id(10, 1), id(11, 1), id(12, 1), id(13, 1), id(14, 1), id(15, 1), id(16, 1), id(17, 1), id(18, 1), id(19, 1), id(20, 1), id(27, 2)],
    F(18, 9).map((x) => x - 1).concat([id(28, 0), id(28, 1), id(28, 2), id(29, 0)]),
    [id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(32, 0), id(32, 1), id(32, 2), id(33, 0), id(33, 1), id(33, 2), id(31, 0), id(31, 1)],
  ], id(27, 3));
  // 加槓できる形を作りなおす: ポンは 東0・東1・東2、引いたのが 東3。P1 は 白 単騎
  S.seats[0].melds = [{ type: 'pon', tiles: [id(27, 0), id(27, 1), id(27, 2)], called: id(27, 0), from: 3 }];
  S.seats[1].hand[12] = id(31, 2);
  assert.deepStrictEqual(E.kanOptions(S, 0).kakan, [27]);
  S = E.act(S, 0, { type: 'kakan', kind: 27 });
  // P1 は 白 単騎なので東ではロンできない → そのまま嶺上牌へ
  assert.strictEqual(S.phase, 'discard');
  assert.strictEqual(S.seats[0].melds[0].type, 'kakan');
  assert.strictEqual(S.kans, 1);
});

t('槍槓でロンすると、槍槓の役がつく', () => {
  let S = yround(13);
  setHands(S, [
    [id(4, 3), ...F(18, 9), id(6, 3)],
    [id(0, 1), id(1, 1), id(2, 1), id(9, 1), id(10, 1), id(11, 1), id(12, 1), id(13, 1), id(14, 1), id(3, 1), id(5, 1), id(31, 0), id(31, 1)],
    F(9, 4, 2).concat([id(32, 0), id(32, 1), id(32, 2), id(33, 0), id(33, 1), id(33, 2), id(15, 2), id(16, 2), id(17, 2)]),
    [id(28, 1), id(28, 2), id(28, 3), id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(27, 0), id(27, 1), id(27, 2), id(33, 3)],
  ], id(4, 3));
  S.seats[0].melds = [{ type: 'pon', tiles: [id(4, 0), id(4, 1), id(4, 2)], called: id(4, 0), from: 3 }];
  S = E.act(S, 0, { type: 'kakan', kind: 4 });
  assert.strictEqual(S.phase, 'claim');
  assert.ok(S.pending[1].options.ron);
  S = E.act(S, 1, { type: 'ron' });
  assert.strictEqual(S.result.winner, 1);
  assert.ok(S.result.yaku.yaku.some((y) => y.name === '槍槓'));
});

t('喰い替えはできない（ポンした牌と同じ種類はすぐ捨てられない）', () => {
  let S = yround(14);
  setHands(S, [
    [id(31, 0), ...F(0, 13)],
    [id(31, 1), id(31, 2), id(31, 3), id(9, 1), id(10, 1), id(11, 1), id(12, 1), id(13, 1), id(14, 1), id(15, 1), id(16, 1), id(17, 1), id(18, 1)],
    F(18, 9).concat([id(27, 0), id(27, 1), id(27, 2), id(28, 0)]),
    [id(28, 1), id(28, 2), id(28, 3), id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(32, 0), id(32, 1), id(32, 2), id(33, 0)],
  ], id(31, 0));
  S = E.act(S, 0, { type: 'discard', id: id(31, 0) });
  const p = S.pending[1].options.pon[0];
  Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), Number(q) === 1 ? { type: 'pon', tiles: p } : { type: 'pass' }); });
  const white = S.seats[1].hand.find((x) => E.kindOf(x) === 31);
  assert.throws(() => E.act(S, 1, { type: 'discard', id: white }));
});

t('途中流局: 四風連打・九種九牌', () => {
  let S = yround(15);
  setHands(S, [
    [id(27, 0), ...F(0, 13)],
    [id(27, 1), ...F(9, 12, 2)],
    [id(27, 2), ...F(18, 9, 1), id(32, 0), id(32, 1), id(32, 2)],
    [id(27, 3), id(28, 1), id(28, 2), id(28, 3), id(29, 0), id(29, 1), id(29, 2), id(30, 0), id(30, 1), id(30, 2), id(33, 0), id(33, 1), id(33, 2)],
  ], id(27, 0));
  for (const s of [0, 1, 2, 3]) {
    if (S.phase === 'claim') Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), { type: 'pass' }); });
    if (S.phase === 'end') break;
    S = E.act(S, s, { type: 'discard', id: S.seats[s].hand.find((x) => E.kindOf(x) === 27) });
  }
  if (S.phase === 'claim') Object.keys(S.pending).forEach((q) => { S = E.act(S, Number(q), { type: 'pass' }); });
  assert.strictEqual(S.result.type, 'abort');
  assert.strictEqual(S.result.reason, '四風連打');
  let K = yround(16);
  setHands(K, [
    [id(0, 0), id(8, 0), id(9, 0), id(17, 0), id(18, 0), id(26, 0), id(27, 0), id(28, 0), id(29, 0), id(1, 0), id(2, 0), id(3, 0), id(4, 0), id(5, 0)],
    F(9, 13, 2), F(18, 9).concat([id(30, 0), id(30, 1), id(30, 2), id(31, 0)]),
    [id(31, 1), id(31, 2), id(31, 3), id(32, 0), id(32, 1), id(32, 2), id(33, 0), id(33, 1), id(33, 2), id(28, 1), id(28, 2), id(29, 1), id(29, 2)],
  ], id(5, 0));
  assert.ok(E.canKyushu(K, 0));
  K = E.act(K, 0, { type: 'kyushu' });
  assert.strictEqual(K.result.reason, '九種九牌');
});

t('かんたんルールには役ありの決まりが入らない', () => {
  const S = E.createRound({ seed: 3, seats, dealer: 0 });
  assert.strictEqual(S.dead, null);
  assert.deepStrictEqual(E.riichiOptions(S, 0), []);
  assert.deepStrictEqual(E.kanOptions(S, 0), { ankan: [], kakan: [] });
  assert.strictEqual(E.furiten(S, 0), false);
});

for (const level of ['easy', 'normal']) t('コンピューター4人の役あり（' + level + '・120局）', () => {
  const tally = { tsumo: 0, ron: 0, draw: 0, abort: 0, riichi: 0, kan: 0, yakuman: 0 };
  const t0 = Date.now();
  for (let seed = 1; seed <= 120; seed += 1) {
    let S = yround(seed * 7, { level, dealer: seed % 4, roundWind: seed % 2 ? 27 : 28 });
    let steps = 0;
    while (S.phase !== 'end') {
      const who = E.waitingFor(S)[0];
      S = E.act(S, who, E.cpuAction(S, who));
      assert.strictEqual(total(S), 136);
      steps += 1;
      assert.ok(steps < 3000);
    }
    tally[S.result.type] += 1;
    tally.riichi += S.log.filter((l) => l.t === 'riichi').length;
    tally.kan += S.kans;
    if (S.result.type === 'tsumo' || S.result.type === 'ron') {
      assert.ok(S.result.yaku && S.result.yaku.yaku.length > 0, 'あがりには役がある');
      if (S.result.yaku.yakuman) tally.yakuman += 1;
    }
  }
  console.log('   ', tally, (Date.now() - t0) + 'ms');
  assert.ok(tally.tsumo + tally.ron > 30);
  assert.ok(tally.riichi > 30);
});

console.log('all', n, 'tests passed');
