/* キャリアすごろく v2（試作）— ゲームエンジン
   画面から独立した状態遷移。apply(state, action) は入力を変更せず、新しい state か拒否理由を返す。
   乱数は state.rng から作るので、同じ state と action なら同じ結果になる（テスト・あとで通信対応するため）。
   ブラウザでは window.CS_ENGINE、Node では module.exports で読む。 */
(function (root) {
  'use strict';
  const D = (typeof module !== 'undefined' && module.exports) ? require('./data.js') : root.CS_DATA;

  const NODE = {};
  D.NODES.forEach((n) => { NODE[n.id] = n; });
  const DIST = (() => { // ゴールまでの最短のマス数（途中で終えたときの順位づけに使う）
    const prev = {};
    D.NODES.forEach((n) => { prev[n.id] = []; });
    D.NODES.forEach((n) => n.next.forEach((m) => prev[m].push(n.id)));
    const dist = { goal: 0 };
    const q = ['goal'];
    while (q.length) {
      const id = q.shift();
      prev[id].forEach((p) => { if (dist[p] === undefined) { dist[p] = dist[id] + 1; q.push(p); } });
    }
    return dist;
  })();
  const DECK_OF_STAGE = {};
  Object.keys(D.STAGES).forEach((k) => { DECK_OF_STAGE[k] = D.STAGES[k].deck; });

  // ── 乱数 ───────────────────────────────────────
  function rand(s) {
    let t = (s.rng = (s.rng + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const die = (s) => 1 + Math.floor(rand(s) * 6);
  function shuffle(s, arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand(s) * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // ── 職業と★ ─────────────────────────────────────
  const jobSum = (apt, jobId) => D.JOBS[jobId].apts.reduce((a, k) => a + apt[k], 0);
  function stars(apt, jobId) {
    const sum = jobSum(apt, jobId);
    return 1 + D.STAR_STEPS.filter((v) => sum >= v).length;
  }
  // ★の多い順（同じなら合計の多い順、その次は番号順）
  function jobOptions(apt) {
    return D.JOBS.map((j) => ({ id: j.id, stars: stars(apt, j.id), sum: jobSum(apt, j.id) }))
      .sort((a, b) => b.stars - a.stars || b.sum - a.sum || a.id - b.id);
  }

  // ── 小さな道具 ───────────────────────────────────
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const cur = (s) => s.players[s.cur];
  const others = (s, p) => s.players.filter((q) => q.id !== p.id);
  function addApt(p, a, n) {
    const before = p.apt[a];
    p.apt[a] = Math.min(D.APT_CAP, before + (n || 1));
    return p.apt[a] - before;
  }
  function log(s, pid, text) {
    s.log.push({ n: s.turnNo, p: pid, text });
    if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
  }
  function msg(s, m) { s.last.msgs.push(m); }
  const aptName = (a) => D.APTS[a].name;
  const deckOf = (node) => DECK_OF_STAGE[node.stage];

  // その番の記録。id は画面が「どこまで動きを見せたか」を区別するための通し番号、
  // moveFrom はイベントで動き始めた path の位置（画面はそこでイベントのカードを先に見せる）
  function newLast(s, extra) {
    s.seq = (s.seq || 0) + 1;
    // before: 番の始めの全員の適性と職業（結果のカードで「合う適性がふえて★が上がった」を見せるのに使う）
    const before = s.players.map((p) => ({ apt: p.apt.slice(), job: p.job }));
    s.last = Object.assign({ id: s.seq, roll: null, cheer: 0, cheerBy: null, path: [], from: cur(s).node, card: null, moveFrom: null, msgs: [], before }, extra || {});
  }

  // ── ゲームの開始 ─────────────────────────────────
  function newGame(opts) {
    const names = (opts && opts.names) || [];
    const n = Math.max(1, Math.min(D.MAX_PLAYERS, names.length || 1));
    const s = {
      v: 2,
      phase: 'play',
      settings: { labels: opts && opts.labels === 'age' ? 'age' : 'school', dice: opts && opts.dice === 1 ? 1 : 2 },
      players: [],
      cur: 0,
      turnNo: 1,
      round: 1,
      finished: 0,
      step: null,
      queue: [],
      again: false,
      decks: {},
      last: null,
      log: [],
      results: null,
      miniDeck: [],
      rng: ((opts && opts.seed) >>> 0) || 1,
      seq: 0,
    };
    for (let i = 0; i < n; i++) {
      const raw = String(names[i] == null ? '' : names[i]).trim().slice(0, 10);
      s.players.push({
        id: i, name: raw || D.PLAYER_COLORS[i].name, color: i,
        node: 'start', trail: ['start'], apt: [0, 0, 0, 0, 0, 0], job: null, prevJob: null,
        pts: { pay: 0, event: 0, bonus: 0, mini: 0 }, skip: 0, done: false, rank: null, turns: 0,
        lanes: {}, routeNext: {}, paid: [],
      });
    }
    Object.keys(D.DECKS).forEach((k) => { s.decks[k] = shuffle(s, D.DECKS[k].map((_, i) => i)); });
    startTurn(s);
    return s;
  }

  function startTurn(s) {
    const p = cur(s);
    newLast(s);
    s.queue = [];
    s.routeUndo = null;
    s.step = p.skip > 0 ? { kind: 'skip' } : { kind: 'roll' };
  }

  // 決めることが残っていれば次へ、なければ結果のカードへ
  function next(s) {
    s.step = s.queue.length ? s.queue.shift() : { kind: 'ack' };
  }

  function advance(s) {
    if (s.players.every((p) => p.done)) { finishGame(s); return; }
    let i = s.cur;
    for (let k = 0; k < s.players.length; k++) {
      const j = (i + 1) % s.players.length;
      if (j <= i) s.round++;
      i = j;
      if (!s.players[i].done) break;
    }
    s.cur = i;
    s.turnNo++;
    startTurn(s);
  }

  // ── 移動 ───────────────────────────────────────
  // 前へ進む。分かれ道で方向が決まっていなければ止めて聞く。節目とゴールでは目が残っていても止まる。
  function moveForward(s, p, steps, forkChoice) {
    let choice = forkChoice;
    while (steps > 0) {
      const node = NODE[p.node];
      let nextId;
      if (node.type === 'stop') {
        nextId = p.routeNext[node.id] || (node.next.length === 1 ? node.next[0] : null);
        if (!nextId) return { r: 'needRoute', remaining: steps }; // 道がまだ決まっていない（通常は起きない）
      } else if (node.next.length > 1) {
        if (choice == null) return { r: 'fork', remaining: steps };
        nextId = node.next[choice];
        choice = null;
      } else nextId = node.next[0];
      if (!nextId) break;
      p.node = nextId;
      p.trail.push(nextId);
      s.last.path.push(nextId);
      steps--;
      const nn = NODE[nextId];
      if (nn.type === 'pay' && p.job != null && !p.paid.includes(nextId)) {
        p.paid.push(nextId);
        const st = stars(p.apt, p.job);
        const g = D.STAR_PAY[st - 1];
        p.pts.pay += g;
        s.last.paidNow = (s.last.paidNow || []).concat(nextId);
        msg(s, { k: 'pay', n: g, job: p.job, stars: st });
      }
      if (nn.type === 'goal') return { r: 'goal', remaining: 0 };
      if (nn.type === 'stop') return { r: 'stop', remaining: 0 };
    }
    return { r: 'done', remaining: 0 };
  }

  // kind: land（止まるマス）/ fork（分かれ道で方向を選ぶ。left は残りの目）/ stop（節目で止まる）/ goal
  function previewMove(s, steps) {
    const p = cur(s);
    let node = p.node;
    let n = steps;
    let pass = 0; // 途中で通る、まだ払っていないしごとマスの数（止まるマスは数えない）
    while (n > 0) {
      const nd = NODE[node];
      let nextId;
      if (nd.type === 'stop') {
        nextId = p.routeNext[nd.id] || (nd.next.length === 1 ? nd.next[0] : null);
        if (!nextId) return { node, kind: 'stop', pass };
      } else if (nd.next.length > 1) return { node, kind: 'fork', left: n, pass };
      else nextId = nd.next[0];
      if (!nextId) break;
      node = nextId;
      n--;
      const t = NODE[node].type;
      if (t === 'goal') return { node, kind: 'goal', pass };
      if (t === 'stop') return { node, kind: 'stop', pass };
      if (t === 'pay' && n > 0 && p.job != null && !p.paid.includes(node)) pass++;
    }
    const exact = NODE[node].type === 'pay' && p.job != null && !p.paid.includes(node);
    return { node, kind: 'land', exactPay: exact, pass };
  }

  // 後ろへもどる。節目（とスタート）より前へはもどらない。もどった先のマスの効果は起きない。
  function moveBack(s, p, n) {
    let moved = 0;
    while (moved < n && p.trail.length > 1) {
      const t = NODE[p.node].type;
      if (t === 'stop' || t === 'start') break;
      p.trail.pop();
      p.node = p.trail[p.trail.length - 1];
      s.last.path.push(p.node);
      moved++;
    }
    return moved;
  }

  // mode: 'roll'（サイコロで進んだ。止まったマスの効果が起きる）/ 'event'（イベントで進んだ。止まったマスの効果は起きない）
  function runMove(s, p, steps, mode, forkChoice) {
    const res = moveForward(s, p, steps, forkChoice);
    if (res.r === 'fork') {
      s.step = { kind: 'fork', node: p.node, remaining: res.remaining, mode };
      return;
    }
    if (res.r === 'goal') { finishPlayer(s, p); return; }
    if (res.r === 'stop' || res.r === 'needRoute') { arriveStop(s, p); return; }
    if (mode === 'roll') land(s, p);
    else next(s);
  }

  // ── マスの効果 ───────────────────────────────────
  function land(s, p) {
    const n = NODE[p.node];
    switch (n.type) {
      case 'exp': {
        const group = deckOf(n) === 'kid' ? 'kid' : 'youth';
        const texts = D.EXP_TEXT[group][n.apt];
        const text = texts[Math.floor(rand(s) * texts.length)];
        const g = addApt(p, n.apt);
        msg(s, { k: 'apt', a: n.apt, n: g, text });
        log(s, p.id, `${text}（${aptName(n.apt)} +${g}）`);
        next(s);
        break;
      }
      case 'event': drawEvent(s, p, n); break;
      case 'friend':
        if (others(s, p).length) s.step = { kind: 'friend', apt: n.apt };
        else {
          const g = addApt(p, n.apt);
          msg(s, { k: 'apt', a: n.apt, n: g, text: '新しいことに挑戦した' });
          next(s);
        }
        break;
      case 'grow': growOrPick(s, p, 'grow'); break;
      case 'change':
        s.step = { kind: 'job', reason: 'change', keep: p.job != null };
        break;
      case 'mini': startMini(s, p); break;
      case 'pay':
        if (D.EXACT_PAY_BONUS && p.job != null && (s.last.paidNow || []).includes(n.id)) {
          const g = D.STAR_PAY[stars(p.apt, p.job) - 1];
          p.pts.pay += g;
          msg(s, { k: 'payExact', n: g, job: p.job });
          log(s, p.id, `しごとマスにぴったり（+${g}）`);
        }
        next(s);
        break;
      default: next(s); // start（しごとマスのポイントは通ったときに加えている）
    }
  }

  function growOrPick(s, p, source) {
    if (p.job == null) {
      s.step = { kind: 'pick', opts: randomApts(s, 3), reason: source };
      return;
    }
    const job = D.JOBS[p.job];
    const target = job.apts.filter((a) => p.apt[a] < D.APT_CAP).sort((a, b) => p.apt[a] - p.apt[b])[0];
    if (target == null) {
      p.pts.event += 1;
      msg(s, { k: 'pts', n: 1, text: D.GROW_TEXT[Math.floor(rand(s) * D.GROW_TEXT.length)] });
    } else {
      const g = addApt(p, target);
      const text = D.GROW_TEXT[Math.floor(rand(s) * D.GROW_TEXT.length)];
      msg(s, { k: 'apt', a: target, n: g, text });
      log(s, p.id, `${text}（${aptName(target)} +${g}）`);
    }
    next(s);
  }

  // ミニゲーム: 3つを順番に（山札のように）出す。1人のときは合計ピッタリを出さない（相手がいないと成り立たない）
  function startMini(s, p) {
    if (!s.miniDeck || !s.miniDeck.length) {
      const pool = Object.keys(D.MINI_GAMES).filter((g) => g !== 'sum' || s.players.length > 1);
      s.miniDeck = shuffle(s, pool);
    }
    const game = s.miniDeck.shift();
    const st = { kind: 'mini', game, by: p.id };
    if (game === 'hilo') st.base = 2 + Math.floor(rand(s) * 4); // 2〜5（1や6だと予想が決まってしまう）
    if (game === 'sum') {
      const n = s.players.length; // 合計は n〜3n。いちばん端（全員1・全員3）は目標にしない
      st.target = n + 1 + Math.floor(rand(s) * (2 * n - 1));
    }
    log(s, p.id, `ミニゲーム「${D.MINI_GAMES[game].name}」`);
    s.step = st;
  }

  function randomApts(s, n) {
    return shuffle(s, [0, 1, 2, 3, 4, 5]).slice(0, n).sort((a, b) => a - b);
  }

  function drawEvent(s, p, node) {
    const deck = deckOf(node);
    if (!s.decks[deck].length) s.decks[deck] = shuffle(s, D.DECKS[deck].map((_, i) => i));
    const i = s.decks[deck].shift();
    const card = D.DECKS[deck][i];
    s.last.card = { deck, i };
    log(s, p.id, `イベント「${card.text}」`);
    const e = card.e;
    switch (e.t) {
      case 'apt': {
        const g = addApt(p, e.a);
        msg(s, { k: 'apt', a: e.a, n: g });
        next(s);
        break;
      }
      case 'pts':
        p.pts.event += e.n;
        msg(s, { k: 'pts', n: e.n });
        next(s);
        break;
      case 'skip':
        p.skip = 1;
        msg(s, { k: 'skip' });
        log(s, p.id, '1回休み');
        next(s);
        break;
      case 'again':
        s.again = true;
        msg(s, { k: 'again' });
        next(s);
        break;
      case 'move':
        s.last.moveFrom = s.last.path.length;
        if (e.n > 0) {
          msg(s, { k: 'move', n: e.n });
          runMove(s, p, e.n, 'event', null);
        } else {
          const m = moveBack(s, p, -e.n);
          msg(s, { k: 'move', n: -m, blocked: m < -e.n });
          next(s);
        }
        break;
      case 'pick': s.step = { kind: 'pick', opts: randomApts(s, 3), reason: 'event' }; break;
      case 'grow': growOrPick(s, p, 'event'); break;
      case 'coop': s.step = { kind: 'coop', reward: e.reward, target: coopTarget(s) }; break;
      case 'vote': s.step = { kind: 'vote', opts: e.opts }; break;
      default: next(s);
    }
  }
  const coopTarget = (s) => Math.floor(3.5 * s.players.length);

  // 節目に着いた。学びの道から来たら好きな適性を選ぶ → 道を選ぶ（15・18さい）／職業を選ぶ（22さい）
  function arriveStop(s, p) {
    const id = p.node;
    msg(s, { k: 'stop', age: NODE[id].age });
    log(s, p.id, `${NODE[id].age}さいの節目に着いた`);
    const q = [];
    const fromStudy = (id === 'stop18' && D.LANES[p.lanes.c] && D.LANES[p.lanes.c].kind === 'study')
      || (id === 'stop22' && D.LANES[p.lanes.d] && D.LANES[p.lanes.d].kind === 'study');
    const bonus = fromStudy ? D.STUDY_BONUS[id] : null;
    if (bonus && bonus.pts) {
      p.pts.event += bonus.pts;
      msg(s, { k: 'pts', n: bonus.pts, reason: 'study' });
    }
    for (let i = 0; i < (bonus ? bonus.picks : 0); i++) q.push({ kind: 'pick', opts: [0, 1, 2, 3, 4, 5], reason: 'study', i, of: bonus.picks });
    if (id === 'stop22') q.push({ kind: 'job', reason: 'adult', keep: p.job != null });
    else q.push({ kind: 'route', node: id });
    s.queue = q.concat(s.queue);
    next(s);
  }

  function finishPlayer(s, p) {
    p.done = true;
    s.finished++;
    p.rank = s.finished;
    const b = D.GOAL_BONUS[Math.min(p.rank, D.GOAL_BONUS.length) - 1];
    p.pts.bonus += b;
    s.again = false;
    s.queue = [];
    msg(s, { k: 'goal', rank: p.rank, n: b });
    log(s, p.id, `ゴール（${p.rank}番目・ボーナス +${b}）`);
    s.step = { kind: 'ack' };
  }

  function finishGame(s) {
    // まだゴールしていない人は、ゴールに近い順に続きの順位のボーナスを受け取る。
    // ゴールまでのマス数が同じ人は同じ順位・同じボーナス（参加した順で差をつけない）。次の順位はその人数だけとばす
    const dist = (p) => (DIST[p.node] == null ? 0 : DIST[p.node]);
    const left = s.players.filter((p) => !p.done).sort((a, b) => dist(a) - dist(b) || a.id - b.id);
    for (let i = 0; i < left.length;) {
      const group = left.filter((p) => dist(p) === dist(left[i]));
      const rank = s.finished + 1;
      const bonus = D.GOAL_BONUS[Math.min(rank, D.GOAL_BONUS.length) - 1];
      group.forEach((p) => {
        p.rank = rank;
        p.pts.bonus += bonus;
        p.unfinished = true;
      });
      s.finished += group.length;
      i += group.length;
    }
    const rows = s.players.map((p) => ({ pid: p.id, total: total(p) }))
      .sort((a, b) => b.total - a.total || a.pid - b.pid);
    rows.forEach((r, i) => { r.place = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].place : i + 1; });
    s.results = rows;
    s.phase = 'results';
    s.step = null;
  }

  const total = (p) => p.pts.pay + p.pts.event + p.pts.bonus + (p.pts.mini || 0);

  // ── 操作 ───────────────────────────────────────
  const MINI_PICKS = { hilo: ['hi', 'lo'], janken: ['g', 'c', 'p'], sum: [1, 2, 3] };
  const HANDLERS = {
    roll(s, a) {
      const p = cur(s);
      let cheerBy = null;
      if (a.cheer != null) {
        if (!Number.isInteger(a.cheer)) return 'その人は応援できません';
        const c = s.players[a.cheer];
        if (!c || !c.done || c.id === p.id) return 'その人は応援できません';
        cheerBy = c.id;
      }
      if (s.settings.dice === 2) {
        const dice = [die(s), die(s)];
        newLast(s, { dice, cheer: cheerBy != null ? 1 : 0, cheerBy });
        p.turns++;
        log(s, p.id, `サイコロ ${dice[0]} と ${dice[1]}${cheerBy != null ? `（${s.players[cheerBy].name}さんの応援で +1）` : ''}`);
        s.step = { kind: 'dice', dice };
        return null;
      }
      const d = die(s);
      newLast(s, { roll: d, cheer: cheerBy != null ? 1 : 0, cheerBy });
      p.turns++;
      log(s, p.id, cheerBy != null ? `サイコロ ${d}（${s.players[cheerBy].name}さんの応援で +1）` : `サイコロ ${d}`);
      runMove(s, p, d + s.last.cheer, 'roll', null);
      return null;
    },
    dice(s, a) {
      const p = cur(s);
      if (a.pick !== 0 && a.pick !== 1) return 'どちらかの目を選んでください';
      const v = s.step.dice[a.pick];
      s.last.roll = v;
      s.last.chosen = a.pick;
      log(s, p.id, `${v} で進む`);
      runMove(s, p, v + s.last.cheer, 'roll', null);
      return null;
    },
    fork(s, a) {
      const node = NODE[s.step.node];
      if (a.choice !== 0 && a.choice !== 1) return '道を選んでください';
      const { remaining, mode } = s.step;
      log(s, cur(s).id, `${node.fork[a.choice]}を選んだ`);
      runMove(s, cur(s), remaining, mode, a.choice);
      return null;
    },
    route(s, a) {
      const p = cur(s);
      const opts = D.ROUTES[s.step.node];
      const o = opts && Number.isInteger(a.choice) ? opts[a.choice] : null;
      if (!o) return '道を選んでください';
      const lane = D.LANES[o.lane];
      // 選び直し（reroute）のために、選ぶ前のその人・記録・この先の予定を覚えておく
      s.routeUndo = { node: s.step.node, player: clone(p), msgs: s.last.msgs.length, queue: clone(s.queue) };
      p.routeNext[s.step.node] = o.next;
      p.lanes[s.step.node === 'stop15' ? 'c' : 'd'] = o.lane;
      msg(s, { k: 'route', lane: o.lane });
      log(s, p.id, `${lane.kind === 'study' ? '学び' : 'しごと'}の道へ`);
      if (lane.kind === 'work') s.queue.unshift({ kind: 'job', reason: s.step.node === 'stop15' ? 'work15' : 'work18', keep: p.job != null });
      else if (p.job != null) {
        p.prevJob = p.job;
        p.job = null;
        msg(s, { k: 'setaside', job: p.prevJob });
      }
      next(s);
      return null;
    },
    job(s, a) {
      const p = cur(s);
      if (a.job === 'keep') {
        if (!s.step.keep || p.job == null) return '今の仕事がありません';
        msg(s, { k: 'job', job: p.job, keep: true, stars: stars(p.apt, p.job) });
        log(s, p.id, `${D.JOBS[p.job].name}を続ける`);
      } else {
        const j = Number.isInteger(a.job) ? D.JOBS[a.job] : null;
        if (!j) return '職業を選んでください';
        const changed = p.job != null && p.job !== j.id;
        p.job = j.id;
        msg(s, { k: 'job', job: j.id, changed, stars: stars(p.apt, j.id) });
        log(s, p.id, `${j.name}になった（★${stars(p.apt, j.id)}）`);
      }
      next(s);
      return null;
    },
    friend(s, a) {
      const p = cur(s);
      const f = Number.isInteger(a.pid) ? s.players[a.pid] : null;
      if (!f || f.id === p.id) return 'さそう人を選んでください';
      const apt = s.step.apt;
      const g1 = addApt(p, apt);
      const g2 = addApt(f, apt);
      const rescued = f.skip > 0 && !f.done;
      if (rescued) f.skip = 0;
      msg(s, { k: 'friend', pid: f.id, a: apt, n: g1, n2: g2, rescued });
      const gainText = g1 && g2 ? `${aptName(apt)} 2人とも +1` : (g1 || g2 ? `${aptName(apt)} ${(g1 ? p : f).name}さん +1（${(g1 ? f : p).name}さんはもう上限）` : `${aptName(apt)} は2人とももう上限`);
      log(s, p.id, `${f.name}さんをさそった（${gainText}${rescued ? '・休みがなくなった' : ''}）`);
      next(s);
      return null;
    },
    pick(s, a) {
      const p = cur(s);
      if (!s.step.opts.includes(a.a)) return '適性を選んでください';
      const g = addApt(p, a.a);
      msg(s, { k: 'apt', a: a.a, n: g, reason: s.step.reason });
      log(s, p.id, `${aptName(a.a)} +${g}`);
      next(s);
      return null;
    },
    vote(s, a) {
      if (!Number.isInteger(a.opt)) return '選んでください';
      const o = s.step.opts[a.opt];
      if (!o) return '選んでください';
      const capped = s.players.filter((q) => addApt(q, o.a) === 0).map((q) => q.id);
      msg(s, { k: 'vote', label: o.label, a: o.a, capped });
      log(s, cur(s).id, `みんなで「${o.label}」に決定（全員 ${aptName(o.a)} +1${capped.length ? '・上限の人はそのまま' : ''}）`);
      next(s);
      return null;
    },
    coop(s) {
      const dice = s.players.map(() => die(s));
      const total = dice.reduce((x, y) => x + y, 0);
      const ok = total >= s.step.target;
      const r = s.step.reward;
      const capped = [];
      if (ok) s.players.forEach((q) => { if (r.t === 'apt') { if (addApt(q, r.a) === 0) capped.push(q.id); } else q.pts.event += r.n; });
      msg(s, { k: 'coop', dice, total, target: s.step.target, ok, reward: r, capped });
      log(s, cur(s).id, `みんなでサイコロ 合計${total}（目標${s.step.target}）${ok ? '成功' : 'あと少し'}`);
      next(s);
      return null;
    },
    // picks: { プレイヤーの番号: 選んだもの }。大きい？小さい？・じゃんけんは出さなかった人がいてもよい（今回は参加なし）。
    // 合計ピッタリは全員の数が要る。
    mini(s, a) {
      const st = s.step;
      const picks = a && a.picks && typeof a.picks === 'object' ? a.picks : {};
      const valid = MINI_PICKS[st.game];
      const list = s.players.map((p) => ({ pid: p.id, v: picks[p.id] == null ? null : picks[p.id] }));
      if (list.some((x) => x.v != null && !valid.includes(x.v))) return '選び方がちがいます';
      if (st.game === 'sum' && list.some((x) => x.v == null)) return '全員の数を入れてください';
      const res = { k: 'mini', game: st.game, picks: list.filter((x) => x.v != null) };
      let winners = [];
      if (st.game === 'hilo') {
        const d = die(s);
        res.base = st.base;
        res.roll = d;
        if (d === st.base) {
          res.tie = true;
          winners = s.players.map((p) => p.id);
        } else {
          const ans = d > st.base ? 'hi' : 'lo';
          winners = list.filter((x) => x.v === ans).map((x) => x.pid);
        }
      } else if (st.game === 'janken') {
        const cpu = MINI_PICKS.janken[Math.floor(rand(s) * 3)];
        const beats = { g: 'c', c: 'p', p: 'g' };
        res.cpu = cpu;
        winners = list.filter((x) => x.v && beats[x.v] === cpu).map((x) => x.pid);
        res.draws = list.filter((x) => x.v === cpu).map((x) => x.pid);
      } else {
        res.total = list.reduce((acc, x) => acc + x.v, 0);
        res.target = st.target;
        res.ok = res.total === st.target;
        if (res.ok) winners = s.players.map((p) => p.id);
      }
      winners.forEach((pid) => { s.players[pid].pts.mini += D.MINI_REWARD; });
      res.winners = winners;
      res.n = D.MINI_REWARD;
      msg(s, res);
      log(s, cur(s).id, `ミニゲーム「${D.MINI_GAMES[st.game].name}」: ${winners.length ? winners.map((pid) => s.players[pid].name + 'さん').join('・') + ' +' + D.MINI_REWARD : 'ポイントなし'}`);
      next(s);
      return null;
    },
    // その番のうちなら、節目の道を選び直せる（職業を選ぶ前でも、選んだあとの結果のカードでも）
    reroute(s) {
      const u = s.routeUndo;
      if (!u) return '道を選び直せる場面ではありません';
      if (s.step.kind === 'job' && s.step.reason !== 'work15' && s.step.reason !== 'work18') return '道を選び直せる場面ではありません';
      s.players[s.cur] = u.player;
      s.last.msgs = s.last.msgs.slice(0, u.msgs);
      s.queue = u.queue;
      s.step = { kind: 'route', node: u.node };
      s.routeUndo = null;
      log(s, cur(s).id, '道を選び直す');
      return null;
    },
    ack(s) {
      const p = cur(s);
      s.routeUndo = null;
      if (s.step.kind === 'skip') {
        p.skip = 0;
        log(s, p.id, '1回休み（この番はお休み）');
        advance(s);
        return null;
      }
      if (s.again && !p.done) {
        s.again = false;
        startTurn(s);
        return null;
      }
      s.again = false;
      advance(s);
      return null;
    },
  };
  const ACCEPTS = { roll: 'roll', dice: 'dice', fork: 'fork', route: 'route', job: 'job', friend: 'friend', pick: 'pick', vote: 'vote', coop: 'coop', mini: 'mini', reroute: ['job', 'ack'], ack: ['ack', 'skip'] };

  function apply(state, action) {
    if (!state || !action || typeof action.type !== 'string') return { ok: false, error: '操作がありません' };
    const s = clone(state);
    if (action.type === 'end') { // 進行役がここで終える
      if (s.phase !== 'play') return { ok: false, error: 'すでに終わっています' };
      finishGame(s);
      return { ok: true, state: s };
    }
    if (action.type === 'labels') {
      s.settings.labels = action.labels === 'age' ? 'age' : 'school';
      return { ok: true, state: s };
    }
    if (s.phase !== 'play' || !s.step) return { ok: false, error: 'いまは操作できません' };
    const h = HANDLERS[action.type];
    const want = ACCEPTS[action.type];
    if (!h || !(Array.isArray(want) ? want.includes(s.step.kind) : want === s.step.kind)) return { ok: false, error: 'いまはその操作はできません' };
    let err;
    try {
      err = h(s, action);
    } catch (e) {
      return { ok: false, error: '操作を受け付けられませんでした' }; // 想定外の値でも例外で止めない（通信対応に備える）
    }
    if (err) return { ok: false, error: err };
    return { ok: true, state: s };
  }

  const api = { newGame, apply, previewMove, stars, jobSum, jobOptions, coopTarget, total, NODE, DIST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CS_ENGINE = api;
})(typeof window !== 'undefined' ? window : globalThis);
