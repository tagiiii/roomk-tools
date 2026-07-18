#!/usr/bin/env node
// =============================================================================
// ピタハメ 問題生成ツール（開発用・デプロイ対象外）
//
// ポリオミノ・パズル「ピタハメ」の問題カタログを、生成→自動フィルタ→完全探索
// による解析→選別 の順に作成する単体ツール。外部依存なし（Node 18+ / ESM）。
// 仕様正本は docs/pitahame-design-v1.md の §4（パズル仕様）・§5（カタログと
// 制作パイプライン）。
//
// 難易度スコアの主軸は effort（探索順ランダム化 9 トライアルによる「最初の
// 1解に到達するまでの探索ノード数」の中央値）。全解を数え切る nodes は解が
// 多い問題ほど膨らみ「1解を見つける難しさ」と逆転しうるため参考値として保存。
//
// 使い方:
//   # 全パイプライン実行（生成→フィルタ→解析→選別→JSON出力）＋ファネル統計表示
//   node scripts/pitahame-gen.mjs build --seed 1 --out scripts/pitahame-catalog.json
//     追加オプション: --attempts <n>（両難易度共通の試行回数）
//                     --easy-attempts <n> / --hard-attempts <n>（個別指定）
//
//   # 指定問題を ASCII 描画（シルエット＋基準解を A/B/C/D で表示）
//   node scripts/pitahame-gen.mjs preview --file scripts/pitahame-catalog.json --id E01
//
//   # 全問題を再検証（充填・重なり・制約充足・解数≥1）して OK/NG を報告
//   node scripts/pitahame-gen.mjs verify --file scripts/pitahame-catalog.json
//
// 座標規約（設計書 §5「座標規約」準拠）:
//   - セルは [x, y]（x=列, y=行, y は下方向）
//   - シルエット・ピースは minX=minY=0 へ正規化
//   - r は「時計回り 90° 回転の回数」(0-3)。回転式 (x,y) -> (-y, x)、回転後に再正規化
//   - sol の x,y は正規化後ピースの左上オフセット
// =============================================================================

import fs from 'node:fs';

// -----------------------------------------------------------------------------
// 決定的 PRNG（mulberry32）— --seed で再現可能にする
// -----------------------------------------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 文字列 → 32bit ハッシュ（FNV-1a）。effort トライアルの seed を問題自身から
// 決定的に導出するために使う（ビルド全体の再現性を維持）
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// -----------------------------------------------------------------------------
// ピース定義（r=0 の正規化形。設計書で確定）
// -----------------------------------------------------------------------------
const PIECE_DEFS = {
  // 3マス
  I3: [[0, 0], [1, 0], [2, 0]],
  L3: [[0, 0], [1, 0], [0, 1]],
  // 4マス
  O4: [[0, 0], [1, 0], [0, 1], [1, 1]],
  I4: [[0, 0], [1, 0], [2, 0], [3, 0]],
  T4: [[0, 0], [1, 0], [2, 0], [1, 1]],
  L4: [[0, 0], [0, 1], [0, 2], [1, 2]],
  J4: [[1, 0], [1, 1], [1, 2], [0, 2]],
  S4: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z4: [[0, 0], [1, 0], [1, 1], [2, 1]],
  // 5マス
  P5: [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]],
  L5: [[0, 0], [0, 1], [0, 2], [0, 3], [1, 3]],
  Y5: [[0, 1], [1, 0], [1, 1], [1, 2], [1, 3]],
  T5: [[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]],
};

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// -----------------------------------------------------------------------------
// 幾何ユーティリティ
// -----------------------------------------------------------------------------
// 読み順（上→下、左→右）の比較関数。キー化・シルエット走査で共通利用
function cmpCells(a, b) {
  return a[1] - b[1] || a[0] - b[0];
}

// minX=minY=0 へ平行移動し、読み順にソートして返す
function normalize(cells) {
  let minX = Infinity, minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const out = cells.map(([x, y]) => [x - minX, y - minY]);
  out.sort(cmpCells);
  return out;
}

// 時計回り 90° 回転（画面座標 y 下向き）: (x,y) -> (-y, x)
function rotateCW(cells) {
  return cells.map(([x, y]) => [-y, x]);
}

function keyOf(cells) {
  return cells.map(([x, y]) => x + ',' + y).join(';');
}

