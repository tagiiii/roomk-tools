/* キャリアすごろく エンジンの自動テスト（Node で実行: node tests/career-sugoroku/engine.test.js）
 * 1) 決め打ちシナリオ: スキップ・休憩・復帰・コラボ・最後の1周・仕上げのサイコロ・準備チップ・タイマーなど
 * 2) ランダム対戦: 1〜8人×設定の組み合わせを最後まで遊び、不変条件を毎手確認
 *    （Realtime Database を通したときの形の変化も毎手まねる）
 */
'use strict';
const assert = require('assert');
const D = require('../../apps/career-sugoroku/data.js');
const E = require('../../apps/career-sugoroku/engine.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error('FAIL:', name);
    throw err;
  }
}

// RTDB を通したときの形の変化をまねる（null・空配列・空オブジェクトは消える）
function rtdb(value) {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    const out = value.map(rtdb);
    if (out.every((x) => x === undefined)) return undefined;
    // 途中が消えた配列はオブジェクトになることがあるが、ここでは配列のまま詰めずに残す
    return out.some((x) => x === undefined) ? Object.fromEntries(out.map((x, i) => [i, x]).filter(([, x]) => x !== undefined)) : out;
  }
  if (typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k, v]) => {
      const r = rtdb(v);
      if (r !== undefined) out[k] = r;
    });
    return Object.keys(out).length ? out : undefined;
  }
  return value;
}

let clock = 1_000_000;
let seedCounter = 1;
function act(game, action, opts = {}) {
  clock += opts.dt != null ? opts.dt : 1000;
  const res = E.apply(game, action, { now: clock, seed: opts.seed != null ? opts.seed : (seedCounter++ * 2654435761) >>> 0 });
  if (opts.expectFail) {
    assert.strictEqual(res.ok, false, `expected failure for ${action.t}`);
    return game;
  }
  assert.ok(res.ok, `${action.t} failed: ${res.reason}`);
  // RTDB を往復させた形で次に進む（実際の同期と同じ条件）
  const stored = rtdb(E.serialize(res.game));
  const back = E.normalize(stored);
  assert.deepStrictEqual(back, E.normalize(E.serialize(res.game)), `round trip mismatch after ${action.t}`);
  return back;
}

function setupGame({ players = 2, hostPlays = false, proxies = 0, settings = {} } = {}) {
  let g = E.normalize(E.serialize(E.newGame({ hostId: 'H', hostName: 'ホスト', hostPlays, now: clock })));
  for (let i = 0; i < players; i++) g = act(g, { t: 'JOIN', by: `P${i}`, pid: `P${i}`, name: `ひと${i}` });
  for (let i = 0; i < proxies; i++) g = act(g, { t: 'ADD_PROXY', by: 'H', pid: `X${i}`, name: `代理${i}` });
  if (Object.keys(settings).length) g = act(g, { t: 'SETTINGS', by: 'H', patch: settings });
  g = act(g, { t: 'START', by: 'H' });
  return g;
}

function finishSetup(g) {
  g.order.forEach((pid) => {
    g = act(g, { t: 'IDEAL', by: pid, pid, job: 3 });
    g = act(g, { t: 'DEAL_OK', by: pid, pid });
    const cand = g.players[pid].setup.cands[0];
    g = act(g, { t: 'GOAL', by: pid, pid, job: cand });
  });
  return act(g, { t: 'BEGIN', by: 'H' });
}

// 現在の手番を「最短」で終える（ロール→選択→判定→終了）
function playTurnSimply(g, { acceptInvite = true } = {}) {
  for (let i = 0; i < 20 && g.turn; i++) {
    const t = g.turn;
    const id = t.id;
    const by = t.pid;
    if (t.stage === 'roll') g = act(g, { t: 'ROLL', by, g: { turn: id } });
    else if (t.stage === 'fork') g = act(g, { t: 'FORK', by, b: 0, g: { turn: id } });
    else if (t.stage === 'act') {
      if (t.sq.eff === 'life') g = act(g, { t: 'PICK', by, i: 0, g: { turn: id } });
      else g = act(g, { t: 'PICK', by, i: 0, g: { turn: id } });
    } else if (t.stage === 'partner') {
      const cands = E.eligiblePartners(g, t.sq.scene);
      g = act(g, { t: 'PARTNER', by, to: cands[0] || '', g: { turn: id } });
    } else if (t.stage === 'invite') {
      g = act(g, { t: 'RESPOND', by: t.inv.pid, accept: acceptInvite, g: { turn: id } });
    } else if (t.stage === 'challenge') {
      const m = t.ch.members.find((x) => !t.ch.st[x].done);
      const s = t.ch.st[m];
      const scene = E.sceneOf(t.ch);
      if (s.tier === 'mid') g = act(g, { t: 'CH_REWARD', by: m, pid: m, a: s.rw[0], g: { turn: id } });
      else if (s.pick < 0) {
        const i = scene.opts.findIndex(([, a]) => E.below(g.players[m], a));
        g = act(g, { t: 'CH_PICK', by: m, pid: m, i, g: { turn: id } });
      } else g = act(g, { t: 'CH_ROLL', by: m, pid: m, g: { turn: id } });
    } else if (t.stage === 'result') {
      g = act(g, { t: 'END_TURN', by, g: { turn: id } });
      return g;
    }
    if (g.turn && g.turn.id !== id) return g;
  }
  return g;
}

function playCareer(g) {
  Object.keys(g.career.st).forEach((pid) => {
    if (!g.career || g.career.st[pid].done) return;
    const route = D.CAREERS[g.career.stage].routes[0];
    g = act(g, { t: 'CR_ROUTE', by: pid, pid, route: route.id });
    const p = g.players[pid];
    const i = route.acts.findIndex(([, a]) => E.below(p, a));
    if (i >= 0) g = act(g, { t: 'CR_ACT', by: pid, pid, i });
    else g = act(g, { t: 'CR_PASS', by: pid, pid });
  });
  return g;
}

function playUntilFinal(g, limit = 400) {
  for (let i = 0; i < limit && g.phase === 'main'; i++) {
    if (g.career) g = playCareer(g);
    else if (g.turn) g = playTurnSimply(g);
    else if (g.hold) g = act(g, { t: 'END_NOW', by: 'H' });
  }
  return g;
}

function checkInvariants(g) {
  Object.values(g.players).forEach((p) => {
    assert.ok(p.chips >= 0, `chips negative ${p.id}`);
    p.apt.forEach((x) => assert.ok(x >= 0 && x <= D.APT_CAP, `apt out of range ${p.id}`));
    assert.strictEqual(new Set(p.jobs).size, p.jobs.length, `duplicate jobs ${p.id}`);
    p.jobs.forEach((j) => assert.ok(D.JOBS[j], 'invalid job'));
    if (p.goal >= 0) assert.ok(p.jobs.includes(p.goal), 'goal not held');
  });
  if (g.phase === 'main') {
    const states = [!!g.turn, !!g.career, !!g.hold].filter(Boolean).length;
    assert.strictEqual(states, 1, `main phase must have exactly one of turn/career/hold (turn=${!!g.turn} career=${!!g.career} hold=${g.hold})`);
    if (g.turn) {
      assert.ok(g.order.includes(g.turn.pid));
      assert.strictEqual(g.players[g.turn.pid].status, 'active', 'turn player must be active');
    }
  }
  assert.ok(g.log.length <= 60);
}

