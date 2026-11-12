/* カンペ放送局
   ・ルーム: Realtime Database（kanpe_rooms/{コード}）。操作はすべてルーム全体への transaction で、
     その中で「押した人か（匿名ID）・押した時点の段階（step）か・その段階で押せる人か」を確かめてから進める。
   ・まだ読んでいない言葉と、だれが書いたかはルームの game に置き、画面には読んだ行の言葉だけ出す
     （DevTools で見えるのは性善説で許容）。自分が書く空らんのヒントと言葉は、自分の画面にだけ出す。
   ・読み終わったら、読む人のほかのみんなで「笑わずに読めた」か「笑った」かを同時に出して判定する（だれが何を出したかは画面に出さない）。
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない */
(() => {
  'use strict';

  const E = window.KanpeEngine;
  const D = window.KanpeData;
  const { authReady, db } = RoomkRTDB.initFirebase(firebase);
  const DB_PREFIX = 'kanpe_rooms';
  const SESSION_KEY = 'kanpe_session';
  const ORPHAN_TTL_MS = 2 * 60 * 1000;
  const PRESENCE_RETRY_MS = 3000;
  const TX_RETRY_MAX = 3;
  const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
  const STATUS = { WAITING: 'waiting', PLAY: 'play' };
  const DEFAULT_TITLE = document.title;

  const NAME_MAX = 8;
  const WORD_MAX = 12;
  const PEOPLE_MAX = 12; // ホスト以外の参加者（端末なしの人も入れて）。遊ぶのは8人まで

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const msIcon = (name, cls) => { const s = el('span', 'material-symbols-rounded' + (cls ? ' ' + cls : ''), name); s.setAttribute('aria-hidden', 'true'); return s; };
  const btn = (cls, label, icon, onClick) => {
    const b = el('button', cls);
    b.type = 'button';
    if (icon) b.append(msIcon(icon));
    b.append(el('span', '', label));
    if (onClick) b.addEventListener('click', onClick);
    return b;
  };
  const toast = (message, error = true) => RoomkRTDB.showToast(message, error);
  const currentUid = () => firebase.auth().currentUser?.uid || null;
  const asArr = (v) => (Array.isArray(v) ? v.filter((x) => x != null) : (v && typeof v === 'object' ? Object.values(v) : []));
  // RTDB は数字のキーだけのオブジェクトを配列で返すことがある。配列なら番号をキーにもどす
  const asObj = (v) => {
    if (Array.isArray(v)) return Object.fromEntries(v.map((x, i) => [String(i), x]).filter(([, x]) => x != null));
    return v && typeof v === 'object' ? v : {};
  };
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const cleanWord = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, WORD_MAX);
  const progOf = (id) => D.PROGRAMS.find((p) => p.id === id) || D.PROGRAMS[0];
  const hintOf = (key) => D.HINTS[key] || { label: key, example: '', words: [] };
  const normOpts = (o) => ({ laps: o && Number(o.laps) === 2 ? 2 : 1, score: !!(o && o.score) });
  // 原稿にはふりがなを付ける（読む人が声に出して読むので）。書かれた言葉はおまかせの言葉と同じときだけ付ける
  const OMAKASE = new Set(Object.values(D.HINTS).flatMap((h) => h.words));
  const rubyText = (text) => {
    const f = document.createDocumentFragment();
    E.rubyParts(text, D.RUBY).forEach((p) => {
      if (!p.rt) { f.append(document.createTextNode(p.text)); return; }
      const r = el('ruby', '', p.text);
      r.append(el('rt', '', p.rt));
      f.append(r);
    });
    return f;
  };

  const S = {
    mode: null,     // 'host' | 'guest' | 'watch'
    me: null,       // 自分の名前（ルームの中での id）
    code: null,
    roomRef: null,
    room: null,     // 届いたルームの中身
    raw: null,      // 整えたゲーム（まだ読んでいない言葉も入っている。画面には出さない）
    view: null,     // だれでも見てよい形
    mine: null,     // 自分が書く空らん { gid, round, idx, words, submitted }
    joinedAt: null,
    currentScreen: null,
    roomCallback: null,
    connectedRef: null,
    connectedCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    timerInterval: null,
    orphanTimer: null,
    watchTimer: null,
    leaving: false,
    busy: false,
    acting: {},     // 送っている途中の操作（同じ操作の二度押しよけ）
    lastKey: null,
    drafts: {},     // 書いている途中の言葉（描きなおしても消えないように）
    showWords: false,
    composing: false,
    pending: false,
    lastLine: null, // 動かした「今の行」（同じ行を何度も動かさないため）
    stageKey: null, // 書く画面を作りなおさないための印（作りなおすと iPhone のキーボードが閉じる）
    toolsKey: null,
  };

  // ══════════════════════════════════════════════
  // ルームの中身を読む
  // ══════════════════════════════════════════════
  function validNickname(value) {
    if (!value) return '名前を入れてね';
    if (value.length > NAME_MAX) return '名前は' + NAME_MAX + '文字までだよ';
    if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '名前に使えない文字があるよ';
    if (/^\d+$/.test(value)) return '数字だけの名前は使えないよ。文字もまぜてね';
    return '';
  }

  const normBlanks = (v) => asArr(v).map((b) => ({ hint: b.hint || '', writer: b.writer || '', word: b.word || '', auto: !!b.auto }));
  // 届いたゲームを、欠けた値を補った形にする（RTDB は空の配列・null を残さない）
  function normGame(g) {
    if (!g || typeof g !== 'object') return null;
    return {
      gid: Number(g.gid) || 0,
      step: Number(g.step) || 0,
      phase: g.phase || 'write',
      players: asArr(g.players),
      uids: asObj(g.uids),
      order: asArr(g.order),
      round: Number(g.round) || 0,
      used: asArr(g.used),
      points: asObj(g.points),
      history: asArr(g.history).map((h) => ({ reader: h.reader, prog: h.prog, k: Number(h.k) || 0, blanks: normBlanks(h.blanks), success: !!h.success })),
      reader: g.reader || null,
      prog: g.prog || null,
      k: Number(g.k) || 0,
      blanks: normBlanks(g.blanks),
      submitted: asObj(g.submitted),
      rev: asObj(g.rev),
      pos: g.pos == null ? -1 : Number(g.pos),
      judges: asArr(g.judges),
      verdicts: asObj(g.verdicts),
      success: g.success == null ? null : !!g.success,
    };
  }

  const isNodevR = (R, id) => !!(R.proxies && R.proxies[id]);
  // その人の端末がつながっていない（端末なしの人は「切れる」ことがない）
  function isAwayR(R, id) {
    if (isNodevR(R, id)) return false;
    if (id === R.host) return R.hostConnected === false;
    return !(R.players && R.players[id]);
  }
  // 参加している人の並び（入った順。ホストが先）
  function peopleOf(R) {
    const list = [];
    const noRead = asObj(R.noRead);
    Object.entries(asObj(R.players)).forEach(([name, p]) => list.push({ id: name, name, joinedAt: Number(p.joinedAt) || 0, isHost: name === R.host }));
    Object.entries(asObj(R.proxies)).forEach(([name, p]) => list.push({ id: name, name, joinedAt: Number(p.joinedAt) || 0, nodev: true }));
    if (!list.some((p) => p.id === R.host)) list.push({ id: R.host, name: R.host, joinedAt: 0, isHost: true });
    list.sort((a, b) => (a.isHost ? -1 : b.isHost ? 1 : a.joinedAt - b.joinedAt));
    return list.map((p) => Object.assign(p, { away: isAwayR(R, p.id), noRead: !!noRead[p.id] }));
  }
  // 遊ぶ人（ホストは「自分も遊ぶ」のときだけ。通信が切れている人は入れない）
  const playersOf = (R) => peopleOf(R).filter((p) => !p.away && (!p.isHost || R.hostPlays)).map((p) => p.id);
  const noReadOf = (R) => Object.keys(asObj(R.noRead)).filter((k) => R.noRead[k]);

  function isExpired(room) {
    // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
    return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
  }

  const writersOf = (g) => g.players.filter((id) => id !== g.reader);
  const idxOf = (g, id) => g.blanks.map((b, i) => (b.writer === id ? i : -1)).filter((i) => i >= 0);

  // だれでも見てよい形にする（まだ読んでいない言葉・だれが書いたかは入れない）
  function publicView(R) {
    const g = normGame(R.game);
    const phase = R.status === STATUS.PLAY && g ? g.phase : 'lobby';
    const opts = normOpts(R.opts);
    const pub = { code: S.code, hostId: R.host, hostPlays: !!R.hostPlays, phase, people: peopleOf(R), opts, game: null };
    if (!g || phase === 'lobby') return pub;
    // 原稿の何行目まで見せてよいか（0 が書き出し、1〜k が空らんのある行、k+1 が締め）
    const upTo = phase === 'write' ? -1 : phase === 'read' ? g.pos : g.k + 1;
    const named = phase === 'result' || phase === 'end';
    pub.game = {
      gid: g.gid, step: g.step, players: g.players, order: g.order, round: g.round, reader: g.reader,
      prog: g.prog, k: g.k, pos: g.pos, writers: writersOf(g),
      blanks: g.blanks.map((b, i) => {
        const open = i + 1 <= upTo;
        return {
          hint: b.hint, word: open ? b.word : null, auto: open ? b.auto : false, writer: named ? b.writer : null,
        };
      }),
      submitted: Object.keys(g.submitted).filter((id) => g.submitted[id]),
      // 判定は、だれが何を出したかは入れない（出したかどうかと、結果だけ）
      judges: g.judges, judged: Object.keys(g.verdicts), success: named ? g.success : null,
      history: phase === 'end' ? g.history : [],
      points: phase === 'end' && opts.score ? g.points : null,
    };
    return pub;
  }
  function mineOf(g, id) {
    if (!g || !id) return null;
    const idx = idxOf(g, id);
    if (!idx.length) return null;
    const words = {};
    idx.forEach((i) => { words[i] = g.blanks[i].word; });
    // rev: 出す・書きなおす・おまかせに替えるのたびに1増える（古い「出す」「書きなおす」をはじく）
    // locked: ホストがおまかせに替えた言葉があると、書きなおせない
    return { gid: g.gid, round: g.round, idx, words, submitted: !!g.submitted[id], rev: Number(g.rev[id]) || 0, locked: idx.some((i) => g.blanks[i].auto) };
  }

  // ══════════════════════════════════════════════
  // 進める（ルームの中身を書きかえる。transaction の中で呼ぶ）
  // ══════════════════════════════════════════════
  function go(R, phase) {
    R.game.phase = phase;
    R.game.step += 1;
  }
  function startCheck(R) {
    const players = playersOf(R);
    const n = players.length;
    if (n < E.MIN) return '遊ぶ人が' + E.MIN + '人そろうと、はじめられるよ（いま' + n + '人）';
    if (n > E.MAX) return '遊べるのは' + E.MAX + '人までだよ（いま' + n + '人）';
    if (!E.readOrder(players, 1, noReadOf(R)).length) return '読む人がいないよ。だれか1人「読まない（書くだけ）」を外してね';
    return '';
  }
  function newGame(R, players) {
    const uids = {};
    players.forEach((id) => { if (R.players && R.players[id]) uids[id] = R.players[id].uid; });
    R.lastGameId = (Number(R.lastGameId) || 0) + 1;
    R.game = {
      gid: R.lastGameId, step: 0, phase: 'write', players, uids,
      order: E.readOrder(players, normOpts(R.opts).laps, noReadOf(R)),
      round: 0, used: [], points: {}, history: [],
      reader: null, prog: null, k: 0, blanks: [], submitted: {}, rev: {}, pos: -1, judges: [], verdicts: {}, success: null,
    };
    R.status = STATUS.PLAY;
    startRound(R);
  }
  function startRound(R) {
    const g = R.game;
    g.reader = g.order[g.round];
    const writers = E.shuffle(writersOf(g));
    const prog = E.pickProgram(D.PROGRAMS, g.used);
    g.used = g.used.concat(prog.id);
    g.prog = prog.id;
    g.k = E.blanksFor(writers.length);
    g.blanks = E.assign(writers, prog, g.k);
    g.submitted = {};
    g.rev = {};
    g.pos = -1;
    g.judges = [];
    g.verdicts = {};
    g.success = null;
    go(R, 'write');
  }
  function toRead(R) {
    R.game.pos = -1;
    go(R, 'read');
  }
  // 読みおわったら、読む人のほかのみんなで判定する
  function toJudge(R) {
    const g = R.game;
    g.judges = g.players.filter((id) => id !== g.reader);
    g.verdicts = {};
    go(R, 'judge');
  }
  // 判定を開く。半分より多くが「笑わずに読めた」なら読みきった
  function closeJudge(R) {
    const g = R.game;
    const { success } = E.judge(g.verdicts);
    g.success = success;
    const pts = E.roundPoints(g.blanks, g.reader, success);
    Object.keys(pts).forEach((id) => { g.points[id] = (Number(g.points[id]) || 0) + pts[id]; });
    g.history = g.history.concat({ reader: g.reader, prog: g.prog, k: g.k, blanks: clone(g.blanks), success });
    go(R, 'result');
  }
  function fillAuto(g, i) {
    const b = g.blanks[i];
    b.word = E.omakase(D.HINTS, b.hint);
    b.auto = true;
    g.rev[b.writer] = (Number(g.rev[b.writer]) || 0) + 1;
  }
  // 読みはじめる前（全員が出したあとの番組のはじまりも）は、届いた言葉を直せる
  const beforeReading = (g) => g.phase === 'write' || (g.phase === 'read' && g.pos < 0);

  // 遊んでいる人の操作。押した人（m.from）の匿名IDを確かめ、端末のない人の代わり（m.as）はホストだけ
  function applyMsg(R, m, uid) {
    const me = R.players && R.players[m.from];
    if (!me || me.uid !== uid) return false;
    // 待合室: 自分の「読まない（書くだけ）」を切りかえる
    if (m.type === 'noread') {
      if (R.status !== STATUS.WAITING) return false;
      R.noRead = Object.assign({}, asObj(R.noRead));
      if (m.on) R.noRead[m.from] = true;
      else delete R.noRead[m.from];
      return true;
    }
    const g = normGame(R.game);
    if (R.status !== STATUS.PLAY || !g) return false;
    R.game = g;
    // 代わりに押せるのは端末のない人の分。判定だけは、通信が切れた人の分もホストが出せる（だれも出せずに止まらないように）
    if (m.as) {
      if (m.from !== R.host || !(isNodevR(R, m.as) || (m.type === 'judge' && isAwayR(R, m.as)))) return false;
      m = Object.assign({}, m, { from: m.as });
    }
    // 古い操作は使わない（前のゲーム・前の段階の操作が遅れて届いても通さない）
    if (m.gid !== g.gid || m.step !== g.step) return false;
    const rev = Number(g.rev[m.from]) || 0;
    switch (m.type) {
      case 'submit': {
        // 出したあとの二度目・古い「出す」は通さない（ホストが替えた言葉を上書きしない）
        if (g.phase !== 'write' || g.submitted[m.from] || m.rev !== rev) return false;
        const idx = idxOf(g, m.from);
        if (!idx.length) return false;
        const words = {};
        for (const i of idx) {
          const w = cleanWord(m.words && m.words[i]);
          if (!w) return false;
          words[i] = w;
        }
        idx.forEach((i) => { g.blanks[i].word = words[i]; g.blanks[i].auto = false; });
        g.submitted[m.from] = true;
        g.rev[m.from] = rev + 1;
        if (writersOf(g).every((id) => g.submitted[id])) toRead(R);
        return true;
      }
      // 読みはじめる前なら書きなおせる（みんなが出したあとの番組のはじまりからは、書く段階にもどる）。
      // ホストがおまかせに替えた言葉があるときは書きなおせない
      case 'unsubmit':
        if (!beforeReading(g) || !g.submitted[m.from] || m.rev !== rev) return false;
        if (idxOf(g, m.from).some((i) => g.blanks[i].auto)) return false;
        delete g.submitted[m.from];
        g.rev[m.from] = rev + 1;
        if (g.phase === 'read') go(R, 'write');
        return true;
      case 'next': {
        // 読む人が進める。ホストはいつでも代わりに進められる（読む人が押さないときに止まらないように。画面では確かめてから）
        if (g.phase !== 'read' || m.pos !== g.pos) return false;
        if (m.from !== g.reader && m.from !== R.host) return false;
        if (g.pos < g.k + 1) g.pos += 1;
        else toJudge(R);
        return true;
      }
      // 判定: 読む人のほかのみんなが1回だけ出す（端末のない人の分はホストが as で）。最後の人が出すと開く
      case 'judge':
        if (g.phase !== 'judge' || !g.judges.includes(m.from) || g.verdicts[m.from]) return false;
        if (m.verdict !== 'ok' && m.verdict !== 'laugh') return false;
        g.verdicts[m.from] = m.verdict;
        if (g.judges.every((id) => g.verdicts[id])) closeJudge(R);
        return true;
      default:
        return false;
    }
  }

  // ホストの操作（ルームを変えたら true。断ったときは理由の文字列か false）
  const hostOps = {
    setOpts(R, patch) {
      if (R.status !== STATUS.WAITING) return false;
      R.opts = normOpts(Object.assign({}, normOpts(R.opts), patch));
      return true;
    },
    setHostPlays(R, v) {
      if (R.status !== STATUS.WAITING) return false;
      R.hostPlays = !!v;
      return true;
    },
    // ホストは、だれの「読まない（書くだけ）」でも切りかえられる
    setNoRead(R, name, on) {
      if (R.status !== STATUS.WAITING || !peopleOf(R).some((p) => p.id === name)) return false;
      R.noRead = Object.assign({}, asObj(R.noRead));
      if (on) R.noRead[name] = true;
      else delete R.noRead[name];
      return true;
    },
    // 端末のない人を足す。言葉はホストが代わりに入れ、読む番のときはホストが代わりに進める
    addProxy(R, name) {
      if (R.status !== STATUS.WAITING) return false;
      if (name === R.host || (R.players && R.players[name]) || isNodevR(R, name)) return '名前';
      if (peopleOf(R).filter((p) => !p.isHost).length >= PEOPLE_MAX) return '満員';
      R.proxies = Object.assign({}, R.proxies, { [name]: { joinedAt: RoomkRTDB.now() } });
      // 前に同じ名前の人が残した「書くだけ」は引きつがない
      if (R.noRead) { R.noRead = Object.assign({}, asObj(R.noRead)); delete R.noRead[name]; }
      return true;
    },
    removeProxy(R, name) {
      if (R.status !== STATUS.WAITING || !isNodevR(R, name)) return false;
      R.proxies = Object.assign({}, R.proxies);
      delete R.proxies[name];
      if (R.noRead) { R.noRead = Object.assign({}, asObj(R.noRead)); delete R.noRead[name]; }
      return true;
    },
    // はじめる（待合室から: fromGid なし／おしまいのあとの「もう一回」: 押した画面のゲームの gid）
    start(R, fromGid) {
      const g0 = normGame(R.game);
      if (R.status === STATUS.PLAY) {
        if (!(g0 && g0.phase === 'end' && g0.gid === fromGid)) return false;
      } else if (fromGid != null) return false;
      const err = startCheck(R);
      if (err) return err;
      newGame(R, playersOf(R));
      return true;
    },
    // まだの人を待たずに読みはじめる（その人の空らんには、おまかせの言葉が入る）
    skipWrite(R, gid, step) {
      const g = R.game;
      if (g.gid !== gid || g.phase !== 'write' || g.step !== step) return false;
      writersOf(g).forEach((id) => {
        if (g.submitted[id]) return;
        idxOf(g, id).forEach((i) => fillAuto(g, i));
        g.submitted[id] = true;
      });
      toRead(R);
      return true;
    },
    // 届いた言葉をおまかせに替える（読みはじめる前・ホストが画面で見ていた言葉のときだけ）
    replaceWord(R, gid, step, i, seen) {
      const g = R.game;
      const b = g.blanks[i];
      if (g.gid !== gid || !beforeReading(g) || g.step !== step || !b || b.auto || b.word !== seen || !g.submitted[b.writer]) return false;
      fillAuto(g, i);
      return true;
    },
    // まだ出していない人を待たずに判定を開く（1人以上が出しているときだけ）
    openJudge(R, gid, step) {
      const g = R.game;
      if (g.gid !== gid || g.phase !== 'judge' || g.step !== step) return false;
      if (!Object.keys(g.verdicts).length || g.judges.every((id) => g.verdicts[id])) return false;
      closeJudge(R);
      return true;
    },
    next(R, gid, step) {
      const g = R.game;
      if (g.gid !== gid || g.phase !== 'result' || g.step !== step) return false;
      g.round += 1;
      if (g.round >= g.order.length) go(R, 'end');
      else startRound(R);
      return true;
    },
    finish(R, gid, step) {
      const g = R.game;
      if (g.gid !== gid || g.phase !== 'result' || g.step !== step) return false;
      go(R, 'end');
      return true;
    },
    // 読む人の通信が切れているとき、その番をとばして次の番組へ（2026-11-07）。
    // ホストが押したときだけ。読む前（書く段階）か読んでいる途中で、押した画面と同じ番・その人がまだ切れているときに限る。
    // とばした番はふりかえり（history）にも点にも入れない。ゲームの中の名前・読む順番はそのまま（もどれば次の番から続けられる）
    skipTurn(R, gid, step, reader) {
      const g = R.game;
      if (g.gid !== gid || g.step !== step || g.reader !== reader) return false;
      if (g.phase !== 'write' && g.phase !== 'read') return false;
      if (isNodevR(R, reader) || !isAwayR(R, reader)) return 'もどった';
      g.round += 1;
      if (g.round >= g.order.length) go(R, 'end');
      else startRound(R);
      return true;
    },
    relobby(R, gid) {
      if (R.status !== STATUS.PLAY || Number(R.game && R.game.gid) !== gid) return false;
      R.status = STATUS.WAITING;
      R.game = null;
      return true;
    },
  };
  // 待合室のほかは、整えたゲームの上で操作する
  const NEEDS_GAME = ['skipWrite', 'replaceWord', 'openJudge', 'next', 'finish', 'skipTurn'];

  // ══════════════════════════════════════════════
  // つなぐ（RTDB）
  // ══════════════════════════════════════════════
  async function removeExpired(ref, fallback) {
    try {
      // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
      await ref.transaction((room) => {
        const current = room || fallback;
        return current && isExpired(current) ? null : undefined;
      }, undefined, false);
    } catch (error) {
      console.warn('[kanpe-housou] expired room cleanup failed', error);
    }
  }

  // transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
  function warmRoomCache(ref) {
    return new Promise((resolve, reject) => {
      const callback = (snap) => {
        resolve({ snap, release: () => ref.off('value', callback) });
      };
      ref.on('value', callback, reject);
    });
  }

  // 送信後に通信が切れて中止された transaction は、やり直す（届いていたかは中で確かめる）
  async function transactRetry(ref, update) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await ref.transaction(update);
      } catch (error) {
        if (error?.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
      }
    }
  }

  async function waitAuth() {
    try {
      await authReady;
      return true;
    } catch {
      toast('うまくつながらなかったよ。ページを読み直してね');
      return false;
    }
  }

  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: S.mode, nickname: S.me, roomCode: S.code, uid: currentUid(), joinedAt: S.joinedAt }));
    } catch {
      // 保存できないときは、再読み込みで戻れないだけ
    }
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 何もしない */ }
  }

  // その名前が、ゲーム中にほかの人（別の匿名ID）のものになっている
  function reservedByOther(room, name, uid) {
    const g = normGame(room.game);
    if (!g || room.status !== STATUS.PLAY || !g.players.includes(name)) return false;
    return !!g.uids[name] && g.uids[name] !== uid;
  }
  const guestCount = (room) => peopleOf(room).filter((p) => !p.isHost).length;

  function showScreen(id) {
    document.querySelectorAll('.kh-screen').forEach((n) => n.classList.remove('active'));
    $('screen-' + id).classList.add('active');
    S.currentScreen = id;
  }
  function setError(id, message) {
    const n = $(id);
    n.textContent = message || '';
    n.hidden = !message;
  }

  function resetView() {
    Object.assign(S, { room: null, raw: null, view: null, mine: null, lastKey: null, drafts: {}, showWords: false, composing: false, pending: false, lastLine: null, stageKey: null, toolsKey: null, hostMenuOpen: false });
    $('lobby-opts')._key = null;
    $('stage').replaceChildren();
    $('players').replaceChildren();
    $('tools').replaceChildren();
    $('onair').replaceChildren();
  }

  function cleanupRoom() {
    clearInterval(S.timerInterval);
    clearTimeout(S.orphanTimer);
    clearTimeout(S.watchTimer);
    if (S.roomRef && S.roomCallback) S.roomRef.off('value', S.roomCallback);
    if (S.connectedRef && S.connectedCallback) S.connectedRef.off('value', S.connectedCallback);
    if (S.roomRef && (S.mode === 'host' || S.mode === 'guest')) RoomkRTDB.cancelRoomOnDisconnect(S.roomRef);
    Object.assign(S, {
      mode: null, me: null, code: null, roomRef: null, joinedAt: null, roomCallback: null,
      connectedRef: null, connectedCallback: null, isConnected: false, presenceDirty: false, presenceAt: 0,
      timerInterval: null, orphanTimer: null, watchTimer: null, leaving: false,
    });
    resetView();
    $('hostOffOverlay').hidden = true;
    document.title = DEFAULT_TITLE;
    document.body.classList.remove('is-watch');
    delete document.body.dataset.phase;
    $('watchBadge').hidden = true;
  }

  function leaveLocally(message, isError = true) {
    clearSession();
    cleanupRoom();
    showScreen('top');
    if (message) toast(message, isError);
  }

  function connectToRoom(role, nickname, code, ref, joinedAt) {
    if (S.roomRef) cleanupRoom();
    S.mode = role;
    S.me = nickname;
    S.code = code;
    S.roomRef = ref;
    S.joinedAt = Number(joinedAt) || RoomkRTDB.now();
    $('roomCodeLabel').textContent = code;
    $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
    $('btnOpenWatch').hidden = role !== 'host';
    $('hostOffText').textContent = 'しばらく待っても戻らないときは退出してね。';
    $('btnOverlayLeave').textContent = '退出する';
    saveSession();
    // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
    if (new URLSearchParams(location.search).has('room')) history.replaceState(null, '', location.pathname);
    showScreen('room');

    S.roomCallback = (snap) => {
      // 自分で退出・ルームを閉じている途中の変化は、退出処理の側で片付ける
      if (S.roomRef !== ref || S.leaving) return;
      if (!snap.exists()) { leaveLocally('ルームが閉じられたよ', false); return; }
      const room = snap.val();
      if (isExpired(room)) {
        removeExpired(ref, room);
        leaveLocally('このルームは終わったみたい');
        return;
      }
      handleRoom(room);
    };
    ref.on('value', S.roomCallback, (error) => {
      console.warn('[kanpe-housou] room listener failed', error);
      toast('ルームの読み込みに失敗しました');
    });

    S.connectedRef = db.ref('.info/connected');
    S.connectedCallback = (snap) => {
      S.isConnected = snap.val() === true;
      if (S.isConnected && S.roomRef === ref) {
        S.presenceDirty = true;
        ensurePresence(true);
      }
    };
    S.connectedRef.on('value', S.connectedCallback);
    S.timerInterval = setInterval(() => { if (S.room && needsPresence(S.room)) ensurePresence(); }, 1000);
  }

  // 接続中なのに、ルームの上では切断・不在になっている
  function needsPresence(room) {
    if (S.mode === 'host') return room.hostConnected === false;
    if (S.mode === 'guest') return !room.players?.[S.me];
    return false;
  }

  // 接続のたびに切断時の予約を張り直し、自分の在室を確かめる。
  // 古い接続の切断予約が遅れて発火した場合も、ここで在室に戻す
  async function ensurePresence(force = false) {
    const ref = S.roomRef;
    if (!ref || S.leaving || !S.isConnected || !S.room) return;
    if (!force && Date.now() - S.presenceAt < PRESENCE_RETRY_MS) return;
    S.presenceDirty = false;
    S.presenceAt = Date.now();
    const role = S.mode;
    const nickname = S.me;
    const joinedAt = S.joinedAt;
    const uid = currentUid();
    try {
      if (role === 'host') {
        await ref.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: firebase.database.ServerValue.TIMESTAMP });
        await ref.transaction((room) => {
          if (!room || room.hostUid !== uid || isExpired(room)) return;
          if (room.hostConnected === true && room.hostDisconnectedAt == null) return;
          return Object.assign({}, room, { hostConnected: true, hostDisconnectedAt: null });
        });
      } else if (role === 'guest') {
        await ref.child('players/' + nickname).onDisconnect().remove();
        let full = false;
        let taken = false;
        await ref.transaction((room) => {
          full = false;
          taken = false;
          if (!room || isExpired(room) || room.players?.[nickname]) return;
          if (nickname === room.host || room.proxies?.[nickname] || reservedByOther(room, nickname, uid)) { taken = true; return; }
          // 戻るときは参加したときの順番のまま。ゲームで遊んでいる人は人数の上限を見ない
          const g = normGame(room.game);
          const inGame = room.status === STATUS.PLAY && g && g.players.includes(nickname);
          if (!inGame && guestCount(room) >= PEOPLE_MAX) { full = true; return; }
          return Object.assign({}, room, { players: Object.assign({}, room.players, { [nickname]: { isHost: false, uid, joinedAt } }) });
        });
        if ((full || taken) && S.roomRef === ref && !S.leaving) {
          await RoomkRTDB.cancelRoomOnDisconnect(ref);
          leaveLocally(full ? 'このルームはいっぱいだよ' : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
        }
      }
    } catch (error) {
      console.warn('[kanpe-housou] presence recovery failed', error);
      if (force) toast('再接続に失敗しました。ページを読み直してね');
    }
  }

  function handleRoom(room) {
    if (S.mode === 'guest') {
      const me = room.players?.[S.me];
      if (me && me.uid !== currentUid()) { leaveLocally('同じ名前の人が参加したので、ルームから外れました'); return; }
    }
    S.room = room;
    if (S.presenceDirty) ensurePresence(true);
    else if (needsPresence(room)) ensurePresence();
    updateHostOverlay(room);
    applyRoom(room);
  }

  function updateHostOverlay(room) {
    if (S.mode === 'guest' && room.hostConnected === false) {
      $('hostOffOverlay').hidden = false;
      // 切れたままのあいだに切れた時刻だけが新しくなったら（ホストの通信が短く揺れたとき）、期限のタイマーを仕掛けなおす。
      // 古い時刻のまま動くと「まだ期限前」で消せず、待つ画面のまま残る（2026-11-13）
      if (S.orphanTimer && S.orphanAt !== RoomkRTDB.getHostDisconnectedAt(room)) { clearTimeout(S.orphanTimer); S.orphanTimer = null; }
      if (!S.orphanTimer) {
        S.orphanAt = RoomkRTDB.getHostDisconnectedAt(room);
        const ref = S.roomRef;
        const at = RoomkRTDB.getHostDisconnectedAt(room);
        const delay = at == null ? ORPHAN_TTL_MS : Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now());
        S.orphanTimer = setTimeout(() => {
          S.orphanTimer = null;
          if (S.roomRef === ref && S.room) removeExpired(ref, S.room);
        }, delay);
      }
    } else {
      $('hostOffOverlay').hidden = true;
      clearTimeout(S.orphanTimer);
      S.orphanTimer = null;
    }
  }

  // 届いたルームを画面の形にして描く。同じ中身なら描きなおさない（押している途中のボタンを作りなおさないため）
  function applyRoom(room) {
    const key = JSON.stringify([room.status, room.host, room.hostPlays, room.hostConnected, room.opts, room.noRead, room.players, room.proxies, room.game]);
    if (key === S.lastKey) return;
    S.lastKey = key;
    S.raw = normGame(room.game);
    S.view = publicView(room);
    S.mine = S.mode === 'watch' ? null : mineOf(S.raw, S.me);
    render();
  }

  async function createRoom() {
    if (S.busy || S.roomRef) return;
    const nickname = $('hostName').value.trim();
    const error = validNickname(nickname);
    if (error) { setError('createError', error); return; }
    setError('createError', '');
    // 認証待ちの間の二度押しでルームが2つできないよう、待つ前にロックする
    S.busy = true;
    $('btnCreateRoom').disabled = true;
    try {
      if (!await waitAuth()) return;
      const uid = currentUid();
      const joinedAt = RoomkRTDB.now();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = RoomkRTDB.generateRoomCode();
        const ref = db.ref(DB_PREFIX + '/' + code);
        const result = await transactRetry(ref, (room) => {
          // やり直しのとき、前の送信で自分が作ったルームが届いていたら、そのまま使う
          if (room) return room.hostUid === uid && room.players?.[nickname]?.joinedAt === joinedAt ? room : undefined;
          return {
            status: STATUS.WAITING,
            host: nickname,
            hostUid: uid,
            hostConnected: true,
            hostDisconnectedAt: null,
            createdAt: firebase.database.ServerValue.TIMESTAMP,
            hostPlays: true,
            opts: normOpts(),
            lastGameId: 0,
            players: { [nickname]: { isHost: true, uid, joinedAt } },
          };
        });
        if (result.committed) {
          window.RoomkStats?.count('room-create');
          connectToRoom('host', nickname, code, ref, joinedAt);
          return;
        }
      }
      setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
    } catch (err) {
      console.warn('[kanpe-housou] create failed', err);
      setError('createError', '接続できませんでした。もう一度ためしてね');
    } finally {
      S.busy = false;
      $('btnCreateRoom').disabled = false;
    }
  }

  // ルームコード: 日本語入力のまま打った全角の英数字は半角に、小文字は大文字にそろえて読む。
  // 入力欄は打っている間に書き換えない（変換中に書き換えると文字が重なり、ローマ字が入らなくなる）
  const normalizeRoomCode = (raw) => String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  // ひらがななど半角にできない文字が残ったら、日本語入力の切り替え方を案内する
  const roomCodeImeError = (code) => (/[^\x00-\x7F]/.test(code)
    ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）'
    : '');

  async function joinRoom() {
    if (S.busy || S.roomRef) return;
    const nickname = $('guestName').value.trim();
    const code = normalizeRoomCode($('joinCode').value);
    const error = validNickname(nickname);
    if (error) { setError('joinError', error); return; }
    const imeError = roomCodeImeError(code);
    if (imeError) { setError('joinError', imeError); return; }
    if (!ROOM_CODE_PATTERN.test(code)) { setError('joinError', 'ルームコードは6文字で入れてね'); return; }
    setError('joinError', '');
    S.busy = true;
    $('btnJoinRoom').disabled = true;
    let release = null;
    try {
      if (!await waitAuth()) return;
      const ref = db.ref(DB_PREFIX + '/' + code);
      const warm = await warmRoomCache(ref);
      release = warm.release;
      const initial = warm.snap.val();
      if (!initial) { setError('joinError', 'ルームが見つからないよ。コードを確かめてね'); return; }
      if (isExpired(initial)) {
        await removeExpired(ref, initial);
        setError('joinError', 'このルームは終わったみたい');
        return;
      }
      const uid = currentUid();
      const joinedAt = RoomkRTDB.now();
      let reason = '';
      let rejoinAt = null;
      const result = await transactRetry(ref, (room) => {
        reason = '';
        rejoinAt = null;
        if (!room) { reason = '見つからない'; return; }
        if (isExpired(room)) { reason = '終了'; return; }
        // タブが落ちた直後・送信後の切断のやり直しなど、自分の在室が残っていたら入りなおしとして上書きする
        const stale = room.players?.[nickname];
        const mine = !!stale && !stale.isHost && stale.uid === uid;
        if (nickname === room.host || room.proxies?.[nickname] || (stale && !mine) || reservedByOther(room, nickname, uid)) { reason = '名前'; return; }
        const g = normGame(room.game);
        const inGame = room.status === STATUS.PLAY && g && g.players.includes(nickname);
        if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
        else if (!inGame && guestCount(room) >= PEOPLE_MAX) { reason = '満員'; return; }
        const next = Object.assign({}, room, { players: Object.assign({}, room.players, { [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt } }) });
        // 新しく入る人は、前に同じ名前の人が残した「書くだけ」を引きつがない（入りなおし・ゲーム中の戻りは残す）
        if (!mine && !inGame && room.noRead?.[nickname]) {
          next.noRead = Object.assign({}, asObj(room.noRead));
          delete next.noRead[nickname];
        }
        return next;
      });
      if (!result.committed) {
        const messages = {
          '見つからない': 'ルームが見つからないよ。コードを確かめてね',
          '終了': 'このルームは終わったみたい',
          '名前': 'その名前は使われているよ。少し変えてみてね',
          '満員': 'このルームはいっぱいだよ',
        };
        setError('joinError', messages[reason] || '参加できませんでした。もう一度ためしてね');
        return;
      }
      connectToRoom('guest', nickname, code, ref, rejoinAt || joinedAt);
    } catch (err) {
      console.warn('[kanpe-housou] join failed', err);
      setError('joinError', '接続できませんでした。もう一度ためしてね');
    } finally {
      release?.();
      S.busy = false;
      $('btnJoinRoom').disabled = false;
    }
  }

  async function tryReconnect() {
    const saved = loadSession();
    if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
    if (!ROOM_CODE_PATTERN.test(saved.roomCode) || validNickname(saved.nickname)) return false;
    if (S.busy || S.roomRef) return false;
    S.busy = true;
    const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoWatch'];
    tops.forEach((id) => { $(id).disabled = true; });
    let release = null;
    try {
      if (!await waitAuth()) return false;
      const uid = currentUid();
      if (!uid || uid !== saved.uid) return false;
      const ref = db.ref(DB_PREFIX + '/' + saved.roomCode);
      const warm = await warmRoomCache(ref);
      release = warm.release;
      const room = warm.snap.val();
      if (!room) return false;
      if (isExpired(room)) { await removeExpired(ref, room); return false; }
      let joinedAt = Number(saved.joinedAt) || null;
      if (saved.role === 'host') {
        if (room.host !== saved.nickname || room.hostUid !== uid) return false;
        joinedAt = Number(room.players?.[saved.nickname]?.joinedAt) || joinedAt;
      } else if (saved.role === 'guest') {
        if (saved.nickname === room.host || room.proxies?.[saved.nickname]) return false;
        const player = room.players?.[saved.nickname];
        if (player && (player.isHost || player.uid !== uid)) return false;
        if (reservedByOther(room, saved.nickname, uid)) return false;
        if (player) joinedAt = Number(player.joinedAt) || joinedAt;
      } else {
        return false;
      }
      if (S.roomRef) return false;
      connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
      return true;
    } catch (error) {
      console.warn('[kanpe-housou] reconnect failed', error);
      return false;
    } finally {
      release?.();
      S.busy = false;
      tops.forEach((id) => { $(id).disabled = false; });
    }
  }

  async function leaveRoom() {
    if (S.mode === 'watch') { leaveWatch(); return; }
    if (S.busy || !S.roomRef) return;
    const ref = S.roomRef;
    const role = S.mode;
    const nickname = S.me;
    const uid = currentUid();
    if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
    if (role === 'guest' && S.raw && S.view.phase !== 'lobby' && S.view.phase !== 'end' && S.raw.players.includes(nickname)
      && !window.confirm('放送の途中だよ。退出すると、あなたの空らんや読む番はホストが代わりに進めることになるよ。退出する？')) return;
    S.busy = true;
    S.leaving = true;
    try {
      await RoomkRTDB.cancelRoomOnDisconnect(ref);
      if (role === 'host') {
        await ref.remove();
      } else {
        // 自分の在室だけを消す（ゲームの中の名前は残す）
        await ref.transaction((room) => {
          if (!room) return;
          const mine = room.players?.[nickname];
          if (!mine || mine.uid !== uid) return;
          const players = Object.assign({}, room.players);
          delete players[nickname];
          const noRead = Object.assign({}, asObj(room.noRead));
          delete noRead[nickname];
          return Object.assign({}, room, { players, noRead });
        });
      }
    } catch (error) {
      console.warn('[kanpe-housou] leave failed', error);
      toast('退出できませんでした。もう一度ためしてね');
      S.leaving = false;
      S.busy = false;
      ensurePresence(true);
      return;
    }
    S.busy = false;
    leaveLocally('');
  }

  // ── みんなにみせる画面（見るだけ） ──
  async function enterWatch(code, fromForm = false) {
    if (S.busy || S.roomRef) return false;
    const fail = (message) => (fromForm ? setError('watchError', message) : toast(message));
    S.busy = true;
    $('btnWatchOpen').disabled = true;
    try {
      if (!await waitAuth()) return false;
      const ref = db.ref(DB_PREFIX + '/' + code);
      const room = (await ref.get()).val();
      if (S.roomRef) return false;
      if (!room) { fail('ルームが見つからないよ。コードを確かめてね'); return false; }
      if (isExpired(room)) { fail('このルームは終わったみたい'); return false; }
      connectWatch(code, ref);
      // 読み直しても同じ画面に戻れるよう、アドレスに残す
      history.replaceState(null, '', location.pathname + '?watch=' + code);
      return true;
    } catch (error) {
      console.warn('[kanpe-housou] watch failed', error);
      fail('接続できませんでした。もう一度ためしてね');
      return false;
    } finally {
      S.busy = false;
      $('btnWatchOpen').disabled = false;
    }
  }

  function connectWatch(code, ref) {
    S.mode = 'watch';
    S.me = null;
    // 共有するタブ・ウィンドウを選ぶときに見分けられるよう、題名と見出しを変える
    document.title = 'みんなにみせる画面 | カンペ放送局 | あそびのたな';
    document.body.classList.add('is-watch');
    $('watchBadge').hidden = false;
    S.code = code;
    S.roomRef = ref;
    $('roomCodeLabel').textContent = code;
    $('btnLeave').textContent = 'トップへ戻る';
    $('btnOpenWatch').hidden = true;
    $('hostOffText').textContent = 'しばらく待っても戻らないときは、トップへ戻ってね。';
    $('btnOverlayLeave').textContent = 'トップへ戻る';
    showScreen('room');
    S.roomCallback = (snap) => {
      if (S.roomRef !== ref) return;
      if (!snap.exists()) { endWatch('このルームは閉じられました'); return; }
      const room = snap.val();
      if (isExpired(room)) { endWatch('このルームは終わりました'); return; }
      S.room = room;
      updateWatchOverlay(room);
      applyRoom(room);
    };
    ref.on('value', S.roomCallback, (error) => {
      console.warn('[kanpe-housou] watch listener failed', error);
      toast('ルームの読み込みに失敗しました');
    });
  }

  // ホストが切断している間はオーバーレイを出し、期限切れになったら終わりの表示にする（ルームは消さない）
  function updateWatchOverlay(room) {
    const off = room.hostConnected === false;
    $('hostOffOverlay').hidden = !off;
    clearTimeout(S.watchTimer);
    S.watchTimer = null;
    if (!off) return;
    const at = RoomkRTDB.getHostDisconnectedAt(room);
    if (at == null) return;
    const ref = S.roomRef;
    const delay = Math.max(0, at + ORPHAN_TTL_MS - RoomkRTDB.now()) + 500;
    S.watchTimer = setTimeout(() => {
      S.watchTimer = null;
      if (S.roomRef === ref && S.room && isExpired(S.room)) endWatch('このルームは終わりました');
    }, delay);
  }

  function stopWatch() {
    cleanupRoom();
    history.replaceState(null, '', location.pathname);
  }
  function endWatch(title) {
    stopWatch();
    $('watchEndTitle').textContent = title;
    showScreen('watch-end');
  }
  function leaveWatch() {
    stopWatch();
    showScreen('top');
  }

  // ── 操作を送る ──
  // 遊んでいる人の操作。押した時点の段階（step）を添えて、ルーム全体の transaction で確かめて進める
  async function act(type, body = {}) {
    const lockKey = type + ':' + (body.as || '') + ':' + (body.idx == null ? '' : body.idx);
    if (!S.roomRef || S.mode === 'watch' || S.acting[lockKey]) return;
    const msg = Object.assign({ type, step: S.raw ? S.raw.step : 0, gid: S.raw ? S.raw.gid : 0, from: S.me }, body);
    const uid = currentUid();
    let absent = false;
    S.acting[lockKey] = true;
    try {
      const res = await S.roomRef.transaction((room) => {
        absent = false;
        if (!room || isExpired(room)) return;
        if (!room.players?.[msg.from] || room.players[msg.from].uid !== uid) { absent = true; return; }
        const R = clone(room);
        if (!applyMsg(R, msg, uid)) return;
        return R;
      });
      if (!res.committed && absent) toast('つなぎなおしているところだよ。少し待ってから、もう一度押してね');
    } catch (error) {
      console.warn('[kanpe-housou] action failed', error);
      toast('うまく送れなかったよ。もう一度押してね');
    } finally {
      delete S.acting[lockKey];
    }
  }

  // ホストの操作。結果（true/理由の文字列/false）を返す
  const NO_LOCK = ['setOpts', 'setHostPlays', 'setNoRead'];
  async function hostAct(name, ...args) {
    const lock = !NO_LOCK.includes(name);
    if (S.mode !== 'host' || !S.roomRef || (lock && S.busy)) return false;
    const uid = currentUid();
    let out = false;
    let ended = false;
    let started = false;
    if (lock) S.busy = true;
    try {
      const res = await S.roomRef.transaction((room) => {
        out = false;
        ended = false;
        started = false;
        if (!room || room.hostUid !== uid || isExpired(room)) return;
        const R = clone(room);
        const before = normGame(room.game);
        if (NEEDS_GAME.includes(name)) {
          R.game = normGame(R.game);
          if (R.status !== STATUS.PLAY || !R.game) return;
        }
        out = hostOps[name](R, ...args);
        if (out !== true) return;
        ended = R.status === STATUS.PLAY && R.game && R.game.phase === 'end' && !(before && before.phase === 'end');
        started = name === 'start';
        return R;
      });
      if (res.committed && ended) window.RoomkStats?.count('finish');
      if (res.committed && started) {
        window.RoomkStats?.count('start');
        window.RoomkStats?.count('players-' + normGame(res.snapshot.val().game).players.length);
      }
      return res.committed ? true : out;
    } catch (error) {
      console.warn('[kanpe-housou] host action failed', error);
      toast('うまく進められなかったよ。もう一度押してね');
      return false;
    } finally {
      if (lock) S.busy = false;
    }
  }

  // ══════════════════════════════════════════════
  // 画面
  // ══════════════════════════════════════════════
  const personOf = (V, id) => V.people.find((p) => p.id === id);
  const nameOf = (V, id) => { const p = personOf(V, id); return p ? p.name : id; };
  const awayOf = (V, id) => { const p = personOf(V, id); return !p || !!p.away; };
  const nodevOf = (V, id) => { const p = personOf(V, id); return !!(p && p.nodev); };
  const listNames = (V, ids) => ids.map((id) => nameOf(V, id)).join('・');
  const draftKey = (g, who, i) => g.gid + ':' + g.round + ':' + who + ':' + i;
  // 似た色がとなりや近くの番号に来ないように並べる
  const AVATAR = ['#E07A5F', '#3D85C6', '#6AA84F', '#8E7CC3', '#45818E', '#C27BA0', '#B8860B', '#5B8C5A', '#CC4125', '#E69138', '#3C78D8', '#A64D79', '#38761D'];

  function render() {
    const V = S.view;
    if (!V) return;
    // 日本語の変換中に作りなおすと、入れている文字がこわれるので、確定まで待つ
    if (S.composing) { S.pending = true; return; }
    const isHost = S.mode === 'host';
    const active = document.activeElement;
    const focus = active && active.dataset ? active.dataset.key : null;
    const caret = focus ? active.selectionStart : null;

    let meText = '';
    if (isHost) meText = V.hostPlays ? 'ホスト' : 'ホスト（進行だけ）';
    else if (S.mode !== 'watch') meText = S.me + (V.game && !V.game.players.includes(S.me) ? '・見ているだけ' : '');
    $('barMe').hidden = !meText;
    $('barMe').textContent = meText;

    document.body.dataset.phase = V.phase;
    $('ph-lobby').hidden = V.phase !== 'lobby';
    $('ph-game').hidden = V.phase === 'lobby';
    if (V.phase === 'lobby') renderLobby(V);
    else renderGame(V);

    if (focus && document.activeElement !== active) {
      const f = [...document.querySelectorAll('[data-key]')].find((n) => n.dataset.key === focus);
      if (f) { f.focus({ preventScroll: true }); if (caret != null) try { f.setSelectionRange(caret, caret); } catch { /* noop */ } }
    }
  }

  function avatar(V, id) {
    const g = V.game;
    const i = g ? g.players.indexOf(id) : V.people.findIndex((p) => p.id === id);
    const a = el('span', 'kh-avatar', Array.from(nameOf(V, id))[0] || '?');
    a.style.background = AVATAR[(i < 0 ? 0 : i) % AVATAR.length];
    a.setAttribute('aria-hidden', 'true');
    return a;
  }
  function tagEl(text, kind, icon) {
    const t = el('span', 'kh-tag' + (kind ? ' kh-tag--' + kind : ''));
    if (icon) t.append(msIcon(icon));
    t.append(el('span', '', text));
    return t;
  }

  // ── 待合室 ──
  function renderLobby(V) {
    S.hostMenuOpen = false; // 次のゲームの「そのほかの操作」は閉じた状態から
    const isHost = S.mode === 'host';
    const watch = S.mode === 'watch';
    $('lobby-join').hidden = !watch;
    $('lobby-join-code').textContent = V.code;

    $('lobby-people').replaceChildren(...V.people.map((p) => {
      const li = el('li', 'kh-person' + (p.away ? ' is-away' : ''));
      li.append(avatar(V, p.id), el('span', 'kh-person__name', p.name));
      if (p.id === V.hostId) li.append(tagEl(V.hostPlays ? 'ホスト' : 'ホスト（進行だけ）', 'muted'));
      if (p.id === S.me && !isHost) li.append(tagEl('あなた'));
      if (p.nodev && isHost) li.append(tagEl('端末なし', 'muted')); // 印はホストにだけ出す
      if (p.away) li.append(tagEl('通信が切れた', 'warn'));
      const plays = p.id !== V.hostId || V.hostPlays;
      // 「読まない（書くだけ）」: 自分の行は自分で、ホストはだれの行でも切りかえられる
      if (plays && !watch && (isHost || p.id === S.me)) {
        const lab = el('label', 'kh-noread');
        const input = el('input');
        input.type = 'checkbox';
        input.checked = p.noRead;
        input.addEventListener('change', () => {
          if (isHost) hostAct('setNoRead', p.id, input.checked);
          else act('noread', { on: input.checked });
        });
        lab.append(input, el('span', '', '読まない（書くだけ）'));
        li.append(lab);
      } else if (plays && p.noRead) li.append(tagEl('書くだけ', 'muted', 'edit'));
      if (isHost && p.nodev) li.append(btn('kh-quiet kh-person__del', '外す', 'close', () => hostAct('removeProxy', p.id)));
      return li;
    }));
    $('lobby-noread-note').hidden = watch;

    $('host-plays-row').hidden = !isHost;
    $('host-plays').checked = V.hostPlays;
    $('nodev-form').hidden = !isHost;
    const n = V.people.filter((p) => !p.away && (p.id !== V.hostId || V.hostPlays)).length;
    $('lobby-count').textContent = '遊ぶ人 ' + n + '人（' + E.MIN + '〜' + E.MAX + '人で遊べる）';

    $('lobby-opts').hidden = !isHost;
    $('lobby-opts-view').hidden = isHost;
    if (isHost) {
      const key = JSON.stringify(V.opts);
      if ($('lobby-opts')._key !== key) { optsEditor($('lobby-opts'), V.opts); $('lobby-opts')._key = key; }
    } else {
      $('lobby-opts-view').replaceChildren(
        optView('読む回数', 'みんな' + V.opts.laps + '回ずつ読む（書くだけの人はのぞく）'),
        optView('おしまいの順位', V.opts.score ? '点で順位を出す（読みきった読む人と、笑わせた書く人に1点）' : '出さない'),
      );
    }

    $('lobby-host').hidden = !isHost;
    if (isHost) {
      const err = S.room ? startCheck(S.room) : '';
      $('lobby-check').textContent = err;
      $('btn-start').disabled = !!err;
    }
    $('lobby-wait').hidden = isHost || watch;
  }
  function optsEditor(root, opts) {
    root.replaceChildren();
    const box = el('fieldset', 'kh-radios');
    box.append(el('legend', 'kh-check__label', '読む回数'));
    [[1, 'みんな1回ずつ読む'], [2, 'みんな2回ずつ読む']].forEach(([val, text]) => {
      const lab = el('label', 'kh-radio');
      const input = el('input');
      input.type = 'radio';
      input.name = 'opt-laps';
      input.value = String(val);
      input.checked = opts.laps === val;
      input.addEventListener('change', () => hostAct('setOpts', { laps: val }));
      lab.append(input, el('span', '', text));
      box.append(lab);
    });
    const lab = el('label', 'kh-check kh-check--sep');
    const input = el('input');
    input.type = 'checkbox';
    input.id = 'opt-score';
    input.checked = opts.score;
    input.addEventListener('change', () => hostAct('setOpts', { score: input.checked }));
    const text = el('span', 'kh-check__text');
    text.append(el('span', 'kh-check__label', 'おしまいに順位を出す'), el('span', 'kh-check__sub', '笑わずに読みきった読む人と、読む人を笑わせた回の書く人に1点ずつ入れて、おしまいに順位を出す'));
    lab.append(input, text);
    root.append(box, lab);
  }
  function optView(label, sub) {
    const li = el('li', 'kh-optview');
    li.append(el('span', 'kh-optview__label', label), el('span', 'kh-optview__sub', sub));
    return li;
  }

  // ── ゲーム ──
  function renderGame(V) {
    const g = V.game;
    const isHost = S.mode === 'host';
    const prog = progOf(g.prog);
    const amReader = g.reader === S.me;
    const mine = S.mine && S.mine.gid === g.gid && S.mine.round === g.round ? S.mine : null;

    // 番組の帯
    const onair = $('onair');
    onair.replaceChildren();
    if (V.phase !== 'end') {
      const lamp = el('span', 'kh-onair__lamp', V.phase === 'read' ? 'ON AIR' : V.phase === 'write' ? '準備中' : V.phase === 'judge' ? '判定中' : 'ふりかえり');
      if (V.phase === 'read') lamp.classList.add('is-live');
      const title = el('span', 'kh-onair__title');
      title.append(msIcon(prog.icon), el('span', '', prog.title));
      onair.append(lamp, title,
        el('span', 'kh-onair__round', (g.round + 1) + '本目 / 全' + g.order.length + '本'),
        el('span', 'kh-onair__reader', '読む人 ' + nameOf(V, g.reader)));
    } else onair.append(el('span', 'kh-onair__title', '放送おしまい'));

    const stage = $('stage');
    // 書く画面は、自分の空らんと出したかどうかが変わらないうちは作りなおさない（作りなおすと iPhone のキーボードが閉じる）
    const stageKey = V.phase === 'write' ? JSON.stringify([g.gid, g.round, g.step, amReader, mine]) : null;
    const build = !stageKey || stageKey !== S.stageKey;
    S.stageKey = stageKey;
    if (build) stage.replaceChildren();
    let icon = 'campaign';
    let status = '';
    let sub = '';

    if (V.phase === 'write') {
      icon = 'edit_note';
      const waiting = g.writers.filter((id) => !g.submitted.includes(id));
      if (amReader) {
        status = 'こんどは、あなたが読む番';
        sub = 'みんなが言葉を書いているよ。原稿は、読みはじめるまで見えない';
        if (build) stage.append(readerWait(prog));
      } else if (mine) {
        status = mine.submitted ? '出したよ。みんなを待っているよ' : 'ヒントに合う言葉を書こう';
        sub = mine.submitted ? (waiting.length ? 'まだ：' + listNames(V, waiting) : '') : '文の中身はひみつ。思いつかないときは「おまかせ」';
        if (build) stage.append(writeCard(V, S.me, mine, false));
      } else {
        status = nameOf(V, g.reader) + ' が読む番。みんなが言葉を書いているよ';
        sub = waiting.length ? 'まだ：' + listNames(V, waiting) : '';
      }
    } else if (V.phase === 'read') {
      icon = 'mic';
      if (amReader) {
        status = g.pos < 0 ? '準備ができたら「読みはじめる」を押してね' : '声に出して読もう';
        sub = '「つぎへ」を押すと、次の行が出るよ。言葉が変でも、笑わずにそのまま読みきろう';
      } else {
        status = nameOf(V, g.reader) + ' が読んでいるよ';
        sub = g.players.includes(S.me) ? '読む人が笑うかどうか、よく聞いていてね。読みおわったら、みんなで判定するよ' : '耳をすませて聞こう';
        // 読む人の声が聞きとれるように、番組のはじまりから読みおわるまで出す（みんなにみせる画面にも）
        const mic = el('p', 'kh-micoff');
        mic.append(msIcon('mic_off'), el('span', '', '読む人のほかのみんなは、マイクをOFFにしてね'));
        stage.append(mic);
      }
      stage.append(g.pos < 0 ? titleCard(prog) : scriptEl(V, { upTo: g.pos, current: g.pos }));
      if (amReader) stage.append(nextButton(g, false));
      // 読みはじめる前は、出した言葉を書きなおせる（書く段階にもどる）
      if (g.pos < 0 && mine && mine.submitted) stage.append(writeCard(V, S.me, mine, false));
    } else if (V.phase === 'judge') {
      icon = 'gavel';
      const waiting = g.judges.filter((id) => !g.judged.includes(id));
      const mineJudge = g.judges.includes(S.me) && S.mode !== 'watch';
      if (mineJudge && !g.judged.includes(S.me)) {
        status = nameOf(V, g.reader) + ' は、笑わずに読めた？';
        sub = 'みんなでいっせいに出すよ。だれが何を出したかは出ない';
        stage.append(judgeCard(V, S.me, false));
      } else {
        status = amReader ? 'みんなが判定しているよ' : mineJudge ? '出したよ。みんなを待っているよ' : 'みんなが判定しているよ';
        sub = waiting.length ? 'まだ：' + listNames(V, waiting) : '';
      }
      stage.append(scriptEl(V, { upTo: g.k + 1 }));
    } else if (V.phase === 'result') {
      icon = g.success ? 'emoji_events' : 'sentiment_very_satisfied';
      status = g.success ? nameOf(V, g.reader) + ' は、笑わずに読みきった！' : nameOf(V, g.reader) + ' は、笑っちゃった！';
      sub = 'だれが書いたか、原稿の中で見てみよう';
      stage.append(scriptEl(V, { upTo: g.k + 1, named: true }));
      if (isHost) {
        const last = g.round + 1 >= g.order.length;
        const row = el('div', 'kh-actions');
        row.append(btn('btn btn-primary btn-full btn-lg', last ? 'おしまいの画面へ' : 'つぎの番組へ（次に読むのは ' + nameOf(V, g.order[g.round + 1]) + '）', last ? 'flag' : 'skip_next', () => hostAct('next', g.gid, g.step)));
        stage.append(row);
      } else sub = 'だれが書いたか、原稿の中で見てみよう。ホストが次へ進めるのを待っているよ';
    } else if (V.phase === 'end') {
      icon = 'celebration';
      status = 'きょうの放送は、これでおしまい！';
      sub = 'きょうの番組を、もう一度ふりかえろう';
      stage.append(endCard(V));
      if (isHost) {
        const row = el('div', 'kh-actions');
        row.append(btn('btn btn-primary btn-full', 'もう一回（いまいる人で）', 'replay', async () => {
          const out = await hostAct('start', g.gid);
          if (typeof out === 'string') toast(out);
        }), btn('btn btn-secondary btn-full', '待合室にもどる', 'meeting_room', () => hostAct('relobby', g.gid)));
        stage.append(row);
      }
    }

    $('banner').className = 'kh-banner' + (amReader && (V.phase === 'write' || V.phase === 'read') ? ' is-me' : '');
    $('banner-icon').textContent = icon;
    $('game-status').textContent = status;
    $('game-sub').textContent = sub;
    $('game-sub').hidden = !sub;

    renderTools(V);
    renderPlayers(V);
  }

  function titleCard(prog) {
    const c = el('div', 'kh-titlecard');
    c.append(msIcon(prog.icon, 'kh-titlecard__icon'), el('p', 'kh-titlecard__title', prog.title), el('p', 'kh-titlecard__sub', 'まもなく放送がはじまります'));
    return c;
  }
  function readerWait(prog) {
    const c = el('div', 'card kh-readerwait');
    c.append(el('p', 'kh-readerwait__label', 'あなたが読む番組'));
    const t = el('p', 'kh-readerwait__title');
    t.append(msIcon(prog.icon), el('span', '', prog.title));
    c.append(t, el('p', 'kh-note', 'どんな言葉が入るかは、読むときのおたのしみ。ゆっくり、はっきり読むと、もっとおもしろくなるよ'));
    return c;
  }

  // 原稿。o: { upTo, current, named }
  function scriptEl(V, o) {
    const g = V.game;
    const prog = progOf(g.prog);
    const seq = [prog.open].concat(prog.lines.slice(0, g.k), [prog.close]);
    const box = el('div', 'kh-script');
    const head = el('p', 'kh-script__head');
    head.append(msIcon(prog.icon), el('span', '', prog.title));
    box.append(head);
    const list = el('ol', 'kh-script__lines');
    // 今の行が新しく出たときだけ動かす（ほかの人の変化で描きなおすたびに動かさない）
    const lineKey = g.gid + ':' + g.round + ':' + o.current;
    const fresh = o.current != null && S.lastLine !== lineKey;
    if (o.current != null) S.lastLine = lineKey;
    seq.forEach((text, s) => {
      if (s > o.upTo) return;
      const li = el('li', 'kh-line' + (s === o.current ? ' is-current' : '') + (s === o.current && fresh ? ' is-new' : ''));
      if (s === 0 || s === g.k + 1) {
        li.classList.add('kh-line--frame');
        const frame = el('span', '');
        frame.append(rubyText(text));
        li.append(frame);
        list.append(li);
        return;
      }
      const i = s - 1;
      const b = g.blanks[i];
      const parts = E.splitLine(text);
      const body = el('span', 'kh-line__text');
      const word = el('span', 'kh-word' + (b.auto ? ' is-auto' : ''));
      word.append(b.word && OMAKASE.has(b.word) ? rubyText(b.word) : document.createTextNode(b.word || '？'));
      body.append(rubyText(parts.before), word, rubyText(parts.after));
      li.append(body);
      if (o.named && b.writer) {
        const by = el('span', 'kh-line__by');
        by.append(el('span', '', b.auto ? 'おまかせの言葉' : nameOf(V, b.writer) + ' が書いた'));
        li.append(by);
      }
      list.append(li);
    });
    box.append(list);
    return box;
  }

  // proxy: ホストが読む人の代わりに押す。confirmText があれば確かめてから（読む人がつながっているとき）
  function nextButton(g, proxy, confirmText) {
    const label = g.pos < 0 ? '読みはじめる' : g.pos < g.k + 1 ? 'つぎへ' : '読みおわった';
    const icon = g.pos < g.k + 1 ? 'arrow_downward' : 'check';
    const cls = !proxy ? 'btn btn-primary btn-full btn-lg kh-next' : confirmText ? 'kh-quiet' : 'btn btn-secondary btn-full';
    const b = btn(cls, (proxy ? '代わりに：' : '') + label, icon, () => {
      if (confirmText && !window.confirm(confirmText)) return;
      act('next', { pos: g.pos });
    });
    b.dataset.key = proxy ? 'next-proxy' : 'next';
    return b;
  }

  // 言葉を書く。who は自分か、端末のない人
  function writeCard(V, who, m, proxy) {
    const g = V.game;
    const { idx, words, submitted, rev, locked } = m;
    const card = el('div', 'card kh-write');
    if (proxy) card.append(el('p', 'kh-write__who', nameOf(V, who) + ' の代わりに書く'));
    if (submitted) {
      const ul = el('ul', 'kh-mywords');
      idx.forEach((i) => {
        const li = el('li', 'kh-myword');
        li.append(el('span', 'kh-myword__hint', hintOf(g.blanks[i].hint).label), el('span', 'kh-myword__word', words[i] || ''));
        ul.append(li);
      });
      card.append(el('p', 'kh-write__done', '出した言葉'), ul);
      if (locked) card.append(el('p', 'kh-note', 'ホストが、おまかせの言葉に替えたよ'));
      else card.append(btn('kh-quiet', '書きなおす', 'edit', () => act('unsubmit', Object.assign({ rev }, proxy ? { as: who } : {}))));
      return card;
    }
    const inputs = [];
    idx.forEach((i) => {
      const h = hintOf(g.blanks[i].hint);
      const key = draftKey(g, who, i);
      const row = el('div', 'kh-hint');
      const id = 'w-' + g.gid + '-' + g.round + '-' + i + (proxy ? '-p' + V.people.findIndex((p) => p.id === who) : '');
      const lab = el('label', 'kh-hint__label');
      lab.htmlFor = id;
      lab.append(el('span', 'kh-hint__name', h.label), el('span', 'kh-hint__ex', '例：' + h.example));
      const input = el('input', 'form-input kh-hint__input');
      input.type = 'text';
      input.id = id;
      input.maxLength = WORD_MAX;
      input.autocomplete = 'off';
      input.dataset.key = key;
      input.value = S.drafts[key] != null ? S.drafts[key] : (words[i] || '');
      inputs.push([i, input]);
      const om = btn('btn btn-secondary btn-sm kh-hint__omakase', 'おまかせ', 'casino', () => {
        input.value = E.omakase(D.HINTS, g.blanks[i].hint);
        S.drafts[key] = input.value;
      });
      const line = el('div', 'kh-hint__row');
      line.append(input, om);
      row.append(lab, line);
      card.append(row);
    });
    // 代わりに書く欄の「出す」は副ボタンにする（自分の「出す」と主ボタンが並ばないように。読む段階の代わりに押すボタンとそろえる）
    card.append(btn('btn btn-full mt-md ' + (proxy ? 'btn-secondary' : 'btn-primary'), '出す', 'send', () => {
      const out = {};
      for (const [i, input] of inputs) {
        const w = cleanWord(input.value);
        if (!w) { toast('ぜんぶの空らんに言葉を入れてね'); input.focus(); return; }
        out[i] = w;
      }
      act('submit', Object.assign({ words: out, rev }, proxy ? { as: who } : {}));
    }));
    if (proxy) {
      const text = who + 'さんへ。ヒントは ' + idx.map((i) => '「' + hintOf(g.blanks[i].hint).label + '」').join('と') + ' だよ。言葉を考えて教えてね';
      card.append(btn('kh-quiet', 'ヒントをチャット用にコピー', 'content_copy', (e) => RoomkRTDB.copyText(text, e.currentTarget, 'チャット用の文をコピーしました', 'コピーできませんでした')));
    }
    return card;
  }

  // 判定を出す。who は自分か、端末のない人
  function judgeCard(V, who, proxy) {
    const g = V.game;
    const card = el('div', 'card kh-judge');
    if (proxy) card.append(el('p', 'kh-write__who', nameOf(V, who) + ' の代わりに出す' + (awayOf(V, who) && !nodevOf(V, who) ? '（通信が切れた）' : '')));
    const row = el('div', 'kh-judge__row');
    const send = (verdict) => act('judge', Object.assign({ verdict }, proxy ? { as: who } : {}));
    const okBtn = btn('kh-choice kh-choice--ok', '笑わずに読めた', 'sentiment_neutral', () => send('ok'));
    const laughBtn = btn('kh-choice kh-choice--laugh', '笑った', 'sentiment_very_satisfied', () => send('laugh'));
    // 人ごとに分ける（1人目の分を出したあと、2人目の同じボタンにフォーカスが移らないように）
    okBtn.dataset.key = 'judge-ok-' + (proxy ? 'p-' + who : 'me');
    laughBtn.dataset.key = 'judge-laugh-' + (proxy ? 'p-' + who : 'me');
    row.append(okBtn, laughBtn);
    card.append(row);
    return card;
  }

  function endCard(V) {
    const g = V.game;
    const wrap = el('div', 'kh-end');
    const box = el('div', 'card');
    box.append(el('h2', 'kh-h2', 'きょうの放送'));
    const ul = el('ul', 'kh-scenes');
    g.history.forEach((h, n) => {
      const prog = progOf(h.prog);
      const li = el('li', 'kh-scene');
      const head = el('p', 'kh-scene__head');
      head.append(msIcon(prog.icon), el('span', '', (n + 1) + '本目 ' + prog.title + '（読んだ人 ' + nameOf(V, h.reader) + '）'));
      li.append(head);
      li.append(el('p', 'kh-scene__result', h.success ? '笑わずに読みきった！' : '笑っちゃった！'));
      // 書かれた言葉を並べてふりかえる（おまかせの言葉は出さない）
      const words = el('p', 'kh-scene__words');
      h.blanks.forEach((b) => { if (!b.auto && b.word) words.append(el('span', 'kh-word', b.word)); });
      if (words.childElementCount) li.append(words);
      ul.append(li);
    });
    // 読む人の番をみなとばしたときは、並べる番組がない
    if (!g.history.length) ul.append(el('li', 'kh-note', 'きょうは、読んだ番組がなかったよ'));
    box.append(ul);
    wrap.append(box);

    // 番組が1本もないときは点数のカードを出さない（「読んだ番組がなかった」と食いちがうため）
    if (g.points && g.history.length) {
      const rank = el('div', 'card');
      rank.append(el('h2', 'kh-h2', '点数'));
      const ol = el('ol', 'kh-rank');
      const pt = (id) => Number(g.points[id]) || 0;
      // 点がある人だけ並べる（0点は出さない）
      const sorted = g.players.filter((id) => pt(id) > 0).sort((a, b) => pt(b) - pt(a));
      if (!sorted.length) ol.append(el('li', 'kh-note', 'みんなで放送できたね'));
      let place = 0;
      let prev = null;
      sorted.forEach((id, n) => {
        if (pt(id) !== prev) { place = n + 1; prev = pt(id); }
        const li = el('li', 'kh-rank__row');
        li.append(el('span', 'kh-rank__place', place + '位'), avatar(V, id), el('span', 'kh-rank__name', nameOf(V, id)), el('span', 'kh-rank__pt', pt(id) + '点'));
        ol.append(li);
      });
      rank.append(ol);
      wrap.append(rank);
    }
    return wrap;
  }

  // ホストの道具（待たずに進める・届いた言葉・端末のない人の代わり）
  function renderTools(V) {
    const tools = $('tools');
    if (S.mode !== 'host' || !S.raw || V.phase === 'end') { tools.replaceChildren(); tools.hidden = true; S.toolsKey = null; return; }
    const g = V.game;
    const rg = S.raw;
    const early = V.phase === 'write' || (V.phase === 'read' && g.pos < 0);
    const nodevWriters = V.phase === 'write' ? g.writers.filter((id) => nodevOf(V, id)) : [];
    const readerOff = nodevOf(V, g.reader) || awayOf(V, g.reader);
    // 読む人の通信が切れている（端末のない人はのぞく）。書く段階と読む段階で、ホストはその番をとばせる（2026-11-07）
    const readerAway = (V.phase === 'write' || V.phase === 'read') && g.reader !== S.me && !nodevOf(V, g.reader) && awayOf(V, g.reader);
    // 書く段階で、通信が切れたまま出していない人（何を待っているかをホストに出す）
    const awayWriters = V.phase === 'write' ? g.writers.filter((id) => !g.submitted.includes(id) && !nodevOf(V, id) && awayOf(V, id)) : [];
    // 中身が変わらないうちは作りなおさない（端末のない人の代わりに書いている途中でキーボードが閉じないように）
    const awayJudges = V.phase === 'judge' ? g.judges.filter((id) => awayOf(V, id)) : [];
    const key = JSON.stringify([V.phase, g.gid, g.round, g.step, g.pos, g.submitted, g.judged, awayJudges, S.showWords, early ? rg.blanks : null, nodevWriters.map((id) => mineOf(rg, id)), readerOff, readerAway, awayWriters]);
    if (key === S.toolsKey) return;
    S.toolsKey = key;
    tools.replaceChildren();
    const parts = [];

    nodevWriters.forEach((id) => {
      const m = mineOf(rg, id);
      if (m) parts.push(writeCard(V, id, m, true));
    });
    // 判定: 端末のない人・通信が切れた人の分を代わりに出す
    if (V.phase === 'judge') {
      g.judges.filter((id) => (nodevOf(V, id) || awayOf(V, id)) && !g.judged.includes(id)).forEach((id) => parts.push(judgeCard(V, id, true)));
    }
    const box = el('div', 'card kh-host');
    box.append(el('p', 'kh-host__label', 'ホストだけ'));
    const readerAwayNote = () => el('p', 'kh-note', '読む人の ' + nameOf(V, g.reader) + ' を待っています（通信が切れたみたい）');
    // 読む人の通信が切れているときだけ出す。確かめてから、その番をとばして次の番組（最後ならおしまい）へ
    const skipTurnButton = () => {
      const who = nameOf(V, g.reader);
      const last = g.round + 1 >= g.order.length;
      return btn('btn btn-secondary btn-full', who + ' の番をとばす', 'redo', async () => {
        if (!window.confirm(who + ' の番をとばして、' + (last ? 'おしまいの画面へ進む？' : 'つぎの番組へ進む？この番組で書いた言葉は使わないよ'))) return;
        const out = await hostAct('skipTurn', g.gid, g.step, g.reader);
        if (out === 'もどった') toast(who + ' がもどってきたので、このまま続けるよ', false);
      });
    };
    if (V.phase === 'judge') {
      const waiting = g.judges.filter((id) => !g.judged.includes(id));
      if (waiting.length && g.judged.length) {
        box.append(btn('btn btn-secondary btn-full', 'まだの人を待たずに判定を開く', 'fast_forward', () => {
          if (window.confirm('まだ出していない人を待たずに、出た分だけで判定する？')) hostAct('openJudge', g.gid, g.step);
        }));
      }
    }
    if (V.phase === 'write') {
      const waiting = g.writers.filter((id) => !g.submitted.includes(id));
      if (readerAway) box.append(readerAwayNote(), skipTurnButton());
      if (awayWriters.length) box.append(el('p', 'kh-note', listNames(V, awayWriters) + ' を待っています（通信が切れたみたい）'));
      if (waiting.length) {
        box.append(btn('btn btn-secondary btn-full', 'まだの人を待たずに読みはじめる', 'fast_forward', () => {
          if (window.confirm('まだ書いていない人の空らんには、おまかせの言葉が入るよ。読みはじめる？')) hostAct('skipWrite', g.gid, g.step);
        }));
      }
    }
    if (V.phase === 'read' && g.reader !== S.me) {
      if (readerOff) {
        box.append(nodevOf(V, g.reader) ? el('p', 'kh-note', nameOf(V, g.reader) + ' には、みんなにみせる画面の原稿を読んでもらおう') : readerAwayNote(), nextButton(g, true));
        if (readerAway) box.append(skipTurnButton());
      } else {
        // 読む人がつながっているのに進まないときのため。押す前に確かめる
        box.append(nextButton(g, true, nameOf(V, g.reader) + ' の代わりに進める？'));
      }
    }
    // 読みはじめる前なら、届いた言葉をたしかめて替えられる
    if (early) {
      box.append(btn('kh-quiet', S.showWords ? '届いた言葉をかくす' : '届いた言葉をたしかめる', S.showWords ? 'visibility_off' : 'visibility', () => { S.showWords = !S.showWords; S.toolsKey = null; render(); }));
      if (S.showWords) {
        const ul = el('ul', 'kh-checkwords');
        rg.blanks.forEach((b, i) => {
          if (!rg.submitted[b.writer]) return;
          const li = el('li', 'kh-checkword');
          li.append(el('span', 'kh-myword__hint', hintOf(b.hint).label), el('span', 'kh-myword__word', b.word), el('span', 'kh-checkword__by', b.auto ? 'おまかせ' : nameOf(V, b.writer)));
          if (!b.auto) li.append(btn('kh-quiet', 'おまかせに替える', 'swap_horiz', () => hostAct('replaceWord', g.gid, g.step, i, b.word)));
          ul.append(li);
        });
        if (!ul.childElementCount) ul.append(el('li', 'kh-note', 'まだ届いていないよ'));
        box.append(ul);
      }
    }
    box.append(hostMenu(V, g));
    parts.push(box);
    tools.hidden = false;
    tools.append(...parts);
  }

  // ホストがたまに使う操作（開くと出る）。作りなおしても開いたまま（S.hostMenuOpen）
  function hostMenu(V, g) {
    const d = el('details', 'kh-hostmenu');
    d.id = 'host-menu';
    d.open = !!S.hostMenuOpen;
    d.addEventListener('toggle', () => { S.hostMenuOpen = d.open; });
    d.append(el('summary', '', 'そのほかの操作'));
    const row = (b, note) => { const r = el('div', 'kh-hostmenu__row'); r.append(b); if (note) r.append(el('span', 'kh-hostmenu__note', note)); d.append(r); };
    // 結果の画面: 最後の番組でなければ、ここでおしまいにできる
    if (V.phase === 'result' && g.round + 1 < g.order.length) {
      row(btn('btn btn-secondary btn-sm', 'ここでおしまいにする', 'stop_circle', () => { if (window.confirm('ここでおしまいにする？')) hostAct('finish', g.gid, g.step); }), 'のこりの番組をとばして、おしまいの画面へ');
    }
    // 途中でやめて待合室にもどる（人数や設定を変えたいとき）
    row(btn('btn btn-secondary btn-sm', '放送をやめて待合室にもどる', 'meeting_room', () => {
      if (window.confirm('放送をやめて、待合室にもどる？ここまでの名場面は消えるよ')) hostAct('relobby', g.gid);
    }));
    return d;
  }

  function renderPlayers(V) {
    const g = V.game;
    const isHost = S.mode === 'host';
    $('players').replaceChildren(...g.players.map((id) => {
      const li = el('li', 'kh-player' + (awayOf(V, id) ? ' is-away' : '') + (id === g.reader && V.phase !== 'end' ? ' is-reader' : ''));
      li.append(avatar(V, id), el('span', 'kh-player__name', nameOf(V, id)));
      if (V.phase !== 'end' && id === g.reader) li.append(tagEl('読む人', 'reader', 'mic'));
      if (V.phase === 'write' && g.writers.includes(id)) li.append(g.submitted.includes(id) ? tagEl('出した', 'ok', 'check') : tagEl('書いている', 'muted'));
      if (V.phase === 'judge' && g.judges.includes(id)) li.append(g.judged.includes(id) ? tagEl('出した', 'ok', 'check') : tagEl('考えている', 'muted'));
      const p = personOf(V, id);
      if (p && p.noRead) li.append(tagEl('書くだけ', 'muted', 'edit'));
      if (isHost && nodevOf(V, id)) li.append(tagEl('端末なし', 'muted')); // 印はホストにだけ出す
      if (awayOf(V, id)) li.append(tagEl('通信が切れた', 'warn'));
      return li;
    }));
  }

  // ══════════════════════════════════════════════
  // ボタン
  // ══════════════════════════════════════════════
  function submitOnEnter(input, handler) {
    input.addEventListener('keydown', (event) => {
      // 日本語入力の確定の Enter では送らない（Safari は確定の Enter を isComposing=false・keyCode 229 で届ける）
      if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) handler();
    });
  }

  async function addProxy() {
    const name = $('nodev-name').value.trim();
    const error = validNickname(name);
    if (error) { setError('nodev-msg', error); return; }
    const out = await hostAct('addProxy', name);
    if (out === true) {
      setError('nodev-msg', '');
      // 確定を待つ間に次の名前を打ちはじめていたら、消さない
      if ($('nodev-name').value.trim() === name) $('nodev-name').value = '';
      return;
    }
    setError('nodev-msg', { '名前': 'その名前は使われているよ', '満員': 'このルームはいっぱいだよ' }[out] || '足せませんでした。もう一度ためしてね');
  }

  function bindButtons() {
    $('btnGoCreate').addEventListener('click', () => { setError('createError', ''); showScreen('create'); $('hostName').focus(); });
    $('btnGoJoin').addEventListener('click', () => { setError('joinError', ''); $('joinLinkHint').hidden = true; showScreen('join'); $('guestName').focus(); });
    $('btnGoWatch').addEventListener('click', () => { setError('watchError', ''); showScreen('watch-join'); $('watchCode').focus(); });
    ['btnCreateBack', 'btnJoinBack', 'btnWatchBack', 'btnWatchEndTop'].forEach((id) => $(id).addEventListener('click', () => showScreen('top')));
    $('btnCreateRoom').addEventListener('click', createRoom);
    $('btnJoinRoom').addEventListener('click', joinRoom);
    submitOnEnter($('hostName'), createRoom);
    submitOnEnter($('guestName'), joinRoom);
    submitOnEnter($('joinCode'), joinRoom);
    const openWatchFromForm = () => {
      const code = normalizeRoomCode($('watchCode').value);
      const imeError = roomCodeImeError(code);
      if (imeError) { setError('watchError', imeError); return; }
      if (!ROOM_CODE_PATTERN.test(code)) { setError('watchError', 'ルームコードは6文字で入れてね'); return; }
      setError('watchError', '');
      enterWatch(code, true);
    };
    $('btnWatchOpen').addEventListener('click', openWatchFromForm);
    submitOnEnter($('watchCode'), openWatchFromForm);

    $('btnCopyCode').addEventListener('click', (e) => RoomkRTDB.copyRoomCode(S.code, e.currentTarget));
    $('btnCopyLink').addEventListener('click', (e) => {
      if (!S.code || !ROOM_CODE_PATTERN.test(S.code)) { toast('ルームコードがありません'); return; }
      RoomkRTDB.copyRoomLink(S.code, e.currentTarget);
    });
    // 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す（共通の RoomkQR、room-qr.js）
    $('btnShowQr').addEventListener('click', () => {
      if (!S.code || !ROOM_CODE_PATTERN.test(S.code)) { toast('ルームコードがありません'); return; }
      RoomkQR.show(S.code);
    });
    $('btnOpenWatch').addEventListener('click', () => {
      if (S.mode !== 'host' || !S.code) return;
      // ポップアップブロックを避けるため、クリックの中で同期的に開く。noopener で元のタブと切り離す
      window.open(location.pathname + '?watch=' + S.code, '_blank', 'noopener');
    });
    $('btnLeave').addEventListener('click', leaveRoom);
    $('btnOverlayLeave').addEventListener('click', leaveRoom);

    $('host-plays').addEventListener('change', (e) => hostAct('setHostPlays', e.target.checked));
    $('nodev-form').addEventListener('submit', (e) => { e.preventDefault(); addProxy(); });
    $('nodev-name').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });
    $('btn-start').addEventListener('click', async () => {
      const out = await hostAct('start');
      if (typeof out === 'string') toast(out);
    });

    // 書いている途中の言葉を覚えておく。日本語の変換中は描きなおさない
    document.addEventListener('input', (e) => { const k = e.target.dataset && e.target.dataset.key; if (k) S.drafts[k] = e.target.value; });
    document.addEventListener('compositionstart', () => { S.composing = true; });
    document.addEventListener('compositionend', (e) => {
      S.composing = false;
      const k = e.target.dataset && e.target.dataset.key;
      if (k) S.drafts[k] = e.target.value;
      if (S.pending) { S.pending = false; render(); }
    });
  }

  // 参加用のリンクでひらいたとき: コードを入れた状態で参加画面を開き、名前だけ入れてもらう（コード欄は直せるように残す）
  function openJoinFromLink(code) {
    setError('joinError', '');
    $('joinCode').value = code;
    $('joinLinkHint').hidden = false;
    showScreen('join');
    $('guestName').focus({ preventScroll: true });
  }

  function resumeFromSession() {
    if (!loadSession()) return;
    tryReconnect().then((ok) => { if (!ok && !S.roomRef) clearSession(); });
  }

  function boot() {
    bindButtons();
    showScreen('top');
    const params = new URLSearchParams(location.search);
    const watchParam = params.get('watch');
    const roomParam = params.get('room');
    if (watchParam !== null) {
      // みんなにみせる画面の入口。このタブでホスト・参加者として戻らないよう、再接続の記録は先に消す
      clearSession();
      const code = normalizeRoomCode(watchParam);
      if (ROOM_CODE_PATTERN.test(code)) {
        enterWatch(code).then((ok) => { if (!ok) history.replaceState(null, '', location.pathname); });
      } else {
        toast('ルームコードが正しくないよ');
        history.replaceState(null, '', location.pathname);
      }
    } else if (roomParam !== null) {
      // 参加用のリンク（?room=コード）の入口。コードはつないだときにアドレスから外す（connectToRoom）
      const code = normalizeRoomCode(roomParam);
      const saved = loadSession();
      if (!ROOM_CODE_PATTERN.test(code)) {
        toast('ルームコードが正しくないよ');
        history.replaceState(null, '', location.pathname);
        resumeFromSession();
      } else if (saved && saved.roomCode === code) {
        // 同じルームの記録が残っていれば、名前を入れなおさずに戻る。戻れなければ参加画面へ
        tryReconnect().then((ok) => {
          if (ok || S.roomRef) return;
          clearSession();
          openJoinFromLink(code);
        });
      } else {
        if (saved) clearSession();
        openJoinFromLink(code);
      }
    } else {
      // ルームにいる途中で再読み込みしたときは、同じルームに戻る
      resumeFromSession();
    }
  }

  boot();
})();
