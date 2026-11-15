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

  // 品物。ヒントは3つずつ（どの2つの品物も、3つの組が同じにならない）。2つだけ聞くと、ほかの品物とまぎれることがある。
  // 名前には特徴の言葉を入れない（2026-11-15 オーナー「名前とモノが一致しているものは当てるのが簡単」）。
  // 特徴は絵（羽・きらきら・湯気・音符・雪の結晶・はねた跡・もこもこ・形）で見て考える。名前の頭は性格を表すおもしろい言葉
  const ITEMS = [
    { id: 'kotatsu', name: 'ねぼすけこたつ', tags: ['とぶ', 'あたたかい', '大きい'] },
    { id: 'onigiri', name: 'はずかしがりのおにぎり', tags: ['光る', '小さい', 'あたたかい'] },
    { id: 'iwa', name: 'のんびり岩', tags: ['ふわふわ', '大きい', 'まるい'] },
    { id: 'purin', name: 'ごきげんプリン', tags: ['はねる', 'あまい', '小さい'] },
    { id: 'yakan', name: 'いばりんぼのやかん', tags: ['音が出る', 'あたたかい', 'かたい'] },
    { id: 'taiyaki', name: 'まいごのたいやき', tags: ['つめたい', 'あまい', '小さい'] },
    { id: 'mafura', name: 'おしゃれなマフラー', tags: ['ながい', 'ふわふわ', 'あたたかい'] },
    { id: 'kujira', name: 'ゆかいなクジラ風船', tags: ['とぶ', '大きい', 'まるい'] },
    { id: 'wataame', name: 'ひみつのわたあめ', tags: ['光る', 'ふわふわ', 'あまい'] },
    { id: 'koori', name: 'せっかちな氷', tags: ['はねる', 'つめたい', 'かたい'] },
    { id: 'donatsu', name: 'うっかりドーナツ', tags: ['音が出る', 'あまい', 'まるい'] },
    { id: 'biidama', name: 'ものしりビー玉', tags: ['大きい', 'まるい', 'かたい'] },
    { id: 'yukidaruma', name: 'がんばりやの雪だるま', tags: ['とぶ', 'つめたい', 'まるい'] },
    { id: 'aisu', name: 'きまぐれなアイス', tags: ['ながい', 'つめたい', 'あまい'] },
    { id: 'nawatobi', name: 'ほがらかななわとび', tags: ['光る', 'ながい', 'はねる'] },
    { id: 'taiko', name: 'おすましのたいこ', tags: ['小さい', '音が出る', 'まるい'] },
    { id: 'rappa', name: 'あわてんぼのラッパ', tags: ['ふわふわ', '音が出る', 'ながい'] },
    { id: 'makura', name: 'よくばりなまくら', tags: ['はねる', 'ふわふわ', '大きい'] },
    { id: 'ishi', name: 'まじめな石', tags: ['あたたかい', 'かたい', '小さい'] },
    { id: 'hoshi', name: 'いたずらな星のかざり', tags: ['とぶ', '光る', '小さい'] },
    { id: 'tokei', name: 'おおらかな時計', tags: ['大きい', '音が出る', 'かたい'] },
    { id: 'boru', name: 'ごきげんボール', tags: ['光る', 'まるい', 'はねる'] },
    { id: 'tako', name: 'のんびりたこ', tags: ['とぶ', 'ながい', '大きい'] },
    { id: 'manju', name: 'はずかしがりのまんじゅう', tags: ['あたたかい', 'あまい', 'まるい'] },
    // 12人まで遊べるように足した36種類（2026-11-15）
    { id: 'kasa', name: 'ふしぎなかさ', tags: ['音が出る', 'ながい', 'とぶ'] },
    { id: 'shabon', name: 'おすましのシャボン玉', tags: ['光る', 'とぶ', 'まるい'] },
    { id: 'furaipan', name: 'いばりんぼのフライパン', tags: ['ふわふわ', 'あたたかい', '大きい'] },
    { id: 'kakigoori', name: 'ひみつのかき氷', tags: ['光る', 'つめたい', 'あまい'] },
    { id: 'zerii', name: 'ゆかいなゼリー', tags: ['はねる', 'つめたい', 'あまい'] },
    { id: 'meronpan', name: 'ねぼすけメロンパン', tags: ['ながい', 'あまい', 'ふわふわ'] },
    { id: 'tsurara', name: 'まじめなつらら', tags: ['光る', 'つめたい', 'ながい'] },
    { id: 'kumo', name: 'まいごの雲', tags: ['小さい', 'ふわふわ', 'とぶ'] },
    { id: 'juutan', name: 'せっかちなじゅうたん', tags: ['とぶ', 'ながい', 'ふわふわ'] },
    { id: 'suzu', name: 'おしゃれな鈴', tags: ['大きい', '音が出る', 'まるい'] },
    { id: 'rantan', name: 'ものしりランタン', tags: ['光る', 'あたたかい', 'かたい'] },
    { id: 'mashumaro', name: 'うっかりマシュマロ', tags: ['はねる', 'あまい', 'ふわふわ'] },
    { id: 'kusshon', name: 'おおらかなクッション', tags: ['つめたい', 'ふわふわ', 'まるい'] },
    { id: 'donguri', name: 'がんばりやのどんぐり', tags: ['音が出る', 'まるい', 'かたい'] },
    { id: 'kukkii', name: 'いたずらなクッキー', tags: ['とぶ', 'あまい', 'かたい'] },
    { id: 'ame', name: 'きまぐれなアメ', tags: ['光る', 'あまい', 'まるい'] },
    { id: 'hottokeeki', name: 'ほがらかなホットケーキ', tags: ['大きい', 'あたたかい', 'あまい'] },
    { id: 'supuun', name: 'あわてんぼのスプーン', tags: ['ながい', 'かたい', '光る'] },
    { id: 'koorinoisu', name: 'よくばりな氷のいす', tags: ['大きい', 'つめたい', 'かたい'] },
    { id: 'bane', name: 'ふしぎなばね', tags: ['はねる', 'ながい', 'かたい'] },
    { id: 'gomuboru', name: 'のんびりゴムボール', tags: ['音が出る', 'はねる', 'まるい'] },
    { id: 'reizouko', name: 'ものしりな冷蔵庫', tags: ['音が出る', 'つめたい', '大きい'] },
    { id: 'sutoobu', name: 'ごきげんストーブ', tags: ['とぶ', 'あたたかい', 'かたい'] },
    { id: 'keitodama', name: 'はずかしがりの毛糸玉', tags: ['ながい', 'ふわふわ', 'まるい'] },
    { id: 'kinoko', name: 'ねぼすけきのこ', tags: ['光る', '小さい', 'まるい'] },
    { id: 'sofuto', name: 'おすましのソフトクリーム', tags: ['とぶ', 'つめたい', 'あまい'] },
    { id: 'omochi', name: 'いばりんぼのおもち', tags: ['はねる', 'あたたかい', 'まるい'] },
    { id: 'tanpopo', name: 'ゆかいなたんぽぽ', tags: ['大きい', 'ふわふわ', 'とぶ'] },
    { id: 'piano', name: 'まいごのピアノ', tags: ['小さい', '音が出る', 'かたい'] },
    { id: 'futon', name: 'せっかちなふとん', tags: ['つめたい', 'ふわふわ', '大きい'] },
    { id: 'kutsu', name: 'おしゃれなくつ', tags: ['光る', 'はねる', '小さい'] },
    { id: 'kagami', name: 'ひみつのかがみ', tags: ['とぶ', '光る', 'かたい'] },
    { id: 'onabe', name: 'まじめなおなべ', tags: ['はねる', '音が出る', 'あたたかい'] },
    { id: 'keeki', name: 'うっかりケーキ', tags: ['音が出る', 'あまい', '大きい'] },
    { id: 'yukidama', name: 'きまぐれな雪玉', tags: ['小さい', 'つめたい', 'まるい'] },
    { id: 'hebi', name: 'がんばりやのおもちゃのヘビ', tags: ['ながい', 'はねる', '小さい'] }
  ];
  const BY_ID = {};
  ITEMS.forEach(function (it) { BY_ID[it.id] = it; });

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 12;
  const HAND = 4;        // はじめの品物の数（12人で48こ。のこり12こが補充の山）
  const HINTS = 2;       // 1回に聞けるヒント
  const ASK_MAX = 2;     // お店の人が、1人のお客さんにできる質問の数
  const PT_HIT = 3;      // ぴったり: お客さん・出したお店の人に
  const PT_ODD = 1;      // ちがう物: お客さんに
  const PT_MISS = -1;    // ちがう物: 出したお店の人（0より下にはしない）
  const PT_FIT = 1;      // えらばれなかったけれど、ヒント2つに合う物を出したお店に
  const PT_NO = 1;       // ヒントに合う物が自分のお店になくて「出さない」をえらんだお店に。その番にぴったりが届いたときだけ
  const PT_VOTE = 1;     // 品物を出さなかったお店の人が「おすすめ」した箱が、ぴったりだったとき
  // とりあえず出すほうが得にならないように（2026-11-15 オーナー「ポイントをもらえるならとりあえず出しておいたほうが得、という意見」）
  // 正しく断れたら1ポイント、ちがう物が選ばれたら出したお店は1ポイント減る。
  // そのあと試算で「いつも断る」が「考えて出す」とほぼ同じになると分かり（12人ではポイントの大半が断った分）、
  // オーナー「面白くなるようにおまかせ」で: ぴったりを3に・断った分はぴったりの番だけ・おすすめを足した

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

  function newPlayer() { return { hand: [], order: null, points: 0, stat: { hit: 0, give: 0, odd: 0, ask: 0, fit: 0, no: 0, vote: 0 } }; }

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
     away: いまルームにいない人の席 { 席: true }。declined: 「出さない」をえらんだお店の席 [席, …]
     votes: 品物を出さなかったお店の人の「おすすめ」 { 席: おすすめした箱のお店の席 }
     返す値の delta は、席ごとに実際に増えた（減った）ポイント */
  function resolve(s, offers, chosen, hints, asked, rng, away, declined, votes) {
    rng = rng || Math.random;
    const c = s.turn;
    const req = s.players[c];
    const wanted = req.order;
    const delta = {};
    const add = function (i, n) {
      const p = s.players[i];
      const before = p.points;
      p.points = Math.max(0, p.points + n);
      delta[i] = (delta[i] || 0) + (p.points - before);
    };
    Object.keys(asked || {}).forEach(function (k) {
      const i = Number(k);
      if (s.players[i] && i !== c) s.players[i].stat.ask += Math.max(0, Math.min(ASK_MAX, Number(asked[k]) || 0));
    });
    // 正しく断れた: ヒントに合う物が自分のお店になくて、「出さない」をえらんだ（品物が動く前のお店で見る）。
    // ポイントは、その番にぴったりが届いたときだけ（下で足す）
    const noCand = [];
    (declined || []).forEach(function (i) {
      if (!s.players[i] || i === c || noCand.indexOf(i) >= 0 || !hints.length) return;
      if (s.players[i].hand.some(function (id) { return fits(id, hints); })) return;
      noCand.push(i);
    });
    const no = [];
    const vote = [];
    let res;
    const pickOffer = chosen >= 0 ? offers[chosen] : null;
    const valid = pickOffer && s.players[pickOffer.from] && pickOffer.from !== c && s.players[pickOffer.from].hand.indexOf(pickOffer.item) >= 0;
    if (!valid) {
      req.order = null;
      res = { none: true, c: c, wanted: wanted, fit: [], no: no, vote: vote, delta: delta };
    } else {
      const giver = s.players[pickOffer.from];
      giver.hand.splice(giver.hand.indexOf(pickOffer.item), 1);
      const hit = pickOffer.item === wanted;
      add(c, hit ? PT_HIT : PT_ODD);
      add(pickOffer.from, hit ? PT_HIT : PT_MISS);
      if (hit) { s.hits++; req.stat.hit++; } else { s.odds++; req.stat.odd++; giver.stat.odd++; }
      giver.stat.give++;
      if (s.deck.length) giver.hand.push(s.deck.shift());
      // えらばれなかったけれど、ヒントに合う物を出したお店にも1ポイント（品物はお店に残る）
      const fit = [];
      offers.forEach(function (o, k) {
        if (k === chosen || !s.players[o.from] || o.from === c || o.from === pickOffer.from) return;
        if (fit.indexOf(o.from) >= 0 || !fits(o.item, hints)) return;
        if (s.players[o.from].hand.indexOf(o.item) < 0) return;
        add(o.from, PT_FIT);
        s.players[o.from].stat.fit++;
        fit.push(o.from);
      });
      if (hit) {
        // みんなでぴったりが届いた番: 正しく断れたお店と、ぴったりの箱をおすすめした人に
        noCand.forEach(function (i) { add(i, PT_NO); s.players[i].stat.no++; no.push(i); });
        const offered = offers.map(function (o) { return o.from; });
        Object.keys(votes || {}).forEach(function (k) {
          const i = Number(k);
          if (!s.players[i] || i === c || offered.indexOf(i) >= 0 || Number(votes[k]) !== pickOffer.from) return;
          add(i, PT_VOTE);
          s.players[i].stat.vote++;
          vote.push(i);
        });
      }
      req.order = null;
      res = { none: false, hit: hit, c: c, wanted: wanted, got: pickOffer.item, from: pickOffer.from, pc: delta[c] || 0, pg: delta[pickOffer.from] || 0, fit: fit, no: no, vote: vote, delta: delta };
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
    { key: 'ask', name: 'しつもん名人', text: '質問してからえらんだ' },
    { key: 'no', name: 'つたえ名人', text: 'ないときは、ないとはっきり伝えた' },
    { key: 'vote', name: 'みきわめ名人', text: 'ぴったりの箱をおすすめした' }
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
     st: 席ごとの "hit.give.odd.ask.fit.no.vote"・deck: 補充の山 "id,…"・turn・hits・odds・over */
  const list = function (v) { return Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).sort(function (a, b) { return a - b; }).map(function (k) { return v[k]; }) : []); };
  const ids = function (str) { return typeof str === 'string' && str ? str.split(',').filter(function (id) { return !!BY_ID[id]; }) : []; };

  function toRoom(s) {
    return {
      h: s.players.map(function (p) { return p.hand.join(','); }),
      o: s.players.map(function (p) { return p.order || '-'; }),
      pt: s.players.map(function (p) { return p.points; }),
      st: s.players.map(function (p) { return [p.stat.hit, p.stat.give, p.stat.odd, p.stat.ask, p.stat.fit, p.stat.no, p.stat.vote].join('.'); }),
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
      p.stat = { hit: v[0] || 0, give: v[1] || 0, odd: v[2] || 0, ask: v[3] || 0, fit: v[4] || 0, no: v[5] || 0, vote: v[6] || 0 };
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
    PT_HIT: PT_HIT, PT_ODD: PT_ODD, PT_MISS: PT_MISS, PT_FIT: PT_FIT, PT_NO: PT_NO, PT_VOTE: PT_VOTE,
    item: item, isTag: isTag, matchScore: matchScore, fits: fits, newGame: newGame, holderOf: holderOf,
    answer: answer, resolve: resolve, titles: titles, toRoom: toRoom, fromRoom: fromRoom
  };
});