// ── 1) 決め打ちシナリオ ─────────────────────────────
test('score formula and maxima', () => {
  // 適性の上限は4枚（2026-09-28 オーナー決定）→ 最大 4×2＋4＋4＋3＝19点
  assert.strictEqual(D.APT_CAP, 4);
  assert.strictEqual(E.MAX_SCORE, 19);
  D.JOBS.forEach((j) => {
    const apt = [0, 0, 0, 0, 0, 0];
    apt[j.core] = D.APT_CAP; apt[j.rel[0]] = D.APT_CAP; apt[j.rel[1]] = D.APT_CAP;
    assert.strictEqual(E.score(apt, j.id).total, E.MAX_SCORE);
  });
  // 設計メモの手札A: アイデア2 気づく1 もの3 コミュ1 協力0 工夫1
  const A = [2, 1, 3, 1, 0, 1];
  assert.strictEqual(E.score(A, 0).total, 12); // イラストレーター
  assert.strictEqual(E.score(A, 1).total, 9);  // ゲームプランナー
  assert.strictEqual(E.score(A, 2).total, 9);  // 写真家
  assert.strictEqual(E.score(A, 3).total, 3);  // ツアーガイド
  assert.strictEqual(E.score(A, 4).total, 3);  // イベントプランナー
  assert.strictEqual(E.score(A, 5).total, 5);  // エンジニア
  const B = [1, 1, 0, 3, 2, 1];
  assert.strictEqual(E.score(B, 0).total, 2);
  assert.strictEqual(E.score(B, 1).total, 9);
  assert.strictEqual(E.score(B, 2).total, 3);
  assert.strictEqual(E.score(B, 3).total, 12);
  assert.strictEqual(E.score(B, 4).total, 11);
  assert.strictEqual(E.score(B, 5).total, 4);
  // 各適性は2点枠に4回、1点枠に8回
  for (let a = 0; a < 6; a++) {
    assert.strictEqual(D.JOBS.filter((j) => j.core === a).length, 4);
    assert.strictEqual(D.JOBS.filter((j) => j.rel.includes(a)).length, 8);
  }
});

test('present roll: 0-3 points from die + prep chips; a 3-point gap cannot be overtaken', () => {
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7, 8].map(E.presentBonus), [0, 0, 1, 1, 2, 2, 3, 3]);
  // どの組み合わせでも、入れ替わりの幅は最大3点（3点差は同点まで、2点差までは逆転しうる）
  let maxSwing = 0;
  for (let prepA = 0; prepA <= 2; prepA++) for (let prepB = 0; prepB <= 2; prepB++) {
    for (let da = 1; da <= 6; da++) for (let db = 1; db <= 6; db++) {
      maxSwing = Math.max(maxSwing, E.presentBonus(db + prepB) - E.presentBonus(da + prepA));
    }
  }
  assert.strictEqual(maxSwing, 3);
  // 準備チップなしなら最大＋2（＋3には準備が要る）
  assert.strictEqual(Math.max(...[1, 2, 3, 4, 5, 6].map((d) => E.presentBonus(d))), 2);
  // ガイド用の差分: 中心は＋2、3種類がそろう1枚は＋4
  const apt = [0, 0, 2, 0, 0, 0];
  assert.strictEqual(E.aptRole(0, 2), 'core');
  assert.strictEqual(E.gainDelta(apt, 0, 2, 1), 2); // イラストレーター: ものづくり(中心)
  assert.strictEqual(E.gainDelta([1, 0, 2, 0, 0, 0], 0, 1, 1), 4); // 気づく力で3種類そろう(+1+3)
  assert.strictEqual(E.gainDelta([3, 3, 3, 0, 0, 0], 0, 2, 1), 2); // 4枚目もふえる（中心＋2）
  assert.strictEqual(E.gainDelta([4, 4, 4, 0, 0, 0], 0, 2, 1), 0); // 上限
});

test('board graph: every node reachable, forks rejoin, 20 steps per lap', () => {
  D.NODES.forEach((n, i) => { assert.strictEqual(n.id, i); n.next.forEach((x) => assert.ok(D.NODES[x])); });
  const seen = new Set();
  const stack = [D.START_NODE];
  while (stack.length) { const x = stack.pop(); if (seen.has(x)) continue; seen.add(x); D.NODES[x].next.forEach((y) => stack.push(y)); }
  assert.strictEqual(seen.size, D.NODES.length);
  // どの道を選んでも1周は20マス
  function lapLen(choiceA, choiceB) {
    let pos = D.START_NODE; let steps = 0;
    do {
      const n = D.NODES[pos];
      pos = n.next.length > 1 ? n.next[n.id === 5 ? choiceA : choiceB] : n.next[0];
      steps += 1;
    } while (pos !== D.START_NODE && steps < 100);
    return steps;
  }
  [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([a, b]) => assert.strictEqual(lapLen(a, b), 20));
});

test('content: every event/collab/life/career option targets a valid aptitude', () => {
  [...D.EVENTS, ...D.COLLABS, ...D.LIVES].forEach((e) => e.opts.forEach(([text, a]) => {
    assert.ok(text.length > 0); assert.ok(a >= 0 && a < 6);
  }));
  Object.values(D.CAREERS).forEach((c) => [...c.routes, c.common].forEach((r) => r.acts.forEach(([, a]) => assert.ok(a >= 0 && a < 6))));
  // 進路は各段で6種類すべての適性に届く
  Object.values(D.CAREERS).forEach((c) => {
    const s = new Set(); c.routes.forEach((r) => r.acts.forEach(([, a]) => s.add(a)));
    assert.strictEqual(s.size, 6);
  });
});

test('lobby: join, name rules, cap 8, host plays toggle, recommended chips', () => {
  let g = E.normalize(E.serialize(E.newGame({ hostId: 'H', hostName: 'ホスト', hostPlays: true, now: clock })));
  assert.strictEqual(Object.keys(g.players).length, 1);
  g = act(g, { t: 'JOIN', by: 'A', pid: 'A', name: 'ホスト' }, { expectFail: true });
  g = act(g, { t: 'JOIN', by: 'A', pid: 'A', name: 'あいうえおかきくけ' }, { expectFail: true }); // 9文字
  g = act(g, { t: 'JOIN', by: 'A', pid: 'A', name: '  そら ' });
  assert.strictEqual(g.players.A.name, 'そら');
  g = act(g, { t: 'JOIN', by: 'B', pid: 'B', name: 'そら' }, { expectFail: true });
  for (let i = 0; i < 6; i++) g = act(g, { t: 'JOIN', by: `Q${i}`, pid: `Q${i}`, name: `q${i}` });
  assert.strictEqual(Object.keys(g.players).length, 8);
  g = act(g, { t: 'JOIN', by: 'Z', pid: 'Z', name: 'z' }, { expectFail: true });
  assert.strictEqual(g.settings.chips, 4); // 8人の推奨
  g = act(g, { t: 'SET_HOST_PLAYS', by: 'H', plays: false });
  assert.strictEqual(Object.keys(g.players).length, 7);
  assert.strictEqual(g.settings.chips, 4);
  g = act(g, { t: 'SETTINGS', by: 'A', patch: { chips: 10 } }, { expectFail: true }); // ホスト以外は不可
  g = act(g, { t: 'SETTINGS', by: 'H', patch: { chips: 10 } });
  assert.strictEqual(g.settings.chips, 10);
  assert.strictEqual(g.settings.career, 2);
  g = act(g, { t: 'START', by: 'H' });
  assert.strictEqual(g.phase, 'setup');
  assert.strictEqual(g.order.length, 7);
  assert.ok(!g.order.includes('H'));
  g = act(g, { t: 'JOIN', by: 'Y', pid: 'Y', name: 'y' }, { expectFail: true }); // 開始後は見学へ
});

