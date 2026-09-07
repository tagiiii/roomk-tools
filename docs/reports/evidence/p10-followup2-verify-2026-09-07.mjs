// Snapshot/record consistency only: this cannot prove that a cited claim is true.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const sourceCommit = '96f3cf7d99fd9c19d09ba9d893b913752543dcbe';
const sourceSha256 = '7aab68b61b8ebdba4bddc724acd6423ec016f9c2108f15541fbc325d4b826c2b';
const groups = ['science', 'culture', 'dictionary', 'language'];
const expectedIDs = ['z07', 'z08', 's06', 's08', 's09', 'ks08', 'ks13',
  'kj09', 'kj19', 'khm10', 'kbn07', 'zk201', 'zk203', 'zk204', 'zk207', 'zk211',
  'ky01', 'ky04', 'ky18', 'ky20', 'ru18', 'ma07', 'ma11', 'do08', 'sk03', 'sk05'];
const read = relative => fs.readFileSync(path.join(root, relative));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const json = name => JSON.parse(fs.readFileSync(path.join(here, name), 'utf8'));
const key = row => `${row.pack}/${row.id}`;
const source = read('apps/quiz/questions.js');
assert.equal(sha(source), sourceSha256, 'Quiz changed from the recorded snapshot');
assert(source.equals(execFileSync('git', ['show', `${sourceCommit}:apps/quiz/questions.js`], { cwd: root })));
const { QUIZ_PACKS } = await import('data:text/javascript;base64,' + source.toString('base64'));
const questions = new Map(QUIZ_PACKS.flatMap(p => p.questions.map(q => [`${p.id}/${q.id}`, q])));
assert.equal(QUIZ_PACKS.length, 24);
assert.equal(questions.size, 480);
const outcomes = new Set(['supported_scope', 'audit_scope_corrected', 'unresolved', 'finding']);
const counts = {};
const groupCounts = {};
const seen = new Set();
const ids = [];
const unresolved = [];
const findings = [];
const newFindings = [];

for (const group of groups) {
  for (const name of [`p10-${group}-2026-09-06.json`, `p10-night-${group}-2026-09-06.json`]) {
    const relative = `docs/reports/evidence/${name}`;
    assert(read(relative).equals(execFileSync('git', ['show', `${sourceCommit}:${relative}`], { cwd: root })), `${name}: historical evidence changed`);
  }
  const prior = json(`p10-night-${group}-2026-09-06.json`).items.filter(r => r.outcome === 'unresolved');
  const current = json(`p10-followup2-${group}-2026-09-07.json`);
  assert.equal(current.date, '2026-09-07');
  assert.equal(current.sourceCommit, sourceCommit);
  assert.equal(current.sourceSha256, sourceSha256);
  assert(current.scope);
  assert.deepEqual(current.items.map(key).sort(), prior.map(key).sort(), `${group}: wrong scope`);
  groupCounts[group] = { total: current.items.length, outcomes: {} };
  for (const row of current.items) {
    const k = key(row);
    assert(!seen.has(k), `${k}: duplicate`);
    seen.add(k);
    ids.push(row.id);
    const q = questions.get(k);
    assert(q, `${k}: missing question`);
    const { question, choices, answerIndex, explanation } = q;
    assert.deepEqual(row.currentQuestion, { question, choices, answerIndex, explanation }, `${k}: source text mismatch`);
    assert.deepEqual(row.priorRemainingClaims, prior.find(p => key(p) === k).remainingClaims, `${k}: prior claims mismatch`);
    assert(outcomes.has(row.outcome), `${k}: invalid outcome`);
    assert(Array.isArray(row.verifiedClaims) && Array.isArray(row.remainingClaims));
    assert(Array.isArray(row.sources) && row.sources.length > 0, `${k}: missing evidence/access records`);
    assert(Array.isArray(row.searches) && row.searches.length > 0, `${k}: missing search record`);
    assert(typeof row.notes === 'string' && row.notes.length > 0);
    for (const s of row.sources) {
      assert(/^https?:\/\//.test(s.url), `${k}: invalid URL`);
      for (const field of ['title', 'publisher', 'access', 'claimSupported', 'limitations']) {
        assert(typeof s[field] === 'string', `${k}: missing ${field}`);
      }
      assert(s.title && s.access, `${k}: missing source metadata`);
    }
    if (['supported_scope', 'audit_scope_corrected'].includes(row.outcome)) assert.equal(row.remainingClaims.length, 0, `${k}: unresolved claim hidden by completion`);
    if (row.outcome === 'unresolved') {
      assert(row.remainingClaims.length > 0, `${k}: no remaining claim`);
      unresolved.push(row.id);
    }
    if (row.outcome === 'finding') findings.push(row.id);
    if (row.newFindings !== undefined) {
      assert(Array.isArray(row.newFindings));
      for (const finding of row.newFindings) {
        assert(finding.id && finding.claim && finding.severity && finding.proposal);
        assert(Array.isArray(finding.sourceUrls) && finding.sourceUrls.length > 0);
        for (const url of finding.sourceUrls) assert(row.sources.some(s => s.url === url), `${k}: finding source not recorded`);
        assert(typeof finding.limitations === 'string');
        assert(!newFindings.some(f => f.id === finding.id), `${k}: duplicate finding ID`);
        newFindings.push({ questionID: row.id, id: finding.id });
      }
    }
    counts[row.outcome] = (counts[row.outcome] || 0) + 1;
    const gc = groupCounts[group].outcomes;
    gc[row.outcome] = (gc[row.outcome] || 0) + 1;
  }
}
assert.deepEqual(ids.sort(), expectedIDs.sort());
assert.equal(seen.size, 26);
console.log(JSON.stringify({ result: 'PASS', sourceCommit, sourceSha256,
  total: seen.size, counts, groups: groupCounts, unresolved, findings, newFindings,
  limitation: 'Checks snapshot, scope and record structure; source interpretation requires human/agent review.' }, null, 2));
