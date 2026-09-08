// B-26 real SDK / isolated Emulator Playwright CLI steps, 2026-09-08.
// Not a Playwright Test spec. Prints one callable step for playwright-cli run-code.
// Preconditions: isolated demo-roomk-b26 Auth9099/RTDB9000/Hosting5500,
// scratch stats no-op, production config absent, CSP loopback-only data connections.
// Start a dedicated b26 CLI session on http://127.0.0.1:5500/word-wolf/,
// create a room as host via UI, then run steps in order: setup waiting gameplay cleanup timer.
// Keep the host page as the CLI controller; guests use separate contexts.
// Example (from scratch directory, output/playwright already exists):
// playwright-cli -s=b26 run-code "$(node /absolute/path/to/this.mjs setup)"
// repeat with waiting, gameplay, cleanup, timer. Each step records window.b26report.
// Offline tests use browser context.setOffline, NOT SDK goOffline.
// TTL tests inject prior timestamps into synthetic rooms, NOT a full 2min wall wait.
// Artificial delayed transaction/registration races are separate VM evidence.
// Scope: synthetic host/guestA/guestB only. Never run against production.
async function setupGuests(page) {
  const report={started:new Date().toISOString(),network:[],errors:[],cases:[]};
  const browser=page.context().browser();
  if (browser.contexts().length !== 1 || browser.contexts()[0].pages().length !== 1) throw Error('Use a fresh dedicated b26 session; existing contexts are not closed automatically');
  const code=await page.evaluate(()=>state.roomCode);
  await page.evaluate(()=>window.b26role='host');
  try { for(const role of ['guestA','guestB']) {
    const p=await(await browser.newContext()).newPage();
    const req=r=>report.network.push(r.url());
    const ws=w=>report.network.push(w.url());
    const err=e=>report.errors.push({role,error:String(e)});
    p.on('request',req);p.on('websocket',ws);p.on('pageerror',err);
    await p.addInitScript(role=>window.b26role=role,role);
    await p.goto('http://127.0.0.1:5500/word-wolf/');
    await p.locator('body').ariaSnapshot();
    await p.getByRole('button',{name:'ルームに参加する',exact:true}).click();
    report.cases.push({name:role+' join form',snapshot:await p.locator('body').ariaSnapshot()});
    await p.getByRole('textbox',{name:'ニックネーム（8文字以内）'}).fill(role);
    await p.getByRole('textbox',{name:'ルームコード（6桁）'}).fill(code);
    await p.getByRole('button',{name:'参加する',exact:true}).click();
    await p.waitForFunction(()=>state.currentScreen==='waiting' && guestPresence?.ready===true);
    report.cases.push({name:role+' joined',state:await p.evaluate(()=>({role:state.role,screen:state.currentScreen,ready:guestPresence.ready})),snapshot:await p.locator('body').ariaSnapshot()});
    p.off('request',req);p.off('websocket',ws);p.off('pageerror',err);
  } } catch(error) { report.failure=String(error); await page.evaluate(r=>window.b26report=r,report); throw error; }
  report.room=code;
  report.initial=await(await page.request.get('http://127.0.0.1:9000/wordwolf_rooms/'+code+'.json?ns=demo-roomk-b26',{headers:{Authorization:'Bearer owner'}})).json();
  await page.evaluate(r=>window.b26report=r,report);
  return report;
}

