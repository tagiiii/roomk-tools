/* しるしでヒント（試作）
   同じブラウザでひらいたウィンドウの間を BroadcastChannel でつなぐモック。
   ゲームの状態はホストのウィンドウのメモリにだけ置く。
   お題とだれが何を選んだかはほかのウィンドウにも届くが、画面には出さない（性善説。本体の RTDB でも同じ扱いの想定）。 */
(() => {
  'use strict';

  const DATA = window.SHIRUSHI_DATA;
  const CHANNEL = 'roomk-shirushi-hint-draft';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const KEY_ID = 'shirushi-hint-id';
  const KEY_SESSION = 'shirushi-hint-session';

  const NAME_MAX = 10;
  const CANDS = 3;           // 伝える人が選ぶお題の候補の数
  const BOARD = 12;          // 当てる人に並べる候補の数（お題をふくむ）
  const SAME_KIND = 6;       // そのうち、お題と同じなかまを入れる数（お題をふくむ。なかまが少なければあるだけ）
  const MAX_SIGNS = 6;       // 1問で出せるしるしの数
  // しるし何個目で当てたかの点（当てた人と、伝えた人の両方に入る）
  const POINTS = [3, 2, 1, 1, 1, 1];
  const ptsAt = (n) => POINTS[Math.min(n, POINTS.length) - 1] || 0;
  const MISS = 1;            // はずれたら減る点（「このしるしでは選ばない」は減らない）。持ち点はマイナスになってもよい
  const fmtPts = (n) => (n < 0 ? '−' + (-n) : String(n)) + '点';
  const fmtDelta = (n) => (n > 0 ? '+' : '') + fmtPts(n);
  const POP_MS = 2600;       // しるしごとの結果を出しておく時間
  const PING_MS = 4000;
  const AWAY_MS = 13000;
  const HOST_SILENT_MS = 15000;
  const JOIN_WAIT_MS = 1500;
  const KEYS = 'ABCDEFGHIJKL'; // 候補の記号（声やチャットで「C」のように言えるように）
  const NUMS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

  // お題の番号 → なかま
  const KIND_OF = DATA.topics.map((w) => Object.keys(DATA.kinds).find((k) => DATA.kinds[k].includes(w)) || null);
  const ICONS = {};
  DATA.groups.forEach((g) => g.icons.forEach((ic) => { ICONS[ic.id] = ic; }));

  const $ = (id) => document.getElementById(id);
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const randomCode = (n) => Array.from({ length: n }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  const ssGet = (k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return null; } };
  const ssSet = (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* noop */ } };
  const ssDel = (k) => { try { sessionStorage.removeItem(k); } catch { /* noop */ } };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const msIcon = (name, cls) => { const s = el('span', 'material-symbols-rounded' + (cls ? ' ' + cls : ''), name); s.setAttribute('aria-hidden', 'true'); return s; };

  const S = {
    role: null,       // 'host' | 'guest' | 'watch'
    me: null,
    name: '',
    code: null,
    room: null,       // ホストだけが持つ、ゲームの状態の本物
    view: null,       // 画面に出している状態（ホストは room と同じもの）
    joined: false,
    closed: false,
    lastHostMsg: 0,
    sel: null,        // 伝える人が、次に出そうと選んでいるしるし
    selQ: null,
    pop: { uid: null, n: 0 },
    popTimer: null,
  };
  let bc = null;

  // ══════════════════════════════════════════════
  // つなぐ（BroadcastChannel）
  // ══════════════════════════════════════════════
  function startChannel() {
    if (bc) return;
    bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (e) => onWire(e.data);
  }
  function wire(type, body) {
    if (!bc) return;
    bc.postMessage(Object.assign({ type, code: S.code, from: S.me }, body));
  }
  function onWire(m) {
    if (!m || m.code !== S.code || m.from === S.me) return;
    if (S.role === 'host') onHostMsg(m);
    else onGuestMsg(m);
  }
  // 自分の操作。ホストはその場で、参加する人はホストへ送る
  function act(type, body) {
    if (S.role === 'host') onHostMsg(Object.assign({ type, from: S.me }, body));
    else if (S.role === 'guest') wire(type, body);
  }
  // 問の中の操作には、いまの問の番号をつける（古い操作で次の問が変わらないように）
  // メンターが端末のない子の代わりに伝えるときは、その子として送る（as）
  const TELLER_ACTS = ['choose', 'reroll', 'pass', 'sign', 'show'];
  const qAct = (type, body) => {
    const q = S.view && S.view.q;
    const extra = { q: q ? q.uid : null };
    if (isHost() && q && TELLER_ACTS.includes(type) && isProxyId(q.teller)) extra.as = q.teller;
    act(type, Object.assign(extra, body));
  };

  // ── ホスト ──
  function publish() {
    S.view = S.room;
    wire('state', { room: S.room });
    render();
  }

  // 遊ぶ人（ホストは「自分もプレイヤーとして参加する」のときだけ）
  const isPlayer = (R, id) => id !== R.hostId || R.hostPlays;
  const players = (R) => R.players.filter((p) => isPlayer(R, p.id));
  // いまの問で当てる人（伝える人・通信が切れた人・遊ばないホストをのぞく）
  const guessers = (R) => (R.q ? players(R).filter((p) => !p.away && p.id !== R.q.teller).map((p) => p.id) : []);

  function onHostMsg(m) {
    const R = S.room;
    if (!R) return;
    if (m.type === 'peek') { wire('state', { room: R }); return; } // みんなにみせる画面
    // メンターが端末のない子の代わりにした操作は、その子の操作として受ける
    if (m.as) {
      const px = R.players.find((x) => x.id === m.as && x.proxy);
      if (m.from !== R.hostId || !px) return;
      m = Object.assign({}, m, { from: m.as });
    }
    const now = Date.now();
    let p = R.players.find((x) => x.id === m.from);
    if (m.type === 'hello') {
      const name = clean(m.name, NAME_MAX) || 'なまえなし';
      if (p) { p.name = name; p.away = false; p.seen = now; } else {
        R.players.push({ id: m.from, name, seen: now });
        // 遊んでいる途中に入った人は、順番の最後に入る。次のしるしから当てられる
        if (R.phase !== 'lobby' && R.phase !== 'end' && !R.order.includes(m.from)) R.order.push(m.from);
      }
      if (!(m.from in R.scores)) R.scores[m.from] = 0;
      maybeJudge(R);
      publish();
      return;
    }
    if (!p) { wire('who', { to: m.from }); return; }
    const wasAway = p.away;
    p.seen = now;
    p.away = false;
    if (m.type === 'ping') { if (wasAway) publish(); return; }
    if (m.type === 'leave') {
      if (R.phase === 'lobby' && m.from !== R.hostId) R.players = R.players.filter((x) => x.id !== m.from);
      else p.away = true;
      maybeJudge(R); // 切れた人を待たない
      publish();
      return;
    }

    const q = R.q;
    if (!q || m.q !== q.uid) { if (wasAway) publish(); return; }
    const teller = m.from === q.teller;
    switch (m.type) {
      // ── 伝える人 ──
      case 'choose':
        if (!teller || R.phase !== 'pick' || !q.cands.includes(m.t)) break;
        q.topic = m.t;
        q.board = boardFor(m.t);
        R.used.push(m.t);
        R.phase = 'hint';
        break;
      case 'reroll':
        if (teller && R.phase === 'pick') q.cands = candidatesFor(R, q.cands);
        break;
      case 'pass':
        if (teller && R.phase === 'pick') advance(R);
        break;
      case 'sign':
        // 前のしるしの答え合わせがまだなら、ここで締める
        if (!teller || R.phase !== 'hint' || !ICONS[m.id] || q.signs.includes(m.id) || q.signs.length >= MAX_SIGNS) break;
        if (q.signs.length > q.judged) judge(R);
        if (R.phase !== 'hint') break;
        q.signs.push(m.id);
        q.picks = {};
        break;
      case 'show':
        if (!teller || R.phase !== 'hint') break;
        if (q.signs.length > q.judged) judge(R);
        R.phase = 'reveal';
        break;
      // ── 当てる人 ──
      case 'guess': {
        if (R.phase !== 'hint' || !guessers(R).includes(m.from) || m.step !== q.signs.length || q.signs.length <= q.judged) break;
        if (q.solved[m.from] || m.from in q.picks) break;
        const b = m.b;
        if (b !== -1 && !(Number.isInteger(b) && b >= 0 && b < q.board.length && !q.crossed.includes(b))) break;
        q.picks[m.from] = b;
        maybeJudge(R);
        break;
      }
      default:
        break;
    }
    publish();
  }

  // まだ当てていない人が全員選んだら、答え合わせ
  function maybeJudge(R) {
    const q = R.q;
    if (!q || R.phase !== 'hint' || q.signs.length <= q.judged) return;
    const waiting = guessers(R).filter((id) => !q.solved[id]);
    if (waiting.length && waiting.every((id) => id in q.picks)) judge(R);
  }
  // いまのしるしの答え合わせ。当たった人に点、はずれた候補は消す
  function judge(R) {
    const q = R.q;
    const n = q.signs.length;
    const answer = q.board.indexOf(q.topic);
    const hit = [];
    const missed = [];
    Object.keys(q.picks).forEach((id) => {
      const b = q.picks[id];
      if (b === answer) { hit.push(id); q.solved[id] = n; }
      else if (b >= 0) {
        missed.push(id);
        q.misses[id] = (q.misses[id] || 0) + 1;
        R.scores[id] = (R.scores[id] || 0) - MISS;
        if (!q.crossed.includes(b)) q.crossed.push(b);
      }
    });
    const pts = ptsAt(n);
    hit.forEach((id) => { R.scores[id] = (R.scores[id] || 0) + pts; });
    // 伝えた人は、最初に当たったしるしの点を1回だけもらう
    if (hit.length && !q.tellerPts) {
      q.tellerPts = pts;
      if (isPlayer(R, q.teller)) R.scores[q.teller] = (R.scores[q.teller] || 0) + pts;
    }
    q.judged = n;
    q.last = { n, hit, missed };
    q.picks = {};
    const left = guessers(R).filter((id) => !q.solved[id]);
    if (!left.length || n >= MAX_SIGNS) R.phase = 'reveal';
  }

  // 当てる人に並べる候補。お題と同じなかまを SAME_KIND 個までそろえ、残りはほかのなかまから選ぶ
  // （1つ目のしるしでなかまを出しても、まだ見分けがつかないように）
  function boardFor(t) {
    const others = DATA.topics.map((_, i) => i).filter((i) => i !== t);
    const same = shuffle(others.filter((i) => KIND_OF[i] && KIND_OF[i] === KIND_OF[t])).slice(0, SAME_KIND - 1);
    const rest = shuffle(others.filter((i) => !same.includes(i) && KIND_OF[i] !== KIND_OF[t])).slice(0, BOARD - 1 - same.length);
    return shuffle([t].concat(same, rest));
  }
  // お題の候補の3つ。まだ出していないお題を先に出す。「ほかの候補」では、いま出ている候補を避ける
  function candidatesFor(R, avoid) {
    const all = DATA.topics.map((_, i) => i).filter((i) => !(avoid || []).includes(i));
    const fresh = shuffle(all.filter((i) => !R.used.includes(i)));
    const again = shuffle(all.filter((i) => R.used.includes(i)));
    return fresh.concat(again).slice(0, CANDS);
  }
  function newQuestion(R, teller) {
    R.q = { uid: randomCode(8), teller, cands: candidatesFor(R), topic: null, board: [], signs: [], judged: 0, picks: {}, crossed: [], solved: {}, misses: {}, tellerPts: 0, last: null };
    R.phase = 'pick';
  }
  // 順番の次の人へ。通信が切れている人はとばす。最後までいったら「一巡した」
  function advance(R) {
    for (let i = R.turn + 1; i < R.order.length; i += 1) {
      const p = R.players.find((x) => x.id === R.order[i]);
      if (p && !p.away && isPlayer(R, p.id)) { R.turn = i; newQuestion(R, R.order[i]); return; }
    }
    R.turn = R.order.length;
    R.q = null;
    R.phase = 'lap';
  }
  const activeIds = (R) => players(R).filter((p) => !p.away).map((p) => p.id);

  const host = {
    setHostPlays(on) {
      const R = S.room;
      if (R.phase !== 'lobby') return;
      R.hostPlays = !!on && !R.players.some((p) => p.proxy);
      publish();
    },
    // 端末のない子。メンターがその子のお題や選んだ候補を知るので、いる間はメンターは進行だけ
    addProxy(raw) {
      const R = S.room;
      if (R.phase !== 'lobby') return 'はじめる前だけ足せるよ';
      const name = clean(raw, NAME_MAX);
      if (!name) return '名前を入れてね';
      if (R.players.some((p) => p.name === name)) return '「' + name + '」はもういるよ';
      R.players.push({ id: 'px-' + randomCode(8), name, proxy: true, seen: Date.now() });
      R.hostPlays = false;
      publish();
      return '';
    },
    removeProxy(id) {
      const R = S.room;
      if (R.phase !== 'lobby') return;
      R.players = R.players.filter((p) => !(p.id === id && p.proxy));
      publish();
    },
    start() {
      const R = S.room;
      if (R.phase !== 'lobby') return;
      const order = activeIds(R); // 入った順（ホストが入るときはホストが最初）
      if (order.length < 2) return;
      const scores = {};
      R.players.forEach((p) => { scores[p.id] = 0; });
      Object.assign(R, { order, turn: -1, lap: 1, scores });
      advance(R);
      publish();
    },
    skip() {
      const R = S.room;
      if (R.phase !== 'pick' && R.phase !== 'hint') return;
      advance(R);
      publish();
    },
    next() {
      const R = S.room;
      if (R.phase !== 'reveal') return;
      advance(R);
      publish();
    },
    lap() {
      const R = S.room;
      if (R.phase !== 'lap') return;
      const order = activeIds(R);
      if (order.length < 2) return;
      Object.assign(R, { order, turn: -1, lap: R.lap + 1 });
      advance(R);
      publish();
    },
    finish() {
      const R = S.room;
      if (R.phase === 'lobby' || R.phase === 'end') return;
      R.q = null;
      R.phase = 'end';
      publish();
    },
    restart() {
      const R = S.room;
      if (R.phase !== 'end') return;
      Object.assign(R, { phase: 'lobby', order: [], turn: -1, lap: 0, q: null, scores: {} });
      publish();
    },
  };

  function hostTick() {
    const R = S.room;
    if (!R) return;
    const now = Date.now();
    let changed = false;
    R.players.forEach((p) => {
      if (p.id === R.hostId || p.proxy) return; // 端末のない子は切れない
      if (!p.away && now - (p.seen || 0) > AWAY_MS) { p.away = true; changed = true; }
    });
    if (changed) { maybeJudge(R); publish(); } else wire('state', { room: R }); // ホストがいることを知らせる
  }

  // ── 参加する人・みんなにみせる画面 ──
  function onGuestMsg(m) {
    if (m.type === 'state' && m.room) {
      S.lastHostMsg = Date.now();
      S.view = m.room;
      if (!S.joined) {
        S.joined = true;
        if (S.role === 'guest') ssSet(KEY_SESSION, { role: 'guest', code: S.code, name: S.name });
        showApp();
      }
      S.closed = false;
      render();
    } else if (m.type === 'who' && m.to === S.me && S.role === 'guest') {
      wire('hello', { name: S.name });
    } else if (m.type === 'closed') {
      S.closed = true;
      render();
    }
  }
  function guestTick() {
    if (!S.joined) return;
    if (S.role === 'guest') wire('ping');
    const silent = Date.now() - S.lastHostMsg > HOST_SILENT_MS;
    if (silent !== S.closed) { S.closed = silent; render(); }
  }

  // ══════════════════════════════════════════════
  // はじめの画面
  // ══════════════════════════════════════════════
  function boot() {
    let id = ssGet(KEY_ID);
    if (!id) { id = randomCode(10); ssSet(KEY_ID, id); }
    S.me = id;
    bindButtons();
    const ptsRow = (th, td) => { const tr = el('tr'); tr.append(el('th', '', th), el('td', '', td)); return tr; };
    $('pts-table').replaceChildren(
      ...POINTS.slice(0, 3).map((pt, i) => ptsRow(i === 2 ? NUMS[2] + 'つ目から' + NUMS[MAX_SIGNS - 1] + 'つ目まで' : NUMS[i] + 'つ目で当たり', fmtDelta(pt))),
      ptsRow('はずれ', fmtDelta(-MISS) + '（選ばなければ減らない）'),
    );

    const params = new URLSearchParams(location.search);
    const roomParam = (params.get('room') || '').toUpperCase();
    const watchParam = (params.get('watch') || '').toUpperCase();
    const saved = ssGet(KEY_SESSION);
    $('sh-front').hidden = false;

    if (CODE_RE.test(watchParam)) {
      S.role = 'watch';
      S.code = watchParam;
      S.me = 'watch-' + randomCode(8);
      $('sh-front').hidden = true;
      document.body.classList.add('is-watch');
      startChannel();
      wire('peek');
      setTimeout(() => {
        if (!S.joined) { $('sh-front').hidden = false; $('sh-front-form').hidden = true; frontMsg('ルームが見つからないよ。ホストのウィンドウがひらいているか確かめてね'); }
      }, JOIN_WAIT_MS);
    } else if (CODE_RE.test(roomParam)) {
      S.role = 'guest';
      S.code = roomParam;
      $('sh-front-go').textContent = '入る';
      $('sh-front-title').textContent = 'しるしでヒントに参加';
      if (saved && saved.role === 'guest' && saved.code === roomParam && saved.name) {
        $('sh-name').value = saved.name;
        join(saved.name);
      }
    } else if (saved && saved.role === 'host') {
      ssDel(KEY_SESSION); // ホストのウィンドウを読み込み直すと、ルームは閉じる
    }
    $('sh-front-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.isComposing) return;
      const name = clean($('sh-name').value, NAME_MAX);
      if (!name) { frontMsg('ニックネームを入れてね'); return; }
      if (S.role === 'guest') join(name); else openRoom(name);
    });
    setInterval(() => { if (S.role === 'host') hostTick(); else if (S.role) guestTick(); }, PING_MS);
    window.addEventListener('beforeunload', () => {
      if (S.role === 'host' && S.room) wire('closed');
      else if (S.role === 'guest' && S.joined) wire('leave');
    });
  }
  function frontMsg(text) {
    const m = $('sh-front-msg');
    m.textContent = text;
    m.hidden = !text;
  }

  function openRoom(name) {
    S.role = 'host';
    S.name = name;
    S.code = randomCode(6);
    S.room = {
      code: S.code, hostId: S.me, phase: 'lobby', hostPlays: true,
      players: [{ id: S.me, name, seen: Date.now() }],
      order: [], turn: -1, lap: 0, q: null, used: [], scores: {},
    };
    ssSet(KEY_SESSION, { role: 'host', code: S.code });
    startChannel();
    showApp();
    publish();
  }

  function join(name) {
    S.name = name;
    frontMsg('');
    startChannel();
    wire('hello', { name });
    setTimeout(() => {
      if (!S.joined) frontMsg('ルームが見つからないよ。ホストのウィンドウがひらいているか確かめてね');
    }, JOIN_WAIT_MS);
  }

  function showApp() {
    $('sh-front').hidden = true;
    $('sh-app').hidden = false;
  }

  // ══════════════════════════════════════════════
  // ボタン
  // ══════════════════════════════════════════════
  function bindButtons() {
    $('chk-host-plays').addEventListener('change', (e) => host.setHostPlays(e.target.checked));
    $('btn-start').addEventListener('click', () => host.start());
    $('proxy-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.isComposing) return;
      const err = host.addProxy($('proxy-name').value);
      $('proxy-msg').textContent = err;
      if (!err) $('proxy-name').value = '';
    });
    $('btn-copy').addEventListener('click', () => copyText(location.origin + location.pathname + '?room=' + S.code, $('btn-copy'), 'リンクをコピー'));
    $('btn-watch').addEventListener('click', () => { window.open(location.origin + location.pathname + '?watch=' + S.code, '_blank'); });
    $('btn-reroll').addEventListener('click', () => qAct('reroll'));
    $('btn-pass').addEventListener('click', () => qAct('pass'));
    $('btn-send').addEventListener('click', () => { if (S.sel) { qAct('sign', { id: S.sel }); S.sel = null; render(); } });
    $('btn-show').addEventListener('click', () => {
      if (window.confirm('答えを見せて、この問を終える？')) qAct('show');
    });
    $('btn-skip-guess').addEventListener('click', () => qAct('guess', { step: S.view.q.signs.length, b: -1 }));
    $('btn-next').addEventListener('click', () => host.next());
    $('btn-lap').addEventListener('click', () => host.next());
    $('btn-lap2').addEventListener('click', () => host.lap());
    $('btn-finish').addEventListener('click', () => host.finish());
    $('btn-finish2').addEventListener('click', () => host.finish());
    $('btn-restart').addEventListener('click', () => host.restart());
    $('btn-skip').addEventListener('click', () => {
      if (window.confirm('この問を終えて、次の人の番にする？（ここまでの点は残るよ）')) host.skip();
    });
    $('btn-end').addEventListener('click', () => {
      if (window.confirm('ここでおしまいにする？')) host.finish();
    });
  }

  function copyText(text, btn, label) {
    const done = (ok) => {
      btn.textContent = ok ? 'コピーしたよ' : 'コピーできなかったよ';
      setTimeout(() => { btn.textContent = label; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  }

  // ══════════════════════════════════════════════
  // 画面
  // ══════════════════════════════════════════════
  const PHASES = ['lobby', 'pick', 'hint', 'reveal', 'lap', 'end'];
  const isHost = () => S.role === 'host';
  const playerOf = (id) => S.view.players.find((x) => x.id === id);
  const playerName = (id) => { const p = playerOf(id); return p ? p.name : '（はなれた人）'; };
  const isProxyId = (id) => { const p = S.view && S.view.players.find((x) => x.id === id); return !!(p && p.proxy); };
  // 伝える操作をするのはこの画面か（メンターは、端末のない子の番に代わりに操作する）
  const isTeller = () => !!(S.view.q && S.role !== 'watch' && (S.view.q.teller === S.me || (isHost() && isProxyId(S.view.q.teller))));
  const forProxy = () => !!(S.view.q && isHost() && isProxyId(S.view.q.teller));
  const amGuesser = () => S.role === 'guest' || (isHost() && S.view.hostPlays);

  function render() {
    const V = S.view;
    if (!V) return;
    $('sh-closed').hidden = !S.closed;
    $('sh-bar-code').textContent = S.role === 'watch' ? '' : 'ルームコード ' + V.code;
    $('sh-bar-me').textContent = S.role === 'watch' ? 'みんなにみせる画面' : S.name + (isHost() ? '（ホスト）' : '');
    $('btn-watch').hidden = !isHost();
    PHASES.forEach((ph) => { $('ph-' + ph).hidden = V.phase !== ph; });
    const playing = ['pick', 'hint', 'reveal'].includes(V.phase);
    $('host-ctl').hidden = !(isHost() && (V.phase === 'pick' || V.phase === 'hint'));
    $('sh-order').hidden = !playing;
    if (playing) renderOrder(V);
    if (V.phase === 'lobby') renderLobby(V);
    else if (V.phase === 'pick') renderPick(V);
    else if (V.phase === 'hint') renderHint(V);
    else if (V.phase === 'reveal') renderReveal(V);
    else if (V.phase === 'lap') renderLap(V);
    else if (V.phase === 'end') renderEnd(V);
    checkPop(V);
  }

  function renderLobby(V) {
    const ul = $('lobby-players');
    ul.replaceChildren(...V.players.map((p) => {
      const li = el('li', 'sh-player' + (p.away ? ' is-away' : ''));
      li.append(msIcon(p.id === V.hostId ? 'star' : 'person'), el('span', '', p.name));
      if (p.id === V.hostId) li.append(el('span', 'sh-tag', V.hostPlays ? 'ホスト' : 'ホスト（進行だけ）'));
      if (p.proxy && isHost()) {
        li.append(el('span', 'sh-tag sh-tag--muted', '端末なし'));
        const del = el('button', 'btn btn-ghost btn-sm sh-player__del', '外す');
        del.type = 'button';
        del.addEventListener('click', () => host.removeProxy(p.id));
        li.append(del);
      }
      if (p.away) li.append(el('span', 'sh-tag sh-tag--muted', '通信が切れたみたい'));
      return li;
    }));
    $('lobby-host').hidden = !isHost();
    $('lobby-wait').hidden = isHost() || S.role === 'watch';
    if (isHost()) {
      $('chk-host-plays').checked = V.hostPlays;
      const hasProxy = V.players.some((p) => p.proxy);
      $('chk-host-plays').disabled = hasProxy;
      $('host-plays-note').hidden = !hasProxy;
      const n = V.players.filter((p) => !p.away && (p.id !== V.hostId || V.hostPlays)).length;
      $('btn-start').disabled = n < 2;
      $('lobby-start-note').textContent = n < 2 ? '遊ぶ人が2人以上で始められるよ' : '遊ぶ人 ' + n + '人';
    }
  }

  // 順番と点。点は参加した順のまま出す（順位は一巡したときに出す）
  function renderOrder(V) {
    $('order-list').replaceChildren(...V.order.map((id, i) => {
      const p = playerOf(id);
      const li = el('li', 'sh-order__item' + (i === V.turn ? ' is-now' : '') + (p && p.away ? ' is-away' : ''));
      li.append(el('span', 'sh-order__name', playerName(id)));
      if (i === V.turn && V.q) li.append(el('span', 'sh-tag', '伝える人'));
      if (p && p.away) li.append(el('span', 'sh-tag sh-tag--muted', '通信が切れたみたい'));
      li.append(el('span', 'sh-order__pts' + ((V.scores[id] || 0) < 0 ? ' is-minus' : ''), fmtPts(V.scores[id] || 0)));
      return li;
    }));
  }

  function renderPick(V) {
    const me = isTeller();
    $('pick-teller').hidden = !me;
    $('pick-other').hidden = me;
    if (me) {
      $('pick-title').textContent = forProxy() ? playerName(V.q.teller) + 'さんが伝える番（代わりに選ぶ）' : 'あなたが伝える番だよ';
      $('pick-lead').textContent = forProxy() ? 'お題を1つ選んでね。' : 'お題を1つ選んでね。ほかの人には見えないよ。';
      $('pick-cands').replaceChildren(...V.q.cands.map((t) => {
        const b = el('button', 'sh-cand', DATA.topics[t]);
        b.type = 'button';
        b.addEventListener('click', () => qAct('choose', { t }));
        return b;
      }));
    } else {
      $('pick-other-text').textContent = playerName(V.q.teller) + 'さんがお題を選んでいるよ';
    }
  }

  function renderHint(V) {
    const q = V.q;
    const me = isTeller();
    const away = (playerOf(q.teller) || {}).away;
    const step = q.signs.length;
    const open = step > q.judged;      // いまのしるしで選べる
    const iCan = !me && S.role !== 'watch' && amGuesser();
    const solved = iCan && q.solved[S.me];
    const picked = iCan && (S.me in q.picks);
    $('hint-away').hidden = !away;
    $('hint-away').textContent = isHost()
      ? playerName(q.teller) + 'さんの通信が切れたみたい。戻ってくるのを待つか、下の「この問を終えて次の人へ」で交代できるよ'
      : playerName(q.teller) + 'さんの通信が切れたみたい。戻ってくるのを待っているよ';

    $('hint-topic').hidden = !me;
    if (me) {
      $('hint-topic-label').textContent = forProxy() ? playerName(q.teller) + 'さんのお題' : 'あなたのお題';
      $('hint-topic-text').textContent = DATA.topics[q.topic];
    }
    $('hint-signs-title').textContent = playerName(q.teller) + 'さんのしるし（' + step + ' / ' + MAX_SIGNS + '）';
    renderSigns($('hint-signs'), q.signs, me ? S.sel : null);

    // 案内
    let guide;
    if (me) {
      if (!step) guide = '1つ目のしるしを選んで「しるしを出す」を押してね';
      else if (open) guide = 'みんなが選ぶのを待っているよ。待たずに次のしるしを出してもいいよ';
      else if (step >= MAX_SIGNS) guide = 'しるしは' + MAX_SIGNS + 'つまで';
      else guide = '次のしるしを選んでね';
    } else if (!iCan) {
      guide = !step ? playerName(q.teller) + 'さんが1つ目のしるしを選んでいるよ' : (open ? 'みんなが候補から選んでいるよ' : '次のしるしを待っているよ');
    } else if (solved) guide = NUMS[q.solved[S.me] - 1] + 'つ目で当てたよ！ ほかの人を待とう';
    else if (!step) guide = playerName(q.teller) + 'さんが1つ目のしるしを選んでいるよ';
    else if (picked) guide = '選んだよ。みんなを待っているよ';
    else if (!open && q.last && q.last.n === step && q.last.missed.includes(S.me)) guide = 'はずれ（' + fmtDelta(-MISS) + '）。次のしるしを待っているよ';
    else if (open) guide = '候補から1つ選んでね（このしるしでは1回だけ）';
    else guide = '次のしるしを待っているよ';
    $('hint-guide').textContent = guide;

    // 候補
    const answer = q.board.indexOf(q.topic);
    const myPick = picked ? q.picks[S.me] : null;
    const canTap = iCan && !solved && !picked && open;
    $('hint-board').replaceChildren(...q.board.map((t, b) => {
      const crossed = q.crossed.includes(b);
      const cls = ['sh-tile'];
      if (crossed) cls.push('is-crossed');
      if (me && b === answer) cls.push('is-answer');
      if (b === myPick) cls.push('is-mine');
      if (solved && b === answer) cls.push('is-answer');
      const tile = el(canTap && !crossed ? 'button' : 'div', cls.join(' '));
      if (canTap && !crossed) {
        tile.type = 'button';
        tile.addEventListener('click', () => qAct('guess', { step, b }));
      }
      tile.append(el('span', 'sh-tile__key', KEYS[b]), el('span', 'sh-tile__text', DATA.topics[t]));
      if (crossed) tile.append(msIcon('close', 'sh-tile__mark'));
      else if (me && b === answer) tile.append(el('span', 'sh-tile__tag', 'お題'));
      else if (b === myPick) tile.append(el('span', 'sh-tile__tag', '選んだ'));
      else if (solved && b === answer) tile.append(el('span', 'sh-tile__tag', '当たり'));
      return tile;
    }));
    $('btn-skip-guess').hidden = !canTap;

    // だれが選んだか（何を選んだかは出さない）
    const gs = V.players.filter((p) => !p.away && isPlayer(V, p.id) && p.id !== q.teller);
    $('hint-picked').hidden = !step;
    $('hint-picked').replaceChildren(...gs.map((p) => {
      let state = '考え中';
      let icon = 'more_horiz';
      if (q.solved[p.id]) { state = NUMS[q.solved[p.id] - 1] + 'で当てた'; icon = 'emoji_events'; }
      else if (!open) { state = '次のしるしを待っている'; icon = 'hourglass_top'; }
      else if (p.id in q.picks) { state = '選んだ'; icon = 'check_circle'; }
      const li = el('li', 'sh-picked__item' + (q.solved[p.id] ? ' is-solved' : '') + (p.id in q.picks ? ' is-picked' : ''));
      li.append(msIcon(icon), el('span', '', p.name), el('span', 'sh-picked__state', state));
      return li;
    }));

    renderProxyPanel(V, q, open, step);
    $('hint-tools').hidden = !me;
    if (me) renderPalette(q);
  }

  // メンターが、端末のない子の代わりに候補を選ぶ欄
  function renderProxyPanel(V, q, open, step) {
    const px = isHost() ? V.players.filter((p) => p.proxy && p.id !== q.teller) : [];
    $('proxy-panel').hidden = !px.length || !step;
    if (!px.length) return;
    $('proxy-rows').replaceChildren(...px.map((p) => {
      const row = el('div', 'sh-proxy__row');
      const head = el('p', 'sh-proxy__name');
      head.append(el('strong', '', p.name));
      let state = '';
      const can = open && !q.solved[p.id] && !(p.id in q.picks);
      if (q.solved[p.id]) state = NUMS[q.solved[p.id] - 1] + 'つ目で当てた';
      else if (p.id in q.picks) state = q.picks[p.id] < 0 ? '選ばない' : '選んだ（' + KEYS[q.picks[p.id]] + '）';
      else if (!open) state = '次のしるしを待っている';
      if (state) head.append(el('span', 'sh-proxy__state', state));
      row.append(head);
      if (can) {
        const keys = el('div', 'sh-proxy__keys');
        q.board.forEach((t, b) => {
          const k = el('button', 'sh-proxy__key', KEYS[b]);
          k.type = 'button';
          k.disabled = q.crossed.includes(b);
          k.setAttribute('aria-label', p.name + 'さんの代わりに ' + KEYS[b] + '（' + DATA.topics[t] + '）を選ぶ');
          k.addEventListener('click', () => qAct('guess', { step, b, as: p.id }));
          keys.append(k);
        });
        const none = el('button', 'btn btn-ghost btn-sm', '選ばない');
        none.type = 'button';
        none.addEventListener('click', () => qAct('guess', { step, b: -1, as: p.id }));
        keys.append(none);
        row.append(keys);
      }
      return row;
    }));
  }

  function renderSigns(root, signs, preview) {
    const items = signs.map((id, i) => signChip(id, i, false));
    if (preview && signs.length < MAX_SIGNS) items.push(signChip(preview, signs.length, true));
    if (!items.length) items.push(el('li', 'sh-signs__empty', 'まだないよ'));
    root.replaceChildren(...items);
  }
  function signChip(id, i, isPreview) {
    const li = el('li', 'sh-sign' + (isPreview ? ' is-preview' : ''));
    li.append(el('span', 'sh-sign__num', NUMS[i]), iconFace(ICONS[id]), el('span', 'sh-sign__label', ICONS[id].label));
    if (isPreview) li.append(el('span', 'sh-sign__note', 'まだ出していない'));
    return li;
  }
  function iconFace(ic) {
    if (ic.color) {
      const sw = el('span', 'sh-swatch');
      sw.style.background = ic.color;
      sw.setAttribute('aria-hidden', 'true');
      return sw;
    }
    return msIcon(ic.icon, 'sh-sign__icon');
  }

  function renderPalette(q) {
    if (S.selQ !== q.uid) { S.selQ = q.uid; S.sel = null; }
    const full = q.signs.length >= MAX_SIGNS;
    if (S.sel && q.signs.includes(S.sel)) S.sel = null;
    $('btn-send').disabled = !S.sel || full;
    $('btn-send').textContent = full ? 'しるしは' + MAX_SIGNS + 'つまで' : NUMS[q.signs.length] + 'つ目のしるしを出す';
    $('send-preview').textContent = S.sel ? '選んでいるしるし: ' + ICONS[S.sel].label : 'アイコンを1つ選んでね';
    $('palette').replaceChildren(...DATA.groups.map((g) => {
      const sec = el('section', 'sh-pgroup');
      sec.append(el('h3', 'sh-pgroup__title', g.name));
      const grid = el('div', 'sh-pgrid');
      g.icons.forEach((ic) => {
        const used = q.signs.includes(ic.id);
        const on = S.sel === ic.id;
        const b = el('button', 'sh-pbtn' + (on ? ' is-on' : '') + (used ? ' is-used' : ''));
        b.type = 'button';
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        b.disabled = used || full;
        b.append(iconFace(ICONS[ic.id]), el('span', 'sh-pbtn__label', ic.label));
        if (on) b.append(msIcon('check_circle', 'sh-pbtn__check'));
        if (used) { b.append(msIcon('done', 'sh-pbtn__check sh-pbtn__check--used')); b.setAttribute('aria-label', ic.label + '（出した）'); }
        b.addEventListener('click', () => { S.sel = on ? null : ic.id; render(); });
        grid.append(b);
      });
      sec.append(grid);
      return sec;
    }));
  }

  function renderReveal(V) {
    const q = V.q;
    $('reveal-topic').textContent = DATA.topics[q.topic];
    renderSigns($('reveal-signs'), q.signs, null);
    const rows = [];
    const tl = el('li', 'sh-result__item');
    tl.append(msIcon('campaign'), el('span', 'sh-result__name', playerName(q.teller)),
      el('span', 'sh-result__what', '伝えた'), el('span', 'sh-result__pts', fmtDelta(isPlayer(V, q.teller) ? q.tellerPts : 0)));
    rows.push(tl);
    V.players.filter((p) => isPlayer(V, p.id) && p.id !== q.teller).forEach((p) => {
      const n = q.solved[p.id];
      const miss = (q.misses || {})[p.id] || 0;
      const delta = (n ? ptsAt(n) : 0) - miss * MISS;
      const what = (n ? NUMS[n - 1] + 'つ目で当てた' : '今回は当たらなかった') + (miss ? '・はずれ' + miss + '回' : '');
      const li = el('li', 'sh-result__item' + (n ? ' is-solved' : ''));
      li.append(msIcon(n ? 'emoji_events' : 'person'), el('span', 'sh-result__name', p.name),
        el('span', 'sh-result__what', what), el('span', 'sh-result__pts' + (delta < 0 ? ' is-minus' : ''), fmtDelta(delta)));
      rows.push(li);
    });
    $('reveal-points').replaceChildren(...rows);
    const last = V.order.slice(V.turn + 1).every((id) => { const p = playerOf(id); return !p || p.away; });
    $('reveal-host').hidden = !isHost();
    $('reveal-wait').hidden = isHost() || S.role === 'watch';
    $('btn-next').hidden = last;
    $('btn-lap').hidden = !last;
  }

  // 順位（同じ点は同じ順位）
  function renderRank(root, V) {
    const list = V.players.filter((p) => isPlayer(V, p.id) && (p.id in V.scores))
      .map((p) => ({ name: p.name, pts: V.scores[p.id] || 0 }))
      .sort((a, b) => b.pts - a.pts);
    let rank = 0;
    root.replaceChildren(...list.map((r, i) => {
      if (i === 0 || r.pts !== list[i - 1].pts) rank = i + 1;
      const li = el('li', 'sh-rank__item' + (rank === 1 ? ' is-top' : ''));
      li.append(el('span', 'sh-rank__no', rank + '位'), el('span', 'sh-rank__name', r.name), el('span', 'sh-rank__pts', fmtPts(r.pts)));
      li.prepend(rank === 1 ? msIcon('workspace_premium', 'sh-rank__crown') : el('span', 'sh-rank__crown'));
      return li;
    }));
  }

  function renderLap(V) {
    $('lap-title').textContent = 'みんな1回ずつ伝えたよ（' + V.lap + '巡目）';
    renderRank($('lap-rank'), V);
    $('lap-host').hidden = !isHost();
    $('lap-wait').hidden = isHost() || S.role === 'watch';
  }

  function renderEnd(V) {
    renderRank($('end-rank'), V);
    $('btn-restart').hidden = !isHost();
  }

  // しるしごとの答え合わせの結果を、少しのあいだ大きく出す（音は鳴らさない）
  function checkPop(V) {
    const q = V.q;
    const box = $('sh-pop');
    // 答えの画面では出さない（答えにかぶらないように。だれが当てたかは答えの画面にある）
    if (!q || V.phase !== 'hint') { box.classList.remove('is-on'); if (q) S.pop = { uid: q.uid, n: q.judged }; return; }
    if (S.pop.uid !== q.uid) { S.pop = { uid: q.uid, n: q.judged }; box.classList.remove('is-on'); return; } // 途中から見た人には出さない
    if (q.judged > S.pop.n && q.last) {
      const hit = q.last.hit;
      box.replaceChildren(msIcon(hit.length ? 'emoji_events' : 'help'),
        document.createTextNode(hit.length ? hit.map(playerName).join('さん・') + 'さんが当てた！' : 'このしるしでは、まだだれも当たらなかったよ'));
      box.classList.toggle('is-hit', hit.length > 0);
      box.classList.remove('is-on');
      void box.offsetWidth;
      box.classList.add('is-on');
      clearTimeout(S.popTimer);
      S.popTimer = setTimeout(() => { box.classList.remove('is-on'); }, POP_MS);
    }
    S.pop.n = q.judged;
  }

  boot();
})();
