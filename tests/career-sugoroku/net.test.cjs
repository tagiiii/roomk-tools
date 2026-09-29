// 通信（net.js）のテスト。ネットワークには接続しない。Realtime Database をメモリ上の代役に置き換え、
// transaction は実物と同じく「読んだ値と、書く時点のサーバーの値が同じときだけ確定し、違えば読み直して再実行」する。
// 競合（入室の途中でルームが削除される・同時に入室する・同じ端末の書き込みで中止される・二度押し）を順番を決めて再現する。
// 実行: node tests/career-sugoroku/net.test.cjs（共通の rtdb-utils.js も同じ代役の上で読み込む）
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = path.resolve(__dirname, '../../apps/career-sugoroku');
const shared = path.resolve(__dirname, '../../apps/shared/js/rtdb-utils.js');
const D = require(path.join(app, 'data.js'));
const E = require(path.join(app, 'engine.js'));
const RM = require(path.join(app, 'room.js'));
const source = fs.readFileSync(path.join(app, 'net.js'), 'utf8');
const sharedSource = fs.readFileSync(shared, 'utf8');
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const CODE = 'ABCDEF';
const ROOM = 'careersugoroku_rooms/' + CODE;

function harness(room, opts = {}) {
  const store = { careersugoroku_rooms: room ? { [CODE]: clone(room) } : {} };
  // disconnectBefore: 送信したあと、サーバーに届く前に通信が切れる（書き込まれない）
  // disconnectAfter: サーバーが書き込んだあと、返事の前に通信が切れる（書き込まれている）
  // discFail(path, op): 切断時の予約（onDisconnect）の登録を失敗させる
  const hooks = { beforeCommit: null, abortOnce: null, throwTimes: 0, throwMessage: 'set', disconnectBefore: 0, disconnectAfter: 0, disconnectAfterAny: 0, discFail: null };
  // 切断時の予約。実物と同じく、cancel はその場所と配下の予約をすべて取り消す
  let disc = [];
  const timers = [];
  const keys = (p) => p.split('/').filter(Boolean);
  const getAt = (p) => keys(p).reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), store);
  // 実物と同じく、null と空のオブジェクトは消える
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
        onDisconnect: () => ({
          update: async (v) => { if (hooks.discFail && hooks.discFail(p, 'update')) throw new Error('set'); disc.push({ path: p, op: 'update', value: clone(v) }); },
          remove: async () => { if (hooks.discFail && hooks.discFail(p, 'remove')) throw new Error('set'); disc.push({ path: p, op: 'remove' }); },
          cancel: async () => { disc = disc.filter((d) => d.path !== p && !d.path.startsWith(p + '/')); },
        }),
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
    CS_ENGINE: E, CS_ROOM: RM, CS_DATA: D, location: { search: '' }, firebase,
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
    disc: () => clone(disc),
    // この端末の接続が切れた（サーバーが予約を実行する）
    fireDisconnect() {
      disc.forEach((d) => {
        if (d.op === 'remove') setAt(d.path, null);
        else Object.keys(d.value).forEach((k) => setAt(d.path + '/' + k, d.value[k]));
      });
      disc = [];
    },
  };
}

// 待合室（進行役 h・遊ぶ人 n 人）
function lobby(n = 0, extra = {}) {
  const seats = {};
  for (let i = 0; i < n; i++) seats['d' + i] = { name: 'ひと' + i, dev: 'd' + i, at: i + 1 };
  return Object.assign({ meta: { v: 2, createdAt: 1, hostId: 'h', hostConnected: true, dice: 1, labels: 'school', gameNo: 0 }, status: 'waiting', seats }, extra);
}
// ゲーム中（d0・d1 が端末あり、x2 が端末なし）
function playing(seed = 7) {
  const room = lobby(2);
  room.seats.x2 = { name: 'だいり', dev: '', at: 3 };
  room.order = ['d0', 'd1', 'x2'];
  room.status = 'playing';
  room.meta.gameNo = 1;
  room.game = JSON.stringify(E.newGame({ names: ['ひと0', 'ひと1', 'だいり'], dice: 1, seed }));
  return room;
}
const gameOf = (room) => JSON.parse(room.game);
const seatNames = (room) => RM.seatList(room).map((s) => s.name);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ── 作成 ──
test('作成: 進行役の切断中として作り、在室の登録で接続中になる。遊ぶなら席もある', async () => {
  const h = harness(null);
  const { code, dev } = await h.net.createRoom({ name: 'しんこう', plays: true, dice: 2, labels: 'age' });
  let room = h.roomAt(code);
  assert.equal(room.status, 'waiting');
  assert.equal(room.meta.hostConnected, false);
  assert.ok(Number(room.meta.hostDisconnectedAt) > 0);
  assert.equal(room.meta.hostId, dev);
  assert.deepEqual([room.meta.dice, room.meta.labels], [2, 'age']);
  assert.deepEqual(seatNames(room), ['しんこう']);
  h.net.setArmed({ code, dev, role: 'host' });
  assert.equal((await h.net.armPresence()).reason, undefined);
  room = h.roomAt(code);
  assert.equal(room.meta.hostConnected, true);
  assert.equal(room.presence[dev], true);
  // 進行だけのとき席はない
  const h2 = harness(null);
  const r2 = await h2.net.createRoom({ name: '', plays: false });
  assert.deepEqual(seatNames(h2.roomAt(r2.code)), []);
});

