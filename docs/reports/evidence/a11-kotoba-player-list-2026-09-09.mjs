import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const repo = path.resolve(process.argv[2] || process.cwd());
const appPath = 'apps/kotoba-tantei/app.js';
const sharedPath = 'apps/shared/js/utils.js';
const app = fs.readFileSync(path.join(repo, appPath), 'utf8');
const shared = fs.readFileSync(path.join(repo, sharedPath), 'utf8');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const sourceSha256 = sha(app), sharedSha256 = sha(shared);
assert.equal(sourceSha256, 'b96fc56f8c3836b06a9ca6be6c58db65d812f9e870f9e45102b3f6924c0fcae9');
assert.equal(sharedSha256, '533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370');
function slice(source, start, end) {
  assert.equal(source.split(start).length, 2, `unique start: ${start}`);
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(to > from, `end: ${end}`);
  return source.slice(from, to).trim();
}
const extracted = {
  lobby: slice(app, 'function renderLobby() {', '\nfunction renderSpectatorShareControls('),
  labels: slice(app, 'function teamLabel(team) {', '\nfunction resultSummary('),
  row: slice(app, 'function renderLobbyPlayer(player, canEditAssignments) {', '\nfunction renderPlayerControls('),
  controls: slice(app, 'function renderPlayerControls(player) {', '\nfunction renderStartConditions('),
  spectator: slice(app, 'function renderSpecLobby(room) {', '\nfunction specTurnBannerHtml('),
  escape: slice(shared, 'export function escapeHtml(str) {', '\n/**').replace('export function', 'function'),
};
assert.equal((extracted.lobby.match(/\$\{playerList\}/g) || []).length, 1);
assert.equal((extracted.spectator.match(/\$\{playerList\}/g) || []).length, 1);
// Independent string-context oracle; this does not use the implementation escape helper.
const encode = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode = value => value.replace(/&(?:amp|lt|gt|quot|#39);/g, e => ({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'"}[e]));
const results = [];
function render(players, editable, loading, pieces = extracted) {
  const context = vm.createContext({
    state: { roomId:'ABCDEF', playerId:'viewer', loading, room:{gamePhase:'lobby', players:[{id:'viewer',name:'閲覧者',isHost:editable,team:'red',role:'guesser'}, ...players]} },
    specState:{roomId:'ABCDEF'}, appEl:{innerHTML:''},
    ensureRoomSubscription(){}, canStart(){return false;}, renderStartConditions(){return '';},
    renderSpectatorShareControls(){return '';}, specHeaderHtml(){return '';},
    navigate(){throw Error('Unexpected navigation');}, restoreSession(){throw Error('Unexpected session access');},
  });
  vm.runInContext(Object.values(pieces).join('\n') + '\nconst esc=escapeHtml;', context);
  vm.runInContext('renderLobby()', context);
  const normal = context.appEl.innerHTML;
  context.fixture = {players};
  vm.runInContext('renderSpecLobby(fixture)', context);
  const spectator = context.appEl.innerHTML;
  const list = html => {const match=html.match(/<ul class="cn-player-list">([\s\S]*?)<\/ul>/); assert.ok(match);return match[1];};
  return {normal:list(normal), spectator:list(spectator)};
}
function inspect(output, players, editable, loading) {
  for (const p of players) {
    for(const html of Object.values(output)) {
      assert.ok(html.includes(encode(p.name)), 'encoded name retained in list text');
      assert.ok(!html.includes('<img'), 'injected image tag absent');
      assert.ok(!html.includes('<script'), 'injected script tag absent');
      assert.ok(html.includes(`${p.team === 'blue' ? '青チーム':'赤チーム'} / ${p.role === 'spymaster' ? 'ヒント役':'探す役'}`));
      if(p.team === 'TEAM_UNTRUSTED<>"&') assert.ok(!html.includes('TEAM_UNTRUSTED'));
      if(p.role === 'ROLE_UNTRUSTED<>"&') assert.ok(!html.includes('ROLE_UNTRUSTED'));
    }
    if(editable) {
      const ids = [...output.normal.matchAll(/data-player-id="([^"]*)"/g)].map(m=>decode(m[1]));
      assert.equal(ids.filter(id=>id===String(p.id)).length, 4, 'four fully quoted assignment IDs round-trip');
      const removes=[...output.normal.matchAll(/data-remove-player-id="([^"]*)"/g)].map(m=>decode(m[1]));
      assert.equal(removes.filter(id=>id===String(p.id)).length, p.isHost?0:1, 'remove ID round-trip, host excluded');
    }
  }
  assert.equal((output.spectator.match(/<button\b/g)||[]).length,0);
  assert.equal((output.spectator.match(/data-(?:player|remove-player)-id=/g)||[]).length,0);
  if(!editable)assert.equal((output.normal.match(/<button\b/g)||[]).length,0);
  else {
    const buttons=[...output.normal.matchAll(/<button\b([\s\S]*?)>/g)];
    for(const [,attrs] of buttons) assert.equal(/\bdisabled\b/.test(attrs),loading);
    for(const [,team] of output.normal.matchAll(/data-team="([^"]*)"/g))assert.ok(['red','blue'].includes(team));
    for(const [,role] of output.normal.matchAll(/data-role="([^"]*)"/g))assert.ok(['spymaster','guesser'].includes(role));
  }
}
const payload = `x"><img src=x onerror='probe()'>&<script>probe()</script>`;
const fixtures = [
  {id:'plain-id',name:'普通',team:'red',role:'guesser',isHost:false},
  {id:"id'&\"<>",name:"ま'ち & < > \"",team:'blue',role:'spymaster',isHost:false},
  {id:payload,name:payload,team:payload,role:payload,isHost:false},
  {id:'other-host',name:'ホスト',team:'blue',role:'guesser',isHost:true},
  {id:'name-only-id',name:payload,team:'red',role:'guesser',isHost:false},
  {id:payload+'id-only',name:'属性だけ',team:'blue',role:'guesser',isHost:false},
  {id:'enum-only-id',name:'列挙だけ',team:'TEAM_UNTRUSTED<>"&',role:'ROLE_UNTRUSTED<>"&',isHost:false},
];
for(const editable of [false,true])for(const loading of [false,true])for(const player of fixtures){
  inspect(render([player],editable,loading),[player],editable,loading);
  results.push({name:`list fixture ${fixtures.indexOf(player)} editable=${editable} loading=${loading}`,pass:true});
}
inspect(render(fixtures,true,false),fixtures,true,false);
results.push({name:'mixed seven-player fixture array reaches both exact list sinks (not count validation)',pass:true});
const empty=render([],false,false);assert.equal(empty.spectator.trim(),'');
results.push({name:'empty spectator array emits empty list',pass:true});
const mutations=[
  ['normal-name','row','esc(player.name)','player.name'],
  ['spectator-name','spectator','esc(player.name)','player.name'],
  ['remove-id','row','esc(player.id)','player.id'],
  ['one-assignment-id','controls','esc(player.id)','player.id'],
];
for(const [name,key,from,to] of mutations){
  assert.ok(extracted[key].includes(from));
  const mutant={...extracted,[key]:extracted[key].replace(from,to)};
  let caught;
  try {inspect(render([fixtures[2]],true,false,mutant),[fixtures[2]],true,false);}catch(error){caught=error;}
  assert.equal(caught?.code,'ERR_ASSERTION',`${name} must fail the same positive assertion oracle`);
  results.push({name:`partial escape removal rejected: ${name}`,pass:true,detectedBy:caught.message});
}
console.log(JSON.stringify({schemaVersion:1,scope:'kotoba-tantei normal and spectator playerList HTML generation only',sourcePath:appPath,sourceSha256,sharedPath,sharedSha256,extractedSha256:Object.fromEntries(Object.entries(extracted).map(([k,v])=>[k,sha(v)])),caseCount:results.length,results,limitations:[
  'Node VM string generation with fixed plain-object fixtures; no browser HTML parser, DOM events, script execution or proof of browser non-execution.',
  'No Firestore, Firebase SDK, network, production, browser or session integration executed. Subscription/navigation/start conditions/share/header are bounded stubs.',
  'Labels and controls are real extracted code; arbitrary team/role map to existing fixed labels and options. Invalid type/schema acceptance is not assessed.',
  'Raw list composition references are checked only for these sinks and fixtures, not all A-11 references. No unknown reference is reclassified safe.',
  'Board HTML, game UI, authorization, handler behavior and participant count acceptance are outside this test; unlike prior lobby-length work, count interpolation is not the subject.',
  'Mutation controls alter one escape call in memory only; actual app/shared files are unchanged.',
]},null,2));
