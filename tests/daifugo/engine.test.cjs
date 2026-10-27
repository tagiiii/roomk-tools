// 大富豪のルールのテスト。実行: node tests/daifugo/engine.test.cjs
const E = require('../../apps/daifugo/engine.js');

let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); } };

// 手札を決めた局面を作る（場・強さの向きなども上書きできる）
function state(hands, over) {
  const n = hands.length;
  return Object.assign({
    rules: E.normRules(over && over.rules), n, hands: hands.map((h) => h.slice()),
    done: hands.map(() => false), places: [], fouls: [], passed: hands.map(() => false),
    turn: 0, field: null, rev: false, back: false, lock: null, pending: null, over: false, seq: 0,
    last: { kind: 'start', by: 0, cards: [], fx: [] },
  }, over || {}, { rules: E.normRules(over && over.rules) });
}
const fieldOf = (cards, by, rules) => ({ play: E.analyze(cards, E.normRules(rules))[0], by });

// ── 組み合わせ ──
{
  const R = E.normRules();
  ok(E.analyze(['S5'], R)[0].type === 'single', '1枚');
  ok(E.analyze(['S5', 'H5'], R)[0].type === 'group', 'ペア');
  ok(E.analyze(['S5', 'X1'], R)[0].rank === 5, 'ジョーカー入りのペアは5');
  ok(E.analyze(['S5', 'H6'], R).length === 0, 'ちがう数の2枚は出せない');
  ok(E.analyze(['S5', 'S6', 'S7'], R)[0].type === 'stairs', '階段');
  ok(E.analyze(['S5', 'H6', 'S7'], R).length === 0, 'マークがちがう階段は出せない');
  ok(E.analyze(['S5', 'S7', 'X1'], R).length === 1 && E.analyze(['S5', 'S7', 'X1'], R)[0].low === 5, 'ジョーカーで穴をうめる階段');
  ok(E.analyze(['S5', 'S6', 'X1'], R).length === 2, 'ジョーカーが端の階段は読み方が2つ');
  ok(E.analyze(['S14', 'S15', 'X1'], R).length === 1 && E.analyze(['S14', 'S15', 'X1'], R)[0].low === 13, '2より上には続かない');
  ok(E.analyze(['S5', 'S6', 'S7'], E.normRules({ stairs: false })).length === 0, '階段なしの設定');
  ok(E.analyze(['S5', 'X1', 'X2'], R)[0].type === 'group', 'ジョーカー2枚＋1枚は3枚組');
}

// ── 強さ ──
{
  const s = state([['S6', 'H4', 'X1', 'S3'], ['C9']], { field: fieldOf(['D5'], 1) });
  ok(E.check(s, 0, ['S6']).ok, '5に6は出せる');
  ok(E.check(s, 0, ['H4']).reason === 'weak', '5に4は出せない');
  ok(E.check(s, 0, ['X1']).ok, 'ジョーカーは出せる');
  const r = state([['S6', 'H4'], ['C9']], { field: fieldOf(['D5'], 1), rev: true });
  ok(E.check(r, 0, ['H4']).ok && !E.check(r, 0, ['S6']).ok, '革命中は弱い数が強い');
  const b = state([['S6', 'H4'], ['C9']], { field: fieldOf(['D5'], 1), rev: true, back: true });
  ok(E.check(b, 0, ['S6']).ok, '革命中のイレブンバックで元にもどる');
  const two = state([['S15', 'X1'], ['C9']], { field: fieldOf(['D14'], 1) });
  ok(E.check(two, 0, ['S15']).ok, 'Aに2は出せる');
  const jk = state([['S3', 'S15'], ['C9']], { field: fieldOf(['X1'], 1) });
  ok(!E.check(jk, 0, ['S15']).ok && !E.check(jk, 0, ['S3']).ok, 'ジョーカー1枚には出せない');
  const sp = state([['S3', 'H3'], ['C9']], { field: fieldOf(['X1'], 1, { spade3: true }), rules: { spade3: true } });
  ok(E.check(sp, 0, ['S3']).ok && !E.check(sp, 0, ['H3']).ok, 'スペ3返し: ♠3だけ出せる');
  const cnt = state([['S6', 'H6', 'D6'], ['C9']], { field: fieldOf(['D5', 'C5'], 1) });
  ok(E.check(cnt, 0, ['S6']).reason === 'count' && E.check(cnt, 0, ['S6', 'H6']).ok, '場と同じ枚数で出す');
  const st = state([['H6', 'H7', 'H8', 'H4', 'H5', 'H3'], ['C9']], { field: fieldOf(['S4', 'S5', 'S6'], 1) });
  ok(E.check(st, 0, ['H6', 'H7', 'H8']).ok && !E.check(st, 0, ['H3', 'H4', 'H5']).ok, '階段は強い階段で返す');
}