test('setup: ideal/undecided, deal 3 distinct, goal from candidates, begin gating', () => {
  let g = setupGame({ players: 2 });
  g = act(g, { t: 'IDEAL', by: 'P0', pid: 'P0', job: 5 });
  const p0 = g.players.P0;
  assert.deepStrictEqual(p0.jobs, [5]);
  assert.strictEqual(p0.apt.reduce((s, x) => s + x, 0), 3);
  assert.strictEqual(new Set(p0.setup.dealt).size, 3);
  assert.ok(!p0.setup.cands.includes(5));
  g = act(g, { t: 'IDEAL', by: 'P1', pid: 'P1', job: -1 });
  assert.strictEqual(g.players.P1.ideal, -1);
  assert.strictEqual(g.players.P1.jobs.length, 1);
  g = act(g, { t: 'BEGIN', by: 'H' }, { expectFail: true });
  g = act(g, { t: 'DEAL_OK', by: 'P0', pid: 'P0' });
  g = act(g, { t: 'GOAL', by: 'P0', pid: 'P0', job: 99 }, { expectFail: true });
  g = act(g, { t: 'GOAL', by: 'P0', pid: 'P0', job: g.players.P0.setup.cands[1] });
  assert.strictEqual(g.players.P0.jobs.length, 2);
  // P1 が未完了のまま締め切る → あとで目標を選べる
  g = act(g, { t: 'BEGIN', by: 'H', force: true });
  assert.strictEqual(g.phase, 'main');
  assert.ok(g.players.P1.setup.goalPending);
  const late = g.players.P1.setup.cands[0];
  g = act(g, { t: 'GOAL', by: 'P1', pid: 'P1', job: late });
  assert.strictEqual(g.players.P1.goal, late);
  assert.ok(!g.players.P1.setup.goalPending);
});

test('turn: chip consumed once even when skipped; guard blocks double skip', () => {
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 6, career: 0 } }));
  const first = g.turn.pid;
  const id = g.turn.id;
  assert.strictEqual(g.players[first].chips, 5);
  g = act(g, { t: 'SKIP', by: first, g: { turn: id } });
  assert.strictEqual(g.players[first].chips, 5);
  const second = g.turn.pid;
  assert.notStrictEqual(second, first);
  g = act(g, { t: 'SKIP', by: 'H', g: { turn: id } }, { expectFail: true }); // 古い手番への二重スキップ
  assert.strictEqual(g.turn.pid, second);
  g = act(g, { t: 'ROLL', by: first, g: { turn: g.turn.id } }, { expectFail: true }); // 他人の手番
});

test('rest auto-skips with chip use; all resting holds; return resumes', () => {
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 6, career: 0 } }));
  const [a, b] = [g.turn.pid, g.order.find((x) => x !== g.turn.pid)];
  g = act(g, { t: 'STATUS', by: b, pid: b, to: 'resting' });
  const bChips = g.players[b].chips;
  g = playTurnSimply(g); // a の手番を終える → b は自動スキップ → a の番
  assert.strictEqual(g.turn.pid, a);
  assert.strictEqual(g.players[b].chips, bChips - 1);
  g = act(g, { t: 'STATUS', by: a, pid: a, to: 'resting' });
  assert.strictEqual(g.turn, null);
  assert.strictEqual(g.hold, 'allResting');
  const chipsBefore = g.players[a].chips + g.players[b].chips;
  g = act(g, { t: 'STATUS', by: b, pid: b, to: 'active' });
  assert.ok(g.turn);
  assert.strictEqual(g.turn.pid, b);
  assert.ok(g.players[a].chips + g.players[b].chips >= chipsBefore - 2);
});

test('leave: removed from turns and invites; cards kept; can be restored', () => {
  let g = finishSetup(setupGame({ players: 3, settings: { chips: 6, career: 0 } }));
  const leaver = g.order[2];
  const apt = g.players[leaver].apt.slice();
  g = act(g, { t: 'STATUS', by: leaver, pid: leaver, to: 'left' });
  assert.deepStrictEqual(g.players[leaver].apt, apt);
  for (let i = 0; i < 6; i++) { g = playTurnSimply(g); if (g.turn) assert.notStrictEqual(g.turn.pid, leaver); }
  g = act(g, { t: 'STATUS', by: 'H', pid: leaver, to: 'active' });
  assert.strictEqual(g.players[leaver].status, 'active');
});

test('collab: accept costs invitee 1 chip; decline/timeout go solo at no cost; skip refunds unrolled partner', () => {
  // マスを強制するため、手番の人をコラボのマス（r7）の手前に置く
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 8, career: 0 } }));
  const cur = g.turn.pid; const other = g.order.find((x) => x !== cur);
  function forceCollab(game) {
    const x = JSON.parse(JSON.stringify(E.serialize(game)));
    x.players[x.turn.pid].pos = 7; x.turn.stage = 'act';
    x.turn.sq = { node: 7, type: 'collab', eff: 'collab', note: '', opts: [], scene: 0 };
    x.turn.stage = 'partner';
    return E.normalize(x);
  }
  g = forceCollab(g);
  const before = g.players[other].chips;
  g = act(g, { t: 'PARTNER', by: cur, to: other, g: { turn: g.turn.id } });
  assert.strictEqual(g.turn.stage, 'invite');
  g = act(g, { t: 'RESPOND', by: cur, accept: true, g: { turn: g.turn.id } }, { expectFail: true }); // 本人以外（ホストでない）
  g = act(g, { t: 'RESPOND', by: other, accept: true, g: { turn: g.turn.id } });
  assert.strictEqual(g.players[other].chips, before - 1);
  assert.deepStrictEqual(g.turn.ch.members, [cur, other]);
  // 手番の人がスキップ → 相手はまだ振っていないので1枚戻る（続けて相手の手番が始まれば、その分の1枚は通常どおり使う）
  g = act(g, { t: 'SKIP', by: cur, g: { turn: g.turn.id } });
  assert.ok(g.log.some((e) => e.k === 'refund' && e.p === other));
  assert.strictEqual(g.players[other].chips, before - (g.turn && g.turn.pid === other ? 1 : 0));

  // 見送り
  g = forceCollab(g);
  const cur2 = g.turn.pid; const other2 = g.order.find((x) => x !== cur2);
  const b2 = g.players[other2].chips;
  g = act(g, { t: 'PARTNER', by: cur2, to: other2, g: { turn: g.turn.id } });
  g = act(g, { t: 'RESPOND', by: other2, accept: false, g: { turn: g.turn.id } });
  assert.strictEqual(g.players[other2].chips, b2);
  assert.ok(g.turn.ch.solo);

  // 返答なし（10秒）
  g = act(g, { t: 'SKIP', by: cur2, g: { turn: g.turn.id } });
  g = forceCollab(g);
  const cur3 = g.turn.pid; const other3 = g.order.find((x) => x !== cur3);
  const b3 = g.players[other3].chips;
  g = act(g, { t: 'PARTNER', by: cur3, to: other3, g: { turn: g.turn.id } });
  g = act(g, { t: 'INVITE_TIMEOUT', by: cur3 }, { dt: 2000, expectFail: true });
  g = act(g, { t: 'INVITE_TIMEOUT', by: cur3 }, { dt: 9000 });
  assert.strictEqual(g.players[other3].chips, b3);
  assert.strictEqual(g.turn.ch.note, 'timeout');
});

