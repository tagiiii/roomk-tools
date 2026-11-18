/* 興味スゴロク — 盤の景色（SVG）とマスの位置。
   どれも決まった文字列と数だけで作る（利用者の入力は入らない）。DOM も Firebase も使わない計算と、
   SVG の文字列を要素にする部分だけ。色は景色の色なので直書き（design-system の変数にしない）。 */

export const SCENE_W = 600;
const DEFAULT_COLS = 5;
const X0 = 90;        // 1列目のマスの中心
const SPAN = 420;     // 1列目から最後の列まで
const Y0 = 100;       // 1段目のマスの中心
const DY = 128;       // 段の間
const TURN = 58;      // 折り返しのふくらみ
const BOTTOM = 96;    // いちばん下の段の下のあき

// 段ごとの景色（草原 → 森 → 水辺 → 夕方の丘）。5段目からはくり返す
const BANDS = ['#DDF0C4', '#CDE7B4', '#CFEAEC', '#EADFF0'];

function rowsOf(total, cols) { return Math.ceil(total / cols); }
function dxOf(cols) { return SPAN / Math.max(1, cols - 1); }

export function sceneHeight(total, cols = DEFAULT_COLS) {
  return Y0 + (rowsOf(total, cols) - 1) * DY + BOTTOM;
}

// マスの幅（盤の幅に対する％）。列が多いときは、となりと重ならない大きさにする
export function squareWidth(cols = DEFAULT_COLS) {
  // 列が少ない盤（3〜4列。人数が多いとき）は、コマが集まっても見やすいようにマスを大きくする
  return Math.min(cols <= 4 ? 16.5 : 14.5, (dxOf(cols) - 8) / 6);
}

// 段の中心の高さ（場面の名前を置くのに使う）
export function rowCenters(total, cols = DEFAULT_COLS) {
  return Array.from({ length: rowsOf(total, cols) }, (_, r) => Y0 + r * DY);
}

// マスの中心（蛇行。偶数段は左→右、奇数段は右→左。段の中ほどを少し持ち上げて道を波うたせる）
export function squarePoints(total, cols = DEFAULT_COLS) {
  const points = [];
  const dx = dxOf(cols);
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / cols);
    const inRow = i % cols;
    const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
    const lift = Math.sin((col / (cols - 1)) * Math.PI) * 13;
    points.push({ x: Math.round(X0 + col * dx), y: Math.round(Y0 + row * DY - lift) });
  }
  return points;
}

// 決まった並びの乱数（同じマス数なら、いつも同じ景色）
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const n = (v) => Math.round(v * 10) / 10;

