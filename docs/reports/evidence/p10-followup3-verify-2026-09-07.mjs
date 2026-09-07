// Historical snapshot validation, not proof of factual accuracy.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const sourceCommit = '6afcb707378e4bcc3121b778d1102e51e36b9f5d';
const sourceSha256 = '18d6abfe00f2348a1c182342c11992ec4a77d4d8a3fb40376724d84dc2fe5dc1';
const git = args => execFileSync('git', args, { cwd: root });
const read = relative => fs.readFileSync(path.join(root, relative));
const original = relative => git(['show', sourceCommit + ':' + relative]);
const source = read('apps/quiz/questions.js');
assert.equal(crypto.createHash('sha256').update(source).digest('hex'), sourceSha256);
assert(source.equals(original('apps/quiz/questions.js')), 'Question source changed during research');
const { QUIZ_PACKS } = await import('data:text/javascript;base64,' + source.toString('base64'));
assert.equal(QUIZ_PACKS.length, 24);
assert.equal(QUIZ_PACKS.flatMap(p => p.questions).length, 480);
const current = new Map(QUIZ_PACKS.flatMap(p => p.questions.map(q => [p.id + '/' + q.id, q])));
assert.equal(current.size, 480);

// Every pre-existing P-10 evidence file remains byte-identical to the published baseline.
const priorFiles = git(['ls-tree', '-r', '--name-only', sourceCommit, '--', 'docs/reports/evidence'])
  .toString('utf8').trim().split('\n').filter(f => /\/p10-.*\.(json|mjs)$/.test(f));
assert(priorFiles.length > 0);
for (const file of priorFiles) assert(read(file).equals(original(file)), file + ': historical evidence changed');

const groups = ['science', 'culture', 'dictionary', 'language'];
const expectedGroups = {
  science: ['z07', 'z08', 's06', 's08', 'ks08', 'ks13'],
  culture: ['kj19', 'kbn07', 'zk201', 'zk203', 'zk204', 'zk207', 'zk211'],
  dictionary: ['ky01', 'ky04', 'ky18', 'ky20', 'ru18', 'ma07'],
  language: ['sk03', 'sk05'],
};
const counts = { supported_scope: 0, audit_scope_corrected: 0, unresolved: 0 };
const groupCounts = {};
const ids = new Set();
const proposedIDs = [];
const unresolvedIDs = [];
const findings = [];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
for (const group of groups) {
  const previous = JSON.parse(read(`docs/reports/evidence/p10-followup2-${group}-2026-09-07.json`));
  const expected = previous.items.filter(r => r.outcome === 'unresolved' && r.id !== 'do08');
  assert.deepEqual(expected.map(r => r.id).sort(), [...expectedGroups[group]].sort());
  const ledger = JSON.parse(fs.readFileSync(path.join(here, `p10-followup3-${group}-2026-09-07.json`)));
  assert.equal(ledger.date, '2026-09-07');
  assert.equal(ledger.sourceCommit, sourceCommit);
  assert.equal(ledger.sourceSha256, sourceSha256);
  assert(nonempty(ledger.scope));
  assert.deepEqual(ledger.items.map(r => r.id).sort(), expected.map(r => r.id).sort());
  groupCounts[group] = { supported_scope: 0, audit_scope_corrected: 0, unresolved: 0 };
  for (const row of ledger.items) {
    assert(!ids.has(row.id), 'Duplicate ID: ' + row.id);
    ids.add(row.id);
    const prior = expected.find(r => r.id === row.id);
    assert.equal(row.pack, prior.pack);
    assert.deepEqual(row.priorRemainingClaims, prior.remainingClaims);
    const { question, choices, answerIndex, explanation } = current.get(row.pack + '/' + row.id);
    assert.deepEqual(row.currentQuestion, { question, choices, answerIndex, explanation });
    assert.deepEqual(row.currentQuestion, prior.currentQuestion);
    assert(Object.hasOwn(counts, row.outcome), 'Unknown outcome: ' + row.outcome);
    counts[row.outcome]++;
    groupCounts[group][row.outcome]++;
    assert(Array.isArray(row.verifiedClaims) && row.verifiedClaims.every(nonempty));
    assert(Array.isArray(row.remainingClaims) && row.remainingClaims.every(nonempty));
    if (row.outcome === 'unresolved') {
      assert(row.remainingClaims.length > 0);
      unresolvedIDs.push(row.id);
    } else {
      assert.equal(row.remainingClaims.length, 0);
      assert(row.verifiedClaims.length > 0);
    }
    assert(row.sources.length > 0);
    for (const s of row.sources) {
      for (const k of ['title', 'publisher', 'url', 'access', 'claimSupported', 'limitations']) assert(nonempty(s[k]), row.id + ': source.' + k);
      assert(/^https?:\/\//.test(s.url));
    }
    assert(Array.isArray(row.searches) && row.searches.length > 0);
    for (const s of row.searches) assert(nonempty(s.query) && nonempty(s.result));
    assert(nonempty(row.notes));
    assert(['retain', 'wording_proposal', 'source_needed'].includes(row.proposedAction.kind));
    assert(nonempty(row.proposedAction.text) && nonempty(row.proposedAction.reason));
    if (row.proposedAction.kind === 'wording_proposal') proposedIDs.push(row.id);
    if (row.newFindings !== undefined) {
      assert(Array.isArray(row.newFindings));
      for (const finding of row.newFindings) findings.push({ questionID: row.id, finding });
    }
  }
}
assert.equal(ids.size, 21);
assert(!ids.has('do08'));
assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 21);
console.log(JSON.stringify({
  result: 'PASS', sourceCommit, sourceSha256, targetCount: ids.size, counts, groupCounts,
  unresolvedIDs: unresolvedIDs.sort(), wordingProposalIDs: proposedIDs.sort(), findings,
  preservedPriorEvidenceFiles: priorFiles.length, questionChanges: 0,
  limits: 'Structural/source snapshot checks only. Proposals are not approvals or fixes. Counts are not error totals and do not close P-10/C3.',
}, null, 2));
