// ぴったりビートの決まり（apps/pittari-beat/engine.js）を確かめる。音も画面も使わない。
// 実行: node tests/pittari-beat/engine.test.mjs
import {
  COURSES, TRACKS, JUDGE, POINTS, CLICK_MEASURES, OFFSET_MIN, OFFSET_MAX, CALIB_BPM,
  buildChart, createState, hit, sweepMisses, score, isFinished, estimateOffset, rankPlayers,
} from '../../apps/pittari-beat/engine.js';

let pass = 0;
let fail = 0;
const ok = (c, name, extra) => {
  if (c) pass++;
  else { fail++; console.log('  NG', name, extra === undefined ? '' : JSON.stringify(extra)); }
};

function consistent(st, label) {
  const judged = st.notes.filter((n) => n.result !== null).length;
  ok(st.perfect + st.good + st.miss === judged, label + ': 回数の合計＝判定ずみの数', { p: st.perfect, g: st.good, m: st.miss, judged });
  ok(st.notes.filter((n) => n.result === 'perfect').length === st.perfect, label + ': ぴったりの数が合う');
  ok(st.notes.filter((n) => n.result === 'good').length === st.good, label + ': いいねの数が合う');
  ok(score(st) === st.perfect * POINTS.perfect + st.good * POINTS.good, label + ': 点数＝回数から出した値');
  ok(st.maxCombo <= st.perfect + st.good, label + ': つづけた回数は当てた数以下');
}

// 1. 譜面
for (const tr of TRACKS) {
  for (const c of COURSES) {
    const ch = buildChart(tr, c.id);
    const label = tr.id + '/' + c.id;
    ok(ch.notes.length > 0, label + ': しるしがある');
    ok(ch.notes.every((n, i) => i === 0 || n.t >= ch.notes[i - 1].t), label + ': 時刻の順に並ぶ');
    ok(ch.notes.every((n) => n.t >= ch.start - 1e-9 && n.t < ch.musicEnd), label + ': カウントのあと・曲のおわりまで');
    ok(ch.notes.every((n) => n.lane >= 0 && n.lane < c.lanes), label + ': 列の数に合う', c.lanes);
    if (c.id === 'easy') ok(ch.notes.every((n) => n.lane === 0), label + ': やさしいは1種類だけ');
    else ok(new Set(ch.notes.map((n) => n.lane)).size === 2, label + ': 2種類が出る');
    const sameLaneGap = Math.min(...[0, 1].flatMap((l) => {
      const ts = ch.notes.filter((n) => n.lane === l).map((n) => n.t);
      return ts.slice(1).map((t, i) => t - ts[i]);
    }).concat([Infinity]));
    ok(sameLaneGap >= ch.eighth - 1e-9, label + ': 同じ列のしるしは8分音符より近づかない');
    const again = buildChart(tr, c.id);
    ok(JSON.stringify(again.notes) === JSON.stringify(ch.notes), label + ': 何度作っても同じ譜面');
    if (tr.music) {
      ok(ch.musicEnd === tr.music.length, label + ': 曲の長さ＝ファイルの長さ');
      ok(Math.abs(ch.notes[0].t - (tr.music.firstBeat + tr.music.introBeats * ch.beat)) < 1e-9, label + ': 前奏のあとから始まる');
      ok(ch.notes[ch.notes.length - 1].t < tr.music.length - 2, label + ': 曲がおわる2秒前までにおわる');
    } else ok(Math.abs(ch.musicEnd - ch.start - CLICK_MEASURES * ch.bar) < 1e-9, label + ': 曲の長さ');
  }
  const counts = COURSES.map((c) => buildChart(tr, c.id).notes.length);
  ok(counts[0] < counts[1] && counts[1] < counts[2], tr.id + ': むずかしいほどしるしが多い', counts);
}

