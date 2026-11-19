// のりあいロードの通しプレイのテスト（2026-11-19）。
// どのステージも、2〜10人のどの人数でも、人の操作（左右・ジャンプ・下）だけでゴールまで進めるかを確かめる。
// 人・箱・ものを置いて確かめるルールのテスト（engine.test.cjs）では、前の場面から動かしたときに進めない形
// （シーソーの段で、箱を押した最後の1人が右のシーソーへ移れなかった。PR #369）を見落としたため。
// 区間ごとに「越え方」を1通り書いてあり、行き詰まったら、どの区間のどの場面かを出す。
// 新しい区間（SEG）を足したら、ここにも越え方を足す。
//   node tests/noriai-road/playthrough.cjs            全部（13ステージ × 2〜10人。1秒ほど）
//   node tests/noriai-road/playthrough.cjs 5 2        ステージ5を2人で（区間ごとの時間も出す）
'use strict';
const { E, makeBot, Stuck, PW, PH } = require('./playthrough-bot.cjs');
const near = (a, b, e = 0.05) => Math.abs(a - b) <= e;

const freeSeat = (w, avoid = []) => (w.players.find((p) => !E.holdingOf(w, p.seat) && !avoid.includes(p.seat)) || {}).seat;
function holderOf(w, kind) { const it = w.items.find((x) => x.kind === kind && x.holder && !x.gone); return it ? it.holder : 0; }

