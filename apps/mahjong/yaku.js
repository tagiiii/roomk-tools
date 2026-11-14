/* 麻雀 — 役の判定（役ありのルール）。画面・通信・局の流れに触らない。
   ブラウザでは window.MahjongYaku、node では module.exports。
   点数は出さない（オーナー決定 2026-11-14）。役の名前と翻数、ドラの数だけを返す。

   牌の種類 kind: 0〜8 萬子、9〜17 筒子、18〜26 索子、27〜30 東南西北、31〜33 白發中 */
(function (root) {
  'use strict';

  const KINDS = 34;
  const isHonor = (k) => k >= 27;
  const isTerminal = (k) => k < 27 && (k % 9 === 0 || k % 9 === 8);
  const isTermHonor = (k) => isHonor(k) || isTerminal(k);
  const isDragon = (k) => k >= 31;
  const isWind = (k) => k >= 27 && k <= 30;
  const suitIdx = (k) => Math.floor(k / 9);
  const GREEN = new Set([19, 20, 21, 23, 25, 32]); // 2・3・4・6・8索と發
  const WIND_NAME = ['東', '南', '西', '北'];
  const DRAGON_NAME = ['白', '發', '中'];
  const ORPHANS = [0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33];

  // ドラ表示牌の次の牌がドラ（9の次は1、北の次は東、中の次は白）
  function doraOf(k) {
    if (k < 27) return k - (k % 9) + ((k % 9) + 1) % 9;
    if (k <= 30) return 27 + ((k - 27 + 1) % 4);
    return 31 + ((k - 31 + 1) % 3);
  }

  // 手の中の牌（数の配列）を、あたま1つ＋3枚の組に分ける分け方をすべて
  function allDecomps(c, need) {
    const out = [];
    const cc = c.slice();
    const groups = [];
    function melds(i, left) {
      while (i < KINDS && cc[i] === 0) i += 1;
      if (left === 0) { if (i >= KINDS) out.push({ pair: cur.pair, groups: groups.slice() }); return; }
      if (i >= KINDS) return;
      if (cc[i] >= 3) {
        cc[i] -= 3; groups.push({ t: 'set', k: i, open: false });
        melds(i, left - 1);
        groups.pop(); cc[i] += 3;
      }
      if (i < 27 && i % 9 <= 6 && cc[i + 1] && cc[i + 2]) {
        cc[i] -= 1; cc[i + 1] -= 1; cc[i + 2] -= 1; groups.push({ t: 'run', k: i, open: false });
        melds(i, left - 1);
        groups.pop(); cc[i] += 1; cc[i + 1] += 1; cc[i + 2] += 1;
      }
    }
    const cur = { pair: -1 };
    for (let k = 0; k < KINDS; k += 1) {
      if (cc[k] < 2) continue;
      cc[k] -= 2; cur.pair = k;
      melds(0, need);
      cc[k] += 2;
    }
    return out;
  }

  function isKokushi(c) {
    let pair = false;
    for (let k = 0; k < KINDS; k += 1) {
      if (ORPHANS.includes(k)) {
        if (c[k] === 0) return false;
        if (c[k] === 2) { if (pair) return false; pair = true; }
        if (c[k] > 2) return false;
      } else if (c[k]) return false;
    }
    return pair;
  }

  function isPairs(c) {
    let n = 0;
    for (let k = 0; k < KINDS; k += 1) {
      if (c[k] === 2) n += 1;
      else if (c[k] !== 0) return false;
    }
    return n === 7;
  }

  // ctx:
  //   c: 手の中の牌の数（あがり牌をふくむ）、melds: [{ t: 'run'|'set'|'kan', k, open }]（鳴き・カン）
  //   win: あがり牌の種類、tsumo: ツモか、seatWind・roundWind: 27〜30
  //   riichi・double・ippatsu・rinshan・chankan・haitei・houtei・tenhou・chiihou: 真偽
  //   dora: ドラの種類の並び（表示牌から求めたもの。同じ種類が2回あれば2倍）、ura: 裏ドラ（リーチのときだけ数える）
  //   all: 手・鳴き・カンのすべての牌の数（ドラを数える）
  // 返り値: { yaku: [{ name, han }], yakuman: 役満の数, han: 合計（ドラ込み）, dora } か、役がなければ null
  function evaluate(ctx) {
    const menzen = ctx.melds.every((m) => !m.open);
    const cands = [];
    if (!ctx.melds.length && isKokushi(ctx.c)) cands.push({ special: 'kokushi' });
    if (!ctx.melds.length && isPairs(ctx.c)) cands.push({ special: 'pairs' });
    const need = 4 - ctx.melds.length;
    for (const d of allDecomps(ctx.c, need)) {
      // あがり牌がどの組で使われたか（待ちの形）。組ごとに別の候補として見る
      const seen = new Set();
      if (d.pair === ctx.win) cands.push({ d, winIn: -1, wait: 'tanki' });
      d.groups.forEach((g, i) => {
        const key = g.t + g.k;
        if (seen.has(key)) return;
        if (g.t === 'set' && g.k === ctx.win) { seen.add(key); cands.push({ d, winIn: i, wait: 'shanpon' }); }
        if (g.t === 'run' && ctx.win >= g.k && ctx.win <= g.k + 2) {
          seen.add(key + ':' + (ctx.win - g.k));
          let wait = 'ryanmen';
          if (ctx.win === g.k + 1) wait = 'kanchan';
          else if (ctx.win === g.k && g.k % 9 === 6) wait = 'penchan';
          else if (ctx.win === g.k + 2 && g.k % 9 === 0) wait = 'penchan';
          cands.push({ d, winIn: i, wait });
        }
      });
    }
    let best = null;
    for (const cand of cands) {
      const r = scoreCandidate(ctx, cand, menzen);
      if (!r) continue;
      if (!best || r.yakuman > best.yakuman || (r.yakuman === best.yakuman && r.han > best.han)) best = r;
    }
    return best;
  }

  function scoreCandidate(ctx, cand, menzen) {
    const Y = [];
    const add = (name, han) => Y.push({ name, han });
    const YM = [];
    const all = ctx.c.slice();
    ctx.melds.forEach((m) => {
      if (m.t === 'run') { all[m.k] += 1; all[m.k + 1] += 1; all[m.k + 2] += 1; } else all[m.k] += 3;
    });
    const kinds = [];
    for (let k = 0; k < KINDS; k += 1) if (all[k]) kinds.push(k);
    const suits = new Set(kinds.filter((k) => k < 27).map(suitIdx));
    const hasHonor = kinds.some(isHonor);

    // 役満（形によらないもの）
    if (ctx.tenhou) YM.push('天和');
    if (ctx.chiihou) YM.push('地和');
    if (kinds.every(isHonor)) YM.push('字一色');
    if (kinds.every((k) => GREEN.has(k))) YM.push('緑一色');
    if (kinds.every(isTerminal)) YM.push('清老頭');

    if (cand.special === 'kokushi') {
      YM.push('国士無双');
      return finish(ctx, [], YM);
    }

    let groups = [];
    let pair = -1;
    if (cand.special === 'pairs') {
      add('七対子', 2);
    } else {
      pair = cand.d.pair;
      groups = cand.d.groups.map((g, i) => ({ ...g, ron: !ctx.tsumo && i === cand.winIn }));
      ctx.melds.forEach((m) => groups.push({ t: m.t === 'run' ? 'run' : m.t === 'kan' ? 'kan' : 'set', k: m.k, open: m.open, kan: m.t === 'kan' }));
    }
    const triplets = groups.filter((g) => g.t !== 'run');
    const runs = groups.filter((g) => g.t === 'run');
    // 暗刻: 鳴いていない刻子・暗槓。ロンで完成した刻子は数えない
    const concealedTrip = triplets.filter((g) => !g.open && !g.ron).length;
    const kans = groups.filter((g) => g.kan || g.t === 'kan').length;

    if (!cand.special) {
      const dragons = triplets.filter((g) => isDragon(g.k)).length;
      const winds = triplets.filter((g) => isWind(g.k)).length;
      if (concealedTrip === 4) YM.push('四暗刻');
      if (dragons === 3) YM.push('大三元');
      if (winds === 4) YM.push('大四喜');
      else if (winds === 3 && isWind(pair)) YM.push('小四喜');
      if (kans === 4) YM.push('四槓子');
      if (menzen && suits.size === 1 && !hasHonor) {
        const s = [...suits][0] * 9;
        const n = [3, 1, 1, 1, 1, 1, 1, 1, 3].every((need, i) => all[s + i] >= need);
        if (n) YM.push('九蓮宝燈');
      }
    }
    if (YM.length) return finish(ctx, [], YM);

    // ── ふつうの役 ──
    if (ctx.riichi) add(ctx.double ? 'ダブル立直' : '立直', ctx.double ? 2 : 1);
    if (ctx.riichi && ctx.ippatsu) add('一発', 1);
    if (menzen && ctx.tsumo) add('門前清自摸和', 1);
    if (ctx.rinshan) add('嶺上開花', 1);
    if (ctx.chankan) add('槍槓', 1);
    if (ctx.haitei) add('海底摸月', 1);
    if (ctx.houtei) add('河底撈魚', 1);
    if (kinds.every((k) => !isTermHonor(k))) add('断么九', 1);

    if (!cand.special) {
      const yakuhaiPair = isDragon(pair) || pair === ctx.seatWind || pair === ctx.roundWind;
      if (menzen && runs.length === 4 && !yakuhaiPair && cand.wait === 'ryanmen') add('平和', 1);
      if (menzen) {
        const byK = {};
        runs.forEach((g) => { byK[g.k] = (byK[g.k] || 0) + 1; });
        const pk = Object.values(byK).reduce((a, n) => a + Math.floor(n / 2), 0);
        if (pk === 2) add('二盃口', 3);
        else if (pk === 1) add('一盃口', 1);
      }
      triplets.forEach((g) => {
        if (isDragon(g.k)) add('役牌 ' + DRAGON_NAME[g.k - 31], 1);
        if (g.k === ctx.seatWind) add('自風 ' + WIND_NAME[g.k - 27], 1);
        if (g.k === ctx.roundWind) add('場風 ' + WIND_NAME[g.k - 27], 1);
      });
      for (let n = 0; n < 7; n += 1) {
        if ([0, 1, 2].every((s) => runs.some((g) => g.k === s * 9 + n))) { add('三色同順', menzen ? 2 : 1); break; }
      }
      for (let s = 0; s < 3; s += 1) {
        if ([0, 3, 6].every((n) => runs.some((g) => g.k === s * 9 + n))) { add('一気通貫', menzen ? 2 : 1); break; }
      }
      const groupTH = (g) => (g.t === 'run' ? g.k % 9 === 0 || g.k % 9 === 6 : isTermHonor(g.k));
      if (runs.length && groups.every(groupTH) && isTermHonor(pair)) {
        if (hasHonor) add('混全帯么九', menzen ? 2 : 1);
        else add('純全帯么九', menzen ? 3 : 2);
      }
      if (triplets.length === 4) add('対々和', 2);
      if (concealedTrip === 3) add('三暗刻', 2);
      for (let n = 0; n < 9; n += 1) {
        if ([0, 1, 2].every((s) => triplets.some((g) => g.k === s * 9 + n))) { add('三色同刻', 2); break; }
      }
      if (kans === 3) add('三槓子', 2);
      if (triplets.filter((g) => isDragon(g.k)).length === 2 && isDragon(pair)) add('小三元', 2);
    }
    if (kinds.every(isTermHonor)) add('混老頭', 2);
    if (suits.size === 1) {
      if (hasHonor) add('混一色', menzen ? 3 : 2);
      else add('清一色', menzen ? 6 : 5);
    }
    if (!Y.length) return null;
    return finish(ctx, Y, []);
  }

  function finish(ctx, Y, YM) {
    if (YM.length) {
      return { yaku: YM.map((name) => ({ name, han: 13 })), yakuman: YM.length, han: 13 * YM.length, dora: 0 };
    }
    let dora = 0;
    const count = (list) => list.forEach((k) => { dora += ctx.all[k] || 0; });
    count(ctx.dora || []);
    if (ctx.riichi) count(ctx.ura || []);
    const han = Y.reduce((a, y) => a + y.han, 0) + dora;
    return { yaku: Y, yakuman: 0, han, dora };
  }

  const api = { evaluate, doraOf, isKokushi, isPairs, allDecomps, ORPHANS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.MahjongYaku = api;
})(typeof window !== 'undefined' ? window : globalThis);
