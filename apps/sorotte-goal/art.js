/* そろってゴール — 絵（SVG）。どれも決まった文字列で、利用者の入力は入らない。
   色は CSS の変数（--c: その人・そのしるしの色）で付ける。 */
(function (root) {
  'use strict';

  // キャラクター: 頭のかざり4種類（葉っぱ・三角の耳・長い耳・とんがり）× 体の形2種類。色と番号は人ごと。
  // 番号は 1〜12 の数字だけを入れる
  const TOPS = [
    '<path d="M50 21 C50 11 44 6 37 6 C39 15 44 19 50 21 Z" fill="#6BB04A" stroke="#3E7A2A" stroke-width="2" stroke-linejoin="round"/>'
      + '<path d="M50 21 C52 11 58 7 65 8 C62 16 57 20 50 21 Z" fill="#84C65E" stroke="#3E7A2A" stroke-width="2" stroke-linejoin="round"/>',
    '<path class="sg-ch__ear" d="M22 34 L20 9 L42 22 Z"/><path class="sg-ch__ear" d="M78 34 L80 9 L58 22 Z"/>'
      + '<path class="sg-ch__earin" d="M25 27 L24 16 L34 22 Z"/><path class="sg-ch__earin" d="M75 27 L76 16 L66 22 Z"/>',
    '<path class="sg-ch__ear" d="M30 28 C24 12 26 -2 33 -3 C40 -2 42 12 42 24 Z"/><path class="sg-ch__ear" d="M70 28 C76 12 74 -2 67 -3 C60 -2 58 12 58 24 Z"/>'
      + '<path class="sg-ch__earin" d="M33 21 C31 11 31 4 33.5 3 C36 4 37 11 37 20 Z"/><path class="sg-ch__earin" d="M67 21 C69 11 69 4 66.5 3 C64 4 63 11 63 20 Z"/>',
    '<path class="sg-ch__ear" d="M34 24 L38 6 L46 19 L50 2 L54 19 L62 6 L66 24 Z"/>',
  ];
  const BODIES = [
    'M50 19 C74 19 87 37 87 59 C87 79 72 89 50 89 C28 89 13 79 13 59 C13 37 26 19 50 19 Z',
    'M50 20 C72 20 85 28 85 55 C85 81 72 89 50 89 C28 89 15 81 15 55 C15 28 28 20 50 20 Z',
  ];
  const MOUTHS = ['M44 57 Q50 62 56 57', 'M45 57 L50 61 L55 57'];
  function char(i) {
    const num = String((Math.max(0, Math.min(11, Math.floor(i))) | 0) + 1);
    return [
      '<svg class="sg-ch" viewBox="0 0 100 100" aria-hidden="true">',
      '<g class="sg-ch__top">', TOPS[i % 4], '</g>',
      '<ellipse class="sg-ch__foot" cx="36" cy="89" rx="11" ry="6"/><ellipse class="sg-ch__foot" cx="64" cy="89" rx="11" ry="6"/>',
      '<path class="sg-ch__skin" d="', BODIES[i % 2], '"/>',
      '<path class="sg-ch__shine" d="M27 41 C30 32 37 27 45 26"/>',
      '<ellipse class="sg-ch__belly" cx="50" cy="69" rx="19" ry="13"/>',
      '<g class="sg-ch__face">',
      '<g class="sg-ch__eyes"><ellipse cx="38" cy="45" rx="8" ry="9.5" fill="#fff"/><ellipse cx="62" cy="45" rx="8" ry="9.5" fill="#fff"/>',
      '<g class="sg-ch__pupils"><circle cx="38" cy="46" r="4.4"/><circle cx="62" cy="46" r="4.4"/><circle cx="39.6" cy="44.2" r="1.4" fill="#fff"/><circle cx="63.6" cy="44.2" r="1.4" fill="#fff"/></g></g>',
      '<g class="sg-ch__happy"><path d="M30 47 Q38 36 46 47"/><path d="M54 47 Q62 36 70 47"/></g>',
      '<ellipse class="sg-ch__cheek" cx="26" cy="57" rx="5.5" ry="3.2"/><ellipse class="sg-ch__cheek" cx="74" cy="57" rx="5.5" ry="3.2"/>',
      '<path class="sg-ch__mouth" d="', MOUTHS[i % 2], '"/>',
      '</g>',
      '<text class="sg-ch__num" x="50" y="70">', num, '</text>',
      '</svg>',
    ].join('');
  }
  // 人ごとの色（1〜12人目）
  const COLORS = ['#E0762B', '#2A93B4', '#D9558B', '#4FA043', '#8A5CC4', '#D2A012', '#D0453A', '#3D5FA8', '#1E9E8A', '#9A6A3C', '#6F7C8A', '#8FB02A'];

  const KEY = [
    '<svg class="sg-art" viewBox="0 0 100 100" aria-hidden="true">',
    '<g transform="rotate(-35 50 50)">',
    '<rect x="46" y="44" width="42" height="11" rx="4" fill="#E9B824" stroke="#8A6A00" stroke-width="3"/>',
    '<rect x="70" y="53" width="8" height="12" rx="2" fill="#E9B824" stroke="#8A6A00" stroke-width="3"/>',
    '<rect x="82" y="53" width="7" height="9" rx="2" fill="#E9B824" stroke="#8A6A00" stroke-width="3"/>',
    '<circle cx="32" cy="50" r="19" fill="#F6CE4B" stroke="#8A6A00" stroke-width="3"/>',
    '<circle cx="32" cy="50" r="7.5" fill="#FFF6D6" stroke="#8A6A00" stroke-width="3"/>',
    '<path d="M21 40 C24 34 30 32 35 33" fill="none" stroke="#FFF6D6" stroke-width="3" stroke-linecap="round"/>',
    '</g></svg>',
  ].join('');

  const BOX = [
    '<svg class="sg-art" viewBox="0 0 100 100" aria-hidden="true">',
    '<rect x="9" y="12" width="82" height="80" rx="9" fill="#7A5630"/>',
    '<rect x="9" y="8" width="82" height="78" rx="9" fill="#C99A5E" stroke="#7A5630" stroke-width="4"/>',
    '<path d="M9 34 H91 M9 60 H91" stroke="#A97B45" stroke-width="3"/>',
    '<path d="M18 16 L82 78 M82 16 L18 78" stroke="#8C6336" stroke-width="7" stroke-linecap="round"/>',
    '<rect x="13" y="12" width="74" height="70" rx="6" fill="none" stroke="#E6C08A" stroke-width="3" opacity="0.7"/>',
    '<g fill="#5E4020"><circle cx="19" cy="18" r="2.6"/><circle cx="81" cy="18" r="2.6"/><circle cx="19" cy="76" r="2.6"/><circle cx="81" cy="76" r="2.6"/></g>',
    '</svg>',
  ].join('');

  const FLAG = [
    '<svg class="sg-art sg-flag" viewBox="0 0 100 100" aria-hidden="true">',
    '<ellipse cx="38" cy="90" rx="16" ry="5" fill="rgba(0,0,0,0.18)"/>',
    '<rect x="34" y="12" width="6" height="78" rx="3" fill="#8C6336" stroke="#5E4020" stroke-width="2"/>',
    '<circle cx="37" cy="12" r="5.5" fill="#F6CE4B" stroke="#8A6A00" stroke-width="2"/>',
    '<path class="sg-flag__cloth" d="M40 18 C52 12 62 26 80 18 L80 48 C62 56 52 42 40 48 Z" fill="#3FAE5A" stroke="#1F6E3C" stroke-width="3" stroke-linejoin="round"/>',
    '<path class="sg-flag__star" d="M58 25 l2.6 5.4 5.9 .8 -4.3 4.1 1 5.9 -5.2 -2.8 -5.2 2.8 1 -5.9 -4.3 -4.1 5.9 -.8 Z" fill="#FFF6D6"/>',
    '</svg>',
  ].join('');

  const LOCK = [
    '<svg class="sg-art" viewBox="0 0 100 100" aria-hidden="true">',
    '<path d="M32 46 V34 C32 22 40 15 50 15 C60 15 68 22 68 34 V46" fill="none" stroke="#6B5A4A" stroke-width="9" stroke-linecap="round"/>',
    '<rect x="22" y="44" width="56" height="42" rx="9" fill="#F6CE4B" stroke="#8A6A00" stroke-width="4"/>',
    '<circle cx="50" cy="60" r="6" fill="#6B4A00"/><rect x="47" y="62" width="6" height="14" rx="3" fill="#6B4A00"/>',
    '</svg>',
  ].join('');

  // しるし（まる・さんかく・しかく・ほし・ひしがた）。色は currentColor
  const mark = (inner) => '<svg class="sg-mark" viewBox="0 0 24 24" aria-hidden="true">' + inner + '</svg>';
  const MARK = {
    a: mark('<circle cx="12" cy="12" r="7.5" fill="currentColor"/>'),
    b: mark('<path d="M12 4.5 L20.5 19 H3.5 Z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'),
    c: mark('<rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor"/>'),
    d: mark('<path d="M12 2.5 L14.8 9 L21.8 9.6 L16.5 14.2 L18.1 21 L12 17.4 L5.9 21 L7.5 14.2 L2.2 9.6 L9.2 9 Z" fill="currentColor"/>'),
    e: mark('<path d="M12 2.5 L20.5 12 L12 21.5 L3.5 12 Z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>'),
  };

  // とる星
  const GEM = [
    '<svg class="sg-art" viewBox="0 0 100 100" aria-hidden="true">',
    '<path d="M50 8 L62 36 L92 39 L69 59 L76 89 L50 73 L24 89 L31 59 L8 39 L38 36 Z" fill="#FFD23F" stroke="#B5840A" stroke-width="5" stroke-linejoin="round"/>',
    '<path d="M50 22 L57 40 L50 46 L43 40 Z" fill="#FFF3B8"/>',
    '</svg>',
  ].join('');

  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1 L14.6 9.4 L23 12 L14.6 14.6 L12 23 L9.4 14.6 L1 12 L9.4 9.4 Z" fill="currentColor"/></svg>';

  root.SorotteArt = { char, COLORS, KEY, BOX, FLAG, LOCK, MARK, STAR, GEM };
})(window);