function bbox(cells) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// distinct な向きだけを列挙（回転対称の重複を除く）。各向きに最小の r を保持する
function orientationsOf(base) {
  const res = [];
  const seen = new Set();
  let cur = base;
  for (let r = 0; r < 4; r++) {
    const n = normalize(cur);
    const k = keyOf(n);
    if (!seen.has(k)) {
      seen.add(k);
      const bb = bbox(n);
      res.push({ r, cells: n, w: bb.w, h: bb.h });
    }
    cur = rotateCW(n);
  }
  return res;
}

// ピーステーブル構築
const PIECES = {};
for (const [name, base] of Object.entries(PIECE_DEFS)) {
  const orients = orientationsOf(base);
  const orientByR = new Map(orients.map((o) => [o.r, o.cells]));
  PIECES[name] = { name, base, size: base.length, orients, orientByR };
}
const PIECE_NAMES = Object.keys(PIECE_DEFS);

// -----------------------------------------------------------------------------
// 難易度ごとのピース組合せ（同種重複なし・合計マス数レンジ内）を事前列挙
// -----------------------------------------------------------------------------
function buildCombos(k, minSum, maxSum) {
  const res = [];
  const rec = (start, cur, sum) => {
    if (cur.length === k) {
      if (sum >= minSum && sum <= maxSum) res.push(cur.slice());
      return;
    }
    for (let i = start; i < PIECE_NAMES.length; i++) {
      cur.push(PIECE_NAMES[i]);
      rec(i + 1, cur, sum + PIECES[PIECE_NAMES[i]].size);
      cur.pop();
    }
  };
  rec(0, [], 0);
  return res;
}
const EASY_COMBOS = buildCombos(3, 9, 12);
const HARD_COMBOS = buildCombos(4, 13, 17);

// -----------------------------------------------------------------------------
// 生成: ピースをランダムな向き・位置で連結に合成し、構成的に必ず解のある形を作る
// -----------------------------------------------------------------------------
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 既存シルエットに辺で接する位置へ 1 ピース置く。置けたら true
function tryPlace(rng, occupied, piece, index, cfg, placements) {
  // 既存シルエットに直交隣接する空セル（フロンティア）を集める
  const frontier = [];
  const seenF = new Set();
  for (const key of occupied.keys()) {
    const ci = key.indexOf(',');
    const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    for (const [dx, dy] of DIRS) {
      const nk = (x + dx) + ',' + (y + dy);
      if (!occupied.has(nk) && !seenF.has(nk)) {
        seenF.add(nk);
        frontier.push([x + dx, y + dy]);
      }
    }
  }
  const TRIES = 80;
  for (let t = 0; t < TRIES; t++) {
    const o = piece.orients[Math.floor(rng() * piece.orients.length)];
    const f = frontier[Math.floor(rng() * frontier.length)];
    const pc = o.cells[Math.floor(rng() * o.cells.length)];
    // ピースのあるセル pc をフロンティアセル f に重ねる → f を覆い、既存へ辺接続
    const ox = f[0] - pc[0], oy = f[1] - pc[1];
    let overlap = false;
    const newCells = [];
    for (const [x, y] of o.cells) {
      const cx = x + ox, cy = y + oy, ck = cx + ',' + cy;
      if (occupied.has(ck)) { overlap = true; break; }
      newCells.push([cx, cy, ck]);
    }
    if (overlap) continue;
    // バウンディングボックス超過を早期に弾く
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const key of occupied.keys()) {
      const ci = key.indexOf(',');
      const x = +key.slice(0, ci), y = +key.slice(ci + 1);
      if (x < minX) minX = x; if (y < minY) minY = y;
      if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    }
    for (const [cx, cy] of newCells) {
      if (cx < minX) minX = cx; if (cy < minY) minY = cy;
      if (cx > maxX) maxX = cx; if (cy > maxY) maxY = cy;
    }
    const w = maxX - minX + 1, h = maxY - minY + 1;
    if (Math.max(w, h) > cfg.maxLong || Math.min(w, h) > cfg.maxShort) continue;
    for (const [, , ck] of newCells) occupied.set(ck, index);
    placements.push({ name: piece.name, r: o.r, ox, oy });
    return true;
  }
  return false;
}

