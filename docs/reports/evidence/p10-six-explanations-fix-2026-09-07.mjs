// Historical snapshot: only the six approved explanation edits are permitted.
// Old followup3 verification remains frozen and intentionally fails after source edits.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const baselineCommit = '6afcb707378e4bcc3121b778d1102e51e36b9f5d';
const beforeSha256 = '18d6abfe00f2348a1c182342c11992ec4a77d4d8a3fb40376724d84dc2fe5dc1';
const afterSha256 = 'b1c59407e8d22b0a99cfe178bb1e24122e67a9a28172ad253376def1638f3c42';
const approved = {
  "ky01": "「口が重い」は、口数が少なくなかなか話さない様子。",
  "ky04": "猫の手でも借りたいほど忙しい、という意味。",
  "ky18": "「手を焼く」は、手に負えずに苦労すること。",
  "ky20": "「口がかたい」は秘密を守れるということ。「口が重い」は、口数が少なくなかなか話さないこと。",
  "sk03": "「この」の直後に「ノート」と続いているので、指しているのは「ノート」。",
  "sk05": "「耳が痛い」は自分の失敗や弱点を指摘されて、聞くのがつらいという意味。"
};
const frozenPriorEvidence = {
  "p10-culture-2026-09-06.json": "e04d364da71aa135cedb30e959f9de8edb7a38e3e3c090686929827cb0494908",
  "p10-dictionary-2026-09-06.json": "27d059ac3f5d1c56a649f970d9b68e78feb1529138238ea0166660739d9d5869",
  "p10-do08-fix-2026-09-07.json": "54242684d398abaf62a4464a21db9a27ca10ca8ee34ab1b250690081f679a7c2",
  "p10-do08-verify-2026-09-07.mjs": "d73d7c2e208d5b104ec8fb4487b9cb11365d62f2c2b428d3eec808d91707b798",
  "p10-followup2-culture-2026-09-07.json": "4ac55dc83a540702b31158a7e13305e814b728a478397254a68100a8b56ebf9a",
  "p10-followup2-dictionary-2026-09-07.json": "c395a9381b89b8f7145009840cbfbd0b0f048d5029cf1416de414dc5a9cdb901",
  "p10-followup2-language-2026-09-07.json": "e49145d65b9944b9fd6f6dd47c216b31f0beb52bc3f518ebb9cbf437d182e4cb",
  "p10-followup2-science-2026-09-07.json": "cc7c81ebfa38003095d04de0e02619f9364599ec384bb5fecef0f7c15ede3744",
  "p10-followup2-verify-2026-09-07.mjs": "c5ed67e4cea83c827181851acf6cd747b009b8a78f6fcf127cdb84504eb78be2",
  "p10-followup3-culture-2026-09-07.json": "07ec2ef6d8b81557bfac0ecaafece551b4469feae9acdc286173e95a8848bf34",
  "p10-followup3-dictionary-2026-09-07.json": "8157240dbfb8c0f2b3aa2ad22a7a804e713037eff7e2c91cc94364eb1ca46b93",
  "p10-followup3-language-2026-09-07.json": "c1a582f739c28fad87777f339942926ef8cb6fbe9a0ba18b7287c6677ceb31f6",
  "p10-followup3-science-2026-09-07.json": "12ebadb8d442ffbaa1c011d1d26964674f1e52910ebcf02b7bbd305f1b428bd5",
  "p10-followup3-verify-2026-09-07.mjs": "dd52bed46764ef19250076f77ee8df20eaf532fa2529ec38af2f8a5bea09f991",
  "p10-kbn08-fix-2026-09-07.json": "88e064f8990f6c9ebe4a5c2baaa4d2b2de60e3aed867bcd813b4d74137784a05",
  "p10-kbn08-verify-2026-09-07.mjs": "9eba22de30473bb8cbdacd853deac9057eed6d1c7fbbf5278b942e567b17c8d5",
  "p10-language-2026-09-06.json": "d2775a5c8e532394cbd93f11e12abfa22204363a1a40be2f189dfa747b45ec4f",
  "p10-manifest-2026-09-06.json": "a78b3e808509cb48bbc7ec6640dc8c3b41d6c20f9eaae8d318bf51750838a1e4",
  "p10-night-culture-2026-09-06.json": "cc6a85378ea9ace593f605e6aeef9627f59e45f5b277fb2af88987beb1642d1e",
  "p10-night-dictionary-2026-09-06.json": "39203492186db037d1e61630753fcd4fd588709d71bc9856cacd791f6b470dbb",
  "p10-night-language-2026-09-06.json": "12c7bcf2dbcbd929186a04e01f2894f51334b30d47c14f806367d9811abc43dd",
  "p10-night-science-2026-09-06.json": "4c619cf65bfacb4c941852f66551918699d1ecf2d0c038476ea78f261a858371",
  "p10-night-verify-2026-09-06.mjs": "775819d383e2b0cf2a4d32ff1a027ae4cba6c5b97d2380bcd29e82f7e528b7e4",
  "p10-priority-fixes-2026-09-06.json": "10a9093b81c1fb6945bd25959c19b33f44f837276eaf612785d882c97b71a0d3",
  "p10-science-2026-09-06.json": "c4605053100911f3a3dafd62cdae9cd1fd71f2b78e9abaf0de56a60382732da1",
  "p10-second-fixes-2026-09-06.json": "19198ccf3026c5c4010407858538a81654a1a00d03f6888fcb6151998957dc2a"
};
const read = file => fs.readFileSync(path.join(root, file));
const baseline = file => execFileSync('git', ['show', baselineCommit + ':' + file], { cwd: root });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = async bytes => (await import('data:text/javascript;base64,' + bytes.toString('base64'))).QUIZ_PACKS;
const beforeSource = baseline('apps/quiz/questions.js');
const afterSource = read('apps/quiz/questions.js');
assert.equal(sha(beforeSource), beforeSha256);
assert.equal(sha(afterSource), afterSha256, 'Not the approved six-explanation snapshot');
const before = await parse(beforeSource);
const after = await parse(afterSource);
assert.equal(before.length, 24);
assert.equal(after.length, 24);
const approvedIDs = Object.keys(approved).sort();
assert.equal(approvedIDs.length, 6);
const changed = [];
const positions = {};
const currentByID = new Map();
const priorByID = new Map();
let expectedSource = beforeSource.toString('utf8');
let count = 0;
for (let p = 0; p < before.length; p++) {
  const { questions: bq, ...bm } = before[p];
  const { questions: aq, ...am } = after[p];
  assert.deepEqual(am, bm, 'Pack metadata or pack order changed');
  assert.equal(aq.length, bq.length);
  for (let i = 0; i < bq.length; i++) {
    const a = aq[i], b = bq[i];
    count++;
    assert.equal(a.id, b.id, 'Question ID or position changed');
    assert(!currentByID.has(a.id), 'Duplicate question ID');
    currentByID.set(a.id, a);
    priorByID.set(b.id, b);
    if (Object.hasOwn(approved, a.id)) {
      assert.deepEqual(a, { ...b, explanation: approved[a.id] }, a.id + ': unapproved field change');
      assert.notEqual(a.explanation, b.explanation);
      const changedFields = Object.keys(a).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
      assert.deepEqual(changedFields, ['explanation']);
      const oldLiteral = "explanation: '" + b.explanation + "'";
      const newLiteral = "explanation: '" + approved[a.id] + "'";
      assert.equal(expectedSource.split(oldLiteral).length - 1, 1, a.id + ': ambiguous source literal');
      expectedSource = expectedSource.replace(oldLiteral, newLiteral);
      changed.push(a.id);
      positions[a.id] = { pack: am.id, packIndex: p, questionIndex: i, difficulty: a.difficulty, answerIndex: a.answerIndex };
    } else {
      assert.deepEqual(a, b, a.id + ': other question changed');
    }
  }
}
assert.equal(count, 480);
assert.equal(currentByID.size, 480);
assert.deepEqual([...changed].sort(), approvedIDs);
assert.equal(afterSource.toString('utf8'), expectedSource, 'Source has other byte edits');
assert.equal(count - changed.length, 474);

