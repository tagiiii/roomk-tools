// Historical snapshot: future quiz edits intentionally fail the fixed SHA check.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
// HEAD when the do08-only change was approved, not a moving branch reference.
const baselineCommit = '96f3cf7d99fd9c19d09ba9d893b913752543dcbe';
const beforeSha256 = '7aab68b61b8ebdba4bddc724acd6423ec016f9c2108f15541fbc325d4b826c2b';
const afterSha256 = '18d6abfe00f2348a1c182342c11992ec4a77d4d8a3fb40376724d84dc2fe5dc1';
const frozenPriorFiles = {
  "p10-followup2-culture-2026-09-07.json": "4ac55dc83a540702b31158a7e13305e814b728a478397254a68100a8b56ebf9a",
  "p10-followup2-dictionary-2026-09-07.json": "c395a9381b89b8f7145009840cbfbd0b0f048d5029cf1416de414dc5a9cdb901",
  "p10-followup2-language-2026-09-07.json": "e49145d65b9944b9fd6f6dd47c216b31f0beb52bc3f518ebb9cbf437d182e4cb",
  "p10-followup2-science-2026-09-07.json": "cc7c81ebfa38003095d04de0e02619f9364599ec384bb5fecef0f7c15ede3744",
  "p10-followup2-verify-2026-09-07.mjs": "c5ed67e4cea83c827181851acf6cd747b009b8a78f6fcf127cdb84504eb78be2"
};
const read = relative => fs.readFileSync(path.join(root, relative));
const baseline = relative => execFileSync('git', ['show', baselineCommit + ':' + relative], { cwd: root });
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const parse = async bytes => (await import('data:text/javascript;base64,' + Buffer.from(bytes).toString('base64'))).QUIZ_PACKS;
const currentSource = read('apps/quiz/questions.js');
const beforeSource = baseline('apps/quiz/questions.js');
assert.equal(sha(beforeSource), beforeSha256);
assert.equal(sha(currentSource), afterSha256, 'Not the approved do08 snapshot');
const before = await parse(beforeSource);
const after = await parse(currentSource);
assert.equal(before.length, 24);
assert.equal(after.length, 24);
const approved = {
  question: '橋をかけることを表す熟語「かきょう」。漢字で書くと？',
  choices: ['掛橋', '架橋', '懸橋'],
  explanation: '「かきょう」は「架橋」と書き、橋をかけることや、その橋を表す。「架」は、かけ渡すという意味の漢字。',
};
const changed = [];
const questionMap = new Map();
const beforeMap = new Map();
let count = 0;
let position;
for (let p = 0; p < after.length; p++) {
  const { questions: aq, ...am } = after[p];
  const { questions: bq, ...bm } = before[p];
  assert.deepEqual(am, bm, 'Pack metadata changed');
  assert.equal(aq.length, bq.length);
  for (let i = 0; i < aq.length; i++) {
    const a = aq[i], b = bq[i], key = am.id + '/' + a.id;
    count++;
    assert(!questionMap.has(key), 'Duplicate question key');
    questionMap.set(key, a);
    beforeMap.set(key, b);
    assert.equal(a.id, b.id, 'Question order or ID changed');
    assert.equal(a.difficulty, b.difficulty);
    assert.equal(a.answerIndex, b.answerIndex);
    assert.equal(a.choices.length, b.choices.length);
    if (key === 'douongigo/do08') {
      assert.deepEqual(a, { ...b, ...approved }, 'Unapproved do08 fields');
      assert.equal(a.difficulty, 2);
      assert.equal(a.answerIndex, 1);
      position = { packIndex: p, questionIndex: i };
    } else {
      assert.deepEqual(a, b, key + ': other question changed');
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(a.id);
  }
}
assert.equal(count, 480);
assert.equal(questionMap.size, 480);
assert.deepEqual(changed, ['do08']);
const key = 'douongigo/do08';
const q = questionMap.get(key), oldQ = beforeMap.get(key);
const changedFields = Object.keys(q).filter(k => JSON.stringify(q[k]) !== JSON.stringify(oldQ[k]));
assert.deepEqual(changedFields.sort(), ['choices', 'explanation', 'question']);

// Preserve all old evidence. This verifies bytes, not source truth.
const groups = ['science', 'culture', 'dictionary', 'language'];
let unchangedOriginalLedgers = 0;
for (const group of groups) {
  for (const name of ['p10-' + group + '-2026-09-06.json', 'p10-night-' + group + '-2026-09-06.json']) {
    const relative = 'docs/reports/evidence/' + name;
    assert(read(relative).equals(baseline(relative)), name + ': historical ledger modified');
    unchangedOriginalLedgers++;
  }
}
for (const [name, expectedSha] of Object.entries(frozenPriorFiles)) {
  assert.equal(sha(fs.readFileSync(path.join(here, name))), expectedSha, name + ': previous follow-up modified');
}
const fields = q => {
  const { question, choices, answerIndex, explanation } = q;
  return { question, choices, answerIndex, explanation };
};
const rows = groups.flatMap(g => JSON.parse(fs.readFileSync(path.join(here, 'p10-followup2-' + g + '-2026-09-07.json'))).items);
assert.equal(rows.length, 26);
const rowKeys = new Set();
let unchangedPriorRows = 0;
const changedPriorRows = [];
for (const row of rows) {
  const rowKey = row.pack + '/' + row.id;
  assert(!rowKeys.has(rowKey));
  rowKeys.add(rowKey);
  assert.deepEqual(row.currentQuestion, fields(beforeMap.get(rowKey)));
  if (rowKey === key) {
    changedPriorRows.push(row.id);
    assert.notDeepEqual(row.currentQuestion, fields(q));
  } else {
    assert.deepEqual(row.currentQuestion, fields(questionMap.get(rowKey)));
    unchangedPriorRows++;
  }
}
assert.equal(unchangedPriorRows, 25);
assert.deepEqual(changedPriorRows, ['do08']);
const priorUnresolvedIDs = rows.filter(r => r.outcome === 'unresolved').map(r => r.id);
assert.equal(priorUnresolvedIDs.length, 22);
const remainingIDs = priorUnresolvedIDs.filter(id => id !== 'do08').sort();
const expectedRemaining = ['z07','z08','s06','s08','ks08','ks13','kj19','kbn07','zk201','zk203','zk204','zk207','zk211','ky01','ky04','ky18','ky20','ru18','ma07','sk03','sk05'].sort();
assert.deepEqual(remainingIDs, expectedRemaining);

// Extract the actual formatter/copy functions. Stub only the clipboard sink.
const appBytes = read('apps/quiz/app.js');
assert(appBytes.equals(baseline('apps/quiz/app.js')), 'App code changed');
const app = appBytes.toString('utf8');
const start = app.indexOf('function formatQuestionText(q) {');
const end = app.indexOf("btnStart.addEventListener('click', startQuiz);", start);
assert(start >= 0 && end > start);
const copied = [];
const context = vm.createContext({
  NUMBERS: ['①','②','③','④','⑤'], state: { deck: [q], index: 0 },
  btnCopyQuestion: {}, btnCopyAnswer: {}, copyToClipboard: text => copied.push(text),
});
vm.runInContext(app.slice(start, end) + '\ncopyQuestion(); copyAnswer();', context, { timeout: 1000 });
assert.equal(copied.length, 2);
const expectedQuestion = ['【問題】', q.question, ...q.choices.map((c, i) => ['①','②','③'][i] + ' ' + c)].join('\n');
const expectedAnswer = [expectedQuestion, '', '【正解】', '② 架橋', '', '【解説】', q.explanation].join('\n');
assert.equal(copied[0], expectedQuestion);
assert.equal(copied[1], expectedAnswer);
console.log(JSON.stringify({
  result: 'PASS', date: '2026-09-07', baselineCommit, beforeSha256, afterSha256,
  packs: after.length, questions: count, changed, changedFields, unchangedQuestions: count - changed.length,
  position, fixedMetadata: 'ID, difficulty, answerIndex, choice count, question order and all pack metadata',
  before: oldQ, after: q, unchangedOriginalLedgers, frozenPriorFiles,
  priorFollowupRows: rows.length, unchangedPriorRows, changedPriorRows,
  priorUnresolvedCount: priorUnresolvedIDs.length, retiredByApprovedRewrite: ['do08'],
  remainingCount: remainingIDs.length, remainingIDs,
  retirementMeaning: 'Old do08 exclusion claim is removed from the rewritten question, not proven true. Other 21 old residuals are inherited, not reclassified.',
  clipboardTextCheck: 'PASS: actual app functions with clipboard sink stubbed; OS clipboard transfer not tested',
  clipboardTexts: copied,
  limitation: 'Snapshot/data and generated text checks only; does not prove source truth, browser layout, all-question correctness or completion of P-10/C3.',
}, null, 2));
