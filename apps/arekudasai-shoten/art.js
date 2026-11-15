/* あれください商店 の絵。コードで描く SVG（画像ファイルなし）。
   品物60種類・ヒントの印13・お店の人の顔・箱。どの絵も 64×64（ヒントの印は 24×24）。
   顔とヒントの印の色は currentColor（外から付ける）。動きは style.css の .tt-art--live の中だけで付く（a-fly・a-hop・a-twinkle・a-steam・a-note）。 */
(function (root) {
  'use strict';
  const INK = '#4A3A2A';
  const S = 'stroke="' + INK + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';

  // ── 飾り（ヒントの特徴） ──
  function wings(y, x1, x2) {
    y = y || 30; x1 = x1 === undefined ? 12 : x1; x2 = x2 === undefined ? 52 : x2;
    return '<g class="a-wing" fill="#FFFFFF" ' + S + '>' +
      '<path d="M' + x1 + ' ' + y + ' q-10 -10 -11 2 q3 1 4 4 q3 0 7 -6z"/>' +
      '<path d="M' + x2 + ' ' + y + ' q10 -10 11 2 q-3 1 -4 4 q-3 0 -7 -6z"/></g>';
  }
  function star4(x, y, r) {
    const k = r * 0.3;
    return '<path d="M' + x + ' ' + (y - r) + ' L' + (x + k) + ' ' + (y - k) + ' L' + (x + r) + ' ' + y + ' L' + (x + k) + ' ' + (y + k) +
      ' L' + x + ' ' + (y + r) + ' L' + (x - k) + ' ' + (y + k) + ' L' + (x - r) + ' ' + y + ' L' + (x - k) + ' ' + (y - k) + 'z"/>';
  }
  function sparkle() {
    return '<g class="a-twinkle" fill="#F5B921" stroke="#B8860B" stroke-width="1" stroke-linejoin="round">' +
      star4(10, 12, 6) + star4(54, 16, 5) + star4(50, 52, 4) + '</g>';
  }
  function hop() {
    return '<g fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round" opacity="0.55">' +
      '<path d="M14 60 q4 -5 8 0"/><path d="M27 61 q5 -4 10 0"/><path d="M42 60 q4 -5 8 0"/></g>';
  }
  function steam(x, y) {
    x = x || 32; y = y || 14;
    return '<g class="a-steam" fill="none" stroke="#C47A3A" stroke-width="2.4" stroke-linecap="round">' +
      '<path d="M' + (x - 9) + ' ' + y + ' q-4 -4 0 -7 q4 -3 0 -6"/>' +
      '<path d="M' + x + ' ' + y + ' q-4 -4 0 -7 q4 -3 0 -6"/>' +
      '<path d="M' + (x + 9) + ' ' + y + ' q-4 -4 0 -7 q4 -3 0 -6"/></g>';
  }
  function notes() {
    return '<g class="a-note" fill="' + INK + '" stroke="' + INK + '" stroke-width="2" stroke-linecap="round">' +
      '<ellipse cx="52" cy="14" rx="3.2" ry="2.4"/><path d="M55 14 v-10 l5 2" fill="none"/>' +
      '<ellipse cx="9" cy="18" rx="2.8" ry="2.1"/><path d="M11.6 18 v-8" fill="none"/></g>';
  }
  function frost() {
    return '<g stroke="#5AA7D6" stroke-width="2" stroke-linecap="round">' +
      '<path d="M8 12 v8 M4 16 h8 M5 13 l6 6 M11 13 l-6 6"/><path d="M56 46 v8 M52 50 h8 M53 47 l6 6 M59 47 l-6 6"/></g>';
  }
  function fluffy(cx, cy, rx, ry, fill) {
    // もこもこの形（まるを並べる）
    let s = '<g fill="' + fill + '" ' + S + '>';
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * Math.PI * 2;
      s += '<circle cx="' + (cx + Math.cos(a) * rx).toFixed(1) + '" cy="' + (cy + Math.sin(a) * ry).toFixed(1) + '" r="' + (Math.min(rx, ry) * 0.5).toFixed(1) + '"/>';
    }
    return s + '</g><ellipse cx="' + cx + '" cy="' + cy + '" rx="' + (rx + 1) + '" ry="' + (ry + 1) + '" fill="' + fill + '"/>';
  }
  function body(cls, inner) { return '<g class="' + cls + '">' + inner + '</g>'; }

  // ── 品物 ──
  const ITEM = {
    kotatsu: function () {
      return body('a-fly', wings(34, 9, 55) +
        '<path d="M10 34 h44 l4 18 h-52z" fill="#E4573D" ' + S + '/>' +
        '<path d="M17 34 l-3 18 M32 34 v18 M47 34 l3 18 M8 43 h48" stroke="#F7C9A8" stroke-width="2" fill="none"/>' +
        '<rect x="7" y="27" width="50" height="8" rx="3" fill="#B07A45" ' + S + '/>' +
        '<circle cx="32" cy="23" r="4.5" fill="#F5A623" ' + S + '/>') + steam(32, 16);
    },
    onigiri: function () {
      return sparkle() + '<path d="M32 12 q5 0 8 6 l12 22 q4 9 -6 10 h-28 q-10 -1 -6 -10 l12 -22 q3 -6 8 -6z" fill="#FFFDF5" ' + S + '/>' +
        '<rect x="23" y="36" width="18" height="14" rx="2" fill="#2F3A33" ' + S + '/>' +
        '<circle cx="27" cy="29" r="1.6" fill="' + INK + '"/><circle cx="37" cy="29" r="1.6" fill="' + INK + '"/><path d="M29 33 q3 3 6 0" fill="none" ' + S + '/>';
    },
    iwa: function () {
      return fluffy(32, 36, 20, 14, '#C9C3BA') +
        '<path d="M22 32 l5 4 M38 28 l-3 6 l5 3" fill="none" stroke="#8F877C" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="27" cy="40" r="1.6" fill="' + INK + '"/><circle cx="38" cy="40" r="1.6" fill="' + INK + '"/>';
    },
    purin: function () {
      return hop() + body('a-hop', '<ellipse cx="32" cy="50" rx="24" ry="5" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M20 22 h24 l7 26 q-19 5 -38 0z" fill="#F7D56A" ' + S + '/>' +
        '<path d="M20 22 h24 l2 7 q-4 4 -8 0 q-5 5 -10 0 q-5 4 -10 0z" fill="#9A5A22" ' + S + '/>' +
        '<circle cx="27" cy="38" r="1.6" fill="' + INK + '"/><circle cx="37" cy="38" r="1.6" fill="' + INK + '"/><path d="M29 42 q3 3 6 0" fill="none" ' + S + '/>');
    },
    yakan: function () {
      return notes() + steam(40, 18) +
        '<path d="M22 22 q10 -12 20 0" fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M46 34 l12 -8 l2 4 l-10 12z" fill="#8FB4C9" ' + S + '/>' +
        '<path d="M12 30 q0 -8 10 -8 h20 q10 0 10 8 v16 q0 8 -10 8 h-20 q-10 0 -10 -8z" fill="#A7C7D9" ' + S + '/>' +
        '<circle cx="26" cy="38" r="1.6" fill="' + INK + '"/><circle cx="38" cy="38" r="1.6" fill="' + INK + '"/><ellipse cx="32" cy="44" rx="3" ry="2.4" fill="' + INK + '"/>';
    },
    taiyaki: function () {
      return frost() + '<path d="M8 32 q10 -16 28 -12 q8 2 12 8 l8 -8 v24 l-8 -8 q-4 6 -12 8 q-18 4 -28 -12z" fill="#CFE6F2" ' + S + '/>' +
        '<path d="M26 26 q5 6 0 12 M33 25 q5 7 0 14 M40 27 q4 5 0 10" fill="none" stroke="#7FB2CF" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="16" cy="30" r="2" fill="' + INK + '"/>';
    },
    mafura: function () {
      return '<path d="M6 16 q12 -8 20 2 t20 2 q10 4 6 14 q-4 8 -16 4 t-18 4 q-8 4 -4 12" fill="none" stroke="' + INK + '" stroke-width="13" stroke-linecap="round"/>' +
        '<path d="M6 16 q12 -8 20 2 t20 2 q10 4 6 14 q-4 8 -16 4 t-18 4 q-8 4 -4 12" fill="none" stroke="#E4573D" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M6 16 q12 -8 20 2 t20 2 q10 4 6 14 q-4 8 -16 4 t-18 4 q-8 4 -4 12" fill="none" stroke="#FFF1E0" stroke-width="9" stroke-linecap="butt" stroke-dasharray="5 11"/>' +
        '<path d="M9 58 v4 M13 59 v4 M17 58 v4" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    },
    kujira: function () {
      return body('a-fly', '<path d="M32 46 q-3 6 1 10 q3 3 -1 6" fill="none" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<path d="M50 24 q8 -8 10 -12 q-1 8 -4 14z" fill="#4E8FCB" ' + S + '/>' +
        '<ellipse cx="30" cy="30" rx="24" ry="17" fill="#5FA3DD" ' + S + '/>' +
        '<path d="M8 36 q20 12 42 2" fill="none" stroke="#DCEEFA" stroke-width="4" stroke-linecap="round"/>' +
        '<circle cx="17" cy="28" r="2" fill="' + INK + '"/><path d="M28 12 q-2 -6 -6 -6 M28 12 q2 -6 6 -6" fill="none" ' + S + '/>');
    },
    wataame: function () {
      return sparkle() + '<path d="M32 40 v20" stroke="#C9A36A" stroke-width="4" stroke-linecap="round"/>' + fluffy(32, 26, 15, 12, '#F9B8D0');
    },
    koori: function () {
      return hop() + body('a-hop', '<path d="M16 22 l18 -8 l16 8 v20 l-16 10 l-18 -10z" fill="#CDEBFA" ' + S + '/>' +
        '<path d="M16 22 l18 8 l16 -8 M34 30 v22" fill="none" stroke="#7FBBDD" stroke-width="2"/>' +
        '<path d="M22 30 l5 3" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>');
    },
    donatsu: function () {
      return notes() + '<circle cx="32" cy="36" r="21" fill="#D9A05B" ' + S + '/>' +
        '<path d="M13 34 q2 -17 19 -17 q17 0 19 17 q-4 6 -8 2 q-4 6 -9 1 q-5 6 -10 0 q-6 4 -11 -3z" fill="#F28FB1" ' + S + '/>' +
        '<circle cx="32" cy="36" r="7" fill="#FBF2DF" ' + S + '/>' +
        '<path d="M21 26 l3 2 M40 23 l-2 3 M45 31 l3 1 M27 22 l1 3" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>';
    },
    biidama: function () {
      return '<circle cx="32" cy="32" r="26" fill="#7EC8E3" ' + S + '/>' +
        '<path d="M14 36 q10 -22 26 -14 q12 6 4 20 q-8 12 -18 4 q-6 -6 2 -10" fill="none" stroke="#2E8B57" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M16 20 q5 -7 11 -8" fill="none" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M56 62 v-9 l5 2.5 l-5 2.5" fill="#E4573D" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>';
    },
    yukidaruma: function () {
      return body('a-fly', wings(38, 15, 49) +
        '<circle cx="32" cy="44" r="15" fill="#FFFFFF" ' + S + '/><circle cx="32" cy="22" r="11" fill="#FFFFFF" ' + S + '/>' +
        '<circle cx="28" cy="20" r="1.6" fill="' + INK + '"/><circle cx="36" cy="20" r="1.6" fill="' + INK + '"/>' +
        '<path d="M32 23 l7 2 l-7 2z" fill="#F08A2E" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<circle cx="32" cy="40" r="1.8" fill="' + INK + '"/><circle cx="32" cy="48" r="1.8" fill="' + INK + '"/>');
    },
    aisu: function () {
      return frost() + '<rect x="29" y="46" width="6" height="16" rx="3" fill="#D9B77E" ' + S + '/>' +
        '<rect x="22" y="2" width="20" height="48" rx="9" fill="#8FD3F0" ' + S + '/>' +
        '<path d="M22 20 h20 M22 34 h20" stroke="#F9B8D0" stroke-width="5"/>' +
        '<path d="M27 8 v8" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>';
    },
    nawatobi: function () {
      return sparkle() + '<path d="M17 26 q-9 32 15 32 q24 0 15 -32" fill="none" stroke="#F5B921" stroke-width="4" stroke-linecap="round"/>' +
        '<rect x="12" y="8" width="9" height="22" rx="4.5" fill="#E4573D" ' + S + ' transform="rotate(-12 16 19)"/>' +
        '<rect x="43" y="8" width="9" height="22" rx="4.5" fill="#E4573D" ' + S + ' transform="rotate(12 48 19)"/>';
    },
    taiko: function () {
      return notes() + '<path d="M18 8 l10 14 M46 8 l-10 14" stroke="#B07A45" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M16 30 v16 q0 8 16 8 q16 0 16 -8 v-16z" fill="#D9423A" ' + S + '/>' +
        '<ellipse cx="32" cy="30" rx="16" ry="7" fill="#FBF2DF" ' + S + '/>' +
        '<path d="M20 40 l6 10 l6 -10 l6 10 l6 -10" fill="none" stroke="#F5B921" stroke-width="2" stroke-linejoin="round"/>';
    },
    rappa: function () {
      return notes() + fluffy(48, 34, 9, 13, '#FBE3A6') +
        '<path d="M6 30 h30 l8 -6 v20 l-8 -6 h-30z" fill="#FBE3A6" ' + S + '/>' +
        '<rect x="3" y="29" width="6" height="10" rx="3" fill="#F5C96A" ' + S + '/>' +
        '<circle cx="16" cy="27" r="3" fill="#FFFFFF" ' + S + '/><circle cx="23" cy="27" r="3" fill="#FFFFFF" ' + S + '/><circle cx="30" cy="27" r="3" fill="#FFFFFF" ' + S + '/>';
    },
    makura: function () {
      return hop() + body('a-hop', '<path d="M8 22 q4 -6 10 -2 q14 -4 28 0 q6 -4 10 2 q-4 4 -2 12 q-2 8 2 12 q-4 6 -10 2 q-14 4 -28 0 q-6 4 -10 -2 q4 -4 2 -12 q2 -8 -2 -12z" fill="#BFE0F5" ' + S + '/>' +
        '<path d="M20 28 q12 -3 24 0 M20 42 q12 3 24 0" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M25 34 q2 2 4 0 M35 34 q2 2 4 0" fill="none" ' + S + '/>');
    },
    ishi: function () {
      return steam(32, 22) + '<path d="M10 46 q-2 -14 12 -18 q12 -4 22 2 q12 6 10 16 q-2 10 -22 10 q-20 0 -22 -10z" fill="#B9A998" ' + S + '/>' +
        '<circle cx="19" cy="44" r="3.5" fill="#F4A6A0" opacity="0.8"/><circle cx="45" cy="44" r="3.5" fill="#F4A6A0" opacity="0.8"/>' +
        '<path d="M24 40 q2 -2 4 0 M36 40 q2 -2 4 0 M29 46 q3 3 6 0" fill="none" ' + S + '/>';
    },
    hoshi: function () {
      return sparkle() + body('a-fly', wings(34, 14, 50) +
        '<path d="M32 10 l6.5 14 l15 2 l-11 10.5 l3 15 l-13.5 -7.5 l-13.5 7.5 l3 -15 l-11 -10.5 l15 -2z" fill="#FFE27A" ' + S + '/>' +
        '<circle cx="28" cy="32" r="1.6" fill="' + INK + '"/><circle cx="36" cy="32" r="1.6" fill="' + INK + '"/><path d="M29 37 q3 3 6 0" fill="none" ' + S + '/>');
    },
    tokei: function () {
      return notes() + '<circle cx="18" cy="14" r="8" fill="#F5B921" ' + S + '/><circle cx="46" cy="14" r="8" fill="#F5B921" ' + S + '/>' +
        '<path d="M16 56 l-5 6 M48 56 l5 6" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="32" cy="36" r="23" fill="#E4573D" ' + S + '/><circle cx="32" cy="36" r="17" fill="#FFFDF5" ' + S + '/>' +
        '<path d="M32 36 v-11 M32 36 l8 5" fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>';
    },
    boru: function () {
      return sparkle() + hop() + body('a-hop', '<circle cx="32" cy="32" r="20" fill="#F5B921" ' + S + '/>' +
        '<path d="M13 28 q19 10 38 0 M22 15 q10 17 0 34 M42 15 q-10 17 0 34" fill="none" stroke="#E4573D" stroke-width="2.4"/>' +
        '<path d="M20 22 q3 -5 8 -6" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>');
    },
    tako: function () {
      return body('a-fly', '<path d="M30 40 q-8 6 -2 10 q8 4 0 8 q-6 2 -10 4" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M24 48 l-5 -2 l1 5z M30 55 l5 -3 l1 5z M20 59 l-4 -3 l0 5z" fill="#F5B921" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M34 2 l20 18 l-24 22 l-16 -24z" fill="#5FA3DD" ' + S + '/>' +
        '<path d="M34 2 l-4 40 M14 18 l40 2" fill="none" stroke="' + INK + '" stroke-width="1.6"/>' +
        '<path d="M34 2 l20 18 l-21 0z" fill="#F28FB1" ' + S + '/>');
    },
    manju: function () {
      return steam(32, 20) + '<path d="M8 44 q0 -20 24 -20 q24 0 24 20 q0 10 -24 10 q-24 0 -24 -10z" fill="#FFF6E4" ' + S + '/>' +
        '<path d="M8 44 q0 10 24 10 q24 0 24 -10 q-10 4 -24 4 q-14 0 -24 -4z" fill="#E8C99A"/>' +
        '<circle cx="20" cy="42" r="3.5" fill="#F4A6A0" opacity="0.8"/><circle cx="44" cy="42" r="3.5" fill="#F4A6A0" opacity="0.8"/>' +
        '<path d="M25 38 q2 -2 4 0 M35 38 q2 -2 4 0 M29 44 q3 3 6 0" fill="none" ' + S + '/>';
    },
    kasa: function () {
      return notes() + body('a-fly', wings(30, 11, 53) +
        '<path d="M32 28 v24 q0 6 -5 6 q-5 0 -5 -5" fill="none" stroke="' + INK + '" stroke-width="3.2" stroke-linecap="round"/>' +
        '<path d="M8 30 Q32 2 56 30 q-4 -4 -8 0 q-4 -4 -8 0 q-4 -4 -8 0 q-4 -4 -8 0 q-4 -4 -8 0 q-4 -4 -8 0z" fill="#E4573D" ' + S + '/>' +
        '<path d="M32 12 q-7 8 -8 18 M32 12 q7 8 8 18" fill="none" stroke="#F7C9A8" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="32" cy="11" r="2.4" fill="#F5B921" ' + S + '/>' +
        '<circle cx="21" cy="23" r="1.6" fill="' + INK + '"/><circle cx="43" cy="23" r="1.6" fill="' + INK + '"/>');
    },
    shabon: function () {
      return sparkle() + body('a-fly', '<circle cx="32" cy="32" r="20" fill="#E2F4FB" ' + S + '/>' +
        '<path d="M16 40 q10 10 26 4" fill="none" stroke="#F9B8D0" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M44 20 q6 6 5 14" fill="none" stroke="#B8E0F5" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M20 24 q3 -6 9 -8" fill="none" stroke="#FFFFFF" stroke-width="3.5" stroke-linecap="round"/>' +
        '<circle cx="12" cy="54" r="4" fill="#E2F4FB" ' + S + '/><circle cx="54" cy="58" r="2.6" fill="#E2F4FB" ' + S + '/>' +
        '<circle cx="27" cy="33" r="1.6" fill="' + INK + '"/><circle cx="37" cy="33" r="1.6" fill="' + INK + '"/><path d="M29 37 q3 3 6 0" fill="none" ' + S + '/>');
    },
    furaipan: function () {
      return steam(26, 16) + '<path d="M42 40 l18 6" stroke="' + INK + '" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M42 40 l18 6" stroke="#B07A45" stroke-width="4.5" stroke-linecap="round"/>' +
        fluffy(26, 40, 19, 14, '#FFE8C2') +
        '<ellipse cx="26" cy="40" rx="13" ry="8" fill="#F7D56A" ' + S + '/>' +
        '<circle cx="22" cy="39" r="1.6" fill="' + INK + '"/><circle cx="30" cy="39" r="1.6" fill="' + INK + '"/><path d="M24 43 q2 2 4 0" fill="none" ' + S + '/>';
    },
    kakigoori: function () {
      return '<path d="M12 38 q0 -26 20 -26 q20 0 20 26z" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M15 26 q5 -14 17 -14 q12 0 17 14 q-4 4 -8 0 q-4 5 -9 0 q-5 5 -9 0 q-4 4 -8 0z" fill="#F28FB1" ' + S + '/>' +
        '<path d="M40 8 l-6 22" stroke="#F5B921" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="M10 38 h44 l-6 20 h-32z" fill="#8FD3F0" ' + S + '/>' +
        '<path d="M14 44 h36" stroke="#FFFFFF" stroke-width="2.4"/>' +
        '<circle cx="27" cy="50" r="1.6" fill="' + INK + '"/><circle cx="37" cy="50" r="1.6" fill="' + INK + '"/>' + sparkle();
    },
    zerii: function () {
      return frost() + hop() + body('a-hop', '<ellipse cx="32" cy="50" rx="22" ry="5" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M14 48 q-2 -26 18 -28 q20 2 18 28 q-18 4 -36 0z" fill="#F57F9A" ' + S + '/>' +
        '<path d="M20 40 q-1 -10 6 -14" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" opacity="0.8"/>' +
        '<path d="M33 18 q2 -6 7 -8" fill="none" stroke="#3E9B5F" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="32" cy="18" r="4.5" fill="#D9423A" ' + S + '/>' +
        '<circle cx="27" cy="36" r="1.6" fill="' + INK + '"/><circle cx="37" cy="36" r="1.6" fill="' + INK + '"/><path d="M29 40 q3 3 6 0" fill="none" ' + S + '/>');
    },
    meronpan: function () {
      return '<rect x="4" y="20" width="56" height="28" rx="14" fill="#F2D27A" ' + S + '/>' +
        '<path d="M8 40 q24 8 48 0 q-2 6 -10 8 h-28 q-8 -2 -10 -8z" fill="#E0A35E"/>' +
        '<path d="M16 23 l7 18 M27 22 l7 19 M38 22 l7 19 M22 23 l-6 16 M33 22 l-7 19 M44 22 l-7 19 M50 24 l-5 15" fill="none" stroke="#D9A05B" stroke-width="1.6" stroke-linecap="round"/>' +
        '<rect x="4" y="20" width="56" height="28" rx="14" fill="none" ' + S + '/>' +
        '<circle cx="12" cy="30" r="1" fill="#FFFFFF"/><circle cx="52" cy="28" r="1" fill="#FFFFFF"/><circle cx="30" cy="44" r="1" fill="#FFFFFF"/>';
    },
    tsurara: function () {
      return '<path d="M10 14 l5 22 l5 -22z" fill="#CDEBFA" ' + S + '/>' +
        '<path d="M44 14 l5 30 l5 -30z" fill="#CDEBFA" ' + S + '/>' +
        '<path d="M25 14 l7 46 l7 -46z" fill="#CDEBFA" ' + S + '/>' +
        '<path d="M28 18 l2 16" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>' +
        '<rect x="4" y="6" width="56" height="10" rx="5" fill="#FFFFFF" ' + S + '/>' +
        '<circle cx="30" cy="24" r="1.4" fill="' + INK + '"/><circle cx="35" cy="24" r="1.4" fill="' + INK + '"/>' + sparkle();
    },
    kumo: function () {
      return body('a-fly', wings(34, 21, 43) + fluffy(32, 34, 11, 7, '#FFFFFF') +
        '<circle cx="29" cy="34" r="1.4" fill="' + INK + '"/><circle cx="35" cy="34" r="1.4" fill="' + INK + '"/><path d="M30.5 37 q1.5 1.5 3 0" fill="none" stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round"/>');
    },
    juutan: function () {
      return body('a-fly', '<path d="M6 44 h-4 M6 40 h-4 M6 36 h-4 M6 32 h-4 M58 40 h4 M58 36 h4 M58 32 h4 M58 28 h4" stroke="#F5B921" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M6 30 q13 -5 26 -2 t26 -2 v16 q-13 -3 -26 2 t-26 2z" fill="#D9423A" ' + S + '/>' +
        '<path d="M11 33 q11 -4 21 -1 t21 -2 v9 q-11 -2 -21 2 t-21 1z" fill="none" stroke="#F5B921" stroke-width="2"/>' +
        '<path d="M32 31 l5 5 l-5 5 l-5 -5z" fill="#F5B921" stroke="' + INK + '" stroke-width="1.4" stroke-linejoin="round"/>' +
        '<path d="M14 54 h10 M30 57 h14" stroke="' + INK + '" stroke-width="2" stroke-linecap="round" opacity="0.4"/>');
    },
    suzu: function () {
      return notes() + '<circle cx="32" cy="14" r="5" fill="none" stroke="' + INK + '" stroke-width="2.4"/>' +
        '<circle cx="32" cy="38" r="22" fill="#F5B921" ' + S + '/>' +
        '<path d="M10 36 q22 8 44 0" fill="none" ' + S + '/>' +
        '<circle cx="32" cy="48" r="3.2" fill="' + INK + '"/><path d="M32 48 v10" stroke="' + INK + '" stroke-width="2.4" stroke-linecap="round"/>' +
        '<path d="M18 26 q4 -6 10 -7" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M32 18 l-8 -4 v8z M32 18 l8 -4 v8z" fill="#E4573D" ' + S + '/>';
    },
    rantan: function () {
      return '<circle cx="32" cy="34" r="22" fill="#FFE27A" opacity="0.45"/>' + sparkle() +
        '<path d="M24 14 q8 -12 16 0" fill="none" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>' +
        '<rect x="20" y="18" width="24" height="28" rx="3" fill="#FFE9A8" ' + S + '/>' +
        '<path d="M32 26 q7 8 0 15 q-7 -7 0 -15z" fill="#F08A2E" ' + S + '/>' +
        '<path d="M25 18 v28 M39 18 v28" stroke="#5B6670" stroke-width="2"/>' +
        '<path d="M18 18 h28 l-5 -6 h-18z" fill="#5B6670" ' + S + '/>' +
        '<rect x="17" y="46" width="30" height="8" rx="2" fill="#5B6670" ' + S + '/>' +
        '<path d="M21 49 h8" stroke="#C9D3DB" stroke-width="2" stroke-linecap="round"/>';
    },
    mashumaro: function () {
      return hop() + body('a-hop', '<rect x="16" y="22" width="32" height="30" rx="11" fill="#FFFDF5" ' + S + '/>' +
        '<ellipse cx="32" cy="26" rx="14" ry="5" fill="#FFE3EC" ' + S + '/>' +
        '<circle cx="21" cy="42" r="3" fill="#F4A6A0" opacity="0.8"/><circle cx="43" cy="42" r="3" fill="#F4A6A0" opacity="0.8"/>' +
        '<circle cx="27" cy="38" r="1.6" fill="' + INK + '"/><circle cx="37" cy="38" r="1.6" fill="' + INK + '"/><path d="M29 42 q3 3 6 0" fill="none" ' + S + '/>');
    },
    kusshon: function () {
      return frost() + fluffy(32, 34, 18, 16, '#BFE6F7') +
        '<path d="M32 34 l-10 -9 M32 34 l10 -9 M32 34 l-10 9 M32 34 l10 9" fill="none" stroke="#7FBBDD" stroke-width="2" stroke-linecap="round"/>' +
        '<circle cx="32" cy="34" r="3.4" fill="#5AA7D6" ' + S + '/>' +
        '<path d="M18 26 q2 -4 6 -5" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>';
    },
    donguri: function () {
      return notes() + '<path d="M16 30 q0 26 16 26 q16 0 16 -26z" fill="#C47A3A" ' + S + '/>' +
        '<path d="M21 36 q0 8 4 12" fill="none" stroke="#F1C79A" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M12 32 q0 -16 20 -16 q20 0 20 16z" fill="#8A5A2B" ' + S + '/>' +
        '<path d="M18 26 l4 3 M26 22 l4 3 M34 22 l4 3 M42 26 l4 3 M22 20 l3 2 M38 19 l3 2" stroke="#B88456" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M32 16 l2 -6" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="27" cy="40" r="1.6" fill="' + INK + '"/><circle cx="37" cy="40" r="1.6" fill="' + INK + '"/><path d="M29 44 q3 3 6 0" fill="none" ' + S + '/>';
    },
    kukkii: function () {
      return body('a-fly', wings(30, 14, 50) + '<circle cx="32" cy="32" r="19" fill="#E0A35E" ' + S + '/>' +
        '<circle cx="32" cy="32" r="15" fill="none" stroke="#C47A3A" stroke-width="1.6" stroke-dasharray="2 4"/>' +
        '<circle cx="23" cy="24" r="2.6" fill="#6B3E1F"/><circle cx="41" cy="23" r="2.2" fill="#6B3E1F"/><circle cx="22" cy="40" r="2.2" fill="#6B3E1F"/><circle cx="42" cy="41" r="2.6" fill="#6B3E1F"/><circle cx="33" cy="45" r="2" fill="#6B3E1F"/>' +
        '<circle cx="27" cy="31" r="1.6" fill="' + INK + '"/><circle cx="37" cy="31" r="1.6" fill="' + INK + '"/><path d="M29 35 q3 3 6 0" fill="none" ' + S + '/>');
    },
    ame: function () {
      return sparkle() + '<path d="M19 32 l-14 -10 v20z" fill="#FFE27A" ' + S + '/>' +
        '<path d="M45 32 l14 -10 v20z" fill="#FFE27A" ' + S + '/>' +
        '<circle cx="32" cy="32" r="14" fill="#F28FB1" ' + S + '/>' +
        '<path d="M32 32 q4 -1 3 -5 q-2 -5 -8 -2 q-6 4 -2 11 q5 7 14 2 q8 -6 3 -14" fill="none" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>';
    },
    hottokeeki: function () {
      return steam(32, 14) + '<ellipse cx="32" cy="54" rx="28" ry="6" fill="#FFFFFF" ' + S + '/>' +
        '<rect x="6" y="40" width="52" height="11" rx="5.5" fill="#D9A05B" ' + S + '/>' +
        '<rect x="7" y="31" width="50" height="11" rx="5.5" fill="#D9A05B" ' + S + '/>' +
        '<rect x="8" y="22" width="48" height="11" rx="5.5" fill="#D9A05B" ' + S + '/>' +
        '<path d="M12 24 q20 -4 40 0 q2 4 -2 5 q-2 6 -4 0 q-8 2 -16 0 q-1 8 -4 8 q-3 0 -3 -8 q-6 0 -11 -5z" fill="#9A5A22" ' + S + '/>' +
        '<rect x="27" y="17" width="10" height="6" rx="1.5" fill="#FFE27A" ' + S + '/>';
    },
    supuun: function () {
      return sparkle() + '<g transform="rotate(35 32 32)">' +
        '<rect x="29" y="22" width="6" height="40" rx="3" fill="#D6DEE6" ' + S + '/>' +
        '<ellipse cx="32" cy="12" rx="9" ry="11" fill="#D6DEE6" ' + S + '/>' +
        '<path d="M28 7 q-2 4 -1 9 M31 30 v24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>' +
        '<circle cx="29.5" cy="13" r="1.4" fill="' + INK + '"/><circle cx="34.5" cy="13" r="1.4" fill="' + INK + '"/></g>';
    },
    koorinoisu: function () {
      return frost() + '<rect x="16" y="6" width="32" height="30" rx="4" fill="#CDEBFA" ' + S + '/>' +
        '<rect x="16" y="42" width="6" height="18" rx="2" fill="#A9DCF5" ' + S + '/><rect x="42" y="42" width="6" height="18" rx="2" fill="#A9DCF5" ' + S + '/>' +
        '<path d="M12 36 h40 l-4 10 h-32z" fill="#A9DCF5" ' + S + '/>' +
        '<path d="M22 12 l6 6 M22 20 l3 3" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M40 12 v18" stroke="#7FBBDD" stroke-width="2" stroke-linecap="round"/>';
    },
    bane: function () {
      return hop() + body('a-hop', '<path d="M22 50 L42 44 L22 38 L42 32 L22 26 L42 20 L22 14" fill="none" stroke="' + INK + '" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M22 50 L42 44 L22 38 L42 32 L22 26 L42 20 L22 14" fill="none" stroke="#C9D3DB" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<rect x="16" y="50" width="32" height="6" rx="3" fill="#E4573D" ' + S + '/>' +
        '<rect x="16" y="8" width="32" height="6" rx="3" fill="#E4573D" ' + S + '/>' +
        '<path d="M20 10 h8" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round"/>');
    },
    gomuboru: function () {
      return notes() + hop() + body('a-hop', '<circle cx="32" cy="34" r="18" fill="#E4573D" ' + S + '/>' +
        '<path d="M14.5 30 q17.5 8 35 0 l0.5 6 q-18 8 -36 0z" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M21 22 q3 -5 8 -6" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="27" cy="43" r="1.6" fill="' + INK + '"/><circle cx="37" cy="43" r="1.6" fill="' + INK + '"/><path d="M29 47 q3 3 6 0" fill="none" ' + S + '/>');
    },
    reizouko: function () {
      return notes() + '<rect x="15" y="4" width="34" height="56" rx="5" fill="#E8F4FA" ' + S + '/>' +
        '<path d="M15 24 h34" stroke="' + INK + '" stroke-width="2"/>' +
        '<rect x="41" y="10" width="3.5" height="9" rx="1.7" fill="#9AB3C2" stroke="' + INK + '" stroke-width="1.4"/>' +
        '<rect x="41" y="29" width="3.5" height="12" rx="1.7" fill="#9AB3C2" stroke="' + INK + '" stroke-width="1.4"/>' +
        '<path d="M26 9 v9 M22 13.5 h8 M23 10.5 l6 6 M29 10.5 l-6 6" stroke="#5AA7D6" stroke-width="1.6" stroke-linecap="round"/>' +
        '<circle cx="26" cy="40" r="1.6" fill="' + INK + '"/><circle cx="36" cy="40" r="1.6" fill="' + INK + '"/><ellipse cx="31" cy="46" rx="2.8" ry="2.2" fill="' + INK + '"/>' +
        '<path d="M19 60 v2 M45 60 v2" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>';
    },
    sutoobu: function () {
      return steam(41, 15) + body('a-fly', wings(36, 16, 48) +
        '<rect x="38" y="16" width="7" height="12" fill="#5B6670" ' + S + '/>' +
        '<path d="M20 52 l-2 6 M44 52 l2 6" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
        '<rect x="14" y="26" width="36" height="27" rx="5" fill="#D9423A" ' + S + '/>' +
        '<rect x="22" y="33" width="20" height="13" rx="3" fill="#FFE27A" ' + S + '/>' +
        '<path d="M32 35 q5 5 0 10 q-5 -5 0 -10z" fill="#F08A2E"/>' +
        '<path d="M18 30 h8" stroke="#F7C9A8" stroke-width="2" stroke-linecap="round"/>');
    },
    keitodama: function () {
      return '<path d="M40 44 q10 8 2 12 q-8 4 2 6 q8 1 16 -4" fill="none" stroke="' + INK + '" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M40 44 q10 8 2 12 q-8 4 2 6 q8 1 16 -4" fill="none" stroke="#F28FB1" stroke-width="2.4" stroke-linecap="round"/>' +
        fluffy(28, 30, 16, 16, '#F28FB1') +
        '<path d="M16 22 q12 4 22 18 M14 32 q14 0 22 14 M24 14 q10 6 16 22 M18 44 q10 -16 24 -20" fill="none" stroke="#FFD0E0" stroke-width="2" stroke-linecap="round"/>';
    },
    kinoko: function () {
      return sparkle() + '<rect x="26" y="34" width="12" height="14" rx="5" fill="#FFF6E4" ' + S + '/>' +
        '<path d="M16 36 q0 -18 16 -18 q16 0 16 18z" fill="#E4573D" ' + S + '/>' +
        '<circle cx="25" cy="27" r="2.6" fill="#FFFFFF"/><circle cx="38" cy="25" r="2" fill="#FFFFFF"/><circle cx="33" cy="32" r="1.6" fill="#FFFFFF"/>' +
        '<circle cx="29.5" cy="41" r="1.3" fill="' + INK + '"/><circle cx="34.5" cy="41" r="1.3" fill="' + INK + '"/>';
    },
    sofuto: function () {
      return frost() + body('a-fly', wings(36, 21, 43) +
        '<path d="M22 36 l10 24 l10 -24z" fill="#D9A05B" ' + S + '/>' +
        '<path d="M26 42 l9 6 M28 48 l6 4 M38 42 l-9 6" stroke="#B07A45" stroke-width="1.6" stroke-linecap="round"/>' +
        '<path d="M19 37 q-3 -9 13 -9 q16 0 13 9z" fill="#FFFDF5" ' + S + '/>' +
        '<path d="M23 29 q0 -9 9 -9 q9 0 9 9z" fill="#FFFDF5" ' + S + '/>' +
        '<path d="M27 21 q0 -6 5 -7 q4 -2 5 -7 q3 6 1 10 q3 1 2 4z" fill="#FFFDF5" ' + S + '/>' +
        '<circle cx="28.5" cy="32" r="1.4" fill="' + INK + '"/><circle cx="35.5" cy="32" r="1.4" fill="' + INK + '"/>');
    },
    omochi: function () {
      return steam(24, 18) + hop() + body('a-hop', '<path d="M10 46 q0 -20 22 -20 q22 0 22 20 q0 8 -22 8 q-22 0 -22 -8z" fill="#FFFDF5" ' + S + '/>' +
        '<circle cx="45" cy="25" r="6" fill="#FFFDF5" ' + S + '/>' +
        '<path d="M14 48 q18 6 36 0" fill="none" stroke="#E8C99A" stroke-width="3" stroke-linecap="round"/>' +
        '<circle cx="20" cy="42" r="3.2" fill="#F4A6A0" opacity="0.8"/><circle cx="44" cy="42" r="3.2" fill="#F4A6A0" opacity="0.8"/>' +
        '<circle cx="26" cy="38" r="1.6" fill="' + INK + '"/><circle cx="38" cy="38" r="1.6" fill="' + INK + '"/><path d="M29 42 q3 3 6 0" fill="none" ' + S + '/>');
    },
    tanpopo: function () {
      let r = '';
      for (let i = 0; i < 12; i++) {
        const a = i / 12 * Math.PI * 2;
        r += 'M28 26 L' + (28 + Math.cos(a) * 12).toFixed(1) + ' ' + (26 + Math.sin(a) * 12).toFixed(1) + ' ';
      }
      return '<path d="M28 40 q2 12 -2 22" fill="none" stroke="#3E9B5F" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M26 58 q-12 -2 -16 -10 q8 0 16 6z" fill="#7CC07F" ' + S + '/>' +
        fluffy(28, 26, 15, 15, '#FFFFFF') +
        '<path d="' + r + '" fill="none" stroke="#C9C3BA" stroke-width="1.4"/><circle cx="28" cy="26" r="3" fill="#C9A36A"/>' +
        body('a-fly', '<g fill="none" stroke="' + INK + '" stroke-width="1.6" stroke-linecap="round">' +
          '<path d="M52 18 v8 M48 16 l4 2 l4 -2 M52 18 v-4"/><path d="M56 40 v7 M53 38 l3 2 l3 -2 M56 40 v-3"/></g>');
    },
    piano: function () {
      return notes() + '<path d="M22 44 v8 M42 44 v8" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
        '<rect x="18" y="22" width="28" height="23" rx="3" fill="#D9423A" ' + S + '/>' +
        '<rect x="20" y="35" width="24" height="7" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M26 35 v4 M32 35 v4 M38 35 v4" stroke="' + INK + '" stroke-width="2.6"/>' +
        '<path d="M22 26 h10" stroke="#F7C9A8" stroke-width="2" stroke-linecap="round"/>';
    },
    futon: function () {
      return '<rect x="4" y="38" width="56" height="12" rx="5" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M6 40 q-2 -14 10 -14 h36 q10 0 8 14 q-2 6 -27 6 q-25 0 -27 -6z" fill="#A7D8F0" ' + S + '/>' +
        '<path d="M20 28 q2 8 0 16 M34 27 q2 9 0 18 M48 28 q2 8 0 15" fill="none" stroke="#7FBBDD" stroke-width="2" stroke-linecap="round"/>' +
        '<rect x="6" y="20" width="18" height="11" rx="5" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M12 33 q4 -2 8 0" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round"/>' + frost();
    },
    kutsu: function () {
      return sparkle() + hop() + body('a-hop', '<path d="M18 28 h11 l3 6 l9 3 q7 2 7 7 v2 h-30z" fill="#5FA3DD" ' + S + '/>' +
        '<rect x="17" y="46" width="32" height="5" rx="2.5" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M28 34 l4 -2 M30 38 l4 -2" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>' +
        '<g fill="#F5B921" stroke="#B8860B" stroke-width="1">' + star4(22, 40, 3.5) + '</g>');
    },
    kagami: function () {
      return sparkle() + body('a-fly', wings(28, 18, 46) +
        '<rect x="29" y="42" width="6" height="18" rx="3" fill="#F5B921" ' + S + '/>' +
        '<ellipse cx="32" cy="26" rx="14" ry="17" fill="#F5B921" ' + S + '/>' +
        '<ellipse cx="32" cy="26" rx="10" ry="13" fill="#CDEBFA" ' + S + '/>' +
        '<path d="M26 22 l6 -6 M27 30 l10 -10" stroke="#FFFFFF" stroke-width="2.6" stroke-linecap="round"/>');
    },
    onabe: function () {
      return notes() + steam(32, 14) + hop() + body('a-hop', '<path d="M7 34 h6 M51 34 h6" stroke="' + INK + '" stroke-width="5" stroke-linecap="round"/>' +
        '<path d="M12 30 h40 v14 q0 10 -10 10 h-20 q-10 0 -10 -10z" fill="#E4573D" ' + S + '/>' +
        '<path d="M10 30 q22 -12 44 0z" fill="#F28F6A" ' + S + '/>' +
        '<circle cx="32" cy="21" r="3" fill="#5B6670" ' + S + '/>' +
        '<circle cx="26" cy="40" r="1.6" fill="' + INK + '"/><circle cx="38" cy="40" r="1.6" fill="' + INK + '"/><path d="M29 44 q3 3 6 0" fill="none" ' + S + '/>');
    },
    keeki: function () {
      return notes() + '<path d="M8 30 v20 q0 7 24 7 q24 0 24 -7 v-20z" fill="#FFF1E0" ' + S + '/>' +
        '<path d="M8 40 q24 8 48 0" fill="none" stroke="#F28FB1" stroke-width="4"/>' +
        '<ellipse cx="32" cy="30" rx="24" ry="7" fill="#FFFFFF" ' + S + '/>' +
        '<circle cx="20" cy="27" r="4" fill="#E4573D" ' + S + '/><circle cx="32" cy="25" r="4" fill="#E4573D" ' + S + '/><circle cx="44" cy="27" r="4" fill="#E4573D" ' + S + '/>' +
        '<circle cx="26" cy="47" r="1.6" fill="' + INK + '"/><circle cx="38" cy="47" r="1.6" fill="' + INK + '"/><path d="M29 51 q3 3 6 0" fill="none" ' + S + '/>';
    },
    yukidama: function () {
      return frost() + '<ellipse cx="32" cy="46" rx="12" ry="3" fill="#DDEFFA"/>' +
        '<circle cx="32" cy="34" r="11" fill="#FFFFFF" ' + S + '/>' +
        '<path d="M24 38 q6 6 15 2" fill="none" stroke="#BFE0F5" stroke-width="2.4" stroke-linecap="round"/>' +
        '<circle cx="28.5" cy="33" r="1.4" fill="' + INK + '"/><circle cx="35.5" cy="33" r="1.4" fill="' + INK + '"/>';
    },
    hebi: function () {
      return hop() + body('a-hop', '<path d="M10 42 q7 -12 14 0 t14 0 t10 -6" fill="none" stroke="' + INK + '" stroke-width="10" stroke-linecap="round"/>' +
        '<path d="M10 42 q7 -12 14 0 t14 0 t10 -6" fill="none" stroke="#6CC27A" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M10 42 q7 -12 14 0 t14 0 t10 -6" fill="none" stroke="#F5D547" stroke-width="6" stroke-dasharray="3 7"/>' +
        '<circle cx="50" cy="32" r="8" fill="#6CC27A" ' + S + '/>' +
        '<circle cx="47" cy="30" r="1.6" fill="' + INK + '"/><circle cx="53" cy="30" r="1.6" fill="' + INK + '"/><path d="M48 35 q2 2 4 0" fill="none" ' + S + '/>' +
        '<circle cx="45" cy="34" r="1.8" fill="#F4A6A0" opacity="0.8"/><circle cx="55" cy="34" r="1.8" fill="#F4A6A0" opacity="0.8"/>');
    }
  };

  // ── ヒントの印（24×24） ──
  const T = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
  const TAG = {
    '大きい': '<rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor"/>',
    '小さい': '<rect x="9" y="9" width="6" height="6" rx="2" fill="currentColor"/>',
    'まるい': '<circle cx="12" cy="12" r="8" ' + T + '/>',
    'ながい': '<path d="M2 12 h20 M2 8 v8 M22 8 v8" ' + T + '/>',
    'ふわふわ': '<path d="M7 18 q-5 0 -5 -4 q0 -4 4 -4 q1 -5 6 -5 q5 0 6 5 q4 0 4 4 q0 4 -5 4z" fill="currentColor"/>',
    'かたい': '<path d="M12 3 l8 6 l-3 11 h-10 l-3 -11z M12 3 l-2 8 l-6 -2 M10 11 l7 9 M10 11 l10 -2" ' + T + '/>',
    '光る': '<path d="M12 2 l2 8 l8 2 l-8 2 l-2 8 l-2 -8 l-8 -2 l8 -2z" fill="currentColor"/>',
    'とぶ': '<path d="M2 14 q4 -10 16 -10 q-1 4 -4 5 q4 0 7 -1 q-2 6 -9 7 q-5 1 -10 -1z" fill="currentColor"/>',
    'はねる': '<path d="M3 20 q4 -16 9 0 q3 -9 6 0" ' + T + '/><circle cx="19" cy="7" r="3" fill="currentColor"/>',
    'あまい': '<circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M7 12 l-5 -4 v8z M17 12 l5 -4 v8z" fill="currentColor"/>',
    'つめたい': '<path d="M12 2 v20 M3.5 7 l17 10 M20.5 7 l-17 10" ' + T + '/>',
    'あたたかい': '<path d="M6 21 q-4 -4 0 -8 q4 -4 0 -9 M12 21 q-4 -4 0 -8 q4 -4 0 -9 M18 21 q-4 -4 0 -8 q4 -4 0 -9" ' + T + '/>',
    '音が出る': '<ellipse cx="7" cy="18" rx="4" ry="3" fill="currentColor"/><path d="M11 18 v-14 l9 -2 v4 l-9 2" ' + T + '/>'
  };

  // ── お店の人の顔（色は外から。頭のかざり4種類 × 12色で見分ける） ──
  const TOP = [
    '<path d="M18 16 l-6 -12 l14 6z M46 16 l6 -12 l-14 6z" fill="currentColor" ' + S + '/>',                      // とがった耳
    '<circle cx="14" cy="14" r="8" fill="currentColor" ' + S + '/><circle cx="50" cy="14" r="8" fill="currentColor" ' + S + '/>', // まるい耳
    '<path d="M32 12 q-2 -10 8 -10 q-2 6 -8 10z" fill="#3E9B5F" ' + S + '/>',                                        // 葉っぱ
    '<path d="M22 12 l-2 -10 l8 6 l4 -7 l4 7 l8 -6 l-2 10z" fill="#F5B921" ' + S + '/>'                              // かんむり
  ];
  function face(i) {
    return TOP[i % TOP.length] + '<circle cx="32" cy="35" r="23" fill="currentColor" ' + S + '/>' +
      '<circle cx="24" cy="32" r="2.6" fill="' + INK + '"/><circle cx="40" cy="32" r="2.6" fill="' + INK + '"/>' +
      '<circle cx="17" cy="41" r="4" fill="#FFFFFF" opacity="0.45"/><circle cx="47" cy="41" r="4" fill="#FFFFFF" opacity="0.45"/>' +
      '<path d="M26 42 q6 6 12 0" fill="none" ' + S + '/>';
  }

  // ── 箱 ──
  const BOX = '<path d="M8 24 l24 -10 l24 10 v26 l-24 10 l-24 -10z" fill="#C99A5B" ' + S + '/>' +
    '<path d="M8 24 l24 10 l24 -10 M32 34 v26" fill="none" ' + S + '/>' +
    '<path d="M20 19 l24 10 v8 l-4 -3 l-4 0 v-10 l-24 -10" fill="#F1DDB8" stroke="' + INK + '" stroke-width="1.6" stroke-linejoin="round"/>';

  function wrap(inner, size, label) {
    return '<svg viewBox="0 0 ' + size + ' ' + size + '" ' +
      (label ? 'role="img" aria-label="' + label + '"' : 'aria-hidden="true"') + '>' + inner + '</svg>';
  }

  // 遊ぶ人の色（12人まで）
  const COLORS = ['#E0762B', '#2A93B4', '#D9558B', '#4FA043', '#8A5CC4', '#D2A012', '#D0453A', '#3D5FA8', '#1E9E8A', '#9A6A3C', '#6F7C8A', '#8FB02A'];

  root.ArekuArt = {
    COLORS: COLORS,
    item: function (id) { return wrap(ITEM[id] ? ITEM[id]() : BOX, 64); },
    tag: function (t) { return wrap(TAG[t] || '', 24); },
    face: function (i) { return wrap(face(i), 64); },
    box: function () { return wrap(BOX, 64); },
    ids: Object.keys(ITEM)
  };
})(typeof self !== 'undefined' ? self : this);
