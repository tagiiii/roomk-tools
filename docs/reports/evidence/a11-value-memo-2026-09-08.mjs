// Fixed-source isolation: mocked DOM, capture and download; no browser or network.
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
  ['apps/value-card/app.js', 'f5aab7271482c23c94404487f0b04f5128e0e7565dda14cff521622729aa9e16'],
  ['apps/shared/js/utils.js', '533e791fd06c37839989a1461bb0322d11c94fc1d1ef853a03c68fb12c25c370'],
].map(([file, sha256]) => {
  const baseline = execFileSync('git', ['show', `${sourceCommit}:${file}`], { cwd: root, encoding: 'utf8' });
  const text = baselineOnly ? baseline : readFileSync(root + file, 'utf8');
  assert.equal(digest(text), sha256, `Source changed: ${file}`);
  assert.equal(text, baseline, `Baseline mismatch: ${file}`);
  return { file, sha256, text };
});
const extractions = [];
function extract(source, header, firstLine, lastLine) {
  const lines = source.text.split('\n');
  assert.equal(lines.filter(line => line === header).length, 1);
  assert.equal(lines[firstLine - 1], header);
  assert.equal(lines.findIndex((line, i) => i >= firstLine && line === '}') + 1, lastLine);
  const original = lines.slice(firstLine - 1, lastLine).join('\n');
  extractions.push({ file: source.file, header, firstLine, lastLine, sha256: digest(original) });
  return original.replace(/^export /, '');
}
const code = extract(sources[0], 'function saveImage() {', 243, 329) + '\n' +
  extract(sources[1], 'export function escapeHtml(str) {', 168, 175);
