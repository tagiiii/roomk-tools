/* ちゃりんバトン — 小銭の問題づくりと対決のルール
   画面と通信に触らない。ブラウザでは window.CharinEngine、node では module.exports。
   状態は JSON にできる値だけで持つ（ルームではそのまま Realtime Database に置く）。 */
(function (root) {
  'use strict';

  // 実物の直径（mm）。大きさの比だけ使う。図柄は描かない
  const COINS = {
    1: { v: 1, d: 20.0, hole: false },
    5: { v: 5, d: 22.0, hole: true },
    10: { v: 10, d: 23.5, hole: false },
    50: { v: 50, d: 21.0, hole: true },
    100: { v: 100, d: 22.6, hole: false },
    500: { v: 500, d: 26.5, hole: false },
  };
  const KINDS = {
    all: { label: 'ぜんぶ', note: '1・5・10・50・100・500円', values: [1, 5, 10, 50, 100, 500] },
    three: { label: '3種類だけ', note: '1・10・100円', values: [1, 10, 100] },
  };
  const SAME_MAX = 3;          // 同じ硬貨は3枚まで
  const TRAY = { w: 150, h: 90 }; // トレーの大きさ（mm と同じ目盛り）
  const GAP = 3;               // 硬貨どうしのすき間
  const REVEAL_MS = 1500;      // 正解を見せる間（ふたりとも時計を止める）
  const PASS_MS = 3000;        // パスで待つ間（自分の時計は減る）
  const READY_MS = 3000;       // はじまる前の 3・2・1（時計は止まっている・小銭はかくす）
  const MIN_COINS = 2;

  // ── くじ ──
  // seed つきの乱数（テストで同じ並びを出すため）。ふだんは Math.random
  function makeRng(seed) {
    if (seed == null) return Math.random;
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

  // その人が正解した数から、次の問題の枚数を決める（2問正解するごとに1枚増える）
  function coinCountFor(correct, max) {
    return Math.max(MIN_COINS, Math.min(max, MIN_COINS + Math.floor(correct / 2)));
  }

  const keyOf = (values) => values.slice().sort((a, b) => a - b).join('+');
  const totalOf = (values) => values.reduce((a, b) => a + b, 0);

  // 硬貨の組み合わせを作る。同じ硬貨は3枚まで・直前と同じ組み合わせにしない
  function makeCoins(rng, count, kinds, prevKey) {
    const values = (KINDS[kinds] || KINDS.all).values;
    const n = Math.min(count, values.length * SAME_MAX);
    let best = null;
    for (let tries = 0; tries < 60; tries += 1) {
      const used = {};
      const out = [];
      while (out.length < n) {
        const v = pick(rng, values);
        if ((used[v] || 0) >= SAME_MAX) continue;
        used[v] = (used[v] || 0) + 1;
        out.push(v);
      }
      best = out;
      if (keyOf(out) !== prevKey) break;
    }
    return best;
  }

  // 並べる。ばらばら（重ならない・少し回す）／そろえる（金額の大きい順に並べる）
  function layout(rng, values, arrange) {
    if (arrange !== 'sort') {
      const placed = tryScatter(rng, values);
      if (placed) return placed;
    }
    return lineUp(values);
  }

  function tryScatter(rng, values) {
    // 大きい硬貨から置く（すき間に小さいのが入りやすい）。出す順はくじのまま
    const order = values.map((v, i) => ({ v, i })).sort((a, b) => COINS[b.v].d - COINS[a.v].d);
    for (let round = 0; round < 40; round += 1) {
      const out = new Array(values.length);
      let ok = true;
      for (const { v, i } of order) {
        const r = COINS[v].d / 2;
        let spot = null;
        for (let t = 0; t < 200 && !spot; t += 1) {
          const x = r + GAP + rng() * (TRAY.w - 2 * (r + GAP));
          const y = r + GAP + rng() * (TRAY.h - 2 * (r + GAP));
          const hit = out.some((c) => c && Math.hypot(c.x - x, c.y - y) < r + COINS[c.v].d / 2 + GAP);
          if (!hit) spot = { x, y };
        }
        if (!spot) { ok = false; break; }
        out[i] = { v, x: round1(spot.x), y: round1(spot.y), rot: Math.round(rng() * 60 - 30) };
      }
      if (ok) return out;
    }
    return null;
  }

  function lineUp(values) {
    const sorted = values.slice().sort((a, b) => b - a);
    const cell = 26.5 + GAP * 2;
    const perRow = Math.floor(TRAY.w / cell);
    const rows = Math.ceil(sorted.length / perRow);
    const out = [];
    sorted.forEach((v, k) => {
      const row = Math.floor(k / perRow);
      const inRow = row === rows - 1 ? sorted.length - row * perRow : perRow;
      const col = k - row * perRow;
      const x = TRAY.w / 2 + (col - (inRow - 1) / 2) * cell;
      const y = TRAY.h / 2 + (row - (rows - 1) / 2) * cell;
      out.push({ v, x: round1(x), y: round1(y), rot: 0 });
    });
    return out;
  }
  const round1 = (n) => Math.round(n * 10) / 10;

  // 1問を作る
  function makeProblem(rng, opts) {
    const values = makeCoins(rng, opts.count, opts.kinds, opts.prevKey);
    return { coins: layout(rng, values, opts.arrange), key: keyOf(values), total: totalOf(values) };
  }

  // 「100円玉 2枚・10円玉 3枚」
  function breakdown(coins) {
    const n = {};
    coins.forEach((c) => { n[c.v] = (n[c.v] || 0) + 1; });
    return Object.keys(n).map(Number).sort((a, b) => b - a).map((v) => v + '円玉 ' + n[v] + '枚').join('・');
  }

  // ══════════════════════════════════════════════
  // 対決（2〜6人の勝ち残り。2人なら1対1の対決。1人なら、時計が0になるまで数えつづける。勝ち負けはなく、正解の数が点数）
  // settings = { players: [{ name, time(秒), kinds }, …], maxCoins, arrange, first: 先に答える人の番号 }
  // phase: ready（はじまる前の 3・2・1）→ play
  //        play（番の人が数える）→ reveal（正解を見せる。時計は止まる）→ 残っている次の人の play
  //        play → pass（問題をかくして3秒。自分の時計は減る）→ 同じ人の play
  //        play / pass で番の人の時計が0 → その人は「ここまで」（out）
  //          残りが2人以上なら out（その小銭を見せる。時計は止まる）→ 残っている次の人の play
  //          残りが1人なら over（その人の勝ち）。1人で遊んでいるときは over（勝ち負けなし。winner は null）
  // ══════════════════════════════════════════════
  const MIN_PLAYERS = 1;
  const MAX_PLAYERS = 6;
  const OUT_MS = 1500;         // 「ここまで」を見せる間（みんなの時計を止める）
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function nextProblem(S, who, rng) {
    const p = S.settings.players[who];
    return makeProblem(rng, {
      count: coinCountFor(S.correct[who], S.settings.maxCoins),
      kinds: p.kinds,
      arrange: S.settings.arrange,
      prevKey: S.problem ? S.problem.key : null,
    });
  }

  // まだ残っている人の数
  const aliveCount = (S) => S.out.filter((o) => !o).length;
  // from の次に答える、まだ残っている人（from 自身は数えない）
  function nextAlive(S, from) {
    const n = S.settings.players.length;
    for (let k = 1; k <= n; k += 1) {
      const i = (from + k) % n;
      if (!S.out[i]) return i;
    }
    return from;
  }

  function createDuel(settings, now, rng) {
    const n = settings.players.length;
    const first = Number.isInteger(settings.first) && settings.first >= 0 && settings.first < n ? settings.first : 0;
    const S = {
      settings: clone(Object.assign({}, settings, { first })),
      phase: 'ready',
      turn: first,
      rem: settings.players.map((p) => p.time * 1000),
      at: now,          // 番の人の時計が動きはじめた時刻
      phaseEnd: now + READY_MS,
      correct: settings.players.map(() => 0),
      out: settings.players.map(() => false), // 時計が0になって「ここまで」になった人
      problem: null,
      history: [],      // 出た問題（だれが解いたかは画面に出さない）
      last: null,       // 直前の正解 { total, by }
      lastOut: null,    // 直前に「ここまで」になった人
      winner: null,
      rev: 0,
      startedAt: now, // 対決ごとの印（ルームで新しい対決を見分ける）
    };
    S.problem = nextProblem(S, S.turn, rng);
    return S;
  }

  // いまの残り時間（ms）
  function remaining(S, i, now) {
    if (i === S.turn && (S.phase === 'play' || S.phase === 'pass')) return Math.max(0, S.rem[i] - (now - S.at));
    return S.rem[i];
  }

  // 番の人の時計が0になった。残りが1人なら決着、2人以上なら「ここまで」を見せてから次の人へ
  function finish(S, now) {
    // 時間切れのときの小銭も、答えといっしょに一覧に入れる。
    // パスの間に切れたときは、パスした小銭（いま出ている小銭）がもう入っているので、それを時間切れにする
    const last = S.history[S.history.length - 1];
    if (S.phase === 'pass' && last) last.how = 'timeout';
    else if (S.phase === 'play') S.history.push({ coins: S.problem.coins, total: S.problem.total, how: 'timeout' });
    S.rem[S.turn] = 0;
    S.out[S.turn] = true;
    S.lastOut = S.turn;
    if (aliveCount(S) <= 1) {
      S.phase = 'over';
      const w = S.out.findIndex((o) => !o);
      S.winner = w >= 0 ? w : null;
    } else {
      S.phase = 'out';
      S.phaseEnd = now + OUT_MS;
    }
    S.rev += 1;
    return S;
  }

  // 答える。result: ok（正解）／ng（ちがう）／ignored（番でない・時間切れなど）
  function answer(S0, who, value, now) {
    if (S0.phase !== 'play' || who !== S0.turn) return { state: S0, result: 'ignored' };
    if (remaining(S0, who, now) <= 0) return { state: finish(clone(S0), now), result: 'ignored' };
    const n = Number(value);
    if (!Number.isFinite(n) || n !== S0.problem.total) return { state: S0, result: 'ng' };
    const S = clone(S0);
    S.rem[who] = remaining(S0, who, now);
    S.correct[who] += 1;
    S.history.push({ coins: S.problem.coins, total: S.problem.total, how: 'ok' });
    S.last = { total: S.problem.total, by: who };
    S.phase = 'reveal';
    S.phaseEnd = now + REVEAL_MS;
    S.rev += 1;
    return { state: S, result: 'ok' };
  }

  function pass(S0, who, now) {
    if (S0.phase !== 'play' || who !== S0.turn) return S0;
    if (remaining(S0, who, now) <= 0) return finish(clone(S0), now);
    const S = clone(S0);
    S.history.push({ coins: S.problem.coins, total: S.problem.total, how: 'pass' });
    S.phase = 'pass';
    S.phaseEnd = now + PASS_MS;
    S.rev += 1;
    return S;
  }

  // 番を、残っている次の人へ渡す
  function handOver(S, now, rng) {
    S.turn = nextAlive(S, S.turn);
    S.problem = nextProblem(S, S.turn, rng);
    S.phase = 'play';
    S.at = now;
    S.rev += 1;
    return S;
  }

  // 時間で進める（3・2・1 のおわり・時間切れ・正解の間のおわり・「ここまで」のおわり・パスのおわり）
  function tick(S0, now, rng) {
    if (S0.phase === 'over') return S0;
    if (S0.phase === 'ready') {
      if (now < S0.phaseEnd) return S0;
      const S = clone(S0);
      S.phase = 'play';
      S.at = now;
      S.rev += 1;
      return S;
    }
    if ((S0.phase === 'play' || S0.phase === 'pass') && remaining(S0, S0.turn, now) <= 0) return finish(clone(S0), now);
    if ((S0.phase === 'reveal' || S0.phase === 'out') && now >= S0.phaseEnd) return handOver(clone(S0), now, rng);
    if (S0.phase === 'pass' && now >= S0.phaseEnd) {
      const S = clone(S0);
      S.problem = nextProblem(S, S.turn, rng);
      S.phase = 'play';   // 時計は止めずに続ける（at はそのまま）
      S.rev += 1;
      return S;
    }
    return S0;
  }

  // つづきから: 時計を止めていた時刻 frozenAt の残り時間を残して、3・2・1 からやりなおす。
  // ルームでホストが戻ったとき（止めていた間は数えない）・1台の画面で読み込み直したときに使う
  function resume(S0, frozenAt, now, rng) {
    if (S0.phase === 'over') return S0;
    const S = clone(S0);
    if (S0.phase === 'play' || S0.phase === 'pass') {
      S.rem[S.turn] = remaining(S0, S.turn, frozenAt);
      if (S.rem[S.turn] <= 0) {
        finish(S, now);
        if (S.phase === 'over') return S;
      }
    }
    if (S.phase === 'reveal' || S.phase === 'out') {
      S.turn = nextAlive(S, S.turn);
      S.problem = nextProblem(S, S.turn, rng);
    } else if (S.phase === 'pass') {
      S.problem = nextProblem(S, S.turn, rng);
    }
    S.phase = 'ready';
    S.phaseEnd = now + READY_MS;
    S.rev += 1;
    return S;
  }

  // いま時間で進めるところがあるか（3・2・1 のおわり・正解の帯のおわり・「ここまで」のおわり・パスのおわり・時間切れ）
  function due(S, now) {
    if (S.phase === 'over') return false;
    if (S.phase === 'ready' || S.phase === 'reveal' || S.phase === 'out') return now >= S.phaseEnd;
    if (S.phase === 'pass' && now >= S.phaseEnd) return true;
    return remaining(S, S.turn, now) <= 0;
  }

  const api = {
    COINS, KINDS, TRAY, REVEAL_MS, PASS_MS, READY_MS, OUT_MS, SAME_MAX, MIN_PLAYERS, MAX_PLAYERS,
    makeRng, coinCountFor, makeCoins, layout, makeProblem, breakdown, keyOf, totalOf,
    createDuel, remaining, answer, pass, tick, resume, due, nextAlive, aliveCount,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CharinEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