async function waitingChecks(page) {
  const report=await page.evaluate(()=>window.b26report);
  const pages=page.context().browser().contexts().flatMap(c=>c.pages());
  const a=pages[1], b=pages[2], h=page;
  const read=async()=>await(await page.request.get('http://127.0.0.1:9000/wordwolf_rooms/'+report.room+'.json?ns=demo-roomk-b26',{headers:{Authorization:'Bearer owner'}})).json();
  const stable=p=>({isHost:p.isHost,isWolf:p.isWolf,word:p.word,ready:p.ready,vote:p.vote??null});
  const assert=(ok,msg)=>{if(!ok) throw Error(msg);};
  try {
    const initial=stable((await read()).players.guestA);
    await a.reload();
    await a.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready===true);
    assert(JSON.stringify(stable((await read()).players.guestA))===JSON.stringify(initial),'waiting reload changed player');
    report.cases.push({name:'waiting reload',pass:true});
    for(let round=1;round<=2;round++) {
      const before=(await read()).players.guestA;
      const marker=await a.evaluate(()=>window.b26marker??=Date.now());
      await a.context().setOffline(true);
      await h.waitForFunction(async()=>!(await state.roomRef.get()).val().players.guestA.connections,null,{timeout:45000});
      const offline=await read();
      assert(JSON.stringify(stable(offline.players.guestA))===JSON.stringify(initial),'offline changed retained player');
      assert(await h.locator('#btn-start').isDisabled(),'host start not disabled while offline');
      await a.waitForFunction(()=>document.getElementById('guest-off-overlay').classList.contains('show'));
      await h.setViewportSize({width:1280,height:900});
      await h.screenshot({path:'output/playwright/waiting-offline-host-'+round+'.png'});
      await a.setViewportSize({width:375,height:812});
      await a.screenshot({path:'output/playwright/waiting-offline-guest-'+round+'.png'});
      assert(await a.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'offline guest overflow');
      await page.waitForTimeout(10000);
      await a.context().setOffline(false);
      await a.waitForFunction(()=>guestPresence?.ready===true,null,{timeout:45000});
      await h.waitForFunction(()=>!document.getElementById('btn-start').disabled);
      const after=(await read()).players.guestA;
      assert(JSON.stringify(stable(after))===JSON.stringify(initial),'reconnect changed guest');
      assert(await a.evaluate(()=>window.b26marker)===marker,'reconnect reloaded page');
      const oldKeys=Object.keys(before.connections||{}), newKeys=Object.keys(after.connections||{});
      assert(newKeys.length===1&&!oldKeys.includes(newKeys[0]),'connection id did not rotate or stale ids remained');
      report.cases.push({name:'waiting browser offline10s/online round'+round,pass:true,offline:offline.players.guestA,after,marker,hostStartDisabled:true});
    }
    report.waiting=await read();
  } catch(error) {report.failure=String(error);throw error;} finally {await page.evaluate(r=>window.b26report=r,report);}
  return report;
}

async function gameplayChecks(page) {
  const report=await page.evaluate(()=>window.b26report);
  const pages=page.context().browser().contexts().flatMap(c=>c.pages());
  const [h,a,b]=pages;
  const read=async()=>await(await page.request.get('http://127.0.0.1:9000/wordwolf_rooms/'+report.room+'.json?ns=demo-roomk-b26',{headers:{Authorization:'Bearer owner'}})).json();
  const stable=p=>({isHost:p.isHost,isWolf:p.isWolf,word:p.word,ready:p.ready,vote:p.vote??null});
  const assert=(ok,msg)=>{if(!ok) throw Error(msg);};
  const reload=async phase=>{
    const before=stable((await read()).players.guestA);
    await a.reload(); await a.waitForFunction(phase=>state.currentScreen===phase&&guestPresence?.ready,phase);
    const after=stable((await read()).players.guestA);
    assert(JSON.stringify(before)===JSON.stringify(after),phase+' reload changed player');
    report.cases.push({name:phase+' reload',pass:true,before,after});
  };
  const reconnect=async phase=>{
    const before=stable((await read()).players.guestA);
    await a.context().setOffline(true);
    await h.waitForFunction(async()=>!(await state.roomRef.get()).val().players.guestA.connections,null,{timeout:45000});
    await page.waitForTimeout(10000);
    await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
    const after=stable((await read()).players.guestA);
    assert(JSON.stringify(before)===JSON.stringify(after),phase+' reconnect changed player');
    assert(await a.evaluate(()=>state.currentScreen)===phase,phase+' reconnect changed phase');
    report.cases.push({name:phase+' browser offline10s/online',pass:true,before,after});
  };
  try {
    await h.locator('#btn-start').click();
    await a.waitForFunction(()=>state.currentScreen==='revealing');
    await reload('revealing');
    await a.locator('#flip-card').click();await a.locator('#btn-ready').click();
    await a.waitForFunction(async()=>(await state.roomRef.get()).val().players.guestA.ready);
    await reload('revealing');
    assert(!await h.locator('#host-discuss-btn').isVisible(),'allReady bypassed');
    await reconnect('revealing');
    for(const p of [h,b]) {await p.locator('#flip-card').click();await p.locator('#btn-ready').click();}
    await h.getByRole('button',{name:'討論スタート！'}).click();
    await a.waitForFunction(()=>state.currentScreen==='discussing');
    await reload('discussing');
    const deadline=(await read()).discussionEndsAt;
    await a.context().setOffline(true);
    await h.waitForFunction(async()=>!(await state.roomRef.get()).val().players.guestA.connections,null,{timeout:45000});
    await page.waitForTimeout(10000);
    await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
    assert((await read()).discussionEndsAt===deadline,'reconnect reset discussion deadline');
    report.cases.push({name:'discussing browser offline10s/online',pass:true,deadline});
    await h.getByRole('button',{name:'投票フェーズへ'}).click();
    await a.waitForFunction(()=>state.currentScreen==='voting');
    await a.locator('#vote-btns button').first().click();
    await a.waitForFunction(()=>!!state.myVote);
    await reload('voting');
    await reconnect('voting');
    await a.setViewportSize({width:375,height:812});
    await a.screenshot({path:'output/playwright/voting-guest-375.png'});
    assert(await a.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'voting overflow');
    await b.context().setOffline(true);
    await h.waitForFunction(async()=>!(await state.roomRef.get()).val().players.guestB.connections,null,{timeout:45000});
    h.once('dialog',d=>d.accept());
    await h.getByRole('button',{name:'投票を締め切って結果へ'}).click();
    await a.waitForFunction(()=>state.currentScreen==='result');
    report.cases.push({name:'host closes vote with disconnected unvoted guest',pass:true,result:await read()});
    await reload('result');
    await reconnect('result');
    for(const p of [h,a]) {await p.setViewportSize({width:p===h?1280:375,height:900});await p.screenshot({path:'output/playwright/result-'+(p===h?'host-1280':'guest-375')+'.png'});assert(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),'result overflow');}
    await h.getByRole('button',{name:'もう一度',exact:true}).click();
    await a.waitForFunction(()=>state.currentScreen==='waiting');
    assert(await h.locator('#btn-start').isDisabled(),'replay started without offline guest');
    assert(Object.keys((await read()).players).length===3,'replay dropped guest');
    await b.context().setOffline(false);await b.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
    await h.waitForFunction(()=>!document.getElementById('btn-start').disabled);
    report.cases.push({name:'replay retains offline guest and waits for reconnect',pass:true,room:await read()});
  } catch(error){report.failure=String(error);throw error;} finally {await page.evaluate(r=>window.b26report=r,report);}
  return report;
}