function genPuzzle(rng, cfg) {
  const combo = cfg.combos[Math.floor(rng() * cfg.combos.length)];
  const names = shuffle(combo, rng); // トレイ並び順もランダムに固定
  const occupied = new Map(); // cellKey -> pieceIndex
  const placements = [];
  // 1 個目を原点に置く
  const first = PIECES[names[0]];
  const o0 = first.orients[Math.floor(rng() * first.orients.length)];
  for (const [x, y] of o0.cells) occupied.set(x + ',' + y, 0);
  placements.push({ name: names[0], r: o0.r, ox: 0, oy: 0 });
  // 2 個目以降を辺接続で置く
  for (let i = 1; i < names.length; i++) {
    if (!tryPlace(rng, occupied, PIECES[names[i]], i, cfg, placements)) return null;
  }
  // シルエット確定＆正規化
  const cells = [];
  for (const key of occupied.keys()) {
    const ci = key.indexOf(',');
    cells.push([+key.slice(0, ci), +key.slice(ci + 1)]);
  }
  const bb = bbox(cells);
  if (!(Math.max(bb.w, bb.h) <= cfg.maxLong && Math.min(bb.w, bb.h) <= cfg.maxShort)) return null;
  const sx = bb.minX, sy = bb.minY;
  const normCells = cells.map(([x, y]) => [x - sx, y - sy]);
  normCells.sort(cmpCells);
  const sol = placements.map((pl, idx) => ({ p: idx, x: pl.ox - sx, y: pl.oy - sy, r: pl.r }));
  return { w: bb.w, h: bb.h, cells: normCells, pieces: names, sol };
}

// -----------------------------------------------------------------------------
// フィルタ群（設計書 §5 の基準。build ではこの順に適用しファネル統計を取る）
// -----------------------------------------------------------------------------
function silhouetteSet(p) {
  return new Set(p.cells.map(([x, y]) => x + ',' + y));
}

// 完全な長方形（マス数 = w×h）
function isRectangle(p) {
  return p.cells.length === p.w * p.h;
}

// 縦横比: 長辺÷短辺 > 2
function aspectBad(p) {
  const long = Math.max(p.w, p.h), short = Math.min(p.w, p.h);
  return long > 2 * short;
}

// 穴: バウンディングボックス内の空セルで外周（bbox 外）に到達できない領域があるか
function hasHole(p) {
  const set = silhouetteSet(p);
  const { w, h } = p;
  const inSil = (x, y) => set.has(x + ',' + y);
  const inBounds = (x, y) => x >= -1 && x <= w && y >= -1 && y <= h;
  const visited = new Set(['-1,-1']);
  const stack = [[-1, -1]]; // bbox を 1 マス広げた外側から空セルを塗る
  while (stack.length) {
    const [x, y] = stack.pop();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const nk = nx + ',' + ny;
      if (visited.has(nk) || inSil(nx, ny)) continue;
      visited.add(nk);
      stack.push([nx, ny]);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inSil(x, y) && !visited.has(x + ',' + y)) return true; // 外周に到達できない空セル=穴
    }
  }
  return false;
}

// 突起マス: 直交隣接するシルエットセルが 1 個だけのセル数
function protrusionCount(p) {
  const set = silhouetteSet(p);
  let count = 0;
  for (const [x, y] of p.cells) {
    let n = 0;
    for (const [dx, dy] of DIRS) if (set.has((x + dx) + ',' + (y + dy))) n++;
    if (n === 1) count++;
  }
  return count;
}

// 基準解から cellKey -> pieceIndex のマップを作る
function ownerMap(p) {
  const owner = new Map();
  for (const s of p.sol) {
    const cells = PIECES[p.pieces[s.p]].orientByR.get(s.r);
    for (const [cx, cy] of cells) owner.set((cx + s.x) + ',' + (cy + s.y), s.p);
  }
  return owner;
}

// 基準解で各ピースが他ピースと共有する辺数の最小値
function minSharedEdges(p) {
  const owner = ownerMap(p);
  const shared = new Array(p.pieces.length).fill(0);
  for (const [key, pi] of owner) {
    const ci = key.indexOf(',');
    const x = +key.slice(0, ci), y = +key.slice(ci + 1);
    for (const [dx, dy] of DIRS) {
      const nk = (x + dx) + ',' + (y + dy);
      const nb = owner.get(nk);
      if (nb !== undefined && nb !== pi) shared[pi]++;
    }
  }
  return Math.min(...shared);
}

// 各ピースについて「シルエット内に単独で置ける（向き×位置）」の数
function singlePlacementCounts(p) {
  const set = silhouetteSet(p);
  return p.pieces.map((name) => {
    let count = 0;
    for (const o of PIECES[name].orients) {
      for (let oy = 0; oy <= p.h - o.h; oy++) {
        for (let ox = 0; ox <= p.w - o.w; ox++) {
          let ok = true;
          for (const [x, y] of o.cells) {
            if (!set.has((x + ox) + ',' + (y + oy))) { ok = false; break; }
          }
          if (ok) count++;
        }
      }
    }
    return count;
  });
}