// 2. ぴったりにたたくと全部ぴったり・最高点
for (const c of COURSES) {
  const ch = buildChart(TRACKS.find((t) => t.id === 'mid'), c.id);
  const st = createState(ch);
  for (const n of ch.notes) hit(st, n.lane, n.t + 0.01, JUDGE[c.id]);
  ok(st.perfect === ch.notes.length && isFinished(st), c.id + ': 全部ぴったり');
  ok(st.maxCombo === ch.notes.length, c.id + ': ずっとつづけて当てた');
  ok(score(st) === ch.notes.length * 100, c.id + ': 最高点');
  consistent(st, c.id + ' 全部ぴったり');
}

// 3. 少しずれると「いいね」、大きくずれると流れる（点は入らない）
{
  const w = JUDGE.normal;
  const ch = buildChart(TRACKS.find((t) => t.id === 'mid'), 'normal');
  const n0 = ch.notes[0];
  let st = createState(ch);
  ok(hit(st, n0.lane, n0.t + (w.perfect + w.good) / 2, w).result === 'good', 'おそめは いいね');
  st = createState(ch);
  ok(hit(st, n0.lane, n0.t - (w.perfect + w.good) / 2, w).result === 'good', '早めも いいね');
  st = createState(ch);
  const early = hit(st, n0.lane, n0.t - (w.good + w.early) / 2, w);
  ok(early && early.result === 'miss' && score(st) === 0, 'かなり早いと、そのしるしは流れる（点なし）');
  st = createState(ch);
  ok(hit(st, n0.lane, n0.t - w.early - 0.05, w) === null && st.miss === 0, 'うんと早いと何も起きない');
  st = createState(ch);
  const other = 1 - n0.lane;
  const r = hit(st, other, n0.t, w);
  ok(r === null || r.note.lane === other, 'ちがう列をたたいても、その列のしるしは消えない');
  ok(st.notes[0].result === null, 'ちがう列: 最初のしるしはまだ残る');
  st = createState(ch);
  sweepMisses(st, n0.t + w.good + 0.01, w);
  ok(st.notes[0].result === 'miss' && st.combo === 0, 'たたかずに通りすぎると、だまって流れる');
  ok(hit(st, n0.lane, n0.t + w.good + 0.02, w) === null || st.notes[0].result === 'miss', '流れたしるしは、あとから当たらない');
}

// 4. でたらめにたたき続けても、数がくい違わない・同じしるしが2回数えられない
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296); }
for (const c of COURSES) {
  for (let trial = 0; trial < 30; trial++) {
    const rand = rng(trial * 97 + c.id.length);
    const ch = buildChart(TRACKS[trial % 3], c.id);
    const w = JUDGE[c.id];
    const st = createState(ch);
    const seen = new Set();
    let t = -0.5;
    let dup = false;
    while (t < ch.musicEnd + 1) {
      t += rand() * 0.12;
      const lane = Math.floor(rand() * c.lanes);
      const r = hit(st, lane, t, w);
      if (r && r.result !== 'miss') {
        if (seen.has(r.note.id)) dup = true;
        seen.add(r.note.id);
      }
      if (rand() < 0.3) sweepMisses(st, t, w);
    }
    sweepMisses(st, Infinity, w);
    ok(!dup, c.id + ' #' + trial + ': 同じしるしは1回だけ');
    ok(isFinished(st), c.id + ' #' + trial + ': 最後には全部判定ずみ');
    consistent(st, c.id + ' でたらめ#' + trial);
    ok(score(st) <= ch.notes.length * 100, c.id + ' #' + trial + ': 最高点をこえない');
  }
  // 連打（とても速く同じ列）は全部当たりにならない
  const ch = buildChart(TRACKS.find((t) => t.id === 'mid'), c.id);
  const w = JUDGE[c.id];
  const st = createState(ch);
  for (let t = 0; t < ch.musicEnd + 1; t += 0.03) for (let l = 0; l < c.lanes; l++) hit(st, l, t, w);
  sweepMisses(st, Infinity, w);
  consistent(st, c.id + ' 連打');
  ok(st.perfect < ch.notes.length * 0.5, c.id + ': 連打では、ぴったりは半分未満', { perfect: st.perfect, all: ch.notes.length });
}

