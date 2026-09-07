// Fixed approved kj19/kbn07 snapshot. Read-only; no network or clipboard transfer.
// Historical validators keep their own old SHA requirements unchanged.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceCommit = '817ca4f78fd857106ca8b135e8ca07da2ce35671';
const beforeSha256 = '453880d703e04c36dca8f8d37f88727813cc58e0ac9f9586368cd84f1fd2f4db';
const afterSha256 = '79c752e1ae24074477f414196188a006322b573a5bb956dfc850dc2f0a32c194';
const proposalPath = 'docs/reports/p10-culture-two-proposal-2026-09-07.md';
const proposalSha256 = 'b031650c0e192ff4edfea058d2863bf21121250d4d44bd73824a5c67bb35a680';
const allowedFields = {
  kj19: ['question', 'choices', 'explanation'],
  kbn07: ['question', 'choices', 'explanation'],
};
const ids = Object.keys(allowedFields);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => fs.readFileSync(path.join(root, name));
const git = args => execFileSync('git', args, { cwd: root });
const baseline = name => git(['show', sourceCommit + ':' + name]);
const parse = async bytes => (await import('data:text/javascript;base64,' + Buffer.from(bytes).toString('base64'))).QUIZ_PACKS;
const questionFields = ({ question, choices, answerIndex, explanation }) => ({ question, choices, answerIndex, explanation });

const proposal = read(proposalPath);
assert.equal(sha(proposal), proposalSha256, 'Approved proposal changed');
const blocks = [...proposal.toString('utf8').matchAll(/```json\n([\s\S]*?)\n```/g)];
assert.equal(blocks.length, 4);
const approved = Object.fromEntries(ids.map((id, i) => [id, JSON.parse(blocks[i * 2 + 1][1])]));
const beforeSource = baseline('apps/quiz/questions.js'), afterSource = read('apps/quiz/questions.js');
assert.equal(sha(beforeSource), beforeSha256);
assert.equal(sha(afterSource), afterSha256);
const before = await parse(beforeSource), after = await parse(afterSource);
assert.equal(before.length, 24);
assert.equal(after.length, 24);
const previous = new Map(), current = new Map(), changed = [], positions = {};
let count = 0;
for (let p = 0; p < before.length; p++) {
  const { questions: bq, ...bm } = before[p];
  const { questions: aq, ...am } = after[p];
  assert.deepEqual(am, bm, 'Pack metadata/order changed');
  assert.equal(aq.length, bq.length);
  for (let i = 0; i < bq.length; i++) {
    const b = bq[i], a = aq[i];
    count++;
    assert.equal(a.id, b.id, 'Question ID/order changed');
    assert(!current.has(a.id), 'Duplicate ID');
    previous.set(b.id, b);
    current.set(a.id, a);
    if (Object.hasOwn(allowedFields, a.id)) {
      const replacement = Object.fromEntries(allowedFields[a.id].map(k => [k, approved[a.id][k]]));
      assert.deepEqual(a, { ...b, ...replacement }, a.id + ': unapproved field change');
      assert.deepEqual(questionFields(a), approved[a.id], a.id + ': proposal mismatch');
      assert.deepEqual(questionFields(b), JSON.parse(blocks[ids.indexOf(a.id) * 2][1]), 'Proposal original differs');
      assert.equal(a.answerIndex, 0);
      assert.equal(a.choices.length, 3);
      assert.deepEqual(Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])), allowedFields[a.id]);
      positions[a.id] = { pack: am.id, packIndex: p, questionIndex: i, difficulty: a.difficulty };
    } else assert.deepEqual(a, b, a.id + ': unrelated question changed');
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(a.id);
  }
}
assert.equal(count, 480);
assert.equal(current.size, 480);
assert.deepEqual(changed, ids);

// Exact six single-line literal replacements; comments/spacing also protected.
const literal = value => Array.isArray(value)
  ? '[' + value.map(literal).join(', ') + ']'
  : "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
let expectedText = beforeSource.toString('utf8'), replacements = 0;
for (const id of ids) for (const field of allowedFields[id]) {
  const oldLiteral = field + ': ' + literal(previous.get(id)[field]);
  assert.equal(expectedText.split(oldLiteral).length - 1, 1, id + ': ambiguous old literal');
  expectedText = expectedText.replace(oldLiteral, field + ': ' + literal(approved[id][field]));
  replacements++;
}
assert.equal(replacements, 6);
assert.equal(afterSource.toString('utf8'), expectedText, 'Unexpected source bytes changed');

