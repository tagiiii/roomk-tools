/* キャリアすごろく v2 — つり合いのシミュレーション
   使い方: node tests/career-sugoroku/sim.cjs [ゲーム数]
   いろいろな人数・選び方で自動対戦し、道ごとの平均点・ゴール順と順位の関係・手番の数を出す。
   ここで見るのは「どの道を選んでも同じくらい勝てるか」「ゴール順と職業の★の両方が効いているか」。
   1位の割合は、同点1位を人数で分けて数える（k人が同点なら 1/k 勝ずつ）。均等なら「1÷人数」になる。
   ± は 95% のおおよその幅（同じゲームの中の人どうしは独立ではないので目安）。 */
'use strict';
const path = require('path');
const E = require(path.join(__dirname, '..', '..', 'apps', 'career-sugoroku', 'engine.js'));
const D = require(path.join(__dirname, '..', '..', 'apps', 'career-sugoroku', 'data.js'));

const GAMES = Number(process.argv[2]) || 3000;
// 試しに数値を変える: GB=6,4,2,1,0,0 LEVELS=1,2,3 node tests/sim.cjs
if (process.env.GB) D.GOAL_BONUS.splice(0, D.GOAL_BONUS.length, ...process.env.GB.split(',').map(Number));
if (process.env.LEVELS) D.STAR_LEVELS.splice(0, D.STAR_LEVELS.length, ...process.env.LEVELS.split(',').map(Number));
if (process.env.SB) { const [a, b, c, d] = process.env.SB.split(',').map(Number); D.STUDY_BONUS.stop18 = { picks: a, pts: b }; D.STUDY_BONUS.stop22 = { picks: c, pts: d }; }
if (process.env.PAY) D.STAR_PAY.splice(0, D.STAR_PAY.length, ...process.env.PAY.split(',').map(Number));
if (process.env.EXACT === '0') D.EXACT_PAY_BONUS = false; // しごとマスにぴったりのボーナスなし（入れる前と比べる）
// MIX=1: ゲームごとにランダムに選んだ半数を「適当に選ぶ人」（職業・適性・転職・サイコロの目をランダム）にして、考えて選ぶ人との点の差を見る
const MIX = !!process.env.MIX;
// MIXDICE=1: ゲームごとにランダムに選んだ半数は、職業・適性は考えて選ぶが、サイコロの目だけ適当に選ぶ（サイコロの選び方の効き目を見る）
const MIXDICE = !!process.env.MIXDICE;
const ONLY = process.env.N ? process.env.N.split(',').map(Number) : [1, 2, 3, 4, 5, 6];

