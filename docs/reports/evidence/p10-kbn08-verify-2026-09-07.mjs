// Historical snapshot verification; future quiz edits intentionally fail the SHA check.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const beforeSha256 = '058162a845442933af2e95caf7442dda5b5a3f4b3d66821a1107db57472b19ae';
const afterSha256 = '7aab68b61b8ebdba4bddc724acd6423ec016f9c2108f15541fbc325d4b826c2b';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const source = fs.readFileSync(path.join(root, 'apps/quiz/questions.js'), 'utf8');
const oldPhrase = '迷いながら道を歩き';
const newPhrase = '迷いながらろばに乗って進み';
assert.equal(sha(source), afterSha256);
assert.equal(source.split(newPhrase).length - 1, 1);
assert.equal(source.split(oldPhrase).length - 1, 0);
const beforeSource = source.replace(newPhrase, oldPhrase);
assert.equal(sha(beforeSource), beforeSha256, 'Unexpected changes beyond the approved phrase');
const parse = async text => (await import('data:text/javascript;base64,' + Buffer.from(text).toString('base64'))).QUIZ_PACKS;
const after = await parse(source);
const before = await parse(beforeSource);
const base = await parse(execFileSync('git', ['show', '3a8b174d07b0e5302aeaf406e75f16fd38d7966e:apps/quiz/questions.js'], { cwd: root, encoding: 'utf8' }));
const changed = [];
const cumulative = [];
let count = 0;
for (let p = 0; p < after.length; p++) {
  const { questions: aq, ...am } = after[p];
  const { questions: bq, ...bm } = before[p];
  assert.deepEqual(am, bm);
  assert.equal(aq.length, bq.length);
  for (let i = 0; i < aq.length; i++) {
    count++;
    const a = aq[i], b = bq[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      assert.equal(a.id, 'kbn08');
      assert.deepEqual(a, { ...b, explanation: b.explanation.replace(oldPhrase, newPhrase) });
      changed.push(a.id);
    }
    if (JSON.stringify(a) !== JSON.stringify(base[p].questions[i])) cumulative.push(a.id);
  }
}
assert.equal(after.length, 24);
assert.equal(count, 480);
assert.deepEqual(changed, ['kbn08']);
assert.deepEqual(cumulative.slice().sort(), ['ky03','s05','ma17','z04','khm03','ru10','khm05','s03','do16','zk210','kbn08'].sort());

// All 40 rows of the prior follow-up remain text-identical; do not rewrite its historical SHA.
let priorFollowupRows = 0;
for (const group of ['science', 'culture', 'dictionary', 'language']) {
  const ledger = JSON.parse(fs.readFileSync(path.join(here, `p10-night-${group}-2026-09-06.json`), 'utf8'));
  assert.equal(ledger.sourceSha256, beforeSha256);
  for (const row of ledger.items) {
    const q = after.find(p => p.id === row.pack).questions.find(q => q.id === row.id);
    const { question, choices, answerIndex, explanation } = q;
    assert.deepEqual(row.currentQuestion, { question, choices, answerIndex, explanation });
    priorFollowupRows++;
  }
}
assert.equal(priorFollowupRows, 40);

const q = after.find(p => p.id === 'kotoba-bunka').questions.find(q => q.id === 'kbn08');
const oldQ = before.find(p => p.id === 'kotoba-bunka').questions.find(q => q.id === 'kbn08');
const app = fs.readFileSync(path.join(root, 'apps/quiz/app.js'), 'utf8');
const start = app.indexOf('function formatQuestionText(q) {');
const end = app.indexOf("btnStart.addEventListener('click', startQuiz);", start);
assert(start >= 0 && end > start);
const copied = [];
const context = vm.createContext({
  NUMBERS: ['①','②','③','④','⑤'], state: { deck: [q], index: 0 },
  btnCopyQuestion: {}, btnCopyAnswer: {}, copyToClipboard: text => copied.push(text),
});
vm.runInContext(app.slice(start, end) + '\ncopyQuestion(); copyAnswer();', context);
const expectedQuestion = ['【問題】', q.question, ...q.choices.map((c, i) => `${['①','②','③'][i]} ${c}`)].join('\n');
assert.equal(copied[0], expectedQuestion);
assert.equal(copied[1], [expectedQuestion, '', '【正解】', '① ' + q.choices[0], '', '【解説】', q.explanation].join('\n'));
console.log(JSON.stringify({
  result: 'PASS', date: '2026-09-07', beforeSha256, afterSha256,
  packs: after.length, questions: count, changed, unchangedQuestions: count - changed.length,
  cumulativeChanged: cumulative, priorFollowupRowsUnchanged: priorFollowupRows,
  before: oldQ, after: q, clipboardTextCheck: 'PASS: real formatter functions with clipboard sink stubbed; OS transfer not tested',
}, null, 2));
