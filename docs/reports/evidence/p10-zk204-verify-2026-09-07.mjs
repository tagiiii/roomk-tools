// Fixed snapshot of the approved zk204-only explanation change.
// Prior validators/evidence remain historical and must not be rewritten to pass.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const publishedBaseline = '6afcb707378e4bcc3121b778d1102e51e36b9f5d';
const publishedSha256 = '18d6abfe00f2348a1c182342c11992ec4a77d4d8a3fb40376724d84dc2fe5dc1';
const beforeSha256 = 'b1c59407e8d22b0a99cfe178bb1e24122e67a9a28172ad253376def1638f3c42';
const afterSha256 = 'ea1cfedccfcc22a577379f7d06b09f73c8c9e92686f8a2a3f7ab8adf68f993e4';
const priorSixApproved = {
  "ky01": "「口が重い」は、口数が少なくなかなか話さない様子。",
  "ky04": "猫の手でも借りたいほど忙しい、という意味。",
  "ky18": "「手を焼く」は、手に負えずに苦労すること。",
  "ky20": "「口がかたい」は秘密を守れるということ。「口が重い」は、口数が少なくなかなか話さないこと。",
  "sk03": "「この」の直後に「ノート」と続いているので、指しているのは「ノート」。",
  "sk05": "「耳が痛い」は自分の失敗や弱点を指摘されて、聞くのがつらいという意味。"
};
const approvedExplanation = "ドイツ語は単語と単語をつなげて新しい単語（複合語）を作りやすい言語。日本語の「消しゴム」「歯ブラシ」のように、2つの単語を組み合わせてできることば自体は日本語にもよくある。";
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
  "p10-second-fixes-2026-09-06.json": "19198ccf3026c5c4010407858538a81654a1a00d03f6888fcb6151998957dc2a",
  "p10-six-explanations-fix-2026-09-07.mjs": "25f343a613258acc64374bb9bd675035aff0d5456fb555b1b384a907ba19fd5b"
};
const read = file => fs.readFileSync(path.join(root, file));
const baseline = file => execFileSync('git', ['show', publishedBaseline + ':' + file], { cwd: root });
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const parse = async bytes => (await import('data:text/javascript;base64,' + Buffer.from(bytes).toString('base64'))).QUIZ_PACKS;
const originalSource = baseline('apps/quiz/questions.js');
assert.equal(sha(originalSource), publishedSha256);
const originalPacks = await parse(originalSource);
const originalByID = new Map(originalPacks.flatMap(p => p.questions.map(q => [q.id, q])));

// The uncommitted before snapshot is reconstructed from the fixed published
// baseline plus the six previously approved exact substitutions, then SHA checked.
let beforeText = originalSource.toString('utf8');
for (const [id, explanation] of Object.entries(priorSixApproved)) {
  const original = originalByID.get(id);
  assert(original);
  const oldLiteral = "explanation: '" + original.explanation + "'";
  assert.equal(beforeText.split(oldLiteral).length - 1, 1);
  beforeText = beforeText.replace(oldLiteral, "explanation: '" + explanation + "'");
}
assert.equal(Object.keys(priorSixApproved).length, 6);
assert.equal(sha(beforeText), beforeSha256, 'Reconstructed before snapshot differs');
const before = await parse(beforeText);
const afterSource = read('apps/quiz/questions.js');
assert.equal(sha(afterSource), afterSha256);
const after = await parse(afterSource);
assert.equal(before.length, 24);
assert.equal(after.length, 24);
const current = new Map();
const previous = new Map();
const changed = [];
let count = 0;
let position;
for (let p = 0; p < before.length; p++) {
  const { questions: bq, ...bm } = before[p];
  const { questions: aq, ...am } = after[p];
  assert.deepEqual(am, bm, 'Pack metadata/order changed');
  assert.equal(aq.length, bq.length);
  for (let i = 0; i < bq.length; i++) {
    const a = aq[i], b = bq[i];
    count++;
    assert.equal(a.id, b.id, 'Question ID/order changed');
    assert(!current.has(a.id), 'Duplicate ID');
    current.set(a.id, a);
    previous.set(b.id, b);
    if (a.id === 'zk204') {
      assert.deepEqual(a, { ...b, explanation: approvedExplanation }, 'Unapproved zk204 change');
      assert.equal(a.answerIndex, 0);
      assert.equal(a.difficulty, 2);
      assert.equal(am.id, 'zatsugaku-king-2');
      position = { packIndex: p, questionIndex: i };
    } else {
      assert.deepEqual(a, b, a.id + ': other question changed');
    }
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(a.id);
  }
}
assert.equal(count, 480);
assert.equal(current.size, 480);
assert.deepEqual(changed, ['zk204']);
const q = current.get('zk204'), oldQ = previous.get('zk204');
const changedFields = Object.keys(q).filter(k => JSON.stringify(q[k]) !== JSON.stringify(oldQ[k]));
assert.deepEqual(changedFields, ['explanation']);
assert.equal(q.explanation.slice(q.explanation.indexOf('日本語の')), oldQ.explanation.slice(oldQ.explanation.indexOf('日本語の')));
const oldLiteral = "explanation: '" + oldQ.explanation + "'";
assert.equal(beforeText.split(oldLiteral).length - 1, 1);
const expectedText = beforeText.replace(oldLiteral, "explanation: '" + approvedExplanation + "'");
assert.equal(afterSource.toString('utf8'), expectedText, 'Other source bytes changed');
for (const [id, text] of Object.entries(priorSixApproved)) assert.equal(current.get(id).explanation, text);