// 重複除外用の正準ハッシュ（平行移動＋全体 90° 回転 4 通り。鏡映は同一視しない）
function canonSilhouette(cells) {
  let best = null;
  let cur = cells.map((c) => c.slice());
  for (let r = 0; r < 4; r++) {
    const n = normalize(cur);
    const k = keyOf(n);
    if (best === null || k < best) best = k;
    cur = rotateCW(n);
  }
  return best;
}
function dedupKey(p) {
  return canonSilhouette(p.cells) + '|' + [...p.pieces].sort().join(',');
}

// -----------------------------------------------------------------------------
// effort: 「最初の1解に到達するまでの探索ノード数」
//   探索順（ピースの試行順・向きの試行順）をランダム化した 9 トライアルの中央値。
//   全解を数え切る nodes は解が多い問題ほど膨らみ「1解を見つける難しさ」と逆転
//   しうるため、難易度スコアの主軸はこちらを使う（Codex レビュー指摘対応）。
//   トライアル rng の seed は問題の dedupKey ハッシュから導出 → ビルド再現性を維持
// -----------------------------------------------------------------------------
const EFFORT_TRIALS = 9;

function firstSolutionNodes(p, rng) {
  const set = silhouetteSet(p);
  const total = p.cells.length;
  const order = p.cells.slice().sort(cmpCells);
  const orients = p.pieces.map((name) => PIECES[name].orients);
  const indices = p.pieces.map((_, i) => i);
  const used = new Array(p.pieces.length).fill(false);
  const filled = new Set();
  let nodes = 0;

  const firstEmpty = () => {
    for (const [x, y] of order) {
      const k = x + ',' + y;
      if (!filled.has(k)) return [x, y];
    }
    return null;
  };

  const rec = () => {
    nodes++;
    if (filled.size === total) return true; // 1解見つけたら打ち切り
    const [cx, cy] = firstEmpty();
    for (const i of shuffle(indices, rng)) { // ピースの試行順をシャッフル
      if (used[i]) continue;
      for (const o of shuffle(orients[i], rng)) { // 向きの試行順をシャッフル
        for (const [px, py] of o.cells) {
          const ox = cx - px, oy = cy - py;
          let ok = true;
          const place = [];
          for (const [x, y] of o.cells) {
            const k = (x + ox) + ',' + (y + oy);
            if (!set.has(k) || filled.has(k)) { ok = false; break; }
            place.push(k);
          }
          if (!ok) continue;
          for (const k of place) filled.add(k);
          used[i] = true;
          if (rec()) return true;
          used[i] = false;
          for (const k of place) filled.delete(k);
        }
      }
    }
    return false;
  };
  const found = rec();
  if (!found) throw new Error('effort計測で解が見つからない（バグ）: ' + JSON.stringify(p.pieces));
  return nodes;
}

function effortOf(p) {
  const seedBase = hashStr(dedupKey(p));
  const trials = [];
  for (let t = 0; t < EFFORT_TRIALS; t++) {
    const rng = mulberry32((seedBase + Math.imul(t, 0x9e3779b9)) >>> 0);
    trials.push(firstSolutionNodes(p, rng));
  }
  trials.sort((a, b) => a - b);
  return trials[(EFFORT_TRIALS - 1) / 2]; // 9トライアルの中央値
}

