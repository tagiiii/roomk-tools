/* カンペ放送局のルールだけ。画面・通信に触らない（node でも読める）。
   読む人の原稿の空らんに、ほかの人がヒントだけを見て言葉を書く。読んでいる途中に、聞いている人が言葉ごとに「笑った！」を押す。 */
(function (root) {
  'use strict';

  const MIN = 3;
  const MAX = 8;
  const LINES = 7; // 1つの番組の、空らんのある行の数

  function shuffle(a) {
    const b = a.slice();
    for (let i = b.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  }

  // 空らんの数。書く人が2人なら2つずつ、3人からは1人1つ（7人まで）
  function blanksFor(writers) {
    if (writers <= 2) return writers * 2;
    return Math.min(writers, LINES);
  }

  // まだ使っていない番組を選ぶ。使いきったら、また全部から
  function pickProgram(programs, used) {
    const rest = programs.filter((p) => !used.includes(p.id));
    const from = rest.length ? rest : programs;
    return from[Math.floor(Math.random() * from.length)];
  }

  // 行の頭から k 行を使い、書く人に順番に割りあてる
  function assign(writers, program, k) {
    return program.lines.slice(0, k).map((line, i) => ({
      hint: hintOf(line), writer: writers[i % writers.length], word: '', auto: false,
    }));
  }

  // 行の中の {hint} を取り出す
  function hintOf(line) {
    const m = /\{([a-z]+)\}/.exec(line);
    return m ? m[1] : '';
  }
  // 行を「前・空らん・後」に分ける
  function splitLine(line) {
    const m = /^(.*)\{[a-z]+\}(.*)$/.exec(line);
    return m ? { before: m[1], after: m[2] } : { before: line, after: '' };
  }

  function omakase(hints, hint) {
    const list = (hints[hint] && hints[hint].words) || ['なにか'];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 「笑った！」を押せる言葉か（自分の言葉と、おまかせで入った言葉には押せない）
  function canLaugh(blanks, i, id) {
    const b = blanks[i];
    return !!(b && b.word && !b.auto && b.writer !== id);
  }

  // 言葉ごとに「笑った！」を押した人を数え、いちばん多い言葉（同じ数ならみんな）を返す。だれも押していなければ空
  // laughs: { 空らんの番号: [押した人, ...] }
  function tally(blanks, laughs) {
    const counts = blanks.map((b, i) => (b.auto ? 0 : (laughs[i] || []).filter((id) => id !== b.writer).length));
    const max = Math.max(0, ...counts);
    const top = max > 0 ? counts.map((c, i) => (c === max ? i : -1)).filter((i) => i >= 0) : [];
    return { counts, top };
  }

  // 書いた人ごとの、「笑った！」をもらった数
  function pointsFrom(blanks, counts) {
    const pts = {};
    blanks.forEach((b, i) => { if (!b.auto && counts[i]) pts[b.writer] = (pts[b.writer] || 0) + counts[i]; });
    return pts;
  }

  // 読む人の順番（1周か2周）。「書くだけ」の人は入れない
  function readOrder(players, laps, noRead) {
    const readers = players.filter((id) => !(noRead && noRead.includes(id)));
    const out = [];
    for (let l = 0; l < laps; l += 1) out.push(...readers);
    return out;
  }

  const api = { MIN, MAX, LINES, shuffle, blanksFor, pickProgram, assign, hintOf, splitLine, omakase, canLaugh, tally, pointsFrom, readOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KanpeEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
