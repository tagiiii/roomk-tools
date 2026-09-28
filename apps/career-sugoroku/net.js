/* キャリアすごろく — 通信（Realtime Database）
 *
 * 初期化・サーバー時刻・ルームコード・onDisconnect の取り消しは共通の RoomkRTDB（rtdb-utils.js）を使う。
 * パスは careersugoroku_rooms/{code}（ルールはワイルドカードのため変更なし）。
 *
 * ?emu=1 のときはローカルのエミュレーター（127.0.0.1）だけに接続する（自動テスト用。本番には接続しない）。
 *   ポートは ?db=9100&auth=9199 で変えられる。
 *
 * 形: careersugoroku_rooms/{code} = {
 *   meta:       { createdAt, hostId, hostConnected, hostDisconnectedAt }
 *   game:       エンジンの状態（すべての操作は transaction でエンジンに通す）
 *   presence:   { id: true }  つながっている端末（切断で消える）
 *   spectators: { sid: { name, at } }  見学の人（切断で消える）
 *   cursor:     { pid: { k, i } }  確定前の「選択中」の共有（画面共有向け）
 * }
 */
(function (root) {
  'use strict';
  const E = root.CS_ENGINE;
  const R = root.RoomkRTDB;
  const ROOMS = 'careersugoroku_rooms';
  const ORPHAN_TTL_MS = 2 * 60 * 1000; // 待合室: 共通規約の2分
  const ORPHAN_TTL_INGAME_MS = 15 * 60 * 1000; // ゲーム中: 45分の回で一時的な切断を吸収する（別定数。AGENTS.md）
  // 見学の上限（2026-09-28 オーナー決定で20→5）。無料プランの同時接続100本は room-K 全体で共有し、
  // 本体では1タブに利用回数カウンタの接続も加わるため。見学は画面共有を見るだけでも足りる
  const SPECTATOR_CAP = 5;

  const params = new URLSearchParams(root.location.search);
  const EMU = params.get('emu') === '1';
  let db = null;
  let authReady = null;
  let watching = null;
  const armed = { code: null, id: null, role: null, name: null };

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
    return a[0];
  }
  const genCode = () => R.generateRoomCode(); // 紛らわしい文字を除いた6文字
  const validCode = (code) => typeof code === 'string' && /^[A-HJ-NP-Z2-9]{6}$/.test(code);

  // meta と game がそろっているか（そろっていない＝削除後に書き込みや予約だけが残ったゴースト）
  const complete = (room) => !!(room && room.meta && room.game);
  // 壊れたルーム（ゴースト）も期限切れ扱い
  function isExpired(room) {
    if (!complete(room)) return true;
    const m = room.meta;
    const at = Number(m.hostDisconnectedAt);
    if (m.hostConnected === false && Number.isFinite(at)) {
      const ttl = room.game.phase === 'lobby' ? ORPHAN_TTL_MS : ORPHAN_TTL_INGAME_MS;
      return now() - at >= ttl;
    }
    return false;
  }
  function hostDeadline(room) {
    if (!room || !room.meta || room.meta.hostConnected !== false) return null;
    const at = Number(room.meta.hostDisconnectedAt);
    if (!Number.isFinite(at)) return null;
    return at + (room.game && room.game.phase === 'lobby' ? ORPHAN_TTL_MS : ORPHAN_TTL_INGAME_MS);
  }

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

  // ルームは「ホストの切断中」として作り、ホストの在室の登録（armPresence）で接続中にする。
  // 作った直後にホストの端末がいなくなっても、待合室の期限（2分）で期限切れとして片付く
  async function createRoom(name, plays) {
    await ensureAuth();
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = genCode();
      const hostId = randomId('h');
      const game = E.serialize(E.newGame({ hostId, hostName: name, hostPlays: plays, now: now() }));
      const initial = { meta: { v: 1, createdAt: TS(), hostId, hostConnected: false, hostDisconnectedAt: TS() }, game };
      if (await createOnce(code, hostId, initial)) return { code, id: hostId };
    }
    throw new Error('code');
  }
  // 空きコードの確保。送信後に通信が切れても（'disconnect'）やり直し、自分が作ったルーム（同じ hostId）が
  // 届いていれば成功とする。ほかのルームが使っているコードなら false
  async function createOnce(code, hostId, initial) {
    const ref = roomRef(code);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await ref.transaction((cur) => {
          if (!cur) return initial;
          return cur.meta && cur.meta.hostId === hostId ? cur : undefined;
        }, undefined, false);
        return res.committed;
      } catch (err) {
        const m = err && err.message;
        if ((m === 'set' || m === 'disconnect') && attempt < 4) continue;
        throw err;
      }
    }
  }

  async function readRoom(code) {
    await ensureAuth();
    const snap = await roomRef(code).get();
    return snap.exists() ? snap.val() : null;
  }

  // その場所の値を一度読み込んでキャッシュしてから fn を実行する（transaction の最初の実行が
  // 空のキャッシュを「削除済み」と取り違えないように）
  async function withCache(ref, fn) {
    let cb = null;
    await new Promise((resolve) => { cb = () => resolve(); ref.on('value', cb, () => resolve()); });
    try { return await fn(); } finally { ref.off('value', cb); }
  }

  // ルーム全体の transaction。update(room) は { room: 書き込む値 } か { reason: 中止の理由 } を返す。
  // 確かめることと書くことを同時に確定する（削除・同時の入室と競合しても、削除後に一部だけの
  // ルームを作らない。人数の上限・名前の重複も、同時に入ったときまで守る）。
  // 削除済み（null）・不完全なルームには書かない。
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
            // meta か game がない＝ゴースト。期限切れと同じ扱いにし、入室の側で掃除する
            if (!complete(room)) { reason = 'expired'; return undefined; }
            const r = update(room);
            if (!r.room) { reason = r.reason || 'value'; return undefined; }
            return r.room;
          }, undefined, false);
        } catch (err) {
          // 同じ端末がルームの中に書き込むと（選択中の共有・退出など）、送信前の transaction は 'set' で
          // 中止される。送信したあとに通信が切れると 'disconnect' で中止される（書き込みが届いたかは
          // 分からない）。どちらも値を読み直してやり直す。update は、前の書き込みが届いていれば成功として
          // 扱う（退出していれば中止を返す）
          const m = err && err.message;
          if ((m === 'set' || m === 'disconnect') && attempt < 4) continue;
          throw err;
        }
        return res.committed ? { ok: true, room: res.snapshot.val() } : { ok: false, reason: reason || 'conflict' };
      }
    });
  }
  // ルームにいる人の名前（プレイヤー・ホスト・見学の人）
  function roomNames(room) {
    const g = room.game || {};
    return Object.values(g.players || {}).map((p) => p && p.name)
      .concat([g.host && g.host.name], specNames(room))
      .filter(Boolean);
  }
  const specNames = (room) => Object.values(room.spectators || {}).map((s) => s && s.name).filter(Boolean);

  // 名前を使う参加（本人の参加・端末なしの人の追加）は、見学の人の名前もあわせて確かめる。
  // エンジンは見学の人を知らないので、ルーム全体の transaction でエンジンに通す。
  const NAMED = { JOIN: true, ADD_PROXY: true };
  async function dispatchNamed(code, action) {
    const ctx = { now: now(), seed: randomSeed() };
    const name = typeof action.name === 'string' ? action.name.trim() : '';
    const ctrl = action.t === 'JOIN' ? 'self' : 'host';
    const r = await transactRoom(code, (room) => {
      if (isExpired(room)) return { reason: 'expired' };
      // やり直しのとき、前の書き込み（同じ ID・名前・操作方法の人）が届いていれば成功
      const mine = action.pid && room.game.players && room.game.players[action.pid];
      if (mine && mine.name === name && mine.ctrl === ctrl) return { room };
      if (name && specNames(room).includes(name)) return { reason: 'nameTaken' };
      const out = E.apply(room.game, action, ctx);
      if (!out.ok) return { reason: out.reason };
      return { room: Object.assign({}, room, { game: E.serialize(out.game) }) };
    });
    return r.ok ? { ok: true, game: r.room.game } : r;
  }

  // すべての操作はエンジンに通してから書く（ルーム外の乱数・時刻は操作ごとに固定）。
  // transaction の最初の実行はローカルのキャッシュを使うので、購読していないルームでは先に値を
  // 読み込んでから行う。そのうえで null（削除済み）なら中止し、削除後のルームに game だけを
  // 書き戻す「ゴースト」を作らない。
  async function dispatch(code, action) {
    if (action && NAMED[action.t]) return dispatchNamed(code, action);
    await ensureAuth();
    const ref = roomRef(code).child('game');
    return withCache(ref, async () => {
      const ctx = { now: now(), seed: randomSeed() };
      let reason = null;
      const res = await ref.transaction((cur) => {
        if (!cur) { reason = 'gone'; return undefined; }
        const r = E.apply(cur, action, ctx);
        if (!r.ok) { reason = r.reason; return undefined; }
        reason = null;
        return E.serialize(r.game);
      }, undefined, false);
      return res.committed ? { ok: true, game: res.snapshot.val() } : { ok: false, reason: reason || 'conflict' };
    });
  }

  async function joinPlayer(code, name) {
    const pid = randomId('p');
    const r = await dispatch(code, { t: 'JOIN', by: pid, pid, name });
    if (!r.ok) {
      if (r.reason === 'expired') await removeIfExpired(code);
      return { error: r.reason };
    }
    return { id: pid };
  }

  // 見学の入室: ルームがあること・期限・人数・名前を確かめるのと追加を、同じ transaction で行う
  async function joinSpectator(code, name) {
    await ensureAuth();
    const sid = randomId('s');
    const nm = name || '';
    const mine = roomRef(code).child('spectators/' + sid);
    // 書き込みが届いたあとに通信が切れても名前と枠が残らないよう、先に切断時の削除を予約する
    await mine.onDisconnect().remove();
    let r;
    try {
      r = await transactRoom(code, (room) => {
        const specs = room.spectators || {};
        if (isExpired(room)) return { reason: 'expired' };
        if (specs[sid] && specs[sid].name === nm) return { room }; // やり直しのとき、前の書き込みが届いていれば成功
        if (Object.keys(specs).length >= SPECTATOR_CAP) return { reason: 'watchFull' };
        if (nm && roomNames(room).includes(nm)) return { reason: 'nameTaken' };
        return { room: Object.assign({}, room, { spectators: Object.assign({}, specs, { [sid]: { name: nm, at: now() } }) }) };
      });
    } catch (err) {
      // 入れなかった。届いていたかもしれない自分の分を消す（ルームがなければ何も書かれない）
      mine.remove().catch(() => {});
      mine.onDisconnect().cancel().catch(() => {});
      throw err;
    }
    if (!r.ok) {
      await mine.onDisconnect().cancel().catch(() => {});
      if (r.reason === 'expired') await removeIfExpired(code);
      return { error: r.reason };
    }
    return { id: sid };
  }

  // 在室の予約（再接続時も呼び直す）。ホストは meta に切断時刻を残す。
  function setArmed(session) {
    armTries = 0;
    armed.code = session ? session.code : null;
    armed.id = session ? session.id : null;
    armed.role = session ? session.role : null;
    armed.name = session ? session.name : null;
  }
  // 登録が例外で終わったとき（同じ端末の書き込みが続いた・競合が続いた maxretry など）のやり直し。
  // 入室そのものは済んでいるので画面にはエラーを出さず、間隔をあけて数回まで試す。結果は再接続のときと
  // 同じく onRearm に渡す（ホストの締め切りの延長・見学の再登録の結果）。退出・別のルームへ移ったらやめる
  const REARM_MS = [1000, 2000, 4000, 8000, 16000];
  let armTries = 0;
  function scheduleRearm(code, id) {
    if (armTries >= REARM_MS.length) return;
    const wait = REARM_MS[armTries];
    armTries += 1;
    setTimeout(() => {
      if (armed.code !== code || armed.id !== id) return;
      armPresence().then((r) => { if (typeof api.onRearm === 'function') api.onRearm(r); }).catch(() => {});
    }, wait);
  }

  // 戻り値 { away, reason }: away はホストが切断していた時間（ms）。ホストの画面はこれを使って締め切りを延ばす。
  // 登録できなかったときは reason（none: ルームがない／expired: 期限切れ・壊れたルーム／watchFull・nameTaken:
  // 見学の再登録の条件を満たさない／retry: 例外で終わったので、あとでやり直す）
  async function armPresence() {
    // 途中で退出・別のルームに移っても古い値で書かないよう、はじめに値を固定する
    const code = armed.code; const id = armed.id; const role = armed.role; const name = armed.name;
    if (!code || !id) return { away: 0 };
    const same = () => armed.code === code && armed.id === id;
    const ref = roomRef(code);
    const metaRef = ref.child('meta');
    const key = role === 'spectator' ? 'spectators' : 'presence';
    const mine = ref.child(key + '/' + id);
    // 先に切断時の予約（ホストは meta に切断時刻を残す）。書けなかったときは取り消す
    if (role === 'host') await metaRef.onDisconnect().update({ hostConnected: false, hostDisconnectedAt: TS() });
    await mine.onDisconnect().remove();
    // 在室の登録はルーム全体の transaction で行い、削除済み・不完全なルームには書き戻さない
    let away = 0;
    let r;
    try {
      r = await transactRoom(code, (room) => {
        away = 0;
        if (!same()) return { reason: 'moved' };
        if (isExpired(room)) return { reason: 'expired' }; // 期限切れのルームは復活させない（共通規約）
        if (role === 'spectator' && !(room.spectators && room.spectators[id])) {
          // 見学の再登録（再読み込み・切断のあと）も、入室と同じく人数の上限と名前の重複を確かめる
          if (Object.keys(room.spectators || {}).length >= SPECTATOR_CAP) return { reason: 'watchFull' };
          if (name && roomNames(room).includes(name)) return { reason: 'nameTaken' };
        }
        const next = Object.assign({}, room);
        if (role === 'host') {
          const m = room.meta;
          const at = Number(m.hostDisconnectedAt);
          away = m.hostConnected === false && Number.isFinite(at) ? Math.max(0, now() - at) : 0;
          next.meta = Object.assign({}, m, { hostConnected: true, hostDisconnectedAt: null });
        }
        next[key] = Object.assign({}, room[key], { [id]: role === 'spectator' ? { name: name || '', at: now() } : true });
        return { room: next };
      });
    } catch (err) {
      if (same()) scheduleRearm(code, id);
      return { away: 0, reason: 'retry' };
    }
    if (!r.ok) {
      if (role === 'host') await metaRef.onDisconnect().cancel().catch(() => {});
      await mine.onDisconnect().cancel().catch(() => {});
      return { away: 0, reason: r.reason };
    }
    armTries = 0;
    return { away };
  }

  // この接続がルーム以下に予約した onDisconnect（meta の更新・在室/見学の削除）をまとめて取り消す
  async function disarm(code) {
    await R.cancelRoomOnDisconnect(roomRef(code));
  }

  async function leaveRoom(session) {
    if (!session) return;
    const ref = roomRef(session.code);
    const code = session.code;
    setArmed(null);
    await disarm(code);
    try {
      if (session.role === 'spectator') await ref.child('spectators/' + session.id).remove();
      else await ref.child('presence/' + session.id).remove();
      await ref.child('cursor/' + session.id).remove();
    } catch (_) { /* ルームが既にない */ }
  }

  async function closeRoom(code) {
    setArmed(null);
    await disarm(code);
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

  function setCursor(code, pid, key, i, v) {
    if (!code || !pid) return;
    const ref = roomRef(code).child('cursor/' + pid);
    const val = { k: key, i };
    if (v !== undefined) val.v = v;
    (key == null ? ref.remove() : ref.set(val)).catch(() => {});
  }

  const api = {
    init, now, isExpired, hostDeadline, removeIfExpired, createRoom, readRoom, dispatch, joinPlayer, joinSpectator,
    setArmed, armPresence, leaveRoom, closeRoom, watch, unwatch, setCursor, validCode,
    get authReady() { return authReady; },
    EMU, SPECTATOR_CAP, ROOMS,
    onConnection: null,
    onRearm: null,
  };
  root.CS_NET = api;
}(window));