// Freeze all 26 pre-existing P-10 evidence JSON/validators, including dirty followup3 files.
for (const [name, expected] of Object.entries(frozenPriorEvidence)) {
  assert.equal(sha(fs.readFileSync(path.join(here, name))), expected, name + ': historical evidence changed');
}
assert.equal(Object.keys(frozenPriorEvidence).length, 26);
const report = read('docs/reports/p10-followup3-2026-09-07.md').toString('utf8');
for (const id of approvedIDs) {
  const row = report.split('\n').find(line => line.startsWith('| ' + id + ' |'));
  assert(row, id + ': approved proposal row missing');
  assert.equal(row.split('|')[3].trim(), approved[id], id + ': approved report wording mismatch');
}

// Old residual rows remain historical; only six unsupported explanation passages are removed.
const groups = ['science', 'culture', 'dictionary', 'language'];
const rows = groups.flatMap(g => JSON.parse(fs.readFileSync(path.join(here, 'p10-followup3-' + g + '-2026-09-07.json'))).items);
assert.equal(rows.length, 21);
assert.equal(new Set(rows.map(r => r.id)).size, 21);
const fields = q => {
  const { question, choices, answerIndex, explanation } = q;
  return { question, choices, answerIndex, explanation };
};
for (const row of rows) {
  assert.deepEqual(row.currentQuestion, fields(priorByID.get(row.id)), row.id + ': prior row mismatch');
  if (!Object.hasOwn(approved, row.id)) assert.deepEqual(row.currentQuestion, fields(currentByID.get(row.id)));
  else assert.equal(row.outcome, 'unresolved');
}
const priorUnresolved = rows.filter(r => r.outcome === 'unresolved').map(r => r.id).sort();
assert.equal(priorUnresolved.length, 19);
const remainingIDs = priorUnresolved.filter(id => !Object.hasOwn(approved, id));
const expectedRemaining = ['kbn07','kj19','ks08','ks13','ru18','s06','s08','z07','z08','zk201','zk203','zk204','zk211'].sort();
assert.deepEqual(remainingIDs, expectedRemaining);

