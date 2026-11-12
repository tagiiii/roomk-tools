// そろってゴール（試作）のルールのテスト。node drafts/sorotte-goal/engine.test.cjs
'use strict';
const assert = require('assert');
const E = require('./engine.js');

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('ok', n, name); };
const go = (S, who, ...dirs) => dirs.reduce((s, d) => E.move(s, who, d), S);

// はば優先で、いちばん少ない歩数でクリアできるかを調べる。only を渡すと、その人だけが動く
function solve(stage, only) {
  const start = E.createStage(stage);
  const key = (S) => JSON.stringify([S.players, S.boxes, S.keys, S.open]);
  const seen = new Set([key(start)]);
  let frontier = [start];
  for (let depth = 0; frontier.length && depth < 200; depth += 1) {
    const next = [];
    for (const S of frontier) {
      if (S.cleared) return depth;
      for (let who = 0; who < E.PLAYERS; who += 1) {
        if (only != null && who !== only) continue;
        for (const dir of Object.keys(E.DIRS)) {
          const N = E.move(S, who, dir);
          if (N === S) continue;
          const k = key(N);
          if (seen.has(k)) continue;
          seen.add(k);
          next.push(N);
        }
      }
    }
    frontier = next;
  }
  return -1;
}

t('どのステージも、2人ならクリアできる', () => {
  E.STAGES.forEach((st, i) => {
    const steps = solve(i);
    console.log('   ステージ' + (i + 1) + '「' + st.name + '」: いちばん少なくて ' + steps + ' 歩');
    assert.ok(steps > 0, st.name);
  });
});

t('どのステージも、1人だけではクリアできない（協力が要る）', () => {
  E.STAGES.forEach((st, i) => {
    assert.strictEqual(solve(i, 0), -1, st.name + ' 1人目だけ');
    assert.strictEqual(solve(i, 1), -1, st.name + ' 2人目だけ');
  });
});

t('かべ・ほかの人のいるマスには入れない', () => {
  const S = E.createStage(0);
  assert.strictEqual(E.move(S, 0, 'up'), S);
  assert.strictEqual(E.move(S, 0, 'left'), S);
  const S1 = go(S, 0, 'down');
  assert.strictEqual(E.move(S1, 0, 'down'), S1); // 2人目がいる
  assert.strictEqual(S1.rev, 1);
});

t('とびら: スイッチに乗っている間だけ通れる。通っている途中に閉じても、出られる', () => {
  let S = E.createStage(0);
  S = go(S, 0, 'down', 'right', 'right');           // 1人目がとびらの前 (3,2)
  assert.strictEqual(E.doorOpen(S, 4, 2), false);
  assert.strictEqual(E.move(S, 0, 'right'), S);
  S = go(S, 1, 'right');                             // 2人目がスイッチ (2,3)
  assert.strictEqual(E.doorOpen(S, 4, 2), true);
  S = go(S, 0, 'right');                             // とびらの中
  S = go(S, 1, 'left');                              // スイッチからおりる
  assert.strictEqual(E.doorOpen(S, 4, 2), false);
  const out = go(S, 0, 'right');
  assert.deepStrictEqual([out.players[0].x, out.players[0].y], [5, 2]);
});

t('重い箱: 1人では動かない。うしろから押してもらうと、3つそろって1マス進む。スイッチに乗るととびらが開く', () => {
  let S = E.createStage(1);
  S = go(S, 0, 'down', 'right', 'right', 'right', 'right'); // 1人目が箱の手前 (5,2)
  assert.strictEqual(E.move(S, 0, 'right'), S);
  S = go(S, 1, 'up', 'right', 'right', 'right');             // 2人目がうしろ (4,2)
  const P = go(S, 0, 'right');
  assert.deepStrictEqual(P.boxes[0], [7, 2]);
  assert.deepStrictEqual([P.players[0].x, P.players[1].x], [6, 5]);
  assert.strictEqual(E.doorOpen(P, 10, 2), false);
  const Q = go(P, 0, 'right');
  assert.deepStrictEqual(Q.boxes[0], [8, 2]);
  assert.strictEqual(E.doorOpen(Q, 10, 2), true);
  // うしろの人が押す側になっても動かない（前の人がじゃま）
  assert.strictEqual(E.move(Q, 1, 'right'), Q);
});

t('橋とカギ: 橋は同じ番号の人だけ。カギがないと、かぎつきのとびらは開かない。開けるとカギはなくなる', () => {
  let S = E.createStage(2);
  S = go(S, 0, 'right', 'right');
  const onBridge = go(S, 0, 'right');
  assert.strictEqual(onBridge.players[0].x, 4);
  let T = go(E.createStage(2), 1, 'up', 'up', 'right', 'right');
  assert.strictEqual(E.move(T, 1, 'right'), T);              // 2人目は1人目の橋を渡れない
  // 2人目がスイッチへ、1人目がカギを取ってとびらを開ける
  S = go(E.createStage(2), 1, 'right', 'right', 'right', 'right', 'right', 'right');
  assert.strictEqual(E.held(S, 'a'), true);
  S = go(S, 0, 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right');
  assert.strictEqual(S.players[0].key, true);
  assert.strictEqual(S.keys.length, 0);
  S = go(S, 0, 'right', 'right');
  assert.deepStrictEqual(S.open, [[12, 1]]);
  assert.strictEqual(S.players[0].key, false);
});

t('2人ともゴールに入るとクリア。クリアのあとは動かない', () => {
  let S = E.createStage(0);
  S = go(S, 1, 'right');
  S = go(S, 0, 'down', 'right', 'right', 'right', 'right', 'down');   // 1人目がまん中のスイッチ (5,3)
  S = go(S, 1, 'up', 'right', 'right', 'right', 'right', 'down');     // 2人目がさんかくのスイッチ (6,3)
  S = go(S, 0, 'up', 'right', 'right', 'right', 'right', 'down');     // 1人目が右のスイッチ (9,3)
  S = go(S, 1, 'up', 'right', 'right', 'right', 'right', 'up', 'right');
  assert.strictEqual(S.cleared, false);
  S = go(S, 0, 'right', 'right');
  assert.strictEqual(S.cleared, true);
  assert.strictEqual(E.move(S, 0, 'left'), S);
});

console.log('all ' + n + ' passed');
