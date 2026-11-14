/* 麻雀 — ルール
   画面と通信に触らない。ブラウザでは window.MahjongEngine、node では module.exports。
   状態は JSON にできる値だけで持つ（本体にするとき、そのままルームに置ける形）。

   かんたんルール:
     - 136枚（萬子・筒子・索子 1〜9、字牌 7種 × 4枚）。赤ドラ・ドラ・王牌なし
     - 3枚の組 × 4 ＋ 同じ2枚（あたま）で「あがり」。同じ2枚 × 7組（七対子）も、設定であがりにできる
     - 役・点数・リーチ・フリテンなし。ポン・チーは設定で切れる。カンはしない（4枚目は持っておくか捨てる）
     - 山がなくなったら引き分け（流局）

   役ありルール（opts.rule === 'yaku'。2026-11-14 オーナー決定: 点数は出さず役の名前と翻数だけ・リーチあり・
   フリテン／ドラ／カンは本家どおり）:
     - 役が1つ以上ないとあがれない（ドラは役に数えない）。役の判定は yaku.js
     - 王牌14枚（嶺上牌4・ドラ表示牌5・裏ドラ表示牌5）。カンのたびに嶺上牌を引き、カンドラを1枚めくる
       （暗槓はすぐ、明槓・加槓は次に捨てたとき）
     - リーチ（門前・テンパイ・山が4枚以上）、一発、ダブル立直、フリテン（自分の捨て牌・見逃し・リーチ後の見逃し）
     - 暗槓・明槓・加槓（槍槓）。喰い替えはできない
     - 途中流局: 九種九牌（宣言）・四風連打・四家立直・四槓散了
     - 場風（東場4局→南場4局）と自風。親は、あがるかテンパイで続ける（局の進め方は画面の側）

   牌の番号: id 0〜135、種類 kind = floor(id / 4)
     kind 0〜8 萬子 1〜9、9〜17 筒子 1〜9、18〜26 索子 1〜9、27〜33 東 南 西 北 白 發 中 */
