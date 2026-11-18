/* チェス 盤のルール
   画面と通信に触らない。ブラウザでは window.ChessEngine、node では module.exports。

   盤: 長さ 64 の配列。添字は 行*8 + 列。行0 が上（黒の陣・8段目）、列0 が左（a の列）。
   ます: '' は空き。駒は1文字（白は大文字・黒は小文字）。K キング・Q クイーン・R ルーク・B ビショップ・N ナイト・P ポーン
   番: 0 白・1 黒
   手: { from, to, promo: ポーンが成る駒（'Q'・'R'・'B'・'N'。成らないときは ''） }
   キャスリングはキングを2マス動かす手、アンパッサンはポーンを ep のますへ動かす手として表す。
   ルールは国際チェス連盟（FIDE）の決まりに合わせる。引き分けの申し出が要るもの（同じ形3回・50手）は、自動で引き分けにする */
(function (root) {
  'use strict';

  const SETUP = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR'];
  const FILES = 'abcdefgh';
  const NAME = { K: 'キング', Q: 'クイーン', R: 'ルーク', B: 'ビショップ', N: 'ナイト', P: 'ポーン' };
  const HOW = {
    K: 'まわりの8マスのどこかへ、1マス動く。取られてしまう所へは動けない',
    Q: 'たて・横・ななめに、どこまでも進める（駒を跳びこえることはできない）',
    R: 'たて・横に、どこまでも進める（駒を跳びこえることはできない）',
    B: 'ななめに、どこまでも進める（駒を跳びこえることはできない）',
    N: '「L」の形に跳ぶ（たてか横に2マス、そこから横かたてに1マス）。間の駒を跳びこえられる',
    P: '前へ1マス進む（はじめの場所からは2マスも進める）。取るときは、ななめ前の駒を取る。いちばん奥まで進むと、ほかの駒になれる',
  };
  const VALUE = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };
  const PROMOS = ['Q', 'R', 'B', 'N'];

  const ORTH = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const KING = ORTH.concat(DIAG);
  const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];

  const ownerOf = (c) => (c ? (c === c.toUpperCase() ? 0 : 1) : -1);
  const typeOf = (c) => c.toUpperCase();
  const makePiece = (t, owner) => (owner === 0 ? t : t.toLowerCase());
  const rowOf = (i) => i >> 3;
  const colOf = (i) => i & 7;
  const on = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const squareName = (i) => FILES[colOf(i)] + (8 - rowOf(i));
  const pieceName = (c) => NAME[typeOf(c)];

  /* ── 局面 ── */
  function create() {
    const board = [];
    SETUP.forEach((row) => { for (const ch of row) board.push(ch === '.' ? '' : ch); });
    const S = { board, turn: 0, castle: 'KQkq', ep: -1, half: 0, ply: 0, last: null, check: false, over: null, keys: [] };
    S.keys.push(keyOf(S));
    return S;
  }
  // 同じ形かを見る印（盤・番・キャスリングできるか・アンパッサンで取れるか）
  function keyOf(S) {
    let ep = -1;
    if (S.ep >= 0) {
      const dir = S.turn === 0 ? 1 : -1;   // ep のますから見た、取る側のポーンのいる行の向き
      const r = rowOf(S.ep) + dir;
      const p = makePiece('P', S.turn);
      for (const dc of [-1, 1]) {
        const c = colOf(S.ep) + dc;
        if (on(r, c) && S.board[r * 8 + c] === p) ep = S.ep;
      }
    }
    return S.board.join(',') + '|' + S.turn + '|' + S.castle + '|' + ep;
  }

  /* ── 利き ── */
  // そのますを by の駒がねらっているか
  function attacked(board, sq, by) {
    const r = rowOf(sq); const c = colOf(sq);
    // ポーン（白のポーンは上へ取るので、ねらわれるますの1つ下にいる）
    const pr = by === 0 ? r + 1 : r - 1;
    const pawn = makePiece('P', by);
    for (const dc of [-1, 1]) if (on(pr, c + dc) && board[pr * 8 + c + dc] === pawn) return true;
    const knight = makePiece('N', by);
    for (const [dr, dc] of KNIGHT) if (on(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === knight) return true;
    const king = makePiece('K', by);
    for (const [dr, dc] of KING) if (on(r + dr, c + dc) && board[(r + dr) * 8 + c + dc] === king) return true;
    const queen = makePiece('Q', by);
    const rook = makePiece('R', by);
    const bishop = makePiece('B', by);
    for (const [dr, dc] of ORTH) {
      let rr = r + dr; let cc = c + dc;
      while (on(rr, cc)) {
        const p = board[rr * 8 + cc];
        if (p) { if (p === rook || p === queen) return true; break; }
        rr += dr; cc += dc;
      }
    }
    for (const [dr, dc] of DIAG) {
      let rr = r + dr; let cc = c + dc;
      while (on(rr, cc)) {
        const p = board[rr * 8 + cc];
        if (p) { if (p === bishop || p === queen) return true; break; }
        rr += dr; cc += dc;
      }
    }
    return false;
  }
  const kingSquare = (board, owner) => board.indexOf(makePiece('K', owner));
  function inCheck(board, owner) {
    const k = kingSquare(board, owner);
    return k >= 0 && attacked(board, k, 1 - owner);
  }

  /* ── 手を作る ── */
  // キャスリングの道（キングの側 'K'・クイーンの側 'Q'）
  function castleInfo(owner, side) {
    const r = owner === 0 ? 7 : 0;
    if (side === 'K') return { king: r * 8 + 4, to: r * 8 + 6, rook: r * 8 + 7, rookTo: r * 8 + 5, empty: [r * 8 + 5, r * 8 + 6], pass: [r * 8 + 5, r * 8 + 6] };
    return { king: r * 8 + 4, to: r * 8 + 2, rook: r * 8 + 0, rookTo: r * 8 + 3, empty: [r * 8 + 1, r * 8 + 2, r * 8 + 3], pass: [r * 8 + 3, r * 8 + 2] };
  }
  // キャスリングできないわけ（できるなら ''）
  function castleBlock(S, side) {
    const me = S.turn;
    const right = me === 0 ? side : side.toLowerCase();
    const info = castleInfo(me, side);
    if (!S.castle.includes(right) || S.board[info.king] !== makePiece('K', me) || S.board[info.rook] !== makePiece('R', me)) return 'moved';
    if (info.empty.some((i) => S.board[i])) return 'blocked';
    if (attacked(S.board, info.king, 1 - me)) return 'check';
    if (info.pass.some((i) => attacked(S.board, i, 1 - me))) return 'pass';
    return '';
  }
  // ルール上は動ける形の手（自分のキングが取られる形になるかは、まだ見ない。キャスリングだけは道がねらわれていないかも見る）
  function pseudoMoves(S) {
    const { board, turn } = S;
    const out = [];
    for (let from = 0; from < 64; from += 1) {
      const p = board[from];
      if (!p || ownerOf(p) !== turn) continue;
      const t = typeOf(p);
      const r = rowOf(from); const c = colOf(from);
      if (t === 'P') {
        const dir = turn === 0 ? -1 : 1;
        const start = turn === 0 ? 6 : 1;
        const last = turn === 0 ? 0 : 7;
        const push = (to) => {
          if (rowOf(to) === last) PROMOS.forEach((q) => out.push({ from, to, promo: q }));
          else out.push({ from, to, promo: '' });
        };
        const one = (r + dir) * 8 + c;
        if (on(r + dir, c) && !board[one]) {
          push(one);
          const two = (r + 2 * dir) * 8 + c;
          if (r === start && !board[two]) out.push({ from, to: two, promo: '' });
        }
        for (const dc of [-1, 1]) {
          if (!on(r + dir, c + dc)) continue;
          const to = (r + dir) * 8 + c + dc;
          if ((board[to] && ownerOf(board[to]) !== turn) || to === S.ep) push(to);
        }
        continue;
      }
      const steps = t === 'N' ? KNIGHT : t === 'K' ? KING : null;
      if (steps) {
        for (const [dr, dc] of steps) {
          if (!on(r + dr, c + dc)) continue;
          const to = (r + dr) * 8 + c + dc;
          if (ownerOf(board[to]) !== turn) out.push({ from, to, promo: '' });
        }
      } else {
        const dirs = t === 'R' ? ORTH : t === 'B' ? DIAG : KING;
        for (const [dr, dc] of dirs) {
          let rr = r + dr; let cc = c + dc;
          while (on(rr, cc)) {
            const to = rr * 8 + cc;
            if (ownerOf(board[to]) === turn) break;
            out.push({ from, to, promo: '' });
            if (board[to]) break;
            rr += dr; cc += dc;
          }
        }
      }
      if (t === 'K') {
        for (const side of ['K', 'Q']) {
          if (!castleBlock(S, side)) out.push({ from, to: castleInfo(turn, side).to, promo: '' });
        }
      }
    }
    return out;
  }

  const isCastle = (S, m) => typeOf(S.board[m.from] || 'x') === 'K' && Math.abs(colOf(m.to) - colOf(m.from)) === 2;
  const isEnPassant = (S, m) => typeOf(S.board[m.from] || 'x') === 'P' && m.to === S.ep && colOf(m.to) !== colOf(m.from) && !S.board[m.to];

  // 盤・キャスリング・アンパッサン・50手の数を動かす（番・記録は動かさない）
  function playOnBoard(S, m) {
    const board = S.board.slice();
    const me = S.turn;
    const p = board[m.from];
    const t = typeOf(p);
    let captured = board[m.to];
    let half = S.half + 1;
    if (isEnPassant(S, m)) {
      const cap = rowOf(m.from) * 8 + colOf(m.to);
      captured = board[cap];
      board[cap] = '';
    }
    if (isCastle(S, m)) {
      const info = castleInfo(me, colOf(m.to) === 6 ? 'K' : 'Q');
      board[info.rookTo] = board[info.rook];
      board[info.rook] = '';
    }
    board[m.from] = '';
    board[m.to] = t === 'P' && m.promo ? makePiece(m.promo, me) : p;
    if (t === 'P' || captured) half = 0;
    let castle = S.castle;
    const drop = (ch) => { castle = castle.replace(ch, ''); };
    if (t === 'K') { drop(me === 0 ? 'K' : 'k'); drop(me === 0 ? 'Q' : 'q'); }
    // ルークが動いた・取られた（はじめの角のます）
    [m.from, m.to].forEach((i) => {
      if (i === 63) drop('K');
      if (i === 56) drop('Q');
      if (i === 7) drop('k');
      if (i === 0) drop('q');
    });
    const ep = t === 'P' && Math.abs(rowOf(m.to) - rowOf(m.from)) === 2 ? (m.from + m.to) / 2 : -1;
    return { board, castle, ep, half, captured };
  }

  function leavesKingSafe(S, m) {
    return !inCheck(playOnBoard(S, m).board, S.turn);
  }
  function legalMoves(S) {
    if (S.over) return [];
    return pseudoMoves(S).filter((m) => leavesKingSafe(S, m));
  }
  function hasLegalMove(S) {
    return pseudoMoves(S).some((m) => leavesKingSafe(S, m));
  }

  // 駒が足りなくて、どちらもチェックメイトにできない（キングだけ・キングとビショップかナイト1つ・同じ色のますのビショップだけ）
  function insufficient(board) {
    const rest = [];
    board.forEach((p, i) => { if (p && typeOf(p) !== 'K') rest.push([typeOf(p), i]); });
    if (!rest.length) return true;
    if (rest.length === 1 && (rest[0][0] === 'B' || rest[0][0] === 'N')) return true;
    if (rest.every(([t]) => t === 'B')) {
      const colors = new Set(rest.map(([, i]) => (rowOf(i) + colOf(i)) % 2));
      return colors.size === 1;
    }
    return false;
  }

  // 指す。新しい局面を返す（元の局面は変えない）
  function apply(S, m) {
    const mv = { from: m.from, to: m.to, promo: m.promo || '' };
    const after = playOnBoard(S, mv);
    const mover = S.turn;
    const T = {
      board: after.board, turn: 1 - mover, castle: after.castle, ep: after.ep, half: after.half,
      ply: S.ply + 1, last: null, check: false, over: null, keys: S.keys.concat(),
    };
    T.check = inCheck(T.board, T.turn);
    const key = keyOf(T);
    T.keys.push(key);
    if (!hasLegalMove(T)) {
      T.over = T.check ? { winner: mover, reason: 'mate' } : { winner: -1, reason: 'stalemate' };
    } else if (T.keys.filter((k) => k === key).length >= 3) {
      T.over = { winner: -1, reason: 'repetition' };
    } else if (T.half >= 100) {
      T.over = { winner: -1, reason: 'fifty' };
    } else if (insufficient(T.board)) {
      T.over = { winner: -1, reason: 'material' };
    }
    const kind = isCastle(S, mv) ? (colOf(mv.to) === 6 ? 'castleK' : 'castleQ') : isEnPassant(S, mv) ? 'ep' : '';
    T.last = {
      from: mv.from, to: mv.to, promo: mv.promo, captured: after.captured, kind, piece: typeOf(S.board[mv.from]),
      san: san(S, mv) + (T.over && T.over.reason === 'mate' ? '#' : T.check ? '+' : ''),
      text: jaText(S, mv, after.captured, kind),
    };
    return T;
  }

  /* ── 表記 ── */
  // 国際式の表記（Nf3・exd5・O-O・e8=Q）。チェックの + とメイトの # は apply で足す
  function san(S, m) {
    if (isCastle(S, m)) return colOf(m.to) === 6 ? 'O-O' : 'O-O-O';
    const p = S.board[m.from];
    const t = typeOf(p);
    const cap = !!S.board[m.to] || isEnPassant(S, m);
    if (t === 'P') return (cap ? FILES[colOf(m.from)] + 'x' : '') + squareName(m.to) + (m.promo ? '=' + m.promo : '');
    const others = legalMoves(S).filter((x) => x.to === m.to && x.from !== m.from && S.board[x.from] === p);
    let dis = '';
    if (others.length) {
      if (!others.some((x) => colOf(x.from) === colOf(m.from))) dis = FILES[colOf(m.from)];
      else if (!others.some((x) => rowOf(x.from) === rowOf(m.from))) dis = String(8 - rowOf(m.from));
      else dis = squareName(m.from);
    }
    return t + dis + (cap ? 'x' : '') + squareName(m.to);
  }
  // 日本語の言い方（「ナイト g1→f3（ポーンを取った）」）
  function jaText(S, m, captured, kind) {
    if (kind === 'castleK') return 'キャスリング（キングの側）';
    if (kind === 'castleQ') return 'キャスリング（クイーンの側）';
    const t = typeOf(S.board[m.from]);
    let s = NAME[t] + ' ' + squareName(m.from) + '→' + squareName(m.to);
    const notes = [];
    if (kind === 'ep') notes.push('アンパッサンでポーンを取った');
    else if (captured) notes.push(NAME[typeOf(captured)] + 'を取った');
    if (m.promo) notes.push(NAME[m.promo] + 'になった');
    if (notes.length) s += '（' + notes.join('・') + '）';
    return s;
  }

  // 指せない手の理由（画面の知らせに使う）。指せる手なら ''
  function whyIllegal(S, from, to) {
    if (S.over) return 'おわった対局です。';
    const { board, turn } = S;
    const p = board[from];
    if (!p || ownerOf(p) !== turn) return 'その駒は動かせないよ。';
    const t = typeOf(p);
    const pseudo = pseudoMoves(S).filter((m) => m.from === from && m.to === to);
    if (!pseudo.length) {
      // キャスリングのつもりで、キングを横に2マス動かした
      if (t === 'K' && rowOf(to) === rowOf(from) && Math.abs(colOf(to) - colOf(from)) === 2 && colOf(from) === 4 && rowOf(from) === (turn === 0 ? 7 : 0)) {
        const why = castleBlock(S, colOf(to) === 6 ? 'K' : 'Q');
        if (why === 'moved') return 'キングかルークがもう動いたので、そちらへのキャスリングはできないよ。';
        if (why === 'blocked') return 'キングとルークの間に駒があるので、キャスリングできないよ。';
        if (why === 'check') return 'チェックされているときは、キャスリングできないよ。';
        if (why === 'pass') return 'キングが通るマスか、行き先のマスがねらわれているので、キャスリングできないよ。';
      }
      if (ownerOf(board[to]) === turn) return '自分の駒のあるマスには動けないよ。';
      if (t === 'P' && colOf(to) !== colOf(from) && !board[to]) return 'ポーンがななめに進むのは、相手の駒を取るときだけだよ。';
      if (t === 'P' && colOf(to) === colOf(from) && board[to]) return 'ポーンは、前にある駒を取れないよ（取るのは、ななめ前）。';
      if (t !== 'N' && t !== 'K' && t !== 'P' && slidesThrough(board, from, to)) return NAME[t] + 'は、ほかの駒を跳びこえられないよ。';
      return NAME[t] + 'は、そこへは動けないよ。';
    }
    if (!pseudo.some((m) => leavesKingSafe(S, m))) {
      if (t === 'K') return 'そこへ動くとキングが取られてしまうので、動けないよ。';
      return inCheck(board, turn) ? 'チェックをよけていないので、動かせないよ。' : 'その駒が動くとキングがねらわれてしまうので、動かせないよ。';
    }
    return '';
  }
  // たて・横・ななめにまっすぐ並んでいて、間に駒がある
  function slidesThrough(board, from, to) {
    const dr = rowOf(to) - rowOf(from); const dc = colOf(to) - colOf(from);
    if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return false;
    const sr = Math.sign(dr); const sc = Math.sign(dc);
    let r = rowOf(from) + sr; let c = colOf(from) + sc;
    while (r * 8 + c !== to) {
      if (board[r * 8 + c]) return true;
      r += sr; c += sc;
    }
    return false;
  }

  // 取った駒（はじめの駒の数とくらべる。成ったポーンの分もそろえる）。[白が取った黒の駒, 黒が取った白の駒]
  function capturedLists(board) {
    const start = { P: 8, N: 2, B: 2, R: 2, Q: 1 };
    const out = [[], []];
    for (const owner of [0, 1]) {
      const have = { P: 0, N: 0, B: 0, R: 0, Q: 0 };
      board.forEach((p) => { if (p && ownerOf(p) === owner && typeOf(p) !== 'K') have[typeOf(p)] += 1; });
      // 成った駒は、はじめより多い分をポーンから来たものとして数える
      let promoted = 0;
      ['Q', 'R', 'B', 'N'].forEach((t) => { if (have[t] > start[t]) promoted += have[t] - start[t]; });
      const lost = [];
      ['Q', 'R', 'B', 'N'].forEach((t) => { for (let i = have[t]; i < start[t]; i += 1) lost.push(t); });
      for (let i = have.P + promoted; i < 8; i += 1) lost.push('P');
      out[1 - owner] = lost;
    }
    return out;
  }

  function replay(moves) {
    let S = create();
    for (const m of moves) S = apply(S, m);
    return S;
  }
  const sameMove = (a, b) => a.from === b.from && a.to === b.to && (a.promo || '') === (b.promo || '');

  /* ── CPU（1台の画面とルームの席で対戦する相手・おすすめの手） ──
     読みは「キングを取られる手も指せる形」で、速さのために合法かどうかの確認を省く（自分のキングが取られる手は、次の手で取られて大負けになる）。
     いちばん上の手だけは legalMoves の正しい手から選ぶ。
     強さ: weak＝1手だけ見て、ばらつきを大きく／normal＝2手先まで＋取り合いの読み／strong＝時間の許すかぎり5手先まで（1.5秒で打ち切り）／hint＝おすすめの手 */
  const MATE = 100000;
  const LEVELS = {
    weak: { depth: 1, ms: 300, noise: 180, flat: true },
    normal: { depth: 2, ms: 700, noise: 30 },
    strong: { depth: 5, ms: 1500, noise: 6 },
    hint: { depth: 3, ms: 900, noise: 0 },
  };
  // 場所の点（白から見た向き。行0 が奥）。中央に出たナイト・ビショップ、前に出たポーンを少し高く
  const CENTER = [];
  for (let i = 0; i < 64; i += 1) {
    const r = rowOf(i); const c = colOf(i);
    CENTER.push(Math.round((3.5 - Math.abs(3.5 - r)) + (3.5 - Math.abs(3.5 - c))));
  }
  function evaluate(N) {
    const { board, turn } = N;
    let s = 0;
    let minor = 0;
    for (let i = 0; i < 64; i += 1) {
      const p = board[i];
      if (!p) continue;
      const t = typeOf(p);
      if (t === 'Q') minor += 2;
      else if (t === 'R' || t === 'B' || t === 'N') minor += 1;
    }
    const endgame = minor <= 4;
    for (let i = 0; i < 64; i += 1) {
      const p = board[i];
      if (!p) continue;
      const o = ownerOf(p);
      const t = typeOf(p);
      const adv = o === 0 ? 7 - rowOf(i) : rowOf(i);   // 自分の陣からどれだけ前に出たか
      let v = VALUE[t];
      if (t === 'N' || t === 'B') v += CENTER[i] * 5 - (adv === 0 ? 15 : 0);
      else if (t === 'P') v += adv * (endgame ? 12 : 5) + (colOf(i) >= 2 && colOf(i) <= 5 ? CENTER[i] * 3 : 0);
      else if (t === 'Q') v += CENTER[i] * 1;
      else if (t === 'K') v += endgame ? CENTER[i] * 6 : (adv === 0 ? 20 : -adv * 15) + (colOf(i) === 6 || colOf(i) === 1 || colOf(i) === 2 ? 15 : 0);
      s += o === turn ? v : -v;
    }
    return s;
  }
  const childOf = (N, m) => {
    const a = playOnBoard(N, m);
    return { board: a.board, turn: 1 - N.turn, castle: a.castle, ep: a.ep, half: a.half };
  };
  function ordered(N, quiet) {
    let ms = pseudoMoves(N);
    if (quiet) ms = ms.filter((m) => N.board[m.to] || m.promo === 'Q');
    const score = (m) => {
      const cap = N.board[m.to];
      if (cap && typeOf(cap) === 'K') return 1e9;
      let s = 0;
      if (cap) s += VALUE[typeOf(cap)] * 10 - VALUE[typeOf(N.board[m.from])];
      if (m.promo) s += m.promo === 'Q' ? 8000 : -500;
      return s;
    };
    return ms.map((m) => ({ m, s: score(m) })).sort((a, b) => b.s - a.s).map((x) => x.m);
  }
  const STOP = {};
  function search(N, depth, alpha, beta, ctx, ply) {
    if ((++ctx.nodes & 255) === 0 && Date.now() > ctx.deadline) throw STOP;
    const quiet = depth <= 0;
    let best = -Infinity;
    if (quiet) {
      best = evaluate(N);
      if (best >= beta || depth < -6) return best;
      if (best > alpha) alpha = best;
    }
    for (const m of ordered(N, quiet)) {
      const cap = N.board[m.to];
      if (cap && typeOf(cap) === 'K') return MATE - ply;
      const v = -search(childOf(N, m), depth - 1, -beta, -alpha, ctx, ply + 1);
      if (v > best) best = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    if (best === -Infinity) return quiet ? evaluate(N) : 0;
    // どの手でもキングが取られる: チェックされていればメイト、されていなければステイルメイト（引き分け）
    if (!quiet && best === -(MATE - ply - 1) && !inCheck(N.board, N.turn)) return 0;
    return best;
  }
  // CPU の手。rnd はくじ（テストで固定するため）、ms は考える時間の上限。指せる手がなければ null
  function cpuMove(S, level, rnd, ms) {
    const r = rnd || Math.random;
    const L = LEVELS[level] || LEVELS.normal;
    const roots = legalMoves(S);
    if (!roots.length) return null;
    const N0 = { board: S.board, turn: S.turn, castle: S.castle, ep: S.ep, half: S.half };
    const ctx = { nodes: 0, deadline: Date.now() + (ms || L.ms) };
    let scores = roots.map(() => 0);
    let order = roots.map((m, i) => i);
    for (let d = 1; d <= L.depth; d += 1) {
      const next = roots.map(() => -Infinity);
      try {
        let alpha = -Infinity;
        for (const i of order) {
          const C = childOf(N0, roots[i]);
          let v;
          // 指したあとにメイト・ステイルメイトになるかは、正しく見る（読みの中では見ないので）
          const T = { board: C.board, turn: C.turn, castle: C.castle, ep: C.ep };
          if (!hasLegalMove(T)) v = inCheck(C.board, C.turn) ? MATE : 0;
          else if (L.flat) v = -evaluate(C);
          else v = -search(C, d - 1, -Infinity, -(alpha - L.noise), ctx, 1);
          next[i] = v;
          if (v > alpha) alpha = v;
        }
      } catch (e) {
        if (e !== STOP) throw e;
        if (d > 1) break;
        next.forEach((v, i) => { if (v === -Infinity) next[i] = -MATE; });
      }
      scores = next;
      order = order.slice().sort((a, b) => scores[b] - scores[a]);
      if (scores[order[0]] >= MATE - 10) break;
    }
    let pick = order[0];
    let top = -Infinity;
    for (const i of order) {
      if (scores[i] < scores[order[0]] - L.noise * 2) break;
      const v = scores[i] + (Math.abs(scores[i]) >= MATE - 100 ? 0 : r() * L.noise);
      if (v > top) { top = v; pick = i; }
    }
    return roots[pick];
  }

  const api = {
    NAME, HOW, VALUE, FILES, PROMOS, LEVELS,
    ownerOf, typeOf, pieceName, squareName, rowOf, colOf,
    create, keyOf, legalMoves, pseudoMoves, apply, replay, whyIllegal,
    inCheck, attacked, kingSquare, sameMove, capturedLists, insufficient, isCastle, isEnPassant,
    cpuMove, playOnBoard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ChessEngine = api;
})(typeof window !== 'undefined' ? window : this);
