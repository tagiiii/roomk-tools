// Fixed-source property captures only: no browser, SDK, network or app changes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
assert(process.argv.slice(2).every(arg => arg === '--baseline'));
const sourceCommit = 'e7d04d3c049186267b803cad55c60d83edafab01';
const digest = text => createHash('sha256').update(text).digest('hex');
const sources = [
  ['apps/kakure-number/index.html', '62bd802b79e03bfbab08013b42a649d8f7cf968cd1702b0e9fb2c220e477155b'],
  ['apps/shared/js/rtdb-utils.js', '77d414a84d39deb52e1c8544e26465d4b822041621dbd985cad804e36d3b1d12'],
].map(([file, sha256]) => {
  const baseline = execFileSync('git', ['show', `${sourceCommit}:${file}`], { cwd: root, encoding: 'utf8' });
  const text = process.argv.includes('--baseline') ? baseline : readFileSync(root + file, 'utf8');
  assert.equal(digest(text), sha256, `Source changed: ${file}`);
  assert.equal(text, baseline);
  return { file, sha256, text };
});
const extractions = [];
function extract(source, header, firstLine) {
  const lines = source.text.split('\n');
  assert.equal(lines.filter(line => line === header).length, 1);
  assert.equal(lines[firstLine - 1], header);
  const last = lines.findIndex((line, index) => index >= firstLine && line === '  }');
  assert(last >= firstLine);
  const code = lines.slice(firstLine - 1, last + 1).join('\n');
  extractions.push({ file: source.file, firstLine, lastLine: last + 1, sha256: digest(code) });
  return code;
}
const gridCode = extract(sources[0], '  function renderNumberGrid(numbers, hasField) {', 1254);
const revealCode = extract(sources[0], '  function handleReveal(room) {', 1276);
const scoreCode = extract(sources[0], '  function renderScoreChips(containerId, players) {', 1340);
const escapeCode = extract(sources[1], '  function esc(value) {', 45);
const thinkingCode = extract(sources[0], '  function handleThinking(room) {', 1163);
const renderer = [gridCode, revealCode, scoreCode].join('\n');
assert(!/\b(?:firebase|fetch|XMLHttpRequest|WebSocket|sessionStorage|localStorage|require|import)\b/.test(renderer + escapeCode + thinkingCode));
const marker = '<b data-a11-kakure="1">名\'&</b>';
// Deliberately fixed oracle, independent of the extracted escape helper.
const encoded = '&lt;b data-a11-kakure=&quot;1&quot;&gt;名&#39;&amp;&lt;/b&gt;';
const cases = [
  { id: 'grid-self-hidden', grid: { self: marker }, hasField: false, includes: ['（あなた）', '__value">？</div>'], excludes: [encoded, '隠しカード'] },
  { id: 'grid-other-number', grid: { other: 7 }, hasField: false, includes: ['__value">7</div>'], excludes: ['（あなた）', '隠しカード'] },
  { id: 'grid-other-html', grid: { other: marker }, hasField: true, includes: [encoded, '隠しカード'], excludes: ['（あなた）'] },
  { id: 'grid-name-html', grid: { [marker]: 5 }, includes: [encoded, '__value">5</div>'] },
  { id: 'grid-empty-field', grid: {}, hasField: true, includes: ['隠しカード', '__value">？</div>'] },
  { id: 'grid-empty', grid: {}, includes: [], exact: '' },
  { id: 'reveal-empty', room: {}, includes: [], exact: '', roundText: '1', totalText: '-' },
  { id: 'reveal-field-html', room: { round: { fieldNumber: marker } }, includes: [encoded, '隠しカード'] },
  { id: 'reveal-field-zero', room: { round: { fieldNumber: 0 } }, includes: ['__number">0</div>', '隠しカード'] },
  { id: 'reveal-field-null', room: { round: { fieldNumber: null } }, includes: [], exact: '' },
  { id: 'reveal-missing-guess', room: { round: { numbers: { self: 5 } }, players: { self: { score: 2 } } }, includes: ['よそうなし', '（あなた）'], excludes: ['（退出）'], scoreIncludes: ['self 2pt'] },
  { id: 'reveal-zero-guess', guess: 0, includes: ['よそう <strong>0</strong>'], excludes: ['よそうなし'] },
  { id: 'reveal-null-guess', guess: null, includes: ['よそう <strong>null</strong>'], excludes: ['よそうなし'] },
  { id: 'reveal-html-guess', guess: marker, includes: [`よそう <strong>${encoded}</strong>`] },
  { id: 'reveal-number-name-html', room: { round: { numbers: { [marker]: marker } }, players: { [marker]: { score: marker } } }, includes: [`__number">${encoded}</div>`, `__name">${encoded}`], scoreIncludes: [`${encoded} 0pt`] },
  { id: 'reveal-left', room: { round: { numbers: { other: 5 } } }, includes: ['（退出）'], excludes: ['（あなた）'] },
  { id: 'reveal-delta-zero', delta: 0, includes: [], excludes: ['ぴったり +3', 'いちばん近い +2', 'kkn-reveal-row--closest'] },
  { id: 'reveal-delta-two', delta: 2, includes: ['いちばん近い +2', 'kkn-reveal-row--closest'], excludes: ['ぴったり +3'] },
  { id: 'reveal-delta-three', delta: 3, role: 'host', includes: ['ぴったり +3', 'kkn-reveal-row--closest'], excludes: ['いちばん近い +2'] },
  { id: 'reveal-delta-html', delta: marker, includes: [], excludes: [encoded, 'ぴったり +3', 'いちばん近い +2'] },
  { id: 'reveal-text-only-and-scores', role: 'host', currentScreen: 'reveal', room: { round: { number: marker, total: marker }, players: { host: { isHost: true, score: 99 }, self: { score: '2' }, other: { score: 0 }, empty: null } }, includes: [], exact: '', roundText: marker, totalText: marker, scoreIncludes: ['self 2pt', 'other 0pt'], scoreExcludes: ['host', '99pt', 'empty'] },
];
function run(test, code = renderer) {
  const elements = new Map(['thinking-number-grid', 'reveal-round-num', 'reveal-total', 'reveal-list', 'reveal-score-chips', 'reveal-host-actions', 'reveal-guest-waiting'].map(id => [id, { innerHTML: 'before', textContent: '', style: { display: 'initial' } }]));
  const writes = [];
  for (const [id, el] of elements) {
    let html = el.innerHTML, text = el.textContent;
    Object.defineProperties(el, {
      innerHTML: { get: () => html, set: value => { assert.equal(typeof value, 'string'); html = value; writes.push({ id, property: 'innerHTML', value }); } },
      textContent: { get: () => text, set: value => { text = String(value); writes.push({ id, property: 'textContent', value: text }); } },
    });
  }
  const room = test.room || { round: { numbers: { other: 5 }, guesses: { other: test.guess }, scoreDeltas: { other: test.delta } }, players: { other: { score: 0 } } };
  const input = JSON.parse(JSON.stringify({ state: { nickname: 'self', role: test.role || 'guest', currentScreen: test.currentScreen || 'thinking' }, room, numbers: test.grid || {}, hasField: !!test.hasField }));
  const screens = [];
  const context = vm.createContext({ ...input, showScreen(id) { assert.equal(id, 'reveal'); screens.push(id); input.state.currentScreen = id; }, document: { getElementById(id) { assert(elements.has(id), `Unexpected DOM: ${id}`); return elements.get(id); } } }, { codeGeneration: { strings: false, wasm: false } });
  const call = test.grid ? 'renderNumberGrid(numbers, hasField);' : 'handleReveal(room);';
  new vm.Script(escapeCode + '\n' + code + '\n' + call).runInContext(context, { timeout: 1000 });
  return { html: elements.get(test.grid ? 'thinking-number-grid' : 'reveal-list').innerHTML, scoreHtml: elements.get('reveal-score-chips').innerHTML,
    roundText: elements.get('reveal-round-num').textContent, totalText: elements.get('reveal-total').textContent,
    host: elements.get('reveal-host-actions').style.display, guest: elements.get('reveal-guest-waiting').style.display, screens, writes };
}
function verify(test, output) {
  for (const write of output.writes.filter(item => item.property === 'innerHTML')) assert(!write.value.includes(marker), `${test.id}: raw marker reached HTML`);
  for (const text of test.includes) assert(output.html.includes(text), `${test.id}: missing ${text}`);
  for (const text of test.excludes || []) assert(!output.html.includes(text), `${test.id}: unexpected ${text}`);
  if (test.exact !== undefined) assert.equal(output.html, test.exact);
  for (const text of test.scoreIncludes || []) assert(output.scoreHtml.includes(text));
  for (const text of test.scoreExcludes || []) assert(!output.scoreHtml.includes(text));
  if (test.grid) {
    assert(output.writes.every(item => item.id === 'thinking-number-grid'));
    assert.deepEqual(output.screens, []);
    assert.equal(output.writes.length, 1 + Object.keys(test.grid).length + Number(!!test.hasField));
  } else {
    assert.equal(output.host, test.role === 'host' ? 'block' : 'none');
    assert.equal(output.guest, test.role === 'host' ? 'none' : 'block');
    assert.deepEqual(output.screens, test.currentScreen === 'reveal' ? [] : ['reveal']);
    assert.equal(output.roundText, test.roundText ?? '1');
    assert.equal(output.totalText, test.totalText ?? '-');
    assert(output.writes.some(item => item.id === 'reveal-score-chips'));
  }
}
const results = cases.map(test => { const output = run(test); verify(test, output); return { case: test.id, result: 'PASS', ...output }; });
const negativeControls = [];
for (const [id, needle, replacement] of [
  ['grid-other-html', "isMe ? '？' : esc(String(value))", "isMe ? '？' : String(value)"],
  ['reveal-html-guess', 'esc(String(guess))', 'String(guess)'],
  ['reveal-field-html', 'esc(String(round.fieldNumber))', 'String(round.fieldNumber)'],
  ['reveal-number-name-html', 'esc(String(numbers[name]))', 'String(numbers[name])'],
  ['grid-name-html', '${esc(name)}${isMe', '${name}${isMe'],
]) {
  assert.equal(renderer.split(needle).length - 1, 1);
  const mutated = renderer.replace(needle, replacement);
  assert.equal(mutated.replace(replacement, needle), renderer);
  const test = cases.find(item => item.id === id);
  const output = run(test, mutated);
  assert(output.html.includes(marker));
  assert.throws(() => verify(test, output), /raw marker reached HTML/);
  negativeControls.push({ case: id, change: `${needle} -> ${replacement}`, samePredicateRejected: true });
}
// Host-only real handleThinking execution, kept separate to preserve prior results.
const secret = '<i data-a11-secret="1">秘密</i>';
const encodedSecret = '&lt;i data-a11-secret=&quot;1&quot;&gt;秘密&lt;/i&gt;';
const hostCases = [
  { id: 'host-done', players: { other: {} }, guesses: { other: 0 }, status: ['きめた'], count: '1 人 / 1 人がきめた', disabled: false, triggers: 1 },
  { id: 'host-undone', players: { other: {} }, status: ['考え中…'], count: '0 人 / 1 人がきめた', disabled: true, triggers: 0 },
  { id: 'host-gone', players: {}, status: ['退出中'], count: '0 人 / 1 人がきめた', disabled: true, triggers: 0 },
  { id: 'host-gone-done-priority', players: {}, guesses: { other: 8 }, status: ['きめた'], count: '1 人 / 1 人がきめた', disabled: false, triggers: 1 },
  { id: 'host-html-name-hidden-values', numbers: { [marker]: secret }, players: { [marker]: {} }, guesses: { [marker]: secret }, status: ['きめた'], count: '1 人 / 1 人がきめた', disabled: false, triggers: 1, encodedName: true },
  { id: 'host-empty', numbers: {}, players: {}, status: [], count: '0 人 / 0 人がきめた', disabled: true, triggers: 0 },
  { id: 'host-null-guess', players: { other: {} }, guesses: { other: null }, status: ['きめた'], count: '1 人 / 1 人がきめた', disabled: false, triggers: 1 },
  { id: 'host-partial-close', numbers: { other: secret, second: 7 }, players: { other: {}, second: {} }, guesses: { other: 5 }, status: ['きめた', '考え中…'], count: '1 人 / 2 人がきめた', disabled: false, triggers: 0, hint: 'まだの 1 人を待たずに進めます' },
  { id: 'host-already-triggered', players: { other: {} }, guesses: { other: 5 }, guarded: true, status: ['きめた'], count: '1 人 / 1 人がきめた', disabled: true, triggers: 0 },
  { id: 'host-repeat-auto-boundary', players: { other: {} }, guesses: { other: 5 }, repeat: true, status: ['きめた'], count: '1 人 / 1 人がきめた', disabled: true, triggers: 1 },
];
function runHost(test, code = thinkingCode) {
  const elements = new Map(['thinking-round-num', 'thinking-guest', 'thinking-host', 'host-submit-count', 'host-submit-list', 'btn-close-round', 'host-close-hint'].map(id => [id, { innerHTML: 'before', textContent: '', disabled: null, style: { display: 'initial' } }]));
  const writes = [];
  for (const [id, element] of elements) {
    for (const property of ['innerHTML', 'textContent']) {
      let saved = element[property];
      Object.defineProperty(element, property, { get: () => saved, set: value => { saved = String(value); writes.push({ id, property, value: saved }); } });
    }
  }
  const input = JSON.parse(JSON.stringify({ state: { nickname: 'host', role: 'host', currentScreen: 'thinking', lastRoundNumber: 1, revealTriggered: !!test.guarded },
    room: { round: { number: 1, numbers: test.numbers ?? { other: secret }, guesses: test.guesses || {}, fieldNumber: secret, total: secret }, players: test.players } }));
  let triggers = 0;
  const context = vm.createContext({ ...input, document: { getElementById(id) { assert(elements.has(id), `Unexpected host DOM: ${id}`); return elements.get(id); } },
    showScreen() { assert.fail('Unexpected screen reset'); }, hideError() { assert.fail('Unexpected round reset'); },
    triggerReveal(room) { assert.equal(room, input.room); triggers++; return Promise.resolve(); },
  }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(escapeCode + '\n' + code + '\nhandleThinking(room);' + (test.repeat ? '\nhandleThinking(room);' : '')).runInContext(context, { timeout: 1000 });
  return { html: elements.get('host-submit-list').innerHTML, count: elements.get('host-submit-count').textContent,
    hint: elements.get('host-close-hint').textContent, disabled: elements.get('btn-close-round').disabled,
    host: elements.get('thinking-host').style.display, guest: elements.get('thinking-guest').style.display,
    triggers, revealTriggered: input.state.revealTriggered, writes };
}
function verifyHost(test, output) {
  for (const write of output.writes) {
    assert(!write.value.includes(secret), `${test.id}: secret reached host display`);
    assert(!write.value.includes(encodedSecret), `${test.id}: escaped secret reached host display`);
    if (write.property === 'innerHTML') assert(!write.value.includes(marker), `${test.id}: raw marker reached HTML`);
  }
  const statuses = [...output.html.matchAll(/(?:>きめた<|>退出中<|>考え中…<)/g)].map(match => match[0].slice(1, -1));
  assert.deepEqual(statuses, test.status);
  if (test.encodedName) assert(output.html.includes(encoded));
  assert.equal(output.count, test.count);
  assert.equal(output.disabled, test.disabled);
  assert.equal(output.triggers, test.triggers);
  assert.equal(output.revealTriggered, !!test.guarded || test.triggers > 0);
  assert.equal(output.host, 'block'); assert.equal(output.guest, 'none');
  if (test.hint) assert.equal(output.hint, test.hint);
  assert(output.writes.filter(item => item.property === 'innerHTML').every(item => item.id === 'host-submit-list'));
}
const hostResults = hostCases.map(test => { const output = runHost(test); verifyHost(test, output); return { case: test.id, result: 'PASS', ...output }; });
const hostNeedle = '${esc(name)}', hostReplacement = '${name}';
assert.equal(thinkingCode.split(hostNeedle).length - 1, 1);
const hostMutated = thinkingCode.replace(hostNeedle, hostReplacement);
assert.equal(hostMutated.replace(hostReplacement, hostNeedle), thinkingCode);
const hostNegativeCase = hostCases.find(test => test.encodedName);
const hostNegativeOutput = runHost(hostNegativeCase, hostMutated);
assert(hostNegativeOutput.html.includes(marker));
assert.throws(() => verifyHost(hostNegativeCase, hostNegativeOutput), /raw marker reached HTML/);
const hostNegativeControls = [{ case: hostNegativeCase.id, change: `${hostNeedle} -> ${hostReplacement}`, samePredicateRejected: true }];
console.log(JSON.stringify({ date: '2026-09-08', sourceCommit, result: 'PASS', sources: sources.map(({ file, sha256 }) => ({ file, sha256 })), extractions,
  checks: { cases: results.length, negativeControls: negativeControls.length }, results, negativeControls,
  hostChecks: { cases: hostResults.length, negativeControls: hostNegativeControls.length }, hostResults, hostNegativeControls,
  limitations: ['Actual renderNumberGrid, handleReveal, renderScoreChips, host branch of handleThinking and shared esc; listener, guest caller, new-round reset and showScreen internals are not executed.',
    'Host inputs fix currentScreen thinking and lastRoundNumber equal to round number; triggerReveal is a counted resolved-Promise stub, not real gameplay or DB logic.',
    'Synthetic JSON records and scalar values only, DOM property capture; no HTML parsing or browser script execution.',
    'No SDK, network, Firebase, iPhone, user data, event handlers or gameplay transitions.',
    'Malformed object/proxy values and real DB write permissions are outside scope; UI hiding is not access control.',
    'App and scanner unchanged; static unknown count is not reduced.'],
}, null, 2));
