/* カンペ放送局のルールだけ。画面・通信に触らない（node でも読める）。
   読む人の原稿の空らんに、ほかの人がヒントだけを見て言葉を書く。読み終わったら、ほかのみんなで読む人が笑わずに読めたかを判定する。 */
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

  // 文を「ふつうの文字」と「漢字＋ふりがな」に分ける。[{ text, rt }]（rt が '' ならふりがななし）
  // 漢字のつながりごとに、うしろのかなまで入れたキー → つながりだけ、の順に辞書を探す。無ければ1字ずつ
  const KANJI = /[一-鿿々]+/g;
  function lookup(dict, run, rest) {
    for (let k = 2; k >= 0; k -= 1) {
      const v = dict[run + rest.slice(0, k)];
      if (v != null && (k === 0 || /^[ぁ-ゟ]+$/.test(rest.slice(0, k)))) return v;
    }
    return null;
  }
  function rubyParts(text, dict) {
    const s = String(text == null ? '' : text);
    const out = [];
    const push = (t, rt) => {
      const last = out[out.length - 1];
      if (!rt && last && !last.rt) last.text += t;
      else out.push({ text: t, rt });
    };
    let at = 0;
    let m;
    KANJI.lastIndex = 0;
    while ((m = KANJI.exec(s))) {
      if (m.index > at) push(s.slice(at, m.index), '');
      const run = m[0];
      const end = m.index + run.length;
      const v = lookup(dict || {}, run, s.slice(end));
      if (typeof v === 'string') push(run, v);
      else if (Array.isArray(v) && v.length === run.length) [...run].forEach((c, i) => push(c, v[i]));
      else {
        [...run].forEach((c, i) => {
          const one = lookup(dict || {}, c, i === run.length - 1 ? s.slice(end) : '');
          push(c, typeof one === 'string' ? one : '');
        });
      }
      at = end;
    }
    if (at < s.length) push(s.slice(at), '');
    return out;
  }

  function omakase(hints, hint) {
    const list = (hints[hint] && hints[hint].words) || ['なにか'];
    return list[Math.floor(Math.random() * list.length)];
  }

  // 読み終わったあとの判定。読む人のほかのみんなが「笑わずに読めた」（ok）か「笑った」（laugh）を出す。
  // 出た判定の半分より多くが「笑わずに読めた」なら、読む人は読みきった（同じ数なら読みきったにしない）
  function judge(verdicts) {
    const list = Object.values(verdicts || {});
    const ok = list.filter((v) => v === 'ok').length;
    const laugh = list.filter((v) => v === 'laugh').length;
    return { ok, laugh, success: ok * 2 > ok + laugh };
  }

  // その番組の点。読みきったら読む人に1点、笑ったら言葉を書いた人に1点ずつ（おまかせの言葉しかない人は入らない）
  function roundPoints(blanks, reader, success) {
    const pts = {};
    if (success) { pts[reader] = 1; return pts; }
    blanks.forEach((b) => { if (!b.auto && b.word && b.writer) pts[b.writer] = 1; });
    return pts;
  }

  // 読む人の順番（1周か2周）。「書くだけ」の人は入れない
  function readOrder(players, laps, noRead) {
    const readers = players.filter((id) => !(noRead && noRead.includes(id)));
    const out = [];
    for (let l = 0; l < laps; l += 1) out.push(...readers);
    return out;
  }

  const api = { MIN, MAX, LINES, shuffle, blanksFor, pickProgram, assign, hintOf, splitLine, rubyParts, omakase, judge, roundPoints, readOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KanpeEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
