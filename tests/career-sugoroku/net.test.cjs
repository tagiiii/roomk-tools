// 通信（net.js）のテスト。ネットワークには接続しない。Realtime Database をメモリ上の代役に置き換え、
// transaction は実物と同じく「読んだ値と、書く時点のサーバーの値が同じときだけ確定し、違えば読み直して再実行」する。
// 競合（入室の途中でルームが削除される・同時に入室する・同じ端末の書き込みで中止される）を順番を決めて再現する。
// 実行: node tests/career-sugoroku/net.test.cjs（共通の rtdb-utils.js も同じ代役の上で読み込む）
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = path.resolve(__dirname, '../../apps/career-sugoroku');
const shared = path.resolve(__dirname, '../../apps/shared/js/rtdb-utils.js');
const E = require(path.join(app, 'engine.js'));
const source = fs.readFileSync(path.join(app, 'net.js'), 'utf8');
const sharedSource = fs.readFileSync(shared, 'utf8');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const CODE = 'ABCDEF';
const ROOM = 'careersugoroku_rooms/' + CODE;

function harness(room, opts = {}) {
  const store = { careersugoroku_rooms: room ? { [CODE]: clone(room) } : {} };
  // disconnectBefore: 送信したあと、サーバーに届く前に通信が切れる（書き込まれない）
  // disconnectAfter: サーバーが書き込んだあと、返事の前に通信が切れる（書き込まれている）
  const hooks = { beforeCommit: null, abortOnce: null, throwTimes: 0, throwMessage: 'set', disconnectBefore: 0, disconnectAfter: 0, disconnectAfterAny: 0 };
  const timers = [];
  const keys = (p) => p.split('/').filter(Boolean);
  const getAt = (p) => keys(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), store);
  const prune = (o) => {
    if (!o || typeof o !== 'object') return o;
    Object.keys(o).forEach((k) => { o[k] = prune(o[k]); if (o[k] === null || o[k] === undefined || (typeof o[k] === 'object' && !Object.keys(o[k]).length)) delete o[k]; });
    return o;
  };
  // サーバーの時刻（ServerValue.TIMESTAMP）は、書き込んだ時点の時刻に置き換える（実物と同じ）
  const resolveTs = (v) => {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return Date.now();
      const out = Array.isArray(v) ? [] : {};
      Object.keys(v).forEach((k) => { out[k] = resolveTs(v[k]); });
      return out;
    }
    return v;
  };
  function setAt(p, v) {
    v = resolveTs(v);
    const ks = keys(p);
    let o = store;
    ks.slice(0, -1).forEach((k) => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    if (v === null || v === undefined) delete o[ks[ks.length - 1]];
    else o[ks[ks.length - 1]] = clone(v);
    prune(store);
  }
  const snap = (v) => ({ exists: () => v !== undefined && v !== null, val: () => (v === undefined ? null : clone(v)) });
  let seq = 0;
  let signIns = 0;
  const db = {
    ref(p) {
      return {
        child: (q) => db.ref(p + '/' + q),
        on(ev, cb) { if (!p.startsWith('.info')) Promise.resolve().then(() => cb(snap(getAt(p)))); },
        off() {},
        get: async () => snap(getAt(p)),
        set: async (v) => setAt(p, v),
        remove: async () => setAt(p, null),
        onDisconnect: () => ({ update: async () => {}, remove: async () => {}, cancel: async () => {} }),
        async transaction(fn) {
          const id = ++seq;
          for (let attempt = 0; attempt < 25; attempt++) {
            const base = clone(getAt(p));
            await Promise.resolve();
            if (hooks.beforeCommit) await hooks.beforeCommit({ path: p, id, attempt });
            if (hooks.abortOnce && hooks.abortOnce(p)) { hooks.abortOnce = null; throw new Error('set'); }
            if (hooks.throwTimes > 0 && p === ROOM) { hooks.throwTimes -= 1; throw new Error(hooks.throwMessage); }
            const out = fn(base === undefined ? null : clone(base));
            if (out === undefined) return { committed: false, snapshot: snap(getAt(p)) };
            if (JSON.stringify(getAt(p)) !== JSON.stringify(base)) continue; // 読んだあとに変わった → 再実行
            if (hooks.disconnectBefore > 0 && p === ROOM) { hooks.disconnectBefore -= 1; throw new Error('disconnect'); }
            setAt(p, out);
            if (hooks.disconnectAfter > 0 && p === ROOM) { hooks.disconnectAfter -= 1; throw new Error('disconnect'); }
            if (hooks.disconnectAfterAny > 0 && p.startsWith('careersugoroku_rooms/')) { hooks.disconnectAfterAny -= 1; throw new Error('disconnect'); }
            return { committed: true, snapshot: snap(getAt(p)) };
          }
          throw new Error('maxretry');
        },
      };
    },
  };
  const firebase = {
    initializeApp() {},
    auth: () => ({ signInAnonymously: async () => { signIns += 1; if (opts.authFailOnce && signIns === 1) throw new Error('network'); return {}; }, useEmulator() {} }),
    database: () => db,
  };
  firebase.database.ServerValue = { TIMESTAMP: { '.sv': 'timestamp' } };
  let n = 1000;
  const window = {
    CS_ENGINE: E, location: { search: '' }, firebase,
    crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = n++; return a; } },
  };
  const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  const quiet = { log() {}, warn() {}, error() {}, info() {} };
  const context = vm.createContext({ window, URLSearchParams, console: opts.quiet ? quiet : console, setTimeout });
  vm.runInContext(sharedSource, context); // window.RoomkRTDB（初期化・サーバー時刻・ルームコード・onDisconnect の取り消し）
  vm.runInContext(source, context);
  window.CS_NET.init();
  // 予約されたやり直しを1つずつ実行する
  const runTimer = async () => { const t = timers.shift(); if (t) { t.fn(); for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setImmediate(r)); } return t; };
  return {
    net: window.CS_NET, hooks, timers, runTimer,
    room: () => clone(getAt(ROOM)), setRoom: (v) => setAt(ROOM, v),
    roomAt: (code) => clone(getAt('careersugoroku_rooms/' + code)),
    allRooms: () => clone(getAt('careersugoroku_rooms')) || {},
    signIns: () => signIns,
  };
}

