// Fixed-source, JSON-input evidence. No SDK, network, browser or app mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../../../', import.meta.url));
assert(process.argv.slice(2).every(arg => arg === '--baseline'));
const baselineOnly = process.argv.includes('--baseline');
const sourceCommit = '09086e20c5d8090085829a2e2a2d233c1e9ffd06';
const digest = text => createHash('sha256').update(text).digest('hex');
const sources = [
  ['apps/kotoba-tantei/app.js', 'b96fc56f8c3836b06a9ca6be6c58db65d812f9e870f9e45102b3f6924c0fcae9'],
  ['apps/kotoba-tantei/service.js', '096666319ffcdf707cf6027a0334f01c2ce63322f8cecb4fd3c6d5f06d5a6cf0'],
  ['apps/shared/js/utils.js', '533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370'],
].map(([file, sha256]) => {
  const baseline = execFileSync('git', ['show', `${sourceCommit}:${file}`], { cwd: root, encoding: 'utf8' });
  const text = baselineOnly ? baseline : readFileSync(root + file, 'utf8');
  assert.equal(digest(text), sha256, `Source changed: ${file}`);
  assert.equal(text, baseline, `Baseline mismatch: ${file}`);
  return { file, sha256, text };
});
const extractions = [];
// Hash-fixed trusted code, unique top-level header and first unindented closing brace.
function extract(source, header, firstLine) {
  const lines = source.text.split('\n');
  assert.equal(lines.filter(line => line === header).length, 1);
  assert.equal(lines[firstLine - 1], header);
  const last = lines.findIndex((line, index) => index >= firstLine && line === '}');
  assert(last >= firstLine);
  const original = lines.slice(firstLine - 1, last + 1).join('\n');
  extractions.push({ file: source.file, header, firstLine, lastLine: last + 1, sha256: digest(original) });
  return original.replace(/^export /, '');
}
const code = [
  extract(sources[0], 'function renderLobby() {', 249),
  extract(sources[0], 'function renderSpectatorShareControls(currentPlayer) {', 319),
  extract(sources[0], 'function teamLabel(team) {', 504),
  extract(sources[0], 'function roleLabel(role) {', 508),
  extract(sources[0], 'function renderLobbyPlayer(player, canEditAssignments) {', 548),
  extract(sources[0], 'function renderPlayerControls(player) {', 575),
  extract(sources[0], 'function renderStartConditions(players) {', 610),
  extract(sources[0], 'function canStart(players) {', 619),
  extract(sources[1], 'export function getStartConditions(players) {', 782),
  extract(sources[2], 'export function escapeHtml(str) {', 168),
  'const esc = escapeHtml;',
].join('\n');
assert(!/\b(?:firebase|fetch|XMLHttpRequest|WebSocket|sessionStorage|localStorage|require|import)\b/.test(code));

const marker = '<b data-a11-length-probe="1">probe</b>';
const nameMarker = '<b data-a11-name-probe="1">name</b>';
const player = (id, team, role, isHost = false) => ({ id, name: id, team, role, isHost });
const normal = [player('host', 'red', 'spymaster', true), player('red', 'red', 'guesser'),
  player('blue-hint', 'blue', 'spymaster'), player('blue', 'blue', 'guesser')];