// 選び方（プレイヤーごとに固定）: 道は学び/しごとをランダム、寄り道は半々、職業は★の多いもの
function policy(rng) {
  return {
    c: rng() < 0.5 ? 0 : 1, // 15さい: 0=学び 1=しごと
    d: rng() < 0.5 ? 0 : 1, // 18さい
    forkLong: rng() < 0.5,
    naive: false,
  };
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function decide(s, pol, rng) {
  const st = s.step;
  const p = s.players[s.cur];
  const mine = pol[p.id];
  switch (st.kind) {
    case 'roll': {
      const cheer = s.players.find((q) => q.done && q.id !== p.id);
      return { type: 'roll', cheer: cheer ? cheer.id : undefined };
    }
    case 'skip': case 'ack': return { type: 'ack' };
    case 'dice': {
      if (mine.naive || mine.naiveDice) return { type: 'dice', pick: rng() < 0.5 ? 0 : 1 };
      const score = (steps) => {
        const pv = E.previewMove(s, steps);
        const n = E.NODE[pv.node];
        if (pv.kind === 'goal') return 100;
        // 速さはゴール順のボーナスにだけ効くので、おとなのステージで重くする
        let v = steps * (n.stage === 'adult' ? 0.5 : 0.1);
        const top3 = p.apt.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);
        const aptValue = (a) => (p.job != null ? (D.JOBS[p.job].apts.includes(a) ? 1.7 : 0.4) : (top3.includes(a) ? 1.0 : 0.6));
        if (pv.kind === 'land') {
          if (pv.exactPay) v += D.STAR_PAY[E.stars(p.apt, p.job) - 1];
          else if (n.type === 'exp') v += aptValue(n.apt);
          else if (n.type === 'choose') v += 1.2; // 3つから選べる
          else if (n.type === 'grow') v += p.job != null ? 1.7 : 0.3;
          else if (n.type === 'friend') v += aptValue(n.apt) + 0.2;
          else if (n.type === 'mini') v += 0.4;
          else if (n.type === 'event') v += 0.2;
          else if (n.type === 'change') v += 0.2;
        }
        return v;
      };
      const c = s.last.cheer || 0;
      return { type: 'dice', pick: score(st.dice[0] + c) >= score(st.dice[1] + c) ? 0 : 1 };
    }
    case 'fork': return { type: 'fork', choice: mine.forkLong ? 1 : 0 };
    case 'route': return { type: 'route', choice: st.node === 'stop15' ? mine.c : mine.d };
    case 'job': {
      if (mine.naive) return st.keep && rng() < 0.5 ? { type: 'job', job: 'keep' } : { type: 'job', job: Math.floor(rng() * D.JOBS.length) };
      const best = E.jobOptions(p.apt)[0];
      if (st.keep && p.job != null && E.stars(p.apt, p.job) >= best.stars) return { type: 'job', job: 'keep' };
      return { type: 'job', job: best.id };
    }
    case 'friend': {
      const o = s.players.filter((q) => q.id !== p.id);
      return { type: 'friend', pid: o[Math.floor(rng() * o.length)].id };
    }
    case 'pick': {
      if (mine.naive) return { type: 'pick', a: st.opts[Math.floor(rng() * st.opts.length)] };
      // 仕事があればその★につながる適性（いちばん低いものを上げる）、なければいちばん★に近い職業を狙う
      const val = (ap, j) => E.stars(ap, j) * 100 + Math.min(...D.JOBS[j].apts.map((k) => ap[k])) * 10 + E.jobSum(ap, j);
      let best = st.opts[0];
      let bestScore = -1;
      st.opts.forEach((a) => {
        const probe = p.apt.slice();
        probe[a] = Math.min(D.APT_CAP, probe[a] + 1);
        const score = p.job != null ? val(probe, p.job) : Math.max(...D.JOBS.map((j) => val(probe, j.id)));
        if (score > bestScore) { bestScore = score; best = a; }
      });
      return { type: 'pick', a: best };
    }
    case 'vote': return { type: 'vote', opt: Math.floor(rng() * st.opts.length) };
    case 'coop': return { type: 'coop' };
    case 'mini': {
      const opts = { hilo: ['hi', 'lo'], janken: ['g', 'c', 'p'], sum: [1, 2, 3] }[st.game];
      const picks = {};
      s.players.forEach((q) => { picks[q.id] = opts[Math.floor(rng() * opts.length)]; });
      return { type: 'mini', picks };
    }
    default: throw new Error('unknown step ' + st.kind);
  }
}

function play(nPlayers, seed) {
  const rng = mulberry(seed * 7919 + 13);
  const names = Array.from({ length: nPlayers }, (_, i) => 'P' + i);
  let s = E.newGame({ names, seed, dice: process.env.DICE === '1' ? 1 : 2 });
  // 先に振る席が有利なので、「適当に選ぶ人」の席はゲームごとにランダムに半分選ぶ（いつも同じ席にしない）
  const seats = names.map((_, i) => i);
  for (let i = seats.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [seats[i], seats[j]] = [seats[j], seats[i]]; }
  const naiveSet = new Set(seats.slice(0, Math.floor(names.length / 2)));
  const pol = names.map((_, i) => Object.assign(policy(rng), { naive: MIX && naiveSet.has(i), naiveDice: MIXDICE && naiveSet.has(i) }));
  let guard = 0;
  while (s.phase === 'play') {
    const a = decide(s, pol, rng);
    const r = E.apply(s, a);
    if (!r.ok) throw new Error(`拒否: ${r.error} step=${JSON.stringify(s.step)} action=${JSON.stringify(a)}`);
    s = r.state;
    if (++guard > 20000) throw new Error('終わらない');
  }
  return { s, pol };
}

const pad = (v, n) => String(v).padStart(n);
const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
// 割合と 95% のおおよその幅（±）
const pct = (win, n) => {
  const p = n ? win / n : 0;
  return `${(100 * p).toFixed(0)}%±${(196 * Math.sqrt(p * (1 - p) / Math.max(1, n))).toFixed(0)}`;
};

