/* キャリアすごろく — 通信（Realtime Database）
 *
 * ルームの形と「だれが押せるか」の決まりは room.js（CS_ROOM）。ここは読み書きだけを受け持つ。
 * 初期化・サーバー時刻・ルームコード・onDisconnect の取り消しは共通の RoomkRTDB（rtdb-utils.js）を使う。
 * パスは careersugoroku_rooms/{code}（ルールはワイルドカードのため変更なし）。
 *
 * ?emu=1 のときはローカルのエミュレーター（127.0.0.1）だけに接続する（自動テスト用。本番には接続しない）。
 *   ポートは ?db=9100&auth=9199 で変えられる。
 *
 * ゲームの操作は、ルーム全体の transaction でエンジン（CS_ENGINE.apply）に通してから書く。だれが押せるか
 * （本人の番か進行役か）と、画面で見ていた状態のしるし（stamp）も同じ transaction で確かめる。
 */
(function (root) {
  'use strict';
  const E = root.CS_ENGINE;
  const RM = root.CS_ROOM;
  const R = root.RoomkRTDB;
  const ROOMS = 'careersugoroku_rooms';
  const S = RM.STATUS;

  const params = new URLSearchParams(root.location.search);
  const EMU = params.get('emu') === '1';
  let db = null;
  let authReady = null;
  let watching = null;
  const armed = { code: null, dev: null, host: false };

  function init() {
    const fb = root.firebase;
    if (!fb || typeof fb.initializeApp !== 'function') throw new Error('firebase sdk missing');
    if (EMU) {
      const dbPort = Number(params.get('db')) || 9100;
      const authPort = Number(params.get('auth')) || 9199;
      fb.initializeApp({ apiKey: 'demo-key', authDomain: 'demo-career.firebaseapp.com', databaseURL: 'https://demo-career-default-rtdb.firebaseio.com', projectId: 'demo-career' });
      fb.auth().useEmulator('http://127.0.0.1:' + authPort);
      db = fb.database();
      db.useEmulator('127.0.0.1', dbPort);
      authReady = fb.auth().signInAnonymously().catch((err) => {
        console.error('[auth] anonymous sign-in failed', err);
        throw err;
      });
      R.initServerTime(db);
    } else {
      // 共通の初期化（設定・匿名認証・サーバー時刻の補正）
      const r = R.initFirebase(fb);
      db = r.db;
      authReady = r.authReady;
    }
    db.ref('.info/connected').on('value', (snap) => {
      const on = snap.val() === true;
      if (on && armed.code) armPresence().then((r) => { if (typeof api.onRearm === 'function') api.onRearm(r); }).catch(() => {});
      if (typeof api.onConnection === 'function') api.onConnection(on);
    });
  }

  const now = () => R.now();
  // 匿名認証が失敗していたら、次の操作のときに試し直す（ページを読み込み直さなくても回復できるように）
  function ensureAuth() {
    authReady = authReady.catch(() => root.firebase.auth().signInAnonymously());
    return authReady;
  }
  const TS = () => root.firebase.database.ServerValue.TIMESTAMP;
  const roomRef = (code) => db.ref(ROOMS + '/' + code);

  function randomId(prefix) {
    const a = new Uint32Array(3);
    root.crypto.getRandomValues(a);
    return prefix + Array.from(a).map((x) => x.toString(36)).join('').slice(0, 12);
  }
  function randomSeed() {
    const a = new Uint32Array(1);
    root.crypto.getRandomValues(a);
    return a[0] || 1;
  }
  const validCode = (code) => typeof code === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(code);
  const isExpired = (room) => RM.isExpired(room, now());

  async function removeIfExpired(code) {
    const ref = roomRef(code);
    let pre = null;
    try { pre = (await ref.get()).val(); } catch (_) { /* transaction に任せる */ }
    try {
      await ref.transaction((cur) => {
        const c = cur || pre;
        if (!c) return null;
        return isExpired(c) ? null : undefined;
      });
    } catch (_) { /* 掃除は失敗しても進行に影響しない */ }
  }

  // その場所の値を一度読み込んでキャッシュしてから fn を実行する（transaction の最初の実行が
  // 空のキャッシュを「削除済み」と取り違えないように）
  async function withCache(ref, fn) {
    let cb = null;
    await new Promise((resolve) => { cb = () => resolve(); ref.on('value', cb, () => resolve()); });
    try { return await fn(); } finally { ref.off('value', cb); }
  }

  // ルーム全体の transaction。update(room) は { room: 書き込む値 } か { reason: 中止の理由 } を返す。
  // 確かめることと書くことを同時に確定する（削除・同時の入室と競合しても、削除後に一部だけのルームを作らない）。
  // 削除済み（null）・不完全なルームには書かない
  async function transactRoom(code, update) {
    await ensureAuth();
    const ref = roomRef(code);
    return withCache(ref, async () => {
      for (let attempt = 0; ; attempt++) {
        let reason = null;
        let res;
        try {
          res = await ref.transaction((room) => {
            reason = null;
            if (!room) { reason = 'none'; return undefined; }
            if (!RM.complete(room)) { reason = 'expired'; return undefined; } // ゴースト
            const r = update(room);
            if (!r.room) { reason = r.reason || 'value'; return undefined; }
            return r.room;
          }, undefined, false);
        } catch (err) {
          // 同じ端末がルームの中に書き込むと（答え・在室・退出など）、送信前の transaction は 'set' で中止される。
          // 送信したあとに通信が切れると 'disconnect' で中止される（書き込みが届いたかは分からない）。
          // どちらも値を読み直してやり直す。update は、前の書き込みが届いていれば成功として扱う
          const m = err && err.message;
          if ((m === 'set' || m === 'disconnect') && attempt < 4) continue;
          throw err;
        }
        return res.committed ? { ok: true, room: res.snapshot.val() } : { ok: false, reason: reason || 'conflict' };
      }
    });
  }

  // ── 作成・参加 ─────────────────────────────────────
  // ルームは「進行役の切断中」として作り、進行役の在室の登録（armPresence）で接続中にする。
  // 作った直後に進行役の端末がいなくなっても、待合室の期限（2分）で期限切れとして片付く
  async function createRoom(opts) {
    await ensureAuth();
    const dev = randomId('d');
    const name = RM.cleanName(opts.name);
    const seats = opts.plays ? { [dev]: { name, dev, no: 1, at: now() } } : {};
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = R.generateRoomCode();
      const initial = {
        meta: { v: 2, createdAt: TS(), hostId: dev, hostName: name, hostConnected: false, hostDisconnectedAt: TS(), dice: opts.dice === 1 ? 1 : 2, labels: opts.labels === 'age' ? 'age' : 'school', gameNo: 0, seatSeq: opts.plays ? 1 : 0 },
        status: S.WAITING,
        seats,
      };
      if (await createOnce(code, dev, initial)) return { code, dev };
    }
    throw new Error('code');
  }
  // 空きコードの確保。送信後に通信が切れても（'disconnect'）やり直し、自分が作ったルーム（同じ hostId）が
  // 届いていれば成功とする。ほかのルームが使っているコードなら false
  async function createOnce(code, dev, initial) {
    const ref = roomRef(code);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await ref.transaction((cur) => {
          if (!cur) return initial;
          return cur.meta && cur.meta.hostId === dev ? cur : undefined;
        }, undefined, false);
        return res.committed;
      } catch (err) {
        const m = err && err.message;
        if ((m === 'set' || m === 'disconnect') && attempt < 4) continue;
        throw err;
      }
    }
  }

  // 再読み込みのときに読む。通信が止まっていても待ち続けないよう、時間を区切る（'timeout' は一時的な失敗として扱う）
  const READ_TIMEOUT_MS = 8000;
  async function readRoom(code) {
    let timer = null;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), READ_TIMEOUT_MS); });
    try {
      return await Promise.race([
        (async () => { await ensureAuth(); const snap = await roomRef(code).get(); return snap.exists() ? snap.val() : null; })(),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  // 席を足す（本人の参加・端末のない人の追加）。待合室のときだけ。人数の上限と名前の重複も同じ transaction で確かめる
  async function addSeat(code, sid, name, dev) {
    const nm = RM.cleanName(name);
    const r = await transactRoom(code, (room) => {
      if (isExpired(room)) return { reason: 'expired' };
      const seats = room.seats || {};
      if (seats[sid] && seats[sid].name === nm && seats[sid].dev === dev) return { room }; // やり直しで、前の書き込みが届いていた
      if (room.status !== S.WAITING) return { reason: 'started' };
      if (RM.nameError(nm)) return { reason: 'name' };
      if (RM.nameTaken(room, nm)) return { reason: 'nameTaken' };
      if (Object.keys(seats).length >= RM.MAX_SEATS) return { reason: 'full' };
      const no = (Number(room.meta.seatSeq) || 0) + 1;
      const meta = Object.assign({}, room.meta, { seatSeq: no });
      return { room: Object.assign({}, room, { meta, seats: Object.assign({}, seats, { [sid]: { name: nm, dev, no, at: now() } }) }) };
    });
    if (!r.ok && r.reason === 'expired') await removeIfExpired(code);
    return r;
  }
  async function joinRoom(code, name) {
    const dev = randomId('d');
    const r = await addSeat(code, dev, name, dev);
    return r.ok ? { dev } : { error: r.reason };
  }
  // 端末のない人を追加する（進行役）。その人の番は進行役が押す
  async function addProxy(code, name) {
    const r = await addSeat(code, randomId('x'), name, '');
    return r.ok ? { ok: true } : { error: r.reason };
  }
  // 待合室で席を外す（本人の退出・進行役が端末のない人を外す）
  async function removeSeat(code, sid) {
    return transactRoom(code, (room) => {
      if (room.status !== S.WAITING) return { reason: 'started' };
      if (!room.seats || !room.seats[sid]) return { room }; // もういない
      const seats = Object.assign({}, room.seats);
      delete seats[sid];
      return { room: Object.assign({}, room, { seats }) };
    });
  }

  // ── ゲーム ─────────────────────────────────────────
  // 始める（待合室から）・同じメンバーでもう一度（結果から）。進行役だけ
  async function startGame(code, dev) {
    const seed = randomSeed();
    return transactRoom(code, (room) => {
      if (!RM.isHost(room, dev)) return { reason: 'host' };
      if (isExpired(room)) return { reason: 'expired' };
      const again = room.status === S.FINISHED;
      if (room.status !== S.WAITING && !again) return { reason: 'started' };
      const list = RM.seatList(room);
      if (!list.length) return { reason: 'empty' };
      const order = list.map((s) => s.sid);
      const game = E.newGame({ names: list.map((s) => s.name), labels: room.meta.labels, dice: room.meta.dice, seed });
      const meta = Object.assign({}, room.meta, { gameNo: (Number(room.meta.gameNo) || 0) + 1, startedAt: now() });
      return { room: Object.assign({}, room, { meta, status: S.PLAYING, order, game: JSON.stringify(game), answers: null }) };
    });
  }

  // ゲームの操作。at は画面で見ていた状態のしるし（RM.stamp）。違えば 'stale'（二度押し・古い画面）で中止する。
  // 通るたびに game.rev を1増やす（道の選び直しで状態が前にもどっても、しるしは前と同じにならない）
  async function act(code, dev, action, at) {
    return transactRoom(code, (room) => {
      const game = RM.gameOf(room);
      if (!game) return { reason: 'nogame' };
      if (isExpired(room)) return { reason: 'expired' };
      if (!RM.canAct(room, dev, action)) return { reason: 'notYours' };
      if (at != null && RM.stamp(game) !== at) return { reason: 'stale' };
      // ミニゲームの結果は、画面が持っていた答えではなく、この transaction で読んだルームの答えで決める
      const a = action.type === 'mini' ? { type: 'mini', picks: RM.answersOf(room) } : action;
      const r = E.apply(game, a);
      if (!r.ok) return { reason: 'rule' };
      const next = Object.assign({}, r.state, { rev: (Number(game.rev) || 0) + 1 });
      const out = Object.assign({}, room, { game: JSON.stringify(next) });
      if (next.phase === 'results') out.status = S.FINISHED;
      if (a.type === 'mini' || next.phase === 'results') out.answers = null; // ミニゲームが終わった・結果になったら答えを片付ける
      return { room: out };
    });
  }

  // ミニゲームの答え。v が null なら取り消し。key は画面で見ていたミニゲームの番（RM.answerKey）。
  // ルーム全体の transaction で、いまのミニゲームか・入れてよい人か・値が正しいかを確かめてから書く
  // （終わったあと・削除のあとに届いても書かない）
  async function setAnswer(code, dev, key, pid, v) {
    return transactRoom(code, (room) => {
      if (isExpired(room)) return { reason: 'expired' };
      const game = RM.gameOf(room);
      if (!game || room.status !== S.PLAYING || !game.step || game.step.kind !== 'mini') return { reason: 'notMini' };
      if (RM.answerKey(game) !== key) return { reason: 'stale' };
      if (!RM.canAnswer(room, dev, pid)) return { reason: 'notYours' };
      if (v != null && !RM.validAnswer(game, v)) return { reason: 'value' };
      const cur = (room.answers && room.answers[key]) || {};
      const pk = RM.pidKey(pid);
      const next = Object.assign({}, cur);
      if (v == null) delete next[pk]; else next[pk] = v;
      return { room: Object.assign({}, room, { answers: { [key]: next } }) };
    });
  }

  // ── 在室 ─────────────────────────────────────────
  // 在室の予約（再接続時も呼び直す）。進行役は meta に切断時刻を残す
  // armGen: 登録する相手が変わる（入室・退出）たびに増える。進行中の古い登録は、各 await のあとでこれを見て止まる
  let armGen = 0;
  function setArmed(session) {
    armGen += 1;
    armTries = 0;
    armed.code = session ? session.code : null;
    armed.dev = session ? session.dev : null;
    armed.host = !!(session && session.role === 'host');
  }
  // 登録が例外で終わったとき（同じ端末の書き込みが続いた・競合が続いたなど）のやり直し。入室そのものは済んで
  // いるので画面にはエラーを出さず、間隔をあけて数回まで試す。退出・別のルームへ移ったらやめる
  const REARM_MS = [1000, 2000, 4000, 8000, 16000];
  let armTries = 0;
  function scheduleRearm(code, dev) {
    if (armTries >= REARM_MS.length) return;
    const wait = REARM_MS[armTries];
    armTries += 1;
    const gen = armGen;
    setTimeout(() => {
      if (armGen !== gen || armed.code !== code || armed.dev !== dev) return;
      armPresence().then((r) => { if (typeof api.onRearm === 'function') api.onRearm(r); }).catch(() => {});
    }, wait);
  }
  // 在室の登録と、離れるときの取り消しは、1本の列で順番に行う（lifeChain）。重ねると、失敗した登録の取り消しや
  // 古いルームを離れるときの取り消しが、あとから始めた登録の予約まで消してしまう（取り消しはルーム以下すべてに効く）
  let lifeChain = Promise.resolve();
  function serial(fn) {
    const p = lifeChain.then(fn, fn);
    lifeChain = p.catch(() => {});
    return p;
  }
  // 戻り値 { reason }: none（ルームがない）／expired（期限切れ・壊れたルーム）／gone（席がない＝外された）／retry／moved
  // 同じ入室のあいだは登録を1本にまとめる（つながりなおしと画面の両方から呼ばれても重ねない）。登録中に呼ばれたら、
  // 終わったあとにもう一度だけ登録する。入室し直した（armGen が変わった）ときは、前の列が片付いてから新しく登録する
  let armFlight = null; // { gen, started, promise }
  let armAgain = false;
  function armPresence() {
    const gen = armGen;
    if (armFlight && armFlight.gen === gen) {
      if (armFlight.started) armAgain = true; // 登録の最中 → 終わったあともう一度（始まる前なら、その登録で足りる）
      return armFlight.promise;
    }
    const flight = { gen, started: false, promise: null };
    const promise = serial(async () => {
      if (armGen !== gen) return { reason: 'moved' }; // 待っているあいだに離れた・入り直した
      flight.started = true;
      let r;
      do { armAgain = false; r = await armOnce(); } while (armAgain && armGen === gen);
      return r;
    });
    flight.promise = promise;
    armFlight = flight;
    promise.then(() => { if (armFlight === flight) armFlight = null; }, () => { if (armFlight === flight) armFlight = null; });
    return promise;
  }
  async function armOnce() {
    // 途中で退出・別のルームに移っても古い値で書かないよう、はじめに値を固定する
    const code = armed.code; const dev = armed.dev; const host = armed.host;
    if (!code || !dev) return {};
    const gen = armGen;
    const same = () => armGen === gen && armed.code === code && armed.dev === dev;
    const ref = roomRef(code);
    const metaRef = ref.child('meta');
    const mine = ref.child('presence/' + dev);
    // 先に切断時の予約（進行役は meta に切断時刻を残す）。途中で失敗したら、両方を取り消してからあとでやり直す
    try {
      if (host) await metaRef.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: TS() });
      await mine.onDisconnect().remove();
    } catch (err) {
      if (!same()) return { reason: 'moved' }; // 離れた（取り消しは release がする）
      await disarm(code).catch(() => {});
      if (same()) scheduleRearm(code, dev);
      return { reason: 'retry' };
    }
    if (!same()) return { reason: 'moved' };
    let r;
    try {
      r = await transactRoom(code, (room) => {
        if (!same()) return { reason: 'moved' };
        if (isExpired(room)) return { reason: 'expired' }; // 期限切れのルームは復活させない（共通規約）
        if (host && !RM.isHost(room, dev)) return { reason: 'gone' };
        if (!host && !RM.seatList(room).some((s) => s.dev === dev)) return { reason: 'gone' };
        const next = Object.assign({}, room);
        if (host) next.meta = Object.assign({}, room.meta, { hostConnected: true, hostDisconnectedAt: null });
        next.presence = Object.assign({}, room.presence, { [dev]: true });
        return { room: next };
      });
    } catch (err) {
      if (same()) scheduleRearm(code, dev);
      return { reason: 'retry' };
    }
    if (!r.ok) {
      if (host) await metaRef.onDisconnect().cancel().catch(() => {});
      await mine.onDisconnect().cancel().catch(() => {});
      return { reason: r.reason };
    }
    armTries = 0;
    return {};
  }

  // この接続がルーム以下に予約した onDisconnect（meta の更新・在室の削除）をまとめて取り消す
  async function disarm(code) {
    await R.cancelRoomOnDisconnect(roomRef(code));
  }
  // ルームから離れる（ルームが消えた・期限切れ・外されたときの片付け）。在室の登録をやめ、切断時の予約を取り消す。
  // 予約が残ったままだと、この接続があとで切れたときに meta だけのゴーストを作ってしまう
  // 取り消しは列に並べる: 進行中の登録が終わってから行い、あとから始めた登録（入り直し）はこの取り消しのあとに行う
  function release(code) {
    setArmed(null);
    return serial(async () => { if (code) await disarm(code); });
  }
  // 退出する: 待合室なら席も外す。ゲーム中・結果では席は残し（進行役が代わりに押せる）、在室だけ消す
  async function leaveRoom(session) {
    if (!session) return;
    const code = session.code;
    await release(code);
    try {
      if (session.role !== 'host') await removeSeat(code, session.dev).catch(() => {});
      await roomRef(code).child('presence/' + session.dev).remove();
    } catch (_) { /* ルームが既にない */ }
  }
  async function closeRoom(code) {
    await release(code);
    await roomRef(code).remove();
  }

  function watch(code, onRoom, onGone) {
    unwatch();
    const ref = roomRef(code);
    const cb = (snap) => {
      if (!snap.exists()) { onGone(); return; }
      onRoom(snap.val());
    };
    ref.on('value', cb, (err) => { console.warn('[rtdb] listen error', err); });
    watching = { ref, cb, code };
  }
  function unwatch() {
    if (watching) { watching.ref.off('value', watching.cb); watching = null; }
  }

  const api = {
    init, now, isExpired, removeIfExpired, createRoom, readRoom, joinRoom, addProxy, removeSeat, startGame, act, setAnswer,
    setArmed, armPresence, release, leaveRoom, closeRoom, watch, unwatch, validCode,
    get authReady() { return authReady; },
    EMU, ROOMS,
    onConnection: null,
    onRearm: null,
  };
  root.CS_NET = api;
}(window));
