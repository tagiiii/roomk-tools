/* キャリアすごろく — 所要時間の推定とバランスの机上シミュレーション（node tests/career-sugoroku/balance.js）
 *
 * ・所要時間: エンジンで実際に起きた「決める回数・種類」に、人が操作する時間の仮定（下の COST）を
 *   掛けて足した推定。人による実測ではない（実測はゲーム内の「時間の計測」で行う）。
 * ・バランス: 目標の職業に合わせて選ぶ自動プレイヤーで、得点の分布・満点率・同点1位の率などを見る。
 */
'use strict';
const D = require('../../apps/career-sugoroku/data.js');
const E = require('../../apps/career-sugoroku/engine.js');

// 人の操作時間の仮定（秒）。メンターが読み上げ、子どもが番号で答える想定の目安
const COST = {
  turnStart: 5,      // 「〇〇さんの番」→ 画面を見る
  roll: 4,           // サイコロを振って駒が進むのを見る
  fork: 8,           // 分かれ道の先を見て選ぶ
  read: 7,           // マスの内容を読み上げる
  pick3: 12,         // 3択（体験・役割・伸ばす適性）
  pickJob: 18,       // 職業カード3枚から選ぶ
  life: 18,          // 暮らしのプラン（効果の説明を含む）
  challengeRoll: 5,  // 判定のサイコロと結果
  reward: 7,         // 別の適性を1枚選ぶ
  partner: 10,       // さそう人を選ぶ
  invite: 6,         // さそわれた人が返事をする
  partnerTurn: 12,   // さそわれた人の役割選び（主催者と並行。差分として計上）
  endTurn: 4,        // 結果を見て「手番を終える」
  skip: 4,
  careerIntro: 20,   // 進路のラウンドの説明
  careerPick: 30,    // 進路→体験を選ぶ（全員同時。遅い人に合わせる）
  careerProxyEach: 12, // 端末なしの人の分をホストが順に入力
  explain: 300,      // 説明・実演（設計メモの5分）
  setup: 240,        // 理想・配布・目標（全員同時、4分）
  final: 180,        // 最後の職業選び・終盤・発表（3分）
};

function mkRng(seed) { return E.makeRng(seed); }

// ── 合理的な自動プレイヤー ─────────────────────────────
function bestGain(p, a) {
  // 持っている職業のうち最も点が上がる量（1枚ふやしたとき）
  if (p.apt[a] >= D.APT_CAP) return -1;
  const before = Math.max(...p.jobs.map((j) => E.score(p.apt, j).total));
  const apt2 = p.apt.slice(); apt2[a] += 1;
  const after = Math.max(...p.jobs.map((j) => E.score(apt2, j).total));
  return after - before + (p.goal >= 0 ? (E.score(apt2, p.goal).total - E.score(p.apt, p.goal).total) * 0.5 : 0);
}
function pickBy(list, fn) {
  let best = list[0]; let bv = -Infinity;
  list.forEach((x) => { const v = fn(x); if (v > bv) { bv = v; best = x; } });
  return best;
}