// ── レビューの指摘（2026-10-25） ──
{
  // 1枚＋ジョーカー2枚で、場の階段に返せる
  const st = state([['S7', 'X1', 'X2', 'C9'], ['C10']], { field: fieldOf(['H3', 'H4', 'H5'], 1), rules: { jokers: 2 } });
  const c = E.check(st, 0, ['S7', 'X1', 'X2']);
  ok(c.ok && c.play.type === 'stairs', '1枚＋ジョーカー2枚の階段で返せる', c);
  ok(E.legalPlays(st, 0).some((m) => m.cards.length === 3), '出せる手にも入る');
  // 場が空なら、同じ数3枚として出す（革命中でも階段と読まない）
  const lead = state([['S7', 'X1', 'X2', 'C9'], ['C10']], { rev: true, rules: { jokers: 2 } });
  ok(E.check(lead, 0, ['S7', 'X1', 'X2']).play.type === 'group', '場が空なら3枚組');
  // しばり中でもスペ3返し
  const sp = state([['S3', 'H3'], ['C9']], { field: fieldOf(['X1'], 1, { spade3: true }), lock: ['H'], rules: { spade3: true, lock: true } });
  ok(E.check(sp, 0, ['S3']).ok, 'しばり中でもスペ3返し');
  // 10捨てで、反則あがりのカードを捨てて手札がなくなったら最後
  let t = state([['S10', 'X1'], ['H5', 'H11'], ['D6', 'D12']], { rules: { tenDiscard: true, forbiddenFinish: true } });
  t = E.discard(E.play(t, 0, ['S10']), 0, ['X1']);
  ok(t.done[0] && t.fouls[0] === 0 && !t.places.includes(0), '10捨てで反則のカードを捨ててなくなったら反則あがり');
}

// ── パスと場が流れる ──
{
  let s = state([['S4', 'S9'], ['H5', 'H10'], ['D6', 'D11']]);
  s = E.play(s, 0, ['S4']);
  ok(s.turn === 1, '出したら次の人');
  s = E.pass(s, 1);
  ok(s.turn === 2, 'パスしたら次の人');
  s = E.pass(s, 2);
  ok(s.field === null && s.turn === 0 && s.last.flow, '全員パスで流れて、最後に出した人から');
  ok(E.pass(s, 0) === null, '場が空のときはパスできない');
  // パスした人は流れるまで出せない
  let t = state([['S4', 'S12'], ['H5', 'H13'], ['D6', 'D14']]);
  t = E.play(t, 0, ['S4']);
  t = E.pass(t, 1);
  t = E.play(t, 2, ['D6']);
  ok(t.turn === 0, 'パスした人はとばす');
  t = E.pass(t, 0);
  ok(t.field === null && t.turn === 2, '流れたら最後に出した人から');
}

