/* ============================================================
 * キャリアすごろく — ゲームエンジン
 *
 * 画面・通信から独立した純粋な状態遷移。apply(game, action, ctx) は
 * 入力を変更せず、新しい game か拒否理由を返す。乱数は ctx.seed から作るので、
 * Realtime Database の transaction が再実行されても同じ結果になる。
 *
 * 試遊で見直す可能性のある値（コメントで「仮」と書いたもの）は、差し替えやすいよう定数・関数単位で
 * 分けている。決定の経緯と一覧は AGENTS.md。
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./data.js'));
  else root.CS_ENGINE = factory(root.CS_DATA);
}(typeof self !== 'undefined' ? self : this, function (D) {
  'use strict';

  const CAP = D.APT_CAP;
  const MAX_SCORE = CAP * 4 + 3; // 職業の点の最大: 中心×2＋関連2種類＋3種類そろい
  const NAPT = D.APTS.length;
  const MAX_PLAYERS = 8;
  const LOG_MAX = 60;
  const INVITE_MS = 10000; // コラボの招待返答（設計メモの10秒）
  const EXT_MS = 15000; // 「もう少し考える」の延長（1手番1回）
  const TIMEOUT_TOLERANCE_MS = 1000; // 端末間の時計ずれの許容

  const PHASE = { LOBBY: 'lobby', SETUP: 'setup', MAIN: 'main', FINAL: 'final', RESULTS: 'results' };
  // 終盤: present = 仕上げのサイコロ（0〜3点）。none = 仕上げなし（比較・テスト用）
  const END_RULES = ['present', 'none'];
  const PREP_MAX = 2; // 準備チップは2枚まで（仕上げの出目に1枚＋1）

  // ── 乱数（mulberry32）────────────────────────────────
  function makeRng(seed) {
    let a = (Number(seed) >>> 0) || 0x9e3779b9;
    const next = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      int: (n) => Math.floor(next() * n),
      die: () => 1 + Math.floor(next() * 6),
      pick: (arr) => arr[Math.floor(next() * arr.length)],
      shuffle: (arr) => {
        const b = arr.slice();
        for (let i = b.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          [b[i], b[j]] = [b[j], b[i]];
        }
        return b;
      },
    };
  }

  // ── 小さな道具 ──────────────────────────────────────
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const toArr = (v) => {
    if (Array.isArray(v)) return v.filter((x) => x !== undefined && x !== null);
    if (v && typeof v === 'object') {
      return Object.keys(v).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => v[k]).filter((x) => x !== null && x !== undefined);
    }
    return [];
  };
  const toObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  const str = (v, d) => (typeof v === 'string' ? v : d);
  const bool = (v) => v === true;
  const jobById = (id) => D.JOBS[id];
  const nodeById = (id) => D.NODES[id];
  const range = (n) => Array.from({ length: n }, (_, i) => i);

  // ── 得点 ───────────────────────────────────────────
  // 2 × 中心の枚数 ＋ 関連Aの枚数 ＋ 関連Bの枚数 ＋ 3種類そろえば3点（最大 MAX_SCORE。上限4枚なら19点）
  function score(apt, jobId) {
    const job = jobById(jobId);
    if (!job) return null;
    const a = toArr(apt);
    const core = num(a[job.core], 0);
    const r0 = num(a[job.rel[0]], 0);
    const r1 = num(a[job.rel[1]], 0);
    const bonus = core > 0 && r0 > 0 && r1 > 0 ? 3 : 0;
    return { job: jobId, core, r0, r1, bonus, total: core * 2 + r0 + r1 + bonus };
  }

  // ガイド用: その適性が職業の中心（×2）か関連（×1）か
  function aptRole(jobId, a) {
    const job = jobById(jobId);
    if (!job) return '';
    if (job.core === a) return 'core';
    return job.rel.includes(a) ? 'rel' : '';
  }
  // ガイド用: 適性 a が n 枚ふえたとき（上限まで）、その職業の点がいくつふえるか
  function gainDelta(apt, jobId, a, n) {
    const base = score(apt, jobId);
    if (!base) return 0;
    const next = toArr(apt).slice();
    next[a] = Math.min(CAP, num(next[a], 0) + (n || 1));
    return score(next, jobId).total - base.total;
  }

  // 仕上げのサイコロ: 出目＋準備チップの合計で 0〜3点を加える。
  // 最大でも3点なので、3点以上の差は逆転できない（同点まで）。2点差までは運で入れ替わりうる。
  function presentBonus(total) {
    if (total >= 7) return 3;
    if (total >= 5) return 2;
    if (total >= 3) return 1;
    return 0;
  }

  // ── 設定 ───────────────────────────────────────────
  function recommendedChips(nPlayers) {
    return D.CHIPS_BY_PLAYERS[Math.min(MAX_PLAYERS, Math.max(1, nPlayers))] || 6;
  }
  // 仮: 時間チップ6枚以上なら進路2回、5枚以下なら1回（短い回で自由な手番を残すため）
  function recommendedCareer(chips) {
    return chips >= 6 ? 2 : 1;
  }
  // 仮: 最初の進路は2周目、次の進路は残りのまん中。サイコロを振ってから進路を選ぶ順にする。
  function careerRounds(chips, count) {
    const out = {};
    if (count >= 1 && chips >= 2) out[2] = 'early';
    if (count >= 2 && chips >= 4) {
      const mid = Math.min(chips, Math.max(4, 2 + Math.ceil((chips - 2) / 2)));
      out[mid] = 'mid';
    }
    return out;
  }
  // 目安の所要時間（分）。設計メモの「19分＋総手番×0.75分」を、進路のラウンドを
  // 同時進行（1ラウンド1.5分）とみなして組み替えた計算値。実測ではない。
  function estimateMinutes(settings, nPlayers) {
    const chips = num(settings.chips, 6);
    const career = Object.keys(careerRounds(chips, num(settings.career, 0))).length;
    const normal = Math.max(0, chips - career) * nPlayers;
    return Math.round(17 + normal * 0.75 + career * 1.5); // 17分＝説明・準備・終盤などの固定分（ふりかえりなし）
  }

  function defaultSettings(nPlayers) {
    const chips = recommendedChips(nPlayers);
    return { chips, chipsAuto: true, timerSec: 0, life: true, career: recommendedCareer(chips), careerAuto: true, endRule: 'present' };
  }

  // ── ゲームの生成・正規化 ─────────────────────────────
  function newGame(opts) {
    const now = num(opts.now, 0);
    const g = {
      v: 1,
      phase: PHASE.LOBBY,
      seq: 0,
      host: { id: opts.hostId, name: opts.hostName, plays: opts.hostPlays !== false },
      settings: defaultSettings(1),
      players: {},
      order: [],
      round: 0,
      ptr: -1,
      turn: null,
      turnNo: 0,
      career: null,
      plan: {},
      lastLap: null,
      hold: '',
      paused: false,
      final: null,
      results: null,
      log: [],
      metrics: { created: now, setup: 0, main: 0, final: 0, results: 0, turns: [] },
      nextSeat: 0,
    };
    if (g.host.plays) addPlayer(g, opts.hostId, opts.hostName, 'self', true);
    return g;
  }

  function blankPlayer(id, name, seat, ctrl, isHost) {
    return {
      id, name, seat, color: seat % D.PLAYER_COLORS.length, ctrl, isHost: !!isHost,
      status: 'active', chips: 0, pos: D.START_NODE,
      apt: range(NAPT).map(() => 0), jobs: [], ideal: -1, goal: -1,
      setup: { step: 'ideal', dealt: [], cands: [], goalPending: false, undecided: false },
      life: { used: false, apt: -1, left: 0, scene: -1 },
      prep: 0,
      fin: null,
    };
  }

  function addPlayer(g, id, name, ctrl, isHost) {
    g.players[id] = blankPlayer(id, name, g.nextSeat, ctrl, isHost);
    g.nextSeat += 1;
  }

  function normPlayer(p, id) {
    p = toObj(p);
    const n = blankPlayer(str(p.id, id), str(p.name, '？'), num(p.seat, 0), p.ctrl === 'host' ? 'host' : 'self', bool(p.isHost));
    n.color = num(p.color, n.color);
    n.status = ['active', 'resting', 'left'].includes(p.status) ? p.status : 'active';
    n.chips = num(p.chips, 0);
    n.pos = num(p.pos, D.START_NODE);
    const apt = toArr(p.apt);
    n.apt = range(NAPT).map((i) => Math.max(0, Math.min(CAP, num(apt[i], 0))));
    n.jobs = toArr(p.jobs).map((x) => num(x, -1)).filter((x) => x >= 0);
    n.ideal = num(p.ideal, -1);
    n.goal = num(p.goal, -1);
    const s = toObj(p.setup);
    n.setup = {
      step: ['ideal', 'deal', 'goal', 'done'].includes(s.step) ? s.step : 'ideal',
      dealt: toArr(s.dealt).map((x) => num(x, 0)),
      cands: toArr(s.cands).map((x) => num(x, 0)),
      goalPending: bool(s.goalPending),
      undecided: bool(s.undecided),
    };
    const l = toObj(p.life);
    n.life = { used: bool(l.used), apt: num(l.apt, -1), left: num(l.left, 0), scene: num(l.scene, -1) };
    n.prep = Math.max(0, Math.min(PREP_MAX, num(p.prep, 0)));
    if (p.fin && typeof p.fin === 'object') {
      const f = p.fin;
      n.fin = {
        step: ['choose', 'present', 'done'].includes(f.step) ? f.step : 'choose',
        job: num(f.job, -1),
        base: num(f.base, 0),
        roll: normRoll(f.roll),
        final: num(f.final, 0),
      };
    }
    return n;
  }

  function normRoll(r) {
    if (!r || typeof r !== 'object') return null;
    return { die: num(r.die, 0), used: num(r.used, 0), total: num(r.total, 0), bonus: num(r.bonus, 0) };
  }

  function normChallenge(c) {
    if (!c || typeof c !== 'object') return null;
    const st = {};
    Object.entries(toObj(c.st)).forEach(([pid, s]) => {
      s = toObj(s);
      st[pid] = {
        pick: num(s.pick, -1), die: num(s.die, 0), bonus: num(s.bonus, 0), life: num(s.life, 0), total: num(s.total, 0),
        tier: str(s.tier, ''), rw: toArr(s.rw).map((x) => num(x, 0)), got: toArr(s.got).map((g) => toArr(g).map((x) => num(x, 0))),
        done: bool(s.done), note: str(s.note, ''), refunded: bool(s.refunded),
      };
    });
    return {
      kind: c.kind === 'collab' ? 'collab' : 'event', scene: num(c.scene, 0), solo: bool(c.solo), fictional: bool(c.fictional),
      members: toArr(c.members).map(String), st, note: str(c.note, ''),
    };
  }

  function normTurn(t) {
    if (!t || typeof t !== 'object') return null;
    const sq = t.sq && typeof t.sq === 'object' ? {
      node: num(t.sq.node, 0), type: str(t.sq.type, 'new'), eff: str(t.sq.eff, 'new'), note: str(t.sq.note, ''),
      opts: toArr(t.sq.opts).map((x) => num(x, 0)), scene: num(t.sq.scene, -1),
    } : null;
    const fork = t.fork && typeof t.fork === 'object' ? { node: num(t.fork.node, 0), left: num(t.fork.left, 0) } : null;
    const inv = t.inv && typeof t.inv === 'object' ? { pid: str(t.inv.pid, ''), until: num(t.inv.until, 0), status: str(t.inv.status, 'pending'), pausedAt: num(t.inv.pausedAt, 0) } : null;
    const tm = toObj(t.timer);
    return {
      id: num(t.id, 0), pid: str(t.pid, ''), round: num(t.round, 0), stage: str(t.stage, 'roll'), startedAt: num(t.startedAt, 0),
      die: num(t.die, 0), path: toArr(t.path).map((x) => num(x, 0)), logged: num(t.logged, 0), fork, sq, ch: normChallenge(t.ch), inv,
      res: toArr(t.res).map(toObj),
      timer: { used: num(tm.used, 0), since: tm.since == null ? null : num(tm.since, null), ext: bool(tm.ext) },
      dec: num(t.dec, 0),
    };
  }

  function normCareer(c) {
    if (!c || typeof c !== 'object') return null;
    const st = {};
    Object.entries(toObj(c.st)).forEach(([pid, s]) => {
      s = toObj(s);
      st[pid] = { route: str(s.route, ''), act: num(s.act, -1), apt: num(s.apt, -1), done: bool(s.done), skipped: bool(s.skipped), passed: bool(s.passed), away: bool(s.away) };
    });
    return { stage: c.stage === 'mid' ? 'mid' : 'early', round: num(c.round, 0), startedAt: num(c.startedAt, 0), until: num(c.until, 0), pausedAt: num(c.pausedAt, 0), st };
  }

  function normalize(raw) {
    const r = toObj(raw);
    const g = newGame({ hostId: str(toObj(r.host).id, ''), hostName: str(toObj(r.host).name, ''), hostPlays: false, now: 0 });
    g.v = num(r.v, 1);
    g.phase = Object.values(PHASE).includes(r.phase) ? r.phase : PHASE.LOBBY;
    g.seq = num(r.seq, 0);
    g.host.plays = bool(toObj(r.host).plays);
    const s = toObj(r.settings);
    const ds = defaultSettings(1);
    g.settings = {
      chips: D.CHIP_OPTIONS.includes(num(s.chips, 0)) ? num(s.chips, 0) : ds.chips,
      chipsAuto: s.chipsAuto !== false,
      timerSec: D.TIMER_OPTIONS.includes(num(s.timerSec, -1)) ? num(s.timerSec, 0) : 0,
      life: s.life !== false,
      career: [0, 1, 2].includes(num(s.career, -1)) ? num(s.career, 0) : ds.career,
      careerAuto: s.careerAuto !== false,
      endRule: END_RULES.includes(s.endRule) ? s.endRule : 'present',
    };
    g.players = {};
    Object.entries(toObj(r.players)).forEach(([id, p]) => { g.players[id] = normPlayer(p, id); });
    g.order = toArr(r.order).map(String).filter((id) => g.players[id]);
    g.round = num(r.round, 0);
    g.ptr = num(r.ptr, -1);
    g.turn = normTurn(r.turn);
    g.turnNo = num(r.turnNo, 0);
    g.career = normCareer(r.career);
    g.plan = {};
    Object.entries(toObj(r.plan)).forEach(([k, v]) => { if (v === 'early' || v === 'mid') g.plan[k] = v; });
    g.lastLap = r.lastLap == null ? null : toArr(r.lastLap).map(String);
    if (r.lastLapOn && !g.lastLap) g.lastLap = [];
    g.hold = str(r.hold, '');
    g.paused = bool(r.paused);
    g.final = r.final && typeof r.final === 'object' ? { startedAt: num(r.final.startedAt, 0), rule: END_RULES.includes(r.final.rule) ? r.final.rule : 'none' } : null;
    if (r.results && typeof r.results === 'object') {
      g.results = {
        at: num(r.results.at, 0),
        rows: toArr(r.results.rows).map((x) => {
          x = toObj(x);
          return { pid: str(x.pid, ''), job: num(x.job, -1), base: num(x.base, 0), final: num(x.final, 0), rank: num(x.rank, 0), roll: normRoll(x.roll) };
        }),
        none: toArr(r.results.none).map(String),
        ranked: bool(r.results.ranked),
      };
    }
    g.log = toArr(r.log).map(toObj);
    const m = toObj(r.metrics);
    g.metrics = {
      created: num(m.created, 0), setup: num(m.setup, 0), main: num(m.main, 0), final: num(m.final, 0), results: num(m.results, 0),
      turns: toArr(m.turns).map((row) => toArr(row).map((x) => num(x, 0))),
    };
    g.nextSeat = num(r.nextSeat, Object.keys(g.players).length);
    return g;
  }

  // RTDB に書く形。lastLap の空配列は消えるので、フラグで残す。
  function serialize(g) {
    const out = clone(g);
    out.lastLapOn = g.lastLap !== null;
    return out;
  }

  // ── 参照系 ─────────────────────────────────────────
  const playersInSeat = (g) => Object.values(g.players).sort((a, b) => a.seat - b.seat);
  const playerCount = (g) => Object.keys(g.players).length;
  const isSoloGame = (g) => g.order.length <= 1;
  const heldAll = (p) => p.jobs.length >= D.JOBS.length;
  const below = (p, a) => p.apt[a] < CAP;
  const aptTotal = (p) => p.apt.reduce((s, x) => s + x, 0);

  function currentPid(g) {
    return g.turn ? g.turn.pid : '';
  }

  function canActFor(g, by, pid) {
    if (!by) return false;
    if (by === g.host.id) return true;
    return by === pid;
  }

  function isHostActor(g, by) {
    return !!by && by === g.host.id;
  }

  // コラボに誘える人: 手番の人以外で、参加中・時間チップあり・役割の候補がある
  function eligiblePartners(g, sceneId) {
    if (!g.turn) return [];
    const scene = D.COLLABS[sceneId];
    return g.order.filter((pid) => {
      if (pid === g.turn.pid) return false;
      const p = g.players[pid];
      if (!p || p.status !== 'active' || p.chips <= 0) return false;
      if (scene && !scene.opts.some(([, a]) => below(p, a))) return false;
      return true;
    });
  }

  // いまその人が決める場面の目印。おまかせ等は画面で見た目印と一致するときだけ受け付ける（連打・二重送信対策）
  function decisionKey(g, pid) {
    const p = g.players[pid];
    if (!p) return '';
    if (g.phase === PHASE.SETUP) return `setup:${p.setup.step}`;
    if (g.phase === PHASE.MAIN) {
      if (g.career) {
        const s = g.career.st[pid];
        return s ? `career:${g.career.round}:${s.done ? 'done' : s.route || 'route'}` : '';
      }
      const t = g.turn;
      if (!t) return '';
      if (t.ch && t.ch.st[pid]) {
        const s = t.ch.st[pid];
        return `ch:${t.id}:${pid}:${s.done ? 'done' : s.tier === 'mid' ? 'reward' : s.die ? 'rolled' : s.pick}`;
      }
      return `turn:${t.id}:${t.stage}`;
    }
    if (g.phase === PHASE.FINAL && p.fin) return `final:${p.fin.step}`;
    return '';
  }
  // 時間切れを送れるのはホストかプレイヤー（見学の人は送らない）
  const isParticipant = (g, by) => isHostActor(g, by) || !!g.players[by];

  // ── ログ ───────────────────────────────────────────
  function log(g, entry) {
    g.log.push({ s: g.seq, ...entry });
    if (g.log.length > LOG_MAX) g.log.splice(0, g.log.length - LOG_MAX);
  }

  function gain(g, p, a, n, res, why) {
    const before = p.apt[a];
    const add = Math.max(0, Math.min(n, CAP - before));
    if (add <= 0) return 0;
    p.apt[a] += add;
    const entry = { k: 'gain', p: p.id, a, n: add, disc: before === 0 ? 1 : 0, why: why || '' };
    log(g, entry);
    if (res) res.push({ k: 'gain', p: p.id, a, n: add, disc: before === 0 ? 1 : 0 });
    return add;
  }

  // ── タイマー（1手番の選択時間の合計。読み上げ待ちや相手待ちでは止める）──
  function turnNeedsCurrent(g) {
    const t = g.turn;
    if (!t) return false;
    if (t.stage === 'invite') return false;
    if (t.stage === 'challenge') {
      const s = t.ch && t.ch.st[t.pid];
      return !!s && !s.done;
    }
    return true;
  }

  function syncTimer(g, now) {
    const t = g.turn;
    if (!t) return;
    if (t.timer.since != null) {
      t.timer.used += Math.max(0, now - t.timer.since);
      t.timer.since = null;
    }
    if (g.settings.timerSec > 0 && !g.paused && !g.hold && turnNeedsCurrent(g)) t.timer.since = now;
  }

  function timerRemaining(g, now) {
    const t = g.turn;
    if (!t || g.settings.timerSec <= 0) return null;
    const budget = g.settings.timerSec * 1000 + (t.timer.ext ? EXT_MS : 0);
    const running = t.timer.since != null ? Math.max(0, now - t.timer.since) : 0;
    return budget - t.timer.used - running;
  }

  // ── 本編の進行 ──────────────────────────────────────
  function startMain(g, now, rng) {
    g.phase = PHASE.MAIN;
    g.metrics.main = now;
    g.round = 0;
    g.ptr = g.order.length - 1;
    log(g, { k: 'main' });
    advance(g, now, rng);
  }

  function anyTurnsLeft(g) {
    return g.order.some((pid) => {
      const p = g.players[pid];
      return p && p.status !== 'left' && p.chips > 0;
    });
  }

  function anyActiveWithChips(g) {
    return g.order.some((pid) => {
      const p = g.players[pid];
      return p && p.status === 'active' && p.chips > 0;
    });
  }

  // 次の手番（または進路のラウンド・終盤）へ進める
  function advance(g, now, rng) {
    g.turn = null;
    for (let guard = 0; guard < 1000; guard++) {
      if (g.lastLap !== null) {
        // 宣言後にチップを使い切った人・終えた人は最後の1周から外す
        g.lastLap = g.lastLap.filter((pid) => {
          const lp = g.players[pid];
          return lp && lp.status !== 'left' && lp.chips > 0;
        });
        if (g.lastLap.length === 0) { enterFinal(g, now, rng, 'lap'); return; }
      }
      if (!anyTurnsLeft(g)) { enterFinal(g, now, rng, 'chips'); return; }
      // 全員が休憩中なら、時間チップを減らし続けずに止める（ホストが再開か終了を選ぶ）
      if (!anyActiveWithChips(g)) { g.hold = 'allResting'; log(g, { k: 'hold' }); return; }
      g.hold = '';

      let ptr = g.ptr + 1;
      if (ptr >= g.order.length) {
        g.round += 1;
        g.ptr = g.order.length - 1;
        log(g, { k: 'round', n: g.round });
        const stage = g.plan[g.round];
        if (stage && g.lastLap === null) {
          if (startCareer(g, stage, now)) return;
        }
        ptr = 0;
      }
      g.ptr = ptr;
      const pid = g.order[ptr];
      const p = g.players[pid];
      if (!p || p.status === 'left' || p.chips <= 0) continue;
      if (g.lastLap !== null) {
        const idx = g.lastLap.indexOf(pid);
        if (idx < 0) continue;
        g.lastLap.splice(idx, 1);
      }
      p.chips -= 1; // 手番の開始時に1枚（スキップ・時間切れでも二重に減らさない）
      if (p.status === 'resting') {
        log(g, { k: 'skip', p: pid, why: 'rest' });
        g.metrics.turns.push([p.seat, 1, now, now, 0]);
        continue;
      }
      g.turnNo += 1;
      g.turn = {
        id: g.turnNo, pid, round: g.round, stage: 'roll', startedAt: now,
        die: 0, path: [], logged: 0, fork: null, sq: null, ch: null, inv: null, res: [],
        timer: { used: 0, since: null, ext: false }, dec: 0,
      };
      log(g, { k: 'turn', p: pid, t: g.turnNo });
      syncTimer(g, now);
      return;
    }
    // ここに来るのは想定外（進行が止まらないよう終盤へ移る）
    log(g, { k: 'guard' });
    enterFinal(g, now, rng, 'guard');
  }

  function finishTurn(g, now, rng, why) {
    const t = g.turn;
    if (!t) return;
    syncTimer(g, now);
    const p = g.players[t.pid];
    // 未実行のコラボ相手の分は取り消し、まだサイコロを振っていなければ時間チップを戻す
    if (t.stage === 'invite' && t.inv && t.inv.status === 'pending') {
      t.inv.status = 'cancelled';
    }
    if (t.ch) {
      t.ch.members.forEach((mid) => {
        const s = t.ch.st[mid];
        missIfUnpicked(g, mid, s);
        if (mid === t.pid) return;
        if (s && !s.done) {
          if (s.die === 0 && !s.refunded) {
            const mp = g.players[mid];
            if (mp) { mp.chips += 1; s.refunded = true; log(g, { k: 'refund', p: mid }); }
          }
          s.done = true;
          s.note = 'cancel';
        }
      });
    }
    if (why && why !== 'end') log(g, { k: 'skip', p: t.pid, why });
    g.metrics.turns.push([p ? p.seat : -1, 0, t.startedAt, now, t.dec]);
    g.turn = null;
    advance(g, now, rng);
  }

  // ── 進路のラウンド（全員が同時に選ぶ。時間チップ1枚・移動なし）──────
  function startCareer(g, stage, now) {
    const st = {};
    let participants = 0;
    let active = 0;
    g.order.forEach((pid) => {
      const p = g.players[pid];
      if (!p || p.status === 'left' || p.chips <= 0) return;
      participants += 1;
      if (p.status === 'active') active += 1;
    });
    if (participants === 0) return false;
    if (active === 0) return false; // 全員休憩中は通常の保留処理に任せる
    g.order.forEach((pid) => {
      const p = g.players[pid];
      if (!p || p.status === 'left' || p.chips <= 0) return;
      p.chips -= 1;
      // 休憩中の人も、この周の参加者（時間チップ1枚）。待たずに進むが、終わる前に戻れば選べる（仮）
      st[pid] = { route: '', act: -1, apt: -1, done: false, skipped: false, passed: false, away: p.status === 'resting' };
    });
    const until = g.settings.timerSec > 0 ? now + g.settings.timerSec * 1000 + EXT_MS : 0;
    g.career = { stage, round: g.round, startedAt: now, until, pausedAt: g.paused ? now : 0, st };
    log(g, { k: 'career', stage });
    return true;
  }

  function careerRoute(stage, routeId) {
    const c = D.CAREERS[stage];
    if (!c) return null;
    if (routeId === c.common.id) return c.common;
    return c.routes.find((r) => r.id === routeId) || null;
  }

  function maybeEndCareer(g, now, rng) {
    const c = g.career;
    if (!c) return;
    const pending = Object.entries(c.st).some(([pid, s]) => !s.done && g.players[pid] && g.players[pid].status === 'active');
    if (pending) return;
    Object.entries(c.st).forEach(([pid, s]) => {
      if (!s.done) { s.done = true; s.skipped = true; log(g, { k: 'skip', p: pid, why: 'rest' }); }
    });
    g.metrics.turns.push([-1, 2, c.startedAt, now, Object.keys(c.st).length]);
    log(g, { k: 'careerEnd', stage: c.stage });
    g.career = null;
    g.ptr = g.order.length - 1; // このラウンドは進路で使った
    advance(g, now, rng);
  }

  // ── マスの準備（止まったマスの効果を決める。選べない手番を作らない）────
  function prepareSquare(g, p, node, rng) {
    const n = nodeById(node);
    const t = g.turn;
    let eff = n.type === 'start' ? 'new' : n.type;
    let note = '';
    if (eff === 'life' && (!g.settings.life || p.life.used)) {
      note = !g.settings.life ? 'lifeOff' : 'lifeUsed';
      eff = 'new';
    }
    if (eff === 'grow' && !range(NAPT).some((a) => p.apt[a] > 0 && below(p, a))) {
      note = note || 'growNone';
      eff = 'new';
    }
    if ((eff === 'event' || eff === 'collab') && !range(NAPT).some((a) => below(p, a))) {
      note = note || 'full';
      eff = 'job';
    }
    if (eff === 'new' && !range(NAPT).some((a) => below(p, a))) {
      note = note || 'full';
      eff = 'job';
    }
    if (eff === 'job' && heldAll(p)) {
      note = note || 'jobsAll';
      eff = range(NAPT).some((a) => below(p, a)) ? 'new' : 'none';
    }

    let opts = [];
    let scene = -1;
    if (eff === 'grow') {
      opts = range(NAPT).filter((a) => p.apt[a] > 0 && below(p, a));
    } else if (eff === 'new') {
      opts = newExperienceOptions(p, rng);
    } else if (eff === 'job') {
      opts = rng.shuffle(D.JOBS.map((j) => j.id).filter((id) => !p.jobs.includes(id))).slice(0, 3);
    } else if (eff === 'life') {
      opts = lifePlanOptions(rng);
    } else if (eff === 'event') {
      const ok = (e) => e.opts.some(([, a]) => below(p, a));
      const local = D.EVENTS.filter((e) => e.d === n.d && ok(e));
      const all = D.EVENTS.filter(ok);
      scene = rng.pick(local.length ? local : all).id;
    } else if (eff === 'collab') {
      const usable = D.COLLABS.filter((c) => c.opts.some(([, a]) => below(p, a)));
      scene = rng.pick(usable.length ? usable : D.COLLABS).id;
    }
    t.sq = { node, type: n.type, eff, note, opts, scene };

    if (eff === 'grow' || eff === 'new' || eff === 'job' || eff === 'life') {
      t.stage = 'act';
    } else if (eff === 'event') {
      t.ch = newChallenge('event', scene, [p.id]);
      t.stage = 'challenge';
    } else if (eff === 'collab') {
      if (isSoloGame(g)) {
        t.ch = newChallenge('collab', scene, [p.id]);
        t.ch.fictional = true;
        t.stage = 'challenge';
      } else if (eligiblePartners(g, scene).length === 0) {
        t.ch = newChallenge('collab', scene, [p.id]);
        t.ch.solo = true;
        t.ch.note = 'noPartner';
        t.stage = 'challenge';
      } else {
        t.stage = 'partner';
      }
    } else {
      t.stage = 'result';
      t.res.push({ k: 'none' });
    }
    log(g, { k: 'land', p: p.id, node, eff, note });
  }

  // 新しい体験の候補: 上限未満から3つ。まだ持っていない適性があれば必ず1つ以上入れる
  function newExperienceOptions(p, rng) {
    const pool = rng.shuffle(range(NAPT).filter((a) => below(p, a)));
    let picks = pool.slice(0, 3);
    const unowned = pool.filter((a) => p.apt[a] === 0);
    if (unowned.length && !picks.some((a) => p.apt[a] === 0)) {
      picks[picks.length - 1] = unowned[0];
    }
    return picks.sort((a, b) => a - b);
  }

  // 暮らしのプランの候補: ちがう場面から3つ（適性もなるべくちがうもの）。値は D.LIFE_PLANS の番号。
  // ゲームが結婚・子どもなどを割り当てず、止まった人が選ぶ（選ばないことも選べる）
  function lifePlanOptions(rng) {
    const order = rng.shuffle(range(D.LIFE_PLANS.length));
    const out = [];
    [true, false].forEach((strict) => order.forEach((k) => {
      const pl = D.LIFE_PLANS[k];
      if (out.length >= 3 || out.includes(k) || out.some((j) => D.LIFE_PLANS[j].s === pl.s)) return;
      if (strict && out.some((j) => D.LIFE_PLANS[j].a === pl.a)) return;
      out.push(k);
    }));
    return out;
  }

  function newChallenge(kind, scene, members) {
    const st = {};
    members.forEach((m) => { st[m] = blankMemberState(); });
    return { kind, scene, solo: false, fictional: false, members: members.slice(), st, note: '' };
  }

  function blankMemberState() {
    return { pick: -1, die: 0, bonus: 0, life: 0, total: 0, tier: '', rw: [], got: [], done: false, note: '', refunded: false };
  }

  function sceneOf(ch) {
    return ch.kind === 'collab' ? D.COLLABS[ch.scene] : D.EVENTS[ch.scene];
  }

  // 移動（1マスずつ。分かれ道でまだ進む歩数が残っていれば、そこで止めて選んでもらう）
  function walk(g, p, steps, rng) {
    const t = g.turn;
    let left = steps;
    const logSegment = () => {
      const seg = t.path.slice(t.logged);
      if (seg.length) log(g, { k: 'move', p: p.id, die: t.die, path: seg });
      t.logged = t.path.length;
    };
    while (left > 0) {
      const n = nodeById(p.pos);
      if (n.next.length > 1) {
        t.fork = { node: p.pos, left };
        t.stage = 'fork';
        logSegment();
        return;
      }
      p.pos = n.next[0];
      t.path.push(p.pos);
      left -= 1;
    }
    t.fork = null;
    logSegment();
    prepareSquare(g, p, p.pos, rng);
  }

  function continueFromFork(g, p, branch, rng) {
    const t = g.turn;
    const n = nodeById(t.fork.node);
    const nextNode = n.next[branch];
    const left = t.fork.left;
    log(g, { k: 'fork', p: p.id, node: t.fork.node, b: branch });
    p.pos = nextNode;
    t.path.push(p.pos);
    t.fork = null;
    walk(g, p, left - 1, rng);
  }

  // イベント・コラボの判定（出目＋持っている適性＋暮らしの効果、1〜6に収める）
  function rollChallenge(g, p, s, target, rng, res) {
    const die = rng.die();
    const bonus = p.apt[target] > 0 ? 1 : 0;
    let life = 0;
    if (p.life.left > 0 && p.life.apt >= 0) {
      life = p.life.apt === target ? 1 : -1;
      p.life.left -= 1;
    }
    const total = Math.max(1, Math.min(6, die + bonus + life));
    s.die = die; s.bonus = bonus; s.life = life; s.total = total;
    if (total >= 5) {
      s.tier = 'big';
      const got = gain(g, p, target, 2, res, 'roll');
      s.got = got > 0 ? [[target, got]] : [];
      s.done = true;
    } else if (total >= 3) {
      s.tier = 'mid';
      s.rw = rng.shuffle(range(NAPT).filter((a) => a !== target && below(p, a))).slice(0, 2).sort((a, b) => a - b);
      if (s.rw.length === 0) { s.done = true; s.note = 'noReward'; }
    } else {
      s.tier = 'none';
      s.done = true;
    }
    log(g, { k: 'roll', p: p.id, die, bonus, life, total, tier: s.tier, a: target });
    if (s.done && s.got.length === 0) {
      if (res) res.push({ k: 'nogain', p: p.id });
      addPrep(g, p, 'miss', res); // うまくいかなかった経験も、最後の仕上げの準備になる
    }
  }

  // 準備チップ（2枚まで）: 判定でカードが取れなかったとき・2人でコラボしてサイコロを振ったとき
  function addPrep(g, p, why, res) {
    if (p.prep >= PREP_MAX) return;
    p.prep += 1;
    log(g, { k: 'prep', p: p.id, why });
    if (res) res.push({ k: 'prep', p: p.id, why });
  }
  // 判定3〜4のあと、別の適性を選ぶ前に終わった（スキップ・時間切れ・見送り・休憩・本編の終了）
  // → カードは取れなかったので、判定で取れなかったときと同じく準備チップ
  function missIfUnpicked(g, pid, s) {
    if (!s || s.done || !s.die) return;
    const p = g.players[pid];
    if (p) addPrep(g, p, 'miss', null);
  }

  function maybeFinishChallenge(g) {
    const t = g.turn;
    if (!t || !t.ch) return;
    if (t.ch.members.every((m) => t.ch.st[m] && t.ch.st[m].done)) {
      t.stage = 'result';
    }
  }

  // ── 終盤 ───────────────────────────────────────────
  function enterFinal(g, now, rng, why) {
    if (g.turn) {
      const t = g.turn;
      g.metrics.turns.push([g.players[t.pid] ? g.players[t.pid].seat : -1, 0, t.startedAt, now, t.dec]);
    }
    g.turn = null;
    g.career = null;
    g.hold = '';
    g.phase = PHASE.FINAL;
    g.metrics.final = now;
    const rule = g.settings.endRule;
    g.final = { startedAt: now, rule };
    Object.values(g.players).forEach((p) => {
      p.fin = { step: 'choose', job: -1, base: 0, roll: null, final: 0 };
    });
    void rng;
    log(g, { k: 'final', why: why || '' });
  }

  function finalDone(p) {
    return !!p.fin && p.fin.step === 'done';
  }

  function reveal(g, now) {
    const rows = [];
    const none = [];
    playersInSeat(g).forEach((p) => {
      // 職業を決めていれば、仕上げのサイコロの前でも結果に入れる（決めた職業の点のまま）
      if (p.fin && p.fin.job >= 0) rows.push({ pid: p.id, job: p.fin.job, base: p.fin.base, final: finalDone(p) ? p.fin.final : p.fin.base, roll: finalDone(p) ? p.fin.roll : null, rank: 0 });
      else none.push(p.id);
    });
    rows.sort((a, b) => b.final - a.final);
    rows.forEach((r, i) => {
      r.rank = i > 0 && rows[i - 1].final === r.final ? rows[i - 1].rank : i + 1;
    });
    g.results = { at: now, rows, none, ranked: rows.length >= 2 };
    g.phase = PHASE.RESULTS;
    g.metrics.results = now;
    log(g, { k: 'reveal' });
  }

  // ── 各アクション ────────────────────────────────────
  const fail = (reason) => ({ ok: false, reason });

  function validName(name) {
    return typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 8;
  }

  function nameTaken(g, name, exceptId) {
    const n = name.trim();
    if (g.host.name === n && g.host.id !== exceptId) return true;
    return Object.values(g.players).some((p) => p.name === n && p.id !== exceptId);
  }

  function applySettingsPatch(g, patch) {
    const s = g.settings;
    const n = playerCount(g);
    if (patch.chips !== undefined) {
      if (!D.CHIP_OPTIONS.includes(patch.chips)) return false;
      s.chips = patch.chips;
      s.chipsAuto = false;
    }
    if (patch.chipsAuto === true) { s.chipsAuto = true; }
    if (patch.timerSec !== undefined) {
      if (!D.TIMER_OPTIONS.includes(patch.timerSec)) return false;
      s.timerSec = patch.timerSec;
    }
    if (patch.life !== undefined) s.life = !!patch.life;
    if (patch.career !== undefined) {
      if (![0, 1, 2].includes(patch.career)) return false;
      s.career = patch.career;
      s.careerAuto = false;
    }
    if (patch.careerAuto === true) s.careerAuto = true;
    if (patch.endRule !== undefined) {
      if (!END_RULES.includes(patch.endRule)) return false;
      s.endRule = patch.endRule;
    }
    autoSettings(g, n);
    return true;
  }

  // 人数が変わったら、自動の項目だけ推奨値に合わせる
  function autoSettings(g, n) {
    const s = g.settings;
    if (s.chipsAuto) s.chips = recommendedChips(Math.max(1, n));
    if (s.careerAuto) s.career = recommendedCareer(s.chips);
  }

  const handlers = {
    // ── ロビー ──
    JOIN(g, a) {
      if (g.phase !== PHASE.LOBBY) return fail('started');
      if (!a.pid || g.players[a.pid] || a.pid === g.host.id) return fail('exists');
      if (!validName(a.name)) return fail('name');
      if (nameTaken(g, a.name, a.pid)) return fail('nameTaken');
      if (playerCount(g) >= MAX_PLAYERS) return fail('full');
      if (a.by !== a.pid) return fail('auth');
      addPlayer(g, a.pid, a.name.trim(), 'self', false);
      autoSettings(g, playerCount(g));
      log(g, { k: 'join', p: a.pid });
      return null;
    },
    ADD_PROXY(g, a) {
      if (g.phase !== PHASE.LOBBY) return fail('started');
      if (!isHostActor(g, a.by)) return fail('auth');
      if (!a.pid || g.players[a.pid]) return fail('exists');
      if (!validName(a.name)) return fail('name');
      if (nameTaken(g, a.name, a.pid)) return fail('nameTaken');
      if (playerCount(g) >= MAX_PLAYERS) return fail('full');
      addPlayer(g, a.pid, a.name.trim(), 'host', false);
      autoSettings(g, playerCount(g));
      return null;
    },
    REMOVE_PLAYER(g, a) {
      if (g.phase !== PHASE.LOBBY) return fail('started');
      const p = g.players[a.pid];
      if (!p) return fail('none');
      if (!(isHostActor(g, a.by) || a.by === a.pid)) return fail('auth');
      if (p.isHost) return fail('host');
      delete g.players[a.pid];
      autoSettings(g, playerCount(g));
      log(g, { k: 'left', p: a.pid });
      return null;
    },
    SET_HOST_PLAYS(g, a) {
      if (g.phase !== PHASE.LOBBY) return fail('started');
      if (!isHostActor(g, a.by)) return fail('auth');
      const plays = !!a.plays;
      g.host.plays = plays;
      if (plays && !g.players[g.host.id]) {
        if (playerCount(g) >= MAX_PLAYERS) { g.host.plays = false; return fail('full'); }
        addPlayer(g, g.host.id, g.host.name, 'self', true);
      }
      if (!plays && g.players[g.host.id]) delete g.players[g.host.id];
      autoSettings(g, playerCount(g));
      return null;
    },
    SETTINGS(g, a) {
      if (g.phase !== PHASE.LOBBY) return fail('started');
      if (!isHostActor(g, a.by)) return fail('auth');
      if (!applySettingsPatch(g, a.patch || {})) return fail('value');
      return null;
    },
    START(g, a, ctx, rng) {
      if (g.phase !== PHASE.LOBBY) return fail('started');
      if (!isHostActor(g, a.by)) return fail('auth');
      const ids = playersInSeat(g).map((p) => p.id);
      if (ids.length < 1) return fail('noPlayers');
      g.order = rng.shuffle(ids);
      g.plan = careerRounds(g.settings.chips, g.settings.career);
      ids.forEach((id, i) => { g.players[id].color = i % D.PLAYER_COLORS.length; });
      ids.forEach((id) => {
        const p = g.players[id];
        p.chips = g.settings.chips;
        p.pos = D.START_NODE;
        p.status = 'active';
      });
      g.phase = PHASE.SETUP;
      g.metrics.setup = ctx.now;
      log(g, { k: 'start', order: g.order.slice() });
      return null;
    },

    // ── 準備（理想 → 配布 → 当面の目標）──
    IDEAL(g, a, ctx, rng) {
      const p = g.players[a.pid];
      if (g.phase !== PHASE.SETUP || !p) return fail('phase');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      if (p.setup.step !== 'ideal') return fail('stale');
      const job = num(a.job, -2);
      if (job >= 0) {
        if (!jobById(job)) return fail('value');
        p.ideal = job;
        p.jobs.push(job);
      } else if (job === -1) {
        // 「まだ決めない」: ゲーム用の職業をランダムに1枚（本人の理想としては扱わない）
        const rj = rng.pick(D.JOBS).id;
        p.ideal = -1;
        p.setup.undecided = true;
        p.jobs.push(rj);
      } else return fail('value');
      dealInitial(g, p, rng);
      p.setup.step = 'deal';
      return null;
    },
    DEAL_OK(g, a) {
      const p = g.players[a.pid];
      if (g.phase !== PHASE.SETUP || !p) return fail('phase');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      if (p.setup.step !== 'deal') return fail('stale');
      p.setup.step = 'goal';
      return null;
    },
    GOAL(g, a, ctx, rng) {
      const p = g.players[a.pid];
      if (!p) return fail('none');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      const late = p.setup.goalPending && (g.phase === PHASE.MAIN || g.phase === PHASE.FINAL || g.phase === PHASE.SETUP);
      if (!(g.phase === PHASE.SETUP && p.setup.step === 'goal') && !late) return fail('stale');
      if (g.phase === PHASE.FINAL && p.fin && p.fin.step === 'done') return fail('stale');
      let job = num(a.job, -1);
      if (job === -2) job = rng.pick(p.setup.cands);
      if (!p.setup.cands.includes(job)) return fail('value');
      if (!p.jobs.includes(job)) p.jobs.push(job);
      p.goal = job;
      p.setup.goalPending = false;
      if (g.phase === PHASE.SETUP) p.setup.step = 'done';
      log(g, { k: 'goal', p: p.id, j: job });
      return null;
    },
    BEGIN(g, a, ctx, rng) {
      if (g.phase !== PHASE.SETUP) return fail('phase');
      if (!isHostActor(g, a.by)) return fail('auth');
      const waiting = g.order.filter((pid) => g.players[pid].status === 'active' && g.players[pid].setup.step !== 'done');
      if (waiting.length && !a.force) return fail('notReady');
      const pending = g.order.filter((pid) => g.players[pid].setup.step !== 'done');
      pending.forEach((pid) => {
        const p = g.players[pid];
        if (p.setup.step === 'ideal') {
          const rj = rng.pick(D.JOBS).id;
          p.ideal = -1;
          p.setup.undecided = true;
          p.jobs.push(rj);
          dealInitial(g, p, rng);
        }
        p.setup.goalPending = true; // 当面の目標は、あとで手札の画面から選べる
        p.setup.step = 'done';
      });
      startMain(g, ctx.now, rng);
      return null;
    },

    // ── 手番 ──
    ROLL(g, a, ctx, rng) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'roll') return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      const p = g.players[t.pid];
      t.die = rng.die();
      t.dec += 1;
      walk(g, p, t.die, rng);
      return null;
    },
    FORK(g, a, ctx, rng) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'fork' || !t.fork) return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      const b = num(a.b, -1);
      if (b !== 0 && b !== 1) return fail('value');
      t.dec += 1;
      continueFromFork(g, g.players[t.pid], b, rng);
      return null;
    },
    PICK(g, a, ctx, rng) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'act' || !t.sq) return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      const p = g.players[t.pid];
      const i = num(a.i, -1);
      const eff = t.sq.eff;
      t.dec += 1;
      if (eff === 'grow' || eff === 'new') {
        const apt = t.sq.opts[i];
        if (apt === undefined || !below(p, apt)) return fail('value');
        gain(g, p, apt, 1, t.res, eff);
      } else if (eff === 'job') {
        const job = t.sq.opts[i];
        if (job === undefined || p.jobs.includes(job)) return fail('value');
        p.jobs.push(job);
        t.res.push({ k: 'job', p: p.id, j: job });
        log(g, { k: 'job', p: p.id, j: job });
      } else if (eff === 'life') {
        const plan = D.LIFE_PLANS[t.sq.opts[i]];
        if (!plan) return fail('value');
        p.life = { used: true, apt: plan.a, left: D.LIFE_TURNS, scene: plan.s };
        t.res.push({ k: 'life', p: p.id, scene: plan.s, a: plan.a, i: plan.i });
        log(g, { k: 'life', p: p.id, scene: plan.s, a: plan.a });
      } else return fail('value');
      t.stage = 'result';
      return null;
    },
    PASS(g, a) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'act' || !t.sq) return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      const p = g.players[t.pid];
      t.dec += 1;
      if (t.sq.eff === 'life') {
        p.life.used = true; // 1人1回。選ばないことも選択として扱う（仮）
        t.res.push({ k: 'lifePass', p: p.id });
        log(g, { k: 'lifePass', p: p.id });
      } else if (t.sq.eff === 'job') {
        t.res.push({ k: 'jobPass', p: p.id });
      } else return fail('value');
      t.stage = 'result';
      return null;
    },
    PARTNER(g, a, ctx) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'partner' || !t.sq) return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      t.dec += 1;
      if (!a.to) {
        t.ch = newChallenge('collab', t.sq.scene, [t.pid]);
        t.ch.solo = true;
        t.ch.note = 'alone';
        t.stage = 'challenge';
        return null;
      }
      if (!eligiblePartners(g, t.sq.scene).includes(a.to)) return fail('value');
      t.inv = { pid: a.to, until: ctx.now + INVITE_MS, status: 'pending' };
      t.stage = 'invite';
      log(g, { k: 'invite', p: t.pid, to: a.to });
      return null;
    },
    RESPOND(g, a) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'invite' || !t.inv || t.inv.status !== 'pending') return fail('stale');
      if (!canActFor(g, a.by, t.inv.pid)) return fail('auth');
      const invitee = g.players[t.inv.pid];
      const ok = !!a.accept && invitee && invitee.status === 'active' && invitee.chips > 0;
      if (ok) {
        invitee.chips -= 1; // 招待を受けたときだけ1枚
        t.inv.status = 'accepted';
        t.ch = newChallenge('collab', t.sq.scene, [t.pid, invitee.id]);
        log(g, { k: 'accept', p: invitee.id });
      } else {
        t.inv.status = 'declined';
        t.ch = newChallenge('collab', t.sq.scene, [t.pid]);
        t.ch.solo = true;
        t.ch.note = 'declined';
        log(g, { k: 'decline', p: t.inv.pid });
      }
      t.stage = 'challenge';
      return null;
    },
    INVITE_TIMEOUT(g, a, ctx) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'invite' || !t.inv || t.inv.status !== 'pending') return fail('stale');
      if (!isParticipant(g, a.by)) return fail('auth');
      if (g.paused) return fail('paused');
      if (ctx.now + TIMEOUT_TOLERANCE_MS < t.inv.until) return fail('early');
      t.inv.status = 'timeout';
      t.ch = newChallenge('collab', t.sq.scene, [t.pid]);
      t.ch.solo = true;
      t.ch.note = 'timeout';
      t.stage = 'challenge';
      log(g, { k: 'decline', p: t.inv.pid, why: 'timeout' });
      return null;
    },
    CH_PICK(g, a) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'challenge' || !t.ch) return fail('stale');
      const m = a.pid || t.pid;
      const s = t.ch.st[m];
      if (!s || s.done || s.die) return fail('stale');
      if (!canActFor(g, a.by, m)) return fail('auth');
      const scene = sceneOf(t.ch);
      const i = num(a.i, -1);
      const opt = scene.opts[i];
      if (!opt || !below(g.players[m], opt[1])) return fail('value');
      s.pick = i;
      if (m === t.pid) t.dec += 1;
      return null;
    },
    CH_ROLL(g, a, ctx, rng) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'challenge' || !t.ch) return fail('stale');
      const m = a.pid || t.pid;
      const s = t.ch.st[m];
      if (!s || s.done || s.die || s.pick < 0) return fail('stale');
      if (!canActFor(g, a.by, m)) return fail('auth');
      const p = g.players[m];
      const target = sceneOf(t.ch).opts[s.pick][1];
      if (!below(p, target)) return fail('value');
      if (m === t.pid) t.dec += 1;
      rollChallenge(g, p, s, target, rng, t.res);
      // 2人でコラボしたら、2人とも準備チップ1枚（協力した経験は、最後の仕上げの準備になる）。
      // 相手が振る前に見送られた（休憩・ホストの見送り）あとは、ひとりで振るので付けない
      const together = t.ch.members.some((mid) => mid !== m && t.ch.st[mid] && !['dropped', 'cancel'].includes(t.ch.st[mid].note));
      if (t.ch.kind === 'collab' && together) addPrep(g, p, 'collab', t.res);
      maybeFinishChallenge(g);
      return null;
    },
    CH_REWARD(g, a) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'challenge' || !t.ch) return fail('stale');
      const m = a.pid || t.pid;
      const s = t.ch.st[m];
      if (!s || s.done || s.tier !== 'mid') return fail('stale');
      if (!canActFor(g, a.by, m)) return fail('auth');
      const apt = num(a.a, -1);
      if (!s.rw.includes(apt)) return fail('value');
      const p = g.players[m];
      const got = gain(g, p, apt, 1, t.res, 'reward');
      s.got = got > 0 ? [[apt, got]] : [];
      s.done = true;
      if (m === t.pid) t.dec += 1;
      maybeFinishChallenge(g);
      return null;
    },
    // コラボ相手が戻らないときなど、ホストが相手の分だけを見送る（振る前なら時間チップを戻す）
    CH_DROP(g, a) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'challenge' || !t.ch) return fail('stale');
      if (!isHostActor(g, a.by) && a.by !== a.pid) return fail('auth');
      const s = t.ch.st[a.pid];
      if (!s || s.done || a.pid === t.pid) return fail('value');
      if (s.die === 0 && !s.refunded) {
        g.players[a.pid].chips += 1;
        s.refunded = true;
        log(g, { k: 'refund', p: a.pid });
      }
      missIfUnpicked(g, a.pid, s);
      s.done = true;
      s.note = 'dropped';
      maybeFinishChallenge(g);
      return null;
    },
    END_TURN(g, a, ctx, rng) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || t.stage !== 'result') return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      finishTurn(g, ctx.now, rng, 'end');
      return null;
    },
    SKIP(g, a, ctx, rng) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t) return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      finishTurn(g, ctx.now, rng, isHostActor(g, a.by) && a.by !== t.pid ? 'host' : 'self');
      return null;
    },
    TIMEOUT(g, a, ctx, rng) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t) return fail('stale');
      if (!isParticipant(g, a.by)) return fail('auth');
      if (g.paused) return fail('paused');
      const rem = timerRemaining(g, ctx.now);
      if (rem === null || rem > TIMEOUT_TOLERANCE_MS) return fail('early');
      finishTurn(g, ctx.now, rng, t.stage === 'result' ? 'end' : 'timeout');
      return null;
    },
    EXTEND(g, a, ctx) {
      const t = g.turn;
      if (g.phase !== PHASE.MAIN || !t || g.settings.timerSec <= 0) return fail('stale');
      if (!canActFor(g, a.by, t.pid)) return fail('auth');
      if (t.timer.ext) return fail('used');
      t.timer.ext = true;
      return null;
    },
    OMAKASE(g, a, ctx, rng) {
      // 本人が選んだ「おまかせ」: いま有効な候補からランダムに1つ（暮らしのプラン・最後の職業は対象外）
      if (a.x != null && a.x !== decisionKey(g, a.pid)) return fail('stale');
      const derived = omakaseAction(g, a, rng);
      if (!derived) return fail('stale');
      return handlers[derived.t](g, { ...derived, by: a.by }, ctx, rng);
    },

    // ── 休む・戻る・終える ──
    STATUS(g, a, ctx, rng) {
      const p = g.players[a.pid];
      if (!p) return fail('none');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      if (g.phase === PHASE.LOBBY || g.phase === PHASE.RESULTS) return fail('phase');
      const to = a.to;
      if (!['active', 'resting', 'left'].includes(to)) return fail('value');
      if (p.status === to) return fail('same');
      const prev = p.status;
      p.status = to;
      log(g, { k: to === 'active' ? 'back' : to === 'resting' ? 'rest' : 'leave', p: p.id, by: a.by === a.pid ? 'self' : 'host' });
      if (g.phase === PHASE.MAIN) {
        if (to !== 'active') interruptFor(g, p, ctx.now, rng);
        if (to === 'active' && g.career && g.career.st[p.id] && !g.career.st[p.id].done) g.career.st[p.id].away = false;
        if (to === 'active' && prev !== 'active' && g.hold === 'allResting' && !g.turn && !g.career) {
          g.hold = '';
          advance(g, ctx.now, rng);
        }
      }
      return null;
    },
    SET_GOAL(g, a) {
      const p = g.players[a.pid];
      if (!p) return fail('none');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      if (!(g.phase === PHASE.MAIN || g.phase === PHASE.SETUP || (g.phase === PHASE.FINAL && p.fin && p.fin.step !== 'done'))) return fail('phase');
      const job = num(a.job, -1);
      if (!p.jobs.includes(job)) return fail('value');
      p.goal = job;
      log(g, { k: 'goal', p: p.id, j: job });
      return null;
    },

    // ── ホストの進行操作 ──
    PAUSE(g, a, ctx) {
      if (!isHostActor(g, a.by)) return fail('auth');
      if (g.phase !== PHASE.MAIN) return fail('phase');
      if (!!a.on === g.paused) return fail('same');
      if (g.turn) syncTimer(g, ctx.now);
      g.paused = !!a.on;
      if (g.turn) syncTimer(g, ctx.now);
      if (g.turn && g.turn.inv && g.turn.inv.status === 'pending') {
        // コラボの招待の返事待ちも、一時停止のあいだは締め切りを延ばす
        const inv = g.turn.inv;
        if (g.paused) inv.pausedAt = ctx.now;
        else if (inv.pausedAt) { inv.until += Math.max(0, ctx.now - inv.pausedAt); inv.pausedAt = 0; }
      }
      if (g.career && g.career.until) {
        // 進路のラウンドの締め切りも一時停止分だけ延ばす
        if (g.paused) g.career.pausedAt = ctx.now;
        else if (g.career.pausedAt) {
          g.career.until += Math.max(0, ctx.now - g.career.pausedAt);
          g.career.pausedAt = 0;
        }
      }
      log(g, { k: g.paused ? 'pause' : 'resume' });
      return null;
    },
    END_LAP(g, a) {
      if (!isHostActor(g, a.by)) return fail('auth');
      if (g.phase !== PHASE.MAIN || g.lastLap !== null) return fail('phase');
      // 宣言時点の順番に沿って、残り時間のある人に1回ずつ（仮）。
      // 手番の途中で宣言したら、その手番がその人の最後の手番。ほかの人が1回ずつ進めたら終盤へ。
      // 進路のラウンド中・全員休憩中の宣言では、全員が1回ずつ。
      const n = g.order.length;
      const startAt = g.career ? 0 : (g.ptr + 1) % n;
      const current = g.turn ? g.turn.pid : '';
      const lap = [];
      for (let i = 0; i < n; i++) {
        const pid = g.order[(startAt + i) % n];
        const p = g.players[pid];
        if (pid === current) continue;
        if (p && p.status !== 'left' && p.chips > 0) lap.push(pid);
      }
      g.lastLap = lap;
      log(g, { k: 'lastLap' });
      return null;
    },
    END_NOW(g, a, ctx, rng) {
      if (!isHostActor(g, a.by)) return fail('auth');
      if (g.phase !== PHASE.MAIN) return fail('phase');
      if (g.turn) {
        const t = g.turn;
        syncTimer(g, ctx.now);
        // コラボ相手の未実行分は戻してから終盤へ
        if (t.ch) {
          t.ch.members.forEach((mid) => {
            const s = t.ch.st[mid];
            missIfUnpicked(g, mid, s);
            if (mid !== t.pid && s && !s.done && s.die === 0 && !s.refunded) { g.players[mid].chips += 1; s.refunded = true; }
          });
        }
      }
      if (g.career) g.metrics.turns.push([-1, 2, g.career.startedAt, ctx.now, Object.keys(g.career.st).length]);
      enterFinal(g, ctx.now, rng, 'host');
      return null;
    },
    HOST_BACK(g, a) {
      // ホストがいない間は進行が止まって見えるので、その間の時間を締め切りに数えない
      if (!isHostActor(g, a.by)) return fail('auth');
      if (g.phase !== PHASE.MAIN) return fail('phase');
      const away = Math.max(0, Math.min(30 * 60 * 1000, num(a.away, 0)));
      if (!away) return fail('same');
      const t = g.turn;
      if (t && t.timer.since != null) t.timer.since += away;
      if (t && t.inv && t.inv.status === 'pending') t.inv.until += away;
      if (g.career && g.career.until) g.career.until += away;
      log(g, { k: 'hostBack' });
      return null;
    },
    RESUME_HOLD(g, a, ctx, rng) {
      // 全員休憩中の保留から、休憩を続けるか確認し直す（誰かが戻っていれば進む）
      if (!isHostActor(g, a.by)) return fail('auth');
      if (g.phase !== PHASE.MAIN || g.hold !== 'allResting') return fail('phase');
      advance(g, ctx.now, rng);
      return null;
    },

    // ── 進路のラウンド ──
    CR_ROUTE(g, a) {
      const c = g.career;
      if (g.phase !== PHASE.MAIN || !c) return fail('stale');
      const s = c.st[a.pid];
      if (!s || s.done) return fail('stale');
      if (!g.players[a.pid] || g.players[a.pid].status !== 'active') return fail('resting');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      if (a.route && !careerRoute(c.stage, a.route)) return fail('value');
      s.route = a.route || '';
      return null;
    },
    CR_ACT(g, a, ctx, rng) {
      const c = g.career;
      if (g.phase !== PHASE.MAIN || !c) return fail('stale');
      const s = c.st[a.pid];
      if (!s || s.done || !s.route) return fail('stale');
      if (!g.players[a.pid] || g.players[a.pid].status !== 'active') return fail('resting');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      const route = careerRoute(c.stage, s.route);
      const act = route && route.acts[num(a.i, -1)];
      const p = g.players[a.pid];
      if (!act || !below(p, act[1])) return fail('value');
      s.act = num(a.i, -1);
      s.apt = act[1];
      s.done = true;
      gain(g, p, act[1], 1, null, 'career');
      log(g, { k: 'careerPick', p: p.id, route: s.route, a: act[1] });
      maybeEndCareer(g, ctx.now, rng);
      return null;
    },
    CR_PASS(g, a, ctx, rng) {
      const c = g.career;
      if (g.phase !== PHASE.MAIN || !c) return fail('stale');
      const s = c.st[a.pid];
      if (!s || s.done) return fail('stale');
      if (!g.players[a.pid] || g.players[a.pid].status !== 'active') return fail('resting');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      s.done = true;
      s.passed = true;
      log(g, { k: 'careerPass', p: a.pid });
      maybeEndCareer(g, ctx.now, rng);
      return null;
    },
    CR_CLOSE(g, a, ctx, rng) {
      const c = g.career;
      if (g.phase !== PHASE.MAIN || !c) return fail('stale');
      const timedOut = c.until > 0 && ctx.now + TIMEOUT_TOLERANCE_MS >= c.until && !g.paused;
      if (!isHostActor(g, a.by) && !(timedOut && isParticipant(g, a.by))) return fail('auth');
      Object.entries(c.st).forEach(([pid, s]) => {
        if (!s.done) { s.done = true; s.skipped = true; log(g, { k: 'skip', p: pid, why: timedOut && !isHostActor(g, a.by) ? 'timeout' : 'close' }); }
      });
      maybeEndCareer(g, ctx.now, rng);
      return null;
    },

    // ── 終盤 ──
    FN_CHOOSE(g, a) {
      const p = g.players[a.pid];
      if (g.phase !== PHASE.FINAL || !p || !p.fin || p.fin.step !== 'choose') return fail('stale');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      const job = num(a.job, -1);
      if (!p.jobs.includes(job)) return fail('value');
      const sc = score(p.apt, job);
      p.fin.job = job;
      p.fin.base = sc.total;
      p.fin.final = sc.total;
      p.fin.step = g.final && g.final.rule === 'present' ? 'present' : 'done';
      log(g, { k: 'finalPick', p: p.id });
      return null;
    },
    FN_PRESENT(g, a, ctx, rng) {
      // 仕上げのサイコロ: 出目＋準備チップ（最大2枚）→ 0〜3点
      const p = g.players[a.pid];
      if (g.phase !== PHASE.FINAL || !p || !p.fin || p.fin.step !== 'present') return fail('stale');
      if (!canActFor(g, a.by, a.pid)) return fail('auth');
      const die = rng.die();
      const used = Math.min(PREP_MAX, p.prep);
      const total = die + used;
      const bonus = presentBonus(total);
      p.fin.roll = { die, used, total, bonus };
      p.fin.final = p.fin.base + bonus;
      p.fin.step = 'done';
      log(g, { k: 'present', p: p.id, die, used, bonus });
      return null;
    },
    REVEAL(g, a, ctx) {
      if (g.phase !== PHASE.FINAL) return fail('phase');
      if (!isHostActor(g, a.by)) return fail('auth');
      const waiting = Object.values(g.players).filter((p) => p.status === 'active' && !finalDone(p));
      if (waiting.length && !a.force) return fail('notReady');
      reveal(g, ctx.now);
      return null;
    },
  };

  function dealInitial(g, p, rng) {
    // 異なる種類の適性をランダムに3枚（本人の実際の適性の診断ではない）
    const dealt = rng.shuffle(range(NAPT)).slice(0, 3).sort((x, y) => x - y);
    dealt.forEach((a) => { p.apt[a] = Math.max(p.apt[a], 1); });
    p.setup.dealt = dealt;
    p.setup.cands = rng.shuffle(D.JOBS.map((j) => j.id).filter((id) => !p.jobs.includes(id))).slice(0, 3);
    log(g, { k: 'deal', p: p.id, a: dealt });
  }

  // 手番の人・コラボ相手が休む／終えるときの中断処理
  function interruptFor(g, p, now, rng) {
    const t = g.turn;
    if (g.career && g.career.st[p.id] && !g.career.st[p.id].done) {
      // 進路のラウンド中に休む: 待たずに進む（終わる前に戻れば選べる）。参加を終えたら見送り
      if (p.status === 'left') { g.career.st[p.id].done = true; g.career.st[p.id].skipped = true; }
      else g.career.st[p.id].away = true;
      maybeEndCareer(g, now, rng);
      return;
    }
    if (!t) return;
    if (t.pid === p.id) { finishTurn(g, now, rng, p.status === 'left' ? 'leave' : 'rest'); return; }
    if (t.stage === 'invite' && t.inv && t.inv.pid === p.id && t.inv.status === 'pending') {
      t.inv.status = 'declined';
      t.ch = newChallenge('collab', t.sq.scene, [t.pid]);
      t.ch.solo = true;
      t.ch.note = 'declined';
      t.stage = 'challenge';
      syncTimer(g, now);
      return;
    }
    if (t.ch && t.ch.st[p.id] && !t.ch.st[p.id].done) {
      const s = t.ch.st[p.id];
      if (s.die === 0 && !s.refunded) { p.chips += 1; s.refunded = true; log(g, { k: 'refund', p: p.id }); }
      missIfUnpicked(g, p.id, s);
      s.done = true;
      s.note = 'dropped';
      maybeFinishChallenge(g);
      syncTimer(g, now);
    }
  }

  // おまかせ: いま本人が選べる候補からランダムに1つを選んだ具体的なアクションを返す
  function omakaseAction(g, a, rng) {
    const pid = a.pid;
    const p = g.players[pid];
    if (!p) return null;
    if (g.phase === PHASE.SETUP && p.setup.step === 'goal') return { t: 'GOAL', pid, job: rng.pick(p.setup.cands) };
    if (g.phase === PHASE.MAIN && g.career) {
      const s = g.career.st[pid];
      if (!s || s.done) return null;
      const c = D.CAREERS[g.career.stage];
      if (!s.route) {
        const routes = c.routes.concat([c.common]).filter((r) => r.acts.some(([, apt]) => below(p, apt)));
        if (!routes.length) return { t: 'CR_PASS', pid };
        return { t: 'CR_ROUTE', pid, route: rng.pick(routes).id };
      }
      const route = careerRoute(g.career.stage, s.route);
      const idxs = route.acts.map((x, i) => i).filter((i) => below(p, route.acts[i][1]));
      if (!idxs.length) return null;
      return { t: 'CR_ACT', pid, i: rng.pick(idxs) };
    }
    const t = g.turn;
    if (g.phase !== PHASE.MAIN || !t) return null;
    if (t.pid === pid) {
      if (t.stage === 'fork') return { t: 'FORK', b: rng.int(2) };
      if (t.stage === 'act' && t.sq && t.sq.eff !== 'life') {
        const idxs = t.sq.opts.map((x, i) => i).filter((i) => (t.sq.eff === 'job' ? true : below(p, t.sq.opts[i])));
        if (!idxs.length) return null;
        return { t: 'PICK', i: rng.pick(idxs) };
      }
      if (t.stage === 'partner') {
        const cands = eligiblePartners(g, t.sq.scene);
        return { t: 'PARTNER', to: cands.length ? rng.pick(cands) : '' };
      }
    }
    if (t.stage === 'challenge' && t.ch && t.ch.st[pid] && !t.ch.st[pid].done) {
      const s = t.ch.st[pid];
      if (s.tier === 'mid' && s.rw.length) return { t: 'CH_REWARD', pid, a: rng.pick(s.rw) };
      if (!s.die) {
        const scene = sceneOf(t.ch);
        const idxs = scene.opts.map((x, i) => i).filter((i) => below(p, scene.opts[i][1]));
        if (!idxs.length) return null;
        return { t: 'CH_PICK', pid, i: rng.pick(idxs) };
      }
    }
    return null;
  }

  // ── 入口 ───────────────────────────────────────────
  // action: { t: 種類, by: 操作した人のID, g: { turn, stage } ガード（任意）, ...引数 }
  // ctx: { now: 時刻ms, seed: 乱数の種 }
  function apply(game, action, ctx) {
    if (!action || typeof action.t !== 'string' || !handlers[action.t]) return fail('unknown');
    const g = normalize(game);
    const c = { now: num(ctx && ctx.now, 0), seed: num(ctx && ctx.seed, 1) };
    if (action.g) {
      if (action.g.turn != null && (!g.turn || g.turn.id !== action.g.turn)) return fail('stale');
      if (action.g.stage != null && (!g.turn || g.turn.stage !== action.g.stage)) return fail('stale');
      if (action.g.phase != null && g.phase !== action.g.phase) return fail('stale');
    }
    const rng = makeRng(c.seed);
    const err = handlers[action.t](g, action, c, rng);
    if (err) return err;
    if (g.turn) syncTimer(g, c.now);
    g.seq += 1;
    return { ok: true, game: g };
  }

  // 画面・テストのための「いま誰が何を決めるか」
  function pendingFor(g, pid) {
    const p = g.players[pid];
    if (!p) return null;
    if (g.phase === PHASE.SETUP) return p.setup.step !== 'done' ? { kind: 'setup', step: p.setup.step } : null;
    if (g.phase === PHASE.MAIN) {
      if (g.career) {
        const s = g.career.st[pid];
        return s && !s.done ? { kind: 'career', step: s.route ? 'act' : 'route' } : null;
      }
      const t = g.turn;
      if (!t) return null;
      if (t.stage === 'invite' && t.inv && t.inv.pid === pid && t.inv.status === 'pending') return { kind: 'invite' };
      if (t.stage === 'challenge' && t.ch && t.ch.st[pid] && !t.ch.st[pid].done) {
        const s = t.ch.st[pid];
        return { kind: 'challenge', step: s.tier === 'mid' ? 'reward' : s.pick < 0 ? 'pick' : 'roll' };
      }
      if (t.pid === pid && t.stage !== 'invite' && t.stage !== 'challenge') return { kind: 'turn', step: t.stage };
      return null;
    }
    if (g.phase === PHASE.FINAL) return p.fin && p.fin.step !== 'done' ? { kind: 'final', step: p.fin.step } : null;
    return null;
  }

  return {
    PHASE, CAP, MAX_SCORE, MAX_PLAYERS, INVITE_MS, EXT_MS, END_RULES, PREP_MAX,
    makeRng, score, presentBonus, aptRole, gainDelta, recommendedChips, recommendedCareer, careerRounds, estimateMinutes, defaultSettings, lifePlanOptions,
    newGame, normalize, serialize, apply, pendingFor, eligiblePartners, timerRemaining, turnNeedsCurrent, decisionKey,
    playersInSeat, currentPid, careerRoute, sceneOf, below, aptTotal, finalDone,
  };
}));
