/* ひらめき大喜利（試作・仮の名前）
   同じブラウザでひらいたウィンドウの間を BroadcastChannel でつなぐモック。
   ゲームの状態はホストのウィンドウのメモリにだけ置く。
   だれの答えか・だれが押したか・参加のしかたはほかのウィンドウにも届くが、画面には出さない（性善説。本体の RTDB でも同じ扱いの想定）。 */
(() => {
  'use strict';

  const DATA = window.OOGIRI_DATA;
  const CHANNEL = 'roomk-oogiri-draft';
  const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
  const KEY_ID = 'oogiri-id';
  const KEY_SESSION = 'oogiri-session';

  const NAME_MAX = 10;
  const ANSWER_MAX = 40;
  const CANDS = 3;           // ホストが選ぶお題の候補の数
  const MAX_WAITING = 2;     // 1人が順番待ちにできる答えの数（1人が出し続けて、ほかの人の答えが出なくならないように）
  // 時間はホストが決める。?fast=1 はテスト用
  const FAST = new URLSearchParams(location.search).get('fast') === '1';
  // 1つの答えを押せる時間（秒）。ホストが待合室で選ぶ。?fast=1 では3分の1に縮める（15秒→5秒）
  const SHOW_SECS = [10, 15, 20];
  const showMs = (sec) => (FAST ? sec * 1000 / 3 : sec * 1000);
  const IPPON_MS = FAST ? 1200 : 3500;   // 一本を大きく出しておく時間
  const GAP_MS = FAST ? 300 : 900;       // 次の答えまでの間
  // 「時間で区切る」の1分。テストでは ?fast=1&min=ミリ秒 で縮める
  const MIN_MS = (FAST && Number(new URLSearchParams(location.search).get('min'))) || 60000;
  const STEP_MS = 150;
  const PING_MS = 4000;
  const AWAY_MS = 13000;
  const HOST_SILENT_MS = 15000;
  const JOIN_WAIT_MS = 1500;

  // 一本に必要な割合（押せる人のうち）
  const RATIOS = {
    half: { label: '半分', note: '投票する人の半分以上が押したら一本', frac: 1 / 2 },
    two3: { label: '3分の2', note: '投票する人の3分の2以上が押したら一本', frac: 2 / 3 },
    all: { label: '全員', note: '投票する人の全員が押したら一本', frac: 1 },
  };
  const MODES = {
    both: { label: '答えも出す', note: '答えを書いて出せるし、ほかの人の答えに「おもしろい！」も押せるよ' },
    press: { label: '投票だけ', note: '答えは書かないで、出た答えを見て、おもしろかったら「おもしろい！」を押して投票するよ' },
    none: { label: '進行だけ', note: '答えも書かないし「おもしろい！」も押さないよ（投票する人にも数えない）' },
  };
  // お題の区切り
  const CUTS = {
    ippon: { label: '一本が出たら', note: '一本が出たら、そのお題はおしまい。結果を見て次のお題へ' },
    time: { label: '時間で', note: '時間になったら答えを締め切る。そのあいだは何回でも一本が出せる' },
  };
  const MINUTES = [2, 3, 5];
  // 押せる人 n 人のとき、一本に必要な数（切り上げ。1人以上）
  const needOf = (n, ratio) => (n ? Math.max(1, Math.ceil(n * RATIOS[ratio].frac - 1e-9)) : Infinity);
  window.OOGIRI_NEED = needOf; // テストで表を確かめる用

  const $ = (id) => document.getElementById(id);
  const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
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
    mode: 'both',     // 参加する人が、はじめに選んだ参加のしかた
    code: null,
    room: null,       // ホストだけが持つ、ゲームの状態の本物
    view: null,       // 画面に出している状態（ホストは room と同じもの）
    joined: false,
    closed: false,
    lastHostMsg: 0,
    pendingKey: null, // 出した答えの受け取りを待っている印
    ipponShown: null,
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

  // ── ホスト ──
  function publish() {
    S.view = S.room;
    wire('state', { room: S.room });
    render();
  }

  // 答え a を押せる人（答えた本人・通信が切れた人・進行だけのホストをのぞく）
  const judgesFor = (R, by) => R.players.filter((p) => !p.away && p.mode !== 'none' && p.id !== by);
  const needFor = (R, by) => needOf(judgesFor(R, by).length, R.ratio);
  const pressCount = (R, c) => judgesFor(R, c.a.by).filter((p) => c.presses[p.id]).length;
  // 1人の、確認待ちと順番待ちの答えの数
  const waitingOf = (R, id) => R.pending.filter((a) => a.by === id).length + R.queue.filter((a) => a.by === id).length;
  const pressers = (R) => R.players.filter((p) => !p.away && p.mode !== 'none');

  function onHostMsg(m) {
    const R = S.room;
    if (!R) return;
    if (m.type === 'peek') { wire('state', { room: R }); return; } // みんなにみせる画面
    const now = Date.now();
    let p = R.players.find((x) => x.id === m.from);
    if (m.type === 'hello') {
      const name = clean(m.name, NAME_MAX) || 'なまえなし';
      const mode = m.mode === 'press' ? 'press' : 'both';
      if (p) { p.name = name; p.away = false; p.seen = now; } else R.players.push({ id: m.from, name, mode, seen: now });
      publish();
      return;
    }
    if (!p) { wire('who', { to: m.from }); return; }
    const wasAway = p.away;
    p.seen = now;
    p.away = false;
    switch (m.type) {
      case 'ping':
        if (wasAway) publish();
        return;
      case 'leave':
        if (R.phase === 'lobby' && m.from !== R.hostId) R.players = R.players.filter((x) => x.id !== m.from);
        else p.away = true;
        break;
      case 'mode':
        // 進行だけを選べるのはホストだけ
        if (m.mode === 'both' || m.mode === 'press' || (m.mode === 'none' && m.from === R.hostId)) p.mode = m.mode;
        break;
      case 'answer': {
        const err = takeAnswer(R, p, m);
        if (m.from === S.me) onAck(m.key, err); else wire('ack', { to: m.from, key: m.key, err });
        break;
      }
      case 'press':
        takePress(R, p, m);
        break;
      default:
        if (!wasAway) return;
    }
    step(R);
    publish();
  }

  function takeAnswer(R, p, m) {
    if (R.phase !== 'play' || m.r !== R.round) return 'いまは出せないよ';
    if (R.closing) return '締め切ったよ';
    if (p.mode !== 'both') return '「投票だけ」にしているよ';
    const text = clean(m.text, ANSWER_MAX);
    if (!text) return '答えを書いてね';
    if (waitingOf(R, p.id) >= MAX_WAITING) return '出るのを待っている答えが' + MAX_WAITING + 'つあるよ。出るまで待ってね';
    const a = { id: randomCode(8), by: p.id, name: p.name, text };
    // ホストが確認してから順番に入れる。ホスト自身の答えは確認しない
    if (p.id === R.hostId) R.queue.push(a); else R.pending.push(a);
    return '';
  }

  function takePress(R, p, m) {
    const c = R.cur;
    if (R.phase !== 'play' || !c || c.state !== 'open' || c.a.id !== m.aid) return;
    if (p.id === c.a.by || p.mode === 'none' || p.away || c.presses[p.id]) return;
    c.presses[p.id] = true;
  }

  // 時間で進む。一本・時間切れ・次の答え・締め切ったあとの結果
  function step(R) {
    if (R.phase !== 'play') return false;
    const now = Date.now();
    let changed = false;
    const c = R.cur;
    if (c && c.state === 'open') {
      // 押せる人の数は、その場で数えなおす（途中で切れた人・参加のしかたを変えた人）
      if (pressCount(R, c) >= needFor(R, c.a.by)) {
        c.state = 'ippon';
        c.holdUntil = now + IPPON_MS;
        // 一本で区切るときは、ここで締め切る。順番待ちの答えは出さずに結果へ
        if (R.cut === 'ippon' && !R.closing) { R.closing = true; R.endBy = 'ippon'; R.left = R.left.concat(R.queue); R.queue = []; }
        changed = true;
      }
      else if (now >= c.endsAt) { finishCur(R, false, now); changed = true; }
    } else if (c && c.state === 'ippon' && now >= c.holdUntil) {
      finishCur(R, true, now);
      changed = true;
    }
    if (R.cut === 'time' && !R.closing && now >= R.roundEndsAt) { R.closing = true; R.endBy = 'time'; changed = true; }
    if (!R.cur && now >= R.gapUntil && R.queue.length) {
      const a = R.queue.shift();
      R.cur = { a, at: now, endsAt: now + showMs(R.showSec), presses: {}, state: 'open' };
      changed = true;
    }
    // 確認待ちの答えがあるあいだは結果へ進まない（確認していない答えを結果に出さないため）
    if (!R.cur && R.closing && !R.queue.length && !R.pending.length) { R.phase = 'result'; changed = true; }
    return changed;
  }
  function finishCur(R, ippon, now) {
    const a = R.cur.a;
    R.shown.unshift({ id: a.id, by: a.by, name: a.name, text: a.text, ippon });
    if (ippon) R.history[R.history.length - 1].ippons.push({ text: a.text, name: a.name, by: a.by });
    R.cur = null;
    R.gapUntil = now + GAP_MS;
  }

  // お題の候補。まだ出していないお題を先に出す。「ほかの候補」では、いま出ている候補を避ける
  function candidatesFor(R, avoid) {
    const all = DATA.topics.map((_, i) => i).filter((i) => !(avoid || []).includes(i));
    const fresh = shuffle(all.filter((i) => !R.used.includes(i)));
    const again = shuffle(all.filter((i) => R.used.includes(i)));
    return fresh.concat(again).slice(0, CANDS);
  }

  const host = {
    setRatio(r) {
      const R = S.room;
      if (R.phase !== 'lobby' || !RATIOS[r]) return;
      R.ratio = r;
      publish();
    },
    setCut(k) {
      const R = S.room;
      if (R.phase !== 'lobby' || !CUTS[k]) return;
      R.cut = k;
      publish();
    },
    setShowSec(n) {
      const R = S.room;
      if (R.phase !== 'lobby' || !SHOW_SECS.includes(n)) return;
      R.showSec = n;
      publish();
    },
    setMinutes(n) {
      const R = S.room;
      if (R.phase !== 'lobby' || !MINUTES.includes(n)) return;
      R.minutes = n;
      publish();
    },
    start() {
      const R = S.room;
      if (R.phase !== 'lobby' || pressers(R).length < 2) return;
      R.cands = candidatesFor(R);
      R.phase = 'pick';
      publish();
    },
    reroll() {
      const R = S.room;
      if (R.phase !== 'pick') return;
      R.cands = candidatesFor(R, R.cands);
      publish();
    },
    choose(t) {
      const R = S.room;
      if (R.phase !== 'pick' || !R.cands.includes(t)) return;
      R.round += 1;
      R.used.push(t);
      Object.assign(R, {
        phase: 'play', topic: t, pending: [], queue: [], cur: null, shown: [], hidden: [], left: [], closing: false, endBy: null, gapUntil: 0,
        roundEndsAt: R.cut === 'time' ? Date.now() + R.minutes * MIN_MS : 0,
      });
      R.history.push({ topic: t, ippons: [] });
      publish();
    },
    // 確認した答えを順番に入れる。一本で区切ったあとは、出さずに結果に並べる
    approve(aid) {
      const R = S.room;
      if (R.phase !== 'play') return;
      const a = R.pending.find((x) => x.id === aid);
      if (!a) return;
      R.pending = R.pending.filter((x) => x.id !== aid);
      if (R.endBy === 'ippon') R.left.push(a); else R.queue.push(a);
      step(R);
      publish();
    },
    // まずい答えが出たとき用。確認待ちの答えも、順番待ちの答えも、いま出ている答えもかくせる
    hide(aid) {
      const R = S.room;
      if (R.phase !== 'play') return;
      const now = Date.now();
      const pa = R.pending.find((a) => a.id === aid);
      const qa = R.queue.find((a) => a.id === aid);
      if (pa) {
        R.pending = R.pending.filter((a) => a.id !== aid);
        R.hidden.push(pa);
      } else if (qa) {
        R.queue = R.queue.filter((a) => a.id !== aid);
        R.hidden.push(qa);
      } else if (R.cur && R.cur.a.id === aid) {
        R.hidden.push(R.cur.a);
        R.cur = null;
        R.gapUntil = now + GAP_MS;
      } else return;
      step(R);
      publish();
    },
    close() {
      const R = S.room;
      if (R.phase !== 'play' || R.closing) return;
      R.closing = true;
      R.endBy = 'host';
      step(R);
      publish();
    },
    next() {
      const R = S.room;
      if (R.phase !== 'result') return;
      R.cands = candidatesFor(R);
      R.phase = 'pick';
      publish();
    },
    finish() {
      const R = S.room;
      if (R.phase === 'lobby' || R.phase === 'end') return;
      Object.assign(R, { phase: 'end', cur: null, queue: [], pending: [] });
      publish();
    },
    restart() {
      const R = S.room;
      if (R.phase !== 'end') return;
      Object.assign(R, { phase: 'lobby', history: [], topic: null, shown: [], hidden: [], left: [] });
      publish();
    },
  };

  function hostTick() {
    const R = S.room;
    if (!R) return;
    const now = Date.now();
    let changed = false;
    R.players.forEach((p) => {
      if (p.id === R.hostId) return;
      if (!p.away && now - (p.seen || 0) > AWAY_MS) { p.away = true; changed = true; }
    });
    if (step(R)) changed = true;
    if (changed) publish(); else wire('state', { room: R }); // ホストがいることを知らせる
  }

  // ── 参加する人・みんなにみせる画面 ──
  function onGuestMsg(m) {
    if (m.type === 'state' && m.room) {
      S.lastHostMsg = Date.now();
      S.view = m.room;
      if (!S.joined) {
        S.joined = true;
        if (S.role === 'guest') saveGuest();
        showApp();
      }
      S.closed = false;
      render();
    } else if (m.type === 'who' && m.to === S.me && S.role === 'guest') {
      wire('hello', { name: S.name, mode: S.mode });
    } else if (m.type === 'ack' && m.to === S.me) {
      onAck(m.key, m.err);
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
  const saveGuest = () => ssSet(KEY_SESSION, { role: 'guest', code: S.code, name: S.name, mode: S.mode });

  // 出した答えの受け取り。受け取られたら入力欄を空にする（出せなかったら、書いたものは残す）
  function onAck(key, err) {
    if (!key || key !== S.pendingKey) return;
    S.pendingKey = null;
    $('answer-msg').textContent = err || (isHost() ? '出したよ。順番に出るよ' : '出したよ。ホストが確認したら、順番に出るよ');
    $('answer-msg').classList.toggle('is-error', !!err);
    if (!err) $('answer-input').value = '';
  }

  // ══════════════════════════════════════════════
  // はじめの画面
  // ══════════════════════════════════════════════
  function boot() {
    let id = ssGet(KEY_ID);
    if (!id) { id = randomCode(10); ssSet(KEY_ID, id); }
    S.me = id;
    bindButtons();

    const params = new URLSearchParams(location.search);
    const roomParam = (params.get('room') || '').toUpperCase();
    const watchParam = (params.get('watch') || '').toUpperCase();
    const saved = ssGet(KEY_SESSION);
    $('og-front').hidden = false;

    if (CODE_RE.test(watchParam)) {
      S.role = 'watch';
      S.code = watchParam;
      S.me = 'watch-' + randomCode(8);
      $('og-front').hidden = true;
      document.body.classList.add('is-watch');
      startChannel();
      wire('peek');
      setTimeout(() => {
        if (!S.joined) { $('og-front').hidden = false; $('og-front-form').hidden = true; frontMsg('ルームが見つからないよ。ホストのウィンドウがひらいているか確かめてね'); }
      }, JOIN_WAIT_MS);
    } else if (CODE_RE.test(roomParam)) {
      S.role = 'guest';
      S.code = roomParam;
      $('og-front-go').textContent = '入る';
      $('og-front-title').textContent = 'ひらめき大喜利に参加';
      $('og-front-mode').hidden = false;
      if (saved && saved.role === 'guest' && saved.code === roomParam && saved.name) {
        $('og-name').value = saved.name;
        S.mode = saved.mode === 'press' ? 'press' : 'both';
        join(saved.name);
      }
    } else if (saved && saved.role === 'host') {
      ssDel(KEY_SESSION); // ホストのウィンドウを読み込み直すと、ルームは閉じる
    }
    $('og-front-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.isComposing) return;
      const name = clean($('og-name').value, NAME_MAX);
      if (!name) { frontMsg('ニックネームを入れてね'); return; }
      if (S.role === 'guest') {
        const r = document.querySelector('input[name="front-mode"]:checked');
        S.mode = r && r.value === 'press' ? 'press' : 'both';
        join(name);
      } else openRoom(name);
    });
    setInterval(() => { if (S.role === 'host') hostTick(); else if (S.role) guestTick(); }, PING_MS);
    setInterval(() => { if (S.role === 'host' && S.room && step(S.room)) publish(); }, STEP_MS);
    window.addEventListener('beforeunload', () => {
      if (S.role === 'host' && S.room) wire('closed');
      else if (S.role === 'guest' && S.joined) wire('leave');
    });
    requestAnimationFrame(tickTimer);
  }
  function frontMsg(text) {
    const m = $('og-front-msg');
    m.textContent = text;
    m.hidden = !text;
  }

  function openRoom(name) {
    S.role = 'host';
    S.name = name;
    S.code = randomCode(6);
    S.room = {
      code: S.code, hostId: S.me, phase: 'lobby', ratio: 'half', cut: 'ippon', minutes: 3, showSec: 15,
      players: [{ id: S.me, name, mode: 'both', seen: Date.now() }],
      round: 0, cands: [], topic: null, used: [],
      pending: [], queue: [], cur: null, shown: [], hidden: [], left: [], closing: false, endBy: null, gapUntil: 0, roundEndsAt: 0, history: [],
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
    wire('hello', { name, mode: S.mode });
    setTimeout(() => {
      if (!S.joined) frontMsg('ルームが見つからないよ。ホストのウィンドウがひらいているか確かめてね');
    }, JOIN_WAIT_MS);
  }

  function showApp() {
    $('og-front').hidden = true;
    $('og-app').hidden = false;
  }

  // ══════════════════════════════════════════════
  // ボタン
  // ══════════════════════════════════════════════
  function bindButtons() {
    $('btn-start').addEventListener('click', () => host.start());
    $('btn-copy').addEventListener('click', () => copyText(location.origin + location.pathname + '?room=' + S.code, $('btn-copy'), 'リンクをコピー'));
    $('btn-watch').addEventListener('click', () => { window.open(location.origin + location.pathname + '?watch=' + S.code, '_blank'); });
    $('btn-reroll').addEventListener('click', () => host.reroll());
    $('answer-form').addEventListener('submit', (e) => {
      e.preventDefault();
      if (e.isComposing || S.pendingKey) return;
      const text = clean($('answer-input').value, ANSWER_MAX);
      if (!text) { $('answer-msg').textContent = '答えを書いてね'; $('answer-msg').classList.add('is-error'); return; }
      S.pendingKey = randomCode(8);
      act('answer', { text, r: S.view.round, key: S.pendingKey });
      // ホストが受け取らなかったとき（ホストが閉じたなど）は、もう一度押せるようにする
      const key = S.pendingKey;
      setTimeout(() => { if (S.pendingKey === key) onAck(key, '出せなかったよ。もう一度押してね'); }, JOIN_WAIT_MS);
    });
    $('answer-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });
    $('btn-press').addEventListener('click', () => { const c = S.view && S.view.cur; if (c) act('press', { aid: c.a.id }); });
    $('btn-hide-cur').addEventListener('click', () => {
      const c = S.view && S.view.cur;
      if (c && window.confirm('この答えをかくす？（書いた人の画面にだけ「ホストがかくした」と出るよ）')) host.hide(c.a.id);
    });
    $('btn-close').addEventListener('click', () => {
      if (window.confirm('答えを締め切る？（順番を待っている答えが出たら、結果へ進むよ）')) host.close();
    });
    $('btn-next').addEventListener('click', () => host.next());
    $('btn-finish').addEventListener('click', () => host.finish());
    $('btn-restart').addEventListener('click', () => host.restart());
    ['btn-end', 'btn-end-pick'].forEach((id) => $(id).addEventListener('click', () => {
      if (window.confirm('ここでおしまいにする？')) host.finish();
    }));
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
  const PHASES = ['lobby', 'pick', 'play', 'result', 'end'];
  const isHost = () => S.role === 'host';
  const meP = () => (S.role === 'watch' ? null : S.view.players.find((x) => x.id === S.me) || null);

  function render() {
    const V = S.view;
    if (!V) return;
    $('og-closed').hidden = !S.closed;
    $('og-bar-code').textContent = S.role === 'watch' ? '' : 'ルームコード ' + V.code;
    $('og-bar-me').textContent = S.role === 'watch' ? 'みんなにみせる画面' : S.name + (isHost() ? '（ホスト）' : '');
    $('btn-watch').hidden = !isHost();
    PHASES.forEach((ph) => { $('ph-' + ph).hidden = V.phase !== ph; });
    $('host-ctl').hidden = !(isHost() && V.phase === 'pick');
    renderMode(V);
    if (V.phase === 'lobby') renderLobby(V);
    else if (V.phase === 'pick') renderPick(V);
    else if (V.phase === 'play') renderPlay(V);
    else if (V.phase === 'result') renderResult(V);
    else if (V.phase === 'end') renderEnd(V);
    renderIppon(V);
  }

  // 自分の参加のしかた。ほかの人の画面には出さない
  function renderMode(V) {
    const p = meP();
    const show = !!p && V.phase !== 'end';
    $('mode-card').hidden = !show;
    if (!show) return;
    // 待合室ではルールの下、遊んでいる間は自分の答えの下に置く
    const slot = $('slot-mode-' + V.phase);
    if (slot && $('mode-card').parentNode !== slot) slot.append($('mode-card'));
    else if (!slot && $('mode-card').parentNode.id !== 'og-mode-home') $('og-mode-home').append($('mode-card'));
    const keys = isHost() ? ['both', 'press', 'none'] : ['both', 'press'];
    $('mode-opts').replaceChildren(...keys.map((k) => segBtn(MODES[k].label, p.mode === k, () => act('mode', { mode: k }))));
    $('mode-note').textContent = MODES[p.mode].note;
  }
  function segBtn(label, on, onClick) {
    const b = el('button', 'og-seg__btn' + (on ? ' is-on' : ''), label);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.addEventListener('click', () => { if (!on) onClick(); });
    return b;
  }

  function renderLobby(V) {
    // 参加のしかたの印はつけない（答えない子が目立たないように）
    $('lobby-players').replaceChildren(...V.players.map((p) => {
      const li = el('li', 'og-player' + (p.away ? ' is-away' : ''));
      li.append(msIcon(p.id === V.hostId ? 'star' : 'person'), el('span', '', p.name));
      if (p.id === V.hostId) li.append(el('span', 'og-tag', 'ホスト'));
      if (p.away) li.append(el('span', 'og-tag og-tag--muted', '通信が切れたみたい'));
      return li;
    }));
    $('howto-ratio').textContent = 'おもしろかったら「おもしろい！」で投票。' + RATIOS[V.ratio].note.replace('一本', '「一本！」');
    $('howto-cut').textContent = V.cut === 'time'
      ? V.minutes + '分たったら答えを締め切って、結果を見る'
      : '一本が出たら、そのお題はおしまい。結果を見て次のお題へ';
    $('lobby-host').hidden = !isHost();
    $('lobby-start').hidden = !isHost();
    $('btn-copy').hidden = !isHost();
    $('lobby-wait').hidden = isHost() || S.role === 'watch';
    if (isHost()) {
      $('ratio-opts').replaceChildren(...Object.keys(RATIOS).map((k) => segBtn(RATIOS[k].label, V.ratio === k, () => host.setRatio(k))));
      $('ratio-note').textContent = RATIOS[V.ratio].note + '（投票する人は、答えを出した本人をのぞいた全員）';
      $('cut-opts').replaceChildren(...Object.keys(CUTS).map((k) => segBtn(CUTS[k].label, V.cut === k, () => host.setCut(k))));
      $('time-opts').hidden = V.cut !== 'time';
      $('time-opts').replaceChildren(...MINUTES.map((n) => segBtn(n + '分', V.minutes === n, () => host.setMinutes(n))));
      $('show-opts').replaceChildren(...SHOW_SECS.map((n) => segBtn(n + '秒', V.showSec === n, () => host.setShowSec(n))));
      $('cut-note').textContent = CUTS[V.cut].note + '。ホストはいつでも「答えを締め切る」で区切れるよ';
      const n = pressers(V).length;
      $('btn-start').disabled = n < 2;
      $('lobby-start-note').textContent = n < 2 ? '投票する人が2人以上で始められるよ' : '投票する人 ' + n + '人';
    }
  }

  function renderPick(V) {
    $('pick-host').hidden = !isHost();
    $('pick-other').hidden = isHost();
    if (!isHost()) return;
    $('pick-cands').replaceChildren(...V.cands.map((t) => {
      const b = el('button', 'og-cand', DATA.topics[t]);
      b.type = 'button';
      b.addEventListener('click', () => host.choose(t));
      return b;
    }));
  }

  function renderPlay(V) {
    const p = meP();
    const c = V.cur;
    $('play-topic').textContent = DATA.topics[V.topic];
    $('play-rule').hidden = V.cut !== 'ippon' || V.closing;
    $('host-panel').hidden = !isHost();
    $('play-left').hidden = V.cut !== 'time' || V.closing;

    // いま出ている答え（だれのかは出さない）
    $('stage-on').hidden = !c;
    $('stage-empty').hidden = !!c;
    $('stage').classList.toggle('is-on', !!c);
    if (c) {
      $('stage-text').textContent = c.a.text;
      const mine = !!p && c.a.by === S.me;
      const canPress = !!p && !mine && p.mode !== 'none';
      const pressed = !!c.presses[S.me];
      $('btn-press').hidden = !canPress;
      $('btn-press').disabled = pressed || c.state !== 'open';
      $('btn-press').classList.toggle('is-pressed', pressed);
      $('btn-press-label').textContent = pressed ? '押したよ' : 'おもしろい！';
      $('stage-mine').hidden = !mine;
      $('btn-hide-cur').hidden = !isHost() || c.state !== 'open';
      $('stage-hint').textContent = c.state !== 'open' ? ''
        : S.role === 'watch' ? 'おもしろかったら、自分の画面で「おもしろい！」を押してね'
          : !canPress ? '' : pressed ? '投票したよ' : 'おもしろかったら押して投票してね';
    } else {
      $('stage-empty').textContent = isHost() && V.pending.length ? '「届いた答え」で「みんなに出す」を押すと、ここに出るよ' : '答えが出るのを待っているよ';
    }

    // 答えを書く（「答える・押す」の人だけ）
    const canAnswer = !!p && p.mode === 'both' && !V.closing;
    $('answer-form').hidden = !canAnswer;
    $('play-closed').hidden = !V.closing;
    $('play-closed').textContent = V.endBy === 'ippon' ? '一本が出たよ。結果へ進むよ'
      : (V.endBy === 'time' ? '時間になったよ' : '締め切ったよ') + '。残りの答えが出たら結果へ進むよ';
    if (canAnswer) {
      const waiting = waitingOf(V, S.me);
      $('btn-answer').disabled = waiting >= MAX_WAITING || !!S.pendingKey;
      if (waiting >= MAX_WAITING && !S.pendingKey) {
        $('answer-msg').textContent = '出るのを待っている答えが' + MAX_WAITING + 'つあるよ。出たら、また出せるよ';
        $('answer-msg').classList.remove('is-error');
      }
    }

    // 自分の答え（自分の画面にだけ）
    const mineRows = [];
    if (p) {
      V.pending.filter((a) => a.by === S.me).forEach((a) => mineRows.push(row(a.text, 'ホストが確認中', 'hourglass_top')));
      V.queue.filter((a) => a.by === S.me).forEach((a) => mineRows.push(row(a.text, '順番待ち', 'schedule')));
      if (c && c.a.by === S.me) mineRows.push(row(c.a.text, 'いま出ているよ', 'campaign'));
      V.shown.filter((a) => a.by === S.me).forEach((a) => mineRows.push(row(a.text, a.ippon ? '一本！' : '出たよ', a.ippon ? 'workspace_premium' : 'check', a.ippon ? 'is-ippon' : '')));
      V.hidden.filter((a) => a.by === S.me).forEach((a) => mineRows.push(row(a.text, 'ホストがかくした', 'visibility_off', 'is-hidden')));
    }
    $('mine-card').hidden = !mineRows.length;
    $('mine-list').replaceChildren(...mineRows);
    $('my-card').hidden = $('answer-form').hidden && !mineRows.length;

    // 確認する答え（ホストにだけ）
    $('check-card').hidden = !isHost() || !V.pending.length;
    $('check-empty').hidden = !isHost() || !!V.pending.length || V.closing;
    $('check-count').textContent = V.pending.length ? V.pending.length + 'つ' : '';
    if (isHost()) {
      $('check-list').replaceChildren(...V.pending.map((a) => {
        const li = row(a.text, a.name + 'さん', 'mark_chat_unread');
        const btns = el('div', 'og-list__btn og-list__btns');
        const ok = el('button', 'btn btn-primary btn-sm og-approve', 'みんなに出す');
        ok.type = 'button';
        ok.addEventListener('click', () => host.approve(a.id));
        const ng = el('button', 'btn btn-ghost btn-sm og-reject', 'かくす');
        ng.type = 'button';
        ng.addEventListener('click', () => { if (window.confirm('この答えをかくす？（書いた人の画面にだけ「ホストがかくした」と出るよ）')) host.hide(a.id); });
        btns.append(ok, ng);
        li.append(btns);
        return li;
      }));
    }

    // このあと出る答え（ホストにだけ。まずい答えをかくせるように）
    $('queue-card').hidden = !isHost() || !V.queue.length;
    if (isHost()) {
      $('queue-list').replaceChildren(...V.queue.map((a) => {
        const li = row(a.text, a.name + 'さん', 'schedule');
        const b = el('button', 'btn btn-ghost btn-sm og-list__btn', 'かくす');
        b.type = 'button';
        b.addEventListener('click', () => { if (window.confirm('この答えをかくす？（書いた人の画面にだけ「ホストがかくした」と出るよ）')) host.hide(a.id); });
        li.append(b);
        return li;
      }));
    }

    // 出た答え。名前は一本のときだけ出す
    $('shown-list').replaceChildren(...(V.shown.length ? V.shown.map((a) => shownRow(a)) : [el('li', 'og-list__empty', 'まだないよ')]));

    $('btn-close').hidden = !isHost() || V.closing;
  }
  function row(text, what, icon, cls) {
    const li = el('li', 'og-list__item' + (cls ? ' ' + cls : ''));
    li.append(msIcon(icon), el('span', 'og-list__text', text), el('span', 'og-list__what', what));
    return li;
  }
  function shownRow(a) {
    if (a.ippon) return row(a.text, a.name + 'さん', 'workspace_premium', 'is-ippon');
    return row(a.text, a.by === S.me ? 'あなた' : '', 'chat_bubble');
  }

  // 一本を大きく出す（音は鳴らさない）
  function renderIppon(V) {
    const c = V.phase === 'play' && V.cur;
    const on = !!(c && c.state === 'ippon');
    const box = $('og-ippon');
    if (on) {
      $('og-ippon-text').textContent = c.a.text;
      $('og-ippon-name').textContent = c.a.name + 'さん';
      if (S.ipponShown !== c.a.id) {
        S.ipponShown = c.a.id;
        box.hidden = false;
        box.classList.remove('is-on');
        void box.offsetWidth;
        box.classList.add('is-on');
      }
    } else {
      box.hidden = true;
      box.classList.remove('is-on');
    }
  }

  // 押せる時間の帯（数字は秒だけ。押した数は出さない）
  function tickTimer() {
    const V = S.view;
    if (V && V.phase === 'play' && V.cut === 'time' && !V.closing) {
      const sec = Math.max(0, Math.ceil((V.roundEndsAt - Date.now()) / 1000));
      $('play-left').textContent = 'のこり ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
    }
    const c = V && V.phase === 'play' && V.cur;
    if (c && c.state === 'open') {
      const left = Math.max(0, c.endsAt - Date.now());
      $('stage-bar').style.width = (left / (c.endsAt - c.at) * 100).toFixed(1) + '%';
      $('stage-sec').textContent = 'あと ' + Math.ceil(left / 1000) + '秒';
    } else if (c) {
      $('stage-bar').style.width = '0%';
      $('stage-sec').textContent = '';
    }
    requestAnimationFrame(tickTimer);
  }

  function renderResult(V) {
    $('result-topic').textContent = DATA.topics[V.topic];
    const ip = V.shown.filter((a) => a.ippon);
    // 一本で区切ったときの、出る前だった答えも名前なしで並べる
    const others = V.shown.filter((a) => !a.ippon).concat((V.left || []).map((a) => Object.assign({}, a, { ippon: false })));
    $('result-ippon').replaceChildren(...(ip.length ? ip.map((a) => shownRow(a)) : [el('li', 'og-list__empty', 'このお題では一本は出なかったよ')]));
    $('result-others').replaceChildren(...(others.length ? others.map((a) => shownRow(a)) : [el('li', 'og-list__empty', 'ないよ')]));
    $('result-host').hidden = !isHost();
    $('result-wait').hidden = isHost() || S.role === 'watch';
  }

  // 人ごとの一本の数（1本以上の人だけ。順位はつけず、参加した順に並べる）と、お題ごとの一本
  function renderEnd(V) {
    const count = {};
    V.history.forEach((h) => h.ippons.forEach((a) => { count[a.by] = (count[a.by] || 0) + 1; }));
    const who = V.players.filter((p) => count[p.id]);
    $('end-counts').replaceChildren(...(who.length ? who.map((p) => {
      const li = el('li', 'og-counts__item');
      li.append(msIcon('workspace_premium'), el('span', 'og-counts__name', p.name), el('span', 'og-counts__n', count[p.id] + '本'));
      return li;
    }) : [el('li', 'og-list__empty', '一本は出なかったよ')]));
    $('end-history').replaceChildren(...V.history.map((h) => {
      const sec = el('section', 'og-history__item');
      sec.append(el('h3', 'og-history__topic', DATA.topics[h.topic]));
      const ul = el('ul', 'og-list');
      ul.replaceChildren(...(h.ippons.length
        ? h.ippons.map((a) => row(a.text, a.name + 'さん', 'workspace_premium', 'is-ippon'))
        : [el('li', 'og-list__empty', '一本はなし')]));
      sec.append(ul);
      return sec;
    }));
    $('btn-restart').hidden = !isHost();
  }

  boot();
})();
