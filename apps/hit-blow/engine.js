/* ヒット&ブロー（試作）のルール。画面に関わらない部分だけを置く（node でも読める）。
   ・答えは、色（しるしつき）を重ならないように並べたもの
   ・ヒット: 色も場所もあっている／ブロー: 色はあるが場所がちがう
   ・2人で対戦: おたがいの答えを交互に当てる。先の人が当てたら、後の人にもう1回だけ番がある（そろえば引き分け）
   ・みんなで対戦: コンピューターがかくした1つの答えを、順番に当てる。最初に当てた人の勝ち */
(function (root) {
  'use strict';

  // 色ごとに、形のちがうしるしを付ける（色だけで見分けなくてよいように）
  const COLORS = [
    { id: 'red', name: '赤', hex: '#D64545', icon: 'favorite', dark: false },
    { id: 'blue', name: '青', hex: '#2F78C8', icon: 'water_drop', dark: false },
    { id: 'yellow', name: '黄', hex: '#F2C230', icon: 'star', dark: true },
    { id: 'green', name: '緑', hex: '#3A9A55', icon: 'eco', dark: false },
    { id: 'purple', name: '紫', hex: '#8A5CC4', icon: 'diamond', dark: false },
    { id: 'orange', name: 'オレンジ', hex: '#E8812B', icon: 'circle', dark: false },
    { id: 'pink', name: 'ピンク', hex: '#F08CB4', icon: 'local_florist', dark: true },
    { id: 'brown', name: '茶', hex: '#8B5E3C', icon: 'square', dark: false },
  ];

  const LEVELS = {
    easy: { id: 'easy', name: 'やさしい', slots: 3, colors: 6 },
    normal: { id: 'normal', name: 'ふつう', slots: 4, colors: 6 },
    hard: { id: 'hard', name: 'むずかしい', slots: 4, colors: 8 },
  };

  const MODES = {
    duel: { id: 'duel', name: '2人で対戦', min: 2, max: 2 },
    party: { id: 'party', name: 'みんなで対戦', min: 2, max: 6 },
  };

  function levelOf(id) {
    return LEVELS[id] || LEVELS.normal;
  }

  function palette(levelId) {
    return COLORS.slice(0, levelOf(levelId).colors);
  }

  // 正しい答え・予想か（数がそろい、使える色で、重ならない）
  function validCode(code, levelId) {
    const L = levelOf(levelId);
    if (!Array.isArray(code) || code.length !== L.slots) return false;
    const ok = palette(levelId).map((c) => c.id);
    if (!code.every((x) => ok.includes(x))) return false;
    return new Set(code).size === code.length;
  }

  function judge(secret, guess) {
    let hit = 0;
    let blow = 0;
    guess.forEach((g, i) => {
      if (secret[i] === g) hit += 1;
      else if (secret.includes(g)) blow += 1;
    });
    return { hit, blow };
  }

  function randomCode(levelId, rnd) {
    const r = rnd || Math.random;
    const pool = palette(levelId).map((c) => c.id);
    const out = [];
    const n = levelOf(levelId).slots;
    while (out.length < n) {
      const i = Math.floor(r() * pool.length);
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  /* ── ゲームの状態 ──
     { mode, level, n, phase: 'setup'|'play'|'end', turn, secrets: [code|null...], log: [{by, target, guess, hit, blow}],
       solved: [番号...], lastChance: 番号|null, winners: [番号...], draw }
     みんなで対戦の答えは secrets[0] に1つだけ置く（target は -1） */
  function create(opts, rnd) {
    const mode = MODES[opts.mode] ? opts.mode : 'party';
    const M = MODES[mode];
    const n = Math.max(M.min, Math.min(M.max, opts.n | 0));
    const level = levelOf(opts.level).id;
    const S = { v: 1, mode, level, n, phase: 'setup', turn: 0, secrets: [], log: [], solved: [], lastChance: null, winners: [], draw: false, round: (opts.round | 0) + 1 };
    if (mode === 'party') {
      S.secrets = [randomCode(level, rnd)];
      S.phase = 'play';
    } else {
      S.secrets = [null, null];
      // autoSecret: 2人ともコンピューターが決める（1台の画面）。autoSeats: その番号の人だけ（ルームの端末なしの人）
      const auto = Array.isArray(opts.autoSeats) ? opts.autoSeats : [];
      [0, 1].forEach((i) => {
        if (opts.autoSecret || auto.includes(i)) S.secrets[i] = randomCode(level, rnd);
      });
      if (S.secrets.every(Boolean)) S.phase = 'play';
    }
    // 先の番は、回ごとにずらす（いつも同じ人が先にならないように）
    S.turn = (S.round - 1) % n;
    return S;
  }

  // 2人で対戦: 自分の答え（相手が当てる答え）を決める
  function setSecret(S, who, code) {
    if (S.mode !== 'duel' || S.phase !== 'setup' || !validCode(code, S.level)) return S;
    if (who !== 0 && who !== 1) return S;
    const next = clone(S);
    next.secrets[who] = code.slice();
    if (next.secrets.every(Boolean)) next.phase = 'play';
    return next;
  }

  function targetOf(S, who) {
    return S.mode === 'duel' ? 1 - who : -1;
  }

  function secretFor(S, who) {
    return S.mode === 'duel' ? S.secrets[1 - who] : S.secrets[0];
  }

  // 番の人が予想を出す。だめなら同じ S を返す
  function guess(S, who, code) {
    if (S.phase !== 'play' || S.turn !== who || !validCode(code, S.level)) return S;
    const next = clone(S);
    const secret = secretFor(next, who);
    const r = judge(secret, code);
    next.log.push({ by: who, target: targetOf(next, who), guess: code.slice(), hit: r.hit, blow: r.blow });
    const solved = r.hit === code.length;
    if (next.mode === 'party') {
      if (solved) {
        next.solved = [who];
        next.winners = [who];
        next.phase = 'end';
      } else {
        next.turn = (who + 1) % next.n;
      }
      return next;
    }
    // 2人で対戦
    if (next.lastChance === who) {
      // もう1回だけの番
      if (solved) {
        next.solved.push(who);
        next.winners = next.solved.slice();
        next.draw = true;
      } else {
        next.winners = next.solved.slice();
      }
      next.phase = 'end';
      return next;
    }
    if (solved) {
      next.solved.push(who);
      const first = (next.round - 1) % 2; // この回で先に番だった人
      if (who === first) {
        // 先の人が当てたら、後の人にもう1回だけ番がある（同じ回数で比べるため）
        next.lastChance = 1 - who;
        next.turn = 1 - who;
      } else {
        next.winners = [who];
        next.phase = 'end';
      }
      return next;
    }
    next.turn = 1 - who;
    return next;
  }

  // 抜けたなどで、番をとばす（みんなで対戦のときだけ）
  function skip(S) {
    if (S.phase !== 'play' || S.mode !== 'party') return S;
    const next = clone(S);
    next.turn = (S.turn + 1) % S.n;
    return next;
  }

  function validState(S) {
    return !!S && S.v === 1 && !!MODES[S.mode] && !!LEVELS[S.level] && Array.isArray(S.secrets) && Array.isArray(S.log)
      && Array.isArray(S.winners) && Array.isArray(S.solved) && ['setup', 'play', 'end'].includes(S.phase);
  }

  // 保存先（Realtime Database）から読んだ値を、ルールで使える形にそろえる。
  // 空の配列や null は保存されずに消え、配列が番号つきのオブジェクトで返ることがあるため。壊れていれば null
  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.v !== 1 || !MODES[raw.mode] || !LEVELS[raw.level]) return null;
    const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.keys(v).sort((a, b) => a - b).map((k) => v[k]) : []);
    const M = MODES[raw.mode];
    const n = raw.n | 0;
    if (n < M.min || n > M.max) return null;
    const idx = (v) => (Number.isInteger(v) && v >= 0 && v < n ? v : null);
    const codeOrNull = (c) => {
      const arr = list(c);
      return validCode(arr, raw.level) ? arr : null;
    };
    const slots = raw.mode === 'duel' ? 2 : 1;
    const secrets = [];
    for (let i = 0; i < slots; i += 1) secrets.push(codeOrNull(raw.secrets && raw.secrets[i]));
    const phase = ['setup', 'play', 'end'].includes(raw.phase) ? raw.phase : 'setup';
    if (phase !== 'setup' && !secrets.every(Boolean)) return null;
    const log = list(raw.log).map((t) => {
      if (!t || typeof t !== 'object') return null;
      const guessCode = codeOrNull(t.guess);
      const by = idx(t.by);
      if (!guessCode || by == null) return null;
      return { by, target: raw.mode === 'duel' ? 1 - by : -1, guess: guessCode, hit: t.hit | 0, blow: t.blow | 0 };
    }).filter(Boolean);
    return {
      v: 1,
      mode: raw.mode,
      level: raw.level,
      n,
      phase,
      turn: idx(raw.turn) ?? 0,
      secrets,
      log,
      solved: list(raw.solved).map(idx).filter((v) => v != null),
      lastChance: idx(raw.lastChance),
      winners: list(raw.winners).map(idx).filter((v) => v != null),
      draw: raw.draw === true,
      round: Math.max(1, raw.round | 0),
    };
  }

  function clone(S) {
    return JSON.parse(JSON.stringify(S));
  }

  const api = { COLORS, LEVELS, MODES, levelOf, palette, validCode, judge, randomCode, create, setSecret, guess, skip, secretFor, targetOf, validState, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HitBlowEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