(function (root) {
  'use strict';

  const Y = typeof module !== 'undefined' && module.exports ? require('./yaku.js') : root.MahjongYaku;
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

  function shantenKokushi(c) {
    let kinds = 0;
    let pair = 0;
    for (const k of Y.ORPHANS) {
      if (c[k] > 0) kinds += 1;
      if (c[k] >= 2) pair = 1;
    }
    return 13 - kinds - pair;
  }

  function shanten(c, open, opts) {
    let s = shantenRegular(c, open);
    if (open === 0 && opts && opts.chiitoi) s = Math.min(s, shantenPairs(c));
    if (open === 0 && opts && opts.kokushi) s = Math.min(s, shantenKokushi(c));
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

  // 手の中で、もうそろっている組（3枚の組と同じ2枚）を見つける（見せる用。あがっていない手でも使う）。
  // 3枚の組を3点、同じ2枚を2点として、点がいちばん多い分け方。同じ点なら3枚の組が多いほう
  // 返り値: [{ type: 'set' | 'run' | 'pair', kinds: [...] }]（組に入らなかった牌はふくまない）
  function groupHand(c) {
    const cc = c.slice();
    let best = { score: -1, melds: -1, groups: [] };
    const cur = [];
    function dfs(i, score, melds) {
      while (i < KINDS && cc[i] === 0) i += 1;
      if (i >= KINDS) {
        if (score > best.score || (score === best.score && melds > best.melds)) best = { score, melds, groups: cur.slice() };
        return;
      }
      if (cc[i] >= 3) {
        cc[i] -= 3; cur.push({ type: 'set', kinds: [i, i, i] });
        dfs(i, score + 3, melds + 1);
        cur.pop(); cc[i] += 3;
      }
      if (i < 27 && i % 9 <= 6 && cc[i + 1] && cc[i + 2]) {
        cc[i] -= 1; cc[i + 1] -= 1; cc[i + 2] -= 1; cur.push({ type: 'run', kinds: [i, i + 1, i + 2] });
        dfs(i, score + 3, melds + 1);
        cur.pop(); cc[i] += 1; cc[i + 1] += 1; cc[i + 2] += 1;
      }
      if (cc[i] >= 2) {
        cc[i] -= 2; cur.push({ type: 'pair', kinds: [i, i] });
        dfs(i, score + 2, melds);
        cur.pop(); cc[i] += 2;
      }
      cc[i] -= 1; dfs(i, score, melds); cc[i] += 1;
    }
    dfs(0, 0, 0);
    return best.groups;
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
  const isYaku = (S) => S.opts.rule === 'yaku';

  function createRound(o) {
    const yaku = o.rule === 'yaku';
    const opts = {
      rule: yaku ? 'yaku' : 'simple',
      calls: o.calls !== false,
      // 役ありでは七対子・国士無双はいつもあがりの形
      chiitoi: yaku || o.chiitoi !== false,
      kokushi: yaku,
      level: o.level === 'normal' ? 'normal' : 'easy',
    };
    const r = rng(o.seed);
    const wall = [];
    for (let i = 0; i < 136; i += 1) wall.push(i);
    for (let i = wall.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      const t = wall[i]; wall[i] = wall[j]; wall[j] = t;
    }
    // 王牌（役ありだけ）: 嶺上牌4・ドラ表示牌5・裏ドラ表示牌5
    const dead = yaku ? { rinshan: wall.splice(0, 4), dora: wall.splice(0, 5), ura: wall.splice(0, 5) } : null;
    const seats = o.seats.map((s) => ({
      name: s.name, cpu: !!s.cpu, hand: [], melds: [], river: [],
      riichi: null, ippatsu: false, furitenTemp: false, furitenRiichi: false,
    }));
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
      roundWind: o.roundWind >= 27 && o.roundWind <= 30 ? o.roundWind : 27,
      dead, doraN: yaku ? 1 : 0, pendDora: 0, kans: 0, kanBy: [],
      noCall: true, rinshanDraw: false, kuikae: [], claim: null, chankan: null,
    };
    draw(S, dealer);
    return S;
  }

  const clone = (S) => JSON.parse(JSON.stringify(S));
  const handCounts = (S, seat) => counts(S.seats[seat].hand);
  const openCount = (S, seat) => S.seats[seat].melds.length;
  const isMenzen = (S, seat) => S.seats[seat].melds.every((m) => m.type === 'ankan');
  const seatWind = (S, seat) => 27 + ((seat - S.dealer + 4) % 4);
  // その人の最初のツモ（まだ捨てておらず、だれも鳴いていない）
  const firstTurn = (S, seat) => S.noCall && S.seats[seat].river.length === 0;
  const doraKinds = (S, list) => list.slice(0, S.doraN).map((id) => Y.doraOf(kindOf(id)));

  // 山から1枚引く（rinshan: カンのあとの嶺上牌）。山がなければ流局
  function draw(S, seat, rinshan) {
    if (!rinshan && S.wall.length === 0) {
      endDraw(S);
      return;
    }
    let id;
    if (rinshan) {
      id = S.dead.rinshan.shift();
      // 王牌は14枚のまま（山のいちばん奥の1枚を王牌へ回す。海底がひとつ手前になる）
      S.dead.rinshan.push(S.wall.shift());
    } else {
      id = S.wall.pop();
    }
    S.seats[seat].hand.push(id);
    S.seats[seat].furitenTemp = false;
    S.turn = seat;
    S.drawn = id;
    S.rinshanDraw = !!rinshan;
    S.phase = 'discard';
  }

  function endDraw(S) {
    S.phase = 'end';
    const tenpai = [0, 1, 2, 3].filter((s) => waits(handCounts(S, s), openCount(S, s), S.opts).length > 0);
    S.result = { type: 'draw', tenpai };
    S.log.push({ t: 'draw-game' });
  }

  function endAbort(S, reason) {
    S.phase = 'end';
    S.result = { type: 'abort', reason };
    S.log.push({ t: 'abort', reason });
  }

  // 役の判定に渡す形をつくる。how: 'tsumo' | 'ron' | 'chankan'
  function yakuContext(S, seat, winId, how) {
    const me = S.seats[seat];
    const c = counts(me.hand);
    const allIds = me.hand.slice();
    if (how !== 'tsumo') { c[kindOf(winId)] += 1; allIds.push(winId); }
    const melds = me.melds.map((m) => {
      const k = Math.min(...m.tiles.map(kindOf));
      if (m.type === 'chi') return { t: 'run', k, open: true };
      if (m.type === 'pon') return { t: 'set', k, open: true };
      return { t: 'kan', k, open: m.type !== 'ankan' };
    });
    me.melds.forEach((m) => allIds.push(...m.tiles));
    const tsumo = how === 'tsumo';
    const first = tsumo && firstTurn(S, seat);
    return {
      c, melds, win: kindOf(winId), tsumo,
      seatWind: seatWind(S, seat), roundWind: S.roundWind,
      riichi: !!me.riichi, double: !!(me.riichi && me.riichi.double), ippatsu: !!(me.riichi && me.ippatsu),
      rinshan: tsumo && S.rinshanDraw, chankan: how === 'chankan',
      haitei: tsumo && !S.rinshanDraw && S.wall.length === 0,
      houtei: how === 'ron' && S.wall.length === 0,
      tenhou: first && seat === S.dealer, chiihou: first && seat !== S.dealer,
      dora: doraKinds(S, S.dead.dora), ura: doraKinds(S, S.dead.ura), all: counts(allIds),
    };
  }

  // あがれるか。かんたんルールは形だけ、役ありは役の判定の結果（役がなければ null）
  function winEval(S, seat, winId, how) {
    const c = handCounts(S, seat);
    if (how !== 'tsumo') c[kindOf(winId)] += 1;
    if (shanten(c, openCount(S, seat), S.opts) !== -1) return null;
    if (!isYaku(S)) return { simple: true };
    return Y.evaluate(yakuContext(S, seat, winId, how));
  }

  function canTsumo(S, seat) {
    if (S.phase !== 'discard' || S.turn !== seat || S.drawn === null) return false;
    return !!winEval(S, seat, S.drawn, 'tsumo');
  }

  // テンパイの形のときの待ち（手が 13 − 3×鳴き の枚数のとき）
  function shapeWaits(S, seat) {
    const c = handCounts(S, seat);
    if (c.reduce((a, b) => a + b, 0) !== 13 - openCount(S, seat) * 3) return [];
    return waits(c, openCount(S, seat), S.opts);
  }

  // フリテン（役ありだけ）: 待ちの牌を自分で捨てている・見逃した・リーチのあとに見逃した
  function furiten(S, seat) {
    if (!isYaku(S)) return false;
    const me = S.seats[seat];
    if (me.furitenTemp || me.furitenRiichi) return true;
    const ws = shapeWaits(S, seat);
    return me.river.some((r) => ws.includes(kindOf(r.id)));
  }

  // 鳴いたあとに捨てられる牌が残るか（喰い替えの禁止）
  function hasLegalDiscard(handIds, forbidden) {
    return handIds.some((id) => !forbidden.includes(kindOf(id)));
  }

  // 捨てた牌（または加槓の牌）に、ほかの人ができること
  function claimOptions(S, seat) {
    const yaku = isYaku(S);
    if (S.claim === 'chankan') {
      const C = S.chankan;
      if (C.seat === seat) return null;
      const ok = !!winEval(S, seat, C.id, 'chankan') && !furiten(S, seat);
      return ok ? { ron: true, pon: [], chi: [], minkan: [] } : null;
    }
    const L = S.last;
    if (!L || L.seat === seat) return null;
    const k = kindOf(L.id);
    const me = S.seats[seat];
    const hand = me.hand;
    const o = { ron: false, pon: [], chi: [], minkan: [] };
    o.ron = !!winEval(S, seat, L.id, 'ron') && !furiten(S, seat);
    if (S.opts.calls && S.wall.length > 0 && !(yaku && me.riichi)) {
      const same = hand.filter((id) => kindOf(id) === k);
      if (same.length >= 2) {
        const rest = hand.filter((id) => id !== same[0] && id !== same[1]);
        if (!yaku || hasLegalDiscard(rest, [k])) o.pon.push([same[0], same[1]]);
      }
      if (yaku && same.length === 3 && S.kans < 4) o.minkan.push(same.slice(0, 3));
      if ((L.seat + 1) % 4 === seat && k < 27) {
        const n = k % 9;
        const pick = (kk) => hand.find((id) => kindOf(id) === kk);
        const tryPair = (a, b, swap) => {
          const x = pick(a); const y = pick(b);
          if (x === undefined || y === undefined) return;
          const rest = hand.filter((id) => id !== x && id !== y);
          const forbidden = [k].concat(swap !== null && swap >= k - n && swap <= k - n + 8 ? [swap] : []);
          if (!yaku || hasLegalDiscard(rest, forbidden)) o.chi.push([x, y]);
        };
        if (n >= 2) tryPair(k - 2, k - 1, n >= 3 ? k - 3 : null);
        if (n >= 1 && n <= 7) tryPair(k - 1, k + 1, null);
        if (n <= 6) tryPair(k + 1, k + 2, n <= 5 ? k + 3 : null);
      }
    }
    if (!o.ron && !o.pon.length && !o.chi.length && !o.minkan.length) return null;
    return o;
  }

  function openClaims(S, kind) {
    const pending = {};
    let any = false;
    S.claim = kind;
    for (let s = 0; s < 4; s += 1) {
      const o = claimOptions(S, s);
      if (o) { pending[s] = { options: o, answer: null }; any = true; }
    }
    if (any) {
      S.phase = 'claim';
      S.pending = pending;
      return true;
    }
    S.claim = null;
    S.pending = null;
    return false;
  }

  // 捨て牌・加槓の牌で、だれもロンしなかったときの見逃し（待ちの牌が通った人はフリテン）
  function markPassed(S, kind, from) {
    if (!isYaku(S)) return;
    for (let s = 0; s < 4; s += 1) {
      if (s === from) continue;
      if (!shapeWaits(S, s).includes(kind)) continue;
      S.seats[s].furitenTemp = true;
      if (S.seats[s].riichi) S.seats[s].furitenRiichi = true;
    }
  }

  // 途中流局（役ありだけ。九種九牌は宣言なので別）
  function abortReason(S) {
    if (!isYaku(S)) return null;
    if (S.disc === 4 && S.noCall && S.seats.every((x) => x.river.length === 1)) {
      const k = kindOf(S.seats[0].river[0].id);
      if (k >= 27 && k <= 30 && S.seats.every((x) => kindOf(x.river[0].id) === k)) return '四風連打';
    }
    if (S.seats.every((x) => x.riichi)) return '四家立直';
    if (S.kans === 4 && new Set(S.kanBy).size > 1) return '四槓散了';
    return null;
  }

  // 捨て牌がだれにも取られなかった（またはポン・チー・カンの前）
  function passedDiscard(S) {
    markPassed(S, kindOf(S.last.id), S.last.seat);
    const reason = abortReason(S);
    if (reason) { endAbort(S, reason); return true; }
    return false;
  }

  function nextAfterDiscard(S) {
    if (openClaims(S, 'discard')) return;
    if (passedDiscard(S)) return;
    draw(S, (S.last.seat + 1) % 4);
  }

  function finishWin(S, seat, type, from, tileId, how) {
    const c = handCounts(S, seat);
    if (type === 'ron') c[kindOf(tileId)] += 1;
    const ev = isYaku(S) ? winEval(S, seat, tileId, how || (type === 'tsumo' ? 'tsumo' : 'ron')) : null;
    let shape = decompose(c, openCount(S, seat), S.opts);
    if (!shape) {
      // 国士無双など、組に分けられない形
      const ks = [];
      for (let k = 0; k < KINDS; k += 1) for (let n = 0; n < c[k]; n += 1) ks.push(k);
      shape = { form: 'other', groups: [{ type: 'all', kinds: ks }] };
    }
    S.phase = 'end';
    S.result = {
      type, winner: seat, from, tile: tileId, shape,
      chankan: how === 'chankan',
      yaku: ev && !ev.simple ? ev : null,
      dora: isYaku(S) ? S.dead.dora.slice(0, S.doraN) : [],
      ura: isYaku(S) && S.seats[seat].riichi ? S.dead.ura.slice(0, S.doraN) : [],
    };
    S.log.push({ t: type, seat, from });
  }

  // 鳴き・カンがあったら、一発と「最初の一巡」はなくなる
  function breakFirst(S) {
    S.noCall = false;
    S.seats.forEach((x) => { x.ippatsu = false; });
  }

  function addKan(S, seat) {
    S.kans += 1;
    S.kanBy.push(seat);
  }

  function resolveClaims(S) {
    const P = S.pending;
    const chank = S.claim === 'chankan';
    const from = chank ? S.chankan.seat : S.last.seat;
    const id = chank ? S.chankan.id : S.last.id;
    const order = [1, 2, 3].map((d) => (from + d) % 4);
    const answered = (type) => order.find((s) => P[s] && P[s].answer && P[s].answer.type === type);
    const ron = answered('ron');
    S.pending = null;
    S.claim = null;
    if (ron !== undefined) { finishWin(S, ron, 'ron', from, id, chank ? 'chankan' : 'ron'); return; }
    if (chank) {
      markPassed(S, kindOf(id), from);
      completeKakan(S, from);
      return;
    }
    if (passedDiscard(S)) return;
    const big = answered('minkan') !== undefined ? answered('minkan') : answered('pon');
    const caller = big !== undefined ? big : answered('chi');
    if (caller === undefined) { draw(S, (from + 1) % 4); return; }
    const a = P[caller].answer;
    const me = S.seats[caller];
    me.hand = me.hand.filter((x) => !a.tiles.includes(x));
    const river = S.seats[from].river;
    river[river.length - 1].called = true;
    me.melds.push({ type: a.type, tiles: a.tiles.concat([id]).sort((x, y) => x - y), called: id, from });
    S.log.push({ t: a.type, seat: caller, from });
    if (isYaku(S)) breakFirst(S);
    if (a.type === 'minkan') {
      addKan(S, caller);
      S.pendDora += 1;
      draw(S, caller, true);
      return;
    }
    S.turn = caller;
    S.drawn = null;
    S.rinshanDraw = false;
    S.phase = 'discard';
    if (isYaku(S)) {
      // 喰い替えの禁止: 鳴いた牌と同じ種類、チーでは筋の反対側も、すぐには捨てられない
      const k = kindOf(id);
      const forb = [k];
      if (a.type === 'chi') {
        const ks = a.tiles.map(kindOf).sort((x, y) => x - y);
        if (ks[0] === k + 1 && (k % 9) <= 5) forb.push(k + 3);
        if (ks[1] === k - 1 && (k % 9) >= 3) forb.push(k - 3);
      }
      S.kuikae = forb;
    }
  }

  function completeKakan(S, seat) {
    S.chankan = null;
    addKan(S, seat);
    breakFirst(S);
    S.pendDora += 1;
    draw(S, seat, true);
  }

  // カンできる牌（役ありだけ）。暗槓: 手に4枚、加槓: ポンした牌の4枚目
  function kanOptions(S, seat) {
    const out = { ankan: [], kakan: [] };
    if (!isYaku(S) || S.phase !== 'discard' || S.turn !== seat || S.drawn === null) return out;
    if (S.kans >= 4 || S.wall.length === 0) return out;
    const me = S.seats[seat];
    const c = handCounts(S, seat);
    for (let k = 0; k < KINDS; k += 1) {
      if (c[k] !== 4) continue;
      if (me.riichi) {
        // リーチのあとは、引いた牌で、待ちが変わらないときだけ
        if (kindOf(S.drawn) !== k) continue;
        const before = counts(me.hand.filter((x) => x !== S.drawn));
        const after = c.slice(); after[k] = 0;
        const w1 = waits(before, me.melds.length, S.opts).join();
        const w2 = waits(after, me.melds.length + 1, S.opts).join();
        if (!w1 || w1 !== w2) continue;
      }
      out.ankan.push(k);
    }
    if (!me.riichi) {
      me.melds.forEach((m) => {
        if (m.type !== 'pon') return;
        const k = kindOf(m.tiles[0]);
        if (c[k] >= 1) out.kakan.push(k);
      });
    }
    return out;
  }

  // リーチできる捨て牌（門前・まだリーチしていない・山が4枚以上・捨てたあとテンパイ）
  function riichiOptions(S, seat) {
    if (!isYaku(S) || S.phase !== 'discard' || S.turn !== seat || S.drawn === null) return [];
    const me = S.seats[seat];
    if (me.riichi || !isMenzen(S, seat) || S.wall.length < 4) return [];
    const c = handCounts(S, seat);
    const okKind = {};
    for (let k = 0; k < KINDS; k += 1) {
      if (!c[k]) continue;
      c[k] -= 1;
      okKind[k] = shanten(c, openCount(S, seat), S.opts) === 0;
      c[k] += 1;
    }
    return me.hand.filter((id) => okKind[kindOf(id)]);
  }

  // 九種九牌（最初のツモで、么九牌が9種類以上）
  function canKyushu(S, seat) {
    if (!isYaku(S) || S.phase !== 'discard' || S.turn !== seat || !firstTurn(S, seat)) return false;
    const c = handCounts(S, seat);
    return Y.ORPHANS.filter((k) => c[k] > 0).length >= 9;
  }

  // 1つの操作をあてる。できない操作は Error。もとの状態は変えずに新しい状態を返す
  function act(S0, seat, a) {
    const S = clone(S0);
    if (S.phase === 'end') throw new Error('round ended');
    const yaku = isYaku(S);
    const me = S.seats[seat];
    if (a.type === 'tsumo') {
      if (!canTsumo(S, seat)) throw new Error('cannot tsumo');
      finishWin(S, seat, 'tsumo', seat, S.drawn, 'tsumo');
    } else if (a.type === 'discard') {
      if (S.phase !== 'discard' || S.turn !== seat) throw new Error('not your turn');
      const i = me.hand.indexOf(a.id);
      if (i < 0) throw new Error('no such tile');
      if (yaku) {
        if (me.riichi && a.id !== S.drawn) throw new Error('riichi: discard the drawn tile');
        if (S.kuikae.includes(kindOf(a.id))) throw new Error('kuikae');
        if (a.riichi && !riichiOptions(S, seat).includes(a.id)) throw new Error('cannot riichi');
      } else if (a.riichi) throw new Error('no riichi in simple');
      const wasRiichi = !!me.riichi;
      const dbl = firstTurn(S, seat);
      me.hand.splice(i, 1);
      me.hand.sort((x, y) => x - y);
      me.river.push({ id: a.id, called: false, riichi: !!a.riichi });
      if (a.riichi) {
        me.riichi = { double: dbl, at: S.disc };
        me.ippatsu = true;
        S.log.push({ t: 'riichi', seat });
      } else if (wasRiichi) {
        me.ippatsu = false;
      }
      me.furitenTemp = false;
      S.last = { seat, id: a.id };
      S.disc += 1;
      S.drawn = null;
      S.rinshanDraw = false;
      S.kuikae = [];
      if (S.pendDora) { S.doraN += S.pendDora; S.pendDora = 0; }
      S.log.push({ t: 'discard', seat, id: a.id });
      nextAfterDiscard(S);
    } else if (a.type === 'ankan') {
      if (!kanOptions(S, seat).ankan.includes(a.kind)) throw new Error('cannot ankan');
      const tiles = me.hand.filter((x) => kindOf(x) === a.kind);
      me.hand = me.hand.filter((x) => kindOf(x) !== a.kind);
      me.melds.push({ type: 'ankan', tiles });
      addKan(S, seat);
      breakFirst(S);
      S.doraN += 1;
      S.log.push({ t: 'ankan', seat });
      draw(S, seat, true);
    } else if (a.type === 'kakan') {
      if (!kanOptions(S, seat).kakan.includes(a.kind)) throw new Error('cannot kakan');
      const id = me.hand.find((x) => kindOf(x) === a.kind);
      me.hand = me.hand.filter((x) => x !== id);
      const m = me.melds.find((x) => x.type === 'pon' && kindOf(x.tiles[0]) === a.kind);
      m.type = 'kakan';
      m.tiles = m.tiles.concat([id]).sort((x, y) => x - y);
      m.added = id;
      S.drawn = null;
      S.chankan = { seat, id };
      S.log.push({ t: 'kakan', seat });
      // 加えた牌で、ほかの人がロンできるか（槍槓）
      if (!openClaims(S, 'chankan')) completeKakan(S, seat);
    } else if (a.type === 'kyushu') {
      if (!canKyushu(S, seat)) throw new Error('cannot kyushu');
      endAbort(S, '九種九牌');
    } else if (['ron', 'pon', 'chi', 'minkan', 'pass'].includes(a.type)) {
      if (S.phase !== 'claim' || !S.pending[seat] || S.pending[seat].answer) throw new Error('cannot claim');
      const o = S.pending[seat].options;
      if (a.type === 'ron' && !o.ron) throw new Error('cannot ron');
      if (a.type === 'pon' || a.type === 'chi' || a.type === 'minkan') {
        const ok = o[a.type].some((p) => p.length === a.tiles.length && p.every((x, n) => x === a.tiles[n]));
        if (!ok) throw new Error('cannot ' + a.type);
      }
      S.pending[seat].answer = a.type === 'pass' ? { type: 'pass' } : { type: a.type, tiles: a.tiles || null };
      // 答えられる人が全員答えたら決める（ロン → ポン・カン → チー。同じなら捨てた人の次に近い人）
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
    if (S.dead) S.dead.dora.slice(0, S.doraN).forEach((id) => { c[kindOf(id)] += 1; });
    return c;
  }

  // 手の中の牌それぞれを捨てたときの、あと何枚と、受け入れの枚数（リーチ中・喰い替えで捨てられない牌は出さない）
  function discardAdvice(S, seat) {
    const me = S.seats[seat];
    const hand = me.hand;
    const open = openCount(S, seat);
    const c = counts(hand);
    const seen = visibleCounts(S, seat);
    const byKind = {};
    const allowed = (id) => {
      if (!isYaku(S)) return true;
      if (me.riichi) return id === S.drawn;
      return !S.kuikae.includes(kindOf(id));
    };
    for (const id of hand) {
      const k = kindOf(id);
      if (byKind[k] || !allowed(id)) continue;
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
    return shapeWaits(S, seat);
  }

  // ヒント用: 待ち・フリテン・役がつくか（役ありだけ意味がある）
  function waitInfo(S, seat) {
    const ws = shapeWaits(S, seat);
    if (!ws.length || !isYaku(S)) return { waits: ws, furiten: false, yaku: true, riichiYaku: false };
    const me = S.seats[seat];
    // 待ちの牌が来たとき、ロンかツモで役がつくか（海底・河底などの偶然の役は見ない）
    const yakuAny = ws.some((k) => {
      const r = { ...yakuContext(S, seat, k * 4, 'ron'), houtei: false };
      const t = { ...r, tsumo: true, rinshan: false, haitei: false, tenhou: false, chiihou: false };
      return !!Y.evaluate(r) || !!Y.evaluate(t);
    });
    return { waits: ws, furiten: furiten(S, seat), yaku: yakuAny, riichiYaku: !yakuAny && !me.riichi && isMenzen(S, seat) };
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
  // 役牌（三元牌・自風・場風）
  const isYakuhai = (S, seat, k) => k >= 31 || k === seatWind(S, seat) || k === S.roundWind;

  function cpuAction(S, seat) {
    if (S.phase === 'discard' && S.turn === seat) {
      if (canTsumo(S, seat)) return { type: 'tsumo' };
      const me = S.seats[seat];
      if (isYaku(S)) {
        if (me.riichi) return { type: 'discard', id: S.drawn };
        // ふつう: 手が悪くならないカンはする
        if (S.opts.level === 'normal') {
          const ko = kanOptions(S, seat);
          const before = handShanten(S, seat);
          for (const k of ko.ankan) {
            const c = handCounts(S, seat); c[k] = 0;
            let best = 9;
            for (let d = 0; d < KINDS; d += 1) { if (!c[d]) continue; c[d] -= 1; best = Math.min(best, shanten(c, openCount(S, seat) + 1, S.opts)); c[d] += 1; }
            if (best <= Math.max(0, before - 0)) return { type: 'ankan', kind: k };
          }
          if (ko.kakan.length) return { type: 'kakan', kind: ko.kakan[0] };
        }
        const id = cpuDiscard(S, seat);
        // テンパイで門前ならリーチ（役がなくても、リーチで役がつく）
        const ro = riichiOptions(S, seat);
        if (ro.length) {
          const pick = ro.includes(id) ? id : ro[0];
          return { type: 'discard', id: pick, riichi: true };
        }
        return { type: 'discard', id };
      }
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
      // コンピューターはチーをしない（鳴きが多いと、すぐに局が終わる）。やさしいではポンもしない。
      // 役ありでは、役牌のポンだけ（ほかを鳴くと役がなくなりやすい）
      if (S.opts.level !== 'easy') {
        for (const p of o.pon) {
          if (isYaku(S) && !isYakuhai(S, seat, kindOf(p[0]))) continue;
          if (tryCall(p) < before) return { type: 'pon', tiles: p };
        }
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
    shanten, shantenRegular, shantenPairs, shantenKokushi, decompose, waits, groupHand,
    createRound, act, canTsumo, claimOptions, visibleCounts,
    discardAdvice, handShanten, handWaits, cpuAction, waitingFor,
    isYaku, winEval, furiten, riichiOptions, kanOptions, canKyushu, waitInfo, seatWind, doraKinds, firstTurn,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MahjongEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
