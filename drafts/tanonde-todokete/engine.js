/* たのんで、とどけて（試作）のルール。画面に触らない（node でも読める）。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TTEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ヒントに使える言葉
  const TAGS = ['大きい', '小さい', 'まるい', 'ながい', 'ふわふわ', 'かたい', '光る', 'とぶ', 'はねる', 'あまい', 'つめたい', 'あたたかい', '音が出る'];

  // 荷物。ヒントは3つずつ。2つだけ伝えると、ほかの荷物とまぎれることがある
  const ITEMS = [
    { id: 'kotatsu', name: '空とぶこたつ', tags: ['とぶ', 'あたたかい', '大きい'] },
    { id: 'onigiri', name: '光るおにぎり', tags: ['光る', '小さい', 'あたたかい'] },
    { id: 'iwa', name: 'ふわふわの岩', tags: ['ふわふわ', '大きい', 'まるい'] },
    { id: 'purin', name: 'はねるプリン', tags: ['はねる', 'あまい', '小さい'] },
    { id: 'yakan', name: '歌うやかん', tags: ['音が出る', 'あたたかい', 'かたい'] },
    { id: 'taiyaki', name: 'つめたいたいやき', tags: ['つめたい', 'あまい', '小さい'] },
    { id: 'mafura', name: 'ながーいマフラー', tags: ['ながい', 'ふわふわ', 'あたたかい'] },
    { id: 'kujira', name: 'クジラの風船', tags: ['とぶ', '大きい', 'まるい'] },
    { id: 'wataame', name: '光るわたあめ', tags: ['光る', 'ふわふわ', 'あまい'] },
    { id: 'koori', name: 'はねる氷', tags: ['はねる', 'つめたい', 'かたい'] },
    { id: 'donatsu', name: '鳴るドーナツ', tags: ['音が出る', 'あまい', 'まるい'] },
    { id: 'biidama', name: '巨大なビー玉', tags: ['大きい', 'まるい', 'かたい'] },
    { id: 'yukidaruma', name: 'とぶ雪だるま', tags: ['とぶ', 'つめたい', 'まるい'] },
    { id: 'aisu', name: 'ながーいアイス', tags: ['ながい', 'つめたい', 'あまい'] },
    { id: 'nawatobi', name: '光るなわとび', tags: ['光る', 'ながい', 'はねる'] },
    { id: 'taiko', name: '小さなたいこ', tags: ['小さい', '音が出る', 'まるい'] },
    { id: 'rappa', name: 'ふわふわのラッパ', tags: ['ふわふわ', '音が出る', 'ながい'] },
    { id: 'makura', name: 'はねるまくら', tags: ['はねる', 'ふわふわ', '大きい'] },
    { id: 'ishi', name: 'あったかい石', tags: ['あたたかい', 'かたい', '小さい'] },
    { id: 'hoshi', name: 'とぶ星のライト', tags: ['とぶ', '光る', '小さい'] },
    { id: 'tokei', name: '大きな鳴る時計', tags: ['大きい', '音が出る', 'かたい'] },
    { id: 'boru', name: '光るボール', tags: ['光る', 'まるい', 'はねる'] },
    { id: 'tako', name: 'ながーいたこ', tags: ['とぶ', 'ながい', '大きい'] },
    { id: 'manju', name: 'ほかほかまんじゅう', tags: ['あたたかい', 'あまい', 'まるい'] }
  ];
  const BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  const HAND = 4;        // はじめの手札
  const HINTS = 2;       // 1回に伝えられるヒント
  const STAR_HIT = 2;    // ぴったり: たのんだ人・渡した人に
  const STAR_ODD = 1;    // ちがう荷物: たのんだ人・渡した人に
  const TEAM_HIT = 3;
  const TEAM_ODD = 1;

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function item(id) { return BY_ID[id]; }

  function matchScore(id, hints) {
    const tags = BY_ID[id].tags;
    return hints.filter(function (h) { return tags.indexOf(h) >= 0; }).length;
  }

  function newGame(names, rng) {
    rng = rng || Math.random;
    const deck = shuffle(ITEMS.map(function (it) { return it.id; }), rng);
    const players = names.map(function (name) {
      return { name: name, hand: deck.splice(0, HAND), order: null, stars: 0, stat: { hit: 0, give: 0, odd: 0, ask: 0 } };
    });
    const s = { players: players, deck: deck, turn: 0, team: 0, hits: 0, odds: 0, over: false };
    players.forEach(function (_, i) { assignOrder(s, i, rng); });
    return s;
  }

  // 注文は、ほかの人の手札にある荷物から。同じ荷物を2人が注文しない
  function assignOrder(s, p, rng) {
    const taken = s.players.map(function (pl) { return pl.order; });
    const pool = [];
    s.players.forEach(function (pl, i) {
      if (i === p) return;
      pl.hand.forEach(function (id) { if (taken.indexOf(id) < 0) pool.push(id); });
    });
    s.players[p].order = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  }

  function holderOf(s, id) {
    for (let i = 0; i < s.players.length; i++) if (s.players[i].hand.indexOf(id) >= 0) return i;
    return -1;
  }

  // 荷物が動いたあと、届かなくなった注文を入れかえる
  function fixOrders(s, rng) {
    s.players.forEach(function (pl, i) {
      if (pl.order === null) return;
      const h = holderOf(s, pl.order);
      if (h < 0 || h === i) pl.order = null;
    });
    s.players.forEach(function (pl, i) { if (pl.order === null) assignOrder(s, i, rng); });
    if (s.players.every(function (pl) { return pl.order === null; })) s.over = true;
  }

  function nextTurn(s) {
    const n = s.players.length;
    for (let k = 1; k <= n; k++) {
      const t = (s.turn + k) % n;
      if (s.players[t].order !== null) { s.turn = t; return; }
    }
    s.over = true;
  }

  // コンピューターのヒント: 注文の荷物のヒント3つから2つ
  function cpuHints(s, rng) {
    const tags = BY_ID[s.players[s.turn].order].tags.slice();
    return shuffle(tags, rng).slice(0, HINTS);
  }

  // コンピューターの申し出。ぜんぶ合えば「たぶんこれ」、半分なら出すか迷う
  function cpuOffer(s, p, hints, rng) {
    let best = null, bestScore = 0;
    shuffle(s.players[p].hand.slice(), rng).forEach(function (id) {
      const sc = matchScore(id, hints);
      if (sc > bestScore) { best = id; bestScore = sc; }
    });
    if (!best || !hints.length) return null;
    if (bestScore === hints.length) return { from: p, item: best, sure: true };
    if (rng() < 0.45) return { from: p, item: best, sure: false };
    return null;
  }

  function cpuPick(offers, rng) {
    if (!offers.length) return null;
    const sure = offers.filter(function (o) { return o.sure; });
    const pool = sure.length ? sure : offers;
    return pool[Math.floor(rng() * pool.length)];
  }

  // 聞き返しへの答え
  function answer(s, tag) {
    return BY_ID[s.players[s.turn].order].tags.indexOf(tag) >= 0;
  }

  // 届ける。offer が null なら、だれも出さなかった（注文を入れかえて次の人へ）
  function deliver(s, offer, rng) {
    rng = rng || Math.random;
    const req = s.players[s.turn];
    const wanted = req.order;
    let res;
    if (!offer) {
      req.order = null;
      res = { none: true, wanted: wanted, req: s.turn };
    } else {
      const giver = s.players[offer.from];
      giver.hand.splice(giver.hand.indexOf(offer.item), 1);
      const hit = offer.item === wanted;
      const star = hit ? STAR_HIT : STAR_ODD;
      req.stars += star; giver.stars += star;
      s.team += hit ? TEAM_HIT : TEAM_ODD;
      if (hit) { s.hits++; req.stat.hit++; } else { s.odds++; req.stat.odd++; giver.stat.odd++; }
      giver.stat.give++;
      if (s.deck.length) giver.hand.push(s.deck.shift());
      req.order = null;
      res = { none: false, hit: hit, wanted: wanted, got: offer.item, req: s.turn, from: offer.from, star: star, team: hit ? TEAM_HIT : TEAM_ODD };
    }
    fixOrders(s, rng);
    if (!s.over) nextTurn(s);
    return res;
  }

  // おわりのひとこと。数は出さず、1人に1つ。みんなちがう名前になるようにする
  const TITLES = [
    { key: 'hit', name: '名ヒント', text: 'ヒントがよく伝わった' },
    { key: 'give', name: 'たすけ名人', text: 'たくさん荷物を渡した' },
    { key: 'odd', name: 'びっくり配達', text: '思いがけない荷物で町をわかせた' },
    { key: 'ask', name: 'ききかえし名人', text: 'たしかめてから渡した' }
  ];
  const SPARE = [
    { name: 'チームのささえ', text: 'みんなの配達をささえた' },
    { name: 'おちつき名人', text: 'あわてずに運んだ' },
    { name: 'にこにこ配達', text: 'たのしく運んだ' },
    { name: 'ねばり名人', text: 'さいごまで運んだ' }
  ];
  function titles(s) {
    const used = {};
    let spare = 0;
    return s.players.map(function (pl) {
      let pick = null, top = 0;
      TITLES.forEach(function (t) {
        if (used[t.key]) return;
        if (pl.stat[t.key] > top) { top = pl.stat[t.key]; pick = t; }
      });
      if (pick) { used[pick.key] = true; return { name: pick.name, text: pick.text }; }
      return SPARE[spare++ % SPARE.length];
    });
  }

  return {
    TAGS: TAGS, ITEMS: ITEMS, HAND: HAND, HINTS: HINTS,
    item: item, matchScore: matchScore, newGame: newGame, holderOf: holderOf,
    cpuHints: cpuHints, cpuOffer: cpuOffer, cpuPick: cpuPick, answer: answer,
    deliver: deliver, titles: titles
  };
});
