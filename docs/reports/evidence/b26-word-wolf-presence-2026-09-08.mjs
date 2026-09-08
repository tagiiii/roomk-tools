import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
// VM sequencing evidence only: not a Firebase SDK or browser simulation.
const html = fs.readFileSync(new URL('../../../apps/word-wolf/index.html', import.meta.url), 'utf8');
const sourceSha256 = createHash('sha256').update(html).digest('hex');
const source = html.slice(html.indexOf('// ── Firebase 初期化'), html.indexOf('// ── 初期化'));
function harness() {
  let room = { host:'host', hostConnected:true, status:'revealing', players:{host:{isHost:true}, guest:{isHost:false,isWolf:true,word:'秘密',ready:false,vote:null}} };
  const elements=new Map(), reservations=new Map(); let connected, id=0, gate=null, txnGate=null, rejects=false;
  const element=id=>{ if(!elements.has(id)) elements.set(id,{style:{},classList:{toggle(){},remove(){},add(){}},appendChild(){}});return elements.get(id); };
  function ref(path='') { return {key:path.split('/').at(-1), child:p=>ref([path,p].filter(Boolean).join('/')), push(){return this.child('id'+(++id));},
    async get(){ return {exists:()=>!!room,val:()=>structuredClone(room)}; }, on(event, fn){if(path==='.info/connected') connected=fn;},off(){if(path==='.info/connected') connected=null;},
    async transaction(fn){ if(txnGate) await txnGate; if(rejects) throw Error('intentional'); const next=fn(structuredClone(room)); if(next!==undefined) room=next; return {committed:next!==undefined,snapshot:{val:()=>structuredClone(room)}}; },
    async remove(){if(!path) {room=null;return;} const parts=path.split('/');let cursor=room;for(const part of parts.slice(0,-1)){cursor=cursor?.[part];if(!cursor)return;}if(cursor) delete cursor[parts.at(-1)];},
    onDisconnect(){ return { async remove(){reservations.set(path,true);if(gate) await gate;},async cancel(){reservations.delete(path);} }; }
  }; }
  const root=ref(); const storage=new Map();
  const context=vm.createContext({console:{warn(){}},setTimeout,clearTimeout,setInterval,clearInterval,
    firebase:{database:{ServerValue:{TIMESTAMP:1}}},RoomkRTDB:{initFirebase:()=>({authReady:Promise.resolve(),db:{ref:p=>p==='.info/connected'?ref(p):root}}),esc:String,showToast(){},now:()=>Date.now(),isRoomExpired:r=>r?.expired===true,getHostDisconnectedAt:()=>0,cancelRoomOnDisconnect:async()=>{},generateRoomCode:()=> 'ABCDEF'},
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    document:{getElementById:element,querySelectorAll:()=>[],createElement:()=>element('new')},root});
  vm.runInContext(source,context); vm.runInContext("Object.assign(state,{role:'guest',nickname:'guest',roomCode:'ABCDEF',roomRef:root})",context);
  return {run:s=>vm.runInContext(s,context),setGlobal:(key,value)=>context[key]=value,room:()=>room,setRoom:r=>room=r,el:element,root,reservations,
    async online(value){connected?.({val:()=>value});await Promise.resolve();}, async drain(){await vm.runInContext('guestPresenceWork',context);},
    async disconnect(){for(const p of [...reservations.keys()]) {await ref(p).remove();reservations.delete(p);}await this.online(false);},
    setGate:v=>gate=v,setTxnGate:v=>txnGate=v,setReject:v=>rejects=v};
}
const results=[]; async function test(name,fn){await fn();results.push(name);}
await test('initial / second reconnect preserves full guest and replaces connection IDs',async()=>{
 const h=harness();h.room().players.guest.ready=true;h.room().players.guest.vote='host';const original=structuredClone(h.room().players.guest);h.run('startGuestPresence()');await h.online(true);await h.drain();assert.equal(h.run('guestCanAct()'),true);assert.equal(h.room().players.guest.word,'秘密');assert.ok(h.room().players.guest.connections.id1);
 await h.disconnect();assert.equal(h.run('guestCanAct()'),false);assert.equal(h.room().players.guest.isWolf,true);await h.online(true);await h.drain();assert.ok(h.room().players.guest.connections.id2);assert.equal(h.room().players.guest.connections.id1,undefined);
 await h.disconnect();for(const [key,value] of Object.entries(original)) assert.deepEqual(h.room().players.guest[key],value);await h.run('stopGuestPresence()');
});
await test('disconnect during reservation prevents alive registration',async()=>{
 const h=harness();let resolve;h.setGate(new Promise(r=>resolve=r));h.run('startGuestPresence()');await h.online(true);await h.online(false);resolve();await h.drain();assert.equal(h.room().players.guest.connections,undefined);assert.equal(h.reservations.size,0);
});
await test('leave while alive transaction is queued removes original guest and cancels presence',async()=>{
 const h=harness();let resolve;h.setTxnGate(new Promise(r=>resolve=r));h.run('startGuestPresence()');await h.online(true);await Promise.resolve();const leaving=h.run('leaveGame()');resolve();await leaving;assert.equal(h.room().players.guest,undefined);assert.equal(h.reservations.size,0);assert.equal(h.run('state.role'),null);
});
await test('deleted room is not recreated by delayed alive transaction',async()=>{
 const h=harness();let resolve;h.setTxnGate(new Promise(r=>resolve=r));h.run('startGuestPresence()');await h.online(true);h.setRoom(null);resolve();await h.drain();assert.equal(h.room(),null);assert.equal(h.reservations.size,0);
});
await test('deleted guest is not recreated by ready / vote',async()=>{
 const h=harness();h.run('startGuestPresence()');await h.online(true);await h.drain();delete h.room().players.guest;await h.run('markReady()');h.room().status='voting';await h.run("submitVote('host')");assert.equal(h.room().players.guest,undefined);assert.equal(h.el('btn-ready').disabled,false);
});
await test('deleted guest is not recreated by delayed alive transaction',async()=>{
 const h=harness();let resolve;h.setTxnGate(new Promise(r=>resolve=r));h.run('startGuestPresence()');await h.online(true);delete h.room().players.guest;resolve();await h.drain();assert.equal(h.room().players.guest,undefined);assert.equal(h.reservations.size,0);
});
await test('retired presence cannot alter replacement room state',async()=>{
 const h=harness(), second=harness();let resolve;h.setGate(new Promise(r=>resolve=r));h.run('startGuestPresence()');await h.online(true);const stopped=h.run('stopGuestPresence()');h.setGlobal('nextRoomRef',second.root);h.run("Object.assign(state,{role:'guest',nickname:'guest',roomCode:'GHIJKL',roomRef:nextRoomRef});startGuestPresence()");await h.online(true);resolve();await stopped;await h.drain();assert.equal(h.run('state.roomRef===nextRoomRef'),true);assert.equal(h.run('guestCanAct()'),true);assert.equal(second.room().players.guest.word,'秘密');assert.ok(second.room().players.guest.connections.id1);assert.equal(h.room().players.guest.connections,undefined);assert.equal(h.reservations.size,0);
});
await test('late old connection removal cannot remove the new connection or player',async()=>{
 const h=harness();h.run('startGuestPresence()');await h.online(true);await h.drain();const oldRef=h.root.child('players/guest/connections/id1');await h.online(false);await h.online(true);await h.drain();assert.ok(h.room().players.guest.connections.id2);await oldRef.remove();assert.ok(h.room().players.guest.connections.id2);assert.equal(h.room().players.guest.word,'秘密');assert.equal(h.run('guestCanAct()'),true);
});
await test('ready / vote rejection restores retry controls',async()=>{
 const h=harness();h.run('startGuestPresence()');await h.online(true);await h.drain();h.setReject(true);await h.run('markReady()');assert.equal(h.el('btn-ready').disabled,false);h.room().status='voting';await h.run("submitVote('host')");assert.equal(h.run('state.myVote'),null);assert.equal(h.el('vote-btns').style.display,'block');
});
await test('missing guest listener retires local session without recreating member',async()=>{
 const h=harness();h.run('startGuestPresence()');await h.online(true);await h.drain();delete h.room().players.guest;h.run(`handleRoom(${JSON.stringify(h.room())})`);await h.drain();assert.equal(h.run('state.role'),null);assert.equal(h.run('state.roomRef'),null);assert.equal(h.room().players.guest,undefined);
});
await test('waiting disconnected guests block game start without role filtering',async()=>{
 const h=harness();Object.assign(h.room(),{status:'waiting'});Object.assign(h.room().players.guest,{presenceVersion:1});h.room().players.third={isHost:false};h.run("state.role='host'");await h.run('startGame()');assert.equal(h.room().status,'waiting');h.room().players.guest.connections={one:true};await h.run('startGame()');assert.equal(h.room().status,'revealing');assert.equal(Object.keys(h.room().players).length,3);
});
await test('expiry abort concurrent exit cannot rearm presence',async()=>{
 const h=harness();h.run('startGuestPresence()');await h.online(true);await h.drain();h.room().expired=true;const expiring=h.run('expireGuestRoom(root)');h.run('state.expectedRoomRemoval=true');h.room().expired=false;await expiring;assert.equal(h.run('guestPresence'),null);
});
await test('expiry disables optimistic local events and retains state for synthetic retry',async()=>{
 const h=harness(), room={...h.room(),expired:true};let retries=0;
 h.setGlobal('expiryRef',{async transaction(update,onComplete,applyLocally){assert.equal(applyLocally,false);assert.equal(update(room),null);retries++;assert.equal(update(room),null);retries++;h.run('state.roomRef=null;state.role=null');return {committed:true};}});
 h.run('state.roomRef=expiryRef');await h.run('expireGuestRoom(expiryRef)');assert.equal(retries,2);assert.equal(h.run('guestPresence'),null);
});
await test('host-named guest session rejected before state changes',async()=>{
 const h=harness();h.run("Object.assign(state,{role:null,nickname:null,roomRef:null});sessionStorage.setItem(SESSION_KEY,JSON.stringify({nickname:'host',roomCode:'ABCDEF',role:'guest'}))");assert.equal(await h.run('tryReconnect()'),false);assert.equal(h.run('state.role'),null);assert.equal(h.reservations.size,0);
});
for (const committed of [true, false]) await test(`join cache listener stays until ${committed ? 'commit' : 'abort'} and releases only itself`,async()=>{
 const h=harness();let listener,finish;const calls=[];const gate=new Promise(resolve=>finish=resolve);
 const ref={on(event,fn){listener=fn;calls.push('on');fn({val:()=>({status:'waiting'})});},async transaction(fn){calls.push('transaction');await gate;return {committed};},off(event,fn){assert.equal(fn,listener);calls.push('off');}};
 h.setGlobal('joinRef',ref);const pending=h.run('joinTransaction(joinRef, () => undefined)');await Promise.resolve();assert.deepEqual(calls,['on','transaction']);finish();await pending;assert.deepEqual(calls,['on','transaction','off']);
});
await test('join cache listener releases on value permission error and transaction rejection',async()=>{
 for(const duringValue of [true,false]){const h=harness();let listener,off=0,transactions=0;h.setGlobal('joinRef',{on(event,fn,error){listener=fn;if(duringValue)error(Error('permission'));else fn({val:()=>null});},async transaction(){transactions++;throw Error('transaction');},off(event,fn){assert.equal(fn,listener);off++;}});await assert.rejects(h.run('joinTransaction(joinRef, () => undefined)'));assert.equal(off,1);assert.equal(transactions,duringValue?0:1);}
});
console.log(JSON.stringify({method:'Node VM with in-memory transaction / onDisconnect sequencing controls; not Firebase SDK or browser evidence',limitations:['No SDK transaction retry protocol simulation; late old removal invokes the old connection path directly'],source:'apps/word-wolf/index.html',sourceSha256,passed:results.length,cases:results},null,2));