assert(!/\b(?:firebase|fetch|XMLHttpRequest|WebSocket|sessionStorage|localStorage|require|import)\b/.test(code));
const marker = '<b data-a11-memo-probe="1">memo</b>';
const escapedMarker = '&lt;b data-a11-memo-probe=&quot;1&quot;&gt;memo&lt;/b&gt;';
const card = { id: 1, keyword: '固定カード', description: '固定説明' };
const cases = [
  { id: 'ordinary', memos: ['  大切にしたい  '], expected: ['大切にしたい'] },
  { id: 'empty', memos: [''], expected: [] },
  { id: 'whitespace', memos: [' \n\t '], expected: [] },
  { id: 'html-memo', memos: [marker], expected: [escapedMarker] },
  { id: 'quotes-ampersands', memos: ['"\' & < >'], expected: ['&quot;&#39; &amp; &lt; &gt;'] },
  { id: 'newline', memos: ['先頭\n末尾'], expected: ['先頭\n末尾'] },
  { id: '100-characters', memos: ['あ'.repeat(100)], expected: ['あ'.repeat(100)] },
  { id: 'memo-order', memos: ['メモ甲', '', 'メモ丙'], expected: ['メモ甲', 'メモ丙'],
    hand: [card, { ...card, id: 2, keyword: 'カード乙' }, { ...card, id: 3, keyword: 'カード丙' }] },
  { id: 'card-escaping', memos: [''], expected: [], hand: [{ id: 1,
    keyword: '<b data-key="1">名</b>', description: '説明 "\' & < >' }] },
  { id: 'capture-rejection', memos: [marker], expected: [escapedMarker], mode: 'reject' },
  { id: 'canvas-error', memos: [marker], expected: [escapedMarker], mode: 'canvas-error' },
  { id: 'capture-sync-throw', memos: [marker], expected: [escapedMarker], mode: 'sync-throw' },
];
async function run(test, source = code) {
  const children = [], timers = [], links = [];
  let captured = '', captureCalls = 0, removed = 0, clicks = 0, canvasCalls = 0;
  const body = {
    appendChild(el) { children.push(el); el.parentNode = body; },
    removeChild(el) { assert.equal(children.shift(), el); el.parentNode = null; removed++; },
  };
  const context = vm.createContext({
    hand: JSON.parse(JSON.stringify(test.hand || [card])),
    resultArea: { querySelectorAll(selector) {
      assert.equal(selector, 'textarea'); return test.memos.map(value => ({ value }));
    } },
    document: { body, createElement(tag) {
      if (tag === 'div') return { style: {}, innerHTML: '', parentNode: null };
      assert.equal(tag, 'a'); const link = { click() { clicks++; } }; links.push(link); return link;
    } },
    setTimeout(fn, delay) { assert.equal(delay, 300); timers.push(fn); },
    html2canvas(el, options) {
      captureCalls++; captured = el.innerHTML;
      assert.equal(el, children[0]);
      assert.equal(JSON.stringify(options), JSON.stringify({ scale: 2, backgroundColor: '#F5F2EC', useCORS: true }));
      if (test.mode === 'sync-throw') throw new Error('fixed capture sync error');
      if (test.mode === 'reject') return Promise.reject(new Error('fixed capture rejection'));
      return Promise.resolve({ toDataURL(type) {
        canvasCalls++; assert.equal(type, 'image/png');
        if (test.mode === 'canvas-error') throw new Error('fixed canvas error');
        return 'data:image/png;base64,STUB';
      } });
    },
  }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(source + '\nsaveImage();', context, { timeout: 1000 });
  assert.equal(children.length, 1); assert.equal(timers.length, 1);
  context.timer = timers[0];
  let syncError = null;
  try { vm.runInContext('timer()', context, { timeout: 1000 }); }
  catch (error) { syncError = error.message; }
  // Drain the mocked native Promise then/catch/finally chain, not real wall-clock timers.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.equal(captureCalls, 1);
  const memoHtml = [...captured.matchAll(/padding:8px 12px; line-height:1\.5;\s*">([\s\S]*?)<\/div>/g)].map(m => m[1]);
  assert.deepEqual(memoHtml, test.expected, test.id + ': escaped memo/order');
  assert(!captured.includes(marker), test.id + ': no raw memo tag');
  if (test.id === 'memo-order') {
    assert(captured.indexOf('メモ甲') < captured.indexOf('カード乙'));
    assert(captured.indexOf('カード乙') < captured.indexOf('カード丙'));
    assert(captured.indexOf('カード丙') < captured.indexOf('メモ丙'));
  }
  if (test.id === 'card-escaping') {
    assert(captured.includes('&lt;b data-key=&quot;1&quot;&gt;名&lt;/b&gt;'));
    assert(captured.includes('説明 &quot;&#39; &amp; &lt; &gt;'));
    assert(!captured.includes('<b data-key'));
  }
  const success = !test.mode;
  assert.equal(clicks, success ? 1 : 0);
  assert.equal(canvasCalls, success || test.mode === 'canvas-error' ? 1 : 0);
  assert.equal(removed, test.mode === 'sync-throw' ? 0 : 1);
  assert.equal(children.length, test.mode === 'sync-throw' ? 1 : 0);
  assert.equal(syncError, test.mode === 'sync-throw' ? 'fixed capture sync error' : null);
  if (success) {
    assert.equal(links[0].download, 'value-card-result.png');
    assert.equal(links[0].href, 'data:image/png;base64,STUB');
  }
  return { id: test.id, status: 'PASS', memoHtml, captureCalls, canvasCalls, mockClicks: clicks,
    removed, remainingMockContainers: children.length, syncError };
}
const results = [];
for (const test of cases) results.push(await run(test));
assert.equal(code.split('escapeHtml(memo)').length, 2);
// Change exactly the memo escaping token in a VM-only source copy; no app edit.
await assert.rejects(run(cases.find(test => test.id === 'html-memo'),
  code.replace('escapeHtml(memo)', 'memo')), error => error.code === 'ERR_ASSERTION' &&
  error.message.includes('html-memo: escaped memo/order'));
console.log(JSON.stringify({ date: '2026-09-08', sourceCommit,
  sources: sources.map(({ file, sha256 }) => ({ file, sha256 })), extractions,
  summary: { cases: results.length, passed: results.length, negativeControlDetected: true }, results,
  limitations: ['String-output assertions with mocked DOM; no browser parsing or screenshot.',
    'html2canvas, canvas, timer and download are mocked; no image quality, actual download, SDK or network verification.',
    '100-character input is tested; textarea maxlength enforcement and multiline visual layout are not tested.',
    'Promise rejection/canvas error clean up silently; synchronous capture throw leaves a mock container. Real-library occurrence is not established.',
    'Only this fixed saveImage path is checked; A-11 unknown count is unchanged.'],
}, null, 2));
