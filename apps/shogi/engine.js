/* 将棋 盤のルール
   画面と通信に触らない。ブラウザでは window.ShogiEngine、node では module.exports。

   盤: 長さ n*n の配列。添字は 行*n + 列。行0 が上（後手の陣）、列0 が左（先手から見て n筋）。
   ます: '' は空き。駒は1文字（先手は大文字・後手は小文字）。成った駒は前に '+'（'+P'・'+r'）。
     K 玉・R 飛・B 角・G 金・S 銀・N 桂・L 香・P 歩
   持ち駒: [{R:0,...}（先手）, {...}（後手）]
   手: { from: ますの添字（打つときは -1）, to, drop: 打つ駒の種類（動かすときは なし）, promote: true/false } */
(function (root) {
  'use strict';

  const VARIANTS = {
    hon: {
      name: '本将棋', size: '9×9', n: 9, zone: 3,
      setup: ['lnsgkgsnl', '.r.....b.', 'ppppppppp', '.........', '.........', '.........', 'PPPPPPPPP', '.B.....R.', 'LNSGKGSNL'],
    },
    mini: {
      name: '5五将棋', size: '5×5', n: 5, zone: 1,
      setup: ['rbsgk', '....p', '.....', 'P....', 'KGSBR'],
    },
  };

  const HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];
  const PROMOTABLE = { R: 1, B: 1, S: 1, N: 1, L: 1, P: 1 };
  const NAME = { K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩' };
  const PNAME = { R: '龍', B: '馬', S: '成銀', N: '成桂', L: '成香', P: 'と' };
  const KANJI_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const WIDE_NUM = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];

  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const KING = ORTH.concat(DIAG);
  const GOLD = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0]];
  const SPEC = {
    K: { steps: KING, slides: [] },
    G: { steps: GOLD, slides: [] },
    S: { steps: [[-1, -1], [-1, 0], [-1, 1], [1, -1], [1, 1]], slides: [] },
    N: { steps: [[-2, -1], [-2, 1]], slides: [] },
    L: { steps: [], slides: [[-1, 0]] },
    P: { steps: [[-1, 0]], slides: [] },
    R: { steps: [], slides: ORTH },
    B: { steps: [], slides: DIAG },
    '+R': { steps: DIAG, slides: ORTH },
    '+B': { steps: ORTH, slides: DIAG },
    '+S': { steps: GOLD, slides: [] },
    '+N': { steps: GOLD, slides: [] },
    '+L': { steps: GOLD, slides: [] },
    '+P': { steps: GOLD, slides: [] },
  };

  /* ── 駒の読み方 ── */
  const ownerOf = (c) => (c ? (c[c.length - 1] === c[c.length - 1].toUpperCase() ? 0 : 1) : -1);
  const typeOf = (c) => c[c.length - 1].toUpperCase();
  const isProm = (c) => c[0] === '+';
  const kindOf = (c) => (isProm(c) ? '+' : '') + typeOf(c);   // 'P'・'+P'（持ち主は見ない）
  const makePiece = (type, owner, prom) => (prom ? '+' : '') + (owner === 0 ? type : type.toLowerCase());
  // 先手から見た向きの動き。後手は上下を反転する
  function specOf(c) {
    return SPEC[kindOf(c)];
  }
  function pieceName(c, owner) {
    const t = typeOf(c);
    if (t === 'K') return (owner == null ? ownerOf(c) : owner) === 0 ? '玉' : '王';
    return isProm(c) ? PNAME[t] : NAME[t];
  }

  /* ── 局面 ── */
  function emptyHands() {
    const h = {};
    HAND_ORDER.forEach((t) => { h[t] = 0; });
    return h;
  }
  function create(v) {
    const V = VARIANTS[v] ? v : 'hon';
    const D = VARIANTS[V];
    const board = [];
    D.setup.forEach((row) => { for (const ch of row) board.push(ch === '.' ? '' : ch); });
    const S = {
      v: V, n: D.n, board, hands: [emptyHands(), emptyHands()],
      turn: 0, ply: 0, last: null, check: false, over: null,
      keys: [], checks: [false],
    };
    S.keys.push(keyOf(S));
    return S;
  }
  function keyOf(S) {
    const h = S.hands.map((hh) => HAND_ORDER.map((t) => hh[t]).join('')).join('/');
    return S.board.join(',') + '|' + h + '|' + S.turn;
  }
  function inZone(n, zone, r, owner) {
    return owner === 0 ? r < zone : r >= n - zone;
  }
  // そこから先へ動けない場所（行き所のない駒）
  function deadSquare(n, type, r, owner) {
    const back = owner === 0 ? r : n - 1 - r;   // 相手の陣のいちばん奥からの段
    if (type === 'P' || type === 'L') return back === 0;
    if (type === 'N') return back <= 1;
    return false;
  }

  /* ── 利き ── */
  // その駒が、そのますに利いているか
  function reaches(board, n, from, to) {
    const c = board[from];
    const o = ownerOf(c);
    const sp = specOf(c);
    const fr = Math.floor(from / n); const fc = from % n;
    const tr = Math.floor(to / n); const tc = to % n;
    const sign = o === 0 ? 1 : -1;
    for (const [dr0, dc] of sp.steps) {
      const dr = dr0 * sign;
      if (fr + dr === tr && fc + dc === tc) return true;
    }
    for (const [dr0, dc] of sp.slides) {
      const dr = dr0 * sign;
      let r = fr + dr; let cc = fc + dc;
      while (r >= 0 && r < n && cc >= 0 && cc < n) {
        const i = r * n + cc;
        if (i === to) return true;
        if (board[i]) break;
        r += dr; cc += dc;
      }
    }
    return false;
  }
  function attacked(board, n, sq, by) {
    for (let i = 0; i < board.length; i += 1) {
      if (board[i] && ownerOf(board[i]) === by && reaches(board, n, i, sq)) return true;
    }
    return false;
  }
  function kingSquare(board, owner) {
    const k = owner === 0 ? 'K' : 'k';
    return board.indexOf(k);
  }
  function inCheck(board, n, owner) {
    const k = kingSquare(board, owner);
    return k >= 0 && attacked(board, n, k, 1 - owner);
  }
  // その駒が動けるますの一覧（自分の駒のますは除く。王手かどうかは見ない）
  function targetsOf(board, n, from) {
    const c = board[from];
    const o = ownerOf(c);
    const sp = specOf(c);
    const fr = Math.floor(from / n); const fc = from % n;
    const sign = o === 0 ? 1 : -1;
    const out = [];
    for (const [dr0, dc] of sp.steps) {
      const r = fr + dr0 * sign; const cc = fc + dc;
      if (r < 0 || r >= n || cc < 0 || cc >= n) continue;
      const i = r * n + cc;
      if (ownerOf(board[i]) !== o) out.push(i);
    }
    for (const [dr0, dc] of sp.slides) {
      const dr = dr0 * sign;
      let r = fr + dr; let cc = fc + dc;
      while (r >= 0 && r < n && cc >= 0 && cc < n) {
        const i = r * n + cc;
        if (ownerOf(board[i]) === o) break;
        out.push(i);
        if (board[i]) break;
        r += dr; cc += dc;
      }
    }
    return out;
  }

  /* ── 手を作る ── */
  // ルール上は指せる形の手（自分の王に王手が残るか・打ち歩詰めかは、まだ見ない）
  function pseudoMoves(S) {
    const { board, n, turn } = S;
    const zone = VARIANTS[S.v].zone;
    const out = [];
    for (let from = 0; from < board.length; from += 1) {
      const c = board[from];
      if (!c || ownerOf(c) !== turn) continue;
      const t = typeOf(c);
      const canProm = PROMOTABLE[t] && !isProm(c);
      const fr = Math.floor(from / n);
      for (const to of targetsOf(board, n, from)) {
        const tr = Math.floor(to / n);
        if (canProm && (inZone(n, zone, fr, turn) || inZone(n, zone, tr, turn))) {
          out.push({ from, to, promote: true });
          if (!deadSquare(n, t, tr, turn)) out.push({ from, to, promote: false });
        } else {
          out.push({ from, to, promote: false });
        }
      }
    }
    const hand = S.hands[turn];
    for (const t of HAND_ORDER) {
      if (!hand[t]) continue;
      for (let to = 0; to < board.length; to += 1) {
        if (board[to]) continue;
        const r = Math.floor(to / n);
        if (deadSquare(n, t, r, turn)) continue;
        if (t === 'P' && hasPawnOnFile(board, n, to % n, turn)) continue;
        out.push({ from: -1, to, drop: t, promote: false });
      }
    }
    return out;
  }
  function hasPawnOnFile(board, n, col, owner) {
    const p = owner === 0 ? 'P' : 'p';
    for (let r = 0; r < n; r += 1) if (board[r * n + col] === p) return true;
    return false;
  }

  // 盤と持ち駒だけを動かす（手番・記録は動かさない）
  function playOnBoard(S, m) {
    const board = S.board.slice();
    const hands = [Object.assign({}, S.hands[0]), Object.assign({}, S.hands[1])];
    const me = S.turn;
    let captured = '';
    if (m.from < 0) {
      hands[me][m.drop] -= 1;
      board[m.to] = makePiece(m.drop, me, false);
    } else {
      const c = board[m.from];
      if (board[m.to]) {
        captured = board[m.to];
        hands[me][typeOf(captured)] += 1;
      }
      board[m.from] = '';
      board[m.to] = makePiece(typeOf(c), me, isProm(c) || m.promote);
    }
    return { board, hands, captured };
  }

  function leavesKingSafe(S, m) {
    const { board } = playOnBoard(S, m);
    return !inCheck(board, S.n, S.turn);
  }
  // 打ち歩詰め: 歩を打って王手をかけ、相手に逃げる手がない
  function isUchifuzume(S, m) {
    if (m.from >= 0 || m.drop !== 'P') return false;
    const { board, hands } = playOnBoard(S, m);
    const opp = 1 - S.turn;
    if (!inCheck(board, S.n, opp)) return false;
    const T = { v: S.v, n: S.n, board, hands, turn: opp };
    // 歩の王手は、駒を打ってさえぎれない。動かす手だけ調べればよい
    return !pseudoMoves(T).some((mm) => mm.from >= 0 && leavesKingSafe(T, mm));
  }
  function legalMoves(S) {
    if (S.over) return [];
    return pseudoMoves(S).filter((m) => leavesKingSafe(S, m) && !isUchifuzume(S, m));
  }
  function hasLegalMove(S) {
    return pseudoMoves(S).some((m) => leavesKingSafe(S, m) && !isUchifuzume(S, m));
  }

  // 指せない手の理由（画面の知らせに使う）。指せる手なら ''
  function whyIllegal(S, from, to, drop) {
    if (S.over) return 'おわった対局です。';
    const { board, n, turn } = S;
    if (drop) {
      if (!S.hands[turn][drop]) return 'その駒は持っていないよ。';
      if (board[to]) return '駒のあるますには打てないよ。';
      const r = Math.floor(to / n);
      if (deadSquare(n, drop, r, turn)) return 'そこに打つと、その' + NAME[drop] + 'はもう動けないので、打てないよ。';
      if (drop === 'P' && hasPawnOnFile(board, n, to % n, turn)) return '同じたての列に自分の歩が2枚になるので、打てないよ（二歩）。';
      const m = { from: -1, to, drop, promote: false };
      if (!leavesKingSafe(S, m)) return inCheck(board, n, turn) ? '王手をよけていないので、打てないよ。' : 'そこに打つと王が取られてしまうので、打てないよ。';
      if (isUchifuzume(S, m)) return '歩を打って詰ませることはできないよ（打ち歩詰め）。';
      return '';
    }
    const c = board[from];
    if (!c || ownerOf(c) !== turn) return 'その駒は動かせないよ。';
    if (!targetsOf(board, n, from).includes(to)) return 'その駒は、そこへは動けないよ。';
    const opts = [{ from, to, promote: false }, { from, to, promote: true }];
    if (!opts.some((m) => leavesKingSafe(S, m))) {
      if (typeOf(c) === 'K') return 'そこへ動くと王が取られてしまうので、動けないよ。';
      return inCheck(board, n, turn) ? '王手をよけていないので、動かせないよ。' : 'その駒が動くと王が取られてしまうので、動かせないよ。';
    }
    return '';
  }

  // 指す。新しい局面を返す（元の局面は変えない）
  function apply(S, m) {
    const before = S;
    const { board, hands, captured } = playOnBoard(S, m);
    const mover = S.turn;
    const T = {
      v: S.v, n: S.n, board, hands,
      turn: 1 - mover, ply: S.ply + 1,
      last: { from: m.from, to: m.to, drop: m.drop || '', promote: !!m.promote, captured, text: moveText(before, m) },
      check: false, over: null,
      keys: S.keys.concat(), checks: S.checks.concat(),
    };
    T.check = inCheck(board, S.n, T.turn);
    const key = keyOf(T);
    T.keys.push(key);
    T.checks.push(T.check);
    if (!hasLegalMove(T)) {
      T.over = { winner: mover, reason: T.check ? 'mate' : 'nomove' };
    } else {
      const rep = repetition(T, key);
      if (rep) T.over = rep;
    }
    return T;
  }

  // 千日手: 同じ局面（盤・持ち駒・手番）が4回目。片方がずっと王手をかけ続けていたら、その人の負け。
  // それ以外は、本将棋は引き分け（指しなおしのかわり）、5五将棋は先手の負け（5五将棋の決まり）
  function repetition(T, key) {
    const hits = [];
    T.keys.forEach((k, i) => { if (k === key) hits.push(i); });
    if (hits.length < 4) return null;
    const first = hits[0];
    const allCheck = [true, true];
    // keys[i] の局面は i 手目のあと。i 手目を指したのは、i が奇数なら先手
    for (let i = first + 1; i < T.keys.length; i += 1) {
      const mover = i % 2 === 1 ? 0 : 1;
      if (!T.checks[i]) allCheck[mover] = false;
    }
    if (allCheck[0] !== allCheck[1]) return { winner: allCheck[0] ? 1 : 0, reason: 'perpetual' };
    return { winner: T.v === 'mini' ? 1 : -1, reason: 'sennichite' };
  }

  /* ── 表記 ── */
  function squareName(n, i) {
    const r = Math.floor(i / n); const c = i % n;
    return WIDE_NUM[n - c - 1] + KANJI_NUM[r];
  }
  // 「▲７六歩」の形。同じ種類の駒が2枚以上そこへ動けるときは、日本将棋連盟の表記の決まりで
  // 「上・引・寄」「右・左・直」を付ける。打つ手は、盤の駒も同じ所へ動けるときだけ「打」を付ける
  function moveText(S, m) {
    const mark = S.turn === 0 ? '▲' : '△';
    const where = S.last && S.last.to === m.to ? '同' : squareName(S.n, m.to);
    if (m.from < 0) {
      const same = S.board.some((c, i) => c && ownerOf(c) === S.turn && kindOf(c) === m.drop && canReach(S, i, m.to));
      return mark + where + NAME[m.drop] + (same ? '打' : '');
    }
    const c = S.board[m.from];
    let tail = '';
    const t = typeOf(c);
    if (PROMOTABLE[t] && !isProm(c)) {
      const zone = VARIANTS[S.v].zone;
      const could = inZone(S.n, zone, Math.floor(m.from / S.n), S.turn) || inZone(S.n, zone, Math.floor(m.to / S.n), S.turn);
      if (m.promote) tail = '成';
      else if (could) tail = '不成';
    }
    return mark + where + pieceName(c) + relative(S, m.from, m.to) + tail;
  }
  // 指す人から見た向き: 前へ進むと dr<0、右へ動くと dc>0
  // その駒が to へ指せるか（ピンされて動けない駒は数えない）
  function canReach(S, i, to) {
    if (!targetsOf(S.board, S.n, i).includes(to)) return false;
    return leavesKingSafe(S, { from: i, to, promote: false }) || leavesKingSafe(S, { from: i, to, promote: true });
  }
  function relative(S, from, to) {
    const { board, n, turn } = S;
    const kind = kindOf(board[from]);
    const others = [];
    board.forEach((c, i) => {
      if (i !== from && c && ownerOf(c) === turn && kindOf(c) === kind && canReach(S, i, to)) others.push(i);
    });
    if (!others.length) return '';
    const sign = turn === 0 ? 1 : -1;
    const rel = (i) => ({ dr: (Math.floor(to / n) - Math.floor(i / n)) * sign, dc: ((to % n) - (i % n)) * sign, col: (i % n) * sign });
    const vert = (i) => { const d = rel(i).dr; return d < 0 ? '上' : d > 0 ? '引' : '寄'; };
    const me = rel(from);
    // まず「上・引・寄」で区別し、決まらなければ「右・左・直」（龍・馬は「直」を使わない）
    const mv = vert(from);
    const sameMv = others.filter((i) => vert(i) === mv);
    if (!sameMv.length) return mv;
    // まっすぐ前へ進む金・銀（成った駒をふくむ）は「直」
    const goldLike = kind === 'G' || kind === 'S' || kind === '+S' || kind === '+N' || kind === '+L' || kind === '+P';
    if (goldLike && me.dr === -1 && me.dc === 0) return '直';
    const side = (list) => {
      const cols = list.map((i) => rel(i).col);
      if (cols.every((x) => me.col > x)) return '右';
      if (cols.every((x) => me.col < x)) return '左';
      return '';
    };
    // 右・左だけで決まればそれだけ。決まらなければ、同じ動きの駒の中での右・左に「上・引・寄」を足す
    const all = side(others);
    if (all) return all;
    const part = side(sameMv);
    // 3枚以上で真ん中のときなどは、ここで決まらない（めったにないので、上・引・寄だけを付ける）
    return part ? part + mv : mv;
  }

  // 入玉宣言（本将棋。日本将棋連盟の27点法）。宣言する人の番に、次をすべて満たすと勝ち
  // ・王が相手の陣（奥の3段）にいる ・王手されていない ・相手の陣に王のほかの自分の駒が10枚以上
  // ・相手の陣の駒と持ち駒の点（飛・角とその成り駒は5点、ほかは1点。王は数えない）が先手28点・後手27点以上
  const DECLARE_NEED = [28, 27];
  function declarePoints(S, owner) {
    const zone = VARIANTS[S.v].zone;
    let points = 0;
    let count = 0;
    S.board.forEach((c, i) => {
      if (!c || ownerOf(c) !== owner || typeOf(c) === 'K') return;
      if (!inZone(S.n, zone, Math.floor(i / S.n), owner)) return;
      count += 1;
      points += typeOf(c) === 'R' || typeOf(c) === 'B' ? 5 : 1;
    });
    HAND_ORDER.forEach((t) => { points += S.hands[owner][t] * (t === 'R' || t === 'B' ? 5 : 1); });
    return { points, count };
  }
  function canDeclare(S) {
    if (S.over || S.v !== 'hon') return false;
    const me = S.turn;
    const k = kingSquare(S.board, me);
    if (k < 0 || !inZone(S.n, VARIANTS[S.v].zone, Math.floor(k / S.n), me)) return false;
    if (inCheck(S.board, S.n, me)) return false;
    const { points, count } = declarePoints(S, me);
    return count >= 10 && points >= DECLARE_NEED[me];
  }

  // 取られそうな駒（そのますに相手の駒が利いている、自分の駒）
  function threatened(S, owner) {
    const out = [];
    S.board.forEach((c, i) => {
      if (c && ownerOf(c) === owner && attacked(S.board, S.n, i, 1 - owner)) out.push(i);
    });
    return out;
  }

  // 指した手の記録から局面を作りなおす（1手もどす・読み込み直し）
  function replay(v, moves) {
    let S = create(v);
    for (const m of moves) S = apply(S, m);
    return S;
  }
  function sameMove(a, b) {
    return a.from === b.from && a.to === b.to && (a.drop || '') === (b.drop || '') && !!a.promote === !!b.promote;
  }

  /* ── CPU（1台の画面で対戦する相手） ──
     読みは「王を取られる手も指せる形」（自分の王が取られる手は、次の手で王を取られて大負けになる）で、
     速さのために合法かどうかの確認を省く。いちばん上の手だけは legalMoves の正しい手から選ぶ。
     強さ: weak＝1手だけ見て、ばらつきを大きく／normal＝2手先まで＋取り合いの読み／strong＝時間の許すかぎり6手先まで（1.5秒で打ち切り） */
  const VALUE = { P: 100, L: 300, N: 350, S: 500, G: 550, B: 800, R: 1000, K: 0 };
  const PVALUE = { P: 520, L: 500, N: 500, S: 550, B: 1100, R: 1300 };
  const MATE = 100000;
  const LEVELS = {
    weak: { depth: 1, ms: 300, noise: 320, flat: true },
    normal: { depth: 2, ms: 700, noise: 50 },
    strong: { depth: 6, ms: 1500, noise: 8 },
  };
  const pieceValue = (c) => (isProm(c) ? PVALUE[typeOf(c)] : VALUE[typeOf(c)]);

  // 番の人から見た点数（駒の価値・持ち駒・前に出た駒・王のまわりの守り）
  function evaluate(N) {
    const { board, n, hands, turn } = N;
    let s = 0;
    for (let i = 0; i < board.length; i += 1) {
      const c = board[i];
      if (!c) continue;
      const o = ownerOf(c);
      let v = pieceValue(c);
      const t = typeOf(c);
      if (!isProm(c) && (t === 'P' || t === 'S' || t === 'N' || t === 'L')) {
        const r = Math.floor(i / n);
        v += (o === 0 ? n - 1 - r : r) * 4;
      }
      s += o === turn ? v : -v;
    }
    HAND_ORDER.forEach((t) => { s += (hands[turn][t] - hands[1 - turn][t]) * VALUE[t] * 1.1; });
    for (const o of [0, 1]) {
      const k = kingSquare(board, o);
      if (k < 0) { s += o === turn ? -MATE : MATE; continue; }
      const kr = Math.floor(k / n); const kc = k % n;
      let guard = 0;
      for (const [dr, dc] of KING) {
        const r = kr + dr; const c = kc + dc;
        if (r >= 0 && r < n && c >= 0 && c < n && board[r * n + c] && ownerOf(board[r * n + c]) === o) guard += 1;
      }
      // 王が自分の陣から前に出るほど減点（序盤・中盤で王を前に出さない）
      const out = o === 0 ? n - 1 - kr : kr;
      s += (o === turn ? 1 : -1) * (guard * 12 - out * 30);
    }
    return s;
  }
  function childOf(N, m) {
    const { board, hands } = playOnBoard(N, m);
    return { v: N.v, n: N.n, board, hands, turn: 1 - N.turn };
  }
  // 取る手（高い駒を安い駒で）・成る手を先に読む
  function ordered(N, quiet) {
    let ms = pseudoMoves(N);
    if (quiet) ms = ms.filter((m) => m.from >= 0 && (N.board[m.to] || m.promote));
    const score = (m) => {
      const cap = N.board[m.to];
      if (cap && typeOf(cap) === 'K') return 1e9;
      let s = 0;
      if (cap) s += pieceValue(cap) * 10 - (m.from >= 0 ? pieceValue(N.board[m.from]) : 0);
      if (m.promote) s += 400;
      if (m.from < 0) s -= 50;
      return s;
    };
    return ms.map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s).map((x) => x.m);
  }
  const STOP = {};
  function search(N, depth, alpha, beta, ctx, ply) {
    if ((++ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) throw STOP;
    const quiet = depth <= 0;
    // 王手されているときは、そこで止めずに、よける手をすべて読む（詰みを見のがさないように）
    const checked = quiet && inCheck(N.board, N.n, N.turn);
    if (quiet && depth < -6) return evaluate(N);
    let best = -Infinity;
    if (quiet && !checked) {
      best = evaluate(N);
      if (best >= beta || depth < -4) return best;
      if (best > alpha) alpha = best;
    }
    for (const m of ordered(N, quiet && !checked)) {
      const cap = N.board[m.to];
      if (cap && typeOf(cap) === 'K') return MATE - ply;
      const v = -search(childOf(N, m), depth - 1, -beta, -alpha, ctx, ply + 1);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (best === -Infinity) return quiet ? evaluate(N) : -MATE + ply;
    return best;
  }
  // CPU の手。rnd はくじ（テストで固定するため）、ms は考える時間の上限（はぶくと強さごとの値）。指せる手がなければ null
  function cpuMove(S, level, rnd, ms) {
    const r = rnd || Math.random;
    const L = LEVELS[level] || LEVELS.normal;
    const roots = legalMoves(S);
    if (!roots.length) return null;
    const N0 = { v: S.v, n: S.n, board: S.board, hands: S.hands, turn: S.turn };
    const ctx = { nodes: 0, deadline: Date.now() + (ms || L.ms) };
    let scores = roots.map(() => 0);
    let order = roots.map((m, i) => i);
    for (let d = 1; d <= L.depth; d += 1) {
      const next = roots.map(() => -Infinity);
      try {
        let alpha = -Infinity;
        for (const i of order) {
          // 前の深さでいちばんよかった手より少しでも悪い手は、くわしく読まない（窓を少し広げて、ばらつきの余地を残す）
          const C = childOf(N0, roots[i]);
          // よわいは相手の返し手も読まず、指したあとの形だけを見る
          const v = L.flat ? -evaluate(C) : -search(C, d - 1, -Infinity, -(alpha - L.noise), ctx, 1);
          next[i] = v;
          if (v > alpha) alpha = v;
        }
      } catch (e) {
        if (e !== STOP) throw e;
        // 読みきれなかった深さは使わない（1手目だけは、時間がなくても読みおえた分を使う）
        if (d > 1) break;
        next.forEach((v, i) => { if (v === -Infinity) next[i] = -MATE; });
      }
      scores = next;
      order = order.slice().sort((a, b) => scores[b] - scores[a]);
      if (scores[order[0]] >= MATE - 10) break;   // 詰ませる手が見つかった
    }
    let pick = order[0];
    let top = -Infinity;
    for (const i of order) {
      // 詰みや、大きく損をしない範囲でだけくじを使う
      if (scores[i] < scores[order[0]] - L.noise * 2) break;
      const v = scores[i] + (Math.abs(scores[i]) >= MATE - 100 ? 0 : r() * L.noise);
      if (v > top) { top = v; pick = i; }
    }
    return roots[pick];
  }

  const api = {
    cpuMove, LEVELS,
    VARIANTS, HAND_ORDER, NAME, PNAME, SPEC, KANJI_NUM, WIDE_NUM,
    ownerOf, typeOf, isProm, kindOf, specOf, pieceName,
    create, keyOf, legalMoves, pseudoMoves, apply, replay, whyIllegal,
    inCheck, attacked, targetsOf, threatened, squareName, moveText, sameMove, kingSquare,
    canDeclare, declarePoints, DECLARE_NEED,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ShogiEngine = api;
})(typeof window !== 'undefined' ? window : this);