// 5. とちゅうでやめた: 残りを流しても数は合う
{
  const ch = buildChart(TRACKS.find((t) => t.id === 'slow'), 'hard');
  const w = JUDGE.hard;
  const st = createState(ch);
  const half = ch.notes.slice(0, Math.floor(ch.notes.length / 2));
  for (const n of half) hit(st, n.lane, n.t, w);
  sweepMisses(st, Infinity, w);
  ok(st.perfect === half.length && st.miss === ch.notes.length - half.length, 'とちゅうでやめた: ぴったりと流れた数');
  consistent(st, 'とちゅうでやめた');
}

// 6. 少し前にもどって再開: 当てたしるしは2回数えない
{
  const ch = buildChart(TRACKS.find((t) => t.id === 'mid'), 'normal');
  const w = JUDGE.normal;
  const st = createState(ch);
  const first = ch.notes.slice(0, 10);
  for (const n of first) hit(st, n.lane, n.t, w);
  const before = score(st);
  for (const n of first.slice(5)) hit(st, n.lane, n.t, w); // もどった区間をもう一度たたく
  ok(st.perfect === 10 || score(st) > before, 'もどった区間: すでに当てたしるしは数えない');
  ok(first.every((n) => st.notes[n.id].result === 'perfect'), 'もどった区間: 当てたしるしはそのまま');
  consistent(st, 'もどって再開');
}

// 7. タイミング合わせ
{
  const beat = 60 / CALIB_BPM;
  const beats = Array.from({ length: 16 }, (_, i) => i * beat);
  const late = beats.slice(2, 10).map((b, i) => b + 0.2 + (i % 2 ? 0.02 : -0.02));
  ok(Math.abs(estimateOffset(late, beats) - 0.2) < 0.021, 'おくれ0.2秒を測れる', estimateOffset(late, beats));
  const big = beats.slice(2, 10).map((b) => b + 0.35);
  ok(Math.abs(estimateOffset(big, beats) - 0.35) < 0.001, 'おくれ0.35秒も測れる', estimateOffset(big, beats));
  ok(estimateOffset([1, 2, 3], beats) === null, '3回だけでは測らない');
  const huge = beats.slice(2, 10).map((b) => b - 0.3);
  const v = estimateOffset(huge, beats);
  ok(v >= OFFSET_MIN && v <= OFFSET_MAX, 'はばの中におさめる', v);
  const outlier = beats.slice(2, 10).map((b, i) => b + (i === 3 ? 0.4 : 0.1));
  ok(Math.abs(estimateOffset(outlier, beats) - 0.1) < 0.001, '1回だけ大きくずれても、まん中の値を使う');
}

// 8. ランキング
{
  const r = rankPlayers([
    { id: 'a', best: 3000, joinedAt: 1 }, { id: 'b', best: 5000, joinedAt: 2 }, { id: 'c', best: 3000, joinedAt: 3 },
    { id: 'd', best: null, joinedAt: 0 }, { id: 'e', best: 1000, joinedAt: 4 }, { id: 'f', joinedAt: 5 }, { id: 'g', best: 0, joinedAt: 6 },
  ]);
  ok(r.map((p) => p.id).join('') === 'bacegdf', 'ランキングの並び', r.map((p) => p.id).join(''));
  ok(r.map((p) => p.rank).join(',') === '1,2,2,4,5,,', '同じ点数は同じ順位', r.map((p) => p.rank));
  ok(rankPlayers([]).length === 0, 'だれもいない');
}

console.log(`engine: ${pass} OK / ${fail} NG`);
process.exit(fail ? 1 : 0);