test('solo game: collab uses a fictional partner, results unranked', () => {
  let g = finishSetup(setupGame({ players: 1, settings: { chips: 4, career: 1 } }));
  const x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.turn.stage = 'roll';
  x.players[x.turn.pid].pos = 6; // 次の1マスでコラボ（r7）
  g = E.normalize(x);
  // 出目1を引く種を探す
  let seed = 1;
  for (; seed < 10000; seed++) { if (E.makeRng(seed).die() === 1) break; }
  g = act(g, { t: 'ROLL', by: g.turn.pid, g: { turn: g.turn.id } }, { seed });
  assert.strictEqual(g.turn.sq.eff, 'collab');
  assert.strictEqual(g.turn.stage, 'challenge');
  assert.ok(g.turn.ch.fictional);
  g = playUntilFinal(g);
  assert.strictEqual(g.phase, 'final');
  const pid = g.order[0];
  g = act(g, { t: 'FN_CHOOSE', by: pid, pid, job: g.players[pid].jobs[0] });
  if (g.players[pid].fin.step === 'present') g = act(g, { t: 'FN_PRESENT', by: pid, pid });
  g = act(g, { t: 'REVEAL', by: 'H' });
  assert.strictEqual(g.results.ranked, false);
  assert.strictEqual(g.results.rows.length, 1);
});

test('career rounds: planned rounds, simultaneous, chip each, capped activity rejected, resting skipped', () => {
  let g = finishSetup(setupGame({ players: 3, settings: { chips: 8, career: 2 } }));
  assert.deepStrictEqual(g.plan, { 2: 'early', 5: 'mid' });
  // 1周目（通常手番×3）
  for (let i = 0; i < 3; i++) g = playTurnSimply(g);
  assert.ok(g.career);
  assert.strictEqual(g.career.stage, 'early');
  g.order.forEach((pid) => assert.strictEqual(g.players[pid].chips, 6));
  const pid = g.order[0];
  const x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.players[pid].apt = [4, 4, 4, 4, 4, 0];
  g = E.normalize(x);
  g = act(g, { t: 'CR_ROUTE', by: pid, pid, route: 'e0' });
  g = act(g, { t: 'CR_ACT', by: pid, pid, i: 0 }, { expectFail: true }); // 気づく力は上限の4枚
  g = act(g, { t: 'CR_ROUTE', by: pid, pid, route: 'e1' });
  g = act(g, { t: 'CR_ACT', by: pid, pid, i: 1 }); // 工夫する力 0→1
  assert.strictEqual(g.players[pid].apt[5], 1);
  const restPid = g.order[1];
  g = act(g, { t: 'STATUS', by: restPid, pid: restPid, to: 'resting' });
  assert.ok(!g.career.st[restPid].done && g.career.st[restPid].away, 'resting participant keeps the chance');
  g = act(g, { t: 'CR_ROUTE', by: restPid, pid: restPid, route: 'e0' }, { expectFail: true }); // 休憩中は選べない
  g = act(g, { t: 'STATUS', by: restPid, pid: restPid, to: 'active' });
  g = act(g, { t: 'CR_ROUTE', by: restPid, pid: restPid, route: 'e2' }); // 戻れば選べる
  g = act(g, { t: 'STATUS', by: restPid, pid: restPid, to: 'resting' });
  const third = g.order[2];
  g = act(g, { t: 'CR_PASS', by: third, pid: third }); // 参加中の全員が済む → 休憩中の人を待たずに終わる
  assert.strictEqual(g.career, null, 'round ended without waiting for the resting player');
  assert.ok(g.log.some((e) => e.k === 'skip' && e.p === restPid && e.why === 'rest'));
  g = act(g, { t: 'STATUS', by: restPid, pid: restPid, to: 'active' });
  assert.ok(g.turn);
  assert.strictEqual(g.round, 3);
});

test('career: a resting player at round start keeps the chance and can choose after returning', () => {
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 8, career: 1 } }));
  const [a, b] = g.order;
  g = playTurnSimply(g); // a
  g = act(g, { t: 'STATUS', by: b, pid: b, to: 'resting' }); // b は自分の番の前に休む（自動スキップ）
  assert.ok(g.career, 'career round started');
  assert.ok(g.career.st[b].away && !g.career.st[b].done);
  const chipsB = g.players[b].chips;
  g = act(g, { t: 'STATUS', by: b, pid: b, to: 'active' });
  g = act(g, { t: 'CR_ROUTE', by: b, pid: b, route: 'e4' });
  const i = D.CAREERS.early.routes[4].acts.findIndex(([, apt]) => g.players[b].apt[apt] < D.APT_CAP);
  g = act(g, { t: 'CR_ACT', by: b, pid: b, i });
  assert.strictEqual(g.players[b].chips, chipsB, 'no extra chip for returning');
  assert.ok(g.career.st[b].done && !g.career.st[b].skipped);
  void a;
});

test('end lap: the declaring turn is that player\'s last; everyone else gets exactly one more', () => {
  let g = finishSetup(setupGame({ players: 3, settings: { chips: 10, career: 0 } }));
  g = playTurnSimply(g);
  const current = g.turn.pid;
  g = act(g, { t: 'END_LAP', by: 'H' });
  g = playTurnSimply(g); // 宣言した手番を終える
  const counts = {};
  while (g.phase === 'main') {
    if (g.turn) { counts[g.turn.pid] = (counts[g.turn.pid] || 0) + 1; g = playTurnSimply(g); } else break;
  }
  assert.strictEqual(g.phase, 'final');
  g.order.forEach((pid) => assert.strictEqual(counts[pid] || 0, pid === current ? 0 : 1, `lap turns for ${pid}`));
});

test('final: choose then present roll (+0..3 with prep chips), ranks with ties, left players without result', () => {
  let g = finishSetup(setupGame({ players: 3, settings: { chips: 4, career: 0 } }));
  g = act(g, { t: 'END_NOW', by: 'H' });
  assert.strictEqual(g.phase, 'final');
  const [a, b, c] = g.order;
  let x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.players[a].apt = [3, 3, 3, 3, 3, 3]; x.players[b].apt = [3, 3, 3, 3, 3, 3];
  x.players[a].prep = 2;
  g = E.normalize(x);
  g = act(g, { t: 'FN_CHOOSE', by: a, pid: a, job: g.players[a].jobs[0] });
  assert.strictEqual(g.players[a].fin.step, 'present');
  assert.strictEqual(g.players[a].fin.base, 15);
  g = act(g, { t: 'FN_PRESENT', by: a, pid: a });
  const ra = g.players[a].fin.roll;
  assert.strictEqual(ra.used, 2);
  assert.ok(ra.bonus >= 1 && ra.bonus <= 3, 'with 2 chips the bonus is 1..3');
  assert.strictEqual(g.players[a].fin.final, 15 + ra.bonus);
  g = act(g, { t: 'FN_PRESENT', by: a, pid: a }, { expectFail: true }); // 二重には振れない
  g = act(g, { t: 'FN_CHOOSE', by: b, pid: b, job: g.players[b].jobs[0] });
  g = act(g, { t: 'STATUS', by: c, pid: c, to: 'left' });
  g = act(g, { t: 'REVEAL', by: 'H' }, { expectFail: true }); // b が仕上げ前（参加中）
  g = act(g, { t: 'FN_PRESENT', by: 'H', pid: b }); // ホストが代わりに振ることもできる
  g = act(g, { t: 'REVEAL', by: 'H' });
  assert.deepStrictEqual(g.results.none, [c]);
  assert.strictEqual(g.results.rows.length, 2);
  const rowA = g.results.rows.find((r) => r.pid === a);
  assert.strictEqual(rowA.final, 15 + ra.bonus);
  assert.ok(rowA.roll && rowA.roll.used === 2);
  if (g.results.rows[0].final === g.results.rows[1].final) assert.strictEqual(g.results.rows[1].rank, 1);
  // 仕上げなしの設定では選んだらそのまま
  g = finishSetup(setupGame({ players: 1, settings: { chips: 4, career: 0, endRule: 'none' } }));
  g = act(g, { t: 'END_NOW', by: 'H' });
  const p = g.order[0];
  g = act(g, { t: 'FN_CHOOSE', by: p, pid: p, job: g.players[p].jobs[0] });
  assert.strictEqual(g.players[p].fin.step, 'done');
});