function botAction(g, rng, cfg) {
  const H = 'H';
  const pick = (arr) => arr[Math.floor(rng.next() * arr.length)];
  if (g.phase === 'setup') {
    const pid = g.order.find((x) => g.players[x].setup.step !== 'done');
    if (!pid) return { t: 'BEGIN', by: H };
    const p = g.players[pid];
    if (p.setup.step === 'ideal') return { t: 'IDEAL', by: pid, pid, job: rng.next() < 0.15 ? -1 : Math.floor(rng.next() * 24) };
    if (p.setup.step === 'deal') return { t: 'DEAL_OK', by: pid, pid };
    return { t: 'GOAL', by: pid, pid, job: pickBy(p.setup.cands, (j) => E.score(p.apt, j).total + rng.next()) };
  }
  if (g.phase === 'main') {
    if (g.hold) return { t: 'END_NOW', by: H };
    if (g.career) {
      const pid = Object.keys(g.career.st).find((x) => !g.career.st[x].done && g.players[x].status === 'active');
      if (!pid) return { t: 'CR_CLOSE', by: H };
      const p = g.players[pid];
      const c = D.CAREERS[g.career.stage];
      const s = g.career.st[pid];
      if (!s.route) {
        const all = c.routes.concat([c.common]);
        const r = pickBy(all, (rt) => Math.max(...rt.acts.map(([, a]) => bestGain(p, a))) + rng.next() * 0.5);
        return { t: 'CR_ROUTE', by: pid, pid, route: r.id };
      }
      const route = E.careerRoute(g.career.stage, s.route);
      const idxs = route.acts.map((x, i) => i).filter((i) => p.apt[route.acts[i][1]] < D.APT_CAP);
      if (!idxs.length) return { t: 'CR_PASS', by: pid, pid };
      return { t: 'CR_ACT', by: pid, pid, i: pickBy(idxs, (i) => bestGain(p, route.acts[i][1])) };
    }
    const t = g.turn;
    const cur = t.pid;
    const p = g.players[cur];
    const gd = { turn: t.id };
    switch (t.stage) {
      case 'roll': return { t: 'ROLL', by: cur, g: gd };
      case 'fork': return { t: 'FORK', by: cur, b: Math.floor(rng.next() * 2), g: gd };
      case 'act': {
        const eff = t.sq.eff;
        if (eff === 'grow' || eff === 'new') return { t: 'PICK', by: cur, i: t.sq.opts.indexOf(pickBy(t.sq.opts, (a) => bestGain(p, a) + rng.next() * 0.3)), g: gd };
        if (eff === 'job') {
          const best = pickBy(t.sq.opts, (j) => E.score(p.apt, j).total + rng.next());
          return { t: 'PICK', by: cur, i: t.sq.opts.indexOf(best), g: gd };
        }
        if (eff === 'life') {
          if (rng.next() < cfg.lifeDecline) return { t: 'PASS', by: cur, g: gd };
          const plans = t.sq.opts.map((k) => D.LIFE_PLANS[k]);
          return { t: 'PICK', by: cur, i: plans.indexOf(pickBy(plans, (pl) => bestGain(p, pl.a))), g: gd };
        }
        return { t: 'SKIP', by: cur, g: gd };
      }
      case 'partner': {
        const c = E.eligiblePartners(g, t.sq.scene);
        return { t: 'PARTNER', by: cur, to: c.length && rng.next() < cfg.invite ? pick(c) : '', g: gd };
      }
      case 'invite': return { t: 'RESPOND', by: t.inv.pid, accept: rng.next() < cfg.accept, g: gd };
      case 'challenge': {
        const m = t.ch.members.find((x) => !t.ch.st[x].done);
        const s = t.ch.st[m];
        const mp = g.players[m];
        const scene = E.sceneOf(t.ch);
        if (s.tier === 'mid') return { t: 'CH_REWARD', by: m, pid: m, a: pickBy(s.rw, (a) => bestGain(mp, a)), g: gd };
        if (s.pick < 0) {
          const idxs = scene.opts.map((x, i) => i).filter((i) => mp.apt[scene.opts[i][1]] < D.APT_CAP);
          // 期待値: 持っている適性は+1、暮らしの補正も考える（簡易）
          const val = (i) => { const a = scene.opts[i][1]; return bestGain(mp, a) + (mp.apt[a] > 0 ? 0.6 : 0) + (mp.life.left > 0 ? (mp.life.apt === a ? 0.4 : -0.3) : 0); };
          return { t: 'CH_PICK', by: m, pid: m, i: pickBy(idxs, val), g: gd };
        }
        return { t: 'CH_ROLL', by: m, pid: m, g: gd };
      }
      case 'result': return { t: 'END_TURN', by: cur, g: gd };
      default: return { t: 'SKIP', by: cur, g: gd };
    }
  }
  if (g.phase === 'final') {
    const p = Object.values(g.players).find((x) => x.fin && x.fin.step !== 'done');
    if (!p) return { t: 'REVEAL', by: H, force: true };
    const pid = p.id;
    if (p.fin.step === 'choose') return { t: 'FN_CHOOSE', by: pid, pid, job: pickBy(p.jobs, (j) => E.score(p.apt, j).total) };
    if (p.fin.step === 'present') return { t: 'FN_PRESENT', by: pid, pid };
  }
  return null;
}

