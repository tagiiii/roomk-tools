// B-29 SDK 10.14.1 isolated Emulator evidence. Source SHA256:
// 3532d1b03ae67d198f02bb07161dcd3c0a294f29c00dae46f9d946538e431e3c
// CLI run-code emitter, not a standalone test spec. Dedicated b29 session only.
// Prerequisites: demo-roomk-b29/Auth9099/RTDB9000/Hosting5500 configured before auth;
// noop stats, loopback CSP, source SHA and static gate verified. Host created by UI.
// Initial setup/uiRound used prior candidate a6f5; final fresh/uiRound reloaded all4
// contexts after source replacement, reset old results and created a new room.
// Final order: fresh, uiRound, waiting, reveal_role, drawing, discussion, voting,
// result, extra, replaySkip, done, boundaries. Phase fixtures are REST synthetic data;
// only uiRound asserts natural6-stroke advancement and automatic vote result.
// done uses actual30s timer; TTL uses past timestamps, not2min wall-clock wait.
// replaySkip late helper sees missing input: not an SDK queued-answer race test.
// VM evidence covers queued guess against committed skip and transaction retry order.
// CLI may yield on dialogs before registered handler accepts; inspect stored report
// before proceeding. Logs cover observed steps only, not initial navigation or gaps.
// Final sanitized JSON strips raw URL query tokens; browser/Emulator stopped after export.
// No production Firebase, iPhone, or authentication-boundary guarantee.
// Playwright CLI run-code callable emitter; real SDK + loopback Emulator only.
async function run(page, step) {
  const contexts=page.context().browser().contexts();
  if(contexts.length!==(step==='setup'?1:4)||contexts[0]!==page.context()||contexts.some(c=>c.pages().length!==1))throw Error('Dedicated context layout required');
  for(let i=0;i<contexts.length;i++){
    const p=contexts[i].pages()[0];
    if(p.url()!=='http://127.0.0.1:5500/magire-eshi/')throw Error('Loopback application only');
    const s=await p.evaluate(()=>({project:firebase.app().options.projectId,db:db.ref().toString(),auth:firebase.auth().emulatorConfig,role:window.b29role}));
    if(s.project!=='demo-roomk-b29'||s.db!=='http://127.0.0.1:9000/'||s.auth?.host!=='127.0.0.1'||s.auth?.port!==9099)throw Error('Emulator config required');
    if(step!=='setup'&&s.role!==['host','guestA','guestB','guestC'][i])throw Error('Context role mismatch');
  }
  const csp=(await page.request.get(page.url())).headers()['content-security-policy']||'';
  const connect=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src '));
  const allowed=new Set(["'self'",'http://127.0.0.1:9099','http://127.0.0.1:9000','ws://127.0.0.1:9000','http://localhost:9099','http://localhost:9000','ws://localhost:9000']);
  if(!connect||!connect.split(/\s+/).slice(1).every(s=>allowed.has(s)))throw Error('Local data CSP required');
  if(step==='guard')return {guard:'PASS'};
  const report=step==='setup'?{started:new Date().toISOString(),cases:[],network:[],errors:[],console:[]}:await page.evaluate(()=>window.b29report);
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
  const stable=p=>({isHost:p.isHost,confirmed:p.confirmed??false,vote:p.vote??null});
  let pages=contexts.flatMap(c=>c.pages()),[h,a,b,c]=pages;
  const headers={Authorization:'Bearer owner'};
  const url=()=>`http://127.0.0.1:9000/magire_rooms/${report.room}.json?ns=demo-roomk-b29`;
  const read=async()=>await(await page.request.get(url(),{headers})).json();
  const patch=async data=>page.request.patch(url(),{headers,data});
  const shot=async(p,name,width)=>{await p.setViewportSize({width,height:900});assert(await p.evaluate(()=>document.documentElement.scrollWidth===innerWidth),name+' overflow');await p.screenshot({path:'output/playwright/'+name+'.png'});};
  const reload=async phase=>{const before=stable((await read()).players.guestA);await a.reload();await a.waitForFunction(phase=>state.currentScreen===phase&&guestPresence?.ready,phase);const after=stable((await read()).players.guestA);assert(JSON.stringify(before)===JSON.stringify(after),phase+' reload fields');report.cases.push({name:phase+' reload',pass:true,before,after});};

  try{
    for(let i=0;i<pages.length;i++)await observe(pages[i],['host','guestA','guestB','guestC'][i]);
    if(step==='setup'){
      report.room=await h.evaluate(()=>state.roomCode);await h.evaluate(()=>window.b29role='host');
      for(const role of ['guestA','guestB','guestC']){
        const p=await(await h.context().browser().newContext()).newPage();await observe(p,role);await p.addInitScript(role=>window.b29role=role,role);
        await p.goto('http://127.0.0.1:5500/magire-eshi/');await p.locator('body').ariaSnapshot();
        await p.locator('[onclick="goTo(\'guest-join\')"]').click();await p.locator('body').ariaSnapshot();
        await p.locator('#guest-nickname').fill(role);await p.locator('#guest-code').fill(report.room);
        await p.locator('[onclick="guestJoin()"]').click();await p.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready);
      }
      report.cases.push({name:'host plus3 guests UI join',pass:true,room:await read()});
    }else if(step==='fresh'){
      await h.locator('body').ariaSnapshot();await h.locator('[onclick="hostNextRound()"]').count();
      await h.evaluate(()=>leaveGame());await h.waitForFunction(()=>state.currentScreen==='top');
      for(const p of pages){await p.reload();await p.waitForFunction(()=>state.currentScreen==='top');}
      await h.evaluate(()=>window.b29role='host');report.cases=[];report.network=[];report.errors=[];report.console=[];delete report.fixtureGame;
      await h.locator('body').ariaSnapshot();await h.getByRole('button',{name:'ルームを作る',exact:true}).click();await h.locator('body').ariaSnapshot();await h.locator('#host-nickname').fill('host');await h.getByRole('button',{name:'ルームを作成する',exact:true}).click();await h.waitForFunction(()=>state.currentScreen==='waiting');report.room=await h.evaluate(()=>state.roomCode);
      for(const [nick,p] of Object.entries({guestA:a,guestB:b,guestC:c})){await p.locator('body').ariaSnapshot();await p.getByRole('button',{name:'ルームに参加する',exact:true}).click();await p.locator('body').ariaSnapshot();await p.locator('#guest-nickname').fill(nick);await p.locator('#guest-code').fill(report.room);await p.locator('[onclick="guestJoin()"]').click();await p.waitForFunction(()=>guestPresence?.ready&&state.currentScreen==='waiting');}
      report.cases.push({name:'final source fresh room and3 guests UI join',pass:true,room:await read()});
    }else if(step==='uiRound'){
      await h.locator('body').ariaSnapshot();await h.locator('#btn-start').click();await a.waitForFunction(()=>state.currentScreen==='reveal');
      const initial=await read(), byNick={guestA:a,guestB:b,guestC:c};
      for(const [nick,p] of Object.entries(byNick)){
        await p.locator('body').ariaSnapshot();await p.locator('#rv-card').click();
        const text=await p.locator('#rv-card').innerText();
        assert(nick===initial.game.fakeArtist?!text.includes(initial.game.topicWord):text.includes(initial.game.topicWord),'role topic visibility');
        await p.locator('#btn-confirm').click();
      }
      await h.locator('#btn-start-drawing').click();await a.waitForFunction(()=>state.currentScreen==='drawing');
      for(let i=0;i<6;i++){
        const room=await read(), nick=room.game.drawOrder[i%3], p=byNick[nick];
        assert(room.game.turnIndex===i,'turn unexpected');await p.locator('body').ariaSnapshot();
        await p.locator('#cv-draw').scrollIntoViewIfNeeded();const box=await p.locator('#cv-draw').boundingBox();
        await p.mouse.move(box.x+box.width*.2,box.y+box.height*(.2+i*.08));await p.mouse.down();
        await p.mouse.move(box.x+box.width*.65,box.y+box.height*(.25+i*.08),{steps:8});await p.mouse.up();
        await p.locator('#btn-stroke-ok').click();await h.waitForFunction(i=>(state.lastRoom?.game?.turnIndex??0)>i,i);
      }
      await a.waitForFunction(()=>state.currentScreen==='discussion');const drawn=await read();
      assert(Object.keys(drawn.game.strokes||{}).length===6,'six strokes not saved');
      report.cases.push({name:'real UI role reveal and6 pointer strokes naturally reach discussion',pass:true,game:drawn.game});
      await h.locator('body').ariaSnapshot();await h.locator('[onclick="hostStartVoting()"]').click();await a.waitForFunction(()=>state.currentScreen==='voting');
      for(const [nick,p] of Object.entries(byNick)){
        const target=nick===initial.game.fakeArtist?Object.keys(byNick).find(n=>n!==nick):initial.game.fakeArtist;
        await p.locator('body').ariaSnapshot();await p.locator('#vt-btns button').filter({hasText:target}).click();
        await h.waitForFunction(nick=>!!state.lastRoom?.players?.[nick]?.vote,nick);
      }
      await a.waitForFunction(()=>state.currentScreen==='result');assert((await read()).game.result.outcome==='caught','expected caught');
      const fake=byNick[initial.game.fakeArtist];await fake.locator('body').ariaSnapshot();await fake.locator('#rs-guess-input').fill(initial.game.topicWord);await fake.getByRole('button',{name:'答える',exact:true}).click();
      await h.getByRole('button',{name:'当たり',exact:true}).click();await h.waitForFunction(()=>state.lastRoom?.game?.result?.reversalJudge==='win');
      report.cases.push({name:'real UI votes caught reversal answer and host judge',pass:true,result:(await read()).game.result});
    }else if(['waiting','reveal_role','drawing','discussion','voting','result','done'].includes(step)){
      const screen=step==='reveal_role'?'reveal':step;
      const current=await read();report.fixtureGame??=current.game;
      const game={...report.fixtureGame,turnIndex:step==='drawing'?0:6,result:{outcome:'caught',reversalGuess:'保存済み',reversalJudge:'lose'}};
      await patch({status:step,game,'players/guestA/confirmed':true,'players/guestA/vote':'guestB','players/guestB/vote':null,'players/guestC/vote':null});
      const started=Date.now();await a.waitForFunction(screen=>state.currentScreen===screen,screen);
      const stableRoom=room=>({players:Object.fromEntries(Object.entries(room.players).map(([n,p])=>[n,stable(p)])),game:room.game,round:room.round,status:room.status});
      const before=stableRoom(await read());await reload(screen);
      if(['reveal_role','drawing','discussion'].includes(step)){
        for(const [nick,p] of Object.entries({guestA:a,guestB:b,guestC:c})){
          await p.reload();await p.waitForFunction(screen=>state.currentScreen===screen&&guestPresence?.ready,screen);
          const selector=step==='reveal_role'?'#rv-card':step==='drawing'?'#dr-topic-chip-area':'#di-topic-chip-area';
          if(step==='reveal_role')await p.locator('#rv-card').click();
          const text=await p.locator(selector).innerText();assert(nick===game.fakeArtist?!text.includes(game.topicWord):text.includes(game.topicWord),'reconnect topic privacy');
        }report.cases.push({name:'fixture '+step+' all3 reload and normal/fake topic privacy',pass:true,fakeArtist:game.fakeArtist});
      }
      for(let n=1;n<=2;n++){
        const prior=(await read()).players.guestA.connections;
        await a.context().setOffline(true);for(let i=0;i<180;i++){if(!(await read()).players.guestA.connections)break;await page.waitForTimeout(250);}
        assert(!(await read()).players.guestA.connections,'disconnect not observed');
        assert(JSON.stringify(stableRoom(await read()))===JSON.stringify(before),'temporary disconnect mutated game');
        if(step==='waiting')assert(await h.locator('#btn-start').isDisabled(),'disconnected start');
        await shot(a,step+'-offline-guest375-'+n,375);await shot(h,step+'-host1280-'+n,1280);
        await page.waitForTimeout(10000);await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready,null,{timeout:45000});
        assert(JSON.stringify(stableRoom(await read()))===JSON.stringify(before),'reconnect mutated game');
        const after=(await read()).players.guestA.connections;assert(Object.keys(after||{}).length===1&&!Object.keys(prior||{}).includes(Object.keys(after)[0]),'connection rotate');
        report.cases.push({name:'fixture '+step+' browser10s disconnect cycle'+n,pass:true,stable:before});
      }
      if(step==='done'){
        await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null,null,{timeout:45000});await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'done not deleted');
        const elapsedMs=Date.now()-started;assert(elapsedMs>=29000&&elapsedMs<40000,'done timer');await a.context().setOffline(true);await page.waitForTimeout(1000);await a.context().setOffline(false);await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'done ghost');report.cases.push({name:'done actual30sec deletion and reconnect/reload no ghost',pass:true,elapsedMs});
      }
    }else if(step==='extra'){
      const byNick={guestA:a,guestB:b,guestC:c};
      await patch({status:'result','game/result':{outcome:'caught'}});
      const fake=byNick[(await read()).game.fakeArtist];await fake.waitForFunction(()=>!!document.getElementById('rs-guess-input'));
      await fake.locator('body').ariaSnapshot();await fake.locator('#rs-guess-input').fill("ま'ち");await fake.getByRole('button',{name:'答える',exact:true}).click();await h.waitForFunction(()=>!!state.lastRoom.game.result.reversalGuess);
      h.once('dialog',d=>d.accept());await h.evaluate(()=>hostSkipReversal());assert((await read()).game.result.reversalGuess==="ま'ち"&&!(await read()).game.result.reversalJudge,'answer-first skip overwrote');
      await h.getByRole('button',{name:'外れ',exact:true}).click();report.cases.push({name:'SDK UI answer first then direct host skip helper abort',pass:true});
      for(const outcome of ['escaped','aborted']){await patch({'game/result':{outcome}});await h.waitForFunction(outcome=>state.lastRoom.game.result.outcome===outcome,outcome);assert(await h.locator('#rs-host-actions').isVisible(),'final actions absent');report.cases.push({name:'stored result fixture '+outcome,pass:true});}
      const saved=await read();await patch({status:'drawing',game:{...saved.game,drawOrder:['guestA','guestB','guestC'],turnIndex:0,result:null}});await a.waitForFunction(()=>state.currentScreen==='drawing'&&guestPresence.ready);
      await a.locator('body').ariaSnapshot();await a.locator('#cv-draw').scrollIntoViewIfNeeded();const box=await a.locator('#cv-draw').boundingBox();await a.mouse.move(box.x+20,box.y+20);await a.mouse.down();await a.mouse.move(box.x+80,box.y+60);await a.mouse.up();assert(await a.evaluate(()=>!!state.pendingStroke),'no pending stroke');
      const before=await read();await a.context().setOffline(true);await a.waitForFunction(()=>!guestPresence.ready&&!state.pendingStroke);assert(await a.locator('#btn-stroke-ok').isDisabled(),'offline stroke control');await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence.ready);assert(await a.evaluate(()=>!state.pendingStroke&&!state.isPointerDrawing),'pending restored');assert(JSON.stringify((await read()).game)===JSON.stringify(before.game),'pending wrote game');report.cases.push({name:'real pointer pending stroke discarded on offline; saved game unchanged',pass:true});
      await patch({status:'result','game/result':{outcome:'escaped'}});await h.waitForFunction(()=>state.currentScreen==='result');
    }else if(step==='replaySkip'){
      const before=await read();await h.locator('body').ariaSnapshot();await h.locator('[onclick="hostNextRound()"]').click();await a.waitForFunction(()=>state.currentScreen==='reveal');const after=await read();
      assert(after.round===before.round+1&&!after.game.strokes&&after.game.turnIndex===0,'replay reset');
      for(const nick of ['guestA','guestB','guestC']){assert(after.players[nick].confirmed===false&&!after.players[nick].vote,'player reset');assert(JSON.stringify(after.players[nick].connections)===JSON.stringify(before.players[nick].connections),'presence reset');}
      assert(!await h.locator('#rv-secret-topic').getAttribute('open')&&!await h.locator('#rv-secret-fake').getAttribute('open'),'secret opened');report.cases.push({name:'UI next round resets game and retains presence',pass:true});
      await patch({status:'result','game/result':{outcome:'caught'}});await h.waitForFunction(()=>state.currentScreen==='result');h.once('dialog',d=>d.accept());await h.locator('[onclick="hostSkipReversal()"]').click();await h.waitForFunction(()=>state.lastRoom?.game?.result?.reversalJudge==='lose');
      const byNick={guestA:a,guestB:b,guestC:c},fake=byNick[after.game.fakeArtist];await fake.evaluate(()=>{const input=document.getElementById('rs-guess-input');if(input)input.value='遅い回答';return submitReversalGuess();});assert(!(await read()).game.result.reversalGuess,'late guess accepted');report.cases.push({name:'caught fixture UI skip; direct answer helper returns with form absent',pass:true});
    }else if(step==='boundaries'){
      const create=async()=>{await h.locator('body').ariaSnapshot();await h.getByRole('button',{name:'ルームを作る',exact:true}).click();await h.locator('body').ariaSnapshot();await h.locator('#host-nickname').fill('host');await h.getByRole('button',{name:'ルームを作成する',exact:true}).click();await h.waitForFunction(()=>state.currentScreen==='waiting');report.room=await h.evaluate(()=>state.roomCode);};
      const join=async(p,nick)=>{await p.locator('body').ariaSnapshot();await p.getByRole('button',{name:'ルームに参加する',exact:true}).click();await p.locator('body').ariaSnapshot();await p.locator('#guest-nickname').fill(nick);await p.locator('#guest-code').fill(report.room);await p.locator('[onclick="guestJoin()"]').click();await p.waitForFunction(()=>guestPresence?.ready);};
      await create();assert(await h.locator('#btn-start').isDisabled(),'minimum guests bypass');for(const [nick,p] of Object.entries({guestA:a,guestB:b,guestC:c}))await join(p,nick);
      await patch({status:'drawing',round:1,game:{...report.fixtureGame,fakeArtist:'guestC',drawOrder:['guestA','guestB','guestC'],turnIndex:0,result:null}});await a.waitForFunction(()=>state.currentScreen==='drawing');
      const strokes=(await read()).game.strokes;a.once('dialog',d=>d.accept());await a.evaluate(()=>leaveGame());await a.waitForFunction(()=>state.currentScreen==='top');await h.waitForFunction(()=>state.lastRoom.game.turnIndex===1);
      assert(!(await read()).players.guestA&&JSON.stringify((await read()).game.strokes)===JSON.stringify(strokes),'exit data behavior');report.cases.push({name:'fixture current player explicit exit skips turn but retains strokes',pass:true});
      c.once('dialog',d=>d.accept());await c.evaluate(()=>leaveGame());await c.waitForFunction(()=>state.currentScreen==='top');await h.locator('[onclick="hostAbortRound()"]').click();await h.waitForFunction(()=>state.currentScreen==='result');assert((await read()).game.result.outcome==='aborted','fake exit not aborted');assert(await h.locator('#btn-next-round').isDisabled(),'too few next round');report.cases.push({name:'fixture fake explicit exit host abort and minimum gate',pass:true});
      await patch({'players/guestB':null});await b.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null&&state.roomRef===null);await b.reload();await b.waitForFunction(()=>state.currentScreen==='top');assert(!(await read()).players.guestB,'missing player recreated');report.cases.push({name:'missing player cleanup/reload',pass:true});
      const before=await read();for(const session of [{nickname:'host',role:'guest'},{nickname:'missing',role:'guest'},{nickname:'notHost',role:'host'},{nickname:'host',role:'unexpected'}]){await a.evaluate(s=>sessionStorage.setItem('magire_session',JSON.stringify(s)),{...session,roomCode:report.room});await a.reload();await a.waitForFunction(()=>state.currentScreen==='top');assert(await a.evaluate(()=>!sessionStorage.getItem('magire_session')&&state.roomRef===null),'bad session remains');assert(JSON.stringify(await read())===JSON.stringify(before),'invalid write');report.cases.push({name:'invalid session',pass:true,session});}
      await h.evaluate(()=>leaveGame());await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'host exit room');report.cases.push({name:'host exit cleanup',pass:true});
      for(const age of [125000,119000]){await create();await join(a,'guestA');const start=Date.now();await patch({hostConnected:false,hostDisconnectedAt:Date.now()-age});await a.waitForFunction(()=>state.currentScreen==='top'&&guestPresence===null);await h.waitForFunction(()=>state.currentScreen==='top');assert(await read()===null,'TTL room');report.cases.push({name:'TTL past timestamp fixture',pass:true,pastMs:age,elapsedMs:Date.now()-start});}
    }else throw Error('Unknown step');
  }catch(error){report.failure=String(error);throw error;}finally{for(const off of listeners)off();await h.evaluate(r=>window.b29report=r,report);}
  return {step,cases:report.cases.length,failure:report.failure};
}
const step=process.argv[2];if(!['setup','fresh','uiRound','extra','replaySkip','boundaries','guard','waiting','reveal_role','drawing','discussion','voting','result','done'].includes(step))throw Error('Choose step');
console.log(`async page => (${run.toString()})(page,${JSON.stringify(step)})`);
