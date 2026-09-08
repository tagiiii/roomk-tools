// Run from repository root: node docs/reports/evidence/b31-kaburazu-hint-presence-2026-09-08.mjs
// Or provide repository root as the first argument. No network/SDK/browser is initialized.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const repo = process.argv[2] || process.cwd();
const expectedSourceSHA256 = '3e1b3baac2dd66a204dcf95c676399f04b51dc824bdf50533ea8f189b2a7f65c';
const sourcePath = `${repo}/apps/kaburazu-hint/index.html`;
const observedSourceHashes = new Set();
const clone = value => structuredClone(value);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function loadSource() {
  const html = fs.readFileSync(sourcePath, 'utf8');
  const start = html.indexOf('const { authReady, db } = RoomkRTDB.initFirebase(firebase);');
  const end = html.indexOf('(function init() {');
  assert(start > 0 && end > start && html.indexOf('(function init() {', end + 1) === -1);
  const source = html.slice(start, end);
  new vm.Script(source);
  const init = html.slice(end, html.indexOf('</script>', end));
  const shared = fs.readFileSync(`${repo}/apps/shared/js/rtdb-utils.js`, 'utf8');
  const ttl = shared.slice(shared.indexOf('  function getHostDisconnectedAt('), shared.indexOf('  function generateRoomCode('));
  const esc = shared.slice(shared.indexOf('  function esc('), shared.indexOf('  function initFirebase('));
  const cancel = shared.slice(shared.indexOf('  function cancelRoomOnDisconnect('), shared.indexOf('  function showToast('));
  const utils = fs.readFileSync(`${repo}/apps/shared/js/utils.js`, 'utf8');
  const shuffle = utils.slice(utils.indexOf('function shuffle('), utils.indexOf('\n}', utils.indexOf('function shuffle(')) + 2).replace('', '');
  assert(shuffle.includes('Math.random()') && html.includes("import { shuffle } from '../shared/js/utils.js'"));
  assert(ttl.includes('>= ttlMs') && esc.includes('.replace('));
  const sha256 = createHash('sha256').update(html).digest('hex'); observedSourceHashes.add(sha256); assert.equal(sha256,expectedSourceSHA256,'B31 source differs from reviewed fixture');
  return { html, source, init, ttl, esc, cancel, shuffle, sha256 };
}

function fixture(status = 'clue-input') {
  return {
    host: 'host', hostConnected: true, gameId: 'game-one', status,
    players: { host: { isHost: true }, guest: { isHost: false }, peer: { isHost: false } },
    turnOrder: ['peer', 'guest', 'host'], usedWords: [0],
    round: { number: 1, totalRounds: 3, guesser: 'peer', secretWord: '秘密お題',
      hints: {}, excludedHintIds: [], missingHintIds: [], answer: null, passed: false, isCorrect: null },
    history: {},
  };
}

