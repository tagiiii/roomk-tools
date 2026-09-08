// B-27 real SDK / loopback Emulator evidence reproduction, 2026-09-08.
// Requires source SHA256 414066be519483f32cf74b81fc30724d2936278f84dcfe77f22a093b868fc061.
// Not a Playwright Test spec: emits one function for playwright-cli run-code.
// Preconditions: isolated demo-roomk-b27 Auth9099/RTDB9000/Hosting5500,
// scratch production config removed, no-op stats, static gate passed and CSP enforced.
// Start a NEW dedicated b27 CLI session, create a room as host through UI.
// In scratch cwd with output/playwright present, run each emitted step via CLI:
// playwright-cli -s=b27 run-code "$(node /absolute/path/to/this.mjs setup)"
// Order: setup waiting revealing playing result resultAudit boundaries ttl actionFixture.
// Existing contexts are never automatically closed. Unexpected layout/roles fail fast.
// Offline is browser context.setOffline, not SDK goOffline. TTL uses past timestamp fixtures.
// request/ws/pageerror/console listeners cover each step, not intervals between steps.
// Synthetic host/guestA/guestB only. No production access, iPhone or publishing.
// Playwright CLI run-code callable emitter; real SDK + loopback Emulator only.
async function run(page, step) {
  const contexts=page.context().browser().contexts();
  if(contexts.length!==(step==='setup'?1:3)||contexts[0]!==page.context()||contexts.some(c=>c.pages().length!==1))throw Error('Dedicated context layout required');
  for(let i=0;i<contexts.length;i++){
    const p=contexts[i].pages()[0];
    if(p.url()!=='http://127.0.0.1:5500/tatoe-narabe/')throw Error('Loopback application only');
    const s=await p.evaluate(()=>({project:firebase.app().options.projectId,db:db.ref().toString(),auth:firebase.auth().emulatorConfig,role:window.b27role}));
    if(s.project!=='demo-roomk-b27'||s.db!=='http://127.0.0.1:9000/'||s.auth?.host!=='127.0.0.1'||s.auth?.port!==9099)throw Error('Emulator config required');
    if(step!=='setup'&&s.role!==['host','guestA','guestB'][i])throw Error('Context role mismatch');
  }
  const csp=(await page.request.get(page.url())).headers()['content-security-policy']||'';
  const connect=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src '));
  const allowed=new Set(["'self'",'http://127.0.0.1:9099','http://127.0.0.1:9000','ws://127.0.0.1:9000','http://localhost:9099','http://localhost:9000','ws://localhost:9000']);
  if(!connect||!connect.split(/\s+/).slice(1).every(s=>allowed.has(s)))throw Error('Local data CSP required');
  if(step==='guard')return {guard:'PASS'};
  const report=step==='setup'?{started:new Date().toISOString(),cases:[],network:[],errors:[],console:[]}:await page.evaluate(()=>window.b27report);
  const listeners=[];
  const observe=async(p,role)=>{
    const request=r=>report.network.push({step,role,url:r.url()});
    const websocket=w=>report.network.push({step,role,url:w.url()});
    const error=e=>report.errors.push({step,role,error:String(e)});
    const console=m=>{if(['error','warning'].includes(m.type()))report.console.push({step,role,type:m.type(),text:m.text()});};
    p.on('request',request);p.on('websocket',websocket);p.on('pageerror',error);p.on('console',console);
    listeners.push(()=>{p.off('request',request);p.off('websocket',websocket);p.off('pageerror',error);p.off('console',console);});
  };
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const stable=p=>({isHost:p.isHost,number:p.number,ready:p.ready,declaredAt:p.declaredAt??null});
  let pages=contexts.flatMap(c=>c.pages()),[h,a,b]=pages;
  const headers={Authorization:'Bearer owner'};
  const url=()=>`http://127.0.0.1:9000/tatoenarabe_rooms/${report.room}.json?ns=demo-roomk-b27`;
  const read=async()=>await(await page.request.get(url(),{headers})).json();
  const patch=async data=>page.request.patch(url(),{headers,data});
  const shot=async(p,name,width)=>{await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),name+' overflow');await p.screenshot({path:'output/playwright/'+name+'.png'});};
  const reload=async phase=>{const before=stable((await read()).players.guestA);await a.reload();await a.waitForFunction(phase=>state.currentScreen===phase&&guestPresence?.ready,phase);const after=stable((await read()).players.guestA);assert(JSON.stringify(before)===JSON.stringify(after),phase+' reload fields');report.cases.push({name:phase+' reload',pass:true,before,after});};
  const offline=async(phase,round)=>{
    const before=(await read()).players.guestA, marker=await a.evaluate(()=>window.b27marker??=Date.now());
    await a.context().setOffline(true);
    await h.waitForFunction(async()=>!(await state.roomRef.get()).val().players.guestA.connections,null,{timeout:45000});
    const off=(await read()).players.guestA;
    assert(JSON.stringify(stable(before))===JSON.stringify(stable(off)),phase+' offline fields');
    if(phase==='waiting')assert(await h.locator('#btn-start-game').isDisabled(),'waiting start not blocked');
    if(phase==='result')assert(await h.locator('#btn-play-again').isDisabled(),'replay not blocked');
    await a.waitForFunction(()=>document.getElementById('guest-off-overlay').classList.contains('active'));
    await a.evaluate(async()=>{await confirmNumber();await declare();});
    assert(JSON.stringify(stable((await read()).players.guestA))===JSON.stringify(stable(before)),'offline direct action changed fields');
    await shot(a,phase+'-offline-guest375-'+round,375);await shot(h,phase+'-host1280-'+round,1280);
    await page.waitForTimeout(10000);await a.context().setOffline(false);
    await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
    const after=(await read()).players.guestA;
    assert(JSON.stringify(stable(before))===JSON.stringify(stable(after)),phase+' reconnect fields');
    assert(await a.evaluate(()=>state.currentScreen)===phase,'phase changed');assert(await a.evaluate(()=>window.b27marker)===marker,'page reloaded');
    assert(Object.keys(after.connections||{}).length===1&&!Object.keys(before.connections||{}).includes(Object.keys(after.connections)[0]),'connection rotation failed');
    report.cases.push({name:phase+' browser offline10s/online round'+round,pass:true,before:stable(before),after:stable(after),oldConnections:before.connections,newConnections:after.connections});
  };
  try {
    for(let i=0;i<pages.length;i++)await observe(pages[i],['host','guestA','guestB'][i]);
    if(step==='setup'){
      report.room=await page.evaluate(()=>state.roomCode);await page.evaluate(()=>window.b27role='host');
      for(const role of ['guestA','guestB']){
        const p=await(await page.context().browser().newContext()).newPage();await observe(p,role);await p.addInitScript(role=>window.b27role=role,role);
        await p.goto('http://127.0.0.1:5500/tatoe-narabe/');await p.locator('body').ariaSnapshot();await p.getByRole('button',{name:'ルームに参加する',exact:true}).click();await p.locator('body').ariaSnapshot();
        await p.locator('#guest-code').fill(report.room);await p.locator('#guest-nick').fill(role);await p.getByRole('button',{name:'参加する',exact:true}).click();await p.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready);
      }
      report.cases.push({name:'host and two guests UI join',pass:true,room:await read()});
    } else if(step==='waiting'){
      await reload('waiting');await offline('waiting',1);await offline('waiting',2);
    } else if(step==='revealing'){
      await h.locator('#btn-start-game').click();await a.waitForFunction(()=>state.currentScreen==='revealing');await a.locator('body').ariaSnapshot();
      await reload('revealing');await a.locator('#flip-card').click();await a.locator('#btn-confirm-number').click();await a.waitForFunction(async()=>(await state.roomRef.get()).val().players.guestA.ready);
      await reload('revealing');await offline('revealing',1);await offline('revealing',2);
      await h.locator('#revealing-theme-options button').first().click();assert(!await h.locator('#btn-start-playing').isVisible(),'allReady bypassed');
      await h.locator('#btn-force-start-playing').click();await a.waitForFunction(()=>state.currentScreen==='playing');
      assert(!(await read()).players.guestB.ready,'force altered unready guest');report.cases.push({name:'forceStartPlaying preserves unready guest',pass:true});
    } else if(step==='playing'){
      await a.locator('body').ariaSnapshot();await a.locator('#btn-declare').click();await a.locator('#declare-confirm button').last().click();await a.waitForFunction(async()=>(await state.roomRef.get()).val().players.guestA.declaredAt!=null);
      await reload('playing');await offline('playing',1);await offline('playing',2);
      await patch({discussionEndsAt:Date.now()-1000});await h.waitForFunction(()=>document.getElementById('timer-expired-msg').style.display!=='none');
      await h.locator('#btn-declare').click();await h.locator('#declare-confirm button').last().click();
      await h.waitForFunction(async()=>(await state.roomRef.get()).val().players.host.declaredAt!=null);
      const room=await read(), order=Object.entries(room.players).filter(([,p])=>p.declaredAt!=null).sort((a,b)=>a[1].declaredAt-b[1].declaredAt).map(([n])=>n);
      assert(JSON.stringify(order)===JSON.stringify(['guestA','host']),'declaration order changed');assert(room.players.guestB.declaredAt==null,'undeclared guest changed');
      report.cases.push({name:'declare after timer expiry retains existing behavior',pass:true,order,players:room.players});
      await h.locator('#btn-finish-game').click();await a.waitForFunction(()=>state.currentScreen==='result');report.cases.push({name:'finish with undeclared guest',pass:true,room:await read()});
    } else if(step==='result'){
      await reload('result');await offline('result',1);await offline('result',2);await shot(a,'result-guest375',375);
      const before=await read();const rows=await a.locator('#result-rows').innerText();
      await h.locator('#btn-play-again').click();await a.waitForFunction(()=>state.currentScreen==='revealing');const after=await read();
      assert(before.roundId!==after.roundId,'round id unchanged');assert(Object.keys(after.players).length===3,'replay lost player');
      for(const nick of Object.keys(after.players)){assert(after.players[nick].ready===false&&after.players[nick].declaredAt==null,'replay did not reset');assert(after.players[nick].number>=1&&after.players[nick].number<=100,'invalid redeal');assert(JSON.stringify(before.players[nick].connections||{})===JSON.stringify(after.players[nick].connections||{}),'replay lost presence');}
      assert(new Set(Object.values(after.players).map(p=>p.number)).size===3,'duplicate numbers');report.cases.push({name:'result direct replay resets round and preserves presence',pass:true,before,after,rows});
    } else if(step==='resultAudit'){
      const room=report.cases.find(c=>c.name==='result direct replay resets round and preserves presence').before;
      const declared=Object.entries(room.players).filter(([,p])=>p.declaredAt!=null).sort((a,b)=>a[1].declaredAt-b[1].declaredAt).map(([n])=>n);
      const correct=[...declared].sort((a,b)=>room.players[a].number-room.players[b].number), expected=declared.filter((n,i)=>n===correct[i]).length+'/'+declared.length;
      const score=await a.locator('#result-score').textContent(), numbers=await a.locator('#result-rows .ito-result-row__number strong').allTextContents();
      assert(score===expected,'result score changed');assert(JSON.stringify(numbers)===JSON.stringify(declared.map(n=>String(room.players[n].number))),'result display number/order changed');
      report.cases.push({name:'result score and declaration-order number display',pass:true,declared,correct,score,numbers,note:'Read retained result DOM immediately after replay; same DOM used in screenshot before replay'});
    } else if(step==='boundaries'){
      if(await h.evaluate(()=>state.currentScreen)==='revealing'){
        for(const p of [h,a,b]){await p.locator('body').ariaSnapshot();await p.locator('#flip-card').click();await p.locator('#btn-confirm-number').click();}
        await h.locator('#revealing-theme-options button').first().click();await h.locator('#btn-start-playing').click();await a.waitForFunction(()=>state.currentScreen==='playing');report.cases.push({name:'normal allReady startPlaying after direct replay',pass:true});
      }
      b.once('dialog',d=>d.accept());await b.locator('#btn-leave-playing').click();await b.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null);await h.waitForFunction(async()=>!(await state.roomRef.get()).val().players.guestB);
      await b.context().setOffline(true);await page.waitForTimeout(1000);await b.context().setOffline(false);await b.reload();await b.waitForFunction(()=>state.currentScreen==='top');assert(!(await read()).players.guestB,'explicit exit resurrected');report.cases.push({name:'guest explicit exit/reconnect/reload',pass:true});
      await patch({'players/guestA':null});await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);await a.evaluate(async()=>{await confirmNumber();await declare();});await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(!(await read()).players.guestA,'missing player recreated');report.cases.push({name:'missing player cleanup/direct action/reload no recreation',pass:true});
      const before=await read();
      for(const session of [{nickname:'host',role:'guest'},{nickname:'absent',role:'guest'},{nickname:'notHost',role:'host'},{nickname:'host',role:'unexpected'}]){
        await a.evaluate(session=>sessionStorage.setItem('tatoenarabe_session',JSON.stringify(session)),{...session,roomCode:report.room});await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(await a.evaluate(()=>!sessionStorage.getItem('tatoenarabe_session')&&state.roomRef===null&&guestPresence===null),'invalid session persisted');assert(JSON.stringify(await read())===JSON.stringify(before),'invalid session wrote data');report.cases.push({name:'saved session guard',pass:true,session});
      }
      await h.evaluate(()=>leaveGame());await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'host leave kept room');report.cases.push({name:'host exit removes room',pass:true});
    } else if(step==='ttl'){
      for(const age of [125000,119000]){
        await h.getByRole('button',{name:'ルームを作る（ホスト）'}).click();await h.locator('body').ariaSnapshot();await h.locator('#host-nick').fill('host');await h.getByRole('button',{name:'ルームを作成する',exact:true}).click();await h.waitForFunction(()=>state.currentScreen==='waiting');report.room=await h.evaluate(()=>state.roomCode);
        await b.getByRole('button',{name:'ルームに参加する',exact:true}).click();await b.locator('body').ariaSnapshot();await b.locator('#guest-code').fill(report.room);await b.locator('#guest-nick').fill('guestB');await b.getByRole('button',{name:'参加する',exact:true}).click();await b.waitForFunction(()=>guestPresence?.ready);
        report.cases.push({name:'final source new room and initial guest UI join',pass:true,room:await read()});
        await patch({'players/legacy':{isHost:false,number:0,ready:false}});await h.waitForFunction(()=>!document.getElementById('btn-start-game').disabled);await patch({'players/legacy':null});
        const start=Date.now();await patch({hostConnected:false,hostDisconnectedAt:Date.now()-age});if(age===119000)await b.waitForFunction(()=>!!state.orphanTimer);
        await b.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'TTL room retained');const elapsedMs=Date.now()-start;
        await b.context().setOffline(true);await page.waitForTimeout(1000);await b.context().setOffline(false);await b.reload();await b.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'TTL room regenerated');report.cases.push({name:'TTL timestamp fixture and legacy compatibility',pass:true,pastMs:age,elapsedMs,room:report.room});
      }
    } else if(step==='actionFixture'){
      report.room='B27ACT';assert(await read()===null,'fixture room already exists');
      await page.request.put(url(),{headers,data:{host:'host',hostConnected:true,status:'revealing',roundId:'b27-action-1',theme:'甘いお菓子',themeOptions:['甘いお菓子'],players:{host:{isHost:true,number:20,ready:true},guestA:{isHost:false,number:77,ready:false,presenceVersion:1}}}});
      await a.evaluate(roomCode=>sessionStorage.setItem('tatoenarabe_session',JSON.stringify({roomCode,nickname:'guestA',role:'guest'})),report.room);await a.reload();await a.waitForFunction(()=>guestPresence?.ready&&state.currentScreen==='revealing');
      for(const phase of ['revealing','playing']){
        await patch({status:phase});await a.waitForFunction(phase=>state.currentScreen===phase,phase);const before=stable((await read()).players.guestA);
        await a.context().setOffline(true);let room;for(let i=0;i<180;i++){room=await read();if(!room.players.guestA.connections)break;await page.waitForTimeout(250);}assert(!room.players.guestA.connections,'fixture did not disconnect');
        await a.evaluate(async()=>{await confirmNumber();await declare();});await page.waitForTimeout(1000);assert(JSON.stringify(stable((await read()).players.guestA))===JSON.stringify(before),'offline unready/undeclared action wrote');
        await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});assert(JSON.stringify(stable((await read()).players.guestA))===JSON.stringify(before),'offline action queued after return');report.cases.push({name:'synthetic '+phase+' unready/undeclared offline action guard',pass:true,before});
      }
      await page.request.delete(url(),{headers});await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);await a.context().setOffline(true);await page.waitForTimeout(1000);await a.context().setOffline(false);await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'deleted room recreated');report.cases.push({name:'external whole-room deletion plus reconnect/reload',pass:true});
    } else throw Error('Unknown step');
    delete report.failure;
  }catch(error){report.failure=String(error);throw error;}finally{for(const off of listeners)off();await page.evaluate(r=>window.b27report=r,report);}
  return {step,cases:report.cases.length,failure:report.failure};
}
const step=process.argv[2];
if(!['setup','waiting','revealing','playing','result','resultAudit','boundaries','ttl','actionFixture','guard'].includes(step))throw Error('Select setup waiting revealing playing result resultAudit boundaries ttl actionFixture guard');
console.log(`async page => (${run.toString()})(page,${JSON.stringify(step)})`);
