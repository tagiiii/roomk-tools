/* ねむらせ基地 — マップとルールだけ。画面にも通信にも触らない。
   座標の単位はマス（1マス＝1）。人の位置はマスの中の小数で持つ（マス (3,4) の真ん中は 3.5, 4.5）。
   ブラウザでは window.NemuraseEngine、node では module.exports。 */
(function (root) {
  'use strict';

  const W = 44;
  const H = 30;

  // 部屋（x, y, 幅, 高さ）。fill は床の色
  const ROOMS = [
    { key: 'kitchen', name: '台所', x: 2, y: 2, w: 10, h: 7, fill: '#F6E7D2' },
    { key: 'radio', name: '通信室', x: 17, y: 2, w: 10, h: 6, fill: '#DDE9F3' },
    { key: 'farm', name: '畑', x: 32, y: 2, w: 10, h: 8, fill: '#E2EFD6' },
    { key: 'plaza', name: 'ひろば', x: 16, y: 11, w: 12, h: 8, fill: '#F3EFE6' },
    { key: 'power', name: '電気室', x: 2, y: 13, w: 9, h: 7, fill: '#F4EBC6' },
    { key: 'store', name: '倉庫', x: 33, y: 14, w: 9, h: 7, fill: '#E9E1D8' },
    { key: 'tower', name: '見はり台', x: 17, y: 23, w: 10, h: 5, fill: '#E4E0F0' },
  ];
  // 通路（部屋どうしをつなぐ床）
  const HALLS = [
    [12, 4, 5, 2], [27, 4, 5, 2], [21, 8, 2, 3], [6, 9, 2, 4], [11, 15, 5, 2],
    [28, 16, 5, 2], [36, 10, 2, 4], [21, 19, 2, 4],
    [5, 20, 2, 6], [5, 25, 12, 2], [37, 21, 2, 5], [27, 25, 12, 2],
  ];
  const HALL_FILL = '#E6E3DC';

  // 仕事の場所。kind: wire＝線をつなぐ / order＝番号を順に押す / meter＝メーターを合わせる
  const SPOTS = [
    { id: 0, room: 'kitchen', x: 4.5, y: 3.5, kind: 'order', label: 'お皿を順番にしまう' },
    { id: 1, room: 'kitchen', x: 10.5, y: 7.5, kind: 'meter', label: 'なべの火を合わせる' },
    { id: 2, room: 'radio', x: 19.5, y: 3.5, kind: 'wire', label: '通信の線をつなぐ' },
    { id: 3, room: 'radio', x: 25.5, y: 6.5, kind: 'order', label: 'アンテナの番号を押す' },
    { id: 4, room: 'farm', x: 34.5, y: 3.5, kind: 'meter', label: '水の量を合わせる' },
    { id: 5, room: 'farm', x: 40.5, y: 8.5, kind: 'order', label: 'たねを順番にまく' },
    { id: 6, room: 'power', x: 3.5, y: 14.5, kind: 'wire', label: '電線をつなぐ' },
    { id: 7, room: 'store', x: 40.5, y: 15.5, kind: 'order', label: '荷物を番号順にのせる' },
    { id: 8, room: 'store', x: 35.5, y: 19.5, kind: 'wire', label: 'ケーブルをつなぐ' },
    { id: 9, room: 'tower', x: 25.5, y: 26.5, kind: 'meter', label: '望遠鏡のピントを合わせる' },
    { id: 10, room: 'tower', x: 18.5, y: 24.5, kind: 'wire', label: 'ライトの線をつなぐ' },
  ];
  const FIX_SPOT = { x: 9.5, y: 18.5 };     // 停電をなおすスイッチ（電気室）
  const TABLE = { x: 22, y: 15, r: 1.6 };   // ひろばの会議テーブル（まるいので、ぶつかる）

  const SPEED = 4.2;          // 1秒に進むマス
  const RADIUS = 0.34;        // 人の大きさ
  const USE_RANGE = 1.3;      // 仕事・スイッチ・テーブルに手がとどく距離
  const SLEEP_RANGE = 1.5;    // ねむらせられる距離
  const FIND_RANGE = 2.2;     // ねむっている人を見つけられる距離
  const VIEW = { crew: 6, dark: 2.4, sleeper: 7.5 }; // 見える広さ（隊員・停電中の隊員・ねむらせ屋）

  const COLORS = [
    { key: 'red', name: 'あか', hex: '#D9433B' },
    { key: 'blue', name: 'あお', hex: '#2F6FD6' },
    { key: 'green', name: 'みどり', hex: '#2E9A4A' },
    { key: 'yellow', name: 'きいろ', hex: '#E8B820' },
    { key: 'orange', name: 'オレンジ', hex: '#EC7A1C' },
    { key: 'purple', name: 'むらさき', hex: '#8A4FC8' },
    { key: 'pink', name: 'ピンク', hex: '#E86FA8' },
    { key: 'cyan', name: 'みずいろ', hex: '#2BB3C6' },
    { key: 'brown', name: 'ちゃいろ', hex: '#8C5A33' },
    { key: 'white', name: 'しろ', hex: '#F2F2F2' },
  ];

  const GAME_LIMIT_S = 15 * 60; // 1回の長さの上限（通信を抑えるため）。過ぎたら「時間切れ」で引き分け

  const MIN_PLAYERS = 4;
  const MAX_PLAYERS = 10;
  const TWO_SLEEPERS_MIN = 7;

  const DEFAULT_SETTINGS = { hostPlays: 1, sleepers: 1, tasks: 4, cooldown: 30, meeting: 90, buttons: 1 };
  const SETTING_OPTS = {
    hostPlays: [1, 0],
    sleepers: [1, 2],
    tasks: [3, 4, 5],
    cooldown: [20, 30, 45],
    meeting: [60, 90, 120],
    buttons: [1, 2],
  };

  // ── マップ ──
  // grid[y][x]: 0＝かべ、1＝床
  function buildGrid() {
    const g = Array.from({ length: H }, () => new Array(W).fill(0));
    const fill = (x, y, w, h) => {
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) g[yy][xx] = 1;
    };
    ROOMS.forEach((r) => fill(r.x, r.y, r.w, r.h));
    HALLS.forEach((h) => fill(h[0], h[1], h[2], h[3]));
    return g;
  }
  const GRID = buildGrid();

  const isFloor = (tx, ty) => tx >= 0 && ty >= 0 && tx < W && ty < H && GRID[ty][tx] === 1;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function roomAt(x, y) {
    const r = ROOMS.find((q) => x >= q.x && x < q.x + q.w && y >= q.y && y < q.y + q.h);
    return r ? r.key : null;
  }
  const roomName = (key) => (ROOMS.find((r) => r.key === key) || {}).name || '';

  // その位置に人が立てるか（かべ・テーブルにかからないか）
  function canStand(x, y) {
    const r = RADIUS;
    const pts = [[x - r, y - r], [x + r, y - r], [x - r, y + r], [x + r, y + r]];
    if (!pts.every((p) => isFloor(Math.floor(p[0]), Math.floor(p[1])))) return false;
    return Math.hypot(x - TABLE.x, y - TABLE.y) >= TABLE.r + r;
  }

  // 1歩すすめる。dx, dy は向き（長さ1まで）、dt は秒。かべに当たったら、すべるように横へ動く
  function step(pos, dx, dy, dt) {
    const len = Math.hypot(dx, dy);
    if (!len) return { x: pos.x, y: pos.y };
    const k = Math.min(1, len) / len;
    const vx = dx * k * SPEED * dt;
    const vy = dy * k * SPEED * dt;
    let x = pos.x;
    let y = pos.y;
    // 大きく動くときは小さく分けて、かべを抜けないようにする
    const n = Math.max(1, Math.ceil(Math.hypot(vx, vy) / 0.2));
    for (let i = 0; i < n; i++) {
      if (canStand(x + vx / n, y)) x += vx / n;
      if (canStand(x, y + vy / n)) y += vy / n;
    }
    return { x, y };
  }

  // マスの間の道（4方向）。from, to はマス。見つからなければ null
  function path(from, to) {
    const key = (x, y) => y * W + x;
    if (!isFloor(to.x, to.y)) return null;
    const prev = new Map([[key(from.x, from.y), -1]]);
    const q = [[from.x, from.y]];
    while (q.length) {
      const [x, y] = q.shift();
      if (x === to.x && y === to.y) {
        const out = [];
        let k = key(x, y);
        while (k !== -1) { out.push({ x: k % W, y: Math.floor(k / W) }); k = prev.get(k); }
        return out.reverse();
      }
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(([ax, ay]) => {
        const nx = x + ax;
        const ny = y + ay;
        if (!isFloor(nx, ny) || prev.has(key(nx, ny))) return;
        prev.set(key(nx, ny), key(x, y));
        q.push([nx, ny]);
      });
    }
    return null;
  }

  // 会議のあと・はじめに立つ場所（テーブルのまわり）
  function spawnPoint(i, n) {
    const a = (Math.PI * 2 * i) / Math.max(1, n) - Math.PI / 2;
    const r = TABLE.r + 1.3;
    return { x: TABLE.x + Math.cos(a) * r, y: TABLE.y + Math.sin(a) * r };
  }

  // ── ルール ──
  function shuffled(arr, rnd) {
    const a = arr.slice();
    const r = rnd || Math.random;
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sleeperCount(settings, n) {
    return settings.sleepers === 2 && n >= TWO_SLEEPERS_MIN ? 2 : 1;
  }

  // ids: 遊ぶ人。roles＝{id: 'crew'|'sleeper'}、tasks＝{id: [{spot, done}]}（ねむらせ屋は「ふりをする場所」で done は使わない）
  function newGame(ids, settings, rnd) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const order = shuffled(ids, rnd);
    const ns = sleeperCount(s, ids.length);
    const roles = {};
    const tasks = {};
    const buttons = {};
    order.forEach((id, i) => {
      roles[id] = i < ns ? 'sleeper' : 'crew';
      tasks[id] = shuffled(SPOTS.map((p) => p.id), rnd).slice(0, s.tasks).map((spot) => ({ spot, done: false }));
      buttons[id] = s.buttons;
    });
    return {
      settings: s,
      players: ids.slice(),
      roles,
      tasks,
      buttons,
      asleep: {},       // {id: 'slept'|'voted'}
      left: {},         // {id: true} ゲームの途中で抜けた人（勝ち負けの判定と、のこりの仕事の数から外す）
      bodies: [],       // ねむっている姿 [{id, x, y}]（会議で片づく）
      cooldown: {},     // {id: この時刻まで、ねむらせられない}
      dark: false,      // 停電中
      darkReadyAt: 0,   // この時刻から停電を起こせる
      spawnSeq: 1,      // 増えたら、みんなテーブルのまわりへもどる
      meeting: null,
      result: null,
      winner: null,
      winReason: '',
    };
  }

  const isAwake = (g, id) => !g.asleep[id];
  const hasLeft = (g, id) => !!(g.left && g.left[id]);
  // おきていて、抜けていない人
  const awakeOf = (g, role) => g.players.filter((id) => isAwake(g, id) && !hasLeft(g, id) && (!role || g.roles[id] === role));

  // 抜けた人の仕事は、おわらせた分だけ数える（のこりは全体の数から外す）
  function taskProgress(g) {
    let done = 0;
    let total = 0;
    g.players.forEach((id) => {
      if (g.roles[id] !== 'crew') return;
      const gone = hasLeft(g, id);
      g.tasks[id].forEach((t) => {
        if (t.done) { done++; total++; } else if (!gone) total++;
      });
    });
    return { done, total };
  }

  // 勝ち負けが決まったら winner を入れて true
  function checkWin(g) {
    if (g.winner) return true;
    const sleepers = awakeOf(g, 'sleeper').length;
    const crew = awakeOf(g, 'crew').length;
    const tp = taskProgress(g);
    if (sleepers === 0) {
      // 全員を投票やねむらせで見つけたときだけ「見つけた」。ひとりでも抜けていれば「いなくなった」
      const found = g.players.every((id) => g.roles[id] !== 'sleeper' || (!isAwake(g, id) && !hasLeft(g, id)));
      g.winner = 'crew';
      g.winReason = found ? 'found' : 'left';
      return true;
    }
    if (tp.total > 0 && tp.done >= tp.total) { g.winner = 'crew'; g.winReason = 'tasks'; return true; }
    if (sleepers >= crew) { g.winner = 'sleeper'; g.winReason = 'outnumber'; return true; }
    return false;
  }

  // 票を数える。votes＝{投票した人: 相手の id | skip}。いちばん多い1人だけがねむる（同じ数・スキップが多いときは、だれもねむらない）
  function tally(votes, skip = 'skip') {
    const counts = {};
    Object.values(votes).forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
    let top = null;
    let max = 0;
    let tie = false;
    Object.keys(counts).forEach((k) => {
      if (counts[k] > max) { max = counts[k]; top = k; tie = false; }
      else if (counts[k] === max) tie = true;
    });
    const target = !top || tie || top === skip ? null : top;
    return { counts, target, tie: tie && max > 0 };
  }

  // 位置を送る形: "x,y,f"（座標×10の整数・向き 1＝右 0＝左）。通信を小さくするため短い文字列1つにする
  function encodePos(x, y, face) {
    return Math.round(x * 10) + ',' + Math.round(y * 10) + ',' + (face < 0 ? 0 : 1);
  }
  function decodePos(text) {
    const m = /^(-?\d{1,4}),(-?\d{1,4}),([01])$/.exec(String(text || ''));
    if (!m) return null;
    const x = Number(m[1]) / 10;
    const y = Number(m[2]) / 10;
    if (x < 0 || y < 0 || x > W || y > H) return null;
    return { x, y, face: m[3] === '1' ? 1 : -1 };
  }

  const api = {
    W, H, ROOMS, HALLS, HALL_FILL, SPOTS, FIX_SPOT, TABLE, GRID, COLORS,
    SPEED, RADIUS, USE_RANGE, SLEEP_RANGE, FIND_RANGE, VIEW,
    GAME_LIMIT_S, MIN_PLAYERS, MAX_PLAYERS, TWO_SLEEPERS_MIN, DEFAULT_SETTINGS, SETTING_OPTS,
    isFloor, dist, roomAt, roomName, canStand, step, path, spawnPoint, encodePos, decodePos,
    shuffled, sleeperCount, newGame, isAwake, hasLeft, awakeOf, taskProgress, checkWin, tally,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NemuraseEngine = api;
})(typeof window !== 'undefined' ? window : this);