// 比較用: ゲーム中の選択を無作為にする自動プレイヤー（最後の職業だけは一番点の高いものを選ぶ）
function randomAction(g, rng, cfg) {
  const H = 'H';
  const pick = (arr) => arr[Math.floor(rng.next() * arr.length)];
  if (g.phase !== 'main' || g.hold) return botAction(g, rng, cfg);
  if (g.career) {
    const pid = Object.keys(g.career.st).find((x) => !g.career.st[x].done && g.players[x].status === 'active');
    if (!pid) return { t: 'CR_CLOSE', by: H };
    const s = g.career.st[pid];
    const c = D.CAREERS[g.career.stage];
    if (!s.route) return { t: 'CR_ROUTE', by: pid, pid, route: pick(c.routes.concat([c.common])).id };
    const route = E.careerRoute(g.career.stage, s.route);
    const idxs = route.acts.map((x, i) => i).filter((i) => g.players[pid].apt[route.acts[i][1]] < D.APT_CAP);
    return idxs.length ? { t: 'CR_ACT', by: pid, pid, i: pick(idxs) } : { t: 'CR_PASS', by: pid, pid };
  }
  const t = g.turn;
  const cur = t.pid;
  const gd = { turn: t.id };
  if (t.stage === 'act' && t.sq.eff !== 'life') return { t: 'PICK', by: cur, i: Math.floor(rng.next() * t.sq.opts.length), g: gd };
  if (t.stage === 'challenge') {
    const m = t.ch.members.find((x) => !t.ch.st[x].done);
    const st = t.ch.st[m];
    const scene = E.sceneOf(t.ch);
    if (st.tier === 'mid') return { t: 'CH_REWARD', by: m, pid: m, a: pick(st.rw), g: gd };
    if (st.pick < 0) {
      const idxs = scene.opts.map((x, i) => i).filter((i) => g.players[m].apt[scene.opts[i][1]] < D.APT_CAP);
      return { t: 'CH_PICK', by: m, pid: m, i: pick(idxs), g: gd };
    }
  }
  if (t.stage === 'fork') return { t: 'FORK', by: cur, b: Math.floor(rng.next() * 2), g: gd };
  return botAction(g, rng, cfg);
}

