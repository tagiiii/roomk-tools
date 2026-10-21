// ぴったりビートの、音や画面に関係しない決まり（譜面・判定・点数・順位・タイミング合わせ）。
// 時間はすべて「曲のはじまり（カウントの1拍目）からの秒」で数える。

export const COURSES = [
  { id: 'easy', label: 'やさしい', note: 'しるしは1種類。どのボタンでもOK', lanes: 1 },
  { id: 'normal', label: 'ふつう', note: 'まる と ひしがた・こまかいリズム', lanes: 2 },
  { id: 'hard', label: 'むずかしい', note: 'もっとこまかいリズム', lanes: 2 },
];

// 曲。music があるものは ElevenLabs で作った曲（ファイル）、ないものはツールの中で鳴らす仮の手拍子（いまは3曲とも曲のファイル）。
// 曲の速さと1拍目の時刻は、できた曲を調べて決めた値（AGENTS.md「曲」）。
// 曲の譜面は、前奏 introBeats 拍のあとから measures 小節ぶん。
export const TRACKS = [
  {
    id: 'slow', label: 'ゆっくり', bpm: 79.95,
    music: { file: 'music/slow.mp3', firstBeat: 0.415, introBeats: 8, measures: 18, length: 65.0 },
  },
  {
    id: 'mid', label: 'ふつう', bpm: 99.952,
    music: { file: 'music/mid.mp3', firstBeat: 0.010, introBeats: 8, measures: 19, length: 55.0 },
  },
  {
    // はじめの2拍は無音、3拍目に小さな音が1つ入り、2.02秒から曲が始まる。その2.02秒を1拍目にする
    id: 'fast', label: 'はやい', bpm: 120.022,
    music: { file: 'music/fast.mp3', firstBeat: 2.024, introBeats: 8, measures: 18, length: 45.0 },
  },
];

export const COUNT_IN_BEATS = 4;
export const CLICK_MEASURES = 20; // 仮の手拍子の小節の数

// 判定のはば（秒）。early より早くたたくと、そのしるしは当たらずに流れる（でたらめにたたき続けても当たり続けないように）。
export const JUDGE = {
  easy: { perfect: 0.09, good: 0.17, early: 0.24 },
  normal: { perfect: 0.07, good: 0.14, early: 0.21 },
  hard: { perfect: 0.06, good: 0.12, early: 0.18 },
};

export const POINTS = { perfect: 100, good: 50 };

// 1小節の並び。8文字なら8分音符、16文字なら16分音符の細かさ。a＝まる、b＝ひしがた、.＝やすみ。やさしいは全部まるにする。
// 同じ列のしるしは8分音符より近づけない（16分音符は左右交互だけ）。10-21 オーナー「難易度を上げてもいい」で全コースを1段ずつ上げた。
const PATTERNS = {
  easy: ['a.a.a.a.', 'a.a.a.aa', 'a.aaa.a.', 'aa.aa.a.', 'a.a.aa..', 'a.aa.aa.'],
  normal: ['a.b.aab.', 'a.abb.a.', 'ababa.b.', 'aab.bab.', 'b.abb.a.', 'a.bbaab.', 'abab.ab.'],
  hard: [
    'a.b.a.b.ababa.b.', 'a.a.b.b.a.bab.b.', 'abab..a.b.a.abab', 'a.b.abab..b.a.b.',
    'a.bab.a.b.a.b.ab', 'a.a.b.b.abab..a.', 'ab..ab..a.b.abab',
  ],
};
const FIRST = { easy: 'a.a.a.a.', normal: 'a.b.a.b.', hard: 'a.b.a.b.a.b.a.b.' };

