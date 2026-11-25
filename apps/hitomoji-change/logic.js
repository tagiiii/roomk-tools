/* ひともじチェンジ — ことばの決まりとルームの決まり（画面・通信を持たない）
   ブラウザでは window.HMC_LOGIC、Node（tests/hitomoji-change）では module.exports で使う。
   ルームの操作は「いまのルームを受けとって、新しいルームを返す（できないときは null）」形にして、
   そのまま transaction の中で呼ぶ */
(function (root) {
  'use strict';

  const STATUS = { WAITING: 'waiting', PLAYING: 'playing' };
  const ORDERS = ['turn', 'free'];          // 順番に / だれでも
  const JUDGES = ['host', 'all'];           // ことばの判定: ホストが決める / みんなで決める
  const LEVEL_IDS = ['two', 'three', 'custom'];
  const MAX_PLAYERS = 12;                   // 遊ぶ人（端末なしの参加者をふくむ）
  const MAX_PROXIES = 4;
  const MIN_CHARS = 2;
  const MAX_CHARS = 5;
  const KANA_RE = /^[ぁ-ゖー]+$/;
  const KANA_ONE_RE = /^[ぁ-ゖー]$/;
  const NAME_MAX = 8;
  const NAME_BAD_RE = /[.#$\[\]\/\u0000-\u001f\u007f]/;

  const chars = (w) => Array.from(String(w || ''));

  /* ── ことば ── */
  function differsByOne(a, b) {
    const x = chars(a);
    const y = chars(b);
    if (x.length !== y.length) return false;
    let d = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
    return d === 1;
  }

  // 言葉のリストで、from から goal までのいちばん短いつなぎ方（なければ null）
  function findPath(from, goal, vocab) {
    if (from === goal) return [from];
    const len = chars(from).length;
    const words = Array.from(new Set([...(vocab || []), goal])).filter((w) => chars(w).length === len && w !== from);
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const cur = queue.shift();
      for (const w of words) {
        if (prev.has(w) || !differsByOne(cur, w)) continue;
        prev.set(w, cur);
        if (w === goal) {
          const path = [];
          for (let x = goal; x !== null; x = prev.get(x)) path.unshift(x);
          return path;
        }
        queue.push(w);
      }
    }
    return null;
  }

  // 次の一歩（変える位置・次のことば・あと何回）
  function hintStep(current, goal, vocab) {
    const path = findPath(current, goal, vocab);
    if (!path || path.length < 2) return null;
    const a = chars(current);
    const b = chars(path[1]);
    return { pos: a.findIndex((c, i) => c !== b[i]), word: path[1], steps: path.length - 1 };
  }

  function toHiragana(s) {
    return String(s || '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // 自分で決めるお題（正しければ { chars, start, goal }、だめなら { error }）
  function readCustom(startRaw, goalRaw) {
    const start = toHiragana(String(startRaw || '').replace(/\s/g, ''));
    const goal = toHiragana(String(goalRaw || '').replace(/\s/g, ''));
    let error = '';
    if (!start || !goal) error = 'はじめのことばとゴールのことばを書いてね';
    else if (!KANA_RE.test(start) || !KANA_RE.test(goal)) error = 'ひらがなで書いてね';
    else if (chars(start).length !== chars(goal).length) error = '2つのことばの文字の数をそろえてね';
    else if (chars(start).length < MIN_CHARS || chars(start).length > MAX_CHARS) error = MIN_CHARS + '〜' + MAX_CHARS + '文字のことばにしてね';
    else if (start === goal) error = 'ちがうことばにしてね';
    return error ? { error } : { chars: chars(start).length, start, goal };
  }

  function validPuzzle(p) {
    if (!p || typeof p !== 'object') return false;
    const r = readCustom(p.start, p.goal);
    return !r.error && r.start === p.start && r.goal === p.goal;
  }

  function validNickname(name) {
    const n = String(name || '');
    if (!n.trim()) return '名前を入れてね';
    if (chars(n).length > NAME_MAX) return '名前は' + NAME_MAX + '文字までにしてね';
    if (NAME_BAD_RE.test(n)) return '記号 . # $ [ ] / は使えないよ';
    return '';
  }

  /* ── ルーム ── */
  const settingsOf = (room) => ({
    hostPlays: room?.settings?.hostPlays !== false,
    order: ORDERS.includes(room?.settings?.order) ? room.settings.order : 'turn',
    judge: JUDGES.includes(room?.settings?.judge) ? room.settings.judge : 'host',
    level: LEVEL_IDS.includes(room?.settings?.level) ? room.settings.level : 'two',
  });

  // 遊ぶ人（入った順）。端末なしの参加者もふくむ。進行だけのホストはふくまない
  function participants(room) {
    if (!room) return [];
    const s = settingsOf(room);
    const list = [];
    Object.entries(room.players || {}).forEach(([name, p]) => {
      if (!p || typeof p !== 'object') return;
      if (p.isHost && !s.hostPlays) return;
      list.push({ name, at: Number(p.joinedAt) || 0, proxy: false, host: !!p.isHost });
    });
    Object.entries(room.proxies || {}).forEach(([name, p]) => {
      list.push({ name, at: Number(p?.addedAt) || 0, proxy: true, host: false });
    });
    list.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return list;
  }

  const isProxy = (room, name) => !!room?.proxies?.[name];
  const isParticipant = (room, name) => participants(room).some((p) => p.name === name);

  function gameOf(room) {
    const g = room?.game;
    if (!g || typeof g !== 'object' || !validPuzzle(g.puzzle)) return null;
    const ladder = Array.isArray(g.ladder) ? g.ladder.filter((x) => x && typeof x.w === 'string') : [];
    if (!ladder.length || ladder[0].w !== g.puzzle.start) return null;
    const pending = g.pending && typeof g.pending.w === 'string' && g.pending.n === ladder.length ? g.pending : null;
    return { ...g, ladder, pending };
  }

  // ホストの判定を待っていることば（なければ null）
  const pendingOf = (room) => gameOf(room)?.pending || null;

  const currentWord = (g) => g.ladder[g.ladder.length - 1].w;

  // いまの番の人（記録した人がいなくなっていたら、そのあとに入った人。だれもいなければ null）
  function turnOf(room) {
    const g = gameOf(room);
    if (!g || settingsOf(room).order !== 'turn') return null;
    const list = participants(room);
    if (!list.length) return null;
    if (list.some((p) => p.name === g.turn)) return g.turn;
    const at = Number(g.turnAt) || 0;
    return (list.find((p) => p.at > at) || list[0]).name;
  }

  // name のつぎの人
  function nextAfter(room, name) {
    const list = participants(room);
    if (!list.length) return null;
    const i = list.findIndex((p) => p.name === name);
    return list[(i + 1) % list.length].name;
  }

  function withTurn(room, g, name) {
    const p = participants(room).find((x) => x.name === name);
    return { ...g, turn: name || null, turnAt: p ? p.at : 0 };
  }

  // actor（ホストの名前・遊ぶ人の名前）が、いまことばを変えられるか
  function canMove(room, actor) {
    const g = gameOf(room);
    if (!g || room.status !== STATUS.PLAYING || g.cleared || g.pending || !actor) return false;
    const isHost = actor === room.host;
    if (settingsOf(room).order === 'free') return isHost || isParticipant(room, actor);
    const turn = turnOf(room);
    if (!turn) return isHost;
    if (turn === actor) return true;
    // 端末なしの参加者の番は、ホストが代わりに入れる
    return isHost && isProxy(room, turn);
  }

  // 変えたことばを確定する（ここまでのことばに足して、順番のときはつぎの人へ）
  function commit(room, g, w, by) {
    const order = settingsOf(room).order;
    const turn = turnOf(room);
    let ng = { ...g, ladder: [...g.ladder, { w, by }], cleared: w === g.puzzle.goal, hint: null, pending: null };
    // 変えた人のつぎの人へ。仮に置いたあとで変えた人がいなくなっていたら、いまの番（もうそのつぎの人）のまま
    if (order === 'turn' && turn && !ng.cleared) ng = withTurn(room, ng, isParticipant(room, by) ? nextAfter(room, by) : turn);
    return { ...room, game: ng };
  }

  // ことばを変える（pos 文字目を ch に）。
  // 「ホストが決める」のときは、いったん仮に置いてホストの判定を待つ（ゴールのことば・ホストが押したときは、そのまま確定）
  function move(room, actor, pos, ch) {
    const g = gameOf(room);
    if (!g || !canMove(room, actor) || !KANA_ONE_RE.test(ch)) return null;
    const cur = chars(currentWord(g));
    if (!Number.isInteger(pos) || pos < 0 || pos >= cur.length || cur[pos] === ch) return null;
    cur[pos] = ch;
    const w = cur.join('');
    const s = settingsOf(room);
    const turn = turnOf(room);
    // 順番のときは、番の人（代わりに入れたときも番の人）の手として残す
    const by = s.order === 'turn' && turn ? turn : actor;
    if (s.judge === 'host' && actor !== room.host && w !== g.puzzle.goal) {
      return { ...room, game: { ...g, pending: { w, by, actor, n: g.ladder.length } } };
    }
    return commit(room, g, w, by);
  }

  // 仮に置いたことばを「OK」にする（ホストだけ）
  function approve(room, actor) {
    const g = gameOf(room);
    if (!g || !g.pending || g.cleared || room.status !== STATUS.PLAYING || actor !== room.host) return null;
    return commit(room, g, g.pending.w, g.pending.by);
  }

  // 仮に置いたことばを「やりなおし」にする（ホストと、押した本人）。番はそのまま、同じ人がもう一度選ぶ
  function canReject(room, actor) {
    const g = gameOf(room);
    if (!g || !g.pending || g.cleared || room.status !== STATUS.PLAYING || !actor) return false;
    return actor === room.host || actor === g.pending.actor;
  }

  function reject(room, actor) {
    const g = gameOf(room);
    if (!canReject(room, actor)) return null;
    return { ...room, game: { ...g, pending: null } };
  }

  // 1つ戻す: ホスト、または最後に変えた人（つぎの手がまだのとき）
  function canUndo(room, actor) {
    const g = gameOf(room);
    if (!g || room.status !== STATUS.PLAYING || g.cleared || g.pending || g.ladder.length < 2 || !actor) return false;
    if (actor === room.host) return true;
    return g.ladder[g.ladder.length - 1].by === actor;
  }

  function undo(room, actor) {
    const g = gameOf(room);
    if (!canUndo(room, actor)) return null;
    const last = g.ladder[g.ladder.length - 1];
    let ng = { ...g, ladder: g.ladder.slice(0, -1), hint: null };
    // 順番のときは、戻したことばを変えた人の番にもどす（いなければ、いまの番のまま）
    if (settingsOf(room).order === 'turn' && isParticipant(room, last.by)) ng = withTurn(room, ng, last.by);
    return { ...room, game: ng };
  }

  // パス: 番の人、またはホスト（だれの番でも、つぎの人へ）
  function canPass(room, actor) {
    const g = gameOf(room);
    if (!g || room.status !== STATUS.PLAYING || g.cleared || g.pending || settingsOf(room).order !== 'turn') return false;
    const turn = turnOf(room);
    if (!turn) return false;
    return actor === turn || actor === room.host;
  }

  function pass(room, actor) {
    const g = gameOf(room);
    if (!canPass(room, actor)) return null;
    const turn = turnOf(room);
    return { ...room, game: { ...withTurn(room, g, nextAfter(room, turn)), hint: null } };
  }

  // ヒント（ホストだけ）。同じことばのあいだは、1回目→2回目と進む
  function hint(room, actor) {
    const g = gameOf(room);
    if (!g || room.status !== STATUS.PLAYING || g.cleared || actor !== room.host) return null;
    const n = g.ladder.length;
    const stage = g.hint && g.hint.n === n ? Math.min(2, (Number(g.hint.stage) || 0) + 1) : 1;
    return { ...room, game: { ...g, hint: { n, stage } } };
  }

  // 出しているヒントの段（ことばが変わったら 0）
  function hintStageOf(g) {
    return g && g.hint && g.hint.n === g.ladder.length ? Number(g.hint.stage) || 0 : 0;
  }

  // お題を出す（はじめる・つぎのお題）。2文字・3文字の出したお題は seen に残し、出しきったら空にする
  function newGame(room, puzzle, seenKey, seenIdx) {
    if (!validPuzzle(puzzle)) return null;
    const id = (Number(room.game?.id) || 0) + 1;
    let g = { id, puzzle: { chars: puzzle.chars, start: puzzle.start, goal: puzzle.goal }, ladder: [{ w: puzzle.start, by: '' }], cleared: false, hint: null, pending: null, turn: null, turnAt: 0 };
    const next = { ...room, status: STATUS.PLAYING };
    if (seenKey) {
      const seen = { ...(room.seen || {}) };
      seen[seenKey] = [...(Array.isArray(seen[seenKey]) ? seen[seenKey] : []), seenIdx];
      next.seen = seen;
    }
    if (settingsOf(room).order === 'turn') {
      const list = participants(next);
      // つぎのお題は、前のお題で最後に変えた人のつぎの人からはじめる（はじめの人が毎回同じにならないように）
      const prevG = gameOf(room);
      const lastBy = prevG ? prevG.ladder[prevG.ladder.length - 1].by : '';
      const first = list.length ? (lastBy && list.some((p) => p.name === lastBy) ? nextAfter(next, lastBy) : list[0].name) : null;
      g = withTurn(next, g, first);
    }
    next.game = g;
    return next;
  }

  // まだ出していないお題の番号（chars の文字数のお題から）
  function unseenIndexes(room, puzzles, charsN) {
    const key = 'c' + charsN;
    const seen = new Set(Array.isArray(room?.seen?.[key]) ? room.seen[key] : []);
    const all = [];
    puzzles.forEach((p, i) => { if (p.chars === charsN) all.push(i); });
    const rest = all.filter((i) => !seen.has(i));
    return { key, rest, all };
  }

  function backToWaiting(room) {
    return { ...room, status: STATUS.WAITING, game: null };
  }

  // ゲストが入る・入りなおす。番の途中でいなくなった人が戻ったときは、すでにつぎの人へ移った番を戻さない
  function addPlayer(room, name, data) {
    const g = gameOf(room);
    const before = g && room.status === STATUS.PLAYING ? turnOf(room) : null;
    const next = { ...room, players: { ...(room.players || {}), [name]: data } };
    if (g && before && g.turn === name && before !== name) next.game = withTurn(next, g, before);
    return next;
  }

  // ゲストが抜ける（在室を消す。番だったら、つぎの人へ）
  function leave(room, name) {
    if (!room?.players?.[name]) return null;
    const g = gameOf(room);
    const wasTurn = g && room.status === STATUS.PLAYING ? turnOf(room) === name : false;
    const nextName = wasTurn ? nextAfter(room, name) : null;
    const players = { ...room.players };
    delete players[name];
    const left = { ...room, players };
    if (wasTurn && g) left.game = withTurn(left, g, nextName === name ? null : nextName);
    return left;
  }

  const L = {
    STATUS, ORDERS, JUDGES, LEVEL_IDS, MAX_PLAYERS, MAX_PROXIES, MIN_CHARS, MAX_CHARS, KANA_RE, KANA_ONE_RE, NAME_MAX,
    chars, differsByOne, findPath, hintStep, toHiragana, readCustom, validPuzzle, validNickname,
    settingsOf, participants, isProxy, isParticipant, gameOf, currentWord, turnOf, nextAfter,
    pendingOf, canMove, move, approve, canReject, reject, canUndo, undo, canPass, pass, hint, hintStageOf, newGame, unseenIndexes, backToWaiting, addPlayer, leave,
  };
  root.HMC_LOGIC = L;
  if (typeof module !== 'undefined' && module.exports) module.exports = L;
})(typeof window !== 'undefined' ? window : globalThis);