// -----------------------------------------------------------------------------
// 解析: バックトラッキング完全探索で解数と探索ノード数を求める
// -----------------------------------------------------------------------------
function analyze(p) {
  const set = silhouetteSet(p);
  const total = p.cells.length;
  const order = p.cells.slice().sort(cmpCells); // 読み順（最小座標の空セル選択用）
  const orients = p.pieces.map((name) => PIECES[name].orients);
  const used = new Array(p.pieces.length).fill(false);
  const filled = new Set();
  let solutions = 0, nodes = 0;

  const firstEmpty = () => {
    for (const [x, y] of order) {
      const k = x + ',' + y;
      if (!filled.has(k)) return [x, y];
    }
    return null;
  };

  const rec = () => {
    nodes++; // 探索ノード数 = 再帰呼び出し回数（難しさの代理指標）
    if (filled.size === total) { solutions++; return; }
    const [cx, cy] = firstEmpty();
    for (let i = 0; i < p.pieces.length; i++) {
      if (used[i]) continue;
      for (const o of orients[i]) {
        // ピースの各セルを最小空セルに合わせ、そのセルを覆う配置だけを試す（順列重複回避）
        for (const [px, py] of o.cells) {
          const ox = cx - px, oy = cy - py;
          let ok = true;
          const place = [];
          for (const [x, y] of o.cells) {
            const k = (x + ox) + ',' + (y + oy);
            if (!set.has(k) || filled.has(k)) { ok = false; break; }
            place.push(k);
          }
          if (!ok) continue;
          for (const k of place) filled.add(k);
          used[i] = true;
          rec();
          used[i] = false;
          for (const k of place) filled.delete(k);
        }
      }
    }
  };
  rec();

  return {
    solutions,
    nodes,
    effort: effortOf(p),
    singlePlacements: singlePlacementCounts(p),
    protrusion: protrusionCount(p),
    perimeter: perimeter(p),
  };
}

// シルエット周囲長（各セルの非シルエット隣接辺の合計）
function perimeter(p) {
  const set = silhouetteSet(p);
  let per = 0;
  for (const [x, y] of p.cells) {
    for (const [dx, dy] of DIRS) if (!set.has((x + dx) + ',' + (y + dy))) per++;
  }
  return per;
}

// -----------------------------------------------------------------------------
// 難易度スコア（effort =「1解到達までの探索量」を主軸、単独配置数の少なさを加点。
// 全解探索の nodes は解が多いほど膨らみ体感難易度と逆転しうるため主軸にしない）
// -----------------------------------------------------------------------------
function score(p) {
  const totalSingle = p.single.reduce((a, b) => a + b, 0);
  return p.metrics.effort * 100 - totalSingle;
}

// -----------------------------------------------------------------------------
// 生成＋フィルタ＋解析（1 難易度分）。ファネル統計と通過候補を返す
// -----------------------------------------------------------------------------
function generateBucket(rng, cfg, attempts) {
  const funnel = {
    attempts: 0, synthesized: 0, afterRect: 0, afterAspect: 0, afterHoles: 0,
    afterProtrusion: 0, afterSharedEdges: 0, afterSinglePlace: 0, afterDedup: 0,
  };
  const seen = new Set();
  const survivors = [];
  for (let a = 0; a < attempts; a++) {
    funnel.attempts++;
    const p = genPuzzle(rng, cfg);
    if (!p) continue;
    funnel.synthesized++;
    if (isRectangle(p)) continue; funnel.afterRect++;
    if (aspectBad(p)) continue; funnel.afterAspect++;
    if (hasHole(p)) continue; funnel.afterHoles++;
    if (protrusionCount(p) >= 2) continue; funnel.afterProtrusion++;
    if (minSharedEdges(p) < 2) continue; funnel.afterSharedEdges++;
    p.single = singlePlacementCounts(p);
    if (p.single.filter((c) => c === 1).length >= 2) continue; funnel.afterSinglePlace++;
    const dk = dedupKey(p);
    if (seen.has(dk)) continue; seen.add(dk); funnel.afterDedup++;
    const metrics = analyze(p);
    // 構成的生成なので解数 0 はあり得ない。出たら生成/解析のバグ
    if (metrics.solutions < 1) {
      throw new Error('解数0を検出（バグ）: ' + JSON.stringify({ pieces: p.pieces, cells: p.cells }));
    }
    p.metrics = metrics;
    survivors.push(p);
  }
  return { funnel, survivors };
}