test('作成: 書き込みのあとに通信が切れても、やり直してルームは1つだけ', async () => {
  const h = harness(null);
  h.hooks.disconnectAfterAny = 1;
  const { code, dev } = await h.net.createRoom({ name: 'しんこう', plays: false });
  const all = h.allRooms();
  assert.deepEqual(Object.keys(all), [code]);
  assert.equal(all[code].meta.hostId, dev);
});

// ── 参加 ──
test('参加: 名前の重複・空・長すぎ・上限・始まったあと・ルームがない', async () => {
  const h = harness(lobby(1));
  assert.ok((await h.net.joinRoom(CODE, 'あお')).dev);
  assert.equal((await h.net.joinRoom(CODE, 'あお')).error, 'nameTaken');
  assert.equal((await h.net.joinRoom(CODE, '  ')).error, 'name');
  assert.equal((await h.net.joinRoom(CODE, 'ながすぎるなまえです')).error, 'name');
  for (let i = 0; i < D.MAX_PLAYERS - 2; i++) assert.ok((await h.net.joinRoom(CODE, 'ひと' + (10 + i))).dev);
  assert.equal(RM.seatList(h.room()).length, D.MAX_PLAYERS);
  assert.equal((await h.net.joinRoom(CODE, 'おそい')).error, 'full');
  const started = harness(playing());
  assert.equal((await started.net.joinRoom(CODE, 'あとから')).error, 'started');
  const none = harness(null);
  assert.equal((await none.net.joinRoom(CODE, 'だれ')).error, 'none');
  assert.equal(none.room(), undefined);
});

test('参加: 同じ名前で同時に入ると1人だけ', async () => {
  const h = harness(lobby(0));
  const rs = await Promise.all([h.net.joinRoom(CODE, 'おなじ'), h.net.joinRoom(CODE, 'おなじ')]);
  assert.equal(rs.filter((r) => r.dev).length, 1);
  assert.deepEqual(rs.filter((r) => r.error).map((r) => r.error), ['nameTaken']);
  assert.deepEqual(seatNames(h.room()), ['おなじ']);
});

test('参加: 期限切れのルーム・ゴーストは期限切れとして片付ける', async () => {
  const old = lobby(0);
  old.meta.hostConnected = false;
  old.meta.hostDisconnectedAt = Date.now() - 3 * 60 * 1000; // 待合室の2分を過ぎた
  const h = harness(old);
  assert.equal((await h.net.joinRoom(CODE, 'a')).error, 'expired');
  assert.equal(h.room(), undefined);
  const g = harness(null);
  g.setRoom({ meta: { hostConnected: false, hostDisconnectedAt: 5 } }); // status のない部分だけのルーム
  assert.equal((await g.net.joinRoom(CODE, 'b')).error, 'expired');
  assert.equal(g.room(), undefined);
});

test('参加: 入室の途中でルームが削除されても、部分だけのルームを残さない', async () => {
  const h = harness(lobby(0));
  let deleted = false;
  h.hooks.beforeCommit = async ({ path: p }) => { if (p === ROOM && !deleted) { deleted = true; h.setRoom(null); } };
  assert.equal((await h.net.joinRoom(CODE, 'だれか')).error, 'none');
  assert.equal(h.room(), undefined);
});

test('参加: 届いたあとに通信が切れても、やり直しで成功（重複しない・断らない）', async () => {
  const h = harness(lobby(D.MAX_PLAYERS - 1));
  h.hooks.disconnectAfter = 1;
  assert.ok((await h.net.joinRoom(CODE, 'きれた')).dev);
  assert.equal(RM.seatList(h.room()).length, D.MAX_PLAYERS);
  const h2 = harness(lobby(0));
  h2.hooks.disconnectBefore = 1;
  assert.ok((await h2.net.joinRoom(CODE, 'まえ')).dev);
  assert.deepEqual(seatNames(h2.room()), ['まえ']);
});