function createHarness({ data = fixture(), role = 'guest', nickname = 'guest', code = 'ABCDEF', search = '', localClockOffset = 0 } = {}) {
  const loaded = loadSource();
  let clock = 2_000_000, connected = false, nextKey = 0, txnId = 0;
  const stores = new Map([[`kaburazuhint_rooms/${code}`, clone(data)]]);
  const refs = new Map(), listeners = new Map(), reservations = new Map(), timers = new Map();
  const writes = [], calls = [], messages = [], errors = [], elements = new Map();
  const hooks = {};
  const read = path => {
    if (path === '.info/connected') return connected;
    if (path === '.info/serverTimeOffset') return 0;
    const parts = path.split('/'), base = parts.slice(0, 2).join('/');
    return parts.slice(2).reduce((value, key) => value?.[key], stores.get(base)) ?? null;
  };
  const snapshot = path => { const value = clone(read(path)); return { exists: () => value !== null, val: () => clone(value) }; };
  const emit = () => { for (const [path, callbacks] of [...listeners]) if (!path.startsWith('.info/')) for (const fn of [...callbacks]) fn(snapshot(path)); };
  const put = (path, value) => {
    const parts = path.split('/'), base = parts.slice(0, 2).join('/'), rest = parts.slice(2);
    if (!rest.length) { stores.set(base, clone(value)); return; }
    if (value == null && read(base) == null) return;
    let root = stores.get(base) || {}, node = root;
    const chain = [];
    for (const key of rest.slice(0, -1)) { chain.push([node, key]); node = node[key] ||= {}; }
    if (value == null) delete node[rest.at(-1)]; else node[rest.at(-1)] = clone(value);
    for (const [parent, key] of chain.reverse()) if (!Object.keys(parent[key]).length) delete parent[key];
    stores.set(base, Object.keys(root).length ? root : null);
  };
  function ref(path) {
    if (refs.has(path)) return refs.get(path);
    const value = {
      key: path.split('/').at(-1), path,
      toString: () => `memory://${path}`,
      child: part => ref(`${path}/${part}`),
      push: () => ref(`${path}/id-${++nextKey}`),
      async get() { calls.push({ kind: 'get', path }); if (hooks.get) return hooks.get(path, snapshot); return snapshot(path); },
      on(event, callback, cancel) {
        assert.equal(event, 'value'); calls.push({ kind: 'on', path });
        if (!listeners.has(path)) listeners.set(path, new Set());
        listeners.get(path).add(callback);
        if (hooks.subscribe) hooks.subscribe(path, callback, cancel, snapshot); else callback(snapshot(path));
      },
      off(event, callback) {
        calls.push({ kind: 'off', path, exact: !!callback });
        if (callback) listeners.get(path)?.delete(callback); else listeners.delete(path);
      },
      async transaction(update, completion, applyLocally) {
        const call = { kind: 'transaction', path, id: ++txnId, applyLocally };
        calls.push(call);
        if (hooks.beforeTransaction) await hooks.beforeTransaction(call);
        if (hooks.rejectTransaction?.(call)) throw Error('Intentional transaction rejection');
        if (hooks.retryUpdate) hooks.retryUpdate(call, update, clone(read(path)));
        const next = update(clone(read(path)));
        const committed = next !== undefined;
        if (committed) { put(path, next); writes.push({ ...call, value: clone(next) }); emit(); }
        const result = { committed, snapshot: snapshot(path) };
        if (hooks.afterTransaction) await hooks.afterTransaction(call, result);
        if (completion) completion(null, committed, result.snapshot);
        return result;
      },
      async set(next) { calls.push({ kind: 'set', path }); put(path, next); writes.push({ kind: 'set', path, value: clone(next) }); emit(); },
      async update(changes) {
        calls.push({ kind: 'update', path });
        for (const [key, next] of Object.entries(changes)) put(`${path}/${key}`, next);
        writes.push({ kind: 'update', path, value: clone(changes) }); emit();
      },
      async remove() { calls.push({ kind: 'remove', path }); if(hooks.rejectRemove?.(path))throw Error('Intentional remove rejection'); put(path, null); writes.push({ kind: 'remove', path }); emit(); },
      onDisconnect() {
        return {
          async remove() { calls.push({ kind: 'reserve-remove', path }); if(hooks.rejectReservation?.(path))throw Error('Intentional reservation rejection'); reservations.set(path, { kind: 'remove' }); await hooks.reserve?.(path); },
          async update(next) { calls.push({ kind: 'reserve-update', path }); if(hooks.rejectReservation?.(path))throw Error('Intentional reservation rejection'); reservations.set(path, { kind: 'update', value: clone(next) }); await hooks.reserve?.(path); },
          async set(next) { calls.push({ kind: 'reserve-set', path }); reservations.set(path, { kind: 'set', value: clone(next) }); await hooks.reserve?.(path); },
          async cancel() {
            calls.push({ kind: 'cancel', path }); await hooks.cancel?.(path);
            for (const key of [...reservations.keys()]) if (key === path || key.startsWith(`${path}/`)) reservations.delete(key);
          },
        };
      },
    };
    refs.set(path, value); return value;
  }
  function element(tag = 'div') {
    let html = '', text = ''; const classes = new Set();
    const value = {
      tag, id: '', style: {}, dataset: {}, children: [], value: '', disabled: false, hidden: false, isConnected: true,
      classList: { add: (...names) => names.forEach(n => classes.add(n)), remove: (...names) => names.forEach(n => classes.delete(n)), contains: n => classes.has(n), toggle(n, force) { const yes = force ?? !classes.has(n); if (yes) classes.add(n); else classes.delete(n); return yes; } },
      appendChild(child) { this.children.push(child); child.parent = this; return child; },
      remove() { this.isConnected = false; }, focus() {}, select() {},
      addEventListener() {}, setAttribute(name, content) { this[name] = String(content); },
      contains(child) { return child === this || this.children.some(c => c.contains(child)); },
      querySelectorAll(selector) { return this.children.flatMap(c => [c, ...c.querySelectorAll('*')]).filter(e => matches(e, selector)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    };
    Object.defineProperty(value, 'className', { get: () => [...classes].join(' '), set: v => { classes.clear(); v.split(/\s+/).filter(Boolean).forEach(n => classes.add(n)); } });
    Object.defineProperty(value, 'innerHTML', { get: () => html, set: v => { html = String(v); text = ''; value.children = []; } });
    Object.defineProperty(value, 'textContent', { get: () => text, set: v => { text = String(v); html = ''; } });
    return value;
  }
  function matches(el, selector) {
    if (selector === '*') return true;
    if (selector.startsWith('#')) return el.id === selector.slice(1);
    if (selector.startsWith('.')) return selector.slice(1).split('.').every(n => el.classList.contains(n));
    return el.tag === selector;
  }
  for (const match of loaded.html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const el = element(match[1]); el.id = match[3]; el.className = match[2].match(/class="([^"]*)"/)?.[1] || '';
    elements.set(el.id, el);
  }
  const el = id => { assert(elements.has(id), `Unknown DOM id ${id}`); return elements.get(id); };
  const storage = new Map(), location = { origin: 'https://example.invalid', pathname: '/kaburazu-hint/', search };
  const context = vm.createContext({
    console: { warn: (...args) => messages.push(args.map(String)), error: (...args) => errors.push(args.map(String)) },
    now: () => clock, Date: class extends Date { static now() { return clock + localClockOffset; } }, URLSearchParams, URL, location,
    window: { scrollTo() {}, open: (...args) => calls.push({ kind: 'window-open', args }) },
    history: { replaceState(_a, _b, url) { location.search = url.includes('?') ? url.slice(url.indexOf('?')) : ''; calls.push({ kind: 'url', url }); } },
    document: { getElementById: el, createElement: element, title: '', body: element('body'),
      querySelectorAll: selector => selector.split(',').flatMap(s => [...elements.values()].filter(e => matches(e, s.trim()))),
      querySelector: selector => [...elements.values()].find(e => matches(e, selector)) || null },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    navigator: { clipboard: { writeText: async text => calls.push({ kind: 'clipboard-sink', text }) } },
    firebase: { database: { ServerValue: { TIMESTAMP: 2_000_000 } } },
    setTimeout: (fn, delay) => { const id = ++nextKey; timers.set(id, { fn, delay }); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    setInterval: () => { throw Error('Unexpected interval: extend explicit model'); },
  });
  const helper = vm.runInContext(`(() => {${loaded.ttl}\n${loaded.esc}\n${loaded.cancel}\nreturn {isRoomExpired,getHostDisconnectedAt,esc,cancelRoomOnDisconnect};})()`, context);
  vm.runInContext(loaded.shuffle, context);
  context.RoomkRTDB = { ...helper, now: () => clock, generateRoomCode: () => 'ABCDEF',
    initFirebase: () => ({ authReady: Promise.resolve(), db: { ref } }),
    showToast: (...args) => messages.push(args),
  };
  vm.runInContext(loaded.source, context);
  context.__roomRef = ref(`kaburazuhint_rooms/${code}`);
  context.__setup = { role, nickname, roomCode: code, roomRef: context.__roomRef, lastRoom: clone(data) };
  vm.runInContext('Object.assign(state,__setup)', context);
  return {
    loaded, hooks, writes, calls, reservations, listeners, timers, storage, messages, errors, el, ref,
    run: code => vm.runInContext(code, context), global: (key, value) => { context[key] = value; },
    room: (which = code) => stores.get(`kaburazuhint_rooms/${which}`),
    setRoom: (value, which = code) => stores.set(`kaburazuhint_rooms/${which}`, clone(value)), emit,
    setClock: value => { clock = value; },
    async online(value) { connected = value; for (const fn of listeners.get('.info/connected') || []) fn(snapshot('.info/connected')); await Promise.resolve(); },
    async disconnect() {
      await this.online(false);
      for (const [path, action] of [...reservations]) {
        if (action.kind === 'remove') put(path, null);
        else if (action.kind === 'set') put(path, action.value);
        else for (const [key, value] of Object.entries(action.value)) put(`${path}/${key}`, value);
        reservations.delete(path);
      }
      emit();
    },
    async drain() {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      if (vm.runInContext('typeof guestPresenceWork', context) !== 'undefined') await vm.runInContext('guestPresenceWork', context);
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

const checks=[],failures=[];
async function test(name,fn){try{await fn();checks.push(name);}catch(e){failures.push({name,error:e.stack});}}
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
async function guest(data=fixture()){const h=createHarness({data});h.run('startRoomListener();startGuestPresence()');await h.online(true);await h.drain();assert.equal(h.run('guestCanAct()'),true);return h;}
function host(data=fixture()){const h=createHarness({data,role:'host',nickname:'host'});h.run('startRoomListener()');return h;}
for(const phase of ['waiting','clue-input','clue-review','answer','judge','result','finished']) await test(`guest presence and reconnect retain round/history in ${phase}`,async()=>{
 const d=fixture(phase);d.round.hints.guest={text:'既提出',normalized:'きていしゅつ'};d.history={'0':{isCorrect:true}};
 const h=await guest(d);assert.deepEqual(h.room().round,d.round);assert.deepEqual(h.room().history,d.history);
 const first=Object.keys(h.room().players.guest.connections)[0];await h.disconnect();await h.drain();
 assert(h.room().players.guest);assert.equal(h.run('guestCanAct()'),false);assert.deepEqual(h.room().round,d.round);
 await h.online(true);await h.drain();const current=Object.keys(h.room().players.guest.connections);assert.equal(current.length,1);assert.notEqual(current[0],first);
});
await test('reservation pending disconnect does not publish alive',async()=>{
 const h=createHarness(),gate=deferred(),entered=deferred();h.hooks.reserve=async()=>{entered.resolve();await gate.promise;};
 h.run('startRoomListener();startGuestPresence()');await h.online(true);await entered.promise;await h.disconnect();gate.resolve();await h.drain();
 assert.equal(h.room().players.guest.connections,undefined);assert.equal(h.run('guestCanAct()'),false);
});
for(const missing of ['player','room']) await test(`alive pending ${missing} deletion never recreates`,async()=>{
 const h=createHarness(),gate=deferred(),entered=deferred();h.hooks.beforeTransaction=async()=>{entered.resolve();await gate.promise;};
 h.run('startRoomListener();startGuestPresence()');await h.online(true);await entered.promise;
 const d=clone(h.room());if(missing==='player'){delete d.players.guest;h.setRoom(d);}else h.setRoom(null);h.emit();gate.resolve();await h.drain();
 assert.equal(h.room()?.players?.guest,undefined);assert.equal(h.run('state.roomRef'),null);
});
await test('explicit guest exit retains submitted round and history',async()=>{
 const d=fixture();d.round.hints.guest={text:'saved',normalized:'saved'};d.history={1:{marker:'saved'}};const h=await guest(d);
 await h.run('leaveGame()');assert.equal(h.room().players.guest,undefined);assert.deepEqual(h.room().round,d.round);assert.deepEqual(h.room().history,d.history);assert.equal(h.reservations.size,0);
});
await test('hint first wins and forbidden guesser cannot hint',async()=>{
 const h=await guest();h.el('clue-hint-input').value='first';await h.run('submitHint()');h.el('clue-hint-input').value='second';await h.run('submitHint()');assert.equal(h.room().round.hints.guest.text,'first');
 const d=fixture();d.round.guesser='guest';const g=await guest(d);g.el('clue-hint-input').value='not allowed';await g.run('submitHint()');assert.deepEqual(g.room().round.hints,{});
});
for(const mutation of ['generation','game','round','player','role','TTL','phase','ref']) await test(`late hint rejected after ${mutation} changes`,async()=>{
 const h=await guest(),gate=deferred(),entered=deferred();h.hooks.beforeTransaction=async()=>{entered.resolve();await gate.promise;};h.el('clue-hint-input').value='late';const work=h.run('submitHint()');await entered.promise;
 const d=clone(h.room());
 if(mutation==='generation')await h.online(false);
 if(mutation==='game')d.gameId='different-game';
 if(mutation==='round')d.round.number++;
 if(mutation==='player')delete d.players.guest;
 if(mutation==='role')d.players.guest.isHost=true;
 if(mutation==='TTL'){d.hostConnected=false;d.hostDisconnectedAt=1880000;}
 if(mutation==='phase')d.status='clue-review';
 if(mutation==='ref'){h.setRoom(fixture(),'OTHERX');h.global('__newRef',h.ref('kaburazuhint_rooms/OTHERX'));h.run('state.roomRef=__newRef');}
 h.setRoom(d);gate.resolve();await work;assert.equal(h.room().round.hints.guest,undefined);
});
for(const first of ['answer','pass'])await test(`${first} wins answer/pass race without overwriting`,async()=>{
 const d=fixture('answer');d.round.guesser='guest';const h=await guest(d);
 await h.run(first==='answer'?"submitGuess('reply',false)":"submitGuess(null,true)");await h.run(first==='answer'?"submitGuess(null,true)":"submitGuess('late',false)");
 assert.equal(h.room().round.passed,first==='pass');assert.equal(h.room().round.answer,first==='answer'?'reply':null);
});
await test('irrelevant presence value preserves manual excluded draft',async()=>{
 const d=fixture('clue-review');d.round.hints={guest:{text:'one',normalized:'one'},host:{text:'two',normalized:'two'}};
 const h=host(d);h.run("toggleHint('guest')");assert(h.run("reviewExcluded.has('guest')"));d.players.guest.connections={fresh:true};h.setRoom(d);h.emit();assert(h.run("reviewExcluded.has('guest')"));
});
await test('two-stage confirmation commits exclusions before answer and reload preserves them',async()=>{
 const d=fixture('clue-review');d.round.hints={guest:{text:'one',normalized:'one'},host:{text:'two',normalized:'two'}};
 const h=host(d),gate=deferred(),entered=deferred();h.run("toggleHint('guest')");h.hooks.afterTransaction=async(call)=>{if(call.id===1){entered.resolve();await gate.promise;}};
 const work=h.run('confirmHints()');await entered.promise;assert.equal(h.room().status,'clue-review');assert.deepEqual(h.room().round.excludedHintIds,['guest']);
 const reloaded=host(h.room());assert(reloaded.run("reviewExcluded.has('guest')"));gate.resolve();await work;assert.equal(h.room().status,'answer');
});
for(const mutation of ['game','excluded','player','ref'])await test(`confirmation second stage aborts changed ${mutation}`,async()=>{
 const d=fixture('clue-review');d.round.hints={guest:{text:'one',normalized:'one'},host:{text:'two',normalized:'two'}};
 const h=host(d),gate=deferred(),entered=deferred();h.hooks.afterTransaction=async(call)=>{if(call.id===1){entered.resolve();await gate.promise;}};
 const work=h.run('confirmHints()');await entered.promise;const changed=clone(h.room());
 if(mutation==='game')changed.gameId='replay';if(mutation==='excluded')changed.round.excludedHintIds=['guest'];if(mutation==='player')delete changed.players.guest;
 if(mutation==='ref'){h.global('__other',h.ref('kaburazuhint_rooms/OTHERX'));h.run('state.roomRef=__other');}
 h.setRoom(changed);gate.resolve();await work;assert.equal(h.room().status,'clue-review');
});
await test('old finally does not clear new operation owner',async()=>{
 const h=await guest(),gate=deferred(),entered=deferred();h.hooks.beforeTransaction=async()=>{entered.resolve();await gate.promise;};h.el('clue-hint-input').value='old';const work=h.run('submitHint()');await entered.promise;
 h.run('state.operations.hint={newOwner:true}');gate.resolve();await work;assert.equal(h.run('state.operations.hint.newOwner'),true);assert.deepEqual(h.room().round.hints,{});
});
await test('rejected manual confirmation clears owner and can retry',async()=>{
 const d=fixture('clue-review');d.round.hints={guest:{text:'one',normalized:'one'}};const h=host(d);h.hooks.rejectTransaction=()=>true;
 await h.run('confirmHints()');assert.equal(h.run('state.operations.review'),undefined);h.hooks.rejectTransaction=()=>false;await h.run('confirmHints()');assert.equal(h.room().status,'answer');
});
await test('departed hint does not satisfy missing current giver; counters agree',async()=>{
 const d=fixture();d.round.hints={departed:{text:'prior',normalized:'prior'},host:{text:'host',normalized:'host'}};
 const h=host(d);await tick();assert.equal(h.room().status,'clue-input');assert.equal(h.el('clue-progress').textContent,'1 / 2 人が送信済み');
 const s=createHarness({data:d,role:'spectator',nickname:null});s.run('startRoomListener()');assert(s.el('spec-content').innerHTML.includes('1 / 2'));assert.equal(s.writes.length,0);
});
await test('host guesser auto transition is two-stage and keeps exclusions',async()=>{
 const d=fixture();d.round.guesser='host';d.round.hints={guest:{text:'same',normalized:'same'},peer:{text:'same',normalized:'same'}};const h=host(d);await tick();assert.equal(h.room().status,'answer');
 assert.deepEqual(h.room().round.excludedHintIds,['guest','peer']);assert.equal(h.writes[0].value.status,'clue-input');assert.equal(h.writes[1].value.status,'answer');
});
await test('judgement and history are atomic, history cannot be replaced',async()=>{
 const d=fixture('judge');d.round.answer='reply';d.round.hints={guest:{text:'saved',normalized:'saved'}};const h=host(d);
 await h.run('judgeAnswer(true)');assert.equal(h.room().status,'result');assert.equal(h.room().history[1].isCorrect,true);assert.equal(h.writes.length,1);
 const before=clone(h.room().history);await h.run('judgeAnswer(false)');assert.deepEqual(h.room().history,before);
});
for(const reason of ['few','offline'])await test(`failed replay (${reason}) preserves original timer`,async()=>{
 const d=fixture('finished');if(reason==='few')delete d.players.peer;else d.players.guest={isHost:false,presenceVersion:1};const h=host(d);const timer=h.run('state.cleanupTimer');
 await h.run('playAgain()');assert.equal(h.run('state.cleanupTimer'),timer);assert(h.timers.has(timer));assert.equal(h.room().status,'finished');
});
await test('successful replay creates different gameId at same number and clears old timer',async()=>{
 const h=host(fixture('finished')),old=h.run('state.cleanupTimer');await h.run('playAgain()');assert.notEqual(h.room().gameId,'game-one');assert.equal(h.room().round.number,1);assert.equal(h.room().status,'clue-input');assert(!h.timers.has(old));
});
await test('captured finished timer does not delete another room',async()=>{
 const h=host(fixture('finished')),fn=h.timers.get(h.run('state.cleanupTimer')).fn;const newRoom=fixture();h.setRoom(newRoom,'OTHERX');h.global('__other',h.ref('kaburazuhint_rooms/OTHERX'));h.global('__data',newRoom);h.run('state.roomRef=__other;state.lastRoom=__data');fn();await tick();assert.deepEqual(h.room('OTHERX'),newRoom);assert(h.room());
});
for(const phase of ['waiting','finished'])await test(`legacy ${phase} generates gameId on start/replay`,async()=>{
 const d=fixture(phase);delete d.gameId;const h=host(d);await h.run(phase==='waiting'?'startGame()':'playAgain()');assert.equal(h.room().status,'clue-input');assert.equal(typeof h.room().gameId,'string');
});
await test('missing gameId rejects active actions but retains display/exit',async()=>{
 const d=fixture();delete d.gameId;const h=await guest(d);h.el('clue-hint-input').value='not sent';await h.run('submitHint()');assert.deepEqual(h.room().round.hints,{});assert.equal(h.run('state.currentScreen'),'clue');await h.run('leaveGame()');assert.equal(h.room().players.guest,undefined);
});
for(const offset of [-1,0,1])await test(`actual shared TTL boundary ${offset}`,async()=>{
 const d=fixture();d.hostConnected=false;d.hostDisconnectedAt=String(2000000-120000-offset);const h=createHarness({data:d,role:'host',nickname:'host'});
 assert.equal(h.run('isRoomExpired(state.lastRoom)'),offset>=0);await h.run("runOperation('hint','clue-input',room=>({...room,probe:true}))");assert.equal(h.room().probe,offset<0?true:undefined);
});
for(const outcome of ['commit','abort','reject','subscribe-error'])await test(`join temporary listener ${outcome}, existing listener preserved`,async()=>{
 const h=createHarness(),ref=h.ref('kaburazuhint_rooms/ABCDEF'),existing=()=>{};ref.on('value',existing);h.global('__ref',ref);
 if(outcome==='reject')h.hooks.rejectTransaction=()=>true;
 if(outcome==='subscribe-error')h.hooks.subscribe=(_path,_cb,cancel)=>cancel(Error('intentional subscription denial'));
 const call=h.run(`joinTransaction(__ref,room=>${outcome==='abort'?'undefined':'room'})`);
 if(['reject','subscribe-error'].includes(outcome))await assert.rejects(call);else assert.equal((await call).committed,outcome==='commit');
 assert.equal(h.listeners.get(ref.path).size,1);assert(h.listeners.get(ref.path).has(existing));if(outcome==='subscribe-error')assert.equal(h.calls.filter(c=>c.kind==='transaction').length,0);
});
for(const operation of ['finished','leave','expired'])await test(`host ${operation} cancellation rejection retains room and reservation`,async()=>{
 const d=fixture('finished');if(operation==='expired'){d.hostConnected=false;d.hostDisconnectedAt=1800000;}
 const h=createHarness({data:d,role:'host',nickname:'host'});await h.run('registerHostReservation(state.roomRef)');h.hooks.cancel=async()=>{throw Error('intentional cancel rejection');};
 const call=h.run(operation==='finished'?"deleteFinishedRoom(captureAction('finished'))":operation==='leave'?'leaveGame()':'removeExpiredRoom(state.roomRef)');
 if(operation==='expired')await assert.rejects(call);else await call;assert(h.room());assert.equal(h.reservations.size,1);assert.equal(h.writes.length,0);
});
await test('guest cancellation rejection stops explicit deletion; retry can remove safely',async()=>{
 const h=await guest();h.hooks.cancel=async()=>{throw Error('intentional cancel rejection');};await h.run('leaveGame()');await h.drain();assert(h.room().players.guest);assert.equal(h.run('state.expectedRoomRemoval'),false);
 h.hooks.cancel=undefined;await h.run('leaveGame()');assert.equal(h.room().players.guest,undefined);assert.equal(h.reservations.size,0);
});
await test('finished deletion queued before replay wins without resurrecting room',async()=>{
 const h=host(fixture('finished'));await h.run('registerHostReservation(state.roomRef)');const gate=deferred(),entered=deferred();h.hooks.cancel=async()=>{entered.resolve();await gate.promise;};
 const deletion=h.run("deleteFinishedRoom(captureAction('finished'))");await entered.promise;const replay=h.run('playAgain()');await tick();assert.equal(h.room().status,'finished');gate.resolve();await deletion;await replay;await tick();assert.equal(h.room(),null);assert.equal(h.reservations.size,0);
});
await test('external same-ref replay during cancel restores host reservation on deletion abort',async()=>{
 const h=host(fixture('finished'));await h.run('registerHostReservation(state.roomRef)');const gate=deferred(),entered=deferred();h.hooks.cancel=async()=>{entered.resolve();await gate.promise;};
 const deletion=h.run("deleteFinishedRoom(captureAction('finished'))");await entered.promise;const d=fixture();d.gameId='external-replay';h.setRoom(d);h.emit();gate.resolve();await deletion;assert.equal(h.room().gameId,'external-replay');assert.equal(h.reservations.size,1);assert.equal([...h.reservations.values()][0].kind,'update');
});
await test('pending host reservation then leave is serialized and cannot recreate room',async()=>{
 const d=fixture('result');d.hostConnected=false;d.hostDisconnectedAt=1999999;const h=createHarness({data:d,role:'host',nickname:'host'}),gate=deferred(),entered=deferred();h.hooks.reserve=async()=>{entered.resolve();await gate.promise;};
 const restore=h.run("restoreHostConnection(captureAction('result'))");await entered.promise;const leave=h.run('leaveGame()');await tick();assert(h.room());gate.resolve();await restore;await leave;assert.equal(h.room(),null);await h.disconnect();assert.equal(h.room(),null);
});
await test('TTL deletion latest host return prevents removal and re-enables guest presence',async()=>{
 const h=await guest(),d=clone(h.room());d.hostConnected=false;d.hostDisconnectedAt=1880000;h.setRoom(d);h.run('state.lastRoom=JSON.parse(JSON.stringify(state.lastRoom))');
 const gate=deferred(),entered=deferred();h.hooks.beforeTransaction=async()=>{entered.resolve();await gate.promise;};const work=h.run('expireGuestRoom(state.roomRef)');await entered.promise;
 const returned=clone(h.room());returned.hostConnected=true;returned.hostDisconnectedAt=null;h.setRoom(returned);gate.resolve();h.hooks.beforeTransaction=undefined;await work;await h.drain();assert(h.room());assert.equal(h.run('guestCanAct()'),true);
});
for(const phase of ['waiting','clue-input','clue-review','answer','judge','result','finished'])await test(`spectator ${phase} read-only and protected content`,async()=>{
 const d=fixture(phase);d.round.hints={guest:{text:'excludedHint',normalized:'excluded'},host:{text:'visibleHint',normalized:'visible'}};d.round.excludedHintIds=['guest'];d.round.answer='reply';const h=createHarness({data:d,role:'spectator',nickname:null});h.run('startRoomListener()');await tick();
 assert.equal(h.writes.length,0);assert.equal(h.reservations.size,0);assert.equal(h.calls.filter(c=>/transaction|cancel|reserve/.test(c.kind)).length,0);
 const html=h.el('spec-content').innerHTML;if(!['result','finished'].includes(phase))assert(!html.includes(d.round.secretWord));if(['clue-input','clue-review','judge'].includes(phase))assert(!html.includes('visibleHint'));if(phase==='answer'){assert(html.includes('visibleHint'));assert(!html.includes('excludedHint'));}
 if(phase==='finished'){h.setRoom(null);h.emit();assert.equal(h.el('spec-content').innerHTML,html);h.setRoom(fixture('clue-input'));h.emit();assert.equal(h.el('spec-content').innerHTML,html);assert.equal(h.run('state.roomRef'),null);}
 await h.run('leaveGame()');assert.equal(h.writes.length,0);assert.equal(h.run('state.currentScreen'),'top');
});
await test('spectator expired room does not delete database',async()=>{
 const d=fixture();d.hostConnected=false;d.hostDisconnectedAt=1880000;const h=createHarness({data:d,role:'spectator',nickname:null});h.run('startRoomListener()');assert.deepEqual(h.room(),d);assert.equal(h.writes.length,0);assert.equal(h.run('state.roomRef'),null);
});
for(const phase of ['waiting','finished'])await test(`${phase} phase-changing transaction uses false and fixed gameId on synthetic retry`,async()=>{
 const h=host(fixture(phase));let firstId;
 h.hooks.retryUpdate=(call,update,room)=>{assert.equal(call.applyLocally,false);const first=update(clone(room));firstId=first.gameId;assert(firstId);assert.equal(h.room().status,phase);};
 await h.run(phase==='waiting'?'startGame()':'playAgain()');assert.equal(h.room().gameId,firstId);
});
for(const watch of ['','BAD!','ABCDEF'])await test(`explicit watch ${watch||'empty'} wins over saved host session`,async()=>{
 const h=createHarness({role:null,nickname:null,search:`?watch=${watch}`});h.storage.set('kaburazuhint_session',JSON.stringify({roomCode:'ABCDEF',nickname:'host',role:'host'}));h.run(h.loaded.init);await h.drain();
 assert.equal(h.writes.length,0);assert.equal(h.reservations.size,0);assert.notEqual(h.run('state.role'),'host');assert.notEqual(h.run('state.role'),'guest');
 if(watch==='ABCDEF')assert.equal(h.run('state.role'),'spectator');else{assert.equal(h.storage.has('kaburazuhint_session'),false);assert.equal(h.run('state.currentScreen'),'top');}
});
for(const session of [null,[],{role:'admin',roomCode:'ABCDEF',nickname:'guest'},{role:'guest',roomCode:'ABCDEF',nickname:'host'},{role:'host',roomCode:'ABCDEF',nickname:'guest'},{role:'guest',roomCode:'ABCDEF',nickname:'bad.name'}])await test(`invalid or mismatched session ${JSON.stringify(session)} rejects`,async()=>{
 const h=createHarness({role:null,nickname:null});h.storage.set('kaburazuhint_session',JSON.stringify(session));assert.equal(await h.run('tryReconnect()'),false);assert.equal(h.writes.length,0);assert.equal(h.reservations.size,0);
});
await test('retained disconnected guesser is not auto-passed; missing guesser can be passed',async()=>{
 const d=fixture('answer');d.round.guesser='guest';d.players.guest.presenceVersion=1;const h=host(d);await h.run('hostSkipAbsentGuesser()');assert.equal(h.room().round.passed,false);
 const missing=clone(h.room());delete missing.players.guest;h.setRoom(missing);h.emit();await h.run('hostSkipAbsentGuesser()');await tick();assert.equal(h.room().round.passed,true);assert.equal(h.room().status,'result');assert.equal(h.room().history[1].passed,true);
});
await test('next round retains disconnected player but skips truly absent turn and preserves gameId',async()=>{
 const d=fixture('result');d.turnOrder=['peer','missing','guest','host'];d.players.guest.presenceVersion=1;const h=host(d);await h.run('nextRound()');assert.equal(h.room().gameId,d.gameId);assert.equal(h.room().round.number,3);assert.equal(h.room().round.guesser,'guest');assert.equal(h.room().history[2].skipped,true);
});
for(const operation of ['finished','leave'])await test(`host ${operation}: cancellation success then deletion rejection restores reservation`,async()=>{
 const h=host(fixture('finished'));await h.run('registerHostReservation(state.roomRef)');
 if(operation==='finished')h.hooks.rejectTransaction=()=>true;else h.hooks.rejectRemove=()=>true;
 await h.run(operation==='finished'?"deleteFinishedRoom(captureAction('finished'))":'leaveGame()');assert(h.room());assert.equal(h.reservations.size,1);assert.equal([...h.reservations.values()][0].kind,'update');assert.equal(h.run('state.role'),'host');
});
for(const operation of ['reconnect','restore'])await test(`host ${operation}: rejected registration cannot falsely mark connected`,async()=>{
 const d=fixture();d.hostConnected=false;d.hostDisconnectedAt=1999999;const h=createHarness({data:d,role:operation==='reconnect'?null:'host',nickname:operation==='reconnect'?null:'host'});h.hooks.rejectReservation=()=>true;
 h.storage.set('kaburazuhint_session',JSON.stringify({role:'host',nickname:'host',roomCode:'ABCDEF'}));const returned=await h.run(operation==='reconnect'?'tryReconnect()':"restoreHostConnection(captureAction('clue-input'))");
 assert.equal(h.room().hostConnected,false);assert.equal(h.room().hostDisconnectedAt,1999999);assert.equal(h.reservations.size,0);if(operation==='reconnect'){assert.equal(returned,false);assert.equal(h.run('state.role'),null);}
});
await test('host creation reservation rejection leaves expiring inactive claim and resets UI/session',async()=>{
 const h=createHarness({data:null,role:null,nickname:null});h.el('host-nickname').value='host';h.hooks.rejectReservation=()=>true;await h.run('hostCreate()');
 assert.equal(h.room().hostConnected,false);assert.equal(h.room().hostDisconnectedAt,2000000);assert.equal(h.reservations.size,0);assert.equal(h.run('state.role'),null);assert.equal(h.run('state.roomRef'),null);assert.equal(h.run('state.currentScreen'),'top');assert.equal(h.storage.size,0);
});
await test('host creation normal order is claim-inactive, accept reservation, then connected',async()=>{
 const h=createHarness({data:null,role:null,nickname:null});h.el('host-nickname').value='host';let observed;
 h.hooks.reserve=async()=>{observed=clone(h.room());};await h.run('hostCreate()');assert.equal(observed.hostConnected,false);assert.equal(h.room().hostConnected,true);assert.equal(h.reservations.size,1);assert.equal(h.run('state.currentScreen'),'waiting');assert.equal(h.storage.size,1);
});
await test('host creation collision does not register on another owner room',async()=>{
 const d=fixture('waiting'),h=createHarness({data:d,role:null,nickname:null});h.el('host-nickname').value='different';await h.run('hostCreate()');assert.deepEqual(h.room(),d);assert.equal(h.reservations.size,0);assert.equal(h.writes.length,0);
});
for(const offset of [-180000,180000])await test(`creation uses injected server time despite local clock offset ${offset}`,async()=>{
 const h=createHarness({data:null,role:null,nickname:null,localClockOffset:offset});h.el('host-nickname').value='host';let claimed;
 h.hooks.reserve=async()=>{claimed=clone(h.room());};await h.run('hostCreate()');assert.equal(claimed.hostDisconnectedAt,2000000);assert.equal(h.room().hostConnected,true);assert.equal(h.run('state.currentScreen'),'waiting');
});
await test('single immutable source SHA across this run',async()=>{assert.equal(observedSourceHashes.size,1);});
const result={date:'2026-09-08',baselineCommit:'a236784e2e7720e12e35cf7613c17b8fc9559f18',method:'Independent same-family separate-context synthetic VM; no SDK execution',caseCount:checks.length,sourceSHA256:loadSource().sha256,checks,failures,limitations:['Synthetic in-memory sequencing, not Firebase transport/cache/retry protocol','Minimal DOM string and state assertions; no generated DOM parsing, real browser, timer wall clock or OS clipboard','Shared TTL, escape, cancel helper and shuffle extracted from actual shared source; no SDK initialization','Reservation acceptance/ack gates and virtual timers are explicit synthetic ordering, not elapsed-time or server guarantees']};
console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
