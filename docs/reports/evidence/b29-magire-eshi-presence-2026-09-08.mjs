import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
// Synthetic sequencing, not Firebase SDK transport or browser rendering.
const html = fs.readFileSync(new URL('../../../apps/magire-eshi/index.html', import.meta.url), 'utf8');
const sourceSha256 = createHash('sha256').update(html).digest('hex');
const source = html.slice(html.indexOf('const { authReady, db }'), html.indexOf('// ── 初期化 ──'));
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function harness() {
  let room = { host:'host',hostConnected:true,status:'drawing',round:1,players:{host:{isHost:true,confirmed:false,vote:null},guest:{isHost:false,confirmed:true,vote:null},g2:{isHost:false,confirmed:true,vote:null},g3:{isHost:false,confirmed:true,vote:null}},game:{topicWord:'ねこ',topicCategory:'どうぶつ',fakeArtist:'guest',drawOrder:['guest','g2','g3'],colors:{guest:'#123456',g2:'#222222',g3:'#333333'},turnIndex:0,strokes:{saved:{by:'g2',color:'#222222',points:[[1,2]]}},result:null}};
  const elements=new Map(),reservations=new Map(),timers=new Map(),cancels=[],options=[];
  const canvasContext={beginPath(){},moveTo(){},lineTo(){},stroke(){},clearRect(){}};
  let connected,listener,id=0,timerId=0,gate=null,txnGate=null,reject=false;
  function element(id) { if(!elements.has(id)) elements.set(id,{value:'',textContent:'',innerHTML:'',dataset:{},children:[],handlers:{},disabled:false,style:{},width:600,height:450,
    classList:{toggle(){},remove(){},add(){}},removeAttribute(){},appendChild(child){this.children.push(child);},addEventListener(event,fn){this.handlers[event]=fn;},setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:600,height:450}),getContext:()=>canvasContext});return elements.get(id); }
  const snapshot=()=>({exists:()=>!!room,val:()=>structuredClone(room)});
  const emit=()=>listener?.(snapshot());
  function ref(path='') { return {key:path.split('/').at(-1),child:p=>ref([path,p].filter(Boolean).join('/')),push(){return this.child('id'+(++id));},async get(){return snapshot();},
    on(event,fn){if(path==='.info/connected')connected=fn;else{listener=fn;fn(snapshot());}},off(event,fn){if(path==='.info/connected'){if(!fn||connected===fn)connected=null;}else if(!fn||listener===fn)listener=null;},
    async transaction(fn,callback,local){if(txnGate)await txnGate;if(reject)throw Error('intentional');options.push(local);const next=fn(structuredClone(room));if(next!==undefined){room=next;emit();}return {committed:next!==undefined,snapshot:snapshot()};},
    async remove(){if(!path)room=null;else{const parts=path.split('/');let cursor=room;for(const part of parts.slice(0,-1)){cursor=cursor?.[part];if(!cursor)return;}delete cursor[parts.at(-1)];}emit();},
    onDisconnect(){return{async remove(){reservations.set(path,true);if(gate)await gate;},async cancel(){reservations.delete(path);}};}
  }; }
  const root=ref(),storage=new Map();
  const context=vm.createContext({window:{confirm:()=>true},confirm:()=>true,console:{warn(){},error(){}},
    setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),setInterval:()=>++timerId,clearInterval(){},
    firebase:{database:{ServerValue:{TIMESTAMP:1}}},RoomkRTDB:{initFirebase:()=>({authReady:Promise.resolve(),db:{ref:p=>p==='.info/connected'?ref(p):root}}),esc:String,showToast(){},now:()=>1000,isRoomExpired:r=>r?.expired===true,getHostDisconnectedAt:()=>0,cancelRoomOnDisconnect:async ref=>{cancels.push(ref);},generateRoomCode:()=> 'ABCDEF'},
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)},
    document:{getElementById:element,querySelectorAll:s=>s==='.mgr-vote-btn'?element('vt-btns').children:[],createElement:()=>element('created'+(++id))},root});
  vm.runInContext(source,context);vm.runInContext("Object.assign(state,{role:'guest',nickname:'guest',roomCode:'ABCDEF',roomRef:root,round:1,currentScreen:'drawing'})",context);
  return {root,timers,cancels,options,reservations,el:element,room:()=>room,setRoom:r=>{room=r;},emit,
    run:s=>vm.runInContext(s,context),global:(k,v)=>{context[k]=v;},gate:v=>{gate=v;},txnGate:v=>{txnGate=v;},reject:v=>{reject=v;},
    pointer:(event,x=10,y=20)=>element('cv-draw').handlers[event]?.({pointerId:1,clientX:x,clientY:y,preventDefault(){}}),
    async online(value){connected?.({val:()=>value});await Promise.resolve();},async drain(){await vm.runInContext('guestPresenceWork',context);},
    async disconnect(){for(const path of [...reservations.keys()]){await ref(path).remove();reservations.delete(path);}await this.online(false);}};
}
async function connect(h){h.run('startRoomListener();startGuestPresence()');await h.online(true);await h.drain();}
function host(h){h.run("state.role='host';state.nickname='host'");}
function stroke(h){h.pointer('pointerdown');h.pointer('pointermove',30,40);h.pointer('pointerup');}
function caught(h){h.room().status='result';h.room().game.result={outcome:'caught',voteCounts:{guest:2},reversalGuess:null,reversalJudge:null};h.emit();}
const cases=[];async function test(name,fn){await fn();cases.push(name);}
for(const phase of ['waiting','reveal_role','drawing','discussion','voting','result','done'])await test('two disconnect cycles retain state in '+phase,async()=>{
 const h=harness();h.room().status=phase;h.room().players.guest.vote='g2';h.room().game.result={outcome:'caught',reversalGuess:'ねこ',reversalJudge:'win'};const game=plain(h.room().game);await connect(h);for(let i=0;i<2;i++){await h.disconnect();await h.online(true);await h.drain();assert.deepEqual(plain(h.room().game),game);assert.equal(h.room().players.guest.confirmed,true);assert.equal(h.room().players.guest.vote,'g2');assert.equal(Object.keys(h.room().players.guest.connections).length,1);}
});
await test('late reservation acknowledgement cannot publish alive after disconnect',async()=>{
 const h=harness(),d=deferred();h.gate(d.promise);h.run('startGuestPresence()');await h.online(true);await h.online(false);d.resolve();await h.drain();assert.equal(h.room().players.guest.connections,undefined);
});
await test('old connection removal cannot erase new id',async()=>{
 const h=harness();await connect(h);await h.online(false);await h.online(true);await h.drain();await h.root.child('players/guest/connections/id1').remove();assert.equal(h.room().players.guest.connections.id2,true);
});
await test('delayed alive cannot recreate missing guest',async()=>{
 const h=harness(),d=deferred();h.txnGate(d.promise);h.run('startGuestPresence()');await h.online(true);delete h.room().players.guest;d.resolve();await h.drain();assert.equal(h.room().players.guest,undefined);
});
await test('exit invalidates delayed alive and retains already committed strokes',async()=>{
 const h=harness(),d=deferred();h.txnGate(d.promise);h.run('startGuestPresence()');await h.online(true);const pending=h.run('leaveGame()');d.resolve();await pending;assert.equal(h.room().players.guest,undefined);assert.ok(h.room().game.strokes.saved);assert.equal(h.run('state.role'),null);
});
await test('old delayed presence does not mutate replacement room game',async()=>{
 const h=harness(),next=harness(),d=deferred();h.gate(d.promise);h.run('startGuestPresence()');await h.online(true);const stop=h.run('stopGuestPresence()');h.global('nextRef',next.root);h.run('state.roomRef=nextRef;startGuestPresence()');await h.online(true);d.resolve();await stop;await h.drain();assert.equal(h.room().players.guest.connections,undefined);assert.equal(next.room().players.guest.connections.id1,true);assert.equal(next.room().game.turnIndex,0);
});
await test('one stroke atomically appends one path and advances one turn despite repeated OK',async()=>{
 const h=harness();await connect(h);stroke(h);const d=deferred();h.txnGate(d.promise);const first=h.run('confirmStroke()');await h.run('confirmStroke()');d.resolve();await first;assert.equal(h.room().game.turnIndex,1);assert.equal(Object.keys(h.room().game.strokes).length,2);const added=Object.values(h.room().game.strokes).find(s=>s.by==='guest');assert.deepEqual(plain(added.points),[[10,20],[30,40]]);assert.equal(added.color,'#123456');
});
await test('stroke callback synthetic retry reuses one fixed push key',async()=>{
 const h=harness();await connect(h);stroke(h);const original=h.root.transaction;h.root.transaction=async fn=>{const first=fn(plain(h.room())),second=fn(plain(h.room()));assert.deepEqual(Object.keys(first.game.strokes),Object.keys(second.game.strokes));return original(fn);};await h.run('confirmStroke()');assert.equal(h.room().game.turnIndex,1);assert.equal(Object.keys(h.room().game.strokes).length,2);
});
for(const changed of ['round','turn','connection','member','room'])await test('delayed stroke rejects changed '+changed,async()=>{
 const h=harness();await connect(h);stroke(h);const d=deferred();h.txnGate(d.promise);const pending=h.run('confirmStroke()');if(changed==='round')h.room().round=2;if(changed==='turn')h.room().game.turnIndex=1;if(changed==='connection')await h.online(false);if(changed==='member')delete h.room().players.guest;if(changed==='room')h.setRoom(null);const before=plain(h.room());d.resolve();await pending;assert.deepEqual(plain(h.room()),before);
});
await test('disconnect during pointer input discards unsubmitted line and does not advance turn',async()=>{
 const h=harness();await connect(h);h.pointer('pointerdown');h.pointer('pointermove',40,50);await h.online(false);h.pointer('pointerup');assert.equal(h.run('state.pendingStroke'),null);assert.equal(h.run('state.isPointerDrawing'),false);assert.equal(h.room().game.turnIndex,0);assert.equal(Object.keys(h.room().game.strokes).length,1);
});
await test('old stroke finally cannot clear replacement stroke token',async()=>{
 const h=harness();await connect(h);stroke(h);const d=deferred();h.txnGate(d.promise);const pending=h.run('confirmStroke()');h.room().round=2;h.emit();h.run('state.strokeSubmitting={replacement:true};state.pendingStroke={replacement:true}');d.resolve();await pending;assert.equal(h.run('state.strokeSubmitting.replacement'),true);assert.equal(h.run('state.pendingStroke.replacement'),true);
});
for(const phase of ['waiting','result'])await test(phase+' start waits for connected guests and preserves presence',async()=>{
 const h=harness();await connect(h);host(h);h.room().status=phase;h.room().players.guest.connections={};await h.run(phase==='waiting'?'hostStartGame()':'hostNextRound()');assert.equal(h.room().status,phase);h.room().players.guest.connections={retained:true};await h.run(phase==='waiting'?'hostStartGame()':'hostNextRound()');assert.equal(h.room().status,'reveal_role');assert.equal(h.room().players.guest.connections.retained,true);assert.equal(h.room().players.guest.confirmed,false);
});
await test('fewer than three guests cannot start',async()=>{
 const h=harness();host(h);h.room().status='waiting';delete h.room().players.g3;await h.run('hostStartGame()');assert.equal(h.room().status,'waiting');
});
for(const phase of ['waiting','result'])await test(phase+' round transition suppresses optimistic self-invalidation and still rejects true newer round',async()=>{
 const h=harness();host(h);h.room().status=phase;h.room().round=phase==='waiting'?0:1;h.run(`state.round=${h.room().round}`);h.root.transaction=async(fn,callback,local)=>{assert.equal(local,false);const before=plain(h.room()),first=fn(before);assert.ok(first);if(local!==false)h.run(`state.round=${first.round}`);const retried=fn(plain(before));assert.ok(retried);assert.equal(retried.round,first.round);assert.equal(fn({...before,round:first.round}),undefined);return {committed:true};};await h.run(phase==='waiting'?'hostStartGame()':'hostNextRound()');
});
await test('disconnected in-turn player remains in turn and explicit missing player is skipped',async()=>{
 const h=harness();await connect(h);await h.disconnect();host(h);h.emit();assert.equal(h.room().game.turnIndex,0);delete h.room().players.guest;h.emit();await Promise.resolve();assert.equal(h.room().game.turnIndex,1);
});
await test('old missing-player skip cannot advance same index in next round',async()=>{
 const h=harness();host(h);delete h.room().players.guest;const d=deferred();h.txnGate(d.promise);h.run('startRoomListener()');h.room().round=2;d.resolve();await Promise.resolve();await Promise.resolve();assert.equal(h.room().game.turnIndex,0);
});
for(const key of ['confirm','vote','guess'])await test('delayed '+key+' rejects next round and missing player',async()=>{
 for(const missing of [false,true]){const h=harness();h.room().players.guest.confirmed=false;h.room().status=key==='confirm'?'reveal_role':'voting';await connect(h);if(key==='guess')caught(h);h.el('rs-guess-input').value='ねこ';const d=deferred();h.txnGate(d.promise);const pending=h.run(key==='confirm'?'confirmRole()':key==='vote'?"submitVote('g2')":'submitReversalGuess()');if(missing)delete h.room().players.guest;else h.room().round=2;const before=plain(h.room());d.resolve();await pending;assert.deepEqual(plain(h.room()),before);}
});
await test('delayed 300ms click cannot vote in next voting round',async()=>{
 const h=harness();await connect(h);h.room().status='voting';h.emit();h.el('vt-btns').children[0].onclick();const timer=[...h.timers.values()].find(t=>t.ms===300);assert.ok(timer);h.room().round=2;h.emit();await timer.fn();await Promise.resolve();assert.equal(h.room().players.guest.vote,null);
});
for(const reject of [false,true])await test('confirm '+(reject?'reject':'abort')+' restores control after redraw',async()=>{
 const h=harness();h.room().status='reveal_role';h.room().players.guest.confirmed=false;await connect(h);const d=deferred();h.txnGate(d.promise);const pending=h.run('confirmRole()');h.emit();assert.equal(h.el('btn-confirm').disabled,true);if(reject)h.reject(true);else h.room().round=2;d.resolve();await pending;assert.equal(h.run('state.confirmAction'),null);assert.equal(h.el('btn-confirm').disabled,false);
});
await test('guess committed first aborts host skip',async()=>{
 const h=harness();await connect(h);caught(h);h.el('rs-guess-input').value='ねこ';await h.run('submitReversalGuess()');host(h);await h.run('hostSkipReversal()');assert.equal(h.room().game.result.reversalGuess,'ねこ');assert.equal(h.room().game.result.reversalJudge,null);
});
await test('synthetic precommitted host skip rejects delayed guest guess',async()=>{
 const h=harness();await connect(h);caught(h);h.el('rs-guess-input').value='ねこ';const d=deferred();h.txnGate(d.promise);const pending=h.run('submitReversalGuess()');h.room().game.result.reversalJudge='lose';d.resolve();await pending;assert.equal(h.room().game.result.reversalGuess,null);assert.equal(h.room().game.result.reversalJudge,'lose');
});
await test('separate host helper commits skip before queued guest helper without changing guest identity',async()=>{
 const h=harness(),other=harness();await connect(h);caught(h);h.el('rs-guess-input').value='ねこ';const d=deferred();h.txnGate(d.promise);const pending=h.run('submitReversalGuess()');h.txnGate(null);other.global('sharedRef',h.root);other.run("state.roomRef=sharedRef;state.role='host';state.nickname='host'");await other.run('hostSkipReversal()');assert.equal(h.room().game.result.reversalJudge,'lose');assert.equal(h.run('state.role'),'guest');d.resolve();await pending;assert.equal(h.room().game.result.reversalGuess,null);assert.equal(h.room().game.result.reversalJudge,'lose');
});
await test('missing fake artist yields aborted while disconnected retained fake remains counted',async()=>{
 for(const missing of [false,true]){const h=harness();await connect(h);host(h);h.room().status='voting';h.room().players.guest.connections={};h.room().players.g2.vote='guest';h.room().players.g3.vote='guest';if(missing)delete h.room().players.guest;await h.run('computeResult()');assert.equal(h.room().game.result.outcome,missing?'aborted':'caught');}
});
await test('done timer is 30000ms and cancels captured ref before nonlocal room deletion',async()=>{
 const h=harness();host(h);h.room().status='done';h.run('startRoomListener()');assert.ok([...h.timers.values()].some(t=>t.ms===30000));await h.run('deleteDoneRoom(captureAction())');assert.equal(h.cancels[0],h.root);assert.equal(h.options.at(-1),false);assert.equal(h.room(),null);assert.equal(h.run('state.currentScreen'),'top');
});
await test('TTL deletion uses nonlocal transaction and old done callback cannot erase next round',async()=>{
 const h=harness();h.room().expired=true;await h.run('expireGuestRoom(root)');assert.equal(h.options.at(-1),false);assert.equal(h.room(),null);const next=harness();host(next);next.run('globalThis.oldAction=captureAction()');next.room().status='done';next.room().round=2;await next.run('deleteDoneRoom(oldAction)');assert.ok(next.room());
});
for(const session of [{nickname:'host',role:'guest'},{nickname:'guest',role:'other'},{nickname:'bad/name',role:'guest'}])await test('invalid session rejects before state mutation '+session.nickname+'/'+session.role,async()=>{
 const h=harness();h.run(`Object.assign(state,{role:null,nickname:null,roomRef:null});sessionStorage.setItem(SESSION_KEY,JSON.stringify(${JSON.stringify({...session,roomCode:'ABCDEF'})}))`);assert.equal(await h.run('tryReconnect()'),false);assert.equal(h.run('state.role'),null);
});
for(const outcome of ['commit','abort','reject','value-error'])await test('temporary join listener cleanup '+outcome,async()=>{
 const h=harness(),d=deferred();let listener,off=0,tx=0;h.global('joinRef',{on(event,fn,error){listener=fn;if(outcome==='value-error')error(Error('value'));else fn();},off(event,fn){assert.equal(fn,listener);off++;},async transaction(){tx++;await d.promise;if(outcome==='reject')throw Error('reject');return{committed:outcome==='commit'};}});const pending=h.run('joinTransaction(joinRef,()=>undefined)');if(outcome==='value-error'){await assert.rejects(pending);assert.equal(tx,0);}else{await Promise.resolve();assert.equal(off,0);d.resolve();if(outcome==='reject')await assert.rejects(pending);else await pending;}assert.equal(off,1);
});
console.log(JSON.stringify({method:'Node VM synthetic transaction/onDisconnect/pointer sequencing; not SDK or browser evidence',limitations:['No actual Firebase retry protocol or transport','Canvas and DOM are minimal stubs: no real pointer layout or rendered secrecy assertion','Old reservation is modeled by direct old-path removal; cancellation helper is a call spy'],source:'apps/magire-eshi/index.html',sourceSha256,passed:cases.length,cases},null,2));