// ── 8切り・革命・イレブンバック・しばり・10捨て ──
{
  let s = state([['S8', 'S9'], ['H5', 'H10'], ['D6', 'D11']], { field: fieldOf(['C5'], 2), turn: 0 });
  s = E.play(s, 0, ['S8']);
  ok(s.field === null && s.turn === 0 && s.last.fx.includes('eight'), '8切りで流れて、もう一度出せる');
  let n8 = state([['S8', 'S9'], ['H5', 'H10'], ['D6', 'D11']], { rules: { eightCut: false } });
  n8 = E.play(n8, 0, ['S8']);
  ok(n8.field && n8.turn === 1, '8切りなしの設定');

  let r = state([['S5', 'H5', 'D5', 'C5', 'S9'], ['H6'], ['D7']]);
  r = E.play(r, 0, ['S5', 'H5', 'D5', 'C5']);
  ok(r.rev && r.last.fx.includes('revolution'), '4枚で革命');
  let nr = state([['S5', 'H5', 'D5', 'C5', 'S9'], ['H6'], ['D7']], { rules: { revolution: false } });
  nr = E.play(nr, 0, ['S5', 'H5', 'D5', 'C5']);
  ok(!nr.rev, '革命なしの設定');

  let b = state([['S11', 'S9'], ['H5', 'H10'], ['D6', 'D12']], { rules: { elevenBack: true } });
  b = E.play(b, 0, ['S11']);
  ok(b.back && E.dirOf(b) === -1, 'Jでイレブンバック');
  ok(E.check(b, 1, ['H10']).ok && !E.check(b, 1, ['D12']).ok === true, 'イレブンバック中はJより弱い数');
  b = E.play(b, 1, ['H10']);
  b = E.pass(b, 2);
  b = E.pass(b, 0);
  ok(!b.back && b.field === null, '流れたらイレブンバックはおわる');

  let l = state([['S5', 'S9'], ['S6', 'H10'], ['S7', 'D12']], { rules: { lock: true } });
  l = E.play(l, 0, ['S5']);
  l = E.play(l, 1, ['S6']);
  ok(l.lock && l.lock[0] === 'S', '同じマークが続いてしばり');
  ok(E.check(l, 2, ['D12']).reason === 'lock' && E.check(l, 2, ['S7']).ok, 'しばり中は同じマークだけ');

  let t = state([['S10', 'S3', 'S4', 'S9'], ['H5', 'H11'], ['D6', 'D12']], { rules: { tenDiscard: true } });
  t = E.play(t, 0, ['S10']);
  ok(t.pending && t.pending.n === 1 && t.turn === 0, '10を出したら捨てるカードを選ぶ');
  ok(E.play(t, 1, ['H11']) === null, '捨てるのを待っている間はほかの人は出せない');
  ok(E.discard(t, 0, ['S3', 'S4']) === null, '出した10の枚数より多くは捨てられない');
  t = E.discard(t, 0, ['S3']);
  ok(t.hands[0].length === 2 && !t.pending && t.turn === 1, '1枚捨てて次の人へ');
  let t0 = state([['S10', 'S3'], ['H5', 'H11'], ['D6', 'D12']], { rules: { tenDiscard: true } });
  t0 = E.discard(E.play(t0, 0, ['S10']), 0, ['S3']);
  ok(t0.done[0] && t0.places[0] === 0, '捨てて手札がなくなったらあがり');
}

// ── あがりとおしまい ──
{
  let s = state([['S4'], ['H5', 'H10'], ['D6', 'D11']]);
  s = E.play(s, 0, ['S4']);
  ok(s.done[0] && s.places[0] === 0 && s.turn === 1, 'あがり');
  s = E.pass(s, 1);
  s = E.pass(s, 2);
  ok(s.field === null && s.turn === 1, 'あがった人のあとに流れたら、次の人から');
  s = E.play(s, 1, ['H5']);
  s = E.play(s, 2, ['D6']);
  s = E.play(s, 1, ['H10']);
  ok(s.over && s.places.join() === '0,1,2', '1人のこったらおしまい', s.places);

  // 反則あがり
  const f = state([['X1', 'S4'], ['H5']], { rules: { forbiddenFinish: true }, field: fieldOf(['C3', 'D3'], 1) });
  ok(E.check(f, 0, ['X1', 'S4']).reason === undefined || !E.check(f, 0, ['X1', 'S4']).ok, '反則あがりの形');
  const f2 = state([['S15'], ['H5', 'H6'], ['D7', 'D8']], { rules: { forbiddenFinish: true }, field: fieldOf(['C3'], 1) });
  ok(E.check(f2, 0, ['S15']).reason === 'forbidden', '2であがれない');
  const f3 = state([['S15'], ['H5', 'H6'], ['D7', 'D9']], { rules: { forbiddenFinish: true } });
  let g3 = E.play(f3, 0, ['S15']);
  ok(g3 && g3.done[0] && g3.fouls[0] === 0, '場が空でのこり1枚なら出せるが反則');
  g3 = E.pass(E.pass(g3, 1), 2);
  ok(g3.field === null && g3.turn === 1, '反則あがりのあとも流れる');
  g3 = E.play(g3, 1, ['H5']);
  g3 = E.play(g3, 2, ['D7']);
  g3 = E.pass(g3, 1);
  g3 = E.play(g3, 2, ['D9']);
  ok(g3.over && g3.places.join() === '2,1,0', '反則あがりの人は最後', g3.places);
}