function lobby(spectators = 0, extra = {}) {
  const game = E.serialize(E.newGame({ hostId: 'h', hostName: 'ホスト', hostPlays: false, now: Date.now() }));
  const specs = {};
  for (let i = 0; i < spectators; i++) specs['s' + i] = { name: '見学' + i, at: 1 };
  return Object.assign({ meta: { v: 1, createdAt: 1, hostId: 'h', hostConnected: true }, game, spectators: specs }, extra);
}
const specList = (room) => Object.values((room && room.spectators) || {});

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('spectator join: the room is deleted while joining -> no partial room is left', async () => {
  const h = harness(lobby(0));
  let deleted = false;
  h.hooks.beforeCommit = async ({ path: p }) => { if (p === ROOM && !deleted) { deleted = true; h.setRoom(null); } };
  const r = await h.net.joinSpectator(CODE, '見学テスト');
  assert.equal(r.error, 'none');
  assert.equal(h.room(), undefined, 'nothing is written back after the deletion');
});

test('spectator join: two joins one below the cap -> the cap at most, the second is refused', async () => {
  const cap = harness(null).net.SPECTATOR_CAP;
  assert.equal(cap, 5);
  const h = harness(lobby(cap - 1));
  const rs = await Promise.all([h.net.joinSpectator(CODE, 'あ'), h.net.joinSpectator(CODE, 'い')]);
  assert.equal(rs.filter((r) => r.id).length, 1);
  assert.deepEqual(rs.filter((r) => r.error).map((r) => r.error), ['watchFull']);
  assert.equal(specList(h.room()).length, cap);
});

test('spectator join: same name at the same time -> only one succeeds', async () => {
  const h = harness(lobby(1));
  const rs = await Promise.all([h.net.joinSpectator(CODE, '同時見学'), h.net.joinSpectator(CODE, '同時見学')]);
  assert.equal(rs.filter((r) => r.id).length, 1);
  assert.deepEqual(rs.filter((r) => r.error).map((r) => r.error), ['nameTaken']);
  assert.equal(specList(h.room()).filter((s) => s.name === '同時見学').length, 1);
  // 名前なしの見学は何人でも（既存の仕様）
  const anon = await Promise.all([h.net.joinSpectator(CODE, ''), h.net.joinSpectator(CODE, '')]);
  assert.ok(anon.every((r) => r.id));
});

