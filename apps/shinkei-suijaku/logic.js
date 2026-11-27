/* 神経衰弱 ルームの決まり（DOM も Firebase も使わない。transaction の中から呼ぶ）
   ブラウザでは window.SS_LOGIC、node では module.exports（tests/shinkei-suijaku/logic.test.cjs）。
   カードの絵は「絵のキー」（ふつうの絵は Material Symbols の名前、激ムズは「形-数」）で共有する */
(function (root) {
  'use strict';

  const MAX_PLAYERS = 6;
  const MIN_PLAYERS = 2;
  const MAX_PROXIES = 4;
  const NAME_MAX = 8;

  const STATUS = {
    WAITING: 'waiting',
    PLAYING: 'playing',
    OVER: 'over',
  };

  function validNickname(value) {
    if (!value) return '名前を入れてね';
    if (value.length > NAME_MAX) return '名前は' + NAME_MAX + '文字までだよ';
    if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '記号 . # $ [ ] / は使えないよ';
    return '';
  }

  function randomSeed() {
    return Math.floor(Math.random() * 0x7fffffff);
  }

  // transaction の中で使う乱数は、外で作った種から決める（同じ種なら何度呼ばれても同じ結果）
  function seededRandom(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function asList(value) {
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      // RTDB は配列を {0:…,1:…} で返すことがある。番号の順に並べる
      return Object.keys(value).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => value[k]);
    }
    return [];
  }

  /* ── 山札 ── */
  // むずかしさの決まり（data.js の levels）と、使える絵のキーから、並べた山札（絵のキーの列）を作る
  function makeDeck(level, keys, seed) {
    const rng = seededRandom(seed);
    const faces = shuffled(keys, rng).slice(0, level.cards / 2);
    return shuffled(faces.concat(faces), rng);
  }

  /* ── ルームの読み取り ── */
  function byJoined(entries) {
    return entries
      .sort((a, b) => (Number(a[1] && a[1].joinedAt) || 0) - (Number(b[1] && b[1].joinedAt) || 0) || a[0].localeCompare(b[0], 'ja'))
      .map((e) => e[0]);
  }

  // 在室している人を参加順に
  function memberNames(room) {
    return byJoined(Object.entries((room && room.players) || {}));
  }

  // 端末なしの参加者（ホストが代わりにめくる）。切断しない
  function proxyNames(room) {
    return byJoined(Object.entries((room && room.proxies) || {}));
  }

  // 遊ぶ人（ホストは「ホストもいっしょに遊ぶ」のときだけ）。端末なしの参加者もふくめて参加順。
  // ホストが待合室で順番をシャッフルしたら（seats）、その順。あとから入った人は参加順でうしろに
  function playingNames(room) {
    const players = Object.entries((room && room.players) || {}).filter((e) => !(e[1] && e[1].isHost) || room.hostPlays !== false);
    const names = byJoined(players.concat(Object.entries((room && room.proxies) || {})));
    const seats = room && room.seats && typeof room.seats === 'object' ? room.seats : null;
    if (!seats) return names;
    const seat = (name) => (Number.isFinite(seats[name]) ? seats[name] : Number.MAX_SAFE_INTEGER);
    return names.map((name, i) => [name, i]).sort((a, b) => seat(a[0]) - seat(b[0]) || a[1] - b[1]).map((e) => e[0]);
  }

  // 遊ぶ人の順番をシャッフルする（待合室だけ）。seats に {名前: 何番め} を持つ
  function shuffleSeats(room, seed) {
    if (!room || room.status === STATUS.PLAYING) return null;
    const names = playingNames(room);
    if (names.length < 2) return null;
    // 押したのに同じ並びのままにならないよう、ちがう並びが出るまで引きなおす
    const rng = seededRandom(seed);
    let order = shuffled(names, rng);
    for (let k = 0; k < 20 && order.every((name, i) => name === names[i]); k++) order = shuffled(names, rng);
    return Object.assign({}, room, { seats: Object.fromEntries(order.map((name, i) => [name, i])) });
  }

  function gameOf(room) {
    const game = room && room.game;
    return game && typeof game === 'object' ? game : null;
  }

  function orderOf(game) {
    return asList(game && game.order).filter((name) => typeof name === 'string');
  }

  function isProxy(game, name) {
    return !!(game && game.proxy && game.proxy[name] === true);
  }

  // いまルームにいるか（端末なしの参加者はいつもいる）
  function present(room, game, name) {
    return isProxy(game, name) || !!(room && room.players && room.players[name]);
  }

  // このゲームで、その名前を持っている端末か（端末なしの参加者はだれも持たない）
  function ownsName(game, name, uid) {
    return !!uid && !!(game && game.uids && game.uids[name] === uid);
  }

  // 山札（絵のキーの列）。壊れていたら null
  function deckOf(game) {
    const deck = asList(game && game.deck);
    if (deck.length < 2 || deck.length % 2 || deck.some((k) => typeof k !== 'string' || !k)) return null;
    return deck;
  }

  // 取ったカード。山札と同じ長さの true/false の列
  function gotOf(game) {
    const deck = deckOf(game) || [];
    const got = asList(game && game.got);
    return deck.map((_, i) => got[i] === true);
  }

  function pairsOf(game) {
    const list = asList(game && game.pairs);
    return orderOf(game).map((_, i) => {
      const n = list[i];
      return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0;
    });
  }

  function turnOf(game) {
    const t = Number(game && game.turn);
    const n = orderOf(game).length;
    return Number.isInteger(t) && t >= 0 && t < n ? t : 0;
  }

  function actorOf(game) {
    const name = orderOf(game)[turnOf(game)];
    return name == null ? null : name;
  }

  // めくってある1枚め（なければ -1）
  function openOf(game) {
    const deck = deckOf(game) || [];
    const n = Number(game && game.open);
    return Number.isInteger(n) && n >= 0 && n < deck.length && !gotOf(game)[n] ? n : -1;
  }

  // 直前に2枚めくった結果 { a, b, match, turn, n }。壊れていたら null
  function revealOf(game) {
    const r = game && game.reveal;
    const deck = deckOf(game) || [];
    if (!r || typeof r !== 'object') return null;
    const a = Number(r.a), b = Number(r.b), turn = Number(r.turn), n = Number(r.n);
    if (![a, b, turn, n].every(Number.isInteger)) return null;
    if (a < 0 || b < 0 || a >= deck.length || b >= deck.length || a === b) return null;
    if (turn < 0 || turn >= orderOf(game).length) return null;
    return { a: a, b: b, match: r.match === true, turn: turn, n: n };
  }

  function flipNoOf(game) {
    const n = Number(game && game.flipNo);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  // 自分が、いまの番でカードをめくってよいか。番の人の端末と、ホスト（だれの番でも代わりにめくれる）
  function canAct(room, uid, nickname, role) {
    const game = gameOf(room);
    if (!game || room.status !== STATUS.PLAYING || !uid) return false;
    if (role === 'host' && room.hostUid === uid) return true;
    const actor = actorOf(game);
    return role === 'guest' && actor === nickname && ownsName(game, actor, uid);
  }

  // 次の番の人。順番どおりに回し、いない人はとばす。だれもいなければ、いまの人のまま
  function nextTurn(room, game) {
    const order = orderOf(game);
    const from = turnOf(game);
    for (let k = 1; k <= order.length; k++) {
      const i = (from + k) % order.length;
      if (present(room, game, order[i])) return i;
    }
    return from;
  }

  // いちばん多く取った人（全員同じなら tie）
  function resultOf(game) {
    const order = orderOf(game);
    const pairs = pairsOf(game);
    const max = Math.max.apply(null, pairs.concat([0]));
    const tops = order.filter((_, i) => pairs[i] === max);
    return { max: max, tops: tops, tie: tops.length === order.length };
  }

  /* ── 進行（どれも新しいルームを返す。進められないときは null） ── */
  // first: はじめにめくる人（遊ぶ人の並びの番号。人数で割ったあまりを使う）
  function startGame(room, level, keys, seed, first) {
    if (!room || room.status === STATUS.PLAYING) return null;
    const names = playingNames(room);
    if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) return null;
    if (!level || !(level.cards >= 2) || keys.length < level.cards / 2) return null;
    const id = (Number(room.lastGameId) || 0) + 1;
    const proxies = room.proxies || {};
    const real = names.filter((name) => !proxies[name]);
    const deck = makeDeck(level, keys, seed);
    const start = ((Number(first) || 0) % names.length + names.length) % names.length;
    const game = {
      id: id,
      level: level.id,           // 「はじめる」の時点のむずかしさで固定
      order: names,              // 参加した順（ホストが遊ぶときはホストが最初）。待合室でシャッフルしたらその順
      uids: Object.fromEntries(real.map((name) => [name, room.players[name].uid])),
      joined: Object.fromEntries(real.map((name) => [name, Number(room.players[name].joinedAt) || 0])),
      proxy: Object.keys(proxies).length ? Object.fromEntries(Object.keys(proxies).map((name) => [name, true])) : null,
      deck: deck,
      got: deck.map(() => false),
      pairs: names.map(() => 0),
      first: start,
      turn: start,
      open: -1,
      flipNo: 0,
      reveal: null,
    };
    return Object.assign({}, room, { status: STATUS.PLAYING, lastGameId: id, game: game });
  }

  // 1枚めくる。押した時点の flipNo と一致するときだけ（番の人とホストが同時に押しても1回だけ）。
  // 2枚めなら、その場で結果を決める（そろえば取って同じ人がもう1回、ちがえば次の人へ）。
  // 2枚の絵は reveal に残し、各端末がしばらく表のまま見せてから裏にもどす
  function flip(room, gameId, flipNo, i) {
    const game = gameOf(room);
    if (!room || room.status !== STATUS.PLAYING || !game || game.id !== gameId) return null;
    if (flipNoOf(game) !== flipNo) return null;
    const deck = deckOf(game);
    if (!deck || !Number.isInteger(i) || i < 0 || i >= deck.length) return null;
    const got = gotOf(game);
    const open = openOf(game);
    if (got[i] || open === i) return null;
    if (open < 0) {
      return Object.assign({}, room, { game: Object.assign({}, game, { open: i, flipNo: flipNo + 1 }) });
    }
    const turn = turnOf(game);
    const match = deck[open] === deck[i];
    const pairs = pairsOf(game);
    const next = Object.assign({}, game, {
      open: -1,
      flipNo: flipNo + 1,
      reveal: { a: open, b: i, match: match, turn: turn, n: (revealOf(game) ? revealOf(game).n : 0) + 1 },
    });
    if (match) {
      got[open] = true;
      got[i] = true;
      pairs[turn] += 1;
      next.got = got;
      next.pairs = pairs;
      if (got.every(Boolean)) {
        return Object.assign({}, room, { status: STATUS.OVER, game: next });
      }
    } else {
      next.turn = nextTurn(room, game);
    }
    return Object.assign({}, room, { game: next });
  }

  // めくる番の人がいなくなったら（退出・切断）、めくりかけを裏にもどして、次にいる人へとばす（ホストの見はりと退出から）
  function skipAbsent(room) {
    const game = gameOf(room);
    if (!room || room.status !== STATUS.PLAYING || !game) return null;
    const actor = actorOf(game);
    if (actor == null || present(room, game, actor)) return null;
    const turn = nextTurn(room, game);
    if (turn === turnOf(game)) return null;
    return Object.assign({}, room, { game: Object.assign({}, game, { turn: turn, open: -1, flipNo: flipNoOf(game) + 1 }) });
  }

  // 自分の番で退出したとき: めくりかけを裏にもどして次の人へ（退出した人はもう在室にいない状態で呼ぶ）
  function passTurn(room) {
    const game = gameOf(room);
    if (!room || room.status !== STATUS.PLAYING || !game) return null;
    const turn = nextTurn(room, game);
    return Object.assign({}, room, { game: Object.assign({}, game, { turn: turn, open: -1, flipNo: flipNoOf(game) + 1 }) });
  }

  // 待合室にもどる（ゲームの途中・おわりのあと。ホスト）
  function backToWaiting(room, gameId) {
    const game = gameOf(room);
    if (!game || game.id !== gameId || (room.status !== STATUS.PLAYING && room.status !== STATUS.OVER)) return null;
    return Object.assign({}, room, { status: STATUS.WAITING, game: null });
  }

  const api = {
    MAX_PLAYERS, MIN_PLAYERS, MAX_PROXIES, NAME_MAX, STATUS,
    validNickname, randomSeed, seededRandom, asList, makeDeck,
    memberNames, proxyNames, playingNames, shuffleSeats, gameOf, orderOf, isProxy, present, ownsName,
    deckOf, gotOf, pairsOf, turnOf, actorOf, openOf, revealOf, flipNoOf, canAct, nextTurn, resultOf,
    startGame, flip, skipAbsent, passTurn, backToWaiting,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SS_LOGIC = api;
})(typeof window !== 'undefined' ? window : globalThis);
