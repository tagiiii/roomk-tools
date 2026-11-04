// カンペ放送局のルールと原稿のテスト。実行: node tests/kanpe-housou/engine.test.cjs
const E = require("../../apps/kanpe-housou/engine.js");
const D = require("../../apps/kanpe-housou/data.js");
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); } };
const ids = (n) => Array.from({ length: n }, (_, i) => 'p' + i);

// 空らんの数
ok(E.blanksFor(2) === 4, 'B1 書く人2人なら空らん4つ');
ok(E.blanksFor(3) === 3 && E.blanksFor(6) === 6, 'B2 3人からは1人1つ');
ok(E.blanksFor(7) === 7, 'B3 7人なら7つ（8人で遊んだとき）');
for (let n = E.MIN; n <= E.MAX; n += 1) {
  const w = n - 1;
  const k = E.blanksFor(w);
  ok(k <= E.LINES, 'B4 行が足りる ' + n);
  const blanks = E.assign(ids(w), D.PROGRAMS[0], k);
  const per = ids(w).map((id) => blanks.filter((b) => b.writer === id).length);
  ok(per.every((c) => c >= 1) && Math.max(...per) - Math.min(...per) <= 1, 'B5 書く人みんなに1つ以上・かたよらない ' + n, per);
}

// 原稿の形
const hintKeys = Object.keys(D.HINTS);
const progIds = new Set();
D.PROGRAMS.forEach((p) => {
  ok(!progIds.has(p.id), 'P1 番組の id がかぶらない ' + p.id);
  progIds.add(p.id);
  ok(p.lines.length === E.LINES, 'P2 行は' + E.LINES + 'つ ' + p.id);
  ok(p.open && p.close && p.title && p.icon, 'P3 書き出し・締め・名前・アイコンがある ' + p.id);
  ok(!/\{/.test(p.open + p.close), 'P4 書き出しと締めに空らんはない ' + p.id);
  p.lines.forEach((line, i) => {
    const n = (line.match(/\{[a-z]+\}/g) || []).length;
    ok(n === 1, 'P5 1行に空らん1つ ' + p.id + ':' + i, line);
    ok(hintKeys.includes(E.hintOf(line)), 'P6 ヒントがある ' + p.id + ':' + i, E.hintOf(line));
    const s = E.splitLine(line);
    ok(s.before + '{' + E.hintOf(line) + '}' + s.after === line, 'P7 前と後に分けられる ' + p.id + ':' + i);
  });
});
hintKeys.forEach((k) => {
  const h = D.HINTS[k];
  ok(h.label && h.example && h.words.length >= 5, 'H1 ヒントに名前・例・おまかせ5つ以上 ' + k);
  ok(h.words.every((w) => w.length <= 12), 'H2 おまかせは12文字まで ' + k);
  ok(new Set(h.words).size === h.words.length, 'H3 おまかせがかぶらない ' + k);
});

// ふりがな（原稿とおまかせの言葉の漢字すべてに読みがある・文字は変わらない）
const kanji = /[\u4e00-\u9fff々]/;
const rubyTargets = [];
D.PROGRAMS.forEach((p) => rubyTargets.push(p.open, ...p.lines, p.close));
hintKeys.forEach((k) => rubyTargets.push(...D.HINTS[k].words));
rubyTargets.forEach((t) => {
  const parts = E.rubyParts(t, D.RUBY);
  ok(parts.map((x) => x.text).join('') === t, 'R1 ふりがなを付けても文字は変わらない', t);
  const miss = parts.filter((x) => kanji.test(x.text) && !x.rt).map((x) => x.text);
  ok(!miss.length, 'R2 漢字すべてにふりがな', t + ' ' + miss.join(''));
});
const rr = (t) => E.rubyParts(t, D.RUBY).map((x) => (x.rt ? x.text + '(' + x.rt + ')' : x.text)).join('');
ok(rr('お皿を入れてください') === 'お皿(さら)を入(い)れてください', 'R3 送りがなで読みを変える（入れ）');
ok(rr('お湯に入っています') === 'お湯(ゆ)に入(はい)っています', 'R4 送りがなで読みを変える（入っ）');
ok(rr('大好きな') === '大(だい)好(す)きな', 'R5 1字ずつの読み');
ok(rr('ABCかな') === 'ABCかな' && E.rubyParts('', D.RUBY).length === 0, 'R6 漢字がなければそのまま');
ok(rr('謎') === '謎', 'R7 辞書にない字はふりがななし');

// 番組を選ぶ
const used = [];
for (let i = 0; i < D.PROGRAMS.length; i += 1) used.push(E.pickProgram(D.PROGRAMS, used).id);
ok(new Set(used).size === D.PROGRAMS.length, 'G1 使いきるまで同じ番組は出ない');
ok(!!E.pickProgram(D.PROGRAMS, used), 'G2 使いきったら、また全部から');

// 判定
const blanks = [
  { writer: 'a', word: 'カレー', auto: false },
  { writer: 'b', word: 'ドカーン', auto: false },
  { writer: 'a', word: 'かさ', auto: false },
  { writer: 'c', word: 'パンダ', auto: true },
];
ok(E.judge({ a: 'ok', b: 'ok', c: 'laugh' }).success === true, 'J1 半分より多くが読めたなら読みきった');
ok(E.judge({ a: 'ok', b: 'laugh' }).success === false, 'J2 同じ数なら読みきったにしない');
ok(E.judge({ a: 'laugh', b: 'laugh', c: 'ok' }).success === false, 'J3 笑ったが多ければ読みきっていない');
ok(E.judge({ a: 'ok' }).success === true && E.judge({}).success === false, 'J4 1人だけ・だれもいないとき');
const j = E.judge({ a: 'ok', b: 'laugh', c: 'ok' });
ok(j.ok === 2 && j.laugh === 1, 'J5 数を数える');
let pts = E.roundPoints(blanks, 'r', true);
ok(JSON.stringify(pts) === '{"r":1}', 'P8 読みきったら読む人に1点', pts);
pts = E.roundPoints(blanks, 'r', false);
ok(pts.a === 1 && pts.b === 1 && pts.c === undefined && pts.r === undefined, 'P9 笑ったら書いた人に1点ずつ（おまかせだけの人は入らない・2つ書いても1点）', pts);

ok(JSON.stringify(E.readOrder(['x', 'y'], 2)) === '["x","y","x","y"]', 'O1 2周の順番');
ok(JSON.stringify(E.readOrder(['x', 'y', 'z'], 2, ['y'])) === '["x","z","x","z"]', 'O3 書くだけの人は読む番に入らない');
ok(D.HINTS.food.words.includes(E.omakase(D.HINTS, 'food')), 'O2 おまかせはヒントの言葉から');

console.log(`engine: ${pass} OK / ${fail} NG`);
process.exit(fail ? 1 : 0);