// -----------------------------------------------------------------------------
// 選別: スコア昇順プールから難易度帯を切り出し、同一ピース組合せ 3 問以内の
//        多様性制約を守りつつ均等に散らして選ぶ
//   easy: 15%〜75% の帯（下位15%は数秒で終わるチュートリアル級として捨てる）
//   hard: 40%〜100% の帯
// -----------------------------------------------------------------------------
function selectBucket(survivors, target, bucket) {
  const pool = survivors.map((p) => ({ p, s: score(p) })).sort((a, b) => a.s - b.s);
  const N = pool.length;
  if (N === 0) return [];
  const band = bucket === 'easy'
    ? pool.slice(Math.floor(N * 0.15), Math.ceil(N * 0.75))
    : pool.slice(Math.floor(N * 0.40));
  if (band.length === 0) return [];

  const msKey = (e) => [...e.p.pieces].sort().join(',');
  const taken = new Array(band.length).fill(false);
  const msCount = {};
  const selected = [];
  const canTake = (i) => (msCount[msKey(band[i])] || 0) < 3; // 多様性: 同一組合せ 3 問以内
  const takeIdx = (i) => {
    taken[i] = true;
    const k = msKey(band[i]);
    msCount[k] = (msCount[k] || 0) + 1;
    selected.push(band[i]);
  };
  const findNearest = (anchor) => {
    for (let r = 0; r < band.length; r++) {
      const a = anchor + r, b = anchor - r;
      if (a < band.length && !taken[a] && canTake(a)) return a;
      if (b >= 0 && !taken[b] && canTake(b)) return b;
    }
    return -1;
  };

  // 1) 帯全体に均等なアンカーを置き、近傍から多様性 OK の候補を拾う（難易度を散らす）
  if (band.length > target) {
    for (let k = 0; k < target; k++) {
      const anchor = target > 1 ? Math.round((k * (band.length - 1)) / (target - 1)) : 0;
      const idx = findNearest(anchor);
      if (idx >= 0) takeIdx(idx);
    }
  }
  // 2) 不足分は帯を順に貪欲補充
  for (let i = 0; i < band.length && selected.length < target; i++) {
    if (!taken[i] && canTake(i)) takeIdx(i);
  }

  selected.sort((a, b) => a.s - b.s); // ID は易→難の順に振る
  return selected.map((e) => e.p);
}

// -----------------------------------------------------------------------------
// カタログ入出力
// -----------------------------------------------------------------------------
function pad2(n) {
  return String(n).padStart(2, '0');
}

function toEntry(p, id) {
  return {
    id, w: p.w, h: p.h, cells: p.cells, pieces: p.pieces, sol: p.sol,
    metrics: p.metrics,
  };
}

// 1 問 1 行の読みやすい JSON を出力
function serializeCatalog(cat) {
  const lines = ['{'];
  lines.push('  "formatVersion": ' + cat.formatVersion + ',');
  for (const bucket of ['easy', 'hard']) {
    const arr = cat[bucket];
    lines.push('  "' + bucket + '": [');
    arr.forEach((e, i) => {
      const comma = i < arr.length - 1 ? ',' : '';
      lines.push(
        '    {"id":"' + e.id + '","w":' + e.w + ',"h":' + e.h +
        ',"cells":' + JSON.stringify(e.cells) +
        ',"pieces":' + JSON.stringify(e.pieces) +
        ',"sol":' + JSON.stringify(e.sol) +
        ',"metrics":' + JSON.stringify(e.metrics) + '}' + comma,
      );
    });
    lines.push('  ]' + (bucket === 'easy' ? ',' : ''));
  }
  lines.push('}');
  return lines.join('\n') + '\n';
}

// -----------------------------------------------------------------------------
// 統計ヘルパ
// -----------------------------------------------------------------------------
function stats(nums) {
  if (nums.length === 0) return { min: 0, median: 0, max: 0 };
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  return { min: s[0], median, max: s[s.length - 1] };
}

function printFunnel(label, funnel, survivorCount, selectedCount) {
  const rows = [
    ['試行', funnel.attempts],
    ['合成成功', funnel.synthesized],
    ['長方形除外後', funnel.afterRect],
    ['縦横比>2除外後', funnel.afterAspect],
    ['穴除外後', funnel.afterHoles],
    ['突起2以上除外後', funnel.afterProtrusion],
    ['共有辺<2除外後', funnel.afterSharedEdges],
    ['単独配置1が2以上除外後', funnel.afterSinglePlace],
    ['重複除外後(=通過候補)', funnel.afterDedup],
    ['解析通過(survivors)', survivorCount],
    ['選別採用', selectedCount],
  ];
  console.log('\n[' + label + '] ファネル');
  for (const [k, v] of rows) console.log('  ' + k.padEnd(24, ' ') + ' : ' + v);
}

function printDistribution(label, entries) {
  const sol = stats(entries.map((e) => e.metrics.solutions));
  const nodes = stats(entries.map((e) => e.metrics.nodes));
  const effort = stats(entries.map((e) => e.metrics.effort));
  console.log('\n[' + label + '] メトリクス分布 (n=' + entries.length + ')');
  console.log('  解数     min/median/max : ' + sol.min + ' / ' + sol.median + ' / ' + sol.max);
  console.log('  ノード数 min/median/max : ' + nodes.min + ' / ' + nodes.median + ' / ' + nodes.max);
  console.log('  effort   min/median/max : ' + effort.min + ' / ' + effort.median + ' / ' + effort.max);
}

