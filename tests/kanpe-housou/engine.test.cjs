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

// 番組を選ぶ
const used = [];
for (let i = 0; i < D.PROGRAMS.length; i += 1) used.push(E.pickProgram(D.PROGRAMS, used).id);
ok(new Set(used).size === D.PROGRAMS.length, 'G1 使いきるまで同じ番組は出ない');
ok(!!E.pickProgram(D.PROGRAMS, used), 'G2 使いきったら、また全部から');

// 「笑った！」
const blanks = [
  { writer: 'a', word: 'カレー', auto: false },
  { writer: 'b', word: 'ドカーン', auto: false },
  { writer: 'a', word: 'かさ', auto: false },
  { writer: 'c', word: 'パンダ', auto: true },
];
ok(!E.canLaugh(blanks, 0, 'a') && E.canLaugh(blanks, 1, 'a'), 'L1 自分の言葉には押せない');
ok(!E.canLaugh(blanks, 3, 'r'), 'L2 おまかせの言葉には押せない');
ok(E.canLaugh(blanks, 0, 'r') && !E.canLaugh(blanks, 9, 'r'), 'L3 読む人は押せる・ない空らんには押せない');
let t = E.tally(blanks, { 1: ['r', 'a'], 0: ['b'] });
ok(JSON.stringify(t.top) === '[1]' && t.counts[1] === 2, 'L4 いちばん多い言葉');
t = E.tally(blanks, { 0: ['r'], 1: ['a'] });
ok(JSON.stringify(t.top) === '[0,1]', 'L5 同じ数ならどちらも');
ok(E.tally(blanks, {}).top.length === 0, 'L6 だれも押さなければ空');
t = E.tally(blanks, { 0: ['a', 'a'], 3: ['r', 'b'] });
ok(t.top.length === 0, 'L7 書いた本人とおまかせの分は数えない', t);
const pts = E.pointsFrom(blanks, [1, 2, 1, 3]);
ok(pts.a === 2 && pts.b === 2 && pts.c === undefined, 'L8 書いた人ごとの数（おまかせは数えない）', pts);

ok(JSON.stringify(E.readOrder(['x', 'y'], 2)) === '["x","y","x","y"]', 'O1 2周の順番');
ok(JSON.stringify(E.readOrder(['x', 'y', 'z'], 2, ['y'])) === '["x","z","x","z"]', 'O3 書くだけの人は読む番に入らない');
ok(D.HINTS.food.words.includes(E.omakase(D.HINTS, 'food')), 'O2 おまかせはヒントの言葉から');

console.log(`engine: ${pass} OK / ${fail} NG`);
process.exit(fail ? 1 : 0);