// ── 呼び名・カード交換 ──
{
  ok(['大富豪', '平民', '大貧民'].join() === [0, 1, 2].map((k) => E.titleOf(3, k)).join(), '3人の呼び名');
  ok(['大富豪', '富豪', '貧民', '大貧民'].join() === [0, 1, 2, 3].map((k) => E.titleOf(4, k)).join(), '4人の呼び名');
  ok(['大富豪', '富豪', '平民', '平民', '貧民', '大貧民'].join() === [0, 1, 2, 3, 4, 5].map((k) => E.titleOf(6, k)).join(), '6人の呼び名');

  let x = 3;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const off = E.newGame(4, { exchange: false }, rnd, [2, 0, 3, 1]);
  ok(!off.exchange && off.hands[off.turn].includes('D3') && off.prev.join() === '2,0,3,1', '交換オフなら交換なし・♦3から（前回の順番は持つ）');
  const first = E.newGame(4, { exchange: true }, rnd, null);
  ok(!first.exchange && !first.prev, '1回目は交換なし');

  const prev = [2, 0, 3, 1]; // 大富豪=席2 富豪=席0 貧民=席3 大貧民=席1
  let x2 = 11;
  const rnd2 = () => { x2 = (x2 * 1103515245 + 12345) % 2147483648; return x2 / 2147483648; };
  const base = E.newGame(4, { exchange: false }, rnd2, prev);
  x2 = 11;
  const g = E.newGame(4, { exchange: true }, rnd2, prev);
  ok(g.exchange && g.exchange.pairs.length === 2, '4人は2組が交換');
  const p1 = g.exchange.pairs[0];
  ok(p1.rich === 2 && p1.poor === 1 && p1.k === 2, '大貧民から大富豪へ2枚');
  const strongest2 = base.hands[1].slice().sort((a, b) => E.rankOf(b) - E.rankOf(a)).slice(0, 2);
  ok(p1.up.every((c) => strongest2.includes(c)) && p1.up.every((c) => g.hands[2].includes(c)), '大貧民のいちばん強い2枚が大富豪へ', { up: p1.up, strongest2 });
  ok(g.exchange.pairs[1].rich === 0 && g.exchange.pairs[1].poor === 3 && g.exchange.pairs[1].k === 1, '貧民から富豪へ1枚');
  ok(g.turn === 1, '大貧民から出す');
  ok(E.play(g, 1, [g.hands[1][0]]) === null, '交換が終わるまで出せない');
  ok(E.give(g, 2, g.hands[2].slice(0, 1)) === null, '枚数がちがうとわたせない');
  ok(E.give(g, 1, g.hands[1].slice(0, 2)) === null, '下の人はえらばない');
  const back = g.hands[2].slice(0, 2);
  let h = E.give(g, 2, back);
  ok(h.exchange && back.every((c) => h.hands[1].includes(c)) && h.hands[2].length === base.hands[2].length, '大富豪が2枚返す');
  h = E.apply(h, 0, E.cpuMove(h, 0));
  ok(!h.exchange && h.exchanged.length === 2 && h.last.fx.includes('exchanged'), '全員返したら交換おわり');
  ok(h.hands.reduce((a, hh) => a + hh.length, 0) === 53 && h.hands.map((hh) => hh.length).join() === base.hands.map((hh) => hh.length).join(), '交換しても枚数は同じ');
  ok(E.check(h, 1, [h.hands[1][0]]).ok, '交換のあと大貧民が出せる');

  const g3 = E.newGame(3, { exchange: true, jokers: 0 }, rnd, [0, 1, 2]);
  ok(g3.exchange.pairs.length === 1 && g3.exchange.pairs[0].k === 2, '3人は1組2枚');
  ok(E.newGame(4, { exchange: true }, rnd, [0, 1, 2]).exchange === null, '人数が変わったら交換なし');
}