// -----------------------------------------------------------------------------
// コマンド: build
// -----------------------------------------------------------------------------
function cmdBuild(args) {
  const seed = Number(args.seed ?? 1);
  const attemptsEasy = Number(args['easy-attempts'] ?? args.attempts ?? 120000);
  const attemptsHard = Number(args['hard-attempts'] ?? args.attempts ?? 120000);
  const out = args.out ?? 'scripts/pitahame-catalog.json';

  const easyCfg = { k: 3, minSum: 9, maxSum: 12, maxLong: 5, maxShort: 4, combos: EASY_COMBOS };
  const hardCfg = { k: 4, minSum: 13, maxSum: 17, maxLong: 6, maxShort: 5, combos: HARD_COMBOS };

  // easy / hard で独立ストリーム（片方の試行回数を変えても他方が動かない）
  const rngE = mulberry32(seed * 2 + 1);
  const rngH = mulberry32(seed * 2 + 2);

  console.log('build 開始: seed=' + seed +
    ' / easy-attempts=' + attemptsEasy + ' / hard-attempts=' + attemptsHard);
  console.log('組合せ候補数: easy=' + EASY_COMBOS.length + ' / hard=' + HARD_COMBOS.length);

  const E = generateBucket(rngE, easyCfg, attemptsEasy);
  const H = generateBucket(rngH, hardCfg, attemptsHard);

  const easySel = selectBucket(E.survivors, 30, 'easy');
  const hardSel = selectBucket(H.survivors, 30, 'hard');

  const cat = {
    formatVersion: 1,
    easy: easySel.map((p, i) => toEntry(p, 'E' + pad2(i + 1))),
    hard: hardSel.map((p, i) => toEntry(p, 'H' + pad2(i + 1))),
  };
  fs.writeFileSync(out, serializeCatalog(cat));

  printFunnel('easy', E.funnel, E.survivors.length, easySel.length);
  printFunnel('hard', H.funnel, H.survivors.length, hardSel.length);
  printDistribution('easy 採用', cat.easy);
  printDistribution('hard 採用', cat.hard);

  console.log('\n出力: ' + out + '（easy ' + cat.easy.length + '問 / hard ' + cat.hard.length + '問）');
  if (cat.easy.length < 30 || cat.hard.length < 30) {
    console.log('※ 30問に届かない難易度あり。--attempts を増やして再実行を検討');
  }
}

// -----------------------------------------------------------------------------
// コマンド: preview
// -----------------------------------------------------------------------------
function findEntry(cat, id) {
  return [...(cat.easy || []), ...(cat.hard || [])].find((x) => x.id === id);
}

function renderPuzzle(e) {
  const set = new Set(e.cells.map(([x, y]) => x + ',' + y));
  const letters = 'ABCDEFGH';
  console.log('ID: ' + e.id + '  (' + e.w + '×' + e.h + ')');
  console.log('ピース: ' + e.pieces.map((n, i) => letters[i] + '=' + n).join('  '));
  if (e.metrics) {
    console.log('解数: ' + e.metrics.solutions + '  ノード: ' + e.metrics.nodes +
      '  effort: ' + e.metrics.effort +
      '  単独配置: [' + e.metrics.singlePlacements.join(',') + ']');
  }
  console.log('シルエット:');
  for (let y = 0; y < e.h; y++) {
    let row = '';
    for (let x = 0; x < e.w; x++) row += set.has(x + ',' + y) ? '#' : '・';
    console.log('  ' + row);
  }
  const grid = Array.from({ length: e.h }, () => Array(e.w).fill('・'));
  for (const s of e.sol) {
    const cells = PIECES[e.pieces[s.p]].orientByR.get(s.r);
    for (const [cx, cy] of cells) grid[cy + s.y][cx + s.x] = letters[s.p];
  }
  console.log('基準解:');
  for (let y = 0; y < e.h; y++) console.log('  ' + grid[y].join(''));
}

function cmdPreview(args) {
  const file = args.file ?? 'scripts/pitahame-catalog.json';
  const id = args.id;
  if (!id) { console.error('--id を指定してください'); process.exitCode = 1; return; }
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  const e = findEntry(cat, id);
  if (!e) { console.error('問題が見つかりません: ' + id); process.exitCode = 1; return; }
  renderPuzzle(e);
}

