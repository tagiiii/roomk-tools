/* かくれ怪盗のルールだけ。画面・通信に触らない（node でも読める）。
   警備員チームと、警備員に変装してまざった怪盗チームの、正体をかくした対戦。 */
(function (root) {
  'use strict';

  const MIN = 4;
  const MAX = 10;
  // 人数ごとの怪盗の人数（4人は独自に1人）
  const THIEVES = { 4: 1, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };
  // 人数ごとの、各回の見回りの人数
  const TEAM = {
    4: [2, 2, 2, 3, 3],
    5: [2, 3, 2, 3, 3],
    6: [2, 3, 4, 3, 4],
    7: [2, 3, 3, 4, 4],
    8: [3, 4, 4, 5, 5],
    9: [3, 4, 4, 5, 5],
    10: [3, 4, 4, 5, 5],
  };
  const ROUNDS = 5;
  const WIN = 3;
  const PROPOSALS = 5; // 1回の見回りで、メンバーを選べる回数

  // 役。side: guard（警備員チーム）| thief（怪盗チーム）
  const ROLES = {
    guard: { side: 'guard', name: '警備員', icon: 'local_police' },
    detective: { side: 'guard', name: '名探偵', icon: 'search' },
    assistant: { side: 'guard', name: '助手', icon: 'menu_book' },
    thief: { side: 'thief', name: '怪盗', icon: 'theater_comedy' },
    fake: { side: 'thief', name: 'にせ探偵', icon: 'person_search' },
    disguise: { side: 'thief', name: '変装名人', icon: 'masks' },
    lone: { side: 'thief', name: 'ひとり怪盗', icon: 'person' },
  };

  // 待合室で選ぶ役。detective＝名探偵と最後の見やぶり
  const DEFAULT_OPTS = { detective: true, assistant: false, fake: false, disguise: false, lone: false, lens: false, fifthGo: true, talk: 0 };
  const TALKS = [0, 60, 120, 180]; // 話し合いの時間（秒）。0 は制限なし

  const normOpts = (o) => {
    const a = Object.assign({}, DEFAULT_OPTS, o || {});
    if (!a.detective) { a.assistant = false; a.fake = false; a.disguise = false; }
    if (!a.assistant) a.fake = false;
    if (!TALKS.includes(a.talk)) a.talk = 0;
    return a;
  };

  // その人数で、選んだ役が入りきるか。入らなければ理由を返す
  function checkOpts(n, opts) {
    const o = normOpts(opts);
    if (n < MIN) return 'あと' + (MIN - n) + '人入ると、はじめられるよ';
    if (n > MAX) return '遊べるのは' + MAX + '人までだよ';
    const t = THIEVES[n];
    const guardsSpecial = (o.detective ? 1 : 0) + (o.assistant ? 1 : 0);
    const thiefSpecial = (o.fake ? 1 : 0) + (o.disguise ? 1 : 0) + (o.lone ? 1 : 0);
    if (guardsSpecial > n - t) return '警備員チームの役が多すぎるよ';
    if (thiefSpecial > t) return n + '人だと怪盗は' + t + '人なので、怪盗チームの役は' + t + 'つまでだよ';
    return '';
  }

  function shuffle(list, rnd) {
    const a = list.slice();
    const r = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // 役を配る。ids は遊ぶ人。返り値 { roles: {id: role}, boss: id | null, order: [id] }
  // boss＝最後の見やぶりで名探偵を選ぶ怪盗（名探偵がいるときだけ）
  function deal(ids, opts, rnd) {
    const o = normOpts(opts);
    const n = ids.length;
    if (checkOpts(n, o)) return null;
    const t = THIEVES[n];
    const thiefRoles = [];
    if (o.fake) thiefRoles.push('fake');
    if (o.disguise) thiefRoles.push('disguise');
    if (o.lone) thiefRoles.push('lone');
    while (thiefRoles.length < t) thiefRoles.push('thief');
    const guardRoles = [];
    if (o.detective) guardRoles.push('detective');
    if (o.assistant) guardRoles.push('assistant');
    while (guardRoles.length < n - t) guardRoles.push('guard');
    const shuffled = shuffle(ids, rnd);
    const deck = thiefRoles.concat(guardRoles);
    const roles = {};
    shuffled.forEach((id, i) => { roles[id] = deck[i]; });
    let boss = null;
    if (o.detective) {
      const thieves = ids.filter((id) => ROLES[roles[id]].side === 'thief');
      // ひとり怪盗は仲間を知らないので、ほかに怪盗がいればそちらにする
      const pool = thieves.filter((id) => roles[id] !== 'lone');
      const from = pool.length ? pool : thieves;
      boss = from[Math.floor((rnd || Math.random)() * from.length)];
    }
    return { roles, boss, order: shuffle(ids, rnd) };
  }

  const sideOf = (role) => (ROLES[role] ? ROLES[role].side : null);

  // その人が、はじめに知っていること
  // 返り値 [{ kind, ids }]  kind: thieves（怪盗はこの人たち）| detective（名探偵はこの中に）| mates（仲間の怪盗）
  function knows(roles, id, rnd) {
    const me = roles[id];
    const ids = Object.keys(roles);
    const out = [];
    if (me === 'detective') {
      out.push({ kind: 'thieves', ids: ids.filter((x) => sideOf(roles[x]) === 'thief' && roles[x] !== 'disguise') });
    } else if (me === 'assistant') {
      out.push({ kind: 'detective', ids: shuffle(ids.filter((x) => roles[x] === 'detective' || roles[x] === 'fake'), rnd) });
    } else if (sideOf(me) === 'thief' && me !== 'lone') {
      out.push({ kind: 'mates', ids: ids.filter((x) => x !== id && sideOf(roles[x]) === 'thief' && roles[x] !== 'lone') });
    }
    return out;
  }

  const teamSize = (n, round) => TEAM[n][round];
  // 7人以上の4回目だけ、すり替えが2枚ないと失敗にならない
  const needFails = (n, round) => (n >= 7 && round === 3 ? 2 : 1);

  // 投票: votes {id: true|false}。過半数の賛成で出発（同数は出発しない）
  function approved(votes) {
    const v = Object.values(votes);
    const yes = v.filter(Boolean).length;
    return yes * 2 > v.length;
  }

  // 見回りの結果: cards は 'safe' | 'swap' の並び
  function missionResult(n, round, cards) {
    const swaps = cards.filter((c) => c === 'swap').length;
    return { swaps, safe: cards.length - swaps, ok: swaps < needFails(n, round) };
  }

  // 勝ち負け: results は各回の ok（true/false）の並び
  // 返り値 null（まだ）| 'guard'（3回守った。見やぶりの前）| 'thief'（3回すり替え）
  function score(results) {
    const g = results.filter((r) => r === true).length;
    const t = results.filter((r) => r === false).length;
    if (t >= WIN) return 'thief';
    if (g >= WIN) return 'guard';
    return null;
  }

  // しらべのルーペ: 2・3・4回目の見回りのあとに使う（round は 0 から数える）
  const LENS_MIN = 7; // ルーペは7人から（着想元と同じ）
  const lensOn = (n, opts) => !!(opts && opts.lens) && n >= LENS_MIN;
  const lensAfter = (round) => round >= 1 && round <= 3;
  // 確かめられるのは、まだルーペを持ったことのない人だけ
  const lensTargets = (players, used) => players.filter((id) => !used.includes(id));
  // はじめに持つのは、最初の主任のひとつ前の人
  const lensFirst = (order) => order[order.length - 1];

  // 選んではいけない手: 警備員チームは「すり替える」を選べない
  const canSwap = (role) => sideOf(role) === 'thief';

  const api = {
    MIN, MAX, THIEVES, TEAM, ROUNDS, WIN, PROPOSALS, ROLES, DEFAULT_OPTS, TALKS, LENS_MIN, lensOn, lensAfter, lensTargets, lensFirst,
    normOpts, checkOpts, deal, sideOf, knows, teamSize, needFails, approved, missionResult, score, canSwap, shuffle,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KaitoEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