// The list comes from the immutable baseline tree, not mutable working files.
const evidencePaths = git(['ls-tree', '-r', '--name-only', sourceCommit, 'docs/reports/evidence'])
  .toString('utf8').trim().split('\n').filter(p => /\/p10-.*\.(json|mjs)$/.test(p));
assert.equal(evidencePaths.length, 30);
const preservedEvidence = {};
for (const file of evidencePaths) {
  const expected = baseline(file);
  assert(read(file).equals(expected), file + ': historical evidence changed');
  preservedEvidence[file] = sha(expected);
}
const rows = ['science', 'culture', 'dictionary', 'language'].flatMap(group =>
  JSON.parse(read('docs/reports/evidence/p10-followup3-' + group + '-2026-09-07.json')).items);
assert.equal(rows.length, 21);
assert.equal(new Set(rows.map(r => r.id)).size, 21);
const priorRetired = ['ky01','ky04','ky18','ky20','sk03','sk05','zk204','z07','s06','s08','z08','ks08','ks13'];
const beforeRemaining = rows.filter(r => r.outcome === 'unresolved' && !priorRetired.includes(r.id)).map(r => r.id).sort();
assert.deepEqual(beforeRemaining, ['kbn07','kj19','ru18','zk201','zk203','zk211']);
for (const id of beforeRemaining) {
  const row = rows.find(r => r.id === id);
  assert.deepEqual(row.currentQuestion, questionFields(previous.get(id)));
  if (!ids.includes(id)) assert.deepEqual(row.currentQuestion, questionFields(current.get(id)));
}
const remainingIDs = beforeRemaining.filter(id => !ids.includes(id));
assert.deepEqual(remainingIDs, ['ru18','zk201','zk203','zk211']);

// Real unchanged formatter and copy functions; only their clipboard sink is stubbed.
const appBytes = read('apps/quiz/app.js');
assert(appBytes.equals(baseline('apps/quiz/app.js')), 'App logic changed');
const app = appBytes.toString('utf8');
assert(app.includes('questionText.textContent = current.question;'));
assert(app.includes('feedbackExplanation.textContent = current.explanation;'));
assert(app.includes('feedbackAnswer.textContent = `正解: ${NUMBERS[current.answerIndex]} ${current.choices[current.answerIndex]}`;'));
assert(app.includes('${escapeHtml(choice)}'), 'Choice escaping path missing');
const start = app.indexOf('function formatQuestionText(q) {');
const end = app.indexOf("btnStart.addEventListener('click', startQuiz);", start);
assert(start >= 0 && end > start);
const numbers = ['①','②','③','④','⑤'], clipboardTexts = {};
for (const id of ids) {
  const q = current.get(id), copied = [];
  const context = vm.createContext({
    NUMBERS: numbers, state: { deck: [q], index: 0 },
    btnCopyQuestion: {}, btnCopyAnswer: {}, copyToClipboard: text => copied.push(text),
  });
  vm.runInContext(app.slice(start, end) + '\ncopyQuestion(); copyAnswer();', context, { timeout: 1000 });
  const expectedQuestion = ['【問題】', q.question, ...q.choices.map((c, i) => numbers[i] + ' ' + c)].join('\n');
  const expectedAnswer = [expectedQuestion, '', '【正解】', numbers[q.answerIndex] + ' ' + q.choices[q.answerIndex], '', '【解説】', q.explanation].join('\n');
  assert.deepEqual(copied, [expectedQuestion, expectedAnswer]);
  clipboardTexts[id] = { question: copied[0], answer: copied[1] };
}
console.log(JSON.stringify({
  result: 'PASS', date: '2026-09-07', sourceCommit, beforeSha256, afterSha256,
  approvedProposal: { path: proposalPath, sha256: proposalSha256 },
  packs: after.length, questions: count, changed, changedFields: allowedFields,
  unchangedQuestions: count - changed.length, positions, exactLiteralReplacements: replacements,
  preservedPriorEvidenceFiles: evidencePaths.length, preservedEvidence,
  beforeRemainingCount: beforeRemaining.length, retiredByApprovedWording: ids,
  remainingCount: remainingIDs.length, remainingIDs,
  retirementMeaning: 'Unverified specific character-origin imagery and kabuki-origin details replaced by approved dictionary-supported questions; not proof that those earlier accounts are false.',
  clipboardTextCheck: 'PASS: actual copy functions with sink stub; no OS clipboard transfer',
  clipboardTexts, unchangedTextContentAndChoiceEscapingPaths: true,
  limits: 'Fixed snapshot/structure/generated strings/static display paths only; not browser behavior, truth of every claim, deployment, or closure of P-10/C3. Remaining IDs are not error counts or total backlog counts.',
}, null, 2));