test('端末のない人: 進行役が追加・外せる。名前の重複は断る', async () => {
  const h = harness(lobby(1));
  assert.equal((await h.net.addProxy(CODE, 'ひと0')).error, 'nameTaken');
  assert.equal((await h.net.addProxy(CODE, 'だいり')).ok, true);
  const room = h.room();
  const proxy = RM.seatList(room).find((s) => s.name === 'だいり');
  assert.equal(proxy.dev, '');
  assert.ok(proxy.sid.startsWith('x'));
  await h.net.removeSeat(CODE, proxy.sid);
  assert.deepEqual(seatNames(h.room()), ['ひと0']);
});

test('退出: 待合室なら席も外す。ゲーム中は席を残し（進行役が代わりに押す）、在室だけ消す', async () => {
  const h = harness(lobby(2, { presence: { d0: true, d1: true } }));
  await h.net.leaveRoom({ code: CODE, dev: 'd1', role: 'guest' });
  assert.deepEqual(seatNames(h.room()), ['ひと0']);
  assert.equal(h.room().presence.d1, undefined);
  const p = playing();
  p.presence = { d0: true, d1: true };
  const h2 = harness(p);
  await h2.net.leaveRoom({ code: CODE, dev: 'd1', role: 'guest' });
  assert.deepEqual(seatNames(h2.room()), ['ひと0', 'ひと1', 'だいり']);
  assert.equal(h2.room().presence.d1, undefined);
});

// ── 開始 ──
test('開始: 進行役だけ。入った順に並び、ゲームの状態は文字列で入る', async () => {
  const h = harness(lobby(0));
  assert.equal((await h.net.startGame(CODE, 'h')).reason, 'empty');
  await h.net.joinRoom(CODE, 'さき');
  await h.net.addProxy(CODE, 'つぎ');
  await h.net.joinRoom(CODE, 'あと');
  assert.equal((await h.net.startGame(CODE, 'だれか')).reason, 'host');
  assert.equal((await h.net.startGame(CODE, 'h')).ok, true);
  const room = h.room();
  assert.equal(room.status, 'playing');
  assert.equal(room.meta.gameNo, 1);
  assert.equal(typeof room.game, 'string');
  const g = gameOf(room);
  assert.deepEqual(g.players.map((p) => p.name), ['さき', 'つぎ', 'あと']);
  assert.deepEqual(seatNames(room), ['さき', 'つぎ', 'あと']);
  assert.equal(g.settings.dice, 1);
  assert.equal((await h.net.startGame(CODE, 'h')).reason, 'started'); // ゲーム中は始め直さない
});

// ── 操作 ──
test('操作: 自分の番の端末と進行役だけが押せる。ほかの人は notYours', async () => {
  const h = harness(playing());
  const at = () => RM.stamp(gameOf(h.room()));
  assert.equal((await h.net.act(CODE, 'd1', { type: 'roll' }, at())).reason, 'notYours'); // 番は d0
  const r = await h.net.act(CODE, 'd0', { type: 'roll' }, at());
  assert.equal(r.ok, true);
  assert.notEqual(gameOf(h.room()).step.kind, 'roll');
  // 進行役はだれの番でも押せる（ここでは d0 の番の続き）
  const g = gameOf(h.room());
  const action = g.step.kind === 'ack' ? { type: 'ack' } : g.step.kind === 'pick' ? { type: 'pick', a: g.step.opts[0] } : null;
  if (action) assert.equal((await h.net.act(CODE, 'h', action, at())).ok, true);
});

test('操作: 端末のない人の番は進行役だけが押せる', async () => {
  const room = playing();
  const g = gameOf(room);
  g.cur = 2; // だいり（x2）の番
  room.game = JSON.stringify(g);
  const h = harness(room);
  const at = RM.stamp(g);
  assert.equal((await h.net.act(CODE, 'd0', { type: 'roll' }, at)).reason, 'notYours');
  assert.equal((await h.net.act(CODE, 'h', { type: 'roll' }, at)).ok, true);
});

test('操作: 二度押し・同時押しは1回だけ通る（しるしが古いと stale）', async () => {
  const h = harness(playing());
  const at = RM.stamp(gameOf(h.room()));
  const rs = await Promise.all([h.net.act(CODE, 'd0', { type: 'roll' }, at), h.net.act(CODE, 'h', { type: 'roll' }, at)]);
  assert.equal(rs.filter((r) => r.ok).length, 1);
  assert.deepEqual(rs.filter((r) => !r.ok).map((r) => r.reason), ['stale']);
  assert.equal(gameOf(h.room()).players[0].turns, 1);
});

