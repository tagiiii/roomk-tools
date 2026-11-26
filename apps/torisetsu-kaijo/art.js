/* とりせつ解除班 の絵（SVG の文字列）。利用者の入力は入らない。すべてこのツールのために描いたもの。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KaijoArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HEX = { r: '#D64541', b: '#2F6FDB', y: '#E9B800', g: '#2E9E57', w: '#F3EFE6', k: '#2B2B2B' };
  const INK = '#2A2520';
  const svg = (box, body, cls) => '<svg viewBox="' + box + '" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false"' + (cls ? ' class="' + cls + '"' : '') + '>' + body + '</svg>';

  // 名前のない記号（12種類）。線と点だけで描く
  const GLYPH_BODY = [
    '<path d="M20 20q4-4 0-6q-8-2-8 6q0 10 10 10q12 0 12-12"/><circle cx="32" cy="8" r="2.2" fill="currentColor" stroke="none"/>',
    '<path d="M6 12H25M6 20H25M6 28H25"/><circle cx="32" cy="20" r="3.2"/>',
    '<path d="M10 7V26q0 6 6 6H31"/><circle cx="21" cy="14" r="2.2" fill="currentColor" stroke="none"/><circle cx="30" cy="14" r="2.2" fill="currentColor" stroke="none"/>',
    '<path d="M4 31L13 10L20 24L27 10L36 31"/>',
    '<circle cx="20" cy="20" r="12"/><path d="M8 32L32 8"/>',
    '<path d="M20 11V29M11 20H29"/><circle cx="20" cy="7" r="3"/><circle cx="20" cy="33" r="3"/><circle cx="7" cy="20" r="3"/><circle cx="33" cy="20" r="3"/>',
    '<path d="M4 23q5-11 10.500 0t10.500 0t10.500 0"/><path d="M20 5V35"/>',
    '<path d="M20 6L35 32H5Z"/><circle cx="20" cy="24" r="2.4" fill="currentColor" stroke="none"/>',
    '<path d="M17 8a12 12 0 0 0 0 24"/><path d="M23 8a12 12 0 0 1 0 24"/>',
    '<rect x="10" y="6" width="20" height="16"/><path d="M15 22V34M25 22V34"/>',
    '<path d="M6 11L18 20L6 29M21 11L33 20L21 29"/>',
    '<circle cx="11" cy="20" r="6"/><circle cx="20" cy="20" r="6"/><circle cx="29" cy="20" r="6"/>',
  ];
  function glyph(i) {
    return svg('0 0 40 40', '<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' + (GLYPH_BODY[i] || '') + '</g>');
  }

  // 形（やじるしのしかけ・説明書）。color は r/b/y/g。なければ灰色
  const SHAPE_BODY = {
    circle: '<circle cx="30" cy="30" r="22"/>',
    triangle: '<path d="M30 7L54 50H6Z"/>',
    square: '<rect x="9" y="9" width="42" height="42" rx="3"/>',
    diamond: '<path d="M30 5L55 30L30 55L5 30Z"/>',
  };
  function shape(name, color) {
    return svg('0 0 60 60', '<g fill="' + (HEX[color] || '#B9AE9C') + '" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round">' + (SHAPE_BODY[name] || '') + '</g>');
  }

  // ふたの中の印
  const MARK_BODY = {
    star: '<path d="M30 6L37 23L55 24L41 36L46 54L30 44L14 54L19 36L5 24L23 23Z"/>',
    moon: '<path d="M40 7A24 24 0 1 0 53 40A19 19 0 0 1 40 7Z"/>',
    sun: '<circle cx="30" cy="30" r="12"/><path d="M30 4V12M30 48V56M4 30H12M48 30H56M12 12L17 17M43 43L48 48M48 12L43 17M17 43L12 48" fill="none" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>',
  };
  const mark = (name) => svg('0 0 60 60', '<g fill="' + INK + '">' + (MARK_BODY[name] || '') + '</g>');

  // コード。上の①〜⑤から、下のア〜オへ。cut は切ったコードの番号
  const CORD_X = [24, 62, 100, 138, 176];
  function cord(mod, cut, nums, letters) {
    let body = '';
    for (let i = 0; i < 5; i++) {
      body += '<text x="' + CORD_X[i] + '" y="13" text-anchor="middle" font-size="13" font-weight="700" fill="' + INK + '">' + nums[i] + '</text>';
      body += '<text x="' + CORD_X[i] + '" y="148" text-anchor="middle" font-size="12" font-weight="700" fill="' + INK + '">' + letters[i] + '</text>';
    }
    // 下になるコードから順に描く（左から。あとに描いたほうが上に見える）
    for (let i = 0; i < 5; i++) {
      const x1 = CORD_X[i];
      const x2 = CORD_X[mod.dest[i]];
      const d = 'M' + x1 + ' 24C' + x1 + ' 82 ' + x2 + ' 70 ' + x2 + ' 128';
      const dash = cut.includes(i) ? ' pathLength="100" stroke-dasharray="40 20 40"' : '';
      body += '<path d="' + d + '" fill="none" stroke="' + INK + '" stroke-width="9" stroke-linecap="round"' + dash + '/>';
      body += '<path d="' + d + '" fill="none" stroke="' + HEX[mod.colors[i]] + '" stroke-width="5.500" stroke-linecap="round"' + dash + '/>';
    }
    for (let i = 0; i < 5; i++) {
      body += '<circle cx="' + CORD_X[i] + '" cy="22" r="5" fill="#8C8478" stroke="' + INK + '" stroke-width="2"/>';
      body += '<circle cx="' + CORD_X[i] + '" cy="130" r="5" fill="#8C8478" stroke="' + INK + '" stroke-width="2"/>';
    }
    return svg('0 0 200 152', body);
  }

  // ダイヤル（1〜8）
  function dial(pos) {
    let body = '<circle cx="60" cy="60" r="56" fill="#D9D0BE" stroke="' + INK + '" stroke-width="3"/>';
    for (let i = 0; i < 8; i++) {
      const a = (i * 45 - 90) * Math.PI / 180;
      const x = (60 + Math.cos(a) * 44).toFixed(1);
      const y = (60 + Math.sin(a) * 44 + 4.500).toFixed(1);
      body += '<text x="' + x + '" y="' + y + '" text-anchor="middle" font-size="13" font-weight="700" fill="' + INK + '">' + (i + 1) + '</text>';
    }
    body += '<g transform="rotate(' + ((pos - 1) * 45) + ' 60 60)"><circle cx="60" cy="60" r="27" fill="#4A4F55" stroke="' + INK + '" stroke-width="3"/><path d="M60 22L68 40H52Z" fill="#F3EFE6" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/></g>';
    return svg('0 0 120 120', body);
  }

  const screw = () => svg('0 0 30 30', '<circle cx="15" cy="15" r="12" fill="#B9B2A4" stroke="' + INK + '" stroke-width="2.500"/><path d="M8 15H22M15 8V22" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>');

  const flame = (color) => svg('0 0 40 48', '<path d="M20 3C27 14 35 20 35 31A15 15 0 0 1 5 31C5 23 10 19 13 12C15 17 17 18 18 19C17 12 18 7 20 3Z" fill="' + (HEX[color] || '#999') + '" stroke="' + INK + '" stroke-width="2.500" stroke-linejoin="round"/><path d="M20 26C23 30 25 32 25 36A5 5 0 0 1 15 36C15 32 18 30 20 26Z" fill="#FFF6D8"/>');

  // 爆発（マンガ調のギザギザ）
  function burst() {
    let pts = '';
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      const r = i % 2 ? 62 + (i % 4) * 5 : 96 - (i % 3) * 6;
      pts += (100 + Math.cos(a) * r).toFixed(1) + ',' + (100 + Math.sin(a) * r).toFixed(1) + ' ';
    }
    return svg('0 0 200 200', '<polygon points="' + pts + '" fill="#F2B21B" stroke="' + INK + '" stroke-width="5" stroke-linejoin="round"/><polygon points="' + pts + '" fill="#FFF3C4" transform="translate(100 100) scale(0.620) translate(-100 -100)"/>');
  }

  return { HEX, glyph, shape, mark, cord, dial, screw, flame, burst };
});
