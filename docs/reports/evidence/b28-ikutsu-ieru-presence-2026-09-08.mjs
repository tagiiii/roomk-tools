import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
// Synthetic sequencing only, not an SDK or browser implementation.
const html = fs.readFileSync(new URL('../../../apps/ikutsu-ieru/index.html', import.meta.url), 'utf8');
const sourceSha256 = createHash('sha256').update(html).digest('hex');
const source = html.slice(html.indexOf('const { authReady, db }'), html.indexOf('// ── 初期化 ──'));
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness() {
  let room = { host:'host', hostConnected:true, status:'input', round:1, theme:'お題', endAt:1,
    players:{host:{isHost:true, answers:[]},guest:{isHost:false,joinedAt:123,answers:['ねこ','ねこ','いぬ']}},
    history:{0:{theme:'前のお題',answers:{guest:['前の回答']}}} };
  const elements = new Map(), reservations = new Map(), timers = new Map(), cancels = [], options = [];
  let connected, listener, id=0, timerId=0, gate=null, txnGate=null, reject=false;
  const element = id => { if(!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,style:{},classList:{toggle(){},remove(){},add(){}}}); return elements.get(id); };
  const snapshot = () => ({exists:()=>!!room,val:()=>structuredClone(room)});
  const emit = () => listener?.(snapshot());
  function ref(path='') { return {key:path.split('/').at(-1),child:p=>ref([path,p].filter(Boolean).join('/')),push(){return this.child('id'+(++id));},
    async get(){return snapshot();},
    on(event,fn){if(path==='.info/connected') connected=fn;else {listener=fn;fn(snapshot());}},
    off(event,fn){if(path==='.info/connected'){if(!fn||connected===fn) connected=null;}else if(!fn||listener===fn) listener=null;},
    async transaction(fn,callback,local){if(txnGate) await txnGate;if(reject) throw Error('intentional');options.push(local);const next=fn(structuredClone(room));if(next!==undefined){room=next;emit();}return {committed:next!==undefined,snapshot:snapshot()};},
    async remove(){if(!path)room=null;else {const parts=path.split('/');let cursor=room;for(const part of parts.slice(0,-1)){cursor=cursor?.[part];if(!cursor)return;}delete cursor[parts.at(-1)];}emit();},
    onDisconnect(){return {async remove(){reservations.set(path,true);if(gate) await gate;},async cancel(){reservations.delete(path);}};}
  }; }
  const root=ref(), storage=new Map();
  const context=vm.createContext({window:{confirm:()=>true},console:{warn(){},error(){}},
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval(){},
    firebase:{database:{ServerValue:{TIMESTAMP:1}}},RoomkRTDB:{initFirebase:()=>({authReady:Promise.resolve(),db:{ref:p=>p==='.info/connected'?ref(p):root}}),esc:String,showToast(){},now:()=>1000,isRoomExpired:r=>r?.expired===true,getHostDisconnectedAt:()=>0,cancelRoomOnDisconnect:async ref=>{cancels.push(ref);},generateRoomCode:()=> 'ABCDEF'},
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    document:{getElementById:element,querySelectorAll:()=>[]},root});
  vm.runInContext(source,context);
  vm.runInContext("Object.assign(state,{role:'guest',nickname:'guest',roomCode:'ABCDEF',roomRef:root,round:1,currentScreen:'input',currentStatus:'input',myAnswers:['ねこ','ねこ','いぬ']})",context);
  return {root,timers,cancels,options,reservations,el:element,room:()=>room,setRoom:value=>{room=value;},emit,
    run:s=>vm.runInContext(s,context),global:(k,v)=>{context[k]=v;},gate:v=>{gate=v;},txnGate:v=>{txnGate=v;},reject:v=>{reject=v;},
    async online(value){connected?.({val:()=>value});await Promise.resolve();},async drain(){await vm.runInContext('guestPresenceWork',context);},
    async disconnect(){for(const path of [...reservations.keys()]){await ref(path).remove();reservations.delete(path);}await this.online(false);}};
}
async function connect(h){h.run('startRoomListener();startGuestPresence()');await h.online(true);await h.drain();}
const cases=[];
async function test(name,fn){await fn();cases.push(name);}
await test('two connection cycles preserve full guest answers and frozen history',async()=>{
 const h=harness(),expected=plain(h.room().history);await connect(h);for(let i=0;i<2;i++){await h.disconnect();await h.online(true);await h.drain();assert.deepEqual(plain(h.room().players.guest.answers),['ねこ','ねこ','いぬ']);assert.equal(h.room().players.guest.joinedAt,123);assert.deepEqual(plain(h.room().history),expected);assert.equal(Object.keys(h.room().players.guest.connections).length,1);}
});
await test('late reservation acknowledgement after disconnect cannot add alive child',async()=>{
 const h=harness(),d=deferred();h.gate(d.promise);h.run('startGuestPresence()');await h.online(true);await h.online(false);d.resolve();await h.drain();assert.equal(h.room().players.guest.connections,undefined);
});
await test('old connection removal after new connection preserves new id and answers',async()=>{
 const h=harness();await connect(h);await h.online(false);await h.online(true);await h.drain();await h.root.child('players/guest/connections/id1').remove();assert.equal(h.room().players.guest.connections.id2,true);assert.equal(h.room().players.guest.answers.length,3);
});
await test('delayed alive then explicit exit removes current guest but preserves history',async()=>{
 const h=harness(),d=deferred();h.txnGate(d.promise);h.run('startGuestPresence()');await h.online(true);const pending=h.run('leaveGame()');d.resolve();await pending;assert.equal(h.room().players.guest,undefined);assert.deepEqual(plain(h.room().history[0].answers.guest),['前の回答']);assert.equal(h.run('state.role'),null);
});
await test('delayed alive cannot recreate removed guest',async()=>{
 const h=harness(),d=deferred();h.txnGate(d.promise);h.run('startGuestPresence()');await h.online(true);delete h.room().players.guest;d.resolve();await h.drain();assert.equal(h.room().players.guest,undefined);
});
await test('old delayed presence cannot mutate replacement room except its new presence',async()=>{
 const h=harness(),next=harness(),d=deferred();h.gate(d.promise);h.run('startGuestPresence()');await h.online(true);const stop=h.run('stopGuestPresence()');h.global('nextRef',next.root);h.run('state.roomRef=nextRef;startGuestPresence()');await h.online(true);d.resolve();await stop;await h.drain();assert.equal(h.room().players.guest.connections,undefined);assert.equal(next.room().players.guest.connections.id1,true);assert.deepEqual(plain(next.room().players.guest.answers),['ねこ','ねこ','いぬ']);
});
await test('add preserves duplicate values and deletes exact index',async()=>{
 const h=harness();await connect(h);h.el('i-answer').value='  ねこ  ';await h.run('addAnswer()');assert.deepEqual(plain(h.room().players.guest.answers),['ねこ','ねこ','いぬ','ねこ']);await h.run('removeAnswer(1)');assert.deepEqual(plain(h.room().players.guest.answers),['ねこ','いぬ','ねこ']);
});
for(const index of [0,2]) await test('stale deletion index '+index+' aborts after concurrent array change',async()=>{
 const h=harness();await connect(h);const d=deferred();h.txnGate(d.promise);const pending=h.run(`removeAnswer(${index})`);h.room().players.guest.answers=['新しい回答','ねこ','ねこ','いぬ'];d.resolve();await pending;assert.deepEqual(plain(h.room().players.guest.answers),['新しい回答','ねこ','ねこ','いぬ']);assert.equal(h.el('i-add').disabled,false);
});
await test('deleting all answers permits empty review and blank or overlength input does not write',async()=>{
 const h=harness();await connect(h);for(let i=0;i<3;i++)await h.run('removeAnswer(0)');assert.equal(h.room().players.guest.answers.length,0);h.el('i-answer').value=' ';await h.run('addAnswer()');h.el('i-answer').value='長'.repeat(25);await h.run('addAnswer()');assert.equal(h.room().players.guest.answers.length,0);h.run("state.role='host'");await h.run('moveToReview()');assert.equal(h.room().history[1].answers.guest.length,0);
});
await test('busy answer guard prevents repeated Enter from duplicating one pending operation',async()=>{
 const h=harness();await connect(h);const d=deferred();h.txnGate(d.promise);h.el('i-answer').value='一回';const first=h.run('addAnswer()');await h.run('addAnswer()');d.resolve();await first;assert.equal(h.room().players.guest.answers.filter(value=>value==='一回').length,1);
});
for(const changed of ['round','connection','member','room','expired','role']) await test('delayed add rejects changed '+changed,async()=>{
 const h=harness();await connect(h);const d=deferred();h.txnGate(d.promise);h.el('i-answer').value='遅い回答';const pending=h.run('addAnswer()');
 if(changed==='round')h.room().round=2;if(changed==='connection')await h.online(false);if(changed==='member')delete h.room().players.guest;if(changed==='room')h.setRoom(null);if(changed==='expired')h.room().expired=true;if(changed==='role'){h.room().players.guest.isHost=true;h.room().host='guest';}
 d.resolve();await pending;assert.ok(!h.room()?.players?.guest?.answers.includes('遅い回答'));if(changed==='room')assert.equal(h.room(),null);if(changed==='member')assert.equal(h.room().players.guest,undefined);
});
await test('answer commit before review is copied into frozen history',async()=>{
 const h=harness();await connect(h);h.el('i-answer').value='最後';await h.run('addAnswer()');h.run("state.role='host'");await h.run('moveToReview()');assert.ok(h.room().history[1].answers.guest.includes('最後'));assert.equal(h.room().status,'review');
});
await test('review commit before delayed answer aborts without changing history or answers',async()=>{
 const h=harness();await connect(h);const d=deferred();h.txnGate(d.promise);h.el('i-answer').value='遅い';const pending=h.run('addAnswer()');h.room().status='review';h.room().history[1]={answers:{guest:[...h.room().players.guest.answers]}};const expected=plain(h.room());h.emit();d.resolve();await pending;assert.deepEqual(plain(h.room()),expected);
});
await test('status input still accepts after endAt and temporary host disconnect before TTL',async()=>{
 const h=harness();await connect(h);h.room().hostConnected=false;h.el('i-answer').value='回答';await h.run('addAnswer()');assert.ok(h.room().players.guest.answers.includes('回答'));assert.equal(h.room().status,'input');
});
for(const rejected of [false,true]) await test('pending answer redraw then '+(rejected?'reject':'abort')+' restores controls without losing new typed text',async()=>{
 const h=harness();await connect(h);const d=deferred();h.txnGate(d.promise);h.el('i-answer').value='送信';const pending=h.run('addAnswer()');h.emit();assert.equal(h.el('i-add').disabled,true);h.el('i-answer').value='次の入力';if(rejected)h.reject(true);else h.room().round=2;d.resolve();await pending;assert.equal(h.el('i-add').disabled,false);assert.equal(h.el('i-answer').value,'次の入力');assert.equal(h.run('state.answerAction'),null);
});
await test('old action completion cannot clear replacement token or next input',async()=>{
 const h=harness();await connect(h);const d=deferred();h.txnGate(d.promise);h.el('i-answer').value='前の入力';const pending=h.run('addAnswer()');h.room().round=2;h.emit();h.run('state.answerAction={replacement:true}');h.el('i-answer').value='次の入力';d.resolve();await pending;assert.equal(h.run('state.answerAction.replacement'),true);assert.equal(h.el('i-answer').value,'次の入力');
});
await test('waiting start blocks disconnected guest and preserves presence on next round',async()=>{
 const h=harness();await connect(h);h.run("state.role='host'");h.room().status='waiting';h.el('w-theme-input').value='次';h.room().players.guest.connections={};await h.run('startRound()');assert.equal(h.room().status,'waiting');h.room().players.guest.connections={new:true};await h.run('startRound()');assert.equal(h.room().round,2);assert.deepEqual(plain(h.room().players.guest.answers),[]);assert.equal(h.room().players.guest.connections.new,true);
});
await test('host alone may start a round',async()=>{
 const h=harness();h.run("state.role='host';state.nickname='host'");delete h.room().players.guest;h.room().status='waiting';h.el('w-theme-input').value='ひとり';await h.run('startRound()');assert.equal(h.room().status,'input');
});
await test('finished timer remains 30000ms and deletion cancels captured ref before nonlocal transaction',async()=>{
 const h=harness();h.run("state.role='host';startRoomListener()");h.room().status='finished';h.emit();const timer=[...h.timers.values()].find(timer=>timer.ms===30000);assert.ok(timer);await h.run('deleteFinishedRoom(root,1)');assert.equal(h.cancels[0],h.root);assert.equal(h.options.at(-1),false);assert.equal(h.room(),null);assert.equal(h.run('state.currentScreen'),'top');
});
for(const changed of ['round','ref','phase']) await test('finished cleanup does not remove changed '+changed,async()=>{
 const h=harness();h.run("state.role='host'");h.room().status='finished';if(changed==='round')h.room().round=2;if(changed==='phase')h.room().status='waiting';if(changed==='ref')h.run('state.roomRef={}');await h.run('deleteFinishedRoom(root,1)');assert.ok(h.room());
});
await test('guest TTL deletion uses applyLocally false and missing room cleanup calls host cancel helper',async()=>{
 const h=harness();h.room().expired=true;await h.run('expireGuestRoom(root)');assert.equal(h.options.at(-1),false);assert.equal(h.room(),null);const host=harness();host.run("state.role='host';startRoomListener()");host.setRoom(null);host.emit();assert.equal(host.run('state.roomRef'),null);assert.equal(host.cancels[0],host.root);
});
for(const session of [{nickname:'host',role:'guest'},{nickname:'guest',role:'other'},{nickname:'bad/name',role:'guest'}]) await test('session rejects before state mutation '+session.nickname+'/'+session.role,async()=>{
 const h=harness();h.run(`Object.assign(state,{role:null,nickname:null,roomRef:null});sessionStorage.setItem(SESSION_KEY,JSON.stringify(${JSON.stringify({...session,roomCode:'ABCDEF'})}))`);assert.equal(await h.run('tryReconnect()'),false);assert.equal(h.run('state.role'),null);assert.equal(h.run('state.roomRef'),null);
});
for(const outcome of ['commit','abort','reject','value-error']) await test('temporary join listener cleanup on '+outcome,async()=>{
 const h=harness(),d=deferred();let listener,off=0,tx=0;h.global('joinRef',{on(event,fn,error){listener=fn;if(outcome==='value-error')error(Error('value'));else fn();},off(event,fn){assert.equal(fn,listener);off++;},async transaction(){tx++;await d.promise;if(outcome==='reject')throw Error('reject');return {committed:outcome==='commit'};}});const pending=h.run('joinTransaction(joinRef,()=>undefined)');if(outcome==='value-error'){await assert.rejects(pending);assert.equal(tx,0);}else {await Promise.resolve();assert.equal(off,0);d.resolve();if(outcome==='reject')await assert.rejects(pending);else await pending;}assert.equal(off,1);
});
console.log(JSON.stringify({method:'Node VM with synthetic transaction/onDisconnect sequencing; not SDK or browser evidence',limitations:['No actual Firebase retry protocol, transport, DOM layout, or production access','Old connection reservation is modeled with direct old-path remove','cancelRoomOnDisconnect is a call spy, not actual SDK cancellation'],source:'apps/ikutsu-ieru/index.html',sourceSha256,passed:cases.length,cases},null,2));
