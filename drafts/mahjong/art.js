/* 麻雀（試作） — 牌の絵（SVG の文字列を返す）。window.MahjongArt
   すべて自作の図形。数字・漢字の牌は文字で描く。 */
(function (root) {
  'use strict';

  const NAVY = '#24324A';
  const RED = '#C2382C';
  const GREEN = '#2E7D4F';
  const BLUE = '#2459A0';
  const NUM_KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const FONT = "'Noto Sans JP', 'Hiragino Sans', sans-serif";

  // 筒子の丸の位置 [x, y, 色]
  const PIN = {
    1: [[30, 40, 'r']],
    2: [[30, 24, 'b'], [30, 56, 'g']],
    3: [[16, 20, 'b'], [30, 40, 'r'], [44, 60, 'g']],
    4: [[18, 24, 'b'], [42, 24, 'g'], [18, 56, 'g'], [42, 56, 'b']],
    5: [[17, 22, 'b'], [43, 22, 'g'], [30, 40, 'r'], [17, 58, 'g'], [43, 58, 'b']],
    6: [[19, 18, 'g'], [41, 18, 'g'], [19, 42, 'r'], [41, 42, 'r'], [19, 62, 'r'], [41, 62, 'r']],
    7: [[15, 15, 'g'], [30, 23, 'g'], [45, 31, 'g'], [19, 49, 'r'], [41, 49, 'r'], [19, 66, 'r'], [41, 66, 'r']],
    8: [[19, 14, 'b'], [41, 14, 'b'], [19, 31, 'b'], [41, 31, 'b'], [19, 49, 'b'], [41, 49, 'b'], [19, 66, 'b'], [41, 66, 'b']],
    9: [[15, 18, 'b'], [30, 18, 'b'], [45, 18, 'b'], [15, 40, 'r'], [30, 40, 'r'], [45, 40, 'r'], [15, 62, 'g'], [30, 62, 'g'], [45, 62, 'g']],
  };
  const PIN_R = { 1: 17, 2: 12, 3: 9.5, 4: 10, 5: 9, 6: 8.5, 7: 7.2, 8: 7.2, 9: 7 };
  const COL = { r: RED, b: BLUE, g: GREEN };

  // 索子の棒の位置 [x, y, 色]（y は棒のまん中）
  const SOU = {
    2: [[30, 24, 'g'], [30, 56, 'g']],
    3: [[30, 24, 'g'], [18, 56, 'g'], [42, 56, 'g']],
    4: [[19, 24, 'g'], [41, 24, 'g'], [19, 56, 'g'], [41, 56, 'g']],
    5: [[16, 24, 'g'], [44, 24, 'g'], [30, 40, 'r'], [16, 56, 'g'], [44, 56, 'g']],
    6: [[15, 24, 'g'], [30, 24, 'g'], [45, 24, 'g'], [15, 56, 'g'], [30, 56, 'g'], [45, 56, 'g']],
    7: [[30, 16, 'r'], [15, 42, 'g'], [30, 42, 'g'], [45, 42, 'g'], [15, 65, 'g'], [30, 65, 'g'], [45, 65, 'g']],
    8: [[12, 24, 'g'], [24, 24, 'g'], [36, 24, 'g'], [48, 24, 'g'], [12, 56, 'g'], [24, 56, 'g'], [36, 56, 'g'], [48, 56, 'g']],
    9: [[15, 17, 'g'], [30, 17, 'r'], [45, 17, 'g'], [15, 40, 'g'], [30, 40, 'r'], [45, 40, 'g'], [15, 63, 'g'], [30, 63, 'r'], [45, 63, 'g']],
  };

  function circle(x, y, r, c) {
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${c}" stroke-width="${r * 0.28}"/>`
      + `<circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="${c}"/>`;
  }
  function stick(x, y, h, c) {
    const w = 6.5;
    return `<rect x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="3" fill="${c}"/>`
      + `<rect x="${x - w / 2 - 0.8}" y="${y - 1}" width="${w + 1.6}" height="2" rx="1" fill="${c}"/>`
      + `<line x1="${x}" y1="${y - h / 2 + 3}" x2="${x}" y2="${y + h / 2 - 3}" stroke="#fff" stroke-opacity=".45" stroke-width="1.2"/>`;
  }
  function text(x, y, size, c, s, weight) {
    return `<text x="${x}" y="${y}" font-size="${size}" font-family="${FONT}" font-weight="${weight || 700}" fill="${c}" text-anchor="middle" dominant-baseline="central">${s}</text>`;
  }

  function faceInner(k) {
    if (k < 9) {
      return text(30, 25, 25, NAVY, NUM_KANJI[k]) + text(30, 57, 25, RED, '萬');
    }
    if (k < 18) {
      const n = k - 8;
      if (n === 1) {
        return circle(30, 40, 17, BLUE) + `<circle cx="30" cy="40" r="11" fill="none" stroke="${GREEN}" stroke-width="2.5"/>` + `<circle cx="30" cy="40" r="5" fill="${RED}"/>`;
      }
      return PIN[n].map(([x, y, c]) => circle(x, y, PIN_R[n], COL[c])).join('');
    }
    if (k < 27) {
      const n = k - 17;
      if (n === 1) {
        // 1索: 大きな竹と葉
        return stick(30, 44, 46, GREEN) + `<path d="M31 22 C40 12 48 14 50 18 C44 18 38 21 33 26 Z" fill="${GREEN}"/>`
          + `<path d="M29 30 C20 22 12 24 10 28 C17 28 22 30 27 34 Z" fill="${RED}"/>`;
      }
      const h = n >= 7 ? 17 : 24;
      return SOU[n].map(([x, y, c]) => stick(x, y, h, COL[c])).join('');
    }
    const z = k - 27;
    if (z === 4) {
      return `<rect x="15" y="17" width="30" height="46" rx="3" fill="none" stroke="${BLUE}" stroke-width="3"/>`;
    }
    const ch = ['東', '南', '西', '北', '', '發', '中'][z];
    const c = z === 5 ? GREEN : z === 6 ? RED : NAVY;
    return text(30, 41, 34, c, ch, 900);
  }

  // 牌の表。k は種類（0〜33）
  function face(k) {
    return `<svg class="mj-svg" viewBox="0 0 60 80" aria-hidden="true">`
      + `<rect x="1" y="1" width="58" height="78" rx="7" fill="#FFFDF6" stroke="#D9CFB4" stroke-width="1.5"/>`
      + faceInner(k)
      + `</svg>`;
  }

  // 牌の裏
  function back() {
    return `<svg class="mj-svg" viewBox="0 0 60 80" aria-hidden="true">`
      + `<rect x="1" y="1" width="58" height="78" rx="7" fill="#E9A040" stroke="#B9751F" stroke-width="1.5"/>`
      + `<rect x="8" y="8" width="44" height="64" rx="4" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="2"/>`
      + `</svg>`;
  }

  root.MahjongArt = { face, back };
})(typeof window !== 'undefined' ? window : globalThis);
