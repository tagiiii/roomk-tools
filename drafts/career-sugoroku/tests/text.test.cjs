/* キャリアすごろく v2 — 画面の文のテスト
   使い方: node drafts/career-sugoroku/tests/text.test.cjs
   text.js の文（しごとマスのポイントの言い方・ゲームの目的）と、画面のファイルに★が残っていないことを確かめる。 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const DIR = path.join(__dirname, '..');
const T = require(path.join(DIR, 'text.js'));
const E = require(path.join(DIR, 'engine.js'));
const D = require(path.join(DIR, 'data.js'));

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
// コメントを除いた中身（コメントの中の★や説明は数えない）
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const stripHtml = (src) => src.replace(/<!--[\s\S]*?-->/g, '');

// 写真家（合う適性は 気づく力・ものづくり・工夫する力）
const PHOTO = 2;
const apt = (kiduku, mono, kufu) => [0, kiduku, mono, 0, 0, kufu];

test('つぎにポイントが上がるには: 1つ・2つ・3つとも・いちばん上', () => {
  assert.strictEqual(T.nextPayText(apt(2, 1, 2), PHOTO), 'ものづくりを2にすると +3');
  assert.strictEqual(T.nextPayText(apt(1, 0, 0), PHOTO), 'ものづくりと工夫する力を1にすると +2');
  assert.strictEqual(T.nextPayText(apt(0, 0, 0), PHOTO), '3つとも1にすると +2');
  assert.strictEqual(T.nextPayText(apt(2, 2, 2), PHOTO), '3つとも3にすると +4');
  assert.strictEqual(T.nextPayText(apt(3, 5, 4), PHOTO), `いちばん上（+${T.PAY_MAX}）`);
});

test('いちばん少ない適性（ふちをつける）: いちばん上のときは出さない', () => {
  assert.deepStrictEqual(T.lowApts(apt(2, 1, 2), PHOTO), [2]);
  assert.deepStrictEqual(T.lowApts(apt(1, 0, 0), PHOTO).sort(), [2, 5]);
  assert.deepStrictEqual(T.lowApts(apt(3, 5, 4), PHOTO), []);
});

test('しごとマスのポイント: いちばん少ない数 +1（+4まで）', () => {
  assert.strictEqual(T.payNow(apt(0, 5, 5), PHOTO), 1);
  assert.strictEqual(T.payNow(apt(1, 5, 5), PHOTO), 2);
  assert.strictEqual(T.payNow(apt(2, 2, 2), PHOTO), 3);
  assert.strictEqual(T.payNow(apt(5, 3, 4), PHOTO), 4);
  assert.strictEqual(T.payRule(), 'しごとマスでもらえるポイントは、その職業に合う適性3つのうち、いちばん少ない数 +1（+4まで）');
  assert.ok(T.payRule(true).endsWith('ほかの適性が多くても、いちばん少ない適性で決まる'));
  assert.strictEqual(T.jobChoiceRule(), 'たまった適性に合う職業ほど、しごとマスでもらえるポイントが多い。ポイントは、その職業に合う適性3つのうち、いちばん少ない数 +1（+4まで）');
});

test('どの職業・どの適性でも、文に★が出ない', () => {
  const samples = [apt(0, 0, 0), [1, 2, 0, 3, 1, 0], [5, 5, 5, 5, 5, 5], [2, 3, 1, 0, 4, 2]];
  D.JOBS.forEach((j) => samples.forEach((a) => {
    [T.nextPayText(a, j.id), T.jobAria(a, j.id)].forEach((t) => assert.ok(!t.includes('★'), t));
  }));
  [T.GAME_AIM, T.payRule(), T.payRule(true), T.jobChoiceRule()].forEach((t) => assert.ok(!t.includes('★'), t));
});

test('ゲームの目的: はじめの画面とあそびかたで同じ文', () => {
  const html = read('index.html');
  assert.ok(html.includes(`子どものころから、おとなになるまでを、すごろくで進むゲーム。${T.GAME_AIM}`), 'はじめの画面の文が text.js の GAME_AIM と違う');
  assert.ok(read('ui.js').includes('すごろくで進むゲーム。${GAME_AIM}'), 'あそびかたが GAME_AIM を使っていない');
});

test('画面のファイルに★と★のアイコンが残っていない（コメントを除く）', () => {
  ['ui.js', 'text.js'].forEach((f) => {
    const code = stripJs(read(f));
    assert.ok(!code.includes('★'), `${f} に★がある`);
    assert.ok(!/['"]stars?['"]/.test(code), `${f} に★のアイコン（star / stars）がある`);
  });
  const html = stripHtml(read('index.html'));
  assert.ok(!html.includes('★'), 'index.html に★がある');
  // 画面で読み込む順（text.js は engine.js のあと、ui.js の前）
  const order = ['data.js', 'engine.js', 'text.js', 'ui.js'].map((f) => html.indexOf(`<script src="${f}`));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), 'script の順番がちがう');
});

test('「目標の職業」の残りがない（2026-09-29 にやめた）', () => {
  ['ui.js', 'text.js', 'engine.js'].forEach((f) => {
    const code = stripJs(read(f));
    assert.ok(!/goalOf|setGoal|goalButton|目標の職業|目標に合う|目標にする/.test(code.replace(/startsWith\('目標の職業を'\)/, '')), `${f} に目標の職業の残りがある`);
  });
  assert.ok(!('goal' in E.newGame({ names: ['a'] }).players[0]));
});

for (const t of tests) {
  try {
    t.fn();
    passed++;
    console.log('  ok  ' + t.name);
  } catch (e) {
    console.log('  NG  ' + t.name);
    console.log(e.stack.split('\n').slice(0, 4).join('\n'));
  }
}
console.log(`\n${passed}/${tests.length} 件合格`);
if (passed !== tests.length) process.exitCode = 1;
