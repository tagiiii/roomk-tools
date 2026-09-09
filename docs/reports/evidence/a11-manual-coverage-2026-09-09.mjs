// This checks report coverage and source identity, not security or escape correctness.
// Historical evidence: source changes should fail, not silently refresh these hashes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const scan = JSON.parse(execFileSync('python3', ['scripts/sec1-dataflow.py', '--json'], {
  cwd: root, encoding: 'utf8',
}));
assert.equal(scan.files, 71);
assert.equal(scan.errors, 0);
assert.equal(scan.unknown, 44);
assert.equal(scan.checkedBareReferences, 44);
assert.equal(scan.findings.length, 44);
assert.ok(scan.findings.every(f => f.state === 'unknown'));

const groups = [
  ['network', 19, 'index.html'],
  ['mixed', 14, null],
  ['local', 11, 'app.js'],
];
const covered = [];
const hashes = new Map();
for (const [group, expected, fileName] of groups) {
  const report = readFileSync(new URL(`../a11-manual-${group}-review-2026-09-09.md`, import.meta.url), 'utf8');
  const rows = [];
  for (const line of report.split('\n')) {
    const row = fileName
      ? line.match(/^\| (?:\d+|C\d+) \| ([\w-]+):(\d+) `([^`]+)` \|/)
      : line.match(/^\| `(apps\/[\w-]+\/[^`]+):(\d+)` \| `([^`]+)` \|/);
    if (row) rows.push({
      file: fileName ? `apps/${row[1]}/${fileName}` : row[1],
      line: Number(row[2]), reference: row[3], state: 'unknown',
    });
    const hashRow = line.replaceAll('`', '').match(/^\| (apps\/[^| ]+) \| ([a-f0-9]{64}) \|$/);
    if (hashRow) {
      const [, file, sha] = hashRow;
      if (hashes.has(file)) assert.equal(hashes.get(file), sha, `inconsistent SHA: ${file}`);
      const actual = createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
      assert.equal(actual, sha, `source changed: ${file}`);
      hashes.set(file, sha);
    }
  }
  assert.equal(rows.length, expected, `${group} row count`);
  covered.push(...rows);
}
const key = f => `${f.file}:${f.line}:${f.reference}`;
assert.equal(new Set(covered.map(key)).size, 44, 'duplicate report row');
const sorted = rows => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
assert.deepEqual(sorted(covered), sorted(scan.findings), 'report/scanner mismatch');
assert.ok(covered.every(f => hashes.has(f.file)), 'missing source SHA');
const expectedPaths = [
  'apps/do-mannaka/index.html', 'apps/jinro/index.html',
  'apps/kakure-number/index.html', 'apps/name-change/index.html',
  'apps/tatoe-gp/index.html', 'apps/kotoba-pair/index.html',
  'apps/kotoba-shuffle/app.js', 'apps/kotoba-tantei/app.js',
  'apps/kyoumi-sugoroku/app.js', 'apps/quiz/app.js',
  'apps/suki-type-check/app.js', 'apps/talk-card/app.js', 'apps/value-card/app.js',
  'apps/shared/js/utils.js', 'apps/shared/js/rtdb-utils.js',
  'apps/kotoba-pair/packs.js', 'apps/kotoba-shuffle/words.js',
  'apps/kotoba-tantei/words.js', 'apps/kotoba-tantei/service.js',
  'apps/quiz/questions.js',
];
assert.equal(expectedPaths.length, 20);
assert.deepEqual([...hashes.keys()].sort(), expectedPaths.sort(), 'dependency path set mismatch');
assert.equal(new Set(covered.map(f => f.file.split('/')[1])).size, 13);
console.log(JSON.stringify({
  result: 'PASS', references: 44, apps: 13, groups: [19, 14, 11],
  hashedFiles: hashes.size, scannerUnknown: 44,
  limit: 'Coverage and source identity only; not a security classifier or proof.',
}, null, 2));
