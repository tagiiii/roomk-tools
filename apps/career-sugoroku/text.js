/* キャリアすごろく v2（試作）— 画面の文
   ゲームの目的・しごとマスのポイントの言い方など、画面に出す文を作る（DOM を使わないので Node でテストできる。tests/text.test.cjs）。
   エンジンの中では職業の段階を★（stars）と呼ぶが、画面には★を出さず、しごとマスのポイントで直接言う
   （2026-09-29 オーナーの「★1の職業とは？」「誰が見てもわかりやすいか」→ 適性→★→ポイントの段階を1つ減らした）。
   ブラウザでは window.CS_TEXT、Node では module.exports で読む。 */
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const D = isNode ? require('./data.js') : root.CS_DATA;
  const E = isNode ? require('./engine.js') : root.CS_ENGINE;

  // ゲームの目的（はじめの画面・あそびかたで同じ文を使う。index.html の文と同じであることをテストで確かめる）。
  // 2026-09-29 オーナー「学びとしては適性から職業を選んでほしい」→ 勝ち負けはポイントだけ。
  // ポイントは、たまった適性に合う職業を選ぶほど多くなる（適性から職業を選ぶことが、そのまま勝ち方になる）
  const GAME_AIM = 'いろいろな体験で「適性」をため、しごとの道に進むときに、たまった適性に合う職業を選ぼう。適性に合う職業ほど、しごとマスでもらえるポイントが多い。ゴールしたとき、ポイントがいちばん多い人の勝ち（1番にゴールするとボーナスもある）。';

  const aptName = (a) => D.APTS[a].name;
  // st はエンジンの★の段階（1〜4）
  const payOf = (st) => D.STAR_PAY[st - 1];
  const payNow = (apt, jobId) => payOf(E.stars(apt, jobId));
  const PAY_MAX = D.STAR_PAY[D.STAR_PAY.length - 1];

  // しごとマスのポイントの決まり方（いまの値では「いちばん少ない数 +1、+4まで」）
  function payRule(long) {
    const simple = D.STAR_LEVELS.every((v, i) => v === i + 1) && D.STAR_PAY.every((v, i) => v === i + 1);
    const how = simple
      ? `いちばん少ない数 +1（+${PAY_MAX}まで）`
      : `いちばん少ない数で決まる（0なら +${D.STAR_PAY[0]}、${D.STAR_LEVELS.map((v, i) => `${v}以上で +${D.STAR_PAY[i + 1]}`).join('、')}）`;
    return `しごとマスでもらえるポイントは、その職業に合う適性3つのうち、${how}${long ? '。ほかの適性が多くても、いちばん少ない適性で決まる' : ''}`;
  }
  // 職業のカードの説明
  const jobChoiceRule = () => `たまった適性に合う職業ほど、しごとマスでもらえるポイントが多い。${payRule().replace('しごとマスでもらえるポイントは、', 'ポイントは、')}`;

  // つぎにポイントが上がるには（例:「工夫する力を1にすると +2」「アイデアと工夫する力を2にすると +3」「3つとも1にすると +2」）
  function nextPayText(apt, jobId) {
    const nx = E.nextStar(apt, jobId);
    if (!nx) return `いちばん上（+${PAY_MAX}）`;
    const who = nx.lack.length === 3 ? '3つとも' : `${nx.lack.map((x) => aptName(x.a)).join('と')}を`;
    return `${who}${nx.level}にすると +${payOf(nx.to)}`;
  }
  // ポイントを決めている、いちばん少ない適性（画面でふちをつける）。いちばん上（+4）のときは、上げる必要がないので出さない
  function lowApts(apt, jobId) {
    const nx = E.nextStar(apt, jobId);
    return nx ? nx.lack.map((x) => x.a) : [];
  }
  // 読み上げの文
  const jobAria = (apt, jobId) => `しごとマスで +${payNow(apt, jobId)}。合う適性 ${D.JOBS[jobId].apts.map((a) => `${aptName(a)} ${apt[a]}`).join('、')}。${nextPayText(apt, jobId)}`;

  const api = { GAME_AIM, payOf, payNow, PAY_MAX, payRule, jobChoiceRule, nextPayText, lowApts, jobAria };
  if (isNode) module.exports = api;
  else root.CS_TEXT = api;
})(typeof window !== 'undefined' ? window : globalThis);