test('操作: 途中で終える・ステージの表示は進行役だけ。終えると結果（finished）', async () => {
  const h = harness(playing());
  assert.equal((await h.net.act(CODE, 'd0', { type: 'end' })).reason, 'notYours');
  assert.equal((await h.net.act(CODE, 'd0', { type: 'labels', labels: 'age' })).reason, 'notYours');
  assert.equal((await h.net.act(CODE, 'h', { type: 'labels', labels: 'age' })).ok, true);
  assert.equal(gameOf(h.room()).settings.labels, 'age');
  assert.equal((await h.net.act(CODE, 'h', { type: 'end' })).ok, true);
  const room = h.room();
  assert.equal(room.status, 'finished');
  assert.equal(gameOf(room).phase, 'results');
  // 結果から「同じメンバーでもう一度」
  assert.equal((await h.net.startGame(CODE, 'h')).ok, true);
  const again = h.room();
  assert.equal(again.status, 'playing');
  assert.equal(again.meta.gameNo, 2);
  assert.deepEqual(gameOf(again).players.map((p) => p.name), ['ひと0', 'ひと1', 'だいり']);
});

// ミニゲームマスの手前（a4）から1つ進んで a5 に止まる状態のルーム（d0 の番。presence は付けない）
function miniRoom(game) {
  for (let seed = 1; seed < 400; seed++) {
    const room = playing(seed);
    const g = gameOf(room);
    g.players[0].node = 'a4';
    g.players[0].trail = ['start', 'a4'];
    const r = E.apply(g, { type: 'roll' });
    if (r.ok && r.state.step.kind === 'mini' && (!game || r.state.step.game === game)) { room.game = JSON.stringify(r.state); return room; }
  }
  return null;
}
const MINI_ONE = { hilo: 'hi', janken: 'g', sum: 1 };

test('ミニゲーム: 各自が自分の答えを入れ、結果を見ると答えを片付ける', async () => {
  const found = miniRoom();
  assert.ok(found, 'ミニゲームの場面を作れた');
  const h = harness(found);
  let g = gameOf(h.room());
  assert.equal(RM.canAnswer(h.room(), 'd1', 1), true);
  assert.equal(RM.canAnswer(h.room(), 'd1', 0), false);
  assert.equal(RM.canAnswer(h.room(), 'h', 2), true);
  const opts = { hilo: 'hi', janken: 'g', sum: 1 }[g.step.game];
  const key = RM.answerKey(g);
  assert.equal((await h.net.setAnswer(CODE, 'd0', key, 0, opts)).ok, true);
  assert.equal((await h.net.setAnswer(CODE, 'd1', key, 1, opts)).ok, true);
  assert.equal((await h.net.setAnswer(CODE, 'h', key, 2, opts)).ok, true);
  const picks = RM.answersOf(h.room());
  assert.deepEqual(Object.keys(picks).sort(), ['0', '1', '2']);
  const r = await h.net.act(CODE, 'd0', { type: 'mini' }, RM.stamp(g));
  assert.equal(r.ok, true, JSON.stringify(r));
  const room = h.room();
  assert.equal(room.answers, undefined);
  g = gameOf(room);
  assert.equal(g.step.kind, 'ack');
});

test('ミニゲーム: 進行役が代わりに答えられるのは、端末のない人とつながっていない人の分だけ', async () => {
  const room = miniRoom();
  room.presence = { d0: true, d1: true };
  const h = harness(room);
  const g = gameOf(h.room());
  const key = RM.answerKey(g);
  const v = MINI_ONE[g.step.game];
  assert.equal((await h.net.setAnswer(CODE, 'h', key, 0, v)).reason, 'notYours'); // d0 はつながっている
  assert.equal((await h.net.setAnswer(CODE, 'h', key, 1, v)).reason, 'notYours');
  assert.equal((await h.net.setAnswer(CODE, 'd1', key, 0, v)).reason, 'notYours'); // ほかの人の分
  assert.equal((await h.net.setAnswer(CODE, 'h', key, 2, v)).ok, true); // 端末のない人
  // d1 の接続が切れたら、進行役が代わりに答えられる
  const r = h.room();
  delete r.presence.d1;
  h.setRoom(r);
  assert.equal((await h.net.setAnswer(CODE, 'h', key, 1, v)).ok, true);
  assert.deepEqual(Object.keys(RM.answersOf(h.room())).sort(), ['1', '2']);
});

