// Fixed-source renderer evidence; no SDK, browser, network or app modification.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
assert(process.argv.slice(2).every(arg => arg === '--baseline'));
const baselineOnly = process.argv.includes('--baseline');
const sourceCommit = '0e12145510f2fa6eb2e7066d14dd6cf35bd5b270';
const digest = text => createHash('sha256').update(text).digest('hex');
const sources = [
  ['apps/jinro/index.html', '0c4b0515a94f86e20c5a3a6be645c3900deff1c2fbf64fed4d98af6ec93dd1c5'],
  ['apps/shared/js/rtdb-utils.js', '77d414a84d39deb52e1c8544e26465d4b822041621dbd985cad804e36d3b1d12'],
].map(([file, sha256]) => {
  const baseline = execFileSync('git', ['show', `${sourceCommit}:${file}`], { cwd: root, encoding: 'utf8' });
  const text = baselineOnly ? baseline : readFileSync(root + file, 'utf8');
  assert.equal(digest(text), sha256, `Source changed: ${file}`);
  assert.equal(text, baseline);
  return { file, sha256, text };
});
const extractions = [];
function extract(source, header, firstLine, closing) {
  const lines = source.text.split('\n');
  assert.equal(lines.filter(line => line === header).length, 1);
  assert.equal(lines[firstLine - 1], header);
  const last = lines.findIndex((line, index) => index >= firstLine && line === closing);
  assert(last >= firstLine);
  const code = lines.slice(firstLine - 1, last + 1).join('\n');
  extractions.push({ file: source.file, firstLine, lastLine: last + 1, sha256: digest(code) });
  return code;
}
const renderer = extract(sources[0], 'function setupNightActionUI(room, players) {', 1432, '}');
const escapeCode = extract(sources[1], '  function esc(value) {', 45, '  }');
assert(!/\b(?:firebase|fetch|XMLHttpRequest|WebSocket|sessionStorage|localStorage|require|import)\b/.test(renderer + escapeCode));
const marker = '<b data-a11-night="1">名\'&</b>';
const encoded = '&lt;b data-a11-night=&quot;1&quot;&gt;名&#39;&amp;&lt;/b&gt;';
const cases = [
  { id: 'wolf-zero', partners: [], expected: 'ほかに人狼はいません' },
  { id: 'wolf-one', partners: ['仲間'], expected: '仲間：仲間' },
  { id: 'wolf-multiple', partners: ['甲', '乙'], expected: '仲間：甲、乙' },
  { id: 'wolf-html-quotes', partners: [marker], expected: `仲間：${encoded}` },
  { id: 'wolf-multiple-html', partners: ['甲', marker], expected: `仲間：甲、${encoded}` },
];
for (const done of [false, true]) {
  cases.push({ id: `medium-first-${done}`, medium: true, day: 1, done, expected: '' });
  for (const result of [null, 'wolf', 'not_wolf', '<b>unexpected</b>']) {
    cases.push({ id: `medium-${result || 'none'}-${done}`, medium: true, done, result,
      expected: result ? `昨日追放された <strong>${encoded}</strong>は<br><strong style="font-size:20px">${result === 'wolf' ? '人狼だった' : '人狼ではなかった'}</strong>` : '昨日はまだ誰も追放されていません' });
  }
  cases.push({ id: `medium-empty-name-${done}`, medium: true, done, result: 'wolf', name: '',
    expected: '昨日追放された <strong>?</strong>は<br><strong style="font-size:20px">人狼だった</strong>' });
}
cases.push({ id: 'missing-me', partners: [marker], missingMe: true, expected: '' },
  { id: 'dead-player', partners: [marker], dead: true, expected: '' });
function run(test, code = renderer) {
  const elements = new Map(['night-action-area', 'night-wait-panel', 'night-role-sub'].map(id => [id,
    { innerHTML: 'before', textContent: '', style: { display: 'initial' }, querySelector: () => ({ innerHTML: '' }) }]));
  let writes = 0;
  let html = 'before';
  Object.defineProperty(elements.get('night-action-area'), 'innerHTML', {
    get: () => html, set: value => { html = value; writes++; },
  });
  const input = JSON.parse(JSON.stringify({
    state: { nickname: 'self', myRole: test.medium ? '霊媒師' : '人狼', isAlive: !test.dead, wolfPartners: test.partners || [] },
    room: { day: test.day || (test.medium ? 2 : 1), nightResult: { mediumResult: test.result || null }, lastExecuted: test.name ?? marker },
    players: test.missingMe ? {} : { self: { isAlive: !test.dead, actionDone: !!test.done } },
  }));
  const context = vm.createContext({ ...input, document: { getElementById(id) {
    assert(elements.has(id), `Unexpected DOM boundary: ${id}`); return elements.get(id);
  } } }, { codeGeneration: { strings: false, wasm: false } });
  new vm.Script(escapeCode + '\n' + code + '\nsetupNightActionUI(room, players);')
    .runInContext(context, { timeout: 1000 });
  return { html, writes, wait: elements.get('night-wait-panel').style.display,
    subtitle: elements.get('night-role-sub').textContent };
}
function verify(test, output) {
  assert(!output.html.includes(marker), `${test.id}: raw nickname reached HTML`);
  assert(!output.html.includes('<b>unexpected</b>'), `${test.id}: raw verdict reached HTML`);
  assert.equal(output.writes, test.missingMe || test.dead || test.day === 1 ? 1 : 2);
  if (test.expected === '') assert.equal(output.html, '');
  else assert(output.html.includes(test.expected), `${test.id}: expected content missing`);
  const buttonExpected = !!test.medium && test.day !== 1 && !test.done;
  assert.equal(output.html.includes('id="btn-medium-done"'), buttonExpected);
  assert.equal(output.wait, test.missingMe ? 'initial' : buttonExpected ? 'none' : 'block');
  if (test.medium && test.day === 1) assert.equal(output.subtitle, '今夜は行動がありません');
}
const results = cases.map(test => {
  const output = run(test); verify(test, output);
  return { case: test.id, result: 'PASS', ...output };
});
const negativeControls = [];
for (const [id, needle, replacement] of [
  ['wolf-html-quotes', 'state.wolfPartners.map(esc)', 'state.wolfPartners.map(value => value)'],
  ['medium-wolf-false', "esc(room.lastExecuted || '?')", "(room.lastExecuted || '?')"],
  ['medium-wolf-true', "esc(room.lastExecuted || '?')", "(room.lastExecuted || '?')"],
]) {
  assert.equal(renderer.split(needle).length - 1, 1);
  const test = cases.find(candidate => candidate.id === id);
  const mutated = renderer.replace(needle, replacement);
  assert.equal(mutated.replace(replacement, needle), renderer);
  const output = run(test, mutated);
  assert(output.html.includes(marker));
  assert.throws(() => verify(test, output), /raw nickname reached HTML/);
  negativeControls.push({ case: id, change: `${needle} -> ${replacement}`, samePredicateRejected: true });
}
console.log(JSON.stringify({ date: '2026-09-08', sourceCommit, result: 'PASS',
  sources: sources.map(({ file, sha256 }) => ({ file, sha256 })), extractions,
  checks: { cases: results.length, negativeControls: negativeControls.length }, results, negativeControls,
  limitations: ['Actual setupNightActionUI and shared esc only; room listener and upstream role setup are not executed.',
    'JSON synthetic inputs and property capture only; no HTML parsing, script execution, browser, SDK, network, Firebase or iPhone.',
    'Other roles and later wolf nights are outside scope; no gameplay, production permissions or full XSS safety claim.',
    'App and scanner unchanged; static unknown count is not reduced.'],
}, null, 2));
