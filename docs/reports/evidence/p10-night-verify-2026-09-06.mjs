// Run with Node from any directory. This verifies the recorded snapshot, not future quiz revisions.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const expectedSource = '058162a845442933af2e95caf7442dda5b5a3f4b3d66821a1107db57472b19ae';
const oldHashes = {
  science: 'c4605053100911f3a3dafd62cdae9cd1fd71f2b78e9abaf0de56a60382732da1',
  culture: 'e04d364da71aa135cedb30e959f9de8edb7a38e3e3c090686929827cb0494908',
  dictionary: '27d059ac3f5d1c56a649f970d9b68e78feb1529138238ea0166660739d9d5869',
  language: 'd2775a5c8e532394cbd93f11e12abfa22204363a1a40be2f189dfa747b45ec4f',
};
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const json = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const key = r => `${r.pack}/${r.id}`;
const source = fs.readFileSync(path.join(root, 'apps/quiz/questions.js'), 'utf8');
assert.equal(sha(source), expectedSource, 'Current quiz differs from the recorded snapshot');
const { QUIZ_PACKS } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const questions = new Map(QUIZ_PACKS.flatMap(p => p.questions.map(q => [`${p.id}/${q.id}`, q])));
assert.equal(QUIZ_PACKS.length, 24);
assert.equal(questions.size, 480);
const validOutcomes = new Set(['supported_scope', 'finding', 'unresolved', 'prior_fix', 'audit_scope_corrected']);
const validAccess = new Set(['page', 'abstract', 'search_snippet', 'failed']);
const counts = {};
const groups = {};
const outstanding = [];
const seen = new Set();

for (const group of Object.keys(oldHashes)) {
  const oldPath = path.join(here, `p10-${group}-2026-09-06.json`);
  assert.equal(sha(fs.readFileSync(oldPath)), oldHashes[group], `${group}: original ledger changed`);
  const old = json(oldPath);
  const oldRows = Array.isArray(old) ? old : old.results || old.items;
  const pending = oldRows.filter(r => r.remainingClaims?.length);
  const supplement = json(path.join(here, `p10-night-${group}-2026-09-06.json`));
  assert.equal(supplement.sourceSha256, expectedSource);
  assert.deepEqual(supplement.items.map(key).sort(), pending.map(key).sort(), `${group}: missing or extra IDs`);
  groups[group] = { total: supplement.items.length, outcomes: {} };
  for (const row of supplement.items) {
    const k = key(row);
    assert(!seen.has(k), `Duplicate ${k}`);
    seen.add(k);
    const q = questions.get(k);
    assert(q, `Unknown ${k}`);
    const { question, choices, answerIndex, explanation } = q;
    assert.deepEqual(row.currentQuestion, { question, choices, answerIndex, explanation }, `${k}: text mismatch`);
    assert.deepEqual(row.previousRemainingClaims, pending.find(r => key(r) === k).remainingClaims, `${k}: old claims mismatch`);
    assert(validOutcomes.has(row.outcome), `${k}: invalid outcome`);
    assert(Array.isArray(row.checkedClaims) && Array.isArray(row.remainingClaims));
    assert(Array.isArray(row.sources) && Array.isArray(row.searches));
    for (const s of row.sources) {
      assert(validAccess.has(s.access), `${k}: invalid access`);
      assert(/^https?:\/\//.test(s.url), `${k}: invalid source URL`);
      assert(s.evidence && s.title && s.accessed, `${k}: incomplete source record`);
    }
    if (row.outcome === 'supported_scope') {
      assert.equal(row.remainingClaims.length, 0, `${k}: unsupported completion`);
      assert(row.sources.some(s => s.access === 'page' || s.access === 'abstract'), `${k}: no supporting body`);
    }
    if (row.outcome === 'unresolved') assert(row.remainingClaims.length > 0, `${k}: missing unresolved claim`);
    if (row.outcome === 'finding') assert(row.sources.some(s => s.access === 'page'), `${k}: no finding body evidence`);
    if (row.remainingClaims.length) outstanding.push(k);
    counts[row.outcome] = (counts[row.outcome] || 0) + 1;
    groups[group].outcomes[row.outcome] = (groups[group].outcomes[row.outcome] || 0) + 1;
  }
}

assert.equal(seen.size, 40);
console.log(JSON.stringify({ result: 'PASS', sourceSha256: expectedSource, total: seen.size, counts, groups, outstanding }, null, 2));
