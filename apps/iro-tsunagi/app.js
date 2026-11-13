/* いろつなぎ — 画面と操作（ひとり・ルーム・対戦・みんなにみせる画面）。ルールは engine.js（画面に触らない）
 * ルームは Realtime Database（irotsunagi_rooms）。作り（作成・参加・在室・再接続・期限・結果）はすとんブロックと同じ */
(function () {
  'use strict';

  const E = window.IroEngine;
  const $ = (id) => document.getElementById(id);

  // 色ごとに中の形を変えて、色だけにたよらず見分けられるようにする。9 はじゃまの玉（灰色・形なし）
  const BALL = {
    1: { fill: '#E0706A', edge: '#A8463F', mark: 'circle' },
    2: { fill: '#4F86C6', edge: '#2F5F98', mark: 'triangle' },
    3: { fill: '#5BAA6A', edge: '#3A7A48', mark: 'square' },
    4: { fill: '#F2C14E', edge: '#B88A1C', mark: 'star' },
    5: { fill: '#9B72C4', edge: '#6C4B92', mark: 'diamond' },
    9: { fill: '#BDB4A8', edge: '#8C8378', mark: null },
  };
  const SPEED = { slow: 900, normal: 600, fast: 350 };
  const SPEED_LABEL = { slow: 'ゆっくり', normal: 'ふつう', fast: 'はやい' };
  const SOFT_MS = 80;        // 下の押しっぱなし: 押したときに1マス、そのあと同じ速さで1マスずつ（途中で速くしない）
  const DAS_MS = 130;        // 左右の押しっぱなし: はじめに1マス、この時間待って
  const ARR_MS = 30;         // そのあとはこの間かくで1マスずつ
  const LOCK_MS = 450;       // 着地してから置かれるまで
  const MAX_RESETS = 10;     // 着地したまま動かして待ち時間をのばせる回数
  const FLIP_MS = 350;       // 回せなかったあと、この時間のうちにもう一度回すと上下を入れかえる
  const FULL_MS = 1300;      // 盤がいっぱいのとき、からにするまで見せる時間
  const MSG_MS = 1400;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const params = new URLSearchParams(window.location.search);   // seed（玉の順番を決める）・test（テストから状態を読む）

  // ---------- ルーム ----------
  const DB_PREFIX = 'irotsunagi_rooms';
  const SESSION_KEY = 'irotsunagi_session';
  const ORPHAN_TTL_MS = 2 * 60 * 1000;
  const PRESENCE_RETRY_MS = 3000;
  const TX_RETRY_MAX = 3;
  const MAX_GUESTS = 8;
  const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;
  const STATUS = { WAITING: 'waiting', PLAY: 'play', RESULT: 'result' };
  const ROOM_TIMES = [120, 180, 300];
  const NO_TIME_CAP_S = 30 * 60;   // 対戦の「時間なし」も、ルームが残りつづけないよう30分で区切る
  const COUNTDOWN_MS = 3500;       // 「はじめる」から落ちはじめるまで（3・2・1）
  const FINISH_GRACE_MS = 1500;    // 時間のあと、最後の盤が届くのを待つ（ホスト）
  const FINISH_BACKUP_MS = 4000;   // ホストのタブが裏に回っていても、あそぶ人の端末が結果を出す
  const BATTLE_END_MS = 800;       // 対戦で1人になってから、最後の盤が届くのを待って結果を出す
  const DEFAULT_SETTINGS = { mode: 'score', full: 'out', time: 180, speed: 'slow', colors: 4 };
  const DEFAULT_TITLE = document.title;

  // Firebase を読めなかった端末（フィルターなど）でも、ひとりであそぶは動くようにする（ルームは「つながらなかった」と出す）
  const fb = typeof firebase !== 'undefined'
    ? RoomkRTDB.initFirebase(firebase)
    : { authReady: Promise.reject(new Error('firebase unavailable')), db: null };
  fb.authReady.catch(() => { /* waitAuth で知らせる */ });
  const { authReady, db } = fb;

  const state = {
    role: null,          // 'host' | 'guest' | 'spectator'（みんなにみせる画面）| 'solo'（ひとり）
    nickname: null,
    roomCode: null,
    roomRef: null,
    room: null,
    joinedAt: null,
    currentScreen: 'top',
    timerInterval: null,
    orphanTimer: null,
    orphanAt: null,
    connectedRef: null,
    connectedCallback: null,
    roomCallback: null,
    isConnected: false,
    presenceDirty: false,
    presenceAt: 0,
    leaving: false,
    busy: false,
    watchTimer: null,
    playRound: null,
    playSeed: null,
    jamaSeen: new Set(),
    finishing: false,
  };

  // いまあそんでいる回（ひとり・ルーム共通）。あそんでいないときは null
  let run = null;
  let g = null;
  let last = 0;
  let parts = [];            // 消えたときの粒 { x, y, vx, vy, c, t }
  let trail = null;          // 一気に落としたときの跡 { cells, t }
  let lastRotFail = -1e9;
  let softHeld = false;

  // ---------- 効果音（はじめは切。入にした端末だけファイルを読む） ----------
  const SFX_KEY = 'irotsunagi:sfx';
  const SFX_VER = '20261113a';
  const SFX_GAIN = 0.25;
  // 音のファイルは「すとんブロック」と同じもの（ElevenLabs で作った）
  const SFX_FILES = { move: 0.35, rotate: 0.5, place: 0.6, drop: 0.8, ding: 0.8, allclear: 0.7, finish: 0.8 };
  const sfx = { on: false, ac: null, out: null, buf: {}, loading: false };
  try { sfx.on = localStorage.getItem(SFX_KEY) === '1'; } catch (e) { /* 使えなければ切のまま */ }
  function syncSfxInputs() {
    ['sfx', 'roomSfx'].forEach((name) => {
      const el = document.querySelector('input[name="' + name + '"][value="' + (sfx.on ? 'on' : 'off') + '"]');
      if (el) el.checked = true;
    });
  }
  function setSfx(on) {
    sfx.on = on;
    try { localStorage.setItem(SFX_KEY, on ? '1' : '0'); } catch (e) { /* 残せなくても遊べる */ }
    syncSfxInputs();
    ensureAudio();
  }
  function ensureAudio() {
    if (!sfx.on) return;
    try {
      if (!sfx.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        sfx.ac = new AC({ latencyHint: 'interactive' });
        sfx.out = sfx.ac.createGain();
        sfx.out.gain.value = SFX_GAIN;
        sfx.out.connect(sfx.ac.destination);
      }
      if (sfx.ac.state !== 'running') sfx.ac.resume().catch(() => {});
      if (!sfx.loading) {
        sfx.loading = true;
        Object.keys(SFX_FILES).forEach((name) => {
          fetch('sfx/' + name + '.mp3?v=' + SFX_VER)
            .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
            .then((data) => sfx.ac.decodeAudioData(data))
            .then((buf) => { sfx.buf[name] = buf; })
            .catch(() => { /* 読めなければ鳴らさない */ });
        });
      }
    } catch (e) { /* 音が使えなくても遊べる */ }
  }
  function play(name, rate, when) {
    if (!sfx.on || !sfx.ac || sfx.ac.state !== 'running' || !sfx.buf[name]) return;
    const src = sfx.ac.createBufferSource();
    const gn = sfx.ac.createGain();
    src.buffer = sfx.buf[name];
    src.playbackRate.value = rate || 1;
    gn.gain.value = SFX_FILES[name] || 1;
    src.connect(gn).connect(sfx.out);
    src.start(sfx.ac.currentTime + (when || 0));
  }
  // れんさの音: れんさが1つ増えるごとに2音（全音）高く。1オクターブまで
  function playChain(chain) {
    const rate = Math.pow(2, Math.min(12, (chain - 1) * 2) / 12);
    play('ding', rate);
    if (chain >= 2) play('ding', rate * 1.26, 0.07);
    if (chain >= 3) play('ding', rate * 1.498, 0.14);
  }

  // ---------- 音楽（はじめは切。入にした端末だけ、あそんでいる間に流す） ----------
  // <audio> で流しながら鳴らす（全部をメモリに広げない）。曲は ElevenLabs で作った（scripts/iro-tsunagi/bgm.py）
  const BGM_KEY = 'irotsunagi:bgm';
  const BGM_VER = '20261113a';
  const bgm = { on: false, el: null, want: null, unlocked: false, unlocking: false, blocked: false };
  try { bgm.on = localStorage.getItem(BGM_KEY) === '1'; } catch (e) { /* 使えなければ切のまま */ }
  function syncBgmInputs() {
    ['bgm', 'roomBgm'].forEach((name) => {
      const el = document.querySelector('input[name="' + name + '"][value="' + (bgm.on ? 'on' : 'off') + '"]');
      if (el) el.checked = true;
    });
  }
  function bgmWanted() {
    return bgm.on && !!run && !run.done && !run.paused && state.currentScreen === 'play' && !document.hidden && run.t() >= 0;
  }
  function bgmEl() {
    if (!bgm.el) {
      const el = new Audio();
      el.preload = 'none';
      el.loop = true;
      el.src = 'bgm/play.mp3?v=' + BGM_VER;
      bgm.el = el;
    }
    return bgm.el;
  }
  // 流したいかが変わったときだけ、流す・止める（tick から毎回よぶ）
  function syncBgm() {
    if (!bgm.on) return;
    const want = bgmWanted();
    if (want === bgm.want || (want && bgm.blocked)) return;
    bgm.want = want;
    if (!want) { if (bgm.el && !bgm.unlocking) bgm.el.pause(); return; }
    const el = bgmEl();
    el.muted = false;
    const p = el.play();
    if (p) p.then(() => { bgm.unlocked = true; }).catch((e) => {
      // まだ何も押していない端末では流せない。つぎに押したとき（unlockBgm）にやり直す
      if (e && e.name === 'NotAllowedError') { bgm.blocked = true; bgm.want = null; }
    });
  }
  // 押した操作の中で1回 play() しておく（ルームでは、回がはじまるのがホストの操作なので、自分が押していない時に流しはじめる）
  function unlockBgm() {
    if (!bgm.on || bgm.unlocked) return;
    if (bgm.blocked) { bgm.blocked = false; syncBgm(); }
    if (bgm.unlocked || bgmWanted()) return;
    const el = bgmEl();
    bgm.unlocked = true;
    bgm.unlocking = true;
    el.muted = true;
    const p = el.play();
    const done = () => {
      if (bgm.el !== el) return;
      bgm.unlocking = false;
      if (!bgm.want) { el.pause(); try { el.currentTime = 0; } catch (e) { /* まだ読めていない */ } }
      el.muted = false;
    };
    if (p) p.then(done).catch(() => { if (bgm.el === el) { bgm.unlocking = false; el.muted = false; bgm.unlocked = false; } });
    else done();
  }
  function rewindBgm() {
    if (!bgm.el || !bgm.el.paused) return;
    try { bgm.el.currentTime = 0; } catch (e) { /* まだ読めていない */ }
  }
  function setBgm(on) {
    bgm.on = on;
    try { localStorage.setItem(BGM_KEY, on ? '1' : '0'); } catch (e) { /* 残せなくてもよい */ }
    syncBgmInputs();
    if (on) { unlockBgm(); return; }
    // 切にしたら、読んだ音を手放す
    const el = bgm.el;
    bgm.el = null; bgm.want = null; bgm.unlocked = false; bgm.unlocking = false; bgm.blocked = false;
    if (el) { el.pause(); el.removeAttribute('src'); el.load(); }
  }

  // ---------- 共通 ----------
  function showScreen(id) {
    document.querySelectorAll('.it-screen').forEach((s) => s.classList.toggle('active', s.id === 'screen-' + id));
    state.currentScreen = id;
    // ルームのバーは待合室と結果だけ（あそんでいる間は、盤を大きく出すため）
    const inRoom = !!state.roomRef && (id === 'waiting' || id === 'result');
    $('appBar').hidden = !inRoom;
    $('roomBar').hidden = !inRoom;
    window.scrollTo(0, 0);
  }
  function setError(id, message) {
    const node = $(id);
    node.textContent = message || '';
    node.hidden = !message;
  }
  function toast(message, error = true) { RoomkRTDB.showToast(message, error); }
  function validNickname(value) {
    if (!value) return '名前を入れてね';
    if (value.length > 8) return '名前は8文字までだよ';
    if (/[.#$/[\]\u0000-\u001f\u007f]/.test(value)) return '記号 . # $ [ ] / は使えないよ';
    return '';
  }
  const currentUid = () => (typeof firebase !== 'undefined' && firebase.auth().currentUser ? firebase.auth().currentUser.uid : null);
  const serverTimestamp = () => firebase.database.ServerValue.TIMESTAMP;
  function makeElement(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value != null) node.textContent = String(value);
    return node;
  }
  function msIcon(name) {
    const node = makeElement('span', 'material-symbols-rounded', name);
    node.setAttribute('aria-hidden', 'true');
    return node;
  }
  function fmtTime(ms) {
    const s = Math.ceil(Math.max(0, ms) / 1000);
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function radio(name) {
    const el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }

  // ---------- ルームの値の読み方（壊れた値は読み飛ばす） ----------
  // 時間「なし」（0）は、対戦で「ここまで」のときだけ選べる
  function timeOf(value, mode, full) {
    const t = Number(value);
    return ROOM_TIMES.includes(t) || (t === 0 && mode === 'battle' && full === 'out') ? t : DEFAULT_SETTINGS.time;
  }
  const colorsOf = (v) => ([3, 4, 5].includes(Number(v)) ? Number(v) : DEFAULT_SETTINGS.colors);
  function settingsOf(room) {
    const s = (room && room.settings) || {};
    const mode = s.mode === 'battle' ? 'battle' : 'score';
    const full = s.full === 'clear' ? 'clear' : 'out';
    return { mode, full, time: timeOf(s.time, mode, full), speed: SPEED[s.speed] ? s.speed : DEFAULT_SETTINGS.speed, colors: colorsOf(s.colors) };
  }
  function settingsText(s) {
    const time = s.time ? Math.round(s.time / 60) + '分' : '時間なし';
    const head = s.mode === 'battle' ? '対戦・' + (s.full === 'out' ? 'いっぱいでここまで' : 'からにしてつづける') : '点をくらべる';
    return head + '・' + time + '・' + SPEED_LABEL[s.speed] + '・' + s.colors + '色';
  }
  const byJoined = (entries) => entries.sort((a, b) => (Number(a[1] && a[1].joinedAt) || 0) - (Number(b[1] && b[1].joinedAt) || 0));
  const memberNames = (room) => byJoined(Object.entries((room && room.players) || {})).map(([name]) => name);
  const guestNames = (room) => memberNames(room).filter((name) => name !== room.host);
  function roundOf(room) {
    const r = room && room.round;
    if (!r || typeof r !== 'object' || !Number(r.id) || !Number(r.startedAt)) return null;
    const players = Array.isArray(r.players) ? r.players.filter((x) => typeof x === 'string') : [];
    const mode = r.mode === 'battle' ? 'battle' : 'score';
    const full = r.full === 'clear' ? 'clear' : 'out';
    return {
      id: Number(r.id), seed: Number(r.seed) >>> 0, startedAt: Number(r.startedAt), mode, full,
      time: timeOf(r.time, mode, full), speed: SPEED[r.speed] ? r.speed : DEFAULT_SETTINGS.speed, colors: colorsOf(r.colors),
      players, endedAt: Number(r.endedAt) || null,
    };
  }
  const isBattle = (R) => !!R && R.mode === 'battle';
  const isOutMode = (R) => isBattle(R) && R.full === 'out';
  function inRoundOf(room, name) {
    const R = room.status === STATUS.PLAY || room.status === STATUS.RESULT ? roundOf(room) : null;
    return !!R && R.players.includes(name);
  }
  // ゲストの人数。その回の人は、切れて在室から消えていても戻ってくるので数に入れる
  function guestCount(room) {
    const names = new Set(guestNames(room));
    const R = room.status === STATUS.PLAY || room.status === STATUS.RESULT ? roundOf(room) : null;
    if (R) R.players.forEach((name) => { if (name !== room.host) names.add(name); });
    return names.size;
  }
  const playStartOf = (R) => R.startedAt + COUNTDOWN_MS;
  function endOf(R) {
    const end = playStartOf(R) + (R.time || NO_TIME_CAP_S) * 1000;
    return R.endedAt ? Math.min(end, R.endedAt) : end;
  }
  function boardOf(room, R, name) {
    const b = room && room.boards && room.boards[name];
    return b && Number(b.round) === R.id ? b : null;
  }
  const isOut = (room, R, name) => !!(boardOf(room, R, name) || {}).out;
  // 対戦の「ここまで」で、のこりが1人（ひとりであそぶ回は0人）になった時刻。まだなら null
  function battleOverAt(room, R) {
    if (!isOutMode(R)) return null;
    const alive = R.players.filter((name) => !isOut(room, R, name)).length;
    if (alive > (R.players.length >= 2 ? 1 : 0)) return null;
    return Math.max(0, ...R.players.map((name) => Number((boardOf(room, R, name) || {}).outAt) || 0));
  }
  // ホストが切れたルームの期限。ふだんは切れてから2分。あそんでいる回は、時間で結果が出て2分たつまで、結果は出てから2分たつまでのばす
  function expiryAt(room) {
    const at = RoomkRTDB.getHostDisconnectedAt(room);
    if (!room || room.hostConnected !== false || at == null) return null;
    let until = at + ORPHAN_TTL_MS;
    const R = roundOf(room);
    if (room.status === STATUS.PLAY && R) until = Math.max(until, endOf(R) + FINISH_BACKUP_MS + ORPHAN_TTL_MS);
    if (room.status === STATUS.RESULT && room.result && Number(room.result.at)) until = Math.max(until, Number(room.result.at) + ORPHAN_TTL_MS);
    return until;
  }
  function isExpired(room) {
    // status を持たない room は、削除後に onDisconnect が発火して再生成されたゴースト
    if (!!room && !room.status) return true;
    const until = expiryAt(room);
    return until != null && RoomkRTDB.now() >= until;
  }
  async function removeExpired(ref, fallback) {
    try {
      // 手元には反映しない（applyLocally:false）。消えたルームを古い値で表示し直さないため
      await ref.transaction((room) => {
        const current = room || fallback;
        return current && isExpired(current) ? null : undefined;
      }, undefined, false);
    } catch (error) {
      console.warn('[iro-tsunagi] expired room cleanup failed', error);
    }
  }
  // transaction の最初の計算が空のキャッシュで走らないよう、先に値を購読しておく
  function warmRoomCache(ref) {
    return new Promise((resolve, reject) => {
      const callback = (snap) => resolve({ snap, release: () => ref.off('value', callback) });
      ref.on('value', callback, reject);
    });
  }
  // 送信後に通信が切れて中止された transaction は、やり直す（届いていたかは中で確かめる）
  async function transactRetry(ref, update) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await ref.transaction(update);
      } catch (error) {
        if (!error || error.message !== 'disconnect' || attempt >= TX_RETRY_MAX) throw error;
      }
    }
  }
  async function waitAuth() {
    try { await authReady; return true; } catch (e) { toast('うまくつながらなかったよ。ページを読み直してね'); return false; }
  }

  // ---------- 再接続の記録 ----------
  function saveSession() {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ role: state.role, nickname: state.nickname, roomCode: state.roomCode, uid: currentUid(), joinedAt: state.joinedAt }));
    } catch (e) { /* 保存できないときは、再読み込みで戻れないだけ */ }
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) { /* 何もしない */ }
  }

  // ---------- ルームへの出入り ----------
  function cleanupRoom() {
    clearInterval(state.timerInterval);
    clearTimeout(state.orphanTimer);
    clearTimeout(state.watchTimer);
    stopRun();
    if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
    if (state.connectedRef && state.connectedCallback) state.connectedRef.off('value', state.connectedCallback);
    if (state.roomRef && (state.role === 'host' || state.role === 'guest')) RoomkRTDB.cancelRoomOnDisconnect(state.roomRef);
    Object.assign(state, {
      role: null, nickname: null, roomCode: null, roomRef: null, room: null, joinedAt: null,
      timerInterval: null, orphanTimer: null, orphanAt: null, connectedRef: null, connectedCallback: null, roomCallback: null,
      isConnected: false, presenceDirty: false, presenceAt: 0, leaving: false, watchTimer: null,
      playRound: null, playSeed: null, finishing: false,
    });
    state.jamaSeen.clear();
    clearSession();
    $('hostOffOverlay').hidden = true;
    $('btnOpenWatch').hidden = true;
    $('barMe').hidden = true;
    $('barMe').textContent = '';
  }
  function leaveLocally(message, isError = true) {
    cleanupRoom();
    showScreen('top');
    if (message) toast(message, isError);
  }

  function connectToRoom(role, nickname, code, ref, joinedAt) {
    if (state.roomRef) cleanupRoom();
    state.role = role;
    state.nickname = nickname;
    state.roomCode = code;
    state.roomRef = ref;
    state.joinedAt = Number(joinedAt) || RoomkRTDB.now();
    $('roomCodeLabel').textContent = code;
    $('btnLeave').textContent = role === 'host' ? 'ルームを閉じる' : '退出する';
    $('btnOpenWatch').hidden = role !== 'host';
    $('hostOffText').textContent = 'しばらく待っても戻らないときは退出してね。';
    $('btnOverlayLeave').textContent = '退出する';
    saveSession();
    // 参加用のリンク（?room=コード）でひらいたときは、つないだあとにコードをアドレスから外す
    const q = new URLSearchParams(location.search);
    if (q.has('room')) {
      q.delete('room');   // ほかの値（テスト用の test・seed）は残す
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    }

    state.roomCallback = (snap) => {
      if (state.roomRef !== ref || state.leaving) return;
      if (!snap.exists()) { leaveLocally('ルームが閉じられたよ', false); return; }
      const room = snap.val();
      if (isExpired(room)) { removeExpired(ref, room); leaveLocally('このルームは終わったみたい'); return; }
      state.room = room;
      handleRoom(room);
    };
    ref.on('value', state.roomCallback, (error) => {
      console.warn('[iro-tsunagi] room listener failed', error);
      toast('ルームの読み込みに失敗しました');
    });
    state.connectedRef = db.ref('.info/connected');
    state.connectedCallback = (snap) => {
      state.isConnected = snap.val() === true;
      if (state.isConnected && state.roomRef === ref) {
        state.presenceDirty = true;
        ensurePresence(true);
      }
    };
    state.connectedRef.on('value', state.connectedCallback);
    state.timerInterval = setInterval(tickRoom, 500);
  }

  function tickRoom() {
    const room = state.room;
    if (!room) return;
    if (needsPresence(room)) ensurePresence();
    maybeFinishRound(room);
    if (state.currentScreen === 'watch') renderWatch();
  }
  // 接続中なのに、ルームの上では切断・不在になっている
  function needsPresence(room) {
    if (state.role === 'host') return room.hostConnected === false;
    if (state.role === 'guest') return !(room.players && room.players[state.nickname]);
    return false;
  }
  // 接続のたびに切断時の予約を張り直し、自分の在室を確かめる（古い接続の切断予約が遅れて発火した場合も、ここで戻す）
  async function ensurePresence(force = false) {
    const ref = state.roomRef;
    if (!ref || state.leaving || !state.isConnected || !state.room) return;
    if (!force && Date.now() - state.presenceAt < PRESENCE_RETRY_MS) return;
    state.presenceDirty = false;
    state.presenceAt = Date.now();
    const role = state.role;
    const nickname = state.nickname;
    const joinedAt = state.joinedAt;
    const uid = currentUid();
    try {
      if (role === 'host') {
        await ref.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: serverTimestamp() });
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
          if (!room || isExpired(room) || (room.players && room.players[nickname])) return;
          if (nickname === room.host) { taken = true; return; }
          // 戻るときは参加したときの順番のまま。その回の人は人数の上限を見ない
          if (!inRoundOf(room, nickname) && guestCount(room) >= MAX_GUESTS) { full = true; return; }
          return Object.assign({}, room, { players: Object.assign({}, room.players || {}, { [nickname]: { isHost: false, uid, joinedAt } }) });
        });
        if ((full || taken) && state.roomRef === ref && !state.leaving) {
          await RoomkRTDB.cancelRoomOnDisconnect(ref);
          leaveLocally(full ? 'このルームはいっぱいだよ' : '同じ名前の人がいるので、ルームから外れました。名前を変えて入りなおしてね');
        }
      }
    } catch (error) {
      console.warn('[iro-tsunagi] presence recovery failed', error);
      if (force) toast('再接続に失敗しました。ページを読み直してね');
    }
  }

  async function createRoom() {
    if (state.busy || state.roomRef) return;
    const nickname = $('hostName').value.trim();
    const error = validNickname(nickname);
    if (error) { setError('createError', error); return; }
    setError('createError', '');
    state.busy = true;
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
          if (room) return room.hostUid === uid && room.players && room.players[nickname] && room.players[nickname].joinedAt === joinedAt ? room : undefined;
          return {
            status: STATUS.WAITING, host: nickname, hostUid: uid, hostConnected: true, hostDisconnectedAt: null,
            createdAt: serverTimestamp(), lastRoundId: 0, hostPlays: true, settings: Object.assign({}, DEFAULT_SETTINGS),
            players: { [nickname]: { isHost: true, uid, joinedAt } },
          };
        });
        if (result.committed) {
          if (window.RoomkStats) window.RoomkStats.count('room-create');
          connectToRoom('host', nickname, code, ref, joinedAt);
          return;
        }
      }
      setError('createError', 'ルームを作れませんでした。もう一度ためしてね');
    } catch (err) {
      console.warn('[iro-tsunagi] create failed', err);
      setError('createError', '接続できませんでした。もう一度ためしてね');
    } finally {
      state.busy = false;
      $('btnCreateRoom').disabled = false;
    }
  }

  // ルームコード: 日本語入力のまま打った全角の英数字は半角に、小文字は大文字にそろえて読む（打っている間は欄を書き換えない）
  const normalizeRoomCode = (raw) => String(raw || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  function roomCodeImeError(code) {
    return /[^\x00-\x7F]/.test(code)
      ? 'ルームコードはアルファベットと数字で入れてね。ひらがなになるときは、キーボードを英字に切り替えてね（「半角/全角」キー、Macは「英数」キー）'
      : '';
  }

  async function joinRoom() {
    if (state.busy || state.roomRef) return;
    const nickname = $('guestName').value.trim();
    const code = normalizeRoomCode($('joinCode').value);
    const error = validNickname(nickname);
    if (error) { setError('joinError', error); return; }
    const imeError = roomCodeImeError(code);
    if (imeError) { setError('joinError', imeError); return; }
    if (!ROOM_CODE_PATTERN.test(code)) { setError('joinError', 'ルームコードは6文字で入れてね'); return; }
    setError('joinError', '');
    state.busy = true;
    $('btnJoinRoom').disabled = true;
    let release = null;
    try {
      if (!await waitAuth()) return;
      const ref = db.ref(DB_PREFIX + '/' + code);
      const warm = await warmRoomCache(ref);
      release = warm.release;
      const initial = warm.snap.val();
      if (!initial) { setError('joinError', 'ルームが見つからないよ。コードを確かめてね'); return; }
      if (isExpired(initial)) { await removeExpired(ref, initial); setError('joinError', 'このルームは終わったみたい'); return; }
      const uid = currentUid();
      const joinedAt = RoomkRTDB.now();
      let reason = '';
      let rejoinAt = null;
      const result = await transactRetry(ref, (room) => {
        reason = '';
        rejoinAt = null;
        if (!room) { reason = '見つからない'; return; }
        if (isExpired(room)) { reason = '終了'; return; }
        // 送信後の切断のやり直しで、この参加の書き込みがもう届いていたら、そのまま使う。同じ名前の在室が残っていれば入れない
        const stale = room.players && room.players[nickname];
        const mine = !!stale && !stale.isHost && stale.uid === uid && Number(stale.joinedAt) === joinedAt;
        if (nickname === room.host || (stale && !mine)) { reason = '名前'; return; }
        // その回（あそんでいる途中・結果）の人の名前は、その人（同じ匿名ID）が戻るときだけ使える
        const inRound = inRoundOf(room, nickname);
        if (inRound && !mine && room.roundUids && room.roundUids[nickname] && room.roundUids[nickname] !== uid) { reason = '名前'; return; }
        if (mine) rejoinAt = Number(stale.joinedAt) || joinedAt;
        else if (!inRound && guestCount(room) >= MAX_GUESTS) { reason = '満員'; return; }
        return Object.assign({}, room, { players: Object.assign({}, room.players || {}, { [nickname]: { isHost: false, uid, joinedAt: rejoinAt || joinedAt } }) });
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
      console.warn('[iro-tsunagi] join failed', err);
      setError('joinError', '接続できませんでした。もう一度ためしてね');
    } finally {
      if (release) release();
      state.busy = false;
      $('btnJoinRoom').disabled = false;
    }
  }

  async function tryReconnect() {
    const saved = loadSession();
    if (!saved || !saved.roomCode || !saved.nickname || !saved.role) return false;
    if (!ROOM_CODE_PATTERN.test(saved.roomCode) || validNickname(saved.nickname)) return false;
    if (state.busy || state.roomRef) return false;
    state.busy = true;
    const tops = ['btnGoCreate', 'btnGoJoin', 'btnGoSolo', 'btnGoWatch'];
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
        joinedAt = Number(room.players && room.players[saved.nickname] && room.players[saved.nickname].joinedAt) || joinedAt;
      } else if (saved.role === 'guest') {
        if (saved.nickname === room.host) return false;
        const player = room.players && room.players[saved.nickname];
        if (player && (player.isHost || player.uid !== uid)) return false;
        if (room.roundUids && room.roundUids[saved.nickname] && room.roundUids[saved.nickname] !== uid) return false;
        if (player) joinedAt = Number(player.joinedAt) || joinedAt;
      } else {
        return false;
      }
      if (state.roomRef) return false;
      connectToRoom(saved.role, saved.nickname, saved.roomCode, ref, joinedAt);
      return true;
    } catch (error) {
      console.warn('[iro-tsunagi] reconnect failed', error);
      return false;
    } finally {
      if (release) release();
      state.busy = false;
      tops.forEach((id) => { $(id).disabled = false; });
    }
  }

  async function leaveRoom() {
    if (state.role === 'spectator') { leaveWatch(); return; }
    if (state.busy || !state.roomRef) return;
    const ref = state.roomRef;
    const role = state.role;
    const nickname = state.nickname;
    const uid = currentUid();
    if (role === 'host' && !window.confirm('ルームを閉じると、参加している人の画面もトップに戻ります。閉じますか？')) return;
    if (role === 'guest' && run && !run.done && !window.confirm('ルームから出ますか？')) return;
    state.busy = true;
    state.leaving = true;
    // 退出の間に盤を送って、退出で書いた「ここまで」を上書きしないよう、先に止める
    if (role === 'guest') stopRun();
    try {
      await RoomkRTDB.cancelRoomOnDisconnect(ref);
      if (role === 'host') {
        await ref.remove();
      } else {
        // 自分の在室だけを消す。あそんでいる回の盤と点は残す（結果に出る）
        await ref.transaction((room) => {
          if (!room) return;
          const mine = room.players && room.players[nickname];
          if (mine ? mine.uid !== uid : !(room.roundUids && room.roundUids[nickname] === uid)) return;
          const players = Object.assign({}, room.players || {});
          delete players[nickname];
          // 対戦の「ここまで」で回の途中に出たら、その人はここまでにする（のこりの人だけで決着がつくように）
          const R = room.status === STATUS.PLAY ? roundOf(room) : null;
          if (R && isOutMode(R) && R.players.includes(nickname) && !isOut(room, R, nickname)) {
            const b = boardOf(room, R, nickname) || { round: R.id, score: 0 };
            return Object.assign({}, room, { players, boards: Object.assign({}, room.boards || {}, { [nickname]: Object.assign({}, b, { out: true, outAt: RoomkRTDB.now() }) }) });
          }
          if (!mine) return;
          return Object.assign({}, room, { players });
        });
      }
    } catch (error) {
      console.warn('[iro-tsunagi] leave failed', error);
      toast('退出できませんでした。もう一度ためしてね');
      state.leaving = false;
      state.busy = false;
      ensurePresence(true);
      if (state.room) handleRoom(state.room);
      return;
    }
    state.busy = false;
    leaveLocally('');
  }

  // ---------- みんなにみせる画面（見るだけ。ルームに書かない） ----------
  async function enterWatch(code, fromForm = false) {
    if (state.busy || state.roomRef) return false;
    const fail = (message) => (fromForm ? setError('watchError', message) : toast(message));
    state.busy = true;
    $('btnWatchOpen').disabled = true;
    try {
      if (!await waitAuth()) return false;
      const ref = db.ref(DB_PREFIX + '/' + code);
      const room = (await ref.get()).val();
      if (state.roomRef) return false;
      if (!room) { fail('ルームが見つからないよ。コードを確かめてね'); return false; }
      if (isExpired(room)) { fail('このルームは終わったみたい'); return false; }
      connectWatch(code, ref);
      history.replaceState(null, '', location.pathname + '?watch=' + code);
      return true;
    } catch (error) {
      console.warn('[iro-tsunagi] watch failed', error);
      fail('接続できませんでした。もう一度ためしてね');
      return false;
    } finally {
      state.busy = false;
      $('btnWatchOpen').disabled = false;
    }
  }
  function connectWatch(code, ref) {
    state.role = 'spectator';
    document.title = 'みんなにみせる画面 | いろつなぎ | あそびのたな';
    document.body.classList.add('is-watch');
    $('watchBadge').hidden = false;
    state.roomCode = code;
    state.roomRef = ref;
    $('roomCodeLabel').textContent = code;
    $('btnLeave').textContent = 'トップへ戻る';
    $('btnOpenWatch').hidden = true;
    $('hostOffText').textContent = 'しばらく待っても戻らないときは、トップへ戻ってね。';
    $('btnOverlayLeave').textContent = 'トップへ戻る';
    state.roomCallback = (snap) => {
      if (state.roomRef !== ref) return;
      if (!snap.exists()) { endWatch('このルームは閉じられました'); return; }
      const room = snap.val();
      if (isExpired(room)) { endWatch('このルームは終わりました'); return; }
      state.room = room;
      updateWatchOverlay(room);
      renderRoom(room);
    };
    ref.on('value', state.roomCallback, (error) => {
      console.warn('[iro-tsunagi] watch listener failed', error);
      toast('ルームの読み込みに失敗しました');
    });
    state.timerInterval = setInterval(() => { if (state.currentScreen === 'watch') renderWatch(); }, 500);
  }
  function updateWatchOverlay(room) {
    const off = room.hostConnected === false;
    const playing = room.status === STATUS.PLAY && !!roundOf(room);
    $('hostOffOverlay').hidden = !off || playing;
    $('watchHostOff').hidden = !off || !playing;
    clearTimeout(state.watchTimer);
    state.watchTimer = null;
    if (!off) return;
    const until = expiryAt(room);
    if (until == null) return;
    const ref = state.roomRef;
    state.watchTimer = setTimeout(() => {
      state.watchTimer = null;
      if (state.roomRef === ref && state.room && isExpired(state.room)) endWatch('このルームは終わりました');
    }, Math.max(0, until - RoomkRTDB.now()) + 500);
  }
  function stopWatch() {
    clearTimeout(state.watchTimer);
    clearInterval(state.timerInterval);
    if (state.roomRef && state.roomCallback) state.roomRef.off('value', state.roomCallback);
    Object.assign(state, { role: null, roomCode: null, roomRef: null, room: null, roomCallback: null, watchTimer: null, timerInterval: null });
    $('hostOffOverlay').hidden = true;
    document.title = DEFAULT_TITLE;
    document.body.classList.remove('is-watch');
    $('watchBadge').hidden = true;
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

  // ---------- ホストの操作 ----------
  async function hostTransaction(update, failMessage, lock = true) {
    if (state.role !== 'host' || !state.roomRef || (lock && state.busy)) return null;
    if (lock) state.busy = true;
    const uid = currentUid();
    try {
      const result = await state.roomRef.transaction((room) => {
        if (!room || room.hostUid !== uid || isExpired(room)) return;
        return update(room);
      });
      return result.committed;
    } catch (error) {
      console.warn('[iro-tsunagi] host action failed', error);
      toast(failMessage);
      return null;
    } finally {
      if (lock) state.busy = false;
    }
  }
  function readRoomSettings() {
    const mode = radio('roomMode') === 'battle' ? 'battle' : 'score';
    const full = radio('roomFull') === 'clear' ? 'clear' : 'out';
    return { mode, full, time: timeOf(radio('roomTime'), mode, full), speed: SPEED[radio('roomSpeed')] ? radio('roomSpeed') : 'slow', colors: colorsOf(radio('roomColors')) };
  }
  // 対戦では「盤がいっぱいになったら」を出す。時間「なし」は「ここまで」のときだけ
  function applyLobbyFields(s) {
    const battle = s.mode === 'battle';
    const noTime = battle && s.full === 'out';
    $('fsFull').hidden = !battle;
    $('modeNote').textContent = battle
      ? 'れんさをすると、つぎの人の盤にじゃまの玉が落ちる。来るじゃまは、送るぶんで先にへらせる。'
      : '時間内にとった点をくらべる。盤がいっぱいになっても、からにしてつづく。';
    $('timeNone').hidden = !noTime;
    $('timeSeg').classList.toggle('it-seg--4', noTime);
    $('timeSeg').classList.toggle('it-seg--3', !noTime);
    const t = document.querySelector('input[name="roomTime"][value="' + s.time + '"]');
    if (t) t.checked = true;
    const time = s.time ? Math.round(s.time / 60) + '分' : '時間なし';
    $('moreSub').textContent = [battle ? (s.full === 'out' ? 'いっぱいでここまで' : 'からにしてつづける') : null, time, SPEED_LABEL[s.speed], s.colors + '色'].filter(Boolean).join('・');
  }
  // 設定は続けて変えても取りこぼさないよう、二度押しよけのロックを使わない
  function saveSettings() {
    const settings = readRoomSettings();
    applyLobbyFields(settings);
    const hostPlays = $('hostPlays').checked;
    hostTransaction((room) => {
      if (room.status !== STATUS.WAITING) return;
      return Object.assign({}, room, { settings, hostPlays });
    }, '設定を変えられませんでした', false);
  }
  const roundPlayers = (room) => memberNames(room).filter((name) => name !== room.host || room.hostPlays !== false);

  async function startGame() {
    setError('startError', '');
    const room = state.room;
    if (!room || !roundPlayers(room).length) { setError('startError', 'あそぶ人がいないよ'); return; }
    unlockBgm();
    let players = [];
    // 種は transaction の外で1回だけ作る（やり直しのたびに変わると、先に始めた端末だけ別の順番になる）
    const seed = Math.floor(Math.random() * 2 ** 31) + 1;
    const ok = await hostTransaction((current) => {
      if (current.status !== STATUS.WAITING) return;
      players = roundPlayers(current);
      if (!players.length) return;
      const s = settingsOf(current);
      const id = (Number(current.lastRoundId) || 0) + 1;
      const uids = {};
      players.forEach((name) => { if (current.players && current.players[name] && current.players[name].uid) uids[name] = current.players[name].uid; });
      return Object.assign({}, current, {
        status: STATUS.PLAY,
        lastRoundId: id,
        round: { id, seed, startedAt: serverTimestamp(), mode: s.mode, full: s.full, time: s.time, speed: s.speed, colors: s.colors, players },
        roundUids: uids, boards: null, jama: null, result: null,
      });
    }, 'はじめられませんでした。もう一度ためしてね');
    if (ok && window.RoomkStats) {
      window.RoomkStats.count('start');
      window.RoomkStats.count('players-' + players.length);
    }
  }
  async function endEarly() {
    if (state.role !== 'host') return;
    if (!window.confirm('みんなの回をここでおしまいにしますか？')) return;
    const R = roundOf(state.room);
    if (!R) return;
    await hostTransaction((room) => {
      const cur = roundOf(room);
      if (room.status !== STATUS.PLAY || !cur || cur.id !== R.id || cur.endedAt) return;
      return Object.assign({}, room, { round: Object.assign({}, room.round, { endedAt: serverTimestamp() }) });
    }, 'おわれませんでした。もう一度ためしてね');
  }
  // 時間のあと（対戦の「ここまで」は、のこりが1人になったあと）、結果を出す。ホストの端末が出し、裏に回っていても、あそぶ人の端末が少しあとに出す
  function maybeFinishRound(room) {
    if (room.status !== STATUS.PLAY || state.finishing) return;
    const R = roundOf(room);
    if (!R) return;
    const host = state.role === 'host';
    if (!host && !(state.role === 'guest' && R.players.includes(state.nickname))) return;
    const now = RoomkRTDB.now();
    const overAt = battleOverAt(room, R);
    const timeUp = now >= endOf(R) + (host ? FINISH_GRACE_MS : FINISH_BACKUP_MS);
    const settled = overAt != null && now >= overAt + (host ? BATTLE_END_MS : FINISH_BACKUP_MS);
    if (!timeUp && !settled) return;
    state.finishing = true;
    let finished = false;
    state.roomRef.transaction((current) => {
      finished = false;
      if (!current || isExpired(current) || current.status !== STATUS.PLAY) return;
      const cur = roundOf(current);
      if (!cur || cur.id !== R.id) return;
      const num = (v) => Math.max(0, Number(v) || 0);
      const rows = cur.players.map((name) => {
        const b = boardOf(current, cur, name) || {};
        return { name, score: num(b.score), bestChain: num(b.bestChain), sent: num(b.sent), clears: num(b.clears), allClears: num(b.allClears), out: b.out === true, outAt: num(b.outAt) };
      });
      finished = true;
      return Object.assign({}, current, { status: STATUS.RESULT, result: { id: cur.id, mode: cur.mode, full: cur.full, rows, at: serverTimestamp() }, jama: null });
    }).then(() => {
      if (finished && window.RoomkStats) window.RoomkStats.count('finish');
    }).catch((error) => {
      console.warn('[iro-tsunagi] finish failed', error);
    }).finally(() => {
      state.finishing = false;
    });
  }
  async function playAgain() {
    const ok = await hostTransaction((room) => {
      if (room.status !== STATUS.RESULT) return;
      return Object.assign({}, room, { status: STATUS.WAITING, round: null, roundUids: null, boards: null, jama: null, result: null });
    }, 'もどれませんでした。もう一度ためしてね');
    if (ok && window.RoomkStats) window.RoomkStats.count('again');
  }

  // ---------- ルームの表示 ----------
  function handleRoom(room) {
    if (state.role === 'guest') {
      const me = room.players && room.players[state.nickname];
      if (me && me.uid !== currentUid()) { leaveLocally('同じ名前の人が参加したので、ルームから外れました'); return; }
    }
    if (state.presenceDirty) ensurePresence(true);
    else if (needsPresence(room)) ensurePresence();
    updateHostOverlay(room);
    renderRoom(room);
  }
  function updateHostOverlay(room) {
    const off = state.role === 'guest' && room.hostConnected === false;
    // あそんでいる間はオーバーレイで盤をかくさない（時間で結果が出るので、ホストがいなくても続けられる）
    const playing = room.status === STATUS.PLAY && !!run;
    $('hostOffOverlay').hidden = !off || playing;
    $('playHostOff').hidden = !off || !playing;
    if (off) {
      // 期限が変わったとき（回が進んだ・切れた時刻が新しくなった）だけ仕掛けなおす
      const until = expiryAt(room);
      const at = until == null ? RoomkRTDB.now() + ORPHAN_TTL_MS : until;
      if (state.orphanTimer && state.orphanAt === at) return;
      clearTimeout(state.orphanTimer);
      state.orphanAt = at;
      const ref = state.roomRef;
      state.orphanTimer = setTimeout(() => {
        state.orphanTimer = null;
        state.orphanAt = null;
        if (state.roomRef === ref && state.room) removeExpired(ref, state.room);
      }, Math.max(0, at - RoomkRTDB.now()) + 500);
    } else {
      clearTimeout(state.orphanTimer);
      state.orphanTimer = null;
      state.orphanAt = null;
    }
  }
  function renderRoom(room) {
    const R = roundOf(room);
    const playing = room.status === STATUS.PLAY && !!R;
    const isPlayer = playing && (state.role === 'host' || state.role === 'guest') && R.players.includes(state.nickname);
    if (room.status === STATUS.RESULT && room.result) {
      if (run) stopRun();
      if (state.currentScreen !== 'result') showScreen('result');
      renderRoomResult(room);
    } else if (isPlayer) {
      syncRun(room, R);
    } else if (playing && (state.role === 'spectator' || state.role === 'host')) {
      if (run) stopRun();
      if (state.currentScreen !== 'watch') showScreen('watch');
      $('btnWatchEnd').hidden = state.role !== 'host';
      $('btnWatchLeave').hidden = state.role !== 'spectator';
      renderWatch();
    } else {
      if (run) stopRun();
      if (state.currentScreen !== 'waiting') showScreen('waiting');
      renderWaiting(room, playing);
    }
    let me = '';
    if (state.role === 'host') me = 'ホスト（' + state.nickname + '）';
    else if (state.role === 'guest') me = state.nickname;
    $('barMe').hidden = !me;
    $('barMe').textContent = me;
  }
  function renderWaiting(room, playing) {
    const host = state.role === 'host';
    const spectator = state.role === 'spectator';
    const s = settingsOf(room);
    $('lobbyJoin').hidden = !spectator;
    $('lobbySound').hidden = spectator;
    $('lobbyJoinCode').textContent = state.roomCode || '';
    const ul = $('lobbyPeople');
    ul.replaceChildren();
    memberNames(room).forEach((name) => {
      const li = document.createElement('li');
      li.append(msIcon(name === room.host ? 'star' : 'person'), makeElement('span', null, name + (name === state.nickname ? '（自分）' : '')));
      if (name === room.host && room.hostPlays === false) li.append(makeElement('span', 'it-tag', 'あそぶ人の盤を見る'));
      ul.append(li);
    });
    $('lobbyLate').hidden = !playing;
    $('lobbyHost').hidden = !host || playing;
    $('startBar').hidden = !host || playing;
    $('lobbyWait').hidden = host || spectator || playing;
    $('lobbySettings').hidden = host && !playing;
    $('lobbySettings').textContent = 'いまの設定: ' + settingsText(s);
    if (host && !playing) {
      document.querySelector('input[name="roomMode"][value="' + s.mode + '"]').checked = true;
      document.querySelector('input[name="roomFull"][value="' + s.full + '"]').checked = true;
      document.querySelector('input[name="roomSpeed"][value="' + s.speed + '"]').checked = true;
      document.querySelector('input[name="roomColors"][value="' + s.colors + '"]').checked = true;
      applyLobbyFields(s);
      $('hostPlays').checked = room.hostPlays !== false;
    }
  }
  // 順位のくらべ方。点をくらべる: 点 / 対戦（からにしてつづける）: 送ったじゃま / 対戦（ここまで）: のこった人が上（その中は送ったじゃま）、ここまでの人はあとまでのこった人が上
  function rankKey(r, mode, full) {
    if (mode !== 'battle') return [r.score];
    if (full === 'clear') return [r.sent];
    return r.out ? [0, r.outAt] : [1, r.sent];
  }
  function renderRoomResult(room) {
    const res = room.result || {};
    const mode = res.mode === 'battle' ? 'battle' : 'score';
    const full = res.full === 'clear' ? 'clear' : 'out';
    const num = (v) => Math.max(0, Number(v) || 0);
    const rows = (Array.isArray(res.rows) ? res.rows : []).map((r) => ({
      name: String((r && r.name) || ''), score: num(r && r.score), bestChain: num(r && r.bestChain), sent: num(r && r.sent),
      clears: num(r && r.clears), allClears: num(r && r.allClears), out: !!(r && r.out === true), outAt: num(r && r.outAt),
    }));
    const keyed = rows.map((r) => ({ r, k: rankKey(r, mode, full) }));
    const cmp = (a, b) => {
      for (let i = 0; i < Math.max(a.k.length, b.k.length); i++) if ((b.k[i] || 0) !== (a.k[i] || 0)) return (b.k[i] || 0) - (a.k[i] || 0);
      return 0;
    };
    keyed.sort(cmp);
    const ol = makeElement('ol', 'it-rank');
    let rank = 0;
    keyed.forEach((x, i) => {
      const r = x.r;
      if (i === 0 || cmp(keyed[i - 1], x) !== 0) rank = i + 1;
      const li = document.createElement('li');
      if (r.name === state.nickname) li.classList.add('is-me');
      const who = makeElement('span', 'it-rank__who');
      const sub = [];
      if (mode === 'battle' && full === 'out') sub.push(r.out ? 'ここまで' : 'のこった');
      if (mode === 'battle') sub.push(r.score + '点');
      sub.push('最高れんさ ' + r.bestChain);
      if (!(mode === 'battle' && full === 'out')) sub.push('からにした ' + r.clears + '回');
      sub.push('全部消した ' + r.allClears + '回');
      who.append(makeElement('span', 'it-rank__name', r.name), makeElement('span', 'it-rank__sub', sub.join('・')));
      const main = mode === 'battle' ? '送った ' + r.sent + 'こ' : r.score + '点';
      li.append(makeElement('span', 'it-rank__no', rank + '位'), who, makeElement('span', 'it-rank__main', main));
      ol.append(li);
    });
    $('endTitle').textContent = 'おしまい';
    $('resultBody').replaceChildren(ol);
    const host = state.role === 'host';
    $('btnAgain').hidden = !host;
    $('btnTop').hidden = true;
    $('resultWait').hidden = host || state.role === 'spectator';
  }

  // ---------- ほかの人の盤（あそぶ画面の右・スマホは一覧）・みんなにみせる画面 ----------
  function drawMini(canvas, text, cellPx, dim) {
    const dpr = window.devicePixelRatio || 1;
    const w = cellPx * E.W;
    const h = cellPx * E.H;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    const k = canvas.getContext('2d');
    k.setTransform(dpr, 0, 0, dpr, 0, 0);
    k.fillStyle = '#FFF8EC';
    k.fillRect(0, 0, w, h);
    const b = E.unpackBoard(text);
    if (b) {
      for (let y = 0; y < E.H; y++) for (let x = 0; x < E.W; x++) {
        const v = E.get(b, x, y);
        if (v) ball(k, v, x * cellPx + cellPx / 2, y * cellPx + cellPx / 2, cellPx * 0.44, undefined, cellPx < 14);
      }
    }
    if (dim) { k.fillStyle = 'rgba(255,255,255,.55)'; k.fillRect(0, 0, w, h); }
  }
  function otherInfo(room, R, name) {
    const b = boardOf(room, R, name) || {};
    const present = name === room.host ? room.hostConnected !== false : !!(room.players && room.players[name]);
    const bits = [];
    if (isBattle(R)) {
      if (b.out) bits.push('ここまで');
      bits.push('送った ' + (Number(b.sent) || 0) + 'こ');
      if (Number(b.pending) > 0) bits.push('来る ' + Number(b.pending) + 'こ');
    } else {
      bits.push((Number(b.score) || 0) + '点');
    }
    if (!present) bits.push('いまはいない');
    return { b, text: bits.join('・'), dim: !present || !!b.out };
  }
  function renderOthers() {
    const room = state.room;
    const R = room && roundOf(room);
    const box = $('others');
    const list = $('othersList');
    if (!run || run.solo || !R) { box.hidden = true; list.hidden = true; return; }
    const names = R.players.filter((n) => n !== state.nickname);
    if (!names.length) { box.hidden = true; list.hidden = true; return; }
    const wide = window.innerWidth > 1000;
    box.hidden = !wide;
    list.hidden = wide;
    if (wide) {
      const keep = {};
      [...box.children].forEach((el) => { keep[el.dataset.name] = el; });
      box.replaceChildren(...names.map((name) => {
        const el = keep[name] || (() => {
          const d = makeElement('div', 'it-other');
          d.dataset.name = name;
          d.append(makeElement('p', 'it-other__name', name), document.createElement('canvas'), makeElement('p', 'it-other__info'));
          return d;
        })();
        const info = otherInfo(room, R, name);
        el.querySelector('.it-other__info').textContent = info.text;
        el.classList.toggle('is-dim', info.dim);
        drawMini(el.querySelector('canvas'), info.b.b, names.length > 4 ? 8 : 11, info.dim);
        return el;
      }));
    } else {
      list.replaceChildren(...names.map((name) => {
        const info = otherInfo(room, R, name);
        const li = makeElement('li', info.dim ? 'is-dim' : null);
        li.dataset.name = name;
        li.append(makeElement('span', 'it-otherlist__name', name), makeElement('span', 'it-otherlist__info', info.text));
        return li;
      }));
    }
  }
  function renderWatch() {
    const room = state.room;
    const R = room && roundOf(room);
    if (!R || room.status !== STATUS.PLAY) return;
    const now = RoomkRTDB.now();
    const t = now - playStartOf(R);
    $('watchTimer').textContent = t < 0 ? 'まもなくはじまるよ' : (R.time ? 'のこり ' + fmtTime(endOf(R) - now) : '');
    const grid = $('watchGrid');
    const n = Math.max(1, R.players.length);
    const cols = Math.min(n, window.innerWidth < 700 ? 2 : (n <= 4 ? n : Math.ceil(n / 2)));
    const rows = Math.ceil(n / cols);
    const cell = Math.max(10, Math.min(36, Math.floor((window.innerWidth - 40 - cols * 24) / cols / E.W), Math.floor((window.innerHeight - 140 - rows * 60) / rows / E.H)));
    const keep = {};
    [...grid.children].forEach((el) => { keep[el.dataset.name] = el; });
    grid.style.gridTemplateColumns = 'repeat(' + cols + ', auto)';
    grid.replaceChildren(...R.players.map((name) => {
      const el = keep[name] || (() => {
        const d = makeElement('div', 'it-wboard');
        d.dataset.name = name;
        d.append(makeElement('p', 'it-wboard__name', name), document.createElement('canvas'), makeElement('p', 'it-wboard__info'));
        return d;
      })();
      const info = otherInfo(room, R, name);
      el.querySelector('.it-wboard__info').textContent = info.text;
      el.classList.toggle('is-dim', info.dim);
      drawMini(el.querySelector('canvas'), info.b.b, cell, info.dim);
      return el;
    }));
  }

  // ---------- 大きさ ----------
  const boardC = $('board');
  const ctx = boardC.getContext('2d');
  let cell = 40;
  let topPx = 20;
  function fit() {
    const narrow = window.innerWidth <= 700;
    const pad = document.querySelector('.it-pad');
    // 操作ボタンが出るときは、その下に右下の丸ボタン（「？」・フィードバック）の分（80px）をあけ、重ならないようにする
    const padH = pad.offsetHeight ? pad.offsetHeight + 14 + 80 : 0;
    const sideH = narrow ? document.querySelector('.it-side').offsetHeight + 10 : 0;
    const listH = narrow && !$('othersList').hidden ? $('othersList').offsetHeight + 8 : 0;
    const msgH = narrow ? 30 : 0;
    const availH = window.innerHeight - padH - sideH - listH - msgH - (narrow ? 24 : 64);
    const availW = narrow ? window.innerWidth - 40 : 600;
    cell = Math.max(20, Math.min(52, Math.floor(availH / (E.H + 0.5)), Math.floor(availW / E.W)));
    topPx = Math.round(cell * 0.5);
    const dpr = window.devicePixelRatio || 1;
    const w = cell * E.W;
    const h = topPx + cell * E.H;
    boardC.style.width = w + 'px';
    boardC.style.height = h + 'px';
    boardC.width = Math.round(w * dpr);
    boardC.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    [$('next1'), $('next2')].forEach((c) => {
      const r = c.getBoundingClientRect();
      if (!r.width) return;
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    });
    draw();
    drawNext();
  }

  // ---------- 描く ----------
  function markPath(c, kind, x, y, s) {
    c.beginPath();
    if (kind === 'circle') {
      c.arc(x, y, s * 0.8, 0, Math.PI * 2);
    } else if (kind === 'triangle') {
      c.moveTo(x, y - s); c.lineTo(x + s * 0.95, y + s * 0.7); c.lineTo(x - s * 0.95, y + s * 0.7); c.closePath();
    } else if (kind === 'square') {
      c.rect(x - s * 0.72, y - s * 0.72, s * 1.44, s * 1.44);
    } else if (kind === 'diamond') {
      c.moveTo(x, y - s); c.lineTo(x + s * 0.8, y); c.lineTo(x, y + s); c.lineTo(x - s * 0.8, y); c.closePath();
    } else {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? s * 0.45 : s * 1.05;
        const px = x + Math.cos(a) * rr;
        const py = y + Math.sin(a) * rr;
        if (i) c.lineTo(px, py); else c.moveTo(px, py);
      }
      c.closePath();
    }
  }
  function ball(c, color, x, y, r, alpha, simple) {
    const b = BALL[color];
    if (!b) return;
    c.save();
    c.globalAlpha = alpha === undefined ? 1 : alpha;
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = b.fill;
    c.fill();
    if (!simple) {
      c.lineWidth = Math.max(1.5, r * 0.08);
      c.strokeStyle = b.edge;
      c.stroke();
      c.beginPath();
      c.arc(x - r * 0.35, y - r * 0.4, r * 0.22, 0, Math.PI * 2);
      c.fillStyle = 'rgba(255,255,255,.45)';
      c.fill();
    }
    if (b.mark) {
      markPath(c, b.mark, x, y + r * 0.04, r * 0.42);
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.fill();
    } else if (!simple) {
      // じゃまの玉: 小さな点を3つ
      c.fillStyle = 'rgba(255,255,255,.7)';
      [-0.32, 0, 0.32].forEach((dx) => { c.beginPath(); c.arc(x + dx * r, y, r * 0.1, 0, Math.PI * 2); c.fill(); });
    }
    c.restore();
  }
  const cx = (x) => x * cell + cell / 2;
  const cy = (y) => topPx + y * cell + cell / 2;

  // 同じ色がとなり合うと、玉どうしをつないで見せる（じゃまの玉はつながない）
  function bridges(board, skip) {
    const t = cell * 0.5;
    for (let y = 0; y < E.H; y++) {
      for (let x = 0; x < E.W; x++) {
        const v = E.get(board, x, y);
        if (!v || v === E.JAMA || skip[x + ',' + y]) continue;
        ctx.fillStyle = BALL[v].fill;
        if (x + 1 < E.W && E.get(board, x + 1, y) === v && !skip[(x + 1) + ',' + y]) ctx.fillRect(cx(x), cy(y) - t / 2, cell, t);
        if (y + 1 < E.H && E.get(board, x, y + 1) === v && !skip[x + ',' + (y + 1)]) ctx.fillRect(cx(x) - t / 2, cy(y), t, cell);
      }
    }
  }

  function draw() {
    const w = cell * E.W;
    const h = topPx + cell * E.H;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#FFF8EC';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(106, 79, 53, .10)';
    ctx.fillRect(0, 0, w, topPx);
    ctx.strokeStyle = '#EFE2CC';
    ctx.lineWidth = 1;
    for (let x = 1; x < E.W; x++) { ctx.beginPath(); ctx.moveTo(x * cell + 0.5, topPx); ctx.lineTo(x * cell + 0.5, h); ctx.stroke(); }
    for (let y = 1; y < E.H; y++) { ctx.beginPath(); ctx.moveTo(0, topPx + y * cell + 0.5); ctx.lineTo(w, topPx + y * cell + 0.5); ctx.stroke(); }
    if (!g || !run) return;

    // 玉が出る所。ここがふさがると盤がいっぱい（いっぱいのときは赤くぬる）
    ctx.save();
    if (run.mode === 'full' || run.out) {
      ctx.fillStyle = 'rgba(185, 28, 28, .35)';
      ctx.fillRect(2 * cell, topPx, cell, cell);
    }
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(185, 28, 28, .5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx(2), cy(0), cell * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (trail && !reduce.matches) {
      const a = Math.max(0, 1 - trail.t / 220) * 0.35;
      trail.cells.forEach((q) => {
        ctx.fillStyle = BALL[q.c].fill;
        ctx.globalAlpha = a;
        ctx.fillRect(q.x * cell + cell * 0.2, topPx + q.from * cell + cell / 2, cell * 0.6, (q.to - q.from) * cell);
        ctx.globalAlpha = 1;
      });
    }

    const r = cell * 0.44;
    const anim = run.anim;
    const board = anim ? anim.snap : g.board;
    const skip = {};
    let moving = null;
    let popping = null;
    let p = 0;
    if (anim) {
      const st = anim.steps[anim.i];
      p = st.dur ? Math.min(1, anim.t / st.dur) : 1;
      if (st.type === 'fall') {
        moving = st.moved;
        moving.forEach((m) => { skip[m.x + ',' + m.from] = true; });
      } else {
        popping = {};
        st.groups.forEach((gr) => gr.cells.forEach((q) => { popping[q.x + ',' + q.y] = true; }));
      }
    }
    bridges(board, skip);
    for (let y = E.TOP; y < E.H; y++) {
      for (let x = 0; x < E.W; x++) {
        const v = E.get(board, x, y);
        if (!v || skip[x + ',' + y]) continue;
        if (popping && popping[x + ',' + y]) {
          if (reduce.matches) {
            ball(ctx, v, cx(x), cy(y), r);
            ctx.save();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 4;
            ctx.beginPath(); ctx.arc(cx(x), cy(y), r + 1, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          } else {
            const grow = 1 + 0.18 * Math.sin(Math.min(1, p * 1.6) * Math.PI);
            const fade = p < 0.55 ? 1 : 1 - (p - 0.55) / 0.45;
            ball(ctx, v, cx(x), cy(y), r * grow, Math.max(0, fade));
          }
        } else {
          ball(ctx, v, cx(x), cy(y), r);
        }
      }
    }
    if (moving) {
      const ease = p * p;   // 落ちるので、だんだん速く
      moving.forEach((m) => ball(ctx, m.c, cx(m.x), cy(m.from + (m.to - m.from) * ease), r));
    }
    parts.forEach((q) => {
      ctx.globalAlpha = Math.max(0, 1 - q.t / 520);
      ctx.fillStyle = BALL[q.c].fill;
      ctx.beginPath();
      ctx.arc(q.x * cell, topPx + q.y * cell, cell * 0.09, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    if (g.piece && !anim && run.mode === 'play') {
      const gh = E.ghost(g);
      if (gh) {
        gh.forEach((q) => {
          ctx.save();
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = BALL[q.c].edge;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(cx(q.x), cy(q.y), r * 0.8, 0, Math.PI * 2); ctx.stroke();
          ctx.restore();
        });
      }
      E.cells(g.piece).forEach((q) => ball(ctx, q.c, cx(q.x), cy(q.y), r));
    }
  }
  function drawNext() {
    [$('next1'), $('next2')].forEach((c, i) => {
      const pair = g && g.queue[i];
      const k = c.getContext('2d');
      const rect = c.getBoundingClientRect();
      k.clearRect(0, 0, rect.width, rect.height);
      if (!pair) return;
      const rr = Math.min(rect.width * 0.42, rect.height * 0.23);
      ball(k, pair[1], rect.width / 2, rect.height / 2 - rr * 1.08, rr);
      ball(k, pair[0], rect.width / 2, rect.height / 2 + rr * 1.08, rr);
    });
  }
  function hud() {
    if (!run) return;
    $('score').textContent = String(run.battle ? run.sent : run.shownScore);
    $('best').textContent = String(run.shownBest);
    $('jama').textContent = String(run.pending);
    $('jamaBox').classList.toggle('is-coming', run.pending > 0);
    if (run.limit) $('timer').textContent = fmtTime(run.limit - Math.max(0, run.t()));
  }
  let msgTimer = 0;
  function message(text) {
    const el = $('chainText');
    el.textContent = text;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), MSG_MS);
  }
  function showOverlay(text, resumable) {
    $('overlayText').textContent = text;
    $('btnResume').hidden = !resumable;
    $('overlay').hidden = false;
  }
  function hideOverlay() { $('overlay').hidden = true; }

  // ---------- あそぶ（ひとり・ルーム共通） ----------
  // o: { solo, seed, colors, speed, full: 'clear'|'end', limit(ms・0はなし), startAt(ルームの時刻), battle, saved, pending, sent, outAt }
  function startRun(o) {
    stopRun();
    g = o.saved ? E.restoreGame({ colors: o.colors, seed: o.seed }, o.saved) : E.newGame({ colors: o.colors, seed: o.seed });
    run = {
      solo: !!o.solo, speed: SPEED[o.speed] || SPEED.slow, full: o.full, limit: o.limit || 0, startAt: o.startAt || 0,
      elapsed: 0, battle: !!o.battle, pending: Math.max(0, Math.min(999, Number(o.pending) || 0)), sent: Math.max(0, Number(o.sent) || 0),
      outAt: Number(o.outAt) || null, out: false, done: false, paused: false,
      mode: 'play', fallAcc: 0, lockWait: null, resets: 0, anim: null, fullT: 0, shownScore: g.score, shownBest: g.bestChain, lastChain: 0,
    };
    run.t = run.solo ? () => run.elapsed : () => RoomkRTDB.now() - run.startAt;
    parts = [];
    trail = null;
    softHeld = false;
    stopRepeat();
    hideOverlay();
    $('chainText').classList.remove('show');
    $('timerBox').hidden = !run.limit;
    $('scoreLabel').textContent = run.battle ? '送ったじゃま' : '点';
    $('jamaBox').hidden = !run.battle;
    $('btnPause').hidden = !run.solo;
    $('btnPause').textContent = 'とめる';
    $('keysPause').hidden = !run.solo;
    $('btnQuit').textContent = run.solo ? 'おわる' : state.role === 'host' ? '早めにおわる' : '退出する';
    showScreen('play');
    E.spawn(g);
    // ルームのカウントダウンは、最初の描画を待たずに出す
    const t0 = run.t();
    $('countdown').hidden = t0 >= 0;
    if (t0 < 0) $('countdown').textContent = String(Math.min(3, Math.ceil(-t0 / 1000)));
    renderOthers();
    fit();
    window.requestAnimationFrame(fit);
    hud();
    rewindBgm();
  }
  function stopRun() {
    if (!run) return;
    run = null;
    stopRepeat();
    softHeld = false;
    $('countdown').hidden = true;
    hideOverlay();
    syncBgm();
  }

  function startSolo() {
    state.role = 'solo';
    setSfx(radio('sfx') === 'on');
    setBgm(radio('bgm') === 'on');
    unlockBgm();
    startRun({
      solo: true, seed: Number(params.get('seed')) || Date.now(), colors: Number(radio('colors')) || 4,
      speed: radio('speed') || 'slow', full: radio('full') === 'end' ? 'end' : 'clear', limit: (Number(radio('time')) || 0) * 1000,
    });
    if (window.RoomkStats) window.RoomkStats.count('solo-start');
  }

  // ルームの値から、あそんでいる回を始める・時計を合わせる・じゃまを受けとる
  function syncRun(room, R) {
    if (state.playRound !== R.id || state.playSeed !== R.seed || !run) {
      state.playRound = R.id;
      state.playSeed = R.seed;
      state.jamaSeen.clear();
      const mine = boardOf(room, R, state.nickname);
      startRun({
        seed: R.seed, colors: R.colors, speed: R.speed, full: isOutMode(R) ? 'end' : 'clear',
        limit: R.time ? endOf(R) - playStartOf(R) : 0, startAt: playStartOf(R), battle: isBattle(R),
        saved: mine && (Number(mine.taken) || mine.out) ? mine : null,
        pending: mine ? Number(mine.pending) || 0 : 0, sent: mine ? Number(mine.sent) || 0 : 0, outAt: mine ? Number(mine.outAt) || null : null,
      });
      if (!R.time) run.cap = endOf(R) - playStartOf(R);
      if (mine && (mine.out || mine.done)) markDone(mine.out ? 'out' : 'time');
    } else {
      run.startAt = playStartOf(R);
      if (R.time) run.limit = endOf(R) - playStartOf(R);
      else run.cap = endOf(R) - playStartOf(R);
    }
    receiveJama(room, R);
    renderOthers();
    updateHostOverlay(room);
  }

  function grounded() {
    return g.piece && !E.fits(g.board, Object.assign({}, g.piece, { y: g.piece.y + 1 }));
  }
  function active() {
    return run && !run.done && !run.paused && run.t() >= 0;
  }

  function act(name) {
    if (!active() || run.mode !== 'play' || !g.piece) return false;
    let ok = false;
    if (name === 'left' || name === 'right') {
      ok = E.move(g, name === 'left' ? -1 : 1);
      if (ok) play('move');
    } else if (name === 'rotL' || name === 'rotR') {
      const now = performance.now();
      ok = E.rotate(g, name === 'rotL' ? -1 : 1, now - lastRotFail < FLIP_MS);
      if (ok) { play('rotate'); lastRotFail = -1e9; } else lastRotFail = now;
    } else if (name === 'down') {
      ok = E.down(g);
      if (ok) { run.fallAcc = 0; run.lockWait = null; }
    } else if (name === 'drop') {
      const before = E.cells(g.piece);
      E.hardDropRows(g);
      const after = E.cells(g.piece);
      trail = { cells: before.map((q, i) => ({ x: q.x, from: q.y, to: after[i].y, c: q.c })), t: 0 };
      play('drop');
      doLock(true);
      return true;
    }
    if (ok && run.lockWait !== null && name !== 'down' && run.resets < MAX_RESETS) {
      run.lockWait = grounded() ? 0 : null;
      run.resets++;
    }
    draw();
    return ok;
  }

  function stepDurations(steps) {
    steps.forEach((st) => {
      if (st.type === 'fall') {
        const dist = st.moved.reduce((m, q) => Math.max(m, q.to - q.from), 0);
        st.dur = reduce.matches ? 0 : Math.min(320, 70 + dist * 35);
      } else {
        st.dur = reduce.matches ? 380 : 440;
      }
    });
    return steps;
  }

  function doLock(dropped) {
    E.lock(g);
    if (!dropped) play('place');
    const snap = g.board.map((row) => row.slice());   // 置いた直後の盤。ここから順に落とす・消すを見せる
    const res = E.settle(g);
    run.lockWait = null;
    run.resets = 0;
    run.fallAcc = 0;
    run.lastChain = res.chain;
    if (run.battle && res.attack > 0) attack(res.attack);
    if (!res.steps.length) { afterSettle(false); return; }
    run.anim = { snap, steps: stepDurations(res.steps), i: 0, t: 0, allClear: res.allClear };
    run.mode = 'anim';
    beginStep();
  }

  // 対戦: 送るじゃま。来るじゃまがあれば先にへらし、のこりをつぎの人に送る（盤といっしょの1回の update で）
  function attack(n) {
    const cancel = Math.min(run.pending, n);
    run.pending -= cancel;
    n -= cancel;
    const to = n > 0 ? jamaTarget() : null;
    let outgoing = null;
    if (to) {
      run.sent += n;
      outgoing = { ['jama/' + to + '/' + state.roomRef.child('jama/' + to).push().key]: { round: state.playRound, n, from: state.nickname } };
    }
    const words = [];
    if (to) words.push(to + 'に' + n + 'こおくったよ');
    else if (cancel > 0) words.push('来るじゃまを' + cancel + 'こへらしたよ');
    if (words.length) setTimeout(() => { if (run) message(words.join(' ')); }, 450);
    sendBoard(outgoing);
    hud();
  }
  // 並びで自分のつぎの、のこっている人（対戦で「ここまで」になった人はとばす）
  function nextAlive(room, R, name) {
    const i = R.players.indexOf(name);
    if (i < 0) return null;
    for (let k = 1; k < R.players.length; k++) {
      const to = R.players[(i + k) % R.players.length];
      if (!isOut(room, R, to)) return to;
    }
    return null;
  }
  function jamaTarget() {
    const R = roundOf(state.room);
    if (!R || !state.roomRef || R.players.length < 2) return null;
    return nextAlive(state.room, R, state.nickname);
  }
  function receiveJama(room, R) {
    if (!run || !run.battle || run.done) return;
    // 自分あてのほか、「ここまで」になった人あてに届いたじゃまのうち、その人のつぎののこっている人が自分のものも受けとる
    const owners = [state.nickname];
    if (isOutMode(R)) R.players.forEach((name) => { if (name !== state.nickname && isOut(room, R, name) && nextAlive(room, R, name) === state.nickname) owners.push(name); });
    let added = 0;
    const done = {};
    owners.forEach((owner) => {
      const box = room.jama && room.jama[owner];
      if (!box || typeof box !== 'object') return;
      Object.entries(box).forEach(([key, v]) => {
        if (state.jamaSeen.has(key)) return;
        state.jamaSeen.add(key);
        if (v && Number(v.round) === R.id) added += Math.max(0, Math.min(999, Number(v.n) || 0));
        done['jama/' + owner + '/' + key] = null;
      });
    });
    if (!Object.keys(done).length) return;
    run.pending = Math.min(run.pending + added, 999);
    // 来るじゃまの数を自分の盤の記録に書くのと、受けとったじゃまを消すのを同じ1回の update にする
    done['boards/' + state.nickname + '/pending'] = run.pending;
    done['boards/' + state.nickname + '/round'] = R.id;
    const keys = Object.keys(done).filter((k) => k.startsWith('jama/')).map((k) => k.split('/').pop());
    const r0 = run;
    state.roomRef.update(done).catch((error) => {
      console.warn('[iro-tsunagi] jama receive failed', error);
      keys.forEach((k) => state.jamaSeen.delete(k));
      if (run === r0) { run.pending = Math.max(0, run.pending - added); hud(); }
    });
    if (added > 0) {
      const el = $('jamaBox');
      el.classList.remove('is-bump');
      void el.offsetWidth;
      el.classList.add('is-bump');
    }
    hud();
  }

  function beginStep() {
    const st = run.anim.steps[run.anim.i];
    if (st.type !== 'pop') return;
    playChain(st.chain);
    // 最高れんさは、消える動きで見せたれんさまでを出す（先に最後のれんさの数を出さない）
    if (st.chain > run.shownBest) { run.shownBest = st.chain; hud(); }
    if (st.chain >= 2) message(st.chain + 'れんさ！');
  }
  function burst(groups) {
    if (reduce.matches) return;
    groups.forEach((gr) => gr.cells.forEach((q) => {
      for (let i = 0; i < 5; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 2 + Math.random() * 3;
        parts.push({ x: q.x + 0.5, y: q.y + 0.5, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, c: gr.c, t: 0 });
      }
    }));
  }
  function endStep() {
    const anim = run.anim;
    const st = anim.steps[anim.i];
    if (st.type === 'fall') {
      st.moved.forEach((m) => E.set(anim.snap, m.x, m.from, 0));
      st.moved.forEach((m) => E.set(anim.snap, m.x, m.to, m.c));
    } else {
      st.groups.forEach((gr) => gr.cells.forEach((q) => E.set(anim.snap, q.x, q.y, 0)));
      burst(st.groups);
      run.shownScore += st.points;
      hud();
    }
    anim.i++;
    anim.t = 0;
    if (anim.i < anim.steps.length) { beginStep(); return; }
    run.anim = null;
    if (anim.allClear) { message('全部消えた！'); play('allclear', 1, 0.15); }
    afterSettle(!!anim.jamaDrop);
  }

  // 落とす・消すがおわったあと: 対戦で来るじゃまがあり、いま消さなかったら落とす → つぎの組を出す
  function afterSettle(afterJama) {
    run.shownScore = g.score;
    run.shownBest = g.bestChain;
    if (run.battle && !afterJama && run.pending > 0 && run.lastChain === 0) {
      const n = Math.min(run.pending, E.JAMA_MAX);
      run.pending -= n;
      const snap = g.board.map((row) => row.slice());
      const r = E.addJama(g, n, Math.random);
      hud();
      if (r.moved.length) {
        run.anim = { snap, steps: stepDurations([{ type: 'fall', moved: r.moved }]), i: 0, t: 0, jamaDrop: true };
        run.mode = 'anim';
        return;
      }
    }
    hud();
    if (E.spawn(g)) {
      run.mode = 'play';
      sendBoard();
      drawNext();
      draw();
      return;
    }
    full();
  }

  // 盤がいっぱい（出る所がふさがった）
  function full() {
    softHeld = false;
    stopRepeat();
    if (run.full === 'end') {
      // ひとり「おしまい」・対戦「ここまで」
      run.out = true;
      draw();
      if (run.solo) { finishSolo('おしまい'); return; }
      markDone('out');
      return;
    }
    run.mode = 'full';
    run.fullT = 0;
    showOverlay('盤がいっぱい。\nからにしてつづけるよ', false);
    draw();
  }

  // ルームで、自分の回がおわった（時間・ここまで）。盤を送って、結果を待つ
  function markDone(reason) {
    if (!run || run.done) return;
    run.done = true;
    run.mode = 'end';
    if (reason === 'out') {
      run.out = true;
      run.outAt = run.outAt || RoomkRTDB.now();
      showOverlay('ここまで！\nのこりの人の盤を見て待とう', false);
    } else {
      play('finish');
      showOverlay('時間になったよ\n結果を待っているよ', false);
    }
    sendBoard(null, true);
    syncBgm();
    draw();
  }

  // 置くたびに、自分の盤と続きに要るもの（読み込み直し用）を送る。extra（対戦で送るじゃま）があれば同じ update に入れる
  function sendBoard(extra, done) {
    if (!run || run.solo || !state.roomRef || !state.playRound || state.leaving) return;
    const board = {
      round: state.playRound,
      b: E.packBoard(g.board),
      score: g.score, bestChain: g.bestChain, pops: g.pops, clears: g.clears, allClears: g.allClears,
      taken: g.taken - (g.piece ? 1 : 0),   // 落ちている途中の組は、読み込み直したら出しなおす
      sent: run.sent, pending: run.pending,
      done: !!(done || run.done),
      out: !!run.out,
      outAt: run.out ? (run.outAt = run.outAt || RoomkRTDB.now()) : null,
    };
    state.roomRef.update(Object.assign({ ['boards/' + state.nickname]: board }, extra || {}))
      .catch((error) => console.warn('[iro-tsunagi] board send failed', error));
  }

  function finishSolo(title) {
    if (!run) return;
    const r = run;
    stopRun();
    play('finish');
    if (window.RoomkStats) window.RoomkStats.count('solo-finish');
    $('endTitle').textContent = title;
    const dl = makeElement('dl', 'it-end__list');
    const row = (k, v) => { const d = document.createElement('div'); d.append(makeElement('dt', null, k), makeElement('dd', null, v)); dl.append(d); };
    row('点', g.score);
    row('最高れんさ', g.bestChain);
    row('消した玉', g.pops);
    row('全部消した', g.allClears + '回');
    if (r.full === 'clear') row('からにした', g.clears + '回');
    $('resultBody').replaceChildren(dl);
    $('btnAgain').hidden = false;
    $('btnTop').hidden = false;
    $('resultWait').hidden = true;
    showScreen('result');
  }

  function setPaused(v) {
    if (!run || !run.solo || run.done || (run.mode !== 'play' && run.mode !== 'anim')) return;
    run.paused = v;
    softHeld = false;
    stopRepeat();
    if (v) showOverlay('とめています', true);
    else hideOverlay();
    $('btnPause').textContent = v ? 'つづける' : 'とめる';
    syncBgm();
  }

  // 「あそびかた」などが開いているあいだは、キーで動かさない（ひとりなら、開いたらとめる）
  const modalOpen = () => !!document.querySelector('.howto-modal.show, [aria-modal="true"].show');

  function tick(ts) {
    const dt = last ? Math.min(100, ts - last) : 0;
    last = ts;
    if (run && run.solo && !run.paused && (run.mode === 'play' || run.mode === 'anim') && modalOpen()) setPaused(true);
    if (run && !run.paused) {
      if (run.solo && !run.done) run.elapsed += dt;
      const t = run.t();
      // カウントダウン（ルームだけ）
      const cd = $('countdown');
      if (t < 0) {
        const n = String(Math.min(3, Math.ceil(-t / 1000)));
        if (cd.hidden || cd.textContent !== n) { cd.hidden = false; cd.textContent = n; }
      } else if (!cd.hidden) {
        cd.hidden = true;
      }
      if (t >= 0 && !run.done) {
        if ((run.limit && t >= run.limit) || (run.cap && t >= run.cap)) {
          if (run.solo) finishSolo('時間になったよ');
          else markDone('time');
        } else {
          stepGame(dt);
        }
      }
      if (run) {
        if (run.limit && t >= 0) hud();
        if (trail) { trail.t += dt; if (trail.t > 220) trail = null; }
        if (parts.length) {
          const k = dt / 1000;
          parts.forEach((q) => { q.t += dt; q.x += q.vx * k; q.y += q.vy * k; q.vy += 9 * k; });
          parts = parts.filter((q) => q.t < 520);
        }
        draw();
      }
    }
    syncBgm();
    window.requestAnimationFrame(tick);
  }

  function stepGame(dt) {
    if (run.mode === 'play' && g.piece) {
      run.fallAcc += dt;
      const interval = softHeld ? SOFT_MS : run.speed;
      while (run.fallAcc >= interval) {
        run.fallAcc -= interval;
        if (E.down(g)) run.lockWait = null;
        else { run.fallAcc = 0; break; }
      }
      if (grounded()) {
        run.lockWait = (run.lockWait === null ? 0 : run.lockWait + dt);
        if (run.lockWait >= LOCK_MS) doLock(false);
      } else {
        run.lockWait = null;
      }
    } else if (run.mode === 'anim' && run.anim) {
      run.anim.t += dt;
      if (run.anim.t >= run.anim.steps[run.anim.i].dur) endStep();
    } else if (run.mode === 'full') {
      run.fullT += dt;
      if (run.fullT >= FULL_MS) {
        E.clearBoard(g);
        hideOverlay();
        if (E.spawn(g)) { run.mode = 'play'; drawNext(); }
        sendBoard();
      }
    }
  }

  // ---------- 押しっぱなし（左右）: はじめに1マス、DAS_MS 待って、ARR_MS ごとに1マス ----------
  let repDir = null;
  let repWait = 0;
  let repInt = 0;
  function startRepeat(name) {
    stopRepeat();
    repDir = name;
    act(name);
    repWait = setTimeout(() => { repInt = setInterval(() => act(name), ARR_MS); }, DAS_MS);
  }
  function stopRepeat(name) {
    if (name && repDir !== name) return;
    clearTimeout(repWait);
    clearInterval(repInt);
    repDir = null;
  }

  // ---------- キーボード ----------
  const KEYS = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowUp: 'rotR', w: 'rotR', W: 'rotR', x: 'rotR', X: 'rotR',
    z: 'rotL', Z: 'rotL',
    ' ': 'drop',
    p: 'pause', P: 'pause', Escape: 'pause',
  };
  const playingScreen = () => state.currentScreen === 'play' && !modalOpen();
  document.addEventListener('keydown', (e) => {
    const name = KEYS[e.key];
    if (!name || !playingScreen()) return;
    e.preventDefault();
    if (e.repeat) return;   // くり返しは自分で数える（OS のくり返しの速さにたよらない）
    if (name === 'left' || name === 'right') startRepeat(name);
    else if (name === 'down') { softHeld = true; act('down'); }
    else if (name === 'pause') { if (run && run.solo) setPaused(!run.paused); }
    else act(name);
  });
  document.addEventListener('keyup', (e) => {
    const name = KEYS[e.key];
    if (name === 'left' || name === 'right') stopRepeat(name);
    else if (name === 'down') softHeld = false;
  });
  window.addEventListener('blur', () => { stopRepeat(); softHeld = false; });

  // ---------- 操作ボタン ----------
  document.querySelectorAll('.it-pad__btn').forEach((btn) => {
    const name = btn.dataset.act;
    const stop = () => {
      if (name === 'left' || name === 'right') stopRepeat(name);
      if (name === 'down') softHeld = false;
    };
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (name === 'left' || name === 'right') startRepeat(name);
      else if (name === 'down') { softHeld = true; act('down'); }
      else act(name);
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => btn.addEventListener(ev, stop));
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  // ---------- ボタン ----------
  function submitOnEnter(input, fn) {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); fn(); } });
  }
  document.querySelectorAll('[data-go-top]').forEach((b) => b.addEventListener('click', () => {
    if (state.role === 'solo') state.role = null;
    showScreen('top');
  }));
  $('btnGoSolo').addEventListener('click', () => showScreen('solo'));
  $('btnGoCreate').addEventListener('click', () => { setError('createError', ''); showScreen('create'); $('hostName').focus({ preventScroll: true }); });
  $('btnGoJoin').addEventListener('click', () => { setError('joinError', ''); $('joinLinkHint').hidden = true; showScreen('join'); $('guestName').focus({ preventScroll: true }); });
  $('btnGoWatch').addEventListener('click', () => { setError('watchError', ''); showScreen('watch-join'); $('watchCode').focus({ preventScroll: true }); });
  $('btnStart').addEventListener('click', startSolo);
  $('btnCreateRoom').addEventListener('click', createRoom);
  submitOnEnter($('hostName'), createRoom);
  $('btnJoinRoom').addEventListener('click', joinRoom);
  submitOnEnter($('guestName'), () => $('joinCode').focus());
  submitOnEnter($('joinCode'), joinRoom);
  function openWatchFromForm() {
    const code = normalizeRoomCode($('watchCode').value);
    const imeError = roomCodeImeError(code);
    if (imeError) { setError('watchError', imeError); return; }
    if (!ROOM_CODE_PATTERN.test(code)) { setError('watchError', 'ルームコードは6文字で入れてね'); return; }
    setError('watchError', '');
    enterWatch(code, true);
  }
  $('btnWatchOpen').addEventListener('click', openWatchFromForm);
  submitOnEnter($('watchCode'), openWatchFromForm);
  $('btnCopyCode').addEventListener('click', (event) => RoomkRTDB.copyRoomCode(state.roomCode, event.currentTarget));
  $('btnCopyLink').addEventListener('click', (event) => {
    if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) { toast('ルームコードがありません'); return; }
    RoomkRTDB.copyRoomLink(state.roomCode, event.currentTarget);
  });
  // 別の端末（スマホ・タブレット）で入る人向けに、参加用のリンクを QR コードで大きく出す
  $('btnShowQr').addEventListener('click', () => {
    if (!state.roomCode || !ROOM_CODE_PATTERN.test(state.roomCode)) { toast('ルームコードがありません'); return; }
    RoomkQR.show(state.roomCode);
  });
  $('btnOpenWatch').addEventListener('click', () => {
    if (state.role !== 'host' || !state.roomCode) return;
    window.open(location.pathname + '?watch=' + state.roomCode, '_blank', 'noopener');
  });
  $('btnLeave').addEventListener('click', leaveRoom);
  $('btnOverlayLeave').addEventListener('click', leaveRoom);
  $('lobbyHost').addEventListener('change', saveSettings);
  $('btnStartGame').addEventListener('click', startGame);
  $('btnWatchEnd').addEventListener('click', endEarly);
  $('btnWatchLeave').addEventListener('click', leaveWatch);
  document.querySelectorAll('input[name="roomSfx"], input[name="sfx"]').forEach((el) => el.addEventListener('change', () => setSfx(el.value === 'on')));
  document.querySelectorAll('input[name="roomBgm"], input[name="bgm"]').forEach((el) => el.addEventListener('change', () => setBgm(el.value === 'on')));
  $('btnQuit').addEventListener('click', () => {
    if (!run) return;
    if (run.solo) { if (!run.done) finishSolo('おしまい'); return; }
    if (state.role === 'host') endEarly();
    else if (state.role === 'guest') leaveRoom();
  });
  $('btnPause').addEventListener('click', () => { if (run) setPaused(!run.paused); });
  $('btnResume').addEventListener('click', () => setPaused(false));
  $('btnAgain').addEventListener('click', () => {
    if (state.role === 'solo' || !state.roomRef) startSolo();
    else if (state.role === 'host') playAgain();
  });
  $('btnTop').addEventListener('click', () => { state.role = null; g = null; showScreen('top'); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
  window.addEventListener('resize', () => {
    if (state.currentScreen === 'play') { renderOthers(); fit(); }
    if (state.currentScreen === 'watch') renderWatch();
  });
  // 何か押したときに、音楽を流せるようにしておく（ルームでは、回のはじまりがホストの操作のため）
  document.addEventListener('pointerdown', unlockBgm, true);
  document.addEventListener('keydown', unlockBgm, true);
  syncSfxInputs();
  syncBgmInputs();

  // ---------- 入口（?watch= → ?room= → 保存した記録） ----------
  function openJoinFromLink(code) {
    setError('joinError', '');
    $('joinCode').value = code;
    $('joinLinkHint').hidden = false;
    showScreen('join');
    $('guestName').focus({ preventScroll: true });
  }
  function resumeFromSession() {
    if (!loadSession()) return;
    tryReconnect().then((ok) => { if (!ok && !state.roomRef) clearSession(); });
  }
  const watchParam = params.get('watch');
  const roomParam = params.get('room');
  if (watchParam !== null) {
    clearSession();
    const watchCode = normalizeRoomCode(watchParam);
    if (ROOM_CODE_PATTERN.test(watchCode)) {
      enterWatch(watchCode).then((ok) => { if (!ok) history.replaceState(null, '', location.pathname); });
    } else {
      toast('ルームコードが正しくないよ');
      history.replaceState(null, '', location.pathname);
    }
  } else if (roomParam !== null) {
    const linkCode = normalizeRoomCode(roomParam);
    const saved = loadSession();
    if (!ROOM_CODE_PATTERN.test(linkCode)) {
      toast('ルームコードが正しくないよ');
      history.replaceState(null, '', location.pathname);
      resumeFromSession();
    } else if (saved && saved.roomCode === linkCode) {
      tryReconnect().then((ok) => {
        if (ok || state.roomRef) return;
        clearSession();
        openJoinFromLink(linkCode);
      });
    } else {
      if (saved) clearSession();
      openJoinFromLink(linkCode);
    }
  } else {
    resumeFromSession();
  }

  // テスト用（?test=1 のときだけ）。画面からは使わない
  if (params.has('test')) {
    window.__iro = {
      state: () => ({
        screen: state.currentScreen, role: state.role, code: state.roomCode,
        mode: run ? run.mode : (state.currentScreen === 'result' ? 'end' : 'idle'), paused: !!(run && run.paused), done: !!(run && run.done),
        piece: g && g.piece && Object.assign({}, g.piece), board: g && g.board.map((r) => r.slice()),
        score: g && g.score, bestChain: g && g.bestChain, clears: g && g.clears, allClears: g && g.allClears, taken: g && g.taken,
        pending: run ? run.pending : 0, sent: run ? run.sent : 0, out: !!(run && run.out),
        timeLeft: run && run.limit ? run.limit - run.t() : 0, t: run ? run.t() : null, startAt: run ? run.startAt : null, now: RoomkRTDB.now(), sfxLoaded: Object.keys(sfx.buf), bgmEl: !!bgm.el, bgmPlaying: !!(bgm.el && !bgm.el.paused),
      }),
      setTimeLeft: (ms) => { if (run && run.solo) run.elapsed = run.limit - ms; },
      addPending: (n) => { if (run) { run.pending += n; hud(); } },
      setBoard: (rows) => { if (g) { g.board = rows.map((r) => r.slice()); draw(); } },
      setPiece: (a, b) => { if (g && g.piece) { g.piece.a = a; g.piece.b = b; draw(); } },
    };
  }

  window.requestAnimationFrame(tick);
})();