test('prep chips: +1 when a roll gives no card, +1 each for a two-person collab, max 2', () => {
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 8, career: 0 } }));
  const cur = g.turn.pid; const other = g.order.find((y) => y !== cur);
  // 出目1が出る種で、持っていない適性を狙う → 判定1〜2 → 獲得なし → 準備チップ1枚
  let seed = 1;
  for (; seed < 10000; seed++) { if (E.makeRng(seed).die() === 1) break; }
  let x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.turn.stage = 'challenge';
  x.turn.sq = { node: 7, type: 'collab', eff: 'collab', note: '', opts: [], scene: 0 };
  x.players[cur].apt = [0, 0, 0, 0, 0, 0]; x.players[other].apt = [0, 0, 0, 0, 0, 0];
  x.players[cur].prep = 0; x.players[other].prep = 1;
  const blank = { pick: 0, die: 0, bonus: 0, life: 0, total: 0, tier: '', rw: [], got: [], done: false, note: '', refunded: false };
  x.turn.ch = { kind: 'collab', scene: 0, solo: false, fictional: false, members: [cur, other], st: { [cur]: { ...blank }, [other]: { ...blank } }, note: '' };
  g = E.normalize(x);
  g = act(g, { t: 'CH_ROLL', by: cur, pid: cur, g: { turn: g.turn.id } }, { seed });
  assert.strictEqual(g.turn.ch.st[cur].tier, 'none');
  assert.strictEqual(g.players[cur].prep, 2, 'miss +1 and collab +1');
  g = act(g, { t: 'CH_ROLL', by: other, pid: other, g: { turn: g.turn.id } }, { seed });
  assert.strictEqual(g.players[other].prep, 2, 'capped at 2');
  assert.ok(g.log.some((e) => e.k === 'prep' && e.why === 'collab'));
});

test('prep chips: a 3-4 roll that ends before the other card is chosen also gives +1 (skip / host drop / rest / end now)', () => {
  let seed = 1;
  for (; seed < 10000; seed++) { if (E.makeRng(seed).die() === 3) break; }
  const blank = { pick: 0, die: 0, bonus: 0, life: 0, total: 0, tier: '', rw: [], got: [], done: false, note: '', refunded: false };
  // 手番を判定の直前にする（全員の適性0・準備チップ0。持っていない適性を狙うので、出目3 → 判定3）
  function atChallenge(game, members) {
    const x = JSON.parse(JSON.stringify(E.serialize(game)));
    x.turn.stage = 'challenge';
    x.turn.sq = { node: 7, type: 'collab', eff: 'collab', note: '', opts: [], scene: 0 };
    Object.keys(x.players).forEach((id) => { x.players[id].apt = [0, 0, 0, 0, 0, 0]; x.players[id].prep = 0; });
    x.turn.ch = { kind: 'collab', scene: 0, solo: members.length < 2, fictional: false, members, st: Object.fromEntries(members.map((m) => [m, { ...blank }])), note: '' };
    return E.normalize(x);
  }
  const roll = (game, m) => act(game, { t: 'CH_ROLL', by: m, pid: m, g: { turn: game.turn.id } }, { seed });
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 8, career: 0 } }));
  // 1) 手番の人が、別の適性を選ぶ前にスキップ
  let cur = g.turn.pid;
  g = roll(atChallenge(g, [cur]), cur);
  assert.strictEqual(g.turn.ch.st[cur].tier, 'mid');
  assert.strictEqual(g.players[cur].prep, 0, 'no chip while the other card can still be chosen');
  g = act(g, { t: 'SKIP', by: cur, g: { turn: g.turn.id } });
  assert.strictEqual(g.players[cur].prep, 1, 'skip before choosing: +1');
  assert.ok(g.log.some((e) => e.k === 'prep' && e.p === cur && e.why === 'miss'));
  // 2) 2人のコラボで、さそわれた人が選ぶ前にホストが見送る（振った時点でコラボの＋1、見送りで＋1）
  cur = g.turn.pid;
  const other = g.order.find((y) => y !== cur);
  g = roll(atChallenge(g, [cur, other]), other);
  assert.strictEqual(g.turn.ch.st[other].tier, 'mid');
  assert.strictEqual(g.players[other].prep, 1, 'collab +1 at the roll');
  g = act(g, { t: 'CH_DROP', by: 'H', pid: other, g: { turn: g.turn.id } });
  assert.strictEqual(g.players[other].prep, 2, 'dropped before choosing: +1');
  assert.strictEqual(g.players[cur].prep, 0, 'the turn player has not rolled yet');
  // 3) 手番の人が、選ぶ前に休憩に入る（相手はもう見送られたので、ひとりで振る＝コラボの＋1はなし）
  g = roll(g, cur);
  assert.strictEqual(g.turn.ch.st[cur].tier, 'mid');
  assert.strictEqual(g.players[cur].prep, 0, 'no collab chip after the partner was dropped');
  g = act(g, { t: 'STATUS', by: cur, pid: cur, to: 'resting' });
  assert.strictEqual(g.players[cur].prep, 1, 'resting before choosing: +1');
  // 4) 選ぶ前にホストが本編をすぐに終える → 仕上げの前に準備チップが入っている
  g = act(g, { t: 'STATUS', by: cur, pid: cur, to: 'active' });
  const last = g.turn.pid;
  g = roll(atChallenge(g, [last]), last);
  g = act(g, { t: 'END_NOW', by: 'H' });
  assert.strictEqual(g.phase, 'final');
  assert.strictEqual(g.players[last].prep, 1, 'ended before choosing: +1');
  // 判定の前に終わった人・カードが取れた人には付かない（上限2もそのまま）
  Object.values(g.players).forEach((p) => assert.ok(p.prep <= E.PREP_MAX));
});

test('prep chips: no collab chip when the partner was dropped before the turn player rolls', () => {
  let seed = 1;
  for (; seed < 10000; seed++) { if (E.makeRng(seed).die() === 6) break; }
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 8, career: 0 } }));
  const cur = g.turn.pid; const other = g.order.find((y) => y !== cur);
  const x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.turn.stage = 'challenge';
  x.turn.sq = { node: 7, type: 'collab', eff: 'collab', note: '', opts: [], scene: 0 };
  Object.keys(x.players).forEach((id) => { x.players[id].apt = [0, 0, 0, 0, 0, 0]; x.players[id].prep = 0; });
  const blank = { pick: 0, die: 0, bonus: 0, life: 0, total: 0, tier: '', rw: [], got: [], done: false, note: '', refunded: false };
  x.turn.ch = { kind: 'collab', scene: 0, solo: false, fictional: false, members: [cur, other], st: { [cur]: { ...blank }, [other]: { ...blank } }, note: '' };
  g = E.normalize(x);
  const chips = g.players[other].chips;
  g = act(g, { t: 'CH_DROP', by: 'H', pid: other, g: { turn: g.turn.id } });
  assert.strictEqual(g.players[other].chips, chips + 1, 'the unrolled partner gets the chip back');
  g = act(g, { t: 'CH_ROLL', by: cur, pid: cur, g: { turn: g.turn.id } }, { seed });
  assert.strictEqual(g.turn.ch.st[cur].tier, 'big');
  assert.strictEqual(g.players[cur].prep, 0, 'rolled alone after the partner was dropped: no collab chip');
  assert.strictEqual(g.players[other].prep, 0, 'the dropped partner did not roll');
});