// ── でたらめ対局・CPU対局 ──
// ── 子どもの意見（2026-10-27）: 階段革命・都落ち・ジョーカーに同じ効果 ──
{
  // 階段革命: 4枚以上の階段で革命。3枚の階段ではならない。設定でオフにできる
  const five = ['S5', 'S6', 'S7', 'S8', 'S9'];
  const a = E.play(state([five.concat(['C3']), ['C9']]), 0, five);
  ok(a && a.rev && a.last.fx.includes('revolution'), '階段革命: 5枚の階段で革命');
  const a4 = E.play(state([['S5', 'S6', 'S7', 'S8', 'C3'], ['C9']]), 0, ['S5', 'S6', 'S7', 'S8']);
  ok(a4 && a4.rev, '階段革命: 4枚の階段でも革命');
  const b = E.play(state([['S5', 'S6', 'S7', 'C3'], ['C9']]), 0, ['S5', 'S6', 'S7']);
  ok(b && !b.rev, '階段革命: 3枚の階段では革命にならない');
  const c = E.play(state([five.concat(['C3']), ['C9']], { rules: { stairsRevolution: false } }), 0, five);
  ok(c && !c.rev, '階段革命: 設定でオフ');
  const d = E.play(state([five.concat(['C3']), ['C9']], { rules: { revolution: false } }), 0, five);
  ok(d && !d.rev, '階段革命: 革命がオフなら階段でも革命にならない');
  const e = E.play(state([five.concat(['C3']), ['C9']], { rev: true }), 0, five);
  ok(e && !e.rev && e.last.fx.includes('revolution-back'), '階段革命: 革命中は革命返し');
  const jk = ['S5', 'S6', 'S7', 'X1'];
  const f = E.play(state([jk.concat(['C3']), ['C9']]), 0, jk);
  ok(f && f.rev, '階段革命: ジョーカー入りの4枚でも革命');

  // ジョーカーに同じ効果: いっしょに出した数として数える
  const R = E.normRules({ tenDiscard: true, elevenBack: true });
  ok(E.analyze(['S10', 'X1'], R)[0].tens === 2, 'ジョーカー: 10＋ジョーカーは10が2枚');
  ok(E.analyze(['S11', 'X1', 'X2'], R)[0].jacks === 3, 'ジョーカー: J＋ジョーカー2枚はJが3枚');
  ok(E.analyze(['S8', 'X1'], R)[0].eight, 'ジョーカー: 8＋ジョーカーは8切り');
  ok(!E.analyze(['X1'], R)[0].eight && E.analyze(['X1'], R)[0].tens === 0, 'ジョーカー: 1枚だけなら効果はない');
  ok(!E.analyze(['S9', 'X1'], R)[0].eight && E.analyze(['S9', 'X1'], R)[0].tens === 0, 'ジョーカー: 9＋ジョーカーは9');
  const st = E.analyze(['S6', 'S7', 'X1'], R);
  ok(st.length === 2 && st.find((r) => r.low === 6).eight && !st.find((r) => r.low === 5).eight, 'ジョーカー: 階段の8の位置なら8切り');
  const g = E.play(state([['S10', 'X1', 'C3', 'C4'], ['C9']], { rules: { tenDiscard: true } }), 0, ['S10', 'X1']);
  ok(g && g.pending && g.pending.n === 2, 'ジョーカー: 10＋ジョーカーで2枚捨てられる');
  const h = E.play(state([['S6', 'S7', 'X1', 'C3'], ['C9']]), 0, ['S6', 'S7', 'X1']);
  ok(h && h.last.flow && h.turn === 0 && h.last.fx.includes('eight'), 'ジョーカー: 6・7・ジョーカーは 6・7・8 と読んで8切り');
  const i = E.play(state([['S9', 'X1', 'C3'], ['C9']], { rules: { tenDiscard: true } }), 0, ['S9', 'X1']);
  ok(i && !i.pending, 'ジョーカー: 9＋ジョーカーでは捨てられない');
  const j = E.play(state([['S11', 'X1', 'C3'], ['C9']], { rules: { elevenBack: true } }), 0, ['S11', 'X1']);
  ok(j && j.back, 'ジョーカー: J＋ジョーカーでイレブンバック');
  const k = E.play(state([['X1', 'C3'], ['C9']], { rules: { tenDiscard: true, eightCut: true } }), 0, ['X1']);
  ok(k && !k.pending && !k.last.flow, 'ジョーカー: 1枚だけ出しても10捨て・8切りにならない');

  // ジョーカーだけで出すとき「何として出すか」（as）。強さは変わらず、効果だけつく
  const AR = { eightCut: true, tenDiscard: true, elevenBack: true };
  ok(JSON.stringify(E.asOptions(E.normRules(AR))) === '[8,10,11]' && E.asOptions(E.normRules({ tenDiscard: false })).join() === '8', 'as: 選べる数はオンのルールの分だけ');
  const a10 = E.play(state([['X1', 'C3', 'C4'], ['C9']], { rules: AR }), 0, ['X1'], 10);
  ok(a10 && a10.pending && a10.pending.n === 1 && a10.last.as === 10 && a10.field.play.as === 10, 'as: 10として出すと1枚捨てられる');
  const a8 = E.play(state([['X1', 'C3'], ['C9']], { rules: AR }), 0, ['X1'], 8);
  ok(a8 && a8.last.flow && a8.turn === 0 && a8.last.fx.includes('eight'), 'as: 8として出すと8切り');
  const a11 = E.play(state([['X1', 'C3'], ['C9']], { rules: AR }), 0, ['X1'], 11);
  ok(a11 && a11.back && !a11.last.flow, 'as: Jとして出すとイレブンバック');
  const a0 = E.play(state([['X1', 'C3'], ['C9']], { rules: AR }), 0, ['X1']);
  ok(a0 && !a0.pending && !a0.last.flow && !a0.back && a0.last.as === undefined, 'as: 選ばなければ効果なし');
  const aOff = E.play(state([['X1', 'C3'], ['C9']], { rules: { tenDiscard: false } }), 0, ['X1'], 10);
  ok(aOff && !aOff.pending && aOff.last.as === undefined, 'as: オフのルールの数は無視');
  const aNat = E.play(state([['S9', 'C3'], ['C9']], { rules: AR }), 0, ['S9'], 10);
  ok(aNat && !aNat.pending && aNat.last.as === undefined, 'as: ジョーカー以外では無視');
  const a2 = E.play(state([['X1', 'X2', 'C3', 'C4', 'C5'], ['C9']], { rules: Object.assign({ jokers: 2 }, AR) }), 0, ['X1', 'X2'], 10);
  ok(a2 && a2.pending && a2.pending.n === 2, 'as: ジョーカー2枚を10として出すと2枚捨てられる');
  const aMv = E.apply(state([['X1', 'C3', 'C4'], ['C9']], { rules: AR }), 0, { kind: 'play', cards: ['X1'], as: 10 });
  ok(aMv && aMv.pending && aMv.pending.n === 1, 'as: apply の手にも as を渡せる');
  const aStr = E.play(state([['X1', 'C3'], ['C9']], { rules: AR, field: fieldOf(['S15'], 1) }), 0, ['X1'], 8);
  ok(aStr && aStr.last.flow, 'as: 2の上にも出せて、8として8切り');
  const aLast = E.play(state([['X1'], ['C9']], { rules: AR }), 0, ['X1'], 10);
  ok(aLast && aLast.done[0] && !aLast.pending, 'as: 最後の1枚を10として出しても、捨てる手札がなければそのままあがり');

  // 都落ち: 前回の大富豪（prev[0]）が1番にあがれなかったら、その場で抜けて最後
  const M = { rules: { miyakoOchi: true }, prev: [2, 0, 1, 3] };
  const m1 = E.play(state([['S5'], ['C9', 'C10'], ['D7', 'D8'], ['H4', 'H5']], M), 0, ['S5']);
  ok(m1 && m1.done[2] && m1.fallen === 2 && m1.hands[2].length === 0 && m1.last.fx.includes('fallen'), '都落ち: 前回の大富豪が抜ける');
  ok(m1 && !m1.over && m1.turn === 1, '都落ち: 4人なら続く。次の人の番');
  ok(m1 && m1.places.length === 1, '都落ち: あがった順にはまだ入れない');
  let m2 = E.play(m1, 1, ['C10']);
  m2 = E.pass(m2, 3);
  ok(m2 && m2.last.flow && m2.turn === 1, '都落ち: 抜けた人はパスの数に入らず、場が流れる');
  m2 = E.play(m2, 1, ['C9']);
  ok(m2 && m2.over && JSON.stringify(m2.places) === '[0,1,3,2]', '都落ち: 都落ちの人がいちばん最後', m2 && m2.places);
  const m3 = E.play(state([['S5'], ['C9', 'C10'], ['D7', 'D8']], { rules: { miyakoOchi: true }, prev: [2, 0, 1] }), 0, ['S5']);
  ok(m3 && m3.over && JSON.stringify(m3.places) === '[0,1,2]', '都落ち: 3人なら、そのままおしまい', m3 && m3.places);
  const m4 = E.play(state([['S5'], ['C9', 'C10'], ['D7', 'D8']], { rules: { miyakoOchi: true }, prev: [0, 1, 2] }), 0, ['S5']);
  ok(m4 && m4.fallen == null && !m4.done[1] && !m4.done[2], '都落ち: 前回の大富豪が1番なら何も起きない');
  const m5 = E.play(state([['S5'], ['C9', 'C10'], ['D7', 'D8']], { rules: { miyakoOchi: false }, prev: [2, 0, 1] }), 0, ['S5']);
  ok(m5 && m5.fallen == null && !m5.done[2], '都落ち: 設定がオフなら何も起きない');
  const m6 = E.play(state([['S5'], ['C9', 'C10'], ['D7', 'D8']], { rules: { miyakoOchi: true } }), 0, ['S5']);
  ok(m6 && m6.fallen == null && !m6.done[2], '都落ち: 前回のあがり順がなければ何も起きない');
  // 反則あがりが先でも、本当の1番が出たときに都落ち
  const m7a = E.play(state([['S15'], ['C9', 'C10'], ['D7', 'D8'], ['H11']], { rules: { miyakoOchi: true, forbiddenFinish: true }, prev: [2, 0, 1, 3] }), 0, ['S15']);
  ok(m7a && m7a.fouls.includes(0) && m7a.fallen == null, '都落ち: 反則あがりでは起きない');
  let m7b = E.pass(E.pass(E.pass(m7a, 1), 2), 3);
  ok(m7b && m7b.turn === 1 && m7b.last.flow, '都落ち: 反則あがりのあと、場が流れて次の人から');
  m7b = E.play(E.pass(E.play(m7b, 1, ['C9']), 2), 3, ['H11']);
  ok(m7b && m7b.fallen === 2 && m7b.over && JSON.stringify(m7b.places) === '[3,1,0,2]', '都落ち: 反則あがりのあとの1番で都落ち。反則の人より後ろ', m7b && m7b.places);
  // 10捨てで手札がなくなってあがったときも都落ち
  const m8 = E.discard(E.play(state([['S10', 'C3'], ['C9', 'C10'], ['D7', 'D8']], { rules: { miyakoOchi: true, tenDiscard: true }, prev: [1, 0, 2] }), 0, ['S10']), 0, ['C3']);
  ok(m8 && m8.fallen === 1 && m8.over, '都落ち: 10捨てであがったときも');

  // 都落ちありで続けて40回（CPU同士）
  let y = 9;
  const r4 = () => { y = (y * 1103515245 + 12345) % 2147483648; return y / 2147483648; };
  let prevPlaces = null;
  let rounds = 0;
  let fell = 0;
  for (let kk = 0; kk < 40; kk += 1) {
    const n = 3 + Math.floor(kk / 10); // 10回ずつ同じ人数（前回のあがり順が使われるように）
    if (prevPlaces && prevPlaces.length !== n) prevPlaces = null;
    let s = E.newGame(n, { miyakoOchi: true, exchange: kk % 2 === 0, tenDiscard: true, jokers: 2 }, r4, prevPlaces);
    let steps = 0;
    while (!s.over && steps < 3000) {
      steps += 1;
      const ex = s.exchange && s.exchange.pairs.find((pp) => !pp.down);
      const p = ex ? ex.rich : s.pending ? s.pending.by : s.turn;
      const ns = E.apply(s, p, E.cpuMove(s, p));
      if (!ns) break;
      s = ns;
      if (!s.over && s.done[s.turn]) break;
    }
    if (!s.over || new Set(s.places).size !== n || s.places.length !== n) break;
    if (s.fallen != null) { fell += 1; if (s.places[n - 1] !== s.fallen) break; }
    rounds += 1;
    prevPlaces = s.places;
  }
  ok(rounds === 40, '都落ちありで40回続けて最後までいく', rounds);
  ok(fell > 0, '都落ちありの40回で、都落ちが起きた回がある', fell);
}

