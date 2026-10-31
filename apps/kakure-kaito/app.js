/* かくれ怪盗
   ・ルーム: Realtime Database（kakure_rooms/{コード}）。操作はすべてルーム全体への transaction で、
     その中で「押した人か（匿名ID）・押した時点の段階（step）か・その段階で押せる人か」を確かめてから進める。
   ・役と、はじめに知っていることはルームの game に置き、画面には自分の分だけ出す（DevTools で見えるのは性善説で許容）。
     見回りで出した札は、だれが出したかを残さず、枚数だけ数える。
   ・みんなにみせる画面（?watch=）: 見るだけ。ルームに書き込まない */
(() => {
  'use strict';

  const E = window.KaitoEngine;
  const { authReady, db } = RoomkRTDB.initFirebase(firebase);
  const DB_PREFIX = 'kakure_rooms';
  const SESSION_KEY = 'kakure_session';
  const ORPHAN_TTL_MS = 2 * 60 * 1000;
  const PRESENCE_RETRY_MS = 3000;
  const TX_RETRY_MAX = 3;
  const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
  const STATUS = { WAITING: 'waiting', PLAY: 'play' };
  const DEFAULT_TITLE = document.title;

  const NAME_MAX = 8;
  const PEOPLE_MAX = 14; // ホスト以外の参加者（端末なしの人も入れて）。遊ぶのは10人まで
  const CLOCK_MS = 500;

  const OPT_LIST = [
    ['detective', '名探偵（と、最後の見やぶり）', '警備員チーム。怪盗がだれか知っている。警備員チームが3回守っても、最後に怪盗が名探偵を見やぶったら逆転'],
    ['assistant', '助手', '警備員チーム。名探偵がだれか知っている（名探偵がいるときだけ）'],
    ['fake', 'にせ探偵', '怪盗チーム。助手からは名探偵に見える（助手がいるときだけ）'],
    ['disguise', '変装名人', '怪盗チーム。名探偵にも見やぶられない（名探偵がいるときだけ）'],
    ['lone', 'ひとり怪盗', '怪盗チーム。仲間の怪盗を知らないし、仲間からも知られていない'],
    ['lens', 'しらべのルーペ', '7人から。2・3・4回目の見回りのあと、ルーペを持っている人が1人のチームをこっそり確かめる。確かめられた人にルーペが渡る'],
    ['fifthGo', '5回目はそのまま出発', '外すと、5回続けて反対が多かったら怪盗チームの勝ち'],
  ];

  const ROLE_TEXT = {
    guard: '宝石を守る。見回りでは「異常なし」しか出せない。だれが怪盗か、話し合いと投票で見ぬこう。',
    detective: '怪盗がだれか知っている。でも、怪盗に名探偵だとばれると、最後に逆転されてしまう。気づかれないように、みんなを正しいほうへ導こう。',
    assistant: '名探偵がだれか知っている。名探偵を守りながら、警備員チームを助けよう。',
    thief: '警備員のふりをして、見回りで宝石をすり替えよう。',
    fake: '助手からは、名探偵のように見えている。名探偵のふりをして、助手をまどわせよう。',
    disguise: '名探偵にも見やぶられない。安心して警備員のふりをしよう。',
    lone: '仲間の怪盗がだれか知らないし、仲間もあなたを知らない。ひとりで宝石をねらおう。',
  };

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

  const S = {
    mode: null,     // 'host' | 'guest' | 'watch'
    me: null,       // 自分の名前（ルームの中での id）
    code: null,
    roomRef: null,
    room: null,     // 届いたルームの中身
    raw: null,      // 整えたゲーム（役も入っている。画面には自分の分だけ出す）
    view: null,     // だれでも見てよい形
    secret: null,   // 自分の役 { gid, role, knows, boss, lens }
    joinedAt: null,
    currentScreen: null,
    roomCallback: null,
    connectedRef: null,
    connectedCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    timerInterval: null,
    clockTimer: null,
    orphanTimer: null,
    watchTimer: null,
    leaving: false,
    busy: false,
    acting: {},     // 送っている途中の操作（同じ操作の二度押しよけ）
    lastKey: null,
    showCard: false,
    cardGid: null,
    anim: {},       // 一度だけ動かす演出の済み印
    flipped: false, // 配ったときの役のカードをめくったか
    proxyShow: {},  // ホストが開いている、端末のない人の役
    proxyGid: null,
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

  // 届いたゲームを、欠けた値を補った形にする（RTDB は空の配列・null を残さない）
  function normGame(g) {
    if (!g || typeof g !== 'object') return null;
    const knows = {};
    Object.entries(asObj(g.knows)).forEach(([k, v]) => { knows[k] = asArr(v).map((x) => ({ kind: x.kind, ids: asArr(x.ids) })); });
    const lensSeen = {};
    Object.entries(asObj(g.lensSeen)).forEach(([k, v]) => { lensSeen[k] = asArr(v); });
    const lv = g.lastVote && typeof g.lastVote === 'object'
      ? Object.assign({}, g.lastVote, { team: asArr(g.lastVote.team), votes: g.lastVote.auto ? null : asObj(g.lastVote.votes) })
      : null;
    const lm = g.lastMission && typeof g.lastMission === 'object' ? Object.assign({}, g.lastMission, { team: asArr(g.lastMission.team) }) : null;
    return {
      gid: Number(g.gid) || 0,
      step: Number(g.step) || 0,
      phase: g.phase || 'reveal',
      players: asArr(g.players),
      uids: asObj(g.uids),
      roles: asObj(g.roles),
      knows,
      boss: g.boss || null,
      seen: asObj(g.seen),
      round: Number(g.round) || 0,
      results: asArr(g.results).map(Boolean),
      missions: asArr(g.missions).map((m) => Object.assign({}, m, { team: asArr(m.team) })),
      leaderIdx: Number(g.leaderIdx) || 0,
      proposal: Number(g.proposal) || 1,
      team: asArr(g.team),
      votes: asObj(g.votes),
      lastVote: lv,
      submitted: asObj(g.submitted),
      safeN: Number(g.safeN) || 0,
      swapN: Number(g.swapN) || 0,
      lastMission: lm,
      guessPick: g.guessPick || null,
      guess: g.guess || null,
      winner: g.winner || null,
      how: g.how || null,
      talkEnd: Number(g.talkEnd) || null,
      lensHolder: g.lensHolder || null,
      lensUsed: asArr(g.lensUsed),
      lensLog: asArr(g.lensLog),
      lensSeen,
      lensPick: g.lensPick || null,
    };
  }

  const leaderOf = (g) => g.players[g.leaderIdx % g.players.length];
  const isThief = (g, id) => E.sideOf(g.roles[id]) === 'thief';
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
    Object.entries(asObj(R.players)).forEach(([name, p]) => list.push({ id: name, name, joinedAt: Number(p.joinedAt) || 0, isHost: name === R.host }));
    Object.entries(asObj(R.proxies)).forEach(([name, p]) => list.push({ id: name, name, joinedAt: Number(p.joinedAt) || 0, nodev: true }));
    if (!list.some((p) => p.id === R.host)) list.push({ id: R.host, name: R.host, joinedAt: 0, isHost: true });
    list.sort((a, b) => (a.isHost ? -1 : b.isHost ? 1 : a.joinedAt - b.joinedAt));
    return list.map((p) => Object.assign(p, { away: isAwayR(R, p.id) }));
  }
  // 遊ぶ人（ホストは「自分も遊ぶ」のときだけ。通信が切れている人は入れない）
  const playersOf = (R) => peopleOf(R).filter((p) => !p.away && (!p.isHost || R.hostPlays)).map((p) => p.id);

  function isExpired(room) {
    // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
    return RoomkRTDB.isRoomExpired(room, ORPHAN_TTL_MS) || (!!room && !room.status);
  }

  // だれでも見てよい形にする（役・投票の中身は、開くまで入れない）
  function publicView(R) {
    const g = normGame(R.game);
    const phase = R.status === STATUS.PLAY && g ? g.phase : 'lobby';
    const pub = { code: S.code, hostId: R.host, hostPlays: !!R.hostPlays, phase, people: peopleOf(R), opts: E.normOpts(R.opts), game: null };
    if (!g || phase === 'lobby') return pub;
    const open = phase === 'guess' || phase === 'end';
    pub.game = {
      gid: g.gid, step: g.step, players: g.players, round: g.round, results: g.results, missions: g.missions,
      leaderIdx: g.leaderIdx, proposal: g.proposal, team: g.team,
      voted: Object.keys(g.votes), lastVote: g.lastVote,
      submitted: Object.keys(g.submitted), lastMission: g.lastMission,
      seen: g.seen, hasDetective: !!g.boss,
      thieves: open ? g.players.filter((id) => isThief(g, id)) : null,
      boss: open ? g.boss : null,
      roles: phase === 'end' ? g.roles : null,
      guessPick: g.guessPick, guess: g.guess, winner: g.winner, how: g.how,
      talkEnd: g.talkEnd, lensHolder: g.lensHolder, lensUsed: g.lensUsed, lensLog: g.lensLog, lensPick: g.lensPick,
    };
    return pub;
  }
  // 怪盗（ひとり怪盗のほか）は、かしらがだれかも知っている
  const secretOf = (g, id) => (g && g.roles[id] ? {
    gid: g.gid, role: g.roles[id], knows: g.knows[id] || [], boss: g.boss === id, lens: g.lensSeen[id] || [],
    bossName: g.boss && g.boss !== id && isThief(g, id) && g.roles[id] !== 'lone' ? g.boss : null,
  } : null);

  // ══════════════════════════════════════════════
  // 進める（ルームの中身を書きかえる。transaction の中で呼ぶ）
  // ══════════════════════════════════════════════
  // 段階を進める。話し合いの時間を選んでいれば、メンバー選びと見やぶりで時計を動かす（時間になっても自動では進めない）
  function go(R, phase) {
    const g = R.game;
    g.phase = phase;
    g.step += 1;
    const t = E.normOpts(R.opts).talk;
    g.talkEnd = t && (phase === 'propose' || phase === 'guess') ? RoomkRTDB.now() + t * 1000 : null;
  }
  function canLead(R, id) {
    const leader = leaderOf(R.game);
    return id === leader || (id === R.host && (isAwayR(R, leader) || isNodevR(R, leader)));
  }
  // かしらが決められないとき（端末がない・通信が切れて、端末のあるほかの怪盗もいない）は、ホストが代わりに選ぶ
  function hostMayGuess(R) {
    const g = R.game;
    if (isNodevR(R, g.boss)) return true;
    if (!isAwayR(R, g.boss)) return false;
    return !g.players.some((id) => id !== g.boss && isThief(g, id) && !isNodevR(R, id) && !isAwayR(R, id));
  }
  // 見やぶりを決めるのは、かしら。かしらの通信が切れたら、ほかの怪盗ができる
  function canGuess(R, id) {
    const g = R.game;
    return id === g.boss || (isThief(g, id) && !isNodevR(R, id) && isAwayR(R, g.boss)) || (id === R.host && hostMayGuess(R));
  }
  // ルーペを使うのは持っている人。通信が切れた・端末がないときはホストが代わりに
  function canLens(R, id) {
    const h = R.game.lensHolder;
    return id === h || (id === R.host && (isAwayR(R, h) || isNodevR(R, h)));
  }
  function openVotesR(R) {
    const g = R.game;
    g.lastVote = { round: g.round, proposal: g.proposal, team: g.team.slice(), votes: Object.assign({}, g.votes), approved: E.approved(g.votes) };
    go(R, 'voteResult');
  }
  function startMissionR(R) {
    const g = R.game;
    g.submitted = {};
    g.safeN = 0;
    g.swapN = 0;
    go(R, 'mission');
  }
  function closeMissionR(R) {
    const g = R.game;
    const n = g.players.length;
    const cards = Array(g.safeN).fill('safe').concat(Array(g.swapN).fill('swap'));
    const res = E.missionResult(n, g.round, cards);
    g.lastMission = Object.assign({ round: g.round, team: g.team.slice(), need: E.needFails(n, g.round) }, res);
    g.safeN = 0;
    g.swapN = 0;
    go(R, 'missionResult');
  }
  function nextLeader(g) {
    g.leaderIdx = (g.leaderIdx + 1) % g.players.length;
    g.team = [];
  }
  function nextRound(R) {
    const g = R.game;
    g.round += 1;
    g.proposal = 1;
    nextLeader(g);
    go(R, 'propose');
  }

  // 遊んでいる人の操作。押した人（m.from）の匿名IDを確かめ、端末のない人の代わり（m.as）はホストだけ
  function applyMsg(R, m, uid) {
    const g = normGame(R.game);
    if (R.status !== STATUS.PLAY || !g) return false;
    R.game = g;
    const me = R.players && R.players[m.from];
    if (!me || me.uid !== uid) return false;
    if (m.as) {
      if (m.from !== R.host || !isNodevR(R, m.as)) return false;
      m = Object.assign({}, m, { from: m.as });
    }
    if (m.step !== g.step) return false; // 古い操作は使わない
    const inGame = g.players.includes(m.from);
    switch (m.type) {
      case 'seen':
        if (g.phase !== 'reveal' || !inGame || g.seen[m.from]) return false;
        g.seen[m.from] = true;
        return true;
      case 'pick': {
        if (g.phase !== 'propose' || !canLead(R, m.from) || !g.players.includes(m.id)) return false;
        const size = E.teamSize(g.players.length, g.round);
        if (g.team.includes(m.id)) g.team = g.team.filter((x) => x !== m.id);
        else if (g.team.length < size) g.team = g.team.concat(m.id);
        else return false;
        return true;
      }
      case 'propose':
        if (g.phase !== 'propose' || !canLead(R, m.from)) return false;
        if (g.team.length !== E.teamSize(g.players.length, g.round)) return false;
        g.votes = {};
        if (g.proposal >= E.PROPOSALS && E.normOpts(R.opts).fifthGo) {
          g.lastVote = { round: g.round, proposal: g.proposal, team: g.team.slice(), approved: true, auto: true };
          startMissionR(R);
        } else go(R, 'vote');
        return true;
      case 'vote':
        if (g.phase !== 'vote' || !inGame || m.from in g.votes) return false;
        g.votes[m.from] = !!m.yes;
        if (g.players.every((id) => id in g.votes)) openVotesR(R);
        return true;
      case 'card': {
        if (g.phase !== 'mission' || !g.team.includes(m.from) || g.submitted[m.from]) return false;
        // だれが何を出したかは残さず、枚数だけ数える
        if (m.card === 'swap' && E.canSwap(g.roles[m.from])) g.swapN += 1;
        else g.safeN += 1;
        g.submitted[m.from] = true;
        if (g.team.every((id) => g.submitted[id])) closeMissionR(R);
        return true;
      }
      case 'gpick':
        if (g.phase !== 'guess' || !(isThief(g, m.from) || (m.from === R.host && hostMayGuess(R)))) return false;
        if (!g.players.includes(m.id) || isThief(g, m.id)) return false;
        g.guessPick = m.id;
        return true;
      case 'guess':
        // 押した人が画面で見ていた候補と同じときだけ決める（直前にほかの怪盗が選びなおしていたら決めない）
        if (g.phase !== 'guess' || !canGuess(R, m.from) || !g.guessPick || m.id !== g.guessPick) return false;
        g.guess = g.guessPick;
        g.winner = g.roles[g.guess] === 'detective' ? 'thief' : 'guard';
        g.how = g.winner === 'thief' ? 'guess' : 'guessMiss';
        go(R, 'end');
        return true;
      case 'lpick':
        if (g.phase !== 'lens' || !canLens(R, m.from)) return false;
        if (!E.lensTargets(g.players, g.lensUsed).includes(m.id)) return false;
        g.lensPick = m.id;
        return true;
      case 'lens': {
        if (g.phase !== 'lens' || !canLens(R, m.from) || !g.lensPick) return false;
        const from = g.lensHolder;
        const to = g.lensPick;
        g.lensSeen[from] = (g.lensSeen[from] || []).concat({ id: to, side: E.sideOf(g.roles[to]), round: g.round });
        g.lensLog = g.lensLog.concat({ round: g.round, from, to });
        g.lensUsed = g.lensUsed.concat(to);
        g.lensHolder = to;
        g.lensPick = null;
        go(R, 'lensResult');
        return true;
      }
      default:
        return false;
    }
  }

  // ホストの操作（ルームを変えたら true）
  const hostOps = {
    setOpts(R, patch) {
      if (R.status !== STATUS.WAITING) return false;
      R.opts = E.normOpts(Object.assign({}, R.opts, patch));
      return true;
    },
    setHostPlays(R, v) {
      if (R.status !== STATUS.WAITING) return false;
      if (v && Object.keys(asObj(R.proxies)).length) return false; // 端末のない人がいるあいだは、ホストは進行だけ
      R.hostPlays = !!v;
      return true;
    },
    // 端末のない人を足す（ホストが進行だけのときだけ）。役はホストがチャットで伝え、操作はホストが代わりに押す
    addProxy(R, name) {
      if (R.status !== STATUS.WAITING || R.hostPlays) return 'まだ';
      if (name === R.host || (R.players && R.players[name]) || isNodevR(R, name)) return '名前';
      if (peopleOf(R).filter((p) => !p.isHost).length >= PEOPLE_MAX) return '満員';
      R.proxies = Object.assign({}, R.proxies, { [name]: { joinedAt: RoomkRTDB.now() } });
      return true;
    },
    removeProxy(R, name) {
      if (R.status !== STATUS.WAITING || !isNodevR(R, name)) return false;
      R.proxies = Object.assign({}, R.proxies);
      delete R.proxies[name];
      return true;
    },
    // 役を配る（待合室から・おしまいのあとの「もう一回」）
    start(R) {
      const g0 = normGame(R.game);
      if (R.status === STATUS.PLAY && !(g0 && g0.phase === 'end')) return false;
      const ids = playersOf(R);
      const opts = E.normOpts(R.opts);
      if (E.checkOpts(ids.length, opts)) return false;
      const d = E.deal(ids, opts);
      const knows = {};
      ids.forEach((id) => { knows[id] = E.knows(d.roles, id); });
      const uids = {};
      ids.forEach((id) => { if (R.players && R.players[id]) uids[id] = R.players[id].uid; });
      R.lastGameId = (Number(R.lastGameId) || 0) + 1;
      R.game = {
        gid: R.lastGameId, step: 1, phase: 'reveal',
        players: d.order, uids, roles: d.roles, boss: d.boss, knows, seen: {},
        round: 0, results: [], missions: [], leaderIdx: 0, proposal: 1, team: [],
        votes: {}, lastVote: null, submitted: {}, safeN: 0, swapN: 0, lastMission: null,
        guessPick: null, guess: null, winner: null, how: null, talkEnd: null,
        lensHolder: null, lensUsed: [], lensLog: [], lensSeen: {}, lensPick: null,
      };
      if (E.lensOn(ids.length, opts)) { R.game.lensHolder = E.lensFirst(d.order); R.game.lensUsed = [R.game.lensHolder]; }
      R.status = STATUS.PLAY;
      return true;
    },
    begin(R, step) {
      const g = R.game;
      if (g.phase !== 'reveal' || g.step !== step) return false;
      go(R, 'propose');
      return true;
    },
    // 来ていない人の票を待たずに開く
    openVotes(R, step) {
      const g = R.game;
      if (g.phase !== 'vote' || g.step !== step) return false;
      // まだの人がいて、その全員の通信が切れているときだけ（だれも投票していなくても開ける。賛成0なので選びなおし）
      const missing = g.players.filter((id) => !(id in g.votes));
      if (!missing.length || !missing.every((id) => isAwayR(R, id))) return false;
      openVotesR(R);
      return true;
    },
    // 見回りに行った人の通信が切れたとき、この見回りをやめて同じ主任が選びなおす（選びなおしの回数は増えない）
    redoMission(R, step) {
      const g = R.game;
      if (g.phase !== 'mission' || g.step !== step) return false;
      // 出していないメンバーのうち、通信が切れている人がいるときだけ
      if (!g.team.some((id) => !g.submitted[id] && isAwayR(R, id))) return false;
      g.submitted = {};
      g.safeN = 0;
      g.swapN = 0;
      g.team = [];
      go(R, 'propose');
      return true;
    },
    next(R, step) {
      const g = R.game;
      if (g.step !== step) return false;
      if (g.phase === 'voteResult') {
        if (g.lastVote.approved) { startMissionR(R); return true; }
        if (g.proposal >= E.PROPOSALS) {
          g.winner = 'thief';
          g.how = 'rejects';
          go(R, 'end');
          return true;
        }
        g.proposal += 1;
        nextLeader(g);
        go(R, 'propose');
        return true;
      }
      if (g.phase === 'missionResult') {
        g.results = g.results.concat(g.lastMission.ok);
        g.missions = g.missions.concat(g.lastMission);
        const w = E.score(g.results);
        if (w === 'thief') { g.winner = 'thief'; g.how = 'missions'; go(R, 'end'); }
        else if (w === 'guard' && g.boss) go(R, 'guess');
        else if (w === 'guard') { g.winner = 'guard'; g.how = 'missions'; go(R, 'end'); }
        else if (g.lensHolder && E.lensAfter(g.round)) { g.lensPick = null; go(R, 'lens'); }
        else nextRound(R);
        return true;
      }
      if (g.phase === 'lensResult') {
        nextRound(R);
        return true;
      }
      return false;
    },
    relobby(R, gid) {
      if (R.status !== STATUS.PLAY || Number(R.game && R.game.gid) !== gid) return false;
      R.status = STATUS.WAITING;
      R.game = null;
      return true;
    },
  };
  // 待合室のほかは、整えたゲームの上で操作する
  const NEEDS_GAME = ['begin', 'openVotes', 'redoMission', 'next'];

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
      console.warn('[kakure-kaito] expired room cleanup failed', error);
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

  // その名前が、対局中にほかの人（別の匿名ID）のものになっている
  function reservedByOther(room, name, uid) {
    const g = normGame(room.game);
    if (!g || room.status !== STATUS.PLAY || !g.players.includes(name)) return false;
    return !!g.uids[name] && g.uids[name] !== uid;
  }
  const guestCount = (room) => peopleOf(room).filter((p) => !p.isHost).length;

  function showScreen(id) {
    document.querySelectorAll('.kk-screen').forEach((n) => n.classList.remove('active'));
    $('screen-' + id).classList.add('active');
    S.currentScreen = id;
  }
  function setError(id, message) {
    const n = $(id);
    n.textContent = message || '';
    n.hidden = !message;
  }

  function startClock() {
    clearInterval(S.clockTimer);
    S.clockTimer = setInterval(() => { document.querySelectorAll('.kk-timer').forEach(tickTimer); }, CLOCK_MS);
  }

  function resetView() {
    Object.assign(S, { room: null, raw: null, view: null, secret: null, lastKey: null, showCard: false, cardGid: null, anim: {}, flipped: false, proxyShow: {}, proxyGid: null });
    $('lobby-opts')._key = null;
    $('stage').replaceChildren();
    $('players').replaceChildren();
    $('tools').replaceChildren();
  }

  function cleanupRoom() {
    clearInterval(S.timerInterval);
    clearInterval(S.clockTimer);
    clearTimeout(S.orphanTimer);
    clearTimeout(S.watchTimer);
    if (S.roomRef && S.roomCallback) S.roomRef.off('value', S.roomCallback);
    if (S.connectedRef && S.connectedCallback) S.connectedRef.off('value', S.connectedCallback);
    if (S.roomRef && (S.mode === 'host' || S.mode === 'guest')) RoomkRTDB.cancelRoomOnDisconnect(S.roomRef);
    Object.assign(S, {
      mode: null, me: null, code: null, roomRef: null, joinedAt: null, roomCallback: null,
      connectedRef: null, connectedCallback: null, isConnected: false, presenceDirty: false, presenceAt: 0,
      timerInterval: null, clockTimer: null, orphanTimer: null, watchTimer: null, leaving: false,
    });
    resetView();
    $('hostOffOverlay').hidden = true;
    document.title = DEFAULT_TITLE;
    document.body.classList.remove('is-watch');
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
      console.warn('[kakure-kaito] room listener failed', error);
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
    startClock();
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
      console.warn('[kakure-kaito] presence recovery failed', error);
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
      if (!S.orphanTimer) {
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
    const key = JSON.stringify([room.status, room.host, room.hostPlays, room.hostConnected, room.opts, room.players, room.proxies, room.game]);
    if (key === S.lastKey) return;
    S.lastKey = key;
    S.raw = normGame(room.game);
    S.view = publicView(room);
    S.secret = S.mode === 'watch' ? null : secretOf(S.raw, S.me);
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
            opts: E.normOpts(),
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
      console.warn('[kakure-kaito] create failed', err);
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
        return Object.assign({}, room, { players: Object.assign({}, room.players, { [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt } }) });
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
      console.warn('[kakure-kaito] join failed', err);
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
      console.warn('[kakure-kaito] reconnect failed', error);
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
      && !window.confirm('ゲームの途中だよ。退出すると、あなたの番はホストが代わりに進めることになるよ。退出する？')) return;
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
          return Object.assign({}, room, { players });
        });
      }
    } catch (error) {
      console.warn('[kakure-kaito] leave failed', error);
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
      console.warn('[kakure-kaito] watch failed', error);
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
    document.title = 'みんなにみせる画面 | かくれ怪盗 | room-K';
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
    startClock();
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
      console.warn('[kakure-kaito] watch listener failed', error);
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
  async function act(type, body) {
    const lockKey = type + ':' + ((body && body.as) || '');
    if (!S.roomRef || !S.raw || S.mode === 'watch' || S.acting[lockKey]) return;
    const msg = Object.assign({ type, step: S.raw.step, from: S.me }, body);
    const uid = currentUid();
    let ended = false;
    let absent = false;
    S.acting[lockKey] = true;
    try {
      const res = await S.roomRef.transaction((room) => {
        ended = false;
        absent = false;
        if (!room || isExpired(room)) return;
        if (!room.players?.[msg.from] || room.players[msg.from].uid !== uid) { absent = true; return; }
        const R = clone(room);
        const before = normGame(room.game);
        if (!applyMsg(R, msg, uid)) return;
        ended = R.game.phase === 'end' && !(before && before.phase === 'end');
        return R;
      });
      if (res.committed && ended) window.RoomkStats?.count('finish');
      if (!res.committed && absent) toast('つなぎなおしているところだよ。少し待ってから、もう一度押してね');
    } catch (error) {
      console.warn('[kakure-kaito] action failed', error);
      toast('うまく送れなかったよ。もう一度押してね');
    } finally {
      delete S.acting[lockKey];
    }
  }

  // ホストの操作。結果（true/理由の文字列/false）を返す
  const NO_LOCK = ['setOpts', 'setHostPlays'];
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
      console.warn('[kakure-kaito] host action failed', error);
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
  const talkLabel = (sec) => (sec ? (sec / 60) + '分' : '制限なし');

  function render() {
    const V = S.view;
    if (!V) return;
    const isHost = S.mode === 'host';
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
  }

  // ── 待合室 ──
  function renderLobby(V) {
    const isHost = S.mode === 'host';
    const watch = S.mode === 'watch';
    $('lobby-join').hidden = !watch;
    $('lobby-join-code').textContent = V.code;

    $('lobby-people').replaceChildren(...V.people.map((p) => {
      const li = el('li', 'kk-person' + (p.away ? ' is-away' : ''));
      li.append(avatar(V, p.id), el('span', 'kk-person__name', p.name));
      if (p.id === V.hostId) li.append(el('span', 'kk-tag kk-tag--muted', V.hostPlays ? 'ホスト' : 'ホスト（進行だけ）'));
      if (p.id === S.me && !isHost) li.append(el('span', 'kk-tag', 'あなた'));
      if (p.nodev && isHost) li.append(el('span', 'kk-tag kk-tag--muted', '端末なし')); // 印はホストにだけ出す
      if (p.away) li.append(el('span', 'kk-tag kk-tag--warn', '通信が切れた'));
      if (isHost && p.nodev) {
        li.append(btn('kk-quiet kk-person__del', '外す', null, () => hostAct('removeProxy', p.id)));
      }
      return li;
    }));
    $('host-plays-row').hidden = !isHost;
    $('host-plays').checked = V.hostPlays;
    const hasNodev = V.people.some((p) => p.nodev);
    $('host-plays').disabled = hasNodev;
    $('host-plays-sub').textContent = hasNodev ? '端末のない人がいるあいだは、ホストは進行だけ（役を見て代わりに押すため）' : '外すと進行だけ。役は配られず、だれの役も見えない';
    $('nodev-form').hidden = !isHost || V.hostPlays;
    const n = V.people.filter((p) => !p.away && (p.id !== V.hostId || V.hostPlays)).length;
    const t = E.THIEVES[n];
    $('lobby-count').textContent = '遊ぶ人 ' + n + '人' + (t ? '（そのうち怪盗は' + t + '人）' : '') + '。4〜10人で遊べるよ。'
      + (V.opts.lens && n < E.LENS_MIN ? 'しらべのルーペは' + E.LENS_MIN + '人からなので、いまの人数では使わないよ。' : '');

    // 役
    $('lobby-opts').hidden = !isHost;
    $('lobby-opts-view').hidden = isHost;
    if (isHost) {
      const key = JSON.stringify(V.opts);
      if ($('lobby-opts')._key !== key) { optsEditor($('lobby-opts'), V.opts); $('lobby-opts')._key = key; }
    } else {
      const on = OPT_LIST.filter(([k]) => V.opts[k]);
      const rows = (on.length ? on : [[null, '特別な役はなし（警備員と怪盗だけ）', '']]).concat(V.opts.talk ? [[null, '話し合いの時間 ' + talkLabel(V.opts.talk), 'メンバー選びと見やぶりのときに、残り時間が出る']] : []);
      $('lobby-opts-view').replaceChildren(...rows.map(([, label, sub]) => {
        const li = el('li', 'kk-optview');
        li.append(el('span', 'kk-optview__label', label));
        if (sub) li.append(el('span', 'kk-optview__sub', sub));
        return li;
      }));
    }

    $('lobby-host').hidden = !isHost;
    if (isHost) {
      const err = E.checkOpts(n, V.opts);
      $('lobby-check').textContent = err;
      $('btn-start').disabled = !!err;
    }
    $('lobby-wait').hidden = isHost || watch;
  }

  function optsEditor(root, opts) {
    const o = E.normOpts(opts);
    root.replaceChildren();
    const list = el('div', 'kk-checks');
    OPT_LIST.forEach(([key, label, sub]) => {
      const lb = el('label', 'kk-check');
      const c = el('input');
      c.type = 'checkbox';
      c.checked = !!o[key];
      c.dataset.key = key;
      c.disabled = (key === 'assistant' || key === 'disguise') ? !o.detective : key === 'fake' ? !o.assistant : false;
      c.addEventListener('change', () => hostAct('setOpts', { [key]: c.checked }));
      const txt = el('span', 'kk-check__text');
      txt.append(el('span', 'kk-check__label', label), el('span', 'kk-check__sub', sub));
      lb.append(c, txt);
      if (key === 'fifthGo') lb.classList.add('kk-check--sep');
      list.append(lb);
    });
    root.append(list);
    // 話し合いの時間
    const talk = el('label', 'kk-talk');
    talk.append(el('span', 'kk-talk__label', '話し合いの時間'));
    const sel = el('select');
    sel.id = 'talk-select';
    E.TALKS.forEach((sec) => { const o2 = el('option', '', talkLabel(sec)); o2.value = String(sec); if (sec === o.talk) o2.selected = true; sel.append(o2); });
    sel.addEventListener('change', () => hostAct('setOpts', { talk: Number(sel.value) }));
    talk.append(sel, el('span', 'kk-check__sub', 'メンバー選びと見やぶりのときに残り時間を出す。時間になっても自動では進まない'));
    root.append(talk);
  }

  // 話し合いの残り時間（描きなおさずに、数字だけ書きかえる）
  function timerEl(end) {
    const t = el('p', 'kk-timer');
    t.dataset.end = String(end);
    t.append(msIcon('timer'), el('span', 'kk-timer__text', ''));
    tickTimer(t);
    return t;
  }
  function tickTimer(t) {
    const left = Math.ceil((Number(t.dataset.end) - RoomkRTDB.now()) / 1000);
    const over = left <= 0;
    t.classList.toggle('is-over', over);
    t.lastChild.textContent = over ? '時間になったよ' : '話し合い 残り ' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  }

  // ── ゲーム ──
  const STEPS = [['reveal', '役の確認', 'badge'], ['propose', 'メンバー選び', 'groups'], ['vote', '投票', 'how_to_vote'], ['mission', '見回り', 'directions_walk'], ['missionResult', '結果', 'diamond']];
  const stepOf = (ph) => ({ reveal: 0, propose: 1, vote: 2, voteResult: 2, mission: 3, missionResult: 4 }[ph]);
  // 似た色がとなりや近くの番号に来ないように並べる
  const AVATAR = ['#E07A5F', '#3D85C6', '#6AA84F', '#8E7CC3', '#45818E', '#C27BA0', '#B8860B', '#5B8C5A', '#CC4125', '#E69138'];

  // その結果をはじめて出すときだけ動かす（描きなおすたびに動かさない）
  function firstTime(key) {
    if (S.anim[key]) return false;
    S.anim[key] = true;
    return true;
  }

  function avatar(V, id) {
    const g = V.game;
    const i = g ? g.players.indexOf(id) : V.people.findIndex((p) => p.id === id);
    const a = el('span', 'kk-avatar', Array.from(nameOf(V, id))[0] || '?');
    a.style.background = AVATAR[(i < 0 ? 0 : i) % AVATAR.length];
    a.setAttribute('aria-hidden', 'true');
    return a;
  }

  // 宝石の絵（中身は決まった文字列だけ。人の入力は入らない）
  const GEM_SVG = '<svg class="kk-gem" viewBox="0 0 64 52" aria-hidden="true">'
    + '<polygon class="kk-gem__body" points="14,4 50,4 61,17 32,49 3,17"></polygon>'
    + '<polyline class="kk-gem__line" points="3,17 61,17"></polyline>'
    + '<polyline class="kk-gem__line" points="14,4 23,17 32,49 41,17 50,4"></polyline></svg>';
  function gemSvg() {
    const t = document.createElement('template');
    t.innerHTML = GEM_SVG;
    return t.content.firstChild;
  }

  function renderGame(V) {
    const g = V.game;
    const n = g.players.length;
    const isHost = S.mode === 'host';
    const watch = S.mode === 'watch';
    const sec = S.secret && S.secret.gid === g.gid ? S.secret : null;
    const iPlay = g.players.includes(S.me) && !watch;
    if (S.cardGid !== g.gid) { S.cardGid = g.gid; S.showCard = false; S.flipped = false; }
    const phase = V.phase;

    // 展示室: 守った数とすり替えられた数、見回りの5回
    const safeN = g.results.filter((r) => r === true).length;
    const swapN = g.results.filter((r) => r === false).length;
    const scoreSide = (cls, label, num, icon) => {
      const box = el('div', 'kk-score__side kk-score__side--' + cls);
      box.append(el('span', 'kk-score__label', label));
      const pips = el('span', 'kk-score__pips');
      for (let i = 0; i < E.WIN; i += 1) pips.append(msIcon(icon, 'kk-pip' + (i < num ? ' is-on' : '')));
      box.append(pips);
      box.setAttribute('aria-label', label + ' ' + num + '回（' + E.WIN + '回で勝ち）');
      return box;
    };
    $('score').replaceChildren(scoreSide('guard', '守った', safeN, 'diamond'), el('span', 'kk-score__vs', 'VS'), scoreSide('thief', 'すり替え', swapN, 'theater_comedy'));

    $('track').replaceChildren(...Array.from({ length: E.ROUNDS }, (_, r) => {
      const res = g.results[r];
      const cur = r === g.round && res === undefined && phase !== 'end' && phase !== 'guess';
      const tile = el('div', 'kk-tile' + (res === true ? ' is-safe' : res === false ? ' is-swap' : '') + (cur ? ' is-current' : ''));
      if (res !== undefined && firstTime('tile:' + g.gid + ':' + r)) tile.classList.add('is-new');
      tile.append(el('span', 'kk-tile__no', (r + 1) + '回目'));
      const case_ = el('div', 'kk-case');
      if (cur) case_.append(el('span', 'kk-case__beam'));
      if (res === false) {
        const card = el('span', 'kk-case__card');
        card.append(msIcon('theater_comedy'));
        case_.append(card);
      } else case_.append(gemSvg());
      case_.append(el('span', 'kk-case__stand'));
      tile.append(case_);
      if (res === true) tile.append(el('span', 'kk-tile__res', '守った'));
      else if (res === false) tile.append(el('span', 'kk-tile__res', 'すり替え'));
      else tile.append(el('span', 'kk-tile__size', E.teamSize(n, r) + '人で見回り'));
      if (E.needFails(n, r) > 1 && res === undefined) tile.append(el('span', 'kk-tile__need', 'すり替え2枚で失敗'));
      return tile;
    }));

    // いまの段階
    const si = stepOf(phase);
    $('steps').hidden = si === undefined;
    if (si !== undefined) {
      $('steps').replaceChildren(...STEPS.map(([, label, icon], i) => {
        const li = el('li', 'kk-step' + (i < si ? ' is-done' : i === si ? ' is-now' : ''));
        li.append(msIcon(i < si ? 'check' : icon), el('span', '', label));
        if (i === si) li.setAttribute('aria-current', 'step');
        return li;
      }));
    }

    // メンバー選びの回数
    const showRejects = ['propose', 'vote', 'voteResult'].includes(phase);
    $('rejects').hidden = !showRejects;
    if (showRejects) {
      const dots = el('span', 'kk-rejects__dots');
      for (let i = 1; i <= E.PROPOSALS; i += 1) dots.append(el('span', 'kk-dot' + (i < g.proposal ? ' is-used' : i === g.proposal ? ' is-now' : '')));
      const last = g.proposal >= E.PROPOSALS;
      $('rejects').replaceChildren(el('span', 'kk-rejects__label', 'メンバー選び ' + g.proposal + '回目'), dots,
        el('span', 'kk-rejects__note', last ? (V.opts.fifthGo ? 'この回は投票なしで出発' : '反対が多いと怪盗チームの勝ち') : (V.opts.fifthGo ? '5回目は投票なしで出発' : '5回続けて反対が多いと怪盗チームの勝ち')));
    }

    // 大きな案内
    const banner = $('banner');
    const status = $('game-status');
    const setBanner = (kind, icon, title, sub, anim, delay) => {
      banner.className = 'kk-banner kk-banner--' + kind + (anim ? ' is-anim' : '');
      banner.style.setProperty('--d', (delay || 0) + 's');
      $('banner-icon').textContent = icon;
      status.textContent = title;
      $('game-sub').textContent = sub || '';
      $('game-sub').hidden = !sub;
    };
    const waitList = (ids) => (ids.length ? 'まだ：' + ids.map((id) => nameOf(V, id)).join('・') : '');

    const stage = $('stage');
    stage.replaceChildren();
    const leader = leaderOf(g);
    const size = E.teamSize(n, g.round);
    const meLeader = iPlay && leader === S.me;
    const hostForLeader = isHost && (awayOf(V, leader) || nodevOf(V, leader));
    if (S.cardGid === g.gid && S.proxyGid !== g.gid) { S.proxyGid = g.gid; S.proxyShow = {}; }
    if (g.talkEnd && (phase === 'propose' || phase === 'guess')) stage.append(timerEl(g.talkEnd));
    const tagFor = {};
    g.players.forEach((id) => { tagFor[id] = []; });

    switch (phase) {
      case 'reveal': {
        const waiting = g.players.filter((id) => !g.seen[id]);
        if (iPlay && sec) {
          const done = !!g.seen[S.me];
          setBanner(done ? 'wait' : 'mine', 'badge', done ? 'みんながたしかめるのを待っているよ' : 'あなたの役が届いたよ', done ? waitList(waiting) : 'まわりの人に見えないようにして、カードをめくってね');
          stage.append(flipRole(V, sec));
          const b = btn('btn btn-primary btn-full', done ? 'たしかめたよ' : 'たしかめた', 'check', () => act('seen'));
          b.disabled = done;
          b.hidden = !S.flipped && !done;
          stage.append(b);
        } else setBanner('wait', 'badge', 'みんなが自分の役をたしかめているよ', waitList(waiting));
        g.players.forEach((id) => { if (g.seen[id]) tagFor[id].push(['たしかめた', 'ok']); });
        break;
      }
      case 'propose': {
        if (meLeader || hostForLeader) {
          setBanner('mine', 'flag', meLeader ? 'あなたが主任！ 見回りに行く' + size + '人を選んでね' : '主任の代わりに、' + size + '人を選んでね',
            meLeader ? '自分も選べるよ。だれなら安心か、みんなの意見も聞いてみよう' : '主任の' + nameOf(V, leader) + (nodevOf(V, leader) ? 'に聞いて、代わりに押してね' : 'は通信が切れているよ'));
          stage.append(pickList(V, g.team, size, (id) => act('pick', { id })));
          const b = btn('btn btn-primary btn-full', g.team.length === size ? (g.proposal >= E.PROPOSALS && V.opts.fifthGo ? 'このメンバーで出発' : 'このメンバーで投票する') : 'あと' + (size - g.team.length) + '人選んでね', 'how_to_vote', () => act('propose'));
          b.disabled = g.team.length !== size;
          stage.append(b);
        } else {
          setBanner('wait', 'flag', '主任の' + nameOf(V, leader) + 'が、' + size + '人を選んでいるよ', 'だれを行かせたらいいか、声で話し合ってね');
          stage.append(teamLine(V, g.team, '選んでいるところ', null, size));
        }
        break;
      }
      case 'vote': {
        stage.append(teamLine(V, g.team, 'このメンバーで見回り？'));
        const mine = iPlay && g.voted.includes(S.me);
        const waiting = g.players.filter((id) => !g.voted.includes(id));
        if (iPlay && !mine) {
          setBanner('mine', 'how_to_vote', 'このメンバーで見回りに行っていい？', '投票はみんな同時に開くよ');
          const row = el('div', 'kk-choices');
          row.append(
            btn('kk-choice kk-choice--yes', '賛成', 'thumb_up', () => act('vote', { yes: true })),
            btn('kk-choice kk-choice--no', '反対', 'thumb_down', () => act('vote', { yes: false })),
          );
          stage.append(row);
        } else setBanner('wait', 'how_to_vote', mine ? '投票したよ。みんなを待っているよ' : 'みんなが投票しているよ', waitList(waiting));
        g.players.forEach((id) => { if (g.voted.includes(id)) tagFor[id].push(['投票した', 'ok']); });
        break;
      }
      case 'voteResult': {
        const lv = g.lastVote;
        const ids = Object.keys(lv.votes);
        const yes = ids.filter((id) => lv.votes[id]).length;
        const anim = firstTime('vote:' + g.gid + ':' + g.step);
        const lost = !lv.approved && g.proposal >= E.PROPOSALS;
        setBanner(lv.approved ? 'good' : 'warn', lv.approved ? 'directions_walk' : 'replay',
          lv.approved ? '見回りに出発！' : '反対が多かったので、選びなおし',
          '賛成 ' + yes + '・反対 ' + (ids.length - yes) + (lost ? '　5回続けて反対が多かったので、怪盗チームの勝ち' : ''), anim, g.players.length * 0.12 + 0.5);
        stage.append(teamLine(V, lv.team, '見回りに行くメンバー'));
        const votes = el('div', 'kk-votes' + (anim ? ' is-anim' : ''));
        g.players.forEach((id, i) => {
          const v = id in lv.votes ? (lv.votes[id] ? 'yes' : 'no') : 'none';
          const card = el('div', 'kk-vote kk-vote--' + v);
          card.style.setProperty('--i', i);
          card.append(avatar(V, id), el('span', 'kk-vote__name', nameOf(V, id)), msIcon(v === 'yes' ? 'thumb_up' : v === 'no' ? 'thumb_down' : 'remove'), el('span', 'kk-vote__v', v === 'yes' ? '賛成' : v === 'no' ? '反対' : '投票なし'));
          votes.append(card);
        });
        stage.append(votes);
        break;
      }
      case 'mission': {
        if (g.lastVote && g.lastVote.auto) stage.append(el('p', 'kk-note kk-note--center', '5回目なので、投票なしで出発したよ'));
        stage.append(teamLine(V, g.team, '見回りに行くメンバー'));
        const member = iPlay && g.team.includes(S.me);
        const done = member && g.submitted.includes(S.me);
        const waiting = g.team.filter((id) => !g.submitted.includes(id));
        if (member && !done && sec) {
          const thief = E.canSwap(sec.role);
          setBanner('mine', 'directions_walk', '見回り中。どちらかをこっそり出してね', thief ? '「異常なし」を出して、警備員のふりをすることもできるよ' : '警備員チームは「異常なし」しか出せないよ');
          const row = el('div', 'kk-choices');
          const safe = btn('kk-choice kk-choice--safe', '異常なし', 'verified_user', () => act('card', { card: 'safe' }));
          const swap = btn('kk-choice kk-choice--swap', 'すり替える', 'theater_comedy', () => act('card', { card: 'swap' }));
          swap.disabled = !thief;
          row.append(safe, swap);
          stage.append(row);
        } else {
          setBanner('wait', 'nightlight', done ? '出したよ。ほかのメンバーを待っているよ' : '見回り中…宝石は無事かな？', waitList(waiting));
          const night = el('div', 'kk-night');
          night.append(el('span', 'kk-night__beam'), el('span', 'kk-night__beam kk-night__beam--2'));
          night.append(gemSvg());
          stage.append(night);
        }
        g.players.forEach((id) => { if (g.submitted.includes(id)) tagFor[id].push(['出した', 'ok']); });
        break;
      }
      case 'missionResult': {
        const lm = g.lastMission;
        const anim = firstTime('mission:' + g.gid + ':' + g.step);
        const list = Array(lm.safe).fill('safe').concat(Array(lm.swaps).fill('swap'));
        let sub = '異常なし ' + lm.safe + '枚・すり替え ' + lm.swaps + '枚';
        if (lm.need > 1 && lm.swaps === 1) sub += '（この回はすり替えが2枚いるので、守れた）';
        setBanner(lm.ok ? 'good' : 'bad', lm.ok ? 'diamond' : 'theater_comedy', lm.ok ? '宝石を守った！' : '宝石がすり替えられた！', sub, anim, list.length * 0.7 + 0.6);
        stage.append(teamLine(V, lm.team, '見回りに行ったメンバー'));
        const cards = el('div', 'kk-cards' + (anim ? ' is-anim' : ''));
        list.forEach((c, i) => {
          const card = el('div', 'kk-card kk-card--' + c);
          card.style.setProperty('--i', i);
          const inner = el('div', 'kk-card__inner');
          const back = el('div', 'kk-card__face kk-card__face--back');
          back.append(msIcon('help'));
          const front = el('div', 'kk-card__face kk-card__face--front');
          front.append(msIcon(c === 'safe' ? 'verified_user' : 'theater_comedy'), el('span', '', c === 'safe' ? '異常なし' : 'すり替え'));
          inner.append(back, front);
          card.append(inner);
          cards.append(card);
        });
        stage.append(cards);
        break;
      }
      case 'guess': {
        const thieves = g.thieves || [];
        const amThief = iPlay && thieves.includes(S.me);
        const amBoss = iPlay && g.boss === S.me;
        const canDecide = amBoss || (amThief && awayOf(V, g.boss));
        setBanner('spot', 'search', '見やぶりタイム！', '警備員チームが3回守った。でも怪盗が名探偵を見やぶったら、怪盗チームの逆転勝ち', firstTime('guess:' + g.gid));
        stage.append(teamLine(V, thieves, '怪盗チームの正体', 'thief'));
        if (amThief) {
          stage.append(el('p', 'kk-note kk-note--center', '名探偵だと思う人を選んでね。' + (canDecide ? '仲間と相談して、決めたら下のボタン' : '最後に決めるのは、かしらの' + nameOf(V, g.boss))));
          const cands = g.players.filter((id) => !thieves.includes(id));
          stage.append(pickList(V, g.guessPick ? [g.guessPick] : [], 1, (id) => act('gpick', { id }), cands));
          if (canDecide) {
            const b = btn('btn btn-primary btn-full', g.guessPick ? nameOf(V, g.guessPick) + 'が名探偵だ！' : '名探偵だと思う人を選んでね', 'search', () => act('guess', { id: g.guessPick }));
            b.disabled = !g.guessPick;
            stage.append(b);
          }
        } else if (isHost && (nodevOf(V, g.boss) || (awayOf(V, g.boss) && !thieves.some((id) => id !== g.boss && !nodevOf(V, id) && !awayOf(V, id))))) {
          stage.append(el('p', 'kk-note kk-note--center', 'かしらの' + nameOf(V, g.boss) + (nodevOf(V, g.boss) ? 'は端末がないよ' : 'の通信が切れているよ') + '。怪盗たちの相談を聞いて、代わりに選んでね'));
          const cands = g.players.filter((id) => !thieves.includes(id));
          stage.append(pickList(V, g.guessPick ? [g.guessPick] : [], 1, (id) => act('gpick', { id }), cands));
          const b = btn('btn btn-primary btn-full', g.guessPick ? nameOf(V, g.guessPick) + 'が名探偵だ！' : '名探偵だと思う人を選んでね', 'search', () => act('guess', { id: g.guessPick }));
          b.disabled = !g.guessPick;
          stage.append(b);
        } else {
          stage.append(el('p', 'kk-note kk-note--center', '怪盗たちが相談しているよ。かしらは' + nameOf(V, g.boss) + '。' + (g.guessPick ? 'いま選ばれているのは ' + nameOf(V, g.guessPick) : '') + (iPlay ? '　名探偵は、ばれないようにね' : '')));
        }
        thieves.forEach((id) => tagFor[id].push([id === g.boss ? '怪盗のかしら' : '怪盗', 'thief']));
        if (g.guessPick) tagFor[g.guessPick].push(['名探偵？', 'warn']);
        break;
      }
      case 'lens': {
        const holder = g.lensHolder;
        const mine = iPlay && holder === S.me;
        const forHolder = isHost && (awayOf(V, holder) || nodevOf(V, holder));
        const targets = E.lensTargets(g.players, g.lensUsed);
        if (mine || forHolder) {
          setBanner('mine', 'search', mine ? 'しらべのルーペで、1人のチームをこっそり確かめよう' : nameOf(V, holder) + 'の代わりに、確かめる人を選んでね',
            mine ? '結果はあなたにだけ出るよ。確かめた人にルーペが渡る' : (nodevOf(V, holder) ? '本人に聞いて選んでね。結果は個別メッセージで伝えてね' : nameOf(V, holder) + 'は通信が切れているよ'), firstTime('lens:' + g.gid + ':' + g.step));
          stage.append(pickList(V, g.lensPick ? [g.lensPick] : [], 1, (id) => act('lpick', { id }), targets));
          const b = btn('btn btn-primary btn-full', g.lensPick ? nameOf(V, g.lensPick) + 'を確かめる' : '確かめる人を選んでね', 'search', () => act('lens'));
          b.disabled = !g.lensPick;
          stage.append(b);
        } else {
          setBanner('spot', 'search', nameOf(V, holder) + 'が、しらべのルーペでだれかを確かめるよ', g.lensPick ? 'いま選ばれているのは ' + nameOf(V, g.lensPick) : '一度ルーペを持った人は、確かめられないよ', firstTime('lens:' + g.gid + ':' + g.step));
        }
        g.lensUsed.forEach((id) => { if (id !== holder) tagFor[id].push(['ルーペ済み', 'muted']); });
        if (g.lensPick) tagFor[g.lensPick].push(['確かめる？', 'warn']);
        break;
      }
      case 'lensResult': {
        const last = g.lensLog[g.lensLog.length - 1];
        const anim = firstTime('lensres:' + g.gid + ':' + g.step);
        setBanner('spot', 'search', nameOf(V, last.from) + 'が、' + nameOf(V, last.to) + 'を確かめた', 'ルーペは ' + nameOf(V, last.to) + ' に渡ったよ。結果を言うかどうか（本当のことを言うか）は、' + nameOf(V, last.from) + 'しだい', anim);
        let seen = null;
        if (iPlay && S.me === last.from && sec) seen = sec;
        else if (isHost && nodevOf(V, last.from)) seen = secretOf(S.raw, last.from);
        const hit = seen && (seen.lens || []).find((x) => x.round === last.round && x.id === last.to);
        if (hit) {
          const box = el('div', 'kk-lensres kk-lensres--' + hit.side + (anim ? ' is-anim' : ''));
          box.append(msIcon(hit.side === 'guard' ? 'local_police' : 'theater_comedy'), el('p', 'kk-lensres__text', nameOf(V, hit.id) + 'は ' + (hit.side === 'guard' ? '警備員チーム' : '怪盗チーム')));
          stage.append(box);
          stage.append(el('p', 'kk-note kk-note--center', S.me === last.from ? 'この結果は、あなたにだけ出ているよ。「自分の役を見る」でもう一度見られる' : '端末のない' + nameOf(V, last.from) + 'に、個別メッセージで伝えてね'));
        } else stage.append(el('p', 'kk-note kk-note--center', '結果は ' + nameOf(V, last.from) + ' にだけ出ているよ'));
        break;
      }
      case 'end': {
        const win = g.winner === 'guard';
        const head = {
          missions: win ? '警備員チームの勝ち！' : '怪盗チームの勝ち！',
          guess: '怪盗チームの逆転勝ち！',
          guessMiss: '警備員チームの勝ち！',
          rejects: '怪盗チームの勝ち！',
        }[g.how];
        const sub = {
          missions: win ? '宝石を守りきった' : '宝石を3回すり替えた',
          guess: '名探偵を見やぶった',
          guessMiss: '名探偵は見やぶられなかった',
          rejects: 'メンバーが決まらなかった',
        }[g.how];
        const anim = firstTime('end:' + g.gid);
        setBanner(win ? 'win-guard' : 'win-thief', win ? 'local_police' : 'theater_comedy', head, sub + (g.guess ? '（怪盗が選んだのは ' + nameOf(V, g.guess) + '・' + E.ROLES[g.roles[g.guess]].name + '）' : ''), anim);
        if (anim) {
          const burst = el('div', 'kk-burst kk-burst--' + (win ? 'guard' : 'thief'));
          for (let i = 0; i < 14; i += 1) { const s = msIcon(win ? 'diamond' : 'star', 'kk-burst__p'); s.style.setProperty('--i', i); burst.append(s); }
          stage.append(burst);
        }
        stage.append(rolesTable(V));
        break;
      }
      default:
    }

    // 遊んでいる人（主任・メンバー・札）
    const inTeam = (id) => g.team.includes(id) && ['propose', 'vote', 'mission'].includes(phase);
    $('players').hidden = phase === 'end';
    $('players').replaceChildren(...g.players.map((id) => {
      const li = el('li', 'kk-player' + (inTeam(id) ? ' is-team' : '') + (awayOf(V, id) ? ' is-away' : '') + (id === S.me && !watch ? ' is-me' : '') + (id === leader && !['guess', 'end'].includes(phase) ? ' is-leader' : ''));
      li.append(avatar(V, id));
      const who = el('span', 'kk-player__who');
      who.append(el('span', 'kk-player__name', nameOf(V, id) + (id === S.me && !watch ? '（あなた）' : '')));
      const tags = el('span', 'kk-player__tags');
      if (id === leader && !['guess', 'end'].includes(phase)) tags.append(tagEl('主任', 'leader', 'flag'));
      if (inTeam(id)) tags.append(tagEl('メンバー', 'team', 'directions_walk'));
      if (id === g.lensHolder && phase !== 'end') tags.append(tagEl('ルーペ', 'lens', 'search'));
      if (nodevOf(V, id) && isHost) tags.append(tagEl('端末なし', 'muted'));
      tagFor[id].forEach(([t, k]) => tags.append(tagEl(t, k)));
      if (awayOf(V, id)) tags.append(tagEl('通信が切れた', 'warn'));
      who.append(tags);
      li.append(who);
      return li;
    }));

    // 自分の役（見るときだけ出す）
    const cardBox = $('mycard-box');
    cardBox.hidden = !(iPlay && sec) || phase === 'reveal' || phase === 'end';
    if (!cardBox.hidden) {
      $('mycard-label').textContent = S.showCard ? '自分の役をかくす' : '自分の役を見る';
      $('mycard-icon').textContent = S.showCard ? 'visibility_off' : 'visibility';
      $('mycard').hidden = !S.showCard;
      if (S.showCard) $('mycard').replaceChildren(roleCard(V, sec));
    }

    // ホストの操作
    const tools = $('tools');
    tools.replaceChildren();
    if (isHost) {
      if (phase === 'reveal') {
        const waiting = g.players.filter((id) => !g.seen[id]);
        tools.append(btn('btn btn-primary btn-full', '見回りをはじめる', 'play_arrow', () => {
          if (waiting.length && !window.confirm('まだたしかめていない人がいるよ（' + waiting.map((id) => nameOf(V, id)).join('・') + '）。はじめる？')) return;
          hostAct('begin', g.step);
        }));
      } else if (phase === 'lensResult') {
        tools.append(btn('btn btn-primary btn-full', '次の見回りへ', 'arrow_forward', () => hostAct('next', g.step)));
      } else if (phase === 'voteResult' || phase === 'missionResult') {
        let label = '次へ';
        if (phase === 'voteResult') label = g.lastVote.approved ? '見回りに出発' : (g.proposal >= E.PROPOSALS ? '結果を見る' : '次の主任へ');
        else {
          const w = E.score(g.results.concat(g.lastMission.ok));
          label = !w ? (g.lensHolder && E.lensAfter(g.round) ? 'しらべのルーペへ' : '次の見回りへ') : (w === 'guard' && g.hasDetective ? '見やぶりタイムへ' : '結果を見る');
        }
        tools.append(btn('btn btn-primary btn-full', label, 'arrow_forward', () => hostAct('next', g.step)));
      } else if (phase === 'vote') {
        const missing = g.players.filter((id) => !g.voted.includes(id));
        if (missing.length && missing.every((id) => awayOf(V, id))) {
          tools.append(btn('btn btn-secondary btn-full', '通信が切れた人を待たずに開く', 'how_to_vote', () => hostAct('openVotes', g.step)));
        }
      } else if (phase === 'mission') {
        if (g.team.some((id) => awayOf(V, id) && !g.submitted.includes(id))) {
          tools.append(btn('btn btn-secondary btn-full', 'この見回りをやめて、メンバーを選びなおす', 'replay', () => {
            if (window.confirm('見回りに行った人の通信が切れているよ。この見回りをやめて、同じ主任がメンバーを選びなおす？')) hostAct('redoMission', g.step);
          }));
        }
      } else if (phase === 'end') {
        tools.append(
          btn('btn btn-primary btn-full', 'もう一回（役を配りなおす）', 'replay', () => hostAct('start')),
          btn('btn btn-secondary btn-full', '待合室にもどる', 'meeting_room', () => hostAct('relobby', g.gid)),
        );
      }
      if (phase !== 'end') {
        tools.append(btn('kk-quiet', 'このゲームをやめて待合室にもどる', 'logout', () => {
          if (window.confirm('このゲームをやめて、待合室にもどる？')) hostAct('relobby', g.gid);
        }));
      }
      const px = proxyPanel(V);
      if (px) tools.prepend(px);
    } else if (!watch && ['voteResult', 'missionResult', 'lensResult'].includes(phase)) {
      tools.append(el('p', 'kk-wait', 'ホストが次へ進めるのを待っているよ'));
    }
    tools.hidden = !tools.childNodes.length;
  }

  // 端末のない人の代わりに押す欄（ホストだけ）。役もここで見て、チャットで伝える
  function proxyPanel(V) {
    const g = V.game;
    const ids = g.players.filter((id) => nodevOf(V, id));
    if (!ids.length || V.phase === 'end') return null;
    const box = el('div', 'kk-proxy');
    const head = el('p', 'kk-proxy__head');
    head.append(msIcon('support_agent'), el('span', '', '端末のない人の代わりに押す'));
    box.append(head);
    ids.forEach((id) => {
      const sec = secretOf(S.raw, id);
      const row = el('div', 'kk-proxy__row');
      const who = el('div', 'kk-proxy__who');
      who.append(avatar(V, id), el('span', '', nameOf(V, id)));
      row.append(who);
      const acts = el('div', 'kk-proxy__acts');
      const as = { as: id };
      if (V.phase === 'reveal' && !g.seen[id]) acts.append(btn('btn btn-primary btn-sm', '役を伝えた', 'check', () => act('seen', as)));
      if (V.phase === 'vote' && !g.voted.includes(id)) {
        acts.append(btn('btn btn-secondary btn-sm', '賛成', 'thumb_up', () => act('vote', Object.assign({ yes: true }, as))),
          btn('btn btn-secondary btn-sm', '反対', 'thumb_down', () => act('vote', Object.assign({ yes: false }, as))));
      }
      if (V.phase === 'mission' && g.team.includes(id) && !g.submitted.includes(id)) {
        const swap = btn('btn btn-secondary btn-sm', 'すり替える', 'theater_comedy', () => act('card', Object.assign({ card: 'swap' }, as)));
        swap.disabled = !E.canSwap(sec.role);
        acts.append(btn('btn btn-secondary btn-sm', '異常なし', 'verified_user', () => act('card', Object.assign({ card: 'safe' }, as))), swap);
      }
      const open = !!S.proxyShow[id];
      acts.append(btn('kk-quiet', open ? '役をかくす' : '役を見る', open ? 'visibility_off' : 'visibility', () => { S.proxyShow[id] = !open; render(); }));
      acts.append(btn('kk-quiet', 'チャット用にコピー', 'content_copy', (e) => RoomkRTDB.copyText(secretText(V, id, sec), e.currentTarget, 'チャット用の文をコピーしました', 'コピーできませんでした')));
      row.append(acts);
      if (open) { const c = el('div', 'kk-proxy__card'); c.append(roleCard(V, sec)); row.append(c); }
      box.append(row);
    });
    return box;
  }

  // チャットの個別メッセージで送る文（絵文字は入れない）
  function secretText(V, id, sec) {
    const r = E.ROLES[sec.role];
    const lines = [nameOf(V, id) + 'さんの役は「' + r.name + '」（' + (r.side === 'guard' ? '警備員チーム' : '怪盗チーム') + '）です。', ROLE_TEXT[sec.role]];
    if (sec.boss) lines.push('あなたは怪盗のかしら。最後に名探偵を見やぶるのはあなたです。');
    if (sec.bossName) lines.push('怪盗のかしら: ' + nameOf(V, sec.bossName) + '（最後に名探偵を見やぶるのは、かしら）');
    (sec.knows || []).forEach((k) => {
      const names = k.ids.map((x) => nameOf(V, x)).join('・');
      if (k.kind === 'thieves') lines.push('怪盗はこの人たち: ' + (names || 'いない'));
      else if (k.kind === 'detective') lines.push((k.ids.length > 1 ? '名探偵はこのどちらか: ' : '名探偵はこの人: ') + names);
      else if (k.kind === 'mates') lines.push(k.ids.length ? '仲間の怪盗: ' + names : '仲間の怪盗はここには出ません');
    });
    (sec.lens || []).forEach((x) => lines.push('ルーペで確かめた結果: ' + nameOf(V, x.id) + 'は' + (x.side === 'guard' ? '警備員チーム' : '怪盗チーム')));
    return lines.join('\n');
  }

  function tagEl(text, kind, icon) {
    const t = el('span', 'kk-tag kk-tag--' + kind);
    if (icon) t.append(msIcon(icon));
    t.append(el('span', '', text));
    return t;
  }

  // メンバーの並び（size があれば、空いている席も点線で出す）
  function teamLine(V, ids, label, kind, size) {
    const box = el('div', 'kk-teamline' + (kind ? ' kk-teamline--' + kind : ''));
    box.append(el('span', 'kk-teamline__label', label));
    const names = el('span', 'kk-teamline__names');
    ids.forEach((id) => {
      const chip = el('span', 'kk-teamline__name');
      chip.append(avatar(V, id), el('span', '', nameOf(V, id)));
      names.append(chip);
    });
    for (let i = ids.length; i < (size || 0); i += 1) names.append(el('span', 'kk-teamline__name is-empty', '？'));
    box.append(names);
    return box;
  }

  // 人を選ぶ（主任のメンバー選び・怪盗の見やぶり）
  function pickList(V, chosen, max, onPick, only) {
    const g = V.game;
    const ids = only || g.players;
    const box = el('div', 'kk-pick');
    ids.forEach((id) => {
      const on = chosen.includes(id);
      const b = el('button', 'kk-pick__btn' + (on ? ' is-on' : ''));
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.append(avatar(V, id), el('span', 'kk-pick__name', nameOf(V, id) + (id === S.me ? '（自分）' : '')), msIcon(on ? 'check_circle' : 'add_circle', 'kk-pick__mark'));
      b.disabled = !on && chosen.length >= max && max > 1;
      b.addEventListener('click', () => onPick(id));
      box.append(b);
    });
    return box;
  }

  // 配ったときの役: 伏せたカードをめくって見る
  function flipRole(V, sec) {
    const wrap = el('div', 'kk-flip' + (S.flipped ? ' is-open' : ''));
    const back = el('button', 'kk-flip__back');
    back.type = 'button';
    back.setAttribute('aria-label', 'カードをめくって、自分の役を見る');
    back.append(msIcon('local_police', 'kk-flip__seal'), el('span', 'kk-flip__title', 'あなたの役'), el('span', 'kk-flip__hint', 'タップしてめくる'));
    back.addEventListener('click', () => { S.flipped = true; wrap.classList.add('is-open'); render(); });
    const front = el('div', 'kk-flip__front');
    front.append(roleCard(V, sec));
    if (S.flipped) {
      const hide = btn('kk-quiet kk-flip__hide', 'カードをふせる', 'visibility_off', () => { S.flipped = false; render(); });
      front.append(hide);
    }
    wrap.append(back, front);
    return wrap;
  }

  function roleCard(V, sec) {
    const r = E.ROLES[sec.role];
    const card = el('div', 'kk-role kk-role--' + r.side);
    const head = el('div', 'kk-role__head');
    const badge = el('span', 'kk-role__badge');
    badge.append(msIcon(r.icon));
    const ttl = el('div', 'kk-role__ttl');
    ttl.append(el('p', 'kk-role__side', r.side === 'guard' ? '警備員チーム' : '怪盗チーム'));
    const title = el('p', 'kk-role__name');
    title.append(el('span', '', 'あなたは ' + r.name));
    ttl.append(title);
    head.append(badge, ttl);
    card.append(head);
    card.append(el('p', 'kk-role__text', ROLE_TEXT[sec.role]));
    if (sec.boss) card.append(el('p', 'kk-role__text kk-role__boss', 'あなたは怪盗のかしら。警備員チームが3回守ったら、最後に名探偵を見やぶるのはあなた。'));
    (sec.knows || []).forEach((k) => {
      let label = '';
      if (k.kind === 'thieves') label = '怪盗はこの人たち' + (V.opts.disguise ? '（変装名人はここに出ない）' : '');
      else if (k.kind === 'detective') label = k.ids.length > 1 ? '名探偵はこのどちらか（どちらかは、にせ探偵）' : '名探偵はこの人';
      else if (k.kind === 'mates') label = k.ids.length ? '仲間の怪盗' + (V.opts.lone ? '（ひとり怪盗はここに出ない）' : '') : '仲間の怪盗はここには出ない';
      const box = el('div', 'kk-role__knows');
      box.append(el('p', 'kk-role__knows-label', label));
      if (k.ids.length) {
        const names = el('p', 'kk-role__knows-names');
        k.ids.forEach((id) => { const c = el('span', 'kk-role__knows-name'); c.append(avatar(V, id), el('span', '', nameOf(V, id))); names.append(c); });
        box.append(names);
      }
      card.append(box);
    });
    if (sec.lens && sec.lens.length) {
      const box = el('div', 'kk-role__knows');
      box.append(el('p', 'kk-role__knows-label', 'しらべのルーペで確かめた'));
      const names = el('p', 'kk-role__knows-names');
      sec.lens.forEach((x) => { const c = el('span', 'kk-role__knows-name'); c.append(avatar(V, x.id), el('span', '', nameOf(V, x.id) + '：' + (x.side === 'guard' ? '警備員' : '怪盗'))); names.append(c); });
      box.append(names);
      card.append(box);
    }
    if (sec.role !== 'lone' && E.sideOf(sec.role) === 'thief' && V.game.hasDetective && !sec.boss) {
      card.append(el('p', 'kk-role__text kk-role__sub', '最後の見やぶりは、かしら' + (sec.bossName ? 'の' + nameOf(V, sec.bossName) : '') + 'が決める（相談はできる）。'));
    }
    return card;
  }

  function rolesTable(V) {
    const g = V.game;
    const box = el('div', 'kk-roles');
    const winSide = g.winner;
    ['guard', 'thief'].forEach((side) => {
      const col = el('div', 'kk-roles__col kk-roles__col--' + side + (winSide === side ? ' is-win' : ''));
      const head = el('p', 'kk-roles__head');
      head.append(msIcon(side === 'guard' ? 'local_police' : 'theater_comedy'), el('span', '', side === 'guard' ? '警備員チーム' : '怪盗チーム'));
      if (winSide === side) head.append(el('span', 'kk-roles__win', '勝ち'));
      col.append(head);
      const ul = el('ul', 'kk-roles__list');
      g.players.filter((id) => E.sideOf(g.roles[id]) === side).forEach((id) => {
        const li = el('li', 'kk-roles__item');
        li.append(avatar(V, id), el('span', 'kk-roles__name', nameOf(V, id)), el('span', 'kk-roles__role', E.ROLES[g.roles[id]].name + (id === g.boss ? '・かしら' : '')));
        ul.append(li);
      });
      col.append(ul);
      box.append(col);
    });
    return box;
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
    $('btn-start').addEventListener('click', () => hostAct('start'));
    $('btn-mycard').addEventListener('click', () => { S.showCard = !S.showCard; render(); });
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