async function cleanupChecks(page) {
  const report=await page.evaluate(()=>window.b26report);
  const [h,a,b]=page.context().browser().contexts().flatMap(c=>c.pages());
  const url='http://127.0.0.1:9000/wordwolf_rooms/'+report.room+'.json?ns=demo-roomk-b26';
  const headers={Authorization:'Bearer owner'};
  const read=async()=>await(await page.request.get(url,{headers})).json();
  const patch=async data=>await page.request.patch(url,{headers,data});
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  try {
    if(await b.evaluate(()=>state.currentScreen)==='waiting') await b.getByRole('button',{name:'退出する',exact:true}).click();
    await b.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null);
    await h.waitForFunction(async()=>!(await state.roomRef.get()).val().players.guestB);
    await b.context().setOffline(true);await page.waitForTimeout(1000);await b.context().setOffline(false);
    await b.reload();await b.waitForFunction(()=>state.currentScreen==='top');
    assert(!(await read()).players.guestB,'explicit exit resurrected guest');
    report.cases.push({name:'explicit guest exit + browser reconnect/reload',pass:true});
    await patch({'players/guestA':null});
    await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);
    await a.evaluate(async()=>{await markReady();await submitVote('host');});
    await a.context().setOffline(true);await page.waitForTimeout(1000);await a.context().setOffline(false);
    await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');
    assert(!(await read()).players.guestA,'missing guest recreated');
    report.cases.push({name:'external guest deletion + ready/vote attempts + reconnect/reload',pass:true});
    const before=await read();
    for(const session of [{nickname:'host',roomCode:report.room,role:'guest'},{nickname:'absent',roomCode:report.room,role:'guest'},{nickname:'notHost',roomCode:report.room,role:'host'},{nickname:'host',roomCode:report.room,role:'unexpected'}]) {
      await a.evaluate(s=>sessionStorage.setItem('wordwolf_session',JSON.stringify(s)),session);
      await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');
      assert(await a.evaluate(()=>!sessionStorage.getItem('wordwolf_session')&&state.roomRef===null&&guestPresence===null),'invalid session retained');
      assert(JSON.stringify(await read())===JSON.stringify(before),'invalid session wrote room');
      report.cases.push({name:'invalid saved session refused',pass:true,session});
    }
    await patch({'players/legacyA':{isHost:false,isWolf:false,word:'',ready:false},'players/legacyB':{isHost:false,isWolf:false,word:'',ready:false}});
    await h.waitForFunction(()=>!document.getElementById('btn-start').disabled);
    report.cases.push({name:'legacy player without presenceVersion treated connected',pass:true});
    await patch({'players/legacyA':null,'players/legacyB':null});
    await b.getByRole('button',{name:'ルームに参加する',exact:true}).click();
    await b.getByRole('textbox',{name:'ニックネーム（8文字以内）'}).fill('guestB');
    await b.getByRole('textbox',{name:'ルームコード（6桁）'}).fill(report.room);
    await b.getByRole('button',{name:'参加する',exact:true}).click();
    await b.waitForFunction(()=>guestPresence?.ready);
    await patch({hostConnected:false,hostDisconnectedAt:Date.now()-125000});
    await b.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null);
    await h.waitForFunction(()=>state.currentScreen==='top');
    assert(await read()===null,'expired room not removed');
    await b.context().setOffline(true);await page.waitForTimeout(1000);await b.context().setOffline(false);
    await b.reload();await b.waitForFunction(()=>state.currentScreen==='top');
    assert(await read()===null,'expired room recreated');
    report.cases.push({name:'TTL cleanup via injected past hostDisconnectedAt (not 2min wall wait)',pass:true});
    delete report.failure;
  } catch(error){report.failure=String(error);throw error;} finally {await page.evaluate(r=>window.b26report=r,report);}
  return report;
}