test('proxy add: a spectator already uses the name -> refused, nothing changes', async () => {
  const h = harness(lobby(0));
  assert.ok((await h.net.joinSpectator(CODE, '同名テスト')).id);
  const before = h.room().game;
  const r = await h.net.dispatch(CODE, { t: 'ADD_PROXY', by: 'h', pid: 'x1', name: '同名テスト' });
  assert.deepEqual([r.ok, r.reason], [false, 'nameTaken']);
  assert.deepEqual(h.room().game, before, 'players and recommended settings unchanged');
  const ok = await h.net.dispatch(CODE, { t: 'ADD_PROXY', by: 'h', pid: 'x2', name: '別の名前' });
  assert.equal(ok.ok, true);
  assert.equal(Object.values(h.room().game.players).length, 1);
});

test('player join: a spectator already uses the name -> refused; spectator after player -> refused', async () => {
  const h = harness(lobby(0));
  assert.ok((await h.net.joinSpectator(CODE, 'みる')).id);
  assert.equal((await h.net.joinPlayer(CODE, 'みる')).error, 'nameTaken');
  assert.ok((await h.net.joinPlayer(CODE, 'あそぶ')).id);
  assert.equal((await h.net.joinSpectator(CODE, 'あそぶ')).error, 'nameTaken');
  assert.equal((await h.net.joinSpectator(CODE, 'ホスト')).error, 'nameTaken');
});

test('player join and spectator join with the same name at the same time -> only one succeeds', async () => {
  for (const order of [0, 1]) {
    const h = harness(lobby(0));
    const calls = [() => h.net.joinPlayer(CODE, 'おなじ'), () => h.net.joinSpectator(CODE, 'おなじ')];
    if (order) calls.reverse();
    const rs = await Promise.all(calls.map((f) => f()));
    assert.equal(rs.filter((r) => r.id).length, 1, 'order ' + order);
    const room = h.room();
    const names = Object.values(room.game.players || {}).map((p) => p.name).concat(specList(room).map((s) => s.name));
    assert.equal(names.filter((x) => x === 'おなじ').length, 1);
  }
});

test('join: no room / expired room', async () => {
  const h = harness(null);
  assert.equal((await h.net.joinSpectator(CODE, 'a')).error, 'none');
  assert.equal((await h.net.joinPlayer(CODE, 'a')).error, 'none');
  assert.equal(h.room(), undefined);
  const old = lobby(0);
  old.meta.hostConnected = false;
  old.meta.hostDisconnectedAt = Date.now() - 3 * 60 * 1000; // 待合室の2分を過ぎた
  const h2 = harness(old);
  assert.equal((await h2.net.joinSpectator(CODE, 'a')).error, 'expired');
  assert.equal(h2.room(), undefined, 'the expired room is cleaned up');
});

test('presence: re-registration after the room was deleted -> no partial room (spectator and player)', async () => {
  for (const role of ['spectator', 'player']) {
    const h = harness(lobby(0));
    h.net.setArmed({ code: CODE, id: role === 'spectator' ? 'sx' : 'px', role, name: 'だれか' });
    let deleted = false;
    h.hooks.beforeCommit = async ({ path: p }) => { if (p === ROOM && !deleted) { deleted = true; h.setRoom(null); } };
    const r = await h.net.armPresence();
    assert.equal(r.reason, 'none', role);
    assert.equal(h.room(), undefined, role + ': nothing is written back');
  }
});

test('presence: spectator re-registration keeps the cap and unique names; own entry is just refreshed', async () => {
  const cap = harness(null).net.SPECTATOR_CAP;
  const h = harness(lobby(cap));
  h.net.setArmed({ code: CODE, id: 'sNew', role: 'spectator', name: 'もどる' });
  assert.equal((await h.net.armPresence()).reason, 'watchFull');
  assert.equal(specList(h.room()).length, cap);
  h.net.setArmed({ code: CODE, id: 's0', role: 'spectator', name: '見学0' });
  const own = await h.net.armPresence();
  assert.equal(own.reason, undefined);
  assert.equal(specList(h.room()).length, cap);
  const h2 = harness(lobby(2));
  h2.net.setArmed({ code: CODE, id: 'sNew', role: 'spectator', name: '見学1' });
  assert.equal((await h2.net.armPresence()).reason, 'nameTaken');
  h2.net.setArmed({ code: CODE, id: 'sNew', role: 'spectator', name: '' });
  assert.equal((await h2.net.armPresence()).reason, undefined);
  assert.equal(specList(h2.room()).length, 3);
});

