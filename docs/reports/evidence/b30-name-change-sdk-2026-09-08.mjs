// B30 real SDK isolated Emulator reproduction. Source SHA256:
// 5bddcfd7c1f527298dedb768a3076c6b20f3349ad410cf78eb2739eb52524cb9
// CLI-first emitter, not Playwright test spec; no artificial transaction retry/delay.
// Requires dedicated b30 session + static-gated exact app copy /name-change/ on Hosting5500,
// real Firebase compat10.14.1 configured before auth/data to demo-roomk-b30 Auth9099/RTDB9000,
// no-op stats; Hosting CSP data connect-src loopback only. Synthetic data only.
// First use CLI snapshot/fill/click to create GM host, then setup to create3 guest contexts.
// Final sequence: fresh, waiting, naming, voting, revealing, done, doneReload, doneNewRoom, ttl, boundaries.
// Run one command at a time and wait exit0 plus step done/caseCount before the next:
// playwright_cli.sh -s=b30 run-code "$(node this-file.mjs STEP)"
// fresh deletes only report.room in the fixed local demo namespace, reloads all4 owned pages,
// creates a new UI room and resets report. Never use against user contexts or production.
// Real30sec done cleanup measured separately from timestamp TTL fixtures; doneReload/newRoom
// use synthetic revealing transitions then real hostFinish UI and unmodified deleteAt timers.
// Clipboard writeText is replaced ONLY in dedicated host page to capture text; no OS write.
// Runtime listeners cover each step only (gaps/preliminary operations excluded).
// Full raw URL logs can contain emulator tokens; sanitize to origin counts before publication.
// Save window.b30report, verify namechange_rooms/stats null, close only b30, stop owned Emulator.
// Playwright CLI run-code callable emitter; real SDK + loopback Emulator only.
async function run(page, step) {
  const contexts=page.context().browser().contexts();
  if(contexts.length!==(step==='setup'?1:4)||contexts[0]!==page.context()||contexts.some(c=>c.pages().length!==1))throw Error('Dedicated context layout required');
  for(let i=0;i<contexts.length;i++){
    const p=contexts[i].pages()[0];
    if(p.url()!=='http://127.0.0.1:5500/name-change/')throw Error('Loopback application only');
    const s=await p.evaluate(()=>({project:firebase.app().options.projectId,db:db.ref().toString(),auth:firebase.auth().emulatorConfig,role:window.b30role}));
    if(s.project!=='demo-roomk-b30'||s.db!=='http://127.0.0.1:9000/'||s.auth?.host!=='127.0.0.1'||s.auth?.port!==9099)throw Error('Emulator config required');
    if(step!=='setup'&&s.role!==['host','guestA','guestB','guestC'][i])throw Error('Context role mismatch');
  }
  const csp=(await page.request.get(page.url())).headers()['content-security-policy']||'';
  const connect=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src '));
  const allowed=new Set(["'self'",'http://127.0.0.1:9099','http://127.0.0.1:9000','ws://127.0.0.1:9000','http://localhost:9099','http://localhost:9000','ws://localhost:9000']);
  if(!connect||!connect.split(/\s+/).slice(1).every(s=>allowed.has(s)))throw Error('Local data CSP required');
  if(step==='guard')return {guard:'PASS'};
  if(!await page.evaluate(step=>{if(window.b30running)return false;window.b30running=step;return true;},step))throw Error('Another test step is running; do not overlap CLI calls');
  const report=step==='setup'?{started:new Date().toISOString(),cases:[],network:[],errors:[],console:[]}:await page.evaluate(()=>window.b30report);
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
  const stable=p=>({isHost:p.isHost,gameRole:p.gameRole??null,changedName:p.changedName??null,ready:p.ready??false,votes:p.votes??null});
  let pages=contexts.flatMap(c=>c.pages()),[h,a,b,c]=pages;
  const headers={Authorization:'Bearer owner'};
  const url=()=>`http://127.0.0.1:9000/namechange_rooms/${report.room}.json?ns=demo-roomk-b30`;
  const read=async()=>await(await page.request.get(url(),{headers})).json();
  const patch=async data=>page.request.patch(url(),{headers,data});
  const shot=async(p,name,width)=>{await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),name+' overflow');await p.screenshot({path:'output/playwright/'+name+'.png'});};
  const reload=async phase=>{const before=stable((await read()).players.guestA);await a.reload();await a.waitForFunction(phase=>state.currentScreen===phase&&guestPresence?.ready,phase);const after=stable((await read()).players.guestA);assert(JSON.stringify(before)===JSON.stringify(after),phase+' reload fields');report.cases.push({name:phase+' reload',pass:true,before,after});};

  const preserved=room=>({status:room.status,deleteAt:room.deleteAt??null,revealOrder:room.revealOrder??null,players:Object.fromEntries(Object.entries(room.players).map(([n,p])=>[n,stable(p)]))});
  const offline=async(phase,n,p=a,nick='guestA')=>{
    const before=preserved(await read()),prior=(await read()).players[nick].connections;
    await p.context().setOffline(true);for(let i=0;i<180;i++){if(!(await read()).players[nick].connections)break;await page.waitForTimeout(250);}
    assert(!(await read()).players[nick].connections,'server disconnect absent');assert(JSON.stringify(before)===JSON.stringify(preserved(await read())),'offline lost data');
    if(phase==='waiting')assert(await h.locator('#waiting-start-btn').isDisabled(),'waiting start enabled');
    await shot(p,phase+'-offline-guest375-'+n,375);await shot(h,phase+'-host1280-'+n,1280);
    await page.waitForTimeout(10000);await p.context().setOffline(false);await p.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
    assert(JSON.stringify(before)===JSON.stringify(preserved(await read())),'online lost data');const conn=(await read()).players[nick].connections;
    assert(Object.keys(conn||{}).length===1&&!Object.keys(prior||{}).includes(Object.keys(conn)[0]),'connection rotation');
    report.cases.push({name:phase+' browser10sec offline cycle'+n,pass:true,before,after:preserved(await read())});
  };
  try {
    for(let i=0;i<pages.length;i++)await observe(pages[i],['host','guestA','guestB','guestC'][i]);
    if(step==='setup'){
      report.room=await h.evaluate(()=>state.roomCode);await h.evaluate(()=>window.b30role='host');
      for(const role of ['guestA','guestB','guestC']){
        const p=await(await h.context().browser().newContext()).newPage();await observe(p,role);await p.addInitScript(role=>window.b30role=role,role);
        await p.goto('http://127.0.0.1:5500/name-change/');await p.locator('body').ariaSnapshot();await p.getByRole('button',{name:'ルームに参加する',exact:true}).click();await p.locator('body').ariaSnapshot();await p.locator('#guest-code').fill(report.room);await p.locator('#guest-nickname').fill(role);await p.locator('[onclick="guestJoin()"]').click();await p.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready);
      }report.cases.push({name:'GM plus3 participant UI join',pass:true,room:await read()});
    }else if(step==='fresh'){
      await page.request.delete(url(),{headers});for(const p of pages){if(await p.evaluate(()=>!state.roomRef))await p.evaluate(()=>goToTop());await p.waitForFunction(()=>state.currentScreen==='top');await p.reload();await p.waitForFunction(()=>state.currentScreen==='top');}
      await h.evaluate(()=>window.b30role='host');report.cases=[];report.steps=[];report.network=[];report.errors=[];report.console=[];delete report.failure;report.started=new Date().toISOString();
      await h.locator('body').ariaSnapshot();await h.getByRole('button',{name:'ルームを作る（GM）',exact:true}).click();await h.locator('body').ariaSnapshot();await h.locator('#host-nickname').fill('host');await h.getByRole('button',{name:'ルームを作成する',exact:true}).click();await h.waitForFunction(()=>state.currentScreen==='waiting');report.room=await h.evaluate(()=>state.roomCode);
      for(const [nick,p] of Object.entries({guestA:a,guestB:b,guestC:c})){await p.locator('body').ariaSnapshot();await p.getByRole('button',{name:'ルームに参加する',exact:true}).click();await p.locator('body').ariaSnapshot();await p.locator('#guest-code').fill(report.room);await p.locator('#guest-nickname').fill(nick);await p.locator('[onclick="guestJoin()"]').click();await p.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready);}
      report.cases.push({name:'final source fresh GM plus3 participant UI join',pass:true,room:await read()});
    }else if(step==='waiting'){
      await reload('waiting');await offline('waiting',1);await offline('waiting',2);
    }else if(step==='naming'){
      await h.locator('#waiting-start-btn').click();await a.waitForFunction(()=>state.currentScreen==='naming');await reload('naming');
      await a.locator('body').ariaSnapshot();await a.locator('#changed-name-input').fill("ま'ち");await a.locator('[onclick="submitChangedName()"]').click();
      await b.locator('body').ariaSnapshot();await b.locator('#changed-name-input').fill('<b>ねこ</b>');await b.locator('[onclick="submitChangedName()"]').click();
      await a.waitForFunction(()=>state.gameRole==='changer');await reload('naming');await offline('naming',1);await offline('naming',2);
      assert((await read()).players.guestC.ready===false,'unready guest changed');
      await c.locator('body').ariaSnapshot();await c.locator('[onclick="submitAsVoter()"]').click();await c.waitForFunction(()=>state.gameRole==='voter');await h.locator('[onclick="hostStartVoting()"]').filter({visible:true}).click();await c.waitForFunction(()=>state.currentScreen==='voting');
      report.cases.push({name:'UI2 changers and1 voter roles preserved',pass:true,room:await read()});
    }else if(step==='voting'){
      await c.locator('body').ariaSnapshot();const choice=(nick,guess)=>c.locator('.vote-card[data-changer="'+nick+'"] .vote-opt[data-original="'+guess+'"]');
      await choice('guestA','guestA').click();assert(await choice('guestB','guestA').isDisabled(),'duplicate allowed');const draft=await c.evaluate(()=>state.myVotes);
      await patch({'players/host/ready':true});await c.waitForTimeout(200);assert(JSON.stringify(await c.evaluate(()=>state.myVotes))===JSON.stringify(draft),'sameconnection draft lost');
      await offline('voting',1,c,'guestC');assert(Object.keys(await c.evaluate(()=>state.myVotes)).length===0,'disconnect draft retained');
      await choice('guestA','guestA').click();await choice('guestB','guestB').click();await c.locator('#voting-submit-btn').click();await c.waitForFunction(()=>!!state.lastRoom?.players?.guestC?.votes);
      const before=preserved(await read());await c.reload();await c.waitForFunction(()=>state.currentScreen==='voting'&&guestPresence?.ready);assert(JSON.stringify(before)===JSON.stringify(preserved(await read())),'savedvotes reload');
      await offline('voting',2,c,'guestC');report.cases.push({name:'UI one-to-one vote draft sameconnection retained disconnect discarded savedvotes restored',pass:true,votes:(await read()).players.guestC.votes});
      await h.locator('[onclick="hostStartRevealing()"]').click();await a.waitForFunction(()=>state.currentScreen==='revealing');
    }else if(step==='revealing'){
      await reload('revealing');await offline('revealing',1);await offline('revealing',2);
      await h.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.b30copied=text;}}});});
      await h.locator('#result-copy-btn').click();const copy=await h.evaluate(()=>window.b30copied);assert(copy.includes("ま'ち")&&copy.includes('<b>ねこ</b>')&&copy.includes('guestA')&&copy.includes('guestB'),'copy mismatch');assert(await h.locator('#result-list b').count()===0,'HTML node injection');report.cases.push({name:'UI results escaped and copy string capture only',pass:true,copy,note:'OS clipboard not touched or verified'});
    }else if(step==='done'){
      const start=Date.now();await h.locator('[onclick="hostFinish()"]').click();await a.waitForFunction(()=>state.currentScreen==='done');const deleteAt=(await read()).deleteAt;
      await reload('done');await offline('done',1);await offline('done',2);assert((await read()).deleteAt===deleteAt,'deleteAt changed');
      await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null,null,{timeout:45000});await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'done remained');report.cases.push({name:'done actual30sec deletion',pass:true,elapsedMs:Date.now()-start,deleteAt});
    }else if(['doneReload','doneNewRoom'].includes(step)){
      await h.locator('body').ariaSnapshot();await h.getByRole('button',{name:'ルームを作る（GM）',exact:true}).click();await h.locator('body').ariaSnapshot();await h.locator('#host-nickname').fill('host');await h.getByRole('button',{name:'ルームを作成する',exact:true}).click();await h.waitForFunction(()=>state.currentScreen==='waiting');report.room=await h.evaluate(()=>state.roomCode);
      await a.locator('body').ariaSnapshot();await a.getByRole('button',{name:'ルームに参加する',exact:true}).click();await a.locator('body').ariaSnapshot();await a.locator('#guest-code').fill(report.room);await a.locator('#guest-nickname').fill('guestA');await a.locator('[onclick="guestJoin()"]').click();await a.waitForFunction(()=>guestPresence?.ready);
      await patch({status:'revealing'});await h.waitForFunction(()=>state.currentScreen==='revealing');await h.locator('[onclick="hostFinish()"]').click();await a.waitForFunction(()=>state.currentScreen==='done');const oldURL=url(),deleteAt=(await read()).deleteAt,started=Date.now();await page.waitForTimeout(5000);
      if(step==='doneReload'){
        await h.reload();await h.waitForFunction(()=>state.currentScreen==='done');await h.evaluate(()=>window.b30role='host');assert((await read()).deleteAt===deleteAt,'reload extended deadline');
        await a.waitForFunction(()=>state.currentScreen==='top',null,{timeout:40000});assert(await read()===null,'reload cleanup missing');await h.waitForFunction(()=>state.currentScreen==='top');
      }else{
        await h.locator('#screen-done [onclick="goToTop()"]').click();await h.waitForFunction(()=>state.currentScreen==='top');await h.getByRole('button',{name:'ルームを作る（GM）',exact:true}).click();await h.locator('body').ariaSnapshot();await h.locator('#host-nickname').fill('host');await h.getByRole('button',{name:'ルームを作成する',exact:true}).click();await h.waitForFunction(()=>state.currentScreen==='waiting');const newRoom=await h.evaluate(()=>state.roomCode);assert(newRoom!==report.room,'room reused');
        await a.waitForFunction(()=>state.currentScreen==='top',null,{timeout:40000});assert(await read()===null,'old room retained');const newURL='http://127.0.0.1:9000/namechange_rooms/'+newRoom+'.json?ns=demo-roomk-b30';const fresh=await(await page.request.get(newURL,{headers})).json();assert(fresh.status==='waiting'&&fresh.host==='host','new room deleted or changed');await page.request.delete(newURL,{headers});await h.waitForFunction(()=>state.currentScreen==='top');
      }
      const elapsedMs=Date.now()-started;assert(elapsedMs>=29000&&elapsedMs<35000,'done remaining time extended');report.cases.push({name:step+' original30sec deadline',pass:true,deleteAt,elapsedMs,note:'Separate synthetic revealing fixture; hostFinish UI actual30sec timer'});
    }else if(step==='ttl'){
      report.room='B3ATTL';assert(await read()===null,'fixture exists');
      const put=async(phase,age)=>page.request.put(url(),{headers,data:{host:'host',hostConnected:false,hostDisconnectedAt:Date.now()-age,status:phase,players:{host:{isHost:true,gameRole:'host',ready:true},guestA:{isHost:false,gameRole:'voter',ready:true,presenceVersion:1}}}});
      const reconnect=async()=>{await a.evaluate(roomCode=>sessionStorage.setItem('nc_session',JSON.stringify({roomCode,nickname:'guestA',isHost:false,gameRole:'changer'})),report.room);await a.reload();};
      for(const phase of ['naming','voting','revealing']){
        await put(phase,125000);const before=await read();await b.locator('body').ariaSnapshot();await b.getByRole('button',{name:'ルームに参加する',exact:true}).click();await b.locator('body').ariaSnapshot();await b.locator('#guest-code').fill(report.room);await b.locator('#guest-nickname').fill('newGuest');await b.locator('[onclick="guestJoin()"]').click();await b.waitForTimeout(200);assert(JSON.stringify(await read())===JSON.stringify(before),'join wrongly removed 30min room');await b.evaluate(()=>goToTop());
        await reconnect();await a.waitForFunction(()=>guestPresence?.ready);assert(await a.evaluate(()=>state.gameRole)==='voter','savedrole authority');await page.request.delete(url(),{headers});await a.waitForFunction(()=>state.currentScreen==='top');report.cases.push({name:'TTL '+phase+' 125sec old retained on new join and savedrole DB restoration',pass:true});
      }
      for(const [phase,age] of [['waiting',119000],['naming',1799000],['voting',1801000],['revealing',1801000],['done',121000]]){
        await put(phase,age);const start=Date.now();await reconnect();await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null);for(let i=0;i<30&&await read()!==null;i++)await page.waitForTimeout(100);assert(await read()===null,'TTL boundary retained');report.cases.push({name:'TTL '+phase+' boundary fixture',pass:true,pastMs:age,elapsedMs:Date.now()-start});
      }
      await put('waiting',119000);await reconnect();await a.waitForFunction(()=>guestPresence?.ready);await patch({status:'naming'});await page.waitForTimeout(1800);assert(await read()!==null,'old2min timer deleted ingame');await patch({status:'waiting'});await a.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'phase shortened deadline not enforced');report.cases.push({name:'TTL phase change extends then shortens absolute deadline',pass:true});
      await put('waiting',119000);await reconnect();await a.waitForFunction(()=>guestPresence?.ready);await patch({hostConnected:true,hostDisconnectedAt:null});await page.waitForTimeout(1800);assert(await read()!==null,'restored host old deadline applied');await page.request.delete(url(),{headers});await a.waitForFunction(()=>state.currentScreen==='top');report.cases.push({name:'TTL synthetic host restoration cancels old deadline',pass:true});
    }else if(step==='boundaries'){
      report.room='B3ASEC';assert(await read()===null,'fixture exists');
      const fixture={host:'host',hostConnected:true,status:'voting',players:{host:{isHost:true,gameRole:'host',ready:true},guestA:{isHost:false,gameRole:'voter',ready:true,presenceVersion:1},guestB:{isHost:false,gameRole:'changer',changedName:"ま'ち",ready:true,presenceVersion:1},guestC:{isHost:false,gameRole:'changer',changedName:'<img src=x onerror="window.b30xss=1">',ready:true,presenceVersion:1}}};
      await page.request.put(url(),{headers,data:fixture});
      const recover=async(p,nick)=>{await p.evaluate(s=>sessionStorage.setItem('nc_session',JSON.stringify(s)),{roomCode:report.room,nickname:nick,isHost:false,gameRole:'bad-stale-role'});await p.reload();await p.waitForFunction(()=>state.currentScreen==='voting'&&guestPresence?.ready);};
      await recover(a,'guestA');await recover(b,'guestB');await recover(c,'guestC');await a.locator('body').ariaSnapshot();assert(await a.locator('#voting-cards img').count()===0,'stored HTML inserted');
      await a.locator('.vote-card[data-changer="guestB"] .vote-opt[data-original="guestB"]').click();assert(Object.keys(await a.evaluate(()=>state.myVotes)).length===1,'draft not selected');
      await b.evaluate(()=>goToTop());await b.waitForFunction(()=>state.currentScreen==='top');await a.waitForFunction(()=>Object.keys(state.myVotes).length===0);assert(await a.locator('.vote-card').count()===1,'candidate exit roster stale');report.cases.push({name:'candidate explicit exit discards unsubmitted draft and redraws',pass:true});
      await a.locator('.vote-card[data-changer="guestC"] .vote-opt[data-original="guestC"]').click();await a.locator('#voting-submit-btn').click();await a.waitForFunction(()=>!!state.lastRoom.players.guestA.votes);const votes=(await read()).players.guestA.votes;
      await c.evaluate(()=>goToTop());await c.waitForFunction(()=>state.currentScreen==='top');assert(JSON.stringify((await read()).players.guestA.votes)===JSON.stringify(votes),'submitted votes cleared after exit');assert(await a.evaluate(()=>!window.b30xss),'script executed');report.cases.push({name:'submitted votes retained after candidate exit and storedHTML text safe',pass:true,votes});
      await patch({'players/guestA':null});await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(!(await read()).players.guestA,'missingplayer recreated');report.cases.push({name:'missing player cleanup and reload',pass:true});
      const before=await read();for(const saved of ['{bad',JSON.stringify({roomCode:report.room,nickname:'host',isHost:false}),JSON.stringify({roomCode:report.room,nickname:'missing',isHost:false}),JSON.stringify({roomCode:report.room,nickname:'host',isHost:'true'}),JSON.stringify({roomCode:report.room,nickname:'notHost',isHost:true}),JSON.stringify({roomCode:report.room,nickname:'bad/name',isHost:false})]){
        await a.evaluate(saved=>sessionStorage.setItem('nc_session',saved),saved);await a.reload();await a.waitForFunction(()=>state.currentScreen==='top'&&!sessionStorage.getItem('nc_session')&&state.roomRef===null);assert(JSON.stringify(await read())===JSON.stringify(before),'invalid session wrote');report.cases.push({name:'invalid session/RTDB key',pass:true,saved});
      }await page.request.delete(url(),{headers});assert(await read()===null,'fixture cleanup');
    }else throw Error('Unknown step');
    (report.steps??=[]).push({step,status:'done',caseCount:report.cases.length,completedAt:new Date().toISOString()});
  }catch(error){report.failure=String(error);throw error;}finally{for(const off of listeners)off();await h.evaluate(r=>{window.b30report=r;window.b30running=null;},report);}
  return {step,cases:report.cases.length,failure:report.failure};
}
const step=process.argv[2];if(!['setup','fresh','waiting','naming','voting','revealing','done','doneReload','doneNewRoom','ttl','boundaries','guard'].includes(step))throw Error('Choose step');
console.log(`async page => (${run.toString()})(page,${JSON.stringify(step)})`);