async function ttlTimerCheck(page) {
  const report=await page.evaluate(()=>window.b26report);
  const [h,a,b]=page.context().browser().contexts().flatMap(c=>c.pages());
  const headers={Authorization:'Bearer owner'};
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  try {
    await h.getByRole('button',{name:'ルームを作る',exact:true}).click();
    await h.getByRole('textbox',{name:'ニックネーム（8文字以内）'}).fill('host');
    await h.getByRole('button',{name:'ルームを作成する',exact:true}).click();
    await h.waitForFunction(()=>state.currentScreen==='waiting');
    const code=await h.evaluate(()=>state.roomCode);
    await b.getByRole('button',{name:'ルームに参加する',exact:true}).click();
    await b.getByRole('textbox',{name:'ニックネーム（8文字以内）'}).fill('guestB');
    await b.getByRole('textbox',{name:'ルームコード（6桁）'}).fill(code);
    await b.getByRole('button',{name:'参加する',exact:true}).click();
    await b.waitForFunction(()=>guestPresence?.ready);
    const url='http://127.0.0.1:9000/wordwolf_rooms/'+code+'.json?ns=demo-roomk-b26';
    const start=Date.now();
    await page.request.patch(url,{headers,data:{hostConnected:false,hostDisconnectedAt:Date.now()-119000}});
    await b.waitForFunction(()=>!!state.orphanTimer);
    await b.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);
    await h.waitForFunction(()=>state.currentScreen==='top');
    assert(await(await page.request.get(url,{headers})).json()===null,'timer TTL room retained');
    const elapsed=Date.now()-start;
    await b.context().setOffline(true);await page.waitForTimeout(1000);await b.context().setOffline(false);await b.reload();
    await b.waitForFunction(()=>state.currentScreen==='top');
    assert(await(await page.request.get(url,{headers})).json()===null,'timer TTL room resurrected');
    report.cases.push({name:'TTL timer via injected past119sec timestamp (not 2min wall wait)',pass:true,code,elapsedMs:elapsed});
  } catch(error){report.failure=String(error);throw error;}finally{await page.evaluate(r=>window.b26report=r,report);}
  return report;
}

