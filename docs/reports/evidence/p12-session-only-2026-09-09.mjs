// Actual-function VM checks; Firebase, DOM, session loading and presence are stubs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const baseline = 'b50a9fe738fd2a03242dd62549396f478137adfd';
const apps = ['kakure-number', 'pittari-meter', 'do-mannaka', 'tatoe-gp', 'uso-jisho'];
const paths = ['kakure_rooms', 'pittari_rooms', 'domannaka_rooms', 'tatoegp_rooms', 'uso_rooms'];
const phases = [
  ['waiting', 'thinking', 'reveal', 'done'],
  ['waiting', 'hinting', 'guessing', 'reveal', 'done'],
  ['waiting', 'selecting', 'answering', 'result', 'finished'],
  ['waiting', 'selecting', 'answering', 'voting', 'result', 'finished'],
  ['waiting', 'writing', 'voting', 'reveal', 'done'],
];
const currentHashes = [
  '3613c1cafb4f6acc70d1837d1b976fe903ed21bfcecf98bab46ec9e44510024e',
  'a6531e22c86883b5177b510d4fafb42e0b6f3c931131bbfb78da713b12e8d22f',
  '2d547141f33d9328111d64fc69d0267fe97d8ff138ae9356c66061938373c655',
  '8c0a1d39f83a6222be14ebb926190c296fc69674e45d4a2a56bfc171758f9524',
  '4be33d86a778069d55dd5e5ea612dabf9ba622900367ac6282f6f369d531f179',
];
const digest = s => createHash('sha256').update(s).digest('hex');
const clone = x => JSON.parse(JSON.stringify(x));
function extract(source, name) {
  const start = source.indexOf(`  async function ${name}() {`);
  assert(start >= 0);
  const end = source.indexOf('\n  }', start) + 4;
  assert(end > start);
  const code = source.slice(start, end);
  assert.equal(source.split(`  async function ${name}() {`).length, 2);
  new vm.Script(code);
  return code;
}
function expectedSource(old) {
  const pattern = /(?:    \/\/ ゲーム中に同じニックネーム[^\n]*\n)?    if \(room.status !== (?:ST.WAITING|STATUS.WAITING|'waiting') && alreadyInRoom\) \{\n[\s\S]*?\n    \}\n\n/g;
  assert.equal([...old.matchAll(pattern)].length, 1);
  return old.replace(pattern, '');
}
async function run(code, appIndex, spec, method = 'guestJoin') {
  let room = spec.absent ? null : {
    status: spec.status || ['thinking', 'guessing', 'answering', 'answering', 'writing'][appIndex], host: 'host', hostConnected: true,
    players: { host: { isHost: true }, guest: { isHost: false, score: 9, answer: 'kept', vote: 'other', guess: 42, decided: true } },
  };
  if (room && spec.missingGuest) delete room.players.guest;
  if (room && spec.missingHost) delete room.players.host;
  if (room && spec.hostPlays !== undefined) room.hostPlays = spec.hostPlays;
  if (room && spec.deleteAt !== undefined) room.deleteAt = spec.deleteAt;
  const before = clone(room);
  const events = [], errors = [], overlays = [];
  const state = { nickname: null, roomCode: null, role: null, roomRef: null };
  let session = spec.noSession ? null : { nickname: spec.nickname || 'guest', roomCode: 'ABCDEF', role: spec.role || 'guest', score: 7, answer: 'saved', vote: 'saved-vote' };
  const snapshot = value => ({ exists: () => value !== null, val: () => clone(value) });
  function ref(path) {
    return {
      path,
      child: child => ref(path + '/' + child),
      get: async () => snapshot(room),
      remove: async () => { events.push(['remove', path]); room = null; },
      set: async value => { events.push(['set', path, clone(value)]); room.players[path.split('/').at(-1)] = clone(value); },
      update: async value => { events.push(['update', path, clone(value)]); Object.assign(room, clone(value)); },
      transaction: async update => {
        events.push(['transaction', path]);
        const next = update(clone(room));
        if (next !== undefined) room = clone(next);
        return { committed: next !== undefined, snapshot: snapshot(room) };
      },
      onDisconnect: () => ({
        remove: () => { events.push(['disconnect-remove', path]); },
        update: value => { events.push(['disconnect-update', path, clone(value)]); },
      }),
    };
  }
  const context = vm.createContext({
    state, db: { ref }, ROOMS_PATH: paths[appIndex],
    ST: { WAITING: 'waiting', DONE: 'done' }, STATUS: { WAITING: 'waiting', DONE: 'done', FINISHED: 'finished' },
    MAX_GUESTS: 8, firebase: { database: { ServerValue: { TIMESTAMP: 'SERVER_TIME_STUB' } } },
    authReady: Promise.resolve(), waitAuthOrExplain: async () => true,
    validateNickname: () => null, isRoomExpired: () => Boolean(spec.expired),
    guestNames: players => Object.keys(players).filter(n => !players[n].isHost),
    document: { getElementById: id => ({ value: id === 'guest-nickname' ? spec.nickname || 'guest' : 'ABCDEF' }) },
    showError: (id, message) => errors.push(message), hideError: () => {},
    saveSession: () => events.push(['saveSession']), loadSession: () => clone(session),
    clearSession: () => { session = null; events.push(['clearSession']); },
    startRoomListener: () => events.push(['listener']), showScreen: screen => events.push(['screen', screen]),
    showReconnectOverlay: value => overlays.push(value),
    canRestoreHostPresence: (value, nick) => value.host === nick,
    startHostPresence: () => events.push(['hostPresence']), stopHostPresence: () => events.push(['stopHostPresence']),
    scheduleDoneCleanup: (target, deadline) => events.push(['scheduleDoneCleanup', target.path, deadline]),
    scheduleFinishedCleanup: (target, deadline) => events.push(['scheduleFinishedCleanup', target.path, deadline]),
  }, { codeGeneration: { strings: false, wasm: false } });
  const promise = vm.runInContext(code + `\n${method}();`, context, { timeout: 1000 });
  const result = await promise;
  return { result, room, before, events, errors, overlays, state: { ...state, roomRef: state.roomRef ? 'REF' : null }, session };
}
const results = [], sources = [];
for (const [i, app] of apps.entries()) {
  const file = `apps/${app}/index.html`;
  const old = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
  const current = readFileSync(root + file, 'utf8');
  assert.equal(digest(current), currentHashes[i], `${app}: source SHA changed`);
  assert.equal(current, expectedSource(old), `${app}: only named rejoin branch may change`);
  sources.push({ file, oldSha256: digest(old), currentSha256: digest(current) });
  const joinOld = extract(old, 'guestJoin'), joinNew = extract(current, 'guestJoin');
  const reconnect = extract(current, 'tryReconnect');
  assert.equal(reconnect, extract(old, 'tryReconnect'));
  const declaredPhases = app === 'do-mannaka'
    ? [...current.matchAll(/case '([^']+)':\s*handle/g)].map(m => m[1])
    : [...current.match(/  const (?:ST|STATUS) = \{([\s\S]*?)\n  \};/)[1].matchAll(/:\s*'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(declaredPhases, phases[i], `${app}: phase coverage changed`);
  const oldAccepted = await run(joinOld, i, {});
  assert.equal(oldAccepted.state.role, 'guest');
  assert.deepEqual(oldAccepted.events.map(e => e[0]), ['disconnect-remove', 'saveSession', 'listener']);
  const cases = [
    { id: 'existing-guest-in-game', spec: {}, message: 'このルームはすでにゲームが始まっています' },
    { id: 'unused-name-in-game', spec: { nickname: 'new' }, message: 'このルームはすでにゲームが始まっています' },
    { id: 'host-in-game', spec: { nickname: 'host' }, message: 'そのニックネームはすでに使われています' },
    { id: 'host-player-missing', spec: { nickname: 'host', missingHost: true }, message: 'そのニックネームはすでに使われています' },
    { id: 'waiting-duplicate', spec: { status: 'waiting' }, message: 'そのニックネームはすでに使われています' },
    { id: 'waiting-host', spec: { status: 'waiting', nickname: 'host' }, message: 'そのニックネームはすでに使われています' },
  ];
  if (app === 'pittari-meter') for (const hostPlays of [true, false]) cases.push({ id: `hostPlays-${hostPlays}`, spec: { nickname: 'host', hostPlays }, message: 'そのニックネームはすでに使われています' });
  for (const test of cases) {
    const r = await run(joinNew, i, test.spec);
    assert.deepEqual(r.errors, [test.message]); assert.deepEqual(r.events, []);
    assert.deepEqual(r.room, r.before); assert.equal(r.state.role, null);
    assert.equal(r.state.nickname, null); assert.equal(r.state.roomRef, null);
    assert.equal(r.state.roomCode, null);
    results.push({ app, case: test.id, pass: true });
  }
  const spec = { status: 'waiting', nickname: 'new' };
  const waiting = await run(joinNew, i, spec);
  assert.deepEqual(waiting, await run(joinOld, i, spec));
  assert.equal(waiting.state.role, 'guest'); assert.equal(waiting.room.players.new.isHost, false);
  assert.deepEqual(waiting.events.map(e => e[0]), ['transaction', 'disconnect-remove', 'saveSession', 'screen', 'listener']);
  results.push({ app, case: 'waiting-new-unchanged', pass: true });
  for (const missingGuest of [false, true]) {
    const r = await run(reconnect, i, { missingGuest }, 'tryReconnect');
    assert.equal(r.result, true); assert.equal(r.state.role, 'guest');
    assert.deepEqual(r.events.map(e => e[0]), missingGuest ? ['set', 'disconnect-remove', 'listener'] : ['disconnect-remove', 'listener']);
    assert.deepEqual(r.overlays, [true, false]);
    if (!missingGuest) assert.deepEqual(r.room, r.before);
    else {
      const expected = app === 'pittari-meter' ? { isHost: false, guess: null, decided: false }
        : app === 'do-mannaka' ? { score: 7, isHost: false, answer: null }
          : app === 'tatoe-gp' ? { score: 7, isHost: false, answer: 'saved', vote: 'saved-vote' }
            : { score: 7, isHost: false };
      assert.deepEqual(r.room.players.guest, expected);
    }
    results.push({ app, case: `saved-guest-missing-${missingGuest}`, pass: true });
  }
  for (const missingHost of [false, true]) {
    const r = await run(reconnect, i, { nickname: 'host', role: 'host', missingHost }, 'tryReconnect');
    assert.equal(r.result, true); assert.equal(r.state.role, 'host');
    assert.deepEqual(r.events.map(e => e[0]), app === 'do-mannaka' ? ['hostPresence', 'listener'] : ['update', 'disconnect-update', 'listener']);
    results.push({ app, case: `saved-host-missing-${missingHost}`, pass: true });
  }
  for (const spec of [{ nickname: 'host' }, { nickname: 'host', missingHost: true }, { noSession: true }, { absent: true }]) {
    const r = await run(reconnect, i, spec, 'tryReconnect');
    assert.equal(r.result, false); assert.equal(r.state.role, null);
    assert.deepEqual(r.events.map(e => e[0]), spec.noSession ? [] : ['clearSession']);
    results.push({ app, case: `reconnect-reject-${JSON.stringify(spec)}`, pass: true });
  }
  results.push({ app, case: 'baseline-name-only-accepted', pass: true });
  // Additional matrix overlaps the earlier saved-guest cases intentionally.
  for (const status of phases[i]) for (const missingGuest of [false, true]) {
    const spec = { status, missingGuest };
    const r = await run(reconnect, i, spec, 'tryReconnect');
    assert.deepEqual(r, await run(extract(old, 'tryReconnect'), i, spec, 'tryReconnect'));
    assert.equal(r.result, true); assert.equal(r.state.role, 'guest');
    assert.deepEqual(r.events.map(e => e[0]), missingGuest ? ['set', 'disconnect-remove', 'listener'] : ['disconnect-remove', 'listener']);
    assert.deepEqual(r.overlays, [true, false]);
    if (!missingGuest) assert.deepEqual(r.room, r.before);
    else assert.equal(r.room.players.guest.isHost, false);
    results.push({ app, case: `phase-saved-guest-${status}-missing-${missingGuest}`, pass: true });
  }
  const status = phases[i].at(-1), deleteAt = 1900000000000;
  const ending = await run(reconnect, i, { status, deleteAt, nickname: 'host', role: 'host' }, 'tryReconnect');
  assert.equal(ending.result, true);
  const scheduler = status === 'finished' ? 'scheduleFinishedCleanup' : 'scheduleDoneCleanup';
  assert.deepEqual(ending.events.filter(e => e[0].startsWith('schedule')), [[scheduler, paths[i] + '/ABCDEF', deleteAt]]);
  assert.deepEqual(ending, await run(extract(old, 'tryReconnect'), i, { status, deleteAt, nickname: 'host', role: 'host' }, 'tryReconnect'));
  results.push({ app, case: 'finished-host-reschedules-existing-deadline', pass: true });
  for (const role of ['guest', 'host']) {
    const expired = await run(reconnect, i, { expired: true, role, nickname: role }, 'tryReconnect');
    assert.equal(expired.result, false); assert.equal(expired.room, null); assert.equal(expired.session, null);
    assert.deepEqual(expired.events, [['remove', paths[i] + '/ABCDEF'], ['clearSession']]);
    assert.deepEqual(expired.overlays, [true, false]);
    assert.equal(expired.state.role, null); assert.equal(expired.state.roomRef, null);
    results.push({ app, case: `expired-stub-saved-${role}`, pass: true });
  }
  const expiredJoin = await run(joinNew, i, { expired: true });
  assert.deepEqual(expiredJoin.errors, ['このルームは期限切れのため終了しました']);
  assert.deepEqual(expiredJoin.events, [['remove', paths[i] + '/ABCDEF']]);
  assert.equal(expiredJoin.state.role, null);
  results.push({ app, case: 'expired-stub-join', pass: true });
}
console.log(JSON.stringify({ baseline, sources, cases: results.length, results, limitations: [
  'Actual guestJoin/tryReconnect functions only. No browser DOM, SDK, network, onDisconnect execution or multi-client transaction races.',
  'Validation/auth/expiry/session parsing/presence/listener helpers are stubs; their behavior is not certified. do-mannaka host presence is call-only.',
  'Existing missing-player recreation is unchanged: do-mannaka loses answer, pittari resets guess/decided, tatoe uses saved answer/vote; full answer retention is not implemented.',
  'No proof of same-tab identity: sessionStorage is not authentication; cloned or edited sessions are not prevented by this change.',
  'tryReconnect source is byte-identical. Existing read/write recreation races and stale session risks are not fixed.',
  'The 50-case phase matrix overlaps earlier guest checks; counts are assertions, not unique user journeys. Missing-player set is existing behavior even in finished phases.',
  'Expiry is a forced boolean stub, not real TTL arithmetic. Cleanup rescheduling records helper arguments only; no timer, deletion deadline or host-presence implementation is exercised.',
] }, null, 2));