const cases = [
  { id: 'normal-host', players: normal, playerId: 'host', count: 4, startEnabled: true },
  { id: 'normal-guest', players: normal, playerId: 'red', count: 4, startEnabled: false },
  { id: 'one-host', players: [normal[0]], playerId: 'host', count: 1, startEnabled: false },
  { id: 'empty-array', players: [], count: 0 },
  { id: 'missing', count: 0 },
  { id: 'null', players: null, count: 0 },
  { id: 'html-length-object', players: { 0: normal[0], length: marker }, error: true },
  { id: 'string-length-object', players: { 0: normal[0], length: '1' }, error: true },
  { id: 'number-length-object', players: { 0: normal[0], length: 1 }, error: true },
  { id: 'string', players: 'abcd', error: true },
  { id: 'number', players: 7, error: true },
  { id: 'zero', players: 0, error: true },
  { id: 'false', players: false, error: true },
  { id: 'null-array-entry', players: [null], error: true },
  { id: 'html-name-array', players: [{ ...normal[0], name: nameMarker }], count: 1 },
];
const results = [];
for (const test of cases) {
  const room = { gamePhase: 'lobby' };
  if (Object.hasOwn(test, 'players')) room.players = test.players;
  // All room inputs survive JSON round trip: no injected methods, proxies or exotic prototypes.
  const state = { roomId: 'ABC234', playerId: test.playerId || 'host', room: JSON.parse(JSON.stringify(room)),
    notification: null, loading: false, error: '' };
  let html = 'unchanged-before-render';
  let writes = 0;
  let subscriptions = 0;
  const appEl = { get innerHTML() { return html; }, set innerHTML(value) { writes++; html = value; } };
  const unexpected = () => { throw new Error('Unexpected session/navigation boundary'); };
  const context = vm.createContext({ state, appEl, ensureRoomSubscription: () => { subscriptions++; },
    restoreSession: unexpected, navigate: unexpected }, { codeGeneration: { strings: false, wasm: false } });
  let error = null;
  try {
    new vm.Script(code + '\nrenderLobby();', { filename: 'fixed-lobby-extract.js' }).runInContext(context, { timeout: 1000 });
  } catch (caught) {
    error = { name: caught.name, message: caught.message };
  }
  assert.equal(subscriptions, 1);
  assert.equal(Boolean(error), Boolean(test.error), test.id);
  assert.equal(html.includes(marker), false, test.id);
  let count = null;
  let startEnabled = false;
  if (test.error) {
    assert.equal(error.name, 'TypeError');
    assert.equal(writes, 0);
    assert.equal(html, 'unchanged-before-render');
    assert.match(error.message, test.id === 'null-array-entry' ? /reading 'id'/ : /find is not a function/);
  } else {
    assert.equal(writes, 1);
    count = html.match(/<strong>(\d+) \/ 8<\/strong>/)?.[1];
    assert.equal(count, String(test.count));
    startEnabled = /id="start-game"[^>]*>/.test(html) && !/id="start-game"[^>]*disabled/.test(html);
    if (Object.hasOwn(test, 'startEnabled')) assert.equal(startEnabled, test.startEnabled);
    if (test.id === 'html-name-array') {
      assert(!html.includes(nameMarker));
      assert(html.includes('&lt;b data-a11-name-probe=&quot;1&quot;&gt;name&lt;/b&gt;'));
    }
  }
  results.push({ case: test.id, writes, count, startEnabled, rawLengthMarkerReached: false, error });
}
console.log(JSON.stringify({ date: '2026-09-08', sourceCommit, result: 'PASS',
  sources: sources.map(({ file, sha256 }) => ({ file, sha256 })), extractions,
  checks: { totalCases: results.length, renderedCases: results.filter(r => r.writes === 1).length,
    preSinkErrors: results.filter(r => r.writes === 0).length, rawLengthMarkerCases: 0 }, results,
  upstreamInspection: [
    'service.js:741 subscribeToRoom forwards snapshot.data() without players normalization.',
    'app.js:440 subscription callback assigns state.room, then clearInvalidPendingCard; pendingCardIndex null returns early.',
    'For the ordinary lobby route, callback reaches renderLobby; players?.find at app.js:275 precedes canStart/filter, map and innerHTML.',
    'getStartConditions uses real array filter/some; renderLobby uses real find/map. No fake methods make JSON maps reach the sink.',
  ], limitations: [
    'Direct renderer only; subscription/navigation are boundary stubs. Upstream statements are static inspection, not integration execution.',
    'No SDK, network, Firebase, saved-session operations, browser or iPhone use; document is a property-capture stub, not an HTML parser.',
    'Tested malformed JSON shapes throw before assignment, not sanitize successfully. An existing screen remains unchanged in this stub.',
    'Normal JSON array length is numeric. These tests do not prove all app HTML safe, production write permission, or resilience to arbitrary corrupted data.',
    'No app or scanner changes; the static unknown count is not reduced by these evidence-only tests.',
  ],
}, null, 2));