// -----------------------------------------------------------------------------
// コマンド: verify
// -----------------------------------------------------------------------------
function verifyPuzzle(e) {
  const reasons = [];
  const set = new Set(e.cells.map(([x, y]) => x + ',' + y));
  const bb = bbox(e.cells);
  if (bb.minX !== 0 || bb.minY !== 0) reasons.push('シルエット未正規化');
  if (bb.w !== e.w || bb.h !== e.h) reasons.push('w/h不一致');

  // 基準解の再構成: 充填・重なり・シルエット外を確認
  const covered = new Map();
  let outOfSil = false;
  for (const s of e.sol) {
    const orient = PIECES[e.pieces[s.p]] && PIECES[e.pieces[s.p]].orientByR.get(s.r);
    if (!orient) { reasons.push('未知のピース/回転: ' + e.pieces[s.p] + ' r' + s.r); continue; }
    for (const [cx, cy] of orient) {
      const k = (cx + s.x) + ',' + (cy + s.y);
      if (!set.has(k)) outOfSil = true;
      covered.set(k, (covered.get(k) || 0) + 1);
    }
  }
  if (outOfSil) reasons.push('ピースがシルエット外');
  let overlap = false;
  for (const c of covered.values()) if (c > 1) overlap = true;
  if (overlap) reasons.push('ピース重なり');
  let missing = 0;
  for (const k of set) if (!covered.has(k)) missing++;
  if (missing > 0) reasons.push('未充填セル ' + missing);

  // 制約充足を再確認
  const p = { w: e.w, h: e.h, cells: e.cells, pieces: e.pieces, sol: e.sol };
  if (isRectangle(p)) reasons.push('長方形');
  if (aspectBad(p)) reasons.push('縦横比>2');
  if (hasHole(p)) reasons.push('穴あり');
  if (protrusionCount(p) >= 2) reasons.push('突起2以上');
  if (minSharedEdges(p) < 2) reasons.push('共有辺<2');
  const single = singlePlacementCounts(p);
  if (single.filter((c) => c === 1).length >= 2) reasons.push('単独配置1が2以上');

  // 解数 ≥ 1 と、保存メトリクスとの整合
  const m = analyze(p);
  if (m.solutions < 1) reasons.push('解数0');
  if (e.metrics && e.metrics.solutions !== m.solutions) {
    reasons.push('解数メトリクス不一致(' + e.metrics.solutions + '≠' + m.solutions + ')');
  }
  if (e.metrics && e.metrics.nodes !== m.nodes) {
    reasons.push('ノード数メトリクス不一致(' + e.metrics.nodes + '≠' + m.nodes + ')');
  }
  // effort はトライアル seed が dedupKey 由来なので再計算で必ず一致するはず
  if (e.metrics && e.metrics.effort !== m.effort) {
    reasons.push('effortメトリクス不一致(' + e.metrics.effort + '≠' + m.effort + ')');
  }
  return { ok: reasons.length === 0, reasons };
}

function cmdVerify(args) {
  const file = args.file ?? 'scripts/pitahame-catalog.json';
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  let ok = 0, ng = 0;
  const problems = [];
  for (const bucket of ['easy', 'hard']) {
    for (const e of cat[bucket] || []) {
      const res = verifyPuzzle(e);
      if (res.ok) ok++;
      else { ng++; problems.push({ id: e.id, reasons: res.reasons }); }
    }
  }
  console.log('verify: OK=' + ok + ' / NG=' + ng + '（合計 ' + (ok + ng) + '問）');
  if (problems.length) {
    console.log('NG 一覧:');
    for (const pr of problems) console.log('  ' + pr.id + ': ' + pr.reasons.join(', '));
  } else {
    console.log('全問 OK');
  }
  process.exitCode = ng > 0 ? 1 : 0;
}

// -----------------------------------------------------------------------------
// CLI エントリ
// -----------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  switch (cmd) {
    case 'build': cmdBuild(args); break;
    case 'preview': cmdPreview(args); break;
    case 'verify': cmdVerify(args); break;
    default:
      console.log('使い方: node scripts/pitahame-gen.mjs <build|preview|verify> [options]');
      console.log('  build   --seed <n> --out <path> [--attempts <n>]');
      console.log('  preview --file <path> --id <ID>');
      console.log('  verify  --file <path>');
      if (cmd) process.exitCode = 1;
  }
}

main();
