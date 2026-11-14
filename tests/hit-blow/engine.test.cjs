// ヒット&ブローのルールのテスト（エミュレーター不要）。node tests/hit-blow/engine.test.cjs
const E = require('../../apps/hit-blow/engine.js');

let pass = 0;
const fails = [];
function check(label, cond, detail) {
  if (cond) { pass += 1; return; }
  fails.push(label);
  console.log('  NG ' + label + (detail !== undefined ? ' :: ' + JSON.stringify(detail) : ''));
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ids = (level) => E.palette(level).map((c) => c.id);
const missOf = (secret, level) => ids(level).filter((x) => !secret.includes(x)).slice(0, secret.length);
// 当たらない予想（同じ色を逆にならべる。色がすべてちがうので、ぜんぶヒットにはならない）
const wrongOf = (secret) => secret.slice().reverse();

// ── ヒットとブロー ──
check('J1 ヒット1・ブロー2', eq(E.judge(['red', 'blue', 'yellow', 'green'], ['red', 'green', 'blue', 'pink']), { hit: 1, blow: 2 }));
check('J2 ぜんぶヒット', eq(E.judge(['red', 'blue', 'yellow'], ['red', 'blue', 'yellow']), { hit: 3, blow: 0 }));
check('J3 ぜんぶブロー', eq(E.judge(['red', 'blue', 'yellow'], ['blue', 'yellow', 'red']), { hit: 0, blow: 3 }));
check('J4 なし', eq(E.judge(['red', 'blue', 'yellow'], ['green', 'purple', 'orange']), { hit: 0, blow: 0 }));
// でたらめに照合: ヒット＋ブロー＝共通の色の数、ヒットは同じ場所の数
let judgeOk = true;
for (let k = 0; k < 20000; k++) {
  const level = ['easy', 'normal', 'hard'][k % 3];
  const s = E.randomCode(level);
  const g = E.randomCode(level);
  const r = E.judge(s, g);
  const common = g.filter((x) => s.includes(x)).length;
  const same = g.filter((x, i) => s[i] === x).length;
  if (r.hit !== same || r.hit + r.blow !== common) { judgeOk = false; break; }
}
check('J5 でたらめ2万回で数え方が合う', judgeOk);

// ── 答えの形 ──
let codeOk = true;
for (let k = 0; k < 3000; k++) for (const l of Object.keys(E.LEVELS)) if (!E.validCode(E.randomCode(l), l)) codeOk = false;
check('C1 くじの答えはいつも正しい形', codeOk);
check('C2 同じ色は使えない', !E.validCode(['red', 'red', 'blue'], 'easy'));
check('C3 数がちがうと使えない', !E.validCode(['red', 'blue'], 'easy') && !E.validCode(['red', 'blue', 'yellow'], 'normal'));
check('C4 その段の色だけ使える（茶は8色のときだけ）', !E.validCode(['red', 'blue', 'brown'], 'easy') && E.validCode(['red', 'blue', 'yellow', 'brown'], 'hard'));
check('C5 色としるしは8つ・しるしは重ならない', E.COLORS.length === 8 && new Set(E.COLORS.map((c) => c.icon)).size === 8);
// くじの偏り（どの色もおおむね同じくらい出る）
const freq = {};
for (let k = 0; k < 30000; k++) E.randomCode('hard').forEach((x) => { freq[x] = (freq[x] || 0) + 1; });
const fv = Object.values(freq);
check('C6 くじの色の偏りが小さい', fv.length === 8 && Math.max(...fv) / Math.min(...fv) < 1.1, freq);

// ── みんなで対戦 ──
let S = E.create({ mode: 'party', level: 'easy', n: 3 });
const sec = S.secrets[0];
check('P1 はじめから play・1人目の番', S.phase === 'play' && S.turn === 0 && S.secrets.length === 1);
S = E.guess(S, 0, missOf(sec, 'easy'));
check('P2 外れると次の人の番', S.turn === 1 && S.log[0].hit === 0 && S.log[0].blow === 0 && S.log[0].target === -1);
check('P3 番でない人は出せない', E.guess(S, 0, missOf(sec, 'easy')) === S);
check('P4 正しくない形は出せない', E.guess(S, 1, ['red', 'red', 'blue']) === S);
S = E.skip(S);
check('P5 番をとばす', S.turn === 2);
S = E.guess(S, 2, sec);
check('P6 当てたら終わり・その人の勝ち', S.phase === 'end' && eq(S.winners, [2]));
check('P7 終わったあとは出せない', E.guess(S, 0, sec) === S && E.skip(S) === S);
check('P8 人数は2〜6にそろえる', E.create({ mode: 'party', level: 'easy', n: 9 }).n === 6 && E.create({ mode: 'party', level: 'easy', n: 1 }).n === 2);
check('P9 2回めは先の番がずれる', E.create({ mode: 'party', level: 'easy', n: 3, round: 1 }).turn === 1 && E.create({ mode: 'party', level: 'easy', n: 3, round: 3 }).turn === 0);

// ── 2人で対戦 ──
let D = E.create({ mode: 'duel', level: 'normal', n: 2 });
check('D1 はじめは答えを決める', D.phase === 'setup' && D.secrets.length === 2 && !D.secrets[0] && !D.secrets[1]);
check('D2 答えを決める前は出せない', E.guess(D, 0, E.randomCode('normal')) === D);
const a = E.randomCode('normal');
const b = E.randomCode('normal');
D = E.setSecret(D, 0, a);
check('D3 1人だけ決めてもまだ setup', D.phase === 'setup' && eq(D.secrets[0], a));
check('D4 決めなおしは同じ形なら通る（上書き）', E.setSecret(D, 0, b).secrets[0].join() === b.join());
check('D5 正しくない答えは通らない', E.setSecret(D, 1, ['red']) === D && E.setSecret(D, 2, b) === D);
D = E.setSecret(D, 1, b);
check('D6 2人そろうと play', D.phase === 'play' && D.turn === 0);
check('D7 決めたあとは答えを変えられない', E.setSecret(D, 0, b) === D);
const D1 = E.guess(D, 0, b);
check('D8 先の人が当てると、後の人にもう1回', D1.phase === 'play' && D1.lastChance === 1 && D1.turn === 1 && eq(D1.solved, [0]));
const D2 = E.guess(D1, 1, a);
check('D9 後の人も当てたら引き分け', D2.phase === 'end' && D2.draw && eq(D2.winners.slice().sort(), [0, 1]));
const D3 = E.guess(D1, 1, wrongOf(a));
check('D10 後の人が外したら先の人の勝ち', D3.phase === 'end' && !D3.draw && eq(D3.winners, [0]));
const D4 = E.guess(E.guess(D, 0, wrongOf(b)), 1, a);
check('D11 後の人が先に当てたら、すぐ勝ち', D4.phase === 'end' && eq(D4.winners, [1]) && D4.log.length === 2);
check('D12 target は相手', D1.log[0].target === 1 && D4.log[1].target === 0);
const R2 = E.create({ mode: 'duel', level: 'easy', n: 2, autoSecret: true, round: 1 });
check('D13 2回めは2人目が先', R2.turn === 1 && R2.phase === 'play');
const G2 = E.guess(R2, 1, R2.secrets[0]);
check('D14 2回めで2人目が当てたら1人目にもう1回', G2.lastChance === 0 && G2.turn === 0);
const AS = E.create({ mode: 'duel', level: 'easy', n: 2, autoSeats: [1] });
check('D15 端末なしの人の答えだけくじで決まる', AS.phase === 'setup' && !AS.secrets[0] && E.validCode(AS.secrets[1], 'easy'));
const AS2 = E.create({ mode: 'duel', level: 'easy', n: 2, autoSeats: [0, 1] });
check('D16 2人とも端末なしなら play', AS2.phase === 'play');

// ── 保存先から読んだ値をそろえる ──
// Realtime Database のように、空の配列と null を消し、配列を番号つきのオブジェクトにする
function store(v) {
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { const y = store(x); if (y !== undefined && y !== null) o[i] = y; });
    return Object.keys(o).length ? o : undefined;
  }
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).forEach((k) => { const y = store(v[k]); if (y !== undefined && y !== null) o[k] = y; });
    return o;
  }
  return v;
}
let N = E.normalize(store(E.create({ mode: 'duel', level: 'normal', n: 2, autoSeats: [1] })));
check('N1 空の答え・空の一覧を読める', N && N.phase === 'setup' && N.secrets[0] === null && E.validCode(N.secrets[1], 'normal') && N.log.length === 0 && N.lastChance === null);
N = E.normalize(store(E.setSecret(N, 0, a)));
check('N2 決めたあとも読める', N.phase === 'play');
N = E.normalize(store(E.guess(N, 0, E.randomCode('normal'))));
check('N3 予想のあとも読める', N.log.length === 1 && N.turn === 1 && Array.isArray(N.log[0].guess));
check('N4 壊れた値は null', E.normalize(null) === null && E.normalize({ v: 1, mode: 'x', level: 'easy', n: 2 }) === null
  && E.normalize({ v: 1, mode: 'party', level: 'easy', n: 2, phase: 'play' }) === null && E.normalize({ v: 1, mode: 'party', level: 'easy', n: 9, secrets: [a] }) === null);