async function discussionFixtureCheck(page) {
  const report=await page.evaluate(()=>window.b26report);
  const a=page.context().browser().contexts()[1].pages()[0];
  const code='B26DSC', headers={Authorization:'Bearer owner'};
  const url='http://127.0.0.1:9000/wordwolf_rooms/'+code+'.json?ns=demo-roomk-b26';
  const read=async()=>await(await page.request.get(url,{headers})).json();
  const stable=p=>({isHost:p.isHost,isWolf:p.isWolf,word:p.word,ready:p.ready,vote:p.vote??null});
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  try {
    await page.request.put(url,{headers,data:{host:'host',hostConnected:true,status:'discussing',discussionSecs:300,discussionEndsAt:Date.now()+300000,wolfCount:1,citizenWord:'プリン',wolfWord:'ケーキ',players:{host:{isHost:true,isWolf:false,word:'プリン',ready:true},guestA:{isHost:false,isWolf:true,word:'ケーキ',ready:true,presenceVersion:1}}}});
    await a.evaluate(roomCode=>sessionStorage.setItem('wordwolf_session',JSON.stringify({roomCode,nickname:'guestA',role:'guest'})),code);
    await a.reload();await a.waitForFunction(()=>state.currentScreen==='discussing'&&guestPresence?.ready);
    const before=stable((await read()).players.guestA), deadline=(await read()).discussionEndsAt;
    await a.context().setOffline(true);
    let offline;
    for(let count=0;count<180;count++){offline=await read();if(!offline.players.guestA.connections)break;await page.waitForTimeout(250);}
    assert(!offline.players.guestA.connections,'disconnect did not clear connection');
    assert(JSON.stringify(stable(offline.players.guestA))===JSON.stringify(before),'offline changed data');
    await page.waitForTimeout(10000);
    await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
    const after=stable((await read()).players.guestA);
    assert(JSON.stringify(before)===JSON.stringify(after),'discussion reconnect changed data');
    assert((await read()).discussionEndsAt===deadline,'discussion deadline changed');
    report.cases.push({name:'discussing synthetic phase fixture browser offline10s/online full field comparison',pass:true,before,after,deadline});
    await page.request.delete(url,{headers});
    await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null);
    await a.context().setOffline(true);await page.waitForTimeout(1000);await a.context().setOffline(false);
    await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');
    assert(await read()===null,'deleted fixture room regenerated');
    report.cases.push({name:'external whole-room deletion plus reconnect/reload',pass:true});
  }catch(error){report.failure=String(error);throw error;}finally{await page.evaluate(r=>window.b26report=r,report);}
  return report;
}

async function assertIsolated(page, phase) {
  const contexts=page.context().browser().contexts();
  const expected=phase==='setup'?1:3;
  if(contexts.length!==expected || contexts[0]!==page.context() || contexts.some(c=>c.pages().length!==1)) throw Error('Dedicated b26 context/page layout required; refusing to touch existing contexts');
  const roles=['host','guestA','guestB'];
  for(let index=0;index<contexts.length;index++) {
    const target=contexts[index].pages()[0];
    if(target.url()!=='http://127.0.0.1:5500/word-wolf/') throw Error('Only the isolated loopback word-wolf page is allowed');
    const info=await target.evaluate(()=>({project:firebase.app().options.projectId,db:db.ref().toString(),databaseURL:firebase.app().options.databaseURL,auth:firebase.auth().emulatorConfig,role:window.b26role}));
    if(info.project!=='demo-roomk-b26' || info.db!=='http://127.0.0.1:9000/' || info.databaseURL!=='http://127.0.0.1:9000?ns=demo-roomk-b26' || info.auth?.host!=='127.0.0.1' || info.auth?.port!==9099) throw Error('Firebase must use demo-roomk-b26 loopback emulators');
    if(phase!=='setup' && info.role!==roles[index]) throw Error('Guest/host context role mismatch');
  }
  const response=await page.request.get(page.url());
  const csp=response.headers()['content-security-policy']||'';
  const connect=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src '));
  const allowed=new Set(["'self'",'http://127.0.0.1:9099','http://127.0.0.1:9000','ws://127.0.0.1:9000','http://localhost:9099','http://localhost:9000','ws://localhost:9000']);
  if(!connect || !connect.split(/\s+/).slice(1).every(token=>allowed.has(token))) throw Error('Loopback-only data CSP is required');
  return {guard:'PASS',contexts:contexts.length};
}

const steps={setup:setupGuests,waiting:waitingChecks,gameplay:gameplayChecks,cleanup:cleanupChecks,timer:ttlTimerCheck,discussion:discussionFixtureCheck,guard:async()=>({guard:'PASS'})};
const step=steps[process.argv[2]];
if(!step) throw new Error('Select one step: setup waiting gameplay cleanup timer discussion guard');
console.log(`async page => { await (${assertIsolated.toString()})(page, ${JSON.stringify(process.argv[2])}); return (${step.toString()})(page); }`);