test('timer: timeout only after budget, extension once, pause stops the clock', () => {
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 6, career: 0, timerSec: 30 } }));
  const id = g.turn.id;
  g = act(g, { t: 'TIMEOUT', by: 'H' }, { dt: 10000, expectFail: true });
  g = act(g, { t: 'PAUSE', by: 'H', on: true }, { dt: 5000 });
  g = act(g, { t: 'TIMEOUT', by: 'H' }, { dt: 60000, expectFail: true }); // 一時停止中は減らない
  g = act(g, { t: 'PAUSE', by: 'H', on: false }, { dt: 1000 });
  g = act(g, { t: 'EXTEND', by: g.turn.pid });
  g = act(g, { t: 'EXTEND', by: g.turn.pid }, { expectFail: true });
  g = act(g, { t: 'TIMEOUT', by: 'H' }, { dt: 20000, expectFail: true }); // 30+15秒に届かない
  g = act(g, { t: 'TIMEOUT', by: 'H' }, { dt: 20000 });
  assert.notStrictEqual(g.turn.id, id);
  assert.ok(g.log.some((e) => e.k === 'skip' && e.why === 'timeout'));
});

test('life event: once per player, +1/-1 for next 2 rolls only', () => {
  let g = finishSetup(setupGame({ players: 1, settings: { chips: 8, career: 0 } }));
  const pid = g.turn.pid;
  let x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.turn.stage = 'act';
  // 候補: 結婚（協力）・友だちと共同生活（伝える）・自動車（気づく）
  const planOf = (s, i) => D.LIFE_PLANS.findIndex((pl) => pl.s === s && pl.i === i);
  x.turn.sq = { node: 8, type: 'life', eff: 'life', note: '', opts: [planOf(0, 1), planOf(1, 1), planOf(2, 0)], scene: -1 };
  g = E.normalize(x);
  g = act(g, { t: 'OMAKASE', by: pid, pid }, { expectFail: true }); // 暮らしはおまかせ不可
  g = act(g, { t: 'PICK', by: pid, i: 3, g: { turn: g.turn.id } }, { expectFail: true }); // 候補の外
  g = act(g, { t: 'PICK', by: pid, i: 0, g: { turn: g.turn.id } }); // 協力する力
  assert.deepStrictEqual([g.players[pid].life.apt, g.players[pid].life.left, g.players[pid].life.scene], [4, 2, 0]);
  assert.deepStrictEqual(g.turn.res.find((r) => r.k === 'life'), { k: 'life', p: pid, scene: 0, a: 4, i: 1 });
  g = act(g, { t: 'END_TURN', by: pid, g: { turn: g.turn.id } });
  // 次のイベント判定2回で効果が減り、3回目は補正なし
  const rolls = [];
  for (let k = 0; k < 3; k++) {
    x = JSON.parse(JSON.stringify(E.serialize(g)));
    x.turn.stage = 'challenge';
    x.turn.sq = { node: 2, type: 'event', eff: 'event', note: '', opts: [], scene: 4 };
    x.players[pid].apt = [0, 0, 0, 0, 0, 0];
    x.turn.ch = { kind: 'event', scene: 4, solo: false, fictional: false, members: [pid], st: { [pid]: { pick: 0, die: 0, bonus: 0, life: 0, total: 0, tier: '', rw: [], got: [], done: false, note: '', refunded: false } }, note: '' };
    g = E.normalize(x);
    g = act(g, { t: 'CH_ROLL', by: pid, pid, g: { turn: g.turn.id } });
    rolls.push(g.turn.ch.st[pid].life);
    if (g.turn.stage !== 'result') g = act(g, { t: 'CH_REWARD', by: pid, pid, a: g.turn.ch.st[pid].rw[0] });
    g = act(g, { t: 'END_TURN', by: pid, g: { turn: g.turn.id } });
    if (!g.turn) break;
  }
  assert.strictEqual(rolls[0], 1);  // 協力する力を狙う → +1
  assert.strictEqual(rolls[1], 1);
  assert.strictEqual(rolls[2], 0);  // 2回で終わり
});

test('life square: three plans from different scenes to choose from (the game never assigns one)', () => {
  // 候補は D.LIFE_PLANS の番号3つ。場面はすべてちがい、適性もちがう（8場面・6適性なので必ずそろう）
  const seen = new Set();
  for (let seed = 1; seed <= 2000; seed++) {
    const plans = E.lifePlanOptions(E.makeRng(seed)).map((k) => D.LIFE_PLANS[k]);
    assert.strictEqual(plans.length, 3);
    assert.ok(plans.every(Boolean));
    assert.strictEqual(new Set(plans.map((pl) => pl.s)).size, 3, 'scenes differ');
    assert.strictEqual(new Set(plans.map((pl) => pl.a)).size, 3, 'aptitudes differ');
    plans.forEach((pl) => seen.add(pl.s));
  }
  assert.strictEqual(seen.size, D.LIVES.length, 'every scene can appear as a choice');
  // 実際に暮らしのマスに止まると、この候補が出る。選ばないことも選べる（1回に数える）
  const g0 = E.serialize(finishSetup(setupGame({ players: 1, settings: { chips: 8, career: 0 } })));
  const pid = g0.turn.pid;
  let landed = 0;
  for (let seed = 1; seed <= 60 && landed < 5; seed++) {
    const x = JSON.parse(JSON.stringify(g0));
    x.players[pid].pos = 7; // 1が出ると次の暮らしのマス（ノード8）
    const r = E.apply(E.normalize(x), { t: 'ROLL', by: pid, g: { turn: g0.turn.id } }, { now: clock + 1000, seed });
    assert.ok(r.ok);
    const t = r.game.turn;
    if (t.stage !== 'act' || t.sq.eff !== 'life') continue;
    landed += 1;
    assert.strictEqual(t.sq.opts.length, 3);
    assert.strictEqual(new Set(t.sq.opts.map((k) => D.LIFE_PLANS[k].s)).size, 3);
    const passed = act(r.game, { t: 'PASS', by: pid, g: { turn: t.id } });
    assert.deepStrictEqual([passed.players[pid].life.used, passed.players[pid].life.left], [true, 0]);
    assert.ok(passed.turn.res.some((e) => e.k === 'lifePass'));
  }
  assert.ok(landed >= 1, 'landed on the life square');
});

