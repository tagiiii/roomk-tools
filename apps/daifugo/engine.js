/* 大富豪のルールだけ。画面・通信に触らない（node でも読める）。
   カードは文字列: マーク（S H D C）＋数（3〜15。11=J 12=Q 13=K 14=A 15=2）。ジョーカーは 'X1' 'X2'。
   状態は JSON にできる形だけで持つ（ルームに文字列にして置くため）。 */
(function (root) {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const SUIT_MARK = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const SUIT_NAME = { S: 'スペード', H: 'ハート', D: 'ダイヤ', C: 'クラブ' };
  const JOKER = 16;
  const LABEL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: 'ジョーカー' };
  const PLAYERS_MIN = 3;
  const PLAYERS_MAX = 6;

  // 設定（はじめの値）
  const DEFAULT_RULES = {
    revolution: true,       // 革命: 同じ数を4枚以上で、強さが逆になる
    eightCut: true,         // 8切り: 8を出すと場が流れて、もう一度出せる
    stairs: true,           // 階段: 同じマークで続いた数を3枚以上
    lock: false,            // しばり: 同じマークが続くと、流れるまでそのマークだけ
    elevenBack: false,      // イレブンバック: J を出すと、流れるまで強さが逆
    tenDiscard: false,      // 10捨て: 10を出すと、出した枚数まで手札を捨てられる
    spade3: false,          // スペ3返し: ジョーカー1枚には ♠3 で勝てる
    forbiddenFinish: false, // 反則あがり: ジョーカー・いちばん強い数・8 では、あがれない
    jokers: 1,              // ジョーカーの枚数（0〜2）
    exchange: false,        // カード交換（2回目から。大貧民から出す）
  };
  const normRules = (r) => {
    const o = Object.assign({}, DEFAULT_RULES, r || {});
    o.jokers = Math.max(0, Math.min(2, Number(o.jokers) || 0));
    return o;
  };

  const isJoker = (c) => c[0] === 'X';
  const rankOf = (c) => (isJoker(c) ? JOKER : Number(c.slice(1)));
  const suitOf = (c) => c[0];
  const rankLabel = (r) => LABEL[r] || String(r);
  const cardLabel = (c) => (isJoker(c) ? 'ジョーカー' : SUIT_MARK[suitOf(c)] + rankLabel(rankOf(c)));
  const clone = (x) => JSON.parse(JSON.stringify(x));

  // 強さの順番（大きいほど強い）。dir が -1 のとき（革命・イレブンバック）は数の並びが逆。ジョーカーはいつも一番
  const power = (rank, dir) => (rank === JOKER ? 99 : dir > 0 ? rank : 18 - rank);
  const dirOf = (s) => (s.rev !== s.back ? -1 : 1);

  function sortHand(hand) {
    return hand.slice().sort((a, b) => rankOf(a) - rankOf(b) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b)) || (a < b ? -1 : 1));
  }

  function makeDeck(jokers) {
    const d = [];
    SUITS.forEach((s) => { for (let r = 3; r <= 15; r += 1) d.push(s + r); });
    for (let j = 1; j <= jokers; j += 1) d.push('X' + j);
    return d;
  }
  function shuffle(a, rnd) {
    const r = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i -= 1) {
      const k = Math.floor(r() * (i + 1));
      [a[i], a[k]] = [a[k], a[i]];
    }
    return a;
  }

  // ══ 階級（前回のあがり順） ══
  // k 番目（0 から）にあがった人の呼び名
  function titleOf(n, k) {
    if (k === 0) return '大富豪';
    if (k === n - 1) return '大貧民';
    if (n >= 4 && k === 1) return '富豪';
    if (n >= 4 && k === n - 2) return '貧民';
    return '平民';
  }
  // 交換する組: [上の順番, 下の順番, 枚数]。4人以上は富豪と貧民も1枚
  const exchangePairs = (n) => (n >= 4 ? [[0, n - 1, 2], [1, n - 2, 1]] : [[0, n - 1, 2]]);
  // 強い順（いつもの強さ。ジョーカーがいちばん）に k 枚
  function strongest(hand, k) {
    return hand.slice().sort((a, b) => rankOf(b) - rankOf(a) || SUITS.indexOf(suitOf(a)) - SUITS.indexOf(suitOf(b))).slice(0, k);
  }

  // ══ 組み合わせを読む ══
  // 出せる形なら、読み方の候補を返す（階段はジョーカーの位置で読み方が複数ありうる）。出せない形なら []
  function analyze(cards, rules) {
    const n = cards.length;
    if (!n) return [];
    const nat = cards.filter((c) => !isJoker(c));
    const k = n - nat.length;
    const base = {
      n, cards: cards.slice(), jokers: k,
      suits: nat.map(suitOf).sort(),
      eight: nat.some((c) => rankOf(c) === 8),
      tens: nat.filter((c) => rankOf(c) === 10).length,
      jacks: nat.filter((c) => rankOf(c) === 11).length,
    };
    // 同じ数（1枚・2枚以上）。ジョーカーはどの数にもなる
    const ranks = Array.from(new Set(nat.map(rankOf)));
    const out = [];
    if (ranks.length <= 1) {
      const rank = ranks.length ? ranks[0] : JOKER;
      out.push(Object.assign({}, base, { type: n === 1 ? 'single' : 'group', rank, low: rank, high: rank }));
      // 1枚＋ジョーカー2枚は、階段としても読める（場が階段のときに返せるように）
      if (!(ranks.length === 1 && nat.length === 1 && n >= 3)) return out;
    }
    // 階段
    if (!rules.stairs || n < 3) return out;
    if (new Set(base.suits).size !== 1) return out;
    if (ranks.length !== nat.length) return out; // 同じ数が2枚ある
    const lo = Math.min(...ranks);
    const hi = Math.max(...ranks);
    const gaps = hi - lo + 1 - nat.length;
    if (gaps > k) return out;
    const extra = k - gaps;
    for (let a = 0; a <= extra; a += 1) {
      const low = lo - a;
      const high = hi + (extra - a);
      if (low < 3 || high > 15) continue;
      out.push(Object.assign({}, base, { type: 'stairs', rank: low, low, high, suit: base.suits[0] }));
    }
    return out;
  }

  // 場のカードに出せるか（強さ・枚数・しばり）。出せなければ理由の札を返す
  function followCheck(s, play) {
    const f = s.field && s.field.play;
    if (!f) return '';
    if (play.type !== f.type || play.n !== f.n) return f.type === 'stairs' ? 'stairs' : 'count';
    // ジョーカー1枚には ♠3 だけが勝てる（スペ3返し。しばり中でも）
    if (f.rank === JOKER && f.n === 1 && s.rules.spade3 && play.n === 1 && play.cards[0] === 'S3') return '';
    if (s.lock) {
      if (play.type === 'stairs') { if (play.suit !== s.lock[0]) return 'lock'; }
      else if (!play.suits.every((x) => s.lock.includes(x))) return 'lock';
    }
    const dir = dirOf(s);
    if (play.type === 'stairs') return (dir > 0 ? play.low > f.low : play.low < f.low) ? '' : 'weak';
    if (f.rank === JOKER) return 'weak';
    if (play.rank === JOKER) return '';
    return power(play.rank, dir) > power(f.rank, dir) ? '' : 'weak';
  }

  // 反則あがり: 最後の1手に入れられないカード
  function forbiddenIn(s, cards) {
    const strongest = dirOf(s) > 0 ? 15 : 3;
    return cards.some((c) => isJoker(c) || rankOf(c) === strongest || (s.rules.eightCut && rankOf(c) === 8));
  }

  // p がこのカードを出せるか。{ ok, play, reason }
  function check(s, p, cards) {
    if (s.over || s.pending || s.exchange || s.turn !== p) return { ok: false, reason: 'turn' };
    const hand = s.hands[p];
    if (!cards.length) return { ok: false, reason: 'empty' };
    if (new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) return { ok: false, reason: 'hand' };
    const reads = analyze(cards, s.rules);
    if (!reads.length) return { ok: false, reason: 'shape' };
    let reason = '';
    const okReads = reads.filter((r) => { const why = followCheck(s, r); if (why) reason = why; return !why; });
    if (!okReads.length) return { ok: false, reason };
    // 反則あがり: 出せない。ただし場が空で、のこり1枚がそのカードなら出してよい（そのかわり最後になる）
    let foul = false;
    if (s.rules.forbiddenFinish && cards.length === hand.length && forbiddenIn(s, cards)) {
      if (s.field || hand.length !== 1) return { ok: false, reason: 'forbidden' };
      foul = true;
    }
    // 読み方が複数あるときは、同じ数の読み方を先に。階段だけなら、いまの強さでいちばん強い読み方にする
    const dir = dirOf(s);
    const groups = okReads.filter((r) => r.type !== 'stairs');
    const play = groups.length ? groups[0] : okReads.reduce((b, r) => ((dir > 0 ? r.low > b.low : r.low < b.low) ? r : b));
    return { ok: true, play, foul };
  }

  // ══ すすめる ══
  function nextActive(s, p) {
    for (let k = 1; k <= s.n; k += 1) {
      const i = (p + k) % s.n;
      if (!s.done[i]) return i;
    }
    return -1;
  }
  function clearField(s) {
    s.field = null;
    s.passed = s.passed.map(() => false);
    s.back = false;
    s.lock = null;
  }
  function markDone(s, p, foul) {
    if (s.done[p]) return;
    s.done[p] = true;
    if (foul) { s.fouls.push(p); s.last.fx.push('foul'); return; }
    s.places.push(p);
    s.last.fx.push('done');
  }
  // のこりが1人になったらおしまい（その人が最後。反則あがりの人はそのあと）
  function checkOver(s) {
    const act = s.done.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
    if (act.length > 1) return false;
    if (act.length === 1) { s.done[act[0]] = true; s.places.push(act[0]); }
    s.places = s.places.concat(s.fouls);
    clearField(s);
    s.over = true;
    s.turn = -1;
    return true;
  }
  // 次の番へ。パスしていない人がいなければ場が流れ、最後に出した人から（あがっていればその次の人から）
  function advance(s, from) {
    const by = s.field.by;
    for (let k = 1; k <= s.n; k += 1) {
      const i = (from + k) % s.n;
      if (i === by) break;
      if (!s.done[i] && !s.passed[i]) { s.turn = i; return; }
    }
    flow(s, by);
  }
  function flow(s, by) {
    clearField(s);
    s.turn = s.done[by] ? nextActive(s, by) : by;
    s.last.flow = true;
    s.last.lead = s.turn;
  }
  function continueAfter(s, p, cut) {
    if (checkOver(s)) return;
    if (cut) { flow(s, p); return; }
    advance(s, p);
  }
  const removeCards = (hand, cards) => hand.filter((c) => !cards.includes(c));

  // prev: 前回のあがり順（席の番号の並び）。同じ人数のときだけ使う。
  // カード交換がオンなら、下の人の強いカードを上の人へ先にわたしておき、上の人が返すカードを選ぶまで出せない
  function newGame(n, rules, rnd, prev) {
    const R = normRules(rules);
    const deck = shuffle(makeDeck(R.jokers), rnd);
    const hands = Array.from({ length: n }, () => []);
    deck.forEach((c, i) => hands[i % n].push(c));
    let sorted = hands.map(sortHand);
    const okPrev = Array.isArray(prev) && prev.length === n && new Set(prev).size === n && prev.every((i) => i >= 0 && i < n);
    let first = sorted.findIndex((h) => h.includes('D3'));
    let exchange = null;
    if (okPrev && R.exchange) {
      exchange = {
        pairs: exchangePairs(n).map(([a, b, k]) => {
          const rich = prev[a];
          const poor = prev[b];
          const up = strongest(sorted[poor], k);
          sorted[poor] = removeCards(sorted[poor], up);
          sorted[rich] = sortHand(sorted[rich].concat(up));
          return { rich, poor, k, up, down: null };
        }),
      };
      first = prev[n - 1];
    }
    sorted = sorted.map(sortHand);
    return {
      rules: R, n, hands: sorted,
      done: sorted.map(() => false), places: [], fouls: [],
      passed: sorted.map(() => false),
      turn: first, field: null, rev: false, back: false, lock: null,
      pending: null, over: false, seq: 0,
      prev: okPrev ? prev.slice() : null,
      exchange, exchanged: null, exSeq: -1,
      last: { kind: 'start', by: first, cards: [], fx: [] },
    };
  }

  // カード交換: 上の人が、下の人へ返すカードを選ぶ（好きなカードを決まった枚数）
  function give(s0, p, cards) {
    const ex = s0.exchange;
    const pair = ex && ex.pairs.find((x) => x.rich === p && !x.down);
    if (!pair || s0.over) return null;
    const hand = s0.hands[p];
    if (cards.length !== pair.k || new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) return null;
    const s = clone(s0);
    const pr = s.exchange.pairs.find((x) => x.rich === p);
    s.seq += 1;
    s.last = { kind: 'give', by: p, cards: [], fx: [] };
    s.hands[p] = removeCards(hand, cards);
    s.hands[pr.poor] = sortHand(s.hands[pr.poor].concat(cards));
    pr.down = cards.slice();
    if (s.exchange.pairs.every((x) => x.down)) {
      s.exchanged = s.exchange.pairs;
      s.exchange = null;
      s.exSeq = s.seq;
      s.last.fx.push('exchanged');
      s.last.lead = s.turn;
    }
    return s;
  }

  function play(s0, p, cards) {
    const c = check(s0, p, cards);
    if (!c.ok) return null;
    const s = clone(s0);
    const pl = c.play;
    const prev = s.field && s.field.play;
    s.seq += 1;
    s.last = { kind: 'play', by: p, cards: cards.slice(), fx: [] };
    s.hands[p] = removeCards(s.hands[p], cards);

    if (s.rules.revolution && pl.type === 'group' && pl.n >= 4) { s.rev = !s.rev; s.last.fx.push(s.rev ? 'revolution' : 'revolution-back'); }
    if (s.rules.elevenBack && pl.jacks > 0 && !s.back) { s.back = true; s.last.fx.push('back'); }
    if (s.rules.lock && prev && !s.lock && !pl.jokers && !prev.jokers && pl.suits.join() === prev.suits.join()) {
      s.lock = pl.type === 'stairs' ? [pl.suit] : pl.suits.slice();
      s.last.fx.push('lock');
    }
    const s3 = !!(s.rules.spade3 && prev && prev.rank === JOKER && prev.n === 1 && pl.n === 1 && cards[0] === 'S3');
    const eight = !!(s.rules.eightCut && pl.eight);
    if (eight) s.last.fx.push('eight');
    if (s3) s.last.fx.push('spade3');
    s.field = { play: pl, by: p };
    if (!s.hands[p].length) markDone(s, p, c.foul);

    if (s.rules.tenDiscard && pl.tens > 0 && s.hands[p].length) {
      s.pending = { by: p, n: Math.min(pl.tens, s.hands[p].length), cut: eight || s3 };
      s.last.fx.push('ten');
      return s;
    }
    continueAfter(s, p, eight || s3);
    return s;
  }

  // 10捨て: 捨てるカードを選ぶ（0枚でもいい）
  function discard(s0, p, cards) {
    const pd = s0.pending;
    if (!pd || pd.by !== p || s0.over || s0.exchange) return null;
    const hand = s0.hands[p];
    if (cards.length > pd.n || new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) return null;
    const s = clone(s0);
    s.seq += 1;
    s.last = { kind: 'discard', by: p, cards: cards.slice(), fx: [] };
    s.hands[p] = removeCards(hand, cards);
    s.pending = null;
    if (!s.hands[p].length) markDone(s, p, s.rules.forbiddenFinish && forbiddenIn(s, cards));
    continueAfter(s, p, pd.cut);
    return s;
  }

  function pass(s0, p) {
    if (s0.over || s0.pending || s0.exchange || s0.turn !== p || !s0.field) return null;
    const s = clone(s0);
    s.seq += 1;
    s.last = { kind: 'pass', by: p, cards: [], fx: [] };
    s.passed[p] = true;
    advance(s, p);
    return s;
  }

  // ══ 出せる手を数え上げる（CPU・補助・時間切れ用） ══
  function combos(arr, m) {
    const out = [];
    const rec = (start, acc) => {
      if (acc.length === m) { out.push(acc.slice()); return; }
      for (let i = start; i < arr.length; i += 1) { acc.push(arr[i]); rec(i + 1, acc); acc.pop(); }
    };
    rec(0, []);
    return out;
  }
  function candidates(hand, rules) {
    const jokers = hand.filter(isJoker);
    const out = [];
    const byRank = {};
    hand.filter((c) => !isJoker(c)).forEach((c) => { (byRank[rankOf(c)] = byRank[rankOf(c)] || []).push(c); });
    Object.keys(byRank).forEach((r) => {
      const cs = byRank[r];
      for (let m = 1; m <= cs.length; m += 1) {
        combos(cs, m).forEach((set) => {
          for (let j = 0; j <= jokers.length; j += 1) out.push(set.concat(jokers.slice(0, j)));
        });
      }
    });
    for (let j = 1; j <= jokers.length; j += 1) out.push(jokers.slice(0, j));
    if (rules.stairs) {
      SUITS.forEach((su) => {
        for (let low = 3; low <= 13; low += 1) {
          for (let high = low + 2; high <= 15; high += 1) {
            const got = [];
            let miss = 0;
            for (let r = low; r <= high; r += 1) {
              const c = su + r;
              if (hand.includes(c)) got.push(c); else miss += 1;
            }
            if (miss > jokers.length) break;
            if (!got.length) continue;
            out.push(got.concat(jokers.slice(0, miss)));
          }
        }
      });
    }
    return out;
  }
  function legalPlays(s, p) {
    if (s.over || s.pending || s.turn !== p) return [];
    const seen = new Set();
    const out = [];
    candidates(s.hands[p], s.rules).forEach((cards) => {
      const key = cards.slice().sort().join();
      if (seen.has(key)) return;
      seen.add(key);
      const c = check(s, p, cards);
      if (c.ok) out.push({ cards, play: c.play });
    });
    return out;
  }

  // ══ CPU ══
  // 弱いカードから手放し、ジョーカーと強いカードはとっておく。ペアはなるべくくずさない
  function cpuMove(s, p) {
    const hand = s.hands[p];
    const dir = dirOf(s);
    const pair = s.exchange && s.exchange.pairs.find((x) => x.rich === p && !x.down);
    if (pair) {
      // 返すのは弱いカード（ジョーカーは返さない）
      const order = hand.filter((c) => !isJoker(c)).sort((a, b) => rankOf(a) - rankOf(b)).concat(hand.filter(isJoker));
      return { kind: 'give', cards: order.slice(0, pair.k) };
    }
    if (s.exchange) return null;
    if (s.pending && s.pending.by === p) {
      const order = hand.filter((c) => !isJoker(c)).sort((a, b) => power(rankOf(a), dir) - power(rankOf(b), dir));
      return { kind: 'discard', cards: order.slice(0, s.pending.n) };
    }
    if (s.over || s.turn !== p) return null;
    const legal = legalPlays(s, p);
    if (!legal.length) return { kind: 'pass' };
    const finish = legal.find((m) => m.cards.length === hand.length);
    if (finish) return { kind: 'play', cards: finish.cards };
    const count = {};
    hand.forEach((c) => { if (!isJoker(c)) count[rankOf(c)] = (count[rankOf(c)] || 0) + 1; });
    const lead = !s.field;
    const score = (m) => {
      const pw = power(m.play.rank, dir);
      let sc = (pw === 99 ? 20 : pw) * 10;
      sc += m.play.jokers * 150;
      if (m.play.type !== 'stairs' && m.play.rank !== JOKER && count[m.play.rank] > m.play.n - m.play.jokers) sc += 40; // ペアをくずす
      if (m.play.type === 'stairs') sc += m.cards.filter((c) => !isJoker(c) && count[rankOf(c)] > 1).length * 25;
      if (lead) sc -= m.cards.length * 12;
      return sc;
    };
    const best = legal.reduce((b, m) => (score(m) < score(b) ? m : b));
    // 手札がまだ多いうちは、ジョーカーやいちばん強い数で場を取りにいかない（パスする）
    const strong = best.play.jokers > 0 || power(best.play.rank, dir) >= power(dir > 0 ? 15 : 3, dir);
    if (!lead && strong && hand.length > 4) return { kind: 'pass' };
    return { kind: 'play', cards: best.cards };
  }

  // CPU や時間切れで決めた手を当てはめる
  function apply(s, p, mv) {
    if (!mv) return null;
    if (mv.kind === 'pass') return pass(s, p);
    if (mv.kind === 'discard') return discard(s, p, mv.cards);
    if (mv.kind === 'give') return give(s, p, mv.cards);
    return play(s, p, mv.cards);
  }

  const api = {
    SUITS, SUIT_MARK, SUIT_NAME, JOKER, PLAYERS_MIN, PLAYERS_MAX, DEFAULT_RULES,
    normRules, isJoker, rankOf, suitOf, rankLabel, cardLabel, sortHand, makeDeck, dirOf, power,
    analyze, check, newGame, play, discard, pass, give, legalPlays, cpuMove, apply, titleOf, exchangePairs,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DaifugoEngine = api;
})(typeof window !== 'undefined' ? window : this);