// 道: マスの中心と折り返しの点を、なめらかな曲線でつなぐ
function roadPath(points, cols) {
  const pts = [];
  points.forEach((p, i) => {
    pts.push(p);
    const next = points[i + 1];
    if (next && Math.floor(i / cols) !== Math.floor((i + 1) / cols)) {
      const right = p.x > SCENE_W / 2;
      pts.push({ x: p.x + (right ? TURN : -TURN), y: (p.y + next.y) / 2 });
    }
  });
  if (pts.length < 2) return '';
  let d = `M${n(pts[0].x)} ${n(pts[0].y)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    d += ` C${n(p1.x + (p2.x - p0.x) / 6)} ${n(p1.y + (p2.y - p0.y) / 6)} ${n(p2.x - (p3.x - p1.x) / 6)} ${n(p2.y - (p3.y - p1.y) / 6)} ${n(p2.x)} ${n(p2.y)}`;
  }
  return d;
}

// ── 景色の部品（x, y は足もとの中心） ──
const at = (x, y, s, body) => `<g transform="translate(${n(x)} ${n(y)}) scale(${n(s)})">${body}</g>`;

function flower(x, y, s, color) {
  const petals = [[0, -15], [5.5, -11], [3.4, -4.6], [-3.4, -4.6], [-5.5, -11]]
    .map(([px, py]) => `<circle cx="${px}" cy="${py}" r="4.6" fill="${color}"/>`).join('');
  return at(x, y, s, `<path d="M0 0 L0 -9" stroke="#5E9A45" stroke-width="2.2" stroke-linecap="round"/>`
    + `<path d="M0 -3 C5 -5 7 -2 7 0 C3 1 1 0 0 -3 Z" fill="#6FB052"/>${petals}<circle cx="0" cy="-10" r="3.4" fill="#F6D25A"/>`);
}

function bush(x, y, s) {
  return at(x, y, s, `<ellipse cx="0" cy="0" rx="21" ry="4" fill="#3F362D" opacity=".1"/>`
    + `<circle cx="-11" cy="-8" r="10" fill="#6FB052"/><circle cx="10" cy="-8" r="11" fill="#7DBC5E"/><circle cx="0" cy="-15" r="12" fill="#8AC76A"/>`
    + `<circle cx="-4" cy="-18" r="2" fill="#F08A7C"/><circle cx="8" cy="-11" r="2" fill="#F08A7C"/>`);
}

function tree(x, y, s) {
  return at(x, y, s, `<ellipse cx="0" cy="0" rx="16" ry="4" fill="#3F362D" opacity=".12"/>`
    + `<rect x="-3.5" y="-16" width="7" height="16" rx="3" fill="#9A6B43"/>`
    + `<circle cx="-9" cy="-24" r="11" fill="#5FA34E"/><circle cx="9" cy="-24" r="11" fill="#69AE55"/><circle cx="0" cy="-33" r="13" fill="#79BC62"/>`
    + `<path d="M-6 -38 C-3 -42 3 -42 6 -39" stroke="#A5D98D" stroke-width="2.4" fill="none" stroke-linecap="round"/>`);
}

function pine(x, y, s) {
  return at(x, y, s, `<ellipse cx="0" cy="0" rx="14" ry="3.6" fill="#3F362D" opacity=".12"/>`
    + `<rect x="-3" y="-10" width="6" height="10" rx="2.5" fill="#8C5F3B"/>`
    + `<path d="M0 -44 L13 -24 L-13 -24 Z" fill="#4E9A5B"/><path d="M0 -34 L16 -8 L-16 -8 Z" fill="#43894F"/>`);
}

function mushroom(x, y, s) {
  return at(x, y, s, `<rect x="-4" y="-10" width="8" height="10" rx="3.5" fill="#FBF3E2"/>`
    + `<path d="M-13 -9 C-13 -22 13 -22 13 -9 Z" fill="#F2A65A"/>`
    + `<circle cx="-5" cy="-14" r="2.2" fill="#FFF7E8"/><circle cx="4" cy="-16" r="2.6" fill="#FFF7E8"/><circle cx="8" cy="-11" r="1.6" fill="#FFF7E8"/>`);
}

function pond(x, y, s) {
  return at(x, y, s, `<ellipse cx="0" cy="-9" rx="30" ry="12" fill="#8FCBE0"/><ellipse cx="0" cy="-10" rx="25" ry="8.5" fill="#A9DBEC"/>`
    + `<path d="M-14 -11 C-10 -14 -5 -14 -1 -11" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>`
    + `<ellipse cx="11" cy="-8" rx="6" ry="3.4" fill="#6FB052"/><circle cx="12" cy="-10" r="2.2" fill="#F7B5C8"/>`);
}

function reeds(x, y, s) {
  return at(x, y, s, `<path d="M-6 0 L-7 -22 M0 0 L0 -28 M6 0 L8 -20" stroke="#5E9A45" stroke-width="2.4" stroke-linecap="round"/>`
    + `<rect x="-9.5" y="-30" width="5" height="11" rx="2.5" fill="#9A6B43"/><rect x="-2.5" y="-36" width="5" height="11" rx="2.5" fill="#9A6B43"/>`);
}

function boat(x, y, s) {
  return at(x, y, s, `<ellipse cx="0" cy="-3" rx="24" ry="6" fill="#A9DBEC"/>`
    + `<path d="M-14 -10 L14 -10 L9 -2 L-9 -2 Z" fill="#E08E45"/><path d="M0 -10 L0 -34" stroke="#8C5F3B" stroke-width="2.2" stroke-linecap="round"/>`
    + `<path d="M2 -33 L15 -14 L2 -14 Z" fill="#FFF7E8"/>`);
}

function hill(x, y, s) {
  return at(x, y, s, `<path d="M-26 0 C-18 -26 -6 -30 0 -30 C8 -30 20 -24 26 0 Z" fill="#B9A3D6"/>`
    + `<path d="M-9 -24 C-5 -30 5 -30 9 -24 C5 -21 -4 -21 -9 -24 Z" fill="#FFFFFF" opacity=".85"/>`);
}

function balloon(x, y, s, color) {
  return at(x, y, s, `<path d="M-5 -12 L-3 -5 M5 -12 L3 -5" stroke="#8C5F3B" stroke-width="1.4"/>`
    + `<rect x="-4" y="-6" width="8" height="6" rx="1.5" fill="#B5814F"/>`
    + `<path d="M0 -40 C13 -40 16 -28 12 -20 C9 -15 5 -13 5 -12 L-5 -12 C-5 -13 -9 -15 -12 -20 C-16 -28 -13 -40 0 -40 Z" fill="${color}"/>`
    + `<path d="M0 -40 C5 -34 5 -20 2 -12 L-2 -12 C-5 -20 -5 -34 0 -40 Z" fill="#FFFFFF" opacity=".45"/>`);
}

function star(x, y, s) {
  return at(x, y, s, `<path d="M0 -9 L2.6 -2.8 L9 -2.6 L4 1.6 L5.6 8 L0 4.4 L-5.6 8 L-4 1.6 L-9 -2.6 L-2.6 -2.8 Z" fill="#F6D25A"/>`);
}

function cloud(x, y, s) {
  return at(x, y, s, `<circle cx="-13" cy="0" r="9" fill="#fff"/><circle cx="0" cy="-5" r="12" fill="#fff"/><circle cx="14" cy="0" r="10" fill="#fff"/><rect x="-14" y="-1" width="29" height="10" rx="5" fill="#fff"/>`);
}

function sun(x, y, s) {
  const rays = Array.from({ length: 8 }, (_, i) => `<path d="M0 -17 L0 -23" stroke="#F4B942" stroke-width="3" stroke-linecap="round" transform="rotate(${i * 45})"/>`).join('');
  return at(x, y, s, `${rays}<circle cx="0" cy="0" r="12" fill="#F9CF58"/>`);
}

function butterfly(x, y, s, color) {
  return at(x, y, s, `<path d="M0 0 C-9 -10 -13 -2 -9 3 C-6 6 -2 4 0 0 Z" fill="${color}"/><path d="M0 0 C9 -10 13 -2 9 3 C6 6 2 4 0 0 Z" fill="${color}"/>`
    + `<path d="M0 -3 L0 4" stroke="#6A4F35" stroke-width="1.6" stroke-linecap="round"/>`);
}

const PETALS = ['#F7A1B5', '#F9C663', '#C7A5E8', '#FF9D7A', '#FFFFFF'];

// 段の種類ごとに、置けるものを選ぶ
function pickDecor(kind, rnd, x, y) {
  const s = 0.82 + rnd() * 0.24;
  const r = rnd();
  if (kind === 0) {
    if (r < 0.5) return flower(x, y, s + 0.1, PETALS[Math.floor(rnd() * PETALS.length)]);
    if (r < 0.8) return bush(x, y, s * 0.9);
    return butterfly(x, y - 12, s, PETALS[Math.floor(rnd() * 3)]);
  }
  if (kind === 1) {
    if (r < 0.4) return tree(x, y, s * 0.9);
    if (r < 0.7) return pine(x, y, s * 0.9);
    return mushroom(x, y, s);
  }
  if (kind === 2) {
    if (r < 0.4) return pond(x, y, s * 0.95);
    if (r < 0.65) return reeds(x, y, s * 0.9);
    if (r < 0.85) return boat(x, y, s * 0.85);
    return flower(x, y, s, '#FFFFFF');
  }
  if (r < 0.35) return hill(x, y, s);
  if (r < 0.6) return balloon(x, y, s * 0.85, PETALS[Math.floor(rnd() * 4)]);
  if (r < 0.85) return star(x, y - 10, s);
  return pine(x, y, s * 0.85);
}

export function sceneSvg(total, cols = DEFAULT_COLS) {
  const rows = rowsOf(total, cols);
  const h = sceneHeight(total, cols);
  const points = squarePoints(total, cols);
  const rnd = seeded(total * 7919 + cols * 31 + 13);
  const road = roadPath(points, cols);

  // 地面: 段ごとの色をなめらかにつなぐ
  const stops = [];
  for (let r = 0; r < rows; r++) {
    const off = rows === 1 ? 0.5 : (Y0 + r * DY) / h;
    stops.push(`<stop offset="${n(off)}" stop-color="${BANDS[r % BANDS.length]}"/>`);
  }

  const decor = [];
  // 空（1段目の上）
  decor.push(sun(548, 34, 1));
  decor.push(cloud(150, 30, 0.95), cloud(372, 24, 0.75));
  // 段のあいだと、いちばん下
  // 置く場所は、列と列のあいだ
  const dx = dxOf(cols);
  const slots = Array.from({ length: cols - 1 }, (_, i) => X0 + dx * (i + 0.5));
  const lastSlot = slots.length - 1;
  for (let r = 0; r < rows; r++) {
    const kind = r % BANDS.length;
    const baseY = Y0 + r * DY + 78;
    const last = r === rows - 1;
    // 折り返しのある側（偶数段は右）は道が通るので、そちらの端には置かない
    const turnRight = r % 2 === 0;
    slots.forEach((x, i) => {
      if (!last && ((turnRight && i === lastSlot) || (!turnRight && i === 0)) && rnd() < 0.6) return;
      if (rnd() < 0.18) return;
      decor.push(pickDecor(kind, rnd, x + (rnd() - 0.5) * Math.min(26, dx / 4), baseY + (rnd() - 0.5) * 10));
    });
    // 折り返しのない側の端
    if (!last) decor.push(pickDecor(kind, rnd, turnRight ? 34 : SCENE_W - 34, baseY - 6));
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE_W} ${h}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
    + `<defs><linearGradient id="ksGround" x1="0" y1="0" x2="0" y2="1">${stops.join('')}</linearGradient></defs>`
    + `<rect x="0" y="0" width="${SCENE_W}" height="${h}" fill="url(#ksGround)"/>`
    + `<rect x="0" y="0" width="${SCENE_W}" height="58" fill="#CFEBF5" opacity=".7"/>`
    + `<path d="M0 58 C100 44 200 66 300 54 C400 42 500 64 600 52 L600 80 L0 80 Z" fill="${BANDS[0]}"/>`
    + `<path d="${road}" fill="none" stroke="#D9BE8A" stroke-width="50" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${road}" fill="none" stroke="#F3E3BE" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${road}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 13" opacity=".9"/>`
    + decor.join('')
    + `</svg>`;
}

// 景色の要素（innerHTML を使わずに作る）
export function sceneElement(total, cols = DEFAULT_COLS) {
  const doc = new DOMParser().parseFromString(sceneSvg(total, cols), 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  svg.setAttribute('class', 'ks-board__scene');
  return svg;
}