test('ミニゲーム: 答えの値・古い番・ミニゲームでない場面は書かない', async () => {
  const h = harness(miniRoom());
  const g = gameOf(h.room());
  const key = RM.answerKey(g);
  assert.equal((await h.net.setAnswer(CODE, 'd0', key, 0, 'zz')).reason, 'value');
  assert.equal((await h.net.setAnswer(CODE, 'd0', key, 0, 9)).reason, 'value');
  assert.equal((await h.net.setAnswer(CODE, 'd0', 'n1', 0, MINI_ONE[g.step.game])).reason, 'stale');
  assert.equal(h.room().answers, undefined);
  const p = harness(playing());
  assert.equal((await p.net.setAnswer(CODE, 'd0', 'n1', 0, 'hi')).reason, 'notMini');
  assert.equal(p.room().answers, undefined);
  // 取り消し（null）は、自分の答えだけを消す
  assert.equal((await h.net.setAnswer(CODE, 'd0', key, 0, MINI_ONE[g.step.game])).ok, true);
  assert.equal((await h.net.setAnswer(CODE, 'd1', key, 1, MINI_ONE[g.step.game])).ok, true);
  assert.equal((await h.net.setAnswer(CODE, 'd0', key, 0, null)).ok, true);
  assert.deepEqual(Object.keys(RM.answersOf(h.room())), ['1']);
});

test('ミニゲーム: 同時に答えても全員の分が残る', async () => {
  const h = harness(miniRoom());
  const g = gameOf(h.room());
  const key = RM.answerKey(g);
  const v = MINI_ONE[g.step.game];
  const rs = await Promise.all([h.net.setAnswer(CODE, 'd0', key, 0, v), h.net.setAnswer(CODE, 'd1', key, 1, v), h.net.setAnswer(CODE, 'h', key, 2, v)]);
  assert.deepEqual(rs.map((r) => r.ok), [true, true, true]);
  assert.deepEqual(Object.keys(RM.answersOf(h.room())).sort(), ['0', '1', '2']);
});

test('ミニゲーム: 結果はルームにある答えで決まる（画面が送った答えは使わない）', async () => {
  const base = miniRoom('hilo') || miniRoom();
  const g = gameOf(base);
  const key = RM.answerKey(g);
  const v = MINI_ONE[g.step.game];
  const outs = [];
  for (const picks of [undefined, { 0: 'lo', 1: 'lo', 2: 'lo' }, { 0: 'zz' }]) {
    const h = harness(base);
    await h.net.setAnswer(CODE, 'd0', key, 0, v);
    await h.net.setAnswer(CODE, 'd1', key, 1, v);
    const r = await h.net.act(CODE, 'd0', picks ? { type: 'mini', picks } : { type: 'mini' }, RM.stamp(g));
    assert.equal(r.ok, true, JSON.stringify(r));
    outs.push(h.room().game);
  }
  assert.equal(outs[1], outs[0]);
  assert.equal(outs[2], outs[0]);
});

test('ミニゲーム: 終わったあとに届いた答えは書かない。途中で終えても答えを片付ける', async () => {
  const h = harness(miniRoom());
  const g = gameOf(h.room());
  const key = RM.answerKey(g);
  const v = MINI_ONE[g.step.game];
  if (g.step.game === 'sum') for (const [d, pid] of [['d0', 0], ['d1', 1], ['h', 2]]) await h.net.setAnswer(CODE, d, key, pid, v);
  assert.equal((await h.net.act(CODE, 'd0', { type: 'mini' }, RM.stamp(g))).ok, true);
  const late = await h.net.setAnswer(CODE, 'd1', key, 1, v);
  assert.equal(late.ok, false);
  assert.ok(['notMini', 'stale'].includes(late.reason), late.reason);
  assert.equal(h.room().answers, undefined);
  // ミニゲームの途中で進行役が終える → 結果（finished）になり、答えも消える
  const h2 = harness(miniRoom());
  const g2 = gameOf(h2.room());
  await h2.net.setAnswer(CODE, 'd0', RM.answerKey(g2), 0, MINI_ONE[g2.step.game]);
  assert.ok(h2.room().answers);
  assert.equal((await h2.net.act(CODE, 'h', { type: 'end' })).ok, true);
  assert.equal(h2.room().status, 'finished');
  assert.equal(h2.room().answers, undefined);
});