function playGame(seed, n, settings, cfg, policy) {
  const rng = mkRng(seed);
  let now = 1e6;
  let g = E.newGame({ hostId: 'H', hostName: 'ホスト', hostPlays: false, now });
  const apply = (a) => {
    now += 1000;
    const r = E.apply(g, a, { now, seed: Math.floor(rng.next() * 4294967296) });
    if (!r.ok) throw new Error(`${a.t} ${r.reason}`);
    g = r.game;
  };
  for (let i = 0; i < n; i++) apply({ t: 'JOIN', by: `P${i}`, pid: `P${i}`, name: `p${i}` });
  apply({ t: 'SETTINGS', by: 'H', patch: settings });
  apply({ t: 'START', by: 'H' });
  // 時間の積算
  let sec = COST.explain + COST.setup;
  const timeline = { turns: 0, careers: 0, turnSec: [] };
  let turnSec = 0;
  let curTurn = null;
  let careerSeen = null;
  for (let guard = 0; guard < 5000 && g.phase !== 'results'; guard++) {
    const a = (policy === 'random' ? randomAction : botAction)(g, rng, cfg);
    if (!a) throw new Error('no action');
    const before = g;
    // 決める種類ごとに時間を足す
    if (before.phase === 'main' && before.turn && !before.career) {
      const t = before.turn;
      if (curTurn !== t.id) {
        if (curTurn !== null) timeline.turnSec.push(turnSec);
        curTurn = t.id; turnSec = COST.turnStart; timeline.turns += 1;
      }
      const map = {
        ROLL: COST.roll + COST.read, FORK: COST.fork, PICK: t.sq && t.sq.eff === 'job' ? COST.pickJob : t.sq && t.sq.eff === 'life' ? COST.life : COST.pick3,
        PASS: COST.pick3, PARTNER: COST.partner, RESPOND: COST.invite, CH_ROLL: a.pid === t.pid ? COST.challengeRoll : 0,
        CH_REWARD: a.pid === t.pid ? COST.reward : 0, CH_PICK: a.pid === t.pid ? COST.pick3 : COST.partnerTurn - COST.pick3 / 2,
        END_TURN: COST.endTurn, SKIP: COST.skip,
      };
      turnSec += map[a.t] || 0;
    }
    if (before.phase === 'main' && before.career && careerSeen !== before.career.round) {
      careerSeen = before.career.round;
      const proxies = 0;
      sec += COST.careerIntro + COST.careerPick + proxies * COST.careerProxyEach;
      timeline.careers += 1;
    }
    apply(a);
  }
  if (curTurn !== null) timeline.turnSec.push(turnSec);
  sec += timeline.turnSec.reduce((s, x) => s + x, 0) + COST.final;
  return { g, sec, timeline };
}

function pct(arr, q) { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; }
function mean(arr) { return arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length); }

const cfg = { invite: 0.7, accept: 0.6, lifeDecline: 0.25 };
const RUNS = Number(process.env.RUNS || 300);

console.log('## 所要時間の推定（モデル。人による実測ではない）');
console.log('人数 | 時間チップ | 進路 | 平均 | 90%点 | 1手番の平均（秒） | 手番数');
console.log('---|---|---|---|---|---|---');
const timeRows = [];
for (let n = 1; n <= 8; n++) {
  const chips = E.recommendedChips(n);
  const career = E.recommendedCareer(chips);
  const secs = []; const tsec = []; const turns = [];
  for (let k = 0; k < RUNS; k++) {
    const r = playGame(1000 + n * 7919 + k, n, { chips, career, life: true, endRule: 'present', timerSec: 0 }, cfg);
    secs.push(r.sec / 60); tsec.push(mean(r.timeline.turnSec)); turns.push(r.timeline.turns);
  }
  const row = { n, chips, career, avg: mean(secs), p90: pct(secs, 0.9), turnAvg: mean(tsec), turns: mean(turns) };
  timeRows.push(row);
  console.log(`${n}人 | ${chips}枚 | ${career}回 | ${row.avg.toFixed(1)}分 | ${row.p90.toFixed(1)}分 | ${row.turnAvg.toFixed(0)} | ${row.turns.toFixed(1)}`);
}
// 45分に収まる「1手番の平均秒数」の上限（説明・準備・進路・終盤の固定分を引いた残り）
console.log('\n45分に収まる1手番の平均（秒）の上限: ' + timeRows.map((r) => {
  const fixed = COST.explain + COST.setup + COST.final + r.career * (COST.careerIntro + COST.careerPick);
  return `${r.n}人 ${Math.floor((45 * 60 - fixed) / r.turns)}秒`;
}).join(' / '));
// 7〜8人で5枚にした場合
[7, 8].forEach((n) => {
  const secs = [];
  for (let k = 0; k < RUNS; k++) secs.push(playGame(5000 + n * 13 + k, n, { chips: 5, career: 1, life: true, endRule: 'present', timerSec: 0 }, cfg).sec / 60);
  console.log(`${n}人（5枚・進路1回） | 5枚 | 1回 | ${mean(secs).toFixed(1)}分 | ${pct(secs, 0.9).toFixed(1)}分 | - | -`);
});