// しるしが上から線まで落ちる秒数（コースごと）
export const TRAVEL = { easy: 1.3, normal: 1.15, hard: 1.0 };

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// 同じ曲・同じコースなら、毎回同じ譜面になる（何度か遊んでうまくなれるように）。
export function buildChart(track, courseId) {
  const bank = PATTERNS[courseId];
  if (!bank) throw new Error('unknown course: ' + courseId);
  const { bpm, music } = track;
  const beat = 60 / bpm;
  const eighth = beat / 2;
  const bar = beat * 4;
  const MEASURES = music ? music.measures : CLICK_MEASURES;
  const start = music ? music.firstBeat + music.introBeats * beat : COUNT_IN_BEATS * beat;
  const rand = seeded(Math.round(bpm) * 7 + courseId.length * 131 + 1);
  const pick = () => bank[Math.floor(rand() * bank.length)];
  const measures = [];
  for (let m = 0; m < MEASURES; m += 4) {
    // 4小節ひとまとまりで「A A B A」にして、くり返しで覚えやすくする
    const p = pick();
    let q = pick();
    if (q === p) q = bank[(bank.indexOf(p) + 1) % bank.length];
    measures.push(p, p, q, p);
  }
  measures.length = MEASURES;
  measures[0] = FIRST[courseId];
  measures[MEASURES - 1] = 'a.......';
  const notes = [];
  measures.forEach((pat, m) => {
    const step = bar / pat.length;
    for (let i = 0; i < pat.length; i++) {
      const c = pat[i];
      if (c !== 'a' && c !== 'b') continue;
      notes.push({
        id: notes.length,
        t: start + m * bar + i * step,
        lane: courseId === 'easy' ? 0 : (c === 'a' ? 0 : 1),
      });
    }
  });
  const musicEnd = music ? music.length : start + MEASURES * bar;
  return { bpm, beat, eighth, bar, start, musicEnd, notes, music: music || null };
}

export function createState(chart) {
  return {
    notes: chart.notes.map((n) => ({ ...n, result: null, at: null })),
    perfect: 0,
    good: 0,
    miss: 0,
    combo: 0,
    maxCombo: 0,
  };
}

function settle(state, n, result, t) {
  n.result = result;
  n.at = t;
  if (result === 'miss') {
    state.miss++;
    state.combo = 0;
    return;
  }
  state[result]++;
  state.combo++;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
}

// t をすぎて判定のはばを外れたしるしを、だまって流す。
export function sweepMisses(state, t, win) {
  for (const n of state.notes) {
    if (n.result === null && t - n.t > win.good) settle(state, n, 'miss', t);
  }
}

// lane をたたいた。当たったしるしと結果を返す。近くにしるしがなければ null（何も起きない）。
export function hit(state, lane, t, win) {
  sweepMisses(state, t, win);
  let target = null;
  for (const n of state.notes) {
    if (n.result !== null || n.lane !== lane) continue;
    if (target === null || n.t < target.t) target = n;
  }
  if (target === null) return null;
  const d = t - target.t;
  if (d < -win.early) return null;
  const ad = Math.abs(d);
  const result = ad <= win.perfect ? 'perfect' : ad <= win.good ? 'good' : 'miss';
  settle(state, target, result, t);
  return { note: target, result, d };
}

export function score(state) {
  return state.perfect * POINTS.perfect + state.good * POINTS.good;
}

export function isFinished(state) {
  return state.notes.every((n) => n.result !== null);
}

// タイミング合わせ: 拍の時刻とたたいた時刻から、音のおくれ（秒）を出す。まん中の値を使う。
export function estimateOffset(taps, beatTimes) {
  if (beatTimes.length === 0) return null;
  const diffs = [];
  for (const t of taps) {
    let best = null;
    for (const b of beatTimes) {
      if (best === null || Math.abs(t - b) < Math.abs(t - best)) best = b;
    }
    diffs.push(t - best);
  }
  if (diffs.length < 4) return null;
  diffs.sort((x, y) => x - y);
  const mid = Math.floor(diffs.length / 2);
  const median = diffs.length % 2 ? diffs[mid] : (diffs[mid - 1] + diffs[mid]) / 2;
  return clampOffset(median);
}

export const OFFSET_MIN = -0.1;
export const OFFSET_MAX = 0.4;
// タイミング合わせの手拍子の速さ。拍の間が長いほど、大きなおくれも正しく測れる（拍の間の半分まで）。
export const CALIB_BPM = 70;
export const CALIB_BEATS = 16;

export function clampOffset(v) {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(OFFSET_MAX, Math.max(OFFSET_MIN, v)) * 1000) / 1000;
}

// ランキング: いちばんよい点数の高い順。同じ点数は同じ順位（1, 1, 3 …）。まだ点のない人は順位なしで後ろに名前の順で並べる。
export function rankPlayers(players) {
  const scored = players.filter((p) => Number.isFinite(p.best)).sort((a, b) => b.best - a.best || a.joinedAt - b.joinedAt);
  const rest = players.filter((p) => !Number.isFinite(p.best)).sort((a, b) => a.joinedAt - b.joinedAt);
  let prevScore = null;
  let prevRank = 0;
  const ranked = scored.map((p, i) => {
    const rank = p.best === prevScore ? prevRank : i + 1;
    prevScore = p.best;
    prevRank = rank;
    return { ...p, rank };
  });
  return ranked.concat(rest.map((p) => ({ ...p, rank: null })));
}
