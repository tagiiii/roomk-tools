/* あれください商店 のルール。画面と通信に触らない（node でも読める）。
   商店街に、遊ぶ人が1つずつお店を持つ。番の人だけがお客さんになり、ほしい物をヒント2つで聞く。
   ほかの人（お店の人）は、自分のお店から「これかな？」と思う物を出すか、出さない。
   ルームに置く形（toRoom / fromRoom）もここで決める。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ArekuEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ヒントに使える言葉
  const TAGS = ['大きい', '小さい', 'まるい', 'ながい', 'ふわふわ', 'かたい', '光る', 'とぶ', 'はねる', 'あまい', 'つめたい', 'あたたかい', '音が出る'];

  // 品物。ヒントは3つずつ（どの2つの品物も、3つの組が同じにならない）。2つだけ聞くと、ほかの品物とまぎれることがある
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
    { id: 'manju', name: 'ほかほかまんじゅう', tags: ['あたたかい', 'あまい', 'まるい'] },
    // 12人まで遊べるように足した36種類（2026-11-15）
    { id: 'kasa', name: '歌うかさ', tags: ['音が出る', 'ながい', 'とぶ'] },
    { id: 'shabon', name: '光るシャボン玉', tags: ['光る', 'とぶ', 'まるい'] },
    { id: 'furaipan', name: 'ふわふわのフライパン', tags: ['ふわふわ', 'あたたかい', '大きい'] },
    { id: 'kakigoori', name: '光るかき氷', tags: ['光る', 'つめたい', 'あまい'] },
    { id: 'zerii', name: 'はねるゼリー', tags: ['はねる', 'つめたい', 'あまい'] },
    { id: 'meronpan', name: 'ながーいメロンパン', tags: ['ながい', 'あまい', 'ふわふわ'] },
    { id: 'tsurara', name: '光るつらら', tags: ['光る', 'つめたい', 'ながい'] },
    { id: 'kumo', name: '小さな雲', tags: ['小さい', 'ふわふわ', 'とぶ'] },
    { id: 'juutan', name: '空とぶじゅうたん', tags: ['とぶ', 'ながい', 'ふわふわ'] },
    { id: 'suzu', name: '大きな鈴', tags: ['大きい', '音が出る', 'まるい'] },
    { id: 'rantan', name: 'あったかいランタン', tags: ['光る', 'あたたかい', 'かたい'] },
    { id: 'mashumaro', name: 'はねるマシュマロ', tags: ['はねる', 'あまい', 'ふわふわ'] },
    { id: 'kusshon', name: 'ひんやりクッション', tags: ['つめたい', 'ふわふわ', 'まるい'] },
    { id: 'donguri', name: '歌うどんぐり', tags: ['音が出る', 'まるい', 'かたい'] },
    { id: 'kukkii', name: 'とぶクッキー', tags: ['とぶ', 'あまい', 'かたい'] },
    { id: 'ame', name: '光るアメ', tags: ['光る', 'あまい', 'まるい'] },
    { id: 'hottokeeki', name: '大きなホットケーキ', tags: ['大きい', 'あたたかい', 'あまい'] },
    { id: 'supuun', name: 'ピカピカのながーいスプーン', tags: ['ながい', 'かたい', '光る'] },
    { id: 'koorinoisu', name: '大きな氷のいす', tags: ['大きい', 'つめたい', 'かたい'] },
    { id: 'bane', name: 'はねるばね', tags: ['はねる', 'ながい', 'かたい'] },
    { id: 'gomuboru', name: '鳴るゴムボール', tags: ['音が出る', 'はねる', 'まるい'] },
    { id: 'reizouko', name: '歌う冷蔵庫', tags: ['音が出る', 'つめたい', '大きい'] },
    { id: 'sutoobu', name: 'とぶストーブ', tags: ['とぶ', 'あたたかい', 'かたい'] },
    { id: 'keitodama', name: 'ながーい毛糸玉', tags: ['ながい', 'ふわふわ', 'まるい'] },
    { id: 'kinoko', name: '光るきのこ', tags: ['光る', '小さい', 'まるい'] },
    { id: 'sofuto', name: 'とぶソフトクリーム', tags: ['とぶ', 'つめたい', 'あまい'] },
    { id: 'omochi', name: 'はねるおもち', tags: ['はねる', 'あたたかい', 'まるい'] },
    { id: 'tanpopo', name: '大きなたんぽぽ', tags: ['大きい', 'ふわふわ', 'とぶ'] },
    { id: 'piano', name: '小さなピアノ', tags: ['小さい', '音が出る', 'かたい'] },
    { id: 'futon', name: 'ひんやりふとん', tags: ['つめたい', 'ふわふわ', '大きい'] },
    { id: 'kutsu', name: '光るくつ', tags: ['光る', 'はねる', '小さい'] },
    { id: 'kagami', name: '空とぶかがみ', tags: ['とぶ', '光る', 'かたい'] },
    { id: 'onabe', name: 'はねるおなべ', tags: ['はねる', '音が出る', 'あたたかい'] },
    { id: 'keeki', name: '歌うケーキ', tags: ['音が出る', 'あまい', '大きい'] },
    { id: 'yukidama', name: '小さな雪玉', tags: ['小さい', 'つめたい', 'まるい'] },
    { id: 'hebi', name: 'ながーいおもちゃのヘビ', tags: ['ながい', 'はねる', '小さい'] }
  ];
  const BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 12;
  const HAND = 4;        // はじめの品物の数（12人で48こ。のこり12こが補充の山）
  const HINTS = 2;       // 1回に聞けるヒント
  const ASK_MAX = 2;     // お店の人が、1人のお客さんにできる質問の数
  const PT_HIT = 2;      // ぴったり: お客さん・出したお店の人に
  const PT_ODD = 1;      // ちがう物: お客さん・出したお店の人に
  const PT_FIT = 1;      // えらばれなかったけれど、ヒント2つに合う物を出したお店に

  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function item(id) { return BY_ID[id] || null; }
  function isTag(t) { return TAGS.indexOf(t) >= 0; }

  function matchScore(id, hints) {
    const it = BY_ID[id];
    if (!it) return 0;
    return hints.filter(function (h) { return it.tags.indexOf(h) >= 0; }).length;
  }
  // ヒントがぜんぶ当てはまるか
  function fits(id, hints) { return hints.length > 0 && matchScore(id, hints) === hints.length; }

  function newPlayer() { return { hand: [], order: null, points: 0, stat: { hit: 0, give: 0, odd: 0, ask: 0, fit: 0 } }; }

  function newGame(n, rng) {
    rng = rng || Math.random;
    const deck = shuffle(ITEMS.map(function (it) { return it.id; }), rng);
    const players = [];
    for (let i = 0; i < n; i++) { const p = newPlayer(); p.hand = deck.splice(0, HAND); players.push(p); }
    const s = { players: players, deck: deck, turn: 0, hits: 0, odds: 0, over: false };
    players.forEach(function (_, i) { assignOrder(s, i, rng); });
    s.turn = Math.floor(rng() * n);
    if (s.players[s.turn].order === null) nextTurn(s, null);
    return s;
  }

  // ほしい物（注文）は、ほかの人のお店にある品物から。同じ品物を2人がほしがらない。
  // away（いまルームにいない人の席）のお店の品物は、出してもらえないので選ばない
  function assignOrder(s, p, rng, away) {
    const taken = s.players.map(function (pl) { return pl.order; });
    const pool = [];
    s.players.forEach(function (pl, i) {
      if (i === p || (away && away[i])) return;
      pl.hand.forEach(function (id) { if (taken.indexOf(id) < 0) pool.push(id); });
    });
    s.players[p].order = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
  }

  function holderOf(s, id) {
    for (let i = 0; i < s.players.length; i++) if (s.players[i].hand.indexOf(id) >= 0) return i;
    return -1;
  }

  // 品物が動いたあと、届かなくなった注文を入れかえる
  function fixOrders(s, rng, away) {
    s.players.forEach(function (pl, i) {
      if (pl.order === null) return;
      const h = holderOf(s, pl.order);
      if (h < 0 || h === i) pl.order = null;
    });
    s.players.forEach(function (pl, i) { if (pl.order === null) assignOrder(s, i, rng, away); });
    if (s.players.every(function (pl) { return pl.order === null; })) s.over = true;
  }

  // 次のお客さん。注文のある人の中から、いまいる人を先に
  function nextTurn(s, away) {
    const n = s.players.length;
    const pick = function (needHere) {
      for (let k = 1; k <= n; k++) {
        const t = (s.turn + k) % n;
        if (s.players[t].order !== null && (!needHere || !away || !away[t])) return t;
      }
      return -1;
    };
    let t = pick(true);
    if (t < 0) t = pick(false);
    if (t < 0) { s.over = true; return; }
    s.turn = t;
  }

  // 質問への答え（お客さんのほしい物に、そのヒントが当てはまるか）
  function answer(s, tag) {
    const o = s.players[s.turn].order;
    return !!o && BY_ID[o].tags.indexOf(tag) >= 0;
  }

  /* 1回の番を決める。
     offers: 出された品物 [{ from: 席, item: id }]（出さなかったお店は入れない）
     chosen: お客さんがえらんだ offers の番号。-1 は「べつの物にする」（だれも出さなかった・この番を飛ばす）
     hints: お客さんが聞いたヒント。asked: お店の人ごとの質問の数 { 席: 回数 }
     away: いまルームにいない人の席 { 席: true } */
  function resolve(s, offers, chosen, hints, asked, rng, away) {
    rng = rng || Math.random;
    const c = s.turn;
    const req = s.players[c];
    const wanted = req.order;
    Object.keys(asked || {}).forEach(function (k) {
      const i = Number(k);
      if (s.players[i] && i !== c) s.players[i].stat.ask += Math.max(0, Math.min(ASK_MAX, Number(asked[k]) || 0));
    });
    let res;
    const pickOffer = chosen >= 0 ? offers[chosen] : null;
    const valid = pickOffer && s.players[pickOffer.from] && pickOffer.from !== c && s.players[pickOffer.from].hand.indexOf(pickOffer.item) >= 0;
    if (!valid) {
      req.order = null;
      res = { none: true, c: c, wanted: wanted, fit: [] };
    } else {
      const giver = s.players[pickOffer.from];
      giver.hand.splice(giver.hand.indexOf(pickOffer.item), 1);
      const hit = pickOffer.item === wanted;
      const pt = hit ? PT_HIT : PT_ODD;
      req.points += pt; giver.points += pt;
      if (hit) { s.hits++; req.stat.hit++; } else { s.odds++; req.stat.odd++; giver.stat.odd++; }
      giver.stat.give++;
      if (s.deck.length) giver.hand.push(s.deck.shift());
      // えらばれなかったけれど、ヒントに合う物を出したお店にも1ポイント（品物はお店に残る）
      const fit = [];
      offers.forEach(function (o, k) {
        if (k === chosen || !s.players[o.from] || o.from === c || o.from === pickOffer.from) return;
        if (fit.indexOf(o.from) >= 0 || !fits(o.item, hints)) return;
        if (s.players[o.from].hand.indexOf(o.item) < 0) return;
        s.players[o.from].points += PT_FIT;
        s.players[o.from].stat.fit++;
        fit.push(o.from);
      });
      req.order = null;
      res = { none: false, hit: hit, c: c, wanted: wanted, got: pickOffer.item, from: pickOffer.from, pt: pt, fit: fit };
    }
    fixOrders(s, rng, away);
    if (!s.over) nextTurn(s, away);
    return res;
  }

  // おわりのひとこと。数は出さず、1人に1つ。12人までみんなちがう名前になるようにする
  const TITLES = [
    { key: 'hit', name: '名ヒント', text: 'ヒントがよく伝わった' },
    { key: 'give', name: 'たすけ名人', text: 'お店からたくさん出した' },
    { key: 'odd', name: 'びっくり名人', text: '思いがけない物で商店街をわかせた' },
    { key: 'fit', name: 'よく聞く名人', text: 'ヒントにぴったりの物を出した' },
    { key: 'ask', name: 'しつもん名人', text: '質問してからえらんだ' }
  ];
  const SPARE = [
    { name: '商店街のささえ', text: 'みんなの買い物をささえた' },
    { name: 'おちつき名人', text: 'あわてずにえらんだ' },
    { name: 'にこにこ名人', text: 'たのしくお店に立った' },
    { name: 'ねばり名人', text: 'さいごまでさがした' },
    { name: 'ひらめき名人', text: 'ひらめいてヒントをえらんだ' },
    { name: 'みまもり名人', text: 'お店からみんなを見守った' },
    { name: 'ていねい名人', text: 'ひとつずつていねいにえらんだ' },
    { name: 'おもてなし名人', text: 'お客さんを大切にした' }
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

  /* ── ルームに置く形 ──
     h: 席ごとの品物 "id,id,…"・o: 席ごとのほしい物（なしは "-"）・pt: 席ごとのポイント・
     st: 席ごとの "hit.give.odd.ask.fit"・deck: 補充の山 "id,…"・turn・hits・odds・over */
  const list = function (v) { return Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).sort(function (a, b) { return a - b; }).map(function (k) { return v[k]; }) : []); };
  const ids = function (str) { return typeof str === 'string' && str ? str.split(',').filter(function (id) { return !!BY_ID[id]; }) : []; };

  function toRoom(s) {
    return {
      h: s.players.map(function (p) { return p.hand.join(','); }),
      o: s.players.map(function (p) { return p.order || '-'; }),
      pt: s.players.map(function (p) { return p.points; }),
      st: s.players.map(function (p) { return [p.stat.hit, p.stat.give, p.stat.odd, p.stat.ask, p.stat.fit].join('.'); }),
      deck: s.deck.join(','),
      turn: s.turn, hits: s.hits, odds: s.odds, over: !!s.over
    };
  }

  // こわれた値は、その所だけはじめの値で読む。人数が合わないときは null
  function fromRoom(raw, n) {
    if (!raw || typeof raw !== 'object' || !(n >= MIN_PLAYERS && n <= MAX_PLAYERS)) return null;
    const h = list(raw.h), o = list(raw.o), pt = list(raw.pt), st = list(raw.st);
    const players = [];
    for (let i = 0; i < n; i++) {
      const p = newPlayer();
      p.hand = ids(h[i]);
      p.order = typeof o[i] === 'string' && BY_ID[o[i]] ? o[i] : null;
      p.points = Math.max(0, Number(pt[i]) || 0);
      const v = String(st[i] || '').split('.').map(function (x) { return Math.max(0, Number(x) || 0); });
      p.stat = { hit: v[0] || 0, give: v[1] || 0, odd: v[2] || 0, ask: v[3] || 0, fit: v[4] || 0 };
      players.push(p);
    }
    const turn = Number(raw.turn);
    return {
      players: players,
      deck: ids(raw.deck),
      turn: Number.isInteger(turn) && turn >= 0 && turn < n ? turn : 0,
      hits: Math.max(0, Number(raw.hits) || 0),
      odds: Math.max(0, Number(raw.odds) || 0),
      over: raw.over === true
    };
  }

  return {
    TAGS: TAGS, ITEMS: ITEMS, MIN_PLAYERS: MIN_PLAYERS, MAX_PLAYERS: MAX_PLAYERS, HAND: HAND, HINTS: HINTS, ASK_MAX: ASK_MAX,
    PT_HIT: PT_HIT, PT_ODD: PT_ODD, PT_FIT: PT_FIT,
    item: item, isTag: isTag, matchScore: matchScore, fits: fits, newGame: newGame, holderOf: holderOf,
    answer: answer, resolve: resolve, titles: titles, toRoom: toRoom, fromRoom: fromRoom
  };
});
