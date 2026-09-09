import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const sourcePath='apps/jinro/index.html',sharedPath='apps/shared/js/rtdb-utils.js';
const source=fs.readFileSync(path.join(repo,sourcePath),'utf8'),shared=fs.readFileSync(path.join(repo,sharedPath),'utf8');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
assert.equal(sha(source),'0c4b0515a94f86e20c5a3a6be645c3900deff1c2fbf64fed4d98af6ec93dd1c5');
assert.equal(sha(shared),'77d414a84d39deb52e1c8544e26465d4b822041621dbd985cad804e36d3b1d12');
function extract(s,start,end){assert.equal(s.split(start).length,2);const a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert.ok(b>a);return s.slice(a,b).trim();}
const render=extract(source,'function showTieBreak(candidates) {','\n// 決選投票：');
const escape=extract(shared,'  function esc(value) {','\n  function ');
assert.equal((render.match(/\$\{names\}/g)||[]).length,1);
const encode=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function harness(code=render,missingLabel=false){
 const nodes=new Map();const calls=[];
 function node(id){if(id==='tiebreak-label'&&missingLabel)return null;if(!nodes.has(id))nodes.set(id,{style:{},textContent:'old',innerHTML:'',onclick:null});return nodes.get(id);}
 const context=vm.createContext({document:{getElementById:node},startRunoff:candidates=>calls.push({kind:'runoff',candidates}),skipExecution:(...args)=>calls.push({kind:'skip',args})});
 vm.runInContext(escape+'\n'+code,context);
 return {nodes,calls,node,draw(candidates){context.candidates=candidates;vm.runInContext('showTieBreak(candidates)',context);}};
}
function verify(h,candidates){
 const beforeDraw=h.calls.length;
 h.draw(candidates);
 assert.equal(h.calls.length,beforeDraw,'drawing does not call action stubs');
 assert.equal(h.node('tiebreak-panel').style.display,'block');
 if(h.node('tiebreak-label'))assert.equal(h.node('tiebreak-label').textContent,'同票です。どうしますか？（GM）');
 const html=h.node('tiebreak-btns').innerHTML;
 const match=html.match(/<p style="[^"]*">([\s\S]*?)<\/p>/);assert.ok(match);
 assert.equal(match[1],candidates.map(encode).join('・')+'の中からもう一度投票します','all candidate names escaped in original order at exact text sink');
 assert.equal((html.match(/<button\b/g)||[]).length,2);
 assert.ok(!html.includes('<img'));assert.ok(!html.includes('<script'));
 assert.ok(html.includes('id="tb-runoff"'));assert.ok(html.includes('id="tb-skip"'));
 const before=h.calls.length;
 h.node('tb-runoff').onclick();h.node('tb-skip').onclick();
 assert.equal(h.calls.length,before+2,'one recorded call per current onclick property');
 assert.equal(h.calls[before].kind,'runoff');assert.strictEqual(h.calls[before].candidates,candidates,'original candidate array passed unchanged');
 assert.deepEqual(h.calls[before+1],{kind:'skip',args:[]});
}
const results=[];const test=(name,fn)=>{fn();results.push({name,pass:true});};
const payload=`x"><img src=x onerror='probe()'>&<script>probe()</script>`;
const fixtures=[['普通'],["ま'ち"],['"&<>\''],[payload],['先頭',payload,'末尾'],[payload,'普通',payload],[],['&amp; &lt; &#39;']];
fixtures.forEach((c,i)=>test(`candidate fixture ${i}`,()=>verify(harness(),c)));
test('repeated drawing replaces HTML and current onclick closure',()=>{const h=harness();verify(h,[payload,'旧候補']);verify(h,['新候補',"ま'ち"]);assert.ok(!h.node('tiebreak-btns').innerHTML.includes('旧候補'));});
test('missing optional label does not block render or wiring',()=>verify(harness(render,true),['普通',payload]));
for(const [name,replacement] of [
 ['all escape removed','candidates.map(value => value)'],
 ['only second candidate escape removed','candidates.map((value,index) => index === 1 ? value : esc(value))'],
])test(`negative control detected: ${name}`,()=>{assert.ok(render.includes('candidates.map(esc)'));const mutant=render.replace('candidates.map(esc)',replacement);assert.throws(()=>verify(harness(mutant),['普通',payload,'末尾']),e=>e.code==='ERR_ASSERTION');});
test('negative control detected: escaped array passed to runoff',()=>{const mutant=render.replace('startRunoff(candidates)','startRunoff(candidates.map(esc))');assert.notEqual(mutant,render);assert.throws(()=>verify(harness(mutant),[payload]),e=>e.code==='ERR_ASSERTION');});
console.log(JSON.stringify({schemaVersion:1,scope:'jinro showTieBreak names HTML text sink and direct onclick wiring only',sourcePath,sourceSha256:sha(source),sharedPath,sharedSha256:sha(shared),extractedSha256:{showTieBreak:sha(render),esc:sha(escape)},normalCount:10,negativeCount:3,caseCount:results.length,results,limitations:[
 'Minimal document objects do not parse innerHTML or create real buttons. IDs are lazily provisioned; onclick assignment and invocation are tested as JavaScript properties only.',
 'String assertions are not browser DOM parsing, event lifecycle or proof of script non-execution. Repeated-render checks cover current property replacement, not detached DOM listeners.',
 'startRunoff and skipExecution are call-recording stubs. Actual vote tally, role authorization, DB operations, timing and whole-game behavior are outside scope.',
 'Fixed string candidate arrays, including empty, are renderer fixtures, not certification that upstream accepts these names or an empty tie.',
 'Candidate closure retains the original array reference, not a copy; delayed caller-side array mutation resistance is not claimed.',
 'No network, browser, SDK or production access. App/scanner/shared files unchanged; no A-11 unknown reference is classified safe.',
]},null,2));