function playout(n, rules, seed, useCpu) {
  let x = seed;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  let s = E.newGame(n, rules, rnd);
  const total = s.hands.reduce((a, h) => a + h.length, 0);
  let steps = 0;
  let discarded = 0;
  while (!s.over && steps < 2000) {
    steps += 1;
    const p = s.pending ? s.pending.by : s.turn;
    let mv;
    if (useCpu) mv = E.cpuMove(s, p);
    else if (s.pending) mv = { kind: 'discard', cards: s.hands[p].slice(0, Math.floor(rnd() * (s.pending.n + 1))) };
    else {
      const legal = E.legalPlays(s, p);
      if (s.field && (rnd() < 0.3 || !legal.length)) mv = { kind: 'pass' };
      else mv = { kind: 'play', cards: legal[Math.floor(rnd() * legal.length)].cards };
    }
    const ns = E.apply(s, p, mv);
    if (!ns) return { err: 'apply failed', s, mv, p };
    if (mv.kind === 'discard') discarded += mv.cards.length;
    s = ns;
    if (!s.over && s.done[s.turn]) return { err: 'turn on done player', s };
    if (!s.over && s.turn < 0) return { err: 'no turn', s };
  }
  if (!s.over) return { err: 'not over', s };
  const left = s.hands.reduce((a, h) => a + h.length, 0);
  if (new Set(s.places).size !== n || s.places.length !== n) return { err: 'places', s };
  return { ok: true, steps, total, left, discarded };
}
{
  const ruleSets = [
    {},
    { lock: true, elevenBack: true, tenDiscard: true, spade3: true, forbiddenFinish: true, jokers: 2 },
    { stairs: false, revolution: false, eightCut: false, jokers: 0 },
    { tenDiscard: true, jokers: 2, forbiddenFinish: true },
  ];
  let bad = 0;
  let first = null;
  for (let i = 0; i < 1200; i += 1) {
    const n = 3 + (i % 4);
    const rules = ruleSets[i % ruleSets.length];
    const r = playout(n, rules, 1000 + i, i % 2 === 0);
    if (!r.ok) { bad += 1; if (!first) first = { i, n, rules, err: r.err, mv: r.mv, last: r.s && r.s.last }; }
  }
  ok(bad === 0, 'でたらめ対局・CPU対局1200回が最後までいく', first);

  // 交換ありで続けて10回（CPU同士）
  let y = 5;
  const r3 = () => { y = (y * 1103515245 + 12345) % 2147483648; return y / 2147483648; };
  let prevPlaces = null;
  let rounds = 0;
  for (let k = 0; k < 40; k += 1) {
    const n = 3 + (k % 4);
    if (prevPlaces && prevPlaces.length !== n) prevPlaces = null;
    let s = E.newGame(n, { exchange: true, tenDiscard: true }, r3, prevPlaces);
    let steps = 0;
    while (!s.over && steps < 3000) {
      steps += 1;
      const ex = s.exchange && s.exchange.pairs.find((pp) => !pp.down);
      const p = ex ? ex.rich : s.pending ? s.pending.by : s.turn;
      const ns = E.apply(s, p, E.cpuMove(s, p));
      if (!ns) break;
      s = ns;
    }
    if (s.over) { rounds += 1; prevPlaces = s.places; } else break;
  }
  ok(rounds === 40, '交換ありで40回続けて最後までいく', rounds);
}

console.log(fail ? `NG ${fail} / OK ${pass}` : `OK ${pass}`);
process.exit(fail ? 1 : 0);