test('presence: host re-registration marks the host connected and reports the time away', async () => {
  const room = lobby(0);
  room.meta.hostConnected = false;
  room.meta.hostDisconnectedAt = Date.now() - 30000;
  const h = harness(room);
  h.net.setArmed({ code: CODE, id: 'h', role: 'host', name: 'ホスト' });
  const r = await h.net.armPresence();
  assert.ok(r.away >= 29000 && r.away < 60000, 'away ' + r.away);
  const after = h.room();
  assert.equal(after.meta.hostConnected, true);
  assert.equal(after.meta.hostDisconnectedAt, undefined);
  assert.equal(after.presence.h, true);
});

test('room transaction: aborted by a write from the same device (set) -> retried', async () => {
  const h = harness(lobby(0));
  h.hooks.abortOnce = (p) => p === ROOM;
  const r = await h.net.joinSpectator(CODE, 'やりなおし');
  assert.ok(r.id);
  assert.equal(specList(h.room()).length, 1);
});

test('presence: leaving while registering -> the room transaction stops', async () => {
  const h = harness(lobby(0));
  h.net.setArmed({ code: CODE, id: 'px', role: 'player', name: 'p' });
  h.hooks.beforeCommit = async () => { h.net.setArmed(null); };
  const r = await h.net.armPresence();
  assert.equal(r.reason, 'moved');
  assert.equal((h.room().presence || {}).px, undefined);
});

test('join: a partial room (meta only, left by a disconnect after deletion) -> expired and cleaned up', async () => {
  const h = harness(null);
  h.setRoom({ meta: { hostConnected: false, hostDisconnectedAt: 5 } });
  assert.equal((await h.net.joinSpectator(CODE, 'a')).error, 'expired');
  assert.equal(h.room(), undefined, 'the ghost is removed');
  h.setRoom({ spectators: { s9: { name: 'x', at: 1 } } });
  assert.equal((await h.net.joinPlayer(CODE, 'b')).error, 'expired');
  assert.equal(h.room(), undefined);
});

test('presence: writes from the same device keep aborting (or maxretry) -> no exception, retried later', async () => {
  for (const msg of ['set', 'maxretry']) {
    const h = harness(lobby(0));
    const rearmed = [];
    h.net.onRearm = (r) => rearmed.push(r);
    h.net.setArmed({ code: CODE, id: 'px', role: 'player', name: 'p' });
    h.hooks.throwMessage = msg;
    h.hooks.throwTimes = msg === 'set' ? 5 : 1; // set は4回までその場でやり直すので、5回続けて失敗させる
    const r = await h.net.armPresence();
    assert.equal(r.reason, 'retry', msg);
    assert.equal((h.room().presence || {}).px, undefined, msg + ': not registered yet');
    assert.equal(h.timers.length, 1, msg + ': a retry is scheduled');
    await h.runTimer();
    assert.equal(h.room().presence.px, true, msg + ': registered by the retry');
    assert.equal(rearmed.length, 1, msg + ': the result is passed to onRearm');
    assert.equal(h.timers.length, 0, msg + ': no more retries');
  }
  // 退出したあとは、予約されていたやり直しを実行しても何も書かない
  const h2 = harness(lobby(0));
  h2.net.setArmed({ code: CODE, id: 'px', role: 'player', name: 'p' });
  h2.hooks.throwMessage = 'maxretry';
  h2.hooks.throwTimes = 1;
  await h2.net.armPresence();
  h2.net.setArmed(null);
  await h2.runTimer();
  assert.equal((h2.room().presence || {}).px, undefined);
});

test('connection drops while joining: retried; a write that already arrived counts as success (no duplicate, no false refusal)', async () => {
  // 見学: 書き込まれたあとに切れる → やり直しで自分の分を見つけて成功（名前の重複・上限で断らない）
  const cap = harness(null).net.SPECTATOR_CAP;
  const h = harness(lobby(cap - 1));
  h.hooks.disconnectAfter = 1;
  const r = await h.net.joinSpectator(CODE, 'きれた');
  assert.ok(r.id, JSON.stringify(r));
  assert.equal(specList(h.room()).length, cap);
  assert.equal(specList(h.room()).filter((x) => x.name === 'きれた').length, 1);
  // 見学: 届く前に切れる → やり直しで1回だけ書く
  const h2 = harness(lobby(0));
  h2.hooks.disconnectBefore = 1;
  assert.ok((await h2.net.joinSpectator(CODE, 'まえ')).id);
  assert.equal(specList(h2.room()).length, 1);
  // 本人の参加・端末なしの人の追加も同じ
  const h3 = harness(lobby(0));
  h3.hooks.disconnectAfter = 1;
  assert.ok((await h3.net.joinPlayer(CODE, 'あそぶ')).id);
  h3.hooks.disconnectAfter = 1;
  assert.equal((await h3.net.dispatch(CODE, { t: 'ADD_PROXY', by: 'h', pid: 'x1', name: 'だいり' })).ok, true);
  const names = Object.values(h3.room().game.players).map((p) => p.name).sort();
  assert.deepEqual(names, ['あそぶ', 'だいり']);
  // 何度も切れて入れなかった → 届いていた自分の分は消す（名前と枠を残さない）
  const h4 = harness(lobby(0));
  h4.hooks.disconnectAfter = 5;
  await assert.rejects(h4.net.joinSpectator(CODE, 'のこらない'));
  await new Promise((res) => setImmediate(res));
  assert.equal(specList(h4.room()).length, 0);
});

