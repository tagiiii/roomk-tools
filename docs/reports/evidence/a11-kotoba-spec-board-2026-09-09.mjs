import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const appPath='apps/kotoba-tantei/app.js',sharedPath='apps/shared/js/utils.js';
const app=fs.readFileSync(path.join(repo,appPath),'utf8'),shared=fs.readFileSync(path.join(repo,sharedPath),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
assert.equal(sha(app),'b96fc56f8c3836b06a9ca6be6c58db65d812f9e870f9e45102b3f6924c0fcae9');
assert.equal(sha(shared),'533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370');
function extract(s,start,end){assert.equal(s.split(start).length,2);const a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert.ok(b>a);return s.slice(a,b).trim();}
const pieces={
 escape:extract(shared,'export function escapeHtml(str) {','\n/**').replace('export function','function'),
 label:extract(app,'function cardRoleLabel(role) {','\nfunction canRevealCard('),
 project:extract(app,'function toSpecCard(card) {','\nfunction specCardHtml('),
 card:extract(app,'function specCardHtml(card) {','\nfunction renderSpecGame('),
 game:extract(app,'function renderSpecGame(room) {','\n// 観戦で未公開カード'),
 finish:extract(app,'function renderSpecFinish(room) {','\n/* ═'),
 dispatch:extract(app,'function handleSpectatorSnapshot({ exists, room, hasPendingWrites }) {','\n/* ──'),
};
assert.equal((pieces.finish.match(/\$\{boardHtml\}/g)||[]).length,1);
const encode=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(p=pieces){
 const context=vm.createContext({appEl:{innerHTML:''},specState:{},
  specHeaderHtml(){return '';},specTurnBannerHtml(){return '';},renderScoreBoard(){return '';},specHintHtml(){return '';},
  resultSummary(){return {title:'fixture result',detail:'fixture detail'};},isRoomExpired(){return false;},
  stopSpectator(){},renderSpecEnded(){throw Error('outside scope');},renderSpecError(){throw Error('outside scope');},
  renderSpecLobby(){context.appEl.innerHTML='lobby';},renderSpecPending(){context.appEl.innerHTML='pending';},
 });
 vm.runInContext(Object.values(p).join('\n')+'\nconst esc=escapeHtml;',context);
 return {context,project(card){context.card=card;return vm.runInContext('toSpecCard(card)',context);},
  render(cards,phase='in_progress',pending=false){context.snapshot={exists:true,hasPendingWrites:pending,room:{cards,gamePhase:phase}};vm.runInContext('handleSpectatorSnapshot(snapshot)',context);return context.appEl.innerHTML;}};
}
function board(html){const start=html.indexOf('<div class="cn-spec-board"');assert.ok(start>=0);return html.slice(start,html.lastIndexOf('</section>'));}
function checkProjection(h,card){const p=h.project(card);assert.equal(p.revealed,card?.revealed===true);assert.equal(Object.hasOwn(p,'role'),card?.revealed===true,'unrevealed projected object has no role property');assert.equal(p.word,card?.word??'');}
function checkHidden(h,card,phase='in_progress',pending=false){checkProjection(h,card);const html=board(h.render([card],phase,pending));assert.ok(html.includes(encode(card.word)));assert.ok(html.includes('cn-spec-card--hidden'));assert.ok(!html.includes('SECRET_ROLE'),'secret role absent from board string');assert.ok(!html.includes('cn-card-marker'));assert.ok(!html.includes('<button'));}
function checkEscaped(h,card,phase){const html=board(h.render([card],phase,false));assert.ok(html.includes(`<span class="cn-card-word">${encode(card.word)}</span>`),'word escaped at exact text sink');assert.ok(html.includes(`cn-spec-card--${encode(card.role)} `),'role escaped inside class attribute');assert.ok(!html.includes('<img'));assert.ok(!html.includes('" onpointerenter="'),'role cannot break quoted attribute');assert.ok(!html.includes('<button'));}
const results=[];
function test(name,fn){fn();results.push({name,pass:true});}
const hidden={word:'ことば',role:'SECRET_ROLE',revealed:false};
for(const value of [false,undefined,null,0,1,'true','false',{},[]])test(`strict revealed projection and game concealment: ${JSON.stringify(value)}`,()=>checkHidden(harness(),{...hidden,revealed:value}));
test('null projection has empty word and no role',()=>checkProjection(harness(),null));
for(const role of ['red','blue','neutral','assassin'])test(`revealed true retains role ${role}`,()=>{const h=harness(),card={word:'公開',role,revealed:true};checkProjection(h,card);checkEscaped(h,card,'in_progress');});
const attackWord=`word"><img src=x onerror='probe()'>&`,attackRole=`ROLE" onpointerenter="probe()'<> &`;
for(const phase of ['in_progress','finished'])for(const [name,card] of [
 ['word',{word:attackWord,role:'red',revealed:true}],
 ['role',{word:'属性',role:attackRole,revealed:true}],
 ['both',{word:attackWord,role:attackRole,revealed:true}],
])test(`${phase} separate ${name} encoding`,()=>checkEscaped(harness(),card,phase));
test('finished pending writes keeps unrevealed role hidden',()=>checkHidden(harness(),hidden,'finished',true));
test('finished confirmed reveals formerly hidden role',()=>{const html=board(harness().render([hidden],'finished',false));assert.ok(html.includes('cn-spec-card--SECRET_ROLE '));assert.ok(html.includes('cn-card-marker'));assert.ok(!html.includes('cn-spec-card--revealed'));});
test('confirmed finish then pending finish redraw removes secret',()=>{const h=harness();h.render([hidden],'finished',false);checkHidden(h,hidden,'finished',true);});
test('confirmed finish then new game redraw removes old secret',()=>{const h=harness();h.render([hidden],'finished',false);checkHidden(h,hidden,'in_progress',false);});
test('same words with different unrevealed roles have identical board fragments',()=>{const h=harness();assert.equal(board(h.render([hidden])),board(h.render([{...hidden,role:'ANOTHER_SECRET'}])));});
for(const phase of ['in_progress','finished'])test(`${phase} quote-only role remains inside class attribute`,()=>checkEscaped(harness(),{word:'属性',role:'ROLE" onpointerenter="probe()',revealed:true},phase));
for(const phase of ['in_progress','finished'])test(`${phase} empty array`,()=>{assert.ok(!board(harness().render([],phase)).includes('class="cn-spec-card '));});
test('unknown phase does not render board',()=>{assert.equal(harness().render([hidden],'unrecognized'),'pending');});
const mutants=[
 ['game word escape','card','esc(card.word)','card.word',h=>checkEscaped(h,{word:attackWord,role:'red',revealed:true},'in_progress')],
 ['game role escape','card','esc(card.role)','card.role',h=>checkEscaped(h,{word:'属性',role:attackRole,revealed:true},'in_progress')],
 ['finish word escape','finish','esc(card.word)','card.word',h=>checkEscaped(h,{word:attackWord,role:'red',revealed:false},'finished')],
 ['finish role escape','finish','esc(card.role)','card.role',h=>checkEscaped(h,{word:'属性',role:attackRole,revealed:false},'finished')],
 ['hidden projection role removal','project','{ word, revealed: false }','{ word, revealed: false, role: card.role }',h=>checkHidden(h,hidden)],
 ['strict revealed comparison','project','card?.revealed === true','card?.revealed',h=>checkHidden(h,{...hidden,revealed:'true'})],
 ['pending-write finish gate','dispatch','if (hasPendingWrites) return renderSpecGame(room);','if (false) return renderSpecGame(room);',h=>checkHidden(h,hidden,'finished',true)],
];
for(const [name,key,from,to,check] of mutants)test(`negative control detected: ${name}`,()=>{assert.ok(pieces[key].includes(from));const mutated={...pieces,[key]:pieces[key].replace(from,to)};assert.throws(()=>check(harness(mutated)),e=>e.code==='ERR_ASSERTION');});
console.log(JSON.stringify({schemaVersion:1,scope:'kotoba-tantei spectator boardHtml at renderSpecFinish and related projection/game/finished pending-write dispatch',sourcePath:appPath,sourceSha256:sha(app),sharedPath,sharedSha256:sha(shared),extractedSha256:Object.fromEntries(Object.entries(pieces).map(([k,v])=>[k,sha(v)])),caseCount:results.length,results,limitations:[
 'Pure Node VM with plain-object fixtures and HTML-string assertions, not a browser parser, DOM, event or script-execution test.',
 'Actual handleSpectatorSnapshot dispatch is extracted, but exists=true and expiry=false are fixtures. Metadata delivery and real subscription are not executed.',
 'Header, turn banner, score board, hint and result summary are stubs. Other HTML sinks, game UI, expiry, deletion, session isolation and whole-application write-zero behavior are outside scope.',
 'Projection-role-removal mutant is rejected by the object-contract assertion; revealed=false still has a separate renderer guard, so this mutant alone is not claimed to leak into HTML.',
 'Unknown role strings are tested for quoted-attribute encoding, not enum validation or valid CSS semantics; spaces can still add class tokens after HTML escaping. Malformed card arrays/schema acceptance are not certified.',
 'No network, Firebase SDK, browser or production operations. App/scanner/shared files unchanged. A-11 unknown references are not reclassified safe.',
]},null,2));
