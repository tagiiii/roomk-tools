import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
// VM sequencing evidence only: not a Firebase SDK or browser simulation.
const html = fs.readFileSync(new URL('../../../apps/tatoe-narabe/index.html', import.meta.url), 'utf8');
const sourceSha256 = createHash('sha256').update(html).digest('hex');
const source = html.slice(html.indexOf('    const { authReady, db }'), html.indexOf('    // ── 起動'));
function harness() {
  let room = { host:'host', hostConnected:true, status:'revealing', roundId:'round-one', theme:'テーマ', players:{host:{isHost:true,number:12,ready:true,declaredAt:null}, guest:{isHost:false,number:42,ready:false,declaredAt:null}} };
  const elements=new Map(), reservations=new Map(); let connected, roomListener, id=0, gate=null, txnGate=null, rejects=false;
  const element=id=>{ if(!elements.has(id)) elements.set(id,{style:{},classList:{toggle(){},remove(){},add(){}},appendChild(){}});return elements.get(id); };
  function ref(path='') { return {key:path.split('/').at(-1), child:p=>ref([path,p].filter(Boolean).join('/')), push(){return this.child('id'+(++id));},
    async get(){ return {exists:()=>!!room,val:()=>structuredClone(room)}; }, async once(){return this.get();}, on(event, fn){if(path==='.info/connected') connected=fn;else roomListener=fn;},off(){if(path==='.info/connected') connected=null;},
    async transaction(fn){ if(txnGate) await txnGate; if(rejects) throw Error('intentional'); const next=fn(structuredClone(room)); if(next!==undefined) room=next; return {committed:next!==undefined,snapshot:{val:()=>structuredClone(room)}}; },
    async remove(){if(!path) {room=null;return;} const parts=path.split('/');let cursor=room;for(const part of parts.slice(0,-1)){cursor=cursor?.[part];if(!cursor)return;}if(cursor) delete cursor[parts.at(-1)];},
    onDisconnect(){ return { async remove(){reservations.set(path,true);if(gate) await gate;},async cancel(){reservations.delete(path);} }; }
  }; }
  const root=ref(); const storage=new Map(), cancellationCalls=[];
  const context=vm.createContext({window:{scrollTo(){},confirm:()=>true},console:{warn(){},error(){}},setTimeout,clearTimeout,setInterval,clearInterval,
    firebase:{database:{ServerValue:{TIMESTAMP:1}}},RoomkRTDB:{initFirebase:()=>({authReady:Promise.resolve(),db:{ref:p=>p==='.info/connected'?ref(p):root}}),esc:String,showToast(){},now:()=>Date.now(),isRoomExpired:r=>r?.expired===true,getHostDisconnectedAt:()=>0,cancelRoomOnDisconnect:async ref=>{cancellationCalls.push(ref);},generateRoomCode:()=> 'ABCDEF'},
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},root});
  vm.runInContext(source,context); vm.runInContext("Object.assign(state,{role:'guest',nickname:'guest',roomCode:'ABCDEF',roomRef:root,currentRoundId:'round-one'})",context);
  return {cancellationCalls,emitRoom:()=>roomListener?.({exists:()=>!!room,val:()=>structuredClone(room)}),run:s=>vm.runInContext(s,context),setGlobal:(key,value)=>context[key]=value,room:()=>room,setRoom:r=>room=r,el:element,root,reservations,
    async online(value){connected?.({val:()=>value});await Promise.resolve();}, async drain(){await vm.runInContext('guestPresenceWork',context);},
    async disconnect(){for(const p of [...reservations.keys()]) {await ref(p).remove();reservations.delete(p);}await this.online(false);},
    setGate:v=>gate=v,setTxnGate:v=>txnGate=v,setReject:v=>rejects=v};
}
const results=[]; async function test(name,fn){await fn();results.push(name);}
async function connect(h){h.run('startGuestPresence()');await h.online(true);await h.drain();}
await test('two reconnects preserve number ready and declaration',async()=>{
 const h=harness();h.room().players.guest.ready=true;h.room().players.guest.declaredAt=123;await connect(h);for(let i=0;i<2;i++){await h.disconnect();await h.online(true);await h.drain();assert.equal(h.room().players.guest.number,42);assert.equal(h.room().players.guest.ready,true);assert.equal(h.room().players.guest.declaredAt,123);assert.equal(Object.keys(h.room().players.guest.connections).length,1);}
});
await test('reservation acknowledgement after disconnect does not write alive',async()=>{
 const h=harness();let release;h.setGate(new Promise(r=>release=r));h.run('startGuestPresence()');await h.online(true);await h.online(false);release();await h.drain();assert.equal(h.room().players.guest.connections,undefined);
});
await test('alive waiting during exit cannot resurrect removed member',async()=>{
 const h=harness();let release;h.setTxnGate(new Promise(r=>release=r));h.run('startGuestPresence()');await h.online(true);const left=h.run('leaveGame()');release();await left;assert.equal(h.room().players.guest,undefined);assert.equal(h.run('state.role'),null);
});
await test('late old connection removal retains new connection',async()=>{
 const h=harness();await connect(h);await h.online(false);await h.online(true);await h.drain();await h.root.child('players/guest/connections/id1').remove();assert.ok(h.room().players.guest.connections.id2);assert.equal(h.room().players.guest.number,42);
});
for(const phase of ['revealing','playing']) await test('delayed action rejects same-number next round in '+phase,async()=>{
 const h=harness();await connect(h);h.room().status=phase;let release;h.setTxnGate(new Promise(r=>release=r));const pending=h.run(phase==='revealing'?'confirmNumber()':'declare()');h.room().roundId='round-two';h.room().players.guest.number=42;release();await pending;assert.equal(h.room().players.guest.ready,false);assert.equal(h.room().players.guest.declaredAt,null);
});
for(const phase of ['revealing','playing']) await test('delayed action rejects changed connection generation in '+phase,async()=>{
 const h=harness();await connect(h);h.room().status=phase;let release;h.setTxnGate(new Promise(r=>release=r));const pending=h.run(phase==='revealing'?'confirmNumber()':'declare()');await h.online(false);await h.online(true);release();await pending;await h.drain();assert.equal(h.room().players.guest.ready,false);assert.equal(h.room().players.guest.declaredAt,null);
});
await test('missing member cannot acquire ready or declaration partial fields',async()=>{
 const h=harness();await connect(h);delete h.room().players.guest;await h.run('confirmNumber()');h.room().status='playing';await h.run('declare()');assert.equal(h.room().players.guest,undefined);
});
await test('declaration timestamp stays fixed during synthetic callback retries',async()=>{
 const h=harness();await connect(h);h.room().status='playing';let first,last;const original=h.root.transaction;h.root.transaction=async fn=>{first=fn(h.room()).players.guest.declaredAt;await new Promise(r=>setTimeout(r,5));last=fn(h.room()).players.guest.declaredAt;return original(fn);};await h.run('declare()');assert.equal(first,last);assert.equal(h.room().players.guest.declaredAt,first);await h.run('declare()');assert.equal(h.room().players.guest.declaredAt,first);
});
for(const phase of ['waiting','result']) await test(phase+' start waits for guests then retains presence and replaces round id',async()=>{
 const h=harness();await connect(h);h.run("state.role='host'");h.room().status=phase;h.room().players.guest.connections={};await h.run('startGame()');assert.equal(h.room().status,phase);h.room().players.guest.connections={retained:true};h.room().players.guest.declaredAt=123;await h.run('startGame()');assert.equal(h.room().status,'revealing');assert.ok(h.room().roundId);assert.notEqual(h.room().roundId,'round-one');assert.equal(h.room().players.guest.connections.retained,true);assert.equal(h.room().players.guest.declaredAt,null);assert.equal(h.room().players.guest.ready,false);
});
await test('force playing retains unready guests and expired timer does not block declaration',async()=>{
 const h=harness();await connect(h);h.run("state.role='host'");await h.run('startPlaying()');assert.equal(h.room().status,'revealing');await h.run('hostForceStartPlaying()');assert.equal(h.room().status,'playing');assert.equal(h.room().players.guest.ready,false);h.run("state.role='guest'");h.room().discussionEndsAt=1;await h.run('declare()');assert.ok(h.room().players.guest.declaredAt);
});
await test('legacy missing round id accepts only legacy round and rejects new id',async()=>{
 const h=harness();await connect(h);delete h.room().roundId;h.run('state.currentRoundId=null');await h.run('confirmNumber()');assert.equal(h.room().players.guest.ready,true);h.room().players.guest.ready=false;h.room().roundId='new';await h.run('confirmNumber()');assert.equal(h.room().players.guest.ready,false);
});
await test('room null detaches host to TOP and calls cancel helper with old ref',async()=>{
 const h=harness();h.run("state.role='host';startRoomListener()");h.setRoom(null);h.emitRoom();assert.equal(h.run('state.role'),null);assert.equal(h.run('state.roomRef'),null);assert.equal(h.run('state.currentScreen'),'top');assert.equal(h.room(),null);assert.deepEqual(h.cancellationCalls,[h.root]);
});
await test('expiry suppresses local optimistic null before synthetic retry',async()=>{
 const h=harness();h.room().expired=true;let seen;h.root.transaction=async(fn,cb,local)=>{seen=local;assert.equal(fn(h.room()),null);assert.equal(fn(h.room()),null);return {committed:false};};await h.run('expireGuestRoom(root)');assert.equal(seen,false);
});
await test('invalid guest host-name session is rejected before state changes',async()=>{
 const h=harness();h.run("Object.assign(state,{role:null,nickname:null,roomRef:null});sessionStorage.setItem(SESSION_KEY,JSON.stringify({nickname:'host',roomCode:'ABCDEF',role:'guest'}))");assert.equal(await h.run('tryReconnect()'),false);assert.equal(h.run('state.role'),null);
});
for(const rejected of [false,true]) await test('confirm pending redraw restores retry UI after '+(rejected?'reject':'abort'),async()=>{
 const h=harness();await connect(h);h.run(`Object.assign(state,{currentStatus:'revealing',currentPlayers:${JSON.stringify(h.room().players)},numberRevealed:true})`);let release;h.setTxnGate(new Promise(r=>release=r));const pending=h.run('confirmNumber()');h.run(`handleRevealing(${JSON.stringify(h.room())},state.currentPlayers)`);assert.equal(h.el('btn-confirm-number').style.display,'none');if(rejected)h.setReject(true);else h.root.transaction=async()=>({committed:false});if(!rejected)h.room().roundId='server-round-changed';release();await pending;assert.equal(h.run('state.confirmingNumber'),false);assert.equal(h.el('btn-confirm-number').style.display,'');
});
await test('old confirm finally cannot clear a replacement action token',async()=>{
 const h=harness();await connect(h);let release;h.setTxnGate(new Promise(r=>release=r));const pending=h.run('confirmNumber()');h.run("state.currentRoundId='round-two';state.confirmingNumber={newAction:true}");h.room().roundId='round-two';release();await pending;assert.equal(h.run('state.confirmingNumber.newAction'),true);
});
for(const changed of ['expired','role']) await test('latest transaction rejects changed guest '+changed,async()=>{
 const h=harness();await connect(h);if(changed==='expired')h.room().expired=true;else{h.room().host='guest';h.room().players.guest.isHost=true;}await h.run('confirmNumber()');assert.equal(h.room().players.guest.ready,false);h.room().status='playing';await h.run('declare()');assert.equal(h.room().players.guest.declaredAt,null);
});
await test('temporary host disconnect before TTL does not newly block valid guest action',async()=>{
 const h=harness();await connect(h);h.room().hostConnected=false;await h.run('confirmNumber()');assert.equal(h.room().players.guest.ready,true);
});
for(const changed of ['exit','replacement']) await test('host start get delay stops safely after '+changed,async()=>{
 const h=harness();h.run("state.role='host'");let release,pushes=0;h.root.get=async()=>{await new Promise(r=>release=r);return {val:()=>h.room()};};h.root.push=()=>{pushes++;throw Error('should not allocate round');};const pending=h.run('startGame()');h.run(changed==='exit'?"state.roomRef=null;state.role=null":"state.roomRef={replacement:true}");release();await pending;assert.equal(pushes,0);assert.equal(h.room().roundId,'round-one');
});
for(const committed of [true,false]) await test('join listener remains until '+(committed?'commit':'abort')+' then removes only its callback',async()=>{
 const h=harness();let listener,release;const calls=[];h.setGlobal('joinRef',{on(event,fn){listener=fn;calls.push('on');fn();},async transaction(){calls.push('transaction');await new Promise(r=>release=r);return {committed};},off(event,fn){assert.equal(fn,listener);calls.push('off');}});const pending=h.run('joinTransaction(joinRef,()=>undefined)');await Promise.resolve();assert.deepEqual(calls,['on','transaction']);release();await pending;assert.deepEqual(calls,['on','transaction','off']);
});
await test('join value error and transaction reject release temporary listener',async()=>{
 for(const valueError of [true,false]){const h=harness();let listener,off=0,transactions=0;h.setGlobal('joinRef',{on(event,fn,error){listener=fn;if(valueError)error(Error('permission'));else fn();},async transaction(){transactions++;throw Error('transaction');},off(event,fn){assert.equal(fn,listener);off++;}});await assert.rejects(h.run('joinTransaction(joinRef,()=>undefined)'));assert.equal(off,1);assert.equal(transactions,valueError?0:1);}
});
await test('old delayed presence cannot alter replacement room while new presence starts',async()=>{
 const h=harness(), second=harness();let release;h.setGate(new Promise(r=>release=r));h.run('startGuestPresence()');await h.online(true);const stop=h.run('stopGuestPresence()');h.setGlobal('nextRef',second.root);h.run("state.roomRef=nextRef;state.roomCode='GHIJKL';startGuestPresence()");await h.online(true);release();await stop;await h.drain();assert.equal(h.run('state.roomRef===nextRef'),true);assert.equal(h.run('guestCanAct()'),true);assert.equal(second.room().players.guest.number,42);assert.ok(second.room().players.guest.connections.id1);assert.equal(h.room().players.guest.connections,undefined);
});
console.log(JSON.stringify({method:'Node VM with synthetic transaction and onDisconnect sequencing; not SDK or browser evidence',limitations:['No actual Firebase transaction retry protocol; old reservation modeled by direct old-path remove'],source:'apps/tatoe-narabe/index.html',sourceSha256,passed:results.length,cases:results},null,2));