test('connection drops after the join arrived, and the room expires before the retry -> expired, not a success', async () => {
  for (const kind of ['player', 'spectator']) {
    const h = harness(lobby(0));
    h.hooks.disconnectAfter = 1;
    let expire = true;
    h.hooks.beforeCommit = async ({ path: p, attempt }) => {
      // 1回目の送信のあと（やり直しの前）に、ホストの切断から2分を過ぎたことにする
      if (p === ROOM && expire && h.hooks.disconnectAfter === 0) {
        expire = false;
        const room = h.room();
        room.meta.hostConnected = false;
        room.meta.hostDisconnectedAt = Date.now() - 3 * 60 * 1000;
        h.setRoom(room);
      }
    };
    const r = kind === 'player' ? await h.net.joinPlayer(CODE, 'おくれ') : await h.net.joinSpectator(CODE, 'おくれ');
    assert.equal(r.error, 'expired', kind);
    assert.equal(h.room(), undefined, kind + ': the expired room is cleaned up');
  }
});

test('room creation: made as host-not-yet-connected, then the host registration connects it', async () => {
  const h = harness(null);
  const { code, id } = await h.net.createRoom('ホスト', false);
  let room = h.roomAt(code);
  assert.equal(room.meta.hostConnected, false);
  assert.ok(Number(room.meta.hostDisconnectedAt) > 0);
  assert.equal(room.meta.hostId, id);
  h.net.setArmed({ code, id, role: 'host', name: 'ホスト' });
  const r = await h.net.armPresence();
  assert.equal(r.reason, undefined);
  room = h.roomAt(code);
  assert.equal(room.meta.hostConnected, true);
  assert.equal(room.presence[id], true);
});

test('room creation: the connection drops after the write -> retried and succeeds with one room', async () => {
  const h = harness(null);
  h.hooks.disconnectAfterAny = 1;
  const { code, id } = await h.net.createRoom('ホスト', true);
  const all = h.allRooms();
  assert.deepEqual(Object.keys(all), [code]);
  assert.equal(all[code].meta.hostId, id);
});

test('auth: a failed first sign-in is retried on the next operation', async () => {
  const h = harness(lobby(0), { authFailOnce: true, quiet: true });
  const r = await h.net.joinSpectator(CODE, 'あとから');
  assert.ok(r.id, JSON.stringify(r));
  assert.equal(h.signIns(), 2);
});

test('presence: a host coming back after the room expired does not revive it', async () => {
  const old = lobby(0);
  old.meta.hostConnected = false;
  old.meta.hostDisconnectedAt = Date.now() - 3 * 60 * 1000; // 待合室の2分を過ぎた
  const h = harness(old);
  h.net.setArmed({ code: CODE, id: 'h', role: 'host', name: 'ホスト' });
  const r = await h.net.armPresence();
  assert.equal(r.reason, 'expired');
  const room = h.room();
  assert.equal(room.meta.hostConnected, false, 'not revived');
  assert.equal((room.presence || {}).h, undefined);
});

test('other actions still go through the game transaction only', async () => {
  const h = harness(lobby(0));
  const r = await h.net.dispatch(CODE, { t: 'SETTINGS', by: 'h', patch: { timerSec: 30 } });
  assert.equal(r.ok, true);
  assert.equal(h.room().game.settings.timerSec, 30);
  h.setRoom(null);
  const gone = await h.net.dispatch(CODE, { t: 'SETTINGS', by: 'h', patch: { timerSec: 45 } });
  assert.equal(gone.ok, false);
  assert.equal(h.room(), undefined, 'no ghost game after deletion');
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try { await t.fn(); passed += 1; } catch (err) { console.error('FAIL', t.name); console.error(err); process.exitCode = 1; }
  }
  console.log(`net tests: ${passed}/${tests.length} passed`);
})();