test('review fixes: duplicate OMAKASE, final double-submit, paused timeouts, spectator timeouts, invite pause', () => {
  // おまかせの連打: 同じ目印の2回目は受け付けない
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 8, career: 0 } }));
  let x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.players[x.turn.pid].pos = 5; // 分かれ道の上
  g = E.normalize(x);
  const cur = g.turn.pid;
  g = act(g, { t: 'ROLL', by: cur, g: { turn: g.turn.id, stage: 'roll' } });
  assert.strictEqual(g.turn.stage, 'fork');
  const key = E.decisionKey(g, cur);
  g = act(g, { t: 'OMAKASE', by: cur, pid: cur, x: key });
  assert.notStrictEqual(g.turn.stage, 'fork');
  const stageAfter = g.turn.stage;
  g = act(g, { t: 'OMAKASE', by: cur, pid: cur, x: key }, { expectFail: true });
  assert.strictEqual(g.turn.stage, stageAfter, 'second omakase did not decide again');
  // 段階つきのガード: 同じ手番でも段階が違えば受け付けない
  g = act(g, { t: 'ROLL', by: cur, g: { turn: g.turn.id, stage: 'roll' } }, { expectFail: true });

  // 仕上げのサイコロ: 本人とホストの同時押しでも1回だけ
  g = finishSetup(setupGame({ players: 1, settings: { chips: 4, career: 0 } }));
  g = act(g, { t: 'END_NOW', by: 'H' });
  const p = g.order[0];
  g = act(g, { t: 'FN_CHOOSE', by: p, pid: p, job: g.players[p].jobs[0] });
  g = act(g, { t: 'FN_PRESENT', by: p, pid: p });
  g = act(g, { t: 'FN_PRESENT', by: 'H', pid: p }, { expectFail: true });
  assert.strictEqual(g.players[p].fin.step, 'done');

  // 一時停止中の時間切れ・見学の人からの時間切れ
  g = finishSetup(setupGame({ players: 2, settings: { chips: 6, career: 0, timerSec: 30 } }));
  g = act(g, { t: 'PAUSE', by: 'H', on: true }, { dt: 29500 });
  g = act(g, { t: 'TIMEOUT', by: 'H' }, { dt: 1000, expectFail: true });
  g = act(g, { t: 'PAUSE', by: 'H', on: false }, { dt: 1000 });
  g = act(g, { t: 'TIMEOUT', by: 'spectator-x' }, { dt: 60000, expectFail: true });
  g = act(g, { t: 'TIMEOUT', by: 'H' }, { dt: 0 });

  // 招待の返事待ちは、一時停止のあいだ締め切りが延びる
  g = finishSetup(setupGame({ players: 2, settings: { chips: 8, career: 0 } }));
  x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.turn.stage = 'partner';
  x.turn.sq = { node: 7, type: 'collab', eff: 'collab', note: '', opts: [], scene: 0 };
  g = E.normalize(x);
  const inviter = g.turn.pid; const other = g.order.find((y) => y !== inviter);
  g = act(g, { t: 'PARTNER', by: inviter, to: other, g: { turn: g.turn.id } });
  const until0 = g.turn.inv.until;
  g = act(g, { t: 'PAUSE', by: 'H', on: true }, { dt: 2000 });
  g = act(g, { t: 'INVITE_TIMEOUT', by: 'H' }, { dt: 20000, expectFail: true }); // 一時停止中は切れない
  g = act(g, { t: 'PAUSE', by: 'H', on: false }, { dt: 1000 });
  assert.ok(g.turn.inv.until >= until0 + 20000, 'deadline extended by the paused time');
  g = act(g, { t: 'INVITE_TIMEOUT', by: 'H' }, { dt: 3000, expectFail: true });
  g = act(g, { t: 'INVITE_TIMEOUT', by: 'H' }, { dt: 9000 });
  assert.strictEqual(g.turn.ch.note, 'timeout');
});

test('audit fixes: host-away shift, forced reveal keeps chosen job, fork-split move logs', () => {
  // ホストが戻ったら、いなかった時間ぶん締め切りを延ばす
  let g = finishSetup(setupGame({ players: 2, settings: { chips: 6, career: 0, timerSec: 30 } }));
  g = act(g, { t: 'HOST_BACK', by: g.turn.pid, away: 60000 }, { expectFail: true }); // ホスト以外は不可
  g = act(g, { t: 'HOST_BACK', by: 'H', away: 60000 }, { dt: 60000 });
  g = act(g, { t: 'TIMEOUT', by: 'H' }, { dt: 5000, expectFail: true }); // まだ残っている
  // 強制発表: 職業を決めてチャレンジ前の人も結果に入る（決めた職業の点のまま）
  g = finishSetup(setupGame({ players: 2, settings: { chips: 4, career: 0 } }));
  g = act(g, { t: 'END_NOW', by: 'H' });
  const [a, b] = g.order;
  g = act(g, { t: 'FN_CHOOSE', by: a, pid: a, job: g.players[a].jobs[0] });
  if (g.players[a].fin.step === 'present') {
    const base = g.players[a].fin.base;
    g = act(g, { t: 'REVEAL', by: 'H', force: true });
    const row = g.results.rows.find((r) => r.pid === a);
    assert.ok(row, 'chosen-but-not-challenged player has a result');
    assert.strictEqual(row.final, base);
    assert.ok(g.results.none.includes(b), 'player who chose nothing has no result');
  }
  // 分かれ道で止まったら、そこまでを1回記録。道を選んだら残りだけ
  g = finishSetup(setupGame({ players: 1, settings: { chips: 8, career: 0 } }));
  const x = JSON.parse(JSON.stringify(E.serialize(g)));
  x.players[x.turn.pid].pos = 3; // 2マス先が分かれ道（r5）
  g = E.normalize(x);
  let seed = 1;
  for (; seed < 10000; seed++) { if (E.makeRng(seed).die() === 6) break; }
  const pid = g.turn.pid;
  g = act(g, { t: 'ROLL', by: pid, g: { turn: g.turn.id } }, { seed });
  assert.strictEqual(g.turn.stage, 'fork');
  const firstMove = g.log.filter((e) => e.k === 'move').pop();
  assert.deepStrictEqual(firstMove.path, [4, 5]);
  g = act(g, { t: 'FORK', by: pid, b: 0, g: { turn: g.turn.id } });
  const secondMove = g.log.filter((e) => e.k === 'move').pop();
  assert.deepStrictEqual(secondMove.path, [6, 7, 8, 9]);
});