test('操作: 道を選び直して前の状態にもどっても、前の画面からの操作は stale（rev で見分ける）', async () => {
  // だれかが節目の道を選ぶ場面まで進める
  let g = E.newGame({ names: ['ひと0', 'ひと1', 'だいり'], dice: 1, seed: 11 });
  for (let i = 0; i < 3000 && g.phase === 'play' && g.step.kind !== 'route'; i++) {
    const st = g.step;
    const p = g.players[g.cur];
    let a;
    switch (st.kind) {
      case 'roll': a = { type: 'roll' }; break;
      case 'skip': case 'ack': a = { type: 'ack' }; break;
      case 'dice': a = { type: 'dice', pick: 0 }; break;
      case 'fork': a = { type: 'fork', choice: 0 }; break;
      case 'job': a = { type: 'job', job: st.keep ? 'keep' : 0 }; break;
      case 'friend': a = { type: 'friend', pid: g.players.find((q) => q.id !== p.id).id }; break;
      case 'pick': a = { type: 'pick', a: st.opts[0] }; break;
      case 'vote': a = { type: 'vote', opt: 0 }; break;
      case 'coop': a = { type: 'coop' }; break;
      case 'mini': { const o = RM.MINI_VALUES[st.game][0]; a = { type: 'mini', picks: Object.fromEntries(g.players.map((q) => [q.id, o])) }; break; }
      default: throw new Error('unknown ' + st.kind);
    }
    const r = E.apply(g, a);
    assert.ok(r.ok, st.kind);
    g = r.state;
  }
  assert.equal(g.step.kind, 'route', '道を選ぶ場面まで進めた');
  const room = playing();
  room.game = JSON.stringify(g);
  const h = harness(room);
  const at0 = RM.stamp(g);
  assert.equal((await h.net.act(CODE, 'h', { type: 'route', choice: 0 }, at0)).ok, true);
  const g1 = gameOf(h.room());
  assert.equal(g1.rev, 1);
  assert.ok(g1.routeUndo);
  assert.equal((await h.net.act(CODE, 'h', { type: 'reroute' }, RM.stamp(g1))).ok, true);
  const g2 = gameOf(h.room());
  assert.equal(g2.rev, 2);
  assert.equal(g2.step.kind, 'route');
  // rev を除くと、道を選ぶ前と同じしるしになる（rev がなければ前の画面の操作が通ってしまう）
  assert.equal(RM.stamp(g2).split(':').slice(1).join(':'), at0.split(':').slice(1).join(':'));
  assert.equal((await h.net.act(CODE, 'h', { type: 'route', choice: 1 }, at0)).reason, 'stale');
  assert.equal(gameOf(h.room()).rev, 2);
});

test('操作: 削除されたルームには書き戻さない（ゴーストを作らない）', async () => {
  const h = harness(playing());
  const at = RM.stamp(gameOf(h.room()));
  h.setRoom(null);
  const r = await h.net.act(CODE, 'h', { type: 'roll' }, at);
  assert.equal(r.ok, false);
  assert.equal(h.room(), undefined);
});

test('操作: 同じ端末の書き込み（答え・在室）で中止されても、やり直して1回だけ通る', async () => {
  const h = harness(playing());
  h.hooks.abortOnce = (p) => p === ROOM;
  const at = RM.stamp(gameOf(h.room()));
  assert.equal((await h.net.act(CODE, 'd0', { type: 'roll' }, at)).ok, true);
  assert.equal(gameOf(h.room()).players[0].turns, 1);
  // 届いたあとに切れた → やり直しは stale で止まり、2回は進まない
  const h2 = harness(playing());
  h2.hooks.disconnectAfter = 1;
  const at2 = RM.stamp(gameOf(h2.room()));
  const r2 = await h2.net.act(CODE, 'd0', { type: 'roll' }, at2);
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, 'stale');
  assert.equal(gameOf(h2.room()).players[0].turns, 1);
});

// ── 在室 ──
test('在室: 進行役の再登録で接続中にもどる。期限切れのあとは復活させない', async () => {
  const room = playing();
  room.meta.hostConnected = false;
  room.meta.hostDisconnectedAt = Date.now() - 60 * 1000; // ゲーム中の15分の内
  const h = harness(room);
  h.net.setArmed({ code: CODE, dev: 'h', role: 'host' });
  assert.equal((await h.net.armPresence()).reason, undefined);
  assert.equal(h.room().meta.hostConnected, true);
  assert.equal(h.room().meta.hostDisconnectedAt, undefined);
  const old = playing();
  old.meta.hostConnected = false;
  old.meta.hostDisconnectedAt = Date.now() - 16 * 60 * 1000; // 15分を過ぎた
  const h2 = harness(old);
  h2.net.setArmed({ code: CODE, dev: 'h', role: 'host' });
  assert.equal((await h2.net.armPresence()).reason, 'expired');
  assert.equal(h2.room().meta.hostConnected, false);
});

