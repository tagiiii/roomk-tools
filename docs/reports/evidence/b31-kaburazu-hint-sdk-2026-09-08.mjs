// B31 real SDK + isolated Emulator reproduction emitter; use via Playwright CLI run-code only.
// Run in an independently prepared scratch with exact frozen app, no-op stats and loopback CSP.
// setup creates only three NEW contexts after requiring one dedicated host page; no existing contexts closed.
// Then fresh/waiting/uiRound/spectatorBoundary/regressions, six phase:* steps, explicitExit/replay/doneTimer.
// After deletion fresh/doneReload, then ttlBoundary. Never overlap CLI calls; wait process exit0 and step done.
// invalidSessions is only recovery for the documented owned ttl-fixture remainder, not normal sequence.
// The published56 groups include additional fresh join after an excluded harness expectation failure.
// No production/iPhone/OSclipboard; native spectator WebSocket observation delegates actual SDK sends.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const expectedSHA='3e1b3baac2dd66a204dcf95c676399f04b51dc824bdf50533ea8f189b2a7f65c';
const actualSHA=createHash('sha256').update(fs.readFileSync('apps/kaburazu-hint/index.html')).digest('hex');
if(actualSHA!==expectedSHA)throw Error('Frozen application SHA mismatch; do not execute against another source');
async function run(page, step) {
  const root='http://127.0.0.1:5500/kaburazu-hint/';
  const roles=['host','guestA','guestB','spectator'];
  const contexts=page.context().browser().contexts();
  if(contexts.length!==(step==='setup'?1:4)||contexts[0]!==page.context()||contexts.some(c=>c.pages().length!==1))throw Error('Dedicated context layout required');
  for(let i=0;i<contexts.length;i++){
    const p=contexts[i].pages()[0];
    if(!(p.url()===root||(i===3&&p.url().startsWith(root+'?watch='))))throw Error('Loopback application only');
    const s=await p.evaluate(()=>({project:firebase.app().options.projectId,db:db.ref().toString(),auth:firebase.auth().emulatorConfig,role:window.b31role}));
    if(s.project!=='demo-roomk-b31'||s.db!=='http://127.0.0.1:9000/'||s.auth?.host!=='127.0.0.1'||s.auth?.port!==9099)throw Error('Emulator config required');
    if(step!=='setup'&&s.role!==roles[i])throw Error('Context role mismatch');
  }
  const csp=(await page.request.get(root)).headers()['content-security-policy']||'';
  const connect=csp.split(';').map(s=>s.trim()).find(s=>s.startsWith('connect-src '));
  const allowed=new Set(["'self'",'http://127.0.0.1:9099','http://127.0.0.1:9000','ws://127.0.0.1:9000','http://localhost:9099','http://localhost:9000','ws://localhost:9000']);
  if(!connect||!connect.split(/\s+/).slice(1).every(s=>allowed.has(s)))throw Error('Local data CSP required');
  if(step==='guard')return {guard:'PASS'};
  if(!await page.evaluate(step=>{if(window.b31running)return false;window.b31running=step;return true;},step))throw Error('Another step running');
  const report=step==='setup'?{sourceSHA:'3e1b3baac2dd66a204dcf95c676399f04b51dc824bdf50533ea8f189b2a7f65c',started:new Date().toISOString(),cases:[],network:[],errors:[],console:[],steps:[]}:await page.evaluate(()=>window.b31report);
  if(!report)throw Error('Setup report missing');
  const listeners=[];
  const observe=(p,role)=>{
    const request=r=>report.network.push({step,role,url:r.url()});
    const websocket=w=>report.network.push({step,role,url:w.url()});
    const error=e=>report.errors.push({step,role,error:String(e)});
    const console=m=>{if(['error','warning'].includes(m.type()))report.console.push({step,role,type:m.type(),text:m.text()});};
    p.on('request',request);p.on('websocket',websocket);p.on('pageerror',error);p.on('console',console);
    listeners.push(()=>{p.off('request',request);p.off('websocket',websocket);p.off('pageerror',error);p.off('console',console);});
  };
  const assert=(ok,msg)=>{if(!ok)throw Error(msg);};
  const headers={Authorization:'Bearer owner'};
  const dburl=()=>`http://127.0.0.1:9000/kaburazuhint_rooms/${report.room}.json?ns=demo-roomk-b31`;
  const read=async()=>await(await page.request.get(dburl(),{headers})).json();
  const shot=async(p,name,width)=>{await p.setViewportSize({width,height:900});await p.screenshot({path:`output/playwright/${name}.png`,fullPage:true});};
  let pages=contexts.flatMap(c=>c.pages()),[h,a,b,s]=pages;
  pages.forEach((p,i)=>observe(p,roles[i]));
  try {
    if(step==='setup'){
      await h.context().addInitScript(()=>{window.b31role='host';});
      await h.evaluate(()=>{window.b31role='host';});
      for(const role of roles.slice(1)){
        const c=await h.context().browser().newContext({viewport:{width:375,height:900}});
        await c.addInitScript(role=>{
          window.b31role=role;
          if(role!=='spectator')return;
          // Transparent native transport observation: record action names only, never auth payload.
          window.b31transport={sockets:[],actions:[],unparsed:0};
          const Native=window.WebSocket;
          window.WebSocket=class extends Native {
            constructor(...args){super(...args);window.b31transport.sockets.push(String(args[0]).split('?')[0]);}
            send(data){
              try {const message=JSON.parse(data);if(message?.d?.a)window.b31transport.actions.push(message.d.a);}
              catch {window.b31transport.unparsed++;}
              return super.send(data);
            }
          };
        },role);
        const p=await c.newPage();observe(p,role);await p.goto(root);await p.waitForFunction(()=>typeof state!=='undefined'&&state.currentScreen==='top');
      }
    } else if(step==='fresh'){
      assert(await h.evaluate(()=>state.currentScreen==='top'&&!state.roomRef),'Fresh TOP host required');
      await h.locator('body').ariaSnapshot();
      await h.locator('[onclick="showScreen(\'host-setup\')"]').click();
      await h.locator('#host-nickname').fill('host');await h.locator('[onclick="hostCreate()"]').click();
      await h.waitForFunction(()=>state.currentScreen==='waiting');report.room=await h.evaluate(()=>state.roomCode);
      for(const [p,nick] of [[a,"ま'ち"],[b,'guestB']]){
        await p.locator('body').ariaSnapshot();await p.locator('[onclick="showScreen(\'guest-join\')"]').click();
        await p.locator('#guest-nickname').fill(nick);await p.locator('#guest-code').fill(report.room);await p.locator('[onclick="guestJoin()"]').click();
        await p.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready);
      }
      await s.locator('body').ariaSnapshot();
      if(await s.evaluate(()=>state.role==='spectator'))await s.locator('[onclick="spectatorLeave()"]').first().click();
      await s.locator('[onclick="showScreen(\'spectate-join\')"]').click();
      await s.locator('#spectate-code').fill(report.room);await s.locator('[onclick="spectateJoin()"]').click();
      await s.waitForFunction(()=>state.role==='spectator'&&state.currentScreen==='spectator');
      assert(s.url()===root+'?watch='+report.room,'Spectator URL not canonical');
      const room=await read();assert(Object.keys(room.players).length===3,'Spectator added player');
      assert(await h.locator('#btn-start-game').isEnabled(),'Start disabled with three connected participants');
      await shot(h,'waiting-host1280',1280);await shot(s,'waiting-spectator375',375);
      report.cases.push({name:'Fresh host + two guests + spectator UI joins',pass:true,method:'real UI',quoteNickname:"ま'ち",note:'Quote nickname is valid within 8-character input limit; spectator native WebSocket observation delegates actual sends.'});
    } else if(step==='waiting'){
      const before=await read();
      await a.reload();await a.waitForFunction(()=>state.currentScreen==='waiting'&&guestPresence?.ready);
      assert((await read()).players["ま'ち"]?.isHost===false,'guest disappeared on reload');
      report.cases.push({name:'waiting guest reload',pass:true});
      for(let cycle=1;cycle<=2;cycle++){
        await a.context().setOffline(true);await a.waitForTimeout(10000);
        assert(await a.locator('#guest-off-overlay').isVisible(),'offline overlay missing');
        await h.waitForFunction(()=>document.getElementById('btn-start-game').disabled);
        const offline=await read();assert(offline.players["ま'ち"]&&Object.keys(offline.players["ま'ち"].connections||{}).length===0,'guest not retained disconnected');
        await shot(a,`waiting-offline-guest375-${cycle}`,375);
        await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready);
        await h.waitForFunction(()=>!document.getElementById('btn-start-game').disabled);
        const after=await read();assert(after.status===before.status&&after.players["ま'ち"].isHost===false,'waiting data changed');
        report.cases.push({name:`waiting browser offline10sec cycle${cycle}`,pass:true});
      }
    } else if(step==='uiRound'){
      await h.locator('body').ariaSnapshot();await h.locator('#btn-start-game').click();
      await h.waitForFunction(()=>state.currentScreen==='clue');
      const started=await read();assert(!!started.gameId,'gameId missing');report.gameId=started.gameId;
      const byNick={host:h,"ま'ち":a,guestB:b};
      for(let roundNo=1;roundNo<=3;roundNo++){
        const room=await read(),guesser=room.round.guesser;
        assert(room.round.number===roundNo,'round order');
        for(const [nick,p] of Object.entries(byNick))if(nick!==guesser){
          await p.locator('body').ariaSnapshot();await p.locator('#clue-hint-input').fill(roundNo===2?'同じ':nick==='host'?'ことば':'ヒント');
          await p.locator('[onclick="submitHint()"]').click();
        }
        if(guesser!=='host'){
          await h.waitForFunction(()=>state.currentScreen==='review');
          if(roundNo!==2){
            const toggle=h.locator('.kbz-hint-card__toggle:not(:disabled)').first();
            await toggle.click();const excluded=await h.evaluate(()=>[...reviewExcluded]);
            await b.context().setOffline(true);await b.waitForTimeout(10000);await b.context().setOffline(false);await b.waitForFunction(()=>guestPresence?.ready);
            assert(JSON.stringify(await h.evaluate(()=>[...reviewExcluded]))===JSON.stringify(excluded),'manual draft lost across presence');
            await toggle.click();
          }
          await h.locator('[onclick="confirmHints()"]').click();
        }
        await byNick[guesser].waitForFunction(()=>state.currentScreen==='answer');
        const answerRoom=await read();
        if(roundNo===2)assert((answerRoom.round.excludedHintIds||[]).length===2,'duplicate hints not excluded');
        const spectator=await s.locator('#spec-content').textContent();assert(!spectator.includes(room.round.secretWord),'spectator secret leaked in answer');
        await byNick[guesser].locator('body').ariaSnapshot();
        if(roundNo===2)await byNick[guesser].locator('[onclick="passAnswer()"]').click();
        else {
          await byNick[guesser].locator('#answer-input').fill('別の答え');await byNick[guesser].locator('[onclick="submitAnswer()"]').click();
          await h.waitForFunction(()=>state.currentScreen==='judge');await h.locator('[onclick="judgeAnswer(true)"]').click();
        }
        await h.waitForFunction(()=>state.currentScreen==='result');
        const result=await read();assert(result.history&&Object.values(result.history).filter(Boolean).length===roundNo,'history not once per round');
        report.cases.push({name:`UI round${roundNo}: ${guesser} guesses; hints/${roundNo===2?'duplicate/pass':'manual-review/judge'}/history`,pass:true,method:'real UI, presence offline via context.setOffline; no phase fixture',guesser});
        await shot(s,`ui-result-spectator375-${roundNo}`,375);
        if(roundNo<3){await h.locator('#btn-next-round').click();await h.waitForFunction(()=>state.currentScreen==='clue');}
      }
      report.uiResult=await read();
      await shot(h,'ui-result-host1280',1280);await shot(a,'ui-result-guest375',375);
    } else if(step==='explicitExit'){
      await page.request.patch(dburl(),{headers,data:{status:'clue-input',gameId:'exit-fixture',round:{number:1,totalRounds:3,guesser:'host',secretWord:'ねこ',hints:{"ま'ち":{text:'保持ヒント',normalized:'ほじひんと'}},passed:false}}});
      await a.waitForFunction(()=>state.currentScreen==='clue');
      await h.context().setOffline(true);await a.waitForFunction(()=>state.lastRoom?.hostConnected===false);
      await a.locator('#host-off-overlay [onclick="leaveGame()"]').click();await a.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef);
      const left=await read();assert(!left.players["ま'ち"]&&left.round.hints["ま'ち"].text==='保持ヒント','explicit exit removed hint or retained player');
      await h.context().setOffline(false);await h.waitForFunction(()=>state.lastRoom?.hostConnected===true);await h.waitForTimeout(300);
      assert((await read()).status==='clue-input','departed hint falsely counted as all submitted');
      assert((await h.locator('#clue-progress').textContent()).includes('0 / 1'),'remaining submission count incorrect');
      report.cases.push({name:'Explicit overlay exit removes only own player and keeps submitted hint; remaining unsubmitted guest prevents auto-close',pass:true,method:'synthetic partially submitted round then host browser disconnect and guest real UI exit'});
      await page.request.patch(dburl(),{headers,data:{'players/ま\'ち':{isHost:false,presenceVersion:1}}});
      await a.evaluate(roomCode=>sessionStorage.setItem('kaburazuhint_session',JSON.stringify({nickname:"ま'ち",role:'guest',roomCode})),report.room);await a.reload();await a.waitForFunction(()=>guestPresence?.ready);
      await page.request.patch(dburl(),{headers,data:{status:'result',gameId:'exit-restored',round:report.uiResult.round,history:report.uiResult.history}});await h.waitForFunction(()=>state.currentScreen==='result');
    } else if(step==='regressions'){
      const hint='<img src=x onerror=window.b31xss=true>';
      await h.evaluate(()=>window.b31xss=false);
      await page.request.patch(dburl(),{headers,data:{status:'clue-review',gameId:'quote-xss-fixture',history:null,round:{number:1,totalRounds:3,guesser:'guestB',secretWord:'ねこ',hints:{host:{text:'普通',normalized:'ふつう'},"ま'ち":{text:hint,normalized:hint}},passed:false}}});
      await h.waitForFunction(()=>state.currentScreen==='review');await h.locator('body').ariaSnapshot();
      const card=h.locator('.kbz-hint-card').filter({hasText:"ま'ち"});
      assert(await card.count()===1,'quote card missing');assert(await card.locator('img').count()===0&&!await h.evaluate(()=>window.b31xss),'hint XSS DOM');
      await card.locator('.kbz-hint-card__toggle').click();assert(await h.evaluate(()=>reviewExcluded.has("ま'ち")),'quote exclusion failed');
      await h.locator('[onclick="confirmHints()"]').click();await h.waitForFunction(()=>state.currentScreen==='answer');
      assert((await read()).round.excludedHintIds.includes("ま'ち"),'quote ID encoding changed');
      await h.reload();await h.waitForFunction(()=>state.currentScreen==='answer');assert((await read()).round.excludedHintIds.includes("ま'ち"),'confirmed exclusion reload lost');
      assert(!await s.locator('#spec-content').textContent().then(x=>x.includes(hint)),'excluded XSS fixture leaked spectator');
      report.cases.push({name:'B23 valid quote nickname toggle/confirmed reload and long HTML hint fixture escaped',pass:true,method:'nickname valid UI-created; long >20char HTML hint injected via REST solely to test renderer, not valid UI hint input'});
      await page.request.patch(dburl(),{headers,data:{status:'clue-input',gameId:'force-fixture',round:{number:1,totalRounds:3,guesser:"ま'ち",secretWord:'ねこ',hints:{host:{text:'普通',normalized:'ふつう'}},passed:false}}});
      await h.waitForFunction(()=>state.currentScreen==='clue');await h.locator('#btn-force-close-clue').click();await h.waitForFunction(()=>state.currentScreen==='review');
      assert((await read()).round.missingHintIds.includes('guestB'),'forced close missing giver not recorded');
      report.cases.push({name:'Forced close retains missingHintIds',pass:true,method:'synthetic partially submitted round + real host UI force close'});
      await page.request.patch(dburl(),{headers,data:{status:'clue-input',gameId:null,round:{number:1,totalRounds:3,guesser:'guestB',secretWord:'ねこ',passed:false}}});
      await a.waitForFunction(()=>state.currentScreen==='clue');const old=JSON.stringify(await read());
      await a.evaluate(()=>{document.getElementById('clue-hint-input').value='送らない';return submitHint();});
      assert(JSON.stringify(await read())===old,'legacy missing gameId accepted mutation');
      report.cases.push({name:'Missing gameId ongoing render but send refused',pass:true,method:'REST missing-ID fixture + direct public function invocation, not real UI send'});
      await page.request.patch(dburl(),{headers,data:{status:'result',gameId:'restored-result',round:report.uiResult.round,history:report.uiResult.history}});await h.waitForFunction(()=>state.currentScreen==='result');
    } else if(['ttlBoundary','invalidSessions'].includes(step)){
      assert(await h.evaluate(()=>state.currentScreen==='top'&&!state.roomRef),'TTL requires host TOP/no listener');
      report.room='B3ATTL';
      if(step==='invalidSessions'){assert((await read())?.gameId==='ttl-fixture','Expected owned remainder fixture');await page.request.delete(dburl(),{headers});}
      assert(await read()===null,'TTL fixture exists');
      const put=async(phase,age)=>page.request.put(dburl(),{headers,data:{host:'host',hostConnected:false,hostDisconnectedAt:Date.now()-age,status:phase,gameId:'ttl-fixture',players:{host:{isHost:true},"ま'ち":{isHost:false,presenceVersion:1}},round:{number:1,totalRounds:3,guesser:"ま'ち",secretWord:'ねこ'},turnOrder:['host',"ま'ち",'guestB']}});
      const restore=async()=>{await a.evaluate(roomCode=>sessionStorage.setItem('kaburazuhint_session',JSON.stringify({nickname:"ま'ち",roomCode,role:'guest'})),report.room);await a.reload();};
      if(step==='ttlBoundary'){
      for(const phase of ['waiting','clue-input','clue-review','answer','judge','result','finished']){
        await put(phase,125000);await restore();await a.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef&&!sessionStorage.getItem('kaburazuhint_session'));
        assert(await read()===null,'expired room remains '+phase);report.cases.push({name:'TTL125sec '+phase+' removes expired room',pass:true,method:'past timestamp fixture, real SDK rejoin transaction; not real2minute elapsed'});
      }
      await put('answer',119000);await restore();await a.waitForFunction(()=>guestPresence?.ready);await a.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef&&!sessionStorage.getItem('kaburazuhint_session'));
      assert(await read()===null,'TTL scheduled boundary remains');report.cases.push({name:'TTL119sec live timer expires after remaining second',pass:true,method:'timestamp119sec fixture, real remaining timer'});
      await put('answer',118000);const live=JSON.stringify(await read());await s.goto(root+'?watch='+report.room);await s.waitForFunction(()=>state.role==='spectator'&&state.roomRef);
      await s.waitForFunction(()=>state.currentScreen==='spectator'&&!state.roomRef&&state.specTimer===null);
      assert(JSON.stringify(await read())===live,'spectator live TTL wrote database');
      const ended=await s.locator('#spec-content').innerHTML();await page.request.patch(dburl(),{headers,data:{hostConnected:true,status:'waiting',gameId:'reused-after-ttl'}});await s.waitForTimeout(200);
      assert(await s.locator('#spec-content').innerHTML()===ended,'spectator TTL retained listener on reused code');
      report.cases.push({name:'Spectator live TTL ends display without write and detaches before same-code reuse',pass:true,method:'118sec timestamp fixture + real remaining2sec local timer'});
      await put('answer',125000);const expired=JSON.stringify(await read());await s.goto(root+'?watch='+report.room);await s.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef);
      assert(JSON.stringify(await read())===expired,'spectator removed expired room');
      const transport=await s.evaluate(()=>window.b31transport);assert(!transport.actions.some(x=>['p','m','o','om','oc'].includes(x)),'spectator TTL mutation');
      await page.request.delete(dburl(),{headers});report.cases.push({name:'Spectator expired room is read-only',pass:true,transport,method:'timestamp fixture + real spectator URL entry'});
      }
      for(const session of ['{bad',JSON.stringify({nickname:'bad/key',roomCode:'B3ATTL',role:'guest'}),JSON.stringify({nickname:'host',roomCode:'B3ATTL',role:'guest'}),JSON.stringify({nickname:"ま'ち",roomCode:'../x',role:'guest'}),JSON.stringify({nickname:'missing',roomCode:'B3ATTL',role:'guest'})]){
        await put('waiting',0);await page.request.patch(dburl(),{headers,data:{hostConnected:true}});const before=JSON.stringify(await read());
        await a.evaluate(value=>sessionStorage.setItem('kaburazuhint_session',value),session);await a.reload();await a.waitForFunction(malformed=>state.currentScreen==='top'&&!state.roomRef&&(malformed||!sessionStorage.getItem('kaburazuhint_session')),session==='{bad');
        assert(JSON.stringify(await read())===before,'invalid session changed DB');await page.request.delete(dburl(),{headers});
        report.cases.push({name:'Invalid/missing guest session '+session,pass:true,method:'synthetic session, real SDK reload',note:session==='{bad'?'Malformed JSON is ignored but existing loadSession leaves raw string; no clear requirement':undefined});
      }
    } else if(step==='spectatorBoundary'){
      const before=JSON.stringify(await read());
      const checkTransport=async()=>{const t=await s.evaluate(()=>window.b31transport);assert(!t.actions.some(x=>['p','m','o','om','oc'].includes(x)),'spectator mutation');return t;};
      const traces=[await checkTransport()];
      await s.reload();await s.waitForFunction(()=>state.role==='spectator'&&state.currentScreen==='spectator');traces.push(await checkTransport());
      assert(JSON.stringify(await read())===before,'spectator reload wrote room');
      for(const suffix of ['?watch=','?watch=INVALID','?watch=ZZZZZZ']){
        await s.evaluate(roomCode=>sessionStorage.setItem('kaburazuhint_session',JSON.stringify({nickname:"ま'ち",roomCode,role:'guest'})),report.room);
        await s.goto(root+suffix);await s.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef&&!sessionStorage.getItem('kaburazuhint_session'));
        traces.push(await checkTransport());assert(JSON.stringify(await read())===before,'invalid watch fell back to guest');
      }
      await s.evaluate(roomCode=>sessionStorage.setItem('kaburazuhint_session',JSON.stringify({nickname:null,roomCode,role:'spectator'})),report.room);
      await s.goto(root);await s.waitForFunction(()=>state.role==='spectator'&&state.currentScreen==='spectator');
      assert(s.url()===root+'?watch='+report.room,'saved spectator canonical URL');traces.push(await checkTransport());
      await s.locator('[onclick="spectatorLeave()"]').first().click();await s.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef);
      assert(s.url()===root&&JSON.stringify(await read())===before,'spectator leave changed DB or URL');traces.push(await checkTransport());
      await s.goto(root+'?watch='+report.room);await s.waitForFunction(()=>state.role==='spectator');
      report.cases.push({name:'Spectator reload, saved restore, empty/invalid/nonexistent watch precedence, explicit leave read-only',pass:true,traces,method:'real URL navigation; synthetic pre-existing guest/spectator session values'});
    } else if(step==='replay'){
      await page.request.patch(dburl(),{headers,data:{status:'result',round:report.uiResult.round,history:report.uiResult.history,gameId:'replay-fixture'}});
      await h.reload();await h.waitForFunction(()=>state.currentScreen==='result');
      const before=await read();await h.locator('body').ariaSnapshot();await h.locator('[onclick="endGame()"]').click();await h.waitForFunction(()=>state.currentScreen==='final');
      await a.context().setOffline(true);await a.waitForTimeout(10000);
      await h.locator('[onclick="playAgain()"]').click();await h.waitForTimeout(200);
      assert((await read()).status==='finished','Offline guest advanced game');
      await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready);
      await h.locator('[onclick="playAgain()"]').click();await h.waitForFunction(()=>state.currentScreen==='clue');
      const after=await read();assert(after.gameId&&after.gameId!==before.gameId,'Replay gameId unchanged');
      assert(after.round.number===1&&!after.history&&!after.round.hints&&!after.round.answer,'Replay state not reset');
      assert(Object.keys(after.players).length===3,'Replay players changed');
      await h.waitForTimeout(21000);assert((await read())?.gameId===after.gameId,'Old finished timer deleted replay');
      await h.reload();await h.waitForFunction(()=>state.currentScreen==='clue'&&state.role==='host');
      await h.context().setOffline(true);await h.waitForTimeout(10000);
      assert((await read()).hostConnected===false,'Host reloaded disconnect reservation missing');
      await h.context().setOffline(false);await h.waitForFunction(()=>state.lastRoom?.hostConnected===true);
      report.cases.push({name:'Replay connected gate, new gameId/reset/presence, old30sec timer cancelled, host reload disconnect reservation',pass:true,method:'real UI replay and browser offline/online; actual31sec since finished'});
    } else if(['doneTimer','doneReload'].includes(step)){
      const current=await read();
      await page.request.patch(dburl(),{headers,data:{status:'result',round:report.uiResult.round,history:report.uiResult.history,gameId:'timer-'+step}});
      await h.waitForFunction(()=>state.currentScreen==='result');await h.reload();await h.waitForFunction(()=>state.currentScreen==='result');await h.locator('body').ariaSnapshot();await h.locator('[onclick="endGame()"]').click();await h.waitForFunction(()=>state.currentScreen==='final');
      const original=Date.now();let start=original;
      if(step==='doneReload'){await h.waitForTimeout(5000);await h.reload();await h.waitForFunction(()=>state.currentScreen==='final');start=Date.now();}
      else {await a.context().setOffline(true);await h.waitForFunction(()=>!Object.keys(state.lastRoom.players["ま'ち"].connections||{}).length);await h.locator('[onclick="playAgain()"]').click();assert((await read()).status==='finished','blocked replay changed status');}
      const finalDOM=await s.locator('#spec-content').innerHTML();
      await b.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef&&!sessionStorage.getItem('kaburazuhint_session'),null,{timeout:40000});
      assert(await read()===null,'Finished timer did not remove room');const elapsed=Date.now()-start;
      await a.context().setOffline(false);await a.waitForFunction(()=>state.currentScreen==='top'&&!state.roomRef&&!sessionStorage.getItem('kaburazuhint_session'));
      assert(elapsed>=29000&&elapsed<35000,'Finished timer not real30sec');
      assert(await s.locator('#spec-content').innerHTML()===finalDOM,'Spectator final changed after room deletion');
      await page.request.put(dburl(),{headers,data:{...current,gameId:'different-new-game',status:'waiting'}});await s.waitForTimeout(300);
      assert(await s.locator('#spec-content').innerHTML()===finalDOM,'Spectator resubscribed same code new game');
      await page.request.delete(dburl(),{headers});
      report.cases.push({name:step+' actual30sec deletion + spectator final retention/unsubscribe',pass:true,elapsedMs:elapsed,totalSinceFinishedMs:Date.now()-original,method:'synthetic result then endGame UI; actual30sec wait, doneTimer tests failed offline replay does not cancel timer; doneReload tests host reload resets timer per current contract'});
    } else if(step.startsWith('phase:')){
      const phase=step.slice(6),screen={'clue-input':'clue','clue-review':'review',answer:'answer',judge:'judge',result:'result',finished:'final'}[phase];
      assert(!!screen,'unknown fixture phase');
      const prior=await read();assert(prior&&prior.host==='host','fixture room missing');
      const round={number:1,totalRounds:3,guesser:"ま'ち",secretWord:'ねこ',hints:{host:{text:'ふわふわ',normalized:'ふわふわ'}},passed:false};
      if(phase!=='clue-input'){round.hints.guestB={text:'除外ヒント',normalized:'じよがいひんと'};round.excludedHintIds=['guestB'];}
      if(['judge','result','finished'].includes(phase))round.answer='別の答え';
      if(['result','finished'].includes(phase))round.isCorrect=true;
      const history=['result','finished'].includes(phase)?{1:{guesser:"ま'ち",secretWord:'ねこ',answer:'別の答え',passed:false,isCorrect:true,hints:{host:'ふわふわ',guestB:'除外ヒント'},normalizedHints:{host:'ふわふわ',guestB:'じよがいひんと'},visibleHints:{host:'ふわふわ'}}}:null;
      await page.request.patch(dburl(),{headers,data:{status:phase,gameId:'fixture-'+phase,round,history,hostConnected:true,hostDisconnectedAt:null}});
      await h.waitForFunction(screen=>state.currentScreen===screen,screen);await a.waitForFunction(screen=>state.currentScreen===screen,screen);
      const stable=room=>JSON.stringify({status:room.status,gameId:room.gameId,round:room.round,history:room.history??null,players:Object.fromEntries(Object.entries(room.players).map(([n,p])=>[n,{isHost:p.isHost,presenceVersion:p.presenceVersion??null}]))});
      const expected=stable(await read());
      await a.reload();await a.waitForFunction(screen=>state.currentScreen===screen&&guestPresence?.ready,screen);
      assert(stable(await read())===expected,'phase data changed after reload');
      report.cases.push({name:phase+' reload retains round/history/player/gameId',pass:true,method:'REST synthetic phase fixture, real SDK reload'});
      for(let cycle=1;cycle<=2;cycle++){
        if(phase==='finished'&&cycle===2){await h.reload();await h.waitForFunction(()=>state.currentScreen==='final');}
        await a.context().setOffline(true);await a.waitForTimeout(10000);
        assert(await a.locator('#guest-off-overlay').isVisible(),'offline guest overlay missing');
        const disconnected=await read();assert(disconnected?.players?.["ま'ち"]&&Object.keys(disconnected.players["ま'ち"].connections||{}).length===0,'disconnected guest missing or active');
        assert(stable(disconnected)===expected,'phase data mutated while disconnected');
        if(phase==='answer')assert(!await h.locator('#answer-host-actions').isVisible(),'temporary guesser disconnect treated as exit');
        await shot(a,`${phase}-offline-guest375-${cycle}`,375);
        await a.context().setOffline(false);await a.waitForFunction(()=>guestPresence?.ready);
        assert(stable(await read())===expected,'phase data mutated on reconnect');
        report.cases.push({name:`${phase} browser offline10sec cycle${cycle} retains data`,pass:true,method:'REST synthetic phase fixture then real browser context offline/online (not SDK goOffline)',note:phase==='finished'?'Host reloaded before second cycle to restart existing30sec timer; separate actual timer test required':undefined});
      }
      await s.waitForTimeout(100);
      const visible=await s.locator('#spec-content').textContent(),html=await s.locator('#spec-content').innerHTML();
      const secretAllowed=['result','finished'].includes(phase);
      assert(secretAllowed||!html.includes('ねこ'),'spectator secret in DOM before result');
      assert(!visible.includes('除外ヒント'),'excluded hint leaked to spectator');
      if(['clue-input','clue-review'].includes(phase))assert(!visible.includes('ふわふわ'),'early hint leaked to spectator');
      if(phase==='answer')assert(visible.includes('ふわふわ'),'confirmed visible hint missing');
      const transport=await s.evaluate(()=>window.b31transport);
      assert(transport.sockets.some(x=>x.startsWith('ws://127.0.0.1:9000/')),'spectator websocket observation absent');
      assert(!transport.actions.some(x=>['p','m','o','om','oc'].includes(x)),'spectator mutation/onDisconnect action');
      report.cases.push({name:phase+' spectator DOM secrecy/read-only transport',pass:true,method:'real native WebSocket.send transparent observation; only action names, no payload',transport,visibleText:visible});
      await shot(s,`${phase}-spectator375`,375);
      if(phase==='finished'){
        // Preserve separate actual30s deletion test: this phase fixture uses ~21s, no claim of30s here.
        await page.request.patch(dburl(),{headers,data:{status:'result'}});await h.waitForFunction(()=>state.currentScreen==='result');
      }
    } else throw Error('Unknown step');
    report.steps.push({step,status:'done',caseCount:report.cases.length,completedAt:new Date().toISOString()});
    return {step,status:'done',room:report.room,cases:report.cases.length};
  } finally {
    listeners.forEach(off=>off());
    await h.evaluate(report=>{window.b31report=report;window.b31running=null;window.b31role='host';},report);
  }
}
const step=process.argv[2];
if(!['guard','setup','fresh','waiting','uiRound','explicitExit','regressions','invalidSessions','ttlBoundary','spectatorBoundary','replay','doneTimer','doneReload'].includes(step)&&!/^phase:(clue-input|clue-review|answer|judge|result|finished)$/.test(step))throw Error('Unknown step');
process.stdout.write(`async page => (${run.toString()})(page,${JSON.stringify(step)})`);