function play(stageIndex, n, opts = {}) {
  const w = E.createWorld(stageIndex, n);
  const bot = makeBot(w);
  const P = bot.P;
  const all = w.players.map((p) => p.seat);
  const parts = E.STAGES[stageIndex].parts;
  const org = w.checkpoints.map((c) => c - 0.6);
  const log = [];
  const T = 60 * 40; // 1つの待ちの上限（40秒）

  const live = () => w.players.filter((p) => !p.entered);
  const allPast = (x, seats = all) => seats.every((s) => P(s).entered || (P(s).x >= x && P(s).ground));
  function goAll(x, seats = all, label = 'goAll') {
    bot.setAll({ go: x, tol: 0.25, ropeJump: w.rope }, seats);
    bot.until(() => allPast(x - 0.3, seats), T, label);
  }
  // climber が base の頭に乗る
  function stackOn(climber, base, label) {
    const c = P(climber), b = P(base);
    bot.until(() => b.ground && Math.abs(b.vx) < 0.01, T, label + ' base');
    for (let tries = 0; tries < 6; tries++) {
      bot.set(climber, { go: b.x, tol: 0.12, hop: false });
      bot.until(() => Math.abs(c.x - b.x) < 0.15 && c.ground, T, label + ' align');
      bot.set(climber, { jumpNow: true, jumpHold: 30, hop: false });
      bot.run(3);
      bot.until(() => c.ground && c.vy === 0 && bot.hold[climber - 1] === 0, 120, label + ' jump');
      if (c.ground === 's' + base) { bot.set(climber, {}); return; }
    }
    throw new Stuck(label + ' (頭に乗れない)');
  }

  // 人の頭に乗っている人は、横へ歩いて降りる（下の人は止まる）
  function settle(label) {
    for (let k = 0; k < 4; k++) {
      const up = live().filter((p) => p.ground && p.ground[0] === 's');
      if (!up.length) return;
      bot.idle();
      // 降りる先に床がある向きへ（穴へ落ちないように）
      const floorAt = (x) => { const tx = Math.floor(x); for (let ty = 9; ty < E.H; ty++) if (E.solidTile(w, tx, ty, 0)) return true; return false; };
      up.forEach((p) => {
        const okL = floorAt(p.x - 1.2) && floorAt(p.x - 0.4), okR = floorAt(p.x + PW + 1.2) && floorAt(p.x + PW + 0.4);
        const d = okL && okR ? (k % 2 ? 1 : -1) : okR ? 1 : -1;
        bot.set(p.seat, { dir: d, hop: false });
      });
      // 頭から離れたら止まる
      for (let f = 0; f < 30; f++) {
        up.forEach((p) => { if (!(p.ground && p.ground[0] === 's')) bot.set(p.seat, {}); });
        if (up.every((p) => !(p.ground && p.ground[0] === 's'))) break;
        bot.step();
      }
      bot.idle();
      bot.run(40);
    }
    if (live().some((p) => p.ground && p.ground[0] === 's')) throw new Stuck(label + ' (頭から降りられない)');
  }
  function seg(name, arg, i) {
    const o = org[i];
    const next = org[i + 1] != null ? org[i + 1] : o + 6;
    const end = next - 0.3;
    const rope = w.rope;
    switch (name) {
      case 'start': return;
      case 'bump': case 'pit': case 'stairs': case 'floats': case 'springPit': {
        if (rope && (name === 'floats' || name === 'pit')) {
          // ひも: 足場ごとに、1人ずつ跳ぶ
          if (name === 'pit') { bot.setAll({ go: o + 1.8, tol: 0.1, hop: false, ropeJump: true }); bot.until(() => all.every((sN) => near(P(sN).x, o + 1.8, 0.2) && P(sN).ground), T, 'pit(rope) gather'); }
          else { bot.setAll({ go: o + 0.2, tol: 0.1, hop: false, ropeJump: true }); bot.until(() => all.every((sN) => near(P(sN).x, o + 0.2, 0.2) && P(sN).ground), T, 'floats(rope) gather'); }
          // [位置, 跳ぶか]（足場の上を歩くときは跳ばない）
          const stops = name === 'floats' ? [[3.1, 1], [4.2, 0], [7.1, 1], [8.2, 0], [11.1, 1], [12.2, 0], [14.1, 1]].map(([d, h]) => [o + d, h]) : [[o + arg + 2.0, 1]];
          for (const [x, hop] of stops) {
            for (const sN of all) {
              bot.set(sN, { go: x, tol: 0.15, ropeJump: true, hop: !!hop });
              bot.until(() => near(P(sN).x, x, 0.3) && P(sN).ground, 60 * 6, name + '(rope) ' + sN + ' to ' + (x - o).toFixed(1));
              bot.set(sN, {});
              bot.run(10);
            }
            settle(name + '(rope) settle');
          }
          goAll(end, all, name + '(rope) after');
          return;
        }
        goAll(end, all, name); return;
      }
      case 'ledge': {
        const g = w.gates.find((x) => near(x.x, o + 3)), sw = w.switches.find((x) => near(x.x, o + 7));
        if (!rope) {
          const H = 1, C = 2;
          bot.setAll({ go: o + 1.2, tol: 0.3 });
          bot.set(H, { go: o + 2.1, tol: 0.08, hop: false });
          bot.until(() => near(P(H).x, o + 2.1, 0.1), T, 'ledge H');
          stackOn(C, H, 'ledge C');
          bot.set(C, { go: sw.x + 0.2, tol: 0.1 });
          bot.until(() => sw.on, T, 'ledge switch');
          goAll(o + 14, all.filter((s) => s !== C), 'ledge under');
          goAll(end, all, 'ledge after');
          return;
        }
        // ひも: 最後の人を台にして順に頭から上がり、最後の人はひもで引き上げてもらう
        const B = n;
        bot.setAll({ go: o + 1.6, tol: 0.3 });
        bot.set(B, { go: o + 2.15, tol: 0.06, hop: false });
        bot.until(() => near(P(B).x, o + 2.15, 0.1), T, 'ledge(rope) base');
        for (let s = 1; s < n; s++) {
          stackOn(s, B, 'ledge(rope) climb ' + s);
          bot.set(s, { go: o + 3.6, tol: 0.1 });
          bot.until(() => P(s).ground === 't' && P(s).y < 8 - PH + 0.05, T, 'ledge(rope) up ' + s);
        }
        bot.setAll({ go: o + 5.2, tol: 0.2 }, all.filter((s) => s !== B));
        bot.set(B - 1, { go: o + 7.5, tol: 0.2 });
        bot.set(B, { dir: 1, hop: false, ropeJump: true });
        bot.until(() => P(B).ground === 't' && P(B).y < 8 - PH + 0.05, 60 * 10, 'ledge(rope) last pulled up');
        goAll(end, all, 'ledge(rope) after');
        return;
      }
      case 'colorGate': {
        const g = w.gates.find((x) => near(x.x, o + 3));
        const s = g.seatN;
        bot.setAll({ go: o + 2, tol: 0.3 });
        bot.set(s, { go: o + 5.3, tol: 0.1 });
        bot.until(() => g.open, T, 'colorGate open');
        goAll(o + 6.6, all.filter((x) => x !== s), 'colorGate pass');
        goAll(end, all, 'colorGate after');
        return;
      }
      case 'keyBlock': {
        const s = ((arg - 1) % n) + 1;
        bot.setAll({ go: o + 1.2, tol: 0.3 });
        bot.set(s, { go: o + 2.9, tol: 0.1, hop: false });
        bot.until(() => holderOf(w, 'key') === s, T, 'keyBlock key');
        goAll(end, all, 'keyBlock after');
        return;
      }
      case 'boxSwitch': {
        const box = w.boxes.find((b) => near(b.x0, o + 2));
        const k = box.need;
        const pushers = all.slice(0, k);
        bot.setAll({ go: o + 0.6, tol: 0.4 });
        bot.setAll({ go: box.x - PW - 0.02, tol: 0.05, hop: false }, pushers);
        bot.until(() => pushers.every((s) => P(s).x + PW <= box.x + 0.15 && box.x - (P(s).x + PW) < 0.25), T, 'boxSwitch line up');
        bot.setAll({ dir: 1, hop: false }, pushers);
        bot.until(() => box.x >= o + 8 - 0.02, T, 'boxSwitch push');
        bot.idle();
        bot.run(20);
        goAll(end, all, 'boxSwitch after');
        return;
      }
      case 'lift': case 'bridge': {
        const pi = w.plats.findIndex((p) => p.seesaw < 0 && near(p.ax, name === 'lift' ? o + 2 : o + 0.5));
        const pl = w.plats[pi];
        const crossedX = name === 'lift' ? o + 5 : o + 12;
        for (let round = 0; round < 4; round++) {
          const left = all.filter((s) => P(s).x + PW / 2 < crossedX);
          if (!left.length) break;
          const grp = left.slice(0, Math.min(E.ALL_CAP, left.length));
          const rest = left.filter((s) => !grp.includes(s));
          const standX = name === 'lift' ? o + 3.1 : o + 2.35;
          bot.setAll({ go: name === 'lift' ? o + 0.4 : o - 0.6, tol: 0.2 }, rest);
          bot.until(() => near(pl.x, pl.ax, 0.02) && near(pl.y, pl.ay, 0.02), T, name + ' plat home');
          bot.setAll({ go: standX, tol: 0.15, hop: false }, grp);
          bot.untilTick(() => near(pl.x, pl.bx, 0.02) && near(pl.y, pl.by, 0.02), T, name + ' ride ' + round + ' (need ' + pl.need + ', riders ' + pl.riders + ')',
            () => grp.forEach((s) => { if (P(s).ground === 'p' + pi) bot.set(s, {}); else if (!(pl.dx || pl.dy)) bot.set(s, { go: standX, tol: 0.15, hop: false }); }));
          goAll(end, grp, name + ' get off ' + round);
        }
        goAll(end, all, name + ' after');
        return;
      }
      case 'seesaw': {
        const ss = w.seesaws.find((s) => near(w.plats[s.left].x, o + 3));
        const L = w.plats[ss.left], R = w.plats[ss.right];
        const box = w.boxes.find((b) => near(b.x0, o + 1));
        const launch = L.x - PW - 1.5;
        bot.setAll({ go: o - 0.5, tol: 0.3 });
        bot.setAll({ go: box.x - PW - 0.02, tol: 0.05, hop: false }, [1, 2]);
        bot.until(() => [1, 2].every((s) => box.x - (P(s).x + PW) < 0.25 && P(s).x < box.x), T, 'seesaw line up');
        bot.setAll({ dir: 1, hop: false }, [1, 2]);
        bot.until(() => box.ground === 'p' + ss.left && box.x >= L.x - 0.01, T, 'seesaw push box');
        bot.idle();
        bot.until(() => near(R.y, 8.5, 0.02), T, 'seesaw right up');
        for (const s of all) {
          let ok = false;
          for (let tries = 0; tries < 5 && !ok; tries++) {
            bot.set(s, { go: launch, tol: 0.04, hop: false });
            bot.until(() => near(P(s).x, launch, 0.06) && P(s).ground === 't' && near(R.y, 8.5, 0.02), T, 'seesaw launch ' + s);
            bot.set(s, { dir: 1, hop: false });
            bot.run(20);
            bot.set(s, { dir: 1, hop: false, jumpNow: true, jumpHold: 30 });
            bot.run(3);
            bot.until(() => P(s).ground && bot.hold[s - 1] === 0, 200, 'seesaw jump ' + s);
            if (P(s).ground === 'p' + ss.right) {
              bot.set(s, { go: o + 9, tol: 0.1 });
              bot.until(() => P(s).ground === 't' && P(s).y < 7 - PH + 0.05, 300, 'seesaw to ledge ' + s);
              bot.set(s, { go: o + 11, tol: 0.2 });
              bot.until(() => P(s).ground === 't' && near(P(s).x, o + 11, 0.3), T, 'seesaw wait on ledge ' + s);
              ok = true;
            } else {
              bot.set(s, { go: launch, tol: 0.04, hop: true });
              bot.run(120);
            }
          }
          if (!ok) throw new Stuck('seesaw: ' + s + '番が右のシーソーに乗れない');
        }
        goAll(end, all, 'seesaw after');
        return;
      }
      case 'ballHoop': {
        const hoop = w.hoops.find((h) => near(h.x, o + 5));
        const g = w.gates.find((x) => near(x.x, o + 10));
        if (arg) { const F = freeSeat(w); bot.setAll({ go: o + 0.4, tol: 0.3 }); bot.set(F, { go: o + 1.2, tol: 0.1 }); bot.until(() => holderOf(w, 'ball'), T, 'ballHoop pick'); }
        const B = holderOf(w, 'ball');
        if (!B) throw new Stuck('ballHoop: ボールをだれも持っていない');
        let Tn = freeSeat(w, [B]);
        let droppedKey = false;
        if (!Tn) {
          // 手のあいている人がいない（2人で、1人がカギ・1人がボール）: カギを持っている人が、カギを左へ投げて手をあける
          Tn = w.players.find((p) => p.seat !== B).seat;
          bot.set(Tn, { dir: -1, hop: false }); bot.run(2); bot.set(Tn, {}); bot.run(2);
          bot.set(Tn, { act: true }); bot.run(40);
          if (E.holdingOf(w, Tn)) throw new Stuck('ballHoop: カギを置けない');
          droppedKey = true;
          log.push(['(2人: カギをいったん投げて手をあけた)']);
        }
        const xB = opts.hoopX != null ? o + opts.hoopX : o + 2.2;
        bot.setAll({ go: o + 0.4, tol: 0.3 });
        bot.set(B, { go: xB, tol: 0.04, hop: false });
        bot.until(() => near(P(B).x, xB, 0.06), T, 'ballHoop B');
        stackOn(Tn, B, 'ballHoop T');
        // 下の人が右を向く（少しだけ押して戻す）
        bot.set(B, { dir: 1, hop: false }); bot.run(1); bot.set(B, { go: xB, tol: 0.04, hop: false }); bot.run(10);
        bot.set(B, { act: true }); bot.run(3);
        bot.until(() => holderOf(w, 'ball') === Tn, 30, 'ballHoop pass up');
        bot.set(Tn, { dir: 1, hop: false }); bot.run(1); bot.set(Tn, {}); bot.run(3);
        bot.set(Tn, { act: true });
        bot.until(() => hoop.done, 120, 'ballHoop score');
        bot.until(() => g.open, 60, 'ballHoop gate');
        if (droppedKey) {
          settle('ballHoop settle');
          const key = w.items.find((x) => x.kind === 'key' && !x.gone);
          bot.set(Tn, { go: key.x - 0.1, tol: 0.1 });
          bot.until(() => holderOf(w, 'key') === Tn, T, 'ballHoop pick key again');
        }
        goAll(end, all, 'ballHoop after');
        return;
      }
      case 'tower': {
        const row = n >= 3 ? 7 : 8;
        const sw = w.switches.find((x) => near(x.x, o + 4));
        const g = w.gates.find((x) => near(x.x, o + 3));
        const top = row - PH;
        bot.setAll({ go: o + 1.1, tol: 0.15 });
        const A = 1;
        bot.set(A, { go: o + 2.1, tol: 0.06, hop: false });
        bot.until(() => near(P(A).x, o + 2.1, 0.08), T, 'tower base');
        let C;
        if (n >= 3) {
          const Bm = 3; C = 2;
          stackOn(C, A, 'tower C on A');
          try { stackOn(Bm, A, 'tower B on A'); } catch (e) { if (!(e instanceof Stuck) || P(Bm).ground !== 's' + C) throw e; }
          // C は B の頭へ乗りなおす
          if (P(Bm).ground === 's' + C) { C = Bm; } else {
            bot.set(C, { jumpNow: true, jumpHold: 30, hop: false });
            bot.run(3);
            bot.until(() => P(C).ground && bot.hold[C - 1] === 0, 120, 'tower C hop');
            if (P(C).ground !== 's' + Bm) throw new Stuck('tower: C が B の頭に乗れない ground=' + P(C).ground);
          }
        } else {
          C = 2;
          stackOn(C, A, 'tower C on A');
        }
        bot.set(C, { go: sw.x + 0.25, tol: 0.08 });
        bot.until(() => sw.on, 300, 'tower switch');
        goAll(o + 5.2, all.filter((s) => s !== C), 'tower under');
        // 上の人も下の人も右へ（ひもでつながっていてもいっしょに）
        bot.setAll({ go: end, tol: 0.25 });
        bot.until(() => allPast(end - 0.3), T, 'tower after');
        return;
      }
      case 'boxStep': {
        const box = w.boxes.find((b) => near(b.x0, o + 2));
        bot.setAll({ go: o + 0.8, tol: 0.4 });
        bot.set(1, { go: box.x - PW - 0.02, tol: 0.05, hop: false });
        bot.until(() => box.x - (P(1).x + PW) < 0.2 && P(1).x < box.x, T, 'boxStep line up');
        bot.set(1, { dir: 1, hop: false });
        bot.until(() => box.x >= o + 6 - 0.02, T, 'boxStep push');
        bot.idle(); bot.run(10);
        goAll(end, all, 'boxStep climb');
        return;
      }
      case 'split': case 'numPair': {
        const lower = w.switches.find((x) => near(x.x, o + 2));
        const upper = w.switches.find((x) => near(x.x, name === 'split' ? o + 9 : o + 7));
        const g = w.gates.find((x) => x.latch && x.x > o && x.x < next);
        const A = 1, C = name === 'split' ? 2 : n;
        const baseX = name === 'split' ? o + 6.15 : o + 5.15;
        bot.setAll({ go: o + 3.5, tol: 0.4 });
        bot.set(A, { go: baseX, tol: 0.06, hop: false });
        bot.until(() => near(P(A).x, baseX, 0.08), T, name + ' base');
        stackOn(C, A, name + ' climb');
        bot.set(C, { go: upper.x + 0.25, tol: 0.08 });
        bot.until(() => upper.on, 300, name + ' upper');
        bot.set(A, { go: lower.x + 0.15, tol: 0.08, hop: false });
        bot.until(() => g.latched, T, name + ' latch');
        goAll(end, all, name + ' after');
        return;
      }
      case 'springWall': {
        const K = 1;
        bot.setAll({ go: o + 0.6, tol: 0.3 });
        bot.until(() => allPast(o + 0.2), T, 'springWall gather');
        if (arg) {
          let got = false;
          for (let tries = 0; tries < 6 && !got; tries++) {
            bot.set(K, { dir: 1, hop: false });
            bot.until(() => !P(K).ground && P(K).x > o + 4.15, 200, 'springWall bounce');
            bot.set(K, {});
            bot.until(() => P(K).ground, 200, 'springWall land');
            if (P(K).y < 6 - PH + 0.05) { bot.set(K, { go: o + 5.5, tol: 0.1 }); bot.until(() => holderOf(w, arg) === K, 120, 'springWall item'); got = true; }
            else { bot.set(K, { go: o + 0.6, tol: 0.2 }); bot.run(200); }
          }
          if (!got) throw new Stuck('springWall: かべの上に乗れない');
        }
        goAll(end, all, 'springWall after');
        return;
      }
      case 'springBlock': {
        const blk = w.blocks.find((k) => near(k.x, o + 2));
        const k = blk.need;
        const riders = all.slice(0, k);
        bot.setAll({ go: o + 0.5, tol: 0.3 });
        bot.setAll({ go: o + 2.6, tol: 0.15 }, riders);
        bot.until(() => blk.open, T, 'springBlock open (riders ' + blk.riders + '/' + k + ')');
        const S = freeSeat(w);
        bot.run(60);
        const it = w.items.find((x) => x.kind === 'spring' && !x.hidden && Math.abs(x.x0 - (o + 2.7)) < 0.5);
        bot.set(S, { go: it.x - 0.1, tol: 0.1, hop: false });
        bot.until(() => Math.abs(P(S).x - (it.x - 0.1)) < 0.15 && P(S).ground, T, 'springBlock near spring');
        bot.set(S, { act: true }); bot.run(3);
        bot.until(() => holderOf(w, 'spring') === S, 30, 'springBlock pick');
        bot.setAll({ go: o + 4.5, tol: 0.3 }, all.filter((s) => s !== S));
        bot.set(S, { go: o + 6.3, tol: 0.05 });
        bot.until(() => near(P(S).x, o + 6.3, 0.06) && P(S).ground, T, 'springBlock carry');
        bot.set(S, { dir: 1, hop: false }); bot.run(1); bot.set(S, {}); bot.run(2);
        bot.set(S, { act: true }); bot.run(3);
        bot.until(() => it.armed, 30, 'springBlock place');
        bot.run(30);
        bot.setAll({ go: end, tol: 0.25, hop: false });
        bot.until(() => allPast(end - 0.3), 60 * 20, 'springBlock cross');
        return;
      }
      case 'door': {
        const d = w.door;
        if (d.locked) {
          const K = holderOf(w, 'key');
          if (!K) throw new Stuck('door: カギをだれも持っていない');
          bot.set(K, { go: o + 2.3, tol: 0.1 });
          bot.until(() => !d.locked, T, 'door unlock');
        }
        bot.setAll({ go: o + 2.3, tol: 0.15 });
        bot.until(() => w.clear, T, 'door enter');
        return;
      }
      default: throw new Error('unknown seg ' + name);
    }
  }

  for (let i = 0; i < parts.length; i++) {
    const [name, arg] = parts[i];
    const f0 = bot.f;
    try { if (name !== 'start' && name !== 'door') settle('settle before ' + name); seg(name, arg, i); }
    catch (e) {
      if (!(e instanceof Stuck)) throw e;
      return { ok: false, at: i + ':' + name, why: e.message, frames: bot.f, falls: bot.falls, w, bot, players: w.players.map((p) => [p.seat, +p.x.toFixed(2), +p.y.toFixed(2), p.ground, p.entered]) };
    }
    log.push([name, ((bot.f - f0) / 60).toFixed(1)]);
  }
  return { ok: w.clear, frames: bot.f, falls: bot.falls, log, w, bot };
}

module.exports = { play };

if (require.main === module) {
  const st = process.argv[2] ? [Number(process.argv[2]) - 1] : E.STAGES.map((_, i) => i);
  const ns = process.argv[3] ? [Number(process.argv[3])] : [2, 3, 4, 5, 6, 7, 8, 9, 10];
  for (const s of st) {
    const row = [];
    for (const n of ns) {
      const r = play(s, n);
      row.push(r.ok ? 'o' : 'x');
      if (!r.ok) console.log(`  stage ${s + 1} n=${n}: NG at ${r.at} — ${r.why}  ${JSON.stringify(r.players)}`);
      else if (process.argv[3]) console.log(`  stage ${s + 1} n=${n}: clear ${(r.frames / 60).toFixed(0)}s falls=${r.falls}`, JSON.stringify(r.log));
    }
    console.log(`${row.includes('x') ? 'NG' : 'ok'}  stage ${s + 1} ${E.STAGES[s].name}: ${row.join('')}  (n=${ns.join(',')})`);
    if (row.includes('x')) process.exitCode = 1;
  }
}