test('在室: 席のない端末（外された）は gone。登録中の削除で部分だけのルームを残さない', async () => {
  const h = harness(lobby(1));
  h.net.setArmed({ code: CODE, dev: 'dX', role: 'guest' });
  assert.equal((await h.net.armPresence()).reason, 'gone');
  assert.equal((h.room().presence || {}).dX, undefined);
  const h2 = harness(lobby(1));
  h2.net.setArmed({ code: CODE, dev: 'd0', role: 'guest' });
  let deleted = false;
  h2.hooks.beforeCommit = async ({ path: p }) => { if (p === ROOM && !deleted) { deleted = true; h2.setRoom(null); } };
  assert.equal((await h2.net.armPresence()).reason, 'none');
  assert.equal(h2.room(), undefined);
});

test('在室: 書き込みの中止が続いても例外にせず、あとでやり直す。退出後は何も書かない', async () => {
  for (const msg of ['set', 'maxretry']) {
    const h = harness(lobby(1));
    const rearmed = [];
    h.net.onRearm = (r) => rearmed.push(r);
    h.net.setArmed({ code: CODE, dev: 'd0', role: 'guest' });
    h.hooks.throwMessage = msg;
    h.hooks.throwTimes = msg === 'set' ? 5 : 1; // set は4回までその場でやり直すので、5回続けて失敗させる
    assert.equal((await h.net.armPresence()).reason, 'retry', msg);
    assert.equal((h.room().presence || {}).d0, undefined);
    assert.equal(h.timers.length, 1);
    await h.runTimer();
    assert.equal(h.room().presence.d0, true, msg + ': やり直しで登録');
    assert.equal(rearmed.length, 1);
  }
  const h2 = harness(lobby(1));
  h2.net.setArmed({ code: CODE, dev: 'd0', role: 'guest' });
  h2.hooks.throwMessage = 'maxretry';
  h2.hooks.throwTimes = 1;
  await h2.net.armPresence();
  h2.net.setArmed(null);
  await h2.runTimer();
  assert.equal((h2.room().presence || {}).d0, undefined);
});

test('在室: 切断時の予約の片方が失敗したら、両方を取り消してあとでやり直す', async () => {
  const h = harness(lobby(0));
  let fails = 1;
  h.hooks.discFail = (p, op) => op === 'remove' && fails-- > 0;
  h.net.setArmed({ code: CODE, dev: 'h', role: 'host' });
  assert.equal((await h.net.armPresence()).reason, 'retry');
  assert.deepEqual(h.disc(), []); // 先に登録した meta の予約も取り消した
  assert.equal(h.timers.length, 1);
  await h.runTimer();
  assert.deepEqual(h.disc().map((d) => d.op).sort(), ['remove', 'update']);
  assert.equal(h.room().meta.hostConnected, true);
});

test('在室: 登録は同時に1本だけ。始まる前の呼び出しはまとめ、登録中の呼び出しは終わったあとにもう一度', async () => {
  const h = harness(lobby(0));
  let open;
  const gate = new Promise((r) => { open = r; });
  h.hooks.beforeCommit = async ({ path: p }) => { if (p === ROOM) await gate; };
  h.net.setArmed({ code: CODE, dev: 'h', role: 'host' });
  const a = h.net.armPresence();
  assert.equal(h.net.armPresence(), a); // 始まる前 → 同じ登録
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(h.disc().length, 2); // 1回目の予約は済み、transaction で止まっている
  assert.equal(h.net.armPresence(), a); // 登録中（つながりなおしなど）→ 終わったあともう一度
  let removes = 0;
  h.hooks.discFail = (p, op) => op === 'remove' && ++removes === 1; // 2回目の予約が途中で失敗する
  h.hooks.beforeCommit = null;
  open();
  const r = await a;
  // 2回目の失敗で、ルーム以下の予約をすべて取り消し、間隔をあけてやり直す（重なった登録はないので、ほかの予約は消していない）
  assert.equal(r.reason, 'retry');
  assert.deepEqual(h.disc(), []);
  assert.equal(h.timers.length, 1);
  await h.runTimer();
  assert.deepEqual(h.disc().map((d) => d.op).sort(), ['remove', 'update']);
  assert.equal(h.room().meta.hostConnected, true);
  assert.equal(h.room().presence.h, true);
});