for (const n of ONLY) {
  const byRoute = {};
  const turnsAll = [];
  const gameTurns = [];
  let firstWins = 0;
  let firstGames = 0;
  const winnerFinish = {};
  const starsAt22 = [];
  const payAll = [];
  const bonusAll = [];
  const eventAll = [];
  const miniAll = [];
  let miniGames = 0;
  const totals = [];
  const longShort = { long: [], short: [] };
  const byPolicy = { smart: [], naive: [], smartWin: 0, naiveWin: 0, smartN: 0, naiveN: 0 };
  for (let g = 0; g < GAMES; g++) {
    const { s, pol } = play(n, g + 1 + n * 100000);
    gameTurns.push(s.turnNo);
    miniGames += s.log.filter((x) => x.text.startsWith('ミニゲーム「') && !x.text.includes('」:')).length;
    s.players.forEach((p) => {
      const key = (p.lanes.c === 'cs' ? '学' : 'し') + (p.lanes.d === 'ds' ? '学' : 'し');
      const total = E.total(p);
      (byRoute[key] = byRoute[key] || { tot: [], win: 0, n: 0, pay: [], turns: [] });
      byRoute[key].tot.push(total);
      byRoute[key].pay.push(p.pts.pay);
      byRoute[key].turns.push(p.turns);
      byRoute[key].n++;
      const row = s.results.find((r) => r.pid === p.id);
      const tops = s.results.filter((r) => r.place === 1).length;
      const share = row.place === 1 ? 1 / tops : 0; // 同点1位は人数で分ける
      byRoute[key].win += share;
      turnsAll.push(p.turns);
      payAll.push(p.pts.pay);
      bonusAll.push(p.pts.bonus);
      eventAll.push(p.pts.event);
      miniAll.push(p.pts.mini);
      totals.push(total);
      (pol[p.id].forkLong ? longShort.long : longShort.short).push(total);
      const who = (pol[p.id].naive || pol[p.id].naiveDice) ? 'naive' : 'smart';
      byPolicy[who].push(total);
      byPolicy[who + 'N']++;
      byPolicy[who + 'Win'] += share;
      if (p.job != null) starsAt22.push(E.stars(p.apt, p.job));
    });
    if (n > 1) {
      firstGames++;
      const firsts = s.players.filter((p) => p.rank === 1);
      const top = s.results.filter((r) => r.place === 1).map((r) => r.pid);
      firstWins += firsts.filter((f) => top.includes(f.id)).length / top.length; // 同点1位は人数で分ける
      top.forEach((pid) => { const rk = s.players[pid].rank; winnerFinish[rk] = (winnerFinish[rk] || 0) + 1 / top.length; });
    }
  }
  console.log(`\n=== ${n}人 × ${GAMES}ゲーム ===`);
  console.log(`1人あたりの手番: 平均 ${avg(turnsAll).toFixed(1)}（最小 ${Math.min(...turnsAll)} / 最大 ${Math.max(...turnsAll)}）  1ゲームの手番の合計: 平均 ${avg(gameTurns).toFixed(1)}`);
  console.log(`点の内訳（平均）: しごと ${avg(payAll).toFixed(1)} / イベント ${avg(eventAll).toFixed(1)} / ミニゲーム ${avg(miniAll).toFixed(1)} / ゴール ${avg(bonusAll).toFixed(1)} / 合計 ${avg(totals).toFixed(1)}  最後の★（平均）${avg(starsAt22).toFixed(2)}  ミニゲームの回数（1ゲーム平均）${(miniGames / GAMES).toFixed(1)}`);
  if (n > 1) {
    console.log(`1番にゴールした人が1位になる割合: ${pct(firstWins, firstGames)}（均等なら ${(100 / n).toFixed(0)}%）   1位の人のゴール順: ${Object.keys(winnerFinish).sort().map((k) => `${k}番目 ${(100 * winnerFinish[k] / Object.values(winnerFinish).reduce((a, b) => a + b, 0)).toFixed(0)}%`).join(' / ')}`);
  }
  console.log(`道（15さい→18さい）  人数   平均点  しごとの点  手番   1位の割合（均等なら ${(100 / n).toFixed(0)}%）`);
  Object.keys(byRoute).sort().forEach((k) => {
    const r = byRoute[k];
    console.log(`  ${k}                ${pad(r.n, 6)}  ${pad(avg(r.tot).toFixed(1), 6)}  ${pad(avg(r.pay).toFixed(1), 8)}  ${pad(avg(r.turns).toFixed(1), 5)}  ${pad(pct(r.win, r.n), 8)}`);
  });
  const hist = [1, 2, 3, 4].map((k) => `★${k} ${(100 * starsAt22.filter((v) => v === k).length / starsAt22.length).toFixed(0)}%`).join(' / ');
  console.log(`最後の★の分布: ${hist}`);
  if ((MIX || MIXDICE) && byPolicy.naive.length) console.log(`考えて選ぶ人 平均${avg(byPolicy.smart).toFixed(1)}点・1位${pct(byPolicy.smartWin, byPolicy.smartN)} ／ 適当に選ぶ人 平均${avg(byPolicy.naive).toFixed(1)}点・1位${pct(byPolicy.naiveWin, byPolicy.naiveN)}  差 ${(avg(byPolicy.smart) - avg(byPolicy.naive)).toFixed(1)}点`);
  console.log(`寄り道を選ぶ人の平均点 ${avg(longShort.long).toFixed(1)} / 近道を選ぶ人 ${avg(longShort.short).toFixed(1)}`);
}