// SHA preservation includes all 27 pre-existing evidence JSON/validators,
// including the prior six-fix validator whose old source SHA now intentionally fails.
assert.equal(Object.keys(frozenPriorEvidence).length, 27);
for (const [name, expected] of Object.entries(frozenPriorEvidence)) {
  assert.equal(sha(fs.readFileSync(path.join(here, name))), expected, name + ': old evidence changed');
}
const groups = ['science', 'culture', 'dictionary', 'language'];
const rows = groups.flatMap(g => JSON.parse(fs.readFileSync(path.join(here, 'p10-followup3-' + g + '-2026-09-07.json'))).items);
assert.equal(rows.length, 21);
assert.equal(new Set(rows.map(r => r.id)).size, 21);
const fields = q => {
  const { question, choices, answerIndex, explanation } = q;
  return { question, choices, answerIndex, explanation };
};
for (const row of rows) {
  assert.deepEqual(row.currentQuestion, fields(originalByID.get(row.id)));
  if (!Object.hasOwn(priorSixApproved, row.id) && row.id !== 'zk204') {
    assert.deepEqual(row.currentQuestion, fields(current.get(row.id)));
  }
}
const oldUnresolved = rows.filter(r => r.outcome === 'unresolved').map(r => r.id).sort();
assert.equal(oldUnresolved.length, 19);
const beforeRemaining = oldUnresolved.filter(id => !Object.hasOwn(priorSixApproved, id));
assert.equal(beforeRemaining.length, 13);
assert(beforeRemaining.includes('zk204'));
const remainingIDs = beforeRemaining.filter(id => id !== 'zk204');
assert.deepEqual(remainingIDs, ['kbn07','kj19','ks08','ks13','ru18','s06','s08','z07','z08','zk201','zk203','zk211'].sort());

// Actual unchanged formatter/copy code, only clipboard sink stubbed.
const appBytes = read('apps/quiz/app.js');
assert(appBytes.equals(baseline('apps/quiz/app.js')), 'App logic changed');
const app = appBytes.toString('utf8');
const start = app.indexOf('function formatQuestionText(q) {');
const end = app.indexOf("btnStart.addEventListener('click', startQuiz);", start);
assert(start >= 0 && end > start);
const numbers = ['①','②','③','④','⑤'];
const copied = [];
const context = vm.createContext({
  NUMBERS: numbers, state: { deck: [q], index: 0 },
  btnCopyQuestion: {}, btnCopyAnswer: {}, copyToClipboard: text => copied.push(text),
});
vm.runInContext(app.slice(start, end) + '\ncopyQuestion(); copyAnswer();', context, { timeout: 1000 });
assert.equal(copied.length, 2);
const expectedQuestion = ['【問題】', q.question, ...q.choices.map((c, i) => numbers[i] + ' ' + c)].join('\n');
const expectedAnswer = [expectedQuestion, '', '【正解】', '① 複合語（合成語）', '', '【解説】', approvedExplanation].join('\n');
assert.equal(copied[0], expectedQuestion);
assert.equal(copied[1], expectedAnswer);
assert(!copied[1].includes('ギネス'));
console.log(JSON.stringify({
  result: 'PASS', date: '2026-09-07', publishedBaseline, publishedSha256, beforeSha256, afterSha256,
  beforeReconstruction: 'Published baseline plus six prior approved substitutions; full SHA verified',
  packs: after.length, questions: count, changed, changedFields, unchangedQuestions: count - changed.length,
  sourceOnlyApprovedByteReplacement: true, priorSixChangesPreserved: Object.keys(priorSixApproved),
  position, before: oldQ, after: q, preservedPriorEvidenceFiles: Object.keys(frozenPriorEvidence).length,
  priorUnresolvedCount: beforeRemaining.length, retiredByApprovedWording: ['zk204'],
  remainingCount: remainingIDs.length, remainingIDs,
  retirementMeaning: 'Unsupported Guinness publication aside removed, not proven false. Remaining IDs are not error totals or total backlog counts.',
  clipboardTextCheck: 'PASS: real copy functions with sink stub; OS clipboard transfer not tested',
  clipboardTexts: copied,
  limits: 'Fixed snapshot/data/generated strings only; not UI, source truth, deployment, or completion of P-10/C3.',
}, null, 2));