const broken = store(E.guess(E.create({ mode: 'party', level: 'easy', n: 2 }), 0, ['red', 'blue', 'yellow']));
broken.log[1] = { by: 7, guess: ['x'] };
check('N5 壊れた予想の行は読み飛ばす', E.normalize(broken).log.length === 1);

// でたらめ対局を、保存して読みなおしながら最後まで進める
let playOk = true;
for (let k = 0; k < 2000 && playOk; k++) {
  const mode = k % 2 ? 'duel' : 'party';
  const level = ['easy', 'normal', 'hard'][k % 3];
  let G = E.create({ mode, level, n: mode === 'duel' ? 2 : 2 + (k % 5), round: k % 4 });
  if (G.phase === 'setup') { G = E.setSecret(G, 0, E.randomCode(level)); G = E.setSecret(G, 1, E.randomCode(level)); }
  for (let step = 0; step < 400 && G.phase === 'play'; step++) {
    const target = E.secretFor(G, G.turn);
    const code = Math.random() < 0.08 ? target : E.randomCode(level);
    const next = E.guess(G, G.turn, code);
    if (next === G) { playOk = false; break; }
    G = E.normalize(store(next));
    if (!G) { playOk = false; break; }
  }
  if (G.phase !== 'end' || !G.winners.length) playOk = false;
}
check('R1 でたらめ2000局が保存・読みなおしをはさんで最後まで進む', playOk);

console.log(`pass ${pass} / fail ${fails.length}`);
process.exit(fails.length ? 1 : 0);