// ── 2) ランダム対戦 ──────────────────────────────────
function randomAction(g, rng) {
  const H = 'H';
  const r = rng.next();
  const ids = g.order;
  const pick = (arr) => arr[Math.floor(rng.next() * arr.length)];
  if (g.phase === 'setup') {
    const pending = ids.filter((pid) => g.players[pid].setup.step !== 'done');
    if (!pending.length || r < 0.02) return { t: 'BEGIN', by: H, force: true };
    const pid = pick(pending);
    const p = g.players[pid];
    const by = p.ctrl === 'host' ? H : pid;
    if (p.setup.step === 'ideal') return { t: 'IDEAL', by, pid, job: rng.next() < 0.2 ? -1 : Math.floor(rng.next() * 24) };
    if (p.setup.step === 'deal') return { t: 'DEAL_OK', by, pid };
    return rng.next() < 0.3 ? { t: 'OMAKASE', by, pid } : { t: 'GOAL', by, pid, job: pick(p.setup.cands) };
  }
  if (g.phase === 'main') {
    // 割り込み（低確率）
    if (r < 0.015) return { t: 'STATUS', by: H, pid: pick(ids), to: pick(['active', 'resting', 'left', 'active']) };
    if (r < 0.02) return { t: 'PAUSE', by: H, on: !g.paused };
    if (r < 0.023 && g.lastLap === null) return { t: 'END_LAP', by: H };
    if (r < 0.0235) return { t: 'END_NOW', by: H };
    if (r < 0.03) {
      const pend = ids.filter((pid) => g.players[pid].setup.goalPending);
      if (pend.length) { const pid = pick(pend); return { t: 'GOAL', by: pid, pid, job: pick(g.players[pid].setup.cands) }; }
    }
    if (g.hold) return rng.next() < 0.5 ? { t: 'STATUS', by: H, pid: pick(ids), to: 'active' } : { t: 'END_NOW', by: H };
    if (g.career) {
      const pending = Object.keys(g.career.st).filter((pid) => !g.career.st[pid].done);
      if (!pending.length || r < 0.04) return { t: 'CR_CLOSE', by: H };
      const pid = pick(pending);
      const s = g.career.st[pid];
      const c = D.CAREERS[g.career.stage];
      if (rng.next() < 0.1) return { t: 'CR_PASS', by: pid, pid };
      if (rng.next() < 0.15) return { t: 'OMAKASE', by: pid, pid };
      if (!s.route) return { t: 'CR_ROUTE', by: pid, pid, route: pick(c.routes.concat([c.common])).id };
      const route = E.careerRoute(g.career.stage, s.route);
      return { t: 'CR_ACT', by: pid, pid, i: Math.floor(rng.next() * route.acts.length) };
    }
    const t = g.turn;
    if (!t) return { t: 'END_NOW', by: H };
    const gd = { turn: t.id };
    const cur = t.pid;
    if (r < 0.05) return { t: 'SKIP', by: pick([cur, H]), g: gd };
    if (r < 0.06 && g.settings.timerSec) return { t: 'TIMEOUT', by: H, _dt: 70000 };
    if (r < 0.065) return { t: 'EXTEND', by: cur };
    switch (t.stage) {
      case 'roll': return { t: 'ROLL', by: cur, g: gd };
      case 'fork': return rng.next() < 0.2 ? { t: 'OMAKASE', by: cur, pid: cur } : { t: 'FORK', by: cur, b: Math.floor(rng.next() * 2), g: gd };
      case 'act':
        if (rng.next() < 0.1 && (t.sq.eff === 'job' || t.sq.eff === 'life')) return { t: 'PASS', by: cur, g: gd };
        if (rng.next() < 0.15) return { t: 'OMAKASE', by: cur, pid: cur };
        return { t: 'PICK', by: cur, i: Math.floor(rng.next() * Math.max(1, t.sq.opts.length || 2)), g: gd };
      case 'partner': {
        const c = E.eligiblePartners(g, t.sq.scene);
        return { t: 'PARTNER', by: cur, to: rng.next() < 0.2 || !c.length ? '' : pick(c), g: gd };
      }
      case 'invite':
        if (rng.next() < 0.2) return { t: 'INVITE_TIMEOUT', by: cur, _dt: 11000 };
        return { t: 'RESPOND', by: rng.next() < 0.5 ? t.inv.pid : H, accept: rng.next() < 0.6, g: gd };
      case 'challenge': {
        const pending = t.ch.members.filter((m) => !t.ch.st[m].done);
        const m = pick(pending);
        const s = t.ch.st[m];
        if (m !== cur && rng.next() < 0.05) return { t: 'CH_DROP', by: H, pid: m };
        if (s.tier === 'mid') return { t: 'CH_REWARD', by: m, pid: m, a: pick(s.rw), g: gd };
        if (s.pick < 0 || rng.next() < 0.1) return rng.next() < 0.2 ? { t: 'OMAKASE', by: m, pid: m } : { t: 'CH_PICK', by: m, pid: m, i: Math.floor(rng.next() * 3), g: gd };
        return { t: 'CH_ROLL', by: m, pid: m, g: gd };
      }
      case 'result':
        if (rng.next() < 0.1) { const p = g.players[cur]; return { t: 'SET_GOAL', by: cur, pid: cur, job: pick(p.jobs) }; }
        return { t: 'END_TURN', by: cur, g: gd };
      default: return { t: 'SKIP', by: H, g: gd };
    }
  }
  if (g.phase === 'final') {
    const pending = Object.values(g.players).filter((p) => p.fin && p.fin.step !== 'done');
    if (!pending.length || r < 0.03) return { t: 'REVEAL', by: H, force: true };
    const p = pick(pending);
    const pid = p.id;
    if (p.fin.step === 'choose') return { t: 'FN_CHOOSE', by: pid, pid, job: pick(p.jobs) };
    if (p.fin.step === 'present') return { t: 'FN_PRESENT', by: rng.next() < 0.8 ? pid : 'H', pid };
  }
  return null;
}

const stats = { games: 0, actions: 0, rejected: 0, normalTurns: 0, decisions: 0, careers: 0, autoSkips: 0, byPlayers: {}, finals: [], ties: 0, holds: 0 };
function simulate(seed, nPlayers, settings) {
  const rng = E.makeRng(seed);
  const hostPlays = rng.next() < 0.5;
  const proxies = Math.min(Math.floor(rng.next() * 2), Math.max(0, nPlayers - (hostPlays ? 2 : 1)));
  const joiners = nPlayers - proxies - (hostPlays ? 1 : 0);
  let g = setupGame({ players: joiners, hostPlays, proxies, settings });
  checkInvariants(g);
  let steps = 0;
  while (g.phase !== 'results') {
    steps += 1;
    assert.ok(steps < 6000, `game did not finish (players=${nPlayers} seed=${seed})`);
    const a = randomAction(g, rng);
    assert.ok(a, `no action available in phase ${g.phase}`);
    const dt = a._dt || Math.floor(rng.next() * 8000) + 500;
    delete a._dt;
    clock += dt;
    const res = E.apply(g, a, { now: clock, seed: Math.floor(rng.next() * 4294967296) });
    stats.actions += 1;
    if (!res.ok) { stats.rejected += 1; continue; }
    if (res.game.hold && !g.hold) stats.holds += 1;
    g = E.normalize(rtdb(E.serialize(res.game)));
    checkInvariants(g);
  }
  stats.games += 1;
  g.metrics.turns.forEach(([seat, kind, , , dec]) => {
    if (kind === 0) { stats.normalTurns += 1; stats.decisions += dec; }
    if (kind === 1) stats.autoSkips += 1;
    if (kind === 2) stats.careers += 1;
  });
  g.results.rows.forEach((row) => stats.finals.push(row.final));
  if (g.results.rows.length >= 2 && g.results.rows[0].final === g.results.rows[1].final) stats.ties += 1;
  const key = String(nPlayers);
  stats.byPlayers[key] = (stats.byPlayers[key] || 0) + 1;
  return g;
}

test('random full games: 1-8 players x settings, invariants hold, always reaches results', () => {
  let seed = 7;
  for (let n = 1; n <= 8; n++) {
    for (const chips of D.CHIP_OPTIONS) {
      for (const endRule of ['present', 'present', 'none']) {
        for (let k = 0; k < 6; k++) {
          const settings = { chips, endRule, career: (seed % 3), life: seed % 4 !== 0, timerSec: seed % 5 === 0 ? 30 : 0 };
          simulate(seed++, n, settings);
        }
      }
    }
  }
});

console.log(`engine tests: ${passed} passed`);
console.log(JSON.stringify({
  games: stats.games,
  actions: stats.actions,
  rejectedRatio: +(stats.rejected / stats.actions).toFixed(3),
  normalTurns: stats.normalTurns,
  avgDecisionsPerNormalTurn: +(stats.decisions / Math.max(1, stats.normalTurns)).toFixed(2),
  careerRounds: stats.careers,
  autoSkips: stats.autoSkips,
  holds: stats.holds,
  avgFinalScore: +(stats.finals.reduce((s, x) => s + x, 0) / Math.max(1, stats.finals.length)).toFixed(2),
  tiesAtTop: stats.ties,
}, null, 1));