test('在室: 登録の途中で離れたら、登録が終わってから予約を取り消す（在室も書かない）', async () => {
  const h = harness(lobby(1));
  let open;
  const gate = new Promise((r) => { open = r; });
  h.hooks.beforeCommit = async ({ path: p }) => { if (p === ROOM) await gate; };
  h.net.setArmed({ code: CODE, dev: 'd0', role: 'guest' });
  const arming = h.net.armPresence();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const releasing = h.net.release(CODE);
  let released = false;
  releasing.then(() => { released = true; });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(released, false, '登録が終わるまで待つ');
  h.hooks.beforeCommit = null;
  open();
  const r = await arming;
  await releasing;
  assert.equal(r.reason, 'moved');
  assert.deepEqual(h.disc(), []);
  assert.equal((h.room().presence || {}).d0, undefined);
  assert.equal(h.timers.length, 0);
});

test('在室: 離れる片付けの途中で同じルームに入り直しても、新しい席の予約は古い取り消しで消えない', async () => {
  const h = harness(lobby(2));
  let open;
  const gate = new Promise((r) => { open = r; });
  h.hooks.beforeCommit = async ({ path: p }) => { if (p === ROOM) await gate; };
  // 古い席（d0）の登録が止まっているあいだに退出し、同じタブが別の席（d1）で入り直す
  h.net.setArmed({ code: CODE, dev: 'd0', role: 'guest' });
  const oldArm = h.net.armPresence();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const releasing = h.net.release(CODE);
  h.net.setArmed({ code: CODE, dev: 'd1', role: 'guest' });
  const newArm = h.net.armPresence();
  h.hooks.beforeCommit = null;
  open();
  assert.equal((await oldArm).reason, 'moved');
  await releasing;
  assert.equal((await newArm).reason, undefined);
  // 新しい席の在室と、その切断時の予約（在室の削除）が残っている
  assert.equal(h.room().presence.d1, true);
  assert.equal((h.room().presence || {}).d0, undefined);
  assert.deepEqual(h.disc().map((d) => d.path), [ROOM + '/presence/d1']);
  h.fireDisconnect();
  assert.equal((h.room().presence || {}).d1, undefined);
});

test('片付け: ルームを離れたら切断時の予約を取り消す（あとで切れてもゴーストを作らない）', async () => {
  // 取り消さないと、ルームが消えたあとの切断で meta だけのルームができてしまう（この代役がそれを再現できることの確認）
  const bad = harness(lobby(0));
  bad.net.setArmed({ code: CODE, dev: 'h', role: 'host' });
  await bad.net.armPresence();
  bad.setRoom(null);
  bad.fireDisconnect();
  assert.ok(bad.room() && bad.room().meta && !bad.room().status, 'ゴーストができる');
  // release: 期限切れ・外されたときの片付け
  const h = harness(lobby(1));
  h.net.setArmed({ code: CODE, dev: 'h', role: 'host' });
  await h.net.armPresence();
  assert.equal(h.disc().length, 2);
  await h.net.release(CODE);
  assert.deepEqual(h.disc(), []);
  await h.net.removeIfExpired(CODE); // 期限は切れていないので消さない
  assert.ok(h.room());
  h.setRoom(null);
  h.fireDisconnect();
  assert.equal(h.room(), undefined);
  // 閉じる・退出も同じ
  const c = harness(lobby(1));
  c.net.setArmed({ code: CODE, dev: 'h', role: 'host' });
  await c.net.armPresence();
  await c.net.closeRoom(CODE);
  c.fireDisconnect();
  assert.equal(c.room(), undefined);
  const g = harness(lobby(1));
  g.net.setArmed({ code: CODE, dev: 'd0', role: 'guest' });
  await g.net.armPresence();
  await g.net.leaveRoom({ code: CODE, dev: 'd0', role: 'guest' });
  assert.deepEqual(g.disc(), []);
  // 退出のあとに再登録の予約が走っても何も書かない
  assert.equal(g.timers.length, 0);
});

test('認証: 最初の匿名認証が失敗しても、次の操作で試し直す', async () => {
  const h = harness(lobby(0), { authFailOnce: true, quiet: true });
  assert.ok((await h.net.joinRoom(CODE, 'あとから')).dev);
  assert.equal(h.signIns(), 2);
});

test('閉じる: ルームを消す', async () => {
  const h = harness(playing());
  await h.net.closeRoom(CODE);
  assert.equal(h.room(), undefined);
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try { await t.fn(); passed += 1; console.log('  ok  ' + t.name); } catch (err) { console.log('  NG  ' + t.name); console.log(err); process.exitCode = 1; }
  }
  console.log(`\n${passed}/${tests.length} 件合格`);
})();
