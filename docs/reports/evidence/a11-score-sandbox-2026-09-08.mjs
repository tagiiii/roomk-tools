// Fixed-source, fixed-input rendering evidence. No SDK, network or browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
// Historical rerun reads the original committed sources; default still checks the working tree.
assert(process.argv.slice(2).every(arg => arg === '--baseline'));
const baselineOnly = process.argv.includes('--baseline');
const sourceCommit = '8714c57927a01e50d5b1130d865ad796484b9ada';
const digest = text => createHash('sha256').update(text).digest('hex');
const sources = [
  ['apps/do-mannaka/index.html', '2443e1185326cabd6edf8ae052b160ac407fa989000d7cd43bf0a9c3099b54ea'],
  ['apps/tatoe-gp/index.html', '4cbe5785eafff639f4762743fc4fc4b407002eec811444d34e86fd911bc2812a'],
  ['apps/shared/js/utils.js', '533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370'],
].map(([file, sha256]) => {
  const baseline = execFileSync('git', ['show', `${sourceCommit}:${file}`], { cwd: root, encoding: 'utf8' });
  const text = baselineOnly ? baseline : readFileSync(root + file, 'utf8');
  assert.equal(digest(text), sha256, `Source changed: ${file}`);
  assert.equal(text, baseline, `Baseline mismatch: ${file}`);
  return { file, sha256, text };
});

// These are indentation-bound extractions from hash-fixed trusted local files,
// not a general JS parser. Exact header, line range and closing line are asserted.
function extract(source, header, firstLine, lastLine, indent = '  ') {
  const lines = source.text.split('\n');
  assert.equal(lines.filter(line => line === indent + header).length, 1);
  assert.equal(lines[firstLine - 1], indent + header);
  const close = lines.findIndex((line, index) => index >= firstLine && line === indent + '}');
  assert.equal(close + 1, lastLine, 'Unexpected function boundary');
  const code = lines.slice(firstLine - 1, lastLine).join('\n');
  assert(!/\b(?:firebase|fetch|XMLHttpRequest|WebSocket|sessionStorage|localStorage|require|import)\b/.test(code));
  return code;
}

const helperLines = sources[2].text.split('\n');
assert.equal(helperLines[167], 'export function escapeHtml(str) {');
assert.equal(helperLines[174], '}');
const helper = helperLines.slice(167, 175).join('\n').replace(/^export /, '');
const targets = [
  { app: 'do-mannaka', functionName: 'handleResult', header: 'function handleResult(players, question) {', first: 1464, last: 1534, line: 1526, sink: 'score-list', call: 'handleResult(players, "fixed question")', source: sources[0] },
  { app: 'do-mannaka', functionName: 'handleFinished', header: 'function handleFinished(players) {', first: 1537, last: 1561, line: 1558, sink: 'final-ranking', call: 'handleFinished(players)', source: sources[0] },
  { app: 'tatoe-gp', functionName: 'renderScoreList', header: 'function renderScoreList(containerId, players) {', first: 1146, last: 1164, line: 1160, sink: 'score-list', call: 'renderScoreList("score-list", players)', source: sources[1] },
  { app: 'tatoe-gp', functionName: 'handleFinished', header: 'function handleFinished(players) {', first: 1856, last: 1881, line: 1877, sink: 'final-ranking', call: 'handleFinished(players)', source: sources[1] },
];
for (const target of targets) target.code = extract(target.source, target.header, target.first, target.last);

const marker = '<b data-a11-score-probe="1">probe</b>';
const nameMarker = '<b data-a11-name-probe="1">name</b>';
const cases = [
  ['number-12', 12, '12'], ['string-12', '12', '12'],
  ['null', null, '0'], ['zero', 0, '0'], ['harmless-html', marker, marker],
];
function run(target, players) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', style: {} });
    return elements.get(id);
  };
  const state = { currentScreen: null, nickname: 'fixed-player', role: 'host' };
  const context = vm.createContext({
    document: { getElementById: get }, state, players: structuredClone(players),
    showScreen: id => { state.currentScreen = id; },
  }, { codeGeneration: { strings: false, wasm: false } });
  // Only extracted, hash-fixed repository functions execute; inputs are data.
  new vm.Script(helper + '\n' + target.code + '\n' + target.call).runInContext(context, { timeout: 1000 });
  return { html: get(target.sink).innerHTML, winnerText: get('final-winner-score').textContent,
    winnerNameText: get('final-winner-name').textContent };
}

const results = [];
const captures = [];
for (const target of targets) {
  const location = `${target.source.file}:${target.line}:score`;
  for (const [id, score, expected] of cases) {
    const rendered = run(target, { 'fixed-player': { score, answer: 1 } });
    const scoreHtml = rendered.html.match(/<div class="(?:tg-)?score-pts">([\s\S]*?)<\/div>/)?.[1];
    assert.equal(scoreHtml, expected + 'pt', `${location} ${id}`);
    const rawMarkerReached = rendered.html.includes(marker);
    assert.equal(rawMarkerReached, id === 'harmless-html');
    if (target.functionName === 'handleFinished') assert.equal(rendered.winnerText, expected + 'pt');
    else assert.equal(rendered.winnerText, '');
    results.push({ location, case: id, scoreHtml, rawMarkerReached, winnerText: rendered.winnerText });
    if (rawMarkerReached) captures.push({ location, innerHTML: rendered.html });
  }
  const empty = run(target, {});
  assert.equal(empty.html, '');
  assert.equal(empty.winnerText, '');
  results.push({ location, case: 'empty-players', html: empty.html, winnerText: empty.winnerText });
  const named = run(target, { [nameMarker]: { score: 12, answer: 1 } });
  assert(!named.html.includes(nameMarker));
  assert(named.html.includes('&lt;b data-a11-name-probe=&quot;1&quot;&gt;name&lt;/b&gt;'));
  if (target.functionName === 'handleFinished') assert.equal(named.winnerNameText, nameMarker);
  results.push({ location, case: 'html-name', rawNameReached: false, escapedNameReached: true,
    winnerNameText: named.winnerNameText });
}
assert.equal(results.length, 28);
assert.equal(captures.length, 4);
console.log(JSON.stringify({
  date: '2026-09-08', sourceCommit, result: 'PASS',
  sources: sources.map(({ file, sha256 }) => ({ file, sha256 })),
  extractions: targets.map(t => ({ file: t.source.file, function: t.functionName,
    firstLine: t.first, lastLine: t.last, sha256: digest(t.code) })),
  checks: { sinks: 4, scoreCasesPerSink: 5, emptyCases: 4, escapedNameCases: 4, totalCases: 28 },
  results, captures,
  limitations: [
    'Document is a property-capture stub, not an HTML parser or browser; no DOM-element creation is proven here.',
    'Raw harmless marker reaches four score innerHTML strings. This is not a production exploitability or write-permission assessment.',
    'Final winner score/name uses textContent; its raw-looking string is a separate text assignment, not HTML evidence.',
    'Only fixed local functions and inputs run. No SDK, network, Firebase, saved-session operation or dangerous payload is used.',
    'Fresh empty-player cases are checked; prior-screen state and lifecycle behavior are outside this isolated test.',
  ],
}, null, 2));
