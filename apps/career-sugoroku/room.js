/* キャリアすごろく — ルームの決まり（席・だれが押せるか・期限）
   通信（net.js）と画面（ui.js）から使う。Firebase も DOM も使わないので Node でテストできる（tests/career-sugoroku/room.test.cjs）。
   ブラウザでは window.CS_ROOM、Node では module.exports で読む。

   ルームの形（careersugoroku_rooms/{code}）:
     meta:     { v, createdAt, hostId, hostConnected, hostDisconnectedAt, dice, labels, gameNo, startedAt }
     status:   'waiting'（待合室）/ 'playing'（ゲーム中）/ 'finished'（結果）
     seats:    { sid: { name, dev, no, at } }  参加する人。dev はその人の端末の ID（端末のない人は ''＝進行役が代わりに押す）。
               no は入った順の番号（meta.seatSeq から。同じ時刻に入っても順番が決まる）
     order:    [sid, ...]  ゲームを始めたときの順番（エンジンのプレイヤー番号 i ＝ order[i]）
     game:     エンジンの状態を JSON の文字列にしたもの（Realtime Database は null・空の配列を消し、数字のキーを
               配列に変えるので、状態の形をそのまま残すために文字列で持つ）
     presence: { dev: true }  つながっている端末（切断で消える）
     answers:  { 'n'+番の番号: { 'p'+プレイヤー番号: 答え } }  ミニゲームで各自が入れた答え（キーは文字列にする） */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const D = isNode ? require('./data.js') : root.CS_DATA;

  const STATUS = { WAITING: 'waiting', PLAYING: 'playing', FINISHED: 'finished' };
  const NAME_MAX = 8; // 共通規約（ニックネームは8文字まで）
  const ORPHAN_TTL_MS = 2 * 60 * 1000; // 待合室: 共通規約の2分
  // ゲーム中: 30〜45分の回で、進行役の一時的な切断（Zoom の切り替え・端末の再起動）を吸収する（別定数。AGENTS.md）
  const ORPHAN_TTL_INGAME_MS = 15 * 60 * 1000;
  const MAX_SEATS = D.MAX_PLAYERS;
  // 進行役だけができる操作（途中で終える・ステージの表示）
  const HOST_ONLY = { end: true, labels: true };

  // ゲームの状態（文字列を読む。同じ文字列なら読み直さない）
  let memo = { json: null, game: null };
  function gameOf(room) {
    const j = room && room.game;
    if (typeof j !== 'string' || !j) return null;
    if (memo.json !== j) {
      try { memo = { json: j, game: JSON.parse(j) }; } catch (e) { memo = { json: j, game: null }; }
    }
    return memo.game;
  }
  const answerKey = (game) => 'n' + (game && game.last ? game.last.id : 0);
  const pidKey = (pid) => 'p' + pid;

  // 名前: 前後の空白を除き、1〜8文字
  const cleanName = (name) => String(name == null ? '' : name).trim();
  function nameError(name) {
    const n = cleanName(name);
    if (!n) return 'empty';
    if ([...n].length > NAME_MAX) return 'long';
    return null;
  }

  // meta と status がそろっているか（そろっていない＝削除後に書き込みや予約だけが残ったゴースト）
  const complete = (room) => !!(room && room.meta && room.status);
  const ttlOf = (room) => (room.status === STATUS.WAITING ? ORPHAN_TTL_MS : ORPHAN_TTL_INGAME_MS);
  // 進行役が切断してから、ルームが期限切れになる時刻（つながっていれば null）
  function hostDeadline(room) {
    if (!complete(room) || room.meta.hostConnected !== false) return null;
    const at = Number(room.meta.hostDisconnectedAt);
    return Number.isFinite(at) ? at + ttlOf(room) : null;
  }
  // 期限切れ（ゴーストも期限切れとして扱い、見つけた側が消す）
  function isExpired(room, now) {
    if (!complete(room)) return true;
    const d = hostDeadline(room);
    return d != null && now >= d;
  }

  // 席の一覧（入った順）。ゲーム中は order の順
  function seatList(room) {
    const seats = (room && room.seats) || {};
    if (room && Array.isArray(room.order) && room.status !== STATUS.WAITING) {
      return room.order.map((sid) => Object.assign({ sid }, seats[sid] || { name: '', dev: '' }));
    }
    return Object.keys(seats).map((sid) => Object.assign({ sid }, seats[sid]))
      .sort((a, b) => (a.no || 0) - (b.no || 0) || (a.at || 0) - (b.at || 0) || (a.sid < b.sid ? -1 : 1));
  }
  const nameTaken = (room, name) => seatList(room).some((s) => s.name === cleanName(name));
  const isHost = (room, dev) => !!(room && room.meta && dev && room.meta.hostId === dev);
  // その端末が受け持つプレイヤー番号（端末ひとつに1人。いなければ null）
  function pidOf(room, dev) {
    if (!room || !dev || !Array.isArray(room.order)) return null;
    const seats = room.seats || {};
    const i = room.order.findIndex((sid) => seats[sid] && seats[sid].dev === dev);
    return i < 0 ? null : i;
  }
  // プレイヤー番号の席に端末があり、その端末がつながっているか
  function seatOnline(room, pid) {
    const sid = room && Array.isArray(room.order) ? room.order[pid] : null;
    const s = sid && room.seats ? room.seats[sid] : null;
    if (!s || !s.dev) return false;
    return !!(room.presence && room.presence[s.dev]);
  }
  // 端末のない人（進行役が代わりに押す）
  function isProxySeat(room, pid) {
    const sid = room && Array.isArray(room.order) ? room.order[pid] : null;
    const s = sid && room.seats ? room.seats[sid] : null;
    return !!s && !s.dev;
  }

  // 同じボタンの二度押し・古い画面からの操作を見分けるしるし。操作が1つ通ると、どれかが変わる。
  // rev はルームで操作が通るたびに1増える数（net.js が書く。道の選び直しで状態が前にもどっても、rev はもどらない）
  function stamp(game) {
    if (!game) return '';
    const last = game.last || {};
    return [game.rev || 0, game.phase, game.seq, game.turnNo, game.step ? game.step.kind : '', (last.msgs || []).length, (game.log || []).length].join(':');
  }

  // その端末がこの操作をしてよいか。進行役はだれの番でも代わりに押せる。ほかの人は自分の番だけ
  function canAct(room, dev, action) {
    const g = gameOf(room);
    if (!complete(room) || !g || !action) return false;
    if (HOST_ONLY[action.type]) return isHost(room, dev);
    if (room.status !== STATUS.PLAYING || g.phase !== 'play') return false;
    if (isHost(room, dev)) return true;
    const pid = pidOf(room, dev);
    return pid != null && pid === g.cur;
  }
  // ミニゲームの答えを入れてよいか。自分の分と、ホストは端末のない人・つながっていない人の分（つながっている人の答えは
  // 本人が入れる。ほかの人の答えを先に見て合わせられないように）
  function canAnswer(room, dev, pid) {
    const g = gameOf(room);
    if (!complete(room) || !g || room.status !== STATUS.PLAYING) return false;
    if (!g.step || g.step.kind !== 'mini' || !g.players || !g.players[pid]) return false;
    if (pidOf(room, dev) === pid) return true;
    return isHost(room, dev) && (isProxySeat(room, pid) || !seatOnline(room, pid));
  }
  // ミニゲームの答えとして受け付ける値（engine.js の MINI_PICKS と同じ）
  const MINI_VALUES = { hilo: ['hi', 'lo'], janken: ['g', 'c', 'p'], sum: [1, 2, 3] };
  const validAnswer = (game, v) => !!(game && game.step && MINI_VALUES[game.step.game] && MINI_VALUES[game.step.game].includes(v));
  // いまのミニゲームの答え（{ プレイヤー番号: 答え }）
  function answersOf(room) {
    const g = gameOf(room);
    if (!g || !g.step || g.step.kind !== 'mini') return {};
    const a = room.answers && room.answers[answerKey(g)];
    const out = {};
    if (a && typeof a === 'object') {
      Object.keys(a).forEach((k) => { if (/^p\d+$/.test(k) && a[k] != null) out[Number(k.slice(1))] = a[k]; });
    }
    return out;
  }

  const api = { STATUS, NAME_MAX, ORPHAN_TTL_MS, ORPHAN_TTL_INGAME_MS, MAX_SEATS, MINI_VALUES, gameOf, answerKey, pidKey, cleanName, nameError, complete, hostDeadline, isExpired, seatList, nameTaken, isHost, pidOf, seatOnline, isProxySeat, stamp, canAct, canAnswer, validAnswer, answersOf };
  if (isNode) module.exports = api;
  else root.CS_ROOM = api;
})(typeof window !== 'undefined' ? window : globalThis);