console.log('\n## 得点のバランス（仕上げのサイコロ・目標に合わせて選ぶ自動プレイヤー）');
console.log('設定 | 通常の平均 | 最終の平均 | 同点1位 | 通常の1位が1位でなくなる | 点差1で入れ替わり | 点差2 | 点差3（同点どまり） | 点差4以上 | 準備チップ（平均）');
console.log('---|---|---|---|---|---|---|---|---|---');
function balance(label, n, settings, policy) {
  const base = []; const fin = []; let ties = 0; let games = 0; let leaderLost = 0; const prep = [];
  const byGap = {}; // gap -> [count, overtaken]
  for (let k = 0; k < RUNS; k++) {
    const { g } = playGame(9000 + k * 31 + n, n, settings, cfg, policy);
    games += 1;
    const rs = g.results.rows;
    rs.forEach((r) => { base.push(r.base); fin.push(r.final); });
    Object.values(g.players).forEach((p) => prep.push(p.prep));
    if (rs.length >= 2) {
      if (rs[0].final === rs[1].final) ties += 1;
      // 通常得点の1位（単独）と2位の差ごとに、最終で1位の座を失った率
      const byBase = rs.slice().sort((a, b) => b.base - a.base);
      if (byBase[0].base > byBase[1].base) {
        const gap = Math.min(4, byBase[0].base - byBase[1].base);
        const top = Math.max(...rs.map((r) => r.final));
        const lost = byBase[0].final < top ? 1 : 0; // 抜かれた
        const tiedNow = byBase[0].final === top && rs.filter((r) => r.final === top).length > 1 ? 1 : 0;
        byGap[gap] = byGap[gap] || [0, 0, 0];
        byGap[gap][0] += 1; byGap[gap][1] += lost; byGap[gap][2] += tiedNow;
        leaderLost += lost;
      }
    }
  }
  const cell = (gap) => {
    const v = byGap[gap];
    if (!v || !v[0]) return '-';
    return `抜かれ${(100 * v[1] / v[0]).toFixed(0)}%・並ばれ${(100 * v[2] / v[0]).toFixed(0)}%`;
  };
  const ld = Object.values(byGap).reduce((s2, v) => s2 + v[0], 0);
  console.log(`${label} | ${mean(base).toFixed(1)} | ${mean(fin).toFixed(1)} | ${n >= 2 ? (100 * ties / games).toFixed(0) + '%' : '-'} | ${n >= 2 && ld ? (100 * leaderLost / ld).toFixed(0) + '%' : '-'} | ${cell(1)} | ${cell(2)} | ${cell(3)} | ${cell(4)} | ${mean(prep).toFixed(2)}`);
}
balance('4人・6枚・進路2（目標に合わせる）', 4, { chips: 6, career: 2, life: true, endRule: 'present' });
balance('4人・6枚・進路2・仕上げなし（比較）', 4, { chips: 6, career: 2, life: true, endRule: 'none' });
balance('4人・6枚・進路2（無作為に選ぶ）', 4, { chips: 6, career: 2, life: true, endRule: 'present' }, 'random');
balance('2人・8枚・進路2', 2, { chips: 8, career: 2, life: true, endRule: 'present' });
balance('3人・8枚・進路2', 3, { chips: 8, career: 2, life: true, endRule: 'present' });
balance('6人・5枚・進路1', 6, { chips: 5, career: 1, life: true, endRule: 'present' });
balance('7人・4枚・進路1', 7, { chips: 4, career: 1, life: true, endRule: 'present' });
balance('1人・8枚・進路2', 1, { chips: 8, career: 2, life: true, endRule: 'present' });
