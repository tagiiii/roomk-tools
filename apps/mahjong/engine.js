/* 麻雀 — ルール
   画面と通信に触らない。ブラウザでは window.MahjongEngine、node では module.exports。
   状態は JSON にできる値だけで持つ（本体にするとき、そのままルームに置ける形）。

   かんたんルール:
     - 136枚（萬子・筒子・索子 1〜9、字牌 7種 × 4枚）。赤ドラ・ドラ・王牌なし
     - 3枚の組 × 4 ＋ 同じ2枚（あたま）で「あがり」。同じ2枚 × 7組（七対子）も、設定であがりにできる
     - 役・点数・リーチ・フリテンなし。ポン・チーは設定で切れる。カンはしない（4枚目は持っておくか捨てる）
     - 山がなくなったら引き分け（流局）

   牌の番号: id 0〜135、種類 kind = floor(id / 4)
     kind 0〜8 萬子 1〜9、9〜17 筒子 1〜9、18〜26 索子 1〜9、27〜33 東 南 西 北 白 發 中 */
(function (root) {
  'use strict';

  const KINDS = 34;
  const SUITS = ['m', 'p', 's', 'z'];
  const HONOR_NAMES = ['東', '南', '西', '北', '白', '發', '中'];
  const NUM_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const SUIT_NAMES = { m: '萬子', p: '筒子', s: '索子', z: '字牌' };

  const kindOf = (id) => Math.floor(id / 4);
  const suitOf = (k) => SUITS[Math.floor(k / 9)];
  const numOf = (k) => (k < 27 ? (k % 9) + 1 : 0);
  const isHonor = (k) => k >= 27;
  const isTerminal = (k) => k < 27 && (k % 9 === 0 || k % 9 === 8);

  function kindName(k) {
    if (k >= 27) return HONOR_NAMES[k - 27];
    const n = numOf(k);
    if (suitOf(k) === 'm') return NUM_KANJI[n - 1] + '萬';
    if (suitOf(k) === 'p') return n + '筒';
    return n + '索';
  }

  // ── 乱数（種から決まる。ルームで同じ山を作れるように） ──
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function counts(ids) {
    const c = new Array(KINDS).fill(0);
    for (const id of ids) c[kindOf(id)] += 1;
    return c;
  }

  // ── あと何枚か（向聴数）。-1 = あがり、0 = あと1枚（テンパイ） ──
  function shantenRegular(c, open) {
    const cc = c.slice();
    let best = 8;
    function dfs(i, m, t, p) {
      while (i < KINDS && cc[i] === 0) i += 1;
      if (i >= KINDS) {
        const tt = Math.min(t, 4 - m);
        const s = 8 - 2 * m - tt - p;
        if (s < best) best = s;
        return;
      }
      const suited = i < 27;
      const n = i % 9;
      if (cc[i] >= 3) { cc[i] -= 3; dfs(i, m + 1, t, p); cc[i] += 3; }
      if (suited && n <= 6 && cc[i + 1] && cc[i + 2]) {
        cc[i] -= 1; cc[i + 1] -= 1; cc[i + 2] -= 1;
        dfs(i, m + 1, t, p);
        cc[i] += 1; cc[i + 1] += 1; cc[i + 2] += 1;
      }
      if (cc[i] >= 2 && !p) { cc[i] -= 2; dfs(i, m, t, 1); cc[i] += 2; }
      if (m + t < 4) {
        if (cc[i] >= 2) { cc[i] -= 2; dfs(i, m, t + 1, p); cc[i] += 2; }
        if (suited && n <= 7 && cc[i + 1]) { cc[i] -= 1; cc[i + 1] -= 1; dfs(i, m, t + 1, p); cc[i] += 1; cc[i + 1] += 1; }
        if (suited && n <= 6 && cc[i + 2]) { cc[i] -= 1; cc[i + 2] -= 1; dfs(i, m, t + 1, p); cc[i] += 1; cc[i + 2] += 1; }
      }
      cc[i] -= 1; dfs(i + 1, m, t, p); cc[i] += 1;
    }
    dfs(0, open, 0, 0);
    return best;
  }

  function shantenPairs(c) {
    let pairs = 0;
    let kinds = 0;
    for (let k = 0; k < KINDS; k += 1) {
      if (c[k] > 0) kinds += 1;
      if (c[k] >= 2) pairs += 1;
    }
    return 6 - pairs + Math.max(0, 7 - kinds);
  }

  function shanten(c, open, opts) {
    let s = shantenRegular(c, open);
    if (open === 0 && opts && opts.chiitoi) s = Math.min(s, shantenPairs(c));
    return s;
  }

  // あがりの形を組に分ける（見せる用）。分けられなければ null
  function decompose(c, open, opts) {
    const total = c.reduce((a, b) => a + b, 0);
    if (total !== 14 - open * 3) return null;
    const cc = c.slice();
    const groups = [];
    function melds(i, need) {
      while (i < KINDS && cc[i] === 0) i += 1;
      if (need === 0) return i >= KINDS;
      if (i >= KINDS) return false;
      if (cc[i] >= 3) {
        cc[i] -= 3; groups.push({ type: 'set', kinds: [i, i, i] });
        if (melds(i, need - 1)) return true;
        groups.pop(); cc[i] += 3;
      }
      if (i < 27 && i % 9 <= 6 && cc[i + 1] && cc[i + 2]) {
        cc[i] -= 1; cc[i + 1] -= 1; cc[i + 2] -= 1; groups.push({ type: 'run', kinds: [i, i + 1, i + 2] });
        if (melds(i, need - 1)) return true;
        groups.pop(); cc[i] += 1; cc[i + 1] += 1; cc[i + 2] += 1;
      }
      return false;
    }
    for (let k = 0; k < KINDS; k += 1) {
      if (cc[k] < 2) continue;
      cc[k] -= 2;
      groups.length = 0;
      groups.push({ type: 'pair', kinds: [k, k] });
      if (melds(0, 4 - open)) return { form: 'regular', groups: groups.slice() };
      cc[k] += 2;
    }
    if (open === 0 && opts && opts.chiitoi && c.filter((n) => n === 2).length === 7) {
      const g = [];
      for (let k = 0; k < KINDS; k += 1) if (c[k] === 2) g.push({ type: 'pair', kinds: [k, k] });
      return { form: 'pairs', groups: g };
    }
    return null;
  }

  // テンパイのときの待ち（手が 13 − 3×鳴き の枚数のとき）
  function waits(c, open, opts) {
    const out = [];
    for (let k = 0; k < KINDS; k += 1) {
      if (c[k] >= 4) continue;
      c[k] += 1;
      if (shanten(c, open, opts) === -1) out.push(k);
      c[k] -= 1;
    }
    return out;
  }

  // ── 局 ──
  function createRound(o) {
    const opts = { calls: o.calls !== false, chiitoi: o.chiitoi !== false, level: o.level === 'normal' ? 'normal' : 'easy' };
    const r = rng(o.seed);
    const wall = [];
    for (let i = 0; i < 136; i += 1) wall.push(i);
    for (let i = wall.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      const t = wall[i]; wall[i] = wall[j]; wall[j] = t;
    }
    const seats = o.seats.map((s) => ({ name: s.name, cpu: !!s.cpu, hand: [], melds: [], river: [] }));
    const dealer = o.dealer || 0;
    for (let n = 0; n < 13; n += 1) {
      for (let s = 0; s < 4; s += 1) seats[(dealer + s) % 4].hand.push(wall.pop());
    }
    for (const s of seats) s.hand.sort((a, b) => a - b);
    const S = {
      // rev: 操作のたびに1つ増える。disc: 捨てた回数（ロン・ポン・チーの答えが、どの捨て牌へのものかを確かめる）
      rev: 0, disc: 0, seed: o.seed, opts, dealer, wall, seats,
      turn: dealer, phase: 'discard', drawn: null,
      last: null, pending: null, result: null, log: [],
    };
    draw(S, dealer);
    return S;
  }

  function draw(S, seat) {
    if (S.wall.length === 0) {
      S.phase = 'end';
      S.result = { type: 'draw' };
      S.log.push({ t: 'draw-game' });
      return;
    }
    const id = S.wall.pop();
    S.seats[seat].hand.push(id);
    S.turn = seat;
    S.drawn = id;
    S.phase = 'discard';
  }

  const clone = (S) => JSON.parse(JSON.stringify(S));
  const handCounts = (S, seat) => counts(S.seats[seat].hand);
  const openCount = (S, seat) => S.seats[seat].melds.length;

  function canTsumo(S, seat) {
    if (S.phase !== 'discard' || S.turn !== seat || S.drawn === null) return false;
    return shanten(handCounts(S, seat), openCount(S, seat), S.opts) === -1;
  }

  // 捨てた牌に、ほかの人ができること
  function claimOptions(S, seat) {
    const L = S.last;
    if (!L || L.seat === seat) return null;
    const k = kindOf(L.id);
    const hand = S.seats[seat].hand;
    const c = counts(hand);
    const o = { ron: false, pon: [], chi: [] };
    c[k] += 1;
    o.ron = shanten(c, openCount(S, seat), S.opts) === -1;
    c[k] -= 1;
    if (S.opts.calls && S.wall.length > 0) {
      const same = hand.filter((id) => kindOf(id) === k);
      if (same.length >= 2) o.pon.push([same[0], same[1]]);
      if ((L.seat + 1) % 4 === seat && k < 27) {
        const n = k % 9;
        const pick = (kk) => hand.find((id) => kindOf(id) === kk);
        const tryPair = (a, b) => {
          const x = pick(a); const y = pick(b);
          if (x !== undefined && y !== undefined) o.chi.push([x, y]);
        };
        if (n >= 2) tryPair(k - 2, k - 1);
        if (n >= 1 && n <= 7) tryPair(k - 1, k + 1);
        if (n <= 6) tryPair(k + 1, k + 2);
      }
    }
    if (!o.ron && !o.pon.length && !o.chi.length) return null;
    return o;
  }

  function nextAfterDiscard(S) {
    const pending = {};
    let any = false;
    for (let s = 0; s < 4; s += 1) {
      const o = claimOptions(S, s);
      if (o) { pending[s] = { options: o, answer: null }; any = true; }
    }
    if (any) {
      S.phase = 'claim';
      S.pending = pending;
    } else {
      S.pending = null;
      draw(S, (S.last.seat + 1) % 4);
    }
  }

  function finishWin(S, seat, type, from, tileId) {
    const c = handCounts(S, seat);
    if (type === 'ron') c[kindOf(tileId)] += 1;
    S.phase = 'end';
    S.result = {
      type, winner: seat, from, tile: tileId,
      shape: decompose(c, openCount(S, seat), S.opts),
    };
    S.log.push({ t: type, seat, from });
  }

  function resolveClaims(S) {
    const P = S.pending;
    const from = S.last.seat;
    const order = [1, 2, 3].map((d) => (from + d) % 4);
    const answered = (type) => order.find((s) => P[s] && P[s].answer && P[s].answer.type === type);
    const ron = answered('ron');
    const pon = answered('pon');
    const chi = answered('chi');
    const id = S.last.id;
    S.pending = null;
    if (ron !== undefined) { finishWin(S, ron, 'ron', from, id); return; }
    const caller = pon !== undefined ? pon : chi;
    if (caller !== undefined) {
      const a = P[caller].answer;
      const me = S.seats[caller];
      me.hand = me.hand.filter((x) => !a.tiles.includes(x));
      const river = S.seats[from].river;
      river[river.length - 1].called = true;
      me.melds.push({ type: a.type, tiles: a.tiles.concat([id]).sort((x, y) => x - y), called: id, from });
      S.turn = caller;
      S.drawn = null;
      S.phase = 'discard';
      S.log.push({ t: a.type, seat: caller, from });
      return;
    }
    draw(S, (from + 1) % 4);
  }

  // 1つの操作をあてる。できない操作は Error。もとの状態は変えずに新しい状態を返す
  function act(S0, seat, a) {
    const S = clone(S0);
    if (S.phase === 'end') throw new Error('round ended');
    if (a.type === 'tsumo') {
      if (!canTsumo(S, seat)) throw new Error('cannot tsumo');
      finishWin(S, seat, 'tsumo', seat, S.drawn);
    } else if (a.type === 'discard') {
      if (S.phase !== 'discard' || S.turn !== seat) throw new Error('not your turn');
      const me = S.seats[seat];
      const i = me.hand.indexOf(a.id);
      if (i < 0) throw new Error('no such tile');
      me.hand.splice(i, 1);
      me.hand.sort((x, y) => x - y);
      me.river.push({ id: a.id, called: false });
      S.last = { seat, id: a.id };
      S.disc += 1;
      S.drawn = null;
      S.log.push({ t: 'discard', seat, id: a.id });
      nextAfterDiscard(S);
    } else if (['ron', 'pon', 'chi', 'pass'].includes(a.type)) {
      if (S.phase !== 'claim' || !S.pending[seat] || S.pending[seat].answer) throw new Error('cannot claim');
      const o = S.pending[seat].options;
      if (a.type === 'ron' && !o.ron) throw new Error('cannot ron');
      if (a.type === 'pon' || a.type === 'chi') {
        const ok = o[a.type].some((p) => p[0] === a.tiles[0] && p[1] === a.tiles[1]);
        if (!ok) throw new Error('cannot ' + a.type);
      }
      S.pending[seat].answer = a.type === 'pass' ? { type: 'pass' } : { type: a.type, tiles: a.tiles || null };
      // 答えられる人が全員答えたら決める（ロン → ポン → チー。同じなら捨てた人の次に近い人）
      const all = Object.keys(S.pending).every((s) => S.pending[s].answer);
      if (all) resolveClaims(S);
    } else {
      throw new Error('unknown action');
    }
    S.rev += 1;
    return S;
  }

  // ── 見えている牌と、捨てる牌のヒント ──
  function visibleCounts(S, seat) {
    const c = counts(S.seats[seat].hand);
    for (const s of S.seats) {
      for (const r of s.river) if (!r.called) c[kindOf(r.id)] += 1;
      for (const m of s.melds) for (const id of m.tiles) c[kindOf(id)] += 1;
    }
    return c;
  }

  // 手の中の牌それぞれを捨てたときの、あと何枚と、受け入れの枚数
  function discardAdvice(S, seat) {
    const hand = S.seats[seat].hand;
    const open = openCount(S, seat);
    const c = counts(hand);
    const seen = visibleCounts(S, seat);
    const byKind = {};
    for (const id of hand) {
      const k = kindOf(id);
      if (byKind[k]) continue;
      c[k] -= 1;
      const sh = shanten(c, open, S.opts);
      let accept = 0;
      for (let d = 0; d < KINDS; d += 1) {
        const left = 4 - seen[d];
        if (left <= 0) continue;
        c[d] += 1;
        if (shanten(c, open, S.opts) < sh) accept += left;
        c[d] -= 1;
      }
      c[k] += 1;
      byKind[k] = { kind: k, shanten: sh, accept };
    }
    const list = Object.values(byKind);
    const bestSh = Math.min(...list.map((x) => x.shanten));
    const bestAcc = Math.max(...list.filter((x) => x.shanten === bestSh).map((x) => x.accept));
    for (const x of list) x.best = x.shanten === bestSh && x.accept === bestAcc;
    return { list, shanten: bestSh };
  }

  // 今の手（捨てる前・あとの両方で使える）が、あと何枚か
  function handShanten(S, seat) {
    return shanten(handCounts(S, seat), openCount(S, seat), S.opts);
  }

  function handWaits(S, seat) {
    const c = handCounts(S, seat);
    const open = openCount(S, seat);
    if (c.reduce((a, b) => a + b, 0) !== 13 - open * 3) return [];
    return waits(c, open, S.opts);
  }

  // ── コンピューター ──
  // 捨てる: あと何枚が少なく、受け入れが多い牌。同じなら字牌・はしの牌から
  // やさしい: 受け入れの枚数は見ずに、あと何枚が増えない牌から（種と手番で決まる）えらぶ
  function cpuDiscard(S, seat) {
    const all = discardAdvice(S, seat).list;
    let adv = all.filter((x) => x.best);
    if (S.opts.level === 'easy') {
      const minSh = Math.min(...all.map((x) => x.shanten));
      const pool = all.filter((x) => x.shanten === minSh);
      const r = rng(S.seed * 31 + S.rev * 7 + seat)();
      adv = [pool[Math.floor(r * pool.length)]];
    }
    adv.sort((a, b) => edge(b.kind) - edge(a.kind));
    const k = adv[0].kind;
    const hand = S.seats[seat].hand;
    // 引いた牌が同じ種類なら、それを捨てる（見た目に分かりやすい）
    if (S.drawn !== null && kindOf(S.drawn) === k) return S.drawn;
    return hand.filter((id) => kindOf(id) === k).pop();
  }
  function edge(k) {
    if (isHonor(k)) return 3;
    if (isTerminal(k)) return 2;
    const n = k % 9;
    return n === 1 || n === 7 ? 1 : 0;
  }

  function cpuAction(S, seat) {
    if (S.phase === 'discard' && S.turn === seat) {
      if (canTsumo(S, seat)) return { type: 'tsumo' };
      return { type: 'discard', id: cpuDiscard(S, seat) };
    }
    if (S.phase === 'claim' && S.pending && S.pending[seat] && !S.pending[seat].answer) {
      const o = S.pending[seat].options;
      if (o.ron) return { type: 'ron' };
      // 鳴いたあと、いちばんよく捨てたときに、あと何枚が減るなら鳴く
      const before = handShanten(S, seat);
      const tryCall = (tiles) => {
        const c = handCounts(S, seat);
        for (const id of tiles) c[kindOf(id)] -= 1;
        let best = 9;
        for (let d = 0; d < KINDS; d += 1) {
          if (!c[d]) continue;
          c[d] -= 1;
          best = Math.min(best, shanten(c, openCount(S, seat) + 1, S.opts));
          c[d] += 1;
        }
        return best;
      };
      // コンピューターはチーをしない（鳴きが多いと、すぐに局が終わる）。やさしいではポンもしない
      if (S.opts.level !== 'easy') {
        for (const p of o.pon) if (tryCall(p) < before) return { type: 'pon', tiles: p };
      }
      return { type: 'pass' };
    }
    return null;
  }

  // 人の番を待っているか（画面が CPU を動かすのをやめる目安）
  function waitingFor(S) {
    if (S.phase === 'discard') return [S.turn];
    if (S.phase === 'claim') return Object.keys(S.pending).filter((s) => !S.pending[s].answer).map(Number);
    return [];
  }

  const api = {
    KINDS, SUIT_NAMES, kindOf, suitOf, numOf, isHonor, kindName, counts,
    shanten, shantenRegular, shantenPairs, decompose, waits,
    createRound, act, canTsumo, claimOptions, visibleCounts,
    discardAdvice, handShanten, handWaits, cpuAction, waitingFor,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MahjongEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