// Run the unchanged application's real formatter/copy functions with a sink stub.
// This checks generated strings, NOT OS clipboard transfer or browser layout.
const appBytes = read('apps/quiz/app.js');
assert(appBytes.equals(baseline('apps/quiz/app.js')), 'App logic changed');
const app = appBytes.toString('utf8');
const start = app.indexOf('function formatQuestionText(q) {');
const end = app.indexOf("btnStart.addEventListener('click', startQuiz);", start);
assert(start >= 0 && end > start, 'Cannot locate actual copy functions');
const numbers = ['①', '②', '③', '④', '⑤'];
const clipboardTexts = [];
for (const id of approvedIDs) {
  const q = currentByID.get(id);
  const copied = [];
  const context = vm.createContext({
    NUMBERS: numbers,
    state: { deck: [q], index: 0 },
    btnCopyQuestion: {}, btnCopyAnswer: {},
    copyToClipboard: text => copied.push(text),
  });
  vm.runInContext(app.slice(start, end) + '\ncopyQuestion(); copyAnswer();', context, { timeout: 1000 });
  assert.equal(copied.length, 2);
  const expectedQuestion = ['【問題】', q.question, ...q.choices.map((c, i) => numbers[i] + ' ' + c)].join('\n');
  const expectedAnswer = [expectedQuestion, '', '【正解】', numbers[q.answerIndex] + ' ' + q.choices[q.answerIndex], '', '【解説】', approved[id]].join('\n');
  assert.equal(copied[0], expectedQuestion);
  assert.equal(copied[1], expectedAnswer);
  clipboardTexts.push({ id, question: copied[0], answer: copied[1] });
}
console.log(JSON.stringify({
  result: 'PASS', date: '2026-09-07', baselineCommit, beforeSha256, afterSha256,
  packs: after.length, questions: count, changed, changedFields: ['explanation'],
  unchangedQuestions: count - changed.length, positions,
  approvedWordingMatchesReport: true, sourceOnlyApprovedByteReplacements: true,
  preservedPriorEvidenceFiles: Object.keys(frozenPriorEvidence).length,
  priorUnresolvedCount: priorUnresolved.length, retiredByApprovedWording: approvedIDs,
  remainingCount: remainingIDs.length, remainingIDs,
  retirementMeaning: 'Six unsupported explanation passages removed by approved wording; their old claims are not proven true. Remaining IDs are not error counts or total backlog counts.',
  clipboardTextCheck: 'PASS: actual copy functions with clipboard sink stub; OS clipboard not tested',
  clipboardTexts,
  limits: 'Snapshot, structure and generated strings only. Does not prove source truth, UI layout, approval of other proposals, or completion of P-10/C3.',
}, null, 2));
