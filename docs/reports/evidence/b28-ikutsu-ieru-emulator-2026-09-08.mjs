// B-28 real Firebase compat 10.14.1 + isolated demo Emulator reproduction.
// Frozen source SHA256: 208c4bfa56342c4682b881ccd61d967b70e62a34901b7b73bab6e7022ffee442.
// Not an @playwright/test spec. Emits a Playwright CLI run-code function.
// Prerequisites: dedicated b28 session, Hosting5500 app /ikutsu-ieru/; real SDK,
// demo-roomk-b28 Auth9099/RTDB9000 configured BEFORE auth/DB use, no-op stats,
// CSP connect-src loopback only, static production-config gate PASS. Synthetic data only.
// Before setup use CLI snapshot/fill/click to create host named host. No existing contexts.
// Run setup, waiting, input, review, finished, boundaries, security in that order:
// playwright_cli.sh -s=b28 run-code "$(node this-file.mjs STEP)"
// Input starts with90s actual duration; run review after input, finished after review.
// finished step measures actual30000ms timer, not fake timers or shortened constant.
// TTL uses past timestamps125000/119000ms, not a full2min wall-clock test.
// security uses stored REST fixture including >24char HTML payload to check rendering.
// Run-code observers capture steps only; gaps/initial host navigation not captured.
// Dynamic tokens may occur in scratch raw logs; public JSON uses origin/counts only.
// After saving window.b28report and checking rooms/stats null, close only b28 session
// and stop only owned Emulator PIDs. Do not call this against production or user browser.
// Playwright CLI run-code callable emitter; real SDK + loopback Emulator only.
async function run(page, step) {
  const contexts=page.context().browser().contexts();
  if(contexts.length!==(step==='setup'?1:3)||contexts[0]!==page.context()||contexts.some(c=>c.pages().length!==1))throw Error('Dedicated context layout required');
  for(let i=0;i<contexts.length;i++){
    const p=contexts[i].pages()[0];
    if(p.url()!=='http://127.0.0.1:5500/ikutsu-ieru/')throw Error('Loopback application only');
    const s=await p.evaluate(()=>({project:firebase.app().options.projectId,db:db.ref().toString(),auth:firebase.auth().emulatorConfig,role:window.b28role}));
    if(s.project!=='demo-roomk-b28'||s.db!=='http://127.0.0.1:9000/'||s.auth?.host!=='127.0.0.1'||s.auth?.port!==9099)throw Error('Emulator config required');
    if(step!=='setup'&&s.role!==['host','guestA','guestB'][i])throw Error('Context role mismatch');
  }
  const csp=(await page.request.get(page.url())).headers()['content-security-policy']||'';
  const connect=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src '));
  const allowed=new Set(["'self'",'http://127.0.0.1:9099','http://127.0.0.1:9000','ws://127.0.0.1:9000','http://localhost:9099','http://localhost:9000','ws://localhost:9000']);
  if(!connect||!connect.split(/\s+/).slice(1).every(s=>allowed.has(s)))throw Error('Local data CSP required');
  if(step==='guard')return {guard:'PASS'};
  const report=step==='setup'?{started:new Date().toISOString(),cases:[],network:[],errors:[],console:[]}:await page.evaluate(()=>window.b28report);
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
  const stable=p=>({isHost:p.isHost,joinedAt:p.joinedAt,answers:p.answers??[]});
  let pages=contexts.flatMap(c=>c.pages()),[h,a,b]=pages;
  const headers={Authorization:'Bearer owner'};
  const url=()=>`http://127.0.0.1:9000/ikutsu_rooms/${report.room}.json?ns=demo-roomk-b28`;
  const read=async()=>await(await page.request.get(url(),{headers})).json();
  const patch=async data=>page.request.patch(url(),{headers,data});
  const shot=async(p,name,width)=>{await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),name+' overflow');await p.screenshot({path:'output/playwright/'+name+'.png'});};
  const reload=async phase=>{const before=stable((await read()).players.guestA);await a.reload();await a.waitForFunction(phase=>state.currentScreen===phase&&guestPresence?.ready,phase);const after=stable((await read()).players.guestA);assert(JSON.stringify(before)===JSON.stringify(after),phase+' reload fields');report.cases.push({name:phase+' reload',pass:true,before,after});};
  const offline=async(phase,n)=>{
    const before=(await read()).players.guestA;
    await a.context().setOffline(true);
    for(let i=0;i<180;i++){if(!(await read()).players.guestA.connections)break;await page.waitForTimeout(250);}
    assert(!(await read()).players.guestA.connections,'server disconnect absent');
    assert(JSON.stringify(stable(before))===JSON.stringify(stable((await read()).players.guestA)),'offline lost answer');
    if(phase==='waiting')assert(await h.locator('#w-start').isDisabled(),'offline start enabled');
    await shot(a,phase+'-offline-guest375-'+n,375);await shot(h,phase+'-host1280-'+n,1280);
    await page.waitForTimeout(10000);await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
    const after=(await read()).players.guestA;
    assert(JSON.stringify(stable(before))===JSON.stringify(stable(after)),'online lost answer');
    assert(await a.evaluate(()=>state.currentScreen)===phase,'phase changed');
    assert(Object.keys(after.connections||{}).length===1&&!Object.keys(before.connections||{}).includes(Object.keys(after.connections)[0]),'connection rotation');
    report.cases.push({name:phase+' offline10s cycle'+n,pass:true,before:stable(before),after:stable(after)});
  };
  try {
    for(let i=0;i<pages.length;i++)await observe(pages[i],['host','guestA','guestB'][i]);
    if(step==='setup'){
      report.room=await page.evaluate(()=>state.roomCode);await page.evaluate(()=>window.b28role='host');
      for(const role of ['guestA','guestB']){
        const p=await(await page.context().browser().newContext()).newPage();await observe(p,role);await p.addInitScript(role=>window.b28role=role,role);
        await p.goto('http://127.0.0.1:5500/ikutsu-ieru/');await p.locator('body').ariaSnapshot();
        await p.getByRole('button',{name:'login ルームに参加する',exact:true}).click();await p.locator('body').ariaSnapshot();
        await p.locator('#guest-code').fill(report.room);await p.locator('#guest-nickname').fill(role);await p.getByRole('button',{name:'login 参加する',exact:true}).click();
        await p.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready);
      }
      report.cases.push({name:'initial host and two guest UI join',pass:true,room:await read()});
    }else if(step==='waiting'){
      await h.locator('#w-theme-input').fill('好きな音');await reload('waiting');await offline('waiting',1);await offline('waiting',2);
    }else if(step==='input'){
      await h.locator('#w-duration').selectOption('90');await h.locator('#w-start').click();await a.waitForFunction(()=>state.currentScreen==='input');
      for(const answer of ['ねこ','いぬ','ねこ']){await a.locator('#i-answer').fill(answer);await a.locator('#i-add').click();await a.waitForTimeout(150);}
      await a.evaluate(()=>removeAnswer(1));await a.locator('#i-answer').fill('あ'.repeat(24));await a.locator('#i-add').click();await a.waitForTimeout(200);
      const answers=(await read()).players.guestA.answers;assert(JSON.stringify(answers)===JSON.stringify(['ねこ','ねこ','あ'.repeat(24)]),'answer sequence');
      await a.evaluate(()=>{document.getElementById('i-answer').value='あ'.repeat(25);return addAnswer();});
      assert(JSON.stringify((await read()).players.guestA.answers)===JSON.stringify(answers),'25 char accepted');
      report.cases.push({name:'answers append duplicate delete 24 accepted 25 rejected',pass:true,answers});
      await b.locator('#i-answer').fill('ねこ');await b.locator('#i-add').click();await b.waitForTimeout(200);
      assert(!await a.locator('#screen-input').innerText().then(t=>t.includes('guestB')),'other name visible input');
      await reload('input');await offline('input',1);await offline('input',2);
      await h.evaluate(()=>moveToReview());await a.waitForFunction(()=>state.currentScreen==='review');
    }else if(step==='review'){
      await reload('review');await offline('review',1);await offline('review',2);
      const before=await read();await h.locator('#r-toggle-name').click();
      assert(JSON.stringify(before)===JSON.stringify(await read()),'local toggle wrote DB');
      assert(!await a.locator('#r-tiles').innerText().then(t=>t.includes('guestA')||t.includes('guestB')),'guest anonymity lost');
      assert(await a.locator('#r-tiles .ii-tile--dup').count()===3,'duplicate highlight');
      await patch({'players/guestA/answers':['changed-after-review']});await a.waitForTimeout(300);
      assert(JSON.stringify((await read()).history)===JSON.stringify(before.history),'history mutated');
      assert(!await a.locator('#r-tiles').innerText().then(t=>t.includes('changed-after-review')),'review uses mutable answers');
      b.once('dialog',d=>d.accept());await b.evaluate(()=>leaveGame());await b.waitForFunction(()=>state.currentScreen==='top');
      assert(JSON.stringify((await read()).history)===JSON.stringify(before.history),'exit changed history');
      report.cases.push({name:'fixed history anonymity local toggle duplicate and guest exit',pass:true,history:before.history});
      await shot(a,'review-guest375',375);await h.evaluate(()=>hostNextRound());await a.waitForFunction(()=>state.currentScreen==='waiting');
      await h.locator('#w-theme-input').fill('好きな色');await h.locator('#w-start').click();await a.waitForFunction(()=>state.currentScreen==='input');
      assert(!(await read()).players.guestA.answers,'next round answers not reset');assert(JSON.stringify((await read()).history)===JSON.stringify(before.history),'next round history lost');
      report.cases.push({name:'next round answer reset and history preserved',pass:true});await h.evaluate(()=>moveToReview());
    }else if(step==='finished'){
      const start=Date.now();await h.evaluate(()=>hostFinish());await a.waitForFunction(()=>state.currentScreen==='finished');
      await reload('finished');await offline('finished',1);await offline('finished',2);await shot(a,'finished-guest375',375);
      await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null,null,{timeout:45000});
      await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'finished room remained');
      const elapsedMs=Date.now()-start;assert(elapsedMs>=29000&&elapsedMs<40000,'finished deadline unexpected');
      await a.context().setOffline(true);await page.waitForTimeout(1000);await a.context().setOffline(false);await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');
      assert(await read()===null,'finished ghost');report.cases.push({name:'finished real 30sec auto deletion plus no ghost',pass:true,elapsedMs});
    }else if(step==='boundaries'){
      const create=async()=>{await h.locator('body').ariaSnapshot();await h.getByRole('button',{name:'add_circle ルームを作る',exact:true}).click();await h.locator('body').ariaSnapshot();await h.locator('#host-nickname').fill('host');await h.getByRole('button',{name:'add_home ルームを作成する',exact:true}).click();await h.waitForFunction(()=>state.currentScreen==='waiting');report.room=await h.evaluate(()=>state.roomCode);};
      const join=async()=>{await a.locator('body').ariaSnapshot();await a.getByRole('button',{name:'login ルームに参加する',exact:true}).click();await a.locator('body').ariaSnapshot();await a.locator('#guest-code').fill(report.room);await a.locator('#guest-nickname').fill('guestA');await a.getByRole('button',{name:'login 参加する',exact:true}).click();await a.waitForFunction(()=>guestPresence?.ready);};
      await create();await h.locator('#w-theme-input').fill('好きな色');await h.locator('#w-start').click();await h.waitForFunction(()=>state.currentScreen==='input');report.cases.push({name:'host alone starts',pass:true,room:await read()});await h.evaluate(()=>leaveGame());await h.waitForFunction(()=>state.currentScreen==='top');
      await create();await join();report.cases.push({name:'fresh UI join repeated',pass:true});
      await patch({'players/guestA':null});await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(!(await read()).players.guestA,'missing player recreated');report.cases.push({name:'missing player cleanup and reload',pass:true});
      const before=await read();for(const session of [{nickname:'host',role:'guest'},{nickname:'missing',role:'guest'},{nickname:'notHost',role:'host'},{nickname:'host',role:'unexpected'}]){
        await a.evaluate(s=>sessionStorage.setItem('ikutsu_session',JSON.stringify(s)),{...session,roomCode:report.room});await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(await a.evaluate(()=>!sessionStorage.getItem('ikutsu_session')&&state.roomRef===null),'invalid session persisted');assert(JSON.stringify(await read())===JSON.stringify(before),'invalid session wrote');report.cases.push({name:'invalid session',pass:true,session});
      }await h.evaluate(()=>leaveGame());await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'host leave room');report.cases.push({name:'host explicit exit',pass:true});
      for(const age of [125000,119000]){await create();await join();const start=Date.now();await patch({hostConnected:false,hostDisconnectedAt:Date.now()-age});await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'TTL retained');report.cases.push({name:'TTL timestamp fixture',pass:true,pastMs:age,elapsedMs:Date.now()-start});}
    }else if(step==='security'){
      report.room='B28XSS';assert(await read()===null,'fixture exists');
      const malicious='\"><img src=x onerror="window.b28xss=1">',answers=["ま'ち",malicious];
      await page.request.put(url(),{headers,data:{host:'host',hostConnected:true,status:'input',round:1,theme:'合成検証',endAt:Date.now()+90000,durationSec:90,players:{host:{isHost:true,joinedAt:1},guestA:{isHost:false,joinedAt:2,presenceVersion:1,answers}}}});
      await a.evaluate(roomCode=>sessionStorage.setItem('ikutsu_session',JSON.stringify({roomCode,nickname:'guestA',role:'guest'})),report.room);await a.reload();await a.waitForFunction(()=>state.currentScreen==='input'&&guestPresence?.ready);
      assert(await a.locator('#i-answer-list img').count()===0,'input HTML injection');assert((await a.locator('#i-answer-list').innerText()).includes(malicious),'input text lost');
      await a.context().setOffline(true);await a.waitForFunction(()=>!guestPresence?.ready);
      assert(await a.locator('#i-add').isDisabled(),'offline add enabled');const deletes=a.locator('.ii-answer-item__del');assert(await deletes.count()===2,'delete buttons missing');for(const d of await deletes.all())assert(await d.isDisabled(),'offline delete enabled');
      await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});assert(!await a.locator('#i-add').isDisabled(),'online add disabled');for(const d of await deletes.all())assert(!await d.isDisabled(),'online delete disabled');report.cases.push({name:'real DOM offline add/delete disabled and restored',pass:true,deleteButtons:2});
      await patch({status:'review',history:{1:{theme:'合成検証',answers:{guestA:answers}}}});await a.waitForFunction(()=>state.currentScreen==='review');
      assert(await a.locator('#r-tiles img').count()===0,'review HTML injection');assert((await a.locator('#r-tiles').innerText()).includes(malicious),'review text lost');
      await patch({status:'finished'});await a.waitForFunction(()=>state.currentScreen==='finished');assert(await a.locator('#f-rounds img').count()===0,'finished HTML injection');assert((await a.locator('#f-rounds').innerText()).includes(malicious),'finished text lost');assert(await a.evaluate(()=>!window.b28xss),'script executed');
      report.cases.push({name:'synthetic stored quote/HTML text input review finished escaped',pass:true,note:'REST fixture intentionally exceeds UI24 limit to test render defense'});
      await page.request.delete(url(),{headers});await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null);await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'external deletion ghost');report.cases.push({name:'external room deletion/reload',pass:true});
    }else throw Error('Unknown step');
  }catch(error){report.failure=String(error);throw error;}finally{for(const off of listeners)off();await page.evaluate(r=>window.b28report=r,report);}
  return {step,cases:report.cases.length,failure:report.failure};
}
const step=process.argv[2];
if(!['setup','waiting','input','review','finished','boundaries','security','guard'].includes(step))throw Error('Unknown step');
console.log(`async page => (${run.toString()})(page,${JSON.stringify(step)})`);
